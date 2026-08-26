Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-ingestion-dark-release.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The ingestion dark-release operator does not parse." }

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Expected one operator function named $Name." }
  $definition = [scriptblock]::Create($matches[0].Body.Extent.Text.TrimStart('{').TrimEnd('}'))
  Set-Item -Path "Function:script:$Name" -Value $definition
}

foreach ($name in @(
    "Get-FileSha256", "Get-TextSha256", "ConvertFrom-OperatorJson", "Assert-ExactProperties", "Resolve-PrivatePath",
    "Remove-SensitiveTemporaryFile", "Assert-TerraformVersion", "Assert-IngestionMappingInventory",
    "Read-PublicationReceipt", "Get-ZipRecord", "Convert-BaselineDarkVariables", "Test-ExactFalse", "Assert-DarkVariables",
    "New-ReleaseVariables", "Get-ArtifactCoordinates", "Assert-ReleasePlan", "New-PlanReceipt",
    "Read-PlanReceipt"
  )) { Import-OperatorFunction $name }

$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ExpectedAccountId", "StateBucket", "SourceSha",
  "PublicationReceiptPath", "ReviewedPublicationReceiptSha256", "BaselinePlanPath",
  "ReviewedBaselinePlanSha256", "ExpectedStateLineage", "ExpectedStateSerial", "PlanPath",
  "PlanReceiptPath", "ReviewedPlanReceiptSha256", "VerificationReceiptPath", "Help"
)
$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) { throw "The operator parameter surface changed." }

foreach ($requiredSource in @(
    'plan -input=false -lock-timeout=5m -refresh=true',
    'apply -input=false -lock-timeout=5m -auto-approve $resolvedPlan',
    'Read-EncryptedStateSnapshot',
    'Assert-LiveDarkRelease',
    'Invoke-ZeroDriftPlan',
    'rollbackArtifactCoordinates',
    'describe-nat-gateways',
    'list-event-source-mappings',
    'INGESTION_ACTIVITY_FUNCTION_ARN -cne $activityArn',
    'Terraform 1.9.8 is required',
    '$values = Convert-BaselineDarkVariables $values',
    'Remove-SensitiveTemporaryFile $temporary',
    'Remove-SensitiveTemporaryFile $varsPath'
  )) {
  if (-not $source.Contains($requiredSource)) { throw "The operator lost required guard source: $requiredSource" }
}
if ($source -match '(?m)^\s*terraform\s+apply\s*$' -or $actualParameters -contains "ProviderSources") {
  throw "The operator contains an unbounded apply or caller-defined provider source."
}

$SourceSha = "a" * 40
$Region = "us-east-2"
$ExpectedAccountId = "111122223333"
$ExpectedStateLineage = "11111111-2222-3333-4444-555555555555"
$ExpectedStateSerial = 200
$ReviewedBaselinePlanSha256 = "b" * 64
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$artifactNames = @("ingestion-durable-lambda", "ingestion-runtime-lambda")
$artifactSuffixes = @("zip", "cdx.json", "manifest.json", "sha256")
$artifactVariableNames = @(
  "ingestion_durable_artifact_s3_key", "ingestion_durable_artifact_s3_object_version",
  "ingestion_durable_artifact_sha256", "ingestion_durable_artifact_base64sha256",
  "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
  "ingestion_runtime_artifact_sha256", "ingestion_runtime_artifact_base64sha256"
)
$darkBooleanVariables = @(
  "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress"
)
$allowedReleaseActions = [ordered]@{
  "module.platform.aws_cloudformation_stack.ingestion_durable[0]" = "update"
  "module.platform.aws_lambda_alias.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["terminal"]' = "update"
  "module.platform.aws_lambda_function.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["terminal"]' = "update"
}
$expectedOutputChanges = @("ingestion_durable_version_arn")
$functionNames = [ordered]@{
  activity = "ai-job-apply-development-ingestion-activity"
  coordinator = "ai-job-apply-development-ingestion-coordinator"
  starter = "ai-job-apply-development-ingestion-starter"
  terminal = "ai-job-apply-development-ingestion-terminal"
  durable = "ai-job-apply-development-ingestion-durable"
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)
  $failed = $false
  try { & $Operation } catch { $failed = $true }
  if (-not $failed) { throw "The operator accepted $Description." }
}

$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$testRoot = Join-Path $terraformDataRoot "development-ingestion-dark-release-test-$PID-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = $testRoot
$PublicationReceiptPath = Join-Path $testRoot "publication.json"
$PlanReceiptPath = Join-Path $testRoot "plan-receipt.json"
$repositoryRoot = $repositoryRoot

try {
  $null = New-Item -ItemType Directory -Path $testRoot -Force
  $objects = @()
  $index = 0
  foreach ($name in $artifactNames) {
    $zipDigest = if ($name -ceq "ingestion-durable-lambda") { "1" * 64 } else { "2" * 64 }
    foreach ($suffix in $artifactSuffixes) {
      $index += 1
      $objectDigest = if ($suffix -ceq "zip") { $zipDigest } else { ([string]([string]$index)[0]) * 64 }
      $objects += [pscustomobject]@{
        artifactName = $name; artifactSha256 = $zipDigest; suffix = $suffix
        key = "lambda/ingestion/$SourceSha/$zipDigest/$name.$suffix"
        versionId = "version-$index"; objectSha256 = $objectDigest
        objectBase64Sha256 = (([char](64 + $index)).ToString() * 43) + "="
        contentLength = 100 + $index
      }
    }
  }
  $receipt = [ordered]@{
    schemaVersion = 1; kind = "development-ingestion-lambda-publication"; environment = "development"
    region = "us-east-2"; sourceSha = $SourceSha; boundarySha256 = "9" * 64; phase = "verified"
    createdAt = "2026-08-26T00:00:00.0000000+00:00"; completedAt = "2026-08-26T00:01:00.0000000+00:00"; artifacts = $objects
  }
  [IO.File]::WriteAllText($PublicationReceiptPath, ($receipt | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
  $publication = Read-PublicationReceipt
  if (@($publication.Receipt.artifacts).Count -ne 8) { throw "The exact publication receipt was not accepted." }

  foreach ($mutation in @("duplicate", "source", "phase", "artifact", "key", "count", "extra")) {
    $candidate = $receipt | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($mutation) {
      "duplicate" { $candidate.artifacts[7].artifactName = "ingestion-durable-lambda"; $candidate.artifacts[7].suffix = "zip" }
      "source" { $candidate.sourceSha = "0" * 40 }
      "phase" { $candidate.phase = "publishing" }
      "artifact" { $candidate.artifacts[1].artifactSha256 = "8" * 64 }
      "key" { $candidate.artifacts[0].key = "lambda/other.zip" }
      "count" { $candidate.artifacts = @($candidate.artifacts | Select-Object -First 7) }
      "extra" { $candidate.artifacts[0] | Add-Member NoteProperty bucket "caller" }
    }
    [IO.File]::WriteAllText($PublicationReceiptPath, ($candidate | ConvertTo-Json -Depth 20), $utf8WithoutBom)
    $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
    Assert-Rejected { Read-PublicationReceipt } "publication mutation '$mutation'"
  }
  [IO.File]::WriteAllText($PublicationReceiptPath, ($receipt | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
  $publication = Read-PublicationReceipt

  $sensitive = Join-Path $testRoot "sensitive.auto.tfvars.json"
  [IO.File]::WriteAllText($sensitive, '{"private":"value"}', $utf8WithoutBom)
  Remove-SensitiveTemporaryFile $sensitive
  if (Test-Path -LiteralPath $sensitive) { throw "Sensitive temporary cleanup did not prove deletion." }

  function terraform {
    '{"terraform_version":"1.9.8"}'
    $global:LASTEXITCODE = 0
  }
  Assert-TerraformVersion
  function terraform {
    '{"terraform_version":"1.9.7"}'
    $global:LASTEXITCODE = 0
  }
  Assert-Rejected { Assert-TerraformVersion } "Terraform other than exact 1.9.8"
  Remove-Item Function:terraform

  $mapping = [pscustomobject]@{ EventSourceMappings = @([pscustomobject]@{
        State = "Disabled"
        EventSourceArn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-ingestion-dispatch"
        FunctionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-ingestion-starter:development"
        BatchSize = 10
        FunctionResponseTypes = @("ReportBatchItemFailures")
      }) }
  Assert-IngestionMappingInventory $mapping
  foreach ($mutation in @("enabled", "extra", "queue", "function", "batch", "response")) {
    $candidate = $mapping | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    switch ($mutation) {
      "enabled" { $candidate.EventSourceMappings[0].State = "Enabled" }
      "extra" { $candidate.EventSourceMappings = @($candidate.EventSourceMappings[0], $candidate.EventSourceMappings[0]) }
      "queue" { $candidate.EventSourceMappings[0].EventSourceArn += "-other" }
      "function" { $candidate.EventSourceMappings[0].FunctionArn += "-other" }
      "batch" { $candidate.EventSourceMappings[0].BatchSize = 1 }
      "response" { $candidate.EventSourceMappings[0].FunctionResponseTypes = @() }
    }
    Assert-Rejected { Assert-IngestionMappingInventory $candidate } "event-source mapping mutation '$mutation'"
  }

  $baselineValues = [ordered]@{
    deploy_ingestion_runtime = $true
    ingestion_runtime_enabled = $false
    ingestion_synthetic_source_enabled = $false
    ingestion_provider_activation_allowed = $false
    ingestion_provider_private_egress = $false
    ingestion_provider_sources = @()
    ingestion_durable_artifact_s3_key = "lambda/ingestion/old/durable.zip"
    ingestion_durable_artifact_s3_object_version = "old-durable-version"
    ingestion_durable_artifact_sha256 = "3" * 64
    ingestion_durable_artifact_base64sha256 = ("C" * 43) + "="
    ingestion_runtime_artifact_s3_key = "lambda/ingestion/old/runtime.zip"
    ingestion_runtime_artifact_s3_object_version = "old-runtime-version"
    ingestion_runtime_artifact_sha256 = "4" * 64
    ingestion_runtime_artifact_base64sha256 = ("D" * 43) + "="
    unrelated_baseline_value = "retained"
  }
  $serializedBaselineValues = [ordered]@{}
  foreach ($key in $baselineValues.Keys) { $serializedBaselineValues[$key] = $baselineValues[$key] }
  $serializedBaselineValues.deploy_ingestion_runtime = "true"
  foreach ($gate in $darkBooleanVariables) { $serializedBaselineValues[$gate] = "false" }
  $normalizedBaselineValues = Convert-BaselineDarkVariables $serializedBaselineValues
  Assert-DarkVariables $normalizedBaselineValues
  foreach ($name in @("deploy_ingestion_runtime") + $darkBooleanVariables) {
    if ($normalizedBaselineValues[$name] -isnot [bool]) {
      throw "The real Terraform baseline boolean string for $name was not normalized to a native boolean."
    }
  }
  if ($normalizedBaselineValues.unrelated_baseline_value -cne "retained") {
    throw "Baseline-only boolean normalization changed an unrelated variable."
  }
  if ($serializedBaselineValues.deploy_ingestion_runtime -isnot [string] -or
    $serializedBaselineValues.ingestion_runtime_enabled -isnot [string]) {
    throw "Baseline-only boolean normalization mutated the reviewed Terraform plan projection."
  }
  foreach ($invalid in @("True", "FALSE", " true", "false ", 1, $null)) {
    $invalidBaselineValues = [ordered]@{}
    foreach ($key in $serializedBaselineValues.Keys) { $invalidBaselineValues[$key] = $serializedBaselineValues[$key] }
    $invalidBaselineValues.ingestion_runtime_enabled = $invalid
    Assert-Rejected { Convert-BaselineDarkVariables $invalidBaselineValues } "noncanonical baseline boolean '$invalid'"
  }
  $baseline = [pscustomobject]@{ Values = $normalizedBaselineValues; Sha256 = $ReviewedBaselinePlanSha256 }
  $release = New-ReleaseVariables $baseline $publication
  $releaseValues = $release
  Assert-DarkVariables $release
  if ([string]$release.unrelated_baseline_value -cne "retained" -or
    [string]$release.ingestion_durable_artifact_sha256 -cne ("1" * 64) -or
    [string]$release.ingestion_runtime_artifact_sha256 -cne ("2" * 64)) {
    throw "The release overlay did not preserve baseline values and exact ZIP coordinates."
  }
  foreach ($gate in $darkBooleanVariables) {
    $bad = [ordered]@{}
    foreach ($key in $release.Keys) { $bad[$key] = $release[$key] }
    $bad[$gate] = $true
    Assert-Rejected { Assert-DarkVariables $bad } "enabled dark gate '$gate'"
  }
  $badSources = [ordered]@{}
  foreach ($key in $release.Keys) { $badSources[$key] = $release[$key] }
  $badSources.ingestion_provider_sources = @([pscustomobject]@{ source = "provider" })
  Assert-Rejected { Assert-DarkVariables $badSources } "nonempty provider source list"

  $planVariables = [ordered]@{}
  foreach ($key in $release.Keys) { $planVariables[$key] = [pscustomobject]@{ value = $release[$key] } }
  $resourceChanges = @($allowedReleaseActions.GetEnumerator() | ForEach-Object {
      [pscustomobject]@{ address = $_.Key; change = [pscustomobject]@{ actions = @($_.Value.Split(',')) } }
    })
  $plan = [pscustomobject]@{
    variables = [pscustomobject]$planVariables
    resource_changes = $resourceChanges
    output_changes = [pscustomobject]@{
      ingestion_durable_version_arn = [pscustomobject]@{ actions = @("update") }
      unchanged = [pscustomobject]@{ actions = @("no-op") }
    }
  }
  $inventory = @(Assert-ReleasePlan $plan $release)
  if ($inventory.Count -ne $allowedReleaseActions.Count) { throw "The exact release plan inventory was not accepted." }
  $stringBooleanPlan = $plan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $stringBooleanPlan.variables.ingestion_runtime_enabled.value = "false"
  Assert-Rejected { Assert-ReleasePlan $stringBooleanPlan $release } "a non-native release-plan boolean"

  foreach ($mutation in @("route", "action", "missing", "gate", "source", "baseline", "output")) {
    $candidate = $plan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    switch ($mutation) {
      "route" { $candidate.resource_changes[0].address = "module.platform.aws_route.provider_default[0]" }
      "action" { $candidate.resource_changes[0].change.actions = @("delete", "create") }
      "missing" { $candidate.resource_changes = @($candidate.resource_changes | Select-Object -Skip 1) }
      "gate" { $candidate.variables.ingestion_runtime_enabled.value = $true }
      "source" { $candidate.variables.ingestion_provider_sources.value = @([pscustomobject]@{ enabled = $true }) }
      "baseline" { $candidate.variables.unrelated_baseline_value.value = "changed" }
      "output" { $candidate.output_changes | Add-Member NoteProperty route_url ([pscustomobject]@{ actions = @("update") }) }
    }
    Assert-Rejected { Assert-ReleasePlan $candidate $release } "release-plan mutation '$mutation'"
  }

  $state = [pscustomobject]@{ Lineage = $ExpectedStateLineage; Serial = $ExpectedStateSerial; VersionId = "state-version" }
  $planPath = Join-Path $testRoot "release.tfplan"
  [IO.File]::WriteAllText($planPath, "saved-plan", $utf8WithoutBom)
  $planReceipt = New-PlanReceipt $publication $baseline $state $planPath $inventory
  [IO.File]::WriteAllText($PlanReceiptPath, ($planReceipt | ConvertTo-Json -Depth 30), $utf8WithoutBom)
  $ReviewedPlanReceiptSha256 = Get-FileSha256 $PlanReceiptPath
  $loadedPlanReceipt = Read-PlanReceipt
  if (@($loadedPlanReceipt.Receipt.releaseArtifactCoordinates.PSObject.Properties).Count -ne 8 -or
    @($loadedPlanReceipt.Receipt.rollbackArtifactCoordinates.PSObject.Properties).Count -ne 8) {
    throw "The plan receipt did not retain exact release and rollback coordinates."
  }
  $tamperedPlanReceipt = $planReceipt | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $tamperedPlanReceipt.dark.provider = $true
  [IO.File]::WriteAllText($PlanReceiptPath, ($tamperedPlanReceipt | ConvertTo-Json -Depth 30), $utf8WithoutBom)
  $ReviewedPlanReceiptSha256 = Get-FileSha256 $PlanReceiptPath
  Assert-Rejected { Read-PlanReceipt } "a plan receipt with an enabled provider gate"
  if (-not $source.Contains('dark = [ordered]@{ deploy = $true; runtime = $false; synthetic = $false; provider = $false; privateEgress = $false; sourceCount = 0 }')) {
    throw "The plan receipt does not bind the exact dark summary."
  }
} finally {
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Output "Development ingestion dark-release operator tests passed."
