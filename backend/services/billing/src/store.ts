import { createHash } from "node:crypto";
import { eventTypes } from "@ai-job-apply/event-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type EntitlementReader,
  type EntitlementSchedule,
  maximumEntitlementOutboxAttempts,
  maximumEntitlementVersion,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export const entitlementReasonCodes = Object.freeze([
  "synthetic_grant",
  "synthetic_revoke",
  "provider_projection",
  "reconciliation",
  "support_adjustment",
] as const);
export const entitlementActorKinds = Object.freeze([
  "system",
  "provider_adapter",
  "support",
] as const);

export type EntitlementReasonCode = (typeof entitlementReasonCodes)[number];
export type EntitlementActorKind = (typeof entitlementActorKinds)[number];

export type EntitlementGrant =
  | { plan: "free"; effectiveAt: Date }
  | { plan: "pro"; effectiveAt: Date; accessThrough: Date; graceThrough?: Date };

interface ApplyEntitlementChangeBase {
  userId: string;
  expectedVersion: number;
  idempotencyKey: string;
  occurredAt: Date;
  traceId: string;
}

type EntitlementCommandAttribution =
  | {
      reasonCode: "synthetic_grant";
      grant: Extract<EntitlementGrant, { plan: "pro" }>;
      actor: { kind: "system"; reference: string };
    }
  | {
      reasonCode: "synthetic_revoke";
      grant: Extract<EntitlementGrant, { plan: "free" }>;
      actor: { kind: "system"; reference: string };
    }
  | {
      reasonCode: "reconciliation";
      grant: EntitlementGrant;
      actor: { kind: "system"; reference: string };
    }
  | {
      reasonCode: "provider_projection";
      grant: EntitlementGrant;
      actor: { kind: "provider_adapter"; reference: string };
    }
  | {
      reasonCode: "support_adjustment";
      grant: EntitlementGrant;
      actor: { kind: "support"; reference: string };
    };

export type ApplyEntitlementChangeInput = ApplyEntitlementChangeBase &
  EntitlementCommandAttribution;

export interface ApplyEntitlementChangeResult {
  schedule: Exclude<EntitlementSchedule, { version: 0 }>;
  changeId: string;
  outboxEventId: string;
  replayed: boolean;
}

export interface ClaimedEntitlementEvent {
  id: string;
  type: typeof eventTypes.subscriptionEntitlementChanged;
  subject: string;
  data: { entitlementAccountId: string; userId: string; version: number };
  occurredAt: Date;
  claimToken: string;
  attemptCount: number;
}

export class EntitlementVersionConflictError extends Error {
  constructor() {
    super("Entitlement version changed");
    this.name = "EntitlementVersionConflictError";
  }
}

export class EntitlementVersionExhaustedError extends Error {
  constructor() {
    super("Entitlement version space is exhausted");
    this.name = "EntitlementVersionExhaustedError";
  }
}

export class EntitlementChronologyError extends Error {
  constructor() {
    super("Entitlement command chronology is invalid");
    this.name = "EntitlementChronologyError";
  }
}

export class EntitlementIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was used for a different entitlement command");
    this.name = "EntitlementIdempotencyConflictError";
  }
}

export class EntitlementOutboxClaimError extends Error {
  constructor() {
    super("Entitlement outbox claim is no longer current");
    this.name = "EntitlementOutboxClaimError";
  }
}

interface AccountRow {
  accountId: string;
  userId: string;
  version: string;
  plan: "free" | "pro";
  effectiveAt: Date;
  accessThrough: Date | null;
  graceThrough: Date | null;
  updatedAt: Date;
}

interface ReceiptRow extends AccountRow {
  requestHash: string;
  changeId: string;
  outboxEventId: string;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a canonical lowercase UUID`);
}

function assertExactKeys(value: object, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${field} has an unexpected field boundary`);
  }
}

function exactDate(value: Date, field: string): Date {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} is invalid`);
  return new Date(milliseconds);
}

function validateGrant(grant: EntitlementGrant): EntitlementGrant {
  if (grant.plan !== "free" && grant.plan !== "pro") {
    throw new Error("Entitlement plan is invalid");
  }
  assertExactKeys(
    grant,
    grant.plan === "free"
      ? ["plan", "effectiveAt"]
      : [
          "plan",
          "effectiveAt",
          "accessThrough",
          ...(grant.graceThrough === undefined ? [] : ["graceThrough"]),
        ],
    "grant",
  );
  const effectiveAt = exactDate(grant.effectiveAt, "effectiveAt");
  if (grant.plan === "free") return { plan: "free", effectiveAt };
  const accessThrough = exactDate(grant.accessThrough, "accessThrough");
  if (effectiveAt >= accessThrough) throw new Error("Pro accessThrough must follow effectiveAt");
  const graceThrough = grant.graceThrough
    ? exactDate(grant.graceThrough, "graceThrough")
    : undefined;
  if (graceThrough && graceThrough < accessThrough) {
    throw new Error("Pro graceThrough cannot precede accessThrough");
  }
  return {
    plan: "pro",
    effectiveAt,
    accessThrough,
    ...(graceThrough ? { graceThrough } : {}),
  };
}

function safeVersion(value: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Stored entitlement version is invalid");
  }
  return version;
}

function claimedEventData(value: unknown): {
  entitlementAccountId: string;
  userId: string;
  version: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored entitlement event payload is invalid");
  }
  assertExactKeys(value, ["entitlementAccountId", "userId", "version"], "event payload");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.entitlementAccountId !== "string") {
    throw new Error("Stored entitlement event account is invalid");
  }
  if (typeof candidate.userId !== "string") {
    throw new Error("Stored entitlement event owner is invalid");
  }
  assertUuid(candidate.entitlementAccountId, "event entitlementAccountId");
  assertUuid(candidate.userId, "event userId");
  if (
    typeof candidate.version !== "number" ||
    !Number.isSafeInteger(candidate.version) ||
    candidate.version < 1
  ) {
    throw new Error("Stored entitlement event version is invalid");
  }
  return {
    entitlementAccountId: candidate.entitlementAccountId,
    userId: candidate.userId,
    version: candidate.version,
  };
}

function scheduleFromRow(row: AccountRow): Exclude<EntitlementSchedule, { version: 0 }> {
  const version = safeVersion(row.version);
  if (row.plan === "free") {
    if (row.accessThrough !== null || row.graceThrough !== null) {
      throw new Error("Stored Free entitlement schedule is invalid");
    }
    return {
      accountId: row.accountId,
      userId: row.userId,
      version,
      plan: "free",
      effectiveAt: new Date(row.effectiveAt.getTime()),
    };
  }
  if (row.accessThrough === null)
    throw new Error("Stored Pro entitlement is missing accessThrough");
  return {
    accountId: row.accountId,
    userId: row.userId,
    version,
    plan: "pro",
    effectiveAt: new Date(row.effectiveAt.getTime()),
    accessThrough: new Date(row.accessThrough.getTime()),
    ...(row.graceThrough ? { graceThrough: new Date(row.graceThrough.getTime()) } : {}),
  };
}

function normalizedInput(input: ApplyEntitlementChangeInput): ApplyEntitlementChangeInput {
  assertExactKeys(
    input,
    [
      "userId",
      "expectedVersion",
      "idempotencyKey",
      "grant",
      "reasonCode",
      "actor",
      "occurredAt",
      "traceId",
    ],
    "entitlement command",
  );
  assertExactKeys(input.actor, ["kind", "reference"], "actor");
  assertUuid(input.userId, "userId");
  assertUuid(input.actor.reference, "actor.reference");
  assertUuid(input.traceId, "traceId");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error("expectedVersion must be a nonnegative safe integer");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new Error("Entitlement idempotency key is invalid");
  }
  if (!(entitlementReasonCodes as readonly string[]).includes(input.reasonCode)) {
    throw new Error("Entitlement reason code is invalid");
  }
  if (!(entitlementActorKinds as readonly string[]).includes(input.actor.kind)) {
    throw new Error("Entitlement actor kind is invalid");
  }
  const validAttribution =
    (input.reasonCode === "synthetic_grant" &&
      input.actor.kind === "system" &&
      input.grant.plan === "pro") ||
    (input.reasonCode === "synthetic_revoke" &&
      input.actor.kind === "system" &&
      input.grant.plan === "free") ||
    (input.reasonCode === "reconciliation" && input.actor.kind === "system") ||
    (input.reasonCode === "provider_projection" && input.actor.kind === "provider_adapter") ||
    (input.reasonCode === "support_adjustment" && input.actor.kind === "support");
  if (!validAttribution) throw new Error("Entitlement actor and reason do not match");
  const grant = validateGrant(input.grant);
  const occurredAt = exactDate(input.occurredAt, "occurredAt");
  if (grant.effectiveAt > occurredAt) {
    throw new Error(
      "Entitlement projections cannot be future-effective in the v1 single-row model",
    );
  }
  return {
    userId: input.userId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    grant,
    reasonCode: input.reasonCode,
    actor: { kind: input.actor.kind, reference: input.actor.reference },
    occurredAt,
    traceId: input.traceId,
  } as ApplyEntitlementChangeInput;
}

function commandHash(input: ApplyEntitlementChangeInput): string {
  const grant =
    input.grant.plan === "free"
      ? { plan: "free", effectiveAt: input.grant.effectiveAt.toISOString() }
      : {
          plan: "pro",
          effectiveAt: input.grant.effectiveAt.toISOString(),
          accessThrough: input.grant.accessThrough.toISOString(),
          ...(input.grant.graceThrough
            ? { graceThrough: input.grant.graceThrough.toISOString() }
            : {}),
        };
  return createHash("sha256")
    .update(
      JSON.stringify({
        userId: input.userId,
        expectedVersion: input.expectedVersion,
        grant,
        reasonCode: input.reasonCode,
        actor: input.actor,
      }),
    )
    .digest("hex");
}

export class PostgresBillingStore implements EntitlementReader {
  constructor(
    private readonly client: postgres.Sql,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async readEntitlement(userId: string): Promise<EntitlementSchedule> {
    assertUuid(userId, "userId");
    const [row] = await this.client<AccountRow[]>`
      SELECT id AS "accountId", user_id AS "userId", version::text AS version, plan,
        effective_at AS "effectiveAt", access_through AS "accessThrough",
        grace_through AS "graceThrough", updated_at AS "updatedAt"
      FROM billing.entitlement_accounts
      WHERE user_id = ${userId}
    `;
    return row ? scheduleFromRow(row) : { userId, version: 0, plan: "free" };
  }

  async applyEntitlementChange(
    candidate: ApplyEntitlementChangeInput,
  ): Promise<ApplyEntitlementChangeResult> {
    const input = normalizedInput(candidate);
    const requestHash = commandHash(input);
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`billing:entitlement:${input.userId}`}))`;
      const [receipt] = await transaction<ReceiptRow[]>`
        SELECT receipt.entitlement_account_id AS "accountId", receipt.user_id AS "userId",
          receipt.response_version::text AS version, change.plan,
          change.effective_at AS "effectiveAt", change.access_through AS "accessThrough",
          change.grace_through AS "graceThrough", change.occurred_at AS "updatedAt",
          receipt.request_hash AS "requestHash",
          receipt.change_id AS "changeId", receipt.outbox_event_id AS "outboxEventId"
        FROM billing.entitlement_command_receipts AS receipt
        JOIN billing.entitlement_changes AS change
          ON change.id = receipt.change_id
          AND change.entitlement_account_id = receipt.entitlement_account_id
          AND change.user_id = receipt.user_id
          AND change.version = receipt.response_version
        WHERE receipt.user_id = ${input.userId}
          AND receipt.idempotency_key = ${input.idempotencyKey}
      `;
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new EntitlementIdempotencyConflictError();
        return {
          schedule: scheduleFromRow(receipt),
          changeId: receipt.changeId,
          outboxEventId: receipt.outboxEventId,
          replayed: true,
        };
      }

      const trustedNow = exactDate(this.clock(), "trusted clock");
      if (input.occurredAt > trustedNow) throw new EntitlementChronologyError();

      const [current] = await transaction<AccountRow[]>`
        SELECT id AS "accountId", user_id AS "userId", version::text AS version, plan,
          effective_at AS "effectiveAt", access_through AS "accessThrough",
          grace_through AS "graceThrough", updated_at AS "updatedAt"
        FROM billing.entitlement_accounts
        WHERE user_id = ${input.userId}
        FOR UPDATE
      `;
      const currentVersion = current ? safeVersion(current.version) : 0;
      if (currentVersion !== input.expectedVersion) throw new EntitlementVersionConflictError();
      if (current && input.occurredAt < current.updatedAt) {
        throw new EntitlementChronologyError();
      }

      const accountId = current?.accountId ?? uuidv7();
      if (currentVersion === maximumEntitlementVersion) {
        throw new EntitlementVersionExhaustedError();
      }
      const version = currentVersion + 1;
      const accessThrough = input.grant.plan === "pro" ? input.grant.accessThrough : null;
      const graceThrough = input.grant.plan === "pro" ? (input.grant.graceThrough ?? null) : null;
      if (current) {
        const updated = await transaction`
          UPDATE billing.entitlement_accounts
          SET version = ${version}, plan = ${input.grant.plan},
            effective_at = ${input.grant.effectiveAt}, access_through = ${accessThrough},
            grace_through = ${graceThrough}, updated_at = ${input.occurredAt}
          WHERE id = ${accountId} AND version = ${input.expectedVersion}
        `;
        if (updated.count !== 1) throw new EntitlementVersionConflictError();
      } else {
        await transaction`
          INSERT INTO billing.entitlement_accounts (
            id, user_id, version, plan, effective_at, access_through, grace_through, updated_at
          ) VALUES (
            ${accountId}, ${input.userId}, ${version}, ${input.grant.plan},
            ${input.grant.effectiveAt}, ${accessThrough}, ${graceThrough}, ${input.occurredAt}
          )
        `;
      }

      const changeId = uuidv7();
      const outboxEventId = uuidv7();
      await transaction`
        INSERT INTO billing.entitlement_changes (
          id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
          access_through, grace_through, reason_code, actor_kind, actor_reference, trace_id,
          occurred_at
        ) VALUES (
          ${changeId}, ${accountId}, ${input.userId}, ${version}, ${current?.plan ?? null},
          ${input.grant.plan}, ${input.grant.effectiveAt}, ${accessThrough}, ${graceThrough},
          ${input.reasonCode}, ${input.actor.kind}, ${input.actor.reference}, ${input.traceId},
          ${input.occurredAt}
        )
      `;
      const eventData = {
        entitlementAccountId: accountId,
        userId: input.userId,
        version,
      };
      await transaction`
        INSERT INTO billing.entitlement_outbox (
          id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
          occurred_at, available_at
        ) VALUES (
          ${outboxEventId}, ${accountId}, ${input.userId}, ${version},
          ${eventTypes.subscriptionEntitlementChanged}, ${`entitlement-account/${accountId}`},
          ${transaction.json(eventData)}, ${input.occurredAt}, ${input.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO billing.entitlement_command_receipts (
          user_id, idempotency_key, request_hash, entitlement_account_id, response_version,
          change_id, outbox_event_id, created_at
        ) VALUES (
          ${input.userId}, ${input.idempotencyKey}, ${requestHash}, ${accountId}, ${version},
          ${changeId}, ${outboxEventId}, ${input.occurredAt}
        )
      `;

      return {
        schedule: {
          accountId,
          userId: input.userId,
          version,
          plan: input.grant.plan,
          effectiveAt: new Date(input.grant.effectiveAt.getTime()),
          ...(input.grant.plan === "pro"
            ? {
                accessThrough: new Date(input.grant.accessThrough.getTime()),
                ...(input.grant.graceThrough
                  ? { graceThrough: new Date(input.grant.graceThrough.getTime()) }
                  : {}),
              }
            : {}),
        } as Exclude<EntitlementSchedule, { version: 0 }>,
        changeId,
        outboxEventId,
        replayed: false,
      };
    });
  }

  async claimOutbox(input: {
    now: Date;
    limit: number;
    leaseMilliseconds: number;
  }): Promise<ClaimedEntitlementEvent[]> {
    const now = exactDate(input.now, "now");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Entitlement outbox claim limit must be between 1 and 100");
    }
    if (
      !Number.isSafeInteger(input.leaseMilliseconds) ||
      input.leaseMilliseconds < 1_000 ||
      input.leaseMilliseconds > 300_000
    ) {
      throw new Error("Entitlement outbox lease must be between 1000 and 300000 milliseconds");
    }
    const claimToken = uuidv7();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMilliseconds);
    const rows = await this.client<
      Array<{
        id: string;
        subject: string;
        payload: unknown;
        occurredAt: Date;
        attemptCount: number;
      }>
    >`
      WITH terminalized AS (
        UPDATE billing.entitlement_outbox
        SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
          failed_at = ${now}, last_error_code = COALESCE(last_error_code, 'lease_expired')
        WHERE status = 'processing' AND lease_expires_at <= ${now}
          AND attempt_count >= ${maximumEntitlementOutboxAttempts}
        RETURNING id
      ), candidates AS (
        SELECT id
        FROM billing.entitlement_outbox
        WHERE ((status = 'pending' AND available_at <= ${now})
          OR (status = 'processing' AND lease_expires_at <= ${now}))
          AND attempt_count < ${maximumEntitlementOutboxAttempts}
        ORDER BY occurred_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE billing.entitlement_outbox AS event
      SET status = 'processing', claim_token = ${claimToken}, lease_expires_at = ${leaseExpiresAt},
        attempt_count = event.attempt_count + 1, failed_at = NULL, last_error_code = NULL
      FROM candidates
      WHERE event.id = candidates.id
      RETURNING event.id, event.subject, event.payload, event.occurred_at AS "occurredAt",
        event.attempt_count AS "attemptCount"
    `;
    return rows.map((row) => {
      assertUuid(row.id, "stored outbox id");
      const data = claimedEventData(row.payload);
      if (row.subject !== `entitlement-account/${data.entitlementAccountId}`) {
        throw new Error("Stored entitlement event subject is invalid");
      }
      if (!Number.isSafeInteger(row.attemptCount) || row.attemptCount < 1) {
        throw new Error("Stored entitlement event attempt count is invalid");
      }
      return {
        id: row.id,
        type: eventTypes.subscriptionEntitlementChanged,
        subject: row.subject,
        data,
        occurredAt: exactDate(row.occurredAt, "stored event occurredAt"),
        claimToken,
        attemptCount: row.attemptCount,
      };
    });
  }

  async markOutboxPublished(input: {
    id: string;
    claimToken: string;
    publishedAt: Date;
  }): Promise<void> {
    assertUuid(input.id, "outbox id");
    assertUuid(input.claimToken, "claimToken");
    const publishedAt = exactDate(input.publishedAt, "publishedAt");
    const result = await this.client`
      UPDATE billing.entitlement_outbox
      SET status = 'published', claim_token = NULL, lease_expires_at = NULL,
        published_at = ${publishedAt}, last_error_code = NULL
      WHERE id = ${input.id} AND status = 'processing' AND claim_token = ${input.claimToken}
        AND ${publishedAt} >= occurred_at
        AND ${publishedAt} < lease_expires_at
    `;
    if (result.count !== 1) throw new EntitlementOutboxClaimError();
  }

  async releaseOutbox(input: {
    id: string;
    claimToken: string;
    now: Date;
    retryAt: Date;
    errorCode: "transient" | "publisher_unavailable";
  }): Promise<void> {
    assertUuid(input.id, "outbox id");
    assertUuid(input.claimToken, "claimToken");
    const now = exactDate(input.now, "now");
    const retryAt = exactDate(input.retryAt, "retryAt");
    if (retryAt <= now) throw new EntitlementOutboxClaimError();
    const result = await this.client`
      UPDATE billing.entitlement_outbox
      SET status = CASE
          WHEN attempt_count >= ${maximumEntitlementOutboxAttempts} THEN 'failed'
          ELSE 'pending'
        END,
        claim_token = NULL,
        lease_expires_at = NULL,
        available_at = CASE
          WHEN attempt_count >= ${maximumEntitlementOutboxAttempts} THEN available_at
          ELSE ${retryAt}
        END,
        failed_at = CASE
          WHEN attempt_count >= ${maximumEntitlementOutboxAttempts} THEN ${now}
          ELSE NULL
        END,
        last_error_code = ${input.errorCode}
      WHERE id = ${input.id} AND status = 'processing' AND claim_token = ${input.claimToken}
        AND ${now} >= occurred_at AND ${now} < lease_expires_at AND ${retryAt} > ${now}
    `;
    if (result.count !== 1) throw new EntitlementOutboxClaimError();
  }

  async ping(): Promise<void> {
    const [boundary] = await this.client<
      Array<{
        migrationCount: number;
        foundationChecksum: string | null;
        candidateRightsChecksum: string | null;
        relationsReady: boolean;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM billing.schema_migrations) AS "migrationCount",
        (SELECT checksum FROM billing.schema_migrations
          WHERE version = '0001_entitlement_projection') AS "foundationChecksum",
        (SELECT checksum FROM billing.schema_migrations
          WHERE version = '0002_candidate_rights') AS "candidateRightsChecksum",
        (
          to_regclass('billing.entitlement_accounts') IS NOT NULL
          AND to_regclass('billing.entitlement_changes') IS NOT NULL
          AND to_regclass('billing.entitlement_command_receipts') IS NOT NULL
          AND to_regclass('billing.entitlement_outbox') IS NOT NULL
          AND to_regclass('billing.schema_migrations') IS NOT NULL
        ) AS "relationsReady"
    `;
    if (
      boundary?.migrationCount !== 2 ||
      boundary.foundationChecksum !==
        "05368bb42a9c6ed3007b61f80a980a921d1f02bbcac633a4ecfd0b4c7dcf0ba0" ||
      boundary.candidateRightsChecksum !==
        "d99303245eb56aa3e926487acac2911b447993f0b057829822b96944ad332812" ||
      boundary.relationsReady !== true
    ) {
      throw new Error("Billing schema boundary is unavailable");
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
