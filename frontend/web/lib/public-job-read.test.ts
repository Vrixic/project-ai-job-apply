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

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function hostileStreamResponse(headers: HeadersInit, status = 200) {
  let pulls = 0;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        pulls += 1;
      },
      cancel() {
        cancellations += 1;
        return new Promise<void>(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, { status, headers }),
    pulls: () => pulls,
    cancellations: () => cancellations,
  };
}

function responseWithReader(
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel">,
  headers: HeadersInit = { "content-type": "application/json" },
) {
  const upstream = new Response(null, { headers });
  Object.defineProperty(upstream, "body", {
    configurable: true,
    value: {
      cancel: vi.fn(async () => undefined),
      getReader: () => reader,
    },
  });
  return upstream;
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
    const [target, init] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe(`https://api.example.com/v1/public/jobs/${requestedId}`);
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
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

  it("settles at the exact deadline when fetch ignores abort", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchImplementation = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
      const rejection = expect(
        fetchPublicJobDetail(requestedId, {
          baseUrl: "https://api.example.com",
          fetchImplementation,
          timeoutMilliseconds: 5,
        }),
      ).rejects.toThrow("Public job page is unavailable");
      await vi.advanceTimersByTimeAsync(4);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a response that arrives after an abort-ignoring fetch times out", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<Response>();
      const upstream = hostileStreamResponse({ "content-type": "application/json" });
      const rejection = expect(
        fetchPublicJobDetail(requestedId, {
          baseUrl: "https://api.example.com",
          fetchImplementation: async () => pending.promise,
          timeoutMilliseconds: 5,
        }),
      ).rejects.toThrow("Public job page is unavailable");
      await vi.advanceTimersByTimeAsync(5);
      await rejection;
      pending.resolve(upstream.response);
      await vi.waitFor(() => expect(upstream.cancellations()).toBe(1));
      expect(upstream.pulls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a hanging read without awaiting hostile cancellation", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined));
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const upstream = responseWithReader({ read, cancel });
      let signal: AbortSignal | undefined;
      const rejection = expect(
        fetchPublicJobDetail(requestedId, {
          baseUrl: "https://api.example.com",
          fetchImplementation: async (_input, init) => {
            signal = init?.signal ?? undefined;
            return upstream;
          },
          timeoutMilliseconds: 5,
        }),
      ).rejects.toThrow("Public job page is unavailable");
      await vi.advanceTimersByTimeAsync(5);
      await rejection;
      expect(read).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels once and redacts a reader failure", async () => {
    const read = vi.fn(async () => {
      throw new Error("synthetic-private-reader-failure");
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => responseWithReader({ read, cancel }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Public job page is unavailable",
        name: "PublicJobPageUnavailableError",
      }),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "wrong media type", headers: { "content-type": "text/html" } },
    {
      label: "transfer encoding",
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    },
    {
      label: "empty declared length",
      headers: { "content-type": "application/json", "content-length": "" },
    },
    {
      label: "decimal declared length",
      headers: { "content-type": "application/json", "content-length": "1.5" },
    },
    {
      label: "negative declared length",
      headers: { "content-type": "application/json", "content-length": "-1" },
    },
    {
      label: "non-numeric declared length",
      headers: { "content-type": "application/json", "content-length": "private" },
    },
    {
      label: "oversize declared length",
      headers: { "content-type": "application/json", "content-length": "1500001" },
    },
  ])("rejects $label before pulling and never awaits cancellation", async ({ headers }) => {
    const upstream = hostileStreamResponse(headers);
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => upstream.response,
      }),
    ).rejects.toThrow("Public job page is unavailable");
    expect(upstream.pulls()).toBe(0);
    expect(upstream.cancellations()).toBe(1);
  });

  it("does not await hostile cancellation for a non-success response", async () => {
    const upstream = hostileStreamResponse({ "content-type": "application/json" }, 503);
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => upstream.response,
      }),
    ).rejects.toThrow("Public job page is unavailable");
    expect(upstream.pulls()).toBe(0);
    expect(upstream.cancellations()).toBe(1);
  });

  it("cancels once on streamed overflow without reading another chunk", async () => {
    const read = vi
      .fn<ReadableStreamDefaultReader<Uint8Array>["read"]>()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1_500_000) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([2]) });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () => responseWithReader({ read, cancel }),
      }),
    ).rejects.toThrow("Public job page is unavailable");
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared-length mismatch", async () => {
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () =>
          new Response("{}", {
            headers: { "content-type": "application/json", "content-length": "3" },
          }),
      }),
    ).rejects.toThrow("Public job page is unavailable");
  });

  it("accepts a valid response at the exact byte limit", async () => {
    const serialized = JSON.stringify(response);
    const body = `${serialized}${" ".repeat(1_500_000 - new TextEncoder().encode(serialized).length)}`;
    await expect(
      fetchPublicJobDetail(requestedId, {
        baseUrl: "https://api.example.com",
        fetchImplementation: async () =>
          new Response(body, {
            headers: {
              "content-type": "application/json",
              "content-length": "1500000",
            },
          }),
        now: () => now,
      }),
    ).resolves.toEqual({ kind: "available", detail: response });
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
