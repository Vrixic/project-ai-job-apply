[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "staging",
  [ValidateSet("Status", "Measure")]
  [string]$Action = "Status",
  [string]$StartTime = "",
  [string]$EndTime = "",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [ValidateSet("Phase0", "D1Read", "D1SavedJob", "D1Match")]
  [string]$WorkloadProfile = "Phase0",
  [string]$AwsProfile = "",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Help) {
  @"
Usage:
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/APPLIED_PLAN.tfplan
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Measure `
    -StartTime <ISO-8601> -EndTime <ISO-8601> `
    -WorkloadProfile Phase0 `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/APPLIED_PLAN.tfplan

Status proves the $Environment runtime boundary and reports aggregate month-to-date Cost Explorer,
budget, and CUR 2.0 Data Export availability. Measure accepts only a workload result's ISO timestamps and
returns aggregate API Gateway, Lambda, empty ECS application boundary, RDS, queue, alarm, log, and
no-drift evidence. RuntimePlanPath is an already applied saved plan used only to recover the exact
non-secret immutable artifact inputs for fresh read-only steady-state verification.

WorkloadProfile selects the fixed aggregate request floor: Phase0 requires 552 requests and 100
expected 4xx responses, D1Read requires 254 requests and 50 expected 401 responses,
D1SavedJob requires 10 requests and one expected 409 response, and D1Match requires two reads with
no expected 4xx response.

Both actions are read-only. No account identifier, endpoint, resource ARN, trace, log message,
identity, token, preference, operation identifier, or raw provider record is printed.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 $Environment environment is restricted to us-east-2."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformDataDirectory = Join-Path $terraformDirectory ".terraform\workload-inspection-data"
$allowedVariableNames = @(
  "migration_image", "high_availability", "staging_runtime_mode",
  "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "deploy_applications",
  "deploy_gateway_lambda", "gateway_lambda_artifact_s3_key",
  "gateway_lambda_artifact_s3_object_version", "gateway_lambda_artifact_sha256",
  "gateway_lambda_artifact_base64sha256", "gateway_lambda_extension_layer_arn",
  "gateway_lambda_reserved_concurrency", "deploy_serverless_outbox",
  "workflow_ingress_artifact_s3_key", "workflow_ingress_artifact_s3_object_version",
  "workflow_ingress_artifact_sha256", "workflow_ingress_artifact_base64sha256",
  "workflow_ingress_lambda_extension_layer_arn", "deploy_profile_readiness_durable",
  "profile_readiness_durable_artifact_s3_key",
  "profile_readiness_durable_artifact_s3_object_version",
  "profile_readiness_durable_artifact_sha256",
  "profile_readiness_durable_artifact_base64sha256",
  "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version",
  "profile_readiness_activity_artifact_sha256",
  "profile_readiness_activity_artifact_base64sha256",
  "profile_readiness_lambda_extension_layer_arn",
  "profile_readiness_execution_timeout_seconds", "profile_readiness_retention_days",
  "serverless_runtime_enabled", "deploy_document_intake",
  "candidate_document_cors_allowed_origins", "document_processing_deployment_stage",
  "document_scan_mapping_enabled", "document_scan_event_rule_enabled",
  "document_security_health_rules_enabled", "document_parser_artifact_s3_key",
  "document_parser_artifact_s3_object_version", "document_parser_artifact_sha256",
  "document_parser_artifact_base64sha256", "document_parser_version",
  "document_parser_invocation_qualified_arn", "document_processor_artifact_s3_key",
  "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
  "document_processor_artifact_base64sha256", "document_processor_extension_layer_arn",
  "deploy_ingestion_runtime", "ingestion_runtime_enabled",
  "ingestion_synthetic_source_enabled", "ingestion_synthetic_seed",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress",
  "ingestion_provider_sources", "ingestion_execution_timeout_seconds",
  "ingestion_retention_days", "ingestion_lambda_extension_layer_arn",
  "ingestion_durable_artifact_s3_key", "ingestion_durable_artifact_s3_object_version",
  "ingestion_durable_artifact_sha256", "ingestion_durable_artifact_base64sha256",
  "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
  "ingestion_runtime_artifact_sha256", "ingestion_runtime_artifact_base64sha256",
  "deploy_public_job_reader", "public_job_database_boundary_version",
  "public_job_cluster_residual_accepted", "public_job_route_activation_allowed",
  "public_job_route_throttling_rate_limit", "public_job_route_throttling_burst_limit",
  "public_job_projection_artifact_s3_key", "public_job_projection_artifact_s3_object_version",
  "public_job_projection_artifact_sha256", "public_job_projection_artifact_base64sha256",
  "public_job_lambda_artifact_s3_key", "public_job_lambda_artifact_s3_object_version",
  "public_job_lambda_artifact_sha256", "public_job_lambda_artifact_base64sha256"
)
$applicationLogGroup = "/ai-job-apply/$Environment/application"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' operation failed. Refresh the $Environment SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][string]$Uri)
  try { return [int](Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 20).StatusCode }
  catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw "The $Environment public API could not be reached."
  }
}

function Assert-CallerAndTerraform {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary $Environment IAM Identity Center session; long-lived callers are rejected."
  }
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required for this measurement."
  }
  return $identity
}

function Get-RuntimeStatus {
  if (
    $ExpectedAccountId -notmatch "^[0-9]{12}$" -or
    [string]::IsNullOrWhiteSpace($StateBucket) -or
    [string]::IsNullOrWhiteSpace($RuntimePlanPath)
  ) { throw "Runtime verification requires the exact $Environment account, state bucket, and applied plan." }
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if ([string]$identity.Account -cne $ExpectedAccountId) {
    throw "The AWS caller does not match the exact $Environment account."
  }
  $planPath = [IO.Path]::GetFullPath($RuntimePlanPath, $terraformDirectory)
  $allowedPlanRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform")) + [IO.Path]::DirectorySeparatorChar
  if (-not $planPath.StartsWith($allowedPlanRoot, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $planPath -PathType Leaf)) {
    throw "RuntimePlanPath must be an existing ignored plan below the selected environment .terraform directory."
  }

  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json")
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
    $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
    $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  })
  if ($rules.Count -ne 1) { throw "The state bucket does not expose one KMS default." }
  $kmsKeyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($kmsKeyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the selected account and region."
  }

  $plan = & terraform "-chdir=$terraformDirectory" show -json $planPath 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $null -eq $plan.variables) { throw "The applied runtime plan could not be inspected." }
  $variableProperties = @($plan.variables.PSObject.Properties)
  $unexpected = @($variableProperties | Where-Object { $_.Name -notin $allowedVariableNames })
  if ($unexpected.Count -ne 0) { throw "The applied plan contains an unapproved runtime input." }

  $saved = @{}
  $names = New-Object Collections.Generic.List[string]
  $temporaryPlan = Join-Path $allowedPlanRoot "workload-inspection-$([Guid]::NewGuid().ToString('N')).tfplan"
  try {
    $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
    $saved["TF_DATA_DIR"] = $env:TF_DATA_DIR
    $env:TF_DATA_DIR = $terraformDataDirectory
    foreach ($property in $variableProperties) {
      $environmentName = "TF_VAR_$($property.Name)"
      $saved[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, "Process")
      $value = $property.Value.value
      $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
        elseif ($value -is [string]) { $value }
        else { ConvertTo-Json -InputObject $value -Compress -Depth 20 }
      [Environment]::SetEnvironmentVariable($environmentName, [string]$serialized, "Process")
      $names.Add($environmentName)
    }
    $runtimeSetting = @($variableProperties | Where-Object Name -eq "serverless_runtime_enabled")
    if ($runtimeSetting.Count -ne 1 -or -not [bool]$runtimeSetting[0].Value.value) {
      throw "The applied plan does not describe the enabled steady-state runtime."
    }

    & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
      "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
      "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsKeyArn" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The encrypted backend could not be initialized." }
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -detailed-exitcode `
      "-out=$temporaryPlan" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The $Environment runtime is not zero drift." }

    $clusterArn = (& terraform "-chdir=$terraformDirectory" output -raw ecs_cluster_arn 2>$null).Trim()
    $mappingId = (& terraform "-chdir=$terraformDirectory" output -raw outbox_starter_event_source_mapping_uuid 2>$null).Trim()
    $reconcilerArn = (& terraform "-chdir=$terraformDirectory" output -raw outbox_reconciler_rule_arn 2>$null).Trim()
    $terminalArn = (& terraform "-chdir=$terraformDirectory" output -raw profile_readiness_terminal_rule_arn 2>$null).Trim()
    $gatewayName = (& terraform "-chdir=$terraformDirectory" output -raw gateway_lambda_function_name 2>$null).Trim()
    $gatewayUrl = (& terraform "-chdir=$terraformDirectory" output -raw gateway_url 2>$null).TrimEnd("/")
    if ($LASTEXITCODE -ne 0 -or -not $clusterArn -or -not $mappingId -or -not $reconcilerArn -or
        -not $terminalArn -or -not $gatewayName -or -not $gatewayUrl.StartsWith("https://")) {
      throw "The steady-state outputs are incomplete."
    }

    $services = Invoke-AwsJson @("ecs", "list-services", "--cluster", $clusterArn, "--output", "json")
    $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $clusterArn, "--desired-status", "RUNNING", "--output", "json")
    if (@($services.serviceArns).Count -ne 0 -or @($tasks.taskArns).Count -ne 0) {
      throw "The ECS application boundary is not empty."
    }
    $gateway = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $gatewayName, "--qualifier", $Environment, "--output", "json")
    if ([string]$gateway.Environment.Variables.OUTBOX_DISPATCH_TARGET -cne "lambda_durable") {
      throw "The gateway dispatch target is not Lambda durable."
    }
    $mapping = Invoke-AwsJson @("lambda", "get-event-source-mapping", "--uuid", $mappingId, "--output", "json")
    $rulesEnabled = $true
    foreach ($arn in @($reconcilerArn, $terminalArn)) {
      $name = $arn.Substring($arn.LastIndexOf("/") + 1)
      $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $name, "--output", "json")
      if ([string]$rule.State -cne "ENABLED") { $rulesEnabled = $false }
    }
    if ([string]$mapping.State -cne "Enabled" -or -not $rulesEnabled) {
      throw "The durable workflow triggers are not enabled."
    }
    if ((Get-HttpStatus "$gatewayUrl/health/live") -ne 200 -or
        (Get-HttpStatus "$gatewayUrl/health/ready") -ne 200 -or
        (Get-HttpStatus "$gatewayUrl/v1/me") -ne 401) {
      throw "The public API did not pass the expected 200/200/401 boundary."
    }
    return [pscustomobject]@{
      NoDrift = $true
      EcsRuntimeIdle = $true
      TriggersEnabled = $true
      DispatchTarget = "lambda_durable"
      AwsMutation = $false
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPlan) { Remove-Item -LiteralPath $temporaryPlan -Force }
    foreach ($name in $names) {
      [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process")
    }
    $env:TF_DATA_DIR = $saved["TF_DATA_DIR"]
  }
}

function Get-Collection {
  param(
    [object]$Object,
    [string]$Property
  )

  if ($null -eq $Object -or $null -eq $Object.$Property) {
    return @()
  }
  return @($Object.$Property)
}

function Get-MonthToDateCost {
  $now = [DateTime]::UtcNow
  $start = [DateTime]::new($now.Year, $now.Month, 1, 0, 0, 0, [DateTimeKind]::Utc)
  $end = $start.AddMonths(1)
  $cost = Invoke-AwsJson @(
    "ce",
    "get-cost-and-usage",
    "--time-period",
    "Start=$($start.ToString('yyyy-MM-dd')),End=$($end.ToString('yyyy-MM-dd'))",
    "--granularity",
    "MONTHLY",
    "--metrics",
    "UnblendedCost",
    "--group-by",
    "Type=DIMENSION,Key=SERVICE",
    "--output",
    "json"
  )
  $periods = Get-Collection $cost "ResultsByTime"
  $groups = if ($periods.Count -eq 1) { Get-Collection $periods[0] "Groups" } else { @() }
  [decimal]$total = 0
  $nonzeroServices = 0
  foreach ($group in $groups) {
    [decimal]$amount = [decimal]$group.Metrics.UnblendedCost.Amount
    $total += $amount
    if ($amount -ne 0) {
      $nonzeroServices += 1
    }
  }
  return [pscustomobject]@{
    AmountUsd       = [Math]::Round($total, 4)
    NonzeroServices = $nonzeroServices
    Estimated       = if ($periods.Count -eq 1) { [bool]$periods[0].Estimated } else { $true }
  }
}

function Get-BillingControlCounts {
  param([string]$AccountId)

  $budgets = Invoke-AwsJson @(
    "budgets",
    "describe-budgets",
    "--account-id",
    $AccountId,
    "--max-results",
    "100",
    "--output",
    "json"
  )
  $exports = Invoke-AwsJson @(
    "bcm-data-exports",
    "list-exports",
    "--region",
    "us-east-1",
    "--max-results",
    "100",
    "--output",
    "json"
  )
  return [pscustomobject]@{
    Budgets = (Get-Collection $budgets "Budgets").Count
    Exports = (Get-Collection $exports "Exports").Count
  }
}

function Get-MetricAggregate {
  param(
    [string]$Namespace,
    [string]$MetricName,
    [string[]]$Dimensions,
    [DateTime]$WindowStart,
    [DateTime]$WindowEnd
  )

  $arguments = @(
    "cloudwatch",
    "get-metric-statistics",
    "--namespace",
    $Namespace,
    "--metric-name",
    $MetricName,
    "--start-time",
    $WindowStart.ToString("o"),
    "--end-time",
    $WindowEnd.ToString("o"),
    "--period",
    "60",
    "--statistics",
    "Sum",
    "Average",
    "Maximum",
    "SampleCount"
  )
  if ($Dimensions.Count -gt 0) {
    $arguments += "--dimensions"
    $arguments += $Dimensions
  }
  $arguments += @("--output", "json")
  $metric = Invoke-AwsJson $arguments
  $points = Get-Collection $metric "Datapoints"
  [decimal]$sum = 0
  [decimal]$weighted = 0
  [decimal]$samples = 0
  [decimal]$maximum = 0
  foreach ($point in $points) {
    $sum += [decimal]$point.Sum
    $weighted += [decimal]$point.Average * [decimal]$point.SampleCount
    $samples += [decimal]$point.SampleCount
    $maximum = [Math]::Max($maximum, [decimal]$point.Maximum)
  }
  return [pscustomobject]@{
    Sum     = [Math]::Round($sum, 2)
    Average = if ($samples -gt 0) { [Math]::Round($weighted / $samples, 2) } else { 0 }
    Maximum = [Math]::Round($maximum, 2)
    Samples = [int]$samples
  }
}

function Get-LogAggregate {
  param(
    [DateTime]$WindowStart,
    [DateTime]$WindowEnd
  )

  $events = Get-Collection (
    Invoke-AwsJson @(
      "logs",
      "filter-log-events",
      "--log-group-name",
      $applicationLogGroup,
      "--start-time",
      ([DateTimeOffset]$WindowStart).ToUnixTimeMilliseconds().ToString(),
      "--end-time",
      ([DateTimeOffset]$WindowEnd).ToUnixTimeMilliseconds().ToString(),
      "--output",
      "json"
    )
  ) "events"
  $errorMatches = 0
  $forbiddenMatches = 0
  foreach ($event in $events) {
    $message = [string]$event.message
    $structured = $null
    try { $structured = $message | ConvertFrom-Json } catch { $structured = $null }
    $level = if ($null -ne $structured -and $structured.PSObject.Properties.Name -contains "level") {
      [int]$structured.level
    } else { 0 }
    $operationalMessage = if (
      $null -ne $structured -and $structured.PSObject.Properties.Name -contains "msg"
    ) { [string]$structured.msg } else { $message }
    if ($level -ge 40 -or $operationalMessage -match "(?i)error|exception|failed") {
      $errorMatches += 1
    }
    if (
      $message -match "(?i)authorization|bearer\s+|eyJ[A-Za-z0-9_-]+\.|postgres(ql)?://|api[_-]?key|client_secret|session_secret|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    ) {
      $forbiddenMatches += 1
    }
  }
  return [pscustomobject]@{
    Events           = $events.Count
    ErrorMatches     = $errorMatches
    ForbiddenMatches = $forbiddenMatches
  }
}

function Convert-WorkloadWindow {
  if (-not $StartTime -or -not $EndTime) {
    throw "Measure requires the workload result's StartTime and EndTime."
  }
  $start = [DateTime]::MinValue
  $end = [DateTime]::MinValue
  if (
    -not [DateTime]::TryParse(
      $StartTime,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$start
    ) -or
    -not [DateTime]::TryParse(
      $EndTime,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$end
    )
  ) {
    throw "Measure timestamps must be valid ISO-8601 values."
  }
  $start = $start.ToUniversalTime()
  $end = $end.ToUniversalTime()
  if ($end -le $start -or ($end - $start).TotalMinutes -gt 15 -or $end -gt [DateTime]::UtcNow.AddMinutes(1)) {
    throw "The workload window must be positive, no more than 15 minutes, and not in the future."
  }
  if ($WorkloadProfile -ne "Phase0") {
    $metricStart = [DateTime]::new(
      $start.Year, $start.Month, $start.Day, $start.Hour, $start.Minute, 0, [DateTimeKind]::Utc
    )
    $metricEnd = [DateTime]::new(
      $end.Year, $end.Month, $end.Day, $end.Hour, $end.Minute, 0, [DateTimeKind]::Utc
    )
    if ($metricEnd -lt $end) { $metricEnd = $metricEnd.AddMinutes(1) }
    return [pscustomobject]@{ Start = $metricStart; End = $metricEnd }
  }
  return [pscustomobject]@{
    Start = $start.AddMinutes(-1)
    End   = $end.AddMinutes(3)
  }
}

$identity = Assert-CallerAndTerraform
$runtime = Get-RuntimeStatus

if ($Action -eq "Status") {
  $cost = Get-MonthToDateCost
  $billing = Get-BillingControlCounts ([string]$identity.Account)
  [pscustomobject]@{
    Environment                   = $Environment
    TemporaryCaller               = $true
    NoDrift                       = [bool]$runtime.NoDrift
    DispatchTarget                = [string]$runtime.DispatchTarget
    TriggersEnabled               = [bool]$runtime.TriggersEnabled
    EcsRuntimeIdle                = [bool]$runtime.EcsRuntimeIdle
    MonthToDateUnblendedCostUsd   = $cost.AmountUsd
    CostExplorerEstimated         = $cost.Estimated
    NonzeroCostServices           = $cost.NonzeroServices
    AwsBudgetCount                = $billing.Budgets
    Cur2DataExportCount           = $billing.Exports
  } | ConvertTo-Json
  exit 0
}

$window = Convert-WorkloadWindow
$apis = Get-Collection (
  Invoke-AwsJson @("apigatewayv2", "get-apis", "--max-results", "100", "--output", "json")
) "Items"
$apiMatches = @($apis | Where-Object { [string]$_.Name -eq "ai-job-apply-$Environment-gateway" })
if ($apiMatches.Count -ne 1) { throw "The exact $Environment HTTP API could not be resolved." }
$apiId = [string]$apiMatches[0].ApiId

$apiDimensions = @("Name=ApiId,Value=$apiId")
$databaseDimensions = @("Name=DBInstanceIdentifier,Value=ai-job-apply-$Environment")
$eventQueueDimensions = @("Name=QueueName,Value=ai-job-apply-$Environment-events")
$deadLetterDimensions = @("Name=QueueName,Value=ai-job-apply-$Environment-dead-letter")
$durableDeadLetterDimensions = @(
  "Name=QueueName,Value=ai-job-apply-$Environment-profile-readiness-dead-letter"
)

$requestCount = Get-MetricAggregate "AWS/ApiGateway" "Count" $apiDimensions $window.Start $window.End
$clientErrors = Get-MetricAggregate "AWS/ApiGateway" "4xx" $apiDimensions $window.Start $window.End
$serverErrors = Get-MetricAggregate "AWS/ApiGateway" "5xx" $apiDimensions $window.Start $window.End
$latency = Get-MetricAggregate "AWS/ApiGateway" "Latency" $apiDimensions $window.Start $window.End
$lambdaFunctionNames = @(
  "ai-job-apply-$Environment-gateway",
  "ai-job-apply-$Environment-outbox-starter",
  "ai-job-apply-$Environment-outbox-reconciler",
  "ai-job-apply-$Environment-profile-readiness-activity",
  "ai-job-apply-$Environment-profile-readiness-terminal",
  "ai-job-apply-$Environment-profile-readiness-durable"
)
[decimal]$lambdaInvocations = 0
[decimal]$lambdaErrors = 0
[decimal]$lambdaThrottles = 0
[decimal]$lambdaDurationMaximum = 0
foreach ($functionName in $lambdaFunctionNames) {
  $dimensions = @("Name=FunctionName,Value=$functionName")
  $lambdaInvocations += (
    Get-MetricAggregate "AWS/Lambda" "Invocations" $dimensions $window.Start $window.End
  ).Sum
  $lambdaErrors += (
    Get-MetricAggregate "AWS/Lambda" "Errors" $dimensions $window.Start $window.End
  ).Sum
  $lambdaThrottles += (
    Get-MetricAggregate "AWS/Lambda" "Throttles" $dimensions $window.Start $window.End
  ).Sum
  $duration = Get-MetricAggregate "AWS/Lambda" "Duration" $dimensions $window.Start $window.End
  $lambdaDurationMaximum = [Math]::Max($lambdaDurationMaximum, [decimal]$duration.Maximum)
}
$databaseCpu = Get-MetricAggregate "AWS/RDS" "CPUUtilization" $databaseDimensions $window.Start $window.End
$connections = Get-MetricAggregate "AWS/RDS" "DatabaseConnections" $databaseDimensions $window.Start $window.End
$queueAge = Get-MetricAggregate "AWS/SQS" "ApproximateAgeOfOldestMessage" $eventQueueDimensions $window.Start $window.End
$queueVisible = Get-MetricAggregate `
  "AWS/SQS" "ApproximateNumberOfMessagesVisible" $eventQueueDimensions $window.Start $window.End
$deadLetters = Get-MetricAggregate "AWS/SQS" "ApproximateNumberOfMessagesVisible" $deadLetterDimensions $window.Start $window.End
$durableDeadLetters = Get-MetricAggregate `
  "AWS/SQS" "ApproximateNumberOfMessagesVisible" `
  $durableDeadLetterDimensions $window.Start $window.End
$logs = Get-LogAggregate $window.Start $window.End
$alarmNames = @(
  "ai-job-apply-$Environment-outbox-reconciler-errors",
  "ai-job-apply-$Environment-outbox-starter-errors",
  "ai-job-apply-$Environment-outbox-starter-throttles",
  "ai-job-apply-$Environment-profile-readiness-activity-errors",
  "ai-job-apply-$Environment-profile-readiness-dead-letter",
  "ai-job-apply-$Environment-profile-readiness-durable-failed",
  "ai-job-apply-$Environment-profile-readiness-durable-timed-out",
  "ai-job-apply-$Environment-gateway-lambda-errors",
  "ai-job-apply-$Environment-gateway-lambda-throttles",
  "ai-job-apply-$Environment-gateway-lambda-duration"
)
$alarms = Invoke-AwsJson (
  @("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json")
)
$healthyAlarms = @($alarms.MetricAlarms | Where-Object {
  [string]$_.StateValue -eq "OK" -and [bool]$_.ActionsEnabled -and
  @($_.AlarmActions).Count -eq 1 -and @($_.OKActions).Count -eq 1
}).Count
$serviceInventory = Invoke-AwsJson @(
  "ecs", "list-services", "--cluster", "ai-job-apply-$Environment", "--output", "json"
)
$taskInventory = Invoke-AwsJson @(
  "ecs", "list-tasks", "--cluster", "ai-job-apply-$Environment", "--desired-status", "RUNNING",
  "--output", "json"
)
$activeServices = @(Get-Collection $serviceInventory "serviceArns").Count
$runningTasks = @(Get-Collection $taskInventory "taskArns").Count

$minimumApiRequests = switch ($WorkloadProfile) {
  "D1Read" { 254 }
  "D1SavedJob" { 10 }
  "D1Match" { 2 }
  default { 552 }
}
$minimumExpected4xx = switch ($WorkloadProfile) {
  "D1Read" { 50 }
  "D1SavedJob" { 1 }
  "D1Match" { 0 }
  default { 100 }
}

$failedChecks = @()
if ([int]$requestCount.Sum -lt $minimumApiRequests) { $failedChecks += "api_request_floor" }
if ([int]$clientErrors.Sum -lt $minimumExpected4xx) { $failedChecks += "expected_4xx_floor" }
if ([int]$serverErrors.Sum -ne 0) { $failedChecks += "api_5xx" }
if ([int]$lambdaErrors -ne 0) { $failedChecks += "lambda_errors" }
if ([int]$lambdaThrottles -ne 0) { $failedChecks += "lambda_throttles" }
if ([decimal]$queueAge.Maximum -ne 0) { $failedChecks += "event_queue_age" }
if ([decimal]$queueVisible.Maximum -ne 0) { $failedChecks += "event_queue_visible" }
if ([decimal]$deadLetters.Maximum -ne 0) { $failedChecks += "event_dead_letters" }
if ([decimal]$durableDeadLetters.Maximum -ne 0) { $failedChecks += "durable_dead_letters" }
if ($logs.ErrorMatches -ne 0) { $failedChecks += "error_logs" }
if ($logs.ForbiddenMatches -ne 0) { $failedChecks += "forbidden_log_content" }
if ($healthyAlarms -ne 10) { $failedChecks += "alarm_health" }
if ($activeServices -ne 0) { $failedChecks += "active_ecs_services" }
if ($runningTasks -ne 0) { $failedChecks += "running_ecs_tasks" }
if ($failedChecks.Count -ne 0) {
  throw "The $Environment serverless workload did not pass aggregate AWS acceptance: $($failedChecks -join ', ')."
}

[pscustomobject]@{
  Environment              = $Environment
  WorkloadProfile          = $WorkloadProfile
  WindowMinutes            = [Math]::Round(($window.End - $window.Start).TotalMinutes, 2)
  ApiRequests              = [int]$requestCount.Sum
  MinimumApiRequests       = $minimumApiRequests
  ApiRequestsMeetMinimum   = [int]$requestCount.Sum -ge $minimumApiRequests
  Api4xx                   = [int]$clientErrors.Sum
  MinimumExpected4xx       = $minimumExpected4xx
  Expected4xxMeetMinimum   = [int]$clientErrors.Sum -ge $minimumExpected4xx
  Api5xx                   = [int]$serverErrors.Sum
  ApiLatencyAverageMs      = $latency.Average
  ApiLatencyMaximumMs      = $latency.Maximum
  LambdaInvocations        = [int]$lambdaInvocations
  LambdaErrors             = [int]$lambdaErrors
  LambdaThrottles          = [int]$lambdaThrottles
  LambdaDurationMaximumMs  = $lambdaDurationMaximum
  DatabaseCpuMaxPercent    = $databaseCpu.Maximum
  DatabaseConnectionsMax   = $connections.Maximum
  EventQueueAgeMaxSeconds  = $queueAge.Maximum
  EventQueueVisibleMax     = $queueVisible.Maximum
  DeadLetterMessagesMax    = $deadLetters.Maximum
  DurableDeadLetterMax     = $durableDeadLetters.Maximum
  LogEvents                = $logs.Events
  LogErrorMatches          = $logs.ErrorMatches
  ForbiddenLogMatches      = $logs.ForbiddenMatches
  ActiveEcsServices        = $activeServices
  RunningEcsTasks          = $runningTasks
  RuntimeAlarmsOk          = $healthyAlarms
  DispatchTarget           = [string]$runtime.DispatchTarget
  TriggersEnabled          = [bool]$runtime.TriggersEnabled
  TerraformDrift           = 0
} | ConvertTo-Json
