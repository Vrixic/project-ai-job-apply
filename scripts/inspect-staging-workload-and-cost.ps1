[CmdletBinding()]
param(
  [ValidateSet("Status", "Measure")]
  [string]$Action = "Status",
  [string]$StartTime = "",
  [string]$EndTime = "",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/workflow-dark-plans/APPLIED_PLAN.tfplan
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Measure `
    -StartTime <ISO-8601> -EndTime <ISO-8601> `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/workflow-dark-plans/APPLIED_PLAN.tfplan

Status proves the staging runtime boundary and reports aggregate month-to-date Cost Explorer,
budget, and CUR 2.0 Data Export availability. Measure accepts only a workload result's ISO timestamps and
returns aggregate API Gateway, Lambda, idle-ECS rollback, RDS, queue, alarm, log, and no-drift
evidence. RuntimePlanPath is an already applied guarded maintenance plan used only to recover the
exact immutable artifact inputs for fresh read-only completed-runtime verification.

Both actions are read-only. No account identifier, endpoint, resource ARN, trace, log message,
identity, token, preference, operation identifier, or raw provider record is printed.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 staging environment is restricted to us-east-2."
}

$runtimeOperator = Join-Path $PSScriptRoot "operate-staging-gateway-runtime-release.ps1"
$applicationLogGroup = "/ai-job-apply/staging/application"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' operation failed. Refresh the staging SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Assert-CallerAndTerraform {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary staging IAM Identity Center session; long-lived callers are rejected."
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
  ) { throw "Runtime verification requires the exact staging account, state bucket, and applied plan." }
  $raw = & $runtimeOperator -Action Verify -ExpectedAccountId $ExpectedAccountId `
    -StateBucket $StateBucket -PlanPath $RuntimePlanPath -AwsProfile $AwsProfile -Region $Region 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "The staging serverless runtime baseline did not pass." }
  $runtime = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if (
    -not [bool]$runtime.NoDrift -or -not [bool]$runtime.EcsRuntimeIdle -or
    -not [bool]$runtime.TriggersEnabled -or
    [string]$runtime.DispatchTarget -ne "lambda_durable" -or [bool]$runtime.AwsMutation
  ) {
    throw "The staging runtime is not at the approved serverless workload baseline."
  }
  return $runtime
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
      $message -match "(?i)authorization|bearer\s+|eyJ[A-Za-z0-9_-]+\.|postgres(ql)?://|temporal-api-key|client_secret|session_secret|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
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
    Environment                   = "staging"
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
$apiMatches = @($apis | Where-Object { [string]$_.Name -eq "ai-job-apply-staging-gateway" })
if ($apiMatches.Count -ne 1) { throw "The exact staging HTTP API could not be resolved." }
$apiId = [string]$apiMatches[0].ApiId

$apiDimensions = @("Name=ApiId,Value=$apiId")
$databaseDimensions = @("Name=DBInstanceIdentifier,Value=ai-job-apply-staging")
$eventQueueDimensions = @("Name=QueueName,Value=ai-job-apply-staging-events")
$deadLetterDimensions = @("Name=QueueName,Value=ai-job-apply-staging-dead-letter")
$durableDeadLetterDimensions = @(
  "Name=QueueName,Value=ai-job-apply-staging-profile-readiness-dead-letter"
)

$requestCount = Get-MetricAggregate "AWS/ApiGateway" "Count" $apiDimensions $window.Start $window.End
$clientErrors = Get-MetricAggregate "AWS/ApiGateway" "4xx" $apiDimensions $window.Start $window.End
$serverErrors = Get-MetricAggregate "AWS/ApiGateway" "5xx" $apiDimensions $window.Start $window.End
$latency = Get-MetricAggregate "AWS/ApiGateway" "Latency" $apiDimensions $window.Start $window.End
$lambdaFunctionNames = @(
  "ai-job-apply-staging-gateway",
  "ai-job-apply-staging-outbox-starter",
  "ai-job-apply-staging-outbox-reconciler",
  "ai-job-apply-staging-profile-readiness-activity",
  "ai-job-apply-staging-profile-readiness-terminal",
  "ai-job-apply-staging-profile-readiness-durable"
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
  "ai-job-apply-staging-outbox-reconciler-errors",
  "ai-job-apply-staging-outbox-starter-errors",
  "ai-job-apply-staging-outbox-starter-throttles",
  "ai-job-apply-staging-profile-readiness-activity-errors",
  "ai-job-apply-staging-profile-readiness-dead-letter",
  "ai-job-apply-staging-profile-readiness-durable-failed",
  "ai-job-apply-staging-profile-readiness-durable-timed-out",
  "ai-job-apply-staging-gateway-lambda-errors",
  "ai-job-apply-staging-gateway-lambda-throttles",
  "ai-job-apply-staging-gateway-lambda-duration"
)
$alarms = Invoke-AwsJson (
  @("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json")
)
$healthyAlarms = @($alarms.MetricAlarms | Where-Object {
  [string]$_.StateValue -eq "OK" -and [bool]$_.ActionsEnabled -and
  @($_.AlarmActions).Count -eq 1 -and @($_.OKActions).Count -eq 1
}).Count
$serviceResult = Invoke-AwsJson @(
  "ecs", "describe-services", "--cluster", "ai-job-apply-staging",
  "--services", "gateway", "workflow-worker", "--output", "json"
)
$idleServices = @(Get-Collection $serviceResult "services" | Where-Object {
  [int]$_.desiredCount -eq 0 -and [int]$_.runningCount -eq 0 -and [int]$_.pendingCount -eq 0
}).Count

if (
  [int]$requestCount.Sum -lt 552 -or [int]$clientErrors.Sum -lt 100 -or
  [int]$serverErrors.Sum -ne 0 -or [int]$lambdaErrors -ne 0 -or
  [int]$lambdaThrottles -ne 0 -or [decimal]$queueAge.Maximum -ne 0 -or
  [decimal]$queueVisible.Maximum -ne 0 -or [decimal]$deadLetters.Maximum -ne 0 -or
  [decimal]$durableDeadLetters.Maximum -ne 0 -or $logs.ErrorMatches -ne 0 -or
  $logs.ForbiddenMatches -ne 0 -or $healthyAlarms -ne 10 -or $idleServices -ne 2
) { throw "The staging serverless workload did not pass aggregate AWS acceptance." }

[pscustomobject]@{
  Environment              = "staging"
  WindowMinutes            = [Math]::Round(($window.End - $window.Start).TotalMinutes, 2)
  ApiRequests              = [int]$requestCount.Sum
  ApiRequestsAtLeast552    = [int]$requestCount.Sum -ge 552
  Api4xx                   = [int]$clientErrors.Sum
  Expected4xxAtLeast100    = [int]$clientErrors.Sum -ge 100
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
  IdleEcsServices          = $idleServices
  RuntimeAlarmsOk          = $healthyAlarms
  DispatchTarget           = [string]$runtime.DispatchTarget
  TriggersEnabled          = [bool]$runtime.TriggersEnabled
  TerraformDrift           = 0
} | ConvertTo-Json
