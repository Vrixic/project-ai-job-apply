[CmdletBinding()]
param(
  [ValidateSet("Plan", "Apply", "Verify")][string]$Action = "Verify",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$BaselinePlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselineSha256 = "",
  [string]$PublicationReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedReceiptSha256 = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-document-dark-deployment.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Apply `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
    -PlanPath PLAN_PATH_FROM_PLAN -ReviewedPlanSha256 PLAN_SHA256

  .\scripts\operate-development-document-dark-deployment.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath ZERO_CHANGE_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -PublicationReceiptPath VERIFIED_RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256

The operator reconstructs all current deployment inputs from a checksum-reviewed zero-change
baseline, overlays only the verified document Lambda publication, and forces all document
processing triggers dark. Apply consumes only the exact checksum-reviewed saved plan.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development deployment is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted state bucket are required."
}
foreach ($required in @($BaselinePlanPath, $ReviewedBaselineSha256, $PublicationReceiptPath, $ReviewedReceiptSha256)) {
  if ([string]::IsNullOrWhiteSpace($required)) {
    throw "A checksum-reviewed zero-change baseline and verified publication receipt are required."
  }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformDataRoot "development-document-dark-deployment"
$terraformRuntimeData = Join-Path $terraformDataRoot "development-document-dark-operator-data"
$metadataSuffix = ".document-dark.json"
$extensionLayerArn = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
$allowedVariableNames = @(
  "candidate_document_cors_allowed_origins", "database_engine_version", "database_instance_class",
  "database_performance_insights", "deploy_applications", "deploy_document_intake",
  "deploy_document_processing", "deploy_gateway_lambda", "deploy_profile_readiness_durable",
  "deploy_serverless_outbox", "document_parser_artifact_base64sha256",
  "document_parser_artifact_s3_key", "document_parser_artifact_s3_object_version",
  "document_parser_artifact_sha256", "document_parser_version",
  "document_processor_artifact_base64sha256", "document_processor_artifact_s3_key",
  "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
  "document_processor_extension_layer_arn", "document_scan_event_rule_enabled",
  "document_scan_mapping_enabled", "enable_container_insights", "enable_redis",
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
)

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
  return $head
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

function Read-Baseline {
  $resolved = Resolve-InputPath -Candidate $BaselinePlanPath -MustExist
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -cne $ReviewedBaselineSha256) { throw "The zero-change baseline checksum does not match review." }
  $baseline = Read-Plan -Path $resolved
  $changes = @($baseline.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" })
  if ($changes.Count -ne 0 -or [string]$baseline.terraform_version -cne "1.9.8") {
    throw "The reviewed baseline is not a Terraform 1.9.8 zero-change plan."
  }
  $names = @($baseline.variables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($names -join "|") -cne (@($allowedVariableNames | Sort-Object) -join "|")) {
    throw "The reviewed baseline does not contain the exact approved development variable set."
  }
  foreach ($name in @(Get-DevelopmentDocumentBooleanVariableNames)) {
    $property = $baseline.variables.PSObject.Properties[$name]
    if ($null -eq $property) { throw "The reviewed baseline omits boolean variable '$name'." }
    $null = ConvertTo-ExactBoolean $property.Value.value "baseline $name"
  }
  if (-not (ConvertTo-ExactBoolean $baseline.variables.deploy_document_intake.value "deploy_document_intake") -or
    (ConvertTo-ExactBoolean $baseline.variables.deploy_document_processing.value "deploy_document_processing") -or
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
  param([Parameter(Mandatory)][object]$Baseline)
  $booleanNames = @(Get-DevelopmentDocumentBooleanVariableNames)
  foreach ($property in @($Baseline.variables.PSObject.Properties)) {
    $value = $property.Value.value
    $serialized = if ($property.Name -in $booleanNames) {
      (ConvertTo-ExactBoolean $value "baseline $($property.Name)").ToString().ToLowerInvariant()
    }
      elseif ($value -is [string]) { $value }
      else { $value | ConvertTo-Json -Compress -Depth 20 }
    [Environment]::SetEnvironmentVariable("TF_VAR_$($property.Name)", [string]$serialized, "Process")
  }
}

function Assert-BaselineCurrent {
  param([Parameter(Mandatory)][object]$Baseline)
  Set-BaselineVariables -Baseline $Baseline
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
  param([Parameter(Mandatory)][object]$Baseline, [Parameter(Mandatory)][object]$Receipt)
  Set-BaselineVariables -Baseline $Baseline
  $processor = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-processor-lambda" -and $_.suffix -eq "zip" })[0]
  $parser = @($Receipt.artifacts | Where-Object { $_.artifactName -eq "document-parser-lambda" -and $_.suffix -eq "zip" })[0]
  $env:TF_VAR_deploy_document_processing = "true"
  $env:TF_VAR_document_scan_mapping_enabled = "false"
  $env:TF_VAR_document_scan_event_rule_enabled = "false"
  $env:TF_VAR_document_processor_artifact_s3_key = [string]$processor.key
  $env:TF_VAR_document_processor_artifact_s3_object_version = [string]$processor.versionId
  $env:TF_VAR_document_processor_artifact_sha256 = [string]$processor.artifactSha256
  $env:TF_VAR_document_processor_artifact_base64sha256 = [string]$processor.objectBase64Sha256
  $env:TF_VAR_document_parser_artifact_s3_key = [string]$parser.key
  $env:TF_VAR_document_parser_artifact_s3_object_version = [string]$parser.versionId
  $env:TF_VAR_document_parser_artifact_sha256 = [string]$parser.artifactSha256
  $env:TF_VAR_document_parser_artifact_base64sha256 = [string]$parser.objectBase64Sha256
  $env:TF_VAR_document_processor_extension_layer_arn = $extensionLayerArn
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

function Assert-LiveDarkBoundary {
  param([Parameter(Mandatory)][object]$Receipt)
  $state = Get-StateResourceMap
  $vpcId = [string]$state["module.platform.aws_vpc.this"].id
  $platformKmsArn = [string]$state["module.platform.aws_kms_key.platform"].arn
  $candidateBucket = [string]$state["module.platform.aws_s3_bucket.candidate_documents[0]"].bucket
  $databaseSecretArn = [string]$state["module.platform.aws_secretsmanager_secret.database_url"].arn
  $parserQualifiedArn = [string]$state["module.platform.aws_lambda_function.document_parser[0]"].qualified_arn
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
        PLATFORM_KMS_KEY_ARN = $platformKmsArn; DOCUMENT_PARSER_FUNCTION_ARN = $parserQualifiedArn
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
  foreach ($ruleAddress in @("document_scan_results", "document_processing_reconciler")) {
    $rule = [string]$state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"].name
    $value = Invoke-AwsJson @("events", "describe-rule", "--name", $rule, "--output", "json")
    if ([string]$value.State -cne "DISABLED") { throw "A dark document-processing rule is enabled." }
    $expectedRule = $state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"]
    if ($ruleAddress -eq "document_scan_results" -and
      (ConvertTo-DeploymentCanonicalValue ($value.EventPattern | ConvertFrom-Json) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue ($expectedRule.event_pattern | ConvertFrom-Json) -SortArrays)) { throw "The scan-result rule pattern is not exact." }
    if ($ruleAddress -eq "document_processing_reconciler" -and [string]$value.ScheduleExpression -cne [string]$expectedRule.schedule_expression) {
      throw "The reconciler schedule is not exact."
    }
  }
  foreach ($ruleAddress in @("document_scan_tag_failure", "document_scan_plan_unhealthy")) {
    $rule = [string]$state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"].name
    $value = Invoke-AwsJson @("events", "describe-rule", "--name", $rule, "--output", "json")
    if ([string]$value.State -cne "ENABLED") { throw "A document security alert rule is not enabled." }
    $expectedPattern = [string]$state["module.platform.aws_cloudwatch_event_rule.$ruleAddress[0]"].event_pattern
    if ((ConvertTo-DeploymentCanonicalValue ($value.EventPattern | ConvertFrom-Json) -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue ($expectedPattern | ConvertFrom-Json) -SortArrays)) { throw "A security alert rule pattern is not exact." }
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

function Invoke-ZeroDrift {
  param([Parameter(Mandatory)][object]$Baseline, [Parameter(Mandatory)][object]$Receipt)
  Set-DarkVariables -Baseline $Baseline -Receipt $Receipt
  $path = Join-Path $operatorRoot "verify-$([guid]::NewGuid().ToString('N')).tfplan"
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m "-out=$path" -detailed-exitcode | Out-Null
    $code = $LASTEXITCODE
    if ($code -eq 1) { throw "The document dark zero-drift plan failed." }
    if ($code -eq 2) { throw "The deployed document dark boundary has drift." }
  } finally { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
}

$commit = Assert-CallerAndSource
Initialize-Backend
$null = New-Item -ItemType Directory -Path $operatorRoot -Force
$baseline = Read-Baseline
Assert-BaselineCurrent -Baseline $baseline
$receipt = Read-Receipt -Commit $commit
Set-DarkVariables -Baseline $baseline -Receipt $receipt

if ($Action -eq "Verify") {
  Assert-LiveDarkBoundary -Receipt $receipt
  Invoke-ZeroDrift -Baseline $baseline -Receipt $receipt
  [pscustomobject]@{ Result = "verified"; Environment = "development"; Triggers = "disabled"; Drift = $false } | ConvertTo-Json
  exit 0
}

if ($Action -eq "Plan") {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) { $PlanPath = Join-Path $operatorRoot "dark-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan" }
  $resolved = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot
  if (Test-Path -LiteralPath $resolved) { throw "Refusing to overwrite an existing saved plan." }
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m "-out=$resolved" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The refresh-backed document dark plan failed." }
    $plan = Read-Plan -Path $resolved
    Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baseline.variables -PlanVariables $plan.variables -Receipt $receipt
    $changes = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $ExpectedAccountId
  } catch { if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Force }; throw }
  $sha = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    SchemaVersion = "1"; Operation = "development-document-dark-deployment"; AccountId = $ExpectedAccountId
    StateBucket = $StateBucket; Commit = $commit; BaselineSha256 = $ReviewedBaselineSha256
    ReceiptSha256 = $ReviewedReceiptSha256; PlanPath = $resolved; PlanSha256 = $sha
    CreatedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath "$resolved$metadataSuffix" -Encoding utf8
  [pscustomobject]@{ Result = "review-required"; Creates = 39; Updates = 6; PlanPath = $resolved; PlanSha256 = $sha
    ApprovalCommand = "Apply reviewed development document dark plan $sha" } | ConvertTo-Json
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlanPath) -or [string]::IsNullOrWhiteSpace($ReviewedPlanSha256)) {
  throw "Apply requires the exact saved plan and reviewed SHA-256."
}
$resolved = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot -MustExist
$actual = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $ReviewedPlanSha256) { throw "The dark plan checksum does not match review." }
$metadataPath = "$resolved$metadataSuffix"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "Dark plan metadata is missing." }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
Assert-ReviewedPlanMetadata -Metadata $metadata -Expected @{
  SchemaVersion = "1"; Operation = "development-document-dark-deployment"; AccountId = $ExpectedAccountId
  StateBucket = $StateBucket; Commit = $commit; BaselineSha256 = $ReviewedBaselineSha256
  ReceiptSha256 = $ReviewedReceiptSha256; PlanPath = $resolved; PlanSha256 = $ReviewedPlanSha256
}
$plan = Read-Plan -Path $resolved
Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baseline.variables -PlanVariables $plan.variables -Receipt $receipt
$null = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $ExpectedAccountId
& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolved
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed document dark plan failed to apply." }
Assert-LiveDarkBoundary -Receipt $receipt
Invoke-ZeroDrift -Baseline $baseline -Receipt $receipt
[pscustomobject]@{ Result = "applied-and-verified"; Environment = "development"; Triggers = "disabled"; Drift = $false } | ConvertTo-Json
