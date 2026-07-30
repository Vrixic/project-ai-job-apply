[CmdletBinding()]
param(
  [ValidateSet("Status", "Subscribe", "Exercise")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-alerts.ps1
  .\scripts\operate-development-alerts.ps1 -Action Subscribe -Execute
  .\scripts\operate-development-alerts.ps1 -Action Exercise -Execute

Status is read-only and reports only aggregate subscription and alarm state.
Subscribe securely prompts for an email address, sends an AWS SNS confirmation request, and never
prints or writes the address. Confirm the AWS email before exercising delivery.
Exercise emits only a dedicated synthetic canary metric, waits for ALARM and OK, and leaves the
canary healthy. It does not modify application, queue, database, or user data.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

$topicName = "ai-job-apply-development-operational-alerts"
$alarmName = "ai-job-apply-development-alert-delivery-canary"
$metricNamespace = "ai-job-apply/development/operational"
$metricName = "AlertDeliveryCanary"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "An AWS command failed. Refresh the development SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Assert-DevelopmentContext {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary development IAM Identity Center session; long-lived callers are rejected."
  }

  $regionResult = & aws configure get region --profile $AwsProfile 2>$null
  if ($LASTEXITCODE -ne 0 -or $regionResult.Trim() -ne $Region) {
    throw "The AWS profile region does not match the reviewed development region."
  }
}

function Get-AlertContext {
  $topics = Invoke-AwsJson @("sns", "list-topics", "--output", "json")
  $matchingTopics = @(
    $topics.Topics | Where-Object { ([string]$_.TopicArn).EndsWith(":$topicName") }
  )
  if ($matchingTopics.Count -ne 1) {
    throw "The exact Terraform-managed development alert topic is not available."
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

  return @{
    Alarm        = $alarms[0]
    Confirmed    = @($subscriptions | Where-Object { $_.SubscriptionArn -ne "PendingConfirmation" })
    Pending      = @($subscriptions | Where-Object { $_.SubscriptionArn -eq "PendingConfirmation" })
    Subscriptions = $subscriptions
    TopicArn     = $topicArn
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

Assert-DevelopmentContext
$context = Get-AlertContext

switch ($Action) {
  "Status" {
    Write-SanitizedStatus $context
  }
  "Subscribe" {
    if (-not $Execute) {
      throw "Subscribe sends an external confirmation email. Re-run with -Execute after review."
    }

    $secureEmail = Read-Host "Development alert email (input is hidden and never stored)" -AsSecureString
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

    try {
      if ($context.Alarm.StateValue -ne "OK") {
        Publish-CanaryMetric 0
        Wait-ForCanaryState "OK"
      }
      Publish-CanaryMetric 1
      Wait-ForCanaryState "ALARM"
      Write-Output "Synthetic canary reached ALARM."

      Publish-CanaryMetric 0
      Wait-ForCanaryState "OK"
      Write-Output "Synthetic canary recovered to OK."
      Write-Output "Confirm receipt of both sanitized AWS notifications before recording delivery evidence."
    }
    finally {
      Publish-CanaryMetric 0
    }
  }
}
