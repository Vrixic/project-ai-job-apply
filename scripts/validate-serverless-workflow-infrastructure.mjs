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
const developmentGatewayReleaseOperator = "scripts/operate-development-gateway-release.ps1";
const candidateDocuments = "infrastructure/terraform/modules/platform/candidate-documents.tf";
const ingestionWorkflow = "infrastructure/terraform/modules/platform/ingestion-workflow.tf";
const ingestionBuilder = "scripts/build-ingestion-lambdas.mjs";
const communityRuntime = "infrastructure/terraform/modules/platform/community-runtime.tf";

const trustSignalMapping = section(
  communityRuntime,
  'resource "aws_lambda_event_source_mapping" "d2_trust_signal"',
  'resource "aws_apigatewayv2_route" "d2_community_protected"',
);
if (
  !/scaling_config\s*\{\s*maximum_concurrency\s*=\s*var\.d2_community_runtime\.signal_reserved_concurrency\s*\}/u.test(
    trustSignalMapping,
  ) ||
  trustSignalMapping.includes("provisioned_poller_config")
) {
  failures.push("D2 Trust SQS must cap standard polling at the exact reserved Lambda concurrency.");
}
requirePattern(
  communityRuntime,
  /reserved_concurrent_executions\s*=\s*var\.d2_community_runtime\.signal_reserved_concurrency/u,
  "D2 Trust Lambda reservation must share the SQS maximum-concurrency input.",
);
requirePattern(
  variables,
  /condition\s*=\s*!var\.d2_community_runtime\.enabled\s*\|\|\s*\(\s*var\.d2_community_runtime\.signal_reserved_concurrency\s*>=\s*2\s*&&\s*var\.d2_community_runtime\.signal_reserved_concurrency\s*<=\s*5\s*&&\s*floor\(var\.d2_community_runtime\.signal_reserved_concurrency\)\s*==\s*var\.d2_community_runtime\.signal_reserved_concurrency\s*\)/u,
  "Active D2 standard SQS must reject non-integer concurrency or values outside 2 through 5.",
);
forbidText(
  communityRuntime,
  "aws_lambda_provisioned_concurrency_config",
  "D2 concurrency must remain a ceiling, not provisioned compute.",
);

for (const required of [
  'variable "deploy_ingestion_runtime"',
  'variable "ingestion_runtime_enabled"',
  'variable "ingestion_synthetic_source_enabled"',
  'variable "ingestion_provider_activation_allowed"',
  'variable "ingestion_provider_sources"',
  "var.deploy_ingestion_runtime && var.runtime_activation_allowed",
  'toset(["coordinator", "starter", "activity", "terminal"])',
  "default     = false",
  "message_retention_seconds  = 345600",
  "message_retention_seconds = 1209600",
  'state               = var.ingestion_runtime_enabled ? "ENABLED" : "DISABLED"',
  "enabled                 = var.ingestion_runtime_enabled",
  "INGESTION_SYNTHETIC_SOURCE_ENABLED",
  "INGESTION_PROVIDER_ACTIVATION_ALLOWED",
  "INGESTION_PROVIDER_SOURCES",
  "INGESTION_QUEUE_ARN",
  "var.ingestion_provider_private_egress",
  "provider_network_deployed     = var.deploy_ingestion_runtime || var.d2_community_runtime.deploy",
  "provider_private_egress       = var.ingestion_provider_private_egress || var.d2_community_runtime.provider_private_egress",
  "count                   = local.provider_network_deployed ? length(local.azs) : 0",
  "for_each = local.provider_private_egress ? [1] : []",
  "var.ingestion_provider_activation_allowed || alltrue",
  'contains(["greenhouse", "lever", "ashby"], source.provider)',
  'function_response_types = ["ReportBatchItemFailures"]',
  "role                           = aws_iam_role.ingestion_runtime[each.key].arn",
  'role                           = aws_iam_role.ingestion_runtime["activity"].arn',
  'for_each = each.key == "coordinator" ? [1] : []',
  'for_each = each.key == "starter" ? [1] : []',
  'for_each = contains(["coordinator", "terminal"], each.key) ? [1] : []',
  "target_arn = aws_sqs_queue.ingestion_dead_letter[0].arn",
  'actions   = ["lambda:GetDurableExecution"]',
  'resources = ["$' + '{local.ingestion_durable_arn}:*/durable-execution/*"]',
  "KMSKeyArn",
  "RetentionPeriodInDays = var.ingestion_retention_days",
  'resources = ["$' + '{local.ingestion_durable_arn}:*"]',
  'resources = ["$' + '{aws_lambda_function.ingestion_activity[0].arn}:*"]',
  "maximum_event_age_in_seconds = 3600",
  'Description  = "Immutable ${var.ingestion_durable_artifact_sha256}; activity ${aws_lambda_function.ingestion_activity[0].qualified_arn}"',
  'resource "aws_cloudwatch_metric_alarm" "ingestion_runtime_throttles"',
  'resource "aws_cloudwatch_metric_alarm" "ingestion_activity_throttles"',
  'resource "aws_cloudwatch_metric_alarm" "ingestion_durable_throttles"',
  'resource "aws_cloudwatch_metric_alarm" "ingestion_durable_timed_out"',
  'metric_name         = "DurableExecutionTimedOut"',
  'resource "aws_cloudwatch_metric_alarm" "ingestion_durable_duration"',
  'metric_name         = "DurableExecutionDuration"',
  "threshold           = var.ingestion_execution_timeout_seconds * 900",
]) {
  requireText(
    ingestionWorkflow,
    required,
    `ingestion default-off boundary is missing: ${required}`,
  );
}
requirePattern(
  ingestionWorkflow,
  /functionArn\s*=\s*\[\{ prefix = "\$\{local\.ingestion_durable_arn\}:" \}\]/u,
  "terminal reconciliation must subscribe only to exact ingestion function versions",
);
for (const [pattern, reason] of [
  [
    /sid\s*=\s*"ExactIngestionCoordinatorQueueWrites"[\s\S]{0,500}actions\s*=\s*\["sqs:SendMessage"\][\s\S]{0,500}aws_iam_role\.ingestion_runtime\["coordinator"\]\.arn/u,
    "coordinator SQS endpoint boundary is incomplete",
  ],
  [
    /sid\s*=\s*"ExactIngestionStarterQueueReads"[\s\S]{0,700}"sqs:ReceiveMessage"[\s\S]{0,500}aws_iam_role\.ingestion_runtime\["starter"\]\.arn/u,
    "starter SQS endpoint boundary is incomplete",
  ],
  [
    /sid\s*=\s*"IngestionStarterInvokesDurableVersionsOnly"[\s\S]{0,500}lambda:InvokeFunction[\s\S]{0,500}ingestion_runtime\["starter"\]\.arn/u,
    "starter Lambda endpoint boundary is incomplete",
  ],
  [
    /sid\s*=\s*"IngestionCoordinatorReadsDurableMetadataOnly"[\s\S]{0,500}lambda:GetDurableExecution[\s\S]{0,500}:\*\/durable-execution\/\*[\s\S]{0,500}ingestion_runtime\["coordinator"\]\.arn/u,
    "coordinator durable metadata endpoint boundary is incomplete",
  ],
  [
    /sid\s*=\s*"AllowIngestionDurableRoleStateDecryption"[\s\S]{0,800}kms:EncryptionContext:aws:lambda:FunctionArn[\s\S]{0,300}local\.ingestion_durable_arn/u,
    "durable role KMS encryption context is incomplete",
  ],
]) {
  requirePattern(platform, pattern, reason);
}
const secretsEndpointPolicy = section(
  platform,
  'data "aws_iam_policy_document" "secrets_endpoint"',
  'resource "aws_vpc_endpoint" "secretsmanager"',
);
for (const role of ["coordinator", "starter", "activity", "terminal"]) {
  if (!secretsEndpointPolicy.includes(`aws_iam_role.ingestion_runtime["${role}"].arn`)) {
    failures.push(`${platform}: ingestion Secrets Manager endpoint principal is missing: ${role}`);
  }
}
const ingestionRuntimePolicy = section(
  ingestionWorkflow,
  'data "aws_iam_policy_document" "ingestion_runtime"',
  'resource "aws_iam_role_policy" "ingestion_runtime"',
);
if ((ingestionRuntimePolicy.match(/kms:GenerateDataKey/gu) ?? []).length !== 2) {
  failures.push(
    `${ingestionWorkflow}: dispatch and asynchronous-failure SQS data-key boundaries are incomplete`,
  );
}
for (const required of [
  "kms:EncryptionContext:SecretARN",
  "kms:EncryptionContext:aws:sqs:arn",
  'each.key == "coordinator"',
  'each.key == "starter"',
  'contains(["coordinator", "terminal"], each.key)',
]) {
  if (!ingestionRuntimePolicy.includes(required)) {
    failures.push(`${ingestionWorkflow}: ingestion runtime KMS boundary is missing ${required}`);
  }
}
const ingestionDurablePolicy = section(
  ingestionWorkflow,
  'data "aws_iam_policy_document" "ingestion_durable"',
  'resource "aws_iam_role_policy" "ingestion_durable"',
);
for (const required of [
  "kms:EncryptionContext:aws:lambda:FunctionArn",
  "kms:EncryptionContext:aws:sqs:arn",
  "lambda.$" + "{data.aws_region.current.region}.amazonaws.com",
  "sqs.$" + "{data.aws_region.current.region}.amazonaws.com",
]) {
  if (!ingestionDurablePolicy.includes(required)) {
    failures.push(`${ingestionWorkflow}: ingestion durable KMS boundary is missing ${required}`);
  }
}
for (const required of [
  'sid       = "AllowEventBridgeIngestionQueueEncryption"',
  'sid       = "AllowIngestionLambdaDurableStateEncryption"',
  'sid       = "AllowIngestionDurableRoleStateDecryption"',
  "local.ingestion_schedule_rule_arn, local.ingestion_terminal_rule_arn",
  'variable = "kms:EncryptionContext:aws:lambda:FunctionArn"',
  'data "aws_iam_policy_document" "secrets_endpoint"',
  'data "aws_iam_policy_document" "outbox_sqs_endpoint"',
  'data "aws_iam_policy_document" "outbox_lambda_endpoint"',
  'sid       = "ExactIngestionCoordinatorQueueWrites"',
  'sid    = "ExactIngestionStarterQueueReads"',
  'sid       = "IngestionStarterInvokesDurableVersionsOnly"',
  'sid       = "IngestionCoordinatorReadsDurableMetadataOnly"',
]) {
  requireText(platform, required, `ingestion EventBridge CMK boundary is missing: ${required}`);
}
for (const forbidden of ["http://", "https://"]) {
  forbidText(
    ingestionWorkflow,
    forbidden,
    `real-provider/network activation residue remains: ${forbidden}`,
  );
}
for (const required of ["ingestion-durable-lambda", "ingestion-runtime-lambda"]) {
  requireText(ingestionBuilder, required, `ingestion artifact builder is missing: ${required}`);
  requireText(workflowPublisher, required, `workflow publisher is missing: ${required}`);
}

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
  'Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf"',
  "The development Terraform variable inventory is empty or duplicated.",
  'SchemaVersion                    = "5"',
  "AllowSchemaFiveOneSerialAdvance",
  "Only a CompleteDark schema-5 retained baseline may cross the migration handoff.",
  "BaselineToReleaseDeltaSha256",
  '"--version-id", ([string]$gateway.s3_object_version)',
  'foreach ($propertyName in @("mountPoints", "portMappings", "systemControls", "volumesFrom"))',
  '$property.Name -in @("ipc_mode", "pid_mode", "task_role_arn")',
  "document_scan_mapping_enabled                 = $false",
  "document_scan_event_rule_enabled              = $false",
  "The saved source plan must be an already accepted zero-change input baseline.",
  "The task plan may change only the migration task definition and default-off ingestion guard.",
  "The ingestion activation guard is not the exact default-off state-only create.",
  '"ecs", "run-task", "--cli-input-json"',
  "aws ecs wait tasks-stopped",
  "Get-MigrationAggregateSuccessMessages -ReleaseSourceSha $SourceSha",
  "Read-MigrationReleaseSource -ReleaseSourceSha $ReleaseSourceSha",
  "The migration release does not declare one known exact owner order.",
  "The migration owner versions are not an exact sequential inventory.",
  "The migration log stream violates the exact ordered aggregate-only success contract.",
  "AggregateSuccessLogCount = $messages.Count",
  "The exact release-bound aggregate success events did not become visible within the bounded CloudWatch polling window.",
  "Assert-DatabaseSafety",
  "Assert-RequestNetwork",
]) {
  requireText(
    developmentMigrationOperator,
    required,
    `development migration operator guard is missing: ${required}`,
  );
}
forbidText(
  "scripts/verify-development-gateway-lambda-boundary.ps1",
  "exit $LASTEXITCODE",
  "development gateway wrapper must return to its parent operator",
);
for (const required of [
  'Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf"',
  "The gateway baseline variable inventory is empty or duplicated.",
  "DocumentReleaseSourceSha",
  "DocumentOperatorSourceSha",
  "DocumentOperatorDeltaSha256",
  "BaselineToReleaseDeltaSha256",
  "Assert-GatewayVerifySourceDelta",
  "The gateway drift variable inventory is empty or duplicated.",
  "AllowOneSerialAdvance",
  "Post-apply verification requires the exact reviewed gateway release plan",
]) {
  requireText(
    developmentGatewayReleaseOperator,
    required,
    `development gateway release split-source handoff guard is missing: ${required}`,
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
  'pattern        = "{ $.message.event = \\"document_processing_security_contradiction\\" }"',
  'pattern        = "{ $.message.event = \\"document_processing_record_failed\\" }"',
  'pattern        = "{ $.message.event = \\"document_processing_timed_out\\" }"',
  'resource "aws_cloudwatch_metric_alarm" "document_scan_delivery_dead_letter"',
  'resource "aws_cloudwatch_metric_alarm" "document_processing_timed_out"',
  'resource "aws_iam_role" "document_parser_object_access"',
  "GUARDDUTY_PROTECTION_PLAN_ARN   = aws_guardduty_malware_protection_plan.candidate_documents[0].arn",
  "DOCUMENT_OBJECT_ACCESS_ROLE_ARN = local.document_parser_object_access_role_arn",
  'state       = var.document_scan_event_rule_enabled ? "ENABLED" : "DISABLED"',
  "enabled                 = var.document_scan_mapping_enabled",
  "dead_letter_config { arn = local.document_scan_delivery_dead_letter_queue_arn }",
]) {
  requireText(
    candidateDocuments,
    required,
    `document processing fail-closed boundary is missing: ${required}`,
  );
}
requireText(platform, 'resource "aws_vpc_endpoint" "sts"', "private STS endpoint is missing");
const migrationS3EndpointPolicy = section(
  platform,
  'data "aws_iam_policy_document" "migration_s3_endpoint"',
  'resource "aws_vpc_endpoint" "migration_s3"',
);
for (const required of [
  'actions   = ["s3:GetObject"]',
  'resources = ["arn:aws:s3:::prod-${data.aws_region.current.region}-starport-layer-bucket/*"]',
  'type        = "*"',
  'identifiers = ["*"]',
]) {
  if (!migrationS3EndpointPolicy.includes(required)) {
    failures.push(`${platform}: migration ECR layer endpoint policy is missing ${required}`);
  }
}
for (const forbidden of ["s3:*", "arn:aws:s3:::*"]) {
  if (migrationS3EndpointPolicy.includes(forbidden)) {
    failures.push(`${platform}: migration ECR layer endpoint policy contains ${forbidden}`);
  }
}

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
  !documentScanQueuePolicy.includes("values   = [local.document_scan_results_rule_arn]") ||
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
  "local.document_scan_results_rule_arn",
  "local.document_scan_tag_failure_rule_arn",
  "local.document_scan_plan_unhealthy_rule_arn",
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
  'Description = "Immutable ${var.profile_readiness_durable_artifact_sha256}; activity ${aws_lambda_function.profile_readiness_activity[0].qualified_arn}"',
]) {
  requireText(durable, required, `durable security/replay boundary is missing: ${required}`);
}
requireText(
  platform,
  'platform_kms_key_arn           = "arn:aws:kms:' +
    "$" +
    "{data.aws_region.current.region}:" +
    "$" +
    "{data.aws_caller_identity.current.account_id}:key/" +
    "$" +
    '{aws_kms_key.platform.key_id}"',
  "the stable plan-known platform KMS ARN invariant is missing",
);
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
  '"kms:Encrypt"',
  '"sts:AssumeRole"',
  'Sid    = "OperateCandidateDataExportObjects"',
  'Resource = "${local.candidate_data_export_bucket_arn}/candidate-data-exports/*"',
  'Sid    = "OperateCandidateDeletionRecoveryLedger"',
  'Resource = "${local.candidate_deletion_recovery_bucket_arn}/candidate-deletion-recovery/*"',
  '"s3:DeleteObjectVersion"',
  '"s3:ListBucketVersions"',
  '"s3:PutObjectRetention"',
]) {
  requireText(bootstrap, required, `workload boundary permission is missing: ${required}`);
}
requirePattern(
  bootstrap,
  /Sid\s*=\s*"OperateCandidateDeletionRecoveryLedger"[\s\S]{0,600}"s3:GetObjectVersionTagging"[\s\S]{0,600}"s3:PutObjectVersionTagging"/u,
  "candidate deletion recovery boundary must permit exact-version read and completion tagging",
);
requirePattern(
  durable,
  /sid\s*=\s*"WriteCandidateDeletionRecoveryLedger"[\s\S]{0,600}"s3:GetObjectVersionTagging"[\s\S]{0,600}"s3:PutObjectVersionTagging"/u,
  "candidate-rights activity role must permit exact-version recovery read and completion tagging",
);
requirePattern(
  candidateDocuments,
  /sid\s*=\s*"CandidateDeletionRecoveryLedgerAccess"[\s\S]{0,600}"s3:GetObjectVersionTagging"[\s\S]{0,600}"s3:PutObjectVersionTagging"/u,
  "candidate deletion recovery endpoint policy must permit exact-version read and completion tagging",
);
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
  for (const required of ['"kms:Decrypt"', '"kms:GenerateDataKey"', "local.platform_kms_key_arn"]) {
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
for (const required of [
  "FROM node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436 AS runtime",
  "libcrypto3-3.5.8-r0.apk",
  "a5592b5cf276bc7a30ac7b161d46446085490b640faa1f839ea98eb15aacad31",
  "libssl3-3.5.8-r0.apk",
  "f80b76cb5e5a52cfc1ced08f8dc3022adc0ce0a3d6e7741976731b22c71fe310",
  "apk add --no-network /tmp/libcrypto3.apk /tmp/libssl3.apk ca-certificates-bundle zlib",
  'apk info -e "libcrypto3=3.5.8-r0"',
  'apk info -e "libssl3=3.5.8-r0"',
  "apk del apk-tools",
  "rm -f /tmp/libcrypto3.apk /tmp/libssl3.apk",
  "rm -rf /usr/local/lib/node_modules /opt/yarn-v1.22.22",
  "/var/log/apk.log",
  "test ! -e /sbin/apk",
  "test -f /lib/apk/db/installed",
  "USER 65532:65532",
  'ENTRYPOINT ["/usr/local/bin/node"]',
]) {
  requireText(
    "Dockerfile.migration",
    required,
    `Dockerfile.migration ECR-scannable runtime hardening is missing: ${required}`,
  );
}
forbidText(
  "Dockerfile.migration",
  "FROM scratch AS runtime",
  "Dockerfile.migration must retain Alpine package metadata for ECR scanning",
);
forbidText(
  "Dockerfile.migration",
  "gcr.io/distroless",
  "Dockerfile.migration retains the vulnerable Debian runtime",
);
forbidText(
  "Dockerfile.migration",
  "apk upgrade",
  "Dockerfile.migration must use checksum-pinned security packages instead of a moving upgrade",
);
for (const required of [
  "FROM node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436 AS runtime-node",
  "FROM scratch AS runtime",
  "COPY --from=runtime-node /usr/local/bin/node /nodejs/bin/node",
  "COPY --from=runtime-node /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1",
  "COPY --from=runtime-node /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6",
  "COPY --from=runtime-node /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1",
  "COPY --from=runtime-node /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt",
  "USER 65532:65532",
  'ENTRYPOINT ["/nodejs/bin/node"]',
]) {
  requireText(
    "Dockerfile.web",
    required,
    `Dockerfile.web runtime hardening is missing: ${required}`,
  );
}
forbidText(
  "Dockerfile.web",
  "gcr.io/distroless",
  "Dockerfile.web retains the vulnerable Debian runtime",
);
forbidText("Dockerfile.web", "/bin/sh", "Dockerfile.web must remain shell-free");

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
