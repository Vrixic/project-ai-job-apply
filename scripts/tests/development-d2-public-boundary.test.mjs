import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CONFIRMATION,
  parseDevelopmentOrigin,
  runDevelopmentD2PublicBoundary,
} from "../run-development-d2-public-boundary.mjs";

const policy = {
  keyId: "extension-policy-key-v1",
  payload: {
    schemaVersion: 1,
    revision: "extension-policy-r42",
    issuedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T18:00:00.000Z",
    intakeEnabled: true,
    processingEnabled: false,
    clients: { "0.2.0": true },
    providers: { ashby: false, greenhouse: true, lever: false },
    variants: {
      "ashby-job-board-v1": false,
      "greenhouse-board-v1": true,
      "lever-posting-v1": false,
    },
    domains: { "boards.greenhouse.io": true },
  },
  signature: "a".repeat(86),
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "cache-control": "no-store", "content-type": "application/json", ...headers },
    status,
  });
}

test("accepts only the exact regional HTTPS API origin", () => {
  assert.equal(
    parseDevelopmentOrigin("https://abc123.execute-api.us-east-2.amazonaws.com").origin,
    "https://abc123.execute-api.us-east-2.amazonaws.com",
  );
  for (const value of [
    "http://abc123.execute-api.us-east-2.amazonaws.com",
    "https://example.com",
    "https://abc123.execute-api.us-east-1.amazonaws.com",
    "https://abc123.execute-api.us-east-2.amazonaws.com/path",
  ]) {
    assert.throws(() => parseDevelopmentOrigin(value));
  }
});

test("retains only aggregate policy and fail-closed abuse metrics", async () => {
  let clock = 0;
  const result = await runDevelopmentD2PublicBoundary({
    abuseConcurrency: 2,
    confirmation: CONFIRMATION,
    fetchImpl: async (input, init) => {
      clock += 7;
      return new URL(input).pathname.endsWith("contribution-capability-policy")
        ? jsonResponse(policy)
        : jsonResponse({ secret: "must-not-be-retained" }, init.method === "POST" ? 401 : 500);
    },
    now: () => clock,
    origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    pause: async () => undefined,
    policyRequests: 3,
    unauthorizedRequests: 4,
    wallNow: () => new Date("2026-09-04T12:00:00.000Z"),
  });
  assert.equal(result.policyRequests, 3);
  assert.equal(result.unauthorizedContributionRequests, 4);
  assert.equal(result.unauthorizedResponses, 4);
  assert.equal(result.unexpectedResponses, 0);
  assert.equal(result.serverFailures, 0);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-retained|abc123/);
});

test("rejects a policy contract failure and any non-fail-closed abuse response", async () => {
  const common = {
    abuseConcurrency: 1,
    confirmation: CONFIRMATION,
    now: () => 1,
    origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    pause: async () => undefined,
    policyRequests: 1,
    unauthorizedRequests: 1,
  };
  await assert.rejects(
    runDevelopmentD2PublicBoundary({
      ...common,
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    }),
  );
  await assert.rejects(
    runDevelopmentD2PublicBoundary({
      ...common,
      fetchImpl: async (input) =>
        new URL(input).pathname.endsWith("contribution-capability-policy")
          ? jsonResponse(policy)
          : jsonResponse({}, 503),
    }),
  );
});

test("requires the explicit confirmation and bounded workload shape", async () => {
  await assert.rejects(
    runDevelopmentD2PublicBoundary({
      confirmation: "wrong",
      origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    }),
  );
  await assert.rejects(
    runDevelopmentD2PublicBoundary({
      abuseConcurrency: 21,
      confirmation: CONFIRMATION,
      origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    }),
  );
});

test("explicit development mode skips policy reads but performs the actual unauthenticated probes", async () => {
  const calls = [];
  const result = await runDevelopmentD2PublicBoundary({
    capabilityMode: "development",
    confirmation: CONFIRMATION,
    fetchImpl: async (input, init) => {
      calls.push({ path: new URL(input).pathname, init });
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers.authorization, undefined);
      assert.equal(init.body, "{}");
      return jsonResponse({ private: "never-retain-response" }, calls.length % 2 ? 401 : 429);
    },
    origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    pause: async () => assert.fail("Development must not pace nonexistent policy reads"),
  });
  assert.equal(calls.length, 20);
  assert.ok(
    calls.every(({ path, init }) => path === "/v1/jobs/contributions" && init.method === "POST"),
  );
  assert.equal(result.profile, "d2_deployed_unauthenticated_contribution_boundary_v1");
  assert.equal(result.capabilityMode, "development");
  assert.equal(result.policyRequests, 0);
  assert.equal(result.policyChecksSkipped, true);
  assert.equal(result.authenticatedThroughputValidated, false);
  assert.equal(result.policyFailures, undefined);
  assert.equal(result.policyLatency, undefined);
  assert.equal(result.unauthorizedContributionRequests, 20);
  assert.equal(result.unauthorizedResponses, 10);
  assert.equal(result.throttledResponses, 10);
  assert.doesNotMatch(JSON.stringify(result), /never-retain-response|abc123|Authorization/);
});

test("development boundary rejects successful writes, redirects, unavailable routes, and server errors", async () => {
  for (const status of [200, 202, 302, 307, 400, 403, 404, 500, 503]) {
    let requests = 0;
    await assert.rejects(
      runDevelopmentD2PublicBoundary({
        capabilityMode: "development",
        confirmation: CONFIRMATION,
        abuseConcurrency: 1,
        unauthorizedRequests: 1,
        origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
        fetchImpl: async () => {
          requests += 1;
          return jsonResponse({}, status);
        },
      }),
    );
    assert.equal(requests, 1);
  }
});

test("development mode cannot disable probes, claim skipped reads, or bypass confirmation", async () => {
  const common = {
    capabilityMode: "development",
    confirmation: CONFIRMATION,
    origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
    fetchImpl: async () => assert.fail("Invalid workloads must not contact the API"),
  };
  for (const invalid of [
    { confirmation: "wrong" },
    { policyRequests: 1 },
    { policyRequests: -1 },
    { unauthorizedRequests: 0 },
    { unauthorizedRequests: 51 },
    { unauthorizedRequests: 1.5 },
    { abuseConcurrency: 0 },
    { abuseConcurrency: 21 },
    { capabilityMode: "Development" },
    { capabilityMode: "production" },
    { capabilityMode: true },
    { capabilityMode: {} },
    { origin: "https://example.com" },
  ]) {
    await assert.rejects(runDevelopmentD2PublicBoundary({ ...common, ...invalid }));
  }
});

test("the default signed mode cannot skip its policy contract checks", async () => {
  await assert.rejects(
    runDevelopmentD2PublicBoundary({
      confirmation: CONFIRMATION,
      origin: "https://abc123.execute-api.us-east-2.amazonaws.com",
      policyRequests: 0,
      fetchImpl: async () => assert.fail("Invalid workloads must not contact the API"),
    }),
  );
});

test("the CLI rejects duplicate, unknown, incomplete, and unsupported mode arguments locally", () => {
  for (const args of [
    ["--capability-mode", "development", "--capability-mode", "signed"],
    ["--skip-policy", "true"],
    ["--capability-mode"],
    ["--confirm", CONFIRMATION, "--capability-mode", "production"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-development-d2-public-boundary.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "The D2 deployed public-boundary workload did not pass.\n");
  }
});
