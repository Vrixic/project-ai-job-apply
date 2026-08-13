Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$verifierPath = Join-Path $repositoryRoot "scripts\verify-gateway-lambda-boundary.ps1"
$source = Get-Content -LiteralPath $verifierPath -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The gateway boundary verifier does not parse." }
foreach ($name in @("New-AuthorizerClaims", "New-HttpApiEvent", "Invoke-BoundaryCase")) {
  $definition = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true))
  if ($definition.Count -ne 1) { throw "Expected exactly one $name definition." }
  Invoke-Expression $definition[0].Extent.Text
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "applydash-boundary-behavior-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $temporaryDirectory
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$functionName = "synthetic-gateway"; $aliasName = "development"; $AwsProfile = "synthetic"; $AwsRegion = "us-east-2"
$script:nextLambdaResponse = $null
function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$FailureMessage)
  $outputPath = [string]$Arguments[-1]
  [IO.File]::WriteAllText($outputPath, ($script:nextLambdaResponse | ConvertTo-Json -Depth 30 -Compress), $utf8WithoutBom)
  return [pscustomobject]@{ ExecutedVersion = "7" }
}
function New-ProblemResponse {
  param([int]$Status, [string]$Code, [string]$Detail = "Bounded failure")
  return [pscustomobject]@{
    statusCode = $Status
    headers = [pscustomobject]@{ "content-type" = "application/problem+json; charset=utf-8"; "cache-control" = "no-store" }
    body = ([ordered]@{ status = $Status; code = $Code; title = "Failure"; detail = $Detail; traceId = "trace-test" } | ConvertTo-Json -Compress)
  }
}
function Assert-Rejected {
  param([scriptblock]$Operation, [string]$Message)
  $rejected = $false; try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
}

try {
  $claims = New-AuthorizerClaims -Issuer "https://issuer.example/" -Audience "ai-job-apply-api"
  $searchEvent = New-HttpApiEvent -Method "POST" -Path "/v1/jobs/search" -RequestId "behavior-200" `
    -Claims $claims -Body '{"pageSize":1}' -ContentType "application/json"
  if ([string]$searchEvent.rawQueryString -cne "" -or [string]$searchEvent.requestContext.routeKey -cne "POST /v1/jobs/search") {
    throw "The behavioral search event is not body-only and route-bound."
  }
  $script:nextLambdaResponse = [pscustomobject]@{
    statusCode = 200
    headers = [pscustomobject]@{ "content-type" = "application/json; charset=utf-8"; "cache-control" = "no-store" }
    body = '{"items":[{"id":"00000000-0000-7000-8000-000000000001","company":{"id":"00000000-0000-7000-8000-000000000002","name":"Company","verifiedDomain":"example.test"},"title":"Engineer","locations":["Remote"],"status":"active","firstObservedAt":"2026-08-13T00:00:00Z","lastVerifiedAt":"2026-08-13T00:00:00Z","expiresAt":"2026-08-14T00:00:00Z"}]}'
  }
  $result = Invoke-BoundaryCase -Name "search-200" -Event $searchEvent -ExpectedStatus 200 `
    -ExpectedSuccessContract "JobSearchPage" -ExpectedVersion "7"
  if ([int]$result.Status -ne 200) { throw "The valid JSON search page was not accepted." }

  $script:nextLambdaResponse.body = '{"items":[],"unexpected":true}'
  Assert-Rejected {
    Invoke-BoundaryCase -Name "search-invalid-shape" -Event $searchEvent -ExpectedStatus 200 `
      -ExpectedSuccessContract "JobSearchPage" -ExpectedVersion "7"
  } "A search success response with an unknown field was accepted."
  $script:nextLambdaResponse.body = '{"items":[]}'
  $script:nextLambdaResponse.headers."content-type" = "text/plain"
  Assert-Rejected {
    Invoke-BoundaryCase -Name "search-invalid-media" -Event $searchEvent -ExpectedStatus 200 `
      -ExpectedSuccessContract "JobSearchPage" -ExpectedVersion "7"
  } "A non-JSON search success response was accepted."
  $script:nextLambdaResponse.headers."content-type" = "application/json"
  $script:nextLambdaResponse.body = '{"items":[{"id":"00000000-0000-7000-8000-000000000001","company":{"id":"00000000-0000-7000-8000-000000000002","name":"Company","secret":"not-allowed"},"title":"Engineer","locations":["Remote"],"status":"active","firstObservedAt":"2026-08-13T00:00:00Z","lastVerifiedAt":"2026-08-13T00:00:00Z","expiresAt":"2026-08-14T00:00:00Z"}]}'
  Assert-Rejected {
    Invoke-BoundaryCase -Name "search-invalid-company-shape" -Event $searchEvent -ExpectedStatus 200 `
      -ExpectedSuccessContract "JobSearchPage" -ExpectedVersion "7"
  } "A search response with an unknown nested company field was accepted."

  $matrix = @(
    @{ Status = 401; Code = "authentication_required" },
    @{ Status = 403; Code = "forbidden" },
    @{ Status = 400; Code = "invalid_request" },
    @{ Status = 413; Code = "payload_too_large" },
    @{ Status = 415; Code = "unsupported_media_type" },
    @{ Status = 404; Code = "not_found" }
  )
  foreach ($entry in $matrix) {
    $script:nextLambdaResponse = New-ProblemResponse $entry.Status $entry.Code
    $case = Invoke-BoundaryCase -Name "search-$($entry.Status)" -Event $searchEvent `
      -ExpectedStatus $entry.Status -ExpectedCode $entry.Code -ExpectedVersion "7"
    if ([int]$case.Status -ne [int]$entry.Status) { throw "The $($entry.Status) problem response was not accepted." }
  }

  $restricted = "candidate-query-must-not-be-reflected"
  $script:nextLambdaResponse = New-ProblemResponse 400 "invalid_request" "Failure contained $restricted"
  Assert-Rejected {
    Invoke-BoundaryCase -Name "search-reflection" -Event $searchEvent -ExpectedStatus 400 `
      -ExpectedCode "invalid_request" -ForbiddenResponseText $restricted -ExpectedVersion "7"
  } "A reflected candidate search value was accepted."
}
finally {
  if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
}

Write-Output "Gateway boundary verifier behavioral tests passed."
