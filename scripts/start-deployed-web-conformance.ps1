param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [string]$AwsProfile = "",
  [string]$AwsRegion = "us-east-2",
  [switch]$EnableWorkloadConformance,
  [switch]$ValidateOnly,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host @"
Usage:
  .\scripts\start-deployed-web-conformance.ps1
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging -EnableWorkloadConformance
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging -ValidateOnly
  .\scripts\start-deployed-web-conformance.ps1 -ValidateOnly

Starts only the local Next.js web client and routes its server-held BFF to the selected deployed
gateway. The resolved gateway URL remains process-scoped and is never written to a file or printed.

Options:
  -Environment  Deployed environment: development or staging. Default: development
  -AwsProfile   IAM Identity Center profile. Default: ai-job-apply-<environment>-admin
  -AwsRegion    AWS region. Default: us-east-2
  -EnableWorkloadConformance
                Expose the fixed local-only staging workload control. Staging only.
  -ValidateOnly Validate prerequisites without starting the web client.
  -Help         Show this help.
"@
  exit 0
}

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}
if ($EnableWorkloadConformance -and $Environment -ne "staging") {
  throw "Workload conformance is restricted to the synthetic staging environment."
}

$environmentLabel = if ($Environment -eq "staging") { "Staging" } else { "Development" }
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$webEnvironment = Join-Path $repositoryRoot "frontend\web\.env.local"
$terraformDirectory = "infrastructure/terraform/environments/$Environment"

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

function Get-LocalSetting {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $escapedName = [Regex]::Escape($Name)
  $match = Select-String -LiteralPath $webEnvironment -Pattern "^$escapedName=(.+)$" |
    Select-Object -Last 1
  if ($null -eq $match) {
    throw "The local Auth0 web configuration is incomplete."
  }

  return $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

$auth0Domain = Get-LocalSetting -Name "AUTH0_DOMAIN"
$auth0Audience = Get-LocalSetting -Name "AUTH0_AUDIENCE"
$appBaseUrl = Get-LocalSetting -Name "APP_BASE_URL"

$expectedIssuer = "https://$($auth0Domain.TrimEnd('/'))/"
$parsedIssuer = $null
if (
  -not [Uri]::TryCreate($expectedIssuer, [UriKind]::Absolute, [ref]$parsedIssuer) -or
  $parsedIssuer.Scheme -ne "https" -or
  $parsedIssuer.UserInfo -or
  $parsedIssuer.AbsolutePath -ne "/" -or
  $parsedIssuer.Query -or
  $parsedIssuer.Fragment
) {
  throw "AUTH0_DOMAIN must contain only a valid HTTPS identity-provider host."
}
if ($appBaseUrl.TrimEnd("/") -ne "http://localhost:3000") {
  throw "APP_BASE_URL must be http://localhost:3000 for deployed web conformance."
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
  throw "The $Environment AWS session is unavailable. Refresh the IAM Identity Center login."
}
$null = $callerOutput | ConvertFrom-Json

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

  try {
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw $FailureMessage
  }
}

function Get-HttpStatus {
  param(
    [Parameter(Mandatory = $true)]
    [Uri]$Uri
  )

  try {
    $response = Invoke-WebRequest `
      -Uri $Uri `
      -Method Get `
      -MaximumRedirection 0 `
      -TimeoutSec 15 `
      -UseBasicParsing
    return [int]$response.StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw "The deployed gateway health preflight could not be completed."
  }
}

$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$previousPlatformBaseUrl = $env:PLATFORM_API_BASE_URL
$previousWorkloadConformance = $env:ENABLE_STAGING_WORKLOAD_CONFORMANCE

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $AwsRegion
  $env:AWS_DEFAULT_REGION = $AwsRegion
  Push-Location $repositoryRoot
  try {
    $gatewayOutput = & terraform `
      "-chdir=$terraformDirectory" `
      output `
      -raw `
      gateway_url 2>&1
    $gatewayTerraformExitCode = $LASTEXITCODE
    $clusterOutput = & terraform `
      "-chdir=$terraformDirectory" `
      output `
      -raw `
      ecs_cluster_arn 2>&1
    $clusterTerraformExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($gatewayTerraformExitCode -ne 0 -or $clusterTerraformExitCode -ne 0) {
    throw "The deployed outputs could not be resolved from encrypted $Environment state."
  }
  $gatewayUrl = [string]$gatewayOutput
  $clusterArn = [string]$clusterOutput
  $parsedGateway = $null
  if (
    -not [Uri]::TryCreate($gatewayUrl, [UriKind]::Absolute, [ref]$parsedGateway) -or
    $parsedGateway.Scheme -ne "https" -or
    $parsedGateway.UserInfo
  ) {
    throw "The deployed gateway output is not an approved HTTPS origin."
  }
  if ([string]::IsNullOrWhiteSpace($clusterArn)) {
    throw "The deployed cluster output is unavailable."
  }

  $service = Invoke-AwsJson `
    -Arguments @(
      "ecs", "describe-services",
      "--cluster", $clusterArn,
      "--services", "gateway",
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json"
    ) `
    -FailureMessage "The deployed gateway service could not be inspected."
  if (@($service.failures).Count -ne 0 -or @($service.services).Count -ne 1) {
    throw "The deployed gateway service is unavailable."
  }
  $gatewayService = @($service.services)[0]
  $primaryDeployments = @($gatewayService.deployments) |
    Where-Object { $_.status -eq "PRIMARY" }
  if (
    $gatewayService.status -ne "ACTIVE" -or
    [int]$gatewayService.desiredCount -ne 1 -or
    [int]$gatewayService.runningCount -ne 1 -or
    [int]$gatewayService.pendingCount -ne 0 -or
    $primaryDeployments.Count -ne 1 -or
    $primaryDeployments[0].rolloutState -ne "COMPLETED"
  ) {
    throw "The deployed gateway service is not at the approved lean stable state."
  }

  $taskDefinition = Invoke-AwsJson `
    -Arguments @(
      "ecs", "describe-task-definition",
      "--task-definition", [string]$gatewayService.taskDefinition,
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json"
    ) `
    -FailureMessage "The deployed gateway task definition could not be inspected."
  $gatewayContainers = @($taskDefinition.taskDefinition.containerDefinitions) |
    Where-Object { $_.name -eq "gateway" }
  if ($gatewayContainers.Count -ne 1) {
    throw "The deployed gateway container definition is invalid."
  }
  $deployedEnvironment = @{}
  foreach ($setting in @($gatewayContainers[0].environment)) {
    $deployedEnvironment[[string]$setting.name] = [string]$setting.value
  }
  if (
    $deployedEnvironment["OIDC_ISSUER"] -cne $expectedIssuer -or
    $deployedEnvironment["OIDC_AUDIENCE"] -cne $auth0Audience
  ) {
    throw "The local Auth0 configuration does not exactly match the deployed gateway."
  }

  $liveStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/health/live"))
  $readyStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/health/ready"))
  $protectedStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/v1/me"))
  if ($liveStatus -ne 200 -or $readyStatus -ne 200 -or $protectedStatus -ne 401) {
    throw "The deployed gateway did not pass the expected 200/200/401 health and access preflight."
  }

  Write-Host "$environmentLabel AWS, Terraform, local Auth0, live gateway configuration, and health prerequisites passed."
  if ($ValidateOnly) {
    Write-Host "Validation-only mode complete; no server was started."
    return
  }

  if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
    throw "Port 3000 is already in use. Stop the existing process before starting conformance."
  }

  $env:PLATFORM_API_BASE_URL = $gatewayUrl
  if ($EnableWorkloadConformance) {
    $env:ENABLE_STAGING_WORKLOAD_CONFORMANCE = "1"
  } else {
    Remove-Item Env:ENABLE_STAGING_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
  }
  Write-Host "Starting the local web client at http://localhost:3000."
  Write-Host "Its server-held BFF targets the deployed $Environment gateway. Press Ctrl+C to stop."
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
  $env:AWS_DEFAULT_REGION = $previousDefaultRegion
  $env:PLATFORM_API_BASE_URL = $previousPlatformBaseUrl
  if ($null -eq $previousWorkloadConformance) {
    Remove-Item Env:ENABLE_STAGING_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
  } else {
    $env:ENABLE_STAGING_WORKLOAD_CONFORMANCE = $previousWorkloadConformance
  }
}
