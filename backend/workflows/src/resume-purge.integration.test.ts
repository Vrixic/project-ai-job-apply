import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDatabase, PostgresResumeProposalWriter } from "@ai-job-apply/profile-service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CandidateRightsActivityDependencies,
  PostgresCandidateRightsActivityStore,
} from "./candidate-rights-activities.js";

// End to end on real PostgreSQL: the sweep, the Documents functions, and Profile's proposal retirement together (ADR-034).
const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("resume purge sweep against PostgreSQL", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const client = database.client;
  const writer = new PostgresResumeProposalWriter();
  const removed: string[] = [];
  let remainingByDocument: Record<string, number> = {};

  const store = new PostgresCandidateRightsActivityStore({
    database,
    policy: {
      ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing", "trust"],
      subprocessorInventory: [],
    },
    artifactStore: {},
    documentObjectStore: {
      async deleteAllVersionsAndMarkers() {
        return { exactInventoryEmpty: true };
      },
      async purgeDocumentPrefixes(documentId: string) {
        removed.push(documentId);
        return { deleted: 2, remaining: remainingByDocument[documentId] ?? 0 };
      },
    },
    resumeProposals: writer,
    identityProvider: {},
    subprocessors: [],
    recoveryLedger: {},
  } as unknown as CandidateRightsActivityDependencies);

  beforeAll(async () => {
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    for (const path of [
      "../../services/profile/dist/src/migrate.js",
      "../../services/documents/dist/src/migrate.js",
    ]) {
      await execFileAsync(process.execPath, [fileURLToPath(new URL(path, import.meta.url))], {
        env: environment,
      });
    }
  });

  afterAll(async () => {
    await client.end();
  });

  async function candidate() {
    const userId = crypto.randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    return userId;
  }

  async function resume(
    userId: string,
    options: { deleted: boolean; hold?: boolean; fileName: string },
  ) {
    const id = crypto.randomUUID();
    await client`
      INSERT INTO documents.resume_documents (
        id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status, failure_code
      ) VALUES (${id}, ${userId}, ${options.fileName}, 'application/pdf', 100, ${"c".repeat(64)},
                ${`quarantine/${id}/source`}, 'failed', 'scan_failed')`;
    await client`UPDATE documents.resume_documents SET security_hold = ${options.hold ?? false} WHERE id = ${id}`;
    const response = JSON.stringify({ document: { id, fileName: options.fileName } });
    await client`
      INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
      VALUES (${userId}, 'documents.resume-upload.create.v1', ${`resume-upload-${id}`}, ${"d".repeat(64)}, ${response}::text::jsonb)`;
    if (options.deleted) {
      await client`UPDATE documents.resume_documents SET deleted_at = now() WHERE id = ${id}`;
    }
    return id;
  }

  async function proposal(userId: string, documentId: string, value: string) {
    await client.begin((transaction) =>
      writer.importDrafts(transaction, {
        userId,
        documentId,
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        traceId: "purge-e2e",
        drafts: [{ section: "skill", values: { name: value } }],
      }),
    );
  }

  const exists = async (table: string, id: string) =>
    (
      await client.unsafe(
        `SELECT 1 FROM ${table} WHERE ${table.startsWith("profile") ? "document_id" : "id"} = '${id}'`,
      )
    ).length > 0;

  it("purges a deleted resume end to end and leaves live resumes, other candidates, and held tombstones alone", async () => {
    remainingByDocument = {};
    removed.length = 0;
    const owner = await candidate();
    const other = await candidate();
    const fileName = `purge-e2e-${crypto.randomUUID()}.pdf`;
    const deleted = await resume(owner, { deleted: true, fileName });
    const live = await resume(other, { deleted: false, fileName: "live.pdf" });
    const held = await resume(other, { deleted: true, hold: true, fileName: "held.pdf" });
    await proposal(owner, deleted, "Erase me");
    await proposal(other, live, "Keep me");

    const result = await store.purgeDeletedResumes(100);

    expect(result.failed).toBe(0);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(result.heldWaiting).toBeGreaterThanOrEqual(1);
    expect(removed).toContain(deleted);
    expect(removed).not.toContain(live);
    expect(removed).not.toContain(held);
    expect(await exists("documents.resume_documents", deleted)).toBe(false);
    expect(await exists("documents.resume_documents", live)).toBe(true);
    expect(await exists("documents.resume_documents", held)).toBe(true);
    expect(
      await client`SELECT 1 FROM documents.idempotency_keys WHERE user_id = ${owner} AND response::text LIKE ${`%${fileName}%`}`,
    ).toHaveLength(0);
    expect(await exists("profile.resume_imports", deleted)).toBe(false);
    expect(await exists("profile.resume_imports", live)).toBe(true);
    expect(await client`SELECT 1 FROM profile.import_drafts WHERE user_id = ${owner}`).toHaveLength(
      0,
    );
    expect(await client`SELECT 1 FROM profile.import_drafts WHERE user_id = ${other}`).toHaveLength(
      1,
    );
    expect(
      await client`SELECT 1 FROM documents.audit_events WHERE document_id = ${deleted} AND action = 'resume.purged'`,
    ).toHaveLength(1);

    // a second sweep finds nothing left for it to do for this candidate
    removed.length = 0;
    await store.purgeDeletedResumes(100);
    expect(removed).not.toContain(deleted);
  });

  it("leaves the database untouched when objects remain, and finishes on the next sweep", async () => {
    const owner = await candidate();
    const id = await resume(owner, { deleted: true, fileName: "stubborn.pdf" });
    remainingByDocument = { [id]: 1 };
    const failing = await store.purgeDeletedResumes(100);
    expect(failing.failed).toBeGreaterThanOrEqual(1);
    expect(await exists("documents.resume_documents", id)).toBe(true);
    expect(
      await client`SELECT 1 FROM documents.audit_events WHERE document_id = ${id} AND action = 'resume.purged'`,
    ).toHaveLength(0);

    remainingByDocument = {};
    const recovered = await store.purgeDeletedResumes(100);
    expect(recovered.failed).toBe(0);
    expect(await exists("documents.resume_documents", id)).toBe(false);
  });
});
