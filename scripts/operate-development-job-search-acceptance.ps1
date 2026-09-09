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
  .\scripts\operate-development-job-search-acceptance.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-job-search-acceptance.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath receipt-SOURCE.json `
    -ReviewedMigrationReceiptSha256 64_CHARACTER_SHA256 `
    -ExpectedGatewayArtifactSha256 64_CHARACTER_SHA256 `
    -ExpectedGatewayVersion NUMERIC_ALIAS_VERSION

  .\scripts\operate-development-job-search-acceptance.ps1 -Action Execute `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath PATH -ReviewedMigrationReceiptSha256 SHA256 `
    -ExpectedGatewayArtifactSha256 SHA256 -ExpectedGatewayVersion VERSION `
    -ExecutionPlanPath PATH -ReviewedExecutionPlanSha256 SHA256

  .\scripts\operate-development-job-search-acceptance.ps1 -Action RecoverCleanup `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath PATH -ReviewedMigrationReceiptSha256 SHA256 `
    -ExpectedGatewayArtifactSha256 SHA256 -ExpectedGatewayVersion VERSION `
    -ExecutionPlanPath PATH -ReviewedExecutionPlanSha256 SHA256 `
    -ReceiptPath PATH -ReviewedReceiptSha256 SHA256

  .\scripts\operate-development-job-search-acceptance.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -MigrationReceiptPath PATH -ReviewedMigrationReceiptSha256 SHA256 `
    -ExpectedGatewayArtifactSha256 SHA256 -ExpectedGatewayVersion VERSION `
    -ExecutionPlanPath PATH -ReviewedExecutionPlanSha256 SHA256 `
    -ReceiptPath PATH -ReviewedReceiptSha256 SHA256

Plan is read-only and creates one checksum-reviewable, 15-minute execution descriptor below the
ignored development .terraform directory. Execute is the only normal mutation action. It first
writes an exclusive plan-bound claiming receipt, claims that descriptor once, then creates exactly
three generated-synthetic Jobs rows and proves an old cursor
returns the stable 409 after a separate catalog revision mutation, proves a fresh restart is
complete and duplicate-free, and always attempts exact fixture cleanup. RecoverCleanup may only
consume an already reviewed receipt and can submit the descriptor's fixed cleanup request; it
cannot prepare or mutate data. Verify is read-only. No action accepts SQL, a container name,
command, environment name, search query, job value, or gateway payload from the caller.

This is a synthetic development acceptance path. It does not use a real OIDC token or browser,
does not authorize real source/candidate data, and does not complete D1-005.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development search acceptance is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development\.terraform"))
$migrationReceiptRoot = Join-Path $terraformRoot "development-migration-image"
$operatorRoot = Join-Path $terraformRoot "development-job-search-acceptance"
$stateKey = "platform.tfstate"
$containerName = "database-migration"
$migrationFamily = "ai-job-apply-development-database-migration"
$gatewayFunctionName = "ai-job-apply-development-gateway"
$gatewayAliasName = "development"
$applicationLogGroup = "/ai-job-apply/development/application"
$acceptanceCommand = @("jobs/dist/src/run-search-acceptance.js")
$confirmation = "generated-synthetic-only"
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

function New-AcceptanceEnvironment {
  param([Parameter(Mandatory)][ValidateSet("prepare", "mutate", "cleanup")][string]$Phase, [Parameter(Mandatory)][string]$PlanRunId, [string]$At)
  $values = @(
    [ordered]@{ name = "JOB_SEARCH_ACCEPTANCE_CONFIRM"; value = $confirmation },
    [ordered]@{ name = "JOB_SEARCH_ACCEPTANCE_ACTION"; value = $Phase },
    [ordered]@{ name = "JOB_SEARCH_ACCEPTANCE_RUN_ID"; value = $PlanRunId }
  )
  if ($Phase -cne "cleanup") { $values += [ordered]@{ name = "JOB_SEARCH_ACCEPTANCE_AT"; value = $At } }
  return @($values)
}

function New-RunTaskRequest {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][ValidateSet("prepare", "mutate", "cleanup")][string]$Phase,
    [Parameter(Mandatory)][string]$PlanRunId,
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
          name = $containerName; command = @($acceptanceCommand); environment = @(New-AcceptanceEnvironment -Phase $Phase -PlanRunId $PlanRunId -At $At)
        }) }
    clientToken = $ClientToken; startedBy = $StartedBy
  }
}

function Assert-RunTaskRequest {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][ValidateSet("prepare", "mutate", "cleanup")][string]$Phase,
    [Parameter(Mandatory)][string]$PlanRunId,
    [Parameter(Mandatory)][string]$At
  )
  $null = Assert-ExactPropertySet -Value $Request -Description "The $Phase run-task request" -ExpectedNames @(
    "cluster", "taskDefinition", "count", "launchType", "networkConfiguration", "overrides", "clientToken", "startedBy"
  )
  $null = Assert-ExactPropertySet -Value $Request.networkConfiguration -Description "The $Phase network configuration" -ExpectedNames @(
    "awsvpcConfiguration"
  )
  $null = Assert-ExactPropertySet -Value $Request.networkConfiguration.awsvpcConfiguration -Description "The $Phase awsvpc configuration" -ExpectedNames @(
    "subnets", "securityGroups", "assignPublicIp"
  )
  $null = Assert-ExactPropertySet -Value $Request.overrides -Description "The $Phase task overrides" -ExpectedNames @(
    "containerOverrides"
  )
  $overrides = @($Request.overrides.containerOverrides)
  if ($overrides.Count -ne 1) {
    throw "The $Phase request must contain exactly one fixed container override."
  }
  $null = Assert-ExactPropertySet -Value $overrides[0] -Description "The $Phase container override" -ExpectedNames @(
    "name", "command", "environment"
  )
  foreach ($entry in @($overrides[0].environment)) {
    $null = Assert-ExactPropertySet -Value $entry -Description "The $Phase acceptance environment entry" -ExpectedNames @("name", "value")
  }
  $expectedEnvironment = @(New-AcceptanceEnvironment -Phase $Phase -PlanRunId $PlanRunId -At $At)
  if ([string]$Request.cluster -cne [string]$Runtime.ClusterArn -or [string]$Request.taskDefinition -cne [string]$Runtime.TaskDefinitionArn -or
      [int]$Request.count -ne 1 -or [string]$Request.launchType -cne "FARGATE" -or
      (@($Request.networkConfiguration.awsvpcConfiguration.subnets) -join "|") -cne (@($Runtime.Subnets) -join "|") -or
      @($Request.networkConfiguration.awsvpcConfiguration.securityGroups).Count -ne 1 -or
      [string]@($Request.networkConfiguration.awsvpcConfiguration.securityGroups)[0] -cne [string]$Runtime.SecurityGroup -or
      [string]$Request.networkConfiguration.awsvpcConfiguration.assignPublicIp -cne "ENABLED" -or
      [string]$Request.clientToken -notmatch "^d1-search-$Phase-[a-f0-9]{32}$" -or [string]$Request.startedBy -notmatch '^d1-search-[a-f0-9]{12}$' -or
      [string]$overrides[0].name -cne $containerName -or
      (@($overrides[0].command) -join "|") -cne ($acceptanceCommand -join "|") -or
      (ConvertTo-DeploymentCanonicalValue -Value @($overrides[0].environment)) -cne (ConvertTo-DeploymentCanonicalValue -Value $expectedEnvironment)) {
    throw "The $Phase request is not the exact fixed one-task acceptance override."
  }
  return $true
}

function Assert-PlanFresh {
  param([Parameter(Mandatory)][string]$At, [switch]$RequireFresh)
  if ($At -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw "The acceptance descriptor timestamp is not exact UTC milliseconds." }
  $parsed = [DateTime]::ParseExact($At, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
  if ($RequireFresh -and [Math]::Abs(([DateTime]::UtcNow - $parsed).TotalMinutes) -gt 15) {
    throw "The acceptance descriptor is outside its 15-minute execution window; create and review a fresh plan."
  }
}

function Assert-PlanTimestamps {
  param(
    [Parameter(Mandatory)][string]$PrepareAt,
    [Parameter(Mandatory)][string]$MutateAt,
    [switch]$RequireFresh
  )
  Assert-PlanFresh -At $PrepareAt -RequireFresh:$RequireFresh
  Assert-PlanFresh -At $MutateAt -RequireFresh:$RequireFresh
  $prepareTimestamp = [DateTime]::ParseExact(
    $PrepareAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $mutateTimestamp = [DateTime]::ParseExact(
    $MutateAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  if ($mutateTimestamp -ne $prepareTimestamp.AddSeconds(1)) {
    throw "The acceptance mutate timestamp must be exactly one second after prepare."
  }
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
    "sourceSha", "migrationReceiptPath", "migrationReceiptSha256", "migrationImage", "gateway", "runId", "prepareAt", "mutateAt", "createdAt", "runtime", "requests"
  )
  $null = Assert-ExactPropertySet -Value $plan.gateway -Description "The acceptance gateway binding" -ExpectedNames @(
    "functionName", "aliasName", "version", "artifactSha256", "codeSha256"
  )
  $null = Assert-ExactPropertySet -Value $plan.runtime -Description "The acceptance runtime binding" -ExpectedNames @(
    "clusterArn", "taskDefinitionArn", "subnets", "securityGroup"
  )
  if ([int]$plan.schemaVersion -ne 1 -or [string]$plan.kind -cne "development-job-search-stale-cursor-acceptance" -or
      [string]$plan.environment -cne "development" -or [string]$plan.region -cne $Region -or [string]$plan.accountId -cne $ExpectedAccountId -or
      [string]$plan.stateBucket -cne $StateBucket -or [string]$plan.stateKey -cne $stateKey -or [string]$plan.stateLineage -cne [string]$Snapshot.Lineage -or
      [long]$plan.stateSerial -ne [long]$Snapshot.Serial -or [string]$plan.stateVersionId -cne [string]$Snapshot.VersionId -or [string]$plan.sourceSha -cne $SourceSha -or
      [string]$plan.migrationReceiptPath -cne [string]$Receipt.Path -or [string]$plan.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or
      [string]$plan.migrationImage -cne [string]$Receipt.ImageUri -or [string]$plan.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      [string]$plan.gateway.functionName -cne [string]$Gateway.FunctionName -or [string]$plan.gateway.aliasName -cne [string]$Gateway.AliasName -or
      [string]$plan.gateway.version -cne [string]$Gateway.Version -or [string]$plan.gateway.artifactSha256 -cne [string]$Gateway.ArtifactSha256 -or
      [string]$plan.gateway.codeSha256 -cne [string]$Gateway.CodeSha256 -or -not (Test-CanonicalUtcTimestamp $plan.createdAt)) {
    throw "The acceptance plan no longer matches the exact source, state, image, gateway, and run identity."
  }
  Assert-PlanTimestamps -PrepareAt ([string]$plan.prepareAt) -MutateAt ([string]$plan.mutateAt) -RequireFresh:$RequireFresh
  $runtime = [pscustomobject]@{
    ClusterArn = [string]$plan.runtime.clusterArn; TaskDefinitionArn = [string]$plan.runtime.taskDefinitionArn
    Subnets = @($plan.runtime.subnets); SecurityGroup = [string]$plan.runtime.securityGroup; Image = [string]$plan.migrationImage
  }
  $currentRuntime = Get-ExactRuntime -Snapshot $Snapshot -ExpectedImage ([string]$Receipt.ImageUri)
  if ((ConvertTo-DeploymentCanonicalValue -Value $runtime) -cne (ConvertTo-DeploymentCanonicalValue -Value ([pscustomobject]@{
        ClusterArn = $currentRuntime.ClusterArn; TaskDefinitionArn = $currentRuntime.TaskDefinitionArn; Subnets = @($currentRuntime.Subnets)
        SecurityGroup = $currentRuntime.SecurityGroup; Image = $currentRuntime.Image
      }))) { throw "The acceptance plan runtime no longer matches the encrypted state and task definition." }
  $requests = @($plan.requests)
  if ($requests.Count -ne 3 -or (@($requests | ForEach-Object { [string]$_.phase }) -join "|") -cne "prepare|mutate|cleanup") {
    throw "The acceptance plan must contain exactly the ordered prepare, mutate, and cleanup requests."
  }
  foreach ($entry in $requests) {
    $null = Assert-ExactPropertySet -Value $entry -Description "The acceptance request entry" -ExpectedNames @("phase", "request")
    $phaseAt = if ([string]$entry.phase -ceq "mutate") { [string]$plan.mutateAt } else { [string]$plan.prepareAt }
    $null = Assert-RunTaskRequest -Request $entry.request -Runtime $runtime -Phase ([string]$entry.phase) -PlanRunId ([string]$plan.runId) -At $phaseAt
  }
  return [pscustomobject]@{ Path = $resolved; Plan = $plan; Runtime = $runtime }
}

function New-AuthorizerClaims {
  param([Parameter(Mandatory)][object]$Gateway)
  if ([string]::IsNullOrWhiteSpace([string]$Gateway.Issuer) -or [string]::IsNullOrWhiteSpace([string]$Gateway.Audience)) {
    throw "The gateway does not expose the exact OIDC issuer and audience required for validated synthetic context."
  }
  return [ordered]@{ iss = [string]$Gateway.Issuer; sub = "synthetic-job-search-acceptance"; aud = @([string]$Gateway.Audience); scope = "jobs:read" }
}

function New-SearchEvent {
  param([Parameter(Mandatory)][object]$Gateway, [Parameter(Mandatory)][string]$RequestId, [Parameter(Mandatory)][string]$Body)
  $claims = New-AuthorizerClaims -Gateway $Gateway
  return [ordered]@{
    version = "2.0"; routeKey = "POST /v1/jobs/search"; rawPath = "/v1/jobs/search"; rawQueryString = ""
    headers = [ordered]@{ authorization = "Bearer validated-synthetic-context"; "content-type" = "application/json" }
    requestContext = [ordered]@{
      accountId = "synthetic-acceptance"; apiId = "synthetic-acceptance"; domainName = "127.0.0.1"; domainPrefix = "synthetic-acceptance"
      http = [ordered]@{ method = "POST"; path = "/v1/jobs/search"; protocol = "HTTP/1.1"; sourceIp = "127.0.0.1"; userAgent = "applydash-search-acceptance" }
      requestId = $RequestId; routeKey = "POST /v1/jobs/search"; stage = '$default'; time = [DateTime]::UtcNow.ToString("o"); timeEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      authorizer = [ordered]@{ jwt = [ordered]@{ claims = $claims; scopes = @("jobs:read") } }
    }
    body = $Body; isBase64Encoded = $false
  }
}

function Invoke-GatewaySearch {
  param([Parameter(Mandatory)][object]$Gateway, [Parameter(Mandatory)][object]$Body, [Parameter(Mandatory)][string]$CaseName)
  $temporaryInput = [IO.Path]::GetTempFileName()
  $temporaryOutput = [IO.Path]::GetTempFileName()
  try {
    $event = New-SearchEvent -Gateway $Gateway -RequestId "d1-search-$CaseName-$([guid]::NewGuid().ToString('N').Substring(0, 12))" -Body ($Body | ConvertTo-Json -Compress)
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

function Assert-SearchPageResponse {
  param([Parameter(Mandatory)][object]$Response, [Parameter(Mandatory)][int]$ExpectedCount, [switch]$RequireCursor, [switch]$ForbidCursor)
  if ([int]$Response.statusCode -ne 200 -or [string]$Response.headers.'cache-control' -cne "no-store" -or
      ([string]$Response.headers.'content-type').Split(';', 2)[0].Trim() -cne "application/json") {
    throw "The gateway did not return the private job-search success contract."
  }
  $page = ConvertFrom-AcceptanceJson -Json ([string]$Response.body) -Description "The gateway job-search page"
  $keys = @($page.PSObject.Properties.Name | Sort-Object)
  if (($keys -join "|") -notin @("items", "items|nextCursor") -or @($page.items).Count -ne $ExpectedCount) {
    throw "The gateway returned an unexpected job-search page shape or count."
  }
  $ids = @()
  foreach ($item in @($page.items)) {
    if ([string]$item.id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or [string]$item.status -cne "active") {
      throw "The synthetic search page contains an invalid canonical job summary."
    }
    $ids += [string]$item.id
  }
  $cursor = [string](Get-OptionalProperty $page "nextCursor")
  if ($RequireCursor -and ($cursor -cnotmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' -or $cursor.Length -gt 1024)) {
    throw "The first synthetic page did not return one bounded continuation cursor."
  }
  if ($ForbidCursor -and -not [string]::IsNullOrEmpty($cursor)) { throw "The terminal synthetic page returned an unexpected cursor." }
  return [pscustomobject]@{ Ids = $ids; Cursor = $cursor }
}

function Assert-StaleCursorResponse {
  param([Parameter(Mandatory)][object]$Response)
  if ([int]$Response.statusCode -ne 409 -or [string]$Response.headers.'cache-control' -cne "no-store" -or
      ([string]$Response.headers.'content-type').Split(';', 2)[0].Trim() -cne "application/problem+json") {
    throw "The stale cursor did not return the private stable 409 problem contract."
  }
  $problem = ConvertFrom-AcceptanceJson -Json ([string]$Response.body) -Description "The stale-cursor problem"
  $expectedNames = @("type", "title", "status", "code", "traceId")
  $detail = Get-OptionalProperty -Object $problem -Name "detail"
  if ($null -ne $detail) { $expectedNames += "detail" }
  $null = Assert-ExactPropertySet -Value $problem -ExpectedNames $expectedNames -Description "The stale-cursor problem"
  $expectedDetail = "The job catalog changed; restart the search from the first page"
  if ([string]$problem.type -cne "urn:ai-job-apply:problem:job_search_catalog_changed" -or
      [string]$problem.title -cne "Job catalog changed" -or [int]$problem.status -ne 409 -or
      [string]$problem.code -cne "job_search_catalog_changed" -or
      $problem.traceId -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$problem.traceId) -or
      [string]$Response.headers.'x-correlation-id' -cne [string]$problem.traceId -or
      ($null -ne $detail -and ($detail -isnot [string] -or [string]$detail -cne $expectedDetail))) {
    throw "The stale cursor problem did not carry the exact stable catalog-changed contract."
  }
  return $true
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

function Wait-AcceptanceTask {
  param([Parameter(Mandatory)][object]$Request, [Parameter(Mandatory)][string]$TaskArn, [Parameter(Mandatory)][string]$Phase, [Parameter(Mandatory)][string]$PlanRunId)
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
    $logs = Invoke-AwsJson -Arguments @("logs", "get-log-events", "--log-group-name", $applicationLogGroup, "--log-stream-name", $logStream, "--start-from-head", "--limit", "10", "--output", "json") -Operation "The $Phase acceptance log validation"
    $messages = @(Get-OptionalCollection -Object $logs -Name "events" | ForEach-Object { [string]$_.message } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($messages.Count -eq 0) { Start-Sleep -Seconds 2 }
  }
  if ($messages.Count -ne 1) { throw "The $Phase task did not emit exactly one bounded result record." }
  $result = ConvertFrom-AcceptanceJson -Json $messages[0] -Description "The $Phase task result"
  $null = Assert-ExactPropertySet -Value $result -Description "The $Phase task result" -ExpectedNames @("schemaVersion", "action", "runId", "queryToken", "revisionBefore", "revisionAfter", "affectedJobs")
  $expectedAffected = @{ prepare = 3; mutate = 1; cleanup = 3 }[$Phase]
  $expectedQueryToken = "d1search$($PlanRunId.Replace('-', ''))"
  $before = [Numerics.BigInteger]::Zero; $after = [Numerics.BigInteger]::Zero
  if ([int]$result.schemaVersion -ne 1 -or [string]$result.action -cne $Phase -or [string]$result.runId -cne $PlanRunId -or
      [string]$result.queryToken -cne $expectedQueryToken -or [int]$result.affectedJobs -ne $expectedAffected -or
      -not [Numerics.BigInteger]::TryParse([string]$result.revisionBefore, [ref]$before) -or
      -not [Numerics.BigInteger]::TryParse([string]$result.revisionAfter, [ref]$after) -or $before -lt 1 -or $after -le $before) {
    throw "The $Phase task result violated the bounded revision contract."
  }
  return $result
}

function New-DurableClaim {
  param([Parameter(Mandatory)][object]$PlanEvidence)
  $planSha = $ReviewedExecutionPlanSha256
  $claimKey = "operator-claims/development-job-search-acceptance/$planSha.json"
  $history = Invoke-AwsJson -Arguments @("s3api", "list-object-versions", "--bucket", $StateBucket, "--prefix", $claimKey, "--output", "json") -Operation "Acceptance claim history validation"
  $versions = @(Get-OptionalCollection -Object $history -Name "Versions")
  $deleteMarkers = @(Get-OptionalCollection -Object $history -Name "DeleteMarkers")
  if (@($versions | Where-Object { [string]$_.Key -ceq $claimKey }).Count -ne 0 -or @($deleteMarkers | Where-Object { [string]$_.Key -ceq $claimKey }).Count -ne 0) {
    throw "The reviewed acceptance descriptor already has durable claim history; do not replay it."
  }
  $claim = [ordered]@{
    schemaVersion = 1; kind = "development-job-search-acceptance-claim"; sourceSha = $SourceSha
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
    "claimChecksumSHA256", "prepareTaskArn", "mutateTaskArn", "cleanupTaskArn", "queryTokenSha256",
    "baselineJobSetSha256", "restartJobSetSha256", "staleCursorRejected", "postCleanupCount", "startedAt", "completedAt"
  )
  $allowedPhases = @("claiming", "claimed", "running", "cleanup-required", "failed-cleaned", "recovered-cleaned", "verified")
  $terminalPhases = @("failed-cleaned", "recovered-cleaned", "verified")
  $claimKey = "operator-claims/development-job-search-acceptance/$ReviewedExecutionPlanSha256.json"
  $clusterName = ([string]$PlanEvidence.Runtime.ClusterArn -split '/')[-1]
  $taskArnPattern = "^arn:aws:ecs:$([regex]::Escape($Region)):$ExpectedAccountId`:task/$([regex]::Escape($clusterName))/[a-f0-9]{32}$"
  $taskArns = @([string]$receipt.prepareTaskArn, [string]$receipt.mutateTaskArn, [string]$receipt.cleanupTaskArn)
  $hashes = @([string]$receipt.queryTokenSha256, [string]$receipt.baselineJobSetSha256, [string]$receipt.restartJobSetSha256)
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne "development-job-search-stale-cursor-acceptance" -or
      [string]$receipt.environment -cne "development" -or [string]$receipt.sourceSha -cne $SourceSha -or
      [string]$receipt.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or [string]$receipt.runId -cne [string]$PlanEvidence.Plan.runId -or
      [string]$receipt.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or [string]$receipt.gatewayArtifactSha256 -cne $ExpectedGatewayArtifactSha256 -or
      [int]$receipt.gatewayVersion -ne $ExpectedGatewayVersion -or [string]$receipt.phase -notin $allowedPhases -or
      @($taskArns | Where-Object { -not [string]::IsNullOrEmpty($_) -and $_ -cnotmatch $taskArnPattern }).Count -ne 0 -or
      @($hashes | Where-Object { -not [string]::IsNullOrEmpty($_) -and $_ -cnotmatch '^[a-f0-9]{64}$' }).Count -ne 0 -or
      $receipt.staleCursorRejected -isnot [bool] -or [int]$receipt.postCleanupCount -notin @(-1, 0) -or
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
        @($hashes | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -ne 0 -or
        $receipt.staleCursorRejected -or [int]$receipt.postCleanupCount -ne -1) {
      throw "The claiming receipt must prove that neither a durable claim nor an ECS task was recorded."
    }
  } elseif ([string]$receipt.claimKey -cne $claimKey -or
      [string]$receipt.claimVersionId -notmatch '^[A-Za-z0-9._~+/=-]{1,1024}$' -or
      [string]$receipt.claimChecksumSHA256 -notmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The acceptance receipt does not bind the exact durable claim."
  }
  if ([string]$receipt.phase -in @("failed-cleaned", "recovered-cleaned", "verified") -and
      ([string]$receipt.cleanupTaskArn -notmatch $taskArnPattern -or [int]$receipt.postCleanupCount -ne 0)) {
    throw "The terminal acceptance receipt does not prove exact synthetic cleanup."
  }
  if ([string]$receipt.phase -ceq "verified" -and
      (@($taskArns | Where-Object { $_ -match $taskArnPattern }).Count -ne 3 -or
        @($taskArns | Select-Object -Unique).Count -ne 3 -or
        [string]$receipt.queryTokenSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$receipt.baselineJobSetSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$receipt.restartJobSetSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$receipt.baselineJobSetSha256 -cne [string]$receipt.restartJobSetSha256 -or
        $receipt.staleCursorRejected -isnot [bool] -or -not $receipt.staleCursorRejected -or
        [int]$receipt.postCleanupCount -ne 0 -or -not (Test-CanonicalUtcTimestamp $receipt.completedAt))) {
    throw "The verified acceptance receipt does not prove all three distinct tasks, stable hashes, stale rejection, and exact cleanup."
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
  if ([int]$claim.schemaVersion -ne 1 -or [string]$claim.kind -cne "development-job-search-acceptance-claim" -or
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
  $prepareAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $prepareTimestamp = [DateTime]::ParseExact(
    $prepareAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $mutateAt = $prepareTimestamp.AddSeconds(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $startedBy = "d1-search-$($SourceSha.Substring(0, 12))"
  $requests = @()
  foreach ($phase in @("prepare", "mutate", "cleanup")) {
    $phaseAt = if ($phase -ceq "mutate") { $mutateAt } else { $prepareAt }
    $request = New-RunTaskRequest -Runtime $runtime -Phase $phase -PlanRunId $RunId -At $phaseAt -ClientToken "d1-search-$phase-$([guid]::NewGuid().ToString('N'))" -StartedBy $startedBy
    $null = Assert-RunTaskRequest -Request $request -Runtime $runtime -Phase $phase -PlanRunId $RunId -At $phaseAt
    $requests += [ordered]@{ phase = $phase; request = $request }
  }
  if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) {
    $ExecutionPlanPath = Join-Path $operatorRoot "execution-$($SourceSha.Substring(0, 12))-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$($RunId.Substring(0, 8)).json"
  }
  $executionPath = Resolve-PathBelowRoot -Candidate $ExecutionPlanPath -AllowedRoot $operatorRoot
  $plan = [ordered]@{
    schemaVersion = 1; kind = "development-job-search-stale-cursor-acceptance"; environment = "development"; region = $Region; accountId = $ExpectedAccountId
    stateBucket = $StateBucket; stateKey = $stateKey; stateLineage = $script:currentState.Lineage; stateSerial = $script:currentState.Serial; stateVersionId = $script:currentState.VersionId
    sourceSha = $SourceSha; migrationReceiptPath = $migrationReceipt.Path; migrationReceiptSha256 = $ReviewedMigrationReceiptSha256; migrationImage = $migrationReceipt.ImageUri
    gateway = [ordered]@{ functionName = $gateway.FunctionName; aliasName = $gateway.AliasName; version = $gateway.Version; artifactSha256 = $gateway.ArtifactSha256; codeSha256 = $gateway.CodeSha256 }
    runId = $RunId; prepareAt = $prepareAt; mutateAt = $mutateAt; createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    runtime = [ordered]@{ clusterArn = $runtime.ClusterArn; taskDefinitionArn = $runtime.TaskDefinitionArn; subnets = @($runtime.Subnets); securityGroup = $runtime.SecurityGroup }
    requests = $requests
  }
  Write-JsonFile -Path $executionPath -Value $plan
  $sha = Get-FileSha256 -Path $executionPath
  $null = Read-ExecutionPlan -Path $executionPath -Sha256 $sha -Snapshot $script:currentState -Receipt $migrationReceipt -Gateway $gateway -RequireFresh
  [pscustomobject]@{ Outcome = "review-required"; ExecutionPlanPath = $executionPath; ExecutionPlanSha256 = $sha; RunId = $RunId; RequestedTaskCount = 3; DatabaseWrites = 0 }
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
    schemaVersion = 1; kind = "development-job-search-stale-cursor-acceptance"; environment = "development"; sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256; migrationReceiptSha256 = $ReviewedMigrationReceiptSha256
    gatewayArtifactSha256 = $ExpectedGatewayArtifactSha256; gatewayVersion = $ExpectedGatewayVersion; runId = [string]$plan.runId
    phase = "claiming"; claimKey = ""; claimVersionId = ""; claimChecksumSHA256 = ""
    prepareTaskArn = ""; mutateTaskArn = ""; cleanupTaskArn = ""; queryTokenSha256 = ""; baselineJobSetSha256 = ""; restartJobSetSha256 = ""
    staleCursorRejected = $false; postCleanupCount = -1; startedAt = [DateTimeOffset]::UtcNow.ToString("o"); completedAt = ""
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
  $queryToken = "d1search$(([string]$plan.runId).Replace('-', ''))"
  try {
    $receipt.phase = "running"; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $prepareMayHaveStarted = $true
    $receipt.prepareTaskArn = Submit-AcceptanceTask -Request $requestByPhase.prepare
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $prepare = Wait-AcceptanceTask -Request $requestByPhase.prepare -TaskArn $receipt.prepareTaskArn -Phase "prepare" -PlanRunId ([string]$plan.runId)
    $queryToken = [string]$prepare.queryToken; $receipt.queryTokenSha256 = Get-TextSha256 $queryToken

    $baselineResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "baseline" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 25 })
    $baseline = Assert-SearchPageResponse -Response $baselineResponse -ExpectedCount 2 -ForbidCursor
    $receipt.baselineJobSetSha256 = Get-TextSha256 ($baseline.Ids -join "`n")
    $firstResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "page-one-before" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 1 })
    $first = Assert-SearchPageResponse -Response $firstResponse -ExpectedCount 1 -RequireCursor

    $receipt.mutateTaskArn = Submit-AcceptanceTask -Request $requestByPhase.mutate; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    $null = Wait-AcceptanceTask -Request $requestByPhase.mutate -TaskArn $receipt.mutateTaskArn -Phase "mutate" -PlanRunId ([string]$plan.runId)
    $staleResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "stale-cursor" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 1; cursor = $first.Cursor })
    $null = Assert-StaleCursorResponse -Response $staleResponse; $receipt.staleCursorRejected = $true

    $restartOneResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "restart-one" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 1 })
    $restartOne = Assert-SearchPageResponse -Response $restartOneResponse -ExpectedCount 1 -RequireCursor
    $restartTwoResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "restart-two" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 1; cursor = $restartOne.Cursor })
    $restartTwo = Assert-SearchPageResponse -Response $restartTwoResponse -ExpectedCount 1 -ForbidCursor
    $restartIds = @($restartOne.Ids + $restartTwo.Ids)
    if (@($restartIds | Sort-Object -Unique).Count -ne 2 -or ($restartIds -join "|") -cne ($baseline.Ids -join "|")) {
      throw "The fresh restart was not complete, ordered, and duplicate-free."
    }
    $receipt.restartJobSetSha256 = Get-TextSha256 ($restartIds -join "`n")
  } catch { $primaryFailure = $_ }
  finally {
    if ($prepareMayHaveStarted) {
      try {
        $receipt.cleanupTaskArn = Submit-AcceptanceTask -Request $requestByPhase.cleanup; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
        $null = Wait-AcceptanceTask -Request $requestByPhase.cleanup -TaskArn $receipt.cleanupTaskArn -Phase "cleanup" -PlanRunId ([string]$plan.runId)
        $emptyResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "post-cleanup" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 25 })
        $null = Assert-SearchPageResponse -Response $emptyResponse -ExpectedCount 0 -ForbidCursor
        $receipt.postCleanupCount = 0
      } catch { $cleanupFailure = $_ }
    }
  }
  if ($null -ne $cleanupFailure) {
    $receipt.phase = "cleanup-required"; Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Synthetic search acceptance did not prove cleanup. Retain the receipt and use only reviewed RecoverCleanup."
  }
  if ($null -ne $primaryFailure) {
    $receipt.phase = "failed-cleaned"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Synthetic search acceptance failed; exact cleanup completed, and no acceptance claim is made."
  }
  if (-not $receipt.staleCursorRejected -or $receipt.postCleanupCount -ne 0 -or $receipt.baselineJobSetSha256 -cne $receipt.restartJobSetSha256) {
    $receipt.phase = "failed-cleaned"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
    throw "Synthetic search acceptance did not close every bounded invariant."
  }
  $receipt.phase = "verified"; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o"); Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace
  $receiptSha = Get-FileSha256 -Path $resolvedReceipt
  [pscustomobject]@{
    Outcome = "verified-and-cleaned"; ReceiptPath = $resolvedReceipt; ReceiptSha256 = $receiptSha; RunId = [string]$plan.runId
    StaleCursorStatus = 409; RestartedJobCount = 2; DuplicateJobCount = 0; PostCleanupJobCount = 0
    PersistentFixtureRows = 0; PersistentCatalogRevisionChange = $true
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
  $null = Wait-AcceptanceTask -Request $requestByPhase.cleanup -TaskArn $cleanupArn -Phase "cleanup" -PlanRunId ([string]$plan.runId)
  $queryToken = "d1search$(([string]$plan.runId).Replace('-', ''))"
  $emptyResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "recovery-post-cleanup" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 25 })
  $null = Assert-SearchPageResponse -Response $emptyResponse -ExpectedCount 0 -ForbidCursor
  $acceptanceReceipt.cleanupTaskArn = $cleanupArn; $acceptanceReceipt.postCleanupCount = 0; $acceptanceReceipt.phase = "recovered-cleaned"
  $acceptanceReceipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
  Write-JsonFile -Path $receiptEvidence.Path -Value $acceptanceReceipt -AllowReplace
  [pscustomobject]@{ Outcome = "cleanup-recovered"; ReceiptPath = $receiptEvidence.Path; ReceiptSha256 = (Get-FileSha256 $receiptEvidence.Path); PostCleanupJobCount = 0; AcceptanceClaim = $false }
  exit 0
}

if ([string]$acceptanceReceipt.phase -cne "verified" -or -not $acceptanceReceipt.staleCursorRejected -or [int]$acceptanceReceipt.postCleanupCount -ne 0 -or
    [string]$acceptanceReceipt.baselineJobSetSha256 -notmatch '^[a-f0-9]{64}$' -or [string]$acceptanceReceipt.baselineJobSetSha256 -cne [string]$acceptanceReceipt.restartJobSetSha256 -or
    -not (Test-CanonicalUtcTimestamp $acceptanceReceipt.completedAt)) {
  throw "Verify accepts only a completed, cleaned, internally consistent acceptance receipt."
}
$queryToken = "d1search$(([string]$plan.runId).Replace('-', ''))"
$emptyResponse = Invoke-GatewaySearch -Gateway $gateway -CaseName "verify-post-cleanup" -Body ([ordered]@{ query = $queryToken; sort = "freshness"; pageSize = 25 })
$null = Assert-SearchPageResponse -Response $emptyResponse -ExpectedCount 0 -ForbidCursor
$endingState = Read-StateSnapshot
if ([string]$endingState.Lineage -cne [string]$script:currentState.Lineage -or [long]$endingState.Serial -ne [long]$script:currentState.Serial -or [string]$endingState.VersionId -cne [string]$script:currentState.VersionId) {
  throw "Terraform state changed during the read-only acceptance verification."
}
Assert-ZeroActiveTasks -ClusterArn ([string]$runtime.ClusterArn)
[pscustomobject]@{
  Outcome = "verified"; ReceiptSha256 = $ReviewedReceiptSha256; StaleCursorStatus = 409; RestartedJobCount = 2
  DuplicateJobCount = 0; PostCleanupJobCount = 0; PersistentFixtureRows = 0
  PersistentCatalogRevisionChange = $true; StateChanged = $false; CloudMutation = $false
}
