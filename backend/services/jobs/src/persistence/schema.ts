import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  DuplicateClassification,
  DuplicateResolution,
  JobEmploymentType,
  JobProvenance,
  JobSourceProvider,
  JobStatus,
  JobWorkMode,
} from "../domain/canonical-job.js";

const jobs = pgSchema("jobs");
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const catalogSearchState = jobs.table(
  "catalog_search_state",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
  },
  (table) => [
    check("catalog_search_state_singleton_ck", sql`${table.singleton}`),
    check("catalog_search_state_revision_ck", sql`${table.revision} > 0`),
  ],
);

export const companies = jobs.table(
  "companies",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    verifiedDomain: text("verified_domain"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("companies_normalized_name_idx").on(table.normalizedName)],
);

export const canonicalJobs = jobs.table(
  "canonical_jobs",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    locations: jsonb("locations").$type<string[]>().notNull(),
    normalizedLocations: text("normalized_locations").array().notNull(),
    department: text("department"),
    normalizedDepartment: text("normalized_department"),
    workMode: text("work_mode").$type<JobWorkMode>(),
    employmentType: text("employment_type").$type<JobEmploymentType>(),
    description: text("description"),
    descriptionHash: text("description_hash"),
    dedupeFingerprint: text("dedupe_fingerprint").notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    statusReason: text("status_reason"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    validThrough: timestamp("valid_through", { withTimezone: true }),
    consecutiveVerificationFailures: integer("consecutive_verification_failures")
      .notNull()
      .default(0),
    searchDocument: tsvector("search_document")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
          setweight(to_tsvector('simple'::regconfig, coalesce(department, '')), 'B') ||
          setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'C')`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("canonical_jobs_company_title_idx").on(table.companyId, table.normalizedTitle),
    index("canonical_jobs_status_expires_idx").on(table.status, table.expiresAt),
    index("canonical_jobs_dedupe_fingerprint_idx").on(table.dedupeFingerprint),
    check(
      "canonical_jobs_status_ck",
      sql`${table.status} IN ('pending', 'active', 'suspect_stale', 'expired', 'withdrawn', 'blocked')`,
    ),
    check(
      "canonical_jobs_live_description_ck",
      sql`${table.status} IN ('expired', 'withdrawn', 'blocked') OR ${table.description} IS NOT NULL`,
    ),
    check("canonical_jobs_failure_count_ck", sql`${table.consecutiveVerificationFailures} >= 0`),
    check(
      "canonical_jobs_work_mode_ck",
      sql`${table.workMode} IS NULL OR ${table.workMode} IN ('remote', 'hybrid', 'on_site', 'unknown')`,
    ),
    check(
      "canonical_jobs_employment_type_ck",
      sql`${table.employmentType} IS NULL OR ${table.employmentType} IN ('full_time', 'part_time', 'contract', 'internship', 'unknown')`,
    ),
  ],
);

export const jobSources = jobs.table(
  "job_sources",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    provider: text("provider").$type<JobSourceProvider>().notNull(),
    provenance: text("provenance").$type<JobProvenance>().notNull(),
    atsTenant: text("ats_tenant"),
    externalJobId: text("external_job_id"),
    employerRequisitionId: text("employer_requisition_id"),
    verifiedCompanyDomain: text("verified_company_domain"),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    canonicalUrlHash: text("canonical_url_hash").notNull(),
    contentHash: text("content_hash").notNull(),
    adapterVersion: text("adapter_version"),
    rawSnapshot: jsonb("raw_snapshot").$type<Record<string, unknown>>(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
    validThrough: timestamp("valid_through", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("job_sources_job_id_idx").on(table.jobId),
    uniqueIndex("job_sources_ats_identity_uq")
      .on(table.provider, table.atsTenant, table.externalJobId)
      .where(sql`${table.atsTenant} IS NOT NULL AND ${table.externalJobId} IS NOT NULL`),
    uniqueIndex("job_sources_requisition_identity_uq")
      .on(table.verifiedCompanyDomain, table.employerRequisitionId)
      .where(
        sql`${table.verifiedCompanyDomain} IS NOT NULL AND ${table.employerRequisitionId} IS NOT NULL`,
      ),
    uniqueIndex("job_sources_canonical_url_hash_uq").on(table.canonicalUrlHash),
    check(
      "job_sources_provider_ck",
      sql`${table.provider} IN ('greenhouse', 'lever', 'ashby', 'workday', 'ugc', 'other')`,
    ),
    check(
      "job_sources_provenance_ck",
      sql`${table.provenance} IN ('permitted_api', 'authorized_fixture', 'explicit_ugc')`,
    ),
  ],
);

export const duplicateCandidates = jobs.table(
  "duplicate_candidates",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    candidateJobId: uuid("candidate_job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    classification: text("classification").$type<DuplicateClassification>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolution: text("resolution").$type<DuplicateResolution>(),
    canonicalJobId: uuid("canonical_job_id").references(() => canonicalJobs.id),
    reviewedBy: text("reviewed_by"),
    reviewReasonCode: text("review_reason_code"),
    resolutionVersion: integer("resolution_version").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.candidateJobId] }),
    check(
      "duplicate_candidates_order_ck",
      sql`${table.jobId}::text < ${table.candidateJobId}::text`,
    ),
    check(
      "duplicate_candidates_classification_ck",
      sql`${table.classification} IN ('exact', 'probable', 'related_repost', 'not_duplicate')`,
    ),
    check(
      "duplicate_candidates_resolution_ck",
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('exact', 'related_repost', 'not_duplicate')`,
    ),
    check(
      "duplicate_candidates_review_state_ck",
      sql`(
        ${table.resolution} IS NULL AND ${table.reviewedAt} IS NULL
        AND ${table.reviewedBy} IS NULL AND ${table.reviewReasonCode} IS NULL
        AND ${table.canonicalJobId} IS NULL
      ) OR (
        ${table.resolution} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL
        AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewReasonCode} IS NOT NULL
      )`,
    ),
    check(
      "duplicate_candidates_canonical_member_ck",
      sql`(
        ${table.resolution} = 'exact'
        AND ${table.canonicalJobId} IS NOT NULL
        AND ${table.canonicalJobId} IN (${table.jobId}, ${table.candidateJobId})
      ) OR (
        ${table.resolution} IS DISTINCT FROM 'exact' AND ${table.canonicalJobId} IS NULL
      )`,
    ),
    check(
      "duplicate_candidates_reviewer_ck",
      sql`${table.reviewedBy} IS NULL OR (
        ${table.reviewedBy} = btrim(${table.reviewedBy})
        AND char_length(${table.reviewedBy}) BETWEEN 3 AND 200
        AND ${table.reviewedBy} ~ '^[A-Za-z0-9:_-]+$'
      )`,
    ),
    check(
      "duplicate_candidates_reason_code_ck",
      sql`${table.reviewReasonCode} IS NULL OR (
        char_length(${table.reviewReasonCode}) BETWEEN 3 AND 100
        AND ${table.reviewReasonCode} ~ '^[a-z0-9][a-z0-9_.:-]+$'
      )`,
    ),
    check("duplicate_candidates_resolution_version_ck", sql`${table.resolutionVersion} >= 0`),
    uniqueIndex("duplicate_candidates_exact_loser_uq")
      .on(
        sql`(CASE WHEN ${table.canonicalJobId} = ${table.jobId} THEN ${table.candidateJobId} ELSE ${table.jobId} END)`,
      )
      .where(sql`${table.resolution} = 'exact'`),
  ],
);

export const duplicateResolutionEvents = jobs.table(
  "duplicate_resolution_events",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id").notNull(),
    candidateJobId: uuid("candidate_job_id").notNull(),
    previousResolution: text("previous_resolution").$type<DuplicateResolution>(),
    previousCanonicalJobId: uuid("previous_canonical_job_id").references(() => canonicalJobs.id),
    resolution: text("resolution").$type<DuplicateResolution>(),
    canonicalJobId: uuid("canonical_job_id").references(() => canonicalJobs.id),
    reviewedBy: text("reviewed_by").notNull(),
    reasonCode: text("reason_code").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    resolutionVersion: integer("resolution_version").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.jobId, table.candidateJobId],
      foreignColumns: [duplicateCandidates.jobId, duplicateCandidates.candidateJobId],
    }).onDelete("cascade"),
    index("duplicate_resolution_events_pair_occurred_idx").on(
      table.jobId,
      table.candidateJobId,
      table.occurredAt,
      table.id,
    ),
    uniqueIndex("duplicate_resolution_events_pair_version_uq").on(
      table.jobId,
      table.candidateJobId,
      table.resolutionVersion,
    ),
    check(
      "duplicate_resolution_events_resolution_ck",
      sql`${table.previousResolution} IS NULL OR ${table.previousResolution} IN ('exact', 'related_repost', 'not_duplicate')`,
    ),
    check(
      "duplicate_resolution_events_next_resolution_ck",
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('exact', 'related_repost', 'not_duplicate')`,
    ),
    check(
      "duplicate_resolution_events_previous_canonical_ck",
      sql`(
        ${table.previousResolution} = 'exact'
        AND ${table.previousCanonicalJobId} IS NOT NULL
        AND ${table.previousCanonicalJobId} IN (${table.jobId}, ${table.candidateJobId})
      ) OR (
        ${table.previousResolution} IS DISTINCT FROM 'exact'
        AND ${table.previousCanonicalJobId} IS NULL
      )`,
    ),
    check(
      "duplicate_resolution_events_canonical_ck",
      sql`(
        ${table.resolution} = 'exact'
        AND ${table.canonicalJobId} IS NOT NULL
        AND ${table.canonicalJobId} IN (${table.jobId}, ${table.candidateJobId})
      ) OR (
        ${table.resolution} IS DISTINCT FROM 'exact' AND ${table.canonicalJobId} IS NULL
      )`,
    ),
    check(
      "duplicate_resolution_events_reviewer_ck",
      sql`${table.reviewedBy} = btrim(${table.reviewedBy})
        AND char_length(${table.reviewedBy}) BETWEEN 3 AND 200
        AND ${table.reviewedBy} ~ '^[A-Za-z0-9:_-]+$'`,
    ),
    check(
      "duplicate_resolution_events_reason_code_ck",
      sql`char_length(${table.reasonCode}) BETWEEN 3 AND 100
        AND ${table.reasonCode} ~ '^[a-z0-9][a-z0-9_.:-]+$'`,
    ),
    check("duplicate_resolution_events_version_ck", sql`${table.resolutionVersion} > 0`),
  ],
);

export const statusEvents = jobs.table(
  "status_events",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<JobStatus>(),
    toStatus: text("to_status").$type<JobStatus>().notNull(),
    reason: text("reason").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("status_events_job_occurred_idx").on(table.jobId, table.occurredAt)],
);

export const ingestionCheckpoints = jobs.table(
  "ingestion_checkpoints",
  {
    executionId: text("execution_id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    sourceId: text("source_id").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    attempt: integer("attempt").notNull(),
    withdrawalInferred: boolean("withdrawal_inferred").notNull(),
    leaseId: uuid("lease_id"),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    priorProgressUnknown: boolean("prior_progress_unknown"),
    settledAttempt: integer("settled_attempt"),
    settledLeaseId: uuid("settled_lease_id"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settlementKey: text("settlement_key"),
    progressKnown: boolean("progress_known"),
    observationCount: integer("observation_count"),
    createdCount: integer("created_count"),
    updatedCount: integer("updated_count"),
    retryReason: text("retry_reason"),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    pauseReason: text("pause_reason"),
    failureCode: text("failure_code"),
    exhaustedDispatchId: uuid("exhausted_dispatch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ingestion_checkpoints_due_idx").on(
      table.state,
      table.retryAt,
      table.leaseExpiresAt,
      table.executionId,
    ),
  ],
);

export const ingestionRunEvents = jobs.table(
  "ingestion_run_events",
  {
    executionId: text("execution_id")
      .notNull()
      .references(() => ingestionCheckpoints.executionId),
    revision: bigint("revision", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    attempt: integer("attempt").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.revision] }),
    index("ingestion_run_events_occurred_idx").on(
      table.occurredAt,
      table.executionId,
      table.revision,
    ),
  ],
);

export const ingestionDispatches = jobs.table(
  "ingestion_dispatches",
  {
    id: uuid("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => ingestionCheckpoints.executionId),
    generation: integer("generation").notNull(),
    checkpointRevision: bigint("checkpoint_revision", { mode: "number" }).notNull(),
    durableExecutionName: text("durable_execution_name").notNull(),
    durableFunctionArn: text("durable_function_arn").notNull(),
    activityFunctionArn: text("activity_function_arn").notNull(),
    adapterConfigSha256: text("adapter_config_sha256").notNull(),
    state: text("state").notNull(),
    claimId: uuid("claim_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    durableExecutionArn: text("durable_execution_arn"),
    durableExecutionId: text("durable_execution_id"),
    terminalStatus: text("terminal_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ingestion_dispatches_execution_generation_uq").on(
      table.executionId,
      table.generation,
    ),
    uniqueIndex("ingestion_dispatches_durable_name_uq").on(table.durableExecutionName),
    foreignKey({
      columns: [table.executionId, table.checkpointRevision],
      foreignColumns: [ingestionRunEvents.executionId, ingestionRunEvents.revision],
    }),
    index("ingestion_dispatches_pending_idx").on(table.nextAttemptAt, table.createdAt, table.id),
  ],
);
