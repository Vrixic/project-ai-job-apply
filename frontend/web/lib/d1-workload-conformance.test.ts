import { describe, expect, it, vi } from "vitest";
import {
  d1WorkloadConcurrency,
  isD1WorkloadConformanceEnabled,
  runD1ReadWorkload,
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
