[CmdletBinding()]
param(
  [ValidateSet("Status", "PlanExecution", "Execute", "ServiceDetection", "ObjectRecovery", "RecoverCleanup", "Verify", "CorpusPlan", "CorpusExecute", "CorpusRecoverCleanup", "CorpusVerify")]
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

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action ServiceDetection `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -FixtureSetSha256 REVIEWED_FIXTURE_SET_SHA256 `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256 `
    -ExecutionPlanPath REVIEWED_EXECUTION_PLAN -ReviewedExecutionPlanSha256 SHA256

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action ObjectRecovery `
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

  .\scripts\operate-development-document-processing-acceptance.ps1 -Action CorpusPlan `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -MigrationReceiptPath VERIFIED_IMAGE_RECEIPT -ReviewedMigrationReceiptSha256 SHA256

  Use CorpusExecute with the reviewed plan and corpus digest, CorpusRecoverCleanup with an
  interrupted/cleanup-required receipt, and CorpusVerify with the verified receipt. These actions
  directly exercise only the exact numeric dark processor/parser versions with the fixed generated
  adversarial corpus; they never activate a trigger or accept external document bytes.

This operator proves the generated-synthetic document flow while the mapping, GuardDuty rule, and
reconciler remain disabled. It invokes the deployed gateway and processor aliases synchronously
with exact bounded events. The direct gateway invocation fabricates an already-validated authorizer
context, so it does not prove API Gateway routing, JWT/JWKS validation, or authorizer enforcement.
The ServiceDetection action separately proves only that the already-active exact GuardDuty malware
protection plan scans one generated clean PDF version and writes its managed NO_THREATS_FOUND tag.
The ObjectRecovery action then creates an exact delete marker, reads only the descriptor-bound prior
version, restores it as a checksum/KMS/metadata-bound new version, requires a fresh managed clean
scan, removes the marker and superseded version, and finally cleans the generated row and object.
It leaves the EventBridge rule, SQS mapping, reconciler, processor, and parser disabled and therefore
does not prove or authorize their delivery/activation. Those claims remain behind ADR-023 and a
separate human-authorized activation operator.
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
$corpusGenerator = Join-Path $PSScriptRoot "lib\development-document-parser-corpus.mjs"
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
    '^AGENTS\.md$',
    '^docs/',
    '^scripts/operate-development-document-processing-acceptance\.ps1$',
    '^scripts/lib/development-document-parser-corpus\.mjs$',
    '^backend/services/documents/src/document-parser-corpus\.test\.ts$',
    '^scripts/inspect-staging-workload-and-cost\.ps1$',
    '^scripts/lib/staging-postgresql-restore-verifier\.ps1$',
    '^scripts/operate-development-postgresql-restore\.ps1$',
    '^scripts/operate-staging-postgresql-restore\.ps1$',
    '^scripts/tests/development-document-processing-acceptance-operator\.tests\.ps1$',
    '^scripts/tests/staging-postgresql-restore-verifier\.tests\.ps1$',
    '^infrastructure/runbooks/deployments/development-document-processing-acceptance\.md$',
    '^infrastructure/runbooks/restore/development-postgresql-point-in-time\.md$'
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
    '^AGENTS\.md$',
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
  $releaseActions = @('PlanExecution', 'Execute', 'ServiceDetection', 'ObjectRecovery', 'RecoverCleanup', 'Verify', 'CorpusPlan', 'CorpusExecute', 'CorpusRecoverCleanup', 'CorpusVerify')
  if ($Action -in $releaseActions) {
    $migrationInputs = @($MigrationReceiptPath, $ReviewedMigrationReceiptSha256) |
      Where-Object { [string]::IsNullOrWhiteSpace($_) }
    if ($SourceSha -notmatch '^[a-f0-9]{40}$' -or @($migrationInputs).Count -ne 0) {
      throw "$Action requires the exact source and migration image receipt pair."
    }
  }
  if ($Action -in @('Execute', 'ServiceDetection', 'ObjectRecovery', 'RecoverCleanup', 'Verify', 'CorpusExecute', 'CorpusRecoverCleanup', 'CorpusVerify')) {
    $executionInputs = @($FixtureSetSha256, $ExecutionPlanPath, $ReviewedExecutionPlanSha256) |
      Where-Object { [string]::IsNullOrWhiteSpace($_) }
    if ($FixtureSetSha256 -notmatch '^[a-f0-9]{64}$' -or @($executionInputs).Count -ne 0) {
      throw "$Action requires the exact fixture digest and reviewed execution plan."
    }
  }
  elseif (-not [string]::IsNullOrWhiteSpace($FixtureSetSha256)) {
    throw "Only execution, service detection, recovery, and verification accept a fixture-set digest."
  }
  if ($Action -in @('RecoverCleanup', 'Verify', 'CorpusRecoverCleanup', 'CorpusVerify')) {
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
    $delta = if ($Action -in @('RecoverCleanup', 'Verify', 'CorpusRecoverCleanup', 'CorpusVerify')) {
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

function Assert-DocumentParserVersionBoundary {
  param(
    [Parameter(Mandatory)][string]$CurrentVersionArn,
    [Parameter(Mandatory)][string]$PinnedVersionArn
  )

  $pattern = "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:(?<version>[1-9][0-9]*)$"
  $current = [regex]::Match($CurrentVersionArn, $pattern)
  $pinned = [regex]::Match($PinnedVersionArn, $pattern)
  if (
    -not $current.Success -or
    -not $pinned.Success -or
    [long]$pinned.Groups['version'].Value -gt [long]$current.Groups['version'].Value
  ) {
    throw "The processor parser pin is not an exact retained-or-current document parser version."
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
  $currentParserVersionArn = [string](Get-StateOutput -State $state -Name 'document_parser_version_arn')
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
    $currentParserVersionArn -notmatch "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" -or
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
  Assert-DocumentParserVersionBoundary `
    -CurrentVersionArn $currentParserVersionArn `
    -PinnedVersionArn $parserQualifiedArn
  $null = Get-LambdaVersionIdentity -QualifiedArn $currentParserVersionArn -Description 'Current document parser'
  $parserIdentity = Get-LambdaVersionIdentity -QualifiedArn $parserQualifiedArn -Description 'Document parser'
  $parserVariables = $parserIdentity.Configuration.Environment.Variables
  $planArn = [string]$processorVariables.GUARDDUTY_PROTECTION_PLAN_ARN
  if (
    [string]$gatewayVariables.OIDC_ISSUER -notmatch '^https://' -or
    [string]::IsNullOrWhiteSpace([string]$gatewayVariables.OIDC_AUDIENCE) -or
    [string]$gatewayVariables.DOCUMENT_UPLOAD_BUCKET -cne $bucket -or
    [string]$gatewayVariables.DOCUMENT_UPLOAD_KMS_KEY_ARN -cne [string]$processorVariables.PLATFORM_KMS_KEY_ARN -or
    [string]$processorVariables.PLATFORM_KMS_KEY_ARN -notmatch "^arn:aws:kms:$Region`:$ExpectedAccountId`:key/" -or
    [string]$processorVariables.DOCUMENT_PARSER_VERSION -cne 'resume-parser-v1' -or
    [string]$parserVariables.DOCUMENT_PARSER_VERSION -cne 'resume-parser-v1' -or
    $planArn -notmatch "^arn:aws:guardduty:$Region`:$ExpectedAccountId`:malware-protection-plan/[A-Za-z0-9]+$" -or
    ($planIdentity -cne $planArn -and -not $planArn.EndsWith("/$planIdentity", [StringComparison]::Ordinal))
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
    ParserSemanticVersion = [string]$processorVariables.DOCUMENT_PARSER_VERSION
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
    parserSemanticVersion = $Runtime.ParserSemanticVersion
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

function ConvertTo-ReviewedTaskOverrides {
  param([Parameter(Mandatory)][object]$Overrides)
  $normalized = ConvertFrom-OperatorJson `
    -Json (ConvertTo-Json $Overrides -Depth 30 -Compress) `
    -Description 'ECS task override readback'
  if ($normalized.PSObject.Properties.Name -contains 'inferenceAcceleratorOverrides') {
    if (@($normalized.inferenceAcceleratorOverrides).Count -ne 0) {
      throw 'ECS returned an unreviewed inference accelerator override.'
    }
    # ECS adds this empty optional collection to describe-tasks responses even
    # when it was omitted from the submitted and reviewed request.
    $normalized.PSObject.Properties.Remove('inferenceAcceleratorOverrides')
  }
  $normalized
}

function Wait-Task {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][string]$TaskArn,
    [Parameter(Mandatory)][string]$Phase
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
  $reviewedOverrides = ConvertTo-ReviewedTaskOverrides -Overrides $task.overrides
  if (
    [string]$task.clusterArn -cne [string]$Request.cluster -or
    [string]$task.taskDefinitionArn -cne [string]$Request.taskDefinition -or
    [string]$task.lastStatus -cne 'STOPPED' -or
    $containers.Count -ne 1 -or
    [int]$containers[0].exitCode -ne 0 -or
    (ConvertTo-DeploymentCanonicalValue $reviewedOverrides) -cne (ConvertTo-DeploymentCanonicalValue $Request.overrides) -or
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
    'schemaVersion', 'kind', 'action', 'documentCount', 'parsedCount', 'rejectedCount',
    'failedCount', 'securityHoldCount', 'receiptCount', 'dispositionCount', 'profileFactCount',
    'profileVersionCount', 'evidenceCount', 'persistentRows', 'rollbackProved', 'canonicalSha256'
  )
  Assert-ExactPropertySet -Value $result -Description "$Phase aggregate result" -ExpectedNames $expectedNames
  if (
    [int]$result.schemaVersion -ne 1 -or
    [string]$result.kind -cne 'development-document-processing-acceptance' -or
    [string]$result.action -cne $Phase -or
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

function New-RecoveryAttemptToken {
  param(
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$InvocationId,
    [Parameter(Mandatory)][ValidateRange(1, 3)][int]$Attempt
  )
  $compactRunId = $RunId.Replace('-', '')
  if ($compactRunId -notmatch '^[a-f0-9]{32}$' -or $InvocationId -notmatch '^[a-f0-9]{16}$') {
    throw 'The recovery cleanup token identity is invalid.'
  }
  $token = "doc-rcln-$compactRunId-$InvocationId-a$Attempt"
  if ($token -notmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw 'The recovery cleanup retry token is invalid.'
  }
  $token
}

function Invoke-RecoveryCleanupTask {
  param(
    [Parameter(Mandatory)][object]$Request,
    [Parameter(Mandatory)][string]$RunId
  )
  # A reviewed recovery can be repeated after a transient startup failure or an
  # infrastructure repair. A fresh invocation identity prevents ECS from
  # idempotently returning an earlier failed task while keeping every other
  # reviewed request field byte-for-byte unchanged.
  $invocationId = ([guid]::NewGuid().ToString('N')).Substring(0, 16)
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    $attemptRequest = ConvertFrom-OperatorJson `
      -Json (ConvertTo-Json $Request -Depth 30 -Compress) `
      -Description 'Recovery cleanup retry request'
    $attemptRequest.clientToken = New-RecoveryAttemptToken -RunId $RunId -InvocationId $invocationId -Attempt $attempt
    try {
      $arn = Submit-Task -Request $attemptRequest
      $result = Wait-Task -Request $attemptRequest -TaskArn $arn -Phase 'cleanup'
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

function Add-RecoveryTaskEvidence {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$TaskArn,
    [Parameter(Mandatory)][string]$ResultSha256
  )
  if (
    $TaskArn -notmatch "^arn:aws:ecs:${Region}:${ExpectedAccountId}:task/ai-job-apply-development/[a-f0-9]{32}$" -or
    $ResultSha256 -notmatch '^[a-f0-9]{64}$' -or
    @($Receipt.taskArns.PSObject.Properties | ForEach-Object { $_.Name }) -contains 'recovery-cleanup' -or
    @($Receipt.resultSha256ByAction.PSObject.Properties | ForEach-Object { $_.Name }) -contains 'recovery-cleanup'
  ) {
    throw 'The recovery cleanup task evidence is invalid or already present.'
  }
  $Receipt.taskArns | Add-Member -NotePropertyName 'recovery-cleanup' -NotePropertyValue $TaskArn
  $Receipt.resultSha256ByAction | Add-Member -NotePropertyName 'recovery-cleanup' -NotePropertyValue $ResultSha256
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
  $script:acceptanceStage = "$Operation.runtime-revalidation"
  Assert-ReviewedRuntimeUnchanged
  $requestPath = [IO.Path]::GetTempFileName()
  $responsePath = [IO.Path]::GetTempFileName()
  try {
    $script:acceptanceStage = "$Operation.request-serialization"
    Write-JsonFile -Path $requestPath -Value $Payload -AllowReplace
    $script:acceptanceStage = "$Operation.lambda-invocation"
    $raw = & aws lambda invoke --function-name $FunctionArn --invocation-type RequestResponse --cli-binary-format raw-in-base64-out --payload "fileb://$requestPath" $responsePath --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
    $script:acceptanceStage = "$Operation.response-validation"
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
  $event = [ordered]@{
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
  }
  if ($null -ne $Body) {
    $event.body = $Body | ConvertTo-Json -Depth 20 -Compress
  }
  $event
}

function Invoke-Gateway {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][object]$Body = $null,
    [AllowNull()][string]$IdempotencyKey = $null,
    [AllowNull()][string]$ResponseStage = $null,
    [Parameter(Mandatory)][int]$ExpectedStatus
  )
  $event = New-GatewayEvent -Runtime $Runtime -RunId $RunId -Method $Method -Path $Path -Body $Body -IdempotencyKey $IdempotencyKey
  $response = Invoke-LambdaJson -FunctionArn $Runtime.GatewayAliasArn -Payload $event -Operation 'Direct gateway invocation'
  $script:acceptanceStage = if ([string]::IsNullOrWhiteSpace($ResponseStage)) {
    'direct-gateway-http-response-validation'
  }
  else {
    $ResponseStage
  }
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
    'x-amz-checksum-algorithm', 'x-amz-checksum-sha256', 'x-amz-meta-document-id',
    'x-amz-meta-sha256', 'x-amz-server-side-encryption',
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
    [string]$Upload.fields.'x-amz-checksum-algorithm' -cne 'SHA256' -or
    [string]$Upload.fields.'x-amz-checksum-sha256' -notmatch '^[A-Za-z0-9+/]{43}=$' -or
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
    [Parameter(Mandatory)][AllowEmptyCollection()][Collections.ArrayList]$Documents
  )
  $script:acceptanceStage = "$Role.trigger-revalidation"
  Assert-TriggersDark -State $Runtime.State | Out-Null
  $script:acceptanceStage = "$Role.fixture-resolution"
  $fixture = Get-Fixture -FixtureEvidence $FixtureEvidence -Role $Role
  $entry = $fixture.Entry
  $body = [ordered]@{
    fileName = [string]$entry.fileName
    mediaType = [string]$entry.mediaType
    sizeBytes = [long]$entry.sizeBytes
    sha256 = [string]$entry.sha256
  }
  $script:acceptanceStage = "$Role.gateway-registration"
  $created = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'POST' -Path '/v1/resumes/uploads' -Body $body -IdempotencyKey "document-acceptance-$($RunId.Replace('-', ''))-$Role" -ExpectedStatus 201
  $script:acceptanceStage = "$Role.registration-response-validation"
  $document = $created.document
  $upload = $created.upload
  $script:acceptanceStage = "$Role.registration-document-identity"
  if ([string]$document.id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw "The gateway did not return the exact bounded upload registration."
  }
  $script:acceptanceStage = "$Role.registration-document-metadata"
  if (
    [string]$document.fileName -cne [string]$entry.fileName -or
    [string]$document.mediaType -cne [string]$entry.mediaType -or
    [long]$document.sizeBytes -ne [long]$entry.sizeBytes -or
    [string]$document.sha256 -cne [string]$entry.sha256
  ) {
    throw "The gateway did not return the exact bounded upload registration."
  }
  $script:acceptanceStage = "$Role.registration-upload-status"
  if (
    [string]$document.status -cne 'awaiting_upload' -or
    [string]$upload.method -cne 'POST' -or
    [string]$upload.url -notmatch '^https://'
  ) {
    throw "The gateway did not return the exact bounded upload registration."
  }
  $script:acceptanceStage = "$Role.registration-expiry-bound"
  $expiresAtValue = [DateTimeOffset]::Parse(
    [string]$upload.expiresAt,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $signedAtValue = [DateTimeOffset]::ParseExact(
    [string]$upload.fields.'X-Amz-Date',
    "yyyyMMdd'T'HHmmss'Z'",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $expiryMilliseconds = ($expiresAtValue - $signedAtValue).TotalMilliseconds
  if ($expiryMilliseconds -lt 300000 -or $expiryMilliseconds -ge 301000) {
    throw "The gateway did not return the exact bounded upload registration."
  }
  $script:acceptanceStage = "$Role.upload-binding-validation"
  $key = "quarantine/$($document.id)/source"
  $expectedChecksum = Convert-HexToBase64 -Hex ([string]$entry.sha256)
  if (
    [string]$upload.fields.key -cne $key -or
    [string]$upload.fields.'Content-Type' -cne [string]$entry.mediaType -or
    [string]$upload.fields.'x-amz-checksum-algorithm' -cne 'SHA256' -or
    [string]$upload.fields.'x-amz-checksum-sha256' -cne $expectedChecksum -or
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
  $script:acceptanceStage = "$Role.recovery-registration"
  $null = $Documents.Add($descriptor)
  Save-RecoveryDescriptor -Receipt $Receipt -Documents @($Documents)
  Assert-PresignedUploadTarget -Runtime $Runtime -Upload $upload -ExpectedKey $key | Out-Null
  $script:acceptanceStage = "$Role.object-upload"
  Invoke-PresignedPost -Runtime $Runtime -Upload $upload -ExpectedKey $key -FilePath $fixture.Path -FileName ([string]$entry.fileName) -MediaType ([string]$entry.mediaType)
  $script:acceptanceStage = "$Role.upload-version-history"
  $versions = Invoke-AwsJson -Arguments @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $key, '--output', 'json') -Operation 'Uploaded object version history'
  $uploadedVersions = @(Get-OptionalItems -Object $versions -Name 'Versions')
  $uploadedMarkers = @(Get-OptionalItems -Object $versions -Name 'DeleteMarkers')
  $exactVersions = @($uploadedVersions | Where-Object { [string]$_.Key -ceq $key })
  if (
    $exactVersions.Count -ne 1 -or
    @($uploadedMarkers | Where-Object { [string]$_.Key -ceq $key }).Count -ne 0
  ) {
    throw "The generated object key has unexpected version history."
  }
  $version = [string]$exactVersions[0].VersionId
  $script:acceptanceStage = "$Role.upload-readback-request"
  $head = Invoke-AwsJson -Arguments @('s3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $key, '--version-id', $version, '--output', 'json') -Operation 'Uploaded object readback'
  $script:acceptanceStage = "$Role.upload-readback-identity"
  if (
    [string]$head.VersionId -cne $version -or
    [long]$head.ContentLength -ne [long]$entry.sizeBytes -or
    [string]$head.ContentType -cne [string]$entry.mediaType -or
    [string]$head.ServerSideEncryption -cne 'aws:kms' -or
    [string]$head.SSEKMSKeyId -cne $Runtime.PlatformKmsKeyArn -or
    [string]$head.Metadata.'document-id' -cne [string]$document.id -or
    [string]$head.Metadata.sha256 -cne [string]$entry.sha256
  ) {
    throw "The uploaded object version does not match its exact registration and digest."
  }
  $descriptor.sourceVersion = $version
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

function Wait-GuardDutyServiceScan {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document,
    [ValidateRange(60, 900)][int]$TimeoutSeconds = 900
  )
  Assert-TriggersDark -State $Runtime.State | Out-Null
  Assert-ReviewedRuntimeUnchanged
  $planId = ([string]$Runtime.ProtectionPlanArn -split '/')[-1]
  if ($planId -notmatch '^[A-Za-z0-9]+$') {
    throw "The GuardDuty malware protection plan identity is invalid."
  }
  $plan = Invoke-AwsJson -Arguments @(
    'guardduty', 'get-malware-protection-plan', '--malware-protection-plan-id', $planId,
    '--output', 'json'
  ) -Operation 'GuardDuty malware protection plan validation'
  $prefixes = @($plan.ProtectedResource.S3Bucket.ObjectPrefixes)
  if (
    [string]$plan.Status -cne 'ACTIVE' -or
    [string]$plan.ProtectedResource.S3Bucket.BucketName -cne $Runtime.CandidateDocumentBucket -or
    $prefixes.Count -ne 1 -or [string]$prefixes[0] -cne 'quarantine/' -or
    [string]$plan.Actions.Tagging.Status -cne 'ENABLED'
  ) {
    throw "The GuardDuty malware protection plan is not the exact active tagging boundary."
  }

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Assert-TriggersDark -State $Runtime.State | Out-Null
    Assert-ReviewedRuntimeUnchanged
    $readback = Invoke-AwsJson -Arguments @(
      's3api', 'get-object-tagging', '--bucket', $Runtime.CandidateDocumentBucket,
      '--key', $Document.sourceKey, '--version-id', $Document.sourceVersion, '--output', 'json'
    ) -Operation 'GuardDuty managed scan tag readback'
    $tags = @($readback.TagSet)
    $scanTags = @($tags | Where-Object { [string]$_.Key -ceq 'GuardDutyMalwareScanStatus' })
    if ($scanTags.Count -gt 1 -or $tags.Count -gt 1) {
      throw "The scanned object version has unexpected tags."
    }
    if ($scanTags.Count -eq 1) {
      $status = [string]$scanTags[0].Value
      if ($status -ceq 'NO_THREATS_FOUND') {
        return [pscustomobject]@{
          ProtectionPlanStatus = 'ACTIVE'
          TaggingStatus = 'ENABLED'
          ScanResult = 'NO_THREATS_FOUND'
        }
      }
      if ($status -in @('THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED')) {
        throw "GuardDuty returned a non-clean terminal result for the generated clean fixture."
      }
      throw "GuardDuty returned an unknown managed scan result."
    }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { break }
    Start-Sleep -Seconds 5
  } while ($true)
  throw "GuardDuty did not attach a terminal managed scan tag within the bounded window."
}

function Remove-RecoveryObjectVersion {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][bool]$DeleteMarker
  )
  Assert-ReviewedRuntimeUnchanged
  $deleted = Invoke-AwsJson -Arguments @(
    's3api', 'delete-object', '--bucket', $Runtime.CandidateDocumentBucket,
    '--key', $Key, '--version-id', $Version, '--output', 'json'
  ) -Operation 'Object-recovery exact version cleanup'
  $actualMarker = Get-OptionalProperty -Object $deleted -Name 'DeleteMarker'
  if (
    [string]$deleted.VersionId -cne $Version -or
    ($DeleteMarker -and $actualMarker -ne $true) -or
    (-not $DeleteMarker -and $actualMarker -eq $true)
  ) {
    throw "Object-recovery exact version cleanup returned an invalid identity."
  }
}

function Invoke-VersionedObjectRecovery {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Document
  )
  Assert-TriggersDark -State $Runtime.State | Out-Null
  Assert-ReviewedRuntimeUnchanged
  $originalVersion = [string]$Document.sourceVersion
  if (
    [string]$Document.sourceKey -notmatch '^quarantine/[0-9a-f-]{36}/source$' -or
    [string]::IsNullOrWhiteSpace($originalVersion) -or
    [string]$Document.sha256 -notmatch '^[a-f0-9]{64}$'
  ) {
    throw "Object recovery requires the exact generated descriptor-bound source version."
  }

  $deleteMarkerVersion = ''
  $restoredVersion = ''
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $script:acceptanceStage = 'clean-pdf.object-recovery-delete-marker'
    Assert-ReviewedRuntimeUnchanged
    $marker = Invoke-AwsJson -Arguments @(
      's3api', 'delete-object', '--bucket', $Runtime.CandidateDocumentBucket,
      '--key', $Document.sourceKey, '--output', 'json'
    ) -Operation 'Object-recovery delete marker creation'
    $deleteMarkerVersion = [string]$marker.VersionId
    if (
      (Get-OptionalProperty -Object $marker -Name 'DeleteMarker') -ne $true -or
      [string]::IsNullOrWhiteSpace($deleteMarkerVersion)
    ) {
      throw "Object recovery did not create one exact delete marker."
    }

    $history = Invoke-AwsJson -Arguments @(
      's3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket,
      '--prefix', $Document.sourceKey, '--output', 'json'
    ) -Operation 'Object-recovery deleted-state validation'
    $versions = @(Get-OptionalItems -Object $history -Name 'Versions' | Where-Object {
        [string]$_.Key -ceq [string]$Document.sourceKey
      })
    $markers = @(Get-OptionalItems -Object $history -Name 'DeleteMarkers' | Where-Object {
        [string]$_.Key -ceq [string]$Document.sourceKey
      })
    if (
      $versions.Count -ne 1 -or [string]$versions[0].VersionId -cne $originalVersion -or
      [bool]$versions[0].IsLatest -or $markers.Count -ne 1 -or
      [string]$markers[0].VersionId -cne $deleteMarkerVersion -or -not [bool]$markers[0].IsLatest
    ) {
      throw "Object recovery did not observe the exact retained-version/delete-marker boundary."
    }

    $script:acceptanceStage = 'clean-pdf.object-recovery-prior-version-read'
    $raw = & aws s3api get-object --bucket $Runtime.CandidateDocumentBucket `
      --key $Document.sourceKey --version-id $originalVersion --checksum-mode ENABLED `
      $temporary --output json 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "Object recovery could not read the exact retained generated version."
    }
    $readback = ConvertFrom-OperatorJson -Json ($raw -join "`n") `
      -Description 'Object-recovery retained version readback'
    if (
      [string]$readback.VersionId -cne $originalVersion -or
      (Get-FileSha256 $temporary) -cne [string]$Document.sha256
    ) {
      throw "Object recovery retained bytes do not match the descriptor digest."
    }

    $script:acceptanceStage = 'clean-pdf.object-recovery-version-write'
    Assert-ReviewedRuntimeUnchanged
    $restored = Invoke-AwsJson -Arguments @(
      's3api', 'put-object', '--bucket', $Runtime.CandidateDocumentBucket,
      '--key', $Document.sourceKey, '--body', $temporary,
      '--content-type', $Document.mediaType,
      '--metadata', "document-id=$($Document.documentId),sha256=$($Document.sha256)",
      '--server-side-encryption', 'aws:kms', '--ssekms-key-id', $Runtime.PlatformKmsKeyArn,
      '--checksum-algorithm', 'SHA256', '--checksum-sha256', (Convert-HexToBase64 $Document.sha256),
      '--output', 'json'
    ) -Operation 'Object-recovery restored version write'
    $restoredVersion = [string]$restored.VersionId
    if (
      [string]::IsNullOrWhiteSpace($restoredVersion) -or
      [string]$restored.ChecksumSHA256 -cne (Convert-HexToBase64 $Document.sha256) -or
      [string]$restored.ServerSideEncryption -cne 'aws:kms' -or
      [string]$restored.SSEKMSKeyId -cne [string]$Runtime.PlatformKmsKeyArn
    ) {
      throw "Object recovery did not create the exact checksum-bound restored version."
    }

    $restoredDocument = [pscustomobject]@{
      sourceKey = [string]$Document.sourceKey
      sourceVersion = $restoredVersion
    }
    $script:acceptanceStage = 'clean-pdf.object-recovery-guardduty-rescan'
    $rescan = Wait-GuardDutyServiceScan -Runtime $Runtime -Document $restoredDocument

    Remove-RecoveryObjectVersion -Runtime $Runtime -Key $Document.sourceKey `
      -Version $deleteMarkerVersion -DeleteMarker $true
    $deleteMarkerVersion = ''
    Remove-RecoveryObjectVersion -Runtime $Runtime -Key $Document.sourceKey `
      -Version $originalVersion -DeleteMarker $false
    $originalVersion = ''
    $Document.sourceVersion = $restoredVersion

    $history = Invoke-AwsJson -Arguments @(
      's3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket,
      '--prefix', $Document.sourceKey, '--output', 'json'
    ) -Operation 'Object-recovery reconciled version validation'
    $versions = @(Get-OptionalItems -Object $history -Name 'Versions' | Where-Object {
        [string]$_.Key -ceq [string]$Document.sourceKey
      })
    $markers = @(Get-OptionalItems -Object $history -Name 'DeleteMarkers' | Where-Object {
        [string]$_.Key -ceq [string]$Document.sourceKey
      })
    if (
      $versions.Count -ne 1 -or [string]$versions[0].VersionId -cne $restoredVersion -or
      -not [bool]$versions[0].IsLatest -or $markers.Count -ne 0
    ) {
      throw "Object recovery did not reconcile to one exact current restored version."
    }
    [pscustomobject]@{
      PriorVersionRecovered = $true
      DeleteMarkerRemoved = $true
      SupersededVersionRemoved = $true
      RestoredVersionRescanned = ([string]$rescan.ScanResult -ceq 'NO_THREATS_FOUND')
    }
  }
  catch {
    $failure = $_
    try {
      $history = Invoke-AwsJson -Arguments @(
        's3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket,
        '--prefix', $Document.sourceKey, '--output', 'json'
      ) -Operation 'Object-recovery failure reconciliation'
      $versions = @(Get-OptionalItems -Object $history -Name 'Versions' | Where-Object {
          [string]$_.Key -ceq [string]$Document.sourceKey
        })
      $markers = @(Get-OptionalItems -Object $history -Name 'DeleteMarkers' | Where-Object {
          [string]$_.Key -ceq [string]$Document.sourceKey
        })
      $originalPresent = @($versions | Where-Object {
          [string]$_.VersionId -ceq $originalVersion
        }).Count -eq 1
      if ($originalPresent -and -not [string]::IsNullOrWhiteSpace($restoredVersion)) {
        $restoredPresent = @($versions | Where-Object {
            [string]$_.VersionId -ceq $restoredVersion
          }).Count -eq 1
        if ($restoredPresent) {
          Remove-RecoveryObjectVersion -Runtime $Runtime -Key $Document.sourceKey `
            -Version $restoredVersion -DeleteMarker $false
        }
      }
      foreach ($entry in @($markers)) {
        Remove-RecoveryObjectVersion -Runtime $Runtime -Key $Document.sourceKey `
          -Version ([string]$entry.VersionId) -DeleteMarker $true
      }
      if ($originalPresent) { $Document.sourceVersion = $originalVersion }
      elseif (-not [string]::IsNullOrWhiteSpace($restoredVersion)) {
        $Document.sourceVersion = $restoredVersion
      }
    }
    catch {
      throw "Object recovery failed and could not reconcile its exact generated versions for cleanup."
    }
    throw $failure
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
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
  $collection = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'GET' -Path '/v1/profile/facts' -ExpectedStatus 200 -ResponseStage 'profile-review-initial-read-response-validation'
  $script:acceptanceStage = 'profile-review-initial-aggregate-validation'
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
  if ($email.Count -ne 1) {
    $script:acceptanceStage = 'profile-review-email-proposal-validation'
    throw "The clean fixtures did not produce the exact expected synthetic email fact."
  }
  if ($typeScript.Count -ne 1) {
    $script:acceptanceStage = 'profile-review-typescript-proposal-validation'
    throw "The clean fixtures did not produce the exact expected synthetic TypeScript fact."
  }
  if ($postgres.Count -ne 1) {
    $script:acceptanceStage = 'profile-review-postgresql-proposal-validation'
    throw "The clean fixtures did not produce the exact expected synthetic PostgreSQL fact."
  }
  $script:acceptanceStage = 'profile-review-proposal-envelope-validation'
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
    $responseStage = "profile-review-$($update.Key)-response-validation"
    $updated = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'PATCH' -Path "/v1/profile/facts/$($update.Fact.id)" -Body $update.Body -IdempotencyKey "document-acceptance-$($RunId.Replace('-', ''))-$($update.Key)" -ExpectedStatus 200 -ResponseStage $responseStage
    $script:acceptanceStage = "profile-review-$($update.Key)-version-validation"
    if ([int]$updated.version -ne 2) { throw "The exact profile review did not create version 2." }
  }
  $reviewed = Invoke-Gateway -Runtime $Runtime -RunId $RunId -Method 'GET' -Path '/v1/profile/facts' -ExpectedStatus 200 -ResponseStage 'profile-review-final-read-response-validation'
  $script:acceptanceStage = 'profile-review-final-state-validation'
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
  $deleted = Invoke-AwsJson -Arguments @('s3api', 'delete-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $Key, '--version-id', $Version, '--output', 'json') -Operation 'Exact versioned object cleanup'
  if (
    [string]$deleted.VersionId -cne $Version -or
    (Get-OptionalProperty -Object $deleted -Name 'DeleteMarker') -eq $true
  ) {
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
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Documents
  )
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
        $structured = ConvertFrom-OperatorJson -Json $message -Description 'Structured contradiction log'
        $payload = Get-OptionalProperty -Object $structured -Name 'message'
        if (
          $null -eq $payload -or
          $payload -is [string] -or
          (@($payload.PSObject.Properties.Name) -join '|') -cne 'event' -or
          [string]$payload.event -cne 'document_processing_security_contradiction'
        ) {
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

function Read-CorpusDescriptor {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$RunId)
  $resolved = Resolve-OperatorPath -Candidate $Path -AllowedRoot $operatorRoot -MustExist
  $descriptor = ConvertFrom-OperatorJson (Get-Content -LiteralPath $resolved -Raw) 'Document parser corpus descriptor'
  Assert-ExactPropertySet $descriptor 'Document parser corpus descriptor' @(
    'schemaVersion', 'kind', 'corpusVersion', 'runId', 'corpusSha256', 'cases', 'files'
  )
  if ([int]$descriptor.schemaVersion -ne 1 -or
    [string]$descriptor.kind -cne 'development-document-parser-adversarial-corpus' -or
    [string]$descriptor.corpusVersion -cne 'document-parser-adversarial-v1' -or
    [string]$descriptor.runId -cne $RunId -or [string]$descriptor.corpusSha256 -notmatch '^[a-f0-9]{64}$' -or
    @($descriptor.cases).Count -ne 43 -or @($descriptor.files).Count -ne 43) {
    throw 'The generated document parser corpus descriptor is invalid.'
  }
  $ids = @{}
  foreach ($entry in @($descriptor.cases)) {
    Assert-ExactPropertySet $entry 'Document parser corpus case' @(
      'caseId', 'documentId', 'mediaType', 'sizeBytes', 'sha256', 'expectedFailureCode', 'expectedReasonCode'
    )
    if ([string]$entry.caseId -notmatch '^(docx|pdf)-[0-9]{3}$' -or $ids.ContainsKey([string]$entry.caseId) -or
      [string]$entry.documentId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      [string]$entry.mediaType -notin @('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') -or
      [long]$entry.sizeBytes -lt 1 -or [long]$entry.sizeBytes -gt 5242880 -or [string]$entry.sha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$entry.expectedFailureCode -notin @('invalid_document', 'parse_failed') -or
      [string]$entry.expectedReasonCode -notmatch '^[A-Z0-9_]{1,64}$') {
      throw 'A generated document parser corpus case is invalid.'
    }
    $ids[[string]$entry.caseId] = $true
    $file = @($descriptor.files | Where-Object { [string]$_.caseId -ceq [string]$entry.caseId })
    if ($file.Count -ne 1) { throw 'A generated corpus case file is missing or ambiguous.' }
    $filePath = Resolve-OperatorPath -Candidate ([string]$file[0].path) -AllowedRoot $operatorRoot -MustExist
    if ((Get-FileSha256 $filePath) -cne [string]$entry.sha256 -or (Get-Item -LiteralPath $filePath).Length -ne [long]$entry.sizeBytes) {
      throw 'A generated corpus case does not match its reviewed bytes.'
    }
    $file[0] | Add-Member NoteProperty resolvedPath $filePath -Force
  }
  [pscustomobject]@{ Path = $resolved; Descriptor = $descriptor }
}

function Read-CorpusPlan {
  param([switch]$RequireFiles, [switch]$RequireFresh)
  $path = Resolve-OperatorPath $ExecutionPlanPath $operatorRoot -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedExecutionPlanSha256) { throw 'The corpus plan checksum does not match review.' }
  $plan = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) 'Document parser corpus plan'
  Assert-ExactPropertySet $plan 'Document parser corpus plan' @(
    'schemaVersion', 'kind', 'environment', 'region', 'accountId', 'stateBucket', 'stateLineage', 'stateSerial',
    'sourceSha', 'operatorSourceSha', 'sourceToOperatorDeltaSha256', 'migrationReceiptSha256', 'migrationImage',
    'runId', 'corpusVersion', 'corpusSha256', 'descriptorPath', 'descriptorSha256', 'cases', 'runtime', 'createdAt'
  )
  if ([int]$plan.schemaVersion -ne 1 -or [string]$plan.kind -cne 'development-document-parser-corpus-plan' -or
    [string]$plan.environment -cne 'development' -or [string]$plan.region -cne $Region -or [string]$plan.accountId -cne $ExpectedAccountId -or
    [string]$plan.stateBucket -cne $StateBucket -or [string]$plan.stateLineage -cne $identity.Lineage -or [long]$plan.stateSerial -ne $identity.Serial -or
    [string]$plan.sourceSha -cne $SourceSha -or [string]$plan.operatorSourceSha -cne $script:operatorSourceSha -or
    [string]$plan.sourceToOperatorDeltaSha256 -cne $script:sourceToOperatorDeltaSha256 -or
    [string]$plan.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or [string]$plan.migrationImage -cne $migration.ImageUri -or
    [string]$plan.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
    [string]$plan.corpusVersion -cne 'document-parser-adversarial-v1' -or [string]$plan.corpusSha256 -cne $FixtureSetSha256 -or
    @($plan.cases).Count -ne 43 -or -not (Test-CanonicalTimestamp $plan.createdAt) -or
    (ConvertTo-DeploymentCanonicalValue $plan.runtime) -cne (ConvertTo-DeploymentCanonicalValue (ConvertTo-ReviewedRuntimeIdentity $runtime))) {
    throw 'The corpus plan is outside the exact reviewed source, state, artifact, or dark runtime.'
  }
  if ($RequireFresh -and ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$plan.createdAt)).TotalMinutes -gt 15) {
    throw 'The corpus plan is outside its 15-minute review window.'
  }
  $descriptor = $null
  if ($RequireFiles) {
    $descriptor = Read-CorpusDescriptor ([string]$plan.descriptorPath) ([string]$plan.runId)
    if ((Get-FileSha256 $descriptor.Path) -cne [string]$plan.descriptorSha256 -or
      (ConvertTo-DeploymentCanonicalValue @($descriptor.Descriptor.cases)) -cne (ConvertTo-DeploymentCanonicalValue @($plan.cases))) {
      throw 'The reviewed corpus descriptor changed.'
    }
  }
  [pscustomobject]@{ Path = $path; Plan = $plan; Descriptor = $descriptor }
}

function Write-CorpusReceipt {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Receipt)
  Write-JsonFile $Path $Receipt -AllowReplace
}

function Remove-CorpusFiles {
  param([Parameter(Mandatory)][string]$DescriptorPath)
  $resolvedDescriptor = Resolve-OperatorPath -Candidate $DescriptorPath -AllowedRoot $operatorRoot
  $directory = [IO.Path]::GetFullPath((Split-Path -Parent $resolvedDescriptor))
  $root = [IO.Path]::GetFullPath($operatorRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  if (-not $directory.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($directory) -notmatch '^corpus-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'Refusing to remove corpus files outside the exact generated operator directory.'
  }
  if (Test-Path -LiteralPath $directory) {
    [IO.Directory]::Delete($directory, $true)
  }
  if (Test-Path -LiteralPath $directory) { throw 'Generated corpus bytes remain after cleanup.' }
}

function Publish-CorpusSource {
  param(
    [Parameter(Mandatory)][object]$Runtime,
    [Parameter(Mandatory)][object]$Entry,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ReceiptPath
  )
  Assert-ReviewedRuntimeUnchanged
  $key = "quarantine/$($Entry.documentId)/source"
  $checksum = Convert-HexToBase64 ([string]$Entry.sha256)
  $put = Invoke-AwsJson @(
    's3api', 'put-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $key,
    '--body', $Path, '--if-none-match', '*', '--content-type', [string]$Entry.mediaType,
    '--server-side-encryption', 'aws:kms', '--ssekms-key-id', $Runtime.PlatformKmsKeyArn, '--bucket-key-enabled',
    '--checksum-sha256', $checksum, '--metadata', "document-id=$($Entry.documentId),sha256=$($Entry.sha256)", '--output', 'json'
  ) 'Corpus source object upload'
  if ([string]$put.VersionId -notmatch '^.{1,1024}$' -or [string]$put.ChecksumSHA256 -cne $checksum) {
    throw 'The corpus upload response is invalid.'
  }
  $documents = @($Receipt.documents | Where-Object { [string]$_.caseId -ceq [string]$Entry.caseId })
  if ($documents.Count -ne 1 -or -not [string]::IsNullOrEmpty([string]$documents[0].sourceVersion)) {
    throw 'The corpus upload checkpoint is missing or already versioned.'
  }
  $documents[0].sourceVersion = [string]$put.VersionId
  Write-CorpusReceipt $ReceiptPath $Receipt
  $head = Invoke-AwsJson @(
    's3api', 'head-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', $key,
    '--version-id', [string]$put.VersionId, '--output', 'json'
  ) 'Corpus source object readback'
  if ([string]$head.VersionId -cne [string]$put.VersionId -or [long]$head.ContentLength -ne [long]$Entry.sizeBytes -or
    [string]$head.ContentType -cne [string]$Entry.mediaType -or [string]$head.ServerSideEncryption -cne 'aws:kms' -or
    [string]$head.SSEKMSKeyId -cne $Runtime.PlatformKmsKeyArn -or
    [string]$head.Metadata.'document-id' -cne [string]$Entry.documentId -or [string]$head.Metadata.sha256 -cne [string]$Entry.sha256) {
    throw 'The corpus source object readback is outside the reviewed generated bytes.'
  }
  $documents[0]
}

function Remove-CorpusObjects {
  param([Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object[]]$Documents)
  foreach ($document in @($Documents)) {
    $boundaries = @(
      [pscustomobject]@{ Prefix = [string]$document.sourceKey; Exact = [string]$document.sourceKey },
      [pscustomobject]@{ Prefix = "normalized/$($document.documentId)/"; Exact = '' }
    )
    foreach ($boundary in $boundaries) {
      Assert-ReviewedRuntimeUnchanged
      $history = Invoke-AwsJson @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $boundary.Prefix, '--output', 'json') 'Corpus object cleanup discovery'
      $versions = @(Get-OptionalItems $history 'Versions')
      $markers = @(Get-OptionalItems $history 'DeleteMarkers')
      $outside = @($versions + $markers | Where-Object {
          if ([string]::IsNullOrEmpty([string]$boundary.Exact)) {
            -not ([string]$_.Key).StartsWith([string]$boundary.Prefix, [StringComparison]::Ordinal)
          }
          else { [string]$_.Key -cne [string]$boundary.Exact }
        })
      if ($outside.Count -ne 0) { throw 'Corpus cleanup found an object outside the exact generated namespace.' }
      foreach ($entry in @($versions + $markers)) {
        Assert-ReviewedRuntimeUnchanged
        $null = Invoke-AwsJson @('s3api', 'delete-object', '--bucket', $Runtime.CandidateDocumentBucket, '--key', [string]$entry.Key, '--version-id', [string]$entry.VersionId, '--output', 'json') 'Corpus exact object cleanup'
      }
      $after = Invoke-AwsJson @('s3api', 'list-object-versions', '--bucket', $Runtime.CandidateDocumentBucket, '--prefix', $boundary.Prefix, '--output', 'json') 'Corpus post-cleanup proof'
      if (@(Get-OptionalItems $after 'Versions').Count -ne 0 -or @(Get-OptionalItems $after 'DeleteMarkers').Count -ne 0) {
        throw 'Corpus cleanup did not reduce the exact generated namespace to zero.'
      }
    }
  }
}

function Assert-CorpusAggregate {
  param([Parameter(Mandatory)][object]$Aggregate, [Parameter(Mandatory)][object]$Plan)
  Assert-ExactPropertySet $Aggregate 'Document parser corpus aggregate' @(
    'schemaVersion', 'profile', 'corpusVersion', 'corpusSha256', 'releaseSourceSha', 'runId',
    'parserVersion', 'caseCount', 'rejectedCount', 'databaseAccessed', 'reasonCodeCounts'
  )
  $expected = @{}
  foreach ($entry in @($Plan.cases)) { $expected[[string]$entry.expectedReasonCode] = 1 + [int]($expected[[string]$entry.expectedReasonCode]) }
  if ([int]$Aggregate.schemaVersion -ne 1 -or [string]$Aggregate.profile -cne 'd1_deployed_document_parser_adversarial_corpus_v1' -or
    [string]$Aggregate.corpusVersion -cne [string]$Plan.corpusVersion -or [string]$Aggregate.corpusSha256 -cne [string]$Plan.corpusSha256 -or
    [string]$Aggregate.releaseSourceSha -cne $SourceSha -or [string]$Aggregate.runId -cne [string]$Plan.runId -or
    [string]$Aggregate.parserVersion -cne 'resume-parser-v1' -or [int]$Aggregate.caseCount -ne 43 -or [int]$Aggregate.rejectedCount -ne 43 -or
    $Aggregate.databaseAccessed -isnot [bool] -or [bool]$Aggregate.databaseAccessed -or
    (ConvertTo-DeploymentCanonicalValue $Aggregate.reasonCodeCounts) -cne (ConvertTo-DeploymentCanonicalValue $expected)) {
    throw 'The deployed parser did not return the exact aggregate-only corpus result.'
  }
  $true
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

if ($Action -eq 'CorpusPlan') {
  & pnpm --filter '@ai-job-apply/documents-service' build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The exact Documents source could not build the corpus generator.' }
  $runId = [guid]::NewGuid().ToString()
  $directory = Join-Path $operatorRoot "corpus-$runId"
  & node $corpusGenerator --run-id $runId --output-directory $directory 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The bounded generated-only adversarial corpus could not be created.' }
  $descriptor = Read-CorpusDescriptor (Join-Path $directory 'descriptor.json') $runId
  if ([string]::IsNullOrWhiteSpace($ExecutionPlanPath)) { $ExecutionPlanPath = Join-Path $operatorRoot "corpus-plan-$runId.json" }
  $path = Resolve-OperatorPath $ExecutionPlanPath $operatorRoot
  $plan = [ordered]@{
    schemaVersion = 1; kind = 'development-document-parser-corpus-plan'; environment = 'development'
    region = $Region; accountId = $ExpectedAccountId; stateBucket = $StateBucket
    stateLineage = $identity.Lineage; stateSerial = $identity.Serial; sourceSha = $SourceSha
    operatorSourceSha = $script:operatorSourceSha; sourceToOperatorDeltaSha256 = $script:sourceToOperatorDeltaSha256
    migrationReceiptSha256 = $ReviewedMigrationReceiptSha256; migrationImage = $migration.ImageUri
    runId = $runId; corpusVersion = [string]$descriptor.Descriptor.corpusVersion
    corpusSha256 = [string]$descriptor.Descriptor.corpusSha256; descriptorPath = $descriptor.Path
    descriptorSha256 = Get-FileSha256 $descriptor.Path; cases = @($descriptor.Descriptor.cases)
    runtime = ConvertTo-ReviewedRuntimeIdentity $runtime; createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  Write-JsonFile $path $plan
  [pscustomobject]@{ Outcome = 'review-required'; ExecutionPlanPath = $path; ExecutionPlanSha256 = Get-FileSha256 $path; CorpusSha256 = $plan.corpusSha256; CaseCount = 43; TriggerActivation = $false; RealCandidateData = $false }
  exit 0
}

if ($Action -in @('CorpusExecute', 'CorpusRecoverCleanup', 'CorpusVerify')) {
  $corpusPlan = Read-CorpusPlan -RequireFiles:($Action -eq 'CorpusExecute') -RequireFresh:($Action -eq 'CorpusExecute')
  $script:reviewedRuntimeIdentity = $corpusPlan.Plan.runtime
  $script:reviewedRuntimeImage = $migration.ImageUri
  $script:reviewedStateLineage = $corpusPlan.Plan.stateLineage
  $script:reviewedStateSerial = $identity.Serial
  $receiptPath = if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    Join-Path $operatorRoot "corpus-receipt-$ReviewedExecutionPlanSha256.json"
  } else { Resolve-OperatorPath $ReceiptPath $operatorRoot }
  if ($Action -eq 'CorpusExecute') {
    if (Test-Path -LiteralPath $receiptPath) { throw 'Refusing to replace an existing corpus receipt or start a second run.' }
    $receipt = [ordered]@{
      schemaVersion = 1; kind = 'development-document-parser-corpus-receipt'; phase = 'running'
      sourceSha = $SourceSha; executionPlanSha256 = $ReviewedExecutionPlanSha256; runId = $corpusPlan.Plan.runId
      corpusSha256 = $FixtureSetSha256; parserVersion = $runtime.ParserVersion; parserVersionArn = $runtime.ParserVersionArn
      parserCodeSha256 = $runtime.ParserCodeSha256; processorVersionArn = $runtime.ProcessorVersionArn
      parserSemanticVersion = $runtime.ParserSemanticVersion
      documents = @(); aggregatePath = ''; aggregateSha256 = ''; objectsRemoved = $false; databaseRowsCreated = 0
      startedAt = [DateTimeOffset]::UtcNow.ToString('o'); completedAt = ''
    }
    Write-JsonFile $receiptPath $receipt
    $primary = $null
    $cleanup = $null
    $aggregate = $null
    try {
      $files = @($corpusPlan.Descriptor.Descriptor.files)
      foreach ($entry in @($corpusPlan.Plan.cases)) {
        Assert-TriggersDark $runtime.State | Out-Null
        Assert-ReviewedRuntimeUnchanged
        $file = @($files | Where-Object { [string]$_.caseId -ceq [string]$entry.caseId })
        if ($file.Count -ne 1) { throw 'The reviewed corpus file is not exact.' }
        $document = [pscustomobject]@{
          caseId = [string]$entry.caseId; documentId = [string]$entry.documentId
          sourceKey = "quarantine/$($entry.documentId)/source"; sourceVersion = ''; sha256 = [string]$entry.sha256
        }
        $receipt.documents += $document
        Write-CorpusReceipt $receiptPath $receipt
        $document = Publish-CorpusSource -Runtime $runtime -Entry $entry -Path ([string]$file[0].resolvedPath) -Receipt $receipt -ReceiptPath $receiptPath
        Set-ExactScanTag $runtime $document 'NO_THREATS_FOUND'
      }
      $requestCases = @($corpusPlan.Plan.cases | ForEach-Object {
          $case = $_
          $documents = @($receipt.documents | Where-Object { [string]$_.caseId -ceq [string]$case.caseId })
          if ($documents.Count -ne 1) { throw 'The uploaded corpus source version is missing or ambiguous.' }
          [ordered]@{
            caseId = $case.caseId; documentId = $case.documentId; sourceObjectKey = "quarantine/$($case.documentId)/source"
            sourceObjectVersion = [string]$documents[0].sourceVersion
            mediaType = $case.mediaType; sizeBytes = $case.sizeBytes; sha256 = $case.sha256
            createdAt = '2026-08-26T00:00:00.000Z'; expectedFailureCode = $case.expectedFailureCode; expectedReasonCode = $case.expectedReasonCode
          }
        })
      $request = [ordered]@{
        schemaVersion = 1; kind = 'development-document-parser-corpus-v1'; corpusVersion = $corpusPlan.Plan.corpusVersion
        corpusSha256 = $corpusPlan.Plan.corpusSha256; releaseSourceSha = $SourceSha; runId = $corpusPlan.Plan.runId; cases = $requestCases
      }
      $response = Invoke-LambdaJson $runtime.ProcessorVersionArn $request 'Direct generated document parser corpus invocation'
      $aggregate = $response.Payload
      Assert-CorpusAggregate $aggregate $corpusPlan.Plan | Out-Null
    } catch { $primary = $_ }
    finally {
      try {
        Remove-CorpusObjects $runtime @($receipt.documents)
        $receipt.objectsRemoved = $true
        Remove-CorpusFiles ([string]$corpusPlan.Plan.descriptorPath)
      } catch { $cleanup = $_ }
    }
    if ($null -ne $cleanup) { $receipt.phase = 'cleanup-required'; Write-CorpusReceipt $receiptPath $receipt; throw 'Corpus execution did not prove exact object/file cleanup; use CorpusRecoverCleanup.' }
    if ($null -ne $primary) { $receipt.phase = 'failed-cleaned'; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o'); Write-CorpusReceipt $receiptPath $receipt; throw 'Corpus execution failed after exact cleanup; no acceptance is claimed.' }
    $aggregatePath = Join-Path $operatorRoot "corpus-aggregate-$ReviewedExecutionPlanSha256.json"
    Write-JsonFile $aggregatePath $aggregate
    $receipt.phase = 'verified'; $receipt.aggregatePath = $aggregatePath; $receipt.aggregateSha256 = Get-FileSha256 $aggregatePath
    $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o'); Write-CorpusReceipt $receiptPath $receipt
    [pscustomobject]@{ Outcome = 'verified-and-cleaned'; ReceiptPath = $receiptPath; ReceiptSha256 = Get-FileSha256 $receiptPath; AggregatePath = $aggregatePath; AggregateSha256 = $receipt.aggregateSha256; CaseCount = 43; RejectedCount = 43; PersistentRows = 0; ObjectsRemoved = $true; TriggerActivation = $false; RealCandidateData = $false }
    exit 0
  }
  $receiptPath = Resolve-OperatorPath $ReceiptPath $operatorRoot -MustExist
  if ((Get-FileSha256 $receiptPath) -cne $ReviewedReceiptSha256) { throw 'The reviewed corpus receipt checksum changed.' }
  $receipt = ConvertFrom-OperatorJson (Get-Content $receiptPath -Raw) 'Document parser corpus receipt'
  Assert-ExactPropertySet $receipt 'Document parser corpus receipt' @(
    'schemaVersion', 'kind', 'phase', 'sourceSha', 'executionPlanSha256', 'runId', 'corpusSha256',
    'parserVersion', 'parserVersionArn', 'parserCodeSha256', 'parserSemanticVersion', 'processorVersionArn',
    'documents', 'aggregatePath', 'aggregateSha256', 'objectsRemoved', 'databaseRowsCreated', 'startedAt', 'completedAt'
  )
  if ([string]$receipt.kind -cne 'development-document-parser-corpus-receipt' -or [string]$receipt.sourceSha -cne $SourceSha -or
    [string]$receipt.executionPlanSha256 -cne $ReviewedExecutionPlanSha256 -or [string]$receipt.corpusSha256 -cne $FixtureSetSha256 -or
    [int]$receipt.schemaVersion -ne 1 -or [string]$receipt.runId -cne [string]$corpusPlan.Plan.runId -or
    [string]$receipt.parserVersion -cne $runtime.ParserVersion -or [string]$receipt.parserVersionArn -cne $runtime.ParserVersionArn -or
    [string]$receipt.parserCodeSha256 -cne $runtime.ParserCodeSha256 -or
    [string]$receipt.parserSemanticVersion -cne $runtime.ParserSemanticVersion -or [string]$receipt.processorVersionArn -cne $runtime.ProcessorVersionArn) {
    throw 'The corpus receipt is outside the exact reviewed release.'
  }
  $receiptIds = @{}
  foreach ($document in @($receipt.documents)) {
    Assert-ExactPropertySet $document 'Document parser corpus receipt document' @('caseId', 'documentId', 'sourceKey', 'sourceVersion', 'sha256')
    $case = @($corpusPlan.Plan.cases | Where-Object { [string]$_.caseId -ceq [string]$document.caseId })
    if ($case.Count -ne 1 -or $receiptIds.ContainsKey([string]$document.caseId) -or
      [string]$document.documentId -cne [string]$case[0].documentId -or
      [string]$document.sourceKey -cne "quarantine/$($case[0].documentId)/source" -or
      (($Action -eq 'CorpusVerify' -and [string]$document.sourceVersion -notmatch '^.{1,1024}$') -or
        ($Action -eq 'CorpusRecoverCleanup' -and -not ([string]::IsNullOrEmpty([string]$document.sourceVersion) -or [string]$document.sourceVersion -match '^.{1,1024}$'))) -or
      [string]$document.sha256 -cne [string]$case[0].sha256) {
      throw 'The corpus receipt contains an unreviewed document or object version.'
    }
    $receiptIds[[string]$document.caseId] = $true
  }
  if ($Action -eq 'CorpusRecoverCleanup') {
    if ([string]$receipt.phase -notin @('running', 'cleanup-required')) { throw 'Corpus cleanup recovery requires an interrupted or cleanup-required receipt.' }
    Remove-CorpusObjects $runtime @($receipt.documents)
    Remove-CorpusFiles ([string]$corpusPlan.Plan.descriptorPath)
    $receipt.objectsRemoved = $true; $receipt.phase = 'recovered-cleaned'; $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-CorpusReceipt $receiptPath $receipt
    [pscustomobject]@{ Outcome = 'cleanup-recovered'; ReceiptPath = $receiptPath; ReceiptSha256 = Get-FileSha256 $receiptPath; AcceptanceClaim = $false; PersistentRows = 0; ObjectsRemoved = $true }
    exit 0
  }
  $aggregatePath = Resolve-OperatorPath ([string]$receipt.aggregatePath) $operatorRoot -MustExist
  if ([string]$receipt.phase -cne 'verified' -or @($receipt.documents).Count -ne 43 -or
    $receipt.objectsRemoved -isnot [bool] -or -not [bool]$receipt.objectsRemoved -or [int]$receipt.databaseRowsCreated -ne 0 -or
    (Get-FileSha256 $aggregatePath) -cne [string]$receipt.aggregateSha256) {
    throw 'Corpus Verify requires a complete aggregate-only, zero-row, cleaned receipt.'
  }
  $aggregate = ConvertFrom-OperatorJson (Get-Content $aggregatePath -Raw) 'Document parser corpus aggregate'
  Assert-CorpusAggregate $aggregate $corpusPlan.Plan | Out-Null
  Assert-TriggersDark $runtime.State | Out-Null; Assert-ZeroTasks $runtime.ClusterArn
  [pscustomobject]@{ Outcome = 'verified'; ReceiptSha256 = $ReviewedReceiptSha256; AggregateSha256 = $receipt.aggregateSha256; CaseCount = 43; RejectedCount = 43; PersistentRows = 0; ObjectsRemoved = $true; TriggerActivation = $false; CloudMutation = $false; RealCandidateData = $false }
  exit 0
}

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

$planEvidence = Read-ExecutionPlan -Path $ExecutionPlanPath -Sha $ReviewedExecutionPlanSha256 -RequireFresh:($Action -in @('Execute', 'ServiceDetection', 'ObjectRecovery'))
$currentRuntime = ConvertTo-ReviewedRuntimeIdentity -Runtime $runtime
$runtimeIdentityUnchanged = (
  [string]$planEvidence.Plan.stateLineage -ceq $identity.Lineage -and
  [string]$planEvidence.Plan.migrationImage -ceq $migration.ImageUri -and
  (ConvertTo-DeploymentCanonicalValue $planEvidence.Plan.runtime) -ceq (ConvertTo-DeploymentCanonicalValue $currentRuntime)
)
$recoveryOnlyStateAdvance = (
  $Action -in @('RecoverCleanup', 'Verify') -and
  $runtimeIdentityUnchanged -and
  [long]$identity.Serial -gt [long]$planEvidence.Plan.stateSerial
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

if ($Action -in @('ServiceDetection', 'ObjectRecovery')) {
  $objectRecoveryRequested = $Action -ceq 'ObjectRecovery'
  $null = Assert-DocumentOperationalHealth
  $receiptPrefix = if ($objectRecoveryRequested) { 'object-recovery-receipt' } else { 'service-detection-receipt' }
  $ReceiptPath = Join-Path $operatorRoot "$receiptPrefix-$($SourceSha.Substring(0, 12))-$ReviewedExecutionPlanSha256.json"
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
  $service = $null
  $objectRecovery = $null
  try {
    $receipt.phase = 'service-detection-running'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $document = Register-And-UploadFixture -Runtime $runtime -FixtureEvidence $planEvidence.Fixture `
      -RunId $receipt.runId -Role 'clean-pdf' -Receipt $receipt -Documents $documents
    $script:acceptanceStage = 'clean-pdf.guardduty-service-detection'
    $service = Wait-GuardDutyServiceScan -Runtime $runtime -Document $document
    if ($objectRecoveryRequested) {
      $objectRecovery = Invoke-VersionedObjectRecovery -Runtime $runtime -Document $document
      Save-RecoveryDescriptor -Receipt $receipt -Documents @($documents)
    }
  }
  catch {
    $primaryFailure = [pscustomobject]@{
      ErrorRecord = $_
      Stage = [string]$script:acceptanceStage
    }
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
      $cleanup = Wait-Task -Request $requestByPhase.cleanup -TaskArn $arn -Phase 'cleanup'
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
    throw "$Action did not prove exact cleanup. Retain and review the receipt before RecoverCleanup."
  }
  $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  if ($null -ne $primaryFailure) {
    $receipt.phase = 'failed-cleaned'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    throw "$Action failed during guarded stage '$($primaryFailure.Stage)' after exact cleanup; no acceptance claim is made."
  }
  if (
    $null -eq $service -or [string]$service.ScanResult -cne 'NO_THREATS_FOUND' -or
    ($objectRecoveryRequested -and (
      $null -eq $objectRecovery -or -not [bool]$objectRecovery.PriorVersionRecovered -or
      -not [bool]$objectRecovery.DeleteMarkerRemoved -or
      -not [bool]$objectRecovery.SupersededVersionRemoved -or
      -not [bool]$objectRecovery.RestoredVersionRescanned
    )) -or
    $receipt.persistentRows -ne 0 -or -not $receipt.databaseCleaned -or -not $receipt.objectsRemoved
  ) {
    throw "$Action did not prove its exact managed-scan/recovery boundary and zero persistent artifacts."
  }
  $receipt.phase = if ($objectRecoveryRequested) { 'object-recovery-verified' } else { 'service-detection-verified' }
  Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
  [pscustomobject]@{
    Outcome = if ($objectRecoveryRequested) {
      'versioned-object-recovery-verified-and-cleaned'
    } else { 'guardduty-service-detection-verified-and-cleaned' }
    ReceiptPath = $receiptPath
    ReceiptSha256 = Get-FileSha256 $receiptPath
    ProtectionPlanStatus = $service.ProtectionPlanStatus
    TaggingStatus = $service.TaggingStatus
    ScanResult = $service.ScanResult
    ScannedObjectCount = if ($objectRecoveryRequested) { 2 } else { 1 }
    PersistentRows = 0
    DatabaseCleaned = $true
    ObjectsRemoved = $true
    TriggerActivation = $false
    GuardDutyServiceDetectionProved = $true
    VersionedObjectRecoveryProved = $objectRecoveryRequested
    DeleteMarkerRecoveryProved = $objectRecoveryRequested
    RestoredVersionRescanProved = $objectRecoveryRequested
    EventBridgeDeliveryProved = $false
    SqsDeliveryProved = $false
    EventSourceMappingProved = $false
    RealCandidateData = $false
  }
  exit 0
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
  $script:acceptanceStage = 'preflight-submission'
  try {
    $receipt.phase = 'running'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    Assert-TriggersDark -State $runtime.State | Out-Null

    $arn = Submit-Task -Request $requestByPhase.preflight
    $receipt.taskArns.preflight = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $script:acceptanceStage = 'preflight-result-validation'
    $result = Wait-Task -Request $requestByPhase.preflight -TaskArn $arn -Phase 'preflight'
    $receipt.resultSha256ByAction.preflight = [string]$result.canonicalSha256

    $script:acceptanceStage = 'clean-pdf-registration'
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
    $result = Wait-Task -Request $requestByPhase.clean -TaskArn $arn -Phase 'clean'
    $receipt.resultSha256ByAction.clean = [string]$result.canonicalSha256

    Invoke-ProfileReview -Runtime $runtime -RunId $receipt.runId
    $arn = Submit-Task -Request $requestByPhase.reviewed
    $receipt.taskArns.reviewed = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.reviewed -TaskArn $arn -Phase 'reviewed'
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
    $result = Wait-Task -Request $requestByPhase.terminal -TaskArn $arn -Phase 'terminal'
    $receipt.resultSha256ByAction.terminal = [string]$result.canonicalSha256

    $contradictionObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Invoke-DirectProcessorScan -Runtime $runtime -Document $cleanPdf -RunId $receipt.runId -Ordinal 5 -ObservedAt $contradictionObservedAt -ScanResult 'THREATS_FOUND'
    $arn = Submit-Task -Request $requestByPhase.contradiction
    $receipt.taskArns.contradiction = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.contradiction -TaskArn $arn -Phase 'contradiction'
    $receipt.resultSha256ByAction.contradiction = [string]$result.canonicalSha256

    $arn = Submit-Task -Request $requestByPhase.'rollback-probe'
    $receipt.taskArns.'rollback-probe' = $arn
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    $result = Wait-Task -Request $requestByPhase.'rollback-probe' -TaskArn $arn -Phase 'rollback-probe'
    $receipt.resultSha256ByAction.'rollback-probe' = [string]$result.canonicalSha256
    $receipt.rollbackProved = [bool]$result.rollbackProved
  }
  catch {
    $primaryFailure = [pscustomobject]@{
      ErrorRecord = $_
      Stage = [string]$script:acceptanceStage
    }
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
      $cleanup = Wait-Task -Request $requestByPhase.cleanup -TaskArn $arn -Phase 'cleanup'
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
    if ($null -ne $primaryFailure) {
      throw "Document acceptance failed during guarded stage '$($primaryFailure.Stage)' and did not prove exact cleanup. Retain and review the receipt before RecoverCleanup."
    }
    throw "Document acceptance did not prove exact database and object cleanup. Retain and review the receipt before RecoverCleanup."
  }
  $receipt.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  if ($null -ne $primaryFailure) {
    $receipt.phase = 'failed-cleaned'
    Write-JsonFile -Path $receiptPath -Value $receipt -AllowReplace
    throw "Document acceptance failed during guarded stage '$($primaryFailure.Stage)' after exact cleanup; no acceptance claim is made."
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
    Add-RecoveryTaskEvidence -Receipt $receipt -TaskArn $recoveryTask.Arn -ResultSha256 ([string]$cleanup.canonicalSha256)
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
