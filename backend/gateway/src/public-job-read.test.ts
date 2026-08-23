import {
  PublicJobDetailProjector,
  type PublicJobDetailReader,
  type PublicJobSourceRecord,
} from "@ai-job-apply/jobs-service";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createPublicJobReadHandler, PublicJobReadCache } from "./public-job-read.js";

const requestedId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1";
const canonicalId = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2";
const now = new Date("2026-08-16T12:00:00.000Z");

function record(id = canonicalId): PublicJobSourceRecord {
  return {
    id,
    company: { name: "Synthetic Company" },
    title: "Software Engineer",
    locations: ["Remote - US"],
    description: "A synthetic public description.",
    status: "active",
    firstObservedAt: new Date("2026-08-10T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-08-16T11:00:00.000Z"),
    expiresAt: new Date("2026-08-20T12:00:00.000Z"),
    validThrough: new Date("2026-08-18T12:00:00.000Z"),
  };
}

function reader(implementation: PublicJobDetailReader["getActiveJob"]): PublicJobDetailReader {
  return { getActiveJob: vi.fn(implementation) };
}

function event(path = `/v1/public/jobs/${requestedId}`): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /v1/public/jobs/{jobId}",
    rawPath: path,
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "000000000000",
      apiId: "local",
      domainName: "example.test",
      domainPrefix: "local",
      http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
      requestId: "request",
      routeKey: "GET /v1/public/jobs/{jobId}",
      stage: "$default",
      time: "16/Aug/2026:12:00:00 +0000",
      timeEpoch: now.getTime(),
    },
    isBase64Encoded: false,
  };
}

function cache(jobReader: PublicJobDetailReader, clock = () => now) {
  return new PublicJobReadCache(new PublicJobDetailProjector(jobReader, clock), {
    capacity: 2,
    positiveTtlMs: 10_000,
    negativeTtlMs: 1_000,
    clock,
  });
}

describe("public job read boundary", () => {
  it("returns the exact canonical alias response without source data", async () => {
    const jobReader = reader(async () => record());
    const result = await createPublicJobReadHandler(cache(jobReader))(event(), {} as never);
    expect(result.statusCode).toBe(200);
    expect(result.headers?.["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(JSON.parse(result.body ?? "null")).toEqual({
      requestedJobId: requestedId,
      canonicalJobId: canonicalId,
      isAlias: true,
      job: {
        id: canonicalId,
        companyName: "Synthetic Company",
        title: "Software Engineer",
        locations: ["Remote - US"],
        description: "A synthetic public description.",
        firstObservedAt: "2026-08-10T12:00:00.000Z",
        lastVerifiedAt: "2026-08-16T11:00:00.000Z",
        expiresAt: "2026-08-20T12:00:00.000Z",
        validThrough: "2026-08-18T12:00:00.000Z",
      },
    });
  });

  it.each([
    ["POST", `/v1/public/jobs/${requestedId}`, "", undefined, "2.0", false],
    ["GET", `/v1/public/jobs/${requestedId.toUpperCase()}`, "", undefined, "2.0", false],
    ["GET", `/v1/public/jobs/${requestedId}`, "x=1", undefined, "2.0", false],
    ["GET", `/v1/public/jobs/${requestedId}`, "", "{}", "2.0", false],
    ["GET", `/v1/public/jobs/${requestedId}`, "", undefined, "1.0", false],
    ["GET", `/v1/public/jobs/${requestedId}`, "", undefined, "2.0", true],
  ])(
    "refuses unsupported request shape without catalog I/O",
    async (method, path, query, body, version, isBase64Encoded) => {
      const jobReader = reader(async () => record());
      const input = event(path);
      input.requestContext.http.method = method;
      input.rawQueryString = query;
      input.version = version;
      input.isBase64Encoded = isBase64Encoded;
      if (body === undefined) delete input.body;
      else input.body = body;
      const result = await createPublicJobReadHandler(cache(jobReader))(input, {} as never);
      expect(result.statusCode).toBe(400);
      expect(jobReader.getActiveJob).not.toHaveBeenCalled();
    },
  );

  it("rejects a contradictory API Gateway route identity", async () => {
    const jobReader = reader(async () => record());
    const input = event();
    input.routeKey = "GET /v1/jobs/{jobId}";
    const result = await createPublicJobReadHandler(cache(jobReader))(input, {} as never);
    expect(result.statusCode).toBe(400);
    expect(jobReader.getActiveJob).not.toHaveBeenCalled();
  });

  it("keeps absence generic and errors private", async () => {
    const missing = await createPublicJobReadHandler(cache(reader(async () => null)))(
      event(),
      {} as never,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain(requestedId);

    const unavailable = await createPublicJobReadHandler(
      cache(reader(async () => Promise.reject(new Error("postgres password leaked")))),
    )(event(), {} as never);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers?.["cache-control"]).toBe("no-store");
    expect(unavailable.body).not.toContain("postgres");
  });
});

describe("PublicJobReadCache", () => {
  it("deduplicates in flight and does not cache failures", async () => {
    let release: ((value: PublicJobSourceRecord | null) => void) | undefined;
    const pending = new Promise<PublicJobSourceRecord | null>((resolve) => (release = resolve));
    const jobReader = reader(
      vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockRejectedValueOnce(new Error("x"))
        .mockResolvedValue(record()),
    );
    const subject = cache(jobReader);
    const first = subject.get(requestedId);
    const replay = subject.get(requestedId);
    expect(jobReader.getActiveJob).toHaveBeenCalledTimes(1);
    release?.(null);
    await expect(Promise.all([first, replay])).resolves.toEqual([
      { kind: "absent" },
      { kind: "absent" },
    ]);

    let current = new Date(now.getTime() + 1_001);
    const failing = new PublicJobReadCache(new PublicJobDetailProjector(jobReader, () => current), {
      capacity: 2,
      positiveTtlMs: 1_000,
      negativeTtlMs: 1,
      clock: () => current,
    });
    await expect(failing.get(requestedId)).rejects.toThrow();
    current = new Date(current.getTime() + 1);
    await expect(failing.get(requestedId)).resolves.toMatchObject({ kind: "available" });
  });

  it("expires positive entries at validThrough and evicts least-recently-used entries", async () => {
    let current = new Date(now);
    const jobReader = reader(async (id) => {
      const value = record(id);
      value.validThrough = new Date(now.getTime() + 500);
      return value;
    });
    const subject = new PublicJobReadCache(new PublicJobDetailProjector(jobReader, () => current), {
      capacity: 2,
      positiveTtlMs: 10_000,
      negativeTtlMs: 10,
      clock: () => current,
    });
    const id2 = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2";
    const id3 = "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3";
    await subject.get(requestedId);
    await subject.get(id2);
    await subject.get(requestedId);
    await subject.get(id3);
    await subject.get(id2);
    expect(jobReader.getActiveJob).toHaveBeenCalledTimes(4);
    current = new Date(now.getTime() + 501);
    await subject.get(requestedId);
    expect(jobReader.getActiveJob).toHaveBeenCalledTimes(5);
  });

  it("never serves an expired positive entry when its refresh fails", async () => {
    let current = new Date(now);
    const jobReader = reader(
      vi
        .fn()
        .mockResolvedValueOnce(record(requestedId))
        .mockRejectedValueOnce(new Error("database unavailable")),
    );
    const subject = new PublicJobReadCache(new PublicJobDetailProjector(jobReader, () => current), {
      capacity: 2,
      positiveTtlMs: 100,
      negativeTtlMs: 10,
      clock: () => current,
    });

    await expect(subject.get(requestedId)).resolves.toMatchObject({ kind: "available" });
    current = new Date(now.getTime() + 101);
    await expect(subject.get(requestedId)).rejects.toThrow("Public job detail is unavailable");
    expect(jobReader.getActiveJob).toHaveBeenCalledTimes(2);
  });

  it("never returns or caches a projection that expires while its shared read is in flight", async () => {
    let current = new Date(now);
    let release: ((value: PublicJobSourceRecord | null) => void) | undefined;
    const pending = new Promise<PublicJobSourceRecord | null>((resolve) => (release = resolve));
    const expiring = record();
    expiring.validThrough = new Date(now.getTime() + 100);
    const jobReader = reader(vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(record()));
    const subject = new PublicJobReadCache(new PublicJobDetailProjector(jobReader, () => current), {
      capacity: 2,
      positiveTtlMs: 10_000,
      negativeTtlMs: 10,
      clock: () => current,
    });

    const first = subject.get(requestedId);
    const overlapping = subject.get(requestedId);
    current = new Date(now.getTime() + 101);
    release?.(expiring);

    await expect(first).rejects.toThrow("Public job cache boundary is invalid");
    await expect(overlapping).rejects.toThrow("Public job cache boundary is invalid");
    await expect(subject.get(requestedId)).resolves.toMatchObject({ kind: "available" });
    expect(jobReader.getActiveJob).toHaveBeenCalledTimes(2);
  });

  it("fails closed on contradictory identity tuples", async () => {
    const handler = createPublicJobReadHandler({
      get: async () =>
        ({
          kind: "available",
          requestedJobId: requestedId,
          canonicalJobId: canonicalId,
          isAlias: false,
          job: { id: canonicalId },
        }) as never,
    });
    const result = await handler(event(), {} as never);
    expect(result.statusCode).toBe(503);
  });

  it("fails closed on malformed or private cache projection fields", async () => {
    const projectedJob = {
      id: canonicalId,
      companyName: "Synthetic Company",
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "A synthetic public description.",
      firstObservedAt: "2026-08-10T12:00:00.000Z",
      lastVerifiedAt: "2026-08-16T11:00:00.000Z",
      expiresAt: "2026-08-20T12:00:00.000Z",
      validThrough: "2026-08-18T12:00:00.000Z",
    };
    for (const job of [
      { ...projectedJob, sourceUrl: "https://private.example.test/source" },
      { ...projectedJob, title: 42 },
      { ...projectedJob, title: "Engineer\u{e0001}Admin" },
    ]) {
      const handler = createPublicJobReadHandler({
        get: async () =>
          ({
            kind: "available",
            requestedJobId: requestedId,
            canonicalJobId: canonicalId,
            isAlias: true,
            job,
          }) as never,
      });
      const result = await handler(event(), {} as never);
      expect(result.statusCode).toBe(503);
      expect(result.headers?.["cache-control"]).toBe("no-store");
      expect(result.body).not.toContain("private.example.test");
    }
  });
});
