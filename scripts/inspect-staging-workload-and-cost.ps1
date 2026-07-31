[CmdletBinding()]
param(
  [ValidateSet("Status", "Measure")]
  [string]$Action = "Status",
  [string]$StartTime = "",
  [string]$EndTime = "",
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Status
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Measure `
    -StartTime <ISO-8601> -EndTime <ISO-8601>

Status proves the staging runtime boundary and reports aggregate month-to-date Cost Explorer,
budget, and legacy CUR availability. Measure accepts only a workload result's ISO timestamps and
returns aggregate API Gateway, ECS, RDS, queue, alarm, log, and no-drift evidence.

Both actions are read-only. No account identifier, endpoint, resource ARN, trace, log message,
identity, token, preference, operation identifier, or raw provider record is printed.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 staging environment is restricted to us-east-2."
}

$environmentDirectory = (Resolve-Path "infrastructure/terraform/environments/staging").Path
$recoveryOperator = Join-Path $PSScriptRoot "operate-staging-application-recovery.ps1"
$restoreOperator = Join-Path $PSScriptRoot "operate-staging-postgresql-restore.ps1"
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
  $restore = & $restoreOperator -Action Status 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "The staging runtime baseline did not pass."
  }
  if (
    -not [bool]$restore.SourceAvailable -or
    [int]$restore.StableServices -ne 2 -or
    [int]$restore.ManagedAlarmsOk -ne 8 -or
    [int]$restore.DisposableRestoreTargets -ne 0 -or
    [bool]$restore.RestoreContext
  ) {
    throw "The staging runtime is not at the approved workload baseline."
  }
  return $restore
}

function Get-NoDrift {
  $result = & $recoveryOperator -Action NoDrift 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [int]$result.TerraformDrift -ne 0) {
    throw "The exact-input staging Terraform no-drift check failed."
  }
  return 0
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
  $reports = Invoke-AwsJson @(
    "cur",
    "describe-report-definitions",
    "--region",
    "us-east-1",
    "--output",
    "json"
  )
  return [pscustomobject]@{
    Budgets   = (Get-Collection $budgets "Budgets").Count
    CurReports = (Get-Collection $reports "ReportDefinitions").Count
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
    if ($message -match "(?i)error|exception|failed") {
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
    SourceAvailable               = [bool]$runtime.SourceAvailable
    StableServices                = [int]$runtime.StableServices
    ManagedAlarmsOk               = [int]$runtime.ManagedAlarmsOk
    RestoreTargets                = [int]$runtime.DisposableRestoreTargets
    RestoreContext                = [bool]$runtime.RestoreContext
    MonthToDateUnblendedCostUsd   = $cost.AmountUsd
    CostExplorerEstimated         = $cost.Estimated
    NonzeroCostServices           = $cost.NonzeroServices
    AwsBudgetCount                = $billing.Budgets
    LegacyCurReportCount          = $billing.CurReports
  } | ConvertTo-Json
  exit 0
}

$window = Convert-WorkloadWindow
$gatewayUrl = & terraform "-chdir=$environmentDirectory" output -raw gateway_url 2>$null
$clusterArn = & terraform "-chdir=$environmentDirectory" output -raw ecs_cluster_arn 2>$null
if ($LASTEXITCODE -ne 0 -or -not $gatewayUrl -or -not $clusterArn) {
  throw "The encrypted staging state did not expose the workload measurement boundary."
}
$gateway = [Uri]$gatewayUrl
$apiId = $gateway.Host.Split(".")[0]
$clusterName = ([string]$clusterArn -split "/")[-1]

$apiDimensions = @("Name=ApiId,Value=$apiId")
$gatewayDimensions = @("Name=ClusterName,Value=$clusterName", "Name=ServiceName,Value=gateway")
$workerDimensions = @(
  "Name=ClusterName,Value=$clusterName",
  "Name=ServiceName,Value=workflow-worker"
)
$databaseDimensions = @("Name=DBInstanceIdentifier,Value=ai-job-apply-staging")
$eventQueueDimensions = @("Name=QueueName,Value=ai-job-apply-staging-events")
$deadLetterDimensions = @("Name=QueueName,Value=ai-job-apply-staging-dead-letter")

$requestCount = Get-MetricAggregate "AWS/ApiGateway" "Count" $apiDimensions $window.Start $window.End
$clientErrors = Get-MetricAggregate "AWS/ApiGateway" "4xx" $apiDimensions $window.Start $window.End
$serverErrors = Get-MetricAggregate "AWS/ApiGateway" "5xx" $apiDimensions $window.Start $window.End
$latency = Get-MetricAggregate "AWS/ApiGateway" "Latency" $apiDimensions $window.Start $window.End
$gatewayCpu = Get-MetricAggregate "AWS/ECS" "CPUUtilization" $gatewayDimensions $window.Start $window.End
$gatewayMemory = Get-MetricAggregate "AWS/ECS" "MemoryUtilization" $gatewayDimensions $window.Start $window.End
$workerCpu = Get-MetricAggregate "AWS/ECS" "CPUUtilization" $workerDimensions $window.Start $window.End
$workerMemory = Get-MetricAggregate "AWS/ECS" "MemoryUtilization" $workerDimensions $window.Start $window.End
$databaseCpu = Get-MetricAggregate "AWS/RDS" "CPUUtilization" $databaseDimensions $window.Start $window.End
$connections = Get-MetricAggregate "AWS/RDS" "DatabaseConnections" $databaseDimensions $window.Start $window.End
$queueAge = Get-MetricAggregate "AWS/SQS" "ApproximateAgeOfOldestMessage" $eventQueueDimensions $window.Start $window.End
$deadLetters = Get-MetricAggregate "AWS/SQS" "ApproximateNumberOfMessagesVisible" $deadLetterDimensions $window.Start $window.End
$logs = Get-LogAggregate $window.Start $window.End
$drift = Get-NoDrift

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
  GatewayCpuMaximumPercent = $gatewayCpu.Maximum
  GatewayMemoryMaxPercent  = $gatewayMemory.Maximum
  WorkerCpuMaximumPercent  = $workerCpu.Maximum
  WorkerMemoryMaxPercent   = $workerMemory.Maximum
  DatabaseCpuMaxPercent    = $databaseCpu.Maximum
  DatabaseConnectionsMax   = $connections.Maximum
  EventQueueAgeMaxSeconds  = $queueAge.Maximum
  DeadLetterMessagesMax    = $deadLetters.Maximum
  LogEvents                = $logs.Events
  LogErrorMatches          = $logs.ErrorMatches
  ForbiddenLogMatches      = $logs.ForbiddenMatches
  StableServices           = [int]$runtime.StableServices
  ManagedAlarmsOk          = [int]$runtime.ManagedAlarmsOk
  TerraformDrift           = $drift
} | ConvertTo-Json
