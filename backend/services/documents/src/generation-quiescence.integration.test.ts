import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresCoverLetterStore } from "./cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import {
  createNativeGenerationQuiescenceProof,
  GenerationQuiescenceProof,
  PostgresGenerationQuiescenceReader,
} from "./generation-quiescence.js";

const requested = process.env.GENERATION_QUIESCENCE_INTEGRATION === "1";
const databaseUrl = process.env.GENERATION_QUIESCENCE_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/quiescence_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("GenerationQuiescenceIntegrationTargetRejected");
}
const execute = promisify(execFile);

describe.skipIf(!requested)("Generation quiescence proof with real PostgreSQL", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 2, onnotice: () => undefined });
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("SyntheticUnexpectedObjectWrite");
    },
    read: async () => {
      throw Error("SyntheticUnexpectedObjectRead");
    },
  });
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  const native = requested ? createNativeGenerationQuiescenceProof(databaseUrl as string) : null;
  const proof = new GenerationQuiescenceProof(new PostgresGenerationQuiescenceReader(sql));
  const signal = () => new AbortController().signal;
  let ownerUserId: string;
  let documentId: string;
  const requestSha256 = "a".repeat(64);

  beforeAll(async () => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      const args = [fileURLToPath(new URL(path, import.meta.url))];
      await execute(process.execPath, args, {
        env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl },
      });
    }
  }, 90_000);
  beforeEach(async () => {
    ownerUserId = uuidv7();
    documentId = uuidv7();
    await sql`INSERT INTO identity.users (id) VALUES (${ownerUserId})`;
    await documents.reserve({
      id: documentId,
      ownerUserId,
      applicationId: uuidv7(),
      jobRevision: "b".repeat(64),
      confirmedFactsHash: "c".repeat(64),
    });
  });
  afterEach(async () => {
    // Ledger-only synthetic fixtures: settle any running claim so the fixture can be removed.
    const running = await sql<
      Array<{ id: string; purpose: "private_slots" | "provider_dispatch" }>
    >`
      SELECT id, purpose FROM documents.cover_letter_work_authorizations
      WHERE user_id = ${ownerUserId} AND state = 'running'`;
    for (const row of running) await work.recordSettled({ ...row, documentId, requestSha256 });
    await work.revokeUnclaimed(ownerUserId, documentId);
    await sql`DELETE FROM documents.audit_events WHERE user_id = ${ownerUserId}`;
    await sql`DELETE FROM documents.cover_letters WHERE user_id = ${ownerUserId}`;
    await sql`DELETE FROM identity.users WHERE id = ${ownerUserId}`;
  });
  afterAll(async () => {
    await sql.end();
    await native?.close();
  });

  const quarantine = () =>
    sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
  async function claimedDispatch() {
    const authorization = (
      await work.issue({
        ownerUserId,
        documentId,
        purpose: "provider_dispatch",
        requestSha256,
        consentExpiresAt: new Date(Date.now() + 15 * 60_000),
      })
    ).authorization;
    const reference = {
      id: authorization.id,
      documentId,
      purpose: "provider_dispatch" as const,
      requestSha256,
    };
    expect((await work.claim(reference)).kind).toBe("claimed");
    return reference;
  }

  it("refuses an active owner even with no work, then confirms once quarantined", async () => {
    expect(await proof.confirm(documentId, signal())).toBe(false);
    await quarantine();
    expect(await proof.confirm(documentId, signal())).toBe(true);
    expect(await native?.proof.confirm(documentId, signal())).toBe(true);
  });

  it("refuses a claimed original writer until it settles", async () => {
    const reference = await claimedDispatch();
    await quarantine();
    expect(await proof.confirm(documentId, signal())).toBe(false);
    await work.recordSettled(reference);
    expect(await proof.confirm(documentId, signal())).toBe(true);
  });

  it("refuses an undisposed provider response and confirms after disposal is acknowledged", async () => {
    const reference = await claimedDispatch();
    await sql`INSERT INTO documents.cover_letter_provider_responses (work_id, document_id, user_id, request_sha256)
      VALUES (${reference.id}, ${documentId}, ${ownerUserId}, ${requestSha256})`;
    await work.recordSettled(reference);
    await quarantine();
    expect(await proof.confirm(documentId, signal())).toBe(false);
    await sql`UPDATE documents.cover_letter_provider_responses
      SET state = 'acknowledged', response_id = 'resp_integration1', response_created_at = 1,
        acknowledged_at = clock_timestamp() WHERE work_id = ${reference.id}`;
    expect(await proof.confirm(documentId, signal())).toBe(false);
    await sql`UPDATE documents.cover_letter_provider_responses
      SET state = 'disposed', disposed_at = clock_timestamp(), terminal_status = 'completed'
      WHERE work_id = ${reference.id}`;
    expect(await proof.confirm(documentId, signal())).toBe(true);
  });

  it("relies on a database refusal to claim issued work once the owner is quarantined", async () => {
    const authorization = (
      await work.issue({
        ownerUserId,
        documentId,
        purpose: "provider_dispatch",
        requestSha256,
        consentExpiresAt: new Date(Date.now() + 15 * 60_000),
      })
    ).authorization;
    await quarantine();
    // The proof treats an unclaimed issued authorization as unstartable; prove the database agrees.
    await expect(
      work.claim({
        id: authorization.id,
        documentId,
        purpose: "provider_dispatch",
        requestSha256,
      }),
    ).rejects.toThrow("CoverLetterWorkUnavailable");
    expect(await proof.confirm(documentId, signal())).toBe(true);
  });

  it("is confirmed for a document with no cover-letter row and no ledger evidence", async () => {
    expect(await proof.confirm(uuidv7(), signal())).toBe(true);
  });
});
