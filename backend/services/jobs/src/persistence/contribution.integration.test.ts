import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CreateJobContributionCommand,
  JobContributionIdempotencyConflictError,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "../contribution.js";
import { createJobCatalogDatabase } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("Jobs queued contribution intake persistence", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const store = new PostgresJobContributionStore(client);
  const ownerA = uuidv7();
  const ownerB = uuidv7();
  const migrationExecutable = fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url));

  function command(ownerUserId = ownerA): CreateJobContributionCommand {
    const value: CreateJobContributionCommand = {
      ownerUserId,
      idempotencyKey: "integration-contribution-key-0001",
      input: {
        schemaVersion: 1,
        contributionId: uuidv7(),
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl: "https://jobs.lever.co/synthetic/synthetic-123",
          externalJobId: "synthetic-123",
          adapterVersion: "d2-job-page-v1",
        },
        posting: {
          companyName: "Synthetic Contribution Company",
          title: "Platform Engineer",
          locations: ["New York, NY"],
          description: "Generated public posting text for persistence acceptance.",
        },
        observation: {
          observedAt: "2026-09-01T12:00:00.000Z",
          contentSha256: "b".repeat(64),
        },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "ugc-policy-v1",
          approvedAt: "2026-09-01T12:01:00.000Z",
          approvedFields: [
            "provider",
            "pageVariant",
            "sourceUrl",
            "externalJobId",
            "companyName",
            "title",
            "locations",
            "description",
          ],
          previewDigestSha256: "0".repeat(64),
        },
      },
    };
    value.input.observation.contentSha256 = createHash("sha256")
      .update(jobContributionContentDigestInput(value.input))
      .digest("hex");
    value.input.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(value.input))
      .digest("hex");
    return value;
  }

  beforeAll(async () => {
    const result = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(result.stdout.trim()).toBe(
      "Jobs migrations through 0016_job_contribution_candidate_rights applied and verified.",
    );
    await store.ping();
  });

  afterAll(async () => {
    for (const ownerUserId of [ownerA, ownerB]) {
      const operationId = uuidv7();
      const requestId = uuidv7();
      const confirmedAt = new Date(Date.now() - 1_000);
      const backupExpiresAt = new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
      await client`INSERT INTO identity.users (id) VALUES (${ownerUserId})`;
      await client`
        INSERT INTO platform.operations (id, user_id, kind, state)
        VALUES (${operationId}, ${ownerUserId}, 'account_deletion', 'queued')
      `;
      await client`
        INSERT INTO profile.account_deletion_requests (
          id, user_id, operation_id, policy_version, state, version,
          requested_at, updated_at, confirmed_at, backup_expires_at
        ) VALUES (
          ${requestId}, ${ownerUserId}, ${operationId}, 'synthetic-jobs-rights-v1',
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
      await client`
        SELECT jobs.delete_candidate_data(${ownerUserId}, ${requestId})
      `;
      await client`
        DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}
      `;
      await client`DELETE FROM identity.users WHERE id = ${ownerUserId}`;
    }
    await client.end();
  });

  it("atomically queues one identifier-only event and isolates owner status", async () => {
    const before = await client<
      { jobs: string; sources: string }[]
    >`SELECT (SELECT count(*)::text FROM jobs.canonical_jobs) AS jobs,
      (SELECT count(*)::text FROM jobs.job_sources) AS sources`;
    const initial = command();
    const first = await store.create(initial);
    const replay = await store.create(initial);
    expect(replay).toEqual(first);
    expect(await store.get(ownerA, first.id)).toEqual(first);
    expect(await store.get(ownerB, first.id)).toBeNull();

    const [persisted] = await client<
      {
        state: string;
        eventType: string;
        data: unknown;
        eventCount: string;
        jobCount: string;
        sourceCount: string;
      }[]
    >`
      SELECT contribution.state, event.event_type AS "eventType", event.data,
        (SELECT count(*)::text FROM jobs.job_contribution_outbox
          WHERE contribution_id = contribution.id) AS "eventCount",
        (SELECT count(*)::text FROM jobs.canonical_jobs) AS "jobCount",
        (SELECT count(*)::text FROM jobs.job_sources) AS "sourceCount"
      FROM jobs.job_contributions AS contribution
      JOIN jobs.job_contribution_outbox AS event ON event.contribution_id = contribution.id
      WHERE contribution.id = ${first.id}
    `;
    expect(persisted).toEqual({
      state: "queued",
      eventType: "job.contributed.v1",
      data: { contributionId: first.id },
      eventCount: "1",
      jobCount: before[0]?.jobs,
      sourceCount: before[0]?.sources,
    });

    await expect(
      store.create({
        ...initial,
        input: { ...initial.input, posting: { ...initial.input.posting, title: "Changed" } },
      }),
    ).rejects.toBeInstanceOf(JobContributionIdempotencyConflictError);
  });
});
