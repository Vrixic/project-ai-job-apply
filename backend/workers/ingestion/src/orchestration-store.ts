import {
  durableIngestionExecutionName,
  type IngestionOrchestrationStore,
  type PersistedIngestionCheckpointV1,
} from "@ai-job-apply/jobs-service";
import { v7 as uuidv7 } from "uuid";
import {
  acquireIngestionAttempt,
  createIngestionScheduleOccurrence,
  createPendingIngestionCheckpoint,
  failIngestionAttempt,
  type IngestionCheckpointV1,
  type IngestionDispatchDisposition,
  maximumIngestionLeaseMs,
  settleIngestionAttempt,
} from "./orchestration.js";
import type { SourceRegistry } from "./registry.js";
import type { SourceNeutralIngestionRunner } from "./runner.js";

export interface DurableIngestionCoordinatorOptions {
  leaseMilliseconds?: number;
  leaseId?: () => string;
  dispatchId?: () => string;
  durableFunctionArn?: string;
  activityFunctionArn?: string;
  adapterConfigSha256?: string;
  durableExecutionStatusReader?: {
    getStatus(
      executionArn: string,
    ): Promise<"RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "STOPPED">;
  };
}

export type DurableIngestionAdvanceResult =
  | {
      action: "run";
      executionId: string;
      revision: number;
      leaseId: string;
      leaseExpiresAt: string;
      attempt: number;
    }
  | {
      action: "wait";
      executionId: string;
      revision: number;
      waitMilliseconds: number;
    }
  | {
      action: "terminal";
      executionId: string;
      revision: number;
      disposition: IngestionDispatchDisposition;
    };

function asKernelCheckpoint(
  checkpoint: Readonly<PersistedIngestionCheckpointV1>,
): Readonly<IngestionCheckpointV1> {
  return checkpoint as Readonly<IngestionCheckpointV1>;
}

function asPersistedCheckpoint(
  checkpoint: Readonly<IngestionCheckpointV1>,
): Readonly<PersistedIngestionCheckpointV1> {
  return checkpoint as Readonly<PersistedIngestionCheckpointV1>;
}

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function waitUntil(timestamp: string, now: Date): number {
  return Math.max(
    1,
    Math.min(maximumIngestionLeaseMs, new Date(timestamp).getTime() - now.getTime()),
  );
}

export class DurableIngestionCoordinator {
  readonly #leaseMilliseconds: number;
  readonly #leaseId: () => string;
  readonly #dispatchId: () => string;
  readonly #durableFunctionArn: string | undefined;
  readonly #activityFunctionArn: string | undefined;
  readonly #adapterConfigSha256: string | undefined;
  readonly #durableExecutionStatusReader: DurableIngestionCoordinatorOptions["durableExecutionStatusReader"];

  constructor(
    private readonly store: IngestionOrchestrationStore,
    private readonly registry: SourceRegistry,
    private readonly runner: SourceNeutralIngestionRunner,
    options: DurableIngestionCoordinatorOptions,
  ) {
    this.#leaseMilliseconds = options.leaseMilliseconds ?? 5 * 60 * 1_000;
    if (
      !Number.isSafeInteger(this.#leaseMilliseconds) ||
      this.#leaseMilliseconds < 1_000 ||
      this.#leaseMilliseconds > maximumIngestionLeaseMs
    ) {
      throw new Error("The durable ingestion lease duration is invalid");
    }
    this.#leaseId = options.leaseId ?? uuidv7;
    this.#dispatchId = options.dispatchId ?? uuidv7;
    this.#durableFunctionArn = options.durableFunctionArn;
    this.#activityFunctionArn = options.activityFunctionArn;
    this.#adapterConfigSha256 = options.adapterConfigSha256;
    this.#durableExecutionStatusReader = options.durableExecutionStatusReader;
  }

  async schedule(input: {
    sourceId: string;
    adapterVersion: string;
    scheduledFor: string;
  }): Promise<{ executionId: string; created: boolean; dispatchId: string }> {
    if (!this.#durableFunctionArn || !this.#activityFunctionArn || !this.#adapterConfigSha256) {
      throw new Error("Exact ingestion runtime versions are required to schedule");
    }
    const occurrence = createIngestionScheduleOccurrence(input);
    const checkpoint = createPendingIngestionCheckpoint(occurrence);
    const dispatchId = this.#dispatchId();
    const result = await this.store.ensureScheduledOccurrence(asPersistedCheckpoint(checkpoint), {
      id: dispatchId,
      executionId: checkpoint.executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: durableIngestionExecutionName(checkpoint.executionId, 1),
      durableFunctionArn: this.#durableFunctionArn,
      activityFunctionArn: this.#activityFunctionArn,
      adapterConfigSha256: this.#adapterConfigSha256,
    });
    return {
      executionId: result.checkpoint.executionId,
      created: result.created,
      dispatchId: result.dispatch.id,
    };
  }

  async resumePaused(sourceId: string): Promise<number> {
    if (!this.#durableFunctionArn || !this.#activityFunctionArn || !this.#adapterConfigSha256) {
      throw new Error("Exact ingestion runtime versions are required to resume");
    }
    const dispatches = await this.store.ensurePausedResumeDispatches(
      sourceId,
      Array.from({ length: 25 }, () => this.#dispatchId()),
      this.#durableFunctionArn,
      this.#activityFunctionArn,
      this.#adapterConfigSha256,
    );
    return dispatches.length;
  }

  async recoverTransport(sourceId: string): Promise<number> {
    if (!this.#durableFunctionArn || !this.#activityFunctionArn || !this.#adapterConfigSha256) {
      throw new Error("Exact ingestion runtime versions are required to recover transport");
    }
    const transport = await this.store.recoverTransportDispatches(sourceId);
    if (transport.exhausted > 0) {
      throw new Error("IngestionTransportRecoveryExhausted");
    }
    let recoveredCount = transport.retried;
    const started = await this.store.listStartedDispatchesForReconciliation(sourceId, 25);
    if (started.length > 0 && !this.#durableExecutionStatusReader) {
      throw new Error("Exact durable execution reconciliation is required");
    }
    for (const dispatch of started) {
      if (!dispatch.durableExecutionArn) {
        throw new Error("The durable execution reconciliation identity is invalid");
      }
      const status = await this.#durableExecutionStatusReader?.getStatus(
        dispatch.durableExecutionArn,
      );
      if (status && status !== "RUNNING") {
        await this.store.recordDurableTerminal(
          dispatch.durableExecutionName,
          status,
          dispatch.durableExecutionArn,
          dispatch.durableFunctionArn,
        );
        const recovered = await this.store.ensureRecoveryDispatch(
          dispatch.executionId,
          dispatch.generation,
          this.#dispatchId(),
          this.#durableFunctionArn,
          this.#activityFunctionArn,
          this.#adapterConfigSha256,
        );
        if (recovered) recoveredCount += 1;
      }
    }
    return recoveredCount;
  }

  async advance(executionId: string): Promise<DurableIngestionAdvanceResult> {
    const current = await this.store.getCheckpoint(executionId);
    if (!current) throw new Error("The durable ingestion checkpoint was not found");
    if (current.state === "succeeded" || current.state === "dead_lettered") {
      const replay = acquireIngestionAttempt(asKernelCheckpoint(current), {
        expectedRevision: current.revision,
        leaseId: this.#leaseId(),
        leasedAt: current.scheduledFor,
        leaseExpiresAt: addMilliseconds(new Date(current.scheduledFor), this.#leaseMilliseconds),
        sourceEnabled: false,
      });
      if (replay.kind !== "terminal") throw new Error("The terminal ingestion replay is invalid");
      return {
        action: "terminal",
        executionId,
        revision: replay.checkpoint.revision,
        disposition: replay.disposition,
      };
    }
    const enabled = (() => {
      try {
        return (
          this.registry.requireEnabled(current.sourceId).adapter.adapterVersion ===
          current.adapterVersion
        );
      } catch {
        return false;
      }
    })();
    const transition = await this.store.transitionCheckpoint(
      executionId,
      current.revision,
      (stored, databaseNow) => {
        const checkpoint = asKernelCheckpoint(stored);
        if (checkpoint.state === "retry_wait" && databaseNow.toISOString() < checkpoint.retryAt) {
          return stored;
        }
        if (
          checkpoint.state === "claimed" &&
          databaseNow.toISOString() < checkpoint.leaseExpiresAt
        ) {
          return stored;
        }
        const leaseId = this.#leaseId();
        const result = acquireIngestionAttempt(checkpoint, {
          expectedRevision: checkpoint.revision,
          leaseId,
          leasedAt: databaseNow.toISOString(),
          leaseExpiresAt: addMilliseconds(databaseNow, this.#leaseMilliseconds),
          sourceEnabled: enabled,
        });
        return asPersistedCheckpoint(result.checkpoint);
      },
    );
    const checkpoint = asKernelCheckpoint(transition.checkpoint);
    if (checkpoint.state === "claimed" && transition.changed) {
      return {
        action: "run",
        executionId,
        revision: checkpoint.revision,
        leaseId: checkpoint.leaseId,
        leaseExpiresAt: checkpoint.leaseExpiresAt,
        attempt: checkpoint.attempt,
      };
    }
    if (checkpoint.state === "claimed") {
      return {
        action: "wait",
        executionId,
        revision: checkpoint.revision,
        waitMilliseconds: waitUntil(checkpoint.leaseExpiresAt, transition.databaseNow),
      };
    }
    if (checkpoint.state === "retry_wait") {
      return {
        action: "wait",
        executionId,
        revision: checkpoint.revision,
        waitMilliseconds: waitUntil(checkpoint.retryAt, transition.databaseNow),
      };
    }
    if (checkpoint.state === "paused") {
      return {
        action: "terminal",
        executionId,
        revision: checkpoint.revision,
        disposition: {
          schemaVersion: 1,
          executionId,
          sourceId: checkpoint.sourceId,
          withdrawalInferred: false,
          progressKnown: checkpoint.progressKnown,
          observationCount: checkpoint.observationCount,
          createdCount: checkpoint.createdCount,
          updatedCount: checkpoint.updatedCount,
          action: "ack",
          status: "paused",
        },
      };
    }
    throw new Error("The durable ingestion advance returned an invalid state");
  }

  async runAndSettle(input: {
    executionId: string;
    revision: number;
    leaseId: string;
    attempt: number;
    leaseExpiresAt: string;
    signal: AbortSignal;
  }): Promise<{
    disposition: IngestionDispatchDisposition;
    revision: number;
    waitMilliseconds?: number;
  }> {
    const checkpoint = await this.store.authenticateActiveAttempt(
      input.executionId,
      input.revision,
      input.leaseId,
      input.attempt,
      input.leaseExpiresAt,
    );
    let runResult: Awaited<ReturnType<SourceNeutralIngestionRunner["run"]>> | undefined;
    let runError: unknown;
    const enabled = (() => {
      try {
        return (
          this.registry.requireEnabled(checkpoint.sourceId).adapter.adapterVersion ===
          checkpoint.adapterVersion
        );
      } catch {
        return false;
      }
    })();
    if (enabled) {
      try {
        runResult = await this.runner.run(checkpoint.sourceId, checkpoint.attempt, input.signal);
      } catch (error) {
        runError = error;
      }
    } else {
      runError = new Error("IngestionAdapterVersionUnavailable");
    }
    const transitioned = await this.store.transitionCheckpoint(
      input.executionId,
      input.revision,
      (stored, databaseNow) => {
        const command = {
          expectedRevision: input.revision,
          leaseId: input.leaseId,
          settledAt: databaseNow.toISOString(),
          sourceEnabled: enabled,
        };
        const result = runResult
          ? settleIngestionAttempt(asKernelCheckpoint(stored), command, runResult)
          : failIngestionAttempt(asKernelCheckpoint(stored), command, runError);
        return asPersistedCheckpoint(result.checkpoint);
      },
    );
    const settled = asKernelCheckpoint(transitioned.checkpoint);
    if (settled.state === "claimed" || settled.state === "pending") {
      throw new Error("The durable ingestion activity did not settle");
    }
    if (
      settled.state === "dead_lettered" &&
      settled.failureCode === "recovery_generation_exhausted"
    ) {
      throw new Error("The durable ingestion activity became terminal through recovery exhaustion");
    }
    const replay = runResult
      ? settleIngestionAttempt(
          asKernelCheckpoint(checkpoint),
          {
            expectedRevision: input.revision,
            leaseId: input.leaseId,
            settledAt: settled.settledAt,
            sourceEnabled: enabled,
          },
          runResult,
        )
      : failIngestionAttempt(
          asKernelCheckpoint(checkpoint),
          {
            expectedRevision: input.revision,
            leaseId: input.leaseId,
            settledAt: settled.settledAt,
            sourceEnabled: enabled,
          },
          runError,
        );
    return {
      disposition: replay.disposition,
      revision: settled.revision,
      ...(settled.state === "retry_wait"
        ? {
            waitMilliseconds: Math.max(
              1,
              new Date(settled.retryAt).getTime() - new Date(settled.settledAt).getTime(),
            ),
          }
        : {}),
    };
  }
}
