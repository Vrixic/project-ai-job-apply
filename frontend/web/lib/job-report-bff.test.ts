import type { JobReport, ProblemDetails } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import {
  jobReportIdempotencyKey,
  jobReportJobId,
  readJobReportRequest,
  validateJobReportResponse,
} from "./job-report-bff";

const JOB_ID = "019d04cf-1f80-7000-8000-000000000012";
const CANONICAL_JOB_ID = "019d04cf-1f80-7000-8000-000000000013";

function report(overrides: Partial<JobReport> = {}): JobReport {
  return {
    id: "019d04cf-1f80-7000-8000-000000000014",
    requestedJobId: JOB_ID,
    canonicalJobId: CANONICAL_JOB_ID,
    reason: "job_closed",
    createdAt: "2026-08-16T12:00:00.000Z",
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://web.example.test/api/platform/jobs/${JOB_ID}/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function streamRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
  return new Request(`https://web.example.test/api/platform/jobs/${JOB_ID}/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    ...(signal ? { signal } : {}),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The BFF response did not settle")), 250);
  });
  try {
    return await Promise.race([promise, watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("job-report BFF", () => {
  it("accepts only the exact lowercase UUIDv7, fixed request, and bounded idempotency key", async () => {
    const candidate = request(
      { reason: "job_closed" },
      { "idempotency-key": "job-report-command-0001" },
    );
    expect(jobReportJobId(JOB_ID)).toBe(JOB_ID);
    expect(jobReportJobId(JOB_ID.toUpperCase())).toBeUndefined();
    expect(jobReportJobId("019d04cf-1f80-4000-8000-000000000012")).toBeUndefined();
    expect(jobReportIdempotencyKey(candidate)).toBe("job-report-command-0001");
    await expect(readJobReportRequest(candidate)).resolves.toEqual({
      body: '{"reason":"job_closed"}',
      report: { reason: "job_closed" },
    });
  });

  it.each([
    ["free text", { reason: "job_closed", details: "private candidate narrative" }],
    ["owner identity", { reason: "job_closed", ownerUserId: JOB_ID }],
    ["unknown reason", { reason: "employer_was_rude" }],
    ["missing reason", {}],
    ["non-object", ["job_closed"]],
  ])("rejects a request containing %s", async (_label, body) => {
    const result = await readJobReportRequest(request(body));
    expect("failure" in result && result.failure.status).toBe(400);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toContain("private candidate narrative");
    }
  });

  it("rejects query input, unsupported media, transfer encoding, malformed keys, and oversized bodies", async () => {
    const query = await readJobReportRequest(
      new Request(`https://web.example.test/api/platform/jobs/${JOB_ID}/reports?owner=other`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"reason":"job_closed"}',
      }),
    );
    const media = await readJobReportRequest(
      new Request(`https://web.example.test/api/platform/jobs/${JOB_ID}/reports`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: '{"reason":"job_closed"}',
      }),
    );
    const transferred = await readJobReportRequest(
      request('{"reason":"job_closed"}', { "transfer-encoding": "chunked" }),
    );
    const oversized = await readJobReportRequest(
      request(`{"reason":"job_closed","padding":"${"x".repeat(1024)}"}`),
    );
    expect("failure" in query && query.failure.status).toBe(400);
    expect("failure" in media && media.failure.status).toBe(415);
    expect("failure" in transferred && transferred.failure.status).toBe(400);
    expect("failure" in oversized && oversized.failure.status).toBe(413);
    expect(jobReportIdempotencyKey(request({ reason: "job_closed" }))).toBeUndefined();
    expect(
      jobReportIdempotencyKey(request({ reason: "job_closed" }, { "idempotency-key": "short" })),
    ).toBeUndefined();
  });

  it("stops a missing-length stream immediately after the body exceeds its bound", async () => {
    let cancelled = false;
    const oversized = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1025));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    expect(oversized.headers.get("content-length")).toBeNull();
    const result = await readJobReportRequest(oversized);
    expect("failure" in result && result.failure.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("times out and cancels a stalled stream without exposing stream details", async () => {
    let cancelled = false;
    const stalled = streamRequest(
      new ReadableStream<Uint8Array>({
        start() {},
        cancel() {
          cancelled = true;
        },
      }),
    );
    const result = await readJobReportRequest(stalled, 5);
    expect("failure" in result && result.failure.status).toBe(400);
    expect(cancelled).toBe(true);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toMatch(/stalled|stream|timeout/i);
    }
  });

  it("contains read errors and an already-aborted request as declared private failures", async () => {
    const failed = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("private transport failure"));
        },
      }),
    );
    const abortController = new AbortController();
    abortController.abort();
    const aborted = streamRequest(
      new ReadableStream<Uint8Array>({ start() {} }),
      abortController.signal,
    );
    for (const candidate of [failed, aborted]) {
      const result = await readJobReportRequest(candidate, 5);
      expect("failure" in result && result.failure.status).toBe(400);
      if ("failure" in result) {
        expect(await result.failure.text()).not.toContain("private transport failure");
      }
    }
  });

  it("returns an exact no-store response bound to requested job and reason", async () => {
    const response = await validateJobReportResponse(
      Response.json(report(), {
        status: 201,
        headers: { "x-correlation-id": "correlation-1" },
      }),
      JOB_ID,
      "job_closed",
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("correlation-1");
    expect(await response.json()).toEqual(report());
  });

  it.each([
    ["wrong requested identity", report({ requestedJobId: CANONICAL_JOB_ID })],
    ["wrong reason", report({ reason: "suspected_scam" })],
    ["impossible time", report({ createdAt: "2026-02-31T12:00:00.000Z" })],
    ["private field", { ...report(), reporterEmail: "private@example.test" }],
  ])("fails closed on a %s success body", async (_label, body) => {
    const response = await validateJobReportResponse(
      Response.json(body, { status: 201 }),
      JOB_ID,
      "job_closed",
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private@example|000000000013.*requested/i);
  });

  it("rejects wrong media, oversized, and stalled responses", async () => {
    const wrongMedia = await validateJobReportResponse(
      new Response(JSON.stringify(report()), {
        status: 201,
        headers: { "content-type": "text/plain" },
      }),
      JOB_ID,
      "job_closed",
    );
    const oversized = await validateJobReportResponse(
      new Response("{}", {
        status: 201,
        headers: { "content-type": "application/json", "content-length": "20000" },
      }),
      JOB_ID,
      "job_closed",
    );
    const stalled = await validateJobReportResponse(
      new Response(new ReadableStream({ start() {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
      JOB_ID,
      "job_closed",
      5,
    );
    expect(wrongMedia.status).toBe(503);
    expect(oversized.status).toBe(503);
    expect(stalled.status).toBe(503);
  });

  it("does not await hostile cancellation when response metadata is rejected", async () => {
    let cancelled = false;
    const hostile = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });

    const response = await settleWithin(
      validateJobReportResponse(
        new Response(hostile, {
          status: 201,
          headers: { "content-type": "text/plain" },
        }),
        JOB_ID,
        "job_closed",
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: 503,
      code: "job_reporting_unavailable",
      title: "Job reporting unavailable",
    });
  });

  it("does not await hostile cancellation after a streamed response exceeds its bound", async () => {
    let cancelled = false;
    const hostile = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });

    const response = await settleWithin(
      validateJobReportResponse(
        new Response(hostile, {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
        JOB_ID,
        "job_closed",
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("response body is too large");
  });

  it("contains a hostile cancellation rejection when a response times out", async () => {
    let cancelled = false;
    const privateCanary = "private cancellation transport failure";
    const hostile = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
        return Promise.reject(new Error(privateCanary));
      },
    });

    const response = await settleWithin(
      validateJobReportResponse(
        new Response(hostile, {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
        JOB_ID,
        "job_closed",
        5,
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(privateCanary);
  });

  it("preserves only a declared upstream problem and removes its detail", async () => {
    const upstream: ProblemDetails = {
      type: "urn:ai-job-apply:problem:job_already_reported",
      title: "hostile private title",
      status: 409,
      code: "job_already_reported",
      traceId: "trace-1",
      detail: "private upstream implementation detail",
    };
    const response = await validateJobReportResponse(
      Response.json(upstream, {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      }),
      JOB_ID,
      "job_closed",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      type: "urn:ai-job-apply:problem:job_already_reported",
      title: "Job already reported",
      status: 409,
      code: "job_already_reported",
      traceId: "trace-1",
    });
  });

  it.each([
    [
      "private extra field",
      {
        type: "urn:ai-job-apply:problem:job_reporting_unavailable",
        title: "Unavailable",
        status: 503,
        code: "job_reporting_unavailable",
        traceId: "trace-2",
        databaseDetail: "must-not-leak",
      },
      503,
    ],
    [
      "status mismatch",
      {
        type: "urn:ai-job-apply:problem:job_already_reported",
        title: "Already reported",
        status: 409,
        code: "job_already_reported",
        traceId: "trace-3",
      },
      404,
    ],
    [
      "undeclared code",
      {
        type: "urn:ai-job-apply:problem:private_database_failure",
        title: "Private database failure",
        status: 503,
        code: "private_database_failure",
        traceId: "trace-4",
      },
      503,
    ],
  ])("replaces an invalid upstream problem: %s", async (_label, body, status) => {
    const response = await validateJobReportResponse(
      Response.json(body, {
        status,
        headers: { "content-type": "application/problem+json" },
      }),
      JOB_ID,
      "job_closed",
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("must-not-leak");
    expect(text).not.toContain("private_database_failure");
  });
});
