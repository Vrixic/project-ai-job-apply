Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-dark-deployment.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The staged document operator does not parse: $($errors.Message -join '; ')." }

foreach ($required in @(
    '[ValidateSet("KmsPrerequisite", "ParserDark", "CompleteDark")]',
    'StateLineage = $stateIdentity.Lineage', 'StateSerial = $stateIdentity.Serial',
    'Get-AppliedParserQualifiedArn', 'Assert-MonotonicDocumentStage',
    'ParserQualifiedArn = $parserQualifiedArn', 'Assert-LiveStageBoundary',
    'Assert-LiveParserDarkBoundary -Receipt $Receipt', 'Assert-LiveDarkBoundary -Receipt $Receipt',
    'Get-LiveDocumentStageInventory', 'Assert-DevelopmentDocumentStageResourceInventory',
    'Assert-NoLambdaResourcePolicy', 'Assert-ExactProcessorLambdaResourcePolicy',
    'Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $plan',
    'Save-RetainedBaselineMetadata', 'BaselinePath = $retainedBaseline.PlanPath',
    'Use verified development $stageValue migration baseline'
  )) {
  if (-not $source.Contains($required)) { throw "The staged operator is missing '$required'." }
}
foreach ($forbidden in @(
    'PlanPrerequisite', 'ApplyPrerequisite', 'VerifyPrerequisite',
    'TF_VAR_deploy_document_processing', 'TF_VAR_document_processing_kms_prerequisite_enabled'
  )) {
  if ($source.Contains($forbidden)) { throw "The staged operator retains forbidden text '$forbidden'." }
}
if ($source -match '(?m)terraform[^\r\n]*\s-target(?:=|\s)') { throw "The staged operator uses Terraform resource targeting." }
if ($source -notmatch 'document_scan_mapping_enabled\s*=\s*"false"' -or
  $source -notmatch 'document_scan_event_rule_enabled\s*=\s*"false"') {
  throw "The operator does not force both trigger switches dark."
}
if ($source -notmatch 'state pull' -or $source -notmatch 'Remote state lineage or serial changed after review') {
  throw "Apply is not fail-closed against state changes after plan review."
}
$stagingLifecycle = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\operate-staging-runtime-lifecycle.ps1") -Raw
if ($stagingLifecycle -match '\[IO\.Path\]::GetFullPath\(\$Candidate,') {
  throw "The staging lifecycle operator uses a two-argument GetFullPath overload unavailable in Windows PowerShell 5.1."
}
if ($stagingLifecycle -notmatch 'GetFullPath\(\(Join-Path \$terraformDirectory \$Candidate\)\)') {
  throw "The staging lifecycle operator does not resolve relative paths through a PS5-compatible join."
}

$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
$metadataFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "Write-ExclusiveJsonFile", "New-RetainedBaselineMetadata",
        "Assert-RetainedBaselineMetadata", "Save-RetainedBaselineMetadata",
        "Assert-RetainedBaselinePathsAvailable", "Assert-StateIdentityStable",
        "Remove-NewRetainedBaselineArtifacts"
      )
    }, $true))
if ($metadataFunctions.Count -ne 7) { throw "The retained-baseline functions must each be defined once." }
foreach ($function in $metadataFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$sourceSha = "a" * 40
$receiptSha = "b" * 64
$lineage = "12345678-1234-1234-1234-123456789abc"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "applydash-document-baseline-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $temporaryRoot
try {
  $planPath = Join-Path $temporaryRoot "parser-dark.tfplan"
  [IO.File]::WriteAllText($planPath, "zero-change-plan", [Text.UTF8Encoding]::new($false))
  $saved = Save-RetainedBaselineMetadata -SourceSha $sourceSha -DeploymentStage "parser-dark" `
    -PlanPath $planPath -StateLineage $lineage -StateSerial 42 -ReceiptSha256 $receiptSha
  $expectedPlanSha = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([string]$saved.PlanPath -cne $planPath -or [string]$saved.PlanSha256 -cne $expectedPlanSha -or
    -not (Test-Path -LiteralPath $saved.MetadataPath -PathType Leaf) -or
    [string]$saved.MetadataSha256 -cne
      (Get-FileHash -LiteralPath $saved.MetadataPath -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw "The retained baseline writer did not create the exact checksum-bound handoff."
  }
  $stored = Get-Content -LiteralPath $saved.MetadataPath -Raw | ConvertFrom-Json
  if ([string]$stored.Stage -cne "parser-dark" -or [string]$stored.ReceiptSha256 -cne $receiptSha -or
    [string]$stored.SourceSha -cne $sourceSha -or [long]$stored.StateSerial -ne 42 -or
    [string]$stored.PlanSha256 -cne $expectedPlanSha -or $stored.Applyable -isnot [bool] -or $stored.Applyable) {
    throw "The retained baseline metadata omitted its exact stage, source, state, hash, or applyable boundary."
  }

  $overwriteRejected = $false
  try {
    $null = Save-RetainedBaselineMetadata -SourceSha $sourceSha -DeploymentStage "parser-dark" `
      -PlanPath $planPath -StateLineage $lineage -StateSerial 42 -ReceiptSha256 $receiptSha
  } catch { $overwriteRejected = $true }
  if (-not $overwriteRejected) { throw "The retained baseline writer overwrote an existing metadata sidecar." }

  $hashMismatchRejected = $false
  try { Assert-RetainedBaselineMetadata -Metadata $stored -Expected @{ PlanSha256 = "c" * 64 } }
  catch { $hashMismatchRejected = $true }
  if (-not $hashMismatchRejected) { throw "Retained baseline metadata accepted a mismatched plan hash." }

  $stageMismatchRejected = $false
  try { Assert-RetainedBaselineMetadata -Metadata $stored -Expected @{ Stage = "complete-dark" } }
  catch { $stageMismatchRejected = $true }
  if (-not $stageMismatchRejected) { throw "Retained baseline metadata accepted a mismatched stage." }

  $stateMismatchRejected = $false
  try {
    Assert-StateIdentityStable `
      -Before ([pscustomobject]@{ Lineage = $lineage; Serial = 42 }) `
      -After ([pscustomobject]@{ Lineage = $lineage; Serial = 43 })
  } catch { $stateMismatchRejected = $true }
  if (-not $stateMismatchRejected) { throw "The retained baseline accepted a changed state serial." }

  $existingPlanRejected = $false
  try { Assert-RetainedBaselinePathsAvailable -PlanPath $planPath -MetadataPath (Join-Path $temporaryRoot "unused.json") }
  catch { $existingPlanRejected = $true }
  if (-not $existingPlanRejected) { throw "The retained baseline accepted a preexisting plan path." }

  $existingSidecarPlan = Join-Path $temporaryRoot "sidecar-only.tfplan"
  $existingSidecar = "$existingSidecarPlan.baseline.json"
  [IO.File]::WriteAllText($existingSidecar, "preexisting", [Text.UTF8Encoding]::new($false))
  $existingSidecarRejected = $false
  try { Assert-RetainedBaselinePathsAvailable -PlanPath $existingSidecarPlan -MetadataPath $existingSidecar }
  catch { $existingSidecarRejected = $true }
  if (-not $existingSidecarRejected -or (Get-Content -LiteralPath $existingSidecar -Raw) -cne "preexisting") {
    throw "The retained baseline did not preserve and reject a preexisting sidecar."
  }

  $failedPlan = Join-Path $temporaryRoot "failed.tfplan"
  $failedSidecar = "$failedPlan.baseline.json"
  [IO.File]::WriteAllText($failedPlan, "partial-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($failedSidecar, "invalid-sidecar", [Text.UTF8Encoding]::new($false))
  Remove-NewRetainedBaselineArtifacts -PlanPath $failedPlan -MetadataPath $failedSidecar
  if ((Test-Path -LiteralPath $failedPlan) -or (Test-Path -LiteralPath $failedSidecar)) {
    throw "A simulated retained-sidecar validation failure left an orphan artifact."
  }
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$saveCallOffset = $source.IndexOf('$result = Save-RetainedBaselineMetadata')
$successAfterSaveOffset = $source.IndexOf('$succeeded = $true', $saveCallOffset)
if ($saveCallOffset -lt 0 -or $successAfterSaveOffset -lt $saveCallOffset -or
  -not $source.Contains('Remove-NewRetainedBaselineArtifacts -PlanPath $path -MetadataPath $metadataPath')) {
  throw "Verify can report retained-baseline success before sidecar validation or leave failed artifacts behind."
}

Write-Output "Development document staged operator tests passed."
