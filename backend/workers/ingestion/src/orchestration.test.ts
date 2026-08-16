import { describe, expect, it } from "vitest";
import type { IngestionRunResult } from "./contract.js";
import {
  type AcquireIngestionAttemptCommand,
  acquireIngestionAttempt,
  type ClaimedIngestionCheckpointV1,
  createIngestionScheduleOccurrence,
  createPendingIngestionCheckpoint,
  deterministicIngestionRetryDelayMs,
  failIngestionAttempt,
  type IngestionCheckpointV1,
  type IngestionScheduleOccurrenceV1,
  ingestionExecutionIdFor,
  maximumIngestionAttempts,
  type SettleIngestionAttemptCommand,
  settleIngestionAttempt,
} from "./orchestration.js";
import { SourceBatchContractError } from "./runner.js";

const sourceId = "synthetic-foundation-v1";
const adapterVersion = "synthetic-ingestion-v1";
const scheduledFor = "2026-08-16T12:00:00.000Z";
const leasedAt = "2026-08-16T12:00:01.000Z";
const leaseExpiresAt = "2026-08-16T12:05:01.000Z";
const settledAt = "2026-08-16T12:00:02.000Z";
const leaseIds = [
  "019c9e30-0000-7000-8000-000000000001",
  "019c9e30-0000-7000-8000-000000000002",
  "019c9e30-0000-7000-8000-000000000003",
  "019c9e30-0000-7000-8000-000000000004",
  "019c9e30-0000-7000-8000-000000000005",
] as const;

function occurrence(): Readonly<IngestionScheduleOccurrenceV1> {
  return createIngestionScheduleOccurrence({ sourceId, adapterVersion, scheduledFor });
}

function pending() {
  return createPendingIngestionCheckpoint(occurrence());
}

function claimCommand(
  overrides: Partial<AcquireIngestionAttemptCommand> = {},
): AcquireIngestionAttemptCommand {
  return {
    expectedRevision: 0,
    leaseId: leaseIds[0],
    leasedAt,
    leaseExpiresAt,
    sourceEnabled: true,
    ...overrides,
  };
}

function claimed(
  checkpoint: IngestionCheckpointV1 = pending(),
  overrides: Partial<AcquireIngestionAttemptCommand> = {},
): ClaimedIngestionCheckpointV1 {
  const result = acquireIngestionAttempt(
    checkpoint,
    claimCommand({ expectedRevision: checkpoint.revision, ...overrides }),
  );
  if (result.kind !== "acquired") throw new Error("The test checkpoint was not acquired");
  return result.checkpoint;
}

function settleCommand(
  checkpoint: ClaimedIngestionCheckpointV1,
  overrides: Partial<SettleIngestionAttemptCommand> = {},
): SettleIngestionAttemptCommand {
  return {
    expectedRevision: checkpoint.revision,
    leaseId: checkpoint.leaseId,
    settledAt,
    sourceEnabled: true,
    ...overrides,
  };
}

function success(observationCount = 2, createdCount = 1, updatedCount = 1): IngestionRunResult {
  return {
    sourceId,
    status: "succeeded",
    observationCount,
    createdCount,
    updatedCount,
  };
}

function retry(retryAfterMs = 10_000): IngestionRunResult {
  return {
    sourceId,
    status: "retry",
    observationCount: 0,
    createdCount: 0,
    updatedCount: 0,
    reason: "source_unavailable",
    retryAfterMs,
  };
}

describe("source-neutral ingestion orchestration protocol", () => {
  it("derives one immutable execution identity from the exact source, adapter, and UTC slot", () => {
    const first = occurrence();
    const second = occurrence();

    expect(first).toEqual(second);
    expect(first.executionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(
      ingestionExecutionIdFor({
        sourceId,
        adapterVersion: "synthetic-ingestion-v2",
        scheduledFor,
      }),
    ).not.toBe(first.executionId);
    expect(
      ingestionExecutionIdFor({
        sourceId,
        adapterVersion,
        scheduledFor: "2026-08-16T12:05:00.000Z",
      }),
    ).not.toBe(first.executionId);
  });

  it("rejects noncanonical occurrences and unsupported fields", () => {
    expect(() =>
      createIngestionScheduleOccurrence({
        sourceId,
        adapterVersion,
        scheduledFor: "2026-08-16T12:00:00Z",
      }),
    ).toThrow("occurrence is invalid");
    expect(() =>
      createIngestionScheduleOccurrence({
        sourceId,
        adapterVersion,
        scheduledFor,
        rawSourceUrl: "https://private.invalid/token",
      } as never),
    ).toThrow("occurrence is invalid");
    expect(() =>
      createPendingIngestionCheckpoint({
        ...occurrence(),
        executionId: "0".repeat(64),
      }),
    ).toThrow("occurrence is invalid");
  });

  it("acquires a bounded fenced lease and makes exact claim replay idempotent", () => {
    const initial = pending();
    const command = claimCommand();
    const first = acquireIngestionAttempt(initial, command);
    expect(first).toMatchObject({ kind: "acquired", changed: true });
    if (first.kind !== "acquired") throw new Error("Expected an acquired checkpoint");
    expect(first.checkpoint).toMatchObject({
      state: "claimed",
      revision: 1,
      attempt: 1,
      leaseId: command.leaseId,
      priorProgressUnknown: false,
      withdrawalInferred: false,
    });
    expect(Object.isFrozen(first.checkpoint)).toBe(true);

    const replay = acquireIngestionAttempt(first.checkpoint, command);
    expect(replay).toMatchObject({ kind: "acquired", changed: false });
    expect(replay.checkpoint).toBe(first.checkpoint);
  });

  it("rejects stale revisions, competing leases, and unbounded lease windows", () => {
    const active = claimed();
    expect(() => acquireIngestionAttempt(active, claimCommand({ leaseId: leaseIds[1] }))).toThrow(
      "different active lease",
    );
    expect(() => acquireIngestionAttempt(pending(), claimCommand({ expectedRevision: 1 }))).toThrow(
      "revision is stale",
    );
    expect(() =>
      acquireIngestionAttempt(
        pending(),
        claimCommand({ leaseExpiresAt: "2026-08-16T12:15:01.001Z" }),
      ),
    ).toThrow("claim command is invalid");
    expect(() =>
      acquireIngestionAttempt(pending(), claimCommand({ leaseId: leaseIds[0].toUpperCase() })),
    ).toThrow("claim command is invalid");
    expect(() =>
      acquireIngestionAttempt(
        pending(),
        claimCommand({
          leasedAt: "2026-08-16T11:59:59.000Z",
          leaseExpiresAt: "2026-08-16T12:04:59.000Z",
        }),
      ),
    ).toThrow("schedule occurrence is not eligible yet");
    expect(() =>
      acquireIngestionAttempt(
        { ...pending(), revision: Number.MAX_SAFE_INTEGER },
        claimCommand({ expectedRevision: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow("revision cannot advance");
  });

  it("reclaims an expired lease on the same attempt and fences the crashed worker", () => {
    const expired = claimed();
    const replacementCommand = claimCommand({
      expectedRevision: expired.revision,
      leaseId: leaseIds[1],
      leasedAt: expired.leaseExpiresAt,
      leaseExpiresAt: "2026-08-16T12:10:01.000Z",
    });
    const replacement = acquireIngestionAttempt(expired, replacementCommand);
    expect(replacement).toMatchObject({
      kind: "acquired",
      changed: true,
      checkpoint: {
        state: "claimed",
        revision: 2,
        attempt: 1,
        leaseId: leaseIds[1],
        priorProgressUnknown: true,
      },
    });
    if (replacement.kind !== "acquired") throw new Error("Expected a replacement claim");
    expect(acquireIngestionAttempt(replacement.checkpoint, replacementCommand)).toMatchObject({
      kind: "acquired",
      changed: false,
    });
    expect(() =>
      settleIngestionAttempt(replacement.checkpoint, settleCommand(expired), success()),
    ).toThrow("lease or revision is stale");

    const afterExpiry = acquireIngestionAttempt(
      claimed(),
      claimCommand({
        expectedRevision: 1,
        leaseId: leaseIds[2],
        leasedAt: "2026-08-16T12:05:01.001Z",
        leaseExpiresAt: "2026-08-16T12:10:01.001Z",
      }),
    );
    expect(afterExpiry).toMatchObject({
      kind: "acquired",
      changed: true,
      checkpoint: { attempt: 1, leaseId: leaseIds[2], priorProgressUnknown: true },
    });
  });

  it("never claims known progress after replacing a possibly partial crashed worker", () => {
    const expired = claimed();
    const reclaim = (sourceEnabled = true) =>
      acquireIngestionAttempt(
        expired,
        claimCommand({
          expectedRevision: expired.revision,
          leaseId: leaseIds[1],
          leasedAt: expired.leaseExpiresAt,
          leaseExpiresAt: "2026-08-16T12:10:01.000Z",
          sourceEnabled,
        }),
      );

    const disabled = reclaim(false);
    expect(disabled).toMatchObject({
      kind: "paused",
      changed: true,
      checkpoint: {
        state: "paused",
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      },
      disposition: {
        action: "ack",
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      },
    });
    if (disabled.kind !== "paused") throw new Error("Expected a paused reclaim");
    expect(Object.keys(disabled.checkpoint).sort()).toEqual(
      [
        "adapterVersion",
        "attempt",
        "createdCount",
        "executionId",
        "observationCount",
        "pauseReason",
        "progressKnown",
        "revision",
        "scheduledFor",
        "schemaVersion",
        "settledAt",
        "settledAttempt",
        "settledLeaseId",
        "settlementKey",
        "sourceId",
        "state",
        "updatedCount",
        "withdrawalInferred",
      ].sort(),
    );

    const active = reclaim();
    if (active.kind !== "acquired") throw new Error("Expected an acquired reclaim");
    const replacementSettlement = settleCommand(active.checkpoint, {
      settledAt: "2026-08-16T12:05:02.000Z",
    });
    const aborted = settleIngestionAttempt(active.checkpoint, replacementSettlement, {
      sourceId,
      status: "aborted",
      observationCount: 2,
      createdCount: 1,
      updatedCount: 1,
    });
    expect(aborted).toMatchObject({
      checkpoint: {
        state: "paused",
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      },
      disposition: { action: "ack", progressKnown: false },
    });

    const failed = failIngestionAttempt(
      active.checkpoint,
      replacementSettlement,
      new Error("private crashed-worker state"),
    );
    expect(failed).toMatchObject({
      checkpoint: {
        state: "dead_lettered",
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      },
      disposition: {
        action: "dead_letter",
        progressKnown: false,
        failureCode: "ingestion_attempt_failed",
      },
    });
    expect(JSON.stringify({ disabled, aborted, failed })).not.toContain("private crashed-worker");
  });

  it("settles success once, preserves aggregate-only output, and skips terminal replay work", () => {
    const active = claimed();
    const command = settleCommand(active);
    const first = settleIngestionAttempt(active, command, success());
    expect(first).toEqual({
      changed: true,
      checkpoint: expect.objectContaining({
        state: "succeeded",
        revision: 2,
        attempt: 1,
        settledAttempt: 1,
        observationCount: 2,
        createdCount: 1,
        updatedCount: 1,
        withdrawalInferred: false,
      }),
      disposition: {
        schemaVersion: 1,
        executionId: active.executionId,
        sourceId,
        withdrawalInferred: false,
        progressKnown: true,
        observationCount: 2,
        createdCount: 1,
        updatedCount: 1,
        action: "ack",
        status: "succeeded",
      },
    });
    expect(JSON.stringify(first)).not.toContain("http");
    expect(JSON.stringify(first)).not.toContain("Generated");

    const replay = settleIngestionAttempt(first.checkpoint, command, success());
    expect(replay.changed).toBe(false);
    expect(replay.checkpoint).toBe(first.checkpoint);
    expect(acquireIngestionAttempt(first.checkpoint, claimCommand())).toMatchObject({
      kind: "terminal",
      changed: false,
    });
  });

  it("projects durable recovery exhaustion without fabricating attempt settlement fields", () => {
    const exhausted = {
      ...pending(),
      state: "dead_lettered",
      revision: 1,
      failureCode: "recovery_generation_exhausted",
      exhaustedDispatchId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e62",
    } as const;

    expect(acquireIngestionAttempt(exhausted, claimCommand())).toEqual({
      kind: "terminal",
      changed: false,
      checkpoint: exhausted,
      disposition: {
        schemaVersion: 1,
        executionId: exhausted.executionId,
        sourceId,
        withdrawalInferred: false,
        progressKnown: false,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
        action: "dead_letter",
        status: "dead_lettered",
        failureCode: "recovery_generation_exhausted",
      },
    });
    expect(exhausted).not.toHaveProperty("settledLeaseId");
  });

  it("rejects conflicting settlement replay and settlement outside the lease", () => {
    const active = claimed();
    const command = settleCommand(active);
    const completed = settleIngestionAttempt(active, command, success()).checkpoint;
    expect(() => settleIngestionAttempt(completed, command, success(1, 1, 0))).toThrow(
      "does not match an active lease",
    );
    expect(() =>
      settleIngestionAttempt(
        active,
        settleCommand(active, { settledAt: "2026-08-16T12:05:01.001Z" }),
        success(),
      ),
    ).toThrow("outside its lease");
  });

  it("uses stable bounded jitter, honors the attempt fence, and rejects early reacquisition", () => {
    const active = claimed();
    const first = settleIngestionAttempt(active, settleCommand(active), retry());
    expect(first.checkpoint).toMatchObject({
      state: "retry_wait",
      revision: 2,
      attempt: 2,
      settledAttempt: 1,
      retryReason: "source_unavailable",
    });
    expect(first.disposition).toMatchObject({
      action: "retry",
      status: "retry_wait",
      nextAttempt: 2,
      reason: "source_unavailable",
      withdrawalInferred: false,
    });
    if (first.checkpoint.state !== "retry_wait") throw new Error("Expected a retry checkpoint");
    const expectedDelay = deterministicIngestionRetryDelayMs(active.executionId, 1, 10_000);
    expect(expectedDelay).toBeGreaterThanOrEqual(10_000);
    expect(expectedDelay).toBeLessThanOrEqual(12_500);
    expect(deterministicIngestionRetryDelayMs(active.executionId, 1, 10_000)).toBe(expectedDelay);
    expect(first.checkpoint.retryAt).toBe(
      new Date(new Date(settledAt).getTime() + expectedDelay).toISOString(),
    );
    expect(() =>
      acquireIngestionAttempt(
        first.checkpoint,
        claimCommand({
          expectedRevision: first.checkpoint.revision,
          leaseId: leaseIds[1],
          leasedAt: settledAt,
          leaseExpiresAt: "2026-08-16T12:05:02.000Z",
        }),
      ),
    ).toThrow("not eligible yet");
  });

  it("dead-letters a retry only after the bounded attempt cap", () => {
    let checkpoint: IngestionCheckpointV1 = pending();
    let lastDisposition: ReturnType<typeof settleIngestionAttempt>["disposition"] | undefined;
    for (let attempt = 1; attempt <= maximumIngestionAttempts; attempt += 1) {
      const leaseId = leaseIds[attempt - 1] ?? leaseIds[0];
      const start = new Date(`2026-08-16T12:${String(attempt).padStart(2, "0")}:00.000Z`);
      const active = claimed(checkpoint, {
        leaseId,
        leasedAt: start.toISOString(),
        leaseExpiresAt: new Date(start.getTime() + 60_000).toISOString(),
      });
      const settled = settleIngestionAttempt(
        active,
        settleCommand(active, {
          settledAt: new Date(start.getTime() + 1_000).toISOString(),
        }),
        retry(1_000),
      );
      checkpoint = settled.checkpoint;
      lastDisposition = settled.disposition;
    }
    expect(checkpoint).toMatchObject({
      state: "dead_lettered",
      attempt: maximumIngestionAttempts,
      failureCode: "attempt_limit_exhausted",
    });
    expect(lastDisposition).toMatchObject({
      action: "dead_letter",
      failureCode: "attempt_limit_exhausted",
    });
  });

  it("pauses before work while disabled and resumes the same attempt with a new lease", () => {
    const initial = pending();
    const disabledCommand = claimCommand({ sourceEnabled: false });
    const disabled = acquireIngestionAttempt(initial, disabledCommand);
    expect(disabled).toMatchObject({
      kind: "paused",
      changed: true,
      checkpoint: {
        state: "paused",
        attempt: 1,
        observationCount: 0,
        pauseReason: "source_disabled",
      },
      disposition: { action: "ack", status: "paused" },
    });
    if (disabled.kind !== "paused") throw new Error("Expected a paused checkpoint");
    expect(acquireIngestionAttempt(disabled.checkpoint, disabledCommand)).toMatchObject({
      kind: "paused",
      changed: false,
    });
    expect(() =>
      acquireIngestionAttempt(disabled.checkpoint, {
        ...disabledCommand,
        leaseExpiresAt: "2026-08-16T12:05:00.000Z",
      }),
    ).toThrow("revision is stale");
    expect(() =>
      acquireIngestionAttempt(
        disabled.checkpoint,
        claimCommand({
          expectedRevision: disabled.checkpoint.revision,
          leaseId: leaseIds[1],
          leasedAt: scheduledFor,
          leaseExpiresAt: "2026-08-16T12:05:00.000Z",
        }),
      ),
    ).toThrow("cannot move backward in time");
    expect(() =>
      acquireIngestionAttempt(
        disabled.checkpoint,
        claimCommand({
          expectedRevision: disabled.checkpoint.revision,
          leaseId: leaseIds[1],
          leasedAt: scheduledFor,
          leaseExpiresAt: "2026-08-16T12:05:00.000Z",
          sourceEnabled: false,
        }),
      ),
    ).toThrow("cannot move backward in time");
    const resumed = acquireIngestionAttempt(
      disabled.checkpoint,
      claimCommand({
        expectedRevision: disabled.checkpoint.revision,
        leaseId: leaseIds[1],
        leasedAt: "2026-08-16T12:06:00.000Z",
        leaseExpiresAt: "2026-08-16T12:11:00.000Z",
      }),
    );
    expect(resumed).toMatchObject({
      kind: "acquired",
      changed: true,
      checkpoint: { state: "claimed", attempt: 1 },
    });
  });

  it("pauses after abort or a kill-switch flip and preserves partial aggregate progress", () => {
    const active = claimed();
    const aborted: IngestionRunResult = {
      sourceId,
      status: "aborted",
      observationCount: 1,
      createdCount: 1,
      updatedCount: 0,
    };
    expect(settleIngestionAttempt(active, settleCommand(active), aborted)).toMatchObject({
      checkpoint: {
        state: "paused",
        pauseReason: "attempt_aborted",
        observationCount: 1,
        withdrawalInferred: false,
      },
      disposition: { action: "ack", status: "paused" },
    });

    const other = claimed();
    expect(
      settleIngestionAttempt(other, settleCommand(other, { sourceEnabled: false }), success()),
    ).toMatchObject({
      checkpoint: { state: "paused", pauseReason: "source_disabled" },
      disposition: { action: "ack", status: "paused" },
    });
  });

  it("maps thrown failures to fixed codes without retaining raw errors", () => {
    const active = claimed();
    const privateError = new Error("https://private.invalid/token employer secret");
    const failed = failIngestionAttempt(active, settleCommand(active), privateError);
    expect(failed).toMatchObject({
      checkpoint: {
        state: "dead_lettered",
        failureCode: "ingestion_attempt_failed",
        progressKnown: false,
      },
      disposition: {
        action: "dead_letter",
        failureCode: "ingestion_attempt_failed",
        progressKnown: false,
      },
    });
    expect(JSON.stringify(failed)).not.toContain("private.invalid");
    expect(JSON.stringify(failed)).not.toContain("employer secret");
    expect(
      failIngestionAttempt(
        failed.checkpoint,
        settleCommand(active),
        new Error("another private value"),
      ),
    ).toMatchObject({ changed: false, checkpoint: failed.checkpoint });

    const contractActive = claimed();
    expect(
      failIngestionAttempt(
        contractActive,
        settleCommand(contractActive),
        new SourceBatchContractError("private source field"),
      ),
    ).toMatchObject({
      checkpoint: { failureCode: "source_contract_rejected" },
      disposition: { failureCode: "source_contract_rejected" },
    });
  });

  it("treats an empty success as completion without inferring withdrawal", () => {
    const active = claimed();
    const completed = settleIngestionAttempt(active, settleCommand(active), success(0, 0, 0));
    expect(completed).toMatchObject({
      checkpoint: {
        state: "succeeded",
        observationCount: 0,
        withdrawalInferred: false,
      },
      disposition: {
        action: "ack",
        status: "succeeded",
        observationCount: 0,
        withdrawalInferred: false,
      },
    });
  });

  it("rejects malformed or value-bearing run results before checkpoint settlement", () => {
    const active = claimed();
    expect(() =>
      settleIngestionAttempt(active, settleCommand(active), {
        ...success(),
        sourceUrl: "https://private.invalid/token",
      } as never),
    ).toThrow("run result is invalid");
    expect(() =>
      settleIngestionAttempt(active, settleCommand(active), {
        ...success(),
        observationCount: 3,
      } as never),
    ).toThrow("run result is invalid");
    expect(() =>
      settleIngestionAttempt(active, settleCommand(active), {
        ...retry(),
        retryAfterMs: 15 * 60 * 1_000 + 1,
      } as never),
    ).toThrow("run result is invalid");
  });

  it("rejects forged checkpoint fields before any transition", () => {
    const forged = { ...pending(), rawSnapshot: { secret: true } } as never;
    expect(() => acquireIngestionAttempt(forged, claimCommand())).toThrow("checkpoint is invalid");

    const active = claimed();
    expect(() =>
      acquireIngestionAttempt(
        {
          ...active,
          leasedAt: "2026-08-16T11:59:00.000Z",
          leaseExpiresAt: "2026-08-16T12:04:00.000Z",
        },
        claimCommand(),
      ),
    ).toThrow("checkpoint is invalid");

    const completed = settleIngestionAttempt(active, settleCommand(active), success()).checkpoint;
    if (!("progressKnown" in completed)) throw new Error("Expected an attempt settlement");
    expect(() =>
      acquireIngestionAttempt({ ...completed, progressKnown: false }, claimCommand()),
    ).toThrow("checkpoint is invalid");
    expect(() =>
      acquireIngestionAttempt(
        { ...completed, settledAt: "2026-08-16T11:59:59.999Z" },
        claimCommand(),
      ),
    ).toThrow("checkpoint is invalid");
  });
});
