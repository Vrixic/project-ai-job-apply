$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
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

$currentJobsSuccessMarker =
  "Jobs migrations through 0004_job_search applied and verified."
$retiredJobsSuccessMarker =
  "Jobs migrations through 0003_duplicate_resolution_audit_guard applied and verified."
if (-not $source.Contains($currentJobsSuccessMarker)) {
  throw "The development migration operator does not require the current Jobs migration marker."
}
if ($source.Contains($retiredJobsSuccessMarker)) {
  throw "The development migration operator still accepts the retired Jobs migration marker."
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
        "Assert-ExactTaskPlan", "Assert-CurrentGatewayArtifactEvidence",
        "Test-IgnorableRdsRestorableTimeRefresh", "Get-OptionalProperty",
        "Test-EcsFaultInjectionDisabled", "Assert-ReleaseSourceBinding",
        "Assert-OperatorOnlyReleaseDelta", "Assert-ExecutionIdentity",
        "Assert-DurableClaimPutResult", "Assert-DurableExecutionClaimEvidence",
        "Test-DurableClaimHistoryExists", "Assert-RecoveryOperatorBinding",
        "Resolve-TaskLogStreamName",
        "Set-RecoveredReceiptEvidence", "Test-IgnorableMigrationTaskTagsRefresh",
        "Get-UnacceptedVerificationDrift", "Get-DeclaredVariableNames",
        "Get-CurrentTerraformStateIdentity", "Assert-ExactCurrentBaselineVariableSet",
        "Assert-RetainedMigrationBaselinePlan", "Assert-RetainedBaselineCurrentState",
        "Read-RetainedMigrationBaseline", "Assert-TaskMetadataBaselineBinding",
        "Get-FileSha256", "Write-JsonFile", "Get-ExactStringPlanVariable",
        "New-PostMigrationBaselineMetadata", "Assert-PostMigrationBaselineMetadata",
        "Save-PostMigrationBaselineMetadata", "Remove-NewPostMigrationBaselineArtifacts"
      )
    }, $true))
if ($baselineFunctions.Count -ne 33) { throw "The input, plan, and retained-handoff guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

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
$tagsRefresh = [pscustomobject]@{
  address = $migrationAddress
  change = [pscustomobject]@{
    actions = @("update")
    before = [pscustomobject]@{ family = "migration"; tags = $null }
    after = [pscustomobject]@{ family = "migration"; tags = [pscustomobject]@{} }
    after_unknown = [pscustomobject]@{}
  }
}
if (-not (Test-IgnorableMigrationTaskTagsRefresh -Drift $tagsRefresh)) {
  throw "The exact null-to-empty migration tag refresh was not accepted."
}
if (@(Get-UnacceptedVerificationDrift -Drift @($tagsRefresh)).Count -ne 0) {
  throw "The exact migration tag normalization remained unaccepted verification drift."
}
foreach ($unsafeTagsRefresh in @(
    @{ property = "address"; value = "module.platform.aws_ecs_task_definition.other[0]" },
    @{ property = "afterTags"; value = [pscustomobject]@{ unexpected = "value" } },
    @{ property = "reverseTags"; value = $true },
    @{ property = "afterFamily"; value = "changed" },
    @{ property = "unknownTags"; value = $true },
    @{ property = "unknownOther"; value = $true }
  )) {
  $unsafe = $tagsRefresh | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  switch ($unsafeTagsRefresh.property) {
    "address" { $unsafe.address = $unsafeTagsRefresh.value }
    "afterTags" { $unsafe.change.after.tags = $unsafeTagsRefresh.value }
    "reverseTags" {
      $unsafe.change.before.tags = [pscustomobject]@{}
      $unsafe.change.after.tags = $null
    }
    "afterFamily" { $unsafe.change.after.family = $unsafeTagsRefresh.value }
    "unknownTags" { $unsafe.change.after_unknown | Add-Member -NotePropertyName tags -NotePropertyValue $true }
    "unknownOther" { $unsafe.change.after_unknown | Add-Member -NotePropertyName latent -NotePropertyValue $true }
  }
  if (Test-IgnorableMigrationTaskTagsRefresh -Drift $unsafe) {
    throw "Unsafe migration task drift was accepted as tag normalization."
  }
}

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
    , @()
  )) {
  $deltaRejected = $false
  try { Assert-OperatorOnlyReleaseDelta -ChangeRecords $unsafeDelta } catch { $deltaRejected = $true }
  if (-not $deltaRejected) { throw "A non-verifier release delta was accepted." }
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
Assert-RetainedMigrationBaselinePlan -Plan $retainedPlan

$SourceSha = "a" * 40
$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$MigrationImage = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('e' * 64)"
$retainedPlan.variables.migration_image.value = $MigrationImage
$retainedState = [pscustomobject]@{ Lineage = "12345678-1234-1234-1234-123456789abc"; Serial = 51 }
$retainedTaskMetadata = [pscustomobject]@{
  appliedBaselineStage = "parser-dark"
  appliedBaselineReceiptSha256 = "b" * 64
  appliedBaselineParserQualifiedArn = ""
}
$handoffRoot = Join-Path $terraformRoot "post-migration-handoff-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $handoffRoot
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

$stateMismatchRejected = $false
try {
  Assert-RetainedBaselineCurrentState `
    -Metadata ([pscustomobject]@{ StateLineage = $retainedState.Lineage; StateSerial = 50 }) `
    -State $retainedState
} catch { $stateMismatchRejected = $true }
if (-not $stateMismatchRejected) { throw "PlanTask accepted a retained baseline from a stale state serial." }

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
  function Get-PlanJson([string]$Path) { return $script:retainedPlanFixture }
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
}
finally {
  Remove-Item Function:\Get-PlanJson -ErrorAction SilentlyContinue
  Remove-Item Function:\Get-CurrentTerraformStateIdentity -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $retainedRoot) { Remove-Item -LiteralPath $retainedRoot -Recurse -Force }
}

$oneItemList = ConvertTo-TerraformEnvironmentValue -Value @("http://localhost:3000")
if ($oneItemList -cne '["http://localhost:3000"]') {
  throw "A one-item Terraform collection was serialized as a scalar."
}

$MigrationImage = "example.invalid/migration@sha256:$('a' * 64)"
$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"
$beforeContainer = [ordered]@{
  name = "database-migration"
  image = "example.invalid/migration@sha256:$('b' * 64)"
  command = @("runner/dist/src/main.js")
  mountPoints = @()
  portMappings = @()
  systemControls = @()
  volumesFrom = @()
}
$afterContainer = [ordered]@{
  name = "database-migration"
  image = $MigrationImage
  command = @("runner/dist/src/main.js")
}
$normalizedTaskPlan = [pscustomobject]@{
  complete = $true
  applyable = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = $MigrationImage } }
  resource_drift = @()
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
    })
  output_changes = [pscustomobject]@{
    migration_task_definition_arn = [pscustomobject]@{ actions = @("update") }
  }
}
Assert-ExactTaskPlan -Plan $normalizedTaskPlan

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

$rdsBefore = [pscustomobject]@{
  identifier = "ai-job-apply-development"
  latest_restorable_time = "2026-08-12T17:28:57Z"
  storage_encrypted = $true
  deletion_protection = $true
  backup_retention_period = 7
}
$rdsAfter = $rdsBefore | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$rdsAfter.latest_restorable_time = "2026-08-12T21:28:54Z"
$rdsRefresh = [pscustomobject]@{
  address = "module.platform.aws_db_instance.postgres[0]"
  change = [pscustomobject]@{ actions = @("update"); before = $rdsBefore; after = $rdsAfter }
}
if (-not (Test-IgnorableRdsRestorableTimeRefresh -Drift $rdsRefresh)) {
  throw "A forward-only RDS restorable-time refresh was rejected."
}
$dateObjectRefresh = $rdsRefresh | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$dateObjectRefresh.change.before.latest_restorable_time = [datetime]::Parse(
  "2026-08-12T17:28:57Z", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
)
$dateObjectRefresh.change.after.latest_restorable_time = [datetime]::Parse(
  "2026-08-12T21:28:54Z", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
)
if (-not (Test-IgnorableRdsRestorableTimeRefresh -Drift $dateObjectRefresh)) {
  throw "A PowerShell 7 DateTime-shaped RDS restorable-time refresh was rejected."
}
foreach ($mutation in @("backward-time", "protection", "address")) {
  $badRefresh = $rdsRefresh | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  switch ($mutation) {
    "backward-time" { $badRefresh.change.after.latest_restorable_time = "2026-08-12T16:28:54Z" }
    "protection" { $badRefresh.change.after.deletion_protection = $false }
    "address" { $badRefresh.address = "module.platform.aws_db_instance.other[0]" }
  }
  if (Test-IgnorableRdsRestorableTimeRefresh -Drift $badRefresh) {
    throw "Unsafe RDS refresh mutation '$mutation' was ignored."
  }
}
foreach ($invalid in @("malformed-time", "missing-time", "extra-action")) {
  $badRefresh = $rdsRefresh | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  switch ($invalid) {
    "malformed-time" { $badRefresh.change.after.latest_restorable_time = "2026-08-12 21:28:54" }
    "missing-time" { $badRefresh.change.after.PSObject.Properties.Remove("latest_restorable_time") }
    "extra-action" { $badRefresh.change.actions = @("update", "delete") }
  }
  if (Test-IgnorableRdsRestorableTimeRefresh -Drift $badRefresh) {
    throw "Invalid RDS refresh shape '$invalid' was ignored."
  }
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
