import assert from "node:assert/strict";
import test from "node:test";
import {
  createD2WorkloadSessionOperator,
  D2_WORKLOAD_SOURCE,
  D2_WORKLOAD_TITLE,
  PROCESSING_CONFIRMATION,
  sanitizeD2WorkloadResult,
  validateD2WorkloadPreview,
} from "../lib/d2-workload-session-operator.mjs";

process.env.NODE_ENV = "test";
const NOW = Date.parse("2026-09-15T16:00:00.000Z");
const recoveryMocks = {
  preserve: async () => ({ synthetic: true }),
  complete: async () => {},
};
const configuration = {
  issuer: "https://synthetic-d2.us.auth0.com/",
  audience: "synthetic-api",
  clientId: "syntheticClient123",
};
function fixture() {
  const claims = {
    iss: configuration.issuer,
    sub: "auth0|synthetic-disposable",
    aud: configuration.audience,
    azp: configuration.clientId,
    exp: NOW / 1000 + 3600,
    iat: NOW / 1000,
    scope: "jobs:read jobs:contribute profile:write",
  };
  const accessToken = [{ alg: "RS256" }, claims]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .concat("syntheticSignature")
    .join(".");
  return {
    identity: {
      accessToken,
      issuer: configuration.issuer,
      subject: claims.sub,
      authorizedOwner: "Synthetic operator",
      expiresAt: new Date(NOW + 3600_000).toISOString(),
      authTime: new Date(NOW).toISOString(),
      purpose: "d2_workload",
      profile: "d2_disposable_contribution_workload_v1",
    },
    configuration: { ...configuration },
    apiOrigin: "https://synthetic123.execute-api.us-east-2.amazonaws.com",
    ugcPolicyVersion: "synthetic-policy-v1",
  };
}
function preview() {
  return {
    client: { surface: "browser_extension", version: "0.2.0" },
    source: {
      provider: "ashby",
      pageVariant: "ashby-job-board-v1",
      sourceUrl: D2_WORKLOAD_SOURCE,
      externalJobId: "4da2f7a2-3d5a-4652-bf01-aed59f4cb72b",
      adapterVersion: "d2-job-page-v1",
    },
    posting: { title: D2_WORKLOAD_TITLE },
    observedAt: new Date(NOW).toISOString(),
  };
}
function result() {
  return {
    profile: "d2_deployed_disposable_processing_to_review_v1",
    startedAt: new Date(NOW).toISOString(),
    endedAt: new Date(NOW + 1).toISOString(),
    durationMs: 1,
    concurrency: 1,
    requests: 1,
    acknowledgedContributions: 1,
    consentGrants: 2,
    ownerReads: 1,
    idempotentReplays: 1,
    expectedConflicts: 1,
    ambiguousWrites: 0,
    serverFailures: 0,
    cleanupCancellations: 0,
    cleanupWithdrawals: 1,
    processingPolls: 1,
    cleanupPolls: 1,
    cleanupRevocations: 2,
    passed: true,
    cleanupAttempted: true,
    cleanupSucceeded: true,
    processingToReviewObserved: true,
    recoveryRequired: false,
    processingAcceptance: false,
    moderationAcceptance: false,
    publicationAcceptance: false,
    capacityAcceptance: false,
    latency: { p50Ms: 1, p95Ms: 1, maxMs: 1 },
  };
}
const command = (plan) => ({
  confirmation: PROCESSING_CONFIRMATION,
  reviewedScopeSha256: plan.reviewedScopeSha256,
});

test("prepares one private scope and executes only the reviewed processing workload", async () => {
  let scope;
  const operator = createD2WorkloadSessionOperator(fixture(), {
    ...recoveryMocks,
    now: () => NOW,
    run: async (options) => {
      scope = options.scope;
      assert.match(await options.getAccessToken(), /syntheticSignature$/u);
      return { ...result(), token: "secret" };
    },
  });
  const plan = operator.prepare(preview());
  assert.equal(operator.readiness, "prepared");
  assert.equal(plan.limits.totalDeadlineMs, 1200_000);
  assert.equal(plan.readRequests, 1);
  assert.doesNotMatch(
    JSON.stringify(plan),
    /Mintlify|Backend|synthetic-disposable|syntheticSignature/u,
  );
  assert.throws(() => operator.prepare(preview()), /already_prepared/u);
  await assert.rejects(
    operator.execute({ ...command(plan), reviewedScopeSha256: "0".repeat(64) }),
    /not_authorized/u,
  );
  assert.equal(operator.executionAttempted, false);
  const output = await operator.execute(command(plan));
  assert.equal(output.passed, true);
  assert.equal(output.token, undefined);
  assert.equal(scope.schemaVersion, 2);
  assert.equal(scope.capabilityMode, "development");
  assert.match(
    scope.runId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
  assert.equal(operator.executionAttempted, true);
  await assert.rejects(operator.execute(command(plan)), /not_authorized/u);
  assert.equal(operator.close().outcome, "closed");
});

test("rejects altered public source, title, optional fields and nested surplus input", () => {
  for (const mutate of [
    (p) => {
      p.posting.description = "extra";
    },
    (p) => {
      p.posting.title = "Invented";
    },
    (p) => {
      p.client.secret = "extra";
    },
    (p) => {
      p.source.sourceUrl += "?tracking=1";
    },
    (p) => {
      p.source.provider = "lever";
    },
    (p) => {
      p.source.externalJobId = "other";
    },
    (p) => {
      p.extra = true;
    },
    (p) => {
      p.observedAt = new Date(NOW + 1).toISOString();
    },
  ]) {
    const input = preview();
    mutate(input);
    assert.throws(() => validateD2WorkloadPreview(input, NOW), /invalid_workload_setup/u);
  }
});

test("rejects wrong purpose, identity, audience/client, expired or stale sessions", () => {
  for (const mutate of [
    (o) => {
      o.identity.purpose = "candidate_rights";
    },
    (o) => {
      o.identity.profile = "wrong";
    },
    (o) => {
      o.identity.subject = "auth0|other";
    },
    (o) => {
      o.configuration.audience = "different-api";
    },
    (o) => {
      o.configuration.clientId = "differentClient123";
    },
    (o) => {
      o.identity.expiresAt = new Date(NOW + 1000).toISOString();
    },
    (o) => {
      o.identity.authTime = new Date(NOW - 900_001).toISOString();
    },
    (o) => {
      o.extra = true;
    },
  ]) {
    const options = fixture();
    mutate(options);
    assert.throws(() => createD2WorkloadSessionOperator(options, { now: () => NOW }));
  }
});

test("failed or ambiguous runs close credentials while encrypted recovery remains and cannot repeat", async () => {
  for (const run of [
    async () => {
      throw new Error("secret exception");
    },
    async () => ({ ...result(), passed: false, cleanupSucceeded: false, recoveryRequired: true }),
    async () => ({ arbitrary: "secret" }),
  ]) {
    const operator = createD2WorkloadSessionOperator(fixture(), {
      ...recoveryMocks,
      now: () => NOW,
      run,
    });
    const plan = operator.prepare(preview());
    try {
      await operator.execute(command(plan));
    } catch (error) {
      assert.equal(error.message, "workload_failed_recovery_retained");
    }
    assert.equal(operator.readiness, "recovery-required");
    assert.deepEqual(operator.close(), { outcome: "closed", recoveryRequired: true });
    assert.equal(operator.readiness, "closed");
    await assert.rejects(operator.execute(command(plan)), /not_authorized/u);
  }
});

test("running workload is busy and private input cannot be changed through caller references", async () => {
  let resolveRun;
  let captured;
  const options = fixture();
  const operator = createD2WorkloadSessionOperator(options, {
    ...recoveryMocks,
    now: () => NOW,
    run: async (input) => {
      captured = input.scope;
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
  });
  const input = preview();
  const plan = operator.prepare(input);
  input.posting.title = "changed";
  options.identity.accessToken = "changed";
  const pending = operator.execute(command(plan));
  assert.equal(operator.close().outcome, "busy");
  await Promise.resolve();
  assert.equal(captured.preview.posting.title, D2_WORKLOAD_TITLE);
  await assert.rejects(operator.execute(command(plan)), /not_authorized/u);
  resolveRun(result());
  await pending;
});

test("expired preparation never starts requests", async () => {
  let time = NOW;
  let calls = 0;
  const operator = createD2WorkloadSessionOperator(fixture(), {
    ...recoveryMocks,
    now: () => time,
    run: async () => {
      calls++;
      return result();
    },
  });
  const plan = operator.prepare(preview());
  time += 601_000;
  await assert.rejects(operator.execute(command(plan)), /scope_expired/u);
  assert.equal(calls, 0);
  assert.equal(operator.executionAttempted, false);
});

test("projects only fixed aggregates and forbids malformed sensitive fields", () => {
  assert.equal(sanitizeD2WorkloadResult({ ...result(), subject: "secret" }).subject, undefined);
  for (const extra of [
    { failureStage: "secret" },
    { startedAt: "secret" },
    { publicationAcceptance: true },
    { latency: { p50Ms: 1, p95Ms: 1, maxMs: 1, token: "secret" } },
  ])
    assert.throws(() => sanitizeD2WorkloadResult({ ...result(), ...extra }), /result_unavailable/u);
});

test("dependency injection cannot enable runtime bypasses outside tests", () => {
  process.env.NODE_ENV = "development";
  try {
    assert.throws(
      () => createD2WorkloadSessionOperator(fixture(), { run: async () => result() }),
      /test_dependencies_forbidden/u,
    );
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("durable recovery must finish before dispatch and completion marking follows cleanup", async () => {
  const events = [];
  const operator = createD2WorkloadSessionOperator(fixture(), {
    now: () => NOW,
    preserve: async (scope) => {
      events.push("persist");
      assert.equal(scope.preview.posting.title, D2_WORKLOAD_TITLE);
      assert.equal(scope.accessToken, undefined);
      return "opaque";
    },
    run: async () => {
      events.push("dispatch");
      return result();
    },
    complete: async (handle) => {
      assert.equal(handle, "opaque");
      events.push("complete");
    },
  });
  await operator.execute(command(operator.prepare(preview())));
  assert.deepEqual(events, ["persist", "dispatch", "complete"]);
});

test("failed persistence never dispatches and is not falsely reported as cleanup recovery", async () => {
  let calls = 0;
  const operator = createD2WorkloadSessionOperator(fixture(), {
    now: () => NOW,
    preserve: async () => {
      throw new Error("synthetic failure");
    },
    run: async () => {
      calls++;
      return result();
    },
  });
  const cmd = command(operator.prepare(preview()));
  await assert.rejects(operator.execute(cmd), /recovery_unavailable_no_dispatch/u);
  assert.equal(calls, 0);
  assert.equal(operator.executionAttempted, true);
  assert.equal(operator.close().outcome, "closed");
  await assert.rejects(operator.execute(cmd), /not_authorized/u);
});

test("completion marker failure retains encrypted recovery without rerunning", async () => {
  const operator = createD2WorkloadSessionOperator(fixture(), {
    ...recoveryMocks,
    now: () => NOW,
    run: async () => result(),
    complete: async () => {
      throw new Error("synthetic marker failure");
    },
  });
  await assert.rejects(
    operator.execute(command(operator.prepare(preview()))),
    /failed_recovery_retained/u,
  );
  assert.deepEqual(operator.close(), { outcome: "closed", recoveryRequired: true });
  assert.equal(operator.readiness, "closed");
});
