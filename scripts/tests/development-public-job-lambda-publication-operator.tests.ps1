$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-public-job-lambda-publication.ps1"
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
  if (@($errors).Count -ne 0) { throw "The public-job publisher $($candidate.Name) did not parse." }
}

$tokens = $null
$errors = $null
$engineAst = [Management.Automation.Language.Parser]::ParseInput(
  $engineSource,
  [ref]$tokens,
  [ref]$errors
)
foreach ($functionName in @("Resolve-OperatorPath", "Assert-CanonicalReceiptMatrix")) {
  $functions = @($engineAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$artifactNames = @("public-job-edge-lambda", "public-job-projection-lambda")
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
        artifactName = "public-job-lambda"; artifactSha256 = $digest; suffix = "zip"
      })
  )) {
  $rejected = $false
  try {
    $null = Assert-CanonicalReceiptMatrix -Artifacts $invalidMatrix `
      -ExpectedArtifactNames $artifactNames
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A noncanonical public-job receipt matrix was accepted." }
}

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-public-job-artifacts"
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-public-job-artifacts\receipt-test.json") -cne $expected) {
  throw "The public-job publisher rejected its ignored receipt root."
}
$traversalRejected = $false
try { $null = Resolve-OperatorPath -Candidate "..\outside.json" } catch { $traversalRejected = $true }
if (-not $traversalRejected) { throw "The public-job publisher accepted receipt path traversal." }

foreach ($required in @(
    'ArtifactFamily        = "PublicJob"',
    'public-job-edge-lambda',
    'public-job-projection-lambda',
    '"lambda/public-jobs"',
    '"development-public-job-lambda-publication"',
    'pnpm --filter @ai-job-apply/gateway test',
    'pnpm --filter @ai-job-apply/gateway build:public-job-lambda',
    '"--if-none-match", "*"',
    '"list-object-versions"',
    '"--checksum-mode", "ENABLED"',
    'PublishedObjectCount',
    'LambdaDeploymentChanged = $false',
    'TriggerChanged          = $false',
    'No action changes a Lambda function or alias'
  )) {
  if (-not ($operatorSource.Contains($required) -or $engineSource.Contains($required))) {
    throw "The public-job publication boundary is missing: $required"
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
    throw "The public-job publication operator contains a forbidden mutation: $forbidden"
  }
}

Write-Host "Development public-job Lambda publication operator pure guard tests passed."
