import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  evaluateContributionCapability,
  verifySignedContributionCapabilityPolicy,
} from "../backend/services/jobs/dist/src/contribution-capability-policy.js";
import { compileComponentValidator } from "../packages/api-contracts/dist/src/index.js";
import {
  expectedJobContributionApprovedFields,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "../packages/api-contracts/dist/src/job-contribution-canonical.js";
import { parseDevelopmentOrigin } from "./run-development-d2-public-boundary.mjs";

export const CONFIRMATION = "RUN-D2-DISPOSABLE-AUTHENTICATED-INTAKE-V1";
export const PROCESSING_CONFIRMATION = "RUN-D2-DISPOSABLE-PROCESSING-TO-REVIEW-V1";
export const PROCESSING_KIND = "d2_disposable_candidate_processing_v1";
export const AUTHORIZED_ACTIONS = Object.freeze([
  "consent_grant",
  "contribution_intake",
  "owner_read",
  "idempotent_replay",
  "idempotency_conflict",
  "preverification_cancel",
  "consent_revoke",
]);
export const LIMITS = Object.freeze({
  contributions: 1,
  concurrency: 1,
  maximumReads: 10,
  minimumIntervalMs: 500,
  maximumRequests: 36,
  requestTimeoutMs: 8_000,
  actionDeadlineMs: 90_000,
  totalDeadlineMs: 120_000,
  maximumBodyBytes: 65_536,
});
export const PROCESSING_ACTIONS = Object.freeze([
  ...AUTHORIZED_ACTIONS,
  "bounded_processing_poll",
  "owner_trust_read",
  "owner_trust_withdraw",
]);
// Jobs processing and Trust outbox delivery run concurrently on a five-minute schedule.
// A withdrawal can therefore need one tick to publish its nudge and another for reconciliation.
// Bound this profile across those ticks rather than treating a normal schedule as an outage.
export const PROCESSING_LIMITS = Object.freeze({
  ...LIMITS,
  maximumRequests: 192,
  actionDeadlineMs: 8 * 60_000,
  totalDeadlineMs: 20 * 60_000,
  pollingIntervalMs: 10_000,
  maximumReviewPolls: 48,
  maximumCleanupPolls: 70,
});
const UUID_V7 = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const UNSAFE_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject controls and markup in approved public fields.
  /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const validateContribution = compileComponentValidator("CreateJobContributionRequest");
const validateStatus = compileComponentValidator("JobContribution");
const validateGrant = compileComponentValidator("UgcContributionConsentGrant");
const validateProblem = compileComponentValidator("ProblemDetails");
const validateOwnerTrust = compileComponentValidator("OwnerTrustCase");
const GRANT_PATH = "/v1/profile/ugc-contribution-consents";
const INTAKE_PATH = "/v1/jobs/contributions";
const POLICY_PATH = "/v1/extension/contribution-capability-policy";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const reject = () => {
  throw new Error("The D2 authenticated workload scope is invalid or unavailable");
};

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Digest helpers reveal neither tokens nor posting values; approval must cover the exact input. */
export const approvedPreviewDigest = (preview) => hash(JSON.stringify(canonical(preview)));
export const signedEnvelopeDigest = (envelope) => hash(JSON.stringify(canonical(envelope)));
export function disposableIdentityDigest({ iss, sub, aud, azp }) {
  return hash(JSON.stringify({ purpose: "d2-disposable-identity-v1", iss, sub, aud, azp }));
}

function runContributionId(scope) {
  // Cleanup identity is bound to this approved account/source/preview, not merely a reusable run
  // label. Renewing only the authority time window preserves recovery; a different approved intent
  // can never cancel the prior run's contribution through an accidentally reused label.
  const suffix = hash(
    JSON.stringify({
      purpose: "d2-authenticated-intake-v1",
      kind: scope.kind,
      runId: scope.runId,
      apiOrigin: scope.apiOrigin,
      identitySha256: scope.identitySha256,
      previewSha256: scope.previewSha256,
      ugcPolicyVersion: scope.ugcPolicyVersion,
    }),
  )
    .slice(0, 20)
    .split("");
  suffix[0] = "7";
  suffix[4] = ((Number.parseInt(suffix[4], 16) & 3) | 8).toString(16);
  const tail = suffix.join("");
  return `${scope.runId.slice(0, 14)}${tail.slice(0, 4)}-${tail.slice(4, 8)}-${tail.slice(8, 20)}`;
}

function prepareInput(scope) {
  const contributionId = runContributionId(scope);
  const body = {
    schemaVersion: 1,
    contributionId,
    client: structuredClone(scope.preview.client),
    source: structuredClone(scope.preview.source),
    posting: structuredClone(scope.preview.posting),
    observation: { observedAt: scope.preview.observedAt, contentSha256: "0".repeat(64) },
    approval: {
      consentId: contributionId,
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: scope.ugcPolicyVersion,
      approvedAt: scope.preview.observedAt,
      approvedFields: [],
      previewDigestSha256: "0".repeat(64),
    },
  };
  body.approval.approvedFields = expectedJobContributionApprovedFields(body);
  body.observation.contentSha256 = hash(jobContributionContentDigestInput(body));
  body.approval.previewDigestSha256 = hash(jobContributionPreviewDigestInput(body));
  return body;
}

function validateScope(scope, instant) {
  const processingProfile = scope?.kind === PROCESSING_KIND;
  const developmentMode = scope?.schemaVersion === 2 && scope?.capabilityMode === "development";
  const actions = processingProfile ? PROCESSING_ACTIONS : AUTHORIZED_ACTIONS;
  const limits = processingProfile ? PROCESSING_LIMITS : LIMITS;
  if (
    !exactKeys(scope, [
      "schemaVersion",
      "kind",
      "runId",
      "apiOrigin",
      "issuedAt",
      "expiresAt",
      "disposableCandidate",
      "identitySha256",
      "issuer",
      "audience",
      "clientId",
      "sourceAuthorized",
      "actions",
      "ugcPolicyVersion",
      "preview",
      "previewSha256",
      ...(developmentMode ? ["capabilityMode"] : ["signedPolicySha256", "publicKeys"]),
      "readRequests",
    ]) ||
    (developmentMode ? !processingProfile : scope.schemaVersion !== 1) ||
    (!processingProfile && scope.kind !== "d2_disposable_candidate_authenticated_v1") ||
    scope.disposableCandidate !== true ||
    scope.sourceAuthorized !== true ||
    !UUID_V7.test(scope.runId) ||
    !SHA256.test(scope.identitySha256) ||
    !SHA256.test(scope.previewSha256) ||
    (!developmentMode && !SHA256.test(scope.signedPolicySha256)) ||
    !VERSION.test(scope.ugcPolicyVersion) ||
    !Array.isArray(scope.actions) ||
    scope.actions.length !== actions.length ||
    [...scope.actions].sort().join("\0") !== [...actions].sort().join("\0") ||
    !Number.isInteger(scope.readRequests) ||
    scope.readRequests < 1 ||
    scope.readRequests > LIMITS.maximumReads ||
    !exactKeys(scope.preview, ["client", "source", "posting", "observedAt"]) ||
    approvedPreviewDigest(scope.preview) !== scope.previewSha256
  )
    reject();
  const origin = parseDevelopmentOrigin(scope.apiOrigin);
  if (origin.origin !== scope.apiOrigin) reject();
  const issued = Date.parse(scope.issuedAt);
  const expires = Date.parse(scope.expiresAt);
  const observed = Date.parse(scope.preview.observedAt);
  if (
    ![issued, expires, observed].every(Number.isFinite) ||
    new Date(issued).toISOString() !== scope.issuedAt ||
    new Date(expires).toISOString() !== scope.expiresAt ||
    new Date(observed).toISOString() !== scope.preview.observedAt ||
    issued > instant ||
    expires - issued > 30 * 60_000 ||
    expires < instant + limits.totalDeadlineMs ||
    observed > instant ||
    instant - observed > 24 * 60 * 60_000
  )
    reject();
  let issuer;
  try {
    issuer = new URL(scope.issuer);
  } catch {
    reject();
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/" ||
    issuer.href !== scope.issuer ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.auth0\.com$/u.test(issuer.hostname) ||
    typeof scope.audience !== "string" ||
    scope.audience.length < 3 ||
    scope.audience.length > 200 ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(scope.clientId)
  )
    reject();
  if (
    !developmentMode &&
    (!scope.publicKeys ||
      typeof scope.publicKeys !== "object" ||
      Array.isArray(scope.publicKeys) ||
      Object.keys(scope.publicKeys).length < 1 ||
      Object.keys(scope.publicKeys).length > 5 ||
      Object.entries(scope.publicKeys).some(
        ([key, value]) =>
          !VERSION.test(key) ||
          typeof value !== "string" ||
          value.length > 2_000 ||
          !value.startsWith("-----BEGIN PUBLIC KEY-----") ||
          value.includes("PRIVATE"),
      ))
  )
    reject();
  const input = prepareInput(scope);
  if (!validateContribution(input)) reject();
  const source = new URL(input.source.sourceUrl);
  if (
    developmentMode &&
    (input.client.version !== "0.2.0" ||
      input.source.provider !== "greenhouse" ||
      input.source.pageVariant !== "greenhouse-board-v1")
  )
    reject();
  const hosts = {
    greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
    lever: ["jobs.lever.co", "jobs.eu.lever.co"],
    ashby: ["jobs.ashbyhq.com"],
  };
  const paths =
    input.source.provider === "greenhouse"
      ? /^\/[A-Za-z0-9._~-]+\/jobs\/[A-Za-z0-9._~-]+\/?$/u
      : /^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/?$/u;
  if (
    source.protocol !== "https:" ||
    source.port ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    source.href !== input.source.sourceUrl ||
    !paths.test(source.pathname) ||
    !hosts[input.source.provider]?.includes(source.hostname) ||
    input.source.adapterVersion !== "d2-job-page-v1"
  )
    reject();
  // Never make a fabricated or unsafe posting into a workload fixture. Only the approved bounded
  // public projection is sent; the separately authorized profile enforces its processing state.
  const strings = Object.values(input.posting).flat();
  if (strings.some((value) => typeof value === "string" && UNSAFE_TEXT.test(value))) reject();
  return { origin, input, limits, processingProfile, developmentMode };
}

function validateToken(token, scope, instant, limits) {
  if (
    typeof token !== "string" ||
    token.length < 30 ||
    token.length > 16_384 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
  )
    reject();
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    reject();
  }
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (
    header.alg !== "RS256" ||
    claims.iss !== scope.issuer ||
    claims.azp !== scope.clientId ||
    typeof claims.sub !== "string" ||
    claims.sub.length < 3 ||
    claims.sub.length > 200 ||
    !Array.isArray(audiences) ||
    !audiences.includes(scope.audience) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp * 1_000 < instant + limits.totalDeadlineMs ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat * 1_000 > instant ||
    typeof claims.scope !== "string" ||
    !claims.scope.split(" ").includes("jobs:contribute") ||
    disposableIdentityDigest({
      iss: claims.iss,
      sub: claims.sub,
      aud: scope.audience,
      azp: claims.azp,
    }) !== scope.identitySha256
  )
    reject();
  // This decoded identity fence is not JWT authentication: the deployed API must verify the
  // issuer/signature/audience/scopes. No unverified claim is supplied as an authorizer context.
}

async function boundedBody(response) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > LIMITS.maximumBodyBytes))
    reject();
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.maximumBodyBytes) reject();
      chunks.push(value);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    reject();
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)])
    : 0;
}

/**
 * Separate opt-in intake and processing-to-review profiles. Neither establishes moderation,
 * catalog publication, throughput capacity, combined processing-load, or human/browser acceptance.
 * The exact run UUID is supplied
 * by the approved scope and never rotated on an ambiguous response; its identities are recoverable
 * by rerunning the same scope rather than creating another contribution.
 */
export async function runDevelopmentD2AuthenticatedIntake(options, dependencies = {}) {
  if (
    options.confirmation !==
      (options.scope?.kind === PROCESSING_KIND ? PROCESSING_CONFIRMATION : CONFIRMATION) ||
    typeof options.getAccessToken !== "function"
  )
    reject();
  const wallNow = dependencies.wallNow ?? (() => new Date());
  const monotonic = dependencies.now ?? (() => performance.now());
  const timeoutMs = dependencies.requestTimeoutMs ?? LIMITS.requestTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.requestTimeoutMs)
    reject();
  let scope;
  let origin;
  let input;
  let token;
  let limits;
  let processingProfile;
  let developmentMode;
  try {
    if (Buffer.byteLength(JSON.stringify(options.scope), "utf8") > LIMITS.maximumBodyBytes)
      reject();
    scope = structuredClone(options.scope);
    ({ origin, input, limits, processingProfile, developmentMode } = validateScope(
      scope,
      wallNow().getTime(),
    ));
    let tokenTimer;
    try {
      token = await Promise.race([
        options.getAccessToken(),
        new Promise((_, rejectTimeout) => {
          tokenTimer = setTimeout(
            () => rejectTimeout(new Error("Session acquisition timed out")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(tokenTimer);
    }
    validateToken(token, scope, wallNow().getTime(), limits);
  } catch {
    reject();
  }
  const fetcher = dependencies.fetchImpl ?? fetch;
  const pause = dependencies.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = monotonic();
  const startedAt = wallNow().toISOString();
  const latencies = [];
  const grants = [];
  const attemptedGrants = new Set();
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let intakeAttempted = false;
  let cleanup = false;
  let stage = "policy_preflight";
  let failureStage;
  let requests = 0;
  let ambiguousWrites = 0;
  let acknowledgements = 0;
  let reads = 0;
  let replay = 0;
  let conflicts = 0;
  let serverFailures = 0;
  let revoked = 0;
  let cancelled = false;
  let withdrawn = false;
  let reviewCase;
  let processingToReviewObserved = false;
  let processingPolls = 0;
  let cleanupPolls = 0;
  let cleanupAttempted = false;
  let cleanupSucceeded = false;
  let passedActions = false;
  const key = (label) => `d2-intake-v1-${input.contributionId}-${label}`;
  const target = `${INTAKE_PATH}/${input.contributionId}`;
  const trustTarget = `/v1/trust/contributions/${input.contributionId}`;

  async function request(path, method = "GET", body, idempotencyKey, authenticated = true) {
    let remaining =
      (cleanup ? limits.totalDeadlineMs : limits.actionDeadlineMs) - (monotonic() - started);
    if (
      requests >= limits.maximumRequests ||
      remaining <= 0 ||
      wallNow().getTime() >= Date.parse(scope.expiresAt)
    )
      reject();
    const delay = LIMITS.minimumIntervalMs - (monotonic() - lastRequestAt);
    if (delay > 0) await pause(delay);
    remaining =
      (cleanup ? limits.totalDeadlineMs : limits.actionDeadlineMs) - (monotonic() - started);
    if (remaining <= 0 || wallNow().getTime() >= Date.parse(scope.expiresAt)) reject();
    lastRequestAt = monotonic();
    requests += 1;
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(new URL(path, origin), {
            method,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
            headers: {
              accept: "application/json",
              ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
              ...(body === undefined ? {} : { "content-type": "application/json" }),
              ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            },
          });
          if (response.status >= 500) serverFailures += 1;
          const text = await boundedBody(response);
          const noStore = response.headers
            .get("cache-control")
            ?.split(",")
            .some((part) => part.trim().toLowerCase() === "no-store");
          if (!noStore) reject();
          if (response.status === 204) {
            if (text !== "") reject();
            return { status: 204 };
          }
          const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
          if (!["application/json", "application/problem+json"].includes(contentType) || !text)
            reject();
          return { status: response.status, body: JSON.parse(text) };
        })(),
        new Promise((_, rejectTimeout) => {
          timer = setTimeout(
            () => {
              controller.abort();
              rejectTimeout(new Error("The D2 request exceeded its fixed deadline"));
            },
            Math.min(timeoutMs, remaining),
          );
        }),
      ]);
    } catch {
      if (method === "POST") ambiguousWrites += 1;
      reject();
    } finally {
      clearTimeout(timer);
      controller.abort();
      latencies.push(Math.max(0, monotonic() - lastRequestAt));
    }
  }

  async function grant(label) {
    attemptedGrants.add(label);
    const body = {
      schemaVersion: 1,
      documentVersion: "ugc-contribution-preview.v1",
      policyVersion: scope.ugcPolicyVersion,
      previewDigestSha256: input.approval.previewDigestSha256,
    };
    let result;
    try {
      result = await request(GRANT_PATH, "POST", body, key(label));
    } catch {
      result = await request(GRANT_PATH, "POST", body, key(label));
    }
    if (
      result.status !== 201 ||
      !validateGrant(result.body) ||
      result.body.policyVersion !== scope.ugcPolicyVersion ||
      Date.parse(result.body.grantedAt) < Date.parse(input.observation.observedAt) ||
      Date.parse(result.body.grantedAt) > wallNow().getTime()
    )
      reject();
    grants.push({ label, id: result.body.id, grantedAt: result.body.grantedAt });
    return result.body;
  }

  function requireStatus(result, expectedHttp, expectedState) {
    if (
      result.status !== expectedHttp ||
      !validateStatus(result.body) ||
      result.body.id !== input.contributionId ||
      (expectedState && result.body.state !== expectedState)
    )
      reject();
    return result.body;
  }

  function requireTrust(result, expectedState) {
    if (
      result.status !== 200 ||
      !validateOwnerTrust(result.body) ||
      result.body.contributionId !== input.contributionId ||
      (expectedState && result.body.state !== expectedState)
    )
      reject();
    return result.body;
  }

  async function pauseForPoll() {
    // Slow polling cannot borrow the final requests reserved for revoking this run's exact
    // known grants or sleep past the overall fixed deadline.
    const reserve = cleanup ? (grants.length * 2 + 1) * (timeoutMs + limits.minimumIntervalMs) : 0;
    const deadline = (cleanup ? limits.totalDeadlineMs : limits.actionDeadlineMs) - reserve;
    if (monotonic() - started + limits.pollingIntervalMs >= deadline) reject();
    await pause(limits.pollingIntervalMs);
  }

  async function observeReview() {
    for (let attempt = 0; attempt < limits.maximumReviewPolls; attempt += 1) {
      const status = requireStatus(await request(target), 200);
      processingPolls += 1;
      if (["independently_verified", "awaiting_trust"].includes(status.state)) {
        const current = await request(trustTarget);
        if (current.status === 200) {
          reviewCase = requireTrust(current, "needs_review");
          processingToReviewObserved = true;
          return;
        }
        if (current.status !== 404) reject();
      } else if (
        !["queued", "normalized", "awaiting_independent_verification"].includes(status.state)
      )
        reject();
      if (attempt + 1 < limits.maximumReviewPolls) await pauseForPoll();
    }
    reject();
  }

  async function cancelPreverification() {
    requireStatus(
      await request(`${target}/cancel`, "POST", { schemaVersion: 1 }, key("cancel")),
      200,
      "consent_invalid",
    );
    requireStatus(
      await request(`${target}/cancel`, "POST", { schemaVersion: 1 }, key("cancel")),
      200,
      "consent_invalid",
    );
    requireStatus(await request(target), 200, "consent_invalid");
    cancelled = true;
  }

  async function withdrawReviewedContribution() {
    // Preserve the exact version observed by this run. A concurrent reviewer/owner transition
    // requires recovery; never silently rebase a destructive command onto a new case version.
    if (!reviewCase) {
      const current = await request(trustTarget);
      if (current.status === 404) return cancelPreverification();
      reviewCase = requireTrust(current);
    }
    let unpublishedWithdrawal = false;
    if (reviewCase.state === "needs_review") {
      const expectedCase = reviewCase;
      const result = await request(`${trustTarget}/withdraw`, "POST", {
        expectedVersion: expectedCase.version,
      });
      reviewCase = requireTrust(result, "withdrawn");
      if (reviewCase.id !== expectedCase.id || reviewCase.version !== expectedCase.version + 1)
        reject();
      // Successful same-version withdrawal from needs_review proves this case
      // could not first have been accepted/published. Only this path can treat
      // copied withdrawal truth as sufficient disposition without catalog removal.
      unpublishedWithdrawal = true;
    } else if (reviewCase.state !== "withdrawn") reject();
    for (let attempt = 0; attempt < limits.maximumCleanupPolls; attempt += 1) {
      const state = requireStatus(await request(target), 200).state;
      cleanupPolls += 1;
      if (state === "removed" || (unpublishedWithdrawal && state === "withdrawn")) {
        withdrawn = true;
        return;
      }
      // A previous ambiguous withdrawal may have followed publication. The
      // owner status alone does not establish removal; keep scoped recovery
      // explicit instead of silently adopting a previously observed case version.
      if (!unpublishedWithdrawal) reject();
      if (["published", "taken_down"].includes(state)) reject();
      if (attempt + 1 < limits.maximumCleanupPolls) await pauseForPoll();
    }
    reject();
  }

  try {
    // Development uses persistent server-side capability configuration. This profile only
    // removes signed-policy preflight; the deployed API remains the authority for every write.
    // Keep the separate disposable-account/workload deadline and all cleanup/evidence fences.
    if (!developmentMode) {
      const policyResponse = await request(POLICY_PATH, "GET", undefined, undefined, false);
      if (
        policyResponse.status !== 200 ||
        signedEnvelopeDigest(policyResponse.body) !== scope.signedPolicySha256
      )
        reject();
      const policy = verifySignedContributionCapabilityPolicy(
        policyResponse.body,
        scope.publicKeys,
      );
      if (
        policy.processingEnabled !== processingProfile ||
        Date.parse(policy.expiresAt) < wallNow().getTime() + limits.totalDeadlineMs ||
        !evaluateContributionCapability(policy, {
          stage: "intake",
          provider: input.source.provider,
          pageVariant: input.source.pageVariant,
          domain: new URL(input.source.sourceUrl).hostname,
          clientVersion: input.client.version,
          now: wallNow(),
        }).allowed
      )
        reject();
    }
    stage = "consent_grant";
    const primary = await grant("primary-grant");
    input.approval.consentId = primary.id;
    input.approval.approvedAt = primary.grantedAt;
    stage = "intake";
    intakeAttempted = true;
    let accepted;
    try {
      accepted = await request(INTAKE_PATH, "POST", input, key("intake"));
    } catch {
      accepted = await request(INTAKE_PATH, "POST", input, key("intake"));
    }
    const acknowledgement = requireStatus(accepted, 202);
    acknowledgements = 1;
    stage = "owner_read";
    for (let index = 0; index < scope.readRequests; index += 1) {
      requireStatus(await request(target), 200);
      reads += 1;
    }
    stage = "idempotent_replay";
    const replayed = requireStatus(await request(INTAKE_PATH, "POST", input, key("intake")), 202);
    if (replayed.submittedAt !== acknowledgement.submittedAt) reject();
    replay = 1;
    stage = "conflict_grant";
    const secondary = await grant("conflict-grant");
    if (secondary.id === primary.id) reject();
    stage = "idempotency_conflict";
    const alternate = structuredClone(input);
    alternate.approval.consentId = secondary.id;
    alternate.approval.approvedAt = secondary.grantedAt;
    const conflict = await request(INTAKE_PATH, "POST", alternate, key("intake"));
    if (
      conflict.status !== 409 ||
      !validateProblem(conflict.body) ||
      conflict.body.status !== 409 ||
      conflict.body.code !== "idempotency_conflict"
    )
      reject();
    conflicts = 1;
    if (processingProfile) {
      stage = "processing_to_review";
      await observeReview();
    }
    passedActions = true;
  } catch {
    failureStage = stage;
  } finally {
    cleanup = true;
    cleanupAttempted = attemptedGrants.size > 0 || intakeAttempted;
    let cleanupFailed = false;
    if (intakeAttempted) {
      try {
        if (processingProfile) await withdrawReviewedContribution();
        else await cancelPreverification();
      } catch {
        cleanupFailed = true;
      }
    }
    for (const receipt of grants) {
      try {
        // /cancel uses this exact primary revocation identity. Profile rejects
        // revoking an already-revoked grant under a different key, so cancellation
        // acknowledgement loss and direct cleanup must converge on that receipt.
        const revocationKey =
          receipt.label === "primary-grant"
            ? `contribution-cancel-${input.contributionId}`
            : key(`${receipt.label}-revoke`);
        const revoke = () =>
          request(
            `${GRANT_PATH}/${receipt.id}/revoke`,
            "POST",
            { schemaVersion: 1 },
            revocationKey,
          );
        let result;
        try {
          result = await revoke();
        } catch {
          // At most one identical retry after an ambiguous response. Never
          // rotate identities, retry a definite conflict, or extend the deadline.
          result = await revoke();
        }
        if (result.status !== 204) reject();
        revoked += 1;
      } catch {
        cleanupFailed = true;
      }
    }
    cleanupSucceeded =
      cleanupAttempted &&
      !cleanupFailed &&
      grants.length === attemptedGrants.size &&
      revoked === grants.length &&
      (!intakeAttempted || cancelled || withdrawn);
    if (passedActions && !cleanupSucceeded) failureStage = "cleanup";
  }
  return Object.freeze({
    profile: processingProfile
      ? "d2_deployed_disposable_processing_to_review_v1"
      : "d2_deployed_disposable_authenticated_intake_v1",
    startedAt,
    endedAt: wallNow().toISOString(),
    durationMs: Math.round(Math.max(0, monotonic() - started)),
    passed: passedActions && cleanupSucceeded,
    ...(failureStage ? { failureStage } : {}),
    requests,
    concurrency: 1,
    acknowledgedContributions: acknowledgements,
    consentGrants: grants.length,
    ownerReads: reads,
    idempotentReplays: replay,
    expectedConflicts: conflicts,
    ambiguousWrites,
    serverFailures,
    cleanupAttempted,
    cleanupSucceeded,
    cleanupCancellations: cancelled ? 1 : 0,
    cleanupWithdrawals: withdrawn ? 1 : 0,
    processingToReviewObserved,
    processingPolls,
    cleanupPolls,
    cleanupRevocations: revoked,
    recoveryRequired: cleanupAttempted && !cleanupSucceeded,
    latency: {
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      maxMs: percentile(latencies, 1),
    },
    processingAcceptance: false,
    moderationAcceptance: false,
    publicationAcceptance: false,
    capacityAcceptance: false,
  });
}

async function main() {
  // No CLI token, payload, path, or arbitrary request options are accepted. The caller must retain
  // the exact approved scope/run UUID privately for recovery; this runner prints aggregates only.
  // The standalone operator is never a cached Turbo task; do not add credentials to cache inputs.
  const environment = process.env;
  if (
    process.argv.length !== 2 ||
    ![CONFIRMATION, PROCESSING_CONFIRMATION].includes(
      environment.D2_AUTHENTICATED_INTAKE_CONFIRMATION,
    )
  )
    reject();
  const scopeText = environment.D2_AUTHENTICATED_INTAKE_SCOPE_JSON;
  const accessToken = environment.D2_AUTHENTICATED_INTAKE_ACCESS_TOKEN;
  delete environment.D2_AUTHENTICATED_INTAKE_ACCESS_TOKEN;
  if (!scopeText || Buffer.byteLength(scopeText, "utf8") > LIMITS.maximumBodyBytes) reject();
  const result = await runDevelopmentD2AuthenticatedIntake({
    confirmation: environment.D2_AUTHENTICATED_INTAKE_CONFIRMATION,
    scope: JSON.parse(scopeText),
    getAccessToken: async () => accessToken,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write(
      "The D2 authenticated intake workload did not start: explicit disposable scope and a fresh authorized session are required.\n",
    );
    process.exitCode = 1;
  });
}
