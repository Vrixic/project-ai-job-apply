import { createHash } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresDocumentStore, type ResumeUploadSigner } from "./index.js";

describe("PostgresDocumentStore", () => {
  it("decodes a JSON-text idempotency replay returned by PostgreSQL", async () => {
    const input = {
      fileName: "synthetic-resume.pdf",
      mediaType: "application/pdf" as const,
      sizeBytes: 2048,
      sha256: "a".repeat(64),
    };
    const response = {
      document: {
        id: "019bf123-4567-789a-8bcd-ef0123456789",
        ...input,
        status: "awaiting_upload" as const,
        createdAt: "2026-08-12T12:00:00.000Z",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
      upload: {
        url: "https://synthetic-candidate-documents.example.test/",
        method: "POST" as const,
        fields: { policy: "synthetic-signed-policy" },
        expiresAt: "2026-08-12T12:05:00.000Z",
      },
    };
    const transaction = async (strings: TemplateStringsArray) =>
      strings.join("?").includes("SELECT request_hash")
        ? [
            {
              requestHash: createHash("sha256")
                .update(
                  JSON.stringify([input.fileName, input.mediaType, input.sizeBytes, input.sha256]),
                )
                .digest("hex"),
              response: JSON.stringify(response),
            },
          ]
        : [];
    const client = {
      begin: async <T>(callback: (sql: typeof transaction) => Promise<T>) => callback(transaction),
    } as unknown as postgres.Sql;
    const store = new PostgresDocumentStore(client, {
      createGrant: async () => {
        throw new Error("a replay must not mint another grant");
      },
    });
    await expect(
      store.createResumeUpload(
        "019bf123-4567-789a-8bcd-ef0123456788",
        input,
        "synthetic-idempotency-key-0001",
        "synthetic-trace-0001",
      ),
    ).resolves.toEqual(response);
  });

  it("binds JSONB writes as structured values through the driver JSON wrapper", async () => {
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
        json: <T>(value: T) => ({ json: value }),
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
    expect(idempotencyInsert?.sql).not.toContain("?::jsonb");
    expect(auditInsert?.sql).not.toContain("?::jsonb");
    expect(idempotencyInsert?.values.at(-1)).toEqual({ json: response });
    expect(auditInsert?.values.at(-1)).toEqual({
      json: {
        version: 1,
        sizeBytes: 2048,
      },
    });
  });
});
