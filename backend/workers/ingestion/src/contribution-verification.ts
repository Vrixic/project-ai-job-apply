import { createHash } from "node:crypto";
import {
  type CatalogObservation,
  canonicalizeJobUrl,
  canonicalizeObservation,
  type IndependentProviderVerificationPort,
  type IndependentProviderVerificationResult,
  type NormalizedContributionProposal,
  normalizeText,
} from "@ai-job-apply/jobs-service";
import { v7 as uuidv7 } from "uuid";
import type { SourceRegistration } from "./contract.js";
import { legacyPreviewDescription } from "./page-preview-compatibility.js";
import type { SourceRegistry } from "./registry.js";
import {
  canonicalizeRegisteredSourceObservation,
  canonicalizeRegisteredSourceWithdrawal,
} from "./runner.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const pageVariantByProvider = Object.freeze({
  greenhouse: "greenhouse-board-v1",
  lever: "lever-posting-v1",
  ashby: "ashby-job-board-v1",
} as const);

export interface IndependentProviderVerificationRegistration {
  sourceId: string;
  provider: keyof typeof pageVariantByProvider;
  pageVariant: (typeof pageVariantByProvider)[keyof typeof pageVariantByProvider];
  atsTenant: string;
  sourcePolicyVersion: string;
}

export interface IndependentProviderVerifierOptions {
  clock?: () => Date;
  createId?: () => string;
  onContentMismatch?: (metrics: Readonly<Record<string, number>>) => void;
}

export interface ExactProviderCatalogIdentity {
  jobId: string;
  sourceId: string;
}

/** Read-only exact lookup. Implementations must not record observations or advance freshness. */
export interface IndependentVerificationCatalogIdentityPort {
  findExact(input: {
    provider: keyof typeof pageVariantByProvider;
    atsTenant: string;
    externalJobId: string;
    canonicalSourceUrl: string;
  }): Promise<readonly ExactProviderCatalogIdentity[]>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resultBase(contributionId: string, proposal: NormalizedContributionProposal) {
  return {
    contributionId,
    provider: proposal.provenance.provider,
    pageVariant: proposal.provenance.pageVariant,
    canonicalSourceUrlSha256: proposal.provenance.canonicalSourceUrlSha256,
  } as const;
}

function registeredSource(
  registry: SourceRegistry,
  config: IndependentProviderVerificationRegistration,
): Readonly<SourceRegistration> {
  if (
    !POLICY_VERSION.test(config.sourcePolicyVersion) ||
    pageVariantByProvider[config.provider] !== config.pageVariant ||
    !config.atsTenant ||
    config.atsTenant !== normalizeText(config.atsTenant)
  ) {
    throw new TypeError("The independent verification registration is invalid");
  }
  const registration = registry.requireEnabled(config.sourceId);
  if (registration.provider !== config.provider || registration.provenance !== "permitted_api") {
    throw new TypeError(
      "The independent verification source registration does not match its policy",
    );
  }
  return registration;
}

function providerContent(observation: CatalogObservation) {
  // The v1 page inspector separates exact location prefixes for presentation.
  // Compare that equivalent representation without rewriting provider evidence.
  const separated = observation.locations.map((location) => {
    const combined = normalizeText(location).match(
      /^(remote|hybrid|on[\s_-]?site)\s*(?:[-–—|·]|,)\s*(\S.*)$/iu,
    );
    const prefix = combined?.[1]?.replace(/[\s_-]/gu, "");
    const workMode =
      prefix === "remote"
        ? "remote"
        : prefix === "hybrid"
          ? "hybrid"
          : prefix === "onsite"
            ? "on_site"
            : undefined;
    return { location: normalizeText(combined?.[2] ?? location), workMode };
  });
  const prefixModes = new Set(separated.map((item) => item.workMode));
  const prefixMode = prefixModes.size === 1 ? separated[0]?.workMode : undefined;
  return {
    companyName: normalizeText(observation.companyName),
    title: normalizeText(observation.title),
    locations: [...new Set(observation.locations.map(normalizeText))].sort(),
    separatedLocations: [...new Set(separated.map((item) => item.location))].sort(),
    department: observation.department ? normalizeText(observation.department) : undefined,
    applicationUrlSha256: observation.applicationUrl
      ? sha256(canonicalizeJobUrl(observation.applicationUrl))
      : undefined,
    employmentType: observation.employmentType,
    workMode: observation.workMode ?? prefixMode,
  };
}

function descriptionDigests(observation: CatalogObservation, legacy: boolean): ReadonlySet<string> {
  const values = [normalizeText(observation.description)];
  if (legacy) {
    values.push(normalizeText(legacyPreviewDescription(observation.description)));
    const firstLine = observation.description.split(/\r?\n/u).find((line) => line.trim());
    const heading = firstLine ? normalizeText(firstLine) : "";
    const full = normalizeText(observation.description);
    if (heading.length > 0 && heading.length <= 200 && full.startsWith(`${heading} ${heading} `)) {
      const deduplicated = full.slice(heading.length + 1);
      values.push(deduplicated, normalizeText(legacyPreviewDescription(deduplicated)));
    }
  }
  return new Set(values.map(sha256));
}

function contentMismatchMetrics(
  proposal: NormalizedContributionProposal,
  observation: CatalogObservation,
  pageDescriptionDigests: readonly string[] = [],
) {
  const truth = providerContent(observation);
  const legacy = proposal.provenance.adapterVersion === "d2-job-page-v1";
  const companyNames = new Set([truth.companyName]);
  if (legacy) {
    // The installed v1 reader also used a provider logo's accessible label as its fallback.
    companyNames.add(`${truth.companyName} logo`);
    companyNames.add(`${truth.companyName} company logo`);
  }
  return Object.freeze({
    VerificationMismatchTitle: Number(proposal.normalizedTitle !== truth.title),
    VerificationMismatchCompany: Number(
      proposal.normalizedCompanyName !== undefined &&
        !companyNames.has(proposal.normalizedCompanyName),
    ),
    VerificationMismatchLocation: Number(
      proposal.normalizedLocations.length !== 0 &&
        JSON.stringify(proposal.normalizedLocations) !== JSON.stringify(truth.locations) &&
        JSON.stringify(proposal.normalizedLocations) !== JSON.stringify(truth.separatedLocations),
    ),
    VerificationMismatchDescription: Number(
      proposal.normalizedDescriptionSha256 !== undefined &&
        !descriptionDigests(observation, legacy).has(proposal.normalizedDescriptionSha256) &&
        !pageDescriptionDigests.includes(proposal.normalizedDescriptionSha256),
    ),
    VerificationMismatchDepartment: Number(
      proposal.normalizedDepartment !== undefined &&
        proposal.normalizedDepartment !== truth.department,
    ),
    VerificationMismatchApplicationUrl: Number(
      proposal.applicationUrlSha256 !== undefined &&
        proposal.applicationUrlSha256 !== truth.applicationUrlSha256,
    ),
    VerificationMismatchEmploymentType: Number(
      proposal.employmentType !== undefined && proposal.employmentType !== truth.employmentType,
    ),
    VerificationMismatchWorkMode: Number(
      proposal.workMode !== undefined && proposal.workMode !== truth.workMode,
    ),
  });
}

/**
 * Independently re-fetches provider truth. Empty configuration is intentionally dark. This
 * adapter never writes catalog freshness and returns only identifiers and digests.
 */
export class RegisteredIndependentProviderVerifier implements IndependentProviderVerificationPort {
  readonly #configs = new Map<string, IndependentProviderVerificationRegistration>();
  readonly #clock: () => Date;
  readonly #createId: () => string;
  readonly #onContentMismatch: IndependentProviderVerifierOptions["onContentMismatch"];

  constructor(
    private readonly registry: SourceRegistry,
    private readonly catalogIdentities: IndependentVerificationCatalogIdentityPort,
    configurations: readonly IndependentProviderVerificationRegistration[] = [],
    options: IndependentProviderVerifierOptions = {},
  ) {
    if (configurations.length > 100) throw new TypeError("Too many verification registrations");
    this.#clock = options.clock ?? (() => new Date());
    this.#createId = options.createId ?? uuidv7;
    this.#onContentMismatch = options.onContentMismatch;
    for (const configuration of configurations) {
      registeredSource(registry, configuration);
      const key = `${configuration.provider}:${configuration.atsTenant}`;
      if (this.#configs.has(key)) throw new TypeError("Verification registrations must be unique");
      this.#configs.set(key, Object.freeze({ ...configuration }));
    }
  }

  async verify(input: {
    contributionId: string;
    normalizationId: string;
    proposal: NormalizedContributionProposal;
  }): Promise<IndependentProviderVerificationResult> {
    const { proposal } = input;
    const base = resultBase(input.contributionId, proposal);
    if (!UUID_V7.test(input.contributionId) || !UUID_V7.test(input.normalizationId)) {
      return { status: "unavailable", ...base };
    }
    const config = this.#configs.get(
      `${proposal.provenance.provider}:${proposal.provenance.atsTenant}`,
    );
    if (
      !config ||
      config.pageVariant !== proposal.provenance.pageVariant ||
      !proposal.provenance.externalJobId
    ) {
      return { status: "unavailable", ...base };
    }

    let registration: Readonly<SourceRegistration>;
    let observedAt: Date;
    try {
      registration = registeredSource(this.registry, config);
      observedAt = this.#clock();
      if (!Number.isFinite(observedAt.getTime())) throw new TypeError("Invalid verification clock");
      const pollContext = {
        observedAt: new Date(observedAt),
        attempt: 1,
        signal: new AbortController().signal,
      };
      const response = registration.adapter.pollExact
        ? await registration.adapter.pollExact({
            ...pollContext,
            externalJobId: proposal.provenance.externalJobId,
          })
        : await registration.adapter.poll(pollContext);
      if (response.kind !== "success") return { status: "unavailable", ...base };

      for (const withdrawal of response.withdrawals ?? []) {
        const canonical = canonicalizeRegisteredSourceWithdrawal(
          withdrawal,
          registration,
          observedAt,
        );
        if (
          canonical.sourceUrl === proposal.provenance.canonicalSourceUrl &&
          normalizeText(canonical.atsTenant) === proposal.provenance.atsTenant &&
          normalizeText(canonical.externalJobId) === proposal.provenance.externalJobId
        )
          return { status: "closed", ...base };
      }

      for (const source of response.observations) {
        const observation = canonicalizeRegisteredSourceObservation(
          source,
          registration,
          observedAt,
        );
        if (
          observation.sourceUrl !== proposal.provenance.canonicalSourceUrl ||
          normalizeText(observation.atsTenant ?? "") !== proposal.provenance.atsTenant ||
          normalizeText(observation.externalJobId ?? "") !== proposal.provenance.externalJobId
        )
          continue;
        const previewDigests =
          registration.provider === "greenhouse" &&
          proposal.provenance.adapterVersion === "d2-job-page-v1"
            ? (registration.adapter.pagePreviewDescriptionDigests?.(
                source,
                proposal.provenance.adapterVersion,
              ) ?? [])
            : [];
        if (
          !Array.isArray(previewDigests) ||
          previewDigests.length > 4 ||
          previewDigests.some(
            (value) => typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value),
          )
        ) {
          return { status: "unavailable", ...base };
        }
        const mismatches = contentMismatchMetrics(proposal, observation, previewDigests);
        if (Object.values(mismatches).some((count) => count !== 0)) {
          try {
            this.#onContentMismatch?.(mismatches);
          } catch {
            // Diagnostics cannot change the verification disposition or expose driver errors.
          }
          return { status: "mismatch", ...base };
        }

        const identities = await this.catalogIdentities.findExact({
          provider: config.provider,
          atsTenant: proposal.provenance.atsTenant,
          externalJobId: proposal.provenance.externalJobId,
          canonicalSourceUrl: proposal.provenance.canonicalSourceUrl,
        });
        if (!Array.isArray(identities) || identities.length > 1) {
          return { status: "unavailable", ...base };
        }
        const identity = identities[0];
        const verificationId = this.#createId();
        if (
          !UUID_V7.test(verificationId) ||
          (identity && ![identity.jobId, identity.sourceId].every((id) => UUID_V7.test(id)))
        ) {
          return { status: "unavailable", ...base };
        }
        const { rawSnapshot: _discardedRawSnapshot, ...normalizedProviderObservation } =
          observation;
        const providerObservation = Object.freeze(normalizedProviderObservation);
        const verifiedContentSha256 = canonicalizeObservation(providerObservation).contentHash;
        const verifiedAt = observedAt.toISOString();
        const evidenceDigestSha256 = sha256(
          JSON.stringify({
            contributionId: input.contributionId,
            normalizationId: input.normalizationId,
            verificationId,
            jobId: identity?.jobId ?? null,
            sourceId: identity?.sourceId ?? null,
            provider: config.provider,
            pageVariant: config.pageVariant,
            canonicalSourceUrlSha256: proposal.provenance.canonicalSourceUrlSha256,
            verifiedContentSha256,
            sourcePolicyVersion: config.sourcePolicyVersion,
            verifiedAt,
          }),
        );
        return {
          status: "verified",
          origin: "independent_provider_fetch",
          ...base,
          verificationId,
          ...(identity ? { jobId: identity.jobId, sourceId: identity.sourceId } : {}),
          providerObservation,
          evidenceDigestSha256,
          verifiedContentSha256,
          sourcePolicyVersion: config.sourcePolicyVersion,
          verifiedAt,
        };
      }
      return { status: "unavailable", ...base };
    } catch {
      return { status: "unavailable", ...base };
    }
  }
}
