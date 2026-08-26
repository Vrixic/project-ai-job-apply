$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-ingestion-lambda-publication.ps1"
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
  if (@($errors).Count -ne 0) { throw "The ingestion Lambda publisher $($candidate.Name) did not parse." }
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

$artifactNames = @("ingestion-durable-lambda", "ingestion-runtime-lambda")
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
$null = Assert-CanonicalReceiptMatrix -Artifacts $canonicalArtifacts `
  -ExpectedArtifactNames $artifactNames
foreach ($invalidMatrix in @(
    @($canonicalArtifacts | Select-Object -First 7),
    @($canonicalArtifacts + [pscustomobject]@{
        artifactName = "workflow-ingress-lambda"; artifactSha256 = $digest; suffix = "zip"
      })
  )) {
  $rejected = $false
  try {
    $null = Assert-CanonicalReceiptMatrix -Artifacts $invalidMatrix `
      -ExpectedArtifactNames $artifactNames
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A noncanonical ingestion receipt matrix was accepted." }
}

if (-not (Assert-ChecksumCompanion -Text "$digest  ingestion-durable-lambda.zip`n" `
      -ExpectedDigest $digest -ExpectedFileName "ingestion-durable-lambda.zip")) {
  throw "The ingestion checksum companion was not accepted."
}
if (@(Get-KeyHistoryMatches -Result ([pscustomobject]@{}) -Key "exact/key").Count -ne 0) {
  throw "Omitted ingestion object history was not treated as empty."
}
foreach ($history in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = "exact/key" }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = "exact/key" }) }
  )) {
  if (@(Get-KeyHistoryMatches -Result $history -Key "exact/key").Count -ne 1) {
    throw "An existing ingestion artifact version or delete marker was not detected."
  }
}

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-ingestion-artifacts"
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-ingestion-artifacts\receipt-test.json") -cne $expected) {
  throw "The ingestion publisher rejected its ignored receipt root."
}
$traversalRejected = $false
try { $null = Resolve-OperatorPath -Candidate "..\outside.json" } catch { $traversalRejected = $true }
if (-not $traversalRejected) { throw "The ingestion publisher accepted receipt path traversal." }

foreach ($required in @(
    'ArtifactFamily    = "Ingestion"',
    '@("ingestion-durable-lambda", "ingestion-runtime-lambda")',
    '"lambda/ingestion"',
    '"development-ingestion-lambda-publication"',
    'pnpm --filter @ai-job-apply/workflows test',
    'pnpm --filter @ai-job-apply/workflows build:lambda:ingestion',
    '"--if-none-match", "*"',
    '"list-object-versions"',
    '"--checksum-mode", "ENABLED"',
    'PublishedObjectCount',
    'LambdaDeploymentChanged = $false',
    'TriggerChanged          = $false',
    'No action changes a Lambda function or alias',
    '$arguments.SourceSha = $SourceSha',
    '$arguments.ReceiptPath = $ReceiptPath',
    '$arguments.ReviewedReceiptSha256 = $ReviewedReceiptSha256'
  )) {
  if (-not ($operatorSource.Contains($required) -or $engineSource.Contains($required))) {
    throw "The ingestion publication boundary is missing: $required"
  }
}

foreach ($optional in @("SourceSha", "ReceiptPath", "ReviewedReceiptSha256")) {
  if ($operatorSource -match "(?m)^\s+$optional\s+=\s+`$$optional\s*$") {
    throw "The ingestion wrapper forwards an empty optional $optional value."
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
    throw "The ingestion publication operator contains a forbidden mutation: $forbidden"
  }
}

Write-Host "Development ingestion Lambda publication operator pure guard tests passed."
