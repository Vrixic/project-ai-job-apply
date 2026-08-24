import type { IngestionSourceAdapter, SourceJobObservation, SourcePollResult } from "./contract.js";

const boardTokenPattern = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const sourceIdPattern = /^greenhouse-[a-z0-9][a-z0-9-]{2,52}$/;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const supportedJobHosts = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);
const maximumJobs = 100;
const maximumTextLength = 100_000;

export const greenhouseJobBoardAdapterVersion = "greenhouse-job-board-v1";

type Fetch = typeof globalThis.fetch;

export interface GreenhouseJobBoardAdapterOptions {
  sourceId: string;
  boardToken: string;
  companyName: string;
  verifiedCompanyDomain: string;
  fetch?: Fetch;
  requestTimeoutMs?: number;
  maximumResponseBytes?: number;
}

function canonicalText(value: unknown, label: string, maximum = maximumTextLength): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.normalize("NFC").trim();
  const unsafeControl = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13;
  });
  if (!normalized || normalized.length > maximum || unsafeControl) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function htmlToPlainText(value: unknown): string {
  const html = canonicalText(value, "The Greenhouse job content");
  const withoutActiveContent = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return canonicalText(
    withoutActiveContent
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d{1,7});/g, (_, digits: string) => {
        const codePoint = Number(digits);
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : " ";
      })
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
    "The Greenhouse job content",
  );
}

function canonicalJobUrl(value: unknown, boardToken: string, externalJobId: string): string {
  const raw = canonicalText(value, "The Greenhouse job URL", 2_048);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !supportedJobHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error("The Greenhouse job URL is outside the approved host boundary");
  }
  const expectedPath = `/${boardToken}/jobs/${externalJobId}`;
  if (url.pathname !== expectedPath) {
    throw new Error("The Greenhouse job URL does not match the approved board and job identity");
  }
  url.search = "";
  return url.toString();
}

function parseJob(
  value: unknown,
  options: Readonly<
    Pick<GreenhouseJobBoardAdapterOptions, "boardToken" | "companyName" | "verifiedCompanyDomain">
  >,
): SourceJobObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Greenhouse job record is invalid");
  }
  const job = value as Record<string, unknown>;
  if (!Number.isSafeInteger(job.id) || (job.id as number) < 1) {
    throw new Error("The Greenhouse job identifier is invalid");
  }
  if (!job.location || typeof job.location !== "object" || Array.isArray(job.location)) {
    throw new Error("The Greenhouse job location is invalid");
  }
  const location = canonicalText(
    (job.location as Record<string, unknown>).name,
    "The Greenhouse job location",
    500,
  );
  let department: string | undefined;
  if (job.departments !== undefined) {
    if (!Array.isArray(job.departments) || job.departments.length > 25) {
      throw new Error("The Greenhouse departments are invalid");
    }
    const first = job.departments[0];
    if (first !== undefined) {
      if (!first || typeof first !== "object" || Array.isArray(first)) {
        throw new Error("The Greenhouse department is invalid");
      }
      department = canonicalText(
        (first as Record<string, unknown>).name,
        "The Greenhouse department",
        500,
      );
    }
  }
  return {
    companyName: options.companyName,
    title: canonicalText(job.title, "The Greenhouse job title", 500),
    locations: [location],
    description: htmlToPlainText(job.content),
    sourceUrl: canonicalJobUrl(job.absolute_url, options.boardToken, String(job.id)),
    atsTenant: options.boardToken,
    externalJobId: String(job.id),
    verifiedCompanyDomain: options.verifiedCompanyDomain,
    ...(department ? { department } : {}),
  };
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json")
    throw new Error("The Greenhouse response type is invalid");
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error("The Greenhouse response exceeds its byte limit");
  }
  if (!response.body) throw new Error("The Greenhouse response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("The Greenhouse response exceeds its byte limit");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export class GreenhouseJobBoardAdapter implements IngestionSourceAdapter {
  readonly sourceId: string;
  readonly adapterVersion = greenhouseJobBoardAdapterVersion;
  readonly #boardToken: string;
  readonly #companyName: string;
  readonly #verifiedCompanyDomain: string;
  readonly #fetch: Fetch;
  readonly #requestTimeoutMs: number;
  readonly #maximumResponseBytes: number;

  constructor(options: GreenhouseJobBoardAdapterOptions) {
    if (!sourceIdPattern.test(options.sourceId) || !boardTokenPattern.test(options.boardToken)) {
      throw new Error("A canonical Greenhouse source and board token are required");
    }
    this.sourceId = options.sourceId;
    this.#boardToken = options.boardToken;
    this.#companyName = canonicalText(options.companyName, "The approved company name", 500);
    this.#verifiedCompanyDomain = canonicalText(
      options.verifiedCompanyDomain,
      "The approved company domain",
      253,
    ).toLowerCase();
    if (!domainPattern.test(this.#verifiedCompanyDomain)) {
      throw new Error("The approved company domain is invalid");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 1_000_000;
    if (
      !Number.isInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 100 ||
      this.#requestTimeoutMs > 10_000 ||
      !Number.isInteger(this.#maximumResponseBytes) ||
      this.#maximumResponseBytes < 1_024 ||
      this.#maximumResponseBytes > 1_000_000
    ) {
      throw new Error("The Greenhouse acquisition bounds are invalid");
    }
  }

  async poll({ signal }: { observedAt: Date; signal: AbortSignal }): Promise<SourcePollResult> {
    const timeout = AbortSignal.timeout(this.#requestTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.#fetch(
        `https://boards-api.greenhouse.io/v1/boards/${this.#boardToken}/jobs?content=true`,
        {
          method: "GET",
          redirect: "error",
          signal: combined,
          headers: { accept: "application/json" },
        },
      );
    } catch {
      return {
        kind: "retry",
        reason: timeout.aborted && !signal.aborted ? "timeout" : "source_unavailable",
      };
    }
    if (response.status === 429) return { kind: "retry", reason: "rate_limited" };
    if (!response.ok) return { kind: "retry", reason: "source_unavailable" };
    const payload = await readBoundedJson(response, this.#maximumResponseBytes);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("The Greenhouse response is invalid");
    }
    const jobs = (payload as Record<string, unknown>).jobs;
    if (!Array.isArray(jobs) || jobs.length > maximumJobs) {
      throw new Error("The Greenhouse job batch exceeds its bounded size");
    }
    return {
      kind: "success",
      observations: jobs.map((job) =>
        parseJob(job, {
          boardToken: this.#boardToken,
          companyName: this.#companyName,
          verifiedCompanyDomain: this.#verifiedCompanyDomain,
        }),
      ),
      withdrawals: [],
    };
  }
}
