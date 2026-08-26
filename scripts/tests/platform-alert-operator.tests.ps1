Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-platform-alerts.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  $operatorPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -ne 0) { throw "The platform alert operator does not parse." }

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
  "Action", "Environment", "AwsProfile", "Region", "AggregateJson",
  "ReviewedRecipientSetSha256", "Execute", "Help"
)
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The platform alert operator public parameter surface changed."
}

foreach ($requiredText in @(
    '"d1_deployed_alert_status_v1"',
    '"d1_deployed_alert_delivery_v1"',
    'Get-ConfirmedRecipientSetSha256 -Context $context',
    '$actualRecipientSetSha256 -cne $ReviewedRecipientSetSha256',
    '$deliveryConfirmed = Read-ManualDeliveryConfirmation',
    'ConvertTo-Json -Compress'
  )) {
  if (-not $source.Contains($requiredText)) {
    throw "The strict aggregate alert boundary is missing '$requiredText'."
  }
}
if ($source.Contains('deliveryConfirmed = $true')) {
  throw "The alert operator contains an inferred delivery confirmation."
}

foreach ($functionName in @(
    "Get-HealthyRuntimeAlarmCount", "Get-ConfirmedRecipientSetSha256",
    "Format-CanonicalTimestamp", "New-AlertStatusAggregate",
    "New-AlertExerciseAggregate", "Read-ManualDeliveryConfirmation", "Assert-ActionInputs",
    "Write-SanitizedStatus"
  )) { Import-OperatorFunction $functionName }

$manualDeliveryConfirmation = "CONFIRM-SYNTHETIC-ALARM-AND-OK-RECEIVED"
$Action = "Status"
$AggregateJson = $true
$ReviewedRecipientSetSha256 = ""
$Execute = $false
Assert-ActionInputs
$Action = "Subscribe"
Assert-Rejected { Assert-ActionInputs } "JSON subscription invocation"
$Action = "Exercise"
$ReviewedRecipientSetSha256 = ""
Assert-Rejected { Assert-ActionInputs } "unbound JSON exercise invocation"
$ReviewedRecipientSetSha256 = "a" * 64
Assert-ActionInputs
$Action = "Status"
Assert-Rejected { Assert-ActionInputs } "recipient digest on a non-exercise action"
$ReviewedRecipientSetSha256 = ""

$topicArn = "arn:aws:sns:us-east-2:123456789012:private-topic"
$runtimeAlarms = @(
  [pscustomobject]@{
    AlarmName = "ai-job-apply-development-gateway-errors"
    StateValue = "OK"
    AlarmActions = @($topicArn)
    OKActions = @($topicArn)
  },
  [pscustomobject]@{
    AlarmName = "ai-job-apply-development-durable-failed"
    StateValue = "OK"
    AlarmActions = @($topicArn)
    OKActions = @($topicArn)
  }
)
$context = @{
  Alarm = [pscustomobject]@{
    AlarmName = "ai-job-apply-development-alert-delivery-canary"
    StateValue = "OK"
    AlarmActions = @($topicArn)
    OKActions = @($topicArn)
  }
  Confirmed = @(
    [pscustomobject]@{
      Protocol = "email"
      Endpoint = "ZETA@example.test"
      SubscriptionArn = "arn:aws:sns:us-east-2:123456789012:private-topic:one"
    },
    [pscustomobject]@{
      Protocol = "email"
      Endpoint = "alpha@example.test"
      SubscriptionArn = "arn:aws:sns:us-east-2:123456789012:private-topic:two"
    }
  )
  Pending = @()
  Subscriptions = @()
  TopicArn = $topicArn
  RuntimeAlarms = $runtimeAlarms
}

$displayStatus = Write-SanitizedStatus -Context $context | Out-String
foreach ($legacyField in @(
    "TopicAvailable", "ConfirmedSubscriptions", "PendingSubscriptions", "CanaryState",
    "AlarmActionCount", "OkActionCount"
  )) {
  if ($displayStatus -notmatch [regex]::Escape($legacyField)) {
    throw "Default display status lost the existing $legacyField field."
  }
}
foreach ($aggregateOnlyField in @("profile", "checkedAt", "HealthyRuntimeAlarms")) {
  if ($displayStatus -match [regex]::Escape($aggregateOnlyField)) {
    throw "Default display status gained aggregate-only field $aggregateOnlyField."
  }
}

$canonical = "d1-alert-recipient-set-v1`nalpha@example.test`nzeta@example.test`n"
$bytes = [Text.UTF8Encoding]::new($false).GetBytes($canonical)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $expectedRecipientHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
}
finally { $sha.Dispose() }
$actualRecipientHash = Get-ConfirmedRecipientSetSha256 -Context $context
if ($actualRecipientHash -cne $expectedRecipientHash) {
  throw "The reviewed recipient-set digest is not deterministic and canonical."
}

$reorderedContext = @{} + $context
$reorderedContext.Confirmed = @($context.Confirmed[1], $context.Confirmed[0])
if ((Get-ConfirmedRecipientSetSha256 -Context $reorderedContext) -cne $actualRecipientHash) {
  throw "Recipient ordering changed the reviewed digest."
}
$duplicateContext = @{} + $context
$duplicateContext.Confirmed = @($context.Confirmed[0], $context.Confirmed[0])
Assert-Rejected {
  Get-ConfirmedRecipientSetSha256 -Context $duplicateContext
} "duplicate recipient set"
$nonEmailContext = @{} + $context
$nonEmailContext.Confirmed = @([pscustomobject]@{
    Protocol = "https"; Endpoint = "https://example.test"; SubscriptionArn = "synthetic"
  })
Assert-Rejected {
  Get-ConfirmedRecipientSetSha256 -Context $nonEmailContext
} "non-email recipient set"

$checkedAt = [DateTimeOffset]::Parse("2026-08-26T12:34:56.789Z")
$status = New-AlertStatusAggregate -Context $context -CheckedAt $checkedAt
$statusNames = @($status.PSObject.Properties | ForEach-Object Name)
$expectedStatusNames = @(
  "profile", "checkedAt", "confirmedRecipients", "pendingRecipients", "canaryState",
  "alarmActionCount", "okActionCount", "healthyRuntimeAlarms"
)
if (($statusNames -join "|") -cne ($expectedStatusNames -join "|") -or
  [string]$status.profile -cne "d1_deployed_alert_status_v1" -or
  [string]$status.checkedAt -cne "2026-08-26T12:34:56.789Z" -or
  [int]$status.confirmedRecipients -ne 2 -or [int]$status.pendingRecipients -ne 0 -or
  [string]$status.canaryState -cne "OK" -or [int]$status.healthyRuntimeAlarms -ne 2) {
  throw "The alert status aggregate does not match its exact contract."
}
$statusJson = $status | ConvertTo-Json -Compress
foreach ($forbidden in @("example.test", "private-topic", "123456789012", "SubscriptionArn")) {
  if ($statusJson.Contains($forbidden)) { throw "Status aggregate retained forbidden detail." }
}

$unhealthyContext = @{} + $context
$unhealthyContext.RuntimeAlarms = @($runtimeAlarms[0], [pscustomobject]@{
    AlarmName = "ai-job-apply-development-durable-failed"
    StateValue = "ALARM"
    AlarmActions = @($topicArn)
    OKActions = @($topicArn)
  })
Assert-Rejected {
  New-AlertStatusAggregate -Context $unhealthyContext -CheckedAt $checkedAt
} "unhealthy runtime-alarm aggregate"
$unroutedContext = @{} + $context
$unroutedContext.RuntimeAlarms = @([pscustomobject]@{
    AlarmName = "ai-job-apply-development-gateway-errors"
    StateValue = "OK"
    AlarmActions = @()
    OKActions = @($topicArn)
  })
Assert-Rejected {
  New-AlertStatusAggregate -Context $unroutedContext -CheckedAt $checkedAt
} "unrouted runtime-alarm aggregate"
$badCanaryContext = @{} + $context
$badCanaryContext.Alarm = [pscustomobject]@{
  AlarmName = "ai-job-apply-development-alert-delivery-canary"
  StateValue = "ALARM"
  AlarmActions = @($topicArn)
  OKActions = @($topicArn)
}
Assert-Rejected {
  New-AlertStatusAggregate -Context $badCanaryContext -CheckedAt $checkedAt
} "non-OK canary aggregate"

$startedAt = [DateTimeOffset]::Parse("2026-08-26T12:35:00.000Z")
$endedAt = [DateTimeOffset]::Parse("2026-08-26T12:35:01.250Z")
$exercise = New-AlertExerciseAggregate -StartedAt $startedAt -EndedAt $endedAt `
  -DeliveryConfirmed $true -RecipientSetSha256 $actualRecipientHash -FinalCanaryState "OK"
$exerciseNames = @($exercise.PSObject.Properties | ForEach-Object Name)
$expectedExerciseNames = @(
  "profile", "startedAt", "endedAt", "durationMs", "alarmTransitions", "recoveryTransitions",
  "deliveryConfirmed", "reviewedRecipientSetSha256", "finalCanaryState"
)
if (($exerciseNames -join "|") -cne ($expectedExerciseNames -join "|") -or
  [string]$exercise.profile -cne "d1_deployed_alert_delivery_v1" -or
  [long]$exercise.durationMs -ne 1250 -or [int]$exercise.alarmTransitions -ne 1 -or
  [int]$exercise.recoveryTransitions -ne 1 -or $exercise.deliveryConfirmed -isnot [bool] -or
  -not [bool]$exercise.deliveryConfirmed -or [string]$exercise.finalCanaryState -cne "OK" -or
  [string]$exercise.reviewedRecipientSetSha256 -cne $actualRecipientHash) {
  throw "The alert exercise aggregate does not match its exact contract."
}
Assert-Rejected {
  New-AlertExerciseAggregate -StartedAt $endedAt -EndedAt $startedAt `
    -DeliveryConfirmed $true -RecipientSetSha256 $actualRecipientHash -FinalCanaryState "OK"
} "backward alert exercise window"
Assert-Rejected {
  New-AlertExerciseAggregate -StartedAt $startedAt -EndedAt $endedAt `
    -DeliveryConfirmed $true -RecipientSetSha256 ("a" * 64) -FinalCanaryState "ALARM"
} "non-recovered alert exercise"

if (-not (Read-ManualDeliveryConfirmation -ReadInput {
      param($Prompt)
      if ([string]$Prompt -notmatch "directly verifying both sanitized notifications") {
        throw "The manual confirmation prompt is not explicit."
      }
      return "CONFIRM-SYNTHETIC-ALARM-AND-OK-RECEIVED"
    })) {
  throw "The exact manual delivery confirmation was rejected."
}
if (Read-ManualDeliveryConfirmation -ReadInput { param($Prompt) return "yes" }) {
  throw "A non-exact manual delivery confirmation was accepted."
}

Write-Output "Platform alert operator aggregate tests passed."
