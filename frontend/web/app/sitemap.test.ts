import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap, { dynamic } from "./sitemap.js";

const jobId = "018f6f6e-7b2a-7c00-8000-000000000001";
const nextJobId = "018f6f6e-7b2a-7c00-8000-000000000065";
const previousOrigin = process.env.APP_BASE_URL;
const previousIndexing = process.env.PUBLIC_JOB_INDEXING_ENABLED;
const previousPlatform = process.env.PLATFORM_API_BASE_URL;

afterEach(() => {
  process.env.APP_BASE_URL = previousOrigin;
  process.env.PUBLIC_JOB_INDEXING_ENABLED = previousIndexing;
  process.env.PLATFORM_API_BASE_URL = previousPlatform;
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

describe("public job sitemap", () => {
  it("is request-time and empty by default without touching the platform", async () => {
    process.env.APP_BASE_URL = "https://jobs.acme-careers.com";
    delete process.env.PUBLIC_JOB_INDEXING_ENABLED;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(dynamic).toBe("force-dynamic");
    await expect(sitemap()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only the configured canonical origin and follows bounded feed pagination", async () => {
    process.env.APP_BASE_URL = "https://careers.acme-candidate.com";
    process.env.PUBLIC_JOB_INDEXING_ENABLED = "true";
    process.env.PLATFORM_API_BASE_URL = "https://api.acme-candidate.com";
    const firstItems = Array.from({ length: 100 }, (_, index) => ({
      jobId: `018f6f6e-7b2a-7c00-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      lastModifiedAt: new Date(Date.UTC(2026, 7, 16, 11, 0, 0) - index * 1_000).toISOString(),
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: firstItems, nextCursor: "a".repeat(32) }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ jobId: nextJobId, lastModifiedAt: "2026-08-16T10:00:00.000Z" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sitemap();
    expect(result).toHaveLength(101);
    expect(result[0]).toEqual({
      url: `https://careers.acme-candidate.com/jobs/${firstItems[0]?.jobId}`,
      lastModified: firstItems[0]?.lastModifiedAt,
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      "https://api.acme-candidate.com/v1/public/jobs/sitemap",
    );
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe(
      `https://api.acme-candidate.com/v1/public/jobs/sitemap?cursor=${"a".repeat(32)}`,
    );
  });

  it("fails closed when the enabled feed is unavailable or malformed", async () => {
    process.env.APP_BASE_URL = "https://careers.acme-candidate.com";
    process.env.PUBLIC_JOB_INDEXING_ENABLED = "true";
    process.env.PLATFORM_API_BASE_URL = "https://api.acme-candidate.com";
    for (const response of [
      new Response(null, { status: 503 }),
      jsonResponse({ items: [{ jobId, lastModifiedAt: "2099-01-01T00:00:00.000Z" }] }),
      jsonResponse({ items: [], nextCursor: "a".repeat(32) }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(sitemap()).rejects.toThrow("Public job sitemap is unavailable");
    }
  });

  it("cancels an invalid upstream body before failing closed", async () => {
    process.env.APP_BASE_URL = "https://careers.acme-candidate.com";
    process.env.PUBLIC_JOB_INDEXING_ENABLED = "true";
    process.env.PLATFORM_API_BASE_URL = "https://api.acme-candidate.com";
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"items":[]}'));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    await expect(sitemap()).rejects.toThrow("Public job sitemap is unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
