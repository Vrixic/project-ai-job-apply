[CmdletBinding()]
param(
  [ValidateSet("Status", "Exercise")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",

  [string]$Region = "us-east-2",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPlanSha256 = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedRecipientSetSha256 = "",

  [switch]$Execute,

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\exercise-development-d2-alarm.ps1 -Action Status
  .\scripts\exercise-development-d2-alarm.ps1 -Action Exercise `
    -ReviewedPlanSha256 <status-plan-sha256> `
    -ReviewedRecipientSetSha256 <status-recipient-set-sha256> `
    -Execute

Status is read-only. It verifies the exact Terraform-owned D2 TrustSignalFailed alarm, all thirteen
D2 alarms, and the confirmed operational-alert recipient set. Its aggregate output contains no
account identifier, destination, ARN, or raw notification content.

Exercise publishes only one generated-synthetic TrustSignalFailed breach followed by a zero-value
recovery datum. It requires the exact current plan and recipient-set digests, observes a real
OK -> ALARM -> OK transition, asks for direct receipt confirmation, and finishes with all D2 alarms
healthy. It does not invoke a runtime or modify application, queue, database, or candidate data.
"@
  exit 0
}

$targetAlarmName = "ai-job-apply-development-d2-trustsignalfailed"
$alarmPrefix = "ai-job-apply-development-d2-"
$topicName = "ai-job-apply-development-operational-alerts"
$metricNamespace = "AIJobApply/D2Community"
$metricName = "TrustSignalFailed"
$expectedAlarmCount = 13
$manualDeliveryConfirmation = "CONFIRM-D2-TRUST-SIGNAL-FAILED-ALARM-AND-OK-RECEIVED"
$plannerPath = Join-Path $PSScriptRoot "plan-development-d2-community-recovery.ps1"

function Get-Sha256 {
  param([Parameter(Mandatory)][string]$Value)

  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
  }
  finally { $sha.Dispose() }
}

function Format-CanonicalTimestamp {
  param([Parameter(Mandatory)][DateTimeOffset]$Value)

  return $Value.UtcDateTime.ToString(
    "yyyy-MM-ddTHH:mm:ss.fffZ",
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$CommandArguments)

  $raw = & aws.exe @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "An AWS command failed. Refresh the development IAM Identity Center session and retry."
  }
  if (-not $raw) { return $null }
  return $raw | ConvertFrom-Json
}

function Assert-ActionInputs {
  if ($Region -cne "us-east-2") {
    throw "The development D2 alarm exercise is restricted to us-east-2."
  }
  if ($Action -ceq "Status") {
    if ($Execute -or -not [string]::IsNullOrWhiteSpace($ReviewedPlanSha256) -or
      -not [string]::IsNullOrWhiteSpace($ReviewedRecipientSetSha256)) {
      throw "Status is read-only and does not accept execution or reviewed digests."
    }
    return
  }
  if (-not $Execute) {
    throw "Exercise publishes a synthetic metric and sends notifications. Re-run with -Execute."
  }
  if ($ReviewedPlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    $ReviewedRecipientSetSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw "Exercise requires the exact lowercase plan and recipient-set SHA-256 values from Status."
  }
}

function Assert-EnvironmentContext {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary development IAM Identity Center session; long-lived callers are rejected."
  }

  $configuredRegion = & aws.exe configure get region --profile $AwsProfile 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]$configuredRegion.Trim() -cne $Region) {
    throw "The AWS profile region does not match the reviewed development region."
  }
}

function Get-ConfirmedRecipientSetSha256 {
  param([Parameter(Mandatory)][object[]]$ConfirmedSubscriptions)

  if ($ConfirmedSubscriptions.Count -lt 1) {
    throw "At least one confirmed operational-alert recipient is required."
  }
  $recipients = [Collections.Generic.List[string]]::new()
  foreach ($subscription in $ConfirmedSubscriptions) {
    if ([string]$subscription.Protocol -cne "email" -or
      [string]::IsNullOrWhiteSpace([string]$subscription.Endpoint)) {
      throw "The reviewed D2 recipient set accepts only confirmed email subscriptions."
    }
    $recipients.Add(([string]$subscription.Endpoint).Trim().ToLowerInvariant())
  }
  $canonicalRecipients = [string[]]$recipients.ToArray()
  [Array]::Sort($canonicalRecipients, [StringComparer]::Ordinal)
  if (@($canonicalRecipients | Select-Object -Unique).Count -ne $ConfirmedSubscriptions.Count) {
    throw "The confirmed D2 recipient set contains a duplicate destination."
  }
  return Get-Sha256 ("d2-alert-recipient-set-v1`n" + (($canonicalRecipients -join "`n") + "`n"))
}

function Assert-ExactTargetAlarm {
  param(
    [Parameter(Mandatory)]$Alarm,
    [Parameter(Mandatory)][string]$TopicArn
  )

  $valid = [string]$Alarm.AlarmName -ceq $targetAlarmName -and
    [string]$Alarm.Namespace -ceq $metricNamespace -and
    [string]$Alarm.MetricName -ceq $metricName -and
    [string]$Alarm.ComparisonOperator -ceq "GreaterThanThreshold" -and
    [double]$Alarm.Threshold -eq 0 -and
    [int]$Alarm.EvaluationPeriods -eq 1 -and
    [int]$Alarm.Period -eq 60 -and
    [string]$Alarm.Statistic -ceq "Sum" -and
    [string]$Alarm.TreatMissingData -ceq "notBreaching" -and
    [bool]$Alarm.ActionsEnabled -and
    @($Alarm.Dimensions).Count -eq 0 -and
    @($Alarm.AlarmActions).Count -eq 1 -and
    @($Alarm.OKActions).Count -eq 1 -and
    @($Alarm.InsufficientDataActions).Count -eq 0 -and
    [string]$Alarm.AlarmActions[0] -ceq $TopicArn -and
    [string]$Alarm.OKActions[0] -ceq $TopicArn
  if (-not $valid) {
    throw "The exact D2 TrustSignalFailed alarm does not match the reviewed Terraform boundary."
  }
}

function Get-D2AlarmContext {
  $topics = Invoke-AwsJson @("sns", "list-topics", "--output", "json")
  $matchingTopics = @($topics.Topics | Where-Object {
      ([string]$_.TopicArn).EndsWith(":$topicName")
    })
  if ($matchingTopics.Count -ne 1) {
    throw "The exact Terraform-owned development operational-alert topic is unavailable."
  }
  $topicArn = [string]$matchingTopics[0].TopicArn

  $subscriptionResult = Invoke-AwsJson @(
    "sns", "list-subscriptions-by-topic", "--topic-arn", $topicArn, "--output", "json"
  )
  $subscriptions = @($subscriptionResult.Subscriptions)
  $confirmed = @($subscriptions | Where-Object { $_.SubscriptionArn -ne "PendingConfirmation" })
  $pending = @($subscriptions | Where-Object { $_.SubscriptionArn -eq "PendingConfirmation" })

  $alarmResult = Invoke-AwsJson @(
    "cloudwatch", "describe-alarms", "--alarm-name-prefix", $alarmPrefix, "--output", "json"
  )
  $alarms = @($alarmResult.MetricAlarms)
  if ($alarms.Count -ne $expectedAlarmCount -or @($alarmResult.CompositeAlarms).Count -ne 0) {
    throw "The exact thirteen-alarm D2 boundary is unavailable."
  }
  $targets = @($alarms | Where-Object { [string]$_.AlarmName -ceq $targetAlarmName })
  if ($targets.Count -ne 1) {
    throw "The exact D2 TrustSignalFailed alarm is unavailable."
  }
  Assert-ExactTargetAlarm -Alarm $targets[0] -TopicArn $topicArn

  $unhealthy = @($alarms | Where-Object { [string]$_.StateValue -cne "OK" })
  $unrouted = @($alarms | Where-Object {
      -not [bool]$_.ActionsEnabled -or
      @($_.AlarmActions).Count -ne 1 -or @($_.OKActions).Count -ne 1 -or
      [string]$_.AlarmActions[0] -cne $topicArn -or [string]$_.OKActions[0] -cne $topicArn
    })
  if ($unhealthy.Count -ne 0 -or $unrouted.Count -ne 0) {
    throw "Every D2 alarm must be OK and routed to the exact operational-alert topic."
  }

  $recipientSetSha256 = Get-ConfirmedRecipientSetSha256 -ConfirmedSubscriptions $confirmed
  $plan = & $plannerPath `
    -Action AlarmInjectionPlan `
    -ReviewedAlarmArn ([string]$targets[0].AlarmArn) `
    -ReviewedAlarmThreshold ([double]$targets[0].Threshold) `
    -ReviewedRecipientCount $confirmed.Count | ConvertFrom-Json
  if (-not $plan.ready -or $plan.mutationPerformed -or -not $plan.preserveDark -or
    [string]$plan.planSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw "The deterministic D2 alarm plan is invalid."
  }

  return @{
    Alarms = $alarms
    Confirmed = $confirmed
    Pending = $pending
    PlanSha256 = [string]$plan.planSha256
    RecipientSetSha256 = $recipientSetSha256
    Target = $targets[0]
    TopicArn = $topicArn
  }
}

function New-D2AlarmStatusAggregate {
  param(
    [Parameter(Mandatory)][hashtable]$Context,
    [DateTimeOffset]$CheckedAt = [DateTimeOffset]::UtcNow
  )

  return [pscustomobject][ordered]@{
    profile = "d2_deployed_alarm_status_v1"
    checkedAt = Format-CanonicalTimestamp $CheckedAt
    confirmedRecipients = @($Context.Confirmed).Count
    pendingRecipients = @($Context.Pending).Count
    d2Alarms = @($Context.Alarms).Count
    healthyD2Alarms = @($Context.Alarms | Where-Object { $_.StateValue -ceq "OK" }).Count
    targetState = [string]$Context.Target.StateValue
    planSha256 = [string]$Context.PlanSha256
    reviewedRecipientSetSha256 = [string]$Context.RecipientSetSha256
  }
}

function New-D2AlarmExerciseAggregate {
  param(
    [Parameter(Mandatory)][DateTimeOffset]$StartedAt,
    [Parameter(Mandatory)][DateTimeOffset]$EndedAt,
    [Parameter(Mandatory)][bool]$DeliveryConfirmed,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][string]$RecipientSetSha256,
    [Parameter(Mandatory)][int]$HealthyD2Alarms
  )

  if ($EndedAt -lt $StartedAt -or $PlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    $RecipientSetSha256 -cnotmatch '^[a-f0-9]{64}$' -or $HealthyD2Alarms -ne $expectedAlarmCount) {
    throw "The D2 alarm exercise aggregate boundary is invalid."
  }
  return [pscustomobject][ordered]@{
    profile = "d2_deployed_alarm_delivery_v1"
    startedAt = Format-CanonicalTimestamp $StartedAt
    endedAt = Format-CanonicalTimestamp $EndedAt
    durationMs = [Math]::Max(1, [long][Math]::Ceiling(($EndedAt - $StartedAt).TotalMilliseconds))
    alarmTransitions = 1
    recoveryTransitions = 1
    deliveryConfirmed = $DeliveryConfirmed
    planSha256 = $PlanSha256
    reviewedRecipientSetSha256 = $RecipientSetSha256
    healthyD2Alarms = $HealthyD2Alarms
    finalTargetState = "OK"
  }
}

function Publish-D2AlarmMetric {
  param([ValidateRange(0, 1)][int]$Value)

  $metricData = @(@{
      MetricName = $metricName
      Timestamp = [DateTime]::UtcNow.ToString("o")
      Unit = "Count"
      Value = $Value
    }) | ConvertTo-Json -Compress
  $null = & aws.exe cloudwatch put-metric-data `
    --namespace $metricNamespace `
    --metric-data $metricData `
    --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not publish the generated-synthetic D2 alarm metric."
  }
}

function Wait-D2TargetState {
  param(
    [ValidateSet("ALARM", "OK")][string]$ExpectedState,
    [ValidateRange(30, 600)][int]$TimeoutSeconds = 300
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $result = Invoke-AwsJson @(
      "cloudwatch", "describe-alarms", "--alarm-names", $targetAlarmName, "--output", "json"
    )
    $alarm = @($result.MetricAlarms)
    if ($alarm.Count -eq 1 -and [string]$alarm[0].StateValue -ceq $ExpectedState) { return }
    Start-Sleep -Seconds 10
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The D2 TrustSignalFailed alarm did not reach $ExpectedState within the bounded wait."
}

function Read-ManualDeliveryConfirmation {
  param([scriptblock]$ReadInput = { param($Prompt) Read-Host $Prompt })

  $prompt = "After directly verifying both sanitized D2 notifications, type $manualDeliveryConfirmation"
  return [string](& $ReadInput $prompt) -ceq $manualDeliveryConfirmation
}

Assert-ActionInputs
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
Assert-EnvironmentContext
$context = Get-D2AlarmContext

if ($Action -ceq "Status") {
  New-D2AlarmStatusAggregate -Context $context | ConvertTo-Json -Compress
  exit 0
}

if ([string]$context.PlanSha256 -cne $ReviewedPlanSha256) {
  throw "The reviewed D2 alarm plan does not match current AWS state. Run Status and review again."
}
if ([string]$context.RecipientSetSha256 -cne $ReviewedRecipientSetSha256) {
  throw "The reviewed D2 recipient set does not match the current confirmed recipient set."
}

$startedAt = [DateTimeOffset]::UtcNow
$breachPublished = $false
try {
  Publish-D2AlarmMetric -Value 1
  $breachPublished = $true
  Wait-D2TargetState -ExpectedState "ALARM"
  Publish-D2AlarmMetric -Value 0
  Wait-D2TargetState -ExpectedState "OK"
}
finally {
  if ($breachPublished) {
    Publish-D2AlarmMetric -Value 0
  }
}

$finalContext = Get-D2AlarmContext
$deliveryConfirmed = Read-ManualDeliveryConfirmation
$endedAt = [DateTimeOffset]::UtcNow
New-D2AlarmExerciseAggregate `
  -StartedAt $startedAt `
  -EndedAt $endedAt `
  -DeliveryConfirmed $deliveryConfirmed `
  -PlanSha256 $ReviewedPlanSha256 `
  -RecipientSetSha256 $ReviewedRecipientSetSha256 `
  -HealthyD2Alarms (@($finalContext.Alarms).Count) | ConvertTo-Json -Compress
