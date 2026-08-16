import { createHash } from "node:crypto";
import type postgres from "postgres";

export type PersistedIngestionState =
  | "pending"
  | "claimed"
  | "retry_wait"
  | "paused"
  | "succeeded"
  | "dead_lettered";

export interface PersistedIngestionCheckpointV1 {
  schemaVersion: 1;
  executionId: string;
  sourceId: string;
  adapterVersion: string;
  scheduledFor: string;
  state: PersistedIngestionState;
  revision: number;
  attempt: number;
  withdrawalInferred: false;
  leaseId?: string;
  leasedAt?: string;
  leaseExpiresAt?: string;
  priorProgressUnknown?: boolean;
  settledAttempt?: number;
  settledLeaseId?: string;
  settledAt?: string;
  settlementKey?: string;
  progressKnown?: boolean;
  observationCount?: number;
  createdCount?: number;
  updatedCount?: number;
  retryReason?: "rate_limited" | "source_unavailable" | "timeout";
  retryAt?: string;
  pauseReason?: "source_disabled" | "attempt_aborted";
  failureCode?:
    | "attempt_limit_exhausted"
    | "ingestion_attempt_failed"
    | "recovery_generation_exhausted"
    | "source_contract_rejected";
  exhaustedDispatchId?: string;
}

export type IngestionDispatchState =
  | "pending"
  | "claimed"
  | "nudged"
  | "started"
  | "terminal"
  | "publish_failed"
  | "recovery_exhausted";

export interface PersistedIngestionDispatch {
  id: string;
  executionId: string;
  generation: number;
  checkpointRevision: number;
  durableExecutionName: string;
  durableFunctionArn: string;
  activityFunctionArn: string;
  adapterConfigSha256: string;
  state: IngestionDispatchState;
  publishAttempts: number;
  nextAttemptAt: Date;
  lastErrorCode?: string;
  durableExecutionArn?: string;
  durableExecutionId?: string;
  terminalStatus?: "FAILED" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT";
  claimId?: string;
  claimedAt?: Date;
  claimExpiresAt?: Date;
}

export interface NewIngestionDispatch {
  id: string;
  executionId: string;
  generation: number;
  checkpointRevision: number;
  durableExecutionName: string;
  durableFunctionArn: string;
  activityFunctionArn: string;
  adapterConfigSha256: string;
}

export interface IngestionDispatchDeliveryIdentity {
  dispatchId: string;
  executionId: string;
  checkpointRevision: number;
  workflowGeneration: number;
}

export interface IngestionTransitionResult {
  changed: boolean;
  checkpoint: Readonly<PersistedIngestionCheckpointV1>;
  databaseNow: Date;
}

export interface IngestionTransportRecoveryResult {
  retried: number;
  exhausted: number;
}

export type IngestionCheckpointDecision = (
  current: Readonly<PersistedIngestionCheckpointV1>,
  databaseNow: Date,
) => Readonly<PersistedIngestionCheckpointV1>;

export interface IngestionOrchestrationStore {
  ensureScheduledOccurrence(
    checkpoint: PersistedIngestionCheckpointV1,
    dispatch: NewIngestionDispatch,
  ): Promise<{
    checkpoint: Readonly<PersistedIngestionCheckpointV1>;
    dispatch: PersistedIngestionDispatch;
    created: boolean;
  }>;
  getCheckpoint(executionId: string): Promise<Readonly<PersistedIngestionCheckpointV1> | undefined>;
  authenticateActiveAttempt(
    executionId: string,
    revision: number,
    leaseId: string,
    attempt: number,
    leaseExpiresAt: string,
  ): Promise<Readonly<PersistedIngestionCheckpointV1>>;
  transitionCheckpoint(
    executionId: string,
    expectedRevision: number,
    decide: IngestionCheckpointDecision,
  ): Promise<IngestionTransitionResult>;
  ensureRecoveryDispatch(
    executionId: string,
    completedGeneration: number,
    dispatchId: string,
    durableFunctionArn: string,
    activityFunctionArn: string,
    adapterConfigSha256: string,
  ): Promise<PersistedIngestionDispatch | undefined>;
  ensurePausedResumeDispatches(
    sourceId: string,
    dispatchIds: readonly string[],
    durableFunctionArn: string,
    activityFunctionArn: string,
    adapterConfigSha256: string,
  ): Promise<readonly PersistedIngestionDispatch[]>;
  recoverTransportDispatches(sourceId: string): Promise<IngestionTransportRecoveryResult>;
  listStartedDispatchesForReconciliation(
    sourceId: string,
    limit: number,
  ): Promise<readonly PersistedIngestionDispatch[]>;
  recordDurableTerminal(
    durableExecutionName: string,
    status: "FAILED" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT",
    durableExecutionArn: string,
    durableFunctionArn: string,
  ): Promise<PersistedIngestionDispatch>;
}

const executionIdPattern = /^[a-f0-9]{64}$/u;
const uuidV7Pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ingestionDispatchErrorCodes = Object.freeze([
  "IngestionDispatchFailure",
  "IngestionNudgeNotAccepted",
  "NudgeStartUnconfirmed",
  "RecoveryGenerationLimit",
  "ServiceUnavailableException",
  "ThrottlingException",
  "TimeoutError",
  "TooManyRequestsException",
  "TransportRecoveryExhausted",
] as const);
export type IngestionDispatchErrorCode = (typeof ingestionDispatchErrorCodes)[number];
function isIngestionDispatchErrorCode(value: unknown): value is IngestionDispatchErrorCode {
  return ingestionDispatchErrorCodes.includes(value as IngestionDispatchErrorCode);
}
function isPublishErrorCode(value: unknown): boolean {
  return [
    "IngestionDispatchFailure",
    "IngestionNudgeNotAccepted",
    "ServiceUnavailableException",
    "ThrottlingException",
    "TimeoutError",
    "TooManyRequestsException",
  ].includes(String(value));
}
const versionedLambdaArnPattern =
  /^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$/u;
const syntheticSourceIdentifierPattern = /^synthetic-[a-z0-9][a-z0-9-]{0,53}$/u;
const adapterVersionPattern = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function aggregate(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

const baseKeys = [
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
const settledKeys = [
  ...baseKeys,
  "settledAttempt",
  "settledLeaseId",
  "settledAt",
  "settlementKey",
  "progressKnown",
  "observationCount",
  "createdCount",
  "updatedCount",
] as const;
const recoveryExhaustedKeys = [...baseKeys, "exhaustedDispatchId", "failureCode"] as const;

export function assertPersistedIngestionCheckpoint(
  value: unknown,
): asserts value is PersistedIngestionCheckpointV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The persisted ingestion checkpoint is invalid");
  }
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== 1 ||
    typeof item.executionId !== "string" ||
    !executionIdPattern.test(item.executionId) ||
    typeof item.sourceId !== "string" ||
    !syntheticSourceIdentifierPattern.test(item.sourceId) ||
    typeof item.adapterVersion !== "string" ||
    !adapterVersionPattern.test(item.adapterVersion) ||
    !canonicalTimestamp(item.scheduledFor) ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 0 ||
    !Number.isSafeInteger(item.attempt) ||
    Number(item.attempt) < 1 ||
    Number(item.attempt) > 5 ||
    item.withdrawalInferred !== false
  ) {
    throw new Error("The persisted ingestion checkpoint is invalid");
  }
  if (item.state === "pending" && exactKeys(item, baseKeys)) return;
  if (
    item.state === "claimed" &&
    exactKeys(item, [
      ...baseKeys,
      "leaseId",
      "leasedAt",
      "leaseExpiresAt",
      "priorProgressUnknown",
    ]) &&
    typeof item.leaseId === "string" &&
    uuidV7Pattern.test(item.leaseId) &&
    canonicalTimestamp(item.leasedAt) &&
    canonicalTimestamp(item.leaseExpiresAt) &&
    new Date(item.leasedAt).getTime() >= new Date(item.scheduledFor).getTime() &&
    new Date(item.leaseExpiresAt).getTime() > new Date(item.leasedAt).getTime() &&
    new Date(item.leaseExpiresAt).getTime() - new Date(item.leasedAt).getTime() <=
      15 * 60 * 1_000 &&
    typeof item.priorProgressUnknown === "boolean"
  ) {
    return;
  }
  if (
    item.state === "dead_lettered" &&
    item.failureCode === "recovery_generation_exhausted" &&
    exactKeys(item, recoveryExhaustedKeys) &&
    typeof item.exhaustedDispatchId === "string" &&
    uuidV7Pattern.test(item.exhaustedDispatchId)
  ) {
    return;
  }
  const settled =
    typeof item.settledLeaseId === "string" &&
    uuidV7Pattern.test(item.settledLeaseId) &&
    canonicalTimestamp(item.settledAt) &&
    new Date(item.settledAt).getTime() >= new Date(item.scheduledFor).getTime() &&
    typeof item.settlementKey === "string" &&
    executionIdPattern.test(item.settlementKey) &&
    typeof item.progressKnown === "boolean" &&
    aggregate(item.observationCount) &&
    aggregate(item.createdCount) &&
    aggregate(item.updatedCount) &&
    Number(item.observationCount) === Number(item.createdCount) + Number(item.updatedCount);
  if (!settled) throw new Error("The persisted ingestion checkpoint is invalid");
  if (
    item.state === "retry_wait" &&
    exactKeys(item, [...settledKeys, "retryReason", "retryAt"]) &&
    ["rate_limited", "source_unavailable", "timeout"].includes(String(item.retryReason)) &&
    canonicalTimestamp(item.retryAt)
  ) {
    return;
  }
  if (
    item.state === "paused" &&
    exactKeys(item, [...settledKeys, "pauseReason"]) &&
    ["source_disabled", "attempt_aborted"].includes(String(item.pauseReason))
  ) {
    return;
  }
  if (item.state === "succeeded" && exactKeys(item, settledKeys)) return;
  if (
    item.state === "dead_lettered" &&
    exactKeys(item, [...settledKeys, "failureCode"]) &&
    ["attempt_limit_exhausted", "ingestion_attempt_failed", "source_contract_rejected"].includes(
      String(item.failureCode),
    )
  ) {
    return;
  }
  throw new Error("The persisted ingestion checkpoint is invalid");
}

interface CheckpointRow {
  schemaVersion: number;
  executionId: string;
  sourceId: string;
  adapterVersion: string;
  scheduledFor: Date;
  state: PersistedIngestionState;
  revision: string;
  attempt: number;
  withdrawalInferred: boolean;
  leaseId: string | null;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  priorProgressUnknown: boolean | null;
  settledAttempt: number | null;
  settledLeaseId: string | null;
  settledAt: Date | null;
  settlementKey: string | null;
  progressKnown: boolean | null;
  observationCount: number | null;
  createdCount: number | null;
  updatedCount: number | null;
  retryReason: PersistedIngestionCheckpointV1["retryReason"] | null;
  retryAt: Date | null;
  pauseReason: PersistedIngestionCheckpointV1["pauseReason"] | null;
  failureCode: PersistedIngestionCheckpointV1["failureCode"] | null;
  exhaustedDispatchId: string | null;
}

const checkpointSelection = `
  schema_version AS "schemaVersion", execution_id AS "executionId",
  source_id AS "sourceId", adapter_version AS "adapterVersion",
  scheduled_for AS "scheduledFor", state, revision::text, attempt,
  withdrawal_inferred AS "withdrawalInferred", lease_id AS "leaseId",
  leased_at AS "leasedAt", lease_expires_at AS "leaseExpiresAt",
  prior_progress_unknown AS "priorProgressUnknown", settled_attempt AS "settledAttempt",
  settled_lease_id AS "settledLeaseId", settled_at AS "settledAt",
  settlement_key AS "settlementKey", progress_known AS "progressKnown",
  observation_count AS "observationCount", created_count AS "createdCount",
  updated_count AS "updatedCount", retry_reason AS "retryReason", retry_at AS "retryAt",
  pause_reason AS "pauseReason", failure_code AS "failureCode",
  exhausted_dispatch_id AS "exhaustedDispatchId"
`;

function mapCheckpoint(row: CheckpointRow): Readonly<PersistedIngestionCheckpointV1> {
  const value = {
    schemaVersion: row.schemaVersion,
    executionId: row.executionId,
    sourceId: row.sourceId,
    adapterVersion: row.adapterVersion,
    scheduledFor: row.scheduledFor.toISOString(),
    state: row.state,
    revision: Number(row.revision),
    attempt: row.attempt,
    withdrawalInferred: row.withdrawalInferred,
    ...(row.leaseId ? { leaseId: row.leaseId } : {}),
    ...(row.leasedAt ? { leasedAt: row.leasedAt.toISOString() } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAt: row.leaseExpiresAt.toISOString() } : {}),
    ...(row.priorProgressUnknown !== null
      ? { priorProgressUnknown: row.priorProgressUnknown }
      : {}),
    ...(row.settledAttempt !== null ? { settledAttempt: row.settledAttempt } : {}),
    ...(row.settledLeaseId ? { settledLeaseId: row.settledLeaseId } : {}),
    ...(row.settledAt ? { settledAt: row.settledAt.toISOString() } : {}),
    ...(row.settlementKey ? { settlementKey: row.settlementKey } : {}),
    ...(row.progressKnown !== null ? { progressKnown: row.progressKnown } : {}),
    ...(row.observationCount !== null ? { observationCount: row.observationCount } : {}),
    ...(row.createdCount !== null ? { createdCount: row.createdCount } : {}),
    ...(row.updatedCount !== null ? { updatedCount: row.updatedCount } : {}),
    ...(row.retryReason ? { retryReason: row.retryReason } : {}),
    ...(row.retryAt ? { retryAt: row.retryAt.toISOString() } : {}),
    ...(row.pauseReason ? { pauseReason: row.pauseReason } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.exhaustedDispatchId ? { exhaustedDispatchId: row.exhaustedDispatchId } : {}),
  };
  assertPersistedIngestionCheckpoint(value);
  return Object.freeze(value);
}

function dispatchName(executionId: string, generation: number): string {
  return createHash("sha256").update(`${executionId}\n${generation}\n`, "utf8").digest("hex");
}

export function durableIngestionExecutionName(executionId: string, generation: number): string {
  if (
    !executionIdPattern.test(executionId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > 20
  ) {
    throw new Error("The durable ingestion execution identity is invalid");
  }
  return dispatchName(executionId, generation);
}

interface DispatchRow {
  id: string;
  executionId: string;
  generation: number;
  checkpointRevision: string;
  durableExecutionName: string;
  durableFunctionArn: string;
  activityFunctionArn: string;
  adapterConfigSha256: string;
  state: IngestionDispatchState;
  publishAttempts: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  durableExecutionArn: string | null;
  durableExecutionId: string | null;
  terminalStatus: PersistedIngestionDispatch["terminalStatus"] | null;
  claimId: string | null;
  claimedAt: Date | null;
  claimExpiresAt: Date | null;
}

function mapDispatch(row: DispatchRow): PersistedIngestionDispatch {
  const value: PersistedIngestionDispatch = {
    id: row.id,
    executionId: row.executionId,
    generation: row.generation,
    checkpointRevision: Number(row.checkpointRevision),
    durableExecutionName: row.durableExecutionName,
    durableFunctionArn: row.durableFunctionArn,
    activityFunctionArn: row.activityFunctionArn,
    adapterConfigSha256: row.adapterConfigSha256,
    state: row.state,
    publishAttempts: row.publishAttempts,
    nextAttemptAt: row.nextAttemptAt,
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    ...(row.durableExecutionArn ? { durableExecutionArn: row.durableExecutionArn } : {}),
    ...(row.durableExecutionId ? { durableExecutionId: row.durableExecutionId } : {}),
    ...(row.terminalStatus ? { terminalStatus: row.terminalStatus } : {}),
    ...(row.claimId ? { claimId: row.claimId } : {}),
    ...(row.claimedAt ? { claimedAt: row.claimedAt } : {}),
    ...(row.claimExpiresAt ? { claimExpiresAt: row.claimExpiresAt } : {}),
  };
  if (
    !uuidV7Pattern.test(value.id) ||
    !executionIdPattern.test(value.executionId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.generation > 20 ||
    !Number.isSafeInteger(value.checkpointRevision) ||
    value.checkpointRevision < 0 ||
    value.durableExecutionName !==
      durableIngestionExecutionName(value.executionId, value.generation) ||
    !versionedLambdaArnPattern.test(value.durableFunctionArn) ||
    !versionedLambdaArnPattern.test(value.activityFunctionArn) ||
    !executionIdPattern.test(value.adapterConfigSha256) ||
    !Number.isSafeInteger(value.publishAttempts) ||
    value.publishAttempts < 0 ||
    value.publishAttempts > 5 ||
    !Number.isFinite(value.nextAttemptAt.getTime()) ||
    (value.lastErrorCode !== undefined && !isIngestionDispatchErrorCode(value.lastErrorCode))
  ) {
    throw new Error("The persisted ingestion dispatch is invalid");
  }
  const claimFields = [value.claimId, value.claimedAt, value.claimExpiresAt];
  const noClaim = claimFields.every((field) => field === undefined);
  const exactClaim =
    typeof value.claimId === "string" &&
    uuidV7Pattern.test(value.claimId) &&
    value.claimedAt instanceof Date &&
    Number.isFinite(value.claimedAt.getTime()) &&
    value.claimExpiresAt instanceof Date &&
    Number.isFinite(value.claimExpiresAt.getTime()) &&
    value.claimExpiresAt > value.claimedAt;
  const exactExecution =
    typeof value.durableExecutionId === "string" &&
    /^[A-Za-z0-9_-]+$/u.test(value.durableExecutionId) &&
    value.durableExecutionArn ===
      `${value.durableFunctionArn}/durable-execution/${value.durableExecutionName}/${value.durableExecutionId}` &&
    String(value.durableExecutionArn).length <= 1_024;
  const noExecution =
    value.durableExecutionArn === undefined && value.durableExecutionId === undefined;
  const validState =
    (value.state === "pending" &&
      value.publishAttempts <= 4 &&
      (value.lastErrorCode === undefined ||
        value.lastErrorCode === "NudgeStartUnconfirmed" ||
        isPublishErrorCode(value.lastErrorCode)) &&
      noClaim &&
      noExecution &&
      value.terminalStatus === undefined) ||
    (value.state === "claimed" &&
      value.publishAttempts <= 4 &&
      (value.lastErrorCode === undefined ||
        value.lastErrorCode === "NudgeStartUnconfirmed" ||
        isPublishErrorCode(value.lastErrorCode)) &&
      exactClaim &&
      noExecution &&
      value.terminalStatus === undefined) ||
    (value.state === "nudged" &&
      value.publishAttempts >= 1 &&
      value.lastErrorCode === undefined &&
      noClaim &&
      noExecution &&
      value.terminalStatus === undefined) ||
    (value.state === "started" &&
      value.publishAttempts >= 1 &&
      value.lastErrorCode === undefined &&
      noClaim &&
      exactExecution &&
      value.terminalStatus === undefined) ||
    (value.state === "terminal" &&
      value.publishAttempts >= 1 &&
      (value.lastErrorCode === undefined || value.lastErrorCode === "TransportRecoveryExhausted") &&
      noClaim &&
      exactExecution &&
      ["FAILED", "STOPPED", "SUCCEEDED", "TIMED_OUT"].includes(String(value.terminalStatus))) ||
    (value.state === "publish_failed" &&
      noClaim &&
      noExecution &&
      value.publishAttempts === 5 &&
      isPublishErrorCode(value.lastErrorCode) &&
      value.terminalStatus === undefined) ||
    (value.state === "recovery_exhausted" &&
      noClaim &&
      ((value.lastErrorCode === "TransportRecoveryExhausted" &&
        value.publishAttempts === 5 &&
        noExecution &&
        value.terminalStatus === undefined) ||
        (value.generation === 20 &&
          value.lastErrorCode === "RecoveryGenerationLimit" &&
          ((noExecution && value.terminalStatus === undefined) ||
            (exactExecution &&
              ["FAILED", "STOPPED", "SUCCEEDED", "TIMED_OUT"].includes(
                String(value.terminalStatus),
              ))))));
  if (!validState) throw new Error("The persisted ingestion dispatch state is invalid");
  return Object.freeze(value);
}

const dispatchSelection = `
  id, execution_id AS "executionId", generation, checkpoint_revision::text AS "checkpointRevision",
  durable_execution_name AS "durableExecutionName", state,
  durable_function_arn AS "durableFunctionArn", activity_function_arn AS "activityFunctionArn",
  adapter_config_sha256 AS "adapterConfigSha256",
  publish_attempts AS "publishAttempts", next_attempt_at AS "nextAttemptAt",
  last_error_code AS "lastErrorCode", durable_execution_arn AS "durableExecutionArn",
  durable_execution_id AS "durableExecutionId",
  terminal_status AS "terminalStatus", claim_id AS "claimId", claimed_at AS "claimedAt",
  claim_expires_at AS "claimExpiresAt"
`;
const joinedDispatchSelection = `
  dispatch.id, dispatch.execution_id AS "executionId", dispatch.generation,
  dispatch.checkpoint_revision::text AS "checkpointRevision",
  dispatch.durable_execution_name AS "durableExecutionName", dispatch.state,
  dispatch.durable_function_arn AS "durableFunctionArn",
  dispatch.activity_function_arn AS "activityFunctionArn",
  dispatch.adapter_config_sha256 AS "adapterConfigSha256",
  dispatch.publish_attempts AS "publishAttempts",
  dispatch.next_attempt_at AS "nextAttemptAt",
  dispatch.last_error_code AS "lastErrorCode",
  dispatch.durable_execution_arn AS "durableExecutionArn",
  dispatch.durable_execution_id AS "durableExecutionId",
  dispatch.terminal_status AS "terminalStatus", dispatch.claim_id AS "claimId",
  dispatch.claimed_at AS "claimedAt", dispatch.claim_expires_at AS "claimExpiresAt"
`;

export class PostgresIngestionOrchestrationStore implements IngestionOrchestrationStore {
  constructor(private readonly client: postgres.Sql) {}

  async ensureScheduledOccurrence(
    checkpoint: PersistedIngestionCheckpointV1,
    dispatch: NewIngestionDispatch,
  ): Promise<{
    checkpoint: Readonly<PersistedIngestionCheckpointV1>;
    dispatch: PersistedIngestionDispatch;
    created: boolean;
  }> {
    assertPersistedIngestionCheckpoint(checkpoint);
    if (
      checkpoint.state !== "pending" ||
      checkpoint.revision !== 0 ||
      dispatch.executionId !== checkpoint.executionId ||
      dispatch.generation !== 1 ||
      dispatch.checkpointRevision !== 0 ||
      dispatch.durableExecutionName !== durableIngestionExecutionName(checkpoint.executionId, 1) ||
      !versionedLambdaArnPattern.test(dispatch.durableFunctionArn) ||
      !versionedLambdaArnPattern.test(dispatch.activityFunctionArn) ||
      !executionIdPattern.test(dispatch.adapterConfigSha256) ||
      !uuidV7Pattern.test(dispatch.id)
    ) {
      throw new Error("The initial ingestion occurrence or dispatch is invalid");
    }
    return this.client.begin(async (transaction) => {
      const inserted = await transaction.unsafe<{ executionId: string }[]>(
        `
        INSERT INTO jobs.ingestion_checkpoints (
          execution_id, schema_version, source_id, adapter_version, scheduled_for,
          state, revision, attempt, withdrawal_inferred
        ) VALUES ($1, 1, $2, $3, $4, 'pending', 0, 1, false)
        ON CONFLICT (execution_id) DO NOTHING RETURNING execution_id AS "executionId"
      `,
        [
          checkpoint.executionId,
          checkpoint.sourceId,
          checkpoint.adapterVersion,
          checkpoint.scheduledFor,
        ],
      );
      const created = inserted.length === 1;
      if (created) {
        await transaction.unsafe(
          `
          INSERT INTO jobs.ingestion_dispatches (
            id, execution_id, generation, checkpoint_revision, durable_execution_name,
            durable_function_arn, activity_function_arn, adapter_config_sha256, state,
            next_attempt_at
          ) VALUES ($1, $2, 1, 0, $3, $4, $5, $6, 'pending', $7)
        `,
          [
            dispatch.id,
            dispatch.executionId,
            dispatch.durableExecutionName,
            dispatch.durableFunctionArn,
            dispatch.activityFunctionArn,
            dispatch.adapterConfigSha256,
            checkpoint.scheduledFor,
          ],
        );
      }
      const checkpointRows = await transaction.unsafe<CheckpointRow[]>(
        `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints WHERE execution_id = $1`,
        [checkpoint.executionId],
      );
      const dispatchRows = await transaction.unsafe<DispatchRow[]>(
        `SELECT ${dispatchSelection} FROM jobs.ingestion_dispatches WHERE execution_id = $1 AND generation = 1`,
        [checkpoint.executionId],
      );
      const storedCheckpoint = checkpointRows[0];
      const storedDispatch = dispatchRows[0];
      if (!storedCheckpoint || !storedDispatch)
        throw new Error("The ingestion occurrence was not persisted");
      const mapped = mapCheckpoint(storedCheckpoint);
      const mappedDispatch = mapDispatch(storedDispatch);
      const immutableOccurrenceMatches =
        mapped.schemaVersion === checkpoint.schemaVersion &&
        mapped.executionId === checkpoint.executionId &&
        mapped.sourceId === checkpoint.sourceId &&
        mapped.adapterVersion === checkpoint.adapterVersion &&
        mapped.scheduledFor === checkpoint.scheduledFor &&
        mapped.withdrawalInferred === checkpoint.withdrawalInferred;
      const initialDispatchIdentityMatches =
        mappedDispatch.executionId === dispatch.executionId &&
        mappedDispatch.generation === 1 &&
        mappedDispatch.checkpointRevision === 0 &&
        mappedDispatch.durableExecutionName === dispatch.durableExecutionName &&
        mappedDispatch.durableFunctionArn.replace(/:[1-9][0-9]*$/u, "") ===
          dispatch.durableFunctionArn.replace(/:[1-9][0-9]*$/u, "") &&
        mappedDispatch.activityFunctionArn.replace(/:[1-9][0-9]*$/u, "") ===
          dispatch.activityFunctionArn.replace(/:[1-9][0-9]*$/u, "");
      if (!immutableOccurrenceMatches || !initialDispatchIdentityMatches) {
        throw new Error("The ingestion occurrence conflicts with persisted truth");
      }
      if (
        mapped.state === "dead_lettered" &&
        mapped.failureCode === "recovery_generation_exhausted" &&
        mapped.executionId === checkpoint.executionId
      ) {
        throw new Error("The ingestion occurrence exhausted durable recovery generations");
      }
      return { checkpoint: mapped, dispatch: mappedDispatch, created };
    });
  }

  async getCheckpoint(
    executionId: string,
  ): Promise<Readonly<PersistedIngestionCheckpointV1> | undefined> {
    if (!executionIdPattern.test(executionId))
      throw new Error("The ingestion execution identity is invalid");
    const rows = await this.client.unsafe<CheckpointRow[]>(
      `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints WHERE execution_id = $1`,
      [executionId],
    );
    return rows[0] ? mapCheckpoint(rows[0]) : undefined;
  }

  async authenticateActiveAttempt(
    executionId: string,
    revision: number,
    leaseId: string,
    attempt: number,
    leaseExpiresAt: string,
  ): Promise<Readonly<PersistedIngestionCheckpointV1>> {
    if (
      !executionIdPattern.test(executionId) ||
      !Number.isSafeInteger(revision) ||
      !uuidV7Pattern.test(leaseId) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      attempt > 5 ||
      !canonicalTimestamp(leaseExpiresAt)
    ) {
      throw new Error("The ingestion activity lease identity is invalid");
    }
    return this.client.begin(async (transaction) => {
      const rows = await transaction.unsafe<CheckpointRow[]>(
        `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints
         WHERE execution_id=$1 FOR SHARE`,
        [executionId],
      );
      const [clock] = await transaction.unsafe<{ now: Date }[]>("SELECT clock_timestamp() AS now");
      const checkpoint = rows[0] ? mapCheckpoint(rows[0]) : undefined;
      if (
        !checkpoint ||
        !clock ||
        checkpoint.state !== "claimed" ||
        checkpoint.revision !== revision ||
        checkpoint.leaseId !== leaseId ||
        checkpoint.attempt !== attempt ||
        checkpoint.leaseExpiresAt !== leaseExpiresAt ||
        new Date(clock.now).toISOString() >= leaseExpiresAt
      ) {
        throw new Error("The durable ingestion activity lease is stale");
      }
      return checkpoint;
    });
  }

  async transitionCheckpoint(
    executionId: string,
    expectedRevision: number,
    decide: IngestionCheckpointDecision,
  ): Promise<IngestionTransitionResult> {
    if (!executionIdPattern.test(executionId) || !Number.isSafeInteger(expectedRevision)) {
      throw new Error("The ingestion transition identity is invalid");
    }
    return this.client.begin(async (transaction) => {
      const rows = await transaction.unsafe<CheckpointRow[]>(
        `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints WHERE execution_id = $1 FOR UPDATE`,
        [executionId],
      );
      const [clock] = await transaction.unsafe<{ now: Date }[]>("SELECT clock_timestamp() AS now");
      if (!clock || !rows[0]) throw new Error("The ingestion checkpoint was not found");
      const current = mapCheckpoint(rows[0]);
      if (current.revision !== expectedRevision) {
        throw new Error("The ingestion checkpoint revision is stale");
      }
      const next = decide(current, new Date(clock.now));
      assertPersistedIngestionCheckpoint(next);
      if (next.executionId !== executionId)
        throw new Error("The ingestion transition changed identity");
      if (JSON.stringify(next) === JSON.stringify(current)) {
        return { changed: false, checkpoint: current, databaseNow: new Date(clock.now) };
      }
      if (next.revision !== current.revision + 1) {
        throw new Error("The ingestion checkpoint revision is stale");
      }
      await transaction.unsafe(
        `
        UPDATE jobs.ingestion_checkpoints SET
          state=$3, revision=$4, attempt=$5, lease_id=$6, leased_at=$7,
          lease_expires_at=$8, prior_progress_unknown=$9, settled_attempt=$10,
          settled_lease_id=$11, settled_at=$12, settlement_key=$13, progress_known=$14,
          observation_count=$15, created_count=$16, updated_count=$17, retry_reason=$18,
          retry_at=$19, pause_reason=$20, failure_code=$21, exhausted_dispatch_id=$22,
          updated_at=$23
        WHERE execution_id=$1 AND revision=$2
      `,
        [
          executionId,
          expectedRevision,
          next.state,
          next.revision,
          next.attempt,
          next.leaseId ?? null,
          next.leasedAt ?? null,
          next.leaseExpiresAt ?? null,
          next.priorProgressUnknown ?? null,
          next.settledAttempt ?? null,
          next.settledLeaseId ?? null,
          next.settledAt ?? null,
          next.settlementKey ?? null,
          next.progressKnown ?? null,
          next.observationCount ?? null,
          next.createdCount ?? null,
          next.updatedCount ?? null,
          next.retryReason ?? null,
          next.retryAt ?? null,
          next.pauseReason ?? null,
          next.failureCode ?? null,
          next.exhaustedDispatchId ?? null,
          clock.now,
        ],
      );
      return {
        changed: true,
        checkpoint: Object.freeze({ ...next }),
        databaseNow: new Date(clock.now),
      };
    });
  }

  async claimDispatches(limit: number, claimId: string): Promise<PersistedIngestionDispatch[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25 || !uuidV7Pattern.test(claimId)) {
      throw new Error("The ingestion dispatch claim is invalid");
    }
    return this.client.begin(async (transaction) => {
      const rows = await transaction.unsafe<DispatchRow[]>(
        `
        WITH candidates AS (
          SELECT id AS candidate_id FROM jobs.ingestion_dispatches
          WHERE (state = 'pending' OR (state = 'claimed' AND claim_expires_at <= clock_timestamp()))
            AND next_attempt_at <= clock_timestamp()
          ORDER BY next_attempt_at, created_at, id
          FOR UPDATE SKIP LOCKED LIMIT $1
        )
        UPDATE jobs.ingestion_dispatches AS dispatch SET
          state='claimed', claim_id=$2, claimed_at=statement_timestamp(),
          claim_expires_at=statement_timestamp()+interval '1 minute',
          updated_at=statement_timestamp()
        FROM candidates WHERE dispatch.id=candidates.candidate_id
        RETURNING ${dispatchSelection}
      `,
        [limit, claimId],
      );
      return rows.map(mapDispatch);
    });
  }

  async recordDispatchNudged(id: string, claimId: string): Promise<void> {
    const rows = await this.client.unsafe<{ id: string }[]>(
      `
      UPDATE jobs.ingestion_dispatches SET state='nudged', claim_id=NULL, claimed_at=NULL,
        claim_expires_at=NULL, publish_attempts=publish_attempts+1, last_error_code=NULL,
        updated_at=clock_timestamp()
      WHERE id=$1 AND state='claimed' AND claim_id=$2 RETURNING id
    `,
      [id, claimId],
    );
    if (rows.length === 1) return;
    const replay = await this.client.unsafe<{ id: string }[]>(
      `SELECT id FROM jobs.ingestion_dispatches
       WHERE id=$1 AND (
         state IN ('nudged', 'started', 'terminal')
         OR (state='recovery_exhausted' AND last_error_code='RecoveryGenerationLimit')
       )`,
      [id],
    );
    if (replay.length !== 1) throw new Error("The ingestion dispatch claim is stale");
  }

  async confirmDispatchDelivery(
    identity: IngestionDispatchDeliveryIdentity,
    runtimeBoundary: { durableFunctionArn: string; activityFunctionArn: string },
  ): Promise<PersistedIngestionDispatch> {
    if (
      !uuidV7Pattern.test(identity.dispatchId) ||
      !executionIdPattern.test(identity.executionId) ||
      !Number.isSafeInteger(identity.checkpointRevision) ||
      identity.checkpointRevision < 0 ||
      !Number.isSafeInteger(identity.workflowGeneration) ||
      identity.workflowGeneration < 1 ||
      identity.workflowGeneration > 20 ||
      !versionedLambdaArnPattern.test(runtimeBoundary.durableFunctionArn) ||
      !versionedLambdaArnPattern.test(runtimeBoundary.activityFunctionArn)
    ) {
      throw new Error("The ingestion delivery identity is invalid");
    }
    return this.client.begin(async (transaction) => {
      const rows = await transaction.unsafe<DispatchRow[]>(
        `SELECT ${dispatchSelection} FROM jobs.ingestion_dispatches
         WHERE id=$1 FOR UPDATE`,
        [identity.dispatchId],
      );
      const current = rows[0] ? mapDispatch(rows[0]) : undefined;
      if (
        !current ||
        current.executionId !== identity.executionId ||
        current.checkpointRevision !== identity.checkpointRevision ||
        current.generation !== identity.workflowGeneration ||
        current.durableExecutionName !==
          durableIngestionExecutionName(identity.executionId, identity.workflowGeneration) ||
        current.durableFunctionArn.replace(/:[1-9][0-9]*$/u, "") !==
          runtimeBoundary.durableFunctionArn.replace(/:[1-9][0-9]*$/u, "") ||
        current.activityFunctionArn.replace(/:[1-9][0-9]*$/u, "") !==
          runtimeBoundary.activityFunctionArn.replace(/:[1-9][0-9]*$/u, "")
      ) {
        throw new Error("The ingestion delivery conflicts with persisted truth");
      }
      if (
        current.state === "nudged" ||
        current.state === "started" ||
        current.state === "terminal" ||
        (current.state === "recovery_exhausted" &&
          current.lastErrorCode === "RecoveryGenerationLimit")
      ) {
        return current;
      }
      const promotable =
        current.state === "claimed" ||
        (current.state === "pending" && current.publishAttempts > 0) ||
        current.state === "publish_failed" ||
        (current.state === "recovery_exhausted" &&
          current.lastErrorCode === "TransportRecoveryExhausted");
      if (!promotable) throw new Error("The ingestion delivery state is invalid");
      const confirmed = await transaction.unsafe<DispatchRow[]>(
        `UPDATE jobs.ingestion_dispatches SET state='nudged',
           claim_id=NULL, claimed_at=NULL, claim_expires_at=NULL,
           publish_attempts=CASE WHEN state='claimed' THEN publish_attempts+1
                                 ELSE publish_attempts END,
           last_error_code=NULL, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING ${dispatchSelection}`,
        [identity.dispatchId],
      );
      if (!confirmed[0]) throw new Error("The ingestion delivery confirmation is stale");
      return mapDispatch(confirmed[0]);
    });
  }

  async recordDispatchFailure(
    id: string,
    claimId: string,
    errorCode: IngestionDispatchErrorCode,
  ): Promise<void> {
    if (!isIngestionDispatchErrorCode(errorCode))
      throw new Error("The ingestion dispatch error code is invalid");
    const rows = await this.client.unsafe<{ id: string }[]>(
      `
      UPDATE jobs.ingestion_dispatches SET
        state=CASE WHEN publish_attempts+1 >= 5 THEN 'publish_failed' ELSE 'pending' END,
        claim_id=NULL, claimed_at=NULL, claim_expires_at=NULL,
        publish_attempts=publish_attempts+1, last_error_code=$3,
        next_attempt_at=clock_timestamp()+interval '5 minutes', updated_at=clock_timestamp()
      WHERE id=$1 AND state='claimed' AND claim_id=$2 RETURNING id
    `,
      [id, claimId, errorCode],
    );
    if (rows.length !== 1) throw new Error("The ingestion dispatch claim is stale");
  }

  async getDispatch(id: string): Promise<PersistedIngestionDispatch | undefined> {
    if (!uuidV7Pattern.test(id)) throw new Error("The ingestion dispatch identity is invalid");
    const rows = await this.client.unsafe<DispatchRow[]>(
      `SELECT ${dispatchSelection} FROM jobs.ingestion_dispatches WHERE id=$1`,
      [id],
    );
    return rows[0] ? mapDispatch(rows[0]) : undefined;
  }

  async recordDurableStart(id: string, executionArn: string): Promise<void> {
    const executionId =
      /^arn:[^:]+:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*\/durable-execution\/[A-Za-z0-9_-]{1,64}\/([A-Za-z0-9_-]+)$/u.exec(
        executionArn,
      )?.[1];
    if (!executionId || executionArn.length > 1_024)
      throw new Error("The durable execution identity is invalid");
    const rows = await this.client.unsafe<{ id: string }[]>(
      `
      UPDATE jobs.ingestion_dispatches SET state='started', durable_execution_arn=$2,
        durable_execution_id=$3,
        updated_at=clock_timestamp()
      WHERE id=$1 AND state='nudged'
        AND $2 = durable_function_arn || '/durable-execution/' || durable_execution_name || '/' || $3
      RETURNING id
    `,
      [id, executionArn, executionId],
    );
    if (rows.length !== 1) throw new Error("The durable ingestion start is stale");
  }

  async recordDurableTerminal(
    durableExecutionName: string,
    status: "FAILED" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT",
    durableExecutionArn: string,
    durableFunctionArn: string,
  ): Promise<PersistedIngestionDispatch> {
    const durableExecutionId = new RegExp(
      `^${durableFunctionArn.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\/durable-execution\\/${durableExecutionName}\\/([A-Za-z0-9_-]+)$`,
      "u",
    ).exec(durableExecutionArn)?.[1];
    if (
      !executionIdPattern.test(durableExecutionName) ||
      !versionedLambdaArnPattern.test(durableFunctionArn) ||
      !durableExecutionId ||
      durableExecutionArn.length > 1_024
    ) {
      throw new Error("The durable execution identity is invalid");
    }
    return this.client.begin(async (transaction) => {
      const rows = await transaction.unsafe<DispatchRow[]>(
        `
        UPDATE jobs.ingestion_dispatches SET state='terminal', terminal_status=$2,
          durable_execution_arn=COALESCE(durable_execution_arn, $3),
          durable_execution_id=COALESCE(durable_execution_id, $5),
          updated_at=clock_timestamp()
        WHERE durable_execution_name=$1 AND durable_function_arn=$4
          AND $3 = durable_function_arn || '/durable-execution/' || durable_execution_name || '/' || $5
          AND (
            (state='nudged' AND durable_execution_arn IS NULL AND durable_execution_id IS NULL)
            OR (state='recovery_exhausted' AND last_error_code='TransportRecoveryExhausted'
                AND durable_execution_arn IS NULL AND durable_execution_id IS NULL)
            OR (state='started' AND durable_execution_arn=$3 AND durable_execution_id=$5)
          )
        RETURNING ${dispatchSelection}
      `,
        [durableExecutionName, status, durableExecutionArn, durableFunctionArn, durableExecutionId],
      );
      if (rows[0]) return mapDispatch(rows[0]);
      const replay = await transaction.unsafe<DispatchRow[]>(
        `SELECT ${dispatchSelection} FROM jobs.ingestion_dispatches
         WHERE durable_execution_name=$1 AND durable_function_arn=$3
           AND durable_execution_arn=$4 AND durable_execution_id=$5
           AND state IN ('terminal', 'recovery_exhausted') AND terminal_status=$2`,
        [durableExecutionName, status, durableFunctionArn, durableExecutionArn, durableExecutionId],
      );
      if (!replay[0]) throw new Error("The durable ingestion terminal transition is stale");
      return mapDispatch(replay[0]);
    });
  }

  async ensureRecoveryDispatch(
    executionId: string,
    completedGeneration: number,
    dispatchId: string,
    durableFunctionArn: string,
    activityFunctionArn: string,
    adapterConfigSha256: string,
  ): Promise<PersistedIngestionDispatch | undefined> {
    if (
      !executionIdPattern.test(executionId) ||
      !Number.isSafeInteger(completedGeneration) ||
      completedGeneration < 1 ||
      completedGeneration > 20 ||
      !uuidV7Pattern.test(dispatchId) ||
      !versionedLambdaArnPattern.test(durableFunctionArn) ||
      !versionedLambdaArnPattern.test(activityFunctionArn) ||
      !executionIdPattern.test(adapterConfigSha256)
    ) {
      throw new Error("The ingestion recovery dispatch is invalid");
    }
    return this.client.begin(async (transaction) => {
      const checkpoints = await transaction.unsafe<CheckpointRow[]>(
        `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints
         WHERE execution_id=$1 FOR UPDATE`,
        [executionId],
      );
      if (!checkpoints[0]) throw new Error("The ingestion checkpoint was not found");
      const checkpoint = mapCheckpoint(checkpoints[0]);
      if (
        checkpoint.state === "succeeded" ||
        checkpoint.state === "dead_lettered" ||
        checkpoint.state === "paused"
      ) {
        return undefined;
      }
      if (completedGeneration === 20) {
        const exhausted = await transaction.unsafe<{ id: string }[]>(
          `UPDATE jobs.ingestion_dispatches
           SET state='recovery_exhausted', last_error_code='RecoveryGenerationLimit',
             updated_at=clock_timestamp()
           WHERE execution_id=$1 AND generation=20 AND state='terminal'
           RETURNING id`,
          [executionId],
        );
        if (exhausted.length !== 1) {
          const replay = await transaction.unsafe<{ id: string }[]>(
            `SELECT id FROM jobs.ingestion_dispatches
             WHERE execution_id=$1 AND generation=20 AND state='recovery_exhausted'
               AND last_error_code='RecoveryGenerationLimit'`,
            [executionId],
          );
          if (replay.length !== 1) {
            throw new Error("The ingestion recovery exhaustion boundary is stale");
          }
        } else {
          const exhaustedDispatchId = exhausted[0]?.id;
          if (!exhaustedDispatchId) {
            throw new Error("The ingestion recovery exhaustion identity is missing");
          }
          const terminal = await transaction.unsafe<{ executionId: string }[]>(
            `UPDATE jobs.ingestion_checkpoints
             SET state='dead_lettered', revision=revision+1,
               lease_id=NULL, leased_at=NULL, lease_expires_at=NULL,
               prior_progress_unknown=NULL, settled_attempt=NULL,
               settled_lease_id=NULL, settled_at=NULL, settlement_key=NULL,
               progress_known=NULL, observation_count=NULL, created_count=NULL, updated_count=NULL,
               retry_reason=NULL, retry_at=NULL, pause_reason=NULL,
               failure_code='recovery_generation_exhausted', exhausted_dispatch_id=$2,
               updated_at=statement_timestamp()
             WHERE execution_id=$1 AND state IN ('pending', 'claimed', 'retry_wait')
             RETURNING execution_id AS "executionId"`,
            [executionId, exhaustedDispatchId],
          );
          if (terminal.length !== 1) {
            throw new Error("The ingestion recovery checkpoint exhaustion boundary is stale");
          }
        }
        return undefined;
      }
      const generation = completedGeneration + 1;
      await transaction.unsafe(
        `
        INSERT INTO jobs.ingestion_dispatches (
          id, execution_id, generation, checkpoint_revision, durable_execution_name,
          durable_function_arn, activity_function_arn, adapter_config_sha256, state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        ON CONFLICT (execution_id, generation) DO NOTHING
      `,
        [
          dispatchId,
          executionId,
          generation,
          checkpoint.revision,
          durableIngestionExecutionName(executionId, generation),
          durableFunctionArn,
          activityFunctionArn,
          adapterConfigSha256,
        ],
      );
      const dispatches = await transaction.unsafe<DispatchRow[]>(
        `SELECT ${dispatchSelection} FROM jobs.ingestion_dispatches
         WHERE execution_id=$1 AND generation=$2`,
        [executionId, generation],
      );
      if (!dispatches[0]) throw new Error("The ingestion recovery dispatch was not persisted");
      return mapDispatch(dispatches[0]);
    });
  }

  async ensurePausedResumeDispatches(
    sourceId: string,
    dispatchIds: readonly string[],
    durableFunctionArn: string,
    activityFunctionArn: string,
    adapterConfigSha256: string,
  ): Promise<readonly PersistedIngestionDispatch[]> {
    if (
      !syntheticSourceIdentifierPattern.test(sourceId) ||
      dispatchIds.length < 1 ||
      dispatchIds.length > 25 ||
      new Set(dispatchIds).size !== dispatchIds.length ||
      dispatchIds.some((id) => !uuidV7Pattern.test(id)) ||
      !versionedLambdaArnPattern.test(durableFunctionArn) ||
      !versionedLambdaArnPattern.test(activityFunctionArn) ||
      !executionIdPattern.test(adapterConfigSha256)
    ) {
      throw new Error("The paused ingestion resume request is invalid");
    }
    return this.client.begin(async (transaction) => {
      const checkpoints = await transaction.unsafe<CheckpointRow[]>(
        `SELECT ${checkpointSelection} FROM jobs.ingestion_checkpoints AS checkpoint
         WHERE checkpoint.source_id=$1 AND checkpoint.state='paused'
           AND NOT EXISTS (
             SELECT 1 FROM jobs.ingestion_dispatches AS dispatch
             WHERE dispatch.execution_id=checkpoint.execution_id
               AND dispatch.state IN ('pending', 'claimed', 'nudged', 'started')
           )
           AND (SELECT max(generation) FROM jobs.ingestion_dispatches AS dispatch
                WHERE dispatch.execution_id=checkpoint.execution_id) < 20
         ORDER BY checkpoint.scheduled_for, checkpoint.execution_id
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        [sourceId, dispatchIds.length],
      );
      const created: PersistedIngestionDispatch[] = [];
      for (const [index, row] of checkpoints.entries()) {
        const checkpoint = mapCheckpoint(row);
        const generations = await transaction.unsafe<{ generation: number }[]>(
          `SELECT max(generation)::integer AS generation FROM jobs.ingestion_dispatches
           WHERE execution_id=$1`,
          [checkpoint.executionId],
        );
        const currentGeneration = generations[0]?.generation;
        const dispatchId = dispatchIds[index];
        if (!currentGeneration || !dispatchId) {
          throw new Error("The paused ingestion generation is invalid");
        }
        const generation = currentGeneration + 1;
        const rows = await transaction.unsafe<DispatchRow[]>(
          `INSERT INTO jobs.ingestion_dispatches (
             id, execution_id, generation, checkpoint_revision, durable_execution_name,
             durable_function_arn, activity_function_arn, adapter_config_sha256, state
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
           RETURNING ${dispatchSelection}`,
          [
            dispatchId,
            checkpoint.executionId,
            generation,
            checkpoint.revision,
            durableIngestionExecutionName(checkpoint.executionId, generation),
            durableFunctionArn,
            activityFunctionArn,
            adapterConfigSha256,
          ],
        );
        if (!rows[0]) throw new Error("The paused ingestion dispatch was not persisted");
        created.push(mapDispatch(rows[0]));
      }
      return Object.freeze(created);
    });
  }

  async recoverTransportDispatches(sourceId: string): Promise<IngestionTransportRecoveryResult> {
    if (!syntheticSourceIdentifierPattern.test(sourceId)) {
      throw new Error("The ingestion transport recovery request is invalid");
    }
    return this.client.begin(async (transaction) => {
      const recovered = await transaction.unsafe<Array<{ state: IngestionDispatchState }>>(
        `WITH candidates AS (
           SELECT dispatch.id
           FROM jobs.ingestion_dispatches AS dispatch
           JOIN jobs.ingestion_checkpoints AS checkpoint
             ON checkpoint.execution_id=dispatch.execution_id
           WHERE checkpoint.source_id=$1
             AND checkpoint.state NOT IN ('paused', 'succeeded', 'dead_lettered')
             AND dispatch.generation=(
               SELECT max(latest.generation) FROM jobs.ingestion_dispatches AS latest
               WHERE latest.execution_id=dispatch.execution_id
             )
             AND (dispatch.state='publish_failed' OR (
               dispatch.state='nudged'
               AND dispatch.updated_at <= clock_timestamp()-interval '1 hour'
             ))
           ORDER BY dispatch.updated_at, dispatch.id
           FOR UPDATE OF dispatch SKIP LOCKED LIMIT 25
         )
         UPDATE jobs.ingestion_dispatches AS dispatch
         SET state=CASE WHEN dispatch.state='publish_failed' OR dispatch.publish_attempts >= 5
                        THEN 'recovery_exhausted' ELSE 'pending' END,
           next_attempt_at=CASE WHEN dispatch.state='nudged' AND dispatch.publish_attempts < 5
                                THEN clock_timestamp() ELSE dispatch.next_attempt_at END,
           last_error_code=CASE WHEN dispatch.state='nudged' AND dispatch.publish_attempts < 5
                                THEN 'NudgeStartUnconfirmed' ELSE 'TransportRecoveryExhausted' END,
           updated_at=clock_timestamp()
         FROM candidates WHERE dispatch.id=candidates.id
         RETURNING dispatch.state`,
        [sourceId],
      );
      const [persistent] = await transaction.unsafe<{ count: number }[]>(
        `SELECT count(*)::integer AS count
         FROM jobs.ingestion_dispatches AS dispatch
         JOIN jobs.ingestion_checkpoints AS checkpoint
           ON checkpoint.execution_id=dispatch.execution_id
         WHERE checkpoint.source_id=$1
           AND checkpoint.state NOT IN ('succeeded', 'dead_lettered')
           AND dispatch.state='recovery_exhausted'
           AND dispatch.last_error_code='TransportRecoveryExhausted'`,
        [sourceId],
      );
      return Object.freeze({
        retried: recovered.filter((row) => row.state === "pending").length,
        exhausted: persistent?.count ?? 0,
      });
    });
  }

  async listStartedDispatchesForReconciliation(
    sourceId: string,
    limit: number,
  ): Promise<readonly PersistedIngestionDispatch[]> {
    if (
      !syntheticSourceIdentifierPattern.test(sourceId) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 25
    ) {
      throw new Error("The ingestion reconciliation request is invalid");
    }
    const rows = await this.client.unsafe<DispatchRow[]>(
      `SELECT ${joinedDispatchSelection} FROM jobs.ingestion_dispatches AS dispatch
       JOIN jobs.ingestion_checkpoints AS checkpoint ON checkpoint.execution_id=dispatch.execution_id
       WHERE checkpoint.source_id=$1
         AND dispatch.state='started'
         AND dispatch.updated_at <= clock_timestamp()-interval '2 hours'
         AND dispatch.generation=(
           SELECT max(latest.generation) FROM jobs.ingestion_dispatches AS latest
           WHERE latest.execution_id=dispatch.execution_id
         )
       ORDER BY dispatch.updated_at, dispatch.id LIMIT $2`,
      [sourceId, limit],
    );
    return Object.freeze(rows.map(mapDispatch));
  }
}
