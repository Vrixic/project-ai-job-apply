import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ModelGateway } from "@ai-job-apply/ai-sdk";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoverLetterIntegrityError,
  createCoverLetterDocument,
  encodeCoverLetterDocument,
} from "./cover-letter.js";
import { createCoverLetterCleanupHandler } from "./cover-letter-cleanup-handler.js";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { createCoverLetterIsolatedProviderHandler } from "./cover-letter-provider-handler.js";
import type { CoverLetterProviderTransitionObjects } from "./cover-letter-provider-objects.js";
import { type CoverLetterMetadata, PostgresCoverLetterStore } from "./cover-letter-store.js";
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
  // Independently committed controls must not wait on a connection held by completion leases.
  const finalControl = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const finalWork = new PostgresCoverLetterWorkStore(finalControl, () => true);
  let reserved: CoverLetterMetadata;
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
    reserved = await documents.reserve({
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
    await finalControl.end();
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

  const cleanupArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-cleanup:7";
  const cleanup = createCoverLetterCleanupHandler({
    functionArn: cleanupArn,
    work,
    enabled: () => true,
  });
  const cleanupReference = (authorization: CoverLetterWorkAuthorization) => ({
    id: authorization.id,
    documentId: authorization.documentId,
    purpose: authorization.purpose,
    requestSha256: authorization.requestSha256,
  });
  async function cleanupRequest(reference: ReturnType<typeof cleanupReference>) {
    return cleanup(
      { schemaVersion: 1, action: "fence", documentId: reference.documentId, reference },
      { invokedFunctionArn: cleanupArn },
    );
  }
  it.each(["private_slots", "provider_dispatch", "final_document"] as const)(
    "private cleanup permanently fences abandoned unclaimed %s authority",
    async (purpose) => {
      if (purpose === "final_document") await settledProvider();
      const original = (await issue(purpose)).authorization;
      const reference = cleanupReference(original);
      expect((await cleanupRequest(reference)).outcome).toBe("ledger_terminal");
      expect((await cleanupRequest(reference)).outcome).toBe("ledger_terminal");
      for (const phase of ["private_slots", "provider_dispatch", "final_document"] as const) {
        const replay = (await issue(phase)).authorization;
        expect(replay.state === "revoked" || replay.state === "settled").toBe(true);
        expect(await work.claim(replay)).toEqual({ kind: "unavailable" });
      }
      const replay = (await issue(purpose)).authorization;
      expect(replay.id).toBe(original.id);
      expect(replay.expiresAt).toEqual(original.expiresAt);
      expect(
        await sql`SELECT id FROM documents.cover_letters WHERE id = ${documentId}`,
      ).toHaveLength(1);
    },
  );
  it.each(["private_slots", "provider_dispatch", "final_document"] as const)(
    "private cleanup retains running %s work and reservation inventory",
    async (purpose) => {
      if (purpose === "final_document") await settledProvider();
      const original = (await issue(purpose)).authorization;
      await work.claim(original);
      const reference = cleanupReference(original);
      expect((await cleanupRequest(reference)).outcome).toBe("pending");
      expect((await cleanupRequest(reference)).outcome).toBe("pending");
      const replay = (await issue(purpose)).authorization;
      expect(replay.state).toBe("running");
      expect(replay.terminalAt).toBeNull();
      expect(replay.id).toBe(original.id);
      await expect(
        sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
      ).rejects.toThrow();
      expect(
        await sql`SELECT id FROM documents.cover_letters WHERE id = ${documentId}`,
      ).toHaveLength(1);
    },
  );
  it.each(["active", "quarantined"])(
    "cleanup with an %s candidate never grants finalization after late provider settlement",
    async (state) => {
      await settledSlots();
      const provider = (await issue("provider_dispatch")).authorization;
      await work.claim(provider);
      if (state === "quarantined")
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
      const reference = cleanupReference(provider);
      expect((await cleanupRequest(reference)).outcome).toBe("pending");
      // Synthetic positive completion of original work, not timeout/cleanup settlement.
      await work.settleProviderDispatch(reference);
      expect((await cleanupRequest(reference)).outcome).toBe("ledger_terminal");
      if (state === "quarantined")
        await expect(work.claimFinalDocument({ ownerUserId, documentId })).rejects.toThrow(
          /^CoverLetterWorkUnavailable$/u,
        );
      else
        expect(await work.claimFinalDocument({ ownerUserId, documentId })).toEqual({
          kind: "unavailable",
        });
      const rows = await sql`SELECT state FROM documents.cover_letter_work_authorizations
      WHERE document_id = ${documentId} AND purpose = 'final_document'`;
      expect(rows).toEqual([{ state: "revoked" }]);
    },
  );
  it("cleanup revokes expired unclaimed admission without renewing it", async () => {
    const expired = await seedExpired("private_slots");
    expect((await cleanupRequest(expired)).outcome).toBe("ledger_terminal");
    const replay = (await issue()).authorization;
    expect(replay.id).toBe(expired.id);
    expect(replay.state).toBe("revoked");
    expect(replay.expiresAt.getTime()).toBeLessThan(Date.now());
  });
  it.each(["id", "documentId", "purpose", "requestSha256"] as const)(
    "cleanup refuses a changed %s without modifying the original grant",
    async (field) => {
      const original = (await issue()).authorization;
      const reference = cleanupReference(original);
      if (field === "purpose") reference.purpose = "provider_dispatch";
      else if (field === "requestSha256") reference.requestSha256 = "f".repeat(64);
      else reference[field] = uuidv7();
      expect((await cleanupRequest(reference)).outcome).toBe("unavailable");
      expect((await issue()).authorization).toEqual(original);
      expect(
        await sql`SELECT id FROM documents.cover_letter_work_authorizations
        WHERE document_id = ${documentId}`,
      ).toHaveLength(1);
    },
  );
  it("cleanup never retroactively tracks an unknown reservation", async () => {
    const reference = {
      id: uuidv7(),
      documentId,
      purpose: "private_slots" as const,
      requestSha256,
    };
    expect((await cleanupRequest(reference)).outcome).toBe("unavailable");
    expect(await work.readDrainState(ownerUserId, documentId)).toBe("untracked");
    expect(
      await sql`SELECT id FROM documents.cover_letter_work_authorizations
      WHERE document_id = ${documentId}`,
    ).toHaveLength(0);
  });
  it("lost cleanup acknowledgement replays the committed fence without renewing authority", async () => {
    const original = (await issue()).authorization;
    const reference = cleanupReference(original);
    const lostAck = createCoverLetterCleanupHandler({
      functionArn: cleanupArn,
      enabled: () => true,
      work: {
        fenceForCleanup: async (ref) => {
          await work.fenceForCleanup(ref);
          throw Error("SyntheticLostCleanupAcknowledgement");
        },
      },
    });
    expect(
      (
        await lostAck(
          { schemaVersion: 1, action: "fence", documentId, reference },
          { invokedFunctionArn: cleanupArn },
        )
      ).outcome,
    ).toBe("unavailable");
    const fenced = (await issue()).authorization;
    expect(fenced.state).toBe("revoked");
    expect(fenced.id).toBe(original.id);
    expect(fenced.expiresAt).toEqual(original.expiresAt);
    expect((await cleanupRequest(reference)).outcome).toBe("ledger_terminal");
    expect((await issue()).authorization).toEqual(fenced);
  });
  it("concurrent cleanup and original claim leave either revoked or unresolved running work, never fresh authority", async () => {
    const original = (await issue()).authorization;
    const reference = cleanupReference(original);
    const [fenced, claimed] = await Promise.all([cleanupRequest(reference), work.claim(reference)]);
    const replay = (await issue()).authorization;
    expect(replay.id).toBe(original.id);
    expect(replay.state).toBe(claimed.kind === "claimed" ? "running" : "revoked");
    expect(fenced.outcome).toBe(claimed.kind === "claimed" ? "pending" : "ledger_terminal");
    expect(await work.claim(reference)).toEqual({ kind: "unavailable" });
    const rows = await sql`SELECT state FROM documents.cover_letter_work_authorizations
      WHERE document_id = ${documentId} AND purpose <> 'private_slots'`;
    expect(rows).toEqual([{ state: "revoked" }, { state: "revoked" }]);
  });

  const providerBinding = () => ({ documentId, requestSha256, consentExpiresAt });

  const privateProviderBinding = () => ({ ownerUserId, ...providerBinding() });
  async function settledSlots() {
    const slots = (await issue("private_slots")).authorization;
    expect((await work.claim(slots)).kind).toBe("claimed");
    await work.recordSettled(slots);
    return slots;
  }

  it.each(["missing", "issued", "running", "revoked"])(
    "refuses private provider issuance while original slots are %s",
    async (state) => {
      if (state !== "missing") {
        const slots = (await issue()).authorization;
        if (state === "running") await work.claim(slots);
        if (state === "revoked") await work.revokeUnclaimed(ownerUserId, documentId);
      }
      await expect(work.issueProviderDispatch(privateProviderBinding())).rejects.toThrow(
        /^CoverLetterWorkUnavailable$/u,
      );
      const rows = await sql`SELECT state FROM documents.cover_letter_work_authorizations
        WHERE document_id = ${documentId} AND purpose = 'provider_dispatch'`;
      expect(rows).toEqual(state === "revoked" ? [{ state: "revoked" }] : []);
    },
  );
  it("allows one private Invoke grant across concurrent issuance, preserving original binding and timestamps", async () => {
    await settledSlots();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => work.issueProviderDispatch(privateProviderBinding())),
    );
    expect(results.filter((result) => result.kind === "issued")).toHaveLength(1);
    const original = (await issue("provider_dispatch")).authorization;
    expect(results.find((result) => result.kind === "issued")).toEqual({
      kind: "issued",
      reference: {
        id: original.id,
        documentId,
        purpose: "provider_dispatch",
        requestSha256,
      },
    });
    expect(await work.issueProviderDispatch(privateProviderBinding())).toEqual({
      kind: "unavailable",
    });
    expect((await issue("provider_dispatch")).authorization).toEqual(original);
    expect((await work.claimProviderDispatch(providerBinding())).kind).toBe("claimed");
    expect(await work.issueProviderDispatch(privateProviderBinding())).toEqual({
      kind: "unavailable",
    });
    await work.settleProviderDispatch(original);
    expect(await work.issueProviderDispatch(privateProviderBinding())).toEqual({
      kind: "unavailable",
    });
  });
  it.each(["owner", "document", "hash", "consent", "quarantine", "cancel"])(
    "refuses private provider issuance with %s mismatch/fence",
    async (kind) => {
      await settledSlots();
      const binding = privateProviderBinding();
      if (kind === "owner") binding.ownerUserId = uuidv7();
      if (kind === "document") binding.documentId = uuidv7();
      if (kind === "hash") binding.requestSha256 = "f".repeat(64);
      if (kind === "consent") binding.consentExpiresAt = new Date(consentExpiresAt.getTime() + 1);
      if (kind === "quarantine")
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
      if (kind === "cancel") await work.revokeUnclaimed(ownerUserId, documentId);
      if (kind === "cancel")
        expect(await work.issueProviderDispatch(binding)).toEqual({ kind: "unavailable" });
      else
        await expect(work.issueProviderDispatch(binding)).rejects.toThrow(
          /^CoverLetterWorkUnavailable$/u,
        );
      const rows = await sql`SELECT state FROM documents.cover_letter_work_authorizations
        WHERE document_id = ${documentId} AND purpose = 'provider_dispatch'`;
      expect(rows).toEqual(kind === "cancel" ? [{ state: "revoked" }] : []);
    },
  );

  async function settledProvider() {
    const provider = (await issue("provider_dispatch")).authorization;
    expect((await work.claim(provider)).kind).toBe("claimed");
    await work.recordSettled(provider);
    return provider;
  }
  function finalFixture(
    fault?:
      | "put_ack"
      | "read"
      | "conflict"
      | "claim_ack"
      | "settle_ack"
      | "settle_failure"
      | "sql_rollback",
  ) {
    const factId = uuidv7();
    const document = createCoverLetterDocument(
      reserved,
      {
        status: "needs_review",
        purpose: "cover_letter",
        reviewRequired: true,
        paragraphs: [{ text: "I build reliable synthetic systems.", factIds: [factId] }],
        sourceFactIds: [factId],
        findings: [],
        confidence: 0.9,
        promptVersion: "cover_letter.v1",
        model: COVER_LETTER_PROVIDER_MODEL,
      },
      reserved.createdAt,
    );
    let bytes: Uint8Array | undefined =
      fault === "conflict" ? encodeCoverLetterDocument(document) : undefined;
    let firstRead = true;
    const state = async () => {
      const rows = await finalControl<
        Array<{ state: string }>
      >`SELECT state FROM documents.cover_letter_work_authorizations
        WHERE document_id = ${documentId} AND purpose = 'final_document'`;
      return rows[0]?.state;
    };
    const put = vi.fn(async (input: { bytes: Uint8Array }) => {
      expect(await state()).toBe("running");
      bytes = Uint8Array.from(input.bytes);
      if (fault === "put_ack") throw Error("SyntheticLostPutAck");
      return { objectVersion: "synthetic-final-v1", created: fault !== "conflict" };
    });
    const find = vi.fn(async () => (bytes ? { objectVersion: "synthetic-final-v1" } : null));
    const read = vi.fn(async (input: { objectVersion: string }) => {
      expect(input.objectVersion).toBe("synthetic-final-v1");
      if (!bytes) throw new CoverLetterIntegrityError();
      if (fault === "read" && firstRead) {
        firstRead = false;
        return new Uint8Array(bytes.length);
      }
      return Uint8Array.from(bytes);
    });
    const claim = vi.fn(async (binding: { ownerUserId: string; documentId: string }) => {
      const result = await finalWork.claimFinalDocument(binding);
      if (fault === "claim_ack") throw Error("SyntheticLostClaimAck");
      return result;
    });
    const settle = vi.fn(async (reference: Parameters<typeof finalWork.recordSettled>[0]) => {
      expect(put).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledOnce();
      if (fault === "settle_failure") throw Error("SyntheticSettlementUnavailable");
      await finalWork.recordSettled(reference);
      if (fault === "settle_ack") throw Error("SyntheticLostSettlementAck");
    });
    const rollbackClient = {
      begin: (run: (transaction: postgres.TransactionSql) => Promise<unknown>) =>
        sql.begin(async (transaction) => {
          await run(transaction);
          throw Error("SyntheticCompletionRollback");
        }),
    } as unknown as postgres.Sql;
    const port = { putIfAbsent: put, find, read };
    const control = { claimFinalDocument: claim, recordSettled: settle };
    const store = new PostgresCoverLetterStore(
      fault === "sql_rollback" ? rollbackClient : sql,
      port,
      control,
    );
    const replay = new PostgresCoverLetterStore(sql, port, finalWork);
    return {
      document,
      store,
      replay,
      port,
      put,
      find,
      read,
      claim,
      settle,
      state,
      remove: () => {
        bytes = undefined;
      },
    };
  }

  it("final admission resolves original binding and has one non-renewable concurrent winner", async () => {
    const provider = await settledProvider();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => finalWork.claimFinalDocument({ ownerUserId, documentId })),
    );
    expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
    const final = (await issue("final_document")).authorization;
    expect(final).toMatchObject({
      state: "running",
      requestSha256: provider.requestSha256,
      consentExpiresAt: provider.consentExpiresAt,
    });
    expect(await finalWork.claimFinalDocument({ ownerUserId, documentId })).toEqual({
      kind: "unavailable",
    });
  });
  it.each(["missing", "issued", "running", "revoked"])(
    "final admission refuses %s provider settlement",
    async (state) => {
      if (state !== "missing") {
        const provider = (await issue("provider_dispatch")).authorization;
        if (state === "running") await work.claim(provider);
        if (state === "revoked") await work.revokeUnclaimed(ownerUserId, documentId);
      }
      expect(await finalWork.claimFinalDocument({ ownerUserId, documentId })).toEqual({
        kind: "unavailable",
      });
      const fixture = finalFixture();
      await expect(fixture.store.complete(fixture.document)).rejects.toThrow(
        CoverLetterIntegrityError,
      );
      expect(fixture.put).not.toHaveBeenCalled();
    },
  );
  it("final admission refuses foreign ownership and cannot steal an existing unclaimed grant", async () => {
    await settledProvider();
    expect(await finalWork.claimFinalDocument({ ownerUserId: uuidv7(), documentId })).toEqual({
      kind: "unavailable",
    });
    const existing = (await issue("final_document")).authorization;
    expect(await finalWork.claimFinalDocument({ ownerUserId, documentId })).toEqual({
      kind: "unavailable",
    });
    expect((await issue("final_document")).authorization).toEqual(existing);
  });
  it("final admission cannot bypass quarantine or cancellation", async () => {
    await settledProvider();
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${ownerUserId}`;
    await expect(finalWork.claimFinalDocument({ ownerUserId, documentId })).rejects.toThrow(
      "CoverLetterWorkUnavailable",
    );
    await work.revokeUnclaimed(ownerUserId, documentId);
    await expect(finalWork.claimFinalDocument({ ownerUserId, documentId })).rejects.toThrow(
      "CoverLetterWorkUnavailable",
    );
  });
  it("final admission cannot reopen cancellation for an otherwise active candidate", async () => {
    await settledProvider();
    await work.revokeUnclaimed(ownerUserId, documentId);
    expect(await finalWork.claimFinalDocument({ ownerUserId, documentId })).toEqual({
      kind: "unavailable",
    });
    const fixture = finalFixture();
    await expect(fixture.store.complete(fixture.document)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(fixture.put).not.toHaveBeenCalled();
    expect((await issue("final_document")).authorization.state).toBe("revoked");
  });
  it("final admission cannot renew an expired original final grant", async () => {
    await settledProvider();
    const expired = await seedExpired("final_document");
    expect(await finalWork.claimFinalDocument({ ownerUserId, documentId })).toEqual({
      kind: "unavailable",
    });
    expect((await issue("final_document")).authorization).toMatchObject({
      id: expired.id,
      state: "issued",
    });
    const fixture = finalFixture();
    await expect(fixture.store.complete(fixture.document)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(fixture.put).not.toHaveBeenCalled();
  });
  it("a version without an explicit positive creation receipt cannot settle work", async () => {
    await settledProvider();
    const fixture = finalFixture();
    const store = new PostgresCoverLetterStore(
      sql,
      {
        ...fixture.port,
        async putIfAbsent(input) {
          await fixture.put(input);
          return { objectVersion: "synthetic-final-v1" };
        },
      },
      finalWork,
    );
    expect((await store.complete(fixture.document)).status).toBe("ready");
    expect(await fixture.state()).toBe("running");
  });
  it("completion requires a work control port and an enabled ledger before object I/O", async () => {
    await settledProvider();
    const fixture = finalFixture();
    const missing = new PostgresCoverLetterStore(sql, fixture.port);
    const off = new PostgresCoverLetterStore(
      sql,
      fixture.port,
      new PostgresCoverLetterWorkStore(finalControl),
    );
    await expect(missing.complete(fixture.document)).rejects.toThrow(CoverLetterIntegrityError);
    await expect(off.complete(fixture.document)).rejects.toThrow("CoverLetterWorkUnavailable");
    expect(fixture.put).not.toHaveBeenCalled();
    expect(fixture.find).not.toHaveBeenCalled();
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it("concurrent completion writes and positively settles once, with one ready audit", async () => {
    await settledProvider();
    const fixture = finalFixture();
    const ready = await Promise.all(
      Array.from({ length: 8 }, () => fixture.store.complete(fixture.document)),
    );
    expect(
      ready.every((row) => row.status === "ready" && row.objectVersion === "synthetic-final-v1"),
    ).toBe(true);
    expect(fixture.put).toHaveBeenCalledOnce();
    expect(fixture.settle).toHaveBeenCalledOnce();
    expect(await fixture.state()).toBe("settled");
    const audits =
      await sql`SELECT id FROM documents.audit_events WHERE document_id = ${documentId} AND action = 'cover_letter.ready'`;
    expect(audits).toHaveLength(1);
    fixture.remove();
    expect((await fixture.replay.complete(fixture.document)).status).toBe("ready");
    await expect(fixture.replay.recover({ ...reserved })).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(fixture.put).toHaveBeenCalledOnce();
  });
  it("finalizes the original result after real consent expiry without another provider claim", async () => {
    consentExpiresAt = new Date(Date.now() + 1_000);
    const provider = await settledProvider();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, consentExpiresAt.getTime() - Date.now()) + 30),
    );
    const fixture = finalFixture();
    expect((await fixture.store.complete(fixture.document)).status).toBe("ready");
    expect(await finalWork.claim(provider)).toEqual({ kind: "unavailable" });
    const final = (await issue("final_document")).authorization;
    expect(final.consentExpiresAt).toEqual(provider.consentExpiresAt);
    expect(final.expiresAt.getTime()).toBeGreaterThan(consentExpiresAt.getTime());
    expect(final.state).toBe("settled");
  });
  it.each(["put_ack", "read", "settle_failure"] as const)(
    "%s leaves running work; replay only reads and never settles",
    async (fault) => {
      await settledProvider();
      const fixture = finalFixture(fault);
      await expect(fixture.store.complete(fixture.document)).rejects.toThrow();
      expect(await fixture.state()).toBe("running");
      const [pending] =
        await sql`SELECT status FROM documents.cover_letters WHERE id = ${documentId}`;
      expect(pending?.status).toBe("pending");
      const settlements = fixture.settle.mock.calls.length;
      expect((await fixture.replay.complete(fixture.document)).status).toBe("ready");
      expect(fixture.put).toHaveBeenCalledOnce();
      expect(fixture.settle).toHaveBeenCalledTimes(settlements);
      expect(await fixture.state()).toBe("running");
      await work.revokeUnclaimed(ownerUserId, documentId);
      expect(await work.readDrainState(ownerUserId, documentId)).toBe("pending");
      await expect(
        sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
      ).rejects.toMatchObject({ code: "55000" });
    },
  );
  it("lost PUT acknowledgement followed by object removal never permits recreation", async () => {
    await settledProvider();
    const fixture = finalFixture("put_ack");
    await expect(fixture.store.complete(fixture.document)).rejects.toThrow();
    fixture.remove();
    await expect(fixture.replay.complete(fixture.document)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(fixture.put).toHaveBeenCalledOnce();
    expect(fixture.settle).not.toHaveBeenCalled();
    expect(await fixture.state()).toBe("running");
  });
  it("conditional conflict can recover matching bytes but cannot settle the original actor", async () => {
    await settledProvider();
    const fixture = finalFixture("conflict");
    expect((await fixture.store.complete(fixture.document)).status).toBe("ready");
    expect(fixture.settle).not.toHaveBeenCalled();
    expect(await fixture.state()).toBe("running");
  });
  it.each(["settle_ack", "sql_rollback"] as const)(
    "%s preserves original settlement and recovers SQL without another PUT",
    async (fault) => {
      await settledProvider();
      const fixture = finalFixture(fault);
      await expect(fixture.store.complete(fixture.document)).rejects.toThrow();
      expect(await fixture.state()).toBe("settled");
      expect((await fixture.replay.complete(fixture.document)).status).toBe("ready");
      expect(fixture.put).toHaveBeenCalledOnce();
      expect(fixture.settle).toHaveBeenCalledOnce();
    },
  );
  it("ambiguous claim acknowledgement never dispatches or steals original authority", async () => {
    await settledProvider();
    const fixture = finalFixture("claim_ack");
    await expect(fixture.store.complete(fixture.document)).rejects.toThrow();
    expect(await fixture.state()).toBe("running");
    await expect(fixture.replay.complete(fixture.document)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(fixture.put).not.toHaveBeenCalled();
    expect(fixture.settle).not.toHaveBeenCalled();
  });
  it.each(["purpose", "document", "identity", "hash"])(
    "rejects mismatched final %s control before all object I/O",
    async (kind) => {
      await settledProvider();
      const fixture = finalFixture();
      const store = new PostgresCoverLetterStore(sql, fixture.port, {
        async claimFinalDocument(binding) {
          const result = await finalWork.claimFinalDocument(binding);
          if (result.kind !== "claimed") throw Error("SyntheticMissingClaim");
          if (kind === "purpose") result.reference.purpose = "provider_dispatch";
          if (kind === "document") result.reference.documentId = uuidv7();
          if (kind === "identity") result.reference.id = "invalid";
          if (kind === "hash") result.reference.requestSha256 = "invalid";
          return result;
        },
        recordSettled: finalWork.recordSettled.bind(finalWork),
      });
      await expect(store.complete(fixture.document)).rejects.toThrow(CoverLetterIntegrityError);
      expect(fixture.put).not.toHaveBeenCalled();
      expect(fixture.find).not.toHaveBeenCalled();
      expect(fixture.read).not.toHaveBeenCalled();
    },
  );
  it("detaches candidate input, claim reference and acknowledgement version across asynchronous work", async () => {
    await settledProvider();
    const fixture = finalFixture();
    const input = structuredClone(fixture.document);
    let returnedClaim: Awaited<ReturnType<typeof finalWork.claimFinalDocument>> | undefined;
    const receipt = { objectVersion: "synthetic-final-v1", created: true };
    const store = new PostgresCoverLetterStore(
      sql,
      {
        ...fixture.port,
        async putIfAbsent(value) {
          if (returnedClaim?.kind === "claimed")
            returnedClaim.reference.purpose = "provider_dispatch";
          await fixture.put(value);
          return receipt;
        },
        async read(value) {
          receipt.objectVersion = "synthetic-foreign-v1";
          receipt.created = false;
          return fixture.read(value);
        },
      },
      {
        async claimFinalDocument(binding) {
          input.ownerUserId = uuidv7();
          const paragraph = input.paragraphs[0];
          if (!paragraph) throw Error("SyntheticParagraphMissing");
          paragraph.text = "Synthetic caller mutation";
          returnedClaim = await finalWork.claimFinalDocument(binding);
          return returnedClaim;
        },
        recordSettled: finalWork.recordSettled.bind(finalWork),
      },
    );
    const ready = await store.complete(input);
    expect(ready.objectVersion).toBe("synthetic-final-v1");
    expect(ready.ownerUserId).toBe(ownerUserId);
    expect(await fixture.state()).toBe("settled");
    expect(
      await fixture.replay.read(
        ownerUserId,
        reserved.applicationId,
        fixture.document.contentSha256,
      ),
    ).toEqual(fixture.document);
  });
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
