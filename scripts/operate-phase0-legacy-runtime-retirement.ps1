[CmdletBinding()]
param(
  [ValidateSet("development", "staging")][string]$Environment,
  [ValidateSet("Plan", "Status", "Apply", "Verify")][string]$Action = "Status",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$BaselinePlanPath = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-fA-F0-9]{64}$")][string]$ExpectedPlanSha256 = "",
  [ValidatePattern("^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$")]
  [string]$RollbackExpiredAt = "2026-08-08T02:56:32.831Z",
  [string]$AwsProfile = "",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$ConfirmRollbackExpired,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Help) {
  @"
Usage:
  .\scripts\operate-ENVIRONMENT-legacy-runtime-retirement.ps1 `
    -Action Plan -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -BaselinePlanPath .terraform/workflow-dark-plans/serverless-runtime-cutover-verify-COMMIT.tfplan

  .\scripts\operate-ENVIRONMENT-legacy-runtime-retirement.ps1 `
    -Action Status -PlanPath .terraform/workflow-dark-plans/legacy-runtime-retirement-COMMIT.tfplan

  .\scripts\operate-ENVIRONMENT-legacy-runtime-retirement.ps1 `
    -Action Apply -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/legacy-runtime-retirement-COMMIT.tfplan `
    -ExpectedPlanSha256 REVIEWED_SHA256 -ConfirmRollbackExpired -Execute

  .\scripts\operate-ENVIRONMENT-legacy-runtime-retirement.ps1 `
    -Action Verify -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/legacy-runtime-retirement-COMMIT.tfplan

Plan creates, but does not apply, the exact legacy rollback retirement. Status is local and
read-only. Apply accepts only the checksum-reviewed current-main plan and requires the explicit
rollback-expiry confirmation. Verify proves a fresh zero-change plan, the Lambda API boundary,
enabled durable triggers, and absence of the legacy ECS/API/Cloud Map/heartbeat resources.
The RDS database, S3, SQS/DLQ, KMS, backups, ECR migration capability, ECS cluster, migration task,
Lambda runtime, alarms, budgets, and cost exports remain retained.
"@
  exit 0
}

if ($Region -ne "us-east-2") { throw "Legacy runtime retirement is restricted to us-east-2." }
if ($Action -in @("Plan", "Apply", "Verify") -and (
  $ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)
)) { throw "$Action requires the exact $Environment account ID and encrypted state bucket." }
if ($Action -eq "Plan" -and [string]::IsNullOrWhiteSpace($BaselinePlanPath)) {
  throw "Plan requires the last accepted zero-drift serverless runtime -BaselinePlanPath."
}
if ($Action -in @("Status", "Apply", "Verify") -and [string]::IsNullOrWhiteSpace($PlanPath)) {
  throw "$Action requires the saved legacy-retirement -PlanPath."
}
if ($Action -eq "Apply" -and (-not $Execute -or -not $ConfirmRollbackExpired)) {
  throw "Apply requires both -ConfirmRollbackExpired and -Execute."
}
if ($Action -ne "Apply" -and ($Execute -or $ConfirmRollbackExpired)) {
  throw "$Action does not accept -Execute or -ConfirmRollbackExpired."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $environmentDirectory ".terraform"))
$planDirectory = [IO.Path]::GetFullPath((Join-Path $terraformRoot "workflow-dark-plans"))
$terraformDataDirectory = Join-Path $terraformRoot "legacy-retirement-data"
$retirementAddresses = @(
  "module.platform.aws_apigatewayv2_integration.gateway[0]",
  "module.platform.aws_apigatewayv2_vpc_link.gateway[0]",
  "module.platform.aws_cloudwatch_log_metric_filter.gateway_log_heartbeat[0]",
  "module.platform.aws_cloudwatch_log_metric_filter.worker_log_heartbeat[0]",
  "module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
  "module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]",
  "module.platform.aws_ecs_service.gateway[0]",
  "module.platform.aws_ecs_service.worker[0]",
  "module.platform.aws_ecs_task_definition.gateway[0]",
  "module.platform.aws_ecs_task_definition.worker[0]",
  "module.platform.aws_iam_role_policy.application_tracing[0]",
  "module.platform.aws_service_discovery_private_dns_namespace.application[0]",
  "module.platform.aws_service_discovery_service.gateway[0]"
) | Sort-Object
$dashboardAddress = "module.platform.aws_cloudwatch_dashboard.operations"

function Assert-Tools {
  foreach ($command in @("aws", "git", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }
  $terraformVersion = & terraform version -json 2>$null | ConvertFrom-Json
  if ([string]$terraformVersion.terraform_version -ne "1.9.8") { throw "Terraform 1.9.8 is required." }
}

function Assert-ExactMain {
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
  if ($branch -ne "main" -or $head -ne $upstream -or $dirty.Count -ne 0) {
    throw "Use an exact clean upstream-matched main checkout for $Environment retirement."
  }
  return $head
}

function Resolve-GuardedPlanPath {
  param([string]$CandidatePath, [string]$Purpose)
  $candidate = if ([IO.Path]::IsPathRooted($CandidatePath)) {
    [IO.Path]::GetFullPath($CandidatePath)
  } else { [IO.Path]::GetFullPath((Join-Path $environmentDirectory $CandidatePath)) }
  $prefix = $planDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "The $Purpose plan must exist below $Environment .terraform/workflow-dark-plans."
  }
  return $candidate
}

function Get-PlanJson {
  param([string]$Path)
  $raw = & terraform "-chdir=$environmentDirectory" show -json $Path 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "The saved Terraform plan could not be inspected." }
  return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
}

function Get-PlanVariable {
  param([object]$Plan, [string]$Name, [switch]$Optional)
  $property = @($Plan.variables.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if ($property.Count -eq 0 -and $Optional) { return $null }
  if ($property.Count -ne 1 -or $property[0].Value.PSObject.Properties.Name -notcontains "value") {
    throw "The plan does not contain exact input '$Name'."
  }
  return $property[0].Value.value
}

function Get-BooleanVariable {
  param([object]$Plan, [string]$Name)
  $value = Get-PlanVariable $Plan $Name
  if ($value -is [bool]) { return $value }
  if ([string]$value -ceq "true") { return $true }
  if ([string]$value -ceq "false") { return $false }
  throw "Plan input '$Name' is not boolean."
}

function Assert-RuntimeInputs {
  param([object]$Plan, [bool]$ExpectRetained)
  foreach ($name in @(
    "deploy_applications", "deploy_gateway_lambda", "deploy_serverless_outbox",
    "deploy_profile_readiness_durable", "serverless_runtime_cutover"
  )) {
    if (-not (Get-BooleanVariable $Plan $name)) { throw "Runtime input '$name' must remain enabled." }
  }
  if (Get-BooleanVariable $Plan "run_continuous_ecs_runtime") {
    throw "Continuous ECS capacity must be disabled before retirement."
  }
  $retention = Get-PlanVariable $Plan "retain_legacy_ecs_rollback" -Optional
  $retained = if ($null -eq $retention) { $true } else { Get-BooleanVariable $Plan "retain_legacy_ecs_rollback" }
  if ($retained -ne $ExpectRetained) { throw "The plan has the wrong legacy rollback retention state." }
  if (-not $ExpectRetained) {
    $expiry = Get-PlanVariable $Plan "legacy_ecs_rollback_expired_at"
    $parsed = if ($expiry -is [DateTime]) { [DateTimeOffset]$expiry } else { [DateTimeOffset]::MinValue }
    $expected = [DateTimeOffset]::Parse($RollbackExpiredAt).ToUniversalTime()
    $valid = if ($expiry -is [DateTime]) { $true } else {
      [DateTimeOffset]::TryParse([string]$expiry, [ref]$parsed)
    }
    if (-not $valid -or $parsed.ToUniversalTime() -ne $expected) {
      throw "The plan is not bound to the accepted rollback expiry."
    }
    if ($parsed -gt [DateTimeOffset]::UtcNow) {
      throw "The rollback expiry is invalid or in the future."
    }
  }
}

function Assert-BaselinePlan {
  param([object]$Plan, [string]$Path)
  if ((Split-Path $Path -Leaf) -notmatch '^serverless-runtime-cutover-verify-([a-f0-9]{8})[.]tfplan$') {
    throw "The baseline must be an accepted serverless-runtime-cutover-verify plan."
  }
  $baselineCommit = (& git -C $repositoryRoot rev-parse --verify $Matches[1] 2>$null).Trim()
  if (-not $baselineCommit) { throw "The baseline plan commit is unavailable." }
  $baselineObjectType = (& git -C $repositoryRoot cat-file -t $baselineCommit 2>$null).Trim()
  if ($baselineObjectType -ne "commit") { throw "The baseline plan source is not a commit." }
  & git -C $repositoryRoot merge-base --is-ancestor $baselineCommit HEAD
  $isAncestor = $LASTEXITCODE -eq 0
  if (-not $isAncestor) {
    throw "The baseline plan commit is not an ancestor of current main."
  }
  Assert-RuntimeInputs $Plan $true
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  if ($changes.Count -ne 0) { throw "The accepted serverless baseline is not zero-change." }
}

function Assert-RetirementPlan {
  param([object]$Plan)
  Assert-RuntimeInputs $Plan $false
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  $deletes = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "delete" })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $other = @($changes | Where-Object { (@($_.change.actions) -join ",") -notin @("delete", "update") })
  $actualDeletes = @($deletes | ForEach-Object { [string]$_.address } | Sort-Object)
  if ($deletes.Count -ne 13 -or @(Compare-Object $retirementAddresses $actualDeletes).Count -ne 0) {
    throw "The plan does not contain exactly the 13 reviewed legacy-runtime deletions."
  }
  if ($updates.Count -ne 1 -or [string]$updates[0].address -ne $dashboardAddress -or $other.Count -ne 0) {
    throw "Only the operations-dashboard cleanup may accompany legacy-runtime deletion."
  }
  $dashboard = [string]$updates[0].change.after.dashboard_body
  foreach ($required in @("AWS/ApiGateway", "AWS/Lambda", "AWS/SQS", "AWS/RDS")) {
    if (-not $dashboard.Contains($required)) { throw "The retired dashboard lost required signal '$required'." }
  }
  foreach ($removed in @("AWS/ECS", "gateway-log-heartbeat", "worker-log-heartbeat")) {
    if ($dashboard.Contains($removed)) { throw "The retired dashboard still contains '$removed'." }
  }
}

function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$FailureMessage)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw $FailureMessage }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw $FailureMessage }
}

function Assert-Caller {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") "The $Environment AWS session is unavailable."
  if ([string]$caller.Account -ne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary IAM Identity Center session for the exact $Environment account."
  }
}

function Initialize-Backend {
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket) `
    "The encrypted $Environment state bucket could not be inspected."
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
    $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
    $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  })
  if ($rules.Count -ne 1) { throw "The state bucket does not expose one KMS default." }
  $keyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($keyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact account and region."
  }
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $null = & terraform "-chdir=$environmentDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$keyArn" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The pinned provider set could not initialize." }
}

function Invoke-WithPlanVariables {
  param([object]$SourcePlan, [scriptblock]$Operation)
  $saved = @{}
  $names = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($property in $SourcePlan.variables.PSObject.Properties) {
      if ($null -eq $property.Value.value) { continue }
      $name = "TF_VAR_$($property.Name)"
      if (-not $saved.ContainsKey($name)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
      $value = $property.Value.value
      $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
        elseif ($value -is [string]) { $value }
        else { $value | ConvertTo-Json -Compress -Depth 20 }
      [Environment]::SetEnvironmentVariable($name, [string]$serialized, "Process")
      $names.Add($name)
    }
    foreach ($override in @{
      TF_VAR_retain_legacy_ecs_rollback = "false"
      TF_VAR_legacy_ecs_rollback_expired_at = $RollbackExpiredAt
    }.GetEnumerator()) {
      if (-not $saved.ContainsKey($override.Key)) {
        $saved[$override.Key] = [Environment]::GetEnvironmentVariable($override.Key, "Process")
      }
      [Environment]::SetEnvironmentVariable($override.Key, [string]$override.Value, "Process")
      if (-not $names.Contains($override.Key)) { $names.Add($override.Key) }
    }
    & $Operation
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process") }
  }
}

function Invoke-WithCredentials {
  param([scriptblock]$Operation)
  $names = @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "TF_DATA_DIR")
  $saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
  try {
    $credentials = & aws configure export-credentials --profile $AwsProfile --format process 2>$null | ConvertFrom-Json
    if (-not $credentials.SessionToken) { throw "Short-lived $Environment credentials are unavailable." }
    $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
    $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region
    $env:TF_DATA_DIR = $terraformDataDirectory
    Initialize-Backend
    & $Operation
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process") }
  }
}

function Assert-PublicApi {
  param([object]$Plan)
  $api = @($Plan.planned_values.root_module.child_modules.resources | Where-Object { $_.address -eq "" })
  $output = & terraform "-chdir=$environmentDirectory" output -raw gateway_url 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($output -join ""))) {
    throw "The retained API endpoint could not be resolved."
  }
  $gatewayUrl = ($output -join "").TrimEnd('/')
  foreach ($path in @("/health/live", "/health/ready")) {
    try { $response = Invoke-WebRequest -UseBasicParsing -Uri "$gatewayUrl$path" -TimeoutSec 20 }
    catch { throw "The retained Lambda API failed $path." }
    if ([int]$response.StatusCode -ne 200) { throw "The retained Lambda API failed $path." }
  }
  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "$gatewayUrl/v1/profile" -TimeoutSec 20
    throw "The protected API unexpectedly accepted an anonymous request."
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($status -ne 401) { throw "The protected API did not preserve the JWT boundary." }
  }
}

function Assert-RetiredLiveResources {
  $prefix = "ai-job-apply-$Environment"
  $cluster = "$prefix-cluster"
  $services = @(Invoke-AwsJson @("ecs", "list-services", "--cluster", $cluster) "The ECS cluster could not be inspected.").serviceArns
  if (@($services | Where-Object { $_ -match '/(gateway|workflow-worker)$' }).Count -ne 0) {
    throw "A legacy ECS service still exists."
  }
  foreach ($family in @("$prefix-gateway", "$prefix-worker")) {
    $taskDefinitions = @(Invoke-AwsJson @("ecs", "list-task-definitions", "--family-prefix", $family, "--status", "ACTIVE") `
      "Legacy task definitions could not be inspected.").taskDefinitionArns
    if ($taskDefinitions.Count -ne 0) { throw "Active legacy task definitions still exist for $family." }
  }
  $migrationDefinitions = @(Invoke-AwsJson @(
    "ecs", "list-task-definitions", "--family-prefix", "$prefix-database-migration", "--status", "ACTIVE"
  ) "The retained migration task could not be inspected.").taskDefinitionArns
  if ($migrationDefinitions.Count -eq 0) { throw "The on-demand database migration task was not retained." }

  $apis = @(Invoke-AwsJson @("apigatewayv2", "get-apis") "API Gateway could not be inspected.").Items
  $api = @($apis | Where-Object { [string]$_.Name -eq "$prefix-gateway" })
  if ($api.Count -ne 1) { throw "The retained HTTP API is not singular." }
  $integrations = @(Invoke-AwsJson @(
    "apigatewayv2", "get-integrations", "--api-id", [string]$api[0].ApiId
  ) "API Gateway integrations could not be inspected.").Items
  if (@($integrations | Where-Object { [string]$_.IntegrationType -eq "HTTP_PROXY" }).Count -ne 0 -or
      @($integrations | Where-Object { [string]$_.IntegrationType -eq "AWS_PROXY" }).Count -ne 1) {
    throw "The retired API integration boundary is not Lambda-only."
  }
  $vpcLinks = @(Invoke-AwsJson @("apigatewayv2", "get-vpc-links") "API Gateway VPC Links could not be inspected.").Items
  if (@($vpcLinks | Where-Object { [string]$_.Name -eq "$prefix-gateway" }).Count -ne 0) {
    throw "The legacy gateway VPC Link still exists."
  }
  $namespaces = @(Invoke-AwsJson @("servicediscovery", "list-namespaces") "Cloud Map could not be inspected.").Namespaces
  if (@($namespaces | Where-Object { [string]$_.Name -eq "$prefix.internal" }).Count -ne 0) {
    throw "The legacy Cloud Map namespace still exists."
  }
  $rolePolicies = @(Invoke-AwsJson @(
    "iam", "list-role-policies", "--role-name", "$prefix-application"
  ) "The legacy application role could not be inspected.").PolicyNames
  if ($rolePolicies -contains "write-application-traces") {
    throw "The legacy application tracing policy still exists."
  }
  $alarms = @(Invoke-AwsJson @("cloudwatch", "describe-alarms", "--alarm-name-prefix", $prefix) `
    "CloudWatch alarms could not be inspected.").MetricAlarms
  if (@($alarms | Where-Object { $_.AlarmName -in @("$prefix-gateway-log-heartbeat-missing", "$prefix-worker-log-heartbeat-missing") }).Count -ne 0) {
    throw "Legacy heartbeat alarms still exist."
  }
  $filters = Invoke-AwsJson @("logs", "describe-metric-filters") "CloudWatch metric filters could not be inspected."
  if (@($filters.metricFilters | Where-Object { $_.filterName -in @("$prefix-gateway-log-heartbeat", "$prefix-worker-log-heartbeat") }).Count -ne 0) {
    throw "Legacy heartbeat metric filters still exist."
  }
  $starterMappings = @(Invoke-AwsJson @(
    "lambda", "list-event-source-mappings", "--function-name", "$prefix-outbox-starter"
  ) "The durable outbox trigger could not be inspected.").EventSourceMappings
  if ($starterMappings.Count -ne 1 -or [string]$starterMappings[0].State -ne "Enabled") {
    throw "The durable outbox trigger is not enabled."
  }
  foreach ($ruleName in @("$prefix-outbox-reconciler", "$prefix-profile-readiness-terminal")) {
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $ruleName) `
      "The durable workflow rule '$ruleName' could not be inspected."
    if ([string]$rule.State -ne "ENABLED") { throw "Durable workflow rule '$ruleName' is not enabled." }
  }
}

function Invoke-ZeroDriftPlan {
  param([object]$SourcePlan)
  $verifyPath = Join-Path $planDirectory "legacy-runtime-retirement-verify-$((& git -C $repositoryRoot rev-parse --short=8 HEAD).Trim()).tfplan"
  Invoke-WithCredentials {
    Invoke-WithPlanVariables $SourcePlan {
      $null = & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=5m -detailed-exitcode "-out=$verifyPath"
      if ($LASTEXITCODE -eq 1) { throw "The retirement verification plan failed." }
      if ($LASTEXITCODE -eq 2) { throw "The retired environment has Terraform drift." }
    }
  }
  return $verifyPath
}

Assert-Tools

if ($Action -eq "Plan") {
  $sourceCommit = Assert-ExactMain
  Assert-Caller
  $baselinePath = Resolve-GuardedPlanPath $BaselinePlanPath "baseline"
  $baseline = Get-PlanJson $baselinePath
  Assert-BaselinePlan $baseline $baselinePath
  $outputPath = Join-Path $planDirectory "legacy-runtime-retirement-$($sourceCommit.Substring(0, 8)).tfplan"
  Invoke-WithCredentials {
    Invoke-WithPlanVariables $baseline {
      $null = & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=5m "-out=$outputPath"
      if ($LASTEXITCODE -ne 0) { throw "The legacy runtime retirement plan failed." }
    }
  }
  $plan = Get-PlanJson $outputPath
  Assert-RetirementPlan $plan
  [ordered]@{
    Environment = $Environment; Action = "legacy_runtime_retirement_review"
    RollbackExpiredAt = $RollbackExpiredAt; PlanPath = $outputPath
    PlanSha256 = (Get-FileHash $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Creates = 0; Updates = 1; Deletes = 13; Replacements = 0; AwsMutation = $false
  } | ConvertTo-Json
  exit 0
}

$resolvedPlanPath = Resolve-GuardedPlanPath $PlanPath "retirement"
$plan = Get-PlanJson $resolvedPlanPath
Assert-RetirementPlan $plan
$planSha256 = (Get-FileHash $resolvedPlanPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($Action -eq "Status") {
  [ordered]@{
    Environment = $Environment; Action = "legacy_runtime_retirement_review"
    RollbackExpiredAt = $RollbackExpiredAt; PlanSha256 = $planSha256
    Creates = 0; Updates = 1; Deletes = 13; Replacements = 0; AwsMutation = $false
  } | ConvertTo-Json
  exit 0
}

$sourceCommit = Assert-ExactMain
Assert-Caller
if ($Action -eq "Apply") {
  if (-not (Split-Path $resolvedPlanPath -Leaf).StartsWith("legacy-runtime-retirement-$($sourceCommit.Substring(0, 8))", [StringComparison]::Ordinal)) {
    throw "The reviewed retirement plan was not created from current exact main."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$" -or $planSha256 -ne $ExpectedPlanSha256.ToLowerInvariant()) {
    throw "The saved retirement plan does not match the exact reviewed checksum."
  }
  Invoke-WithCredentials {
    $null = & terraform "-chdir=$environmentDirectory" apply -input=false $resolvedPlanPath
    if ($LASTEXITCODE -ne 0) { throw "The exact reviewed legacy retirement failed to apply." }
  }
}

$null = Invoke-ZeroDriftPlan $plan
Assert-RetiredLiveResources
Assert-PublicApi $plan
[ordered]@{
  Environment = $Environment
  Action = if ($Action -eq "Apply") { "legacy_runtime_retired" } else { "legacy_runtime_retirement_verification" }
  RollbackExpiredAt = $RollbackExpiredAt; AppliedPlanSha256 = $planSha256
  LegacyRuntimeRetired = $true; NoDrift = $true; LambdaApiHealthy = $true
  ProtectedRouteAnonymousStatus = 401; DurableRuntimeRetained = $true
} | ConvertTo-Json
