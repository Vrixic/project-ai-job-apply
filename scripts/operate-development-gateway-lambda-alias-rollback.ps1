[CmdletBinding()]
param(
  [ValidateSet("Plan", "Execute", "Cleanup")]
  [string]$Action = "Plan",

  [ValidateRange(2, 2147483647)]
  [int]$RollbackVersion = 2,

  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "ai-job-apply-development-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$Execute,

  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
    -Action Plan -RollbackVersion 2

  .\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
    -Action Execute -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

  .\scripts\operate-development-gateway-lambda-alias-rollback.ps1 `
    -Action Cleanup -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Plan is read-only. It verifies the exact development caller, stable ECS public route, healthy dark
Lambda, immutable current and rollback versions, equivalent runtime/security configuration,
reserved concurrency 2, and an unweighted alias. Version 1 is structurally excluded because the
rollback target must be version 2 or newer. It writes one ignored, checksum-reviewed recovery
context and does not update the alias.

Execute requires the reviewed context checksum and -Execute. It uses the alias revision ID for an
optimistic-lock transition to the accepted rollback version, runs the guarded dark bridge smoke
test, and restores the original version in finally using the revision created by this drill. A
second smoke test and full preflight must pass after restoration. Public API traffic remains on
ECS throughout. Cleanup removes only this operator's exact ignored context and requires -Execute.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The development gateway rollback drill is restricted to us-east-2."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$contextDirectory = Join-Path $environmentDirectory ".terraform\dark-plans"
$contextPath = Join-Path $contextDirectory "gateway-alias-rollback-context.json"
$preflightScript = Join-Path $PSScriptRoot "start-deployed-web-conformance.ps1"
$functionName = "ai-job-apply-development-gateway"
$aliasName = "development"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $output = & aws @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  if (-not $output) {
    return $null
  }
  try {
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw $FailureMessage
  }
}

function Assert-TemporaryDevelopmentCaller {
  $identity = Invoke-AwsJson `
    -Arguments @("sts", "get-caller-identity", "--output", "json") `
    -FailureMessage "The development AWS session is unavailable. Refresh IAM Identity Center."
  if (
    [string]$identity.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$identity.Arn).Contains(":assumed-role/")
  ) {
    throw "Use the temporary IAM Identity Center session for the development account."
  }

  $function = Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-function-configuration",
      "--function-name", $functionName,
      "--output", "json"
    ) `
    -FailureMessage "The development gateway Lambda is unavailable."
  $functionAccount = ([string]$function.FunctionArn -split ":")[4]
  if ($functionAccount -ne [string]$identity.Account) {
    throw "The development caller and gateway Lambda are in different AWS accounts."
  }
}

function Invoke-DarkPreflight {
  param([switch]$SmokeTest)

  $parameters = @{ GatewayRuntime = "lambda-dark" }
  if ($SmokeTest) {
    $parameters["BridgeSmokeTest"] = $true
  } else {
    $parameters["ValidateOnly"] = $true
  }
  & $preflightScript @parameters
  if ($LASTEXITCODE -ne 0) {
    $kind = if ($SmokeTest) { "bridge smoke test" } else { "deployment preflight" }
    throw "The dark Lambda $kind failed."
  }
}

function Get-Alias {
  return Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-alias",
      "--function-name", $functionName,
      "--name", $aliasName,
      "--output", "json"
    ) `
    -FailureMessage "The development gateway alias is unavailable."
}

function Get-VersionConfiguration {
  param([Parameter(Mandatory = $true)][string]$Version)

  return Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-function-configuration",
      "--function-name", $functionName,
      "--qualifier", $Version,
      "--output", "json"
    ) `
    -FailureMessage "Gateway Lambda version $Version is unavailable."
}

function Get-AdditionalVersionWeightCount {
  param([Parameter(Mandatory = $true)][object]$Alias)

  $routingProperty = @($Alias.PSObject.Properties | Where-Object { $_.Name -eq "RoutingConfig" })
  if ($routingProperty.Count -ne 1 -or $null -eq $routingProperty[0].Value) {
    return 0
  }
  $weightProperty = @(
    $routingProperty[0].Value.PSObject.Properties |
      Where-Object { $_.Name -eq "AdditionalVersionWeights" }
  )
  if ($weightProperty.Count -eq 0 -or $null -eq $weightProperty[0].Value) {
    return 0
  }
  return @($weightProperty[0].Value.PSObject.Properties).Count
}

function Get-ComparableConfiguration {
  param([Parameter(Mandatory = $true)][object]$Configuration)

  $environment = [ordered]@{}
  foreach (
    $property in @($Configuration.Environment.Variables.PSObject.Properties) |
      Sort-Object Name
  ) {
    if ($property.Name -ne "RELEASE_SHA") {
      $environment[$property.Name] = [string]$property.Value
    }
  }
  return [ordered]@{
    Architectures = @($Configuration.Architectures)
    EphemeralStorage = [int]$Configuration.EphemeralStorage.Size
    Handler = [string]$Configuration.Handler
    KmsKeyArn = [string]$Configuration.KMSKeyArn
    Layers = @($Configuration.Layers | ForEach-Object { [string]$_.Arn })
    MemorySize = [int]$Configuration.MemorySize
    PackageType = [string]$Configuration.PackageType
    Role = [string]$Configuration.Role
    Runtime = [string]$Configuration.Runtime
    Timeout = [int]$Configuration.Timeout
    TracingMode = [string]$Configuration.TracingConfig.Mode
    SecurityGroupIds = @($Configuration.VpcConfig.SecurityGroupIds | Sort-Object)
    SubnetIds = @($Configuration.VpcConfig.SubnetIds | Sort-Object)
    VpcId = [string]$Configuration.VpcConfig.VpcId
    Environment = $environment
  }
}

function Assert-VersionBoundary {
  param(
    [Parameter(Mandatory = $true)][object]$Current,
    [Parameter(Mandatory = $true)][object]$Rollback
  )

  foreach ($configuration in @($Current, $Rollback)) {
    if (
      [string]$configuration.Version -notmatch "^[1-9][0-9]*$" -or
      [string]$configuration.CodeSha256 -notmatch "^[A-Za-z0-9+/]{43}=$" -or
      [string]$configuration.Environment.Variables.RELEASE_SHA -notmatch "^[a-f0-9]{64}$" -or
      [string]$configuration.State -ne "Active" -or
      [string]$configuration.LastUpdateStatus -ne "Successful" -or
      [string]$configuration.Runtime -ne "nodejs24.x" -or
      [string]$configuration.Handler -ne "index.handler" -or
      @($configuration.Architectures).Count -ne 1 -or
      [string]$configuration.Architectures[0] -ne "x86_64"
    ) {
      throw "A selected Lambda version is outside the accepted immutable runtime boundary."
    }
  }
  if (
    [string]$Current.Version -eq [string]$Rollback.Version -or
    [string]$Current.CodeSha256 -eq [string]$Rollback.CodeSha256 -or
    [string]$Current.Environment.Variables.RELEASE_SHA -eq
      [string]$Rollback.Environment.Variables.RELEASE_SHA
  ) {
    throw "Rollback requires two distinct immutable releases."
  }

  $currentComparable = Get-ComparableConfiguration -Configuration $Current
  $rollbackComparable = Get-ComparableConfiguration -Configuration $Rollback
  if (
    ($currentComparable | ConvertTo-Json -Depth 10 -Compress) -cne
    ($rollbackComparable | ConvertTo-Json -Depth 10 -Compress)
  ) {
    throw "The rollback version differs from the current version outside immutable code identity."
  }
}

function Get-LiveBoundary {
  param([Parameter(Mandatory = $true)][int]$ExpectedRollbackVersion)

  $alias = Get-Alias
  $currentVersion = [string]$alias.FunctionVersion
  if (
    [string]$alias.Name -ne $aliasName -or
    $currentVersion -notmatch "^[1-9][0-9]*$" -or
    [int]$currentVersion -le $ExpectedRollbackVersion -or
    [string]::IsNullOrWhiteSpace([string]$alias.RevisionId) -or
    (Get-AdditionalVersionWeightCount -Alias $alias) -ne 0
  ) {
    throw "The development alias is not at the reviewed unweighted current-version boundary."
  }

  $current = Get-VersionConfiguration -Version $currentVersion
  $rollback = Get-VersionConfiguration -Version ([string]$ExpectedRollbackVersion)
  Assert-VersionBoundary -Current $current -Rollback $rollback

  $latest = Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-function-configuration",
      "--function-name", $functionName,
      "--output", "json"
    ) `
    -FailureMessage "The tracked development gateway Lambda is unavailable."
  $concurrency = Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-function-concurrency",
      "--function-name", $functionName,
      "--output", "json"
    ) `
    -FailureMessage "The gateway Lambda concurrency boundary is unavailable."
  if (
    [string]$latest.CodeSha256 -ne [string]$current.CodeSha256 -or
    [int]$concurrency.ReservedConcurrentExecutions -ne 2
  ) {
    throw "The tracked Lambda artifact or reserved concurrency differs from the current alias."
  }

  return [ordered]@{
    AliasRevisionId = [string]$alias.RevisionId
    CurrentVersion = [string]$current.Version
    CurrentCodeSha256 = [string]$current.CodeSha256
    CurrentReleaseSha = [string]$current.Environment.Variables.RELEASE_SHA
    RollbackVersion = [string]$rollback.Version
    RollbackCodeSha256 = [string]$rollback.CodeSha256
    RollbackReleaseSha = [string]$rollback.Environment.Variables.RELEASE_SHA
  }
}

function Save-Context {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Context)

  $null = New-Item -ItemType Directory -Path $contextDirectory -Force
  [IO.File]::WriteAllText(
    $contextPath,
    ($Context | ConvertTo-Json -Depth 6),
    $utf8WithoutBom
  )
  return (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ReviewedContext {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw "The reviewed gateway alias rollback context is absent."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "The reviewed 64-character -ExpectedPlanSha256 is required."
  }
  $actualHash = (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedPlanSha256.ToLowerInvariant()) {
    throw "The gateway alias rollback context checksum does not match the reviewed plan."
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  if (
    [string]$context.Schema -ne "applydash.development.gateway-alias-rollback.v1" -or
    [string]$context.Environment -ne "development" -or
    [string]$context.Region -ne "us-east-2" -or
    [int]$context.RollbackVersion -lt 2
  ) {
    throw "The gateway alias rollback context has an unexpected schema or target."
  }
  return $context
}

function Assert-ContextMatchesLive {
  param(
    [Parameter(Mandatory = $true)][object]$Context,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Live
  )

  foreach ($property in @(
      "AliasRevisionId",
      "CurrentVersion",
      "CurrentCodeSha256",
      "CurrentReleaseSha",
      "RollbackVersion",
      "RollbackCodeSha256",
      "RollbackReleaseSha"
    )) {
    if ([string]$Context.$property -cne [string]$Live[$property]) {
      throw "The live alias or immutable release inventory changed after rollback-plan review."
    }
  }
}

function Update-AliasVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$RevisionId,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  return Invoke-AwsJson `
    -Arguments @(
      "lambda", "update-alias",
      "--function-name", $functionName,
      "--name", $aliasName,
      "--function-version", $Version,
      "--revision-id", $RevisionId,
      "--output", "json"
    ) `
    -FailureMessage $FailureMessage
}

function Assert-AliasVersion {
  param([Parameter(Mandatory = $true)][string]$ExpectedVersion)

  $alias = Get-Alias
  if (
    [string]$alias.FunctionVersion -ne $ExpectedVersion -or
    [string]::IsNullOrWhiteSpace([string]$alias.RevisionId) -or
    (Get-AdditionalVersionWeightCount -Alias $alias) -ne 0
  ) {
    throw "The development alias did not reach the exact expected immutable version."
  }
  return $alias
}

try {
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required."
  }
  Assert-TemporaryDevelopmentCaller

  switch ($Action) {
    "Plan" {
      if ($Execute) {
        throw "Plan is read-only and does not accept -Execute."
      }
      if (Test-Path -LiteralPath $contextPath) {
        throw "A gateway alias rollback context already exists. Execute or clean it before replanning."
      }
      Invoke-DarkPreflight
      $live = Get-LiveBoundary -ExpectedRollbackVersion $RollbackVersion
      $context = [ordered]@{
        Schema = "applydash.development.gateway-alias-rollback.v1"
        Environment = "development"
        Region = $Region
        CreatedAt = [DateTime]::UtcNow.ToString("o")
        AliasRevisionId = $live.AliasRevisionId
        CurrentVersion = $live.CurrentVersion
        CurrentCodeSha256 = $live.CurrentCodeSha256
        CurrentReleaseSha = $live.CurrentReleaseSha
        RollbackVersion = $live.RollbackVersion
        RollbackCodeSha256 = $live.RollbackCodeSha256
        RollbackReleaseSha = $live.RollbackReleaseSha
        PublicTrafficChange = $false
      }
      $hash = Save-Context -Context $context
      [ordered]@{
        Environment = "development"
        Action = "review"
        CurrentVersion = $context.CurrentVersion
        RollbackVersion = $context.RollbackVersion
        PlanSha256 = $hash
        AliasUpdatesOnExecute = 2
        PublicTrafficChange = $false
        ContextPath = $contextPath
      } | ConvertTo-Json -Depth 4
    }
    "Execute" {
      if (-not $Execute) {
        throw "Rollback execution requires -Execute."
      }
      $context = Get-ReviewedContext
      Invoke-DarkPreflight
      $live = Get-LiveBoundary -ExpectedRollbackVersion ([int]$context.RollbackVersion)
      Assert-ContextMatchesLive -Context $context -Live $live

      $rollbackApplied = $false
      $restored = $false
      try {
        $rollbackAlias = Update-AliasVersion `
          -Version ([string]$context.RollbackVersion) `
          -RevisionId ([string]$context.AliasRevisionId) `
          -FailureMessage "The optimistic-lock alias rollback failed."
        $rollbackApplied = $true
        $null = Assert-AliasVersion -ExpectedVersion ([string]$context.RollbackVersion)
        Invoke-DarkPreflight -SmokeTest
      }
      finally {
        if ($rollbackApplied) {
          $liveRollbackAlias = Assert-AliasVersion `
            -ExpectedVersion ([string]$context.RollbackVersion)
          $null = Update-AliasVersion `
            -Version ([string]$context.CurrentVersion) `
            -RevisionId ([string]$liveRollbackAlias.RevisionId) `
            -FailureMessage "The guarded alias restoration failed; public traffic remains on ECS."
          $null = Assert-AliasVersion -ExpectedVersion ([string]$context.CurrentVersion)
          $restored = $true
        }
      }

      if (-not $restored) {
        throw "The rollback drill did not restore the reviewed current alias version."
      }
      Invoke-DarkPreflight -SmokeTest
      Invoke-DarkPreflight
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = "development"
        Result = "passed"
        RolledBackToVersion = [string]$context.RollbackVersion
        RestoredToVersion = [string]$context.CurrentVersion
        RollbackSmoke = "200/200/401"
        RestoreSmoke = "200/200/401"
        AliasUpdates = 2
        PublicTrafficChange = $false
        ContextRemoved = (-not (Test-Path -LiteralPath $contextPath))
      } | ConvertTo-Json -Depth 4
    }
    "Cleanup" {
      if (-not $Execute) {
        throw "Cleanup requires -Execute."
      }
      $context = Get-ReviewedContext
      $alias = Get-Alias
      if ([string]$alias.FunctionVersion -ne [string]$context.CurrentVersion) {
        throw "Cleanup is blocked until the alias is restored to the reviewed current version."
      }
      Invoke-DarkPreflight
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = "development"
        Action = "cleanup"
        CurrentVersion = [string]$context.CurrentVersion
        ContextRemoved = (-not (Test-Path -LiteralPath $contextPath))
        PublicTrafficChange = $false
      } | ConvertTo-Json -Depth 4
    }
  }
}
finally {
  if ($null -eq $previousProfile) {
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
  } else {
    $env:AWS_PROFILE = $previousProfile
  }
  if ($null -eq $previousRegion) {
    Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_REGION = $previousRegion
  }
  if ($null -eq $previousDefaultRegion) {
    Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_DEFAULT_REGION = $previousDefaultRegion
  }
}
