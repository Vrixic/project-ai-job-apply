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
        "Assert-DurableClaimPutResult", "Assert-DurableExecutionClaimEvidence"
      )
    }, $true))
if ($baselineFunctions.Count -ne 13) { throw "The input and plan guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$emptyClaimHistory = [pscustomobject]@{}
if ($null -ne (Get-OptionalProperty $emptyClaimHistory "Versions") -or
    $null -ne (Get-OptionalProperty $emptyClaimHistory "DeleteMarkers")) {
  throw "An omitted S3 claim-history list did not resolve to null for explicit empty handling."
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
