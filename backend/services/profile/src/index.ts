import { createHash } from "node:crypto";
import type {
  CreateProfileFactRequest,
  CurrentUser,
  JobPreferenceSet,
  Operation,
  ProfileFact,
  ProfileFactCollection,
  ProfileReadiness,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import {
  eventTypes,
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  outboxNudgeSchemaVersion,
  type ProfilePreferencesUpdatedData,
} from "@ai-job-apply/event-contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  auditEvents,
  externalIdentities,
  idempotencyKeys,
  jobPreferences,
  type OutboxDispatchTarget,
  operations,
  outboxEvents,
  users,
} from "./schema.js";

export { resolveLambdaDatabaseUrl } from "./lambda-database-url.js";

export interface OutboxEventRecord {
  id: string;
  type: string;
  source: string;
  subject: string;
  dataSchema: string;
  data: Record<string, unknown>;
  traceparent?: string;
  createdAt: Date;
}

export interface DurableOutboxEvent extends OutboxEventRecord {
  dispatchTarget: "lambda_durable";
  publishedAt?: Date;
  durableExecutionName?: string;
}

export interface OutboxNudgePublisher {
  publish(nudge: OutboxNudgeV1): Promise<void>;
}

export interface ProfileStoreOptions {
  dispatchTarget?: OutboxDispatchTarget;
  nudgePublisher?: OutboxNudgePublisher;
  nudgeRetryDelaySeconds?: number;
}

export interface ProfileStore {
  resolveUser(principal: AuthPrincipal, traceId: string): Promise<CurrentUser>;
  getPreferences(userId: string): Promise<JobPreferenceSet | null>;
  putPreferences(
    userId: string,
    input: PutJobPreferencesRequest,
    idempotencyKey: string,
    traceId: string,
    traceparent?: string,
  ): Promise<PutJobPreferencesResponse>;
  listProfileFacts(userId: string): Promise<ProfileFactCollection>;
  createProfileFact(
    userId: string,
    input: CreateProfileFactRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileFact>;
  updateProfileFact(
    userId: string,
    factId: string,
    input: UpdateProfileFactRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileFact | null>;
  getOperation(userId: string, operationId: string): Promise<Operation | null>;
  getPreferencesById(preferenceSetId: string): Promise<JobPreferenceSet | null>;
  markOperationRunning(operationId: string, preferenceSetId: string): Promise<void>;
  completeReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    readiness: ProfileReadiness,
    traceparent?: string,
  ): Promise<void>;
  failReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    errorCode: string,
  ): Promise<void>;
  failDurableReadinessOperation(executionName: string, errorCode: string): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface ServerlessOutboxStore {
  claimOutboxNudges(limit: number, staleBefore: Date): Promise<DurableOutboxEvent[]>;
  recordOutboxNudgeSucceeded(eventId: string, nextAttemptAt: Date): Promise<void>;
  recordOutboxNudgeFailed(eventId: string, errorCode: string, nextAttemptAt: Date): Promise<void>;
  releaseOutboxNudgeClaim(eventId: string): Promise<void>;
  getDurableOutboxEvent(eventId: string): Promise<DurableOutboxEvent | null>;
  acknowledgeDurableOutboxStart(
    eventId: string,
    executionName: string,
    executionArn?: string,
  ): Promise<void>;
  recordDurableOutboxStartFailure(eventId: string, errorCode: string): Promise<void>;
}

export interface DatabaseHandle {
  client: postgres.Sql;
  db: PostgresJsDatabase;
}

export function createDatabase(
  databaseUrl: string,
  options: { maxConnections?: number } = {},
): DatabaseHandle {
  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
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

function requestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

interface ProfileFactRow {
  id: string;
  kind: ProfileFact["kind"];
  key: string;
  value: ProfileFact["value"];
  verification: ProfileFact["verification"];
  availabilityState: "available" | "invalidated";
  availabilityReason: "source_security_hold" | null;
  sensitivity: ProfileFact["sensitivity"];
  sourceType: ProfileFact["source"]["type"];
  sourceReference: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  evidence: ProfileFact["evidence"] | null;
}

function timestampIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProfileFact(row: ProfileFactRow): ProfileFact {
  if (
    row.availabilityState === "invalidated" &&
    row.availabilityReason !== "source_security_hold"
  ) {
    throw new Error("ProfileFactAvailabilityInvariantInvalid");
  }
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    value: row.value,
    verification: row.verification,
    ...(row.availabilityState === "invalidated"
      ? {
          availability: {
            state: "invalidated" as const,
            reasonCode: "source_security_hold" as const,
          },
        }
      : {}),
    sensitivity: row.sensitivity,
    source: { type: row.sourceType, reference: row.sourceReference },
    version: row.version,
    createdAt: timestampIso(row.createdAt),
    updatedAt: timestampIso(row.updatedAt),
    ...(row.effectiveFrom ? { effectiveFrom: row.effectiveFrom } : {}),
    ...(row.effectiveTo ? { effectiveTo: row.effectiveTo } : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
  };
}

export interface ResumeProposalImport {
  userId: string;
  documentId: string;
  documentVersion: number;
  parserVersion: string;
  traceId: string;
  proposals: ReadonlyArray<{
    kind: ProfileFact["kind"];
    key: string;
    value: ProfileFact["value"];
    sensitivity: ProfileFact["sensitivity"];
    evidence: NonNullable<ProfileFact["evidence"]>;
  }>;
}

export class ResumeProposalConflictError extends Error {
  constructor() {
    super("The resume proposal import identity was reused with different content");
    this.name = "ResumeProposalConflictError";
  }
}

export function assertProfileFactTransition(
  currentVerification: ProfileFact["verification"],
  requestedVerification: UpdateProfileFactRequest["verification"],
  valueChanged: boolean,
  available = true,
): void {
  const resultingVerification = requestedVerification ?? currentVerification;
  if (
    !available ||
    (currentVerification === "proposed" &&
      requestedVerification !== "confirmed" &&
      requestedVerification !== "rejected") ||
    (valueChanged && resultingVerification !== "confirmed")
  ) {
    throw new ProfileFactTransitionConflictError();
  }
}

/** Profile-owned writer invoked inside the document coordinator transaction. */
export class PostgresResumeProposalWriter {
  async import(transaction: postgres.TransactionSql, input: ResumeProposalImport): Promise<number> {
    for (const proposal of input.proposals) {
      if (
        proposal.evidence.supportingSpans.length < 1 ||
        proposal.evidence.supportingSpans.some(
          (span) =>
            span.documentId !== input.documentId ||
            span.documentVersion !== input.documentVersion ||
            span.parserVersion !== input.parserVersion ||
            span.endOffset <= span.startOffset,
        )
      ) {
        throw new Error("InvalidResumeProposalEvidence");
      }
    }
    const canonical = JSON.stringify(input.proposals);
    const digest = createHash("sha256").update(canonical).digest("hex");
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtext(${`resume-proposals:${input.userId}:${input.documentId}:${input.documentVersion}:${input.parserVersion}`})
      )
    `;
    const prior = await transaction<Array<{ proposalDigest: string; proposalCount: number }>>`
      SELECT proposal_digest AS "proposalDigest", proposal_count AS "proposalCount"
      FROM profile.resume_fact_imports
      WHERE user_id = ${input.userId}
        AND document_id = ${input.documentId}
        AND document_version = ${input.documentVersion}
        AND parser_version = ${input.parserVersion}
    `;
    if (prior[0]) {
      if (prior[0].proposalDigest !== digest) throw new ResumeProposalConflictError();
      return prior[0].proposalCount;
    }

    const importId = uuidv7();
    await transaction`
      INSERT INTO profile.resume_fact_imports (
        id, user_id, document_id, document_version, parser_version, proposal_digest, proposal_count
      ) VALUES (
        ${importId}, ${input.userId}, ${input.documentId}, ${input.documentVersion},
        ${input.parserVersion}, ${digest}, ${input.proposals.length}
      )
    `;
    for (const proposal of input.proposals) {
      const factId = uuidv7();
      await transaction`
        INSERT INTO profile.profile_facts (id, user_id)
        VALUES (${factId}, ${input.userId})
      `;
      await transaction`
        INSERT INTO profile.profile_fact_versions (
          fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
          source_type, source_reference
        ) VALUES (
          ${factId}, 1, ${proposal.kind}, ${proposal.key}, ${JSON.stringify(proposal.value)}::jsonb,
          'proposed', ${proposal.sensitivity}, 'resume',
          ${`resume:${input.documentId}:v${input.documentVersion}:${input.parserVersion}`}
        )
      `;
      for (const [ordinal, span] of proposal.evidence.supportingSpans.entries()) {
        if (span.endOffset <= span.startOffset) throw new Error("InvalidResumeProposalEvidence");
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version, parser_version,
            block_index, start_offset, end_offset, page
          ) VALUES (
            ${factId}, 1, ${ordinal}, ${span.documentId}, ${span.documentVersion},
            ${span.parserVersion}, ${span.blockIndex}, ${span.startOffset}, ${span.endOffset},
            ${span.page ?? null}
          )
        `;
      }
    }
    await transaction`
      INSERT INTO platform.audit_events (
        id, user_id, action, resource_type, resource_id, trace_id, metadata
      ) VALUES (
        ${uuidv7()}, ${input.userId}, 'profile.resume.proposals.imported',
        'resume_document', ${input.documentId}, ${input.traceId},
        ${JSON.stringify({
          documentVersion: input.documentVersion,
          parserVersion: input.parserVersion,
          proposalCount: input.proposals.length,
        })}::jsonb
      )
    `;
    return input.proposals.length;
  }

  async holdDocumentProposals(
    transaction: postgres.TransactionSql,
    input: { userId: string; documentId: string; traceId: string },
  ): Promise<number> {
    const rows = await transaction<
      Array<{
        factId: string;
        version: number;
        kind: ProfileFact["kind"];
        key: string;
        value: ProfileFact["value"];
        verification: ProfileFact["verification"];
        sensitivity: ProfileFact["sensitivity"];
        sourceType: ProfileFact["source"]["type"];
        sourceReference: string;
        effectiveFrom: string | null;
        effectiveTo: string | null;
      }>
    >`
      SELECT fact.id AS "factId", version.version, version.kind,
        version.fact_key AS key, version.fact_value AS value, version.verification,
        version.sensitivity,
        version.source_type AS "sourceType", version.source_reference AS "sourceReference",
        version.availability_state AS "availabilityState",
        version.availability_reason AS "availabilityReason",
        version.effective_from AS "effectiveFrom", version.effective_to AS "effectiveTo"
      FROM profile.profile_facts AS fact
      JOIN LATERAL (
        SELECT * FROM profile.profile_fact_versions
        WHERE fact_id = fact.id ORDER BY version DESC LIMIT 1
      ) AS version ON true
      WHERE fact.user_id = ${input.userId}
        AND version.availability_state = 'available'
        AND EXISTS (
          SELECT 1 FROM profile.profile_fact_evidence AS evidence
          WHERE evidence.fact_id = fact.id AND evidence.fact_version = version.version
            AND evidence.document_id = ${input.documentId}
        )
      FOR UPDATE OF fact
    `;
    for (const fact of rows) {
      const nextVersion = fact.version + 1;
      await transaction`
        INSERT INTO profile.profile_fact_versions (
          fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
          source_type, source_reference, effective_from, effective_to,
          availability_state, availability_reason
        ) VALUES (
          ${fact.factId}, ${nextVersion}, ${fact.kind}, ${fact.key},
          ${JSON.stringify(fact.value)}::jsonb, ${fact.verification}, ${fact.sensitivity},
          ${fact.sourceType}, ${fact.sourceReference}, ${fact.effectiveFrom}::date,
          ${fact.effectiveTo}::date, 'invalidated', 'source_security_hold'
        )
      `;
      await transaction`
        INSERT INTO profile.profile_fact_evidence (
          fact_id, fact_version, ordinal, document_id, document_version, parser_version,
          block_index, start_offset, end_offset, page
        )
        SELECT fact_id, ${nextVersion}, ordinal, document_id, document_version, parser_version,
          block_index, start_offset, end_offset, page
        FROM profile.profile_fact_evidence
        WHERE fact_id = ${fact.factId} AND fact_version = ${fact.version}
      `;
    }
    if (rows.length > 0) {
      await transaction`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (
          ${uuidv7()}, ${input.userId}, 'profile.resume.proposals.security-held',
          'resume_document', ${input.documentId}, ${input.traceId},
          ${JSON.stringify({ rejectedProposalCount: rows.length })}::jsonb
        )
      `;
    }
    return rows.length;
  }
}

export class PostgresProfileStore implements ProfileStore {
  private readonly dispatchTarget: OutboxDispatchTarget;
  private readonly nudgePublisher: OutboxNudgePublisher | undefined;
  private readonly nudgeRetryDelaySeconds: number;

  constructor(
    private readonly handle: DatabaseHandle,
    options: ProfileStoreOptions = {},
  ) {
    this.dispatchTarget = options.dispatchTarget ?? "lambda_durable";
    this.nudgePublisher = options.nudgePublisher;
    this.nudgeRetryDelaySeconds = options.nudgeRetryDelaySeconds ?? 300;
  }

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
    traceparent?: string,
  ): Promise<PutJobPreferencesResponse> {
    const hash = requestHash(input);
    const scope = "profile.job-preferences.put.v1";

    const outcome = await this.handle.db.transaction(async (tx) => {
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
        return {
          response: prior[0].response as unknown as PutJobPreferencesResponse,
        };
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
        dispatchTarget: this.dispatchTarget,
        ...(traceparent ? { traceparent } : {}),
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
      return {
        response,
        nudge:
          this.dispatchTarget === "lambda_durable"
            ? buildOutboxNudge(eventId, eventTypes.profilePreferencesUpdated, traceparent)
            : undefined,
      };
    });

    if (outcome.nudge && this.nudgePublisher) {
      await this.attemptOutboxNudge(outcome.nudge);
    }
    return outcome.response;
  }

  async listProfileFacts(userId: string): Promise<ProfileFactCollection> {
    const rows = await this.handle.client<ProfileFactRow[]>`
      SELECT
        fact.id,
        version.kind,
        version.fact_key AS key,
        version.fact_value AS value,
        version.verification,
        version.availability_state AS "availabilityState",
        version.availability_reason AS "availabilityReason",
        version.sensitivity,
        version.source_type AS "sourceType",
        version.source_reference AS "sourceReference",
        version.effective_from AS "effectiveFrom",
        version.effective_to AS "effectiveTo",
        version.version,
        fact.created_at AS "createdAt",
        version.created_at AS "updatedAt"
        , CASE WHEN count(evidence.ordinal) = 0 THEN NULL ELSE jsonb_build_object(
            'supportingSpans', jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                'documentId', evidence.document_id,
                'documentVersion', evidence.document_version,
                'parserVersion', evidence.parser_version,
                'blockIndex', evidence.block_index,
                'startOffset', evidence.start_offset,
                'endOffset', evidence.end_offset,
                'page', evidence.page
              )) ORDER BY evidence.ordinal
            )
          ) END AS evidence
      FROM profile.profile_facts AS fact
      JOIN LATERAL (
        SELECT *
        FROM profile.profile_fact_versions
        WHERE fact_id = fact.id
        ORDER BY version DESC
        LIMIT 1
      ) AS version ON true
      LEFT JOIN profile.profile_fact_evidence AS evidence
        ON evidence.fact_id = version.fact_id AND evidence.fact_version = version.version
      WHERE fact.user_id = ${userId}
      GROUP BY fact.id, version.fact_id, version.version, version.kind, version.fact_key,
        version.fact_value, version.verification, version.availability_state,
        version.availability_reason, version.sensitivity, version.source_type,
        version.source_reference, version.effective_from, version.effective_to, version.created_at
      ORDER BY fact.created_at, fact.id
    `;
    const facts = rows.map(mapProfileFact);
    return {
      facts,
      confirmedCount: facts.filter(
        (fact) => fact.verification === "confirmed" && fact.availability?.state !== "invalidated",
      ).length,
      proposedCount: facts.filter(
        (fact) => fact.verification === "proposed" && fact.availability?.state !== "invalidated",
      ).length,
    };
  }

  async createProfileFact(
    userId: string,
    input: CreateProfileFactRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileFact> {
    const hash = requestHash(input);
    const scope = "profile.fact.create.v1";
    return this.handle.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${idempotencyKey}`}))
      `;
      const prior = await transaction<Array<{ requestHash: string; response: ProfileFact }>>`
        SELECT request_hash AS "requestHash", response
        FROM platform.idempotency_keys
        WHERE user_id = ${userId} AND scope = ${scope} AND key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].requestHash !== hash) {
          throw new IdempotencyConflictError();
        }
        return prior[0].response;
      }

      const factId = uuidv7();
      const createdAt = new Date();
      await transaction`
        INSERT INTO profile.profile_facts (id, user_id, created_at)
        VALUES (${factId}, ${userId}, ${createdAt.toISOString()}::timestamptz)
      `;
      await transaction`
        INSERT INTO profile.profile_fact_versions (
          fact_id,
          version,
          kind,
          fact_key,
          fact_value,
          verification,
          sensitivity,
          source_type,
          source_reference,
          effective_from,
          effective_to,
          created_at
        ) VALUES (
          ${factId},
          1,
          ${input.kind},
          ${input.key},
          ${JSON.stringify(input.value)}::jsonb,
          'confirmed',
          ${input.sensitivity},
          'user',
          'direct-entry',
          ${input.effectiveFrom ?? null}::date,
          ${input.effectiveTo ?? null}::date,
          ${createdAt.toISOString()}::timestamptz
        )
      `;
      const response: ProfileFact = {
        id: factId,
        kind: input.kind,
        key: input.key,
        value: input.value,
        verification: "confirmed",
        sensitivity: input.sensitivity,
        source: { type: "user", reference: "direct-entry" },
        version: 1,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
        ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
      };
      await transaction`
        INSERT INTO platform.idempotency_keys (
          user_id, scope, key, request_hash, response
        ) VALUES (
          ${userId}, ${scope}, ${idempotencyKey}, ${hash}, ${JSON.stringify(response)}::jsonb
        )
      `;
      await transaction`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (
          ${uuidv7()},
          ${userId},
          'profile.fact.created',
          'profile_fact',
          ${factId},
          ${traceId},
          ${JSON.stringify({ version: 1 })}::jsonb
        )
      `;
      return response;
    });
  }

  async updateProfileFact(
    userId: string,
    factId: string,
    input: UpdateProfileFactRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ProfileFact | null> {
    const hash = requestHash(input);
    const scope = `profile.fact.update.v1:${factId}`;
    return this.handle.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${idempotencyKey}`}))
      `;
      const prior = await transaction<Array<{ requestHash: string; response: ProfileFact }>>`
        SELECT request_hash AS "requestHash", response
        FROM platform.idempotency_keys
        WHERE user_id = ${userId} AND scope = ${scope} AND key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].requestHash !== hash) {
          throw new IdempotencyConflictError();
        }
        return prior[0].response;
      }

      const rows = await transaction<ProfileFactRow[]>`
        SELECT
          fact.id,
          version.kind,
          version.fact_key AS key,
          version.fact_value AS value,
          version.verification,
          version.availability_state AS "availabilityState",
          version.availability_reason AS "availabilityReason",
          version.sensitivity,
          version.source_type AS "sourceType",
          version.source_reference AS "sourceReference",
          version.effective_from AS "effectiveFrom",
          version.effective_to AS "effectiveTo",
          version.version,
          fact.created_at AS "createdAt",
          version.created_at AS "updatedAt",
          NULL::jsonb AS evidence
        FROM profile.profile_facts AS fact
        JOIN LATERAL (
          SELECT *
          FROM profile.profile_fact_versions
          WHERE fact_id = fact.id
          ORDER BY version DESC
          LIMIT 1
        ) AS version ON true
        WHERE fact.id = ${factId} AND fact.user_id = ${userId}
        FOR UPDATE OF fact
      `;
      const current = rows[0];
      if (!current) {
        return null;
      }
      if (current.version !== input.expectedVersion) {
        throw new ProfileFactVersionConflictError();
      }
      const evidenceRows = await transaction<
        NonNullable<ProfileFact["evidence"]>["supportingSpans"]
      >`
        SELECT document_id AS "documentId", document_version AS "documentVersion",
          parser_version AS "parserVersion", block_index AS "blockIndex",
          start_offset AS "startOffset", end_offset AS "endOffset", page
        FROM profile.profile_fact_evidence
        WHERE fact_id = ${factId} AND fact_version = ${current.version}
        ORDER BY ordinal
      `;
      const currentEvidence: ProfileFact["evidence"] =
        evidenceRows.length > 0 ? { supportingSpans: evidenceRows } : undefined;

      const version = current.version + 1;
      const updatedAt = new Date();
      const value = input.value ?? current.value;
      const verification = input.verification ?? current.verification;
      const sensitivity = input.sensitivity ?? current.sensitivity;
      const effectiveFrom = input.effectiveFrom ?? current.effectiveFrom;
      const effectiveTo = input.effectiveTo ?? current.effectiveTo;
      const valueChanged =
        input.value !== undefined && JSON.stringify(input.value) !== JSON.stringify(current.value);
      const effectiveDatesChanged =
        (input.effectiveFrom !== undefined && input.effectiveFrom !== current.effectiveFrom) ||
        (input.effectiveTo !== undefined && input.effectiveTo !== current.effectiveTo);
      const contentChanged = valueChanged || effectiveDatesChanged;
      assertProfileFactTransition(
        current.verification,
        input.verification,
        contentChanged,
        current.availabilityState === "available",
      );
      const sourceType =
        contentChanged && current.sourceType === "resume" ? "user" : current.sourceType;
      const sourceReference =
        contentChanged && current.sourceType === "resume"
          ? `resume-correction:${factId}`
          : current.sourceReference;
      await transaction`
        INSERT INTO profile.profile_fact_versions (
          fact_id,
          version,
          kind,
          fact_key,
          fact_value,
          verification,
          sensitivity,
          source_type,
          source_reference,
          effective_from,
          effective_to,
          availability_state,
          availability_reason,
          created_at
        ) VALUES (
          ${factId},
          ${version},
          ${current.kind},
          ${current.key},
          ${JSON.stringify(value)}::jsonb,
          ${verification},
          ${sensitivity},
          ${sourceType},
          ${sourceReference},
          ${effectiveFrom}::date,
          ${effectiveTo}::date,
          ${current.availabilityState},
          ${current.availabilityReason},
          ${updatedAt.toISOString()}::timestamptz
        )
      `;
      if (!contentChanged && currentEvidence) {
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version, parser_version,
            block_index, start_offset, end_offset, page
          )
          SELECT fact_id, ${version}, ordinal, document_id, document_version, parser_version,
            block_index, start_offset, end_offset, page
          FROM profile.profile_fact_evidence
          WHERE fact_id = ${factId} AND fact_version = ${current.version}
        `;
      }
      const response = mapProfileFact({
        ...current,
        value,
        verification,
        sensitivity,
        effectiveFrom,
        effectiveTo,
        version,
        updatedAt,
        sourceType,
        sourceReference,
        evidence: contentChanged ? null : (currentEvidence ?? null),
      });
      await transaction`
        INSERT INTO platform.idempotency_keys (
          user_id, scope, key, request_hash, response
        ) VALUES (
          ${userId}, ${scope}, ${idempotencyKey}, ${hash}, ${JSON.stringify(response)}::jsonb
        )
      `;
      await transaction`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (
          ${uuidv7()},
          ${userId},
          'profile.fact.version.created',
          'profile_fact',
          ${factId},
          ${traceId},
          ${JSON.stringify({ version })}::jsonb
        )
      `;
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

  async claimOutboxNudges(limit: number, staleBefore: Date): Promise<DurableOutboxEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Outbox nudge claim limit must be an integer from one through 100");
    }
    const rows = await this.handle.client.begin(
      async (transaction) =>
        transaction<
          Array<{
            id: string;
            type: string;
            source: string;
            subject: string;
            dataSchema: string;
            data: Record<string, unknown>;
            traceparent: string | null;
            createdAt: Date;
            publishedAt: Date | null;
            durableExecutionName: string | null;
          }>
        >`
        WITH candidates AS (
          SELECT id
          FROM platform.outbox_events
          WHERE dispatch_target = 'lambda_durable'
            AND published_at IS NULL
            AND (nudge_next_attempt_at IS NULL OR nudge_next_attempt_at <= now())
            AND (
              nudge_claimed_at IS NULL OR
              nudge_claimed_at < ${staleBefore.toISOString()}::timestamptz
            )
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE platform.outbox_events AS event
        SET nudge_claimed_at = now()
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING
          event.id,
          event.type,
          event.source,
          event.subject,
          event.data_schema AS "dataSchema",
          event.data,
          event.traceparent,
          event.created_at AS "createdAt",
          event.published_at AS "publishedAt",
          event.durable_execution_name AS "durableExecutionName"
      `,
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      source: row.source,
      subject: row.subject,
      dataSchema: row.dataSchema,
      data: row.data,
      dispatchTarget: "lambda_durable",
      ...(row.traceparent ? { traceparent: row.traceparent } : {}),
      createdAt: row.createdAt,
      ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
      ...(row.durableExecutionName ? { durableExecutionName: row.durableExecutionName } : {}),
    }));
  }

  async recordOutboxNudgeSucceeded(eventId: string, nextAttemptAt: Date): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({
        nudgedAt: new Date(),
        nudgeClaimedAt: null,
        nudgeNextAttemptAt: nextAttemptAt,
        nudgeLastErrorCode: null,
        nudgeAttempts: sql`${outboxEvents.nudgeAttempts} + 1`,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.dispatchTarget, "lambda_durable")));
  }

  async recordOutboxNudgeFailed(
    eventId: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({
        nudgeClaimedAt: null,
        nudgeNextAttemptAt: nextAttemptAt,
        nudgeLastErrorCode: sanitizedErrorCode(errorCode),
        nudgeAttempts: sql`${outboxEvents.nudgeAttempts} + 1`,
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.dispatchTarget, "lambda_durable")));
  }

  async releaseOutboxNudgeClaim(eventId: string): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({ nudgeClaimedAt: null })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.dispatchTarget, "lambda_durable")));
  }

  async getDurableOutboxEvent(eventId: string): Promise<DurableOutboxEvent | null> {
    const rows = await this.handle.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.dispatchTarget, "lambda_durable")))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      type: row.type,
      source: row.source,
      subject: row.subject,
      dataSchema: row.dataSchema,
      data: row.data,
      dispatchTarget: "lambda_durable",
      ...(row.traceparent ? { traceparent: row.traceparent } : {}),
      createdAt: row.createdAt,
      ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
      ...(row.durableExecutionName ? { durableExecutionName: row.durableExecutionName } : {}),
    };
  }

  async acknowledgeDurableOutboxStart(
    eventId: string,
    executionName: string,
    executionArn?: string,
  ): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({
        publishedAt: new Date(),
        durableStartedAt: new Date(),
        durableExecutionName: executionName,
        ...(executionArn ? { durableExecutionArn: executionArn } : {}),
        durableLastErrorCode: null,
        durableStartAttempts: sql`${outboxEvents.durableStartAttempts} + 1`,
        attempts: sql`${outboxEvents.attempts} + 1`,
        nudgeClaimedAt: null,
      })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.dispatchTarget, "lambda_durable"),
          isNull(outboxEvents.publishedAt),
        ),
      );
  }

  async recordDurableOutboxStartFailure(eventId: string, errorCode: string): Promise<void> {
    await this.handle.db
      .update(outboxEvents)
      .set({
        durableLastErrorCode: sanitizedErrorCode(errorCode),
        durableStartAttempts: sql`${outboxEvents.durableStartAttempts} + 1`,
      })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.dispatchTarget, "lambda_durable"),
          isNull(outboxEvents.publishedAt),
        ),
      );
  }

  async getPreferencesById(preferenceSetId: string): Promise<JobPreferenceSet | null> {
    const rows = await this.handle.db
      .select()
      .from(jobPreferences)
      .where(eq(jobPreferences.id, preferenceSetId))
      .limit(1);
    return rows[0] ? mapPreferences(rows[0]) : null;
  }

  async markOperationRunning(operationId: string, preferenceSetId: string): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      const [preferenceSet] = await tx
        .select({ userId: jobPreferences.userId })
        .from(jobPreferences)
        .where(eq(jobPreferences.id, preferenceSetId))
        .limit(1);
      if (!preferenceSet) {
        throw new Error("ProfileReadinessInputNotFound");
      }
      const updated = await tx
        .update(operations)
        .set({ state: "running", updatedAt: new Date(), errorCode: null })
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.userId, preferenceSet.userId),
            inArray(operations.state, ["queued", "running"]),
          ),
        )
        .returning({ id: operations.id });
      if (updated.length > 0) {
        return;
      }
      const [existing] = await tx
        .select({ state: operations.state })
        .from(operations)
        .where(and(eq(operations.id, operationId), eq(operations.userId, preferenceSet.userId)))
        .limit(1);
      if (existing?.state !== "succeeded") {
        throw new Error("ProfileReadinessOperationNotRunnable");
      }
    });
  }

  async completeReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    readiness: ProfileReadiness,
    traceparent?: string,
  ): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      const completedAt = new Date();
      const [preferenceSet] = await tx
        .select({ userId: jobPreferences.userId })
        .from(jobPreferences)
        .where(eq(jobPreferences.id, preferenceSetId))
        .limit(1);
      if (!preferenceSet) {
        throw new Error("ProfileReadinessInputNotFound");
      }
      const updated = await tx
        .update(operations)
        .set({
          state: "succeeded",
          result: readiness as unknown as Record<string, unknown>,
          updatedAt: completedAt,
          errorCode: null,
        })
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.userId, preferenceSet.userId),
            inArray(operations.state, ["queued", "running"]),
          ),
        )
        .returning({ id: operations.id });
      if (updated.length === 0) {
        const [existing] = await tx
          .select({ state: operations.state })
          .from(operations)
          .where(and(eq(operations.id, operationId), eq(operations.userId, preferenceSet.userId)))
          .limit(1);
        if (existing?.state === "succeeded") {
          return;
        }
        throw new Error("ProfileReadinessOperationNotCompletable");
      }
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
        // Phase 0 has no downstream subscriber for this terminal result event. Retain the
        // immutable event record, but acknowledge it atomically with operation completion so a
        // retired runtime is not required merely to clear an otherwise undispatchable row.
        publishedAt: completedAt,
        ...(traceparent ? { traceparent } : {}),
      });
    });
  }

  async failReadinessOperation(
    operationId: string,
    preferenceSetId: string,
    errorCode: string,
  ): Promise<void> {
    const code = sanitizedErrorCode(errorCode);
    await this.handle.db.transaction(async (tx) => {
      const [preferenceSet] = await tx
        .select({ userId: jobPreferences.userId })
        .from(jobPreferences)
        .where(eq(jobPreferences.id, preferenceSetId))
        .limit(1);
      if (!preferenceSet) {
        throw new Error("ProfileReadinessInputNotFound");
      }
      await tx
        .update(operations)
        .set({ state: "failed", updatedAt: new Date(), errorCode: code })
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.userId, preferenceSet.userId),
            inArray(operations.state, ["queued", "running"]),
          ),
        );
    });
  }

  async failDurableReadinessOperation(executionName: string, errorCode: string): Promise<void> {
    const code = sanitizedErrorCode(errorCode);
    await this.handle.client`
      UPDATE platform.operations AS operation
      SET
        state = 'failed',
        updated_at = now(),
        error_code = ${code}
      FROM platform.outbox_events AS event,
           profile.job_preferences AS preference_set
      WHERE event.durable_execution_name = ${executionName}
        AND event.dispatch_target = 'lambda_durable'
        AND event.type = ${eventTypes.profilePreferencesUpdated}
        AND operation.id = (event.data ->> 'operationId')::uuid
        AND preference_set.id = (event.data ->> 'preferenceSetId')::uuid
        AND preference_set.user_id = operation.user_id
        AND operation.state IN ('queued', 'running')
    `;
  }

  async ping(): Promise<void> {
    await this.handle.client`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.handle.client.end();
  }

  private async attemptOutboxNudge(nudge: OutboxNudgeV1): Promise<void> {
    if (!this.nudgePublisher) {
      return;
    }
    const nextAttemptAt = new Date(Date.now() + this.nudgeRetryDelaySeconds * 1_000);
    try {
      await this.nudgePublisher.publish(nudge);
      await this.recordOutboxNudgeSucceeded(nudge.eventId, nextAttemptAt);
    } catch (error) {
      try {
        await this.recordOutboxNudgeFailed(
          nudge.eventId,
          errorCodeFromUnknown(error),
          nextAttemptAt,
        );
      } catch {
        // The committed outbox row remains eligible for reconciliation even if attempt recording fails.
      }
    }
  }
}

export function buildOutboxNudge(
  eventId: string,
  eventType: string,
  traceparent?: string,
): OutboxNudgeV1 {
  const fields = {
    schemaVersion: outboxNudgeSchemaVersion,
    eventId,
    eventType,
    ...(traceparent ? { traceparent } : {}),
  };
  return {
    ...fields,
    integrity: {
      algorithm: "sha256",
      digest: createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex"),
    },
  };
}

export function verifyOutboxNudgeIntegrity(nudge: OutboxNudgeV1): boolean {
  const expected = createHash("sha256").update(outboxNudgeIntegrityInput(nudge)).digest("hex");
  return expected === nudge.integrity.digest;
}

export function errorCodeFromUnknown(error: unknown): string {
  return sanitizedErrorCode(error instanceof Error ? error.name : "UnknownError");
}

function sanitizedErrorCode(value: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : "UnclassifiedError";
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class ProfileFactVersionConflictError extends Error {
  constructor() {
    super("The profile fact changed after it was loaded");
    this.name = "ProfileFactVersionConflictError";
  }
}

export class ProfileFactTransitionConflictError extends Error {
  constructor() {
    super("The requested profile fact transition is not allowed");
    this.name = "ProfileFactTransitionConflictError";
  }
}
