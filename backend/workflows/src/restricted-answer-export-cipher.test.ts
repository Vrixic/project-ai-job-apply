import { describe, expect, it, vi } from "vitest";
import {
  KmsRestrictedAnswerExportCipher,
  restrictedAnswerExportCipherFromEnvironment,
} from "./restricted-answer-export-cipher.js";

const KEY = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001";
const input = {
  userId: "synthetic-owner",
  fieldKey: "authorization.us_authorized",
  context: "us",
  ciphertext: {
    ciphertext: new Uint8Array([1]),
    kmsKeyId: KEY,
    encryptionAlgorithm: "SYMMETRIC_DEFAULT" as const,
  },
};

describe("restricted-answer export decrypt-only boundary", () => {
  it("is absent by default and refuses incomplete or malformed activation", () => {
    expect(restrictedAnswerExportCipherFromEnvironment({})).toBeUndefined();
    for (const env of [
      { RESTRICTED_ANSWER_EXPORT_ENABLED: "true" },
      { RESTRICTED_ANSWER_EXPORT_ENABLED: "enabled" },
      { RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN: KEY },
      {
        RESTRICTED_ANSWER_EXPORT_ENABLED: "enabled",
        RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN: "alias/other",
      },
    ])
      expect(() => restrictedAnswerExportCipherFromEnvironment(env)).toThrow(
        "RestrictedAnswerExportConfigurationRejected",
      );
    expect(
      restrictedAnswerExportCipherFromEnvironment({
        RESTRICTED_ANSWER_EXPORT_ENABLED: "enabled",
        RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN: KEY,
      }),
    ).toBeInstanceOf(KmsRestrictedAnswerExportCipher);
  });

  it("sends only Decrypt with the configured key and exact existing vault context", async () => {
    const kms = {
      send: vi.fn(async () => ({ KeyId: KEY, Plaintext: new TextEncoder().encode("false") })),
    };
    const cipher = new KmsRestrictedAnswerExportCipher(KEY, kms);
    await expect(cipher.decrypt(input)).resolves.toBe("false");
    expect((kms.send.mock.calls as unknown as Array<[{ input: unknown }]>)[0]?.[0].input).toEqual({
      KeyId: KEY,
      CiphertextBlob: input.ciphertext.ciphertext,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: {
        purpose: "restricted-answer-vault-v1",
        userId: input.userId,
        fieldKey: input.fieldKey,
        context: input.context,
      },
    });
    expect(cipher).not.toHaveProperty("encrypt");
  });

  it("omits an empty context exactly as the vault encrypted it, since KMS rejects empty values", async () => {
    const kms = {
      send: vi.fn(async () => ({ KeyId: KEY, Plaintext: new TextEncoder().encode("No") })),
    };
    const cipher = new KmsRestrictedAnswerExportCipher(KEY, kms);
    await expect(cipher.decrypt({ ...input, context: "" })).resolves.toBe("No");
    expect(
      (kms.send.mock.calls as unknown as Array<[{ input: { EncryptionContext: unknown } }]>)[0]?.[0]
        .input.EncryptionContext,
    ).toEqual({
      purpose: "restricted-answer-vault-v1",
      userId: input.userId,
      fieldKey: input.fieldKey,
    });
  });

  it("refuses a different stored key before KMS I/O", async () => {
    const kms = { send: vi.fn() };
    await expect(
      new KmsRestrictedAnswerExportCipher(KEY, kms).decrypt({
        ...input,
        ciphertext: { ...input.ciphertext, kmsKeyId: `${KEY}x` },
      }),
    ).rejects.toThrow("RestrictedAnswerExportCiphertextRejected");
    expect(kms.send).not.toHaveBeenCalled();
  });

  it("redacts provider errors and preserves only allowlisted retry codes", async () => {
    for (const name of ["Error", "ThrottlingException"]) {
      const cipher = new KmsRestrictedAnswerExportCipher(KEY, {
        send: vi.fn(async () => {
          throw Object.assign(new Error("synthetic-sensitive-provider-message"), { name });
        }),
      });
      const error = await cipher.decrypt(input).catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        message: "RestrictedAnswerExportDecryptionFailed",
        code: name === "Error" ? "RestrictedAnswerExportDecryptionFailed" : name,
      });
      expect(String(error)).not.toContain("synthetic-sensitive");
    }
  });

  it("refuses missing, wrong-key, empty, oversized, or non-UTF8 provider output", async () => {
    for (const result of [
      {},
      { KeyId: `${KEY}x`, Plaintext: new Uint8Array([1]) },
      { KeyId: KEY, Plaintext: new Uint8Array() },
      { KeyId: KEY, Plaintext: new Uint8Array(3901) },
      { KeyId: KEY, Plaintext: new Uint8Array([0xff]) },
    ]) {
      const cipher = new KmsRestrictedAnswerExportCipher(KEY, { send: vi.fn(async () => result) });
      await expect(cipher.decrypt(input)).rejects.toThrow(
        "RestrictedAnswerExportDecryptionRejected",
      );
    }
  });
});
