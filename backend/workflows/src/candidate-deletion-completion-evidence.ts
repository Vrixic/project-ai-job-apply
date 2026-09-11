import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import {
  type HistoricalCompletionEvidence,
  historicalCompletionEvidenceSha256,
} from "./candidate-deletion-completion-diagnosis.js";
import { validateHistoricalRecoveryEntries } from "./candidate-deletion-restore-policy.js";

export type HistoricalCompletionEvidenceTarget = Pick<
  HistoricalCompletionEvidence,
  "sourceSha" | "restoreContextSha256" | "configurationSha256" | "markerSnapshotSha256" | "marker"
>;
type Row = Record<string, unknown>;
type ReadSql = Pick<DatabaseHandle["client"], "unsafe">;
const UTC = " AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
const stamp = (column: string, alias: string) => "to_char(" + column + UTC + ' AS "' + alias + '"';

// These are fixed source strings. No caller controls a relation, column, predicate,
// ordering, limit or transaction mode; only validated identifiers are parameters.
const USER_QUERY =
  'SELECT id, account_state AS "accountState", ' +
  stamp("created_at", "createdAt") +
  ", " +
  stamp("quarantined_at", "quarantinedAt") +
  " FROM identity.users WHERE id = $1::uuid LIMIT 2";
const REQUEST_QUERY =
  'SELECT id, user_id AS "userId", operation_id AS "operationId", policy_version AS "policyVersion", state, version, ' +
  [
    ["requested_at", "requestedAt"],
    ["updated_at", "updatedAt"],
    ["confirmed_at", "confirmedAt"],
    ["backup_expires_at", "backupExpiresAt"],
    ["completed_at", "completedAt"],
    ["backup_expired_at", "backupExpiredAt"],
  ]
    .map(([column, alias]) => stamp(column ?? "", alias ?? ""))
    .join(", ") +
  " FROM profile.account_deletion_requests WHERE id = $1::uuid OR operation_id = $2::uuid OR (user_id = $3::uuid AND state IN ('requested', 'quarantined', 'active_systems_deleted', 'subprocessors_pending')) ORDER BY id LIMIT 2";
const OPERATION_QUERY =
  'SELECT id, user_id AS "userId", kind, state, result, error_code AS "errorCode", ' +
  stamp("created_at", "createdAt") +
  ", " +
  stamp("updated_at", "updatedAt") +
  " FROM platform.operations WHERE id = $1::uuid LIMIT 2";
const LEDGER_QUERY =
  'SELECT request_id AS "requestId", subject_digest AS "subjectDigest", policy_version AS "policyVersion", policy_sha256 AS "policySha256", state, owner_inventory AS "ownerInventory", subprocessor_inventory AS "subprocessorInventory", ' +
  [
    ["confirmed_at", "confirmedAt"],
    ["backup_expires_at", "backupExpiresAt"],
    ["completed_at", "completedAt"],
    ["backup_expired_at", "backupExpiredAt"],
    ["updated_at", "updatedAt"],
  ]
    .map(([column, alias]) => stamp(column ?? "", alias ?? ""))
    .join(", ") +
  " FROM privacy.account_deletion_ledger WHERE request_id = $1::uuid OR subject_digest = $2 ORDER BY request_id LIMIT 2";
const DISPATCH_QUERY =
  'SELECT id, type, source, subject, data_schema AS "dataSchema", data, dispatch_target AS "dispatchTarget", durable_execution_name AS "durableExecutionName", durable_execution_arn AS "durableExecutionArn", ' +
  [
    ["created_at", "createdAt"],
    ["published_at", "publishedAt"],
    ["durable_started_at", "durableStartedAt"],
    ["nudge_claimed_at", "nudgeClaimedAt"],
  ]
    .map(([column, alias]) => stamp(column ?? "", alias ?? ""))
    .join(", ") +
  " FROM platform.outbox_events WHERE data ->> 'operationId' = $1 ORDER BY created_at, id LIMIT 4";

function rejected(): never {
  // Never inspect or forward a PostgreSQL/provider error or row value.
  throw new Error("CandidateDeletionCompletionEvidenceRejected");
}
function active(signal: AbortSignal): void {
  if (signal.aborted) rejected();
}
function markerDate(value: string | Date): Date {
  const result =
    value instanceof Date ? new Date(Date.prototype.getTime.call(value)) : new Date(value);
  if (
    !Number.isFinite(result.getTime()) ||
    (typeof value === "string" && result.toISOString() !== value)
  )
    rejected();
  return result;
}
async function rows(
  sql: ReadSql,
  query: string,
  values: string[],
  signal: AbortSignal,
  maximumRows: 2 | 4 = 2,
): Promise<Row[]> {
  active(signal);
  const pending = sql.unsafe<Row[]>(query, values);
  const abort = () => {
    try {
      pending.cancel();
    } catch {
      /* Cancellation failure is never diagnostic content. */
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) {
      abort();
    }
    // Observe the cancelled query's settlement too; abort must not orphan a rejection.
    const result = await pending;
    active(signal);
    if (!Array.isArray(result) || result.length > maximumRows) rejected();
    // Strip only driver-array metadata. SQL JSON columns and timestamp strings remain exact.
    return Array.from(result);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Private source adapter only. Construct after the executor authenticates its isolated
 * restored DatabaseHandle and obtains the exact singleton, module-minted marker snapshot.
 * No connection creation, network client construction, DML, row locks or log output.
 */
export async function collectHistoricalCompletionEvidence(
  database: DatabaseHandle,
  target: HistoricalCompletionEvidenceTarget,
  signal: AbortSignal,
  clock: () => Date = () => new Date(),
): Promise<HistoricalCompletionEvidence> {
  try {
    active(signal);
    const start = clock();
    if (!(start instanceof Date) || !Number.isFinite(start.getTime())) rejected();
    // The bounded pure serializer rejects accessors/unknown prototypes before any SQL.
    const draft = {
      schemaVersion: 1 as const,
      ...target,
      observedAt: start,
      userRows: [],
      requestRows: [],
      ledgerRows: [],
      operationRows: [],
      dispatchRows: [],
      durable: null,
    };
    if (!historicalCompletionEvidenceSha256(draft)) rejected();
    if (
      !/^[0-9a-f]{40}$/u.test(target.sourceSha) ||
      [target.restoreContextSha256, target.configurationSha256, target.markerSnapshotSha256].some(
        (sha) => !/^[0-9a-f]{64}$/u.test(sha),
      )
    )
      rejected();
    const entry = target.marker.entry;
    const [validated] = validateHistoricalRecoveryEntries(
      [
        {
          ...entry,
          confirmedAt: markerDate(entry.confirmedAt),
          backupExpiresAt: markerDate(entry.backupExpiresAt),
          completedAt: markerDate(entry.completedAt),
        },
      ],
      start,
    );
    if (
      !validated?.completedAt ||
      target.marker.key !== "candidate-deletion-recovery/" + validated.requestId + ".json" ||
      typeof target.marker.versionId !== "string" ||
      !target.marker.versionId ||
      target.marker.versionId === "null"
    )
      rejected();
    const privateTarget = Object.freeze({
      ...target,
      marker: Object.freeze({
        ...target.marker,
        oldTagSet: Object.freeze(target.marker.oldTagSet.map((tag) => Object.freeze({ ...tag }))),
        entry: Object.freeze({
          ...validated,
          confirmedAt: validated.confirmedAt.toISOString(),
          backupExpiresAt: validated.backupExpiresAt.toISOString(),
          completedAt: validated.completedAt.toISOString(),
        }),
      }),
    });
    const evidence = await database.client.begin(
      "read only isolation level repeatable read",
      async (transaction) => {
        await rows(transaction, "SET LOCAL statement_timeout = '15s'", [], signal);
        await rows(transaction, "SET LOCAL lock_timeout = '2s'", [], signal);
        const userRows = await rows(transaction, USER_QUERY, [validated.userId], signal);
        const requestRows = await rows(
          transaction,
          REQUEST_QUERY,
          [validated.requestId, validated.operationId, validated.userId],
          signal,
        );
        const operationRows = await rows(
          transaction,
          OPERATION_QUERY,
          [validated.operationId],
          signal,
        );
        const ledgerRows = await rows(
          transaction,
          LEDGER_QUERY,
          [validated.requestId, validated.subjectDigest],
          signal,
        );
        // Select all same-operation records, including conflicting/pending attempts.
        // Four is a sentinel: the pure diagnostic refuses more than three bindings.
        const dispatchRows = await rows(
          transaction,
          DISPATCH_QUERY,
          [validated.operationId],
          signal,
          4,
        );
        active(signal);
        const observedAt = clock();
        if (
          !(observedAt instanceof Date) ||
          !Number.isFinite(observedAt.getTime()) ||
          observedAt.getTime() < start.getTime()
        )
          rejected();
        return {
          schemaVersion: 1,
          ...privateTarget,
          observedAt,
          userRows,
          requestRows,
          operationRows,
          ledgerRows,
          dispatchRows,
          durable: null,
        } as unknown as HistoricalCompletionEvidence;
      },
    );
    active(signal);
    return evidence;
  } catch {
    return rejected();
  }
}
