import { createHash } from "node:crypto";
import {
  loadD2DevelopmentContributionDomains,
  loadD2DevelopmentContributionProviders,
} from "@ai-job-apply/config";
import type {
  ContributionCapabilityDecision,
  ContributionCapabilityInput,
  SignedD2ContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  ContributionCapabilityPolicySourceUnavailableError,
  contributionCapabilityPolicySourceFromEnvironment,
} from "./contribution-capability-policy-source.js";

/** Existing signed-policy callers retain their original port and verification requirements. */
export interface SignedContributionCapabilitySource {
  load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null>;
}

export const DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS = 60_000;
function developmentDescriptor<Provider extends ContributionCapabilityInput["provider"]>(
  provider: Provider,
  pageVariant: ContributionCapabilityInput["pageVariant"],
  domains: readonly string[],
) {
  // Property order and the existing Greenhouse dimensions are part of its immutable digest.
  // Adding an enabled provider must not invalidate already prepared Greenhouse operations.
  const dimensions = Object.freeze({
    environment: "development",
    version: `d2-development-${provider}-v1` as const,
    clientVersion: "0.2.0",
    provider,
    pageVariant,
    domains: Object.freeze([...domains]),
    operationLeaseMilliseconds: DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
  });
  return Object.freeze({
    ...dimensions,
    configurationDigestSha256: createHash("sha256")
      .update(JSON.stringify(dimensions))
      .digest("hex"),
  });
}

/** Descriptors are not activation. Each provider still requires an explicit runtime opt-in. */
export const DEVELOPMENT_CONTRIBUTION_CAPABILITIES = Object.freeze({
  greenhouse: developmentDescriptor("greenhouse", "greenhouse-board-v1", [
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
  ]),
  lever: developmentDescriptor("lever", "lever-posting-v1", ["jobs.lever.co", "jobs.eu.lever.co"]),
  ashby: developmentDescriptor("ashby", "ashby-job-board-v1", ["jobs.ashbyhq.com"]),
});
export const DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION =
  DEVELOPMENT_CONTRIBUTION_CAPABILITIES.greenhouse.version;
export const DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST =
  DEVELOPMENT_CONTRIBUTION_CAPABILITIES.greenhouse.configurationDigestSha256;

export function developmentContributionDescriptorForLease(version: string, digest: string) {
  return Object.values(DEVELOPMENT_CONTRIBUTION_CAPABILITIES).find(
    (descriptor) =>
      descriptor.version === version && descriptor.configurationDigestSha256 === digest,
  );
}

type Environment = Readonly<Record<string, string | undefined>>;
export type DevelopmentContributionCapabilityDecision =
  | Exclude<ContributionCapabilityDecision, { allowed: true }>
  | {
      allowed: true;
      policyRevision: string;
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
    loadD2DevelopmentContributionProviders(environment);
    loadD2DevelopmentContributionDomains(environment);
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
    if (input.clientVersion !== "0.2.0") {
      return { allowed: false, reason: "client_disabled" };
    }
    if (!loadD2DevelopmentContributionProviders(this.environment).includes(input.provider)) {
      return { allowed: false, reason: "provider_disabled" };
    }
    const descriptor = DEVELOPMENT_CONTRIBUTION_CAPABILITIES[input.provider];
    if (input.pageVariant !== descriptor.pageVariant) {
      return { allowed: false, reason: "variant_disabled" };
    }
    const selectedDomains = loadD2DevelopmentContributionDomains(this.environment);
    if (
      !descriptor.domains.includes(input.domain) ||
      (selectedDomains !== undefined && !selectedDomains.some((domain) => domain === input.domain))
    ) {
      return { allowed: false, reason: "domain_disabled" };
    }
    return Object.freeze({
      allowed: true,
      policyRevision: descriptor.version,
      configurationDigestSha256: descriptor.configurationDigestSha256,
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
  loadD2DevelopmentContributionProviders(environment);
  loadD2DevelopmentContributionDomains(environment);
  if (developmentEnabled(environment))
    return new DevelopmentContributionCapabilitySource(environment);
  return contributionCapabilityPolicySourceFromEnvironment(environment, now);
}

export function isDevelopmentContributionCapabilitySource(
  source: ContributionCapabilitySource,
): source is DevelopmentContributionCapabilitySource {
  return source instanceof DevelopmentContributionCapabilitySource;
}
