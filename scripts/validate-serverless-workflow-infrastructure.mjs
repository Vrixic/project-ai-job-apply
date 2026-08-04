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

const requireText = (source, expected, message) => {
  assert.ok(source.includes(expected), message);
};

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
  'state       = var.enable_serverless_workflow_triggers ? "ENABLED" : "DISABLED"',
  "Terminal recovery routing must share the explicit cutover switch.",
);
requireText(
  durable,
  "kms_master_key_id         = aws_kms_key.platform.arn",
  "The terminal DLQ must use the platform CMK.",
);
requireText(
  platform,
  "enabled                            = var.enable_serverless_workflow_triggers",
  "The SQS starter mapping must remain disabled before cutover.",
);
requireText(
  platform,
  'state               = var.enable_serverless_workflow_triggers ? "ENABLED" : "DISABLED"',
  "The reconciler must remain disabled before cutover.",
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
  /variable "enable_serverless_workflow_triggers"\s*\{[\s\S]*?default\s*=\s*false/,
  "Workflow triggers must default to dark.",
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
    "enable_serverless_workflow_triggers",
    "Every persistent environment must expose the independent cutover switch.",
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
