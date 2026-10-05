import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schemas/candidate-deletion-restore.v1.schema.json" with { type: "json" };

const validator = new Ajv2020({ strict: true, allErrors: false });
validator.addSchema(schema);
const configurationSchema = validator.compile({ $ref: `${schema.$id}#/$defs/configuration` });
const requestSchema = validator.compile({ $ref: `${schema.$id}#/$defs/request` });
export const validateRestoreInspectionResult = validator.compile({
  $ref: `${schema.$id}#/$defs/inspection`,
});
export const validateRestoreReplayResult = validator.compile({
  $ref: `${schema.$id}#/$defs/replayResult`,
});
const completionDiagnosisSchema = validator.compile({
  $ref: `${schema.$id}#/$defs/completionDiagnosis`,
});

/** Operator-only transport. Never accepts candidate locators, database URLs or SQL. */
export const RESTORE_CONFIGURATION_KEYS = [
  "schemaVersion",
  "runId",
  "accountId",
  "region",
  "sourceSha",
  "restoreContextSha256",
  "sourceIdentifier",
  "sourceDbiResourceId",
  "sourceBoundarySha256",
  "sourceHostname",
  "targetIdentifier",
  "targetDbiResourceId",
  "targetBoundarySha256",
  "targetHostname",
  "databaseName",
  "databasePort",
  "restoreManifestSha256",
  "acceptedPolicyCatalogSha256",
  "issuedAt",
  "expiresAt",
] as const;

export const RESTORE_ENVIRONMENT_KEYS = [
  "NODE_ENV",
  "RELEASE_SHA",
  "DATABASE_SECRET_ID",
  "CANDIDATE_DOCUMENT_BUCKET",
  "CANDIDATE_DELETION_RECOVERY_BUCKET",
  "CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN",
  "RESTORE_REPLAY_CONFIG_JSON",
  "RESTORE_REPLAY_CONFIG_SHA256",
] as const;

export const CURRENT_RESTORE_MANIFEST_SHA256 =
  "3009222c2bf092df2cdcf9171d643960b4382d10758a9f8cd9ea497ae66b2def";
export const RESTORE_MAXIMUM_LIFETIME_MS = 30 * 60_000;
export const RESTORE_INVOCATION_BUDGET_MS = 300_000;
export const RESTORE_RESULT_RESERVE_MS = 10_000;
const SHA = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[a-f0-9]{32}$/u;
const VERSION = /^[1-9][0-9]{0,9}$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const RESOURCE_ID = /^db-[A-Z0-9]{8,63}$/u;

export interface CandidateDeletionRestoreConfiguration {
  schemaVersion: 1;
  runId: string;
  accountId: string;
  region: "us-east-2";
  sourceSha: string;
  restoreContextSha256: string;
  sourceIdentifier: "ai-job-apply-development";
  sourceDbiResourceId: string;
  sourceBoundarySha256: string;
  sourceHostname: string;
  targetIdentifier: string;
  targetDbiResourceId: string;
  targetBoundarySha256: string;
  targetHostname: string;
  databaseName: "ai_job_apply";
  databasePort: 5432;
  restoreManifestSha256: string;
  acceptedPolicyCatalogSha256: string;
  issuedAt: string;
  expiresAt: string;
}

interface RestoreRequestBase {
  schemaVersion: 1;
  runId: string;
  configurationSha256: string;
  functionVersion: string;
}
export type CandidateDeletionRestoreRequest =
  | (RestoreRequestBase & { action: "inspect" })
  | (RestoreRequestBase & { action: "diagnose_completion" })
  | (RestoreRequestBase & { action: "replay"; reviewedInspectionSha256: string });

export interface CandidateDeletionRestoreInspection {
  schemaVersion: 1;
  action: "inspect";
  outcome: "inspected";
  runId: string;
  sourceSha: string;
  configurationSha256: string;
  functionVersion: string;
  expiresAt: string;
  markerSnapshotSha256: string;
  restoredPreflightSha256: string;
  inspectionSha256: string;
  markersValidated: number;
  historicalPolicyMarkers: number;
  currentPolicyMarkers: number;
  restoredSubjectsPresent: number;
  restoredSubjectsAbsent: number;
  documentKeysChecked: number;
  documentVersionsObserved: 0;
}

export type CandidateDeletionRestoreReplayResult = Omit<
  CandidateDeletionRestoreInspection,
  "action" | "outcome"
> & {
  action: "replay";
  outcome: "replayed";
  restoredUsersReconciled: number;
  restoredUsersAbsent: number;
  restoredUsersAlreadyReconciled: number;
  s3Writes: 0;
  recoveryLedgerWrites: 0;
  identityProviderCalls: 0;
};

/** Historical dispatch bindings only; fresh execution retirement and PITR checks remain local. */
export interface CandidateDeletionRestoreCompletionDispatchEvidence {
  status: "acknowledged_unclaimed";
  attemptCount: 1 | 2 | 3;
  bindingSha256: readonly string[];
  latestCreatedAt: string;
  latestAcknowledgedAt: string;
}

/** Private diagnostic transport only. This is never an inspection approval or write authority. */
export interface CandidateDeletionRestoreCompletionDiagnosis {
  schemaVersion: 1;
  action: "diagnose_completion";
  outcome: "refused" | "consistent" | "persisted_candidate";
  runId: string;
  sourceSha: string;
  configurationSha256: string;
  functionVersion: string;
  expiresAt: string;
  markerSnapshotSha256: string;
  markersValidated: 1;
  comparison: {
    requestMatchesTag: boolean;
    ledgerMatchesTag: boolean;
    persistedPairAgrees: boolean;
    completionCollisions: readonly (
      | "request_completion_mismatch"
      | "request_timestamp_state_conflict"
      | "ledger_completion_mismatch"
      | "ledger_timestamp_state_conflict"
      | "backup_expiry_conflict"
    )[];
  } | null;
  reason:
    | "input_invalid"
    | "proof_binding_mismatch"
    | "proof_expired"
    | "marker_invalid"
    | "row_cardinality"
    | "identity_binding_mismatch"
    | "historical_policy_mismatch"
    | "timestamp_invalid"
    | "timestamp_chronology"
    | "completion_state_conflict"
    | "persisted_completion_disagreement"
    | "nonterminal_state"
    | "owner_inventory_incomplete"
    | "operation_corroboration_missing"
    | "dispatch_corroboration_missing"
    | "durable_evidence_insufficient"
    | "retention_expired"
    | null;
  corroboration:
    | "persisted_transaction"
    | "persisted_transaction_and_dispatch"
    | "persisted_transaction_and_durable"
    | null;
  candidate: {
    correctedCompletedAt: string;
    evidenceSha256: string;
    candidateSha256: string;
  } | null;
  dispatchEvidence: CandidateDeletionRestoreCompletionDispatchEvidence | null;
  databaseWrites: 0;
  s3Writes: 0;
  recoveryLedgerWrites: 0;
  identityProviderCalls: 0;
}

export function validateRestoreCompletionDiagnosisResult(
  value: unknown,
): value is CandidateDeletionRestoreCompletionDiagnosis {
  if (!completionDiagnosisSchema(value) || !isRestoreRecord(value)) return false;
  if (!canonicalDate(value.expiresAt)) return false;
  if (isRestoreRecord(value.dispatchEvidence)) {
    const dispatch = value.dispatchEvidence;
    const bindings = dispatch.bindingSha256;
    if (
      !Array.isArray(bindings) ||
      bindings.length !== dispatch.attemptCount ||
      bindings.some(
        (binding, index) =>
          typeof binding !== "string" ||
          binding.length !== 64 ||
          !SHA.test(binding) ||
          (index > 0 && binding <= bindings[index - 1]),
      ) ||
      !canonicalSqlDate(dispatch.latestCreatedAt) ||
      !canonicalSqlDate(dispatch.latestAcknowledgedAt) ||
      dispatch.latestCreatedAt > dispatch.latestAcknowledgedAt ||
      dispatch.latestAcknowledgedAt > `${value.expiresAt.slice(0, -1)}000Z`
    )
      return false;
  }
  if (isRestoreRecord(value.candidate)) {
    return (
      canonicalDate(value.candidate.correctedCompletedAt) &&
      Date.parse(value.candidate.correctedCompletedAt) <= Date.parse(value.expiresAt)
    );
  }
  return true;
}

export function restoreDigest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`${domain}\n${JSON.stringify(value)}\n`, "utf8")
    .digest("hex");
}

export function isRestoreRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function canonicalDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** Keep every SQL microsecond; the millisecond projection only validates calendar components. */
function canonicalSqlDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 27 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value) &&
    !value.startsWith("0000-") &&
    canonicalDate(`${value.slice(0, 23)}Z`)
  );
}

export function serializeRestoreConfiguration(
  config: CandidateDeletionRestoreConfiguration,
): string {
  return JSON.stringify(
    Object.fromEntries(RESTORE_CONFIGURATION_KEYS.map((key) => [key, config[key]])),
  );
}

export function validateRestoreConfiguration(
  value: unknown,
  acceptedPolicyCatalogSha256: string,
  now: Date,
): CandidateDeletionRestoreConfiguration {
  const reject = () => {
    throw new Error("CandidateDeletionRestoreConfigurationRejected");
  };
  if (
    !configurationSchema(value) ||
    !isRestoreRecord(value) ||
    !exactKeys(value, RESTORE_CONFIGURATION_KEYS)
  )
    return reject();
  if (
    !(now instanceof Date) ||
    !Number.isFinite(Date.prototype.getTime.call(now)) ||
    !SHA.test(acceptedPolicyCatalogSha256)
  )
    return reject();
  if (
    Object.values(value).some(
      (field) =>
        typeof field === "string" && (!/^[\x20-\x7e]+$/u.test(field) || field.length > 512),
    )
  )
    return reject();
  const hashes = [
    "restoreContextSha256",
    "sourceBoundarySha256",
    "targetBoundarySha256",
    "restoreManifestSha256",
    "acceptedPolicyCatalogSha256",
  ];
  if (
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    !RUN_ID.test(value.runId) ||
    typeof value.accountId !== "string" ||
    !/^[0-9]{12}$/u.test(value.accountId) ||
    value.region !== "us-east-2" ||
    typeof value.sourceSha !== "string" ||
    !SOURCE_SHA.test(value.sourceSha) ||
    value.sourceIdentifier !== "ai-job-apply-development" ||
    value.databaseName !== "ai_job_apply" ||
    value.databasePort !== 5432 ||
    hashes.some((key) => typeof value[key] !== "string" || !SHA.test(value[key] as string)) ||
    value.restoreManifestSha256 !== CURRENT_RESTORE_MANIFEST_SHA256 ||
    value.acceptedPolicyCatalogSha256 !== acceptedPolicyCatalogSha256 ||
    typeof value.sourceDbiResourceId !== "string" ||
    !RESOURCE_ID.test(value.sourceDbiResourceId) ||
    typeof value.targetDbiResourceId !== "string" ||
    !RESOURCE_ID.test(value.targetDbiResourceId) ||
    value.targetDbiResourceId === value.sourceDbiResourceId ||
    value.targetBoundarySha256 === value.sourceBoundarySha256 ||
    typeof value.targetIdentifier !== "string" ||
    !/^ai-job-apply-development-restore-[0-9]{14}$/u.test(value.targetIdentifier) ||
    typeof value.sourceHostname !== "string" ||
    typeof value.targetHostname !== "string" ||
    !canonicalDate(value.issuedAt) ||
    !canonicalDate(value.expiresAt)
  )
    return reject();
  for (const kind of ["source", "target"] as const) {
    const hostname = value[`${kind}Hostname`] as string;
    const identifier = value[`${kind}Identifier`] as string;
    if (
      hostname.length > 253 ||
      !hostname.startsWith(`${identifier}.`) ||
      !/^[a-z0-9-]+\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/u.test(hostname)
    )
      return reject();
  }
  const issued = Date.parse(value.issuedAt);
  const expires = Date.parse(value.expiresAt);
  const nowMs = Date.prototype.getTime.call(now);
  if (
    issued > nowMs ||
    expires <= issued ||
    expires - issued > RESTORE_MAXIMUM_LIFETIME_MS ||
    expires - nowMs < RESTORE_INVOCATION_BUDGET_MS
  )
    return reject();
  return Object.freeze(value) as unknown as CandidateDeletionRestoreConfiguration;
}

export function calculateRestoreConfigurationSha256(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const pairs = RESTORE_ENVIRONMENT_KEYS.filter((key) => key !== "RESTORE_REPLAY_CONFIG_SHA256")
    .sort()
    .map((key) => {
      const value = environment[key];
      if (typeof value !== "string") throw new Error("CandidateDeletionRestoreEnvironmentRejected");
      return [key, value];
    });
  return restoreDigest("candidate-deletion-restore-configuration-v1", pairs);
}

export function loadRestoreEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  acceptedPolicyCatalogSha256: string,
  now = new Date(),
): { configuration: CandidateDeletionRestoreConfiguration; configurationSha256: string } {
  const reject = () => {
    throw new Error("CandidateDeletionRestoreEnvironmentRejected");
  };
  const allowed = new Set<string>(RESTORE_ENVIRONMENT_KEYS);
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (
      (/^(?:CANDIDATE_|DATABASE_|RESTORE_|AUTH0_|OIDC_|D2_|AWS_ENDPOINT_URL|PG)/u.test(key) &&
        !allowed.has(key)) ||
      /^(?:AWS_(?:EC2_METADATA_SERVICE_ENDPOINT|CONTAINER_CREDENTIALS_|SHARED_CREDENTIALS_FILE|CONFIG_FILE)|NODE_OPTIONS$)/u.test(
        key,
      ) ||
      key === "AWS_PROFILE" ||
      key === "AWS_DEFAULT_PROFILE" ||
      key === "NODE_TLS_REJECT_UNAUTHORIZED"
    )
      return reject();
  }
  if (
    RESTORE_ENVIRONMENT_KEYS.some((key) => typeof environment[key] !== "string") ||
    environment.NODE_ENV !== "production" ||
    !SHA.test(environment.RELEASE_SHA ?? "") ||
    !SHA.test(environment.RESTORE_REPLAY_CONFIG_SHA256 ?? "") ||
    !BUCKET.test(environment.CANDIDATE_DOCUMENT_BUCKET ?? "") ||
    !BUCKET.test(environment.CANDIDATE_DELETION_RECOVERY_BUCKET ?? "") ||
    environment.CANDIDATE_DOCUMENT_BUCKET === environment.CANDIDATE_DELETION_RECOVERY_BUCKET ||
    (environment.AWS_REGION !== undefined && environment.AWS_REGION !== "us-east-2") ||
    (environment.AWS_DEFAULT_REGION !== undefined && environment.AWS_DEFAULT_REGION !== "us-east-2")
  )
    return reject();
  const size = RESTORE_ENVIRONMENT_KEYS.reduce(
    (total, key) => total + Buffer.byteLength(key) + Buffer.byteLength(environment[key] ?? ""),
    0,
  );
  if (size > 4096 || (environment.RESTORE_REPLAY_CONFIG_JSON?.length ?? 0) > 3072) return reject();
  let parsed: unknown;
  try {
    parsed = JSON.parse(environment.RESTORE_REPLAY_CONFIG_JSON ?? "");
  } catch {
    return reject();
  }
  const configuration = validateRestoreConfiguration(parsed, acceptedPolicyCatalogSha256, now);
  if (environment.RESTORE_REPLAY_CONFIG_JSON !== serializeRestoreConfiguration(configuration))
    return reject();
  const secret = environment.DATABASE_SECRET_ID ?? "";
  const secretPrefix = `arn:aws:secretsmanager:us-east-2:${configuration.accountId}:secret:`;
  if (
    !secret.startsWith(secretPrefix) ||
    !/^[A-Za-z0-9/_+=.@-]{1,512}$/u.test(secret.slice(secretPrefix.length))
  )
    return reject();
  const key = environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN ?? "";
  const keyPrefix = `arn:aws:kms:us-east-2:${configuration.accountId}:key/`;
  if (
    !key.startsWith(keyPrefix) ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(key.slice(keyPrefix.length))
  )
    return reject();
  const configurationSha256 = calculateRestoreConfigurationSha256(environment);
  if (configurationSha256 !== environment.RESTORE_REPLAY_CONFIG_SHA256) return reject();
  return { configuration, configurationSha256 };
}

export function validateRestoreRequest(
  value: unknown,
  configuration: CandidateDeletionRestoreConfiguration,
  configurationSha256: string,
  invokedFunctionArn: string,
): CandidateDeletionRestoreRequest {
  const reject = () => {
    throw new Error("CandidateDeletionRestoreRequestRejected");
  };
  if (
    !requestSchema(value) ||
    !isRestoreRecord(value) ||
    !["inspect", "replay", "diagnose_completion"].includes(String(value.action))
  )
    return reject();
  const keys = ["schemaVersion", "action", "runId", "configurationSha256", "functionVersion"];
  if (value.action === "replay") keys.push("reviewedInspectionSha256");
  if (
    !exactKeys(value, keys) ||
    value.schemaVersion !== 1 ||
    value.runId !== configuration.runId ||
    value.configurationSha256 !== configurationSha256 ||
    typeof value.functionVersion !== "string" ||
    !VERSION.test(value.functionVersion) ||
    (value.action === "replay" &&
      (typeof value.reviewedInspectionSha256 !== "string" ||
        !SHA.test(value.reviewedInspectionSha256)))
  )
    return reject();
  const expectedArn = `arn:aws:lambda:us-east-2:${configuration.accountId}:function:ai-job-apply-development-replay-${configuration.runId}:${value.functionVersion}`;
  if (invokedFunctionArn !== expectedArn) return reject();
  return Object.freeze(value) as unknown as CandidateDeletionRestoreRequest;
}

export function restoreInspectionSha256(
  configurationSha256: string,
  markerSnapshotSha256: string,
  restoredPreflightSha256: string,
): string {
  if (
    [configurationSha256, markerSnapshotSha256, restoredPreflightSha256].some(
      (value) => !SHA.test(value),
    )
  ) {
    throw new Error("CandidateDeletionRestoreInspectionRejected");
  }
  return restoreDigest("candidate-deletion-restore-inspection-v1", [
    configurationSha256,
    markerSnapshotSha256,
    restoredPreflightSha256,
  ]);
}
