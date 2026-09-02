import { createHash } from "node:crypto";
import type { JobContributionInput, JobContributionState } from "./contribution.js";
import {
  contributionCapabilityPolicyDigestInput,
  evaluateContributionCapability,
  type SignedD2ContributionCapabilityPolicy,
  verifySignedContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  type ContributionProviderProvenance,
  type NormalizedContributionProposal,
  normalizeContributionForProcessing,
} from "./contribution-processing-policy.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

function createProcessingDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type ContributionOwnerState = JobContributionState;

export type ContributionOwnerReasonCode =
  | "normalization_complete"
  | "consent_not_current"
  | "provider_temporarily_unavailable"
  | "provider_observation_mismatch"
  | "provider_posting_closed"
  | "independent_verification_complete"
  | "trust_review_required"
  | "trust_policy_rejected"
  | "trust_withdrawal"
  | "trust_takedown"
  | "publication_gates_complete"
  | "publication_complete"
  | "terminal_reconciliation_complete";

export interface ContributionProcessingPolicy {
  version: string;
}

export interface AuthorizedContributionCapability {
  status: "authorized";
  policyVersion: string;
  configurationDigestSha256: string;
  evaluatedAt: string;
  expiresAt: string;
}

export interface SignedContributionCapabilityPolicyPort {
  load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null>;
}

export interface ContributionConsentBinding {
  ownerUserId: string;
  consentId: string;
  purpose: "ugc_contribution";
  clientSurface: "browser_extension";
  clientVersion: string;
  contributionId: string;
  consentVersion: "ugc-contribution-preview.v1";
  policyVersion: string;
  previewDigestSha256: string;
  approvedAt: string;
  checkedAt: string;
}

export interface CurrentContributionConsentPort {
  verifyCurrent(
    binding: Readonly<ContributionConsentBinding>,
  ): Promise<{ status: "current" | "invalid" | "unavailable" }>;
}

export interface IndependentVerificationEvidence {
  status: "verified";
  origin: "independent_provider_fetch";
  contributionId: string;
  verificationId: string;
  jobId: string;
  sourceId: string;
  provider: ContributionProviderProvenance["provider"];
  pageVariant: ContributionProviderProvenance["pageVariant"];
  canonicalSourceUrlSha256: string;
  evidenceDigestSha256: string;
  verifiedContentSha256: string;
  sourcePolicyVersion: string;
  verifiedAt: string;
}

export type IndependentProviderVerificationResult =
  | IndependentVerificationEvidence
  | {
      status: "unavailable" | "mismatch" | "closed";
      contributionId: string;
      provider: ContributionProviderProvenance["provider"];
      pageVariant: ContributionProviderProvenance["pageVariant"];
      canonicalSourceUrlSha256: string;
    };

export interface IndependentProviderVerificationPort {
  verify(input: {
    contributionId: string;
    normalizationId: string;
    proposal: NormalizedContributionProposal;
  }): Promise<IndependentProviderVerificationResult>;
}

export type TrustContributionDecision =
  | { status: "unavailable" }
  | { status: "needs_review" }
  | {
      status: "accepted" | "rejected" | "withdrawn" | "taken_down";
      contributionId: string;
      decisionId: string;
      policyVersion: string;
      decidedAt: string;
    };

export interface ContributionTrustDecisionPort {
  evaluate(input: {
    contributionId: string;
    contributorUserId: string;
    normalizationId: string;
    independentVerificationId: string;
    independentEvidenceDigestSha256: string;
  }): Promise<TrustContributionDecision>;
}

export interface PersistedNormalization {
  id: string;
  proposal: NormalizedContributionProposal;
}

export interface PersistedPublication {
  reconciliationId: string;
  jobId: string;
  sourceId: string;
  verificationId: string;
}

export interface LoadedContributionProcessing {
  contributionId: string;
  ownerUserId: string;
  input: JobContributionInput;
  /** Exact independently persisted client binding; absent historical intake remains unprocessable. */
  clientSurface?: "browser_extension";
  clientVersion?: string;
  ownerState: ContributionOwnerState;
  normalization?: PersistedNormalization;
  independentVerification?: IndependentVerificationEvidence;
  trustDecision?: Exclude<TrustContributionDecision, { status: "unavailable" | "needs_review" }>;
  publication?: PersistedPublication;
}

export interface PreparedPublicationReconciliation {
  reconciliationId: string;
  contributionId: string;
  normalizationId: string;
  independentVerificationId: string;
  jobId: string;
  sourceId: string;
  trustDecisionId: string;
  processingPolicyVersion: string;
  capabilityPolicyVersion: string;
  capabilityConfigurationDigestSha256: string;
  capabilityEvaluatedAt: string;
  capabilityExpiresAt: string;
}

export interface PreparedTerminalReconciliation {
  reconciliationId: string;
  contributionId: string;
  jobId: string;
  sourceId: string;
  reason: "withdrawn" | "taken_down";
  trustDecisionId: string;
  processingPolicyVersion: string;
}

export interface ContributionPublicationReconciler {
  publish(
    command: Readonly<PreparedPublicationReconciliation>,
  ): Promise<{ jobId: string; sourceId: string; verificationId: string }>;
  remove(command: Readonly<PreparedTerminalReconciliation>): Promise<void>;
}

export interface ContributionProcessingStore {
  load(contributionId: string): Promise<LoadedContributionProcessing | null>;
  recordOwnerState(input: {
    contributionId: string;
    state: ContributionOwnerState;
    reasonCode: ContributionOwnerReasonCode;
    processingPolicyVersion: string;
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
  recordNormalization(input: {
    contributionId: string;
    proposal: NormalizedContributionProposal;
    processingPolicyVersion: string;
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
  recordIndependentVerification(input: {
    contributionId: string;
    evidence: IndependentVerificationEvidence;
    processingPolicyVersion: string;
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
  recordTrustDecision(input: {
    contributionId: string;
    decision: Exclude<TrustContributionDecision, { status: "unavailable" | "needs_review" }>;
    processingPolicyVersion: string;
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
  preparePublication(input: {
    contributionId: string;
    processingPolicyVersion: string;
    capabilityPolicyVersion: string;
    capabilityConfigurationDigestSha256: string;
    capabilityEvaluatedAt: string;
    capabilityExpiresAt: string;
    occurredAt: Date;
  }): Promise<PreparedPublicationReconciliation>;
  completePublication(input: {
    command: PreparedPublicationReconciliation;
    result: { jobId: string; sourceId: string; verificationId: string };
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
  prepareTerminalReconciliation(input: {
    contributionId: string;
    reason: "withdrawn" | "taken_down";
    processingPolicyVersion: string;
    occurredAt: Date;
  }): Promise<PreparedTerminalReconciliation | null>;
  completeTerminalReconciliation(input: {
    command: PreparedTerminalReconciliation;
    occurredAt: Date;
  }): Promise<LoadedContributionProcessing>;
}

export type ContributionProcessingOutcome =
  | "not_found"
  | "awaiting_consent_dependency"
  | "capability_disabled"
  | "awaiting_capability_dependency"
  | "consent_invalid"
  | "awaiting_independent_verification"
  | "awaiting_trust"
  | "rejected"
  | "published"
  | "withdrawn"
  | "taken_down"
  | "removed";

const unavailableConsent: CurrentContributionConsentPort = {
  verifyCurrent: async () => ({ status: "unavailable" }),
};
const unavailableVerifier: IndependentProviderVerificationPort = {
  verify: async (input) => ({
    status: "unavailable",
    contributionId: input.contributionId,
    provider: input.proposal.provenance.provider,
    pageVariant: input.proposal.provenance.pageVariant,
    canonicalSourceUrlSha256: input.proposal.provenance.canonicalSourceUrlSha256,
  }),
};
const unavailableTrust: ContributionTrustDecisionPort = {
  evaluate: async () => ({ status: "unavailable" }),
};
const unavailableCapability: SignedContributionCapabilityPolicyPort = {
  load: async () => null,
};
const unavailableStore: ContributionProcessingStore = new Proxy({} as ContributionProcessingStore, {
  get() {
    return async () => {
      throw new Error("unavailable");
    };
  },
});
const unavailableReconciler: ContributionPublicationReconciler = {
  publish: async () => {
    throw new Error("unavailable");
  },
  remove: async () => {
    throw new Error("unavailable");
  },
};

export class ContributionProcessingDependencyUnavailableError extends Error {
  constructor() {
    super("A required contribution-processing dependency is unavailable");
    this.name = "ContributionProcessingDependencyUnavailableError";
  }
}

function exactInstant(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
  return value;
}

function exactDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
  return new Date(value.getTime());
}

function uuid(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new ContributionProcessingDependencyUnavailableError();
  return value;
}

function dependencyDigest(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
  return value;
}

async function dependency<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ContributionProcessingDependencyUnavailableError) throw error;
    throw new ContributionProcessingDependencyUnavailableError();
  }
}

function assertLoaded(value: LoadedContributionProcessing, contributionId: string): void {
  if (
    value.contributionId !== contributionId ||
    value.input.contributionId !== contributionId ||
    value.clientSurface !== value.input.client.surface ||
    value.clientVersion !== value.input.client.version ||
    !UUID_V7_PATTERN.test(value.ownerUserId)
  ) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
}

function assertVerification(
  result: IndependentProviderVerificationResult,
  contribution: LoadedContributionProcessing,
): void {
  const provenance = contribution.normalization?.proposal.provenance;
  if (
    !provenance ||
    result.contributionId !== contribution.contributionId ||
    result.provider !== provenance.provider ||
    result.pageVariant !== provenance.pageVariant ||
    result.canonicalSourceUrlSha256 !== provenance.canonicalSourceUrlSha256
  ) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
  if (result.status === "verified") {
    if (
      result.origin !== "independent_provider_fetch" ||
      !UUID_V7_PATTERN.test(result.verificationId) ||
      !UUID_V7_PATTERN.test(result.jobId) ||
      !UUID_V7_PATTERN.test(result.sourceId) ||
      !SHA256_PATTERN.test(result.evidenceDigestSha256) ||
      !SHA256_PATTERN.test(result.verifiedContentSha256) ||
      !POLICY_VERSION_PATTERN.test(result.sourcePolicyVersion)
    ) {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    exactInstant(result.verifiedAt);
  }
}

function assertTrust(result: TrustContributionDecision, contributionId: string): void {
  if (result.status === "unavailable" || result.status === "needs_review") return;
  if (
    result.contributionId !== contributionId ||
    !UUID_V7_PATTERN.test(result.decisionId) ||
    !POLICY_VERSION_PATTERN.test(result.policyVersion)
  ) {
    throw new ContributionProcessingDependencyUnavailableError();
  }
  exactInstant(result.decidedAt);
}

export interface ContributionProcessingDependencies {
  store?: ContributionProcessingStore;
  consent?: CurrentContributionConsentPort;
  independentVerifier?: IndependentProviderVerificationPort;
  trust?: ContributionTrustDecisionPort;
  capability?: SignedContributionCapabilityPolicyPort;
  reconciler?: ContributionPublicationReconciler;
  policy?: ContributionProcessingPolicy;
  now?: () => Date;
}

/** Durable, replay-safe application seam. Every port is unavailable/default-deny unless injected. */
export class ContributionProcessingService {
  private readonly store: ContributionProcessingStore;
  private readonly consent: CurrentContributionConsentPort;
  private readonly independentVerifier: IndependentProviderVerificationPort;
  private readonly trust: ContributionTrustDecisionPort;
  private readonly capability: SignedContributionCapabilityPolicyPort;
  private readonly reconciler: ContributionPublicationReconciler;
  private readonly policy: ContributionProcessingPolicy;
  private readonly now: () => Date;

  constructor(dependencies: ContributionProcessingDependencies = {}) {
    this.store = dependencies.store ?? unavailableStore;
    this.consent = dependencies.consent ?? unavailableConsent;
    this.independentVerifier = dependencies.independentVerifier ?? unavailableVerifier;
    this.trust = dependencies.trust ?? unavailableTrust;
    this.capability = dependencies.capability ?? unavailableCapability;
    this.reconciler = dependencies.reconciler ?? unavailableReconciler;
    if (!dependencies.policy || !POLICY_VERSION_PATTERN.test(dependencies.policy.version)) {
      throw new TypeError("An explicit contribution-processing policy version is required");
    }
    this.policy = Object.freeze({ version: dependencies.policy.version });
    this.now = dependencies.now ?? (() => new Date());
  }

  async process(contributionId: string): Promise<ContributionProcessingOutcome> {
    if (!UUID_V7_PATTERN.test(contributionId)) {
      throw new TypeError("The contribution identifier is invalid");
    }
    let contribution = await dependency(() => this.store.load(contributionId));
    if (!contribution) return "not_found";
    assertLoaded(contribution, contributionId);

    const terminal = await this.reconcileTerminal(contribution);
    if (terminal) return terminal;
    if (contribution.publication || contribution.ownerState === "published") return "published";

    let capability = await this.authorizeCapability(contribution);
    if (capability === "unavailable") return "awaiting_capability_dependency";
    if (capability === "disabled") return "capability_disabled";

    const consent = await this.verifyConsent(contribution);
    if (consent === "unavailable") return "awaiting_consent_dependency";
    if (consent === "invalid") {
      await this.recordState(contributionId, "consent_invalid", "consent_not_current");
      return "consent_invalid";
    }

    if (!contribution.normalization) {
      const proposal = normalizeContributionForProcessing(contribution.input);
      contribution = await dependency(() =>
        this.store.recordNormalization({
          contributionId,
          proposal,
          processingPolicyVersion: this.policy.version,
          occurredAt: this.occurredAt(),
        }),
      );
      assertLoaded(contribution, contributionId);
    }
    const normalization = contribution.normalization;
    if (!normalization || !UUID_V7_PATTERN.test(normalization.id)) {
      throw new ContributionProcessingDependencyUnavailableError();
    }

    if (!contribution.independentVerification) {
      const result = await dependency(() =>
        this.independentVerifier.verify({
          contributionId,
          normalizationId: normalization.id,
          proposal: normalization.proposal,
        }),
      );
      assertVerification(result, contribution);
      if (result.status !== "verified") {
        const reasonCode =
          result.status === "unavailable"
            ? "provider_temporarily_unavailable"
            : result.status === "mismatch"
              ? "provider_observation_mismatch"
              : "provider_posting_closed";
        await this.recordState(contributionId, "awaiting_independent_verification", reasonCode);
        return "awaiting_independent_verification";
      }
      contribution = await dependency(() =>
        this.store.recordIndependentVerification({
          contributionId,
          evidence: result,
          processingPolicyVersion: this.policy.version,
          occurredAt: this.occurredAt(),
        }),
      );
      assertLoaded(contribution, contributionId);
    }
    const verification = contribution.independentVerification;
    if (!verification) throw new ContributionProcessingDependencyUnavailableError();

    if (!contribution.trustDecision || contribution.trustDecision.status === "accepted") {
      const contributorUserId = contribution.ownerUserId;
      const trustDecision = await dependency(() =>
        this.trust.evaluate({
          contributionId,
          contributorUserId,
          normalizationId: normalization.id,
          independentVerificationId: verification.verificationId,
          independentEvidenceDigestSha256: verification.evidenceDigestSha256,
        }),
      );
      assertTrust(trustDecision, contributionId);
      if (trustDecision.status === "unavailable" || trustDecision.status === "needs_review") {
        await this.recordState(contributionId, "awaiting_trust", "trust_review_required");
        return "awaiting_trust";
      }
      contribution = await dependency(() =>
        this.store.recordTrustDecision({
          contributionId,
          decision: trustDecision,
          processingPolicyVersion: this.policy.version,
          occurredAt: this.occurredAt(),
        }),
      );
      assertLoaded(contribution, contributionId);
    }

    const terminalAfterTrust = await this.reconcileTerminal(contribution);
    if (terminalAfterTrust) return terminalAfterTrust;
    if (contribution.trustDecision?.status === "rejected") return "rejected";
    if (contribution.trustDecision?.status !== "accepted") return "awaiting_trust";

    // Consent can be revoked while normalization, verification, or Trust review is in progress.
    const finalConsent = await this.verifyConsent(contribution);
    if (finalConsent === "unavailable") return "awaiting_consent_dependency";
    if (finalConsent === "invalid") {
      await this.recordState(contributionId, "consent_invalid", "consent_not_current");
      return "consent_invalid";
    }

    capability = await this.authorizeCapability(contribution);
    if (capability === "unavailable") return "awaiting_capability_dependency";
    if (capability === "disabled") return "capability_disabled";

    const command = await dependency(() =>
      this.store.preparePublication({
        contributionId,
        processingPolicyVersion: this.policy.version,
        capabilityPolicyVersion: capability.policyVersion,
        capabilityConfigurationDigestSha256: capability.configurationDigestSha256,
        capabilityEvaluatedAt: capability.evaluatedAt,
        capabilityExpiresAt: capability.expiresAt,
        occurredAt: this.occurredAt(),
      }),
    );
    this.assertPublicationCommand(command, contribution);
    const published = await dependency(() => this.reconciler.publish(command));
    uuid(published.jobId);
    uuid(published.sourceId);
    uuid(published.verificationId);
    if (published.verificationId !== command.independentVerificationId) {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    contribution = await dependency(() =>
      this.store.completePublication({
        command,
        result: published,
        occurredAt: this.occurredAt(),
      }),
    );
    assertLoaded(contribution, contributionId);
    return "published";
  }

  private occurredAt(): Date {
    return exactDate(this.now());
  }

  private async verifyConsent(
    contribution: LoadedContributionProcessing,
  ): Promise<"current" | "invalid" | "unavailable"> {
    const approval = contribution.input.approval;
    const checkedAt = this.occurredAt().toISOString();
    const result = await dependency(() =>
      this.consent.verifyCurrent({
        ownerUserId: contribution.ownerUserId,
        consentId: approval.consentId,
        purpose: "ugc_contribution",
        clientSurface: "browser_extension",
        clientVersion: contribution.input.client.version,
        contributionId: contribution.contributionId,
        consentVersion: approval.consentVersion,
        policyVersion: approval.policyVersion,
        previewDigestSha256: approval.previewDigestSha256,
        approvedAt: approval.approvedAt,
        checkedAt,
      }),
    );
    if (!result || !["current", "invalid", "unavailable"].includes(result.status)) {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    return result.status;
  }

  private async authorizeCapability(
    contribution: LoadedContributionProcessing,
  ): Promise<AuthorizedContributionCapability | "disabled" | "unavailable"> {
    let domain: string;
    try {
      domain = new URL(contribution.input.source.sourceUrl).hostname;
    } catch {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    if (
      contribution.clientSurface !== "browser_extension" ||
      !contribution.clientVersion ||
      contribution.clientVersion !== contribution.input.client.version
    ) {
      return "disabled";
    }
    const loaded = await dependency(() => this.capability.load());
    if (!loaded) return "unavailable";
    let policy;
    try {
      policy = verifySignedContributionCapabilityPolicy(loaded.envelope, loaded.publicKeys);
    } catch {
      return "unavailable";
    }
    const checkedAt = this.occurredAt();
    const decision = evaluateContributionCapability(policy, {
      stage: "processing",
      clientVersion: contribution.clientVersion,
      provider: contribution.input.source.provider,
      pageVariant: contribution.input.source.pageVariant,
      domain,
      now: checkedAt,
    });
    if (!decision.allowed) return "disabled";
    return Object.freeze({
      status: "authorized",
      policyVersion: decision.policyRevision,
      configurationDigestSha256: createProcessingDigest(
        contributionCapabilityPolicyDigestInput(policy),
      ),
      evaluatedAt: checkedAt.toISOString(),
      expiresAt: policy.expiresAt,
    });
  }

  private async recordState(
    contributionId: string,
    state: ContributionOwnerState,
    reasonCode: ContributionOwnerReasonCode,
  ): Promise<void> {
    const value = await dependency(() =>
      this.store.recordOwnerState({
        contributionId,
        state,
        reasonCode,
        processingPolicyVersion: this.policy.version,
        occurredAt: this.occurredAt(),
      }),
    );
    assertLoaded(value, contributionId);
  }

  private async reconcileTerminal(
    contribution: LoadedContributionProcessing,
  ): Promise<"withdrawn" | "taken_down" | "removed" | null> {
    const terminal =
      contribution.trustDecision?.status === "withdrawn" ||
      contribution.trustDecision?.status === "taken_down"
        ? contribution.trustDecision.status
        : contribution.ownerState === "withdrawn" || contribution.ownerState === "taken_down"
          ? contribution.ownerState
          : null;
    if (!terminal) return contribution.ownerState === "removed" ? "removed" : null;
    if (!contribution.publication) return terminal;
    const command = await dependency(() =>
      this.store.prepareTerminalReconciliation({
        contributionId: contribution.contributionId,
        reason: terminal,
        processingPolicyVersion: this.policy.version,
        occurredAt: this.occurredAt(),
      }),
    );
    if (!command) return "removed";
    this.assertTerminalCommand(command, contribution, terminal);
    await dependency(() => this.reconciler.remove(command));
    const value = await dependency(() =>
      this.store.completeTerminalReconciliation({ command, occurredAt: this.occurredAt() }),
    );
    assertLoaded(value, contribution.contributionId);
    return "removed";
  }

  private assertPublicationCommand(
    command: PreparedPublicationReconciliation,
    contribution: LoadedContributionProcessing,
  ): void {
    const normalization = contribution.normalization;
    const verification = contribution.independentVerification;
    const trust = contribution.trustDecision;
    if (
      !normalization ||
      !verification ||
      trust?.status !== "accepted" ||
      command.contributionId !== contribution.contributionId ||
      command.normalizationId !== normalization.id ||
      command.independentVerificationId !== verification.verificationId ||
      command.jobId !== verification.jobId ||
      command.sourceId !== verification.sourceId ||
      command.trustDecisionId !== trust.decisionId ||
      command.processingPolicyVersion !== this.policy.version ||
      !POLICY_VERSION_PATTERN.test(command.capabilityPolicyVersion) ||
      !SHA256_PATTERN.test(command.capabilityConfigurationDigestSha256) ||
      exactInstant(command.capabilityEvaluatedAt) > exactInstant(command.capabilityExpiresAt)
    ) {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    uuid(command.reconciliationId);
    uuid(command.jobId);
    uuid(command.sourceId);
  }

  private assertTerminalCommand(
    command: PreparedTerminalReconciliation,
    contribution: LoadedContributionProcessing,
    reason: "withdrawn" | "taken_down",
  ): void {
    if (
      !contribution.publication ||
      command.contributionId !== contribution.contributionId ||
      command.jobId !== contribution.publication.jobId ||
      command.sourceId !== contribution.publication.sourceId ||
      command.reason !== reason ||
      command.trustDecisionId !== contribution.trustDecision?.decisionId ||
      command.processingPolicyVersion !== this.policy.version
    ) {
      throw new ContributionProcessingDependencyUnavailableError();
    }
    uuid(command.reconciliationId);
    uuid(command.jobId);
    uuid(command.sourceId);
  }
}
