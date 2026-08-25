import {
  compileComponentValidator,
  type PublicJobSitemapFeedResponse,
  type PublicJobSitemapItem,
} from "@ai-job-apply/api-contracts";

const maximumResponseBytes = 64_000;
const maximumPages = 500;
const maximumItems = 50_000;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const validateResponse = compileComponentValidator("PublicJobSitemapFeedResponse");

export class PublicJobSitemapUnavailableError extends Error {
  constructor() {
    super("Public job sitemap is unavailable");
    this.name = "PublicJobSitemapUnavailableError";
  }
}

function platformOrigin(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PLATFORM_API_BASE_URL is invalid");
  }
  return url;
}

function compareItems(left: PublicJobSitemapItem, right: PublicJobSitemapItem) {
  const freshness = right.lastModifiedAt.localeCompare(left.lastModifiedAt);
  return freshness === 0 ? left.jobId.localeCompare(right.jobId) : freshness;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const contentLength = response.headers.get("content-length");
  if (
    contentType !== "application/json" ||
    response.headers.has("transfer-encoding") ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumResponseBytes))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new PublicJobSitemapUnavailableError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PublicJobSitemapUnavailableError();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumResponseBytes) throw new PublicJobSitemapUnavailableError();
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new PublicJobSitemapUnavailableError();
  }
  if (contentLength !== null && total !== Number(contentLength)) {
    await reader.cancel().catch(() => undefined);
    throw new PublicJobSitemapUnavailableError();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PublicJobSitemapUnavailableError();
  }
}

function assertPageSemantics(page: PublicJobSitemapFeedResponse, now: Date) {
  if (page.nextCursor !== undefined && page.items.length !== 100) {
    throw new PublicJobSitemapUnavailableError();
  }
  const seen = new Set<string>();
  for (let index = 0; index < page.items.length; index += 1) {
    const item = page.items[index] as PublicJobSitemapItem;
    const milliseconds = Date.parse(item.lastModifiedAt);
    if (
      !canonicalInstantPattern.test(item.lastModifiedAt) ||
      !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== item.lastModifiedAt ||
      milliseconds > now.getTime() ||
      seen.has(item.jobId) ||
      (index > 0 && compareItems(page.items[index - 1] as PublicJobSitemapItem, item) >= 0)
    ) {
      throw new PublicJobSitemapUnavailableError();
    }
    seen.add(item.jobId);
  }
}

export async function fetchPublicJobSitemapPage(
  cursor: string | undefined,
  options: {
    baseUrl?: string;
    fetchImplementation?: typeof fetch;
    now?: () => Date;
    timeoutMilliseconds?: number;
  } = {},
): Promise<PublicJobSitemapFeedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMilliseconds ?? 5_000);
  try {
    const baseUrl = platformOrigin(
      options.baseUrl ?? process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    );
    const url = new URL("/v1/public/jobs/sitemap", baseUrl);
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const response = await (options.fetchImplementation ?? fetch)(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PublicJobSitemapUnavailableError();
    }
    const parsed = await readBoundedJson(response);
    const now = options.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime()) || !validateResponse(parsed)) {
      throw new PublicJobSitemapUnavailableError();
    }
    const page = parsed as PublicJobSitemapFeedResponse;
    assertPageSemantics(page, now);
    if (page.nextCursor !== undefined && page.nextCursor === cursor) {
      throw new PublicJobSitemapUnavailableError();
    }
    return page;
  } catch (error) {
    if (error instanceof PublicJobSitemapUnavailableError) throw error;
    throw new PublicJobSitemapUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCompletePublicJobSitemap(
  options: Parameters<typeof fetchPublicJobSitemapPage>[1] = {},
): Promise<readonly PublicJobSitemapItem[]> {
  const items: PublicJobSitemapItem[] = [];
  const seenJobIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let previous: PublicJobSitemapItem | undefined;
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const page = await fetchPublicJobSitemapPage(cursor, options);
    for (const item of page.items) {
      if (
        seenJobIds.has(item.jobId) ||
        (previous !== undefined && compareItems(previous, item) >= 0)
      ) {
        throw new PublicJobSitemapUnavailableError();
      }
      seenJobIds.add(item.jobId);
      items.push(Object.freeze({ ...item }));
      previous = item;
    }
    if (items.length > maximumItems) throw new PublicJobSitemapUnavailableError();
    if (page.nextCursor === undefined) return Object.freeze(items);
    if (seenCursors.has(page.nextCursor)) throw new PublicJobSitemapUnavailableError();
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new PublicJobSitemapUnavailableError();
}
