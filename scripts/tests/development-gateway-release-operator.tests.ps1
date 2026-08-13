Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-gateway-release.ps1"
$operator = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null; $errors = $null
[Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors) | Out-Null
if (@($errors).Count -ne 0) { throw "The gateway release operator does not parse: $($errors.Message -join '; ')." }

foreach ($required in @(
    'ValidateSet("Status", "Publish", "VerifyPublication", "Plan", "Apply", "Verify")',
    'SourceSha must equal the exact merged main checkout', 'ARTIFACT_SOURCE_SHA',
    'Assert-GatewayPublicationReceipt', 'Assert-GatewayReleaseVariables', 'Assert-ExactGatewayReleasePlan',
    'Assert-RetainedGatewayBaselineMetadata', 'Assert-RetainedGatewayBaselinePlan',
    '$planPath.baseline.json', 'The retained baseline state lineage or serial is no longer current',
    'MigrationRepositoryUrl', 'ParserQualifiedArn',
    'Remote state changed after review', 'verify-development-gateway-lambda-boundary.ps1',
    'CodeSha256', 'RELEASE_SHA', '-detailed-exitcode', 'Get-StateIdentity',
    'Assert-RetainedGatewayBaselinePlan $plan $declaredVariables',
    'Remove-Item "Env:$($item.Name)"',
    'gateway_lambda_artifact_s3_object_version', '--if-none-match', 'lambda/gateway/$SourceSha/'
  )) {
  if (-not $operator.Contains($required)) { throw "The gateway release operator is missing '$required'." }
}
foreach ($forbidden in @('terraform destroy', '-target=', 'terraform import', 'serverless_runtime_enabled = "false"')) {
  if ($operator.Contains($forbidden)) { throw "The gateway release operator contains forbidden text '$forbidden'." }
}
if ($operator -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The gateway release operator uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($operator -match '(?m)terraform[^\r\n]*\s-target(?:=|\s)') { throw "The gateway release operator uses resource targeting." }

$buildScript = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\build-gateway-lambda.mjs") -Raw
if (-not $buildScript.Contains('buildLambdaArtifact') -or -not $buildScript.Contains('artifactName: "gateway-lambda"')) {
  throw "The gateway build does not use the shared commit-provenance artifact builder."
}
$workflow = Get-Content -LiteralPath (Join-Path $repositoryRoot ".github\workflows\publish-gateway-lambda.yml") -Raw
foreach ($binding in @('ARTIFACT_SOURCE_SHA: ${{ github.sha }}', '.sourceSha', '$GITHUB_SHA')) {
  if (-not $workflow.Contains($binding)) { throw "The protected gateway publication workflow is missing '$binding'." }
}

$boundaryPath = Join-Path $repositoryRoot "scripts\verify-gateway-lambda-boundary.ps1"
$boundary = Get-Content -LiteralPath $boundaryPath -Raw
[Management.Automation.Language.Parser]::ParseFile($boundaryPath, [ref]$tokens, [ref]$errors) | Out-Null
if (@($errors).Count -ne 0) { throw "The direct gateway verifier does not parse." }
foreach ($case in @(
    'Name = "job-search"', 'Name = "job-search-missing-authorizer"',
    'Name = "job-search-wrong-scope"', 'Name = "job-search-invalid-body"',
    'Name = "job-search-oversized"', 'Name = "job-search-wrong-media-type"',
    'Name = "job-search-wrong-path"', 'Name = "job-search-unexpected-query"',
    'Code = "invalid_request"',
    'SuccessContract = "JobSearchPage"', 'ForbiddenResponseText = $restrictedSearchMarker'
  )) {
  if (-not $boundary.Contains($case)) { throw "The direct verifier is missing '$case'." }
}
if ($boundary -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The direct verifier uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($boundary -match 'Write-(?:Host|Output)[^\r\n]*restrictedSearchMarker') {
  throw "The direct verifier writes the restricted search marker to output."
}

foreach ($wrapperName in @("verify-development-gateway-lambda-boundary.ps1", "verify-staging-gateway-lambda-boundary.ps1")) {
  $wrapperPath = Join-Path $repositoryRoot "scripts\$wrapperName"
  $wrapper = Get-Content -LiteralPath $wrapperPath -Raw
  [Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -ne 0) {
    throw "$wrapperName does not preserve the non-mutating generic verifier interface."
  }
}

Write-Output "Development gateway release operator and search-boundary tests passed."
