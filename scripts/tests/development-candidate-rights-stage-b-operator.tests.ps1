$ErrorActionPreference = "Stop"
$env:CANDIDATE_RIGHTS_STAGE_B_OPERATOR_TEST_ONLY = "1"
. (Join-Path $PSScriptRoot "..\operate-development-candidate-rights-stage-b.ps1")

$passed = 0
function Assert-Rejected([scriptblock]$Operation, [string]$Message) {
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function New-Change([string]$Address, [string]$Type, [string[]]$Actions) {
  return [pscustomobject]@{ address = $Address; type = $Type; change = [pscustomobject]@{ actions = $Actions } }
}

$required = @(
  (New-Change "module.platform.aws_eip.nat[0]" "aws_eip" @("create")),
  (New-Change "module.platform.aws_nat_gateway.this[0]" "aws_nat_gateway" @("create")),
  (New-Change "module.platform.aws_s3_bucket.candidate_data_exports[0]" "aws_s3_bucket" @("create")),
  (New-Change "module.platform.aws_s3_bucket.candidate_deletion_recovery[0]" "aws_s3_bucket" @("create")),
  (New-Change "module.platform.aws_s3_bucket_object_lock_configuration.candidate_deletion_recovery[0]" "aws_s3_bucket_object_lock_configuration" @("create")),
  (New-Change "module.platform.aws_iam_role_policy.candidate_rights_activity[0]" "aws_iam_role_policy" @("create")),
  (New-Change "module.platform.aws_cloudwatch_event_rule.candidate_rights_maintenance[0]" "aws_cloudwatch_event_rule" @("create")),
  (New-Change "module.platform.aws_cloudwatch_event_target.candidate_rights_maintenance[0]" "aws_cloudwatch_event_target" @("create")),
  (New-Change "module.platform.aws_lambda_permission.candidate_rights_maintenance[0]" "aws_lambda_permission" @("create")),
  (New-Change "module.platform.aws_lambda_function.gateway[0]" "aws_lambda_function" @("update")),
  (New-Change "module.platform.aws_lambda_alias.gateway[0]" "aws_lambda_alias" @("update")),
  (New-Change "module.platform.aws_lambda_function.profile_readiness_activity[0]" "aws_lambda_function" @("update")),
  (New-Change "module.platform.aws_lambda_alias.profile_readiness_activity[0]" "aws_lambda_alias" @("update")),
  (New-Change "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]" "aws_cloudwatch_event_rule" @("update")),
  (New-Change "module.platform.aws_iam_role_policy.outbox_starter[0]" "aws_iam_role_policy" @("update")),
  (New-Change "module.platform.aws_lambda_function.outbox_starter[0]" "aws_lambda_function" @("update")),
  (New-Change "module.platform.aws_lambda_alias.outbox_starter[0]" "aws_lambda_alias" @("update")),
  (New-Change "module.platform.aws_lambda_function.profile_readiness_terminal[0]" "aws_lambda_function" @("update")),
  (New-Change "module.platform.aws_lambda_alias.profile_readiness_terminal[0]" "aws_lambda_alias" @("update")),
  (New-Change "module.platform.aws_vpc_endpoint.lambda[0]" "aws_vpc_endpoint" @("update"))
)
$null = Assert-StageBChangeSet $required; $passed++
$summary = Get-ChangeSummary $required
if ($summary.Count -ne 20 -or $summary.Counts.create -ne 9 -or $summary.Counts.update -ne 11 -or $summary.Digest -notmatch '^[a-f0-9]{64}$') { throw "Aggregate change summary failed." }
$passed++

Assert-Rejected { Assert-StageBChangeSet @($required + (New-Change "module.platform.aws_db_instance.postgres" "aws_db_instance" @("delete", "create"))) } "Durable replacement accepted."
Assert-Rejected { Assert-StageBChangeSet @($required + (New-Change "module.platform.aws_iam_user.operator" "aws_iam_user" @("create"))) } "Unexpected address accepted."
Assert-Rejected { Assert-StageBChangeSet @($required + (New-Change "module.platform.aws_lambda_function.gateway[0]" "aws_lambda_function" @("delete"))) } "Unexpected action accepted."
Assert-Rejected { Assert-StageBChangeSet @($required | Select-Object -Skip 1) } "Missing required change accepted."
Assert-Rejected { Assert-StageBChangeSet @($required | Where-Object address -cne "module.platform.aws_iam_role_policy.outbox_starter[0]") } "Missing exact-version outbox transition accepted."

$artifact = [pscustomobject]@{ key = "lambda/gateway/source/artifact/gateway.zip"; versionId = "version"; artifactSha256 = "a" * 64; objectBase64Sha256 = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=" }
$baselineVariables = [pscustomobject]@{
  candidate_rights_enabled = [pscustomobject]@{ value = $false }
  private_application_networking = [pscustomobject]@{ value = $false }
  candidate_rights_id_token_audience = [pscustomobject]@{ value = "" }
  candidate_rights_policy_version = [pscustomobject]@{ value = "" }
  candidate_rights_policy_sha256 = [pscustomobject]@{ value = "" }
  candidate_rights_export_lifetime_seconds = [pscustomobject]@{ value = $null }
  candidate_rights_download_grant_seconds = [pscustomobject]@{ value = $null }
  candidate_rights_backup_retention_days = [pscustomobject]@{ value = $null }
  candidate_rights_recent_auth_max_age_seconds = [pscustomobject]@{ value = $null }
  candidate_rights_export_lifecycle_days = [pscustomobject]@{ value = $null }
  candidate_rights_owner_inventory = [pscustomobject]@{ value = "" }
  candidate_rights_subprocessor_inventory = [pscustomobject]@{ value = "" }
  database_backup_retention_days = [pscustomobject]@{ value = 35 }
  gateway_lambda_artifact_s3_key = [pscustomobject]@{ value = "old" }
  gateway_lambda_artifact_s3_object_version = [pscustomobject]@{ value = "old" }
  gateway_lambda_artifact_sha256 = [pscustomobject]@{ value = "b" * 64 }
  gateway_lambda_artifact_base64sha256 = [pscustomobject]@{ value = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI=" }
  untouched = [pscustomobject]@{ value = "same" }
  nullable_untouched = [pscustomobject]@{ value = $null }
}
$planVariables = $baselineVariables | ConvertTo-Json -Depth 8 | ConvertFrom-Json
$expected = @{
  candidate_rights_enabled = $true; private_application_networking = $true; candidate_rights_id_token_audience = "candidate-web-client"
  candidate_rights_policy_version = "d2-development-synthetic-v1"; candidate_rights_policy_sha256 = $policySha256
  candidate_rights_export_lifetime_seconds = 3600; candidate_rights_download_grant_seconds = 300; candidate_rights_backup_retention_days = 35
  candidate_rights_recent_auth_max_age_seconds = 900; candidate_rights_export_lifecycle_days = 1; candidate_rights_owner_inventory = "identity,profile,documents,jobs,matching,billing,trust"
  candidate_rights_subprocessor_inventory = "none"; database_backup_retention_days = 35; gateway_lambda_artifact_s3_key = $artifact.key
  gateway_lambda_artifact_s3_object_version = $artifact.versionId; gateway_lambda_artifact_sha256 = $artifact.artifactSha256; gateway_lambda_artifact_base64sha256 = $artifact.objectBase64Sha256
}
foreach($entry in $expected.GetEnumerator()){ $planVariables.PSObject.Properties[$entry.Key].Value.value = $entry.Value }
$null = Assert-StageBVariableTransition $baselineVariables $planVariables $artifact "candidate-web-client"; $passed++
$savedNullable = [Environment]::GetEnvironmentVariable("TF_VAR_nullable_untouched")
try {
  Set-VariablesFromBaseline $baselineVariables $artifact "candidate-web-client"
  if ($null -ne [Environment]::GetEnvironmentVariable("TF_VAR_nullable_untouched")) { throw "Nullable Terraform variables were not left unset." }
  $passed++
} finally {
  if ($null -eq $savedNullable) { Remove-Item Env:TF_VAR_nullable_untouched -ErrorAction SilentlyContinue }
  else { $env:TF_VAR_nullable_untouched = $savedNullable }
}
$badVariables = $planVariables | ConvertTo-Json -Depth 8 | ConvertFrom-Json; $badVariables.untouched.value = "changed"
Assert-Rejected { Assert-StageBVariableTransition $baselineVariables $badVariables $artifact "candidate-web-client" } "Non-Stage-B variable change accepted."
$badVariables = $planVariables | ConvertTo-Json -Depth 8 | ConvertFrom-Json; $badVariables.PSObject.Properties.Remove("untouched")
Assert-Rejected { Assert-StageBVariableTransition $baselineVariables $badVariables $artifact "candidate-web-client" } "Changed variable inventory accepted."

$outputPlan = [pscustomobject]@{ output_changes = [pscustomobject]@{
  candidate_data_export_bucket = [pscustomobject]@{ actions = @("create") }
  candidate_deletion_recovery_bucket = [pscustomobject]@{ actions = @("create") }
  profile_readiness_durable_alias_arn = [pscustomobject]@{ actions = @("update") }
  profile_readiness_durable_version_arn = [pscustomobject]@{ actions = @("update") }
} }
if ((Assert-StageBOutputChanges $outputPlan) -ne 4) { throw "Exact Stage B output transition failed." }; $passed++
$badOutputPlan = $outputPlan | ConvertTo-Json -Depth 8 | ConvertFrom-Json
$badOutputPlan.output_changes | Add-Member NoteProperty unrelated_output ([pscustomobject]@{ actions = @("update") })
Assert-Rejected { Assert-StageBOutputChanges $badOutputPlan } "Unexpected Stage B output accepted."

$zeroChangePlan = [pscustomobject]@{ resource_changes = @() }
if ((Get-MeaningfulChangeCount $zeroChangePlan) -ne 0) { throw "An empty baseline change set was not counted as zero." }; $passed++
if ((ConvertTo-StrictTerraformBoolean "false" "fixture") -ne $false -or
    (ConvertTo-StrictTerraformBoolean "true" "fixture") -ne $true) { throw "Exact Terraform boolean input parsing failed." }; $passed++
Assert-Rejected { ConvertTo-StrictTerraformBoolean "False" "fixture" } "Noncanonical Terraform boolean input accepted."
if ((ConvertTo-StrictTerraformInteger "300" "fixture") -ne 300L) { throw "Exact Terraform integer input parsing failed." }; $passed++
Assert-Rejected { ConvertTo-StrictTerraformInteger "0300" "fixture" } "Noncanonical Terraform integer input accepted."

$versioning = [pscustomobject]@{ Status = "Enabled" }
$public = [pscustomobject]@{ PublicAccessBlockConfiguration = [pscustomobject]@{ BlockPublicAcls = $true; IgnorePublicAcls = $true; BlockPublicPolicy = $true; RestrictPublicBuckets = $true } }
$encryption = [pscustomobject]@{ ServerSideEncryptionConfiguration = [pscustomobject]@{ Rules = @([pscustomobject]@{ BucketKeyEnabled = $true; ApplyServerSideEncryptionByDefault = [pscustomobject]@{ SSEAlgorithm = "aws:kms"; KMSMasterKeyID = "arn:aws:kms:us-east-2:123456789012:key/fixture" } }) } }
if ((Assert-StateBucketBoundary "us-east-2" $versioning $public $encryption "123456789012" "us-east-2") -cne "arn:aws:kms:us-east-2:123456789012:key/fixture") { throw "State boundary validation failed." }; $passed++
Assert-Rejected { Assert-StateBucketBoundary "us-east-1" $versioning $public $encryption "123456789012" "us-east-2" } "Wrong-region state bucket accepted."
$badPublic = $public | ConvertTo-Json -Depth 6 | ConvertFrom-Json; $badPublic.PublicAccessBlockConfiguration.RestrictPublicBuckets = $false
Assert-Rejected { Assert-StateBucketBoundary "us-east-2" $versioning $badPublic $encryption "123456789012" "us-east-2" } "Public state bucket accepted."

$stages = [pscustomobject]@{}; $stages | Add-Member NoteProperty "version-one" @("AWSCURRENT")
$description = [pscustomobject]@{ VersionIdsToStages = $stages; Tags = @([pscustomobject]@{ Key = "ai-job-apply:generated-synthetic-only"; Value = "true" }, [pscustomobject]@{ Key = "ai-job-apply:authorized-owner"; Value = "vrij" }) }
$valueObject = [ordered]@{ clientId = "candidate-m2m-client"; clientSecret = ("x" * 16); revocationMode = "delete_user_only" }
$current = [pscustomobject]@{ VersionId = "version-one"; SecretString = ($valueObject | ConvertTo-Json -Compress) }
$null = Assert-Auth0SecretBoundary $description $current; $passed++
$badCurrent = [pscustomobject]@{ VersionId = "version-one"; SecretString = (([ordered]@{ clientId = "candidate-m2m-client"; clientSecret = ("x" * 16); revocationMode = "delete_user_only"; extra = "rejected" }) | ConvertTo-Json -Compress) }
Assert-Rejected { Assert-Auth0SecretBoundary $description $badCurrent } "Extra secret field accepted."
$badDescription = $description | ConvertTo-Json -Depth 8 | ConvertFrom-Json; $badDescription.Tags[1].Value = "other"
Assert-Rejected { Assert-Auth0SecretBoundary $badDescription $current } "Wrong secret owner accepted."

$metadataNames = @("schemaVersion", "kind", "environment", "sourceSha", "stateLineage", "stateSerial", "baselineSha256", "gatewayReceiptSha256", "audienceSha256", "policySha256", "planSha256", "changedAddressActionSha256", "meaningfulChanges", "creates", "updates", "replacements", "deletes", "outputChanges", "createdAt")
$metadataFixture = [pscustomobject]@{}; foreach($name in $metadataNames){$metadataFixture | Add-Member NoteProperty $name "fixture"}
$null = Assert-ExactPropertySet $metadataFixture $metadataNames "Metadata"; $passed++
$metadataFixture | Add-Member NoteProperty extra "rejected"
Assert-Rejected { Assert-ExactPropertySet $metadataFixture $metadataNames "Metadata" } "Extra metadata field accepted."

$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\operate-development-candidate-rights-stage-b.ps1") -Raw
foreach ($needle in @(
  'CANDIDATE_RIGHTS_STAGE_B_ID_TOKEN_AUDIENCE', 'Require clean main equal to origin/main',
  'Get-PlanStateIdentity', 'Assert-ZeroDriftBaseline', 'VerifyPublication', 'Assert-StageBChangeSet',
  'changedAddressActionSha256', 'Assert-StateBucketBoundary', 'Assert-Auth0SecretBoundary',
  'lib\deployment-operator-guards.ps1', 'Assert-DevelopmentDocumentAcceptedResourceDrift',
  '"-backend-config=encrypt=true"', 'Assert-ExactPropertySet $metadata',
  'terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolvedPlan'
)) { if (-not $source.Contains($needle)) { throw "Operator invariant missing: $needle" }; $passed++ }
foreach ($prohibited in @('-auto-approve', 'candidate_rights_id_token_audience = "candidate-', 'ClientSecretSha256', 'SecretStringSha256')) {
  if ($source.Contains($prohibited)) { throw "Operator contains prohibited source: $prohibited" }
  $passed++
}

"development candidate-rights Stage B operator: $passed passed"
