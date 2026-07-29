import {
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

export const users = identity.table("users", {
  id: uuid("id").primaryKey(),
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

export type OperationState = "queued" | "running" | "succeeded" | "retryable_failure" | "failed";

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
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [index("outbox_events_pending_idx").on(table.publishedAt, table.createdAt)],
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
