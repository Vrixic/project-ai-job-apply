import type { JobStatus } from "./domain/canonical-job.js";

export type D2Provider = "greenhouse" | "lever" | "ashby";
export type D2PageVariant = "greenhouse-board-v1" | "lever-posting-v1" | "ashby-job-board-v1";

export interface SourceFreshnessPolicy {
  provider: D2Provider;
  pageVariant: D2PageVariant;
  policyVersion: string;
  suspectAfterHours: number;
  expiresAfterHours: number;
}

export interface FreshnessPolicyKey {
  provider: D2Provider;
  pageVariant: D2PageVariant;
}

export type FreshnessSignal =
  | { kind: "community_observation"; observedAt: Date }
  | { kind: "candidate_closed_report"; observedAt: Date }
  | {
      kind: "independent_positive_verification";
      verifiedAt: Date;
      validThrough?: Date;
    }
  | { kind: "independent_closed_verification"; verifiedAt: Date }
  | { kind: "authorized_administrative_block"; decidedAt: Date };

export interface FreshnessState {
  status: JobStatus;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

export interface FreshnessPlan extends FreshnessState {
  transitionReason:
    | "none"
    | "policy_suspect_window_elapsed"
    | "policy_expiry_window_elapsed"
    | "independent_positive_verification"
    | "independent_closed_verification"
    | "authorized_administrative_block";
  revalidationPriority: "none" | "normal" | "high";
  verificationClockAdvanced: boolean;
}

const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const HOURS_TO_MILLISECONDS = 60 * 60 * 1_000;

const expectedVariant = {
  greenhouse: "greenhouse-board-v1",
  lever: "lever-posting-v1",
  ashby: "ashby-job-board-v1",
} as const satisfies Record<D2Provider, D2PageVariant>;

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid date`);
  }
}

function assertPolicy(policy: SourceFreshnessPolicy): void {
  if (expectedVariant[policy.provider] !== policy.pageVariant) {
    throw new Error("The source freshness provider and page variant do not match");
  }
  if (!POLICY_VERSION_PATTERN.test(policy.policyVersion)) {
    throw new Error("The source freshness policy version is invalid");
  }
  if (
    !Number.isInteger(policy.suspectAfterHours) ||
    !Number.isInteger(policy.expiresAfterHours) ||
    policy.suspectAfterHours < 1 ||
    policy.expiresAfterHours > 24 * 365 ||
    policy.suspectAfterHours >= policy.expiresAfterHours
  ) {
    throw new Error("The source freshness timing policy is invalid");
  }
}

function keyOf(key: FreshnessPolicyKey): string {
  return `${key.provider}:${key.pageVariant}`;
}

function clonePolicy(policy: SourceFreshnessPolicy): SourceFreshnessPolicy {
  return { ...policy };
}

export class SourceFreshnessPolicyRegistry {
  private readonly policies: ReadonlyMap<string, SourceFreshnessPolicy>;

  constructor(policies: readonly SourceFreshnessPolicy[]) {
    const entries = new Map<string, SourceFreshnessPolicy>();
    for (const policy of policies) {
      assertPolicy(policy);
      const key = keyOf(policy);
      if (entries.has(key)) {
        throw new Error("A source freshness policy is duplicated");
      }
      entries.set(key, clonePolicy(policy));
    }
    this.policies = entries;
  }

  resolve(key: FreshnessPolicyKey): SourceFreshnessPolicy | null {
    const policy = this.policies.get(keyOf(key));
    return policy ? clonePolicy(policy) : null;
  }

  require(key: FreshnessPolicyKey): SourceFreshnessPolicy {
    const policy = this.resolve(key);
    if (!policy) {
      throw new Error("The source freshness policy is disabled for this provider variant");
    }
    return policy;
  }
}

function latestExpiry(verifiedAt: Date, policy: SourceFreshnessPolicy, validThrough?: Date): Date {
  const policyExpiry = new Date(
    verifiedAt.getTime() + policy.expiresAfterHours * HOURS_TO_MILLISECONDS,
  );
  if (!validThrough) return policyExpiry;
  assertDate(validThrough, "validThrough");
  return validThrough > policyExpiry ? new Date(validThrough) : policyExpiry;
}

function noClockChange(
  state: FreshnessState,
  revalidationPriority: FreshnessPlan["revalidationPriority"],
): FreshnessPlan {
  return {
    status: state.status,
    lastVerifiedAt: new Date(state.lastVerifiedAt),
    expiresAt: new Date(state.expiresAt),
    transitionReason: "none",
    revalidationPriority,
    verificationClockAdvanced: false,
  };
}

export function planFreshnessSignal(
  state: FreshnessState,
  signal: FreshnessSignal,
  policy: SourceFreshnessPolicy,
): FreshnessPlan {
  assertPolicy(policy);
  assertDate(state.lastVerifiedAt, "lastVerifiedAt");
  assertDate(state.expiresAt, "expiresAt");
  if (state.expiresAt < state.lastVerifiedAt) {
    throw new Error("The freshness state chronology is invalid");
  }

  if (signal.kind === "community_observation") {
    assertDate(signal.observedAt, "observedAt");
    return noClockChange(state, "normal");
  }
  if (signal.kind === "candidate_closed_report") {
    assertDate(signal.observedAt, "observedAt");
    return noClockChange(state, "high");
  }
  if (signal.kind === "authorized_administrative_block") {
    assertDate(signal.decidedAt, "decidedAt");
    return {
      status: "blocked",
      lastVerifiedAt: new Date(state.lastVerifiedAt),
      expiresAt: new Date(state.expiresAt),
      transitionReason: "authorized_administrative_block",
      revalidationPriority: "none",
      verificationClockAdvanced: false,
    };
  }

  assertDate(signal.verifiedAt, "verifiedAt");
  if (signal.verifiedAt < state.lastVerifiedAt) {
    throw new Error("The independent verification is stale");
  }
  if (signal.kind === "independent_closed_verification") {
    return {
      status: "withdrawn",
      lastVerifiedAt: new Date(signal.verifiedAt),
      expiresAt: new Date(state.expiresAt),
      transitionReason: "independent_closed_verification",
      revalidationPriority: "none",
      verificationClockAdvanced: true,
    };
  }
  if (state.status === "blocked") {
    throw new Error("A positive source verification cannot reverse an administrative block");
  }
  return {
    status: "active",
    lastVerifiedAt: new Date(signal.verifiedAt),
    expiresAt: latestExpiry(signal.verifiedAt, policy, signal.validThrough),
    transitionReason: "independent_positive_verification",
    revalidationPriority: "none",
    verificationClockAdvanced: true,
  };
}

export function planFreshnessClock(
  state: FreshnessState,
  now: Date,
  policy: SourceFreshnessPolicy,
): FreshnessPlan {
  assertPolicy(policy);
  assertDate(now, "now");
  assertDate(state.lastVerifiedAt, "lastVerifiedAt");
  assertDate(state.expiresAt, "expiresAt");
  if (state.expiresAt < state.lastVerifiedAt) {
    throw new Error("The freshness state chronology is invalid");
  }
  if (["expired", "withdrawn", "blocked"].includes(state.status)) {
    return noClockChange(state, "none");
  }
  if (now >= state.expiresAt) {
    return {
      status: "expired",
      lastVerifiedAt: new Date(state.lastVerifiedAt),
      expiresAt: new Date(state.expiresAt),
      transitionReason: "policy_expiry_window_elapsed",
      revalidationPriority: "none",
      verificationClockAdvanced: false,
    };
  }
  const suspectAt = new Date(
    state.lastVerifiedAt.getTime() + policy.suspectAfterHours * HOURS_TO_MILLISECONDS,
  );
  if (now >= suspectAt && state.status !== "suspect_stale") {
    return {
      status: "suspect_stale",
      lastVerifiedAt: new Date(state.lastVerifiedAt),
      expiresAt: new Date(state.expiresAt),
      transitionReason: "policy_suspect_window_elapsed",
      revalidationPriority: "high",
      verificationClockAdvanced: false,
    };
  }
  return noClockChange(state, state.status === "suspect_stale" ? "high" : "none");
}
