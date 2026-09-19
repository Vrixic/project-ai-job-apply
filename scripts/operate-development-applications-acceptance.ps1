[CmdletBinding()]
param(
  [ValidateSet("Status", "Plan", "Execute", "RecoverCleanup", "Verify")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",

  [string]$MigrationReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedMigrationReceiptSha256 = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ExpectedGatewayArtifactSha256 = "",

  [ValidateRange(1, 2147483647)]
  [int]$ExpectedGatewayVersion = 0,

  [string]$RunId = "",
  [string]$ExecutionPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedExecutionPlanSha256 = "",

  [string]$ReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedReceiptSha256 = "",

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-applications-acceptance.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-applications-acceptance.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath receipt-SOURCE.json `
    -ReviewedMigrationReceiptSha256 SHA256 `
    -ExpectedGatewayArtifactSha256 SHA256 `
    -ExpectedGatewayVersion NUMERIC_ALIAS_VERSION

  .\scripts\operate-development-applications-acceptance.ps1 -Action Execute `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath PATH -ReviewedMigrationReceiptSha256 SHA256 `
    -ExpectedGatewayArtifactSha256 SHA256 -ExpectedGatewayVersion VERSION `
    -ExecutionPlanPath PATH -ReviewedExecutionPlanSha256 SHA256

  .\scripts\operate-development-applications-acceptance.ps1 -Action RecoverCleanup `
    [same inputs as Execute] -ReceiptPath PATH -ReviewedReceiptSha256 SHA256

  .\scripts\operate-development-applications-acceptance.ps1 -Action Verify `
    [same inputs as Execute] -ReceiptPath PATH -ReviewedReceiptSha256 SHA256

Plan is read-only. It selects one existing active catalog job by a read-only search, generates a run
identity, and writes one checksum-reviewable, 15-minute execution descriptor below the ignored
development .terraform directory. Execute is the only normal mutation action. It writes an exclusive
plan-bound claiming receipt, claims the descriptor once, prepares two generated identities (an owner
and a foreign candidate) through a fixed one-task run of the reviewed migration image, drives the full
Applications lifecycle through the exact reviewed Gateway version (missing scope, foreign owner,
idempotent replay, wrong hash, changed form, duplicate start, ambiguous result, candidate attestation,
history), and always attempts exact cleanup of every row it created. RecoverCleanup may only consume a
reviewed receipt and submit the descriptor's fixed cleanup request. Verify is read-only. No action
accepts SQL, a container name, command, environment name, job value, candidate value, or gateway
payload from the caller.

This is a generated-synthetic development acceptance path. The catalog job is only referenced, never
changed. No provider adapter exists and no live application effect is possible; the submitted state is
reached only by a generated candidate attestation. It does not use a real OIDC token or browser, does
not authorize real candidate data, and is not accountable security/privacy approval (D3-012).
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development Applications acceptance is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development\.terraform"))
$migrationReceiptRoot = Join-Path $terraformRoot "development-migration-image"
$operatorRoot = Join-Path $terraformRoot "development-applications-acceptance"
$stateKey = "platform.tfstate"
$containerName = "database-migration"
$migrationFamily = "ai-job-apply-development-database-migration"
$gatewayFunctionName = "ai-job-apply-development-gateway"
$gatewayAliasName = "development"
$applicationLogGroup = "/ai-job-apply/development/application"
$acceptanceCommand = @("applications/dist/src/run-lifecycle-acceptance.js")
$confirmation = "generated-synthetic-applications-acceptance"
$planKind = "development-applications-lifecycle-acceptance"
$claimKind = "development-applications-acceptance-claim"
$expectedCaseCount = 24
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Test-OptionalCollectionEmpty {
  param(
    [AllowNull()][object]$Object,
    [Parameter(Mandatory)][string]$Name
  )

  $value = Get-OptionalProperty -Object $Object -Name $Name
  return $null -eq $value -or @($value).Count -eq 0
}

function Get-OptionalCollection {
  param(
    [AllowNull()][object]$Object,
    [Parameter(Mandatory)][string]$Name
  )

  $value = Get-OptionalProperty -Object $Object -Name $Name
  if ($null -ne $value) { return @($value) }
}

function Test-EcsFaultInjectionDisabled {
  param([Parameter(Mandatory)][object]$TaskDefinition)

  $property = $TaskDefinition.PSObject.Properties["enableFaultInjection"]
  if ($null -eq $property) { return $true }
  return ($property.Value -is [bool] -and $property.Value -eq $false)
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FileSha256Base64 {
  param([Parameter(Mandatory)][string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToBase64String($algorithm.ComputeHash([IO.File]::ReadAllBytes($Path))) }
  finally { $algorithm.Dispose() }
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function ConvertFrom-AcceptanceJson {
  param(
    [Parameter(Mandatory, ValueFromPipeline)][string]$Json,
    [Parameter(Mandatory)][string]$Description
  )
  process {
    try {
      $command = Get-Command ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop
      if ($command.Parameters.ContainsKey("DateKind")) {
        return $Json | ConvertFrom-Json -DateKind String
      }
      return $Json | ConvertFrom-Json
    } catch {
      throw "$Description is invalid JSON."
    }
  }
}

function Assert-ExactPropertySet {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string[]]$ExpectedNames,
    [Parameter(Mandatory)][string]$Description
  )
  $actual = if ($Value -is [System.Collections.IDictionary]) {
    @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  } else {
    @($Value.PSObject.Properties.Name | Sort-Object)
  }
  $expected = @($ExpectedNames | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
  return $true
}

function Test-CanonicalUtcTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string]) { return $false }
  $parsed = [DateTimeOffset]::MinValue
  $valid = [DateTimeOffset]::TryParseExact(
    [string]$Value, "o", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed
  )
  return $valid -and $parsed.Offset -eq [TimeSpan]::Zero -and [string]$Value -ceq $parsed.ToString("o")
}

function Resolve-PathBelowRoot {
  param(
    [Parameter(Mandatory)][string]$Candidate,
    [Parameter(Mandatory)][string]$AllowedRoot,
    [switch]$MustExist
  )
  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) {
    [IO.Path]::GetFullPath($Candidate)
  } else {
    [IO.Path]::GetFullPath((Join-Path $root $Candidate))
  }
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The evidence path must stay below its exact ignored operator directory."
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
  return ConvertFrom-AcceptanceJson -Json ($raw -join "`n") -Description "$Operation response"
}

function Assert-CallerAndSource {
  param([switch]$RequireSource)
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
  $identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--output", "json") -Operation "AWS caller validation"
  if ([string]$identity.Account -cne $ExpectedAccountId -or -not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use a temporary assumed-role caller in the exact development account."
  }
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($RequireSource -and ($branch -cne "main" -or $head -cne $upstream -or $dirty.Count -ne 0 -or $SourceSha -cne $head)) {
    throw "Acceptance requires a clean main checkout exactly matching origin/main and SourceSha."
  }
  return [pscustomobject]@{ Account = [string]$identity.Account; Arn = [string]$identity.Arn; Head = $head }
}

function Read-StateSnapshot {
  $versioning = Invoke-AwsJson -Arguments @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") -Operation "State versioning validation"
  $publicAccess = Invoke-AwsJson -Arguments @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") -Operation "State public-access validation"
  $encryption = Invoke-AwsJson -Arguments @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") -Operation "State encryption validation"
  $block = $publicAccess.PublicAccessBlockConfiguration
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and
      $_.BucketKeyEnabled -and [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -match "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/"
    })
  if ([string]$versioning.Status -cne "Enabled" -or
      -not ($block.BlockPublicAcls -is [bool] -and $block.BlockPublicAcls -eq $true -and
        $block.IgnorePublicAcls -is [bool] -and $block.IgnorePublicAcls -eq $true -and
        $block.BlockPublicPolicy -is [bool] -and $block.BlockPublicPolicy -eq $true -and
        $block.RestrictPublicBuckets -is [bool] -and $block.RestrictPublicBuckets -eq $true) -or
      $rules.Count -ne 1) {
    throw "The state bucket is not the exact versioned, private, customer-KMS, bucket-key boundary."
  }
  $head = Invoke-AwsJson -Arguments @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") -Operation "State object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -or
      -not $head.BucketKeyEnabled -or [string]::IsNullOrWhiteSpace([string]$head.VersionId)) {
    throw "The current Terraform state object is outside the exact encrypted boundary."
  }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $download = Invoke-AwsJson -Arguments @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) -Operation "Versioned state read"
    if ([string]$download.VersionId -cne [string]$head.VersionId) { throw "The state version changed during its exact read." }
    $state = ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $temporary -Raw) -Description "The versioned Terraform state"
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
  Assert-DeploymentTerraformStateVersion -Version ([string]$state.terraform_version)
  if ([string]$state.lineage -notmatch '^[0-9a-f-]{36}$' -or [long]$state.serial -lt 1) {
    throw "The encrypted state identity is incomplete or uses an unexpected Terraform version."
  }
  return [pscustomobject]@{
    State = $state; VersionId = [string]$head.VersionId; Lineage = [string]$state.lineage; Serial = [long]$state.serial
    KmsKeyArn = [string]$head.SSEKMSKeyId
  }
}

function Get-StateOutput {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Name)
  $property = $Snapshot.State.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) { throw "The encrypted state is missing the required $Name output." }
  return $property.Value.value
}

function Read-MigrationReceipt {
  $path = Resolve-PathBelowRoot -Candidate $MigrationReceiptPath -AllowedRoot $migrationReceiptRoot -MustExist
  if ((Get-FileSha256 -Path $path) -cne $ReviewedMigrationReceiptSha256) { throw "The migration receipt checksum does not match the reviewed value." }
  $receipt = ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $path -Raw) -Description "The migration receipt"
  $null = Assert-ExactPropertySet -Value $receipt -Description "The migration receipt" -ExpectedNames @(
    "schemaVersion", "kind", "environment", "region", "sourceSha", "boundarySha256", "repositoryName", "repositoryUri",
    "sourceTag", "handoffTag", "platform", "created", "indexDigest", "platformDigest", "configDigest",
    "compressedLayerSetSha256", "rootfsDiffIdSetSha256", "phase", "imageUri", "scanStatus", "criticalFindings",
    "highFindings", "publicationStartedAt", "publicationCompletedAt"
  )
  $repositoryUri = "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration"
  if ([int]$receipt.schemaVersion -ne 2 -or [string]$receipt.kind -cne "development-migration-image-publication" -or
      [string]$receipt.environment -cne "development" -or [string]$receipt.region -cne $Region -or [string]$receipt.sourceSha -cne $SourceSha -or
      [string]$receipt.boundarySha256 -notmatch '^[a-f0-9]{64}$' -or [string]$receipt.repositoryName -cne "ai-job-apply/migration" -or
      [string]$receipt.repositoryUri -cne $repositoryUri -or [string]$receipt.sourceTag -cne $SourceSha -or
      [string]$receipt.handoffTag -cne "$SourceSha-linux-amd64" -or [string]$receipt.platform -cne "linux/amd64" -or
      [string]$receipt.created -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' -or
      [string]$receipt.platformDigest -notmatch '^sha256:[a-f0-9]{64}$' -or [string]$receipt.indexDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$receipt.configDigest -notmatch '^sha256:[a-f0-9]{64}$' -or [string]$receipt.compressedLayerSetSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$receipt.rootfsDiffIdSetSha256 -notmatch '^[a-f0-9]{64}$' -or [string]$receipt.imageUri -cne "$repositoryUri@$($receipt.platformDigest)" -or
      [string]$receipt.phase -cne "verified" -or [string]$receipt.scanStatus -cne "COMPLETE" -or
      [int]$receipt.criticalFindings -ne 0 -or [int]$receipt.highFindings -ne 0 -or
      -not (Test-CanonicalUtcTimestamp $receipt.publicationStartedAt) -or -not (Test-CanonicalUtcTimestamp $receipt.publicationCompletedAt)) {
    throw "The migration receipt does not bind the exact verified source, image, platform, and scan."
  }
  $publicationStarted = [DateTimeOffset]::ParseExact(
    [string]$receipt.publicationStartedAt, "o", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind
  )
  $publicationCompleted = [DateTimeOffset]::ParseExact(
    [string]$receipt.publicationCompletedAt, "o", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind
  )
  if ($publicationCompleted -lt $publicationStarted) { throw "The verified migration receipt completion precedes publication." }
  return [pscustomobject]@{ Path = $path; Receipt = $receipt; ImageUri = [string]$receipt.imageUri }
}

function Assert-TaskDefinition {
  param([Parameter(Mandatory)][string]$TaskDefinitionArn, [Parameter(Mandatory)][string]$ExpectedImage)
  $response = Invoke-AwsJson -Arguments @("ecs", "describe-task-definition", "--task-definition", $TaskDefinitionArn, "--output", "json") -Operation "Acceptance task-definition validation"
  $task = $response.taskDefinition
  $containers = @($task.containerDefinitions)
  if ([string]$task.taskDefinitionArn -cne $TaskDefinitionArn -or [string]$task.status -cne "ACTIVE" -or
      [string]$task.family -cne $migrationFamily -or -not (Test-EcsFaultInjectionDisabled -TaskDefinition $task) -or
      [string]$task.networkMode -cne "awsvpc" -or [string]$task.cpu -cne "256" -or [string]$task.memory -cne "512" -or
      @($task.requiresCompatibilities).Count -ne 1 -or [string]@($task.requiresCompatibilities)[0] -cne "FARGATE" -or
      [string]$task.runtimePlatform.cpuArchitecture -cne "X86_64" -or [string]$task.runtimePlatform.operatingSystemFamily -cne "LINUX" -or
      $containers.Count -ne 1 -or @($task.volumes).Count -ne 0 -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "taskRoleArn")) -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "ipcMode")) -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $task "pidMode"))) {
    throw "The on-demand task definition is outside the exact one-container Fargate boundary."
  }
  $container = $containers[0]
  $environment = @($container.environment)
  $secrets = @($container.secrets)
  if ([string]$container.name -cne $containerName -or [string]$container.image -cne $ExpectedImage -or -not $container.essential -or
      -not $container.readonlyRootFilesystem -or (@($container.command) -join "|") -cne "runner/dist/src/main.js" -or
      $environment.Count -ne 1 -or [string]$environment[0].name -cne "NODE_ENV" -or [string]$environment[0].value -cne "production" -or
      $secrets.Count -ne 1 -or [string]$secrets[0].name -cne "DATABASE_URL" -or [string]$secrets[0].valueFrom -notmatch "^arn:aws:secretsmanager:$([regex]::Escape($Region)):$ExpectedAccountId`:secret:" -or
      [string]$container.logConfiguration.logDriver -cne "awslogs" -or [string]$container.logConfiguration.options.'awslogs-group' -cne $applicationLogGroup -or
      [string]$container.logConfiguration.options.'awslogs-region' -cne $Region -or [string]$container.logConfiguration.options.'awslogs-stream-prefix' -cne "database-migration" -or
      -not (Test-OptionalCollectionEmpty -Object $container -Name "portMappings") -or
      -not (Test-OptionalCollectionEmpty -Object $container -Name "mountPoints") -or
      -not (Test-OptionalCollectionEmpty -Object $container -Name "volumesFrom") -or
      -not (Test-OptionalCollectionEmpty -Object $container -Name "systemControls") -or
      -not (Test-OptionalCollectionEmpty -Object $container -Name "resourceRequirements")) {
    throw "The database task container does not match the fixed immutable acceptance runtime."
  }
  return $task
}

function Assert-ZeroActiveTasks {
  param([Parameter(Mandatory)][string]$ClusterArn)
  $active = @()
  foreach ($status in @("RUNNING", "PENDING")) {
    $result = Invoke-AwsJson -Arguments @("ecs", "list-tasks", "--cluster", $ClusterArn, "--family", $migrationFamily, "--desired-status", $status, "--output", "json") -Operation "Active acceptance task validation"
    $active += @(Get-OptionalCollection -Object $result -Name "taskArns")
  }
  if ($active.Count -ne 0) { throw "Another database task is active; acceptance requires exclusive use of the one-off runtime." }
}

function Read-GatewayBoundary {
  $alias = Invoke-AwsJson -Arguments @("lambda", "get-alias", "--function-name", $gatewayFunctionName, "--name", $gatewayAliasName, "--output", "json") -Operation "Gateway alias validation"
  $routing = Get-OptionalProperty $alias "RoutingConfig"
  $additionalWeightCount = 0
  if ($null -ne $routing) {
    $null = Assert-ExactPropertySet -Value $routing -Description "The gateway alias routing configuration" -ExpectedNames @("AdditionalVersionWeights")
    $weights = Get-OptionalProperty $routing "AdditionalVersionWeights"
    if ($null -eq $weights) { throw "The gateway alias contains an invalid routing configuration." }
    $additionalWeightCount = @($weights.PSObject.Properties).Count
  }
  if ([string]$alias.FunctionVersion -cnotmatch '^[1-9][0-9]*$' -or [int]$alias.FunctionVersion -ne $ExpectedGatewayVersion -or
      $additionalWeightCount -ne 0) {
    throw "The gateway alias is not the exact reviewed immutable version without routing weights."
  }
  $configuration = Invoke-AwsJson -Arguments @("lambda", "get-function-configuration", "--function-name", $gatewayFunctionName, "--qualifier", [string]$alias.FunctionVersion, "--output", "json") -Operation "Gateway function validation"
  $release = Get-OptionalProperty $configuration.Environment.Variables "RELEASE_SHA"
  if ([string]$configuration.Version -cne [string]$alias.FunctionVersion -or [string]$configuration.State -cne "Active" -or
      [string]$configuration.LastUpdateStatus -cne "Successful" -or [string]$release -cne $ExpectedGatewayArtifactSha256 -or
      [string]$configuration.CodeSha256 -notmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The gateway version does not match the exact healthy reviewed artifact."
  }
  return [pscustomobject]@{
    FunctionName = $gatewayFunctionName; AliasName = $gatewayAliasName; Version = [string]$alias.FunctionVersion
    ArtifactSha256 = [string]$release; CodeSha256 = [string]$configuration.CodeSha256
    Issuer = [string](Get-OptionalProperty $configuration.Environment.Variables "OIDC_ISSUER")
    Audience = [string](Get-OptionalProperty $configuration.Environment.Variables "OIDC_AUDIENCE")
  }
}

function Get-ExactRuntime {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$ExpectedImage)
  $clusterArn = [string](Get-StateOutput -Snapshot $Snapshot -Name "ecs_cluster_arn")
  $taskDefinitionArn = [string](Get-StateOutput -Snapshot $Snapshot -Name "migration_task_definition_arn")
  $subnets = @((Get-StateOutput -Snapshot $Snapshot -Name "migration_subnet_ids") | ForEach-Object { [string]$_ } | Sort-Object)
  $securityGroup = [string](Get-StateOutput -Snapshot $Snapshot -Name "application_security_group_id")
  if ($clusterArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:cluster/" -or
      $taskDefinitionArn -notmatch "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task-definition/$([regex]::Escape($migrationFamily)):[1-9][0-9]*$" -or
      $subnets.Count -ne 2 -or @($subnets | Where-Object { $_ -notmatch '^subnet-[a-f0-9]+$' }).Count -ne 0 -or $securityGroup -notmatch '^sg-[a-f0-9]+$') {
    throw "The encrypted state does not expose the exact acceptance runtime network."
  }
  $task = Assert-TaskDefinition -TaskDefinitionArn $taskDefinitionArn -ExpectedImage $ExpectedImage
  Assert-ZeroActiveTasks -ClusterArn $clusterArn
  return [pscustomobject]@{
    ClusterArn = $clusterArn; TaskDefinitionArn = $taskDefinitionArn; Subnets = $subnets; SecurityGroup = $securityGroup
    Image = $ExpectedImage; LogStreamPrefix = [string]@($task.containerDefinitions)[0].logConfiguration.options.'awslogs-stream-prefix'
  }
}

function Assert-PlanFresh {
  param([Parameter(Mandatory)][string]$At, [switch]$RequireFresh)
  if ($At -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw "The acceptance descriptor timestamp is not exact UTC milliseconds." }
  $parsed = [DateTime]::ParseExact($At, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
  if ($RequireFresh -and [Math]::Abs(([DateTime]::UtcNow - $parsed).TotalMinutes) -gt 15) {
    throw "The acceptance descriptor is outside its 15-minute execution window; create and review a fresh plan."
  }
}

function Submit-AcceptanceTask {
  param([Parameter(Mandatory)][object]$Request)
  Assert-ZeroActiveTasks -ClusterArn ([string]$Request.cluster)
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporary -Value $Request -AllowReplace
    $run = Invoke-AwsJson -Arguments @("ecs", "run-task", "--cli-input-json", "file://$temporary", "--output", "json") -Operation "Synthetic acceptance task submission"
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  $failures = @(Get-OptionalCollection -Object $run -Name "failures")
  $tasks = @(Get-OptionalCollection -Object $run -Name "tasks")
  if ($failures.Count -ne 0 -or $tasks.Count -ne 1) { throw "ECS did not accept exactly one synthetic acceptance task." }
  return [string]$tasks[0].taskArn
}

function ConvertTo-ReviewedTaskOverrides {
  param([Parameter(Mandatory)][object]$Overrides)

  $normalized = ConvertFrom-AcceptanceJson `
    -Json (ConvertTo-Json $Overrides -Depth 30 -Compress) `
    -Description "ECS task override readback"
  if ($normalized.PSObject.Properties.Name -contains "inferenceAcceleratorOverrides") {
    if (@($normalized.inferenceAcceleratorOverrides).Count -ne 0) {
      throw "ECS returned an unreviewed inference accelerator override."
    }
    # ECS adds this empty optional collection to describe-tasks responses even
    # when it was omitted from the submitted and reviewed request.
    $normalized.PSObject.Properties.Remove("inferenceAcceleratorOverrides")
  }
  return $normalized
}

function New-UuidV7 {
  $bytes = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $milliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  for ($index = 0; $index -lt 6; $index++) {
    $bytes[$index] = [byte](($milliseconds -shr (8 * (5 - $index))) -band 0xFF)
  }
  $bytes[6] = [byte](($bytes[6] -band 0x0F) -bor 0x70)
  $bytes[8] = [byte](($bytes[8] -band 0x3F) -bor 0x80)
  $hex = (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
  return "$($hex.Substring(0, 8))-$($hex.Substring(8, 4))-$($hex.Substring(12, 4))-$($hex.Substring(16, 4))-$($hex.Substring(20, 12))"
}

function New-AcceptanceEnvironment {
  param(
    [Parameter(Mandatory)][ValidateSet("prepare", "cleanup")][string]$Phase,
    [Parameter(Mandatory)][object]$Identity,
    [string]$At
  )
  $values = @(
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_CONFIRMATION"; value = $confirmation },
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_ACTION"; value = $Phase },
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_RUN_ID"; value = [string]$Identity.RunId },
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_ISSUER"; value = [string]$Identity.Issuer },
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_OWNER_USER_ID"; value = [string]$Identity.OwnerUserId },
    [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_OTHER_USER_ID"; value = [string]$Identity.OtherUserId }
  )
  if ($Phase -ceq "prepare") { $values += [ordered]@{ name = "APPLICATIONS_ACCEPTANCE_AT"; value = $At } }
  return @($values)
}

function New-RunTaskRequest {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][ValidateSet("prepare", "cleanup")][string]$Phase,
    [Parameter(Mandatory)][object]$Identity,
    [Parameter(Mandatory)][string]$At,
    [Parameter(Mandatory)][string]$ClientToken,
    [Parameter(Mandatory)][string]$StartedBy
  )
  return [ordered]@{
    cluster = [string]$Runtime.ClusterArn; taskDefinition = [string]$Runtime.TaskDefinitionArn; count = 1; launchType = "FARGATE"
    networkConfiguration = [ordered]@{ awsvpcConfiguration = [ordered]@{
        subnets = @($Runtime.Subnets); securityGroups = @([string]$Runtime.SecurityGroup); assignPublicIp = "ENABLED"
      } }
    overrides = [ordered]@{ containerOverrides = @([ordered]@{
          name = $containerName; command = @($acceptanceCommand); environment = @(New-AcceptanceEnvironment -Phase $Phase -Identity $Identity -At $At)
        }) }
    clientToken = $ClientToken; startedBy = $StartedBy
  }
}

function Assert-RunTaskRequest {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][ValidateSet("prepare", "cleanup")][string]$Phase,
    [Parameter(Mandatory)][object]$Identity,
    [Parameter(Mandatory)][string]$At
  )
  $null = Assert-ExactPropertySet -Value $Request -Description "The $Phase run-task request" -ExpectedNames @(
    "cluster", "taskDefinition", "count", "launchType", "networkConfiguration", "overrides", "clientToken", "startedBy"
  )
  $null = Assert-ExactPropertySet -Value $Request.networkConfiguration -Description "The $Phase network configuration" -ExpectedNames @("awsvpcConfiguration")
  $null = Assert-ExactPropertySet -Value $Request.networkConfiguration.awsvpcConfiguration -Description "The $Phase awsvpc configuration" -ExpectedNames @(
    "subnets", "securityGroups", "assignPublicIp"
  )
  $null = Assert-ExactPropertySet -Value $Request.overrides -Description "The $Phase task overrides" -ExpectedNames @("containerOverrides")
  $overrides = @($Request.overrides.containerOverrides)
  if ($overrides.Count -ne 1) { throw "The $Phase request must contain exactly one container override." }
  $null = Assert-ExactPropertySet -Value $overrides[0] -Description "The $Phase container override" -ExpectedNames @("name", "command", "environment")
  foreach ($entry in @($overrides[0].environment)) {
    $null = Assert-ExactPropertySet -Value $entry -Description "The $Phase acceptance environment entry" -ExpectedNames @("name", "value")
  }
  $expectedEnvironment = @(New-AcceptanceEnvironment -Phase $Phase -Identity $Identity -At $At)
  if ([string]$Request.cluster -cne [string]$Runtime.ClusterArn -or [string]$Request.taskDefinition -cne [string]$Runtime.TaskDefinitionArn -or
      [int]$Request.count -ne 1 -or [string]$Request.launchType -cne "FARGATE" -or
      (@($Request.networkConfiguration.awsvpcConfiguration.subnets) -join "|") -cne (@($Runtime.Subnets) -join "|") -or
      @($Request.networkConfiguration.awsvpcConfiguration.securityGroups).Count -ne 1 -or
      [string]@($Request.networkConfiguration.awsvpcConfiguration.securityGroups)[0] -cne [string]$Runtime.SecurityGroup -or
      [string]$Request.networkConfiguration.awsvpcConfiguration.assignPublicIp -cne "ENABLED" -or
      [string]$Request.clientToken -notmatch "^d3-apps-$Phase-[a-f0-9]{32}$" -or [string]$Request.startedBy -notmatch '^d3-apps-[a-f0-9]{12}$' -or
      [string]$overrides[0].name -cne $containerName -or
      (@($overrides[0].command) -join "|") -cne ($acceptanceCommand -join "|") -or
      (ConvertTo-DeploymentCanonicalValue -Value @($overrides[0].environment)) -cne (ConvertTo-DeploymentCanonicalValue -Value $expectedEnvironment)) {
    throw "The $Phase request is not the exact fixed one-task acceptance override."
  }
  return $true
}

function Read-ExecutionPlan {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Sha256,
    [Parameter(Mandatory)][object]$Snapshot,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$Gateway,
    [switch]$RequireFresh
  )
  $resolved = Resolve-PathBelowRoot -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  if ((Get-FileSha256 -Path $resolved) -cne $Sha256) { throw "The acceptance plan checksum does not match the reviewed value." }
  $plan = ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $resolved -Raw) -Description "The acceptance plan"
  $null = Assert-ExactPropertySet -Value $plan -Description "The acceptance execution plan" -ExpectedNames @(
    "schemaVersion", "kind", "environment", "region", "accountId", "stateBucket", "stateKey", "stateLineage", "stateSerial", "stateVersionId",
    "sourceSha", "migrationReceiptPath", "migrationReceiptSha256", "migrationImage", "gateway", "runId", "issuer", "ownerUserId", "otherUserId",
    "jobId", "prepareAt", "createdAt", "runtime", "requests"
  )
  $null = Assert-ExactPropertySet -Value $plan.gateway -Description "The acceptance gateway binding" -ExpectedNames @(
    "functionName", "aliasName", "version", "artifactSha256", "codeSha256", "audience"
  )
  $null = Assert-ExactPropertySet -Value $plan.runtime -Description "The acceptance runtime binding" -ExpectedNames @(
    "clusterArn", "taskDefinitionArn", "subnets", "securityGroup"
  )
  $uuidV7 = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  if ([int]$plan.schemaVersion -ne 1 -or [string]$plan.kind -cne $planKind -or
      [string]$plan.environment -cne "development" -or [string]$plan.region -cne $Region -or [string]$plan.accountId -cne $ExpectedAccountId -or
      [string]$plan.stateBucket -cne $StateBucket -or [string]$plan.stateKey -cne $stateKey -or [string]$plan.stateLineage -cne [string]$Snapshot.Lineage -or
      [long]$plan.stateSerial -ne [long]$Snapshot.Serial -or [string]$plan.stateVersionId -cne [string]$Snapshot.VersionId -or [string]$plan.sourceSha -cne $SourceSha -or
      [string]$plan.migrationReceiptPath -cne [string]$Receipt.Path -or [string]$plan.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or
      [string]$plan.migrationImage -cne [string]$Receipt.ImageUri -or [string]$plan.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      [string]$plan.issuer -cne [string]$Gateway.Issuer -or [string]$plan.ownerUserId -notmatch $uuidV7 -or [string]$plan.otherUserId -notmatch $uuidV7 -or
      [string]$plan.ownerUserId -ceq [string]$plan.otherUserId -or [string]$plan.jobId -notmatch $uuidV7 -or
      [string]$plan.gateway.functionName -cne [string]$Gateway.FunctionName -or [string]$plan.gateway.aliasName -cne [string]$Gateway.AliasName -or
      [string]$plan.gateway.version -cne [string]$Gateway.Version -or [string]$plan.gateway.artifactSha256 -cne [string]$Gateway.ArtifactSha256 -or
      [string]$plan.gateway.codeSha256 -cne [string]$Gateway.CodeSha256 -or [string]$plan.gateway.audience -cne [string]$Gateway.Audience -or
      -not (Test-CanonicalUtcTimestamp $plan.createdAt)) {
    throw "The acceptance plan no longer matches the exact source, state, image, gateway, and run identity."
  }
  Assert-PlanFresh -At ([string]$plan.prepareAt) -RequireFresh:$RequireFresh
  $runtime = [pscustomobject]@{
    ClusterArn = [string]$plan.runtime.clusterArn; TaskDefinitionArn = [string]$plan.runtime.taskDefinitionArn
    Subnets = @($plan.runtime.subnets); SecurityGroup = [string]$plan.runtime.securityGroup; Image = [string]$plan.migrationImage
  }
  $currentRuntime = Get-ExactRuntime -Snapshot $Snapshot -ExpectedImage ([string]$Receipt.ImageUri)
  if ((ConvertTo-DeploymentCanonicalValue -Value $runtime) -cne (ConvertTo-DeploymentCanonicalValue -Value ([pscustomobject]@{
        ClusterArn = $currentRuntime.ClusterArn; TaskDefinitionArn = $currentRuntime.TaskDefinitionArn; Subnets = @($currentRuntime.Subnets)
        SecurityGroup = $currentRuntime.SecurityGroup; Image = $currentRuntime.Image
      }))) { throw "The acceptance plan runtime no longer matches the encrypted state and task definition." }
  $identity = [pscustomobject]@{
    RunId = [string]$plan.runId; Issuer = [string]$plan.issuer; OwnerUserId = [string]$plan.ownerUserId; OtherUserId = [string]$plan.otherUserId
  }
  $requests = @($plan.requests)
  if ($requests.Count -ne 2 -or (@($requests | ForEach-Object { [string]$_.phase }) -join "|") -cne "prepare|cleanup") {
    throw "The acceptance plan must contain exactly the ordered prepare and cleanup requests."
  }
  foreach ($entry in $requests) {
    $null = Assert-ExactPropertySet -Value $entry -Description "The acceptance request entry" -ExpectedNames @("phase", "request")
    $null = Assert-RunTaskRequest -Request $entry.request -Runtime $runtime -Phase ([string]$entry.phase) -Identity $identity -At ([string]$plan.prepareAt)
  }
  return [pscustomobject]@{ Path = $resolved; Plan = $plan; Runtime = $runtime }
}

function Invoke-AppsGateway {
  param(
    [Parameter(Mandatory)][object]$Gateway,
    [Parameter(Mandatory)][string]$Subject,
    [Parameter(Mandatory)][string[]]$Scopes,
    [Parameter(Mandatory)][ValidateSet("GET", "POST")][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$CaseName,
    [AllowNull()][object]$Body = $null,
    [string]$IdempotencyKey = ""
  )
  if ([string]::IsNullOrWhiteSpace([string]$Gateway.Issuer) -or [string]::IsNullOrWhiteSpace([string]$Gateway.Audience)) {
    throw "The gateway does not expose the exact OIDC issuer and audience required for validated synthetic context."
  }
  $claims = [ordered]@{ iss = [string]$Gateway.Issuer; sub = $Subject; aud = @([string]$Gateway.Audience); scope = ($Scopes -join " ") }
  $headers = [ordered]@{ authorization = "Bearer validated-synthetic-context" }
  if ($null -ne $Body) { $headers["content-type"] = "application/json" }
  if (-not [string]::IsNullOrEmpty($IdempotencyKey)) { $headers["idempotency-key"] = $IdempotencyKey }
  $event = [ordered]@{
    version = "2.0"; routeKey = "$Method $Path"; rawPath = $Path; rawQueryString = ""; headers = $headers
    requestContext = [ordered]@{
      accountId = "synthetic-acceptance"; apiId = "synthetic-acceptance"; domainName = "127.0.0.1"; domainPrefix = "synthetic-acceptance"
      http = [ordered]@{ method = $Method; path = $Path; protocol = "HTTP/1.1"; sourceIp = "127.0.0.1"; userAgent = "applydash-applications-acceptance" }
      requestId = "d3-apps-$CaseName-$([guid]::NewGuid().ToString('N').Substring(0, 12))"; routeKey = "$Method $Path"; stage = '$default'
      time = [DateTime]::UtcNow.ToString("o"); timeEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      authorizer = [ordered]@{ jwt = [ordered]@{ claims = $claims; scopes = @($Scopes) } }
    }
    isBase64Encoded = $false
  }
  if ($null -ne $Body) { $event["body"] = ($Body | ConvertTo-Json -Compress -Depth 10) }
  $temporaryInput = [IO.Path]::GetTempFileName()
  $temporaryOutput = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($temporaryInput, ($event | ConvertTo-Json -Depth 16 -Compress), $utf8WithoutBom)
    $metadata = Invoke-AwsJson -Arguments @("lambda", "invoke", "--function-name", [string]$Gateway.FunctionName, "--qualifier", [string]$Gateway.AliasName,
      "--cli-binary-format", "raw-in-base64-out", "--payload", "fileb://$temporaryInput", "--output", "json", $temporaryOutput) -Operation "The $CaseName gateway invocation"
    if ($null -ne (Get-OptionalProperty $metadata "FunctionError") -or [string]$metadata.ExecutedVersion -cne [string]$Gateway.Version) {
      throw "The $CaseName invocation did not execute the exact reviewed gateway version cleanly."
    }
    return ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $temporaryOutput -Raw) -Description "The $CaseName gateway response"
  } finally {
    foreach ($path in @($temporaryInput, $temporaryOutput)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  }
}

$script:caseLog = [Collections.Generic.List[string]]::new()

function Assert-Step {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][object]$Response,
    [Parameter(Mandatory)][int]$ExpectedStatus,
    [string]$ExpectedCode = ""
  )
  if ([int]$Response.statusCode -ne $ExpectedStatus) { throw "Lifecycle step '$Name' returned an unexpected status." }
  $contentType = ([string](Get-OptionalProperty $Response.headers "content-type")).Split(';', 2)[0].Trim()
  $expectedType = if ($ExpectedStatus -ge 400) { "application/problem+json" } else { "application/json" }
  if ($contentType -cne $expectedType) { throw "Lifecycle step '$Name' returned an unexpected content type." }
  $body = ConvertFrom-AcceptanceJson -Json ([string]$Response.body) -Description "The $Name response"
  if (-not [string]::IsNullOrEmpty($ExpectedCode) -and [string](Get-OptionalProperty $body "code") -cne $ExpectedCode) {
    throw "Lifecycle step '$Name' did not carry the exact stable problem code."
  }
  $script:caseLog.Add("$($Name):$([int]$Response.statusCode)")
  return $body
}

function Get-StepValue {
  param([Parameter(Mandatory)][object]$Body, [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Step)
  $value = Get-OptionalProperty $Body $Name
  if ($null -eq $value) { throw "Lifecycle step '$Step' is missing its required '$Name' result." }
  return $value
}

function Invoke-Lifecycle {
  param([Parameter(Mandatory)][object]$Gateway, [Parameter(Mandatory)][object]$Plan)
  $script:caseLog.Clear()
  $runShort = ([string]$Plan.runId).Substring(0, 8)
  $ownerSubject = "d3-applications-acceptance:owner:$($Plan.runId)"
  $otherSubject = "d3-applications-acceptance:other:$($Plan.runId)"
  $full = @("applications:read", "applications:write", "profile:read")
  $readOnly = @("applications:read", "profile:read")
  $noScope = @("profile:read")
  $jobId = [string]$Plan.jobId
  $formHash = "b" * 64
  $changedFormHash = "c" * 64
  $form = [ordered]@{ adapterId = "synthetic-acceptance"; variantId = "v1"; formHash = $formHash }
  function Key([string]$label) { return "d3apps-$runShort-$label".PadRight(16, "x") }
  function Owner([string]$name, [string]$method, [string]$path, $body = $null, [string]$key = "", [string[]]$scopes = $full) {
    return Invoke-AppsGateway -Gateway $Gateway -Subject $ownerSubject -Scopes $scopes -Method $method -Path $path -CaseName $name -Body $body -IdempotencyKey $key
  }
  function Other([string]$name, [string]$method, [string]$path, $body = $null, [string]$key = "") {
    return Invoke-AppsGateway -Gateway $Gateway -Subject $otherSubject -Scopes $full -Method $method -Path $path -CaseName $name -Body $body -IdempotencyKey $key
  }
  function Start-Body([long]$revision, [string]$observed) {
    return [ordered]@{ expectedRevision = $revision; adapterId = "synthetic-acceptance"; adapterVersion = "1.0.0"; observedFormHash = $observed }
  }

  $null = Assert-Step "create-no-scope" (Owner "create-no-scope" "POST" "/v1/applications" ([ordered]@{ jobId = $jobId }) (Key "c0") $noScope) 403
  $null = Assert-Step "create-read-only" (Owner "create-read-only" "POST" "/v1/applications" ([ordered]@{ jobId = $jobId }) (Key "c1") $readOnly) 403
  $created = Assert-Step "create" (Owner "create" "POST" "/v1/applications" ([ordered]@{ jobId = $jobId }) (Key "create")) 201
  $id = [string](Get-StepValue $created "id" "create")
  if ($id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or [string]$created.status -cne "preparing") {
    throw "The created application is not the exact preparing UUID v7 resource."
  }
  $replay = Assert-Step "create-replay" (Owner "create-replay" "POST" "/v1/applications" ([ordered]@{ jobId = $jobId }) (Key "create")) 201
  if ([string]$replay.id -cne $id) { throw "The idempotent create replay did not return the same application." }
  $null = Assert-Step "foreign-get" (Other "foreign-get" "GET" "/v1/applications/$id") 404 "application_not_found"
  $null = Assert-Step "foreign-packet" (Other "foreign-packet" "POST" "/v1/applications/$id/packets" ([ordered]@{ expectedRevision = [long]$created.revision }) (Key "fp")) 404
  $packet = Assert-Step "packet" (Owner "packet" "POST" "/v1/applications/$id/packets" ([ordered]@{ expectedRevision = [long]$created.revision; form = $form }) (Key "packet")) 201
  if ([string]$packet.status -cne "review_required") { throw "The prepared packet did not enter review." }
  $packetHash = [string](Get-StepValue $packet.currentPacket "packetHash" "packet")
  $null = Assert-Step "approve-wrong-hash" (Owner "approve-wrong-hash" "POST" "/v1/applications/$id/approval" ([ordered]@{
        expectedRevision = [long]$packet.revision; packetHash = ("0" * 64); acknowledgedFieldKeys = @() }) (Key "bad")) 409
  $approved = Assert-Step "approve" (Owner "approve" "POST" "/v1/applications/$id/approval" ([ordered]@{
        expectedRevision = [long]$packet.revision; packetHash = $packetHash; acknowledgedFieldKeys = @() }) (Key "appr")) 200
  if ([string]$approved.status -cne "approved") { throw "The approval did not move the application to approved." }
  $changed = Assert-Step "start-changed-form" (Owner "start-changed-form" "POST" "/v1/applications/$id/submissions" (Start-Body ([long]$approved.revision) $changedFormHash) (Key "chg")) 200
  if ([string]$changed.outcome -cne "approval_invalidated" -or (@($changed.invalidationReasons) -join "|") -cne "form_changed" -or
      [string]$changed.application.status -cne "review_required") {
    throw "A changed form did not invalidate approval instead of starting a submission."
  }
  $packetAgain = Assert-Step "packet-again" (Owner "packet-again" "POST" "/v1/applications/$id/packets" ([ordered]@{
        expectedRevision = [long]$changed.application.revision; form = $form }) (Key "packet2")) 201
  $approvedAgain = Assert-Step "approve-again" (Owner "approve-again" "POST" "/v1/applications/$id/approval" ([ordered]@{
        expectedRevision = [long]$packetAgain.revision; packetHash = [string]$packetAgain.currentPacket.packetHash; acknowledgedFieldKeys = @() }) (Key "appr2")) 200
  $started = Assert-Step "start" (Owner "start" "POST" "/v1/applications/$id/submissions" (Start-Body ([long]$approvedAgain.revision) $formHash) (Key "start")) 200
  if ([string]$started.outcome -cne "started") { throw "The approved application did not start exactly one attempt." }
  $attemptId = [string](Get-StepValue $started "attemptId" "start")
  $null = Assert-Step "start-duplicate" (Owner "start-duplicate" "POST" "/v1/applications/$id/submissions" (Start-Body ([long]$started.application.revision) $formHash) (Key "dup")) 409
  $dispatched = Assert-Step "dispatch" (Owner "dispatch" "POST" "/v1/applications/$id/attempts/$attemptId/dispatch") 200
  if ([string]$dispatched.status -cne "dispatched") { throw "The attempt was not recorded as dispatched." }
  $null = Assert-Step "dispatch-repeat" (Owner "dispatch-repeat" "POST" "/v1/applications/$id/attempts/$attemptId/dispatch") 409
  $ambiguous = Assert-Step "result-timeout" (Owner "result-timeout" "POST" "/v1/applications/$id/attempts/$attemptId/result" ([ordered]@{ kind = "timeout" }) (Key "timeout")) 200
  if ([string]$ambiguous.status -cne "reconciliation_required") { throw "An ambiguous result did not require reconciliation." }
  $null = Assert-Step "start-after-ambiguous" (Owner "start-after-ambiguous" "POST" "/v1/applications/$id/submissions" (Start-Body ([long]$ambiguous.revision) $formHash) (Key "blind")) 409
  $observedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $applied = Assert-Step "reconcile-attested" (Owner "reconcile-attested" "POST" "/v1/applications/$id/attempts/$attemptId/reconciliation" ([ordered]@{
        kind = "user_attested_submitted"; observedAt = $observedAt; fingerprintSha256 = $formHash }) (Key "recon")) 200
  if ([string]$applied.status -cne "applied") { throw "The candidate attestation did not settle the application as applied." }
  $history = Assert-Step "history" (Owner "history" "GET" "/v1/applications/$id/history") 200
  $kinds = @($history.entries | ForEach-Object { [string]$_.kind })
  $historyJson = $history | ConvertTo-Json -Depth 20 -Compress
  if ($kinds.Count -lt 8 -or $kinds[-1] -cne "submission_confirmed" -or $kinds -cnotcontains "approval_invalidated" -or $history.hasMore -ne $false -or
      $historyJson -match '(?i)interview|offer|recruiter|hired') {
    throw "The technical history is not the exact bounded lifecycle ending at confirmed submission."
  }
  $null = Assert-Step "start-after-applied" (Owner "start-after-applied" "POST" "/v1/applications/$id/submissions" (Start-Body ([long]$applied.revision) $formHash) (Key "late")) 409
  $null = Assert-Step "foreign-history" (Other "foreign-history" "GET" "/v1/applications/$id/history") 404
  $final = Assert-Step "get-final" (Owner "get-final" "GET" "/v1/applications/$id") 200
  $attempts = @($final.attempts)
  if ([string]$final.status -cne "applied" -or $attempts.Count -ne 1 -or [string]$attempts[0].status -cne "confirmed" -or
      [string]$attempts[0].confirmation.kind -cne "user_attested") {
    throw "The final application is not one candidate-attested confirmed attempt."
  }
  $null = Assert-Step "idempotency-conflict" (Owner "idempotency-conflict" "POST" "/v1/applications/$id/packets" ([ordered]@{
        expectedRevision = 1; form = [ordered]@{ adapterId = "synthetic-acceptance"; variantId = "v1"; formHash = $changedFormHash } }) (Key "packet")) 409 "idempotency_conflict"
  if ($script:caseLog.Count -ne $expectedCaseCount) { throw "The lifecycle did not complete exactly $expectedCaseCount steps." }
  return @($script:caseLog)
}

function Wait-AcceptanceTask {
  param([Parameter(Mandatory)][object]$Request, [Parameter(Mandatory)][string]$TaskArn, [Parameter(Mandatory)][string]$Phase)
  & aws ecs wait tasks-stopped --cluster ([string]$Request.cluster) --tasks $TaskArn --no-cli-pager 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The $Phase acceptance task did not stop within the bounded ECS waiter window." }
  $response = Invoke-AwsJson -Arguments @("ecs", "describe-tasks", "--cluster", [string]$Request.cluster, "--tasks", $TaskArn, "--output", "json") -Operation "The $Phase task-result validation"
  $failures = @(Get-OptionalCollection -Object $response -Name "failures")
  $tasks = @(Get-OptionalCollection -Object $response -Name "tasks")
  if ($failures.Count -ne 0 -or $tasks.Count -ne 1) { throw "The $Phase task did not resolve exactly once." }
  $task = $tasks[0]
  $containers = @($task.containers)
  $reviewedOverrides = ConvertTo-ReviewedTaskOverrides -Overrides $task.overrides
  if ([string]$task.taskDefinitionArn -cne [string]$Request.taskDefinition -or [string]$task.launchType -cne "FARGATE" -or [string]$task.lastStatus -cne "STOPPED" -or
      $containers.Count -ne 1 -or [string]$containers[0].name -cne $containerName -or [int]$containers[0].exitCode -ne 0 -or
      (ConvertTo-DeploymentCanonicalValue -Value $reviewedOverrides) -cne (ConvertTo-DeploymentCanonicalValue -Value $Request.overrides)) {
    throw "The $Phase task did not stop successfully with the exact reviewed override."
  }
  $taskId = ($TaskArn -split '/')[-1]
  $logStream = "database-migration/$containerName/$taskId"
  $messages = @()
  for ($attempt = 0; $attempt -lt 30 -and $messages.Count -eq 0; $attempt++) {
    $logs = Invoke-AwsJson -Arguments @("logs", "get-log-events", "--log-group-name", $applicationLogGroup, "--log-stream-name", $logStream, "--start-from-head", "--limit", "10", "--output", "json") -Operation "The $Phase task log validation"
    $messages = @(Get-OptionalCollection -Object $logs -Name "events" | ForEach-Object { [string]$_.message } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($messages.Count -eq 0) { Start-Sleep -Seconds 2 }
  }
  if ($messages.Count -ne 1) { throw "The $Phase task did not emit exactly one bounded result record." }
  $result = ConvertFrom-AcceptanceJson -Json $messages[0] -Description "The $Phase task result"
  $null = Assert-ExactPropertySet -Value $result -Description "The $Phase task result" -ExpectedNames @(
    "schemaVersion", "action", "identityCount", "userCount", "applicationRowCount", "applicationsDeleted"
  )
  $expectedIdentities = if ($Phase -ceq "prepare") { 2 } else { 0 }
  if ([int]$result.schemaVersion -ne 1 -or [string]$result.action -cne $Phase -or [int]$result.identityCount -ne $expectedIdentities -or
      [int]$result.userCount -ne $expectedIdentities -or [int]$result.applicationRowCount -ne 0 -or
      [int]$result.applicationsDeleted -notin @(0, 1) -or ($Phase -ceq "prepare" -and [int]$result.applicationsDeleted -ne 0)) {
    throw "The $Phase task result violated the bounded fixture contract."
  }
  return $result
}

function New-DurableClaim {
  param([Parameter(Mandatory)][object]$PlanEvidence)
  $planSha = $ReviewedExecutionPlanSha256
  $claimKey = "operator-claims/development-applications-acceptance/$planSha.json"
  $history = Invoke-AwsJson -Arguments @("s3api", "list-object-versions", "--bucket", $StateBucket, "--prefix", $claimKey, "--output", "json") -Operation "Acceptance claim history validation"
  $versions = @(Get-OptionalCollection -Object $history -Name "Versions")
  $deleteMarkers = @(Get-OptionalCollection -Object $history -Name "DeleteMarkers")
  if (@($versions | Where-Object { [string]$_.Key -ceq $claimKey }).Count -ne 0 -or @($deleteMarkers | Where-Object { [string]$_.Key -ceq $claimKey }).Count -ne 0) {
    throw "The reviewed acceptance descriptor already has durable claim history; do not replay it."
  }
  $claim = [ordered]@{
    schemaVersion = 1; kind = $claimKind; sourceSha = $SourceSha
    executionPlanSha256 = $planSha; runId = [string]$PlanEvidence.Plan.runId; claimedAt = [DateTimeOffset]::UtcNow.ToString("o")
  }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporary -Value $claim -AllowReplace
    $checksum = Get-FileSha256Base64 -Path $temporary
    $raw = & aws s3api put-object --bucket $StateBucket --key $claimKey --body $temporary --if-none-match '*' `
      --server-side-encryption aws:kms --ssekms-key-id ([string]$script:currentState.KmsKeyArn) --bucket-key-enabled `
      --checksum-algorithm SHA256 --metadata "execution-plan-sha256=$planSha,source-sha=$SourceSha,run-id=$([string]$PlanEvidence.Plan.runId)" --output json 2>$null
    $exitCode = $LASTEXITCODE
    $put = if ($exitCode -eq 0) { ConvertFrom-AcceptanceJson -Json ($raw -join "`n") -Description "The durable acceptance claim response" } else { $null }
    if ($exitCode -ne 0 -or $null -eq $put -or [string]::IsNullOrWhiteSpace([string]$put.VersionId) -or [string]$put.ChecksumSHA256 -cne $checksum) {
      throw "The durable one-time acceptance claim could not be created exactly; do not submit a task."
    }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  $head = Invoke-AwsJson -Arguments @("s3api", "head-object", "--bucket", $StateBucket, "--key", $claimKey, "--version-id", [string]$put.VersionId, "--checksum-mode", "ENABLED", "--output", "json") -Operation "Acceptance claim readback"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne [string]$script:currentState.KmsKeyArn -or -not $head.BucketKeyEnabled -or
      [string]$head.ChecksumSHA256 -cne $checksum -or [string]$head.Metadata.'execution-plan-sha256' -cne $planSha -or [string]$head.Metadata.'source-sha' -cne $SourceSha -or
      [string]$head.Metadata.'run-id' -cne [string]$PlanEvidence.Plan.runId) {
    throw "The durable acceptance claim failed its exact encrypted readback. Do not submit a task."
  }
  return [pscustomobject]@{ Key = $claimKey; VersionId = [string]$put.VersionId; ChecksumSHA256 = $checksum }
}

function Read-AcceptanceReceipt {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][object]$PlanEvidence)
  $resolved = Resolve-PathBelowRoot -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  if ((Get-FileSha256 -Path $resolved) -cne $Sha256) { throw "The acceptance receipt checksum does not match the reviewed value." }
  $receipt = ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $resolved -Raw) -Description "The acceptance receipt"
  $null = Assert-ExactPropertySet -Value $receipt -Description "The acceptance receipt" -ExpectedNames @(
    "schemaVersion", "kind", "environment", "sourceSha", "executionPlanSha256", "migrationReceiptSha256",
    "gatewayArtifactSha256", "gatewayVersion", "runId", "phase", "claimKey", "claimVersionId",
    "claimChecksumSHA256", "prepareTaskArn", "cleanupTaskArn", "caseResultsSha256", "caseCount",
    "applicationsDeleted", "postCleanupRows", "startedAt", "completedAt"
  )
  $allowedPhases = @("claiming", "claimed", "running", "cleanup-required", "failed-cleaned", "recovered-cleaned", "verified")
  $terminalPhases = @("failed-cleaned", "recovered-cleaned", "verified")
  $claimKey = "operator-claims/development-applications-acceptance/$ReviewedExecutionPlanSha256.json"
  $clusterName = ([string]$PlanEvidence.Runtime.ClusterArn -split '/')[-1]
  $taskArnPattern = "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task/$([regex]::Escape($clusterName))/[a-f0-9]{32}$"
  $taskArns = @([string]$receipt.prepareTaskArn, [string]$receipt.cleanupTaskArn)
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne $planKind -or
      [string]$receipt.environment -cne "development" -or [string]$receipt.sourceSha -cne $SourceSha -or
      [string]$receipt.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or [string]$receipt.runId -cne [string]$PlanEvidence.Plan.runId -or
      [string]$receipt.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or [string]$receipt.gatewayArtifactSha256 -cne $ExpectedGatewayArtifactSha256 -or
      [int]$receipt.gatewayVersion -ne $ExpectedGatewayVersion -or [string]$receipt.phase -notin $allowedPhases -or
      @($taskArns | Where-Object { -not [string]::IsNullOrEmpty($_) -and $_ -cnotmatch $taskArnPattern }).Count -ne 0 -or
      (-not [string]::IsNullOrEmpty([string]$receipt.caseResultsSha256) -and [string]$receipt.caseResultsSha256 -cnotmatch '^[a-f0-9]{64}$') -or
      [int]$receipt.caseCount -lt 0 -or [int]$receipt.caseCount -gt $expectedCaseCount -or
      [int]$receipt.applicationsDeleted -notin @(-1, 0, 1) -or [int]$receipt.postCleanupRows -notin @(-1, 0) -or
      -not (Test-CanonicalUtcTimestamp $receipt.startedAt) -or
      ([string]$receipt.phase -in $terminalPhases -and -not (Test-CanonicalUtcTimestamp $receipt.completedAt)) -or
      ([string]$receipt.phase -notin $terminalPhases -and -not [string]::IsNullOrEmpty([string]$receipt.completedAt))) {
    throw "The acceptance receipt does not bind the exact reviewed source, plan, image, gateway, and run."
  }
  if ([string]$receipt.phase -ceq "claiming") {
    if (-not [string]::IsNullOrEmpty([string]$receipt.claimKey) -or
        -not [string]::IsNullOrEmpty([string]$receipt.claimVersionId) -or
        -not [string]::IsNullOrEmpty([string]$receipt.claimChecksumSHA256) -or
        @($taskArns | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -ne 0 -or
        -not [string]::IsNullOrEmpty([string]$receipt.caseResultsSha256) -or [int]$receipt.caseCount -ne 0 -or
        [int]$receipt.applicationsDeleted -ne -1 -or [int]$receipt.postCleanupRows -ne -1) {
      throw "The claiming receipt must prove that neither a durable claim nor an ECS task was recorded."
    }
  } elseif ([string]$receipt.claimKey -cne $claimKey -or
      [string]$receipt.claimVersionId -notmatch '^[A-Za-z0-9._~+/=-]{1,1024}$' -or
      [string]$receipt.claimChecksumSHA256 -notmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The acceptance receipt does not bind the exact durable claim."
  }
  if ([string]$receipt.phase -in $terminalPhases -and
      ([string]$receipt.cleanupTaskArn -notmatch $taskArnPattern -or [int]$receipt.postCleanupRows -ne 0 -or [int]$receipt.applicationsDeleted -notin @(0, 1))) {
    throw "The terminal acceptance receipt does not prove exact synthetic cleanup."
  }
  if ([string]$receipt.phase -ceq "verified" -and
      (@($taskArns | Where-Object { $_ -match $taskArnPattern }).Count -ne 2 -or @($taskArns | Select-Object -Unique).Count -ne 2 -or
        [string]$receipt.caseResultsSha256 -notmatch '^[a-f0-9]{64}$' -or [int]$receipt.caseCount -ne $expectedCaseCount -or
        [int]$receipt.applicationsDeleted -ne 1 -or [int]$receipt.postCleanupRows -ne 0)) {
    throw "The verified acceptance receipt does not prove both distinct tasks, every lifecycle step, and exact cleanup."
  }
  return [pscustomobject]@{ Path = $resolved; Receipt = $receipt }
}

function Assert-DurableClaimEvidence {
  param([Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][object]$PlanEvidence)
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $download = Invoke-AwsJson -Arguments @(
      "s3api", "get-object", "--bucket", $StateBucket, "--key", [string]$Receipt.claimKey,
      "--version-id", [string]$Receipt.claimVersionId, "--checksum-mode", "ENABLED", "--output", "json", $temporary
    ) -Operation "Durable acceptance claim validation"
    $checksum = Get-FileSha256Base64 -Path $temporary
    $contentLength = (Get-Item -LiteralPath $temporary).Length
    $null = Assert-ExactPropertySet -Value $download.Metadata -Description "The durable acceptance claim metadata" -ExpectedNames @(
      "execution-plan-sha256", "source-sha", "run-id"
    )
    if ([string]$download.VersionId -cne [string]$Receipt.claimVersionId -or
        [string]$download.ServerSideEncryption -cne "aws:kms" -or
        [string]$download.SSEKMSKeyId -cne [string]$script:currentState.KmsKeyArn -or -not $download.BucketKeyEnabled -or
        [long]$download.ContentLength -ne [long]$contentLength -or
        [string]$download.ChecksumSHA256 -cne [string]$Receipt.claimChecksumSHA256 -or $checksum -cne [string]$Receipt.claimChecksumSHA256 -or
        [string]$download.Metadata.'execution-plan-sha256' -cne $ReviewedExecutionPlanSha256 -or
        [string]$download.Metadata.'source-sha' -cne $SourceSha -or
        [string]$download.Metadata.'run-id' -cne [string]$PlanEvidence.Plan.runId) {
      throw "The durable acceptance claim no longer matches its exact encrypted receipt binding."
    }
    $claim = ConvertFrom-AcceptanceJson -Json (Get-Content -LiteralPath $temporary -Raw) -Description "The durable acceptance claim"
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
  $null = Assert-ExactPropertySet -Value $claim -Description "The durable acceptance claim" -ExpectedNames @(
    "schemaVersion", "kind", "sourceSha", "executionPlanSha256", "runId", "claimedAt"
  )
  if ([int]$claim.schemaVersion -ne 1 -or [string]$claim.kind -cne $claimKind -or
      [string]$claim.sourceSha -cne $SourceSha -or [string]$claim.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
      [string]$claim.runId -cne [string]$PlanEvidence.Plan.runId -or -not (Test-CanonicalUtcTimestamp $claim.claimedAt)) {
    throw "The durable acceptance claim body does not bind the exact reviewed plan and run."
  }
  return $true
}

function Assert-ActionInputs {
  $migrationInputs = @($MigrationReceiptPath, $ReviewedMigrationReceiptSha256, $ExpectedGatewayArtifactSha256)
  $migrationInputCount = @($migrationInputs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
  $planInputs = @($ExecutionPlanPath, $ReviewedExecutionPlanSha256)
  $planInputCount = @($planInputs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
  $receiptInputs = @($ReceiptPath, $ReviewedReceiptSha256)
  $receiptInputCount = @($receiptInputs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count

  if ($Action -ceq "Status") {
    if (-not [string]::IsNullOrWhiteSpace($SourceSha) -or $migrationInputCount -ne 0 -or $ExpectedGatewayVersion -ne 0 -or
        -not [string]::IsNullOrWhiteSpace($RunId) -or $planInputCount -ne 0 -or $receiptInputCount -ne 0) {
      throw "Status accepts no source, release, execution, run, or receipt inputs."
    }
    return
  }

  if ($SourceSha -notmatch '^[a-f0-9]{40}$' -or $migrationInputCount -ne 3 -or $ExpectedGatewayVersion -lt 1) {
    throw "$Action requires the exact source, migration receipt pair, gateway artifact SHA, and numeric alias version."
  }

  if ($Action -ceq "Plan") {
    if (-not [string]::IsNullOrWhiteSpace($ReviewedExecutionPlanSha256) -or $receiptInputCount -ne 0 -or
        (-not [string]::IsNullOrWhiteSpace($RunId) -and $RunId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) {
      throw "Plan accepts only an optional output path and optional lowercase UUID v4 RunId beyond its exact release inputs."
    }
    return
  }

  if (-not [string]::IsNullOrWhiteSpace($RunId) -or $planInputCount -ne 2) {
    throw "$Action requires the exact reviewed acceptance plan pair and does not accept a caller-selected RunId."
  }

  if ($Action -ceq "Execute") {
    if ($receiptInputCount -ne 0) {
      throw "Execute chooses a new exclusive receipt path and does not accept prior receipt evidence."
    }
    return
  }

  if ($receiptInputCount -ne 2) {
    throw "$Action requires the exact reviewed acceptance receipt pair."
  }
}

function Select-CatalogJob {
  param([Parameter(Mandatory)][object]$Gateway, [Parameter(Mandatory)][string]$RunIdentifier)
  $response = Invoke-AppsGateway -Gateway $Gateway -Subject "d3-applications-acceptance:plan:$RunIdentifier" -Scopes @("jobs:read") -Method POST `
    -Path "/v1/jobs/search" -CaseName "plan-job-search" -Body ([ordered]@{ sort = "freshness"; pageSize = 1 })
  if ([int]$response.statusCode -ne 200) { throw "The read-only catalog search did not return the private success contract." }
  $page = ConvertFrom-AcceptanceJson -Json ([string]$response.body) -Description "The catalog search page"
  $items = @(Get-OptionalCollection -Object $page -Name "items")
  if ($items.Count -lt 1 -or [string]$items[0].status -cne "active" -or
      [string]$items[0].id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw "The catalog has no active job to reference; acceptance needs exactly one active job it will not modify."
  }
  return [string]$items[0].id
}

Assert-ActionInputs
$null = Assert-CallerAndSource -RequireSource:($Action -ne "Status")
$script:currentState = Read-StateSnapshot

if ($Action -ceq "Status") {
  $cluster = [string](Get-StateOutput -Snapshot $script:currentState -Name "ecs_cluster_arn")
  Assert-ZeroActiveTasks -ClusterArn $cluster
  [pscustomobject]@{
    Environment = "development"; StateLineage = $script:currentState.Lineage; StateSerial = $script:currentState.Serial
    ActiveDatabaseTaskCount = 0; CloudMutation = $false
  }
  exit 0
}

$migrationReceipt = Read-MigrationReceipt
$gateway = Read-GatewayBoundary
$runtime = Get-ExactRuntime -Snapshot $script:currentState -ExpectedImage $migrationReceipt.ImageUri

if ($Action -ceq "Plan") {
  if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = [guid]::NewGuid().ToString() }
  if ($RunId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw "RunId must be one lowercase UUID v4." }
  $jobId = Select-CatalogJob -Gateway $gateway -RunIdentifier $RunId
  $identity = [pscustomobject]@{ RunId = $RunId; Issuer = [string]$gateway.Issuer; OwnerUserId = (New-UuidV7); OtherUserId = (New-UuidV7) }
  $prepareAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $startedBy = "d3-apps-$($SourceSha.Substring(0, 12))"
  $requests = @()
  foreach ($phase in @("prepare", "cleanup")) {
    $request = New-RunTaskRequest -Runtime $runtime -Phase $phase -Identity $identity -At $prepareAt -ClientToken "d3-apps-$phase-$([guid]::NewGuid().ToString('N'))" -StartedBy $startedBy
    $null = Assert-RunTaskRequest -Request $request -Runtime $runtime -Phase $phase -Identity $identity -At $prepareAt
    $requests += [ordered]@{ phase = $phase; request = $request }
  }
  if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) {
    $ExecutionPlanPath = Join-Path $operatorRoot "execution-$($SourceSha.Substring(0, 12))-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$($RunId.Substring(0, 8)).json"
  }
  $executionPath = Resolve-PathBelowRoot -Candidate $ExecutionPlanPath -AllowedRoot $operatorRoot
  $plan = [ordered]@{
    schemaVersion = 1; kind = $planKind; environment = "development"; region = $Region; accountId = $ExpectedAccountId
    stateBucket = $StateBucket; stateKey = $stateKey; stateLineage = $script:currentState.Lineage; stateSerial = $script:currentState.Serial; stateVersionId = $script:currentState.VersionId
    sourceSha = $SourceSha; migrationReceiptPath = $migrationReceipt.Path; migrationReceiptSha256 = $ReviewedMigrationReceiptSha256; migrationImage = $migrationReceipt.ImageUri
    gateway = [ordered]@{ functionName = $gateway.FunctionName; aliasName = $gateway.AliasName; version = $gateway.Version; artifactSha256 = $gateway.ArtifactSha256; codeSha256 = $gateway.CodeSha256; audience = $gateway.Audience }
    runId = $RunId; issuer = [string]$gateway.Issuer; ownerUserId = $identity.OwnerUserId; otherUserId = $identity.OtherUserId; jobId = $jobId
    prepareAt = $prepareAt; createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    runtime = [ordered]@{ clusterArn = $runtime.ClusterArn; taskDefinitionArn = $runtime.TaskDefinitionArn; subnets = @($runtime.Subnets); securityGroup = $runtime.SecurityGroup }
    requests = $requests
  }
  Write-JsonFile -Path $executionPath -Value $plan
  $sha = Get-FileSha256 -Path $executionPath
  $null = Read-ExecutionPlan -Path $executionPath -Sha256 $sha -Snapshot $script:currentState -Receipt $migrationReceipt -Gateway $gateway -RequireFresh
  [pscustomobject]@{ Outcome = "review-required"; ExecutionPlanPath = $executionPath; ExecutionPlanSha256 = $sha; RunId = $RunId; RequestedTaskCount = 2; DatabaseWrites = 0 }
  exit 0
}

$planEvidence = Read-ExecutionPlan -Path $ExecutionPlanPath -Sha256 $ReviewedExecutionPlanSha256 -Snapshot $script:currentState -Receipt $migrationReceipt -Gateway $gateway -RequireFresh:($Action -ceq "Execute")
$plan = $planEvidence.Plan
$requestByPhase = @{}
foreach ($entry in @($plan.requests)) { $requestByPhase[[string]$entry.phase] = $entry.request }

if ($Action -ceq "Execute") {
  $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0, 12))-$ReviewedExecutionPlanSha256.json"
  $resolvedReceipt = Resolve-PathBelowRoot -Candidate $ReceiptPath -AllowedRoot $operatorRoot
  $receipt = [ordered]@{
    schemaVersion = 1; kind = $planKind; environment = "development"; sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256; migrationReceiptSha256 = $ReviewedMigrationReceiptSha256
    gatewayArtifactSha256 = $ExpectedGatewayArtifactSha256; gatewayVersion = $ExpectedGatewayVersion; runId = [string]$plan.runId
    phase = "claiming"; claimKey = ""; claimVersionId = ""; claimChecksumSHA256 = ""
    prepareTaskArn = ""; cleanupTaskArn = ""; caseResultsSha256 = ""; caseCount = 0
    applicationsDeleted = -1; postCleanupRows = -1; startedAt = [DateTimeOffset]::UtcNow.ToString("o"); completedAt = ""
  }
  Write-JsonFile -Path $resolvedReceipt -Value $receipt
  try {
    $claim = New-DurableClaim -PlanEvidence $planEvidence
  } catch {
    throw "The durable acceptance claim was not completed; no task was submitted. Retain the claiming receipt at '$resolvedReceipt'."
  }
  $receipt.phase = "claimed"
  $receipt.claimKey = $claim.Key
  $receipt.claimVersionId = $claim.VersionId
  $receipt.claimChecksumSHA256 = $claim.ChecksumSHA256
  try {
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
  } catch {
    throw "The durable claim exists, but its local receipt was not promoted; no task was submitted. Retain the claiming receipt at '$resolvedReceipt'."
  }
  $prepareMayHaveStarted = $false; $primaryFailure = $null; $cleanupFailure = $null
  try {
    $receipt.phase = "running"; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $prepareMayHaveStarted = $true
    $receipt.prepareTaskArn = Submit-AcceptanceTask -Request $requestByPhase.prepare
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $null = Wait-AcceptanceTask -Request $requestByPhase.prepare -TaskArn $receipt.prepareTaskArn -Phase "prepare"

    $cases = Invoke-Lifecycle -Gateway $gateway -Plan $plan
    $receipt.caseCount = @($cases).Count
    $receipt.caseResultsSha256 = Get-TextSha256 (@($cases) -join "`n")
  } catch { $primaryFailure = $_ }
  finally {
    if ($prepareMayHaveStarted) {
      try {
        $receipt.cleanupTaskArn = Submit-AcceptanceTask -Request $requestByPhase.cleanup; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
        $cleanup = Wait-AcceptanceTask -Request $requestByPhase.cleanup -TaskArn $receipt.cleanupTaskArn -Phase "cleanup"
        $receipt.applicationsDeleted = [int]$cleanup.applicationsDeleted
        $receipt.postCleanupRows = 0
      } catch { $cleanupFailure = $_ }
    }
  }
  if ($null -ne $cleanupFailure) {
    $receipt.phase = "cleanup-required"; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Applications acceptance did not prove cleanup. Retain the receipt and use only reviewed RecoverCleanup."
  }
  if ($null -ne $primaryFailure) {
    $receipt.phase = "failed-cleaned"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Applications acceptance failed; exact cleanup completed, and no acceptance claim is made."
  }
  if ($receipt.caseCount -ne $expectedCaseCount -or $receipt.postCleanupRows -ne 0 -or $receipt.applicationsDeleted -ne 1) {
    $receipt.phase = "failed-cleaned"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Applications acceptance did not close every bounded invariant."
  }
  $receipt.phase = "verified"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o"); Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
  $receiptSha = Get-FileSha256 -Path $resolvedReceipt
  [pscustomobject]@{
    Outcome = "verified-and-cleaned"; ReceiptPath = $resolvedReceipt; ReceiptSha256 = $receiptSha; RunId = [string]$plan.runId
    LifecycleSteps = $expectedCaseCount; ApplicationsDeleted = 1; PersistentFixtureRows = 0; CatalogJobModified = $false
  }
  exit 0
}

$receiptEvidence = Read-AcceptanceReceipt -Path $ReceiptPath -Sha256 $ReviewedReceiptSha256 -PlanEvidence $planEvidence
$acceptanceReceipt = $receiptEvidence.Receipt
if ([string]$acceptanceReceipt.phase -ceq "claiming") {
  throw "The reviewed receipt predates durable-claim completion and cannot verify or submit cleanup; no ECS task was recorded."
}
$null = Assert-DurableClaimEvidence -Receipt $acceptanceReceipt -PlanEvidence $planEvidence

if ($Action -ceq "RecoverCleanup") {
  if ([string]$acceptanceReceipt.phase -notin @("running", "cleanup-required")) {
    throw "Cleanup recovery requires a reviewed running or cleanup-required receipt proving that prepare may have started."
  }
  $cleanupArn = Submit-AcceptanceTask -Request $requestByPhase.cleanup
  $cleanup = Wait-AcceptanceTask -Request $requestByPhase.cleanup -TaskArn $cleanupArn -Phase "cleanup"
  $acceptanceReceipt.cleanupTaskArn = $cleanupArn; $acceptanceReceipt.postCleanupRows = 0
  $acceptanceReceipt.applicationsDeleted = [int]$cleanup.applicationsDeleted; $acceptanceReceipt.phase = "recovered-cleaned"
  $acceptanceReceipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
  Write-JsonFile -Path $receiptEvidence.Path -Value $acceptanceReceipt -AllowReplace
  [pscustomobject]@{ Outcome = "cleanup-recovered"; ReceiptPath = $receiptEvidence.Path; ReceiptSha256 = (Get-FileSha256 $receiptEvidence.Path); PostCleanupRows = 0; AcceptanceClaim = $false }
  exit 0
}

if ([string]$acceptanceReceipt.phase -cne "verified" -or [int]$acceptanceReceipt.postCleanupRows -ne 0 -or [int]$acceptanceReceipt.applicationsDeleted -ne 1 -or
    [int]$acceptanceReceipt.caseCount -ne $expectedCaseCount -or [string]$acceptanceReceipt.caseResultsSha256 -notmatch '^[a-f0-9]{64}$' -or
    -not (Test-CanonicalUtcTimestamp $acceptanceReceipt.completedAt)) {
  throw "Verify accepts only a completed, cleaned, internally consistent acceptance receipt."
}
# Verification never calls the Gateway: a request for the removed identity would create a new one.
$endingState = Read-StateSnapshot
if ([string]$endingState.Lineage -cne [string]$script:currentState.Lineage -or [long]$endingState.Serial -ne [long]$script:currentState.Serial -or [string]$endingState.VersionId -cne [string]$script:currentState.VersionId) {
  throw "Terraform state changed during the read-only acceptance verification."
}
Assert-ZeroActiveTasks -ClusterArn ([string]$runtime.ClusterArn)
[pscustomobject]@{
  Outcome = "verified"; ReceiptSha256 = $ReviewedReceiptSha256; LifecycleSteps = $expectedCaseCount; ApplicationsDeleted = 1
  PostCleanupRows = 0; PersistentFixtureRows = 0; StateChanged = $false; CloudMutation = $false
}
