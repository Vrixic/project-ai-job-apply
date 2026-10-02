import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ModelGateway } from "@ai-job-apply/ai-sdk";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { createCoverLetterIsolatedProviderHandler } from "./cover-letter-provider-handler.js";
import type { CoverLetterProviderTransitionObjects } from "./cover-letter-provider-objects.js";
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
  let requestSha256 = "a".repeat(64);

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
    requestSha256 = "a".repeat(64);
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

  const providerBinding = () => ({ documentId, requestSha256, consentExpiresAt });
  it("provider admission never creates authority or consumes a private-slot grant", async () => {
    expect(await work.claimProviderDispatch(providerBinding())).toEqual({ kind: "unavailable" });
    await issue("private_slots");
    expect(await work.claimProviderDispatch(providerBinding())).toEqual({ kind: "unavailable" });
    const rows =
      await sql`SELECT purpose, state FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId}`;
    expect(rows).toEqual([{ purpose: "private_slots", state: "issued" }]);
  });
  it("provider admission has one concurrent winner and cannot renew its original grant", async () => {
    const original = (await issue("provider_dispatch")).authorization;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => work.claimProviderDispatch(providerBinding())),
    );
    expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
    const winner = results.find((result) => result.kind === "claimed");
    expect(winner).toEqual({
      kind: "claimed",
      reference: {
        id: original.id,
        documentId,
        purpose: "provider_dispatch",
        requestSha256,
      },
    });
    expect(await work.claimProviderDispatch(providerBinding())).toEqual({ kind: "unavailable" });
    const replay = (await issue("provider_dispatch")).authorization;
    expect(replay).toMatchObject({
      id: original.id,
      issuedAt: original.issuedAt,
      expiresAt: original.expiresAt,
      state: "running",
    });
  });
  it("provider admission rejects a different document, request or consent without consuming the original", async () => {
    await issue("provider_dispatch");
    for (const changed of [
      { documentId: uuidv7() },
      { requestSha256: "f".repeat(64) },
      { consentExpiresAt: new Date(consentExpiresAt.getTime() + 1) },
    ])
      expect(await work.claimProviderDispatch({ ...providerBinding(), ...changed })).toEqual({
        kind: "unavailable",
      });
    expect((await work.claimProviderDispatch(providerBinding())).kind).toBe("claimed");
  });
  it.each(["expired", "revoked", "quarantined"])(
    "provider admission cannot bypass %s authority",
    async (state) => {
      if (state === "expired") await seedExpired("provider_dispatch");
      else await issue("provider_dispatch");
      if (state === "revoked") await work.revokeUnclaimed(ownerUserId, documentId);
      if (state === "quarantined") {
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
        await expect(work.claimProviderDispatch(providerBinding())).rejects.toThrow(
          "CoverLetterWorkUnavailable",
        );
      } else
        expect(await work.claimProviderDispatch(providerBinding())).toEqual({
          kind: "unavailable",
        });
      const rows =
        await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId}`;
      expect(rows.some((row) => row.state === "running")).toBe(false);
    },
  );

  it.each(["none", "control_ack", "dispatch_ack", "result_ack", "settlement_ack", "model_timeout"])(
    "connects isolated provider effects to SQL authority, retaining ambiguous %s work",
    async (failure) => {
      // Real control transactions, but all object/model transports are in-memory synthetic fakes.
      const request = encodeCoverLetterProviderObject("request", {
        schemaVersion: 1,
        documentId,
        noticeVersion: "openai-cover-letter.v1",
        promptVersion: "1.0.0",
        jobContextHash: "b".repeat(64),
        confirmedFactsHash: "c".repeat(64),
        approvedAt: new Date(consentExpiresAt.getTime() - 15 * 60_000).toISOString(),
        expiresAt: consentExpiresAt.toISOString(),
        system: "Synthetic grounded rules",
        user: "Synthetic TypeScript fact",
        maxOutputChars: 8_000,
      });
      requestSha256 = coverLetterProviderSha256(request);
      await issue("provider_dispatch");
      const binding = { schemaVersion: 1, documentId, requestSha256 };
      const slots = new Map<CoverLetterProviderSlot, Uint8Array>([
        ["request", request],
        ["dispatch", encodeCoverLetterProviderObject("dispatch", { ...binding, state: "issued" })],
        ["result", encodeCoverLetterProviderObject("result", { ...binding, state: "pending" })],
      ]);
      const reference = (bytes: Uint8Array) => ({
        objectVersion: "synthetic-version",
        etag: `"${coverLetterProviderSha256(bytes)}"`,
        sha256: coverLetterProviderSha256(bytes),
        sizeBytes: bytes.length,
      });
      const phaseState = async () => {
        const [row] = await sql`SELECT state FROM documents.cover_letter_work_authorizations
          WHERE document_id = ${documentId} AND purpose = 'provider_dispatch'`;
        return row?.state;
      };
      const transition = vi.fn<CoverLetterProviderTransitionObjects["transitionIfMatch"]>(
        async (_id, slot, prior, bytes) => {
          expect(await phaseState()).toBe("running");
          const old = slots.get(slot);
          if (!old || reference(old).etag !== prior.etag) return { changed: false };
          slots.set(slot, Uint8Array.from(bytes));
          if (failure === `${slot}_ack`) throw Error("Synthetic lost write acknowledgement");
          return { changed: true, reference: reference(bytes) };
        },
      );
      let releaseModel: (value: { text: string }) => void = () => undefined;
      const pendingModel = new Promise<{ text: string }>((resolve) => {
        releaseModel = resolve;
      });
      const text = JSON.stringify({
        paragraphs: [{ text: "Synthetic TypeScript experience.", factIds: [documentId] }],
      });
      const complete = vi.fn(async () => {
        expect(await phaseState()).toBe("running");
        return failure === "model_timeout" ? pendingModel : { text };
      });
      const claim = vi.fn(
        async (input: Parameters<PostgresCoverLetterWorkStore["claimProviderDispatch"]>[0]) => {
          const result = await work.claimProviderDispatch(input);
          if (failure === "control_ack") throw Error("Synthetic lost control acknowledgement");
          return result;
        },
      );
      const settle = vi.fn(
        async (ref: Parameters<PostgresCoverLetterWorkStore["settleProviderDispatch"]>[0]) => {
          await work.settleProviderDispatch(ref);
          if (failure === "settlement_ack")
            throw Error("Synthetic lost settlement acknowledgement");
        },
      );
      const handler = createCoverLetterIsolatedProviderHandler({
        enabled: () => true,
        timeoutMs: failure === "model_timeout" ? 200 : 60_000,
        gateway: new ModelGateway(
          { identity: COVER_LETTER_PROVIDER_MODEL, complete },
          { enabled: () => true, timeoutMs: 1_000 },
        ),
        work: { claimProviderDispatch: claim, settleProviderDispatch: settle },
        objects: {
          transitionIfMatch: transition,
          find: async (_id, slot) => {
            const bytes = slots.get(slot);
            return bytes ? reference(bytes) : undefined;
          },
          read: async (_id, slot) => {
            const bytes = slots.get(slot);
            if (!bytes) throw Error("Synthetic missing slot");
            return Uint8Array.from(bytes);
          },
        },
      });
      const input = { schemaVersion: 1 as const, documentId, request: reference(request) };
      expect((await handler(input)).outcome).toBe(failure === "none" ? "ready" : "in_progress");
      if (failure === "model_timeout") {
        releaseModel({ text });
        await pendingModel;
      }
      const readyReplay = ["none", "result_ack", "settlement_ack"].includes(failure);
      expect((await handler(input)).outcome).toBe(readyReplay ? "ready" : "in_progress");
      expect(complete).toHaveBeenCalledTimes(
        ["control_ack", "dispatch_ack"].includes(failure) ? 0 : 1,
      );
      expect(transition).toHaveBeenCalledTimes(
        failure === "control_ack" ? 0 : ["dispatch_ack", "model_timeout"].includes(failure) ? 1 : 2,
      );
      expect(settle).toHaveBeenCalledTimes(["none", "settlement_ack"].includes(failure) ? 1 : 0);
      const settled = ["none", "settlement_ack"].includes(failure);
      expect(await phaseState()).toBe(settled ? "settled" : "running");
      await work.revokeUnclaimed(ownerUserId, documentId);
      expect(await work.readDrainState(ownerUserId, documentId)).toBe(
        settled ? "settled" : "pending",
      );
      if (!settled)
        await expect(
          sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
        ).rejects.toMatchObject({ code: "55000" });
    },
  );

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
