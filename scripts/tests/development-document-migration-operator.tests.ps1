$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-gateway-release-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-current-document-baseline.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-migration.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$tokens,
  [ref]$errors
)
if (@($errors).Count -ne 0) { throw "The development migration operator did not parse." }
if ($source -notmatch 'if \(Test-Path -LiteralPath \$driftPlan -PathType Leaf\)\s*\{\s*\$planOwnedByInvocation = \$true' -or
    $source -match 'if \(\$driftExit -eq 0 -and \(Test-Path -LiteralPath \$driftPlan') {
  throw "Unexpected Terraform exit plans are not marked owned before exit validation and cleanup."
}
if ($source -notmatch 'Assert-RetainedMigrationBaselinePlan -Plan \$driftJson') {
  throw "Post-migration Verify does not route its retained plan through the shared provider-drift guard."
}
if ($source -notmatch 'ConvertTo-DeploymentCanonicalValue -Value \$beforeContainer' -or
    $source -notmatch 'ConvertTo-DeploymentCanonicalValue -Value \$afterContainer' -or
    $source -match 'ConvertTo-DeploymentCanonicalValue -Value \$(?:before|after)Container[^\r\n]*-SortArrays') {
  throw "The migration container comparison must canonicalize object keys without sorting arrays."
}
if ($source -notmatch '\[string\]\$ReviewedBaselineToCurrentDeltaSha256 = ""' -or
    @([regex]::Matches($source, '-ReviewedBaselineToCurrentDeltaSha256 \$ReviewedBaselineToCurrentDeltaSha256')).Count -ne 2 -or
    @([regex]::Matches($source, 'Assert-CleanCurrentMainHead -ExpectedSha \$operatorSourceSha')).Count -ne 3 -or
    $source -notmatch '\[string\]\$ReviewedTaskPlanMetadataSha256 = ""' -or
    $source -notmatch 'PlanMetadataSha256\s+= \$taskMetadataSha256' -or
    $source -notmatch 'diff --name-status --find-renames --find-copies-harder' -or
    $source -notmatch 'A detected copy destination is not one canonical added path' -or
    $source -notmatch 'A detected copy source is not one retained regular blob' -or
    $source -notmatch 'deploy_public_job_reader\s+= \$false' -or
    $source -notmatch 'public_job_cluster_residual_accepted\s+= \$false' -or
    $source -notmatch 'public_job_database_boundary_version\s+= ""' -or
    $source -notmatch 'public_job_route_throttling_rate_limit\s+= 1' -or
    $source -notmatch 'public_job_route_throttling_burst_limit\s+= 1' -or
    $source -notmatch '(?s)terraform "-chdir=\$terraformDirectory" apply.+?if \(\$LASTEXITCODE -ne 0\).+?Assert-CleanCurrentMainHead -ExpectedSha \$operatorSourceSha' -or
    $source -notmatch 'Assert-CleanCurrentMainHead -ExpectedSha \$head\s+if \(\$Action -in @\("PlanTask", "ApplyTask"\)\) \{ Assert-NoUntrackedTerraformInputs \}' -or
    $source -notmatch '(?s)\$operatorSourceSha = Assert-CallerToolsAndSource.+?Initialize-EncryptedBackend' -or
    $source -notmatch 'appliedBaselineCurrentOperatorSourceSha = \[string\]\$baselineEvidence\.CurrentOperatorSourceSha' -or
    $source -notmatch 'appliedBaselineToCurrentDeltaSha256 = \[string\]\$baselineEvidence\.BaselineToCurrentDeltaSha256') {
  throw "PlanTask and ApplyTask do not preserve the reviewed baseline-to-current handoff and recheck current HEAD."
}

$currentSuccessMarkers = @(
  "Database migrations through 0011_active_candidate_lease applied and verified.",
  "Jobs migrations through 0027_candidate_report_export_status applied and verified.",
  "Documents migrations through 0014_native_resume_generations applied and verified.",
  "Matching migrations through 0003_private_saved_page_captures applied and verified.",
  "Billing migrations through 0002_candidate_rights applied and verified.",
  "Trust migrations through 0005_development_test_removal applied and verified.",
  "Applications migrations through 0010_native_resume_requests applied and verified.",
  "All service-owned database migrations applied and verified."
)
if (@([regex]::Matches($source, 'AggregateSuccessLogCount\s+= \$stoppedTask.AggregateSuccessLogCount')).Count -ne 3 -or
    $source -match 'AggregateSuccessLogCount\s+= [0-9]' -or
    $source -notmatch 'Get-MigrationAggregateSuccessMessages -ReleaseSourceSha \$SourceSha') {
  throw "Execute, Recover, and Verify must report the actual exact-release validated event count."
}
$logFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @("Read-MigrationReleaseSource", "Get-MigrationAggregateSuccessMessages",
        "Assert-TaskResultAndLogs", "Test-NoEffectiveOverrides", "Resolve-TaskLogStreamName", "Get-OptionalProperty")
    }, $true))
if ($logFunctions.Count -ne 6) { throw "Exact migration log guards must each be defined once." }
foreach ($function in $logFunctions) { Invoke-Expression $function.Extent.Text }
$logReleaseSha = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not resolve the current migration-source test commit." }
$actualMessages = @(Get-MigrationAggregateSuccessMessages -ReleaseSourceSha $logReleaseSha)
if (($actualMessages -join "`n") -cne ($currentSuccessMarkers -join "`n")) {
  throw "The source-bound current migration contract does not match the exact eight expected events."
}
$logSourceFiles = @{}
foreach ($path in @("backend/services/database-migrations/src/index.ts", "backend/services/database-migrations/src/main.ts") +
    @("profile", "jobs", "documents", "matching", "billing", "trust", "applications" | ForEach-Object { "backend/services/$_/src/migrate.ts" })) {
  $logSourceFiles[$path] = Read-MigrationReleaseSource -ReleaseSourceSha $logReleaseSha -Path $path
}
$historicalLogFiles = @{} + $logSourceFiles
$historicalLogFiles["backend/services/database-migrations/src/index.ts"] =
  $historicalLogFiles["backend/services/database-migrations/src/index.ts"].Replace(
    '  { owner: "trust", executable: "trust/dist/src/migrate.js" },' + "`n", "").Replace(
    '  { owner: "applications", executable: "applications/dist/src/migrate.js" },' + "`n", "")
foreach ($ownerAndMaximum in @(@("profile", 7), @("jobs", 13), @("documents", 5), @("matching", 2))) {
  $path = "backend/services/$($ownerAndMaximum[0])/src/migrate.ts"
  $versionBlock = [regex]::Match($historicalLogFiles[$path], '(?s)const migrationVersions = \[(.*?)\] as const;')
  $versions = @([regex]::Matches($versionBlock.Groups[1].Value, '"([0-9]{4}_[a-z][a-z0-9_]{0,99})",') |
    Select-Object -First $ownerAndMaximum[1] | ForEach-Object { '  "' + $_.Groups[1].Value + '",' })
  $historicalLogFiles[$path] = $historicalLogFiles[$path].Replace($versionBlock.Value,
    "const migrationVersions = [`n" + ($versions -join "`n") + "`n] as const;")
}
$historicalSuccessMarkers = @(
  "Database migrations through 0007_candidate_rights_export_null_omission applied and verified.",
  "Jobs migrations through 0013_public_job_sitemap applied and verified.",
  "Documents migrations through 0005_resume_purge applied and verified.",
  "Matching migrations through 0002_candidate_rights applied and verified.",
  "Billing migrations through 0002_candidate_rights applied and verified.",
  "All service-owned database migrations applied and verified."
)
$script:logFixtureFiles = $logSourceFiles
$script:logGitFailure = $false
function git {
  $arguments = @($args)
  $global:LASTEXITCODE = 1
  if ($arguments.Count -ne 4 -or $arguments[2] -cne "show" -or
      -not $arguments[3].StartsWith("$logReleaseSha`:", [StringComparison]::Ordinal)) {
    throw "The log contract did not read the immutable migration release source."
  }
  $path = $arguments[3].Substring(41)
  if ($script:logGitFailure -or -not $script:logFixtureFiles.ContainsKey($path)) { return }
  $global:LASTEXITCODE = 0
  return $script:logFixtureFiles[$path] -split "`n"
}
try {
  $script:logFixtureFiles = $historicalLogFiles
  $historicalMessages = @(Get-MigrationAggregateSuccessMessages -ReleaseSourceSha $logReleaseSha)
  if (($historicalMessages -join "`n") -cne ($historicalSuccessMarkers -join "`n")) {
    throw "Historical applied-source recovery lost its exact six-event contract."
  }
  foreach ($invalidSource in @("missing", "git-error", "unknown-owner", "owner-order", "dynamic-version", "version-gap", "extra-log", "unknown-main")) {
    $script:logFixtureFiles = @{} + $logSourceFiles
    $script:logGitFailure = $false
    switch ($invalidSource) {
      "missing" { $script:logFixtureFiles.Remove("backend/services/trust/src/migrate.ts") }
      "git-error" { $script:logGitFailure = $true }
      "unknown-owner" { $script:logFixtureFiles["backend/services/database-migrations/src/index.ts"] = $logSourceFiles["backend/services/database-migrations/src/index.ts"].Replace('owner: "trust"', 'owner: "unknown"') }
      "owner-order" { $script:logFixtureFiles["backend/services/database-migrations/src/index.ts"] = $historicalLogFiles["backend/services/database-migrations/src/index.ts"].Replace('  { owner: "profile"', '  { owner: "trust", executable: "trust/dist/src/migrate.js" },' + "`n" + '  { owner: "profile"') }
      "dynamic-version" { $script:logFixtureFiles["backend/services/trust/src/migrate.ts"] = $logSourceFiles["backend/services/trust/src/migrate.ts"].Replace('"0003_decision_signals",', 'process.env.LATEST_VERSION,') }
      "version-gap" { $script:logFixtureFiles["backend/services/trust/src/migrate.ts"] = $logSourceFiles["backend/services/trust/src/migrate.ts"].Replace('0003_decision_signals', '0004_decision_signals') }
      "extra-log" { $script:logFixtureFiles["backend/services/trust/src/migrate.ts"] += '`nconsole.log("unexpected");' }
      "unknown-main" { $script:logFixtureFiles["backend/services/database-migrations/src/main.ts"] += '`nconsole.log("unexpected");' }
    }
    $rejected = $false
    try { $null = Get-MigrationAggregateSuccessMessages -ReleaseSourceSha $logReleaseSha } catch { $rejected = $true }
    if (-not $rejected) { throw "The migration contract accepted invalid source: $invalidSource." }
  }
  $script:logGitFailure = $false
  $SourceSha = $logReleaseSha
  $operatorSourceSha = "b" * 40
  $MigrationImage = "synthetic.invalid/migration@sha256:$('a' * 64)"
  $script:logTask = [pscustomobject]@{
    taskArn = "arn:aws:ecs:us-east-2:000000000000:task/synthetic/$('a' * 32)"
    taskDefinitionArn = "synthetic-definition"; launchType = "FARGATE"; lastStatus = "STOPPED"; overrides = $null
    stoppedAt = [datetime]"2026-09-05T00:00:00Z"
    containers = @([pscustomobject]@{ name = "database-migration"; exitCode = 0; image = $MigrationImage; imageDigest = "sha256:$('a' * 64)" })
  }
  function Assert-TaskDefinition {
    [pscustomobject]@{ containerDefinitions = @([pscustomobject]@{
        name = "database-migration"; logConfiguration = [pscustomobject]@{
          options = [pscustomobject]@{ 'awslogs-group' = "synthetic"; 'awslogs-stream-prefix' = "ecs" }
        }
      }) }
  }
  function Invoke-AwsJson {
    param($Arguments, $Operation)
    if ($Arguments[0] -ceq "ecs") { return [pscustomobject]@{ failures = @(); tasks = @($script:logTask) } }
    if ($Arguments[0] -cne "logs") { throw "Unexpected mock AWS operation." }
    $script:logReadCount++
    $items = if ($script:logMode -ceq "eventual" -and $script:logReadCount -eq 1) { @($script:logMessages[0]) } else { $script:logMessages }
    return [pscustomobject]@{ events = @($items | ForEach-Object { [pscustomobject]@{ message = $_ } }) }
  }
  function Start-Sleep { param($Seconds) }
  foreach ($logMode in @("current", "historical", "eventual", "missing", "duplicate", "reordered", "extra", "wrong-release")) {
    $script:logFixtureFiles = if ($logMode -ceq "historical") { $historicalLogFiles } else { $logSourceFiles }
    $script:logMessages = if ($logMode -ceq "historical") { $historicalSuccessMarkers } else { $currentSuccessMarkers }
    $script:logMode = $logMode; $script:logReadCount = 0
    switch ($logMode) {
      "missing" { $script:logMessages = $currentSuccessMarkers[0..6] }
      "duplicate" { $script:logMessages = @($currentSuccessMarkers[0]) + $currentSuccessMarkers[0..6] }
      "reordered" { $script:logMessages = @($currentSuccessMarkers[1], $currentSuccessMarkers[0]) + $currentSuccessMarkers[2..7] }
      "extra" { $script:logMessages = @($currentSuccessMarkers) + @("unexpected") }
      "wrong-release" { $script:logMessages = $historicalSuccessMarkers }
    }
    $rejected = $false
    try { $result = Assert-TaskResultAndLogs -ClusterArn "synthetic" -TaskArn $script:logTask.taskArn -TaskDefinitionArn "synthetic-definition" } catch { $rejected = $true }
    if ($logMode -in @("current", "historical", "eventual")) {
      $expectedCount = if ($logMode -ceq "historical") { 6 } else { 8 }
      if ($rejected -or $result.AggregateSuccessLogCount -ne $expectedCount -or $result.Task.stoppedAt -ne $script:logTask.stoppedAt) {
        throw "Exact release-bound task logs were not validated: $logMode."
      }
    } elseif (-not $rejected) { throw "Invalid migration log stream was accepted: $logMode." }
    if ($logMode -ceq "missing" -and $script:logReadCount -ne 30) { throw "Missing migration logs did not respect the bounded polling window." }
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  Remove-Item -LiteralPath Function:\Invoke-AwsJson, Function:\Assert-TaskDefinition, Function:\Start-Sleep -Force -ErrorAction SilentlyContinue
}
foreach ($schemaFiveMarker in @(
    'SchemaVersion                    = "5"',
    'DocumentReleaseSourceSha',
    'DocumentOperatorSourceSha',
    'DocumentOperatorDeltaSha256',
    'BaselineToReleaseDeltaSha256',
    'AllowSchemaFiveOneSerialAdvance',
    'Only a CompleteDark schema-5 retained baseline may cross the migration handoff.'
  )) {
  if (-not $source.Contains($schemaFiveMarker)) {
    throw "The post-migration verifier does not preserve the reviewed split-source handoff."
  }
}
foreach ($schemaSixMarker in @(
    'elseif ($schema -ceq "6")',
    'complete-dark-bootstrap-full-source-v1',
    'Get-DocumentBootstrapDeltaSha256',
    'PriorBaselineToOperatorDeltaSha256',
    'CurrentTemplateReceiptSha256'
  )) {
  if (-not $source.Contains($schemaSixMarker)) {
    throw "The migration handoff does not consume the authenticated schema-6 CompleteDark bootstrap baseline."
  }
}

$pathFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Resolve-OperatorPath"
    }, $true))
if ($pathFunctions.Count -ne 1) { throw "Resolve-OperatorPath must be defined exactly once." }
Invoke-Expression $pathFunctions[0].Extent.Text

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-migration"

$relative = Resolve-OperatorPath `
  -Candidate ".terraform\development-document-migration\test.json" `
  -RequireOperatorRoot
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "test.json"))
if ($relative -cne $expected) { throw "The relative operator path did not resolve exactly." }

$absolute = Resolve-OperatorPath -Candidate $expected -RequireOperatorRoot
if ($absolute -cne $expected) { throw "The absolute operator path did not resolve exactly." }

$traversalRejected = $false
try {
  $null = Resolve-OperatorPath -Candidate "..\outside.tfplan"
} catch {
  $traversalRejected = $true
}
if (-not $traversalRejected) { throw "The path resolver accepted a traversal outside .terraform." }

$baselineFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "ConvertTo-TerraformEnvironmentValue", "Get-MeaningfulChanges", "Assert-PlanWasApplied",
        "Assert-ExactIngestionActivationGuardCreate", "Assert-ExactTaskPlan", "Assert-CurrentGatewayArtifactEvidence",
        "Assert-AcceptedMigrationProviderDrift", "Test-IgnorableRdsRestorableTimeRefresh",
        "Test-IgnorableMigrationTaskTagsRefresh", "Get-UnacceptedVerificationDrift", "Get-OptionalProperty",
        "Test-EcsFaultInjectionDisabled", "Assert-ReleaseSourceBinding",
        "Assert-OperatorOnlyReleaseDelta", "Get-DocumentOperatorDeltaSha256", "Get-DocumentBootstrapDeltaSha256",
        "Get-ReviewedBaselineToCurrentDeltaSha256", "Assert-CleanCurrentMainHead",
        "Assert-NoUntrackedTerraformInputs", "Assert-ExecutionIdentity",
        "Assert-DurableClaimPutResult", "Assert-DurableExecutionClaimEvidence",
        "Test-DurableClaimHistoryExists", "Assert-RecoveryOperatorBinding", "Assert-RecoveryOperatorSource",
        "Resolve-TaskLogStreamName",
        "Set-RecoveredReceiptEvidence", "Get-DeclaredVariableNames",
        "Get-CurrentTerraformStateIdentity", "Assert-ExactCurrentBaselineVariableSet",
        "Assert-RetainedMigrationBaselinePlan", "Assert-RetainedBaselineCurrentState",
        "Assert-RetainedBaselinePlanningState", "Test-ExactCompleteDarkStaleStateHandoff",
        "Assert-ExactTerraformStateIdentity",
        "Read-RetainedMigrationBaseline", "Assert-TaskMetadataBaselineBinding", "Read-TaskPlanMetadata",
        "Get-FileSha256", "Get-TextSha256", "Write-JsonFile", "Get-ExactStringPlanVariable",
        "Read-TaskCurrentDocumentBaselineMetadata", "New-PostMigrationBaselineMetadata", "Assert-PostMigrationBaselineMetadata",
        "Save-PostMigrationBaselineMetadata", "Remove-NewPostMigrationBaselineArtifacts"
      )
    }, $true))
if ($baselineFunctions.Count -ne 47) { throw "The input, plan, and retained-handoff guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}
$declaredVariables = @(Get-DeclaredVariableNames)
foreach ($requiredVariable in @("migration_image", "deploy_ingestion_runtime", "ingestion_synthetic_source_enabled")) {
  if (@($declaredVariables | Where-Object { $_ -ceq $requiredVariable }).Count -ne 1) {
    throw "The migration operator does not inventory every root Terraform variable declaration."
  }
}
if (@($declaredVariables | Sort-Object -Unique).Count -ne $declaredVariables.Count) {
  throw "The migration operator accepted a duplicated root Terraform variable declaration."
}

$originalRepositoryRoot = $repositoryRoot
$script:documentDeltaMode = "valid"
$script:documentDeltaCatFileCalls = 0
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") {
    $global:LASTEXITCODE = if ($script:documentDeltaMode -ceq "nonancestor") { 1 } else { 0 }
    return
  }
  if ($arguments -contains "--name-status") {
    $global:LASTEXITCODE = 0
    switch ($script:documentDeltaMode) {
      "valid" { return @(
          "M`tbackend/services/jobs/src/persistence/catalog.ts",
          "M`tbackend/services/jobs/src/persistence/catalog.test.ts"
        ) }
      "unapproved" { return "M`tbackend/services/jobs/src/persistence/unapproved.ts" }
      "add" { return "A`tbackend/services/jobs/src/persistence/catalog.ts" }
      "delete" { return "D`tbackend/services/jobs/src/persistence/catalog.ts" }
      "rename" { return "R100`tbackend/services/jobs/src/persistence/catalog.ts`tbackend/services/jobs/src/persistence/catalog.test.ts" }
      default { return "M`tbackend/services/jobs/src/persistence/catalog.ts" }
    }
  }
  if ($arguments -contains "--numstat") {
    $global:LASTEXITCODE = 0
    if ($script:documentDeltaMode -ceq "binary") {
      return "-`t-`tbackend/services/jobs/src/persistence/catalog.ts"
    }
    return "1`t1`tbackend/services/jobs/src/persistence/catalog.ts"
  }
  if ($arguments -contains "cat-file") {
    $script:documentDeltaCatFileCalls++
    $global:LASTEXITCODE = 0
    if ($script:documentDeltaMode -ceq "gitlink") { return "commit" }
    return "blob"
  }
  if ($arguments -contains "--full-index") {
    $global:LASTEXITCODE = 0
    return "fixture patch $($script:documentDeltaMode)"
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  $releaseSha = "1" * 40
  $currentSha = "2" * 40
  $deltaSha = Get-DocumentOperatorDeltaSha256 -ReleaseSha $releaseSha -OperatorSha $currentSha
  if ($deltaSha -notmatch '^[a-f0-9]{64}$' -or $script:documentDeltaCatFileCalls -ne 4) {
    throw "The exact two-file Jobs timestamp delta was not accepted as modified regular blobs."
  }
  foreach ($mode in @("unapproved", "add", "delete", "rename", "binary", "gitlink", "nonancestor")) {
    $script:documentDeltaMode = $mode
    $rejected = $false
    try { $null = Get-DocumentOperatorDeltaSha256 -ReleaseSha $releaseSha -OperatorSha $currentSha } catch { $rejected = $true }
    if (-not $rejected) { throw "The canonical document delta accepted the '$mode' fixture." }
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  Remove-Variable -Name documentDeltaMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name documentDeltaCatFileCalls -Scope Script -ErrorAction SilentlyContinue
}

$script:fullDeltaMode = "valid"
$script:fullDeltaRecords = @(
  "M`tscripts/operate-development-document-migration.ps1",
  "A`tdocs/product/delivery/evidence/new.md",
  "D`tdocs/product/delivery/evidence/retired.md"
)
$script:fullDeltaPatch = @("fixture full patch", "second line")
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") {
    $global:LASTEXITCODE = if ($script:fullDeltaMode -ceq "nonancestor") { 1 } else { 0 }
    return
  }
  if ($arguments -contains "--name-status") {
    if ($arguments -notcontains "--no-renames" -and $script:fullDeltaMode -ceq "detected-error") {
      $global:LASTEXITCODE = 128
      return
    }
    if ($arguments -contains "--no-renames" -and $script:fullDeltaMode -ceq "records-error") {
      $global:LASTEXITCODE = 128
      return
    }
    $global:LASTEXITCODE = 0
    if ($arguments -notcontains "--no-renames" -and $script:fullDeltaMode -ceq "rename") {
      return "R100`tdocs/product/delivery/evidence/old.md`tdocs/product/delivery/evidence/new.md"
    }
    if ($arguments -notcontains "--no-renames" -and
        $script:fullDeltaMode -in @("copy", "copy-existing-destination", "copy-missing-source")) {
      return "C100`tdocs/product/delivery/evidence/old.md`tdocs/product/delivery/evidence/new.md"
    }
    if ($arguments -notcontains "--no-renames" -and $script:fullDeltaMode -ceq "copy-unbound") {
      return "C100`tdocs/product/delivery/evidence/old.md`tdocs/product/delivery/evidence/unbound.md"
    }
    if ($script:fullDeltaMode -ceq "unsupported") { return "T`tscripts/operate-development-document-migration.ps1" }
    return $script:fullDeltaRecords
  }
  if ($arguments -contains "--numstat") {
    if ($script:fullDeltaMode -ceq "numstat-error") { $global:LASTEXITCODE = 128; return }
    $global:LASTEXITCODE = 0
    if ($script:fullDeltaMode -ceq "binary") { return @("1`t1`tscripts/operate-development-document-migration.ps1", "-`t-`tdocs/product/delivery/evidence/new.md", "1`t0`tdocs/product/delivery/evidence/retired.md") }
    return @("1`t1`tscripts/operate-development-document-migration.ps1", "1`t0`tdocs/product/delivery/evidence/new.md", "0`t1`tdocs/product/delivery/evidence/retired.md")
  }
  if ($arguments -contains "ls-tree") {
    $global:LASTEXITCODE = 0
    $revision = [string]$arguments[([array]::IndexOf($arguments, "ls-tree") + 1)]
    $path = [string]$arguments[-1]
    if ($script:fullDeltaMode -in @("copy", "copy-missing-source") -and
        $revision -ceq ("3" * 40) -and
        $path -ceq "docs/product/delivery/evidence/new.md") { return }
    if ($script:fullDeltaMode -ceq "copy-missing-source" -and
        $revision -ceq ("3" * 40) -and
        $path -ceq "docs/product/delivery/evidence/old.md") { return }
    if ($script:fullDeltaMode -ceq "symlink") { return "120000 blob $('a' * 40)`tfixture" }
    if ($script:fullDeltaMode -ceq "gitlink") { return "160000 commit $('a' * 40)`tfixture" }
    if ($script:fullDeltaMode -ceq "mode") { return "100600 blob $('a' * 40)`tfixture" }
    if ($script:fullDeltaMode -ceq "ambiguous") {
      return @("100644 blob $('a' * 40)`tfixture", "100644 blob $('b' * 40)`tfixture-two")
    }
    return "100644 blob $('a' * 40)`tfixture"
  }
  if ($arguments -contains "--full-index") {
    if ($script:fullDeltaMode -ceq "patch-error") { $global:LASTEXITCODE = 128; return }
    $global:LASTEXITCODE = 0
    return $script:fullDeltaPatch
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected full-delta mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  $baselineOperatorSha = "3" * 40
  $currentOperatorSha = "4" * 40
  $reviewedFullDeltaSha = Get-TextSha256 ("development-operator-delta-v1`n$baselineOperatorSha`n$currentOperatorSha`n--name-status--`n" +
    (($script:fullDeltaRecords -join "`n") + "`n--patch--`n" + ($script:fullDeltaPatch -join "`n") + "`n"))
  $acceptedFullDelta = Get-ReviewedBaselineToCurrentDeltaSha256 `
    -BaselineOperatorSha $baselineOperatorSha -CurrentOperatorSha $currentOperatorSha `
    -ReviewedSha256 $reviewedFullDeltaSha
  if ($acceptedFullDelta -cne $reviewedFullDeltaSha) {
    throw "The independently reviewed full baseline-to-current delta was not accepted."
  }
  $script:fullDeltaMode = "copy"
  $acceptedCopyDelta = Get-ReviewedBaselineToCurrentDeltaSha256 `
    -BaselineOperatorSha $baselineOperatorSha -CurrentOperatorSha $currentOperatorSha `
    -ReviewedSha256 $reviewedFullDeltaSha
  if ($acceptedCopyDelta -cne $reviewedFullDeltaSha) {
    throw "A canonical added path detected heuristically as a retained regular-file copy was rejected."
  }
  $script:fullDeltaMode = "valid"
  foreach ($reviewed in @("", ("0" * 64))) {
    $rejected = $false
    try {
      $null = Get-ReviewedBaselineToCurrentDeltaSha256 `
        -BaselineOperatorSha $baselineOperatorSha -CurrentOperatorSha $currentOperatorSha `
        -ReviewedSha256 $reviewed
    } catch { $rejected = $true }
    if (-not $rejected) { throw "A missing or wrong full baseline-to-current review hash was accepted." }
  }
  foreach ($mode in @(
      "nonancestor", "detected-error", "records-error", "numstat-error", "patch-error", "binary",
      "rename", "copy-unbound", "copy-existing-destination", "copy-missing-source",
      "symlink", "gitlink", "mode", "ambiguous", "unsupported"
    )) {
    $script:fullDeltaMode = $mode
    $rejected = $false
    try {
      $null = Get-ReviewedBaselineToCurrentDeltaSha256 `
        -BaselineOperatorSha $baselineOperatorSha -CurrentOperatorSha $currentOperatorSha `
        -ReviewedSha256 $reviewedFullDeltaSha
    } catch { $rejected = $true }
    if (-not $rejected) { throw "The full baseline-to-current delta accepted '$mode'." }
  }
  $script:fullDeltaMode = "valid"
  $exactDelta = Get-ReviewedBaselineToCurrentDeltaSha256 `
    -BaselineOperatorSha $currentOperatorSha -CurrentOperatorSha $currentOperatorSha
  if ($exactDelta -notmatch '^[a-f0-9]{64}$') { throw "An exact-current baseline did not retain canonical binding." }
  $extraExactReviewRejected = $false
  try {
    $null = Get-ReviewedBaselineToCurrentDeltaSha256 `
      -BaselineOperatorSha $currentOperatorSha -CurrentOperatorSha $currentOperatorSha `
      -ReviewedSha256 ("a" * 64)
  } catch { $extraExactReviewRejected = $true }
  if (-not $extraExactReviewRejected) { throw "An exact-current baseline accepted an unnecessary review hash." }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  Remove-Variable -Name fullDeltaMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name fullDeltaRecords -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name fullDeltaPatch -Scope Script -ErrorAction SilentlyContinue
}

$script:headGuardMode = "valid"
$script:headGuardSawForcedStatus = $false
$script:headGuardSawExplicitUpstream = $false
function git {
  $arguments = @($args)
  if ($arguments -contains "branch") {
    if ($script:headGuardMode -ceq "branch-error") { $global:LASTEXITCODE = 128; return }
    $global:LASTEXITCODE = 0
    return $(if ($script:headGuardMode -ceq "branch") { "feature" } else { "main" })
  }
  if ($arguments -contains "rev-parse") {
    if ($arguments[-1] -ceq "refs/remotes/origin/main") { $script:headGuardSawExplicitUpstream = $true }
    if (($arguments[-1] -ceq "HEAD" -and $script:headGuardMode -ceq "head-error") -or
        ($arguments[-1] -ceq "refs/remotes/origin/main" -and $script:headGuardMode -ceq "upstream-error")) {
      $global:LASTEXITCODE = 128
      return
    }
    $global:LASTEXITCODE = 0
    if ($arguments[-1] -ceq "HEAD") { return $(if ($script:headGuardMode -ceq "head") { "6" * 40 } else { "5" * 40 }) }
    return $(if ($script:headGuardMode -in @("divergent", "ambiguous-tag")) { "7" * 40 } else { "5" * 40 })
  }
  if ($arguments -contains "status") {
    $script:headGuardSawForcedStatus = $arguments -contains "--porcelain=v1" -and
      $arguments -contains "--untracked-files=all" -and $arguments -contains "--ignore-submodules=none"
    if ($script:headGuardMode -ceq "config-error") { $global:LASTEXITCODE = 128; return }
    $global:LASTEXITCODE = 0
    if ($script:headGuardMode -ceq "dirty") { return " M tracked.txt" }
    if ($script:headGuardMode -ceq "hidden-config") { return "?? .config/operator/hidden.json" }
    return
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected HEAD-guard mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  Assert-CleanCurrentMainHead -ExpectedSha ("5" * 40)
  if (-not $script:headGuardSawForcedStatus) { throw "The clean-source guard omitted a forced complete porcelain-v1 status." }
  if (-not $script:headGuardSawExplicitUpstream) { throw "The clean-source guard used an ambiguous origin/main revision." }
  foreach ($mode in @(
      "branch", "head", "divergent", "ambiguous-tag", "dirty", "hidden-config", "branch-error", "head-error",
      "upstream-error", "config-error"
    )) {
    $script:headGuardMode = $mode
    $rejected = $false
    try { Assert-CleanCurrentMainHead -ExpectedSha ("5" * 40) } catch { $rejected = $true }
    if (-not $rejected) { throw "The clean-current-main guard accepted '$mode'." }
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  Remove-Variable -Name headGuardMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name headGuardSawForcedStatus -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name headGuardSawExplicitUpstream -Scope Script -ErrorAction SilentlyContinue
}

$terraformInputFixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "migration-terraform-input-$([guid]::NewGuid().ToString('N'))"
$originalRepositoryRoot = $repositoryRoot
$terraformFixtureAssumePath = "infrastructure/terraform/fixture/main.tf"
$terraformFixtureConfigSet = $false
$terraformFixtureAssumeSet = $false
$terraformFixtureSkipSet = $false
$savedFixtureExclude = ""
try {
  $repositoryRoot = $terraformInputFixtureRoot
  $terraformFixtureSource = Join-Path $repositoryRoot "infrastructure\terraform\fixture"
  $terraformFixtureIgnored = Join-Path $terraformFixtureSource ".terraform"
  $null = New-Item -ItemType Directory -Path $terraformFixtureIgnored -Force
  [IO.File]::WriteAllText((Join-Path $terraformFixtureSource "main.tf"), "terraform {}", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $terraformFixtureSource "template.txt"), "tracked template", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $terraformFixtureIgnored "ignored.auto.tfvars"), "ignored = true", [Text.UTF8Encoding]::new($false))
  & git -C $repositoryRoot init --quiet
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture Git repository could not be initialized." }
  & git -C $repositoryRoot config user.name "Migration Guard Test"
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture user name could not be configured." }
  & git -C $repositoryRoot config user.email "migration-guard@example.invalid"
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture user email could not be configured." }
  $terraformFixtureConfigSet = $true
  & git -C $repositoryRoot add -- infrastructure/terraform
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture could not be staged." }
  & git -C $repositoryRoot commit --quiet -m "Create Terraform input fixture"
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture could not be committed." }
  $fixtureExcludePath = Join-Path $repositoryRoot ".git\info\exclude"
  $savedFixtureExclude = [IO.File]::ReadAllText($fixtureExcludePath)
  Assert-NoUntrackedTerraformInputs

  $ignoredPlanPath = Join-Path $terraformFixtureSource "reviewed-local.tfplan"
  [IO.File]::AppendAllText($fixtureExcludePath, "*.tfplan`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($ignoredPlanPath, "local saved plan", [Text.UTF8Encoding]::new($false))
  Assert-NoUntrackedTerraformInputs
  Remove-Item -LiteralPath $ignoredPlanPath -Force
  [IO.File]::WriteAllText($fixtureExcludePath, $savedFixtureExclude, [Text.UTF8Encoding]::new($false))

  foreach ($ignoredInput in @(
      @{ Name = "evil.tf"; Content = "terraform {}"; Pattern = "evil.tf" },
      @{ Name = "secret.auto.tfvars"; Content = "secret = true"; Pattern = "*.auto.tfvars" },
      @{ Name = "hidden-template.txt"; Content = "hidden template"; Pattern = "hidden-template.txt" },
      @{ Name = "hidden-data.json"; Content = '{"hidden":true}'; Pattern = "hidden-data.json" }
    )) {
    $ignoredPath = Join-Path $terraformFixtureSource $ignoredInput.Name
    [IO.File]::AppendAllText($fixtureExcludePath, "$($ignoredInput.Pattern)`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($ignoredPath, $ignoredInput.Content, [Text.UTF8Encoding]::new($false))
    $rejected = $false
    try { Assert-NoUntrackedTerraformInputs } catch { $rejected = $true }
    if (-not $rejected) { throw "A .git/info/exclude-hidden Terraform source '$($ignoredInput.Name)' was accepted." }
    Remove-Item -LiteralPath $ignoredPath -Force
    [IO.File]::WriteAllText($fixtureExcludePath, $savedFixtureExclude, [Text.UTF8Encoding]::new($false))
  }

  & git -C $repositoryRoot update-index --assume-unchanged -- $terraformFixtureAssumePath
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input assume-unchanged fixture could not be set." }
  $terraformFixtureAssumeSet = $true
  $assumeFlagRejected = $false
  try { Assert-NoUntrackedTerraformInputs } catch { $assumeFlagRejected = $true }
  if (-not $assumeFlagRejected) { throw "An assume-unchanged Terraform index flag was accepted even before byte drift." }
  [IO.File]::WriteAllText((Join-Path $terraformFixtureSource "main.tf"), "terraform { required_version = `"> 99`" }", [Text.UTF8Encoding]::new($false))
  if (@(& git -C $repositoryRoot status --porcelain=v1).Count -ne 0) {
    throw "The assume-unchanged fixture was unexpectedly visible to porcelain status."
  }
  $assumeUnchangedRejected = $false
  try { Assert-NoUntrackedTerraformInputs } catch { $assumeUnchangedRejected = $true }
  if (-not $assumeUnchangedRejected) { throw "An assume-unchanged modified Terraform file was accepted." }
  & git -C $repositoryRoot update-index --no-assume-unchanged -- $terraformFixtureAssumePath
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input assume-unchanged fixture could not be cleared." }
  $terraformFixtureAssumeSet = $false
  & git -C $repositoryRoot checkout -- $terraformFixtureAssumePath
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input fixture could not restore its tracked bytes." }

  & git -C $repositoryRoot update-index --skip-worktree -- $terraformFixtureAssumePath
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input skip-worktree fixture could not be set." }
  $terraformFixtureSkipSet = $true
  $skipWorktreeRejected = $false
  try { Assert-NoUntrackedTerraformInputs } catch { $skipWorktreeRejected = $true }
  if (-not $skipWorktreeRejected) { throw "A skip-worktree Terraform index flag was accepted." }
  & git -C $repositoryRoot update-index --no-skip-worktree -- $terraformFixtureAssumePath
  if ($LASTEXITCODE -ne 0) { throw "The Terraform-input skip-worktree fixture could not be cleared." }
  $terraformFixtureSkipSet = $false

  $trackedTemplatePath = Join-Path $terraformFixtureSource "template.txt"
  Remove-Item -LiteralPath $trackedTemplatePath -Force
  $missingTrackedRejected = $false
  try { Assert-NoUntrackedTerraformInputs } catch { $missingTrackedRejected = $true }
  if (-not $missingTrackedRejected) { throw "A missing tracked Terraform template input was accepted." }
} finally {
  if ($terraformFixtureAssumeSet -and (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git"))) {
    & git -C $repositoryRoot update-index --no-assume-unchanged -- $terraformFixtureAssumePath 2>$null
  }
  if ($terraformFixtureSkipSet -and (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git"))) {
    & git -C $repositoryRoot update-index --no-skip-worktree -- $terraformFixtureAssumePath 2>$null
  }
  if (-not [string]::IsNullOrEmpty($savedFixtureExclude) -and
      (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git\info\exclude"))) {
    [IO.File]::WriteAllText((Join-Path $repositoryRoot ".git\info\exclude"), $savedFixtureExclude, [Text.UTF8Encoding]::new($false))
  }
  if ($terraformFixtureConfigSet -and (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git"))) {
    & git -C $repositoryRoot config --unset user.name 2>$null
    & git -C $repositoryRoot config --unset user.email 2>$null
  }
  $repositoryRoot = $originalRepositoryRoot
  if (Test-Path -LiteralPath $terraformInputFixtureRoot) {
    Remove-Item -LiteralPath $terraformInputFixtureRoot -Recurse -Force
  }
}
Assert-NoUntrackedTerraformInputs

$logTask = [pscustomobject]@{ taskArn = "arn:aws:ecs:us-east-2:111122223333:task/cluster/$('a' * 32)" }
$logContainer = [pscustomobject]@{ name = "database-migration" }
$logDefinition = [pscustomobject]@{ containerDefinitions = @([pscustomobject]@{
      name = "database-migration"
      logConfiguration = [pscustomobject]@{ options = [pscustomobject]@{
          'awslogs-stream-prefix' = "migration"
        } }
    }) }
$derivedLogStream = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer `
  -TaskDefinition $logDefinition
if ($derivedLogStream -cne "migration/database-migration/$('a' * 32)") {
  throw "The omitted ECS log stream did not resolve deterministically."
}
$logContainer | Add-Member -NotePropertyName logStreamName -NotePropertyValue $derivedLogStream
$null = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer -TaskDefinition $logDefinition
$logContainer.logStreamName = "wrong"
$wrongLogStreamRejected = $false
try {
  $null = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer `
    -TaskDefinition $logDefinition
} catch { $wrongLogStreamRejected = $true }
if (-not $wrongLogStreamRejected) { throw "An unexpected ECS log stream was accepted." }

$submittedReceipt = [pscustomobject]@{ phase = "submitted" }
$finalizedReceipt = Set-RecoveredReceiptEvidence -Receipt $submittedReceipt `
  -StoppedAt ([datetime]::Parse("2026-08-12T23:00:00Z")) `
  -RecoveryOperatorSourceSha ("c" * 40)
if ([string]$finalizedReceipt.phase -cne "verified" -or [int]$finalizedReceipt.exitCode -ne 0 -or
    [string]$finalizedReceipt.stoppedAt -cne "2026-08-12T23:00:00.0000000Z" -or
    [string]$finalizedReceipt.recoveredByOperatorSourceSha -cne ("c" * 40)) {
  throw "The submitted recovery receipt was not finalized exactly."
}
$repeatFinalizationRejected = $false
try {
  $null = Set-RecoveredReceiptEvidence -Receipt $finalizedReceipt `
    -StoppedAt ([datetime]::UtcNow) -RecoveryOperatorSourceSha ("c" * 40)
} catch { $repeatFinalizationRejected = $true }
if (-not $repeatFinalizationRejected) { throw "A finalized receipt was recoverable twice." }

$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"

$emptyClaimHistory = [pscustomobject]@{}
if (Test-DurableClaimHistoryExists -History $emptyClaimHistory -ClaimKey "claim") {
  throw "An omitted S3 claim-history list was treated as an existing claim."
}
if (Test-DurableClaimHistoryExists -History ([pscustomobject]@{ Versions = @() }) -ClaimKey "claim") {
  throw "An explicit empty S3 version list was treated as an existing claim."
}
if (Test-DurableClaimHistoryExists -History ([pscustomobject]@{
      Versions = @($null)
      DeleteMarkers = @($null)
    }) -ClaimKey "claim") {
  throw "A null S3 history entry was treated as an existing claim."
}
foreach ($history in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = "claim" }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = "claim" }) }
  )) {
  if (-not (Test-DurableClaimHistoryExists -History $history -ClaimKey "claim")) {
    throw "Existing durable claim history was not rejected."
  }
}

$releaseSource = "a" * 40
$operatorSource = "b" * 40
Assert-ReleaseSourceBinding -ReleaseSourceSha $operatorSource -OperatorSourceSha $operatorSource
Assert-ReleaseSourceBinding -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource `
  -AllowAncestor -IsAncestor $true

foreach ($unsafeBinding in @(
    @{ release = $releaseSource; operator = $operatorSource; allow = $false; ancestor = $true },
    @{ release = $releaseSource; operator = $operatorSource; allow = $true; ancestor = $false },
    @{ release = "invalid"; operator = $operatorSource; allow = $true; ancestor = $true }
  )) {
  $bindingRejected = $false
  try {
    Assert-ReleaseSourceBinding -ReleaseSourceSha $unsafeBinding.release `
      -OperatorSourceSha $unsafeBinding.operator -AllowAncestor:$unsafeBinding.allow `
      -IsAncestor:$unsafeBinding.ancestor
  } catch {
    $bindingRejected = $true
  }
  if (-not $bindingRejected) { throw "An unsafe release/operator source binding was accepted." }
}

Assert-OperatorOnlyReleaseDelta -ChangeRecords @(
  "M`tscripts/operate-development-document-migration.ps1",
  "M`tscripts/tests/development-document-migration-operator.tests.ps1",
  "M`tscripts/validate-serverless-workflow-infrastructure.mjs",
  "M`tscripts/build-gateway-lambda.mjs",
  "M`tinfrastructure/runbooks/deployments/database-migration.md"
)
Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $releaseSource `
  -CurrentOperatorSourceSha $operatorSource -IsAncestor $true -ChangeRecords @(
    "M`tscripts/operate-development-document-migration.ps1"
  )
Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $operatorSource `
  -CurrentOperatorSourceSha $operatorSource -IsAncestor $true -ChangeRecords @()
foreach ($unsafeRecovery in @(
    @{ ancestor = $false; changes = @("M`tscripts/operate-development-document-migration.ps1") },
    @{ ancestor = $true; changes = @("M`tbackend/services/profile/src/index.ts") }
  )) {
  $recoveryRejected = $false
  try {
    Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $releaseSource `
      -CurrentOperatorSourceSha $operatorSource -IsAncestor:$unsafeRecovery.ancestor `
      -ChangeRecords $unsafeRecovery.changes
  } catch { $recoveryRejected = $true }
  if (-not $recoveryRejected) { throw "An unsafe recovery operator source was accepted." }
}
foreach ($unsafeDelta in @(
    , @("M`tinfrastructure/terraform/environments/development/main.tf"),
    , @("A`tscripts/operate-development-document-migration.ps1"),
    # Only the Gateway bundle script is allowed: other Lambda builds, the gateway source, the
    # migration image inputs, and a newly added or deleted copy of the allowed file are not.
    , @("M`tscripts/build-document-lambdas.mjs"),
    , @("M`tscripts/build-workflow-ingress-lambda.mjs"),
    , @("A`tscripts/build-gateway-lambda.mjs"),
    , @("D`tscripts/build-gateway-lambda.mjs"),
    , @("M`tscripts/build-gateway-lambda.mjs", "M`tbackend/gateway/src/lambda.ts"),
    , @("M`tDockerfile.migration"),
    , @()
  )) {
  $deltaRejected = $false
  try { Assert-OperatorOnlyReleaseDelta -ChangeRecords $unsafeDelta } catch { $deltaRejected = $true }
  if (-not $deltaRejected) { throw "A non-verifier release delta was accepted." }
}

$originalRepositoryRoot = $repositoryRoot
$operatorSourceVariableExisted = Test-Path -LiteralPath Variable:\operatorSourceSha
if ($operatorSourceVariableExisted) { $originalOperatorSourceSha = $operatorSourceSha }
$mockExecutionOperatorSourceSha = "c" * 40
$mockCurrentOperatorSourceSha = "d" * 40
$script:recoveryGitMode = "exact"
$script:recoveryGitDiffCalls = 0
$script:recoveryGitCatFileCalls = 0
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") {
    $global:LASTEXITCODE = 0
    return
  }
  if ($arguments -contains "diff") {
    $script:recoveryGitDiffCalls++
    $global:LASTEXITCODE = 0
    if ($script:recoveryGitMode -ceq "valid") {
      return "M`tscripts/operate-development-document-migration.ps1"
    }
    if ($script:recoveryGitMode -ceq "invalid") {
      return "M`tbackend/services/profile/src/index.ts"
    }
    throw "The exact-current recovery path unexpectedly inspected a Git delta."
  }
  if ($arguments -contains "cat-file") {
    $script:recoveryGitCatFileCalls++
    $global:LASTEXITCODE = 0
    return "blob"
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  $operatorSourceSha = $mockCurrentOperatorSourceSha

  Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockCurrentOperatorSourceSha
  if ($script:recoveryGitDiffCalls -ne 0 -or $script:recoveryGitCatFileCalls -ne 0) {
    throw "Exact-current recovery inspected a nonexistent operator delta."
  }

  $script:recoveryGitMode = "valid"
  Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockExecutionOperatorSourceSha
  if ($script:recoveryGitDiffCalls -ne 1 -or $script:recoveryGitCatFileCalls -ne 2) {
    throw "Allowlisted ancestor recovery did not inspect the exact nonempty blob delta."
  }

  $script:recoveryGitMode = "invalid"
  $invalidIntegratedRecoveryRejected = $false
  try {
    Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockExecutionOperatorSourceSha
  } catch {
    $invalidIntegratedRecoveryRejected = $true
  }
  if (-not $invalidIntegratedRecoveryRejected) {
    throw "The integrated recovery path accepted a non-verifier operator delta."
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  if ($operatorSourceVariableExisted) {
    $operatorSourceSha = $originalOperatorSourceSha
  } else {
    Remove-Variable -Name operatorSourceSha -ErrorAction SilentlyContinue
  }
  Remove-Variable -Name recoveryGitMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name recoveryGitDiffCalls -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name recoveryGitCatFileCalls -Scope Script -ErrorAction SilentlyContinue
}

$executionIdentity = [pscustomobject]@{
  schemaVersion = 2
  kind = "development-document-migration-execution"
  sourceSha = $releaseSource
  operatorSourceSha = $operatorSource
}
Assert-ExecutionIdentity -Value $executionIdentity `
  -ExpectedKind "development-document-migration-execution" `
  -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
foreach ($mutation in @(
    @{ property = "schemaVersion"; value = 1 },
    @{ property = "operatorSourceSha"; value = $releaseSource },
    @{ property = "sourceSha"; value = $operatorSource }
  )) {
  $invalidIdentity = $executionIdentity | ConvertTo-Json | ConvertFrom-Json
  $invalidIdentity.($mutation.property) = $mutation.value
  $identityRejected = $false
  try {
    Assert-ExecutionIdentity -Value $invalidIdentity `
      -ExpectedKind "development-document-migration-execution" `
      -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
  } catch { $identityRejected = $true }
  if (-not $identityRejected) { throw "Mismatched execution evidence was accepted." }
}

$receiptIdentity = [pscustomobject]@{
  schemaVersion = 2
  kind = "development-document-migration-receipt"
  sourceSha = $releaseSource
  operatorSourceSha = $operatorSource
}
Assert-ExecutionIdentity -Value $receiptIdentity `
  -ExpectedKind "development-document-migration-receipt" `
  -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
$receiptIdentity.operatorSourceSha = $releaseSource
$receiptRejected = $false
try {
  Assert-ExecutionIdentity -Value $receiptIdentity `
    -ExpectedKind "development-document-migration-receipt" `
    -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
} catch { $receiptRejected = $true }
if (-not $receiptRejected) { throw "A receipt from a different operator revision was accepted." }

$claimChecksum = [Convert]::ToBase64String([byte[]](0..31))
Assert-DurableClaimPutResult -ExitCode 0 `
  -PutResult ([pscustomobject]@{ VersionId = "version"; ChecksumSHA256 = $claimChecksum }) `
  -ExpectedChecksum $claimChecksum
foreach ($claimResult in @(
    @{ exitCode = 1; value = $null },
    @{ exitCode = 0; value = [pscustomobject]@{ VersionId = ""; ChecksumSHA256 = $claimChecksum } },
    @{ exitCode = 0; value = [pscustomobject]@{ VersionId = "version"; ChecksumSHA256 = "wrong" } }
  )) {
  $claimRejected = $false
  try {
    Assert-DurableClaimPutResult -ExitCode $claimResult.exitCode -PutResult $claimResult.value `
      -ExpectedChecksum $claimChecksum
  } catch { $claimRejected = $true }
  if (-not $claimRejected) { throw "A replayed or non-versioned execution claim was accepted." }
}

$claimVersion = "claim-version"
$claimKmsArn = "arn:aws:kms:us-east-2:111122223333:key/00000000-0000-0000-0000-000000000000"
$claimHead = [pscustomobject]@{
  ServerSideEncryption = "aws:kms"
  SSEKMSKeyId = $claimKmsArn
  BucketKeyEnabled = $true
  ContentLength = 10
  VersionId = $claimVersion
  ChecksumSHA256 = $claimChecksum
  Metadata = [pscustomobject]@{
    'execution-plan-sha256' = "f" * 64
    'source-sha' = $releaseSource
    'operator-source-sha' = $operatorSource
  }
}
Assert-DurableExecutionClaimEvidence -Head $claimHead -ClaimVersion $claimVersion `
  -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
  -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
  -OperatorSourceSha $operatorSource
$historicalClaimHead = $claimHead | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historicalClaimHead.Metadata.'operator-source-sha' = $releaseSource
Assert-DurableExecutionClaimEvidence -Head $historicalClaimHead -ClaimVersion $claimVersion `
  -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
  -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
  -OperatorSourceSha $releaseSource
$historicalClaimMismatchRejected = $false
try {
  Assert-DurableExecutionClaimEvidence -Head $historicalClaimHead -ClaimVersion $claimVersion `
    -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
    -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
    -OperatorSourceSha $operatorSource
} catch { $historicalClaimMismatchRejected = $true }
if (-not $historicalClaimMismatchRejected) {
  throw "A historical claim was accepted as belonging to the current recovery operator."
}
foreach ($case in @(
    @{ property = "ChecksumSHA256"; value = "wrong" },
    @{ property = "SSEKMSKeyId"; value = "$claimKmsArn-wrong" },
    @{ property = "VersionId"; value = "wrong" },
    @{ property = "Metadata"; value = [pscustomobject]@{
        'execution-plan-sha256' = "e" * 64
        'source-sha' = $releaseSource
        'operator-source-sha' = $operatorSource
      } }
  )) {
  $badClaimHead = $claimHead | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badClaimHead.($case.property) = $case.value
  $claimEvidenceRejected = $false
  try {
    Assert-DurableExecutionClaimEvidence -Head $badClaimHead -ClaimVersion $claimVersion `
      -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
      -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
      -OperatorSourceSha $operatorSource
  } catch { $claimEvidenceRejected = $true }
  if (-not $claimEvidenceRejected) { throw "Invalid durable claim evidence was accepted." }
}

$zeroChangePlan = [pscustomobject]@{
  complete = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = "example" } }
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
}
Assert-PlanWasApplied -Plan $zeroChangePlan

$refreshOnlyPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$refreshOnlyPlan.resource_drift = @(
  [pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } }
)
Assert-PlanWasApplied -Plan $refreshOnlyPlan

$changeRejected = $false
$changedPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$changedPlan.resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
try {
  Assert-PlanWasApplied -Plan $changedPlan
} catch {
  $changeRejected = $true
}
if (-not $changeRejected) { throw "The input baseline accepted an unapplied resource change." }

$retainedVariables = [pscustomobject]@{}
foreach ($name in @(Get-DeclaredVariableNames)) {
  $retainedVariables | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{ value = "test" })
}
$retainedVariables.document_processing_deployment_stage.value = "parser-dark"
$retainedVariables.document_parser_invocation_qualified_arn.value = ""
$retainedPlan = [pscustomobject]@{
  complete = $true
  applyable = $false
  errored = $false
  terraform_version = "1.9.8"
  variables = $retainedVariables
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
  output_changes = [pscustomobject]@{}
}

function New-MigrationDriftRecord([string]$Address, [string]$Type, [object]$Before, [object]$After,
  [object]$BeforeSensitive = ([pscustomobject]@{}), [object]$AfterSensitive = ([pscustomobject]@{})) {
  return [pscustomobject]@{
    address = $Address; mode = "managed"; type = $Type
    change = [pscustomobject]@{
      actions = @("update"); before = $Before; after = $After; after_unknown = [pscustomobject]@{}
      before_sensitive = $BeforeSensitive; after_sensitive = $AfterSensitive; replace_paths = @()
    }
  }
}
function New-MigrationTagDriftRecord([string]$Address, [string]$Type) {
  return New-MigrationDriftRecord $Address $Type `
    ([pscustomobject]@{ id = $Address; tags = $null }) `
    ([pscustomobject]@{ id = $Address; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
function New-MigrationTestPolicy([object[]]$Statements) {
  return @{ Version = "2012-10-17"; Statement = $Statements } | ConvertTo-Json -Compress -Depth 40
}
function New-MigrationQueuePolicy([string]$Sid, [string]$QueueName, [string[]]$RuleNames,
  [string]$AccountId) {
  return New-MigrationTestPolicy @(@{
      Sid = $Sid; Effect = "Allow"; Action = "sqs:SendMessage"
      Resource = "arn:aws:sqs:us-east-2:${AccountId}:$QueueName"
      Principal = @{ Service = "events.amazonaws.com" }
      Condition = @{
        StringEquals = @{ "aws:SourceAccount" = $AccountId }
        ArnEquals = @{ "aws:SourceArn" = @($RuleNames | ForEach-Object {
              "arn:aws:events:us-east-2:${AccountId}:rule/$_"
            }) }
      }
    })
}

$driftAccount = "111122223333"
$driftKmsArn = "arn:aws:kms:us-east-2:${driftAccount}:key/00000000-0000-0000-0000-000000000001"
$driftBucketArn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-${driftAccount}"
$driftMalwareRole = "arn:aws:iam::${driftAccount}:role/ai-job-apply-development-document-malware-scan"
$parserPolicy = New-MigrationTestPolicy @(
  @{ Sid = "ManageVpcInterfaces"; Effect = "Allow"; Action = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); Resource = "*" },
  @{ Sid = "DecryptLambdaEnvironment"; Effect = "Allow"; Action = "kms:Decrypt"; Resource = $driftKmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "lambda.us-east-2.amazonaws.com" } } }
)
$objectPolicy = New-MigrationTestPolicy @(
  @{ Sid = "SessionPolicyMustNarrowObjectAccess"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObject"); Resource = @("$driftBucketArn/quarantine/*", "$driftBucketArn/normalized/*") },
  @{ Sid = "EncryptAndDecryptViaS3Only"; Effect = "Allow"; Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = $driftKmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "s3.us-east-2.amazonaws.com" } } }
)
$parserInline = @([pscustomobject]@{ name = "document-parser-runtime"; policy = $parserPolicy })
$objectInline = @([pscustomobject]@{ name = "document-object-access-runtime"; policy = $objectPolicy })
$candidateDeny = @{
  Sid = "DenyQuarantineReadsWithoutCleanMalwareTag"; Effect = "Deny"
  Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$driftBucketArn/quarantine/*"; Principal = "*"
  Condition = @{
    StringNotEquals = @{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "NO_THREATS_FOUND" }
    ArnNotEquals = @{ "aws:PrincipalArn" = $driftMalwareRole }
  }
}
$s3Base = @(
  @{ Sid = "DenyInsecureTransport"; Effect = "Deny" },
  @{ Sid = "DenyWrongEncryptionMode"; Effect = "Deny" },
  @{ Sid = "DenyWrongEncryptionKey"; Effect = "Deny" }
)
$s3Before = New-MigrationTestPolicy $s3Base
$s3After = New-MigrationTestPolicy @($s3Base + $candidateDeny)
$snsAdded = @{
  Sid = "AllowExactDocumentOperationalRules"; Effect = "Allow"; Action = "SNS:Publish"
  Resource = "arn:aws:sns:us-east-2:${driftAccount}:ai-job-apply-development-operational-alerts"
  Principal = @{ Service = "events.amazonaws.com" }
  Condition = @{
    StringEquals = @{ "aws:SourceAccount" = $driftAccount }
    ArnEquals = @{ "aws:SourceArn" = @(
        "arn:aws:events:us-east-2:${driftAccount}:rule/ai-job-apply-development-document-scan-tag-failure",
        "arn:aws:events:us-east-2:${driftAccount}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
      ) }
  }
}
$snsBase = @(
  @{ Sid = "AllowAccountAdministration"; Effect = "Allow" },
  @{ Sid = "AllowCloudWatchAlarmPublishing"; Effect = "Allow" },
  @{ Sid = "AllowAwsBudgetsPublishing"; Effect = "Allow" }
)
$snsBefore = New-MigrationTestPolicy $snsBase
$snsAfter = New-MigrationTestPolicy @($snsBase + $snsAdded)
$deliveryPolicy = New-MigrationQueuePolicy "ExactEventBridgeRuleDeadLettersOnly" `
  "ai-job-apply-development-document-scan-delivery-dlq" `
  @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure", "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler") $driftAccount
$resultsPolicy = New-MigrationQueuePolicy "ExactGuardDutyResultRuleOnly" `
  "ai-job-apply-development-document-scan-results" @("ai-job-apply-development-document-scan-results") $driftAccount

$fullProviderDrift = @()
foreach ($address in @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]"
  )) { $fullProviderDrift += New-MigrationTagDriftRecord $address "aws_cloudwatch_event_rule" }
foreach ($address in @(
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_security_contradiction[0]"
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $address "aws_cloudwatch_log_metric_filter" `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = $null }) }) `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = [pscustomobject]@{} }) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{}) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{ dimensions = [pscustomobject]@{} }) })
}
$dimensionAlarms = @("document_processing_record_failed", "document_processing_timed_out", "document_security_contradiction")
foreach ($name in @(
    "document_parser_errors", "document_processing_record_failed", "document_processing_timed_out",
    "document_processor_errors", "document_scan_dead_letter", "document_scan_delivery_dead_letter",
    "document_scan_queue_age", "document_security_contradiction"
  )) {
  $address = "module.platform.aws_cloudwatch_metric_alarm.$name[0]"
  $before = [ordered]@{ id = $address; insufficient_data_actions = $null; tags = $null }
  $after = [ordered]@{ id = $address; insufficient_data_actions = @(); tags = [pscustomobject]@{} }
  $beforeSensitive = [ordered]@{ tags_all = [pscustomobject]@{} }
  $afterSensitive = [ordered]@{ insufficient_data_actions = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }
  if ($name -cin $dimensionAlarms) {
    $before.dimensions = $null; $after.dimensions = [pscustomobject]@{}; $afterSensitive.dimensions = [pscustomobject]@{}
  } else {
    $before.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $after.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $beforeSensitive.dimensions = [pscustomobject]@{}; $afterSensitive.dimensions = [pscustomobject]@{}
  }
  $fullProviderDrift += New-MigrationDriftRecord $address "aws_cloudwatch_metric_alarm" `
    ([pscustomobject]$before) ([pscustomobject]$after) `
    ([pscustomobject]$beforeSensitive) ([pscustomobject]$afterSensitive)
}
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_db_instance.postgres[0]" "aws_db_instance" `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:00Z" }) `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:01Z" })
foreach ($role in @(
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser[0]"; Inline = $parserInline },
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser_object_access[0]"; Inline = $objectInline }
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $role.Address "aws_iam_role" `
    ([pscustomobject]@{ id = $role.Address; inline_policy = @(); tags = $null }) `
    ([pscustomobject]@{ id = $role.Address; inline_policy = $role.Inline; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @(); managed_policy_arns = @(); tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @([pscustomobject]@{}); managed_policy_arns = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_iam_role.document_processor[0]" "aws_iam_role"
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_lambda_function.document_parser[0]" "aws_lambda_function" `
  ([pscustomobject]@{ id = "parser"; layers = $null; tags = $null }) `
  ([pscustomobject]@{ id = "parser"; layers = @(); tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ layers = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_s3_bucket.candidate_documents[0]" "aws_s3_bucket" `
  ([pscustomobject]@{ id = "candidate"; policy = $s3Before }) `
  ([pscustomobject]@{ id = "candidate"; policy = $s3After })
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_security_group.document_parser[0]" "aws_security_group"
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_sns_topic.operational_alerts" "aws_sns_topic" `
  ([pscustomobject]@{ id = "alerts"; policy = $snsBefore }) `
  ([pscustomobject]@{ id = "alerts"; policy = $snsAfter })
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_sqs_queue.document_scan_dead_letter[0]" "aws_sqs_queue"
foreach ($queue in @(
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; Policy = $deliveryPolicy },
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_results[0]"; Policy = $resultsPolicy }
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $queue.Address "aws_sqs_queue" `
    ([pscustomobject]@{ id = $queue.Address; policy = ""; tags = $null }) `
    ([pscustomobject]@{ id = $queue.Address; policy = $queue.Policy; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" "aws_vpc_endpoint"
if ($fullProviderDrift.Count -ne 27 -or
    @($fullProviderDrift | ForEach-Object address | Sort-Object -Unique).Count -ne 27) {
  throw "The migration consumer full provider-normalization fixture is not exactly 27 unique records."
}
$driftRoot = [pscustomobject]@{ resources = @(
    [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $driftKmsArn } },
    [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser[0]"; values = [pscustomobject]@{ inline_policy = $parserInline } },
    [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser_object_access[0]"; values = [pscustomobject]@{ inline_policy = $objectInline } },
    [pscustomobject]@{ address = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; values = [pscustomobject]@{ policy = $s3After } },
    [pscustomobject]@{ address = "module.platform.aws_sns_topic_policy.operational_alerts"; values = [pscustomobject]@{ policy = $snsAfter } },
    [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; values = [pscustomobject]@{ policy = $deliveryPolicy } },
    [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_results[0]"; values = [pscustomobject]@{ policy = $resultsPolicy } }
  ) }
$retainedPlan.planned_values.root_module = $driftRoot
$retainedPlan.resource_drift = $fullProviderDrift
Assert-RetainedMigrationBaselinePlan -Plan $retainedPlan
$currentVersionBaseline = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$currentVersionBaseline.terraform_version = "1.16.2"
Assert-RetainedMigrationBaselinePlan -Plan $currentVersionBaseline
foreach ($invalidVersion in @("1.9.9", "1.16.1", "1.16.3", "1.16.2 ", "")) {
  $versionPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $versionPlan.terraform_version = $invalidVersion
  $rejected = $false
  try { Assert-RetainedMigrationBaselinePlan -Plan $versionPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The retained migration baseline accepted an unapproved Terraform version." }
}
foreach ($record in $fullProviderDrift) {
  $subsetPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $subsetPlan.resource_drift = @($record)
  Assert-RetainedMigrationBaselinePlan -Plan $subsetPlan
}
$ecsTagDrift = New-MigrationTagDriftRecord $migrationAddress "aws_ecs_task_definition"
$ecsSubsetPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$ecsSubsetPlan.resource_drift = @($ecsTagDrift)
Assert-RetainedMigrationBaselinePlan -Plan $ecsSubsetPlan
$rdsSubset = @($fullProviderDrift | Where-Object address -eq "module.platform.aws_db_instance.postgres[0]")[0]
if (-not (Test-IgnorableRdsRestorableTimeRefresh -Drift $rdsSubset) -or
    -not (Test-IgnorableMigrationTaskTagsRefresh -Drift $ecsTagDrift) -or
    @(Get-UnacceptedVerificationDrift -Drift $fullProviderDrift -RootModule $driftRoot).Count -ne 0) {
  throw "The legacy migration drift entry points do not delegate to the shared semantic guard."
}
foreach ($mutation in @("duplicate", "action", "unknown", "sensitive", "other")) {
  $badPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" { $badPlan.resource_drift = @($badPlan.resource_drift) + @($badPlan.resource_drift[0]) }
    "action" { $badPlan.resource_drift[0].change.actions = @("delete", "create") }
    "unknown" { $badPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
    "other" { $badPlan.resource_drift[0].change.after.id = "changed" }
  }
  $rejected = $false
  try { Assert-RetainedMigrationBaselinePlan -Plan $badPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration retained-baseline path accepted '$mutation' provider drift." }
}

$SourceSha = "a" * 40
$operatorSourceSha = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$MigrationImage = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('e' * 64)"
$retainedPlan.variables.migration_image.value = $MigrationImage
$retainedState = [pscustomobject]@{ Lineage = "12345678-1234-1234-1234-123456789abc"; Serial = 51 }
$retainedTaskMetadata = [pscustomobject]@{
  appliedBaselineStage = "parser-dark"
  appliedBaselineReceiptSha256 = "b" * 64
  appliedBaselineParserQualifiedArn = ""
  appliedBaselineReleaseSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
  appliedBaselineOperatorSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
  appliedBaselineOperatorDeltaSha256 = Get-DocumentOperatorDeltaSha256 `
    -ReleaseSha "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8" `
    -OperatorSha "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
}
$postMigrationFullDriftPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
Assert-RetainedMigrationBaselinePlan -Plan $postMigrationFullDriftPlan
foreach ($mutation in @("duplicate", "unknown", "sensitive")) {
  $badPostMigrationPlan = $postMigrationFullDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" {
      $badPostMigrationPlan.resource_drift = @($badPostMigrationPlan.resource_drift) +
        @($badPostMigrationPlan.resource_drift[0])
    }
    "unknown" { $badPostMigrationPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badPostMigrationPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
  }
  $rejected = $false
  try { Assert-RetainedMigrationBaselinePlan -Plan $badPostMigrationPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The post-migration retained-plan path accepted '$mutation' provider drift." }
}
$handoffRoot = Join-Path $terraformRoot "post-migration-handoff-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $handoffRoot
$script:handoffGitRecords = @(
  "M`tscripts/operate-development-document-migration.ps1",
  "M`tscripts/tests/development-document-migration-operator.tests.ps1"
)
$script:handoffGitPatch = @("fixture retained-handoff patch")
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") { $global:LASTEXITCODE = 0; return }
  if ($arguments -contains "--name-status") { $global:LASTEXITCODE = 0; return $script:handoffGitRecords }
  if ($arguments -contains "--numstat") { $global:LASTEXITCODE = 0; return @("1`t1`tscripts/operate-development-document-migration.ps1", "1`t1`tscripts/tests/development-document-migration-operator.tests.ps1") }
  if ($arguments -contains "cat-file") { $global:LASTEXITCODE = 0; return "blob" }
  if ($arguments -contains "--full-index") { $global:LASTEXITCODE = 0; return $script:handoffGitPatch }
  $global:LASTEXITCODE = 1
  throw "Unexpected retained-handoff mocked Git invocation: $($arguments -join ' ')"
}
try {
  $handoffPlanPath = Join-Path $handoffRoot "verified.tfplan"
  [IO.File]::WriteAllText($handoffPlanPath, "verified-current-plan", [Text.UTF8Encoding]::new($false))
  $handoffPlanSha = Get-FileSha256 -Path $handoffPlanPath
  $handoff = Save-PostMigrationBaselineMetadata -Plan $retainedPlan -PlanPath $handoffPlanPath `
    -PlanSha256 $handoffPlanSha -State $retainedState -TaskMetadata $retainedTaskMetadata
  if ([string]$handoff.Path -cne "$handoffPlanPath.baseline.json" -or
      [string]$handoff.Sha256 -cne (Get-FileSha256 -Path $handoff.Path)) {
    throw "Migration Verify did not emit the exact adjacent retained-baseline handoff."
  }
  $storedHandoff = Get-Content -LiteralPath $handoff.Path -Raw | ConvertFrom-Json
  $expectedLaterOperatorDelta = Get-DocumentOperatorDeltaSha256 `
    -ReleaseSha ([string]$retainedTaskMetadata.appliedBaselineReleaseSourceSha) -OperatorSha $operatorSourceSha
  if ([string]$storedHandoff.OperatorSourceSha -cne $operatorSourceSha -or
    [string]$storedHandoff.OperatorDeltaSha256 -cne $expectedLaterOperatorDelta -or
    [string]$storedHandoff.OperatorDeltaSha256 -ceq [string]$retainedTaskMetadata.appliedBaselineOperatorDeltaSha256) {
    throw "The post-migration handoff did not recompute the release delta for the later execution operator."
  }
  Assert-PostMigrationBaselineMetadata -Metadata $storedHandoff -Plan $retainedPlan `
    -PlanPath $handoffPlanPath -PlanSha256 $handoffPlanSha -State $retainedState `
    -TaskMetadata $retainedTaskMetadata

  foreach ($tamper in @(
      @{ Property = "MigrationImage"; Value = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('f' * 64)" },
      @{ Property = "ReceiptSha256"; Value = "c" * 64 },
      @{ Property = "Stage"; Value = "complete-dark" },
      @{ Property = "ParserQualifiedArn"; Value = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7" },
      @{ Property = "StateSerial"; Value = 52 },
      @{ Property = "PlanSha256"; Value = "d" * 64 },
      @{ Property = "SchemaVersion"; Value = "1" }
    )) {
    $badHandoff = $storedHandoff | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $badHandoff.($tamper.Property) = $tamper.Value
    $tamperRejected = $false
    try {
      Assert-PostMigrationBaselineMetadata -Metadata $badHandoff -Plan $retainedPlan `
        -PlanPath $handoffPlanPath -PlanSha256 $handoffPlanSha -State $retainedState `
        -TaskMetadata $retainedTaskMetadata
    } catch { $tamperRejected = $true }
    if (-not $tamperRejected) { throw "The post-migration handoff accepted tampered $($tamper.Property)." }
  }

  $overwriteRejected = $false
  $collisionPlanSha = Get-FileSha256 -Path $handoffPlanPath
  $collisionMetadataSha = Get-FileSha256 -Path $handoff.Path
  try {
    $null = Save-PostMigrationBaselineMetadata -Plan $retainedPlan -PlanPath $handoffPlanPath `
      -PlanSha256 $handoffPlanSha -State $retainedState -TaskMetadata $retainedTaskMetadata
  } catch { $overwriteRejected = $true }
  if (-not $overwriteRejected -or -not (Test-Path -LiteralPath $handoffPlanPath) -or
      -not (Test-Path -LiteralPath $handoff.Path)) {
    throw "The retained post-migration baseline did not preserve preexisting plan/sidecar bytes."
  }
  if ((Get-FileSha256 -Path $handoffPlanPath) -cne $collisionPlanSha -or
      (Get-FileSha256 -Path $handoff.Path) -cne $collisionMetadataSha) {
    throw "A rejected retained-baseline overwrite changed existing bytes."
  }

  Remove-NewPostMigrationBaselineArtifacts -PlanPath $handoffPlanPath -MetadataPath $handoff.Path `
    -PlanOwned $false -MetadataOwned $false
  if ((Get-FileSha256 -Path $handoffPlanPath) -cne $collisionPlanSha -or
      (Get-FileSha256 -Path $handoff.Path) -cne $collisionMetadataSha) {
    throw "Ownership-aware failure cleanup removed or changed another writer's artifacts."
  }

  # Model Terraform writing the requested plan and then returning detailed exit code 2. Because
  # the target was absent before invocation, Verify owns and must remove both newly-created bytes.
  $cleanupPlan = Join-Path $handoffRoot "unexpected-exit-two.tfplan"
  $cleanupMetadata = "$cleanupPlan.baseline.json"
  [IO.File]::WriteAllText($cleanupPlan, "unexpected-exit-two-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($cleanupMetadata, "unexpected-exit-two-metadata", [Text.UTF8Encoding]::new($false))
  Remove-NewPostMigrationBaselineArtifacts -PlanPath $cleanupPlan -MetadataPath $cleanupMetadata `
    -PlanOwned $true -MetadataOwned $true
  if ((Test-Path -LiteralPath $cleanupPlan) -or (Test-Path -LiteralPath $cleanupMetadata)) {
    throw "Unexpected-exit-two cleanup retained a newly-created migration baseline artifact."
  }
} finally {
  if (Test-Path -LiteralPath $handoffRoot) { Remove-Item -LiteralPath $handoffRoot -Recurse -Force }
}

$missingVariablePlan = $retainedPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$missingVariablePlan.variables.PSObject.Properties.Remove(@(Get-DeclaredVariableNames)[0])
$missingVariableRejected = $false
try { Assert-RetainedMigrationBaselinePlan -Plan $missingVariablePlan }
catch { $missingVariableRejected = $true }
if (-not $missingVariableRejected) { throw "The retained migration baseline accepted a stale variable set." }

$historicalPublicJobPlan = $retainedPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$publicJobCompatibilityVariables = @(
  "deploy_public_job_reader",
  "public_job_database_boundary_version",
  "public_job_cluster_residual_accepted",
  "public_job_lambda_artifact_s3_key",
  "public_job_lambda_artifact_s3_object_version",
  "public_job_lambda_artifact_sha256",
  "public_job_lambda_artifact_base64sha256",
  "public_job_projection_artifact_s3_key",
  "public_job_projection_artifact_s3_object_version",
  "public_job_projection_artifact_sha256",
  "public_job_projection_artifact_base64sha256",
  "public_job_route_throttling_rate_limit",
  "public_job_route_throttling_burst_limit"
)
foreach ($name in $publicJobCompatibilityVariables) {
  $historicalPublicJobPlan.variables.PSObject.Properties.Remove($name)
}
Assert-RetainedMigrationBaselinePlan -Plan $historicalPublicJobPlan -AllowCompatibilityDefaults

$unapprovedHistoricalPlan = $historicalPublicJobPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unapprovedHistoricalPlan.variables.PSObject.Properties.Remove("migration_image")
$unapprovedHistoricalRejected = $false
try {
  Assert-RetainedMigrationBaselinePlan -Plan $unapprovedHistoricalPlan -AllowCompatibilityDefaults
} catch { $unapprovedHistoricalRejected = $true }
if (-not $unapprovedHistoricalRejected) {
  throw "The retained migration baseline accepted a missing variable outside the exact compatibility set."
}

$stateMismatchRejected = $false
try {
  Assert-RetainedBaselineCurrentState `
    -Metadata ([pscustomobject]@{ StateLineage = $retainedState.Lineage; StateSerial = 50 }) `
    -State $retainedState
} catch { $stateMismatchRejected = $true }
if (-not $stateMismatchRejected) { throw "PlanTask accepted a retained baseline from a stale state serial." }

$staleBaselineMetadata = [pscustomobject]@{
  StateLineage = "472ef790-b249-45ec-817f-718005980d9e"
  StateSerial = 107
}
$currentPlanningState = [pscustomobject]@{
  Lineage = $staleBaselineMetadata.StateLineage
  Serial = 108
}
Assert-RetainedBaselinePlanningState -Metadata $staleBaselineMetadata `
  -State $currentPlanningState -AllowExactCompleteDark107To108
$schemaFiveState = [pscustomobject]@{ Lineage = $retainedState.Lineage; Serial = 200 }
Assert-RetainedBaselinePlanningState `
  -Metadata ([pscustomobject]@{ StateLineage = $retainedState.Lineage; StateSerial = 199 }) `
  -State $schemaFiveState -AllowSchemaFiveOneSerialAdvance
foreach ($stateCase in @(
    @{ metadata = [pscustomobject]@{ StateLineage = $retainedState.Lineage; StateSerial = 198 }; state = $schemaFiveState },
    @{ metadata = [pscustomobject]@{ StateLineage = "87654321-4321-4321-4321-cba987654321"; StateSerial = 199 }; state = $schemaFiveState }
  )) {
  $rejected = $false
  try {
    Assert-RetainedBaselinePlanningState -Metadata $stateCase.metadata -State $stateCase.state `
      -AllowSchemaFiveOneSerialAdvance
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The schema-5 state handoff accepted an unsafe serial or lineage." }
}
foreach ($stateCase in @(
    @{ metadata = $staleBaselineMetadata; state = $currentPlanningState; allow = $false },
    @{ metadata = [pscustomobject]@{ StateLineage = $staleBaselineMetadata.StateLineage; StateSerial = 106 }; state = $currentPlanningState; allow = $true },
    @{ metadata = $staleBaselineMetadata; state = [pscustomobject]@{ Lineage = $staleBaselineMetadata.StateLineage; Serial = 109 }; allow = $true },
    @{ metadata = $staleBaselineMetadata; state = [pscustomobject]@{ Lineage = "87654321-4321-4321-4321-cba987654321"; Serial = 108 }; allow = $true }
  )) {
  $rejected = $false
  try {
    Assert-RetainedBaselinePlanningState -Metadata $stateCase.metadata -State $stateCase.state `
      -AllowExactCompleteDark107To108:$stateCase.allow
  } catch { $rejected = $true }
  if (-not $rejected) { throw "An unsafe retained-baseline planning-state transition was accepted." }
}
Assert-ExactTerraformStateIdentity -Expected $currentPlanningState -Actual $currentPlanningState
$planningDriftRejected = $false
try {
  Assert-ExactTerraformStateIdentity -Expected $currentPlanningState `
    -Actual ([pscustomobject]@{ Lineage = $currentPlanningState.Lineage; Serial = 109 })
} catch { $planningDriftRejected = $true }
if (-not $planningDriftRejected) { throw "ApplyTask accepted state drift after planning identity was bound." }

$exactStaleHandoff = @{
  Schema = "3"; Stage = "complete-dark"
  BaselineOperatorSha = "9d290416c61847f1682157c08312cdb920d42107"
  PlanSha256 = "2143c836f9c55d2126efef55b314f167b35d593d64338791cb6c3837c6e2a6a4"
  MetadataSha256 = "e0efc63e7c17685e363e23f15f7f1d39e83c46beff3f08fdb768bd67e78b8011"
  Metadata = $staleBaselineMetadata
}
if (-not (Test-ExactCompleteDarkStaleStateHandoff @exactStaleHandoff)) {
  throw "The exact retained CompleteDark serial-107 handoff was not recognized."
}
foreach ($handoffMutation in @(
    @{ Name = "Schema"; Value = "4" },
    @{ Name = "Stage"; Value = "parser-dark" },
    @{ Name = "BaselineOperatorSha"; Value = "8" * 40 },
    @{ Name = "PlanSha256"; Value = "a" * 64 },
    @{ Name = "MetadataSha256"; Value = "b" * 64 },
    @{ Name = "Metadata"; Value = [pscustomobject]@{ StateLineage = "87654321-4321-4321-4321-cba987654321"; StateSerial = 107 } },
    @{ Name = "Metadata"; Value = [pscustomobject]@{ StateLineage = $staleBaselineMetadata.StateLineage; StateSerial = 106 } }
  )) {
  $mutatedHandoff = @{} + $exactStaleHandoff
  $mutatedHandoff[$handoffMutation.Name] = $handoffMutation.Value
  if (Test-ExactCompleteDarkStaleStateHandoff @mutatedHandoff) {
    throw "The one-shot stale-state handoff accepted a wrong $($handoffMutation.Name)."
  }
}

$retainedRoot = Join-Path $terraformRoot "retained-baseline-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $retainedRoot
try {
  $retainedPath = Join-Path $retainedRoot "parser-dark.tfplan"
  [IO.File]::WriteAllText($retainedPath, "verified-plan", [Text.UTF8Encoding]::new($false))
  $retainedSha = (Get-FileHash -LiteralPath $retainedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecarPath = "$retainedPath.baseline.json"
  $sidecar = [ordered]@{
    SchemaVersion = "1"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
    AccountId = $ExpectedAccountId; Region = $Region; SourceSha = $SourceSha
    StateLineage = $retainedState.Lineage; StateSerial = $retainedState.Serial; Stage = "parser-dark"
    ReceiptSha256 = "b" * 64; ParserQualifiedArn = ""; PlanPath = $retainedPath
    PlanSha256 = $retainedSha; Applyable = $false; MeaningfulChanges = 0
    CreatedAt = "2026-08-13T20:00:00.0000000Z"
  }
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $sidecarSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  function Get-PlanJson([string]$Path, [switch]$AllowHistorical) { return $script:retainedPlanFixture }
  function Get-CurrentTerraformStateIdentity { return $script:retainedStateFixture }
  $script:retainedPlanFixture = $retainedPlan
  $script:retainedStateFixture = $retainedState

  $evidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
    -MetadataSha256 $sidecarSha -RequireCurrentState
  if ([string]$evidence.Metadata.Stage -cne "parser-dark" -or
    [string]$evidence.Metadata.StateLineage -cne [string]$retainedState.Lineage -or
    [long]$evidence.Metadata.StateSerial -ne [long]$retainedState.Serial -or
    [string]$evidence.MetadataSha256 -cne (Get-FileSha256 $sidecarPath)) {
    throw "PlanTask did not accept and bind the exact current retained-baseline handoff."
  }

  $sidecarChecksumRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 ("c" * 64)
  }
  catch { $sidecarChecksumRejected = $true }
  if (-not $sidecarChecksumRejected) { throw "PlanTask accepted a mismatched retained-sidecar checksum." }

  $sidecar.ReceiptSha256 = "d" * 64
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $receiptTamperRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $sidecarSha
  }
  catch { $receiptTamperRejected = $true }
  if (-not $receiptTamperRejected) { throw "PlanTask accepted a tampered receipt under the reviewed sidecar checksum." }

  $sidecar.ReceiptSha256 = "b" * 64
  $sidecar.Stage = "complete-dark"
  $sidecar.ParserQualifiedArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7"
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $relabelSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $stageRelabelRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $relabelSha
  }
  catch { $stageRelabelRejected = $true }
  if (-not $stageRelabelRejected) { throw "PlanTask accepted a parser-dark plan relabeled complete-dark." }

  $sidecar.Stage = "parser-dark"
  $sidecar.ParserQualifiedArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:8"
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $parserSubstitutionSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $parserSubstitutionRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $parserSubstitutionSha
  }
  catch { $parserSubstitutionRejected = $true }
  if (-not $parserSubstitutionRejected) { throw "PlanTask accepted a substituted parser ARN for parser-dark." }

  $sidecar.ParserQualifiedArn = ""
  $sidecar.PlanSha256 = "c" * 64
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $sidecarMismatchSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecarMismatchRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $sidecarMismatchSha
  }
  catch { $sidecarMismatchRejected = $true }
  if (-not $sidecarMismatchRejected) { throw "PlanTask accepted a retained sidecar with a mismatched plan hash." }

  $sidecar.PlanSha256 = $retainedSha
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $currentSidecarSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:retainedStateFixture = [pscustomobject]@{ Lineage = $retainedState.Lineage; Serial = 52 }
  $currentStateMismatchRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $currentSidecarSha -RequireCurrentState
  }
  catch { $currentStateMismatchRejected = $true }
  if (-not $currentStateMismatchRejected) { throw "PlanTask accepted a retained sidecar from a changed current state." }

  $planningState = [pscustomobject]@{ Lineage = $retainedState.Lineage; Serial = $retainedState.Serial }
  $script:retainedStateFixture = $planningState
  $ancestorPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $ancestorPlan.variables.document_processing_deployment_stage.value = "complete-dark"
  $ancestorPlan.variables.document_parser_invocation_qualified_arn.value =
    "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7"
  $retainedMigrationImage = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('d' * 64)"
  $ancestorPlan.variables.migration_image.value = $retainedMigrationImage
  $baselineOperatorSha = "8" * 40
  $currentOperatorSha = "9" * 40
  $operatorSourceSha = $currentOperatorSha
  $fullRecords = @(
    "M`tscripts/operate-development-document-migration.ps1",
    "M`tscripts/tests/development-document-migration-operator.tests.ps1"
  )
  $fullPatch = @("fixture complete-dark patch")
  $reviewedBaselineDelta = Get-TextSha256 ("development-operator-delta-v1`n$baselineOperatorSha`n$currentOperatorSha`n--name-status--`n" +
    (($fullRecords -join "`n") + "`n--patch--`n" + ($fullPatch -join "`n") + "`n"))
  $ancestorSidecar = [ordered]@{
    SchemaVersion = "4"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
    AccountId = $ExpectedAccountId; Region = $Region; ReleaseSourceSha = $baselineOperatorSha
    OperatorSourceSha = $baselineOperatorSha
    OperatorDeltaSha256 = Get-TextSha256 "development-operator-delta-v1`n$baselineOperatorSha`n$baselineOperatorSha`n--name-status--`n--patch--`n"
    StateLineage = $retainedState.Lineage; StateSerial = $retainedState.Serial; Stage = "complete-dark"
    ReceiptSha256 = "b" * 64
    ParserQualifiedArn = $ancestorPlan.variables.document_parser_invocation_qualified_arn.value
    MigrationImage = $retainedMigrationImage; PlanPath = $retainedPath; PlanSha256 = $retainedSha
    Applyable = $false; MeaningfulChanges = 0; CreatedAt = "2026-08-15T20:00:00.0000000Z"
  }
  function Get-PlanJson([string]$Path, [switch]$AllowHistorical) { return $script:ancestorPlanFixture }
  $script:ancestorPlanFixture = $ancestorPlan
  $script:ancestorGitMode = "valid"
  function git {
    $arguments = @($args)
    if ($arguments -contains "merge-base") { $global:LASTEXITCODE = if ($script:ancestorGitMode -ceq "nonancestor") { 1 } else { 0 }; return }
    if ($arguments -contains "--name-status") { $global:LASTEXITCODE = 0; return $script:ancestorRecordsFixture }
    if ($arguments -contains "--numstat") {
      $global:LASTEXITCODE = 0
      if ($script:ancestorGitMode -ceq "bootstrap-binary") {
        return @("-`t-`tscripts/operate-development-document-migration.ps1", "-`t-`tscripts/tests/development-document-migration-operator.tests.ps1")
      }
      return @("1`t1`tscripts/operate-development-document-migration.ps1", "1`t0`tscripts/tests/development-document-migration-operator.tests.ps1")
    }
    if ($arguments -contains "ls-tree") {
      $script:ancestorLsTreeCalls += ,@($arguments)
      $global:LASTEXITCODE = 0
      return "100644 blob $('a' * 40)`tfixture"
    }
    if ($arguments -contains "cat-file") { $global:LASTEXITCODE = 0; return "blob" }
    if ($arguments -contains "--full-index") { $global:LASTEXITCODE = 0; return $script:ancestorPatchFixture }
    $global:LASTEXITCODE = 1
    throw "Unexpected retained-ancestor mocked Git invocation: $($arguments -join ' ')"
  }
  $script:ancestorRecordsFixture = $fullRecords
  $script:ancestorPatchFixture = $fullPatch
  $script:ancestorLsTreeCalls = @()
  try {
    [IO.File]::WriteAllText($sidecarPath, ($ancestorSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $ancestorSidecarSha = Get-FileSha256 -Path $sidecarPath
    $ancestorEvidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $ancestorSidecarSha `
      -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta -RequireCurrentState
    if ([string]$ancestorEvidence.ReleaseSourceSha -cne $baselineOperatorSha -or
        [string]$ancestorEvidence.OperatorSourceSha -cne $baselineOperatorSha -or
        [string]$ancestorEvidence.CurrentOperatorSourceSha -cne $currentOperatorSha -or
        [string]$ancestorEvidence.BaselineToCurrentDeltaSha256 -cne $reviewedBaselineDelta -or
        [long]$ancestorEvidence.PlanningState.Serial -ne [long]$retainedState.Serial -or
        [string]$ancestorEvidence.Metadata.MigrationImage -ceq $MigrationImage -or
        [string]$ancestorEvidence.Metadata.Stage -cne "complete-dark") {
      throw "The reviewed ancestor CompleteDark baseline-to-current handoff was not preserved."
    }

    foreach ($reviewed in @("", ("0" * 64))) {
      $rejected = $false
      try {
        $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
          -MetadataSha256 $ancestorSidecarSha -ReviewedBaselineToCurrentDeltaSha256 $reviewed
      } catch { $rejected = $true }
      if (-not $rejected) { throw "An ancestor CompleteDark baseline accepted a missing or wrong review hash." }
    }

    $script:ancestorGitMode = "nonancestor"
    $nonancestorRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $ancestorSidecarSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $nonancestorRejected = $true }
    if (-not $nonancestorRejected) { throw "A nonancestor CompleteDark baseline was accepted." }
    $script:ancestorGitMode = "valid"

    $parserAncestorSidecar = $ancestorSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $parserAncestorSidecar.Stage = "parser-dark"
    $parserAncestorSidecar.ParserQualifiedArn = ""
    $ancestorPlan.variables.document_processing_deployment_stage.value = "parser-dark"
    $ancestorPlan.variables.document_parser_invocation_qualified_arn.value = ""
    [IO.File]::WriteAllText($sidecarPath, ($parserAncestorSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $parserAncestorSha = Get-FileSha256 -Path $sidecarPath
    $parserAncestorRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $parserAncestorSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $parserAncestorRejected = $true }
    if (-not $parserAncestorRejected) { throw "An ancestor ParserDark baseline crossed an operator revision." }

    $ancestorPlan.variables.document_processing_deployment_stage.value = "complete-dark"
    $ancestorPlan.variables.document_parser_invocation_qualified_arn.value = $ancestorSidecar.ParserQualifiedArn
    $tamperedSidecar = $ancestorSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $tamperedSidecar.OperatorDeltaSha256 = "f" * 64
    [IO.File]::WriteAllText($sidecarPath, ($tamperedSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $tamperedSidecarSha = Get-FileSha256 -Path $sidecarPath
    $metadataTamperRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $tamperedSidecarSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $metadataTamperRejected = $true }
    if (-not $metadataTamperRejected) { throw "A retained CompleteDark baseline with a tampered stored delta was accepted." }

    $tamperedImageSidecar = $ancestorSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $tamperedImageSidecar.MigrationImage = $MigrationImage
    [IO.File]::WriteAllText($sidecarPath, ($tamperedImageSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $tamperedImageSha = Get-FileSha256 -Path $sidecarPath
    $imageTamperRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $tamperedImageSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $imageTamperRejected = $true }
    if (-not $imageTamperRejected) { throw "A schema-4 baseline metadata image not matching its retained plan was accepted." }

    $taskBinding = [pscustomobject]@{
      appliedPlanPath = $ancestorEvidence.PlanPath; appliedPlanSha256 = $ancestorEvidence.PlanSha256
      appliedBaselineMetadataPath = $ancestorEvidence.MetadataPath
      appliedBaselineMetadataSha256 = $ancestorEvidence.MetadataSha256
      appliedBaselineStage = $ancestorEvidence.Metadata.Stage
      appliedBaselineStateLineage = $ancestorEvidence.Metadata.StateLineage
      appliedBaselineStateSerial = $ancestorEvidence.Metadata.StateSerial
      appliedBaselineReceiptSha256 = $ancestorEvidence.Metadata.ReceiptSha256
      appliedBaselineParserQualifiedArn = $ancestorEvidence.Metadata.ParserQualifiedArn
      appliedBaselineReleaseSourceSha = $ancestorEvidence.ReleaseSourceSha
      appliedBaselineOperatorSourceSha = $ancestorEvidence.OperatorSourceSha
      appliedBaselineOperatorDeltaSha256 = $ancestorEvidence.OperatorDeltaSha256
      appliedBaselineCurrentOperatorSourceSha = $ancestorEvidence.CurrentOperatorSourceSha
      appliedBaselineToCurrentDeltaSha256 = $ancestorEvidence.BaselineToCurrentDeltaSha256
      planningStateLineage = $ancestorEvidence.PlanningState.Lineage
      planningStateSerial = $ancestorEvidence.PlanningState.Serial
    }
    Assert-TaskMetadataBaselineBinding -TaskMetadata $taskBinding -Baseline $ancestorEvidence
    foreach ($property in @("appliedBaselineCurrentOperatorSourceSha", "appliedBaselineToCurrentDeltaSha256")) {
      $tamperedBinding = $taskBinding | ConvertTo-Json -Depth 20 | ConvertFrom-Json
      $tamperedBinding.($property) = if ($property -match "SourceSha$") { "7" * 40 } else { "7" * 64 }
      $bindingRejected = $false
      try { Assert-TaskMetadataBaselineBinding -TaskMetadata $tamperedBinding -Baseline $ancestorEvidence } catch { $bindingRejected = $true }
      if (-not $bindingRejected) { throw "ApplyTask accepted tampered task metadata '$property'." }
    }

    $currentSidecar = $ancestorSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $currentSidecar.ReleaseSourceSha = $currentOperatorSha
    $currentSidecar.OperatorSourceSha = $currentOperatorSha
    $currentSidecar.OperatorDeltaSha256 = Get-TextSha256 "development-operator-delta-v1`n$currentOperatorSha`n$currentOperatorSha`n--name-status--`n--patch--`n"
    $currentSidecar.StateSerial = $planningState.Serial
    [IO.File]::WriteAllText($sidecarPath, ($currentSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $currentSchema4Sha = Get-FileSha256 -Path $sidecarPath
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $currentSchema4Sha -RequireCurrentState
    $extraCurrentReviewRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $currentSchema4Sha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $extraCurrentReviewRejected = $true }
    if (-not $extraCurrentReviewRejected) { throw "An exact-current schema-4 baseline accepted an unnecessary review hash." }

    $documentReleaseSha = "7" * 40
    $migrationReleaseSha = "a" * 40
    $deltaPayload = {
      param([string]$From, [string]$To)
      Get-TextSha256 ("development-operator-delta-v1`n$From`n$To`n--name-status--`n" +
        (($fullRecords -join "`n") + "`n--patch--`n" + ($fullPatch -join "`n") + "`n"))
    }
    $schemaFiveSidecar = [ordered]@{
      SchemaVersion = "5"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
      AccountId = $ExpectedAccountId; Region = $Region
      DocumentReleaseSourceSha = $documentReleaseSha; DocumentOperatorSourceSha = $baselineOperatorSha
      DocumentOperatorDeltaSha256 = & $deltaPayload $documentReleaseSha $baselineOperatorSha
      ReleaseSourceSha = $migrationReleaseSha
      BaselineToReleaseDeltaSha256 = & $deltaPayload $baselineOperatorSha $migrationReleaseSha
      OperatorSourceSha = $currentOperatorSha
      OperatorDeltaSha256 = & $deltaPayload $migrationReleaseSha $currentOperatorSha
      StateLineage = $retainedState.Lineage; StateSerial = $retainedState.Serial; Stage = "complete-dark"
      ReceiptSha256 = "b" * 64; ParserQualifiedArn = $ancestorSidecar.ParserQualifiedArn
      MigrationImage = $retainedMigrationImage; PlanPath = $retainedPath; PlanSha256 = $retainedSha
      Applyable = $false; MeaningfulChanges = 0; CreatedAt = "2026-08-22T20:00:00.0000000Z"
    }
    [IO.File]::WriteAllText($sidecarPath, ($schemaFiveSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $schemaFiveSidecarSha = Get-FileSha256 -Path $sidecarPath
    $script:retainedStateFixture = [pscustomobject]@{
      Lineage = $retainedState.Lineage
      Serial = [long]$retainedState.Serial + 1
    }
    $schemaFiveEvidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath `
      -PlanSha256 $retainedSha -MetadataSha256 $schemaFiveSidecarSha `
      -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta -RequireCurrentState
    if ([string]$schemaFiveEvidence.ReleaseSourceSha -cne $documentReleaseSha -or
        [string]$schemaFiveEvidence.OperatorSourceSha -cne $baselineOperatorSha -or
        [string]$schemaFiveEvidence.OperatorDeltaSha256 -cne [string]$schemaFiveSidecar.DocumentOperatorDeltaSha256 -or
        [string]$schemaFiveEvidence.CurrentOperatorSourceSha -cne $currentOperatorSha -or
        [string]$schemaFiveEvidence.BaselineToCurrentDeltaSha256 -cne $reviewedBaselineDelta -or
        [long]$schemaFiveEvidence.PlanningState.Serial -ne ([long]$retainedState.Serial + 1)) {
      throw "The schema-5 baseline did not preserve and project its full reviewed handoff."
    }
    $schemaFiveMissingReviewRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $schemaFiveSidecarSha -RequireCurrentState
    } catch { $schemaFiveMissingReviewRejected = $true }
    if (-not $schemaFiveMissingReviewRejected) { throw "A schema-5 baseline accepted a missing full-delta review." }

    $tamperedSchemaFive = $schemaFiveSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $tamperedSchemaFive.BaselineToReleaseDeltaSha256 = "f" * 64
    [IO.File]::WriteAllText($sidecarPath, ($tamperedSchemaFive | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $tamperedSchemaFiveSha = Get-FileSha256 -Path $sidecarPath
    $schemaFiveChainRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $tamperedSchemaFiveSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta -RequireCurrentState
    } catch { $schemaFiveChainRejected = $true }
    if (-not $schemaFiveChainRejected) { throw "A schema-5 baseline accepted a tampered intermediate release delta." }

    [IO.File]::WriteAllText($sidecarPath, ($schemaFiveSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $script:retainedStateFixture.Serial = [long]$retainedState.Serial + 2
    $schemaFiveSerialRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $schemaFiveSidecarSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta -RequireCurrentState
    } catch { $schemaFiveSerialRejected = $true }
    if (-not $schemaFiveSerialRejected) { throw "A schema-5 baseline accepted more than one state-serial advance." }

    $script:retainedStateFixture = [pscustomobject]@{
      Lineage = $retainedState.Lineage
      Serial = [long]$retainedState.Serial
    }
    $schemaSixReleaseSha = $documentReleaseSha
    $schemaSixOperatorSha = $currentOperatorSha
    $schemaSixPriorOperatorSha = $baselineOperatorSha
    $script:ancestorLsTreeCalls = @()
    $schemaSixOperatorDelta = Get-DocumentBootstrapDeltaSha256 `
      -ReleaseSha $schemaSixReleaseSha -OperatorSha $schemaSixOperatorSha
    if ($script:ancestorLsTreeCalls.Count -ne 4) {
      throw "The schema-6 bootstrap consumer did not authenticate each modified path at both commits."
    }
    $script:ancestorGitMode = "bootstrap-binary"
    $binaryBootstrapDelta = Get-DocumentBootstrapDeltaSha256 `
      -ReleaseSha $schemaSixReleaseSha -OperatorSha $schemaSixOperatorSha
    $expectedBinaryBootstrapDelta = Get-TextSha256 (
      "development-document-complete-dark-bootstrap-delta-v1`n$schemaSixReleaseSha`n$schemaSixOperatorSha`n--name-status--`n" +
      (($fullRecords -join "`n") + "`n--patch--`n" + ($fullPatch -join "`n") + "`n")
    )
    if ($binaryBootstrapDelta -cne $expectedBinaryBootstrapDelta) {
      throw "The schema-6 consumer diverged from the producer's bootstrap binary-delta algorithm."
    }
    $script:ancestorGitMode = "valid"
    $schemaSixSidecar = [ordered]@{
      SchemaVersion = "6"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
      AccountId = $ExpectedAccountId; Region = $Region
      DeltaKind = "complete-dark-bootstrap-full-source-v1"
      ReleaseSourceSha = $schemaSixReleaseSha; OperatorSourceSha = $schemaSixOperatorSha
      OperatorDeltaSha256 = $schemaSixOperatorDelta
      PriorBaselinePlanSha256 = "1" * 64; PriorBaselineMetadataSha256 = "2" * 64
      CurrentTemplatePlanSha256 = "3" * 64; CurrentTemplateReceiptSha256 = "4" * 64
      PriorBaselineSchemaVersion = "5"; PriorBaselineStateSerial = [long]$retainedState.Serial - 1
      PriorBaselineOperatorSourceSha = $schemaSixPriorOperatorSha
      PriorBaselineToOperatorDeltaSha256 = Get-DocumentBootstrapDeltaSha256 `
        -ReleaseSha $schemaSixPriorOperatorSha -OperatorSha $schemaSixOperatorSha
      StateLineage = $retainedState.Lineage; StateSerial = $retainedState.Serial; Stage = "complete-dark"
      ReceiptSha256 = "b" * 64; ParserQualifiedArn = $ancestorSidecar.ParserQualifiedArn
      MigrationImage = $retainedMigrationImage; PlanPath = $retainedPath; PlanSha256 = $retainedSha
      Applyable = $false; MeaningfulChanges = 0; CreatedAt = "2026-08-27T02:14:53.4890234Z"
    }
    [IO.File]::WriteAllText($sidecarPath, ($schemaSixSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $schemaSixSidecarSha = Get-FileSha256 -Path $sidecarPath
    $operatorSourceSha = $schemaSixOperatorSha
    $schemaSixEvidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath `
      -PlanSha256 $retainedSha -MetadataSha256 $schemaSixSidecarSha -RequireCurrentState
    $normalizedSchemaSixDelta = Get-DocumentOperatorDeltaSha256 `
      -ReleaseSha $schemaSixOperatorSha -OperatorSha $schemaSixOperatorSha
    if ([string]$schemaSixEvidence.ReleaseSourceSha -cne $schemaSixOperatorSha -or
        [string]$schemaSixEvidence.OperatorSourceSha -cne $schemaSixOperatorSha -or
        [string]$schemaSixEvidence.OperatorDeltaSha256 -cne $normalizedSchemaSixDelta -or
        [string]$schemaSixEvidence.CurrentOperatorSourceSha -cne $schemaSixOperatorSha -or
        [string]$schemaSixEvidence.Metadata.DeltaKind -cne "complete-dark-bootstrap-full-source-v1" -or
        [long]$schemaSixEvidence.PlanningState.Serial -ne [long]$retainedState.Serial) {
      throw "The exact-current schema-6 bootstrap baseline was not authenticated and normalized."
    }
    $schemaSixExtraReviewRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $schemaSixSidecarSha `
        -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta
    } catch { $schemaSixExtraReviewRejected = $true }
    if (-not $schemaSixExtraReviewRejected) {
      throw "An exact-current schema-6 baseline accepted an unnecessary baseline review."
    }

    $ancestorSchemaSix = $schemaSixSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $ancestorSchemaSix.OperatorSourceSha = $baselineOperatorSha
    $ancestorSchemaSix.OperatorDeltaSha256 = Get-DocumentBootstrapDeltaSha256 `
      -ReleaseSha $schemaSixReleaseSha -OperatorSha $baselineOperatorSha
    $ancestorSchemaSix.PriorBaselineOperatorSourceSha = $schemaSixReleaseSha
    $ancestorSchemaSix.PriorBaselineToOperatorDeltaSha256 = Get-DocumentBootstrapDeltaSha256 `
      -ReleaseSha $schemaSixReleaseSha -OperatorSha $baselineOperatorSha
    [IO.File]::WriteAllText($sidecarPath, ($ancestorSchemaSix | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $ancestorSchemaSixSha = Get-FileSha256 -Path $sidecarPath
    $operatorSourceSha = $currentOperatorSha
    $ancestorSchemaSixEvidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath `
      -PlanSha256 $retainedSha -MetadataSha256 $ancestorSchemaSixSha `
      -ReviewedBaselineToCurrentDeltaSha256 $reviewedBaselineDelta -RequireCurrentState
    if ([string]$ancestorSchemaSixEvidence.ReleaseSourceSha -cne $baselineOperatorSha -or
        [string]$ancestorSchemaSixEvidence.OperatorSourceSha -cne $baselineOperatorSha -or
        [string]$ancestorSchemaSixEvidence.OperatorDeltaSha256 -cne
          (Get-DocumentOperatorDeltaSha256 -ReleaseSha $baselineOperatorSha -OperatorSha $baselineOperatorSha) -or
        [string]$ancestorSchemaSixEvidence.BaselineToCurrentDeltaSha256 -cne $reviewedBaselineDelta) {
      throw "The ancestor schema-6 bootstrap baseline was not normalized through the reviewed current handoff."
    }
    $schemaSixMissingReviewRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $ancestorSchemaSixSha -RequireCurrentState
    } catch { $schemaSixMissingReviewRejected = $true }
    if (-not $schemaSixMissingReviewRejected) {
      throw "An ancestor schema-6 baseline accepted a missing baseline-to-current review."
    }

    $operatorSourceSha = $schemaSixOperatorSha
    $schemaSixMutationCases = @(
      @{ Name = "delta kind"; Mutate = { param($v) $v.DeltaKind = "other" } },
      @{ Name = "bootstrap delta"; Mutate = { param($v) $v.OperatorDeltaSha256 = "f" * 64 } },
      @{ Name = "prior bootstrap delta"; Mutate = { param($v) $v.PriorBaselineToOperatorDeltaSha256 = "f" * 64 } },
      @{ Name = "prior schema"; Mutate = { param($v) $v.PriorBaselineSchemaVersion = "2" } },
      @{ Name = "prior serial"; Mutate = { param($v) $v.PriorBaselineStateSerial = $v.StateSerial } },
      @{ Name = "prior plan checksum"; Mutate = { param($v) $v.PriorBaselinePlanSha256 = "invalid" } },
      @{ Name = "prior metadata checksum"; Mutate = { param($v) $v.PriorBaselineMetadataSha256 = "invalid" } },
      @{ Name = "template plan checksum"; Mutate = { param($v) $v.CurrentTemplatePlanSha256 = "invalid" } },
      @{ Name = "template receipt checksum"; Mutate = { param($v) $v.CurrentTemplateReceiptSha256 = "invalid" } },
      @{ Name = "stage"; Mutate = { param($v) $v.Stage = "parser-dark"; $v.ParserQualifiedArn = "" } },
      @{ Name = "migration image"; Mutate = { param($v) $v.MigrationImage = $MigrationImage } },
      @{ Name = "release identity"; Mutate = { param($v) $v.ReleaseSourceSha = "invalid" } },
      @{ Name = "missing field"; Mutate = { param($v) $v.PSObject.Properties.Remove("DeltaKind") } },
      @{ Name = "extra field"; Mutate = { param($v) $v | Add-Member unexpected $true } }
    )
    foreach ($case in $schemaSixMutationCases) {
      $mutatedSchemaSix = $schemaSixSidecar | ConvertTo-Json -Depth 20 | ConvertFrom-Json
      & $case.Mutate $mutatedSchemaSix
      [IO.File]::WriteAllText($sidecarPath, ($mutatedSchemaSix | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
      $mutatedSchemaSixSha = Get-FileSha256 -Path $sidecarPath
      $mutationRejected = $false
      try {
        $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
          -MetadataSha256 $mutatedSchemaSixSha -RequireCurrentState
      } catch { $mutationRejected = $true }
      if (-not $mutationRejected) { throw "A schema-6 baseline accepted a wrong $($case.Name)." }
    }

    [IO.File]::WriteAllText($sidecarPath, ($schemaSixSidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $script:retainedStateFixture = [pscustomobject]@{
      Lineage = $retainedState.Lineage
      Serial = [long]$retainedState.Serial + 1
    }
    $schemaSixStateAdvanceRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $schemaSixSidecarSha -RequireCurrentState
    } catch { $schemaSixStateAdvanceRejected = $true }
    if (-not $schemaSixStateAdvanceRejected) {
      throw "A schema-6 bootstrap baseline accepted a state-serial advance."
    }
    $script:retainedStateFixture = $retainedState

    $script:ancestorGitMode = "nonancestor"
    $schemaSixNonancestorRejected = $false
    try {
      $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
        -MetadataSha256 $schemaSixSidecarSha
    } catch { $schemaSixNonancestorRejected = $true }
    if (-not $schemaSixNonancestorRejected) {
      throw "A schema-6 bootstrap baseline accepted a nonancestor source chain."
    }
    $script:ancestorGitMode = "valid"
  } finally {
    Remove-Item -LiteralPath Function:\git -Force
    Remove-Variable -Name ancestorGitMode -Scope Script -ErrorAction SilentlyContinue
    Remove-Variable -Name ancestorRecordsFixture -Scope Script -ErrorAction SilentlyContinue
    Remove-Variable -Name ancestorPatchFixture -Scope Script -ErrorAction SilentlyContinue
    Remove-Variable -Name ancestorLsTreeCalls -Scope Script -ErrorAction SilentlyContinue
    Remove-Variable -Name ancestorPlanFixture -Scope Script -ErrorAction SilentlyContinue
  }
}
finally {
  Remove-Item -LiteralPath Function:\git -Force -ErrorAction SilentlyContinue
  Remove-Variable -Name handoffGitRecords -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name handoffGitPatch -Scope Script -ErrorAction SilentlyContinue
  Remove-Item Function:\Get-PlanJson -ErrorAction SilentlyContinue
  Remove-Item Function:\Get-CurrentTerraformStateIdentity -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $retainedRoot) { Remove-Item -LiteralPath $retainedRoot -Recurse -Force }
}

$taskMetadataRoot = Join-Path $operatorRoot "task-metadata-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $taskMetadataRoot
try {
  $taskPlanFixturePath = Join-Path $taskMetadataRoot "task.tfplan"
  $appliedPlanFixturePath = Join-Path $taskMetadataRoot "applied.tfplan"
  $appliedBaselineFixturePath = "$appliedPlanFixturePath.baseline.json"
  [IO.File]::WriteAllText($taskPlanFixturePath, "task-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($appliedPlanFixturePath, "applied-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($appliedBaselineFixturePath, "applied-baseline", [Text.UTF8Encoding]::new($false))
  $taskPlanFixtureSha = Get-FileSha256 -Path $taskPlanFixturePath
  $taskMetadataFixture = [ordered]@{
    schemaVersion = 2; kind = "development-document-migration-task"; environment = "development"
    region = $Region; accountId = $ExpectedAccountId; stateBucket = "fixture-state-bucket"
    sourceSha = $SourceSha; migrationImage = $MigrationImage
    appliedPlanPath = $appliedPlanFixturePath
    appliedPlanSha256 = Get-FileSha256 -Path $appliedPlanFixturePath
    appliedBaselineMetadataPath = $appliedBaselineFixturePath
    appliedBaselineMetadataSha256 = Get-FileSha256 -Path $appliedBaselineFixturePath
    appliedBaselineStage = "complete-dark"; appliedBaselineStateLineage = $retainedState.Lineage
    appliedBaselineStateSerial = 107; appliedBaselineReceiptSha256 = "b" * 64
    appliedBaselineParserQualifiedArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7"
    appliedBaselineReleaseSourceSha = "7" * 40; appliedBaselineOperatorSourceSha = "7" * 40
    appliedBaselineOperatorDeltaSha256 = "c" * 64
    appliedBaselineCurrentOperatorSourceSha = "8" * 40
    appliedBaselineToCurrentDeltaSha256 = "d" * 64
    planningStateLineage = $retainedState.Lineage; planningStateSerial = 108
    taskPlanPath = $taskPlanFixturePath; taskPlanSha256 = $taskPlanFixtureSha
    meaningfulChanges = 2; destructiveChanges = 0; createdAt = "2026-08-15T21:00:00.0000000Z"
  }
  $StateBucket = "fixture-state-bucket"
  $taskMetadataFixturePath = "$taskPlanFixturePath.metadata.json"
  [IO.File]::WriteAllText($taskMetadataFixturePath, ($taskMetadataFixture | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $taskMetadataFixtureSha = Get-FileSha256 -Path $taskMetadataFixturePath
  $historicalTaskMetadata = Read-TaskPlanMetadata -PlanPath $taskPlanFixturePath `
    -PlanSha256 $taskPlanFixtureSha -MetadataSha256 $taskMetadataFixtureSha
  if ([string]$historicalTaskMetadata.appliedBaselineCurrentOperatorSourceSha -ceq $operatorSourceSha) {
    throw "The generic task-metadata fixture did not exercise a historical apply-operator binding."
  }

  $tamperedTaskMetadata = $taskMetadataFixture | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $tamperedTaskMetadata.planningStateSerial = 109
  [IO.File]::WriteAllText($taskMetadataFixturePath, ($tamperedTaskMetadata | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $checksumTamperRejected = $false
  try {
    $null = Read-TaskPlanMetadata -PlanPath $taskPlanFixturePath `
      -PlanSha256 $taskPlanFixtureSha -MetadataSha256 $taskMetadataFixtureSha
  } catch { $checksumTamperRejected = $true }
  if (-not $checksumTamperRejected) { throw "A changed task-plan metadata sidecar retained its prior reviewed checksum." }

  $tamperedTaskMetadata | Add-Member -NotePropertyName unexpected -NotePropertyValue $true
  [IO.File]::WriteAllText($taskMetadataFixturePath, ($tamperedTaskMetadata | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $extraFieldSha = Get-FileSha256 -Path $taskMetadataFixturePath
  $extraFieldRejected = $false
  try {
    $null = Read-TaskPlanMetadata -PlanPath $taskPlanFixturePath `
      -PlanSha256 $taskPlanFixtureSha -MetadataSha256 $extraFieldSha
  } catch { $extraFieldRejected = $true }
  if (-not $extraFieldRejected) { throw "Task-plan metadata accepted an unreviewed extra field under a recomputed checksum." }
} finally {
  if (Test-Path -LiteralPath $taskMetadataRoot) { Remove-Item -LiteralPath $taskMetadataRoot -Recurse -Force }
}

$oneItemList = ConvertTo-TerraformEnvironmentValue -Value @("http://localhost:3000")
if ($oneItemList -cne '["http://localhost:3000"]') {
  throw "A one-item Terraform collection was serialized as a scalar."
}

$MigrationImage = "example.invalid/migration@sha256:$('a' * 64)"
$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"
$ingestionActivationGuardAddress = "module.platform.terraform_data.ingestion_activation_guard"
$beforeContainer = [ordered]@{
  name = "database-migration"
  image = "example.invalid/migration@sha256:$('b' * 64)"
  command = @("runner/dist/src/main.js")
  essential = $true
  readonlyRootFilesystem = $true
  environment = @(
    [ordered]@{ name = "NODE_ENV"; value = "production" },
    [ordered]@{ name = "MIGRATION_MODE"; value = "run" }
  )
  logConfiguration = [ordered]@{
    logDriver = "awslogs"
    options = [ordered]@{
      'awslogs-region' = "us-east-2"
      'awslogs-stream-prefix' = "migration"
      'awslogs-group' = "/ai-job-apply/development/migration"
    }
  }
  mountPoints = @()
  portMappings = @()
  systemControls = @()
  volumesFrom = @()
}
$afterContainer = [ordered]@{
  name = "database-migration"
  image = $MigrationImage
  command = @("runner/dist/src/main.js")
  essential = $true
  readonlyRootFilesystem = $true
  environment = @(
    [ordered]@{ name = "NODE_ENV"; value = "production" },
    [ordered]@{ name = "MIGRATION_MODE"; value = "run" }
  )
  logConfiguration = [ordered]@{
    logDriver = "awslogs"
    options = [ordered]@{
      'awslogs-group' = "/ai-job-apply/development/migration"
      'awslogs-region' = "us-east-2"
      'awslogs-stream-prefix' = "migration"
    }
  }
}
$normalizedTaskPlan = [pscustomobject]@{
  terraform_version = "1.16.2"
  complete = $true
  applyable = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = $MigrationImage } }
  planned_values = [pscustomobject]@{ root_module = $driftRoot }
  resource_drift = $fullProviderDrift
  resource_changes = @([pscustomobject]@{
      address = $migrationAddress
      change = [pscustomobject]@{
        actions = @("create", "delete")
        replace_paths = @(, @("container_definitions"))
        before = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$beforeContainer) -Compress -Depth 10
          tags = [pscustomobject]@{}
          enable_fault_injection = $false
          ipc_mode = ""
          pid_mode = ""
          task_role_arn = ""
        }
        after = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$afterContainer) -Compress -Depth 10
          tags = $null
          enable_fault_injection = $false
          ipc_mode = $null
          pid_mode = $null
          task_role_arn = $null
        }
        after_unknown = [pscustomobject]@{
          enable_fault_injection = $false
          ipc_mode = $false
          pid_mode = $false
          task_role_arn = $false
        }
      }
    }, [pscustomobject]@{
      address = $ingestionActivationGuardAddress
      mode = "managed"
      type = "terraform_data"
      name = "ingestion_activation_guard"
      change = [pscustomobject]@{
        actions = @("create")
        replace_paths = $null
        before = $null
        after = [pscustomobject]@{
          input = [pscustomobject]@{ deploy = $false; runtime = $false; synthetic_only = $false }
          triggers_replace = $null
        }
        after_unknown = [pscustomobject]@{ id = $true; input = [pscustomobject]@{}; output = $true }
        before_sensitive = $false
        after_sensitive = [pscustomobject]@{ input = [pscustomobject]@{}; output = [pscustomobject]@{} }
      }
    })
  output_changes = [pscustomobject]@{
    migration_task_definition_arn = [pscustomobject]@{ actions = @("update") }
    ingestion_dead_letter_queue_arn = [pscustomobject]@{
      actions = @("create"); before = $null; after = ""; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
    ingestion_dispatch_queue_arn = [pscustomobject]@{
      actions = @("create"); before = $null; after = ""; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
    ingestion_durable_version_arn = [pscustomobject]@{
      actions = @("create"); before = $null; after = ""; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
    ingestion_runtime_deployed = [pscustomobject]@{
      actions = @("create"); before = $null; after = $false; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
    ingestion_runtime_enabled = [pscustomobject]@{
      actions = @("create"); before = $null; after = $false; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
    ingestion_synthetic_source_enabled = [pscustomobject]@{
      actions = @("create"); before = $null; after = $false; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
  }
}
Assert-ExactTaskPlan -Plan $normalizedTaskPlan
foreach ($invalidVersion in @("1.9.8", "1.16.1", "1.16.3", "1.16.2 ", "")) {
  $versionPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $versionPlan.terraform_version = $invalidVersion
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $versionPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The actionable migration task plan accepted an unapproved Terraform version." }
}
$subsequentTaskPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$subsequentTaskPlan.resource_changes = @($subsequentTaskPlan.resource_changes[0])
foreach ($name in @(
    "ingestion_dead_letter_queue_arn", "ingestion_dispatch_queue_arn", "ingestion_durable_version_arn",
    "ingestion_runtime_deployed", "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled"
  )) {
  $subsequentTaskPlan.output_changes.PSObject.Properties.Remove($name)
}
Assert-ExactTaskPlan -Plan $subsequentTaskPlan
$subsequentChanges = @(Get-MeaningfulChanges -Changes @($subsequentTaskPlan.resource_changes))
if ($subsequentChanges.Count -ne 1 -or [string]$subsequentChanges[0].address -cne $migrationAddress) {
  throw "A subsequent migration task-only release did not preserve its exact change evidence."
}

foreach ($mutation in @(
    "string-value", "boolean-value", "unknown", "sensitive", "action", "before", "missing", "extra"
  )) {
  $outputPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "string-value" { $outputPlan.output_changes.ingestion_dispatch_queue_arn.after = "unexpected" }
    "boolean-value" { $outputPlan.output_changes.ingestion_runtime_enabled.after = $true }
    "unknown" { $outputPlan.output_changes.ingestion_runtime_deployed.after_unknown = $true }
    "sensitive" { $outputPlan.output_changes.ingestion_durable_version_arn.after_sensitive = $true }
    "action" { $outputPlan.output_changes.ingestion_dead_letter_queue_arn.actions = @("update") }
    "before" { $outputPlan.output_changes.ingestion_synthetic_source_enabled.before = $false }
    "missing" { $outputPlan.output_changes.PSObject.Properties.Remove("ingestion_runtime_deployed") }
    "extra" {
      $outputPlan.output_changes | Add-Member -NotePropertyName unexpected_output -NotePropertyValue (
        [pscustomobject]@{ actions = @("create") }
      )
    }
  }
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $outputPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration task plan accepted ingestion-output mutation '$mutation'." }
}

foreach ($mutation in @(
    "deploy", "runtime", "synthetic", "type", "action", "after", "unknown", "sensitive", "replacement"
  )) {
  $guardPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $guard = $guardPlan.resource_changes[1]
  switch ($mutation) {
    "deploy" { $guard.change.after.input.deploy = $true }
    "runtime" { $guard.change.after.input.runtime = $true }
    "synthetic" { $guard.change.after.input.synthetic_only = $true }
    "type" { $guard.type = "aws_lambda_function" }
    "action" { $guard.change.actions = @("update") }
    "after" { $guard.change.after | Add-Member -NotePropertyName unexpected -NotePropertyValue $true }
    "unknown" { $guard.change.after_unknown.output = $false }
    "sensitive" { $guard.change.after_sensitive.output = [pscustomobject]@{ secret = $true } }
    "replacement" { $guard.change.replace_paths = @(, @("input")) }
  }
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $guardPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration task plan accepted ingestion-guard mutation '$mutation'." }
}

foreach ($shape in @("missing", "extra")) {
  $guardPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  if ($shape -ceq "missing") {
    $guardPlan.resource_changes = @($guardPlan.resource_changes[0])
  } else {
    $guardPlan.resource_changes = @($guardPlan.resource_changes) + @(
      [pscustomobject]@{ address = "module.platform.terraform_data.unexpected"; change = [pscustomobject]@{ actions = @("create") } }
    )
  }
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $guardPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration task plan accepted a $shape resource shape." }
}

function Get-TaskPlanContainerFixture {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][ValidateSet("before", "after")][string]$Side
  )

  $json = [string]$Plan.resource_changes[0].change.$Side.container_definitions
  $containers = $json | ConvertFrom-Json
  return @($containers)[0]
}

function Set-TaskPlanContainerFixture {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][ValidateSet("before", "after")][string]$Side,
    [Parameter(Mandatory)][object]$Container
  )

  $Plan.resource_changes[0].change.$Side.container_definitions =
    ConvertTo-Json -InputObject @(,$Container) -Compress -Depth 30
}

$containerTamperCases = @(
  @{ Label = "array reorder"; Mutate = {
      param($container)
      $container.environment = @($container.environment[1], $container.environment[0])
    } },
  @{ Label = "array value"; Mutate = {
      param($container)
      $container.environment[1].value = "tampered"
    } },
  @{ Label = "value type"; Mutate = {
      param($container)
      $container.essential = "true"
    } },
  @{ Label = "key"; Mutate = {
      param($container)
      $region = $container.logConfiguration.options.'awslogs-region'
      $container.logConfiguration.options.PSObject.Properties.Remove('awslogs-region')
      $container.logConfiguration.options | Add-Member -NotePropertyName 'AWSLOGS-REGION' -NotePropertyValue $region
    } },
  @{ Label = "extra key"; Mutate = {
      param($container)
      $container.logConfiguration.options | Add-Member -NotePropertyName 'unexpected' -NotePropertyValue "value"
    } },
  @{ Label = "missing key"; Mutate = {
      param($container)
      $container.logConfiguration.options.PSObject.Properties.Remove('awslogs-group')
    } },
  @{ Label = "image"; Mutate = {
      param($container)
      $container.image = "example.invalid/migration@sha256:$('c' * 64)"
    } },
  @{ Label = "runtime"; Mutate = {
      param($container)
      $container.readonlyRootFilesystem = $false
    } }
)
foreach ($case in $containerTamperCases) {
  $tamperedPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $tamperedContainer = Get-TaskPlanContainerFixture -Plan $tamperedPlan -Side "after"
  & $case.Mutate $tamperedContainer
  Set-TaskPlanContainerFixture -Plan $tamperedPlan -Side "after" -Container $tamperedContainer
  $tamperRejected = $false
  try { Assert-ExactTaskPlan -Plan $tamperedPlan } catch { $tamperRejected = $true }
  if (-not $tamperRejected) {
    throw "The migration task plan accepted a $($case.Label) container-definition tamper."
  }
}

foreach ($mutation in @("duplicate", "unknown", "sensitive")) {
  $badTaskDriftPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" {
      $badTaskDriftPlan.resource_drift = @($badTaskDriftPlan.resource_drift) +
        @($badTaskDriftPlan.resource_drift[0])
    }
    "unknown" { $badTaskDriftPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badTaskDriftPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
  }
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $badTaskDriftPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration task-plan path accepted '$mutation' provider drift." }
}

$omittedKnownFieldsPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
foreach ($field in @("ipc_mode", "pid_mode", "task_role_arn")) {
  $omittedKnownFieldsPlan.resource_changes[0].change.after_unknown.PSObject.Properties.Remove($field)
}
Assert-ExactTaskPlan -Plan $omittedKnownFieldsPlan

$unsafeNormalizationPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeContainer = $unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions | ConvertFrom-Json
$unsafeContainer | Add-Member -NotePropertyName mountPoints `
  -NotePropertyValue @([pscustomobject]@{ sourceVolume = "unexpected" }) -Force
$unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions =
  ConvertTo-Json -InputObject @($unsafeContainer) -Compress -Depth 10
$unsafeNormalizationRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeNormalizationPlan
} catch {
  $unsafeNormalizationRejected = $true
}
if (-not $unsafeNormalizationRejected) {
  throw "A non-empty provider-default container collection was accepted."
}

$unsafeTagsPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeTagsPlan.resource_changes[0].change.before.tags = [pscustomobject]@{ unexpected = "value" }
$unsafeTagsRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeTagsPlan
} catch {
  $unsafeTagsRejected = $true
}
if (-not $unsafeTagsRejected) { throw "A non-empty tag normalization was accepted." }

$unknownFaultPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unknownFaultPlan.resource_changes[0].change.after.enable_fault_injection = $null
$unknownFaultPlan.resource_changes[0].change.after_unknown.enable_fault_injection = $true
$unknownFaultRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unknownFaultPlan
} catch {
  $unknownFaultRejected = $true
}
if (-not $unknownFaultRejected) { throw "Unknown migration fault injection was accepted." }

foreach ($field in @("ipc_mode", "pid_mode", "task_role_arn")) {
  foreach ($unsafeValue in @("unsafe", "unknown")) {
    $unsafeEmptyFieldPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    if ($unsafeValue -ceq "unknown") {
      $unsafeEmptyFieldPlan.resource_changes[0].change.after_unknown.($field) = $true
    } else {
      $unsafeEmptyFieldPlan.resource_changes[0].change.before.($field) = $unsafeValue
    }
    $unsafeEmptyFieldRejected = $false
    try {
      Assert-ExactTaskPlan -Plan $unsafeEmptyFieldPlan
    } catch {
      $unsafeEmptyFieldRejected = $true
    }
    if (-not $unsafeEmptyFieldRejected) {
      throw "Unsafe $field normalization '$unsafeValue' was accepted."
    }
  }
}

$sourceSha = "c" * 40
$artifactSha = "d" * 64
$base64Sha = [Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xdd }))
$bucket = "example-artifacts"
$version = "exact-version"
$kmsArn = "arn:aws:kms:us-east-2:111122223333:key/00000000-0000-0000-0000-000000000000"
$gateway = [pscustomobject]@{
  s3_key = "lambda/gateway/$sourceSha/$artifactSha/gateway-lambda.zip"
  s3_object_version = $version
  source_code_hash = $base64Sha
  s3_bucket = $bucket
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = $artifactSha } })
}
$head = [pscustomobject]@{
  VersionId = $version
  ContentLength = 1
  ServerSideEncryption = "aws:kms"
  SSEKMSKeyId = $kmsArn
  BucketKeyEnabled = $true
  ChecksumSHA256 = $base64Sha
  Metadata = [pscustomobject]@{ 'source-sha' = $sourceSha; 'artifact-sha256' = $artifactSha }
}
$evidence = Assert-CurrentGatewayArtifactEvidence -Gateway $gateway -Head $head `
  -ExpectedBucket $bucket -ExpectedKmsKeyArn $kmsArn
if ($evidence.ArtifactSha256 -cne $artifactSha -or $evidence.ObjectVersion -cne $version) {
  throw "Valid current gateway evidence was not preserved exactly."
}

foreach ($case in @(
    @{ name = "bucket"; target = "gateway"; property = "s3_bucket"; value = "wrong" },
    @{ name = "key"; target = "gateway"; property = "s3_key"; value = "wrong" },
    @{ name = "hash"; target = "gateway"; property = "source_code_hash"; value = "not-base64" },
    @{ name = "decoded-hash"; target = "gateway"; property = "source_code_hash"; value = ([Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xee }))) },
    @{ name = "release"; target = "gateway"; property = "environment"; value = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = "e" * 64 } }) },
    @{ name = "version"; target = "head"; property = "VersionId"; value = "wrong" },
    @{ name = "content"; target = "head"; property = "ContentLength"; value = 0 },
    @{ name = "encryption"; target = "head"; property = "ServerSideEncryption"; value = "AES256" },
    @{ name = "checksum"; target = "head"; property = "ChecksumSHA256"; value = ([Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xee }))) },
    @{ name = "kms"; target = "head"; property = "SSEKMSKeyId"; value = "$kmsArn-wrong" },
    @{ name = "bucket-key"; target = "head"; property = "BucketKeyEnabled"; value = $false },
    @{ name = "metadata"; target = "head"; property = "Metadata"; value = [pscustomobject]@{ 'source-sha' = $sourceSha; 'artifact-sha256' = "e" * 64 } }
  )) {
  $badGateway = $gateway | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badHead = $head | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  if ($case.target -ceq "gateway") { $badGateway.($case.property) = $case.value } else { $badHead.($case.property) = $case.value }
  $rejected = $false
  try {
    Assert-CurrentGatewayArtifactEvidence -Gateway $badGateway -Head $badHead `
      -ExpectedBucket $bucket -ExpectedKmsKeyArn $kmsArn | Out-Null
  } catch {
    $rejected = $true
  }
  if (-not $rejected) { throw "Invalid current gateway $($case.name) evidence was accepted." }
}

if (-not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{})) -or
    -not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{ enableFaultInjection = $false }))) {
  throw "An absent or explicitly false ECS fault-injection setting was rejected."
}
foreach ($unsafeFaultValue in @($true, $null, "false")) {
  $unsafeTask = [pscustomobject]@{ enableFaultInjection = $unsafeFaultValue }
  if (Test-EcsFaultInjectionDisabled -TaskDefinition $unsafeTask) {
    throw "Unsafe ECS fault-injection value was accepted."
  }
}

Write-Host "Development document migration operator path and baseline tests passed."
& (Join-Path $PSScriptRoot "development-current-document-baseline.tests.ps1")
