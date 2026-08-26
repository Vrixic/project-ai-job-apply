[CmdletBinding()]
param(
  [ValidateSet("Plan", "Apply", "Verify", "Bootstrap")][string]$Action = "Verify",
  [ValidateSet("KmsPrerequisite", "ParserDark", "CompleteDark")][string]$Stage = "ParserDark",
  [ValidateSet("None", "Parser", "Processor")][string]$RefreshStep = "None",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^(?:|[a-f0-9]{40})$")][string]$ReleaseSourceSha = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedOperatorDeltaSha256 = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedBaselineToOperatorDeltaSha256 = "",
  [string]$BaselinePlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselineSha256 = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedBaselineMetadataSha256 = "",
  [string]$CurrentTemplatePlanPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedCurrentTemplateSha256 = "",
  [string]$CurrentTemplateReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedCurrentTemplateReceiptSha256 = "",
  [string]$PublicationReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedReceiptSha256 = "",
  [string]$AppliedGatewayPlanPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedAppliedGatewayPlanSha256 = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedAppliedGatewayPlanMetadataSha256 = "",
  [string]$AppliedGatewayReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedAppliedGatewayReceiptSha256 = "",
  [string]$RetainedParserReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedRetainedParserReceiptSha256 = "",
  [string]$ParserRefreshReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedParserRefreshReceiptSha256 = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-gateway-release-guards.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage ParserDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Apply -Stage ParserDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
    -PlanPath PLAN_PATH_FROM_PLAN -ReviewedPlanSha256 PLAN_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage ParserDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -ReleaseSourceSha DEPLOYED_DOCUMENT_ARTIFACT_COMMIT `
    [-ReviewedOperatorDeltaSha256 REVIEWED_CANONICAL_DELTA_SHA256] `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    [-ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256] `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Plan -Stage CompleteDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath PARSER_DARK_ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
    [-ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256] `
    -PublicationReceiptPath EXACT_CURRENT_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage CompleteDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -ReleaseSourceSha DEPLOYED_COMPLETE_DARK_ARTIFACT_COMMIT `
    -ReviewedOperatorDeltaSha256 REVIEWED_RELEASE_OPERATOR_DELTA_SHA256 `
    -ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256 `
    -BaselinePlanPath RETAINED_PARSER_DARK_ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
    -PublicationReceiptPath DEPLOYED_COMPLETE_DARK_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Verify -Stage CompleteDark `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -ReleaseSourceSha DEPLOYED_COMPLETE_DARK_ARTIFACT_COMMIT `
    -ReviewedOperatorDeltaSha256 REVIEWED_RELEASE_OPERATOR_DELTA_SHA256 `
    -ReviewedBaselineToOperatorDeltaSha256 REVIEWED_BASELINE_OPERATOR_DELTA_SHA256 `
    -BaselinePlanPath RETAINED_COMPLETE_DARK_ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -ReviewedBaselineMetadataSha256 BASELINE_METADATA_SHA256 `
    -PublicationReceiptPath DEPLOYED_COMPLETE_DARK_RECEIPT -ReviewedReceiptSha256 CURRENT_RECEIPT_SHA256 `
    -AppliedGatewayPlanPath EXACT_ALREADY_APPLIED_GATEWAY_PLAN `
    -ReviewedAppliedGatewayPlanSha256 APPLIED_GATEWAY_PLAN_SHA256 `
    -ReviewedAppliedGatewayPlanMetadataSha256 APPLIED_GATEWAY_PLAN_METADATA_SHA256 `
    -AppliedGatewayReceiptPath EXACT_ALREADY_APPLIED_GATEWAY_RECEIPT `
    -ReviewedAppliedGatewayReceiptSha256 APPLIED_GATEWAY_RECEIPT_SHA256 `
    -RetainedParserReceiptPath EXACT_RETAINED_PARSER_RECEIPT `
    -ReviewedRetainedParserReceiptSha256 RETAINED_PARSER_RECEIPT_SHA256

The operator reconstructs all current deployment inputs from a checksum-reviewed zero-change
baseline, overlays only the selected monotonic stage and verified Lambda publication, derives the
applied parser-version pin for CompleteDark, and forces every processing trigger dark. Apply
consumes only the exact checksum-reviewed saved plan; resource-targeted planning is unsupported.
Verify retains a new checksum-bound zero-change plan and metadata sidecar below the ignored
development .terraform directory. Its BaselinePath, BaselineSha256, and
BaselineMetadataSha256 can be passed unchanged to the migration operator as AppliedPlanPath,
AppliedPlanSha256, and AppliedPlanMetadataSha256.
Only Verify may bind an ancestor document artifact release. That exception requires the exact
reviewed canonical operator-delta SHA-256 and records release, operator, and delta identities in
the retained metadata. Plan and Apply require the exact current release and preserve their
exact-current binding. CompleteDark may consume an ancestor-release schema-3/4 ParserDark
baseline only when its own reviewed metadata plus any baseline-operator-to-current delta are
verified independently. It still requires separately published exact-current artifacts and does
not relax the Verify-only ancestor artifact exception.
The one failed post-apply CompleteDark verification may recover only from its exact retained
schema-3/4 ParserDark baseline. That Verify-only path requires both independently reviewed deltas,
revalidates the baseline's stored release-to-operator delta, binds exact historical and current
state serials, derives the old numeric parser pin from applied processor state, and proves the
retained old parser artifact live before emitting a current CompleteDark zero-drift baseline.
The final form is a one-time Verify-only recovery for the exact already-applied development
gateway release. Its seven recovery inputs are all-or-none and cannot be used by Plan or
Apply. It consumes the reviewed applied plan only as a current-variable template, performs no
apply, authenticates the retained ParserDark parser-v1 artifact from its separately reviewed
historical publication receipt, and retains a new baseline only after exact live, state, and
zero-drift verification.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development deployment is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted state bucket are required."
}
foreach ($required in @($BaselinePlanPath, $ReviewedBaselineSha256)) {
  if ([string]::IsNullOrWhiteSpace($required)) {
    throw "A checksum-reviewed zero-change baseline is required."
  }
}
$stageValue = @{ KmsPrerequisite = "kms-prerequisite"; ParserDark = "parser-dark"; CompleteDark = "complete-dark" }[$Stage]
if ($Stage -cne "KmsPrerequisite") {
  foreach ($required in @($PublicationReceiptPath, $ReviewedReceiptSha256)) {
    if ([string]::IsNullOrWhiteSpace($required)) { throw "A checksum-reviewed verified publication receipt is required." }
  }
}
$appliedGatewayInputValues = @(
  $AppliedGatewayPlanPath, $ReviewedAppliedGatewayPlanSha256,
  $ReviewedAppliedGatewayPlanMetadataSha256, $AppliedGatewayReceiptPath,
  $ReviewedAppliedGatewayReceiptSha256, $RetainedParserReceiptPath,
  $ReviewedRetainedParserReceiptSha256
)
$appliedGatewayInputCount = @($appliedGatewayInputValues | Where-Object {
    -not [string]::IsNullOrWhiteSpace([string]$_)
  }).Count
if ($appliedGatewayInputCount -notin @(0, $appliedGatewayInputValues.Count)) {
  throw "The already-applied gateway recovery inputs are all-or-none."
}
$appliedGatewayRecoveryRequested = $appliedGatewayInputCount -eq $appliedGatewayInputValues.Count
if ($appliedGatewayRecoveryRequested -and ($Action -cne "Verify" -or $Stage -cne "CompleteDark")) {
  throw "Already-applied gateway recovery is accepted only for CompleteDark Verify."
}
$parserRefreshInputCount = @(@($ParserRefreshReceiptPath, $ReviewedParserRefreshReceiptSha256) |
  Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
if ($parserRefreshInputCount -notin @(0, 2)) { throw "The parser-refresh receipt inputs are all-or-none." }
if ($RefreshStep -cne "None" -and ($Stage -cne "CompleteDark" -or $Action -notin @("Plan", "Apply"))) {
  throw "A current CompleteDark refresh step is accepted only for CompleteDark Plan or Apply."
}
if ($Action -ceq "Bootstrap" -and ($Stage -cne "CompleteDark" -or $RefreshStep -cne "None")) {
  throw "Baseline bootstrap is accepted only for CompleteDark without a refresh step."
}
$templateInputs = @(
  $CurrentTemplatePlanPath, $ReviewedCurrentTemplateSha256,
  $CurrentTemplateReceiptPath, $ReviewedCurrentTemplateReceiptSha256
)
$templateInputCount = @($templateInputs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
if ($Action -ceq "Bootstrap" -and $templateInputCount -ne $templateInputs.Count) {
  throw "Bootstrap requires the checksum-reviewed current-state template plan and verification receipt."
}
if ($Action -cne "Bootstrap" -and $templateInputCount -ne 0) {
  throw "Current-state template inputs are accepted only for Bootstrap."
}
if ($RefreshStep -ceq "Processor" -and $parserRefreshInputCount -ne 2) {
  throw "The processor refresh requires the checksum-reviewed parser-refresh receipt."
}
if ($RefreshStep -cne "Processor" -and $parserRefreshInputCount -ne 0) {
  throw "Parser-refresh receipt inputs are accepted only for the processor refresh step."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformDataRoot "development-document-dark-deployment"
$terraformRuntimeData = Join-Path $terraformDataRoot "development-document-dark-operator-data"
$metadataSuffix = ".document-dark.json"
$extensionLayerArn = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
$script:parserSourceTransition = $false
$script:completeDarkVerifyRecovery = $false
$script:completeDarkAppliedGatewayRecovery = $false
$script:appliedGatewayRecovery = $null
$script:retainedParserArtifact = $null
$script:baselineReceiptSha256 = ""
$script:completeDarkParserRefresh = $RefreshStep -ceq "Parser"
$script:completeDarkProcessorRefresh = $RefreshStep -ceq "Processor"
$script:parserRefreshEvidence = $null
$script:bootstrapInputMetadata = $null
$script:bootstrapTemplate = $null
$completeDarkRecoveryReleaseSourceSha = "a6d0fba09082b8bc61ee7b604ee1d5c47bd71624"
$completeDarkRecoveryBaselineReleaseSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
$completeDarkRecoveryBaselineOperatorSourceSha = "cd8bc47fd89239c5e224ccdd1baff097d13c5bf7"
$completeDarkRecoveryBaselineReceiptSha256 = "97d4084d0a5b2ddfc563f3e4f76bafb9598dcdd0e9579fb18821b6bdc9097677"
$completeDarkRecoveryReceiptSha256 = "524bbf645621a0aa744c3e84f7deff5f8430830e87330267ed5ca7243f40023e"
$completeDarkRecoveryStateLineage = "472ef790-b249-45ec-817f-718005980d9e"
$completeDarkRecoveryBaselineStateSerial = 103
$completeDarkRecoveryCurrentStateSerial = 106
$appliedGatewayRecoveryReleaseSourceSha = "a6d0fba09082b8bc61ee7b604ee1d5c47bd71624"
$appliedGatewayRecoveryBaselineOperatorSourceSha = "b4bfb38ddb8740a9c9fb8528a7e733e32f184c01"
$appliedGatewayRecoveryStateLineage = "472ef790-b249-45ec-817f-718005980d9e"
$appliedGatewayRecoveryBaselineStateSerial = 106
$appliedGatewayRecoveryCurrentStateSerial = 107
$appliedGatewayRecoveryBaselineSha256 = "6a6b281497f5f629e0ae1dc54052e2b0975d354ffc9aaa1d6f980368459e9d2b"
$appliedGatewayRecoveryBaselineMetadataSha256 = "b219a07674552bed93ae492b3e96cdf8da0ebae1e1b1003830673adeec8daea1"
$appliedGatewayRecoveryBaselineOperatorDeltaSha256 = "4ef5e0a265b982f11de846904374d7db437391bf6ad1637fc8ad501e20e1d3e9"
$appliedGatewayRecoveryDocumentReceiptSha256 = "524bbf645621a0aa744c3e84f7deff5f8430830e87330267ed5ca7243f40023e"
$appliedGatewayRecoveryPlanSha256 = "1d41366e7f40d51c09000d823f1c0b104c82deee5f177e2a782e5a92641c5fab"
$appliedGatewayRecoveryPlanMetadataSha256 = "6a46db5c0f5cb4aadfe97542c0333733dcb0e35f9578a4da9b704ef428d3d837"
$appliedGatewayRecoveryReceiptSha256 = "2ea5d284126fc25bc4532059f7780a92669670927391ada50c2f70d53d0f8d41"
$appliedGatewayRecoveryRetainedParserReceiptSourceSha = $completeDarkRecoveryBaselineReleaseSourceSha
$appliedGatewayRecoveryRetainedParserReceiptSha256 = $completeDarkRecoveryBaselineReceiptSha256
$appliedGatewayRecoveryRetainedParserArtifactSha256 = "99d958f709ae92e338b98286b37ef29815d4f839c91d3fe0684fdea9cb10d23f"
$appliedGatewayRecoveryRetainedParserObjectBase64Sha256 = "mdlY9wmukuM4uYKGs37ymBXU+DnJHT/gaE/eqcsQ0j8="
$appliedGatewayRecoveryRetainedParserObjectVersion = "maNFAWhxk8j27IhJ_kd6HcoBJJfGbFEi"
$appliedGatewayRecoveryRetainedParserContentLength = 489567
$appliedGatewayRecoveryParserQualifiedArn = "arn:aws:lambda:us-east-2:362544434697:function:ai-job-apply-development-document-parser:1"
$appliedGatewayRecoveryMigrationImage = "362544434697.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:9be2474047872b9dc3878301fe946becbb7653f4e4dc733235f6d424502563eb"
$postHistoricalVariableNames = @(
  "candidate_rights_auth0_authorized_owner", "candidate_rights_auth0_secret_provisioned",
  "candidate_rights_backup_retention_days", "candidate_rights_download_grant_seconds",
  "candidate_rights_enabled", "candidate_rights_export_lifecycle_days",
  "candidate_rights_export_lifetime_seconds", "candidate_rights_id_token_audience",
  "candidate_rights_owner_inventory", "candidate_rights_policy_sha256",
  "candidate_rights_policy_version", "candidate_rights_recent_auth_max_age_seconds",
  "candidate_rights_subprocessor_inventory", "database_backup_retention_days",
  "deploy_ingestion_runtime", "deploy_public_job_reader",
  "ingestion_durable_artifact_base64sha256", "ingestion_durable_artifact_s3_key",
  "ingestion_durable_artifact_s3_object_version", "ingestion_durable_artifact_sha256",
  "ingestion_execution_timeout_seconds", "ingestion_lambda_extension_layer_arn",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress",
  "ingestion_provider_sources", "ingestion_retention_days",
  "ingestion_runtime_artifact_base64sha256", "ingestion_runtime_artifact_s3_key",
  "ingestion_runtime_artifact_s3_object_version", "ingestion_runtime_artifact_sha256",
  "ingestion_runtime_enabled", "ingestion_synthetic_seed", "ingestion_synthetic_source_enabled",
  "public_job_cluster_residual_accepted", "public_job_database_boundary_version",
  "public_job_lambda_artifact_base64sha256", "public_job_lambda_artifact_s3_key",
  "public_job_lambda_artifact_s3_object_version", "public_job_lambda_artifact_sha256",
  "public_job_projection_artifact_base64sha256", "public_job_projection_artifact_s3_key",
  "public_job_projection_artifact_s3_object_version", "public_job_projection_artifact_sha256",
  "public_job_route_activation_allowed", "public_job_route_throttling_burst_limit",
  "public_job_route_throttling_rate_limit"
)
$allowedVariableNames = @(
  "candidate_document_cors_allowed_origins", "database_engine_version", "database_instance_class",
  "database_performance_insights", "deploy_applications", "deploy_document_intake",
  "deploy_gateway_lambda", "deploy_profile_readiness_durable", "deploy_serverless_outbox",
  "document_parser_artifact_base64sha256", "document_parser_invocation_qualified_arn",
  "document_parser_artifact_s3_key", "document_parser_artifact_s3_object_version",
  "document_parser_artifact_sha256", "document_parser_version",
  "document_processor_artifact_base64sha256", "document_processor_artifact_s3_key",
  "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
  "document_processor_extension_layer_arn", "document_processing_deployment_stage",
  "document_scan_event_rule_enabled",
  "document_scan_mapping_enabled", "document_security_health_rules_enabled", "enable_container_insights", "enable_redis",
  "gateway_lambda_artifact_base64sha256", "gateway_lambda_artifact_s3_key",
  "gateway_lambda_artifact_s3_object_version", "gateway_lambda_artifact_sha256",
  "gateway_lambda_extension_layer_arn", "gateway_lambda_reserved_concurrency", "high_availability",
  "migration_image", "oidc_audience", "oidc_issuer", "private_application_networking",
  "profile_readiness_activity_artifact_base64sha256", "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version", "profile_readiness_activity_artifact_sha256",
  "profile_readiness_durable_artifact_base64sha256", "profile_readiness_durable_artifact_s3_key",
  "profile_readiness_durable_artifact_s3_object_version", "profile_readiness_durable_artifact_sha256",
  "profile_readiness_execution_timeout_seconds", "profile_readiness_lambda_extension_layer_arn",
  "profile_readiness_retention_days", "serverless_runtime_enabled",
  "workflow_ingress_artifact_base64sha256", "workflow_ingress_artifact_s3_key",
  "workflow_ingress_artifact_s3_object_version", "workflow_ingress_artifact_sha256",
  "workflow_ingress_lambda_extension_layer_arn"
) + $postHistoricalVariableNames
$legacyBaselineVariableNames = @($allowedVariableNames | Where-Object {
    $_ -notin @(
      "document_processing_deployment_stage", "document_parser_invocation_qualified_arn",
      "document_security_health_rules_enabled"
    ) -and $_ -notin $postHistoricalVariableNames
  }) + @("deploy_document_processing", "document_processing_kms_prerequisite_enabled")

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "AWS read '$($Arguments[0]) $($Arguments[1])' failed. Refresh development SSO." }
  if (-not $raw) { return $null }
  try { return $raw | ConvertFrom-Json } catch { throw "AWS returned invalid JSON." }
}

function Resolve-InputPath {
  param([Parameter(Mandatory)][string]$Candidate, [switch]$MustExist)
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) { [IO.Path]::GetFullPath($Candidate) }
    else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Candidate)) }
  $prefix = [IO.Path]::GetFullPath($terraformDataRoot).TrimEnd([char[]]@("\", "/")) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Baseline, receipt, and release plans must stay under the ignored development .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "An operator input file is missing." }
  return $resolved
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function Get-ReviewedOperatorDelta {
  param(
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$OperatorSha,
    [string]$ReviewedSha256 = $ReviewedOperatorDeltaSha256
  )
  if ($ReleaseSha -ceq $OperatorSha) {
    if (-not [string]::IsNullOrEmpty($ReviewedSha256)) {
      throw "A reviewed operator delta must be omitted when both commits are exact."
    }
    return Get-TextSha256 "development-operator-delta-v1`n$ReleaseSha`n$OperatorSha`n--name-status--`n--patch--`n"
  }
  & git -C $repositoryRoot merge-base --is-ancestor $ReleaseSha $OperatorSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The document release is not an ancestor of the current operator." }
  if ($ReviewedSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "An ancestor release requires its independently reviewed canonical operator-delta SHA-256."
  }
  $allowed = @(
    "backend/services/jobs/src/persistence/catalog.ts", "backend/services/jobs/src/persistence/catalog.test.ts",
    "scripts/lib/development-document-dark-guards.ps1", "scripts/lib/development-gateway-release-guards.ps1",
    "scripts/operate-development-document-dark-deployment.ps1", "scripts/operate-development-document-migration.ps1",
    "scripts/operate-development-gateway-release.ps1", "scripts/tests/development-document-dark-guards.tests.ps1",
    "scripts/tests/development-document-dark-operator.tests.ps1", "scripts/tests/development-document-migration-operator.tests.ps1",
    "scripts/tests/development-gateway-release-guards.tests.ps1", "scripts/tests/development-gateway-release-operator.tests.ps1",
    "scripts/validate-serverless-workflow-infrastructure.mjs",
    "infrastructure/runbooks/deployments/development-document-dark-deployment.md",
    "infrastructure/runbooks/deployments/database-migration.md",
    "infrastructure/runbooks/deployments/development-gateway-lambda-release.md"
  )
  $records = @(& git -C $repositoryRoot diff --name-status --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $records.Count -eq 0) { throw "The release-to-operator delta could not be proven." }
  $numstat = @(& git -C $repositoryRoot diff --numstat --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0 -or @($numstat | Where-Object { $_ -match '^-\t-\t' }).Count -ne 0) {
    throw "Binary operator deltas are not permitted."
  }
  foreach ($record in $records) {
    if ($record -notmatch '^M\t(.+)$' -or $Matches[1] -notin $allowed) {
      throw "The release-to-operator delta is not the exact modified-file operator allowlist."
    }
    $path = $Matches[1]
    foreach ($revision in @($ReleaseSha, $OperatorSha)) {
      $type = (& git -C $repositoryRoot cat-file -t "$revision`:$path" 2>$null).Trim()
      if ($LASTEXITCODE -ne 0 -or $type -cne "blob") { throw "The operator-only delta contains a missing or non-blob path." }
    }
  }
  $patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The canonical operator patch could not be read." }
  $canonical = "development-operator-delta-v1`n$ReleaseSha`n$OperatorSha`n--name-status--`n" +
    (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n")
  $sha = Get-TextSha256 $canonical
  if ($sha -cne $ReviewedSha256) { throw "The canonical operator-delta checksum does not match independent review." }
  return $sha
}

function Get-ReviewedBootstrapDelta {
  param(
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$OperatorSha,
    [AllowEmptyString()][string]$ReviewedSha256 = "",
    [ValidateSet("Stored", "Bootstrap")][string]$DeltaKind = "Bootstrap"
  )
  $domain = if ($DeltaKind -ceq "Stored") { "development-operator-delta-v1" }
    else { "development-document-complete-dark-bootstrap-delta-v1" }
  if ($ReleaseSha -notmatch '^[a-f0-9]{40}$' -or $OperatorSha -notmatch '^[a-f0-9]{40}$') {
    throw "Bootstrap source boundaries require exact commits."
  }
  if ($ReleaseSha -ceq $OperatorSha) {
    if (-not [string]::IsNullOrEmpty($ReviewedSha256)) {
      throw "A bootstrap delta must be omitted for an exact source boundary."
    }
    return Get-TextSha256 "$domain`n$ReleaseSha`n$OperatorSha`n--name-status--`n--patch--`n"
  }
  if ($ReviewedSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "An ancestor bootstrap boundary requires its independently reviewed canonical delta SHA-256."
  }
  & git -C $repositoryRoot merge-base --is-ancestor $ReleaseSha $OperatorSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw "A bootstrap source boundary is not an ancestor of current main." }
  $detected = @(& git -C $repositoryRoot diff --name-status --find-renames --find-copies-harder `
      "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $detected.Count -eq 0 -or
    @($detected | Where-Object { $_ -match '^R[0-9]*\t' }).Count -ne 0 -or
    @($detected | Where-Object {
        $_ -notmatch '^(?:A|M|D)\t[^\t]+$' -and $_ -notmatch '^C[0-9]+\t[^\t]+\t[^\t]+$'
      }).Count -ne 0) {
    throw "The bootstrap delta is empty, unreadable, renamed, or structurally ambiguous."
  }
  $records = @(& git -C $repositoryRoot diff --name-status --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  $recordsExit = $LASTEXITCODE
  $numstat = @(& git -C $repositoryRoot diff --numstat --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($recordsExit -ne 0 -or $LASTEXITCODE -ne 0 -or $records.Count -eq 0 -or
    $records.Count -ne $numstat.Count -or
    ($DeltaKind -ceq "Stored" -and @($numstat | Where-Object { $_ -match '^-\t-\t' }).Count -ne 0)) {
    throw "The canonical bootstrap delta is empty, unreadable, or ambiguous."
  }
  foreach ($record in $records) {
    if ($record -notmatch '^(A|M|D)\t([^\t]+)$') { throw "The bootstrap delta contains an unsupported record." }
    $status = $Matches[1]; $path = $Matches[2]
    $revisions = if ($status -ceq "A") { @($OperatorSha) } elseif ($status -ceq "D") { @($ReleaseSha) } else { @($ReleaseSha, $OperatorSha) }
    foreach ($revision in $revisions) {
      $entry = @(& git -C $repositoryRoot ls-tree $revision -- $path 2>$null)
      if ($LASTEXITCODE -ne 0 -or $entry.Count -ne 1 -or [string]$entry[0] -notmatch '^(100644|100755) blob [a-f0-9]{40,64}\t') {
        throw "The bootstrap delta contains a missing, ambiguous, or non-regular path."
      }
    }
  }
  $patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames `
      "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The canonical bootstrap patch could not be read." }
  $computed = Get-TextSha256 ("$domain`n$ReleaseSha`n$OperatorSha`n--name-status--`n" +
    (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n"))
  if ($computed -cne $ReviewedSha256) { throw "The canonical bootstrap delta checksum does not match independent review." }
  return $computed
}

function Assert-CallerAndSource {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if ([string]$identity.Account -cne $ExpectedAccountId -or -not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the exact temporary development IAM Identity Center caller."
  }
  $version = (& terraform version -json 2>$null | ConvertFrom-Json).terraform_version
  if ($LASTEXITCODE -ne 0 -or [string]$version -cne "1.9.8") { throw "Terraform 1.9.8 is required." }
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $origin -or $dirty.Count -ne 0) {
    throw "The operation requires clean main exactly matching origin/main."
  }
  $release = if ([string]::IsNullOrEmpty($ReleaseSourceSha)) { $head } else { $ReleaseSourceSha }
  if ($Action -notin @("Verify", "Bootstrap") -and $release -cne $head) {
    throw "Plan and Apply require the exact current release; an ancestor artifact release is accepted only for Verify."
  }
  if ($Stage -ceq "KmsPrerequisite" -and $release -cne $head) { throw "KMS prerequisite operations require the exact current source." }
  $deltaSha = if ($Action -ceq "Bootstrap") {
    Get-ReviewedBootstrapDelta -ReleaseSha $release -OperatorSha $head -ReviewedSha256 $ReviewedOperatorDeltaSha256
  } else { Get-ReviewedOperatorDelta -ReleaseSha $release -OperatorSha $head }
  return [pscustomobject]@{ Release = $release; Operator = $head; DeltaSha256 = $deltaSha }
}

function Initialize-Backend {
  $location = (& aws s3api get-bucket-location --bucket $StateBucket --query LocationConstraint --output text 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $location -cne $Region) { throw "The state bucket is outside us-east-2." }
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json")
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json")
  if ([string]$versioning.Status -cne "Enabled" -or
    -not (ConvertTo-ExactBoolean $public.PublicAccessBlockConfiguration.BlockPublicAcls "BlockPublicAcls") -or
    -not (ConvertTo-ExactBoolean $public.PublicAccessBlockConfiguration.IgnorePublicAcls "IgnorePublicAcls") -or
    -not (ConvertTo-ExactBoolean $public.PublicAccessBlockConfiguration.BlockPublicPolicy "BlockPublicPolicy") -or
    -not (ConvertTo-ExactBoolean $public.PublicAccessBlockConfiguration.RestrictPublicBuckets "RestrictPublicBuckets")) {
    throw "The state bucket is not versioned and private."
  }
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json")
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -and
      (ConvertTo-ExactBoolean $_.BucketKeyEnabled "state bucket BucketKeyEnabled")
    })
  if ($rules.Count -ne 1) { throw "The state bucket must use one KMS default with Bucket Key enabled." }
  $kmsArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  $key = Invoke-AwsJson @("kms", "describe-key", "--key-id", $kmsArn, "--output", "json")
  if ([string]$key.KeyMetadata.Arn -notmatch "^arn:aws:kms:$Region`:$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact account and region."
  }
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", "platform.tfstate", "--output", "json")
  if ([long]$head.ContentLength -le 0 -or [string]::IsNullOrWhiteSpace([string]$head.VersionId) -or
    [string]$head.ServerSideEncryption -cne "aws:kms" -or
    -not (ConvertTo-ExactBoolean $head.BucketKeyEnabled "state object BucketKeyEnabled")) {
    throw "The remote platform state object is not nonempty, versioned, and KMS encrypted."
  }
  $objectKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$head.SSEKMSKeyId, "--output", "json")
  if ([string]$objectKey.KeyMetadata.KeyId -cne [string]$key.KeyMetadata.KeyId) {
    throw "The platform state object does not use the bucket's exact KMS key."
  }
  $null = New-Item -ItemType Directory -Path $terraformRuntimeData -Force
  $env:TF_DATA_DIR = $terraformRuntimeData
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsArn" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted development backend could not be initialized." }
}

function Read-Plan {
  param([Parameter(Mandatory)][string]$Path)
  $raw = & terraform "-chdir=$terraformDirectory" show -json $Path 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw "A saved Terraform plan could not be inspected." }
  return $raw | ConvertFrom-Json
}

function Assert-CurrentBootstrapTemplateSource {
  param(
    [Parameter(Mandatory)][string]$TemplateSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha,
    [Parameter(Mandatory)][string]$RepositoryPath
  )
  if ($TemplateSourceSha -notmatch '^[a-f0-9]{40}$' -or $OperatorSourceSha -notmatch '^[a-f0-9]{40}$') {
    throw "The current-state template has an invalid source identity."
  }
  & git -C $RepositoryPath merge-base --is-ancestor $TemplateSourceSha $OperatorSourceSha 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The current-state template source is not an ancestor of the current operator."
  }
}

function Assert-CurrentBootstrapTemplateVerification {
  param(
    [Parameter(Mandatory)][object]$Verification,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$StateIdentity,
    [Parameter(Mandatory)][string]$OperatorSourceSha,
    [Parameter(Mandatory)][string]$RepositoryPath
  )
  $keys = @(
    "activeEcsTaskCount", "activityRouteTableCount", "activitySubnetCount", "applicationNatGatewayCount",
    "appliedPlanSha256", "defaultDark", "emptyQueueCount", "environment", "kind",
    "planReceiptSha256", "providerDedicatedTopologyUsed", "publicationReceiptSha256",
    "releaseArtifactCoordinates", "rollbackArtifactCoordinates", "schemaVersion", "sourceSha",
    "stateLineage", "stateSerial", "verifiedAt", "versions", "zeroDriftPlanPath", "zeroDriftPlanSha256",
    "continuousEcsServiceCount"
  ) | Sort-Object
  Assert-CurrentBootstrapTemplateSource -TemplateSourceSha ([string]$Verification.sourceSha) `
    -OperatorSourceSha $OperatorSourceSha -RepositoryPath $RepositoryPath
  if ((@($Verification.PSObject.Properties | ForEach-Object Name | Sort-Object) -join "|") -cne ($keys -join "|") -or
    [string]$Verification.schemaVersion -cne "1" -or
    [string]$Verification.kind -cne "development-ingestion-dark-release-verification" -or
    [string]$Verification.environment -cne "development" -or
    [IO.Path]::GetFullPath([string]$Verification.zeroDriftPlanPath) -cne $PlanPath -or
    [string]$Verification.zeroDriftPlanSha256 -cne $PlanSha256 -or
    [string]$Verification.stateLineage -cne [string]$StateIdentity.Lineage -or
    [long]$Verification.stateSerial -ne [long]$StateIdentity.Serial -or
    $Verification.defaultDark -isnot [bool] -or -not $Verification.defaultDark -or
    [int]$Verification.activeEcsTaskCount -ne 0 -or [int]$Verification.continuousEcsServiceCount -ne 0 -or
    [int]$Verification.emptyQueueCount -ne 2 -or
    [string]$Verification.planReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Verification.publicationReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw "The current-state template is not the exact reviewed current default-dark verification."
  }
}

function Read-CurrentBootstrapTemplate {
  $planPath = Resolve-InputPath -Candidate $CurrentTemplatePlanPath -MustExist
  $planSha = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($planSha -cne $ReviewedCurrentTemplateSha256) {
    throw "The current-state template plan checksum does not match review."
  }
  $receiptPath = Resolve-InputPath -Candidate $CurrentTemplateReceiptPath -MustExist
  $receiptSha = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($receiptSha -cne $ReviewedCurrentTemplateReceiptSha256) {
    throw "The current-state template verification receipt checksum does not match review."
  }
  $verification = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $receiptPath -Raw)
  $state = Get-StateIdentity
  Assert-CurrentBootstrapTemplateVerification -Verification $verification -PlanPath $planPath `
    -PlanSha256 $planSha -StateIdentity $state -OperatorSourceSha $operatorCommit `
    -RepositoryPath $repositoryRoot
  $plan = Read-Plan -Path $planPath
  Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $plan
  return $plan
}

function Get-CurrentBootstrapDocumentEvidence {
  param([Parameter(Mandatory)][object]$Template)
  $definitions = @(
    [pscustomobject]@{ Name = "document-parser-lambda"; Prefix = "document_parser_artifact" },
    [pscustomobject]@{ Name = "document-processor-lambda"; Prefix = "document_processor_artifact" }
  )
  $boundary = Get-BoundaryValues
  $platformKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$boundary.PlatformKmsArn, "--output", "json")
  $artifacts = @()
  foreach ($definition in $definitions) {
    $key = [string]$Template.variables.PSObject.Properties["$($definition.Prefix)_s3_key"].Value.value
    $versionId = [string]$Template.variables.PSObject.Properties["$($definition.Prefix)_s3_object_version"].Value.value
    $artifactSha = [string]$Template.variables.PSObject.Properties["$($definition.Prefix)_sha256"].Value.value
    $base64Sha = [string]$Template.variables.PSObject.Properties["$($definition.Prefix)_base64sha256"].Value.value
    $pattern = "^lambda/documents/([a-f0-9]{40})/$artifactSha/$($definition.Name)\.zip$"
    if ($artifactSha -cnotmatch '^[a-f0-9]{64}$' -or $base64Sha -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
      [string]::IsNullOrWhiteSpace($versionId) -or $key -cnotmatch $pattern) {
      throw "The current-state template has invalid $($definition.Name) artifact coordinates."
    }
    $sourceSha = $Matches[1]
    & git -C $repositoryRoot merge-base --is-ancestor $sourceSha $operatorCommit 2>$null
    if ($LASTEXITCODE -ne 0) { throw "A current document artifact source is not an ancestor of the operator." }
    $stored = Invoke-AwsJson @("s3api", "head-object", "--bucket", [string]$boundary.ArtifactBucket,
      "--key", $key, "--version-id", $versionId, "--checksum-mode", "ENABLED", "--output", "json")
    $storedKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$stored.SSEKMSKeyId, "--output", "json")
    if ([string]$stored.VersionId -cne $versionId -or [string]$stored.ChecksumSHA256 -cne $base64Sha -or
      [string]$stored.ServerSideEncryption -cne "aws:kms" -or
      [string]$storedKey.KeyMetadata.KeyId -cne [string]$platformKey.KeyMetadata.KeyId -or
      [string]$stored.Metadata."source-sha" -cne $sourceSha -or
      [string]$stored.Metadata."artifact-sha256" -cne $artifactSha) {
      throw "A current-state document artifact failed exact-version KMS readback."
    }
    $artifacts += [pscustomobject]@{
      artifactName = [string]$definition.Name; suffix = "zip"; sourceSha = $sourceSha
      key = $key; versionId = $versionId; artifactSha256 = $artifactSha
      objectBase64Sha256 = $base64Sha
    }
  }
  return [pscustomobject]@{ artifacts = $artifacts }
}

function Write-ExclusiveJsonFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value)

  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.Write(($Value | ConvertTo-Json -Depth 30)) }
    finally { $writer.Dispose() }
  }
  finally { $stream.Dispose() }
}

function New-RetainedBaselineMetadata {
  param(
    [Parameter(Mandatory)][ValidatePattern("^[a-f0-9]{40}$")][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][ValidatePattern("^[a-f0-9]{40}$")][string]$OperatorSourceSha,
    [Parameter(Mandatory)][ValidatePattern("^[a-f0-9]{64}$")][string]$OperatorDeltaSha256,
    [Parameter(Mandatory)][ValidateSet("kms-prerequisite", "parser-dark", "complete-dark")][string]$DeploymentStage,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][ValidatePattern("^[a-f0-9]{64}$")][string]$PlanSha256,
    [Parameter(Mandatory)][string]$StateLineage,
    [Parameter(Mandatory)][long]$StateSerial,
    [string]$ReceiptSha256 = "",
    [string]$ParserQualifiedArn = ""
  )

  return [ordered]@{
    SchemaVersion      = "3"
    Kind               = "development-document-zero-drift-baseline"
    Environment        = "development"
    AccountId          = $ExpectedAccountId
    Region             = $Region
    ReleaseSourceSha   = $ReleaseSourceSha
    OperatorSourceSha  = $OperatorSourceSha
    OperatorDeltaSha256 = $OperatorDeltaSha256
    StateLineage       = $StateLineage
    StateSerial        = $StateSerial
    Stage              = $DeploymentStage
    ReceiptSha256      = $ReceiptSha256
    ParserQualifiedArn = $ParserQualifiedArn
    PlanPath           = $PlanPath
    PlanSha256         = $PlanSha256
    Applyable          = $false
    MeaningfulChanges  = 0
    CreatedAt          = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function Assert-RetainedBaselineMetadata {
  param([Parameter(Mandatory)][object]$Metadata, [Parameter(Mandatory)][hashtable]$Expected)

  $expectedKeys = @(
    "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
    "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
    "OperatorDeltaSha256", "OperatorSourceSha", "ReleaseSourceSha", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($actualKeys -join "|") -cne ($expectedKeys -join "|")) {
    throw "The retained document baseline metadata has an unexpected schema."
  }
  foreach ($entry in $Expected.GetEnumerator()) {
    $property = $Metadata.PSObject.Properties[[string]$entry.Key]
    if ($null -eq $property -or [string]$property.Value -cne [string]$entry.Value) {
      throw "The retained document baseline metadata does not match '$($entry.Key)'."
    }
  }
  $createdAtValid = if ($Metadata.CreatedAt -is [datetime]) {
    $Metadata.CreatedAt.Year -ge 2000 -and $Metadata.CreatedAt.Year -le 2099
  }
  else {
    [string]$Metadata.CreatedAt -match '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
  }
  if ($Metadata.Applyable -isnot [bool] -or $Metadata.Applyable -or
    [int]$Metadata.MeaningfulChanges -ne 0 -or
    -not $createdAtValid -or
    [string]$Metadata.ReleaseSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
    [string]$Metadata.OperatorSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
    [string]$Metadata.OperatorDeltaSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Metadata.PlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Metadata.StateLineage -cnotmatch '^[a-f0-9-]{36}$' -or
    [long]$Metadata.StateSerial -lt 1 -or
    [string]$Metadata.Stage -notin @("kms-prerequisite", "parser-dark", "complete-dark") -or
    ([string]$Metadata.Stage -ceq "kms-prerequisite" -and -not [string]::IsNullOrEmpty([string]$Metadata.ReceiptSha256)) -or
    ([string]$Metadata.Stage -cne "kms-prerequisite" -and [string]$Metadata.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') -or
    ([string]$Metadata.Stage -cne "complete-dark" -and -not [string]::IsNullOrEmpty([string]$Metadata.ParserQualifiedArn)) -or
    ([string]$Metadata.Stage -ceq "complete-dark" -and
      [string]$Metadata.ParserQualifiedArn -cnotmatch "^arn:aws:lambda:$([regex]::Escape($Region)):$ExpectedAccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
    throw "The retained document baseline metadata does not prove a zero-change verification."
  }
}

function Save-RetainedBaselineMetadata {
  param(
    [Parameter(Mandatory)][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha,
    [Parameter(Mandatory)][string]$OperatorDeltaSha256,
    [Parameter(Mandatory)][ValidateSet("kms-prerequisite", "parser-dark", "complete-dark")][string]$DeploymentStage,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$StateLineage,
    [Parameter(Mandatory)][long]$StateSerial,
    [string]$ReceiptSha256 = "",
    [string]$ParserQualifiedArn = ""
  )

  $planSha256 = (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadataPath = "$PlanPath.baseline.json"
  $metadata = New-RetainedBaselineMetadata -ReleaseSourceSha $ReleaseSourceSha -OperatorSourceSha $OperatorSourceSha `
    -OperatorDeltaSha256 $OperatorDeltaSha256 -DeploymentStage $DeploymentStage `
    -PlanPath $PlanPath -PlanSha256 $planSha256 -StateLineage $StateLineage -StateSerial $StateSerial `
    -ReceiptSha256 $ReceiptSha256 -ParserQualifiedArn $ParserQualifiedArn
  Write-ExclusiveJsonFile -Path $metadataPath -Value $metadata
  $stored = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  Assert-RetainedBaselineMetadata -Metadata $stored -Expected @{
    SchemaVersion = "3"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
    AccountId = $ExpectedAccountId; Region = $Region; ReleaseSourceSha = $ReleaseSourceSha
    OperatorSourceSha = $OperatorSourceSha; OperatorDeltaSha256 = $OperatorDeltaSha256; StateLineage = $StateLineage
    StateSerial = $StateSerial; Stage = $DeploymentStage; ReceiptSha256 = $ReceiptSha256
    ParserQualifiedArn = $ParserQualifiedArn; PlanPath = $PlanPath; PlanSha256 = $planSha256
    Applyable = $false; MeaningfulChanges = 0
  }
  $metadataSha256 = (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
  return [pscustomobject]@{
    PlanPath = $PlanPath; PlanSha256 = $planSha256
    MetadataPath = $metadataPath; MetadataSha256 = $metadataSha256
  }
}

function Assert-RetainedBaselinePathsAvailable {
  param([Parameter(Mandatory)][string]$PlanPath, [Parameter(Mandatory)][string]$MetadataPath)
  if ((Test-Path -LiteralPath $PlanPath) -or (Test-Path -LiteralPath $MetadataPath)) {
    throw "Refusing to overwrite a document verification plan or retained-baseline sidecar."
  }
}

function Assert-StateIdentityStable {
  param([Parameter(Mandatory)][object]$Before, [Parameter(Mandatory)][object]$After)
  if ([string]$After.Lineage -cne [string]$Before.Lineage -or [long]$After.Serial -ne [long]$Before.Serial) {
    throw "Remote state lineage or serial changed while producing the retained zero-change baseline."
  }
}

function Remove-NewRetainedBaselineArtifacts {
  param([Parameter(Mandatory)][string]$PlanPath, [Parameter(Mandatory)][string]$MetadataPath)
  if (Test-Path -LiteralPath $MetadataPath) { Remove-Item -LiteralPath $MetadataPath -Force }
  if (Test-Path -LiteralPath $PlanPath) { Remove-Item -LiteralPath $PlanPath -Force }
}

function Get-DevelopmentDocumentBaselineShape {
  param(
    [Parameter(Mandatory)][object]$Variables,
    [Parameter(Mandatory)][string]$RequestedStage,
    [Parameter(Mandatory)][string]$AppliedStage,
    [Parameter(Mandatory)][ValidateSet("Plan", "Apply", "Verify", "Bootstrap")][string]$Operation
  )

  $legacyName = "document_processing_kms_prerequisite_enabled"
  $legacy = @($legacyBaselineVariableNames | Sort-Object -Unique)
  $legacyWithoutKms = @($legacy | Where-Object { $_ -cne $legacyName })
  $current = @($allowedVariableNames | Sort-Object -Unique)
  $actual = @($Variables.PSObject.Properties | ForEach-Object Name | Sort-Object -Unique)
  if (($actual -join "|") -ceq ($current -join "|")) { return "current" }
  $isInitialParserTransition = $RequestedStage -ceq "parser-dark" -and $AppliedStage -ceq "kms-prerequisite" -and
    $Operation -in @("Plan", "Apply")
  $isAppliedParserVerification = $RequestedStage -ceq "parser-dark" -and $AppliedStage -ceq "parser-dark" -and
    $Operation -ceq "Verify"
  if (-not $isInitialParserTransition -and -not $isAppliedParserVerification) {
    throw "A historical baseline is accepted only for the initial ParserDark transition or exact applied ParserDark verification."
  }
  if (($actual -join "|") -ceq ($legacy -join "|")) {
    $value = ConvertTo-ExactBoolean $Variables.PSObject.Properties[$legacyName].Value.value `
      "legacy KMS prerequisite switch"
    if (-not $value) { throw "The historical baseline does not prove the applied KMS prerequisite." }
    return "historical"
  }
  if (($actual -join "|") -ceq ($legacyWithoutKms -join "|")) {
    # The accepted intake baseline predates this short-lived legacy input. Exact current state is
    # independently required to prove the KMS prerequisite before ParserDark can plan or verify.
    return "historical"
  }
  throw "The reviewed baseline does not contain the exact approved development variable set."
}

function Assert-CurrentDocumentBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][string]$AppliedStage,
    [Parameter(Mandatory)][string]$ReceiptSha256,
    [Parameter(Mandatory)][object]$StateIdentity,
    [Parameter(Mandatory)][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha,
    [Parameter(Mandatory)][string]$OperatorDeltaSha256
  )

  $v1Keys = @(
    "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
    "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
    "SourceSha", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  $v2Keys = @($v1Keys + "MigrationImage" | Sort-Object)
  $v3Keys = @($v1Keys | Where-Object { $_ -cne "SourceSha" }) + @("OperatorDeltaSha256", "OperatorSourceSha", "ReleaseSourceSha") | Sort-Object
  $v4Keys = @($v3Keys + "MigrationImage" | Sort-Object)
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $schema = [string]$Metadata.SchemaVersion
  $expectedKeys = if ($schema -ceq "1") { $v1Keys } elseif ($schema -ceq "2") { $v2Keys } elseif ($schema -ceq "3") { $v3Keys } elseif ($schema -ceq "4") { $v4Keys } else { @() }
  if ($expectedKeys.Count -eq 0 -or ($actualKeys -join "|") -cne ($expectedKeys -join "|")) {
    throw "The current document baseline metadata has an unexpected schema."
  }
  $planParserPin = [string]$Baseline.variables.document_parser_invocation_qualified_arn.value
  $sourceBindingValid = if ($schema -in @("3", "4")) {
    [string]$Metadata.ReleaseSourceSha -ceq $ReleaseSourceSha -and
      [string]$Metadata.OperatorSourceSha -ceq $OperatorSourceSha -and
      [string]$Metadata.OperatorDeltaSha256 -ceq $OperatorDeltaSha256
  } else {
    [string]$Metadata.SourceSha -ceq $ReleaseSourceSha -and $ReleaseSourceSha -ceq $OperatorSourceSha
  }
  if ([string]$Metadata.Kind -cne "development-document-zero-drift-baseline" -or
    [string]$Metadata.Environment -cne "development" -or [string]$Metadata.AccountId -cne $ExpectedAccountId -or
    [string]$Metadata.Region -cne $Region -or -not $sourceBindingValid -or
    [string]$Metadata.Stage -cne $AppliedStage -or [string]$Metadata.ReceiptSha256 -cne $ReceiptSha256 -or
    [string]$Metadata.ParserQualifiedArn -cne $planParserPin -or
    [string]$Metadata.PlanPath -cne $ResolvedPlanPath -or [string]$Metadata.PlanSha256 -cne $PlanSha256 -or
    [string]$Metadata.StateLineage -cne [string]$StateIdentity.Lineage -or
    [long]$Metadata.StateSerial -ne [long]$StateIdentity.Serial -or
    $Metadata.Applyable -isnot [bool] -or $Metadata.Applyable -or [int]$Metadata.MeaningfulChanges -ne 0 -or
    $Metadata.CreatedAt -isnot [string] -or
    [string]$Metadata.CreatedAt -cnotmatch '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T') {
    throw "The current document baseline metadata does not match source, state, stage, receipt, or plan."
  }
  if ($schema -in @("2", "4")) {
    $migrationImage = [string]$Baseline.variables.migration_image.value
    if ([string]$Metadata.MigrationImage -cne $migrationImage -or
      $migrationImage -cnotmatch "^${ExpectedAccountId}\.dkr\.ecr\.us-east-2\.amazonaws\.com/ai-job-apply/migration@sha256:[a-f0-9]{64}$") {
      throw "The current document baseline metadata does not bind the exact migration image digest."
    }
  }
}

function Assert-CompleteDarkBootstrapBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$CurrentStateIdentity
  )
  $schema = [string]$Metadata.SchemaVersion
  if ($schema -notin @("3", "4", "5") -or [string]$Metadata.Stage -cne "complete-dark") {
    throw "Bootstrap requires a reviewed schema-3/4/5 CompleteDark baseline."
  }
  $createdAtValid = if ($Metadata.CreatedAt -is [datetime]) {
    $Metadata.CreatedAt.Year -ge 2000 -and $Metadata.CreatedAt.Year -le 2099
  } else { $Metadata.CreatedAt -is [string] -and [string]$Metadata.CreatedAt -match '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' }
  $metadataPath = if ([string]::IsNullOrWhiteSpace([string]$Metadata.PlanPath)) { "" } else {
    [IO.Path]::GetFullPath([string]$Metadata.PlanPath)
  }
  if ([string]$Metadata.Kind -cne "development-document-zero-drift-baseline" -or
    [string]$Metadata.Environment -cne "development" -or [string]$Metadata.AccountId -cne $ExpectedAccountId -or
    [string]$Metadata.Region -cne $Region -or $metadataPath -cne $ResolvedPlanPath -or
    [string]$Metadata.PlanSha256 -cne $PlanSha256 -or $Metadata.Applyable -isnot [bool] -or
    $Metadata.Applyable -or [int]$Metadata.MeaningfulChanges -ne 0 -or -not $createdAtValid -or
    [string]$Metadata.StateLineage -cnotmatch '^[a-f0-9-]{36}$' -or [long]$Metadata.StateSerial -lt 1 -or
    [string]$CurrentStateIdentity.Lineage -cne [string]$Metadata.StateLineage -or
    [long]$CurrentStateIdentity.Serial -le [long]$Metadata.StateSerial -or
    [string]$Metadata.ReceiptSha256 -cne $ReviewedReceiptSha256 -or
    [string]$Metadata.ParserQualifiedArn -cne [string]$Baseline.variables.document_parser_invocation_qualified_arn.value) {
    throw "The bootstrap baseline does not match its reviewed plan, historical state, receipt, or live lineage."
  }
  if ($schema -in @("3", "4")) {
    $expectedKeys = @(
      "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
      "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
      "OperatorDeltaSha256", "OperatorSourceSha", "ReleaseSourceSha", "Stage", "StateLineage", "StateSerial"
    )
    if ($schema -ceq "4") { $expectedKeys += "MigrationImage" }
    if ((@($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object) -join "|") -cne
      (@($expectedKeys | Sort-Object) -join "|") -or [string]$Metadata.ReleaseSourceSha -cne $releaseCommit) {
      throw "The schema-3/4 bootstrap metadata has an unexpected exact shape or release."
    }
    $stored = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
      -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256) `
      -DeltaKind Stored
    $toCurrent = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
      -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
    if ($stored -cne [string]$Metadata.OperatorDeltaSha256 -or [string]::IsNullOrWhiteSpace($toCurrent)) {
      throw "The schema-3/4 bootstrap source chain is not exact."
    }
    if ($schema -ceq "4" -and [string]$Metadata.MigrationImage -cne [string]$Baseline.variables.migration_image.value) {
      throw "The schema-4 bootstrap migration image does not match its reviewed plan."
    }
    return
  }

  $schemaFiveKeys = @(
    "AccountId", "Applyable", "BaselineToReleaseDeltaSha256", "CreatedAt",
    "DocumentOperatorDeltaSha256", "DocumentOperatorSourceSha", "DocumentReleaseSourceSha",
    "Environment", "Kind", "MeaningfulChanges", "MigrationImage", "OperatorDeltaSha256",
    "OperatorSourceSha", "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256",
    "Region", "ReleaseSourceSha", "SchemaVersion", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  if ((@($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object) -join "|") -cne
    ($schemaFiveKeys -join "|") -or [string]$Metadata.DocumentReleaseSourceSha -cne $releaseCommit -or
    [string]$Metadata.MigrationImage -cne [string]$Baseline.variables.migration_image.value) {
    throw "The schema-5 bootstrap metadata has an unexpected shape, document release, or migration image."
  }
  $documentDelta = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.DocumentReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.DocumentOperatorSourceSha) `
    -ReviewedSha256 ([string]$Metadata.DocumentOperatorDeltaSha256) -DeltaKind Stored
  $handoffDelta = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.DocumentOperatorSourceSha) `
    -OperatorSha ([string]$Metadata.ReleaseSourceSha) `
    -ReviewedSha256 ([string]$Metadata.BaselineToReleaseDeltaSha256) -DeltaKind Stored
  $migrationDelta = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256) `
    -DeltaKind Stored
  $toCurrent = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.DocumentOperatorSourceSha) `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
  if ($documentDelta -cne [string]$Metadata.DocumentOperatorDeltaSha256 -or
    $handoffDelta -cne [string]$Metadata.BaselineToReleaseDeltaSha256 -or
    $migrationDelta -cne [string]$Metadata.OperatorDeltaSha256 -or [string]::IsNullOrWhiteSpace($toCurrent)) {
    throw "The schema-5 bootstrap source chain is not exact."
  }
}

function Assert-CompleteDarkRefreshBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$StateIdentity
  )
  if ([string]$Metadata.SchemaVersion -ceq "6") {
    $keys = @(
      "AccountId", "Applyable", "CreatedAt", "DeltaKind", "Environment", "Kind", "MeaningfulChanges",
      "CurrentTemplatePlanSha256", "CurrentTemplateReceiptSha256", "MigrationImage",
      "OperatorDeltaSha256", "OperatorSourceSha", "ParserQualifiedArn", "PlanPath",
      "PlanSha256", "PriorBaselineMetadataSha256", "PriorBaselineOperatorSourceSha",
      "PriorBaselinePlanSha256", "PriorBaselineSchemaVersion", "PriorBaselineStateSerial",
      "PriorBaselineToOperatorDeltaSha256", "ReceiptSha256", "Region", "ReleaseSourceSha",
      "SchemaVersion", "Stage", "StateLineage", "StateSerial"
    ) | Sort-Object
    if ((@($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object) -join "|") -cne ($keys -join "|") -or
      [string]$Metadata.Kind -cne "development-document-zero-drift-baseline" -or
      [string]$Metadata.DeltaKind -cne "complete-dark-bootstrap-full-source-v1" -or
      [string]$Metadata.Environment -cne "development" -or [string]$Metadata.AccountId -cne $ExpectedAccountId -or
      [string]$Metadata.Region -cne $Region -or [string]$Metadata.Stage -cne "complete-dark" -or
      [string]$Metadata.OperatorSourceSha -cne $operatorCommit -or
      [string]$Metadata.ReceiptSha256 -ceq $ReviewedReceiptSha256 -or
      [string]$Metadata.CurrentTemplatePlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Metadata.CurrentTemplateReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Metadata.PlanPath -cne $ResolvedPlanPath -or [string]$Metadata.PlanSha256 -cne $PlanSha256 -or
      [string]$Metadata.StateLineage -cne [string]$StateIdentity.Lineage -or
      [long]$Metadata.StateSerial -ne [long]$StateIdentity.Serial -or
      [string]$Metadata.ParserQualifiedArn -cne [string]$Baseline.variables.document_parser_invocation_qualified_arn.value -or
      [string]$Metadata.MigrationImage -cne [string]$Baseline.variables.migration_image.value -or
      $Metadata.Applyable -isnot [bool] -or $Metadata.Applyable -or [int]$Metadata.MeaningfulChanges -ne 0 -or
      [string]$Metadata.PriorBaselineSchemaVersion -notin @("3", "4", "5") -or
      [long]$Metadata.PriorBaselineStateSerial -ge [long]$Metadata.StateSerial -or
      [string]$Metadata.PriorBaselinePlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Metadata.PriorBaselineMetadataSha256 -cnotmatch '^[a-f0-9]{64}$') {
      throw "The schema-6 CompleteDark bootstrap baseline is not exact or current."
    }
    $releaseDelta = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
      -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256)
    $priorDelta = Get-ReviewedBootstrapDelta -ReleaseSha ([string]$Metadata.PriorBaselineOperatorSourceSha) `
      -OperatorSha ([string]$Metadata.OperatorSourceSha) `
      -ReviewedSha256 ([string]$Metadata.PriorBaselineToOperatorDeltaSha256)
    if ($releaseDelta -cne [string]$Metadata.OperatorDeltaSha256 -or
      $priorDelta -cne [string]$Metadata.PriorBaselineToOperatorDeltaSha256) {
      throw "The schema-6 CompleteDark bootstrap deltas are not exact."
    }
    return
  }
  if ([string]$Metadata.SchemaVersion -notin @("3", "4") -or
    [string]$Metadata.Stage -cne "complete-dark" -or
    [string]$Metadata.ReceiptSha256 -ceq $ReviewedReceiptSha256) {
    throw "A current CompleteDark refresh requires a distinct retained schema-3/4/6 CompleteDark baseline."
  }
  $storedDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256)
  $currentDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
  if ($storedDelta -cne [string]$Metadata.OperatorDeltaSha256 -or
    $currentDelta -cne $(Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
      -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256)) {
    throw "The CompleteDark refresh baseline source bindings are not exact."
  }
  Assert-CurrentDocumentBaselineMetadata -Metadata $Metadata -Baseline $Baseline `
    -ResolvedPlanPath $ResolvedPlanPath -PlanSha256 $PlanSha256 -AppliedStage "complete-dark" `
    -ReceiptSha256 ([string]$Metadata.ReceiptSha256) -StateIdentity $StateIdentity `
    -ReleaseSourceSha ([string]$Metadata.ReleaseSourceSha) -OperatorSourceSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorDeltaSha256 ([string]$Metadata.OperatorDeltaSha256)
}

function Read-ParserRefreshReceipt {
  $resolved = Resolve-InputPath -Candidate $ParserRefreshReceiptPath -MustExist
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -cne $ReviewedParserRefreshReceiptSha256) { throw "The parser-refresh receipt checksum does not match review." }
  $evidence = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $resolved -Raw)
  $expectedKeys = @(
    "AccountId", "AfterStateSerial", "BaselineMetadataSha256", "BaselineReceiptSha256",
    "BaselineSha256", "BeforeStateSerial", "CreatedAt", "Environment", "Kind",
    "OperatorSourceSha", "ParserArtifactBase64Sha256", "ParserArtifactSha256",
    "ParserPlanSha256", "ParserQualifiedArn", "Region", "ReleaseSourceSha", "SchemaVersion",
    "StateLineage", "TargetReceiptSha256"
  ) | Sort-Object
  if ((@($evidence.PSObject.Properties | ForEach-Object Name | Sort-Object) -join "|") -cne ($expectedKeys -join "|") -or
    [string]$evidence.SchemaVersion -cne "1" -or
    [string]$evidence.Kind -cne "development-document-complete-dark-parser-refresh" -or
    [string]$evidence.Environment -cne "development" -or [string]$evidence.AccountId -cne $ExpectedAccountId -or
    [string]$evidence.Region -cne $Region -or [string]$evidence.ReleaseSourceSha -cne $releaseCommit -or
    [string]$evidence.OperatorSourceSha -cne $operatorCommit -or
    [string]$evidence.BaselineSha256 -cne $ReviewedBaselineSha256 -or
    [string]$evidence.BaselineMetadataSha256 -cne $ReviewedBaselineMetadataSha256 -or
    [string]$evidence.TargetReceiptSha256 -cne $ReviewedReceiptSha256 -or
    [string]$evidence.ParserQualifiedArn -cnotmatch "^arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" -or
    [string]$evidence.ParserArtifactSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$evidence.ParserArtifactBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
    [string]$evidence.StateLineage -cnotmatch '^[a-f0-9-]{36}$' -or
    [long]$evidence.AfterStateSerial -le [long]$evidence.BeforeStateSerial -or
    [string]$evidence.ParserPlanSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw "The parser-refresh receipt does not match the exact reviewed source, baseline, receipt, and state transition."
  }
  $parserArtifact = @($script:currentReceipt.artifacts | Where-Object { $_.artifactName -ceq "document-parser-lambda" -and $_.suffix -ceq "zip" })
  if ($parserArtifact.Count -ne 1 -or [string]$evidence.ParserArtifactSha256 -cne [string]$parserArtifact[0].artifactSha256 -or
    [string]$evidence.ParserArtifactBase64Sha256 -cne [string]$parserArtifact[0].objectBase64Sha256) {
    throw "The parser-refresh receipt does not bind the exact current parser artifact."
  }
  return $evidence
}

function ConvertFrom-DocumentBaselineJson {
  param([Parameter(Mandatory)][string]$Json)

  $convertFromJson = Get-Command ConvertFrom-Json -CommandType Cmdlet
  if ($convertFromJson.Parameters.ContainsKey("DateKind")) {
    return ConvertFrom-Json -InputObject $Json -DateKind String
  }
  return ConvertFrom-Json -InputObject $Json
}

function Assert-CompleteDarkTransitionBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$StateIdentity
  )

  if ([string]$Metadata.SchemaVersion -notin @("3", "4") -or
    [string]$Metadata.Stage -cne "parser-dark" -or
    [string]$Metadata.ReleaseSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
    [string]$Metadata.OperatorSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
    [string]$Metadata.OperatorDeltaSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Metadata.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Metadata.ReceiptSha256 -ceq $ReviewedReceiptSha256 -or
    [string]$Metadata.ReleaseSourceSha -ceq $operatorCommit) {
    throw "A CompleteDark parser source transition requires an ancestor-release schema-3/4 ParserDark baseline and a distinct exact-current receipt."
  }
  $null = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256)
  $null = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
  Assert-CurrentDocumentBaselineMetadata -Metadata $Metadata -Baseline $Baseline `
    -ResolvedPlanPath $ResolvedPlanPath -PlanSha256 $PlanSha256 -AppliedStage "parser-dark" `
    -ReceiptSha256 ([string]$Metadata.ReceiptSha256) -StateIdentity $StateIdentity `
    -ReleaseSourceSha ([string]$Metadata.ReleaseSourceSha) -OperatorSourceSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorDeltaSha256 ([string]$Metadata.OperatorDeltaSha256)

  $artifactSha = [string]$Baseline.variables.document_parser_artifact_sha256.value
  if ([string]$Baseline.variables.document_parser_artifact_s3_key.value -cne
      "lambda/documents/$([string]$Metadata.ReleaseSourceSha)/$artifactSha/document-parser-lambda.zip" -or
    [string]$Baseline.variables.document_parser_artifact_s3_object_version.value -eq "" -or
    $artifactSha -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Baseline.variables.document_parser_artifact_base64sha256.value -cnotmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The source-transition baseline parser artifact is not bound to its retained release."
  }
}

function Assert-CompleteDarkVerifyRecoveryBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$CurrentStateIdentity,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$RequestedStage,
    [Parameter(Mandatory)][string]$AppliedStage,
    [Parameter(Mandatory)][ValidateSet("Plan", "Apply", "Verify", "Bootstrap")][string]$Operation
  )

  if ($Operation -cne "Verify" -or $RequestedStage -cne "complete-dark" -or $AppliedStage -cne "complete-dark" -or
    [string]$Metadata.SchemaVersion -notin @("3", "4") -or [string]$Metadata.Stage -cne "parser-dark") {
    throw "The historical ParserDark recovery baseline is accepted only for exact applied CompleteDark Verify."
  }
  if ($releaseCommit -cne $completeDarkRecoveryReleaseSourceSha -or
    $ReviewedReceiptSha256 -cne $completeDarkRecoveryReceiptSha256 -or
    [string]$Metadata.ReleaseSourceSha -cne $completeDarkRecoveryBaselineReleaseSourceSha -or
    [string]$Metadata.OperatorSourceSha -cne $completeDarkRecoveryBaselineOperatorSourceSha -or
    [string]$Metadata.ReceiptSha256 -cne $completeDarkRecoveryBaselineReceiptSha256 -or
    [string]$Metadata.StateLineage -cne $completeDarkRecoveryStateLineage -or
    [long]$Metadata.StateSerial -ne $completeDarkRecoveryBaselineStateSerial -or
    [string]$CurrentStateIdentity.Lineage -cne $completeDarkRecoveryStateLineage -or
    [long]$CurrentStateIdentity.Serial -ne $completeDarkRecoveryCurrentStateSerial) {
    throw "CompleteDark Verify recovery does not match the exact retained and current release/state boundary."
  }

  $storedDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.OperatorSourceSha) -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256)
  $baselineToCurrentDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
  $releaseToCurrentDelta = Get-ReviewedOperatorDelta -ReleaseSha $releaseCommit `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedOperatorDeltaSha256
  if ($storedDelta -cne [string]$Metadata.OperatorDeltaSha256 -or
    $baselineToCurrentDelta -cne $ReviewedBaselineToOperatorDeltaSha256 -or
    $releaseToCurrentDelta -cne $operatorDeltaSha256) {
    throw "CompleteDark Verify recovery does not match all three exact operator-delta bindings."
  }

  $baselineStateIdentity = [pscustomobject]@{
    Lineage = [string]$CurrentStateIdentity.Lineage
    Serial = $completeDarkRecoveryBaselineStateSerial
  }
  Assert-CurrentDocumentBaselineMetadata -Metadata $Metadata -Baseline $Baseline `
    -ResolvedPlanPath $ResolvedPlanPath -PlanSha256 $PlanSha256 -AppliedStage "parser-dark" `
    -ReceiptSha256 ([string]$Metadata.ReceiptSha256) -StateIdentity $baselineStateIdentity `
    -ReleaseSourceSha ([string]$Metadata.ReleaseSourceSha) -OperatorSourceSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorDeltaSha256 ([string]$Metadata.OperatorDeltaSha256)

  if (-not [string]::IsNullOrEmpty([string]$Baseline.variables.document_parser_invocation_qualified_arn.value)) {
    throw "CompleteDark Verify recovery requires the exact empty ParserDark baseline pin."
  }
  $baselineParserArtifactSha = [string]$Baseline.variables.document_parser_artifact_sha256.value
  if ([string]$Baseline.variables.document_parser_artifact_s3_key.value -cne
      "lambda/documents/$completeDarkRecoveryBaselineReleaseSourceSha/$baselineParserArtifactSha/document-parser-lambda.zip" -or
    [string]$Baseline.variables.document_parser_artifact_s3_object_version.value -eq "" -or
    $baselineParserArtifactSha -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$Baseline.variables.document_parser_artifact_base64sha256.value -cnotmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "CompleteDark Verify recovery does not bind the exact retained ParserDark parser artifact."
  }
  foreach ($name in @(
      "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
      "document_processor_artifact_sha256", "document_processor_artifact_base64sha256",
      "document_processor_extension_layer_arn"
    )) {
    if (-not [string]::IsNullOrEmpty([string]$Baseline.variables.PSObject.Properties[$name].Value.value)) {
      throw "CompleteDark Verify recovery baseline contains a CompleteDark artifact input."
    }
  }
  foreach ($artifactName in @("document-parser-lambda", "document-processor-lambda")) {
    $artifact = @($Receipt.artifacts | Where-Object { $_.artifactName -ceq $artifactName -and $_.suffix -ceq "zip" })
    if ($artifact.Count -ne 1 -or [string]$artifact[0].key -cnotmatch
      "^lambda/documents/$completeDarkRecoveryReleaseSourceSha/[a-f0-9]{64}/$artifactName\.zip$") {
      throw "CompleteDark Verify recovery receipt does not bind the exact current document artifacts."
    }
  }
}

function Assert-CompleteDarkAppliedGatewayRecoveryBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$CurrentStateIdentity,
    [Parameter(Mandatory)][string]$RequestedStage,
    [Parameter(Mandatory)][string]$AppliedStage,
    [Parameter(Mandatory)][ValidateSet("Plan", "Apply", "Verify", "Bootstrap")][string]$Operation
  )

  if (-not $appliedGatewayRecoveryRequested -or $Operation -cne "Verify" -or
    $RequestedStage -cne "complete-dark" -or $AppliedStage -cne "complete-dark" -or
    [string]$Metadata.SchemaVersion -notin @("3", "4") -or [string]$Metadata.Stage -cne "complete-dark") {
    throw "Already-applied gateway recovery is accepted only for exact applied CompleteDark Verify."
  }
  if ($releaseCommit -cne $appliedGatewayRecoveryReleaseSourceSha -or
    $ReviewedReceiptSha256 -cne $appliedGatewayRecoveryDocumentReceiptSha256 -or
    $PlanSha256 -cne $appliedGatewayRecoveryBaselineSha256 -or
    $ReviewedBaselineSha256 -cne $appliedGatewayRecoveryBaselineSha256 -or
    $ReviewedBaselineMetadataSha256 -cne $appliedGatewayRecoveryBaselineMetadataSha256 -or
    [string]$Metadata.ReleaseSourceSha -cne $appliedGatewayRecoveryReleaseSourceSha -or
    [string]$Metadata.OperatorSourceSha -cne $appliedGatewayRecoveryBaselineOperatorSourceSha -or
    [string]$Metadata.OperatorDeltaSha256 -cne $appliedGatewayRecoveryBaselineOperatorDeltaSha256 -or
    [string]$Metadata.ReceiptSha256 -cne $appliedGatewayRecoveryDocumentReceiptSha256 -or
    [string]$Metadata.StateLineage -cne $appliedGatewayRecoveryStateLineage -or
    [long]$Metadata.StateSerial -ne $appliedGatewayRecoveryBaselineStateSerial -or
    [string]$Metadata.ParserQualifiedArn -cne $appliedGatewayRecoveryParserQualifiedArn -or
    [string]$CurrentStateIdentity.Lineage -cne $appliedGatewayRecoveryStateLineage -or
    [long]$CurrentStateIdentity.Serial -ne $appliedGatewayRecoveryCurrentStateSerial) {
    throw "Already-applied gateway recovery does not match the exact retained/current release and state boundary."
  }

  $storedDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.ReleaseSourceSha) `
    -OperatorSha ([string]$Metadata.OperatorSourceSha) `
    -ReviewedSha256 ([string]$Metadata.OperatorDeltaSha256)
  $baselineToCurrentDelta = Get-ReviewedOperatorDelta -ReleaseSha ([string]$Metadata.OperatorSourceSha) `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedBaselineToOperatorDeltaSha256
  $releaseToCurrentDelta = Get-ReviewedOperatorDelta -ReleaseSha $releaseCommit `
    -OperatorSha $operatorCommit -ReviewedSha256 $ReviewedOperatorDeltaSha256
  if ($storedDelta -cne $appliedGatewayRecoveryBaselineOperatorDeltaSha256 -or
    $baselineToCurrentDelta -cne $ReviewedBaselineToOperatorDeltaSha256 -or
    $releaseToCurrentDelta -cne $operatorDeltaSha256) {
    throw "Already-applied gateway recovery does not match all exact operator-delta bindings."
  }

  $baselineStateIdentity = [pscustomobject]@{
    Lineage = $appliedGatewayRecoveryStateLineage
    Serial = $appliedGatewayRecoveryBaselineStateSerial
  }
  Assert-CurrentDocumentBaselineMetadata -Metadata $Metadata -Baseline $Baseline `
    -ResolvedPlanPath $ResolvedPlanPath -PlanSha256 $PlanSha256 -AppliedStage "complete-dark" `
    -ReceiptSha256 $appliedGatewayRecoveryDocumentReceiptSha256 -StateIdentity $baselineStateIdentity `
    -ReleaseSourceSha $appliedGatewayRecoveryReleaseSourceSha `
    -OperatorSourceSha $appliedGatewayRecoveryBaselineOperatorSourceSha `
    -OperatorDeltaSha256 $appliedGatewayRecoveryBaselineOperatorDeltaSha256
  if ([string]$Baseline.variables.document_parser_invocation_qualified_arn.value -cne
    $appliedGatewayRecoveryParserQualifiedArn -or
    [string]$Baseline.variables.migration_image.value -cne $appliedGatewayRecoveryMigrationImage) {
    throw "Already-applied gateway recovery baseline does not preserve the exact parser or migration pin."
  }
}

function Assert-AppliedGatewayRecoveryPlanMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][string]$ResolvedPlanPath,
    [Parameter(Mandatory)][string]$ResolvedBaselinePath,
    [Parameter(Mandatory)][string]$ResolvedBaselineMetadataPath,
    [Parameter(Mandatory)][string]$ResolvedReceiptPath
  )

  $expectedKeys = @(
    "AccountId", "BaselineDocumentReceiptSha256", "BaselineMetadataPath",
    "BaselineMetadataSchemaVersion", "BaselineMetadataSha256", "BaselineMigrationImage",
    "BaselineParserQualifiedArn", "BaselinePath", "BaselineSha256", "BaselineStage",
    "BaselineStateLineage", "BaselineStateSerial", "ChangedResources", "CreatedAt",
    "Environment", "Kind", "MigrationImage", "PlanPath", "PlanSha256", "ReceiptSha256",
    "Region", "SchemaVersion", "SourceSha", "StateBucket", "StateKey", "StateLineage",
    "StateSerial"
  ) | Sort-Object
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $createdAt = [datetime]::MinValue
  $createdAtValid = [datetime]::TryParse([string]$Metadata.CreatedAt, [ref]$createdAt) -and
    $createdAt.Year -ge 2000 -and $createdAt.Year -le 2099
  $expectedChanges = @(
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  ) | Sort-Object
  $actualChanges = @($Metadata.ChangedResources | ForEach-Object { [string]$_ } | Sort-Object)
  if (($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
    [string]$Metadata.SchemaVersion -cne "1" -or
    [string]$Metadata.Kind -cne "development-gateway-release-plan" -or
    [string]$Metadata.Environment -cne "development" -or
    [string]$Metadata.AccountId -cne $ExpectedAccountId -or [string]$Metadata.Region -cne $Region -or
    [string]$Metadata.StateBucket -cne $StateBucket -or [string]$Metadata.StateKey -cne "platform.tfstate" -or
    [string]$Metadata.StateLineage -cne $appliedGatewayRecoveryStateLineage -or
    [long]$Metadata.StateSerial -ne $appliedGatewayRecoveryBaselineStateSerial -or
    [string]$Metadata.SourceSha -cne $appliedGatewayRecoveryBaselineOperatorSourceSha -or
    [string]$Metadata.ReceiptSha256 -cne $appliedGatewayRecoveryReceiptSha256 -or
    [IO.Path]::GetFullPath([string]$Metadata.BaselinePath) -cne $ResolvedBaselinePath -or
    [string]$Metadata.BaselineSha256 -cne $appliedGatewayRecoveryBaselineSha256 -or
    [IO.Path]::GetFullPath([string]$Metadata.BaselineMetadataPath) -cne $ResolvedBaselineMetadataPath -or
    [string]$Metadata.BaselineMetadataSha256 -cne $appliedGatewayRecoveryBaselineMetadataSha256 -or
    [string]$Metadata.BaselineMetadataSchemaVersion -cne "3" -or
    [string]$Metadata.BaselineStage -cne "complete-dark" -or
    [string]$Metadata.BaselineParserQualifiedArn -cne $appliedGatewayRecoveryParserQualifiedArn -or
    [string]$Metadata.BaselineDocumentReceiptSha256 -cne $appliedGatewayRecoveryDocumentReceiptSha256 -or
    [string]$Metadata.BaselineStateLineage -cne $appliedGatewayRecoveryStateLineage -or
    [long]$Metadata.BaselineStateSerial -ne $appliedGatewayRecoveryBaselineStateSerial -or
    [string]$Metadata.BaselineMigrationImage -cne $appliedGatewayRecoveryMigrationImage -or
    [string]$Metadata.MigrationImage -cne $appliedGatewayRecoveryMigrationImage -or
    [IO.Path]::GetFullPath([string]$Metadata.PlanPath) -cne $ResolvedPlanPath -or
    [string]$Metadata.PlanSha256 -cne $appliedGatewayRecoveryPlanSha256 -or
    ($actualChanges -join "|") -cne ($expectedChanges -join "|") -or -not $createdAtValid) {
    throw "The already-applied gateway plan metadata does not match the exact recovery boundary."
  }
  if ([IO.Path]::GetFullPath($ResolvedReceiptPath) -cne
    [IO.Path]::GetFullPath($AppliedGatewayReceiptPath)) {
    throw "The already-applied gateway receipt path does not match its reviewed recovery input."
  }
}

function Assert-AppliedGatewayRecoveryStateAndLive {
  param(
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)][object]$Artifact
  )

  $functionAddress = "module.platform.aws_lambda_function.gateway[0]"
  $aliasAddress = "module.platform.aws_lambda_alias.gateway[0]"
  if (-not $State.ContainsKey($functionAddress) -or -not $State.ContainsKey($aliasAddress)) {
    throw "Current state does not contain the exact applied gateway function and alias."
  }
  $function = $State[$functionAddress]
  $alias = $State[$aliasAddress]
  $environmentProperty = $function.PSObject.Properties["environment"]
  $rawEnvironment = $null
  if ($null -ne $environmentProperty) { $rawEnvironment = $environmentProperty.Value }
  if ($rawEnvironment -isnot [array] -or $rawEnvironment.Count -ne 1 -or
    $null -eq $rawEnvironment[0]) {
    throw "Current state contains an invalid gateway function environment block shape."
  }
  $environment = $rawEnvironment[0]
  if ($environment.GetType() -ne [System.Management.Automation.PSCustomObject]) {
    throw "Current state contains an invalid gateway function environment block shape."
  }
  $variablesProperty = $environment.PSObject.Properties["variables"]
  if ($null -eq $variablesProperty -or $null -eq $variablesProperty.Value -or
    $variablesProperty.Value.GetType() -ne [System.Management.Automation.PSCustomObject]) {
    throw "Current state contains an invalid gateway function environment variable shape."
  }
  $releaseShaProperty = $variablesProperty.Value.PSObject.Properties["RELEASE_SHA"]
  if ($null -eq $releaseShaProperty -or
    $releaseShaProperty.MemberType -ne [Management.Automation.PSMemberTypes]::NoteProperty -or
    $null -eq $releaseShaProperty.Value -or $releaseShaProperty.Value.GetType() -ne [string] -or
    $releaseShaProperty.Value -cne $Artifact.artifactSha256) {
    throw "Current state does not contain the exact applied gateway release SHA."
  }
  $stateRouting = Get-GatewayOptionalProperty -Object $alias -Name "routing_config"
  $routing = @($stateRouting | Where-Object { $null -ne $_ })
  if ([string]$function.s3_key -cne [string]$Artifact.key -or
    [string]$function.s3_object_version -cne [string]$Artifact.versionId -or
    [string]$function.source_code_hash -cne [string]$Artifact.objectBase64Sha256 -or
    [string]$alias.function_version -cnotmatch '^[1-9][0-9]*$' -or $routing.Count -ne 0) {
    throw "Current state does not match the exact already-applied gateway artifact and immutable alias."
  }

  $liveAlias = Invoke-AwsJson @("lambda", "get-alias", "--function-name",
    "ai-job-apply-development-gateway", "--name", "development", "--output", "json")
  $liveFunction = Invoke-AwsJson @("lambda", "get-function", "--function-name",
    "ai-job-apply-development-gateway:development", "--output", "json")
  $liveRouting = Get-GatewayOptionalProperty -Object $liveAlias -Name "RoutingConfig"
  $additionalWeights = Get-GatewayOptionalProperty -Object $liveRouting -Name "AdditionalVersionWeights"
  $weights = @($(if ($null -ne $additionalWeights) { $additionalWeights.PSObject.Properties }))
  if ([string]$liveAlias.FunctionVersion -cne [string]$alias.function_version -or $weights.Count -ne 0 -or
    [string]$liveFunction.Configuration.Version -cne [string]$alias.function_version -or
    [string]$liveFunction.Configuration.CodeSha256 -cne [string]$Artifact.objectBase64Sha256 -or
    [string]$liveFunction.Configuration.Environment.Variables.RELEASE_SHA -cne [string]$Artifact.artifactSha256 -or
    [string]$liveFunction.Configuration.State -cne "Active" -or
    [string]$liveFunction.Configuration.LastUpdateStatus -cne "Successful") {
    throw "The live gateway alias does not match the exact already-applied artifact and state."
  }
}

function Read-AppliedGatewayRecovery {
  param(
    [Parameter(Mandatory)][object]$Baseline,
    [Parameter(Mandatory)][string]$ResolvedBaselinePath,
    [Parameter(Mandatory)][object]$CurrentStateIdentity
  )

  $gatewayRoot = Join-Path $terraformDataRoot "development-gateway-release"
  $expectedPlanPath = [IO.Path]::GetFullPath((Join-Path $gatewayRoot `
      "release-b4bfb38ddb87-20260814-212945-9988984754ae4828ba6506e17c1cfe34.tfplan"))
  $expectedReceiptPath = [IO.Path]::GetFullPath((Join-Path $gatewayRoot `
      "receipt-b4bfb38ddb87-20260814-212048.json"))
  $planPath = Resolve-InputPath -Candidate $AppliedGatewayPlanPath -MustExist
  $receiptPath = Resolve-InputPath -Candidate $AppliedGatewayReceiptPath -MustExist
  $metadataPath = "$planPath.gateway-release.json"
  $baselineMetadataPath = "$ResolvedBaselinePath.baseline.json"
  if ($planPath -cne $expectedPlanPath -or $receiptPath -cne $expectedReceiptPath -or
    -not (Test-Path -LiteralPath $metadataPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $baselineMetadataPath -PathType Leaf) -or
    $ReviewedAppliedGatewayPlanSha256 -cne $appliedGatewayRecoveryPlanSha256 -or
    $ReviewedAppliedGatewayPlanMetadataSha256 -cne $appliedGatewayRecoveryPlanMetadataSha256 -or
    $ReviewedAppliedGatewayReceiptSha256 -cne $appliedGatewayRecoveryReceiptSha256 -or
    (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $ReviewedAppliedGatewayPlanSha256 -or
    (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $ReviewedAppliedGatewayPlanMetadataSha256 -or
    (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $ReviewedAppliedGatewayReceiptSha256) {
    throw "An already-applied gateway recovery artifact path or checksum does not match the exact reviewed evidence."
  }

  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  Assert-AppliedGatewayRecoveryPlanMetadata -Metadata $metadata -ResolvedPlanPath $planPath `
    -ResolvedBaselinePath $ResolvedBaselinePath -ResolvedBaselineMetadataPath $baselineMetadataPath `
    -ResolvedReceiptPath $receiptPath
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $boundary = Get-BoundaryValues
  $boundarySha256 = Get-TextSha256 "$ExpectedAccountId|$Region|$($boundary.ArtifactBucket)|$($boundary.PlatformKmsArn)"
  $artifact = Assert-GatewayPublicationReceipt -Receipt $receipt `
    -SourceSha $appliedGatewayRecoveryBaselineOperatorSourceSha -BoundarySha256 $boundarySha256
  foreach ($entry in @($receipt.artifacts)) {
    $stored = Invoke-AwsJson @("s3api", "head-object", "--bucket", $boundary.ArtifactBucket,
      "--key", [string]$entry.key, "--version-id", [string]$entry.versionId,
      "--checksum-mode", "ENABLED", "--output", "json")
    if ([string]$stored.VersionId -cne [string]$entry.versionId -or
      [long]$stored.ContentLength -ne [long]$entry.contentLength -or
      [string]$stored.ChecksumSHA256 -cne [string]$entry.objectBase64Sha256 -or
      [string]$stored.ServerSideEncryption -cne "aws:kms" -or
      [string]$stored.SSEKMSKeyId -cne [string]$boundary.PlatformKmsArn -or
      -not $stored.BucketKeyEnabled -or
      [string]$stored.Metadata."source-sha" -cne $appliedGatewayRecoveryBaselineOperatorSourceSha -or
      [string]$stored.Metadata."artifact-sha256" -cne [string]$entry.artifactSha256) {
      throw "An already-applied gateway publication object failed exact-version readback."
    }
  }

  $plan = Read-Plan -Path $planPath
  $expectedMigrationRepository = "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration"
  $null = Assert-GatewayReleaseVariables -BaselineVariables $Baseline.variables `
    -ReleaseVariables $plan.variables -Artifact $artifact -ExpectedAccountId $ExpectedAccountId `
    -ExpectedMigrationRepositoryUrl $expectedMigrationRepository `
    -ExpectedParserQualifiedArn $appliedGatewayRecoveryParserQualifiedArn
  $null = Assert-ExactGatewayReleasePlan -Plan $plan -Artifact $artifact
  if ([string]$CurrentStateIdentity.Lineage -cne [string]$metadata.StateLineage -or
    [long]$CurrentStateIdentity.Serial -ne ([long]$metadata.StateSerial + 1)) {
    throw "The already-applied gateway recovery state is not the exact reviewed serial plus one."
  }
  Assert-AppliedGatewayRecoveryStateAndLive -State (Get-StateResourceMap) -Artifact $artifact
  return [pscustomobject]@{ Plan = $plan; Metadata = $metadata; Receipt = $receipt; Artifact = $artifact }
}

function Assert-BaselineBooleanVariables {
  param([Parameter(Mandatory)][object]$Variables, [switch]$AllowMissing)
  foreach ($name in @(Get-DevelopmentDocumentBooleanVariableNames)) {
    $property = $Variables.PSObject.Properties[$name]
    if ($null -eq $property) {
      if ($AllowMissing) { continue }
      throw "The current retained baseline is missing boolean variable '$name'."
    }
    $valueProperty = $property.Value.PSObject.Properties["value"]
    if ($null -eq $valueProperty) { throw "Baseline variable '$name' has no saved-plan value." }
    $null = ConvertTo-ExactBoolean $valueProperty.Value "baseline $name"
  }
}

function Read-Baseline {
  param(
    [Parameter(Mandatory)][string]$RequestedStage,
    [Parameter(Mandatory)][string]$AppliedStage,
    [Parameter(Mandatory)][ValidateSet("Plan", "Apply", "Verify", "Bootstrap")][string]$Operation,
    [AllowNull()][object]$Receipt
  )
  $resolved = Resolve-InputPath -Candidate $BaselinePlanPath -MustExist
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -cne $ReviewedBaselineSha256) { throw "The zero-change baseline checksum does not match review." }
  $baseline = Read-Plan -Path $resolved
  $changes = @($baseline.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" })
  if ($changes.Count -ne 0 -or [string]$baseline.terraform_version -cne "1.9.8") {
    throw "The reviewed baseline is not a Terraform 1.9.8 zero-change plan."
  }
  $schemaSixBootstrapBaseline = $false
  if (($completeDarkParserRefresh -or $completeDarkProcessorRefresh) -and
    -not [string]::IsNullOrWhiteSpace($ReviewedBaselineMetadataSha256)) {
    $candidateMetadataPath = "$resolved.baseline.json"
    if (Test-Path -LiteralPath $candidateMetadataPath -PathType Leaf) {
      $candidateMetadataSha = (Get-FileHash -LiteralPath $candidateMetadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($candidateMetadataSha -ceq $ReviewedBaselineMetadataSha256) {
        $candidateMetadata = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $candidateMetadataPath -Raw)
        $schemaSixBootstrapBaseline = [string]$candidateMetadata.SchemaVersion -ceq "6"
      }
    }
  }
  $shape = if ($Operation -ceq "Bootstrap") { "bootstrap" } elseif ($schemaSixBootstrapBaseline) {
    "bootstrap-current"
  } else {
    Get-DevelopmentDocumentBaselineShape -Variables $baseline.variables `
      -RequestedStage $RequestedStage -AppliedStage $AppliedStage -Operation $Operation
  }
  if ($shape -in @("current", "bootstrap", "bootstrap-current")) {
    if ($AppliedStage -notin @("parser-dark", "complete-dark") -or $null -eq $Receipt) {
      throw "A current-shape retained baseline requires an applied document runtime and verified receipt."
    }
    Assert-BaselineBooleanVariables -Variables $baseline.variables -AllowMissing:($Operation -ceq "Bootstrap")
    $parser = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })
    $processor = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-processor-lambda" -and $_.suffix -eq "zip" })
    $metadataPath = "$resolved.baseline.json"
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
      throw "A current-shape retained baseline requires its adjacent metadata sidecar."
    }
    if ([string]::IsNullOrWhiteSpace($ReviewedBaselineMetadataSha256)) {
      throw "A current-shape retained baseline requires its reviewed metadata SHA-256."
    }
    $metadataSha256 = (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($metadataSha256 -cne $ReviewedBaselineMetadataSha256) {
      throw "The retained baseline metadata checksum does not match review."
    }
    $metadata = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $metadataPath -Raw)
    $completeDarkVerifyRecovery = $Operation -ceq "Verify" -and $RequestedStage -ceq "complete-dark" -and
      $AppliedStage -ceq "complete-dark" -and [string]$metadata.SchemaVersion -in @("3", "4") -and
      [string]$metadata.Stage -ceq "parser-dark"
    $completeDarkAppliedGatewayRecovery = $appliedGatewayRecoveryRequested -and
      $Operation -ceq "Verify" -and $RequestedStage -ceq "complete-dark" -and
      $AppliedStage -ceq "complete-dark" -and [string]$metadata.SchemaVersion -in @("3", "4") -and
      [string]$metadata.Stage -ceq "complete-dark"
    if ($appliedGatewayRecoveryRequested -and -not $completeDarkAppliedGatewayRecovery) {
      throw "Already-applied gateway inputs require the exact accepted CompleteDark recovery baseline."
    }
    $parserArtifactDiffersFromReceipt =
      [string]$baseline.variables.document_parser_artifact_s3_key.value -cne [string]$parser[0].key -or
      [string]$baseline.variables.document_parser_artifact_s3_object_version.value -cne [string]$parser[0].versionId -or
      [string]$baseline.variables.document_parser_artifact_sha256.value -cne [string]$parser[0].artifactSha256 -or
      [string]$baseline.variables.document_parser_artifact_base64sha256.value -cne [string]$parser[0].objectBase64Sha256
    $processorArtifactDiffersFromReceipt =
      [string]$baseline.variables.document_processor_artifact_s3_key.value -cne [string]$processor[0].key -or
      [string]$baseline.variables.document_processor_artifact_s3_object_version.value -cne [string]$processor[0].versionId -or
      [string]$baseline.variables.document_processor_artifact_sha256.value -cne [string]$processor[0].artifactSha256 -or
      [string]$baseline.variables.document_processor_artifact_base64sha256.value -cne [string]$processor[0].objectBase64Sha256
    $parserSourceTransition = $RequestedStage -ceq "complete-dark" -and $AppliedStage -ceq "parser-dark" -and
      $Operation -in @("Plan", "Apply") -and $parserArtifactDiffersFromReceipt
    $baselineStageMatches = [string]$baseline.variables.document_processing_deployment_stage.value -ceq $AppliedStage -or
      ($completeDarkVerifyRecovery -and
        [string]$baseline.variables.document_processing_deployment_stage.value -ceq "parser-dark")
    if ($parser.Count -ne 1 -or $processor.Count -ne 1 -or
      -not (ConvertTo-ExactBoolean $baseline.variables.deploy_document_intake.value "deploy_document_intake") -or
      -not $baselineStageMatches -or
      (ConvertTo-ExactBoolean $baseline.variables.document_scan_mapping_enabled.value "document_scan_mapping_enabled") -or
      (ConvertTo-ExactBoolean $baseline.variables.document_scan_event_rule_enabled.value "document_scan_event_rule_enabled") -or
      -not (ConvertTo-ExactBoolean $baseline.variables.document_security_health_rules_enabled.value "document_security_health_rules_enabled") -or
      [string]$baseline.variables.document_parser_version.value -cne "resume-parser-v1" -or
      [string]$baseline.variables.gateway_lambda_extension_layer_arn.value -cne $extensionLayerArn) {
      throw "The current retained baseline does not prove the exact applied dark document boundary."
    }
    if (-not $parserSourceTransition -and -not $completeDarkVerifyRecovery -and
      -not $completeDarkAppliedGatewayRecovery -and -not ($completeDarkParserRefresh -or $completeDarkProcessorRefresh) -and
      $parserArtifactDiffersFromReceipt) {
      throw "The current retained baseline does not prove the exact applied dark document boundary."
    }
    if (($completeDarkParserRefresh -or $completeDarkProcessorRefresh) -and
      ($RequestedStage -cne "complete-dark" -or $AppliedStage -cne "complete-dark" -or
        $Operation -notin @("Plan", "Apply") -or -not $parserArtifactDiffersFromReceipt -or
        -not $processorArtifactDiffersFromReceipt)) {
      throw "The CompleteDark refresh requires distinct exact-current parser and processor artifacts."
    }
    $parserPin = [string]$baseline.variables.document_parser_invocation_qualified_arn.value
    if ((($AppliedStage -ceq "parser-dark" -or $completeDarkVerifyRecovery) -and
        -not [string]::IsNullOrEmpty($parserPin)) -or
      ($AppliedStage -ceq "complete-dark" -and -not $completeDarkVerifyRecovery -and
        $parserPin -cnotmatch "^arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
      throw "The current retained baseline has an invalid parser-version pin."
    }
    if ($AppliedStage -ceq "parser-dark" -or $completeDarkVerifyRecovery) {
      foreach ($name in @(
          "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
          "document_processor_artifact_sha256", "document_processor_artifact_base64sha256",
          "document_processor_extension_layer_arn"
        )) {
        if (-not [string]::IsNullOrEmpty([string]$baseline.variables.PSObject.Properties[$name].Value.value)) {
          throw "ParserDark retained baseline contains a CompleteDark artifact input."
        }
      }
    } elseif (-not ($completeDarkParserRefresh -or $completeDarkProcessorRefresh) -and (
      [string]$baseline.variables.document_processor_artifact_s3_key.value -cne [string]$processor[0].key -or
      [string]$baseline.variables.document_processor_artifact_s3_object_version.value -cne [string]$processor[0].versionId -or
      [string]$baseline.variables.document_processor_artifact_sha256.value -cne [string]$processor[0].artifactSha256 -or
      [string]$baseline.variables.document_processor_artifact_base64sha256.value -cne [string]$processor[0].objectBase64Sha256 -or
      [string]$baseline.variables.document_processor_extension_layer_arn.value -cne $extensionLayerArn)) {
      throw "CompleteDark retained baseline does not bind the exact reviewed processor artifact."
    }
    $stateIdentity = Get-StateIdentity
    if ($Operation -ceq "Bootstrap") {
      Assert-CompleteDarkBootstrapBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -CurrentStateIdentity $stateIdentity
      $script:bootstrapInputMetadata = $metadata
    }
    elseif ($completeDarkParserRefresh) {
      Assert-CompleteDarkRefreshBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -StateIdentity $stateIdentity
    }
    elseif ($completeDarkProcessorRefresh) {
      if ($null -eq $script:parserRefreshEvidence -or
        [string]$script:parserRefreshEvidence.BaselineReceiptSha256 -cne [string]$metadata.ReceiptSha256 -or
        [string]$stateIdentity.Lineage -cne [string]$script:parserRefreshEvidence.StateLineage -or
        [long]$stateIdentity.Serial -ne [long]$script:parserRefreshEvidence.AfterStateSerial) {
        throw "The processor refresh is not at the exact parser-refresh state boundary."
      }
      $beforeIdentity = [pscustomobject]@{
        Lineage = [string]$script:parserRefreshEvidence.StateLineage
        Serial = [long]$script:parserRefreshEvidence.BeforeStateSerial
      }
      Assert-CompleteDarkRefreshBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -StateIdentity $beforeIdentity
    }
    elseif ($parserSourceTransition) {
      Assert-CompleteDarkTransitionBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -StateIdentity $stateIdentity
    }
    elseif ($completeDarkVerifyRecovery) {
      Assert-CompleteDarkVerifyRecoveryBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -CurrentStateIdentity $stateIdentity -Receipt $Receipt `
        -RequestedStage $RequestedStage -AppliedStage $AppliedStage -Operation $Operation
    }
    elseif ($completeDarkAppliedGatewayRecovery) {
      Assert-CompleteDarkAppliedGatewayRecoveryBaselineMetadata -Metadata $metadata -Baseline $baseline `
        -ResolvedPlanPath $resolved -PlanSha256 $sha -CurrentStateIdentity $stateIdentity `
        -RequestedStage $RequestedStage -AppliedStage $AppliedStage -Operation $Operation
      $script:appliedGatewayRecovery = Read-AppliedGatewayRecovery -Baseline $baseline `
        -ResolvedBaselinePath $resolved -CurrentStateIdentity $stateIdentity
      $baseline = $script:appliedGatewayRecovery.Plan
    }
    else {
      Assert-CurrentDocumentBaselineMetadata -Metadata $metadata -Baseline $baseline -ResolvedPlanPath $resolved `
        -PlanSha256 $sha -AppliedStage $AppliedStage -ReceiptSha256 $ReviewedReceiptSha256 `
        -StateIdentity $stateIdentity -ReleaseSourceSha $releaseCommit -OperatorSourceSha $operatorCommit `
        -OperatorDeltaSha256 $operatorDeltaSha256
    }
    $script:parserSourceTransition = $parserSourceTransition
    $script:completeDarkVerifyRecovery = $completeDarkVerifyRecovery
    $script:completeDarkAppliedGatewayRecovery = $completeDarkAppliedGatewayRecovery
    $script:baselineReceiptSha256 = [string]$metadata.ReceiptSha256
    return $baseline
  }
  $legacyKmsPrerequisiteEnabled = $true
  foreach ($name in @(Get-DevelopmentDocumentBooleanVariableNames)) {
    if ($name -ceq "document_security_health_rules_enabled") { continue }
    $property = $baseline.variables.PSObject.Properties[$name]
    if ($null -eq $property) { throw "The reviewed baseline omits boolean variable '$name'." }
    $null = ConvertTo-ExactBoolean $property.Value.value "baseline $name"
  }
  if (-not (ConvertTo-ExactBoolean $baseline.variables.deploy_document_intake.value "deploy_document_intake") -or
    (ConvertTo-ExactBoolean $baseline.variables.deploy_document_processing.value "legacy document processing switch") -or
    -not $legacyKmsPrerequisiteEnabled -or
    (ConvertTo-ExactBoolean $baseline.variables.document_scan_mapping_enabled.value "document_scan_mapping_enabled") -or
    (ConvertTo-ExactBoolean $baseline.variables.document_scan_event_rule_enabled.value "document_scan_event_rule_enabled") -or
    [string]$baseline.variables.document_parser_version.value -cne "resume-parser-v1" -or
    [string]$baseline.variables.gateway_lambda_extension_layer_arn.value -cne $extensionLayerArn) {
    throw "The baseline is not the accepted intake-only runtime or exact accepted extension-layer version."
  }
  return $baseline
}

function Get-BoundaryValues {
  $artifactBucket = (& terraform "-chdir=$terraformDirectory" output -raw artifact_bucket 2>$null).Trim()
  $stateRaw = & terraform "-chdir=$terraformDirectory" show -json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Terraform state could not be inspected." }
  $state = $stateRaw | ConvertFrom-Json
  $resources = Get-TerraformStateResourceMap -RootModule $state.values.root_module
  $kms = $resources["module.platform.aws_kms_key.platform"]
  if ($null -eq $kms -or [string]::IsNullOrWhiteSpace($artifactBucket)) { throw "Terraform-owned artifact/KMS boundary is unavailable." }
  return [pscustomobject]@{ ArtifactBucket = $artifactBucket; PlatformKmsArn = [string]$kms.arn }
}

function Set-BaselineVariables {
  param([Parameter(Mandatory)][object]$Baseline, [string]$DeploymentStage = "kms-prerequisite",
    [string]$ParserQualifiedArn = "")
  $migratedVariables = [pscustomobject]@{}
  foreach ($property in @($Baseline.variables.PSObject.Properties)) {
    if ([string]$property.Name -in @(
        "deploy_document_processing", "document_processing_kms_prerequisite_enabled",
        "document_processing_deployment_stage", "document_parser_invocation_qualified_arn",
        "document_security_health_rules_enabled"
      )) { continue }
    $migratedVariables | Add-Member ([string]$property.Name) $property.Value
  }
  $migratedVariables | Add-Member document_processing_deployment_stage ([pscustomobject]@{ value = $DeploymentStage })
  $migratedVariables | Add-Member document_parser_invocation_qualified_arn ([pscustomobject]@{ value = $ParserQualifiedArn })
  $migratedVariables | Add-Member document_security_health_rules_enabled ([pscustomobject]@{ value = $DeploymentStage -in @("parser-dark", "complete-dark") })
  $assignments = Get-TerraformVariableEnvironmentAssignments -Variables $migratedVariables
  foreach ($entry in $assignments.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
  }
}

function Assert-BaselineCurrent {
  param([Parameter(Mandatory)][object]$Baseline)
  Set-BaselineVariables -Baseline $Baseline -DeploymentStage "kms-prerequisite"
  $path = Join-Path $operatorRoot "baseline-current-$([guid]::NewGuid().ToString('N')).tfplan"
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      "-out=$path" -detailed-exitcode | Out-Null
    $code = $LASTEXITCODE
    if ($code -eq 1) { throw "The reviewed baseline freshness plan failed." }
    if ($code -eq 2) { throw "The reviewed baseline no longer reproduces exact current applied state." }
  }
  finally {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
}

function Assert-AppliedGatewayRetainedParserReceipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ResolvedPath,
    [Parameter(Mandatory)][string]$ReceiptSha256
  )

  $receiptRoot = Join-Path $terraformDataRoot "development-document-artifacts"
  $expectedPath = [IO.Path]::GetFullPath((Join-Path $receiptRoot `
      "receipt-d0e55de86edf-20260813-192653.json"))
  if (-not $appliedGatewayRecoveryRequested -or
    [IO.Path]::GetFullPath($ResolvedPath) -cne $expectedPath -or
    $ReviewedRetainedParserReceiptSha256 -cne $appliedGatewayRecoveryRetainedParserReceiptSha256 -or
    $ReceiptSha256 -cne $appliedGatewayRecoveryRetainedParserReceiptSha256) {
    throw "The retained ParserDark receipt path or checksum does not match the exact reviewed evidence."
  }

  Assert-DevelopmentDocumentPublicationReceipt -Receipt $Receipt
  if ([string]$Receipt.sourceSha -cne $appliedGatewayRecoveryRetainedParserReceiptSourceSha) {
    throw "The retained ParserDark receipt does not belong to the exact historical parser release."
  }
  $parserArtifacts = @($Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq "document-parser-lambda" -and [string]$_.suffix -ceq "zip"
    })
  $expectedKey = "lambda/documents/$appliedGatewayRecoveryRetainedParserReceiptSourceSha/" +
    "$appliedGatewayRecoveryRetainedParserArtifactSha256/document-parser-lambda.zip"
  if ($parserArtifacts.Count -ne 1 -or
    [string]$parserArtifacts[0].key -cne $expectedKey -or
    [string]$parserArtifacts[0].versionId -cne $appliedGatewayRecoveryRetainedParserObjectVersion -or
    [string]$parserArtifacts[0].artifactSha256 -cne $appliedGatewayRecoveryRetainedParserArtifactSha256 -or
    [string]$parserArtifacts[0].objectSha256 -cne $appliedGatewayRecoveryRetainedParserArtifactSha256 -or
    [string]$parserArtifacts[0].objectBase64Sha256 -cne $appliedGatewayRecoveryRetainedParserObjectBase64Sha256 -or
    [long]$parserArtifacts[0].contentLength -ne $appliedGatewayRecoveryRetainedParserContentLength) {
    throw "The retained ParserDark receipt does not bind the exact parser-v1 artifact."
  }
  return $parserArtifacts[0]
}

function Read-AppliedGatewayRetainedParserReceipt {
  $resolved = Resolve-InputPath -Candidate $RetainedParserReceiptPath -MustExist
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -cne $ReviewedRetainedParserReceiptSha256) {
    throw "The retained ParserDark receipt checksum does not match review."
  }
  try { $receipt = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json }
  catch { throw "The retained ParserDark receipt is not valid JSON." }
  $parserArtifact = Assert-AppliedGatewayRetainedParserReceipt -Receipt $receipt `
    -ResolvedPath $resolved -ReceiptSha256 $sha

  $boundary = Get-BoundaryValues
  $expectedBoundary = Get-TextSha256 `
    "$ExpectedAccountId|$Region|$($boundary.ArtifactBucket)|$($boundary.PlatformKmsArn)"
  if ([string]$receipt.boundarySha256 -cne $expectedBoundary) {
    throw "The retained ParserDark receipt is outside the live development artifact/KMS boundary."
  }
  $platformKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$boundary.PlatformKmsArn,
    "--output", "json")
  foreach ($artifact in @($receipt.artifacts)) {
    $stored = Invoke-AwsJson @("s3api", "head-object", "--bucket", $boundary.ArtifactBucket,
      "--key", [string]$artifact.key, "--version-id", [string]$artifact.versionId,
      "--checksum-mode", "ENABLED", "--output", "json")
    $storedKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$stored.SSEKMSKeyId,
      "--output", "json")
    if ([string]$stored.VersionId -cne [string]$artifact.versionId -or
      [long]$stored.ContentLength -ne [long]$artifact.contentLength -or
      [string]$stored.ChecksumSHA256 -cne [string]$artifact.objectBase64Sha256 -or
      [string]$stored.ServerSideEncryption -cne "aws:kms" -or
      -not (ConvertTo-ExactBoolean $stored.BucketKeyEnabled "retained parser artifact BucketKeyEnabled") -or
      [string]$storedKey.KeyMetadata.KeyId -cne [string]$platformKey.KeyMetadata.KeyId -or
      [string]$stored.Metadata."source-sha" -cne $appliedGatewayRecoveryRetainedParserReceiptSourceSha -or
      [string]$stored.Metadata."artifact-sha256" -cne [string]$artifact.artifactSha256) {
      throw "A retained ParserDark publication object failed exact-version readback."
    }
  }
  return [pscustomobject]@{ Receipt = $receipt; ParserArtifact = $parserArtifact }
}

function Read-Receipt {
  param([Parameter(Mandatory)][string]$Commit)
  $resolved = Resolve-InputPath -Candidate $PublicationReceiptPath -MustExist
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -cne $ReviewedReceiptSha256) { throw "The publication receipt checksum does not match review." }
  $receipt = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
  Assert-DevelopmentDocumentPublicationReceipt -Receipt $receipt
  if ([string]$receipt.sourceSha -cne $Commit) { throw "The publication receipt does not belong to exact merged main." }
  $boundary = Get-BoundaryValues
  $bytes = [Text.Encoding]::UTF8.GetBytes("$ExpectedAccountId|$Region|$($boundary.ArtifactBucket)|$($boundary.PlatformKmsArn)")
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $expectedBoundary = ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant() }
  finally { $hash.Dispose() }
  if ([string]$receipt.boundarySha256 -cne $expectedBoundary) { throw "The receipt is outside the live development artifact/KMS boundary." }
  foreach ($artifact in @($receipt.artifacts)) {
    $stored = Invoke-AwsJson @("s3api", "head-object", "--bucket", $boundary.ArtifactBucket, "--key", [string]$artifact.key,
      "--version-id", [string]$artifact.versionId, "--checksum-mode", "ENABLED", "--output", "json")
    $storedKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$stored.SSEKMSKeyId, "--output", "json")
    $platformKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$boundary.PlatformKmsArn, "--output", "json")
    if ([string]$stored.VersionId -cne [string]$artifact.versionId -or
      [long]$stored.ContentLength -ne [long]$artifact.contentLength -or
      [string]$stored.ChecksumSHA256 -cne [string]$artifact.objectBase64Sha256 -or
      [string]$stored.ServerSideEncryption -cne "aws:kms" -or
      [string]$storedKey.KeyMetadata.KeyId -cne [string]$platformKey.KeyMetadata.KeyId -or
      [string]$stored.Metadata."source-sha" -cne $Commit -or
      [string]$stored.Metadata."artifact-sha256" -cne [string]$artifact.artifactSha256) {
      throw "An exact-version publication object failed independent readback."
    }
  }
  return $receipt
}

function Set-DarkVariables {
  param([Parameter(Mandatory)][object]$Baseline, [AllowNull()][object]$Receipt,
    [Parameter(Mandatory)][string]$DeploymentStage, [string]$ParserQualifiedArn = "")
  Set-BaselineVariables -Baseline $Baseline -DeploymentStage $DeploymentStage -ParserQualifiedArn $ParserQualifiedArn
  $env:TF_VAR_document_scan_mapping_enabled = "false"
  $env:TF_VAR_document_scan_event_rule_enabled = "false"
  $env:TF_VAR_document_security_health_rules_enabled = ($DeploymentStage -in @("parser-dark", "complete-dark")).ToString().ToLowerInvariant()
  if ($DeploymentStage -ceq "kms-prerequisite") { return }
  $processor = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-processor-lambda" -and $_.suffix -eq "zip" })[0]
  $parser = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })[0]
  $env:TF_VAR_document_parser_artifact_s3_key = [string]$parser.key
  $env:TF_VAR_document_parser_artifact_s3_object_version = [string]$parser.versionId
  $env:TF_VAR_document_parser_artifact_sha256 = [string]$parser.artifactSha256
  $env:TF_VAR_document_parser_artifact_base64sha256 = [string]$parser.objectBase64Sha256
  if ($DeploymentStage -ceq "complete-dark" -and -not $script:completeDarkParserRefresh) {
    $env:TF_VAR_document_processor_artifact_s3_key = [string]$processor.key
    $env:TF_VAR_document_processor_artifact_s3_object_version = [string]$processor.versionId
    $env:TF_VAR_document_processor_artifact_sha256 = [string]$processor.artifactSha256
    $env:TF_VAR_document_processor_artifact_base64sha256 = [string]$processor.objectBase64Sha256
    $env:TF_VAR_document_processor_extension_layer_arn = $extensionLayerArn
  }
}

function Set-CompleteDarkBootstrapVariables {
  if ($null -eq $script:bootstrapTemplate -or $null -eq $script:bootstrapTemplate.variables) {
    throw "Bootstrap requires its authenticated current-state variable template."
  }
  $variables = $script:bootstrapTemplate.variables | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  if ((@($variables.PSObject.Properties.Name | Sort-Object) -join "|") -cne
      (@($allowedVariableNames | Sort-Object) -join "|") -or
    [string]$variables.document_processing_deployment_stage.value -cne "complete-dark" -or
    (ConvertTo-ExactBoolean $variables.document_scan_mapping_enabled.value "bootstrap mapping") -or
    (ConvertTo-ExactBoolean $variables.document_scan_event_rule_enabled.value "bootstrap event rule") -or
    -not (ConvertTo-ExactBoolean $variables.document_security_health_rules_enabled.value "bootstrap health rules")) {
    throw "Bootstrap reconstructed a non-dark document variable boundary."
  }
  $assignments = Get-TerraformVariableEnvironmentAssignments -Variables $variables
  foreach ($entry in $assignments.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
  }
}

function Get-StateResourceMap {
  $raw = & terraform "-chdir=$terraformDirectory" show -json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw "Terraform state could not be inspected for live verification." }
  $state = $raw | ConvertFrom-Json
  return Get-TerraformStateResourceMap -RootModule $state.values.root_module
}

function Assert-LiveRolePolicy {
  param([Parameter(Mandatory)][string]$RoleName, [Parameter(Mandatory)][string]$PolicyName,
    [Parameter(Mandatory)][object]$ExpectedPolicy, [Parameter(Mandatory)][object]$ExpectedAssumePolicy,
    [Parameter(Mandatory)][string]$BoundaryArn)
  $role = Invoke-AwsJson @("iam", "get-role", "--role-name", $RoleName, "--output", "json")
  if ([string]$role.Role.PermissionsBoundary.PermissionsBoundaryArn -cne $BoundaryArn -or
    [int]$role.Role.MaxSessionDuration -ne 3600 -or
    (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $role.Role.AssumeRolePolicyDocument) -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $ExpectedAssumePolicy) -SortArrays)) {
    throw "A document role lacks its exact trust, session, or workload boundary."
  }
  $attached = Invoke-AwsJson @("iam", "list-attached-role-policies", "--role-name", $RoleName, "--output", "json")
  $inline = Invoke-AwsJson @("iam", "list-role-policies", "--role-name", $RoleName, "--output", "json")
  if (@($attached.AttachedPolicies).Count -ne 0 -or @($inline.PolicyNames).Count -ne 1 -or [string]$inline.PolicyNames[0] -cne $PolicyName) {
    throw "A document role has an unexpected attached or inline policy."
  }
  $policy = Invoke-AwsJson @("iam", "get-role-policy", "--role-name", $RoleName, "--policy-name", $PolicyName, "--output", "json")
  if ((ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $policy.PolicyDocument) -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $ExpectedPolicy) -SortArrays)) { throw "A live document role policy differs from reviewed Terraform state." }
}

function Assert-ParserSecurityGroup {
  param([Parameter(Mandatory)][string]$GroupId, [Parameter(Mandatory)][string]$VpcId,
    [Parameter(Mandatory)][string]$S3PrefixListId)
  $result = Invoke-AwsJson @("ec2", "describe-security-groups", "--group-ids", $GroupId, "--output", "json")
  $groups = @($result.SecurityGroups)
  if ($groups.Count -ne 1 -or [string]$groups[0].VpcId -cne $VpcId -or @($groups[0].IpPermissions).Count -ne 0 -or
    @($groups[0].IpPermissionsEgress).Count -ne 3) { throw "The parser security group shape is not exact." }
  foreach ($permission in @($groups[0].IpPermissionsEgress)) {
    if (@($permission.Ipv6Ranges).Count -ne 0 -or @($permission.UserIdGroupPairs).Count -ne 0) { throw "The parser security group has general egress." }
  }
  $dns = @($groups[0].IpPermissionsEgress | Where-Object { $_.FromPort -eq 53 -and $_.ToPort -eq 53 -and $_.IpProtocol -in @("tcp", "udp") })
  if ($dns.Count -ne 2 -or @($dns | Where-Object { @($_.IpRanges).Count -ne 1 -or [string]$_.IpRanges[0].CidrIp -cne "10.20.0.0/16" }).Count -ne 0) {
    throw "The parser DNS egress is not exact."
  }
  $s3 = @($groups[0].IpPermissionsEgress | Where-Object { $_.FromPort -eq 443 -and $_.ToPort -eq 443 -and $_.IpProtocol -eq "tcp" })
  if ($s3.Count -ne 1 -or @($s3[0].PrefixListIds).Count -ne 1 -or [string]$s3[0].PrefixListIds[0].PrefixListId -cne $S3PrefixListId -or
    @($s3[0].IpRanges).Count -ne 0) { throw "The parser S3-only HTTPS egress is not exact." }
}

function Assert-EventTargetExact {
  param([Parameter(Mandatory)][string]$RuleName, [Parameter(Mandatory)][object]$Expected)
  $result = Invoke-AwsJson @("events", "list-targets-by-rule", "--rule", $RuleName, "--output", "json")
  $targets = @($result.Targets)
  if ($targets.Count -ne 1) { throw "An exact document EventBridge rule must have one target." }
  $target = $targets[0]
  if ([string]$target.Id -cne [string]$Expected.target_id -or [string]$target.Arn -cne [string]$Expected.arn -or
    [string]$target.DeadLetterConfig.Arn -cne [string]$Expected.dead_letter_config[0].arn -or
    [int]$target.RetryPolicy.MaximumEventAgeInSeconds -ne [int]$Expected.retry_policy[0].maximum_event_age_in_seconds -or
    [int]$target.RetryPolicy.MaximumRetryAttempts -ne [int]$Expected.retry_policy[0].maximum_retry_attempts) {
    throw "A document EventBridge target, retry, or DLQ boundary is not exact."
  }
  $inputTransformerProperty = $Expected.PSObject.Properties["input_transformer"]
  if ($null -ne $inputTransformerProperty -and @($inputTransformerProperty.Value).Count -ne 0) {
    if ((ConvertTo-DeploymentCanonicalValue $target.InputTransformer.InputPathsMap -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue $inputTransformerProperty.Value[0].input_paths -SortArrays) -or
      [string]$target.InputTransformer.InputTemplate -cne [string]$inputTransformerProperty.Value[0].input_template) {
      throw "The document scan input transformer is not exact."
    }
  }
  else {
    $inputProperty = $Expected.PSObject.Properties["input"]
    $expectedInput = if ($null -eq $inputProperty) { "" } else { [string]$inputProperty.Value }
    $targetInputProperty = $target.PSObject.Properties["Input"]
    $actualInput = if ($null -eq $targetInputProperty) { "" } else { [string]$targetInputProperty.Value }
    if ($actualInput -cne $expectedInput) { throw "A document alert target input is not exact." }
  }
}

function Get-LiveDocumentStageInventory {
  param([Parameter(Mandatory)][hashtable]$State)
  $processorName = "ai-job-apply-development-document-processor"
  $processorArn = "arn:aws:lambda:${Region}:${ExpectedAccountId}:function:$processorName"
  $functions = Invoke-AwsJson @("lambda", "list-functions", "--output", "json")
  $processorFunctions = @($functions.Functions | Where-Object FunctionName -eq $processorName)
  $aliases = @()
  $allMappings = @((Invoke-AwsJson @("lambda", "list-event-source-mappings", "--output", "json")).EventSourceMappings)
  $qualifiedProcessorArnPrefix = "${processorArn}:"
  $mappings = @($allMappings | Where-Object {
      $functionArn = [string]$_.FunctionArn
      $functionArn -ceq $processorArn -or $functionArn.StartsWith($qualifiedProcessorArnPrefix, [StringComparison]::Ordinal)
    })
  $permissions = 0
  if ($processorFunctions.Count -eq 1) {
    $aliases = @((Invoke-AwsJson @("lambda", "list-aliases", "--function-name", $processorName, "--output", "json")).Aliases)
    $policy = Invoke-AwsJson @("lambda", "get-policy", "--function-name", $processorName, "--qualifier", "development", "--output", "json")
    $permissions = @((([string]$policy.Policy | ConvertFrom-Json).Statement) | Where-Object Sid -eq "AllowExactDocumentReconcilerRule").Count
  }
  $reconcilerName = [string]$State["module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"].name
  $targets = @((Invoke-AwsJson @("events", "list-targets-by-rule", "--rule", $reconcilerName, "--output", "json")).Targets)
  $vpcId = [string]$State["module.platform.aws_vpc.this"].id
  $endpoints = @((Invoke-AwsJson @("ec2", "describe-vpc-endpoints", "--filters", "Name=vpc-id,Values=$vpcId", "--output", "json")).VpcEndpoints)
  $sts = @($endpoints | Where-Object ServiceName -eq "com.amazonaws.$Region.sts")
  $endpointPolicies = @()
  foreach ($endpoint in @($endpoints | Where-Object { $_.ServiceName -in @("com.amazonaws.$Region.sqs", "com.amazonaws.$Region.lambda", "com.amazonaws.$Region.secretsmanager") })) {
    $policy = $endpoint.PolicyDocument | ConvertFrom-Json
    $endpointPolicies += ,$policy
  }
  $laterGrantCount = Get-DevelopmentDocumentLaterStageEndpointGrantCount -Policies $endpointPolicies -AccountId $ExpectedAccountId
  $inline = @((Invoke-AwsJson @("iam", "list-role-policies", "--role-name", $processorName, "--output", "json")).PolicyNames | Where-Object { $_ -eq "document-processor-runtime" })
  return [pscustomobject]@{
    ProcessorFunctions = $processorFunctions.Count; ProcessorAliases = $aliases.Count
    ProcessorMappings = $mappings.Count; StsEndpoints = $sts.Count; ReconcilerTargets = $targets.Count
    ReconcilerPermissions = $permissions; ProcessorInlinePolicies = $inline.Count
    LaterStageEndpointGrants = $laterGrantCount
  }
}

function Get-OptionalLambdaResourcePolicy {
  param([Parameter(Mandatory)][string]$FunctionName, [string]$Qualifier = "")
  $arguments = @("lambda", "get-policy", "--function-name", $FunctionName)
  if (-not [string]::IsNullOrWhiteSpace($Qualifier)) { $arguments += @("--qualifier", $Qualifier) }
  $arguments += @("--output", "json")
  $raw = & aws @arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $message = @($raw | ForEach-Object { [string]$_ }) -join "`n"
    if ($message -match 'ResourceNotFoundException') { return $null }
    throw "AWS Lambda resource-policy read failed. Refresh development SSO."
  }
  if (-not $raw) { throw "AWS returned an empty Lambda resource-policy response." }
  try { return ($raw | ConvertFrom-Json) } catch { throw "AWS returned invalid Lambda resource-policy JSON." }
}

function Assert-NoLambdaResourcePolicy {
  param([Parameter(Mandatory)][string]$FunctionName)
  $unqualified = Get-OptionalLambdaResourcePolicy -FunctionName $FunctionName
  $qualified = Get-OptionalLambdaResourcePolicy -FunctionName $FunctionName -Qualifier "development"
  Assert-ParserLambdaResourcePolicyAbsence -UnqualifiedPolicy $unqualified -QualifiedPolicy $qualified
}

function Assert-ExactProcessorLambdaResourcePolicy {
  param([Parameter(Mandatory)][string]$FunctionName, [Parameter(Mandatory)][string]$ExpectedSourceArn)
  $policyResponse = Get-OptionalLambdaResourcePolicy -FunctionName $FunctionName -Qualifier "development"
  if ($null -eq $policyResponse) { throw "The processor alias lacks its exact reconciler resource policy." }
  Assert-ExactProcessorLambdaResourcePolicyDocument -PolicyValue ([string]$policyResponse.Policy) `
    -AccountId $ExpectedAccountId -ExpectedSourceArn $ExpectedSourceArn
  $functionPolicy = Get-OptionalLambdaResourcePolicy -FunctionName $FunctionName
  if ($null -ne $functionPolicy) { throw "The unqualified processor Lambda must not have an additional resource policy." }
}

function Assert-LiveDarkBoundary {
  param([Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][string]$ParserQualifiedArn)
  $state = Get-StateResourceMap
  $vpcId = [string]$state["module.platform.aws_vpc.this"].id
  $platformKmsArn = [string]$state["module.platform.aws_kms_key.platform"].arn
  $candidateBucket = [string]$state["module.platform.aws_s3_bucket.candidate_documents[0]"].bucket
  $databaseSecretArn = [string]$state["module.platform.aws_secretsmanager_secret.database_url"].arn
  $processorAliasArn = [string]$state["module.platform.aws_lambda_alias.document_processor[0]"].arn
  $objectRoleArn = [string]$state["module.platform.aws_iam_role.document_parser_object_access[0]"].arn
  $guardDutyArn = [string]$state["module.platform.aws_guardduty_malware_protection_plan.candidate_documents[0]"].arn
  $reconcilerArn = [string]$state["module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"].arn
  $logGroup = [string]$state["module.platform.aws_cloudwatch_log_group.application"].name
  $privateSubnetIds = @($state.Keys | Where-Object { $_ -like "module.platform.aws_subnet.private*" } | ForEach-Object { [string]$state[$_].id })
  $applicationSecurityGroup = [string]$state["module.platform.aws_security_group.application"].id
  $parserSecurityGroup = [string]$state["module.platform.aws_security_group.document_parser[0]"].id
  $processorArtifact = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-processor-lambda" -and $_.suffix -eq "zip" })[0]
  $parserArtifact = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })[0]
  foreach ($definition in @(
      @("document-processor", $processorArtifact, $true),
      @("document-parser", $parserArtifact, $false)
    )) {
    $name = [string]$definition[0]
    $artifact = $definition[1]
    $function = "ai-job-apply-development-$name"
    $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $function, "--name", "development", "--output", "json")
    $expectedDescription = "Reviewed immutable development document $(if ($name -eq 'document-processor') { 'processor' } else { 'parser' }) release"
    $routingProperty = $alias.PSObject.Properties["RoutingConfig"]
    $routingWeights = if ($null -eq $routingProperty) { @() } else {
      $weightsProperty = $routingProperty.Value.PSObject.Properties["AdditionalVersionWeights"]
      if ($null -eq $weightsProperty) { @() } else { @($weightsProperty.Value.PSObject.Properties) }
    }
    if ([string]$alias.FunctionVersion -notmatch "^[1-9][0-9]*$" -or [string]$alias.Description -cne $expectedDescription -or
      @($routingWeights).Count -ne 0) { throw "A document Lambda alias is not an exact immutable release." }
    $deployed = Invoke-AwsJson @("lambda", "get-function", "--function-name", "$function`:development", "--output", "json")
    $concurrency = Invoke-AwsJson @("lambda", "get-function-concurrency", "--function-name", $function, "--output", "json")
    if ([string]$deployed.Configuration.Version -cne [string]$alias.FunctionVersion -or
      [string]$deployed.Configuration.CodeSha256 -cne [string]$artifact.objectBase64Sha256 -or
      [string]$deployed.Configuration.Environment.Variables.RELEASE_SHA -cne [string]$artifact.artifactSha256) {
      throw "A document Lambda does not match the checksum-reviewed immutable release."
    }
    $expectedRole = [string]$state["module.platform.aws_iam_role.$(if ($name -eq 'document-processor') { 'document_processor' } else { 'document_parser' })[0]"].arn
    $expectedEnvironment = if ($name -eq "document-processor") { @{
        NODE_ENV = "production"; RELEASE_SHA = [string]$processorArtifact.artifactSha256
        DATABASE_SECRET_ID = $databaseSecretArn; PLATFORM_AWS_ACCOUNT_ID = $ExpectedAccountId
        GUARDDUTY_PROTECTION_PLAN_ARN = $guardDutyArn; CANDIDATE_DOCUMENT_BUCKET = $candidateBucket
        PLATFORM_KMS_KEY_ARN = $platformKmsArn; DOCUMENT_PARSER_FUNCTION_ARN = $ParserQualifiedArn
        DOCUMENT_PARSER_VERSION = "resume-parser-v1"; DOCUMENT_OBJECT_ACCESS_ROLE_ARN = $objectRoleArn
        DOCUMENT_RECONCILER_RULE_ARN = $reconcilerArn
      } } else { @{
        NODE_ENV = "production"; RELEASE_SHA = [string]$parserArtifact.artifactSha256
        CANDIDATE_DOCUMENT_BUCKET = $candidateBucket; PLATFORM_KMS_KEY_ARN = $platformKmsArn
        DOCUMENT_PARSER_VERSION = "resume-parser-v1"
      } }
    Assert-ExactDocumentLambdaRuntime -Configuration $deployed.Configuration -Concurrency $concurrency `
      -Kind $(if ($name -eq "document-processor") { "processor" } else { "parser" }) `
      -ExpectedRoleArn $expectedRole -ExpectedKmsArn $platformKmsArn -ExpectedVpcId $vpcId `
      -ExpectedSubnetIds $privateSubnetIds -ExpectedSecurityGroupId $(if ($name -eq "document-processor") { $applicationSecurityGroup } else { $parserSecurityGroup }) `
      -ExpectedEnvironment $expectedEnvironment -ExpectedLogGroup $logGroup -ExpectedExtensionLayerArn $extensionLayerArn
  }
  $boundaryArn = "arn:aws:iam::${ExpectedAccountId}:policy/ai-job-apply-development-workload-boundary"
  Assert-LiveRolePolicy "ai-job-apply-development-document-processor" "document-processor-runtime" `
    $state["module.platform.aws_iam_role_policy.document_processor[0]"].policy `
    $state["module.platform.aws_iam_role.document_processor[0]"].assume_role_policy $boundaryArn
  Assert-LiveRolePolicy "ai-job-apply-development-document-parser" "document-parser-runtime" `
    $state["module.platform.aws_iam_role_policy.document_parser[0]"].policy `
    $state["module.platform.aws_iam_role.document_parser[0]"].assume_role_policy $boundaryArn
  Assert-LiveRolePolicy "ai-job-apply-development-document-object-access" "document-object-access-runtime" `
    $state["module.platform.aws_iam_role_policy.document_parser_object_access[0]"].policy `
    $state["module.platform.aws_iam_role.document_parser_object_access[0]"].assume_role_policy $boundaryArn
  $prefixLists = Invoke-AwsJson @("ec2", "describe-prefix-lists", "--filters", "Name=prefix-list-name,Values=com.amazonaws.$Region.s3", "--output", "json")
  if (@($prefixLists.PrefixLists).Count -ne 1) { throw "The regional S3 prefix list is unavailable." }
  Assert-ParserSecurityGroup $parserSecurityGroup $vpcId ([string]$prefixLists.PrefixLists[0].PrefixListId)
  $mapping = Invoke-AwsJson @("lambda", "list-event-source-mappings", "--function-name",
    "ai-job-apply-development-document-processor:development", "--output", "json")
  $mappings = @($mapping.EventSourceMappings)
  if ($mappings.Count -ne 1 -or [string]$mappings[0].State -cne "Disabled" -or
    [int]$mappings[0].BatchSize -ne 1 -or [int]$mappings[0].ScalingConfig.MaximumConcurrency -ne 2 -or
    [string]$mappings[0].EventSourceArn -cne [string]$state["module.platform.aws_sqs_queue.document_scan_results[0]"].arn -or
    [string]$mappings[0].FunctionArn -cne $processorAliasArn) { throw "The document queue mapping is not exactly disabled and bounded." }
  Assert-ExactStringSet $mappings[0].FunctionResponseTypes @("ReportBatchItemFailures") "mapping response types"
  foreach ($ruleAddress in @("document_scan_results", "document_processing_reconciler", "document_scan_tag_failure", "document_scan_plan_unhealthy")) {
    $rule = [string]$state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"].name
    $value = Invoke-AwsJson @("events", "describe-rule", "--name", $rule, "--output", "json")
    $expectedState = if ($ruleAddress -in @("document_scan_tag_failure", "document_scan_plan_unhealthy")) { "ENABLED" } else { "DISABLED" }
    if ([string]$value.State -cne $expectedState) { throw "A document rule differs from its processing-dark/security-alert state." }
    $expectedRule = $state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"]
    if ($ruleAddress -eq "document_scan_results" -and
      (ConvertTo-DeploymentCanonicalValue ($value.EventPattern | ConvertFrom-Json) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue ($expectedRule.event_pattern | ConvertFrom-Json) -SortArrays)) { throw "The scan-result rule pattern is not exact." }
    if ($ruleAddress -eq "document_processing_reconciler" -and [string]$value.ScheduleExpression -cne [string]$expectedRule.schedule_expression) {
      throw "The reconciler schedule is not exact."
    }
  }
  $queueDefinitions = @(
    @("document_scan_results", 345600, 360, [string]$state["module.platform.aws_sqs_queue.document_scan_dead_letter[0]"].arn),
    @("document_scan_dead_letter", 1209600, 30, ""),
    @("document_scan_delivery_dead_letter", 1209600, 30, "")
  )
  foreach ($definition in $queueDefinitions) {
    $queueState = $state["module.platform.aws_sqs_queue.$($definition[0])[0]"]
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", [string]$queueState.url,
      "--attribute-names", "All", "--output", "json")
    Assert-ExactDocumentQueueAttributes $attributes.Attributes $platformKmsArn ([int]$definition[1]) ([int]$definition[2]) ([string]$definition[3])
  }
  foreach ($policyAddress in @("document_scan_results", "document_scan_delivery_dead_letter")) {
    $queueState = $state["module.platform.aws_sqs_queue.$policyAddress[0]"]
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", [string]$queueState.url, "--attribute-names", "Policy", "--output", "json")
    $expectedPolicy = $state["module.platform.aws_sqs_queue_policy.$policyAddress[0]"].policy
    if ((ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $attributes.Attributes.Policy) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $expectedPolicy) -SortArrays)) { throw "A document queue policy differs from reviewed state." }
  }
  foreach ($targetAddress in @("document_scan_results", "document_scan_tag_failure", "document_scan_plan_unhealthy", "document_processing_reconciler")) {
    $target = $state["module.platform.aws_cloudwatch_event_target.$targetAddress[0]"]
    Assert-EventTargetExact ([string]$target.rule) $target
  }
  $alarmNames = @($state.Keys | Where-Object { $_ -like "module.platform.aws_cloudwatch_metric_alarm.document_*" } | ForEach-Object { [string]$state[$_].alarm_name } | Sort-Object)
  $topicArn = [string]$state["module.platform.aws_sns_topic.operational_alerts"].arn
  $alarms = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $alarmArguments = @("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json")
    $alarms = Invoke-AwsJson -Arguments $alarmArguments
    if (@($alarms.MetricAlarms).Count -eq 8 -and @($alarms.MetricAlarms | Where-Object StateValue -ne "OK").Count -eq 0) { break }
    Start-Sleep -Seconds 10
  }
  Assert-ExactDocumentAlarmSet @($alarms.MetricAlarms) $alarmNames $topicArn
  $endpoints = Invoke-AwsJson @("ec2", "describe-vpc-endpoints", "--filters", "Name=vpc-id,Values=$vpcId", "--output", "json")
  foreach ($service in @("s3", "sts", "lambda", "sqs", "secretsmanager")) {
    $matching = @($endpoints.VpcEndpoints | Where-Object { $_.ServiceName -eq "com.amazonaws.$Region.$service" -and $_.State -eq "available" })
    if ($matching.Count -ne 1) { throw "The exact available $service VPC endpoint is missing." }
    $address = if ($service -eq "s3") { "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" } else { "module.platform.aws_vpc_endpoint.$service[0]" }
    $expectedEndpoint = $state[$address]
    $expectedType = if ($service -eq "s3") { "Gateway" } else { "Interface" }
    if ([string]$matching[0].VpcEndpointType -cne $expectedType -or [string]$matching[0].VpcId -cne $vpcId -or
      ($service -ne "s3" -and -not (ConvertTo-ExactBoolean $matching[0].PrivateDnsEnabled "$service PrivateDnsEnabled")) -or
      (ConvertTo-DeploymentCanonicalValue ($matching[0].PolicyDocument | ConvertFrom-Json) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue ($expectedEndpoint.policy | ConvertFrom-Json) -SortArrays)) {
      throw "The $service VPC endpoint shape or policy is not exact."
    }
    if ($service -eq "s3") {
      Assert-ExactStringSet $matching[0].RouteTableIds @($expectedEndpoint.route_table_ids) "S3 endpoint route tables"
    }
    else {
      Assert-ExactStringSet $matching[0].SubnetIds @($expectedEndpoint.subnet_ids) "$service endpoint subnets"
      Assert-ExactStringSet $matching[0].Groups.GroupId @($expectedEndpoint.security_group_ids) "$service endpoint security groups"
    }
  }
}

function Assert-LiveParserDarkBoundary {
  param([Parameter(Mandatory)][object]$Receipt)
  $state = Get-StateResourceMap
  $vpcId = [string]$state["module.platform.aws_vpc.this"].id
  $platformKmsArn = [string]$state["module.platform.aws_kms_key.platform"].arn
  $candidateBucket = [string]$state["module.platform.aws_s3_bucket.candidate_documents[0]"].bucket
  $privateSubnetIds = @($state.Keys | Where-Object { $_ -like "module.platform.aws_subnet.private*" } | ForEach-Object { [string]$state[$_].id })
  $parserSecurityGroup = [string]$state["module.platform.aws_security_group.document_parser[0]"].id
  $parserArtifact = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })[0]
  $parserName = "ai-job-apply-development-document-parser"
  Assert-NoLambdaResourcePolicy -FunctionName $parserName
  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $parserName, "--name", "development", "--output", "json")
  $deployed = Invoke-AwsJson @("lambda", "get-function", "--function-name", "$parserName`:development", "--output", "json")
  $concurrency = Invoke-AwsJson @("lambda", "get-function-concurrency", "--function-name", $parserName, "--output", "json")
  if ([string]$alias.FunctionVersion -cnotmatch "^[1-9][0-9]*$" -or
    [string]$alias.Description -cne "Reviewed immutable development document parser release" -or
    [string]$deployed.Configuration.Version -cne [string]$alias.FunctionVersion -or
    [string]$deployed.Configuration.CodeSha256 -cne [string]$parserArtifact.objectBase64Sha256) {
    throw "The parser-dark Lambda alias is not the exact reviewed immutable parser."
  }
  Assert-ExactDocumentLambdaRuntime -Configuration $deployed.Configuration -Concurrency $concurrency -Kind parser `
    -ExpectedRoleArn ([string]$state["module.platform.aws_iam_role.document_parser[0]"].arn) `
    -ExpectedKmsArn $platformKmsArn -ExpectedVpcId $vpcId -ExpectedSubnetIds $privateSubnetIds `
    -ExpectedSecurityGroupId $parserSecurityGroup -ExpectedEnvironment @{
      NODE_ENV = "production"; RELEASE_SHA = [string]$parserArtifact.artifactSha256
      CANDIDATE_DOCUMENT_BUCKET = $candidateBucket; PLATFORM_KMS_KEY_ARN = $platformKmsArn
      DOCUMENT_PARSER_VERSION = "resume-parser-v1"
    }
  $boundaryArn = "arn:aws:iam::${ExpectedAccountId}:policy/ai-job-apply-development-workload-boundary"
  Assert-LiveRolePolicy "ai-job-apply-development-document-parser" "document-parser-runtime" `
    $state["module.platform.aws_iam_role_policy.document_parser[0]"].policy `
    $state["module.platform.aws_iam_role.document_parser[0]"].assume_role_policy $boundaryArn
  Assert-LiveRolePolicy "ai-job-apply-development-document-object-access" "document-object-access-runtime" `
    $state["module.platform.aws_iam_role_policy.document_parser_object_access[0]"].policy `
    $state["module.platform.aws_iam_role.document_parser_object_access[0]"].assume_role_policy $boundaryArn
  $processorRole = Invoke-AwsJson @("iam", "get-role", "--role-name", "ai-job-apply-development-document-processor", "--output", "json")
  $processorAttached = Invoke-AwsJson @("iam", "list-attached-role-policies", "--role-name", "ai-job-apply-development-document-processor", "--output", "json")
  $processorInline = Invoke-AwsJson @("iam", "list-role-policies", "--role-name", "ai-job-apply-development-document-processor", "--output", "json")
  if ([string]$processorRole.Role.PermissionsBoundary.PermissionsBoundaryArn -cne $boundaryArn -or
    (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $processorRole.Role.AssumeRolePolicyDocument) -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $state["module.platform.aws_iam_role.document_processor[0]"].assume_role_policy) -SortArrays) -or
    @($processorAttached.AttachedPolicies).Count -ne 0 -or @($processorInline.PolicyNames).Count -ne 0) {
    throw "Parser-dark processor role is not exact, bounded, and policy-free."
  }
  $prefixLists = Invoke-AwsJson @("ec2", "describe-prefix-lists", "--filters", "Name=prefix-list-name,Values=com.amazonaws.$Region.s3", "--output", "json")
  if (@($prefixLists.PrefixLists).Count -ne 1) { throw "The regional S3 prefix list is unavailable." }
  Assert-ParserSecurityGroup $parserSecurityGroup $vpcId ([string]$prefixLists.PrefixLists[0].PrefixListId)
  foreach ($definition in @(
      @("document_scan_results", 345600, 360, [string]$state["module.platform.aws_sqs_queue.document_scan_dead_letter[0]"].arn),
      @("document_scan_dead_letter", 1209600, 30, ""),
      @("document_scan_delivery_dead_letter", 1209600, 30, "")
    )) {
    $queue = $state["module.platform.aws_sqs_queue.$($definition[0])[0]"]
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", [string]$queue.url, "--attribute-names", "All", "--output", "json")
    Assert-ExactDocumentQueueAttributes $attributes.Attributes $platformKmsArn ([int]$definition[1]) ([int]$definition[2]) ([string]$definition[3])
  }
  foreach ($policyAddress in @("document_scan_results", "document_scan_delivery_dead_letter")) {
    $queue = $state["module.platform.aws_sqs_queue.$policyAddress[0]"]
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", [string]$queue.url, "--attribute-names", "Policy", "--output", "json")
    if ((ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $attributes.Attributes.Policy) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue (ConvertFrom-IamPolicyValue $state["module.platform.aws_sqs_queue_policy.$policyAddress[0]"].policy) -SortArrays)) {
      throw "A parser-dark queue policy differs from reviewed state."
    }
  }
  foreach ($ruleAddress in @("document_scan_results", "document_processing_reconciler", "document_scan_tag_failure", "document_scan_plan_unhealthy")) {
    $rule = $state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"]
    $live = Invoke-AwsJson @("events", "describe-rule", "--name", [string]$rule.name, "--output", "json")
    $expectedState = if ($ruleAddress -in @("document_scan_tag_failure", "document_scan_plan_unhealthy")) { "ENABLED" } else { "DISABLED" }
    if ([string]$live.State -cne $expectedState) { throw "A parser-dark rule differs from its reviewed state." }
  }
  foreach ($targetAddress in @("document_scan_results", "document_scan_tag_failure", "document_scan_plan_unhealthy")) {
    $target = $state["module.platform.aws_cloudwatch_event_target.$targetAddress[0]"]
    Assert-EventTargetExact ([string]$target.rule) $target
  }
  $alarmNames = @($state.Keys | Where-Object { $_ -like "module.platform.aws_cloudwatch_metric_alarm.document_*" } | ForEach-Object { [string]$state[$_].alarm_name } | Sort-Object)
  $alarms = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $alarms = Invoke-AwsJson -Arguments (@("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json"))
    if (@($alarms.MetricAlarms).Count -eq 8 -and @($alarms.MetricAlarms | Where-Object StateValue -ne "OK").Count -eq 0) { break }
    Start-Sleep -Seconds 10
  }
  Assert-ExactDocumentAlarmSet @($alarms.MetricAlarms) $alarmNames ([string]$state["module.platform.aws_sns_topic.operational_alerts"].arn)
  $endpoints = Invoke-AwsJson @("ec2", "describe-vpc-endpoints", "--filters", "Name=vpc-id,Values=$vpcId", "--output", "json")
  foreach ($service in @("s3", "lambda", "sqs", "secretsmanager")) {
    $matching = @($endpoints.VpcEndpoints | Where-Object { $_.ServiceName -eq "com.amazonaws.$Region.$service" -and $_.State -eq "available" })
    if ($matching.Count -ne 1) { throw "The parser-dark $service endpoint boundary is unavailable." }
    $address = if ($service -eq "s3") { "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" } else { "module.platform.aws_vpc_endpoint.$service[0]" }
    if ((ConvertTo-DeploymentCanonicalValue ($matching[0].PolicyDocument | ConvertFrom-Json) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue ($state[$address].policy | ConvertFrom-Json) -SortArrays)) {
      throw "The parser-dark $service endpoint policy differs from reviewed state."
    }
  }
}

function Invoke-ZeroDrift {
  param([Parameter(Mandatory)][object]$Baseline, [AllowNull()][object]$Receipt,
    [Parameter(Mandatory)][string]$DeploymentStage, [string]$ParserQualifiedArn = "", [switch]$Retain)
  Set-DarkVariables -Baseline $Baseline -Receipt $Receipt -DeploymentStage $DeploymentStage -ParserQualifiedArn $ParserQualifiedArn
  $prefix = if ($Retain) { "baseline-$DeploymentStage-$($operatorCommit.Substring(0, 12))-$(Get-Date -Format 'yyyyMMdd-HHmmss')" } else { "verify" }
  $path = Join-Path $operatorRoot "$prefix-$([guid]::NewGuid().ToString('N')).tfplan"
  $metadataPath = "$path.baseline.json"
  Assert-RetainedBaselinePathsAvailable -PlanPath $path -MetadataPath $metadataPath
  $stateIdentityBefore = if ($Retain) { Get-StateIdentity } else { $null }
  $succeeded = $false
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m "-out=$path" -detailed-exitcode | Out-Null
    $code = $LASTEXITCODE
    if ($code -eq 1) { throw "The document dark zero-drift plan failed." }
    if ($code -eq 2) { throw "The deployed document dark boundary has drift." }
    $plan = Read-Plan -Path $path
    Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $plan
    if (-not $Retain) { $succeeded = $true; return $null }
    $stateIdentity = Get-StateIdentity
    Assert-StateIdentityStable -Before $stateIdentityBefore -After $stateIdentity
    $result = Save-RetainedBaselineMetadata -ReleaseSourceSha $releaseCommit -OperatorSourceSha $operatorCommit `
      -OperatorDeltaSha256 $operatorDeltaSha256 -DeploymentStage $DeploymentStage `
      -PlanPath $path -StateLineage $stateIdentity.Lineage -StateSerial $stateIdentity.Serial `
      -ReceiptSha256 $(if ($null -eq $Receipt) { "" } else { $ReviewedReceiptSha256 }) `
      -ParserQualifiedArn $ParserQualifiedArn
    $succeeded = $true
    return $result
  }
  finally {
    if (-not $Retain -or -not $succeeded) {
      Remove-NewRetainedBaselineArtifacts -PlanPath $path -MetadataPath $metadataPath
    }
  }
}

function Invoke-CompleteDarkBaselineBootstrap {
  param(
    [Parameter(Mandatory)][object]$HistoricalBaseline,
    [Parameter(Mandatory)][object]$CurrentBaseline,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ParserQualifiedArn
  )
  Set-CompleteDarkBootstrapVariables
  Assert-LiveStageBoundary -DeploymentStage "complete-dark" -Receipt $Receipt `
    -ParserQualifiedArn $ParserQualifiedArn -Baseline $CurrentBaseline
  $path = Join-Path $operatorRoot "bootstrap-complete-dark-$($operatorCommit.Substring(0, 12))-$([guid]::NewGuid().ToString('N')).tfplan"
  $metadataPath = "$path.baseline.json"
  Assert-RetainedBaselinePathsAvailable -PlanPath $path -MetadataPath $metadataPath
  $before = Get-StateIdentity
  $succeeded = $false
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      "-out=$path" -detailed-exitcode | Out-Null
    $code = $LASTEXITCODE
    if ($code -eq 1) { throw "The CompleteDark bootstrap zero-drift plan failed." }
    if ($code -eq 2) { throw "The historical CompleteDark variables do not match current live state." }
    $plan = Read-Plan -Path $path
    Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $plan
    $after = Get-StateIdentity
    Assert-StateIdentityStable -Before $before -After $after
    $planSha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $priorMetadata = $script:bootstrapInputMetadata
    $priorOperator = if ([string]$priorMetadata.SchemaVersion -ceq "5") {
      [string]$priorMetadata.DocumentOperatorSourceSha
    } else { [string]$priorMetadata.OperatorSourceSha }
    $metadata = [ordered]@{
      SchemaVersion = "6"; Kind = "development-document-zero-drift-baseline"
      Environment = "development"; AccountId = $ExpectedAccountId; Region = $Region
      DeltaKind = "complete-dark-bootstrap-full-source-v1"
      ReleaseSourceSha = $releaseCommit; OperatorSourceSha = $operatorCommit
      OperatorDeltaSha256 = $operatorDeltaSha256
      PriorBaselinePlanSha256 = $ReviewedBaselineSha256
      PriorBaselineMetadataSha256 = $ReviewedBaselineMetadataSha256
      CurrentTemplatePlanSha256 = $ReviewedCurrentTemplateSha256
      CurrentTemplateReceiptSha256 = $ReviewedCurrentTemplateReceiptSha256
      PriorBaselineSchemaVersion = [string]$priorMetadata.SchemaVersion
      PriorBaselineStateSerial = [long]$priorMetadata.StateSerial
      PriorBaselineOperatorSourceSha = $priorOperator
      PriorBaselineToOperatorDeltaSha256 = $ReviewedBaselineToOperatorDeltaSha256
      StateLineage = [string]$after.Lineage; StateSerial = [long]$after.Serial
      Stage = "complete-dark"; ReceiptSha256 = $ReviewedReceiptSha256
      ParserQualifiedArn = $ParserQualifiedArn
      MigrationImage = [string]$plan.variables.migration_image.value
      PlanPath = $path; PlanSha256 = $planSha; Applyable = $false; MeaningfulChanges = 0
      CreatedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    Write-ExclusiveJsonFile -Path $metadataPath -Value $metadata
    $metadataSha = (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $succeeded = $true
    return [pscustomobject]@{
      PlanPath = $path; PlanSha256 = $planSha
      MetadataPath = $metadataPath; MetadataSha256 = $metadataSha
    }
  }
  finally {
    if (-not $succeeded) { Remove-NewRetainedBaselineArtifacts -PlanPath $path -MetadataPath $metadataPath }
  }
}

function Get-StateIdentity {
  $raw = & terraform "-chdir=$terraformDirectory" state pull 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw "Terraform state identity could not be read." }
  $state = $raw | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$state.lineage) -or [long]$state.serial -lt 1) {
    throw "Terraform state lacks a valid lineage or serial."
  }
  return [pscustomobject]@{ Lineage = [string]$state.lineage; Serial = [long]$state.serial }
}

function Get-AppliedDocumentStage {
  $state = Get-StateResourceMap
  $hasParser = $state.ContainsKey("module.platform.aws_lambda_function.document_parser[0]")
  $hasProcessor = $state.ContainsKey("module.platform.aws_lambda_function.document_processor[0]")
  if ($hasProcessor -and -not $hasParser) { throw "Applied document stage is contradictory: processor exists without parser." }
  if ($hasProcessor) { return "complete-dark" }
  if ($hasParser) { return "parser-dark" }
  $kmsPolicy = ConvertFrom-IamPolicyValue $state["module.platform.aws_kms_key.platform"].policy
  $kmsSids = @($kmsPolicy.Statement.Sid | ForEach-Object { [string]$_ })
  $documentKmsSids = @("AllowEventBridgeDocumentScanQueueEncryption", "AllowEventBridgeDocumentOperationalAlertEncryption")
  $present = @($documentKmsSids | Where-Object { $_ -in $kmsSids }).Count
  if ($present -eq 0) { return "disabled" }
  if ($present -ne 2) { throw "Applied KMS prerequisite is partial or contradictory." }
  return "kms-prerequisite"
}

function Get-AppliedParserQualifiedArn {
  $state = Get-StateResourceMap
  $parser = $state["module.platform.aws_lambda_function.document_parser[0]"]
  $arn = if ($null -eq $parser) { "" } else { [string]$parser.qualified_arn }
  if ($arn -cnotmatch "^arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$") {
    throw "The applied parser does not expose one exact positive numeric version ARN."
  }
  return $arn
}

function Get-AppliedProcessorParserQualifiedArn {
  $state = Get-StateResourceMap
  $processor = $state["module.platform.aws_lambda_function.document_processor[0]"]
  $environment = @()
  if ($null -ne $processor) { $environment = @($processor.environment) }
  $variables = if ($environment.Count -eq 1) { $environment[0].variables } else { $null }
  $arn = if ($null -eq $variables) { "" } else { [string]$variables.DOCUMENT_PARSER_FUNCTION_ARN }
  if ($arn -cne "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:1") {
    throw "The applied CompleteDark processor does not expose the exact retained parser-v1 pin."
  }
  return $arn
}

function Assert-LivePinnedParserVersion {
  param([Parameter(Mandatory)][object]$Baseline, [Parameter(Mandatory)][string]$ParserQualifiedArn,
    [AllowNull()][object]$ExpectedArtifact, [switch]$MustMatchBaselineArtifact)
  if ($ParserQualifiedArn -cnotmatch "^arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:([1-9][0-9]*)$") {
    throw "The processor parser pin is not one exact applied numeric version."
  }
  $pinnedVersion = [string]$Matches[1]
  $artifactSha = if ($null -eq $ExpectedArtifact) {
    [string]$Baseline.variables.document_parser_artifact_sha256.value
  } else { [string]$ExpectedArtifact.artifactSha256 }
  $objectSha = if ($null -eq $ExpectedArtifact) {
    [string]$Baseline.variables.document_parser_artifact_base64sha256.value
  } else { [string]$ExpectedArtifact.objectBase64Sha256 }
  if ($artifactSha -cnotmatch '^[a-f0-9]{64}$' -or $objectSha -cnotmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The retained baseline parser artifact identity is invalid."
  }
  $pinned = Invoke-AwsJson @("lambda", "get-function", "--function-name", $ParserQualifiedArn, "--output", "json")
  if ([string]$pinned.Configuration.FunctionArn -cne $ParserQualifiedArn -or
    [string]$pinned.Configuration.Version -cne $pinnedVersion -or
    [string]$pinned.Configuration.CodeSha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
    [string]$pinned.Configuration.Environment.Variables.RELEASE_SHA -cnotmatch '^[a-f0-9]{64}$' -or
    [string]$pinned.Configuration.State -cne "Active" -or
    [string]$pinned.Configuration.LastUpdateStatus -cne "Successful") {
    throw "The processor parser pin does not resolve to one healthy immutable parser version."
  }
  if ($MustMatchBaselineArtifact -and (
      [string]$pinned.Configuration.CodeSha256 -cne $objectSha -or
      [string]$pinned.Configuration.Environment.Variables.RELEASE_SHA -cne $artifactSha)) {
    throw "The source-transition parser pin does not match the retained immutable ParserDark artifact."
  }
}

function Assert-MonotonicDocumentStage {
  param([Parameter(Mandatory)][string]$Applied, [Parameter(Mandatory)][string]$Requested,
    [Parameter(Mandatory)][string]$Operation, [switch]$CompleteDarkRefresh)
  $rank = @{ "disabled" = 0; "kms-prerequisite" = 1; "parser-dark" = 2; "complete-dark" = 3 }
  if (-not $rank.ContainsKey($Applied) -or -not $rank.ContainsKey($Requested)) { throw "Unknown document stage." }
  if ($Operation -ceq "Bootstrap") {
    if ($Applied -cne "complete-dark" -or $Requested -cne "complete-dark") {
      throw "Bootstrap requires the exact already-applied CompleteDark stage."
    }
    return
  }
  if ($Operation -ceq "Verify") {
    if ($rank[$Requested] -ne $rank[$Applied]) { throw "Verify requires the exact currently applied document stage '$Applied'." }
    return
  }
  if ($CompleteDarkRefresh) {
    if ($Applied -cne "complete-dark" -or $Requested -cne "complete-dark" -or $Operation -notin @("Plan", "Apply")) {
      throw "A CompleteDark refresh must remain at the exact already-applied CompleteDark stage."
    }
    return
  }
  if ($rank[$Requested] -ne ($rank[$Applied] + 1)) {
    throw "A saved plan may advance exactly one stage from '$Applied'; requested '$Requested'."
  }
}

function Assert-LiveStageBoundary {
  param([Parameter(Mandatory)][string]$DeploymentStage, [AllowNull()][object]$Receipt,
    [string]$ParserQualifiedArn = "", [AllowNull()][object]$Baseline,
    [AllowNull()][object]$ExpectedPinnedParserArtifact,
    [switch]$PinnedParserMatchesBaselineArtifact)
  $state = Get-StateResourceMap
  $inventory = if ($DeploymentStage -ceq "kms-prerequisite") { $null } else { Get-LiveDocumentStageInventory -State $state }
  $requiredParser = @(
    "module.platform.aws_lambda_function.document_parser[0]",
    "module.platform.aws_lambda_alias.document_parser[0]",
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
  )
  $completeOnly = @(
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )
  if ($DeploymentStage -ceq "kms-prerequisite") {
    foreach ($address in $requiredParser + $completeOnly) {
      if ($state.ContainsKey($address)) { throw "KMS-prerequisite unexpectedly contains '$address'." }
    }
    return
  }
  Assert-DevelopmentDocumentStageResourceInventory -Stage $DeploymentStage -StateAddresses @($state.Keys) -LiveInventory $inventory
  foreach ($address in $requiredParser) {
    if (-not $state.ContainsKey($address)) { throw "The applied parser-dark boundary is missing '$address'." }
  }
  if ($DeploymentStage -ceq "parser-dark") {
    foreach ($address in $completeOnly) {
      if ($state.ContainsKey($address)) { throw "Parser-dark unexpectedly contains '$address'." }
    }
  } else {
    foreach ($address in $completeOnly) {
      if (-not $state.ContainsKey($address)) { throw "Complete-dark is missing '$address'." }
    }
  }
  $parserArtifact = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })[0]
  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", "ai-job-apply-development-document-parser", "--name", "development", "--output", "json")
  $deployed = Invoke-AwsJson @("lambda", "get-function", "--function-name", "ai-job-apply-development-document-parser:development", "--output", "json")
  if ([string]$alias.FunctionVersion -cnotmatch "^[1-9][0-9]*$" -or
    [string]$deployed.Configuration.CodeSha256 -cne [string]$parserArtifact.objectBase64Sha256 -or
    [string]$deployed.Configuration.Environment.Variables.RELEASE_SHA -cne [string]$parserArtifact.artifactSha256) {
    throw "The live parser alias is not the checksum-reviewed immutable artifact."
  }
  foreach ($ruleAddress in @("document_scan_results", "document_scan_tag_failure", "document_scan_plan_unhealthy", "document_processing_reconciler")) {
    $rule = $state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"]
    $live = Invoke-AwsJson @("events", "describe-rule", "--name", [string]$rule.name, "--output", "json")
    $expectedState = if ($ruleAddress -in @("document_scan_tag_failure", "document_scan_plan_unhealthy")) { "ENABLED" } else { "DISABLED" }
    if ([string]$live.State -cne $expectedState) { throw "A document EventBridge rule differs from its processing-dark/security-alert state." }
  }
  if ($DeploymentStage -ceq "complete-dark") {
    if ($null -eq $Baseline) { throw "Complete-dark live verification requires the retained parser baseline." }
    Assert-LivePinnedParserVersion -Baseline $Baseline -ParserQualifiedArn $ParserQualifiedArn `
      -ExpectedArtifact $ExpectedPinnedParserArtifact `
      -MustMatchBaselineArtifact:$PinnedParserMatchesBaselineArtifact
    $processorArtifact = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-processor-lambda" -and $_.suffix -eq "zip" })[0]
    $processor = Invoke-AwsJson @("lambda", "get-function", "--function-name", "ai-job-apply-development-document-processor:development", "--output", "json")
    if ([string]$processor.Configuration.CodeSha256 -cne [string]$processorArtifact.objectBase64Sha256 -or
      [string]$processor.Configuration.Environment.Variables.DOCUMENT_PARSER_FUNCTION_ARN -cne $ParserQualifiedArn) {
      throw "The live processor does not match the reviewed artifact and parser-version pin."
    }
    $mapping = Invoke-AwsJson @("lambda", "list-event-source-mappings", "--function-name", "ai-job-apply-development-document-processor:development", "--output", "json")
    if (@($mapping.EventSourceMappings).Count -ne 1 -or [string]$mapping.EventSourceMappings[0].State -cne "Disabled") {
      throw "The complete-dark document mapping is not exactly disabled."
    }
    Assert-NoLambdaResourcePolicy -FunctionName "ai-job-apply-development-document-parser"
    Assert-ExactProcessorLambdaResourcePolicy -FunctionName "ai-job-apply-development-document-processor" `
      -ExpectedSourceArn ([string]$state["module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"].arn)
    Assert-LiveDarkBoundary -Receipt $Receipt -ParserQualifiedArn $ParserQualifiedArn
  }
  else {
    Assert-LiveParserDarkBoundary -Receipt $Receipt
  }
}

$sourceBinding = Assert-CallerAndSource
$releaseCommit = [string]$sourceBinding.Release
$operatorCommit = [string]$sourceBinding.Operator
$operatorDeltaSha256 = [string]$sourceBinding.DeltaSha256
$commit = $operatorCommit
Initialize-Backend
$null = New-Item -ItemType Directory -Path $operatorRoot -Force
$script:bootstrapTemplate = if ($Action -ceq "Bootstrap") { Read-CurrentBootstrapTemplate } else { $null }
$appliedStage = Get-AppliedDocumentStage
Assert-MonotonicDocumentStage -Applied $appliedStage -Requested $stageValue -Operation $Action `
  -CompleteDarkRefresh:($completeDarkParserRefresh -or $completeDarkProcessorRefresh)
$retainedParserEvidence = if ($appliedGatewayRecoveryRequested) {
  Read-AppliedGatewayRetainedParserReceipt
} else { $null }
$script:retainedParserArtifact = if ($null -eq $retainedParserEvidence) {
  $null
} else { $retainedParserEvidence.ParserArtifact }
$receipt = if ($Stage -ceq "KmsPrerequisite") { $null } else { Read-Receipt -Commit $releaseCommit }
$script:currentReceipt = $receipt
$bootstrapDocumentEvidence = if ($Action -ceq "Bootstrap") {
  Get-CurrentBootstrapDocumentEvidence -Template $script:bootstrapTemplate
} else { $null }
$script:parserRefreshEvidence = if ($completeDarkProcessorRefresh) { Read-ParserRefreshReceipt } else { $null }
$baseline = Read-Baseline -RequestedStage $stageValue -AppliedStage $appliedStage -Operation $Action -Receipt $receipt
if (-not $parserSourceTransition -and -not $completeDarkVerifyRecovery -and
  -not $completeDarkAppliedGatewayRecovery -and -not $completeDarkParserRefresh -and
  -not $completeDarkProcessorRefresh -and $Action -cne "Bootstrap" -and
  -not [string]::IsNullOrEmpty($ReviewedBaselineToOperatorDeltaSha256)) {
  throw "A baseline-to-current operator delta is accepted only for an explicit CompleteDark parser source transition."
}
$parserQualifiedArn = if ($Stage -ceq "CompleteDark") {
  if ($Action -ceq "Bootstrap") { [string]$script:bootstrapTemplate.variables.document_parser_invocation_qualified_arn.value }
  elseif ($completeDarkProcessorRefresh) { [string]$parserRefreshEvidence.ParserQualifiedArn }
  elseif ($completeDarkVerifyRecovery) { Get-AppliedProcessorParserQualifiedArn }
  elseif ($appliedStage -ceq "parser-dark") { Get-AppliedParserQualifiedArn }
  else { [string]$baseline.variables.document_parser_invocation_qualified_arn.value }
} else { "" }
if ($parserSourceTransition -or $completeDarkVerifyRecovery -or $completeDarkAppliedGatewayRecovery -or
  $completeDarkParserRefresh) {
  Assert-LivePinnedParserVersion -Baseline $baseline -ParserQualifiedArn $parserQualifiedArn `
    -ExpectedArtifact $script:retainedParserArtifact -MustMatchBaselineArtifact
}
if ($completeDarkProcessorRefresh) {
  $targetParserArtifact = @($receipt.artifacts | Where-Object { $_.artifactName -ceq "document-parser-lambda" -and $_.suffix -ceq "zip" })[0]
  Assert-LivePinnedParserVersion -Baseline $baseline -ParserQualifiedArn $parserQualifiedArn `
    -ExpectedArtifact $targetParserArtifact -MustMatchBaselineArtifact
}
if ($completeDarkParserRefresh -or $completeDarkProcessorRefresh) {
  $baselineParserArtifact = [pscustomobject]@{
    artifactName = "document-parser-lambda"; suffix = "zip"
    key = [string]$baseline.variables.document_parser_artifact_s3_key.value
    versionId = [string]$baseline.variables.document_parser_artifact_s3_object_version.value
    artifactSha256 = [string]$baseline.variables.document_parser_artifact_sha256.value
    objectBase64Sha256 = [string]$baseline.variables.document_parser_artifact_base64sha256.value
  }
  $baselineProcessorArtifact = [pscustomobject]@{
    artifactName = "document-processor-lambda"; suffix = "zip"
    key = [string]$baseline.variables.document_processor_artifact_s3_key.value
    versionId = [string]$baseline.variables.document_processor_artifact_s3_object_version.value
    artifactSha256 = [string]$baseline.variables.document_processor_artifact_sha256.value
    objectBase64Sha256 = [string]$baseline.variables.document_processor_artifact_base64sha256.value
  }
  $liveParserArtifact = if ($completeDarkProcessorRefresh) { $targetParserArtifact } else { $baselineParserArtifact }
  $liveReceipt = [pscustomobject]@{ artifacts = @($baselineProcessorArtifact, $liveParserArtifact) }
  $liveProcessorPin = [string]$baseline.variables.document_parser_invocation_qualified_arn.value
  Assert-LiveStageBoundary -DeploymentStage "complete-dark" -Receipt $liveReceipt `
    -ParserQualifiedArn $liveProcessorPin -Baseline $baseline `
    -ExpectedPinnedParserArtifact $baselineParserArtifact -PinnedParserMatchesBaselineArtifact
}

if ($Action -ceq "Bootstrap") {
  $bootstrapped = Invoke-CompleteDarkBaselineBootstrap -HistoricalBaseline $baseline `
    -CurrentBaseline $script:bootstrapTemplate -Receipt $bootstrapDocumentEvidence `
    -ParserQualifiedArn $parserQualifiedArn
  [pscustomobject]@{
    Result = "complete-dark-baseline-bootstrapped"; Environment = "development"; Stage = "complete-dark"
    ProcessingTriggers = "disabled"; Drift = $false
    BaselinePath = $bootstrapped.PlanPath; BaselineSha256 = $bootstrapped.PlanSha256
    BaselineMetadataPath = $bootstrapped.MetadataPath
    BaselineMetadataSha256 = $bootstrapped.MetadataSha256
    ApprovalCommand = "Use reviewed current-state CompleteDark bootstrap baseline $($bootstrapped.PlanSha256)"
  } | ConvertTo-Json
  exit 0
}

if ($Action -ceq "Verify") {
  Set-DarkVariables -Baseline $baseline -Receipt $receipt -DeploymentStage $stageValue -ParserQualifiedArn $parserQualifiedArn
  Assert-LiveStageBoundary -DeploymentStage $stageValue -Receipt $receipt -ParserQualifiedArn $parserQualifiedArn `
    -Baseline $baseline -ExpectedPinnedParserArtifact $script:retainedParserArtifact `
    -PinnedParserMatchesBaselineArtifact:($completeDarkVerifyRecovery -or $completeDarkAppliedGatewayRecovery)
  $retainedBaseline = Invoke-ZeroDrift -Baseline $baseline -Receipt $receipt -DeploymentStage $stageValue `
    -ParserQualifiedArn $parserQualifiedArn -Retain
  [pscustomobject]@{ Result = "verified"; Environment = "development"; Stage = $stageValue; ProcessingTriggers = "disabled"; SecurityHealthRules = $(if ($Stage -eq "KmsPrerequisite") { "not-deployed" } else { "enabled" }); Drift = $false
    BaselinePath = $retainedBaseline.PlanPath; BaselineSha256 = $retainedBaseline.PlanSha256
    BaselineMetadataPath = $retainedBaseline.MetadataPath
    BaselineMetadataSha256 = $retainedBaseline.MetadataSha256
    ApprovalCommand = "Use verified development $stageValue migration baseline $($retainedBaseline.PlanSha256)" } | ConvertTo-Json
  exit 0
}

Set-DarkVariables -Baseline $baseline -Receipt $receipt -DeploymentStage $stageValue -ParserQualifiedArn $parserQualifiedArn
$operation = "development-document-$stageValue"
$metadataSuffix = ".document-$stageValue.json"
if ($Action -ceq "Plan") {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) { $PlanPath = Join-Path $operatorRoot "$stageValue-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan" }
  $resolved = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot
  if (Test-Path -LiteralPath $resolved) { throw "Refusing to overwrite an existing saved plan." }
  $stateIdentity = Get-StateIdentity
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m "-out=$resolved" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The refresh-backed $stageValue plan failed." }
    $plan = Read-Plan -Path $resolved
    if ($Stage -ceq "KmsPrerequisite") {
      Assert-DevelopmentDocumentKmsPrerequisiteVariables $baseline.variables $plan.variables
      $changes = @(Assert-DevelopmentDocumentKmsPrerequisitePlan -Plan $plan -AccountId $ExpectedAccountId)
    } else {
      Assert-DevelopmentDocumentDarkVariables $baseline.variables $plan.variables $receipt $stageValue $parserQualifiedArn `
        -CompleteDarkParserRefresh:$completeDarkParserRefresh
      $changes = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $ExpectedAccountId -Stage $stageValue `
        -ParserSourceTransition:$parserSourceTransition -BaselineVariables $baseline.variables `
        -CompleteDarkParserRefresh:$completeDarkParserRefresh `
        -CompleteDarkProcessorRefresh:$completeDarkProcessorRefresh `
        -Receipt $receipt -ParserQualifiedArn $parserQualifiedArn
    }
  } catch { if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Force }; throw }
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  $planMetadata = [ordered]@{
    SchemaVersion = "2"
    Operation = $operation; Stage = $stageValue; AccountId = $ExpectedAccountId
    Region = $Region; StateBucket = $StateBucket; StateKey = "platform.tfstate"
    StateLineage = $stateIdentity.Lineage; StateSerial = $stateIdentity.Serial
  }
  $planMetadata.Commit = $operatorCommit
  $planMetadata.BaselineSha256 = $ReviewedBaselineSha256
  $planMetadata.BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256
  $planMetadata.BaselineReceiptSha256 = $baselineReceiptSha256
  $planMetadata.BaselineToOperatorDeltaSha256 = $ReviewedBaselineToOperatorDeltaSha256
  $planMetadata.ParserSourceTransition = [bool]$parserSourceTransition
  $planMetadata.RefreshStep = $RefreshStep
  $planMetadata.ParserRefreshReceiptSha256 = $(if ($completeDarkProcessorRefresh) { $ReviewedParserRefreshReceiptSha256 } else { "" })
  $planMetadata.ReceiptSha256 = $(if ($null -eq $receipt) { "" } else { $ReviewedReceiptSha256 })
  $planMetadata.ParserQualifiedArn = $parserQualifiedArn; $planMetadata.PlanPath = $resolved
  $planMetadata.PlanSha256 = $sha; $planMetadata.CreatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $planMetadata | ConvertTo-Json | Set-Content -LiteralPath "$resolved$metadataSuffix" -Encoding utf8
  $creates = @($changes | Where-Object { (@($_.change.actions) -join ",") -ceq "create" }).Count
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -ceq "update" }).Count
  [pscustomobject]@{ Result = "review-required"; Stage = $stageValue; Creates = $creates; Updates = $updates
    PlanPath = $resolved; PlanSha256 = $sha; ApprovalCommand = "Apply reviewed development $stageValue plan $sha" } | ConvertTo-Json
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlanPath) -or [string]::IsNullOrWhiteSpace($ReviewedPlanSha256)) {
  throw "Apply requires the exact saved plan and reviewed SHA-256."
}
$resolved = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot -MustExist
$actual = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $ReviewedPlanSha256) { throw "The staged plan checksum does not match review." }
$metadataPath = "$resolved$metadataSuffix"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "Staged plan metadata is missing." }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$expectedPlanMetadata = @{
  SchemaVersion = "2"
  Operation = $operation; Stage = $stageValue; AccountId = $ExpectedAccountId
  Region = $Region; StateBucket = $StateBucket; StateKey = "platform.tfstate"
  ReceiptSha256 = $(if ($null -eq $receipt) { "" } else { $ReviewedReceiptSha256 })
  ParserQualifiedArn = $parserQualifiedArn; PlanPath = $resolved; PlanSha256 = $ReviewedPlanSha256
  BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256
  BaselineReceiptSha256 = $baselineReceiptSha256
  BaselineToOperatorDeltaSha256 = $ReviewedBaselineToOperatorDeltaSha256
  ParserSourceTransition = [bool]$parserSourceTransition
  RefreshStep = $RefreshStep
  ParserRefreshReceiptSha256 = $(if ($completeDarkProcessorRefresh) { $ReviewedParserRefreshReceiptSha256 } else { "" })
}
$expectedPlanMetadata.BaselineSha256 = $ReviewedBaselineSha256
$expectedPlanMetadata.Commit = $operatorCommit
Assert-ReviewedPlanMetadata -Metadata $metadata -Expected $expectedPlanMetadata
$stateIdentity = Get-StateIdentity
if ([string]$stateIdentity.Lineage -cne [string]$metadata.StateLineage -or [long]$stateIdentity.Serial -ne [long]$metadata.StateSerial) {
  throw "Remote state lineage or serial changed after review; generate a new plan."
}
$plan = Read-Plan -Path $resolved
if ($Stage -ceq "KmsPrerequisite") {
  Assert-DevelopmentDocumentKmsPrerequisiteVariables $baseline.variables $plan.variables
  $null = Assert-DevelopmentDocumentKmsPrerequisitePlan -Plan $plan -AccountId $ExpectedAccountId
} else {
  Assert-DevelopmentDocumentDarkVariables $baseline.variables $plan.variables $receipt $stageValue $parserQualifiedArn `
    -CompleteDarkParserRefresh:$completeDarkParserRefresh
  $null = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $ExpectedAccountId -Stage $stageValue `
    -ParserSourceTransition:$parserSourceTransition -BaselineVariables $baseline.variables `
    -CompleteDarkParserRefresh:$completeDarkParserRefresh `
    -CompleteDarkProcessorRefresh:$completeDarkProcessorRefresh `
    -Receipt $receipt -ParserQualifiedArn $parserQualifiedArn
}
& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolved
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed $stageValue plan failed to apply." }
if ($completeDarkParserRefresh) {
  $afterState = Get-StateIdentity
  if ([string]$afterState.Lineage -cne [string]$stateIdentity.Lineage -or
    [long]$afterState.Serial -le [long]$stateIdentity.Serial) {
    throw "The parser refresh did not advance the exact reviewed state lineage monotonically."
  }
  $newParserQualifiedArn = Get-AppliedParserQualifiedArn
  if ($newParserQualifiedArn -ceq $parserQualifiedArn) { throw "The parser refresh did not publish a new numeric parser version." }
  $oldProcessorArtifact = [pscustomobject]@{
    artifactName = "document-processor-lambda"; suffix = "zip"
    key = [string]$baseline.variables.document_processor_artifact_s3_key.value
    versionId = [string]$baseline.variables.document_processor_artifact_s3_object_version.value
    artifactSha256 = [string]$baseline.variables.document_processor_artifact_sha256.value
    objectBase64Sha256 = [string]$baseline.variables.document_processor_artifact_base64sha256.value
  }
  $targetParserArtifact = @($receipt.artifacts | Where-Object { $_.artifactName -ceq "document-parser-lambda" -and $_.suffix -ceq "zip" })[0]
  $mixedReceipt = [pscustomobject]@{ artifacts = @($oldProcessorArtifact, $targetParserArtifact) }
  Assert-LiveStageBoundary -DeploymentStage "complete-dark" -Receipt $mixedReceipt `
    -ParserQualifiedArn $parserQualifiedArn -Baseline $baseline `
    -ExpectedPinnedParserArtifact $null -PinnedParserMatchesBaselineArtifact
  $null = Invoke-ZeroDrift -Baseline $baseline -Receipt $receipt -DeploymentStage "complete-dark" `
    -ParserQualifiedArn $parserQualifiedArn
  $receiptPath = Join-Path $operatorRoot "parser-refresh-$($operatorCommit.Substring(0, 12))-$([guid]::NewGuid().ToString('N')).json"
  $refreshReceipt = [ordered]@{
    SchemaVersion = "1"; Kind = "development-document-complete-dark-parser-refresh"
    Environment = "development"; AccountId = $ExpectedAccountId; Region = $Region
    ReleaseSourceSha = $releaseCommit; OperatorSourceSha = $operatorCommit
    BaselineSha256 = $ReviewedBaselineSha256; BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256
    BaselineReceiptSha256 = $baselineReceiptSha256; TargetReceiptSha256 = $ReviewedReceiptSha256
    ParserPlanSha256 = $ReviewedPlanSha256; StateLineage = [string]$afterState.Lineage
    BeforeStateSerial = [long]$stateIdentity.Serial; AfterStateSerial = [long]$afterState.Serial
    ParserQualifiedArn = $newParserQualifiedArn
    ParserArtifactSha256 = [string]$targetParserArtifact.artifactSha256
    ParserArtifactBase64Sha256 = [string]$targetParserArtifact.objectBase64Sha256
    CreatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-ExclusiveJsonFile -Path $receiptPath -Value $refreshReceipt
  $refreshReceiptSha = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Result = "parser-refreshed-review-required"; Environment = "development"; Stage = "complete-dark"
    ProcessingTriggers = "disabled"; ParserQualifiedArn = $newParserQualifiedArn
    ParserRefreshReceiptPath = $receiptPath; ParserRefreshReceiptSha256 = $refreshReceiptSha
    ApprovalCommand = "Apply reviewed CompleteDark processor refresh bound to parser receipt $refreshReceiptSha"
  } | ConvertTo-Json
  exit 0
}
Assert-LiveStageBoundary -DeploymentStage $stageValue -Receipt $receipt -ParserQualifiedArn $parserQualifiedArn `
  -Baseline $baseline -PinnedParserMatchesBaselineArtifact:$parserSourceTransition
$postApplyBaseline = Invoke-ZeroDrift -Baseline $baseline -Receipt $receipt -DeploymentStage $stageValue `
  -ParserQualifiedArn $parserQualifiedArn -Retain:($Stage -ceq "CompleteDark")
$result = [ordered]@{ Result = "applied-and-verified"; Environment = "development"; Stage = $stageValue; ProcessingTriggers = "disabled"; SecurityHealthRules = $(if ($Stage -eq "KmsPrerequisite") { "not-deployed" } else { "enabled" }); Drift = $false }
if ($null -ne $postApplyBaseline) {
  $result.BaselinePath = $postApplyBaseline.PlanPath
  $result.BaselineSha256 = $postApplyBaseline.PlanSha256
  $result.BaselineMetadataPath = $postApplyBaseline.MetadataPath
  $result.BaselineMetadataSha256 = $postApplyBaseline.MetadataSha256
}
[pscustomobject]$result | ConvertTo-Json
exit 0
