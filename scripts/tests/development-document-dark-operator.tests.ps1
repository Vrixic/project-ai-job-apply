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
    'Assert-NoLambdaResourcePolicy', 'Assert-ExactProcessorLambdaResourcePolicy'
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

Write-Output "Development document staged operator tests passed."
