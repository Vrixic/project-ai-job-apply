import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type CreateJobReportCommand,
  JobAlreadyReportedError,
  type JobModerationStore,
  type JobReport,
  JobReportIdempotencyConflictError,
  JobReportLimitError,
  type JobReportReason,
  type JobReportStore,
  type JobReportSummary,
  JobReportTargetUnavailableError,
  jobReportReasons,
  type ModerationCase,
  ModerationConflictError,
  type ModerationOpenReason,
  type ModerationResolution,
  type ModerationResolutionReason,
  type ModerationTarget,
  ModerationTargetUnavailableError,
} from "../reporting.js";

const MAXIMUM_REPORTS_PER_OWNER = 1_000;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ADAPTER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OPERATOR_PATTERN = /^[A-Za-z0-9:_-]{3,200}$/;

interface JobReportRow {
  id: string;
  requestedJobId: string;
  canonicalJobId: string;
  reason: JobReportReason;
  requestHash: string;
  createdAt: Date;
}

interface ModerationCaseRow {
  id: string;
  targetKind: "job" | "source";
  jobId: string | null;
  sourceId: string | null;
  adapterVersion: string | null;
  adapterConfigSha256: string | null;
  status: "open" | "resolved";
  resolution: ModerationResolution | null;
  version: 0 | 1;
  openedBy: string;
  openReasonCode: ModerationOpenReason;
  openedAt: Date;
  resolvedBy: string | null;
  resolutionReasonCode: ModerationResolutionReason | null;
  resolvedAt: Date | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestHash(requestedJobId: string, reason: JobReportReason): string {
  return sha256(JSON.stringify([requestedJobId, reason]));
}

function report(row: JobReportRow): JobReport {
  return Object.freeze({
    id: row.id,
    requestedJobId: row.requestedJobId,
    canonicalJobId: row.canonicalJobId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  });
}

function moderationTarget(row: ModerationCaseRow): ModerationTarget {
  if (row.targetKind === "job" && row.jobId) {
    return Object.freeze({ kind: "job", jobId: row.jobId });
  }
  if (
    row.targetKind === "source" &&
    row.sourceId &&
    row.adapterVersion &&
    row.adapterConfigSha256
  ) {
    return Object.freeze({
      kind: "source",
      sourceId: row.sourceId,
      adapterVersion: row.adapterVersion,
      adapterConfigSha256: row.adapterConfigSha256,
    });
  }
  throw new Error("The moderation target row is malformed");
}

function moderationCase(row: ModerationCaseRow): ModerationCase {
  return Object.freeze({
    id: row.id,
    target: moderationTarget(row),
    status: row.status,
    version: row.version,
    openedBy: row.openedBy,
    openReasonCode: row.openReasonCode,
    openedAt: row.openedAt.toISOString(),
    ...(row.resolution ? { resolution: row.resolution } : {}),
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : {}),
    ...(row.resolutionReasonCode ? { resolutionReasonCode: row.resolutionReasonCode } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  });
}

function assertModerationTarget(target: ModerationTarget): void {
  if (target.kind === "job") {
    if (!UUID_V7_PATTERN.test(target.jobId)) {
      throw new TypeError("The moderated job identifier is invalid");
    }
    return;
  }
  if (
    !SOURCE_ID_PATTERN.test(target.sourceId) ||
    !ADAPTER_VERSION_PATTERN.test(target.adapterVersion) ||
    !SHA256_PATTERN.test(target.adapterConfigSha256)
  ) {
    throw new TypeError("The moderated source identity is invalid");
  }
}

function assertOperator(operatorId: string): void {
  if (!OPERATOR_PATTERN.test(operatorId)) {
    throw new TypeError("The moderation operator identifier is invalid");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "23505";
}

export class PostgresJobReportStore implements JobReportStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly maximumReportsPerOwner = MAXIMUM_REPORTS_PER_OWNER,
  ) {
    if (
      !Number.isInteger(maximumReportsPerOwner) ||
      maximumReportsPerOwner < 1 ||
      maximumReportsPerOwner > MAXIMUM_REPORTS_PER_OWNER
    ) {
      throw new RangeError("The retained job-report limit is invalid");
    }
  }

  async ping(): Promise<void> {
    const [result] = await this.client<{ ready: boolean }[]>`
      SELECT (
        to_regclass('jobs.job_reports') IS NOT NULL
        AND to_regclass('jobs.moderation_cases') IS NOT NULL
        AND to_regclass('jobs.moderation_events') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jobs.schema_migrations
          WHERE version = '0008_job_reporting_and_moderation'
        )
      ) AS ready
    `;
    if (!result?.ready) throw new Error("The Jobs reporting schema is unavailable");
  }

  async create(command: CreateJobReportCommand): Promise<JobReport> {
    const keyHash = sha256(command.idempotencyKey);
    const commandHash = requestHash(command.requestedJobId, command.reason);
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:report:${command.ownerUserId}`}))
      `;
      const [replay] = await transaction<JobReportRow[]>`
        SELECT id, requested_job_id AS "requestedJobId",
          canonical_job_id AS "canonicalJobId", reason,
          request_hash AS "requestHash", created_at AS "createdAt"
        FROM jobs.job_reports
        WHERE reporter_user_id = ${command.ownerUserId}
          AND idempotency_key_hash = ${keyHash}
      `;
      if (replay) {
        if (replay.requestHash !== commandHash) {
          throw new JobReportIdempotencyConflictError();
        }
        return report(replay);
      }

      const [usage] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM jobs.job_reports
        WHERE reporter_user_id = ${command.ownerUserId}
      `;
      if (Number(usage?.count ?? 0) >= this.maximumReportsPerOwner) {
        throw new JobReportLimitError();
      }

      const [target] = await transaction<{ canonicalJobId: string; occurredAt: Date }[]>`
        WITH RECURSIVE boundary AS (
          SELECT clock_timestamp() AS occurred_at
        ), resolution(id, path) AS (
          SELECT ${command.requestedJobId}::uuid, ARRAY[${command.requestedJobId}::uuid]
          UNION ALL
          SELECT duplicate.canonical_job_id, resolution.path || duplicate.canonical_job_id
          FROM resolution
          INNER JOIN jobs.duplicate_candidates AS duplicate
            ON duplicate.resolution = 'exact'
            AND CASE
              WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
              ELSE duplicate.job_id
            END = resolution.id
          WHERE NOT duplicate.canonical_job_id = ANY(resolution.path)
        ), canonical AS (
          SELECT id FROM resolution ORDER BY cardinality(path) DESC LIMIT 1
        )
        SELECT job.id AS "canonicalJobId", boundary.occurred_at AS "occurredAt"
        FROM canonical
        INNER JOIN jobs.canonical_jobs AS job ON job.id = canonical.id
        CROSS JOIN boundary
        WHERE job.status = 'active'
          AND job.expires_at > boundary.occurred_at
          AND (job.valid_through IS NULL OR job.valid_through > boundary.occurred_at)
          AND job.description IS NOT NULL
          AND btrim(job.description) <> ''
        FOR SHARE OF job
      `;
      if (!target) throw new JobReportTargetUnavailableError();

      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM jobs.job_reports
        WHERE reporter_user_id = ${command.ownerUserId}
          AND canonical_job_id = ${target.canonicalJobId}
      `;
      if (existing) throw new JobAlreadyReportedError();

      const [inserted] = await transaction<JobReportRow[]>`
        INSERT INTO jobs.job_reports (
          id, reporter_user_id, requested_job_id, canonical_job_id, reason,
          idempotency_key_hash, request_hash, created_at
        ) VALUES (
          ${uuidv7()}, ${command.ownerUserId}, ${command.requestedJobId},
          ${target.canonicalJobId}, ${command.reason}, ${keyHash}, ${commandHash},
          ${target.occurredAt}
        )
        RETURNING id, requested_job_id AS "requestedJobId",
          canonical_job_id AS "canonicalJobId", reason,
          request_hash AS "requestHash", created_at AS "createdAt"
      `;
      if (!inserted) throw new Error("The job report insert returned no row");
      return report(inserted);
    });
  }
}

export class PostgresJobModerationStore implements JobModerationStore {
  constructor(private readonly client: postgres.Sql) {}

  async openCase(input: {
    target: ModerationTarget;
    operatorId: string;
    reasonCode: ModerationOpenReason;
  }): Promise<ModerationCase> {
    assertModerationTarget(input.target);
    assertOperator(input.operatorId);
    try {
      const [row] = await this.client<ModerationCaseRow[]>`
        WITH boundary AS (SELECT clock_timestamp() AS occurred_at)
        INSERT INTO jobs.moderation_cases (
          id, target_kind, job_id, source_id, adapter_version, adapter_config_sha256,
          status, resolution, version, opened_by, open_reason_code, opened_at,
          resolved_by, resolution_reason_code, resolved_at
        )
        SELECT ${uuidv7()}, ${input.target.kind},
          ${input.target.kind === "job" ? input.target.jobId : null},
          ${input.target.kind === "source" ? input.target.sourceId : null},
          ${input.target.kind === "source" ? input.target.adapterVersion : null},
          ${input.target.kind === "source" ? input.target.adapterConfigSha256 : null},
          'open', NULL, 0, ${input.operatorId}, ${input.reasonCode}, boundary.occurred_at,
          NULL, NULL, NULL
        FROM boundary
        WHERE ${input.target.kind} = 'source'
          OR EXISTS (
            SELECT 1 FROM jobs.canonical_jobs
            WHERE id = ${input.target.kind === "job" ? input.target.jobId : null}
          )
        RETURNING id, target_kind AS "targetKind", job_id AS "jobId",
          source_id AS "sourceId", adapter_version AS "adapterVersion",
          adapter_config_sha256 AS "adapterConfigSha256", status, resolution, version,
          opened_by AS "openedBy", open_reason_code AS "openReasonCode",
          opened_at AS "openedAt", resolved_by AS "resolvedBy",
          resolution_reason_code AS "resolutionReasonCode", resolved_at AS "resolvedAt"
      `;
      if (!row) throw new ModerationTargetUnavailableError();
      return moderationCase(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ModerationConflictError("A case is already open");
      throw error;
    }
  }

  async resolveCase(input: {
    caseId: string;
    expectedVersion: 0;
    resolution: ModerationResolution;
    operatorId: string;
    reasonCode: ModerationResolutionReason;
  }): Promise<ModerationCase> {
    if (!UUID_V7_PATTERN.test(input.caseId) || input.expectedVersion !== 0) {
      throw new TypeError("The moderation case version identity is invalid");
    }
    assertOperator(input.operatorId);
    return this.client.begin(async (transaction) => {
      const [current] = await transaction<ModerationCaseRow[]>`
        SELECT id, target_kind AS "targetKind", job_id AS "jobId",
          source_id AS "sourceId", adapter_version AS "adapterVersion",
          adapter_config_sha256 AS "adapterConfigSha256", status, resolution, version,
          opened_by AS "openedBy", open_reason_code AS "openReasonCode",
          opened_at AS "openedAt", resolved_by AS "resolvedBy",
          resolution_reason_code AS "resolutionReasonCode", resolved_at AS "resolvedAt"
        FROM jobs.moderation_cases
        WHERE id = ${input.caseId}
        FOR UPDATE
      `;
      if (!current) throw new ModerationTargetUnavailableError();
      if (current.status !== "open" || current.version !== input.expectedVersion) {
        throw new ModerationConflictError();
      }
      if (
        (input.resolution === "block_job" && current.targetKind !== "job") ||
        (input.resolution === "pause_source" && current.targetKind !== "source")
      ) {
        throw new TypeError("The moderation resolution does not match its target");
      }
      const [resolved] = await transaction<ModerationCaseRow[]>`
        WITH boundary AS (SELECT clock_timestamp() AS occurred_at)
        UPDATE jobs.moderation_cases
        SET status = 'resolved', resolution = ${input.resolution}, version = 1,
          resolved_by = ${input.operatorId}, resolution_reason_code = ${input.reasonCode},
          resolved_at = boundary.occurred_at
        FROM boundary
        WHERE id = ${input.caseId} AND status = 'open' AND version = 0
        RETURNING jobs.moderation_cases.id,
          jobs.moderation_cases.target_kind AS "targetKind",
          jobs.moderation_cases.job_id AS "jobId",
          jobs.moderation_cases.source_id AS "sourceId",
          jobs.moderation_cases.adapter_version AS "adapterVersion",
          jobs.moderation_cases.adapter_config_sha256 AS "adapterConfigSha256",
          jobs.moderation_cases.status, jobs.moderation_cases.resolution,
          jobs.moderation_cases.version, jobs.moderation_cases.opened_by AS "openedBy",
          jobs.moderation_cases.open_reason_code AS "openReasonCode",
          jobs.moderation_cases.opened_at AS "openedAt",
          jobs.moderation_cases.resolved_by AS "resolvedBy",
          jobs.moderation_cases.resolution_reason_code AS "resolutionReasonCode",
          jobs.moderation_cases.resolved_at AS "resolvedAt"
      `;
      if (!resolved) throw new ModerationConflictError();
      return moderationCase(resolved);
    });
  }

  async summarizeReports(canonicalJobId: string): Promise<JobReportSummary> {
    if (!UUID_V7_PATTERN.test(canonicalJobId)) {
      throw new TypeError("The summarized job identifier is invalid");
    }
    const rows = await this.client<{ reason: JobReportReason; count: string }[]>`
      SELECT reason, count(*)::text AS count
      FROM jobs.job_reports
      WHERE canonical_job_id = ${canonicalJobId}
      GROUP BY reason
    `;
    const counts = Object.fromEntries(jobReportReasons.map((reason) => [reason, 0])) as Record<
      JobReportReason,
      number
    >;
    for (const row of rows) counts[row.reason] = Number(row.count);
    return Object.freeze({
      canonicalJobId,
      total: Object.values(counts).reduce((total, count) => total + count, 0),
      counts: Object.freeze(counts),
    });
  }

  async isSourcePaused(target: Extract<ModerationTarget, { kind: "source" }>): Promise<boolean> {
    assertModerationTarget(target);
    const [row] = await this.client<{ paused: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM jobs.moderation_cases
        WHERE target_kind = 'source'
          AND source_id = ${target.sourceId}
          AND adapter_version = ${target.adapterVersion}
          AND adapter_config_sha256 = ${target.adapterConfigSha256}
          AND status = 'resolved'
          AND resolution = 'pause_source'
      ) AS paused
    `;
    return row?.paused === true;
  }
}
