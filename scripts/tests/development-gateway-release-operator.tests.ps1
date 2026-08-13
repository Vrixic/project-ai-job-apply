Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-gateway-release.ps1"
$operator = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The gateway release operator does not parse: $($errors.Message -join '; ')." }

foreach ($functionName in @("Get-OptionalProperty", "Get-GatewayKeyHistoryMatches")) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$exactKey = "lambda/gateway/source/artifact/gateway-lambda.zip"
foreach ($emptyHistory in @(
    [pscustomobject]@{},
    [pscustomobject]@{ Versions = @(); DeleteMarkers = @() },
    [pscustomobject]@{ Versions = @($null); DeleteMarkers = @($null) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $emptyHistory -Key $exactKey).Count -ne 0) {
    throw "Empty or null S3 gateway history was treated as an existing immutable key."
  }
}
foreach ($existingHistory in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = $exactKey }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = $exactKey }) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $existingHistory -Key $exactKey).Count -ne 1) {
    throw "An exact gateway object version or delete marker was not detected."
  }
}
$unrelatedHistory = [pscustomobject]@{
  Versions = @($null, [pscustomobject]@{ Key = "$exactKey.unrelated" }, [pscustomobject]@{})
  DeleteMarkers = @([pscustomobject]@{ Key = "unrelated/$exactKey" })
}
if (@(Get-GatewayKeyHistoryMatches -Result $unrelatedHistory -Key $exactKey).Count -ne 0) {
  throw "Gateway history matching was relaxed beyond the exact immutable key."
}

foreach ($required in @(
    'ValidateSet("Status", "Publish", "VerifyPublication", "Plan", "Apply", "Verify")',
    'SourceSha must equal the exact merged main checkout', 'ARTIFACT_SOURCE_SHA',
    'Assert-GatewayPublicationReceipt', 'Assert-GatewayReleaseVariables', 'Assert-ExactGatewayReleasePlan',
    'Assert-RetainedGatewayBaselineMetadata', 'Assert-RetainedGatewayBaselinePlan',
    'Get-GatewayKeyHistoryMatches -Result $history -Key $key',
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
