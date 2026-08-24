[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [string]$AwsProfile = "",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$AwsRegion = "us-east-2",
  [switch]$EnableWorkloadConformance,
  [switch]$EnableD1WorkloadConformance,
  [switch]$ValidateOnly,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\start-deployed-web-conformance.ps1
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging
  .\scripts\start-deployed-web-conformance.ps1 -Environment staging -EnableWorkloadConformance
  .\scripts\start-deployed-web-conformance.ps1 -Environment development -EnableD1WorkloadConformance
  .\scripts\start-deployed-web-conformance.ps1 -Environment development -ValidateOnly

Validates the selected environment's steady-state API Gateway/Lambda runtime, then starts only the
local Next.js web client. The server-held BFF targets the deployed HTTPS API. Retired ECS, dark,
cutover, and provider fallback modes are intentionally unavailable.
"@
  exit 0
}

if ($AwsRegion -cne "us-east-2") {
  throw "Deployed conformance is restricted to us-east-2."
}
if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}
foreach ($name in @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")) {
  if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    throw "Clear explicit AWS credential environment variables before deployed conformance."
  }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$backendMetadataPath = Join-Path $terraformDirectory ".terraform\terraform.tfstate"
$terraformDataDirectory = Join-Path $terraformDirectory ".terraform\deployed-web-conformance-data"
$webEnvironment = Join-Path $repositoryRoot "frontend\web\.env.local"
$expectedFunctionName = "ai-job-apply-$Environment-gateway"

if (-not (Test-Path -LiteralPath $webEnvironment -PathType Leaf)) {
  throw "frontend/web/.env.local is missing. Configure the Auth0 web client first."
}
if (-not (Test-Path -LiteralPath $backendMetadataPath -PathType Leaf)) {
  throw "The $Environment Terraform backend metadata is missing. Initialize its remote backend first."
}

function Get-LocalSetting {
  param([Parameter(Mandatory)][string]$Name)
  $match = Select-String -LiteralPath $webEnvironment -Pattern "^$([Regex]::Escape($Name))=(.+)$" |
    Select-Object -Last 1
  if ($null -eq $match) { throw "The local Auth0 web configuration is incomplete." }
  return $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$FailureMessage)
  $output = & aws @Arguments --profile $AwsProfile --region $AwsRegion --no-cli-pager --output json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) { throw $FailureMessage }
  try { return ($output -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw $FailureMessage }
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][Uri]$Uri)
  try {
    return [int](Invoke-WebRequest -UseBasicParsing -Uri $Uri -MaximumRedirection 0 -TimeoutSec 20).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw "The deployed API health preflight could not be completed."
  }
}

function Restore-EnvironmentVariable {
  param([Parameter(Mandatory)][string]$Name, [AllowNull()][string]$Value)
  if ($null -eq $Value) { Remove-Item "Env:$Name" -ErrorAction SilentlyContinue }
  else { [Environment]::SetEnvironmentVariable($Name, $Value, "Process") }
}

$requiredSettings = @(
  "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL",
  "AUTH0_AUDIENCE"
)
$configuredSettings = @(
  Select-String -LiteralPath $webEnvironment -Pattern "^([A-Z0-9_]+)=.+" |
    ForEach-Object { ($_.Line -split "=", 2)[0] } | Sort-Object -Unique
)
$missingSettings = @($requiredSettings | Where-Object { $_ -notin $configuredSettings })
if ($missingSettings.Count -ne 0) {
  throw "The local Auth0 web configuration is incomplete. Missing: $($missingSettings -join ', ')."
}

$auth0Domain = Get-LocalSetting "AUTH0_DOMAIN"
$auth0Audience = Get-LocalSetting "AUTH0_AUDIENCE"
$appBaseUrl = Get-LocalSetting "APP_BASE_URL"
$expectedIssuer = "https://$($auth0Domain.TrimEnd('/'))/"
$parsedIssuer = $null
if (
  -not [Uri]::TryCreate($expectedIssuer, [UriKind]::Absolute, [ref]$parsedIssuer) -or
  $parsedIssuer.Scheme -cne "https" -or $parsedIssuer.UserInfo -or
  $parsedIssuer.AbsolutePath -cne "/" -or $parsedIssuer.Query -or $parsedIssuer.Fragment
) { throw "AUTH0_DOMAIN must contain only a valid HTTPS identity-provider host." }
if ($appBaseUrl.TrimEnd("/") -cne "http://localhost:3000") {
  throw "APP_BASE_URL must be http://localhost:3000 for deployed web conformance."
}

$terraformVersion = (& terraform version -json 2>$null | ConvertFrom-Json).terraform_version
if ($LASTEXITCODE -ne 0 -or $terraformVersion -cne "1.9.8") {
  throw "Terraform 1.9.8 is required."
}
$caller = Invoke-AwsJson @("sts", "get-caller-identity") "The $Environment AWS session is unavailable."
if ([string]$caller.Account -notmatch "^[0-9]{12}$" -or -not ([string]$caller.Arn).Contains(":assumed-role/")) {
  throw "Use the temporary IAM Identity Center session for the selected environment."
}

$backendMetadata = try { Get-Content -Raw -LiteralPath $backendMetadataPath | ConvertFrom-Json }
catch { throw "The $Environment Terraform backend metadata is unreadable." }
$backend = $backendMetadata.backend
$stateBucket = [string]$backend.config.bucket
if (
  [string]$backend.type -cne "s3" -or
  [string]$backend.config.key -cne "platform.tfstate" -or
  [string]$backend.config.region -cne $AwsRegion -or
  $stateBucket -notmatch "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
) { throw "The $Environment backend metadata is outside the reviewed state boundary." }
$encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $stateBucket) `
  "The $Environment state encryption could not be inspected."
$kmsRules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
  $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
  $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
})
if ($kmsRules.Count -ne 1) { throw "The state bucket does not expose one KMS default." }
$stateKmsKeyArn = [string]$kmsRules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
if ($stateKmsKeyArn -notmatch "^arn:aws:kms:$([Regex]::Escape($AwsRegion)):$([Regex]::Escape([string]$caller.Account)):key/") {
  throw "The state KMS key is outside the selected account and region."
}

$savedEnvironment = @{}
foreach ($name in @(
  "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "TF_DATA_DIR", "PLATFORM_API_BASE_URL",
  "ENABLE_PHASE0_WORKLOAD_CONFORMANCE", "PHASE0_WORKLOAD_ENVIRONMENT",
  "ENABLE_D1_WORKLOAD_CONFORMANCE", "D1_WORKLOAD_ENVIRONMENT",
  "DEPLOYED_PLATFORM_CONFORMANCE"
)) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $AwsRegion
  $env:AWS_DEFAULT_REGION = $AwsRegion
  $env:TF_DATA_DIR = $terraformDataDirectory
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force

  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$stateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$AwsRegion" "-backend-config=kms_key_id=$stateKmsKeyArn" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Terraform could not initialize the encrypted backend." }

  $gatewayUrl = (& terraform "-chdir=$terraformDirectory" output -raw gateway_url 2>$null).TrimEnd("/")
  $clusterArn = (& terraform "-chdir=$terraformDirectory" output -raw ecs_cluster_arn 2>$null).Trim()
  $functionName = (& terraform "-chdir=$terraformDirectory" output -raw gateway_lambda_function_name 2>$null).Trim()
  $aliasArn = (& terraform "-chdir=$terraformDirectory" output -raw gateway_lambda_alias_arn 2>$null).Trim()
  $authorizerId = (& terraform "-chdir=$terraformDirectory" output -raw gateway_lambda_authorizer_id 2>$null).Trim()
  $mappingId = (& terraform "-chdir=$terraformDirectory" output -raw outbox_starter_event_source_mapping_uuid 2>$null).Trim()
  $reconcilerRuleArn = (& terraform "-chdir=$terraformDirectory" output -raw outbox_reconciler_rule_arn 2>$null).Trim()
  $terminalRuleArn = (& terraform "-chdir=$terraformDirectory" output -raw profile_readiness_terminal_rule_arn 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $gatewayUrl -or -not $clusterArn -or -not $functionName -or
      -not $aliasArn -or -not $authorizerId -or -not $mappingId -or -not $reconcilerRuleArn -or
      -not $terminalRuleArn) { throw "The deployed runtime outputs are incomplete." }

  $parsedGateway = $null
  if (-not [Uri]::TryCreate($gatewayUrl, [UriKind]::Absolute, [ref]$parsedGateway) -or
      $parsedGateway.Scheme -cne "https" -or $parsedGateway.UserInfo) {
    throw "The deployed gateway output is not an approved HTTPS origin."
  }
  if ($functionName -cne $expectedFunctionName -or
      $aliasArn -notmatch ":function:$([Regex]::Escape($expectedFunctionName)):$([Regex]::Escape($Environment))$") {
    throw "The Lambda outputs are outside the selected environment."
  }

  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $functionName, "--name", $Environment) `
    "The immutable gateway alias could not be inspected."
  $configuration = Invoke-AwsJson @(
    "lambda", "get-function-configuration", "--function-name", $functionName, "--qualifier", $Environment
  ) "The gateway Lambda configuration could not be inspected."
  $expectedConcurrency = if ($Environment -eq "staging") { 5 } else { 2 }
  $concurrency = Invoke-AwsJson @("lambda", "get-function-concurrency", "--function-name", $functionName) `
    "The gateway concurrency could not be inspected."
  if (
    [string]$alias.FunctionVersion -notmatch "^[1-9][0-9]*$" -or
    [string]$configuration.Version -cne [string]$alias.FunctionVersion -or
    [string]$configuration.State -cne "Active" -or
    [string]$configuration.LastUpdateStatus -cne "Successful" -or
    [string]$configuration.Environment.Variables.OIDC_ISSUER -cne $expectedIssuer -or
    [string]$configuration.Environment.Variables.OIDC_AUDIENCE -cne $auth0Audience -or
    [string]$configuration.Environment.Variables.OUTBOX_DISPATCH_TARGET -cne "lambda_durable" -or
    [int]$concurrency.ReservedConcurrentExecutions -ne $expectedConcurrency
  ) { throw "The gateway Lambda is outside the reviewed steady-state boundary." }

  $services = Invoke-AwsJson @("ecs", "list-services", "--cluster", $clusterArn) `
    "The retained migration cluster could not be inspected."
  $runningTasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $clusterArn, "--desired-status", "RUNNING") `
    "The retained migration cluster task inventory could not be inspected."
  if (@($services.serviceArns).Count -ne 0 -or @($runningTasks.taskArns).Count -ne 0) {
    throw "A retired continuous ECS application path is still active."
  }

  $mapping = Invoke-AwsJson @("lambda", "get-event-source-mapping", "--uuid", $mappingId) `
    "The durable outbox trigger could not be inspected."
  if ([string]$mapping.State -cne "Enabled") { throw "The durable outbox trigger is not enabled." }
  foreach ($ruleArn in @($reconcilerRuleArn, $terminalRuleArn)) {
    $ruleName = $ruleArn.Substring($ruleArn.LastIndexOf("/") + 1)
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $ruleName) `
      "A durable runtime rule could not be inspected."
    if ([string]$rule.State -cne "ENABLED") { throw "A durable runtime rule is not enabled." }
  }

  $api = Invoke-AwsJson @("apigatewayv2", "get-api", "--api-id", $parsedGateway.Host.Split(".")[0]) `
    "The public API could not be inspected."
  $authorizer = Invoke-AwsJson @(
    "apigatewayv2", "get-authorizer", "--api-id", $api.ApiId, "--authorizer-id", $authorizerId
  ) "The JWT authorizer could not be inspected."
  if (
    [string]$authorizer.AuthorizerType -cne "JWT" -or
    [string]$authorizer.JwtConfiguration.Issuer -cne $expectedIssuer -or
    @($authorizer.JwtConfiguration.Audience).Count -ne 1 -or
    [string]$authorizer.JwtConfiguration.Audience[0] -cne $auth0Audience
  ) { throw "The public JWT authorizer does not match local Auth0 configuration." }

  $live = Get-HttpStatus ([Uri]::new($parsedGateway, "/health/live"))
  $ready = Get-HttpStatus ([Uri]::new($parsedGateway, "/health/ready"))
  $protected = Get-HttpStatus ([Uri]::new($parsedGateway, "/v1/me"))
  if ($live -ne 200 -or $ready -ne 200 -or $protected -ne 401) {
    throw "The deployed API did not pass the expected 200/200/401 boundary."
  }

  Write-Host "$Environment steady-state AWS, Terraform, Auth0, Lambda durable triggers, and 200/200/401 prerequisites passed."
  if ($ValidateOnly) { Write-Host "Validation-only mode complete; no server was started."; return }
  if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
    throw "Port 3000 is already in use. Stop the existing process before starting conformance."
  }

  $env:PLATFORM_API_BASE_URL = $gatewayUrl
  $env:DEPLOYED_PLATFORM_CONFORMANCE = "1"
  if ($EnableWorkloadConformance) {
    $env:ENABLE_PHASE0_WORKLOAD_CONFORMANCE = "1"
    $env:PHASE0_WORKLOAD_ENVIRONMENT = $Environment
  } else {
    Remove-Item Env:ENABLE_PHASE0_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
    Remove-Item Env:PHASE0_WORKLOAD_ENVIRONMENT -ErrorAction SilentlyContinue
  }
  if ($EnableD1WorkloadConformance) {
    $env:ENABLE_D1_WORKLOAD_CONFORMANCE = "1"
    $env:D1_WORKLOAD_ENVIRONMENT = $Environment
  } else {
    Remove-Item Env:ENABLE_D1_WORKLOAD_CONFORMANCE -ErrorAction SilentlyContinue
    Remove-Item Env:D1_WORKLOAD_ENVIRONMENT -ErrorAction SilentlyContinue
  }

  Write-Host "Starting the local web client at http://localhost:3000."
  if ($EnableD1WorkloadConformance) {
    Write-Host "The bounded D1 read workload is available at http://localhost:3000/d1-conformance."
  }
  Write-Host "Its server-held BFF targets the deployed $Environment API Gateway/Lambda runtime. Press Ctrl+C to stop."
  Push-Location $repositoryRoot
  try {
    pnpm --filter @ai-job-apply/web dev
    if ($LASTEXITCODE -ne 0) { throw "The local web client exited with code $LASTEXITCODE." }
  } finally { Pop-Location }
} finally {
  foreach ($entry in $savedEnvironment.GetEnumerator()) {
    Restore-EnvironmentVariable -Name $entry.Key -Value $entry.Value
  }
}
