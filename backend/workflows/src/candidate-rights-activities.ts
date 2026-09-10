import { createHash } from "node:crypto";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import {
  type CandidateRightsActivityInputV1,
  type CandidateRightsActivityResultV1,
  validateCandidateRightsActivityInput,
} from "./candidate-rights-durable.js";
import type { CandidateDeletionRecoveryLedger } from "./candidate-rights-recovery-ledger.js";

export interface CandidateExportArtifact {
  objectKey: string;
  objectVersion: string;
  sha256: string;
  expiresAt: Date;
}

export interface CandidateExportArtifactStore {
  putIfAbsent(input: {
    objectKey: string;
    body: Uint8Array;
    sha256: string;
    expiresAt: Date;
  }): Promise<{ objectVersion: string }>;
  deleteExactVersion?(objectKey: string, objectVersion: string): Promise<boolean>;
}

export interface CandidateDocumentObjectRef {
  documentId: string;
  sourceObjectKey: string;
  sourceObjectVersion: string;
  normalizedObjectKey?: string;
  normalizedObjectVersion?: string;
}

export interface CandidateDocumentObjectStore {
  deleteAllVersionsAndMarkers(
    objects: readonly CandidateDocumentObjectRef[],
  ): Promise<{ exactInventoryEmpty: boolean }>;
}

export interface CandidateExternalIdentity {
  issuer: string;
  subject: string;
}

export interface CandidateIdentityProvider {
  revokeAndDelete(identities: readonly CandidateExternalIdentity[]): Promise<void>;
}

export interface CandidateSubprocessor {
  readonly id: string;
  deleteCandidate(input: { requestId: string; userId: string }): Promise<void>;
}

export interface CandidateRightsActivityDependencies {
  database: DatabaseHandle;
  policy: CandidateRightsPolicy;
  artifactStore: CandidateExportArtifactStore;
  documentObjectStore: CandidateDocumentObjectStore;
  identityProvider: CandidateIdentityProvider;
  subprocessors: readonly CandidateSubprocessor[];
  recoveryLedger: CandidateDeletionRecoveryLedger;
  clock?: () => Date;
}

interface WorkflowContext {
  userId: string;
  resourceId: string;
  operationId: string;
  policyVersion: string;
  state: string;
  confirmedAt?: Date;
  completedAt?: Date;
  backupExpiresAt?: Date;
  subjectDigest?: string;
}

interface OwnerExport {
  candidate?: unknown;
  profile?: unknown;
  documents?: unknown;
  jobs?: unknown;
  matching?: unknown;
  billing?: unknown;
  trust?: unknown;
  audit?: { events?: unknown[] };
}

class CandidateRightsActivityRejected extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CandidateRightsActivityRejected";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function normalizeDatabaseDate(value: unknown): Date {
  const normalized = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(normalized.getTime())) {
    throw new CandidateRightsActivityRejected("CandidateRightsContextDateRejected");
  }
  return normalized;
}

function safeCode(error: unknown): string {
  if (error instanceof CandidateRightsActivityRejected) return error.code;
  const value = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  return value && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)
    ? value
    : message && /^[A-Za-z0-9_.-]{1,64}$/u.test(message)
      ? message
      : error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/u.test(error.name)
        ? error.name
        : "CandidateRightsActivityFailed";
}

function isRetryable(error: unknown): boolean {
  const code = safeCode(error);
  return (
    /^08/u.test(code) ||
    /^53/u.test(code) ||
    [
      "40001",
      "40P01",
      "55P03",
      "57014",
      "57P01",
      "AbortError",
      "ConnectionError",
      "ETIMEDOUT",
      "TimeoutError",
      "ServiceUnavailable",
      "SlowDown",
      "ThrottlingException",
    ].includes(code)
  );
}

function completed(
  action: CandidateRightsActivityInputV1["action"],
): CandidateRightsActivityResultV1 {
  return { schemaVersion: 1, action, outcome: "completed" };
}

function exactContext(
  rows: readonly Record<string, unknown>[],
  input: CandidateRightsActivityInputV1,
): WorkflowContext {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    !isUuid(row.userId) ||
    row.resourceId !== input.resourceId ||
    row.operationId !== input.operationId ||
    row.policyVersion !== input.policyVersion ||
    typeof row.state !== "string"
  ) {
    throw new CandidateRightsActivityRejected("CandidateRightsContextMismatch");
  }
  return {
    ...(row as unknown as WorkflowContext),
    ...(row.confirmedAt === undefined || row.confirmedAt === null
      ? {}
      : { confirmedAt: normalizeDatabaseDate(row.confirmedAt) }),
    ...(row.completedAt === undefined || row.completedAt === null
      ? {}
      : { completedAt: normalizeDatabaseDate(row.completedAt) }),
    ...(row.backupExpiresAt === undefined || row.backupExpiresAt === null
      ? {}
      : { backupExpiresAt: normalizeDatabaseDate(row.backupExpiresAt) }),
  };
}

function exportObjectKey(userId: string, exportId: string): string {
  return `candidate-data-exports/${userId}/${exportId}.json`;
}

function normalizeAudit(ownerExports: readonly OwnerExport[]): unknown[] {
  return ownerExports
    .flatMap((owner) => (Array.isArray(owner.audit?.events) ? owner.audit.events : []))
    .sort((left, right) => {
      const leftRecord = isRecord(left) ? left : {};
      const rightRecord = isRecord(right) ? right : {};
      return `${String(leftRecord.occurredAt ?? "")}:${String(leftRecord.owner ?? "")}:${String(leftRecord.resourceId ?? "")}`.localeCompare(
        `${String(rightRecord.occurredAt ?? "")}:${String(rightRecord.owner ?? "")}:${String(rightRecord.resourceId ?? "")}`,
      );
    });
}

function assemblePortableExport(
  input: CandidateRightsActivityInputV1,
  generatedAt: Date,
  ownerExports: readonly OwnerExport[],
): Record<string, unknown> {
  const [profile, documents, jobs, matching, billing, trust] = ownerExports;
  if (
    !profile ||
    !isRecord(profile.candidate) ||
    !isRecord(profile.profile) ||
    !documents ||
    !isRecord(documents.documents) ||
    !jobs ||
    !isRecord(jobs.jobs) ||
    !matching ||
    !isRecord(matching.matching) ||
    !billing ||
    !isRecord(billing.billing) ||
    !trust ||
    !isRecord(trust.trust)
  ) {
    throw new CandidateRightsActivityRejected("CandidateExportInventoryIncomplete");
  }
  return {
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    exportId: input.resourceId,
    policyVersion: input.policyVersion,
    generatedAt: generatedAt.toISOString(),
    candidate: profile.candidate,
    profile: profile.profile,
    documents: documents.documents,
    jobs: jobs.jobs,
    matching: matching.matching,
    billing: billing.billing,
    trust: trust.trust,
    audit: { events: normalizeAudit(ownerExports) },
  };
}

export class PostgresCandidateRightsActivityStore {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: CandidateRightsActivityDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    if (
      dependencies.policy.ownerInventory.join(",") !==
      "identity,profile,documents,jobs,matching,billing,trust"
    ) {
      throw new CandidateRightsActivityRejected("CandidateRightsOwnerInventoryMismatch");
    }
    const adapterIds = dependencies.subprocessors.map((adapter) => adapter.id);
    if (
      adapterIds.join(",") !== dependencies.policy.subprocessorInventory.join(",") ||
      new Set(adapterIds).size !== adapterIds.length
    ) {
      throw new CandidateRightsActivityRejected("CandidateRightsSubprocessorInventoryMismatch");
    }
  }

  private async exportContext(input: CandidateRightsActivityInputV1): Promise<WorkflowContext> {
    const rows = await this.dependencies.database.client<Record<string, unknown>[]>`
      SELECT user_id AS "userId", id AS "resourceId", operation_id AS "operationId",
             policy_version AS "policyVersion", state
      FROM profile.candidate_data_exports
      WHERE id = ${input.resourceId}::uuid AND operation_id = ${input.operationId}::uuid
    `;
    return exactContext(rows, input);
  }

  private async deletionContext(input: CandidateRightsActivityInputV1): Promise<WorkflowContext> {
    const rows = await this.dependencies.database.client<Record<string, unknown>[]>`
      SELECT request.user_id AS "userId", request.id AS "resourceId",
             request.operation_id AS "operationId", request.policy_version AS "policyVersion",
             request.state, request.confirmed_at AS "confirmedAt",
             request.completed_at AS "completedAt",
             request.backup_expires_at AS "backupExpiresAt",
             ledger.subject_digest AS "subjectDigest"
      FROM profile.account_deletion_requests AS request
      JOIN privacy.account_deletion_ledger AS ledger ON ledger.request_id = request.id
      WHERE request.id = ${input.resourceId}::uuid
        AND request.operation_id = ${input.operationId}::uuid
    `;
    return exactContext(rows, input);
  }

  private deletionRecoveryEntry(context: WorkflowContext, input: CandidateRightsActivityInputV1) {
    if (!context.confirmedAt || !context.backupExpiresAt || !context.subjectDigest) {
      throw new CandidateRightsActivityRejected("CandidateDeletionRecoveryBoundaryMissing");
    }
    return {
      requestId: input.resourceId,
      operationId: input.operationId,
      userId: context.userId,
      policyVersion: input.policyVersion,
      policySha256: this.dependencies.policy.accountablePolicySha256,
      subjectDigest: context.subjectDigest,
      confirmedAt: context.confirmedAt,
      backupExpiresAt: context.backupExpiresAt,
    };
  }

  async recordDeletionRecovery(input: CandidateRightsActivityInputV1): Promise<void> {
    const context = await this.deletionContext(input);
    if (context.state === "requested") {
      throw new CandidateRightsActivityRejected("AccountDeletionStateConflict");
    }
    await this.dependencies.recoveryLedger.recordConfirmed(
      this.deletionRecoveryEntry(context, input),
    );
  }

  async beginExport(input: CandidateRightsActivityInputV1): Promise<void> {
    await this.dependencies.database.client.begin(async (transaction) => {
      const rows = await transaction<Record<string, unknown>[]>`
        SELECT user_id AS "userId", id AS "resourceId", operation_id AS "operationId",
               policy_version AS "policyVersion", state
        FROM profile.candidate_data_exports
        WHERE id = ${input.resourceId}::uuid AND operation_id = ${input.operationId}::uuid
        FOR UPDATE
      `;
      const context = exactContext(rows, input);
      if (context.state === "building" || context.state === "ready") return;
      if (context.state !== "queued") {
        throw new CandidateRightsActivityRejected("CandidateExportStateConflict");
      }
      const now = this.clock().toISOString();
      await transaction`
        UPDATE profile.candidate_data_exports
        SET state = 'building', updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid
      `;
      await transaction`
        UPDATE platform.operations SET state = 'running', error_code = NULL,
          updated_at = ${now}::timestamptz
        WHERE id = ${input.operationId}::uuid AND kind = 'candidate_data_export'
          AND state IN ('queued', 'running', 'retryable_failure')
      `;
    });
  }

  async assembleExport(input: CandidateRightsActivityInputV1): Promise<void> {
    const context = await this.exportContext(input);
    if (context.state === "ready") return;
    if (context.state !== "building") {
      throw new CandidateRightsActivityRejected("CandidateExportStateConflict");
    }
    const generatedAt = this.clock();
    const [profileRows, documentRows, jobRows, matchingRows, billingRows, trustRows] =
      await Promise.all([
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT profile.export_candidate_data(${context.userId}::uuid) AS data
      `,
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT documents.export_candidate_data(${context.userId}::uuid) AS data
      `,
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT jobs.export_candidate_data(${context.userId}::uuid) AS data
      `,
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT matching.export_candidate_data(${context.userId}::uuid) AS data
      `,
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT billing.export_candidate_data(${context.userId}::uuid, ${generatedAt.toISOString()}::timestamptz) AS data
      `,
        this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT trust.export_candidate_data(${context.userId}::uuid) AS data
      `,
      ]);
    const envelope = assemblePortableExport(input, generatedAt, [
      profileRows[0]?.data ?? {},
      documentRows[0]?.data ?? {},
      jobRows[0]?.data ?? {},
      matchingRows[0]?.data ?? {},
      billingRows[0]?.data ?? {},
      trustRows[0]?.data ?? {},
    ]);
    if (!validateCandidateDataExportV1(envelope)) {
      throw new CandidateRightsActivityRejected("CandidateExportSchemaRejected");
    }
    const body = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const expiresAt = new Date(
      generatedAt.getTime() + this.dependencies.policy.exportArtifactLifetimeSeconds * 1_000,
    );
    const objectKey = exportObjectKey(context.userId, input.resourceId);
    const stored = await this.dependencies.artifactStore.putIfAbsent({
      objectKey,
      body,
      sha256,
      expiresAt,
    });
    if (!stored.objectVersion) {
      throw new CandidateRightsActivityRejected("CandidateExportArtifactVersionMissing");
    }
    await this.dependencies.database.client.begin(async (transaction) => {
      const rows = await transaction<Record<string, unknown>[]>`
        SELECT user_id AS "userId", id AS "resourceId", operation_id AS "operationId",
               policy_version AS "policyVersion", state,
               artifact_object_key AS "artifactObjectKey",
               artifact_object_version AS "artifactObjectVersion", artifact_sha256 AS "artifactSha256"
        FROM profile.candidate_data_exports
        WHERE id = ${input.resourceId}::uuid AND operation_id = ${input.operationId}::uuid
        FOR UPDATE
      `;
      const current = exactContext(rows, input);
      if (current.state === "ready") {
        const row = rows[0] ?? {};
        if (
          row.artifactObjectKey !== objectKey ||
          row.artifactObjectVersion !== stored.objectVersion ||
          row.artifactSha256 !== sha256
        ) {
          throw new CandidateRightsActivityRejected("CandidateExportArtifactConflict");
        }
        return;
      }
      if (current.state !== "building") {
        throw new CandidateRightsActivityRejected("CandidateExportStateConflict");
      }
      const now = this.clock().toISOString();
      await transaction`
        UPDATE profile.candidate_data_exports SET state = 'ready',
          artifact_object_key = ${objectKey}, artifact_object_version = ${stored.objectVersion},
          artifact_sha256 = ${sha256}, artifact_expires_at = ${expiresAt.toISOString()}::timestamptz,
          failure_code = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid
      `;
      await transaction`
        UPDATE platform.operations SET state = 'succeeded', result = ${JSON.stringify({
          resourceId: input.resourceId,
          resourceType: "candidate_data_export",
        })}::jsonb, error_code = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${input.operationId}::uuid AND kind = 'candidate_data_export'
      `;
    });
  }

  async failExport(input: CandidateRightsActivityInputV1): Promise<void> {
    await this.dependencies.database.client.begin(async (transaction) => {
      const rows = await transaction<Record<string, unknown>[]>`
        SELECT user_id AS "userId", id AS "resourceId", operation_id AS "operationId",
               policy_version AS "policyVersion", state
        FROM profile.candidate_data_exports
        WHERE id = ${input.resourceId}::uuid AND operation_id = ${input.operationId}::uuid
        FOR UPDATE
      `;
      const context = exactContext(rows, input);
      if (context.state === "failed" || context.state === "ready") return;
      if (!new Set(["queued", "building"]).has(context.state)) {
        throw new CandidateRightsActivityRejected("CandidateExportStateConflict");
      }
      const now = this.clock().toISOString();
      await transaction`
        UPDATE profile.candidate_data_exports SET state = 'failed',
          artifact_object_key = NULL, artifact_object_version = NULL, artifact_sha256 = NULL,
          artifact_expires_at = NULL, failure_code = 'owner_unavailable',
          updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid
      `;
      await transaction`
        UPDATE platform.operations SET state = 'failed', result = NULL,
          error_code = 'CandidateDataExportFailed', updated_at = ${now}::timestamptz
        WHERE id = ${input.operationId}::uuid AND kind = 'candidate_data_export'
      `;
    });
  }

  async deleteActiveSystems(input: CandidateRightsActivityInputV1): Promise<void> {
    const context = await this.deletionContext(input);
    if (
      ["active_systems_deleted", "subprocessors_pending", "completed", "backup_expired"].includes(
        context.state,
      )
    )
      return;
    if (context.state !== "quarantined") {
      throw new CandidateRightsActivityRejected("AccountDeletionStateConflict");
    }
    const identityRows = await this.dependencies.database.client<CandidateExternalIdentity[]>`
      SELECT issuer, subject FROM identity.external_identities
      WHERE user_id = ${context.userId}::uuid ORDER BY issuer, subject
    `;
    const objectRows = await this.dependencies.database.client<Array<{ data: unknown }>>`
      SELECT documents.candidate_object_inventory(${context.userId}::uuid) AS data
    `;
    const objectData = objectRows[0]?.data;
    if (!Array.isArray(objectData) || objectData.some((item) => !isRecord(item))) {
      throw new CandidateRightsActivityRejected("CandidateDocumentInventoryInvalid");
    }
    const objectInventory = objectData as unknown as CandidateDocumentObjectRef[];
    await this.dependencies.identityProvider.revokeAndDelete(identityRows);
    const deletion =
      await this.dependencies.documentObjectStore.deleteAllVersionsAndMarkers(objectInventory);
    if (!deletion.exactInventoryEmpty) {
      throw new CandidateRightsActivityRejected("CandidateDocumentObjectsRemain");
    }
    const now = this.clock().toISOString();
    await this.dependencies.database.client.begin(async (transaction) => {
      await transaction`SELECT jobs.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      await transaction`SELECT matching.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      await transaction`SELECT billing.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      await transaction`SELECT trust.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      await transaction`SELECT documents.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid, true)`;
      await transaction`SELECT profile.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      await transaction`DELETE FROM identity.external_identities WHERE user_id = ${context.userId}::uuid`;
      await transaction`
        UPDATE profile.account_deletion_requests SET state = 'active_systems_deleted',
          version = version + 1, updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid AND state = 'quarantined'
      `;
      await transaction`
        UPDATE privacy.account_deletion_ledger SET state = 'active_systems_deleted',
          owner_inventory = ${JSON.stringify(
            Object.fromEntries(
              this.dependencies.policy.ownerInventory.map((owner) => [owner, "completed"]),
            ),
          )}::jsonb, updated_at = ${now}::timestamptz
        WHERE request_id = ${input.resourceId}::uuid AND state = 'quarantined'
      `;
      await transaction`
        UPDATE platform.operations SET state = 'running', error_code = NULL,
          updated_at = ${now}::timestamptz
        WHERE id = ${input.operationId}::uuid AND kind = 'account_deletion'
      `;
    });
  }

  async reconcileSubprocessors(input: CandidateRightsActivityInputV1): Promise<void> {
    const context = await this.deletionContext(input);
    if (["subprocessors_pending", "completed", "backup_expired"].includes(context.state)) return;
    if (context.state !== "active_systems_deleted") {
      throw new CandidateRightsActivityRejected("AccountDeletionStateConflict");
    }
    for (const subprocessor of this.dependencies.subprocessors) {
      await subprocessor.deleteCandidate({ requestId: input.resourceId, userId: context.userId });
    }
    const now = this.clock().toISOString();
    await this.dependencies.database.client.begin(async (transaction) => {
      await transaction`
        UPDATE profile.account_deletion_requests SET state = 'subprocessors_pending',
          version = version + 1, updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid AND state = 'active_systems_deleted'
      `;
      await transaction`
        UPDATE privacy.account_deletion_ledger SET state = 'subprocessors_pending',
          subprocessor_inventory = ${JSON.stringify(
            Object.fromEntries(this.dependencies.subprocessors.map(({ id }) => [id, "completed"])),
          )}::jsonb, updated_at = ${now}::timestamptz
        WHERE request_id = ${input.resourceId}::uuid AND state = 'active_systems_deleted'
      `;
    });
  }

  async completeDeletion(input: CandidateRightsActivityInputV1): Promise<void> {
    const context = await this.deletionContext(input);
    if (["completed", "backup_expired"].includes(context.state)) {
      if (!context.completedAt) {
        throw new CandidateRightsActivityRejected("CandidateRightsContextDateRejected");
      }
      await this.dependencies.recoveryLedger.markCompleted(input.resourceId, context.completedAt);
      return;
    }
    if (context.state !== "subprocessors_pending") {
      throw new CandidateRightsActivityRejected("AccountDeletionStateConflict");
    }
    const now = this.clock().toISOString();
    await this.dependencies.database.client.begin(async (transaction) => {
      await transaction`
        UPDATE profile.account_deletion_requests SET state = 'completed', version = version + 1,
          completed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${input.resourceId}::uuid AND state = 'subprocessors_pending'
      `;
      await transaction`
        UPDATE privacy.account_deletion_ledger SET state = 'completed',
          completed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE request_id = ${input.resourceId}::uuid AND state = 'subprocessors_pending'
      `;
      await transaction`
        UPDATE platform.operations SET state = 'succeeded', result = ${JSON.stringify({
          resourceId: input.resourceId,
          resourceType: "account_deletion_request",
        })}::jsonb, error_code = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${input.operationId}::uuid AND kind = 'account_deletion'
      `;
    });
    const completedContext = await this.deletionContext(input);
    if (
      !["completed", "backup_expired"].includes(completedContext.state) ||
      !completedContext.completedAt
    ) {
      throw new CandidateRightsActivityRejected("CandidateRightsContextDateRejected");
    }
    await this.dependencies.recoveryLedger.markCompleted(
      input.resourceId,
      completedContext.completedAt,
    );
  }

  async expireDueExports(limit = 25): Promise<{ scanned: number; expired: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CandidateRightsActivityRejected("CandidateExportMaintenanceLimitRejected");
    }
    if (!this.dependencies.artifactStore.deleteExactVersion) {
      throw new CandidateRightsActivityRejected("CandidateExportMaintenanceUnavailable");
    }
    const now = this.clock();
    const due = await this.dependencies.database.client<
      Array<{ id: string; objectKey: string; objectVersion: string }>
    >`
      SELECT id, artifact_object_key AS "objectKey",
             artifact_object_version AS "objectVersion"
      FROM profile.candidate_data_exports
      WHERE state = 'ready' AND artifact_expires_at <= ${now.toISOString()}::timestamptz
      ORDER BY artifact_expires_at, id
      LIMIT ${limit}
    `;
    let expired = 0;
    for (const item of due) {
      if (!isUuid(item.id) || !item.objectKey || !item.objectVersion) {
        throw new CandidateRightsActivityRejected("CandidateExportMaintenanceIdentityRejected");
      }
      const absent = await this.dependencies.artifactStore.deleteExactVersion(
        item.objectKey,
        item.objectVersion,
      );
      if (!absent) throw new CandidateRightsActivityRejected("CandidateExportArtifactStillPresent");
      const updated = await this.dependencies.database.client<Array<{ id: string }>>`
        UPDATE profile.candidate_data_exports
        SET state = 'expired', artifact_object_key = NULL, artifact_object_version = NULL,
            artifact_sha256 = NULL, updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${item.id}::uuid AND state = 'ready'
          AND artifact_object_key = ${item.objectKey}
          AND artifact_object_version = ${item.objectVersion}
          AND artifact_expires_at <= ${now.toISOString()}::timestamptz
        RETURNING id
      `;
      expired += updated.length;
    }
    return { scanned: due.length, expired };
  }
}

export function createCandidateRightsActivityHandler(
  store: Pick<
    PostgresCandidateRightsActivityStore,
    | "beginExport"
    | "assembleExport"
    | "failExport"
    | "recordDeletionRecovery"
    | "deleteActiveSystems"
    | "reconcileSubprocessors"
    | "completeDeletion"
  >,
): (event: unknown) => Promise<CandidateRightsActivityResultV1> {
  return async (event) => {
    if (!validateCandidateRightsActivityInput(event)) {
      return {
        schemaVersion: 1,
        action: "export_begin",
        outcome: "non_retryable_failure",
        errorCode: "ActivityInputRejected",
      };
    }
    try {
      if (event.action === "export_begin") await store.beginExport(event);
      else if (event.action === "export_assemble") await store.assembleExport(event);
      else if (event.action === "export_fail") await store.failExport(event);
      else if (event.action === "deletion_record_recovery") {
        await store.recordDeletionRecovery(event);
      } else if (event.action === "deletion_delete_active_systems") {
        await store.deleteActiveSystems(event);
      } else if (event.action === "deletion_reconcile_subprocessors") {
        await store.reconcileSubprocessors(event);
      } else await store.completeDeletion(event);
      return completed(event.action);
    } catch (error) {
      return {
        schemaVersion: 1,
        action: event.action,
        outcome: isRetryable(error) ? "retryable_failure" : "non_retryable_failure",
        errorCode: safeCode(error),
      };
    }
  };
}
