import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresDocumentStore, type ResumeUploadSigner } from "./index.js";

describe("PostgresDocumentStore", () => {
  it("binds JSONB writes as explicit JSON text without the driver JSON wrapper", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        statements.push({ sql, values });
        if (sql.includes("SELECT request_hash")) {
          return [];
        }
        if (sql.includes("SELECT count(*)")) {
          return [{ count: 0 }];
        }
        return [];
      },
      {
        json: () => {
          throw new Error("the driver JSON wrapper must not be used");
        },
      },
    );
    const client = {
      begin: async <T>(callback: (sql: typeof transaction) => Promise<T>) => callback(transaction),
    } as unknown as postgres.Sql;
    const signer: ResumeUploadSigner = {
      async createGrant(input) {
        return {
          url: "https://synthetic-candidate-documents.example.test/",
          method: "POST",
          fields: {
            key: input.objectKey,
            policy: "synthetic-signed-policy",
            "x-amz-signature": "synthetic-signature",
          },
          expiresAt: "2026-08-12T12:05:00.000Z",
        };
      },
    };
    const store = new PostgresDocumentStore(client, signer);

    const response = await store.createResumeUpload(
      "019bf123-4567-789a-8bcd-ef0123456789",
      {
        fileName: "synthetic-resume.pdf",
        mediaType: "application/pdf",
        sizeBytes: 2048,
        sha256: "a".repeat(64),
      },
      "synthetic-idempotency-key-0001",
      "synthetic-trace-0001",
    );

    const idempotencyInsert = statements.find(({ sql }) =>
      sql.includes("INSERT INTO documents.idempotency_keys"),
    );
    const auditInsert = statements.find(({ sql }) =>
      sql.includes("INSERT INTO documents.audit_events"),
    );
    expect(idempotencyInsert?.sql).toContain("?::jsonb");
    expect(auditInsert?.sql).toContain("?::jsonb");
    expect(typeof idempotencyInsert?.values.at(-1)).toBe("string");
    expect(typeof auditInsert?.values.at(-1)).toBe("string");
    expect(JSON.parse(String(idempotencyInsert?.values.at(-1)))).toEqual(response);
    expect(JSON.parse(String(auditInsert?.values.at(-1)))).toEqual({
      version: 1,
      sizeBytes: 2048,
    });
  });
});
