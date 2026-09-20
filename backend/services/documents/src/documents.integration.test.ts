import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DocumentIdempotencyConflictError,
  PostgresDocumentStore,
  type ResumeUploadSigner,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresDocumentStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const signer: ResumeUploadSigner = {
    async createGrant(input) {
      return {
        url: "https://candidate-documents.example.test/",
        method: "POST",
        fields: { key: input.objectKey, policy: "synthetic-signed-policy" },
        expiresAt: "2026-08-12T12:05:00.000Z",
      };
    },
  };
  const store = new PostgresDocumentStore(client, signer);

  beforeAll(async () => {
    const profileMigration = fileURLToPath(
      new URL("../../profile/dist/src/migrate.js", import.meta.url),
    );
    const documentsMigration = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    await execFileAsync(process.execPath, [profileMigration], { env: environment });
    const first = await execFileAsync(process.execPath, [documentsMigration], { env: environment });
    const replay = await execFileAsync(process.execPath, [documentsMigration], {
      env: environment,
    });
    expect(first.stdout.trim()).toBe(
      "Documents migrations through 0003_candidate_rights applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
  });

  afterAll(async () => {
    await client.end();
  });

  // Regression (D3-024): the Gateway gives this store its shared Profile client (camel-cased columns and an identity
  // JSON serializer), not a plain client. Registration must work, and store structured JSONB, on that exact client.
  it("registers and replays an upload on the Gateway's shared client, storing structured JSONB", async () => {
    const profileIndex = fileURLToPath(new URL("../../profile/dist/src/index.js", import.meta.url));
    const { createDatabase } = (await import(pathToFileURL(profileIndex).href)) as {
      createDatabase: (url: string) => { client: postgres.Sql };
    };
    const shared = createDatabase(databaseUrl ?? "postgres://invalid");
    const owner = crypto.randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${owner})`;
    try {
      const sharedStore = new PostgresDocumentStore(shared.client, signer);
      const input = {
        fileName: "synthetic-resume.docx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
        sizeBytes: 2834,
        sha256: "b".repeat(64),
      };
      const key = `resume-upload-${crypto.randomUUID()}`;
      const first = await sharedStore.createResumeUpload(owner, input, key, "trace-shared-1");
      const replay = await sharedStore.createResumeUpload(owner, input, key, "trace-shared-2");
      expect(replay).toEqual(first);
      const [stored] = await client<Array<{ kind: string; audit: string }>>`
        SELECT jsonb_typeof(k.response) AS kind,
               (SELECT jsonb_typeof(a.metadata) FROM documents.audit_events a
                 WHERE a.document_id = ${first.document.id}) AS audit
        FROM documents.idempotency_keys k
        WHERE k.user_id = ${owner} AND k.key = ${key}
      `;
      expect(stored).toEqual({ kind: "object", audit: "object" });
    } finally {
      await client`DELETE FROM identity.users WHERE id = ${owner}`.catch(() => undefined);
      await shared.client.end();
    }
  });

  it("keeps upload registration owner-scoped, idempotent, and immutable", async () => {
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${owner}), (${other})`;
    try {
      const input = {
        fileName: "synthetic-resume.pdf",
        mediaType: "application/pdf" as const,
        sizeBytes: 2048,
        sha256: "a".repeat(64),
      };
      const idempotencyKey = `resume-integration-${crypto.randomUUID()}`;
      const first = await store.createResumeUpload(owner, input, idempotencyKey, "trace-resume-1");
      const replay = await store.createResumeUpload(
        owner,
        input,
        idempotencyKey,
        "trace-resume-replay",
      );

      expect(replay).toEqual(first);
      expect(await store.listResumeDocuments(owner)).toMatchObject({
        documents: [
          {
            id: first.document.id,
            fileName: input.fileName,
            sha256: input.sha256,
            status: "awaiting_upload",
          },
        ],
      });
      expect(await store.listResumeDocuments(other)).toEqual({ documents: [] });
      expect(JSON.stringify(await store.listResumeDocuments(owner))).not.toContain("quarantine/");

      await expect(
        store.createResumeUpload(
          owner,
          { ...input, sizeBytes: 4096 },
          idempotencyKey,
          "trace-resume-conflict",
        ),
      ).rejects.toBeInstanceOf(DocumentIdempotencyConflictError);

      const [audit] = await client<Array<{ metadata: Record<string, unknown> }>>`
        SELECT metadata
        FROM documents.audit_events
        WHERE document_id = ${first.document.id}
      `;
      expect(audit?.metadata).toEqual({ version: 1, sizeBytes: input.sizeBytes });
      expect(JSON.stringify(audit)).not.toContain(input.fileName);
      expect(JSON.stringify(audit)).not.toContain(input.sha256);

      let mutationCode: string | undefined;
      try {
        await client`
          UPDATE documents.resume_documents
          SET file_name = 'mutated.pdf'
          WHERE id = ${first.document.id}
        `;
      } catch (error) {
        mutationCode = (error as { code?: string }).code;
      }
      expect(mutationCode).toBe("55000");
    } finally {
      await client`DELETE FROM identity.users WHERE id IN (${owner}, ${other})`;
    }
  });
});
