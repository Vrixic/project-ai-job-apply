[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",

  [ValidateSet("Status", "PlanRollback", "ApplyRollback", "PlanRestore", "ApplyRestore", "Cleanup")]
  [string]$Action = "Status",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [string]$StateBucket = "",

  [string]$CurrentReleasePlanPath = "",

  [string]$RollbackReleasePlanPath = "",

  [ValidatePattern("^[a-fA-F0-9]{64}$")]
  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$ConfirmRollbackConformance,

  [switch]$ConfirmRestoreConformance,

  [switch]$Execute,

  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-serverless-workflow-release-rollback.ps1 `
    -Environment staging `
    -Action PlanRollback `
    -ExpectedAccountId ACCOUNT_ID `
    -StateBucket STATE_BUCKET `
    -CurrentReleasePlanPath .terraform/workflow-dark-plans/CURRENT.tfplan `
    -RollbackReleasePlanPath .terraform/workflow-dark-plans/ROLLBACK.tfplan

  .\scripts\operate-serverless-workflow-release-rollback.ps1 `
    -Environment staging `
    -Action ApplyRollback -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

  .\scripts\operate-serverless-workflow-release-rollback.ps1 `
    -Environment staging `
    -Action PlanRestore -ConfirmRollbackConformance

  .\scripts\operate-serverless-workflow-release-rollback.ps1 `
    -Environment staging `
    -Action ApplyRestore -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

  .\scripts\operate-serverless-workflow-release-rollback.ps1 `
    -Environment staging `
    -Action Cleanup -ConfirmRestoreConformance -Execute

PlanRollback reconstructs two accepted immutable workflow artifact sets from retained reviewed
Terraform plans. It invokes the existing strict release planner to create one ignored reverse plan
and records a local recovery context. ApplyRollback requires the exact reviewed plan SHA-256,
proves the current release is zero drift, applies only the saved plan, and proves the rollback
release is zero drift. Run the existing dark-conformance drill against that release before using
PlanRestore.

PlanRestore requires explicit confirmation that rollback conformance passed and creates a separate
checksum-reviewed forward plan. ApplyRestore repeats the zero-drift and exact-plan gates and proves
the original release is restored. Cleanup requires confirmation that restored-release conformance
passed. Every replacement trigger remains disabled, gateway dispatch remains Temporal, and ECS
remains retained idle throughout.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The $Environment workflow rollback drill is restricted to us-east-2."
}
if (-not $AwsProfile) { $AwsProfile = "ai-job-apply-$Environment-admin" }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $environmentDirectory ".terraform"))
$terraformDataDirectory = Join-Path $terraformRoot "dark-plan-data"
$artifactDirectory = Join-Path $terraformRoot "workflow-release-rollback"
$contextPath = Join-Path $artifactDirectory "context.json"
$currentReleaseSnapshotPath = Join-Path $artifactDirectory "current-release-source.tfplan"
$rollbackReleaseSnapshotPath = Join-Path $artifactDirectory "rollback-release-source.tfplan"
$rollbackPlanPath = Join-Path $artifactDirectory "rollback.tfplan"
$restorePlanPath = Join-Path $artifactDirectory "restore.tfplan"
$cleanupPaths = @(
  $currentReleaseSnapshotPath,
  $rollbackReleaseSnapshotPath,
  $rollbackPlanPath,
  $restorePlanPath,
  $contextPath
)
$plannerPath = Join-Path $PSScriptRoot "plan-serverless-workflow-dark.ps1"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

function Assert-Tools {
  foreach ($command in @("aws", "git", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }
  if ((& terraform version -json | ConvertFrom-Json).terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
}

function Assert-ExactMain {
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
  if ($branch -ne "main" -or $head -ne $upstream -or $dirty.Count -ne 0) {
    throw "Use an exact clean upstream-matched main checkout for the workflow rollback drill."
  }
  return $head
}

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $output = & aws @Arguments --profile $AwsProfile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) {
    throw $FailureMessage
  }
  try {
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw $FailureMessage
  }
}

function Assert-Caller {
  param([Parameter(Mandatory = $true)][string]$AccountId)
  $identity = Invoke-AwsJson `
    -Arguments @("sts", "get-caller-identity", "--output", "json") `
    -FailureMessage "The $Environment AWS session is unavailable. Refresh IAM Identity Center."
  if (
    [string]$identity.Account -ne $AccountId -or
    -not ([string]$identity.Arn).Contains(":assumed-role/")
  ) {
    throw "Use the temporary IAM Identity Center session for the exact $Environment account."
  }
}

function Resolve-RetainedPlanPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Both retained release-plan paths are required for PlanRollback."
  }
  $candidate = if ([IO.Path]::IsPathRooted($Path)) {
    [IO.Path]::GetFullPath($Path)
  } else {
    [IO.Path]::GetFullPath((Join-Path $environmentDirectory $Path))
  }
  $prefix = $terraformRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (
    -not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $candidate -PathType Leaf)
  ) {
    throw "A retained release plan must be an existing file below the $Environment .terraform directory."
  }
  return $candidate
}

function Copy-RetainedPlanSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )
  $sourceSha256 = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
  $snapshotSha256 = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($snapshotSha256 -ne $sourceSha256) {
    throw "A retained release-plan snapshot did not match its source."
  }
  return $DestinationPath
}

function Get-PlanJson {
  param([Parameter(Mandatory = $true)][string]$Path)
  $previousDataDirectory = $env:TF_DATA_DIR
  try {
    $env:TF_DATA_DIR = $terraformDataDirectory
    $raw = & terraform "-chdir=$environmentDirectory" show -json $Path 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
      throw "A retained release plan could not be inspected with the pinned provider set."
    }
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  }
  finally {
    if ($null -eq $previousDataDirectory) {
      Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue
    } else {
      $env:TF_DATA_DIR = $previousDataDirectory
    }
  }
}

function Get-ConstantExpression {
  param(
    [Parameter(Mandatory = $true)][object]$Plan,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $expressions = $Plan.configuration.root_module.module_calls.platform.expressions
  $property = @($expressions.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if (
    $property.Count -eq 1 -and
    $property[0].Value.PSObject.Properties.Name -contains "constant_value"
  ) {
    return $property[0].Value.constant_value
  }
  $variable = @($Plan.variables.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if (
    $property.Count -ne 1 -or
    @($property[0].Value.references).Count -ne 1 -or
    [string]$property[0].Value.references[0] -ne "var.$Name" -or
    $variable.Count -ne 1 -or
    $variable[0].Value.PSObject.Properties.Name -notcontains "value"
  ) {
    throw "The retained plan does not contain exact platform input '$Name'."
  }
  return $variable[0].Value.value
}

function Get-ReleaseInputs {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $names = @(
    "gateway_lambda_artifact_s3_key",
    "gateway_lambda_artifact_s3_object_version",
    "gateway_lambda_artifact_sha256",
    "gateway_lambda_artifact_base64sha256",
    "gateway_lambda_extension_layer_arn",
    "workflow_ingress_artifact_s3_key",
    "workflow_ingress_artifact_s3_object_version",
    "workflow_ingress_artifact_sha256",
    "workflow_ingress_artifact_base64sha256",
    "profile_readiness_durable_artifact_s3_key",
    "profile_readiness_durable_artifact_s3_object_version",
    "profile_readiness_durable_artifact_sha256",
    "profile_readiness_durable_artifact_base64sha256",
    "profile_readiness_activity_artifact_s3_key",
    "profile_readiness_activity_artifact_s3_object_version",
    "profile_readiness_activity_artifact_sha256",
    "profile_readiness_activity_artifact_base64sha256",
    "profile_readiness_lambda_extension_layer_arn"
  )
  $values = [ordered]@{}
  foreach ($name in $names) {
    $values[$name] = [string](Get-ConstantExpression -Plan $Plan -Name $name)
  }
  $workflowKey = [string]$values.workflow_ingress_artifact_s3_key
  if ($workflowKey -notmatch '^lambda/workflows/([a-f0-9]{40})/[a-f0-9]{64}/workflow-ingress-lambda[.]zip$') {
    throw "A retained plan has an invalid workflow artifact key."
  }
  $values["workflow_artifact_source_sha"] = $Matches[1]
  return $values
}

function Assert-ReleaseIdentity {
  param(
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Current,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Rollback
  )
  if (
    [string]$Current.workflow_artifact_source_sha -eq
      [string]$Rollback.workflow_artifact_source_sha
  ) {
    throw "Rollback requires two distinct accepted workflow releases."
  }
  foreach ($name in @(
      "gateway_lambda_artifact_s3_key",
      "gateway_lambda_artifact_s3_object_version",
      "gateway_lambda_artifact_sha256",
      "gateway_lambda_artifact_base64sha256",
      "gateway_lambda_extension_layer_arn",
      "profile_readiness_lambda_extension_layer_arn"
    )) {
    if ([string]$Current[$name] -cne [string]$Rollback[$name]) {
      throw "The retained release plans differ outside the accepted workflow artifact set."
    }
  }
}

function Invoke-ReleasePlanner {
  param(
    [Parameter(Mandatory = $true)][object]$Context,
    [Parameter(Mandatory = $true)][object]$Release,
    [ValidateSet("Release", "Verify")][string]$Mode
  )
  $arguments = @{
    Environment = $Environment
    ExpectedAccountId = [string]$Context.ExpectedAccountId
    StateBucket = [string]$Context.StateBucket
    GatewayArtifactS3Key = [string]$Release.gateway_lambda_artifact_s3_key
    GatewayArtifactS3ObjectVersion = [string]$Release.gateway_lambda_artifact_s3_object_version
    GatewayArtifactSourceSha = (
      [regex]::Match([string]$Release.gateway_lambda_artifact_s3_key, 'lambda/gateway/([a-f0-9]{40})/')
    ).Groups[1].Value
    GatewayArtifactSha256 = [string]$Release.gateway_lambda_artifact_sha256
    GatewayArtifactBase64Sha256 = [string]$Release.gateway_lambda_artifact_base64sha256
    WorkflowArtifactSourceSha = [string]$Release.workflow_artifact_source_sha
    WorkflowIngressArtifactS3Key = [string]$Release.workflow_ingress_artifact_s3_key
    WorkflowIngressArtifactS3ObjectVersion = [string]$Release.workflow_ingress_artifact_s3_object_version
    WorkflowIngressArtifactSha256 = [string]$Release.workflow_ingress_artifact_sha256
    WorkflowIngressArtifactBase64Sha256 = [string]$Release.workflow_ingress_artifact_base64sha256
    DurableArtifactS3Key = [string]$Release.profile_readiness_durable_artifact_s3_key
    DurableArtifactS3ObjectVersion = [string]$Release.profile_readiness_durable_artifact_s3_object_version
    DurableArtifactSha256 = [string]$Release.profile_readiness_durable_artifact_sha256
    DurableArtifactBase64Sha256 = [string]$Release.profile_readiness_durable_artifact_base64sha256
    ActivityArtifactS3Key = [string]$Release.profile_readiness_activity_artifact_s3_key
    ActivityArtifactS3ObjectVersion = [string]$Release.profile_readiness_activity_artifact_s3_object_version
    ActivityArtifactSha256 = [string]$Release.profile_readiness_activity_artifact_sha256
    ActivityArtifactBase64Sha256 = [string]$Release.profile_readiness_activity_artifact_base64sha256
    PinnedExtensionLayerArn = [string]$Release.profile_readiness_lambda_extension_layer_arn
    AwsProfile = $AwsProfile
    Region = $Region
  }
  if ($Mode -eq "Release") {
    $arguments["AllowArtifactReleaseUpdate"] = $true
  } else {
    $arguments["VerifyCompletedDarkDeployment"] = $true
  }
  $raw = & $plannerPath @arguments
  if ($LASTEXITCODE -ne 0 -or -not $raw) {
    throw "The strict workflow release planner rejected the requested $Mode boundary."
  }
  return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
}

function Save-Context {
  param([Parameter(Mandatory = $true)][object]$Context)
  $null = New-Item -ItemType Directory -Path $artifactDirectory -Force
  [IO.File]::WriteAllText($contextPath, ($Context | ConvertTo-Json -Depth 12), $utf8WithoutBom)
}

function Get-Context {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw "The ignored workflow release rollback context is absent."
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  if (
    [string]$context.Schema -ne "applydash.$Environment.workflow-release-rollback.v1" -or
    [string]$context.Environment -ne $Environment -or
    [string]$context.Region -ne "us-east-2" -or
    [string]$context.ExpectedAccountId -notmatch "^[0-9]{12}$"
  ) {
    throw "The ignored workflow release rollback context is invalid."
  }
  return $context
}

function Assert-ContextSource {
  param([Parameter(Mandatory = $true)][object]$Context)
  $commit = Assert-ExactMain
  if ([string]$Context.SourceCommit -ne $commit) {
    throw "The reviewed rollback context was not created from the current exact main commit."
  }
  Assert-Caller -AccountId ([string]$Context.ExpectedAccountId)
  foreach ($property in @("CurrentReleasePlanPath", "RollbackReleasePlanPath")) {
    $path = [string]$Context.$property
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "A retained release-plan source is no longer present."
    }
    $expectedProperty = "${property}Sha256"
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne [string]$Context.$expectedProperty) {
      throw "A retained release-plan source changed after review."
    }
  }
}

function Assert-ExpectedPlan {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$RecordedSha256
  )
  if (-not $Execute) {
    throw "Applying a workflow release plan requires -Execute."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "The reviewed 64-character -ExpectedPlanSha256 is required."
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "The reviewed saved Terraform plan is absent."
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    $actual -ne $ExpectedPlanSha256.ToLowerInvariant() -or
    $actual -ne $RecordedSha256
  ) {
    throw "The saved Terraform plan does not match the reviewed checksum and context."
  }
}

function Invoke-SavedPlan {
  param([Parameter(Mandatory = $true)][string]$Path)
  $previous = [ordered]@{
    TF_DATA_DIR = $env:TF_DATA_DIR
    AWS_ACCESS_KEY_ID = $env:AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = $env:AWS_SECRET_ACCESS_KEY
    AWS_SESSION_TOKEN = $env:AWS_SESSION_TOKEN
    AWS_REGION = $env:AWS_REGION
    AWS_DEFAULT_REGION = $env:AWS_DEFAULT_REGION
  }
  try {
    $credentials = & aws configure export-credentials --profile $AwsProfile --format process 2>$null |
      ConvertFrom-Json
    if (-not $credentials.SessionToken) {
      throw "Short-lived $Environment credentials could not be exported."
    }
    $env:TF_DATA_DIR = $terraformDataDirectory
    $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
    $env:AWS_REGION = $Region
    $env:AWS_DEFAULT_REGION = $Region
    & terraform "-chdir=$environmentDirectory" apply -input=false $Path
    if ($LASTEXITCODE -ne 0) {
      throw "The exact saved workflow release plan did not apply successfully."
    }
  }
  finally {
    foreach ($name in $previous.Keys) {
      if ($null -eq $previous[$name]) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
      } else {
        Set-Item "Env:$name" $previous[$name]
      }
    }
  }
}

Assert-Tools

switch ($Action) {
  "Status" {
    [ordered]@{
      Environment = $Environment
      ContextPresent = Test-Path -LiteralPath $contextPath
      RollbackPlanPresent = Test-Path -LiteralPath $rollbackPlanPath
      RestorePlanPresent = Test-Path -LiteralPath $restorePlanPath
      AwsMutation = $false
    } | ConvertTo-Json
  }
  "PlanRollback" {
    if ($Execute) { throw "PlanRollback is read-only and does not accept -Execute." }
    if (
      $ExpectedAccountId -notmatch "^[0-9]{12}$" -or
      [string]::IsNullOrWhiteSpace($StateBucket)
    ) {
      throw "PlanRollback requires the exact $Environment account ID and state bucket."
    }
    if (Test-Path -LiteralPath $contextPath) {
      throw "A workflow release rollback context already exists."
    }
    $sourceCommit = Assert-ExactMain
    Assert-Caller -AccountId $ExpectedAccountId
    $currentSourcePath = Resolve-RetainedPlanPath -Path $CurrentReleasePlanPath
    $rollbackSourcePath = Resolve-RetainedPlanPath -Path $RollbackReleasePlanPath
    $null = New-Item -ItemType Directory -Path $artifactDirectory -Force
    $currentPath = Copy-RetainedPlanSnapshot `
      -SourcePath $currentSourcePath -DestinationPath $currentReleaseSnapshotPath
    $rollbackPath = Copy-RetainedPlanSnapshot `
      -SourcePath $rollbackSourcePath -DestinationPath $rollbackReleaseSnapshotPath
    $current = Get-ReleaseInputs -Plan (Get-PlanJson -Path $currentPath)
    $rollback = Get-ReleaseInputs -Plan (Get-PlanJson -Path $rollbackPath)
    Assert-ReleaseIdentity -Current $current -Rollback $rollback
    $context = [ordered]@{
      Schema = "applydash.$Environment.workflow-release-rollback.v1"
      Environment = $Environment
      Region = $Region
      SourceCommit = $sourceCommit
      ExpectedAccountId = $ExpectedAccountId
      StateBucket = $StateBucket
      CurrentReleasePlanPath = $currentPath
      CurrentReleasePlanPathSha256 = (Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash.ToLowerInvariant()
      RollbackReleasePlanPath = $rollbackPath
      RollbackReleasePlanPathSha256 = (Get-FileHash -LiteralPath $rollbackPath -Algorithm SHA256).Hash.ToLowerInvariant()
      CurrentRelease = $current
      RollbackRelease = $rollback
      RollbackPlanPath = ""
      RollbackPlanSha256 = ""
      RestorePlanPath = ""
      RestorePlanSha256 = ""
      State = "planning_rollback"
      PublicTrafficChange = $false
      TriggerChange = $false
      EcsCapacityChange = $false
    }
    $summary = Invoke-ReleasePlanner -Context $context -Release $rollback -Mode Release
    Copy-Item -LiteralPath ([string]$summary.SensitivePlanPath) -Destination $rollbackPlanPath -Force
    $context.RollbackPlanPath = $rollbackPlanPath
    $context.RollbackPlanSha256 = (Get-FileHash -LiteralPath $rollbackPlanPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $context.State = "rollback_planned"
    Save-Context -Context $context
    [ordered]@{
      Environment = $Environment
      Action = "rollback_review"
      CurrentReleaseSource = [string]$current.workflow_artifact_source_sha
      RollbackReleaseSource = [string]$rollback.workflow_artifact_source_sha
      Creates = [int]$summary.Creates
      Updates = [int]$summary.Updates
      Deletes = [int]$summary.Deletes
      Replacements = [int]$summary.Replacements
      PlanSha256 = [string]$context.RollbackPlanSha256
      TriggersEnabled = [bool]$summary.TriggersEnabled
      EcsRuntimeIdle = [bool]$summary.EcsRuntimeIdle
      ApiTrafficChange = [bool]$summary.ApiTrafficChange
      AwsMutation = $false
    } | ConvertTo-Json
  }
  "ApplyRollback" {
    $context = Get-Context
    Assert-ContextSource -Context $context
    if ([string]$context.State -ne "rollback_planned") {
      throw "ApplyRollback requires a freshly reviewed rollback plan."
    }
    Assert-ExpectedPlan -Path ([string]$context.RollbackPlanPath) `
      -RecordedSha256 ([string]$context.RollbackPlanSha256)
    $preflight = Invoke-ReleasePlanner -Context $context -Release $context.CurrentRelease -Mode Verify
    if (-not [bool]$preflight.NoDrift) { throw "The current release is not zero drift." }
    Invoke-SavedPlan -Path ([string]$context.RollbackPlanPath)
    $verification = Invoke-ReleasePlanner -Context $context -Release $context.RollbackRelease -Mode Verify
    if (-not [bool]$verification.NoDrift) { throw "The rollback release is not zero drift." }
    $context.State = "rollback_applied_verified"
    Save-Context -Context $context
    [ordered]@{
      Environment = $Environment
      Result = "rollback_applied_verified"
      ReleaseSource = [string]$context.RollbackRelease.workflow_artifact_source_sha
      NoDrift = $true
      TriggersEnabled = [bool]$verification.TriggersEnabled
      EcsRuntimeIdle = [bool]$verification.EcsRuntimeIdle
      Next = "Run and accept the checksum-reviewed dark-conformance drill before PlanRestore."
    } | ConvertTo-Json
  }
  "PlanRestore" {
    if ($Execute) { throw "PlanRestore is read-only and does not accept -Execute." }
    if (-not $ConfirmRollbackConformance) {
      throw "PlanRestore requires -ConfirmRollbackConformance after the rollback release passes its drill."
    }
    $context = Get-Context
    Assert-ContextSource -Context $context
    if ([string]$context.State -ne "rollback_applied_verified") {
      throw "PlanRestore requires the verified rollback release posture."
    }
    $preflight = Invoke-ReleasePlanner -Context $context -Release $context.RollbackRelease -Mode Verify
    if (-not [bool]$preflight.NoDrift) { throw "The rollback release is not zero drift." }
    $summary = Invoke-ReleasePlanner -Context $context -Release $context.CurrentRelease -Mode Release
    Copy-Item -LiteralPath ([string]$summary.SensitivePlanPath) -Destination $restorePlanPath -Force
    $context.RestorePlanPath = $restorePlanPath
    $context.RestorePlanSha256 = (Get-FileHash -LiteralPath $restorePlanPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $context.State = "restore_planned"
    Save-Context -Context $context
    [ordered]@{
      Environment = $Environment
      Action = "restore_review"
      RestoreReleaseSource = [string]$context.CurrentRelease.workflow_artifact_source_sha
      Creates = [int]$summary.Creates
      Updates = [int]$summary.Updates
      Deletes = [int]$summary.Deletes
      Replacements = [int]$summary.Replacements
      PlanSha256 = [string]$context.RestorePlanSha256
      TriggersEnabled = [bool]$summary.TriggersEnabled
      EcsRuntimeIdle = [bool]$summary.EcsRuntimeIdle
      ApiTrafficChange = [bool]$summary.ApiTrafficChange
      AwsMutation = $false
    } | ConvertTo-Json
  }
  "ApplyRestore" {
    $context = Get-Context
    Assert-ContextSource -Context $context
    if ([string]$context.State -ne "restore_planned") {
      throw "ApplyRestore requires a freshly reviewed restoration plan."
    }
    Assert-ExpectedPlan -Path ([string]$context.RestorePlanPath) `
      -RecordedSha256 ([string]$context.RestorePlanSha256)
    $preflight = Invoke-ReleasePlanner -Context $context -Release $context.RollbackRelease -Mode Verify
    if (-not [bool]$preflight.NoDrift) { throw "The rollback release is not zero drift." }
    Invoke-SavedPlan -Path ([string]$context.RestorePlanPath)
    $verification = Invoke-ReleasePlanner -Context $context -Release $context.CurrentRelease -Mode Verify
    if (-not [bool]$verification.NoDrift) { throw "The restored release is not zero drift." }
    $context.State = "restore_applied_verified"
    Save-Context -Context $context
    [ordered]@{
      Environment = $Environment
      Result = "restore_applied_verified"
      ReleaseSource = [string]$context.CurrentRelease.workflow_artifact_source_sha
      NoDrift = $true
      TriggersEnabled = [bool]$verification.TriggersEnabled
      EcsRuntimeIdle = [bool]$verification.EcsRuntimeIdle
      Next = "Run and accept the checksum-reviewed restored-release conformance drill before Cleanup."
    } | ConvertTo-Json
  }
  "Cleanup" {
    if (-not $Execute -or -not $ConfirmRestoreConformance) {
      throw "Cleanup requires -ConfirmRestoreConformance and -Execute."
    }
    $context = Get-Context
    Assert-ContextSource -Context $context
    if ([string]$context.State -ne "restore_applied_verified") {
      throw "Cleanup is blocked until the original release is restored and verified."
    }
    $verification = Invoke-ReleasePlanner -Context $context -Release $context.CurrentRelease -Mode Verify
    if (-not [bool]$verification.NoDrift) { throw "Cleanup is blocked because restoration is not zero drift." }
    foreach ($path in $cleanupPaths) {
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
      }
    }
    [ordered]@{
      Environment = $Environment
      Result = "cleanup_complete"
      RestoredReleaseSource = [string]$context.CurrentRelease.workflow_artifact_source_sha
      NoDrift = $true
      ContextRemoved = -not (Test-Path -LiteralPath $contextPath)
      AwsMutation = $false
    } | ConvertTo-Json
  }
}
