import { restoredOwnerCountsQuery } from "./candidate-deletion-restore-postconditions.js";
import { createHash } from "node:crypto";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
  validateHistoricalRecoveryEntries,
} from "./candidate-deletion-restore-policy.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";
import { type RestoreDataDigest } from "./candidate-deletion-restore-preservation.js";

/** Process-private, owner-bound inventory; never a request or aggregate response field. */
export interface RestoredCandidateDocumentObjectRef {
  readonly userId: string;
  readonly documentId: string;
  readonly sourceObjectKey: string;
  readonly sourceObjectVersion?: string;
  readonly normalizedObjectKey?: string;
  readonly normalizedObjectVersion?: string;
}

export interface RestoredCandidateCoverLetterObjectRef {
  readonly kind: "cover_letter";
  readonly userId: string;
  readonly documentId: string;
  readonly objectKey: string;
  readonly objectVersion?: string;
}

export type RestoredCandidateObjectRef =
  | RestoredCandidateDocumentObjectRef
  | RestoredCandidateCoverLetterObjectRef;

export interface CandidateDeletionRestorePreflight {
  readonly sha256: string;
  readonly restoredSubjectsPresent: number;
  readonly restoredSubjectsAbsent: number;
  readonly documentObjects: readonly RestoredCandidateObjectRef[];
}

export interface CandidateDeletionRestoreReconciliation {
  restoredUsersReconciled: number;
  restoredUsersAbsent: number;
  restoredUsersAlreadyReconciled: number;
  /** Optional diagnostic evidence from older replay versions. */
  preservation?: { schemaVersion: 1; unchanged: RestoreDataDigest; reconciled: RestoreDataDigest };
}

type RestoreSql = Pick<DatabaseHandle["client"], "unsafe">;
type Row = Record<string, unknown>;
type OwnerCounts = Record<(typeof RESTORED_CANDIDATE_RIGHTS_OWNERS)[number], number>;
interface SubjectState {
  entry: CandidateDeletionRecoveryEntry;
  user: Row | undefined;
  request: Row | undefined;
  operation: Row | undefined;
  ledger: Row | undefined;
  identityDigests: readonly string[];
  documentObjects: readonly RestoredCandidateObjectRef[];
  ownerCounts: OwnerCounts;
  alreadyReconciled: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const terminalStates = new Set(["completed", "backup_expired"]);
const deletionStates = new Set([
  "requested",
  "quarantined",
  "active_systems_deleted",
  "subprocessors_pending",
  ...terminalStates,
]);
const MAX_DOCUMENTS_PER_OWNER = 1_000;
const MAX_DOCUMENTS = 10_000;

export type CandidateDeletionRestoreStoreFailure =
  | "Aborted"
  | "AbsentIdentityHasOwnedData"
  | "BindingCollision"
  | "CompletionCollision"
  | "DatabaseDateRejected"
  | "DocumentInventoryLimit"
  | "DocumentInventoryRejected"
  | "ExpiredRestoreStateConflict"
  | "IdentityCollision"
  | "IdentityInventoryLimit"
  | "LedgerCollision"
  | "NondeletedDataChanged"
  | "OperationCollision"
  | "OwnerDataRemains"
  | "OwnerDeletionRejected"
  | "OwnerInventoryRejected"
  | "PreflightBindingRejected"
  | "PreflightChanged"
  | "RequestCollision";

const storeFailures = new WeakMap<object, CandidateDeletionRestoreStoreFailure>();

/** Read only module-owned identity; arbitrary thrown values and their properties stay unread. */
export function readCandidateDeletionRestoreStoreFailure(
  value: unknown,
): CandidateDeletionRestoreStoreFailure | undefined {
  return typeof value === "object" && value !== null ? storeFailures.get(value) : undefined;
}

function rejected(code: CandidateDeletionRestoreStoreFailure): never {
  const error = new Error(`CandidateDeletionRestore${code}`);
  storeFailures.set(error, code);
  throw error;
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) rejected("Aborted");
}

async function rows(
  sql: RestoreSql,
  query: string,
  values: string[],
  signal?: AbortSignal,
): Promise<Row[]> {
  checkSignal(signal);
  const pending = sql.unsafe<Row[]>(query, values);
  const abort = () => {
    pending.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await pending;
    checkSignal(signal);
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function date(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") rejected("DatabaseDateRejected");
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(Date.prototype.getTime.call(parsed))) rejected("DatabaseDateRejected");
  return Date.prototype.toISOString.call(parsed);
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return date(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update("candidate-deletion-restored-preflight-v1\n")
    .update(JSON.stringify(canonical(value)))
    .update("\n")
    .digest("hex");
}

function subjectDigest(issuer: string, subject: string): string {
  return createHash("sha256")
    .update("ai-job-apply/account-deletion-subject/v1\0")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("hex");
}

function emptyOwnerCounts(): OwnerCounts {
  return Object.fromEntries(
    RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, 0]),
  ) as OwnerCounts;
}

function parseOwnerCounts(value: unknown): OwnerCounts {
  if (!value || typeof value !== "object" || Array.isArray(value))
    rejected("OwnerInventoryRejected");
  const input = value as Row;
  if (
    Object.keys(input).sort().join(",") !== [...RESTORED_CANDIDATE_RIGHTS_OWNERS].sort().join(",")
  )
    rejected("OwnerInventoryRejected");
  for (const count of Object.values(input)) {
    if (!Number.isSafeInteger(count) || (count as number) < 0) rejected("OwnerInventoryRejected");
  }
  return input as OwnerCounts;
}

function parseDocuments(
  userId: string,
  records: Row[],
): readonly RestoredCandidateDocumentObjectRef[] {
  if (records.length > MAX_DOCUMENTS_PER_OWNER) rejected("DocumentInventoryLimit");
  const seen = new Set<string>();
  return Object.freeze(
    records.map((row) => {
      const {
        documentId,
        sourceObjectKey,
        sourceObjectVersion,
        normalizedObjectKey,
        normalizedObjectVersion,
        status,
      } = row;
      if (
        typeof documentId !== "string" ||
        !UUID.test(documentId) ||
        seen.has(documentId) ||
        sourceObjectKey !== `quarantine/${documentId}/source`
      )
        rejected("DocumentInventoryRejected");
      seen.add(documentId);
      const version = (value: unknown) =>
        typeof value === "string" &&
        value.length > 0 &&
        value !== "null" &&
        value.length <= 1_024 &&
        [...value].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        );
      if (
        sourceObjectVersion == null ? status !== "awaiting_upload" : !version(sourceObjectVersion)
      )
        rejected("DocumentInventoryRejected");
      if ((normalizedObjectKey == null) !== (normalizedObjectVersion == null))
        rejected("DocumentInventoryRejected");
      if (
        normalizedObjectKey != null &&
        (typeof normalizedObjectKey !== "string" ||
          normalizedObjectKey.length > 1_024 ||
          !new RegExp(
            `^normalized/${documentId}/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}/resume\\.json$`,
            "u",
          ).test(normalizedObjectKey) ||
          !version(normalizedObjectVersion) ||
          sourceObjectVersion == null)
      )
        rejected("DocumentInventoryRejected");
      return Object.freeze({
        userId,
        documentId,
        sourceObjectKey: sourceObjectKey as string,
        ...(sourceObjectVersion == null
          ? {}
          : { sourceObjectVersion: sourceObjectVersion as string }),
        ...(normalizedObjectKey == null
          ? {}
          : {
              normalizedObjectKey: normalizedObjectKey as string,
              normalizedObjectVersion: normalizedObjectVersion as string,
            }),
      });
    }),
  );
}

function parseCoverLetters(
  userId: string,
  records: Row[],
): readonly RestoredCandidateCoverLetterObjectRef[] {
  if (records.length > MAX_DOCUMENTS_PER_OWNER) rejected("DocumentInventoryLimit");
  const seen = new Set<string>();
  return Object.freeze(
    records.map((row) => {
      const { documentId, objectKey, objectVersion, status } = row;
      if (
        typeof documentId !== "string" ||
        !UUID.test(documentId) ||
        seen.has(documentId) ||
        objectKey !== `normalized/${documentId}/cover-letter.v1.json` ||
        (status !== "pending" && status !== "ready") ||
        (status === "pending"
          ? objectVersion != null
          : typeof objectVersion !== "string" ||
            objectVersion === "null" ||
            objectVersion.length === 0 ||
            objectVersion.length > 1024 ||
            [...objectVersion].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
      )
        rejected("DocumentInventoryRejected");
      seen.add(documentId);
      return Object.freeze({
        kind: "cover_letter" as const,
        userId,
        documentId,
        objectKey: objectKey as string,
        ...(objectVersion == null ? {} : { objectVersion: objectVersion as string }),
      });
    }),
  );
}

/** Construct only after the executor authenticates a quiesced, isolated restore target. */
export class PostgresCandidateDeletionRestoreStore {
  readonly #preflights = new WeakMap<CandidateDeletionRestorePreflight, string>();

  constructor(private readonly database: DatabaseHandle) {}

  private async inspectSubject(
    sql: RestoreSql,
    entry: CandidateDeletionRecoveryEntry,
    lock: boolean,
    signal?: AbortSignal,
  ): Promise<SubjectState> {
    const suffix = lock ? " FOR UPDATE" : "";
    const userRows = await rows(
      sql,
      `SELECT id, account_state AS "accountState", created_at AS "createdAt", quarantined_at AS "quarantinedAt" FROM identity.users WHERE id = $1::uuid${suffix}`,
      [entry.userId],
      signal,
    );
    const requestRows = await rows(
      sql,
      `SELECT id, user_id AS "userId", operation_id AS "operationId", policy_version AS "policyVersion", state, version, requested_at AS "requestedAt", confirmed_at AS "confirmedAt", backup_expires_at AS "backupExpiresAt", completed_at AS "completedAt", backup_expired_at AS "backupExpiredAt" FROM profile.account_deletion_requests WHERE id = $1::uuid OR operation_id = $2::uuid OR (user_id = $3::uuid AND state IN ('requested', 'quarantined', 'active_systems_deleted', 'subprocessors_pending')) ORDER BY id${suffix}`,
      [entry.requestId, entry.operationId, entry.userId],
      signal,
    );
    const operationRows = await rows(
      sql,
      `SELECT id, user_id AS "userId", kind, state, result FROM platform.operations WHERE id = $1::uuid${suffix}`,
      [entry.operationId],
      signal,
    );
    const ledgerRows = await rows(
      sql,
      `SELECT request_id AS "requestId", subject_digest AS "subjectDigest", policy_version AS "policyVersion", policy_sha256 AS "policySha256", state, owner_inventory AS "ownerInventory", subprocessor_inventory AS "subprocessorInventory", confirmed_at AS "confirmedAt", backup_expires_at AS "backupExpiresAt", completed_at AS "completedAt", backup_expired_at AS "backupExpiredAt" FROM privacy.account_deletion_ledger WHERE request_id = $1::uuid OR subject_digest = $2 ORDER BY request_id${suffix}`,
      [entry.requestId, entry.subjectDigest],
      signal,
    );
    if (
      userRows.length > 1 ||
      requestRows.length > 1 ||
      operationRows.length > 1 ||
      ledgerRows.length > 1
    )
      rejected("BindingCollision");
    const user = userRows[0];
    const request = requestRows[0];
    const operation = operationRows[0];
    const ledger = ledgerRows[0];
    if (
      request &&
      (request.id !== entry.requestId ||
        request.userId !== entry.userId ||
        request.policyVersion !== entry.policyVersion ||
        !deletionStates.has(String(request.state)) ||
        !Number.isSafeInteger(request.version) ||
        (request.version as number) < 1 ||
        date(request.requestedAt) > entry.confirmedAt.toISOString())
    )
      rejected("RequestCollision");
    if (
      operation &&
      (operation.id !== entry.operationId ||
        operation.userId !== entry.userId ||
        operation.kind !== "account_deletion" ||
        !new Set(["queued", "running", "succeeded", "retryable_failure", "failed"]).has(
          String(operation.state),
        ))
    )
      rejected("OperationCollision");
    if (operation?.result != null) {
      const result = operation.result as Row;
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        Object.keys(result).sort().join(",") !== "resourceId,resourceType" ||
        result.resourceId !== entry.requestId ||
        result.resourceType !== "account_deletion_request"
      )
        rejected("OperationCollision");
    }
    if (request?.state === "requested") {
      if (
        request.operationId != null ||
        request.confirmedAt != null ||
        request.backupExpiresAt != null ||
        request.completedAt != null ||
        request.backupExpiredAt != null ||
        ledger
      )
        rejected("RequestCollision");
    } else if (request) {
      if (
        request.operationId !== entry.operationId ||
        date(request.confirmedAt) !== entry.confirmedAt.toISOString() ||
        date(request.backupExpiresAt) !== entry.backupExpiresAt.toISOString() ||
        !operation ||
        !ledger
      )
        rejected("RequestCollision");
      if (
        terminalStates.has(String(request.state)) &&
        date(request.completedAt) !== entry.completedAt?.toISOString()
      )
        rejected("CompletionCollision");
      if (
        (!terminalStates.has(String(request.state)) && request.completedAt != null) ||
        (request.state !== "backup_expired" && request.backupExpiredAt != null)
      )
        rejected("CompletionCollision");
    }
    if (ledger) {
      if (
        ledger.requestId !== entry.requestId ||
        ledger.subjectDigest !== entry.subjectDigest ||
        ledger.policyVersion !== entry.policyVersion ||
        ledger.policySha256 !== entry.policySha256 ||
        !deletionStates.has(String(ledger.state)) ||
        ledger.state === "requested" ||
        date(ledger.confirmedAt) !== entry.confirmedAt.toISOString() ||
        date(ledger.backupExpiresAt) !== entry.backupExpiresAt.toISOString() ||
        (!!user && !request) ||
        (!!request && request.state !== ledger.state)
      )
        rejected("LedgerCollision");
      if (
        !ledger.subprocessorInventory ||
        typeof ledger.subprocessorInventory !== "object" ||
        Array.isArray(ledger.subprocessorInventory) ||
        Object.keys(ledger.subprocessorInventory).length !== 0
      )
        rejected("LedgerCollision");
      const inventory = ledger.ownerInventory;
      // The recorded policy fixes the owner set its ledger tracked; a restore replay may also
      // complete every current owner (RESTORED), never an unrecorded subset.
      const expectedOwners =
        ACCEPTED_CANDIDATE_DELETION_POLICIES.find(
          (policy) =>
            policy.version === entry.policyVersion && policy.sha256 === entry.policySha256,
        )?.ownerInventory ?? RESTORED_CANDIDATE_RIGHTS_OWNERS;
      if (
        !inventory ||
        typeof inventory !== "object" ||
        Array.isArray(inventory) ||
        ![expectedOwners, RESTORED_CANDIDATE_RIGHTS_OWNERS].some(
          (expected) => Object.keys(inventory).sort().join(",") === [...expected].sort().join(","),
        ) ||
        Object.values(inventory).some((state) => state !== "pending" && state !== "completed")
      )
        rejected("LedgerCollision");
      if (
        terminalStates.has(String(ledger.state)) &&
        date(ledger.completedAt) !== entry.completedAt?.toISOString()
      )
        rejected("CompletionCollision");
      if (
        (!terminalStates.has(String(ledger.state)) && ledger.completedAt != null) ||
        (ledger.state !== "backup_expired" && ledger.backupExpiredAt != null)
      )
        rejected("CompletionCollision");
      if (
        ledger.state === "backup_expired" &&
        ((!!request && date(ledger.backupExpiredAt) !== date(request.backupExpiredAt)) ||
          date(ledger.backupExpiredAt) < entry.backupExpiresAt.toISOString() ||
          date(ledger.backupExpiredAt) > new Date().toISOString())
      )
        rejected("CompletionCollision");
    }
    if (!user) {
      if (request || operation) rejected("IdentityCollision");
      const counts = await rows(sql, restoredOwnerCountsQuery, [entry.userId], signal);
      if (
        counts.length !== 1 ||
        Object.values(parseOwnerCounts(counts[0]?.ownerCounts)).some((count) => count !== 0)
      )
        rejected("AbsentIdentityHasOwnedData");
      return {
        entry,
        user,
        request,
        operation,
        ledger,
        identityDigests: [],
        documentObjects: [],
        ownerCounts: emptyOwnerCounts(),
        alreadyReconciled: false,
      };
    }
    if (
      user.id !== entry.userId ||
      !new Set(["active", "quarantined"]).has(String(user.accountState)) ||
      date(user.createdAt) > entry.confirmedAt.toISOString()
    )
      rejected("IdentityCollision");
    if (
      user.accountState === "active"
        ? user.quarantinedAt != null
        : date(user.quarantinedAt) > date(entry.completedAt)
    )
      rejected("IdentityCollision");
    const identities = await rows(
      sql,
      `SELECT issuer, subject FROM identity.external_identities WHERE user_id = $1::uuid ORDER BY issuer, subject LIMIT 101${suffix}`,
      [entry.userId],
      signal,
    );
    if (identities.length > 100) rejected("IdentityInventoryLimit");
    const identityDigests = identities
      .map((identity) => {
        if (
          typeof identity.issuer !== "string" ||
          !identity.issuer ||
          typeof identity.subject !== "string" ||
          !identity.subject
        )
          rejected("IdentityCollision");
        return subjectDigest(identity.issuer, identity.subject);
      })
      .sort();
    if (
      identityDigests.length > 0
        ? !identityDigests.includes(entry.subjectDigest)
        : !ledger || !request || user.accountState !== "quarantined"
    )
      rejected("IdentityCollision");
    const documents = await rows(
      sql,
      `SELECT id AS "documentId", source_object_key AS "sourceObjectKey", source_object_version AS "sourceObjectVersion", normalized_object_key AS "normalizedObjectKey", normalized_object_version AS "normalizedObjectVersion", status FROM documents.resume_documents WHERE user_id = $1::uuid ORDER BY id LIMIT 1001${suffix}`,
      [entry.userId],
      signal,
    );
    const coverLetters = await rows(
      sql,
      `SELECT id AS "documentId", object_key AS "objectKey", object_version AS "objectVersion", status FROM documents.cover_letters WHERE user_id = $1::uuid ORDER BY id LIMIT 1001${suffix}`,
      [entry.userId],
      signal,
    );
    const documentObjects = [
      ...parseDocuments(entry.userId, documents),
      ...parseCoverLetters(entry.userId, coverLetters),
    ];
    if (documentObjects.length > MAX_DOCUMENTS_PER_OWNER) rejected("DocumentInventoryLimit");
    if (new Set(documentObjects.map((ref) => ref.documentId)).size !== documentObjects.length)
      rejected("DocumentInventoryRejected");
    const counts = await rows(sql, restoredOwnerCountsQuery, [entry.userId], signal);
    if (counts.length !== 1) rejected("OwnerInventoryRejected");
    const ownerCounts = parseOwnerCounts(counts[0]?.ownerCounts);
    const empty = Object.values(ownerCounts).every((count) => count === 0);
    const alreadyReconciled =
      terminalStates.has(String(request?.state)) &&
      empty &&
      user.accountState === "quarantined" &&
      operation?.state === "succeeded" &&
      !!ledger &&
      Object.values(ledger.ownerInventory as Row).every((value) => value === "completed");
    if (request?.state === "backup_expired" && !alreadyReconciled)
      rejected("ExpiredRestoreStateConflict");
    return {
      entry,
      user,
      request,
      operation,
      ledger,
      identityDigests,
      documentObjects,
      ownerCounts,
      alreadyReconciled,
    };
  }

  private async inspectAll(
    sql: RestoreSql,
    entries: readonly CandidateDeletionRecoveryEntry[],
    lock: boolean,
    signal?: AbortSignal,
  ) {
    const states: SubjectState[] = [];
    const documents: RestoredCandidateObjectRef[] = [];
    for (const entry of entries) {
      const state = await this.inspectSubject(sql, entry, lock, signal);
      states.push(state);
      documents.push(...state.documentObjects);
      if (documents.length > MAX_DOCUMENTS) rejected("DocumentInventoryLimit");
    }
    const preflight = Object.freeze({
      sha256: digest(states),
      restoredSubjectsPresent: states.filter((state) => state.user).length,
      restoredSubjectsAbsent: states.filter((state) => !state.user).length,
      documentObjects: Object.freeze(documents),
    });
    return { states, preflight };
  }

  async preflight(
    entries: readonly CandidateDeletionRecoveryEntry[],
    signal?: AbortSignal,
  ): Promise<CandidateDeletionRestorePreflight> {
    const validated = validateHistoricalRecoveryEntries(entries, new Date());
    const { preflight } = await this.database.client.begin(
      "read only isolation level repeatable read",
      async (transaction) => {
        await rows(transaction, "SET LOCAL statement_timeout = '15s'", [], signal);
        await rows(transaction, "SET LOCAL lock_timeout = '2s'", [], signal);
        return this.inspectAll(transaction, validated, false, signal);
      },
    );
    this.#preflights.set(preflight, digest(validated));
    return preflight;
  }

  async reconcile(
    entries: readonly CandidateDeletionRecoveryEntry[],
    reviewedPreflight: CandidateDeletionRestorePreflight,
    signal?: AbortSignal,
  ): Promise<CandidateDeletionRestoreReconciliation> {
    const validated = validateHistoricalRecoveryEntries(entries, new Date());
    if (this.#preflights.get(reviewedPreflight) !== digest(validated))
      rejected("PreflightBindingRejected");
    return this.database.client.begin("isolation level serializable", async (transaction) => {
      await rows(transaction, "SET LOCAL statement_timeout = '15s'", [], signal);
      await rows(transaction, "SET LOCAL lock_timeout = '2s'", [], signal);
      // Every marker, collision and document inventory is revalidated under one
      // transaction before its first INSERT/UPDATE/DELETE or owner deletion call.
      const fresh = await this.inspectAll(transaction, validated, true, signal);
      if (fresh.preflight.sha256 !== reviewedPreflight.sha256) rejected("PreflightChanged");
      const result = {
        restoredUsersReconciled: 0,
        restoredUsersAbsent: 0,
        restoredUsersAlreadyReconciled: 0,
      };
      for (const state of fresh.states) {
        checkSignal(signal);
        if (!state.user) {
          result.restoredUsersAbsent += 1;
          continue;
        }
        if (state.alreadyReconciled) {
          result.restoredUsersAlreadyReconciled += 1;
          continue;
        }
        await this.reconcileSubject(transaction, state, signal);
        result.restoredUsersReconciled += 1;
      }
      checkSignal(signal);
      // Return only after begin() positively acknowledges COMMIT. Owner deletion
      // postconditions remain enforced; whole-database proof is not an admission gate.
      return result;
    });
  }

  private async reconcileSubject(
    sql: RestoreSql,
    state: SubjectState,
    signal?: AbortSignal,
  ): Promise<void> {
    const { entry } = state;
    const confirmedAt = entry.confirmedAt.toISOString();
    const backupExpiresAt = entry.backupExpiresAt.toISOString();
    const bindings = [
      entry.userId,
      entry.requestId,
      entry.operationId,
      entry.policyVersion,
      confirmedAt,
      backupExpiresAt,
    ];
    await rows(
      sql,
      "UPDATE identity.users SET account_state = 'quarantined', quarantined_at = COALESCE(quarantined_at, $2::timestamptz) WHERE id = $1::uuid",
      [entry.userId, confirmedAt],
      signal,
    );
    if (!state.operation)
      await rows(
        sql,
        "INSERT INTO platform.operations (id, user_id, kind, state, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 'account_deletion', 'queued', $3::timestamptz, $3::timestamptz)",
        [entry.operationId, entry.userId, confirmedAt],
        signal,
      );
    if (!state.request) {
      await rows(
        sql,
        "INSERT INTO profile.account_deletion_requests (user_id, id, operation_id, policy_version, requested_at, confirmed_at, backup_expires_at, updated_at, state, version) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $5::timestamptz, $6::timestamptz, $5::timestamptz, 'quarantined', 2)",
        bindings,
        signal,
      );
    } else if (state.request.state === "requested") {
      await rows(
        sql,
        "UPDATE profile.account_deletion_requests SET operation_id = $3::uuid, confirmed_at = $5::timestamptz, backup_expires_at = $6::timestamptz, updated_at = $5::timestamptz, state = 'quarantined', version = version + 1 WHERE user_id = $1::uuid AND id = $2::uuid AND policy_version = $4 AND state = 'requested'",
        bindings,
        signal,
      );
    }
    if (!state.ledger) {
      await rows(
        sql,
        "INSERT INTO privacy.account_deletion_ledger (request_id, subject_digest, policy_version, policy_sha256, state, owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at) VALUES ($1::uuid, $2, $3, $4, 'quarantined', $5::text::jsonb, '{}'::jsonb, $6::timestamptz, $7::timestamptz, $6::timestamptz)",
        [
          entry.requestId,
          entry.subjectDigest,
          entry.policyVersion,
          entry.policySha256,
          JSON.stringify(
            Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, "pending"])),
          ),
          confirmedAt,
          backupExpiresAt,
        ],
        signal,
      );
    }
    for (const owner of [
      "applications",
      "jobs",
      "matching",
      "billing",
      "trust",
      "documents",
      "profile",
    ] as const) {
      const result = await rows(
        sql,
        `SELECT ${owner}.delete_candidate_data($1::uuid, $2::uuid${owner === "documents" ? ", true" : ""}) AS result`,
        [entry.userId, entry.requestId],
        signal,
      );
      if (
        result.length !== 1 ||
        !result[0]?.result ||
        typeof result[0].result !== "object" ||
        (result[0].result as Row).owner !== owner
      )
        rejected("OwnerDeletionRejected");
    }
    await rows(
      sql,
      "DELETE FROM identity.external_identities WHERE user_id = $1::uuid",
      [entry.userId],
      signal,
    );
    const counts = await rows(sql, restoredOwnerCountsQuery, [entry.userId], signal);
    if (
      counts.length !== 1 ||
      Object.values(parseOwnerCounts(counts[0]?.ownerCounts)).some((count) => count !== 0)
    )
      rejected("OwnerDataRemains");
    const completedAt = date(entry.completedAt);
    await rows(
      sql,
      "UPDATE profile.account_deletion_requests SET state = 'completed', version = CASE WHEN state = 'completed' THEN version ELSE version + 1 END, completed_at = COALESCE(completed_at, $4::timestamptz), updated_at = $4::timestamptz WHERE id = $1::uuid AND user_id = $2::uuid AND operation_id = $3::uuid AND state <> 'backup_expired'",
      [entry.requestId, entry.userId, entry.operationId, completedAt],
      signal,
    );
    await rows(
      sql,
      "UPDATE privacy.account_deletion_ledger SET state = 'completed', owner_inventory = $5::text::jsonb, subprocessor_inventory = '{}'::jsonb, completed_at = COALESCE(completed_at, $4::timestamptz), updated_at = $4::timestamptz WHERE request_id = $1::uuid AND policy_version = $2 AND policy_sha256 = $3 AND state <> 'backup_expired'",
      [
        entry.requestId,
        entry.policyVersion,
        entry.policySha256,
        completedAt,
        JSON.stringify(
          Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, "completed"])),
        ),
      ],
      signal,
    );
    await rows(
      sql,
      "UPDATE platform.operations SET state = 'succeeded', result = $4::text::jsonb, error_code = NULL, updated_at = $3::timestamptz WHERE id = $1::uuid AND user_id = $2::uuid AND kind = 'account_deletion'",
      [
        entry.operationId,
        entry.userId,
        completedAt,
        JSON.stringify({ resourceId: entry.requestId, resourceType: "account_deletion_request" }),
      ],
      signal,
    );
  }
}
