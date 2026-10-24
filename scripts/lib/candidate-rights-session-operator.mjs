import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const terraformRoot = resolve(
  repositoryRoot,
  "infrastructure/terraform/environments/development/.terraform",
);
const operatorRoot = join(terraformRoot, "development-candidate-rights-acceptance");
const planKeys = [
  "ExpectedAccountId",
  "StateBucket",
  "SourceSha",
  "ZeroDriftPlanPath",
  "ReviewedZeroDriftPlanSha256",
];
const sha256 = /^[a-f0-9]{64}$/u;
const coverageNames = [
  "consentCount",
  "contributionApprovalCount",
  "contributionCount",
  "privateCaptureCount",
  "trustCaseCount",
  "trustCaseEventCount",
];
const applicationsCoverageNames = [
  "applicationCount",
  "packetCount",
  "approvalCount",
  "attemptCount",
  "historyCount",
];
// Notifications joined the inventory with the d4 policy (ADR-056). The fixed fixture seeds the
// preferences, so only that count must be nonempty.
const notificationsCoverageNames = [
  "notificationsPreferencesCount",
  "notificationsEmailDestinationCount",
  "notificationsPushSubscriptionCount",
  "notificationsInboxCount",
  "notificationsDeliveryCount",
];
const notificationsRequiredNames = ["notificationsPreferencesCount"];

export function sanitizeMissingCoverage(value, applicationsInventory = false) {
  const allowed = applicationsInventory ? applicationsCoverageNames : coverageNames;
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= allowed.length &&
    new Set(value).size === value.length &&
    value.every((name) => allowed.includes(name))
    ? [...value]
    : null;
}

/** Fixed, nonsensitive vocabulary; the operator never forwards raw error text (it may hold credentials). */
export const OPERATOR_FAILURE_STEPS = Object.freeze([
  "resume-fixture",
  "export-request",
  "export-ready",
  "export-download",
  "export-coverage",
  "grant-expiry",
  "identity-refresh",
  "deletion-cancel",
  "recent-mfa",
  "deletion-confirm",
  "deletion-completion",
  "export-cleanup",
  "resume-cleanup",
  "operational-health",
  "receipt",
  "preflight",
]);
export const OPERATOR_FAILURE_CHECKS = Object.freeze([
  "marker_not_completed",
  "export_version_remains",
  "export_inventory_invalid",
  "export_binding_invalid",
  "active_ecs_tasks",
  "queue_not_empty",
  "alarm_not_ok",
  "aws_session",
  "resume_cleanup_incomplete",
  "unclassified",
]);

export function sanitizeOperatorFailure(value) {
  if (
    exactKeys(value, ["outcome", "reason", "missingCoverage"]) &&
    value.outcome === "failed" &&
    ["d2_coverage_missing", "d3_coverage_missing"].includes(value.reason)
  ) {
    const missingCoverage = sanitizeMissingCoverage(
      value.missingCoverage,
      value.reason === "d3_coverage_missing",
    );
    if (missingCoverage) {
      const error = new Error(value.reason);
      error.missingCoverage = Object.freeze(missingCoverage);
      return error;
    }
  }
  if (
    exactKeys(value, ["outcome", "reason", "step", "check"]) &&
    value.outcome === "failed" &&
    value.reason === "operator_failed_at_step" &&
    OPERATOR_FAILURE_STEPS.includes(value.step) &&
    OPERATOR_FAILURE_CHECKS.includes(value.check)
  ) {
    const error = new Error("operator_failed_at_step");
    error.step = value.step;
    error.check = value.check;
    return error;
  }
  const reasons = ["identity_not_fresh", "source_not_ready", "operator_failed_check_recovery"];
  return new Error(
    exactKeys(value, ["outcome", "reason"]) &&
      value.outcome === "failed" &&
      reasons.includes(value.reason)
      ? value.reason
      : "operator_failed_check_recovery",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function below(root, path) {
  const delta = relative(root, resolve(path));
  return delta !== "" && delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}

function generatedResultPath(path, kind) {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    dirname(resolve(path)) === operatorRoot &&
    (kind === "plan" ? /^plan-[a-f0-9]{32}\.json$/u : /^receipt-[a-f0-9]{12}\.json$/u).test(
      basename(path),
    )
  );
}

export function validatePlanOptions(value) {
  const restricted = Object.hasOwn(value ?? {}, "RestrictedAnswerFixture");
  const resume = Object.hasOwn(value ?? {}, "ResumeFixture");
  const applications = Object.hasOwn(value ?? {}, "ApplicationsInventory");
  const notifications = Object.hasOwn(value ?? {}, "NotificationsInventory");
  if (
    !exactKeys(value, [
      ...planKeys,
      ...(restricted ? ["RestrictedAnswerFixture"] : []),
      ...(resume ? ["ResumeFixture"] : []),
      ...(applications ? ["ApplicationsInventory"] : []),
      ...(notifications ? ["NotificationsInventory"] : []),
    ]) ||
    (restricted && value.RestrictedAnswerFixture !== true) ||
    (resume && value.ResumeFixture !== true) ||
    (applications && value.ApplicationsInventory !== true) ||
    // The d4 inventory is the d3 inventory plus Notifications, never Notifications alone.
    (notifications && (!applications || value.NotificationsInventory !== true)) ||
    planKeys.some((key) => typeof value[key] !== "string") ||
    !/^[0-9]{12}$/u.test(value.ExpectedAccountId) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value.StateBucket) ||
    !/^[a-f0-9]{40}$/u.test(value.SourceSha) ||
    !sha256.test(value.ReviewedZeroDriftPlanSha256) ||
    !isAbsolute(value.ZeroDriftPlanPath) ||
    !below(terraformRoot, value.ZeroDriftPlanPath)
  ) {
    throw new Error("invalid_plan_options");
  }
  return { ...value };
}

export function validateSessionCommand(value) {
  if (exactKeys(value, ["action"]) && value.action === "cancel") return { action: "cancel" };
  if (exactKeys(value, ["action", "options"]) && value.action === "plan") {
    return { action: "plan", options: validatePlanOptions(value.options) };
  }
  if (
    exactKeys(value, ["action", "reviewedPlanSha256"]) &&
    value.action === "execute" &&
    typeof value.reviewedPlanSha256 === "string" &&
    sha256.test(value.reviewedPlanSha256)
  ) {
    return { action: "execute", reviewedPlanSha256: value.reviewedPlanSha256 };
  }
  throw new Error("invalid_session_command");
}

export function sanitizeOperatorResult(
  action,
  value,
  restrictedAnswerFixture = false,
  resumeFixture = false,
  applicationsInventory = false,
  notificationsInventory = false,
) {
  if (
    action === "plan" &&
    exactKeys(value, ["Outcome", "PlanPath", "PlanSha256", "FixedSteps", "CloudMutation"]) &&
    value.Outcome === "review-required" &&
    generatedResultPath(value.PlanPath, "plan") &&
    sha256.test(value.PlanSha256) &&
    value.FixedSteps === 15 + (restrictedAnswerFixture ? 1 : 0) + (resumeFixture ? 2 : 0) &&
    value.CloudMutation === false
  ) {
    return {
      Outcome: value.Outcome,
      PlanPath: value.PlanPath,
      PlanSha256: value.PlanSha256,
      FixedSteps: value.FixedSteps,
      CloudMutation: false,
    };
  }
  const counts = [
    "consentCount",
    "contributionApprovalCount",
    "contributionCount",
    "privateCaptureCount",
    "trustCaseCount",
    "trustCaseEventCount",
  ];
  if (applicationsInventory) counts.push(...applicationsCoverageNames);
  if (notificationsInventory) counts.push(...notificationsCoverageNames);
  if (
    action === "execute" &&
    exactKeys(value, [
      "Outcome",
      "ReceiptPath",
      "ReceiptSha256",
      "ExportsRequested",
      "DeletionMarkersCompleted",
      "PersistentSyntheticIdentities",
      "ExportCoverage",
      ...(restrictedAnswerFixture ? ["RestrictedAnswerCoverage"] : []),
      ...(resumeFixture ? ["ResumeCoverage"] : []),
    ]) &&
    value.Outcome === "verified-and-cleaned" &&
    generatedResultPath(value.ReceiptPath, "receipt") &&
    sha256.test(value.ReceiptSha256) &&
    value.ExportsRequested === 1 &&
    value.DeletionMarkersCompleted === 1 &&
    value.PersistentSyntheticIdentities === 0 &&
    exactKeys(value.ExportCoverage, ["valid", ...counts]) &&
    value.ExportCoverage.valid === true &&
    counts.every(
      (key) =>
        Number.isSafeInteger(value.ExportCoverage[key]) &&
        value.ExportCoverage[key] >=
          (notificationsRequiredNames.includes(key)
            ? 1
            : notificationsCoverageNames.includes(key) ||
                (applicationsInventory && !applicationsCoverageNames.includes(key))
              ? 0
              : 1) &&
        value.ExportCoverage[key] <= 1048576,
    ) &&
    value.ExportCoverage.contributionCount === value.ExportCoverage.contributionApprovalCount &&
    (!restrictedAnswerFixture ||
      (exactKeys(value.RestrictedAnswerCoverage, [
        "valid",
        "activeValueCount",
        "expiredValueCount",
        "deletedTombstoneCount",
        "revisedValueCount",
      ]) &&
        value.RestrictedAnswerCoverage.valid === true &&
        [
          "activeValueCount",
          "expiredValueCount",
          "deletedTombstoneCount",
          "revisedValueCount",
        ].every((key) => value.RestrictedAnswerCoverage[key] === 1))) &&
    (!resumeFixture ||
      (exactKeys(value.ResumeCoverage, [
        "valid",
        "parsedResumes",
        "sourceVersionsBefore",
        "normalizedVersionsBefore",
        "sourceVersionsAfter",
        "normalizedVersionsAfter",
        "deleteMarkersAfter",
      ]) &&
        value.ResumeCoverage.valid === true &&
        value.ResumeCoverage.parsedResumes === 1 &&
        ["sourceVersionsBefore", "normalizedVersionsBefore"].every(
          (key) =>
            Number.isSafeInteger(value.ResumeCoverage[key]) &&
            value.ResumeCoverage[key] >= 1 &&
            value.ResumeCoverage[key] <= 1000,
        ) &&
        ["sourceVersionsAfter", "normalizedVersionsAfter", "deleteMarkersAfter"].every(
          (key) => value.ResumeCoverage[key] === 0,
        )))
  ) {
    return {
      ...value,
      ExportCoverage: { ...value.ExportCoverage },
      ...(restrictedAnswerFixture
        ? { RestrictedAnswerCoverage: { ...value.RestrictedAnswerCoverage } }
        : {}),
      ...(resumeFixture ? { ResumeCoverage: { ...value.ResumeCoverage } } : {}),
    };
  }
  throw new Error("operator_result_invalid");
}

export function buildIdentityAttestation(identity, now = Date.now()) {
  if (Object.hasOwn(identity, "purpose") || Object.hasOwn(identity, "profile")) {
    throw new Error("disposable_identity_expired_or_unconfirmed");
  }
  const admissionExpires = Date.parse(identity.expiresAt);
  const idTokenExpires = Date.parse(identity.idTokenExpiresAt);
  const expires = Math.min(idTokenExpires, Date.parse(identity.authTime) + 900_000);
  if (
    !Number.isFinite(admissionExpires) ||
    admissionExpires <= now ||
    typeof identity.idTokenExpiresAt !== "string" ||
    !Number.isFinite(idTokenExpires) ||
    idTokenExpires < admissionExpires ||
    !Number.isFinite(expires) ||
    expires <= now ||
    typeof identity.subject !== "string" ||
    !identity.subject ||
    typeof identity.authorizedOwner !== "string" ||
    !identity.authorizedOwner.trim() ||
    identity.authorizedOwner.length > 120 ||
    /zach\s*becker/iu.test(identity.authorizedOwner)
  ) {
    throw new Error("disposable_identity_expired_or_unconfirmed");
  }
  return {
    schemaVersion: 1,
    classification: "generated-synthetic-only",
    issuer: identity.issuer,
    subjectSha256: createHash("sha256").update(identity.subject, "utf8").digest("hex"),
    authorizedOwner: identity.authorizedOwner,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
  };
}

function resolvePowerShell() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("CANDIDATE_RIGHTS_ACCEPTANCE_") || key === "NODE_OPTIONS")
      delete environment[key];
  }
  for (const executable of process.platform === "win32" ? ["pwsh.exe", "pwsh"] : ["pwsh"]) {
    const probe = spawnSync(executable, ["-NoProfile", "-Command", "$PSVersionTable.PSEdition"], {
      encoding: "utf8",
      env: environment,
      windowsHide: true,
      timeout: 10_000,
    });
    if (probe.status === 0 && probe.stdout.trim() === "Core") return executable;
  }
  throw new Error("operator_unavailable");
}

export async function runSessionOperator({
  action,
  options,
  reviewedPlan,
  identity,
  clientSecret,
  attestationJson,
}) {
  const checked = validatePlanOptions(options);
  if (!below(await realpath(terraformRoot), await realpath(checked.ZeroDriftPlanPath)))
    throw new Error("invalid_plan_options");
  if (
    createHash("sha256")
      .update(await readFile(checked.ZeroDriftPlanPath))
      .digest("hex") !== checked.ReviewedZeroDriftPlanSha256
  ) {
    throw new Error("zero_drift_plan_changed");
  }
  if (action !== "plan" && action !== "execute") throw new Error("invalid_session_command");
  const request = { action, options: checked };
  if (action === "execute") {
    const plan = sanitizeOperatorResult(
      "plan",
      reviewedPlan,
      checked.RestrictedAnswerFixture === true,
      checked.ResumeFixture === true,
      checked.ApplicationsInventory === true,
      checked.NotificationsInventory === true,
    );
    request.reviewedPlan = { path: plan.PlanPath, sha256: plan.PlanSha256 };
  }
  const executable = resolvePowerShell();
  const environment = {
    ...process.env,
    CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN: identity.accessToken,
    CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN: identity.idToken,
    CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN: identity.refreshToken,
    CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET: clientSecret,
    CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_JSON: attestationJson,
  };
  delete environment.CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH;
  delete environment.CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY;
  delete environment.NODE_OPTIONS;
  const result = await new Promise((done, reject) => {
    // Own PowerShell directly: killing a Node launcher would orphan its live operator on Windows.
    const child = spawn(
      executable,
      ["-NoProfile", "-File", "scripts/lib/invoke-candidate-rights-session-action.ps1"],
      {
        cwd: repositoryRoot,
        env: environment,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    let bytes = 0;
    let interrupted = false;
    const interrupt = () => {
      interrupted = true;
      child.kill();
    };
    const timeout = setTimeout(interrupt, 20 * 60_000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("operator_unavailable"));
    });
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) interrupt();
      else output += chunk.toString("utf8");
    });
    // Never replay child diagnostics: even unexpected third-party errors may contain credentials.
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) interrupt();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (interrupted) {
        reject(new Error("operator_interrupted_check_recovery"));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        reject(new Error("operator_failed_check_recovery"));
        return;
      }
      if (code !== 0) {
        reject(sanitizeOperatorFailure(parsed));
      } else done(parsed);
    });
  });
  return sanitizeOperatorResult(
    action,
    result,
    checked.RestrictedAnswerFixture === true,
    checked.ResumeFixture === true,
    checked.ApplicationsInventory === true,
    checked.NotificationsInventory === true,
  );
}
