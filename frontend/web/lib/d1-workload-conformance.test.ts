import { describe, expect, it, vi } from "vitest";
import {
  d1WorkloadConcurrency,
  isD1WorkloadConformanceEnabled,
  runD1ReadWorkload,
  runD1SavedJobLifecycleWorkload,
} from "./d1-workload-conformance";

const appBaseUrl = "http://localhost:3000";
const baseUrl = "https://development.example.test";

function request(confirmation = "run-d1-development-read-workload-v1"): Request {
  return new Request(`${appBaseUrl}/api/d1-conformance/workload`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appBaseUrl },
    body: JSON.stringify({ confirmation }),
  });
}

function dependencies(fetch: typeof globalThis.fetch, enabled = true) {
  return {
    appBaseUrl,
    auth0: {
      getAccessToken: async () => ({ token: "server-held-secret-token" }),
      getSession: async () => ({ user: { sub: "synthetic-user" } }),
    },
    baseUrl,
    concurrency: 2,
    enabled,
    fetch,
  };
}

const preference = {
  id: "018f0000-0000-7000-8000-000000000000",
  version: 1,
  updatedAt: "2026-08-23T12:00:00.000Z",
  targetRoles: ["Synthetic role"],
  locations: [],
  workModes: ["remote"],
  employmentTypes: ["full_time"],
};
const entitlement = {
  plan: "free",
  accessState: "active",
  grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
  version: 0,
  evaluatedAt: "2026-08-23T12:00:00.000Z",
};

const catalogJobs = [
  {
    id: "018f0000-0000-7000-8000-000000000011",
    company: {
      id: "018f0000-0000-7000-8000-000000000021",
      name: "Synthetic Company One",
      verifiedDomain: "one.example.test",
    },
    title: "Synthetic Engineer One",
    locations: ["Remote - US"],
    department: "Engineering",
    status: "active",
    firstObservedAt: "2026-08-23T12:00:00.000Z",
    lastVerifiedAt: "2026-08-23T12:00:00.000Z",
    expiresAt: "2026-09-23T12:00:00.000Z",
  },
  {
    id: "018f0000-0000-7000-8000-000000000012",
    company: {
      id: "018f0000-0000-7000-8000-000000000022",
      name: "Synthetic Company Two",
    },
    title: "Synthetic Engineer Two",
    locations: ["New York, NY"],
    status: "active",
    firstObservedAt: "2026-08-23T12:00:00.000Z",
    lastVerifiedAt: "2026-08-23T12:00:00.000Z",
    expiresAt: "2026-09-23T12:00:00.000Z",
  },
];

function savedJob(
  job: (typeof catalogJobs)[number] | undefined = catalogJobs[0],
  id = "018f0000-0000-7000-8000-000000000031",
) {
  if (!job) throw new Error("The synthetic catalog fixture is missing");
  return {
    id,
    requestedJobId: job.id,
    snapshot: {
      jobIdAtSave: job.id,
      company: job.company,
      title: job.title,
      locations: job.locations,
      ...(job.department ? { department: job.department } : {}),
      firstObservedAt: job.firstObservedAt,
      lastVerifiedAt: job.lastVerifiedAt,
      expiresAt: job.expiresAt,
    },
    availability: { state: "available", currentJob: job },
    savedAt: "2026-08-24T12:00:00.000Z",
  };
}

function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

describe("D1 deployed read workload conformance", () => {
  it("requires development mode, an explicit switch, and an isolated environment", () => {
    expect(
      isD1WorkloadConformanceEnabled({
        D1_WORKLOAD_ENVIRONMENT: "development",
        ENABLE_D1_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
      }),
    ).toBe(true);
    expect(
      isD1WorkloadConformanceEnabled({
        D1_WORKLOAD_ENVIRONMENT: "staging",
        ENABLE_D1_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
      }),
    ).toBe(true);
    expect(isD1WorkloadConformanceEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      isD1WorkloadConformanceEnabled({
        D1_WORKLOAD_ENVIRONMENT: "production",
        ENABLE_D1_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
      }),
    ).toBe(false);
  });

  it("matches the reviewed gateway concurrency ceiling", () => {
    expect(d1WorkloadConcurrency("development")).toBe(2);
    expect(d1WorkloadConcurrency("staging")).toBe(5);
    expect(d1WorkloadConcurrency("production")).toBe(0);
  });

  it("fails closed before traffic when disabled, unconfirmed, or cross-origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await runD1ReadWorkload(request(), dependencies(fetch, false))).status).toBe(404);
    expect(
      (await runD1ReadWorkload(request("wrong-confirmation"), dependencies(fetch))).status,
    ).toBe(400);
    const crossOrigin = new Request(`${appBaseUrl}/api/d1-conformance/workload`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://other.example.test" },
      body: JSON.stringify({ confirmation: "run-d1-development-read-workload-v1" }),
    });
    expect((await runD1ReadWorkload(crossOrigin, dependencies(fetch))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs the fixed aggregate-only profile through validated D1 reads", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.pathname === "/health/live" || url.pathname === "/health/ready") {
        return Response.json({ status: "ok" });
      }
      if (!authorization) {
        return Response.json({ state: "denied" }, { status: 401 });
      }
      if (url.pathname === "/v1/me/job-preferences") return Response.json(preference);
      if (url.pathname === "/v1/entitlements") return Response.json(entitlement);
      if (url.pathname === "/v1/jobs/search") return Response.json({ items: [] });
      if (url.pathname === "/v1/saved-jobs/search") return Response.json({ items: [] });
      return Response.json({ state: "unexpected" }, { status: 500 });
    });

    const result = await runD1ReadWorkload(request(), dependencies(fetch));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({
      state: "passed",
      metrics: {
        profile: "d1_deployed_read_v1",
        baselineContractsValidated: 4,
        publicRequests: 150,
        publicFailures: 0,
        authenticatedRequests: 100,
        authenticatedFailures: 0,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(254);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("server-held-secret-token");
    expect(serialized).not.toContain("Synthetic role");
    expect(serialized).not.toContain("018f0000");
  });

  it("refuses malformed private baselines without entering the load", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ items: [] }));
    const result = await runD1ReadWorkload(request(), dependencies(fetch));
    expect(result.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("D1 deployed saved-job lifecycle conformance", () => {
  function lifecycleRequest(confirmation = "run-d1-development-saved-job-lifecycle-v1"): Request {
    return new Request(`${appBaseUrl}/api/d1-conformance/saved-job-workload`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appBaseUrl },
      body: JSON.stringify({ confirmation }),
    });
  }

  it("creates, replays, rejects a conflict, observes, and removes one unsaved job", async () => {
    let current: ReturnType<typeof savedJob> | undefined;
    let idempotentJobId: string | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method;
      if (url.pathname === "/v1/jobs/search") return privateJson({ items: catalogJobs });
      if (url.pathname === "/v1/saved-jobs/search") {
        return privateJson({ items: current ? [current] : [] });
      }
      if (url.pathname === "/v1/saved-jobs" && method === "POST") {
        const jobId = (JSON.parse(String(init?.body)) as { jobId: string }).jobId;
        if (idempotentJobId && jobId !== idempotentJobId) {
          return privateJson(
            {
              type: "urn:ai-job-apply:problem:idempotency_conflict",
              title: "Idempotency key conflict",
              status: 409,
              code: "idempotency_conflict",
              traceId: "synthetic-trace",
            },
            409,
          );
        }
        idempotentJobId = jobId;
        current ??= savedJob();
        return privateJson(current, 201);
      }
      if (url.pathname === `/v1/saved-jobs/${current?.id}` && method === "DELETE") {
        current = undefined;
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      }
      return privateJson({ state: "unexpected" }, 500);
    });

    const result = await runD1SavedJobLifecycleWorkload(lifecycleRequest(), dependencies(fetch));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      state: "passed",
      metrics: {
        profile: "d1_deployed_saved_job_lifecycle_v1",
        writesSucceeded: 1,
        idempotentReplays: 1,
        expectedConflicts: 1,
        cleanupDeletes: 1,
        postCleanupAbsent: true,
      },
    });
    expect(current).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it("fails closed and removes its owned association when a later assertion fails", async () => {
    let current: ReturnType<typeof savedJob> | undefined;
    let createCalls = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method;
      if (url.pathname === "/v1/jobs/search") return privateJson({ items: catalogJobs });
      if (url.pathname === "/v1/saved-jobs/search") {
        return privateJson({ items: current ? [current] : [] });
      }
      if (url.pathname === "/v1/saved-jobs" && method === "POST") {
        createCalls += 1;
        current ??= savedJob();
        return createCalls === 1 ? privateJson(current, 201) : privateJson({}, 500);
      }
      if (url.pathname === `/v1/saved-jobs/${current?.id}` && method === "DELETE") {
        current = undefined;
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      }
      return privateJson({}, 500);
    });

    const result = await runD1SavedJobLifecycleWorkload(lifecycleRequest(), dependencies(fetch));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      state: "workload_inconclusive",
      metrics: { cleanupAttempted: true, cleanupSucceeded: true },
    });
    expect(current).toBeUndefined();
  });

  it("reports a missing write grant without claiming or attempting cleanup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/v1/jobs/search") return privateJson({ items: catalogJobs });
      if (url.pathname === "/v1/saved-jobs/search") return privateJson({ items: [] });
      if (url.pathname === "/v1/saved-jobs" && init?.method === "POST") {
        return privateJson(
          {
            type: "urn:ai-job-apply:problem:insufficient_scope",
            title: "Insufficient scope",
            status: 403,
            code: "insufficient_scope",
            traceId: "synthetic-trace",
          },
          403,
        );
      }
      return privateJson({}, 500);
    });

    const result = await runD1SavedJobLifecycleWorkload(lifecycleRequest(), dependencies(fetch));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({
      state: "write_scope_required",
      metrics: {
        profile: "d1_deployed_saved_job_lifecycle_v1",
        failureStage: "create_authorization",
        observedStatus: 403,
        cleanupRequired: false,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("requires its distinct explicit confirmation before traffic", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await runD1SavedJobLifecycleWorkload(
      lifecycleRequest("run-d1-development-read-workload-v1"),
      dependencies(fetch),
    );
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
