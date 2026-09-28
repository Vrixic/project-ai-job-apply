import { describe, expect, it } from "vitest";
import {
  RestrictedAnswerVaultConfigurationError,
  RestrictedAnswerVaultInputError,
} from "./restricted-answer-vault.js";
import { FakeRestrictedAnswerCipher } from "./restricted-answer-vault-test-cipher.js";

describe("FakeRestrictedAnswerCipher", () => {
  it("round-trips a value for the exact context it was encrypted under", async () => {
    const cipher = new FakeRestrictedAnswerCipher();
    const ciphertext = await cipher.encrypt({
      userId: "user-1",
      fieldKey: "authorization.us_authorized",
      context: "",
      plaintext: "true",
    });
    await expect(
      cipher.decrypt({
        userId: "user-1",
        fieldKey: "authorization.us_authorized",
        context: "",
        ciphertext,
      }),
    ).resolves.toBe("true");
  });

  it.each([
    [
      "a different user",
      { userId: "user-2", fieldKey: "authorization.us_authorized", context: "" },
    ],
    [
      "a different field",
      { userId: "user-1", fieldKey: "authorization.sponsorship_required", context: "" },
    ],
    [
      "a different context",
      { userId: "user-1", fieldKey: "authorization.us_authorized", context: "eu" },
    ],
  ])("refuses to decrypt under %s", async (_name, wrongContext) => {
    const cipher = new FakeRestrictedAnswerCipher();
    const ciphertext = await cipher.encrypt({
      userId: "user-1",
      fieldKey: "authorization.us_authorized",
      context: "",
      plaintext: "true",
    });
    await expect(cipher.decrypt({ ...wrongContext, ciphertext })).rejects.toThrow(
      "FakeRestrictedAnswerCipherContextMismatch",
    );
  });

  it("never stores two encryptions under the same opaque handle", async () => {
    const cipher = new FakeRestrictedAnswerCipher();
    const input = { userId: "user-1", fieldKey: "demographic.veteran", context: "" };
    const first = await cipher.encrypt({ ...input, plaintext: "no" });
    const second = await cipher.encrypt({ ...input, plaintext: "yes" });
    expect(Buffer.from(first.ciphertext)).not.toEqual(Buffer.from(second.ciphertext));
    await expect(cipher.decrypt({ ...input, ciphertext: first })).resolves.toBe("no");
    await expect(cipher.decrypt({ ...input, ciphertext: second })).resolves.toBe("yes");
  });
});

describe("PostgresRestrictedAnswerVaultStore construction", () => {
  it("throws a configuration error, not a silent no-op, when asked to save without a cipher", async () => {
    const { PostgresRestrictedAnswerVaultStore } = await import("./restricted-answer-vault.js");
    // biome-ignore lint/suspicious/noExplicitAny: only save()'s early cipher check is exercised; the client is never reached.
    const store = new PostgresRestrictedAnswerVaultStore({} as any, undefined);
    await expect(
      store.save({
        userId: "user-1",
        fieldKey: "authorization.us_authorized",
        expectedVersion: 0,
        valueType: "boolean",
        value: "true",
        sensitivity: "restricted",
        sourceReference: "application-review-panel",
        confirmedAt: new Date("2026-09-28T00:00:00.000Z"),
        traceId: "trace-1",
      }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultConfigurationError);
  });

  it.each([
    ["an empty field key", { fieldKey: "" }],
    ["a field key that is only whitespace", { fieldKey: "   " }],
    ["a field key over 120 characters", { fieldKey: "x".repeat(121) }],
    ["a negative expectedVersion", { expectedVersion: -1 }],
    ["a non-integer expectedVersion", { expectedVersion: 1.5 }],
    ["an empty value", { value: "" }],
    ["a value over the byte bound", { value: "x".repeat(4_000) }],
    ["an empty sourceReference", { sourceReference: "" }],
    ["an expiresAt not after confirmedAt", { expiresAt: new Date("2020-01-01T00:00:00.000Z") }],
  ])("rejects %s before ever calling the cipher", async (_name, override) => {
    const { PostgresRestrictedAnswerVaultStore } = await import("./restricted-answer-vault.js");
    const cipher = new FakeRestrictedAnswerCipher();
    const calls: unknown[] = [];
    const spyingCipher = {
      encrypt: async (input: Parameters<typeof cipher.encrypt>[0]) => {
        calls.push(input);
        return cipher.encrypt(input);
      },
      decrypt: cipher.decrypt.bind(cipher),
    };
    // biome-ignore lint/suspicious/noExplicitAny: the client is never reached because validation throws first.
    const store = new PostgresRestrictedAnswerVaultStore({} as any, spyingCipher);
    await expect(
      store.save({
        userId: "user-1",
        fieldKey: "authorization.us_authorized",
        expectedVersion: 0,
        valueType: "boolean",
        value: "true",
        sensitivity: "restricted",
        sourceReference: "application-review-panel",
        confirmedAt: new Date("2026-09-28T00:00:00.000Z"),
        traceId: "trace-1",
        ...override,
      }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultInputError);
    expect(calls).toEqual([]);
  });
});
