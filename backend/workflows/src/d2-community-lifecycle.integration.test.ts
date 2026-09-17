import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { setTimeout as waitForRetry } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { OutboxNudgeV1 } from "@ai-job-apply/event-contracts";
import {
  ContributionProcessingRunner,
  ContributionProcessingService,
  ContributionTrustDecisionSignalConsumer,
  type CreateJobContributionCommand,
  canonicalizeObservation,
  contributionCapabilityPolicyDigestInput,
  createJobCatalogDatabase,
  type D2ContributionCapabilityPolicy,
  type IndependentVerificationEvidence,
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
  PostgresContributionReviewEvidenceReader,
  PostgresJobCatalog,
  PostgresJobContributionStore,
} from "@ai-job-apply/jobs-service";
import {
  IdentifierOnlyTrustDecisionEventPublisher,
  PostgresTrustDecisionSignalStore,
  PostgresTrustStore,
  TrustApplicationService,
  TrustDecisionDeliveryRunner,
  type TrustReviewerRole,
} from "@ai-job-apply/trust-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthoritativeContributionTrustDecisionAdapter } from "./contribution-trust-adapter.js";

// Use a separately disposable loopback cluster: Jobs' public-reader role audits cluster-wide
// CONNECT grants, so a database on an already migrated shared integration cluster is not isolated.
// Absence of this explicit opt-in skips the suite; never revoke another database's permissions.
const databaseUrl = process.env.D2_COMPOSED_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const PROCESSING_POLICY = "synthetic-composed-processing-v1";
const TRUST_POLICY = "synthetic-composed-trust-v1";
const retryPolicy = {
  maxAttempts: 3,
  claimLeaseMilliseconds: 30_000,
  retryDelayMilliseconds: [1_000, 2_000],
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

interface Fixture {
  command: CreateJobContributionCommand;
  evidence: IndependentVerificationEvidence;
  reviewDigest: string;
  appealDigest: string;
}

/**
 * The only synthetic authorities are the exact account/reviewer assignments, provider observation,
 * current-consent port and signed capability. Trust transitions, outbox delivery, owner reads,
 * Jobs processing and catalog reconciliation all use their real public PostgreSQL-backed ports.
 * No HTTP/provider request, direct domain-table SQL, or shared-database fixture cleanup is used.
 */
describeWithDatabase("composed PostgreSQL D2 Trust-to-Jobs lifecycle", () => {
  const databaseName = `d2_composed_${randomUUID().replaceAll("-", "")}`;
  let administrator: ReturnType<typeof createJobCatalogDatabase> | undefined;
  let databaseCreated = false;
  let client: ReturnType<typeof createJobCatalogDatabase> | undefined;
  let intake: PostgresJobContributionStore;
  let processing: PostgresContributionProcessingStore;
  let catalog: PostgresJobCatalog;
  let trustStore: PostgresTrustStore;
  let signals: PostgresTrustDecisionSignalStore;
  let trust: TrustApplicationService;
  let processingRunner: ContributionProcessingRunner;
  let deliveryRunner: TrustDecisionDeliveryRunner;
  let consumer: ContributionTrustDecisionSignalConsumer;
  const fixtures = new Map<string, Fixture>();
  const delivered: OutboxNudgeV1[] = [];
  const reviewers = { opener: uuidv7(), initial: uuidv7(), appeal: uuidv7() };
  const otherOwner = uuidv7();
  let loseNextAcknowledgement = false;
  const now = () => new Date();
  const advance = now;

  beforeAll(async () => {
    if (!databaseUrl)
      throw new Error("D2_COMPOSED_DATABASE_URL is required for this isolated suite");
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !/^d2_composed_[a-f0-9]{32}$/.test(databaseName)
    ) {
      throw new Error("Composed D2 acceptance requires an explicit loopback-only test database");
    }
    administrator = createJobCatalogDatabase(databaseUrl, { maxConnections: 1 });
    await administrator.unsafe(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    url.pathname = `/${databaseName}`;
    for (const owner of ["profile", "jobs", "trust"]) {
      const executable = fileURLToPath(
        new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url),
      );
      try {
        await execFileAsync(process.execPath, [executable], {
          env: { ...process.env, DATABASE_URL: url.toString() },
          timeout: 60_000,
        });
      } catch {
        throw new Error(`The isolated ${owner} migration failed; build its package first`);
      }
    }
    client = createJobCatalogDatabase(url.toString(), { maxConnections: 2 });
    intake = new PostgresJobContributionStore(client);
    processing = new PostgresContributionProcessingStore(client);
    catalog = new PostgresJobCatalog(client, {
      acceptedProvenance: new Set(["permitted_api"]),
      searchCursorKeys: { active: { id: "synthetic-v1", key: Buffer.alloc(32, 7) } },
    });
    trustStore = new PostgresTrustStore(client);
    signals = new PostgresTrustDecisionSignalStore(client);
    const queue = new PostgresContributionProcessingQueueStore(client);
    const reviewEvidence = new PostgresContributionReviewEvidenceReader(client);
    trust = new TrustApplicationService({
      store: trustStore,
      systemActorId: uuidv7(),
      now,
      contributorAccountAuthority: {
        authorize: async ({ contributorUserId }) =>
          contributorUserId === otherOwner ||
          [...fixtures.values()].some((item) => item.command.ownerUserId === contributorUserId),
      },
      reviewerAuthority: {
        authorize: async ({ reviewerId, role }) => {
          const roles: Record<string, readonly TrustReviewerRole[]> = {
            [reviewers.opener]: ["case_opener", "case_reader"],
            [reviewers.initial]: [
              "case_reader",
              "initial_reviewer",
              "takedown_reviewer",
              "appeal_reviewer",
            ],
            [reviewers.appeal]: ["case_reader", "appeal_reviewer"],
          };
          return roles[reviewerId]?.includes(role) === true;
        },
      },
      approvedPolicy: {
        readApprovedPolicy: async () => ({
          version: TRUST_POLICY,
          appealWindowMilliseconds: 86_400_000,
        }),
      },
      contributionEvidence: {
        readReviewEvidence: (input) => reviewEvidence.read(input),
        readEligibility: async (contributionId) => {
          const value = await processing.load(contributionId);
          return value
            ? {
                contributionId,
                contributorUserId: value.ownerUserId,
                eligibleForTrustReview: value.independentVerification !== undefined,
              }
            : null;
        },
        verifyEvidence: async ({ contributionId, evidenceDigestSha256, purpose, freshAt }) => {
          const value = await processing.load(contributionId);
          const fixture = fixtures.get(contributionId);
          if (!value?.independentVerification || !fixture) return false;
          if (freshAt !== undefined) {
            const proofAt = Date.parse(value.independentVerification.verifiedAt);
            const decisionAt = Date.parse(freshAt);
            const age = decisionAt - proofAt;
            if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60_000) return false;
          }
          return (
            evidenceDigestSha256 ===
            (purpose === "independent_verification"
              ? value.independentVerification.evidenceDigestSha256
              : purpose === "appeal_resolution"
                ? fixture.appealDigest
                : fixture.reviewDigest)
          );
        },
      },
    });
    const policy: D2ContributionCapabilityPolicy = {
      schemaVersion: 1,
      revision: "d2-synthetic-composed-v1",
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      intakeEnabled: true,
      processingEnabled: true,
      clients: { "0.2.0": true },
      providers: { greenhouse: false, lever: true, ashby: false },
      variants: {
        "greenhouse-board-v1": false,
        "lever-posting-v1": true,
        "ashby-job-board-v1": false,
      },
      domains: {
        "boards.greenhouse.io": false,
        "job-boards.greenhouse.io": false,
        "jobs.lever.co": true,
        "jobs.eu.lever.co": false,
        "jobs.ashbyhq.com": false,
      },
    };
    const keys = generateKeyPairSync("ed25519");
    const signedPolicy = {
      envelope: {
        keyId: "synthetic-composed-v1",
        payload: policy,
        signature: sign(
          null,
          Buffer.from(contributionCapabilityPolicyDigestInput(policy)),
          keys.privateKey,
        ).toString("base64url"),
      },
      publicKeys: {
        "synthetic-composed-v1": keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
    };
    processingRunner = new ContributionProcessingRunner(
      queue,
      new ContributionProcessingService({
        store: processing,
        consent: {
          verifyCurrent: async (binding) => {
            const fixture = fixtures.get(binding.contributionId);
            return {
              status:
                fixture &&
                fixture.command.ownerUserId === binding.ownerUserId &&
                fixture.command.input.approval.consentId === binding.consentId &&
                fixture.command.input.approval.previewDigestSha256 === binding.previewDigestSha256
                  ? "current"
                  : "invalid",
            };
          },
        },
        independentVerifier: {
          verify: async ({ contributionId }) => {
            const fixture = fixtures.get(contributionId);
            if (!fixture) throw new Error("Unknown generated fixture");
            return fixture.evidence;
          },
        },
        trust: new AuthoritativeContributionTrustDecisionAdapter(trust, signals, reviewers.opener),
        capability: { load: async () => signedPolicy },
        reconciler: new PostgresContributionPublicationReconciler(client, catalog, now),
        policy: { version: PROCESSING_POLICY },
        now,
      }),
      retryPolicy,
    );
    consumer = new ContributionTrustDecisionSignalConsumer(
      signals,
      processing,
      queue,
      PROCESSING_POLICY,
    );
    deliveryRunner = new TrustDecisionDeliveryRunner(
      signals,
      new IdentifierOnlyTrustDecisionEventPublisher({
        publish: async (nudge) => {
          delivered.push(nudge);
          expect(Object.keys(nudge).sort()).toEqual([
            "eventId",
            "eventType",
            "integrity",
            "schemaVersion",
          ]);
          await consumer.consume(nudge, now());
          if (loseNextAcknowledgement) {
            loseNextAcknowledgement = false;
            throw new Error("Synthetic acknowledgement lost after committed consumer");
          }
        },
      }),
      retryPolicy,
    );
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    try {
      if (databaseCreated) {
        if (!administrator || !/^d2_composed_[a-f0-9]{32}$/.test(databaseName)) {
          throw new Error("Refusing cleanup outside the exact generated D2 database");
        }
        await administrator.unsafe(`DROP DATABASE "${databaseName}"`);
        databaseCreated = false;
      }
    } finally {
      await administrator?.end();
    }
  });

  async function createFixture() {
    const contributionId = uuidv7();
    const unique = contributionId.slice(-12);
    const ownerUserId = uuidv7();
    const sourceUrl = `https://jobs.lever.co/synthetic-composed-${unique}/${contributionId}`;
    const posting = {
      companyName: `Generated Composed Company ${unique}`,
      title: `Generated Engineer ${unique}`,
      locations: ["Synthetic City"],
      description: `Generated independent provider content for the composed lifecycle ${unique}.`,
    };
    const observedAt = new Date(Date.now() - 60_000);
    const providerObservation = {
      ...posting,
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      sourceUrl,
      atsTenant: `synthetic-composed-${unique}`,
      externalJobId: contributionId,
      adapterVersion: "lever-v1",
      observedAt,
    };
    const canonical = canonicalizeObservation(providerObservation);
    const command: CreateJobContributionCommand = {
      ownerUserId,
      idempotencyKey: `synthetic-composed-${contributionId}`,
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
        posting,
        observation: {
          observedAt: observedAt.toISOString(),
          contentSha256: digest(`content:${contributionId}`),
        },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-composed-ugc-v1",
          approvedAt: new Date(Date.now() - 30_000).toISOString(),
          approvedFields: [],
          previewDigestSha256: digest(`preview:${contributionId}`),
        },
      },
    };
    const fixture: Fixture = {
      command,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId,
        verificationId: uuidv7(),
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: canonical.canonicalUrlHash,
        evidenceDigestSha256: digest(`verification:${contributionId}`),
        verifiedContentSha256: canonical.contentHash,
        providerObservation,
        sourcePolicyVersion: "synthetic-composed-source-v1",
        verifiedAt: observedAt.toISOString(),
      },
      reviewDigest: digest(`review:${contributionId}`),
      appealDigest: digest(`appeal:${contributionId}`),
    };
    fixtures.set(contributionId, fixture);
    const created = await intake.create(command);
    expect(await intake.create(command)).toEqual(created);
    expect(await intake.get(otherOwner, contributionId)).toBeNull();
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      claimed: 1,
      parked: 1,
      completed: 0,
      retried: 0,
      dead: 0,
    });
    expect(await processing.load(contributionId)).toMatchObject({ ownerState: "awaiting_trust" });
    const opened = await trust.readOwnerCase({ contributorUserId: ownerUserId, contributionId });
    expect(opened.state).toBe("needs_review");
    expect(
      (await catalog.searchActiveJobs({ filters: { company: posting.companyName } }, now())).items,
    ).toHaveLength(0);
    await deliver();
    // The open-case signal only wakes review; it cannot grant publication.
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      parked: 1,
    });
    return { ...fixture, caseId: opened.id };
  }

  async function deliver() {
    const result = await deliveryRunner.runBatch("composed:delivery", advance(), 25);
    expect(result.dead).toBe(0);
    return result;
  }

  async function accept(fixture: Fixture & { caseId: string }, expectedVersion = 1) {
    advance();
    return trust.decideInitialReview({
      reviewerId: reviewers.initial,
      caseId: fixture.caseId,
      expectedVersion,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: fixture.evidence.evidenceDigestSha256,
    });
  }

  async function assertPublished(fixture: Fixture) {
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      claimed: 1,
      completed: 1,
      parked: 0,
      retried: 0,
      dead: 0,
    });
    const loaded = await processing.load(fixture.command.input.contributionId);
    expect(loaded?.ownerState).toBe("published");
    expect(loaded?.publication).toBeDefined();
    if (!loaded?.publication) throw new Error("Expected generated publication");
    const active = await catalog.getActiveJob(loaded.publication.jobId, now());
    expect(active?.description).toBe(fixture.evidence.providerObservation.description);
    expect(active?.sources).toHaveLength(1);
    return loaded.publication;
  }

  it("publishes only real accepted Trust decisions and converges a lost acknowledgement, then withdraws without erasing provider truth", async () => {
    const fixture = await createFixture();
    const {
      ownerUserId,
      input: { contributionId },
    } = fixture.command;
    await expect(
      trust.readOwnerCase({ contributorUserId: otherOwner, contributionId }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      accept({
        ...fixture,
        evidence: { ...fixture.evidence, evidenceDigestSha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "evidence_not_verified" });
    const accepted = await accept(fixture);
    expect(accepted.state).toBe("accepted");
    loseNextAcknowledgement = true;
    expect(await deliver()).toMatchObject({ claimed: 1, published: 0, retried: 1 });
    const publication = await assertPublished(fixture);
    const acceptedNudge = delivered.at(-1);
    await waitForRetry(1_050);
    expect(await deliver()).toMatchObject({ claimed: 1, published: 1, retried: 0 });
    expect(delivered.at(-1)).toEqual(acceptedNudge);
    await processingRunner.runBatch("composed:processing", advance(), 25);
    expect((await processing.load(contributionId))?.publication).toEqual(publication);
    expect(
      await signals.readLatestDecision({ contributionId, contributorUserId: otherOwner }),
    ).toBeNull();
    advance();
    await trust.withdrawOwnerContribution({
      contributorUserId: ownerUserId,
      contributionId,
      expectedVersion: accepted.version,
    });
    await deliver();
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      completed: 1,
    });
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "removed" });
    expect((await catalog.getActiveJob(publication.jobId, now()))?.description).toBe(
      fixture.evidence.providerObservation.description,
    );
    const withdrawalNudge = delivered.at(-1);
    if (!withdrawalNudge) throw new Error("Expected withdrawal signal");
    await consumer.consume(withdrawalNudge, advance());
    await processingRunner.runBatch("composed:processing", advance(), 25);
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "removed" });
    if (!acceptedNudge) throw new Error("Expected accepted decision signal");
    await consumer.consume(acceptedNudge, advance());
    await processingRunner.runBatch("composed:processing", advance(), 25);
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "removed" });
    expect((await processing.load(contributionId))?.trustDecision?.status).toBe("withdrawn");
    expect(JSON.stringify(delivered)).not.toContain(ownerUserId);
  });

  it("keeps rejection unpublished, requires a distinct appeal reviewer, then publishes and reconciles a takedown", async () => {
    const fixture = await createFixture();
    const {
      ownerUserId,
      input: { contributionId },
    } = fixture.command;
    advance();
    const rejected = await trust.decideInitialReview({
      reviewerId: reviewers.initial,
      caseId: fixture.caseId,
      expectedVersion: 1,
      outcome: "rejected",
      reasonCode: "content_mismatch",
      evidenceDigestSha256: fixture.reviewDigest,
    });
    await deliver();
    await processingRunner.runBatch("composed:processing", advance(), 25);
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "rejected" });
    expect(
      (
        await catalog.searchActiveJobs(
          { filters: { company: fixture.evidence.providerObservation.companyName } },
          now(),
        )
      ).items,
    ).toHaveLength(0);
    advance();
    const appealed = await trust.appealOwnerDecision({
      contributorUserId: ownerUserId,
      contributionId,
      expectedVersion: rejected.version,
      evidenceDigestSha256: fixture.appealDigest,
    });
    await deliver();
    const resolution = {
      caseId: fixture.caseId,
      expectedVersion: appealed.version,
      outcome: "reversed" as const,
      evidenceDigestSha256: fixture.appealDigest,
    };
    await expect(
      trust.resolveAppeal({ ...resolution, reviewerId: reviewers.initial }),
    ).rejects.toMatchObject({ code: "access_denied" });
    advance();
    const reversed = await trust.resolveAppeal({ ...resolution, reviewerId: reviewers.appeal });
    await deliver();
    const publication = await assertPublished(fixture);
    advance();
    await trust.takeDownAcceptedContribution({
      reviewerId: reviewers.initial,
      caseId: fixture.caseId,
      expectedVersion: reversed.version,
      reasonCode: "rights_or_policy_violation",
      evidenceDigestSha256: fixture.reviewDigest,
    });
    await deliver();
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      completed: 1,
    });
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "removed" });
    expect((await catalog.getActiveJob(publication.jobId, now()))?.description).toBe(
      fixture.evidence.providerObservation.description,
    );
    expect(await trustStore.readOwnerReputationEvidence(ownerUserId, fixture.caseId)).toEqual([
      expect.objectContaining({ signalCode: "contributor_submission_incorrect" }),
      expect.objectContaining({ signalCode: "adverse_decision_reversed" }),
    ]);
    expect(await deliveryRunner.runBatch("composed:delivery", advance(), 25)).toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      dead: 0,
    });
  });

  it("restores a published association after a distinct reviewer reverses its takedown", async () => {
    const fixture = await createFixture();
    const {
      ownerUserId,
      input: { contributionId },
    } = fixture.command;
    const accepted = await accept(fixture);
    await deliver();
    const publication = await assertPublished(fixture);

    advance();
    const takenDown = await trust.takeDownAcceptedContribution({
      reviewerId: reviewers.initial,
      caseId: fixture.caseId,
      expectedVersion: accepted.version,
      reasonCode: "rights_or_policy_violation",
      evidenceDigestSha256: fixture.reviewDigest,
    });
    await deliver();
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      claimed: 1,
      completed: 1,
      parked: 0,
    });
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "removed" });

    advance();
    const appealed = await trust.appealOwnerDecision({
      contributorUserId: ownerUserId,
      contributionId,
      expectedVersion: takenDown.version,
      evidenceDigestSha256: fixture.appealDigest,
    });
    await deliver();
    const resolution = {
      caseId: fixture.caseId,
      expectedVersion: appealed.version,
      outcome: "reversed" as const,
      evidenceDigestSha256: fixture.appealDigest,
    };
    await expect(
      trust.resolveAppeal({ ...resolution, reviewerId: reviewers.initial }),
    ).rejects.toMatchObject({ code: "access_denied" });
    advance();
    const reversed = await trust.resolveAppeal({ ...resolution, reviewerId: reviewers.appeal });
    expect(reversed.state).toBe("accepted");
    await deliver();
    expect(await processingRunner.runBatch("composed:processing", advance(), 25)).toMatchObject({
      claimed: 1,
      completed: 1,
      parked: 0,
      retried: 0,
      dead: 0,
    });
    expect(await intake.get(ownerUserId, contributionId)).toMatchObject({ state: "published" });
    expect(await processing.load(contributionId)).toMatchObject({
      ownerState: "published",
      publication,
      trustDecision: { status: "accepted" },
    });
    expect((await catalog.getActiveJob(publication.jobId, now()))?.description).toBe(
      fixture.evidence.providerObservation.description,
    );
  });
});
