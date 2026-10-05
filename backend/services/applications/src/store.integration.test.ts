import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfirmationEvidence } from "./attempt.js";
import { MAX_APPROVAL_AGE_MS } from "./packet.js";
import {
  ApplicationAlreadyExistsError,
  ApplicationIdempotencyConflictError,
  ApplicationNotFoundError,
  ApplicationRevisionConflictError,
  PostgresApplicationStore,
  StalePacketError,
} from "./store.js";
import { definitions, FACT_A, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");
const bindings = { jobRevision: HASH_A, formHash: HASH_B, resumeHash: HASH_C };
const disposableDispatchDatabase = (() => {
  if (!databaseUrl) return false;
  const url = new URL(databaseUrl);
  return (
    url.protocol === "postgres:" &&
    url.hostname === "127.0.0.1" &&
    /^\/application_dispatch_[a-z0-9_]{1,40}$/u.test(url.pathname) &&
    !url.search &&
    !url.hash
  );
})();

describeWithDatabase("PostgresApplicationStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 6,
    onnotice: () => undefined,
  });
  let now = new Date("2026-09-18T12:00:00.000Z");
  const store = new PostgresApplicationStore(client, () => now, { definitions });
  const evidence: ConfirmationEvidence = {
    kind: "provider_confirmation_page",
    observedAt: new Date("2026-09-18T12:00:05.000Z"),
    fingerprintSha256: HASH_A,
    adapterId: "greenhouse",
    adapterVersion: "1.0.0",
  };

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    // Delete guards require Profile's privacy authorization even when this suite runs first.
    const profile = await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env },
    );
    expect(profile.stdout.trim()).toContain("applied and verified.");
    const first = await execFileAsync(process.execPath, [migrationExecutable], { env });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], { env });
    const expected =
      "Applications migrations through 0007_document_field_hashes applied and verified.";
    expect(first.stdout.trim()).toBe(expected);
    expect(replay.stdout.trim()).toBe(expected);
    await store.ping();
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function prepared(options: { restricted?: boolean } = {}) {
    const ownerUserId = uuidv7();
    const created = await store.createApplication({
      ownerUserId,
      canonicalJobId: uuidv7(),
      idempotencyKey: key("create"),
    });
    const fields = [
      proposal(),
      ...(options.restricted
        ? [
            proposal({
              fieldKey: "authorization.us_authorized",
              value: true,
              origin: "answer_vault",
              sourceFactIds: [FACT_A],
            }),
          ]
        : []),
    ];
    const packeted = await store.createPacket({
      ownerUserId,
      applicationId: created.view.application.id,
      expectedRevision: created.view.application.revision,
      idempotencyKey: key("packet"),
      packet: {
        jobRevision: HASH_A,
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
        fields,
        artifactHashes: { resume: HASH_C },
      },
    });
    return { ownerUserId, applicationId: created.view.application.id, packeted };
  }

  async function approved(options: { restricted?: boolean } = {}) {
    const context = await prepared(options);
    const packet = context.packeted.view.currentPacket;
    if (!packet) throw new Error("packet expected");
    const result = await store.approve({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.packeted.view.application.revision,
      idempotencyKey: key("approve"),
      request: {
        packetHash: packet.packetHash,
        consentId: uuidv7(),
        acknowledgedFieldKeys: options.restricted ? ["authorization.us_authorized"] : [],
      },
      current: bindings,
    });
    return { ...context, approvedView: result.view };
  }

  async function started(context: Awaited<ReturnType<typeof approved>>) {
    const result = await store.startAttempt({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.approvedView.application.revision,
      idempotencyKey: key("start"),
      current: bindings,
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
    });
    if (result.kind !== "started") throw new Error("attempt expected");
    return result;
  }

  it.each([
    { label: "expiry", reason: "approval_expired", current: bindings },
    { label: "job", reason: "job_changed", current: { ...bindings, jobRevision: HASH_B } },
    { label: "form", reason: "form_changed", current: { ...bindings, formHash: HASH_C } },
    { label: "resume", reason: "resume_changed", current: { ...bindings, resumeHash: HASH_A } },
    {
      label: "cover letter",
      reason: "cover_letter_changed",
      current: { ...bindings, coverLetterHash: HASH_A },
    },
  ] as const)(
    "refuses dispatch after $label changes and durably returns to review",
    async ({ label, reason, current }) => {
      now = new Date("2026-09-18T12:00:00.000Z");
      const context = await approved();
      const start = await started(context);
      if (label === "expiry") now = new Date(now.getTime() + MAX_APPROVAL_AGE_MS);
      const command = {
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        current,
      };
      await expect(store.dispatchAttempt(command)).rejects.toMatchObject({ reasons: [reason] });
      const view = await store.getApplication(context.ownerUserId, context.applicationId);
      expect(view.application).toMatchObject({
        status: "review_required",
        revision: start.view.application.revision + 1,
      });
      expect(view.approval).toBeNull();
      expect(view.currentAction).toBe("review_and_approve");
      expect(view.attempts[0]).toMatchObject({ status: "failed_no_effect" });
      expect(view.attempts[0]?.dispatchedAt).toBeUndefined();
      const [approval] = await client`SELECT invalidation_reason FROM applications.approvals
      WHERE application_id = ${context.applicationId}`;
      expect(approval?.invalidation_reason).toBe(reason);
      const history = await store.getHistory(context.ownerUserId, context.applicationId);
      expect(
        history.entries.filter((item) => item.kind === "attempt_failed_no_effect"),
      ).toHaveLength(1);
      expect(history.entries.some((item) => item.kind === "attempt_dispatched")).toBe(false);
      const [outbox] = await client`SELECT count(*)::int AS count FROM applications.outbox
      WHERE application_id = ${context.applicationId} AND application_revision = ${view.application.revision}
        AND payload->>'status' = 'review_required'`;
      expect(outbox?.count).toBe(1);
      const [noIntermediate] = await client`SELECT count(*)::int AS count FROM applications.outbox
        WHERE application_id = ${context.applicationId} AND application_revision > ${start.view.application.revision}
          AND payload->>'status' = 'approved'`;
      expect(noIntermediate?.count).toBe(0);
      await expect(store.dispatchAttempt(command)).rejects.toMatchObject({
        code: "ILLEGAL_ATTEMPT_TRANSITION",
      });
      now = new Date("2026-09-18T12:00:00.000Z");
    },
  );

  it("concurrent stale deliveries settle once without any dispatch receipt", async () => {
    const context = await approved();
    const start = await started(context);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        store.dispatchAttempt({
          ownerUserId: context.ownerUserId,
          applicationId: context.applicationId,
          attemptId: start.attempt.id,
          current: { ...bindings, jobRevision: HASH_B },
        }),
      ),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(
      results.filter(
        (result) => result.status === "rejected" && result.reason instanceof StalePacketError,
      ),
    ).toHaveLength(1);
    const view = await store.getApplication(context.ownerUserId, context.applicationId);
    expect(view.application).toMatchObject({
      status: "review_required",
      revision: start.view.application.revision + 1,
    });
    expect(view.attempts[0]).toMatchObject({ status: "failed_no_effect" });
    expect(view.attempts[0]?.dispatchedAt).toBeUndefined();
    const history = await store.getHistory(context.ownerUserId, context.applicationId);
    expect(history.entries.filter((entry) => entry.kind === "approval_invalidated")).toHaveLength(
      1,
    );
    expect(history.entries.some((entry) => entry.kind === "attempt_dispatched")).toBe(false);
  });

  it("detaches a stale binding snapshot before waiting for the application lock", async () => {
    const context = await approved();
    const start = await started(context);
    let unlock: () => void = () => undefined;
    let ready: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = client.begin(async (tx) => {
      await tx`SELECT id FROM applications.applications WHERE id = ${context.applicationId} FOR UPDATE`;
      ready();
      await held;
    });
    await locked;
    const mutable = { ...bindings, jobRevision: HASH_B };
    const pending = store.dispatchAttempt({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      current: mutable,
    });
    mutable.jobRevision = HASH_A;
    unlock();
    await holder;
    await expect(pending).rejects.toMatchObject({ reasons: ["job_changed"] });
    expect(
      (await store.getApplication(context.ownerUserId, context.applicationId)).application.status,
    ).toBe("review_required");
  });

  it("refuses approval that expires while the dispatch waits for an application lock", async () => {
    const context = await approved();
    const start = await started(context);
    let localNow = new Date(now);
    const queuedStore = new PostgresApplicationStore(client, () => localNow, { definitions });
    let unlock: () => void = () => undefined;
    let ready: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = client.begin(async (tx) => {
      await tx`SELECT id FROM applications.applications WHERE id = ${context.applicationId} FOR UPDATE`;
      ready();
      await held;
    });
    await locked;
    const pending = queuedStore.dispatchAttempt({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      current: bindings,
    });
    localNow = new Date(localNow.getTime() + MAX_APPROVAL_AGE_MS);
    unlock();
    await holder;
    await expect(pending).rejects.toMatchObject({ reasons: ["approval_expired"] });
    const view = await store.getApplication(context.ownerUserId, context.applicationId);
    expect(view.application.status).toBe("review_required");
    expect(view.attempts[0]?.dispatchedAt).toBeUndefined();
  });

  it.skipIf(!disposableDispatchDatabase)(
    "rolls back the entire refusal when its final outbox write fails",
    async () => {
      const context = await approved();
      const start = await started(context);
      const command = {
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        current: { ...bindings, jobRevision: HASH_B },
      };
      const name = `dispatch_fault_${uuidv7().replaceAll("-", "")}`;
      const [before] = await client`SELECT
      (SELECT count(*)::int FROM applications.history WHERE application_id = ${context.applicationId}) AS history,
      (SELECT count(*)::int FROM applications.outbox WHERE application_id = ${context.applicationId}) AS outbox`;
      // Only this loopback disposable database permits the generated, exact-application test trigger.
      // Native PostgreSQL raises on the final lifecycle write; the earlier no-effect settlement
      // and approval invalidation must roll back too. No service/table guard is replaced.
      await client.unsafe(`CREATE FUNCTION applications.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.application_id = '${context.applicationId}'::uuid AND NEW.payload->>'status' = 'review_required' THEN
          RAISE EXCEPTION 'SyntheticDispatchOutboxFailure';
        END IF;
        RETURN NEW;
      END; $$`);
      try {
        await client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON applications.outbox
        FOR EACH ROW EXECUTE FUNCTION applications.${name}()`);
        await expect(store.dispatchAttempt(command)).rejects.toThrow(
          "SyntheticDispatchOutboxFailure",
        );
        const view = await store.getApplication(context.ownerUserId, context.applicationId);
        expect(view.application).toMatchObject({
          status: "submitting",
          revision: start.view.application.revision,
        });
        expect(view.approval?.id).toBe(start.view.approval?.id);
        expect(view.attempts[0]).toMatchObject({ status: "started" });
        expect(view.attempts[0]?.dispatchedAt).toBeUndefined();
        const [after] = await client`SELECT
        (SELECT count(*)::int FROM applications.history WHERE application_id = ${context.applicationId}) AS history,
        (SELECT count(*)::int FROM applications.outbox WHERE application_id = ${context.applicationId}) AS outbox`;
        expect(after).toEqual(before);
      } finally {
        await client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON applications.outbox`);
        await client.unsafe(`DROP FUNCTION applications.${name}()`);
      }
      await expect(store.dispatchAttempt(command)).rejects.toMatchObject({
        reasons: ["job_changed"],
      });
      expect(
        (await store.getApplication(context.ownerUserId, context.applicationId)).application.status,
      ).toBe("review_required");
    },
  );

  it("creates idempotently, isolates owners, and refuses duplicates", async () => {
    const ownerUserId = uuidv7();
    const canonicalJobId = uuidv7();
    const idempotencyKey = key("create");
    const first = await store.createApplication({ ownerUserId, canonicalJobId, idempotencyKey });
    expect(first.replayed).toBe(false);
    expect(first.view.application.status).toBe("preparing");
    expect(first.view.currentAction).toBe("prepare_packet");

    const replay = await store.createApplication({ ownerUserId, canonicalJobId, idempotencyKey });
    expect(replay.replayed).toBe(true);
    expect(replay.view.application.id).toBe(first.view.application.id);

    await expect(
      store.createApplication({ ownerUserId, canonicalJobId: uuidv7(), idempotencyKey }),
    ).rejects.toThrow(ApplicationIdempotencyConflictError);
    await expect(
      store.createApplication({ ownerUserId, canonicalJobId, idempotencyKey: key("second") }),
    ).rejects.toThrow(ApplicationAlreadyExistsError);

    // Another candidate can neither read nor mutate it, and cannot tell it exists.
    const other = uuidv7();
    await expect(store.getApplication(other, first.view.application.id)).rejects.toThrow(
      ApplicationNotFoundError,
    );
    await expect(
      store.cancel({
        ownerUserId: other,
        applicationId: first.view.application.id,
        expectedRevision: 1,
        idempotencyKey: key("cancel"),
      }),
    ).rejects.toThrow(ApplicationNotFoundError);
    await expect(store.getHistory(other, first.view.application.id)).rejects.toThrow(
      ApplicationNotFoundError,
    );
    expect((await store.listApplications(other)).items).toHaveLength(0);
  });

  it.each(["started", "dispatched"] as const)(
    "keeps edit-again forbidden while an attempt is %s",
    async (status) => {
      const context = await approved();
      const start = await started(context);
      if (status === "dispatched")
        await store.dispatchAttempt({
          ownerUserId: context.ownerUserId,
          applicationId: context.applicationId,
          attemptId: start.attempt.id,
          current: bindings,
        });
      await expect(
        store.reopenForEdit({
          ownerUserId: context.ownerUserId,
          applicationId: context.applicationId,
          expectedRevision: start.view.application.revision,
          idempotencyKey: key("reopen-in-flight"),
        }),
      ).rejects.toMatchObject({
        from: "submitting",
        event: "approval_invalidated",
      });
      const view = await store.getApplication(context.ownerUserId, context.applicationId);
      expect(view.application.status).toBe("submitting");
      expect(view.attempts[0]?.status).toBe(status);
      expect(view.approval).not.toBeNull();
    },
  );

  it("permits one fresh reviewed packet after a refused stale dispatch", async () => {
    const context = await approved();
    const start = await started(context);
    const fresh = { ...bindings, jobRevision: HASH_B };
    await expect(
      store.dispatchAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        current: fresh,
      }),
    ).rejects.toBeInstanceOf(StalePacketError);
    const refused = await store.getApplication(context.ownerUserId, context.applicationId);
    const packeted = await store.createPacket({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: refused.application.revision,
      idempotencyKey: key("fresh-packet"),
      packet: {
        jobRevision: HASH_B,
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
        fields: [proposal()],
        artifactHashes: { resume: HASH_C },
      },
    });
    const packet = packeted.view.currentPacket;
    if (!packet) throw Error("SyntheticPacketMissing");
    expect(packet.packetHash).not.toBe(start.attempt.packetHash);
    const reviewed = await store.approve({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: packeted.view.application.revision,
      idempotencyKey: key("fresh-approval"),
      current: fresh,
      request: { packetHash: packet.packetHash, consentId: uuidv7(), acknowledgedFieldKeys: [] },
    });
    const resumed = await store.startAttempt({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: reviewed.view.application.revision,
      idempotencyKey: key("fresh-attempt"),
      current: fresh,
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
    });
    if (resumed.kind !== "started") throw Error("SyntheticAttemptMissing");
    expect(resumed.attempt.id).not.toBe(start.attempt.id);
    await expect(
      store.dispatchAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: resumed.attempt.id,
        current: fresh,
      }),
    ).resolves.toMatchObject({ status: "dispatched" });
    const view = await store.getApplication(context.ownerUserId, context.applicationId);
    expect(view.attempts.filter((attempt) => attempt.status === "dispatched")).toHaveLength(1);
    expect(
      view.attempts.find((attempt) => attempt.id === start.attempt.id)?.dispatchedAt,
    ).toBeUndefined();
  });

  it("builds an immutable packet, enforces revisions, and refuses unresolved approval", async () => {
    const context = await prepared();
    const packet = context.packeted.view.currentPacket;
    expect(packet?.version).toBe(1);
    expect(context.packeted.view.application.status).toBe("review_required");
    expect(context.packeted.view.currentAction).toBe("review_and_approve");

    // Stale expected revision is refused without side effects.
    await expect(
      store.createPacket({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: 1,
        idempotencyKey: key("stale"),
        packet: { jobRevision: HASH_A, form: null, fields: [], artifactHashes: {} },
      }),
    ).rejects.toThrow(ApplicationRevisionConflictError);

    // Packets are append-only at the database.
    await expect(
      client`UPDATE applications.packets SET job_revision = ${HASH_B} WHERE application_id = ${context.applicationId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      client`DELETE FROM applications.packets WHERE application_id = ${context.applicationId}`,
    ).rejects.toThrow(/append-only/);

    // A field needing direct candidate action blocks approval and keeps the value out.
    const unresolved = await store.createPacket({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.packeted.view.application.revision,
      idempotencyKey: key("packet2"),
      packet: {
        jobRevision: HASH_A,
        form: null,
        fields: [proposal({ fieldKey: "attestation.truthful", value: true, origin: "derived" })],
        artifactHashes: {},
      },
    });
    expect(unresolved.view.currentPacket?.version).toBe(2);
    expect(unresolved.view.currentAction).toBe("resolve_fields");
    expect(unresolved.view.currentPacket?.fields[0]?.value).toBeNull();
    await expect(
      store.approve({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: unresolved.view.application.revision,
        idempotencyKey: key("approve"),
        request: {
          packetHash: unresolved.view.currentPacket?.packetHash ?? "",
          consentId: uuidv7(),
          acknowledgedFieldKeys: ["attestation.truthful"],
        },
        current: bindings,
      }),
    ).rejects.toMatchObject({ code: "UNRESOLVED_FIELD" });
  });

  it("refuses to approve a packet whose job or form changed since it was prepared", async () => {
    const context = await prepared();
    const packet = context.packeted.view.currentPacket;
    await expect(
      store.approve({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.packeted.view.application.revision,
        idempotencyKey: key("approve"),
        request: {
          packetHash: packet?.packetHash ?? "",
          consentId: uuidv7(),
          acknowledgedFieldKeys: [],
        },
        current: { ...bindings, jobRevision: HASH_B },
      }),
    ).rejects.toThrow(StalePacketError);
  });

  it("completes the happy path to applied with history, outbox, and a terminal state", async () => {
    const context = await approved({ restricted: true });
    expect(context.approvedView.currentAction).toBe("ready_to_submit");
    const start = await started(context);
    expect(start.view.application.status).toBe("submitting");

    const dispatched = await store.dispatchAttempt({
      current: bindings,
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
    });
    expect(dispatched.status).toBe("dispatched");
    // Write-ahead dispatch can happen exactly once.
    await expect(
      store.dispatchAttempt({
        current: bindings,
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_DISPATCHED" });

    const done = await store.recordResult({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("result"),
      result: { kind: "confirmed", evidence },
    });
    expect(done.view.application.status).toBe("applied");
    expect(done.view.currentAction).toBe("none");
    expect(done.view.attempts[0]?.evidence?.fingerprintSha256).toBe(HASH_A);

    const history = await store.getHistory(context.ownerUserId, context.applicationId);
    expect(history.entries.map((entry) => entry.kind)).toEqual([
      "application_created",
      "packet_created",
      "approval_recorded",
      "attempt_started",
      "attempt_dispatched",
      "submission_confirmed",
    ]);
    expect(history.entries.at(-1)?.toStatus).toBe("applied");
    expect(history.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);

    const outbox = await client<{ event_type: string; payload: Record<string, unknown> }[]>`
      SELECT event_type, payload FROM applications.outbox
      WHERE application_id = ${context.applicationId} ORDER BY application_revision, event_type
    `;
    expect(outbox.map((row) => row.event_type)).toContain("application.applied.v1");
    for (const row of outbox) {
      expect(Object.keys(row.payload).sort()).toEqual([
        "applicationId",
        "revision",
        "status",
        "userId",
      ]);
    }

    // applied is terminal at the database as well as in the domain.
    await expect(
      client`UPDATE applications.applications SET status = 'approved', revision = revision + 1 WHERE id = ${context.applicationId}`,
    ).rejects.toThrow(/terminal state is immutable/);
    await expect(
      store.cancel({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: done.view.application.revision,
        idempotencyKey: key("cancel"),
      }),
    ).rejects.toMatchObject({ name: "IllegalTransitionError" });
  });

  it("allows exactly one of two concurrent attempt starts", async () => {
    const context = await approved();
    const attemptStart = () =>
      store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("race"),
        current: bindings,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
      });
    const results = await Promise.allSettled([attemptStart(), attemptStart()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rows = await client`
      SELECT id FROM applications.attempts WHERE application_id = ${context.applicationId}
    `;
    expect(rows).toHaveLength(1);
  });

  it("replays a start with the same key and rejects a changed payload", async () => {
    const context = await approved();
    const idempotencyKey = key("start-replay");
    const command = {
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.approvedView.application.revision,
      idempotencyKey,
      current: bindings,
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
    };
    const first = await store.startAttempt(command);
    const replay = await store.startAttempt(command);
    expect(replay.replayed).toBe(true);
    expect(replay.kind).toBe("started");
    if (first.kind === "started" && replay.kind === "started") {
      expect(replay.attempt.id).toBe(first.attempt.id);
    }
    await expect(store.startAttempt({ ...command, adapterVersion: "2.0.0" })).rejects.toThrow(
      ApplicationIdempotencyConflictError,
    );
  });

  it("never re-submits after an ambiguous result until it is reconciled", async () => {
    const context = await approved();
    const start = await started(context);
    await store.dispatchAttempt({
      current: bindings,
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
    });
    const ambiguous = await store.recordResult({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("timeout"),
      result: { kind: "timeout" },
    });
    expect(ambiguous.view.application.status).toBe("reconciliation_required");
    expect(ambiguous.view.currentAction).toBe("confirm_submission_status");

    // No new attempt, and not even a fresh key, can start while it is ambiguous.
    await expect(
      store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: ambiguous.view.application.revision,
        idempotencyKey: key("retry"),
        current: bindings,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
      }),
    ).rejects.toMatchObject({ code: "NOT_APPROVED" });
    // The database itself refuses a second scope-holding attempt for the same packet.
    await expect(
      client`
        INSERT INTO applications.attempts
          (id, application_id, owner_user_id, packet_id, packet_hash, approval_id, sequence,
           scope_key, status, adapter_id, adapter_version, started_at)
        SELECT ${uuidv7()}, application_id, owner_user_id, packet_id, packet_hash, approval_id, 99,
          scope_key, 'started', adapter_id, adapter_version, started_at
        FROM applications.attempts WHERE id = ${start.attempt.id}
      `,
    ).rejects.toThrow(/attempts_scope_holding_uq/);

    // Unacknowledged duplicate risk cannot reopen submission.
    await expect(
      store.reconcile({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        idempotencyKey: key("reconcile-bad"),
        reconciliation: { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: false },
      }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_REFUSED" });

    const notSubmitted = await store.reconcile({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("reconcile"),
      reconciliation: {
        kind: "provider_absence_verified",
        observedAt: now,
        fingerprintSha256: HASH_A,
      },
    });
    expect(notSubmitted.view.application.status).toBe("approved");

    const second = await store.startAttempt({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: notSubmitted.view.application.revision,
      idempotencyKey: key("second"),
      current: bindings,
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
    });
    expect(second.kind).toBe("started");
    if (second.kind === "started") expect(second.attempt.sequence).toBe(2);
  });

  it("confirms an ambiguous attempt from provider evidence and ends at applied", async () => {
    const context = await approved();
    const start = await started(context);
    await store.dispatchAttempt({
      current: bindings,
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
    });
    await store.recordResult({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("unknown"),
      result: { kind: "unrecognized_response" },
    });
    const confirmed = await store.reconcile({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("confirm"),
      reconciliation: { kind: "provider_confirmation", evidence },
    });
    expect(confirmed.view.application.status).toBe("applied");
  });

  it("recovers a crashed dispatched attempt as ambiguous and a crashed unsent one as no-effect", async () => {
    const sent = await approved();
    const sentStart = await started(sent);
    await store.dispatchAttempt({
      current: bindings,
      ownerUserId: sent.ownerUserId,
      applicationId: sent.applicationId,
      attemptId: sentStart.attempt.id,
    });
    const unsent = await approved();
    await started(unsent);

    now = new Date(now.getTime() + 10 * 60 * 1000);
    const recovery = await store.recoverStaleAttempts(5 * 60 * 1000, 500);
    expect(recovery.recovered).toBeGreaterThanOrEqual(2);
    expect(
      (await store.getApplication(sent.ownerUserId, sent.applicationId)).application.status,
    ).toBe("reconciliation_required");
    expect(
      (await store.getApplication(unsent.ownerUserId, unsent.applicationId)).application.status,
    ).toBe("approved");
    // Replaying recovery is a no-op.
    expect((await store.recoverStaleAttempts(5 * 60 * 1000, 500)).recovered).toBe(0);
  });

  it("invalidates approval when the job changes and reports it consistently on replay", async () => {
    const context = await approved();
    const idempotencyKey = key("changed");
    const command = {
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.approvedView.application.revision,
      idempotencyKey,
      current: { ...bindings, jobRevision: HASH_B },
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
    };
    const result = await store.startAttempt(command);
    expect(result.kind).toBe("approval_invalidated");
    if (result.kind === "approval_invalidated") expect(result.reasons).toEqual(["job_changed"]);
    expect(result.view.application.status).toBe("review_required");
    expect(result.view.approval).toBeNull();

    const replay = await store.startAttempt(command);
    expect(replay.kind).toBe("approval_invalidated");
    expect(replay.replayed).toBe(true);
    expect(
      await client`SELECT id FROM applications.attempts WHERE application_id = ${context.applicationId}`,
    ).toHaveLength(0);
  });

  it("expires an approval by age", async () => {
    const context = await approved();
    const before = now;
    now = new Date(now.getTime() + MAX_APPROVAL_AGE_MS + 1);
    try {
      const result = await store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("expired"),
        current: bindings,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
      });
      expect(result.kind).toBe("approval_invalidated");
      if (result.kind === "approval_invalidated") {
        expect(result.reasons).toContain("approval_expired");
      }
    } finally {
      now = before;
    }
  });

  it("hands a challenge to the candidate and lets them abandon or attest", async () => {
    const context = await approved();
    const start = await started(context);
    const takeover = await store.recordResult({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("challenge"),
      result: { kind: "challenge_required" },
    });
    expect(takeover.view.application.status).toBe("takeover");
    expect(takeover.view.currentAction).toBe("complete_manually");
    const attested = await store.reconcile({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("attest"),
      reconciliation: {
        kind: "user_attested_submitted",
        evidence: { ...evidence, kind: "user_attested" },
      },
    });
    expect(attested.view.application.status).toBe("applied");
    expect(attested.view.attempts[0]?.evidence?.kind).toBe("user_attested");
  });

  it("returns a failed-review attempt to review and never reuses its approval", async () => {
    const context = await approved();
    const start = await started(context);
    await store.dispatchAttempt({
      current: bindings,
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
    });
    const rejected = await store.recordResult({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      attemptId: start.attempt.id,
      idempotencyKey: key("rejected"),
      result: { kind: "validation_rejected" },
    });
    expect(rejected.view.application.status).toBe("review_required");
    expect(rejected.view.approval).toBeNull();
  });

  it("cancels only before submission and lists owner-scoped current actions", async () => {
    const context = await prepared();
    const cancelled = await store.cancel({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: context.packeted.view.application.revision,
      idempotencyKey: key("cancel"),
    });
    expect(cancelled.view.application.status).toBe("cancelled");
    const list = await store.listApplications(context.ownerUserId);
    expect(list.items.map((item) => item.currentAction)).toEqual(["none"]);
    // A cancelled application does not block starting again for the same job.
    const again = await store.createApplication({
      ownerUserId: context.ownerUserId,
      canonicalJobId: cancelled.view.application.canonicalJobId,
      idempotencyKey: key("again"),
    });
    expect(again.view.application.status).toBe("preparing");
  });

  it("rejects history kinds that describe hiring outcomes at the database", async () => {
    const context = await prepared();
    await expect(
      client`
        INSERT INTO applications.history
          (id, application_id, owner_user_id, seq, kind, to_status, occurred_at)
        VALUES (${uuidv7()}, ${context.applicationId}, ${context.ownerUserId}, 99,
          'interview_scheduled', 'applied', now())
      `,
    ).rejects.toThrow(/history_kind_check/);
    await expect(
      client`
        INSERT INTO applications.outbox
          (id, application_id, owner_user_id, application_revision, event_type, subject, payload,
           occurred_at, available_at)
        VALUES (${uuidv7()}, ${context.applicationId}, ${context.ownerUserId}, 99,
          'application.offer_received.v1', ${`application/${context.applicationId}`},
          '{}'::jsonb, now(), now())
      `,
    ).rejects.toThrow(/outbox_event_type_check/);
  });

  describe("manual submission (D3-018)", () => {
    async function approvedManual() {
      const ownerUserId = uuidv7();
      const created = await store.createApplication({
        ownerUserId,
        canonicalJobId: uuidv7(),
        idempotencyKey: key("create"),
      });
      const packeted = await store.createPacket({
        ownerUserId,
        applicationId: created.view.application.id,
        expectedRevision: created.view.application.revision,
        idempotencyKey: key("packet"),
        packet: {
          jobRevision: HASH_A,
          form: null,
          fields: [proposal()],
          artifactHashes: { resume: HASH_C },
        },
      });
      const packet = packeted.view.currentPacket;
      if (!packet) throw new Error("packet expected");
      const manualCurrent = { jobRevision: HASH_A, formHash: null, resumeHash: HASH_C };
      const approvedResult = await store.approve({
        ownerUserId,
        applicationId: created.view.application.id,
        expectedRevision: packeted.view.application.revision,
        idempotencyKey: key("approve"),
        request: { packetHash: packet.packetHash, consentId: uuidv7(), acknowledgedFieldKeys: [] },
        current: manualCurrent,
      });
      return {
        ownerUserId,
        applicationId: created.view.application.id,
        manualCurrent,
        approvedView: approvedResult.view,
      };
    }

    it("starts an attempt already taken over, with no dispatch, and ends at applied through the existing reconciliation route", async () => {
      const context = await approvedManual();
      const start = await store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("manual-start"),
        current: context.manualCurrent,
        adapterId: "manual",
        adapterVersion: "none",
        manual: true,
      });
      expect(start.kind).toBe("started");
      if (start.kind !== "started") throw new Error("started expected");
      expect(start.attempt.status).toBe("taken_over");
      expect(start.attempt.dispatchedAt).toBeUndefined();
      expect(start.view.application.status).toBe("takeover");
      expect(start.view.currentAction).toBe("complete_manually");

      // Dispatch is illegal: a manual attempt never goes through the automated dispatch step.
      await expect(
        store.dispatchAttempt({
          current: bindings,
          ownerUserId: context.ownerUserId,
          applicationId: context.applicationId,
          attemptId: start.attempt.id,
        }),
      ).rejects.toMatchObject({ code: "ILLEGAL_ATTEMPT_TRANSITION" });

      const reconciled = await store.reconcile({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        idempotencyKey: key("manual-reconcile"),
        reconciliation: {
          kind: "user_attested_submitted",
          evidence: {
            kind: "user_attested",
            observedAt: now,
            fingerprintSha256: HASH_A,
          },
        },
      });
      expect(reconciled.view.application.status).toBe("applied");
      const manualAttempt = reconciled.view.attempts.find((a) => a.id === start.attempt.id);
      expect(manualAttempt).toMatchObject({ adapterId: "manual", status: "confirmed" });
    });

    it("lets the candidate attest a manual attempt was not submitted, returning to approved for a retry", async () => {
      const context = await approvedManual();
      const start = await store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("manual-start"),
        current: context.manualCurrent,
        adapterId: "manual",
        adapterVersion: "none",
        manual: true,
      });
      if (start.kind !== "started") throw new Error("started expected");

      await expect(
        store.reconcile({
          ownerUserId: context.ownerUserId,
          applicationId: context.applicationId,
          attemptId: start.attempt.id,
          idempotencyKey: key("manual-reconcile-refused"),
          reconciliation: { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: false },
        }),
      ).rejects.toMatchObject({ code: "RECONCILIATION_REFUSED" });

      const notSubmitted = await store.reconcile({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        attemptId: start.attempt.id,
        idempotencyKey: key("manual-reconcile-not-submitted"),
        reconciliation: { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true },
      });
      expect(notSubmitted.view.application.status).toBe("approved");

      const retry = await store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: notSubmitted.view.application.revision,
        idempotencyKey: key("manual-retry"),
        current: context.manualCurrent,
        adapterId: "manual",
        adapterVersion: "none",
        manual: true,
      });
      expect(retry.kind).toBe("started");
      if (retry.kind === "started") expect(retry.attempt.sequence).toBe(2);
    });

    it("allows exactly one manual attempt when concurrent starts race", async () => {
      const context = await approvedManual();
      const raced = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          store.startAttempt({
            ownerUserId: context.ownerUserId,
            applicationId: context.applicationId,
            expectedRevision: context.approvedView.application.revision,
            idempotencyKey: key(`manual-race-${index}`),
            current: context.manualCurrent,
            adapterId: "manual",
            adapterVersion: "none",
            manual: true,
          }),
        ),
      );
      const accepted = raced.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.startAttempt>>> =>
          result.status === "fulfilled",
      );
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.value.kind).toBe("started");
      expect(accepted[0]?.value.view.attempts).toHaveLength(1);
      expect(raced.filter((result) => result.status === "rejected")).toHaveLength(7);
    });

    it("invalidates approval instead of starting manually when the packet was bound to an observed form", async () => {
      const context = await approved(); // the shared fixture always binds a form
      // The candidate now tries to submit manually even though the extension prepared this packet;
      // no form is observed here, so it is correctly treated as a changed binding.
      const manualCurrent = { ...bindings, formHash: null };
      const result = await store.startAttempt({
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("manual-mismatched-form"),
        current: manualCurrent,
        adapterId: "manual",
        adapterVersion: "none",
        manual: true,
      });
      expect(result.kind).toBe("approval_invalidated");
      if (result.kind === "approval_invalidated") {
        expect(result.reasons).toContain("form_changed");
      }
    });

    it("is idempotent: replaying the same manual start key returns the identical attempt, not a new one", async () => {
      const context = await approvedManual();
      const command = {
        ownerUserId: context.ownerUserId,
        applicationId: context.applicationId,
        expectedRevision: context.approvedView.application.revision,
        idempotencyKey: key("manual-replay"),
        current: context.manualCurrent,
        adapterId: "manual",
        adapterVersion: "none",
        manual: true,
      };
      const first = await store.startAttempt(command);
      const replay = await store.startAttempt(command);
      if (first.kind !== "started" || replay.kind !== "started") {
        throw new Error("started expected");
      }
      expect(replay.attempt.id).toBe(first.attempt.id);
      expect(replay.view.attempts).toHaveLength(1);
    });
  });
});
