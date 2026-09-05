import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import type { CreateJobContributionCommand } from "../contribution.js";
import { normalizeContributionForProcessing } from "../contribution-processing-policy.js";
import { canonicalizeObservation } from "../domain/canonical-job.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";
import {
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
} from "./contribution-processing.js";
import { PostgresContributionProcessingEventDeliveryStore } from "./contribution-processing-event-delivery.js";
import { PostgresContributionRecoveryStore } from "./contribution-recovery.js";
import { PostgresContributionReviewEvidenceReader } from "./contribution-review-evidence.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("durable contribution processing persistence", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const intake = new PostgresJobContributionStore(client);
  const processing = new PostgresContributionProcessingStore(client);
  const catalog = new PostgresJobCatalog(client, {
    acceptedProvenance: new Set(["permitted_api"]),
    searchCursorKeys: { active: { id: "synthetic-v1", key: Buffer.alloc(32, 7) } },
  });
  const queue = new PostgresContributionProcessingQueueStore(client);
  const ownerId = uuidv7();
  const contributionId = uuidv7();
  const companyId = uuidv7();
  const jobId = uuidv7();
  const sourceId = uuidv7();
  const evidenceId = uuidv7();
  const trustDecisionId = uuidv7();
  const sourceUrl = `https://jobs.lever.co/synthetic-processing/${contributionId}`;
  const sourceUrlSha256 = createHash("sha256").update(sourceUrl).digest("hex");
  const evidenceDigestSha256 = createHash("sha256")
    .update(`evidence:${contributionId}`)
    .digest("hex");
  const observedAt = new Date("2026-09-01T12:00:00.000Z");
  const verifiedAt = new Date("2026-09-01T12:55:00.000Z");
  const reconcileAt = new Date("2026-09-01T13:00:00.000Z");
  const providerObservation = {
    provider: "lever" as const,
    provenance: "permitted_api" as const,
    companyName: "Synthetic Processing Company",
    title: "Platform Engineer",
    locations: ["New York, NY"],
    description: "Independently verified synthetic provider content",
    sourceUrl,
    atsTenant: "synthetic-processing",
    externalJobId: contributionId,
    adapterVersion: "lever-v1",
    observedAt: verifiedAt,
  };
  const sourceContentSha256 = canonicalizeObservation(providerObservation).contentHash;

  function command(): CreateJobContributionCommand {
    return {
      ownerUserId: ownerId,
      idempotencyKey: `processing-${contributionId}`,
      input: {
        schemaVersion: 1,
        contributionId,
        client: { surface: "browser_extension", version: "0.2.0" },
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl,
          externalJobId: contributionId,
          adapterVersion: "d2-job-page-v1",
        },
        posting: {
          companyName: "Synthetic Processing Company",
          title: "Platform Engineer",
          locations: ["New York, NY"],
          description: "Synthetic public job content for durable processing acceptance.",
        },
        observation: { observedAt: observedAt.toISOString(), contentSha256: "a".repeat(64) },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-ugc-v1",
          approvedAt: "2026-09-01T12:01:00.000Z",
          approvedFields: [],
          previewDigestSha256: "b".repeat(64),
        },
      },
    };
  }

  afterAll(async () => {
    await client.end();
  });

  it("converges leases and reconciles only current provider truth plus accepted Trust", async () => {
    await client`
      INSERT INTO jobs.companies (
        id, display_name, normalized_name, created_at, updated_at
      ) VALUES (
        ${companyId}, ${`Synthetic Processing Company ${companyId}`},
        ${`synthetic processing company ${companyId}`},
        ${observedAt}, ${observedAt}
      )
    `;
    await client`
      INSERT INTO jobs.canonical_jobs (
        id, company_id, title, normalized_title, locations, normalized_locations,
        description, description_hash, dedupe_fingerprint, status, status_reason,
        first_observed_at, last_verified_at, expires_at, created_at, updated_at
      ) VALUES (
        ${jobId}, ${companyId}, 'Platform Engineer', 'platform engineer',
        ${client.json(["New York, NY"])}, ${client.array(["new york, ny"])},
        'Independently verified synthetic provider content', ${sourceContentSha256},
        ${"e".repeat(64)}, 'active', 'positive_verification', ${observedAt}, ${verifiedAt},
        ${new Date("2026-09-10T00:00:00.000Z")}, ${observedAt}, ${verifiedAt}
      )
    `;
    await client`
      INSERT INTO jobs.job_sources (
        id, job_id, provider, provenance, ats_tenant, external_job_id,
        source_url, canonical_url, canonical_url_hash, content_hash, adapter_version,
        first_observed_at, last_observed_at, last_verified_at, created_at, updated_at
      ) VALUES (
        ${sourceId}, ${jobId}, 'lever', 'permitted_api', 'synthetic-processing',
        ${contributionId}, ${sourceUrl}, ${sourceUrl}, ${sourceUrlSha256},
        ${sourceContentSha256}, 'd2-job-page-v1', ${observedAt}, ${verifiedAt}, ${verifiedAt},
        ${observedAt}, ${verifiedAt}
      )
    `;
    await client`
      INSERT INTO jobs.source_verification_evidence (
        id, job_id, source_id, provider, page_variant, evidence_kind,
        evidence_digest_sha256, policy_version, verified_at, recorded_at
      ) VALUES (
        ${evidenceId}, ${jobId}, ${sourceId}, 'lever', 'lever-posting-v1',
        'independent_positive_verification', ${evidenceDigestSha256},
        'synthetic-source-v1', ${verifiedAt}, ${verifiedAt}
      )
    `;

    await intake.create(command());
    const queueNow = new Date(Date.now() + 1_000);
    const claims = await queue.claim({
      workerId: "worker:integration",
      now: queueNow,
      claimExpiresAt: new Date(queueNow.getTime() + 30_000),
      limit: 25,
    });
    const firstClaim = claims.find((item) => item.contributionId === contributionId);
    expect(firstClaim?.contributionId).toBe(contributionId);
    if (!firstClaim) throw new Error("Expected processing claim");
    await queue.park({
      item: firstClaim,
      workerId: "worker:integration",
      now: queueNow,
      reason: "trust_pending",
    });
    await expect(
      queue.requeue({
        contributionId,
        now: new Date(queueNow.getTime() + 1_000),
        signal: "trust_decision",
      }),
    ).resolves.toBe(true);

    let value = await processing.recordNormalization({
      contributionId,
      proposal: normalizeContributionForProcessing(command().input),
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:10:00.000Z"),
    });
    expect(value.normalization).toBeDefined();
    value = await processing.recordIndependentVerification({
      contributionId,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId,
        verificationId: evidenceId,
        jobId,
        sourceId,
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: sourceUrlSha256,
        evidenceDigestSha256,
        verifiedContentSha256: sourceContentSha256,
        providerObservation,
        sourcePolicyVersion: "synthetic-source-v1",
        verifiedAt: verifiedAt.toISOString(),
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:56:00.000Z"),
    });
    expect(value.independentVerification?.verificationId).toBe(evidenceId);
    const reviewEvidence = new PostgresContributionReviewEvidenceReader(client);
    const readableEvidence = await reviewEvidence.read({
      contributionId,
      contributorUserId: ownerId,
    });
    expect(readableEvidence).toMatchObject({
      contributionId,
      evidenceDigestSha256,
      description: providerObservation.description,
      companyName: providerObservation.companyName,
    });
    expect(readableEvidence).not.toHaveProperty("ownerUserId");
    expect(readableEvidence).not.toHaveProperty("providerObservation");
    expect(await reviewEvidence.read({ contributionId, contributorUserId: uuidv7() })).toBeNull();
    value = await processing.recordTrustDecision({
      contributionId,
      decision: {
        status: "accepted",
        contributionId,
        decisionId: trustDecisionId,
        policyVersion: "synthetic-trust-v1",
        decidedAt: "2026-09-01T12:57:00.000Z",
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:57:00.000Z"),
    });
    expect(value.ownerState).toBe("ready_for_publication");

    const prepared = await processing.preparePublication({
      contributionId,
      processingPolicyVersion: "synthetic-processing-v1",
      capabilityPolicyVersion: "synthetic-capability-v1",
      capabilityConfigurationDigestSha256: "f".repeat(64),
      capabilityEvaluatedAt: "2026-09-01T12:59:00.000Z",
      capabilityExpiresAt: "2026-09-01T14:00:00.000Z",
      occurredAt: reconcileAt,
    });
    const reconciler = new PostgresContributionPublicationReconciler(
      client,
      catalog,
      () => reconcileAt,
    );

    await client`UPDATE jobs.canonical_jobs SET status = 'blocked' WHERE id = ${jobId}`;
    await expect(reconciler.publish(prepared)).rejects.toThrow("not authorized");
    await client`UPDATE jobs.canonical_jobs SET status = 'active' WHERE id = ${jobId}`;
    await client`UPDATE jobs.job_sources SET withdrawn_at = ${verifiedAt} WHERE id = ${sourceId}`;
    const published = await reconciler.publish(prepared);
    expect(published).toEqual({ status: "published", jobId, sourceId, verificationId: evidenceId });
    if (published.status === "probable_duplicate") throw new Error("Unexpected probable duplicate");
    value = await processing.completePublication({
      command: prepared,
      result: published,
      occurredAt: reconcileAt,
    });
    expect(value.ownerState).toBe("published");
    expect(
      (
        await processing.preparePublication({
          contributionId,
          processingPolicyVersion: "synthetic-processing-v1",
          capabilityPolicyVersion: "synthetic-capability-v1",
          capabilityConfigurationDigestSha256: "f".repeat(64),
          capabilityEvaluatedAt: "2026-09-01T12:59:00.000Z",
          capabilityExpiresAt: "2026-09-01T14:00:00.000Z",
          occurredAt: reconcileAt,
        })
      ).reconciliationId,
    ).toBe(prepared.reconciliationId);

    const delivery = new PostgresContributionProcessingEventDeliveryStore(client);
    const deliveryAt = new Date("2026-09-01T13:01:00.000Z");
    const [normalizedDelivery] = await delivery.claim({
      workerId: "delivery:integration",
      now: deliveryAt,
      claimExpiresAt: new Date(deliveryAt.getTime() + 30_000),
      maxAttempts: 3,
      limit: 1,
    });
    expect(normalizedDelivery?.event.type).toBe("job.normalized.v1");
    if (!normalizedDelivery) throw new Error("Expected normalized event delivery");
    await delivery.acknowledge({
      item: normalizedDelivery,
      workerId: "delivery:integration",
      now: deliveryAt,
    });
    await delivery.acknowledge({
      item: normalizedDelivery,
      workerId: "delivery:integration",
      now: deliveryAt,
    });

    const [abandoned] = await delivery.claim({
      workerId: "delivery:integration",
      now: deliveryAt,
      claimExpiresAt: new Date(deliveryAt.getTime() + 30_000),
      maxAttempts: 3,
      limit: 1,
    });
    if (!abandoned) throw new Error("Expected verified event delivery");
    const recoveredAt = new Date("2026-09-01T13:02:00.000Z");
    const [recovered] = await delivery.claim({
      workerId: "delivery:recovery",
      now: recoveredAt,
      claimExpiresAt: new Date(recoveredAt.getTime() + 30_000),
      maxAttempts: 3,
      limit: 1,
    });
    expect(recovered).toMatchObject({ attempt: 2, event: { type: "job.verified.v1" } });
    expect(recovered?.claimToken).not.toBe(abandoned.claimToken);
    if (!recovered) throw new Error("Expected recovered event delivery");
    await delivery.retry({
      item: recovered,
      workerId: "delivery:recovery",
      now: recoveredAt,
      retryAt: new Date(recoveredAt.getTime() + 1_000),
      errorCode: "transport_unavailable",
      terminal: false,
    });
    const [finalClaim] = await delivery.claim({
      workerId: "delivery:final",
      now: new Date(recoveredAt.getTime() + 1_000),
      claimExpiresAt: new Date(recoveredAt.getTime() + 31_000),
      maxAttempts: 3,
      limit: 1,
    });
    expect(finalClaim?.attempt).toBe(3);
    if (!finalClaim) throw new Error("Expected final event delivery");
    await delivery.retry({
      item: finalClaim,
      workerId: "delivery:final",
      now: new Date(recoveredAt.getTime() + 1_000),
      retryAt: new Date(recoveredAt.getTime() + 1_000),
      errorCode: "transport_unavailable",
      terminal: true,
    });
    const deliveryStates = await client<{ state: string; attempt: number }[]>`
      SELECT delivery.state, delivery.attempt
      FROM jobs.job_contribution_processing_event_deliveries AS delivery
      JOIN jobs.job_contribution_processing_outbox AS event ON event.id = delivery.event_id
      WHERE event.contribution_id = ${contributionId}
      ORDER BY delivery.created_at, delivery.event_id
    `;
    expect(deliveryStates).toEqual([
      { state: "published", attempt: 1 },
      { state: "dead", attempt: 3 },
    ]);
    await expect(
      client`UPDATE jobs.job_contribution_processing_outbox SET data = data
        WHERE contribution_id = ${contributionId}`,
    ).rejects.toThrow("append-only");

    const withdrawalId = uuidv7();
    value = await processing.recordTrustDecision({
      contributionId,
      decision: {
        status: "withdrawn",
        contributionId,
        decisionId: withdrawalId,
        policyVersion: "synthetic-trust-v1",
        decidedAt: "2026-09-01T13:05:00.000Z",
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T13:05:00.000Z"),
    });
    expect(value.ownerState).toBe("withdrawn");
    const removal = await processing.prepareTerminalReconciliation({
      contributionId,
      reason: "withdrawn",
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T13:05:00.000Z"),
    });
    expect(removal).not.toBeNull();
    if (!removal) throw new Error("Expected removal reconciliation");
    const removalReconciler = new PostgresContributionPublicationReconciler(
      client,
      catalog,
      () => new Date("2026-09-01T13:05:00.000Z"),
    );
    await removalReconciler.remove(removal);
    value = await processing.completeTerminalReconciliation({
      command: removal,
      occurredAt: new Date("2026-09-01T13:05:00.000Z"),
    });
    expect(value.ownerState).toBe("removed");
    await expect(intake.get(ownerId, contributionId)).resolves.toMatchObject({ state: "removed" });
    const [truth] = await client<
      { jobStatus: string; withdrawnAt: Date | null; contentHash: string }[]
    >`
      SELECT job.status AS "jobStatus", source.withdrawn_at AS "withdrawnAt",
        source.content_hash AS "contentHash"
      FROM jobs.canonical_jobs AS job JOIN jobs.job_sources AS source ON source.job_id = job.id
      WHERE job.id = ${jobId} AND source.id = ${sourceId}
    `;
    expect(truth).toEqual({
      jobStatus: "active",
      withdrawnAt: null,
      contentHash: sourceContentSha256,
    });
  });

  it("creates a genuinely new provider job only during authorized reconciliation and replays IDs", async () => {
    const newOwnerId = uuidv7();
    const newContributionId = uuidv7();
    const newVerificationId = uuidv7();
    const newTrustDecisionId = uuidv7();
    const unique = newContributionId.slice(-12);
    const newSourceUrl = `https://jobs.lever.co/provider-truth-${unique}/${newContributionId}`;
    const newCommand: CreateJobContributionCommand = {
      ...command(),
      ownerUserId: newOwnerId,
      idempotencyKey: `provider-truth-${newContributionId}`,
      input: {
        ...command().input,
        contributionId: newContributionId,
        source: {
          ...command().input.source,
          sourceUrl: newSourceUrl,
          externalJobId: newContributionId,
        },
        posting: {
          companyName: `Provider Truth ${unique}`,
          title: `Reliability Engineer ${unique}`,
          locations: ["Remote"],
          description: `Candidate-observed content ${unique}`,
        },
      },
    };
    const newProviderObservation = {
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      companyName: `Provider Truth ${unique}`,
      title: `Reliability Engineer ${unique}`,
      locations: ["Remote"],
      description: `Independently fetched provider content ${unique}`,
      sourceUrl: newSourceUrl,
      atsTenant: "synthetic-processing",
      externalJobId: newContributionId,
      adapterVersion: "lever-v1",
      observedAt: verifiedAt,
    };
    const newCanonical = canonicalizeObservation(newProviderObservation);

    await intake.create(newCommand);
    const normalized = await processing.recordNormalization({
      contributionId: newContributionId,
      proposal: normalizeContributionForProcessing(newCommand.input),
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:10:00.000Z"),
    });
    expect(normalized.independentVerification).toBeUndefined();
    const verified = await processing.recordIndependentVerification({
      contributionId: newContributionId,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: newContributionId,
        verificationId: newVerificationId,
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: newCanonical.canonicalUrlHash,
        evidenceDigestSha256: createHash("sha256")
          .update(`evidence:${newContributionId}`)
          .digest("hex"),
        verifiedContentSha256: newCanonical.contentHash,
        providerObservation: newProviderObservation,
        sourcePolicyVersion: "synthetic-source-v1",
        verifiedAt: verifiedAt.toISOString(),
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:56:00.000Z"),
    });
    expect(verified.independentVerification).not.toHaveProperty("jobId");
    await processing.recordTrustDecision({
      contributionId: newContributionId,
      decision: {
        status: "accepted",
        contributionId: newContributionId,
        decisionId: newTrustDecisionId,
        policyVersion: "synthetic-trust-v1",
        decidedAt: "2026-09-01T12:57:00.000Z",
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: new Date("2026-09-01T12:57:00.000Z"),
    });
    const prepared = await processing.preparePublication({
      contributionId: newContributionId,
      processingPolicyVersion: "synthetic-processing-v1",
      capabilityPolicyVersion: "synthetic-capability-v1",
      capabilityConfigurationDigestSha256: "f".repeat(64),
      capabilityEvaluatedAt: "2026-09-01T12:59:00.000Z",
      capabilityExpiresAt: "2026-09-01T14:00:00.000Z",
      occurredAt: reconcileAt,
    });
    const reconciler = new PostgresContributionPublicationReconciler(
      client,
      catalog,
      () => reconcileAt,
    );
    const first = await reconciler.publish(prepared);
    const replay = await reconciler.publish(prepared);
    expect(first).toEqual(replay);
    expect(first.status).toBe("published");
    if (first.status === "probable_duplicate") throw new Error("Unexpected probable duplicate");
    expect(first.verificationId).toBe(newVerificationId);
    const [counts] = await client<{ jobs: number; sources: number; evidence: number }[]>`
      SELECT
        (SELECT count(*)::int FROM jobs.canonical_jobs WHERE id = ${first.jobId}) AS jobs,
        (SELECT count(*)::int FROM jobs.job_sources WHERE id = ${first.sourceId}) AS sources,
        (SELECT count(*)::int FROM jobs.source_verification_evidence
          WHERE id = ${newVerificationId} AND job_id = ${first.jobId} AND source_id = ${first.sourceId}) AS evidence
    `;
    expect(counts).toEqual({ jobs: 1, sources: 1, evidence: 1 });
  });
  it("inspects fixed backlog categories and requeues only an unchanged eligible snapshot", async () => {
    const recovery = new PostgresContributionRecoveryStore(client);
    const reasons = [
      "provider_temporarily_unavailable",
      "provider_observation_mismatch",
      "provider_posting_closed",
      "provider_probable_duplicate",
      "provider_observation_mismatch",
    ] as const;
    const identities: string[] = [];
    const originalInputs = new Map<string, CreateJobContributionCommand["input"]>();
    for (const reason of reasons) {
      const id = uuidv7();
      identities.push(id);
      const base = command();
      const input = { ...base.input, contributionId: id };
      originalInputs.set(id, input);
      await intake.create({
        ...base,
        idempotencyKey: `recovery-${id}`,
        input,
      });
      await processing.recordOwnerState({
        contributionId: id,
        state: "awaiting_independent_verification",
        reasonCode: reason,
        processingPolicyVersion: "synthetic-processing-v1",
        occurredAt: new Date(),
      });
    }
    const now = new Date(Date.now() + 2_000);
    const claims = await queue.claim({
      workerId: "recovery:test",
      now,
      claimExpiresAt: new Date(now.getTime() + 30_000),
      limit: 25,
    });
    for (const id of identities) {
      const item = claims.find((row) => row.contributionId === id);
      if (!item) throw new Error("Expected synthetic recovery claim");
      await queue.park({
        item,
        workerId: "recovery:test",
        now,
        reason: identities.indexOf(id) === 4 ? "trust_pending" : "provider_pending",
      });
    }
    const first = await recovery.inspect();
    expect(first).toMatchObject({
      inspected: 4,
      retryable: 2,
      unavailable: 1,
      mismatch: 1,
      closed: 1,
      duplicate: 1,
      other: 0,
    });
    for (const id of identities) expect(JSON.stringify(first)).not.toContain(id);
    expect(JSON.stringify(first)).not.toContain(sourceUrl);
    await processing.recordOwnerState({
      contributionId: identities[0] as string,
      state: "awaiting_independent_verification",
      reasonCode: "provider_observation_mismatch",
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: now,
    });
    await expect(recovery.retry(first.fingerprint, now)).rejects.toThrow(
      "ContributionRecoverySnapshotChanged",
    );
    const current = await recovery.inspect();
    await expect(recovery.retry(current.fingerprint, now)).resolves.toEqual({ requeued: 2 });
    await expect(recovery.retry(current.fingerprint, now)).rejects.toThrow(
      "ContributionRecoverySnapshotChanged",
    );
    expect(await recovery.inspect()).toMatchObject({
      inspected: 2,
      retryable: 0,
      closed: 1,
      duplicate: 1,
    });
    for (const id of identities) {
      const [row] = await client<{ state: string; attempt: number; payload: unknown }[]>`
        SELECT queue.state, queue.attempt, contribution.payload
        FROM jobs.job_contribution_processing_queue AS queue
        JOIN jobs.job_contributions AS contribution ON contribution.id = queue.contribution_id
        WHERE contribution.id = ${id}
      `;
      expect(row?.state).toBe(identities.indexOf(id) < 2 ? "pending" : "parked");
      if (identities.indexOf(id) < 2) expect(row?.attempt).toBe(0);
      expect(row?.payload).toEqual(originalInputs.get(id));
    }
  });
});
