import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { contributionCapabilityPolicyDigestInput } from "../../backend/services/jobs/dist/src/contribution-capability-policy.js";
import {
  AUTHORIZED_ACTIONS,
  approvedPreviewDigest,
  CONFIRMATION,
  disposableIdentityDigest,
  LIMITS,
  PROCESSING_ACTIONS,
  PROCESSING_CONFIRMATION,
  PROCESSING_KIND,
  PROCESSING_LIMITS,
  runDevelopmentD2AuthenticatedIntake,
  signedEnvelopeDigest,
} from "../run-development-d2-authenticated-intake.mjs";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const ORIGIN = "https://synthetic123.execute-api.us-east-2.amazonaws.com";
const ISSUER = "https://synthetic-d2.us.auth0.com/";
const CLIENT = "syntheticNativeClient123";
const SUBJECT = "auth0|synthetic-disposable-only";
const PUBLIC_MARKER = "Generated public posting marker not retained in results";
const ids = {
  run: "019919fc-4000-7000-8000-000000000001",
  primary: "019919fc-4000-7000-8000-000000000002",
  secondary: "019919fc-4000-7000-8000-000000000003",
};

function jwt(overrides = {}, header = { alg: "RS256", typ: "JWT" }) {
  return [
    header,
    {
      iss: ISSUER,
      sub: SUBJECT,
      aud: "ai-job-apply-api",
      azp: CLIENT,
      iat: NOW / 1_000 - 60,
      exp: NOW / 1_000 + 3_600,
      scope: "jobs:contribute",
      ...overrides,
    },
  ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .concat("syntheticSignatureNotAcceptedOutsideTheMock")
    .join(".");
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      ...headers,
    },
  });
}
function problem(status, code) {
  return json(
    {
      type: `urn:ai-job-apply:problem:${code}`,
      title: "Generated problem",
      status,
      code,
      traceId: "synthetic-trace",
    },
    status,
    { "content-type": "application/problem+json" },
  );
}

function fixture({
  processing = false,
  development = false,
  processAfterMs = 300_000,
  withdrawalAfterMs = 600_000,
} = {}) {
  const keys = generateKeyPairSync("ed25519");
  const policy = {
    schemaVersion: 1,
    revision: "synthetic-d2-intake-v1",
    issuedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 600_000).toISOString(),
    intakeEnabled: true,
    processingEnabled: false,
    clients: { "0.2.0": true },
    providers: { greenhouse: true, lever: false, ashby: false },
    variants: {
      "greenhouse-board-v1": true,
      "lever-posting-v1": false,
      "ashby-job-board-v1": false,
    },
    domains: {
      "boards.greenhouse.io": false,
      "job-boards.greenhouse.io": true,
      "jobs.lever.co": false,
      "jobs.eu.lever.co": false,
      "jobs.ashbyhq.com": false,
    },
  };
  const envelope = {
    keyId: "synthetic-intake-key-v1",
    payload: policy,
    signature: sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(policy)),
      keys.privateKey,
    ).toString("base64url"),
  };
  const preview = {
    client: { surface: "browser_extension", version: "0.2.0" },
    source: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/12345",
      externalJobId: "12345",
      adapterVersion: "d2-job-page-v1",
    },
    posting: {
      companyName: "Synthetic Company",
      title: "Generated Engineer",
      description: PUBLIC_MARKER,
    },
    observedAt: new Date(NOW - 60_000).toISOString(),
  };
  const scope = {
    schemaVersion: 1,
    kind: "d2_disposable_candidate_authenticated_v1",
    runId: ids.run,
    apiOrigin: ORIGIN,
    issuedAt: new Date(NOW - 10_000).toISOString(),
    expiresAt: new Date(NOW + 600_000).toISOString(),
    disposableCandidate: true,
    identitySha256: disposableIdentityDigest({
      iss: ISSUER,
      sub: SUBJECT,
      aud: "ai-job-apply-api",
      azp: CLIENT,
    }),
    issuer: ISSUER,
    audience: "ai-job-apply-api",
    clientId: CLIENT,
    sourceAuthorized: true,
    actions: [...AUTHORIZED_ACTIONS],
    ugcPolicyVersion: "synthetic-ugc-v1",
    preview,
    previewSha256: approvedPreviewDigest(preview),
    signedPolicySha256: signedEnvelopeDigest(envelope),
    publicKeys: {
      [envelope.keyId]: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    },
    readRequests: 3,
  };
  if (processing) {
    scope.kind = PROCESSING_KIND;
    scope.actions = [...PROCESSING_ACTIONS];
    scope.expiresAt = new Date(NOW + 25 * 60_000).toISOString();
    policy.processingEnabled = true;
    policy.expiresAt = scope.expiresAt;
    envelope.signature = sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(policy)),
      keys.privateKey,
    ).toString("base64url");
    scope.signedPolicySha256 = signedEnvelopeDigest(envelope);
  }
  if (development) {
    scope.schemaVersion = 2;
    scope.capabilityMode = "development";
    delete scope.signedPolicySha256;
    delete scope.publicKeys;
  }
  let clock = 0;
  const calls = [];
  const grants = new Map();
  const revocationReceipts = new Map();
  const revokedConsentIds = new Set();
  let contribution;
  let originalBody;
  let trustCase;
  let withdrawnAt;
  let revoked = 0;
  let hook;
  const options = {
    confirmation: processing ? PROCESSING_CONFIRMATION : CONFIRMATION,
    scope,
    getAccessToken: async () => jwt(),
  };
  const dependencies = {
    now: () => clock,
    wallNow: () => new Date(NOW + clock),
    pause: async (duration) => {
      clock += duration;
    },
    requestTimeoutMs: 30,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, ORIGIN);
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.ok(init.signal instanceof AbortSignal);
      clock += 4;
      const call = {
        path: parsed.pathname,
        init,
        started: clock,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const response = await serve(call);
      return hook ? hook(call, response) : response;
    },
  };
  async function serve(call) {
    const { path, init, body } = call;
    if (path.endsWith("contribution-capability-policy")) {
      assert.equal(init.headers.authorization, undefined);
      return json(envelope);
    }
    assert.equal(init.headers.authorization, `Bearer ${jwt()}`);
    if (path === "/v1/profile/ugc-contribution-consents") {
      const key = init.headers["idempotency-key"];
      if (!grants.has(key))
        grants.set(key, {
          schemaVersion: 1,
          id: grants.size === 0 ? ids.primary : ids.secondary,
          state: "granted",
          documentVersion: body.documentVersion,
          policyVersion: body.policyVersion,
          grantedAt: new Date(NOW + clock).toISOString(),
        });
      return json(grants.get(key), 201);
    }
    if (path.endsWith("/revoke")) {
      const consentId = path.split("/").at(-2);
      assert.ok([ids.primary, ids.secondary].includes(consentId));
      const conflict = revokeConsent(consentId, init.headers["idempotency-key"]);
      if (conflict) return conflict;
      revoked += 1;
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (path === "/v1/jobs/contributions") {
      if (!contribution) {
        contribution = {
          id: body.contributionId,
          state: "queued",
          submittedAt: new Date(NOW + clock).toISOString(),
          updatedAt: new Date(NOW + clock).toISOString(),
        };
        originalBody = JSON.stringify(body);
      } else if (originalBody !== JSON.stringify(body)) return problem(409, "idempotency_conflict");
      return json(contribution, 202);
    }
    if (path.startsWith("/v1/trust/contributions/")) {
      if (!trustCase) return problem(404, "not_found");
      assert.ok(path.includes(contribution.id));
      if (path.endsWith("/withdraw")) {
        assert.deepEqual(body, { expectedVersion: trustCase.version });
        withdrawnAt = clock;
        trustCase = {
          ...trustCase,
          state: "withdrawn",
          version: trustCase.version + 1,
          updatedAt: new Date(NOW + clock).toISOString(),
        };
      }
      return json(trustCase);
    }
    if (path.endsWith("/cancel")) {
      assert.ok(path.includes(contribution.id));
      assert.deepEqual(body, { schemaVersion: 1 });
      // Match the real cancellation adapter: same-key Profile replay succeeds;
      // an independently revoked exact-owner consent is accepted as not_current.
      revokeConsent(ids.primary, `contribution-cancel-${contribution.id}`);
      contribution = {
        ...contribution,
        state: "consent_invalid",
        updatedAt: new Date(NOW + clock).toISOString(),
      };
      return json(contribution);
    }
    if (path === `/v1/jobs/contributions/${contribution?.id}` && init.method === "GET") {
      if (
        processing &&
        clock >= processAfterMs &&
        !trustCase &&
        contribution.state !== "consent_invalid"
      ) {
        contribution.state = "awaiting_trust";
        trustCase = {
          id: "019919fc-4000-8000-8000-000000000004",
          contributionId: contribution.id,
          state: "needs_review",
          version: 1,
          policyVersion: "synthetic-trust-v1",
          appealed: false,
          createdAt: new Date(NOW + clock).toISOString(),
          updatedAt: new Date(NOW + clock).toISOString(),
        };
      }
      if (withdrawnAt !== undefined && clock >= withdrawnAt + withdrawalAfterMs)
        contribution.state = "withdrawn";
      return json(contribution);
    }
    throw new Error("Unexpected mocked route");
  }
  function revokeConsent(consentId, idempotencyKey) {
    if (revocationReceipts.has(idempotencyKey)) {
      return revocationReceipts.get(idempotencyKey) === consentId
        ? undefined
        : problem(409, "ugc_contribution_consent_conflict");
    }
    if (revokedConsentIds.has(consentId)) return problem(409, "ugc_contribution_consent_conflict");
    revocationReceipts.set(idempotencyKey, consentId);
    revokedConsentIds.add(consentId);
    return undefined;
  }
  return {
    options,
    dependencies,
    scope,
    envelope,
    calls,
    grants,
    setHook: (value) => {
      hook = value;
    },
    updateSignature: () => {
      envelope.signature = sign(
        null,
        Buffer.from(contributionCapabilityPolicyDigestInput(envelope.payload)),
        keys.privateKey,
      ).toString("base64url");
      scope.signedPolicySha256 = signedEnvelopeDigest(envelope);
    },
    revoked: () => revoked,
    revocationReceipts,
    revokedConsentIds,
    advanceClock: (duration) => {
      clock += duration;
    },
  };
}

test("executes the exact paced disposable intake lifecycle and retains only aggregates", async () => {
  const f = fixture();
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, true);
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.consentGrants, 2);
  assert.equal(result.ownerReads, 3);
  assert.equal(result.idempotentReplays, 1);
  assert.equal(result.expectedConflicts, 1);
  assert.equal(result.cleanupCancellations, 1);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(result.recoveryRequired, false);
  assert.equal(result.processingAcceptance, false);
  assert.equal(result.moderationAcceptance, false);
  assert.equal(result.publicationAcceptance, false);
  assert.ok(result.requests <= LIMITS.maximumRequests);
  assert.ok(
    f.calls.every(
      (call, index) =>
        index === 0 || call.started - f.calls[index - 1].started >= LIMITS.minimumIntervalMs,
    ),
  );
  const retained = JSON.stringify(result);
  for (const forbidden of [
    SUBJECT,
    ISSUER,
    ORIGIN,
    PUBLIC_MARKER,
    ids.run,
    ids.primary,
    ids.secondary,
    jwt(),
  ]) {
    assert.equal(retained.includes(forbidden), false);
  }
  const writes = f.calls.filter((call) => call.path === "/v1/jobs/contributions");
  assert.equal(new Set(writes.map((call) => call.body.contributionId)).size, 1);
  assert.equal(new Set(writes.map((call) => call.init.headers["idempotency-key"])).size, 1);
  assert.deepEqual(writes[0].body.posting, writes.at(-1).body.posting);
  assert.deepEqual(writes[0].body.source, writes.at(-1).body.source);
});

test("rejects absent, broadened, stale, non-disposable or mismatched scope before networking", async () => {
  const changes = [
    (f) => {
      f.options.confirmation = "wrong";
    },
    (f) => {
      f.scope.disposableCandidate = false;
    },
    (f) => {
      f.scope.sourceAuthorized = false;
    },
    (f) => {
      f.scope.actions.push("publish");
    },
    (f) => {
      f.scope.actions.pop();
    },
    (f) => {
      f.scope.readRequests = 11;
    },
    (f) => {
      f.scope.preview.posting.title = "Changed without approval";
    },
    (f) => {
      f.scope.apiOrigin = "https://other.example";
    },
    (f) => {
      f.scope.apiOrigin = `${ORIGIN}/path`;
    },
    (f) => {
      f.scope.apiOrigin = `${ORIGIN}/`;
    },
    (f) => {
      f.scope.expiresAt = new Date(NOW - 1).toISOString();
    },
    (f) => {
      f.scope.expiresAt = new Date(NOW + 3_600_000).toISOString();
    },
    (f) => {
      f.scope.identitySha256 = "0".repeat(64);
    },
    (f) => {
      f.scope.unreviewedSetting = true;
    },
    (f) => {
      f.scope.publicKeys = { "private-key-v1": "-----BEGIN PRIVATE KEY-----" };
    },
    (f) => {
      f.scope.preview.source.sourceUrl = "http://127.0.0.1/jobs/123";
      f.scope.previewSha256 = approvedPreviewDigest(f.scope.preview);
    },
    (f) => {
      f.scope.preview.posting.description = "<script>bad</script>";
      f.scope.previewSha256 = approvedPreviewDigest(f.scope.preview);
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    await assert.rejects(runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies));
    assert.equal(f.calls.length, 0);
  }
});

test("rejects missing, expired, wrong-account, wrong-client and unsigned tokens without exposing them", async () => {
  for (const token of [
    undefined,
    "not-a-token",
    jwt({ exp: NOW / 1_000 }),
    jwt({ sub: "auth0|another" }),
    jwt({ azp: "otherClient" }),
    jwt({ iss: "https://other.auth0.com/" }),
    jwt({ scope: "jobs:read" }),
    jwt({}, { alg: "none" }),
  ]) {
    const f = fixture();
    f.options.getAccessToken = async () => token;
    await assert.rejects(runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies));
    assert.equal(f.calls.length, 0);
  }
});

test("current processing-active, disabled, expired, mismatched and untrusted signed policies allow no writes", async () => {
  for (const mutate of [
    (f) => {
      f.envelope.payload.processingEnabled = true;
      f.updateSignature();
    },
    (f) => {
      f.envelope.payload.intakeEnabled = false;
      f.updateSignature();
    },
    (f) => {
      f.envelope.payload.clients["0.2.0"] = false;
      f.updateSignature();
    },
    (f) => {
      f.envelope.payload.domains["job-boards.greenhouse.io"] = false;
      f.updateSignature();
    },
    (f) => {
      f.envelope.payload.expiresAt = new Date(NOW - 1).toISOString();
      f.updateSignature();
    },
    (f) => {
      f.scope.signedPolicySha256 = "0".repeat(64);
    },
    (f) => {
      f.envelope.signature = "a".repeat(86);
      f.scope.signedPolicySha256 = signedEnvelopeDigest(f.envelope);
    },
  ]) {
    const f = fixture();
    mutate(f);
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, "policy_preflight");
    assert.equal(result.cleanupAttempted, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.method, "GET");
  }
});

test("retries an ambiguous committed intake with identical identities and preserves its acknowledgement", async () => {
  const f = fixture();
  let fail = true;
  f.setHook((call, response) => {
    if (call.path === "/v1/jobs/contributions" && fail) {
      fail = false;
      throw new Error("synthetic secret error must not escape");
    }
    return response;
  });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, true);
  assert.equal(result.ambiguousWrites, 1);
  assert.equal(result.acknowledgedContributions, 1);
  const attempts = f.calls.filter((call) => call.path === "/v1/jobs/contributions");
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(
    attempts[0].init.headers["idempotency-key"],
    attempts[1].init.headers["idempotency-key"],
  );
  assert.doesNotMatch(JSON.stringify(result), /synthetic secret/);
});

test("bounds a stalled response body, including an ambiguous acknowledgement body", async () => {
  for (const path of ["/v1/extension/contribution-capability-policy", "/v1/jobs/contributions"]) {
    const f = fixture();
    let stalled = false;
    f.setHook((call, response) => {
      if (call.path === path && !stalled) {
        stalled = true;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"incomplete":'));
            },
          }),
          {
            status: response.status,
            headers: { "cache-control": "no-store", "content-type": "application/json" },
          },
        );
      }
      return response;
    });
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, {
      ...f.dependencies,
      requestTimeoutMs: 10,
    });
    assert.equal(result.passed, path === "/v1/jobs/contributions");
    assert.ok(result.durationMs <= LIMITS.totalDeadlineMs);
    if (path.endsWith("contributions")) assert.equal(result.ambiguousWrites, 1);
  }
});

test("a bounded grant timeout preserves the replay key and never generates another contribution", async () => {
  const f = fixture();
  let fail = true;
  f.setHook((call, response) => {
    if (call.path === "/v1/profile/ugc-contribution-consents" && fail) {
      fail = false;
      throw new Error("lost grant");
    }
    return response;
  });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, true);
  assert.equal(f.grants.size, 2);
  const calls = f.calls.filter((call) => call.path === "/v1/profile/ugc-contribution-consents");
  assert.equal(calls[0].init.headers["idempotency-key"], calls[1].init.headers["idempotency-key"]);
  assert.equal(result.cleanupRevocations, 2);
});

test("cleanup conflicts retain the known acknowledgement and require scoped recovery, without Trust/deletion fallback", async () => {
  const f = fixture();
  f.setHook((call, response) =>
    call.path.endsWith("/cancel")
      ? problem(409, "job_contribution_cancellation_conflict")
      : response,
  );
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, false);
  assert.equal(result.failureStage, "cleanup");
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(f.revoked(), 2);
  assert.equal(
    f.calls.some((call) => call.path.includes("trust") || call.init.method === "DELETE"),
    false,
  );
});

test("oversized and malformed responses stop with fixed failure stages while cleaning exact known receipts", async () => {
  for (const malformed of [
    json({ unexpected: PUBLIC_MARKER }),
    json({ id: ids.primary }, 200, { "content-length": "65537" }),
  ]) {
    const f = fixture();
    let replaced = false;
    f.setHook((call, response) => {
      if (
        call.init.method === "GET" &&
        call.path.startsWith("/v1/jobs/contributions/") &&
        !replaced
      ) {
        replaced = true;
        return malformed;
      }
      return response;
    });
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, "owner_read");
    assert.equal(result.acknowledgedContributions, 1);
    assert.equal(result.cleanupSucceeded, true);
    assert.equal(JSON.stringify(result).includes(PUBLIC_MARKER), false);
  }
});

test("reserves a separate bounded cleanup window after the action deadline", async () => {
  const f = fixture();
  let elapsed = false;
  f.setHook((call, response) => {
    if (!elapsed && call.init.method === "GET" && call.path.startsWith("/v1/jobs/contributions/")) {
      elapsed = true;
      f.advanceClock(LIMITS.actionDeadlineMs);
    }
    return response;
  });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.failureStage, "owner_read");
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(result.acknowledgedContributions, 1);
  assert.ok(result.durationMs < LIMITS.totalDeadlineMs);
});

test("same approved run scope reproduces exact recovery identities and never leaks token-provider errors", async () => {
  const first = fixture();
  const second = fixture();
  await runDevelopmentD2AuthenticatedIntake(first.options, first.dependencies);
  await runDevelopmentD2AuthenticatedIntake(second.options, second.dependencies);
  const firstWrite = first.calls.find((call) => call.path === "/v1/jobs/contributions");
  const secondWrite = second.calls.find((call) => call.path === "/v1/jobs/contributions");
  assert.equal(firstWrite.body.contributionId, secondWrite.body.contributionId);
  assert.equal(
    firstWrite.init.headers["idempotency-key"],
    secondWrite.init.headers["idempotency-key"],
  );
  const failed = fixture();
  failed.options.getAccessToken = async () => {
    throw new Error("PRIVATE-PROVIDER-FAILURE");
  };
  await assert.rejects(
    runDevelopmentD2AuthenticatedIntake(failed.options, failed.dependencies),
    (error) => {
      assert.doesNotMatch(error.message, /PRIVATE-PROVIDER-FAILURE/);
      return true;
    },
  );
  assert.equal(failed.calls.length, 0);
});

test("a reused run label cannot cancel a different approved preview", async () => {
  const first = fixture();
  const second = fixture();
  second.scope.preview.posting.title = "Separately approved generated posting";
  second.scope.previewSha256 = approvedPreviewDigest(second.scope.preview);
  await runDevelopmentD2AuthenticatedIntake(first.options, first.dependencies);
  await runDevelopmentD2AuthenticatedIntake(second.options, second.dependencies);
  const previous = first.calls.find((call) => call.path === "/v1/jobs/contributions").body
    .contributionId;
  const current = second.calls.find((call) => call.path === "/v1/jobs/contributions").body
    .contributionId;
  assert.notEqual(previous, current);
  assert.equal(
    second.calls.some((call) => call.path.includes(previous)),
    false,
  );
});

test("processing profile observes one schedule tick then allows two ticks for owner withdrawal", async () => {
  const f = fixture({ processing: true });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.profile, "d2_deployed_disposable_processing_to_review_v1");
  assert.equal(result.passed, true);
  assert.equal(result.processingToReviewObserved, true);
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.cleanupCancellations, 0);
  assert.equal(result.cleanupWithdrawals, 1);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(result.recoveryRequired, false);
  assert.ok(result.durationMs >= 15 * 60_000);
  assert.ok(result.durationMs < PROCESSING_LIMITS.totalDeadlineMs);
  assert.ok(result.requests <= PROCESSING_LIMITS.maximumRequests);
  assert.ok(result.processingPolls <= PROCESSING_LIMITS.maximumReviewPolls);
  assert.ok(result.cleanupPolls <= PROCESSING_LIMITS.maximumCleanupPolls);
  const withdraws = f.calls.filter((call) => call.path.endsWith("/withdraw"));
  assert.equal(withdraws.length, 1);
  assert.deepEqual(withdraws[0].body, { expectedVersion: 1 });
  assert.equal(
    f.calls.some((call) => /reviewer|accept|\/cancel/.test(call.path)),
    false,
  );
  for (const gate of [
    "processingAcceptance",
    "moderationAcceptance",
    "publicationAcceptance",
    "capacityAcceptance",
  ])
    assert.equal(result[gate], false);
  for (const value of [SUBJECT, jwt(), ids.run, ids.primary, ids.secondary, PUBLIC_MARKER])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("processing requires separate exact action authority and a full bounded token/scope window", async () => {
  const changes = [
    (f) => {
      f.options.confirmation = CONFIRMATION;
    },
    (f) => {
      f.scope.actions = [...AUTHORIZED_ACTIONS];
    },
    (f) => {
      f.scope.actions.push("reviewer_accept");
    },
    (f) => {
      f.scope.expiresAt = new Date(NOW + 10 * 60_000).toISOString();
    },
    (f) => {
      f.options.getAccessToken = async () => jwt({ exp: NOW / 1_000 + 10 * 60 });
    },
  ];
  for (const change of changes) {
    const f = fixture({ processing: true });
    change(f);
    await assert.rejects(runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies));
    assert.equal(f.calls.length, 0);
  }
  const paused = fixture({ processing: true });
  paused.envelope.payload.processingEnabled = false;
  paused.updateSignature();
  const result = await runDevelopmentD2AuthenticatedIntake(paused.options, paused.dependencies);
  assert.equal(result.passed, false);
  assert.equal(result.acknowledgedContributions, 0);
  assert.equal(paused.calls.length, 1);
  assert.equal(paused.calls[0].init.method, "GET");
});

test("review observation timeout cancels only the exact still-unverified contribution", async () => {
  const f = fixture({ processing: true, processAfterMs: Number.POSITIVE_INFINITY });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, false);
  assert.equal(result.failureStage, "processing_to_review");
  assert.equal(result.processingToReviewObserved, false);
  assert.equal(result.processingPolls, PROCESSING_LIMITS.maximumReviewPolls);
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(result.cleanupCancellations, 1);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(
    f.calls.some((call) => call.path.endsWith("/withdraw")),
    false,
  );
  assert.ok(result.durationMs < PROCESSING_LIMITS.totalDeadlineMs);
});

test("terminal reconciliation timeout preserves acknowledgement and run-scoped recovery need", async () => {
  const f = fixture({ processing: true, withdrawalAfterMs: Number.POSITIVE_INFINITY });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, false);
  assert.equal(result.failureStage, "cleanup");
  assert.equal(result.processingToReviewObserved, true);
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.cleanupWithdrawals, 0);
  assert.equal(result.cleanupPolls, PROCESSING_LIMITS.maximumCleanupPolls);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(result.recoveryRequired, true);
  assert.equal(f.calls.filter((call) => call.path.endsWith("/withdraw")).length, 1);
  assert.equal(
    f.calls.some((call) => /reviewer|accept|\/cancel/.test(call.path)),
    false,
  );
  assert.ok(result.durationMs < PROCESSING_LIMITS.totalDeadlineMs);
});

test("a concurrent Trust version change never rebases or retries the owner withdrawal", async () => {
  const f = fixture({ processing: true });
  f.setHook((call, response) =>
    call.path.endsWith("/withdraw") ? problem(409, "version_conflict") : response,
  );
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.failureStage, "cleanup");
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.acknowledgedContributions, 1);
  assert.equal(result.cleanupRevocations, 2);
  const withdraws = f.calls.filter((call) => call.path.endsWith("/withdraw"));
  assert.equal(withdraws.length, 1);
  assert.deepEqual(withdraws[0].body, { expectedVersion: 1 });
});

test("a stalled session provider is bounded without network actions or raw errors", async () => {
  const f = fixture();
  f.options.getAccessToken = () => new Promise(() => {});
  await assert.rejects(runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies), {
    message: "The D2 authenticated workload scope is invalid or unavailable",
  });
  assert.equal(f.calls.length, 0);
});

test("slow terminal polls preserve the final revocation budget within the total deadline", async () => {
  const f = fixture({ processing: true, withdrawalAfterMs: Number.POSITIVE_INFINITY });
  f.dependencies.requestTimeoutMs = PROCESSING_LIMITS.requestTimeoutMs;
  let withdrawing = false;
  f.setHook((call, response) => {
    if (call.path.endsWith("/withdraw")) withdrawing = true;
    if (withdrawing && call.init.method === "GET") f.advanceClock(7_900);
    return response;
  });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.cleanupRevocations, 2);
  assert.ok(result.cleanupPolls < PROCESSING_LIMITS.maximumCleanupPolls);
  assert.ok(result.durationMs < PROCESSING_LIMITS.totalDeadlineMs);
});

test("a mismatched owner Trust contribution is rejected without a withdrawal", async () => {
  const f = fixture({ processing: true });
  f.setHook(async (call, response) => {
    if (call.path.startsWith("/v1/trust/contributions/") && response.status === 200)
      return json({ ...(await response.json()), contributionId: ids.secondary });
    return response;
  });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.failureStage, "processing_to_review");
  assert.equal(result.processingToReviewObserved, false);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(
    f.calls.some((call) => call.path.endsWith("/withdraw")),
    false,
  );
});

test("realistic Profile revocation receipts make cancellation and primary cleanup converge", async () => {
  const f = fixture();
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  const intake = f.calls.find((call) => call.path === "/v1/jobs/contributions");
  const primaryCleanup = f.calls.find((call) => call.path.endsWith(`${ids.primary}/revoke`));
  assert.equal(result.passed, true);
  assert.equal(result.cleanupRevocations, 2);
  assert.equal(
    primaryCleanup.init.headers["idempotency-key"],
    `contribution-cancel-${intake.body.contributionId}`,
  );
  assert.equal(f.revocationReceipts.size, 2);
  assert.equal(f.revokedConsentIds.size, 2);
});

test("an ambiguous exact-grant revocation retries once without duplicating Profile transitions", async () => {
  for (const loseEveryAcknowledgement of [false, true]) {
    const f = fixture();
    let lost = 0;
    f.setHook((call, response) => {
      if (call.path.endsWith(`${ids.primary}/revoke`) && (lost === 0 || loseEveryAcknowledgement)) {
        lost += 1;
        throw new Error("Generated revocation acknowledgement loss");
      }
      return response;
    });
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    const attempts = f.calls.filter((call) => call.path.endsWith(`${ids.primary}/revoke`));
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0].body, attempts[1].body);
    assert.equal(
      attempts[0].init.headers["idempotency-key"],
      attempts[1].init.headers["idempotency-key"],
    );
    assert.equal(f.revokedConsentIds.size, 2);
    assert.equal(f.revocationReceipts.size, 2);
    assert.equal(result.passed, !loseEveryAcknowledgement);
    assert.equal(result.recoveryRequired, loseEveryAcknowledgement);
    assert.ok(result.requests <= LIMITS.maximumRequests);
    assert.ok(result.durationMs <= LIMITS.totalDeadlineMs);
  }
});

test("accepted or ambiguously withdrawn cases never masquerade as completed cleanup", async () => {
  for (const [caseState, ownerState, cleanupExpected] of [
    ["accepted", "published", false],
    ["withdrawn", "withdrawn", false],
    ["withdrawn", "removed", true],
  ]) {
    const f = fixture({ processing: true });
    f.setHook(async (call, response) => {
      if (call.init.method === "GET" && call.path.startsWith("/v1/jobs/contributions/"))
        return json({ ...(await response.json()), state: ownerState });
      if (call.init.method === "GET" && call.path.startsWith("/v1/trust/contributions/"))
        return json({
          id: "019919fc-4000-8000-8000-000000000004",
          contributionId: call.path.split("/").at(-1),
          state: caseState,
          version: caseState === "accepted" ? 2 : 3,
          policyVersion: "synthetic-trust-v1",
          appealed: false,
          createdAt: new Date(NOW).toISOString(),
          updatedAt: new Date(NOW).toISOString(),
        });
      return response;
    });
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    assert.equal(result.passed, false);
    assert.equal(result.processingToReviewObserved, false);
    assert.equal(result.cleanupSucceeded, cleanupExpected);
    assert.equal(result.recoveryRequired, !cleanupExpected);
    assert.equal(result.cleanupRevocations, 2);
    assert.equal(
      f.calls.some((call) => call.path.endsWith("/withdraw") || call.path.endsWith("/cancel")),
      false,
    );
  }
});

test("persistent development processing needs no signed policy, key, or policy request", async () => {
  const f = fixture({ processing: true, development: true });
  const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
  assert.equal(result.passed, true);
  assert.equal(result.processingToReviewObserved, true);
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(result.cleanupWithdrawals, 1);
  assert.equal(Object.hasOwn(f.options.scope, "signedPolicySha256"), false);
  assert.equal(Object.hasOwn(f.options.scope, "publicKeys"), false);
  assert.equal(
    f.calls.some((call) => call.path.includes("capability-policy")),
    false,
  );
  assert.equal(
    f.calls.some((call) => call.path.includes("/admin/")),
    false,
  );
});

const DEVELOPMENT_SOURCES = [
  {
    provider: "greenhouse",
    pageVariant: "greenhouse-board-v1",
    sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/12345",
    externalJobId: "12345",
  },
  {
    provider: "greenhouse",
    pageVariant: "greenhouse-board-v1",
    sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/12345",
    externalJobId: "12345",
  },
  {
    provider: "lever",
    pageVariant: "lever-posting-v1",
    sourceUrl: "https://jobs.lever.co/synthetic/01234567-89ab-4cde-8fab-0123456789ab",
    externalJobId: "01234567-89ab-4cde-8fab-0123456789ab",
  },
  {
    provider: "lever",
    pageVariant: "lever-posting-v1",
    sourceUrl: "https://jobs.eu.lever.co/synthetic/01234567-89ab-4cde-8fab-0123456789ab",
    externalJobId: "01234567-89ab-4cde-8fab-0123456789ab",
  },
  {
    provider: "ashby",
    pageVariant: "ashby-job-board-v1",
    sourceUrl: "https://jobs.ashbyhq.com/synthetic/01234567-89ab-4cde-8fab-0123456789ab",
    externalJobId: "01234567-89ab-4cde-8fab-0123456789ab",
  },
];

function setSource(f, source) {
  Object.assign(f.scope.preview.source, source);
  f.scope.previewSha256 = approvedPreviewDigest(f.scope.preview);
}

test("development processing supports every exact descriptor tuple without changing cleanup or policy mode", async () => {
  for (const source of DEVELOPMENT_SOURCES) {
    const f = fixture({ processing: true, development: true });
    setSource(f, source);
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    assert.equal(result.passed, true, source.sourceUrl);
    assert.equal(result.processingToReviewObserved, true);
    assert.equal(result.acknowledgedContributions, 1);
    assert.equal(result.idempotentReplays, 1);
    assert.equal(result.expectedConflicts, 1);
    assert.equal(result.cleanupSucceeded, true);
    assert.equal(result.cleanupWithdrawals, 1);
    assert.equal(result.cleanupRevocations, 2);
    assert.equal(result.recoveryRequired, false);
    assert.equal(result.moderationAcceptance, false);
    assert.equal(result.publicationAcceptance, false);
    assert.ok(result.requests <= PROCESSING_LIMITS.maximumRequests);
    const writes = f.calls.filter((call) => call.path === "/v1/jobs/contributions");
    assert.ok(writes.length > 0);
    for (const write of writes) {
      assert.deepEqual(write.body.source, f.scope.preview.source);
      assert.deepEqual(write.body.client, { surface: "browser_extension", version: "0.2.0" });
    }
    assert.equal(
      f.calls.some(
        (call) => call.path.includes("capability-policy") || call.path.includes("/admin/"),
      ),
      false,
    );
    const retained = JSON.stringify(result);
    for (const forbidden of [source.sourceUrl, SUBJECT, ISSUER, ORIGIN, PUBLIC_MARKER, jwt()])
      assert.equal(retained.includes(forbidden), false);
  }
});

test("development descriptor mismatches and unsupported client or adapter fail before networking", async () => {
  for (const source of DEVELOPMENT_SOURCES) {
    for (const mutate of [
      (scope) => {
        scope.preview.source.provider = source.provider === "lever" ? "ashby" : "lever";
      },
      (scope) => {
        scope.preview.source.provider = "unknown";
      },
      (scope) => {
        scope.preview.source.pageVariant =
          source.pageVariant === "lever-posting-v1" ? "ashby-job-board-v1" : "lever-posting-v1";
      },
      (scope) => {
        const url = new URL(source.sourceUrl);
        url.hostname = source.provider === "lever" ? "jobs.ashbyhq.com" : "jobs.lever.co";
        scope.preview.source.sourceUrl = url.href;
      },
      (scope) => {
        const url = new URL(source.sourceUrl);
        url.hostname += ".invalid";
        scope.preview.source.sourceUrl = url.href;
      },
      (scope) => {
        scope.preview.client.version = "0.3.0";
      },
      (scope) => {
        scope.preview.source.adapterVersion = "d2-job-page-v2";
      },
    ]) {
      const f = fixture({ processing: true, development: true });
      setSource(f, source);
      mutate(f.scope);
      f.scope.previewSha256 = approvedPreviewDigest(f.scope.preview);
      await assert.rejects(() => runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies));
      assert.equal(f.calls.length, 0);
    }
  }
});

test("additional provider tuples retain exact preview approval and signed-mode policy fences", async () => {
  for (const source of DEVELOPMENT_SOURCES.filter((value) => value.provider !== "greenhouse")) {
    const stale = fixture({ processing: true, development: true });
    Object.assign(stale.scope.preview.source, source);
    await assert.rejects(() =>
      runDevelopmentD2AuthenticatedIntake(stale.options, stale.dependencies),
    );
    assert.equal(stale.calls.length, 0);

    const signed = fixture({ processing: true });
    setSource(signed, source);
    const result = await runDevelopmentD2AuthenticatedIntake(signed.options, signed.dependencies);
    assert.equal(result.passed, false);
    assert.equal(result.acknowledgedContributions, 0);
    assert.ok(signed.calls.some((call) => call.path.includes("capability-policy")));
    assert.equal(
      signed.calls.some((call) => call.init.method !== "GET"),
      false,
    );
  }
});

test("development workload mode is explicit, processing-only, and exact descriptor scope", async () => {
  for (const mutate of [
    (scope) => {
      scope.capabilityMode = "production";
    },
    (scope) => {
      scope.schemaVersion = 1;
    },
    (scope) => {
      scope.publicKeys = {};
    },
    (scope) => {
      scope.signedPolicySha256 = "a".repeat(64);
    },
    (scope) => {
      scope.preview.client.version = "0.3.0";
    },
    (scope) => {
      scope.preview.source.provider = "lever";
    },
    (scope) => {
      scope.preview.source.pageVariant = "lever-posting-v1";
    },
    (scope) => {
      scope.preview.source.sourceUrl = "https://jobs.lever.co/synthetic/12345";
    },
    (scope) => {
      scope.disposableCandidate = false;
    },
    (scope) => {
      scope.sourceAuthorized = false;
    },
  ]) {
    const f = fixture({ processing: true, development: true });
    mutate(f.options.scope);
    f.options.scope.previewSha256 = approvedPreviewDigest(f.options.scope.preview);
    await assert.rejects(() => runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies));
    assert.equal(f.calls.length, 0);
  }
  const paused = fixture({ development: true });
  await assert.rejects(() =>
    runDevelopmentD2AuthenticatedIntake(paused.options, paused.dependencies),
  );
  assert.equal(paused.calls.length, 0);
});

test("withdrawal acknowledgement must bind the exact pending case and its next version", async () => {
  for (const field of ["id", "version"]) {
    const f = fixture({ processing: true });
    f.setHook(async (call, response) => {
      if (call.path.endsWith("/withdraw")) {
        const body = await response.json();
        body[field] = field === "id" ? ids.secondary : body.version + 1;
        return json(body);
      }
      return response;
    });
    const result = await runDevelopmentD2AuthenticatedIntake(f.options, f.dependencies);
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, "cleanup");
    assert.equal(result.cleanupSucceeded, false);
    assert.equal(result.recoveryRequired, true);
    assert.equal(result.cleanupRevocations, 2);
    assert.equal(f.calls.filter((call) => call.path.endsWith("/withdraw")).length, 1);
  }
});
