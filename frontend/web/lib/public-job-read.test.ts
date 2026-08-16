import { describe, expect, it, vi } from "vitest";
import { fetchPublicJobDetail } from "./public-job-read.js";

const requestedId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
const canonicalId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2";
const now = new Date("2026-08-16T12:00:00.000Z");
const response = {
  requestedJobId: requestedId,
  canonicalJobId: canonicalId,
  isAlias: true,
  job: {
    id: canonicalId,
    companyName: "Synthetic Company",
    title: "Software Engineer",
    locations: ["Remote - US"],
    description: "Use <script>alert('not markup')</script> as plain text.",
    firstObservedAt: "2026-08-10T12:00:00.000Z",
    lastVerifiedAt: "2026-08-16T11:00:00.000Z",
    expiresAt: "2026-08-20T12:00:00.000Z",
  },
};

function json(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, init);
}

describe("fetchPublicJobDetail", () => {
  it("reads anonymously without cookies or authorization", async () => {
    const fetchImplementation = vi.fn(async () => json(response));
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation,
        now: () => now,
      }),
    ).resolves.toEqual({ kind: "available", detail: response });
    const [, init] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|cookie/i);
  });

  it("allows an explicit IPv6 loopback API during local development", async () => {
    const fetchImplementation = vi.fn(async () => json(response));
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "http://[::1]:4000",
        fetchImplementation,
        now: () => now,
      }),
    ).resolves.toEqual({ kind: "available", detail: response });
    const [target] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe(`http://[::1]:4000/v1/public/jobs/${requestedId}`);
  });

  it("maps invalid identifiers and 404 to absence", async () => {
    const fetchImplementation = vi.fn(async () =>
      json(
        {
          type: "urn:ai-job-apply:problem:PUBLIC_JOB_NOT_FOUND",
          title: "Public job not found",
          status: 404,
          code: "PUBLIC_JOB_NOT_FOUND",
          traceId: "request-id",
        },
        { status: 404, headers: { "content-type": "application/problem+json" } },
      ),
    );
    await expect(fetchPublicJobDetail("not-a-job", { fetchImplementation })).resolves.toEqual({
      kind: "absent",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation,
      }),
    ).resolves.toEqual({ kind: "absent" });
  });

  it("does not deindex a job for an unowned or malformed upstream 404", async () => {
    for (const upstream of [
      new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
      json(
        {
          type: "urn:ai-job-apply:problem:OTHER_NOT_FOUND",
          title: "Other resource not found",
          status: 404,
          code: "OTHER_NOT_FOUND",
          traceId: "request-id",
        },
        { status: 404, headers: { "content-type": "application/problem+json" } },
      ),
    ]) {
      await expect(
        fetchPublicJobDetail(requestedId, {
          baseUrl: "https://api.example.com",
          fetchImplementation: async () => upstream,
        }),
      ).rejects.toThrow("Public job page is unavailable");
    }
  });

  it.each([
    { ...response, requestedJobId: canonicalId },
    { ...response, isAlias: false },
    { ...response, job: { ...response.job, id: requestedId } },
    { ...response, job: { ...response.job, expiresAt: now.toISOString() } },
    { ...response, job: { ...response.job, lastVerifiedAt: "2026-08-16T07:00:00-04:00" } },
    { ...response, job: { ...response.job, title: "Engineer\u{e0001}Admin" } },
    { ...response, job: { ...response.job, description: "Visible\u{e007f}hidden" } },
    { ...response, source: { provider: "private" } },
  ])("fails closed on malformed or contradictory responses", async (body) => {
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => json(body),
        now: () => now,
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });

  it("requires the exact JSON response media type", async () => {
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () =>
          new Response(JSON.stringify(response), {
            headers: { "content-type": "text/html" },
          }),
        now: () => now,
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });

  it.each([
    new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "1500001" },
    }),
    new Response(`"${"x".repeat(1_500_000)}"`, {
      headers: { "content-type": "application/json" },
    }),
  ])("enforces the response limit before parsing or rendering", async (upstream) => {
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => upstream,
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });

  it("keeps the abort deadline active while the response body is read", async () => {
    const fetchImplementation = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new Error("upstream stalled")), {
            once: true,
          });
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation,
        timeoutMilliseconds: 5,
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });

  it("does not expose upstream failures or unsafe base URLs", async () => {
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://user:secret@api.example.com",
        fetchImplementation: async () => Promise.reject(new Error("database secret")),
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });
});
