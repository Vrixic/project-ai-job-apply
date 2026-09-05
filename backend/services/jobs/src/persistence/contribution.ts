import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type CreateJobContributionCommand,
  JobContributionIdempotencyConflictError,
  type JobContributionState,
  type JobContributionStatus,
  type JobContributionStore,
} from "../contribution.js";

interface ContributionRow {
  id: string;
  state: JobContributionState;
  requestHash: string;
  submittedAt: Date | string;
  updatedAt: Date | string;
}

type JobContributionStoreStageCode =
  | "JOB_STORE_IDENTITY_READ"
  | "JOB_STORE_INSERT"
  | "JOB_STORE_LOCK"
  | "JOB_STORE_OUTBOX"
  | "JOB_STORE_PAYLOAD"
  | "JOB_STORE_QUEUE"
  | "JOB_STORE_REPLAY_READ"
  | "JOB_STORE_RESULT"
  | "JOB_STORE_TRANSACTION";

class JobContributionStoreStageError extends Error {
  override readonly name = "JobContributionStoreStageError";

  constructor(
    readonly code: JobContributionStoreStageCode,
    options: { cause: unknown },
  ) {
    super("Job contribution persistence stage failed", options);
  }
}

async function atStoreStage<T>(
  code: JobContributionStoreStageCode,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof JobContributionIdempotencyConflictError ||
      error instanceof JobContributionStoreStageError
    ) {
      throw error;
    }
    throw new JobContributionStoreStageError(code, { cause: error });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Malformed contribution timestamp");
  return parsed.toISOString();
}

function status(row: ContributionRow): JobContributionStatus {
  return Object.freeze({
    id: row.id,
    state: row.state,
    submittedAt: timestamp(row.submittedAt),
    updatedAt: timestamp(row.updatedAt),
  });
}

export class PostgresJobContributionStore implements JobContributionStore {
  constructor(private readonly client: postgres.Sql) {}

  async ping(): Promise<void> {
    const [result] = await this.client<{ ready: boolean }[]>`
      SELECT (
        to_regclass('jobs.job_contributions') IS NOT NULL
        AND to_regclass('jobs.job_contribution_outbox') IS NOT NULL
        AND to_regclass('jobs.job_contribution_processing_queue') IS NOT NULL
        AND to_regclass('jobs.job_contribution_processing_event_deliveries') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jobs.schema_migrations
          WHERE version = '0019_job_contribution_provider_publication'
        )
      ) AS ready
    `;
    if (!result?.ready) throw new Error("The Jobs contribution intake schema is unavailable");
  }

  async create(command: CreateJobContributionCommand): Promise<JobContributionStatus> {
    const { idempotencyKeyHash, payloadJson, requestHash } = await atStoreStage(
      "JOB_STORE_PAYLOAD",
      () => {
        const payloadJson = JSON.stringify(command.input);
        if (typeof payloadJson !== "string") {
          throw new TypeError("The contribution payload is not serializable");
        }
        return {
          idempotencyKeyHash: sha256(command.idempotencyKey),
          payloadJson,
          requestHash: sha256(payloadJson),
        };
      },
    );
    return atStoreStage("JOB_STORE_TRANSACTION", () =>
      this.client.begin(async (transaction) => {
        await atStoreStage(
          "JOB_STORE_LOCK",
          () => transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution:${command.ownerUserId}`}))
      `,
        );
        await atStoreStage(
          "JOB_STORE_LOCK",
          () => transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-id:${command.input.contributionId}`}))
      `,
        );
        const [replay] = await atStoreStage(
          "JOB_STORE_REPLAY_READ",
          () => transaction<ContributionRow[]>`
        SELECT id, state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
        FROM jobs.job_contributions
        WHERE owner_user_id = ${command.ownerUserId}
          AND idempotency_key_hash = ${idempotencyKeyHash}
      `,
        );
        if (replay) {
          if (replay.requestHash !== requestHash) {
            throw new JobContributionIdempotencyConflictError();
          }
          return atStoreStage("JOB_STORE_RESULT", () => status(replay));
        }

        const [identityReplay] = await atStoreStage(
          "JOB_STORE_IDENTITY_READ",
          () => transaction<(ContributionRow & { ownerUserId: string })[]>`
        SELECT id, owner_user_id AS "ownerUserId", state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
        FROM jobs.job_contributions WHERE id = ${command.input.contributionId}
      `,
        );
        if (identityReplay) {
          if (
            identityReplay.ownerUserId !== command.ownerUserId ||
            identityReplay.requestHash !== requestHash
          ) {
            throw new JobContributionIdempotencyConflictError();
          }
          return atStoreStage("JOB_STORE_RESULT", () => status(identityReplay));
        }

        const contributionId = command.input.contributionId;
        const outboxId = uuidv7();
        // Gateway clients are also initialized by Drizzle, whose timestamp
        // serializer passes values through. Bind ISO text, not a Date object,
        // so intake, outbox, and queue writes work with either client setup.
        const createdAt = new Date().toISOString();
        const input = command.input;
        const [created] = await atStoreStage(
          "JOB_STORE_INSERT",
          () => transaction<ContributionRow[]>`
        INSERT INTO jobs.job_contributions (
          id, owner_user_id, state, client_surface, client_version,
          provider, page_variant, source_url, external_job_id,
          content_sha256, adapter_version, observed_at, approved_at, consent_id,
          consent_version, policy_version, preview_digest_sha256, payload,
          idempotency_key_hash, request_hash, created_at, updated_at
        ) VALUES (
          ${contributionId}, ${command.ownerUserId}, 'queued', ${input.client.surface},
          ${input.client.version}, ${input.source.provider},
          ${input.source.pageVariant}, ${input.source.sourceUrl}, ${input.source.externalJobId ?? null},
          ${input.observation.contentSha256}, ${input.source.adapterVersion},
          ${input.observation.observedAt}, ${input.approval.approvedAt}, ${input.approval.consentId},
          ${input.approval.consentVersion}, ${input.approval.policyVersion},
          ${input.approval.previewDigestSha256},
          ${payloadJson}::text::jsonb,
          ${idempotencyKeyHash}, ${requestHash}, ${createdAt}, ${createdAt}
        )
        RETURNING id, state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
      `,
        );
        if (!created) {
          throw new JobContributionStoreStageError("JOB_STORE_RESULT", {
            cause: new Error("Contribution insert returned no row"),
          });
        }
        await atStoreStage(
          "JOB_STORE_OUTBOX",
          () => transaction`
        INSERT INTO jobs.job_contribution_outbox (
          id, contribution_id, event_type, subject, data, created_at
        ) VALUES (
          ${outboxId}, ${contributionId}, 'job.contributed.v1', ${contributionId},
          ${JSON.stringify({ contributionId })}::text::jsonb, ${createdAt}
        )
      `,
        );
        await atStoreStage(
          "JOB_STORE_QUEUE",
          () => transaction`
        INSERT INTO jobs.job_contribution_processing_queue (
          id, contribution_id, state, attempt, available_at,
          created_at, updated_at
        ) VALUES (
          ${uuidv7()}, ${contributionId}, 'pending', 0, ${createdAt},
          ${createdAt}, ${createdAt}
        )
      `,
        );
        return atStoreStage("JOB_STORE_RESULT", () => status(created));
      }),
    );
  }

  async get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null> {
    const [row] = await this.client<ContributionRow[]>`
      SELECT contribution.id, COALESCE(latest.state, contribution.state) AS state,
        contribution.request_hash AS "requestHash", contribution.created_at AS "submittedAt",
        COALESCE(latest.occurred_at, contribution.updated_at) AS "updatedAt"
      FROM jobs.job_contributions AS contribution
      LEFT JOIN LATERAL (
        SELECT event.state, event.occurred_at
        FROM jobs.job_contribution_state_events AS event
        WHERE event.contribution_id = contribution.id
        ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1
      ) AS latest ON true
      WHERE contribution.id = ${contributionId} AND contribution.owner_user_id = ${ownerUserId}
    `;
    return row ? status(row) : null;
  }
}
