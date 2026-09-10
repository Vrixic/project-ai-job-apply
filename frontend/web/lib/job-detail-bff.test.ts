import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getJobDetail } from "../app/api/platform/jobs/[jobId]/route";
import { rejectJobDetailInput, validateJobDetailResponse } from "./job-detail-bff";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock("./auth0", () => ({
  getLazyAuth0Session: () => ({
    getSession: mocks.getSession,
    getAccessToken: mocks.getAccessToken,
  }),
}));

const jobId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
const canonicalJobId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3";
const privateCanary = "private-job-detail-canary";
const validateProblemDetails = compileComponentValidator("ProblemDetails");
const detail = {
  id: jobId,
  company: { id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2", name: "Synthetic Company" },
  title: "Synthetic Software Engineer",
  locations: ["Remote - US"],
  description: "Synthetic plain-text description.",
  status: "active",
  firstObservedAt: "2026-09-01T12:00:00.000Z",
  lastVerifiedAt: "2026-09-10T12:00:00.000Z",
  expiresAt: "2026-10-10T12:00:00.000Z",
  sources: [
    {
      provider: "greenhouse",
      provenance: "permitted_api",
      canonicalUrl: "https://boards.example.test/synthetic/jobs/42",
      firstObservedAt: "2026-09-01T12:00:00.000Z",
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
    },
  ],
};

function request(init: RequestInit = {}, suffix = ""): Request {
  return new Request(`https://candidate.example.test/api/platform/jobs/${jobId}${suffix}`, init);
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function expectProblem(response: Response, status = 503, code = "platform_unavailable") {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain(privateCanary);
  const value: unknown = JSON.parse(text);
  expect(validateProblemDetails(value)).toBe(true);
  expect(value).toMatchObject({
    type: `urn:ai-job-apply:problem:${code}`,
    status,
    code,
  });
}

describe("authenticated job-detail BFF", () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ user: { sub: "synthetic-candidate" } });
    mocks.getAccessToken.mockReset().mockResolvedValue({ token: "synthetic-server-held-token" });
    vi.stubEnv("PLATFORM_API_BASE_URL", "https://platform.example.test");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    "not-a-job",
    "018F92B0-4AD7-7B1D-8F44-B7AE694C85C1",
    "018f92b0-4ad7-4b1d-8f44-b7ae694c85c1",
    "00000000-0000-7000-8000-000000000000",
    `${jobId}/reports`,
    `${jobId}?private=query`,
  ])("rejects an invalid identifier before session or upstream access", async (invalidId) => {
    await expectProblem(
      await getJobDetail(request(), { params: Promise.resolve({ jobId: invalidId }) }),
      400,
      "invalid_request",
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    request({}, "?private=query"),
    request({ method: "POST", body: privateCanary }),
    request({ method: "HEAD" }),
    request({ headers: { "content-length": "1" } }),
    request({ headers: { "content-length": "00" } }),
    request({ headers: { "content-length": "" } }),
    request({ headers: { "transfer-encoding": "chunked" } }),
  ])("rejects any query, body, unsupported method, or ambiguous body metadata", async (value) => {
    await expectProblem(
      await getJobDetail(value, { params: Promise.resolve({ jobId }) }),
      400,
      "invalid_request",
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows only the exact bodyless request, including a declared zero length", () => {
    expect(rejectJobDetailInput(request(), jobId)).toBeUndefined();
    expect(
      rejectJobDetailInput(request({ headers: { "content-length": "0" } }), jobId),
    ).toBeUndefined();
  });

  it("keeps credentials server-held and preserves a legitimate canonical alias response", async () => {
    const aliasDetail = { ...detail, id: canonicalJobId };
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(aliasDetail, { headers: { "x-correlation-id": "detail.safe-123" } }),
      );
    const browserRequest = request({
      headers: { authorization: "Bearer private-browser-token", cookie: "private-browser-cookie" },
    });
    const response = await getJobDetail(browserRequest, { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("detail.safe-123");
    expect(await response.json()).toEqual(aliasDetail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://platform.example.test/v1/jobs/${jobId}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-server-held-token");
    expect(headers.has("cookie")).toBe(false);
    expect(mocks.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("refuses an absent session without acquiring a token or making a network request", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expectProblem(
      await getJobDetail(request(), { params: Promise.resolve({ jobId }) }),
      401,
      "authentication_required",
    );
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a decoded success after the forwarder removes transport and compressed-length headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(detail, {
        headers: {
          "content-encoding": "gzip",
          "content-length": "7",
          "transfer-encoding": "chunked",
        },
      }),
    );
    const response = await getJobDetail(request(), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(200);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("transfer-encoding")).toBe(false);
    expect(await response.json()).toEqual(detail);
  });

  it("contains expired-token and identity-dark failures without network access", async () => {
    mocks.getAccessToken.mockRejectedValueOnce(new Error(privateCanary));
    await expectProblem(
      await getJobDetail(request(), { params: Promise.resolve({ jobId }) }),
      401,
      "session_expired",
    );
    mocks.getSession.mockRejectedValueOnce(new Error(privateCanary));
    await expectProblem(await getJobDetail(request(), { params: Promise.resolve({ jobId }) }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
  ])("projects an upstream %s into an existing fixed problem", async (status, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          type: `urn:ai-job-apply:problem:${code}`,
          title: privateCanary,
          status,
          code,
          detail: privateCanary,
          traceId: privateCanary,
        },
        { status, headers: { "content-type": "application/problem+json" } },
      ),
    );
    await expectProblem(
      await getJobDetail(request(), { params: Promise.resolve({ jobId }) }),
      status,
      code,
    );
  });

  it("contains an invalid upstream success at the route boundary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...detail, contributorId: privateCanary }),
    );
    await expectProblem(await getJobDetail(request(), { params: Promise.resolve({ jobId }) }));
  });

  it("does not expose or redirect an undeclared upstream failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(privateCanary, {
        status: 302,
        headers: { location: `https://private.example.test/${privateCanary}` },
      }),
    );
    const response = await getJobDetail(request(), { params: Promise.resolve({ jobId }) });
    await expectProblem(response);
    expect(response.headers.has("location")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong status", jsonResponse(detail, { status: 201 })],
    ["wrong media", jsonResponse(detail, { headers: { "content-type": "text/plain" } })],
    ["transfer encoding", jsonResponse(detail, { headers: { "transfer-encoding": "chunked" } })],
    ["malformed length", jsonResponse(detail, { headers: { "content-length": privateCanary } })],
    ["empty length", jsonResponse(detail, { headers: { "content-length": "" } })],
    ["declared overflow", jsonResponse(detail, { headers: { "content-length": "1500001" } })],
    ["empty body", new Response(null, { headers: { "content-type": "application/json" } })],
    [
      "invalid JSON",
      new Response(privateCanary, { headers: { "content-type": "application/json" } }),
    ],
    [
      "invalid UTF-8",
      new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    ],
  ])("rejects %s with fixed unavailable copy", async (_case, value) => {
    await expectProblem(await validateJobDetailResponse(value));
  });

  it("accepts exact response length and strips unsafe or unapproved headers", async () => {
    const text = JSON.stringify(detail);
    const length = new TextEncoder().encode(text).byteLength;
    const response = await validateJobDetailResponse(
      jsonResponse(detail, {
        headers: {
          "content-length": String(length),
          "x-correlation-id": privateCanary.repeat(10),
          "set-cookie": privateCanary,
          location: `https://private.example.test/${privateCanary}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("x-correlation-id")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("location")).toBe(false);
    expect(await response.json()).toEqual(detail);
    await expectProblem(
      await validateJobDetailResponse(
        jsonResponse(detail, { headers: { "content-length": String(length + 1) } }),
      ),
    );
  });

  it("stops at the incremental response cap without consuming a later private chunk", async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(
            pulls === 1
              ? new Uint8Array(1_500_000)
              : pulls === 2
                ? new Uint8Array(1)
                : new TextEncoder().encode(privateCanary),
          );
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expectProblem(
      await validateJobDetailResponse(
        new Response(stream, { headers: { "content-type": "application/json" } }),
      ),
    );
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("settles at the body deadline without awaiting hostile cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ start() {}, cancel });
    await expectProblem(
      await validateJobDetailResponse(
        new Response(stream, { headers: { "content-type": "application/json" } }),
        undefined,
        5,
      ),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not await hostile cancellation when response metadata is rejected", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    await expectProblem(
      await validateJobDetailResponse(
        new Response(new ReadableStream<Uint8Array>({ start() {}, cancel }), {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("settles on caller abort and refuses an already-aborted complete response", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const pending = validateJobDetailResponse(
      new Response(new ReadableStream<Uint8Array>({ start() {}, cancel }), {
        headers: { "content-type": "application/json" },
      }),
      abort.signal,
    );
    abort.abort();
    await expectProblem(await pending);
    expect(cancel).toHaveBeenCalledTimes(1);
    await expectProblem(await validateJobDetailResponse(jsonResponse(detail), abort.signal));
  });

  it("preserves an already-sanitized non-success from the session forwarding boundary", async () => {
    const response = jsonResponse({ code: "not_found" }, { status: 404 });
    expect(await validateJobDetailResponse(response)).toBe(response);
  });
});
