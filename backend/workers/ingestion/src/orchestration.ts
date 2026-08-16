import { createHash } from "node:crypto";
import {
  adapterVersionPattern,
  type IngestionRunResult,
  sourceIdentifierPattern,
} from "./contract.js";
import { SourceBatchContractError } from "./runner.js";

export const ingestionOrchestrationSchemaVersion = 1 as const;
export const maximumIngestionAttempts = 5;
export const maximumIngestionLeaseMs = 15 * 60 * 1_000;
export const maximumIngestionRetryDelayMs = 15 * 60 * 1_000;

const lowercaseUuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export interface IngestionScheduleOccurrenceInput {
  sourceId: string;
  adapterVersion: string;
  scheduledFor: string;
}

export interface IngestionScheduleOccurrenceV1 extends IngestionScheduleOccurrenceInput {
  schemaVersion: 1;
  executionId: string;
}

interface IngestionCheckpointBase extends IngestionScheduleOccurrenceV1 {
  revision: number;
  attempt: number;
  withdrawalInferred: false;
}

export interface PendingIngestionCheckpointV1 extends IngestionCheckpointBase {
  state: "pending";
}

export interface ClaimedIngestionCheckpointV1 extends IngestionCheckpointBase {
  state: "claimed";
  leaseId: string;
  leasedAt: string;
  leaseExpiresAt: string;
  priorProgressUnknown: boolean;
}

interface SettledIngestionCheckpointBase extends IngestionCheckpointBase {
  settledAttempt: number;
  settledLeaseId: string;
  settledAt: string;
  settlementKey: string;
  progressKnown: boolean;
  observationCount: number;
  createdCount: number;
  updatedCount: number;
}

export interface RetryWaitingIngestionCheckpointV1 extends SettledIngestionCheckpointBase {
  state: "retry_wait";
  retryReason: "rate_limited" | "source_unavailable" | "timeout";
  retryAt: string;
}

export interface PausedIngestionCheckpointV1 extends SettledIngestionCheckpointBase {
  state: "paused";
  pauseReason: "source_disabled" | "attempt_aborted";
}

export interface SucceededIngestionCheckpointV1 extends SettledIngestionCheckpointBase {
  state: "succeeded";
}

export interface AttemptDeadLetteredIngestionCheckpointV1 extends SettledIngestionCheckpointBase {
  state: "dead_lettered";
  failureCode: "attempt_limit_exhausted" | "ingestion_attempt_failed" | "source_contract_rejected";
}

export interface RecoveryExhaustedIngestionCheckpointV1 extends IngestionCheckpointBase {
  state: "dead_lettered";
  failureCode: "recovery_generation_exhausted";
  exhaustedDispatchId: string;
}

export type DeadLetteredIngestionCheckpointV1 =
  | AttemptDeadLetteredIngestionCheckpointV1
  | RecoveryExhaustedIngestionCheckpointV1;

export type IngestionCheckpointV1 =
  | PendingIngestionCheckpointV1
  | ClaimedIngestionCheckpointV1
  | RetryWaitingIngestionCheckpointV1
  | PausedIngestionCheckpointV1
  | SucceededIngestionCheckpointV1
  | DeadLetteredIngestionCheckpointV1;

export interface AcquireIngestionAttemptCommand {
  expectedRevision: number;
  leaseId: string;
  leasedAt: string;
  leaseExpiresAt: string;
  sourceEnabled: boolean;
}

export interface SettleIngestionAttemptCommand {
  expectedRevision: number;
  leaseId: string;
  settledAt: string;
  sourceEnabled: boolean;
}

interface IngestionDispositionBase {
  schemaVersion: 1;
  executionId: string;
  sourceId: string;
  withdrawalInferred: false;
  progressKnown: boolean;
  observationCount: number;
  createdCount: number;
  updatedCount: number;
}

export interface AcknowledgeIngestionDisposition extends IngestionDispositionBase {
  action: "ack";
  status: "paused" | "succeeded";
}

export interface RetryIngestionDisposition extends IngestionDispositionBase {
  action: "retry";
  status: "retry_wait";
  nextAttempt: number;
  retryAt: string;
  reason: "rate_limited" | "source_unavailable" | "timeout";
}

export interface DeadLetterIngestionDisposition extends IngestionDispositionBase {
  action: "dead_letter";
  status: "dead_lettered";
  failureCode: DeadLetteredIngestionCheckpointV1["failureCode"];
}

export type IngestionDispatchDisposition =
  | AcknowledgeIngestionDisposition
  | RetryIngestionDisposition
  | DeadLetterIngestionDisposition;

export type AcquireIngestionAttemptResult =
  | {
      kind: "acquired";
      changed: boolean;
      checkpoint: ClaimedIngestionCheckpointV1;
    }
  | {
      kind: "paused";
      changed: boolean;
      checkpoint: PausedIngestionCheckpointV1;
      disposition: AcknowledgeIngestionDisposition;
    }
  | {
      kind: "terminal";
      changed: false;
      checkpoint: SucceededIngestionCheckpointV1 | DeadLetteredIngestionCheckpointV1;
      disposition: AcknowledgeIngestionDisposition | DeadLetterIngestionDisposition;
    };

export interface SettleIngestionAttemptResult {
  changed: boolean;
  checkpoint:
    | RetryWaitingIngestionCheckpointV1
    | PausedIngestionCheckpointV1
    | SucceededIngestionCheckpointV1
    | DeadLetteredIngestionCheckpointV1;
  disposition: IngestionDispatchDisposition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nextRevision(revision: number): number {
  if (!isRevision(revision) || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("The ingestion checkpoint revision cannot advance");
  }
  return revision + 1;
}

function isAttempt(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximumIngestionAttempts
  );
}

function isAggregateCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertOccurrenceInput(value: unknown): asserts value is IngestionScheduleOccurrenceInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sourceId", "adapterVersion", "scheduledFor"]) ||
    typeof value.sourceId !== "string" ||
    !sourceIdentifierPattern.test(value.sourceId) ||
    typeof value.adapterVersion !== "string" ||
    !adapterVersionPattern.test(value.adapterVersion) ||
    !isCanonicalTimestamp(value.scheduledFor)
  ) {
    throw new Error("The ingestion schedule occurrence is invalid");
  }
}

export function ingestionExecutionIdFor(input: IngestionScheduleOccurrenceInput): string {
  assertOccurrenceInput(input);
  return sha256(
    `${ingestionOrchestrationSchemaVersion}\n${input.sourceId}\n${input.adapterVersion}\n${input.scheduledFor}\n`,
  );
}

export function createIngestionScheduleOccurrence(
  input: IngestionScheduleOccurrenceInput,
): Readonly<IngestionScheduleOccurrenceV1> {
  assertOccurrenceInput(input);
  return frozen({
    schemaVersion: ingestionOrchestrationSchemaVersion,
    executionId: ingestionExecutionIdFor(input),
    sourceId: input.sourceId,
    adapterVersion: input.adapterVersion,
    scheduledFor: input.scheduledFor,
  });
}

function isOccurrence(value: Record<string, unknown>): boolean {
  if (
    value.schemaVersion !== ingestionOrchestrationSchemaVersion ||
    typeof value.executionId !== "string" ||
    !sha256Pattern.test(value.executionId) ||
    typeof value.sourceId !== "string" ||
    typeof value.adapterVersion !== "string" ||
    typeof value.scheduledFor !== "string"
  ) {
    return false;
  }
  try {
    return (
      value.executionId ===
      ingestionExecutionIdFor({
        sourceId: value.sourceId,
        adapterVersion: value.adapterVersion,
        scheduledFor: value.scheduledFor,
      })
    );
  } catch {
    return false;
  }
}

const baseCheckpointKeys = [
  "schemaVersion",
  "executionId",
  "sourceId",
  "adapterVersion",
  "scheduledFor",
  "state",
  "revision",
  "attempt",
  "withdrawalInferred",
] as const;
const settledCheckpointKeys = [
  ...baseCheckpointKeys,
  "settledAttempt",
  "settledLeaseId",
  "settledAt",
  "settlementKey",
  "progressKnown",
  "observationCount",
  "createdCount",
  "updatedCount",
] as const;

function validBaseCheckpoint(value: Record<string, unknown>): boolean {
  return (
    isOccurrence(value) &&
    isRevision(value.revision) &&
    isAttempt(value.attempt) &&
    value.withdrawalInferred === false
  );
}

function validSettledCheckpoint(value: Record<string, unknown>): boolean {
  return (
    validBaseCheckpoint(value) &&
    isAttempt(value.settledAttempt) &&
    typeof value.settledLeaseId === "string" &&
    lowercaseUuidV7Pattern.test(value.settledLeaseId) &&
    isCanonicalTimestamp(value.settledAt) &&
    new Date(String(value.settledAt)).getTime() >= new Date(String(value.scheduledFor)).getTime() &&
    typeof value.settlementKey === "string" &&
    sha256Pattern.test(value.settlementKey) &&
    typeof value.progressKnown === "boolean" &&
    isAggregateCount(value.observationCount) &&
    isAggregateCount(value.createdCount) &&
    isAggregateCount(value.updatedCount) &&
    Number(value.observationCount) === Number(value.createdCount) + Number(value.updatedCount) &&
    (value.progressKnown === true || Number(value.observationCount) === 0)
  );
}

function assertCheckpoint(value: unknown): asserts value is IngestionCheckpointV1 {
  if (!isRecord(value) || !validBaseCheckpoint(value)) {
    throw new Error("The ingestion checkpoint is invalid");
  }
  if (value.state === "pending" && hasExactKeys(value, baseCheckpointKeys)) return;
  if (
    value.state === "claimed" &&
    hasExactKeys(value, [
      ...baseCheckpointKeys,
      "leaseId",
      "leasedAt",
      "leaseExpiresAt",
      "priorProgressUnknown",
    ]) &&
    typeof value.leaseId === "string" &&
    lowercaseUuidV7Pattern.test(value.leaseId) &&
    isCanonicalTimestamp(value.leasedAt) &&
    isCanonicalTimestamp(value.leaseExpiresAt) &&
    new Date(String(value.leasedAt)).getTime() >= new Date(String(value.scheduledFor)).getTime() &&
    new Date(String(value.leaseExpiresAt)).getTime() > new Date(String(value.leasedAt)).getTime() &&
    new Date(String(value.leaseExpiresAt)).getTime() - new Date(String(value.leasedAt)).getTime() <=
      maximumIngestionLeaseMs &&
    typeof value.priorProgressUnknown === "boolean"
  ) {
    return;
  }
  if (
    value.state === "dead_lettered" &&
    value.failureCode === "recovery_generation_exhausted" &&
    hasExactKeys(value, [...baseCheckpointKeys, "exhaustedDispatchId", "failureCode"]) &&
    typeof value.exhaustedDispatchId === "string" &&
    lowercaseUuidV7Pattern.test(value.exhaustedDispatchId)
  ) {
    return;
  }
  if (!validSettledCheckpoint(value)) {
    throw new Error("The ingestion checkpoint is invalid");
  }
  if (
    value.state === "retry_wait" &&
    hasExactKeys(value, [...settledCheckpointKeys, "retryReason", "retryAt"]) &&
    ["rate_limited", "source_unavailable", "timeout"].includes(String(value.retryReason)) &&
    isCanonicalTimestamp(value.retryAt) &&
    new Date(String(value.retryAt)).getTime() > new Date(String(value.settledAt)).getTime() &&
    Number(value.attempt) === Number(value.settledAttempt) + 1
  ) {
    return;
  }
  if (
    value.state === "paused" &&
    hasExactKeys(value, [...settledCheckpointKeys, "pauseReason"]) &&
    ["source_disabled", "attempt_aborted"].includes(String(value.pauseReason)) &&
    value.attempt === value.settledAttempt
  ) {
    return;
  }
  if (
    value.state === "succeeded" &&
    hasExactKeys(value, settledCheckpointKeys) &&
    value.attempt === value.settledAttempt
  ) {
    return;
  }
  if (
    value.state === "dead_lettered" &&
    hasExactKeys(value, [...settledCheckpointKeys, "failureCode"]) &&
    ["attempt_limit_exhausted", "ingestion_attempt_failed", "source_contract_rejected"].includes(
      String(value.failureCode),
    ) &&
    (value.failureCode === "attempt_limit_exhausted" || value.progressKnown === false) &&
    value.attempt === value.settledAttempt
  ) {
    return;
  }
  throw new Error("The ingestion checkpoint is invalid");
}

function occurrenceFields(checkpoint: IngestionCheckpointV1): IngestionScheduleOccurrenceV1 {
  return {
    schemaVersion: checkpoint.schemaVersion,
    executionId: checkpoint.executionId,
    sourceId: checkpoint.sourceId,
    adapterVersion: checkpoint.adapterVersion,
    scheduledFor: checkpoint.scheduledFor,
  };
}

export function createPendingIngestionCheckpoint(
  occurrence: IngestionScheduleOccurrenceV1,
): Readonly<PendingIngestionCheckpointV1> {
  if (
    !isRecord(occurrence) ||
    !hasExactKeys(occurrence, [
      "schemaVersion",
      "executionId",
      "sourceId",
      "adapterVersion",
      "scheduledFor",
    ]) ||
    !isOccurrence(occurrence)
  ) {
    throw new Error("The ingestion schedule occurrence is invalid");
  }
  return frozen({
    ...occurrence,
    state: "pending",
    revision: 0,
    attempt: 1,
    withdrawalInferred: false,
  });
}

function assertAcquireCommand(value: unknown): asserts value is AcquireIngestionAttemptCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "expectedRevision",
      "leaseId",
      "leasedAt",
      "leaseExpiresAt",
      "sourceEnabled",
    ]) ||
    !isRevision(value.expectedRevision) ||
    typeof value.leaseId !== "string" ||
    !lowercaseUuidV7Pattern.test(value.leaseId) ||
    !isCanonicalTimestamp(value.leasedAt) ||
    !isCanonicalTimestamp(value.leaseExpiresAt) ||
    typeof value.sourceEnabled !== "boolean" ||
    new Date(String(value.leaseExpiresAt)).getTime() <=
      new Date(String(value.leasedAt)).getTime() ||
    new Date(String(value.leaseExpiresAt)).getTime() - new Date(String(value.leasedAt)).getTime() >
      maximumIngestionLeaseMs
  ) {
    throw new Error("The ingestion claim command is invalid");
  }
}

function assertSettleCommand(value: unknown): asserts value is SettleIngestionAttemptCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["expectedRevision", "leaseId", "settledAt", "sourceEnabled"]) ||
    !isRevision(value.expectedRevision) ||
    typeof value.leaseId !== "string" ||
    !lowercaseUuidV7Pattern.test(value.leaseId) ||
    !isCanonicalTimestamp(value.settledAt) ||
    typeof value.sourceEnabled !== "boolean"
  ) {
    throw new Error("The ingestion settlement command is invalid");
  }
}

function aggregateDispositionBase(
  checkpoint: SettledIngestionCheckpointBase,
): IngestionDispositionBase {
  return {
    schemaVersion: ingestionOrchestrationSchemaVersion,
    executionId: checkpoint.executionId,
    sourceId: checkpoint.sourceId,
    withdrawalInferred: false,
    progressKnown: checkpoint.progressKnown,
    observationCount: checkpoint.observationCount,
    createdCount: checkpoint.createdCount,
    updatedCount: checkpoint.updatedCount,
  };
}

function dispositionForSettledCheckpoint(
  checkpoint: RetryWaitingIngestionCheckpointV1,
): RetryIngestionDisposition;
function dispositionForSettledCheckpoint(
  checkpoint: PausedIngestionCheckpointV1 | SucceededIngestionCheckpointV1,
): AcknowledgeIngestionDisposition;
function dispositionForSettledCheckpoint(
  checkpoint: DeadLetteredIngestionCheckpointV1,
): DeadLetterIngestionDisposition;
function dispositionForSettledCheckpoint(
  checkpoint: SucceededIngestionCheckpointV1 | DeadLetteredIngestionCheckpointV1,
): AcknowledgeIngestionDisposition | DeadLetterIngestionDisposition;
function dispositionForSettledCheckpoint(
  checkpoint:
    | RetryWaitingIngestionCheckpointV1
    | PausedIngestionCheckpointV1
    | SucceededIngestionCheckpointV1
    | DeadLetteredIngestionCheckpointV1,
): IngestionDispatchDisposition;
function dispositionForSettledCheckpoint(
  checkpoint:
    | RetryWaitingIngestionCheckpointV1
    | PausedIngestionCheckpointV1
    | SucceededIngestionCheckpointV1
    | DeadLetteredIngestionCheckpointV1,
): IngestionDispatchDisposition {
  const base =
    checkpoint.state === "dead_lettered" &&
    checkpoint.failureCode === "recovery_generation_exhausted"
      ? {
          schemaVersion: ingestionOrchestrationSchemaVersion,
          executionId: checkpoint.executionId,
          sourceId: checkpoint.sourceId,
          withdrawalInferred: false as const,
          progressKnown: false,
          observationCount: 0,
          createdCount: 0,
          updatedCount: 0,
        }
      : aggregateDispositionBase(checkpoint);
  if (checkpoint.state === "retry_wait") {
    return frozen({
      ...base,
      action: "retry",
      status: "retry_wait",
      nextAttempt: checkpoint.attempt,
      retryAt: checkpoint.retryAt,
      reason: checkpoint.retryReason,
    });
  }
  if (checkpoint.state === "dead_lettered") {
    return frozen({
      ...base,
      action: "dead_letter",
      status: "dead_lettered",
      failureCode: checkpoint.failureCode,
    });
  }
  return frozen({
    ...base,
    action: "ack",
    status: checkpoint.state,
  });
}

function settlementKey(value: object): string {
  return sha256(JSON.stringify(value));
}

function pausedBeforeRun(
  checkpoint: IngestionCheckpointV1,
  command: AcquireIngestionAttemptCommand,
): PausedIngestionCheckpointV1 {
  const progressKnown =
    checkpoint.state === "pending"
      ? true
      : checkpoint.state === "claimed"
        ? false
        : "progressKnown" in checkpoint
          ? checkpoint.progressKnown
          : false;
  const key = settlementKey({
    expectedRevision: command.expectedRevision,
    leaseId: command.leaseId,
    settledAt: command.leasedAt,
    leaseExpiresAt: command.leaseExpiresAt,
    sourceEnabled: false,
    outcome: "source_disabled_before_run",
  });
  return frozen({
    ...occurrenceFields(checkpoint),
    state: "paused",
    revision: nextRevision(checkpoint.revision),
    attempt: checkpoint.attempt,
    withdrawalInferred: false,
    settledAttempt: checkpoint.attempt,
    settledLeaseId: command.leaseId,
    settledAt: command.leasedAt,
    settlementKey: key,
    progressKnown,
    observationCount: 0,
    createdCount: 0,
    updatedCount: 0,
    pauseReason: "source_disabled",
  });
}

function claimedCheckpoint(
  checkpoint: IngestionCheckpointV1,
  command: AcquireIngestionAttemptCommand,
): ClaimedIngestionCheckpointV1 {
  const priorProgressUnknown =
    checkpoint.state === "claimed" ||
    (checkpoint.state !== "pending" &&
      "progressKnown" in checkpoint &&
      checkpoint.progressKnown === false);
  return frozen({
    ...occurrenceFields(checkpoint),
    state: "claimed",
    revision: nextRevision(checkpoint.revision),
    attempt: checkpoint.attempt,
    withdrawalInferred: false,
    leaseId: command.leaseId,
    leasedAt: command.leasedAt,
    leaseExpiresAt: command.leaseExpiresAt,
    priorProgressUnknown,
  });
}

export function acquireIngestionAttempt(
  checkpoint: IngestionCheckpointV1,
  command: AcquireIngestionAttemptCommand,
): AcquireIngestionAttemptResult {
  assertCheckpoint(checkpoint);
  assertAcquireCommand(command);

  if (checkpoint.state === "succeeded" || checkpoint.state === "dead_lettered") {
    return frozen({
      kind: "terminal",
      changed: false,
      checkpoint,
      disposition: dispositionForSettledCheckpoint(checkpoint),
    });
  }

  if (checkpoint.state === "claimed") {
    if (
      checkpoint.leaseId === command.leaseId &&
      checkpoint.leasedAt === command.leasedAt &&
      checkpoint.leaseExpiresAt === command.leaseExpiresAt &&
      command.sourceEnabled &&
      command.expectedRevision === checkpoint.revision - 1
    ) {
      return frozen({ kind: "acquired", changed: false, checkpoint });
    }
    if (
      command.expectedRevision !== checkpoint.revision ||
      command.leasedAt < checkpoint.leaseExpiresAt
    ) {
      throw new Error("The ingestion checkpoint already has a different active lease");
    }
    if (!command.sourceEnabled) {
      const paused = pausedBeforeRun(checkpoint, command);
      return frozen({
        kind: "paused",
        changed: true,
        checkpoint: paused,
        disposition: dispositionForSettledCheckpoint(paused),
      });
    }
    return frozen({
      kind: "acquired",
      changed: true,
      checkpoint: claimedCheckpoint(checkpoint, command),
    });
  }

  if (command.expectedRevision !== checkpoint.revision) {
    if (
      checkpoint.state === "paused" &&
      !command.sourceEnabled &&
      checkpoint.settledLeaseId === command.leaseId &&
      checkpoint.settledAt === command.leasedAt &&
      checkpoint.settlementKey ===
        settlementKey({
          expectedRevision: command.expectedRevision,
          leaseId: command.leaseId,
          settledAt: command.leasedAt,
          leaseExpiresAt: command.leaseExpiresAt,
          sourceEnabled: false,
          outcome: "source_disabled_before_run",
        })
    ) {
      return frozen({
        kind: "paused",
        changed: false,
        checkpoint,
        disposition: dispositionForSettledCheckpoint(checkpoint),
      });
    }
    throw new Error("The ingestion checkpoint revision is stale");
  }

  if (checkpoint.state === "retry_wait" && command.leasedAt < checkpoint.retryAt) {
    throw new Error("The ingestion retry is not eligible yet");
  }
  if (checkpoint.state === "paused" && command.leasedAt < checkpoint.settledAt) {
    throw new Error("The ingestion paused checkpoint cannot move backward in time");
  }
  if (command.leasedAt < checkpoint.scheduledFor) {
    throw new Error("The ingestion schedule occurrence is not eligible yet");
  }
  if (!command.sourceEnabled) {
    const paused = pausedBeforeRun(checkpoint, command);
    return frozen({
      kind: "paused",
      changed: true,
      checkpoint: paused,
      disposition: dispositionForSettledCheckpoint(paused),
    });
  }

  const claimed = claimedCheckpoint(checkpoint, command);
  return frozen({ kind: "acquired", changed: true, checkpoint: claimed });
}

function assertRunResult(
  value: unknown,
  expectedSourceId: string,
): asserts value is IngestionRunResult {
  if (!isRecord(value) || value.sourceId !== expectedSourceId) {
    throw new Error("The ingestion run result is invalid");
  }
  const baseKeys = ["sourceId", "status", "observationCount", "createdCount", "updatedCount"];
  if (
    !isAggregateCount(value.observationCount) ||
    !isAggregateCount(value.createdCount) ||
    !isAggregateCount(value.updatedCount) ||
    Number(value.observationCount) !== Number(value.createdCount) + Number(value.updatedCount)
  ) {
    throw new Error("The ingestion run result is invalid");
  }
  if (
    (value.status === "succeeded" || value.status === "aborted") &&
    hasExactKeys(value, baseKeys)
  ) {
    return;
  }
  if (
    value.status === "retry" &&
    hasExactKeys(value, [...baseKeys, "reason", "retryAfterMs"]) &&
    ["rate_limited", "source_unavailable", "timeout"].includes(String(value.reason)) &&
    Number(value.observationCount) === 0 &&
    Number(value.createdCount) === 0 &&
    Number(value.updatedCount) === 0 &&
    Number.isSafeInteger(value.retryAfterMs) &&
    Number(value.retryAfterMs) >= 1 &&
    Number(value.retryAfterMs) <= maximumIngestionRetryDelayMs
  ) {
    return;
  }
  throw new Error("The ingestion run result is invalid");
}

function safeOutcome(result: IngestionRunResult): object {
  return result.status === "retry"
    ? {
        status: result.status,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
        reason: result.reason,
        retryAfterMs: result.retryAfterMs,
      }
    : {
        status: result.status,
        observationCount: result.observationCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
      };
}

function assertActiveSettlement(
  checkpoint: IngestionCheckpointV1,
  command: SettleIngestionAttemptCommand,
  key: string,
): ClaimedIngestionCheckpointV1 | SettleIngestionAttemptResult {
  if (checkpoint.state !== "claimed") {
    if (
      ["retry_wait", "paused", "succeeded", "dead_lettered"].includes(checkpoint.state) &&
      "settledLeaseId" in checkpoint &&
      checkpoint.settledLeaseId === command.leaseId &&
      checkpoint.settlementKey === key &&
      command.expectedRevision === checkpoint.revision - 1
    ) {
      return frozen({
        changed: false,
        checkpoint,
        disposition: dispositionForSettledCheckpoint(checkpoint),
      });
    }
    throw new Error("The ingestion settlement does not match an active lease");
  }
  if (checkpoint.revision !== command.expectedRevision || checkpoint.leaseId !== command.leaseId) {
    throw new Error("The ingestion settlement lease or revision is stale");
  }
  if (command.settledAt < checkpoint.leasedAt || command.settledAt > checkpoint.leaseExpiresAt) {
    throw new Error("The ingestion settlement is outside its lease");
  }
  return checkpoint;
}

function settledBase(
  checkpoint: ClaimedIngestionCheckpointV1,
  command: SettleIngestionAttemptCommand,
  key: string,
  counts: { observationCount: number; createdCount: number; updatedCount: number },
  progressKnown: boolean,
): SettledIngestionCheckpointBase {
  return {
    ...occurrenceFields(checkpoint),
    revision: nextRevision(checkpoint.revision),
    attempt: checkpoint.attempt,
    withdrawalInferred: false,
    settledAttempt: checkpoint.attempt,
    settledLeaseId: command.leaseId,
    settledAt: command.settledAt,
    settlementKey: key,
    progressKnown,
    ...counts,
  };
}

function hashNumber(value: string): number {
  return Number.parseInt(sha256(value).slice(0, 8), 16);
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = new Date(timestamp).getTime() + milliseconds;
  if (!Number.isFinite(value)) {
    throw new Error("The ingestion retry schedule is invalid");
  }
  try {
    return new Date(value).toISOString();
  } catch {
    throw new Error("The ingestion retry schedule is invalid");
  }
}

export function deterministicIngestionRetryDelayMs(
  executionId: string,
  attempt: number,
  retryAfterMs: number,
): number {
  if (
    !sha256Pattern.test(executionId) ||
    !isAttempt(attempt) ||
    !Number.isSafeInteger(retryAfterMs) ||
    retryAfterMs < 1 ||
    retryAfterMs > maximumIngestionRetryDelayMs
  ) {
    throw new Error("The ingestion retry schedule is invalid");
  }
  const maximumJitterMs = Math.min(30_000, Math.floor(retryAfterMs / 4));
  const jitterMs =
    maximumJitterMs === 0 ? 0 : hashNumber(`${executionId}:${attempt}`) % (maximumJitterMs + 1);
  return Math.min(maximumIngestionRetryDelayMs, retryAfterMs + jitterMs);
}

function settlementFingerprint(command: SettleIngestionAttemptCommand, outcome: object): string {
  return settlementKey({
    expectedRevision: command.expectedRevision,
    leaseId: command.leaseId,
    settledAt: command.settledAt,
    sourceEnabled: command.sourceEnabled,
    outcome,
  });
}

export function settleIngestionAttempt(
  checkpoint: IngestionCheckpointV1,
  command: SettleIngestionAttemptCommand,
  result: IngestionRunResult,
): SettleIngestionAttemptResult {
  assertCheckpoint(checkpoint);
  assertSettleCommand(command);
  assertRunResult(result, checkpoint.sourceId);
  const outcome = safeOutcome(result);
  const key = settlementFingerprint(command, outcome);
  const active = assertActiveSettlement(checkpoint, command, key);
  if (!("state" in active)) return active;

  const progressKnown = !active.priorProgressUnknown;
  const counts = progressKnown
    ? {
        observationCount: result.observationCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
      }
    : { observationCount: 0, createdCount: 0, updatedCount: 0 };
  const base = settledBase(active, command, key, counts, progressKnown);
  let settled:
    | RetryWaitingIngestionCheckpointV1
    | PausedIngestionCheckpointV1
    | SucceededIngestionCheckpointV1
    | DeadLetteredIngestionCheckpointV1;

  if (!command.sourceEnabled || result.status === "aborted") {
    const pauseReason: PausedIngestionCheckpointV1["pauseReason"] = command.sourceEnabled
      ? "attempt_aborted"
      : "source_disabled";
    settled = frozen({
      ...base,
      state: "paused",
      pauseReason,
    });
  } else if (result.status === "succeeded") {
    settled = frozen({ ...base, state: "succeeded" });
  } else if (active.attempt >= maximumIngestionAttempts) {
    const failureCode: DeadLetteredIngestionCheckpointV1["failureCode"] = "attempt_limit_exhausted";
    settled = frozen({
      ...base,
      state: "dead_lettered",
      failureCode,
    });
  } else {
    const retryDelayMs = deterministicIngestionRetryDelayMs(
      active.executionId,
      active.attempt,
      result.retryAfterMs,
    );
    settled = frozen({
      ...base,
      state: "retry_wait",
      attempt: active.attempt + 1,
      retryReason: result.reason,
      retryAt: addMilliseconds(command.settledAt, retryDelayMs),
    });
  }
  return frozen({
    changed: true,
    checkpoint: settled,
    disposition: dispositionForSettledCheckpoint(settled),
  });
}

function safeFailureCode(error: unknown): AttemptDeadLetteredIngestionCheckpointV1["failureCode"] {
  return error instanceof SourceBatchContractError
    ? "source_contract_rejected"
    : "ingestion_attempt_failed";
}

export function failIngestionAttempt(
  checkpoint: IngestionCheckpointV1,
  command: SettleIngestionAttemptCommand,
  error: unknown,
): SettleIngestionAttemptResult {
  assertCheckpoint(checkpoint);
  assertSettleCommand(command);
  const failureCode = safeFailureCode(error);
  const outcome = { status: "failed", failureCode };
  const key = settlementFingerprint(command, outcome);
  const active = assertActiveSettlement(checkpoint, command, key);
  if (!("state" in active)) return active;

  const base = settledBase(
    active,
    command,
    key,
    {
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    },
    false,
  );
  const settled: PausedIngestionCheckpointV1 | DeadLetteredIngestionCheckpointV1 =
    command.sourceEnabled
      ? frozen({ ...base, state: "dead_lettered", failureCode })
      : frozen({ ...base, state: "paused", pauseReason: "source_disabled" });
  return frozen({
    changed: true,
    checkpoint: settled,
    disposition: dispositionForSettledCheckpoint(settled),
  });
}
