$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-workflow-lambda-publication.ps1"
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
  if (@($errors).Count -ne 0) { throw "The development workflow Lambda $($candidate.Name) did not parse." }
}

$tokens = $null
$errors = $null
$engineAst = [Management.Automation.Language.Parser]::ParseInput(
  $engineSource,
  [ref]$tokens,
  [ref]$errors
)
foreach ($functionName in @(
    "Get-OptionalProperty",
    "Resolve-OperatorPath",
    "Get-FileSha256",
    "Get-FileBase64Sha256",
    "Get-KeyHistoryMatches",
    "Assert-ChecksumCompanion",
    "Assert-CanonicalReceiptMatrix"
  )) {
  $functions = @($engineAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$artifactNames = @(
  "workflow-ingress-lambda",
  "profile-readiness-durable-lambda",
  "profile-readiness-activity-lambda"
)
$digest = "a" * 64
$canonicalArtifacts = @()
foreach ($name in $artifactNames) {
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $canonicalArtifacts += [pscustomobject]@{
      artifactName   = $name
      artifactSha256 = $digest
      suffix         = $suffix
    }
  }
}
if (-not (Assert-CanonicalReceiptMatrix -Artifacts $canonicalArtifacts `
      -ExpectedArtifactNames $artifactNames)) {
  throw "The canonical twelve-object workflow receipt matrix was not accepted."
}
foreach ($invalidMatrix in @(
    @($canonicalArtifacts | Select-Object -First 11),
    @($canonicalArtifacts + [pscustomobject]@{
        artifactName = "ingestion-runtime-lambda"; artifactSha256 = $digest; suffix = "zip"
      })
  )) {
  $rejected = $false
  try {
    $null = Assert-CanonicalReceiptMatrix -Artifacts $invalidMatrix `
      -ExpectedArtifactNames $artifactNames
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A noncanonical workflow receipt matrix was accepted." }
}

if (-not (Assert-ChecksumCompanion -Text "$digest  workflow-ingress-lambda.zip`n" `
      -ExpectedDigest $digest -ExpectedFileName "workflow-ingress-lambda.zip")) {
  throw "The workflow checksum companion was not accepted."
}

if (@(Get-KeyHistoryMatches -Result ([pscustomobject]@{}) -Key "exact/key").Count -ne 0) {
  throw "Omitted workflow object history was not treated as empty."
}
foreach ($history in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = "exact/key" }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = "exact/key" }) }
  )) {
  if (@(Get-KeyHistoryMatches -Result $history -Key "exact/key").Count -ne 1) {
    throw "An existing workflow artifact version or delete marker was not detected."
  }
}

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-workflow-artifacts"
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-workflow-artifacts\receipt-test.json") -cne $expected) {
  throw "The workflow operator rejected its ignored receipt root."
}
$traversalRejected = $false
try { $null = Resolve-OperatorPath -Candidate "..\outside.json" } catch { $traversalRejected = $true }
if (-not $traversalRejected) { throw "The workflow operator accepted receipt path traversal." }

foreach ($required in @(
    'ArtifactFamily        = "CoreWorkflow"',
    'workflow-ingress-lambda',
    'profile-readiness-durable-lambda',
    'profile-readiness-activity-lambda',
    'PublishedObjectCount',
    'No action changes a Lambda function or alias',
    'pnpm --filter @ai-job-apply/workflows test',
    'pnpm --filter @ai-job-apply/workflows build:lambda',
    '"lambda/workflows"',
    '"development-core-workflow-lambda-publication"',
    '"--if-none-match", "*"',
    '"list-object-versions"',
    '"--checksum-mode", "ENABLED"',
    'LambdaDeploymentChanged = $false',
    'TriggerChanged          = $false'
  )) {
  if (-not ($operatorSource.Contains($required) -or $engineSource.Contains($required))) {
    throw "The workflow publication boundary is missing: $required"
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
    throw "The publication-only workflow operator contains a forbidden mutation: $forbidden"
  }
}

foreach ($excludedArtifact in @("ingestion-durable-lambda", "ingestion-runtime-lambda")) {
  if (($operatorSource + $engineSource).Contains($excludedArtifact)) {
    throw "The core workflow publisher selected an excluded ingestion artifact: $excludedArtifact"
  }
}

Write-Host "Development workflow Lambda publication operator pure guard tests passed."
