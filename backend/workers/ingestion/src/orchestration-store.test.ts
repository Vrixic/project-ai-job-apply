import type {
  IngestionCheckpointDecision,
  IngestionOrchestrationStore,
  IngestionTransitionResult,
  NewIngestionDispatch,
  PersistedIngestionCheckpointV1,
  PersistedIngestionDispatch,
} from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import {
  createIngestionScheduleOccurrence,
  createPendingIngestionCheckpoint,
} from "./orchestration.js";
import { DurableIngestionCoordinator } from "./orchestration-store.js";
import { SourceRegistry } from "./registry.js";
import type { SourceNeutralIngestionRunner } from "./runner.js";

const leaseId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d";
const dispatchId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e2e";
const resumedDispatchId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e30";
const durableFunctionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:7";
const activityFunctionArn =
  "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:9";
const adapterConfigSha256 = "c".repeat(64);
const executionId = "a".repeat(64);

class MemoryStore implements IngestionOrchestrationStore {
  checkpoint?: Readonly<PersistedIngestionCheckpointV1>;
  dispatch?: PersistedIngestionDispatch;
  now = new Date("2026-08-16T12:00:00.000Z");
  recoverTransport = vi.fn().mockResolvedValue({ retried: 0, exhausted: 0 });
  recoverTerminal = vi.fn().mockResolvedValue(undefined);
  recordTerminal = vi.fn();
  startedForReconciliation: PersistedIngestionDispatch[] = [];

  async ensureScheduledOccurrence(
    checkpoint: PersistedIngestionCheckpointV1,
    dispatch: NewIngestionDispatch,
  ) {
    const created = !this.checkpoint;
    this.checkpoint ??= Object.freeze({ ...checkpoint });
    this.dispatch ??= {
      ...dispatch,
      state: "pending",
      publishAttempts: 0,
      nextAttemptAt: new Date(this.now),
    };
    return { checkpoint: this.checkpoint, dispatch: this.dispatch, created };
  }

  async getCheckpoint() {
    return this.checkpoint;
  }

  async authenticateActiveAttempt(
    _executionId: string,
    revision: number,
    leaseId: string,
    attempt: number,
    leaseExpiresAt: string,
  ) {
    if (
      this.checkpoint?.state !== "claimed" ||
      this.checkpoint.revision !== revision ||
      this.checkpoint.leaseId !== leaseId ||
      this.checkpoint.attempt !== attempt ||
      this.checkpoint.leaseExpiresAt !== leaseExpiresAt ||
      this.now.toISOString() >= leaseExpiresAt
    ) {
      throw new Error("The durable ingestion activity lease is stale");
    }
    return this.checkpoint;
  }

  async transitionCheckpoint(
    _executionId: string,
    expectedRevision: number,
    decide: IngestionCheckpointDecision,
  ): Promise<IngestionTransitionResult> {
    if (!this.checkpoint) throw new Error("missing checkpoint");
    const next = decide(this.checkpoint, new Date(this.now));
    const changed = JSON.stringify(next) !== JSON.stringify(this.checkpoint);
    if (changed && expectedRevision !== this.checkpoint.revision) throw new Error("stale revision");
    if (changed) this.checkpoint = Object.freeze({ ...next });
    return { changed, checkpoint: this.checkpoint, databaseNow: new Date(this.now) };
  }

  async ensureRecoveryDispatch(
    ...args: Parameters<IngestionOrchestrationStore["ensureRecoveryDispatch"]>
  ) {
    return this.recoverTerminal(...args);
  }

  async ensurePausedResumeDispatches(
    _sourceId: string,
    dispatchIds: readonly string[],
    durableArn: string,
    activityArn: string,
    configSha256: string,
  ) {
    if (this.checkpoint?.state !== "paused" || !this.dispatch || !dispatchIds[0]) return [];
    this.dispatch = {
      id: dispatchIds[0],
      executionId: this.checkpoint.executionId,
      generation: this.dispatch.generation + 1,
      checkpointRevision: this.checkpoint.revision,
      durableExecutionName: "b".repeat(64),
      durableFunctionArn: durableArn,
      activityFunctionArn: activityArn,
      adapterConfigSha256: configSha256,
      state: "pending",
      publishAttempts: 0,
      nextAttemptAt: new Date(this.now),
    };
    return [this.dispatch];
  }

  async recoverTransportDispatches(
    ...args: Parameters<IngestionOrchestrationStore["recoverTransportDispatches"]>
  ) {
    return this.recoverTransport(...args);
  }

  async listStartedDispatchesForReconciliation() {
    return this.startedForReconciliation;
  }

  async recordDurableTerminal(
    ...args: Parameters<IngestionOrchestrationStore["recordDurableTerminal"]>
  ) {
    this.recordTerminal(...args);
    const dispatch = this.startedForReconciliation[0];
    if (!dispatch) throw new Error("missing started dispatch");
    return { ...dispatch, state: "terminal" as const, terminalStatus: args[1] };
  }
}

function registry(enabled: boolean, adapterVersion = "synthetic-ingestion-v1"): SourceRegistry {
  return new SourceRegistry([
    {
      sourceId: "synthetic-foundation-v1",
      provider: "other",
      provenance: "authorized_fixture",
      enabled,
      adapter: {
        sourceId: "synthetic-foundation-v1",
        adapterVersion,
        poll: async () => ({ kind: "success", observations: [] }),
      },
    },
  ]);
}

function runner(result: object) {
  return { run: vi.fn().mockResolvedValue(result) } as unknown as SourceNeutralIngestionRunner;
}

function sequentialDispatchId(start: number): () => string {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, "0");
    value += 1;
    return `018f47a6-7b2c-7ee1-8c09-${suffix}`;
  };
}

describe("DurableIngestionCoordinator", () => {
  it("schedules exact replay and pauses before any source call while disabled", async () => {
    const store = new MemoryStore();
    const sourceRunner = runner({});
    const coordinator = new DurableIngestionCoordinator(store, registry(false), sourceRunner, {
      leaseId: () => leaseId,
      dispatchId: () => dispatchId,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    const input = {
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
    };
    expect(await coordinator.schedule(input)).toMatchObject({ created: true, dispatchId });
    expect(await coordinator.schedule(input)).toMatchObject({ created: false, dispatchId });
    expect(await coordinator.advance(store.checkpoint?.executionId ?? "")).toMatchObject({
      action: "terminal",
      disposition: { status: "paused", progressKnown: true, observationCount: 0 },
    });
    expect(sourceRunner.run).not.toHaveBeenCalled();
    const enabledCoordinator = new DurableIngestionCoordinator(
      store,
      registry(true),
      sourceRunner,
      {
        leaseId: () => leaseId,
        dispatchId: () => resumedDispatchId,
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      },
    );
    expect(await enabledCoordinator.resumePaused("synthetic-foundation-v1")).toBe(1);
    expect(store.dispatch).toMatchObject({
      id: resumedDispatchId,
      generation: 2,
      state: "pending",
    });
    expect(await enabledCoordinator.advance(store.checkpoint?.executionId ?? "")).toMatchObject({
      action: "run",
    });
  });

  it("does not double-run an active claim and fences its eventual settlement", async () => {
    const store = new MemoryStore();
    const occurrence = createIngestionScheduleOccurrence({
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
    });
    store.checkpoint = createPendingIngestionCheckpoint(occurrence);
    const sourceRunner = runner({
      sourceId: "synthetic-foundation-v1",
      status: "succeeded",
      observationCount: 1,
      createdCount: 1,
      updatedCount: 0,
    });
    const coordinator = new DurableIngestionCoordinator(store, registry(true), sourceRunner, {
      leaseId: () => leaseId,
      dispatchId: () => dispatchId,
      leaseMilliseconds: 60_000,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    const acquired = await coordinator.advance(occurrence.executionId);
    expect(acquired).toMatchObject({ action: "run", revision: 1, leaseId });
    expect(await coordinator.advance(occurrence.executionId)).toMatchObject({
      action: "wait",
      revision: 1,
      waitMilliseconds: 60_000,
    });
    if (acquired.action !== "run") throw new Error("expected acquired run");
    const settled = await coordinator.runAndSettle({
      executionId: occurrence.executionId,
      revision: acquired.revision,
      leaseId: acquired.leaseId,
      attempt: acquired.attempt,
      leaseExpiresAt: acquired.leaseExpiresAt,
      signal: new AbortController().signal,
    });
    expect(settled).toMatchObject({
      revision: 2,
      disposition: { action: "ack", status: "succeeded", observationCount: 1 },
    });
    expect(sourceRunner.run).toHaveBeenCalledTimes(1);
  });

  it("authenticates the exact attempt and unexpired database lease before the source runs", async () => {
    const store = new MemoryStore();
    const occurrence = createIngestionScheduleOccurrence({
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
    });
    store.checkpoint = createPendingIngestionCheckpoint(occurrence);
    const sourceRunner = runner({});
    const coordinator = new DurableIngestionCoordinator(store, registry(true), sourceRunner, {
      leaseId: () => leaseId,
      dispatchId: () => dispatchId,
      leaseMilliseconds: 60_000,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    const acquired = await coordinator.advance(occurrence.executionId);
    if (acquired.action !== "run") throw new Error("expected acquired run");
    await expect(
      coordinator.runAndSettle({
        executionId: occurrence.executionId,
        revision: acquired.revision,
        leaseId: acquired.leaseId,
        attempt: acquired.attempt + 1,
        leaseExpiresAt: acquired.leaseExpiresAt,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("lease is stale");
    store.now = new Date(acquired.leaseExpiresAt);
    await expect(
      coordinator.runAndSettle({
        executionId: occurrence.executionId,
        revision: acquired.revision,
        leaseId: acquired.leaseId,
        attempt: acquired.attempt,
        leaseExpiresAt: acquired.leaseExpiresAt,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("lease is stale");
    expect(sourceRunner.run).not.toHaveBeenCalled();
  });

  it("pauses an immutable occurrence instead of running a different adapter release", async () => {
    const store = new MemoryStore();
    const occurrence = createIngestionScheduleOccurrence({
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
    });
    store.checkpoint = createPendingIngestionCheckpoint(occurrence);
    const oldCoordinator = new DurableIngestionCoordinator(store, registry(true), runner({}), {
      leaseId: () => leaseId,
      dispatchId: () => dispatchId,
      leaseMilliseconds: 60_000,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    const acquired = await oldCoordinator.advance(occurrence.executionId);
    if (acquired.action !== "run") throw new Error("expected acquired run");
    const replacementRunner = runner({});
    const replacementCoordinator = new DurableIngestionCoordinator(
      store,
      registry(true, "generated.synthetic.v2"),
      replacementRunner,
      {
        leaseId: () => leaseId,
        dispatchId: () => dispatchId,
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
      },
    );
    await expect(
      replacementCoordinator.runAndSettle({
        executionId: occurrence.executionId,
        revision: acquired.revision,
        leaseId: acquired.leaseId,
        attempt: acquired.attempt,
        leaseExpiresAt: acquired.leaseExpiresAt,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ disposition: { action: "ack", status: "paused" } });
    expect(replacementRunner.run).not.toHaveBeenCalled();
  });

  it("recovers failed and lost transport with current immutable runtime identity", async () => {
    const store = new MemoryStore();
    const listStarted = vi.spyOn(store, "listStartedDispatchesForReconciliation");
    store.recoverTransport.mockResolvedValue({ retried: 1, exhausted: 0 });
    const coordinator = new DurableIngestionCoordinator(store, registry(true), runner({}), {
      leaseId: () => leaseId,
      dispatchId: sequentialDispatchId(0x30),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    });
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).resolves.toBe(1);
    expect(store.recoverTransport).toHaveBeenCalledWith("synthetic-foundation-v1");
    listStarted.mockClear();
    store.recoverTransport.mockResolvedValue({ retried: 0, exhausted: 1 });
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).rejects.toThrow(
      "IngestionTransportRecoveryExhausted",
    );
    expect(listStarted).not.toHaveBeenCalled();
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).rejects.toThrow(
      "IngestionTransportRecoveryExhausted",
    );
  });

  it("persists a started generation terminal before metadata-only recovery", async () => {
    const store = new MemoryStore();
    const started = {
      id: dispatchId,
      executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: "b".repeat(64),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
      state: "started",
      publishAttempts: 1,
      nextAttemptAt: new Date(store.now),
      durableExecutionArn: `${durableFunctionArn}/durable-execution/${"b".repeat(64)}/opaqueExecution01`,
      durableExecutionId: "opaqueExecution01",
    } as const;
    store.startedForReconciliation = [started];
    store.recoverTransport.mockResolvedValue({ retried: 1, exhausted: 0 });
    const getStatus = vi.fn().mockResolvedValue("RUNNING");
    const coordinator = new DurableIngestionCoordinator(store, registry(true), runner({}), {
      leaseId: () => leaseId,
      dispatchId: sequentialDispatchId(0x30),
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
      durableExecutionStatusReader: { getStatus },
    });
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).resolves.toBe(1);
    expect(store.recordTerminal).not.toHaveBeenCalled();

    getStatus.mockResolvedValue("FAILED");
    store.recoverTerminal.mockResolvedValue({ ...started, id: resumedDispatchId });
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).resolves.toBe(2);
    expect(store.recordTerminal).toHaveBeenCalledWith(
      started.durableExecutionName,
      "FAILED",
      started.durableExecutionArn,
      started.durableFunctionArn,
    );
    expect(store.recoverTerminal).toHaveBeenCalledWith(
      executionId,
      1,
      "018f47a6-7b2c-7ee1-8c09-000000000030",
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    );

    getStatus.mockRejectedValue(new Error("IngestionDurableReconciliationUnavailable"));
    await expect(coordinator.recoverTransport("synthetic-foundation-v1")).rejects.toThrow(
      "IngestionDurableReconciliationUnavailable",
    );
    expect(store.recoverTransport).toHaveBeenCalledTimes(3);
  });
});
