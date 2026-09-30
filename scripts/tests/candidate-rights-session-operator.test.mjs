import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildIdentityAttestation,
  sanitizeMissingCoverage,
  sanitizeOperatorFailure,
  sanitizeOperatorResult,
  validatePlanOptions,
  validateSessionCommand,
} from "../lib/candidate-rights-session-operator.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const terraformRoot = resolve(root, "infrastructure/terraform/environments/development/.terraform");
const operatorRoot = join(terraformRoot, "development-candidate-rights-acceptance");
const options = () => ({
  ExpectedAccountId: "123456789012",
  StateBucket: "synthetic-state-bucket",
  SourceSha: "a".repeat(40),
  ZeroDriftPlanPath: join(terraformRoot, "generated-plan.tfplan"),
  ReviewedZeroDriftPlanSha256: "b".repeat(64),
});
const plan = () => ({
  Outcome: "review-required",
  PlanPath: join(operatorRoot, `plan-${"c".repeat(32)}.json`),
  PlanSha256: "d".repeat(64),
  FixedSteps: 15,
  CloudMutation: false,
});
const receipt = () => ({
  Outcome: "verified-and-cleaned",
  ReceiptPath: join(operatorRoot, `receipt-${"d".repeat(12)}.json`),
  ReceiptSha256: "e".repeat(64),
  ExportsRequested: 1,
  DeletionMarkersCompleted: 1,
  PersistentSyntheticIdentities: 0,
  ExportCoverage: {
    valid: true,
    consentCount: 1,
    contributionApprovalCount: 1,
    contributionCount: 1,
    privateCaptureCount: 1,
    trustCaseCount: 1,
    trustCaseEventCount: 1,
  },
});
const identity = () => ({
  subject: "auth0|generated-disposable-subject",
  issuer: "https://synthetic.example/",
  authorizedOwner: "Generated Operator",
  authTime: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  accessToken: "generated-access-secret",
  idToken: "generated-id-secret",
  refreshToken: "generated-refresh-secret",
});

test("missing coverage failures retain only unique allowlisted names", () => {
  const names = Object.keys(receipt().ExportCoverage).filter((key) => key !== "valid");
  for (const missingCoverage of [["privateCaptureCount"], names]) {
    const error = sanitizeOperatorFailure({
      outcome: "failed",
      reason: "d2_coverage_missing",
      missingCoverage,
    });
    assert.equal(error.message, "d2_coverage_missing");
    assert.deepEqual(error.missingCoverage, missingCoverage);
    assert.notEqual(error.missingCoverage, missingCoverage);
    assert.deepEqual(sanitizeMissingCoverage(error.missingCoverage), missingCoverage);
  }
  for (const missingCoverage of [
    undefined,
    null,
    "privateCaptureCount",
    [],
    ["generated-secret"],
    ["privateCaptureCount", "privateCaptureCount"],
    ["PrivateCaptureCount"],
    ["privateCaptureCount\n"],
    [1],
    [...names, "privateCaptureCount"],
  ]) {
    assert.equal(sanitizeMissingCoverage(missingCoverage), null);
    const error = sanitizeOperatorFailure({
      outcome: "failed",
      reason: "d2_coverage_missing",
      missingCoverage,
    });
    assert.equal(error.message, "operator_failed_check_recovery");
    assert.equal(error.missingCoverage, undefined);
    assert.equal(JSON.stringify(error).includes("generated-secret"), false);
  }
  for (const value of [
    null,
    {},
    [],
    { outcome: "failed", reason: "d2_coverage_missing" },
    {
      outcome: "failed",
      reason: "d2_coverage_missing",
      missingCoverage: ["privateCaptureCount"],
      token: "generated-secret",
    },
    { outcome: "success", reason: "source_not_ready" },
    { outcome: "failed", reason: "generated-secret" },
  ]) {
    const error = sanitizeOperatorFailure(value);
    assert.equal(error.message, "operator_failed_check_recovery");
    assert.equal(error.missingCoverage, undefined);
  }
  for (const reason of [
    "identity_not_fresh",
    "source_not_ready",
    "operator_failed_check_recovery",
  ]) {
    assert.equal(sanitizeOperatorFailure({ outcome: "failed", reason }).message, reason);
  }
});

test("PowerShell missing-coverage parser rejects altered or sensitive diagnostics", () => {
  const prefix =
    "D2 acceptance stopped before account deletion: nonempty export coverage is required for ";
  const suffix =
    ". Prepare the authorized disposable account's missing D2 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry.";
  const messages = [
    `${prefix}privateCaptureCount${suffix}`,
    `${prefix}consentCount, contributionCount${suffix}`,
    `${prefix}privateCaptureCount, privateCaptureCount${suffix}`,
    `${prefix}generated-secret${suffix}`,
    `${prefix}PrivateCaptureCount${suffix}`,
    `${prefix}privateCaptureCount${suffix}\n`,
    `${prefix}privateCaptureCount${suffix} generated-secret`,
    `${prefix}privateCaptureCount`,
    `${prefix}${suffix}`,
    `${prefix}${"x".repeat(1100)}${suffix}`,
  ];
  // Extract only the pure function from the AST. Never invoke the bridge/operator or cloud.
  const script = `$tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/lib/invoke-candidate-rights-session-action.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw 'Parse failure' }
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'ConvertTo-SafeSessionFailure' }, $false)
    . ([scriptblock]::Create($function.Extent.Text))
    $messages = [Console]::In.ReadToEnd() | ConvertFrom-Json
    @($messages | ForEach-Object { ConvertTo-SafeSessionFailure $_ }) | ConvertTo-Json -Depth 4 -Compress`;
  const run = spawnSync(
    process.platform === "win32" ? "pwsh.exe" : "pwsh",
    ["-NoProfile", "-Command", script],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(messages),
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.equal(run.status, 0);
  assert.equal(`${run.stdout}${run.stderr}`.includes("generated-secret"), false);
  const results = JSON.parse(run.stdout);
  assert.deepEqual(results[0], {
    outcome: "failed",
    reason: "d2_coverage_missing",
    missingCoverage: ["privateCaptureCount"],
  });
  assert.deepEqual(results[1], {
    outcome: "failed",
    reason: "d2_coverage_missing",
    missingCoverage: ["consentCount", "contributionCount"],
  });
  for (const result of results.slice(2))
    assert.deepEqual(result, { outcome: "failed", reason: "operator_failed_check_recovery" });
});

test("only exact public plan arguments are accepted", () => {
  assert.deepEqual(validatePlanOptions(options()), options());
  for (const key of Object.keys(options())) {
    const missing = options();
    delete missing[key];
    assert.throws(() => validatePlanOptions(missing), /invalid_plan_options/u);
    assert.throws(() => validatePlanOptions({ ...options(), [key]: 1 }), /invalid_plan_options/u);
  }
  for (const value of [
    null,
    [],
    {},
    { ...options(), AccessToken: "secret" },
    { ...options(), Action: "Execute" },
  ]) {
    assert.throws(() => validatePlanOptions(value), /invalid_plan_options/u);
  }
  for (const path of [
    root,
    terraformRoot,
    join(root, "secret.json"),
    "relative.tfplan",
    join(terraformRoot, "../escape.tfplan"),
  ]) {
    assert.throws(
      () => validatePlanOptions({ ...options(), ZeroDriftPlanPath: path }),
      /invalid_plan_options/u,
    );
  }
  for (const [key, value] of [
    ["ExpectedAccountId", "123"],
    ["SourceSha", "a".repeat(39)],
    ["StateBucket", "bucket;command"],
    ["ReviewedZeroDriftPlanSha256", "B".repeat(64)],
  ]) {
    assert.throws(
      () => validatePlanOptions({ ...options(), [key]: value }),
      /invalid_plan_options/u,
    );
  }
});

test("stdin control accepts only plan, exact reviewed execute, and cancellation", () => {
  assert.deepEqual(validateSessionCommand({ action: "cancel" }), { action: "cancel" });
  assert.deepEqual(validateSessionCommand({ action: "plan", options: options() }), {
    action: "plan",
    options: options(),
  });
  assert.deepEqual(
    validateSessionCommand({ action: "execute", reviewedPlanSha256: "f".repeat(64) }),
    { action: "execute", reviewedPlanSha256: "f".repeat(64) },
  );
  for (const command of [
    null,
    [],
    {},
    { action: "execute" },
    { action: "cancel", other: 1 },
    { action: "RecoverUnconfirmed" },
    { action: "execute", reviewedPlanSha256: "secret" },
    { action: "plan", options: options(), command: "untrusted" },
  ]) {
    assert.throws(() => validateSessionCommand(command), /invalid_session_command/u);
  }
});

test("child output exposes only exact aggregate plan and receipt shapes", () => {
  assert.deepEqual(sanitizeOperatorResult("plan", plan()), plan());
  assert.deepEqual(sanitizeOperatorResult("execute", receipt()), receipt());
  for (const result of [
    { ...plan(), Token: "secret" },
    { ...plan(), CloudMutation: true },
    { ...plan(), PlanPath: join(operatorRoot, "token-containing-name.json") },
    { ...plan(), PlanPath: join(root, `plan-${"c".repeat(32)}.json`) },
    { ...plan(), FixedSteps: 14 },
    { ...plan(), PlanSha256: "invalid" },
  ]) {
    assert.throws(() => sanitizeOperatorResult("plan", result), /operator_result_invalid/u);
  }
  for (const key of Object.keys(receipt().ExportCoverage).filter((key) => key !== "valid")) {
    const result = receipt();
    result.ExportCoverage[key] = 0;
    assert.throws(() => sanitizeOperatorResult("execute", result), /operator_result_invalid/u);
  }
  for (const result of [
    { ...receipt(), subject: "sensitive" },
    { ...receipt(), PersistentSyntheticIdentities: 1 },
    { ...receipt(), ReceiptPath: join(operatorRoot, "secret.json") },
    { ...receipt(), ExportsRequested: 0 },
  ]) {
    assert.throws(() => sanitizeOperatorResult("execute", result), /operator_result_invalid/u);
  }
  const mismatched = receipt();
  mismatched.ExportCoverage.contributionCount = 2;
  assert.throws(() => sanitizeOperatorResult("execute", mismatched), /operator_result_invalid/u);
});

test("restricted fixture is explicit, plan-bound and reports only fixed aggregate coverage", () => {
  const selected = { ...options(), RestrictedAnswerFixture: true };
  assert.deepEqual(validatePlanOptions(selected), selected);
  for (const flag of [false, 1, "true", null]) {
    assert.throws(
      () => validatePlanOptions({ ...options(), RestrictedAnswerFixture: flag }),
      /invalid_plan_options/u,
    );
  }
  const restrictedPlan = { ...plan(), FixedSteps: 16 };
  assert.deepEqual(sanitizeOperatorResult("plan", restrictedPlan, true), restrictedPlan);
  assert.throws(() => sanitizeOperatorResult("plan", restrictedPlan), /operator_result_invalid/u);
  assert.throws(() => sanitizeOperatorResult("plan", plan(), true), /operator_result_invalid/u);
  const coverage = {
    valid: true,
    activeValueCount: 1,
    expiredValueCount: 1,
    deletedTombstoneCount: 1,
    revisedValueCount: 1,
  };
  const restrictedReceipt = { ...receipt(), RestrictedAnswerCoverage: coverage };
  assert.deepEqual(sanitizeOperatorResult("execute", restrictedReceipt, true), restrictedReceipt);
  assert.throws(
    () => sanitizeOperatorResult("execute", restrictedReceipt),
    /operator_result_invalid/u,
  );
  assert.throws(
    () => sanitizeOperatorResult("execute", receipt(), true),
    /operator_result_invalid/u,
  );
  for (const key of Object.keys(coverage)) {
    const changed = { ...restrictedReceipt, RestrictedAnswerCoverage: { ...coverage, [key]: 0 } };
    assert.throws(
      () => sanitizeOperatorResult("execute", changed, true),
      /operator_result_invalid/u,
    );
  }
  for (const extra of ["value", "id", "fieldKey", "createdAt"]) {
    const changed = {
      ...restrictedReceipt,
      RestrictedAnswerCoverage: { ...coverage, [extra]: "generated-private" },
    };
    assert.throws(
      () => sanitizeOperatorResult("execute", changed, true),
      /operator_result_invalid/u,
    );
  }
});

test("in-memory attestation binds confirmed subject without retaining token or raw subject", () => {
  const confirmed = identity();
  const attestation = buildIdentityAttestation(confirmed);
  assert.equal(attestation.classification, "generated-synthetic-only");
  assert.match(attestation.subjectSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Date.parse(attestation.expiresAt), Date.parse(confirmed.authTime) + 900_000);
  for (const secret of [
    confirmed.accessToken,
    confirmed.idToken,
    confirmed.refreshToken,
    confirmed.subject,
  ]) {
    assert.equal(JSON.stringify(attestation).includes(secret), false);
  }
});

test("unconfirmed, expired or excluded-owner attestations fail before file creation", () => {
  for (const changes of [
    { subject: "" },
    { authorizedOwner: "" },
    { authorizedOwner: "Zach Becker" },
    { authorizedOwner: "x".repeat(121) },
    { authTime: "invalid" },
    { authTime: new Date(Date.now() - 901_000).toISOString() },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
  ]) {
    assert.throws(
      () => buildIdentityAttestation({ ...identity(), ...changes }),
      /disposable_identity_expired_or_unconfirmed/u,
    );
  }
});

test("PowerShell bridge rejects unknown operations before any operator call", () => {
  const command = process.platform === "win32" ? "pwsh.exe" : "pwsh";
  const run = spawnSync(
    command,
    ["-NoProfile", "-File", "scripts/lib/invoke-candidate-rights-session-action.ps1"],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ action: "untrusted", command: "generated-secret" }),
      windowsHide: true,
    },
  );
  assert.equal(run.status, 1);
  assert.deepEqual(JSON.parse(run.stdout), {
    outcome: "failed",
    reason: "operator_failed_check_recovery",
  });
  assert.equal(`${run.stdout}${run.stderr}`.includes("generated-secret"), false);
});
