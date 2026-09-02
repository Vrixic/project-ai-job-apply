import { createHash } from "node:crypto";
import type { JobStatus } from "./domain/canonical-job.js";
import type {
  D2PageVariant,
  D2Provider,
  SourceFreshnessPolicy,
  SourceFreshnessPolicyRegistry,
} from "./freshness-policy.js";

export type RevalidationSignalKind =
  | "community_observation"
  | "candidate_closed_report"
  | "policy_suspect";
export type VerificationEvidenceKind =
  | "independent_positive_verification"
  | "independent_closed_verification"
  | "authorized_administrative_block";

export interface SourceIdentity {
  jobId: string;
  sourceId: string;
  provider: D2Provider;
  pageVariant: D2PageVariant;
}

export interface RevalidationQueuePolicy {
  maxAttempts: number;
  claimLeaseMilliseconds: number;
  retryDelayMilliseconds: readonly number[];
}

export interface RevalidationQueueItem extends SourceIdentity {
  id: string;
  signalKind: RevalidationSignalKind;
  priority: "normal" | "high";
  state: "pending" | "claimed" | "completed" | "dead";
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  claimedBy?: string;
  claimExpiresAt?: Date;
}

export interface LifecycleTransition {
  jobId: string;
  fromStatus: JobStatus;
  toStatus: JobStatus;
  evidenceId?: string;
  replayed: boolean;
}

export interface IndependentEvidenceInput extends SourceIdentity {
  evidenceKind: Exclude<VerificationEvidenceKind, "authorized_administrative_block">;
  evidenceDigestSha256: string;
  verifiedAt: Date;
  recordedAt: Date;
  validThrough?: Date;
  claim?: { id: string; workerId: string };
}

export interface AdministrativeBlockInput {
  jobId: string;
  decisionId: string;
  evidenceDigestSha256: string;
  policyVersion: string;
  reasonCode: string;
  decidedAt: Date;
  recordedAt: Date;
}

export interface AdministrativeFreshnessAuthority {
  authorize(input: Readonly<AdministrativeBlockInput>): Promise<boolean>;
}

export class DenyAdministrativeFreshnessAuthority implements AdministrativeFreshnessAuthority {
  async authorize(): Promise<boolean> {
    return false;
  }
}

export interface SourceRevalidationStore {
  enqueue(input: {
    identity: SourceIdentity;
    signalKind: RevalidationSignalKind;
    signalDigestSha256: string;
    priority: "normal" | "high";
    maxAttempts: number;
    availableAt: Date;
  }): Promise<RevalidationQueueItem>;
  claim(input: {
    workerId: string;
    now: Date;
    claimExpiresAt: Date;
    limit: number;
  }): Promise<RevalidationQueueItem[]>;
  failClaim(input: {
    item: RevalidationQueueItem;
    workerId: string;
    now: Date;
    retryAt: Date;
    errorCode: string;
  }): Promise<RevalidationQueueItem>;
  recordIndependentEvidence(
    input: IndependentEvidenceInput,
    policy: SourceFreshnessPolicy,
  ): Promise<LifecycleTransition>;
  applyFreshnessClock(
    identity: SourceIdentity,
    now: Date,
    policy: SourceFreshnessPolicy,
    maxAttempts: number,
  ): Promise<LifecycleTransition>;
  recordAdministrativeBlock(input: AdministrativeBlockInput): Promise<LifecycleTransition>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9:_-]{3,200}$/u;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{3,100}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

function validDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid date`);
  }
}

function assertIdentity(identity: SourceIdentity): void {
  if (!UUID_PATTERN.test(identity.jobId) || !UUID_PATTERN.test(identity.sourceId)) {
    throw new TypeError("Revalidation requires UUID job and source identifiers");
  }
}

function assertQueuePolicy(policy: RevalidationQueuePolicy): void {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 5 ||
    !Number.isInteger(policy.claimLeaseMilliseconds) ||
    policy.claimLeaseMilliseconds < 1_000 ||
    policy.claimLeaseMilliseconds > 24 * 60 * 60 * 1_000 ||
    policy.retryDelayMilliseconds.length !== policy.maxAttempts - 1 ||
    policy.retryDelayMilliseconds.some(
      (delay) => !Number.isInteger(delay) || delay < 1_000 || delay > 24 * 60 * 60 * 1_000,
    )
  ) {
    throw new Error("An explicit bounded revalidation queue policy is required");
  }
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

export class SourceRevalidationService {
  constructor(
    private readonly store: SourceRevalidationStore,
    private readonly policies: SourceFreshnessPolicyRegistry,
    private readonly queuePolicy: RevalidationQueuePolicy,
    private readonly administrativeAuthority: AdministrativeFreshnessAuthority = new DenyAdministrativeFreshnessAuthority(),
  ) {
    assertQueuePolicy(queuePolicy);
  }

  async enqueueCommunitySignal(input: {
    identity: SourceIdentity;
    kind: "community_observation" | "candidate_closed_report";
    signalReference: string;
    observedAt: Date;
  }): Promise<RevalidationQueueItem> {
    assertIdentity(input.identity);
    this.policies.require(input.identity);
    if (!OPAQUE_ID_PATTERN.test(input.signalReference)) {
      throw new TypeError("A bounded opaque signal reference is required");
    }
    validDate(input.observedAt, "observedAt");
    return this.store.enqueue({
      identity: input.identity,
      signalKind: input.kind,
      signalDigestSha256: digest([
        "source-revalidation-signal-v1",
        input.identity.jobId,
        input.identity.sourceId,
        input.kind,
        input.signalReference,
      ]),
      priority: input.kind === "candidate_closed_report" ? "high" : "normal",
      maxAttempts: this.queuePolicy.maxAttempts,
      availableAt: new Date(input.observedAt),
    });
  }

  async claim(workerId: string, now: Date, limit: number): Promise<RevalidationQueueItem[]> {
    if (!OPAQUE_ID_PATTERN.test(workerId)) throw new TypeError("Worker identifier is invalid");
    validDate(now, "now");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new TypeError("Claim limit must be between one and twenty-five");
    }
    return this.store.claim({
      workerId,
      now,
      claimExpiresAt: new Date(now.getTime() + this.queuePolicy.claimLeaseMilliseconds),
      limit,
    });
  }

  async failClaim(
    item: RevalidationQueueItem,
    workerId: string,
    now: Date,
    errorCode: string,
  ): Promise<RevalidationQueueItem> {
    if (!OPAQUE_ID_PATTERN.test(workerId) || !ERROR_CODE_PATTERN.test(errorCode)) {
      throw new TypeError("Revalidation failure metadata is invalid");
    }
    validDate(now, "now");
    const delay = this.queuePolicy.retryDelayMilliseconds[item.attempt - 1];
    const retryAt = delay === undefined ? now : new Date(now.getTime() + delay);
    return this.store.failClaim({ item, workerId, now, retryAt, errorCode });
  }

  async recordIndependentEvidence(input: IndependentEvidenceInput): Promise<LifecycleTransition> {
    assertIdentity(input);
    if (!DIGEST_PATTERN.test(input.evidenceDigestSha256)) {
      throw new TypeError("Independent evidence digest is invalid");
    }
    validDate(input.verifiedAt, "verifiedAt");
    validDate(input.recordedAt, "recordedAt");
    if (input.recordedAt < input.verifiedAt) {
      throw new Error("Independent evidence cannot be recorded before verification");
    }
    const policy = this.policies.require(input);
    return this.store.recordIndependentEvidence(input, policy);
  }

  async applyFreshnessClock(identity: SourceIdentity, now: Date): Promise<LifecycleTransition> {
    assertIdentity(identity);
    validDate(now, "now");
    const policy = this.policies.require(identity);
    return this.store.applyFreshnessClock(identity, now, policy, this.queuePolicy.maxAttempts);
  }

  async recordAdministrativeBlock(input: AdministrativeBlockInput): Promise<LifecycleTransition> {
    if (
      !UUID_PATTERN.test(input.jobId) ||
      !OPAQUE_ID_PATTERN.test(input.decisionId) ||
      !DIGEST_PATTERN.test(input.evidenceDigestSha256) ||
      !POLICY_VERSION_PATTERN.test(input.policyVersion) ||
      !ERROR_CODE_PATTERN.test(input.reasonCode)
    ) {
      throw new TypeError("Administrative freshness decision is invalid");
    }
    validDate(input.decidedAt, "decidedAt");
    validDate(input.recordedAt, "recordedAt");
    if (input.recordedAt < input.decidedAt) {
      throw new Error("Administrative evidence cannot be recorded before its decision");
    }
    if (!(await this.administrativeAuthority.authorize(Object.freeze({ ...input })))) {
      throw new Error("Administrative freshness authority denied the decision");
    }
    return this.store.recordAdministrativeBlock(input);
  }
}
