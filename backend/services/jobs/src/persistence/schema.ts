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
  JobProvenance,
  JobSourceProvider,
  JobStatus,
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
