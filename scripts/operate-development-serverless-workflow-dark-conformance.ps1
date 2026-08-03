[CmdletBinding()]
param(
  [ValidateSet("Plan", "Execute", "Cleanup")][string]$Action = "Plan",
  [string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-serverless-workflow-dark-conformance.ps1 -Action Plan
  .\scripts\operate-development-serverless-workflow-dark-conformance.ps1 `
    -Action Execute -ExpectedPlanSha256 REVIEWED_SHA256 -Execute
  .\scripts\operate-development-serverless-workflow-dark-conformance.ps1 `
    -Action Cleanup -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Plan performs AWS reads and writes one ignored checksum-reviewed context. Execute requires that
exact checksum and clean merged source. It synchronously exercises four synthetic fail-closed
paths without invoking the reconciler, enabling a trigger, sending SQS, writing product data, or
changing public traffic. Cleanup removes only the exact reviewed local context.
"@
  exit 0
}
if ($Region -ne "us-east-2") { throw "Dark conformance is restricted to us-east-2." }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform\dark-plan-data"
$contextDirectory = Join-Path $environmentDirectory ".terraform\workflow-dark-plans"
$contextPath = Join-Path $contextDirectory "workflow-dark-conformance-context.json"
$operatorPath = $MyInvocation.MyCommand.Path
$utf8 = New-Object Text.UTF8Encoding($false)
$functions = [ordered]@{
  Starter = "ai-job-apply-development-outbox-starter"
  Reconciler = "ai-job-apply-development-outbox-reconciler"
  Activity = "ai-job-apply-development-profile-readiness-activity"
  Terminal = "ai-job-apply-development-profile-readiness-terminal"
  Durable = "ai-job-apply-development-profile-readiness-durable"
}
$concurrency = [ordered]@{ Starter = 1; Reconciler = 1; Activity = 1; Terminal = 1; Durable = 2 }
$rules = @(
  "ai-job-apply-development-outbox-reconciler",
  "ai-job-apply-development-profile-readiness-terminal"
)
$alarms = @(
  "ai-job-apply-development-outbox-reconciler-errors",
  "ai-job-apply-development-outbox-starter-errors",
  "ai-job-apply-development-outbox-starter-throttles",
  "ai-job-apply-development-profile-readiness-activity-errors",
  "ai-job-apply-development-profile-readiness-dead-letter",
  "ai-job-apply-development-profile-readiness-durable-failed",
  "ai-job-apply-development-profile-readiness-durable-timed-out"
)
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
  if ($LASTEXITCODE -ne 0) { throw $Failure }
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

function Get-DlqDepth {
  $queue = Invoke-AwsJson @(
    "sqs", "get-queue-url", "--queue-name",
    "ai-job-apply-development-profile-readiness-dead-letter"
  ) "The durable DLQ is unavailable."
  $value = Invoke-AwsJson @(
    "sqs", "get-queue-attributes", "--queue-url", ([string]$queue.QueueUrl),
    "--attribute-names", "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"
  ) "The durable DLQ depth is unavailable."
  return [ordered]@{
    Visible = [int]$value.Attributes.ApproximateNumberOfMessages
    InFlight = [int]$value.Attributes.ApproximateNumberOfMessagesNotVisible
    Delayed = [int]$value.Attributes.ApproximateNumberOfMessagesDelayed
  }
}

function Get-LiveBoundary {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") `
    "Refresh the development IAM Identity Center session."
  if (
    [string]$caller.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$caller.Arn).Contains(":assumed-role/")
  ) { throw "Use the temporary development IAM Identity Center caller." }

  $functionBoundary = [ordered]@{}
  foreach ($logicalName in $functions.Keys) {
    $name = $functions[$logicalName]
    $alias = Invoke-AwsJson @(
      "lambda", "get-alias", "--function-name", $name, "--name", "development"
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
      [string]$_.FunctionArn -match ":function:ai-job-apply-development-outbox-starter:development$"
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
    "ai-job-apply-development-profile-readiness-durable"
  ) "The durable stack is unavailable."
  $stackStatus = [string]$stack.Stacks[0].StackStatus
  if ($stackStatus -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) {
    throw "The durable stack is not complete."
  }

  $apis = Invoke-AwsJson @("apigatewayv2", "get-apis") "The API inventory is unavailable."
  $api = Get-Only @(
    $apis.Items | Where-Object { [string]$_.Name -eq "ai-job-apply-development-gateway" }
  ) "The development API is not singular."
  $integrationResult = Invoke-AwsJson @(
    "apigatewayv2", "get-integrations", "--api-id", ([string]$api.ApiId)
  ) "The API integration is unavailable."
  $integration = Get-Only @($integrationResult.Items) "The API integration is not singular."
  if (
    [string]$integration.IntegrationType -ne "HTTP_PROXY" -or
    [string]$integration.IntegrationUri -notmatch "^arn:aws:servicediscovery:"
  ) { throw "Public API traffic is no longer on Cloud Map/ECS." }

  $serviceResult = Invoke-AwsJson @(
    "ecs", "describe-services", "--cluster", "ai-job-apply-development", "--services",
    "gateway", "workflow-worker"
  ) "The ECS rollback services are unavailable."
  $services = @(
    $serviceResult.services | Sort-Object serviceName | ForEach-Object {
      if (
        [string]$_.status -ne "ACTIVE" -or [int]$_.desiredCount -ne 1 -or
        [int]$_.runningCount -ne 1 -or [int]$_.pendingCount -ne 0 -or
        [string]$_.deployments[0].rolloutState -ne "COMPLETED"
      ) { throw "An ECS rollback service is unstable." }
      [ordered]@{ Name = [string]$_.serviceName; Desired = 1; Running = 1 }
    }
  )
  if ($services.Count -ne 2) { throw "Both ECS rollback services are required." }

  $gateway = Invoke-AwsJson @(
    "lambda", "get-function-configuration", "--function-name",
    "ai-job-apply-development-gateway", "--qualifier", "development"
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
  if (
    [string]$context.Schema -ne "applydash.development.workflow-dark-conformance.v1" -or
    [int]$context.InvocationCount -ne 4 -or [bool]$context.ProductDataWrite -or
    [bool]$context.TriggersEnabled -or [bool]$context.PublicTrafficChange
  ) { throw "The reviewed context safety boundary is invalid." }
  return $context
}

function Assert-ExactSource {
  param([object]$Context)
  $status = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
  $operatorHash = (Get-FileHash -LiteralPath $operatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    (& git -C $repositoryRoot rev-parse HEAD).Trim() -ne [string]$Context.SourceCommit -or
    (& git -C $repositoryRoot branch --show-current).Trim() -ne "main" -or
    $status.Count -ne 0 -or $operatorHash -ne [string]$Context.OperatorSha256
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
  param([string]$Name, [string]$Version, [string]$Payload, [string]$ExecutionName = "")
  $responsePath = [IO.Path]::GetTempFileName()
  try {
    $arguments = @(
      "lambda", "invoke", "--function-name", $Name, "--qualifier", $Version,
      "--invocation-type", "RequestResponse", "--cli-binary-format", "raw-in-base64-out",
      "--payload", $Payload
    )
    if ($ExecutionName) { $arguments += @("--durable-execution-name", $ExecutionName) }
    $arguments += $responsePath
    $metadata = Invoke-AwsJson $arguments "A reviewed invocation was not accepted."
    $body = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
    return [ordered]@{ Metadata = $metadata; Body = $body }
  } finally { Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue }
}

function Invoke-Conformance {
  param([object]$Context)
  $activity = Invoke-Sync $functions.Activity $Context.Boundary.Functions.Activity.Version `
    $Context.Payloads.Activity
  $activityFunctionError = Get-OptionalPropertyValue $activity.Metadata "FunctionError"
  $activityErrorCode = Get-OptionalPropertyValue $activity.Body "errorCode"
  if (
    [int](Get-OptionalPropertyValue $activity.Metadata "StatusCode") -ne 200 -or
    $activityFunctionError -or [string]$activityErrorCode -ne "ActivityInputRejected"
  ) { throw "Activity rejection failed." }

  $starter = Invoke-Sync $functions.Starter $Context.Boundary.Functions.Starter.Version `
    $Context.Payloads.Starter
  $starterFunctionError = Get-OptionalPropertyValue $starter.Metadata "FunctionError"
  $starterFailures = Get-OptionalPropertyValue $starter.Body "batchItemFailures"
  $starterFailureItems = @($starterFailures | Where-Object { $null -ne $_ })
  if (
    [int](Get-OptionalPropertyValue $starter.Metadata "StatusCode") -ne 200 -or
    $starterFunctionError -or $starterFailureItems.Count -ne 1 -or
    [string](Get-OptionalPropertyValue $starterFailureItems[0] "itemIdentifier") -ne
      [string]$Context.StarterMessageId
  ) { throw "Starter partial-batch rejection failed." }

  $terminal = Invoke-Sync $functions.Terminal $Context.Boundary.Functions.Terminal.Version `
    $Context.Payloads.Terminal
  $terminalFunctionError = Get-OptionalPropertyValue $terminal.Metadata "FunctionError"
  if (
    [int](Get-OptionalPropertyValue $terminal.Metadata "StatusCode") -ne 200 -or
    -not $terminalFunctionError -or
    [string](Get-OptionalPropertyValue $terminal.Body "errorMessage") -ne
      "DurableTerminalEventRejected"
  ) { throw "Terminal rejection failed." }

  $durable = Invoke-Sync $functions.Durable $Context.Boundary.Functions.Durable.Version `
    $Context.Payloads.Durable $Context.DurableExecutionName
  $durableFunctionError = Get-OptionalPropertyValue $durable.Metadata "FunctionError"
  $durableExecutionArn = Get-OptionalPropertyValue $durable.Metadata "DurableExecutionArn"
  if (
    [int](Get-OptionalPropertyValue $durable.Metadata "StatusCode") -ne 200 -or
    -not $durableFunctionError -or
    [string](Get-OptionalPropertyValue $durable.Metadata "ExecutedVersion") -ne
      [string]$Context.Boundary.Functions.Durable.Version -or
    -not $durableExecutionArn -or
    [string](Get-OptionalPropertyValue $durable.Body "errorMessage") -notmatch
      "WorkflowInputRejected"
  ) { throw "Durable exact-version rejection failed." }
  $execution = Invoke-AwsJson @(
    "lambda", "get-durable-execution", "--durable-execution-arn",
    ([string]$durableExecutionArn)
  ) "The durable execution status is unavailable."
  if (
    [string](Get-OptionalPropertyValue $execution "Status") -ne "FAILED" -or
    [string](Get-OptionalPropertyValue $execution "Version") -ne
      [string]$Context.Boundary.Functions.Durable.Version
  ) { throw "The durable rejection did not reach FAILED on the exact version." }
}

try {
  foreach ($command in @("aws", "git", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }
  switch ($Action) {
    "Plan" {
      if ($Execute) { throw "Plan does not accept -Execute." }
      if (Test-Path -LiteralPath $contextPath) { throw "A reviewed context already exists." }
      $commit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
      $zeroDriftHash = Get-ZeroDriftPlan $commit
      $boundary = Get-LiveBoundary
      $messageId = "dark-conformance-$([Guid]::NewGuid().ToString('N'))"
      $executionName = "dark-conformance-$([Guid]::NewGuid().ToString('N'))"
      $context = [ordered]@{
        Schema = "applydash.development.workflow-dark-conformance.v1"
        Environment = "development"
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
          Durable = '{"schemaVersion":2}'
        }
        InvocationCount = 4
        ReconcilerInvoked = $false
        ProductDataWrite = $false
        TriggersEnabled = $false
        PublicTrafficChange = $false
      }
      $hash = Save-Context $context
      [ordered]@{
        Environment = "development"
        Action = "review"
        SourceCommit = $commit
        CommittedSource = @(& git -C $repositoryRoot status --porcelain --untracked-files=all).Count -eq 0
        PlanSha256 = $hash
        ZeroDriftPlanSha256 = $zeroDriftHash
        InvocationCountOnExecute = 4
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
        throw "Synchronous conformance unexpectedly populated the durable DLQ."
      }
      Assert-SameBoundary $context.Boundary (Get-LiveBoundary)
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = "development"
        Result = "passed"
        Invocations = 4
        DurableExactVersionFailedClosed = $true
        DeadLetterMessages = 0
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
      Assert-SameBoundary $context.Boundary (Get-LiveBoundary)
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{ Environment = "development"; Action = "cleanup"; AwsMutation = $false } |
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
