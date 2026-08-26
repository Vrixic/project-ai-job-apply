[CmdletBinding()]
param(
  [ValidateSet("Validate", "Plan", "Execute", "Verify")]
  [string]$Action = "Validate",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",
  [string]$RepresentativeConfigPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedConfigSha256 = "",
  [ValidatePattern("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
  [string]$RunId = "",
  [ValidateRange(1, 2147483647)]
  [int]$ExpectedDurableVersion = 0,
  [ValidateRange(1, 2147483647)]
  [int]$ExpectedActivityVersion = 0,
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ExpectedDurableArtifactSha256 = "",
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")]
  [string]$ExpectedDurableCodeSha256 = "",
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ExpectedActivityArtifactSha256 = "",
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")]
  [string]$ExpectedActivityCodeSha256 = "",
  [string]$ExecutionPlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedExecutionPlanSha256 = "",
  [string]$ReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedReceiptSha256 = "",
  [ValidateRange(30, 1800)]
  [int]$MaximumPollSeconds = 300,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Validate `
    -SourceSha RELEASE_SHA -RunId UUID_V4 -RepresentativeConfigPath CONFIG `
    -ReviewedConfigSha256 CONFIG_SHA256

  .\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT -StateBucket BUCKET -SourceSha RELEASE_SHA -RunId UUID_V4 `
    -RepresentativeConfigPath CONFIG -ReviewedConfigSha256 CONFIG_SHA256 `
    -ExpectedDurableVersion VERSION -ExpectedActivityVersion VERSION `
    -ExpectedDurableArtifactSha256 SHA256 -ExpectedDurableCodeSha256 BASE64_SHA256 `
    -ExpectedActivityArtifactSha256 SHA256 -ExpectedActivityCodeSha256 BASE64_SHA256

  Execute adds -ExecutionPlanPath PATH -ReviewedExecutionPlanSha256 SHA256.
  Verify adds -ReceiptPath PATH -ReviewedReceiptSha256 SHA256 and never starts an execution.

Validate is offline. Plan is read-only and creates one checksum-reviewable descriptor in the
ignored development .terraform directory. Execute invokes only the exact numeric ingestion durable
version with the fixed generated-synthetic payload and one UUID-derived durable execution name.
Verify may resume polling the execution recorded in a receipt but cannot invoke Lambda. No action
accepts a provider, source, payload, function name, queue, log query, or evidence destination from
the caller.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development"))
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformDataRoot "development-d1-provider-failure-acceptance"
$representativeRoot = Join-Path $terraformDataRoot "d1-representative-acceptance"
$runbookPath = "infrastructure/runbooks/observability/development-d1-provider-failure-acceptance.md"
$stateKey = "platform.tfstate"
$fixtureKind = "d1-generated-synthetic-provider-failure-v1"
$fixtureSourceId = "synthetic-d1-provider-fault-v1"
$fixtureAdapterVersion = "synthetic-d1-provider-fault-v1"
$durableFunctionName = "ai-job-apply-development-ingestion-durable"
$activityFunctionName = "ai-job-apply-development-ingestion-activity"
$scheduleRuleName = "ai-job-apply-development-ingestion-schedule"
$terminalRuleName = "ai-job-apply-development-ingestion-terminal"
$dispatchQueueName = "ai-job-apply-development-ingestion-dispatch"
$deadLetterQueueName = "ai-job-apply-development-ingestion-dead-letter"
$ecsClusterName = "ai-job-apply-development"
$applicationLogGroup = "/ai-job-apply/development/application"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$allowedVerifierDelta = @(
  "scripts/operate-development-d1-provider-failure-acceptance.ps1",
  "scripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1",
  $runbookPath
)

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
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
  $actual = if ($Value -is [System.Collections.IDictionary]) {
    @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  } else { @($Value.PSObject.Properties.Name | Sort-Object) }
  $orderedExpected = @($Expected | Sort-Object)
  if (($actual -join "`n") -cne ($orderedExpected -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
  return $true
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function ConvertFrom-BoundedJsonString {
  param(
    [Parameter(Mandatory)][string]$Json,
    [Parameter(Mandatory)][string]$Description,
    [ValidateRange(1, 65536)][int]$MaximumBytes = 65536
  )
  if ([string]::IsNullOrWhiteSpace($Json) -or $Json[0] -eq [char]0xfeff) {
    throw "$Description is empty or BOM-prefixed."
  }
  $encoder = New-Object Text.UTF8Encoding($false, $true)
  try { $bytes = $encoder.GetBytes($Json) }
  catch { throw "$Description is not strict UTF-8." }
  if ($bytes.Length -gt $MaximumBytes) { throw "$Description exceeds its private data bound." }
  return ConvertFrom-OperatorJson $json $Description
}

function Test-CanonicalTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string]) { return $false }
  $parsed = [DateTimeOffset]::MinValue
  return [DateTimeOffset]::TryParseExact(
    [string]$Value, "o", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed
  ) -and $parsed.Offset -eq [TimeSpan]::Zero -and [string]$Value -ceq $parsed.ToString("o")
}

function Resolve-PathBelowRoot {
  param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][string]$AllowedRoot, [switch]$MustExist)
  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) {
    [IO.Path]::GetFullPath($Candidate)
  } else {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Candidate))
  }
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The evidence path must stay below its exact ignored directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The required evidence file does not exist."
  }
  return $resolved
}

function Write-JsonFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value, [switch]$AllowReplace)
  if (-not $AllowReplace -and (Test-Path -LiteralPath $Path)) { throw "Refusing to replace existing acceptance evidence." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 30), $utf8WithoutBom)
    if (-not $AllowReplace -and (Test-Path -LiteralPath $Path)) { throw "Refusing to replace existing acceptance evidence." }
    Move-Item -LiteralPath $temporary -Destination $Path -Force:$AllowReplace
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed. Refresh the development IAM Identity Center session and inspect it locally." }
  return ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description "$Operation response"
}

function New-DurableExecutionName {
  param([Parameter(Mandatory)][string]$ExactRunId)
  if ($ExactRunId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw "The run ID must be an exact lowercase UUIDv4."
  }
  return "d1-provider-failure-$($ExactRunId.Replace('-', ''))"
}

function Assert-SourceProvenance {
  param([switch]$AllowVerifierOnlyDelta)
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $origin -or $dirty.Count -ne 0) {
    throw "Acceptance requires a clean main checkout exactly matching origin/main."
  }
  if ($head -ceq $SourceSha) { return $head }
  if (-not $AllowVerifierOnlyDelta) { throw "Plan and Execute require SourceSha to equal clean origin/main." }
  & git -C $repositoryRoot merge-base --is-ancestor $SourceSha $head 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Verify requires SourceSha to be an ancestor of clean origin/main." }
  $changes = @(& git -C $repositoryRoot diff --name-status $SourceSha $head -- 2>$null)
  if ($LASTEXITCODE -ne 0 -or $changes.Count -eq 0) { throw "The verifier-only source delta is empty or unreadable." }
  foreach ($change in $changes) {
    $parts = @($change -split "`t")
    if ($parts.Count -ne 2 -or $parts[0] -notin @("A", "M") -or $parts[1] -notin $allowedVerifierDelta) {
      throw "A non-verifier dependency changed after the reviewed release source."
    }
  }
  return $head
}

function Read-RepresentativeConfiguration {
  $path = Resolve-PathBelowRoot -Candidate $RepresentativeConfigPath -AllowedRoot $representativeRoot -MustExist
  if ((Get-FileSha256 -Path $path) -cne $ReviewedConfigSha256) {
    throw "The representative configuration checksum does not match the independently reviewed SHA-256."
  }
  $config = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $path -Raw) -Description "Representative configuration"
  $fixture = $config.profiles.providerFailure.existingGuardedSyntheticFixture
  $aggregatePath = if ($null -ne $fixture) { [string]$fixture.aggregateResultPath } else { "" }
  if ([string]$config.status -cne "reviewed" -or [string]$config.release.sourceSha -cne $SourceSha -or
    [long]$config.release.terraformStateSerial -lt 1 -or [string]$config.release.runtimePlanSha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$config.run.runId -cne $RunId -or $config.run.generatedSyntheticOnly -isnot [bool] -or
    -not [bool]$config.run.generatedSyntheticOnly -or $config.run.oneRunOnly -isnot [bool] -or
    -not [bool]$config.run.oneRunOnly -or $config.run.cleanupRequired -isnot [bool] -or
    -not [bool]$config.run.cleanupRequired -or $config.run.recoveryRequired -isnot [bool] -or
    -not [bool]$config.run.recoveryRequired -or [string]$config.profiles.providerFailure.state -cne "available" -or
    $null -ne $config.profiles.providerFailure.blocker -or $null -eq $fixture -or
    [string]$fixture.kind -cne $fixtureKind -or [string]$fixture.sourceId -cne $fixtureSourceId -or
    [string]$fixture.adapterVersion -cne $fixtureAdapterVersion -or
    [string]$fixture.operatorPath -cne "scripts/operate-development-d1-provider-failure-acceptance.ps1" -or
    [string]::IsNullOrWhiteSpace($aggregatePath)) {
    throw "The representative configuration is not the exact reviewed, one-run, generated-synthetic provider fixture."
  }
  $resolvedAggregate = Resolve-PathBelowRoot -Candidate $aggregatePath -AllowedRoot $representativeRoot
  return [pscustomobject]@{
    Path = $path
    Config = $config
    StateSerial = [long]$config.release.terraformStateSerial
    RuntimePlanPath = [string]$config.release.runtimePlanPath
    RuntimePlanSha256 = [string]$config.release.runtimePlanSha256
    AggregatePath = $resolvedAggregate
  }
}

function Assert-ReviewedZeroDriftPlan {
  param([Parameter(Mandatory)][object]$Representative)
  $planPath = Resolve-PathBelowRoot -Candidate $Representative.RuntimePlanPath -AllowedRoot $terraformDataRoot -MustExist
  if ((Get-FileSha256 -Path $planPath) -cne $Representative.RuntimePlanSha256) {
    throw "The representative runtime plan checksum does not match its reviewed binding."
  }
  $shown = & terraform "-chdir=$terraformDirectory" show -json $planPath 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The reviewed representative runtime plan cannot be inspected." }
  $plan = ConvertFrom-OperatorJson -Json ($shown -join "`n") -Description "Reviewed representative runtime plan"
  $null = Assert-ZeroChangePlan $plan "Reviewed representative runtime plan"
  return [pscustomobject]@{ Path = $planPath; Plan = $plan }
}

function Assert-ZeroChangePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string]$Description)
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  if ($changes.Count -ne 0) { throw "$Description is not zero drift." }
  return $true
}

function ConvertTo-TerraformVariableText {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return "null" }
  if ($Value -is [string]) { return [string]$Value }
  if ($Value -is [bool]) { if ($Value) { return "true" }; return "false" }
  return ($Value | ConvertTo-Json -Compress -Depth 30)
}

function Invoke-FreshZeroDriftPlan {
  param(
    [Parameter(Mandatory)][object]$ReviewedPlan,
    [ValidateSet("pre-run", "post-run")][string]$Phase,
    [switch]$AllowExisting
  )
  $null = New-Item -ItemType Directory -Path $operatorRoot -Force
  $path = Join-Path $operatorRoot "$Phase-zero-drift-$RunId.tfplan"
  $logPath = "$path.log"
  if ($AllowExisting -and (Test-Path -LiteralPath $path -PathType Leaf)) {
    $shown = & terraform "-chdir=$terraformDirectory" show -json $path 2>$null
    if ($LASTEXITCODE -ne 0) { throw "The retained $Phase refresh-backed plan cannot be inspected." }
    $plan = ConvertFrom-OperatorJson ($shown -join "`n") "Retained $Phase refresh-backed plan"
    $null = Assert-ZeroChangePlan $plan "Retained $Phase refresh-backed plan"
    return [pscustomobject]@{ Path = $path; Sha256 = Get-FileSha256 $path }
  }
  if ((Test-Path -LiteralPath $path) -or (Test-Path -LiteralPath $logPath)) {
    throw "Refusing to replace a fresh zero-drift plan or log."
  }
  $savedVariables = @{}
  try {
    foreach ($property in @($ReviewedPlan.variables.PSObject.Properties)) {
      $name = "TF_VAR_$($property.Name)"
      $savedVariables[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
      [Environment]::SetEnvironmentVariable(
        $name,
        (ConvertTo-TerraformVariableText (Get-OptionalProperty $property.Value "value")),
        "Process"
      )
    }
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      -detailed-exitcode "-out=$path" *> $logPath
    $exitCode = $LASTEXITCODE
  } finally {
    foreach ($entry in $savedVariables.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, "Process")
    }
  }
  if ($exitCode -ne 0) {
    throw "The fresh refresh-backed development plan is not zero drift. Inspect only its ignored local log."
  }
  $shown = & terraform "-chdir=$terraformDirectory" show -json $path 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The fresh refresh-backed zero-drift plan cannot be inspected." }
  $plan = ConvertFrom-OperatorJson ($shown -join "`n") "Fresh refresh-backed zero-drift plan"
  $null = Assert-ZeroChangePlan $plan "Fresh refresh-backed development plan"
  return [pscustomobject]@{ Path = $path; Sha256 = Get-FileSha256 $path }
}

function Assert-Caller {
  if ($Region -cne "us-east-2" -or $ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
    throw "The exact development account, us-east-2 region, and encrypted state bucket are required."
  }
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
  $caller = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--output", "json") -Operation "AWS caller validation"
  if ([string]$caller.Account -cne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/AWSReservedSSO_")) {
    throw "Use an approved temporary IAM Identity Center role in the exact development account."
  }
}

function Read-StateSnapshot {
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") "State versioning validation"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") "State public-access validation"
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") "State encryption validation"
  $block = $public.PublicAccessBlockConfiguration
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and $_.BucketKeyEnabled -and
      [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -match "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/"
    })
  if ([string]$versioning.Status -cne "Enabled" -or $rules.Count -ne 1 -or
    -not $block.BlockPublicAcls -or -not $block.IgnorePublicAcls -or -not $block.BlockPublicPolicy -or -not $block.RestrictPublicBuckets) {
    throw "The Terraform state bucket is not the exact versioned, private, customer-KMS boundary."
  }
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") "State object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or
    [string]$head.SSEKMSKeyId -cne [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -or
    -not $head.BucketKeyEnabled -or [string]::IsNullOrWhiteSpace([string]$head.VersionId)) {
    throw "The current Terraform state object is outside the exact encrypted boundary."
  }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $download = Invoke-AwsJson @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) "Versioned state read"
    if ([string]$download.VersionId -cne [string]$head.VersionId) { throw "The Terraform state version changed during its exact read." }
    $state = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $temporary -Raw) -Description "Versioned Terraform state"
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  if ([string]$state.lineage -notmatch '^[0-9a-f-]{36}$' -or [long]$state.serial -lt 1 -or [string]$state.terraform_version -cne "1.9.8") {
    throw "The encrypted Terraform state identity is invalid."
  }
  return [pscustomobject]@{ State = $state; VersionId = [string]$head.VersionId; Serial = [long]$state.serial; Lineage = [string]$state.lineage }
}

function Get-StateResource {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Name)
  $matches = @($Snapshot.State.resources | Where-Object { [string]$_.type -ceq $Type -and [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1 -or @($matches[0].instances).Count -ne 1) { throw "Terraform state must contain exactly one $Type.$Name resource instance." }
  return $matches[0].instances[0].attributes
}

function Get-StateResourceInstances {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Name)
  $matches = @($Snapshot.State.resources | Where-Object { [string]$_.type -ceq $Type -and [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1 -or @($matches[0].instances).Count -lt 1) {
    throw "Terraform state must contain $Type.$Name resource instances."
  }
  return @($matches[0].instances | ForEach-Object {
      [pscustomobject]@{ IndexKey = [string](Get-OptionalProperty $_ "index_key"); Attributes = $_.attributes }
    })
}

function Get-IngestionNetworkBoundary {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][object]$Activity)
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
  $privateSubnetIds = @($privateSubnets | ForEach-Object { [string]$_.Attributes.id } | Sort-Object -Unique)
  $providerSubnetIds = @($providerSubnets | ForEach-Object { [string]$_.Attributes.id } | Sort-Object -Unique)
  $privateRouteIds = @($privateRoutes | ForEach-Object { [string]$_.Attributes.id } | Sort-Object -Unique)
  $providerRouteIds = @($providerRoutes | ForEach-Object { [string]$_.Attributes.id } | Sort-Object -Unique)
  $applicationNatIds = @($applicationNats | ForEach-Object { [string]$_.attributes.id } | Sort-Object -Unique)
  $activityNatIds = @($privateRoutes | ForEach-Object { @($_.Attributes.route) } | ForEach-Object {
      [string]$_.nat_gateway_id
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $activitySubnetIds = @($Activity.vpc_config[0].subnet_ids | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  if ($privateSubnetIds.Count -ne 2 -or $providerSubnetIds.Count -ne 2 -or $privateRouteIds.Count -ne 2 -or
    $providerRouteIds.Count -ne 2 -or @($Activity.vpc_config).Count -ne 1 -or $providerNats.Count -ne 0 -or
    @($privateSubnetIds | Where-Object { $_ -in $providerSubnetIds }).Count -ne 0 -or
    ($activitySubnetIds -join "|") -cne ($privateSubnetIds -join "|") -or
    (@($privateAssociations | ForEach-Object { [string]$_.Attributes.subnet_id } | Sort-Object) -join "|") -cne ($privateSubnetIds -join "|") -or
    (@($privateAssociations | ForEach-Object { [string]$_.Attributes.route_table_id } | Sort-Object) -join "|") -cne ($privateRouteIds -join "|") -or
    (@($providerAssociations | ForEach-Object { [string]$_.Attributes.subnet_id } | Sort-Object) -join "|") -cne ($providerSubnetIds -join "|") -or
    (@($providerAssociations | ForEach-Object { [string]$_.Attributes.route_table_id } | Sort-Object) -join "|") -cne ($providerRouteIds -join "|") -or
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
      [string]$_.NatGatewayId
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

function Assert-StateBoundary {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][object]$Representative)
  if ([long]$Snapshot.Serial -ne [long]$Representative.StateSerial) { throw "Terraform state serial does not match the reviewed representative configuration." }
  $durableArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$durableFunctionName`:$ExpectedDurableVersion"
  $activityArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$activityFunctionName`:$ExpectedActivityVersion"
  $activity = Get-StateResource $Snapshot "aws_lambda_function" "ingestion_activity"
  $runtimeFunctions = @(Get-StateResourceInstances $Snapshot "aws_lambda_function" "ingestion_runtime")
  $mapping = Get-StateResource $Snapshot "aws_lambda_event_source_mapping" "ingestion_dispatch"
  $stack = Get-StateResource $Snapshot "aws_cloudformation_stack" "ingestion_durable"
  $schedule = Get-StateResource $Snapshot "aws_cloudwatch_event_rule" "ingestion_schedule"
  $terminal = Get-StateResource $Snapshot "aws_cloudwatch_event_rule" "ingestion_terminal"
  $dispatch = Get-StateResource $Snapshot "aws_sqs_queue" "ingestion_dispatch"
  $deadLetter = Get-StateResource $Snapshot "aws_sqs_queue" "ingestion_dead_letter"
  $cluster = Get-StateResource $Snapshot "aws_ecs_cluster" "this"
  $network = Get-IngestionNetworkBoundary $Snapshot $activity
  $template = ConvertFrom-OperatorJson -Json ([string]$stack.template_body) -Description "Terraform-owned ingestion durable template"
  $durableProperties = $template.Resources.DurableFunction.Properties
  $durableVersionProperties = $template.Resources.DurableVersion.Properties
  $runtimeNames = @("coordinator", "starter", "terminal")
  if ($runtimeFunctions.Count -ne $runtimeNames.Count -or
    (@($runtimeFunctions.IndexKey | Sort-Object) -join "|") -cne (@($runtimeNames | Sort-Object) -join "|")) {
    throw "Terraform state does not contain the exact ingestion runtime function set."
  }
  foreach ($runtime in $runtimeFunctions) {
    $variables = $runtime.Attributes.environment[0].variables
    if ([string]$runtime.Attributes.source_code_hash -cne $ExpectedActivityCodeSha256 -or
      [string]$variables.RELEASE_SHA -cne $ExpectedActivityArtifactSha256 -or
      [string]$variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or
      [string]$variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or
      [string]$variables.INGESTION_PROVIDER_SOURCES -cne "[]") {
      throw "Terraform state contains a non-dark ingestion runtime function."
    }
  }
  if ([string]$stack.outputs.DurableVersionArn -cne $durableArn -or [string]$activity.qualified_arn -cne $activityArn -or
    [string]$activity.version -cne [string]$ExpectedActivityVersion -or [string]$activity.source_code_hash -cne $ExpectedActivityCodeSha256 -or
    [string]$activity.environment[0].variables.RELEASE_SHA -cne $ExpectedActivityArtifactSha256 -or
    [string]$activity.environment[0].variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or
    [string]$activity.environment[0].variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or
    [string]$activity.environment[0].variables.INGESTION_PROVIDER_SOURCES -cne "[]" -or
    [string]$durableVersionProperties.CodeSha256 -cne $ExpectedDurableCodeSha256 -or
    [string]$durableProperties.Environment.Variables.RELEASE_SHA -cne $ExpectedDurableArtifactSha256 -or
    [string]$durableProperties.Environment.Variables.INGESTION_ACTIVITY_FUNCTION_ARN -cne $activityArn -or
    [bool]$mapping.enabled -or [string]$schedule.state -cne "DISABLED" -or [string]$terminal.state -cne "DISABLED" -or
    [string]$dispatch.name -cne $dispatchQueueName -or [string]$deadLetter.name -cne $deadLetterQueueName -or
    [string]$cluster.name -cne $ecsClusterName) {
    throw "Terraform state does not bind the exact immutable, trigger-dark, provider-off ingestion boundary."
  }
  return [pscustomobject]@{
    DurableArn = $durableArn; ActivityArn = $activityArn; MappingUuid = [string]$mapping.uuid
    DurableFunctionArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$durableFunctionName"
    ActivityFunctionArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$activityFunctionName"
    Network = $network
    RuntimeFunctions = @($runtimeFunctions | ForEach-Object {
        [pscustomobject]@{
          Name = "$durableFunctionName".Replace("ingestion-durable", "ingestion-$($_.IndexKey)")
          Version = [string]$_.Attributes.version
          CodeSha256 = [string]$_.Attributes.source_code_hash
        }
      })
    StateVersionId = $Snapshot.VersionId; StateLineage = $Snapshot.Lineage; StateSerial = $Snapshot.Serial
  }
}

function Get-QueueAttributes {
  param([Parameter(Mandatory)][string]$QueueName)
  $url = "https://sqs.$Region.amazonaws.com/$ExpectedAccountId/$QueueName"
  $result = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", $url, "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed", "--output", "json") "Queue boundary validation"
  $attributes = $result.Attributes
  return [pscustomobject]@{
    Visible = [int]$attributes.ApproximateNumberOfMessages
    NotVisible = [int]$attributes.ApproximateNumberOfMessagesNotVisible
    Delayed = [int]$attributes.ApproximateNumberOfMessagesDelayed
  }
}

function Get-DurableExecutionMatches {
  param([Parameter(Mandatory)][string]$ExecutionName)
  $result = Invoke-AwsJson @(
    "lambda", "list-durable-executions-by-function", "--function-name", $durableFunctionName,
    "--qualifier", [string]$ExpectedDurableVersion, "--durable-execution-name", $ExecutionName,
    "--max-items", "2", "--output", "json"
  ) "Exact durable execution lookup"
  if (-not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $result "NextMarker")) -or
    -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $result "NextToken"))) {
    throw "The exact durable execution lookup was unexpectedly paginated."
  }
  $expectedFunctionArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$durableFunctionName"
  return @($result.DurableExecutions | Where-Object {
      [string]$_.DurableExecutionName -ceq $ExecutionName -and
      [string]$_.FunctionArn -ceq $expectedFunctionArn -and
      [string]$_.Version -ceq [string]$ExpectedDurableVersion
    })
}

function Get-AllIngestionMappings {
  param([Parameter(Mandatory)][object]$StateBoundary)
  $functionNames = @($durableFunctionName, $activityFunctionName) + @($StateBoundary.RuntimeFunctions | ForEach-Object { $_.Name })
  $functionTargets = @($functionNames | ForEach-Object { [string]$_; "$($_):development" } | Sort-Object -Unique)
  $mappings = @()
  foreach ($functionTarget in $functionTargets) {
    $result = Invoke-AwsJson @(
      "lambda", "list-event-source-mappings", "--function-name", $functionTarget,
      "--max-items", "100", "--output", "json"
    ) "Ingestion mapping enumeration"
    if (-not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $result "NextMarker")) -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $result "NextToken"))) {
      throw "Ingestion mapping enumeration was unexpectedly paginated."
    }
    $mappings += @($result.EventSourceMappings)
  }
  return @($mappings)
}

function Assert-LiveBoundary {
  param([Parameter(Mandatory)][object]$StateBoundary, [Parameter(Mandatory)][string]$ExecutionName, [switch]$RequireNoExecution)
  $durable = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $StateBoundary.DurableArn, "--output", "json") "Durable version validation"
  $activity = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $StateBoundary.ActivityArn, "--output", "json") "Activity version validation"
  $runtimeConfigurations = @($StateBoundary.RuntimeFunctions | ForEach-Object {
      Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", "$($_.Name):$($_.Version)", "--output", "json") "Ingestion runtime function validation"
    })
  $schedule = Invoke-AwsJson @("events", "describe-rule", "--name", $scheduleRuleName, "--output", "json") "Ingestion schedule validation"
  $terminal = Invoke-AwsJson @("events", "describe-rule", "--name", $terminalRuleName, "--output", "json") "Ingestion terminal-rule validation"
  $mapping = Invoke-AwsJson @("lambda", "get-event-source-mapping", "--uuid", $StateBoundary.MappingUuid, "--output", "json") "Ingestion mapping validation"
  $allMappings = @(Get-AllIngestionMappings $StateBoundary)
  $routeArguments = @("ec2", "describe-route-tables", "--route-table-ids") + @($StateBoundary.Network.ActivityRouteTableIds) + @("--output", "json")
  $routeTables = Invoke-AwsJson $routeArguments "Ingestion route topology validation"
  $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $ecsClusterName, "--desired-status", "RUNNING", "--output", "json") "ECS task validation"
  $services = Invoke-AwsJson @("ecs", "list-services", "--cluster", $ecsClusterName, "--output", "json") "ECS service validation"
  $dispatch = Get-QueueAttributes $dispatchQueueName
  $deadLetter = Get-QueueAttributes $deadLetterQueueName
  $matches = @(Get-DurableExecutionMatches $ExecutionName)
  if ([string]$durable.FunctionArn -cne $StateBoundary.DurableFunctionArn -or [string]$durable.Version -cne [string]$ExpectedDurableVersion -or
    [string]$durable.State -cne "Active" -or [string]$durable.LastUpdateStatus -cne "Successful" -or
    [string]$durable.CodeSha256 -cne $ExpectedDurableCodeSha256 -or
    [string]$durable.Environment.Variables.RELEASE_SHA -cne $ExpectedDurableArtifactSha256 -or
    [string]$durable.Environment.Variables.INGESTION_ACTIVITY_FUNCTION_ARN -cne $StateBoundary.ActivityArn -or
    [string]$activity.FunctionArn -cne $StateBoundary.ActivityFunctionArn -or [string]$activity.Version -cne [string]$ExpectedActivityVersion -or
    [string]$activity.State -cne "Active" -or [string]$activity.LastUpdateStatus -cne "Successful" -or
    [string]$activity.CodeSha256 -cne $ExpectedActivityCodeSha256 -or
    [string]$activity.Environment.Variables.RELEASE_SHA -cne $ExpectedActivityArtifactSha256 -or
    [string]$activity.Environment.Variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or
    [string]$activity.Environment.Variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or
    [string]$activity.Environment.Variables.INGESTION_PROVIDER_SOURCES -cne "[]" -or
    [string]$schedule.State -cne "DISABLED" -or [string]$terminal.State -cne "DISABLED" -or
    [string]$mapping.State -cne "Disabled" -or $allMappings.Count -ne 1 -or
    [string]$allMappings[0].UUID -cne $StateBoundary.MappingUuid -or [string]$allMappings[0].State -cne "Disabled" -or
    @($tasks.taskArns).Count -ne 0 -or @($services.serviceArns).Count -ne 0 -or
    $dispatch.Visible -ne 0 -or $dispatch.NotVisible -ne 0 -or $dispatch.Delayed -ne 0 -or
    $deadLetter.Visible -ne 0 -or $deadLetter.NotVisible -ne 0 -or $deadLetter.Delayed -ne 0 -or
    ($RequireNoExecution -and $matches.Count -ne 0)) {
    throw "The live development boundary is not exact, trigger-dark, provider-off, empty, idle, or execution-free."
  }
  Assert-LiveIngestionNetworkBoundary $StateBoundary.Network $activity $routeTables
  foreach ($expected in $StateBoundary.RuntimeFunctions) {
    $configuration = @($runtimeConfigurations | Where-Object {
        [string]$_.FunctionName -ceq [string]$expected.Name -and [string]$_.Version -ceq [string]$expected.Version
      })
    if ($configuration.Count -ne 1 -or [string]$configuration[0].CodeSha256 -cne [string]$expected.CodeSha256 -or
      [string]$configuration[0].Environment.Variables.RELEASE_SHA -cne $ExpectedActivityArtifactSha256 -or
      [string]$configuration[0].Environment.Variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or
      [string]$configuration[0].Environment.Variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or
      [string]$configuration[0].Environment.Variables.INGESTION_PROVIDER_SOURCES -cne "[]") {
      throw "A live ingestion runtime function is not exact and default-dark."
    }
  }
  return [pscustomobject]@{ Dispatch = $dispatch; DeadLetter = $deadLetter; ExecutionMatches = $matches }
}

function New-WorkflowPayload {
  return [ordered]@{
    schemaVersion = 1
    workflowDefinitionVersion = 1
    fixtureKind = $fixtureKind
    runId = $RunId
    reviewedConfigSha256 = $ReviewedConfigSha256
    releaseSourceSha = $SourceSha
  }
}

function New-ExecutionPlan {
  param(
    [Parameter(Mandatory)][object]$Representative,
    [Parameter(Mandatory)][object]$Boundary,
    [Parameter(Mandatory)][string]$ExecutionName,
    [Parameter(Mandatory)][object]$FreshZeroDrift
  )
  return [ordered]@{
    schemaVersion = 1
    kind = "development-d1-provider-failure-acceptance-plan"
    environment = "development"
    region = $Region
    accountId = $ExpectedAccountId
    fixtureKind = $fixtureKind
    sourceId = $fixtureSourceId
    adapterVersion = $fixtureAdapterVersion
    runId = $RunId
    executionName = $ExecutionName
    reviewedConfigSha256 = $ReviewedConfigSha256
    releaseSourceSha = $SourceSha
    durableVersion = $ExpectedDurableVersion
    activityVersion = $ExpectedActivityVersion
    durableArtifactSha256 = $ExpectedDurableArtifactSha256
    durableCodeSha256 = $ExpectedDurableCodeSha256
    activityArtifactSha256 = $ExpectedActivityArtifactSha256
    activityCodeSha256 = $ExpectedActivityCodeSha256
    terraformStateLineage = $Boundary.StateLineage
    terraformStateSerial = $Boundary.StateSerial
    terraformStateVersionId = $Boundary.StateVersionId
    runtimePlanSha256 = $Representative.RuntimePlanSha256
    freshZeroDriftPlanPath = $FreshZeroDrift.Path
    freshZeroDriftPlanSha256 = $FreshZeroDrift.Sha256
    createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(30).ToString("o")
    mutation = "invoke-one-exact-numeric-ingestion-durable-version"
  }
}

function Read-ExecutionPlan {
  param([Parameter(Mandatory)][object]$Representative, [Parameter(Mandatory)][object]$Boundary, [switch]$RequireFresh)
  $path = Resolve-PathBelowRoot -Candidate $ExecutionPlanPath -AllowedRoot $operatorRoot -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedExecutionPlanSha256) { throw "The execution plan checksum does not match the reviewed SHA-256." }
  $plan = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Execution plan"
  $null = Assert-ExactProperties $plan @(
    "schemaVersion", "kind", "environment", "region", "accountId", "fixtureKind", "sourceId", "adapterVersion",
    "runId", "executionName", "reviewedConfigSha256", "releaseSourceSha", "durableVersion", "activityVersion",
    "durableArtifactSha256", "durableCodeSha256", "activityArtifactSha256", "activityCodeSha256",
    "terraformStateLineage", "terraformStateSerial", "terraformStateVersionId", "runtimePlanSha256",
    "freshZeroDriftPlanPath", "freshZeroDriftPlanSha256", "createdAt", "expiresAt", "mutation"
  ) "Execution plan"
  if ([int]$plan.schemaVersion -ne 1 -or [string]$plan.kind -cne "development-d1-provider-failure-acceptance-plan" -or
    [string]$plan.environment -cne "development" -or [string]$plan.region -cne $Region -or [string]$plan.accountId -cne $ExpectedAccountId -or
    [string]$plan.fixtureKind -cne $fixtureKind -or [string]$plan.sourceId -cne $fixtureSourceId -or
    [string]$plan.adapterVersion -cne $fixtureAdapterVersion -or [string]$plan.runId -cne $RunId -or
    [string]$plan.executionName -cne (New-DurableExecutionName $RunId) -or
    [string]$plan.reviewedConfigSha256 -cne $ReviewedConfigSha256 -or [string]$plan.releaseSourceSha -cne $SourceSha -or
    [int]$plan.durableVersion -ne $ExpectedDurableVersion -or [int]$plan.activityVersion -ne $ExpectedActivityVersion -or
    [string]$plan.durableArtifactSha256 -cne $ExpectedDurableArtifactSha256 -or [string]$plan.durableCodeSha256 -cne $ExpectedDurableCodeSha256 -or
    [string]$plan.activityArtifactSha256 -cne $ExpectedActivityArtifactSha256 -or [string]$plan.activityCodeSha256 -cne $ExpectedActivityCodeSha256 -or
    [string]$plan.terraformStateLineage -cne $Boundary.StateLineage -or [long]$plan.terraformStateSerial -ne $Boundary.StateSerial -or
    [string]$plan.terraformStateVersionId -cne $Boundary.StateVersionId -or [string]$plan.runtimePlanSha256 -cne $Representative.RuntimePlanSha256 -or
    [string]$plan.freshZeroDriftPlanSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileSha256 (Resolve-PathBelowRoot -Candidate ([string]$plan.freshZeroDriftPlanPath) -AllowedRoot $operatorRoot -MustExist)) -cne [string]$plan.freshZeroDriftPlanSha256 -or
    [string]$plan.mutation -cne "invoke-one-exact-numeric-ingestion-durable-version" -or
    -not (Test-CanonicalTimestamp $plan.createdAt) -or -not (Test-CanonicalTimestamp $plan.expiresAt)) {
    throw "The execution plan is not bound to the exact reviewed release and immutable live boundary."
  }
  if ($RequireFresh -and [DateTimeOffset]::Parse([string]$plan.expiresAt) -le [DateTimeOffset]::UtcNow) { throw "The reviewed execution plan expired before mutation." }
  return [pscustomobject]@{ Path = $path; Plan = $plan }
}

function Invoke-ExactDurableExecution {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][object]$Payload, [Parameter(Mandatory)][string]$ExecutionName)
  $payloadPath = Join-Path $operatorRoot "payload-$RunId.json"
  $outputPath = Join-Path $operatorRoot "invoke-$RunId.json"
  if ((Test-Path -LiteralPath $payloadPath) -or (Test-Path -LiteralPath $outputPath)) {
    throw "Refusing to replace an existing invocation artifact."
  }
  try {
    [IO.File]::WriteAllText($payloadPath, ($Payload | ConvertTo-Json -Compress -Depth 10), $utf8WithoutBom)
    $raw = & aws lambda invoke --function-name $Boundary.DurableArn --invocation-type Event `
      --durable-execution-name $ExecutionName --payload "fileb://$payloadPath" `
      --cli-binary-format raw-in-base64-out --output json $outputPath 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "The named durable invocation returned ambiguously. Do not execute again; use Verify with the preserved pre-invocation receipt."
    }
    $response = ConvertFrom-OperatorJson ($raw -join "`n") "Durable invocation response"
    if ([int]$response.StatusCode -ne 202 -or [string]$response.ExecutedVersion -cne [string]$ExpectedDurableVersion -or
      [string]$response.DurableExecutionArn -cnotmatch "^$([regex]::Escape($Boundary.DurableArn))/durable-execution/$([regex]::Escape($ExecutionName))/[A-Za-z0-9_-]+$") {
      throw "The durable invocation response did not bind the exact version and execution name."
    }
    return [string]$response.DurableExecutionArn
  } finally {
    Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ExactDurableResult {
  param([Parameter(Mandatory)][string]$DurableExecutionArn, [Parameter(Mandatory)][object]$Boundary)
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($MaximumPollSeconds)
  do {
    $execution = Invoke-AwsJson @("lambda", "get-durable-execution", "--durable-execution-arn", $DurableExecutionArn, "--include-execution-data", "--output", "json") "Durable execution polling"
    if ([string]$execution.DurableExecutionArn -cne $DurableExecutionArn -or [string]$execution.DurableExecutionName -cne (New-DurableExecutionName $RunId) -or
      [string]$execution.FunctionArn -cne $Boundary.DurableFunctionArn -or [string]$execution.Version -cne [string]$ExpectedDurableVersion) {
      throw "The durable execution metadata crossed the reviewed version or run boundary."
    }
    if ([string]$execution.Status -cne "RUNNING") { break }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "Durable execution polling reached its bounded timeout; use Verify to resume polling without another invocation." }
    Start-Sleep -Seconds 2
  } while ($true)
  if ([string]$execution.Status -cne "SUCCEEDED") { throw "The exact durable execution reached a non-success terminal state." }
  $input = ConvertFrom-BoundedJsonString ([string]$execution.InputPayload) "Private durable input" 4096
  $result = ConvertFrom-BoundedJsonString ([string]$execution.OutputPayload) "Private durable result" 8192
  $expectedPayload = New-WorkflowPayload
  $null = Assert-ExactProperties $input @("schemaVersion", "workflowDefinitionVersion", "fixtureKind", "runId", "reviewedConfigSha256", "releaseSourceSha") "Private durable input"
  $null = Assert-ExactProperties $result @(
    "schemaVersion", "profile", "fixtureKind", "sourceId", "adapterVersion", "runId", "reviewedConfigSha256", "releaseSourceSha",
    "providerFaultsInjected", "providerFailuresObserved", "recoveryAttempts", "recoveriesSucceeded", "providerRequests",
    "observationCount", "createdCount", "updatedCount"
  ) "Private durable result"
  if (($input | ConvertTo-Json -Compress -Depth 10) -cne ($expectedPayload | ConvertTo-Json -Compress -Depth 10) -or
    [int]$result.schemaVersion -ne 1 -or [string]$result.profile -cne "d1_deployed_provider_failure_durable_v1" -or
    [string]$result.fixtureKind -cne $fixtureKind -or [string]$result.sourceId -cne $fixtureSourceId -or
    [string]$result.adapterVersion -cne $fixtureAdapterVersion -or [string]$result.runId -cne $RunId -or
    [string]$result.reviewedConfigSha256 -cne $ReviewedConfigSha256 -or [string]$result.releaseSourceSha -cne $SourceSha -or
    [int]$result.providerFaultsInjected -ne 1 -or [int]$result.providerFailuresObserved -ne 1 -or
    [int]$result.recoveryAttempts -ne 1 -or [int]$result.recoveriesSucceeded -ne 1 -or
    [int]$result.providerRequests -ne 0 -or [int]$result.observationCount -ne 0 -or
    [int]$result.createdCount -ne 0 -or [int]$result.updatedCount -ne 0) {
    throw "The private durable result did not prove the exact one-fault, one-recovery, zero-provider, zero-write contract."
  }
  return $result
}

function Get-CloudWatchMaximum {
  param([Parameter(Mandatory)][string]$QueueName, [Parameter(Mandatory)][string]$MetricName, [Parameter(Mandatory)][DateTimeOffset]$Started, [Parameter(Mandatory)][DateTimeOffset]$Ended)
  $result = Invoke-AwsJson @(
    "cloudwatch", "get-metric-statistics", "--namespace", "AWS/SQS", "--metric-name", $MetricName,
    "--dimensions", "Name=QueueName,Value=$QueueName", "--start-time", $Started.ToString("o"), "--end-time", $Ended.ToString("o"),
    "--period", "60", "--statistics", "Maximum", "--output", "json"
  ) "Aggregate queue metric query"
  $values = @($result.Datapoints | ForEach-Object { [decimal]$_.Maximum })
  if ($values.Count -eq 0) { return [decimal]0 }
  return [decimal](($values | Measure-Object -Maximum).Maximum)
}

function Get-AggregateLogCount {
  param([Parameter(Mandatory)][string]$FilterExpression, [Parameter(Mandatory)][DateTimeOffset]$Started, [Parameter(Mandatory)][DateTimeOffset]$Ended)
  $query = "fields @message | filter @message like /$FilterExpression/ | stats count(*) as aggregateCount"
  $start = [long][Math]::Floor(($Started.ToUniversalTime() - [DateTimeOffset]::UnixEpoch).TotalSeconds)
  $end = [long][Math]::Ceiling(($Ended.ToUniversalTime() - [DateTimeOffset]::UnixEpoch).TotalSeconds)
  $request = Invoke-AwsJson @("logs", "start-query", "--log-group-name", $applicationLogGroup, "--start-time", [string]$start, "--end-time", [string]$end, "--query-string", $query, "--limit", "1", "--output", "json") "Aggregate-only privacy log query"
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    $result = Invoke-AwsJson @("logs", "get-query-results", "--query-id", [string]$request.queryId, "--output", "json") "Aggregate-only privacy log result"
    if ([string]$result.status -eq "Complete") {
      $field = @($result.results | ForEach-Object { @($_) } | Where-Object { [string]$_.field -ceq "aggregateCount" })
      if ($field.Count -eq 0) { return 0 }
      return [int]$field[0].value
    }
    if ([string]$result.status -in @("Failed", "Cancelled", "Timeout", "Unknown")) { throw "The aggregate-only privacy log query did not complete." }
    Start-Sleep -Milliseconds 500
  }
  throw "The aggregate-only privacy log query exceeded its bounded polling window."
}

function Assert-InvocationArtifactsAbsent {
  foreach ($path in @(
      (Join-Path $operatorRoot "payload-$RunId.json"),
      (Join-Path $operatorRoot "invoke-$RunId.json")
    )) {
    if (Test-Path -LiteralPath $path) { throw "A mutable invocation artifact remains after cleanup." }
  }
  return $true
}

function Assert-ProviderAggregate {
  param([Parameter(Mandatory)][object]$Aggregate, [Parameter(Mandatory)][string]$ExpectedStartedAt)
  $null = Assert-ExactProperties $Aggregate @(
    "profile", "fixtureKind", "sourceId", "adapterVersion", "startedAt", "endedAt", "durationMs",
    "providerFaultsInjected", "providerFailuresObserved", "recoveriesSucceeded", "cleanupAttempted",
    "cleanupSucceeded", "postCleanupArtifacts", "retainedAuditRows", "retainedDurableExecutions",
    "eventQueueAgeMaxSeconds", "eventQueueVisibleMax", "eventDeadLetterMax", "durableDeadLetterMax",
    "logErrorMatches", "forbiddenLogMatches"
  ) "Provider-failure aggregate"
  if ([string]$Aggregate.profile -cne "d1_deployed_provider_failure_recovery_v1" -or
    [string]$Aggregate.fixtureKind -cne $fixtureKind -or [string]$Aggregate.sourceId -cne $fixtureSourceId -or
    [string]$Aggregate.adapterVersion -cne $fixtureAdapterVersion -or [string]$Aggregate.startedAt -cne $ExpectedStartedAt -or
    -not (Test-CanonicalTimestamp $Aggregate.startedAt) -or -not (Test-CanonicalTimestamp $Aggregate.endedAt) -or
    [DateTimeOffset]::Parse([string]$Aggregate.endedAt) -lt [DateTimeOffset]::Parse($ExpectedStartedAt) -or
    [int]$Aggregate.durationMs -lt 0 -or [int]$Aggregate.providerFaultsInjected -ne 1 -or
    [int]$Aggregate.providerFailuresObserved -ne 1 -or [int]$Aggregate.recoveriesSucceeded -ne 1 -or
    $Aggregate.cleanupAttempted -isnot [bool] -or -not [bool]$Aggregate.cleanupAttempted -or
    $Aggregate.cleanupSucceeded -isnot [bool] -or -not [bool]$Aggregate.cleanupSucceeded -or
    [int]$Aggregate.postCleanupArtifacts -ne 0 -or [int]$Aggregate.retainedAuditRows -ne 0 -or
    [int]$Aggregate.retainedDurableExecutions -ne 1) {
    throw "Provider-failure aggregate does not prove the exact private cleanup and recovery contract."
  }
  foreach ($name in @(
      "eventQueueAgeMaxSeconds", "eventQueueVisibleMax", "eventDeadLetterMax", "durableDeadLetterMax",
      "logErrorMatches", "forbiddenLogMatches"
    )) {
    if ([decimal]$Aggregate.$name -lt 0) { throw "Provider-failure aggregate metrics must be nonnegative." }
  }
  return $true
}

function Assert-ZeroDriftEvidence {
  param([Parameter(Mandatory)][object]$Evidence, [Parameter(Mandatory)][object]$Representative)
  $null = Assert-ExactProperties $Evidence @(
    "profile", "checkedAt", "sourceSha", "runtimePlanSha256", "terraformStateSerial", "meaningfulChanges", "drift"
  ) "Post-run zero-drift evidence"
  if ([string]$Evidence.profile -cne "d1_post_run_zero_drift_v1" -or
    -not (Test-CanonicalTimestamp $Evidence.checkedAt) -or [string]$Evidence.sourceSha -cne $SourceSha -or
    [string]$Evidence.runtimePlanSha256 -cne $Representative.RuntimePlanSha256 -or
    [long]$Evidence.terraformStateSerial -ne [long]$Representative.StateSerial -or
    [int]$Evidence.meaningfulChanges -ne 0 -or $Evidence.drift -isnot [bool] -or [bool]$Evidence.drift) {
    throw "Post-run zero-drift evidence is not bound to the exact reviewed release."
  }
  return $true
}

function Write-OrValidateEvidence {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][scriptblock]$Validator
  )
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $existing = ConvertFrom-OperatorJson (Get-Content -LiteralPath $Path -Raw) "Retained acceptance evidence"
    $null = & $Validator $existing
    return $existing
  }
  Write-JsonFile -Path $Path -Value $Value
  $written = ConvertFrom-OperatorJson (Get-Content -LiteralPath $Path -Raw) "Written acceptance evidence"
  $null = & $Validator $written
  return $written
}

function New-Receipt {
  param([Parameter(Mandatory)][string]$ExecutionName, [Parameter(Mandatory)][string]$PlanSha, [Parameter(Mandatory)][string]$StartedAt)
  return [ordered]@{
    schemaVersion = 1; kind = "development-d1-provider-failure-acceptance-receipt"; phase = "invocation-pending"
    runId = $RunId; executionName = $ExecutionName; reviewedConfigSha256 = $ReviewedConfigSha256
    releaseSourceSha = $SourceSha; executionPlanSha256 = $PlanSha; durableVersion = $ExpectedDurableVersion
    activityVersion = $ExpectedActivityVersion; durableExecutionArn = ""; startedAt = $StartedAt; endedAt = ""
    aggregatePath = ""; aggregateSha256 = ""; zeroDriftPath = ""; zeroDriftSha256 = ""
    postRunStateVersionId = ""; postRunZeroDriftPlanPath = ""; postRunZeroDriftPlanSha256 = ""
  }
}

function Assert-Receipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$Representative,
    [Parameter(Mandatory)][object]$Boundary
  )
  $null = Assert-ExactProperties $Receipt @(
    "schemaVersion", "kind", "phase", "runId", "executionName", "reviewedConfigSha256", "releaseSourceSha",
    "executionPlanSha256", "durableVersion", "activityVersion", "durableExecutionArn", "startedAt", "endedAt",
    "aggregatePath", "aggregateSha256", "zeroDriftPath", "zeroDriftSha256",
    "postRunStateVersionId", "postRunZeroDriftPlanPath", "postRunZeroDriftPlanSha256"
  ) "Acceptance receipt"
  if ([int]$Receipt.schemaVersion -ne 1 -or [string]$Receipt.kind -cne "development-d1-provider-failure-acceptance-receipt" -or
    [string]$Receipt.phase -notin @("invocation-pending", "running", "verified") -or [string]$Receipt.runId -cne $RunId -or
    [string]$Receipt.executionName -cne (New-DurableExecutionName $RunId) -or [string]$Receipt.reviewedConfigSha256 -cne $ReviewedConfigSha256 -or
    [string]$Receipt.releaseSourceSha -cne $SourceSha -or [string]$Receipt.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
    [int]$Receipt.durableVersion -ne $ExpectedDurableVersion -or [int]$Receipt.activityVersion -ne $ExpectedActivityVersion -or
    -not (Test-CanonicalTimestamp $Receipt.startedAt)) { throw "The receipt is not bound to the exact reviewed one-run execution." }
  $emptyEvidence = @(
    "endedAt", "aggregatePath", "aggregateSha256", "zeroDriftPath", "zeroDriftSha256",
    "postRunStateVersionId", "postRunZeroDriftPlanPath", "postRunZeroDriftPlanSha256"
  )
  $executionPattern = "^$([regex]::Escape($Boundary.DurableArn))/durable-execution/$([regex]::Escape([string]$Receipt.executionName))/[A-Za-z0-9_-]+$"
  if ([string]$Receipt.phase -ceq "invocation-pending") {
    if (-not [string]::IsNullOrWhiteSpace([string]$Receipt.durableExecutionArn) -or
      @($emptyEvidence | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$Receipt.$_) }).Count -ne 0) {
      throw "An invocation-pending receipt contains uncommitted execution or evidence claims."
    }
  } elseif ([string]$Receipt.phase -ceq "running") {
    if ([string]$Receipt.durableExecutionArn -cnotmatch $executionPattern -or
      @($emptyEvidence | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$Receipt.$_) }).Count -ne 0) {
      throw "A running receipt contains an invalid execution or premature evidence claim."
    }
  } else {
    $expectedZeroPath = Resolve-PathBelowRoot ([string]$Representative.Config.profiles.postRun.zeroDriftResultPath) $representativeRoot
    $aggregatePath = Resolve-PathBelowRoot ([string]$Receipt.aggregatePath) $representativeRoot -MustExist
    $zeroPath = Resolve-PathBelowRoot ([string]$Receipt.zeroDriftPath) $representativeRoot -MustExist
    $postPlanPath = Resolve-PathBelowRoot ([string]$Receipt.postRunZeroDriftPlanPath) $operatorRoot -MustExist
    if ([string]$Receipt.durableExecutionArn -cnotmatch $executionPattern -or
      -not (Test-CanonicalTimestamp $Receipt.endedAt) -or
      [DateTimeOffset]::Parse([string]$Receipt.endedAt) -lt [DateTimeOffset]::Parse([string]$Receipt.startedAt) -or
      [string]$aggregatePath -cne [string]$Representative.AggregatePath -or [string]$zeroPath -cne [string]$expectedZeroPath -or
      [string]$Receipt.aggregateSha256 -notmatch '^[a-f0-9]{64}$' -or [string]$Receipt.zeroDriftSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$Receipt.postRunStateVersionId -cne $Boundary.StateVersionId -or
      [string]$Receipt.postRunZeroDriftPlanSha256 -notmatch '^[a-f0-9]{64}$' -or
      (Get-FileSha256 $aggregatePath) -cne [string]$Receipt.aggregateSha256 -or
      (Get-FileSha256 $zeroPath) -cne [string]$Receipt.zeroDriftSha256 -or
      (Get-FileSha256 $postPlanPath) -cne [string]$Receipt.postRunZeroDriftPlanSha256) {
      throw "A verified receipt does not bind the exact execution, destinations, current state, and evidence."
    }
    $aggregate = ConvertFrom-OperatorJson (Get-Content -LiteralPath $aggregatePath -Raw) "Verified provider aggregate"
    $zero = ConvertFrom-OperatorJson (Get-Content -LiteralPath $zeroPath -Raw) "Verified zero-drift evidence"
    $null = Assert-ProviderAggregate $aggregate ([string]$Receipt.startedAt)
    $null = Assert-ZeroDriftEvidence $zero $Representative
  }
  return $true
}

function Complete-Evidence {
  param([Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][object]$Representative, [Parameter(Mandatory)][object]$Boundary)
  $executionArn = [string]$Receipt.durableExecutionArn
  if ([string]::IsNullOrWhiteSpace($executionArn)) {
    $matches = @(Get-DurableExecutionMatches ([string]$Receipt.executionName))
    if ($matches.Count -ne 1) { throw "Verify could not recover exactly one retained execution from the pre-invocation receipt." }
    $executionArn = [string]$matches[0].DurableExecutionArn
    $Receipt.durableExecutionArn = $executionArn
    $Receipt.phase = "running"
  }
  $null = Wait-ExactDurableResult -DurableExecutionArn $executionArn -Boundary $Boundary
  $null = Assert-InvocationArtifactsAbsent
  $ended = [DateTimeOffset]::UtcNow
  $started = [DateTimeOffset]::Parse([string]$Receipt.startedAt)
  $postSnapshot = Read-StateSnapshot
  $postBoundary = Assert-StateBoundary $postSnapshot $Representative
  if ([string]$postBoundary.StateVersionId -cne [string]$Boundary.StateVersionId -or
    [string]$postBoundary.StateLineage -cne [string]$Boundary.StateLineage -or
    [long]$postBoundary.StateSerial -ne [long]$Boundary.StateSerial) {
    throw "Terraform state changed during the fixed provider-failure run."
  }
  $postRunZeroDrift = Invoke-FreshZeroDriftPlan $Representative.ReviewedPlan "post-run" -AllowExisting
  $postBoundaryResult = Assert-LiveBoundary -StateBoundary $postBoundary -ExecutionName ([string]$Receipt.executionName)
  $matches = @($postBoundaryResult.ExecutionMatches)
  if ($matches.Count -ne 1 -or [string]$matches[0].DurableExecutionArn -cne $executionArn -or [string]$matches[0].Status -cne "SUCCEEDED") {
    throw "Post-run verification did not retain exactly one successful durable execution."
  }
  $dispatchAge = Get-CloudWatchMaximum $dispatchQueueName "ApproximateAgeOfOldestMessage" $started $ended
  $dispatchVisible = Get-CloudWatchMaximum $dispatchQueueName "ApproximateNumberOfMessagesVisible" $started $ended
  $deadLetterMax = Get-CloudWatchMaximum $deadLetterQueueName "ApproximateNumberOfMessagesVisible" $started $ended
  $errorLogs = Get-AggregateLogCount '"level"\s*:\s*"error"' $started $ended
  $forbiddenLogs = Get-AggregateLogCount '(?i)(authorization|cookie|password|access[_-]?token|refresh[_-]?token|candidate[_-]?(id|email))' $started $ended
  $aggregate = [ordered]@{
    profile = "d1_deployed_provider_failure_recovery_v1"; fixtureKind = $fixtureKind; sourceId = $fixtureSourceId
    adapterVersion = $fixtureAdapterVersion; startedAt = $started.ToUniversalTime().ToString("o"); endedAt = $ended.ToUniversalTime().ToString("o")
    durationMs = [int][Math]::Ceiling(($ended - $started).TotalMilliseconds); providerFaultsInjected = 1
    providerFailuresObserved = 1; recoveriesSucceeded = 1; cleanupAttempted = $true; cleanupSucceeded = $true
    postCleanupArtifacts = 0; retainedAuditRows = 0; retainedDurableExecutions = 1
    eventQueueAgeMaxSeconds = $dispatchAge; eventQueueVisibleMax = $dispatchVisible
    eventDeadLetterMax = $deadLetterMax; durableDeadLetterMax = $deadLetterMax
    logErrorMatches = $errorLogs; forbiddenLogMatches = $forbiddenLogs
  }
  $aggregate = Write-OrValidateEvidence -Path $Representative.AggregatePath -Value $aggregate -Validator {
    param($value)
    Assert-ProviderAggregate $value ([string]$Receipt.startedAt)
  }
  $zeroDriftPath = Resolve-PathBelowRoot -Candidate ([string]$Representative.Config.profiles.postRun.zeroDriftResultPath) -AllowedRoot $representativeRoot
  $zeroDrift = [ordered]@{
    profile = "d1_post_run_zero_drift_v1"; checkedAt = $ended.ToUniversalTime().ToString("o"); sourceSha = $SourceSha
    runtimePlanSha256 = $Representative.RuntimePlanSha256; terraformStateSerial = $Representative.StateSerial
    meaningfulChanges = 0; drift = $false
  }
  $zeroDrift = Write-OrValidateEvidence -Path $zeroDriftPath -Value $zeroDrift -Validator {
    param($value)
    Assert-ZeroDriftEvidence $value $Representative
  }
  $Receipt.phase = "verified"; $Receipt.endedAt = [string]$aggregate.endedAt
  $Receipt.aggregatePath = $Representative.AggregatePath; $Receipt.aggregateSha256 = Get-FileSha256 $Representative.AggregatePath
  $Receipt.zeroDriftPath = $zeroDriftPath; $Receipt.zeroDriftSha256 = Get-FileSha256 $zeroDriftPath
  $Receipt.postRunStateVersionId = $postBoundary.StateVersionId
  $Receipt.postRunZeroDriftPlanPath = $postRunZeroDrift.Path
  $Receipt.postRunZeroDriftPlanSha256 = $postRunZeroDrift.Sha256
  return $Receipt
}

$executionName = New-DurableExecutionName $RunId
$representative = Read-RepresentativeConfiguration

if ($Action -ceq "Validate") {
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-d1-provider-failure-validation"; Environment = "development"
    FixtureKind = $fixtureKind; SourceId = $fixtureSourceId; AdapterVersion = $fixtureAdapterVersion
    RunId = $RunId; ExecutionName = $executionName; ConfigSha256 = $ReviewedConfigSha256
    ReleaseSourceSha = $SourceSha; ExternalAccess = $false; MutationPerformed = $false; Valid = $true
  } | ConvertTo-Json -Depth 5
  exit 0
}

$null = Assert-Caller
$allowVerifier = $Action -ceq "Verify"
$null = Assert-SourceProvenance -AllowVerifierOnlyDelta:$allowVerifier
$reviewedZeroDrift = Assert-ReviewedZeroDriftPlan $representative
$representative | Add-Member NoteProperty ReviewedPlan $reviewedZeroDrift.Plan
$snapshot = Read-StateSnapshot
$boundary = Assert-StateBoundary $snapshot $representative
$requireNoExecution = $Action -in @("Plan", "Execute")
$null = Assert-LiveBoundary -StateBoundary $boundary -ExecutionName $executionName -RequireNoExecution:$requireNoExecution

if ($Action -ceq "Plan") {
  $freshZeroDrift = Invoke-FreshZeroDriftPlan $reviewedZeroDrift.Plan "pre-run"
  $plan = New-ExecutionPlan $representative $boundary $executionName $freshZeroDrift
  $path = if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) {
    Join-Path $operatorRoot "plan-$RunId.json"
  } else { Resolve-PathBelowRoot -Candidate $ExecutionPlanPath -AllowedRoot $operatorRoot }
  Write-JsonFile -Path $path -Value $plan
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-d1-provider-failure-plan-result"; PlanPath = $path
    PlanSha256 = Get-FileSha256 $path; RunId = $RunId; ExecutionName = $executionName
    DurableVersion = $ExpectedDurableVersion; ActivityVersion = $ExpectedActivityVersion
    GatesPassed = $true; ExistingExecutionCount = 0; MutationPerformed = $false
  } | ConvertTo-Json -Depth 5
  exit 0
}

$planEvidence = Read-ExecutionPlan -Representative $representative -Boundary $boundary -RequireFresh:($Action -ceq "Execute")

if ($Action -ceq "Execute") {
  $resolvedReceipt = if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    Join-Path $operatorRoot "receipt-$ReviewedExecutionPlanSha256.json"
  } else { Resolve-PathBelowRoot -Candidate $ReceiptPath -AllowedRoot $operatorRoot }
  $startedAt = [DateTimeOffset]::UtcNow.ToString("o")
  $receipt = New-Receipt $executionName $ReviewedExecutionPlanSha256 $startedAt
  Write-JsonFile -Path $resolvedReceipt -Value $receipt
  try {
    $receipt.durableExecutionArn = Invoke-ExactDurableExecution -Boundary $boundary -Payload (New-WorkflowPayload) -ExecutionName $executionName
    $receipt.phase = "running"
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $receipt = Complete-Evidence -Receipt $receipt -Representative $representative -Boundary $boundary
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
  } catch {
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw
  }
  [pscustomobject]@{
    SchemaVersion = 1; Kind = "development-d1-provider-failure-execution-result"; ReceiptPath = $resolvedReceipt
    ReceiptSha256 = Get-FileSha256 $resolvedReceipt; AggregatePath = $receipt.aggregatePath
    AggregateSha256 = $receipt.aggregateSha256; ZeroDriftPath = $receipt.zeroDriftPath
    ZeroDriftSha256 = $receipt.zeroDriftSha256; RunId = $RunId; ExecutionName = $executionName
    DurableExecutionsStarted = 1; Verified = $true
  } | ConvertTo-Json -Depth 5
  exit 0
}

$resolvedReceipt = Resolve-PathBelowRoot -Candidate $ReceiptPath -AllowedRoot $operatorRoot -MustExist
if ((Get-FileSha256 $resolvedReceipt) -cne $ReviewedReceiptSha256) { throw "The receipt checksum does not match the reviewed SHA-256." }
$receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $resolvedReceipt -Raw) "Acceptance receipt"
$null = Assert-Receipt $receipt $representative $boundary
if ([string]$receipt.phase -cne "verified") {
  $receipt = Complete-Evidence -Receipt $receipt -Representative $representative -Boundary $boundary
  Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
}
$null = Assert-Receipt $receipt $representative $boundary
if ((Get-FileSha256 $receipt.aggregatePath) -cne [string]$receipt.aggregateSha256 -or
  (Get-FileSha256 $receipt.zeroDriftPath) -cne [string]$receipt.zeroDriftSha256) {
  throw "The verified receipt evidence checksum changed."
}
[pscustomobject]@{
  SchemaVersion = 1; Kind = "development-d1-provider-failure-verification-result"; ReceiptPath = $resolvedReceipt
  ReceiptSha256 = Get-FileSha256 $resolvedReceipt; AggregateSha256 = $receipt.aggregateSha256
  ZeroDriftSha256 = $receipt.zeroDriftSha256; RunId = $RunId; ExecutionName = $executionName
  DurableExecutionsStarted = 0; Verified = $true
} | ConvertTo-Json -Depth 5
