import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DevelopmentContributionCapabilitySource } from "./contribution-capability-source.js";
import { describe, expect, it, vi } from "vitest";
import type { JobContributionInput } from "./contribution.js";
import {
  contributionCapabilityPolicyDigestInput,
  type D2ContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  ContributionProcessingDependencyUnavailableError,
  ContributionProcessingService,
  type ContributionProcessingStore,
  type IndependentProviderVerificationResult,
  type LoadedContributionProcessing,
  type PreparedPublicationReconciliation,
  type PreparedTerminalReconciliation,
  type TrustContributionDecision,
} from "./contribution-processing.js";
import { normalizeContributionForProcessing } from "./contribution-processing-policy.js";
import { canonicalizeObservation } from "./domain/canonical-job.js";

const ids = {
  contribution: "018f47a6-7b2c-7ee1-8c09-3ea174e80e20",
  owner: "018f47a6-7b2c-7ee1-8c09-3ea174e80e21",
  consent: "018f47a6-7b2c-7ee1-8c09-3ea174e80e22",
  normalization: "018f47a6-7b2c-7ee1-8c09-3ea174e80e23",
  verification: "018f47a6-7b2c-7ee1-8c09-3ea174e80e24",
  decision: "018f47a6-7b2c-7ee1-8c09-3ea174e80e25",
  reconciliation: "018f47a6-7b2c-7ee1-8c09-3ea174e80e26",
  removal: "018f47a6-7b2c-7ee1-8c09-3ea174e80e27",
  job: "018f47a6-7b2c-7ee1-8c09-3ea174e80e28",
  source: "018f47a6-7b2c-7ee1-8c09-3ea174e80e29",
} as const;
const now = new Date("2026-09-01T13:00:00.000Z");

function signedCapabilityPolicy() {
  const policy: D2ContributionCapabilityPolicy = {
    schemaVersion: 1,
    revision: "d2-synthetic-capability-v1",
    issuedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-09-02T12:00:00.000Z",
    intakeEnabled: true,
    processingEnabled: true,
    clients: { "0.2.0": true },
    providers: { ashby: false, greenhouse: true, lever: false },
    variants: {
      "ashby-job-board-v1": false,
      "greenhouse-board-v1": true,
      "lever-posting-v1": false,
    },
    domains: {
      "boards.greenhouse.io": false,
      "job-boards.greenhouse.io": true,
      "jobs.ashbyhq.com": false,
      "jobs.eu.lever.co": false,
      "jobs.lever.co": false,
    },
  };
  const keys = generateKeyPairSync("ed25519");
  const digestInput = contributionCapabilityPolicyDigestInput(policy);
  return {
    load: vi.fn(async () => ({
      envelope: {
        keyId: "synthetic-key-v1",
        payload: policy,
        signature: sign(null, Buffer.from(digestInput), keys.privateKey).toString("base64url"),
      },
      publicKeys: {
        "synthetic-key-v1": keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
    })),
    digest: createHash("sha256").update(digestInput).digest("hex"),
  };
}

function contributionInput(): JobContributionInput {
  return {
    schemaVersion: 1,
    contributionId: ids.contribution,
    client: { surface: "browser_extension", version: "0.2.0" },
    source: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      externalJobId: "123",
      adapterVersion: "d2-job-page-v1",
    },
    posting: {
      companyName: "Synthetic Company",
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "Generated synthetic posting for processing tests.",
    },
    observation: {
      observedAt: "2026-09-01T12:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
    approval: {
      consentId: ids.consent,
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: "synthetic-ugc-policy-v1",
      approvedAt: "2026-09-01T12:01:00.000Z",
      approvedFields: [],
      previewDigestSha256: "b".repeat(64),
    },
  };
}

class MemoryProcessingStore implements ContributionProcessingStore {
  value: LoadedContributionProcessing;
  readonly transitions: Array<{ state: string; reasonCode: string }> = [];
  readonly outbox: Array<{ eventType: string; data: Record<string, string> }> = [];
  readonly preparedPublications: PreparedPublicationReconciliation[] = [];
  readonly preparedRemovals: PreparedTerminalReconciliation[] = [];

  constructor(value?: Partial<LoadedContributionProcessing>) {
    this.value = {
      contributionId: ids.contribution,
      ownerUserId: ids.owner,
      input: contributionInput(),
      clientSurface: "browser_extension",
      clientVersion: "0.2.0",
      ownerState: "queued",
      ...value,
    };
  }

  async load(contributionId: string) {
    return contributionId === this.value.contributionId ? this.value : null;
  }

  async recordOwnerState(input: Parameters<ContributionProcessingStore["recordOwnerState"]>[0]) {
    this.transitions.push({ state: input.state, reasonCode: input.reasonCode });
    this.value = { ...this.value, ownerState: input.state };
    return this.value;
  }

  async recordNormalization(
    input: Parameters<ContributionProcessingStore["recordNormalization"]>[0],
  ) {
    this.transitions.push({ state: "normalized", reasonCode: "normalization_complete" });
    this.value = {
      ...this.value,
      ownerState: "normalized",
      normalization: { id: ids.normalization, proposal: input.proposal },
    };
    this.outbox.push({
      eventType: "job.normalized.v1",
      data: { contributionId: ids.contribution, normalizationId: ids.normalization },
    });
    return this.value;
  }

  async recordIndependentVerification(
    input: Parameters<ContributionProcessingStore["recordIndependentVerification"]>[0],
  ) {
    this.transitions.push({
      state: "independently_verified",
      reasonCode: "independent_verification_complete",
    });
    this.value = {
      ...this.value,
      ownerState: "independently_verified",
      independentVerification: input.evidence,
    };
    return this.value;
  }

  async recordTrustDecision(
    input: Parameters<ContributionProcessingStore["recordTrustDecision"]>[0],
  ) {
    const state =
      input.decision.status === "accepted"
        ? ("ready_for_publication" as const)
        : input.decision.status === "rejected"
          ? ("rejected" as const)
          : input.decision.status;
    this.transitions.push({
      state,
      reasonCode:
        input.decision.status === "accepted"
          ? "publication_gates_complete"
          : input.decision.status === "rejected"
            ? "trust_policy_rejected"
            : input.decision.status === "withdrawn"
              ? "trust_withdrawal"
              : "trust_takedown",
    });
    this.value = { ...this.value, ownerState: state, trustDecision: input.decision };
    return this.value;
  }

  async preparePublication(
    input: Parameters<ContributionProcessingStore["preparePublication"]>[0],
  ) {
    const command = {
      reconciliationId: ids.reconciliation,
      contributionId: ids.contribution,
      normalizationId: ids.normalization,
      independentVerificationId: ids.verification,
      trustDecisionId: ids.decision,
      processingPolicyVersion: "synthetic-processing-v1",
      capabilityPolicyVersion: input.capabilityPolicyVersion,
      capabilityConfigurationDigestSha256: input.capabilityConfigurationDigestSha256,
      capabilityEvaluatedAt: input.capabilityEvaluatedAt,
      capabilityExpiresAt: input.capabilityExpiresAt,
    };
    this.preparedPublications.push(command);
    return command;
  }

  async completePublication(
    input: Parameters<ContributionProcessingStore["completePublication"]>[0],
  ) {
    this.value = {
      ...this.value,
      ownerState: "published",
      publication: { reconciliationId: input.command.reconciliationId, ...input.result },
    };
    this.transitions.push({ state: "published", reasonCode: "publication_complete" });
    this.outbox.push({
      eventType: "job.verified.v1",
      data: {
        jobId: input.result.jobId,
        sourceId: input.result.sourceId,
        verificationId: input.result.verificationId,
      },
    });
    return this.value;
  }

  async prepareTerminalReconciliation(
    input: Parameters<ContributionProcessingStore["prepareTerminalReconciliation"]>[0],
  ) {
    if (this.value.ownerState === "removed") return null;
    const command = {
      reconciliationId: ids.removal,
      contributionId: ids.contribution,
      jobId: ids.job,
      sourceId: ids.source,
      reason: input.reason,
      trustDecisionId: ids.decision,
      processingPolicyVersion: "synthetic-processing-v1",
    };
    this.preparedRemovals.push(command);
    return command;
  }

  async completeTerminalReconciliation() {
    this.value = { ...this.value, ownerState: "removed" };
    this.transitions.push({ state: "removed", reasonCode: "terminal_reconciliation_complete" });
    return this.value;
  }
}

function verified(): IndependentProviderVerificationResult {
  const providerObservation = {
    provider: "greenhouse" as const,
    provenance: "permitted_api" as const,
    companyName: "Synthetic Company",
    title: "Software Engineer",
    locations: ["Remote - US"],
    description: "Generated synthetic posting for processing tests.",
    sourceUrl: contributionInput().source.sourceUrl,
    atsTenant: "synthetic",
    externalJobId: "123",
    adapterVersion: "greenhouse-v1",
    observedAt: new Date("2026-09-01T12:55:00.000Z"),
  };
  return {
    status: "verified",
    origin: "independent_provider_fetch",
    contributionId: ids.contribution,
    verificationId: ids.verification,
    jobId: ids.job,
    sourceId: ids.source,
    provider: "greenhouse",
    pageVariant: "greenhouse-board-v1",
    canonicalSourceUrlSha256: "df803d20a7f8140243fc1653d1a987844a25d939d7f97b64fa7699a4e2f2a6b5",
    evidenceDigestSha256: "c".repeat(64),
    providerObservation,
    verifiedContentSha256: canonicalizeObservation(providerObservation).contentHash,
    sourcePolicyVersion: "synthetic-source-policy-v1",
    verifiedAt: "2026-09-01T12:55:00.000Z",
  };
}

function accepted(): TrustContributionDecision {
  return {
    status: "accepted",
    contributionId: ids.contribution,
    decisionId: ids.decision,
    policyVersion: "synthetic-trust-v1",
    decidedAt: "2026-09-01T12:56:00.000Z",
  };
}

function service(
  store: MemoryProcessingStore,
  overrides: Partial<ConstructorParameters<typeof ContributionProcessingService>[0]> = {},
) {
  const capability = signedCapabilityPolicy();
  return new ContributionProcessingService({
    store,
    policy: { version: "synthetic-processing-v1" },
    consent: { verifyCurrent: vi.fn(async () => ({ status: "current" as const })) },
    independentVerifier: { verify: vi.fn(async () => verified()) },
    trust: { evaluate: vi.fn(async () => accepted()) },
    capability,
    reconciler: {
      publish: vi.fn(async () => ({
        jobId: ids.job,
        sourceId: ids.source,
        verificationId: ids.verification,
      })),
      remove: vi.fn(async () => undefined),
    },
    now: () => now,
    ...overrides,
  });
}

describe("ContributionProcessingService", () => {
  it("uses a development operation lease without bypassing independent verification or Trust", async () => {
    const values = {
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_COMMUNITY_RUNTIME_ENABLED: "true",
    };
    const capability = new DevelopmentContributionCapabilitySource(values);
    const store = new MemoryProcessingStore();
    const verifier = { verify: vi.fn(async () => verified()) };
    const trust = { evaluate: vi.fn(async () => ({ status: "needs_review" as const })) };
    const publish = vi.fn();
    await expect(
      service(store, {
        capability,
        independentVerifier: verifier,
        trust,
        reconciler: { publish, remove: vi.fn() },
      }).process(ids.contribution),
    ).resolves.toBe("awaiting_trust");
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(trust.evaluate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    values.D2_COMMUNITY_RUNTIME_ENABLED = "false";
    await expect(
      service(store, { capability, reconciler: { publish, remove: vi.fn() } }).process(
        ids.contribution,
      ),
    ).resolves.toBe("capability_disabled");
    expect(publish).not.toHaveBeenCalled();
  });
  it("requires an explicit policy and defaults every external authority unavailable", async () => {
    expect(() => new ContributionProcessingService()).toThrow("explicit");
    const store = new MemoryProcessingStore();
    const value = new ContributionProcessingService({
      store,
      policy: { version: "synthetic-processing-v1" },
      now: () => now,
    });
    await expect(value.process(ids.contribution)).resolves.toBe("awaiting_capability_dependency");
    expect(store.transitions).toEqual([]);
  });

  it("persists both gates before invoking the Jobs-owned publication reconciler", async () => {
    const store = new MemoryProcessingStore();
    const consent = { verifyCurrent: vi.fn(async () => ({ status: "current" as const })) };
    const verifier = { verify: vi.fn(async () => verified()) };
    const trust = { evaluate: vi.fn(async () => accepted()) };
    const reconciler = {
      publish: vi.fn(async () => ({
        jobId: ids.job,
        sourceId: ids.source,
        verificationId: ids.verification,
      })),
      remove: vi.fn(async () => undefined),
    };

    const capability = signedCapabilityPolicy();
    await expect(
      service(store, { consent, independentVerifier: verifier, trust, reconciler }).process(
        ids.contribution,
      ),
    ).resolves.toBe("published");

    expect(consent.verifyCurrent).toHaveBeenCalledTimes(2);
    expect(consent.verifyCurrent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clientSurface: "browser_extension",
        clientVersion: "0.2.0",
      }),
    );
    expect(store.transitions.map(({ state }) => state)).toEqual([
      "normalized",
      "independently_verified",
      "ready_for_publication",
      "published",
    ]);
    expect(reconciler.publish).toHaveBeenCalledOnce();
    expect(reconciler.publish).toHaveBeenCalledWith({
      reconciliationId: ids.reconciliation,
      contributionId: ids.contribution,
      normalizationId: ids.normalization,
      independentVerificationId: ids.verification,
      trustDecisionId: ids.decision,
      processingPolicyVersion: "synthetic-processing-v1",
      capabilityPolicyVersion: "d2-synthetic-capability-v1",
      capabilityConfigurationDigestSha256: capability.digest,
      capabilityEvaluatedAt: "2026-09-01T13:00:00.000Z",
      capabilityExpiresAt: "2026-09-02T12:00:00.000Z",
    });
    expect(store.outbox).toEqual([
      {
        eventType: "job.normalized.v1",
        data: { contributionId: ids.contribution, normalizationId: ids.normalization },
      },
      {
        eventType: "job.verified.v1",
        data: { jobId: ids.job, sourceId: ids.source, verificationId: ids.verification },
      },
    ]);
    expect(JSON.stringify(store.outbox)).not.toContain("greenhouse.io");
    expect(JSON.stringify(store.outbox)).not.toContain("Synthetic Company");
  });

  it("never publishes unavailable, mismatched, or community-supplied verification", async () => {
    for (const status of ["unavailable", "mismatch", "closed"] as const) {
      const store = new MemoryProcessingStore();
      const reconciler = {
        publish: vi.fn(async () => ({
          jobId: ids.job,
          sourceId: ids.source,
          verificationId: ids.verification,
        })),
        remove: vi.fn(async () => undefined),
      };
      await expect(
        service(store, {
          independentVerifier: {
            verify: vi.fn(async () => ({
              status,
              contributionId: ids.contribution,
              provider: "greenhouse" as const,
              pageVariant: "greenhouse-board-v1" as const,
              canonicalSourceUrlSha256:
                "df803d20a7f8140243fc1653d1a987844a25d939d7f97b64fa7699a4e2f2a6b5",
            })),
          },
          reconciler,
        }).process(ids.contribution),
      ).resolves.toBe("awaiting_independent_verification");
      expect(reconciler.publish).not.toHaveBeenCalled();
    }

    const store = new MemoryProcessingStore();
    await expect(
      service(store, {
        independentVerifier: {
          verify: vi.fn(
            async () =>
              ({
                ...verified(),
                origin: "community_observation",
              }) as unknown as Promise<IndependentProviderVerificationResult>,
          ),
        },
      }).process(ids.contribution),
    ).rejects.toBeInstanceOf(ContributionProcessingDependencyUnavailableError);
  });

  it("keeps Trust needs-review and rejection out of catalog reconciliation", async () => {
    for (const decision of [
      { status: "needs_review" as const },
      {
        status: "rejected" as const,
        contributionId: ids.contribution,
        decisionId: ids.decision,
        policyVersion: "synthetic-trust-v1",
        decidedAt: "2026-09-01T12:56:00.000Z",
      },
    ]) {
      const store = new MemoryProcessingStore();
      const reconciler = {
        publish: vi.fn(async () => ({
          jobId: ids.job,
          sourceId: ids.source,
          verificationId: ids.verification,
        })),
        remove: vi.fn(async () => undefined),
      };
      const outcome = await service(store, {
        trust: { evaluate: vi.fn(async () => decision) },
        reconciler,
      }).process(ids.contribution);
      expect(outcome).toBe(decision.status === "needs_review" ? "awaiting_trust" : "rejected");
      expect(reconciler.publish).not.toHaveBeenCalled();
    }
  });

  it("reuses an accepted Trust decision copied from the authoritative signal", async () => {
    const normalization = normalizeContributionForProcessing(contributionInput());
    const store = new MemoryProcessingStore({
      ownerState: "ready_for_publication",
      normalization: { id: ids.normalization, proposal: normalization },
      independentVerification: verified() as Extract<
        IndependentProviderVerificationResult,
        { status: "verified" }
      >,
      trustDecision: accepted() as Extract<TrustContributionDecision, { status: "accepted" }>,
    });
    const trust = { evaluate: vi.fn(async () => ({ status: "unavailable" as const })) };

    await expect(service(store, { trust }).process(ids.contribution)).resolves.toBe("published");
    expect(trust.evaluate).not.toHaveBeenCalled();
  });

  it("rechecks consent after slow gates and stops a revoked grant before publication", async () => {
    const store = new MemoryProcessingStore();
    const consent = {
      verifyCurrent: vi
        .fn()
        .mockResolvedValueOnce({ status: "current" as const })
        .mockResolvedValueOnce({ status: "invalid" as const }),
    };
    const reconciler = {
      publish: vi.fn(async () => ({
        jobId: ids.job,
        sourceId: ids.source,
        verificationId: ids.verification,
      })),
      remove: vi.fn(async () => undefined),
    };
    await expect(service(store, { consent, reconciler }).process(ids.contribution)).resolves.toBe(
      "consent_invalid",
    );
    expect(reconciler.publish).not.toHaveBeenCalled();
    expect(store.transitions.at(-1)).toEqual({
      state: "consent_invalid",
      reasonCode: "consent_not_current",
    });
  });

  it("reuses a prepared reconciliation identity after an ambiguous publish", async () => {
    const store = new MemoryProcessingStore();
    let attempts = 0;
    const reconciler = {
      publish: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("synthetic timeout after commit");
        return { jobId: ids.job, sourceId: ids.source, verificationId: ids.verification };
      }),
      remove: vi.fn(async () => undefined),
    };
    const value = service(store, { reconciler });
    await expect(value.process(ids.contribution)).rejects.toBeInstanceOf(
      ContributionProcessingDependencyUnavailableError,
    );
    await expect(value.process(ids.contribution)).resolves.toBe("published");
    expect(store.preparedPublications).toHaveLength(2);
    expect(store.preparedPublications[1]).toEqual(store.preparedPublications[0]);
    expect(reconciler.publish).toHaveBeenCalledTimes(2);
  });

  it("parks a probable duplicate without completing catalog publication", async () => {
    const store = new MemoryProcessingStore();
    const reconciler = {
      publish: vi.fn(async () => ({
        status: "probable_duplicate" as const,
        probableDuplicateJobIds: [ids.job],
      })),
      remove: vi.fn(async () => undefined),
    };

    await expect(service(store, { reconciler }).process(ids.contribution)).resolves.toBe(
      "awaiting_independent_verification",
    );
    expect(store.value.ownerState).toBe("awaiting_independent_verification");
    expect(store.transitions.at(-1)).toEqual({
      state: "awaiting_independent_verification",
      reasonCode: "provider_probable_duplicate",
    });
    expect(store.outbox.some(({ eventType }) => eventType === "job.verified.v1")).toBe(false);
  });

  it("removes an already-published association after withdrawal and replays terminally", async () => {
    const withdrawn = {
      status: "withdrawn" as const,
      contributionId: ids.contribution,
      decisionId: ids.decision,
      policyVersion: "synthetic-trust-v1",
      decidedAt: "2026-09-01T12:59:00.000Z",
    };
    const store = new MemoryProcessingStore({
      ownerState: "withdrawn",
      trustDecision: withdrawn,
      publication: {
        reconciliationId: ids.reconciliation,
        jobId: ids.job,
        sourceId: ids.source,
        verificationId: ids.verification,
      },
    });
    const reconciler = {
      publish: vi.fn(async () => ({
        jobId: ids.job,
        sourceId: ids.source,
        verificationId: ids.verification,
      })),
      remove: vi.fn(async () => undefined),
    };
    const value = service(store, { reconciler });
    await expect(value.process(ids.contribution)).resolves.toBe("removed");
    await expect(value.process(ids.contribution)).resolves.toBe("removed");
    expect(reconciler.remove).toHaveBeenCalledOnce();
    expect(reconciler.remove).toHaveBeenCalledWith({
      reconciliationId: ids.removal,
      contributionId: ids.contribution,
      jobId: ids.job,
      sourceId: ids.source,
      reason: "withdrawn",
      trustDecisionId: ids.decision,
      processingPolicyVersion: "synthetic-processing-v1",
    });
  });
});
