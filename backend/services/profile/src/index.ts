import { createHash } from "node:crypto";
import type {
  CurrentUser,
  JobPreferenceSet,
  Operation,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { eventTypes, type ProfilePreferencesUpdatedData } from "@ai-job-apply/event-contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  auditEvents,
  externalIdentities,
  idempotencyKeys,
  jobPreferences,
  operations,
  outboxEvents,
  users,
} from "./schema.js";

export interface PendingOutboxEvent {
  id: string;
  type: string;
  subject: string;
  data: Record<string, unknown>;
  traceparent?: string;
}

export interface ProfileStore {
  resolveUser(principal: AuthPrincipal, traceId: string): Promise<CurrentUser>;
  getPreferences(userId: string): Promise<JobPreferenceSet | null>;
  putPreferences(
    userId: string,
    input: PutJobPreferencesRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<PutJobPreferencesResponse>;
  getOperation(userId: string, operationId: string): Promise<Operation | null>;
  getPendingOutboxEvents(limit: number): Promise<PendingOutboxEvent[]>;
  markOutboxPublished(eventId: string): Promise<void>;
  getPreferencesById(preferenceSetId: string): Promise<JobPreferenceSet | null>;
  markOperationRunning(operationId: string): Promise<void>;
  completeReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    readiness: ProfileReadiness,
    traceId: string,
  ): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseHandle {
  client: postgres.Sql;
  db: PostgresJsDatabase;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return { client, db: drizzle(client) };
}

function mapPreferences(row: typeof jobPreferences.$inferSelect): JobPreferenceSet {
  return {
    id: row.id,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    ...row.preferences,
  };
}

function mapOperation(row: typeof operations.$inferSelect): Operation {
  return {
    id: row.id,
    kind: "profile_readiness",
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.result ? { result: row.result as unknown as ProfileReadiness } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}

function requestHash(input: PutJobPreferencesRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class PostgresProfileStore implements ProfileStore {
  constructor(private readonly handle: DatabaseHandle) {}

  async resolveUser(principal: AuthPrincipal, traceId: string): Promise<CurrentUser> {
    const existing = await this.handle.db
      .select()
      .from(externalIdentities)
      .where(
        and(
          eq(externalIdentities.issuer, principal.issuer),
          eq(externalIdentities.subject, principal.subject),
        ),
      )
      .limit(1);

    const identity = existing[0];
    if (identity) {
      await this.handle.db
        .update(externalIdentities)
        .set({
          lastSeenAt: new Date(),
          ...(principal.email ? { email: principal.email } : {}),
        })
        .where(
          and(
            eq(externalIdentities.issuer, principal.issuer),
            eq(externalIdentities.subject, principal.subject),
          ),
        );
      return { id: identity.userId, ...(principal.email ? { email: principal.email } : {}) };
    }

    const userId = uuidv7();
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId });
      await tx.insert(externalIdentities).values({
        issuer: principal.issuer,
        subject: principal.subject,
        userId,
        ...(principal.email ? { email: principal.email } : {}),
      });
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        userId,
        action: "identity.linked",
        resourceType: "user",
        resourceId: userId,
        traceId,
        metadata: { issuer: principal.issuer },
      });
    });

    return { id: userId, ...(principal.email ? { email: principal.email } : {}) };
  }

  async getPreferences(userId: string): Promise<JobPreferenceSet | null> {
    const rows = await this.handle.db
      .select()
      .from(jobPreferences)
      .where(eq(jobPreferences.userId, userId))
      .limit(1);
    return rows[0] ? mapPreferences(rows[0]) : null;
  }

  async putPreferences(
    userId: string,
    input: PutJobPreferencesRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<PutJobPreferencesResponse> {
    const hash = requestHash(input);
    const scope = "profile.job-preferences.put.v1";

    return this.handle.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${idempotencyKey}`}))`,
      );
      const prior = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.scope, scope),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        )
        .limit(1);
      if (prior[0]) {
        if (prior[0].requestHash !== hash) {
          throw new IdempotencyConflictError();
        }
        return prior[0].response as unknown as PutJobPreferencesResponse;
      }

      const current = await tx
        .select()
        .from(jobPreferences)
        .where(eq(jobPreferences.userId, userId))
        .limit(1);
      const preferenceSetId = current[0]?.id ?? uuidv7();
      const version = (current[0]?.version ?? 0) + 1;
      const now = new Date();
      const storedPreferences = input;

      const rows = await tx
        .insert(jobPreferences)
        .values({
          id: preferenceSetId,
          userId,
          version,
          preferences: storedPreferences,
          createdAt: current[0]?.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: jobPreferences.userId,
          set: { version, preferences: storedPreferences, updatedAt: now },
        })
        .returning();
      const saved = rows[0];
      if (!saved) {
        throw new Error("Preference persistence returned no row");
      }

      const operationId = uuidv7();
      const eventId = uuidv7();
      const response: PutJobPreferencesResponse = {
        preferences: mapPreferences(saved),
        operationId,
      };
      const eventData: ProfilePreferencesUpdatedData = {
        preferenceSetId,
        version,
        operationId,
      };

      await tx.insert(operations).values({
        id: operationId,
        userId,
        kind: "profile_readiness",
        state: "queued",
      });
      await tx.insert(outboxEvents).values({
        id: eventId,
        type: eventTypes.profilePreferencesUpdated,
        source: "urn:ai-job-apply:profile-service",
        subject: `preference-set/${preferenceSetId}`,
        dataSchema:
          "https://schemas.ai-job-apply.internal/events/profile.preferences.updated.v1.json",
        data: eventData as unknown as Record<string, unknown>,
        traceparent: traceId,
      });
      await tx.insert(idempotencyKeys).values({
        userId,
        scope,
        key: idempotencyKey,
        requestHash: hash,
        response: response as unknown as Record<string, unknown>,
      });
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        userId,
        action: "profile.preferences.updated",
        resourceType: "job_preference_set",
        resourceId: preferenceSetId,
        traceId,
        metadata: { version },
      });
      return response;
    });
  }

  async getOperation(userId: string, operationId: string): Promise<Operation | null> {
    const rows = await this.handle.db
      .select()
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.userId, userId)))
      .limit(1);
    return rows[0] ? mapOperation(rows[0]) : null;
  }

  async getPendingOutboxEvents(limit: number): Promise<PendingOutboxEvent[]> {
    const rows = await this.handle.db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      subject: row.subject,
      data: row.data,
      ...(row.traceparent ? { traceparent: row.traceparent } : {}),
    }));
  }

  async markOutboxPublished(eventId: string): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({ publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
      .where(eq(outboxEvents.id, eventId));
  }

  async getPreferencesById(preferenceSetId: string): Promise<JobPreferenceSet | null> {
    const rows = await this.handle.db
      .select()
      .from(jobPreferences)
      .where(eq(jobPreferences.id, preferenceSetId))
      .limit(1);
    return rows[0] ? mapPreferences(rows[0]) : null;
  }

  async markOperationRunning(operationId: string): Promise<void> {
    await this.handle.db
      .update(operations)
      .set({ state: "running", updatedAt: new Date(), errorCode: null })
      .where(eq(operations.id, operationId));
  }

  async completeReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    readiness: ProfileReadiness,
    traceId: string,
  ): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await tx
        .update(operations)
        .set({
          state: "succeeded",
          result: readiness as unknown as Record<string, unknown>,
          updatedAt: new Date(),
          errorCode: null,
        })
        .where(eq(operations.id, operationId));
      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        type: eventTypes.profileReadinessCalculated,
        source: "urn:ai-job-apply:profile-worker",
        subject: `operation/${operationId}`,
        dataSchema:
          "https://schemas.ai-job-apply.internal/events/profile.readiness.calculated.v1.json",
        data: {
          preferenceSetId,
          operationId,
          completionPercent: readiness.completionPercent,
          missingFields: readiness.missingFields,
        },
        traceparent: traceId,
      });
    });
  }

  async ping(): Promise<void> {
    await this.handle.client`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.handle.client.end();
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}
