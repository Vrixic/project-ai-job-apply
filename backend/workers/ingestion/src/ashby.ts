import { ashbyExactBoardProfile, fetchAshbyExactBoard } from "./ashby-exact-board.js";
import type {
  IngestionSourceAdapter,
  SourceExactPollContext,
  SourceJobObservation,
  SourceJobWithdrawal,
  SourcePollContext,
  SourcePollResult,
} from "./contract.js";
import { legacyPageDescriptionDigests } from "./page-preview-compatibility.js";
import { parseCorroboratedAshbyDescriptionHtml } from "./provider-description.js";
import {
  approvedCompanyConfiguration,
  canonicalProviderText,
  fetchPublicJson,
  validateAcquisitionBounds,
} from "./provider-http.js";

const sourceIdPattern = /^ashby-[a-z0-9][a-z0-9-]{2,57}$/;
const jobBoardPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;
const postingIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
const maximumJobs = 100;

export const ashbyJobBoardAdapterVersion = "ashby-job-board-v1";

type Fetch = typeof globalThis.fetch;

export interface AshbyJobBoardAdapterOptions {
  sourceId: string;
  jobBoardName: string;
  companyName: string;
  verifiedCompanyDomain: string;
  fetch?: Fetch;
  requestTimeoutMs?: number;
  maximumResponseBytes?: number;
}

function canonicalJobIdentity(
  value: unknown,
  jobBoardName: string,
): Readonly<{ sourceUrl: string; externalJobId: string }> {
  const raw = canonicalProviderText(value, "The Ashby job URL", 2_048);
  const url = new URL(raw);
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "jobs.ashbyhq.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    segments.length !== 2 ||
    segments[0] !== jobBoardName ||
    !postingIdPattern.test(segments[1] as string)
  ) {
    throw new Error("The Ashby job URL does not match the approved board and posting identity");
  }
  url.search = "";
  return Object.freeze({ sourceUrl: url.toString(), externalJobId: segments[1] as string });
}

function canonicalApplicationUrl(
  value: unknown,
  jobBoardName: string,
  externalJobId: string,
): string {
  const raw = canonicalProviderText(value, "The Ashby application URL", 2_048);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "jobs.ashbyhq.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== `/${jobBoardName}/${externalJobId}/application`
  ) {
    throw new Error("The Ashby application URL does not match the approved posting identity");
  }
  url.search = "";
  return url.toString();
}

function optionalText(value: unknown, label: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return canonicalProviderText(value, label, maxLength);
}

function locations(job: Record<string, unknown>): readonly string[] {
  const result = [canonicalProviderText(job.location, "The Ashby job location", 500)];
  if (job.secondaryLocations !== undefined) {
    if (!Array.isArray(job.secondaryLocations) || job.secondaryLocations.length > 19) {
      throw new Error("The Ashby secondary locations are invalid");
    }
    for (const value of job.secondaryLocations) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The Ashby secondary location is invalid");
      }
      result.push(
        canonicalProviderText(
          (value as Record<string, unknown>).location,
          "The Ashby secondary location",
          500,
        ),
      );
    }
  }
  return [...new Set(result)];
}

function postalAddress(
  value: unknown,
): NonNullable<SourceJobObservation["structuredLocations"]>[number] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Ashby postal address is invalid");
  }
  const address = value as Record<string, unknown>;
  const country = optionalText(address.addressCountry, "The Ashby address country", 100);
  if (!country) return undefined;
  const locality = optionalText(address.addressLocality, "The Ashby address locality", 200);
  const region = optionalText(address.addressRegion, "The Ashby address region", 200);
  return {
    address: {
      addressCountry: country,
      ...(locality ? { addressLocality: locality } : {}),
      ...(region ? { addressRegion: region } : {}),
    },
  };
}

function structuredLocations(
  job: Record<string, unknown>,
): NonNullable<SourceJobObservation["structuredLocations"]> {
  const result: NonNullable<SourceJobObservation["structuredLocations"]>[number][] = [];
  if (job.address !== undefined) {
    if (!job.address || typeof job.address !== "object" || Array.isArray(job.address)) {
      throw new Error("The Ashby primary address is invalid");
    }
    const primary = postalAddress((job.address as Record<string, unknown>).postalAddress);
    if (primary) result.push(primary);
  }
  if (job.secondaryLocations !== undefined) {
    for (const value of job.secondaryLocations as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The Ashby secondary location is invalid");
      }
      const secondary = postalAddress((value as Record<string, unknown>).address);
      if (secondary) result.push(secondary);
    }
  }
  return result;
}

function publishedAt(value: unknown): Date {
  const raw = canonicalProviderText(value, "The Ashby publication timestamp", 100);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw new Error("The Ashby publication timestamp is invalid");
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("The Ashby publication timestamp is invalid");
  }
  return parsed;
}

function workMode(value: unknown): SourceJobObservation["workMode"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "Remote") return "remote";
  if (value === "Hybrid") return "hybrid";
  if (value === "OnSite") return "on_site";
  throw new Error("The Ashby workplace type is invalid");
}

function employmentType(value: unknown): SourceJobObservation["employmentType"] | undefined {
  if (value === "FullTime") return "full_time";
  if (value === "PartTime") return "part_time";
  if (value === "Contract") return "contract";
  if (value === "Intern") return "internship";
  if (value === "Temporary") return undefined;
  throw new Error("The Ashby employment type is invalid");
}

type ParsedAshbyJob =
  | { kind: "observation"; observation: SourceJobObservation }
  | { kind: "withdrawal"; withdrawal: SourceJobWithdrawal };

function parseJob(
  value: unknown,
  options: Readonly<{
    jobBoardName: string;
    companyName: string;
    verifiedCompanyDomain: string;
  }>,
  onPreview?: (digests: readonly string[]) => void,
): ParsedAshbyJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Ashby job record is invalid");
  }
  const job = value as Record<string, unknown>;
  if (typeof job.isListed !== "boolean") throw new Error("The Ashby listing state is invalid");
  const identity = canonicalJobIdentity(job.jobUrl, options.jobBoardName);
  if (!job.isListed) {
    return {
      kind: "withdrawal",
      withdrawal: {
        sourceUrl: identity.sourceUrl,
        atsTenant: options.jobBoardName,
        externalJobId: identity.externalJobId,
      },
    };
  }
  const mappedStructuredLocations = structuredLocations(job);
  const department = optionalText(job.department, "The Ashby department");
  const team = optionalText(job.team, "The Ashby team");
  const mappedDepartment = department ?? team;
  const mappedWorkMode = workMode(job.workplaceType);
  const mappedEmploymentType = employmentType(job.employmentType);
  const description = canonicalProviderText(
    job.descriptionPlain,
    "The Ashby job description",
    100_000,
  );
  if (
    job.descriptionHtml !== undefined &&
    job.descriptionHtml !== null &&
    job.descriptionHtml !== ""
  ) {
    const html = parseCorroboratedAshbyDescriptionHtml(job.descriptionHtml, description);
    // The independently fetched HTML may explain textContent block boundaries only when
    // it corroborates the complete provider plaintext, never changed words or numbers.
    if (html) {
      onPreview?.(legacyPageDescriptionDigests(html.textContent, html.firstHeading));
    }
  }
  return {
    kind: "observation",
    observation: {
      companyName: options.companyName,
      title: canonicalProviderText(job.title, "The Ashby job title", 500),
      locations: locations(job),
      description,
      sourceUrl: identity.sourceUrl,
      applicationUrl: canonicalApplicationUrl(
        job.applyUrl,
        options.jobBoardName,
        identity.externalJobId,
      ),
      datePosted: publishedAt(job.publishedAt),
      ...(mappedStructuredLocations.length > 0
        ? { structuredLocations: mappedStructuredLocations }
        : {}),
      atsTenant: options.jobBoardName,
      externalJobId: identity.externalJobId,
      verifiedCompanyDomain: options.verifiedCompanyDomain,
      ...(mappedDepartment ? { department: mappedDepartment } : {}),
      ...(mappedWorkMode ? { workMode: mappedWorkMode } : {}),
      ...(mappedEmploymentType ? { employmentType: mappedEmploymentType } : {}),
    },
  };
}

export class AshbyJobBoardAdapter implements IngestionSourceAdapter {
  readonly sourceId: string;
  readonly adapterVersion = ashbyJobBoardAdapterVersion;
  readonly #jobBoardName: string;
  readonly #companyName: string;
  readonly #verifiedCompanyDomain: string;
  readonly #fetch: Fetch;
  readonly #requestTimeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #pageDescriptions = new WeakMap<SourceJobObservation, readonly string[]>();

  constructor(options: AshbyJobBoardAdapterOptions) {
    if (!sourceIdPattern.test(options.sourceId) || !jobBoardPattern.test(options.jobBoardName)) {
      throw new Error("A canonical Ashby source and job board name are required");
    }
    const company = approvedCompanyConfiguration(
      options.companyName,
      options.verifiedCompanyDomain,
    );
    this.sourceId = options.sourceId;
    this.#jobBoardName = options.jobBoardName;
    this.#companyName = company.companyName;
    this.#verifiedCompanyDomain = company.verifiedCompanyDomain;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 1_000_000;
    validateAcquisitionBounds(this.#requestTimeoutMs, this.#maximumResponseBytes, "Ashby");
  }

  pagePreviewDescriptionDigests(
    observation: SourceJobObservation,
    captureAdapterVersion: string,
  ): readonly string[] {
    return captureAdapterVersion === "d2-job-page-v1"
      ? (this.#pageDescriptions.get(observation) ?? [])
      : [];
  }

  async pollExact(context: SourceExactPollContext): Promise<SourcePollResult> {
    const startedAt = performance.now();
    const result = await fetchAshbyExactBoard({
      fetch: this.#fetch,
      jobBoardName: this.#jobBoardName,
      externalJobId: context.externalJobId,
      signal: context.signal,
      onJob: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("The Ashby job record is invalid");
        }
        const job = value as Record<string, unknown>;
        if (typeof job.isListed !== "boolean") {
          throw new Error("The Ashby listing state is invalid");
        }
        return (
          canonicalJobIdentity(job.jobUrl, this.#jobBoardName).externalJobId ===
          context.externalJobId
        );
      },
    });
    if (result.kind === "retry") return result;
    // Missing/partial board data never establishes closure. Only an explicit, exact
    // unlisted record in a completely validated response can supply a withdrawal.
    if (result.job === null) return { kind: "retry", reason: "source_unavailable" };
    let previewDigests: readonly string[] = [];
    const parsed = parseJob(
      result.job,
      {
        jobBoardName: this.#jobBoardName,
        companyName: this.#companyName,
        verifiedCompanyDomain: this.#verifiedCompanyDomain,
      },
      (digests) => {
        previewDigests = digests;
      },
    );
    if (context.signal.aborted) return { kind: "retry", reason: "source_unavailable" };
    if (performance.now() - startedAt >= ashbyExactBoardProfile.requestTimeoutMs) {
      return { kind: "retry", reason: "timeout" };
    }
    if (parsed.kind === "withdrawal") {
      return { kind: "success", observations: [], withdrawals: [parsed.withdrawal] };
    }
    this.#pageDescriptions.set(parsed.observation, previewDigests);
    return { kind: "success", observations: [parsed.observation], withdrawals: [] };
  }

  async poll(context: SourcePollContext): Promise<SourcePollResult> {
    const result = await fetchPublicJson({
      fetch: this.#fetch,
      url: `https://api.ashbyhq.com/posting-api/job-board/${this.#jobBoardName}?includeCompensation=false`,
      signal: context.signal,
      requestTimeoutMs: this.#requestTimeoutMs,
      maximumResponseBytes: this.#maximumResponseBytes,
      provider: "Ashby",
    });
    if (result.kind === "retry") return result;
    if (!result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)) {
      throw new Error("The Ashby response is invalid");
    }
    const payload = result.payload as Record<string, unknown>;
    if (
      payload.apiVersion !== "1" ||
      !Array.isArray(payload.jobs) ||
      payload.jobs.length > maximumJobs
    ) {
      throw new Error("The Ashby job batch exceeds its bounded size or version");
    }
    const parsed = payload.jobs.map((job) => {
      let previewDigests: readonly string[] = [];
      const parsedJob = parseJob(
        job,
        {
          jobBoardName: this.#jobBoardName,
          companyName: this.#companyName,
          verifiedCompanyDomain: this.#verifiedCompanyDomain,
        },
        (digests) => {
          previewDigests = digests;
        },
      );
      if (parsedJob.kind === "observation") {
        this.#pageDescriptions.set(parsedJob.observation, previewDigests);
      }
      return parsedJob;
    });
    return {
      kind: "success",
      observations: parsed.flatMap((job) => (job.kind === "observation" ? [job.observation] : [])),
      withdrawals: parsed.flatMap((job) => (job.kind === "withdrawal" ? [job.withdrawal] : [])),
    };
  }
}
