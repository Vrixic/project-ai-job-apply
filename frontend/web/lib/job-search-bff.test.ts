import { describe, expect, it } from "vitest";
import { readJobSearchBffBody } from "./job-search-bff";

const MAXIMUM_JOB_SEARCH_BODY_BYTES = 64 * 1024;

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request("https://web.example.test/api/platform/jobs/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(signal ? { signal } : {}),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("job-search BFF boundary", () => {
  it("accepts one bounded JSON body without placing search text in a URL", async () => {
    const result = await readJobSearchBffBody(
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ query: "synthetic engineer" }),
      }),
    );
    expect(result).toEqual({ body: '{"query":"synthetic engineer"}' });
  });

  it("accepts a valid JSON stream at the exact byte limit", async () => {
    const prefix = '{"value":"';
    const suffix = '"}';
    const body = `${prefix}${"x".repeat(
      MAXIMUM_JOB_SEARCH_BODY_BYTES - new TextEncoder().encode(prefix + suffix).byteLength,
    )}${suffix}`;
    expect(new TextEncoder().encode(body).byteLength).toBe(MAXIMUM_JOB_SEARCH_BODY_BYTES);

    const result = await readJobSearchBffBody(
      streamRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        }),
      ),
    );
    expect(result).toEqual({ body });
  });

  it.each([
    [
      "raw query values",
      new Request("https://web.example.test/api/platform/jobs/search?query=private", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      400,
    ],
    [
      "non-JSON media",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "query=private",
      }),
      415,
    ],
    [
      "empty bodies",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      400,
    ],
    [
      "malformed JSON",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"query":"private"',
      }),
      400,
    ],
    [
      "oversized bodies",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(64 * 1024 + 1),
      }),
      413,
    ],
  ])("rejects %s with a value-free problem", async (_label, request, expectedStatus) => {
    const result = await readJobSearchBffBody(request);
    expect("failure" in result && result.failure.status).toBe(expectedStatus);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toContain("private");
      expect(result.failure.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("stops a missing-length stream as soon as it exceeds the runtime cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const result = await readJobSearchBffBody(
      streamRequest(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(new Uint8Array(MAXIMUM_JOB_SEARCH_BODY_BYTES));
              } else if (pulls === 2) {
                controller.enqueue(new Uint8Array(1));
              } else {
                controller.enqueue(new TextEncoder().encode("private trailing bytes"));
              }
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
      ),
    );
    expect("failure" in result && result.failure.status).toBe(413);
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toContain("private trailing bytes");
    }
  });

  it("fails fast on a declared oversize body without pulling the stream", async () => {
    let pulls = 0;
    const result = await readJobSearchBffBody(
      streamRequest(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(new TextEncoder().encode("private body"));
            },
          },
          { highWaterMark: 0 },
        ),
        { "content-length": String(MAXIMUM_JOB_SEARCH_BODY_BYTES + 1) },
      ),
    );
    expect("failure" in result && result.failure.status).toBe(413);
    expect(pulls).toBe(0);
  });

  it("times out without awaiting a hostile cancellation promise", async () => {
    let cancellationRequested = false;
    const result = await readJobSearchBffBody(
      streamRequest(
        new ReadableStream<Uint8Array>({
          start() {},
          cancel() {
            cancellationRequested = true;
            return new Promise<void>(() => undefined);
          },
        }),
      ),
      5,
    );
    expect("failure" in result && result.failure.status).toBe(400);
    expect(cancellationRequested).toBe(true);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toMatch(/timeout|stream|cancel/i);
    }
  });

  it("rejects transfer encoding and malformed lengths with fixed problems", async () => {
    let emptyLengthPulls = 0;
    const transferred = await readJobSearchBffBody(
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
        body: "{}",
      }),
    );
    const malformedLength = await readJobSearchBffBody(
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "private" },
        body: "{}",
      }),
    );
    const emptyLength = await readJobSearchBffBody(
      streamRequest(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              emptyLengthPulls += 1;
              controller.enqueue(new TextEncoder().encode("{}"));
            },
          },
          { highWaterMark: 0 },
        ),
        { "content-length": "" },
      ),
    );
    expect("failure" in transferred && transferred.failure.status).toBe(400);
    expect("failure" in malformedLength && malformedLength.failure.status).toBe(413);
    expect("failure" in emptyLength && emptyLength.failure.status).toBe(413);
    expect(emptyLengthPulls).toBe(0);
    for (const result of [transferred, malformedLength, emptyLength]) {
      if ("failure" in result) {
        expect(await result.failure.text()).not.toContain("private");
        expect(result.failure.headers.get("cache-control")).toBe("no-store");
      }
    }
  });
});
