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
        "Test-IgnorableRdsRestorableTimeRefresh"
      )
    }, $true))
if ($baselineFunctions.Count -ne 6) { throw "The input and plan guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
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
        }
        after = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$afterContainer) -Compress -Depth 10
          tags = $null
          enable_fault_injection = $false
        }
        after_unknown = [pscustomobject]@{ enable_fault_injection = $false }
      }
    })
  output_changes = [pscustomobject]@{
    migration_task_definition_arn = [pscustomobject]@{ actions = @("update") }
  }
}
Assert-ExactTaskPlan -Plan $normalizedTaskPlan

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

Write-Host "Development document migration operator path and baseline tests passed."
