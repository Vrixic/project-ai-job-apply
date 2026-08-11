import { createHash } from "node:crypto";

export const defaultFreshnessDays = 30;
export const suspectStaleFailureThreshold = 3;

export type JobStatus =
  | "pending"
  | "active"
  | "suspect_stale"
  | "expired"
  | "withdrawn"
  | "blocked";

export type JobSourceProvider = "greenhouse" | "lever" | "ashby" | "workday" | "ugc" | "other";

export type JobProvenance = "permitted_api" | "authorized_fixture" | "explicit_ugc";
export type DuplicateClassification = "exact" | "probable" | "related_repost" | "not_duplicate";

export interface JobObservation {
  provider: JobSourceProvider;
  provenance: JobProvenance;
  companyName: string;
  title: string;
  locations: string[];
  description: string;
  sourceUrl: string;
  observedAt: Date;
  atsTenant?: string;
  externalJobId?: string;
  employerRequisitionId?: string;
  verifiedCompanyDomain?: string;
  department?: string;
  validThrough?: Date;
  adapterVersion?: string;
}

export interface CanonicalObservation extends JobObservation {
  normalizedCompanyName: string;
  normalizedTitle: string;
  normalizedLocations: string[];
  normalizedDepartment?: string;
  canonicalUrl: string;
  canonicalUrlHash: string;
  contentHash: string;
  fuzzyFingerprint: string;
  expiresAt: Date;
}

export interface LifecycleInput {
  currentStatus: JobStatus;
  now: Date;
  expiresAt: Date;
  positiveVerification?: boolean;
  explicitlyWithdrawn?: boolean;
  blocked?: boolean;
  consecutiveVerificationFailures?: number;
}

export interface JobTombstoneInput {
  id: string;
  companyId: string;
  title: string;
  locations: string[];
  status: "expired" | "withdrawn" | "blocked";
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  sourceReferences: string[];
  reason: string;
}

const trackingParameters = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
]);
const sensitiveParameters = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "key",
  "password",
  "secret",
  "session",
  "signature",
  "token",
]);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function normalizeDomain(value: string): string {
  const withoutProtocol = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\//, "");
  const host = withoutProtocol.split("/")[0]?.replace(/\.$/, "") ?? "";
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host)) {
    throw new Error("verifiedCompanyDomain must be a valid lowercase hostname");
  }
  return host;
}

export function canonicalizeJobUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Job source URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Job source URL must not contain credentials");
  }

  url.protocol = "https:";
  url.hostname = url.hostname.toLocaleLowerCase("en-US");
  url.hash = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  const retained = [...url.searchParams.entries()]
    .filter(([name]) => {
      const normalizedName = name.toLocaleLowerCase("en-US");
      return (
        !normalizedName.startsWith("utm_") &&
        !trackingParameters.has(normalizedName) &&
        !sensitiveParameters.has(normalizedName)
      );
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      `${leftName}=${leftValue}`.localeCompare(`${rightName}=${rightValue}`),
    );
  url.search = "";
  for (const [name, parameterValue] of retained) {
    url.searchParams.append(name, parameterValue);
  }
  return url.toString();
}

export function exactIdentityKeys(observation: CanonicalObservation): string[] {
  const keys: string[] = [];
  if (observation.atsTenant && observation.externalJobId) {
    keys.push(
      `ats:${observation.provider}:${normalizeText(observation.atsTenant)}:${normalizeText(observation.externalJobId)}`,
    );
  }
  if (observation.employerRequisitionId && observation.verifiedCompanyDomain) {
    keys.push(
      `requisition:${normalizeDomain(observation.verifiedCompanyDomain)}:${normalizeText(observation.employerRequisitionId)}`,
    );
  }
  keys.push(`url:${observation.canonicalUrlHash}`);
  return keys;
}

export function canonicalizeObservation(observation: JobObservation): CanonicalObservation {
  if (!Number.isFinite(observation.observedAt.getTime())) {
    throw new Error("observedAt must be a valid date");
  }
  if (observation.validThrough && !Number.isFinite(observation.validThrough.getTime())) {
    throw new Error("validThrough must be a valid date");
  }
  if (observation.title.length > 240 || observation.description.length > 200_000) {
    throw new Error("Job title or description exceeds the canonical contract limit");
  }
  if (observation.locations.length === 0 || observation.locations.length > 20) {
    throw new Error("A job must have between one and twenty locations");
  }
  if (observation.sourceUrl.length > 4_096) {
    throw new Error("Job source URL exceeds the supported limit");
  }
  const normalizedCompanyName = normalizeText(observation.companyName);
  const normalizedTitle = normalizeText(observation.title);
  const normalizedLocations = [...new Set(observation.locations.map(normalizeText))].sort();
  const normalizedDescription = normalizeText(observation.description);
  if (!normalizedCompanyName || !normalizedTitle || !normalizedDescription) {
    throw new Error("Company, title, and description are required");
  }
  if (normalizedLocations.some((location) => !location || location.length > 240)) {
    throw new Error("At least one non-empty location is required");
  }

  const canonicalUrl = canonicalizeJobUrl(observation.sourceUrl);
  const normalizedDepartment = observation.department
    ? normalizeText(observation.department)
    : undefined;
  const verifiedCompanyDomain = observation.verifiedCompanyDomain
    ? normalizeDomain(observation.verifiedCompanyDomain)
    : undefined;
  const contentHash = hash(normalizedDescription);
  const fuzzyFingerprint = hash(
    JSON.stringify({
      company: normalizedCompanyName,
      title: normalizedTitle,
      locations: normalizedLocations,
      department: normalizedDepartment ?? "",
      description: contentHash,
    }),
  );
  const defaultExpiry = new Date(
    observation.observedAt.getTime() + defaultFreshnessDays * 24 * 60 * 60 * 1000,
  );
  const expiresAt =
    observation.validThrough && observation.validThrough > defaultExpiry
      ? new Date(observation.validThrough)
      : defaultExpiry;

  return {
    ...observation,
    ...(verifiedCompanyDomain ? { verifiedCompanyDomain } : {}),
    normalizedCompanyName,
    normalizedTitle,
    normalizedLocations,
    ...(normalizedDepartment ? { normalizedDepartment } : {}),
    canonicalUrl,
    canonicalUrlHash: hash(canonicalUrl),
    contentHash,
    fuzzyFingerprint,
    expiresAt,
  };
}

export function classifyDuplicate(
  left: CanonicalObservation,
  right: CanonicalObservation,
): DuplicateClassification {
  const rightExactKeys = new Set(exactIdentityKeys(right));
  if (exactIdentityKeys(left).some((key) => rightExactKeys.has(key))) {
    return "exact";
  }
  if (left.fuzzyFingerprint === right.fuzzyFingerprint) {
    return "probable";
  }
  const sharedCompany = left.normalizedCompanyName === right.normalizedCompanyName;
  const sharedTitle = left.normalizedTitle === right.normalizedTitle;
  const sharedLocation = left.normalizedLocations.some((location) =>
    right.normalizedLocations.includes(location),
  );
  if (sharedCompany && sharedTitle && sharedLocation) {
    return "related_repost";
  }
  return "not_duplicate";
}

export function evaluateLifecycle(input: LifecycleInput): JobStatus {
  if (input.currentStatus === "blocked" || input.blocked) {
    return "blocked";
  }
  if (input.currentStatus === "withdrawn" || input.explicitlyWithdrawn) {
    return "withdrawn";
  }
  if (input.positiveVerification) {
    return "active";
  }
  if (input.now >= input.expiresAt) {
    return "expired";
  }
  if ((input.consecutiveVerificationFailures ?? 0) >= suspectStaleFailureThreshold) {
    return "suspect_stale";
  }
  return input.currentStatus;
}

export function toMinimalTombstone(input: JobTombstoneInput): JobTombstoneInput {
  return {
    ...input,
    locations: [...input.locations],
    sourceReferences: [...new Set(input.sourceReferences)].sort(),
  };
}
