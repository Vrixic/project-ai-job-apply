import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildIdentityAttestation,
  OPERATOR_FAILURE_CHECKS,
  OPERATOR_FAILURE_STEPS,
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
  idTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  accessToken: "generated-access-secret",
  idToken: "generated-id-secret",
  refreshToken: "generated-refresh-secret",
});

test("resume fixture is an exact opt-in and composes with the restricted fixture", () => {
  for (const restricted of [false, true]) {
    const selected = {
      ...options(),
      ResumeFixture: true,
      ...(restricted ? { RestrictedAnswerFixture: true } : {}),
    };
    assert.deepEqual(validatePlanOptions(selected), selected);
    for (const invalid of [false, "true", 1, null]) {
      assert.throws(
        () => validatePlanOptions({ ...selected, ResumeFixture: invalid }),
        /invalid_plan_options/u,
      );
    }
    const reviewed = { ...plan(), FixedSteps: restricted ? 18 : 17 };
    assert.deepEqual(sanitizeOperatorResult("plan", reviewed, restricted, true), reviewed);
    assert.throws(
      () => sanitizeOperatorResult("plan", plan(), restricted, true),
      /operator_result_invalid/u,
    );
    const completed = {
      ...receipt(),
      ResumeCoverage: {
        valid: true,
        parsedResumes: 1,
        sourceVersionsBefore: 1,
        normalizedVersionsBefore: 2,
        sourceVersionsAfter: 0,
        normalizedVersionsAfter: 0,
        deleteMarkersAfter: 0,
      },
      ...(restricted
        ? {
            RestrictedAnswerCoverage: {
              valid: true,
              activeValueCount: 1,
              expiredValueCount: 1,
              deletedTombstoneCount: 1,
              revisedValueCount: 1,
            },
          }
        : {}),
    };
    assert.deepEqual(sanitizeOperatorResult("execute", completed, restricted, true), completed);
    assert.throws(
      () => sanitizeOperatorResult("execute", completed, restricted, false),
      /operator_result_invalid/u,
    );
    for (const [name, invalid] of [
      ["valid", "true"],
      ["parsedResumes", 0],
      ["sourceVersionsBefore", 0],
      ["normalizedVersionsBefore", 1001],
      ["sourceVersionsAfter", 1],
      ["normalizedVersionsAfter", "0"],
      ["deleteMarkersAfter", 1],
      ["documentId", "unexpected"],
    ]) {
      assert.throws(
        () =>
          sanitizeOperatorResult(
            "execute",
            { ...completed, ResumeCoverage: { ...completed.ResumeCoverage, [name]: invalid } },
            restricted,
            true,
          ),
        /operator_result_invalid/u,
      );
    }
  }
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

test("operator failures expose only an allowlisted step and check, never text", () => {
  const error = sanitizeOperatorFailure({
    outcome: "failed",
    reason: "operator_failed_at_step",
    step: "operational-health",
    check: "alarm_not_ok",
  });
  assert.equal(error.message, "operator_failed_at_step");
  assert.deepEqual([error.step, error.check], ["operational-health", "alarm_not_ok"]);
  for (const value of [
    {
      outcome: "failed",
      reason: "operator_failed_at_step",
      step: "generated-secret",
      check: "alarm_not_ok",
    },
    {
      outcome: "failed",
      reason: "operator_failed_at_step",
      step: "receipt",
      check: "generated-secret",
    },
    { outcome: "failed", reason: "operator_failed_at_step", step: "receipt" },
    {
      outcome: "failed",
      reason: "operator_failed_at_step",
      step: "receipt",
      check: "unclassified",
      detail: "x",
    },
  ]) {
    const rejected = sanitizeOperatorFailure(value);
    assert.equal(rejected.message, "operator_failed_check_recovery");
    assert.equal(Object.hasOwn(rejected, "step"), false);
  }
  assert.equal(OPERATOR_FAILURE_STEPS.includes("export-cleanup"), true);
  assert.equal(OPERATOR_FAILURE_CHECKS.includes("unclassified"), true);
});

test("PowerShell bridge forwards only allowlisted lifecycle step and check tokens", () => {
  const messages = [
    "RightsLifecycleFailed:operational-health:alarm_not_ok",
    "RightsLifecycleFailed:export-cleanup:unclassified",
    "RightsLifecycleFailed:generated-secret:alarm_not_ok",
    "RightsLifecycleFailed:receipt:generated-secret",
    "RightsLifecycleFailed:receipt:alarm_not_ok generated-secret",
    "prefix RightsLifecycleFailed:receipt:alarm_not_ok",
  ];
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
    reason: "operator_failed_at_step",
    step: "operational-health",
    check: "alarm_not_ok",
  });
  assert.deepEqual(results[1], {
    outcome: "failed",
    reason: "operator_failed_at_step",
    step: "export-cleanup",
    check: "unclassified",
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

test("access refresh retains the original ID and 900-second MFA attestation lease", () => {
  const now = Date.parse("2026-10-14T19:35:00.000Z");
  const confirmed = {
    ...identity(),
    authTime: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    idTokenExpiresAt: new Date(now + 36_000_000).toISOString(),
  };
  const attestation = buildIdentityAttestation(confirmed, now);
  assert.equal(Date.parse(attestation.expiresAt), now + 900_000);
  assert.ok(Date.parse(attestation.expiresAt) > now + 660_000);
  assert.throws(
    () =>
      buildIdentityAttestation(
        { ...confirmed, expiresAt: new Date(now + 3_600_000).toISOString() },
        now + 900_000,
      ),
    /disposable_identity_expired_or_unconfirmed/u,
  );

  const shortId = {
    ...confirmed,
    expiresAt: new Date(now + 540_000).toISOString(),
    idTokenExpiresAt: new Date(now + 540_000).toISOString(),
  };
  assert.equal(Date.parse(buildIdentityAttestation(shortId, now).expiresAt), now + 540_000);
  assert.throws(
    () => buildIdentityAttestation(shortId, now + 540_000),
    /disposable_identity_expired_or_unconfirmed/u,
  );
});

test("unconfirmed, expired or excluded-owner attestations fail before file creation", () => {
  for (const changes of [
    { subject: "" },
    { authorizedOwner: "" },
    { authorizedOwner: "Zach Becker" },
    { authorizedOwner: "x".repeat(121) },
    { authTime: "invalid" },
    { authTime: new Date(Date.now() - 901_000).toISOString() },
    { expiresAt: "invalid" },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { idTokenExpiresAt: undefined },
    { idTokenExpiresAt: null },
    { idTokenExpiresAt: "invalid" },
    { idTokenExpiresAt: Date.now() + 3_600_000 },
    { idTokenExpiresAt: new Date(Date.now() - 1).toISOString() },
    { idTokenExpiresAt: new Date(Date.now() + 600_000).toISOString() },
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

test("D3 Applications inventory is an exact opt-in without caller-selected policy", () => {
  for (const RestrictedAnswerFixture of [false, true]) {
    const selected = {
      ...options(),
      ApplicationsInventory: true,
      ...(RestrictedAnswerFixture ? { RestrictedAnswerFixture: true } : {}),
    };
    assert.deepEqual(validatePlanOptions(selected), selected);
    assert.deepEqual(validateSessionCommand({ action: "plan", options: selected }), {
      action: "plan",
      options: selected,
    });
    for (const invalid of [false, "true", 1, null])
      assert.throws(
        () => validatePlanOptions({ ...selected, ApplicationsInventory: invalid }),
        /invalid_plan_options/u,
      );
    for (const key of ["ExpectedPolicyVersion", "ReviewedPolicySha256", "ExpectedOwnerInventory"])
      assert.throws(
        () => validatePlanOptions({ ...selected, [key]: "caller-selected" }),
        /invalid_plan_options/u,
      );
  }
});

test("D3 receipts require all Applications coverage while permitting empty D2 categories", () => {
  const completed = receipt();
  for (const key of Object.keys(completed.ExportCoverage))
    if (key !== "valid") completed.ExportCoverage[key] = 0;
  const names = [
    "applicationCount",
    "packetCount",
    "approvalCount",
    "attemptCount",
    "historyCount",
  ];
  for (const name of names) completed.ExportCoverage[name] = 1;
  assert.deepEqual(sanitizeOperatorResult("execute", completed, false, false, true), completed);
  assert.throws(() => sanitizeOperatorResult("execute", completed), /operator_result_invalid/u);
  for (const name of names) {
    const partial = structuredClone(completed);
    partial.ExportCoverage[name] = 0;
    assert.throws(
      () => sanitizeOperatorResult("execute", partial, false, false, true),
      /operator_result_invalid/u,
    );
    delete partial.ExportCoverage[name];
    assert.throws(
      () => sanitizeOperatorResult("execute", partial, false, false, true),
      /operator_result_invalid/u,
    );
  }
  completed.ExportCoverage.privateValue = "generated-secret";
  assert.throws(
    () => sanitizeOperatorResult("execute", completed, false, false, true),
    /operator_result_invalid/u,
  );
});

test("D4 Notifications inventory is an exact opt-in that always rides with Applications", () => {
  const selected = { ...options(), ApplicationsInventory: true, NotificationsInventory: true };
  assert.deepEqual(validatePlanOptions(selected), selected);
  assert.deepEqual(validateSessionCommand({ action: "plan", options: selected }), {
    action: "plan",
    options: selected,
  });
  // Notifications alone, or any non-true value, is refused: D4 is D3 plus Notifications.
  assert.throws(
    () => validatePlanOptions({ ...options(), NotificationsInventory: true }),
    /invalid_plan_options/u,
  );
  for (const invalid of [false, "true", 1, null])
    assert.throws(
      () => validatePlanOptions({ ...selected, NotificationsInventory: invalid }),
      /invalid_plan_options/u,
    );
});

test("D4 receipts need the seeded Notifications records and permit empty optional ones", () => {
  const completed = receipt();
  for (const key of Object.keys(completed.ExportCoverage))
    if (key !== "valid") completed.ExportCoverage[key] = 0;
  for (const name of [
    "applicationCount",
    "packetCount",
    "approvalCount",
    "attemptCount",
    "historyCount",
    "notificationsPreferencesCount",
    "notificationsPushSubscriptionCount",
  ])
    completed.ExportCoverage[name] = 1;
  for (const name of [
    "notificationsEmailDestinationCount",
    "notificationsInboxCount",
    "notificationsDeliveryCount",
  ])
    completed.ExportCoverage[name] = 0;
  assert.deepEqual(
    sanitizeOperatorResult("execute", completed, false, false, true, true),
    completed,
  );
  // Without the flag the extra names are unknown keys.
  assert.throws(
    () => sanitizeOperatorResult("execute", completed, false, false, true),
    /operator_result_invalid/u,
  );
  for (const name of ["notificationsPreferencesCount", "notificationsPushSubscriptionCount"]) {
    const partial = structuredClone(completed);
    partial.ExportCoverage[name] = 0;
    assert.throws(
      () => sanitizeOperatorResult("execute", partial, false, false, true, true),
      /operator_result_invalid/u,
    );
  }
  const leaking = structuredClone(completed);
  leaking.ExportCoverage.notificationsEndpoint = "https://fcm.googleapis.com/fcm/send/secret";
  assert.throws(
    () => sanitizeOperatorResult("execute", leaking, false, false, true, true),
    /operator_result_invalid/u,
  );
});

test("D3 failure reports only fixed Applications count names", () => {
  assert.deepEqual(sanitizeMissingCoverage(["packetCount"], true), ["packetCount"]);
  assert.equal(sanitizeMissingCoverage(["packetCount"]), null);
  assert.equal(sanitizeMissingCoverage(["privateCaptureCount"], true), null);
  const failure = sanitizeOperatorFailure({
    outcome: "failed",
    reason: "d3_coverage_missing",
    missingCoverage: ["applicationCount", "historyCount"],
  });
  assert.equal(failure.message, "d3_coverage_missing");
  assert.deepEqual(failure.missingCoverage, ["applicationCount", "historyCount"]);
  for (const missingCoverage of [
    ["generated-secret"],
    ["packetCount", "packetCount"],
    ["consentCount"],
  ]) {
    assert.equal(
      sanitizeOperatorFailure({ outcome: "failed", reason: "d3_coverage_missing", missingCoverage })
        .message,
      "operator_failed_check_recovery",
    );
  }
});

test("PowerShell D3 policy selection is fixed to the accepted inventory and canonical digest", async () => {
  const script = `$tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/lib/invoke-candidate-rights-session-action.ps1'),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Parse failure'}
    $function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-RightsSessionPolicy'},$false)
    . ([scriptblock]::Create($function.Extent.Text))
    @((Get-RightsSessionPolicy $false),(Get-RightsSessionPolicy $true),(Get-RightsSessionPolicy $true $true))|ConvertTo-Json -Compress`;
  const run = spawnSync(
    process.platform === "win32" ? "pwsh.exe" : "pwsh",
    ["-NoProfile", "-Command", script],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(run.status, 0);
  const results = JSON.parse(run.stdout);
  const { createHash } = await import("node:crypto");
  const { readFile } = await import("node:fs/promises");
  for (const [index, version] of [
    "d2-development-synthetic-v1",
    "d3-development-synthetic-v1",
    "d4-development-synthetic-v1",
  ].entries()) {
    const policy = JSON.parse(
      await readFile(join(root, `docs/security/policies/candidate-rights.${version}.json`), "utf8"),
    );
    assert.deepEqual(results[index], {
      ExpectedPolicyVersion: version,
      ReviewedPolicySha256: createHash("sha256")
        .update(`${JSON.stringify(policy, null, 2)}\n`)
        .digest("hex"),
      ExpectedOwnerInventory: policy.inventory.owners.join(","),
    });
  }
});

test("PowerShell D3 diagnostics cannot reflect arbitrary or D2 coverage names", () => {
  const prefix =
    "D3 acceptance stopped before account deletion: nonempty Applications export coverage is required for ";
  const suffix =
    ". Prepare the authorized disposable account's missing D3 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry and cleanup.";
  const messages = [
    `${prefix}applicationCount, packetCount${suffix}`,
    `${prefix}consentCount${suffix}`,
    `${prefix}generated-secret${suffix}`,
    `${prefix}packetCount, packetCount${suffix}`,
    `${prefix}packetCount${suffix}\n`,
  ];
  const script = `$tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/lib/invoke-candidate-rights-session-action.ps1'),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Parse failure'}
    $function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'ConvertTo-SafeSessionFailure'},$false)
    . ([scriptblock]::Create($function.Extent.Text))
    $messages=[Console]::In.ReadToEnd()|ConvertFrom-Json
    @($messages|ForEach-Object {ConvertTo-SafeSessionFailure $_})|ConvertTo-Json -Depth 4 -Compress`;
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
    reason: "d3_coverage_missing",
    missingCoverage: ["applicationCount", "packetCount"],
  });
  for (const result of results.slice(1))
    assert.deepEqual(result, { outcome: "failed", reason: "operator_failed_check_recovery" });
});
