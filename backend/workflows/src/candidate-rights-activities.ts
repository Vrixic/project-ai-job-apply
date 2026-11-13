import { createHash } from "node:crypto";
import type { RestrictedPacketExportReader } from "@ai-job-apply/applications-service";
import type {
  CoverLetterExportReader,
  CoverLetterExportReference,
} from "@ai-job-apply/documents-service/cover-letter-export";
import {
  type CandidateDataExportValidationIssue,
  candidateDataExportValidationIssue,
} from "@ai-job-apply/domain";
import type {
  DatabaseHandle,
  PostgresResumeProposalWriter,
  RestrictedAnswerExportReader,
} from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import {
  type CandidateRightsActivityInputV1,
  type CandidateRightsActivityResultV1,
  validateCandidateRightsActivityInput,
} from "./candidate-rights-durable.js";
import type { CandidateDeletionRecoveryLedger } from "./candidate-rights-recovery-ledger.js";
import { failureFields } from "./failure-fields.js";
import type { NativeTaskAbsenceObserver } from "./native-task-absence.js";
import { enrichRestrictedPacketExport } from "./restricted-packet-export.js";

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
  deleteExactVersion?(
    objectKey: string,
    objectVersion: string,
    deleteMarker?: boolean,
  ): Promise<boolean>;
  inventoryExactKey?(
    objectKey: string,
  ): Promise<Array<{ objectVersion: string; deleteMarker: boolean }>>;
}

export interface CandidateDocumentObjectRef {
  documentId: string;
  sourceObjectKey: string;
  /** Pending cover-letter reservations inventory their key before a version exists. */
  sourceObjectVersion?: string;
  normalizedObjectKey?: string;
  normalizedObjectVersion?: string;
}

export interface CandidateDocumentObjectStore {
  /** Verifies recorded keys and both document-derived prefixes empty before owner-row deletion. */
  deleteAllVersionsAndMarkers(
    objects: readonly CandidateDocumentObjectRef[],
  ): Promise<{ exactInventoryEmpty: boolean }>;
  /** Removes every version and marker under one deleted resume's prefixes and reports what a second listing still finds. */
  purgeDocumentPrefixes?(documentId: string): Promise<{ deleted: number; remaining: number }>;
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
  /** Profile's own retirement of unreviewed proposals, needed by the resume purge sweep (ADR-034). */
  resumeProposals?: Pick<PostgresResumeProposalWriter, "retireDocumentProposals">;
  /** Read-only proof that a native resume task no longer runs, for a purge a lost retirement receipt would block. */
  nativeTaskAbsence?: NativeTaskAbsenceObserver;
  restrictedAnswerExport?: RestrictedAnswerExportReader;
  restrictedPacketExport?: RestrictedPacketExportReader;
  coverLetterExport?: CoverLetterExportReader;
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
  applications?: unknown;
  notifications?: unknown;
  restrictedPacketReferences?: unknown;
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

type ExportValidationStage =
  | "metadata"
  | "restricted_packet"
  | "restricted_answers"
  | "cover_letters";
function rejectExportSchema(
  stage: ExportValidationStage,
  issue: CandidateDataExportValidationIssue,
): never {
  try {
    console.warn({
      event: "candidate_export_validation_failed",
      stage,
      section: issue.section,
      schemaPath: issue.schemaPath,
      keyword: issue.keyword,
    });
  } catch {
    // Unavailable diagnostics must not replace the fixed refusal or permit publication.
  }
  throw new CandidateRightsActivityRejected("CandidateExportSchemaRejected");
}
function assertExportSchema(value: unknown, stage: ExportValidationStage): void {
  const issue = candidateDataExportValidationIssue(value);
  if (issue) rejectExportSchema(stage, issue);
}

/** Why a resume purge step failed, as fixed-format fields only (see failure-fields.ts). */
function resumePurgeFailureFields(error: unknown): Record<string, string | number> {
  if (error instanceof CandidateRightsActivityRejected) return { errorCode: error.code };
  return { errorCode: "ResumePurgeStepFailed", ...failureFields(error) };
}

/**
 * The unsettled native resume generations Documents reports for a resume it could not purge, reduced to the fixed
 * fields it is allowed to name: the state, whether a launch was claimed or a task is bound, and how long past its
 * expiry it is. Anything else, and anything of the wrong shape, is dropped.
 */
export function unsettledGenerations(
  value: unknown,
): Array<Record<string, string | number | boolean>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!isRecord(item) || typeof item.state !== "string" || !/^[a-z_]{3,20}$/u.test(item.state))
      return [];
    const entry: Record<string, string | number | boolean> = { state: item.state };
    for (const key of ["hasTask", "launchClaimed", "expired"]) {
      if (typeof item[key] === "boolean") entry[key] = item[key] as boolean;
    }
    const overdue = item.overdueHours;
    if (typeof overdue === "number" && Number.isSafeInteger(overdue) && overdue >= 0)
      entry.overdueHours = overdue;
    return [entry];
  });
}

/** The task ARNs Documents says are old enough to ask ECS about: at most 20, each in the ECS task ARN shape. */
function boundTaskArns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .filter(
      (item): item is string =>
        typeof item === "string" &&
        /^arn:aws:ecs:[a-z]{2}-[a-z]+-[0-9]:[0-9]{12}:task\/[A-Za-z0-9_-]{1,255}\/[A-Za-z0-9]{1,255}$/u.test(
          item,
        ),
    );
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
      "RestrictedAnswerExportSnapshotChanged",
      "CandidateExportArtifactStillPresent",
      "CandidateExportArtifactDeletionUnconfirmed",
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
  includeApplications: boolean,
  includeNotifications: boolean,
): Record<string, unknown> {
  const [profile, documents, jobs, matching, billing, trust, applications, notifications] =
    ownerExports;
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
    !isRecord(trust.trust) ||
    (includeApplications && (!applications || !isRecord(applications.applications))) ||
    (includeNotifications && (!notifications || !isRecord(notifications.notifications)))
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
    ...(includeApplications && applications ? { applications: applications.applications } : {}),
    ...(includeNotifications && notifications
      ? { notifications: notifications.notifications }
      : {}),
    audit: { events: normalizeAudit(ownerExports) },
  };
}

const BASE_OWNER_INVENTORY = "identity,profile,documents,jobs,matching,billing,trust";
const OWNER_INVENTORY_WITH_APPLICATIONS = `${BASE_OWNER_INVENTORY},applications`;
const OWNER_INVENTORY_WITH_NOTIFICATIONS = `${OWNER_INVENTORY_WITH_APPLICATIONS},notifications`;

export class PostgresCandidateRightsActivityStore {
  private readonly clock: () => Date;
  /** True only when the active accountable policy lists Applications as an owner. */
  private readonly includesApplications: boolean;
  /** True only when the active accountable policy lists Notifications as an owner. */
  private readonly includesNotifications: boolean;

  constructor(private readonly dependencies: CandidateRightsActivityDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    const inventory = dependencies.policy.ownerInventory.join(",");
    if (
      inventory !== BASE_OWNER_INVENTORY &&
      inventory !== OWNER_INVENTORY_WITH_APPLICATIONS &&
      inventory !== OWNER_INVENTORY_WITH_NOTIFICATIONS
    ) {
      throw new CandidateRightsActivityRejected("CandidateRightsOwnerInventoryMismatch");
    }
    this.includesNotifications = inventory === OWNER_INVENTORY_WITH_NOTIFICATIONS;
    this.includesApplications = inventory !== BASE_OWNER_INVENTORY;
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
    const initial = await this.exportContext(input);
    await this.dependencies.database.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${initial.userId}::uuid)`;
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
    const [
      profileRows,
      documentRows,
      jobRows,
      matchingRows,
      billingRows,
      trustRows,
      applicationsRows,
      notificationsRows,
    ] = await Promise.all([
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
      this.includesApplications
        ? this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT applications.export_candidate_data(${context.userId}::uuid) AS data
      `
        : Promise.resolve([] as Array<{ data: OwnerExport }>),
      this.includesNotifications
        ? this.dependencies.database.client<Array<{ data: OwnerExport }>>`
        SELECT notifications.export_candidate_data(${context.userId}::uuid) AS data
      `
        : Promise.resolve([] as Array<{ data: OwnerExport }>),
    ]);
    const envelope = assemblePortableExport(
      input,
      generatedAt,
      [
        profileRows[0]?.data ?? {},
        documentRows[0]?.data ?? {},
        jobRows[0]?.data ?? {},
        matchingRows[0]?.data ?? {},
        billingRows[0]?.data ?? {},
        trustRows[0]?.data ?? {},
        applicationsRows[0]?.data ?? {},
        notificationsRows[0]?.data ?? {},
      ],
      this.includesApplications,
      this.includesNotifications,
    );
    assertExportSchema(envelope, "metadata");
    if (this.includesApplications) {
      envelope.applications = await enrichRestrictedPacketExport({
        applications: envelope.applications as Record<string, unknown>,
        inventory: applicationsRows[0]?.data.restrictedPacketReferences,
        scope: {
          ownerUserId: context.userId,
          exportId: input.resourceId,
          operationId: input.operationId,
          policyVersion: input.policyVersion,
        },
        ...(this.dependencies.restrictedPacketExport
          ? { reader: this.dependencies.restrictedPacketExport }
          : {}),
      });
      assertExportSchema(envelope, "restricted_packet");
    }
    const exportProfile = envelope.profile as Record<string, unknown>;
    if (
      Array.isArray(exportProfile.restrictedAnswers) &&
      exportProfile.restrictedAnswers.some((entry: Record<string, unknown>) =>
        Object.hasOwn(entry, "value"),
      )
    ) {
      rejectExportSchema("restricted_answers", {
        section: "profile",
        schemaPath: "#/properties/profile/properties/restrictedAnswers",
        keyword: "owner_projection",
      });
    }
    if (this.dependencies.restrictedAnswerExport) {
      const profile = exportProfile;
      if (!Array.isArray(profile.restrictedAnswers)) {
        throw new CandidateRightsActivityRejected("RestrictedAnswerExportInventoryMissing");
      }
      const entries: Array<Record<string, unknown>> = [];
      for (const entry of profile.restrictedAnswers as Array<Record<string, unknown>>) {
        if (entry.state !== "active") {
          entries.push({ ...entry });
          continue;
        }
        const value = await this.dependencies.restrictedAnswerExport.readValue(context.userId, {
          id: entry.id as string,
          version: entry.version as number,
          fieldKey: entry.fieldKey as string,
          ...(typeof entry.context === "string" ? { context: entry.context } : {}),
        });
        entries.push({ ...entry, value });
      }
      profile.restrictedAnswers = entries;
      assertExportSchema(envelope, "restricted_answers");
    }
    const documents = envelope.documents as Record<string, unknown>;
    if (Array.isArray(documents.coverLetters)) {
      const letters = documents.coverLetters as Array<Record<string, unknown>>;
      if (
        letters.some(
          (letter) =>
            Object.hasOwn(letter, "paragraphs") || Object.hasOwn(letter, "reviewRequired"),
        )
      )
        rejectExportSchema("cover_letters", {
          section: "documents",
          schemaPath: "#/properties/documents/properties/coverLetters",
          keyword: "owner_projection",
        });
      if (this.dependencies.coverLetterExport) {
        const exported = [];
        for (const letter of letters) {
          if (letter.status !== "ready") {
            exported.push({ ...letter });
            continue;
          }
          const paragraphs = await this.dependencies.coverLetterExport.readValue(
            context.userId,
            structuredClone(letter) as unknown as CoverLetterExportReference,
          );
          exported.push({
            ...letter,
            paragraphs: structuredClone(paragraphs),
            reviewRequired: true,
          });
        }
        documents.coverLetters = exported;
        assertExportSchema(envelope, "cover_letters");
      }
    }
    const body = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const expiresAt = new Date(
      generatedAt.getTime() + this.dependencies.policy.exportArtifactLifetimeSeconds * 1_000,
    );
    const objectKey = exportObjectKey(context.userId, input.resourceId);
    await this.dependencies.database.client.begin(async (transaction) => {
      // Hold Identity's existing shared lease through both external publication and its
      // metadata commit. Quarantine either wins before this lease, or deletion sees
      // the exact version published here; no put can follow a completed deletion.
      await transaction`SELECT identity.require_active_candidate(${context.userId}::uuid)`;
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
          typeof row.artifactObjectVersion !== "string" ||
          !row.artifactObjectVersion ||
          row.artifactSha256 !== sha256
        ) {
          throw new CandidateRightsActivityRejected("CandidateExportArtifactConflict");
        }
        return;
      }
      if (current.state !== "building") {
        throw new CandidateRightsActivityRejected("CandidateExportStateConflict");
      }
      const stored = await this.dependencies.artifactStore.putIfAbsent({
        objectKey,
        body,
        sha256,
        expiresAt,
      });
      if (!stored.objectVersion) {
        throw new CandidateRightsActivityRejected("CandidateExportArtifactVersionMissing");
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
      const exports = await transaction<
        Array<{ id: string; state: string; objectKey: string | null; objectVersion: string | null }>
      >`
        SELECT id, state, artifact_object_key AS "objectKey",
               artifact_object_version AS "objectVersion"
        FROM profile.candidate_data_exports
        WHERE user_id = ${context.userId}::uuid
        ORDER BY id FOR UPDATE
      `;
      for (const item of exports) {
        const objectKey = exportObjectKey(context.userId, item.id);
        if (
          !isUuid(item.id) ||
          (item.state === "ready" &&
            (item.objectKey !== objectKey || !item.objectVersion || item.objectVersion === "null"))
        ) {
          throw new CandidateRightsActivityRejected("CandidateExportMaintenanceIdentityRejected");
        }
        const { artifactStore } = this.dependencies;
        if (!artifactStore.deleteExactVersion || !artifactStore.inventoryExactKey) {
          throw new CandidateRightsActivityRejected("CandidateExportMaintenanceUnavailable");
        }
        // Deterministic keys also recover a successful put whose SQL commit/ack failed:
        // queued/building/failed rows can own an unrecorded remote version.
        const inventory = await artifactStore.inventoryExactKey(objectKey);
        if (
          item.state === "ready" &&
          !inventory.some((version) => version.objectVersion === item.objectVersion)
        ) {
          inventory.push({ objectVersion: item.objectVersion as string, deleteMarker: false });
        }
        for (const version of inventory) {
          const absent = await artifactStore.deleteExactVersion(
            objectKey,
            version.objectVersion,
            version.deleteMarker,
          );
          if (!absent)
            throw new CandidateRightsActivityRejected("CandidateExportArtifactStillPresent");
        }
        if ((await artifactStore.inventoryExactKey(objectKey)).length !== 0) {
          throw new CandidateRightsActivityRejected("CandidateExportArtifactStillPresent");
        }
      }
      // Keep every locator until the entire exact-version cleanup succeeds. A partial
      // failure rolls back these transitions and the next attempt repeats safe deletes.
      await transaction`
        UPDATE profile.candidate_data_exports
        SET state = 'expired', artifact_object_key = NULL, artifact_object_version = NULL,
            artifact_sha256 = NULL, updated_at = ${now}::timestamptz
        WHERE user_id = ${context.userId}::uuid AND state = 'ready'
      `;
      await transaction`
        UPDATE profile.candidate_data_exports
        SET state = 'failed', failure_code = 'owner_unavailable', updated_at = ${now}::timestamptz
        WHERE user_id = ${context.userId}::uuid AND state IN ('queued', 'building')
      `;
      await transaction`
        UPDATE platform.operations SET state = 'failed', result = NULL,
          error_code = 'CandidateDataExportFailed', updated_at = ${now}::timestamptz
        WHERE kind = 'candidate_data_export' AND id IN (
          SELECT operation_id FROM profile.candidate_data_exports
          WHERE user_id = ${context.userId}::uuid AND state = 'failed'
        ) AND state IN ('queued', 'running', 'retryable_failure')
      `;
      if (this.includesNotifications) {
        await transaction`SELECT notifications.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      }
      if (this.includesApplications) {
        await transaction`SELECT applications.delete_candidate_data(${context.userId}::uuid, ${input.resourceId}::uuid)`;
      }
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

  /**
   * Finishes candidate deletions of resumes (ADR-034). For each tombstone the Documents function names as ready: retire the
   * unreviewed Profile proposals, remove every object version and marker under the resume's prefixes, and only when a second
   * listing is empty ask Documents to remove the row and its entries. Every step is idempotent, so a failure leaves the
   * database as it was and the next sweep retries. One failing tombstone does not stop the others; the caller decides what
   * a nonzero `failed` means. Reports counts only.
   */
  async purgeDeletedResumes(
    limit = 25,
  ): Promise<{ scanned: number; purged: number; failed: number; heldWaiting: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CandidateRightsActivityRejected("ResumePurgeLimitRejected");
    }
    const { documentObjectStore, resumeProposals } = this.dependencies;
    if (!documentObjectStore.purgeDocumentPrefixes || !resumeProposals) {
      throw new CandidateRightsActivityRejected("ResumePurgeUnavailable");
    }
    const client = this.dependencies.database.client;
    const rows = await client<Array<{ data: unknown }>>`
      SELECT documents.pending_resume_purges(${limit}) AS data
    `;
    const data = rows[0]?.data;
    if (
      !isRecord(data) ||
      !Array.isArray(data.eligible) ||
      !Number.isSafeInteger(data.heldWaiting)
    ) {
      throw new CandidateRightsActivityRejected("ResumePurgeInventoryInvalid");
    }
    const due = data.eligible.map((item) => {
      if (!isRecord(item) || !isUuid(String(item.userId)) || !isUuid(String(item.documentId))) {
        throw new CandidateRightsActivityRejected("ResumePurgeInventoryInvalid");
      }
      return { userId: String(item.userId), documentId: String(item.documentId) };
    });
    let purged = 0;
    let failed = 0;
    for (const { userId, documentId } of due) {
      let step = "retire_proposals";
      try {
        await client.begin((transaction) =>
          resumeProposals.retireDocumentProposals(transaction, {
            userId,
            documentId,
            traceId: "resume-purge",
          }),
        );
        step = "purge_objects";
        const objects = await documentObjectStore.purgeDocumentPrefixes(documentId);
        if (objects.remaining !== 0) {
          throw new CandidateRightsActivityRejected("ResumePurgeObjectsRemain");
        }
        step = "complete_purge";
        type PurgeRows = Array<{
          data: {
            purged?: unknown;
            reason?: unknown;
            unsettled?: unknown;
            proofTasks?: unknown;
            nativeGenerationsSettledTaskAbsent?: unknown;
          };
        }>;
        const complete = async (absentTasks: readonly string[]) => {
          // Without evidence the three-argument function is called, so this also runs before migration 0021.
          const completed =
            absentTasks.length === 0
              ? await client<PurgeRows>`
                  SELECT documents.complete_resume_purge(${userId}::uuid, ${documentId}::uuid, true) AS data
                `
              : await client<PurgeRows>`
                  SELECT documents.complete_resume_purge(
                    ${userId}::uuid, ${documentId}::uuid, true, ${[...absentTasks]}::text[]
                  ) AS data
                `;
          return completed[0]?.data;
        };
        let outcome = await complete([]);
        const observer = this.dependencies.nativeTaskAbsence;
        let checkedTasks = 0;
        let absentTasks = 0;
        if (outcome?.reason === "native_generation_unsettled") {
          // A generation bound to a task can only be settled by that task's own description, and ECS drops a
          // stopped task's description after about an hour. Documents names the bound tasks old enough to ask
          // about; the ones ECS shows are gone go back to Documents, which applies its own checks and settles
          // them in the purge transaction. Anything unproven stays blocked.
          const candidates = boundTaskArns(outcome.proofTasks);
          checkedTasks = candidates.length;
          if (observer && candidates.length > 0) {
            step = "observe_native_tasks";
            const gone = await observer.absent(candidates);
            const absent = candidates.filter((arn) => gone.has(arn));
            absentTasks = absent.length;
            step = "complete_purge";
            if (absent.length > 0) outcome = await complete(absent);
          }
        }
        if (outcome?.purged === true) {
          purged += 1;
          if (typeof outcome.nativeGenerationsSettledTaskAbsent === "number") {
            console.info({
              event: "resume_purge_native_task_absent",
              settled: outcome.nativeGenerationsSettledTaskAbsent,
            });
          }
        } else if (outcome?.reason === "native_generation_unsettled") {
          // Documents settled what it safely could and found a generation built from this resume that nothing
          // has proven settled. Nothing was deleted. It still counts as a failure, so the alarm stays, but the
          // log says what blocks it: states, booleans and counts only, never an identifier.
          failed += 1;
          console.error({
            event: "resume_purge_blocked",
            step,
            reason: "native_generation_unsettled",
            unsettled: unsettledGenerations(outcome.unsettled),
            boundTasksOldEnoughToCheck: checkedTasks,
            taskObserverConfigured: observer !== undefined,
            tasksShownGone: absentTasks,
          });
        }
      } catch (error) {
        failed += 1;
        console.error({ event: "resume_purge_failed", step, ...resumePurgeFailureFields(error) });
      }
    }
    return { scanned: due.length, purged, failed, heldWaiting: data.heldWaiting as number };
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
