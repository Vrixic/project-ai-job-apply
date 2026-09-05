import { decodeHTML } from "entities";
import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";
import type {
  IngestionSourceAdapter,
  SourceExactPollContext,
  SourceJobObservation,
  SourcePollContext,
  SourcePollResult,
} from "./contract.js";

const boardTokenPattern = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const sourceIdPattern = /^greenhouse-[a-z0-9][a-z0-9-]{2,52}$/;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const supportedJobHosts = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);
const maximumJobs = 100;
const maximumTextLength = 100_000;
const externalJobIdPattern = /^[1-9][0-9]{0,15}$/;

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
  let html = canonicalText(value, "The Greenhouse job content");
  // The provider can wrap its HTML in one or two entity-encoding layers. Decode only the
  // outer envelope before parsing; entities inside actual markup remain text, not new tags.
  for (
    let layer = 0;
    layer < 2 && !/<\/?[a-z][^>]*>/iu.test(html) && /&(?:amp;)?lt;/iu.test(html);
    layer++
  ) {
    html = decodeHTML(html);
  }
  if (!/<\/?[a-z][^>]*>/iu.test(html) && /&(?:amp;)?lt;/iu.test(html)) {
    throw new Error("The Greenhouse job content encoding is unsupported");
  }
  const fragment = parseFragment(html);
  const skipped = new Set([
    "script",
    "style",
    "template",
    "noscript",
    "iframe",
    "object",
    "svg",
    "math",
    "form",
    "input",
    "textarea",
    "select",
    "button",
  ]);
  const blocks = new Set([
    "p",
    "div",
    "section",
    "article",
    "header",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "table",
    "tr",
    "td",
    "th",
    "hr",
  ]);
  const pending: (DefaultTreeAdapterTypes.ChildNode | string)[] = [];
  for (let index = fragment.childNodes.length - 1; index >= 0; index--) {
    const child = fragment.childNodes[index];
    if (child) pending.push(child);
  }
  const parts: string[] = [];
  let visited = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (++visited > 100_000) throw new Error("The Greenhouse job content is too complex");
    if (typeof node === "string") {
      parts.push(node);
      continue;
    }
    if (!node) continue;
    if ("value" in node) {
      parts.push(node.value);
      continue;
    }
    if (!("tagName" in node) || skipped.has(node.tagName)) continue;
    if (node.tagName === "br") {
      parts.push("\n");
      continue;
    }
    if (blocks.has(node.tagName)) {
      parts.push("\n");
      pending.push("\n");
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      const child = node.childNodes[index];
      if (child) pending.push(child);
    }
  }
  return canonicalText(
    parts
      .join("")
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
    companyName:
      job.company_name === undefined
        ? options.companyName
        : canonicalText(job.company_name, "The Greenhouse provider company name", 200),
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

  async #request(url: string, signal: AbortSignal): Promise<Response | SourcePollResult> {
    const timeout = AbortSignal.timeout(this.#requestTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        signal: combined,
        headers: { accept: "application/json" },
      });
      if (response.status === 429) return { kind: "retry", reason: "rate_limited" };
      if (!response.ok) return { kind: "retry", reason: "source_unavailable" };
      return response;
    } catch {
      return {
        kind: "retry",
        reason: timeout.aborted && !signal.aborted ? "timeout" : "source_unavailable",
      };
    }
  }

  async poll({ signal }: SourcePollContext): Promise<SourcePollResult> {
    const response = await this.#request(
      `https://boards-api.greenhouse.io/v1/boards/${this.#boardToken}/jobs?content=true`,
      signal,
    );
    if (!(response instanceof Response)) return response;
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

  async pollExact({ externalJobId, signal }: SourceExactPollContext): Promise<SourcePollResult> {
    if (!externalJobIdPattern.test(externalJobId)) {
      throw new Error("The Greenhouse exact job identifier is invalid");
    }
    const response = await this.#request(
      `https://boards-api.greenhouse.io/v1/boards/${this.#boardToken}/jobs/${externalJobId}`,
      signal,
    );
    if (!(response instanceof Response)) return response;
    const payload = await readBoundedJson(response, this.#maximumResponseBytes);
    const observation = parseJob(payload, {
      boardToken: this.#boardToken,
      companyName: this.#companyName,
      verifiedCompanyDomain: this.#verifiedCompanyDomain,
    });
    if (observation.externalJobId !== externalJobId) {
      throw new Error("The Greenhouse exact response identity does not match its request");
    }
    return { kind: "success", observations: [observation], withdrawals: [] };
  }
}
