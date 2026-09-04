import assert from "node:assert/strict";
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
