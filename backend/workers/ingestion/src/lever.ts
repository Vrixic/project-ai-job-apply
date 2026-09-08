import type {
  IngestionSourceAdapter,
  SourceExactPollContext,
  SourceJobObservation,
  SourcePollContext,
  SourcePollResult,
} from "./contract.js";
import { legacyPageDescriptionDigests } from "./page-preview-compatibility.js";
import { parsePublicDescriptionHtml } from "./provider-description.js";
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
const maximumDescriptionLength = 100_000;
const maximumDescriptionLists = 25;

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

function fullDescription(
  job: Record<string, unknown>,
  onPreview?: (digests: readonly string[]) => void,
): string {
  const parts: string[] = [];
  const previewParts: string[] = [];
  let previewComplete = true;
  let firstHeading: string | undefined;
  const comparable = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");

  const plainSection = (value: unknown, html: unknown, label: string, required = false) => {
    if (
      (value !== undefined && value !== null && typeof value !== "string") ||
      (typeof value === "string" && value.length > maximumDescriptionLength)
    ) {
      throw new Error(`${label} is invalid`);
    }
    if (value === undefined || value === null || value.trim() === "") {
      if (typeof html === "string" && html.length > maximumDescriptionLength) {
        throw new Error(`${label} HTML is invalid`);
      }
      const hasHtml =
        html !== undefined && html !== null && (typeof html !== "string" || html.trim() !== "");
      if (hasHtml) {
        // HTML-only public sections remain provider truth even when the candidate deselects
        // description. Invalid fallback content cannot silently disappear from publication.
        const parsed = parsePublicDescriptionHtml(html);
        if (parts.length === 0) firstHeading = parsed.firstHeading;
        parts.push(parsed.plainText);
        previewParts.push(parsed.textContent);
      } else if (required && typeof value !== "string") {
        throw new Error(`${label} is invalid`);
      }
      return;
    }
    const plainText = canonicalProviderText(value, label, maximumDescriptionLength);
    if (onPreview) {
      // Auxiliary HTML must corroborate the authoritative plain section. A missing, malformed,
      // or contradictory representation cannot authorize a page-only compatibility digest.
      try {
        const parsed = parsePublicDescriptionHtml(html);
        if (comparable(parsed.plainText) !== comparable(plainText)) previewComplete = false;
        if (parts.length === 0) firstHeading = parsed.firstHeading;
        previewParts.push(parsed.textContent);
      } catch {
        previewComplete = false;
      }
    }
    parts.push(plainText);
  };

  // descriptionPlain already includes opening + body. Their separate fields must not be
  // appended again; lists and the closing/salary descriptions are separate API sections.
  plainSection(job.descriptionPlain, job.description, "The Lever job description", true);
  if (job.lists !== undefined) {
    if (!Array.isArray(job.lists) || job.lists.length > maximumDescriptionLists) {
      throw new Error("The Lever description lists are invalid");
    }
    for (const item of job.lists) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("The Lever description list is invalid");
      }
      const list = item as Record<string, unknown>;
      const heading = canonicalProviderText(list.text, "The Lever description list heading", 500);
      const content = parsePublicDescriptionHtml(list.content);
      if (parts.length === 0) firstHeading = heading;
      parts.push(`${heading}\n${content.plainText}`);
      previewParts.push(heading, content.textContent);
    }
  }
  plainSection(job.salaryDescriptionPlain, job.salaryDescription, "The Lever salary description");
  plainSection(job.additionalPlain, job.additional, "The Lever closing description");
  const description = canonicalProviderText(
    parts.join("\n\n"),
    "The Lever complete job description",
    maximumDescriptionLength,
  );
  if (onPreview && previewComplete) {
    // The v1 reader observes textContent: adjacent block nodes can concatenate or retain
    // template whitespace. Preserve every independently supplied chunk in both fixed layouts.
    onPreview(
      Object.freeze([
        ...new Set([
          ...legacyPageDescriptionDigests(previewParts.join(""), firstHeading),
          ...legacyPageDescriptionDigests(previewParts.join("\n"), firstHeading),
        ]),
      ]),
    );
  }
  return description;
}

function parseJob(
  value: unknown,
  options: Readonly<{
    site: string;
    jobsHost: string;
    companyName: string;
    verifiedCompanyDomain: string;
  }>,
  onPreview?: (digests: readonly string[]) => void,
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
    description: fullDescription(job, onPreview),
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
  readonly #pagePreviews = new WeakMap<SourceJobObservation, readonly string[]>();

  pagePreviewDescriptionDigests(
    observation: SourceJobObservation,
    captureAdapterVersion: string,
  ): readonly string[] {
    return captureAdapterVersion === "d2-job-page-v1"
      ? (this.#pagePreviews.get(observation) ?? [])
      : [];
  }

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

  async pollExact({ externalJobId, signal }: SourceExactPollContext): Promise<SourcePollResult> {
    if (!postingIdPattern.test(externalJobId)) {
      throw new Error("The Lever exact posting identifier is invalid");
    }
    const result = await fetchPublicJson({
      fetch: this.#fetch,
      url: `https://${this.#hosts.api}/v0/postings/${this.#site}/${externalJobId}`,
      signal,
      requestTimeoutMs: this.#requestTimeoutMs,
      maximumResponseBytes: this.#maximumResponseBytes,
      provider: "Lever",
    });
    if (result.kind === "retry") return result;
    let previewDigests: readonly string[] = [];
    const observation = parseJob(
      result.payload,
      {
        site: this.#site,
        jobsHost: this.#hosts.jobs,
        companyName: this.#companyName,
        verifiedCompanyDomain: this.#verifiedCompanyDomain,
      },
      (digests) => {
        previewDigests = digests;
      },
    );
    if (observation.externalJobId !== externalJobId) {
      throw new Error("The Lever exact response identity does not match its request");
    }
    this.#pagePreviews.set(observation, previewDigests);
    return { kind: "success", observations: [observation], withdrawals: [] };
  }
}
