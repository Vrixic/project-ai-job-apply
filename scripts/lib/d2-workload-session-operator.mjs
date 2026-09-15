import { createHash, randomBytes } from "node:crypto";
import {
  approvedPreviewDigest,
  disposableIdentityDigest,
  PROCESSING_ACTIONS,
  PROCESSING_CONFIRMATION,
  PROCESSING_KIND,
  PROCESSING_LIMITS,
  runDevelopmentD2AuthenticatedIntake,
} from "../run-development-d2-authenticated-intake.mjs";
import { parseDevelopmentOrigin } from "../run-development-d2-public-boundary.mjs";
import { completeD2RecoveryScope, preserveD2RecoveryScope } from "./d2-workload-recovery.mjs";

export { PROCESSING_CONFIRMATION };
export const D2_WORKLOAD_SOURCE =
  "https://jobs.ashbyhq.com/Mintlify/4da2f7a2-3d5a-4652-bf01-aed59f4cb72b";
export const D2_WORKLOAD_TITLE = "Backend Engineer";
const fail = (reason = "invalid_workload_setup") => {
  throw new Error(reason);
};
const exact = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function validateD2WorkloadPreview(preview, now = Date.now()) {
  if (
    !exact(preview, ["client", "source", "posting", "observedAt"]) ||
    !exact(preview.client, ["surface", "version"]) ||
    preview.client.surface !== "browser_extension" ||
    preview.client.version !== "0.2.0" ||
    !exact(preview.source, [
      "provider",
      "pageVariant",
      "sourceUrl",
      "externalJobId",
      "adapterVersion",
    ]) ||
    preview.source.provider !== "ashby" ||
    preview.source.pageVariant !== "ashby-job-board-v1" ||
    preview.source.sourceUrl !== D2_WORKLOAD_SOURCE ||
    preview.source.externalJobId !== "4da2f7a2-3d5a-4652-bf01-aed59f4cb72b" ||
    preview.source.adapterVersion !== "d2-job-page-v1" ||
    !exact(preview.posting, ["title"]) ||
    preview.posting.title !== D2_WORKLOAD_TITLE ||
    typeof preview.observedAt !== "string"
  )
    fail();
  const observed = Date.parse(preview.observedAt);
  if (
    !Number.isFinite(observed) ||
    new Date(observed).toISOString() !== preview.observedAt ||
    observed > now ||
    now - observed > 86_400_000
  )
    fail();
  return structuredClone(preview);
}

function identityBinding(identity, configuration, now) {
  if (
    identity?.purpose !== "d2_workload" ||
    identity.profile !== "d2_disposable_contribution_workload_v1" ||
    typeof identity.accessToken !== "string" ||
    identity.accessToken.length > 16_384 ||
    typeof identity.authorizedOwner !== "string" ||
    !identity.authorizedOwner.trim() ||
    identity.authorizedOwner.length > 120 ||
    /zach\s*becker/iu.test(identity.authorizedOwner) ||
    identity.issuer !== configuration.issuer ||
    typeof identity.subject !== "string" ||
    identity.subject.length < 3 ||
    identity.subject.length > 200
  )
    fail("disposable_identity_unavailable");
  const expiry = Date.parse(identity.expiresAt);
  const auth = Date.parse(identity.authTime);
  if (
    !Number.isFinite(expiry) ||
    expiry < now + PROCESSING_LIMITS.totalDeadlineMs ||
    !Number.isFinite(auth) ||
    auth > now ||
    now - auth > 900_000
  )
    fail("disposable_identity_unavailable");
  // The maintained sign-in helper verifies signatures before handing off this purpose-tagged
  // bundle. Decoding here only fences its audience/client/subject; it is not authentication.
  let claims;
  let header;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(identity.accessToken)) fail();
    [header, claims] = identity.accessToken
      .split(".")
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
  } catch {
    fail("disposable_identity_unavailable");
  }
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (
    header.alg !== "RS256" ||
    claims.iss !== configuration.issuer ||
    claims.sub !== identity.subject ||
    claims.azp !== configuration.clientId ||
    !Array.isArray(audiences) ||
    !audiences.includes(configuration.audience) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp * 1000 < now + PROCESSING_LIMITS.totalDeadlineMs ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat * 1000 > now ||
    typeof claims.scope !== "string" ||
    !["jobs:read", "jobs:contribute", "profile:write"].every((scope) =>
      claims.scope.split(" ").includes(scope),
    )
  )
    fail("disposable_identity_unavailable");
  return disposableIdentityDigest({
    iss: configuration.issuer,
    sub: identity.subject,
    aud: configuration.audience,
    azp: configuration.clientId,
  });
}

function uuidV7(now) {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sanitizeD2WorkloadResult(value) {
  const numeric = [
    "durationMs",
    "requests",
    "acknowledgedContributions",
    "consentGrants",
    "ownerReads",
    "idempotentReplays",
    "expectedConflicts",
    "ambiguousWrites",
    "serverFailures",
    "cleanupCancellations",
    "cleanupWithdrawals",
    "processingPolls",
    "cleanupPolls",
    "cleanupRevocations",
  ];
  const boolean = [
    "passed",
    "cleanupAttempted",
    "cleanupSucceeded",
    "processingToReviewObserved",
    "recoveryRequired",
  ];
  const acceptance = [
    "processingAcceptance",
    "moderationAcceptance",
    "publicationAcceptance",
    "capacityAcceptance",
  ];
  const stages = [
    "policy_preflight",
    "consent_grant",
    "intake",
    "owner_read",
    "idempotent_replay",
    "conflict_grant",
    "idempotency_conflict",
    "processing_to_review",
    "cleanup",
  ];
  if (
    value?.profile !== "d2_deployed_disposable_processing_to_review_v1" ||
    value.concurrency !== 1 ||
    numeric.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0) ||
    boolean.some((key) => typeof value[key] !== "boolean") ||
    acceptance.some((key) => value[key] !== false) ||
    (value.failureStage !== undefined && !stages.includes(value.failureStage)) ||
    ![value.startedAt, value.endedAt].every(
      (date) =>
        typeof date === "string" &&
        Number.isFinite(Date.parse(date)) &&
        new Date(Date.parse(date)).toISOString() === date,
    ) ||
    !exact(value.latency, ["p50Ms", "p95Ms", "maxMs"]) ||
    Object.values(value.latency).some((number) => !Number.isFinite(number) || number < 0)
  )
    fail("workload_result_unavailable");
  return {
    profile: value.profile,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    concurrency: 1,
    ...Object.fromEntries([...numeric, ...boolean, ...acceptance].map((key) => [key, value[key]])),
    ...(value.failureStage === undefined ? {} : { failureStage: value.failureStage }),
    latency: { p50Ms: value.latency.p50Ms, p95Ms: value.latency.p95Ms, maxMs: value.latency.maxMs },
  };
}

/** Tokens stay in memory; the fixed recovery adapter encrypts scope before any dispatch. */
export function createD2WorkloadSessionOperator(options, dependencies = {}) {
  if (Object.keys(dependencies).length && process.env.NODE_ENV !== "test")
    fail("test_dependencies_forbidden");
  if (
    !exact(options, ["identity", "configuration", "apiOrigin", "ugcPolicyVersion"]) ||
    !exact(options.configuration, ["issuer", "audience", "clientId"]) ||
    typeof options.ugcPolicyVersion !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(options.ugcPolicyVersion)
  )
    fail();
  const configuration = { ...options.configuration };
  const ugcPolicyVersion = options.ugcPolicyVersion;
  if (
    typeof configuration.issuer !== "string" ||
    !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.auth0\.com\/$/u.test(configuration.issuer) ||
    typeof configuration.audience !== "string" ||
    configuration.audience.length < 3 ||
    configuration.audience.length > 200 ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(configuration.clientId)
  )
    fail();
  const originUrl = parseDevelopmentOrigin(options.apiOrigin);
  if (originUrl.port) fail();
  const origin = originUrl.origin;
  if (origin !== options.apiOrigin) fail();
  let identity = { ...options.identity };
  const now = dependencies.now ?? Date.now;
  const run = dependencies.run ?? runDevelopmentD2AuthenticatedIntake;
  const preserve = dependencies.preserve ?? preserveD2RecoveryScope;
  const complete = dependencies.complete ?? completeD2RecoveryScope;
  identityBinding(identity, configuration, now());
  let scope;
  let digest;
  let attempted = false;
  let running = false;
  let recovery = false;
  let noDispatchFailure = false;
  let closed = false;
  return Object.freeze({
    get executionAttempted() {
      return attempted;
    },
    get readiness() {
      return closed
        ? "closed"
        : running
          ? "running"
          : recovery
            ? "recovery-required"
            : noDispatchFailure
              ? "not-dispatched"
              : attempted
                ? "completed"
                : scope
                  ? "prepared"
                  : "unprepared";
    },
    prepare(preview) {
      if (closed || scope || attempted) fail("workload_already_prepared");
      const instant = now();
      const identitySha256 = identityBinding(identity, configuration, instant);
      const approved = validateD2WorkloadPreview(preview, instant);
      scope = {
        schemaVersion: 2,
        kind: PROCESSING_KIND,
        capabilityMode: "development",
        runId: uuidV7(instant),
        apiOrigin: origin,
        issuedAt: new Date(instant).toISOString(),
        expiresAt: new Date(instant + 30 * 60_000).toISOString(),
        disposableCandidate: true,
        identitySha256,
        ...configuration,
        sourceAuthorized: true,
        actions: [...PROCESSING_ACTIONS],
        ugcPolicyVersion,
        preview: approved,
        previewSha256: approvedPreviewDigest(approved),
        readRequests: 1,
      };
      digest = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
      return {
        outcome: "review-required",
        reviewedScopeSha256: digest,
        limits: { ...PROCESSING_LIMITS },
        readRequests: 1,
      };
    },
    async execute(command) {
      if (
        closed ||
        attempted ||
        !scope ||
        !exact(command, ["confirmation", "reviewedScopeSha256"]) ||
        command.confirmation !== PROCESSING_CONFIRMATION ||
        command.reviewedScopeSha256 !== digest
      )
        fail("workload_execution_not_authorized");
      identityBinding(identity, configuration, now());
      if (Date.parse(scope.expiresAt) < now() + PROCESSING_LIMITS.totalDeadlineMs)
        fail("workload_scope_expired");
      attempted = true;
      running = true;
      let recoveryHandle;
      try {
        // Never send a write unless its exact recovery scope is durably retained first.
        recoveryHandle = await preserve(structuredClone(scope));
      } catch {
        running = false;
        noDispatchFailure = true;
        fail("workload_recovery_unavailable_no_dispatch");
      }
      recovery = true;
      try {
        const result = sanitizeD2WorkloadResult(
          await run({
            scope: structuredClone(scope),
            confirmation: PROCESSING_CONFIRMATION,
            getAccessToken: async () => identity.accessToken,
          }),
        );
        recovery = !result.cleanupSucceeded || result.recoveryRequired;
        if (!recovery) {
          // A completion marker retains the encrypted scope for audit, not a second execution.
          await complete(recoveryHandle);
          scope = undefined;
          identity = undefined;
        }
        return result;
      } catch {
        recovery = true;
        fail("workload_failed_recovery_retained");
      } finally {
        running = false;
      }
    },
    close() {
      if (running) return { outcome: "busy" };
      scope = undefined;
      identity = undefined;
      closed = true;
      return recovery ? { outcome: "closed", recoveryRequired: true } : { outcome: "closed" };
    },
  });
}
