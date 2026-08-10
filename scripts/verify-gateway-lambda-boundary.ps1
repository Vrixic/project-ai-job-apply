[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [string]$AwsProfile = "",
  [string]$AwsRegion = "us-east-2"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($AwsRegion -cne "us-east-2") {
  throw "The Lambda boundary verifier is restricted to us-east-2."
}
if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

$preflightScript = Join-Path $PSScriptRoot "start-deployed-web-conformance.ps1"
$functionName = "ai-job-apply-$Environment-gateway"
$aliasName = $Environment
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryDirectory = Join-Path $temporaryRoot ("applydash-lambda-boundary-" + [Guid]::NewGuid())
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $output = & aws @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  return ($output -join "`n") | ConvertFrom-Json
}

function New-AuthorizerClaims {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Issuer,
    [Parameter(Mandatory = $true)]
    [string]$Audience,
    [string]$Scope = "profile:read profile:write"
  )

  return [ordered]@{
    iss = $Issuer
    sub = "synthetic-boundary-candidate"
    aud = @($Audience)
    scope = $Scope
  }
}

function New-HttpApiEvent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$RequestId,
    [System.Collections.IDictionary]$Claims,
    [string]$Body,
    [bool]$IsBase64Encoded = $false,
    [string]$ContentType,
    [string]$RawQueryString = ""
  )

  $headers = [ordered]@{}
  if ($ContentType) {
    $headers["content-type"] = $ContentType
  }
  $requestContext = [ordered]@{
    accountId = "synthetic-boundary"
    apiId = "synthetic-boundary"
    domainName = "127.0.0.1"
    domainPrefix = "synthetic-boundary"
    http = [ordered]@{
      method = $Method
      path = $Path
      protocol = "HTTP/1.1"
      sourceIp = "127.0.0.1"
      userAgent = "applydash-boundary-verifier"
    }
    requestId = $RequestId
    routeKey = "$Method $Path"
    stage = '$default'
    time = [DateTime]::UtcNow.ToString("o")
    timeEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  if ($Claims) {
    $headers["authorization"] = "Bearer validated-boundary-context"
    $validatedScopes = @(
      ([string]$Claims["scope"] -split " ") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    $requestContext["authorizer"] = [ordered]@{
      jwt = [ordered]@{
        claims = $Claims
        scopes = $validatedScopes
      }
    }
  }

  $event = [ordered]@{
    version = "2.0"
    routeKey = "$Method $Path"
    rawPath = $Path
    rawQueryString = $RawQueryString
    headers = $headers
    requestContext = $requestContext
    isBase64Encoded = $IsBase64Encoded
  }
  if ($PSBoundParameters.ContainsKey("Body")) {
    $event["body"] = $Body
  }
  return $event
}

function Invoke-BoundaryCase {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [System.Collections.IDictionary]$Event,
    [Parameter(Mandatory = $true)]
    [int]$ExpectedStatus,
    [string]$ExpectedCode,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion
  )

  $safeName = $Name -replace "[^a-z0-9-]", "-"
  $inputPath = Join-Path $temporaryDirectory "$safeName-input.json"
  $outputPath = Join-Path $temporaryDirectory "$safeName-output.json"
  [IO.File]::WriteAllText($inputPath, ($Event | ConvertTo-Json -Depth 12 -Compress), $utf8WithoutBom)

  $metadata = Invoke-AwsJson `
    -Arguments @(
      "lambda", "invoke",
      "--function-name", $functionName,
      "--qualifier", $aliasName,
      "--cli-binary-format", "raw-in-base64-out",
      "--payload", "fileb://$inputPath",
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json",
      $outputPath
    ) `
    -FailureMessage "The $Name boundary invocation failed."
  if (
    $metadata.PSObject.Properties.Name -contains "FunctionError" -or
    [string]$metadata.ExecutedVersion -cne $ExpectedVersion -or
    -not (Test-Path -LiteralPath $outputPath -PathType Leaf)
  ) {
    throw "The $Name boundary invocation did not execute the reviewed alias version cleanly."
  }

  $response = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
  if ([int]$response.statusCode -ne $ExpectedStatus) {
    throw "The $Name boundary case returned an unexpected status."
  }
  if ($ExpectedStatus -ge 400) {
    $problem = [string]$response.body | ConvertFrom-Json
    $problemMediaType = ([string]$response.headers."content-type").Split(";", 2)[0].Trim()
    $contractFailures = @()
    if ([int]$problem.status -ne $ExpectedStatus) {
      $contractFailures += "problem status"
    }
    if ([string]$problem.code -cne $ExpectedCode) {
      $contractFailures += "problem code"
    }
    if ([string]::IsNullOrWhiteSpace([string]$problem.traceId)) {
      $contractFailures += "trace identifier"
    }
    if ($problemMediaType -ine "application/problem+json") {
      $contractFailures += "content type"
    }
    if ([string]$response.headers."cache-control" -cne "no-store") {
      $contractFailures += "cache control"
    }
    if ($contractFailures.Count -ne 0) {
      throw "The $Name boundary case failed the stable problem contract checks: $($contractFailures -join ', ')."
    }
  }

  return [ordered]@{ Name = $Name; Status = $ExpectedStatus }
}

$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $AwsRegion
  $env:AWS_DEFAULT_REGION = $AwsRegion
  $null = New-Item -ItemType Directory -Path $temporaryDirectory

  & $preflightScript `
    -Environment $Environment `
    -AwsProfile $AwsProfile `
    -AwsRegion $AwsRegion `
    -ValidateOnly
  if ($LASTEXITCODE -ne 0) {
    throw "The steady-state Lambda preflight failed before the boundary matrix."
  }

  $alias = Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-alias",
      "--function-name", $functionName,
      "--name", $aliasName,
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json"
    ) `
    -FailureMessage "The reviewed $Environment Lambda alias is unavailable."
  $expectedVersion = [string]$alias.FunctionVersion
  if ($expectedVersion -notmatch "^[1-9][0-9]*$") {
    throw "The $Environment Lambda alias does not target an immutable version."
  }

  $configuration = Invoke-AwsJson `
    -Arguments @(
      "lambda", "get-function-configuration",
      "--function-name", $functionName,
      "--qualifier", $aliasName,
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json"
    ) `
    -FailureMessage "The reviewed $Environment Lambda configuration is unavailable."
  $issuer = [string]$configuration.Environment.Variables.OIDC_ISSUER
  $audience = [string]$configuration.Environment.Variables.OIDC_AUDIENCE
  $parsedIssuer = $null
  if (
    $configuration.State -cne "Active" -or
    $configuration.LastUpdateStatus -cne "Successful" -or
    [string]$configuration.Version -cne $expectedVersion -or
    -not [Uri]::TryCreate($issuer, [UriKind]::Absolute, [ref]$parsedIssuer) -or
    $parsedIssuer.Scheme -cne "https" -or
    $parsedIssuer.AbsolutePath -cne "/" -or
    $audience -cne "ai-job-apply-api"
  ) {
    throw "The $Environment Lambda configuration is outside the reviewed identity boundary."
  }

  $validClaims = New-AuthorizerClaims -Issuer $issuer -Audience $audience
  $wrongIssuerClaims = New-AuthorizerClaims -Issuer "https://wrong-environment.invalid/" -Audience $audience
  $wrongAudienceClaims = New-AuthorizerClaims -Issuer $issuer -Audience "wrong-environment-api"
  $missingSubjectClaims = New-AuthorizerClaims -Issuer $issuer -Audience $audience
  $null = $missingSubjectClaims.Remove("sub")
  $wrongScopeClaims = New-AuthorizerClaims -Issuer $issuer -Audience $audience -Scope "unrelated:scope"

  $cases = @(
    @{
      Name = "public-health"
      Event = New-HttpApiEvent -Method "GET" -Path "/health/live" -RequestId "boundary-public-health"
      Status = 200
      Code = $null
    },
    @{
      Name = "missing-authorizer"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-missing-authorizer"
      Status = 401
      Code = "authentication_required"
    },
    @{
      Name = "wrong-issuer"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-wrong-issuer" -Claims $wrongIssuerClaims
      Status = 401
      Code = "authentication_required"
    },
    @{
      Name = "wrong-audience"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-wrong-audience" -Claims $wrongAudienceClaims
      Status = 401
      Code = "authentication_required"
    },
    @{
      Name = "missing-subject"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-missing-subject" -Claims $missingSubjectClaims
      Status = 401
      Code = "authentication_required"
    },
    @{
      Name = "wrong-scope"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-wrong-scope" -Claims $wrongScopeClaims
      Status = 403
      Code = "forbidden"
    },
    @{
      Name = "unknown-route"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/admin" -RequestId "boundary-unknown-route" -Claims $validClaims
      Status = 404
      Code = "not_found"
    },
    @{
      Name = "unknown-method"
      Event = New-HttpApiEvent -Method "POST" -Path "/v1/me" -RequestId "boundary-unknown-method" -Claims $validClaims
      Status = 404
      Code = "not_found"
    },
    @{
      Name = "invalid-operation-id"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/operations/not-a-uuid" -RequestId "boundary-invalid-operation" -Claims $validClaims
      Status = 404
      Code = "not_found"
    },
    @{
      Name = "unexpected-query"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-query" -RawQueryString "source=web"
      Status = 400
      Code = "invalid_request"
    },
    @{
      Name = "get-body"
      Event = New-HttpApiEvent -Method "GET" -Path "/v1/me" -RequestId "boundary-get-body" -Body "{}"
      Status = 400
      Code = "invalid_request"
    },
    @{
      Name = "missing-put-body"
      Event = New-HttpApiEvent -Method "PUT" -Path "/v1/me/job-preferences" -RequestId "boundary-missing-put-body"
      Status = 400
      Code = "invalid_request"
    },
    @{
      Name = "wrong-media-type"
      Event = New-HttpApiEvent -Method "PUT" -Path "/v1/me/job-preferences" -RequestId "boundary-media-type" -Body "value=one" -ContentType "application/x-www-form-urlencoded"
      Status = 415
      Code = "unsupported_media_type"
    },
    @{
      Name = "malformed-base64"
      Event = New-HttpApiEvent -Method "PUT" -Path "/v1/me/job-preferences" -RequestId "boundary-base64" -Body "not-valid***" -IsBase64Encoded $true -ContentType "application/json"
      Status = 400
      Code = "invalid_request"
    },
    @{
      Name = "oversized-body"
      Event = New-HttpApiEvent -Method "PUT" -Path "/v1/me/job-preferences" -RequestId "boundary-oversized" -Body ("x" * (64 * 1024 + 1)) -ContentType "application/json"
      Status = 413
      Code = "payload_too_large"
    }
  )

  $results = @()
  foreach ($case in $cases) {
    $results += Invoke-BoundaryCase `
      -Name $case.Name `
      -Event $case.Event `
      -ExpectedStatus $case.Status `
      -ExpectedCode $case.Code `
      -ExpectedVersion $expectedVersion
  }

  & $preflightScript `
    -Environment $Environment `
    -AwsProfile $AwsProfile `
    -AwsRegion $AwsRegion `
    -ValidateOnly
  if ($LASTEXITCODE -ne 0) {
    throw "The steady-state Lambda preflight failed after the boundary matrix."
  }

  [ordered]@{
    Result = "passed"
    Environment = $Environment
    Cases = $results.Count
    Statuses = @($results | ForEach-Object { $_.Status })
    PublicTrafficChanged = $false
    PersistentApplicationWrites = $false
  } | ConvertTo-Json -Depth 4
}
finally {
  if (
    (Test-Path -LiteralPath $temporaryDirectory) -and
    [IO.Path]::GetFullPath($temporaryDirectory).StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)
  ) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
  if ($null -eq $previousProfile) {
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
  } else {
    $env:AWS_PROFILE = $previousProfile
  }
  if ($null -eq $previousRegion) {
    Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_REGION = $previousRegion
  }
  if ($null -eq $previousDefaultRegion) {
    Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_DEFAULT_REGION = $previousDefaultRegion
  }
}
