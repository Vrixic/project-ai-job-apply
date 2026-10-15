import { describe, expect, it, vi } from "vitest";
import { KmsRestrictedAnswerCipher } from "./restricted-answer-kms-cipher.js";

const KEY_ARN = "arn:aws:kms:us-east-2:362544434697:key/00000000-0000-0000-0000-000000000001";
const INPUT = { userId: "user-1", fieldKey: "authorization.us_authorized", context: "" };

describe("KmsRestrictedAnswerCipher", () => {
  it("throws without a key ARN, rather than silently constructing an unconfigured cipher", () => {
    expect(() => new KmsRestrictedAnswerCipher("")).toThrow(
      "RestrictedAnswerCipherConfigurationInvalid",
    );
  });

  it("calls KMS Encrypt with the plaintext, the exact key, and a binding encryption context", async () => {
    const kms = {
      send: vi.fn(async (_command: unknown) => ({ CiphertextBlob: new Uint8Array([9, 9, 9]) })),
    };
    const cipher = new KmsRestrictedAnswerCipher(KEY_ARN, kms);
    const result = await cipher.encrypt({ ...INPUT, plaintext: "true" });
    expect(result).toEqual({
      ciphertext: new Uint8Array([9, 9, 9]),
      kmsKeyId: KEY_ARN,
      encryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });
    const command = kms.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      KeyId: KEY_ARN,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: {
        purpose: "restricted-answer-vault-v1",
        userId: "user-1",
        fieldKey: "authorization.us_authorized",
      },
    });
    expect(Buffer.from(command.input.Plaintext as Uint8Array).toString("utf8")).toBe("true");
  });

  it("omits an empty context and binds a supplied context, as KMS rejects empty context values", async () => {
    // Real KMS refuses any encryption-context pair with an empty value (ValidationException).
    const contexts: Record<string, string>[] = [];
    const kms = {
      send: vi.fn(async (command: unknown) => {
        const context = (command as { input: { EncryptionContext: Record<string, string> } }).input
          .EncryptionContext;
        if (Object.values(context).some((value) => value === "")) {
          throw Object.assign(new Error("Invalid EncryptionContext"), {
            name: "ValidationException",
          });
        }
        contexts.push(context);
        return { CiphertextBlob: new Uint8Array([9]), Plaintext: new TextEncoder().encode("No") };
      }),
    };
    const cipher = new KmsRestrictedAnswerCipher(KEY_ARN, kms);
    const ciphertext = await cipher.encrypt({ ...INPUT, plaintext: "No" });
    await expect(cipher.decrypt({ ...INPUT, ciphertext })).resolves.toBe("No");
    const scoped = { ...INPUT, context: "jurisdiction.us" };
    await cipher.encrypt({ ...scoped, plaintext: "No" });
    const base = {
      purpose: "restricted-answer-vault-v1",
      userId: "user-1",
      fieldKey: "authorization.us_authorized",
    };
    expect(contexts).toEqual([base, base, { ...base, context: "jurisdiction.us" }]);
  });

  it("rejects an empty or missing ciphertext from KMS instead of returning it", async () => {
    const kms = { send: vi.fn(async (_command: unknown) => ({})) };
    const cipher = new KmsRestrictedAnswerCipher(KEY_ARN, kms);
    await expect(cipher.encrypt({ ...INPUT, plaintext: "true" })).rejects.toThrow(
      "RestrictedAnswerEncryptionRejected",
    );
  });

  it("calls KMS Decrypt with the same binding context and returns the plaintext", async () => {
    const kms = {
      send: vi.fn(async (_command: unknown) => ({ Plaintext: new TextEncoder().encode("true") })),
    };
    const cipher = new KmsRestrictedAnswerCipher(KEY_ARN, kms);
    const value = await cipher.decrypt({
      ...INPUT,
      ciphertext: {
        ciphertext: new Uint8Array([9, 9, 9]),
        kmsKeyId: KEY_ARN,
        encryptionAlgorithm: "SYMMETRIC_DEFAULT",
      },
    });
    expect(value).toBe("true");
    const command = kms.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      KeyId: KEY_ARN,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: {
        purpose: "restricted-answer-vault-v1",
        userId: "user-1",
        fieldKey: "authorization.us_authorized",
      },
    });
  });

  it("rejects a missing plaintext from KMS instead of returning an empty or undefined value", async () => {
    const kms = { send: vi.fn(async (_command: unknown) => ({})) };
    const cipher = new KmsRestrictedAnswerCipher(KEY_ARN, kms);
    await expect(
      cipher.decrypt({
        ...INPUT,
        ciphertext: {
          ciphertext: new Uint8Array([9, 9, 9]),
          kmsKeyId: KEY_ARN,
          encryptionAlgorithm: "SYMMETRIC_DEFAULT",
        },
      }),
    ).rejects.toThrow("RestrictedAnswerDecryptionRejected");
  });
});
