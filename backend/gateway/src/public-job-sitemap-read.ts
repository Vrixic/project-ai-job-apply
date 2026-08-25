import {
  compileComponentValidator,
  type PublicJobSitemapFeedResponse,
} from "@ai-job-apply/api-contracts";
import type {
  PublicJobSitemapCursor,
  PublicJobSitemapProjectionPage,
} from "@ai-job-apply/jobs-service";
import type { PublicJobHandler } from "./public-job-read.js";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const cursorPattern = /^[A-Za-z0-9_-]{16,512}$/;
const validateResponse = compileComponentValidator("PublicJobSitemapFeedResponse");
const pageKeys = new Set(["kind", "items", "hasMore"]);
const itemKeys = new Set(["jobId", "lastModifiedAt"]);

export interface PublicJobSitemapResultReader {
  list(
    cursor: Readonly<PublicJobSitemapCursor> | undefined,
  ): Promise<PublicJobSitemapProjectionPage>;
}

function exactKeys(value: object, expected: ReadonlySet<string>) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalInstantPattern.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function compareItems(left: PublicJobSitemapCursor, right: PublicJobSitemapCursor) {
  const freshness = right.lastModifiedAt.localeCompare(left.lastModifiedAt);
  return freshness === 0 ? left.jobId.localeCompare(right.jobId) : freshness;
}

export function encodePublicJobSitemapCursor(cursor: Readonly<PublicJobSitemapCursor>) {
  if (!uuidV7Pattern.test(cursor.jobId) || !canonicalInstant(cursor.lastModifiedAt)) {
    throw new Error("The public sitemap cursor is invalid");
  }
  return Buffer.from(
    JSON.stringify({ version: 1, lastModifiedAt: cursor.lastModifiedAt, jobId: cursor.jobId }),
    "utf8",
  ).toString("base64url");
}

export function decodePublicJobSitemapCursor(value: string): Readonly<PublicJobSitemapCursor> {
  if (!cursorPattern.test(value)) throw new Error("The public sitemap cursor is invalid");
  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("noncanonical cursor");
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("The public sitemap cursor is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The public sitemap cursor is invalid");
  }
  const cursor = parsed as Record<string, unknown>;
  if (
    !exactKeys(cursor, new Set(["version", "lastModifiedAt", "jobId"])) ||
    cursor.version !== 1 ||
    !uuidV7Pattern.test(cursor.jobId as string) ||
    !canonicalInstant(cursor.lastModifiedAt)
  ) {
    throw new Error("The public sitemap cursor is invalid");
  }
  return Object.freeze({
    jobId: cursor.jobId as string,
    lastModifiedAt: cursor.lastModifiedAt as string,
  });
}

export function assertPublicJobSitemapProjection(
  value: unknown,
  now: Date,
): asserts value is PublicJobSitemapProjectionPage {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, pageKeys)
  ) {
    throw new Error("The public sitemap projection is invalid");
  }
  const page = value as Record<string, unknown>;
  if (
    page.kind !== "page" ||
    typeof page.hasMore !== "boolean" ||
    !Array.isArray(page.items) ||
    page.items.length > 100 ||
    (page.hasMore && page.items.length !== 100)
  ) {
    throw new Error("The public sitemap projection is invalid");
  }
  const seen = new Set<string>();
  for (let index = 0; index < page.items.length; index += 1) {
    const item = page.items[index];
    if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, itemKeys)) {
      throw new Error("The public sitemap projection is invalid");
    }
    const record = item as Record<string, unknown>;
    if (
      !uuidV7Pattern.test(record.jobId as string) ||
      !canonicalInstant(record.lastModifiedAt) ||
      Date.parse(record.lastModifiedAt as string) > now.getTime() ||
      seen.has(record.jobId as string)
    ) {
      throw new Error("The public sitemap projection is invalid");
    }
    seen.add(record.jobId as string);
    if (
      index > 0 &&
      compareItems(
        page.items[index - 1] as PublicJobSitemapCursor,
        item as PublicJobSitemapCursor,
      ) >= 0
    ) {
      throw new Error("The public sitemap projection is invalid");
    }
  }
}

function response(statusCode: number, body: object, requestId: string) {
  return {
    statusCode,
    headers: {
      "cache-control": statusCode === 200 ? "public, max-age=0, must-revalidate" : "no-store",
      "content-type":
        statusCode === 200
          ? "application/json; charset=utf-8"
          : "application/problem+json; charset=utf-8",
      "x-request-id": requestId,
      ...(statusCode === 503 ? { "retry-after": "5" } : {}),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function problem(status: number, code: string, title: string, requestId: string) {
  return { type: `urn:ai-job-apply:problem:${code}`, title, status, code, traceId: requestId };
}

export function publicJobSitemapUnavailableResponse(requestId: string) {
  return response(
    503,
    problem(503, "PUBLIC_JOB_SITEMAP_UNAVAILABLE", "Public job sitemap is unavailable", requestId),
    requestId,
  );
}

export function createPublicJobSitemapReadHandler(
  reader: PublicJobSitemapResultReader,
  clock: () => Date = () => new Date(),
): PublicJobHandler {
  return async (event) => {
    const requestId = event.requestContext.requestId;
    let cursor: Readonly<PublicJobSitemapCursor> | undefined;
    try {
      if (
        event.version !== "2.0" ||
        event.routeKey !== "GET /v1/public/jobs/sitemap" ||
        event.rawPath !== "/v1/public/jobs/sitemap" ||
        event.isBase64Encoded ||
        event.requestContext.http.method !== "GET" ||
        event.body !== undefined
      ) {
        throw new Error("invalid request");
      }
      if (event.rawQueryString !== "") {
        if (!event.rawQueryString.startsWith("cursor=")) throw new Error("invalid query");
        const rawCursor = event.rawQueryString.slice("cursor=".length);
        if (`cursor=${rawCursor}` !== event.rawQueryString) throw new Error("invalid query");
        cursor = decodePublicJobSitemapCursor(rawCursor);
      }
      const now = clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new Error("invalid server clock");
      }
      if (cursor && Date.parse(cursor.lastModifiedAt) > now.getTime()) {
        throw new Error("invalid future cursor");
      }
      const page = await reader.list(cursor);
      assertPublicJobSitemapProjection(page, now);
      if (cursor && page.items[0] && compareItems(cursor, page.items[0]) >= 0) {
        throw new Error("invalid keyset continuation");
      }
      const lastItem = page.items.at(-1);
      const body: PublicJobSitemapFeedResponse = {
        items: page.items.map((item) => ({ ...item })),
        ...(page.hasMore && lastItem ? { nextCursor: encodePublicJobSitemapCursor(lastItem) } : {}),
      };
      if (!validateResponse(body)) throw new Error("invalid sitemap response");
      return response(200, body, requestId);
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "invalid request",
          "invalid query",
          "invalid future cursor",
          "The public sitemap cursor is invalid",
        ].includes(error.message)
      ) {
        return response(
          400,
          problem(
            400,
            "PUBLIC_JOB_SITEMAP_INVALID_REQUEST",
            "Invalid public job sitemap request",
            requestId,
          ),
          requestId,
        );
      }
      return publicJobSitemapUnavailableResponse(requestId);
    }
  };
}
