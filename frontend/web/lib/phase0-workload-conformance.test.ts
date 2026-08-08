import { describe, expect, it, vi } from "vitest";
import {
  isPhase0WorkloadConformanceEnabled,
  phase0WorkloadPublicConcurrency,
  runPhase0FoundationWorkload,
} from "./phase0-workload-conformance";

const appBaseUrl = "http://localhost:3000";
const baseUrl = "https://staging.example.test";

function request(confirmation = "run-phase0-staging-foundation-workload-v1"): Request {
  return new Request(`${appBaseUrl}/api/auth-conformance/workload`, {
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
    enabled,
    fetch,
    publicConcurrency: 5,
    sleep: async () => undefined,
  };
}

describe("Phase 0 workload conformance", () => {
  it("requires development mode, an explicit workload switch, and an isolated environment", () => {
    expect(
      isPhase0WorkloadConformanceEnabled({
        ENABLE_PHASE0_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
        PHASE0_WORKLOAD_ENVIRONMENT: "development",
      }),
    ).toBe(true);
    expect(
      isPhase0WorkloadConformanceEnabled({
        ENABLE_PHASE0_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
        PHASE0_WORKLOAD_ENVIRONMENT: "staging",
      }),
    ).toBe(true);
    expect(isPhase0WorkloadConformanceEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      isPhase0WorkloadConformanceEnabled({
        ENABLE_PHASE0_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "production",
        PHASE0_WORKLOAD_ENVIRONMENT: "staging",
      }),
    ).toBe(false);
    expect(
      isPhase0WorkloadConformanceEnabled({
        ENABLE_PHASE0_WORKLOAD_CONFORMANCE: "1",
        NODE_ENV: "development",
        PHASE0_WORKLOAD_ENVIRONMENT: "production",
      }),
    ).toBe(false);
  });

  it("matches the reviewed gateway concurrency ceiling for each isolated environment", () => {
    expect(phase0WorkloadPublicConcurrency("development")).toBe(2);
    expect(phase0WorkloadPublicConcurrency("staging")).toBe(5);
    expect(phase0WorkloadPublicConcurrency("production")).toBe(0);
    expect(phase0WorkloadPublicConcurrency(undefined)).toBe(0);
  });

  it("fails closed before traffic when disabled or unconfirmed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const disabled = await runPhase0FoundationWorkload(request(), dependencies(fetch, false));
    expect(disabled.status).toBe(404);

    const unconfirmed = await runPhase0FoundationWorkload(
      request("wrong-confirmation"),
      dependencies(fetch),
    );
    expect(unconfirmed.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before traffic", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const invalid = new Request(`${appBaseUrl}/api/auth-conformance/workload`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://other.example.test" },
      body: JSON.stringify({ confirmation: "run-phase0-staging-foundation-workload-v1" }),
    });
    const result = await runPhase0FoundationWorkload(invalid, dependencies(fetch));
    expect(result.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs the fixed workload and returns only aggregate results", async () => {
    const operations = new Map<string, string>();
    let operationSequence = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/health/live" || url.pathname === "/health/ready") {
        return Response.json({ status: "ok" }, { status: 200 });
      }
      if (url.pathname === "/v1/me" && !new Headers(init?.headers).has("authorization")) {
        return Response.json({ state: "denied" }, { status: 401 });
      }
      if (url.pathname === "/v1/me/job-preferences" && !init?.method) {
        return Response.json({
          id: "018f0000-0000-7000-8000-000000000000",
          version: 1,
          updatedAt: "2026-07-31T00:00:00Z",
          targetRoles: ["Private synthetic role"],
          locations: ["Private synthetic location"],
          workModes: ["remote"],
          employmentTypes: ["full_time"],
        });
      }
      if (url.pathname === "/v1/me/job-preferences" && init?.method === "PUT") {
        const key = new Headers(init.headers).get("idempotency-key") as string;
        if (!operations.has(key)) {
          operationSequence += 1;
          operations.set(
            key,
            `00000000-0000-4000-8000-${operationSequence.toString().padStart(12, "0")}`,
          );
        }
        return Response.json({ operationId: operations.get(key) });
      }
      if (url.pathname.startsWith("/v1/operations/")) {
        return Response.json({ state: "succeeded" });
      }
      return Response.json({ state: "unexpected" }, { status: 500 });
    });

    const result = await runPhase0FoundationWorkload(request(), dependencies(fetch));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({
      state: "passed",
      metrics: {
        profile: "phase0_staging_foundation_v1",
        publicRequests: 500,
        publicFailures: 0,
        workflowAttempts: 25,
        workflowSucceeded: 25,
        idempotentReplayMatched: true,
      },
    });
    expect(operationSequence).toBe(25);
    expect(fetch).toHaveBeenCalledTimes(552);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("server-held-secret-token");
    expect(serialized).not.toContain("Private synthetic role");
    expect(serialized).not.toContain("Private synthetic location");
    expect(serialized).not.toContain("00000000-0000-4000");
  });
});
