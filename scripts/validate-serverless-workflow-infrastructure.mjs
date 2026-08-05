import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const durable = read("infrastructure/terraform/modules/platform/durable-workflow.tf");
const platform = read("infrastructure/terraform/modules/platform/main.tf");
const variables = read("infrastructure/terraform/modules/platform/variables.tf");
const bootstrap = read("infrastructure/terraform/bootstrap/main.tf");
const publicationWorkflow = read(".github/workflows/publish-workflow-lambdas.yml");
const environments = [
  read("infrastructure/terraform/environments/development/main.tf"),
  read("infrastructure/terraform/environments/staging/main.tf"),
];
const environmentVariables = [
  read("infrastructure/terraform/environments/development/variables.tf"),
  read("infrastructure/terraform/environments/staging/variables.tf"),
];
const ecsIdleOperator = read("scripts/operate-phase0-ecs-idle-shutdown.ps1");
const workflowConformanceOperator = read(
  "scripts/operate-serverless-workflow-dark-conformance.ps1",
);
const developmentWorkflowConformanceWrapper = read(
  "scripts/operate-development-serverless-workflow-dark-conformance.ps1",
);
const stagingWorkflowConformanceWrapper = read(
  "scripts/operate-staging-serverless-workflow-dark-conformance.ps1",
);
const workflowReleaseRollbackOperator = read(
  "scripts/operate-serverless-workflow-release-rollback.ps1",
);
const developmentWorkflowReleaseRollbackWrapper = read(
  "scripts/operate-development-serverless-workflow-release-rollback.ps1",
);
const stagingWorkflowReleaseRollbackWrapper = read(
  "scripts/operate-staging-serverless-workflow-release-rollback.ps1",
);
const workflowPlanner = read("scripts/plan-serverless-workflow-dark.ps1");
const stagingRuntimeCutoverWrapper = read("scripts/plan-staging-serverless-runtime-cutover.ps1");
const stagingRuntimeCutoverOperator = read(
  "scripts/operate-staging-serverless-runtime-cutover.ps1",
);
const stagingGatewayReleaseOperator = read("scripts/operate-staging-gateway-runtime-release.ps1");
const stagingLegacyTemporalDrain = read("scripts/operate-staging-legacy-temporal-drain.ps1");
const gatewayConformanceLauncher = read("scripts/start-deployed-web-conformance.ps1");
const gatewayBoundaryOperator = read("scripts/verify-gateway-lambda-boundary.ps1");
const developmentGatewayBoundaryWrapper = read(
  "scripts/verify-development-gateway-lambda-boundary.ps1",
);
const stagingGatewayBoundaryWrapper = read("scripts/verify-staging-gateway-lambda-boundary.ps1");
const darkGatewayBridge = read("backend/gateway/src/dark-conformance-bridge.ts");

const requireText = (source, expected, message) => {
  assert.ok(source.includes(expected), message);
};

for (const expected of [
  "-ReferenceObject @($creates | ForEach-Object { [string]$_.address } | Sort-Object)",
  "-DifferenceObject @($createsExpected | Sort-Object)",
  "-ReferenceObject @($updates | ForEach-Object { [string]$_.address } | Sort-Object)",
  "-DifferenceObject @($updatesExpected | Sort-Object)",
]) {
  requireText(
    stagingRuntimeCutoverOperator,
    expected,
    `The staging cutover operator must compare exact action addresses without positional array binding: ${expected}`,
  );
}

requireText(
  gatewayConformanceLauncher,
  '$GatewayRuntime -in @("lambda-dark", "lambda-cutover")',
  "Lambda gateway conformance must require the retained ECS service to remain idle.",
);
for (const expected of [
  '[ValidateSet("ecs", "lambda-dark", "lambda-cutover")]',
  'OUTBOX_DISPATCH_TARGET -cne "lambda_durable"',
  'AuthorizationType -cne "JWT"',
  "AuthorizerId -cne $lambdaAuthorizerId",
  'IntegrationType -eq "HTTP_PROXY"',
  'IntegrationType -eq "AWS_PROXY"',
  'RouteKey -in @("GET /health/live", "GET /health/ready")',
  'FunctionResponseTypes) -notcontains "ReportBatchItemFailures"',
  '[string]$rule.State -cne "ENABLED"',
  '"--services", "gateway", "workflow-worker"',
  '"ecs", "list-tasks"',
]) {
  requireText(
    gatewayConformanceLauncher,
    expected,
    `Deployed web conformance is missing the Lambda-cutover boundary: ${expected}`,
  );
}
requireText(
  gatewayConformanceLauncher,
  '$canonicalBackendMetadataPath = Join-Path $canonicalTerraformDirectory ".terraform\\terraform.tfstate"',
  "Gateway conformance must use the selected environment's initialized backend metadata.",
);
assert.ok(
  !gatewayConformanceLauncher.includes(
    '$stateBucket = "ai-job-apply-$Environment-terraform-state-$($caller.Account)"',
  ),
  "Gateway conformance must not reconstruct a state bucket from an obsolete naming convention.",
);
requireText(
  gatewayConformanceLauncher,
  "$env:DARK_LAMBDA_ENVIRONMENT = $Environment",
  "The guarded bridge must receive the explicitly selected environment.",
);
requireText(
  gatewayBoundaryOperator,
  '[ValidateSet("development", "staging")]',
  "The shared gateway boundary verifier must restrict environment selection.",
);
requireText(
  gatewayBoundaryOperator,
  '"ai-job-apply-$Environment-gateway"',
  "The shared gateway boundary verifier must derive the exact environment function.",
);
requireText(
  developmentGatewayBoundaryWrapper,
  "-Environment development",
  "The development gateway boundary wrapper must fix the environment.",
);
requireText(
  stagingGatewayBoundaryWrapper,
  "-Environment staging",
  "The staging gateway boundary wrapper must fix the environment.",
);
requireText(
  darkGatewayBridge,
  '!["development", "staging"].includes(target.environment)',
  "The loopback gateway bridge must reject unapproved environment names.",
);
requireText(
  darkGatewayBridge,
  "target.functionName !== `ai-job-apply-$" + "{target.environment}-gateway`",
  "The loopback gateway bridge must bind function identity to the selected environment.",
);

requireText(
  durable,
  "KMSKeyArn             = aws_kms_key.platform.arn",
  "Durable checkpoints must use the platform CMK.",
);
requireText(
  durable,
  'DeletionPolicy      = "Retain"',
  "Superseded durable versions must be retained for replay.",
);
requireText(
  durable,
  'UpdateReplacePolicy = "Retain"',
  "Replaced durable versions must be retained for replay.",
);
requireText(
  durable,
  'resource "time_sleep" "profile_readiness_durable_policy_propagation"',
  "Durable creation must include an explicit IAM propagation gate.",
);
requireText(
  durable,
  "policy_sha256 = sha256(data.aws_iam_policy_document.profile_readiness_durable[0].json)",
  "The IAM propagation gate must be replaced when the exact durable policy changes.",
);
requireText(
  durable,
  "time_sleep.profile_readiness_durable_policy_propagation",
  "The durable CloudFormation stack must depend on the IAM propagation gate.",
);
requireText(
  durable,
  '"lambda:CheckpointDurableExecution"',
  "The durable role needs checkpoint permission.",
);
requireText(
  durable,
  '"lambda:GetDurableExecutionState"',
  "The durable role needs state-read permission.",
);
requireText(
  durable,
  '"kms:GenerateDataKey"',
  "The durable role must be able to write its encrypted identifier-only DLQ.",
);
requireText(
  durable,
  "resources = [aws_lambda_function.profile_readiness_activity[0].qualified_arn]",
  "Activity invocation must target one immutable numeric version.",
);
requireText(
  durable,
  'status      = ["FAILED", "STOPPED", "TIMED_OUT"]',
  "Terminal recovery must cover every unsuccessful durable state.",
);
requireText(
  durable,
  'state       = var.serverless_runtime_cutover ? "ENABLED" : "DISABLED"',
  "Terminal recovery routing must share the explicit cutover switch.",
);
for (const expected of [
  "profile_readiness_terminal_rule_arn",
  "source_arn    = local.profile_readiness_terminal_rule_arn",
  "values   = [local.profile_readiness_terminal_rule_arn]",
]) {
  requireText(
    durable,
    expected,
    `Terminal recovery must keep its exact-rule policy stable across cutover: ${expected}`,
  );
}
requireText(
  durable,
  "kms_master_key_id         = aws_kms_key.platform.arn",
  "The terminal DLQ must use the platform CMK.",
);
requireText(
  platform,
  "enabled                            = var.serverless_runtime_cutover",
  "The SQS starter mapping must remain disabled before cutover.",
);
requireText(
  platform,
  'state               = var.serverless_runtime_cutover ? "ENABLED" : "DISABLED"',
  "The reconciler must remain disabled before cutover.",
);
requireText(
  platform,
  'resource "aws_apigatewayv2_integration" "gateway_lambda"',
  "The controlled cutover must own a direct API Gateway Lambda integration.",
);
requireText(
  platform,
  'integration_type       = "AWS_PROXY"',
  "The gateway replacement must use a direct Lambda proxy integration.",
);
requireText(
  platform,
  'payload_format_version = "2.0"',
  "The gateway replacement must receive the reviewed HTTP API v2 event shape.",
);
requireText(
  platform,
  'authorization_type = var.serverless_runtime_cutover ? "JWT" : "NONE"',
  "The default route must acquire the exact JWT authorizer during cutover.",
);
requireText(
  platform,
  "authorization_scopes = var.serverless_runtime_cutover ? [",
  "The protected default route must acquire the exact platform scopes during cutover.",
);
for (const scope of ['"profile:read"', '"profile:write"']) {
  requireText(platform, scope, `The API Gateway JWT boundary is missing ${scope}.`);
}
requireText(
  platform,
  'OUTBOX_DISPATCH_TARGET = var.serverless_runtime_cutover ? "lambda_durable" : "temporal"',
  "New-event dispatch must move with the API and trigger cutover.",
);
requireText(
  platform,
  "desired_count   = var.run_continuous_ecs_runtime ? var.gateway_desired_count : 0",
  "The retained gateway service must support the explicit zero-traffic idle posture.",
);
requireText(
  platform,
  "desired_count   = var.run_continuous_ecs_runtime ? var.worker_desired_count : 0",
  "The retained worker service must support the explicit zero-traffic idle posture.",
);
assert.equal(
  platform.split("actions_enabled     = var.run_continuous_ecs_runtime").length - 1,
  2,
  "Exactly the two legacy process-heartbeat alarms must follow the ECS idle switch.",
);
requireText(
  platform,
  'sid     = "ExactEcsExecutionRoleRuntimeSecrets"',
  "The private Secrets endpoint must retain the exact ECS runtime path.",
);
requireText(
  platform,
  'type        = "AWS"',
  "The private Secrets endpoint must use an AWS principal for ECS secret injection.",
);
requireText(
  platform,
  "identifiers = [aws_iam_role.execution.arn]",
  "The private Secrets endpoint must name only the environment execution role for ECS access.",
);
requireText(
  platform,
  "aws_secretsmanager_secret.temporal_api_key.arn",
  "The retained worker must be able to retrieve its exact Temporal secret through private DNS.",
);

assert.match(
  variables,
  /variable "serverless_runtime_cutover"\s*\{[\s\S]*?default\s*=\s*false/,
  "The atomic serverless runtime cutover must default to dark.",
);
assert.ok(
  !variables.includes('variable "gateway_outbox_dispatch_target"') &&
    !variables.includes('variable "enable_serverless_workflow_triggers"'),
  "Independent routing and trigger switches must not bypass the atomic cutover boundary.",
);
assert.match(
  variables,
  /variable "deploy_profile_readiness_durable"\s*\{[\s\S]*?default\s*=\s*false/,
  "Durable infrastructure must be opt-in.",
);
assert.ok(
  !variables.includes('variable "durable_workflow_function_arn"'),
  "An external mutable durable ARN must not remain configurable.",
);

requireText(
  bootstrap,
  '"lambda:CheckpointDurableExecution"',
  "The workload boundary must permit durable checkpoints.",
);
requireText(
  bootstrap,
  '"lambda:GetDurableExecutionState"',
  "The workload boundary must permit durable state reads.",
);
requireText(
  bootstrap,
  '"kms:GenerateDataKey"',
  "The workload boundary must permit encrypted durable DLQ writes.",
);
requireText(
  bootstrap,
  'Sid    = "ManageEnvironmentDurableStack"',
  "The deploy role must be able to manage the narrowly owned durable stack.",
);
requireText(
  bootstrap,
  'Sid    = "ManageEnvironmentWorkflowRules"',
  "The deploy role must be able to manage terminal status routing.",
);
assert.ok(
  !bootstrap.includes('"cloudformation:*"'),
  "The deploy role must not receive account-wide CloudFormation administration.",
);
assert.ok(
  !bootstrap.includes('"events:*"'),
  "The deploy role must not receive account-wide EventBridge administration.",
);

for (const environment of environments) {
  requireText(
    environment,
    "deploy_profile_readiness_durable",
    "Every persistent environment must expose the durable deployment switch.",
  );
  requireText(
    environment,
    "serverless_runtime_cutover",
    "Every persistent environment must expose the atomic cutover switch.",
  );
  requireText(
    environment,
    "run_continuous_ecs_runtime",
    "Every persistent environment must pass through the explicit ECS idle switch.",
  );
}

for (const environment of environmentVariables) {
  assert.match(
    environment,
    /variable "run_continuous_ecs_runtime"\s*\{[\s\S]*?default\s*=\s*false/,
    "Zero-traffic development and synthetic staging must default to the accepted idle posture.",
  );
}

for (const expected of [
  "AllowGatewayArtifactReleaseUpdate",
  "AllowGatewayScopeBoundaryUpdate",
  "PlanRuntimeCutover",
  "VerifyCompletedRuntimeCutover",
  "CompletedRuntimeCutoverVerification",
  '"serverless-runtime-cutover"',
  '"inspect-deployed-outbox.ps1"',
  "--require-zero-open-workflows",
  "TF_VAR_serverless_runtime_cutover",
  "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]",
  'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
  'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]',
  "module.platform.aws_apigatewayv2_route.gateway[0]",
  "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
  'OUTBOX_DISPATCH_TARGET -ne "temporal"',
  'OUTBOX_DISPATCH_TARGET -ne "lambda_durable"',
  'authorization_type -ne "JWT"',
  "LegacyOutboxEmpty",
  "TemporalOpenWorkflowsEmpty",
  "DurableOpenExecutionsEmpty",
  "GatewayArtifactReleaseUpdate",
  "GatewayScopeBoundaryUpdate",
  '"profile:read", "profile:write"',
]) {
  requireText(
    workflowPlanner,
    expected,
    `The guarded runtime cutover planner is missing required boundary text: ${expected}`,
  );
}
assert.ok(
  workflowPlanner
    .replaceAll("\r\n", "\n")
    .includes(
      "  }\n\n  if ($PlanRuntimeCutover) {\n    $gatewayFunctionChange = Get-PlannedChange",
    ),
  "The cutover semantic checks must remain outside the mutually exclusive initial-deployment branch.",
);
assert.ok(
  !workflowPlanner.includes("TF_VAR_gateway_outbox_dispatch_target") &&
    !workflowPlanner.includes("TF_VAR_enable_serverless_workflow_triggers"),
  "The planner must not restore independent dispatch and trigger cutover controls.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '"plan-serverless-workflow-dark.ps1"',
  "The staging cutover wrapper must delegate to the shared guarded planner.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  'Environment                            = "staging"',
  "The staging cutover wrapper must fix the isolated staging environment.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '$arguments["PlanRuntimeCutover"] = $true',
  "The staging cutover wrapper must expose the atomic cutover planning mode.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '$arguments["AllowGatewayArtifactReleaseUpdate"] = $true',
  "The staging runtime wrapper must expose the post-cutover gateway release mode.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '$arguments["AllowGatewayScopeBoundaryUpdate"] = $true',
  "The staging runtime wrapper must expose the exact JWT route-scope correction mode.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '$arguments["VerifyCompletedRuntimeCutover"] = $true',
  "The staging cutover wrapper must expose the completed-cutover verification mode.",
);
requireText(
  stagingRuntimeCutoverWrapper,
  '"ai-job-apply-staging-admin"',
  "The staging cutover wrapper must default to the isolated staging IAM profile.",
);

for (const expected of [
  '[ValidateSet("Status", "Apply")]',
  '"$expectedPlanPrefix-$($sourceCommit.Substring(0, 8))"',
  '"gateway-runtime-release"',
  '"gateway-scope-boundary"',
  "Assert-GatewayScopeBoundaryPlan",
  '@("authorization_scopes")',
  '@("profile:read", "profile:write")',
  '"module.platform.aws_lambda_alias.gateway[0]"',
  '"module.platform.aws_lambda_function.gateway[0]"',
  'OUTBOX_DISPATCH_TARGET -ne "lambda_durable"',
  '"serverless_runtime_cutover"',
  '"run_continuous_ecs_runtime"',
  'if ([string]$value -ceq "false") { return $false }',
  "ExpectedPlanSha256",
  "$updates | ForEach-Object { [string]$_.address }",
  "Compare-Object -ReferenceObject $updateAddresses -DifferenceObject $expectedAddresses",
  "-DifferenceObject $afterVariableNames",
  "Invoke-SavedPlan $resolvedPlanPath",
  "CompletedRuntimeCutoverVerification",
  "PublicConformanceRequired = $true",
]) {
  requireText(
    stagingGatewayReleaseOperator,
    expected,
    `The guarded staging gateway release operator is missing required boundary text: ${expected}`,
  );
}

for (const expected of [
  '[ValidateSet("Plan", "Execute", "Cleanup")]',
  '"applydash.staging.legacy-temporal-drain.v1"',
  '"staging-legacy-temporal-drain"',
  '"inspect-deployed-outbox.ps1"',
  "--require-zero-open-workflows",
  "ExpectedPendingCount = $expectedPendingCount",
  "ExpectedOrderedEventIdSha256",
  "Assert-SameBoundary $context.Boundary $runtime.Boundary",
  '"ecs", "run-task"',
  '"ecs", "stop-task"',
  "Wait-DrainComplete",
  "Assert-WorkerLogsClean",
  "Assert-NoClusterTask",
  "Assert-OnlyReviewedTask $taskArn",
  "PublicTrafficChange = $false",
  "TriggerChange = $false",
  "EcsServiceCapacityChange = $false",
  "EventTargetRewrite = $false",
]) {
  requireText(
    stagingLegacyTemporalDrain,
    expected,
    `The guarded staging legacy-drain operator is missing required boundary text: ${expected}`,
  );
}
assert.ok(
  !stagingLegacyTemporalDrain.includes("-IncludeEventIds"),
  "The staging legacy-drain operator must retain only the aggregate outbox digest.",
);
requireText(
  stagingLegacyTemporalDrain,
  '$null -ne $inspection.PSObject.Properties["eventIds"]',
  "The staging legacy-drain operator must reject an inspection that emits raw event IDs.",
);
assert.ok(
  !/\b[0-9]{12}\b/.test(stagingLegacyTemporalDrain),
  "The staging legacy-drain operator must not embed an AWS account ID.",
);

for (const expected of [
  '"PlanRollback", "ApplyRollback", "VerifyRollback"',
  '"PlanRestore", "ApplyRestore", "Cleanup"',
  '"workflow-dark-plans"',
  "ExpectedPlanSha256",
  "Assert-CutoverPlan",
  "The saved plan is outside the exact three-create, six-update staging cutover boundary.",
  "Assert-ZeroLegacyWork",
  '"inspect-deployed-outbox.ps1"',
  "--require-zero-open-workflows",
  'terraform "-chdir=$environmentDirectory" apply -input=false $Path',
  '$arguments["VerifyCompletedRuntimeCutover"] = $true',
  "Invoke-CompletedVerification",
  "PublicConformanceRequired = $true",
  "Assert-RollbackPlan",
  "Assert-ZeroServerlessWork",
  '"--statuses", "RUNNING"',
  "New-TransitionPlan",
  "Assert-ReviewedTransitionPlan",
  'Schema = "applydash.staging.serverless-runtime-cutover.v1"',
  "PublicApiAvailableAfterApply = $false",
  "ConfirmRollbackConformance",
  "ConfirmRestoreConformance",
]) {
  requireText(
    stagingRuntimeCutoverOperator,
    expected,
    `The staging runtime-cutover operator is missing required boundary text: ${expected}`,
  );
}
assert.ok(
  !/\b[0-9]{12}\b/.test(stagingRuntimeCutoverOperator),
  "The staging runtime-cutover operator must not embed an AWS account ID.",
);

for (const expected of [
  "Assert-ZeroPendingWork",
  "--require-zero-open-workflows",
  "module.platform.aws_ecs_service.gateway[0]",
  "module.platform.aws_ecs_service.worker[0]",
  "module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
  "module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]",
  "Assert-PublicTaskAddressesReleased",
  "Assert-TargetedNoDrift",
]) {
  requireText(
    ecsIdleOperator,
    expected,
    `The guarded ECS idle operator is missing required boundary text: ${expected}`,
  );
}

for (const expected of [
  '[ValidateSet("development", "staging")]',
  '"ai-job-apply-$Environment"',
  '"infrastructure\\terraform\\environments\\$Environment"',
  '"applydash.$Environment.workflow-dark-conformance.v2"',
  '"ai-job-apply-$Environment-admin"',
  "Get-ReviewableSourceCommit",
  'rev-parse "@{upstream}"',
  "Environment = $Environment",
  "TriggersEnabled = $false",
  "PublicTrafficChange = $false",
  "Get-ReviewedDurableExecution",
  '"--durable-execution-name"',
]) {
  requireText(
    workflowConformanceOperator,
    expected,
    `The shared workflow conformance operator is missing required boundary text: ${expected}`,
  );
}
assert.ok(
  !workflowConformanceOperator.includes("ai-job-apply-development-"),
  "The shared workflow conformance operator must not retain development-only resource names.",
);
assert.doesNotMatch(
  workflowConformanceOperator,
  /"list-durable-executions-by-function"[\s\S]{0,300}"--qualifier"/,
  "A durable execution name cannot be filtered together with a function qualifier; validate the fetched version instead.",
);

for (const [wrapper, environment] of [
  [developmentWorkflowConformanceWrapper, "development"],
  [stagingWorkflowConformanceWrapper, "staging"],
]) {
  requireText(
    wrapper,
    '"operate-serverless-workflow-dark-conformance.ps1"',
    `The ${environment} wrapper must delegate to the shared conformance operator.`,
  );
  requireText(
    wrapper,
    `Environment        = "${environment}"`,
    `The ${environment} wrapper must fix its exact environment.`,
  );
  requireText(
    wrapper,
    `"ai-job-apply-${environment}-admin"`,
    `The ${environment} wrapper must default to its isolated IAM profile.`,
  );
}

for (const expected of [
  '[ValidateSet("development", "staging")]',
  '"infrastructure\\terraform\\environments\\$Environment"',
  '"applydash.$Environment.workflow-release-rollback.v1"',
  '"ai-job-apply-$Environment-admin"',
  '"plan-serverless-workflow-dark.ps1"',
  '"current-release-source.tfplan"',
  '"rollback-release-source.tfplan"',
  "Copy-RetainedPlanSnapshot",
  "$cleanupPaths = @(",
  "foreach ($path in $cleanupPaths)",
  'rev-parse "@{upstream}"',
  "Environment = $Environment",
  "PublicTrafficChange = $false",
  "TriggerChange = $false",
  "EcsCapacityChange = $false",
]) {
  requireText(
    workflowReleaseRollbackOperator,
    expected,
    `The shared workflow rollback operator is missing required boundary text: ${expected}`,
  );
}
assert.ok(
  !workflowReleaseRollbackOperator.includes("ai-job-apply-development-"),
  "The shared workflow rollback operator must not retain development-only resource names.",
);
const rollbackSnapshotIndex = workflowReleaseRollbackOperator.indexOf(
  "$currentPath = Copy-RetainedPlanSnapshot",
);
const rollbackPlanIndex = workflowReleaseRollbackOperator.indexOf(
  "$summary = Invoke-ReleasePlanner -Context $context -Release $rollback -Mode Release",
);
assert.ok(
  rollbackSnapshotIndex >= 0 && rollbackSnapshotIndex < rollbackPlanIndex,
  "Both retained endpoint plans must be snapshotted before the strict planner can reuse an input filename.",
);

for (const [wrapper, environment] of [
  [developmentWorkflowReleaseRollbackWrapper, "development"],
  [stagingWorkflowReleaseRollbackWrapper, "staging"],
]) {
  requireText(
    wrapper,
    '"operate-serverless-workflow-release-rollback.ps1"',
    `The ${environment} rollback wrapper must delegate to the shared operator.`,
  );
  requireText(
    wrapper,
    `Environment                = "${environment}"`,
    `The ${environment} rollback wrapper must fix its exact environment.`,
  );
  requireText(
    wrapper,
    `"ai-job-apply-${environment}-admin"`,
    `The ${environment} rollback wrapper must default to its isolated IAM profile.`,
  );
}

requireText(
  publicationWorkflow,
  ["ARTIFACT_SOURCE_SHA: $", "{{ github.sha }}"].join(""),
  "Protected workflow publication must bind artifacts to the exact workflow source commit.",
);
requireText(
  publicationWorkflow,
  'test "$(jq -r .schemaVersion "$artifact_dir/$name.manifest.json")" = "2"',
  "Protected workflow publication must require the source-attested manifest schema.",
);
requireText(
  publicationWorkflow,
  'test "$(jq -r .sourceSha "$artifact_dir/$name.manifest.json")" = "$GITHUB_SHA"',
  "Protected workflow publication must verify manifest source provenance.",
);
requireText(
  publicationWorkflow,
  'grep -Fq "/* applydash-artifact-source:$GITHUB_SHA */" "/tmp/$name.index.mjs"',
  "Protected workflow publication must verify bundle source provenance.",
);

const durableStackStart = durable.indexOf(
  'resource "aws_cloudformation_stack" "profile_readiness_durable"',
);
const terminalFunctionStart = durable.indexOf(
  'resource "aws_lambda_function" "profile_readiness_terminal"',
);
assert.ok(
  durableStackStart >= 0 && terminalFunctionStart > durableStackStart,
  "The durable stack boundary could not be inspected.",
);
const durableStack = durable.slice(durableStackStart, terminalFunctionStart);
assert.ok(
  !durableStack.includes("VpcConfig"),
  "The durable orchestrator must stay outside the VPC; only activities may access the database.",
);

process.stdout.write("Serverless workflow infrastructure policy validation passed.\n");
