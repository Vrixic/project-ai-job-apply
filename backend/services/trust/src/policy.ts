const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const trustCaseStates = Object.freeze([
  "needs_review",
  "accepted",
  "rejected",
  "appeal_pending",
  "withdrawn",
  "taken_down",
] as const);

export const trustReasonCodes = Object.freeze([
  "queued_for_review",
  "independently_verified",
  "insufficient_evidence",
  "content_mismatch",
  "malicious_or_deceptive",
  "license_or_policy_block",
  "contributor_withdrawal",
  "verified_requester_takedown",
  "credible_safety_risk",
  "rights_or_policy_violation",
  "development_test_removal",
  "new_or_corrected_evidence",
  "decision_upheld",
  "decision_reversed",
] as const);

export const trustSignalCodes = Object.freeze([
  "contributor_submission_verified",
  "contributor_submission_incorrect",
  "contributor_abuse_detected",
  "source_observation_corroborated",
  "source_content_conflict",
  "source_safety_risk",
  "adverse_decision_reversed",
] as const);

export type TrustCaseState = (typeof trustCaseStates)[number];
export type TrustReasonCode = (typeof trustReasonCodes)[number];
export type TrustSignalCode = (typeof trustSignalCodes)[number];
export type AdverseTrustState = Extract<TrustCaseState, "rejected" | "taken_down">;

export interface AdverseDecision {
  state: AdverseTrustState;
  reviewerId: string;
  decidedAt: Date;
  appealDeadlineAt: Date;
}

export interface TrustCase {
  id: string;
  contributionId: string;
  contributorUserId: string;
  policyVersion: string;
  appealWindowMilliseconds: number;
  state: TrustCaseState;
  version: number;
  appealCount: 0 | 1;
  adverseDecision: AdverseDecision | null;
  pendingAppealEvidenceDigestSha256: string | null;
  /** Last accepted independent provider proof; null for historical decisions without a basis. */
  independentEvidenceDigestSha256: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrustPolicy {
  version: string;
  appealWindowMilliseconds: number;
}

export interface TrustTransition {
  trustCase: TrustCase;
  action:
    | "opened"
    | "review_accepted"
    | "review_rejected"
    | "withdrawn"
    | "taken_down"
    | "appeal_filed"
    | "appeal_upheld"
    | "appeal_reversed";
  actorKind: "system" | "reviewer" | "contributor";
  actorId: string;
  reasonCode: TrustReasonCode;
  evidenceDigestSha256: string | null;
}

export class TrustPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustPolicyError";
  }
}

function uuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new TrustPolicyError(`${field} must be a lowercase UUID`);
  return value;
}

function digest(value: string, field: string): string {
  if (!SHA256_PATTERN.test(value)) throw new TrustPolicyError(`${field} must be a SHA-256 digest`);
  return value;
}

function instant(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) throw new TrustPolicyError(`${field} must be valid`);
  return new Date(value.getTime());
}

function next(base: TrustCase, occurredAt: Date): TrustCase {
  const at = instant(occurredAt, "occurredAt");
  if (at < base.updatedAt) throw new TrustPolicyError("Trust case chronology cannot regress");
  if (!Number.isSafeInteger(base.version) || base.version < 1) {
    throw new TrustPolicyError("Trust case version is invalid");
  }
  return { ...base, version: base.version + 1, updatedAt: at };
}

function adverse(
  state: AdverseTrustState,
  reviewerId: string,
  decidedAt: Date,
  appealWindowMilliseconds: number,
): AdverseDecision {
  const at = instant(decidedAt, "decidedAt");
  return {
    state,
    reviewerId: uuid(reviewerId, "reviewerId"),
    decidedAt: at,
    appealDeadlineAt: new Date(at.getTime() + appealWindowMilliseconds),
  };
}

function policy(value: TrustPolicy): TrustPolicy {
  if (!/^[a-z0-9][a-z0-9._-]{2,99}$/.test(value.version)) {
    throw new TrustPolicyError("Trust policy version is invalid");
  }
  if (
    !Number.isSafeInteger(value.appealWindowMilliseconds) ||
    value.appealWindowMilliseconds < 1 ||
    value.appealWindowMilliseconds > 365 * 24 * 60 * 60 * 1_000
  ) {
    throw new TrustPolicyError("Trust appeal window is outside the technical bound");
  }
  return { ...value };
}

export function openTrustCase(input: {
  caseId: string;
  contributionId: string;
  contributorUserId: string;
  systemActorId: string;
  policy: TrustPolicy;
  occurredAt: Date;
}): TrustTransition {
  const occurredAt = instant(input.occurredAt, "occurredAt");
  const selectedPolicy = policy(input.policy);
  const trustCase: TrustCase = {
    id: uuid(input.caseId, "caseId"),
    contributionId: uuid(input.contributionId, "contributionId"),
    contributorUserId: uuid(input.contributorUserId, "contributorUserId"),
    policyVersion: selectedPolicy.version,
    appealWindowMilliseconds: selectedPolicy.appealWindowMilliseconds,
    state: "needs_review",
    version: 1,
    appealCount: 0,
    adverseDecision: null,
    pendingAppealEvidenceDigestSha256: null,
    independentEvidenceDigestSha256: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  return {
    trustCase,
    action: "opened",
    actorKind: "system",
    actorId: uuid(input.systemActorId, "systemActorId"),
    reasonCode: "queued_for_review",
    evidenceDigestSha256: null,
  };
}

export function decideContributionReview(
  current: TrustCase,
  input: {
    reviewerId: string;
    outcome: "accepted" | "rejected";
    reasonCode:
      | "independently_verified"
      | "insufficient_evidence"
      | "content_mismatch"
      | "malicious_or_deceptive"
      | "license_or_policy_block";
    evidenceDigestSha256: string;
    independentEvidenceDigestSha256?: string;
    occurredAt: Date;
  },
): TrustTransition {
  if (current.state !== "needs_review") {
    throw new TrustPolicyError("Only a case needing review can receive an initial decision");
  }
  const accepted = input.outcome === "accepted";
  if (accepted !== (input.reasonCode === "independently_verified")) {
    throw new TrustPolicyError("Review outcome and fixed reason code do not match");
  }
  const reviewerId = uuid(input.reviewerId, "reviewerId");
  const independentEvidenceDigestSha256 = accepted
    ? digest(input.independentEvidenceDigestSha256 ?? "", "independentEvidenceDigestSha256")
    : null;
  if (accepted && independentEvidenceDigestSha256 !== input.evidenceDigestSha256) {
    throw new TrustPolicyError("Initial acceptance must bind the reviewed independent evidence");
  }
  if (!accepted && input.independentEvidenceDigestSha256 !== undefined) {
    throw new TrustPolicyError("A rejected review cannot establish independent evidence");
  }
  const updated = next(current, input.occurredAt);
  const trustCase: TrustCase = {
    ...updated,
    state: input.outcome,
    independentEvidenceDigestSha256,
    adverseDecision: accepted
      ? null
      : adverse("rejected", reviewerId, updated.updatedAt, current.appealWindowMilliseconds),
  };
  return {
    trustCase,
    action: accepted ? "review_accepted" : "review_rejected",
    actorKind: "reviewer",
    actorId: reviewerId,
    reasonCode: input.reasonCode,
    evidenceDigestSha256: digest(input.evidenceDigestSha256, "evidenceDigestSha256"),
  };
}

export function withdrawContribution(
  current: TrustCase,
  input: { contributorUserId: string; occurredAt: Date },
): TrustTransition {
  if (uuid(input.contributorUserId, "contributorUserId") !== current.contributorUserId) {
    throw new TrustPolicyError("Only the contribution owner can withdraw it");
  }
  if (current.state === "withdrawn")
    throw new TrustPolicyError("Contribution is already withdrawn");
  const trustCase = {
    ...next(current, input.occurredAt),
    state: "withdrawn" as const,
    pendingAppealEvidenceDigestSha256: null,
    independentEvidenceDigestSha256: null,
  };
  return {
    trustCase,
    action: "withdrawn",
    actorKind: "contributor",
    actorId: current.contributorUserId,
    reasonCode: "contributor_withdrawal",
    evidenceDigestSha256: null,
  };
}

export function takeDownContribution(
  current: TrustCase,
  input: {
    reviewerId: string;
    reasonCode:
      | "verified_requester_takedown"
      | "credible_safety_risk"
      | "rights_or_policy_violation"
      | "development_test_removal";
    evidenceDigestSha256: string;
    occurredAt: Date;
  },
): TrustTransition {
  if (current.state !== "accepted") {
    throw new TrustPolicyError("Only an accepted contribution can receive a takedown decision");
  }
  const reviewerId = uuid(input.reviewerId, "reviewerId");
  const updated = next(current, input.occurredAt);
  const trustCase: TrustCase = {
    ...updated,
    state: "taken_down",
    adverseDecision: adverse(
      "taken_down",
      reviewerId,
      updated.updatedAt,
      current.appealWindowMilliseconds,
    ),
  };
  return {
    trustCase,
    action: "taken_down",
    actorKind: "reviewer",
    actorId: reviewerId,
    reasonCode: input.reasonCode,
    evidenceDigestSha256: digest(input.evidenceDigestSha256, "evidenceDigestSha256"),
  };
}

export function fileTrustAppeal(
  current: TrustCase,
  input: {
    contributorUserId: string;
    evidenceDigestSha256: string;
    occurredAt: Date;
  },
): TrustTransition {
  if (uuid(input.contributorUserId, "contributorUserId") !== current.contributorUserId) {
    throw new TrustPolicyError("Only the contribution owner can appeal");
  }
  if (current.appealCount !== 0) throw new TrustPolicyError("Only one appeal is allowed");
  if (
    (current.state !== "rejected" && current.state !== "taken_down") ||
    !current.adverseDecision
  ) {
    throw new TrustPolicyError("Only an adverse decision can be appealed");
  }
  const occurredAt = instant(input.occurredAt, "occurredAt");
  if (occurredAt > current.adverseDecision.appealDeadlineAt) {
    throw new TrustPolicyError("The configured appeal window has closed");
  }
  const evidenceDigestSha256 = digest(input.evidenceDigestSha256, "evidenceDigestSha256");
  const trustCase: TrustCase = {
    ...next(current, occurredAt),
    state: "appeal_pending",
    appealCount: 1,
    pendingAppealEvidenceDigestSha256: evidenceDigestSha256,
  };
  return {
    trustCase,
    action: "appeal_filed",
    actorKind: "contributor",
    actorId: current.contributorUserId,
    reasonCode: "new_or_corrected_evidence",
    evidenceDigestSha256,
  };
}

export function decideTrustAppeal(
  current: TrustCase,
  input: {
    reviewerId: string;
    outcome: "upheld" | "reversed";
    evidenceDigestSha256: string;
    independentEvidenceDigestSha256?: string;
    occurredAt: Date;
  },
): TrustTransition {
  if (input.outcome !== "upheld" && input.outcome !== "reversed") {
    throw new TrustPolicyError("Appeal outcome is invalid");
  }
  if (current.state !== "appeal_pending" || !current.adverseDecision) {
    throw new TrustPolicyError("No appeal is pending");
  }
  const reviewerId = uuid(input.reviewerId, "reviewerId");
  if (reviewerId === current.adverseDecision.reviewerId) {
    throw new TrustPolicyError("An appeal requires a different reviewer");
  }
  if (input.outcome === "upheld" && input.independentEvidenceDigestSha256 !== undefined) {
    throw new TrustPolicyError("An upheld appeal cannot establish independent evidence");
  }
  const trustCase: TrustCase = {
    ...next(current, input.occurredAt),
    state: input.outcome === "upheld" ? current.adverseDecision.state : "accepted",
    pendingAppealEvidenceDigestSha256: null,
    independentEvidenceDigestSha256:
      input.outcome === "reversed"
        ? digest(input.independentEvidenceDigestSha256 ?? "", "independentEvidenceDigestSha256")
        : current.independentEvidenceDigestSha256,
  };
  return {
    trustCase,
    action: input.outcome === "upheld" ? "appeal_upheld" : "appeal_reversed",
    actorKind: "reviewer",
    actorId: reviewerId,
    reasonCode: input.outcome === "upheld" ? "decision_upheld" : "decision_reversed",
    evidenceDigestSha256: digest(input.evidenceDigestSha256, "evidenceDigestSha256"),
  };
}

export function validateTrustSignal(input: {
  subjectKind: "contributor" | "source";
  signalCode: TrustSignalCode;
  referenceDigestSha256: string;
}): void {
  if (!(trustSignalCodes as readonly string[]).includes(input.signalCode)) {
    throw new TrustPolicyError("Trust signal code is invalid");
  }
  const contributorSignal = input.signalCode.startsWith("contributor_");
  const sourceSignal = input.signalCode.startsWith("source_");
  if (
    (input.subjectKind === "contributor" &&
      !contributorSignal &&
      input.signalCode !== "adverse_decision_reversed") ||
    (input.subjectKind === "source" && !sourceSignal)
  ) {
    throw new TrustPolicyError("Trust signal subject and fixed code do not match");
  }
  digest(input.referenceDigestSha256, "referenceDigestSha256");
}

export function validateTrustSignalForCase(
  trustCase: TrustCase,
  input: Parameters<typeof validateTrustSignal>[0],
): void {
  validateTrustSignal(input);
  if (input.subjectKind === "source") return;
  if (input.signalCode === "contributor_submission_verified" && trustCase.state !== "accepted") {
    throw new TrustPolicyError("Verified contributor evidence requires an accepted decision");
  }
  if (
    (input.signalCode === "contributor_submission_incorrect" ||
      input.signalCode === "contributor_abuse_detected") &&
    (!trustCase.adverseDecision ||
      trustCase.appealCount !== 0 ||
      (trustCase.state !== "rejected" && trustCase.state !== "taken_down"))
  ) {
    throw new TrustPolicyError("Adverse contributor evidence must remain eligible for appeal");
  }
  if (
    input.signalCode === "adverse_decision_reversed" &&
    (trustCase.state !== "accepted" || trustCase.appealCount !== 1)
  ) {
    throw new TrustPolicyError("Reversal evidence requires a completed reversal");
  }
}
