[CmdletBinding()]
param(
  [ValidateSet("Validate", "Plan", "Execute", "Verify")]
  [string]$Action = "Validate",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")][string]$SourceSha = "",
  [string]$PublicationReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPublicationReceiptSha256 = "",
  [string]$BaselinePlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselinePlanSha256 = "",
  [ValidatePattern("^[0-9a-f-]{36}$")][string]$ExpectedStateLineage = "",
  [ValidateRange(1, 2147483647)][int]$ExpectedStateSerial = 0,
  [string]$PlanPath = "",
  [string]$PlanReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanReceiptSha256 = "",
  [string]$VerificationReceiptPath = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-ingestion-dark-release.ps1 -Action Validate `
    -SourceSha SHA -PublicationReceiptPath PATH -ReviewedPublicationReceiptSha256 SHA256 `
    -BaselinePlanPath PATH -ReviewedBaselinePlanSha256 SHA256

  Plan adds the exact development account, encrypted state bucket, state lineage/serial, and output
  paths. Execute additionally requires the checksum-reviewed plan receipt. Verify uses the same
  reviewed plan receipt and writes a private verification receipt after live checks and a fresh
  refresh-backed zero-drift plan.

The operator changes only the two immutable ingestion artifacts while preserving the already
deployed runtime in exact default-dark state. It cannot activate a source, provider authority,
provider-dedicated private egress, a trigger, queue mapping, route, NAT gateway, or data mutation.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development"))
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformDataRoot "development-ingestion-dark-release"
$stateKey = "platform.tfstate"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$artifactNames = @("ingestion-durable-lambda", "ingestion-runtime-lambda")
$artifactSuffixes = @("zip", "cdx.json", "manifest.json", "sha256")
$artifactVariableNames = @(
  "ingestion_durable_artifact_s3_key", "ingestion_durable_artifact_s3_object_version",
  "ingestion_durable_artifact_sha256", "ingestion_durable_artifact_base64sha256",
  "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
  "ingestion_runtime_artifact_sha256", "ingestion_runtime_artifact_base64sha256"
)
$darkBooleanVariables = @(
  "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress"
)
$allowedReleaseActions = [ordered]@{
  "module.platform.data.aws_iam_policy_document.ingestion_durable[0]" = "read"
  "module.platform.aws_cloudformation_stack.ingestion_durable[0]" = "update"
  "module.platform.aws_iam_role_policy.ingestion_durable[0]" = "update"
  "module.platform.aws_lambda_alias.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["terminal"]' = "update"
  "module.platform.aws_lambda_function.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["terminal"]' = "update"
  "module.platform.time_sleep.ingestion_policy_propagation[0]" = "create,delete"
}
$expectedOutputChanges = @("ingestion_durable_version_arn")
$functionNames = [ordered]@{
  activity = "ai-job-apply-development-ingestion-activity"
  coordinator = "ai-job-apply-development-ingestion-coordinator"
  starter = "ai-job-apply-development-ingestion-starter"
  terminal = "ai-job-apply-development-ingestion-terminal"
  durable = "ai-job-apply-development-ingestion-durable"
}

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($utf8WithoutBom.GetBytes($Value))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function ConvertFrom-OperatorJson {
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Description)
  try {
    $command = Get-Command ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop
    if ($command.Parameters.ContainsKey("DateKind")) { return $Json | ConvertFrom-Json -DateKind String }
    return $Json | ConvertFrom-Json
  } catch { throw "$Description is invalid JSON." }
}

function Assert-ExactProperties {
  param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string[]]$Expected, [Parameter(Mandatory)][string]$Description)
  $actual = if ($Value -is [Collections.IDictionary]) { @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object) }
  else { @($Value.PSObject.Properties.Name | Sort-Object) }
  if (($actual -join "`n") -cne (@($Expected | Sort-Object) -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
}

function Resolve-PrivatePath {
  param([Parameter(Mandatory)][string]$Path, [switch]$MustExist)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "A private release path is required." }
  $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) }
  else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path)) }
  $root = [IO.Path]::GetFullPath($terraformDataRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Release inputs and evidence must remain below the ignored development .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "A required private release file is missing." }
  return $resolved
}

function Write-ExclusiveJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value)
  if (Test-Path -LiteralPath $Path) { throw "Refusing to replace existing release evidence." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 100), $utf8WithoutBom)
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Value, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    if ($Value.Contains($Name)) { return $Value[$Name] }
    return $null
  }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Remove-SensitiveTemporaryFile {
  param([Parameter(Mandatory)][string]$Path)
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
  if (Test-Path -LiteralPath $Path) { throw "A sensitive temporary release input was not removed." }
}

function Assert-TerraformVersion {
  $raw = & terraform version -json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Terraform 1.9.8 is required." }
  $version = ConvertFrom-OperatorJson ($raw -join "`n") "Terraform version"
  if ([string]$version.terraform_version -cne "1.9.8") { throw "Terraform 1.9.8 is required." }
}

function Assert-IngestionMappingInventory {
  param([Parameter(Mandatory)][object]$Response)
  $mappings = @($Response.EventSourceMappings)
  $expectedQueueArn = "arn:aws:sqs:$Region`:$ExpectedAccountId`:ai-job-apply-development-ingestion-dispatch"
  $expectedStarterAliasArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$($functionNames.starter):development"
  if ($mappings.Count -ne 1 -or [string]$mappings[0].State -cne "Disabled" -or
    [string]$mappings[0].EventSourceArn -cne $expectedQueueArn -or [string]$mappings[0].FunctionArn -cne $expectedStarterAliasArn -or
    [int]$mappings[0].BatchSize -ne 10 -or (@($mappings[0].FunctionResponseTypes) -join ",") -cne "ReportBatchItemFailures") {
    throw "The ingestion starter has an enabled, missing, or unexpected event-source mapping."
  }
}

function Assert-SourceProvenance {
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $origin -or $head -cne $SourceSha -or $dirty.Count -ne 0) {
    throw "The ingestion dark release requires clean main exactly matching origin/main and SourceSha."
  }
}

function Read-PublicationReceipt {
  $path = Resolve-PrivatePath $PublicationReceiptPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedPublicationReceiptSha256) {
    throw "The ingestion publication receipt checksum does not match independent review."
  }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Ingestion publication receipt"
  Assert-ExactProperties $receipt @(
    "schemaVersion", "kind", "environment", "region", "sourceSha", "boundarySha256", "phase",
    "createdAt", "completedAt", "artifacts"
  ) "Ingestion publication receipt"
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne "development-ingestion-lambda-publication" -or
    [string]$receipt.environment -cne "development" -or [string]$receipt.region -cne "us-east-2" -or
    [string]$receipt.sourceSha -cne $SourceSha -or [string]$receipt.phase -cne "verified" -or
    [string]$receipt.boundarySha256 -cnotmatch '^[a-f0-9]{64}$' -or
    [string]::IsNullOrWhiteSpace([string]$receipt.completedAt) -or @($receipt.artifacts).Count -ne 8) {
    throw "The ingestion publication receipt is not the exact verified release."
  }
  $seen = New-Object Collections.Generic.HashSet[string]([StringComparer]::Ordinal)
  foreach ($artifact in @($receipt.artifacts)) {
    Assert-ExactProperties $artifact @(
      "artifactName", "artifactSha256", "suffix", "key", "versionId", "objectSha256",
      "objectBase64Sha256", "contentLength"
    ) "Ingestion publication object"
    $identity = "$($artifact.artifactName)|$($artifact.suffix)"
    if ([string]$artifact.artifactName -notin $artifactNames -or [string]$artifact.suffix -notin $artifactSuffixes -or
      -not $seen.Add($identity) -or [string]$artifact.versionId -cnotmatch '^[A-Za-z0-9._-]+$' -or
      [string]$artifact.artifactSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$artifact.objectSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$artifact.objectBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or [long]$artifact.contentLength -lt 1) {
      throw "The ingestion publication receipt contains an invalid or duplicate immutable object."
    }
    $escapedName = [regex]::Escape([string]$artifact.artifactName)
    $escapedSuffix = [regex]::Escape([string]$artifact.suffix)
    if ([string]$artifact.key -cne "lambda/ingestion/$SourceSha/$($artifact.artifactSha256)/$($artifact.artifactName).$($artifact.suffix)") {
      throw "An ingestion publication object key is outside the exact immutable source layout."
    }
  }
  foreach ($name in $artifactNames) {
    foreach ($suffix in $artifactSuffixes) {
      if (-not $seen.Contains("$name|$suffix")) { throw "The ingestion publication receipt is missing an exact object coordinate." }
    }
    $zip = @($receipt.artifacts | Where-Object { [string]$_.artifactName -ceq $name -and [string]$_.suffix -ceq "zip" })[0]
    foreach ($record in @($receipt.artifacts | Where-Object { [string]$_.artifactName -ceq $name })) {
      if ([string]$record.artifactSha256 -cne [string]$zip.artifactSha256) {
        throw "An ingestion companion object is not grouped below its exact artifact digest."
      }
    }
    if ([string]$zip.objectSha256 -cne [string]$zip.artifactSha256) { throw "The ZIP object digest does not equal its artifact digest." }
  }
  return [pscustomobject]@{ Path = $path; Receipt = $receipt; Sha256 = $ReviewedPublicationReceiptSha256 }
}

function Get-ZipRecord {
  param([Parameter(Mandatory)][object]$Publication, [Parameter(Mandatory)][string]$ArtifactName)
  $matches = @($Publication.Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq $ArtifactName -and [string]$_.suffix -ceq "zip"
    })
  if ($matches.Count -ne 1) { throw "The verified publication receipt does not contain one exact $ArtifactName ZIP." }
  $digestSegment = @(([string]$matches[0].key).Split('/'))[3]
  if ($digestSegment -cne [string]$matches[0].artifactSha256 -or
    [string]$matches[0].objectSha256 -cne [string]$matches[0].artifactSha256) {
    throw "The ZIP key and object digests do not match its artifact digest."
  }
  return $matches[0]
}

function Get-DeclaredTerraformVariables {
  $declared = @(
    Get-ChildItem -LiteralPath $terraformDirectory -Filter "*.tf" -File | ForEach-Object {
      Get-Content -LiteralPath $_.FullName | Select-String '^variable\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }
    }
  )
  if (@($declared | Sort-Object -Unique).Count -ne $declared.Count) { throw "The development Terraform variable inventory contains a duplicate." }
  return @($declared)
}

function Invoke-TerraformJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & terraform "-chdir=$terraformDirectory" @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
  return ConvertFrom-OperatorJson ($raw -join "`n") "$Operation output"
}

function Read-BaselinePlan {
  $path = Resolve-PrivatePath $BaselinePlanPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedBaselinePlanSha256) { throw "The current baseline plan checksum does not match review." }
  $plan = Invoke-TerraformJson @("show", "-json", $path) "Baseline plan inspection"
  $changes = @($plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  $outputs = @($plan.output_changes.PSObject.Properties | Where-Object { (@($_.Value.actions) -join ",") -cne "no-op" })
  if ($changes.Count -ne 0 -or $outputs.Count -ne 0) { throw "The reviewed current baseline is not zero drift." }
  $values = [ordered]@{}
  foreach ($property in @($plan.variables.PSObject.Properties)) { $values[$property.Name] = $property.Value.value }
  $values = Convert-BaselineDarkVariables $values
  $declared = @(Get-DeclaredTerraformVariables)
  if ($values.Count -ne $declared.Count -or @($declared | Where-Object { -not $values.Contains($_) }).Count -ne 0 -or
    @($values.Keys | Where-Object { $_ -notin $declared }).Count -ne 0) {
    throw "The reviewed baseline does not contain the exact current Terraform variable inventory."
  }
  Assert-DarkVariables $values
  return [pscustomobject]@{ Path = $path; Sha256 = $ReviewedBaselinePlanSha256; Plan = $plan; Values = $values }
}

function Convert-BaselineDarkVariables {
  param([Parameter(Mandatory)][object]$Values)
  $normalized = [ordered]@{}
  foreach ($key in $Values.Keys) { $normalized[$key] = $Values[$key] }
  foreach ($name in @("deploy_ingestion_runtime") + $darkBooleanVariables) {
    $value = $normalized[$name]
    if ($value -is [bool]) { continue }
    if ($value -isnot [string]) {
      throw "The baseline Terraform variable $name must be a native boolean or an exact lowercase boolean string."
    }
    if ($value -ceq "true") { $normalized[$name] = $true; continue }
    if ($value -ceq "false") { $normalized[$name] = $false; continue }
    throw "The baseline Terraform variable $name is not an exact lowercase boolean string."
  }
  return $normalized
}

function Test-ExactFalse {
  param([object]$Value)
  return ($Value -is [bool] -and -not [bool]$Value)
}

function Assert-DarkVariables {
  param([Parameter(Mandatory)][object]$Values)
  if ($Values["deploy_ingestion_runtime"] -isnot [bool] -or -not [bool]$Values["deploy_ingestion_runtime"]) {
    throw "The existing ingestion deployment must remain present."
  }
  foreach ($name in $darkBooleanVariables) {
    if (-not (Test-ExactFalse $Values[$name])) { throw "The dark release gate $name must remain exact false." }
  }
  if (@($Values["ingestion_provider_sources"]).Count -ne 0) { throw "The dark release provider source list must remain empty." }
}

function New-ReleaseVariables {
  param([Parameter(Mandatory)][object]$Baseline, [Parameter(Mandatory)][object]$Publication)
  $values = [ordered]@{}
  foreach ($key in $Baseline.Values.Keys) { $values[$key] = $Baseline.Values[$key] }
  $durable = Get-ZipRecord $Publication "ingestion-durable-lambda"
  $runtime = Get-ZipRecord $Publication "ingestion-runtime-lambda"
  $values["deploy_ingestion_runtime"] = $true
  foreach ($name in $darkBooleanVariables) { $values[$name] = $false }
  $values["ingestion_provider_sources"] = @()
  $values["ingestion_durable_artifact_s3_key"] = [string]$durable.key
  $values["ingestion_durable_artifact_s3_object_version"] = [string]$durable.versionId
  $values["ingestion_durable_artifact_sha256"] = [string]$durable.artifactSha256
  $values["ingestion_durable_artifact_base64sha256"] = [string]$durable.objectBase64Sha256
  $values["ingestion_runtime_artifact_s3_key"] = [string]$runtime.key
  $values["ingestion_runtime_artifact_s3_object_version"] = [string]$runtime.versionId
  $values["ingestion_runtime_artifact_sha256"] = [string]$runtime.artifactSha256
  $values["ingestion_runtime_artifact_base64sha256"] = [string]$runtime.objectBase64Sha256
  Assert-DarkVariables $values
  if ([string]$values.ingestion_durable_artifact_sha256 -ceq [string]$Baseline.Values.ingestion_durable_artifact_sha256 -or
    [string]$values.ingestion_runtime_artifact_sha256 -ceq [string]$Baseline.Values.ingestion_runtime_artifact_sha256) {
    throw "A dark release requires both immutable ingestion ZIPs to differ from rollback."
  }
  return $values
}

function Get-ArtifactCoordinates {
  param([Parameter(Mandatory)][object]$Values)
  $result = [ordered]@{}
  foreach ($name in $artifactVariableNames) { $result[$name] = [string]$Values[$name] }
  return $result
}

function Assert-ReleasePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][object]$ReleaseValues)
  $variables = [ordered]@{}
  foreach ($property in @($Plan.variables.PSObject.Properties)) { $variables[$property.Name] = $property.Value.value }
  if ($variables.Count -ne $ReleaseValues.Count -or
    @($ReleaseValues.Keys | Where-Object { -not $variables.Contains($_) }).Count -ne 0 -or
    @($variables.Keys | Where-Object { -not $ReleaseValues.Contains($_) }).Count -ne 0) {
    throw "The release plan does not preserve the exact current variable inventory."
  }
  foreach ($name in $ReleaseValues.Keys) {
    $actualValue = ConvertTo-Json -InputObject $variables[$name] -Compress -Depth 100
    $expectedValue = ConvertTo-Json -InputObject $ReleaseValues[$name] -Compress -Depth 100
    if ($actualValue -cne $expectedValue) { throw "The release plan changed baseline variable $name." }
  }
  Assert-DarkVariables $variables
  foreach ($name in $artifactVariableNames) {
    if ([string]$variables[$name] -cne [string]$ReleaseValues[$name]) { throw "The release plan changed an ingestion artifact coordinate." }
  }
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  if ($changes.Count -ne $allowedReleaseActions.Count) { throw "The release plan does not contain the exact artifact-caused change inventory." }
  foreach ($change in $changes) {
    $address = [string]$change.address
    if (-not $allowedReleaseActions.Contains($address) -or (@($change.change.actions) -join ",") -cne $allowedReleaseActions[$address]) {
      throw "The release plan contains an unauthorized resource or action: $address."
    }
  }
  $outputs = @($Plan.output_changes.PSObject.Properties | Where-Object { (@($_.Value.actions) -join ",") -cne "no-op" })
  if ($outputs.Count -ne $expectedOutputChanges.Count -or
    @(Compare-Object -CaseSensitive (@($expectedOutputChanges | Sort-Object)) (@($outputs.Name | Sort-Object))).Count -ne 0) {
    throw "The release plan contains an unauthorized output change."
  }
  return @($changes | ForEach-Object { "$($_.address):$(@($_.change.actions) -join ',')" } | Sort-Object)
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed. Refresh the development IAM Identity Center session." }
  return ConvertFrom-OperatorJson ($raw -join "`n") "$Operation response"
}

function Assert-Caller {
  if ($Region -cne "us-east-2" -or $ExpectedAccountId -cnotmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
    throw "The exact development account, us-east-2, and state bucket are required."
  }
  $caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json") "AWS caller validation"
  if ([string]$caller.Account -cne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/AWSReservedSSO_")) {
    throw "Use an approved temporary IAM Identity Center role in the exact development account."
  }
}

function Read-EncryptedStateSnapshot {
  param([switch]$AllowAdvancedSerial)
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") "State versioning validation"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") "State public-access validation"
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") "State encryption validation"
  $block = $public.PublicAccessBlockConfiguration
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and $_.BucketKeyEnabled -and
      [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -match "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/"
    })
  if ([string]$versioning.Status -cne "Enabled" -or $rules.Count -ne 1 -or -not $block.BlockPublicAcls -or
    -not $block.IgnorePublicAcls -or -not $block.BlockPublicPolicy -or -not $block.RestrictPublicBuckets) {
    throw "The Terraform state bucket is not the exact versioned, private, customer-KMS boundary."
  }
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") "State object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or
    [string]$head.SSEKMSKeyId -cne [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -or -not $head.BucketKeyEnabled -or
    [string]::IsNullOrWhiteSpace([string]$head.VersionId)) { throw "The current Terraform state object is outside the encrypted versioned boundary." }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $download = Invoke-AwsJson @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) "Versioned state read"
    if ([string]$download.VersionId -cne [string]$head.VersionId) { throw "The state version changed during its exact read." }
    $state = ConvertFrom-OperatorJson (Get-Content -LiteralPath $temporary -Raw) "Versioned Terraform state"
  } finally { Remove-SensitiveTemporaryFile $temporary }
  $serialAccepted = if ($AllowAdvancedSerial) { [int]$state.serial -gt $ExpectedStateSerial } else { [int]$state.serial -eq $ExpectedStateSerial }
  if ([string]$state.lineage -cne $ExpectedStateLineage -or -not $serialAccepted) {
    throw "Terraform state lineage or serial does not match the reviewed release boundary."
  }
  return [pscustomobject]@{ State = $state; VersionId = [string]$head.VersionId; Lineage = [string]$state.lineage; Serial = [int]$state.serial }
}

function Get-StateResourceAttributes {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Name)
  $matches = @($Snapshot.State.resources | Where-Object { [string]$_.type -ceq $Type -and [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1 -or @($matches[0].instances).Count -ne 1) { throw "Terraform state does not contain exactly one $Type.$Name." }
  return $matches[0].instances[0].attributes
}

function Get-StateResourceInstances {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Name)
  $matches = @($Snapshot.State.resources | Where-Object { [string]$_.type -ceq $Type -and [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1 -or @($matches[0].instances).Count -lt 1) { throw "Terraform state does not contain $Type.$Name instances." }
  return @($matches[0].instances | ForEach-Object { $_.attributes })
}

function Get-IngestionNetworkBoundary {
  param([Parameter(Mandatory)][object]$Snapshot)
  $activity = Get-StateResourceAttributes $Snapshot "aws_lambda_function" "ingestion_activity"
  $privateSubnets = @(Get-StateResourceInstances $Snapshot "aws_subnet" "private")
  $providerSubnets = @(Get-StateResourceInstances $Snapshot "aws_subnet" "ingestion_provider")
  $privateRoutes = @(Get-StateResourceInstances $Snapshot "aws_route_table" "private")
  $providerRoutes = @(Get-StateResourceInstances $Snapshot "aws_route_table" "ingestion_provider")
  $privateAssociations = @(Get-StateResourceInstances $Snapshot "aws_route_table_association" "private")
  $providerAssociations = @(Get-StateResourceInstances $Snapshot "aws_route_table_association" "ingestion_provider")
  $applicationNats = @($Snapshot.State.resources | Where-Object {
      [string]$_.type -ceq "aws_nat_gateway" -and [string]$_.name -ceq "this"
    } | ForEach-Object { @($_.instances) })
  $providerNats = @($Snapshot.State.resources | Where-Object {
      [string]$_.type -ceq "aws_nat_gateway" -and [string]$_.name -ceq "ingestion_provider"
    } | ForEach-Object { @($_.instances) })
  $privateSubnetIds = @($privateSubnets | ForEach-Object { [string]$_.id } | Sort-Object -Unique)
  $providerSubnetIds = @($providerSubnets | ForEach-Object { [string]$_.id } | Sort-Object -Unique)
  $privateRouteIds = @($privateRoutes | ForEach-Object { [string]$_.id } | Sort-Object -Unique)
  $providerRouteIds = @($providerRoutes | ForEach-Object { [string]$_.id } | Sort-Object -Unique)
  $applicationNatIds = @($applicationNats | ForEach-Object { [string]$_.attributes.id } | Sort-Object -Unique)
  $activityNatIds = @($privateRoutes | ForEach-Object { @($_.route) } | ForEach-Object {
      [string]$_.nat_gateway_id
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $activitySubnetIds = @($activity.vpc_config[0].subnet_ids | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  if ($privateSubnetIds.Count -ne 2 -or $providerSubnetIds.Count -ne 2 -or $privateRouteIds.Count -ne 2 -or
    $providerRouteIds.Count -ne 2 -or @($activity.vpc_config).Count -ne 1 -or $providerNats.Count -ne 0 -or
    (@($privateSubnetIds | Where-Object { $_ -in $providerSubnetIds }).Count -ne 0) -or
    ($activitySubnetIds -join "|") -cne ($privateSubnetIds -join "|") -or
    (@($privateAssociations | ForEach-Object { [string]$_.subnet_id } | Sort-Object) -join "|") -cne ($privateSubnetIds -join "|") -or
    (@($privateAssociations | ForEach-Object { [string]$_.route_table_id } | Sort-Object) -join "|") -cne ($privateRouteIds -join "|") -or
    (@($providerAssociations | ForEach-Object { [string]$_.subnet_id } | Sort-Object) -join "|") -cne ($providerSubnetIds -join "|") -or
    (@($providerAssociations | ForEach-Object { [string]$_.route_table_id } | Sort-Object) -join "|") -cne ($providerRouteIds -join "|") -or
    @($activityNatIds | Where-Object { $_ -notin $applicationNatIds }).Count -ne 0) {
    throw "Terraform state does not bind ingestion activity to the exact non-provider subnet and route topology."
  }
  return [pscustomobject]@{
    ActivitySubnetIds = $privateSubnetIds; ActivityRouteTableIds = $privateRouteIds
    ProviderSubnetIds = $providerSubnetIds; ProviderRouteTableIds = $providerRouteIds
    ApplicationNatGatewayIds = $applicationNatIds; ActivityNatGatewayIds = $activityNatIds
  }
}

function Assert-LiveIngestionNetworkBoundary {
  param([Parameter(Mandatory)][object]$Network, [Parameter(Mandatory)][object]$Activity, [Parameter(Mandatory)][object]$RouteTables)
  $liveSubnets = @($Activity.VpcConfig.SubnetIds | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $tables = @($RouteTables.RouteTables)
  $liveRouteIds = @($tables | ForEach-Object { [string]$_.RouteTableId } | Sort-Object -Unique)
  $associatedSubnets = @($tables | ForEach-Object { @($_.Associations) } | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.SubnetId)
    } | ForEach-Object { [string]$_.SubnetId } | Sort-Object)
  $liveNatIds = @($tables | ForEach-Object { @($_.Routes) } | ForEach-Object {
      [string](Get-OptionalProperty $_ "NatGatewayId")
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  if (($liveSubnets -join "|") -cne (@($Network.ActivitySubnetIds) -join "|") -or
    $tables.Count -ne 2 -or ($liveRouteIds -join "|") -cne (@($Network.ActivityRouteTableIds) -join "|") -or
    ($associatedSubnets -join "|") -cne (@($Network.ActivitySubnetIds) -join "|") -or
    ($liveNatIds -join "|") -cne (@($Network.ActivityNatGatewayIds) -join "|") -or
    @($liveNatIds | Where-Object { $_ -notin @($Network.ApplicationNatGatewayIds) }).Count -ne 0 -or
    @($liveSubnets | Where-Object { $_ -in @($Network.ProviderSubnetIds) }).Count -ne 0) {
    throw "Live ingestion activity is not attached to the exact non-provider subnet and route topology."
  }
}

function Assert-PublicationBoundaryFromState {
  param([Parameter(Mandatory)][object]$Publication, [Parameter(Mandatory)][object]$Snapshot)
  $bucket = Get-StateResourceAttributes $Snapshot "aws_s3_bucket" "artifacts"
  $kms = Get-StateResourceAttributes $Snapshot "aws_kms_key" "platform"
  if ([string]::IsNullOrWhiteSpace([string]$bucket.bucket) -or [string]$kms.arn -cnotmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "Terraform state does not expose the exact artifact publication boundary."
  }
  $expected = Get-TextSha256 "$ExpectedAccountId|$Region|$($bucket.bucket)|$($kms.arn)"
  if ([string]$Publication.Receipt.boundarySha256 -cne $expected) { throw "The ingestion publication receipt belongs to another artifact/KMS boundary." }
}

function New-PlanReceipt {
  param([object]$Publication, [object]$Baseline, [object]$State, [string]$ResolvedPlanPath, [string[]]$ChangeInventory)
  return [ordered]@{
    schemaVersion = 1
    kind = "development-ingestion-dark-release-plan"
    environment = "development"
    region = $Region
    accountId = $ExpectedAccountId
    sourceSha = $SourceSha
    publicationReceiptSha256 = $Publication.Sha256
    baselinePlanSha256 = $Baseline.Sha256
    stateLineage = $State.Lineage
    stateSerial = $State.Serial
    stateVersionId = $State.VersionId
    planPath = $ResolvedPlanPath
    planSha256 = Get-FileSha256 $ResolvedPlanPath
    refresh = $true
    changeInventory = @($ChangeInventory)
    releaseArtifactCoordinates = Get-ArtifactCoordinates (New-ReleaseVariables $Baseline $Publication)
    rollbackArtifactCoordinates = Get-ArtifactCoordinates $Baseline.Values
    dark = [ordered]@{ deploy = $true; runtime = $false; synthetic = $false; provider = $false; privateEgress = $false; sourceCount = 0 }
    createdAt = [DateTimeOffset]::UtcNow.ToString("o")
  }
}

function Read-PlanReceipt {
  $path = Resolve-PrivatePath $PlanReceiptPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedPlanReceiptSha256) { throw "The dark-release plan receipt checksum does not match review." }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Dark-release plan receipt"
  Assert-ExactProperties $receipt @(
    "schemaVersion", "kind", "environment", "region", "accountId", "sourceSha", "publicationReceiptSha256",
    "baselinePlanSha256", "stateLineage", "stateSerial", "stateVersionId", "planPath", "planSha256", "refresh",
    "changeInventory", "releaseArtifactCoordinates", "rollbackArtifactCoordinates", "dark", "createdAt"
  ) "Dark-release plan receipt"
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne "development-ingestion-dark-release-plan" -or
    [string]$receipt.environment -cne "development" -or [string]$receipt.region -cne $Region -or
    [string]$receipt.accountId -cne $ExpectedAccountId -or [string]$receipt.sourceSha -cne $SourceSha -or
    [string]$receipt.publicationReceiptSha256 -cne $ReviewedPublicationReceiptSha256 -or
    [string]$receipt.baselinePlanSha256 -cne $ReviewedBaselinePlanSha256 -or
    [string]$receipt.stateLineage -cne $ExpectedStateLineage -or [int]$receipt.stateSerial -ne $ExpectedStateSerial -or
    [string]::IsNullOrWhiteSpace([string]$receipt.stateVersionId) -or [string]$receipt.planSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    @($receipt.changeInventory).Count -ne $allowedReleaseActions.Count -or
    $receipt.refresh -isnot [bool] -or -not [bool]$receipt.refresh) { throw "The plan receipt is outside the reviewed release boundary." }
  Assert-ExactProperties $receipt.dark @("deploy", "runtime", "synthetic", "provider", "privateEgress", "sourceCount") "Plan receipt dark boundary"
  if ($receipt.dark.deploy -isnot [bool] -or -not [bool]$receipt.dark.deploy -or
    $receipt.dark.runtime -isnot [bool] -or [bool]$receipt.dark.runtime -or
    $receipt.dark.synthetic -isnot [bool] -or [bool]$receipt.dark.synthetic -or
    $receipt.dark.provider -isnot [bool] -or [bool]$receipt.dark.provider -or
    $receipt.dark.privateEgress -isnot [bool] -or [bool]$receipt.dark.privateEgress -or
    [int]$receipt.dark.sourceCount -ne 0) { throw "The plan receipt does not preserve the exact dark boundary." }
  $expectedRelease = Get-ArtifactCoordinates $releaseValues
  $expectedRollback = Get-ArtifactCoordinates $baseline.Values
  foreach ($set in @($receipt.releaseArtifactCoordinates, $receipt.rollbackArtifactCoordinates)) {
    Assert-ExactProperties $set $artifactVariableNames "Artifact coordinate set"
  }
  foreach ($name in $artifactVariableNames) {
    if ([string]$receipt.releaseArtifactCoordinates.$name -cne [string]$expectedRelease[$name] -or
      [string]$receipt.rollbackArtifactCoordinates.$name -cne [string]$expectedRollback[$name]) {
      throw "The plan receipt artifact or rollback coordinates changed after review."
    }
  }
  return [pscustomobject]@{ Path = $path; Receipt = $receipt }
}

function Assert-LiveDarkRelease {
  param([Parameter(Mandatory)][object]$ReleaseValues, [Parameter(Mandatory)][object]$StateSnapshot)
  $network = Get-IngestionNetworkBoundary $StateSnapshot
  $outputs = Invoke-TerraformJson @("output", "-json") "Terraform output inspection"
  foreach ($name in $darkBooleanVariables) {
    if ($outputs.$name.value -isnot [bool] -or [bool]$outputs.$name.value) { throw "Terraform output $name is not exact false." }
  }
  if ($outputs.ingestion_runtime_deployed.value -isnot [bool] -or -not [bool]$outputs.ingestion_runtime_deployed.value -or
    [int]$outputs.ingestion_provider_source_count.value -ne 0) { throw "Terraform outputs do not preserve the deployed dark runtime." }
  $versions = [ordered]@{}
  $configurations = [ordered]@{}
  foreach ($entry in $functionNames.GetEnumerator()) {
    $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $entry.Value, "--name", "development", "--output", "json") "Ingestion alias validation"
    $weights = @()
    if ($null -ne $alias.PSObject.Properties["RoutingConfig"] -and $null -ne $alias.RoutingConfig -and
      $null -ne $alias.RoutingConfig.PSObject.Properties["AdditionalVersionWeights"]) {
      $weights = @($alias.RoutingConfig.AdditionalVersionWeights.PSObject.Properties)
    }
    if ([string]$alias.FunctionVersion -cnotmatch '^[1-9][0-9]*$' -or $weights.Count -ne 0) { throw "An ingestion alias is not an exact unweighted numeric version." }
    $configuration = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $entry.Value, "--qualifier", [string]$alias.FunctionVersion, "--output", "json") "Ingestion version validation"
    $expectedCode = if ($entry.Key -ceq "durable") { [string]$ReleaseValues.ingestion_durable_artifact_base64sha256 } else { [string]$ReleaseValues.ingestion_runtime_artifact_base64sha256 }
    $expectedRelease = if ($entry.Key -ceq "durable") { [string]$ReleaseValues.ingestion_durable_artifact_sha256 } else { [string]$ReleaseValues.ingestion_runtime_artifact_sha256 }
    if ([string]$configuration.CodeSha256 -cne $expectedCode -or [string]$configuration.State -cne "Active" -or
      [string]$configuration.LastUpdateStatus -cne "Successful" -or [string]$configuration.Environment.Variables.RELEASE_SHA -cne $expectedRelease) {
      throw "An ingestion version is not the exact healthy published artifact."
    }
    if ($entry.Key -cne "durable" -and (
        [string]$configuration.Environment.Variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or
        [string]$configuration.Environment.Variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or
        [string]$configuration.Environment.Variables.INGESTION_PROVIDER_SOURCES -cne "[]")) {
      throw "An ingestion runtime version is not default-dark."
    }
    $versions[$entry.Key] = [int]$alias.FunctionVersion
    $configurations[$entry.Key] = $configuration
  }
  $durableArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$($functionNames.durable)`:$($versions.durable)"
  $activityArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$($functionNames.activity)`:$($versions.activity)"
  if ([string]$outputs.ingestion_durable_version_arn.value -cne $durableArn -or
    [string]$configurations.durable.Environment.Variables.INGESTION_ACTIVITY_FUNCTION_ARN -cne $activityArn) {
    throw "The durable and activity numeric versions are not cross-bound."
  }
  foreach ($name in @("coordinator", "starter", "terminal")) {
    if ([string]$configurations[$name].Environment.Variables.INGESTION_DURABLE_FUNCTION_ARN -cne $durableArn -or
      [string]$configurations[$name].Environment.Variables.INGESTION_ACTIVITY_FUNCTION_ARN -cne $activityArn) {
      throw "An ingestion transport version is not bound to the exact durable/activity versions."
    }
  }
  $stack = Invoke-AwsJson @("cloudformation", "describe-stacks", "--stack-name", "ai-job-apply-development-ingestion-durable", "--output", "json") "Durable stack validation"
  if (@($stack.Stacks).Count -ne 1 -or [string]$stack.Stacks[0].StackStatus -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) { throw "The ingestion durable stack is not complete." }
  $stackDurableArn = @($stack.Stacks[0].Outputs | Where-Object { [string]$_.OutputKey -ceq "DurableVersionArn" })
  if ($stackDurableArn.Count -ne 1 -or [string]$stackDurableArn[0].OutputValue -cne $durableArn) {
    throw "The complete durable stack does not expose the exact numeric durable version."
  }
  foreach ($ruleName in @("ai-job-apply-development-ingestion-schedule", "ai-job-apply-development-ingestion-terminal")) {
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $ruleName, "--output", "json") "Ingestion rule validation"
    if ([string]$rule.State -cne "DISABLED") { throw "An ingestion EventBridge rule is enabled." }
  }
  $starterAliasArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$($functionNames.starter):development"
  $mapping = Invoke-AwsJson @("lambda", "list-event-source-mappings", "--function-name", $starterAliasArn, "--output", "json") "Ingestion mapping inventory validation"
  Assert-IngestionMappingInventory $mapping
  foreach ($queue in @("ai-job-apply-development-ingestion-dispatch", "ai-job-apply-development-ingestion-dead-letter")) {
    $url = "https://sqs.$Region.amazonaws.com/$ExpectedAccountId/$queue"
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", $url, "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed", "--output", "json") "Ingestion queue validation"
    if ([int]$attributes.Attributes.ApproximateNumberOfMessages -ne 0 -or [int]$attributes.Attributes.ApproximateNumberOfMessagesNotVisible -ne 0 -or
      [int]$attributes.Attributes.ApproximateNumberOfMessagesDelayed -ne 0) { throw "An ingestion queue is not empty." }
  }
  $routeArguments = @("ec2", "describe-route-tables", "--route-table-ids") + @($network.ActivityRouteTableIds) + @("--output", "json")
  $routeTables = Invoke-AwsJson $routeArguments "Ingestion route topology validation"
  Assert-LiveIngestionNetworkBoundary $network $configurations.activity $routeTables
  $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", "ai-job-apply-development", "--desired-status", "RUNNING", "--output", "json") "ECS task validation"
  $services = Invoke-AwsJson @("ecs", "list-services", "--cluster", "ai-job-apply-development", "--output", "json") "ECS service validation"
  if (@($tasks.taskArns).Count -ne 0 -or @($services.serviceArns).Count -ne 0) { throw "The retained ECS cluster is not idle." }
  return [pscustomobject]@{ Versions = $versions; Network = $network }
}

function Invoke-ZeroDriftPlan {
  param([Parameter(Mandatory)][object]$Values, [Parameter(Mandatory)][string]$AppliedPlanSha256)
  $stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
  $varsPath = Join-Path $operatorRoot "zero-drift-$stamp.auto.tfvars.json"
  $zeroPath = Join-Path $operatorRoot "zero-drift-$stamp.tfplan"
  if ((Test-Path -LiteralPath $varsPath) -or (Test-Path -LiteralPath $zeroPath)) { throw "Refusing to replace zero-drift verification artifacts." }
  [IO.File]::WriteAllText($varsPath, ($Values | ConvertTo-Json -Compress -Depth 100), $utf8WithoutBom)
  try {
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -refresh=true -detailed-exitcode "-var-file=$varsPath" "-out=$zeroPath"
    $exitCode = $LASTEXITCODE
  } finally { Remove-SensitiveTemporaryFile $varsPath }
  if ($exitCode -ne 0) { throw "The fresh refresh-backed verification plan is not zero drift." }
  $plan = Invoke-TerraformJson @("show", "-json", $zeroPath) "Zero-drift plan inspection"
  if (@($plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" }).Count -ne 0 -or
    @($plan.output_changes.PSObject.Properties | Where-Object { (@($_.Value.actions) -join ",") -cne "no-op" }).Count -ne 0) {
    throw "The fresh verification plan contains meaningful drift."
  }
  return [pscustomobject]@{ Path = $zeroPath; Sha256 = Get-FileSha256 $zeroPath; AppliedPlanSha256 = $AppliedPlanSha256 }
}

# Validate is local and never invokes AWS or creates a Terraform plan.
$publication = Read-PublicationReceipt
$null = Assert-TerraformVersion
$baseline = Read-BaselinePlan
$releaseValues = New-ReleaseVariables $baseline $publication
if ($Action -ceq "Validate") {
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-ingestion-dark-release-validation"; SourceSha = $SourceSha
    PublicationObjectCount = 8; ArtifactCoordinateCount = 8; BaselineVariableCount = $baseline.Values.Count
    DeployPreserved = $true; DefaultDark = $true; ExternalMutation = $false; Valid = $true
  } | ConvertTo-Json -Depth 5
  exit 0
}

Assert-SourceProvenance
Assert-Caller
$state = Read-EncryptedStateSnapshot -AllowAdvancedSerial:($Action -ceq "Verify")
Assert-PublicationBoundaryFromState $publication $state

if ($Action -ceq "Plan") {
  $resolvedPlan = Resolve-PrivatePath $PlanPath
  $resolvedReceipt = Resolve-PrivatePath $PlanReceiptPath
  if ((Test-Path -LiteralPath $resolvedPlan) -or (Test-Path -LiteralPath $resolvedReceipt)) { throw "Refusing to replace an existing release plan or receipt." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedPlan) -Force
  $varsPath = Join-Path $operatorRoot "release-$($SourceSha.Substring(0,12)).auto.tfvars.json"
  $null = New-Item -ItemType Directory -Path $operatorRoot -Force
  if (Test-Path -LiteralPath $varsPath) { throw "A sensitive release input from an earlier operation still exists." }
  [IO.File]::WriteAllText($varsPath, ($releaseValues | ConvertTo-Json -Compress -Depth 100), $utf8WithoutBom)
  try {
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -refresh=true "-var-file=$varsPath" "-out=$resolvedPlan"
    if ($LASTEXITCODE -ne 0) { throw "The refresh-backed ingestion dark-release plan failed." }
  } finally { Remove-SensitiveTemporaryFile $varsPath }
  $plan = Invoke-TerraformJson @("show", "-json", $resolvedPlan) "Release plan inspection"
  $inventory = @(Assert-ReleasePlan $plan $releaseValues)
  $receipt = New-PlanReceipt $publication $baseline $state $resolvedPlan $inventory
  Write-ExclusiveJson $resolvedReceipt $receipt
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-ingestion-dark-release-plan-result"; PlanPath = $resolvedPlan
    PlanSha256 = $receipt.planSha256; ReceiptPath = $resolvedReceipt; ReceiptSha256 = Get-FileSha256 $resolvedReceipt
    StateLineage = $state.Lineage; StateSerial = $state.Serial; ChangeCount = $inventory.Count
    DeployPreserved = $true; DefaultDark = $true; MutationPerformed = $false
  } | ConvertTo-Json -Depth 6
  exit 0
}

$reviewedPlanReceipt = Read-PlanReceipt
$resolvedPlan = Resolve-PrivatePath ([string]$reviewedPlanReceipt.Receipt.planPath) -MustExist
if ((Get-FileSha256 $resolvedPlan) -cne [string]$reviewedPlanReceipt.Receipt.planSha256) { throw "The saved Terraform plan checksum changed after review." }
$savedPlan = Invoke-TerraformJson @("show", "-json", $resolvedPlan) "Reviewed release plan inspection"
$inventory = @(Assert-ReleasePlan $savedPlan $releaseValues)
if (($inventory -join "`n") -cne (@($reviewedPlanReceipt.Receipt.changeInventory) -join "`n")) { throw "The saved plan inventory does not match its receipt." }

if ($Action -ceq "Execute") {
  & terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m -auto-approve $resolvedPlan
  if ($LASTEXITCODE -ne 0) { throw "The exact checksum-reviewed ingestion dark-release plan did not apply successfully." }
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-ingestion-dark-release-apply-result"; SourceSha = $SourceSha
    PlanSha256 = [string]$reviewedPlanReceipt.Receipt.planSha256; PlanReceiptSha256 = $ReviewedPlanReceiptSha256
    ChangeCount = $inventory.Count; Applied = $true; DefaultDarkRequired = $true
  } | ConvertTo-Json -Depth 5
  exit 0
}

$live = Assert-LiveDarkRelease $releaseValues $state
$versions = $live.Versions
$currentState = Invoke-TerraformJson @("state", "pull") "Post-release state inspection"
if ([string]$currentState.lineage -cne $state.Lineage -or [int]$currentState.serial -ne $state.Serial) {
  throw "The post-release state did not advance within the reviewed lineage."
}
$zeroDrift = Invoke-ZeroDriftPlan $releaseValues ([string]$reviewedPlanReceipt.Receipt.planSha256)
$verificationPath = Resolve-PrivatePath $VerificationReceiptPath
$verification = [ordered]@{
  schemaVersion = 1; kind = "development-ingestion-dark-release-verification"; environment = "development"
  sourceSha = $SourceSha; publicationReceiptSha256 = $ReviewedPublicationReceiptSha256
  planReceiptSha256 = $ReviewedPlanReceiptSha256; appliedPlanSha256 = [string]$reviewedPlanReceipt.Receipt.planSha256
  stateLineage = [string]$currentState.lineage; stateSerial = [int]$currentState.serial
  versions = $versions; releaseArtifactCoordinates = Get-ArtifactCoordinates $releaseValues
  rollbackArtifactCoordinates = $reviewedPlanReceipt.Receipt.rollbackArtifactCoordinates
  defaultDark = $true; emptyQueueCount = 2; activitySubnetCount = @($live.Network.ActivitySubnetIds).Count
  activityRouteTableCount = @($live.Network.ActivityRouteTableIds).Count
  applicationNatGatewayCount = @($live.Network.ActivityNatGatewayIds).Count; providerDedicatedTopologyUsed = $false
  activeEcsTaskCount = 0; continuousEcsServiceCount = 0
  zeroDriftPlanPath = $zeroDrift.Path; zeroDriftPlanSha256 = $zeroDrift.Sha256; verifiedAt = [DateTimeOffset]::UtcNow.ToString("o")
}
Write-ExclusiveJson $verificationPath $verification
[pscustomobject]@{
  SchemaVersion = 1; Kind = "development-ingestion-dark-release-verification-result"; SourceSha = $SourceSha
  StateLineage = [string]$currentState.lineage; StateSerial = [int]$currentState.serial
  VerificationReceiptPath = $verificationPath; VerificationReceiptSha256 = Get-FileSha256 $verificationPath
  ZeroDriftPlanSha256 = $zeroDrift.Sha256; DefaultDark = $true; Verified = $true
} | ConvertTo-Json -Depth 6
