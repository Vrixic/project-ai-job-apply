import { createHash } from "node:crypto";
import {
  type TrustCase,
  type TrustPolicy,
  TrustPolicyError,
  type TrustReasonCode,
} from "./policy.js";
import {
  type OwnerTrustCaseView,
  type PostgresTrustStore,
  TrustVersionConflictError,
} from "./store.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const contributorTrustActions = Object.freeze(["read", "withdraw", "appeal"] as const);
export const trustReviewerRoles = Object.freeze([
  "case_reader",
  "case_opener",
  "initial_reviewer",
  "takedown_reviewer",
  "appeal_reviewer",
] as const);
export const trustEvidencePurposes = Object.freeze([
  "independent_verification",
  "initial_review",
  "takedown",
  "appeal_resolution",
] as const);

export type ContributorTrustAction = (typeof contributorTrustActions)[number];
export type TrustReviewerRole = (typeof trustReviewerRoles)[number];
export type TrustEvidencePurpose = (typeof trustEvidencePurposes)[number];
export type InitialReviewReasonCode = Extract<
  TrustReasonCode,
  | "independently_verified"
  | "insufficient_evidence"
  | "content_mismatch"
  | "malicious_or_deceptive"
  | "license_or_policy_block"
>;
export type TakedownReasonCode = Extract<
  TrustReasonCode,
  "verified_requester_takedown" | "credible_safety_risk" | "rights_or_policy_violation"
>;

export type TrustApplicationErrorCode =
  | "access_denied"
  | "dependency_unavailable"
  | "evidence_not_verified"
  | "invalid_request"
  | "invalid_state"
  | "not_found"
  | "policy_unavailable"
  | "version_conflict";

const safeErrorMessages: Readonly<Record<TrustApplicationErrorCode, string>> = Object.freeze({
  access_denied: "The Trust operation is not authorized",
  dependency_unavailable: "A required Trust dependency is unavailable",
  evidence_not_verified: "The required evidence could not be verified",
  invalid_request: "The Trust request is invalid",
  invalid_state: "The Trust case does not allow this operation",
  not_found: "The Trust case was not found",
  policy_unavailable: "No approved Trust policy is available",
  version_conflict: "The Trust case version changed",
});

export class TrustApplicationError extends Error {
  constructor(readonly code: TrustApplicationErrorCode) {
    super(safeErrorMessages[code]);
    this.name = "TrustApplicationError";
  }
}

export interface ContributorAccountAuthorityPort {
  authorize(input: { contributorUserId: string; action: ContributorTrustAction }): Promise<boolean>;
}

export interface ReviewerAuthorityPort {
  authorize(input: { reviewerId: string; role: TrustReviewerRole }): Promise<boolean>;
}

export interface VerifiedRequesterTakedownAuthorityPort {
  authorize(input: {
    reviewerId: string;
    contributionId: string;
    evidenceDigestSha256: string;
  }): Promise<boolean>;
}

export interface ContributionEligibilityEvidence {
  contributionId: string;
  contributorUserId: string;
  eligibleForTrustReview: boolean;
}

export interface ContributionEligibilityEvidencePort {
  readEligibility(contributionId: string): Promise<ContributionEligibilityEvidence | null>;
  verifyEvidence(input: {
    contributionId: string;
    evidenceDigestSha256: string;
    purpose: TrustEvidencePurpose;
  }): Promise<boolean>;
}

export interface ApprovedTrustPolicyPort {
  readApprovedPolicy(): Promise<TrustPolicy | null>;
}

export interface TrustApplicationStore {
  open(input: Parameters<PostgresTrustStore["open"]>[0]): Promise<TrustCase>;
  review(
    caseId: string,
    expectedVersion: number,
    input: Parameters<PostgresTrustStore["review"]>[2],
  ): Promise<TrustCase>;
  withdraw(
    caseId: string,
    expectedVersion: number,
    input: Parameters<PostgresTrustStore["withdraw"]>[2],
  ): Promise<TrustCase>;
  takeDown(
    caseId: string,
    expectedVersion: number,
    input: Parameters<PostgresTrustStore["takeDown"]>[2],
  ): Promise<TrustCase>;
  appeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<PostgresTrustStore["appeal"]>[2],
  ): Promise<TrustCase>;
  resolveAppeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<PostgresTrustStore["resolveAppeal"]>[2],
  ): Promise<TrustCase>;
  readOwnerCase(ownerUserId: string, caseId: string): Promise<OwnerTrustCaseView | null>;
  readOwnerCaseByContribution(
    ownerUserId: string,
    contributionId: string,
  ): Promise<OwnerTrustCaseView | null>;
  readReviewerCase(caseId: string): Promise<TrustCase | null>;
}

export interface TrustApplicationDependencies {
  store?: TrustApplicationStore;
  contributorAccountAuthority?: ContributorAccountAuthorityPort;
  reviewerAuthority?: ReviewerAuthorityPort;
  verifiedRequesterTakedownAuthority?: VerifiedRequesterTakedownAuthorityPort;
  contributionEvidence?: ContributionEligibilityEvidencePort;
  approvedPolicy?: ApprovedTrustPolicyPort;
  systemActorId?: string;
  now?: () => Date;
}

const denyContributorAuthority: ContributorAccountAuthorityPort = {
  authorize: async () => false,
};
const denyReviewerAuthority: ReviewerAuthorityPort = { authorize: async () => false };
const denyVerifiedRequesterAuthority: VerifiedRequesterTakedownAuthorityPort = {
  authorize: async () => false,
};
const unavailableContributionEvidence: ContributionEligibilityEvidencePort = {
  readEligibility: async () => {
    throw new Error("unavailable");
  },
  verifyEvidence: async () => {
    throw new Error("unavailable");
  },
};
const unavailableApprovedPolicy: ApprovedTrustPolicyPort = {
  readApprovedPolicy: async () => {
    throw new Error("unavailable");
  },
};
const unavailableStore: TrustApplicationStore = {
  open: async () => {
    throw new Error("unavailable");
  },
  review: async () => {
    throw new Error("unavailable");
  },
  withdraw: async () => {
    throw new Error("unavailable");
  },
  takeDown: async () => {
    throw new Error("unavailable");
  },
  appeal: async () => {
    throw new Error("unavailable");
  },
  resolveAppeal: async () => {
    throw new Error("unavailable");
  },
  readOwnerCase: async () => {
    throw new Error("unavailable");
  },
  readOwnerCaseByContribution: async () => {
    throw new Error("unavailable");
  },
  readReviewerCase: async () => {
    throw new Error("unavailable");
  },
};

function invalidRequest(): never {
  throw new TrustApplicationError("invalid_request");
}

function uuid(value: string): string {
  if (!UUID_PATTERN.test(value)) invalidRequest();
  return value;
}

function digest(value: string): string {
  if (!SHA256_PATTERN.test(value)) invalidRequest();
  return value;
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) invalidRequest();
  return value;
}

function instant(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TrustApplicationError("dependency_unavailable");
  }
  return new Date(value.getTime());
}

async function dependency<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TrustApplicationError) throw error;
    throw new TrustApplicationError("dependency_unavailable");
  }
}

async function storeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TrustApplicationError) throw error;
    if (error instanceof TrustVersionConflictError) {
      throw new TrustApplicationError("version_conflict");
    }
    if (error instanceof TrustPolicyError) {
      throw new TrustApplicationError("invalid_state");
    }
    throw new TrustApplicationError("dependency_unavailable");
  }
}

export class TrustApplicationService {
  private readonly store: TrustApplicationStore;
  private readonly contributorAccountAuthority: ContributorAccountAuthorityPort;
  private readonly reviewerAuthority: ReviewerAuthorityPort;
  private readonly verifiedRequesterTakedownAuthority: VerifiedRequesterTakedownAuthorityPort;
  private readonly contributionEvidence: ContributionEligibilityEvidencePort;
  private readonly approvedPolicy: ApprovedTrustPolicyPort;
  private readonly systemActorId: string | null;
  private readonly now: () => Date;

  constructor(dependencies: TrustApplicationDependencies = {}) {
    this.store = dependencies.store ?? unavailableStore;
    this.contributorAccountAuthority =
      dependencies.contributorAccountAuthority ?? denyContributorAuthority;
    this.reviewerAuthority = dependencies.reviewerAuthority ?? denyReviewerAuthority;
    this.verifiedRequesterTakedownAuthority =
      dependencies.verifiedRequesterTakedownAuthority ?? denyVerifiedRequesterAuthority;
    this.contributionEvidence =
      dependencies.contributionEvidence ?? unavailableContributionEvidence;
    this.approvedPolicy = dependencies.approvedPolicy ?? unavailableApprovedPolicy;
    this.systemActorId = dependencies.systemActorId ?? null;
    this.now = dependencies.now ?? (() => new Date());
  }

  async readOwnerCase(input: {
    contributorUserId: string;
    contributionId: string;
  }): Promise<OwnerTrustCaseView> {
    const contributorUserId = uuid(input.contributorUserId);
    const contributionId = uuid(input.contributionId);
    await this.authorizeContributor(contributorUserId, "read");
    const trustCase = await storeOperation(() =>
      this.store.readOwnerCaseByContribution(contributorUserId, contributionId),
    );
    if (!trustCase) throw new TrustApplicationError("not_found");
    return trustCase;
  }

  async withdrawOwnerContribution(input: {
    contributorUserId: string;
    contributionId: string;
    expectedVersion: number;
  }): Promise<OwnerTrustCaseView> {
    const contributorUserId = uuid(input.contributorUserId);
    const contributionId = uuid(input.contributionId);
    const expectedVersion = version(input.expectedVersion);
    await this.authorizeContributor(contributorUserId, "withdraw");
    const current = await this.requireOwnerContribution(
      contributorUserId,
      contributionId,
      expectedVersion,
    );
    await storeOperation(() =>
      this.store.withdraw(current.id, expectedVersion, {
        contributorUserId,
        occurredAt: this.occurredAt(),
      }),
    );
    return this.requireOwnerContribution(contributorUserId, contributionId);
  }

  async appealOwnerDecision(input: {
    contributorUserId: string;
    contributionId: string;
    expectedVersion: number;
    evidenceDigestSha256: string;
  }): Promise<OwnerTrustCaseView> {
    const contributorUserId = uuid(input.contributorUserId);
    const contributionId = uuid(input.contributionId);
    const expectedVersion = version(input.expectedVersion);
    const evidenceDigestSha256 = digest(input.evidenceDigestSha256);
    await this.authorizeContributor(contributorUserId, "appeal");
    const current = await this.requireOwnerContribution(
      contributorUserId,
      contributionId,
      expectedVersion,
    );
    await storeOperation(() =>
      this.store.appeal(current.id, expectedVersion, {
        contributorUserId,
        evidenceDigestSha256,
        occurredAt: this.occurredAt(),
      }),
    );
    return this.requireOwnerContribution(contributorUserId, contributionId);
  }

  async openReview(input: { reviewerId: string; contributionId: string }): Promise<TrustCase> {
    const reviewerId = uuid(input.reviewerId);
    const contributionId = uuid(input.contributionId);
    const caseId = trustCaseIdForContribution(contributionId);
    await this.authorizeReviewer(reviewerId, "case_opener");
    const eligibility = await dependency(() =>
      this.contributionEvidence.readEligibility(contributionId),
    );
    if (!eligibility) throw new TrustApplicationError("not_found");
    this.validateEligibility(eligibility, contributionId);
    if (!eligibility.eligibleForTrustReview) {
      throw new TrustApplicationError("invalid_state");
    }
    const policy = await dependency(() => this.approvedPolicy.readApprovedPolicy());
    if (!policy) throw new TrustApplicationError("policy_unavailable");
    if (
      !/^[a-z0-9][a-z0-9._-]{2,99}$/.test(policy.version) ||
      !Number.isSafeInteger(policy.appealWindowMilliseconds) ||
      policy.appealWindowMilliseconds < 1 ||
      policy.appealWindowMilliseconds > 365 * 24 * 60 * 60 * 1_000
    ) {
      throw new TrustApplicationError("policy_unavailable");
    }
    if (!this.systemActorId) throw new TrustApplicationError("dependency_unavailable");
    if (!UUID_PATTERN.test(this.systemActorId)) {
      throw new TrustApplicationError("dependency_unavailable");
    }
    const systemActorId = this.systemActorId;
    return storeOperation(() =>
      this.store.open({
        caseId,
        contributionId,
        contributorUserId: eligibility.contributorUserId,
        systemActorId,
        policy,
        occurredAt: this.occurredAt(),
      }),
    );
  }

  async readReviewerCase(input: { reviewerId: string; caseId: string }): Promise<TrustCase> {
    const reviewerId = uuid(input.reviewerId);
    const caseId = uuid(input.caseId);
    await this.authorizeReviewer(reviewerId, "case_reader");
    const trustCase = await storeOperation(() => this.store.readReviewerCase(caseId));
    if (!trustCase) throw new TrustApplicationError("not_found");
    return trustCase;
  }

  async decideInitialReview(input: {
    reviewerId: string;
    caseId: string;
    expectedVersion: number;
    outcome: "accepted" | "rejected";
    reasonCode: InitialReviewReasonCode;
    evidenceDigestSha256: string;
  }): Promise<TrustCase> {
    const reviewerId = uuid(input.reviewerId);
    const caseId = uuid(input.caseId);
    const expectedVersion = version(input.expectedVersion);
    const evidenceDigestSha256 = digest(input.evidenceDigestSha256);
    this.validateInitialDecision(input.outcome, input.reasonCode);
    await this.authorizeReviewer(reviewerId, "initial_reviewer");
    const current = await this.requireReviewerCase(caseId, expectedVersion);
    await this.requireEligibleContribution(current);
    await this.verifyEvidence(
      current.contributionId,
      evidenceDigestSha256,
      input.outcome === "accepted" ? "independent_verification" : "initial_review",
    );
    return storeOperation(() =>
      this.store.review(caseId, expectedVersion, {
        reviewerId,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        evidenceDigestSha256,
        occurredAt: this.occurredAt(),
      }),
    );
  }

  async takeDownAcceptedContribution(input: {
    reviewerId: string;
    caseId: string;
    expectedVersion: number;
    reasonCode: TakedownReasonCode;
    evidenceDigestSha256: string;
  }): Promise<TrustCase> {
    const reviewerId = uuid(input.reviewerId);
    const caseId = uuid(input.caseId);
    const expectedVersion = version(input.expectedVersion);
    const evidenceDigestSha256 = digest(input.evidenceDigestSha256);
    this.validateTakedownReason(input.reasonCode);
    await this.authorizeReviewer(reviewerId, "takedown_reviewer");
    const current = await this.requireReviewerCase(caseId, expectedVersion);
    if (input.reasonCode === "verified_requester_takedown") {
      const authorized = await dependency(() =>
        this.verifiedRequesterTakedownAuthority.authorize({
          reviewerId,
          contributionId: current.contributionId,
          evidenceDigestSha256,
        }),
      );
      if (!authorized) throw new TrustApplicationError("access_denied");
    } else {
      await this.verifyEvidence(current.contributionId, evidenceDigestSha256, "takedown");
    }
    return storeOperation(() =>
      this.store.takeDown(caseId, expectedVersion, {
        reviewerId,
        reasonCode: input.reasonCode,
        evidenceDigestSha256,
        occurredAt: this.occurredAt(),
      }),
    );
  }

  async resolveAppeal(input: {
    reviewerId: string;
    caseId: string;
    expectedVersion: number;
    outcome: "upheld" | "reversed";
    evidenceDigestSha256: string;
  }): Promise<TrustCase> {
    const reviewerId = uuid(input.reviewerId);
    const caseId = uuid(input.caseId);
    const expectedVersion = version(input.expectedVersion);
    const evidenceDigestSha256 = digest(input.evidenceDigestSha256);
    await this.authorizeReviewer(reviewerId, "appeal_reviewer");
    const current = await this.requireReviewerCase(caseId, expectedVersion);
    if (current.adverseDecision?.reviewerId === reviewerId) {
      throw new TrustApplicationError("access_denied");
    }
    await this.verifyEvidence(current.contributionId, evidenceDigestSha256, "appeal_resolution");
    return storeOperation(() =>
      this.store.resolveAppeal(caseId, expectedVersion, {
        reviewerId,
        outcome: input.outcome,
        evidenceDigestSha256,
        occurredAt: this.occurredAt(),
      }),
    );
  }

  private occurredAt(): Date {
    try {
      return instant(this.now());
    } catch (error) {
      if (error instanceof TrustApplicationError) throw error;
      throw new TrustApplicationError("dependency_unavailable");
    }
  }

  private async authorizeContributor(
    contributorUserId: string,
    action: ContributorTrustAction,
  ): Promise<void> {
    const authorized = await dependency(() =>
      this.contributorAccountAuthority.authorize({ contributorUserId, action }),
    );
    if (!authorized) throw new TrustApplicationError("access_denied");
  }

  private async authorizeReviewer(reviewerId: string, role: TrustReviewerRole): Promise<void> {
    const authorized = await dependency(() =>
      this.reviewerAuthority.authorize({ reviewerId, role }),
    );
    if (!authorized) throw new TrustApplicationError("access_denied");
  }

  private async requireOwnerContribution(
    contributorUserId: string,
    contributionId: string,
    expectedVersion?: number,
  ): Promise<OwnerTrustCaseView> {
    const trustCase = await storeOperation(() =>
      this.store.readOwnerCaseByContribution(contributorUserId, contributionId),
    );
    if (!trustCase) throw new TrustApplicationError("not_found");
    if (expectedVersion !== undefined && trustCase.version !== expectedVersion) {
      throw new TrustApplicationError("version_conflict");
    }
    return trustCase;
  }

  private async requireReviewerCase(caseId: string, expectedVersion: number): Promise<TrustCase> {
    const trustCase = await storeOperation(() => this.store.readReviewerCase(caseId));
    if (!trustCase) throw new TrustApplicationError("not_found");
    if (trustCase.version !== expectedVersion) {
      throw new TrustApplicationError("version_conflict");
    }
    return trustCase;
  }

  private validateEligibility(
    eligibility: ContributionEligibilityEvidence,
    contributionId: string,
  ): void {
    if (
      eligibility.contributionId !== contributionId ||
      !UUID_PATTERN.test(eligibility.contributorUserId)
    ) {
      throw new TrustApplicationError("dependency_unavailable");
    }
  }

  private async requireEligibleContribution(trustCase: TrustCase): Promise<void> {
    const eligibility = await dependency(() =>
      this.contributionEvidence.readEligibility(trustCase.contributionId),
    );
    if (!eligibility) throw new TrustApplicationError("not_found");
    this.validateEligibility(eligibility, trustCase.contributionId);
    if (
      !eligibility.eligibleForTrustReview ||
      eligibility.contributorUserId !== trustCase.contributorUserId
    ) {
      throw new TrustApplicationError("invalid_state");
    }
  }

  private validateInitialDecision(
    outcome: "accepted" | "rejected",
    reasonCode: InitialReviewReasonCode,
  ): void {
    const validRejectedReasons: readonly InitialReviewReasonCode[] = [
      "insufficient_evidence",
      "content_mismatch",
      "malicious_or_deceptive",
      "license_or_policy_block",
    ];
    if (
      (outcome === "accepted" && reasonCode !== "independently_verified") ||
      (outcome === "rejected" && !validRejectedReasons.includes(reasonCode))
    ) {
      invalidRequest();
    }
  }

  private validateTakedownReason(reasonCode: TakedownReasonCode): void {
    const valid: readonly TakedownReasonCode[] = [
      "verified_requester_takedown",
      "credible_safety_risk",
      "rights_or_policy_violation",
    ];
    if (!valid.includes(reasonCode)) invalidRequest();
  }

  private async verifyEvidence(
    contributionId: string,
    evidenceDigestSha256: string,
    purpose: TrustEvidencePurpose,
  ): Promise<void> {
    const verified = await dependency(() =>
      this.contributionEvidence.verifyEvidence({
        contributionId,
        evidenceDigestSha256,
        purpose,
      }),
    );
    if (!verified) throw new TrustApplicationError("evidence_not_verified");
  }
}

export function trustCaseIdForContribution(contributionId: string): string {
  uuid(contributionId);
  const bytes = createHash("sha256")
    .update("ai-job-apply/trust-case/v1\0")
    .update(contributionId)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
