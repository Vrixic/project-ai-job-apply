import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { PostgresRestrictedAnswerExportReader } from "./restricted-answer-export.js";

const reference = {
  id: "entry",
  version: 2,
  fieldKey: "authorization.us_authorized",
  context: "us",
};

describe("Profile-owned restricted answer export reader", () => {
  it.each(["sql", "decrypt"] as const)(
    "pins every reference field before awaiting %s",
    async (timing) => {
      const mutable = { ...reference };
      const mutate = () =>
        Object.assign(mutable, {
          id: "other-entry",
          version: 9,
          fieldKey: "demographic.veteran",
          context: "ca",
        });
      const client = vi
        .fn()
        .mockImplementationOnce(async () => {
          if (timing === "sql") mutate();
          return [
            {
              ciphertext: Buffer.from([1]),
              kmsKeyId: "key",
              encryptionAlgorithm: "SYMMETRIC_DEFAULT",
            },
          ];
        })
        .mockResolvedValueOnce([{ current: true }]);
      const cipher = {
        decrypt: vi.fn(async () => {
          if (timing === "decrypt") mutate();
          return "false";
        }),
      };
      const reader = new PostgresRestrictedAnswerExportReader(
        client as unknown as postgres.Sql,
        cipher,
      );
      await expect(reader.readValue("owner", mutable)).resolves.toBe("false");
      expect(mutable).not.toEqual(reference);
      for (const call of client.mock.calls) {
        expect(call.slice(1)).toEqual([
          "owner",
          reference.id,
          reference.fieldKey,
          reference.context,
          reference.version,
        ]);
      }
      expect(cipher.decrypt).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "owner",
          fieldKey: reference.fieldKey,
          context: reference.context,
        }),
      );
    },
  );

  it("cannot substitute a live neighbour for an original snapshot changed during decrypt", async () => {
    const mutable = { ...reference };
    const client = vi
      .fn()
      .mockResolvedValueOnce([
        { ciphertext: Buffer.from([1]), kmsKeyId: "key", encryptionAlgorithm: "SYMMETRIC_DEFAULT" },
      ])
      .mockImplementationOnce(async (_query, _owner, id, fieldKey, context, version) => [
        {
          current:
            id === "other-entry" &&
            fieldKey === "demographic.veteran" &&
            context === "us" &&
            version === 9,
        },
      ]);
    const reader = new PostgresRestrictedAnswerExportReader(client as unknown as postgres.Sql, {
      decrypt: async () => {
        Object.assign(mutable, {
          id: "other-entry",
          version: 9,
          fieldKey: "demographic.veteran",
          context: "ca",
        });
        return "false";
      },
    });
    await expect(reader.readValue("owner", mutable)).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
  });

  it("refuses credentials, consent artifacts and unknown fields before database or KMS I/O", async () => {
    const client = vi.fn();
    const cipher = { decrypt: vi.fn() };
    const reader = new PostgresRestrictedAnswerExportReader(
      client as unknown as postgres.Sql,
      cipher,
    );
    for (const fieldKey of [
      "credential.password",
      "oauth.token",
      "attestation.truthful",
      "signature.name",
      "challenge.captcha",
      "custom.unknown",
    ]) {
      await expect(reader.readValue("owner", { ...reference, fieldKey })).rejects.toThrow(
        "RestrictedAnswerExportFieldRejected",
      );
    }
    expect(client).not.toHaveBeenCalled();
    expect(cipher.decrypt).not.toHaveBeenCalled();
  });
  it("binds owner and exact metadata in both SQL reads and the decrypt call", async () => {
    const client = vi
      .fn()
      .mockResolvedValueOnce([
        { ciphertext: Buffer.from([1]), kmsKeyId: "key", encryptionAlgorithm: "SYMMETRIC_DEFAULT" },
      ])
      .mockResolvedValueOnce([{ current: true }]);
    const cipher = { decrypt: vi.fn(async () => "false") };
    const reader = new PostgresRestrictedAnswerExportReader(
      client as unknown as postgres.Sql,
      cipher,
    );
    await expect(reader.readValue("owner", reference)).resolves.toBe("false");
    for (const call of client.mock.calls) {
      expect(call.slice(1)).toEqual(["owner", "entry", reference.fieldKey, "us", 2]);
      expect((call[0] as TemplateStringsArray).join("?")).toContain("version.state = 'active'");
      expect((call[0] as TemplateStringsArray).join("?")).not.toContain("expires_at");
    }
    expect(cipher.decrypt).toHaveBeenCalledWith({
      userId: "owner",
      fieldKey: reference.fieldKey,
      context: "us",
      ciphertext: {
        ciphertext: new Uint8Array([1]),
        kmsKeyId: "key",
        encryptionAlgorithm: "SYMMETRIC_DEFAULT",
      },
    });
  });

  it("does not decrypt absent, foreign, superseded, or deleted entries", async () => {
    const cipher = { decrypt: vi.fn() };
    const reader = new PostgresRestrictedAnswerExportReader(
      vi.fn(async () => []) as unknown as postgres.Sql,
      cipher,
    );
    await expect(reader.readValue("owner", reference)).rejects.toThrow(
      "RestrictedAnswerExportSnapshotChanged",
    );
    expect(cipher.decrypt).not.toHaveBeenCalled();
  });

  it("refuses changes during decryption and invalid plaintext", async () => {
    for (const [value, current, error] of [
      ["false", false, "RestrictedAnswerExportSnapshotChanged"],
      ["", true, "RestrictedAnswerExportValueRejected"],
      ["界".repeat(1301), true, "RestrictedAnswerExportValueRejected"],
    ] as const) {
      const client = vi
        .fn()
        .mockResolvedValueOnce([
          {
            ciphertext: Buffer.from([1]),
            kmsKeyId: "key",
            encryptionAlgorithm: "SYMMETRIC_DEFAULT",
          },
        ])
        .mockResolvedValueOnce([{ current }]);
      const reader = new PostgresRestrictedAnswerExportReader(client as unknown as postgres.Sql, {
        decrypt: vi.fn(async () => value),
      });
      await expect(reader.readValue("owner", reference)).rejects.toThrow(error);
    }
  });
});
