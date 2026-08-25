[CmdletBinding()]
param(
  [ValidateSet("Plan", "Apply")][string]$Action = "Plan",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")][string]$SourceSha = "",
  [string]$BaselinePlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselineSha256 = "",
  [string]$GatewayReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedGatewayReceiptSha256 = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanSha256 = "",
  [string]$PlanMetadataPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanMetadataSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformRoot "development-candidate-rights-stage-b"
$terraformDataDirectory = Join-Path $terraformRoot "development-candidate-rights-stage-b-data"
$audienceEnvironmentName = "CANDIDATE_RIGHTS_STAGE_B_ID_TOKEN_AUDIENCE"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$policySha256 = "d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff"

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-candidate-rights-stage-b.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT -StateBucket BUCKET -SourceSha MERGED_SHA `
    -BaselinePlanPath ZERO_DRIFT_PLAN -ReviewedBaselineSha256 SHA256 `
    -GatewayReceiptPath RECEIPT -ReviewedGatewayReceiptSha256 SHA256

  .\scripts\operate-development-candidate-rights-stage-b.ps1 -Action Apply `
    <the same exact arguments> -PlanPath PLAN -ReviewedPlanSha256 SHA256 `
    -PlanMetadataPath METADATA -ReviewedPlanMetadataSha256 SHA256

Set $audienceEnvironmentName to the exact nonsecret candidate Regular Web App client ID. The
operator never accepts the audience or any secret as a command-line argument. Plan writes an
aggregate-only descriptor; Apply consumes only the unchanged checksum-reviewed saved plan.
"@
  exit 0
}

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Assert-ExactPropertySet {
  param([object]$Value, [string[]]$Names, [string]$Description)
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Names | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) { throw "$Description does not have the exact property set." }
  return $true
}

function Assert-StateBucketBoundary {
  param([string]$Location, [object]$Versioning, [object]$PublicAccess, [object]$Encryption, [string]$AccountId, [string]$ExpectedRegion)
  $block = $PublicAccess.PublicAccessBlockConfiguration
  $rules = @($Encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and $_.BucketKeyEnabled -eq $true
    })
  if ($Location -cne $ExpectedRegion -or [string]$Versioning.Status -cne "Enabled" -or
      $block.BlockPublicAcls -ne $true -or $block.IgnorePublicAcls -ne $true -or
      $block.BlockPublicPolicy -ne $true -or $block.RestrictPublicBuckets -ne $true -or
      $rules.Count -ne 1 -or [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -cnotmatch "^arn:aws:kms:$ExpectedRegion`:$AccountId`:key/") {
    throw "The Terraform state bucket is outside the exact regional, versioned, private, customer-KMS boundary."
  }
  return [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
}

function Assert-Auth0SecretBoundary {
  param([object]$Description, [object]$CurrentValue)
  $tags = @{}
  foreach ($tag in @($Description.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  $currentVersions = @($Description.VersionIdsToStages.PSObject.Properties | Where-Object {
      @($_.Value | ForEach-Object { [string]$_ }) -contains "AWSCURRENT"
    })
  if ($currentVersions.Count -ne 1 -or [string]$CurrentValue.VersionId -cne [string]$currentVersions[0].Name -or
      $tags["ai-job-apply:generated-synthetic-only"] -cne "true" -or
      $tags["ai-job-apply:authorized-owner"] -cne "vrij") {
    throw "The candidate-rights Auth0 secret metadata is outside the exact preprovisioned boundary."
  }
  try { $value = ([string]$CurrentValue.SecretString) | ConvertFrom-Json } catch { throw "The candidate-rights Auth0 secret value has invalid JSON." }
  $null = Assert-ExactPropertySet $value @("clientId", "clientSecret", "revocationMode") "Candidate-rights Auth0 secret value"
  if ([string]$value.clientId -cnotmatch '^[A-Za-z0-9_-]{16,256}$' -or
      [string]::IsNullOrWhiteSpace([string]$value.clientSecret) -or ([string]$value.clientSecret).Length -lt 16 -or
      ([string]$value.clientSecret).Contains("`r") -or ([string]$value.clientSecret).Contains("`n") -or
      [string]$value.revocationMode -cne "delete_user_only") {
    throw "The candidate-rights Auth0 secret value is outside the exact schema boundary."
  }
  $value = $null
  return $true
}

function Resolve-OperatorPath {
  param([string]$Path, [switch]$MustExist, [switch]$StageBOnly)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "A required operator path is missing." }
  $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $terraformDirectory $Path)) }
  $root = [IO.Path]::GetFullPath($(if ($StageBOnly) { $operatorRoot } else { $terraformRoot })).TrimEnd([char[]]@("\", "/"))
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Operator artifacts must stay below the ignored development .terraform directory." }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "A required operator artifact does not exist." }
  return $resolved
}

function Get-PlanStateIdentity {
  param([string]$Path)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entry = @($archive.Entries | Where-Object FullName -CEQ "tfstate")
    if ($entry.Count -ne 1) { throw "The saved plan has no exact embedded state." }
    $reader = New-Object IO.StreamReader($entry[0].Open(), [Text.Encoding]::UTF8, $true)
    try { $state = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
  if ([string]$state.lineage -cnotmatch '^[a-f0-9-]{36}$' -or [long]$state.serial -lt 1) { throw "The saved-plan state identity is invalid." }
  return [pscustomobject]@{ Lineage = [string]$state.lineage; Serial = [long]$state.serial }
}

function Get-MeaningfulChanges([object]$Plan) {
  return @($Plan.resource_changes | Where-Object { ($_.change.actions -join ",") -notin @("no-op", "read") })
}

function Get-MeaningfulChangeCount([object]$Plan) {
  return @(Get-MeaningfulChanges $Plan).Count
}

function Get-CanonicalValue([AllowNull()][object]$Value) {
  if ($Value -is [string]) { return "string:$Value" }
  return "json:" + (ConvertTo-Json $Value -Depth 30 -Compress)
}

function ConvertTo-StrictTerraformBoolean([object]$Value, [string]$Description) {
  if ($Value -is [bool]) { return $Value }
  if ($Value -is [string] -and $Value -cin @("true", "false")) {
    return $Value -ceq "true"
  }
  throw "$Description is not an exact Terraform boolean input."
}

function Assert-StageBVariableTransition {
  param([object]$BaselineVariables, [object]$PlanVariables, [object]$Artifact, [string]$Audience)
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "`n") -cne ($planNames -join "`n")) { throw "Stage B changed the exact Terraform variable inventory." }
  $expected = @{
    candidate_rights_enabled = $true; private_application_networking = $true
    candidate_rights_id_token_audience = $Audience; candidate_rights_policy_version = "d1-development-synthetic-v1"
    candidate_rights_policy_sha256 = $policySha256; candidate_rights_export_lifetime_seconds = 3600
    candidate_rights_download_grant_seconds = 300; candidate_rights_backup_retention_days = 35
    candidate_rights_recent_auth_max_age_seconds = 900; candidate_rights_export_lifecycle_days = 1
    candidate_rights_owner_inventory = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory = "none"; database_backup_retention_days = 35
    gateway_lambda_artifact_s3_key = [string]$Artifact.key
    gateway_lambda_artifact_s3_object_version = [string]$Artifact.versionId
    gateway_lambda_artifact_sha256 = [string]$Artifact.artifactSha256
    gateway_lambda_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
  }
  foreach ($name in $planNames) {
    $actual = $PlanVariables.PSObject.Properties[$name].Value.value
    if ($expected.ContainsKey($name)) {
      if ($expected[$name] -is [bool]) {
        if ((ConvertTo-StrictTerraformBoolean $actual "Stage B $name") -ne $expected[$name]) { throw "Stage B contains an invalid bounded Terraform variable transition." }
      } elseif ((Get-CanonicalValue $actual) -cne (Get-CanonicalValue $expected[$name])) {
        throw "Stage B contains an invalid bounded Terraform variable transition."
      }
    } elseif ((Get-CanonicalValue $actual) -cne (Get-CanonicalValue $BaselineVariables.PSObject.Properties[$name].Value.value)) {
      throw "Stage B changed a non-Stage-B Terraform variable."
    }
  }
  return $true
}

function Assert-StageBOutputChanges([object]$Plan) {
  $changes = @($Plan.output_changes.PSObject.Properties | Where-Object { ($_.Value.actions -join ",") -ne "no-op" })
  $allowed = @("candidate_data_export_bucket", "candidate_deletion_recovery_bucket")
  foreach ($change in $changes) {
    if ($change.Name -notin $allowed -or ($change.Value.actions -join ",") -notin @("create", "update")) { throw "Stage B contains an unexpected output change." }
  }
  foreach ($name in $allowed) { if ($name -notin @($changes | ForEach-Object Name)) { throw "Stage B is missing a required bounded output change." } }
  return $changes.Count
}

function Assert-ZeroDriftBaseline {
  param([object]$Plan, [object]$PlanState, [object]$LiveState)
  $outputChanges = @($Plan.output_changes.PSObject.Properties | Where-Object { ($_.Value.actions -join ",") -ne "no-op" })
  if ($Plan.applyable -or -not $Plan.complete -or $Plan.errored -or (Get-MeaningfulChangeCount $Plan) -ne 0 -or
      $outputChanges.Count -ne 0 -or $PlanState.Lineage -cne $LiveState.Lineage -or
      $PlanState.Serial -ne $LiveState.Serial -or $null -eq $Plan.planned_values.root_module) {
    throw "The reviewed baseline is not a fresh zero-drift plan for the current state."
  }
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($Plan.resource_drift) -RootModule $Plan.planned_values.root_module
  $values = $Plan.variables
  foreach ($required in @("candidate_rights_id_token_audience", "candidate_rights_enabled", "private_application_networking", "candidate_rights_auth0_secret_provisioned", "candidate_rights_auth0_authorized_owner")) {
    if ($null -eq $values.PSObject.Properties[$required]) { throw "The baseline variable inventory is stale." }
  }
  $rightsEnabled = ConvertTo-StrictTerraformBoolean $values.candidate_rights_enabled.value "Baseline candidate rights"
  $privateNetworking = ConvertTo-StrictTerraformBoolean $values.private_application_networking.value "Baseline private networking"
  $secretProvisioned = ConvertTo-StrictTerraformBoolean $values.candidate_rights_auth0_secret_provisioned.value "Baseline Auth0 secret"
  if ($rightsEnabled -or $privateNetworking -or -not $secretProvisioned -or
      -not [string]::IsNullOrEmpty([string]$values.candidate_rights_id_token_audience.value) -or
      [string]$values.candidate_rights_auth0_authorized_owner.value -cne "vrij") {
    throw "The baseline is outside the exact default-dark, provisioned-secret boundary."
  }
}

function Get-AllowedStageBChanges {
  $create = @(
    "aws_cloudwatch_event_rule.candidate_rights_maintenance", "aws_cloudwatch_event_target.candidate_rights_maintenance",
    "aws_eip.nat", "aws_iam_role_policy.candidate_rights_activity", "aws_lambda_permission.candidate_rights_maintenance",
    "aws_nat_gateway.this", "aws_s3_bucket.candidate_data_exports", "aws_s3_bucket.candidate_deletion_recovery",
    "aws_s3_bucket_lifecycle_configuration.candidate_data_exports", "aws_s3_bucket_lifecycle_configuration.candidate_deletion_recovery",
    "aws_s3_bucket_object_lock_configuration.candidate_deletion_recovery", "aws_s3_bucket_ownership_controls.candidate_data_exports",
    "aws_s3_bucket_ownership_controls.candidate_deletion_recovery", "aws_s3_bucket_policy.candidate_data_exports",
    "aws_s3_bucket_policy.candidate_deletion_recovery", "aws_s3_bucket_public_access_block.candidate_data_exports",
    "aws_s3_bucket_public_access_block.candidate_deletion_recovery", "aws_s3_bucket_server_side_encryption_configuration.candidate_data_exports",
    "aws_s3_bucket_server_side_encryption_configuration.candidate_deletion_recovery", "aws_s3_bucket_versioning.candidate_data_exports",
    "aws_s3_bucket_versioning.candidate_deletion_recovery"
  )
  $update = @(
    "aws_cloudformation_stack.profile_readiness_durable", "aws_cloudwatch_event_rule.profile_readiness_terminal",
    "aws_iam_role_policy.gateway_lambda", "aws_iam_role_policy.outbox_starter", "aws_iam_role_policy.profile_readiness_durable",
    "aws_kms_key.platform", "aws_lambda_alias.gateway", "aws_lambda_alias.outbox_starter",
    "aws_lambda_alias.profile_readiness_activity", "aws_lambda_alias.profile_readiness_terminal",
    "aws_lambda_function.gateway", "aws_lambda_function.outbox_starter", "aws_lambda_function.profile_readiness_activity",
    "aws_lambda_function.profile_readiness_terminal",
    "aws_route_table.private", "aws_s3_bucket_policy.candidate_documents", "aws_sqs_queue_policy.profile_readiness_dead_letter",
    "aws_vpc_endpoint.candidate_documents_s3", "aws_vpc_endpoint.lambda", "aws_vpc_endpoint.secretsmanager"
  )
  return [pscustomobject]@{ Create = $create; Update = $update }
}

function Get-ResourceStem([string]$Address) {
  if ($Address -cnotmatch '^module\.platform\.([a-z0-9_]+\.[a-z0-9_]+)(?:\[[0-9]+\])?$') { return "" }
  return $Matches[1]
}

function Assert-StageBChangeSet {
  param([object[]]$Changes)
  $allowed = Get-AllowedStageBChanges
  $required = @(
    "aws_eip.nat", "aws_nat_gateway.this", "aws_s3_bucket.candidate_data_exports",
    "aws_s3_bucket.candidate_deletion_recovery", "aws_s3_bucket_object_lock_configuration.candidate_deletion_recovery",
    "aws_iam_role_policy.candidate_rights_activity", "aws_cloudwatch_event_rule.candidate_rights_maintenance",
    "aws_cloudwatch_event_target.candidate_rights_maintenance", "aws_lambda_permission.candidate_rights_maintenance",
    "aws_lambda_function.gateway", "aws_lambda_alias.gateway", "aws_lambda_function.profile_readiness_activity",
    "aws_lambda_alias.profile_readiness_activity", "aws_cloudwatch_event_rule.profile_readiness_terminal",
    "aws_iam_role_policy.outbox_starter", "aws_lambda_function.outbox_starter", "aws_lambda_alias.outbox_starter",
    "aws_lambda_function.profile_readiness_terminal", "aws_lambda_alias.profile_readiness_terminal", "aws_vpc_endpoint.lambda"
  )
  $seen = @{}
  foreach ($change in $Changes) {
    $stem = Get-ResourceStem ([string]$change.address)
    $actions = [string]($change.change.actions -join ",")
    if ([string]::IsNullOrEmpty($stem)) { throw "Stage B contains an unexpected resource address." }
    if ($actions -ceq "create") {
      if ($stem -notin $allowed.Create) { throw "Stage B contains an unexpected create." }
    } elseif ($actions -ceq "update") {
      if ($stem -notin $allowed.Update) { throw "Stage B contains an unexpected update." }
    } elseif ($actions -ceq "delete,create" -or $actions -ceq "create,delete") {
      if ($stem -cne "time_sleep.profile_readiness_durable_policy_propagation") { throw "Stage B contains an unexpected replacement." }
    } else { throw "Stage B contains an unexpected action set." }
    if ($actions -match "delete" -and [string]$change.type -in @("aws_db_instance", "aws_s3_bucket", "aws_kms_key", "aws_secretsmanager_secret", "aws_sqs_queue", "aws_elasticache_replication_group", "aws_ecr_repository")) { throw "Stage B contains a durable deletion or replacement." }
    $seen[$stem] = $true
  }
  foreach ($stem in $required) { if (-not $seen.ContainsKey($stem)) { throw "Stage B is missing a required bounded change." } }
  return $true
}

function Get-ChangeSummary([object[]]$Changes) {
  $records = @($Changes | ForEach-Object { "$($_.address)|$($_.change.actions -join ',')" } | Sort-Object)
  $counts = [ordered]@{ create = 0; update = 0; replace = 0; delete = 0 }
  foreach ($change in $Changes) {
    $actions = [string]($change.change.actions -join ",")
    if ($actions -ceq "create") { $counts.create++ } elseif ($actions -ceq "update") { $counts.update++ }
    elseif ($actions -match "delete" -and $actions -match "create") { $counts.replace++ } elseif ($actions -match "delete") { $counts.delete++ }
  }
  return [pscustomobject]@{ Count = $Changes.Count; Counts = $counts; Digest = Get-TextSha256 ($records -join "`n") }
}

function Set-VariablesFromBaseline([object]$Variables, [object]$Artifact, [string]$Audience) {
  foreach ($property in $Variables.PSObject.Properties) {
    $value = $property.Value.value
    if ($null -eq $value) {
      Remove-Item "Env:TF_VAR_$($property.Name)" -ErrorAction SilentlyContinue
      continue
    }
    $serialized = if ($value -is [bool]) { ([string]$value).ToLowerInvariant() } elseif ($value -is [string]) { $value } else { ConvertTo-Json $value -Depth 30 -Compress }
    Set-Item "Env:TF_VAR_$($property.Name)" $serialized
  }
  $env:TF_VAR_candidate_rights_enabled = "true"
  $env:TF_VAR_private_application_networking = "true"
  $env:TF_VAR_candidate_rights_id_token_audience = $Audience
  $env:TF_VAR_candidate_rights_policy_version = "d1-development-synthetic-v1"
  $env:TF_VAR_candidate_rights_policy_sha256 = $policySha256
  $env:TF_VAR_candidate_rights_export_lifetime_seconds = "3600"
  $env:TF_VAR_candidate_rights_download_grant_seconds = "300"
  $env:TF_VAR_candidate_rights_backup_retention_days = "35"
  $env:TF_VAR_candidate_rights_recent_auth_max_age_seconds = "900"
  $env:TF_VAR_candidate_rights_export_lifecycle_days = "1"
  $env:TF_VAR_candidate_rights_owner_inventory = "identity,profile,documents,jobs,matching,billing"
  $env:TF_VAR_candidate_rights_subprocessor_inventory = "none"
  $env:TF_VAR_database_backup_retention_days = "35"
  $env:TF_VAR_gateway_lambda_artifact_s3_key = [string]$Artifact.key
  $env:TF_VAR_gateway_lambda_artifact_s3_object_version = [string]$Artifact.versionId
  $env:TF_VAR_gateway_lambda_artifact_sha256 = [string]$Artifact.artifactSha256
  $env:TF_VAR_gateway_lambda_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
}

function Save-AndClearTerraformVariables {
  $saved = @{}; foreach ($item in @(Get-ChildItem Env: | Where-Object Name -like "TF_VAR_*")) { $saved[$item.Name] = $item.Value; Remove-Item "Env:$($item.Name)" }
  return $saved
}
function Restore-TerraformVariables([hashtable]$Saved) {
  foreach ($item in @(Get-ChildItem Env: | Where-Object Name -like "TF_VAR_*")) { Remove-Item "Env:$($item.Name)" }
  foreach ($entry in $Saved.GetEnumerator()) { Set-Item "Env:$($entry.Key)" ([string]$entry.Value) }
}

function Write-ExclusiveJson([string]$Path, [object]$Value) {
  if (Test-Path -LiteralPath $Path) { throw "Refusing to overwrite Stage B metadata." }
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 10) + "`n"), $utf8WithoutBom)
}

if ($env:CANDIDATE_RIGHTS_STAGE_B_OPERATOR_TEST_ONLY -ceq "1") { return }

foreach ($required in @($ExpectedAccountId, $StateBucket, $SourceSha, $BaselinePlanPath, $ReviewedBaselineSha256, $GatewayReceiptPath, $ReviewedGatewayReceiptSha256)) {
  if ([string]::IsNullOrWhiteSpace($required)) { throw "All exact account, state, source, baseline, and gateway receipt bindings are required." }
}
if ($Region -cne "us-east-2" -or $AwsProfile -cne "ai-job-apply-development-admin") { throw "Stage B is restricted to the development SSO profile in us-east-2." }
$audience = [Environment]::GetEnvironmentVariable($audienceEnvironmentName)
if ($audience -cnotmatch '^[A-Za-z0-9_-]{16,256}$') { throw "The exact candidate web-client audience environment variable is required." }

$env:AWS_PROFILE = $AwsProfile; $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region; $env:AWS_PAGER = ""
if ((& git -C $repositoryRoot branch --show-current).Trim() -cne "main" -or @(& git -C $repositoryRoot status --porcelain).Count -ne 0 -or
    (& git -C $repositoryRoot rev-parse HEAD).Trim() -cne $SourceSha -or (& git -C $repositoryRoot rev-parse origin/main).Trim() -cne $SourceSha) { throw "Require clean main equal to origin/main and the exact source SHA." }
$caller = (& aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or [string]$caller.Account -cne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/AWSReservedSSO_")) { throw "Use the exact temporary development IAM Identity Center caller." }
$terraformVersion = (& terraform version -json 2>$null | ConvertFrom-Json).terraform_version
if ([string]$terraformVersion -cne "1.9.8") { throw "Terraform 1.9.8 is required." }

$location = (& aws s3api get-bucket-location --bucket $StateBucket --query LocationConstraint --output text 2>$null).Trim()
$versioning = (& aws s3api get-bucket-versioning --bucket $StateBucket --output json 2>$null | ConvertFrom-Json)
$publicAccess = (& aws s3api get-public-access-block --bucket $StateBucket --output json 2>$null | ConvertFrom-Json)
$encryption = (& aws s3api get-bucket-encryption --bucket $StateBucket --output json 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw "The exact Terraform state bucket boundary could not be read." }
$kmsArn = Assert-StateBucketBoundary $location $versioning $publicAccess $encryption $ExpectedAccountId $Region
$null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
$env:TF_DATA_DIR = $terraformDataDirectory
& terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsArn" "-backend-config=encrypt=true" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backend initialization failed." }
$liveRaw = & terraform "-chdir=$terraformDirectory" state pull 2>$null
if ($LASTEXITCODE -ne 0) { throw "Current state read failed." }
$live = ($liveRaw -join "`n") | ConvertFrom-Json
$liveIdentity = [pscustomobject]@{ Lineage = [string]$live.lineage; Serial = [long]$live.serial }

$secretName = "ai-job-apply/development/candidate-rights/auth0-management"
$secretDescription = ((& aws secretsmanager describe-secret --secret-id $secretName --output json 2>$null) -join "`n") | ConvertFrom-Json
$secretCurrent = ((& aws secretsmanager get-secret-value --secret-id $secretName --version-stage AWSCURRENT --output json 2>$null) -join "`n") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "The current candidate-rights Auth0 secret could not be validated." }
$null = Assert-Auth0SecretBoundary $secretDescription $secretCurrent
$secretCurrent = $null

$baselinePath = Resolve-OperatorPath $BaselinePlanPath -MustExist
if ((Get-FileSha256 $baselinePath) -cne $ReviewedBaselineSha256) { throw "The reviewed baseline checksum does not match." }
$baseline = ((& terraform "-chdir=$terraformDirectory" show -json $baselinePath 2>$null) -join "`n") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Baseline inspection failed." }
Assert-ZeroDriftBaseline $baseline (Get-PlanStateIdentity $baselinePath) $liveIdentity

$receiptPath = Resolve-OperatorPath $GatewayReceiptPath -MustExist
if ((Get-FileSha256 $receiptPath) -cne $ReviewedGatewayReceiptSha256) { throw "The reviewed gateway receipt checksum does not match." }
& (Join-Path $PSScriptRoot "operate-development-gateway-release.ps1") -Action VerifyPublication -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket -SourceSha $SourceSha -ReceiptPath $receiptPath -ReviewedReceiptSha256 $ReviewedGatewayReceiptSha256 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Gateway publication verification failed." }
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$artifact = @($receipt.artifacts | Where-Object { $_.artifactName -ceq "gateway-lambda" -and $_.suffix -ceq "zip" })
if ($artifact.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$artifact[0].versionId)) { throw "The receipt has no exact immutable gateway ZIP." }

if ($Action -ceq "Plan") {
  $null = New-Item -ItemType Directory -Path $operatorRoot -Force
  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $resolvedPlan = if ([string]::IsNullOrWhiteSpace($PlanPath)) { Join-Path $operatorRoot "stage-b-$($SourceSha.Substring(0,12))-state$($liveIdentity.Serial)-$timestamp.tfplan" } else { Resolve-OperatorPath $PlanPath -StageBOnly }
  if (Test-Path -LiteralPath $resolvedPlan) { throw "Refusing to overwrite a Stage B plan." }
  $saved = Save-AndClearTerraformVariables
  try {
    Set-VariablesFromBaseline $baseline.variables $artifact[0] $audience
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -detailed-exitcode "-out=$resolvedPlan"
    if ($LASTEXITCODE -ne 2) { throw "Stage B must produce one applyable change plan." }
  } finally { Restore-TerraformVariables $saved }
  $plan = ((& terraform "-chdir=$terraformDirectory" show -json $resolvedPlan 2>$null) -join "`n") | ConvertFrom-Json
  $planState = Get-PlanStateIdentity $resolvedPlan
  if (-not $plan.applyable -or -not $plan.complete -or $plan.errored -or $planState.Lineage -cne $liveIdentity.Lineage -or $planState.Serial -ne $liveIdentity.Serial) { throw "The saved Stage B plan is invalid or stale." }
  $changes = Get-MeaningfulChanges $plan
  $null = Assert-StageBChangeSet $changes
  $null = Assert-StageBVariableTransition $baseline.variables $plan.variables $artifact[0] $audience
  $outputChangeCount = Assert-StageBOutputChanges $plan
  $summary = Get-ChangeSummary $changes
  $metadataPath = "$resolvedPlan.stage-b.json"
  $metadata = [ordered]@{ schemaVersion = 1; kind = "development-candidate-rights-stage-b-plan"; environment = "development"; sourceSha = $SourceSha; stateLineage = $liveIdentity.Lineage; stateSerial = $liveIdentity.Serial; baselineSha256 = $ReviewedBaselineSha256; gatewayReceiptSha256 = $ReviewedGatewayReceiptSha256; audienceSha256 = Get-TextSha256 $audience; policySha256 = $policySha256; planSha256 = Get-FileSha256 $resolvedPlan; changedAddressActionSha256 = $summary.Digest; meaningfulChanges = $summary.Count; creates = $summary.Counts.create; updates = $summary.Counts.update; replacements = $summary.Counts.replace; deletes = $summary.Counts.delete; outputChanges = $outputChangeCount; createdAt = (Get-Date).ToUniversalTime().ToString("o") }
  Write-ExclusiveJson $metadataPath $metadata
  [pscustomobject]@{ Outcome = "planned"; PlanPath = $resolvedPlan; PlanSha256 = $metadata.planSha256; PlanMetadataPath = $metadataPath; PlanMetadataSha256 = Get-FileSha256 $metadataPath; StateSerial = $liveIdentity.Serial; MeaningfulChanges = $summary.Count }
  exit 0
}

foreach ($required in @($PlanPath, $ReviewedPlanSha256, $PlanMetadataPath, $ReviewedPlanMetadataSha256)) { if ([string]::IsNullOrWhiteSpace($required)) { throw "Apply requires the exact reviewed plan and metadata." } }
$resolvedPlan = Resolve-OperatorPath $PlanPath -MustExist -StageBOnly
$metadataPath = Resolve-OperatorPath $PlanMetadataPath -MustExist -StageBOnly
if ([IO.Path]::GetFullPath($metadataPath) -cne [IO.Path]::GetFullPath("$resolvedPlan.stage-b.json") -or (Get-FileSha256 $resolvedPlan) -cne $ReviewedPlanSha256 -or (Get-FileSha256 $metadataPath) -cne $ReviewedPlanMetadataSha256) { throw "The reviewed Stage B plan or metadata binding is invalid." }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$plan = ((& terraform "-chdir=$terraformDirectory" show -json $resolvedPlan 2>$null) -join "`n") | ConvertFrom-Json
$planState = Get-PlanStateIdentity $resolvedPlan
if (-not $plan.applyable -or -not $plan.complete -or $plan.errored -or $planState.Lineage -cne $liveIdentity.Lineage -or $planState.Serial -ne $liveIdentity.Serial) { throw "The reviewed Stage B plan is nonapplyable, incomplete, errored, or stale." }
$changes = Get-MeaningfulChanges $plan; $null = Assert-StageBChangeSet $changes; $summary = Get-ChangeSummary $changes
$null = Assert-StageBVariableTransition $baseline.variables $plan.variables $artifact[0] $audience
$outputChangeCount = Assert-StageBOutputChanges $plan
$null = Assert-ExactPropertySet $metadata @("schemaVersion", "kind", "environment", "sourceSha", "stateLineage", "stateSerial", "baselineSha256", "gatewayReceiptSha256", "audienceSha256", "policySha256", "planSha256", "changedAddressActionSha256", "meaningfulChanges", "creates", "updates", "replacements", "deletes", "outputChanges", "createdAt") "Stage B plan metadata"
if ([int]$metadata.schemaVersion -ne 1 -or [string]$metadata.environment -cne "development" -or [string]$metadata.kind -cne "development-candidate-rights-stage-b-plan" -or [string]$metadata.sourceSha -cne $SourceSha -or [string]$metadata.stateLineage -cne $liveIdentity.Lineage -or [long]$metadata.stateSerial -ne $liveIdentity.Serial -or [string]$metadata.baselineSha256 -cne $ReviewedBaselineSha256 -or [string]$metadata.gatewayReceiptSha256 -cne $ReviewedGatewayReceiptSha256 -or [string]$metadata.audienceSha256 -cne (Get-TextSha256 $audience) -or [string]$metadata.policySha256 -cne $policySha256 -or [string]$metadata.planSha256 -cne $ReviewedPlanSha256 -or [string]$metadata.changedAddressActionSha256 -cne $summary.Digest) { throw "The aggregate Stage B plan metadata does not match current review inputs." }
if ([int]$metadata.meaningfulChanges -ne $summary.Count -or [int]$metadata.creates -ne $summary.Counts.create -or [int]$metadata.updates -ne $summary.Counts.update -or [int]$metadata.replacements -ne $summary.Counts.replace -or [int]$metadata.deletes -ne $summary.Counts.delete -or [int]$metadata.outputChanges -ne $outputChangeCount) { throw "The aggregate Stage B counts do not match the reviewed plan." }
& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolvedPlan
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed Stage B plan failed to apply." }
$after = ((& terraform "-chdir=$terraformDirectory" state pull 2>$null) -join "`n") | ConvertFrom-Json
[pscustomobject]@{ Outcome = "applied"; SourceSha = $SourceSha; PriorStateSerial = $liveIdentity.Serial; CurrentStateSerial = [long]$after.serial; PlanSha256 = $ReviewedPlanSha256; MeaningfulChanges = $summary.Count }
