import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  PostgresRestrictedAnswerVaultStore,
  RestrictedAnswerVaultInputError,
} from "./restricted-answer-vault.js";

const owner = "019d04cf-1f80-7000-8000-000000000001";
const reference = {
  id: "019d04cf-1f80-7000-8000-000000000002",
  version: 7,
  fieldKey: "authorization.us_authorized",
  context: "us",
};

function reader(rows: unknown[][], decrypt?: () => Promise<string>) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: parts.join("?"), values });
    return rows.shift() ?? [];
  };
  const store = new PostgresRestrictedAnswerVaultStore(
    query as unknown as postgres.Sql,
    decrypt
      ? {
          encrypt: async () => {
            throw new Error("unused");
          },
          decrypt,
        }
      : undefined,
  );
  return { store, queries };
}

const valueRow = {
  ...reference,
  valueType: "boolean",
  ciphertext: Buffer.from("opaque"),
  kmsKeyId: "synthetic-key",
  encryptionAlgorithm: "SYMMETRIC_DEFAULT",
};
const currentRow = { id: reference.id, version: reference.version, validUntilEpochMs: null };

describe("selected restricted-answer owner reads", () => {
  it("pins reference identity while the metadata query is pending", async () => {
    const selected = { ...reference };
    const query = async () => {
      selected.id = owner;
      selected.version = 99;
      selected.fieldKey = "demographic.veteran";
      selected.context = "other";
      return [currentRow];
    };
    const store = new PostgresRestrictedAnswerVaultStore(
      query as unknown as postgres.Sql,
      undefined,
    );
    await expect(store.readCurrentReference(owner, selected)).resolves.toEqual({
      ...reference,
      validUntilEpochMs: null,
    });
  });

  it.each([
    { id: "not-a-uuid" },
    { fieldKey: " " },
    { context: "x".repeat(121) },
    { fieldKey: 1 },
    { context: 1 },
  ])("rejects malformed selected metadata before SQL (%s)", async (patch) => {
    const { store, queries } = reader([]);
    const invalid = { ...reference, ...patch } as unknown as typeof reference;
    await expect(store.readCurrentReference(owner, invalid)).rejects.toBeInstanceOf(
      RestrictedAnswerVaultInputError,
    );
    await expect(store.readSelectedValue(owner, invalid)).rejects.toBeInstanceOf(
      RestrictedAnswerVaultInputError,
    );
    expect(queries).toEqual([]);
  });

  it("checks the exact latest reference without a cipher and returns only bounded metadata", async () => {
    const { store, queries } = reader([
      [{ ...currentRow, ciphertext: "private", value: "private" }],
    ]);
    await expect(store.readCurrentReference(owner, reference)).resolves.toEqual({
      ...reference,
      validUntilEpochMs: null,
    });
    expect(queries[0]?.values).toEqual([
      owner,
      reference.id,
      reference.fieldKey,
      reference.context,
      reference.version,
    ]);
    expect(queries[0]?.text).not.toContain("ciphertext");
  });

  it.each([
    { rows: [] },
    { rows: [{ ...currentRow, id: owner }] },
    { rows: [{ ...currentRow, version: 8 }] },
  ])("withholds a missing or mismatched reference", async ({ rows }) => {
    await expect(
      reader([rows]).store.readCurrentReference(owner, reference),
    ).resolves.toBeUndefined();
  });

  it.each([undefined, "2030-01-01", Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses an invalid expiry receipt (%s)",
    async (validUntilEpochMs) => {
      await expect(
        reader([[{ ...currentRow, validUntilEpochMs }]]).store.readCurrentReference(
          owner,
          reference,
        ),
      ).rejects.toBeInstanceOf(RestrictedAnswerVaultInputError);
    },
  );

  it("carries a finite expiry deadline for the consuming admission guard", async () => {
    await expect(
      reader([
        [{ ...currentRow, validUntilEpochMs: 1_900_000_000_123 }],
      ]).store.readCurrentReference(owner, reference),
    ).resolves.toMatchObject({ validUntilEpochMs: 1_900_000_000_123 });
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "rejects an invalid selected version (%s) before SQL",
    async (version) => {
      const { store, queries } = reader([]);
      await expect(
        store.readSelectedValue(owner, { ...reference, version }),
      ).rejects.toBeInstanceOf(RestrictedAnswerVaultInputError);
      expect(queries).toEqual([]);
    },
  );

  it("withholds an absent exact selection before invoking KMS", async () => {
    let calls = 0;
    const { store } = reader([[]], async () => {
      calls++;
      return "private";
    });
    await expect(store.readSelectedValue(owner, reference)).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  it("detaches the candidate's selection before decryption and returns its original identity", async () => {
    const selection = { ...reference };
    const { store, queries } = reader([[valueRow], [{ current: true }], [currentRow]], async () => {
      selection.id = owner;
      selection.version = 99;
      selection.context = "other";
      return "false";
    });
    await expect(store.readSelectedValue(owner, selection)).resolves.toEqual({
      ...reference,
      validUntilEpochMs: null,
      valueType: "boolean",
      value: "false",
    });
    expect(queries[0]?.values).toEqual([
      owner,
      reference.fieldKey,
      reference.context,
      reference.id,
      reference.version,
    ]);
    expect(queries[2]?.values).toEqual([
      owner,
      reference.id,
      reference.fieldKey,
      reference.context,
      reference.version,
    ]);
    for (const query of queries) expect(query.values).not.toContain("false");
  });

  it("withholds a reference lost between post-decrypt validation and the deadline read", async () => {
    const { store } = reader([[valueRow], [{ current: true }], []], async () => "false");
    await expect(store.readSelectedValue(owner, reference)).resolves.toBeUndefined();
  });

  it("normalizes only the absent context to the vault's existing empty-context identity", async () => {
    const { store, queries } = reader([[currentRow]]);
    await expect(
      store.readCurrentReference(owner, {
        id: reference.id,
        version: reference.version,
        fieldKey: reference.fieldKey,
      }),
    ).resolves.toMatchObject({ context: "" });
    expect(queries[0]?.values[3]).toBe("");
  });
});
