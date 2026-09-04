Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\exercise-development-d2-alarm.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  $operatorPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -ne 0) { throw "The D2 alarm exercise operator does not parse." }

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)

  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Operator function $Name must be defined exactly once." }
  Invoke-Expression "function global:$Name $($matches[0].Body.Extent.Text)"
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)

  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw "$Description was accepted." }
}

$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ReviewedPlanSha256",
  "ReviewedRecipientSetSha256", "Execute", "Help"
)
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The D2 alarm operator public parameter surface changed."
}

foreach ($required in @(
    '"ai-job-apply-development-d2-trustsignalfailed"',
    '"AIJobApply/D2Community"',
    '"TrustSignalFailed"',
    '$expectedAlarmCount = 13',
    'Publish-D2AlarmMetric -Value 1',
    'Wait-D2TargetState -ExpectedState "ALARM"',
    'Publish-D2AlarmMetric -Value 0',
    'Wait-D2TargetState -ExpectedState "OK"',
    'Get-D2AlarmContext',
    'Read-ManualDeliveryConfirmation',
    'ConvertTo-Json -Compress'
  )) {
  if (-not $source.Contains($required)) { throw "The D2 alarm operator misses $required." }
}
foreach ($forbidden in @(
    "set-alarm-state", "put-metric-alarm", "delete-alarms", "lambda invoke",
    "sqs send-message", "terraform apply", "deliveryConfirmed = `$true"
  )) {
  if ($source.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw "The D2 alarm operator contains forbidden behavior $forbidden."
  }
}

foreach ($functionName in @(
    "Get-Sha256", "Format-CanonicalTimestamp", "Assert-ActionInputs",
    "Get-ConfirmedRecipientSetSha256", "Assert-ExactTargetAlarm",
    "New-D2AlarmStatusAggregate", "New-D2AlarmExerciseAggregate",
    "Read-ManualDeliveryConfirmation"
  )) { Import-OperatorFunction $functionName }

$targetAlarmName = "ai-job-apply-development-d2-trustsignalfailed"
$metricNamespace = "AIJobApply/D2Community"
$metricName = "TrustSignalFailed"
$expectedAlarmCount = 13
$manualDeliveryConfirmation = "CONFIRM-D2-TRUST-SIGNAL-FAILED-ALARM-AND-OK-RECEIVED"
$Region = "us-east-2"
$Action = "Status"
$Execute = $false
$ReviewedPlanSha256 = ""
$ReviewedRecipientSetSha256 = ""
Assert-ActionInputs
$Execute = $true
Assert-Rejected { Assert-ActionInputs } "mutating Status invocation"
$Execute = $false
$Action = "Exercise"
Assert-Rejected { Assert-ActionInputs } "unconfirmed Exercise invocation"
$Execute = $true
$ReviewedPlanSha256 = "a" * 64
$ReviewedRecipientSetSha256 = "b" * 64
Assert-ActionInputs
$Region = "us-east-1"
Assert-Rejected { Assert-ActionInputs } "non-development-region invocation"
$Region = "us-east-2"

$subscriptions = @(
  [pscustomobject]@{ Protocol = "email"; Endpoint = "ZETA@example.test" },
  [pscustomobject]@{ Protocol = "email"; Endpoint = "alpha@example.test" }
)
$canonical = "d2-alert-recipient-set-v1`nalpha@example.test`nzeta@example.test`n"
$expectedRecipientSha256 = Get-Sha256 $canonical
$recipientSha256 = Get-ConfirmedRecipientSetSha256 -ConfirmedSubscriptions $subscriptions
if ($recipientSha256 -cne $expectedRecipientSha256) {
  throw "The D2 recipient-set digest is not canonical."
}
$reordered = @($subscriptions[1], $subscriptions[0])
if ((Get-ConfirmedRecipientSetSha256 -ConfirmedSubscriptions $reordered) -cne $recipientSha256) {
  throw "D2 recipient ordering changed the digest."
}
Assert-Rejected {
  Get-ConfirmedRecipientSetSha256 -ConfirmedSubscriptions @($subscriptions[0], $subscriptions[0])
} "duplicate D2 recipient set"
Assert-Rejected {
  Get-ConfirmedRecipientSetSha256 -ConfirmedSubscriptions @(
    [pscustomobject]@{ Protocol = "https"; Endpoint = "https://example.test" }
  )
} "non-email D2 recipient set"

$topicArn = "arn:aws:sns:us-east-2:123456789012:private-topic"
$alarmArn = "arn:aws:cloudwatch:us-east-2:123456789012:alarm:$targetAlarmName"
$target = [pscustomobject]@{
  AlarmName = $targetAlarmName
  AlarmArn = $alarmArn
  Namespace = $metricNamespace
  MetricName = $metricName
  ComparisonOperator = "GreaterThanThreshold"
  Threshold = 0
  EvaluationPeriods = 1
  Period = 60
  Statistic = "Sum"
  TreatMissingData = "notBreaching"
  ActionsEnabled = $true
  Dimensions = @()
  AlarmActions = @($topicArn)
  OKActions = @($topicArn)
  InsufficientDataActions = @()
  StateValue = "OK"
}
Assert-ExactTargetAlarm -Alarm $target -TopicArn $topicArn
$badTarget = $target.PSObject.Copy()
$badTarget.MetricName = "OtherMetric"
Assert-Rejected { Assert-ExactTargetAlarm -Alarm $badTarget -TopicArn $topicArn } "wrong D2 metric"
$badTarget = $target.PSObject.Copy()
$badTarget.AlarmActions = @("arn:aws:sns:us-east-2:123456789012:wrong")
Assert-Rejected { Assert-ExactTargetAlarm -Alarm $badTarget -TopicArn $topicArn } "wrong D2 alarm route"

$alarms = @(1..13 | ForEach-Object { [pscustomobject]@{ StateValue = "OK" } })
$context = @{
  Alarms = $alarms
  Confirmed = $subscriptions
  Pending = @()
  PlanSha256 = "c" * 64
  RecipientSetSha256 = $recipientSha256
  Target = $target
}
$checkedAt = [DateTimeOffset]::Parse("2026-09-04T12:34:56.789Z")
$status = New-D2AlarmStatusAggregate -Context $context -CheckedAt $checkedAt
$statusNames = @($status.PSObject.Properties | ForEach-Object Name)
$expectedStatusNames = @(
  "profile", "checkedAt", "confirmedRecipients", "pendingRecipients", "d2Alarms",
  "healthyD2Alarms", "targetState", "planSha256", "reviewedRecipientSetSha256"
)
if (($statusNames -join "|") -cne ($expectedStatusNames -join "|") -or
  [string]$status.profile -cne "d2_deployed_alarm_status_v1" -or
  [string]$status.checkedAt -cne "2026-09-04T12:34:56.789Z" -or
  [int]$status.confirmedRecipients -ne 2 -or [int]$status.pendingRecipients -ne 0 -or
  [int]$status.d2Alarms -ne 13 -or [int]$status.healthyD2Alarms -ne 13 -or
  [string]$status.targetState -cne "OK") {
  throw "The D2 alarm status aggregate does not match its exact contract."
}
$statusJson = $status | ConvertTo-Json -Compress
foreach ($forbidden in @("example.test", "private-topic", "123456789012", "AlarmArn")) {
  if ($statusJson.Contains($forbidden)) { throw "D2 alarm status retained forbidden detail." }
}

$startedAt = [DateTimeOffset]::Parse("2026-09-04T12:35:00.000Z")
$endedAt = [DateTimeOffset]::Parse("2026-09-04T12:36:30.250Z")
$exercise = New-D2AlarmExerciseAggregate `
  -StartedAt $startedAt `
  -EndedAt $endedAt `
  -DeliveryConfirmed $true `
  -PlanSha256 ("c" * 64) `
  -RecipientSetSha256 $recipientSha256 `
  -HealthyD2Alarms 13
$exerciseNames = @($exercise.PSObject.Properties | ForEach-Object Name)
$expectedExerciseNames = @(
  "profile", "startedAt", "endedAt", "durationMs", "alarmTransitions",
  "recoveryTransitions", "deliveryConfirmed", "planSha256",
  "reviewedRecipientSetSha256", "healthyD2Alarms", "finalTargetState"
)
if (($exerciseNames -join "|") -cne ($expectedExerciseNames -join "|") -or
  [string]$exercise.profile -cne "d2_deployed_alarm_delivery_v1" -or
  [long]$exercise.durationMs -ne 90250 -or [int]$exercise.alarmTransitions -ne 1 -or
  [int]$exercise.recoveryTransitions -ne 1 -or -not [bool]$exercise.deliveryConfirmed -or
  [int]$exercise.healthyD2Alarms -ne 13 -or [string]$exercise.finalTargetState -cne "OK") {
  throw "The D2 alarm exercise aggregate does not match its exact contract."
}
Assert-Rejected {
  New-D2AlarmExerciseAggregate -StartedAt $endedAt -EndedAt $startedAt `
    -DeliveryConfirmed $true -PlanSha256 ("c" * 64) `
    -RecipientSetSha256 $recipientSha256 -HealthyD2Alarms 13
} "backward D2 alarm exercise window"
Assert-Rejected {
  New-D2AlarmExerciseAggregate -StartedAt $startedAt -EndedAt $endedAt `
    -DeliveryConfirmed $true -PlanSha256 ("c" * 64) `
    -RecipientSetSha256 $recipientSha256 -HealthyD2Alarms 12
} "incomplete D2 alarm recovery"

if (-not (Read-ManualDeliveryConfirmation -ReadInput {
      param($Prompt)
      if ([string]$Prompt -notmatch "directly verifying both sanitized D2 notifications") {
        throw "The D2 delivery prompt is not explicit."
      }
      return "CONFIRM-D2-TRUST-SIGNAL-FAILED-ALARM-AND-OK-RECEIVED"
    })) {
  throw "The exact D2 delivery confirmation was rejected."
}
if (Read-ManualDeliveryConfirmation -ReadInput { param($Prompt) return "yes" }) {
  throw "A non-exact D2 delivery confirmation was accepted."
}

Write-Output "Development D2 alarm exercise tests passed."
