Set-StrictMode -Version Latest

function ConvertFrom-D1RestoreJson {
  param(
    [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
    [string]$Json
  )

  if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey("DateKind")) {
    return $Json | ConvertFrom-Json -DateKind String
  }
  return $Json | ConvertFrom-Json
}

function Get-D1RestoreFileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead([IO.Path]::GetFullPath($Path))
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Assert-D1RestoreExactObjectKeys {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Value,
    [Parameter(Mandatory = $true)]
    [string[]]$Expected,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  if ($null -eq $Value -or $null -eq $Value.PSObject) {
    throw "$Label is not an object."
  }
  $actualKeys = @($Value.PSObject.Properties.Name | Sort-Object)
  $expectedKeys = @($Expected | Sort-Object)
  if (($actualKeys -join "`n") -cne ($expectedKeys -join "`n")) {
    throw "$Label has an unexpected field boundary."
  }
}

function Test-D1RestoreBoundedInteger {
  param([object]$Value)

  return (
    ($Value -is [int] -or $Value -is [long]) -and
    [long]$Value -ge 0 -and
    [long]$Value -le [int]::MaxValue
  )
}

function Assert-D1RestoreAwsCallerBoundary {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Identity,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedAccountId
  )

  if (
    $ExpectedAccountId -cnotmatch "^[0-9]{12}$" -or
    [string]$Identity.Account -cne $ExpectedAccountId -or
    [string]$Identity.Arn -cnotmatch `
      "^arn:aws:sts::$ExpectedAccountId`:assumed-role/[A-Za-z0-9+=,.@_-]+/[A-Za-z0-9+=,.@_-]+$"
  ) {
    throw "Use the exact temporary environment IAM Identity Center account session."
  }
}

function New-D1RestoreTaskOverride {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("source", "target")]
    [string]$Mode,
    [Parameter(Mandatory = $true)]
    [string]$DatabaseHost
  )

  if (
    $DatabaseHost.Length -gt 253 -or
    $DatabaseHost -cnotmatch `
      "^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.rds\.amazonaws\.com$"
  ) {
    throw "The $Mode verifier database host is not an exact RDS endpoint."
  }
  return [pscustomobject][ordered]@{
    name = "database-migration"
    command = @("runner/dist/src/restore-verifier-cli.js")
    environment = @(
      [ordered]@{ name = "RESTORE_HOST"; value = $DatabaseHost }
    )
  }
}

function Test-D1RestoreLogStreamMismatch {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Container,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedLogStreamName
  )

  $reportedProperty = $Container.PSObject.Properties["logStreamName"]
  return (
    $null -ne $reportedProperty -and
    [string]$reportedProperty.Value -cne $ExpectedLogStreamName
  )
}

function Get-D1RestoreTagMismatchNames {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Actual,
    [Parameter(Mandatory = $true)]
    [hashtable]$Expected
  )

  return @(
    $Expected.Keys | Where-Object {
      -not $Actual.ContainsKey([string]$_) -or
      [string]$Actual[[string]$_] -cne [string]$Expected[[string]$_]
    } | Sort-Object
  )
}

function Assert-D1RestoreRuntimeContext {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Runtime,
    [Parameter(Mandatory = $true)]
    [object]$Context
  )

  if (
    [string]$Runtime.TaskDefinitionArn -cne [string]$Context.runtime_task_definition_arn -or
    [string]$Runtime.Image -cne [string]$Context.runtime_image -or
    [string]$Runtime.ClusterArn -cne [string]$Context.runtime_cluster_arn -or
    [string]$Runtime.SecurityGroupId -cne [string]$Context.runtime_security_group_id -or
    [string]$Runtime.ContainerName -cne [string]$Context.runtime_container_name -or
    [string]$Runtime.LogStreamPrefix -cne [string]$Context.runtime_log_stream_prefix -or
    (@($Runtime.SubnetIds) -join "`n") -cne (@($Context.runtime_subnet_ids) -join "`n")
  ) {
    throw "The immutable restore verifier runtime changed after the source baseline."
  }
}

function Get-D1RestoreCleanupDisposition {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Context,
    [Parameter(Mandatory = $true)]
    [bool]$TargetPresent
  )

  if ($TargetPresent) {
    return "authenticate-and-delete"
  }
  if ([bool]$Context.target_boundary_authenticated) {
    return "continue-absent"
  }
  throw "The absent restore target was never authenticated for cleanup."
}

function Get-D1RestoreManifestBoundary {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot
  )

  $root = [IO.Path]::GetFullPath($RepositoryRoot)
  $expectedManifestId = "d3-application-lifecycle-profile-jobs-documents-matching-billing-trust-applications-v1"
  $expectedOwners = @("applications", "billing", "documents", "jobs", "matching", "profile", "trust")
  $expectedSchemas = @(
    "applications", "applications_restricted", "billing", "documents", "identity", "jobs", "jobs_public",
    "matching", "platform", "privacy", "profile", "trust"
  )
  $path = [IO.Path]::GetFullPath((Join-Path $root `
    "backend/services/database-migrations/restore-manifest.v1.json"))
  $rootPrefix = $root.TrimEnd([char[]]@("\", "/")) + [IO.Path]::DirectorySeparatorChar
  if (
    -not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $path -PathType Leaf)
  ) {
    throw "The versioned restore manifest is unavailable."
  }
  $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-D1RestoreJson
  Assert-D1RestoreExactObjectKeys $manifest @("schemaVersion", "manifestId", "contributors") `
    "Restore manifest"
  if (
    -not (Test-D1RestoreBoundedInteger $manifest.schemaVersion) -or
    [long]$manifest.schemaVersion -ne 1 -or
    [string]$manifest.manifestId -cne $expectedManifestId
  ) {
    throw "The restore manifest identity is invalid."
  }
  $contributors = @($manifest.contributors)
  if ($contributors.Count -eq 0) {
    throw "The restore manifest has no contributors."
  }
  $owners = @()
  $schemaNames = @()
  $relationNames = @()
  $migrationIdentities = @()
  $relationCount = 0
  $migrationCount = 0
  foreach ($contributor in $contributors) {
    Assert-D1RestoreExactObjectKeys $contributor `
      @("owner", "schemas", "migrationLedger", "migrations", "relations") `
      "Restore contributor"
    if ([string]$contributor.owner -cnotmatch "^[a-z][a-z0-9_]{0,62}$") {
      throw "The restore contributor owner is invalid."
    }
    $owners += [string]$contributor.owner
    $schemas = @($contributor.schemas)
    $migrations = @($contributor.migrations)
    $relations = @($contributor.relations)
    if ($schemas.Count -eq 0 -or $migrations.Count -eq 0 -or $relations.Count -eq 0) {
      throw "The restore contributor boundary is empty."
    }
    foreach ($schema in $schemas) {
      if ([string]$schema -cnotmatch "^[a-z][a-z0-9_]{0,62}$") {
        throw "The restore schema identity is invalid."
      }
      $schemaNames += [string]$schema
    }
    if (
      [string]$contributor.migrationLedger -cnotmatch `
        "^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$" -or
      @($relations | Where-Object {
        [string]$_ -cnotmatch "^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$"
      }).Count -ne 0
    ) {
      throw "The restore relation identity is invalid."
    }
    $orderedSchemas = [string[]]@($schemas)
    $orderedRelations = [string[]]@($relations)
    [Array]::Sort($orderedSchemas, [StringComparer]::Ordinal)
    [Array]::Sort($orderedRelations, [StringComparer]::Ordinal)
    if (
      (@($schemas | Select-Object -Unique)).Count -ne $schemas.Count -or
      ($schemas -join "`n") -cne ($orderedSchemas -join "`n") -or
      (@($relations | Select-Object -Unique)).Count -ne $relations.Count -or
      ($relations -join "`n") -cne ($orderedRelations -join "`n") -or
      @($relations | Where-Object {
        [string]$_ -ceq [string]$contributor.migrationLedger
      }).Count -ne 1
    ) {
      throw "The restore contributor schema or relation boundary is ambiguous."
    }
    $migrationVersions = @()
    foreach ($migration in $migrations) {
      Assert-D1RestoreExactObjectKeys $migration @("version", "checksum") "Restore migration"
      if (
        [string]$migration.version -cnotmatch "^[0-9]{4}_[a-z0-9_]{1,58}$" -or
        [string]$migration.checksum -cnotmatch "^[a-f0-9]{64}$"
      ) {
        throw "The restore migration identity is invalid."
      }
      $migrationVersions += [string]$migration.version
      $migrationIdentities += "$([string]$contributor.owner)/$([string]$migration.version)"
    }
    if (
      (@($migrationVersions | Select-Object -Unique)).Count -ne $migrationVersions.Count -or
      ($migrationVersions -join "`n") -cne ((@($migrationVersions | Sort-Object)) -join "`n")
    ) {
      throw "The restore contributor migration boundary is ambiguous."
    }
    $relationNames += @($relations | ForEach-Object { [string]$_ })
    $relationCount += $relations.Count
    $migrationCount += $migrations.Count
  }
  $sortedOwners = [string[]]@($owners)
  $sortedSchemas = [string[]]@($schemaNames)
  [Array]::Sort($sortedOwners, [StringComparer]::Ordinal)
  [Array]::Sort($sortedSchemas, [StringComparer]::Ordinal)
  if (
    (@($owners | Select-Object -Unique)).Count -ne $owners.Count -or
    ($owners -join "`n") -cne ($sortedOwners -join "`n") -or
    ($owners -join "`n") -cne ($expectedOwners -join "`n") -or
    (@($schemaNames | Select-Object -Unique)).Count -ne $schemaNames.Count -or
    ($sortedSchemas -join "`n") -cne ($expectedSchemas -join "`n") -or
    (@($relationNames | Select-Object -Unique)).Count -ne $relationNames.Count -or
    (@($migrationIdentities | Select-Object -Unique)).Count -ne $migrationIdentities.Count -or
    $contributors.Count -ne 7 -or
    $schemaNames.Count -ne 12 -or
    $relationCount -ne 92 -or
    $migrationCount -ne 69
  ) {
    throw "The restore manifest does not match the exact Phase 3 contributor boundary."
  }

  return [pscustomobject]@{
    ManifestId    = [string]$manifest.manifestId
    ManifestSha256 = Get-D1RestoreFileSha256 $path
    OwnerCount    = $contributors.Count
    OwnerNames    = @($owners)
    SchemaCount   = $schemaNames.Count
    RelationCount = $relationCount
    MigrationCount = $migrationCount
  }
}

function ConvertFrom-D1RestoreVerifierEvents {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Messages,
    [Parameter(Mandatory = $true)]
    [object]$ExpectedBoundary,
    [Parameter(Mandatory = $true)]
    [string]$Mode
  )

  $results = @()
  foreach ($message in $Messages) {
    try {
      $parsed = [string]$message | ConvertFrom-D1RestoreJson
      if ([string]$parsed.event -ceq "d1_restore_verification") {
        $results += $parsed
      }
    }
    catch {
      continue
    }
  }
  if ($results.Count -ne 1) {
    throw "The $Mode verifier did not emit exactly one aggregate result."
  }
  $result = $results[0]
  Assert-D1RestoreExactObjectKeys $result @(
    "event",
    "schema_version",
    "kind",
    "manifest_id",
    "manifest_sha256",
    "owner_count",
    "relation_count",
    "migration_count",
    "digest"
  ) "$Mode verifier result"
  foreach ($field in @("schema_version", "owner_count", "relation_count", "migration_count")) {
    if (-not (Test-D1RestoreBoundedInteger $result.PSObject.Properties[$field].Value)) {
      throw "The $Mode verifier numeric boundary is invalid."
    }
  }
  if (
    [long]$result.schema_version -ne 1 -or
    [string]$result.event -cne "d1_restore_verification" -or
    [string]$result.kind -cne "read_only_aggregate" -or
    [string]$result.manifest_id -cne [string]$ExpectedBoundary.ManifestId -or
    [string]$result.manifest_sha256 -cne [string]$ExpectedBoundary.ManifestSha256 -or
    [long]$result.owner_count -ne [long]$ExpectedBoundary.OwnerCount -or
    [long]$result.relation_count -ne [long]$ExpectedBoundary.RelationCount -or
    [long]$result.migration_count -ne [long]$ExpectedBoundary.MigrationCount -or
    [string]$result.digest -cnotmatch "^[a-f0-9]{64}$"
  ) {
    throw "The $Mode verifier result does not match the reviewed manifest boundary."
  }
  return [pscustomobject]@{
    ManifestId     = [string]$result.manifest_id
    ManifestSha256 = [string]$result.manifest_sha256
    OwnerCount     = [int]$result.owner_count
    RelationCount  = [int]$result.relation_count
    MigrationCount = [int]$result.migration_count
    Digest          = [string]$result.digest
  }
}

function Assert-D1RestoreContextBoundary {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Context,
    [Parameter(Mandatory = $true)]
    [object]$ExpectedBoundary
  )

  Assert-D1RestoreExactObjectKeys $Context @(
    "source_identifier",
    "target_identifier",
    "started_at",
    "source_manifest_id",
    "source_manifest_sha256",
    "source_owner_count",
    "source_relation_count",
    "source_migration_count",
    "source_digest",
    "source_boundary_sha256",
    "source_dbi_resource_id",
    "source_log_events",
    "source_resource_arn",
    "runtime_cluster_arn",
    "runtime_container_name",
    "runtime_image",
    "runtime_log_stream_prefix",
    "runtime_security_group_id",
    "runtime_subnet_ids",
    "runtime_task_definition_arn",
    "restore_request_sha256",
    "target_digest",
    "target_boundary_authenticated",
    "target_boundary_sha256",
    "target_dbi_resource_id",
    "target_manifest_id",
    "target_manifest_sha256",
    "target_migration_count",
    "target_owner_count",
    "target_relation_count",
    "target_resource_arn",
    "restore_point_lag_seconds",
    "restore_available_seconds",
    "functional_recovery_seconds",
    "verified"
  ) "Restore context"
  $identityChecks = [ordered]@{
    source_manifest_id = [string]$Context.source_manifest_id -ceq [string]$ExpectedBoundary.ManifestId
    source_manifest_sha256 = [string]$Context.source_manifest_sha256 -ceq [string]$ExpectedBoundary.ManifestSha256
    source_owner_count = [int]$Context.source_owner_count -eq [int]$ExpectedBoundary.OwnerCount
    source_relation_count = [int]$Context.source_relation_count -eq [int]$ExpectedBoundary.RelationCount
    source_migration_count = [int]$Context.source_migration_count -eq [int]$ExpectedBoundary.MigrationCount
    source_digest = [string]$Context.source_digest -cmatch "^[a-f0-9]{64}$"
    source_boundary_sha256 = [string]$Context.source_boundary_sha256 -cmatch "^[a-f0-9]{64}$"
    source_dbi_resource_id = [string]$Context.source_dbi_resource_id -cmatch "^db-[A-Z0-9]{8,64}$"
    source_resource_arn = [string]$Context.source_resource_arn -cmatch "^arn:aws:rds:[a-z0-9-]+:[0-9]{12}:db:[a-z0-9-]{1,63}$"
    restore_request_sha256 = [string]$Context.restore_request_sha256 -cmatch "^[a-f0-9]{64}$"
    started_at = [string]$Context.started_at -cmatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
    source_identifier = [string]$Context.source_identifier -cmatch "^[a-z0-9-]{1,63}$"
    target_identifier = [string]$Context.target_identifier -cmatch "^[a-z0-9-]{1,63}$"
    runtime_task_definition_arn = [string]$Context.runtime_task_definition_arn -cmatch "^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$"
    runtime_image = [string]$Context.runtime_image -cmatch "^[^@\s]+@sha256:[a-f0-9]{64}$"
    runtime_cluster_arn = [string]$Context.runtime_cluster_arn -cmatch "^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:cluster/[A-Za-z0-9_-]+$"
    runtime_security_group_id = [string]$Context.runtime_security_group_id -cmatch "^sg-[a-f0-9]+$"
    runtime_container_name = [string]$Context.runtime_container_name -ceq "database-migration"
    runtime_log_stream_prefix = [string]$Context.runtime_log_stream_prefix -cmatch "^[A-Za-z0-9._/-]{1,512}$"
    verified = $Context.verified -is [bool]
    target_boundary_authenticated = $Context.target_boundary_authenticated -is [bool]
  }
  foreach ($check in $identityChecks.GetEnumerator()) {
    if (-not [bool]$check.Value) {
      throw "The restore context $($check.Key) boundary is invalid."
    }
  }
  $sourceArnParts = @([string]$Context.source_resource_arn -split ":")
  $runtimeArnParts = @([string]$Context.runtime_task_definition_arn -split ":")
  if (
    $sourceArnParts.Count -ne 7 -or
    $runtimeArnParts.Count -ne 7 -or
    $sourceArnParts[3] -cne $runtimeArnParts[3] -or
    $sourceArnParts[4] -cne $runtimeArnParts[4] -or
    $sourceArnParts[5] -cne "db" -or
    $sourceArnParts[6] -cne [string]$Context.source_identifier
  ) {
    throw "The restore source account, region, or identifier binding is invalid."
  }
  $parsedStartedAt = [DateTime]::MinValue
  if (-not [DateTime]::TryParseExact(
    [string]$Context.started_at,
    "yyyy-MM-ddTHH:mm:ssZ",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal -bor
      [Globalization.DateTimeStyles]::AdjustToUniversal,
    [ref]$parsedStartedAt
  )) {
    throw "The restore context start instant is invalid."
  }
  foreach ($field in @(
    "source_owner_count",
    "source_relation_count",
    "source_migration_count",
    "source_log_events",
    "restore_point_lag_seconds",
    "restore_available_seconds",
    "functional_recovery_seconds"
  )) {
    $number = $Context.PSObject.Properties[$field].Value
    if (-not (Test-D1RestoreBoundedInteger $number)) {
      throw "The restore context numeric boundary is invalid."
    }
  }
  $subnetIds = @($Context.runtime_subnet_ids)
  if (
    $subnetIds.Count -ne 2 -or
    @($subnetIds | Where-Object { [string]$_ -cnotmatch "^subnet-[a-f0-9]+$" }).Count -ne 0 -or
    ($subnetIds -join "`n") -cne ((@($subnetIds | Sort-Object)) -join "`n") -or
    (@($subnetIds | Select-Object -Unique)).Count -ne 2
  ) {
    throw "The restore context network boundary is invalid."
  }
  if ([bool]$Context.verified) {
    if (-not [bool]$Context.target_boundary_authenticated) {
      throw "A verified restore context lacks an authenticated target boundary."
    }
    foreach ($field in @("target_owner_count", "target_relation_count", "target_migration_count")) {
      if (-not (Test-D1RestoreBoundedInteger $Context.PSObject.Properties[$field].Value)) {
        throw "The verified restore target numeric boundary is invalid."
      }
    }
    if (
      [string]$Context.target_manifest_id -cne [string]$Context.source_manifest_id -or
      [string]$Context.target_manifest_sha256 -cne [string]$Context.source_manifest_sha256 -or
      [long]$Context.target_owner_count -ne [long]$Context.source_owner_count -or
      [long]$Context.target_relation_count -ne [long]$Context.source_relation_count -or
      [long]$Context.target_migration_count -ne [long]$Context.source_migration_count -or
      [string]$Context.target_digest -cne [string]$Context.source_digest
    ) {
      throw "The verified restore target does not match the source aggregate boundary."
    }
  }
  elseif (
    $null -ne $Context.target_manifest_id -or
    $null -ne $Context.target_manifest_sha256 -or
    $null -ne $Context.target_owner_count -or
    $null -ne $Context.target_relation_count -or
    $null -ne $Context.target_migration_count -or
    $null -ne $Context.target_digest
  ) {
    throw "An unverified restore context contains target evidence."
  }
  if ([bool]$Context.target_boundary_authenticated) {
    $targetArnParts = @([string]$Context.target_resource_arn -split ":")
    if (
      [string]$Context.target_resource_arn -cnotmatch `
        "^arn:aws:rds:[a-z0-9-]+:[0-9]{12}:db:[a-z0-9-]{1,63}$" -or
      [string]$Context.target_dbi_resource_id -cnotmatch "^db-[A-Z0-9]{8,64}$" -or
      [string]$Context.target_boundary_sha256 -cnotmatch "^[a-f0-9]{64}$" -or
      $targetArnParts.Count -ne 7 -or
      $targetArnParts[3] -cne $sourceArnParts[3] -or
      $targetArnParts[4] -cne $sourceArnParts[4] -or
      $targetArnParts[5] -cne "db" -or
      $targetArnParts[6] -cne [string]$Context.target_identifier
    ) {
      throw "The authenticated restore target identity is invalid."
    }
  }
  elseif (
    $null -ne $Context.target_resource_arn -or
    $null -ne $Context.target_dbi_resource_id -or
    $null -ne $Context.target_boundary_sha256
  ) {
    throw "An unauthenticated restore context contains a target resource identity."
  }
}

function Save-D1RestoreContextFile {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Context,
    [Parameter(Mandatory = $true)]
    [string]$ContextPath,
    [Parameter(Mandatory = $true)]
    [object]$ExpectedBoundary
  )

  Assert-D1RestoreContextBoundary $Context $ExpectedBoundary
  $fullPath = [IO.Path]::GetFullPath($ContextPath)
  $directory = [IO.Path]::GetDirectoryName($fullPath)
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    throw "The restore context directory is unavailable."
  }
  $temporaryPath = Join-Path $directory `
    (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($fullPath), [guid]::NewGuid().ToString("N"))
  $backupPath = "$fullPath.previous"
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(
      ($Context | ConvertTo-Json -Depth 8)
    )
    $stream = [IO.File]::Open(
      $temporaryPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    }
    finally {
      $stream.Dispose()
    }
    $roundTrip = Get-Content -LiteralPath $temporaryPath -Raw | ConvertFrom-D1RestoreJson
    Assert-D1RestoreContextBoundary $roundTrip $ExpectedBoundary
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      [IO.File]::Replace($temporaryPath, $fullPath, $backupPath, $true)
    }
    else {
      [IO.File]::Move($temporaryPath, $fullPath)
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Read-D1RestoreContextFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ContextPath,
    [Parameter(Mandatory = $true)]
    [object]$ExpectedBoundary
  )

  $candidates = @([IO.Path]::GetFullPath($ContextPath), "$([IO.Path]::GetFullPath($ContextPath)).previous")
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      continue
    }
    try {
      $context = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-D1RestoreJson
      Assert-D1RestoreContextBoundary $context $ExpectedBoundary
      return $context
    }
    catch {
      continue
    }
  }
  throw "No valid environment restore context or recovery copy is available."
}
