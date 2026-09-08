import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  expectedJobContributionApprovedFields,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "../../../packages/api-contracts/dist/src/job-contribution-canonical.js";
import { PostgresUgcContributionConsentStore } from "../../../backend/services/profile/dist/src/ugc-contribution-consent.js";
import { PostgresPrivateSavedPageCaptureStore } from "../../../backend/services/matching/dist/src/private-saved-page-captures.js";
import { PostgresTrustStore } from "../../../backend/services/trust/dist/src/store.js";
import { PostgresTrustDecisionSignalStore } from "../../../backend/services/trust/dist/src/decision-signal-store.js";
import { PostgresJobContributionStore } from "../../../backend/services/jobs/dist/src/persistence/contribution.js";
import {
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
} from "../../../backend/services/jobs/dist/src/persistence/contribution-processing.js";
import { PostgresJobCatalog } from "../../../backend/services/jobs/dist/src/persistence/catalog.js";
import { normalizeContributionForProcessing } from "../../../backend/services/jobs/dist/src/contribution-processing-policy.js";
import { canonicalizeObservation } from "../../../backend/services/jobs/dist/src/domain/canonical-job.js";
import { ContributionProcessingService } from "../../../backend/services/jobs/dist/src/contribution-processing.js";
import {
  DEVELOPMENT_CONTRIBUTION_CAPABILITIES,
  DevelopmentContributionCapabilitySource,
} from "../../../backend/services/jobs/dist/src/contribution-capability-source.js";

const dependency = createRequire(
  new URL("../../../backend/services/jobs/package.json", import.meta.url),
);
const { v7: uuidv7 } = await import(pathToFileURL(dependency.resolve("uuid")).href);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const observedAt = new Date(Date.now() - 60_000).toISOString();
const processingPolicyVersion = "synthetic-recovery-v1";

export const requiredNonemptyD2Relations = [
  "profile.ugc_contribution_consents",
  "matching.private_saved_page_captures",
  "matching.private_saved_page_capture_commands",
  "matching.private_saved_page_capture_audit_events",
  "jobs.job_contributions",
  "jobs.job_contribution_outbox",
  "jobs.job_contribution_processing_queue",
  "jobs.job_contribution_processing_event_deliveries",
  "jobs.job_contribution_normalizations",
  "jobs.job_contribution_independent_verifications",
  "jobs.job_contribution_trust_decisions",
  "jobs.job_contribution_reconciliations",
  "jobs.job_contribution_state_events",
  "trust.contribution_cases",
  "trust.case_events",
  "trust.contribution_decision_outbox",
  "trust.contribution_decision_deliveries",
  "trust.reputation_evidence",
];

function lease(contributionId, provider, at) {
  const descriptor = DEVELOPMENT_CONTRIBUTION_CAPABILITIES[provider];
  return {
    contributionId,
    processingPolicyVersion,
    capabilityPolicyVersion: descriptor.version,
    capabilityConfigurationDigestSha256: descriptor.configurationDigestSha256,
    capabilityEvaluatedAt: at.toISOString(),
    capabilityExpiresAt: new Date(at.getTime() + 60_000).toISOString(),
    developmentOperationLease: true,
    occurredAt: at,
  };
}

function ports(client, profileClient) {
  const consents = new PostgresUgcContributionConsentStore(profileClient);
  const revocationCommands = [];
  return {
    consents,
    revocationCommands,
    captures: new PostgresPrivateSavedPageCaptureStore(client),
    intake: new PostgresJobContributionStore(client),
    processing: new PostgresContributionProcessingStore(client),
    trust: new PostgresTrustStore(client),
    signals: new PostgresTrustDecisionSignalStore(client),
    revoke: {
      async revoke(binding) {
        const command = {
          consentId: binding.consentId,
          ownerUserId: binding.ownerUserId,
          idempotencyKey: `synthetic-recovery-cancel-${binding.contributionId}`,
          occurredAt: binding.occurredAt,
          traceId: "synthetic-recovery",
        };
        await consents.revoke(command);
        revocationCommands.push(command);
      },
    },
    currentConsent: {
      async verifyCurrent(binding) {
        const verified = await consents.verify({
          consentId: binding.consentId,
          ownerUserId: binding.ownerUserId,
          documentVersion: binding.consentVersion,
          policyVersion: binding.policyVersion,
          previewPayloadSha256: binding.previewDigestSha256,
          verifiedAt: binding.checkedAt,
        });
        return { status: verified.valid ? "current" : "invalid" };
      },
    },
  };
}

export async function seedD2RecoveryFixtures(client, profileClient, reportStage = () => {}) {
  const store = ports(client, profileClient);
  const ownerUserId = uuidv7();
  const otherOwnerId = uuidv7();
  const reviewerId = uuidv7();
  const appealReviewerId = uuidv7();
  const systemActorId = uuidv7();
  await client`INSERT INTO identity.users (id, account_state) VALUES (${ownerUserId}, 'active')`;

  async function contribution(provider) {
    const descriptor = DEVELOPMENT_CONTRIBUTION_CAPABILITIES[provider];
    const id = uuidv7();
    const externalJobId =
      provider === "greenhouse"
        ? Number.parseInt(id.replaceAll("-", "").slice(-10), 16).toString()
        : uuidv7();
    const sourceUrl =
      provider === "greenhouse"
        ? `https://job-boards.greenhouse.io/synthetic-recovery/jobs/${externalJobId}`
        : `https://${descriptor.domains[0]}/synthetic-recovery/${externalJobId}`;
    const input = {
      schemaVersion: 1,
      contributionId: id,
      client: { surface: "browser_extension", version: "0.2.0" },
      source: {
        provider,
        pageVariant: descriptor.pageVariant,
        sourceUrl,
        externalJobId,
        adapterVersion: "d2-job-page-v1",
      },
      posting: {
        companyName: `Synthetic ${id}`,
        title: "Synthetic recovery engineer",
        description: `Generated provider description ${id}`,
        locations: ["Remote"],
      },
      observation: { observedAt, contentSha256: "0".repeat(64) },
      approval: {
        consentId: uuidv7(),
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "synthetic-recovery-ugc-v1",
        approvedAt: observedAt,
        approvedFields: [],
        previewDigestSha256: "0".repeat(64),
      },
    };
    input.approval.approvedFields = expectedJobContributionApprovedFields(input);
    input.observation.contentSha256 = digest(jobContributionContentDigestInput(input));
    input.approval.previewDigestSha256 = digest(jobContributionPreviewDigestInput(input));
    reportStage(`seed-${provider}-consent`);
    const consent = await store.consents.grant({
      documentVersion: input.approval.consentVersion,
      grantedAt: observedAt,
      idempotencyKey: `synthetic-recovery-grant-${id}`,
      ownerUserId,
      policyVersion: input.approval.policyVersion,
      previewPayloadSha256: input.approval.previewDigestSha256,
      traceId: "synthetic-recovery",
    });
    input.approval.consentId = consent.id;
    const command = { ownerUserId, idempotencyKey: `synthetic-recovery-intake-${id}`, input };
    reportStage(`seed-${provider}-intake`);
    await store.intake.create(command);
    return { id, provider, command, consent };
  }

  async function prepared(provider, appeal = false) {
    const value = await contribution(provider);
    const { id, command } = value;
    const started = new Date();
    reportStage(`seed-${provider}-normalization`);
    await store.processing.recordNormalization({
      contributionId: id,
      proposal: normalizeContributionForProcessing(command.input),
      processingPolicyVersion,
      occurredAt: started,
    });
    // Generated provider evidence is seeded through the persistence port; no real provider
    // fetch or decision authority is claimed by this backup/restore regression.
    const observation = {
      provider,
      provenance: "permitted_api",
      ...command.input.posting,
      sourceUrl: command.input.source.sourceUrl,
      atsTenant: "synthetic-recovery",
      externalJobId: command.input.source.externalJobId,
      adapterVersion: `${provider}-v1`,
      observedAt: started,
    };
    const canonical = canonicalizeObservation(observation);
    reportStage(`seed-${provider}-verification`);
    await store.processing.recordIndependentVerification({
      contributionId: id,
      processingPolicyVersion,
      occurredAt: new Date(),
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: id,
        verificationId: uuidv7(),
        provider,
        pageVariant: command.input.source.pageVariant,
        canonicalSourceUrlSha256: canonical.canonicalUrlHash,
        evidenceDigestSha256: digest(id),
        verifiedContentSha256: canonical.contentHash,
        providerObservation: observation,
        sourcePolicyVersion: "synthetic-recovery-source-v1",
        verifiedAt: started.toISOString(),
      },
    });
    const caseId = uuidv7();
    reportStage(`seed-${provider}-trust`);
    await store.trust.open({
      caseId,
      contributionId: id,
      contributorUserId: ownerUserId,
      systemActorId,
      policy: { version: "synthetic-recovery-trust-v1", appealWindowMilliseconds: 86_400_000 },
      occurredAt: new Date(),
    });
    await store.trust.review(caseId, 1, {
      reviewerId,
      outcome: appeal ? "rejected" : "accepted",
      reasonCode: appeal ? "content_mismatch" : "independently_verified",
      evidenceDigestSha256: digest(`${id}-review`),
      occurredAt: new Date(),
    });
    if (appeal) {
      await store.trust.appeal(caseId, 2, {
        contributorUserId: ownerUserId,
        evidenceDigestSha256: digest(`${id}-appeal`),
        occurredAt: new Date(),
      });
      await store.trust.resolveAppeal(caseId, 3, {
        reviewerId: appealReviewerId,
        outcome: "reversed",
        evidenceDigestSha256: digest(`${id}-reversal`),
        occurredAt: new Date(),
      });
    }
    const decision = await store.signals.readLatestDecision({
      contributionId: id,
      contributorUserId: ownerUserId,
    });
    assert.equal(decision?.status, "accepted");
    reportStage(`seed-${provider}-trust-decision`);
    await store.processing.recordTrustDecision({
      contributionId: id,
      decision,
      processingPolicyVersion,
      occurredAt: new Date(),
    });
    reportStage(`seed-${provider}-publication-lease`);
    const operation = await store.processing.preparePublication(lease(id, provider, new Date()));
    return { ...value, caseId, operation };
  }

  const preparedFixtures = [];
  for (const provider of ["greenhouse", "lever", "ashby"])
    preparedFixtures.push(await prepared(provider, provider === "lever"));
  const captureId = uuidv7();
  const captureCommand = {
    ownerUserId,
    idempotencyKey: `synthetic-recovery-private-${captureId}`,
    input: {
      schemaVersion: 1,
      captureId,
      source: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        sourceUrl: `https://jobs.lever.co/synthetic-recovery/${captureId}`,
        adapterVersion: "d2-job-page-v1",
      },
      snapshot: {
        title: "Synthetic private saved page",
        company: "Synthetic Example",
        location: "Remote",
        description: "Generated private capture, never a real user artifact.",
      },
      capturedAt: observedAt,
    },
  };
  reportStage("seed-private-capture");
  const privateCapture = await store.captures.create(captureCommand, new Date());
  const revoked = await prepared("greenhouse");
  reportStage("seed-revocation");
  await store.consents.revoke({
    consentId: revoked.consent.id,
    ownerUserId,
    idempotencyKey: `synthetic-recovery-revoke-${revoked.id}`,
    occurredAt: new Date().toISOString(),
    traceId: "synthetic-recovery",
  });
  const cancelled = await contribution("greenhouse");
  const cancelCommand = {
    ownerUserId,
    contributionId: cancelled.id,
    idempotencyKey: `synthetic-recovery-cancel-${cancelled.id}`,
    traceId: "synthetic-recovery",
  };
  reportStage("seed-cancellation");
  assert.equal((await store.intake.cancel(cancelCommand, store.revoke))?.state, "consent_invalid");
  return {
    ownerUserId,
    otherOwnerId,
    preparedFixtures,
    privateCapture,
    captureId,
    revoked,
    cancelled,
    cancelCommand,
    cancelRevocationCommand: store.revocationCommands.at(-1),
  };
}

export async function exerciseRestoredD2(client, profileClient, fixtures, reportStage = () => {}) {
  // Seed with real timestamps (including Trust's future-date guard), then advance
  // only the injected Jobs clock beyond every prepared lease without a wall wait.
  const renewedAt = new Date(
    Math.max(
      ...[...fixtures.preparedFixtures, fixtures.revoked].map((fixture) =>
        Date.parse(fixture.operation.capabilityExpiresAt),
      ),
    ) + 1_000,
  );
  reportStage("restored-owner-private-capture");
  const store = ports(client, profileClient);
  assert.deepEqual(
    await store.captures.get(fixtures.ownerUserId, fixtures.captureId),
    fixtures.privateCapture,
  );
  assert.equal(await store.captures.get(fixtures.otherOwnerId, fixtures.captureId), null);
  const catalog = new PostgresJobCatalog(client, {
    acceptedProvenance: new Set(["permitted_api"]),
    searchCursorKeys: { active: { id: "synthetic-recovery", key: Buffer.alloc(32, 9) } },
  });
  const reconciler = new PostgresContributionPublicationReconciler(
    client,
    catalog,
    () => renewedAt,
  );
  let crossOwnerReadsDenied = 1;
  let currentConsentsVerified = 0;
  for (const fixture of fixtures.preparedFixtures) {
    reportStage(`restored-${fixture.provider}-owner-isolation`);
    assert.equal(
      (await store.trust.readOwnerCase(fixtures.ownerUserId, fixture.caseId))?.state,
      "accepted",
    );
    assert.equal(await store.trust.readOwnerCase(fixtures.otherOwnerId, fixture.caseId), null);
    assert.equal(await store.intake.get(fixtures.otherOwnerId, fixture.id), null);
    crossOwnerReadsDenied += 2;
    reportStage(`restored-${fixture.provider}-immutable-lease`);
    await assert.rejects(
      client`UPDATE jobs.job_contribution_reconciliations SET capability_evaluated_at=${renewedAt}, capability_expires_at=${new Date(renewedAt.getTime() + 60_000)}, updated_at=${renewedAt} WHERE id=${fixture.operation.reconciliationId}`,
      { code: "55000" },
    );
    await assert.rejects(
      client.begin(async (transaction) => {
        await transaction`SELECT set_config('ai_job_apply.development_contribution_lease', 'renew', true)`;
        await transaction`UPDATE jobs.job_contribution_reconciliations SET independent_verification_id=${uuidv7()}, capability_evaluated_at=${renewedAt}, capability_expires_at=${new Date(renewedAt.getTime() + 60_000)}, updated_at=${renewedAt} WHERE id=${fixture.operation.reconciliationId}`;
      }),
      { code: "55000" },
    );
    reportStage(`restored-${fixture.provider}-concurrent-renewal`);
    const [left, right] = await Promise.all([
      store.processing.preparePublication(lease(fixture.id, fixture.provider, renewedAt)),
      store.processing.preparePublication(lease(fixture.id, fixture.provider, renewedAt)),
    ]);
    assert.deepEqual(left, right);
    assert.equal(left.reconciliationId, fixture.operation.reconciliationId);
    await assert.rejects(reconciler.publish(fixture.operation), /not authorized/u);
    reportStage(`restored-${fixture.provider}-current-consent`);
    assert.equal(
      (
        await store.consents.verify({
          consentId: fixture.consent.id,
          ownerUserId: fixtures.ownerUserId,
          documentVersion: fixture.command.input.approval.consentVersion,
          policyVersion: fixture.command.input.approval.policyVersion,
          previewPayloadSha256: fixture.command.input.approval.previewDigestSha256,
          verifiedAt: renewedAt.toISOString(),
        })
      ).valid,
      true,
    );
    currentConsentsVerified += 1;
    reportStage(`restored-${fixture.provider}-publication-replay`);
    const published = await reconciler.publish(left);
    assert.equal(published.status, "published");
    assert.deepEqual(await reconciler.publish(right), published);
    const completed = await store.processing.completePublication({
      command: left,
      result: published,
      occurredAt: renewedAt,
    });
    assert.equal(completed.ownerState, "published");
    assert.equal((await store.intake.get(fixtures.ownerUserId, fixture.id))?.state, "published");
    await assert.rejects(
      store.processing.preparePublication(
        lease(fixture.id, fixture.provider, new Date(renewedAt.getTime() + 61_000)),
      ),
      /immutable/u,
    );
  }
  const capability = new DevelopmentContributionCapabilitySource({
    D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
    D2_DEPLOYMENT_ENVIRONMENT: "development",
    D2_COMMUNITY_RUNTIME_ENABLED: "true",
    D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse","lever","ashby"]',
  });
  let forbiddenPublications = 0;
  const service = new ContributionProcessingService({
    store: store.processing,
    capability,
    consent: store.currentConsent,
    policy: { version: processingPolicyVersion },
    now: () => renewedAt,
    reconciler: {
      async publish() {
        forbiddenPublications += 1;
        throw new Error("Revoked work must not publish");
      },
      async remove() {
        throw new Error("Unexpected removal");
      },
    },
  });
  reportStage("restored-revoked-consent-refusal");
  assert.equal(await service.process(fixtures.revoked.id), "consent_invalid");
  reportStage("restored-cancelled-contribution-refusal");
  assert.equal(await service.process(fixtures.cancelled.id), "consent_invalid");
  assert.equal(forbiddenPublications, 0);
  reportStage("restored-cancellation-idempotency");
  // Replay the exact original Profile command and its restored receipt. The
  // runtime intentionally hashes semantic fields, not retry timestamps.
  assert.equal((await store.consents.revoke(fixtures.cancelRevocationCommand)).state, "revoked");
  return {
    providerLeasesRenewed: 3,
    publicationsReplayed: 3,
    immutableMutationsRejected: 6,
    staleLeasesRejected: 3,
    revokedOrCancelledRefusals: 2,
    crossOwnerReadsDenied,
    currentConsentsVerified,
    ownerPublishedStatesVerified: fixtures.preparedFixtures.length,
    revocationsReplayed: 1,
  };
}
