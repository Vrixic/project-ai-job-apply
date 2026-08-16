$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$helperPath = Join-Path $repositoryRoot "scripts\lib\staging-postgresql-restore-verifier.ps1"
$operatorPath = Join-Path $repositoryRoot "scripts\operate-staging-postgresql-restore.ps1"
$packagePath = Join-Path $repositoryRoot "package.json"
. $helperPath
$helperSource = Get-Content -LiteralPath $helperPath -Raw

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-D1RestoreJson
if (
  [string]$package.scripts."test:staging-restore:ps7" -cne `
    "pwsh -NoProfile -File scripts/tests/staging-postgresql-restore-verifier.tests.ps1" -or
  [string]$package.scripts."test:staging-restore:ps5" -cne `
    "powershell.exe -NoProfile -File scripts/tests/staging-postgresql-restore-verifier.tests.ps1" -or
  -not ([string]$package.scripts."infrastructure:validate").Contains(
    "pnpm test:staging-restore:ps7"
  )
) {
  throw "The root validation scripts do not retain the PS7/PS5 restore verifier gates."
}

function Assert-Throws {
  param(
    [scriptblock]$Operation,
    [string]$Label
  )

  try {
    & $Operation
  }
  catch {
    return
  }
  throw "$Label did not fail closed."
}

function New-TestContext {
  param(
    [object]$Boundary,
    [bool]$Verified = $false
  )

  $digest = ("b" * 64) -join ""
  return [pscustomobject][ordered]@{
    source_identifier = "ai-job-apply-staging"
    target_identifier = "ai-job-apply-staging-restore-20260815120000"
    started_at = "2026-08-15T12:00:00Z"
    source_manifest_id = [string]$Boundary.ManifestId
    source_manifest_sha256 = [string]$Boundary.ManifestSha256
    source_owner_count = [int]$Boundary.OwnerCount
    source_relation_count = [int]$Boundary.RelationCount
    source_migration_count = [int]$Boundary.MigrationCount
    source_digest = $digest
    source_boundary_sha256 = ("d" * 64) -join ""
    source_dbi_resource_id = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
    source_log_events = 1
    source_resource_arn = "arn:aws:rds:us-east-2:123456789012:db:ai-job-apply-staging"
    restore_request_sha256 = ("e" * 64) -join ""
    runtime_cluster_arn = "arn:aws:ecs:us-east-2:123456789012:cluster/ai-job-apply-staging"
    runtime_container_name = "database-migration"
    runtime_image = "123456789012.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$(('a' * 64) -join '')"
    runtime_log_stream_prefix = "database-migration"
    runtime_security_group_id = "sg-0123456789abcdef0"
    runtime_subnet_ids = @("subnet-0123456789abcdef0", "subnet-1123456789abcdef0")
    runtime_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-staging-database-migration:7"
    target_boundary_authenticated = $Verified
    target_boundary_sha256 = if ($Verified) { ("f" * 64) -join "" } else { $null }
    target_dbi_resource_id = if ($Verified) { "db-ZYXWVUTSRQPONMLKJIHGFEDC" } else { $null }
    target_resource_arn = if ($Verified) {
      "arn:aws:rds:us-east-2:123456789012:db:ai-job-apply-staging-restore-20260815120000"
    } else { $null }
    target_manifest_id = if ($Verified) { [string]$Boundary.ManifestId } else { $null }
    target_manifest_sha256 = if ($Verified) { [string]$Boundary.ManifestSha256 } else { $null }
    target_owner_count = if ($Verified) { [int]$Boundary.OwnerCount } else { $null }
    target_relation_count = if ($Verified) { [int]$Boundary.RelationCount } else { $null }
    target_migration_count = if ($Verified) { [int]$Boundary.MigrationCount } else { $null }
    target_digest = if ($Verified) { $digest } else { $null }
    restore_point_lag_seconds = 2
    restore_available_seconds = 11
    functional_recovery_seconds = if ($Verified) { 15 } else { 0 }
    verified = $Verified
  }
}

$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$null, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The restore verifier helper did not parse." }
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$null, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The staging restore operator did not parse." }

$boundary = Get-D1RestoreManifestBoundary $repositoryRoot
if (
  [string]$boundary.ManifestId -cne "d1-profile-jobs-documents-matching-v1" -or
  [int]$boundary.OwnerCount -ne 4 -or
  [int]$boundary.RelationCount -ne 31 -or
  [int]$boundary.MigrationCount -ne 12 -or
  [string]$boundary.ManifestSha256 -cnotmatch "^[a-f0-9]{64}$"
) {
  throw "The current restore manifest boundary is unexpected."
}

$event = [ordered]@{
  event = "d1_restore_verification"
  schema_version = 1
  kind = "read_only_aggregate"
  manifest_id = [string]$boundary.ManifestId
  manifest_sha256 = [string]$boundary.ManifestSha256
  owner_count = [int]$boundary.OwnerCount
  relation_count = [int]$boundary.RelationCount
  migration_count = [int]$boundary.MigrationCount
  digest = ("c" * 64) -join ""
} | ConvertTo-Json -Compress
$parsed = ConvertFrom-D1RestoreVerifierEvents @($event) $boundary "test"
if ([string]$parsed.Digest -cne (("c" * 64) -join "")) { throw "The exact aggregate was not parsed." }

foreach ($mutation in @(
  { (($event | ConvertFrom-Json) | Select-Object *, @{n = "extra"; e = { $true } }) | ConvertTo-Json -Compress },
  { $value = $event | ConvertFrom-Json; $value.schema_version = "1"; $value | ConvertTo-Json -Compress },
  { $value = $event | ConvertFrom-Json; $value.owner_count = 3.1; $value | ConvertTo-Json -Compress },
  { $value = $event | ConvertFrom-Json; $value.digest = ("C" * 64) -join ""; $value | ConvertTo-Json -Compress },
  { $value = $event | ConvertFrom-Json; $value.manifest_sha256 = ([string]$boundary.ManifestSha256).ToUpperInvariant(); $value | ConvertTo-Json -Compress }
)) {
  Assert-Throws { ConvertFrom-D1RestoreVerifierEvents @((& $mutation)) $boundary "test" } `
    "Malformed aggregate event"
}
Assert-Throws { ConvertFrom-D1RestoreVerifierEvents @($event, $event) $boundary "test" } `
  "Duplicate aggregate events"

$pending = New-TestContext $boundary
$verified = New-TestContext $boundary $true
Assert-D1RestoreContextBoundary $pending $boundary
Assert-D1RestoreContextBoundary $verified $boundary
$authenticated = New-TestContext $boundary
$authenticated.target_boundary_authenticated = $true
$authenticated.target_boundary_sha256 = ("f" * 64) -join ""
$authenticated.target_dbi_resource_id = "db-ZYXWVUTSRQPONMLKJIHGFEDC"
$authenticated.target_resource_arn = `
  "arn:aws:rds:us-east-2:123456789012:db:ai-job-apply-staging-restore-20260815120000"
Assert-D1RestoreContextBoundary $authenticated $boundary

$identity = [pscustomobject]@{
  Account = "123456789012"
  Arn = "arn:aws:sts::123456789012:assumed-role/StagingAdmin/test-session"
}
Assert-D1RestoreAwsCallerBoundary $identity "123456789012"
Assert-Throws { Assert-D1RestoreAwsCallerBoundary $identity "210987654321" } `
  "Wrong AWS account caller"

foreach ($mode in @("source", "target")) {
  $hostName = "$mode.abc123.us-east-2.rds.amazonaws.com"
  $override = New-D1RestoreTaskOverride $mode $hostName
  if (
    @($override.PSObject.Properties.Name).Count -ne 3 -or
    [string]$override.name -cne "database-migration" -or
    @($override.command).Count -ne 1 -or
    [string]$override.command[0] -cne "runner/dist/src/restore-verifier-cli.js" -or
    @($override.environment).Count -ne 1 -or
    [string]$override.environment[0].name -cne "RESTORE_HOST" -or
    [string]$override.environment[0].value -cne $hostName
  ) {
    throw "The $mode task override is not exact."
  }
}
Assert-Throws {
  New-D1RestoreTaskOverride "source" "source.rds.amazonaws.com.evil.example"
} "Unreviewed verifier endpoint"

$runtime = [pscustomobject]@{
  TaskDefinitionArn = $pending.runtime_task_definition_arn
  Image = $pending.runtime_image
  ClusterArn = $pending.runtime_cluster_arn
  SecurityGroupId = $pending.runtime_security_group_id
  ContainerName = $pending.runtime_container_name
  LogStreamPrefix = $pending.runtime_log_stream_prefix
  SubnetIds = @($pending.runtime_subnet_ids)
}
Assert-D1RestoreRuntimeContext $runtime $pending
$driftedRuntime = $runtime.PSObject.Copy()
$driftedRuntime.Image = $driftedRuntime.Image.Replace("sha256:a", "sha256:b")
Assert-Throws { Assert-D1RestoreRuntimeContext $driftedRuntime $pending } `
  "Verifier image drift"

if ((Get-D1RestoreCleanupDisposition $pending $true) -cne "authenticate-and-delete") {
  throw "A present target did not require authentication before delete."
}
if ((Get-D1RestoreCleanupDisposition $authenticated $false) -cne "continue-absent") {
  throw "An authenticated absent target did not resume cleanup."
}
Assert-Throws { Get-D1RestoreCleanupDisposition $pending $false } `
  "Unauthenticated absent target cleanup"

$invalidContexts = @()
$value = New-TestContext $boundary
$value.source_digest = ("B" * 64) -join ""
$invalidContexts += $value
$value = New-TestContext $boundary
$value.source_owner_count = "3"
$invalidContexts += $value
$value = New-TestContext $boundary
$value.source_relation_count = 26.1
$invalidContexts += $value
$value = New-TestContext $boundary $true
$value.target_digest = ("d" * 64) -join ""
$invalidContexts += $value
$value = New-TestContext $boundary
$value.target_manifest_id = [string]$boundary.ManifestId
$invalidContexts += $value
$value = New-TestContext $boundary
$value | Add-Member -NotePropertyName extra -NotePropertyValue $true
$invalidContexts += $value
foreach ($invalid in $invalidContexts) {
  Assert-Throws { Assert-D1RestoreContextBoundary $invalid $boundary } "Malformed restore context"
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) `
  ("d1-restore-context-tests-{0}" -f [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  $contextFile = Join-Path $testRoot "context.json"
  Save-D1RestoreContextFile $pending $contextFile $boundary
  $before = Get-Content -LiteralPath $contextFile -Raw
  Assert-Throws { Save-D1RestoreContextFile $invalidContexts[0] $contextFile $boundary } `
    "Invalid atomic context update"
  if ((Get-Content -LiteralPath $contextFile -Raw) -cne $before) {
    throw "A failed context update changed the last valid context."
  }
  Save-D1RestoreContextFile $verified $contextFile $boundary
  Set-Content -LiteralPath $contextFile -Value "truncated" -Encoding UTF8
  $recovered = Read-D1RestoreContextFile $contextFile $boundary
  if ([bool]$recovered.verified) {
    throw "The recovery copy did not retain the prior valid context."
  }
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

$operator = Get-Content -LiteralPath $operatorPath -Raw
foreach ($required in @(
  '$runtime "source" ([string]$source.Endpoint.Address)',
  '$runtime "target" ([string]$target.Endpoint.Address)',
  'Assert-D1RestoreRuntimeContext $runtime $context',
  'Assert-SourceContextBoundary $source $context',
  'target_boundary_authenticated = $false',
  'Save-D1RestoreContextFile',
  'Read-D1RestoreContextFile'
)) {
  if (-not $operator.Contains($required)) {
    throw "The staging operator is missing the required '$required' boundary."
  }
}
foreach ($required in @(
  'command = @("runner/dist/src/restore-verifier-cli.js")',
  'function Assert-D1RestoreAwsCallerBoundary',
  'function Get-D1RestoreCleanupDisposition'
)) {
  if (-not $helperSource.Contains($required)) {
    throw "The restore helper is missing the required '$required' boundary."
  }
}
foreach ($forbidden in @("--eval", "phase0_restore_verification", '$verifierSource', "source_table_count")) {
  if ($operator.Contains($forbidden)) {
    throw "The staging operator retained forbidden inline or stale verifier behavior."
  }
}
if ($operator -match 'catch\s*\{[^}]*Remove-Item\s+-LiteralPath\s+\$contextPath') {
  throw "An ambiguous restore request failure can remove its recovery context."
}
$startOffset = $operator.IndexOf("function Invoke-StartRestore")
$slowGuardOffset = $operator.IndexOf("Assert-ApplicationBaseline", $startOffset)
$freshSourceOffset = $operator.IndexOf("`$freshSource = Get-SourceDatabase", $startOffset)
$zeroTargetOffset = $operator.IndexOf("if (@(Get-DisposableTargets).Count -ne 0)", $freshSourceOffset)
$saveOffset = $operator.IndexOf("Save-RestoreContext `$context", $freshSourceOffset)
$mutationOffset = $operator.IndexOf('"restore-db-instance-to-point-in-time"', $saveOffset)
if (
  $startOffset -lt 0 -or
  $slowGuardOffset -lt $startOffset -or
  $freshSourceOffset -lt $slowGuardOffset -or
  $zeroTargetOffset -lt $freshSourceOffset -or
  $saveOffset -lt $zeroTargetOffset -or
  $mutationOffset -lt $saveOffset
) {
  throw "The final single-writer restore guard ordering is not exact."
}

$operatorTokens = $null
$operatorErrors = $null
$operatorAst = [Management.Automation.Language.Parser]::ParseFile(
  $operatorPath,
  [ref]$operatorTokens,
  [ref]$operatorErrors
)
$behaviorFunctions = @(
  "Get-SourceIdentityBoundaryJson",
  "Get-D1RestoreStringSha256",
  "Assert-SourceIdentityUnchanged",
  "New-RestoreRequest",
  "Assert-SourceContextBoundary",
  "Invoke-StartRestore"
)
$definitions = @($operatorAst.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $behaviorFunctions -contains $node.Name
}, $true))
if ($definitions.Count -ne $behaviorFunctions.Count) {
  throw "The operator behavioral function boundary could not be loaded."
}
foreach ($definition in $definitions) {
  Invoke-Expression $definition.Extent.Text
}

function New-BehaviorDatabase {
  param(
    [string]$Identifier,
    [string]$ResourceId,
    [string]$Address,
    [bool]$DeletionProtection
  )

  return [pscustomobject]@{
    DBInstanceIdentifier = $Identifier
    DBInstanceArn = "arn:aws:rds:us-east-2:123456789012:db:$Identifier"
    DbiResourceId = $ResourceId
    DBInstanceStatus = "available"
    Endpoint = [pscustomobject]@{ Address = $Address; Port = 5432 }
    Engine = "postgres"
    EngineVersion = "16.14"
    DBInstanceClass = "db.t4g.micro"
    AvailabilityZone = "us-east-2a"
    AutoMinorVersionUpgrade = $true
    StorageType = "gp3"
    AllocatedStorage = 20
    MaxAllocatedStorage = 100
    Iops = 3000
    StorageThroughput = 125
    PerformanceInsightsEnabled = $false
    KmsKeyId = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000000"
    IAMDatabaseAuthenticationEnabled = $true
    DBName = "ai_job_apply"
    MasterUsername = "platform"
    NetworkType = "IPV4"
    CACertificateIdentifier = "rds-ca-rsa2048-g1"
    DBSubnetGroup = [pscustomobject]@{ DBSubnetGroupName = "staging"; VpcId = "vpc-01234567" }
    VpcSecurityGroups = @([pscustomobject]@{ VpcSecurityGroupId = "sg-0123456789abcdef0" })
    DBParameterGroups = @([pscustomobject]@{
      DBParameterGroupName = "staging-postgres16"; ParameterApplyStatus = "in-sync"
    })
    OptionGroupMemberships = @([pscustomobject]@{
      OptionGroupName = "default:postgres-16"; Status = "in-sync"
    })
    EnabledCloudwatchLogsExports = @("postgresql")
    PubliclyAccessible = $false
    StorageEncrypted = $true
    DeletionProtection = $DeletionProtection
    MultiAZ = $false
    CopyTagsToSnapshot = $true
    BackupRetentionPeriod = 7
    LatestRestorableTime = [DateTime]::UtcNow.AddMinutes(-1)
  }
}

$script:sourceIdentifier = "ai-job-apply-staging"
$script:targetPrefix = "ai-job-apply-staging-restore-"
$script:restoreManifestBoundary = $boundary
$script:contextPath = Join-Path ([IO.Path]::GetTempPath()) `
  "d1-restore-behavior-context-does-not-exist.json"
$sourceDatabase = New-BehaviorDatabase $sourceIdentifier `
  "db-ABCDEFGHIJKLMNOPQRSTUVWX" "source.abc123.us-east-2.rds.amazonaws.com" $true
$targetDatabase = New-BehaviorDatabase "$targetPrefix`20260815120000" `
  "db-ZYXWVUTSRQPONMLKJIHGFEDC" "target.abc123.us-east-2.rds.amazonaws.com" $false
$behaviorRuntime = [pscustomobject]@{
  TaskDefinitionArn = $pending.runtime_task_definition_arn
  Image = $pending.runtime_image
  ClusterArn = $pending.runtime_cluster_arn
  SecurityGroupId = $pending.runtime_security_group_id
  ContainerName = $pending.runtime_container_name
  LogStreamPrefix = $pending.runtime_log_stream_prefix
  SubnetIds = @($pending.runtime_subnet_ids)
}
$script:behaviorCalls = New-Object System.Collections.Generic.List[string]
$script:savedContexts = New-Object System.Collections.Generic.List[object]
$script:capturedRequestJson = ""
$script:failRestoreMutation = $false
$script:verificationMismatch = $false

function Assert-ExecutionAuthorized { $script:behaviorCalls.Add("execute") }
function Get-DisposableTargets { return @() }
function Get-SourceDatabase { return $sourceDatabase }
function Assert-SourceBoundary { param([object]$Source); $script:behaviorCalls.Add("source") }
function Assert-ApplicationBaseline {
  $script:behaviorCalls.Add("application")
  return [pscustomobject]@{ EcsRuntimeIdle = $true; ManagedRuntimeAlarmsOk = 10 }
}
function Assert-TerraformNoDrift { $script:behaviorCalls.Add("drift") }
function Get-MigrationRuntime { return $behaviorRuntime }
function Invoke-DatabaseVerifier {
  $digest = if ($script:verificationMismatch) { ("8" * 64) -join "" } else { ("9" * 64) -join "" }
  return [pscustomobject]@{
    ManifestId = $boundary.ManifestId; ManifestSha256 = $boundary.ManifestSha256
    OwnerCount = $boundary.OwnerCount; RelationCount = $boundary.RelationCount
    MigrationCount = $boundary.MigrationCount; Digest = $digest
    LogEventCount = 1; ForbiddenLogMatches = 0
  }
}
function Assert-CurrentAwsCaller { $script:behaviorCalls.Add("caller") }
function Save-RestoreContext {
  param([object]$Context)
  Assert-D1RestoreContextBoundary $Context $boundary
  $copy = ($Context | ConvertTo-Json -Depth 8) | ConvertFrom-D1RestoreJson
  $script:savedContexts.Add($copy)
  $script:behaviorCalls.Add("save")
}
function Invoke-AwsJson {
  param([string[]]$CommandArguments)
  if (
    $CommandArguments.Count -gt 1 -and
    $CommandArguments[0] -ceq "rds" -and
    $CommandArguments[1] -ceq "restore-db-instance-to-point-in-time"
  ) {
    $jsonIndex = [Array]::IndexOf($CommandArguments, "--cli-input-json")
    $script:capturedRequestJson = [string]$CommandArguments[$jsonIndex + 1]
    $script:behaviorCalls.Add("restore")
    if ($script:failRestoreMutation) { throw "synthetic lost response" }
    return [pscustomobject]@{ DBInstance = [pscustomobject]@{} }
  }
  throw "Unexpected behavioral AWS call"
}
function Get-TargetDatabase {
  param([string]$TargetIdentifier)
  return New-BehaviorDatabase $TargetIdentifier $targetDatabase.DbiResourceId `
    $targetDatabase.Endpoint.Address $false
}
function Wait-TargetBoundary {
  param([object]$Source, [object]$Context)
  return Get-TargetDatabase ([string]$Context.target_identifier)
}
function Start-Sleep {}

$script:failRestoreMutation = $true
$ambiguousMessage = ""
try { $null = Invoke-StartRestore }
catch { $ambiguousMessage = $_.Exception.Message }
if ($ambiguousMessage -cne "synthetic lost response") {
  throw "Start failed before the ambiguous restore response boundary: $ambiguousMessage"
}
if ($savedContexts.Count -ne 1 -or [bool]$savedContexts[0].target_boundary_authenticated) {
  throw "An ambiguous restore response did not retain exactly one pending context."
}
if ($behaviorCalls[$behaviorCalls.Count - 2] -cne "save" -or
    $behaviorCalls[$behaviorCalls.Count - 1] -cne "restore") {
  throw "The pending context was not the final durable action before restore mutation."
}
$sentSha = Get-D1RestoreStringSha256 $capturedRequestJson
if ([string]$savedContexts[0].restore_request_sha256 -cne $sentSha) {
  throw "The sent restore request does not match the durable request digest."
}
$sentRequest = $capturedRequestJson | ConvertFrom-D1RestoreJson
if (
  [string]$sentRequest.SourceDbiResourceId -cne [string]$sourceDatabase.DbiResourceId -or
  [int]$sentRequest.MaxAllocatedStorage -ne 100 -or
  [int]$sentRequest.Iops -ne 3000 -or
  [int]$sentRequest.StorageThroughput -ne 125 -or
  $sentRequest.PSObject.Properties.Name -contains "SourceDBInstanceIdentifier"
) {
  throw "The immutable restore request projection is incomplete."
}

$script:behaviorCalls.Clear()
$script:savedContexts.Clear()
$script:capturedRequestJson = ""
$script:failRestoreMutation = $false
$started = Invoke-StartRestore
if (
  $savedContexts.Count -ne 2 -or
  [bool]$savedContexts[0].target_boundary_authenticated -or
  -not [bool]$savedContexts[1].target_boundary_authenticated -or
  [string]$savedContexts[1].target_dbi_resource_id -cne [string]$targetDatabase.DbiResourceId -or
  [string]$started.SourceManifestSha256 -cne [string]$boundary.ManifestSha256
) {
  throw "The successful Start transition did not authenticate and persist the exact target."
}

$cleanupDefinitions = @($operatorAst.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    @("Assert-TargetBoundary", "Invoke-VerifyRestore", "Invoke-CleanupRestore") -contains $node.Name
}, $true))
if ($cleanupDefinitions.Count -ne 3) {
  throw "The verify/cleanup behavioral function boundary could not be loaded."
}
foreach ($definition in $cleanupDefinitions) {
  Invoke-Expression $definition.Extent.Text
}

$script:cleanupContext = $savedContexts[1]
$script:cleanupMode = "exact"
$script:targetReads = 0
$script:deleteCalls = 0
$script:sourceReads = 0
$script:AllowUnverifiedCleanup = $false
$script:terraformDataDirectory = Join-Path ([IO.Path]::GetTempPath()) `
  ("d1-restore-cleanup-behavior-{0}" -f [guid]::NewGuid().ToString("N"))
$script:contextPath = Join-Path $terraformDataDirectory "context.json"

function Get-RestoreContext { return $script:cleanupContext }
function Get-ResourceTags {
  if ($script:cleanupMode -ceq "wrong-case-tag") {
    return @{
      Project = "ai-job-apply"; Environment = "staging"; ManagedBy = "RESTORE-DRILL"
      Purpose = "d1-current-isolated-restore"; StartedAt = $script:cleanupContext.started_at
    }
  }
  return @{
    Project = "ai-job-apply"; Environment = "staging"; ManagedBy = "restore-drill"
    Purpose = "d1-current-isolated-restore"; StartedAt = $script:cleanupContext.started_at
  }
}
function Get-TargetDatabase {
  param([string]$TargetIdentifier)
  $script:targetReads++
  if ($script:cleanupMode -ceq "absent") { return $null }
  if ($script:deleteCalls -gt 0) { return $null }
  $resourceId = [string]$script:cleanupContext.target_dbi_resource_id
  if (-not $resourceId) { $resourceId = [string]$targetDatabase.DbiResourceId }
  if ($script:cleanupMode -ceq "replacement" -and $script:targetReads -ge 2) {
    $resourceId = "db-REPLACEMENTABCDEFGHIJKL"
  }
  return New-BehaviorDatabase $TargetIdentifier $resourceId `
    "target.abc123.us-east-2.rds.amazonaws.com" $false
}
function Get-SourceDatabase {
  $script:sourceReads++
  if ($script:cleanupMode -ceq "source-replacement" -and $script:deleteCalls -gt 0) {
    return New-BehaviorDatabase $sourceIdentifier "db-REPLACEMENTQRSTUVWXYZ" `
      $sourceDatabase.Endpoint.Address $true
  }
  return $sourceDatabase
}
function Assert-CurrentAwsCaller {
  if ($script:cleanupMode -ceq "wrong-account") {
    throw "Use the exact temporary staging IAM Identity Center account session."
  }
}
function Invoke-AwsJson {
  param([string[]]$CommandArguments)
  if ($CommandArguments[0] -ceq "rds" -and $CommandArguments[1] -ceq "delete-db-instance") {
    $script:deleteCalls++
    return [pscustomobject]@{ DBInstance = [pscustomobject]@{} }
  }
  if ($CommandArguments[0] -ceq "rds" -and $CommandArguments[1] -ceq "describe-db-snapshots") {
    return [pscustomobject]@{ DBSnapshots = @() }
  }
  if ($CommandArguments[0] -ceq "rds" -and
      $CommandArguments[1] -ceq "describe-db-instance-automated-backups") {
    return [pscustomobject]@{ DBInstanceAutomatedBackups = @() }
  }
  throw "Unexpected cleanup behavioral AWS call"
}

function Reset-CleanupBehavior {
  param(
    [string]$Mode,
    [bool]$Verified = $true,
    [int]$ContextIndex = 1
  )
  $script:cleanupContext = ($savedContexts[$ContextIndex] | ConvertTo-Json -Depth 8) |
    ConvertFrom-D1RestoreJson
  if ($Verified) {
    $script:cleanupContext.target_manifest_id = $script:cleanupContext.source_manifest_id
    $script:cleanupContext.target_manifest_sha256 = $script:cleanupContext.source_manifest_sha256
    $script:cleanupContext.target_owner_count = $script:cleanupContext.source_owner_count
    $script:cleanupContext.target_relation_count = $script:cleanupContext.source_relation_count
    $script:cleanupContext.target_migration_count = $script:cleanupContext.source_migration_count
    $script:cleanupContext.target_digest = $script:cleanupContext.source_digest
    $script:cleanupContext.verified = $true
  }
  $script:cleanupMode = $Mode
  $script:targetReads = 0
  $script:deleteCalls = 0
  $script:sourceReads = 0
  if (Test-Path -LiteralPath $terraformDataDirectory) {
    Remove-Item -LiteralPath $terraformDataDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Path $terraformDataDirectory | Out-Null
  Set-Content -LiteralPath $contextPath -Value "synthetic durable context" -Encoding UTF8
  Set-Content -LiteralPath "$contextPath.previous" -Value "synthetic recovery context" -Encoding UTF8
}

Reset-CleanupBehavior "exact" $false
$verifySavedCount = $savedContexts.Count
$verifyResult = Invoke-VerifyRestore
$verifiedContext = $savedContexts[$savedContexts.Count - 1]
if (
  $savedContexts.Count -ne ($verifySavedCount + 2) -or
  -not [bool]$verifiedContext.verified -or
  [string]$verifiedContext.target_manifest_sha256 -cne
    [string]$verifiedContext.source_manifest_sha256 -or
  [string]$verifiedContext.target_digest -cne [string]$verifiedContext.source_digest -or
  -not [bool]$verifyResult.AggregateDigestMatch
) {
  throw "The exact Verify transition did not durably bind matching target evidence."
}

Reset-CleanupBehavior "exact" $false
$verifyMismatchSavedCount = $savedContexts.Count
$script:verificationMismatch = $true
Assert-Throws { Invoke-VerifyRestore } "target aggregate mismatch"
$script:verificationMismatch = $false
if (
  $savedContexts.Count -ne ($verifyMismatchSavedCount + 1) -or
  [bool]$savedContexts[$savedContexts.Count - 1].verified
) {
  throw "A mismatched target aggregate was persisted as verified."
}

foreach ($mode in @("replacement", "wrong-case-tag", "wrong-account")) {
  Reset-CleanupBehavior $mode
  Assert-Throws { Invoke-CleanupRestore } "$mode cleanup boundary"
  if ($deleteCalls -ne 0 -or -not (Test-Path -LiteralPath $contextPath)) {
    throw "The $mode cleanup refusal reached delete or removed durable context."
  }
}

Reset-CleanupBehavior "source-replacement"
$sourceReplacementMessage = ""
try { $null = Invoke-CleanupRestore }
catch { $sourceReplacementMessage = $_.Exception.Message }
if (-not $sourceReplacementMessage) { throw "Post-delete source replacement did not fail closed." }
if ($deleteCalls -ne 1 -or -not (Test-Path -LiteralPath $contextPath)) {
  throw "A post-delete source replacement did not retain context (delete=$deleteCalls error=$sourceReplacementMessage)."
}

Reset-CleanupBehavior "exact"
$cleanupResult = Invoke-CleanupRestore
if (
  $deleteCalls -ne 1 -or
  -not [bool]$cleanupResult.TargetDeleted -or
  -not [bool]$cleanupResult.EcsRuntimeIdle -or
  [int]$cleanupResult.ManagedRuntimeAlarmsOk -ne 10 -or
  (Test-Path -LiteralPath $contextPath) -or
  (Test-Path -LiteralPath "$contextPath.previous")
) {
  throw "The exact cleanup transition did not delete once and remove both contexts."
}

$script:AllowUnverifiedCleanup = $true
Reset-CleanupBehavior "exact" $false
$emergencyCleanupResult = Invoke-CleanupRestore
if ($deleteCalls -ne 1 -or -not [bool]$emergencyCleanupResult.TargetDeleted) {
  throw "The explicit authenticated unverified cleanup transition did not delete exactly once."
}

$savedCountBeforePendingCleanup = $savedContexts.Count
Reset-CleanupBehavior "exact" $false 0
$pendingCleanupResult = Invoke-CleanupRestore
$pendingAuthenticatedContext = $savedContexts[$savedCountBeforePendingCleanup]
if (
  $deleteCalls -ne 1 -or
  -not [bool]$pendingCleanupResult.TargetDeleted -or
  -not [bool]$pendingAuthenticatedContext.target_boundary_authenticated -or
  [string]$pendingAuthenticatedContext.target_dbi_resource_id -cne
    [string]$targetDatabase.DbiResourceId -or
  -not [string]$pendingAuthenticatedContext.target_resource_arn -or
  -not [string]$pendingAuthenticatedContext.target_boundary_sha256
) {
  throw "The interrupted Start cleanup did not authenticate the live target before deletion."
}

Reset-CleanupBehavior "absent" $true
$absentCleanupResult = Invoke-CleanupRestore
if (
  $deleteCalls -ne 0 -or
  -not [bool]$absentCleanupResult.TargetDeleted -or
  (Test-Path -LiteralPath $contextPath) -or
  (Test-Path -LiteralPath "$contextPath.previous")
) {
  throw "The authenticated already-absent cleanup retry did not complete idempotently."
}
$script:AllowUnverifiedCleanup = $false
if (Test-Path -LiteralPath $terraformDataDirectory) {
  Remove-Item -LiteralPath $terraformDataDirectory -Recurse -Force
}

$helpOutput = & pwsh -NoProfile -File $operatorPath -Help 2>&1
if ($LASTEXITCODE -ne 0 -or ($helpOutput -join "`n") -notmatch "Status is read-only") {
  throw "The staging restore operator help path failed."
}

Write-Host "Staging PostgreSQL restore verifier guard tests passed."
