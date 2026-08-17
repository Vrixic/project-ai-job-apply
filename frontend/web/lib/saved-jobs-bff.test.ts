import { describe, expect, it } from "vitest";
import { forwardIdempotencyKey, readSavedJobBody, savedJobIdentifier } from "./saved-jobs-bff";

const MAXIMUM_SAVED_JOB_BODY_BYTES = 16 * 1024;

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request("https://web.example.test/api/platform/saved-jobs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(signal ? { signal } : {}),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("saved-jobs BFF boundary", () => {
  it("accepts bounded JSON, safe identifiers, and bounded idempotency keys", async () => {
    const request = new Request("https://web.example.test/api/platform/saved-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "saved-job-create-0001",
      },
      body: JSON.stringify({ jobId: "019d04cf-1f80-7000-8000-000000000012" }),
    });
    await expect(readSavedJobBody(request.clone())).resolves.toEqual({
      body: '{"jobId":"019d04cf-1f80-7000-8000-000000000012"}',
    });
    expect(forwardIdempotencyKey(request)).toBe("saved-job-create-0001");
    expect(savedJobIdentifier("019d04cf-1f80-7000-8000-000000000012")).toBeDefined();
  });

  it("rejects query values, invalid identifiers, missing keys, and unbounded bodies", async () => {
    const query = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs?owner=private", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect("failure" in query && query.failure.status).toBe(400);
    const oversized = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"value":"${"x".repeat(16 * 1024)}"}`,
      }),
    );
    expect("failure" in oversized && oversized.failure.status).toBe(413);
    expect(savedJobIdentifier("../other-owner")).toBeUndefined();
    expect(forwardIdempotencyKey(new Request("https://web.example.test"))).toBeUndefined();
  });

  it("bounds a lengthless stream and does not retain its overflowing chunk", async () => {
    let cancelled = false;
    const result = await readSavedJobBody(
      streamRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAXIMUM_SAVED_JOB_BODY_BYTES));
            controller.enqueue(new TextEncoder().encode("private overflow"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    expect("failure" in result && result.failure.status).toBe(413);
    expect(cancelled).toBe(true);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toContain("private overflow");
      expect(result.failure.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("contains aborted and failed streams without exposing transport details", async () => {
    const failed = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("private stream failure"));
        },
      }),
    );
    const abortController = new AbortController();
    abortController.abort();
    const aborted = streamRequest(
      new ReadableStream<Uint8Array>({
        start() {},
      }),
      {},
      abortController.signal,
    );

    for (const request of [failed, aborted]) {
      const result = await readSavedJobBody(request, 5);
      expect("failure" in result && result.failure.status).toBe(400);
      if ("failure" in result) {
        expect(await result.failure.text()).not.toMatch(/private|stream|abort/i);
      }
    }
  });

  it("times out without awaiting a hostile cancellation promise", async () => {
    let cancellationRequested = false;
    const result = await readSavedJobBody(
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
  });

  it("rejects transfer encoding and malformed declared lengths before reading", async () => {
    let emptyLengthPulls = 0;
    const transferred = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
        body: "{}",
      }),
    );
    const malformedLength = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "private" },
        body: "{}",
      }),
    );
    const emptyLength = await readSavedJobBody(
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
    if ("failure" in emptyLength) {
      expect(emptyLength.failure.headers.get("cache-control")).toBe("no-store");
    }
  });
});
