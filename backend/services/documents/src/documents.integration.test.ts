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
  ResumeNotDeletableError,
  ResumeUploadInProgressError,
  type ResumeUploadSigner,
} from "./index.js";
import { PostgresParsedResumeSource } from "./resume-tailoring.js";

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
      "Documents migrations through 0007_cover_letter_work_authorizations applied and verified.",
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
  // ---- resume deletion (ADR-033): a tombstone that frees the slot and keeps the object inventory exact
  it("deletes a parsed resume so the candidate can upload a new one, keeping an exact object inventory", async () => {
    await withUsers(2, async ([owner, other]) => {
      const first = await store.createResumeUpload(
        owner as string,
        slotInput("a.pdf"),
        newKey(),
        "t1",
      );
      await advance(first.document.id, "scanning");
      await advance(first.document.id, "parsing");
      await advance(first.document.id, "parsed");
      await client`
        UPDATE documents.resume_documents
        SET parser_version = 'parser-test', normalized_sha256 = ${"d".repeat(64)}
        WHERE id = ${first.document.id}`;
      const parsedSource = new PostgresParsedResumeSource(client);
      expect(await parsedSource.findParsedResume(owner as string)).toMatchObject({
        id: first.document.id,
      });
      await expect(
        store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t2"),
      ).rejects.toBeInstanceOf(ResumeDocumentLimitError);

      // another candidate cannot delete it, and learns nothing from trying
      await expect(
        store.deleteResume(other as string, first.document.id, "t-other"),
      ).resolves.toBeUndefined();
      expect((await store.listResumeDocuments(owner as string)).documents).toHaveLength(1);

      await store.deleteResume(owner as string, first.document.id, "t3");
      expect(await store.listResumeDocuments(owner as string)).toEqual({ documents: [] });
      // it can no longer be used to tailor an application
      expect(await parsedSource.findParsedResume(owner as string)).toBeNull();
      expect(await parsedSource.findParsedResume(owner as string, first.document.id)).toBeNull();
      // the slot is free at once, so a new upload is accepted
      await expect(
        store.createResumeUpload(owner as string, slotInput("b.pdf"), newKey(), "t4"),
      ).resolves.toMatchObject({ document: { status: "awaiting_upload" } });

      // the tombstone keeps its row and object keys, so candidate data deletion still names every object
      const [inventory] = await client<Array<{ inventory: Array<{ documentId: string }> }>>`
        SELECT documents.candidate_object_inventory(${owner as string}::uuid) AS inventory`;
      expect(inventory?.inventory.map((entry) => entry.documentId)).toContain(first.document.id);

      // repeating the deletion is a no-op: one audit event, timestamp unchanged
      const before = await client<Array<{ deletedAt: Date }>>`
        SELECT deleted_at AS "deletedAt" FROM documents.resume_documents WHERE id = ${first.document.id}`;
      await store.deleteResume(owner as string, first.document.id, "t5");
      const after = await client<Array<{ deletedAt: Date }>>`
        SELECT deleted_at AS "deletedAt" FROM documents.resume_documents WHERE id = ${first.document.id}`;
      expect(after[0]?.deletedAt).toEqual(before[0]?.deletedAt);
      const audits = await client<Array<{ metadata: Record<string, unknown>; userId: string }>>`
        SELECT metadata, user_id AS "userId" FROM documents.audit_events
        WHERE document_id = ${first.document.id} AND action = 'resume.deleted'`;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toEqual({ metadata: { version: 1, status: "parsed" }, userId: owner });
    });
  });

  it("deletes a failed resume, and refuses while one is still being processed", async () => {
    await withUsers(1, async ([owner]) => {
      const first = await store.createResumeUpload(
        owner as string,
        slotInput("a.pdf"),
        newKey(),
        "t1",
      );
      for (const stage of [undefined, "scanning", "parsing"] as const) {
        if (stage) await advance(first.document.id, stage);
        await expect(
          store.deleteResume(owner as string, first.document.id, "t2"),
          String(stage),
        ).rejects.toBeInstanceOf(ResumeNotDeletableError);
      }
      await advance(first.document.id, "failed");
      await store.deleteResume(owner as string, first.document.id, "t3");
      expect(await store.listResumeDocuments(owner as string)).toEqual({ documents: [] });
    });
  });

  it("lets the database itself refuse to un-delete a resume or delete one that is still processing", async () => {
    await withUsers(1, async ([owner]) => {
      const first = await store.createResumeUpload(
        owner as string,
        slotInput("a.pdf"),
        newKey(),
        "t1",
      );
      const code = async (run: () => Promise<unknown>) => {
        try {
          await run();
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return undefined;
      };
      expect(
        await code(
          () =>
            client`UPDATE documents.resume_documents SET deleted_at = now() WHERE id = ${first.document.id}`,
        ),
      ).toBe("23514");
      await advance(first.document.id, "scanning");
      await advance(first.document.id, "failed");
      await store.deleteResume(owner as string, first.document.id, "t2");
      expect(
        await code(
          () =>
            client`UPDATE documents.resume_documents SET deleted_at = NULL WHERE id = ${first.document.id}`,
        ),
      ).toBe("55000");
    });
  });

  it("orders a deletion and an upload for the same candidate, so exactly one new resume is accepted", async () => {
    await withUsers(4, async (users) => {
      const outcomes = await Promise.all(
        users.map(async (user) => {
          const first = await store.createResumeUpload(user, slotInput("a.pdf"), newKey(), "t1");
          await advance(first.document.id, "scanning");
          await advance(first.document.id, "parsing");
          await advance(first.document.id, "parsed");
          const results = await Promise.allSettled([
            store.deleteResume(user, first.document.id, "t2"),
            store.createResumeUpload(user, slotInput("b.pdf"), newKey(), "t3"),
            store.createResumeUpload(user, slotInput("c.pdf"), newKey(), "t4"),
          ]);
          const stored = (await store.listResumeDocuments(user)).documents;
          return { results, stored };
        }),
      );
      for (const { results, stored } of outcomes) {
        expect(results[0]?.status).toBe("fulfilled");
        const accepted = results.slice(1).filter((result) => result.status === "fulfilled");
        // the deletion may land before or after a registration; the limit of 1 holds either way
        expect(accepted.length).toBeLessThanOrEqual(1);
        expect(stored.length).toBeLessThanOrEqual(1);
      }
    });
  });
  // ---- resume byte purge (ADR-034): the two owner-defined functions the maintenance sweep calls
  const purgeInput = (name: string) => ({ ...slotInput(name), sha256: "e".repeat(64) });
  const tombstone = async (
    owner: string,
    name: string,
    options: { hold?: boolean; deletedDaysAgo?: number } = {},
  ) => {
    const registered = await store.createResumeUpload(owner, purgeInput(name), newKey(), "t-reg");
    const id = registered.document.id;
    await advance(id, "scanning");
    await client`
      UPDATE documents.resume_documents
      SET status = 'failed', failure_code = 'scan_failed', security_hold = ${options.hold ?? false}
      WHERE id = ${id}`;
    await client`
      INSERT INTO documents.processing_receipts (event_id, document_id, source_object_version)
      VALUES (${`receipt-${id}`}, ${id}, 'v1')`;
    await client`
      INSERT INTO documents.processing_dispositions (
        document_id, source_object_version, scan_status, scan_result, first_event_id
      ) VALUES (${id}, 'v1', 'COMPLETED', 'NO_THREATS_FOUND', ${`event-${id}`})`;
    if (options.deletedDaysAgo === undefined) {
      await store.deleteResume(owner, id, "t-del");
    } else {
      // A tombstone written before the evidence window began: the column can be set once, from null.
      await client`
        UPDATE documents.resume_documents
        SET deleted_at = now() - ${options.deletedDaysAgo} * interval '1 day' WHERE id = ${id}`;
    }
    return id;
  };
  const pending = async (limit = 100) => {
    const [row] = await client<
      Array<{
        data: { eligible: Array<{ userId: string; documentId: string }>; heldWaiting: number };
      }>
    >`
      SELECT documents.pending_resume_purges(${limit}) AS data`;
    return row?.data as {
      eligible: Array<{ userId: string; documentId: string }>;
      heldWaiting: number;
    };
  };
  const completePurge = async (owner: string, id: string, absent: boolean) => {
    const [row] = await client<Array<{ data: Record<string, unknown> }>>`
      SELECT documents.complete_resume_purge(${owner}::uuid, ${id}::uuid, ${absent}) AS data`;
    return row?.data;
  };
  const sqlCode = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };

  it("names only tombstones that are ready, oldest first, and counts held ones still inside the evidence window", async () => {
    await withUsers(1, async ([owner]) => {
      const first = await tombstone(owner as string, "first.pdf");
      const held = await tombstone(owner as string, "held.pdf", { hold: true });
      const expiredHold = await tombstone(owner as string, "expired-hold.pdf", {
        hold: true,
        deletedDaysAgo: 31,
      });
      const live = await store.createResumeUpload(
        owner as string,
        purgeInput("live.pdf"),
        newKey(),
        "t-live",
      );
      const result = await pending();
      const mine = result.eligible
        .filter((entry) => entry.userId === owner)
        .map((entry) => entry.documentId);
      expect(mine).toContain(first);
      expect(mine).toContain(expiredHold);
      expect(mine).not.toContain(held);
      expect(mine).not.toContain(live.document.id);
      expect(result.heldWaiting).toBeGreaterThanOrEqual(1);
      // oldest tombstone first: the backdated one leads the candidate's own entries
      expect(mine.indexOf(expiredHold)).toBeLessThan(mine.indexOf(first));
      expect((await pending(1)).eligible).toHaveLength(1);
      expect(await sqlCode(() => pending(0))).toBe("22023");
      expect(await sqlCode(() => pending(101))).toBe("22023");
    });
  });

  it("purges a tombstone completely: row, idempotency entry with the file name, receipts, dispositions, and leaves one value-free audit event", async () => {
    await withUsers(2, async ([owner, other]) => {
      const fileName = `purge-me-${crypto.randomUUID()}.pdf`;
      const id = await tombstone(owner as string, fileName);
      const otherId = await tombstone(other as string, "someone-elses.pdf");
      // an idempotency response written as a JSON string (older clients) is found too
      const stringKey = newKey();
      await client`
        INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
        VALUES (${owner as string}, 'documents.resume-upload.create.v1', ${stringKey}, ${"f".repeat(64)},
                ${JSON.stringify({ document: { id, fileName } })}::jsonb)`;
      const before = await client`
        SELECT 1 FROM documents.idempotency_keys WHERE user_id = ${owner as string} AND response::text LIKE ${`%${fileName}%`}`;
      expect(before.length).toBeGreaterThanOrEqual(2);

      expect(await completePurge(owner as string, id, true)).toMatchObject({
        purged: true,
        idempotencyKeysDeleted: 2,
      });

      expect(await client`SELECT 1 FROM documents.resume_documents WHERE id = ${id}`).toHaveLength(
        0,
      );
      expect(
        await client`SELECT 1 FROM documents.processing_receipts WHERE document_id = ${id}`,
      ).toHaveLength(0);
      expect(
        await client`SELECT 1 FROM documents.processing_dispositions WHERE document_id = ${id}`,
      ).toHaveLength(0);
      expect(
        await client`SELECT 1 FROM documents.idempotency_keys WHERE user_id = ${owner as string} AND response::text LIKE ${`%${fileName}%`}`,
      ).toHaveLength(0);
      const audits = await client<Array<{ action: string; metadata: unknown; traceId: string }>>`
        SELECT action, metadata, trace_id AS "traceId" FROM documents.audit_events
        WHERE document_id = ${id} AND action = 'resume.purged'`;
      expect(audits).toEqual([
        { action: "resume.purged", metadata: { version: 1 }, traceId: "resume-purge" },
      ]);
      expect(
        JSON.stringify(
          await client`SELECT metadata FROM documents.audit_events WHERE document_id = ${id}`,
        ),
      ).not.toContain(fileName);
      // the other candidate's tombstone and its entries are untouched
      expect(
        await client`SELECT 1 FROM documents.resume_documents WHERE id = ${otherId}`,
      ).toHaveLength(1);
      expect(
        await client`SELECT 1 FROM documents.processing_receipts WHERE document_id = ${otherId}`,
      ).toHaveLength(1);
      // repeating is a no-op
      expect(await completePurge(owner as string, id, true)).toEqual({
        purged: false,
        reason: "absent",
      });
      expect(
        await client`SELECT 1 FROM documents.audit_events WHERE document_id = ${id} AND action = 'resume.purged'`,
      ).toHaveLength(1);
    });
  });

  it("refuses to purge without the attestation, a live resume, another candidate's resume, or a held one still inside its evidence window", async () => {
    await withUsers(2, async ([owner, other]) => {
      const id = await tombstone(owner as string, "a.pdf");
      expect(await sqlCode(() => completePurge(owner as string, id, false))).toBe("55000");
      // owner-scoped: naming someone else's id finds nothing and changes nothing
      expect(await completePurge(other as string, id, true)).toEqual({
        purged: false,
        reason: "absent",
      });
      expect(await client`SELECT 1 FROM documents.resume_documents WHERE id = ${id}`).toHaveLength(
        1,
      );
      const held = await tombstone(owner as string, "held.pdf", { hold: true });
      expect(await sqlCode(() => completePurge(owner as string, held, true))).toBe("55000");
      expect(
        await client`SELECT 1 FROM documents.resume_documents WHERE id = ${held}`,
      ).toHaveLength(1);
      const expired = await tombstone(owner as string, "expired.pdf", {
        hold: true,
        deletedDaysAgo: 31,
      });
      expect(await completePurge(owner as string, expired, true)).toMatchObject({ purged: true });
      const live = await store.createResumeUpload(
        owner as string,
        purgeInput("live.pdf"),
        newKey(),
        "t-live",
      );
      expect(await sqlCode(() => completePurge(owner as string, live.document.id, true))).toBe(
        "55000",
      );
    });
  });

  it("orders a purge against an upload for the same candidate, and a new upload after it is unaffected", async () => {
    await withUsers(1, async ([owner]) => {
      const id = await tombstone(owner as string, "old.pdf");
      const [purge, upload] = await Promise.allSettled([
        completePurge(owner as string, id, true),
        store.createResumeUpload(owner as string, purgeInput("new.pdf"), newKey(), "t-new"),
      ]);
      expect(purge.status).toBe("fulfilled");
      expect(upload.status).toBe("fulfilled");
      expect(
        (await store.listResumeDocuments(owner as string)).documents.map(
          (document) => document.fileName,
        ),
      ).toEqual(["new.pdf"]);
    });
  });
});
