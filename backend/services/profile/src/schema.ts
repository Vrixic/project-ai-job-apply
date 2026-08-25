import { sql } from "drizzle-orm";
import {
  date,
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

const identity = pgSchema("identity");
const profile = pgSchema("profile");
const platform = pgSchema("platform");
const privacy = pgSchema("privacy");

export const users = identity.table("users", {
  id: uuid("id").primaryKey(),
  accountState: text("account_state").$type<"active" | "quarantined">().notNull().default("active"),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const externalIdentities = identity.table(
  "external_identities",
  {
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.issuer, table.subject] }),
    index("external_identities_user_id_idx").on(table.userId),
  ],
);

export interface StoredPreferences {
  targetRoles: string[];
  locations: string[];
  workModes: Array<"remote" | "hybrid" | "on_site">;
  employmentTypes: Array<"full_time" | "part_time" | "contract" | "internship">;
  salaryMinimum?: number;
  salaryCurrency?: string;
  requiresSponsorship?: boolean;
}

export const jobPreferences = profile.table(
  "job_preferences",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    preferences: jsonb("preferences").$type<StoredPreferences>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("job_preferences_user_id_uq").on(table.userId)],
);

export type StoredProfileFactKind =
  | "identity"
  | "employment"
  | "education"
  | "project"
  | "skill"
  | "certification"
  | "preference";
export type StoredProfileFactValue = string | number | boolean | string[];
export type StoredProfileFactVerification = "proposed" | "confirmed" | "rejected";
export type StoredProfileFactAvailability = "available" | "invalidated";
export type StoredProfileFactSensitivity = "standard" | "confidential" | "restricted";
export type StoredProfileFactSourceType = "user" | "resume" | "import" | "derived";

export const profileFacts = profile.table(
  "profile_facts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_facts_user_created_idx").on(table.userId, table.createdAt, table.id)],
);

export const profileFactVersions = profile.table(
  "profile_fact_versions",
  {
    factId: uuid("fact_id")
      .notNull()
      .references(() => profileFacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kind: text("kind").$type<StoredProfileFactKind>().notNull(),
    key: text("fact_key").notNull(),
    value: jsonb("fact_value").$type<StoredProfileFactValue>().notNull(),
    verification: text("verification").$type<StoredProfileFactVerification>().notNull(),
    availabilityState: text("availability_state")
      .$type<StoredProfileFactAvailability>()
      .notNull()
      .default("available"),
    availabilityReason: text("availability_reason").$type<"source_security_hold">(),
    sensitivity: text("sensitivity").$type<StoredProfileFactSensitivity>().notNull(),
    sourceType: text("source_type").$type<StoredProfileFactSourceType>().notNull(),
    sourceReference: text("source_reference").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.factId, table.version] }),
    index("profile_fact_versions_latest_idx").on(table.factId, table.version),
  ],
);

export const resumeFactImports = profile.table(
  "resume_fact_imports",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    documentVersion: integer("document_version").notNull(),
    parserVersion: text("parser_version").notNull(),
    proposalDigest: text("proposal_digest").notNull(),
    proposalCount: integer("proposal_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resume_fact_import_identity_uq").on(
      table.userId,
      table.documentId,
      table.documentVersion,
      table.parserVersion,
    ),
  ],
);

export type CandidateDataExportState = "queued" | "building" | "ready" | "expired" | "failed";
export type CandidateDataExportFailureCode =
  | "owner_unavailable"
  | "inventory_incomplete"
  | "artifact_write_failed";

export const candidateDataExports = profile.table(
  "candidate_data_exports",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    format: text("format").$type<"candidate-data-export-v1">().notNull(),
    policyVersion: text("policy_version").notNull(),
    state: text("state").$type<CandidateDataExportState>().notNull(),
    artifactObjectKey: text("artifact_object_key"),
    artifactObjectVersion: text("artifact_object_version"),
    artifactSha256: text("artifact_sha256"),
    artifactExpiresAt: timestamp("artifact_expires_at", { withTimezone: true }),
    failureCode: text("failure_code").$type<CandidateDataExportFailureCode>(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("candidate_data_exports_user_requested_idx").on(
      table.userId,
      table.requestedAt,
      table.id,
    ),
    uniqueIndex("candidate_data_exports_operation_uq").on(table.operationId),
  ],
);

export type AccountDeletionState =
  | "requested"
  | "quarantined"
  | "active_systems_deleted"
  | "subprocessors_pending"
  | "completed"
  | "backup_expired";

export const accountDeletionRequests = profile.table(
  "account_deletion_requests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id"),
    policyVersion: text("policy_version").notNull(),
    state: text("state").$type<AccountDeletionState>().notNull(),
    version: integer("version").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }),
    backupExpiredAt: timestamp("backup_expired_at", { withTimezone: true }),
  },
  (table) => [
    index("account_deletion_requests_user_requested_idx").on(
      table.userId,
      table.requestedAt,
      table.id,
    ),
    uniqueIndex("account_deletion_requests_operation_uq")
      .on(table.operationId)
      .where(sql`${table.operationId} IS NOT NULL`),
  ],
);

export const accountDeletionLedger = privacy.table("account_deletion_ledger", {
  requestId: uuid("request_id").primaryKey(),
  subjectDigest: text("subject_digest").notNull(),
  policyVersion: text("policy_version").notNull(),
  policySha256: text("policy_sha256").notNull(),
  state: text("state").notNull(),
  ownerInventory: jsonb("owner_inventory").$type<Record<string, string>>().notNull(),
  subprocessorInventory: jsonb("subprocessor_inventory").$type<Record<string, string>>().notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }).notNull(),
  backupExpiredAt: timestamp("backup_expired_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const profileFactEvidence = profile.table(
  "profile_fact_evidence",
  {
    factId: uuid("fact_id").notNull(),
    factVersion: integer("fact_version").notNull(),
    ordinal: integer("ordinal").notNull(),
    documentId: uuid("document_id").notNull(),
    documentVersion: integer("document_version").notNull(),
    parserVersion: text("parser_version").notNull(),
    blockIndex: integer("block_index").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    page: integer("page"),
  },
  (table) => [primaryKey({ columns: [table.factId, table.factVersion, table.ordinal] })],
);

export type OperationState = "queued" | "running" | "succeeded" | "retryable_failure" | "failed";
export type OutboxDispatchTarget = "retired_legacy" | "lambda_durable";

export const operations = platform.table(
  "operations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    state: text("state").$type<OperationState>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("operations_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

export const outboxEvents = platform.table(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    subject: text("subject").notNull(),
    dataSchema: text("data_schema").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    traceparent: text("traceparent"),
    dispatchTarget: text("dispatch_target")
      .$type<OutboxDispatchTarget>()
      .notNull()
      .default("lambda_durable"),
    attempts: integer("attempts").notNull().default(0),
    nudgeAttempts: integer("nudge_attempts").notNull().default(0),
    nudgeClaimedAt: timestamp("nudge_claimed_at", { withTimezone: true }),
    nudgeNextAttemptAt: timestamp("nudge_next_attempt_at", { withTimezone: true }),
    nudgedAt: timestamp("nudged_at", { withTimezone: true }),
    nudgeLastErrorCode: text("nudge_last_error_code"),
    durableStartAttempts: integer("durable_start_attempts").notNull().default(0),
    durableStartedAt: timestamp("durable_started_at", { withTimezone: true }),
    durableExecutionName: text("durable_execution_name"),
    durableExecutionArn: text("durable_execution_arn"),
    durableLastErrorCode: text("durable_last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_events_pending_idx").on(table.publishedAt, table.createdAt),
    index("outbox_events_lambda_nudge_idx")
      .on(
        table.dispatchTarget,
        table.publishedAt,
        table.nudgeNextAttemptAt,
        table.nudgeClaimedAt,
        table.createdAt,
      )
      .where(sql`${table.dispatchTarget} = 'lambda_durable' AND ${table.publishedAt} IS NULL`),
    uniqueIndex("outbox_events_durable_execution_name_uq")
      .on(table.durableExecutionName)
      .where(sql`${table.durableExecutionName} IS NOT NULL`),
  ],
);

export const idempotencyKeys = platform.table(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.scope, table.key] })],
);

export const auditEvents = platform.table(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    traceId: text("trace_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_user_time_idx").on(table.userId, table.occurredAt)],
);
