param(
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$AwsRegion = "us-east-2",
  [switch]$ValidateOnly,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host @"
Usage:
  .\scripts\start-deployed-web-conformance.ps1
  .\scripts\start-deployed-web-conformance.ps1 -ValidateOnly

Starts only the local Next.js web client and routes its server-held BFF to the deployed development
gateway. The resolved gateway URL remains process-scoped and is never written to a file or printed.

Options:
  -AwsProfile   IAM Identity Center profile. Default: ai-job-apply-development-admin
  -AwsRegion    AWS region. Default: us-east-2
  -ValidateOnly Validate prerequisites without starting the web client.
  -Help         Show this help.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$webEnvironment = Join-Path $repositoryRoot "frontend\web\.env.local"

if (-not (Test-Path -LiteralPath $webEnvironment)) {
  throw "frontend/web/.env.local is missing. Configure the isolated Auth0 web client first."
}

$requiredSettings = @(
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
  "AUTH0_AUDIENCE"
)
$configuredSettings = Select-String -LiteralPath $webEnvironment -Pattern "^([A-Z0-9_]+)=.+" |
  ForEach-Object { ($_.Line -split "=", 2)[0] } |
  Sort-Object -Unique
$missingSettings = $requiredSettings | Where-Object { $_ -notin $configuredSettings }
if ($missingSettings.Count -gt 0) {
  throw "The local Auth0 web configuration is incomplete. Missing: $($missingSettings -join ', ')."
}

$terraformVersionOutput = & terraform version -json 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Terraform could not be executed."
}
$terraformVersion = ($terraformVersionOutput | ConvertFrom-Json).terraform_version
if ($terraformVersion -ne "1.9.8") {
  throw "Terraform 1.9.8 is required; found $terraformVersion."
}

$callerOutput = & aws sts get-caller-identity `
  --profile $AwsProfile `
  --region $AwsRegion `
  --output json 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "The development AWS session is unavailable. Refresh the IAM Identity Center login."
}
$null = $callerOutput | ConvertFrom-Json

if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
  throw "Port 3000 is already in use. Stop the existing process before starting conformance."
}

$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousPlatformBaseUrl = $env:PLATFORM_API_BASE_URL

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $AwsRegion
  Push-Location $repositoryRoot
  try {
    $gatewayOutput = & terraform `
      "-chdir=infrastructure/terraform/environments/development" `
      output `
      -raw `
      gateway_url 2>&1
    $terraformExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($terraformExitCode -ne 0) {
    throw "The deployed gateway output could not be resolved from encrypted development state."
  }
  $gatewayUrl = [string]$gatewayOutput
  $parsedGateway = $null
  if (
    -not [Uri]::TryCreate($gatewayUrl, [UriKind]::Absolute, [ref]$parsedGateway) -or
    $parsedGateway.Scheme -ne "https" -or
    $parsedGateway.UserInfo
  ) {
    throw "The deployed gateway output is not an approved HTTPS origin."
  }

  Write-Host "Development AWS, Terraform, Auth0, and deployed-gateway prerequisites passed."
  if ($ValidateOnly) {
    Write-Host "Validation-only mode complete; no server was started."
    exit 0
  }

  $env:PLATFORM_API_BASE_URL = $gatewayUrl
  Write-Host "Starting the local web client at http://localhost:3000."
  Write-Host "Its server-held BFF targets the deployed development gateway. Press Ctrl+C to stop."
  Push-Location $repositoryRoot
  try {
    pnpm --filter @ai-job-apply/web dev
    if ($LASTEXITCODE -ne 0) {
      throw "The local web client exited with code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} finally {
  $env:AWS_PROFILE = $previousProfile
  $env:AWS_REGION = $previousRegion
  $env:PLATFORM_API_BASE_URL = $previousPlatformBaseUrl
}
