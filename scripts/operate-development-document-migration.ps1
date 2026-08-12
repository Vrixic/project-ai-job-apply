[CmdletBinding()]
param(
  [ValidateSet("Status", "PlanTask", "ApplyTask", "PlanExecution", "Execute", "Recover", "Verify")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",

  [string]$MigrationImage = "",
  [string]$AppliedPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$AppliedPlanSha256 = "",

  [string]$TaskPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedTaskPlanSha256 = "",

  [string]$ExecutionPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedExecutionPlanSha256 = "",

  [string]$ReceiptPath = "",
  [string]$DriftPlanPath = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  # Inspect the current development migration boundary.
  .\scripts\operate-development-document-migration.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  # Reconstruct every Terraform input from the latest already-applied saved plan and create a
  # refresh-backed plan that may replace only the one-off migration task definition.
  .\scripts\operate-development-document-migration.ps1 -Action PlanTask `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -AppliedPlanPath .terraform/PREVIOUSLY_APPLIED.tfplan `
    -AppliedPlanSha256 64_CHARACTER_SHA256

  # Apply only the exact checksum-reviewed task plan and its generated metadata sidecar.
  .\scripts\operate-development-document-migration.ps1 -Action ApplyTask `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -TaskPlanPath .terraform/development-document-migration/task-....tfplan `
    -ReviewedTaskPlanSha256 64_CHARACTER_SHA256

  # Produce a checksum-bound, no-override run-task request for independent review.
  .\scripts\operate-development-document-migration.ps1 -Action PlanExecution `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha APPLIED_RELEASE_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -TaskPlanPath .terraform/development-document-migration/task-....tfplan `
    -ReviewedTaskPlanSha256 64_CHARACTER_SHA256

  # Execute the exact reviewed request once. The client token prevents duplicate submission.
  .\scripts\operate-development-document-migration.ps1 -Action Execute `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha APPLIED_RELEASE_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -TaskPlanPath .terraform/development-document-migration/task-....tfplan `
    -ReviewedTaskPlanSha256 64_CHARACTER_SHA256 `
    -ExecutionPlanPath .terraform/development-document-migration/execution-....json `
    -ReviewedExecutionPlanSha256 64_CHARACTER_SHA256

  # Recheck the stopped task, aggregate-only log contract, zero-task boundary, encrypted state,
  # and save a refresh-backed zero-drift plan.
  .\scripts\operate-development-document-migration.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha APPLIED_RELEASE_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -TaskPlanPath .terraform/development-document-migration/task-....tfplan `
    -ReviewedTaskPlanSha256 64_CHARACTER_SHA256 `
    -ExecutionPlanPath .terraform/development-document-migration/execution-....json `
    -ReviewedExecutionPlanSha256 64_CHARACTER_SHA256 `
    -ReceiptPath .terraform/development-document-migration/receipt-....json

  # Finalize an existing submitted receipt after an interrupted local waiter. This never submits
  # a task and accepts only the exact claimed descriptor/task that is already STOPPED and valid.
  .\scripts\operate-development-document-migration.ps1 -Action Recover `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha APPLIED_RELEASE_40_CHARACTER_COMMIT `
    -MigrationImage EXACT_ECR_URI_AT_SHA256 `
    -TaskPlanPath .terraform/development-document-migration/task-....tfplan `
    -ReviewedTaskPlanSha256 64_CHARACTER_SHA256 `
    -ExecutionPlanPath .terraform/development-document-migration/execution-....json `
    -ReviewedExecutionPlanSha256 64_CHARACTER_SHA256 `
    -ReceiptPath .terraform/development-document-migration/receipt-....json

All plans, metadata, receipts, and local logs stay below the ignored development .terraform
directory. The operator never accepts an ECS container, command, environment, role, CPU, memory,
or resource override. PlanTask and ApplyTask require SourceSha to equal the current merged main.
Post-apply actions may bind an already-applied ancestor release while recording the exact current
operator revision in the execution descriptor and receipt.
"@
  exit 0
}

if ($Region -cne "us-east-2") {
  throw "Development database migrations are restricted to us-east-2."
}
if ($ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-migration"
$terraformDataDirectory = Join-Path $terraformRoot "development-document-migration-data"
$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"
$migrationFamily = "ai-job-apply-development-database-migration"
$repositoryName = "ai-job-apply/migration"
$stateKey = "platform.tfstate"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-OptionalProperty {
  param(
    [AllowNull()][object]$Object,
    [Parameter(Mandatory)][string]$Name
  )

  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Test-EcsFaultInjectionDisabled {
  param([Parameter(Mandatory)][object]$TaskDefinition)

  $property = $TaskDefinition.PSObject.Properties["enableFaultInjection"]
  if ($null -eq $property) { return $true }
  return ($property.Value -is [bool] -and $property.Value -eq $false)
}

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Operation
  )

  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed. Refresh the development IAM Identity Center session and inspect the operation locally."
  }
  if (-not $raw) { return $null }
  try {
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "$Operation returned an invalid JSON response."
  }
}

function Invoke-TerraformJson {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Operation
  )

  $raw = & terraform "-chdir=$terraformDirectory" @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
  try {
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "$Operation returned invalid JSON."
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FileSha256Base64 {
  param([Parameter(Mandatory)][string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return [Convert]::ToBase64String($algorithm.ComputeHash([IO.File]::ReadAllBytes($Path)))
  } finally {
    $algorithm.Dispose()
  }
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][object]$Value,
    [switch]$AllowReplace
  )

  if ((Test-Path -LiteralPath $Path) -and -not $AllowReplace) {
    throw "Refusing to replace an existing operator artifact."
  }
  $parent = Split-Path -Parent $Path
  $null = New-Item -ItemType Directory -Path $parent -Force
  $temporary = Join-Path $parent (".{0}.{1}.tmp" -f ([IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString("N"))
  try {
    $json = $Value | ConvertTo-Json -Depth 40
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force:$AllowReplace
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Resolve-OperatorPath {
  param(
    [Parameter(Mandatory)][string]$Candidate,
    [switch]$MustExist,
    [switch]$RequireOperatorRoot
  )

  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw "A required operator path is missing." }
  $candidatePath = if ([IO.Path]::IsPathRooted($Candidate)) {
    $Candidate
  } else {
    Join-Path $terraformDirectory $Candidate
  }
  $resolved = [IO.Path]::GetFullPath($candidatePath)
  $allowedRoot = if ($RequireOperatorRoot) { [IO.Path]::GetFullPath($operatorRoot) } else { $terraformRoot }
  $prefix = $allowedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Operator artifacts must stay below the approved ignored .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "A required operator artifact does not exist."
  }
  return $resolved
}

function Assert-ReleaseSourceBinding {
  param(
    [Parameter(Mandatory)][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha,
    [switch]$AllowAncestor,
    [bool]$IsAncestor = $false
  )

  if ($ReleaseSourceSha -notmatch "^[a-f0-9]{40}$" -or
      $OperatorSourceSha -notmatch "^[a-f0-9]{40}$") {
    throw "The release and operator source SHAs must be exact merged commits."
  }
  if ($ReleaseSourceSha -ceq $OperatorSourceSha) { return }
  if ($AllowAncestor -and $IsAncestor) { return }
  throw "The migration release must equal the current operator source or be its verified main ancestor for a post-apply action."
}

function Assert-OperatorOnlyReleaseDelta {
  param([Parameter(Mandatory)][string[]]$ChangeRecords)

  $allowed = @(
    "scripts/operate-development-document-migration.ps1",
    "scripts/tests/development-document-migration-operator.tests.ps1",
    "scripts/validate-serverless-workflow-infrastructure.mjs",
    "infrastructure/runbooks/deployments/database-migration.md"
  )
  if ($ChangeRecords.Count -eq 0) { throw "An ancestor release must have an attributable operator-only correction." }
  foreach ($record in $ChangeRecords) {
    if ($record -notmatch '^M\t(.+)$' -or $Matches[1] -notin $allowed) {
      throw "The applied release differs from the current operator by more than the exact verifier-only allowlist."
    }
  }
}

function Assert-CallerToolsAndSource {
  param(
    [switch]$RequireSource,
    [switch]$AllowAncestorSource
  )

  $identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--output", "json") -Operation "AWS caller validation"
  if ([string]$identity.Account -cne $ExpectedAccountId) {
    throw "The AWS caller is not the exact development account."
  }
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use a temporary development IAM Identity Center session; long-lived callers are rejected."
  }

  $terraformVersion = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$terraformVersion.terraform_version -cne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }

  if ($RequireSource) {
    if ($SourceSha -notmatch "^[a-f0-9]{40}$") { throw "The exact merged release source SHA is required." }
    $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
    $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
    $upstream = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
    $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
    if ($branch -cne "main" -or $head -cne $upstream -or $dirty.Count -ne 0) {
      throw "Migration operations require a clean main checkout exactly matching origin/main."
    }
    $isAncestor = $false
    if ($head -cne $SourceSha -and $AllowAncestorSource) {
      & git -C $repositoryRoot merge-base --is-ancestor $SourceSha $head 2>$null
      $isAncestor = $LASTEXITCODE -eq 0
    }
    Assert-ReleaseSourceBinding -ReleaseSourceSha $SourceSha -OperatorSourceSha $head `
      -AllowAncestor:$AllowAncestorSource -IsAncestor:$isAncestor
    if ($head -cne $SourceSha) {
      $changeRecords = @(& git -C $repositoryRoot diff --name-status --no-renames "$SourceSha..$head" 2>$null)
      if ($LASTEXITCODE -ne 0) { throw "The release-to-operator delta could not be inspected." }
      Assert-OperatorOnlyReleaseDelta -ChangeRecords $changeRecords
      foreach ($path in $changeRecords | ForEach-Object { ($_ -split "`t", 2)[1] }) {
        foreach ($revision in @($SourceSha, $head)) {
          $type = (& git -C $repositoryRoot cat-file -t "$revision`:$path" 2>$null).Trim()
          if ($LASTEXITCODE -ne 0 -or $type -cne "blob") {
            throw "The verifier-only delta contains a non-blob or missing path."
          }
        }
      }
    }
    return $head
  }
  return ""
}

function Assert-RecoveryOperatorBinding {
  param(
    [Parameter(Mandatory)][string]$ExecutionOperatorSourceSha,
    [Parameter(Mandatory)][string]$CurrentOperatorSourceSha,
    [Parameter(Mandatory)][bool]$IsAncestor,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$ChangeRecords
  )

  Assert-ReleaseSourceBinding -ReleaseSourceSha $ExecutionOperatorSourceSha `
    -OperatorSourceSha $CurrentOperatorSourceSha -AllowAncestor -IsAncestor:$IsAncestor
  if ($ExecutionOperatorSourceSha -cne $CurrentOperatorSourceSha) {
    Assert-OperatorOnlyReleaseDelta -ChangeRecords $ChangeRecords
  }
}

function Assert-RecoveryOperatorSource {
  param([Parameter(Mandatory)][string]$ExecutionOperatorSourceSha)

  if ($ExecutionOperatorSourceSha -notmatch '^[a-f0-9]{40}$') {
    throw "The execution descriptor does not contain an exact operator source SHA."
  }
  & git -C $repositoryRoot merge-base --is-ancestor $ExecutionOperatorSourceSha $operatorSourceSha 2>$null
  $isAncestor = $LASTEXITCODE -eq 0
  $changes = if ($ExecutionOperatorSourceSha -ceq $operatorSourceSha) {
    @()
  } else {
    @(& git -C $repositoryRoot diff --name-status --no-renames "$ExecutionOperatorSourceSha..$operatorSourceSha" 2>$null)
  }
  if ($LASTEXITCODE -ne 0) { throw "The execution-to-recovery operator delta could not be inspected." }
  Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $ExecutionOperatorSourceSha `
    -CurrentOperatorSourceSha $operatorSourceSha -IsAncestor:$isAncestor -ChangeRecords $changes
  foreach ($path in $changes | ForEach-Object { ($_ -split "`t", 2)[1] }) {
    foreach ($revision in @($ExecutionOperatorSourceSha, $operatorSourceSha)) {
      $type = (& git -C $repositoryRoot cat-file -t "$revision`:$path" 2>$null).Trim()
      if ($LASTEXITCODE -ne 0 -or $type -cne "blob") {
        throw "The recovery operator delta contains a non-blob or missing path."
      }
    }
  }
}

function Initialize-EncryptedBackend {
  $versioning = Invoke-AwsJson -Arguments @(
    "s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json"
  ) -Operation "State-bucket versioning validation"
  if ([string]$versioning.Status -cne "Enabled") {
    throw "The development state bucket must have versioning enabled."
  }

  $publicAccess = Invoke-AwsJson -Arguments @(
    "s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json"
  ) -Operation "State-bucket public-access validation"
  $block = $publicAccess.PublicAccessBlockConfiguration
  if (-not ($block.BlockPublicAcls -and $block.IgnorePublicAcls -and $block.BlockPublicPolicy -and $block.RestrictPublicBuckets)) {
    throw "The development state bucket must block every public-access path."
  }

  $encryption = Invoke-AwsJson -Arguments @(
    "s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json"
  ) -Operation "State-bucket encryption validation"
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -and $_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) { throw "The development state bucket must use one bucket-key-enabled customer KMS default." }
  $script:stateKmsKeyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($script:stateKmsKeyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact development account and region."
  }

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=$stateKey" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$script:stateKmsKeyArn" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted development backend could not be initialized." }
}

function Assert-StateObjectEncryption {
  $head = Invoke-AwsJson -Arguments @(
    "s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json"
  ) -Operation "Terraform state-object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or
      [string]$head.SSEKMSKeyId -cne $script:stateKmsKeyArn -or
      -not $head.BucketKeyEnabled -or [long]$head.ContentLength -le 0 -or
      [string]::IsNullOrWhiteSpace([string]$head.VersionId)) {
    throw "The current Terraform state object is not protected by the exact customer KMS boundary."
  }
}

function Get-PlanJson {
  param([Parameter(Mandatory)][string]$Path)
  return Invoke-TerraformJson -Arguments @("show", "-json", $Path) -Operation "Saved-plan inspection"
}

function Get-DeclaredVariableNames {
  $source = Get-Content -LiteralPath (Join-Path $terraformDirectory "variables.tf") -Raw
  return @([regex]::Matches($source, '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') | ForEach-Object {
      $_.Groups[1].Value
    })
}

function ConvertTo-TerraformEnvironmentValue {
  param([AllowNull()][object]$Value)

  if ($Value -is [bool]) { return $Value.ToString().ToLowerInvariant() }
  if ($Value -is [string]) { return $Value }
  if ($null -eq $Value) { return "null" }
  return ConvertTo-Json -InputObject $Value -Compress -Depth 30
}

function Set-VariablesFromPlan {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][string]$NewMigrationImage
  )

  if ($null -eq $Plan.variables) { throw "The saved plan does not contain reconstructable inputs." }
  $declared = @(Get-DeclaredVariableNames)
  $properties = @($Plan.variables.PSObject.Properties)
  $actual = @($properties | ForEach-Object { $_.Name })
  $unexpected = @($actual | Where-Object { $_ -notin $declared })
  $missing = @($declared | Where-Object { $_ -notin $actual })
  $newDocumentDefaults = [ordered]@{
    deploy_document_processing                    = $false
    document_scan_mapping_enabled                 = $false
    document_scan_event_rule_enabled              = $false
    document_processor_artifact_s3_key            = ""
    document_processor_artifact_s3_object_version = ""
    document_processor_artifact_sha256            = ""
    document_processor_artifact_base64sha256      = ""
    document_parser_artifact_s3_key               = ""
    document_parser_artifact_s3_object_version    = ""
    document_parser_artifact_sha256               = ""
    document_parser_artifact_base64sha256         = ""
    document_processor_extension_layer_arn        = ""
    document_parser_version                       = "resume-parser-v1"
  }
  $invalidMissing = @($missing | Where-Object { -not $newDocumentDefaults.Contains($_) })
  if ($unexpected.Count -ne 0 -or $invalidMissing.Count -ne 0) {
    throw "The saved plan contains an unapproved Terraform input or omits a variable outside the exact document-processing compatibility set."
  }

  foreach ($property in $properties) {
    $value = $property.Value.value
    $serialized = ConvertTo-TerraformEnvironmentValue -Value $value
    [Environment]::SetEnvironmentVariable("TF_VAR_$($property.Name)", [string]$serialized, "Process")
  }
  foreach ($name in $missing) {
    $value = $newDocumentDefaults[$name]
    $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() } else { [string]$value }
    [Environment]::SetEnvironmentVariable("TF_VAR_$name", $serialized, "Process")
  }
  $env:TF_VAR_migration_image = $NewMigrationImage
}

function Save-AndClearTerraformVariables {
  $saved = @{}
  foreach ($item in @(Get-ChildItem Env: | Where-Object { $_.Name -like "TF_VAR_*" })) {
    $saved[[string]$item.Name] = [string]$item.Value
    Remove-Item -LiteralPath "Env:\$($item.Name)"
  }
  return $saved
}

function Restore-TerraformVariables {
  param([Parameter(Mandatory)][hashtable]$Saved)
  foreach ($item in @(Get-ChildItem Env: | Where-Object { $_.Name -like "TF_VAR_*" })) {
    Remove-Item -LiteralPath "Env:\$($item.Name)"
  }
  foreach ($name in $Saved.Keys) {
    [Environment]::SetEnvironmentVariable([string]$name, [string]$Saved[$name], "Process")
  }
}

function Add-ManagedResources {
  param(
    [AllowNull()][object]$Module,
    [Parameter(Mandatory)][Collections.Generic.Dictionary[string, object]]$Destination
  )

  if ($null -eq $Module) { return }
  foreach ($resource in @(Get-OptionalProperty -Object $Module -Name "resources")) {
    if ($null -ne $resource -and [string]$resource.mode -ceq "managed") {
      $Destination[[string]$resource.address] = $resource
    }
  }
  foreach ($child in @(Get-OptionalProperty -Object $Module -Name "child_modules")) {
    Add-ManagedResources -Module $child -Destination $Destination
  }
}

function Assert-CurrentGatewayArtifactEvidence {
  param(
    [Parameter(Mandatory)][object]$Gateway,
    [Parameter(Mandatory)][object]$Head,
    [Parameter(Mandatory)][string]$ExpectedBucket,
    [Parameter(Mandatory)][string]$ExpectedKmsKeyArn
  )

  $key = [string]$Gateway.s3_key
  $objectVersion = [string]$Gateway.s3_object_version
  $base64Sha256 = [string]$Gateway.source_code_hash
  $bucket = [string]$Gateway.s3_bucket
  $keyMatch = [regex]::Match($key, '^lambda/gateway/(?<source>[a-f0-9]{40})/(?<artifact>[a-f0-9]{64})/gateway-lambda\.zip$')
  if (-not $keyMatch.Success -or [string]::IsNullOrWhiteSpace($objectVersion) -or
      $base64Sha256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or $bucket -cne $ExpectedBucket) {
    throw "The current gateway artifact does not match the immutable Terraform-owned release shape."
  }
  $sourceSha = [string]$keyMatch.Groups['source'].Value
  $artifactSha256 = [string]$keyMatch.Groups['artifact'].Value
  try {
    $decodedSha256 = ([BitConverter]::ToString([Convert]::FromBase64String($base64Sha256)) -replace '-', '').ToLowerInvariant()
  } catch {
    throw "The current gateway code hash is not valid base64 SHA-256."
  }
  $environment = @($Gateway.environment)
  if ($decodedSha256 -cne $artifactSha256 -or $environment.Count -ne 1 -or
      [string]$environment[0].variables.RELEASE_SHA -cne $artifactSha256) {
    throw "The current gateway code hash and release marker do not match its immutable artifact key."
  }
  if ([string]$Head.VersionId -cne $objectVersion -or [long]$Head.ContentLength -le 0 -or
      [string]$Head.ServerSideEncryption -cne "aws:kms" -or
      [string]$Head.SSEKMSKeyId -cne $ExpectedKmsKeyArn -or -not $Head.BucketKeyEnabled -or
      [string]$Head.ChecksumSHA256 -cne $base64Sha256 -or
      [string]$Head.Metadata.'source-sha' -cne $sourceSha -or
      [string]$Head.Metadata.'artifact-sha256' -cne $artifactSha256) {
    throw "The current gateway artifact failed its exact version, checksum, KMS, or release-metadata gate."
  }
  return [pscustomobject]@{
    Key = $key
    ObjectVersion = $objectVersion
    Base64Sha256 = $base64Sha256
    SourceSha = $sourceSha
    ArtifactSha256 = $artifactSha256
  }
}

function Set-VerifiedCurrentGatewayArtifactVariables {
  $state = Invoke-TerraformJson -Arguments @("show", "-json") -Operation "Current gateway input preservation"
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  Add-ManagedResources -Module $state.values.root_module -Destination $resources
  $gatewayAddress = "module.platform.aws_lambda_function.gateway[0]"
  if (-not $resources.ContainsKey($gatewayAddress)) {
    throw "Current Terraform state does not contain the exact development gateway Lambda."
  }
  $gateway = $resources[$gatewayAddress].values
  if (-not $resources.ContainsKey("module.platform.aws_kms_key.platform")) {
    throw "Current Terraform state does not contain the exact platform KMS key."
  }
  $kmsKeyArn = [string]$resources["module.platform.aws_kms_key.platform"].values.arn
  if ($kmsKeyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/[a-f0-9-]+$") {
    throw "The Terraform-owned platform KMS key is outside the exact development boundary."
  }
  $head = Invoke-AwsJson -Arguments @(
    "s3api", "head-object", "--bucket", ([string]$gateway.s3_bucket), "--key", ([string]$gateway.s3_key),
    "--version-id", ([string]$gateway.s3_object_version),
    "--checksum-mode", "ENABLED", "--output", "json"
  ) -Operation "Current gateway artifact validation"
  $evidence = Assert-CurrentGatewayArtifactEvidence -Gateway $gateway -Head $head `
    -ExpectedBucket ([string](Get-TerraformOutput -Name "artifact_bucket")) -ExpectedKmsKeyArn $kmsKeyArn

  $env:TF_VAR_gateway_lambda_artifact_s3_key = $evidence.Key
  $env:TF_VAR_gateway_lambda_artifact_s3_object_version = $evidence.ObjectVersion
  $env:TF_VAR_gateway_lambda_artifact_sha256 = $evidence.ArtifactSha256
  $env:TF_VAR_gateway_lambda_artifact_base64sha256 = $evidence.Base64Sha256
  return [pscustomobject]@{ SourceSha = $evidence.SourceSha; ArtifactSha256 = $evidence.ArtifactSha256 }
}

function Assert-PlanWasApplied {
  param([Parameter(Mandatory)][object]$Plan)

  if (-not $Plan.complete -or $Plan.errored) { throw "The source plan was not complete and successful." }
  if ($null -eq $Plan.variables -or $null -eq $Plan.planned_values.root_module) {
    throw "The source plan does not contain reconstructable inputs and managed values."
  }
  $changes = @(Get-MeaningfulChanges -Changes @($Plan.resource_changes))
  if ($changes.Count -ne 0) {
    throw "The saved source plan must be an already accepted zero-change input baseline."
  }
}

function Get-TerraformOutput {
  param([Parameter(Mandatory)][string]$Name)
  return Invoke-TerraformJson -Arguments @("output", "-json", $Name) -Operation "Terraform output '$Name' inspection"
}

function Assert-Artifact {
  if ($MigrationImage -notmatch '^(?<repository>[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9/_-]+)@(?<digest>sha256:[a-f0-9]{64})$') {
    throw "MigrationImage must be an exact ECR manifest digest URI."
  }
  $requestedRepositoryUrl = [string]$Matches.repository
  $platformDigest = [string]$Matches.digest
  $repositoryUrl = [string](Get-TerraformOutput -Name "migration_repository_url")
  if ($requestedRepositoryUrl -cne $repositoryUrl -or $repositoryUrl -notmatch "^$ExpectedAccountId\.dkr\.ecr\.$([regex]::Escape($Region))\.amazonaws\.com/$([regex]::Escape($repositoryName))$") {
    throw "The migration image is not in the exact Terraform-owned development repository."
  }

  $repository = Invoke-AwsJson -Arguments @(
    "ecr", "describe-repositories", "--repository-names", $repositoryName, "--output", "json"
  ) -Operation "Migration repository validation"
  $repositories = @($repository.repositories)
  if ($repositories.Count -ne 1 -or
      [string]$repositories[0].repositoryUri -cne $repositoryUrl -or
      [string]$repositories[0].imageTagMutability -cne "IMMUTABLE" -or
      -not $repositories[0].imageScanningConfiguration.scanOnPush -or
      [string]$repositories[0].encryptionConfiguration.encryptionType -cne "KMS" -or
      [string]::IsNullOrWhiteSpace([string]$repositories[0].encryptionConfiguration.kmsKey)) {
    throw "The migration repository is not immutable, scan-on-push, and customer-KMS encrypted."
  }

  $indexResponse = Invoke-AwsJson -Arguments @(
    "ecr", "batch-get-image", "--repository-name", $repositoryName,
    "--image-ids", "imageTag=$SourceSha", "--accepted-media-types",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json", "--output", "json"
  ) -Operation "Migration source-index validation"
  if (@($indexResponse.failures).Count -ne 0 -or @($indexResponse.images).Count -ne 1) {
    throw "The source SHA does not resolve to exactly one immutable migration image index."
  }
  $indexImage = @($indexResponse.images)[0]
  $indexManifestText = [string]$indexImage.imageManifest
  if (("sha256:" + (Get-TextSha256 -Value $indexManifestText)) -cne [string]$indexImage.imageId.imageDigest) {
    throw "The source-index manifest checksum does not match its ECR digest metadata."
  }
  $indexManifest = $indexManifestText | ConvertFrom-Json
  $platforms = @($indexManifest.manifests | Where-Object {
      [string]$_.platform.os -ceq "linux" -and [string]$_.platform.architecture -ceq "amd64"
    })
  if ($platforms.Count -ne 1 -or [string]$platforms[0].digest -cne $platformDigest) {
    throw "The source index must attest to exactly one Linux/AMD64 manifest matching MigrationImage."
  }

  $manifestResponse = Invoke-AwsJson -Arguments @(
    "ecr", "batch-get-image", "--repository-name", $repositoryName,
    "--image-ids", "imageDigest=$platformDigest", "--accepted-media-types",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json", "--output", "json"
  ) -Operation "Migration platform-manifest validation"
  if (@($manifestResponse.failures).Count -ne 0 -or @($manifestResponse.images).Count -ne 1) {
    throw "The exact migration platform manifest is unavailable."
  }
  $manifestImage = @($manifestResponse.images)[0]
  $manifestText = [string]$manifestImage.imageManifest
  if ([string]$manifestImage.imageId.imageDigest -cne $platformDigest -or
      ("sha256:" + (Get-TextSha256 -Value $manifestText)) -cne $platformDigest) {
    throw "The migration platform manifest checksum does not match the reviewed digest."
  }
  $manifest = $manifestText | ConvertFrom-Json
  $configDigest = [string]$manifest.config.digest
  if ($configDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw "The migration image config digest is invalid." }

  $scan = Invoke-AwsJson -Arguments @(
    "ecr", "describe-image-scan-findings", "--repository-name", $repositoryName,
    "--image-id", "imageDigest=$platformDigest", "--output", "json"
  ) -Operation "Migration image scan validation"
  $counts = $scan.imageScanFindings.findingSeverityCounts
  $critical = Get-OptionalProperty -Object $counts -Name "CRITICAL"
  $high = Get-OptionalProperty -Object $counts -Name "HIGH"
  $criticalCount = if ($null -eq $critical) { 0 } else { [int]$critical }
  $highCount = if ($null -eq $high) { 0 } else { [int]$high }
  if ([string]$scan.imageScanStatus.status -cne "COMPLETE" -or
      $criticalCount -ne 0 -or $highCount -ne 0) {
    throw "The exact migration platform manifest has not passed the zero-High/zero-Critical scan gate."
  }

  $download = Invoke-AwsJson -Arguments @(
    "ecr", "get-download-url-for-layer", "--repository-name", $repositoryName,
    "--layer-digest", $configDigest, "--output", "json"
  ) -Operation "Migration image-config validation"
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest -Uri ([string]$download.downloadUrl) -OutFile $temporary -UseBasicParsing | Out-Null
    if (("sha256:" + (Get-FileSha256 -Path $temporary)) -cne $configDigest) {
      throw "The downloaded migration image config failed its checksum gate."
    }
    $config = Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json
    if ([string]$config.os -cne "linux" -or [string]$config.architecture -cne "amd64" -or
        [string]$config.config.User -cne "65532:65532" -or
        @($config.config.Cmd).Count -ne 1 -or [string]@($config.config.Cmd)[0] -cne "runner/dist/src/main.js") {
      throw "The migration image metadata does not preserve the reviewed Linux/AMD64 non-root runner boundary."
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }

  return [pscustomobject]@{ Digest = $platformDigest; RepositoryUrl = $repositoryUrl }
}

function Get-MeaningfulChanges {
  param([AllowNull()][object[]]$Changes)
  return @($Changes | Where-Object {
      $actions = @($_.change.actions)
      -not ($actions.Count -eq 1 -and $actions[0] -in @("no-op", "read"))
    })
}

function Test-IgnorableRdsRestorableTimeRefresh {
  param([Parameter(Mandatory)][object]$Drift)

  if ([string]$Drift.address -cne "module.platform.aws_db_instance.postgres[0]" -or
      @($Drift.change.actions).Count -ne 1 -or [string]@($Drift.change.actions)[0] -cne "update") {
    return $false
  }
  $beforeTime = [datetime]::MinValue
  $afterTime = [datetime]::MinValue
  $beforeValue = $Drift.change.before.latest_restorable_time
  $afterValue = $Drift.change.after.latest_restorable_time
  $beforeValid = if ($beforeValue -is [datetime]) {
    $beforeTime = [datetime]$beforeValue
    $beforeTime.Kind -eq [DateTimeKind]::Utc -and $beforeTime.Ticks % [TimeSpan]::TicksPerSecond -eq 0
  } else {
    [string]$beforeValue -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' -and [datetime]::TryParseExact(
      [string]$beforeValue, "yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
      [ref]$beforeTime
    )
  }
  $afterValid = if ($afterValue -is [datetime]) {
    $afterTime = [datetime]$afterValue
    $afterTime.Kind -eq [DateTimeKind]::Utc -and $afterTime.Ticks % [TimeSpan]::TicksPerSecond -eq 0
  } else {
    [string]$afterValue -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' -and [datetime]::TryParseExact(
      [string]$afterValue, "yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
      [ref]$afterTime
    )
  }
  if (-not $beforeValid -or -not $afterValid -or $afterTime -lt $beforeTime) {
    return $false
  }
  $before = $Drift.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $after = $Drift.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $before.PSObject.Properties.Remove("latest_restorable_time")
  $after.PSObject.Properties.Remove("latest_restorable_time")
  return (($before | ConvertTo-Json -Compress -Depth 50) -ceq
    ($after | ConvertTo-Json -Compress -Depth 50))
}

function Test-IgnorableMigrationTaskTagsRefresh {
  param([Parameter(Mandatory)][object]$Drift)

  if ([string]$Drift.address -cne $migrationAddress -or
      @($Drift.change.actions).Count -ne 1 -or
      [string]@($Drift.change.actions)[0] -cne "update") {
    return $false
  }
  $beforeTags = $Drift.change.before.PSObject.Properties["tags"]
  $afterTags = $Drift.change.after.PSObject.Properties["tags"]
  if ($null -eq $beforeTags -or $null -ne $beforeTags.Value -or
      $null -eq $afterTags -or $null -eq $afterTags.Value -or
      @($afterTags.Value.PSObject.Properties).Count -ne 0 -or
      @($Drift.change.after_unknown.PSObject.Properties).Count -ne 0) {
    return $false
  }
  $before = $Drift.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $after = $Drift.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $before.PSObject.Properties.Remove("tags")
  $after.PSObject.Properties.Remove("tags")
  return (($before | ConvertTo-Json -Compress -Depth 50) -ceq
    ($after | ConvertTo-Json -Compress -Depth 50))
}

function Get-UnacceptedVerificationDrift {
  param([AllowNull()][object[]]$Drift)

  return @(Get-MeaningfulChanges -Changes $Drift | Where-Object {
      -not (Test-IgnorableRdsRestorableTimeRefresh -Drift $_) -and
      -not (Test-IgnorableMigrationTaskTagsRefresh -Drift $_)
    })
}

function Assert-ExactTaskPlan {
  param([Parameter(Mandatory)][object]$Plan)

  if (-not $Plan.complete -or -not $Plan.applyable -or $Plan.errored) {
    throw "The task plan is not complete and applyable."
  }
  if ([string]$Plan.variables.migration_image.value -cne $MigrationImage) {
    throw "The task plan is not bound to the reviewed migration digest."
  }
  $drift = @(Get-MeaningfulChanges -Changes @($Plan.resource_drift) | Where-Object {
      -not (Test-IgnorableRdsRestorableTimeRefresh -Drift $_)
    })
  if ($drift.Count -ne 0) { throw "The task plan contains resource drift; reconcile it separately before migration." }
  $changes = @(Get-MeaningfulChanges -Changes @($Plan.resource_changes))
  if ($changes.Count -ne 1 -or [string]$changes[0].address -cne $migrationAddress) {
    throw "The task plan may change only the one-off migration task definition."
  }
  $change = $changes[0].change
  $actions = @($change.actions)
  if ($actions.Count -ne 2 -or "create" -notin $actions -or "delete" -notin $actions) {
    throw "The migration task definition must be replaced create-before-destroy."
  }
  $replacePaths = @($change.replace_paths)
  if ($replacePaths.Count -ne 1 -or @($replacePaths[0]).Count -ne 1 -or [string]@($replacePaths[0])[0] -cne "container_definitions") {
    throw "Only the migration container definition may force task replacement."
  }

  $beforeContainer = [string]$change.before.container_definitions | ConvertFrom-Json
  $afterContainer = [string]$change.after.container_definitions | ConvertFrom-Json
  if (@($beforeContainer).Count -ne 1 -or @($afterContainer).Count -ne 1) {
    throw "The migration task plan must contain exactly one container."
  }
  foreach ($container in @(@($beforeContainer)[0], @($afterContainer)[0])) {
    foreach ($propertyName in @("mountPoints", "portMappings", "systemControls", "volumesFrom")) {
      $property = $container.PSObject.Properties[$propertyName]
      if ($null -eq $property) { continue }
      if (@($property.Value).Count -ne 0) {
        throw "A provider-default migration container collection is not empty."
      }
      $container.PSObject.Properties.Remove($propertyName)
    }
  }
  @($beforeContainer)[0].image = $MigrationImage
  if (($beforeContainer | ConvertTo-Json -Compress -Depth 30) -cne ($afterContainer | ConvertTo-Json -Compress -Depth 30)) {
    throw "The migration digest must be the only container-definition change."
  }

  $ignored = @("container_definitions", "arn", "arn_without_revision", "id", "revision")
  foreach ($property in @($change.after.PSObject.Properties)) {
    if ($property.Name -in $ignored) { continue }
    $beforeProperty = $change.before.PSObject.Properties[$property.Name]
    if ($property.Name -ceq "tags" -and $null -eq $property.Value -and
        $null -ne $beforeProperty -and @($beforeProperty.Value.PSObject.Properties).Count -eq 0) {
      continue
    }
    if ($property.Name -in @("ipc_mode", "pid_mode", "task_role_arn") -and
        $null -eq $property.Value -and $null -ne $beforeProperty -and
        $beforeProperty.Value -is [string] -and [string]$beforeProperty.Value -ceq "" -and
        (Get-OptionalProperty -Object $change.after_unknown -Name $property.Name) -ne $true) {
      continue
    }
    if ($null -eq $beforeProperty -or
        ($beforeProperty.Value | ConvertTo-Json -Compress -Depth 30) -cne
        ($property.Value | ConvertTo-Json -Compress -Depth 30)) {
      throw "A non-image migration task attribute changed."
    }
  }

  $outputChanges = @($Plan.output_changes.PSObject.Properties | Where-Object {
      $actions = @($_.Value.actions)
      -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
    })
  if ($outputChanges.Count -ne 1 -or $outputChanges[0].Name -cne "migration_task_definition_arn") {
    throw "Only the migration task-definition output may change."
  }
}

function Read-TaskPlanMetadata {
  param(
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256
  )

  if ((Get-FileSha256 -Path $PlanPath) -cne $PlanSha256) { throw "The task plan checksum does not match the reviewed value." }
  $metadataPath = "$PlanPath.metadata.json"
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "The task-plan metadata sidecar is missing." }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  if ([int]$metadata.schemaVersion -ne 1 -or [string]$metadata.kind -cne "development-document-migration-task" -or
      [string]$metadata.environment -cne "development" -or [string]$metadata.region -cne $Region -or
      [string]$metadata.accountId -cne $ExpectedAccountId -or [string]$metadata.stateBucket -cne $StateBucket -or
      [string]$metadata.sourceSha -cne $SourceSha -or [string]$metadata.migrationImage -cne $MigrationImage -or
      [string]$metadata.taskPlanSha256 -cne $PlanSha256 -or
      [string]$metadata.appliedPlanSha256 -notmatch '^[a-f0-9]{64}$' -or
      [IO.Path]::GetFullPath([string]$metadata.taskPlanPath) -cne [IO.Path]::GetFullPath($PlanPath) -or
      [string]::IsNullOrWhiteSpace([string]$metadata.appliedPlanPath)) {
    throw "The task-plan metadata does not match the reviewed release."
  }
  $metadataAppliedPlan = Resolve-OperatorPath -Candidate ([string]$metadata.appliedPlanPath) -MustExist
  if ((Get-FileSha256 -Path $metadataAppliedPlan) -cne [string]$metadata.appliedPlanSha256) {
    throw "The task-plan metadata no longer resolves to its exact already-applied source plan."
  }
  return $metadata
}

function Assert-TaskDefinition {
  param([Parameter(Mandatory)][string]$TaskDefinitionArn)

  $response = Invoke-AwsJson -Arguments @(
    "ecs", "describe-task-definition", "--task-definition", $TaskDefinitionArn, "--output", "json"
  ) -Operation "Migration task-definition validation"
  $task = $response.taskDefinition
  $containers = @($task.containerDefinitions)
  $environment = @($containers[0].environment)
  $secrets = @($containers[0].secrets)
  $compatibilities = @($task.requiresCompatibilities)
  if ([string]$task.status -cne "ACTIVE" -or [string]$task.family -cne $migrationFamily -or
      -not (Test-EcsFaultInjectionDisabled -TaskDefinition $task) -or
      $compatibilities.Count -ne 1 -or [string]$compatibilities[0] -cne "FARGATE" -or
      [string]$task.networkMode -cne "awsvpc" -or [string]$task.cpu -cne "256" -or
      [string]$task.memory -cne "512" -or [string]$task.runtimePlatform.cpuArchitecture -cne "X86_64" -or
      [string]$task.runtimePlatform.operatingSystemFamily -cne "LINUX" -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "taskRoleArn")) -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "ipcMode")) -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "pidMode")) -or
      $containers.Count -ne 1 -or [string]$containers[0].name -cne "database-migration" -or
      [string]$containers[0].image -cne $MigrationImage -or -not $containers[0].essential -or
      -not $containers[0].readonlyRootFilesystem -or @($containers[0].command).Count -ne 1 -or
      [string]@($containers[0].command)[0] -cne "runner/dist/src/main.js" -or
      $environment.Count -ne 1 -or [string]$environment[0].name -cne "NODE_ENV" -or
      [string]$environment[0].value -cne "production" -or $secrets.Count -ne 1 -or
      [string]$secrets[0].name -cne "DATABASE_URL" -or
      [string]$secrets[0].valueFrom -notmatch "^arn:aws:secretsmanager:$([regex]::Escape($Region)):$ExpectedAccountId`:secret:") {
    throw "The deployed migration task definition violates the reviewed one-off boundary."
  }
  $log = $containers[0].logConfiguration
  if ([string]$log.logDriver -cne "awslogs" -or [string]$log.options.'awslogs-region' -cne $Region -or
      [string]$log.options.'awslogs-stream-prefix' -cne "database-migration" -or
      [string]::IsNullOrWhiteSpace([string]$log.options.'awslogs-group')) {
    throw "The migration task must use the exact aggregate CloudWatch log boundary."
  }
  return $task
}

function Get-ActiveMigrationTasks {
  param([Parameter(Mandatory)][string]$ClusterArn)
  $result = Invoke-AwsJson -Arguments @(
    "ecs", "list-tasks", "--cluster", $ClusterArn, "--family", $migrationFamily,
    "--desired-status", "RUNNING", "--output", "json"
  ) -Operation "Migration task-count validation"
  return @($result.taskArns)
}

function Assert-ZeroMigrationCompute {
  param([Parameter(Mandatory)][string]$ClusterArn)
  if (@(Get-ActiveMigrationTasks -ClusterArn $ClusterArn).Count -ne 0) {
    throw "A migration task is already pending or running."
  }
  $services = Invoke-AwsJson -Arguments @(
    "ecs", "list-services", "--cluster", $ClusterArn, "--output", "json"
  ) -Operation "ECS service-boundary validation"
  if (@($services.serviceArns).Count -ne 0) { throw "The migration-only ECS cluster must contain zero services." }
}

function Assert-DatabaseSafety {
  $state = Invoke-TerraformJson -Arguments @("show", "-json") -Operation "Database state-boundary inspection"
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  Add-ManagedResources -Module $state.values.root_module -Destination $resources
  $databaseAddress = "module.platform.aws_db_instance.postgres[0]"
  if (-not $resources.ContainsKey($databaseAddress) -or
      [string]$resources[$databaseAddress].values.identifier -cne "ai-job-apply-development") {
    throw "Current Terraform state does not own the exact development database."
  }
  $response = Invoke-AwsJson -Arguments @(
    "rds", "describe-db-instances", "--db-instance-identifier", "ai-job-apply-development",
    "--output", "json"
  ) -Operation "Development database safety validation"
  $databases = @($response.DBInstances)
  if ($databases.Count -ne 1) { throw "The exact Terraform-owned development database was not found." }
  $database = $databases[0]
  if ([string]$database.DBInstanceArn -notmatch "^arn:aws:rds:$([regex]::Escape($Region)):$ExpectedAccountId`:db:ai-job-apply-development$" -or
      [string]$database.DBInstanceStatus -cne "available" -or -not $database.StorageEncrypted -or
      -not $database.DeletionProtection -or [int]$database.BackupRetentionPeriod -lt 7 -or
      $null -eq $database.LatestRestorableTime) {
    throw "The development database must be available, encrypted, deletion protected, and covered by at least seven days of PITR before migration."
  }
}

function Assert-RequestNetwork {
  param(
    [Parameter(Mandatory)][string[]]$ExpectedSubnets,
    [Parameter(Mandatory)][string]$ExpectedSecurityGroup
  )

  $expectedVpc = [string](Get-TerraformOutput -Name "vpc_id")
  if ($expectedVpc -notmatch '^vpc-[a-f0-9]+$') { throw "Terraform did not expose the exact migration VPC." }
  $subnetArguments = @("ec2", "describe-subnets", "--subnet-ids")
  $subnetArguments += $ExpectedSubnets
  $subnetArguments += @("--output", "json")
  $subnetResponse = Invoke-AwsJson -Arguments $subnetArguments -Operation "Migration subnet validation"
  $actualSubnets = @($subnetResponse.Subnets)
  if ($actualSubnets.Count -ne 2 -or
      @($actualSubnets | Where-Object { [string]$_.VpcId -cne $expectedVpc }).Count -ne 0 -or
      (@($actualSubnets | ForEach-Object { [string]$_.SubnetId } | Sort-Object) -join ',') -cne
      (@($ExpectedSubnets | Sort-Object) -join ',')) {
    throw "The reviewed migration subnets do not belong to the exact Terraform-owned VPC."
  }
  $groupResponse = Invoke-AwsJson -Arguments @(
    "ec2", "describe-security-groups", "--group-ids", $ExpectedSecurityGroup, "--output", "json"
  ) -Operation "Migration security-group validation"
  $groups = @($groupResponse.SecurityGroups)
  if ($groups.Count -ne 1 -or [string]$groups[0].GroupId -cne $ExpectedSecurityGroup -or
      [string]$groups[0].VpcId -cne $expectedVpc) {
    throw "The reviewed migration security group does not belong to the exact Terraform-owned VPC."
  }
}

function Test-NoEffectiveOverrides {
  param([AllowNull()][object]$Overrides)
  if ($null -eq $Overrides) { return $true }
  foreach ($name in @("cpu", "memory", "ephemeralStorage", "executionRoleArn", "taskRoleArn", "inferenceAcceleratorOverrides")) {
    $value = Get-OptionalProperty $Overrides $name
    if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value) -and @($value).Count -ne 0) { return $false }
  }
  $containers = @(Get-OptionalProperty $Overrides "containerOverrides")
  if ($containers.Count -gt 1) { return $false }
  if ($containers.Count -eq 1) {
    $container = $containers[0]
    if ([string]$container.name -cne "database-migration") { return $false }
    foreach ($name in @("command", "environment", "environmentFiles", "cpu", "memory", "memoryReservation", "resourceRequirements")) {
      $value = Get-OptionalProperty $container $name
      if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value) -and @($value).Count -ne 0) { return $false }
    }
  }
  return $true
}

function Resolve-TaskLogStreamName {
  param(
    [Parameter(Mandatory)][object]$Task,
    [Parameter(Mandatory)][object]$Container,
    [Parameter(Mandatory)][object]$TaskDefinition
  )

  $taskId = ([string]$Task.taskArn -split '/')[-1]
  $definitionContainer = @($TaskDefinition.containerDefinitions)
  $prefix = [string]$definitionContainer[0].logConfiguration.options.'awslogs-stream-prefix'
  if ($taskId -notmatch '^[a-f0-9]{32}$' -or $definitionContainer.Count -ne 1 -or
      [string]$definitionContainer[0].name -cne "database-migration" -or
      [string]::IsNullOrWhiteSpace($prefix)) {
    throw "The migration log-stream identity could not be derived from the exact task definition."
  }
  $expected = "$prefix/database-migration/$taskId"
  $reported = [string](Get-OptionalProperty $Container "logStreamName")
  if (-not [string]::IsNullOrWhiteSpace($reported) -and $reported -cne $expected) {
    throw "ECS reported a migration log stream outside the exact task identity."
  }
  return $expected
}

function Set-RecoveredReceiptEvidence {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][datetime]$StoppedAt,
    [Parameter(Mandatory)][string]$RecoveryOperatorSourceSha
  )

  if ([string]$Receipt.phase -cne "submitted" -or
      $null -ne (Get-OptionalProperty $Receipt "stoppedAt") -or
      $null -ne (Get-OptionalProperty $Receipt "exitCode") -or
      $RecoveryOperatorSourceSha -notmatch '^[a-f0-9]{40}$') {
    throw "Only an unfinalized submitted receipt can be recovered."
  }
  $Receipt.phase = "verified"
  $Receipt | Add-Member -NotePropertyName stoppedAt `
    -NotePropertyValue $StoppedAt.ToUniversalTime().ToString("o") -Force
  $Receipt | Add-Member -NotePropertyName exitCode -NotePropertyValue 0 -Force
  $Receipt | Add-Member -NotePropertyName recoveredByOperatorSourceSha `
    -NotePropertyValue $RecoveryOperatorSourceSha -Force
  return $Receipt
}

function Assert-TaskResultAndLogs {
  param(
    [Parameter(Mandatory)][string]$ClusterArn,
    [Parameter(Mandatory)][string]$TaskArn,
    [Parameter(Mandatory)][string]$TaskDefinitionArn
  )

  $response = Invoke-AwsJson -Arguments @(
    "ecs", "describe-tasks", "--cluster", $ClusterArn, "--tasks", $TaskArn, "--output", "json"
  ) -Operation "Migration task-result validation"
  if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne 1) {
    throw "The migration execution did not resolve to exactly one task."
  }
  $task = @($response.tasks)[0]
  $containers = @($task.containers)
  if ([string]$task.taskDefinitionArn -cne $TaskDefinitionArn -or [string]$task.launchType -cne "FARGATE" -or
      [string]$task.lastStatus -cne "STOPPED" -or -not (Test-NoEffectiveOverrides $task.overrides) -or
      $containers.Count -ne 1 -or [string]$containers[0].name -cne "database-migration" -or
      [int]$containers[0].exitCode -ne 0 -or [string]$containers[0].image -cne $MigrationImage -or
      [string]$containers[0].imageDigest -cne (($MigrationImage -split '@', 2)[1])) {
    throw "The migration task did not stop successfully on the exact reviewed no-override definition."
  }

  $definition = Assert-TaskDefinition -TaskDefinitionArn $TaskDefinitionArn
  $logGroup = [string]@($definition.containerDefinitions)[0].logConfiguration.options.'awslogs-group'
  $logStream = Resolve-TaskLogStreamName -Task $task -Container $containers[0] `
    -TaskDefinition $definition
  $expectedMessages = @(
    'Database migrations through 0005_resume_fact_proposals applied and verified.',
    'Jobs migrations through 0003_duplicate_resolution_audit_guard applied and verified.',
    'Documents migrations through 0002_resume_processing applied and verified.',
    'All service-owned database migrations applied and verified.'
  )
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $logs = Invoke-AwsJson -Arguments @(
      "logs", "get-log-events", "--log-group-name", $logGroup,
      "--log-stream-name", $logStream, "--start-from-head",
      "--limit", "100", "--output", "json"
    ) -Operation "Migration aggregate-log validation"
    $messages = @($logs.events | ForEach-Object { [string]$_.message })
    $unexpected = @($messages | Where-Object { $_ -cnotin $expectedMessages })
    if ($unexpected.Count -ne 0) {
      throw "The migration log stream contains an unexpected event; inspect it locally without recording payloads."
    }
    if ($messages.Count -eq $expectedMessages.Count) {
      foreach ($expectedMessage in $expectedMessages) {
        if (@($messages | Where-Object { $_ -ceq $expectedMessage }).Count -ne 1) {
          throw "The migration log stream failed the aggregate-only success contract."
        }
      }
      return $task
    }
    Start-Sleep -Seconds 2
  }
  throw "The exact four aggregate success events did not become visible within the bounded CloudWatch polling window."
}

function Read-ExecutionPlan {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Sha256,
    [Parameter(Mandatory)][string]$TaskPlanSha256,
    [Parameter(Mandatory)][string]$ExpectedOperatorSourceSha
  )

  if ((Get-FileSha256 -Path $Path) -cne $Sha256) { throw "The execution-plan checksum does not match the reviewed value." }
  $plan = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  Assert-ExecutionIdentity -Value $plan -ExpectedKind "development-document-migration-execution" `
    -ReleaseSourceSha $SourceSha -OperatorSourceSha $ExpectedOperatorSourceSha
  $request = $plan.runTaskRequest
  $properties = @($request.PSObject.Properties.Name)
  $allowed = @("cluster", "taskDefinition", "count", "launchType", "networkConfiguration", "clientToken", "startedBy")
  if ([string]$plan.environment -cne "development" -or [string]$plan.region -cne $Region -or
      [string]$plan.accountId -cne $ExpectedAccountId -or [string]$plan.stateBucket -cne $StateBucket -or
      [string]$plan.migrationImage -cne $MigrationImage -or
      [string]$plan.taskPlanSha256 -cne $TaskPlanSha256 -or @($properties | Where-Object { $_ -notin $allowed }).Count -ne 0 -or
      $properties.Count -ne $allowed.Count -or [int]$request.count -ne 1 -or
      [string]$request.launchType -cne "FARGATE" -or
      [string]$request.networkConfiguration.awsvpcConfiguration.assignPublicIp -cne "ENABLED" -or
      @($request.networkConfiguration.awsvpcConfiguration.subnets).Count -ne 2 -or
      @($request.networkConfiguration.awsvpcConfiguration.securityGroups).Count -ne 1 -or
      [string]$request.clientToken -notmatch '^d1-document-[a-f0-9]{32}$' -or
      [string]$request.startedBy -notmatch '^d1-document-[a-f0-9]{12}$') {
    throw "The execution plan violates the exact one-task, no-override request contract."
  }
  return $plan
}

function Assert-ExecutionIdentity {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string]$ExpectedKind,
    [Parameter(Mandatory)][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha
  )

  if ([int]$Value.schemaVersion -ne 2 -or [string]$Value.kind -cne $ExpectedKind -or
      [string]$Value.sourceSha -cne $ReleaseSourceSha -or
      [string]$Value.operatorSourceSha -cne $OperatorSourceSha) {
    throw "The execution evidence is not bound to the exact applied release and operator revision."
  }
}

function Assert-DurableClaimPutResult {
  param(
    [Parameter(Mandatory)][int]$ExitCode,
    [AllowNull()][object]$PutResult,
    [Parameter(Mandatory)][string]$ExpectedChecksum
  )

  if ($ExitCode -ne 0) {
    throw "The reviewed execution is already claimed or its durable one-time claim could not be created. Do not retry blindly."
  }
  if ($null -eq $PutResult -or [string]::IsNullOrWhiteSpace([string]$PutResult.VersionId) -or
      [string]$PutResult.ChecksumSHA256 -cne $ExpectedChecksum) {
    throw "The durable execution claim did not produce an exact checksummed immutable object version. Do not submit the task."
  }
}

function Assert-DurableExecutionClaimEvidence {
  param(
    [Parameter(Mandatory)][object]$Head,
    [Parameter(Mandatory)][string]$ClaimVersion,
    [Parameter(Mandatory)][string]$ExecutionPlanSha256,
    [Parameter(Mandatory)][string]$ExpectedChecksum,
    [Parameter(Mandatory)][string]$ExpectedKmsKeyArn,
    [Parameter(Mandatory)][string]$ReleaseSourceSha,
    [Parameter(Mandatory)][string]$OperatorSourceSha
  )

  if ([string]$Head.ServerSideEncryption -cne "aws:kms" -or
      [string]$Head.SSEKMSKeyId -cne $ExpectedKmsKeyArn -or -not $Head.BucketKeyEnabled -or
      [long]$Head.ContentLength -le 0 -or [string]$Head.VersionId -cne $ClaimVersion -or
      [string]$Head.ChecksumSHA256 -cne $ExpectedChecksum -or
      [string]$Head.Metadata.'execution-plan-sha256' -cne $ExecutionPlanSha256 -or
      [string]$Head.Metadata.'source-sha' -cne $ReleaseSourceSha -or
      [string]$Head.Metadata.'operator-source-sha' -cne $OperatorSourceSha) {
    throw "The durable execution claim is not protected by the exact immutable KMS and checksum boundary. Do not submit the task."
  }
}

function Test-DurableClaimHistoryExists {
  param(
    [AllowNull()][object]$History,
    [Parameter(Mandatory)][string]$ClaimKey
  )

  foreach ($entry in (Get-OptionalProperty $History "Versions")) {
    if ([string](Get-OptionalProperty $entry "Key") -ceq $ClaimKey) { return $true }
  }
  foreach ($entry in (Get-OptionalProperty $History "DeleteMarkers")) {
    if ([string](Get-OptionalProperty $entry "Key") -ceq $ClaimKey) { return $true }
  }
  return $false
}

function New-DurableExecutionClaim {
  param(
    [Parameter(Mandatory)][string]$ExecutionPlanSha256,
    [Parameter(Mandatory)][string]$ClientToken
  )

  $claimKey = "operator-claims/development-document-migration/$ExecutionPlanSha256.json"
  $claim = [ordered]@{
    schemaVersion       = 1
    kind                = "development-document-migration-execution-claim"
    environment         = "development"
    sourceSha           = $SourceSha
    operatorSourceSha   = $operatorSourceSha
    executionPlanSha256 = $ExecutionPlanSha256
    clientToken         = $ClientToken
    claimedAt           = (Get-Date).ToUniversalTime().ToString("o")
  }
  $history = Invoke-AwsJson -Arguments @(
    "s3api", "list-object-versions", "--bucket", $StateBucket, "--prefix", $claimKey,
    "--output", "json"
  ) -Operation "Durable migration execution-claim history validation"
  if (Test-DurableClaimHistoryExists -History $history -ClaimKey $claimKey) {
    throw "The reviewed execution already has durable claim history. Do not replay it."
  }
  $temporaryClaim = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporaryClaim -Value $claim -AllowReplace
    $claimChecksum = Get-FileSha256Base64 -Path $temporaryClaim
    $output = & aws s3api put-object --bucket $StateBucket --key $claimKey `
      --body $temporaryClaim --if-none-match '*' --server-side-encryption aws:kms `
      --ssekms-key-id $script:stateKmsKeyArn --bucket-key-enabled `
      --checksum-algorithm SHA256 --metadata `
      "execution-plan-sha256=$ExecutionPlanSha256,source-sha=$SourceSha,operator-source-sha=$operatorSourceSha" `
      --output json 2>$null
    $putExitCode = $LASTEXITCODE
    $put = if ($putExitCode -eq 0) { $output | ConvertFrom-Json } else { $null }
    Assert-DurableClaimPutResult -ExitCode $putExitCode -PutResult $put `
      -ExpectedChecksum $claimChecksum
  } finally {
    if (Test-Path -LiteralPath $temporaryClaim) { Remove-Item -LiteralPath $temporaryClaim -Force }
  }
  Assert-DurableExecutionClaim -ClaimKey $claimKey -ClaimVersion ([string]$put.VersionId) `
    -ExecutionPlanSha256 $ExecutionPlanSha256 -ExpectedChecksum $claimChecksum `
    -ExpectedClaimOperatorSourceSha $operatorSourceSha
  return [pscustomobject]@{
    Key = $claimKey
    VersionId = [string]$put.VersionId
    ChecksumSHA256 = $claimChecksum
  }
}

function Assert-DurableExecutionClaim {
  param(
    [Parameter(Mandatory)][string]$ClaimKey,
    [Parameter(Mandatory)][string]$ClaimVersion,
    [Parameter(Mandatory)][string]$ExecutionPlanSha256,
    [Parameter(Mandatory)][string]$ExpectedChecksum,
    [Parameter(Mandatory)][string]$ExpectedClaimOperatorSourceSha
  )

  if ($ClaimKey -cne "operator-claims/development-document-migration/$ExecutionPlanSha256.json" -or
      [string]::IsNullOrWhiteSpace($ClaimVersion) -or
      $ExpectedChecksum -notmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The execution claim identity does not match the reviewed execution."
  }
  $head = Invoke-AwsJson -Arguments @(
    "s3api", "head-object", "--bucket", $StateBucket, "--key", $claimKey,
    "--version-id", $ClaimVersion, "--checksum-mode", "ENABLED", "--output", "json"
  ) -Operation "Durable migration execution-claim verification"
  Assert-DurableExecutionClaimEvidence -Head $head -ClaimVersion $ClaimVersion `
    -ExecutionPlanSha256 $ExecutionPlanSha256 -ExpectedChecksum $ExpectedChecksum `
    -ExpectedKmsKeyArn $script:stateKmsKeyArn -ReleaseSourceSha $SourceSha `
    -OperatorSourceSha $ExpectedClaimOperatorSourceSha
}

$postApplyAction = $Action -in @("PlanExecution", "Execute", "Recover", "Verify")
$operatorSourceSha = Assert-CallerToolsAndSource -RequireSource:($Action -ne "Status") `
  -AllowAncestorSource:$postApplyAction
Initialize-EncryptedBackend
Assert-StateObjectEncryption

if ($Action -eq "Status") {
  $clusterArn = [string](Get-TerraformOutput -Name "ecs_cluster_arn")
  $taskDefinitionArn = [string](Get-TerraformOutput -Name "migration_task_definition_arn")
  $active = @(Get-ActiveMigrationTasks -ClusterArn $clusterArn)
  [pscustomobject]@{
    Environment                 = "development"
    Region                      = $Region
    MigrationTaskDefined        = -not [string]::IsNullOrWhiteSpace($taskDefinitionArn)
    ActiveMigrationTaskCount    = $active.Count
    ContinuousEcsServiceCount   = @((Invoke-AwsJson -Arguments @("ecs", "list-services", "--cluster", $clusterArn, "--output", "json") -Operation "ECS service status").serviceArns).Count
    StateCustomerKmsEncrypted   = $true
  }
  exit 0
}

$artifact = Assert-Artifact

if ($Action -eq "PlanTask") {
  if ([string]::IsNullOrWhiteSpace($AppliedPlanPath) -or $AppliedPlanSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "PlanTask requires the already-applied saved plan and its exact SHA-256."
  }
  $appliedPlan = Resolve-OperatorPath -Candidate $AppliedPlanPath -MustExist
  if ((Get-FileSha256 -Path $appliedPlan) -cne $AppliedPlanSha256) {
    throw "The already-applied source plan checksum does not match."
  }
  $sourcePlan = Get-PlanJson -Path $appliedPlan
  Assert-PlanWasApplied -Plan $sourcePlan

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  if ([string]::IsNullOrWhiteSpace($TaskPlanPath)) {
    $TaskPlanPath = Join-Path $operatorRoot "task-$($SourceSha.Substring(0, 12))-$timestamp.tfplan"
  }
  $taskPlan = Resolve-OperatorPath -Candidate $TaskPlanPath -RequireOperatorRoot
  if (Test-Path -LiteralPath $taskPlan) { throw "Refusing to replace an existing task plan." }
  $logPath = "$taskPlan.plan.log"
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $taskPlan) -Force
  $savedTerraformVariables = Save-AndClearTerraformVariables
  try {
    Set-VariablesFromPlan -Plan $sourcePlan -NewMigrationImage $MigrationImage
    Set-VerifiedCurrentGatewayArtifactVariables | Out-Null
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -refresh=true `
      -detailed-exitcode "-out=$taskPlan" *> $logPath
    $planExit = $LASTEXITCODE
  } finally {
    Restore-TerraformVariables -Saved $savedTerraformVariables
  }
  if ($planExit -ne 2) { throw "The migration task plan did not produce exactly one reviewable change. Inspect the ignored local plan log." }
  $planJson = Get-PlanJson -Path $taskPlan
  Assert-ExactTaskPlan -Plan $planJson
  $sha256 = Get-FileSha256 -Path $taskPlan
  $metadata = [ordered]@{
    schemaVersion       = 1
    kind                = "development-document-migration-task"
    environment         = "development"
    region              = $Region
    accountId           = $ExpectedAccountId
    stateBucket         = $StateBucket
    sourceSha           = $SourceSha
    migrationImage      = $MigrationImage
    appliedPlanPath     = $appliedPlan
    appliedPlanSha256   = $AppliedPlanSha256
    taskPlanPath        = $taskPlan
    taskPlanSha256      = $sha256
    meaningfulChanges   = 1
    destructiveChanges  = 0
    createdAt           = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-JsonFile -Path "$taskPlan.metadata.json" -Value $metadata
  [pscustomobject]@{
    Outcome             = "review-required"
    PlanPath            = $taskPlan
    PlanSha256          = $sha256
    ChangedResource     = $migrationAddress
    ArtifactDigest      = $artifact.Digest
    TriggeredTaskCount  = 0
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($TaskPlanPath) -or $ReviewedTaskPlanSha256 -notmatch '^[a-f0-9]{64}$') {
  throw "$Action requires the exact task plan and its reviewed SHA-256."
}
$taskPlan = Resolve-OperatorPath -Candidate $TaskPlanPath -MustExist -RequireOperatorRoot
$taskMetadata = Read-TaskPlanMetadata -PlanPath $taskPlan -PlanSha256 $ReviewedTaskPlanSha256
$taskPlanJson = Get-PlanJson -Path $taskPlan
Assert-ExactTaskPlan -Plan $taskPlanJson

if ($Action -eq "ApplyTask") {
  $clusterArn = [string](Get-TerraformOutput -Name "ecs_cluster_arn")
  Assert-ZeroMigrationCompute -ClusterArn $clusterArn
  $applyLog = "$taskPlan.apply.log"
  & terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $taskPlan *> $applyLog
  if ($LASTEXITCODE -ne 0) { throw "The exact reviewed migration task plan did not apply. Inspect the ignored local apply log." }
  Assert-StateObjectEncryption
  $taskDefinitionArn = [string](Get-TerraformOutput -Name "migration_task_definition_arn")
  $null = Assert-TaskDefinition -TaskDefinitionArn $taskDefinitionArn
  Assert-ZeroMigrationCompute -ClusterArn $clusterArn
  [pscustomobject]@{
    Outcome                    = "applied"
    Environment                = "development"
    TaskPlanSha256             = $ReviewedTaskPlanSha256
    ArtifactDigest             = $artifact.Digest
    ActiveMigrationTaskCount   = 0
    ContinuousEcsServiceCount  = 0
  }
  exit 0
}

$clusterArn = [string](Get-TerraformOutput -Name "ecs_cluster_arn")
$taskDefinitionArn = [string](Get-TerraformOutput -Name "migration_task_definition_arn")
$subnets = @((Get-TerraformOutput -Name "migration_subnet_ids") | ForEach-Object { [string]$_ } | Sort-Object)
$securityGroup = [string](Get-TerraformOutput -Name "application_security_group_id")
if ($subnets.Count -ne 2 -or [string]::IsNullOrWhiteSpace($securityGroup) -or
    $clusterArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:cluster/" -or
    $taskDefinitionArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task-definition/$([regex]::Escape($migrationFamily)):[0-9]+$" -or
    $subnets.Where({ $_ -notmatch '^subnet-[a-f0-9]+$' }).Count -ne 0 -or
    $securityGroup -notmatch '^sg-[a-f0-9]+$') {
  throw "Terraform did not expose exactly two reviewed migration subnets and one application security group."
}
$null = Assert-TaskDefinition -TaskDefinitionArn $taskDefinitionArn
Assert-ZeroMigrationCompute -ClusterArn $clusterArn
Assert-RequestNetwork -ExpectedSubnets $subnets -ExpectedSecurityGroup $securityGroup

if ($Action -eq "PlanExecution") {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) {
    $ExecutionPlanPath = Join-Path $operatorRoot "execution-$($SourceSha.Substring(0, 12))-$timestamp.json"
  }
  $executionPlan = Resolve-OperatorPath -Candidate $ExecutionPlanPath -RequireOperatorRoot
  $token = "d1-document-$([guid]::NewGuid().ToString("N"))"
  $descriptor = [ordered]@{
    schemaVersion  = 2
    kind           = "development-document-migration-execution"
    environment    = "development"
    region         = $Region
    accountId      = $ExpectedAccountId
    stateBucket    = $StateBucket
    sourceSha      = $SourceSha
    operatorSourceSha = $operatorSourceSha
    migrationImage = $MigrationImage
    taskPlanSha256 = $ReviewedTaskPlanSha256
    createdAt      = (Get-Date).ToUniversalTime().ToString("o")
    runTaskRequest = [ordered]@{
      cluster              = $clusterArn
      taskDefinition       = $taskDefinitionArn
      count                = 1
      launchType           = "FARGATE"
      networkConfiguration = [ordered]@{
        awsvpcConfiguration = [ordered]@{
          subnets        = $subnets
          securityGroups = @($securityGroup)
          assignPublicIp = "ENABLED"
        }
      }
      clientToken = $token
      startedBy   = "d1-document-$($SourceSha.Substring(0, 12))"
    }
  }
  Write-JsonFile -Path $executionPlan -Value $descriptor
  $sha256 = Get-FileSha256 -Path $executionPlan
  $null = Read-ExecutionPlan -Path $executionPlan -Sha256 $sha256 `
    -TaskPlanSha256 $ReviewedTaskPlanSha256 -ExpectedOperatorSourceSha $operatorSourceSha
  [pscustomobject]@{
    Outcome                  = "review-required"
    ExecutionPlanPath        = $executionPlan
    ExecutionPlanSha256      = $sha256
    RequestedTaskCount       = 1
    EffectiveOverrideCount   = 0
    ActiveMigrationTaskCount = 0
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath) -or $ReviewedExecutionPlanSha256 -notmatch '^[a-f0-9]{64}$') {
  throw "$Action requires the exact execution plan and its reviewed SHA-256."
}
$executionPlan = Resolve-OperatorPath -Candidate $ExecutionPlanPath -MustExist -RequireOperatorRoot
$expectedExecutionOperatorSha = $operatorSourceSha
if ($Action -in @("Recover", "Verify")) {
  if ((Get-FileSha256 -Path $executionPlan) -cne $ReviewedExecutionPlanSha256) {
    throw "The execution-plan checksum does not match the reviewed value."
  }
  $untrustedExecutionDescriptor = Get-Content -LiteralPath $executionPlan -Raw | ConvertFrom-Json
  $expectedExecutionOperatorSha = [string]$untrustedExecutionDescriptor.operatorSourceSha
  Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $expectedExecutionOperatorSha
}
$executionDescriptor = Read-ExecutionPlan -Path $executionPlan `
  -Sha256 $ReviewedExecutionPlanSha256 -TaskPlanSha256 $ReviewedTaskPlanSha256 `
  -ExpectedOperatorSourceSha $expectedExecutionOperatorSha
$request = $executionDescriptor.runTaskRequest
if ([string]$request.cluster -cne $clusterArn -or [string]$request.taskDefinition -cne $taskDefinitionArn -or
    (@($request.networkConfiguration.awsvpcConfiguration.subnets) -join ',') -cne ($subnets -join ',') -or
    [string]@($request.networkConfiguration.awsvpcConfiguration.securityGroups)[0] -cne $securityGroup) {
  throw "The reviewed execution plan no longer matches the exact Terraform outputs."
}

if ($Action -eq "Execute") {
  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0, 12))-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
  }
  $receipt = Resolve-OperatorPath -Candidate $ReceiptPath -RequireOperatorRoot
  if (Test-Path -LiteralPath $receipt) { throw "Refusing to replace an existing migration execution receipt." }
  Assert-DatabaseSafety
  $claim = New-DurableExecutionClaim -ExecutionPlanSha256 $ReviewedExecutionPlanSha256 `
    -ClientToken ([string]$request.clientToken)

  $temporaryRequest = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporaryRequest -Value $request -AllowReplace
    $run = Invoke-AwsJson -Arguments @(
      "ecs", "run-task", "--cli-input-json", "file://$temporaryRequest", "--output", "json"
    ) -Operation "One-off migration task submission"
  } finally {
    if (Test-Path -LiteralPath $temporaryRequest) { Remove-Item -LiteralPath $temporaryRequest -Force }
  }
  if (@($run.failures).Count -ne 0 -or @($run.tasks).Count -ne 1) {
    throw "ECS did not accept exactly one migration task."
  }
  $taskArn = [string]@($run.tasks)[0].taskArn
  if (-not (Test-NoEffectiveOverrides @($run.tasks)[0].overrides)) {
    throw "ECS returned an effective migration task override."
  }
  $receiptValue = [ordered]@{
    schemaVersion       = 2
    kind                = "development-document-migration-receipt"
    environment         = "development"
    accountId           = $ExpectedAccountId
    stateBucket         = $StateBucket
    sourceSha           = $SourceSha
    operatorSourceSha   = $operatorSourceSha
    migrationImage      = $MigrationImage
    taskPlanSha256      = $ReviewedTaskPlanSha256
    executionPlanSha256 = $ReviewedExecutionPlanSha256
    executionClaimKey   = $claim.Key
    executionClaimVersion = $claim.VersionId
    executionClaimChecksumSHA256 = $claim.ChecksumSHA256
    taskArn             = $taskArn
    phase               = "submitted"
    submittedAt         = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-JsonFile -Path $receipt -Value $receiptValue

  & aws ecs wait tasks-stopped --cluster $clusterArn --tasks $taskArn 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The submitted migration task did not reach STOPPED within the bounded ECS waiter. Do not retry blindly; inspect the receipt task."
  }
  $stoppedTask = Assert-TaskResultAndLogs -ClusterArn $clusterArn -TaskArn $taskArn -TaskDefinitionArn $taskDefinitionArn
  Assert-ZeroMigrationCompute -ClusterArn $clusterArn
  $receiptValue.phase = "verified"
  $receiptValue.stoppedAt = ([datetime]$stoppedTask.stoppedAt).ToUniversalTime().ToString("o")
  $receiptValue.exitCode = 0
  Write-JsonFile -Path $receipt -Value $receiptValue -AllowReplace
  [pscustomobject]@{
    Outcome                   = "succeeded"
    ReceiptPath               = $receipt
    ReceiptSha256             = Get-FileSha256 -Path $receipt
    ExecutionPlanSha256       = $ReviewedExecutionPlanSha256
    ArtifactDigest            = $artifact.Digest
    ExecutedTaskCount         = 1
    ExitCode                  = 0
    AggregateSuccessLogCount  = 4
    ActiveMigrationTaskCount  = 0
    ContinuousEcsServiceCount = 0
  }
  exit 0
}

if ($Action -eq "Recover") {
  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) { throw "Recover requires the submitted execution receipt path." }
  $receipt = Resolve-OperatorPath -Candidate $ReceiptPath -MustExist -RequireOperatorRoot
  $receiptValue = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  Assert-ExecutionIdentity -Value $receiptValue -ExpectedKind "development-document-migration-receipt" `
    -ReleaseSourceSha $SourceSha -OperatorSourceSha $expectedExecutionOperatorSha
  Assert-DurableExecutionClaim -ClaimKey ([string]$receiptValue.executionClaimKey) `
    -ClaimVersion ([string]$receiptValue.executionClaimVersion) `
    -ExecutionPlanSha256 $ReviewedExecutionPlanSha256 `
    -ExpectedChecksum ([string]$receiptValue.executionClaimChecksumSHA256) `
    -ExpectedClaimOperatorSourceSha $expectedExecutionOperatorSha
  if ([string]$receiptValue.environment -cne "development" -or
      [string]$receiptValue.accountId -cne $ExpectedAccountId -or
      [string]$receiptValue.stateBucket -cne $StateBucket -or
      [string]$receiptValue.migrationImage -cne $MigrationImage -or
      [string]$receiptValue.taskPlanSha256 -cne $ReviewedTaskPlanSha256 -or
      [string]$receiptValue.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
      [string]$receiptValue.executionClaimKey -cne "operator-claims/development-document-migration/$ReviewedExecutionPlanSha256.json" -or
      [string]::IsNullOrWhiteSpace([string]$receiptValue.executionClaimVersion) -or
      [string]$receiptValue.executionClaimChecksumSHA256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or
      [string]$receiptValue.phase -cne "submitted" -or
      $null -ne (Get-OptionalProperty $receiptValue "exitCode") -or
      $null -ne (Get-OptionalProperty $receiptValue "stoppedAt") -or
      [string]$receiptValue.taskArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task/") {
    throw "The submitted migration receipt is incomplete or belongs to a different reviewed execution."
  }
  $stoppedTask = Assert-TaskResultAndLogs -ClusterArn $clusterArn `
    -TaskArn ([string]$receiptValue.taskArn) -TaskDefinitionArn $taskDefinitionArn
  Assert-ZeroMigrationCompute -ClusterArn $clusterArn
  $receiptValue = Set-RecoveredReceiptEvidence -Receipt $receiptValue `
    -StoppedAt ([datetime]$stoppedTask.stoppedAt) -RecoveryOperatorSourceSha $operatorSourceSha
  Write-JsonFile -Path $receipt -Value $receiptValue -AllowReplace
  [pscustomobject]@{
    Outcome                   = "recovered"
    ReceiptPath               = $receipt
    ReceiptSha256             = Get-FileSha256 -Path $receipt
    ExecutionPlanSha256       = $ReviewedExecutionPlanSha256
    ExecutedTaskCount         = 1
    ExitCode                  = 0
    AggregateSuccessLogCount  = 4
    ActiveMigrationTaskCount  = 0
    ContinuousEcsServiceCount = 0
  }
  exit 0
}

if ($Action -ne "Verify") { throw "Unsupported migration operator action." }
if ([string]::IsNullOrWhiteSpace($ReceiptPath)) { throw "Verify requires the execution receipt path." }
$receipt = Resolve-OperatorPath -Candidate $ReceiptPath -MustExist -RequireOperatorRoot
$receiptValue = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
Assert-ExecutionIdentity -Value $receiptValue -ExpectedKind "development-document-migration-receipt" `
  -ReleaseSourceSha $SourceSha -OperatorSourceSha $expectedExecutionOperatorSha
Assert-DurableExecutionClaim -ClaimKey ([string]$receiptValue.executionClaimKey) `
  -ClaimVersion ([string]$receiptValue.executionClaimVersion) `
  -ExecutionPlanSha256 $ReviewedExecutionPlanSha256 `
  -ExpectedChecksum ([string]$receiptValue.executionClaimChecksumSHA256) `
  -ExpectedClaimOperatorSourceSha $expectedExecutionOperatorSha
if ([string]$receiptValue.environment -cne "development" -or
    [string]$receiptValue.accountId -cne $ExpectedAccountId -or [string]$receiptValue.stateBucket -cne $StateBucket -or
    [string]$receiptValue.migrationImage -cne $MigrationImage -or
    [string]$receiptValue.taskPlanSha256 -cne $ReviewedTaskPlanSha256 -or
    [string]$receiptValue.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
    [string]$receiptValue.executionClaimKey -cne "operator-claims/development-document-migration/$ReviewedExecutionPlanSha256.json" -or
    [string]::IsNullOrWhiteSpace([string]$receiptValue.executionClaimVersion) -or
    [string]$receiptValue.executionClaimChecksumSHA256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or
    [string]$receiptValue.phase -cne "verified" -or [int]$receiptValue.exitCode -ne 0 -or
    [string]$receiptValue.taskArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task/") {
  throw "The migration execution receipt is incomplete or belongs to a different reviewed release."
}
$null = Assert-TaskResultAndLogs -ClusterArn $clusterArn -TaskArn ([string]$receiptValue.taskArn) -TaskDefinitionArn $taskDefinitionArn
Assert-ZeroMigrationCompute -ClusterArn $clusterArn

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($DriftPlanPath)) {
  $DriftPlanPath = Join-Path $operatorRoot "zero-drift-$($SourceSha.Substring(0, 12))-$timestamp.tfplan"
}
$driftPlan = Resolve-OperatorPath -Candidate $DriftPlanPath -RequireOperatorRoot
if (Test-Path -LiteralPath $driftPlan) { throw "Refusing to replace an existing drift plan." }
$driftLog = "$driftPlan.plan.log"
$savedTerraformVariables = Save-AndClearTerraformVariables
try {
  Set-VariablesFromPlan -Plan $taskPlanJson -NewMigrationImage $MigrationImage
  & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -refresh=true `
    -detailed-exitcode "-out=$driftPlan" *> $driftLog
  $driftExit = $LASTEXITCODE
} finally {
  Restore-TerraformVariables -Saved $savedTerraformVariables
}
if ($driftExit -ne 0) { throw "Post-migration Terraform verification did not return zero drift. Inspect the ignored local drift log." }
$driftJson = Get-PlanJson -Path $driftPlan
if (@(Get-MeaningfulChanges -Changes @($driftJson.resource_changes)).Count -ne 0 -or
    @(Get-UnacceptedVerificationDrift -Drift @($driftJson.resource_drift)).Count -ne 0) {
  throw "The saved post-migration plan contains a change or resource drift."
}
Assert-StateObjectEncryption
[pscustomobject]@{
  Outcome                    = "verified"
  Environment                = "development"
  SourceSha                  = $SourceSha
  OperatorSourceSha          = $operatorSourceSha
  TaskPlanSha256             = $ReviewedTaskPlanSha256
  ExecutionPlanSha256        = $ReviewedExecutionPlanSha256
  ReceiptSha256              = Get-FileSha256 -Path $receipt
  DriftPlanPath              = $driftPlan
  DriftPlanSha256            = Get-FileSha256 -Path $driftPlan
  ArtifactDigest             = $artifact.Digest
  ExecutedTaskCount          = 1
  ExitCode                   = 0
  AggregateSuccessLogCount   = 4
  ActiveMigrationTaskCount   = 0
  ContinuousEcsServiceCount  = 0
  StateCustomerKmsEncrypted  = $true
}
