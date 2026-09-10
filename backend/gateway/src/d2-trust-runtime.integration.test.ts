import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { D2LambdaGatewayTrustConfiguration } from "@ai-job-apply/config";
import {
  type CreateJobContributionCommand,
  canonicalizeObservation,
  normalizeContributionForProcessing,
  PostgresContributionProcessingStore,
  PostgresJobContributionStore,
} from "@ai-job-apply/jobs-service";
import { createDatabase } from "@ai-job-apply/profile-service";
import { PostgresTrustDecisionSignalStore, PostgresTrustStore } from "@ai-job-apply/trust-service";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfiguredD2TrustRuntime } from "./d2-trust-runtime.js";
import { trustReviewerId } from "./trust-reviewer-authority.js";

// Opt in only with a dedicated disposable PostgreSQL server: Jobs' reader role is cluster-global.
const databaseUrl = process.env.D2_TRUST_RUNTIME_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const modes = ["ordinary", "profile-drizzle"] as const;

databaseDescribe("configured Trust runtime with real gateway database clients", () => {
  const baseUrl = new URL(databaseUrl ?? "postgres://invalid/unused");
  const isolatedUrl = new URL(baseUrl);
  const databaseName = `d2_trust_runtime_${uuidv7().replaceAll("-", "")}`;
  isolatedUrl.pathname = `/${databaseName}`;
  const admin = postgres(baseUrl.href, { max: 1, onnotice: () => undefined });
  const ordinary = postgres(isolatedUrl.href, { max: 2, onnotice: () => undefined });
  // This is the actual factory used by lambda.ts, not a recreated serializer mock.
  const shared = createDatabase(isolatedUrl.href, { maxConnections: 2 }).client;
  const clientFor = (mode: (typeof modes)[number]) => (mode === "ordinary" ? ordinary : shared);
  let created = false;
  const assignment: D2LambdaGatewayTrustConfiguration["reviewerAssignments"][number] = {
    issuer: "https://identity.example.test/",
    subject: "auth0|reviewer-synthetic",
    roles: ["initial_reviewer", "case_reader"],
    verifiedRequesterTakedown: false,
  };
  const reviewerId = trustReviewerId(assignment.issuer, assignment.subject);
  const configuration: D2LambdaGatewayTrustConfiguration = {
    reviewerAssignments: [assignment],
    evidenceAllowlist: [],
    policyVersion: "d2-synthetic-trust.v1",
    appealWindowMilliseconds: 86_400_000,
    systemActorId: uuidv7(),
  };

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
      throw new Error("Trust runtime integration requires a disposable loopback PostgreSQL server");
    }
    // A separate database isolates the global delivery queue from parallel package suites.
    await admin`CREATE DATABASE ${admin(databaseName)}`;
    created = true;
    for (const owner of ["profile", "jobs", "trust"]) {
      await execFileAsync(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: { ...process.env, DATABASE_URL: isolatedUrl.href }, windowsHide: true },
      );
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all([ordinary.end(), shared.end()]);
    try {
      // Only the exact random database successfully created by this suite may be removed.
      if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
    } finally {
      await admin.end();
    }
  });

  function caseInput(at = new Date(Date.now() - 5_000)) {
    return {
      caseId: uuidv7(),
      contributionId: uuidv7(),
      contributorUserId: uuidv7(),
      systemActorId: configuration.systemActorId,
      policy: {
        version: configuration.policyVersion,
        appealWindowMilliseconds: configuration.appealWindowMilliseconds,
      },
      occurredAt: at,
    };
  }

  async function stageVerifiedCase() {
    const input = caseInput();
    const postingId = uuidv7();
    const sourceUrl = `https://jobs.lever.co/synthetic-runtime/${postingId}`;
    const posting = {
      companyName: "Synthetic",
      title: "Synthetic engineer",
      locations: ["Remote"],
      description: "Synthetic provider truth",
    };
    const command: CreateJobContributionCommand = {
      ownerUserId: input.contributorUserId,
      idempotencyKey: `runtime-${input.contributionId}`,
      input: {
        schemaVersion: 1,
        contributionId: input.contributionId,
        client: { surface: "browser_extension", version: "0.2.0" },
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl,
          externalJobId: postingId,
          adapterVersion: "d2-job-page-v1",
        },
        posting,
        observation: {
          observedAt: input.occurredAt.toISOString(),
          contentSha256: digest("Synthetic provider truth"),
        },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-runtime-v1",
          approvedAt: input.occurredAt.toISOString(),
          approvedFields: [],
          previewDigestSha256: digest(input.contributionId),
        },
      },
    };
    await new PostgresJobContributionStore(ordinary).create(command);
    const processing = new PostgresContributionProcessingStore(ordinary);
    await processing.recordNormalization({
      contributionId: input.contributionId,
      proposal: normalizeContributionForProcessing(command.input),
      processingPolicyVersion: "synthetic-runtime-v1",
      occurredAt: input.occurredAt,
    });
    const observation = {
      ...posting,
      provider: "lever" as const,
      provenance: "permitted_api" as const,
      sourceUrl,
      atsTenant: "synthetic-runtime",
      externalJobId: postingId,
      adapterVersion: "lever-v1",
      observedAt: input.occurredAt,
    };
    const canonical = canonicalizeObservation(observation);
    const evidenceDigestSha256 = digest(`proof:${input.contributionId}`);
    await processing.recordIndependentVerification({
      contributionId: input.contributionId,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: input.contributionId,
        verificationId: uuidv7(),
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrlSha256: canonical.canonicalUrlHash,
        evidenceDigestSha256,
        verifiedContentSha256: canonical.contentHash,
        sourcePolicyVersion: "synthetic-runtime-v1",
        verifiedAt: input.occurredAt.toISOString(),
        providerObservation: observation,
      },
      processingPolicyVersion: "synthetic-runtime-v1",
      occurredAt: input.occurredAt,
    });
    // Production opens cases in the ordinary-client worker before the shared-client gateway decides.
    await new PostgresTrustStore(ordinary).open(input);
    return { ...input, evidenceDigestSha256 };
  }

  it.each(modes)(
    "commits configured acceptance and immutable signal truth with %s",
    async (mode) => {
      const input = await stageVerifiedCase();
      const client = clientFor(mode);
      const service = createConfiguredD2TrustRuntime(client, configuration).service;
      const decision = {
        reviewerId,
        caseId: input.caseId,
        expectedVersion: 1,
        outcome: "accepted" as const,
        reasonCode: "independently_verified" as const,
        evidenceDigestSha256: input.evidenceDigestSha256,
      };
      await expect(
        service.decideInitialReview({ ...decision, reviewerId: uuidv7() }),
      ).rejects.toMatchObject({ code: "access_denied" });
      await expect(
        service.decideInitialReview({ ...decision, evidenceDigestSha256: digest("wrong proof") }),
      ).rejects.toMatchObject({ code: "evidence_not_verified" });
      const accepted = await service.decideInitialReview(decision);
      expect(accepted).toMatchObject({
        state: "accepted",
        version: 2,
        adverseDecision: null,
        independentEvidenceDigestSha256: input.evidenceDigestSha256,
      });
      expect(accepted.updatedAt).toBeInstanceOf(Date);
      await expect(service.decideInitialReview(decision)).rejects.toMatchObject({
        code: "version_conflict",
      });
      const [counts] = await client`
      SELECT
        (SELECT count(*)::int FROM trust.case_events WHERE case_id = ${input.caseId}) AS events,
        (SELECT count(*)::int FROM trust.contribution_decision_outbox WHERE subject = ${input.contributionId}) AS outbox,
        (SELECT count(*)::int FROM trust.contribution_decision_deliveries delivery
          JOIN trust.contribution_decision_outbox event ON event.id = delivery.event_id
          WHERE event.subject = ${input.contributionId}) AS deliveries,
        (SELECT count(*)::int FROM trust.reputation_evidence WHERE case_id = ${input.caseId}) AS reputation
    `;
      expect(counts).toEqual({ events: 2, outbox: 2, deliveries: 2, reputation: 1 });
      const [event] = await client<{ id: string }[]>`
      SELECT event_id AS id FROM trust.case_events WHERE case_id = ${input.caseId} AND case_version = 2
    `;
      if (!event) throw new Error("Synthetic accepted event missing");
      await expect(
        new PostgresTrustDecisionSignalStore(client).readDecision({
          decisionId: event.id,
          contributionId: input.contributionId,
          contributorUserId: input.contributorUserId,
        }),
      ).resolves.toMatchObject({
        status: "accepted",
        independentEvidenceDigestSha256: input.evidenceDigestSha256,
      });
    },
  );

  it.each(modes)(
    "preserves open, adverse dates and explicit reputation writes with %s",
    async (mode) => {
      const client = clientFor(mode);
      const store = new PostgresTrustStore(client);
      const input = caseInput();
      const opened = await store.open(input);
      expect(opened.createdAt).toEqual(input.occurredAt);
      await expect(store.open(input)).resolves.toEqual(opened);
      const occurredAt = new Date(input.occurredAt.getTime() + 1_000);
      const rejected = await store.review(input.caseId, 1, {
        reviewerId,
        outcome: "rejected",
        reasonCode: "content_mismatch",
        evidenceDigestSha256: digest("synthetic mismatch"),
        occurredAt,
      });
      expect(rejected.adverseDecision).toMatchObject({
        decidedAt: occurredAt,
        appealDeadlineAt: new Date(occurredAt.getTime() + configuration.appealWindowMilliseconds),
      });
      const id = uuidv7();
      await store.recordReputationEvidence({
        id,
        caseId: input.caseId,
        expectedCaseVersion: 2,
        reviewerId,
        subject: { kind: "source", sourceKeySha256: digest("synthetic source") },
        signalCode: "source_content_conflict",
        referenceDigestSha256: digest("synthetic evidence"),
        occurredAt,
      });
      const [recorded] = await client<{ occurredAt: Date | string }[]>`
      SELECT occurred_at AS "occurredAt" FROM trust.reputation_evidence WHERE id = ${id}
    `;
      expect(new Date(recorded?.occurredAt ?? "")).toEqual(occurredAt);
    },
  );

  it.each(modes)(
    "keeps delivery retry, expired lease recovery and acknowledgement intact with %s",
    async (mode) => {
      const client = clientFor(mode);
      await new PostgresTrustStore(ordinary).open(caseInput());
      const signals = new PostgresTrustDecisionSignalStore(client);
      const now = new Date();
      const workerId = `synthetic:${mode}`;
      const claim = (at: Date) =>
        signals.claim({
          workerId,
          now: at,
          claimExpiresAt: new Date(at.getTime() + 1_000),
          maxAttempts: 5,
          limit: 25,
        });
      const first = await claim(now);
      expect(first.length).toBeGreaterThan(0);
      for (const item of first) {
        expect(item.claimExpiresAt).toBeInstanceOf(Date);
        await signals.retry({
          item,
          workerId,
          now,
          retryAt: new Date(now.getTime() + 100),
          errorCode: "transport_unavailable",
          terminal: false,
        });
      }
      const retried = await claim(new Date(now.getTime() + 100));
      expect(retried.map((item) => item.event.id).sort()).toEqual(
        first.map((item) => item.event.id).sort(),
      );
      expect(retried.every((item) => item.attempt === 2)).toBe(true);
      const recovered = await claim(new Date(now.getTime() + 1_100));
      expect(recovered.map((item) => item.event.id).sort()).toEqual(
        first.map((item) => item.event.id).sort(),
      );
      expect(recovered.every((item) => item.attempt === 3)).toBe(true);
      for (const item of recovered) {
        const acknowledgement = { item, workerId, now: new Date(now.getTime() + 1_100) };
        await signals.acknowledge(acknowledgement);
        await signals.acknowledge(acknowledgement);
      }
      await expect(claim(new Date(now.getTime() + 2_200))).resolves.toEqual([]);
    },
  );
});
