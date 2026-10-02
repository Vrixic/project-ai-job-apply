import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresCoverLetterStore } from "./cover-letter-store.js";
import {
  type CoverLetterWorkAuthorization,
  type CoverLetterWorkPurpose,
  PostgresCoverLetterWorkStore,
} from "./cover-letter-work-store.js";

const requested = process.env.COVER_LETTER_WORK_INTEGRATION === "1";
const databaseUrl = process.env.COVER_LETTER_WORK_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/work_ledger_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("CoverLetterWorkIntegrationTargetRejected");
}
const execute = promisify(execFile);

describe.skipIf(!requested)("Documents generation work authorization with real PostgreSQL", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("SyntheticUnexpectedObjectWrite");
    },
    read: async () => {
      throw Error("SyntheticUnexpectedObjectRead");
    },
  });
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  let ownerUserId: string;
  let documentId: string;
  let consentExpiresAt: Date;
  const requestSha256 = "a".repeat(64);

  beforeAll(async () => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      const args = [fileURLToPath(new URL(path, import.meta.url))];
      const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl } };
      const first = await execute(process.execPath, args, options);
      const replay = await execute(process.execPath, args, options);
      expect(replay.stdout).toBe(first.stdout);
    }
  }, 90_000);
  beforeEach(async () => {
    ownerUserId = uuidv7();
    documentId = uuidv7();
    consentExpiresAt = new Date(Date.now() + 15 * 60_000);
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
    // No actual effects exist in these ledger-only fixtures. Explicit synthetic settlement is
    // safe here; production must NOT replace positive external evidence with this test cleanup.
    const running = await sql<Array<{ id: string; purpose: CoverLetterWorkPurpose }>>`
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
  });

  async function issue(purpose: CoverLetterWorkPurpose = "private_slots") {
    return work.issue({ ownerUserId, documentId, purpose, requestSha256, consentExpiresAt });
  }
  async function seedExpired(purpose: CoverLetterWorkPurpose) {
    const id = uuidv7();
    await sql`INSERT INTO documents.cover_letter_work_authorizations
      (id, document_id, user_id, purpose, request_sha256, consent_expires_at, issued_at, expires_at)
      VALUES (${id}, ${documentId}, ${ownerUserId}, ${purpose}, ${requestSha256},
        ${consentExpiresAt.toISOString()}::timestamptz, clock_timestamp() - interval '2 minutes',
        clock_timestamp() - interval '1 minute')`;
    return { id, documentId, purpose, requestSha256 };
  }

  it("commits one original grant across concurrent issue requests", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => issue()));
    expect(results.filter((result) => result.kind === "issued")).toHaveLength(1);
    expect(new Set(results.map((result) => result.authorization.id)).size).toBe(1);
    const row = results[0]?.authorization as CoverLetterWorkAuthorization;
    expect(row.expiresAt.getTime() - row.issuedAt.getTime()).toBeLessThanOrEqual(90_000);
    expect(row.expiresAt.getTime()).toBeGreaterThan(row.issuedAt.getTime());
  });
  it("allows one claim across concurrent actor requests, never replay authority", async () => {
    const { authorization } = await issue();
    const results = await Promise.all(Array.from({ length: 12 }, () => work.claim(authorization)));
    expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
    expect(await work.claim(authorization)).toEqual({ kind: "unavailable" });
    expect((await issue()).authorization.state).toBe("running");
  });
  it("returns original timestamps/identity on replay without renewal", async () => {
    const first = await issue();
    const replay = await issue();
    expect(replay.kind).toBe("already_issued");
    expect(replay.authorization).toEqual(first.authorization);
  });
  it("refuses owner, request-hash and consent changes for an existing identity", async () => {
    await issue();
    const binding = {
      ownerUserId,
      documentId,
      purpose: "private_slots" as const,
      requestSha256,
      consentExpiresAt,
    };
    for (const changed of [
      { ownerUserId: uuidv7() },
      { requestSha256: "d".repeat(64) },
      { consentExpiresAt: new Date(consentExpiresAt.getTime() + 1) },
    ]) {
      await expect(work.issue({ ...binding, ...changed })).rejects.toThrow(
        "CoverLetterWorkUnavailable",
      );
    }
  });
  it("refuses unknown or mismatched claim references", async () => {
    const { authorization } = await issue();
    for (const changed of [
      { id: uuidv7() },
      { documentId: uuidv7() },
      { requestSha256: "d".repeat(64) },
      { purpose: "final_document" as const },
    ]) {
      await expect(work.claim({ ...authorization, ...changed })).rejects.toThrow(
        "CoverLetterWorkUnavailable",
      );
    }
    expect((await issue()).authorization.state).toBe("issued");
  });
  it("treats missing phase records as untracked, not complete drain", async () => {
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
    await issue();
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
    expect(await work.readDrainState(uuidv7(), documentId)).toBe("untracked");
  });
  it("requires all three phases terminal for ledger settlement", async () => {
    await issue("private_slots");
    await issue("provider_dispatch");
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
    expect(await work.revokeUnclaimed(ownerUserId, documentId)).toBe(3);
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("settled");
    expect(await work.revokeUnclaimed(ownerUserId, documentId)).toBe(0);
    const replay = await issue();
    expect(replay.authorization.state).toBe("revoked");
    expect(await work.claim(replay.authorization)).toEqual({ kind: "unavailable" });
  });
  it("never converts expired unclaimed authority into drain evidence or renewed admission", async () => {
    for (const purpose of ["private_slots", "provider_dispatch"] as const) {
      const ref = await seedExpired(purpose);
      expect(await work.claim(ref)).toEqual({ kind: "unavailable" });
      const replay = await issue(purpose);
      expect(replay.authorization.id).toBe(ref.id);
      expect(replay.authorization.expiresAt.getTime()).toBeLessThan(Date.now());
    }
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
    await expect(
      sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
    ).rejects.toThrow();
    await work.revokeUnclaimed(ownerUserId, documentId);
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("settled");
  });
  it("keeps running work pending beyond expiry until explicit positive settlement", async () => {
    consentExpiresAt = new Date(Date.now() + 3_000);
    await issue("private_slots");
    await issue("provider_dispatch");
    const provider = (await issue("provider_dispatch")).authorization;
    expect(await work.claim(provider)).toEqual({ kind: "claimed" });
    await work.revokeUnclaimed(ownerUserId, documentId);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, provider.expiresAt.getTime() - Date.now()) + 30),
    );
    expect(provider.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("pending");
    await work.recordSettled(provider);
    await work.recordSettled(provider);
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("settled");
    expect(await work.claim(provider)).toEqual({ kind: "unavailable" });
  });
  it("quarantine refuses new issuance/claims but permits drain of original work", async () => {
    const original = (await issue()).authorization;
    const provider = (await issue("provider_dispatch")).authorization;
    expect(await work.claim(provider)).toEqual({ kind: "claimed" });
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
    await expect(issue("final_document")).rejects.toThrow("CoverLetterWorkUnavailable");
    await expect(work.claim(original)).rejects.toThrow("CoverLetterWorkUnavailable");
    expect(await work.revokeUnclaimed(ownerUserId, documentId)).toBe(2);
    await work.recordSettled(provider);
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("settled");
  });
  it("blocks deletion of unclaimed and running records, even via document cascade", async () => {
    const row = (await issue()).authorization;
    await expect(
      sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
    ).rejects.toThrow();
    expect(await work.claim(row)).toEqual({ kind: "claimed" });
    await expect(
      sql`DELETE FROM documents.cover_letter_work_authorizations WHERE id = ${row.id}`,
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
    ).rejects.toThrow();
    await work.recordSettled(row);
    await expect(
      sql`DELETE FROM documents.cover_letter_work_authorizations WHERE id = ${row.id}`,
    ).rejects.toThrow();
    await sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`;
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
  });
  it("protects deadline/binding and irreversible terminal state at SQL boundary", async () => {
    const row = (await issue()).authorization;
    await expect(sql`UPDATE documents.cover_letter_work_authorizations
      SET expires_at = expires_at + interval '1 second' WHERE id = ${row.id}`).rejects.toThrow();
    await expect(sql`UPDATE documents.cover_letter_work_authorizations
      SET request_sha256 = ${"d".repeat(64)} WHERE id = ${row.id}`).rejects.toThrow();
    await expect(work.recordSettled(row)).rejects.toThrow("CoverLetterWorkUnavailable");
    await work.revokeUnclaimed(ownerUserId, documentId);
    await expect(sql`UPDATE documents.cover_letter_work_authorizations
      SET state = 'issued', terminal_at = NULL WHERE id = ${row.id}`).rejects.toThrow();
  });
  it("serializes inconsistent cross-phase grants so only one request binding can win", async () => {
    const results = await Promise.allSettled([
      issue("private_slots"),
      work.issue({
        ownerUserId,
        documentId,
        purpose: "provider_dispatch",
        requestSha256: "d".repeat(64),
        consentExpiresAt,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("SQL admission also refuses expired and quarantined claims", async () => {
    const ref = await seedExpired("private_slots");
    await expect(sql`UPDATE documents.cover_letter_work_authorizations
      SET state = 'running', started_at = issued_at + interval '1 second'
      WHERE id = ${ref.id}`).rejects.toThrow();
    const fresh = (await issue("provider_dispatch")).authorization;
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
    await expect(sql`UPDATE documents.cover_letter_work_authorizations
      SET state = 'running', started_at = clock_timestamp() WHERE id = ${fresh.id}`).rejects.toThrow();
  });
  it("claim and revocation have one atomic winner, never a revoked running actor", async () => {
    const ref = (await issue()).authorization;
    const [claimed, revoked] = await Promise.all([
      work.claim(ref),
      work.revokeUnclaimed(ownerUserId, documentId),
    ]);
    const replay = (await issue()).authorization;
    if (claimed.kind === "claimed") {
      expect(revoked).toBe(2);
      expect(replay.state).toBe("running");
    } else {
      expect(revoked).toBe(3);
      expect(replay.state).toBe("revoked");
    }
  });
  it("refuses fresh expired-consent issuance without a persisted grant", async () => {
    consentExpiresAt = new Date(Date.now() - 1_000);
    await expect(issue()).rejects.toThrow("CoverLetterWorkUnavailable");
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
  });
  it("permits only original settled-provider finalization after consent expiry, without new dispatch", async () => {
    await expect(issue("final_document")).rejects.toThrow("CoverLetterWorkUnavailable");
    consentExpiresAt = new Date(Date.now() + 3_000);
    const provider = (await issue("provider_dispatch")).authorization;
    await expect(issue("final_document")).rejects.toThrow("CoverLetterWorkUnavailable");
    await work.claim(provider);
    await work.recordSettled(provider);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, consentExpiresAt.getTime() - Date.now()) + 30),
    );
    const final = (await issue("final_document")).authorization;
    expect(final.expiresAt.getTime()).toBeGreaterThan(consentExpiresAt.getTime());
    expect(await work.claim(final)).toEqual({ kind: "claimed" });
    expect(await work.claim(provider)).toEqual({ kind: "unavailable" });
  });
});
