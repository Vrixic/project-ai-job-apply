import { describe, expect, it } from "vitest";
import {
  PostgresRestrictedAnswerVaultStore,
  RestrictedAnswerVaultConfigurationError,
  RestrictedAnswerVaultInputError,
} from "./restricted-answer-vault.js";
import { FakeRestrictedAnswerCipher } from "./restricted-answer-vault-test-cipher.js";

describe("restricted answer reuse read", () => {
  it.each([false, undefined, 1, "true"])(
    "withholds a value without an exact positive latest-snapshot receipt (%s)",
    async (current) => {
      const queries: string[] = [];
      const query = async (parts: TemplateStringsArray) => {
        queries.push(parts.join("?"));
        return queries.length === 1
          ? [
              {
                id: "synthetic-entry",
                version: 1,
                valueType: "boolean",
                ciphertext: Buffer.from("opaque"),
                kmsKeyId: "synthetic-key",
                encryptionAlgorithm: "SYMMETRIC_DEFAULT",
              },
            ]
          : [{ current }];
      };
      const store = new PostgresRestrictedAnswerVaultStore(
        query as unknown as ConstructorParameters<typeof PostgresRestrictedAnswerVaultStore>[0],
        {
          encrypt: async () => {
            throw new Error("not used");
          },
          decrypt: async () => "true",
        },
      );
      await expect(
        store.readActiveValue({
          userId: "synthetic-owner",
          fieldKey: "authorization.us_authorized",
        }),
      ).resolves.toBeUndefined();
      expect(queries).toHaveLength(2);
    },
  );

  it("returns nothing before KMS when no currently reusable snapshot exists", async () => {
    const query = async () => [];
    const store = new PostgresRestrictedAnswerVaultStore(
      query as unknown as ConstructorParameters<typeof PostgresRestrictedAnswerVaultStore>[0],
      undefined,
    );
    await expect(
      store.readActiveValue({ userId: "synthetic-owner", fieldKey: "authorization.us_authorized" }),
    ).resolves.toBeUndefined();
  });

  it("pins owner, field and context across decryption and checks database expiry on both reads", async () => {
    const input = {
      userId: "synthetic-owner",
      fieldKey: "authorization.us_authorized",
      context: "us",
    };
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: parts.join("?"), values });
      return queries.length === 1
        ? [
            {
              id: "synthetic-entry",
              version: 1,
              valueType: "boolean",
              ciphertext: Buffer.from("opaque"),
              kmsKeyId: "synthetic-key",
              encryptionAlgorithm: "SYMMETRIC_DEFAULT",
            },
          ]
        : [{ current: true }];
    };
    const store = new PostgresRestrictedAnswerVaultStore(
      query as unknown as ConstructorParameters<typeof PostgresRestrictedAnswerVaultStore>[0],
      {
        encrypt: async () => {
          throw new Error("not used");
        },
        decrypt: async (snapshot) => {
          expect(snapshot).toMatchObject({
            userId: "synthetic-owner",
            fieldKey: "authorization.us_authorized",
            context: "us",
          });
          input.userId = "different-owner";
          input.fieldKey = "demographic.veteran";
          input.context = "eu";
          return "synthetic-saved-value";
        },
      },
    );
    await expect(store.readActiveValue(input)).resolves.toEqual({
      id: "synthetic-entry",
      version: 1,
      valueType: "boolean",
      value: "synthetic-saved-value",
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]?.values).toEqual(["synthetic-owner", "authorization.us_authorized", "us"]);
    expect(queries[1]?.values).toEqual([
      "synthetic-owner",
      "synthetic-entry",
      "authorization.us_authorized",
      "us",
      1,
    ]);
    for (const query of queries) {
      expect(query.text).toContain("version.expires_at > clock_timestamp()");
      expect(query.text).toContain("ORDER BY version DESC LIMIT 1");
      expect(query.text).toContain("candidate.id = answer.user_id");
      expect(query.text).toContain("candidate.account_state = 'active'");
      expect(query.values).not.toContain("synthetic-saved-value");
    }
  });
});

it("preserves the exact PostgreSQL creation timestamp instead of rounding to milliseconds", async () => {
  const { PostgresRestrictedAnswerVaultStore } = await import("./restricted-answer-vault.js");
  const createdAt = "2026-09-30T12:00:01.123456+00:00";
  const query = async () => [
    {
      id: "019d04cf-1f80-7000-8000-000000000071",
      fieldKey: "authorization.us_authorized",
      context: null,
      version: 1,
      valueType: "boolean",
      sensitivity: "restricted",
      state: "active",
      confirmedAt: new Date("2026-01-01T12:00:00.000Z"),
      createdAt,
      expiresAt: null,
    },
  ];
  const store = new PostgresRestrictedAnswerVaultStore(
    query as unknown as ConstructorParameters<typeof PostgresRestrictedAnswerVaultStore>[0],
    undefined,
  );
  const [entry] = await store.list("synthetic-owner");
  expect(entry?.createdAt).toBe(createdAt);
  expect(entry).not.toHaveProperty("value");
  expect(entry).not.toHaveProperty("ciphertext");
});

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
        idempotencyKey: "trace-1-idempotency-key",
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
    ["an idempotencyKey shorter than 16 characters", { idempotencyKey: "short" }],
    ["an idempotencyKey longer than 128 characters", { idempotencyKey: "x".repeat(129) }],
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
        idempotencyKey: "trace-1-idempotency-key",
        traceId: "trace-1",
        ...override,
      }),
    ).rejects.toBeInstanceOf(RestrictedAnswerVaultInputError);
    expect(calls).toEqual([]);
  });
});
