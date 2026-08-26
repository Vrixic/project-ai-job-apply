[CmdletBinding()]
param(
  [ValidateSet("Status", "Subscribe", "Exercise")]
  [string]$Action = "Status",
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [string]$AwsProfile = "",
  [string]$Region = "us-east-2",
  [switch]$AggregateJson,
  [ValidatePattern("^[0-9a-f]{64}$")]
  [string]$ReviewedRecipientSetSha256 = "",
  [switch]$Execute,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-platform-alerts.ps1
  .\scripts\operate-platform-alerts.ps1 -Environment staging
  .\scripts\operate-platform-alerts.ps1 -Environment staging -Action Subscribe -Execute
  .\scripts\operate-platform-alerts.ps1 -Environment staging -Action Exercise -Execute
  .\scripts\operate-platform-alerts.ps1 -Environment development -Action Status -AggregateJson
  .\scripts\operate-platform-alerts.ps1 -Environment development -Action Exercise -Execute `
    -AggregateJson -ReviewedRecipientSetSha256 <sha256>

Status is read-only and reports only aggregate subscription and alarm state.
Subscribe securely prompts for an email address, sends an AWS SNS confirmation request, and never
prints or writes the address. Confirm the AWS email before exercising delivery.
Exercise emits only a dedicated synthetic canary metric, waits for ALARM and OK, and leaves the
canary healthy. JSON exercise output requires the exact reviewed recipient-set digest and asks the
operator to confirm receipt after both transitions. It never infers notification receipt. It does
not modify application, queue, database, or user data.
"@
  exit 0
}

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 deployed environments are restricted to us-east-2."
}

$environmentLabel = if ($Environment -eq "staging") { "Staging" } else { "Development" }
$topicName = "ai-job-apply-$Environment-operational-alerts"
$alarmName = "ai-job-apply-$Environment-alert-delivery-canary"
$alarmPrefix = "ai-job-apply-$Environment-"
$metricNamespace = "ai-job-apply/$Environment/operational"
$metricName = "AlertDeliveryCanary"
$manualDeliveryConfirmation = "CONFIRM-SYNTHETIC-ALARM-AND-OK-RECEIVED"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "An AWS command failed. Refresh the $Environment SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Assert-EnvironmentContext {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary $Environment IAM Identity Center session; long-lived callers are rejected."
  }

  $regionResult = & aws configure get region --profile $AwsProfile 2>$null
  if ($LASTEXITCODE -ne 0 -or $regionResult.Trim() -ne $Region) {
    throw "The AWS profile region does not match the reviewed $Environment region."
  }
}

function Get-AlertContext {
  param([switch]$IncludeRuntimeAlarms)
  $topics = Invoke-AwsJson @("sns", "list-topics", "--output", "json")
  $matchingTopics = @(
    $topics.Topics | Where-Object { ([string]$_.TopicArn).EndsWith(":$topicName") }
  )
  if ($matchingTopics.Count -ne 1) {
    throw "The exact Terraform-managed $Environment alert topic is not available."
  }
  $topicArn = [string]$matchingTopics[0].TopicArn

  $alarmResult = Invoke-AwsJson @(
    "cloudwatch",
    "describe-alarms",
    "--alarm-names",
    $alarmName,
    "--output",
    "json"
  )
  $alarms = @($alarmResult.MetricAlarms)
  if ($alarms.Count -ne 1) {
    throw "The exact Terraform-managed alert-delivery canary is not available."
  }

  $subscriptionResult = Invoke-AwsJson @(
    "sns",
    "list-subscriptions-by-topic",
    "--topic-arn",
    $topicArn,
    "--output",
    "json"
  )
  $subscriptions = @($subscriptionResult.Subscriptions)

  $runtimeAlarms = @()
  if ($IncludeRuntimeAlarms) {
    $allAlarmResult = Invoke-AwsJson @(
      "cloudwatch",
      "describe-alarms",
      "--alarm-name-prefix",
      $alarmPrefix,
      "--output",
      "json"
    )
    $runtimeAlarms = @(
      $allAlarmResult.MetricAlarms | Where-Object { [string]$_.AlarmName -cne $alarmName }
    )
    if ($runtimeAlarms.Count -lt 1) {
      throw "No Terraform-managed runtime alarms were found for the exact environment prefix."
    }
  }

  return @{
    Alarm        = $alarms[0]
    Confirmed    = @($subscriptions | Where-Object { $_.SubscriptionArn -ne "PendingConfirmation" })
    Pending      = @($subscriptions | Where-Object { $_.SubscriptionArn -eq "PendingConfirmation" })
    Subscriptions = $subscriptions
    TopicArn     = $topicArn
    RuntimeAlarms = $runtimeAlarms
  }
}

function Get-HealthyRuntimeAlarmCount {
  param([Parameter(Mandatory)][hashtable]$Context, [switch]$RequireAllHealthy)

  $runtimeAlarms = @($Context.RuntimeAlarms)
  $healthy = @($runtimeAlarms | Where-Object { [string]$_.StateValue -ceq "OK" })
  if ($RequireAllHealthy) {
    $unhealthy = @($runtimeAlarms | Where-Object { [string]$_.StateValue -cne "OK" })
    $unrouted = @($runtimeAlarms | Where-Object {
        @($_.AlarmActions).Count -lt 1 -or @($_.OKActions).Count -lt 1
      })
    if ($unhealthy.Count -ne 0 -or $unrouted.Count -ne 0) {
      throw "Machine-readable status requires every managed runtime alarm to be OK with both ALARM and OK actions."
    }
  }
  return $healthy.Count
}

function Get-ConfirmedRecipientSetSha256 {
  param([Parameter(Mandatory)][hashtable]$Context)

  $confirmed = @($Context.Confirmed)
  if ($confirmed.Count -lt 1) {
    throw "At least one confirmed recipient is required before binding a recipient set."
  }
  $recipients = New-Object Collections.Generic.List[string]
  foreach ($subscription in $confirmed) {
    if ([string]$subscription.Protocol -cne "email" -or
      [string]::IsNullOrWhiteSpace([string]$subscription.Endpoint)) {
      throw "The reviewed alert recipient set accepts only confirmed email subscriptions."
    }
    $recipients.Add(([string]$subscription.Endpoint).Trim().ToLowerInvariant())
  }
  $canonicalRecipients = [string[]]$recipients.ToArray()
  [Array]::Sort($canonicalRecipients, [StringComparer]::Ordinal)
  if (@($canonicalRecipients | Select-Object -Unique).Count -ne $confirmed.Count) {
    throw "The confirmed alert recipient set contains a duplicate destination."
  }
  $payload = "d1-alert-recipient-set-v1`n" + (($canonicalRecipients -join "`n") + "`n")
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($payload)
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

function New-AlertStatusAggregate {
  param(
    [Parameter(Mandatory)][hashtable]$Context,
    [DateTimeOffset]$CheckedAt = [DateTimeOffset]::UtcNow
  )

  $healthyRuntimeAlarms = Get-HealthyRuntimeAlarmCount -Context $Context -RequireAllHealthy
  if ([string]$Context.Alarm.StateValue -cne "OK" -or
    @($Context.Alarm.AlarmActions).Count -lt 1 -or
    @($Context.Alarm.OKActions).Count -lt 1) {
    throw "Machine-readable status requires the alert-delivery canary to be OK with both actions."
  }
  return [pscustomobject][ordered]@{
    profile = "d1_deployed_alert_status_v1"
    checkedAt = Format-CanonicalTimestamp $CheckedAt
    confirmedRecipients = @($Context.Confirmed).Count
    pendingRecipients = @($Context.Pending).Count
    canaryState = "OK"
    alarmActionCount = @($Context.Alarm.AlarmActions).Count
    okActionCount = @($Context.Alarm.OKActions).Count
    healthyRuntimeAlarms = $healthyRuntimeAlarms
  }
}

function New-AlertExerciseAggregate {
  param(
    [Parameter(Mandatory)][DateTimeOffset]$StartedAt,
    [Parameter(Mandatory)][DateTimeOffset]$EndedAt,
    [Parameter(Mandatory)][bool]$DeliveryConfirmed,
    [Parameter(Mandatory)][string]$RecipientSetSha256,
    [Parameter(Mandatory)][string]$FinalCanaryState
  )

  if ($RecipientSetSha256 -cnotmatch '^[0-9a-f]{64}$' -or $FinalCanaryState -cne "OK" -or
    $EndedAt -lt $StartedAt) {
    throw "The alert exercise aggregate boundary is invalid."
  }
  $durationMs = [Math]::Max(1, [long][Math]::Ceiling(($EndedAt - $StartedAt).TotalMilliseconds))
  return [pscustomobject][ordered]@{
    profile = "d1_deployed_alert_delivery_v1"
    startedAt = Format-CanonicalTimestamp $StartedAt
    endedAt = Format-CanonicalTimestamp $EndedAt
    durationMs = $durationMs
    alarmTransitions = 1
    recoveryTransitions = 1
    deliveryConfirmed = $DeliveryConfirmed
    reviewedRecipientSetSha256 = $RecipientSetSha256
    finalCanaryState = "OK"
  }
}

function Read-ManualDeliveryConfirmation {
  param([scriptblock]$ReadInput = { param($Prompt) Read-Host $Prompt })

  $prompt = "After directly verifying both sanitized notifications, type $manualDeliveryConfirmation"
  $response = & $ReadInput $prompt
  return [string]$response -ceq $manualDeliveryConfirmation
}

function Assert-ActionInputs {
  if ($Action -ceq "Subscribe" -and $AggregateJson) {
    throw "Subscribe has no aggregate JSON contract. Use the hidden interactive workflow."
  }
  if ($Action -ceq "Exercise" -and $AggregateJson) {
    if ($ReviewedRecipientSetSha256 -cnotmatch '^[0-9a-f]{64}$') {
      throw "JSON exercise requires the exact reviewed recipient-set SHA-256."
    }
  }
  elseif (-not [string]::IsNullOrWhiteSpace($ReviewedRecipientSetSha256)) {
    throw "The reviewed recipient-set SHA-256 is accepted only by JSON Exercise."
  }
}

function Write-SanitizedStatus {
  param([hashtable]$Context)

  [pscustomobject]@{
    TopicAvailable         = $true
    ConfirmedSubscriptions = $Context.Confirmed.Count
    PendingSubscriptions   = $Context.Pending.Count
    CanaryState            = [string]$Context.Alarm.StateValue
    AlarmActionCount       = @($Context.Alarm.AlarmActions).Count
    OkActionCount          = @($Context.Alarm.OKActions).Count
  } | Format-List
}

function ConvertFrom-SecureEmail {
  param([Security.SecureString]$SecureEmail)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureEmail)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Publish-CanaryMetric {
  param([ValidateRange(0, 1)][int]$Value)

  $metricData = @(
    @{
      MetricName = $metricName
      Timestamp  = [DateTime]::UtcNow.ToString("o")
      Unit       = "Count"
      Value      = $Value
    }
  ) | ConvertTo-Json -Compress
  $null = & aws cloudwatch put-metric-data `
    --namespace $metricNamespace `
    --metric-data $metricData `
    --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not publish the synthetic alert-delivery canary metric."
  }
}

function Wait-ForCanaryState {
  param(
    [ValidateSet("ALARM", "OK")]
    [string]$ExpectedState,
    [int]$TimeoutSeconds = 240
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $alarmResult = Invoke-AwsJson @(
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      $alarmName,
      "--output",
      "json"
    )
    $alarm = @($alarmResult.MetricAlarms)[0]
    if ($alarm -and $alarm.StateValue -eq $ExpectedState) {
      return
    }
    Start-Sleep -Seconds 10
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "The alert-delivery canary did not reach the expected state within the bounded wait."
}

Assert-ActionInputs
Assert-EnvironmentContext
$context = Get-AlertContext -IncludeRuntimeAlarms:$AggregateJson

switch ($Action) {
  "Status" {
    if ($AggregateJson) {
      New-AlertStatusAggregate -Context $context | ConvertTo-Json -Compress
    }
    else { Write-SanitizedStatus $context }
  }
  "Subscribe" {
    if (-not $Execute) {
      throw "Subscribe sends an external confirmation email. Re-run with -Execute after review."
    }

    $secureEmail = Read-Host "$environmentLabel alert email (input is hidden and never stored)" -AsSecureString
    $email = ConvertFrom-SecureEmail $secureEmail
    try {
      if ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
        throw "Enter a valid email address."
      }
      $existing = @($context.Subscriptions | Where-Object { $_.Endpoint -eq $email })
      if ($existing.Count -gt 0) {
        Write-Output "A subscription for that destination already exists. Run Status after confirmation."
        break
      }

      $null = & aws sns subscribe `
        --topic-arn $context.TopicArn `
        --protocol email `
        --notification-endpoint $email `
        --return-subscription-arn `
        --output json 2>$null
      if ($LASTEXITCODE -ne 0) {
        throw "AWS did not accept the subscription request."
      }
      Write-Output "Subscription request sent. Confirm the AWS SNS email, then run Status."
    }
    finally {
      $email = $null
      $secureEmail.Dispose()
    }
  }
  "Exercise" {
    if (-not $Execute) {
      throw "Exercise changes a synthetic CloudWatch metric and sends notifications. Re-run with -Execute."
    }
    if ($context.Confirmed.Count -lt 1) {
      throw "Confirm at least one alert subscription before exercising delivery."
    }
    if (
      @($context.Alarm.AlarmActions).Count -lt 1 -or
      @($context.Alarm.OKActions).Count -lt 1
    ) {
      throw "The canary does not have both ALARM and OK notification actions."
    }
    if ($AggregateJson) {
      $actualRecipientSetSha256 = Get-ConfirmedRecipientSetSha256 -Context $context
      if ($actualRecipientSetSha256 -cne $ReviewedRecipientSetSha256) {
        throw "The confirmed recipients do not match the exact reviewed recipient-set SHA-256."
      }
    }

    $startedAt = [DateTimeOffset]::UtcNow
    try {
      if ($context.Alarm.StateValue -ne "OK") {
        Publish-CanaryMetric 0
        Wait-ForCanaryState "OK"
      }
      Publish-CanaryMetric 1
      Wait-ForCanaryState "ALARM"
      if (-not $AggregateJson) { Write-Output "Synthetic canary reached ALARM." }

      Publish-CanaryMetric 0
      Wait-ForCanaryState "OK"
      if (-not $AggregateJson) {
        Write-Output "Synthetic canary recovered to OK."
        Write-Output "Confirm receipt of both sanitized AWS notifications before recording delivery evidence."
      }
    }
    finally {
      Publish-CanaryMetric 0
    }
    if ($AggregateJson) {
      $finalContext = Get-AlertContext
      if ([string]$finalContext.Alarm.StateValue -cne "OK") {
        throw "The alert-delivery canary did not finish in OK."
      }
      $deliveryConfirmed = Read-ManualDeliveryConfirmation
      $endedAt = [DateTimeOffset]::UtcNow
      New-AlertExerciseAggregate -StartedAt $startedAt -EndedAt $endedAt `
        -DeliveryConfirmed $deliveryConfirmed -RecipientSetSha256 $ReviewedRecipientSetSha256 `
        -FinalCanaryState ([string]$finalContext.Alarm.StateValue) | ConvertTo-Json -Compress
    }
  }
}
