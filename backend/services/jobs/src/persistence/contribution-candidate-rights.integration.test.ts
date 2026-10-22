import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CreateJobContributionCommand,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "../contribution.js";
import { createJobCatalogDatabase } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

interface CandidateDeletionAuthorization {
  operationId: string;
  requestId: string;
}

describeWithDatabase("Jobs contribution candidate rights ownership", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const store = new PostgresJobContributionStore(client);
  const migrationExecutable = fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url));
  const profileMigrationExecutable = fileURLToPath(
    new URL("../../../profile/dist/src/migrate.js", import.meta.url),
  );
  const owner = uuidv7();
  const otherOwner = uuidv7();

  function contributionCommand(ownerUserId: string, suffix: string): CreateJobContributionCommand {
    const approvedAt = new Date(Date.now() - 60_000).toISOString();
    const observedAt = new Date(Date.now() - 120_000).toISOString();
    const command: CreateJobContributionCommand = {
      ownerUserId,
      idempotencyKey: `candidate-rights-contribution-${suffix}`,
      input: {
        schemaVersion: 1,
        contributionId: uuidv7(),
        client: { surface: "browser_extension", version: "0.2.0" },
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl: `https://jobs.lever.co/synthetic-rights/${suffix}`,
          externalJobId: suffix,
          adapterVersion: "d2-job-page-v1",
        },
        posting: {
          companyName: "Synthetic Candidate Rights Company",
          title: "Platform Engineer",
          locations: ["New York, NY"],
          description: "Generated public posting content for candidate-rights verification.",
          department: "Engineering",
          applicationUrl: `https://jobs.lever.co/synthetic-rights/${suffix}/apply`,
          employmentType: "full_time",
          workMode: "hybrid",
        },
        observation: {
          observedAt,
          contentSha256: "0".repeat(64),
        },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-ugc-rights.v1",
          approvedAt,
          approvedFields: [
            "provider",
            "pageVariant",
            "sourceUrl",
            "externalJobId",
            "companyName",
            "title",
            "locations",
            "description",
            "department",
            "applicationUrl",
            "employmentType",
            "workMode",
          ],
          previewDigestSha256: "0".repeat(64),
        },
      },
    };
    command.input.observation.contentSha256 = createHash("sha256")
      .update(jobContributionContentDigestInput(command.input))
      .digest("hex");
    command.input.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(command.input))
      .digest("hex");
    return command;
  }

  async function authorizeDeletion(userId: string): Promise<CandidateDeletionAuthorization> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    const confirmedAt = new Date(Date.now() - 1_000);
    const backupExpiresAt = new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    await client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}, ${userId}, 'account_deletion', 'queued')
    `;
    await client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        requested_at, updated_at, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}, ${userId}, ${operationId}, 'synthetic-jobs-rights-v1',
        'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt}
      )
    `;
    await client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
      ) VALUES (
        ${requestId}, ${"1".repeat(64)}, 'synthetic-jobs-rights-v1', ${"2".repeat(64)},
        'quarantined', ${client.json({ jobs: "pending" })}, ${client.json({})},
        ${confirmedAt}, ${backupExpiresAt}, ${confirmedAt}
      )
    `;
    return { operationId, requestId };
  }

  async function removeAuthorization(
    userId: string,
    authorization: CandidateDeletionAuthorization,
  ): Promise<void> {
    await client`
      DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${authorization.requestId}
    `;
    await client`DELETE FROM identity.users WHERE id = ${userId}`;
  }

  beforeAll(async () => {
    // Jobs rights assertions and cleanup require Profile authorization, not Turbo package order.
    const profile = await execFileAsync(process.execPath, [profileMigrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(profile.stdout.trim()).toBe(
      "Database migrations through 0013_profile_sections_candidate_rights applied and verified.",
    );
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Jobs migrations through 0027_candidate_report_export_status applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
  });

  afterAll(async () => {
    await client.end();
  });

  it("exports allowlisted owner contributions and deletes only candidate-owned intake records", async () => {
    const ownerCommand = contributionCommand(owner, `owner-${uuidv7()}`);
    const otherCommand = contributionCommand(otherOwner, `other-${uuidv7()}`);
    const ownerContribution = await store.create(ownerCommand);
    const otherContribution = await store.create(otherCommand);
    const processingEventId = uuidv7();
    const processingEventAt = new Date();
    await client`
      INSERT INTO jobs.job_contribution_processing_outbox (
        id, contribution_id, event_type, subject, data, created_at
      ) VALUES (
        ${processingEventId}, ${ownerContribution.id}, 'job.normalized.v1',
        ${ownerContribution.id},
        ${client.json({ contributionId: ownerContribution.id, normalizationId: uuidv7() })},
        ${processingEventAt}
      )
    `;
    await client`
      INSERT INTO jobs.job_contribution_processing_event_deliveries (
        event_id, state, attempt, available_at, created_at, updated_at
      ) VALUES (
        ${processingEventId}, 'pending', 0, ${processingEventAt},
        ${processingEventAt}, ${processingEventAt}
      )
    `;

    const [catalogBefore] = await client<
      {
        canonicalJobs: number;
        jobSources: number;
        revalidationQueue: number;
        verificationEvidence: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM jobs.canonical_jobs) AS "canonicalJobs",
        (SELECT count(*)::int FROM jobs.job_sources) AS "jobSources",
        (SELECT count(*)::int FROM jobs.source_revalidation_queue) AS "revalidationQueue",
        (SELECT count(*)::int FROM jobs.source_verification_evidence) AS "verificationEvidence"
    `;

    const [exported] = await client<
      {
        data: {
          audit: { events: Array<Record<string, unknown>> };
          jobs: { contributions: Array<Record<string, unknown>>; reports: unknown[] };
        };
      }[]
    >`
      SELECT jobs.export_candidate_data(${owner}::uuid) AS data
    `;
    expect(exported?.data.jobs.reports).toEqual([]);
    expect(exported?.data.jobs.contributions).toEqual([
      expect.objectContaining({
        id: ownerContribution.id,
        state: "queued",
        client: { surface: "browser_extension", version: "0.2.0" },
        processingHistory: [],
        trustHistory: [],
        source: expect.objectContaining({
          provider: "lever",
          pageVariant: "lever-posting-v1",
          externalJobId: ownerCommand.input.source.externalJobId,
        }),
        posting: ownerCommand.input.posting,
        approval: expect.objectContaining({
          consentId: ownerCommand.input.approval.consentId,
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-ugc-rights.v1",
        }),
      }),
    ]);
    expect(exported?.data.audit.events).toEqual([
      expect.objectContaining({
        action: "jobs.contribution.queued",
        resourceId: ownerContribution.id,
      }),
    ]);
    const serialized = JSON.stringify(exported?.data);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain(otherOwner);
    expect(serialized).not.toContain(otherContribution.id);
    expect(serialized).not.toContain(ownerCommand.input.observation.contentSha256);
    expect(serialized).not.toContain(ownerCommand.input.approval.previewDigestSha256);
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("requestHash");
    expect(serialized).not.toContain("payload");

    const [absent] = await client<
      {
        data: {
          audit: { events: unknown[] };
          jobs: { contributions: unknown[]; reports: unknown[] };
        };
      }[]
    >`
      SELECT jobs.export_candidate_data(${uuidv7()}::uuid) AS data
    `;
    expect(absent?.data).toEqual({
      jobs: { reports: [], contributions: [] },
      audit: { events: [] },
    });

    const [privileges] = await client<
      {
        functionCount: number;
        publicExecuteCount: number;
        securityDefinerCount: number;
      }[]
    >`
      SELECT
        count(*)::int AS "functionCount",
        count(*) FILTER (
          WHERE has_function_privilege(0, procedure.oid, 'EXECUTE')
        )::int AS "publicExecuteCount",
        count(*) FILTER (WHERE procedure.prosecdef)::int AS "securityDefinerCount"
      FROM pg_proc AS procedure
      WHERE procedure.oid = ANY(ARRAY[
        to_regprocedure('jobs.guard_candidate_job_contribution_delete()'),
        to_regprocedure('jobs.guard_candidate_job_contribution_outbox_delete()'),
        to_regprocedure('jobs.export_candidate_data(uuid)'),
        to_regprocedure('jobs.delete_candidate_data(uuid,uuid)')
      ])
    `;
    expect(privileges).toEqual({
      functionCount: 4,
      publicExecuteCount: 0,
      securityDefinerCount: 2,
    });

    const ownerAuthorization = await authorizeDeletion(owner);
    const otherAuthorization = await authorizeDeletion(otherOwner);
    try {
      await expect(
        client`DELETE FROM jobs.job_contribution_outbox
          WHERE contribution_id = ${ownerContribution.id}`,
      ).rejects.toThrow("append-only");
      await expect(
        client`DELETE FROM jobs.job_contributions WHERE id = ${ownerContribution.id}`,
      ).rejects.toThrow("immutable");
      await expect(
        client`DELETE FROM jobs.job_contribution_processing_queue
          WHERE contribution_id = ${ownerContribution.id}`,
      ).rejects.toThrow("candidate deletion authority");
      await expect(
        client`DELETE FROM jobs.job_contribution_processing_event_deliveries
          WHERE event_id = ${processingEventId}`,
      ).rejects.toThrow("candidate deletion authority");
      await expect(
        client`SELECT jobs.delete_candidate_data(${owner}, ${uuidv7()})`,
      ).rejects.toThrow("candidate deletion is not authorized");
      await expect(
        client`SELECT jobs.delete_candidate_data(${owner}, ${otherAuthorization.requestId})`,
      ).rejects.toThrow("candidate deletion is not authorized");

      const [deleted] = await client<{ result: Record<string, unknown> }[]>`
        SELECT jobs.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(deleted?.result).toEqual({
        owner: "jobs",
        reportsDeleted: 0,
        contributionsDeleted: 1,
        contributionOutboxDeleted: 1,
        processingEventDeliveriesDeleted: 1,
        processingOutboxDeleted: 1,
        processingQueueDeleted: 1,
        reconciliationsDeleted: 0,
        stateEventsDeleted: 0,
        trustDecisionsDeleted: 0,
        independentVerificationsDeleted: 0,
        normalizationsDeleted: 0,
      });
      const [replay] = await client<{ result: Record<string, unknown> }[]>`
        SELECT jobs.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(replay?.result).toEqual({
        owner: "jobs",
        reportsDeleted: 0,
        contributionsDeleted: 0,
        contributionOutboxDeleted: 0,
        processingEventDeliveriesDeleted: 0,
        processingOutboxDeleted: 0,
        processingQueueDeleted: 0,
        reconciliationsDeleted: 0,
        stateEventsDeleted: 0,
        trustDecisionsDeleted: 0,
        independentVerificationsDeleted: 0,
        normalizationsDeleted: 0,
      });

      const [remaining] = await client<
        {
          otherContributions: number;
          otherOutbox: number;
          ownerContributions: number;
          ownerDelivery: number;
        }[]
      >`
        SELECT
          count(*) FILTER (WHERE owner_user_id = ${owner})::int AS "ownerContributions",
          count(*) FILTER (WHERE owner_user_id = ${otherOwner})::int AS "otherContributions",
          (
            SELECT count(*)::int FROM jobs.job_contribution_outbox
            WHERE contribution_id = ${otherContribution.id}
          ) AS "otherOutbox",
          (
            SELECT count(*)::int FROM jobs.job_contribution_processing_event_deliveries
            WHERE event_id = ${processingEventId}
          ) AS "ownerDelivery"
        FROM jobs.job_contributions
      `;
      expect(remaining).toEqual({
        ownerContributions: 0,
        otherContributions: 1,
        otherOutbox: 1,
        ownerDelivery: 0,
      });

      const [catalogAfter] = await client<(typeof catalogBefore)[]>`
        SELECT
          (SELECT count(*)::int FROM jobs.canonical_jobs) AS "canonicalJobs",
          (SELECT count(*)::int FROM jobs.job_sources) AS "jobSources",
          (SELECT count(*)::int FROM jobs.source_revalidation_queue) AS "revalidationQueue",
          (SELECT count(*)::int FROM jobs.source_verification_evidence) AS "verificationEvidence"
      `;
      expect(catalogAfter).toEqual(catalogBefore);
    } finally {
      await client`
        SELECT jobs.delete_candidate_data(${owner}, ${ownerAuthorization.requestId})
      `;
      await client`
        SELECT jobs.delete_candidate_data(${otherOwner}, ${otherAuthorization.requestId})
      `;
      await removeAuthorization(owner, ownerAuthorization);
      await removeAuthorization(otherOwner, otherAuthorization);
    }
  });
});
