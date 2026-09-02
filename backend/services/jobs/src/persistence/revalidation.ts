import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type { JobStatus } from "../domain/canonical-job.js";
import {
  planFreshnessClock,
  planFreshnessSignal,
  type SourceFreshnessPolicy,
} from "../freshness-policy.js";
import type {
  AdministrativeBlockInput,
  IndependentEvidenceInput,
  LifecycleTransition,
  RevalidationQueueItem,
  SourceIdentity,
  SourceRevalidationStore,
} from "../revalidation.js";

interface QueueRow {
  id: string;
  jobId: string;
  sourceId: string;
  provider: RevalidationQueueItem["provider"];
  pageVariant: RevalidationQueueItem["pageVariant"];
  signalKind: RevalidationQueueItem["signalKind"];
  priority: number;
  state: RevalidationQueueItem["state"];
  attempt: number;
  maxAttempts: number;
  availableAt: Date | string;
  claimedBy: string | null;
  claimExpiresAt: Date | string | null;
}

interface LockedSourceRow {
  jobId: string;
  sourceId: string;
  provider: string;
  status: JobStatus;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

interface EvidenceRow {
  id: string;
  jobId: string;
  sourceId: string | null;
  provider: string | null;
  pageVariant: string | null;
  evidenceKind: string;
  evidenceDigestSha256: string;
  policyVersion: string;
  verifiedAt: Date;
  validThrough: Date | null;
  recordedAt: Date;
}

function date(value: Date | string, label: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Malformed ${label} timestamp`);
  return parsed;
}

function queueItem(row: QueueRow): RevalidationQueueItem {
  return {
    id: row.id,
    jobId: row.jobId,
    sourceId: row.sourceId,
    provider: row.provider,
    pageVariant: row.pageVariant,
    signalKind: row.signalKind,
    priority: row.priority === 2 ? "high" : "normal",
    state: row.state,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    availableAt: date(row.availableAt, "queue availability"),
    ...(row.claimedBy ? { claimedBy: row.claimedBy } : {}),
    ...(row.claimExpiresAt
      ? { claimExpiresAt: date(row.claimExpiresAt, "queue claim expiry") }
      : {}),
  };
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

function exactEvidenceReplay(row: EvidenceRow, input: IndependentEvidenceInput): boolean {
  return (
    row.jobId === input.jobId &&
    row.sourceId === input.sourceId &&
    row.provider === input.provider &&
    row.pageVariant === input.pageVariant &&
    row.evidenceKind === input.evidenceKind &&
    row.evidenceDigestSha256 === input.evidenceDigestSha256 &&
    row.verifiedAt.getTime() === input.verifiedAt.getTime() &&
    (row.validThrough?.getTime() ?? null) === (input.validThrough?.getTime() ?? null) &&
    row.recordedAt.getTime() === input.recordedAt.getTime()
  );
}

async function bumpCatalogRevision(transaction: postgres.TransactionSql): Promise<void> {
  await transaction`
    UPDATE jobs.catalog_search_state
    SET revision = revision + 1
    WHERE singleton
  `;
}

async function insertStatusEvent(
  transaction: postgres.TransactionSql,
  jobId: string,
  fromStatus: JobStatus,
  toStatus: JobStatus,
  reason: string,
  occurredAt: Date,
): Promise<void> {
  if (fromStatus === toStatus) return;
  await transaction`
    INSERT INTO jobs.status_events (id, job_id, from_status, to_status, reason, occurred_at)
    VALUES (${uuidv7()}, ${jobId}, ${fromStatus}, ${toStatus}, ${reason}, ${occurredAt})
  `;
}

async function clearTerminalPayloads(
  transaction: postgres.TransactionSql,
  jobId: string,
): Promise<void> {
  await transaction`
    UPDATE jobs.canonical_jobs
    SET description = NULL, description_hash = NULL, department = NULL,
      normalized_department = NULL, application_url = NULL, structured_locations = NULL,
      valid_through = NULL
    WHERE id = ${jobId}
  `;
  await transaction`
    UPDATE jobs.job_sources
    SET raw_snapshot = NULL, application_url = NULL, structured_locations = NULL,
      valid_through = NULL
    WHERE job_id = ${jobId}
  `;
}

export class PostgresSourceRevalidationStore implements SourceRevalidationStore {
  constructor(private readonly client: postgres.Sql) {}

  async ping(): Promise<void> {
    const [row] = await this.client<{ ready: boolean }[]>`
      SELECT (
        to_regclass('jobs.source_revalidation_queue') IS NOT NULL
        AND to_regclass('jobs.source_verification_evidence') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jobs.schema_migrations
          WHERE version = '0015_source_revalidation_lifecycle'
        )
      ) AS ready
    `;
    if (!row?.ready) throw new Error("The source revalidation schema is unavailable");
  }

  async enqueue(
    input: Parameters<SourceRevalidationStore["enqueue"]>[0],
  ): Promise<RevalidationQueueItem> {
    const id = uuidv7();
    const priority = input.priority === "high" ? 2 : 1;
    const [row] = await this.client<QueueRow[]>`
      INSERT INTO jobs.source_revalidation_queue (
        id, job_id, source_id, provider, page_variant, signal_kind,
        signal_digest_sha256, priority, state, attempt, max_attempts,
        available_at, claimed_at, claim_expires_at, claimed_by, last_error_code,
        created_at, updated_at
      ) VALUES (
        ${id}, ${input.identity.jobId}, ${input.identity.sourceId},
        ${input.identity.provider}, ${input.identity.pageVariant}, ${input.signalKind},
        ${input.signalDigestSha256}, ${priority}, 'pending', 0, ${input.maxAttempts},
        ${input.availableAt}, NULL, NULL, NULL, NULL, ${input.availableAt}, ${input.availableAt}
      )
      ON CONFLICT (source_id, signal_digest_sha256) DO NOTHING
      RETURNING id, job_id AS "jobId", source_id AS "sourceId", provider,
        page_variant AS "pageVariant", signal_kind AS "signalKind", priority, state,
        attempt, max_attempts AS "maxAttempts", available_at AS "availableAt",
        claimed_by AS "claimedBy", claim_expires_at AS "claimExpiresAt"
    `;
    if (row) return queueItem(row);
    const [replay] = await this.client<QueueRow[]>`
      SELECT id, job_id AS "jobId", source_id AS "sourceId", provider,
        page_variant AS "pageVariant", signal_kind AS "signalKind", priority, state,
        attempt, max_attempts AS "maxAttempts", available_at AS "availableAt",
        claimed_by AS "claimedBy", claim_expires_at AS "claimExpiresAt"
      FROM jobs.source_revalidation_queue
      WHERE source_id = ${input.identity.sourceId}
        AND signal_digest_sha256 = ${input.signalDigestSha256}
    `;
    if (
      !replay ||
      replay.jobId !== input.identity.jobId ||
      replay.provider !== input.identity.provider ||
      replay.pageVariant !== input.identity.pageVariant ||
      replay.signalKind !== input.signalKind ||
      replay.priority !== priority ||
      replay.maxAttempts !== input.maxAttempts
    ) {
      throw new Error("The revalidation signal conflicts with persisted idempotency truth");
    }
    return queueItem(replay);
  }

  async claim(
    input: Parameters<SourceRevalidationStore["claim"]>[0],
  ): Promise<RevalidationQueueItem[]> {
    return this.client.begin(async (transaction) => {
      await transaction`
        UPDATE jobs.source_revalidation_queue
        SET state = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
          available_at = GREATEST(available_at, ${input.now}),
          claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
          last_error_code = CASE WHEN attempt >= max_attempts
            THEN 'ClaimLeaseExhausted' ELSE 'ClaimLeaseExpired' END,
          updated_at = ${input.now}
        WHERE state = 'claimed' AND claim_expires_at <= ${input.now}
      `;
      const rows = await transaction<QueueRow[]>`
        WITH candidates AS (
          SELECT id
          FROM jobs.source_revalidation_queue
          WHERE state = 'pending' AND available_at <= ${input.now}
          ORDER BY priority DESC, available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${input.limit}
        )
        UPDATE jobs.source_revalidation_queue AS queue
        SET state = 'claimed', attempt = queue.attempt + 1,
          claimed_at = ${input.now}, claim_expires_at = ${input.claimExpiresAt},
          claimed_by = ${input.workerId}, last_error_code = NULL, updated_at = ${input.now}
        FROM candidates
        WHERE queue.id = candidates.id
        RETURNING queue.id, queue.job_id AS "jobId", queue.source_id AS "sourceId",
          queue.provider, queue.page_variant AS "pageVariant",
          queue.signal_kind AS "signalKind", queue.priority, queue.state, queue.attempt,
          queue.max_attempts AS "maxAttempts", queue.available_at AS "availableAt",
          queue.claimed_by AS "claimedBy", queue.claim_expires_at AS "claimExpiresAt"
      `;
      return rows.map(queueItem);
    });
  }

  async failClaim(
    input: Parameters<SourceRevalidationStore["failClaim"]>[0],
  ): Promise<RevalidationQueueItem> {
    const [row] = await this.client<QueueRow[]>`
      UPDATE jobs.source_revalidation_queue
      SET state = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
        available_at = CASE WHEN attempt >= max_attempts THEN ${input.now} ELSE ${input.retryAt} END,
        claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.errorCode}, updated_at = ${input.now}
      WHERE id = ${input.item.id} AND state = 'claimed'
        AND claimed_by = ${input.workerId} AND attempt = ${input.item.attempt}
      RETURNING id, job_id AS "jobId", source_id AS "sourceId", provider,
        page_variant AS "pageVariant", signal_kind AS "signalKind", priority, state,
        attempt, max_attempts AS "maxAttempts", available_at AS "availableAt",
        claimed_by AS "claimedBy", claim_expires_at AS "claimExpiresAt"
    `;
    if (!row) throw new Error("The source revalidation claim is stale or not owned");
    return queueItem(row);
  }

  async recordIndependentEvidence(
    input: IndependentEvidenceInput,
    policy: SourceFreshnessPolicy,
  ): Promise<LifecycleTransition> {
    return this.client.begin(async (transaction) => {
      const [existing] = await transaction<EvidenceRow[]>`
        SELECT id, job_id AS "jobId", source_id AS "sourceId", provider,
          page_variant AS "pageVariant", evidence_kind AS "evidenceKind",
          evidence_digest_sha256 AS "evidenceDigestSha256", policy_version AS "policyVersion",
          verified_at AS "verifiedAt", valid_through AS "validThrough",
          recorded_at AS "recordedAt"
        FROM jobs.source_verification_evidence
        WHERE evidence_digest_sha256 = ${input.evidenceDigestSha256}
      `;
      if (existing) {
        if (
          !exactEvidenceReplay(existing, input) ||
          existing.policyVersion !== policy.policyVersion
        ) {
          throw new Error("Independent evidence digest conflicts with persisted truth");
        }
        if (input.claim)
          await this.completeClaim(
            transaction,
            input,
            input.claim.id,
            input.claim.workerId,
            input.recordedAt,
          );
        const [current] = await transaction<{ status: JobStatus }[]>`
          SELECT status FROM jobs.canonical_jobs WHERE id = ${input.jobId}
        `;
        if (!current) throw new Error("The evidence job no longer exists");
        return {
          jobId: input.jobId,
          fromStatus: current.status,
          toStatus: current.status,
          evidenceId: existing.id,
          replayed: true,
        };
      }

      const locked = await this.lockSource(transaction, input);
      if (["expired", "withdrawn", "blocked"].includes(locked.status)) {
        throw new Error("Terminal tombstones require a separate verified re-ingestion path");
      }
      const plan = planFreshnessSignal(
        {
          status: locked.status,
          lastVerifiedAt: locked.lastVerifiedAt,
          expiresAt: locked.expiresAt,
        },
        input.evidenceKind === "independent_positive_verification"
          ? {
              kind: input.evidenceKind,
              verifiedAt: input.verifiedAt,
              ...(input.validThrough ? { validThrough: input.validThrough } : {}),
            }
          : { kind: input.evidenceKind, verifiedAt: input.verifiedAt },
        policy,
      );
      const evidenceId = uuidv7();
      await transaction`
        INSERT INTO jobs.source_verification_evidence (
          id, job_id, source_id, provider, page_variant, evidence_kind,
          evidence_digest_sha256, policy_version, verified_at, valid_through, recorded_at
        ) VALUES (
          ${evidenceId}, ${input.jobId}, ${input.sourceId}, ${input.provider},
          ${input.pageVariant}, ${input.evidenceKind}, ${input.evidenceDigestSha256},
          ${policy.policyVersion}, ${input.verifiedAt}, ${input.validThrough ?? null},
          ${input.recordedAt}
        )
      `;

      let toStatus = plan.status;
      let canonicalFreshnessChanged = true;
      if (input.evidenceKind === "independent_positive_verification") {
        await transaction`
          UPDATE jobs.job_sources
          SET last_observed_at = GREATEST(last_observed_at, ${input.verifiedAt}),
            last_verified_at = ${input.verifiedAt}, withdrawn_at = NULL,
            valid_through = ${input.validThrough ?? null}, updated_at = ${input.recordedAt}
          WHERE id = ${input.sourceId}
        `;
      } else {
        await transaction`
          UPDATE jobs.job_sources
          SET last_observed_at = GREATEST(last_observed_at, ${input.verifiedAt}),
            last_verified_at = ${input.verifiedAt}, withdrawn_at = ${input.verifiedAt},
            raw_snapshot = NULL, application_url = NULL, structured_locations = NULL,
            valid_through = NULL, updated_at = ${input.recordedAt}
          WHERE id = ${input.sourceId}
        `;
        const [remaining] = await transaction<{ count: number }[]>`
          SELECT count(*)::int AS count FROM jobs.job_sources
          WHERE job_id = ${input.jobId} AND withdrawn_at IS NULL
        `;
        if ((remaining?.count ?? 0) > 0) {
          toStatus = locked.status;
          canonicalFreshnessChanged = false;
        }
      }

      if (canonicalFreshnessChanged) {
        await transaction`
          UPDATE jobs.canonical_jobs
          SET status = ${toStatus},
            status_reason = ${`d2.${plan.transitionReason}`},
            last_verified_at = CASE WHEN ${plan.verificationClockAdvanced}
              THEN ${plan.lastVerifiedAt} ELSE last_verified_at END,
            expires_at = CASE WHEN ${plan.verificationClockAdvanced}
              THEN ${plan.expiresAt} ELSE expires_at END,
            consecutive_verification_failures = 0,
            updated_at = ${input.recordedAt}
          WHERE id = ${input.jobId}
        `;
      }
      if (["expired", "withdrawn", "blocked"].includes(toStatus)) {
        await clearTerminalPayloads(transaction, input.jobId);
      }
      await insertStatusEvent(
        transaction,
        input.jobId,
        locked.status,
        toStatus,
        `d2.${plan.transitionReason}`,
        input.recordedAt,
      );
      await bumpCatalogRevision(transaction);
      if (input.claim)
        await this.completeClaim(
          transaction,
          input,
          input.claim.id,
          input.claim.workerId,
          input.recordedAt,
        );
      return {
        jobId: input.jobId,
        fromStatus: locked.status,
        toStatus,
        evidenceId,
        replayed: false,
      };
    });
  }

  async applyFreshnessClock(
    identity: SourceIdentity,
    now: Date,
    policy: SourceFreshnessPolicy,
    maxAttempts: number,
  ): Promise<LifecycleTransition> {
    return this.client.begin(async (transaction) => {
      const locked = await this.lockSource(transaction, identity);
      const plan = planFreshnessClock(
        {
          status: locked.status,
          lastVerifiedAt: locked.lastVerifiedAt,
          expiresAt: locked.expiresAt,
        },
        now,
        policy,
      );
      if (plan.status === locked.status && plan.revalidationPriority === "none") {
        return {
          jobId: identity.jobId,
          fromStatus: locked.status,
          toStatus: locked.status,
          replayed: true,
        };
      }
      if (plan.revalidationPriority === "high") {
        const signalDigest = digest([
          "source-revalidation-policy-suspect-v1",
          identity.jobId,
          identity.sourceId,
          policy.policyVersion,
          locked.lastVerifiedAt.toISOString(),
        ]);
        await transaction`
          INSERT INTO jobs.source_revalidation_queue (
            id, job_id, source_id, provider, page_variant, signal_kind,
            signal_digest_sha256, priority, state, attempt, max_attempts,
            available_at, claimed_at, claim_expires_at, claimed_by, last_error_code,
            created_at, updated_at
          ) VALUES (
            ${uuidv7()}, ${identity.jobId}, ${identity.sourceId}, ${identity.provider},
            ${identity.pageVariant}, 'policy_suspect', ${signalDigest}, 2, 'pending', 0,
            ${maxAttempts}, ${now}, NULL, NULL, NULL, NULL, ${now}, ${now}
          ) ON CONFLICT (source_id, signal_digest_sha256) DO NOTHING
        `;
      }
      if (plan.status !== locked.status) {
        await transaction`
          UPDATE jobs.canonical_jobs
          SET status = ${plan.status}, status_reason = ${`d2.${plan.transitionReason}`},
            updated_at = ${now}
          WHERE id = ${identity.jobId}
        `;
        if (plan.status === "expired") await clearTerminalPayloads(transaction, identity.jobId);
        await insertStatusEvent(
          transaction,
          identity.jobId,
          locked.status,
          plan.status,
          `d2.${plan.transitionReason}`,
          now,
        );
        await bumpCatalogRevision(transaction);
      }
      return {
        jobId: identity.jobId,
        fromStatus: locked.status,
        toStatus: plan.status,
        replayed: plan.status === locked.status,
      };
    });
  }

  async recordAdministrativeBlock(input: AdministrativeBlockInput): Promise<LifecycleTransition> {
    return this.client.begin(async (transaction) => {
      const [existing] = await transaction<EvidenceRow[]>`
        SELECT id, job_id AS "jobId", source_id AS "sourceId", provider,
          page_variant AS "pageVariant", evidence_kind AS "evidenceKind",
          evidence_digest_sha256 AS "evidenceDigestSha256", policy_version AS "policyVersion",
          verified_at AS "verifiedAt", valid_through AS "validThrough",
          recorded_at AS "recordedAt"
        FROM jobs.source_verification_evidence
        WHERE evidence_digest_sha256 = ${input.evidenceDigestSha256}
      `;
      if (existing) {
        if (
          existing.jobId !== input.jobId ||
          existing.evidenceKind !== "authorized_administrative_block" ||
          existing.policyVersion !== input.policyVersion ||
          existing.verifiedAt.getTime() !== input.decidedAt.getTime() ||
          existing.recordedAt.getTime() !== input.recordedAt.getTime()
        ) {
          throw new Error("Administrative evidence digest conflicts with persisted truth");
        }
        const [current] = await transaction<{ status: JobStatus }[]>`
          SELECT status FROM jobs.canonical_jobs WHERE id = ${input.jobId}
        `;
        if (!current) throw new Error("The administrative decision job no longer exists");
        return {
          jobId: input.jobId,
          fromStatus: current.status,
          toStatus: current.status,
          evidenceId: existing.id,
          replayed: true,
        };
      }
      const [job] = await transaction<{ status: JobStatus }[]>`
        SELECT status FROM jobs.canonical_jobs WHERE id = ${input.jobId} FOR UPDATE
      `;
      if (!job) throw new Error("The administrative decision job does not exist");
      const evidenceId = uuidv7();
      await transaction`
        INSERT INTO jobs.source_verification_evidence (
          id, job_id, source_id, provider, page_variant, evidence_kind,
          evidence_digest_sha256, policy_version, verified_at, valid_through, recorded_at
        ) VALUES (
          ${evidenceId}, ${input.jobId}, NULL, NULL, NULL,
          'authorized_administrative_block', ${input.evidenceDigestSha256},
          ${input.policyVersion}, ${input.decidedAt}, NULL, ${input.recordedAt}
        )
      `;
      await transaction`
        UPDATE jobs.canonical_jobs
        SET status = 'blocked', status_reason = ${`d2.${input.reasonCode}`},
          updated_at = ${input.recordedAt}
        WHERE id = ${input.jobId}
      `;
      await clearTerminalPayloads(transaction, input.jobId);
      await insertStatusEvent(
        transaction,
        input.jobId,
        job.status,
        "blocked",
        `d2.${input.reasonCode}`,
        input.recordedAt,
      );
      await bumpCatalogRevision(transaction);
      return {
        jobId: input.jobId,
        fromStatus: job.status,
        toStatus: "blocked",
        evidenceId,
        replayed: false,
      };
    });
  }

  private async lockSource(
    transaction: postgres.TransactionSql,
    identity: SourceIdentity,
  ): Promise<LockedSourceRow> {
    const [row] = await transaction<LockedSourceRow[]>`
      SELECT canonical.id AS "jobId", source.id AS "sourceId", source.provider,
        canonical.status, canonical.last_verified_at AS "lastVerifiedAt",
        canonical.expires_at AS "expiresAt"
      FROM jobs.canonical_jobs AS canonical
      INNER JOIN jobs.job_sources AS source ON source.job_id = canonical.id
      WHERE canonical.id = ${identity.jobId} AND source.id = ${identity.sourceId}
        AND source.provider = ${identity.provider}
      FOR UPDATE OF canonical, source
    `;
    if (!row) throw new Error("The source identity does not match catalog truth");
    return row;
  }

  private async completeClaim(
    transaction: postgres.TransactionSql,
    identity: SourceIdentity,
    claimId: string,
    workerId: string,
    completedAt: Date,
  ): Promise<void> {
    const rows = await transaction`
      UPDATE jobs.source_revalidation_queue
      SET state = 'completed', claimed_at = NULL, claim_expires_at = NULL,
        claimed_by = NULL, last_error_code = NULL, updated_at = ${completedAt}
      WHERE id = ${claimId} AND state = 'claimed' AND claimed_by = ${workerId}
        AND job_id = ${identity.jobId} AND source_id = ${identity.sourceId}
        AND provider = ${identity.provider} AND page_variant = ${identity.pageVariant}
    `;
    if (rows.count === 1) return;
    const [completed] = await transaction<{ completed: boolean }[]>`
      SELECT (
        state = 'completed' AND job_id = ${identity.jobId}
        AND source_id = ${identity.sourceId} AND provider = ${identity.provider}
        AND page_variant = ${identity.pageVariant}
      ) AS completed
      FROM jobs.source_revalidation_queue WHERE id = ${claimId}
    `;
    if (!completed?.completed) {
      throw new Error("The source revalidation completion claim is stale");
    }
  }
}
