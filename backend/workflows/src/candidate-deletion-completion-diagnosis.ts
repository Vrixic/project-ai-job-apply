import { createHash } from "node:crypto";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
} from "./candidate-deletion-restore-policy.js";

type Timestamp = string | Date;
type Tag = Readonly<{ Key: string; Value: string }>;

export type CompletionCollisionPredicate =
  | "request_completion_mismatch"
  | "request_timestamp_state_conflict"
  | "ledger_completion_mismatch"
  | "ledger_timestamp_state_conflict"
  | "backup_expiry_conflict";

/** Selected actual profile.account_deletion_requests columns; never a public response. */
export interface HistoricalDeletionRequest {
  id: string;
  userId: string;
  operationId: string | null;
  policyVersion: string;
  state: string;
  version: number;
  requestedAt: Timestamp;
  updatedAt: Timestamp;
  confirmedAt: Timestamp | null;
  backupExpiresAt: Timestamp | null;
  completedAt: Timestamp | null;
  backupExpiredAt: Timestamp | null;
}

/** Selected actual privacy.account_deletion_ledger columns. */
export interface HistoricalDeletionLedger {
  requestId: string;
  subjectDigest: string;
  policyVersion: string;
  policySha256: string;
  state: string;
  ownerInventory: Readonly<Record<string, string>>;
  subprocessorInventory: Readonly<Record<string, string>>;
  confirmedAt: Timestamp;
  backupExpiresAt: Timestamp;
  completedAt: Timestamp | null;
  backupExpiredAt: Timestamp | null;
  updatedAt: Timestamp;
}

/** Actual platform.operations result has resourceId/resourceType, not a completion timestamp. */
export interface HistoricalDeletionOperation {
  id: string;
  userId: string;
  kind: string;
  state: string;
  result: Readonly<{ resourceId: string; resourceType: string }> | null;
  errorCode: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Actual platform.outbox_events projection. Durable start acknowledgment is NOT completion. */
export interface HistoricalDeletionDispatch {
  id: string;
  type: string;
  source: string;
  subject: string;
  dataSchema: string;
  data: Readonly<{ deletionRequestId: string; operationId: string; policyVersion: string }>;
  dispatchTarget: string;
  createdAt: Timestamp;
  publishedAt: Timestamp | null;
  durableStartedAt: Timestamp | null;
  nudgeClaimedAt: Timestamp | null;
  durableExecutionName: string | null;
  durableExecutionArn: string | null;
}

/**
 * Selected real GetDurableExecution / history fields (installed AWS SDK models_0.d.ts).
 * The private collector must obtain the exact invocation pair, not fabricate a timestamp
 * receipt. Current activity/workflow result payloads contain no completedAt field.
 */
export interface HistoricalCompletionDurableEvidence {
  execution: Readonly<{
    DurableExecutionArn: string;
    DurableExecutionName: string;
    FunctionArn: string;
    Version: string;
    Status: string;
    StartTimestamp: Timestamp;
    EndTimestamp: Timestamp;
    InputPayload: string;
    Result: string;
    ExecutionDataIncluded: boolean;
  }>;
  started: Readonly<{
    EventId: number;
    Id: string;
    Name: string;
    EventType: string;
    EventTimestamp: Timestamp;
    ChainedInvokeStartedDetails: Readonly<{
      FunctionName: string;
      Input: Readonly<{ Payload: string; Truncated?: boolean }>;
    }>;
  }>;
  succeeded: Readonly<{
    EventId: number;
    Id: string;
    Name: string;
    EventType: string;
    EventTimestamp: Timestamp;
    ChainedInvokeSucceededDetails: Readonly<{
      Result: Readonly<{ Payload: string; Truncated?: boolean }>;
    }>;
  }>;
}

/**
 * Private collector port: read-only, exact marker/version and bounded row projections.
 * Fingerprints come from independently verified marker reads; this pure module cannot
 * authenticate AWS/SQL provenance. The caller binds the reviewed evidence digest.
 */
export interface HistoricalCompletionEvidence {
  schemaVersion: 1;
  sourceSha: string;
  restoreContextSha256: string;
  configurationSha256: string;
  markerSnapshotSha256: string;
  observedAt: Timestamp;
  marker: Readonly<{
    bucketName: string;
    expectedBucketOwner: string;
    key: string;
    versionId: string;
    etag: string;
    contentLength: number;
    lastModified: Timestamp;
    bodySha256: string;
    checksumSha256: string;
    metadataSha256: string;
    encryptionSha256: string;
    retentionSha256: string;
    versionInventorySha256: string;
    oldTagSet: readonly Tag[];
    entry: Readonly<{
      requestId: string;
      operationId: string;
      userId: string;
      policyVersion: string;
      policySha256: string;
      subjectDigest: string;
      confirmedAt: Timestamp;
      backupExpiresAt: Timestamp;
      completedAt: Timestamp;
    }>;
  }>;
  userRows: readonly Readonly<{
    id: string;
    accountState: string;
    createdAt: Timestamp;
    quarantinedAt: Timestamp | null;
  }>[];
  requestRows: readonly HistoricalDeletionRequest[];
  ledgerRows: readonly HistoricalDeletionLedger[];
  operationRows: readonly HistoricalDeletionOperation[];
  dispatchRows: readonly HistoricalDeletionDispatch[];
  durable: HistoricalCompletionDurableEvidence | null;
}

export interface HistoricalCompletionRepairCandidate {
  readonly sourceSha: string;
  readonly evidenceSha256: string;
  readonly bucketName: string;
  readonly expectedBucketOwner: string;
  readonly key: string;
  readonly versionId: string;
  readonly oldTagSet: readonly Tag[];
  readonly correctedCompletedAt: string;
  readonly bodySha256: string;
  readonly checksumSha256: string;
  readonly metadataSha256: string;
  readonly encryptionSha256: string;
  readonly retentionSha256: string;
  readonly versionInventorySha256: string;
  readonly etag: string;
  readonly contentLength: number;
  readonly lastModified: string;
}

export type HistoricalCompletionRefusal =
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
  | "retention_expired";

interface Comparison {
  readonly requestMatchesTag: boolean;
  readonly ledgerMatchesTag: boolean;
  readonly persistedPairAgrees: boolean;
  readonly completionCollisions: readonly CompletionCollisionPredicate[];
}
/** Acknowledgment bindings only; terminal status and PITR retirement are checked locally. */
export interface HistoricalCompletionDispatchEvidence {
  readonly status: "acknowledged_unclaimed";
  readonly attemptCount: 1 | 2 | 3;
  readonly bindingSha256: readonly string[];
  readonly latestCreatedAt: string;
  readonly latestAcknowledgedAt: string;
}
export type HistoricalCompletionDiagnosis =
  | Readonly<{
      outcome: "refused";
      reason: HistoricalCompletionRefusal;
      comparison?: Comparison;
      dispatchEvidence: null;
    }>
  | Readonly<{
      outcome: "consistent";
      comparison: Comparison;
      dispatchEvidence: HistoricalCompletionDispatchEvidence | null;
    }>
  | Readonly<{
      outcome: "persisted_candidate";
      comparison: Comparison;
      dispatchEvidence: HistoricalCompletionDispatchEvidence | null;
      corroboration:
        | "persisted_transaction"
        | "persisted_transaction_and_dispatch"
        | "persisted_transaction_and_durable";
    }>;

const candidates = new WeakMap<object, HistoricalCompletionRepairCandidate>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const EVENT = "profile.account-deletion.confirmed.v1";
const EVENT_SCHEMA = "https://schemas.ai-job-apply.internal/events/" + EVENT + ".json";
const STATES = new Set([
  "requested",
  "quarantined",
  "active_systems_deleted",
  "subprocessors_pending",
  "completed",
  "backup_expired",
]);
const TERMINAL = new Set(["completed", "backup_expired"]);
const MAX_PROOF_BYTES = 32_768;
const MAX_PROOF_AGE_MS = 300_000;

class Refusal extends Error {
  constructor(readonly reason: HistoricalCompletionRefusal) {
    super("HistoricalCompletionDiagnosisRejected");
  }
}
function fail(reason: HistoricalCompletionRefusal): never {
  throw new Refusal(reason);
}

/** No toJSON, property getter, or arbitrary error text is evaluated by the evidence reader. */
function snapshot(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget = { nodes: 0, bytes: 0 },
): unknown {
  budget.nodes += 1;
  if (depth > 12 || budget.nodes > 2_048) fail("input_invalid");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("input_invalid");
    return value;
  }
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8");
    if (value.length > 8_192 || budget.bytes > MAX_PROOF_BYTES) fail("input_invalid");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) fail("input_invalid");
  if (value instanceof Date) {
    const time = Date.prototype.getTime.call(value);
    if (!Number.isFinite(time)) fail("timestamp_invalid");
    return new Date(time).toISOString();
  }
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail("input_invalid");
    if (Object.values(descriptors).some((item) => !Object.hasOwn(item, "value")))
      fail("input_invalid");
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 25) fail("input_invalid");
      if (Object.keys(descriptors).length !== length + 1) fail("input_invalid");
      return Array.from({ length }, (_, index) => {
        const item = descriptors[String(index)];
        if (!item) fail("input_invalid");
        return snapshot(item.value, depth + 1, seen, budget);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("input_invalid");
    const keys = Object.keys(descriptors).sort();
    if (
      keys.length > 30 ||
      keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
    )
      fail("input_invalid");
    return Object.fromEntries(
      keys.map((key) => [key, snapshot(descriptors[key]?.value, depth + 1, seen, budget)]),
    );
  } finally {
    seen.delete(value);
  }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("input_invalid");
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index]))
    fail("input_invalid");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1_024): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )
    fail("input_invalid");
  return value;
}
function one(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) fail("row_cardinality");
  return value[0];
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update("candidate-deletion-completion-diagnosis/v1\n")
    .update(JSON.stringify(value))
    .digest("hex");
}
function prepare(value: unknown): unknown {
  const result = snapshot(value);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_PROOF_BYTES) fail("input_invalid");
  return result;
}
/** A private packet hash, not proof that an untrusted caller observed the underlying stores. */
export function historicalCompletionEvidenceSha256(value: unknown): string | undefined {
  try {
    return digest(prepare(value));
  } catch {
    return undefined;
  }
}
interface Instant {
  ns: bigint;
  iso: string;
  millisecondsExact: boolean;
}
function instant(value: unknown): Instant {
  if (typeof value !== "string" || value.length > 40) fail("timestamp_invalid");
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00(?::00)?)$/u.exec(value);
  if (!match) fail("timestamp_invalid");
  const seconds = (match[1] ?? "") + "T" + (match[2] ?? "");
  const date = new Date(seconds + ".000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== seconds + ".000Z")
    fail("timestamp_invalid");
  const fraction = (match[3] ?? "").padEnd(9, "0");
  const ns = BigInt(date.getTime()) * 1_000_000n + BigInt(fraction);
  const epoch = Number(ns / 1_000_000n);
  return { ns, iso: new Date(epoch).toISOString(), millisecondsExact: ns % 1_000_000n === 0n };
}
function optionalInstant(value: unknown): Instant | null {
  return value === null ? null : instant(value);
}
function dispatchTimestamp(value: Instant): string {
  if (value.ns % 1_000n !== 0n) fail("dispatch_corroboration_missing");
  const fraction = ((value.ns % 1_000_000_000n) + 1_000_000_000n) % 1_000_000_000n;
  const seconds = new Date(Number((value.ns - fraction) / 1_000_000n)).toISOString().slice(0, 19);
  return seconds + "." + String(fraction / 1_000n).padStart(6, "0") + "Z";
}
/** Checksum only: the caller must separately authenticate the execution observation. */
export function historicalCompletionDispatchBindingSha256(
  executionName: unknown,
  executionArn: unknown,
): string | undefined {
  if (typeof executionName !== "string" || typeof executionArn !== "string") return undefined;
  const id = executionName.slice("outbox-".length);
  if (
    executionName !== "outbox-" + id ||
    !UUID.test(id) ||
    !new RegExp(
      "^arn:aws:lambda:us-east-2:[0-9]{12}:function:ai-job-apply-development-profile-readiness-durable:[1-9][0-9]{0,9}/durable-execution/" +
        executionName +
        "/[A-Za-z0-9_-]{1,128}$",
      "u",
    ).test(executionArn)
  )
    return undefined;
  return createHash("sha256")
    .update("candidate-deletion-completion-dispatch-binding/v1\n")
    .update(JSON.stringify([executionName, executionArn]))
    .digest("hex");
}
function same(left: Instant | null, right: Instant | null): boolean {
  return left !== null && right !== null && left.ns === right.ns;
}
function fixedComparison(
  request: Record<string, unknown>,
  ledger: Record<string, unknown>,
  tag: Instant,
  backup: Instant,
  now: Instant,
): Comparison {
  const requestTime = optionalInstant(request.completedAt);
  const ledgerTime = optionalInstant(ledger.completedAt);
  const requestExpiry = optionalInstant(request.backupExpiredAt);
  const ledgerExpiry = optionalInstant(ledger.backupExpiredAt);
  const failures: CompletionCollisionPredicate[] = [];
  if (TERMINAL.has(String(request.state)) && !same(requestTime, tag))
    failures.push("request_completion_mismatch");
  if (
    (!TERMINAL.has(String(request.state)) && requestTime !== null) ||
    (request.state !== "backup_expired" && requestExpiry !== null)
  )
    failures.push("request_timestamp_state_conflict");
  if (TERMINAL.has(String(ledger.state)) && !same(ledgerTime, tag))
    failures.push("ledger_completion_mismatch");
  if (
    (!TERMINAL.has(String(ledger.state)) && ledgerTime !== null) ||
    (ledger.state !== "backup_expired" && ledgerExpiry !== null)
  )
    failures.push("ledger_timestamp_state_conflict");
  if (
    ledger.state === "backup_expired" &&
    (!same(ledgerExpiry, requestExpiry) ||
      ledgerExpiry === null ||
      ledgerExpiry.ns < backup.ns ||
      ledgerExpiry.ns > now.ns)
  )
    failures.push("backup_expiry_conflict");
  return Object.freeze({
    requestMatchesTag: same(requestTime, tag),
    ledgerMatchesTag: same(ledgerTime, tag),
    persistedPairAgrees: same(requestTime, ledgerTime),
    completionCollisions: Object.freeze(failures),
  });
}
function exactPayload(
  value: unknown,
  keys: readonly string[],
  allowTraceparent = false,
): Record<string, unknown> {
  const raw = text(value, 4_096);
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    fail("durable_evidence_insufficient");
  }
  const payload = snapshot(decoded);
  const withTrace =
    allowTraceparent &&
    payload !== null &&
    typeof payload === "object" &&
    Object.hasOwn(payload, "traceparent");
  const result = object(payload, withTrace ? [...keys, "traceparent"] : keys);
  if (
    withTrace &&
    (typeof result.traceparent !== "string" ||
      !/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(result.traceparent) ||
      result.traceparent.includes("00000000000000000000000000000000") ||
      result.traceparent.includes("-0000000000000000-"))
  )
    fail("durable_evidence_insufficient");
  return result;
}
function finiteEvent(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail("durable_evidence_insufficient");
  return value as number;
}
function corroborateDurable(
  value: unknown,
  dispatch: Record<string, unknown>,
  marker: Record<string, unknown>,
  entry: Record<string, unknown>,
  completion: Instant,
  now: Instant,
): void {
  if (value === null) fail("durable_evidence_insufficient");
  const proof = object(value, ["execution", "started", "succeeded"]);
  const execution = object(proof.execution, [
    "DurableExecutionArn",
    "DurableExecutionName",
    "FunctionArn",
    "Version",
    "Status",
    "StartTimestamp",
    "EndTimestamp",
    "InputPayload",
    "Result",
    "ExecutionDataIncluded",
  ]);
  const durableBase =
    "arn:aws:lambda:us-east-2:" +
    marker.expectedBucketOwner +
    ":function:ai-job-apply-development-profile-readiness-durable";
  const activityBase =
    "arn:aws:lambda:us-east-2:" +
    marker.expectedBucketOwner +
    ":function:ai-job-apply-development-profile-readiness-activity";
  const version = text(execution.Version, 10);
  const executionArn = text(execution.DurableExecutionArn);
  const executionPrefix =
    durableBase + ":" + version + "/durable-execution/" + dispatch.durableExecutionName + "/";
  if (
    !/^[1-9]\d{0,9}$/u.test(version) ||
    execution.FunctionArn !== durableBase ||
    execution.Status !== "SUCCEEDED" ||
    execution.ExecutionDataIncluded !== true ||
    execution.DurableExecutionName !== dispatch.durableExecutionName ||
    executionArn !== dispatch.durableExecutionArn ||
    !executionArn.startsWith(executionPrefix) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(executionArn.slice(executionPrefix.length))
  )
    fail("durable_evidence_insufficient");
  const input = exactPayload(
    execution.InputPayload,
    ["schemaVersion", "eventId", "eventType", "data"],
    true,
  );
  const data = object(input.data, ["deletionRequestId", "operationId", "policyVersion"]);
  if (
    input.schemaVersion !== 1 ||
    input.eventId !== dispatch.id ||
    input.eventType !== EVENT ||
    data.deletionRequestId !== entry.requestId ||
    data.operationId !== entry.operationId ||
    data.policyVersion !== entry.policyVersion
  )
    fail("durable_evidence_insufficient");
  const result = exactPayload(execution.Result, [
    "schemaVersion",
    "workflowDefinitionVersion",
    "eventId",
    "resourceId",
    "operationId",
    "kind",
    "state",
  ]);
  if (
    result.schemaVersion !== 1 ||
    result.workflowDefinitionVersion !== 1 ||
    result.eventId !== dispatch.id ||
    result.resourceId !== entry.requestId ||
    result.operationId !== entry.operationId ||
    result.kind !== "account_deletion" ||
    result.state !== "succeeded"
  )
    fail("durable_evidence_insufficient");
  const started = object(proof.started, [
    "EventId",
    "Id",
    "Name",
    "EventType",
    "EventTimestamp",
    "ChainedInvokeStartedDetails",
  ]);
  const succeeded = object(proof.succeeded, [
    "EventId",
    "Id",
    "Name",
    "EventType",
    "EventTimestamp",
    "ChainedInvokeSucceededDetails",
  ]);
  if (
    started.EventType !== "ChainedInvokeStarted" ||
    succeeded.EventType !== "ChainedInvokeSucceeded" ||
    text(started.Id, 128) !== succeeded.Id ||
    started.Name !== succeeded.Name ||
    !/^candidate-rights\.deletion\.complete\.v1\.attempt-[1-5]$/u.test(text(started.Name, 100)) ||
    finiteEvent(started.EventId) >= finiteEvent(succeeded.EventId)
  )
    fail("durable_evidence_insufficient");
  const details = object(started.ChainedInvokeStartedDetails, ["FunctionName", "Input"]);
  if (
    !text(details.FunctionName).startsWith(activityBase + ":") ||
    !/^[1-9][0-9]{0,9}$/u.test(text(details.FunctionName).slice(activityBase.length + 1))
  )
    fail("durable_evidence_insufficient");
  const callInput = details.Input as Record<string, unknown>;
  const response = object(succeeded.ChainedInvokeSucceededDetails, ["Result"]).Result as Record<
    string,
    unknown
  >;
  for (const payload of [callInput, response]) {
    object(
      payload,
      Object.hasOwn(payload ?? {}, "Truncated") ? ["Payload", "Truncated"] : ["Payload"],
    );
    if (payload.Truncated !== undefined && payload.Truncated !== false)
      fail("durable_evidence_insufficient");
  }
  const call = exactPayload(
    callInput.Payload,
    [
      "schemaVersion",
      "workflowDefinitionVersion",
      "action",
      "eventId",
      "resourceId",
      "operationId",
      "policyVersion",
    ],
    true,
  );
  if (
    call.schemaVersion !== 1 ||
    call.workflowDefinitionVersion !== 1 ||
    call.action !== "deletion_complete" ||
    call.eventId !== dispatch.id ||
    call.resourceId !== entry.requestId ||
    call.operationId !== entry.operationId ||
    call.policyVersion !== entry.policyVersion ||
    call.traceparent !== input.traceparent
  )
    fail("durable_evidence_insufficient");
  const outcome = exactPayload(response.Payload, ["schemaVersion", "action", "outcome"]);
  if (
    outcome.schemaVersion !== 1 ||
    outcome.action !== "deletion_complete" ||
    outcome.outcome !== "completed"
  )
    fail("durable_evidence_insufficient");
  const begin = instant(execution.StartTimestamp);
  const end = instant(execution.EndTimestamp);
  const callBegin = instant(started.EventTimestamp);
  const callEnd = instant(succeeded.EventTimestamp);
  if (
    begin.ns < instant(dispatch.createdAt).ns ||
    begin.ns > callBegin.ns ||
    callBegin.ns > completion.ns ||
    completion.ns > callEnd.ns ||
    callEnd.ns > end.ns ||
    end.ns > now.ns
  )
    fail("durable_evidence_insufficient");
}

/**
 * Pure diagnosis, never a read or a write. Private collectors must independently establish
 * source/context, complete query scope, marker authority and retained native evidence.
 */
export function diagnoseHistoricalCompletion(
  value: unknown,
  reviewedEvidenceSha256: string,
  now: Date,
): HistoricalCompletionDiagnosis {
  let comparison: Comparison | undefined;
  try {
    const observed = prepare(value);
    if (!SHA.test(reviewedEvidenceSha256) || digest(observed) !== reviewedEvidenceSha256)
      fail("proof_binding_mismatch");
    const input = object(observed, [
      "schemaVersion",
      "sourceSha",
      "restoreContextSha256",
      "configurationSha256",
      "markerSnapshotSha256",
      "observedAt",
      "marker",
      "userRows",
      "requestRows",
      "ledgerRows",
      "operationRows",
      "dispatchRows",
      "durable",
    ]);
    if (input.schemaVersion !== 1 || !/^[0-9a-f]{40}$/u.test(text(input.sourceSha, 40)))
      fail("input_invalid");
    for (const key of ["restoreContextSha256", "configurationSha256", "markerSnapshotSha256"])
      if (!SHA.test(text(input[key], 64))) fail("proof_binding_mismatch");
    const current = instant(snapshot(now));
    const observedAt = instant(input.observedAt);
    if (
      observedAt.ns > current.ns ||
      current.ns - observedAt.ns > BigInt(MAX_PROOF_AGE_MS) * 1_000_000n
    )
      fail("proof_expired");
    const marker = object(input.marker, [
      "bucketName",
      "expectedBucketOwner",
      "key",
      "versionId",
      "etag",
      "contentLength",
      "lastModified",
      "bodySha256",
      "checksumSha256",
      "metadataSha256",
      "encryptionSha256",
      "retentionSha256",
      "versionInventorySha256",
      "oldTagSet",
      "entry",
    ]);
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(text(marker.bucketName, 63)) ||
      String(marker.bucketName).includes("..") ||
      /^\d+\.\d+\.\d+\.\d+$/u.test(String(marker.bucketName)) ||
      !/^\d{12}$/u.test(text(marker.expectedBucketOwner, 12)) ||
      text(marker.versionId) === "null" ||
      !/^"[^"\r\n]{1,254}"$/u.test(text(marker.etag, 256)) ||
      !Number.isSafeInteger(marker.contentLength) ||
      (marker.contentLength as number) < 1 ||
      (marker.contentLength as number) > 16_384 ||
      instant(marker.lastModified).ns > observedAt.ns
    )
      fail("marker_invalid");
    for (const key of [
      "bodySha256",
      "checksumSha256",
      "metadataSha256",
      "encryptionSha256",
      "retentionSha256",
      "versionInventorySha256",
    ])
      if (!SHA.test(text(marker[key], 64))) fail("marker_invalid");
    if (marker.checksumSha256 !== marker.bodySha256) fail("marker_invalid");
    const entry = object(marker.entry, [
      "requestId",
      "operationId",
      "userId",
      "policyVersion",
      "policySha256",
      "subjectDigest",
      "confirmedAt",
      "backupExpiresAt",
      "completedAt",
    ]);
    for (const key of ["requestId", "operationId", "userId"])
      if (!UUID.test(text(entry[key], 36))) fail("identity_binding_mismatch");
    if (
      !SHA.test(text(entry.subjectDigest, 64)) ||
      marker.key !== "candidate-deletion-recovery/" + entry.requestId + ".json"
    )
      fail("identity_binding_mismatch");
    const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES.find(
      (item) => item.version === entry.policyVersion && item.sha256 === entry.policySha256,
    );
    if (!policy) fail("historical_policy_mismatch");
    const confirmed = instant(entry.confirmedAt);
    const backup = instant(entry.backupExpiresAt);
    const tagged = instant(entry.completedAt);
    if (
      !tagged.millisecondsExact ||
      tagged.iso !== entry.completedAt ||
      confirmed.ns > tagged.ns ||
      tagged.ns > observedAt.ns ||
      backup.ns - confirmed.ns !== BigInt(policy.backupRetentionDays * 86_400_000) * 1_000_000n
    )
      fail("timestamp_chronology");
    if (!Array.isArray(marker.oldTagSet) || marker.oldTagSet.length !== 2) fail("marker_invalid");
    const tags = new Map<string, string>();
    for (const item of marker.oldTagSet) {
      const tag = object(item, ["Key", "Value"]);
      if (tags.has(text(tag.Key, 20))) fail("marker_invalid");
      tags.set(text(tag.Key, 20), text(tag.Value, 40));
    }
    if (tags.get("state") !== "completed" || tags.get("completed-at") !== entry.completedAt)
      fail("marker_invalid");
    const request = object(one(input.requestRows), [
      "id",
      "userId",
      "operationId",
      "policyVersion",
      "state",
      "version",
      "requestedAt",
      "updatedAt",
      "confirmedAt",
      "backupExpiresAt",
      "completedAt",
      "backupExpiredAt",
    ]);
    const ledger = object(one(input.ledgerRows), [
      "requestId",
      "subjectDigest",
      "policyVersion",
      "policySha256",
      "state",
      "ownerInventory",
      "subprocessorInventory",
      "confirmedAt",
      "backupExpiresAt",
      "completedAt",
      "backupExpiredAt",
      "updatedAt",
    ]);
    if (
      request.id !== entry.requestId ||
      request.userId !== entry.userId ||
      request.operationId !== entry.operationId ||
      request.policyVersion !== entry.policyVersion ||
      ledger.requestId !== entry.requestId ||
      ledger.subjectDigest !== entry.subjectDigest ||
      ledger.policyVersion !== entry.policyVersion ||
      ledger.policySha256 !== entry.policySha256 ||
      !STATES.has(String(request.state)) ||
      !STATES.has(String(ledger.state)) ||
      ledger.state === "requested" ||
      !Number.isSafeInteger(request.version) ||
      (request.version as number) < 1
    )
      fail("identity_binding_mismatch");
    if (
      instant(request.confirmedAt).ns !== confirmed.ns ||
      instant(ledger.confirmedAt).ns !== confirmed.ns ||
      instant(request.backupExpiresAt).ns !== backup.ns ||
      instant(ledger.backupExpiresAt).ns !== backup.ns
    )
      fail("identity_binding_mismatch");
    comparison = fixedComparison(request, ledger, tagged, backup, observedAt);
    if (
      request.state !== ledger.state ||
      comparison.completionCollisions.some(
        (item) => item !== "request_completion_mismatch" && item !== "ledger_completion_mismatch",
      )
    )
      fail("completion_state_conflict");
    if (!TERMINAL.has(String(request.state))) fail("nonterminal_state");
    if (!comparison.persistedPairAgrees) fail("persisted_completion_disagreement");
    const completion = instant(request.completedAt);
    if (
      !completion.millisecondsExact ||
      instant(request.requestedAt).ns > confirmed.ns ||
      completion.ns < confirmed.ns ||
      completion.ns > observedAt.ns ||
      instant(request.updatedAt).ns < completion.ns ||
      instant(ledger.updatedAt).ns < completion.ns ||
      instant(request.updatedAt).ns > observedAt.ns ||
      instant(ledger.updatedAt).ns > observedAt.ns
    )
      fail("timestamp_chronology");
    const user = object(one(input.userRows), ["id", "accountState", "createdAt", "quarantinedAt"]);
    if (
      user.id !== entry.userId ||
      user.accountState !== "quarantined" ||
      instant(user.createdAt).ns > confirmed.ns ||
      instant(user.quarantinedAt).ns > completion.ns
    )
      fail("identity_binding_mismatch");
    const ownerInventory = ledger.ownerInventory as Record<string, unknown>;
    const expectedOwners = [policy.ownerInventory, RESTORED_CANDIDATE_RIGHTS_OWNERS];
    const actualOwners =
      ownerInventory && typeof ownerInventory === "object"
        ? Object.keys(ownerInventory).sort()
        : [];
    if (
      !expectedOwners.some((owners) => actualOwners.join(",") === [...owners].sort().join(",")) ||
      Object.values(ownerInventory ?? {}).some((state) => state !== "completed") ||
      JSON.stringify(object(ledger.subprocessorInventory, [])) !== "{}"
    )
      fail("owner_inventory_incomplete");
    const operation = object(one(input.operationRows), [
      "id",
      "userId",
      "kind",
      "state",
      "result",
      "errorCode",
      "createdAt",
      "updatedAt",
    ]);
    const operationResult = object(operation.result, ["resourceId", "resourceType"]);
    if (
      operation.id !== entry.operationId ||
      operation.userId !== entry.userId ||
      operation.kind !== "account_deletion" ||
      operation.state !== "succeeded" ||
      operation.errorCode !== null ||
      operationResult.resourceId !== entry.requestId ||
      operationResult.resourceType !== "account_deletion_request" ||
      instant(operation.createdAt).ns < confirmed.ns ||
      instant(operation.createdAt).ns > completion.ns ||
      instant(operation.updatedAt).ns !== completion.ns
    )
      fail("operation_corroboration_missing");
    let dispatches: Record<string, unknown>[];
    let dispatchEvidence: HistoricalCompletionDispatchEvidence | null = null;
    try {
      if (!Array.isArray(input.dispatchRows) || input.dispatchRows.length > 3)
        fail("dispatch_corroboration_missing");
      dispatches = input.dispatchRows.map((raw) =>
        object(raw, [
          "id",
          "type",
          "source",
          "subject",
          "dataSchema",
          "data",
          "dispatchTarget",
          "createdAt",
          "publishedAt",
          "durableStartedAt",
          "nudgeClaimedAt",
          "durableExecutionName",
          "durableExecutionArn",
        ]),
      );
      const ids = new Set<string>();
      const bindings = new Set<string>();
      let latestCreated: Instant | undefined;
      let latestAcknowledged: Instant | undefined;
      for (const dispatch of dispatches) {
        const id = text(dispatch.id, 36);
        const data = object(dispatch.data, ["deletionRequestId", "operationId", "policyVersion"]);
        const dispatchPrefix =
          "arn:aws:lambda:us-east-2:" +
          marker.expectedBucketOwner +
          ":function:ai-job-apply-development-profile-readiness-durable:";
        const dispatchArn = text(dispatch.durableExecutionArn);
        const binding = historicalCompletionDispatchBindingSha256(
          dispatch.durableExecutionName,
          dispatchArn,
        );
        const created = instant(dispatch.createdAt);
        const published = instant(dispatch.publishedAt);
        const started = instant(dispatch.durableStartedAt);
        if (
          !UUID.test(id) ||
          ids.has(id) ||
          !binding ||
          bindings.has(binding) ||
          dispatch.type !== EVENT ||
          dispatch.source !== "urn:ai-job-apply:profile-service" ||
          dispatch.subject !== "account-deletion-request/" + entry.requestId ||
          dispatch.dataSchema !== EVENT_SCHEMA ||
          data.deletionRequestId !== entry.requestId ||
          data.operationId !== entry.operationId ||
          data.policyVersion !== entry.policyVersion ||
          dispatch.dispatchTarget !== "lambda_durable" ||
          dispatch.nudgeClaimedAt !== null ||
          dispatch.durableExecutionName !== "outbox-" + id ||
          created.ns < confirmed.ns ||
          created.ns > observedAt.ns ||
          published.ns < created.ns ||
          started.ns < created.ns ||
          published.ns > observedAt.ns ||
          started.ns > observedAt.ns ||
          !dispatchArn.startsWith(dispatchPrefix)
        )
          fail("dispatch_corroboration_missing");
        ids.add(id);
        bindings.add(binding);
        if (!latestCreated || created.ns > latestCreated.ns) latestCreated = created;
        for (const acknowledged of [published, started])
          if (!latestAcknowledged || acknowledged.ns > latestAcknowledged.ns)
            latestAcknowledged = acknowledged;
      }
      if (dispatches.length) {
        if (!latestCreated || !latestAcknowledged) fail("dispatch_corroboration_missing");
        dispatchEvidence = Object.freeze({
          status: "acknowledged_unclaimed",
          attemptCount: dispatches.length as 1 | 2 | 3,
          bindingSha256: Object.freeze([...bindings].sort()),
          latestCreatedAt: dispatchTimestamp(latestCreated),
          latestAcknowledgedAt: dispatchTimestamp(latestAcknowledged),
        });
      }
    } catch {
      // Nonzero inconvenient/malformed attempts are not discarded into "no evidence".
      fail("dispatch_corroboration_missing");
    }
    if (input.durable !== null) {
      const durable = object(input.durable, ["execution", "started", "succeeded"]);
      const execution = durable.execution as Record<string, unknown>;
      const dispatch = dispatches.find(
        (item) => item.durableExecutionArn === execution.DurableExecutionArn,
      );
      if (!dispatch) fail("durable_evidence_insufficient");
      corroborateDurable(durable, dispatch, marker, entry, completion, observedAt);
    }
    if (comparison.requestMatchesTag && comparison.ledgerMatchesTag)
      return Object.freeze({ outcome: "consistent", comparison, dispatchEvidence });
    if (backup.ns <= current.ns) fail("retention_expired");
    const corroboration =
      input.durable !== null
        ? ("persisted_transaction_and_durable" as const)
        : dispatches.length
          ? ("persisted_transaction_and_dispatch" as const)
          : ("persisted_transaction" as const);
    const result = Object.freeze({
      outcome: "persisted_candidate" as const,
      comparison,
      corroboration,
      dispatchEvidence,
    });
    candidates.set(
      result,
      Object.freeze({
        sourceSha: input.sourceSha as string,
        evidenceSha256: reviewedEvidenceSha256,
        bucketName: marker.bucketName as string,
        expectedBucketOwner: marker.expectedBucketOwner as string,
        key: marker.key as string,
        versionId: marker.versionId as string,
        oldTagSet: Object.freeze(
          (marker.oldTagSet as Tag[]).map((tag) => Object.freeze({ ...tag })),
        ),
        correctedCompletedAt: completion.iso,
        bodySha256: marker.bodySha256 as string,
        checksumSha256: marker.checksumSha256 as string,
        metadataSha256: marker.metadataSha256 as string,
        encryptionSha256: marker.encryptionSha256 as string,
        retentionSha256: marker.retentionSha256 as string,
        versionInventorySha256: marker.versionInventorySha256 as string,
        etag: marker.etag as string,
        contentLength: marker.contentLength as number,
        lastModified: instant(marker.lastModified).iso,
      }),
    );
    return result;
  } catch (error) {
    return Object.freeze({
      outcome: "refused",
      reason: error instanceof Refusal ? error.reason : "input_invalid",
      dispatchEvidence: null,
      ...(comparison ? { comparison } : {}),
    });
  }
}

/** Identity-only lookup; forged, cloned, hostile and arbitrary objects cannot mint authority. */
export function readHistoricalCompletionRepairCandidate(
  value: unknown,
): HistoricalCompletionRepairCandidate | undefined {
  return typeof value === "object" && value !== null ? candidates.get(value) : undefined;
}

/** Checksum only: a matching digest never authenticates a caller or mints repair authority. */
export function historicalCompletionRepairCandidateSha256(value: unknown): string | undefined {
  try {
    const candidate = object(prepare(value), [
      "sourceSha",
      "evidenceSha256",
      "bucketName",
      "expectedBucketOwner",
      "key",
      "versionId",
      "oldTagSet",
      "correctedCompletedAt",
      "bodySha256",
      "checksumSha256",
      "metadataSha256",
      "encryptionSha256",
      "retentionSha256",
      "versionInventorySha256",
      "etag",
      "contentLength",
      "lastModified",
    ]);
    for (const [key, item] of Object.entries(candidate)) {
      if (key !== "oldTagSet" && key !== "contentLength") text(item);
    }
    if (
      !Number.isSafeInteger(candidate.contentLength) ||
      (candidate.contentLength as number) < 1 ||
      !Array.isArray(candidate.oldTagSet) ||
      candidate.oldTagSet.length !== 2
    )
      return undefined;
    const tags = candidate.oldTagSet.map((item) => object(item, ["Key", "Value"]));
    for (const tag of tags) {
      text(tag.Key, 20);
      text(tag.Value, 40);
    }
    tags.sort((left, right) => String(left.Key).localeCompare(String(right.Key), "en"));
    if (
      tags[0]?.Key !== "completed-at" ||
      tags[1]?.Key !== "state" ||
      tags[1].Value !== "completed"
    )
      return undefined;
    candidate.oldTagSet = tags;
    return createHash("sha256")
      .update("candidate-deletion-completion-repair-candidate/v1\n")
      .update(JSON.stringify(prepare(candidate)))
      .digest("hex");
  } catch {
    return undefined;
  }
}
