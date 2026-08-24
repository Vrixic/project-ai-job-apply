import type {
  IngestionSourceAdapter,
  SourceJobObservation,
  SourcePollContext,
  SourcePollResult,
} from "./contract.js";
import {
  approvedCompanyConfiguration,
  canonicalProviderText,
  fetchPublicJson,
  validateAcquisitionBounds,
} from "./provider-http.js";

const sourceIdPattern = /^lever-[a-z0-9][a-z0-9-]{2,57}$/;
const sitePattern = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const postingIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
const maximumJobs = 100;

export const leverPostingsAdapterVersion = "lever-postings-v1";

type Fetch = typeof globalThis.fetch;
type LeverRegion = "global" | "eu";

export interface LeverPostingsAdapterOptions {
  sourceId: string;
  site: string;
  companyName: string;
  verifiedCompanyDomain: string;
  region?: LeverRegion;
  fetch?: Fetch;
  requestTimeoutMs?: number;
  maximumResponseBytes?: number;
}

function leverHosts(region: LeverRegion): Readonly<{ api: string; jobs: string }> {
  return region === "eu"
    ? { api: "api.eu.lever.co", jobs: "jobs.eu.lever.co" }
    : { api: "api.lever.co", jobs: "jobs.lever.co" };
}

function canonicalJobUrl(
  value: unknown,
  jobsHost: string,
  site: string,
  externalJobId: string,
): string {
  const raw = canonicalProviderText(value, "The Lever hosted job URL", 2_048);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== jobsHost ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== `/${site}/${externalJobId}`
  ) {
    throw new Error(
      "The Lever hosted job URL does not match the approved site and posting identity",
    );
  }
  url.search = "";
  return url.toString();
}

function locationsFromCategories(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Lever job categories are invalid");
  }
  const categories = value as Record<string, unknown>;
  const candidates = categories.allLocations;
  if (candidates !== undefined) {
    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 25) {
      throw new Error("The Lever job locations are invalid");
    }
    return candidates.map((location) =>
      canonicalProviderText(location, "The Lever job location", 500),
    );
  }
  return [canonicalProviderText(categories.location, "The Lever job location", 500)];
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return canonicalProviderText(value, label, 500);
}

function workMode(value: unknown): SourceJobObservation["workMode"] | undefined {
  if (value === undefined || value === null || value === "unspecified") return undefined;
  if (value === "remote") return "remote";
  if (value === "hybrid") return "hybrid";
  if (value === "on-site") return "on_site";
  throw new Error("The Lever workplace type is invalid");
}

function parseJob(
  value: unknown,
  options: Readonly<{
    site: string;
    jobsHost: string;
    companyName: string;
    verifiedCompanyDomain: string;
  }>,
): SourceJobObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Lever job record is invalid");
  }
  const job = value as Record<string, unknown>;
  const externalJobId = canonicalProviderText(job.id, "The Lever posting identifier", 100);
  if (!postingIdPattern.test(externalJobId)) {
    throw new Error("The Lever posting identifier is invalid");
  }
  const categories = job.categories as Record<string, unknown> | undefined;
  const department = optionalText(categories?.department, "The Lever department");
  const mappedWorkMode = workMode(job.workplaceType);
  return {
    companyName: options.companyName,
    title: canonicalProviderText(job.text, "The Lever job title", 500),
    locations: locationsFromCategories(job.categories),
    description: canonicalProviderText(job.descriptionPlain, "The Lever job description", 100_000),
    sourceUrl: canonicalJobUrl(job.hostedUrl, options.jobsHost, options.site, externalJobId),
    atsTenant: options.site,
    externalJobId,
    verifiedCompanyDomain: options.verifiedCompanyDomain,
    ...(department ? { department } : {}),
    ...(mappedWorkMode ? { workMode: mappedWorkMode } : {}),
  };
}

export class LeverPostingsAdapter implements IngestionSourceAdapter {
  readonly sourceId: string;
  readonly adapterVersion = leverPostingsAdapterVersion;
  readonly #site: string;
  readonly #companyName: string;
  readonly #verifiedCompanyDomain: string;
  readonly #hosts: Readonly<{ api: string; jobs: string }>;
  readonly #fetch: Fetch;
  readonly #requestTimeoutMs: number;
  readonly #maximumResponseBytes: number;

  constructor(options: LeverPostingsAdapterOptions) {
    if (!sourceIdPattern.test(options.sourceId) || !sitePattern.test(options.site)) {
      throw new Error("A canonical Lever source and site are required");
    }
    const region = options.region ?? "global";
    if (region !== "global" && region !== "eu") throw new Error("The Lever region is invalid");
    const company = approvedCompanyConfiguration(
      options.companyName,
      options.verifiedCompanyDomain,
    );
    this.sourceId = options.sourceId;
    this.#site = options.site;
    this.#companyName = company.companyName;
    this.#verifiedCompanyDomain = company.verifiedCompanyDomain;
    this.#hosts = leverHosts(region);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 1_000_000;
    validateAcquisitionBounds(this.#requestTimeoutMs, this.#maximumResponseBytes, "Lever");
  }

  async #page(context: SourcePollContext, skip: number, limit: number) {
    return fetchPublicJson({
      fetch: this.#fetch,
      url: `https://${this.#hosts.api}/v0/postings/${this.#site}?mode=json&skip=${skip}&limit=${limit}`,
      signal: context.signal,
      requestTimeoutMs: this.#requestTimeoutMs,
      maximumResponseBytes: this.#maximumResponseBytes,
      provider: "Lever",
    });
  }

  async poll(context: SourcePollContext): Promise<SourcePollResult> {
    const first = await this.#page(context, 0, maximumJobs);
    if (first.kind === "retry") return first;
    if (!Array.isArray(first.payload) || first.payload.length > maximumJobs) {
      throw new Error("The Lever job batch exceeds its bounded size");
    }
    if (first.payload.length === maximumJobs) {
      const overflow = await this.#page(context, maximumJobs, 1);
      if (overflow.kind === "retry") return overflow;
      if (!Array.isArray(overflow.payload)) throw new Error("The Lever response is invalid");
      if (overflow.payload.length !== 0) {
        throw new Error("The Lever job batch exceeds its bounded size");
      }
    }
    return {
      kind: "success",
      observations: first.payload.map((job) =>
        parseJob(job, {
          site: this.#site,
          jobsHost: this.#hosts.jobs,
          companyName: this.#companyName,
          verifiedCompanyDomain: this.#verifiedCompanyDomain,
        }),
      ),
      withdrawals: [],
    };
  }
}
