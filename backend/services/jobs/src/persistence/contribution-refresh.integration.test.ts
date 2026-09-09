import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { CreateJobContributionCommand } from "../contribution.js";
import type { IndependentVerificationEvidence } from "../contribution-processing.js";
import { normalizeContributionForProcessing } from "../contribution-processing-policy.js";
import { canonicalizeObservation } from "../domain/canonical-job.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";
import {
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
} from "./contribution-processing.js";
import { PostgresContributionReviewEvidenceReader } from "./contribution-review-evidence.js";

const url = process.env.DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

databaseDescribe("append-only contribution verification refresh", () => {
  const client = createJobCatalogDatabase(url ?? "postgres://invalid", { maxConnections: 2 });
  const intake = new PostgresJobContributionStore(client);
  const store = new PostgresContributionProcessingStore(client);
  const queue = new PostgresContributionProcessingQueueStore(client);
  type QueueItem = Awaited<ReturnType<typeof queue.claim>>[number];
  const claims = new Map<string, { item: QueueItem; now: Date }>();
  const reader = new PostgresContributionReviewEvidenceReader(client);
  const catalog = new PostgresJobCatalog(client, {
    acceptedProvenance: new Set(["permitted_api"]),
    searchCursorKeys: { active: { id: "refresh-synthetic-v1", key: Buffer.alloc(32, 9) } },
  });
  afterAll(async () => {
    await client.end();
  });
  afterEach(async () => {
    // Release every synthetic lease, including a successor lease used by a failure assertion.
    // Otherwise later simulated clocks repeatedly reclaim unrelated test work.
    for (const { item, now } of claims.values()) await park(item, now, "capability_disabled");
  });

  async function stage(
    at: Date,
    postingId = uuidv7(),
    description = "Synthetic provider truth",
    providerVerifiedAt = at,
  ) {
    const id = uuidv7();
    const owner = uuidv7();
    const sourceUrl = `https://jobs.lever.co/synthetic-refresh/${postingId}`;
    const command: CreateJobContributionCommand = {
      ownerUserId: owner,
      idempotencyKey: `refresh-${id}`,
      input: {
        schemaVersion: 1,
        contributionId: id,
        client: { surface: "browser_extension", version: "0.2.0" },
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl,
          externalJobId: postingId,
          adapterVersion: "d2-job-page-v1",
        },
        posting: {
          companyName: `Synthetic ${postingId}`,
          title: "Synthetic engineer",
          locations: ["Remote"],
          description,
        },
        observation: { observedAt: at.toISOString(), contentSha256: digest(description) },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-refresh-v1",
          approvedAt: at.toISOString(),
          approvedFields: [],
          previewDigestSha256: digest(id),
        },
      },
    };
    await intake.create(command);
    const normalized = await store.recordNormalization({
      contributionId: id,
      proposal: normalizeContributionForProcessing(command.input),
      processingPolicyVersion: "synthetic-refresh-v1",
      occurredAt: at,
    });
    const observation = {
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      companyName: `Synthetic ${postingId}`,
      title: command.input.posting.title,
      locations: ["Remote"],
      description,
      sourceUrl,
      atsTenant: "synthetic-refresh",
      externalJobId: postingId,
      adapterVersion: "lever-v1",
      observedAt: providerVerifiedAt,
    };
    const canonical = canonicalizeObservation(observation);
    const proof: IndependentVerificationEvidence = {
      status: "verified",
      origin: "independent_provider_fetch",
      contributionId: id,
      verificationId: uuidv7(),
      provider: "lever",
      pageVariant: "lever-posting-v1",
      canonicalSourceUrlSha256: canonical.canonicalUrlHash,
      evidenceDigestSha256: digest(`proof:${id}`),
      verifiedContentSha256: canonical.contentHash,
      sourcePolicyVersion: "synthetic-refresh-v1",
      verifiedAt: providerVerifiedAt.toISOString(),
      providerObservation: observation,
    };
    await store.recordIndependentVerification({
      contributionId: id,
      evidence: proof,
      processingPolicyVersion: "synthetic-refresh-v1",
      occurredAt: providerVerifiedAt,
    });
    if (!normalized.normalization) throw new Error("Synthetic normalization missing");
    return { id, owner, command, proof, normalization: normalized.normalization };
  }

  async function park(
    item: QueueItem,
    now: Date,
    reason: Parameters<typeof queue.park>[0]["reason"],
  ) {
    await queue.park({ item, workerId: "refresh:integration", now, reason });
    claims.delete(item.id);
  }

  async function claimEligible(now: Date, targetId?: string) {
    const observed: QueueItem[] = [];
    // Other serial integration suites leave synthetic queue rows in this shared database.
    // Drain at most 1,000 eligible fixtures through the real 25-item claim/park ports without
    // advancing the clock or changing eligibility. Absence assertions must reach an empty batch;
    // seeing only the first page could otherwise hide an incorrectly eligible target.
    for (let batch = 0; batch < 40; batch++) {
      const items = await queue.claim({
        workerId: "refresh:integration",
        now,
        claimExpiresAt: new Date(now.getTime() + 30_000),
        limit: 25,
      });
      observed.push(...items);
      for (const item of items) claims.set(item.id, { item, now });
      for (const item of items) {
        if (item.contributionId !== targetId) await park(item, now, "capability_disabled");
      }
      if (items.length === 0 || items.some((item) => item.contributionId === targetId))
        return observed;
    }
    throw new Error("Synthetic refresh queue inspection exceeded its fixture bound");
  }

  async function claim(id: string, now: Date) {
    const items = await claimEligible(now, id);
    const item = items.find((entry) => entry.contributionId === id);
    if (!item) throw new Error("Synthetic refresh claim unavailable");
    return item;
  }

  async function prepare(f: Awaited<ReturnType<typeof stage>>, now: Date) {
    await store.recordTrustDecision({
      contributionId: f.id,
      decision: {
        status: "accepted",
        contributionId: f.id,
        decisionId: uuidv7(),
        policyVersion: "synthetic-refresh-v1",
        decidedAt: now.toISOString(),
        evidenceDigestSha256: digest(`review:${f.id}`),
        independentEvidenceDigestSha256: f.proof.evidenceDigestSha256,
      },
      processingPolicyVersion: "synthetic-refresh-v1",
      occurredAt: now,
    });
    return store.preparePublication({
      contributionId: f.id,
      processingPolicyVersion: "synthetic-refresh-v1",
      capabilityPolicyVersion: "synthetic-refresh-v1",
      capabilityConfigurationDigestSha256: "f".repeat(64),
      capabilityEvaluatedAt: now.toISOString(),
      capabilityExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
      occurredAt: now,
    });
  }

  it("finds a fixture behind a full queue page without reclaiming unrelated leases", async () => {
    const at = new Date(Date.now() - 26 * 60 * 60_000);
    const generatedIds = new Set<string>();
    for (let index = 0; index < 26; index++) generatedIds.add((await stage(at)).id);
    const f = await stage(at);
    generatedIds.add(f.id);
    const now = new Date(Date.now() + 1_000);
    const item = await claim(f.id, now);
    expect(item.attempt).toBe(1);
    expect([...claims.values()].map((entry) => entry.item.contributionId)).toEqual([f.id]);
    await park(item, now, "capability_disabled");
    expect((await claimEligible(now)).some((entry) => generatedIds.has(entry.contributionId))).toBe(
      false,
    );
  });

  it("holds an accepted proof that expires between preparation and the final catalog mutation", async () => {
    const now = new Date();
    const f = await stage(new Date(now.getTime() - 24 * 60 * 60_000 + 10));
    const command = await prepare(f, now);
    let reads = 0;
    const reconciler = new PostgresContributionPublicationReconciler(
      client,
      catalog,
      () => new Date(now.getTime() + (reads++ === 0 ? 0 : 11)),
    );
    await expect(reconciler.publish(command)).rejects.toThrow("expired before publication");
    expect((await store.load(f.id))?.publication).toBeUndefined();
    expect((await store.load(f.id))?.trustDecision?.status).toBe("accepted");
    expect((await store.load(f.id))?.independentVerification?.verificationId).toBe(
      f.proof.verificationId,
    );
  });

  it("refuses a future-dated provider basis at publication preparation", async () => {
    const now = new Date();
    // Keep contributor intake valid while independently seeding the future-proof boundary.
    const f = await stage(
      new Date(now.getTime() - 1_000),
      undefined,
      undefined,
      new Date(now.getTime() + 1_000),
    );
    await expect(prepare(f, now)).rejects.toThrow("gates are not complete");
    expect((await store.load(f.id))?.publication).toBeUndefined();
  });

  it("refreshes a parked review once without rewriting any original proof or contributor payload", async () => {
    const initialClock = new Date(Date.now() + 1_000);
    const f = await stage(new Date(initialClock.getTime() - 26 * 60 * 60_000));
    const initial = await claim(f.id, initialClock);
    await park(initial, initialClock, "trust_pending");
    const refreshClock = new Date(initialClock.getTime() + 60 * 60_000);
    await claim(f.id, refreshClock);
    const reservation = await store.beginVerificationRefresh({
      contributionId: f.id,
      previousVerificationId: f.proof.verificationId,
      occurredAt: refreshClock,
    });
    expect(reservation?.attempt).toBe(1);
    if (reservation === null) throw new Error("Synthetic refresh reservation missing");
    expect(
      await store.beginVerificationRefresh({
        contributionId: f.id,
        previousVerificationId: f.proof.verificationId,
        occurredAt: refreshClock,
      }),
    ).toBeNull();
    const next = {
      ...f.proof,
      verificationId: uuidv7(),
      evidenceDigestSha256: digest(`refresh:${f.id}`),
      verifiedAt: refreshClock.toISOString(),
      providerObservation: { ...f.proof.providerObservation, observedAt: refreshClock },
    };
    await store.recordIndependentVerification({
      contributionId: f.id,
      evidence: next,
      refresh: { previousVerificationId: f.proof.verificationId, ...reservation },
      processingPolicyVersion: "synthetic-refresh-v1",
      occurredAt: refreshClock,
    });
    expect(await reader.read({ contributionId: f.id, contributorUserId: f.owner })).toMatchObject({
      evidenceDigestSha256: next.evidenceDigestSha256,
      verifiedAt: refreshClock.toISOString(),
    });
    const proofs = await client<{ id: string; digest: string; verifiedAt: Date }[]>`
      SELECT id, evidence_digest_sha256 AS digest, verified_at AS "verifiedAt"
      FROM jobs.job_contribution_independent_verifications WHERE contribution_id = ${f.id} ORDER BY verified_at
    `;
    expect(proofs).toHaveLength(2);
    expect(proofs[0]?.digest).toBe(f.proof.evidenceDigestSha256);
    expect(proofs[0]?.verifiedAt.toISOString()).toBe(f.proof.verifiedAt);
    expect((await store.load(f.id))?.input).toEqual(f.command.input);
    await expect(client`UPDATE jobs.job_contribution_independent_verifications SET verified_at = ${refreshClock}
      WHERE id = ${f.proof.verificationId}`).rejects.toThrow("immutable");
    // Reusing a digest for another generation cannot ambiguously rebind an acceptance.
    await expect(client`INSERT INTO jobs.job_contribution_independent_verifications
      SELECT ${uuidv7()}::uuid, contribution_id, normalization_id, job_id, source_id, provider, page_variant,
        canonical_source_url_sha256, evidence_digest_sha256, verified_content_sha256, source_policy_version,
        verified_at, processing_policy_version, created_at, provider_observation
      FROM jobs.job_contribution_independent_verifications WHERE id = ${f.proof.verificationId}`).rejects.toThrow();
  });

  it("does not let an expired worker append or finish through a successor queue lease", async () => {
    const start = new Date(Date.now() + 1_000);
    const f = await stage(new Date(start.getTime() - 26 * 60 * 60_000));
    await claim(f.id, start);
    const reservation = await store.beginVerificationRefresh({
      contributionId: f.id,
      previousVerificationId: f.proof.verificationId,
      occurredAt: start,
    });
    if (!reservation) throw new Error("Synthetic reservation missing");
    const later = new Date(start.getTime() + 31_000);
    const successor = await claim(f.id, later);
    expect(successor.attempt).toBe(2);
    const refreshed = {
      ...f.proof,
      verificationId: uuidv7(),
      evidenceDigestSha256: digest(`late:${f.id}`),
      verifiedAt: later.toISOString(),
      providerObservation: { ...f.proof.providerObservation, observedAt: later },
    };
    await expect(
      store.recordIndependentVerification({
        contributionId: f.id,
        evidence: refreshed,
        refresh: { previousVerificationId: f.proof.verificationId, ...reservation },
        processingPolicyVersion: "synthetic-refresh-v1",
        occurredAt: later,
      }),
    ).rejects.toThrow("lost its reservation");
    await store.finishVerificationRefresh({
      contributionId: f.id,
      ...reservation,
      outcome: "closed",
      occurredAt: later,
    });
    const [state] = await client<
      { outcome: string }[]
    >`SELECT verification_refresh_outcome AS outcome
      FROM jobs.job_contribution_processing_queue WHERE contribution_id = ${f.id}`;
    expect(state?.outcome).toBe("pending");
    expect((await store.load(f.id))?.independentVerification?.verificationId).toBe(
      f.proof.verificationId,
    );
  });

  it("caps automatic unavailable-provider refresh at three lifetime attempts with one-hour cooldown", async () => {
    const initialClock = new Date(Date.now() + 1_000);
    const f = await stage(new Date(initialClock.getTime() - 26 * 60 * 60_000));
    let item = await claim(f.id, initialClock);
    await park(item, initialClock, "trust_pending");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const now = new Date(initialClock.getTime() + attempt * 60 * 60_000);
      item = await claim(f.id, now);
      const reservation = await store.beginVerificationRefresh({
        contributionId: f.id,
        previousVerificationId: f.proof.verificationId,
        occurredAt: now,
      });
      expect(reservation?.attempt).toBe(attempt);
      if (!reservation) throw new Error("Synthetic refresh reservation missing");
      await store.finishVerificationRefresh({
        contributionId: f.id,
        ...reservation,
        outcome: "unavailable",
        occurredAt: now,
      });
      await park(item, now, "provider_pending");
      expect((await claimEligible(now)).some((entry) => entry.contributionId === f.id)).toBe(false);
    }
    const later = new Date(initialClock.getTime() + 4 * 60 * 60_000);
    expect((await claimEligible(later)).some((entry) => entry.contributionId === f.id)).toBe(false);
    expect((await store.load(f.id))?.independentVerification?.verificationId).toBe(
      f.proof.verificationId,
    );
  });

  it("publishes two owner submissions into one canonical job without regressing truth, and holds contradictory ties", async () => {
    const now = new Date();
    const posting = uuidv7();
    const newer = await stage(
      new Date(now.getTime() - 60_000),
      posting,
      "Newer independent provider truth",
    );
    const older = await stage(
      new Date(now.getTime() - 120_000),
      posting,
      "Older independent provider truth",
    );
    const tied = await stage(
      new Date(now.getTime() - 60_000),
      posting,
      "Contradictory tied provider truth",
    );
    const reconciler = new PostgresContributionPublicationReconciler(client, catalog, () => now);
    const first = await reconciler.publish(await prepare(newer, now));
    const second = await reconciler.publish(await prepare(older, now));
    expect(first.status).toBe("published");
    expect(second.status).toBe("published");
    if (first.status !== "published" || second.status !== "published")
      throw new Error("Unexpected synthetic hold");
    expect(second.jobId).toBe(first.jobId);
    expect(second.sourceId).toBe(first.sourceId);
    const [job] = await client<{ description: string; verifiedAt: Date }[]>`
      SELECT description, last_verified_at AS "verifiedAt" FROM jobs.canonical_jobs WHERE id = ${first.jobId}
    `;
    expect(job?.description).toBe(newer.proof.providerObservation.description);
    expect(job?.verifiedAt.toISOString()).toBe(newer.proof.verifiedAt);
    const [counts] = await client<{ evidence: number; owners: number }[]>`
      SELECT (SELECT count(*)::int FROM jobs.source_verification_evidence WHERE job_id = ${first.jobId}) AS evidence,
        (SELECT count(DISTINCT owner_user_id)::int FROM jobs.job_contributions WHERE id IN (${newer.id}, ${older.id})) AS owners
    `;
    expect(counts).toEqual({ evidence: 2, owners: 2 });
    expect(await reconciler.publish(await prepare(tied, now))).toEqual({
      status: "evidence_conflict",
    });
    expect((await store.load(tied.id))?.independentVerification?.verificationId).toBe(
      tied.proof.verificationId,
    );
    const [remaining] = await client<{ count: number }[]>`SELECT count(*)::int AS count
      FROM jobs.source_verification_evidence WHERE job_id = ${first.jobId}`;
    expect(remaining?.count).toBe(2);
  });
});
