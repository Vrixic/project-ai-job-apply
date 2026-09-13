import { createHash } from "node:crypto";
import type { JobContributionInput } from "./contribution.js";
import { isSafeContributionDescription } from "./contribution-description.js";

export const contributionProcessingProviders = ["greenhouse", "lever", "ashby"] as const;
export type ContributionProcessingProvider = (typeof contributionProcessingProviders)[number];

export const contributionProcessingPageVariants = [
  "greenhouse-board-v1",
  "lever-posting-v1",
  "ashby-job-board-v1",
] as const;
export type ContributionProcessingPageVariant = (typeof contributionProcessingPageVariants)[number];

export interface ContributionProviderProvenance {
  provider: ContributionProcessingProvider;
  pageVariant: ContributionProcessingPageVariant;
  canonicalSourceUrl: string;
  canonicalSourceUrlSha256: string;
  atsTenant: string;
  externalJobId?: string;
  adapterVersion: string;
  contributedContentSha256: string;
  observedAt: string;
}

export interface ContributionDedupeProposal {
  exactIdentityKeys: readonly string[];
  fuzzyFingerprintSha256: string;
}

export interface NormalizedContributionProposal {
  schemaVersion: 1;
  normalizedCompanyName?: string;
  normalizedTitle: string;
  normalizedLocations: readonly string[];
  normalizedDescriptionSha256?: string;
  normalizedDepartment?: string;
  applicationUrlSha256?: string;
  employmentType?: "full_time" | "part_time" | "contract" | "internship" | "unknown";
  workMode?: "remote" | "hybrid" | "on_site" | "unknown";
  provenance: ContributionProviderProvenance;
  dedupe: ContributionDedupeProposal;
  proposalSha256: string;
}

const providerBoundaries: Readonly<
  Record<
    ContributionProcessingProvider,
    { pageVariant: ContributionProcessingPageVariant; hosts: readonly string[] }
  >
> = Object.freeze({
  greenhouse: Object.freeze({
    pageVariant: "greenhouse-board-v1",
    hosts: Object.freeze(["boards.greenhouse.io", "job-boards.greenhouse.io"]),
  }),
  lever: Object.freeze({
    pageVariant: "lever-posting-v1",
    hosts: Object.freeze(["jobs.lever.co", "jobs.eu.lever.co"]),
  }),
  ashby: Object.freeze({
    pageVariant: "ashby-job-board-v1",
    hosts: Object.freeze(["jobs.ashbyhq.com"]),
  }),
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ADAPTER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const UNSAFE_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: page-controlled controls and bidi overrides are rejected.
  /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function boundedNormalizedText(
  value: string | undefined,
  maximum: number,
  required: boolean,
  isSafeText = (text: string) => !UNSAFE_TEXT.test(text),
): string | undefined {
  if (value === undefined) {
    if (required) throw new TypeError("The contribution is missing a required normalized field");
    return undefined;
  }
  if (value !== value.trim() || value.length < 1 || value.length > maximum || !isSafeText(value)) {
    throw new TypeError("The contribution contains an invalid normalized field");
  }
  const result = normalize(value);
  if (!result || result.length > maximum) {
    throw new TypeError("The contribution contains an invalid normalized field");
  }
  return result;
}

function exactTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError("The contribution observation timestamp is invalid");
  }
  return value;
}

function exactProviderProvenance(input: JobContributionInput): ContributionProviderProvenance {
  if (
    !contributionProcessingProviders.includes(input.source.provider) ||
    !contributionProcessingPageVariants.includes(input.source.pageVariant) ||
    !SHA256_PATTERN.test(input.observation.contentSha256) ||
    !ADAPTER_VERSION_PATTERN.test(input.source.adapterVersion)
  ) {
    throw new TypeError("The contribution provider provenance is invalid");
  }
  let url: URL;
  try {
    url = new URL(input.source.sourceUrl);
  } catch {
    throw new TypeError("The contribution provider provenance is invalid");
  }
  const boundary = providerBoundaries[input.source.provider];
  const pathParts = url.pathname.split("/").filter(Boolean);
  const exactPath =
    input.source.provider === "greenhouse"
      ? pathParts.length === 3 && pathParts[1] === "jobs"
      : pathParts.length === 2;
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.toString() !== input.source.sourceUrl ||
    input.source.sourceUrl.length > 4_096 ||
    !boundary.hosts.includes(url.hostname) ||
    boundary.pageVariant !== input.source.pageVariant ||
    input.source.adapterVersion !== "d2-job-page-v1" ||
    !exactPath ||
    pathParts.some((part) => !/^[A-Za-z0-9._~-]+$/u.test(part))
  ) {
    throw new TypeError("The contribution provider provenance is invalid");
  }
  const tenant = pathParts[0];
  if (!tenant) throw new TypeError("The contribution provider provenance is invalid");
  const externalJobId = input.source.externalJobId;
  if (
    externalJobId !== undefined &&
    (externalJobId !== externalJobId.trim() ||
      externalJobId.length < 1 ||
      externalJobId.length > 200 ||
      UNSAFE_TEXT.test(externalJobId))
  ) {
    throw new TypeError("The contribution provider provenance is invalid");
  }
  return Object.freeze({
    provider: input.source.provider,
    pageVariant: input.source.pageVariant,
    canonicalSourceUrl: input.source.sourceUrl,
    canonicalSourceUrlSha256: sha256(input.source.sourceUrl),
    atsTenant: normalize(tenant),
    ...(externalJobId ? { externalJobId: normalize(externalJobId) } : {}),
    adapterVersion: input.source.adapterVersion,
    contributedContentSha256: input.observation.contentSha256,
    observedAt: exactTimestamp(input.observation.observedAt),
  });
}

/**
 * Produces an internal proposal only. It is never provider evidence and cannot authorize catalog
 * publication or advance a source verification clock.
 */
export function normalizeContributionForProcessing(
  input: JobContributionInput,
): NormalizedContributionProposal {
  if (input.schemaVersion !== 1) throw new TypeError("The contribution schema version is invalid");
  const provenance = exactProviderProvenance(input);
  const normalizedTitle = boundedNormalizedText(input.posting.title, 240, true);
  if (!normalizedTitle) throw new TypeError("The contribution title is invalid");
  const normalizedCompanyName = boundedNormalizedText(input.posting.companyName, 200, false);
  const normalizedDepartment = boundedNormalizedText(input.posting.department, 200, false);
  const normalizedDescription = boundedNormalizedText(
    input.posting.description,
    50_000,
    false,
    isSafeContributionDescription,
  );
  const normalizedLocations = Object.freeze(
    [
      ...new Set(
        (input.posting.locations ?? []).map((location) => {
          const normalized = boundedNormalizedText(location, 240, true);
          if (!normalized) throw new TypeError("The contribution location is invalid");
          return normalized;
        }),
      ),
    ].sort(),
  );
  if (normalizedLocations.length > 20) {
    throw new TypeError("The contribution contains too many locations");
  }
  const exactIdentityKeys = [
    ...(provenance.externalJobId
      ? [`ats:${provenance.provider}:${provenance.atsTenant}:${provenance.externalJobId}`]
      : []),
    `url:${provenance.canonicalSourceUrlSha256}`,
  ];
  const normalizedDescriptionSha256 = normalizedDescription
    ? sha256(normalizedDescription)
    : undefined;
  const applicationUrlSha256 = input.posting.applicationUrl
    ? sha256(input.posting.applicationUrl)
    : undefined;
  const fuzzyFingerprintSha256 = sha256(
    JSON.stringify({
      company: normalizedCompanyName ?? "",
      title: normalizedTitle,
      locations: normalizedLocations,
      department: normalizedDepartment ?? "",
      descriptionSha256: normalizedDescriptionSha256 ?? "",
    }),
  );
  const proposalWithoutDigest = {
    schemaVersion: 1 as const,
    ...(normalizedCompanyName ? { normalizedCompanyName } : {}),
    normalizedTitle,
    normalizedLocations,
    ...(normalizedDescriptionSha256 ? { normalizedDescriptionSha256 } : {}),
    ...(normalizedDepartment ? { normalizedDepartment } : {}),
    ...(applicationUrlSha256 ? { applicationUrlSha256 } : {}),
    ...(input.posting.employmentType ? { employmentType: input.posting.employmentType } : {}),
    ...(input.posting.workMode ? { workMode: input.posting.workMode } : {}),
    provenance,
    dedupe: Object.freeze({
      exactIdentityKeys: Object.freeze(exactIdentityKeys),
      fuzzyFingerprintSha256,
    }),
  };
  return Object.freeze({
    ...proposalWithoutDigest,
    proposalSha256: sha256(JSON.stringify(proposalWithoutDigest)),
  });
}
