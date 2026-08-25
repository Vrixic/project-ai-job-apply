import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  createPublicJobSitemapReadHandler,
  decodePublicJobSitemapCursor,
  encodePublicJobSitemapCursor,
} from "./public-job-sitemap-read.js";

const firstJobId = "018f6f6e-7b2a-7c00-8000-000000000001";
const secondJobId = "018f6f6e-7b2a-7c00-8000-000000000002";
const now = new Date("2026-08-16T12:00:00.000Z");

function event(rawQueryString = ""): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /v1/public/jobs/sitemap",
    rawPath: "/v1/public/jobs/sitemap",
    rawQueryString,
    headers: {},
    requestContext: {
      accountId: "000000000000",
      apiId: "local",
      domainName: "example.test",
      domainPrefix: "local",
      http: {
        method: "GET",
        path: "/v1/public/jobs/sitemap",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request",
      routeKey: "GET /v1/public/jobs/sitemap",
      stage: "$default",
      time: "16/Aug/2026:12:00:00 +0000",
      timeEpoch: now.getTime(),
    },
    isBase64Encoded: false,
  };
}

describe("public job sitemap edge boundary", () => {
  it("returns only the bounded feed and a canonical keyset cursor", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      jobId: `018f6f6e-7b2a-7c00-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      lastModifiedAt: new Date(now.getTime() - index * 1_000).toISOString(),
    }));
    const reader = { list: vi.fn(async () => ({ kind: "page" as const, items, hasMore: true })) };
    const result = await createPublicJobSitemapReadHandler(reader, () => now)(event(), {} as never);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["cache-control"]).toBe("public, max-age=0, must-revalidate");
    const body = JSON.parse(result.body ?? "null") as {
      items: typeof items;
      nextCursor: string;
    };
    expect(body.items).toEqual(items);
    expect(decodePublicJobSitemapCursor(body.nextCursor)).toEqual(items.at(-1));
    expect(reader.list).toHaveBeenCalledWith(undefined);
  });

  it("passes one exact decoded continuation and rejects malformed cursors before I/O", async () => {
    const cursor = encodePublicJobSitemapCursor({
      jobId: firstJobId,
      lastModifiedAt: "2026-08-16T11:00:00.000Z",
    });
    const reader = {
      list: vi.fn(async () => ({
        kind: "page" as const,
        items: [{ jobId: secondJobId, lastModifiedAt: "2026-08-16T10:00:00.000Z" }],
        hasMore: false,
      })),
    };
    await expect(
      createPublicJobSitemapReadHandler(reader, () => now)(event(`cursor=${cursor}`), {} as never),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(reader.list).toHaveBeenCalledWith({
      jobId: firstJobId,
      lastModifiedAt: "2026-08-16T11:00:00.000Z",
    });

    for (const query of ["cursor=", "cursor=not-valid-json", `cursor=${cursor}&extra=true`]) {
      const rejected = await createPublicJobSitemapReadHandler(reader, () => now)(
        event(query),
        {} as never,
      );
      expect(rejected.statusCode).toBe(400);
      expect(rejected.headers?.["cache-control"]).toBe("no-store");
    }
    expect(reader.list).toHaveBeenCalledTimes(1);
  });

  it("converts dependency and malformed projection failures to 503, never an empty success", async () => {
    for (const reader of [
      { list: vi.fn().mockRejectedValue(new Error("database unavailable")) },
      {
        list: vi.fn(async () => ({
          kind: "page" as const,
          items: [{ jobId: firstJobId, lastModifiedAt: "2099-01-01T00:00:00.000Z" }],
          hasMore: false,
        })),
      },
    ]) {
      const result = await createPublicJobSitemapReadHandler(reader, () => now)(
        event(),
        {} as never,
      );
      expect(result).toMatchObject({
        statusCode: 503,
        headers: { "cache-control": "no-store", "retry-after": "5" },
      });
      expect(result.body).not.toContain('"items":[]');
      expect(result.body).not.toContain("database unavailable");
    }
  });

  it("treats an invalid server clock as availability failure", async () => {
    const reader = { list: vi.fn() };
    const result = await createPublicJobSitemapReadHandler(reader, () => new Date(Number.NaN))(
      event(),
      {} as never,
    );
    expect(result.statusCode).toBe(503);
    expect(reader.list).not.toHaveBeenCalled();
  });
});
