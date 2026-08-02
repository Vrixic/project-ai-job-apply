param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [ValidateSet("ecs", "lambda-dark")]
  [string]$GatewayRuntime = "ecs",
  [string]$AwsProfile = "",
  [string]$AwsRegion = "us-east-2",
  [switch]$EnableWorkloadConformance,
  [switch]$BridgeSmokeTest,
  [switch]$ValidateOnly,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host @"
Usage:
  .\scripts\start-deployed-web-conformance.ps1
  .\scripts\start-deployed-web-conformance.ps1 -GatewayRuntime lambda-dark
  .\scripts\start-deployed-web-conformance.ps1 -GatewayRuntime lambda-dark -BridgeSmokeTest
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging -EnableWorkloadConformance
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging -ValidateOnly
  .\scripts\start-deployed-web-conformance.ps1 -ValidateOnly

Starts only the local Next.js web client and routes its server-held BFF to the selected deployed
gateway. For development lambda-dark conformance, a loopback-only bridge validates each real
Auth0 access token with the shared verifier and invokes only the immutable development alias. The
resolved gateway URL and tokens remain process-scoped and are never written or printed.

Options:
  -Environment  Deployed environment: development or staging. Default: development
  -GatewayRuntime
                Gateway under test: ecs or lambda-dark. lambda-dark is development-only and does
                not change the public API route. Default: ecs
  -AwsProfile   IAM Identity Center profile. Default: ai-job-apply-<environment>-admin
  -AwsRegion    AWS region. Default: us-east-2
  -EnableWorkloadConformance
                Expose the fixed local-only staging workload control. Staging only.
  -BridgeSmokeTest
                Start, verify 200/200/401, and stop the loopback dark Lambda bridge without
                starting the web client. Requires -GatewayRuntime lambda-dark.
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
if ($GatewayRuntime -eq "lambda-dark" -and $Environment -ne "development") {
  throw "Dark Lambda conformance is currently restricted to development."
}
if ($GatewayRuntime -eq "lambda-dark" -and $EnableWorkloadConformance) {
  throw "Staging workload conformance cannot be combined with development dark Lambda conformance."
}
if ($BridgeSmokeTest -and $GatewayRuntime -ne "lambda-dark") {
  throw "Bridge smoke testing requires -GatewayRuntime lambda-dark."
}
if ($BridgeSmokeTest -and $ValidateOnly) {
  throw "Bridge smoke testing and validation-only mode are separate checks."
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
$caller = $callerOutput | ConvertFrom-Json
if ([string]$caller.Account -notmatch "^[0-9]{12}$") {
  throw "The $Environment AWS account could not be identified."
}

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
$previousNodeEnvironment = $env:NODE_ENV
$previousDarkConformance = $env:DARK_LAMBDA_CONFORMANCE
$previousDarkFunctionName = $env:DARK_LAMBDA_FUNCTION_NAME
$previousDarkAlias = $env:DARK_LAMBDA_ALIAS
$previousDarkExpectedVersion = $env:DARK_LAMBDA_EXPECTED_VERSION
$previousDarkBridgePort = $env:DARK_LAMBDA_BRIDGE_PORT
$previousOidcIssuer = $env:OIDC_ISSUER
$previousOidcAudience = $env:OIDC_AUDIENCE
$previousTerraformDataDirectory = $env:TF_DATA_DIR
$previousAccessKeyId = $env:AWS_ACCESS_KEY_ID
$previousSecretAccessKey = $env:AWS_SECRET_ACCESS_KEY
$previousSessionToken = $env:AWS_SESSION_TOKEN
$bridgeProcess = $null
$bridgePort = 4400
$bridgeUrl = "http://127.0.0.1:$bridgePort"
$terraformDataDirectory = Join-Path `
  $repositoryRoot `
  "infrastructure\terraform\environments\$Environment\.terraform\deployed-web-conformance-data"

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $AwsRegion
  $env:AWS_DEFAULT_REGION = $AwsRegion
  $env:TF_DATA_DIR = $terraformDataDirectory

  $exportedCredentials = & aws configure export-credentials `
    --profile $AwsProfile `
    --format process 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "The $Environment AWS session could not export short-lived Terraform credentials."
  }
  $processCredentials = $exportedCredentials | ConvertFrom-Json
  if (
    -not $processCredentials.AccessKeyId -or
    -not $processCredentials.SecretAccessKey -or
    -not $processCredentials.SessionToken
  ) {
    throw "The $Environment AWS session returned incomplete short-lived credentials."
  }
  $env:AWS_ACCESS_KEY_ID = [string]$processCredentials.AccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = [string]$processCredentials.SecretAccessKey
  $env:AWS_SESSION_TOKEN = [string]$processCredentials.SessionToken

  $stateBucket = "ai-job-apply-$Environment-terraform-state-$($caller.Account)"
  $stateEncryption = Invoke-AwsJson `
    -Arguments @(
      "s3api", "get-bucket-encryption",
      "--bucket", $stateBucket,
      "--profile", $AwsProfile,
      "--region", $AwsRegion,
      "--no-cli-pager",
      "--output", "json"
    ) `
    -FailureMessage "The encrypted $Environment Terraform state bucket could not be inspected."
  $stateKmsRules = @(
    $stateEncryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
    }
  )
  if ($stateKmsRules.Count -ne 1) {
    throw "The $Environment Terraform state bucket does not expose one KMS default."
  }
  $stateKmsKeyArn = [string]$stateKmsRules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if (
    $stateKmsKeyArn -notmatch
      "^arn:aws:kms:$([regex]::Escape($AwsRegion)):$([regex]::Escape([string]$caller.Account)):key/"
  ) {
    throw "The $Environment Terraform state KMS key is outside the expected account or region."
  }

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  Push-Location $repositoryRoot
  try {
    $initOutput = & terraform `
      "-chdir=$terraformDirectory" `
      init `
      -reconfigure `
      -input=false `
      "-backend-config=bucket=$stateBucket" `
      "-backend-config=key=platform.tfstate" `
      "-backend-config=region=$AwsRegion" `
      "-backend-config=kms_key_id=$stateKmsKeyArn" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Terraform could not initialize the encrypted $Environment backend."
    }
  } finally {
    Pop-Location
  }
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
    if ($GatewayRuntime -eq "lambda-dark") {
      $lambdaFunctionOutput = & terraform `
        "-chdir=$terraformDirectory" `
        output `
        -raw `
        gateway_lambda_function_name 2>&1
      $lambdaFunctionTerraformExitCode = $LASTEXITCODE
      $lambdaAliasOutput = & terraform `
        "-chdir=$terraformDirectory" `
        output `
        -raw `
        gateway_lambda_alias_arn 2>&1
      $lambdaAliasTerraformExitCode = $LASTEXITCODE
      $lambdaAuthorizerOutput = & terraform `
        "-chdir=$terraformDirectory" `
        output `
        -raw `
        gateway_lambda_authorizer_id 2>&1
      $lambdaAuthorizerTerraformExitCode = $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
  if ($gatewayTerraformExitCode -ne 0 -or $clusterTerraformExitCode -ne 0) {
    throw "The deployed outputs could not be resolved from encrypted $Environment state."
  }
  if (
    $GatewayRuntime -eq "lambda-dark" -and
    (
      $lambdaFunctionTerraformExitCode -ne 0 -or
      $lambdaAliasTerraformExitCode -ne 0 -or
      $lambdaAuthorizerTerraformExitCode -ne 0
    )
  ) {
    throw "The dark Lambda outputs could not be resolved from encrypted development state."
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

  $lambdaAliasVersion = $null
  if ($GatewayRuntime -eq "lambda-dark") {
    $lambdaFunctionName = ([string]$lambdaFunctionOutput).Trim()
    $lambdaAliasArn = ([string]$lambdaAliasOutput).Trim()
    $lambdaAuthorizerId = ([string]$lambdaAuthorizerOutput).Trim()
    if (
      $lambdaFunctionName -cne "ai-job-apply-development-gateway" -or
      $lambdaAliasArn -notmatch ":function:ai-job-apply-development-gateway:development$" -or
      [string]::IsNullOrWhiteSpace($lambdaAuthorizerId)
    ) {
      throw "The dark Lambda outputs are outside the exact development boundary."
    }

    $lambdaAlias = Invoke-AwsJson `
      -Arguments @(
        "lambda", "get-alias",
        "--function-name", $lambdaFunctionName,
        "--name", "development",
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development dark Lambda alias could not be inspected."
    $lambdaAliasVersion = [string]$lambdaAlias.FunctionVersion
    if ($lambdaAliasVersion -notmatch "^[1-9][0-9]*$") {
      throw "The development alias does not target an immutable Lambda version."
    }

    $lambdaConfiguration = Invoke-AwsJson `
      -Arguments @(
        "lambda", "get-function-configuration",
        "--function-name", $lambdaFunctionName,
        "--qualifier", "development",
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development dark Lambda configuration could not be inspected."
    $lambdaEnvironment = $lambdaConfiguration.Environment.Variables
    if (
      $lambdaConfiguration.State -ne "Active" -or
      $lambdaConfiguration.LastUpdateStatus -ne "Successful" -or
      [string]$lambdaConfiguration.Version -cne $lambdaAliasVersion -or
      [string]$lambdaEnvironment.OIDC_ISSUER -cne $expectedIssuer -or
      [string]$lambdaEnvironment.OIDC_AUDIENCE -cne $auth0Audience
    ) {
      throw "The development dark Lambda is not active on the reviewed identity boundary."
    }

    $lambdaConcurrency = Invoke-AwsJson `
      -Arguments @(
        "lambda", "get-function-concurrency",
        "--function-name", $lambdaFunctionName,
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development dark Lambda concurrency could not be inspected."
    if ([int]$lambdaConcurrency.ReservedConcurrentExecutions -ne 2) {
      throw "The development dark Lambda is outside the reviewed concurrency ceiling."
    }

    $apiId = $parsedGateway.Host.Split(".")[0]
    if ([string]::IsNullOrWhiteSpace($apiId)) {
      throw "The development API identifier could not be resolved."
    }
    $routes = Invoke-AwsJson `
      -Arguments @(
        "apigatewayv2", "get-routes",
        "--api-id", $apiId,
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development API routes could not be inspected."
    $routeItems = @($routes.Items)
    if (
      $routeItems.Count -ne 1 -or
      [string]$routeItems[0].RouteKey -cne '$default' -or
      [string]$routeItems[0].AuthorizationType -cne "NONE" -or
      [string]$routeItems[0].Target -notmatch "^integrations/(?<integration>[A-Za-z0-9]+)$"
    ) {
      throw "The development public API route changed from the approved ECS rollback path."
    }
    $integrationId = $Matches["integration"]
    $integration = Invoke-AwsJson `
      -Arguments @(
        "apigatewayv2", "get-integration",
        "--api-id", $apiId,
        "--integration-id", $integrationId,
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development public API integration could not be inspected."
    if ([string]$integration.IntegrationType -cne "HTTP_PROXY") {
      throw "The development public API no longer targets the approved ECS HTTP proxy."
    }

    $authorizer = Invoke-AwsJson `
      -Arguments @(
        "apigatewayv2", "get-authorizer",
        "--api-id", $apiId,
        "--authorizer-id", $lambdaAuthorizerId,
        "--profile", $AwsProfile,
        "--region", $AwsRegion,
        "--no-cli-pager",
        "--output", "json"
      ) `
      -FailureMessage "The development dark JWT authorizer could not be inspected."
    if (
      [string]$authorizer.AuthorizerType -cne "JWT" -or
      @($authorizer.IdentitySource).Count -ne 1 -or
      [string]@($authorizer.IdentitySource)[0] -cne '$request.header.Authorization' -or
      [string]$authorizer.JwtConfiguration.Issuer -cne $expectedIssuer -or
      @($authorizer.JwtConfiguration.Audience).Count -ne 1 -or
      [string]@($authorizer.JwtConfiguration.Audience)[0] -cne $auth0Audience
    ) {
      throw "The development dark JWT authorizer does not match the reviewed Auth0 boundary."
    }
  }

  $liveStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/health/live"))
  $readyStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/health/ready"))
  $protectedStatus = Get-HttpStatus -Uri ([Uri]::new($parsedGateway, "/v1/me"))
  if ($liveStatus -ne 200 -or $readyStatus -ne 200 -or $protectedStatus -ne 401) {
    throw "The deployed gateway did not pass the expected 200/200/401 health and access preflight."
  }

  $runtimeLabel = if ($GatewayRuntime -eq "lambda-dark") {
    "dark Lambda alias, JWT authorizer, unchanged ECS route"
  } else {
    "ECS gateway"
  }
  Write-Host "$environmentLabel AWS, Terraform, local Auth0, $runtimeLabel, and health prerequisites passed."
  if ($ValidateOnly) {
    Write-Host "Validation-only mode complete; no server was started."
    return
  }

  if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
    throw "Port 3000 is already in use. Stop the existing process before starting conformance."
  }
  if (
    $GatewayRuntime -eq "lambda-dark" -and
    (Get-NetTCPConnection -State Listen -LocalPort $bridgePort -ErrorAction SilentlyContinue)
  ) {
    throw "Port $bridgePort is already in use. Stop the existing process before starting conformance."
  }

  if ($GatewayRuntime -eq "lambda-dark") {
    $env:NODE_ENV = "development"
    $env:DARK_LAMBDA_CONFORMANCE = "1"
    $env:DARK_LAMBDA_FUNCTION_NAME = $lambdaFunctionName
    $env:DARK_LAMBDA_ALIAS = "development"
    $env:DARK_LAMBDA_EXPECTED_VERSION = $lambdaAliasVersion
    $env:DARK_LAMBDA_BRIDGE_PORT = [string]$bridgePort
    $env:OIDC_ISSUER = $expectedIssuer
    $env:OIDC_AUDIENCE = $auth0Audience

    Push-Location $repositoryRoot
    try {
      pnpm --filter @ai-job-apply/gateway... build
      if ($LASTEXITCODE -ne 0) {
        throw "The dark Lambda conformance bridge and shared verifier could not be built."
      }
    } finally {
      Pop-Location
    }

    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    $bridgeEntryPoint = Join-Path `
      $repositoryRoot `
      "backend\gateway\dist\src\dark-conformance-bridge.js"
    if (-not (Test-Path -LiteralPath $bridgeEntryPoint)) {
      throw "The compiled dark Lambda conformance bridge is unavailable."
    }
    $bridgeProcess = Start-Process `
      -FilePath $nodeCommand `
      -ArgumentList @($bridgeEntryPoint) `
      -WorkingDirectory $repositoryRoot `
      -WindowStyle Hidden `
      -PassThru
    $bridgeDeadline = (Get-Date).AddSeconds(60)
    $bridgeReady = $false
    while ((Get-Date) -lt $bridgeDeadline -and -not $bridgeReady) {
      if ($bridgeProcess.HasExited) {
        throw "The loopback dark Lambda conformance bridge exited before becoming ready."
      }
      try {
        $bridgeLiveStatus = Get-HttpStatus -Uri ([Uri]::new("$bridgeUrl/health/live"))
        $bridgeReadyStatus = Get-HttpStatus -Uri ([Uri]::new("$bridgeUrl/health/ready"))
        $bridgeProtectedStatus = Get-HttpStatus -Uri ([Uri]::new("$bridgeUrl/v1/me"))
        $bridgeReady = (
          $bridgeLiveStatus -eq 200 -and
          $bridgeReadyStatus -eq 200 -and
          $bridgeProtectedStatus -eq 401
        )
        if (-not $bridgeReady) {
          Start-Sleep -Milliseconds 500
        }
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
    if (-not $bridgeReady) {
      throw "The loopback dark Lambda bridge did not pass the expected 200/200/401 preflight."
    }
    if ($BridgeSmokeTest) {
      Write-Host "Development dark Lambda bridge smoke test passed: 200/200/401."
      return
    }
    $env:PLATFORM_API_BASE_URL = $bridgeUrl
  } else {
    $env:PLATFORM_API_BASE_URL = $gatewayUrl
  }
  if ($EnableWorkloadConformance) {
    $env:ENABLE_STAGING_WORKLOAD_CONFORMANCE = "1"
  } else {
    Remove-Item Env:ENABLE_STAGING_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
  }
  Write-Host "Starting the local web client at http://localhost:3000."
  if ($GatewayRuntime -eq "lambda-dark") {
    Write-Host "Its server-held BFF targets the loopback-guarded immutable development Lambda alias."
    Write-Host "The public API remains on ECS. Press Ctrl+C to stop both local processes."
  } else {
    Write-Host "Its server-held BFF targets the deployed $Environment ECS gateway. Press Ctrl+C to stop."
  }
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
  if ($null -ne $bridgeProcess -and -not $bridgeProcess.HasExited) {
    Stop-Process -Id $bridgeProcess.Id -ErrorAction SilentlyContinue
    $bridgeStopDeadline = (Get-Date).AddSeconds(10)
    while (
      (Get-Date) -lt $bridgeStopDeadline -and
      (Get-Process -Id $bridgeProcess.Id -ErrorAction SilentlyContinue)
    ) {
      Start-Sleep -Milliseconds 100
    }
  }
  $env:AWS_PROFILE = $previousProfile
  $env:AWS_REGION = $previousRegion
  $env:AWS_DEFAULT_REGION = $previousDefaultRegion
  $env:PLATFORM_API_BASE_URL = $previousPlatformBaseUrl
  if ($null -eq $previousWorkloadConformance) {
    Remove-Item Env:ENABLE_STAGING_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
  } else {
    $env:ENABLE_STAGING_WORKLOAD_CONFORMANCE = $previousWorkloadConformance
  }
  $env:NODE_ENV = $previousNodeEnvironment
  $env:DARK_LAMBDA_CONFORMANCE = $previousDarkConformance
  $env:DARK_LAMBDA_FUNCTION_NAME = $previousDarkFunctionName
  $env:DARK_LAMBDA_ALIAS = $previousDarkAlias
  $env:DARK_LAMBDA_EXPECTED_VERSION = $previousDarkExpectedVersion
  $env:DARK_LAMBDA_BRIDGE_PORT = $previousDarkBridgePort
  $env:OIDC_ISSUER = $previousOidcIssuer
  $env:OIDC_AUDIENCE = $previousOidcAudience
  $env:TF_DATA_DIR = $previousTerraformDataDirectory
  $env:AWS_ACCESS_KEY_ID = $previousAccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = $previousSecretAccessKey
  $env:AWS_SESSION_TOKEN = $previousSessionToken
}
