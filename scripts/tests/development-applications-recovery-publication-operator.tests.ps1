$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-applications-recovery-publication.ps1"
$enginePath = Join-Path $repositoryRoot "scripts\publish-development-document-lambdas.ps1"
$operatorSource = Get-Content -LiteralPath $operatorPath -Raw
$engineSource = Get-Content -LiteralPath $enginePath -Raw

foreach ($candidate in @(
    [pscustomobject]@{ Name = "operator"; Source = $operatorSource },
    [pscustomobject]@{ Name = "engine"; Source = $engineSource }
  )) {
  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseInput(
    $candidate.Source,
    [ref]$tokens,
    [ref]$errors
  )
  if (@($errors).Count -ne 0) { throw "The Applications recovery publication $($candidate.Name) did not parse." }
}

foreach ($required in @(
    'ArtifactFamily    = "ApplicationsRecovery"',
    'applications-attempt-recovery-lambda',
    'build:lambda:applications-attempt-recovery',
    '"lambda/applications"',
    '"development-applications-recovery-lambda-publication"',
    '"development-applications-recovery-artifacts"',
    'pnpm --filter @ai-job-apply/workflows test',
    'pnpm audit:dependencies',
    '"--if-none-match", "*"',
    '"--checksum-mode", "ENABLED"',
    'LambdaDeploymentChanged = $false',
    'TriggerChanged          = $false',
    '$arguments.SourceSha = $SourceSha',
    '$arguments.ReceiptPath = $ReceiptPath',
    '$arguments.ReviewedReceiptSha256 = $ReviewedReceiptSha256'
  )) {
  if (-not ($operatorSource.Contains($required) -or $engineSource.Contains($required))) {
    throw "The Applications recovery publication boundary is missing: $required"
  }
}

foreach ($forbidden in @(
    "terraform apply",
    "aws lambda update-function-code",
    "aws lambda update-alias",
    "aws lambda publish-version",
    "enable-event-source-mapping",
    "ecs run-task"
  )) {
  if (($operatorSource + $engineSource).IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw "The publication-only Applications recovery operator contains a forbidden mutation: $forbidden"
  }
}

foreach ($optional in @("SourceSha", "ReceiptPath", "ReviewedReceiptSha256")) {
  if ($operatorSource -match "(?m)^\s+$optional\s+=\s+`$$optional\s*$") {
    throw "The Applications recovery wrapper forwards an empty optional $optional value."
  }
}

Write-Host "Development Applications recovery publication operator pure guard tests passed."
