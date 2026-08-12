import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function read(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath}: required file is missing`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireText(relativePath, text, reason) {
  const source = read(relativePath);
  if (!source.includes(text)) failures.push(`${relativePath}: ${reason}`);
}

function requirePattern(relativePath, pattern, reason) {
  const source = read(relativePath);
  if (!pattern.test(source)) failures.push(`${relativePath}: ${reason}`);
}

function forbidText(relativePath, text, reason) {
  const source = read(relativePath);
  if (source.includes(text)) failures.push(`${relativePath}: ${reason}`);
}

function section(relativePath, start, end) {
  const source = read(relativePath);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    failures.push(`${relativePath}: required section boundary is missing`);
    return "";
  }
  return source.slice(startIndex, endIndex);
}

const platform = "infrastructure/terraform/modules/platform/main.tf";
const variables = "infrastructure/terraform/modules/platform/variables.tf";
const outputs = "infrastructure/terraform/modules/platform/outputs.tf";
const durable = "infrastructure/terraform/modules/platform/durable-workflow.tf";
const bootstrap = "infrastructure/terraform/bootstrap/main.tf";
const workflowPublisher = ".github/workflows/publish-workflow-lambdas.yml";
const staticAnalysisWorkflow = ".github/workflows/static-analysis.yml";
const stagingLifecycleOperator = "scripts/operate-staging-runtime-lifecycle.ps1";
const developmentMigrationOperator = "scripts/operate-development-document-migration.ps1";
const candidateDocuments = "infrastructure/terraform/modules/platform/candidate-documents.tf";

for (const required of [
  'ValidateSet("Status", "PlanTask", "ApplyTask", "PlanExecution", "Execute", "Recover", "Verify")',
  "Assert-ReleaseSourceBinding",
  "Assert-OperatorOnlyReleaseDelta",
  "Assert-RecoveryOperatorBinding",
  'if ($Action -eq "Recover")',
  "operatorSourceSha",
  "--if-none-match '*'",
  '"s3api", "list-object-versions"',
  "operator-claims/development-document-migration/",
  "Save-AndClearTerraformVariables",
  "Restore-TerraformVariables",
  "ConvertTo-Json -InputObject $Value -Compress -Depth 30",
  "Set-VerifiedCurrentGatewayArtifactVariables",
  "Test-IgnorableRdsRestorableTimeRefresh",
  "Test-IgnorableMigrationTaskTagsRefresh",
  "Get-UnacceptedVerificationDrift",
  "Test-EcsFaultInjectionDisabled",
  '"--version-id", ([string]$gateway.s3_object_version)',
  'foreach ($propertyName in @("mountPoints", "portMappings", "systemControls", "volumesFrom"))',
  '$property.Name -in @("ipc_mode", "pid_mode", "task_role_arn")',
  "document_scan_mapping_enabled                 = $false",
  "document_scan_event_rule_enabled              = $false",
  "The saved source plan must be an already accepted zero-change input baseline.",
  "The task plan may change only the one-off migration task definition.",
  '"ecs", "run-task", "--cli-input-json"',
  "aws ecs wait tasks-stopped",
  "The exact four aggregate success events did not become visible within the bounded CloudWatch polling window.",
  "Database migrations through 0005_resume_fact_proposals applied and verified.",
  "Documents migrations through 0002_resume_processing applied and verified.",
  "Assert-DatabaseSafety",
  "Assert-RequestNetwork",
]) {
  requireText(
    developmentMigrationOperator,
    required,
    `development migration operator guard is missing: ${required}`,
  );
}
for (const forbidden of [
  "[IO.Path]::GetFullPath($Candidate, $terraformDirectory)",
  "Wait-TaskRunning",
  "Assert-RunningTaskNetwork",
  "Test-KnownSubset",
]) {
  forbidText(
    developmentMigrationOperator,
    forbidden,
    `development migration operator retains unsafe/racy behavior: ${forbidden}`,
  );
}

for (const required of [
  "Quiescence must change database deletion protection from enabled to disabled.",
  "Quiescence must disable every exact managed mapping and EventBridge rule.",
  "Quiescence must update database protection plus the exact enabled traffic/processing actions or no already-dark action.",
  "Dormant mode must delete the exact disposable data plane and update one dashboard.",
  "Dark activation must create the exact disposable data plane and update one dashboard.",
  "Dark activation must create one encrypted private protected database with seven-day backups.",
  "Dark activation must create the exact private-DNS interface endpoints for the deployed runtime.",
  "Document processing activation must create exactly one S3 gateway endpoint.",
  "Traffic can be enabled only from the exact dark active boundary.",
  "Traffic can be disabled only from the exact enabled active boundary.",
  "The traffic plan must contain three route actions and the exact base workflow trigger updates without replacement.",
  "Traffic enablement must create three routes and enable the exact three base workflow triggers.",
  "Traffic enablement must preserve exact JWT scopes and anonymous health routes only.",
  "Traffic disablement must delete three routes and disable the exact three base workflow triggers.",
]) {
  requireText(
    stagingLifecycleOperator,
    required,
    `staging lifecycle fail-closed boundary is missing: ${required}`,
  );
}

for (const required of [
  'resource "aws_lambda_function" "document_parser"',
  'resource "aws_lambda_function" "document_processor"',
  'resource "aws_lambda_event_source_mapping" "document_scan_results"',
  'resource "aws_cloudwatch_event_rule" "document_scan_results"',
  'resource "aws_cloudwatch_event_rule" "document_processing_reconciler"',
  'resource "aws_cloudwatch_log_metric_filter" "document_processing_timed_out"',
  'resource "aws_cloudwatch_metric_alarm" "document_scan_delivery_dead_letter"',
  'resource "aws_cloudwatch_metric_alarm" "document_processing_timed_out"',
  'resource "aws_iam_role" "document_parser_object_access"',
  "GUARDDUTY_PROTECTION_PLAN_ARN   = aws_guardduty_malware_protection_plan.candidate_documents[0].arn",
  "DOCUMENT_OBJECT_ACCESS_ROLE_ARN = aws_iam_role.document_parser_object_access[0].arn",
  'state       = var.document_scan_event_rule_enabled ? "ENABLED" : "DISABLED"',
  "enabled                 = var.document_scan_mapping_enabled",
  "dead_letter_config { arn = aws_sqs_queue.document_scan_delivery_dead_letter[0].arn }",
]) {
  requireText(
    candidateDocuments,
    required,
    `document processing fail-closed boundary is missing: ${required}`,
  );
}
requireText(platform, 'resource "aws_vpc_endpoint" "sts"', "private STS endpoint is missing");

const parserExecutionPolicy = section(
  candidateDocuments,
  'data "aws_iam_policy_document" "document_parser"',
  'data "aws_iam_policy_document" "document_parser_object_access"',
);
for (const forbidden of [
  "WriteOwnedLogs",
  "ReadCleanQuarantineAndWriteNormalizedOnly",
  "WriteAndVerifyNormalizedOnly",
  "WriteNativeTraces",
]) {
  if (parserExecutionPolicy.includes(forbidden)) {
    failures.push(`${candidateDocuments}: untrusted parser execution role retains ${forbidden}`);
  }
}

const documentScanQueuePolicy = section(
  candidateDocuments,
  'data "aws_iam_policy_document" "document_scan_queue"',
  'resource "aws_sqs_queue_policy" "document_scan_results"',
);
if (
  !documentScanQueuePolicy.includes(
    "values   = [aws_cloudwatch_event_rule.document_scan_results[0].arn]",
  ) ||
  documentScanQueuePolicy.includes("document_scan_tag_failure") ||
  documentScanQueuePolicy.includes("document_scan_plan_unhealthy") ||
  documentScanQueuePolicy.includes("document_reconciler_rule_arn")
) {
  failures.push(
    `${candidateDocuments}: the processing queue must accept only the exact scan-result rule`,
  );
}

const documentDeliveryDlqPolicy = section(
  candidateDocuments,
  'data "aws_iam_policy_document" "document_scan_delivery_dead_letter"',
  'resource "aws_sqs_queue_policy" "document_scan_delivery_dead_letter"',
);
for (const required of [
  "aws_cloudwatch_event_rule.document_scan_results[0].arn",
  "aws_cloudwatch_event_rule.document_scan_tag_failure[0].arn",
  "aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0].arn",
  "local.document_reconciler_rule_arn",
]) {
  if (!documentDeliveryDlqPolicy.includes(required)) {
    failures.push(`${candidateDocuments}: the delivery DLQ policy is missing ${required}`);
  }
}

for (const required of [
  'resource "aws_ecr_repository" "migration"',
  'name                 = "$' + '{var.name}/migration"',
  'image_tag_mutability = "IMMUTABLE"',
  "scan_on_push = true",
  'resource "aws_ecs_task_definition" "migration"',
  "enable_fault_injection   = false",
  "aws_ecr_repository.migration.repository_url",
  'command                = ["runner/dist/src/main.js"]',
  'OUTBOX_DISPATCH_TARGET = "lambda_durable"',
  "count              = var.serverless_runtime_enabled ? 1 : 0",
  'authorization_type = "JWT"',
  "ingress = []",
  "enabled                            = var.serverless_runtime_enabled",
  'state               = var.serverless_runtime_enabled ? "ENABLED" : "DISABLED"',
]) {
  requireText(platform, required, `missing steady-state boundary: ${required}`);
}

for (const retired of [
  'resource "aws_ecs_service" "gateway"',
  'resource "aws_ecs_service" "worker"',
  'resource "aws_ecs_task_definition" "gateway"',
  'resource "aws_ecs_task_definition" "worker"',
  'resource "aws_service_discovery_private_dns_namespace" "application"',
  'resource "aws_apigatewayv2_vpc_link" "gateway"',
  'resource "aws_secretsmanager_secret" "temporal_api_key"',
  'resource "aws_ecr_repository" "gateway"',
  'resource "aws_ecr_repository" "worker"',
  "OUTBOX_DISPATCH_TARGET = var.",
  '"temporal"',
  'command                = ["backend/services/profile/dist/src/migrate.js"]',
]) {
  forbidText(platform, retired, `retired runtime source remains: ${retired}`);
}

requireText(
  variables,
  'variable "serverless_runtime_enabled"',
  "serverless runtime enable/disable boundary is missing",
);
for (const retired of [
  'variable "serverless_runtime_cutover"',
  'variable "retain_gateway_lambda_integration_during_rollback"',
  'variable "run_continuous_ecs_runtime"',
  'variable "retain_legacy_ecs_rollback"',
  'variable "gateway_image"',
  'variable "worker_image"',
  'variable "temporal_address"',
  'variable "temporal_namespace"',
]) {
  forbidText(variables, retired, `retired input remains: ${retired}`);
}

requireText(
  durable,
  'state       = var.serverless_runtime_enabled ? "ENABLED" : "DISABLED"',
  "durable terminal recovery is not coupled to the runtime boundary",
);
for (const required of [
  'DeletionPolicy      = "Retain"',
  'UpdateReplacePolicy = "Retain"',
  'resource "time_sleep" "profile_readiness_durable_policy_propagation"',
  "policy_sha256 = sha256(data.aws_iam_policy_document.profile_readiness_durable[0].json)",
  '"lambda:CheckpointDurableExecution"',
  '"lambda:GetDurableExecutionState"',
  "resources = [aws_lambda_function.profile_readiness_activity[0].qualified_arn]",
  'status      = ["FAILED", "STOPPED", "TIMED_OUT"]',
  "source_arn    = local.profile_readiness_terminal_rule_arn",
  "kms_master_key_id         = aws_kms_key.platform.arn",
]) {
  requireText(durable, required, `durable security/replay boundary is missing: ${required}`);
}
const durableStack = section(
  durable,
  'resource "aws_cloudformation_stack" "profile_readiness_durable"',
  'resource "aws_lambda_function" "profile_readiness_terminal"',
);
if (durableStack.includes("VpcConfig")) {
  failures.push(
    `${durable}: the durable orchestrator must remain outside the VPC; only database activities belong inside`,
  );
}

for (const required of [
  '"lambda:CheckpointDurableExecution"',
  '"lambda:GetDurableExecutionState"',
  '"kms:GenerateDataKey"',
  '"sts:AssumeRole"',
]) {
  requireText(bootstrap, required, `workload boundary permission is missing: ${required}`);
}
for (const required of [
  'test "$(jq -r .schemaVersion "$artifact_dir/$name.manifest.json")" = "2"',
  'test "$(jq -r .sourceSha "$artifact_dir/$name.manifest.json")" = "$GITHUB_SHA"',
  'grep -Fq "/* applydash-artifact-source:$GITHUB_SHA */" "/tmp/$name.index.mjs"',
]) {
  requireText(
    workflowPublisher,
    required,
    `workflow artifact provenance gate is missing: ${required}`,
  );
}

const starterPolicy = section(
  platform,
  'data "aws_iam_policy_document" "outbox_starter"',
  'data "aws_iam_policy_document" "outbox_reconciler"',
);
if (!starterPolicy.includes('actions   = ["kms:Decrypt"]')) {
  failures.push(`${platform}: the SQS starter must retain decrypt-only KMS access`);
}
if (starterPolicy.includes('"kms:GenerateDataKey"')) {
  failures.push(`${platform}: the SQS starter must not gain KMS data-key generation`);
}
for (const policy of ["gateway_lambda", "outbox_reconciler"]) {
  const policySource = section(
    platform,
    `data "aws_iam_policy_document" "${policy}"`,
    `resource "aws_iam_role_policy" "${policy}"`,
  );
  for (const required of ['"kms:Decrypt"', '"kms:GenerateDataKey"', "aws_kms_key.platform.arn"]) {
    if (!policySource.includes(required)) {
      failures.push(
        `${platform}: ${policy} is missing encrypted outbox producer permission ${required}`,
      );
    }
  }
}
requireText(
  outputs,
  'output "migration_repository_url"',
  "dedicated migration repository output is missing",
);
for (const retired of [
  'output "gateway_repository_url"',
  'output "worker_repository_url"',
  'output "temporal_api_key_secret_arn"',
]) {
  forbidText(outputs, retired, `retired output remains: ${retired}`);
}

for (const environment of ["development", "staging"]) {
  const main = `infrastructure/terraform/environments/${environment}/main.tf`;
  const environmentVariables = `infrastructure/terraform/environments/${environment}/variables.tf`;
  const environmentOutputs = `infrastructure/terraform/environments/${environment}/outputs.tf`;
  requirePattern(
    main,
    /serverless_runtime_enabled\s*=\s*var\.serverless_runtime_enabled/,
    "environment does not wire the steady-state runtime boundary",
  );
  requireText(
    environmentVariables,
    'variable "serverless_runtime_enabled"',
    "environment runtime variable is missing",
  );
  requireText(
    environmentOutputs,
    'output "migration_repository_url"',
    "environment migration repository output is missing",
  );
  for (const retired of ["temporal_", "gateway_image", "worker_image", "retain_legacy_ecs"]) {
    forbidText(main, retired, `retired environment wiring remains: ${retired}`);
    forbidText(environmentVariables, retired, `retired environment input remains: ${retired}`);
    forbidText(environmentOutputs, retired, `retired environment output remains: ${retired}`);
  }
}

const compose = read("compose.yaml");
for (const service of ["postgres:", "redis:", "otel-collector:"]) {
  if (!compose.includes(service))
    failures.push(`compose.yaml: missing local dependency ${service}`);
}
if (compose.includes("temporal")) failures.push("compose.yaml: retired Temporal service remains");

requireText(
  "backend/workflows/src/local-runtime.ts",
  "LocalDurableTestRunner",
  "local durable execution adapter is missing",
);
requireText(
  "backend/workflows/src/local-runtime.ts",
  "ServerlessOutboxReconciler",
  "local outbox recovery loop is missing",
);
requireText(
  "backend/services/profile/migrations/0003_retire_legacy_dispatch.sql",
  "cannot retire legacy workflow dispatch with unpublished rows",
  "legacy outbox migration is not fail closed",
);
requireText(
  "backend/services/profile/migrations/0003_retire_legacy_dispatch.sql",
  "retired_legacy",
  "published legacy rows are not preserved under a provider-neutral label",
);

const publishWorkflow = ".github/workflows/publish-environment-images.yml";
for (const required of [
  "Dockerfile.migration",
  "ai-job-apply/migration",
  "IMMUTABLE",
  "scanOnPush",
]) {
  requireText(publishWorkflow, required, `migration publishing guard is missing: ${required}`);
}

const dockerIgnore = ".dockerignore";
for (const required of ["**/node_modules/", "**/dist/", "**/.env", "**/.env.*"]) {
  requireText(dockerIgnore, required, `container context exclusion is missing: ${required}`);
}
for (const retired of ["Dockerfile.gateway", "Dockerfile.worker", "ai-job-apply/worker"]) {
  forbidText(publishWorkflow, retired, `retired container publisher remains: ${retired}`);
}

for (const required of [
  "Dockerfile.migration",
  "infrastructure/terraform/modules/platform/tests/serverless_runtime.tftest.hcl",
]) {
  if (!existsSync(resolve(root, required))) failures.push(`${required}: required file is missing`);
}
for (const required of [
  "deploy --prod --legacy /migration/runner",
  "deploy --prod --legacy /migration/profile",
  "deploy --prod --legacy /migration/jobs",
  "USER 65532:65532",
  'CMD ["runner/dist/src/main.js"]',
]) {
  requireText(
    "Dockerfile.migration",
    required,
    `migration image hardening is missing: ${required}`,
  );
}

const retiredExecutablePaths = [
  "backend/gateway/src/dark-conformance-bridge.ts",
  "backend/gateway/src/dark-conformance-bridge.test.ts",
  "backend/workflows/temporal-retirement-inspect.mjs",
  "backend/workflows/temporal-retirement-rejection.mjs",
  "backend/workflows/temporal-retirement-rejection.test.mjs",
  "scripts/operate-phase0-provider-retirement.ps1",
  "scripts/operate-phase0-legacy-runtime-retirement.ps1",
  "scripts/operate-phase0-ecs-idle-shutdown.ps1",
  "scripts/operate-staging-legacy-temporal-drain.ps1",
  "scripts/operate-staging-serverless-runtime-cutover.ps1",
  "scripts/plan-gateway-lambda-dark.ps1",
  "scripts/plan-serverless-workflow-dark.ps1",
  "scripts/exercise-development-log-delivery.ps1",
  "infrastructure/runbooks/temporal-cloud-runtime-secret.md",
  "infrastructure/runbooks/deployments/phase0-provider-retirement.md",
  "infrastructure/runbooks/deployments/phase0-legacy-runtime-retirement.md",
  "infrastructure/runbooks/deployments/staging-serverless-runtime-cutover.md",
];
for (const retired of retiredExecutablePaths) {
  if (existsSync(resolve(root, retired))) failures.push(`${retired}: retired path remains`);
}
for (const [relativePath, retiredText] of [
  ["backend/workflows/package.json", "@temporalio/"],
  ["backend/workflows/package.json", "temporal:retirement-inspect"],
  ["backend/gateway/package.json", "conformance:lambda-dark"],
  ["scripts/start-deployed-web-conformance.ps1", "GatewayRuntime"],
  ["scripts/start-deployed-web-conformance.ps1", "lambda-dark"],
  ["scripts/start-deployed-web-conformance.ps1", "DARK_LAMBDA"],
]) {
  forbidText(relativePath, retiredText, `retired executable reference remains: ${retiredText}`);
}
for (const required of [
  'OUTBOX_DISPATCH_TARGET -cne "lambda_durable"',
  "JwtConfiguration.Issuer -cne $expectedIssuer",
  "A retired continuous ECS application path is still active.",
  "The deployed API did not pass the expected 200/200/401 boundary.",
]) {
  requireText(
    "scripts/start-deployed-web-conformance.ps1",
    required,
    `steady-state deployed conformance guard is missing: ${required}`,
  );
}
for (const retired of ["Dockerfile.gateway", "Dockerfile.worker"]) {
  if (existsSync(resolve(root, retired)))
    failures.push(`${retired}: retired image definition remains`);
  forbidText(staticAnalysisWorkflow, retired, `static analysis still references ${retired}`);
}
requireText(
  staticAnalysisWorkflow,
  "Dockerfile.migration",
  "static analysis does not scan the migration image",
);

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Serverless infrastructure validation passed: only Lambda request/workflow runtime and the one-off migration task remain.\n",
  );
}
