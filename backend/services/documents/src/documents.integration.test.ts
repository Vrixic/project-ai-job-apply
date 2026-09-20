import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DocumentIdempotencyConflictError,
  PostgresDocumentStore,
  ResumeDocumentLimitError,
  type ResumeLimits,
  ResumeUploadInProgressError,
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
  const limitOf = (maxStoredResumes: number): ResumeLimits => ({
    maxStoredResumes: async () => maxStoredResumes,
  });
  const store = new PostgresDocumentStore(client, signer, limitOf(1));

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

  // ---- resume slots (ADR-032): one stored resume on the Free plan, one upload in progress at a time
  const slotInput = (name: string) => ({
    fileName: name,
    mediaType: "application/pdf" as const,
    sizeBytes: 2048,
    sha256: "c".repeat(64),
  });
  const newKey = () => `resume-upload-${crypto.randomUUID()}`;
  const advance = async (id: string, status: "scanning" | "parsing" | "parsed" | "failed") => {
    if (status === "parsed") {
      await client`
        UPDATE documents.resume_documents
        SET status = 'parsed', normalized_object_key = ${`normalized/${id}.json`},
            normalized_object_version = 'v1', page_count = 1, character_count = 100
        WHERE id = ${id}`;
    } else if (status === "failed") {
      await client`
        UPDATE documents.resume_documents SET status = 'failed', failure_code = 'scan_failed' WHERE id = ${id}`;
    } else {
      await client`UPDATE documents.resume_documents SET status = ${status} WHERE id = ${id}`;
    }
  };
  const withUsers = async (count: number, run: (users: string[]) => Promise<void>) => {
    const users = Array.from({ length: count }, () => crypto.randomUUID());
    for (const user of users) await client`INSERT INTO identity.users (id) VALUES (${user})`;
    try {
      await run(users);
    } finally {
      for (const user of users) {
        await client`DELETE FROM identity.users WHERE id = ${user}`.catch(() => undefined);
      }
    }
  };

  it("allows one stored resume, and only one upload in progress, through the whole lifecycle", async () => {
    await withUsers(2, async ([owner, other]) => {
      const first = await store.createResumeUpload(
        owner as string,
        slotInput("a.pdf"),
        newKey(),
        "t1",
      );
      // uploading, scanning, and parsing all hold the slot
      for (const stage of [undefined, "scanning", "parsing"] as const) {
        if (stage) await advance(first.document.id, stage);
        await expect(
          store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t2"),
          String(stage),
        ).rejects.toBeInstanceOf(ResumeUploadInProgressError);
      }
      // a parsed resume keeps the slot: the plan's limit is now the reason
      await advance(first.document.id, "parsed");
      await expect(
        store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t3"),
      ).rejects.toMatchObject({ name: "ResumeDocumentLimitError", limit: 1 });
      // another candidate is unaffected
      await expect(
        store.createResumeUpload(other as string, slotInput("c.pdf"), newKey(), "t4"),
      ).resolves.toMatchObject({ document: { status: "awaiting_upload" } });
      // a larger limit (a later plan) admits a second resume with no other change
      const larger = new PostgresDocumentStore(client, signer, limitOf(2));
      await expect(
        larger.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t5"),
      ).resolves.toMatchObject({ document: { status: "awaiting_upload" } });
    });
  });

  it("frees the slot when a resume fails or is rejected", async () => {
    await withUsers(1, async ([owner]) => {
      const first = await store.createResumeUpload(
        owner as string,
        slotInput("a.pdf"),
        newKey(),
        "t1",
      );
      await advance(first.document.id, "scanning");
      await advance(first.document.id, "failed");
      const second = await store.createResumeUpload(
        owner as string,
        slotInput("b.pdf"),
        newKey(),
        "t2",
      );
      await client`UPDATE documents.resume_documents SET status = 'failed', failure_code = 'scan_failed' WHERE id = ${second.document.id}`;
      await expect(
        store.createResumeUpload(owner as string, slotInput("c.pdf"), newKey(), "t3"),
      ).resolves.toMatchObject({ document: { status: "awaiting_upload" } });
    });
  });

  it("still replays an earlier registration after the slot is taken", async () => {
    await withUsers(1, async ([owner]) => {
      const key = newKey();
      const first = await store.createResumeUpload(owner as string, slotInput("a.pdf"), key, "t1");
      await advance(first.document.id, "scanning");
      await expect(
        store.createResumeUpload(owner as string, slotInput("a.pdf"), key, "t2"),
      ).resolves.toEqual(first);
    });
  });

  it("abandons a registration whose grant has lapsed, so it never blocks the candidate", async () => {
    await withUsers(1, async ([owner]) => {
      const lapsed = crypto.randomUUID();
      const recent = crypto.randomUUID();
      await client`
        INSERT INTO documents.resume_documents
          (id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status, created_at, updated_at)
        VALUES (${lapsed}, ${owner as string}, 'lapsed.pdf', 'application/pdf', 2048, ${"d".repeat(64)},
                ${`quarantine/${lapsed}/source`}, 'awaiting_upload', now() - interval '16 minutes', now() - interval '16 minutes')`;
      // within the hold window the registration still holds the slot
      await client`
        INSERT INTO documents.resume_documents
          (id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status, created_at, updated_at)
        VALUES (${recent}, ${owner as string}, 'recent.pdf', 'application/pdf', 2048, ${"e".repeat(64)},
                ${`quarantine/${recent}/source`}, 'awaiting_upload', now() - interval '10 minutes', now() - interval '10 minutes')`;
      await expect(
        store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t1"),
      ).rejects.toBeInstanceOf(ResumeUploadInProgressError);
      // a refusal rolls its transaction back, so the sweep is only committed by a registration that succeeds
      const untouched = await client<Array<{ status: string }>>`
        SELECT status FROM documents.resume_documents WHERE id = ${lapsed}`;
      expect(untouched).toEqual([{ status: "awaiting_upload" }]);
      // once the recent one also lapses, the candidate can register again
      await client`UPDATE documents.resume_documents SET status = 'failed', failure_code = 'scan_failed' WHERE id = ${recent}`;
      await expect(
        store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t2"),
      ).resolves.toMatchObject({ document: { status: "awaiting_upload" } });
      const rows = await client<Array<{ id: string; status: string; failureCode: string | null }>>`
        SELECT id, status, failure_code AS "failureCode" FROM documents.resume_documents WHERE user_id = ${owner as string}`;
      expect(rows.find((row) => row.id === lapsed)).toMatchObject({
        status: "failed",
        failureCode: "scan_failed",
      });
      const audits = await client<Array<{ action: string }>>`
        SELECT action FROM documents.audit_events WHERE document_id = ${lapsed}`;
      expect(audits).toEqual([{ action: "resume.processing.failed" }]);
    });
  });

  it("never lets concurrent uploads with different keys exceed the limit", async () => {
    await withUsers(6, async (users) => {
      for (const user of users) {
        const results = await Promise.allSettled([
          store.createResumeUpload(user, slotInput("x.pdf"), newKey(), "c1"),
          store.createResumeUpload(user, slotInput("y.pdf"), newKey(), "c2"),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const refused = results.find((result) => result.status === "rejected");
        expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
          ResumeUploadInProgressError,
        );
        const [row] = await client<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM documents.resume_documents WHERE user_id = ${user}`;
        expect(row?.count).toBe(1);
      }
    });
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
      const sharedStore = new PostgresDocumentStore(shared.client, signer, limitOf(1));
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
