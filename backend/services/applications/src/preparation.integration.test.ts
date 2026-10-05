import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FieldDefinition } from "./field-policy.js";
import { PreparationNotFoundError, type PreparationRequest } from "./preparation.js";
import { PreparationDispatchError, type PreparationTerminalInput } from "./preparation-dispatch.js";
import { ApplicationsService, toApiPreparation } from "./service.js";
import {
  ApplicationIdempotencyConflictError,
  ApplicationNotFoundError,
  ApplicationRevisionConflictError,
  PostgresApplicationStore,
} from "./store.js";
import { definitions, FACT_A, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const execute = promisify(execFile);
const context = { jobContextHash: HASH_A, confirmedFactsHash: HASH_B };
const startTime = new Date("2026-10-02T12:00:00.000Z");

(databaseUrl ? describe : describe.skip)("durable packet preparation transactions", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 6,
    onnotice: () => undefined,
  });
  let now = new Date(startTime);
  const fields = new Map(definitions);
  fields.set("documents.cover_letter", {
    key: "documents.cover_letter",
    label: "Cover letter",
    valueType: "file",
    sensitivity: "confidential",
    answerPolicy: "explicit_each_time",
  } satisfies FieldDefinition);
  const store = new PostgresApplicationStore(client, () => now, { definitions: fields });

  beforeAll(async () => {
    for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      const env = { ...process.env, DATABASE_URL: databaseUrl };
      const first = await execute(
        process.execPath,
        [fileURLToPath(new URL(path, import.meta.url))],
        { env },
      );
      const replay = await execute(
        process.execPath,
        [fileURLToPath(new URL(path, import.meta.url))],
        { env },
      );
      expect(first.stdout).toBe(replay.stdout);
    }
  });
  afterAll(async () => {
    await client.end();
  });

  async function withApplication(run: (owner: string, applicationId: string) => Promise<void>) {
    now = new Date(startTime);
    const owner = uuidv7();
    await client`INSERT INTO identity.users (id) VALUES (${owner})`;
    const created = await store.createApplication({
      ownerUserId: owner,
      canonicalJobId: uuidv7(),
      idempotencyKey: `create-${uuidv7()}`,
    });
    try {
      await run(owner, created.view.application.id);
    } finally {
      const operationId = uuidv7();
      const requestId = uuidv7();
      await client`
        INSERT INTO platform.operations (id, user_id, kind, state)
        VALUES (${operationId}, ${owner}, 'account_deletion', 'queued')
      `;
      await client`
        INSERT INTO profile.account_deletion_requests (
          id, user_id, operation_id, policy_version, state, version, confirmed_at, backup_expires_at
        ) VALUES (${requestId}, ${owner}, ${operationId}, 'synthetic-preparation-v1',
          'quarantined', 2, now(), now() + interval '35 days')
      `;
      await client`
        INSERT INTO privacy.account_deletion_ledger (
          request_id, subject_digest, policy_version, policy_sha256, state,
          owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at
        ) VALUES (${requestId}, ${HASH_A}, 'synthetic-preparation-v1', ${HASH_B}, 'quarantined',
          '{"applications":"pending"}'::jsonb, '{}'::jsonb, now(), now() + interval '35 days')
      `;
      await client`SELECT applications.delete_candidate_data(${owner}::uuid, ${requestId}::uuid)`;
      await client`DELETE FROM identity.users WHERE id = ${owner}`;
      await client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
    }
  }

  const command = (ownerUserId: string, applicationId: string) => ({
    ownerUserId,
    applicationId,
    idempotencyKey: `prepare-${uuidv7()}`,
    context,
    request: {
      expectedRevision: 1,
      coverLetter: { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true } },
    } satisfies PreparationRequest,
    packet: {
      jobRevision: HASH_A,
      form: null,
      fields: [proposal()],
      artifactHashes: { resume: HASH_C },
    },
  });
  async function eventId(preparationId: string) {
    const [event] = await client<Array<{ id: string }>>`
      SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${preparationId}
    `;
    if (!event) throw new Error("Synthetic preparation event missing");
    return event.id;
  }
  const functionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation:7";
  async function dispatchFor(owner: string, app: string) {
    const queued = await store.queuePreparation(command(owner, app));
    const event = await eventId(queued.preparation.id);
    const claim = await store.claimPreparationDispatch(event, functionArn);
    if (claim.kind !== "claimed" || !claim.dispatch.leaseId)
      throw new Error("Synthetic dispatch claim missing");
    const executionArn = `${functionArn}/durable-execution/${claim.dispatch.executionName}/synthetic-execution-v1`;
    const terminal: PreparationTerminalInput = {
      eventId: event,
      preparationId: queued.preparation.id,
      functionArn,
      executionName: claim.dispatch.executionName,
      executionArn,
      status: "FAILED",
      startTimestamp: new Date(now),
      endTimestamp: new Date(now.getTime() + 1_000),
    };
    return { queued, event, claim: claim.dispatch, terminal, executionArn };
  }

  it("atomically accepts one packet, operation, identifier-only event, audit and command receipt", async () => {
    await withApplication(async (owner, app) => {
      const input = command(owner, app);
      const [first, second] = await Promise.all([
        store.queuePreparation(input),
        store.queuePreparation(input),
      ]);
      expect(first.preparation.id).toBe(second.preparation.id);
      expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
      expect(first.preparation.expectedRevision).toBe(2);
      expect(first.preparation.expiresAt.getTime() - first.preparation.approvedAt.getTime()).toBe(
        900_000,
      );
      const [event] = await client`
        SELECT payload FROM applications.preparation_outbox WHERE preparation_id = ${first.preparation.id}
      `;
      expect(event?.payload).toEqual({ preparationId: first.preparation.id });
      expect(first.view.currentPacket?.fields[0]?.value).toBe("candidate@example.test");
      const [{ count } = { count: 0 }] = await client<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM applications.packets WHERE application_id = ${app}
      `;
      expect(count).toBe(1);
      await expect(
        store.queuePreparation({
          ...input,
          request: {
            ...input.request,
            userEntries: [{ fieldKey: "contact.email", value: "other@example.test" }],
          },
        }),
      ).rejects.toThrow(ApplicationIdempotencyConflictError);
      await expect(
        store.queuePreparation({
          ...input,
          idempotencyKey: `other-${uuidv7()}`,
          request: { ...input.request, expectedRevision: 2 },
        }),
      ).rejects.toThrow(ApplicationRevisionConflictError);
      await expect(store.getPreparation(uuidv7(), app, first.preparation.id)).rejects.toThrow(
        PreparationNotFoundError,
      );
    });
  });

  it("claims generation exactly once and finalizes one mandatory-review hash-bound packet", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const id = queued.preparation.id;
      const event = await eventId(id);
      const claims = await Promise.all([
        store.claimPreparationGeneration(event, id, context),
        store.claimPreparationGeneration(event, id, context),
      ]);
      expect(claims.map((claim) => claim.kind).sort()).toEqual(["already_claimed", "claimed"]);
      const letter = { contentSha256: "d".repeat(64), sourceFactIds: [FACT_A], confidence: 0.95 };
      const [complete, replay] = await Promise.all([
        store.completePreparation(event, id, context, letter),
        store.completePreparation(event, id, context, letter),
      ]);
      expect(complete).toEqual(replay);
      expect(complete.state).toBe("succeeded");
      const view = await store.getApplication(owner, app);
      expect(view.currentPacket?.version).toBe(2);
      expect(view.application.revision).toBe(3);
      expect(view.currentPacket?.artifactHashes.coverLetter).toBe(letter.contentSha256);
      expect(
        view.currentPacket?.fields.find((field) => field.fieldKey === "documents.cover_letter"),
      ).toMatchObject({ origin: "generated", requiresReview: true, sourceFactIds: [FACT_A] });
      expect(view.approval).toBeNull();
      expect((await store.failPreparation(event, id, "render_failed")).state).toBe("succeeded");
      await expect(store.getPreparationForEvent(uuidv7(), id)).rejects.toThrow(
        PreparationNotFoundError,
      );
    });
  });

  it.each(["live", "expired", "foreign_owner"])(
    "completes only the original %s cover-letter metadata without content persistence",
    async (condition) => {
      await withApplication(async (owner, app) => {
        const queued = await store.queuePreparation(command(owner, app));
        const id = queued.preparation.id;
        const event = await eventId(id);
        expect((await store.claimPreparationGeneration(event, id, context)).kind).toBe("claimed");
        const completedAtMs = now.getTime() - (condition === "expired" ? 1_800_000 : 1);
        const temporaryMaterial: TemporaryMaterialReference = {
          schemaVersion: 1,
          kind: "cover_letter",
          generationId: uuidv7(),
          ownerUserId: owner,
          applicationId: app,
          version: 1,
          contentSha256: HASH_C,
          completedAtMs,
          expiresAtMs: completedAtMs + 1_800_000,
        };
        if (condition === "foreign_owner") temporaryMaterial.ownerUserId = uuidv7();
        const letter = {
          contentSha256: HASH_C,
          sourceFactIds: [FACT_A],
          confidence: 1,
          temporaryMaterial,
        };
        if (condition === "foreign_owner") {
          await expect(store.completePreparation(event, id, context, letter)).rejects.toThrow(
            "Invalid original cover-letter material binding",
          );
          expect((await store.getPreparation(owner, app, id)).state).toBe("running");
          return;
        }
        const completed = await store.completePreparation(event, id, context, letter);
        expect(completed.state).toBe(condition === "live" ? "succeeded" : "failed");
        const view = await store.getApplication(owner, app);
        if (condition === "expired") {
          expect(completed.errorCode).toBe("bindings_changed");
          expect(view.application.revision).toBe(queued.view.application.revision);
          expect(view.currentPacket?.temporaryMaterials).toBeUndefined();
        } else {
          expect(view.currentPacket?.temporaryMaterials).toEqual([temporaryMaterial]);
          expect(
            view.currentPacket?.fields.find((field) => field.fieldKey === "documents.cover_letter"),
          ).toMatchObject({ value: HASH_C, requiresReview: true });
          expect(view.approval).toBeNull();
          expect(await store.completePreparation(event, id, context, letter)).toEqual(completed);
          const [eventRow] =
            await client`SELECT payload FROM applications.preparation_outbox WHERE id = ${event}`;
          expect(eventRow?.payload).toEqual({ preparationId: id });
        }
      });
    },
  );

  it("replays an owned receipt after later application changes without renewing consent or creating rows", async () => {
    await withApplication(async (owner, app) => {
      const input = command(owner, app);
      expect(await store.replayPreparation(input)).toBeNull();
      const queued = await store.queuePreparation(input);
      now = new Date(startTime.getTime() + 900_001);
      await store.cancel({
        ownerUserId: owner,
        applicationId: app,
        expectedRevision: 2,
        idempotencyKey: `cancel-${uuidv7()}`,
      });
      expect(await store.replayPreparation(input)).toEqual(queued.preparation);
      await expect(
        store.replayPreparation({ ...input, request: { ...input.request, expectedRevision: 2 } }),
      ).rejects.toThrow(ApplicationIdempotencyConflictError);
      await expect(store.replayPreparation({ ...input, ownerUserId: uuidv7() })).rejects.toThrow();
      await expect(store.replayPreparation({ ...input, applicationId: uuidv7() })).rejects.toThrow(
        ApplicationNotFoundError,
      );
      const [count] = await client<Array<{ preparations: number; packets: number }>>`
        SELECT (SELECT count(*)::int FROM applications.packet_preparations WHERE application_id = ${app}) AS preparations,
          (SELECT count(*)::int FROM applications.packets WHERE application_id = ${app}) AS packets
      `;
      expect(count).toEqual({ preparations: 1, packets: 1 });
    });
  });

  it("connects service acceptance/status to real owner transactions and stable terminal results", async () => {
    await withApplication(async (owner, app) => {
      const input = command(owner, app);
      let contextReads = 0;
      let packetReads = 0;
      const service = new ApplicationsService({
        store,
        preparations: store,
        packets: {
          prepare: async () => {
            packetReads++;
            return input.packet;
          },
        },
        bindings: { resolve: async () => ({ jobRevision: HASH_A, formHash: null }) },
        jobs: { isActive: async () => true },
        coverLetters: {
          context: async () => {
            contextReads++;
            return context;
          },
          preview: async () => ({ status: "no_cover_letter", matchesPacket: false }),
          binding: async () => undefined,
          file: async () => {
            throw new Error("Synthetic unexpected file request");
          },
        },
      });
      const queued = await service.prepareCoverLetter(
        owner,
        app,
        input.request,
        input.idempotencyKey,
      );
      expect(queued.state).toBe("queued");
      const event = await eventId(queued.id);
      await store.claimPreparationGeneration(event, queued.id, context);
      const completed = await store.completePreparation(event, queued.id, context, {
        contentSha256: "d".repeat(64),
        sourceFactIds: [FACT_A],
        confidence: 0.95,
      });
      const stable = toApiPreparation(completed);
      expect(await service.preparation(owner, app, queued.id)).toEqual(stable);
      await store.cancel({
        ownerUserId: owner,
        applicationId: app,
        expectedRevision: 3,
        idempotencyKey: `cancel-${uuidv7()}`,
      });
      now = new Date(startTime.getTime() + 900_001);
      expect(
        await service.prepareCoverLetter(owner, app, input.request, input.idempotencyKey),
      ).toEqual(stable);
      expect(await service.preparation(owner, app, queued.id)).toEqual(stable);
      expect(contextReads).toBe(1);
      expect(packetReads).toBe(1);
      expect(stable.result).toEqual({ packetId: completed.resultPacketId, revision: 3 });
      await expect(service.preparation(uuidv7(), app, queued.id)).rejects.toThrow(
        PreparationNotFoundError,
      );
    });
  });

  it.each(["disclosure_expired", "bindings_changed", "application_changed"] as const)(
    "withholds provider dispatch for %s",
    async (reason) => {
      await withApplication(async (owner, app) => {
        const queued = await store.queuePreparation(command(owner, app));
        const id = queued.preparation.id;
        if (reason === "disclosure_expired") now = new Date(startTime.getTime() + 900_001);
        if (reason === "application_changed")
          await store.cancel({
            ownerUserId: owner,
            applicationId: app,
            expectedRevision: 2,
            idempotencyKey: `cancel-${uuidv7()}`,
          });
        const claim = await store.claimPreparationGeneration(
          await eventId(id),
          id,
          reason === "bindings_changed" ? { ...context, confirmedFactsHash: HASH_C } : context,
        );
        expect(claim.kind).toBe("terminal");
        expect(claim.preparation.errorCode).toBe(reason);
        expect(claim.preparation.generationClaimedAt).toBeNull();
      });
    },
  );

  it("refuses changed evidence after dispatch without superseding the base packet", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const id = queued.preparation.id;
      const event = await eventId(id);
      await store.claimPreparationGeneration(event, id, context);
      const completed = await store.completePreparation(
        event,
        id,
        { ...context, jobContextHash: HASH_C },
        { contentSha256: "d".repeat(64), sourceFactIds: [FACT_A], confidence: 0.95 },
      );
      expect(completed).toMatchObject({
        state: "failed",
        errorCode: "bindings_changed",
        resultPacketId: null,
      });
      expect((await store.getApplication(owner, app)).currentPacket?.id).toBe(
        queued.preparation.basePacketId,
      );
    });
  });

  it("refuses a foreign preparation nudge before mutating dispatch metadata", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const event = await eventId(queued.preparation.id);
      expect(await store.claimPreparationDispatch(event, functionArn, uuidv7())).toEqual({
        kind: "missing",
      });
      const [row] =
        await client`SELECT workflow_function_arn, dispatch_lease_id FROM applications.preparation_outbox WHERE id = ${event}`;
      expect(row).toMatchObject({ workflow_function_arn: null, dispatch_lease_id: null });
      expect(
        (await store.claimPreparationDispatch(event, functionArn, queued.preparation.id)).kind,
      ).toBe("claimed");
    });
  });

  it("pins one dispatch version and uses bounded leases under concurrent duplicate delivery", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const event = await eventId(queued.preparation.id);
      const claims = await Promise.all([
        store.claimPreparationDispatch(event, functionArn),
        store.claimPreparationDispatch(event, functionArn),
      ]);
      expect(claims.map((claim) => claim.kind).sort()).toEqual(["busy", "claimed"]);
      const first = claims.find((claim) => claim.kind === "claimed");
      if (first?.kind !== "claimed") throw new Error("Synthetic claim missing");
      now = new Date(now.getTime() + 60_000);
      const next = await store.claimPreparationDispatch(event, functionArn.replace(":7", ":8"));
      if (next.kind !== "claimed") throw new Error("Synthetic recovery claim missing");
      expect(next.dispatch.functionArn).toBe(functionArn);
      expect(next.dispatch.executionName).toBe(first.dispatch.executionName);
      expect(next.dispatch.leaseId).not.toBe(first.dispatch.leaseId);
      expect(next.dispatch.boundAt).toEqual(first.dispatch.boundAt);
      const arn = `${functionArn}/durable-execution/${next.dispatch.executionName}/synthetic-execution-v1`;
      expect(await store.markPreparationStarted(event, first.dispatch.leaseId ?? "", arn)).toBe(
        false,
      );
      await expect(
        store.markPreparationStarted(event, next.dispatch.leaseId ?? "", arn.replace(":7/", ":8/")),
      ).rejects.toThrow(PreparationDispatchError);
      expect(await store.markPreparationStarted(event, next.dispatch.leaseId ?? "", arn)).toBe(
        true,
      );
      expect(await store.markPreparationStarted(event, next.dispatch.leaseId ?? "", arn)).toBe(
        true,
      );
      expect((await store.claimPreparationDispatch(event, functionArn)).kind).toBe("started");
      now = new Date(now.getTime() + 60_000);
      expect(
        (await store.claimPreparationExecutionsForReconciliation(25)).some(
          (row) => row.eventId === event,
        ),
      ).toBe(true);
    });
  });

  it("claims a nudge once per bounded interval without prematurely recording publication", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const event = await eventId(queued.preparation.id);
      const claims = await Promise.all([
        store.claimPreparationNudges(25),
        store.claimPreparationNudges(25),
      ]);
      expect(claims.flat().filter((row) => row.eventId === event)).toHaveLength(1);
      const [row] =
        await client`SELECT published_at FROM applications.preparation_outbox WHERE id = ${event}`;
      expect(row?.published_at).toBeNull();
      now = new Date(now.getTime() + 60_000);
      expect((await store.claimPreparationNudges(25)).some((row) => row.eventId === event)).toBe(
        true,
      );
      for (const limit of [0, 26, 1.5, Number.NaN]) {
        await expect(store.claimPreparationNudges(limit)).rejects.toThrow(PreparationDispatchError);
        await expect(store.claimPreparationExecutionsForReconciliation(limit)).rejects.toThrow(
          PreparationDispatchError,
        );
      }
    });
  });

  it("leases fair status polls without duplicate concurrent claims or oldest-row starvation", async () => {
    await withApplication(async (owner, app) => {
      const first = await dispatchFor(owner, app);
      await store.markPreparationStarted(
        first.event,
        first.claim.leaseId ?? "",
        first.executionArn,
      );
      await withApplication(async (otherOwner, otherApp) => {
        const second = await dispatchFor(otherOwner, otherApp);
        await store.markPreparationStarted(
          second.event,
          second.claim.leaseId ?? "",
          second.executionArn,
        );
        now = new Date(now.getTime() + 60_000);
        const claims = await Promise.all([
          store.claimPreparationExecutionsForReconciliation(1),
          store.claimPreparationExecutionsForReconciliation(1),
        ]);
        expect(
          claims
            .flat()
            .map((row) => row.eventId)
            .sort(),
        ).toEqual([first.event, second.event].sort());
        expect(await store.claimPreparationExecutionsForReconciliation(25)).toEqual([]);
        now = new Date(now.getTime() + 60_000);
        expect(await store.claimPreparationExecutionsForReconciliation(25)).toHaveLength(2);
        expect(await store.getPreparationDispatch(first.event)).toMatchObject({
          preparationId: first.queued.preparation.id,
          executionArn: first.executionArn,
        });
        expect(await store.getPreparationDispatch(uuidv7())).toBeUndefined();
      });
    });
  });

  it("rejects incomplete binding tuples and infinite scheduling timestamps in SQL", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      const event = await eventId(queued.preparation.id);
      for (const statement of [
        client`UPDATE applications.preparation_outbox SET workflow_function_arn = ${functionArn} WHERE id = ${event}`,
        client`UPDATE applications.preparation_outbox SET workflow_function_arn = ${functionArn}, bound_at = ${now} WHERE id = ${event}`,
        client`UPDATE applications.preparation_outbox SET nudge_claimed_at = 'infinity'::timestamptz WHERE id = ${event}`,
        client`UPDATE applications.preparation_outbox SET dispatch_lease_id = ${uuidv7()} WHERE id = ${event}`,
      ])
        await expect(statement).rejects.toMatchObject({ code: "23514" });
      expect(await store.getPreparationDispatch(event)).toBeUndefined();
    });
  });

  it("recovers a lost start receipt atomically with terminal failure and one audit", async () => {
    await withApplication(async (owner, app) => {
      const fixture = await dispatchFor(owner, app);
      now = new Date(now.getTime() + 2_000);
      await expect(
        store.settlePreparationExecution({
          ...fixture.terminal,
          functionArn: functionArn.replace(":7", ":8"),
        }),
      ).rejects.toThrow(PreparationDispatchError);
      expect((await store.getPreparation(owner, app, fixture.queued.preparation.id)).state).toBe(
        "queued",
      );
      const result = await Promise.all([
        store.settlePreparationExecution(fixture.terminal),
        store.settlePreparationExecution(fixture.terminal),
      ]);
      expect(result).toEqual([true, true]);
      expect(await store.getPreparation(owner, app, fixture.queued.preparation.id)).toMatchObject({
        state: "failed",
        errorCode: "generation_unavailable",
      });
      const [event] =
        await client`SELECT durable_execution_arn, terminal_status, dispatch_lease_id FROM applications.preparation_outbox WHERE id = ${fixture.event}`;
      expect(event).toMatchObject({
        durable_execution_arn: fixture.executionArn,
        terminal_status: "FAILED",
        dispatch_lease_id: null,
      });
      const audits =
        await client`SELECT action FROM applications.preparation_audit WHERE preparation_id = ${fixture.queued.preparation.id} AND action = 'failed'`;
      expect(audits).toHaveLength(1);
      await expect(
        store.settlePreparationExecution({ ...fixture.terminal, status: "SUCCEEDED" }),
      ).rejects.toThrow(PreparationDispatchError);
    });
  });

  it("AWS success cannot promote a still-active preparation to a successful draft", async () => {
    await withApplication(async (owner, app) => {
      const fixture = await dispatchFor(owner, app);
      now = new Date(now.getTime() + 2_000);
      await store.settlePreparationExecution({ ...fixture.terminal, status: "SUCCEEDED" });
      expect(await store.getPreparation(owner, app, fixture.queued.preparation.id)).toMatchObject({
        state: "failed",
        resultPacketId: null,
      });
    });
  });

  it("a failed workflow cannot downgrade an already-successful preparation", async () => {
    await withApplication(async (owner, app) => {
      const fixture = await dispatchFor(owner, app);
      const id = fixture.queued.preparation.id;
      await store.claimPreparationGeneration(fixture.event, id, context);
      await store.completePreparation(fixture.event, id, context, {
        contentSha256: HASH_C,
        sourceFactIds: [FACT_A],
        confidence: 0.95,
      });
      // Even with lost start ACK, recover its original version/name after operation completion.
      now = new Date(now.getTime() + 60_000);
      const recovered = await store.claimPreparationDispatch(
        fixture.event,
        functionArn.replace(":7", ":8"),
      );
      expect(recovered.kind).toBe("claimed");
      await store.settlePreparationExecution(fixture.terminal);
      expect((await store.getPreparation(owner, app, id)).state).toBe("succeeded");
    });
  });

  it("refuses dispatch of expired or candidate-changed queued work without external start", async () => {
    await withApplication(async (owner, app) => {
      const queued = await store.queuePreparation(command(owner, app));
      now = new Date(now.getTime() + 900_001);
      expect(
        (await store.claimPreparationDispatch(await eventId(queued.preparation.id), functionArn))
          .kind,
      ).toBe("terminal");
      expect((await store.getPreparation(owner, app, queued.preparation.id)).errorCode).toBe(
        "disclosure_expired",
      );
    });
  });

  it("enforces immutable event/version/start/terminal metadata and strict binding tuples in SQL", async () => {
    await withApplication(async (owner, app) => {
      const fixture = await dispatchFor(owner, app);
      for (const statement of [
        client`UPDATE applications.preparation_outbox SET payload = '{}'::jsonb WHERE id = ${fixture.event}`,
        client`UPDATE applications.preparation_outbox SET workflow_function_arn = ${functionArn.replace(":7", ":8")} WHERE id = ${fixture.event}`,
        client`UPDATE applications.preparation_outbox SET dispatch_lease_id = ${uuidv7()} WHERE id = ${fixture.event}`,
      ])
        await expect(statement).rejects.toMatchObject({ code: "55000" });
      now = new Date(now.getTime() + 2_000);
      await store.settlePreparationExecution(fixture.terminal);
      await expect(
        client`UPDATE applications.preparation_outbox SET terminal_status = 'SUCCEEDED' WHERE id = ${fixture.event}`,
      ).rejects.toMatchObject({ code: "55000" });
    });
  });
});
