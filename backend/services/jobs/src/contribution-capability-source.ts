import { createHash } from "node:crypto";
import type {
  ContributionCapabilityDecision,
  ContributionCapabilityInput,
  SignedD2ContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  contributionCapabilityPolicySourceFromEnvironment,
  ContributionCapabilityPolicySourceUnavailableError,
} from "./contribution-capability-policy-source.js";

/** Existing signed-policy callers retain their original port and verification requirements. */
export interface SignedContributionCapabilitySource {
  load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null>;
}

export const DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION = "d2-development-greenhouse-v1";
export const DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS = 60_000;
const developmentDimensions = Object.freeze({
  environment: "development",
  version: DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION,
  clientVersion: "0.2.0",
  provider: "greenhouse",
  pageVariant: "greenhouse-board-v1",
  domains: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  operationLeaseMilliseconds: DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
});
export const DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST = createHash("sha256")
  .update(JSON.stringify(developmentDimensions))
  .digest("hex");

type Environment = Readonly<Record<string, string | undefined>>;
export type DevelopmentContributionCapabilityDecision =
  | Exclude<ContributionCapabilityDecision, { allowed: true }>
  | {
      allowed: true;
      policyRevision: typeof DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION;
      configurationDigestSha256: string;
      evaluatedAt: string;
      expiresAt: string;
    };

function developmentEnabled(environment: Environment): boolean {
  const value = environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED;
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new ContributionCapabilityPolicySourceUnavailableError();
  }
  if (value !== "true") return false;
  if (environment.D2_DEPLOYMENT_ENVIRONMENT !== "development") {
    throw new ContributionCapabilityPolicySourceUnavailableError();
  }
  return true;
}

/**
 * Explicit development-only authority, not a signed policy or a clock-expiry bypass.
 * The short lease fences one publication operation; a retry evaluates current authority again.
 */
export class DevelopmentContributionCapabilitySource {
  readonly mode = "development";

  constructor(private readonly environment: Environment) {
    if (!developmentEnabled(environment)) {
      throw new ContributionCapabilityPolicySourceUnavailableError();
    }
  }

  async authorize(
    input: ContributionCapabilityInput,
  ): Promise<DevelopmentContributionCapabilityDecision> {
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
      throw new ContributionCapabilityPolicySourceUnavailableError();
    }
    if (
      !developmentEnabled(this.environment) ||
      (input.stage === "intake"
        ? this.environment.D2_CONTRIBUTION_ROUTES_ENABLED !== "true"
        : this.environment.D2_COMMUNITY_RUNTIME_ENABLED !== "true")
    ) {
      return { allowed: false, reason: "global_disabled" };
    }
    if (input.clientVersion !== developmentDimensions.clientVersion) {
      return { allowed: false, reason: "client_disabled" };
    }
    if (input.provider !== developmentDimensions.provider) {
      return { allowed: false, reason: "provider_disabled" };
    }
    if (input.pageVariant !== developmentDimensions.pageVariant) {
      return { allowed: false, reason: "variant_disabled" };
    }
    if (!developmentDimensions.domains.includes(input.domain)) {
      return { allowed: false, reason: "domain_disabled" };
    }
    return Object.freeze({
      allowed: true,
      policyRevision: DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION,
      configurationDigestSha256: DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
      evaluatedAt: input.now.toISOString(),
      expiresAt: new Date(
        input.now.getTime() + DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
      ).toISOString(),
    });
  }
}

export type ContributionCapabilitySource =
  | SignedContributionCapabilitySource
  | DevelopmentContributionCapabilitySource;

export function contributionCapabilitySourceFromEnvironment(
  environment: Environment,
  now: () => Date,
): ContributionCapabilitySource | null {
  if (developmentEnabled(environment))
    return new DevelopmentContributionCapabilitySource(environment);
  return contributionCapabilityPolicySourceFromEnvironment(environment, now);
}

export function isDevelopmentContributionCapabilitySource(
  source: ContributionCapabilitySource,
): source is DevelopmentContributionCapabilitySource {
  return source instanceof DevelopmentContributionCapabilitySource;
}
