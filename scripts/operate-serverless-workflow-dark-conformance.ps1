[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",
  [ValidateSet("Plan", "Execute", "Cleanup")][string]$Action = "Plan",
  [string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-serverless-workflow-dark-conformance.ps1 `
    -Environment staging -Action Plan
  .\scripts\operate-serverless-workflow-dark-conformance.ps1 `
    -Environment staging -Action Execute -ExpectedPlanSha256 REVIEWED_SHA256 -Execute
  .\scripts\operate-serverless-workflow-dark-conformance.ps1 `
    -Environment staging -Action Cleanup -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Plan performs AWS reads and writes one ignored checksum-reviewed context. Execute requires that
exact checksum and clean merged source. It exercises three synchronous rejection paths and one
asynchronous durable rejection because the deployed one-hour workflow cannot be invoked
synchronously. The reviewed durable failure must enter the exact DLQ, transition its two alarms,
and be removed by exact payload match. It never invokes the reconciler, enables a trigger, sends a
product SQS event, writes product data, or changes public traffic. Cleanup contains only the exact
reviewed synthetic execution/message and removes the matching local context.
"@
  exit 0
}
if ($Region -ne "us-east-2") { throw "Dark conformance is restricted to us-east-2." }
if (-not $AwsProfile) { $AwsProfile = "ai-job-apply-$Environment-admin" }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform\dark-plan-data"
$contextDirectory = Join-Path $environmentDirectory ".terraform\workflow-dark-plans"
$contextPath = Join-Path $contextDirectory "workflow-dark-conformance-context.json"
$operatorPath = $MyInvocation.MyCommand.Path
$utf8 = New-Object Text.UTF8Encoding($false)
$resourcePrefix = "ai-job-apply-$Environment"
$functions = [ordered]@{
  Starter = "$resourcePrefix-outbox-starter"
  Reconciler = "$resourcePrefix-outbox-reconciler"
  Activity = "$resourcePrefix-profile-readiness-activity"
  Terminal = "$resourcePrefix-profile-readiness-terminal"
  Durable = "$resourcePrefix-profile-readiness-durable"
}
$concurrency = [ordered]@{ Starter = 1; Reconciler = 1; Activity = 1; Terminal = 1; Durable = 2 }
$rules = @(
  "$resourcePrefix-outbox-reconciler",
  "$resourcePrefix-profile-readiness-terminal"
)
$alarms = @(
  "$resourcePrefix-outbox-reconciler-errors",
  "$resourcePrefix-outbox-starter-errors",
  "$resourcePrefix-outbox-starter-throttles",
  "$resourcePrefix-profile-readiness-activity-errors",
  "$resourcePrefix-profile-readiness-dead-letter",
  "$resourcePrefix-profile-readiness-durable-failed",
  "$resourcePrefix-profile-readiness-durable-timed-out"
)
$durableFailedAlarm = "$resourcePrefix-profile-readiness-durable-failed"
$deadLetterAlarm = "$resourcePrefix-profile-readiness-dead-letter"
$priorProfile = $env:AWS_PROFILE
$priorRegion = $env:AWS_REGION
$priorDefaultRegion = $env:AWS_DEFAULT_REGION
$priorData = $env:TF_DATA_DIR
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Failure)
  $raw = & aws @Arguments --no-cli-pager --output json 2>&1
  if ($LASTEXITCODE -ne 0) {
    $rawText = $raw -join [Environment]::NewLine
    $failureClass = if ($rawText -match "An error occurred \(([A-Za-z0-9.]+)\)") {
      $Matches[1]
    } elseif ($rawText -match "token.*expired|expired.*token") {
      "IdentitySessionExpired"
    } elseif ($rawText -match "Unable to locate credentials") {
      "CredentialsUnavailable"
    } elseif ($rawText -match "Error parsing parameter|Invalid base64") {
      "CliPayloadRejected"
    } elseif ($rawText -match "Unknown options|usage: aws") {
      "CliArgumentsRejected"
    } elseif ($rawText -match "Could not connect|Connection.*timed out") {
      "NetworkUnavailable"
    } else {
      "AwsCliFailure"
    }
    throw "$Failure ErrorClass=$failureClass."
  }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json } catch { throw $Failure }
}

function Get-Only {
  param([object[]]$Items, [string]$Failure)
  if ($Items.Count -ne 1) { throw $Failure }
  return $Items[0]
}

function Get-OptionalPropertyValue {
  param([object]$Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $property = @($Object.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if ($property.Count -ne 1) { return $null }
  return $property[0].Value
}

function Get-DlqQueueUrl {
  $queue = Invoke-AwsJson @(
    "sqs", "get-queue-url", "--queue-name",
    "$resourcePrefix-profile-readiness-dead-letter"
  ) "The durable DLQ is unavailable."
  return [string]$queue.QueueUrl
}

function Get-DlqDepth {
  param([string]$QueueUrl = "")
  if (-not $QueueUrl) { $QueueUrl = Get-DlqQueueUrl }
  $value = Invoke-AwsJson @(
    "sqs", "get-queue-attributes", "--queue-url", $QueueUrl,
    "--attribute-names", "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"
  ) "The durable DLQ depth is unavailable."
  return [ordered]@{
    Visible = [int]$value.Attributes.ApproximateNumberOfMessages
    InFlight = [int]$value.Attributes.ApproximateNumberOfMessagesNotVisible
    Delayed = [int]$value.Attributes.ApproximateNumberOfMessagesDelayed
  }
}

function Wait-DlqEmpty {
  param([string]$QueueUrl, [int]$Attempts = 18)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    $depth = Get-DlqDepth $QueueUrl
    if ($depth.Visible + $depth.InFlight + $depth.Delayed -eq 0) { return }
    Start-Sleep -Seconds 5
  }
  throw "The durable DLQ did not return to empty within the bounded window."
}

function Get-LiveBoundary {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") `
    "Refresh the $Environment IAM Identity Center session."
  if (
    [string]$caller.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$caller.Arn).Contains(":assumed-role/")
  ) { throw "Use the temporary $Environment IAM Identity Center caller." }

  $functionBoundary = [ordered]@{}
  foreach ($logicalName in $functions.Keys) {
    $name = $functions[$logicalName]
    $alias = Invoke-AwsJson @(
      "lambda", "get-alias", "--function-name", $name, "--name", $Environment
    ) "A workflow Lambda alias is unavailable."
    $routingProperty = @($alias.PSObject.Properties | Where-Object { $_.Name -eq "RoutingConfig" })
    $weights = 0
    if ($routingProperty.Count -eq 1 -and $null -ne $routingProperty[0].Value) {
      $weightProperty = @(
        $routingProperty[0].Value.PSObject.Properties |
          Where-Object { $_.Name -eq "AdditionalVersionWeights" }
      )
      if ($weightProperty.Count -eq 1 -and $null -ne $weightProperty[0].Value) {
        $weights = @($weightProperty[0].Value.PSObject.Properties).Count
      }
    }
    $configuration = Invoke-AwsJson @(
      "lambda", "get-function-configuration", "--function-name", $name,
      "--qualifier", ([string]$alias.FunctionVersion)
    ) "A workflow Lambda version is unavailable."
    $reserved = Invoke-AwsJson @(
      "lambda", "get-function-concurrency", "--function-name", $name
    ) "A workflow Lambda concurrency boundary is unavailable."
    if (
      [string]$configuration.State -ne "Active" -or
      [string]$configuration.LastUpdateStatus -ne "Successful" -or
      [string]$configuration.Version -notmatch "^[1-9][0-9]*$" -or
      [string]$configuration.Version -ne [string]$alias.FunctionVersion -or
      [string]$configuration.Runtime -ne "nodejs24.x" -or $weights -ne 0 -or
      [int]$reserved.ReservedConcurrentExecutions -ne [int]$concurrency[$logicalName] -or
      [string]$configuration.CodeSha256 -notmatch "^[A-Za-z0-9+/]{43}=$" -or
      [string]$configuration.Environment.Variables.RELEASE_SHA -notmatch "^[a-f0-9]{64}$" -or
      [string]::IsNullOrWhiteSpace([string]$configuration.KMSKeyArn)
    ) { throw "A workflow Lambda is outside the immutable dark boundary." }
    $account = ([string]$configuration.FunctionArn -split ":")[4]
    if ($account -ne [string]$caller.Account) { throw "The caller and function accounts differ." }
    $functionBoundary[$logicalName] = [ordered]@{
      Name = $name
      Version = [string]$configuration.Version
      AliasRevisionId = [string]$alias.RevisionId
      CodeSha256 = [string]$configuration.CodeSha256
      ReleaseSha = [string]$configuration.Environment.Variables.RELEASE_SHA
      ReservedConcurrency = [int]$reserved.ReservedConcurrentExecutions
    }
  }

  $allMappings = Invoke-AwsJson @("lambda", "list-event-source-mappings") `
    "The event-source mapping inventory is unavailable."
  $mapping = Get-Only @(
    $allMappings.EventSourceMappings | Where-Object {
      ([string]$_.FunctionArn).EndsWith(
        ":function:$($functions.Starter):$Environment",
        [StringComparison]::Ordinal
      )
    }
  ) "The exact starter mapping is not singular."
  if (
    [string]$mapping.State -ne "Disabled" -or
    @($mapping.FunctionResponseTypes) -notcontains "ReportBatchItemFailures"
  ) { throw "The starter mapping is enabled or lacks partial-batch handling." }

  $ruleBoundary = @(
    foreach ($name in $rules) {
      $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $name) `
        "A workflow EventBridge rule is unavailable."
      if ([string]$rule.State -ne "DISABLED") { throw "A workflow rule is enabled." }
      [ordered]@{ Name = $name; State = [string]$rule.State }
    }
  )
  $alarmResult = Invoke-AwsJson (@("cloudwatch", "describe-alarms", "--alarm-names") + $alarms) `
    "The workflow alarm inventory is unavailable."
  $alarmBoundary = @(
    $alarmResult.MetricAlarms | Sort-Object AlarmName | ForEach-Object {
      if (
        [string]$_.StateValue -ne "OK" -or -not [bool]$_.ActionsEnabled -or
        @($_.AlarmActions).Count -ne 1 -or @($_.OKActions).Count -ne 1
      ) { throw "A workflow alarm is not enabled and OK." }
      [ordered]@{ Name = [string]$_.AlarmName; AlarmActions = 1; OkActions = 1 }
    }
  )
  if ($alarmBoundary.Count -ne 7) { throw "The exact seven workflow alarms are absent." }

  $depth = Get-DlqDepth
  if ($depth.Visible + $depth.InFlight + $depth.Delayed -ne 0) {
    throw "The durable DLQ must be empty before conformance."
  }
  $stack = Invoke-AwsJson @(
    "cloudformation", "describe-stacks", "--stack-name",
    "$resourcePrefix-profile-readiness-durable"
  ) "The durable stack is unavailable."
  $stackStatus = [string]$stack.Stacks[0].StackStatus
  if ($stackStatus -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) {
    throw "The durable stack is not complete."
  }

  $apis = Invoke-AwsJson @("apigatewayv2", "get-apis") "The API inventory is unavailable."
  $api = Get-Only @(
    $apis.Items | Where-Object { [string]$_.Name -eq "$resourcePrefix-gateway" }
  ) "The $Environment API is not singular."
  $integrationResult = Invoke-AwsJson @(
    "apigatewayv2", "get-integrations", "--api-id", ([string]$api.ApiId)
  ) "The API integration is unavailable."
  $integration = Get-Only @($integrationResult.Items) "The API integration is not singular."
  if (
    [string]$integration.IntegrationType -ne "HTTP_PROXY" -or
    [string]$integration.IntegrationUri -notmatch "^arn:aws:servicediscovery:"
  ) { throw "Public API traffic is no longer on Cloud Map/ECS." }

  $serviceResult = Invoke-AwsJson @(
    "ecs", "describe-services", "--cluster", $resourcePrefix, "--services",
    "gateway", "workflow-worker"
  ) "The ECS rollback services are unavailable."
  $postures = @($serviceResult.services | ForEach-Object {
    "$([int]$_.desiredCount)/$([int]$_.runningCount)/$([int]$_.pendingCount)"
  })
  $uniformCapacity = (
    @($postures | Where-Object { $_ -eq "1/1/0" }).Count -eq 2 -or
    @($postures | Where-Object { $_ -eq "0/0/0" }).Count -eq 2
  )
  if (-not $uniformCapacity) {
    throw "The retained ECS rollback services are not uniformly continuous or idle."
  }
  $services = @(
    $serviceResult.services | Sort-Object serviceName | ForEach-Object {
      if (
        [string]$_.status -ne "ACTIVE" -or
        [string]$_.deployments[0].rolloutState -ne "COMPLETED"
      ) { throw "An ECS rollback service is unstable." }
      [ordered]@{
        Name = [string]$_.serviceName
        Desired = [int]$_.desiredCount
        Running = [int]$_.runningCount
      }
    }
  )
  if ($services.Count -ne 2) { throw "Both ECS rollback services are required." }

  $gateway = Invoke-AwsJson @(
    "lambda", "get-function-configuration", "--function-name",
    "$resourcePrefix-gateway", "--qualifier", $Environment
  ) "The gateway dispatch boundary is unavailable."
  if ([string]$gateway.Environment.Variables.OUTBOX_DISPATCH_TARGET -ne "temporal") {
    throw "Gateway dispatch is no longer Temporal."
  }

  return [ordered]@{
    AccountId = [string]$caller.Account
    Functions = $functionBoundary
    Mapping = [ordered]@{ Uuid = [string]$mapping.UUID; State = "Disabled" }
    Rules = $ruleBoundary
    Alarms = $alarmBoundary
    Dlq = $depth
    DurableStack = $stackStatus
    Api = [ordered]@{
      Id = [string]$api.ApiId
      IntegrationId = [string]$integration.IntegrationId
      Type = "HTTP_PROXY"
      Uri = [string]$integration.IntegrationUri
    }
    EcsServices = $services
    DispatchTarget = "temporal"
  }
}

function Get-ZeroDriftPlan {
  param([string]$Commit)
  if ((& terraform version -json | ConvertFrom-Json).terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
  $path = Join-Path $contextDirectory "workflow-dark-verify-$($Commit.Substring(0, 8)).tfplan"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Run completed-dark verification from this exact commit first."
  }
  $env:TF_DATA_DIR = $terraformDataDirectory
  $plan = & terraform "-chdir=$environmentDirectory" show -json $path 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "The completed-dark plan cannot be inspected." }
  $changes = @($plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("no-op", "read")
    })
  if ($changes.Count -ne 0) { throw "The completed-dark plan is not zero-change." }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Save-Context {
  param([System.Collections.IDictionary]$Context)
  $null = New-Item -ItemType Directory -Path $contextDirectory -Force
  [IO.File]::WriteAllText($contextPath, ($Context | ConvertTo-Json -Depth 20), $utf8)
  return (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Context {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) { throw "No reviewed context exists." }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") { throw "A reviewed checksum is required." }
  $hash = (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $ExpectedPlanSha256.ToLowerInvariant()) { throw "The context checksum differs." }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  $durablePayload = $context.Payloads.Durable | ConvertFrom-Json
  if (
    [string]$context.Schema -ne "applydash.$Environment.workflow-dark-conformance.v2" -or
    [string]$context.Environment -ne $Environment -or [string]$context.Region -ne "us-east-2" -or
    [int]$context.InvocationCount -ne 4 -or $context.ProductDataWrite -isnot [bool] -or
    [bool]$context.ProductDataWrite -or $context.ReconcilerInvoked -isnot [bool] -or
    [bool]$context.ReconcilerInvoked -or $context.TriggersEnabled -isnot [bool] -or
    [bool]$context.TriggersEnabled -or $context.PublicTrafficChange -isnot [bool] -or
    [bool]$context.PublicTrafficChange -or [string]$context.DurableInvocationType -ne "Event" -or
    [string]$context.ExpectedDurableStatus -ne "FAILED" -or
    [int]$context.ExpectedDlqMessages -ne 1 -or [int]$context.ExpectedDlqDeletes -ne 1 -or
    [int]$context.ExpectedAlarmTransitions -ne 4 -or
    $context.AwsMutationOnExecute -isnot [bool] -or -not [bool]$context.AwsMutationOnExecute -or
    [string]$context.DurableExecutionName -notmatch "^dark-conformance-[a-f0-9]{32}$" -or
    [int]$durablePayload.schemaVersion -ne 2 -or
    [string]$durablePayload.conformanceExecutionName -cne [string]$context.DurableExecutionName
  ) { throw "The reviewed context safety boundary is invalid." }
  return $context
}

function Get-ReviewableSourceCommit {
  $commit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
  $status = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
  if (
    $commit -notmatch "^[a-f0-9]{40}$" -or $branch -ne "main" -or
    $upstream -notmatch "^[a-f0-9]{40}$" -or $upstream -ne $commit -or
    $status.Count -ne 0
  ) { throw "Review requires clean main at its exact configured upstream commit." }
  return $commit
}

function Assert-ExactSource {
  param([object]$Context)
  $commit = Get-ReviewableSourceCommit
  $operatorHash = (Get-FileHash -LiteralPath $operatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    $commit -ne [string]$Context.SourceCommit -or
    $operatorHash -ne [string]$Context.OperatorSha256
  ) { throw "Execution requires the exact clean merged source used for review." }
}

function Assert-SameBoundary {
  param([object]$Expected, [System.Collections.IDictionary]$Actual)
  if (
    ($Expected | ConvertTo-Json -Depth 20 -Compress) -cne
    ($Actual | ConvertTo-Json -Depth 20 -Compress)
  ) { throw "The live boundary changed after review." }
}

function Invoke-Sync {
  param(
    [string]$Label,
    [string]$Name,
    [string]$Version,
    [string]$Payload
  )
  $responsePath = [IO.Path]::GetTempFileName()
  try {
    $encodedPayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Payload))
    $arguments = @(
      "lambda", "invoke", "--function-name", $Name, "--qualifier", $Version
    )
    $arguments += @("--invocation-type", "RequestResponse", "--payload", $encodedPayload)
    $arguments += $responsePath
    $metadata = Invoke-AwsJson $arguments "The reviewed $Label invocation was not accepted."
    $body = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
    return [ordered]@{ Metadata = $metadata; Body = $body }
  } finally { Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue }
}

function Invoke-AsyncDurable {
  param(
    [string]$Name,
    [string]$Version,
    [string]$Payload,
    [string]$ExecutionName
  )
  $responsePath = [IO.Path]::GetTempFileName()
  try {
    $encodedPayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Payload))
    $arguments = @(
      "lambda", "invoke", "--function-name", "${Name}:$Version",
      "--invocation-type", "Event", "--durable-execution-name", $ExecutionName,
      "--payload", $encodedPayload, $responsePath
    )
    return Invoke-AwsJson $arguments "The reviewed durable invocation was not accepted."
  } finally { Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue }
}

function Wait-DurableTerminal {
  param([string]$DurableExecutionArn)
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $execution = Invoke-AwsJson @(
      "lambda", "get-durable-execution", "--durable-execution-arn", $DurableExecutionArn
    ) "The durable execution status is unavailable."
    $status = [string](Get-OptionalPropertyValue $execution "Status")
    if ($status -in @("SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED")) { return $execution }
    if ($status -ne "RUNNING") { throw "The durable execution returned an unknown status." }
    Start-Sleep -Seconds 1
  }
  throw "The durable execution did not reach a terminal state within the reviewed bound."
}

function Get-ReviewedDurableExecution {
  param([object]$Context)
  $response = Invoke-AwsJson @(
    "lambda", "list-durable-executions-by-function", "--function-name", $functions.Durable,
    "--qualifier", ([string]$Context.Boundary.Functions.Durable.Version),
    "--durable-execution-name", ([string]$Context.DurableExecutionName),
    "--max-items", "2", "--no-paginate"
  ) "The reviewed durable execution inventory is unavailable."
  $matches = @(
    @(Get-OptionalPropertyValue $response "DurableExecutions") | Where-Object {
      [string](Get-OptionalPropertyValue $_ "DurableExecutionName") -eq
        [string]$Context.DurableExecutionName
    }
  )
  if ($matches.Count -gt 1) { throw "The reviewed durable execution is not singular." }
  if ($matches.Count -eq 0) { return $null }
  $execution = Invoke-AwsJson @(
    "lambda", "get-durable-execution", "--durable-execution-arn",
    ([string]$matches[0].DurableExecutionArn)
  ) "The reviewed durable execution status is unavailable."
  if (
    [string](Get-OptionalPropertyValue $execution "DurableExecutionName") -cne
      [string]$Context.DurableExecutionName -or
    [string](Get-OptionalPropertyValue $execution "Version") -cne
      [string]$Context.Boundary.Functions.Durable.Version -or
    [string](Get-OptionalPropertyValue $execution "InputPayload") -cne
      [string]$Context.Payloads.Durable
  ) { throw "The durable execution does not match the reviewed cleanup boundary." }
  return $execution
}

function Wait-AlarmState {
  param([string]$AlarmName, [string]$ExpectedState, [int]$Attempts = 36)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    $response = Invoke-AwsJson @(
      "cloudwatch", "describe-alarms", "--alarm-names", $AlarmName
    ) "A reviewed workflow alarm is unavailable."
    $alarm = @(Get-OptionalPropertyValue $response "MetricAlarms")
    if ($alarm.Count -ne 1) { throw "A reviewed workflow alarm is not singular." }
    if ([string]$alarm[0].StateValue -eq $ExpectedState) { return }
    Start-Sleep -Seconds 10
  }
  throw "A reviewed workflow alarm did not reach $ExpectedState within the bounded window."
}

function Remove-ReviewedDlqMessage {
  param([string]$ExpectedBody, [switch]$AllowAbsent)
  $queueUrl = Get-DlqQueueUrl
  for ($attempt = 0; $attempt -lt 18; $attempt++) {
    $response = Invoke-AwsJson @(
      "sqs", "receive-message", "--queue-url", $queueUrl,
      "--max-number-of-messages", "2", "--wait-time-seconds", "5",
      "--visibility-timeout", "30", "--attribute-names", "All",
      "--message-attribute-names", "All"
    ) "The reviewed durable DLQ message is unavailable."
    $messages = @(
      @(Get-OptionalPropertyValue $response "Messages") | Where-Object { $null -ne $_ }
    )
    if ($messages.Count -eq 0) { continue }
    if ($messages.Count -ne 1) { throw "The durable DLQ contains more than the reviewed message." }
    if ([string]$messages[0].Body -cne $ExpectedBody) {
      throw "The durable DLQ message does not match the reviewed synthetic payload."
    }
    $null = Invoke-AwsJson @(
      "sqs", "delete-message", "--queue-url", $queueUrl,
      "--receipt-handle", ([string]$messages[0].ReceiptHandle)
    ) "The reviewed durable DLQ message could not be removed."
    Wait-DlqEmpty $queueUrl
    return $true
  }
  if ($AllowAbsent) { return $false }
  throw "The reviewed durable failure did not reach the DLQ within the bounded window."
}

function Invoke-Conformance {
  param([object]$Context)
  $activity = Invoke-Sync "activity" $functions.Activity `
    $Context.Boundary.Functions.Activity.Version $Context.Payloads.Activity
  $activityFunctionError = Get-OptionalPropertyValue $activity.Metadata "FunctionError"
  $activityErrorCode = Get-OptionalPropertyValue $activity.Body "errorCode"
  if (
    [int](Get-OptionalPropertyValue $activity.Metadata "StatusCode") -ne 200 -or
    $activityFunctionError -or [string]$activityErrorCode -ne "ActivityInputRejected"
  ) { throw "Activity rejection failed." }

  $starter = Invoke-Sync "starter" $functions.Starter `
    $Context.Boundary.Functions.Starter.Version $Context.Payloads.Starter
  $starterFunctionError = Get-OptionalPropertyValue $starter.Metadata "FunctionError"
  $starterFailures = Get-OptionalPropertyValue $starter.Body "batchItemFailures"
  $starterFailureItems = @($starterFailures | Where-Object { $null -ne $_ })
  if (
    [int](Get-OptionalPropertyValue $starter.Metadata "StatusCode") -ne 200 -or
    $starterFunctionError -or $starterFailureItems.Count -ne 1 -or
    [string](Get-OptionalPropertyValue $starterFailureItems[0] "itemIdentifier") -ne
      [string]$Context.StarterMessageId
  ) { throw "Starter partial-batch rejection failed." }

  $terminal = Invoke-Sync "terminal" $functions.Terminal `
    $Context.Boundary.Functions.Terminal.Version $Context.Payloads.Terminal
  $terminalFunctionError = Get-OptionalPropertyValue $terminal.Metadata "FunctionError"
  if (
    [int](Get-OptionalPropertyValue $terminal.Metadata "StatusCode") -ne 200 -or
    -not $terminalFunctionError -or
    [string](Get-OptionalPropertyValue $terminal.Body "errorMessage") -ne
      "DurableTerminalEventRejected"
  ) { throw "Terminal rejection failed." }

  $durable = Invoke-AsyncDurable $functions.Durable `
    $Context.Boundary.Functions.Durable.Version $Context.Payloads.Durable `
    $Context.DurableExecutionName
  $durableExecutionArn = Get-OptionalPropertyValue $durable "DurableExecutionArn"
  if (
    [int](Get-OptionalPropertyValue $durable "StatusCode") -ne 202 -or
    -not $durableExecutionArn
  ) { throw "Durable asynchronous start failed." }
  $execution = Wait-DurableTerminal ([string]$durableExecutionArn)
  $executionError = Get-OptionalPropertyValue $execution "Error"
  if (
    [string](Get-OptionalPropertyValue $execution "Status") -ne "FAILED" -or
    [string](Get-OptionalPropertyValue $execution "Version") -ne
      [string]$Context.Boundary.Functions.Durable.Version -or
    [string](Get-OptionalPropertyValue $execution "DurableExecutionName") -ne
      [string]$Context.DurableExecutionName -or
    [string](Get-OptionalPropertyValue $execution "InputPayload") -cne
      [string]$Context.Payloads.Durable -or
    [string](Get-OptionalPropertyValue $executionError "ErrorMessage") -notmatch
      "WorkflowInputRejected"
  ) { throw "The durable rejection did not reach FAILED on the exact version." }
  Wait-AlarmState $durableFailedAlarm "ALARM"
  Wait-AlarmState $deadLetterAlarm "ALARM"
  if (-not (Remove-ReviewedDlqMessage ([string]$Context.Payloads.Durable))) {
    throw "The reviewed durable DLQ cleanup did not run."
  }
  Wait-AlarmState $durableFailedAlarm "OK"
  Wait-AlarmState $deadLetterAlarm "OK"
}

try {
  foreach ($command in @("aws", "git", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }
  switch ($Action) {
    "Plan" {
      if ($Execute) { throw "Plan does not accept -Execute." }
      if (Test-Path -LiteralPath $contextPath) { throw "A reviewed context already exists." }
      $commit = Get-ReviewableSourceCommit
      $zeroDriftHash = Get-ZeroDriftPlan $commit
      $boundary = Get-LiveBoundary
      $messageId = "dark-conformance-$([Guid]::NewGuid().ToString('N'))"
      $executionName = "dark-conformance-$([Guid]::NewGuid().ToString('N'))"
      $durablePayload = (@{
          schemaVersion = 2
          conformanceExecutionName = $executionName
        } | ConvertTo-Json -Compress)
      $context = [ordered]@{
        Schema = "applydash.$Environment.workflow-dark-conformance.v2"
        Environment = $Environment
        Region = $Region
        CreatedAt = [DateTime]::UtcNow.ToString("o")
        SourceCommit = $commit
        OperatorSha256 = (Get-FileHash $operatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        ZeroDriftPlanSha256 = $zeroDriftHash
        Boundary = $boundary
        StarterMessageId = $messageId
        DurableExecutionName = $executionName
        Payloads = [ordered]@{
          Activity = '{"schemaVersion":2}'
          Starter = (@{ Records = @(@{ messageId = $messageId; body = "not-json" }) } |
            ConvertTo-Json -Depth 4 -Compress)
          Terminal = '{"source":"applydash.dark-conformance"}'
          Durable = $durablePayload
        }
        InvocationCount = 4
        DurableInvocationType = "Event"
        ExpectedDurableStatus = "FAILED"
        ExpectedDlqMessages = 1
        ExpectedDlqDeletes = 1
        ExpectedAlarmTransitions = 4
        AwsMutationOnExecute = $true
        ReconcilerInvoked = $false
        ProductDataWrite = $false
        TriggersEnabled = $false
        PublicTrafficChange = $false
      }
      $hash = Save-Context $context
      [ordered]@{
        Environment = $Environment
        Action = "review"
        SourceCommit = $commit
        CommittedSource = @(& git -C $repositoryRoot status --porcelain --untracked-files=all).Count -eq 0
        PlanSha256 = $hash
        ZeroDriftPlanSha256 = $zeroDriftHash
        InvocationCountOnExecute = 4
        DurableInvocationType = "Event"
        ExpectedDlqMessages = 1
        ExpectedDlqDeletes = 1
        ExpectedAlarmTransitions = 4
        AwsMutationOnExecute = $true
        ReconcilerInvoked = $false
        ProductDataWrite = $false
        TriggersEnabled = $false
        PublicTrafficChange = $false
        ContextPath = $contextPath
      } | ConvertTo-Json
    }
    "Execute" {
      if (-not $Execute) { throw "Execution requires -Execute." }
      $context = Get-Context
      Assert-ExactSource $context
      if ((Get-ZeroDriftPlan $context.SourceCommit) -ne [string]$context.ZeroDriftPlanSha256) {
        throw "The zero-drift plan changed after review."
      }
      Assert-SameBoundary $context.Boundary (Get-LiveBoundary)
      Invoke-Conformance $context
      $depth = Get-DlqDepth
      if ($depth.Visible + $depth.InFlight + $depth.Delayed -ne 0) {
        throw "Conformance did not restore the durable DLQ to empty."
      }
      Assert-SameBoundary $context.Boundary (Get-LiveBoundary)
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = $Environment
        Result = "passed"
        Invocations = 4
        DurableExactVersionFailedClosed = $true
        DeadLetterMessages = 0
        ReviewedDeadLetterMessagesDeleted = 1
        AlarmTransitions = 4
        ReconcilerInvoked = $false
        ProductDataWrite = $false
        TriggersEnabled = $false
        PublicTrafficChange = $false
        ContextRemoved = $true
      } | ConvertTo-Json
    }
    "Cleanup" {
      if (-not $Execute) { throw "Cleanup requires -Execute." }
      $context = Get-Context
      $awsMutation = $false
      $reviewedExecution = Get-ReviewedDurableExecution $context
      if ($null -ne $reviewedExecution) {
        $status = [string](Get-OptionalPropertyValue $reviewedExecution "Status")
        if ($status -eq "RUNNING") {
          $null = Invoke-AwsJson @(
            "lambda", "stop-durable-execution", "--durable-execution-arn",
            ([string]$reviewedExecution.DurableExecutionArn)
          ) "The reviewed durable execution could not be stopped."
          $reviewedExecution = Wait-DurableTerminal `
            ([string]$reviewedExecution.DurableExecutionArn)
          $status = [string](Get-OptionalPropertyValue $reviewedExecution "Status")
          $awsMutation = $true
        }
        if ($status -eq "SUCCEEDED") {
          throw "The reviewed invalid durable execution unexpectedly succeeded."
        }
        if ($status -notin @("FAILED", "TIMED_OUT", "STOPPED")) {
          throw "The reviewed durable execution has an unknown cleanup state."
        }
        if (Remove-ReviewedDlqMessage ([string]$context.Payloads.Durable) -AllowAbsent) {
          $awsMutation = $true
        }
        Wait-AlarmState $durableFailedAlarm "OK"
        Wait-AlarmState $deadLetterAlarm "OK"
      }
      Assert-SameBoundary $context.Boundary (Get-LiveBoundary)
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{ Environment = $Environment; Action = "cleanup"; AwsMutation = $awsMutation } |
        ConvertTo-Json
    }
  }
}
finally {
  if ($null -eq $priorProfile) { Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue } else { $env:AWS_PROFILE = $priorProfile }
  if ($null -eq $priorRegion) { Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue } else { $env:AWS_REGION = $priorRegion }
  if ($null -eq $priorDefaultRegion) { Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue } else { $env:AWS_DEFAULT_REGION = $priorDefaultRegion }
  if ($null -eq $priorData) { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue } else { $env:TF_DATA_DIR = $priorData }
}
