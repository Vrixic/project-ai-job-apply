[CmdletBinding()]
param(
  [ValidateSet("Status", "PlanExecution", "Execute", "RecoverCleanup", "Verify")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^(?:|[a-f0-9]{40})$")][string]$SourceSha = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$FixtureSetSha256 = "",
  [string]$MigrationReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedMigrationReceiptSha256 = "",
  [string]$ExecutionPlanPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedExecutionPlanSha256 = "",
  [string]$ReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedReceiptSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-document-processing-acceptance.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action PlanExecution `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action Execute `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -FixtureSetSha256 REVIEWED_FIXTURE_SET_SHA256 `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256 `
    -ExecutionPlanPath REVIEWED_EXECUTION_PLAN -ReviewedExecutionPlanSha256 SHA256

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action RecoverCleanup `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -FixtureSetSha256 REVIEWED_FIXTURE_SET_SHA256 `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256 `
    -ExecutionPlanPath REVIEWED_EXECUTION_PLAN -ReviewedExecutionPlanSha256 SHA256 `
    -ReceiptPath REVIEWED_RECEIPT -ReviewedReceiptSha256 SHA256

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -FixtureSetSha256 REVIEWED_FIXTURE_SET_SHA256 `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256 `
    -ExecutionPlanPath REVIEWED_EXECUTION_PLAN -ReviewedExecutionPlanSha256 SHA256 `
    -ReceiptPath REVIEWED_SUCCESS_RECEIPT -ReviewedReceiptSha256 SHA256

This operator proves the generated-synthetic document flow while the mapping, GuardDuty rule, and
reconciler remain disabled. It invokes the deployed gateway and processor aliases synchronously
with exact bounded events. The direct gateway invocation fabricates an already-validated authorizer
context, so it does not prove API Gateway routing, JWT/JWKS validation, or authorizer enforcement.
It also does not prove GuardDuty service detection, EventBridge delivery, SQS delivery, or
event-source mapping activation. Those claims remain behind ADR-023 and a separate human-authorized
activation operator.
No action accepts document bytes, filenames, object IDs, subjects, arbitrary commands, containers,
roles, routes, or network destinations.
"@
  exit 0
}

if ($Region -cne "us-east-2") {
  throw "Development document acceptance is restricted to us-east-2."
}
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-processing-acceptance"
$migrationReceiptRoot = Join-Path $terraformRoot "development-migration-image"
$terraformRuntimeData = Join-Path $terraformRoot "development-document-processing-acceptance-data"
$fixtureGenerator = Join-Path $PSScriptRoot "lib\development-document-processing-fixtures.mjs"
$stateKey = "platform.tfstate"
$containerName = "database-migration"
$migrationFamily = "ai-job-apply-development-database-migration"
$applicationLogGroup = "/ai-job-apply/development/application"
$acceptanceCommand = @("documents/dist/src/run-document-processing-acceptance.js")
$confirmation = "generated-synthetic-only"
$actions = @("preflight", "clean", "reviewed", "terminal", "contradiction", "rollback-probe", "cleanup")
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""
$script:reviewedRuntimeIdentity = $null
$script:reviewedRuntimeImage = $null
$script:reviewedStateLineage = $null
$script:reviewedStateSerial = $null
$script:operatorSourceSha = $null
$script:sourceToOperatorDeltaSha256 = $null

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FileSha256Base64 {
  param([Parameter(Mandatory)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    [Convert]::ToBase64String($sha.ComputeHash($stream))
  }
  finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}

function Get-OperatorDeltaEvidence {
  param(
    [Parameter(Mandatory)][string]$FromSha,
    [Parameter(Mandatory)][string]$ToSha
  )
  & git -C $repositoryRoot merge-base --is-ancestor $FromSha $ToSha 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The earlier reviewed source must be an ancestor of the later operator source."
  }
  $records = @(& git -C $repositoryRoot diff --name-status --no-renames "$FromSha..$ToSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The reviewed operator source delta is unreadable." }
  $allowed = @(
    '^docs/',
    '^scripts/operate-development-document-processing-acceptance\.ps1$',
    '^scripts/tests/development-document-processing-acceptance-operator\.tests\.ps1$',
    '^infrastructure/runbooks/deployments/development-document-processing-acceptance\.md$'
  )
  foreach ($record in $records) {
    $parts = $record -split "`t", 2
    if ($parts.Count -ne 2 -or $parts[0] -notmatch '^[AM]$') {
      throw "The reviewed operator delta contains an ambiguous change."
    }
    if (@($allowed | Where-Object { $parts[1] -match $_ }).Count -ne 1) {
      throw "The reviewed operator delta changes deployed application or infrastructure source."
    }
  }
  $patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$FromSha..$ToSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The canonical reviewed operator patch is unreadable." }
  $payload = "development-document-operator-delta-v1`n$FromSha`n$ToSha`n--name-status--`n" +
    (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n")
  [pscustomobject]@{
    FromSha = $FromSha
    ToSha = $ToSha
    Sha256 = Get-TextSha256 -Value $payload
  }
}

function Get-RecoveryOperatorDeltaEvidence {
  param(
    [Parameter(Mandatory)][string]$FromSha,
    [Parameter(Mandatory)][string]$ToSha
  )
  & git -C $repositoryRoot merge-base --is-ancestor $FromSha $ToSha 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The earlier reviewed source must be an ancestor of the recovery operator source."
  }
  $allRecords = @(& git -C $repositoryRoot diff --name-status --no-renames "$FromSha..$ToSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The recovery operator source delta is unreadable." }
  $allowed = @(
    '^docs/',
    '^scripts/operate-development-document-processing-acceptance\.ps1$',
    '^scripts/tests/development-document-processing-acceptance-operator\.tests\.ps1$',
    '^infrastructure/runbooks/deployments/development-document-processing-acceptance\.md$'
  )
  $protectedDependencies = @(
    'scripts/lib/deployment-operator-guards.ps1',
    'scripts/lib/development-document-dark-guards.ps1',
    'scripts/lib/development-document-processing-fixtures.mjs'
  )
  $records = @()
  foreach ($record in $allRecords) {
    $parts = $record -split "`t", 2
    if ($parts.Count -ne 2) { throw "The recovery operator delta contains an ambiguous change." }
    if ($parts[1] -in $protectedDependencies) {
      throw "A recovery operator dependency changed after the reviewed source."
    }
    if (@($allowed | Where-Object { $parts[1] -match $_ }).Count -eq 1) {
      if ($parts[0] -notmatch '^[AM]$') {
        throw "The recovery operator packet contains an ambiguous change."
      }
      $records += $record
    }
  }
  $pathspecs = @(
    'docs',
    'scripts/operate-development-document-processing-acceptance.ps1',
    'scripts/tests/development-document-processing-acceptance-operator.tests.ps1',
    'infrastructure/runbooks/deployments/development-document-processing-acceptance.md'
  )
  $patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$FromSha..$ToSha" -- @pathspecs 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The canonical recovery operator patch is unreadable." }
  $payload = "development-document-recovery-operator-delta-v1`n$FromSha`n$ToSha`n--name-status--`n" +
    (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n")
  [pscustomobject]@{
    FromSha = $FromSha
    ToSha = $ToSha
    Sha256 = Get-TextSha256 -Value $payload
  }
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  $property.Value
}

function Get-OptionalItems {
  param(
    [Parameter(Mandatory)][object]$Object,
    [Parameter(Mandatory)][string]$Name
  )
  $value = Get-OptionalProperty -Object $Object -Name $Name
  if ($null -eq $value) { return @() }
  @($value)
}

function Test-EcsFaultInjectionDisabled {
  param([Parameter(Mandatory)][object]$TaskDefinition)
  $property = $TaskDefinition.PSObject.Properties['enableFaultInjection']
  if ($null -eq $property) { return $true }
  $property.Value -is [bool] -and $property.Value -eq $false
}

function Assert-ExactPropertySet {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string]$Description,
    [Parameter(Mandatory)][string[]]$ExpectedNames
  )
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($ExpectedNames | Sort-Object)
  if (($actual -join '|') -cne ($expected -join '|')) {
    throw "$Description has an unexpected property set."
  }
}

function ConvertFrom-OperatorJson {
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Description)
  try {
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
      $Json | ConvertFrom-Json -DateKind String
    }
    else {
      $Json | ConvertFrom-Json
    }
  }
  catch { throw "$Description is not valid JSON." }
}

function Test-CanonicalTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string] -or [string]$Value -notmatch '^20[0-9]{2}-') { return $false }
  $parsed = [DateTimeOffset]::MinValue
  [DateTimeOffset]::TryParseExact(
    [string]$Value,
    'o',
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  )
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][object]$Value,
    [switch]$AllowReplace
  )
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  if (-not $AllowReplace -and (Test-Path -LiteralPath $Path)) {
    throw "Refusing to replace existing operator evidence."
  }
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText(
      $temporary,
      ($Value | ConvertTo-Json -Depth 50),
      [Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporary -Destination $Path -Force:$AllowReplace
  }
  finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Resolve-OperatorPath {
  param(
    [Parameter(Mandatory)][string]$Candidate,
    [Parameter(Mandatory)][string]$AllowedRoot,
    [switch]$MustExist
  )
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) {
    [IO.Path]::GetFullPath($Candidate)
  }
  else {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Candidate))
  }
  $prefix = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Operator evidence must stay below its ignored development .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "An operator evidence file is missing."
  }
  $resolved
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed. Refresh the development IAM Identity Center session."
  }
  if (-not $raw) { return $null }
  ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description "$Operation response"
}

function Assert-ActionInputs {
  $releaseActions = @('PlanExecution', 'Execute', 'RecoverCleanup', 'Verify')
  if ($Action -in $releaseActions) {
    $migrationInputs = @($MigrationReceiptPath, $ReviewedMigrationReceiptSha256) |
      Where-Object { [string]::IsNullOrWhiteSpace($_) }
    if ($SourceSha -notmatch '^[a-f0-9]{40}$' -or @($migrationInputs).Count -ne 0) {
      throw "$Action requires the exact source and migration image receipt pair."
    }
  }
  if ($Action -in @('Execute', 'RecoverCleanup', 'Verify')) {
    $executionInputs = @($FixtureSetSha256, $ExecutionPlanPath, $ReviewedExecutionPlanSha256) |
      Where-Object { [string]::IsNullOrWhiteSpace($_) }
    if ($FixtureSetSha256 -notmatch '^[a-f0-9]{64}$' -or @($executionInputs).Count -ne 0) {
      throw "$Action requires the exact fixture digest and reviewed execution plan."
    }
  }
  elseif (-not [string]::IsNullOrWhiteSpace($FixtureSetSha256)) {
    throw "Only execution, recovery, and verification accept a fixture-set digest."
  }
  if ($Action -in @('RecoverCleanup', 'Verify')) {
    $receiptInputs = @($ReceiptPath, $ReviewedReceiptSha256) |
      Where-Object { [string]::IsNullOrWhiteSpace($_) }
    if (@($receiptInputs).Count -ne 0) {
      throw "$Action requires the exact reviewed acceptance receipt."
    }
  }
}

function Assert-CallerAndSource {
  param([switch]$RequireSource)
  foreach ($command in @('aws', 'terraform', 'node')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }
  $identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity', '--output', 'json') -Operation 'AWS caller validation'
  if (
    [string]$identity.Account -cne $ExpectedAccountId -or
    -not ([string]$identity.Arn).Contains(':assumed-role/')
  ) {
    throw "Use the exact temporary development IAM Identity Center caller."
  }
  $version = (& terraform version -json 2>$null | ConvertFrom-Json).terraform_version
  if ($LASTEXITCODE -ne 0 -or [string]$version -cne '1.9.8') {
    throw "Terraform 1.9.8 is required."
  }
  if ($RequireSource) {
    $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
    $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
    $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
    $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
    if ($branch -cne 'main' -or $head -cne $origin -or $dirty.Count -ne 0) {
      throw "The operation requires clean main exactly matching origin/main."
    }
    $delta = if ($Action -in @('RecoverCleanup', 'Verify')) {
      Get-RecoveryOperatorDeltaEvidence -FromSha $SourceSha -ToSha $head
    }
    else {
      Get-OperatorDeltaEvidence -FromSha $SourceSha -ToSha $head
    }
    $script:operatorSourceSha = $head
    $script:sourceToOperatorDeltaSha256 = $delta.Sha256
  }
}

function Initialize-Backend {
  $location = (& aws s3api get-bucket-location --bucket $StateBucket --query LocationConstraint --output text 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $location -cne $Region) {
    throw "The state bucket is outside us-east-2."
  }
  $versioning = Invoke-AwsJson -Arguments @('s3api', 'get-bucket-versioning', '--bucket', $StateBucket, '--output', 'json') -Operation 'State versioning validation'
  $public = Invoke-AwsJson -Arguments @('s3api', 'get-public-access-block', '--bucket', $StateBucket, '--output', 'json') -Operation 'State public access validation'
  $block = $public.PublicAccessBlockConfiguration
  if (
    [string]$versioning.Status -cne 'Enabled' -or
    -not (ConvertTo-ExactBoolean $block.BlockPublicAcls 'BlockPublicAcls') -or
    -not (ConvertTo-ExactBoolean $block.IgnorePublicAcls 'IgnorePublicAcls') -or
    -not (ConvertTo-ExactBoolean $block.BlockPublicPolicy 'BlockPublicPolicy') -or
    -not (ConvertTo-ExactBoolean $block.RestrictPublicBuckets 'RestrictPublicBuckets')
  ) {
    throw "The state bucket is not versioned and private."
  }
  $encryption = Invoke-AwsJson -Arguments @('s3api', 'get-bucket-encryption', '--bucket', $StateBucket, '--output', 'json') -Operation 'State encryption validation'
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq 'aws:kms' -and $_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) {
    throw "The state bucket must use one customer-KMS default with bucket keys."
  }
  $script:stateKmsArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($script:stateKmsArn -notmatch "^arn:aws:kms:$Region`:$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact account and region."
  }
  $null = New-Item -ItemType Directory -Path $terraformRuntimeData -Force
  $env:TF_DATA_DIR = $terraformRuntimeData
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly "-backend-config=bucket=$StateBucket" "-backend-config=key=$stateKey" "-backend-config=region=$Region" "-backend-config=kms_key_id=$script:stateKmsArn" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The encrypted development backend could not be initialized."
  }
}

function Get-TerraformState {
  $raw = & terraform "-chdir=$terraformDirectory" show -json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    throw "Terraform state could not be inspected."
  }
  ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description 'Terraform state'
}

function Get-StateIdentity {
  $raw = & terraform "-chdir=$terraformDirectory" state pull 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Terraform state identity could not be read." }
  $state = ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description 'Terraform state identity'
  if (
    [string]$state.lineage -notmatch '^[a-f0-9-]{36}$' -or
    [long]$state.serial -lt 1 -or
    [string]$state.terraform_version -cne '1.9.8'
  ) {
    throw "Terraform state identity is invalid."
  }
  [pscustomobject]@{ Lineage = [string]$state.lineage; Serial = [long]$state.serial }
}

function Get-StateOutput {
  param([Parameter(Mandatory)][object]$State, [Parameter(Mandatory)][string]$Name)
  $property = $State.values.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) {
    throw "Terraform state omits required output '$Name'."
  }
  $property.Value.value
}

function Assert-TriggersDark {
  param([Parameter(Mandatory)][object]$State)
  $mappingId = [string](Get-StateOutput -State $State -Name 'document_scan_event_source_mapping_uuid')
  $mapping = Invoke-AwsJson -Arguments @('lambda', 'get-event-source-mapping', '--uuid', $mappingId, '--output', 'json') -Operation 'Mapping status validation'
  $rule = Invoke-AwsJson -Arguments @('events', 'describe-rule', '--name', 'ai-job-apply-development-document-scan-results', '--output', 'json') -Operation 'GuardDuty rule status validation'
  $reconciler = Invoke-AwsJson -Arguments @('events', 'describe-rule', '--name', 'ai-job-apply-development-document-processing-reconciler', '--output', 'json') -Operation 'Reconciler status validation'
  if (
    [string]$mapping.State -cne 'Disabled' -or
    [string]$rule.State -cne 'DISABLED' -or
    [string]$reconciler.State -cne 'DISABLED'
  ) {
    throw "Direct-dark acceptance requires the mapping, GuardDuty rule, and reconciler disabled."
  }
  [pscustomobject]@{
    MappingId = $mappingId
    MappingState = [string]$mapping.State
    GuardDutyRuleState = [string]$rule.State
    ReconcilerState = [string]$reconciler.State
  }
}

function Read-MigrationReceipt {
  $path = Resolve-OperatorPath -Candidate $MigrationReceiptPath -AllowedRoot $migrationReceiptRoot -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedMigrationReceiptSha256) {
    throw "The migration image receipt checksum does not match review."
  }
  $receipt = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $path -Raw) -Description 'Migration image receipt'
  Assert-ExactPropertySet -Value $receipt -Description 'Migration image receipt' -ExpectedNames @(
    'schemaVersion', 'kind', 'environment', 'region', 'sourceSha', 'boundarySha256',
    'repositoryName', 'repositoryUri', 'sourceTag', 'handoffTag', 'platform', 'created',
    'indexDigest', 'platformDigest', 'configDigest', 'compressedLayerSetSha256',
    'rootfsDiffIdSetSha256', 'phase', 'imageUri', 'scanStatus', 'criticalFindings',
    'highFindings', 'publicationStartedAt', 'publicationCompletedAt'
  )
  if (
    [int]$receipt.schemaVersion -ne 2 -or
    [string]$receipt.kind -cne 'development-migration-image-publication' -or
    [string]$receipt.environment -cne 'development' -or
    [string]$receipt.region -cne $Region -or
    [string]$receipt.sourceSha -cne $SourceSha -or
    [string]$receipt.boundarySha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.repositoryName -cne 'ai-job-apply/migration' -or
    [string]$receipt.repositoryUri -cne "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration" -or
    [string]$receipt.sourceTag -cne $SourceSha -or
    [string]$receipt.handoffTag -cne "$SourceSha-linux-amd64" -or
    [string]$receipt.platform -cne 'linux/amd64' -or
    [string]$receipt.indexDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
    [string]$receipt.platformDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
    [string]$receipt.configDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
    [string]$receipt.compressedLayerSetSha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.rootfsDiffIdSetSha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$receipt.phase -cne 'verified' -or
    [string]$receipt.imageUri -cne "$($receipt.repositoryUri)@$($receipt.platformDigest)" -or
    [string]$receipt.scanStatus -cne 'COMPLETE' -or
    [int]$receipt.criticalFindings -ne 0 -or
    [int]$receipt.highFindings -ne 0 -or
    -not (Test-CanonicalTimestamp $receipt.publicationStartedAt) -or
    -not (Test-CanonicalTimestamp $receipt.publicationCompletedAt)
  ) {
    throw "The migration image receipt does not bind the exact verified acceptance runtime."
  }
  [pscustomobject]@{ Path = $path; Receipt = $receipt; ImageUri = [string]$receipt.imageUri }
}

function Get-LambdaVersionIdentity {
  param(
    [Parameter(Mandatory)][string]$QualifiedArn,
    [Parameter(Mandatory)][string]$Description
  )
  $match = [regex]::Match(
    $QualifiedArn,
    "^(?<base>arn:aws:lambda:$Region`:$ExpectedAccountId`:function:[A-Za-z0-9-_]+):(?<version>[1-9][0-9]*)$"
  )
  if (-not $match.Success) { throw "$Description does not use an exact numeric Lambda version ARN." }
  $baseArn = $match.Groups['base'].Value
  $version = $match.Groups['version'].Value
  $configuration = Invoke-AwsJson -Arguments @(
    'lambda', 'get-function-configuration', '--function-name', $baseArn,
    '--qualifier', $version, '--output', 'json'
  ) -Operation "$Description numeric version validation"
  if (
    [string]$configuration.FunctionArn -cne $QualifiedArn -or
    [string]$configuration.Version -cne $version -or
    [string]$configuration.CodeSha256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or
    [string]$configuration.RevisionId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ) {
    throw "$Description numeric version identity is not exact."
  }
  [pscustomobject]@{
    FunctionVersion = $version
    VersionArn = $QualifiedArn
    CodeSha256 = [string]$configuration.CodeSha256
    FunctionRevisionId = [string]$configuration.RevisionId
    Configuration = $configuration
  }
}

function Get-LambdaAliasIdentity {
  param(
    [Parameter(Mandatory)][string]$AliasArn,
    [Parameter(Mandatory)][string]$Description
  )
  $match = [regex]::Match(
    $AliasArn,
    "^(?<base>arn:aws:lambda:$Region`:$ExpectedAccountId`:function:[A-Za-z0-9-_]+):(?<alias>[A-Za-z0-9-_]+)$"
  )
  if (-not $match.Success) { throw "$Description does not use an exact Lambda alias ARN." }
  $baseArn = $match.Groups['base'].Value
  $aliasName = $match.Groups['alias'].Value
  $alias = Invoke-AwsJson -Arguments @(
    'lambda', 'get-alias', '--function-name', $baseArn, '--name', $aliasName, '--output', 'json'
  ) -Operation "$Description alias validation"
  $routing = Get-OptionalProperty -Object $alias -Name 'RoutingConfig'
  $weights = if ($null -eq $routing) { $null } else { Get-OptionalProperty -Object $routing -Name 'AdditionalVersionWeights' }
  if (
    [string]$alias.AliasArn -cne $AliasArn -or
    [string]$alias.Name -cne $aliasName -or
    [string]$alias.FunctionVersion -notmatch '^[1-9][0-9]*$' -or
    [string]$alias.RevisionId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
    ($null -ne $weights -and @($weights.PSObject.Properties).Count -ne 0)
  ) {
    throw "$Description alias is retargeted, weighted, or not exact."
  }
  $versionArn = "$baseArn`:$($alias.FunctionVersion)"
  $versionIdentity = Get-LambdaVersionIdentity -QualifiedArn $versionArn -Description $Description
  [pscustomobject]@{
    FunctionVersion = [string]$versionIdentity.FunctionVersion
    VersionArn = [string]$versionIdentity.VersionArn
    CodeSha256 = [string]$versionIdentity.CodeSha256
    AliasRevisionId = [string]$alias.RevisionId
    FunctionRevisionId = [string]$versionIdentity.FunctionRevisionId
    Configuration = $versionIdentity.Configuration
  }
}

function Get-ExactRuntime {
  param([Parameter(Mandatory)][string]$ExpectedImage)
  $state = Get-TerraformState
  $clusterArn = [string](Get-StateOutput -State $state -Name 'ecs_cluster_arn')
  $taskDefinitionArn = [string](Get-StateOutput -State $state -Name 'migration_task_definition_arn')
  $subnets = @((Get-StateOutput -State $state -Name 'migration_subnet_ids'))
  $securityGroup = [string](Get-StateOutput -State $state -Name 'application_security_group_id')
  $gatewayAliasArn = [string](Get-StateOutput -State $state -Name 'gateway_lambda_alias_arn')
  $processorAliasArn = [string](Get-StateOutput -State $state -Name 'document_processor_alias_arn')
  $parserVersionArn = [string](Get-StateOutput -State $state -Name 'document_parser_version_arn')
  $bucket = [string](Get-StateOutput -State $state -Name 'candidate_document_bucket')
  $planIdentity = [string](Get-StateOutput -State $state -Name 'candidate_document_malware_protection_plan_id')
  if (
    $clusterArn -notmatch "^arn:aws:ecs:$Region`:$ExpectedAccountId`:cluster/ai-job-apply-development$" -or
    $taskDefinitionArn -notmatch "^arn:aws:ecs:$Region`:$ExpectedAccountId`:task-definition/$migrationFamily`:[1-9][0-9]*$" -or
    $subnets.Count -lt 2 -or
    @($subnets | Where-Object { $_ -notmatch '^subnet-[a-f0-9]+$' }).Count -ne 0 -or
    $securityGroup -notmatch '^sg-[a-f0-9]+$' -or
    $gatewayAliasArn -notmatch "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-gateway:development$" -or
    $processorAliasArn -notmatch "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-processor:development$" -or
    $parserVersionArn -notmatch "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" -or
    $bucket -notmatch "^ai-job-apply-development-candidate-docs-$ExpectedAccountId$" -or
    [string]::IsNullOrWhiteSpace($planIdentity)
  ) {
    throw "Terraform outputs do not bind the exact development document runtime."
  }
  $task = Invoke-AwsJson -Arguments @('ecs', 'describe-task-definition', '--task-definition', $taskDefinitionArn, '--output', 'json') -Operation 'Task definition validation'
  $definition = $task.taskDefinition
  $containers = @($definition.containerDefinitions)
  $container = @($containers | Where-Object { [string]$_.name -ceq $containerName })
  if (
    [string]$definition.status -cne 'ACTIVE' -or
    [string]$definition.family -cne $migrationFamily -or
    $containers.Count -ne 1 -or
    $container.Count -ne 1 -or
    [string]$container[0].image -cne $ExpectedImage -or
    [string]$container[0].logConfiguration.options.'awslogs-group' -cne $applicationLogGroup -or
    [string]$container[0].logConfiguration.options.'awslogs-stream-prefix' -cne 'database-migration' -or
    -not (Test-EcsFaultInjectionDisabled -TaskDefinition $definition)
  ) {
    throw "The task definition does not use the exact verified image and bounded runtime."
  }
  $gatewayIdentity = Get-LambdaAliasIdentity -AliasArn $gatewayAliasArn -Description 'Gateway'
  $processorIdentity = Get-LambdaAliasIdentity -AliasArn $processorAliasArn -Description 'Document processor'
  $gatewayVariables = $gatewayIdentity.Configuration.Environment.Variables
  $processorVariables = $processorIdentity.Configuration.Environment.Variables
  $parserQualifiedArn = [string]$processorVariables.DOCUMENT_PARSER_FUNCTION_ARN
  $parserIdentity = Get-LambdaVersionIdentity -QualifiedArn $parserQualifiedArn -Description 'Document parser'
  $planArn = [string]$processorVariables.GUARDDUTY_PROTECTION_PLAN_ARN
  if (
    [string]$gatewayVariables.OIDC_ISSUER -notmatch '^https://' -or
    [string]::IsNullOrWhiteSpace([string]$gatewayVariables.OIDC_AUDIENCE) -or
    [string]$gatewayVariables.DOCUMENT_UPLOAD_BUCKET -cne $bucket -or
    [string]$gatewayVariables.DOCUMENT_UPLOAD_KMS_KEY_ARN -cne [string]$processorVariables.PLATFORM_KMS_KEY_ARN -or
    [string]$processorVariables.PLATFORM_KMS_KEY_ARN -notmatch "^arn:aws:kms:$Region`:$ExpectedAccountId`:key/" -or
    $planArn -notmatch "^arn:aws:guardduty:$Region`:$ExpectedAccountId`:malware-protection-plan/[A-Za-z0-9]+$" -or
    ($planIdentity -cne $planArn -and -not $planArn.EndsWith("/$planIdentity", [StringComparison]::Ordinal)) -or
    $parserQualifiedArn -cne $parserVersionArn
  ) {
    throw "The deployed aliases do not expose the exact nonsecret runtime identity."
  }
  [pscustomobject]@{
    State = $state
    ClusterArn = $clusterArn
    TaskDefinitionArn = $taskDefinitionArn
    Subnets = @($subnets | Sort-Object)
    SecurityGroup = $securityGroup
    GatewayAliasArn = $gatewayAliasArn
    GatewayAliasVersion = $gatewayIdentity.FunctionVersion
    GatewayVersionArn = $gatewayIdentity.VersionArn
    GatewayCodeSha256 = $gatewayIdentity.CodeSha256
    GatewayAliasRevisionId = $gatewayIdentity.AliasRevisionId
    GatewayFunctionRevisionId = $gatewayIdentity.FunctionRevisionId
    ProcessorAliasArn = $processorAliasArn
    ProcessorAliasVersion = $processorIdentity.FunctionVersion
    ProcessorVersionArn = $processorIdentity.VersionArn
    ProcessorCodeSha256 = $processorIdentity.CodeSha256
    ProcessorAliasRevisionId = $processorIdentity.AliasRevisionId
    ProcessorFunctionRevisionId = $processorIdentity.FunctionRevisionId
    ParserVersion = $parserIdentity.FunctionVersion
    ParserVersionArn = $parserIdentity.VersionArn
    ParserCodeSha256 = $parserIdentity.CodeSha256
    ParserFunctionRevisionId = $parserIdentity.FunctionRevisionId
    CandidateDocumentBucket = $bucket
    GatewayUploadBucket = [string]$gatewayVariables.DOCUMENT_UPLOAD_BUCKET
    GatewayUploadKmsKeyArn = [string]$gatewayVariables.DOCUMENT_UPLOAD_KMS_KEY_ARN
    ProtectionPlanArn = $planArn
    PlatformKmsKeyArn = [string]$processorVariables.PLATFORM_KMS_KEY_ARN
    Issuer = [string]$gatewayVariables.OIDC_ISSUER
    Audience = [string]$gatewayVariables.OIDC_AUDIENCE
  }
}

function ConvertTo-ReviewedRuntimeIdentity {
  param([Parameter(Mandatory)][object]$Runtime)
  [ordered]@{
    clusterArn = $Runtime.ClusterArn
    taskDefinitionArn = $Runtime.TaskDefinitionArn
    subnets = @($Runtime.Subnets)
    securityGroup = $Runtime.SecurityGroup
    gatewayAliasArn = $Runtime.GatewayAliasArn
    gatewayAliasVersion = $Runtime.GatewayAliasVersion
    gatewayVersionArn = $Runtime.GatewayVersionArn
    gatewayCodeSha256 = $Runtime.GatewayCodeSha256
    gatewayAliasRevisionId = $Runtime.GatewayAliasRevisionId
    gatewayFunctionRevisionId = $Runtime.GatewayFunctionRevisionId
    processorAliasArn = $Runtime.ProcessorAliasArn
    processorAliasVersion = $Runtime.ProcessorAliasVersion
    processorVersionArn = $Runtime.ProcessorVersionArn
    processorCodeSha256 = $Runtime.ProcessorCodeSha256
    processorAliasRevisionId = $Runtime.ProcessorAliasRevisionId
    processorFunctionRevisionId = $Runtime.ProcessorFunctionRevisionId
    parserVersion = $Runtime.ParserVersion
    parserVersionArn = $Runtime.ParserVersionArn
    parserCodeSha256 = $Runtime.ParserCodeSha256
    parserFunctionRevisionId = $Runtime.ParserFunctionRevisionId
    candidateDocumentBucket = $Runtime.CandidateDocumentBucket
    gatewayUploadBucket = $Runtime.GatewayUploadBucket
    gatewayUploadKmsKeyArn = $Runtime.GatewayUploadKmsKeyArn
    protectionPlanArn = $Runtime.ProtectionPlanArn
    platformKmsKeyArn = $Runtime.PlatformKmsKeyArn
    issuer = $Runtime.Issuer
    audience = $Runtime.Audience
    mappingState = 'Disabled'
    guardDutyRuleState = 'DISABLED'
    reconcilerState = 'DISABLED'
  }
}

function Assert-ReviewedRuntimeUnchanged {
  if ($null -eq $script:reviewedRuntimeIdentity) { return }
  $current = Get-ExactRuntime -ExpectedImage $script:reviewedRuntimeImage
  $identity = Get-StateIdentity
  if (
    [string]$identity.Lineage -cne [string]$script:reviewedStateLineage -or
    [long]$identity.Serial -ne [long]$script:reviewedStateSerial -or
    (ConvertTo-DeploymentCanonicalValue (ConvertTo-ReviewedRuntimeIdentity -Runtime $current)) -cne
      (ConvertTo-DeploymentCanonicalValue $script:reviewedRuntimeIdentity)
  ) {
    throw "The reviewed direct-dark runtime changed before a cloud mutation."
  }
  Assert-TriggersDark -State $current.State | Out-Null
}

function Assert-ZeroTasks {
  param([Parameter(Mandatory)][string]$ClusterArn)
  $running = Invoke-AwsJson -Arguments @('ecs', 'list-tasks', '--cluster', $ClusterArn, '--family', $migrationFamily, '--desired-status', 'RUNNING', '--output', 'json') -Operation 'Running task validation'
  $pending = Invoke-AwsJson -Arguments @('ecs', 'list-tasks', '--cluster', $ClusterArn, '--family', $migrationFamily, '--desired-status', 'PENDING', '--output', 'json') -Operation 'Pending task validation'
  if (@($running.taskArns).Count -ne 0 -or @($pending.taskArns).Count -ne 0) {
    throw "Acceptance requires zero running or pending migration-family tasks."
  }
}

function Read-FixtureDescriptor {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$ExpectedDigest
  )
  $resolved = Resolve-OperatorPath -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  $descriptor = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $resolved -Raw) -Description 'Fixture descriptor'
  Assert-ExactPropertySet -Value $descriptor -Description 'Fixture descriptor' -ExpectedNames @(
    'schemaVersion', 'kind', 'runId', 'fixtureSetSha256', 'manifest', 'files'
  )
  if (
    [int]$descriptor.schemaVersion -ne 1 -or
    [string]$descriptor.kind -cne 'development-document-processing-fixtures' -or
    [string]$descriptor.runId -cne $RunId -or
    [string]$descriptor.fixtureSetSha256 -cne $ExpectedDigest -or
    @($descriptor.manifest).Count -ne 4 -or
    @($descriptor.files).Count -ne 4
  ) {
    throw "The fixture descriptor does not bind the exact four-fixture set."
  }
  $expectedRoles = @('clean-docx', 'clean-pdf', 'invalid-pdf', 'malware-test')
  if ((@($descriptor.manifest.fixture | Sort-Object) -join '|') -cne ($expectedRoles -join '|')) {
    throw "The fixture descriptor roles are incomplete."
  }
  foreach ($entry in @($descriptor.manifest)) {
    Assert-ExactPropertySet -Value $entry -Description 'Fixture manifest entry' -ExpectedNames @(
      'fixture', 'fileName', 'mediaType', 'sizeBytes', 'sha256'
    )
    $file = @($descriptor.files | Where-Object { [string]$_.fixture -ceq [string]$entry.fixture })
    if ($file.Count -ne 1) { throw "A fixture file mapping is missing or duplicated." }
    Assert-ExactPropertySet -Value $file[0] -Description 'Fixture file mapping' -ExpectedNames @('fixture', 'path')
    $filePath = Resolve-OperatorPath -Candidate ([string]$file[0].path) -AllowedRoot $operatorRoot -MustExist
    if (
      [string]$entry.fileName -notmatch "^generated-$($RunId.Replace('-', ''))-(?:clean\.pdf|clean\.docx|invalid\.pdf|malware-test\.pdf)$" -or
      [long]$entry.sizeBytes -ne (Get-Item -LiteralPath $filePath).Length -or
      [string]$entry.sha256 -notmatch '^[a-f0-9]{64}$' -or
      (Get-FileSha256 $filePath) -cne [string]$entry.sha256
    ) {
      throw "A fixture file does not match its authenticated manifest entry."
    }
    Add-Member -InputObject $file[0] -NotePropertyName resolvedPath -NotePropertyValue $filePath -Force
  }
  $canonical = @($descriptor.manifest | Sort-Object fixture | ForEach-Object {
      [ordered]@{
        fixture = [string]$_.fixture
        fileName = [string]$_.fileName
        mediaType = [string]$_.mediaType
        sizeBytes = [long]$_.sizeBytes
        sha256 = [string]$_.sha256
      }
    })
  $bytes = [Text.Encoding]::UTF8.GetBytes(($canonical | ConvertTo-Json -Depth 10 -Compress))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  if ($digest -cne $ExpectedDigest) {
    throw "The fixture manifest canonical digest does not match review."
  }
  [pscustomobject]@{
    Path = $resolved
    Descriptor = $descriptor
    ManifestJson = ($canonical | ConvertTo-Json -Depth 10 -Compress)
  }
}

function New-TaskRequest {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][ValidateSet('preflight', 'clean', 'reviewed', 'terminal', 'contradiction', 'rollback-probe', 'cleanup', 'recovery-cleanup')][string]$Phase,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$ManifestJson,
    [Parameter(Mandatory)][string]$ManifestDigest,
    [Parameter(Mandatory)][string]$Issuer
  )
  $actionValue = if ($Phase -ceq 'recovery-cleanup') { 'cleanup' } else { $Phase }
  [ordered]@{
    cluster = $Runtime.ClusterArn
    taskDefinition = $Runtime.TaskDefinitionArn
    launchType = 'FARGATE'
    platformVersion = '1.4.0'
    count = 1
    enableExecuteCommand = $false
    networkConfiguration = [ordered]@{
      awsvpcConfiguration = [ordered]@{
        subnets = @($Runtime.Subnets)
        securityGroups = @($Runtime.SecurityGroup)
        assignPublicIp = 'DISABLED'
      }
    }
    overrides = [ordered]@{
      containerOverrides = @([ordered]@{
          name = $containerName
          command = @($acceptanceCommand)
          environment = @(
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM'; value = $confirmation },
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_ACTION'; value = $actionValue },
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID'; value = $RunId },
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256'; value = $ManifestDigest },
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST'; value = $ManifestJson },
            [ordered]@{ name = 'DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER'; value = $Issuer }
          )
        })
    }
    clientToken = "doc-accept-$($RunId.Replace('-', ''))-$Phase"
    startedBy = 'd1-document-processing-acceptance'
  }
}

function Assert-TaskRequest {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$Phase,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$ManifestJson,
    [Parameter(Mandatory)][string]$ManifestDigest,
    [Parameter(Mandatory)][string]$Issuer
  )
  $expected = New-TaskRequest -Runtime $Runtime -Phase $Phase -RunId $RunId -ManifestJson $ManifestJson -ManifestDigest $ManifestDigest -Issuer $Issuer
  $expected.clientToken = $Request.clientToken
  if ((ConvertTo-DeploymentCanonicalValue $Request) -cne (ConvertTo-DeploymentCanonicalValue $expected)) {
    throw "The $Phase task request differs from the fixed generated-synthetic request."
  }
  $environment = @($Request.overrides.containerOverrides[0].environment)
  $expectedNames = @(
    'DOCUMENT_PROCESSING_ACCEPTANCE_ACTION',
    'DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM',
    'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST',
    'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256',
    'DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER',
    'DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID'
  )
  if ($environment.Count -ne 6 -or (@($environment.name | Sort-Object) -join '|') -cne ($expectedNames -join '|')) {
    throw "The $Phase task must contain exactly six fixed environment entries."
  }
}

function Submit-Task {
  param([Parameter(Mandatory)][object]$Request)
  Assert-ReviewedRuntimeUnchanged
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporary -Value $Request -AllowReplace
    $response = Invoke-AwsJson -Arguments @('ecs', 'run-task', '--cli-input-json', "file://$temporary", '--output', 'json') -Operation 'Acceptance task submission'
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne 1) {
    throw "The exact acceptance task was not accepted once."
  }
  $task = @($response.tasks)[0]
  if (
    [string]$task.clusterArn -cne [string]$Request.cluster -or
    [string]$task.taskDefinitionArn -cne [string]$Request.taskDefinition -or
    -not (Test-EcsFaultInjectionDisabled -TaskDefinition $task)
  ) {
    throw "The accepted task does not match the reviewed request."
  }
  [string]$task.taskArn
}

function Get-ExpectedAggregate {
  param([Parameter(Mandatory)][string]$Phase)
  switch ($Phase) {
    'preflight' {
      [ordered]@{ documentCount = 0; parsedCount = 0; rejectedCount = 0; failedCount = 0; securityHoldCount = 0; receiptCount = 0; dispositionCount = 0; profileFactCount = 0; profileVersionCount = 0; evidenceCount = 0; persistentRows = 0; rollbackProved = $false }
    }
    'clean' {
      [ordered]@{ documentCount = 2; parsedCount = 2; rejectedCount = 0; failedCount = 0; securityHoldCount = 0; receiptCount = 2; dispositionCount = 2; profileFactCount = 3; profileVersionCount = 3; evidenceCount = 3; persistentRows = 30; rollbackProved = $false }
    }
    'reviewed' {
      [ordered]@{ documentCount = 2; parsedCount = 2; rejectedCount = 0; failedCount = 0; securityHoldCount = 0; receiptCount = 2; dispositionCount = 2; profileFactCount = 3; profileVersionCount = 6; evidenceCount = 5; persistentRows = 41; rollbackProved = $false }
    }
    'terminal' {
      [ordered]@{ documentCount = 4; parsedCount = 2; rejectedCount = 2; failedCount = 0; securityHoldCount = 0; receiptCount = 4; dispositionCount = 4; profileFactCount = 3; profileVersionCount = 6; evidenceCount = 5; persistentRows = 56; rollbackProved = $false }
    }
    'contradiction' {
      [ordered]@{ documentCount = 4; parsedCount = 1; rejectedCount = 2; failedCount = 1; securityHoldCount = 1; receiptCount = 5; dispositionCount = 4; profileFactCount = 3; profileVersionCount = 7; evidenceCount = 6; persistentRows = 61; rollbackProved = $false }
    }
    'rollback-probe' {
      [ordered]@{ documentCount = 4; parsedCount = 1; rejectedCount = 2; failedCount = 1; securityHoldCount = 1; receiptCount = 5; dispositionCount = 4; profileFactCount = 3; profileVersionCount = 7; evidenceCount = 6; persistentRows = 61; rollbackProved = $true }
    }
    'cleanup' {
      [ordered]@{ documentCount = 0; parsedCount = 0; rejectedCount = 0; failedCount = 0; securityHoldCount = 0; receiptCount = 0; dispositionCount = 0; profileFactCount = 0; profileVersionCount = 0; evidenceCount = 0; persistentRows = 0; rollbackProved = $false }
    }
    default { throw "The aggregate phase is invalid." }
  }
}

function Wait-Task {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][string]$TaskArn,
    [Parameter(Mandatory)][string]$Phase,
    [Parameter(Mandatory)][string]$RunId
  )
  $null = & aws ecs wait tasks-stopped --cluster $Request.cluster --tasks $TaskArn 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The $Phase task did not reach STOPPED." }
  $described = Invoke-AwsJson -Arguments @('ecs', 'describe-tasks', '--cluster', $Request.cluster, '--tasks', $TaskArn, '--output', 'json') -Operation "$Phase task validation"
  if (@($described.failures).Count -ne 0 -or @($described.tasks).Count -ne 1) {
    throw "The $Phase task could not be read back exactly once."
  }
  $task = @($described.tasks)[0]
  $containers = @($task.containers)
  if ($containers.Count -eq 1 -and $containers[0].PSObject.Properties.Name -notcontains 'exitCode') {
    if (
      [string]$task.stopCode -ceq 'TaskFailedToStart' -and
      [string]$task.stoppedReason -like 'ResourceInitializationError:*'
    ) {
      $startupFailure = [InvalidOperationException]::new(
        "The $Phase task encountered a retryable ECS resource-initialization failure.")
      $startupFailure.Data['RetryableEcsResourceInitialization'] = $true
      throw $startupFailure
    }
    throw "The $Phase task stopped before its container produced an exit code."
  }
  if (
    [string]$task.clusterArn -cne [string]$Request.cluster -or
    [string]$task.taskDefinitionArn -cne [string]$Request.taskDefinition -or
    [string]$task.lastStatus -cne 'STOPPED' -or
    $containers.Count -ne 1 -or
    [int]$containers[0].exitCode -ne 0 -or
    (ConvertTo-DeploymentCanonicalValue $task.overrides) -cne (ConvertTo-DeploymentCanonicalValue $Request.overrides) -or
    -not (Test-EcsFaultInjectionDisabled -TaskDefinition $task)
  ) {
    throw "The $Phase task did not stop successfully with the exact reviewed override."
  }
  $taskId = ($TaskArn -split '/')[-1]
  $stream = "database-migration/$containerName/$taskId"
  $messages = @()
  for ($index = 0; $index -lt 30 -and $messages.Count -eq 0; $index += 1) {
    $logs = Invoke-AwsJson -Arguments @('logs', 'get-log-events', '--log-group-name', $applicationLogGroup, '--log-stream-name', $stream, '--start-from-head', '--limit', '10', '--output', 'json') -Operation "$Phase log validation"
    $messages = @($logs.events | ForEach-Object { [string]$_.message } | Where-Object { $_ })
    if ($messages.Count -eq 0) { Start-Sleep -Seconds 2 }
  }
  if ($messages.Count -ne 1) {
    throw "The $Phase task did not emit exactly one aggregate result."
  }
  $result = ConvertFrom-OperatorJson -Json $messages[0] -Description "$Phase aggregate result"
  $expectedNames = @(
    'schemaVersion', 'kind', 'action', 'runId', 'documentCount', 'parsedCount', 'rejectedCount',
    'failedCount', 'securityHoldCount', 'receiptCount', 'dispositionCount', 'profileFactCount',
    'profileVersionCount', 'evidenceCount', 'persistentRows', 'rollbackProved', 'canonicalSha256'
  )
  Assert-ExactPropertySet -Value $result -Description "$Phase aggregate result" -ExpectedNames $expectedNames
  if (
    [int]$result.schemaVersion -ne 1 -or
    [string]$result.kind -cne 'development-document-processing-acceptance' -or
    [string]$result.action -cne $Phase -or
    [string]$result.runId -cne $RunId -or
    [string]$result.canonicalSha256 -notmatch '^[a-f0-9]{64}$' -or
    $result.rollbackProved -isnot [bool]
  ) {
    throw "The $Phase aggregate result violates the bounded schema."
  }
  $expected = Get-ExpectedAggregate -Phase $Phase
  foreach ($name in @($expected.Keys)) {
    if ($name -eq 'rollbackProved') {
      if ([bool]$result.$name -ne [bool]$expected[$name]) { throw "The $Phase rollback result is not exact." }
    }
    elseif ([long]$result.$name -ne [long]$expected[$name]) {
      throw "The $Phase aggregate count '$name' is not exact."
    }
  }
  $result
}

function Invoke-RecoveryCleanupTask {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][string]$RunId
  )
  $baseToken = [string]$Request.clientToken
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    $attemptRequest = ConvertFrom-OperatorJson `
      -Json (ConvertTo-Json $Request -Depth 30 -Compress) `
      -Description 'Recovery cleanup retry request'
    $attemptRequest.clientToken = "$baseToken-a$attempt"
    if ([string]$attemptRequest.clientToken -notmatch '^[A-Za-z0-9_-]{1,64}$') {
      throw "The recovery cleanup retry token is invalid."
    }
    try {
      $arn = Submit-Task -Request $attemptRequest
      $result = Wait-Task -Request $attemptRequest -TaskArn $arn -Phase 'cleanup' -RunId $RunId
      return [pscustomobject]@{ Arn = $arn; Result = $result }
    }
    catch {
      if (
        $_.Exception.Data['RetryableEcsResourceInitialization'] -ne $true -or
        $attempt -eq 3
      ) {
        throw
      }
      Start-Sleep -Seconds 5
    }
  }
  throw "Recovery cleanup exhausted its bounded ECS startup attempts."
}

function New-DurableClaim {
  param([Parameter(Mandatory)][object]$Plan)
  $key = "operator-claims/development-document-processing-acceptance/$ReviewedExecutionPlanSha256.json"
  $history = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $StateBucket, '--prefix', $key, '--output', 'json') -Operation 'Claim history validation'
  $claimVersions = @(Get-OptionalItems -Object $history -Name 'Versions')
  $claimMarkers = @(Get-OptionalItems -Object $history -Name 'DeleteMarkers')
  if (
    @($claimVersions | Where-Object { [string]$_.Key -ceq $key }).Count -ne 0 -or
    @($claimMarkers | Where-Object { [string]$_.Key -ceq $key }).Count -ne 0
  ) {
    throw "This execution plan already has durable claim history."
  }
  $claim = [ordered]@{
    schemaVersion = 1
    kind = 'development-document-processing-acceptance-claim'
    sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256
    runId = $Plan.runId
    claimedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Assert-ReviewedRuntimeUnchanged
    Write-JsonFile -Path $temporary -Value $claim -AllowReplace
    $checksum = Get-FileSha256Base64 $temporary
    $raw = & aws s3api put-object --bucket $StateBucket --key $key --body $temporary --if-none-match '*' --server-side-encryption aws:kms --ssekms-key-id $script:stateKmsArn --bucket-key-enabled --checksum-algorithm SHA256 --metadata "execution-plan-sha256=$ReviewedExecutionPlanSha256,source-sha=$SourceSha,run-id=$($Plan.runId)" --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "The durable claim could not be created." }
    $put = ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description 'Claim response'
    if ([string]$put.ChecksumSHA256 -cne $checksum -or -not $put.VersionId) {
      throw "The durable claim response is invalid."
    }
    $head = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $StateBucket, '--key', $key, '--version-id', [string]$put.VersionId, '--checksum-mode', 'ENABLED', '--output', 'json') -Operation 'Claim readback validation'
    if (
      [string]$head.VersionId -cne [string]$put.VersionId -or
      [string]$head.ChecksumSHA256 -cne $checksum -or
      [string]$head.ServerSideEncryption -cne 'aws:kms' -or
      [string]$head.SSEKMSKeyId -cne $script:stateKmsArn
    ) {
      throw "The durable claim readback is invalid."
    }
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  [pscustomobject]@{ Key = $key; VersionId = [string]$put.VersionId; ChecksumSHA256 = $checksum }
}

function Invoke-LambdaJson {
  param(
    [Parameter(Mandatory)][string]$FunctionArn,
    [Parameter(Mandatory)][object]$Payload,
    [Parameter(Mandatory)][string]$Operation
  )
  Assert-ReviewedRuntimeUnchanged
  $requestPath = [IO.Path]::GetTempFileName()
  $responsePath = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $requestPath -Value $Payload -AllowReplace
    $raw = & aws lambda invoke --function-name $FunctionArn --invocation-type RequestResponse --cli-binary-format raw-in-base64-out --payload "fileb://$requestPath" $responsePath --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
    $metadata = ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description "$Operation metadata"
    if ([int]$metadata.StatusCode -ne 200 -or $metadata.PSObject.Properties['FunctionError']) {
      throw "$Operation returned a Lambda function error."
    }
    $response = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $responsePath -Raw) -Description "$Operation payload"
    [pscustomobject]@{ Metadata = $metadata; Payload = $response }
  }
  finally {
    Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
  }
}

function New-GatewayEvent {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][object]$Body,
    [AllowNull()][string]$IdempotencyKey
  )
  $headers = [ordered]@{ 'content-type' = 'application/json' }
  if (-not [string]::IsNullOrWhiteSpace($IdempotencyKey)) {
    $headers['idempotency-key'] = $IdempotencyKey
  }
  $requestId = "accept-$($RunId.Replace('-', ''))-$([guid]::NewGuid().ToString('N'))"
  [ordered]@{
    version = '2.0'
    routeKey = "$Method $Path"
    rawPath = $Path
    rawQueryString = ''
    headers = $headers
    requestContext = [ordered]@{
      accountId = $ExpectedAccountId
      apiId = 'direct-dark-acceptance'
      domainName = 'direct-dark.invalid'
      domainPrefix = 'direct-dark'
      http = [ordered]@{
        method = $Method
        path = $Path
        protocol = 'HTTP/1.1'
        sourceIp = '127.0.0.1'
        userAgent = 'd1-document-processing-acceptance'
      }
      requestId = $requestId
      routeKey = "$Method $Path"
      stage = '$default'
      time = [DateTimeOffset]::UtcNow.ToString('dd/MMM/yyyy:HH:mm:ss zzz', [Globalization.CultureInfo]::InvariantCulture)
      timeEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      authorizer = [ordered]@{
        jwt = [ordered]@{
          claims = [ordered]@{
            iss = $Runtime.Issuer
            sub = "d1-document-processing-acceptance:$RunId"
            aud = @($Runtime.Audience)
            scope = 'documents:read documents:write profile:read profile:write'
          }
          scopes = @('documents:read', 'documents:write', 'profile:read', 'profile:write')
        }
      }
    }
    isBase64Encoded = $false
    body = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 20 -Compress }
  }
}

function Invoke-Gateway {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][object]$Body = $null,
    [AllowNull()][string]$IdempotencyKey = $null,
    [Parameter(Mandatory)][int]$ExpectedStatus
  )
  $event = New-GatewayEvent -Runtime $Runtime -RunId $RunId -Method $Method -Path $Path -Body $Body -IdempotencyKey $IdempotencyKey
  $response = Invoke-LambdaJson -FunctionArn $Runtime.GatewayAliasArn -Payload $event -Operation 'Direct gateway invocation'
  $payload = $response.Payload
  if (
    [int]$payload.statusCode -ne $ExpectedStatus -or
    (Get-OptionalProperty -Object $payload -Name 'isBase64Encoded') -ne $false -or
    [string]::IsNullOrWhiteSpace([string]$payload.body)
  ) {
    throw "The direct gateway response did not match the exact expected status."
  }
  ConvertFrom-OperatorJson -Json ([string]$payload.body) -Description 'Direct gateway response body'
}

function Get-Fixture {
  param([Parameter(Mandatory)][object]$FixtureEvidence, [Parameter(Mandatory)][string]$Role)
  $entry = @($FixtureEvidence.Descriptor.manifest | Where-Object { [string]$_.fixture -ceq $Role })
  $file = @($FixtureEvidence.Descriptor.files | Where-Object { [string]$_.fixture -ceq $Role })
  if ($entry.Count -ne 1 -or $file.Count -ne 1) { throw "The requested fixture role is not exact." }
  [pscustomobject]@{ Entry = $entry[0]; Path = [string]$file[0].resolvedPath }
}

function Assert-PresignedUploadTarget {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Upload,
    [Parameter(Mandatory)][string]$ExpectedKey
  )
  Assert-ExactPropertySet -Value $Upload.fields -Description 'Presigned upload fields' -ExpectedNames @(
    'Content-Type', 'Policy', 'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date',
    'X-Amz-Security-Token', 'X-Amz-Signature', 'bucket', 'key', 'success_action_status',
    'x-amz-meta-document-id', 'x-amz-meta-sha256', 'x-amz-server-side-encryption',
    'x-amz-server-side-encryption-aws-kms-key-id'
  )
  $expectedUrl = "https://$($Runtime.CandidateDocumentBucket).s3.$Region.amazonaws.com/"
  $uri = $null
  if (
    -not [Uri]::TryCreate([string]$Upload.url, [UriKind]::Absolute, [ref]$uri) -or
    [string]$Upload.url -cne $expectedUrl -or
    $uri.Scheme -cne 'https' -or
    $uri.Host -cne "$($Runtime.CandidateDocumentBucket).s3.$Region.amazonaws.com" -or
    $uri.Port -ne 443 -or
    $uri.AbsolutePath -cne '/' -or
    -not [string]::IsNullOrEmpty($uri.Query) -or
    -not [string]::IsNullOrEmpty($uri.Fragment) -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    [string]$Upload.fields.bucket -cne $Runtime.CandidateDocumentBucket -or
    [string]$Upload.fields.key -cne $ExpectedKey -or
    [string]$Upload.fields.'X-Amz-Algorithm' -cne 'AWS4-HMAC-SHA256' -or
    [string]$Upload.fields.'X-Amz-Credential' -notmatch "^[A-Z0-9]{16,128}/[0-9]{8}/$Region/s3/aws4_request$" -or
    [string]$Upload.fields.'X-Amz-Date' -notmatch '^[0-9]{8}T[0-9]{6}Z$' -or
    [string]::IsNullOrWhiteSpace([string]$Upload.fields.'X-Amz-Security-Token') -or
    [string]$Upload.fields.'X-Amz-Signature' -notmatch '^[a-f0-9]{64}$' -or
    [string]$Upload.fields.Policy -notmatch '^[A-Za-z0-9+/]+={0,2}$'
  ) {
    throw "The presigned upload target is outside the exact reviewed bucket and quarantine key."
  }
  $true
}

function Invoke-PresignedPost {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Upload,
    [Parameter(Mandatory)][string]$ExpectedKey,
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string]$FileName,
    [Parameter(Mandatory)][string]$MediaType
  )
  Assert-ReviewedRuntimeUnchanged
  Assert-PresignedUploadTarget -Runtime $Runtime -Upload $Upload -ExpectedKey $ExpectedKey | Out-Null
  Add-Type -AssemblyName System.Net.Http
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler, $true)
  $content = [Net.Http.MultipartFormDataContent]::new()
  try {
    foreach ($property in @($Upload.fields.PSObject.Properties)) {
      $part = [Net.Http.StringContent]::new([string]$property.Value)
      $content.Add($part, [string]$property.Name)
    }
    $bytes = [IO.File]::ReadAllBytes($FilePath)
    $filePart = [Net.Http.ByteArrayContent]::new($bytes)
    $filePart.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new($MediaType)
    $content.Add($filePart, 'file', $FileName)
    $response = $client.PostAsync([Uri]$Upload.url, $content).GetAwaiter().GetResult()
    if ([int]$response.StatusCode -ne 204) {
      throw "The exact presigned document upload was not accepted."
    }
  }
  finally {
    $content.Dispose()
    $client.Dispose()
  }
}

function Register-And-UploadFixture {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$FixtureEvidence,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$Role,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][Collections.ArrayList]$Documents
  )
  Assert-TriggersDark -State $Runtime.State | Out-Null
  $fixture = Get-Fixture -FixtureEvidence $FixtureEvidence -Role $Role
  $entry = $fixture.Entry
  $body = [ordered]@{
    fileName = [string]$entry.fileName
    mediaType = [string]$entry.mediaType
    sizeBytes = [long]$entry.sizeBytes
    sha256 = [string]$entry.sha256
  }
  $created = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'POST' -Path '/v1/resumes/uploads' -Body $body -IdempotencyKey "document-acceptance-$($RunId.Replace('-', ''))-$Role" -ExpectedStatus 201
  $document = $created.document
  $upload = $created.upload
  if (
    [string]$document.id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
    [string]$document.fileName -cne [string]$entry.fileName -or
    [string]$document.mediaType -cne [string]$entry.mediaType -or
    [long]$document.sizeBytes -ne [long]$entry.sizeBytes -or
    [string]$document.sha256 -cne [string]$entry.sha256 -or
    [string]$document.status -cne 'awaiting_upload' -or
    [string]$upload.method -cne 'POST' -or
    [string]$upload.url -notmatch '^https://' -or
    [DateTimeOffset]::Parse([string]$upload.expiresAt) -gt [DateTimeOffset]::UtcNow.AddMinutes(5)
  ) {
    throw "The gateway did not return the exact bounded upload registration."
  }
  $key = "quarantine/$($document.id)/source"
  if (
    [string]$upload.fields.key -cne $key -or
    [string]$upload.fields.'Content-Type' -cne [string]$entry.mediaType -or
    [string]$upload.fields.'x-amz-server-side-encryption' -cne 'aws:kms' -or
    [string]$upload.fields.'x-amz-server-side-encryption-aws-kms-key-id' -cne $Runtime.PlatformKmsKeyArn -or
    [string]$upload.fields.'x-amz-meta-document-id' -cne [string]$document.id -or
    [string]$upload.fields.'x-amz-meta-sha256' -cne [string]$entry.sha256 -or
    [string]$upload.fields.success_action_status -cne '204'
  ) {
    throw "The upload grant does not bind the exact document object."
  }
  $descriptor = [pscustomobject]@{
    role = $Role
    documentId = [string]$document.id
    sourceKey = $key
    sourceVersion = ''
    mediaType = [string]$entry.mediaType
    sizeBytes = [long]$entry.sizeBytes
    sha256 = [string]$entry.sha256
    normalizedKey = ''
    normalizedVersion = ''
  }
  $null = $Documents.Add($descriptor)
  Save-RecoveryDescriptor -Receipt $Receipt -Documents @($Documents)
  Assert-PresignedUploadTarget -Runtime $Runtime -Upload $upload -ExpectedKey $key | Out-Null
  Invoke-PresignedPost -Runtime $Runtime -Upload $upload -ExpectedKey $key -FilePath $fixture.Path -FileName ([string]$entry.fileName) -MediaType ([string]$entry.mediaType)
  $head = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $key, '--checksum-mode', 'ENABLED', '--output', 'json') -Operation 'Uploaded object readback'
  $expectedChecksum = Convert-HexToBase64 -Hex ([string]$entry.sha256)
  if (
    -not $head.VersionId -or
    [long]$head.ContentLength -ne [long]$entry.sizeBytes -or
    [string]$head.ContentType -cne [string]$entry.mediaType -or
    [string]$head.ServerSideEncryption -cne 'aws:kms' -or
    [string]$head.SSEKMSKeyId -cne $Runtime.PlatformKmsKeyArn -or
    [string]$head.Metadata.'document-id' -cne [string]$document.id -or
    [string]$head.Metadata.sha256 -cne [string]$entry.sha256 -or
    ($head.ChecksumSHA256 -and [string]$head.ChecksumSHA256 -cne $expectedChecksum)
  ) {
    throw "The uploaded object version does not match its exact registration and digest."
  }
  $versions = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $key, '--output', 'json') -Operation 'Uploaded object version history'
  $uploadedVersions = @(Get-OptionalItems -Object $versions -Name 'Versions')
  $uploadedMarkers = @(Get-OptionalItems -Object $versions -Name 'DeleteMarkers')
  if (
    @($uploadedVersions | Where-Object { [string]$_.Key -ceq $key }).Count -ne 1 -or
    @($uploadedMarkers | Where-Object { [string]$_.Key -ceq $key }).Count -ne 0
  ) {
    throw "The generated object key has unexpected version history."
  }
  $descriptor.sourceVersion = [string]$head.VersionId
  Save-RecoveryDescriptor -Receipt $Receipt -Documents @($Documents)
  $descriptor
}

function Convert-HexToBase64 {
  param([Parameter(Mandatory)][string]$Hex)
  $bytes = New-Object byte[] ($Hex.Length / 2)
  for ($index = 0; $index -lt $bytes.Length; $index += 1) {
    $bytes[$index] = [Convert]::ToByte($Hex.Substring($index * 2, 2), 16)
  }
  [Convert]::ToBase64String($bytes)
}

function Set-ExactScanTag {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document,
    [Parameter(Mandatory)][ValidateSet('NO_THREATS_FOUND', 'THREATS_FOUND')][string]$Status
  )
  Assert-ReviewedRuntimeUnchanged
  $tagging = [ordered]@{ TagSet = @([ordered]@{ Key = 'GuardDutyMalwareScanStatus'; Value = $Status }) }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    Write-JsonFile -Path $temporary -Value $tagging -AllowReplace
    $null = Invoke-AwsJson -Arguments @('s3api', 'put-object-tagging', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Document.sourceKey, '--version-id', $Document.sourceVersion, '--tagging', "file://$temporary", '--output', 'json') -Operation 'Exact synthetic scan tag write'
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  $readback = Invoke-AwsJson -Arguments @('s3api', 'get-object-tagging', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Document.sourceKey, '--version-id', $Document.sourceVersion, '--output', 'json') -Operation 'Exact synthetic scan tag readback'
  $tags = @($readback.TagSet)
  if (
    [string]$readback.VersionId -cne [string]$Document.sourceVersion -or
    $tags.Count -ne 1 -or
    [string]$tags[0].Key -cne 'GuardDutyMalwareScanStatus' -or
    [string]$tags[0].Value -cne $Status
  ) {
    throw "The exact synthetic scan tag was not read back."
  }
}

function New-DirectProcessorEvent {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][int]$Ordinal,
    [Parameter(Mandatory)][string]$ObservedAt,
    [Parameter(Mandatory)][ValidateSet('NO_THREATS_FOUND', 'THREATS_FOUND')][string]$ScanResult
  )
  $observedAtValue = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($ObservedAt, [ref]$observedAtValue) -or $observedAtValue.Offset -ne [TimeSpan]::Zero) {
    throw "The direct processor observedAt value must be an exact UTC timestamp."
  }
  $eventId = "direct-dark:$RunId`:$($Document.role):$Ordinal"
  $messageTimestamp = [string]$observedAtValue.ToUnixTimeMilliseconds()
  $scan = [ordered]@{
    schemaVersion = 1
    eventId = $eventId
    accountId = $ExpectedAccountId
    region = $Region
    protectionPlanArn = [string]$Runtime.ProtectionPlanArn
    bucketName = [string]$Runtime.CandidateDocumentBucket
    objectKey = $Document.sourceKey
    objectVersion = $Document.sourceVersion
    scanStatus = 'COMPLETED'
    scanResult = $ScanResult
    observedAt = $ObservedAt
  }
  $recordBody = $scan | ConvertTo-Json -Depth 10 -Compress
  $record = [ordered]@{
    messageId = "direct-dark-$($RunId.Replace('-', ''))-$Ordinal"
    receiptHandle = "direct-dark-$($RunId.Replace('-', ''))-$Ordinal"
    body = $recordBody
    attributes = [ordered]@{
      ApproximateReceiveCount = '1'
      SentTimestamp = $messageTimestamp
      SenderId = $ExpectedAccountId
      ApproximateFirstReceiveTimestamp = $messageTimestamp
    }
    messageAttributes = [ordered]@{}
    md5OfBody = ([Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($recordBody)) | ForEach-Object { $_.ToString('x2') }) -join ''
    eventSource = 'aws:sqs'
    eventSourceARN = "arn:aws:sqs:$Region`:$ExpectedAccountId`:ai-job-apply-development-document-scan-results"
    awsRegion = $Region
  }
  [ordered]@{ Records = @($record) }
}

function Invoke-DirectProcessorScan {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][int]$Ordinal,
    [Parameter(Mandatory)][string]$ObservedAt,
    [Parameter(Mandatory)][ValidateSet('NO_THREATS_FOUND', 'THREATS_FOUND')][string]$ScanResult
  )
  Assert-TriggersDark -State $Runtime.State | Out-Null
  Set-ExactScanTag -Runtime $Runtime -Document $Document -Status $ScanResult
  $event = New-DirectProcessorEvent -Runtime $Runtime -Document $Document -RunId $RunId -Ordinal $Ordinal -ObservedAt $ObservedAt -ScanResult $ScanResult
  $response = Invoke-LambdaJson -FunctionArn $Runtime.ProcessorAliasArn -Payload $event -Operation 'Direct document processor invocation'
  Assert-ExactPropertySet -Value $response.Payload -Description 'Document processor response' -ExpectedNames @('batchItemFailures')
  if (@($response.Payload.batchItemFailures).Count -ne 0) {
    throw "The exact document processor event was not acknowledged."
  }
}

function Complete-NormalizedDescriptor {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document,
    [switch]$Required
  )
  if ($Document.role -notin @('clean-pdf', 'clean-docx')) { return }
  $key = "normalized/$($Document.documentId)/$($Document.sha256)/resume-parser-v1/resume.json"
  $versions = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $key, '--output', 'json') -Operation 'Normalized object version discovery'
  $exact = @(Get-OptionalItems -Object $versions -Name 'Versions' | Where-Object { [string]$_.Key -ceq $key })
  $markers = @(Get-OptionalItems -Object $versions -Name 'DeleteMarkers' | Where-Object { [string]$_.Key -ceq $key })
  if ($exact.Count -eq 0 -and -not $Required) { return }
  if ($exact.Count -ne 1 -or $markers.Count -ne 0) {
    throw "The descriptor-bound normalized object version is missing or ambiguous."
  }
  $version = [string]$exact[0].VersionId
  $head = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $key, '--version-id', $version, '--checksum-mode', 'ENABLED', '--output', 'json') -Operation 'Normalized object readback'
  if (
    [string]$head.VersionId -cne $version -or
    [string]$head.ContentType -cne 'application/json' -or
    [string]$head.ServerSideEncryption -cne 'aws:kms' -or
    [string]$head.SSEKMSKeyId -cne $Runtime.PlatformKmsKeyArn -or
    [string]$head.Metadata.'document-id' -cne [string]$Document.documentId -or
    [string]$head.Metadata.'source-sha256' -cne [string]$Document.sha256 -or
    [string]$head.Metadata.'parser-version' -cne 'resume-parser-v1' -or
    [string]$head.Metadata.'normalized-sha256' -notmatch '^[a-f0-9]{64}$'
  ) {
    throw "The normalized object does not bind the exact synthetic source."
  }
  $Document.normalizedKey = $key
  $Document.normalizedVersion = $version
}

function Invoke-ProfileReview {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$RunId
  )
  Assert-TriggersDark -State $Runtime.State | Out-Null
  $collection = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'GET' -Path '/v1/profile/facts' -ExpectedStatus 200
  $facts = @($collection.facts)
  if ([int]$collection.proposedCount -ne 3 -or [int]$collection.confirmedCount -ne 0 -or $facts.Count -ne 3) {
    throw "The synthetic profile does not contain exactly three proposed facts."
  }
  $compact = $RunId.Replace('-', '')
  $email = @($facts | Where-Object {
      [string]$_.kind -ceq 'identity' -and
      [string]$_.key -ceq 'email' -and
      [string]$_.value -ceq "candidate-$compact@example.test"
    })
  $typeScript = @($facts | Where-Object {
      [string]$_.kind -ceq 'skill' -and [string]$_.key -ceq 'skill' -and [string]$_.value -ceq 'TypeScript'
    })
  $postgres = @($facts | Where-Object {
      [string]$_.kind -ceq 'skill' -and [string]$_.key -ceq 'skill' -and [string]$_.value -ceq 'PostgreSQL'
    })
  if ($email.Count -ne 1 -or $typeScript.Count -ne 1 -or $postgres.Count -ne 1) {
    throw "The clean fixtures did not produce the exact expected synthetic facts."
  }
  foreach ($fact in $facts) {
    if (
      [string]$fact.id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      [int]$fact.version -ne 1 -or
      [string]$fact.verification -cne 'proposed' -or
      [string]$fact.source.type -cne 'resume' -or
      @($fact.evidence.supportingSpans).Count -ne 1
    ) {
      throw "A proposed synthetic fact is outside the exact review boundary."
    }
  }
  $updates = @(
    [pscustomobject]@{ Fact = $email[0]; Body = [ordered]@{ expectedVersion = 1; verification = 'confirmed' }; Key = 'email-confirm' },
    [pscustomobject]@{ Fact = $typeScript[0]; Body = [ordered]@{ expectedVersion = 1; value = 'TypeScript (reviewed synthetic)'; verification = 'confirmed' }; Key = 'typescript-edit-confirm' },
    [pscustomobject]@{ Fact = $postgres[0]; Body = [ordered]@{ expectedVersion = 1; verification = 'rejected' }; Key = 'postgresql-reject' }
  )
  foreach ($update in $updates) {
    $updated = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'PATCH' -Path "/v1/profile/facts/$($update.Fact.id)" -Body $update.Body -IdempotencyKey "document-acceptance-$($RunId.Replace('-', ''))-$($update.Key)" -ExpectedStatus 200
    if ([int]$updated.version -ne 2) { throw "The exact profile review did not create version 2." }
  }
  $reviewed = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'GET' -Path '/v1/profile/facts' -ExpectedStatus 200
  $reviewedFacts = @($reviewed.facts)
  $confirmed = @($reviewedFacts | Where-Object { [string]$_.verification -ceq 'confirmed' })
  $rejected = @($reviewedFacts | Where-Object { [string]$_.verification -ceq 'rejected' })
  $edited = @($reviewedFacts | Where-Object { [string]$_.value -ceq 'TypeScript (reviewed synthetic)' })
  if (
    $reviewedFacts.Count -ne 3 -or
    [int]$reviewed.confirmedCount -ne 2 -or
    [int]$reviewed.proposedCount -ne 0 -or
    $confirmed.Count -ne 2 -or
    $rejected.Count -ne 1 -or
    $edited.Count -ne 1 -or
    [string]$edited[0].source.type -cne 'user' -or
    $edited[0].PSObject.Properties['evidence']
  ) {
    throw "The exact synthetic review decisions were not persisted."
  }
}

function Save-RecoveryDescriptor {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Documents
  )
  Assert-ReviewedRuntimeUnchanged
  $descriptor = [ordered]@{
    schemaVersion = 1
    kind = 'development-document-processing-recovery'
    sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256
    runId = $Receipt.runId
    documents = @($Documents)
    updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  $temporary = [IO.Path]::GetTempFileName()
  $key = "operator-recovery/development-document-processing-acceptance/$ReviewedExecutionPlanSha256.json"
  try {
    Write-JsonFile -Path $temporary -Value $descriptor -AllowReplace
    $checksum = Get-FileSha256Base64 $temporary
    $raw = & aws s3api put-object --bucket $StateBucket --key $key --body $temporary --server-side-encryption aws:kms --ssekms-key-id $script:stateKmsArn --bucket-key-enabled --checksum-algorithm SHA256 --metadata "execution-plan-sha256=$ReviewedExecutionPlanSha256,source-sha=$SourceSha,run-id=$($Receipt.runId)" --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "The encrypted recovery descriptor could not be saved." }
    $put = ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description 'Recovery descriptor response'
    if ([string]$put.ChecksumSHA256 -cne $checksum -or -not $put.VersionId) {
      throw "The recovery descriptor response is invalid."
    }
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  $Receipt.recoveryKey = $key
  $Receipt.recoveryVersionId = [string]$put.VersionId
  $Receipt.recoveryChecksumSHA256 = $checksum
}

function Read-RecoveryDescriptor {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$FixtureEvidence
  )
  if (
    [string]$Receipt.recoveryKey -cne "operator-recovery/development-document-processing-acceptance/$ReviewedExecutionPlanSha256.json" -or
    -not $Receipt.recoveryVersionId -or
    [string]$Receipt.recoveryChecksumSHA256 -notmatch '^[A-Za-z0-9+/]{43}=$'
  ) {
    throw "The receipt does not bind an exact encrypted recovery descriptor."
  }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $raw = & aws s3api get-object --bucket $StateBucket --key $Receipt.recoveryKey --version-id $Receipt.recoveryVersionId --checksum-mode ENABLED $temporary --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "The encrypted recovery descriptor could not be read." }
    $get = ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description 'Recovery descriptor readback'
    if (
      [string]$get.VersionId -cne [string]$Receipt.recoveryVersionId -or
      [string]$get.ChecksumSHA256 -cne [string]$Receipt.recoveryChecksumSHA256 -or
      (Get-FileSha256Base64 $temporary) -cne [string]$Receipt.recoveryChecksumSHA256
    ) {
      throw "The recovery descriptor checksum does not match the receipt."
    }
    $descriptor = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $temporary -Raw) -Description 'Recovery descriptor'
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  $null = Assert-RecoveryDescriptor -Descriptor $descriptor -Receipt $Receipt -FixtureEvidence $FixtureEvidence
  @($descriptor.documents)
}

function Assert-RecoveryDescriptor {
  param(
    [Parameter(Mandatory)][object]$Descriptor,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$FixtureEvidence
  )
  Assert-ExactPropertySet -Value $descriptor -Description 'Recovery descriptor' -ExpectedNames @(
    'schemaVersion', 'kind', 'sourceSha', 'executionPlanSha256', 'runId', 'documents', 'updatedAt'
  )
  if (
    [int]$descriptor.schemaVersion -ne 1 -or
    [string]$descriptor.kind -cne 'development-document-processing-recovery' -or
    [string]$descriptor.sourceSha -cne $SourceSha -or
    [string]$descriptor.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
    [string]$descriptor.runId -cne [string]$Receipt.runId -or
    @($descriptor.documents).Count -gt 4 -or
    -not (Test-CanonicalTimestamp $descriptor.updatedAt)
  ) {
    throw "The recovery descriptor does not bind the reviewed execution."
  }
  $roles = @{}
  $ids = @{}
  foreach ($document in @($descriptor.documents)) {
    Assert-ExactPropertySet -Value $document -Description 'Recovery document descriptor' -ExpectedNames @(
      'role', 'documentId', 'sourceKey', 'sourceVersion', 'mediaType', 'sizeBytes', 'sha256',
      'normalizedKey', 'normalizedVersion'
    )
    $role = [string]$document.role
    $id = [string]$document.documentId
    $manifest = @($FixtureEvidence.Descriptor.manifest | Where-Object { [string]$_.fixture -ceq $role })
    if (
      $manifest.Count -ne 1 -or
      $roles.ContainsKey($role) -or
      $ids.ContainsKey($id) -or
      $id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      [string]$document.sourceKey -cne "quarantine/$id/source" -or
      ([string]$document.sourceVersion -and [string]$document.sourceVersion -notmatch '^.{1,1024}$') -or
      [string]$document.mediaType -cne [string]$manifest[0].mediaType -or
      [long]$document.sizeBytes -ne [long]$manifest[0].sizeBytes -or
      [string]$document.sha256 -cne [string]$manifest[0].sha256
    ) {
      throw "A recovery document is outside the reviewed fixture boundary."
    }
    $roles[$role] = $true
    $ids[$id] = $true
    $normalizedKey = [string]$document.normalizedKey
    $normalizedVersion = [string]$document.normalizedVersion
    if ([string]::IsNullOrWhiteSpace($normalizedKey) -xor [string]::IsNullOrWhiteSpace($normalizedVersion)) {
      throw "A recovery normalized object pair is incomplete."
    }
    if (-not [string]::IsNullOrWhiteSpace($normalizedKey)) {
      $expectedKey = "normalized/$id/$($document.sha256)/resume-parser-v1/resume.json"
      if (
        $role -notin @('clean-pdf', 'clean-docx') -or
        $normalizedKey -cne $expectedKey -or
        $normalizedVersion -notmatch '^.{1,1024}$'
      ) {
        throw "A recovery normalized object is outside the reviewed derivation."
      }
    }
  }
  $true
}

function Remove-ExactObjectVersion {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Version
  )
  if ([string]::IsNullOrWhiteSpace($Key) -or [string]::IsNullOrWhiteSpace($Version)) {
    throw "Exact object cleanup requires a descriptor-bound key and version."
  }
  $before = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $Key, '--output', 'json') -Operation 'Pre-cleanup object history'
  if (Test-ExactObjectAlreadyRemoved -History $before -Key $Key -Version $Version) { return }
  Assert-ReviewedRuntimeUnchanged
  $null = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Key, '--version-id', $Version, '--output', 'json') -Operation 'Pre-cleanup object readback'
  $deleted = Invoke-AwsJson -Arguments @('s3api', 'delete-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Key, '--version-id', $Version, '--output', 'json') -Operation 'Exact versioned object cleanup'
  if ([string]$deleted.VersionId -cne $Version -or $deleted.DeleteMarker -eq $true) {
    throw "The exact versioned object cleanup response is invalid."
  }
  $history = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $Key, '--output', 'json') -Operation 'Post-cleanup object history'
  if (
    @(Get-OptionalItems -Object $history -Name 'Versions').Count -ne 0 -or
    @(Get-OptionalItems -Object $history -Name 'DeleteMarkers').Count -ne 0
  ) {
    throw "The exact generated object key was not reduced to zero versions."
  }
}

function Test-ExactObjectAlreadyRemoved {
  param(
    [Parameter(Mandatory)][object]$History,
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Version
  )
  $versions = @(Get-OptionalItems -Object $History -Name 'Versions')
  $markers = @(Get-OptionalItems -Object $History -Name 'DeleteMarkers')
  if ($versions.Count -eq 0 -and $markers.Count -eq 0) { return $true }
  if (
    $versions.Count -ne 1 -or
    $markers.Count -ne 0 -or
    [string]$versions[0].Key -cne $Key -or
    [string]$versions[0].VersionId -cne $Version
  ) {
    throw "The pre-cleanup object history is outside the exact descriptor boundary."
  }
  $false
}

function Complete-SourceDescriptor {
  param([Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object]$Document)
  if (-not [string]::IsNullOrWhiteSpace([string]$Document.sourceVersion)) { return }
  $history = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $Document.sourceKey, '--output', 'json') -Operation 'Recovery source version discovery'
  $exact = @(Get-OptionalItems -Object $history -Name 'Versions' | Where-Object { [string]$_.Key -ceq [string]$Document.sourceKey })
  $markers = @(Get-OptionalItems -Object $history -Name 'DeleteMarkers' | Where-Object { [string]$_.Key -ceq [string]$Document.sourceKey })
  if ($exact.Count -eq 0 -and $markers.Count -eq 0) { return }
  if ($exact.Count -ne 1 -or $markers.Count -ne 0) {
    throw "The descriptor-bound source object version is ambiguous."
  }
  $version = [string]$exact[0].VersionId
  $head = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Document.sourceKey, '--version-id', $version, '--output', 'json') -Operation 'Recovery source version readback'
  if (
    [string]$head.VersionId -cne $version -or
    [long]$head.ContentLength -ne [long]$Document.sizeBytes -or
    [string]$head.ContentType -cne [string]$Document.mediaType -or
    [string]$head.ServerSideEncryption -cne 'aws:kms' -or
    [string]$head.SSEKMSKeyId -cne $Runtime.PlatformKmsKeyArn -or
    [string]$head.Metadata.'document-id' -cne [string]$Document.documentId -or
    [string]$head.Metadata.sha256 -cne [string]$Document.sha256
  ) {
    throw "The recovered source version does not match its exact descriptor."
  }
  $Document.sourceVersion = $version
}

function Remove-DescriptorObjects {
  param([Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object[]]$Documents)
  foreach ($document in @($Documents)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$document.normalizedKey)) {
      Remove-ExactObjectVersion -Runtime $Runtime -Key ([string]$document.normalizedKey) -Version ([string]$document.normalizedVersion)
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$document.sourceVersion)) {
      Remove-ExactObjectVersion -Runtime $Runtime -Key ([string]$document.sourceKey) -Version ([string]$document.sourceVersion)
    }
  }
}

function Read-ExecutionPlan {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Sha,
    [switch]$RequireFresh
  )
  $resolved = Resolve-OperatorPath -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  if ((Get-FileSha256 $resolved) -cne $Sha) {
    throw "The execution plan checksum does not match review."
  }
  $plan = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $resolved -Raw) -Description 'Execution plan'
  Assert-ExactPropertySet -Value $plan -Description 'Execution plan' -ExpectedNames @(
    'schemaVersion', 'kind', 'environment', 'region', 'accountId', 'stateBucket', 'stateLineage',
    'stateSerial', 'sourceSha', 'operatorSourceSha', 'sourceToOperatorDeltaSha256',
    'fixtureSetSha256', 'fixtureDescriptorPath',
    'fixtureDescriptorSha256', 'fixtureManifest', 'migrationReceiptSha256', 'migrationImage',
    'runId', 'createdAt', 'runtime', 'requests'
  )
  Assert-ExactPropertySet -Value $plan.runtime -Description 'Execution plan runtime' -ExpectedNames @(
    'clusterArn', 'taskDefinitionArn', 'subnets', 'securityGroup',
    'gatewayAliasArn', 'gatewayAliasVersion', 'gatewayVersionArn', 'gatewayCodeSha256',
    'gatewayAliasRevisionId', 'gatewayFunctionRevisionId',
    'processorAliasArn', 'processorAliasVersion', 'processorVersionArn', 'processorCodeSha256',
    'processorAliasRevisionId', 'processorFunctionRevisionId',
    'parserVersion', 'parserVersionArn', 'parserCodeSha256', 'parserFunctionRevisionId',
    'candidateDocumentBucket', 'gatewayUploadBucket', 'gatewayUploadKmsKeyArn',
    'protectionPlanArn', 'platformKmsKeyArn', 'issuer', 'audience',
    'mappingState', 'guardDutyRuleState', 'reconcilerState'
  )
  $requestPhases = @($plan.requests.phase)
  $expectedPhases = @($actions + 'recovery-cleanup')
  $operatorBindingValid = (
    [string]$plan.operatorSourceSha -ceq $script:operatorSourceSha -and
    [string]$plan.sourceToOperatorDeltaSha256 -ceq $script:sourceToOperatorDeltaSha256
  )
  if (-not $operatorBindingValid -and $Action -in @('RecoverCleanup', 'Verify')) {
    $originalOperatorDelta = Get-OperatorDeltaEvidence -FromSha $SourceSha -ToSha ([string]$plan.operatorSourceSha)
    $null = Get-RecoveryOperatorDeltaEvidence -FromSha ([string]$plan.operatorSourceSha) -ToSha $script:operatorSourceSha
    $operatorBindingValid = (
      [string]$plan.sourceToOperatorDeltaSha256 -ceq [string]$originalOperatorDelta.Sha256
    )
  }
  if (
    [int]$plan.schemaVersion -ne 1 -or
    [string]$plan.kind -cne 'development-document-processing-acceptance-plan' -or
    [string]$plan.environment -cne 'development' -or
    [string]$plan.region -cne $Region -or
    [string]$plan.accountId -cne $ExpectedAccountId -or
    [string]$plan.stateBucket -cne $StateBucket -or
    [string]$plan.sourceSha -cne $SourceSha -or
    -not $operatorBindingValid -or
    [string]$plan.fixtureSetSha256 -notmatch '^[a-f0-9]{64}$' -or
    ($FixtureSetSha256 -and [string]$plan.fixtureSetSha256 -cne $FixtureSetSha256) -or
    [string]$plan.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or
    [string]$plan.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
    -not (Test-CanonicalTimestamp $plan.createdAt) -or
    @($plan.requests).Count -ne 8 -or
    ($requestPhases -join '|') -cne ($expectedPhases -join '|')
  ) {
    throw "The execution plan does not bind the exact direct-dark acceptance."
  }
  $fixture = Read-FixtureDescriptor -Path ([string]$plan.fixtureDescriptorPath) -RunId ([string]$plan.runId) -ExpectedDigest ([string]$plan.fixtureSetSha256)
  if (
    (Get-FileSha256 $fixture.Path) -cne [string]$plan.fixtureDescriptorSha256 -or
    (ConvertTo-DeploymentCanonicalValue @($plan.fixtureManifest)) -cne (ConvertTo-DeploymentCanonicalValue @($fixture.Descriptor.manifest))
  ) {
    throw "The execution plan fixture descriptor does not match review."
  }
  if ($RequireFresh) {
    $created = [DateTimeOffset]::ParseExact([string]$plan.createdAt, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    if ([Math]::Abs(([DateTimeOffset]::UtcNow - $created).TotalMinutes) -gt 15) {
      throw "The execution plan is outside its 15-minute review window."
    }
  }
  [pscustomobject]@{ Path = $resolved; Plan = $plan; Fixture = $fixture }
}

function Read-AcceptanceReceipt {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Sha,
    [Parameter(Mandatory)][string]$ExpectedOperatorSourceSha,
    [Parameter(Mandatory)][string]$ExpectedSourceToOperatorDeltaSha256
  )
  $resolved = Resolve-OperatorPath -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  if ((Get-FileSha256 $resolved) -cne $Sha) {
    throw "The acceptance receipt checksum does not match review."
  }
  $receipt = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $resolved -Raw) -Description 'Acceptance receipt'
  Assert-ExactPropertySet -Value $receipt -Description 'Acceptance receipt' -ExpectedNames @(
    'schemaVersion', 'kind', 'environment', 'sourceSha', 'operatorSourceSha',
    'sourceToOperatorDeltaSha256', 'fixtureSetSha256',
    'migrationReceiptSha256', 'executionPlanSha256', 'runId', 'phase', 'claimKey',
    'claimVersionId', 'claimChecksumSHA256', 'recoveryKey', 'recoveryVersionId',
    'recoveryChecksumSHA256', 'taskArns', 'resultSha256ByAction', 'persistentRows',
    'rollbackProved', 'databaseCleaned', 'objectsRemoved', 'startedAt', 'completedAt'
  )
  if (
    [int]$receipt.schemaVersion -ne 1 -or
    [string]$receipt.kind -cne 'development-document-processing-acceptance' -or
    [string]$receipt.environment -cne 'development' -or
    [string]$receipt.sourceSha -cne $SourceSha -or
    [string]$receipt.operatorSourceSha -cne $ExpectedOperatorSourceSha -or
    [string]$receipt.sourceToOperatorDeltaSha256 -cne $ExpectedSourceToOperatorDeltaSha256 -or
    [string]$receipt.fixtureSetSha256 -cne $FixtureSetSha256 -or
    [string]$receipt.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or
    [string]$receipt.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or
    [string]$receipt.runId -notmatch '^[0-9a-f-]{36}$'
  ) {
    throw "The acceptance receipt does not bind the reviewed release and plan."
  }
  [pscustomobject]@{ Path = $resolved; Receipt = $receipt }
}

function Assert-DocumentOperationalHealth {
  param([switch]$WaitForOk)
  $queueNames = @(
    'ai-job-apply-development-document-scan-results',
    'ai-job-apply-development-document-scan-dlq',
    'ai-job-apply-development-document-scan-delivery-dlq'
  )
  foreach ($queueName in $queueNames) {
    $queue = Invoke-AwsJson -Arguments @('sqs', 'get-queue-url', '--queue-name', $queueName, '--output', 'json') -Operation 'Document queue identity validation'
    $attributes = Invoke-AwsJson -Arguments @('sqs', 'get-queue-attributes', '--queue-url', [string]$queue.QueueUrl, '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed', '--output', 'json') -Operation 'Document queue emptiness validation'
    if (
      [long]$attributes.Attributes.ApproximateNumberOfMessages -ne 0 -or
      [long]$attributes.Attributes.ApproximateNumberOfMessagesNotVisible -ne 0 -or
      [long]$attributes.Attributes.ApproximateNumberOfMessagesDelayed -ne 0
    ) {
      throw "A document-processing queue is not empty."
    }
  }
  $alarmNames = @(
    'ai-job-apply-development-document-scan-queue-age',
    'ai-job-apply-development-document-scan-dlq',
    'ai-job-apply-development-document-scan-delivery-dlq',
    'ai-job-apply-development-document-processor-errors',
    'ai-job-apply-development-document-parser-errors',
    'ai-job-apply-development-document-security-contradiction',
    'ai-job-apply-development-document-processing-record-failed',
    'ai-job-apply-development-document-processing-timed-out'
  )
  $topic = [string](Get-StateOutput -State (Get-TerraformState) -Name 'operational_alert_topic_arn')
  $attempts = if ($WaitForOk) { 60 } else { 1 }
  for ($attempt = 0; $attempt -lt $attempts; $attempt += 1) {
    $arguments = @('cloudwatch', 'describe-alarms', '--alarm-names') + $alarmNames + @('--output', 'json')
    $response = Invoke-AwsJson -Arguments $arguments -Operation 'Document alarm validation'
    $alarms = @($response.MetricAlarms)
    if ($alarms.Count -ne 8 -or (@($alarms.AlarmName | Sort-Object) -join '|') -cne (@($alarmNames | Sort-Object) -join '|')) {
      throw "The exact eight document-processing alarms are not deployed."
    }
    foreach ($alarm in $alarms) {
      if (
        $alarm.ActionsEnabled -isnot [bool] -or
        -not $alarm.ActionsEnabled -or
        @($alarm.AlarmActions).Count -ne 1 -or
        [string]$alarm.AlarmActions[0] -cne $topic -or
        @($alarm.OKActions).Count -ne 1 -or
        [string]$alarm.OKActions[0] -cne $topic -or
        @($alarm.InsufficientDataActions).Count -ne 0
      ) {
        throw "A document-processing alarm does not have the exact action configuration."
      }
    }
    if (@($alarms | Where-Object { [string]$_.StateValue -cne 'OK' }).Count -eq 0) {
      return [pscustomobject]@{ QueueCount = 3; AlarmCount = 8; AllAlarmsOk = $true }
    }
    if ($attempt -lt ($attempts - 1)) { Start-Sleep -Seconds 10 }
  }
  throw "The exact document-processing alarms did not settle to OK within the bounded window."
}

function Assert-PrivacySafeLogs {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$FixtureEvidence,
    [Parameter(Mandatory)][object[]]$Documents
  )
  $start = [DateTimeOffset]::ParseExact([string]$Receipt.startedAt, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  $end = [DateTimeOffset]::ParseExact([string]$Receipt.completedAt, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).AddMinutes(2)
  $scanAfter = $end.AddSeconds(30)
  while ([DateTimeOffset]::UtcNow -lt $scanAfter) {
    $remaining = [Math]::Ceiling(($scanAfter - [DateTimeOffset]::UtcNow).TotalSeconds)
    Start-Sleep -Seconds ([int][Math]::Min(10, [Math]::Max(1, $remaining)))
  }
  $compact = ([string]$Receipt.runId).Replace('-', '')
  $forbidden = @(
    [string]$Receipt.runId,
    $compact,
    "direct-dark:$($Receipt.runId)",
    "direct-dark-$compact",
    "candidate-$compact@example.test",
    "d1-document-processing-acceptance:$($Receipt.runId)",
    'Skills: TypeScript, PostgreSQL',
    'TypeScript',
    'PostgreSQL',
    'TypeScript (reviewed synthetic)',
    'generated invalid acceptance fixture',
    'Harmless generated malware-disposition fixture',
    [string]$FixtureEvidence.Descriptor.fixtureSetSha256,
    [string](Get-OptionalProperty -Object $Receipt -Name 'claimChecksumSHA256'),
    [string](Get-OptionalProperty -Object $Receipt -Name 'recoveryChecksumSHA256')
  )
  $forbidden += @($FixtureEvidence.Descriptor.manifest | ForEach-Object {
      [string]$_.fileName
      [string]$_.sha256
    })
  foreach ($file in @($FixtureEvidence.Descriptor.files)) {
    $path = [string](Get-OptionalProperty -Object $file -Name 'resolvedPath')
    if ([string]::IsNullOrWhiteSpace($path)) { $path = [string]$file.path }
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $forbidden += @(
        $path,
        [Convert]::ToBase64String($bytes),
        [Text.Encoding]::UTF8.GetString($bytes)
      )
    }
  }
  foreach ($document in @($Documents)) {
    $forbidden += @(
      [string]$document.documentId,
      [string]$document.sourceKey,
      [string]$document.sourceVersion,
      [string]$document.normalizedKey,
      [string]$document.normalizedVersion,
      [string]$document.sha256
    )
  }
  $forbidden = @($forbidden | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $contradictionMarker = '{"event":"document_processing_security_contradiction"}'
  $contradictionCount = 0
  $nextToken = $null
  $previousToken = $null
  for ($page = 0; $page -lt 10; $page += 1) {
    $arguments = @(
      'logs', 'filter-log-events', '--log-group-name', $applicationLogGroup,
      '--start-time', [string]$start.ToUnixTimeMilliseconds(),
      '--end-time', [string]$end.ToUnixTimeMilliseconds(), '--limit', '10000', '--output', 'json'
    )
    if ($nextToken) { $arguments += @('--next-token', $nextToken) }
    $response = Invoke-AwsJson -Arguments $arguments -Operation 'Bounded application log privacy validation'
    foreach ($event in @($response.events)) {
      $message = [string]$event.message
      foreach ($value in $forbidden) {
        if ($message.IndexOf($value, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          throw "Application logs exposed a forbidden generated-synthetic identifier or value."
        }
      }
      if ($message.IndexOf('document_processing_security_contradiction', [StringComparison]::Ordinal) -ge 0) {
        if ([regex]::Matches($message, [regex]::Escape($contradictionMarker)).Count -ne 1) {
          throw "The security-contradiction telemetry event is not the exact value-free metric-filter input."
        }
        $contradictionCount += 1
      }
    }
    $previousToken = $nextToken
    $nextToken = [string](Get-OptionalProperty -Object $response -Name 'nextToken')
    if ([string]::IsNullOrWhiteSpace($nextToken) -or $nextToken -ceq $previousToken) {
      if ($contradictionCount -ne 1) {
        throw "Acceptance requires exactly one value-free security-contradiction telemetry event."
      }
      return $true
    }
  }
  throw "Application log privacy validation exceeded its bounded page limit."
}

Assert-ActionInputs
Assert-CallerAndSource -RequireSource:($Action -ne 'Status')
Initialize-Backend
$null = New-Item -ItemType Directory -Path $operatorRoot -Force

$state = Get-TerraformState
$dark = Assert-TriggersDark -State $state
$identity = Get-StateIdentity

if ($Action -eq 'Status') {
  [pscustomobject]@{
    Environment = 'development'
    Region = $Region
    StateLineage = $identity.Lineage
    StateSerial = $identity.Serial
    MappingState = $dark.MappingState
    GuardDutyRuleState = $dark.GuardDutyRuleState
    ReconcilerState = $dark.ReconcilerState
    ActivationAuthorized = $false
    CloudMutation = $false
  }
  exit 0
}

$migration = Read-MigrationReceipt
$runtime = Get-ExactRuntime -ExpectedImage $migration.ImageUri
Assert-TriggersDark -State $runtime.State | Out-Null
Assert-ZeroTasks -ClusterArn $runtime.ClusterArn

if ($Action -eq 'PlanExecution') {
  $null = Assert-DocumentOperationalHealth
  $runId = [guid]::NewGuid().ToString()
  $fixtureDirectory = Join-Path $operatorRoot "fixtures-$runId"
  if (Test-Path -LiteralPath $fixtureDirectory) { throw "Refusing to replace an existing fixture directory." }
  & node $fixtureGenerator --run-id $runId --output-directory $fixtureDirectory 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The deterministic generated-synthetic fixtures could not be created." }
  $descriptorPath = Join-Path $fixtureDirectory 'descriptor.json'
  $rawDescriptor = ConvertFrom-OperatorJson -Json (Get-Content -LiteralPath $descriptorPath -Raw) -Description 'Generated fixture descriptor'
  $fixture = Read-FixtureDescriptor -Path $descriptorPath -RunId $runId -ExpectedDigest ([string]$rawDescriptor.fixtureSetSha256)
  $requests = @()
  foreach ($phase in @($actions + 'recovery-cleanup')) {
    $request = New-TaskRequest -Runtime $runtime -Phase $phase -RunId $runId -ManifestJson $fixture.ManifestJson -ManifestDigest ([string]$fixture.Descriptor.fixtureSetSha256) -Issuer $runtime.Issuer
    Assert-TaskRequest -Request $request -Runtime $runtime -Phase $phase -RunId $runId -ManifestJson $fixture.ManifestJson -ManifestDigest ([string]$fixture.Descriptor.fixtureSetSha256) -Issuer $runtime.Issuer
    $requests += [ordered]@{ phase = $phase; request = $request }
  }
  if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) {
    $ExecutionPlanPath = Join-Path $operatorRoot "execution-$($SourceSha.Substring(0, 12))-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$($runId.Substring(0, 8)).json"
  }
  $path = Resolve-OperatorPath -Candidate $ExecutionPlanPath -AllowedRoot $operatorRoot
  $plan = [ordered]@{
    schemaVersion = 1
    kind = 'development-document-processing-acceptance-plan'
    environment = 'development'
    region = $Region
    accountId = $ExpectedAccountId
    stateBucket = $StateBucket
    stateLineage = $identity.Lineage
    stateSerial = $identity.Serial
    sourceSha = $SourceSha
    operatorSourceSha = $script:operatorSourceSha
    sourceToOperatorDeltaSha256 = $script:sourceToOperatorDeltaSha256
    fixtureSetSha256 = [string]$fixture.Descriptor.fixtureSetSha256
    fixtureDescriptorPath = $fixture.Path
    fixtureDescriptorSha256 = Get-FileSha256 $fixture.Path
    fixtureManifest = @($fixture.Descriptor.manifest)
    migrationReceiptSha256 = $ReviewedMigrationReceiptSha256
    migrationImage = $migration.ImageUri
    runId = $runId
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    runtime = ConvertTo-ReviewedRuntimeIdentity -Runtime $runtime
    requests = $requests
  }
  Write-JsonFile -Path $path -Value $plan
  $sha = Get-FileSha256 $path
  $null = Read-ExecutionPlan -Path $path -Sha $sha
  [pscustomobject]@{
    Outcome = 'review-required'
    ExecutionPlanPath = $path
    ExecutionPlanSha256 = $sha
    FixtureSetSha256 = [string]$fixture.Descriptor.fixtureSetSha256
    RunId = $runId
    RequestedTaskCount = 8
    TriggerActivation = $false
    CallerSelectedPayloadCount = 0
  }
  exit 0
}

$planEvidence = Read-ExecutionPlan -Path $ExecutionPlanPath -Sha $ReviewedExecutionPlanSha256 -RequireFresh:($Action -eq 'Execute')
$currentRuntime = ConvertTo-ReviewedRuntimeIdentity -Runtime $runtime
$runtimeIdentityUnchanged = (
  [string]$planEvidence.Plan.stateLineage -ceq $identity.Lineage -and
  [string]$planEvidence.Plan.migrationImage -ceq $migration.ImageUri -and
  (ConvertTo-DeploymentCanonicalValue $planEvidence.Plan.runtime) -ceq (ConvertTo-DeploymentCanonicalValue $currentRuntime)
)
$recoveryOnlyStateAdvance = (
  $Action -in @('RecoverCleanup', 'Verify') -and
  $runtimeIdentityUnchanged -and
  [long]$identity.Serial -eq ([long]$planEvidence.Plan.stateSerial + 1)
)
if (
  -not $runtimeIdentityUnchanged -or
  ([long]$planEvidence.Plan.stateSerial -ne $identity.Serial -and -not $recoveryOnlyStateAdvance)
) {
  throw "The reviewed execution plan no longer matches the exact dark runtime."
}
$script:reviewedRuntimeIdentity = $planEvidence.Plan.runtime
$script:reviewedRuntimeImage = $migration.ImageUri
$script:reviewedStateLineage = $planEvidence.Plan.stateLineage
$script:reviewedStateSerial = $identity.Serial
$requestByPhase = @{}
foreach ($entry in @($planEvidence.Plan.requests)) {
  if ($entry.request.PSObject.Properties.Name -contains 'propagateTags') {
    if (
      $Action -notin @('RecoverCleanup', 'Verify') -or
      [string]$entry.request.propagateTags -cne 'NONE'
    ) {
      throw "The reviewed execution plan contains an unsupported ECS tag-propagation request."
    }
    # ECS rejects the historical literal NONE. Omitting propagateTags is its documented
    # no-propagation representation. ECS still binds the failed payload to its client token, so
    # recovery uses one deterministic versioned token for only that exact normalization.
    $entry.request.PSObject.Properties.Remove('propagateTags')
    $entry.request.clientToken = if ([string]$entry.phase -ceq 'recovery-cleanup') {
      "doc-recover-$(([string]$planEvidence.Plan.runId).Replace('-', ''))-v2"
    }
    else {
      "$($entry.request.clientToken)-v2"
    }
  }
  $requestByPhase[[string]$entry.phase] = $entry.request
  Assert-TaskRequest -Request $entry.request -Runtime $runtime -Phase ([string]$entry.phase) -RunId ([string]$planEvidence.Plan.runId) -ManifestJson $planEvidence.Fixture.ManifestJson -ManifestDigest $FixtureSetSha256 -Issuer $runtime.Issuer
}

if ($Action -eq 'Execute') {
  $null = Assert-DocumentOperationalHealth
  $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0, 12))-$ReviewedExecutionPlanSha256.json"
  $receiptPath = Resolve-OperatorPath -Candidate $ReceiptPath -AllowedRoot $operatorRoot
  $receipt = [ordered]@{
    schemaVersion = 1
    kind = 'development-document-processing-acceptance'
    environment = 'development'
    sourceSha = $SourceSha
    operatorSourceSha = $script:operatorSourceSha
    sourceToOperatorDeltaSha256 = $script:sourceToOperatorDeltaSha256
    fixtureSetSha256 = $FixtureSetSha256
    migrationReceiptSha256 = $ReviewedMigrationReceiptSha256
    executionPlanSha256 = $ReviewedExecutionPlanSha256
    runId = [string]$planEvidence.Plan.runId
    phase = 'claiming'
    claimKey = ''
    claimVersionId = ''
    claimChecksumSHA256 = ''
    recoveryKey = ''
    recoveryVersionId = ''
    recoveryChecksumSHA256 = ''
    taskArns = [ordered]@{}
    resultSha256ByAction = [ordered]@{}
    persistentRows = -1
    rollbackProved = $false
    databaseCleaned = $false
    objectsRemoved = $false
    startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    completedAt = ''
  }
  Write-JsonFile -Path $receiptPath -Value $receipt
  $claim = New-DurableClaim -Plan $planEvidence.Plan
  $receipt.phase = 'claimed'
  $receipt.claimKey = $claim.Key
  $receipt.claimVersionId = $claim.VersionId
  $receipt.claimChecksumSHA256 = $claim.ChecksumSHA256
  $documents = [Collections.ArrayList]::new()
  Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)
  Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace

  $primaryFailure = $null
  $cleanupFailure = $null
  try {
    $receipt.phase = 'running'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    Assert-TriggersDark -State $runtime.State | Out-Null

    $arn = Submit-Task -Request $requestByPhase.preflight
    $receipt.taskArns.preflight = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.preflight -TaskArn $arn -Phase 'preflight' -RunId $receipt.runId
    $receipt.resultSha256ByAction.preflight = [string]$result.canonicalSha256

    $cleanPdf = Register-And-UploadFixture -Runtime $runtime -FixtureEvidence $planEvidence.Fixture -RunId $receipt.runId -Role 'clean-pdf' -Receipt $receipt -Documents $documents
    $cleanPdfObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanPdf -RunId $receipt.runId -Ordinal 1 -ObservedAt $cleanPdfObservedAt -ScanResult 'NO_THREATS_FOUND'
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanPdf -RunId $receipt.runId -Ordinal 1 -ObservedAt $cleanPdfObservedAt -ScanResult 'NO_THREATS_FOUND'
    Complete-NormalizedDescriptor -Runtime $runtime -Document $cleanPdf -Required
    Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)
    $cleanDocx = Register-And-UploadFixture -Runtime $runtime -FixtureEvidence $planEvidence.Fixture -RunId $receipt.runId -Role 'clean-docx' -Receipt $receipt -Documents $documents
    $cleanDocxObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanDocx -RunId $receipt.runId -Ordinal 2 -ObservedAt $cleanDocxObservedAt -ScanResult 'NO_THREATS_FOUND'
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanDocx -RunId $receipt.runId -Ordinal 2 -ObservedAt $cleanDocxObservedAt -ScanResult 'NO_THREATS_FOUND'
    Complete-NormalizedDescriptor -Runtime $runtime -Document $cleanDocx -Required
    Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)

    $arn = Submit-Task -Request $requestByPhase.clean
    $receipt.taskArns.clean = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.clean -TaskArn $arn -Phase 'clean' -RunId $receipt.runId
    $receipt.resultSha256ByAction.clean = [string]$result.canonicalSha256

    Invoke-ProfileReview -Runtime $runtime -RunId $receipt.runId
    $arn = Submit-Task -Request $requestByPhase.reviewed
    $receipt.taskArns.reviewed = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.reviewed -TaskArn $arn -Phase 'reviewed' -RunId $receipt.runId
    $receipt.resultSha256ByAction.reviewed = [string]$result.canonicalSha256

    $invalid = Register-And-UploadFixture -Runtime $runtime -FixtureEvidence $planEvidence.Fixture -RunId $receipt.runId -Role 'invalid-pdf' -Receipt $receipt -Documents $documents
    $invalidObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $invalid -RunId $receipt.runId -Ordinal 3 -ObservedAt $invalidObservedAt -ScanResult 'NO_THREATS_FOUND'
    Invoke-DirectProcessorScan -Runtime $runtime -Document $invalid -RunId $receipt.runId -Ordinal 3 -ObservedAt $invalidObservedAt -ScanResult 'NO_THREATS_FOUND'
    $malware = Register-And-UploadFixture -Runtime $runtime -FixtureEvidence $planEvidence.Fixture -RunId $receipt.runId -Role 'malware-test' -Receipt $receipt -Documents $documents
    $malwareObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $malware -RunId $receipt.runId -Ordinal 4 -ObservedAt $malwareObservedAt -ScanResult 'THREATS_FOUND'
    Invoke-DirectProcessorScan -Runtime $runtime -Document $malware -RunId $receipt.runId -Ordinal 4 -ObservedAt $malwareObservedAt -ScanResult 'THREATS_FOUND'

    $arn = Submit-Task -Request $requestByPhase.terminal
    $receipt.taskArns.terminal = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.terminal -TaskArn $arn -Phase 'terminal' -RunId $receipt.runId
    $receipt.resultSha256ByAction.terminal = [string]$result.canonicalSha256

    $contradictionObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanPdf -RunId $receipt.runId -Ordinal 5 -ObservedAt $contradictionObservedAt -ScanResult 'THREATS_FOUND'
    $arn = Submit-Task -Request $requestByPhase.contradiction
    $receipt.taskArns.contradiction = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.contradiction -TaskArn $arn -Phase 'contradiction' -RunId $receipt.runId
    $receipt.resultSha256ByAction.contradiction = [string]$result.canonicalSha256

    $arn = Submit-Task -Request $requestByPhase.'rollback-probe'
    $receipt.taskArns.'rollback-probe' = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.'rollback-probe' -TaskArn $arn -Phase 'rollback-probe' -RunId $receipt.runId
    $receipt.resultSha256ByAction.'rollback-probe' = [string]$result.canonicalSha256
    $receipt.rollbackProved = [bool]$result.rollbackProved
  }
  catch {
    $primaryFailure = $_
  }
  finally {
    try {
      Assert-TriggersDark -State $runtime.State | Out-Null
      foreach ($document in @($documents)) {
        Complete-SourceDescriptor -Runtime $runtime -Document $document
        Complete-NormalizedDescriptor -Runtime $runtime -Document $document
      }
      Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)
      $arn = Submit-Task -Request $requestByPhase.cleanup
      $receipt.taskArns.cleanup = $arn
      Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
      $cleanup = Wait-Task -Request $requestByPhase.cleanup -TaskArn $arn -Phase 'cleanup' -RunId $receipt.runId
      $receipt.resultSha256ByAction.cleanup = [string]$cleanup.canonicalSha256
      $receipt.persistentRows = [int]$cleanup.persistentRows
      $receipt.databaseCleaned = $true
      Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
      Remove-DescriptorObjects -Runtime $runtime -Documents @($documents)
      $receipt.objectsRemoved = $true
    }
    catch {
      $cleanupFailure = $_
    }
  }
  if ($null -ne $cleanupFailure) {
    $receipt.phase = 'cleanup-required'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    throw "Document acceptance did not prove exact database and object cleanup. Retain and review the receipt before RecoverCleanup."
  }
  $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  if ($null -ne $primaryFailure) {
    $receipt.phase = 'failed-cleaned'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    throw "Document acceptance failed after exact cleanup; no acceptance claim is made."
  }
  if ($receipt.persistentRows -ne 0 -or -not $receipt.rollbackProved -or -not $receipt.databaseCleaned -or -not $receipt.objectsRemoved) {
    throw "Document acceptance did not prove rollback and zero persistent artifacts."
  }
  $receipt.phase = 'verified'
  Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
  [pscustomobject]@{
    Outcome = 'verified-and-cleaned'
    ReceiptPath = $receiptPath
    ReceiptSha256 = Get-FileSha256 $receiptPath
    RunId = $receipt.runId
    ActionCount = 7
    PersistentRows = 0
    RollbackProved = $true
    TriggerActivation = $false
    GuardDutyServiceDetectionProved = $false
    ApiGatewayAuthorizerEnforcementProved = $false
    RealCandidateData = $false
  }
  exit 0
}

$receiptEvidence = Read-AcceptanceReceipt `
  -Path $ReceiptPath `
  -Sha $ReviewedReceiptSha256 `
  -ExpectedOperatorSourceSha ([string]$planEvidence.Plan.operatorSourceSha) `
  -ExpectedSourceToOperatorDeltaSha256 ([string]$planEvidence.Plan.sourceToOperatorDeltaSha256)
$receipt = $receiptEvidence.Receipt
if ([string]$receipt.runId -cne [string]$planEvidence.Plan.runId) {
  throw "The receipt run ID does not match the reviewed plan."
}

if ($Action -eq 'RecoverCleanup') {
  if ([string]$receipt.phase -cne 'cleanup-required') {
    throw "Cleanup recovery requires an exact reviewed cleanup-required receipt."
  }
  $documents = [Collections.ArrayList]::new()
  foreach ($document in @(Read-RecoveryDescriptor -Receipt $receipt -FixtureEvidence $planEvidence.Fixture)) {
    $null = $documents.Add($document)
  }
  foreach ($document in @($documents)) {
    Complete-SourceDescriptor -Runtime $runtime -Document $document
    Complete-NormalizedDescriptor -Runtime $runtime -Document $document
  }
  Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)
  Assert-TriggersDark -State $runtime.State | Out-Null
  if (-not [bool]$receipt.databaseCleaned) {
    $recoveryTask = Invoke-RecoveryCleanupTask -Request $requestByPhase.'recovery-cleanup' -RunId $receipt.runId
    $cleanup = $recoveryTask.Result
    $receipt.taskArns.'recovery-cleanup' = $recoveryTask.Arn
    $receipt.resultSha256ByAction.'recovery-cleanup' = [string]$cleanup.canonicalSha256
    $receipt.persistentRows = [int]$cleanup.persistentRows
    $receipt.databaseCleaned = $true
    Write-JsonFile -Path $receiptEvidence.Path -Value $receipt -AllowReplace
  }
  Remove-DescriptorObjects -Runtime $runtime -Documents @($documents)
  $receipt.objectsRemoved = $true
  $receipt.phase = 'recovered-cleaned'
  $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  Write-JsonFile -Path $receiptEvidence.Path -Value $receipt -AllowReplace
  [pscustomobject]@{
    Outcome = 'cleanup-recovered'
    ReceiptPath = $receiptEvidence.Path
    ReceiptSha256 = Get-FileSha256 $receiptEvidence.Path
    PersistentRows = 0
    DatabaseCleaned = $true
    ObjectsRemoved = $true
    AcceptanceClaim = $false
    TriggerActivation = $false
  }
  exit 0
}

if (
  [string]$receipt.phase -cne 'verified' -or
  [int]$receipt.persistentRows -ne 0 -or
  $receipt.rollbackProved -isnot [bool] -or
  -not $receipt.rollbackProved -or
  $receipt.databaseCleaned -isnot [bool] -or
  -not $receipt.databaseCleaned -or
  $receipt.objectsRemoved -isnot [bool] -or
  -not $receipt.objectsRemoved -or
  @($receipt.taskArns.PSObject.Properties).Count -ne 7 -or
  @($receipt.resultSha256ByAction.PSObject.Properties).Count -ne 7 -or
  @($receipt.resultSha256ByAction.PSObject.Properties.Value | Where-Object { $_ -notmatch '^[a-f0-9]{64}$' }).Count -ne 0 -or
  -not (Test-CanonicalTimestamp $receipt.completedAt)
) {
  throw "Verify accepts only a complete, cleaned, internally consistent acceptance receipt."
}
Assert-TriggersDark -State $runtime.State | Out-Null
Assert-ZeroTasks -ClusterArn $runtime.ClusterArn
$verifiedDocuments = @(Read-RecoveryDescriptor -Receipt $receipt -FixtureEvidence $planEvidence.Fixture)
$null = Assert-PrivacySafeLogs -Receipt $receipt -FixtureEvidence $planEvidence.Fixture -Documents $verifiedDocuments
$health = Assert-DocumentOperationalHealth -WaitForOk
$ending = Get-StateIdentity
if ([string]$ending.Lineage -cne [string]$planEvidence.Plan.stateLineage -or [long]$ending.Serial -ne [long]$script:reviewedStateSerial) {
  throw "Terraform state changed during document acceptance."
}
[pscustomobject]@{
  Outcome = 'verified'
  ReceiptSha256 = $ReviewedReceiptSha256
  ActionCount = 7
  PersistentRows = 0
  RollbackProved = $true
  ObjectsRemoved = $true
  StateChanged = $false
  TriggerActivation = $false
  GuardDutyServiceDetectionProved = $false
  ApiGatewayAuthorizerEnforcementProved = $false
  QueueCount = $health.QueueCount
  AlarmCount = $health.AlarmCount
  AllAlarmsOk = $health.AllAlarmsOk
  PrivacySafeLogs = $true
  TerraformStateIdentityChanged = $false
  TerraformZeroDriftClaim = $false
  CloudMutation = $false
  RealCandidateData = $false
}
