import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CreateJobContributionCommand,
  JobContributionCancellationConflictError,
  JobContributionIdempotencyConflictError,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "../contribution.js";
import { normalizeContributionForProcessing } from "../contribution-processing-policy.js";
import { canonicalizeObservation } from "../domain/canonical-job.js";
import { createJobCatalogDatabase } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";
import {
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
} from "./contribution-processing.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

const describeClient = describeWithDatabase.each(["plain", "drizzle"] as const);
describeClient("Jobs queued contribution intake persistence (%s client)", (mode) => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  // The gateway shares a client initialized by Drizzle; it changes PostgreSQL
  // timestamp/JSON serializers. Keep verification and cleanup on a plain client.
  const storeClient =
    mode === "drizzle"
      ? createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", { maxConnections: 2 })
      : client;
  if (mode === "drizzle") drizzle(storeClient);
  const store = new PostgresJobContributionStore(storeClient);
  const ownerA = uuidv7();
  const ownerB = uuidv7();
  const migrationExecutable = fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url));
  const profileMigrationExecutable = fileURLToPath(
    new URL("../../../profile/dist/src/migrate.js", import.meta.url),
  );

  function command(ownerUserId = ownerA): CreateJobContributionCommand {
    const value: CreateJobContributionCommand = {
      ownerUserId,
      idempotencyKey: "integration-contribution-key-0001",
      input: {
        schemaVersion: 1,
        contributionId: uuidv7(),
        client: { surface: "browser_extension", version: "0.2.0" },
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
    // Cleanup uses the Profile-owned deletion authorization boundary, regardless of suite order.
    const profile = await execFileAsync(process.execPath, [profileMigrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(profile.stdout.trim()).toBe(
      "Database migrations through 0010_restricted_answer_vault applied and verified.",
    );
    const result = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(result.stdout.trim()).toBe(
      "Jobs migrations through 0024_contribution_appeal_restoration applied and verified.",
    );
    await store.ping();
  });

  it("cancels only the owner, preserves immutable intake and cannot resurrect through late worker writes", async () => {
    const initial = command();
    initial.idempotencyKey = `cancel-${initial.input.contributionId}`;
    await store.create(initial);
    const cancel = {
      ownerUserId: ownerA,
      contributionId: initial.input.contributionId,
      idempotencyKey: `cancel-request-${initial.input.contributionId}`,
      traceId: "synthetic-cancellation",
    };
    const revoke = vi.fn(async () => undefined);
    await expect(store.cancel({ ...cancel, ownerUserId: ownerB }, { revoke })).resolves.toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    const processing = new PostgresContributionProcessingStore(client);
    const proposal = normalizeContributionForProcessing(initial.input);
    await processing.recordNormalization({
      contributionId: cancel.contributionId,
      proposal,
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date(),
    });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancellation = store.cancel(cancel, {
      revoke: async (binding) => {
        expect(binding).toMatchObject({
          ownerUserId: ownerA,
          consentId: initial.input.approval.consentId,
          previewDigestSha256: initial.input.approval.previewDigestSha256,
        });
        entered();
        await blocked;
      },
    });
    await started;
    const observation = {
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      sourceUrl: initial.input.source.sourceUrl,
      atsTenant: "synthetic",
      externalJobId: "synthetic-123",
      companyName: "Synthetic Contribution Company",
      title: initial.input.posting.title,
      description: "Generated public posting text for persistence acceptance.",
      locations: ["New York, NY"],
      adapterVersion: "lever-v1",
      observedAt: new Date(),
    };
    const verification = processing.recordIndependentVerification({
      contributionId: cancel.contributionId,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: cancel.contributionId,
        verificationId: uuidv7(),
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: proposal.provenance.canonicalSourceUrlSha256,
        evidenceDigestSha256: "c".repeat(64),
        verifiedContentSha256: canonicalizeObservation(observation).contentHash,
        sourcePolicyVersion: "synthetic-source-v1",
        verifiedAt: observation.observedAt.toISOString(),
        providerObservation: observation,
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date(),
    });
    release();
    const cancelled = await cancellation;
    expect(cancelled?.state).toBe("consent_invalid");
    expect((await verification).ownerState).toBe("consent_invalid");
    await expect(store.cancel(cancel, { revoke })).resolves.toEqual(cancelled);
    await processing.recordOwnerState({
      contributionId: cancel.contributionId,
      state: "awaiting_independent_verification",
      reasonCode: "provider_observation_mismatch",
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date(Date.now() + 1000),
    });
    expect((await store.get(ownerA, cancel.contributionId))?.state).toBe("consent_invalid");
    expect((await store.list(ownerA)).find((item) => item.id === cancel.contributionId)).toEqual(
      await store.get(ownerA, cancel.contributionId),
    );
    const [unchanged] = await client<Array<{ payload: unknown; state: string; verified: boolean }>>`
      SELECT payload, state, EXISTS (SELECT 1 FROM jobs.job_contribution_independent_verifications
        WHERE contribution_id = ${cancel.contributionId}) AS verified
      FROM jobs.job_contributions WHERE id = ${cancel.contributionId}
    `;
    expect(unchanged).toEqual({ payload: initial.input, state: "queued", verified: false });
    const queue = new PostgresContributionProcessingQueueStore(client);
    const claims = await queue.claim({
      now: new Date(Date.now() + 2000),
      workerId: "synthetic-cancel-test",
      claimExpiresAt: new Date(Date.now() + 32000),
      limit: 25,
    });
    expect(claims.some((item) => item.contributionId === cancel.contributionId)).toBe(false);
  });

  it("retries a partial revocation and refuses cancellation once independent verification has committed", async () => {
    const initial = command();
    initial.idempotencyKey = `cancel-recovery-${initial.input.contributionId}`;
    await store.create(initial);
    const cancel = {
      ownerUserId: ownerA,
      contributionId: initial.input.contributionId,
      idempotencyKey: `cancel-request-${initial.input.contributionId}`,
      traceId: "synthetic-cancellation",
    };
    await expect(
      store.cancel(cancel, {
        revoke: async () => {
          throw new Error("synthetic-unavailable");
        },
      }),
    ).rejects.toThrow();
    expect((await store.get(ownerA, cancel.contributionId))?.state).toBe("consent_invalid");
    await store.cancel(cancel, { revoke: async () => undefined });
    expect((await store.get(ownerA, cancel.contributionId))?.state).toBe("consent_invalid");

    const later = command();
    later.idempotencyKey = `verified-${later.input.contributionId}`;
    await store.create(later);
    const processing = new PostgresContributionProcessingStore(client);
    const proposal = normalizeContributionForProcessing(later.input);
    await processing.recordNormalization({
      contributionId: later.input.contributionId,
      proposal,
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date(),
    });
    const observation = {
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      sourceUrl: later.input.source.sourceUrl,
      atsTenant: "synthetic",
      externalJobId: "synthetic-123",
      companyName: "Synthetic Contribution Company",
      title: later.input.posting.title,
      description: "Generated public posting text for persistence acceptance.",
      locations: ["New York, NY"],
      adapterVersion: "lever-v1",
      observedAt: new Date(),
    };
    await processing.recordIndependentVerification({
      contributionId: later.input.contributionId,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: later.input.contributionId,
        verificationId: uuidv7(),
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: proposal.provenance.canonicalSourceUrlSha256,
        evidenceDigestSha256: "c".repeat(64),
        verifiedContentSha256: canonicalizeObservation(observation).contentHash,
        sourcePolicyVersion: "synthetic-source-v1",
        verifiedAt: observation.observedAt.toISOString(),
        providerObservation: observation,
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date(),
    });
    const revoke = vi.fn(async () => undefined);
    await expect(
      store.cancel({ ...cancel, contributionId: later.input.contributionId }, { revoke }),
    ).rejects.toBeInstanceOf(JobContributionCancellationConflictError);
    expect(revoke).not.toHaveBeenCalled();
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
    if (storeClient !== client) await storeClient.end();
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
        payload: unknown;
        eventCount: string;
        queueCount: string;
        timestampsMatch: boolean;
        jobCount: string;
        sourceCount: string;
      }[]
    >`
      SELECT contribution.state, contribution.payload, event.event_type AS "eventType", event.data,
        (SELECT count(*)::text FROM jobs.job_contribution_outbox
          WHERE contribution_id = contribution.id) AS "eventCount",
        (SELECT count(*)::text FROM jobs.job_contribution_processing_queue
          WHERE contribution_id = contribution.id) AS "queueCount",
        (contribution.created_at = contribution.updated_at
          AND contribution.created_at = event.created_at
          AND contribution.created_at = queue.created_at
          AND contribution.created_at = queue.updated_at
          AND contribution.created_at = queue.available_at) AS "timestampsMatch",
        (SELECT count(*)::text FROM jobs.canonical_jobs) AS "jobCount",
        (SELECT count(*)::text FROM jobs.job_sources) AS "sourceCount"
      FROM jobs.job_contributions AS contribution
      JOIN jobs.job_contribution_outbox AS event ON event.contribution_id = contribution.id
      JOIN jobs.job_contribution_processing_queue AS queue ON queue.contribution_id = contribution.id
      WHERE contribution.id = ${first.id}
    `;
    expect(persisted).toEqual({
      state: "queued",
      eventType: "job.contributed.v1",
      data: { contributionId: first.id },
      payload: initial.input,
      eventCount: "1",
      queueCount: "1",
      timestampsMatch: true,
      jobCount: before[0]?.jobs,
      sourceCount: before[0]?.sources,
    });

    const normalizedAt = new Date(new Date(first.updatedAt).getTime() + 1_000);
    await client`
      INSERT INTO jobs.job_contribution_state_events (
        id, contribution_id, state, reason_code, processing_policy_version, occurred_at
      ) VALUES (
        ${uuidv7()}, ${first.id}, 'normalized', 'normalization_complete',
        'synthetic-processing-v1', ${normalizedAt}
      )
    `;
    await expect(store.get(ownerA, first.id)).resolves.toMatchObject({
      id: first.id,
      state: "normalized",
      updatedAt: normalizedAt.toISOString(),
    });
    expect((await store.list(ownerA)).find((item) => item.id === first.id)).toEqual(
      await store.get(ownerA, first.id),
    );
    expect((await store.list(ownerB)).some((item) => item.id === first.id)).toBe(false);

    await expect(
      store.create({
        ...initial,
        input: { ...initial.input, posting: { ...initial.input.posting, title: "Changed" } },
      }),
    ).rejects.toBeInstanceOf(JobContributionIdempotencyConflictError);
  });

  it("lists at most 25 newest owner rows with deterministic tied timestamps and no private payload", async () => {
    const created = [];
    const fixedTime = new Date(Date.now() + 60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixedTime);
    try {
      for (let index = 0; index < 28; index += 1) {
        const input = command(ownerA);
        input.idempotencyKey = `history-${input.input.contributionId}`;
        created.push(await store.create(input));
      }
      const foreign = command(ownerB);
      foreign.idempotencyKey = `history-${foreign.input.contributionId}`;
      const foreignStatus = await store.create(foreign);
      const history = await store.list(ownerA);
      expect(history).toEqual(
        created.sort((left, right) => right.id.localeCompare(left.id)).slice(0, 25),
      );
      expect(history).toHaveLength(25);
      expect(history.every((item) => item.submittedAt === fixedTime.toISOString())).toBe(true);
      expect(history.some((item) => item.id === foreignStatus.id)).toBe(false);
      for (const item of history) {
        expect(Object.keys(item).sort()).toEqual(["id", "state", "submittedAt", "updatedAt"]);
      }
      expect(JSON.stringify(history)).not.toContain(ownerA);
      expect(JSON.stringify(history)).not.toContain(ownerB);
      expect(JSON.stringify(history)).not.toContain("Synthetic Contribution Company");
      expect(await store.list(uuidv7())).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
