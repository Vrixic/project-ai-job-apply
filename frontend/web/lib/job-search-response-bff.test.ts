import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as searchJobs } from "../app/api/platform/jobs/search/route";
import { validateJobSearchResponse } from "./job-search-response-bff";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
}));

vi.mock("./auth0", () => ({ getLazyAuth0Session: () => ({ synthetic: "auth0-client" }) }));
vi.mock("./platform-api", () => ({
  forwardPlatformRequest: mocks.forwardPlatformRequest,
}));

const privateCanary = "private-provider-job-search-response";
const summary = {
  id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
  company: {
    id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
    name: "Synthetic Company",
    verifiedDomain: "example.test",
  },
  title: "Software Engineer",
  locations: ["Remote - US"],
  department: "Engineering",
  status: "active",
  firstObservedAt: "2026-08-11T12:00:00.000Z",
  lastVerifiedAt: "2026-08-11T12:00:00.000Z",
  expiresAt: "2026-09-10T12:00:00.000Z",
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain(privateCanary);
}

describe("job-search success-response boundary", () => {
  beforeEach(() => mocks.forwardPlatformRequest.mockReset());

  it.each([
    { items: [] },
    { items: [summary] },
    { items: [summary], nextCursor: "opaque_cursor_v1.signature_v1" },
  ])("accepts and reprojects an exact job-search page", async (page) => {
    const response = await validateJobSearchResponse(
      jsonResponse(page, { headers: { "x-correlation-id": "request.safe-123" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("request.safe-123");
    expect(await response.json()).toEqual(page);
  });

  it.each([
    { items: [{ ...summary, provider: privateCanary }] },
    { items: [{ ...summary, status: "blocked", title: privateCanary }] },
    { items: [{ ...summary, id: "invalid-private-id", title: privateCanary }] },
    { items: [summary], nextCursor: privateCanary },
    { items: [summary], privateMetadata: privateCanary },
  ])("contains contract-invalid or private success bytes", async (page) => {
    await expectUnavailable(await validateJobSearchResponse(jsonResponse(page)));
  });

  it.each([
    ["wrong status", jsonResponse({ items: [] }, { status: 201 })],
    ["wrong media", new Response("private", { headers: { "content-type": "text/plain" } })],
    [
      "transfer encoding",
      jsonResponse({ items: [] }, { headers: { "transfer-encoding": "chunked" } }),
    ],
    [
      "malformed length",
      jsonResponse({ items: [] }, { headers: { "content-length": privateCanary } }),
    ],
    ["empty length", jsonResponse({ items: [] }, { headers: { "content-length": "" } })],
    [
      "declared oversize",
      jsonResponse({ items: [] }, { headers: { "content-length": String(1024 * 1024 + 1) } }),
    ],
    ["empty body", new Response(null, { headers: { "content-type": "application/json" } })],
    [
      "malformed JSON",
      new Response(`{"value":"${privateCanary}"`, {
        headers: { "content-type": "application/json" },
      }),
    ],
  ])("rejects %s with fixed copy", async (_case, response) => {
    await expectUnavailable(await validateJobSearchResponse(response));
  });

  it("rejects a declared-length mismatch and drops an unsafe correlation identifier", async () => {
    const body = JSON.stringify({ items: [] });
    const response = await validateJobSearchResponse(
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(body).byteLength + 1),
          "x-correlation-id": privateCanary.repeat(20),
        },
      }),
    );
    await expectUnavailable(response);
    expect(response.headers.has("x-correlation-id")).toBe(false);
  });

  it("stops at the incremental cap without consuming a later private chunk", async () => {
    let pulls = 0;
    let cancelled = false;
    const response = await validateJobSearchResponse(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(
                pulls === 1
                  ? new Uint8Array(1024 * 1024)
                  : pulls === 2
                    ? new Uint8Array(1)
                    : new TextEncoder().encode(privateCanary),
              );
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await expectUnavailable(response);
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("bounds a hostile body and cancellation without waiting", async () => {
    let cancelled = false;
    const response = await validateJobSearchResponse(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {},
          cancel() {
            cancelled = true;
            return new Promise<void>(() => undefined);
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
      undefined,
      5,
    );
    await expectUnavailable(response);
    expect(cancelled).toBe(true);
  });

  it("aborts an incomplete response and preserves an already-sanitized non-success", async () => {
    const controller = new AbortController();
    const pending = validateJobSearchResponse(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "content-type": "application/json" },
      }),
      controller.signal,
    );
    controller.abort();
    await expectUnavailable(await pending);

    const sanitized = jsonResponse({ code: "invalid_request" }, { status: 400 });
    expect(await validateJobSearchResponse(sanitized)).toBe(sanitized);
  });

  it("validates the request before forwarding and contains a private route success", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      jsonResponse({ items: [{ ...summary, provider: privateCanary }] }),
    );
    const request = new Request("http://localhost/api/platform/jobs/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "synthetic engineer" }),
    });
    const response = await searchJobs(request);
    await expectUnavailable(response);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      "/v1/jobs/search",
      {
        method: "POST",
        body: '{"query":"synthetic engineer"}',
        signal: request.signal,
        headers: { "content-type": "application/json" },
      },
      expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
    );
  });
});
