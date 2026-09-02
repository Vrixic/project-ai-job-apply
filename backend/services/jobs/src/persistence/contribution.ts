import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type CreateJobContributionCommand,
  JobContributionIdempotencyConflictError,
  type JobContributionStatus,
  type JobContributionStore,
} from "../contribution.js";

interface ContributionRow {
  id: string;
  state: "queued";
  requestHash: string;
  submittedAt: Date | string;
  updatedAt: Date | string;
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
        AND EXISTS (
          SELECT 1 FROM jobs.schema_migrations
          WHERE version = '0014_job_contribution_intake'
        )
      ) AS ready
    `;
    if (!result?.ready) throw new Error("The Jobs contribution intake schema is unavailable");
  }

  async create(command: CreateJobContributionCommand): Promise<JobContributionStatus> {
    const idempotencyKeyHash = sha256(command.idempotencyKey);
    const requestHash = sha256(JSON.stringify(command.input));
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution:${command.ownerUserId}`}))
      `;
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-id:${command.input.contributionId}`}))
      `;
      const [replay] = await transaction<ContributionRow[]>`
        SELECT id, state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
        FROM jobs.job_contributions
        WHERE owner_user_id = ${command.ownerUserId}
          AND idempotency_key_hash = ${idempotencyKeyHash}
      `;
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new JobContributionIdempotencyConflictError();
        }
        return status(replay);
      }

      const [identityReplay] = await transaction<(ContributionRow & { ownerUserId: string })[]>`
        SELECT id, owner_user_id AS "ownerUserId", state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
        FROM jobs.job_contributions WHERE id = ${command.input.contributionId}
      `;
      if (identityReplay) {
        if (
          identityReplay.ownerUserId !== command.ownerUserId ||
          identityReplay.requestHash !== requestHash
        ) {
          throw new JobContributionIdempotencyConflictError();
        }
        return status(identityReplay);
      }

      const contributionId = command.input.contributionId;
      const outboxId = uuidv7();
      const createdAt = new Date();
      const input = command.input;
      const [created] = await transaction<ContributionRow[]>`
        INSERT INTO jobs.job_contributions (
          id, owner_user_id, state, provider, page_variant, source_url, external_job_id,
          content_sha256, adapter_version, observed_at, approved_at, consent_id,
          consent_version, policy_version, preview_digest_sha256, payload,
          idempotency_key_hash, request_hash, created_at, updated_at
        ) VALUES (
          ${contributionId}, ${command.ownerUserId}, 'queued', ${input.source.provider},
          ${input.source.pageVariant}, ${input.source.sourceUrl}, ${input.source.externalJobId ?? null},
          ${input.observation.contentSha256}, ${input.source.adapterVersion},
          ${input.observation.observedAt}, ${input.approval.approvedAt}, ${input.approval.consentId},
          ${input.approval.consentVersion}, ${input.approval.policyVersion},
          ${input.approval.previewDigestSha256},
          ${transaction.json(input as unknown as postgres.JSONValue)},
          ${idempotencyKeyHash}, ${requestHash}, ${createdAt}, ${createdAt}
        )
        RETURNING id, state, request_hash AS "requestHash",
          created_at AS "submittedAt", updated_at AS "updatedAt"
      `;
      if (!created) throw new Error("Contribution insert returned no row");
      await transaction`
        INSERT INTO jobs.job_contribution_outbox (
          id, contribution_id, event_type, subject, data, created_at
        ) VALUES (
          ${outboxId}, ${contributionId}, 'job.contributed.v1', ${contributionId},
          ${transaction.json({ contributionId })}, ${createdAt}
        )
      `;
      return status(created);
    });
  }

  async get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null> {
    const [row] = await this.client<ContributionRow[]>`
      SELECT id, state, request_hash AS "requestHash",
        created_at AS "submittedAt", updated_at AS "updatedAt"
      FROM jobs.job_contributions
      WHERE id = ${contributionId} AND owner_user_id = ${ownerUserId}
    `;
    return row ? status(row) : null;
  }
}
