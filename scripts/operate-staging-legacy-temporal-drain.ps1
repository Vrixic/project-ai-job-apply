[CmdletBinding()]
param(
  [ValidateSet("Plan", "Execute", "Cleanup")]
  [string]$Action = "Plan",

  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "ai-job-apply-staging-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$Execute,

  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-legacy-temporal-drain.ps1 -Action Plan
  .\scripts\operate-staging-legacy-temporal-drain.ps1 `
    -Action Execute -ExpectedPlanSha256 REVIEWED_SHA256 -Execute
  .\scripts\operate-staging-legacy-temporal-drain.ps1 `
    -Action Cleanup -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Plan performs bounded AWS reads, starts one read-only outbox inspection task, and writes one ignored
checksum-reviewed context. Execute requires that exact checksum and clean merged source. It starts
exactly one retained immutable Temporal worker task, drains exactly the reviewed three synthetic
legacy records, proves zero pending outbox and zero running Temporal workflows, then stops the task.
Cleanup is only for interrupted execution: it stops at most the one reviewed standalone worker,
records the aggregate remaining count, and removes the local context so a new plan can be reviewed.

The operator never enables an ECS service, Lambda trigger, or public route; never rewrites an event
target; and never prints account IDs, ARNs, endpoints, event IDs, credentials, or candidate data.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The staging legacy drain is restricted to us-east-2."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\staging"
$contextDirectory = Join-Path $environmentDirectory ".terraform\serverless-cutover"
$contextPath = Join-Path $contextDirectory "legacy-temporal-drain-context.json"
$operatorPath = $MyInvocation.MyCommand.Path
$resourcePrefix = "ai-job-apply-staging"
$clusterName = $resourcePrefix
$startedBy = "staging-legacy-temporal-drain"
$temporalSecretId = "ai-job-apply/staging/temporal-api-key"
$utf8 = New-Object Text.UTF8Encoding($false)
$expectedPendingCount = 3
$alarmNames = @(
  "$resourcePrefix-outbox-reconciler-errors",
  "$resourcePrefix-outbox-starter-errors",
  "$resourcePrefix-outbox-starter-throttles",
  "$resourcePrefix-profile-readiness-activity-errors",
  "$resourcePrefix-profile-readiness-dead-letter",
  "$resourcePrefix-profile-readiness-durable-failed",
  "$resourcePrefix-profile-readiness-durable-timed-out"
)
$priorProfile = $env:AWS_PROFILE
$priorRegion = $env:AWS_REGION
$priorDefaultRegion = $env:AWS_DEFAULT_REGION
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Get-Sha256Text {
  param([Parameter(Mandatory = $true)][string]$Value)

  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return -join ($algorithm.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $algorithm.Dispose()
  }
}

function Get-CanonicalHash {
  param([Parameter(Mandatory = $true)][object]$Value)

  return Get-Sha256Text ($Value | ConvertTo-Json -Depth 40 -Compress)
}

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Failure
  )

  $raw = & aws @Arguments --no-cli-pager --output json 2>&1
  if ($LASTEXITCODE -ne 0) {
    $rawText = $raw -join [Environment]::NewLine
    $failureClass = if ($rawText -match "An error occurred \(([A-Za-z0-9.]+)\)") {
      $Matches[1]
    } elseif ($rawText -match "token.*expired|expired.*token") {
      "IdentitySessionExpired"
    } elseif ($rawText -match "Unable to locate credentials") {
      "CredentialsUnavailable"
    } elseif ($rawText -match "Could not connect|Connection.*timed out") {
      "NetworkUnavailable"
    } else {
      "AwsCliFailure"
    }
    throw "$Failure ErrorClass=$failureClass."
  }
  try {
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw $Failure
  }
}

function Get-Only {
  param([object[]]$Items, [string]$Failure)

  if ($Items.Count -ne 1) { throw $Failure }
  return $Items[0]
}

function Get-ContainerEnvironment {
  param([object]$Container)

  $values = [ordered]@{}
  foreach ($item in @($Container.environment)) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

function Get-QueueDepth {
  param([string]$Name)

  $queue = Invoke-AwsJson @("sqs", "get-queue-url", "--queue-name", $Name) `
    "A required replacement queue is unavailable."
  $attributes = Invoke-AwsJson @(
    "sqs", "get-queue-attributes", "--queue-url", ([string]$queue.QueueUrl),
    "--attribute-names", "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"
  ) "A required replacement queue depth is unavailable."
  return [ordered]@{
    Visible = [int]$attributes.Attributes.ApproximateNumberOfMessages
    InFlight = [int]$attributes.Attributes.ApproximateNumberOfMessagesNotVisible
    Delayed = [int]$attributes.Attributes.ApproximateNumberOfMessagesDelayed
  }
}

function Assert-QueueEmpty {
  param([object]$Depth, [string]$Label)

  if ([int]$Depth.Visible + [int]$Depth.InFlight + [int]$Depth.Delayed -ne 0) {
    throw "$Label must remain empty during the legacy Temporal drain."
  }
}

function Get-OutboxInspection {
  $raw = & (Join-Path $PSScriptRoot "inspect-deployed-outbox.ps1") `
    -Environment staging -AwsProfile $AwsProfile -Region $Region -Execute
  if ($LASTEXITCODE -ne 0) {
    throw "The bounded read-only staging outbox inspection failed."
  }
  try {
    $inspection = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "The staging outbox inspection did not return its sanitized contract."
  }
  if (
    [int]$inspection.version -ne 1 -or
    [int]$inspection.pendingCount -lt 0 -or
    [int]$inspection.pendingCount -gt 100 -or
    [string]$inspection.orderedEventIdSha256 -notmatch "^[a-f0-9]{64}$" -or
    $null -ne $inspection.PSObject.Properties["eventIds"]
  ) {
    throw "The staging outbox inspection is outside the identifier-free version-one contract."
  }
  return [ordered]@{
    PendingCount = [int]$inspection.pendingCount
    MaxAttempts = if ($null -eq $inspection.maximumAttempts) {
      0
    } else { [int]$inspection.maximumAttempts }
    OrderedEventIdSha256 = [string]$inspection.orderedEventIdSha256
  }
}

function Test-ZeroOpenTemporalWorkflows {
  param([object]$Runtime)

  $null = & node (Join-Path $repositoryRoot "backend\workflows\cloud-conformance.mjs") `
    --profile $AwsProfile --region $Region --secret-id $temporalSecretId `
    --address ([string]$Runtime.TemporalAddress) `
    --namespace ([string]$Runtime.TemporalNamespace) `
    --require-zero-open-workflows 2>&1
  return $LASTEXITCODE -eq 0
}

function Get-StandaloneTaskArns {
  param([string]$DesiredStatus)

  $result = Invoke-AwsJson @(
    "ecs", "list-tasks", "--cluster", $clusterName, "--desired-status", $DesiredStatus,
    "--started-by", $startedBy
  ) "The reviewed standalone worker inventory is unavailable."
  return @($result.taskArns | Where-Object { $_ })
}

function Get-ClusterActiveTaskArns {
  $running = Invoke-AwsJson @(
    "ecs", "list-tasks", "--cluster", $clusterName, "--desired-status", "RUNNING"
  ) "The staging running-task inventory is unavailable."
  $pending = Invoke-AwsJson @(
    "ecs", "list-tasks", "--cluster", $clusterName, "--desired-status", "PENDING"
  ) "The staging pending-task inventory is unavailable."
  return @(@($running.taskArns) + @($pending.taskArns) | Where-Object { $_ } | Sort-Object -Unique)
}

function Assert-NoReviewedTask {
  if (
    @(Get-StandaloneTaskArns "RUNNING").Count -ne 0 -or
    @(Get-StandaloneTaskArns "PENDING").Count -ne 0
  ) {
    throw "A reviewed standalone staging drain task is already active."
  }
}

function Assert-NoClusterTask {
  if (@(Get-ClusterActiveTaskArns).Count -ne 0) {
    throw "The staging cluster must have zero active tasks before review or execution."
  }
}

function Assert-OnlyReviewedTask {
  param([string]$TaskArn)

  $active = @(Get-ClusterActiveTaskArns)
  if ($active.Count -ne 1 -or [string]$active[0] -ne $TaskArn) {
    throw "The staging cluster does not contain only the one reviewed standalone worker."
  }
}

function Get-LiveRuntime {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") `
    "Refresh the staging IAM Identity Center session."
  if (
    [string]$caller.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$caller.Arn).Contains(":assumed-role/")
  ) {
    throw "Use the temporary staging IAM Identity Center caller."
  }

  $serviceResult = Invoke-AwsJson @(
    "ecs", "describe-services", "--cluster", $clusterName, "--services",
    "gateway", "workflow-worker"
  ) "The retained staging services are unavailable."
  if (@($serviceResult.failures).Count -ne 0 -or @($serviceResult.services).Count -ne 2) {
    throw "Both retained staging rollback services must exist."
  }
  foreach ($service in @($serviceResult.services)) {
    $primary = Get-Only @($service.deployments | Where-Object { $_.status -eq "PRIMARY" }) `
      "A retained service does not have one primary deployment."
    if (
      [string]$service.status -ne "ACTIVE" -or
      [int]$service.desiredCount -ne 0 -or [int]$service.runningCount -ne 0 -or
      [int]$service.pendingCount -ne 0 -or [string]$primary.rolloutState -ne "COMPLETED"
    ) {
      throw "Both retained staging services must remain at the accepted 0/0/0 posture."
    }
  }
  $workerService = Get-Only @(
    $serviceResult.services | Where-Object { $_.serviceName -eq "workflow-worker" }
  ) "The retained workflow-worker service is not singular."
  $taskDefinition = (
    Invoke-AwsJson @(
      "ecs", "describe-task-definition", "--task-definition", ([string]$workerService.taskDefinition)
    ) "The retained worker task definition is unavailable."
  ).taskDefinition
  $worker = Get-Only @(
    $taskDefinition.containerDefinitions | Where-Object { $_.name -eq "worker" }
  ) "The retained worker container is not singular."
  $collector = @(
    $taskDefinition.containerDefinitions | Where-Object { $_.name -eq "otel-collector" }
  )
  $environment = Get-ContainerEnvironment $worker
  $secretNames = @($worker.secrets | ForEach-Object { [string]$_.name } | Sort-Object)
  $workerImage = [string]$worker.image
  if (
    [string]$taskDefinition.status -ne "ACTIVE" -or
    [string]$taskDefinition.family -ne "$resourcePrefix-worker" -or
    [string]$taskDefinition.requiresCompatibilities -notcontains "FARGATE" -or
    [string]$taskDefinition.networkMode -ne "awsvpc" -or
    [string]$taskDefinition.runtimePlatform.cpuArchitecture -ne "X86_64" -or
    [string]$taskDefinition.runtimePlatform.operatingSystemFamily -ne "LINUX" -or
    $workerImage -notmatch "^[^@]+@sha256:[a-f0-9]{64}$" -or
    -not [bool]$worker.essential -or
    (Compare-Object $secretNames @("DATABASE_URL", "TEMPORAL_API_KEY")) -or
    [string]$environment.NODE_ENV -ne "production" -or
    [string]$environment.TEMPORAL_TASK_QUEUE -ne "profile-readiness-v1" -or
    [string]$environment.TEMPORAL_TLS -ne "true" -or
    [string]$environment.TEMPORAL_ADDRESS -notmatch "^[a-z0-9-]+\.[a-z0-9]+\.tmprl\.cloud:7233$" -or
    [string]$environment.TEMPORAL_NAMESPACE -ne
      ([string]$environment.TEMPORAL_ADDRESS).Substring(
        0,
        ([string]$environment.TEMPORAL_ADDRESS).Length - ".tmprl.cloud:7233".Length
      ) -or
    [string]$worker.logConfiguration.logDriver -ne "awslogs" -or
    [string]$worker.logConfiguration.options."awslogs-group" -ne
      "/ai-job-apply/staging/application" -or
    $collector.Count -gt 1
  ) {
    throw "The retained worker task is outside the immutable staging boundary."
  }
  if (
    $collector.Count -eq 1 -and
    (
      [bool]$collector[0].essential -or
      [string]$collector[0].image -notmatch "^[^@]+@sha256:[a-f0-9]{64}$"
    )
  ) {
    throw "The retained worker collector is outside the nonessential immutable boundary."
  }

  $network = $workerService.networkConfiguration.awsvpcConfiguration
  $subnets = @($network.subnets | Sort-Object)
  $securityGroups = @($network.securityGroups | Sort-Object)
  if (
    $subnets.Count -ne 2 -or $securityGroups.Count -ne 1 -or
    [string]$network.assignPublicIp -ne "ENABLED"
  ) {
    throw "The retained worker network is outside the accepted lean staging boundary."
  }

  Assert-NoReviewedTask
  Assert-NoClusterTask

  $gatewayAlias = Invoke-AwsJson @(
    "lambda", "get-alias", "--function-name", "$resourcePrefix-gateway", "--name", "staging"
  ) "The accepted staging gateway alias is unavailable."
  $gateway = Invoke-AwsJson @(
    "lambda", "get-function-configuration", "--function-name", "$resourcePrefix-gateway",
    "--qualifier", ([string]$gatewayAlias.FunctionVersion)
  ) "The accepted staging gateway version is unavailable."
  if (
    [string]$gateway.State -ne "Active" -or
    [string]$gateway.LastUpdateStatus -ne "Successful" -or
    [string]$gateway.Environment.Variables.OUTBOX_DISPATCH_TARGET -ne "temporal"
  ) {
    throw "The accepted staging gateway no longer dispatches to Temporal."
  }

  $mappingResult = Invoke-AwsJson @(
    "lambda", "list-event-source-mappings", "--function-name",
    "$resourcePrefix-outbox-starter:staging"
  ) "The staging starter mapping is unavailable."
  $mapping = Get-Only @($mappingResult.EventSourceMappings) `
    "The staging starter mapping is not singular."
  if (
    [string]$mapping.State -ne "Disabled" -or
    @($mapping.FunctionResponseTypes) -notcontains "ReportBatchItemFailures"
  ) {
    throw "The staging Lambda starter must remain disabled with partial-batch handling."
  }
  $ruleStates = [ordered]@{}
  foreach ($name in @(
    "$resourcePrefix-outbox-reconciler",
    "$resourcePrefix-profile-readiness-terminal"
  )) {
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $name) `
      "A replacement workflow rule is unavailable."
    if ([string]$rule.State -ne "DISABLED") {
      throw "All replacement workflow rules must remain disabled during legacy drain."
    }
    $ruleStates[$name] = "DISABLED"
  }

  $apis = Invoke-AwsJson @("apigatewayv2", "get-apis") "The staging API is unavailable."
  $api = Get-Only @($apis.Items | Where-Object { $_.Name -eq "$resourcePrefix-gateway" }) `
    "The staging API is not singular."
  $integrations = Invoke-AwsJson @(
    "apigatewayv2", "get-integrations", "--api-id", ([string]$api.ApiId)
  ) "The staging API integration is unavailable."
  $integration = Get-Only @($integrations.Items) `
    "The staging API must have only its retained ECS integration before cutover."
  $routes = Invoke-AwsJson @(
    "apigatewayv2", "get-routes", "--api-id", ([string]$api.ApiId)
  ) "The staging API route is unavailable."
  $route = Get-Only @($routes.Items) "The staging API must have only its default route."
  if (
    [string]$integration.IntegrationType -ne "HTTP_PROXY" -or
    [string]$integration.IntegrationUri -notmatch "^arn:aws:servicediscovery:" -or
    [string]$route.RouteKey -ne '$default' -or
    [string]$route.Target -ne "integrations/$($integration.IntegrationId)" -or
    [string]$route.AuthorizationType -ne "NONE"
  ) {
    throw "Public staging routing is no longer on the retained ECS integration."
  }

  $alarmResult = Invoke-AwsJson `
    (@("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames) `
    "The staging replacement alarm inventory is unavailable."
  $alarms = @($alarmResult.MetricAlarms | Sort-Object AlarmName | ForEach-Object {
      if (
        [string]$_.StateValue -ne "OK" -or -not [bool]$_.ActionsEnabled -or
        @($_.AlarmActions).Count -ne 1 -or @($_.OKActions).Count -ne 1
      ) {
        throw "A replacement alarm is not enabled, routed, and OK."
      }
      [ordered]@{ Name = [string]$_.AlarmName; State = "OK" }
    })
  if ($alarms.Count -ne 7) { throw "The exact seven replacement alarms are required." }

  $queueDepths = [ordered]@{
    Events = Get-QueueDepth "$resourcePrefix-events"
    EventDeadLetter = Get-QueueDepth "$resourcePrefix-dead-letter"
    DurableDeadLetter = Get-QueueDepth "$resourcePrefix-profile-readiness-dead-letter"
  }
  Assert-QueueEmpty $queueDepths.Events "The replacement source queue"
  Assert-QueueEmpty $queueDepths.EventDeadLetter "The replacement source DLQ"
  Assert-QueueEmpty $queueDepths.DurableDeadLetter "The replacement durable DLQ"

  $taskDefinitionBoundary = [ordered]@{
    Family = [string]$taskDefinition.family
    Revision = [int]$taskDefinition.revision
    Cpu = [string]$taskDefinition.cpu
    Memory = [string]$taskDefinition.memory
    TaskRoleSha256 = Get-Sha256Text ([string]$taskDefinition.taskRoleArn)
    ExecutionRoleSha256 = Get-Sha256Text ([string]$taskDefinition.executionRoleArn)
    WorkerImageSha256 = ($workerImage -split "@sha256:")[1]
    WorkerCpu = [int]$worker.cpu
    WorkerEnvironmentSha256 = Get-CanonicalHash $environment
    WorkerSecretsSha256 = Get-CanonicalHash @($worker.secrets)
    LogConfigurationSha256 = Get-CanonicalHash $worker.logConfiguration
    CollectorSha256 = if ($collector.Count -eq 1) {
      Get-CanonicalHash $collector[0]
    } else { Get-Sha256Text "absent" }
  }
  $networkBoundary = [ordered]@{
    SubnetsSha256 = Get-CanonicalHash $subnets
    SecurityGroupsSha256 = Get-CanonicalHash $securityGroups
    AssignPublicIp = "ENABLED"
  }
  $apiBoundary = [ordered]@{
    ApiSha256 = Get-Sha256Text ([string]$api.ApiId)
    IntegrationSha256 = Get-CanonicalHash ([ordered]@{
        Id = [string]$integration.IntegrationId
        Type = [string]$integration.IntegrationType
        Uri = [string]$integration.IntegrationUri
      })
    RouteSha256 = Get-CanonicalHash ([ordered]@{
        Id = [string]$route.RouteId
        Key = [string]$route.RouteKey
        Target = [string]$route.Target
        Authorization = [string]$route.AuthorizationType
      })
  }

  return [ordered]@{
    Boundary = [ordered]@{
      AccountSha256 = Get-Sha256Text ([string]$caller.Account)
      WorkerTaskDefinition = $taskDefinitionBoundary
      WorkerNetwork = $networkBoundary
      Gateway = [ordered]@{
        Version = [string]$gateway.Version
        CodeSha256 = [string]$gateway.CodeSha256
        AliasRevisionId = [string]$gatewayAlias.RevisionId
        DispatchTarget = "temporal"
      }
      Mapping = [ordered]@{ Uuid = [string]$mapping.UUID; State = "Disabled" }
      Rules = $ruleStates
      Api = $apiBoundary
      Alarms = $alarms
      Queues = $queueDepths
      EcsServicesIdle = $true
      ReviewedStandaloneTasks = 0
      TemporalIdentitySha256 = Get-CanonicalHash @(
        [string]$environment.TEMPORAL_ADDRESS,
        [string]$environment.TEMPORAL_NAMESPACE
      )
    }
    ClusterArn = [string]$workerService.clusterArn
    WorkerTaskDefinitionArn = [string]$workerService.taskDefinition
    Subnets = $subnets
    SecurityGroups = $securityGroups
    AssignPublicIp = [string]$network.assignPublicIp
    TemporalAddress = [string]$environment.TEMPORAL_ADDRESS
    TemporalNamespace = [string]$environment.TEMPORAL_NAMESPACE
  }
}

function Save-Context {
  param([System.Collections.IDictionary]$Context)

  $null = New-Item -ItemType Directory -Path $contextDirectory -Force
  [IO.File]::WriteAllText($contextPath, ($Context | ConvertTo-Json -Depth 40), $utf8)
  return (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Context {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw "No reviewed staging legacy-drain context exists."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "The exact reviewed context checksum is required."
  }
  $hash = (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $ExpectedPlanSha256.ToLowerInvariant()) {
    throw "The staging legacy-drain context checksum differs from the reviewed checksum."
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  if (
    [string]$context.Schema -ne "applydash.staging.legacy-temporal-drain.v1" -or
    [string]$context.Environment -ne "staging" -or [string]$context.Region -ne "us-east-2" -or
    [int]$context.ExpectedPendingCount -ne 3 -or
    [string]$context.ExpectedOrderedEventIdSha256 -notmatch "^[a-f0-9]{64}$" -or
    [int]$context.ExpectedMaxAttempts -ne 0 -or
    [int]$context.StandaloneWorkerTasks -ne 1 -or
    [int]$context.MaxDrainAttempts -ne 8 -or [int]$context.DrainPollSeconds -ne 10 -or
    $context.AwsMutationOnExecute -isnot [bool] -or -not [bool]$context.AwsMutationOnExecute -or
    $context.ProductRecordsTransition -isnot [bool] -or -not [bool]$context.ProductRecordsTransition -or
    $context.PublicTrafficChange -isnot [bool] -or [bool]$context.PublicTrafficChange -or
    $context.TriggerChange -isnot [bool] -or [bool]$context.TriggerChange -or
    $context.EcsServiceCapacityChange -isnot [bool] -or [bool]$context.EcsServiceCapacityChange -or
    $context.EventTargetRewrite -isnot [bool] -or [bool]$context.EventTargetRewrite
  ) {
    throw "The reviewed staging legacy-drain context is outside its safety contract."
  }
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
  ) {
    throw "Review and execution require clean main at its exact configured upstream commit."
  }
  return $commit
}

function Assert-ExactSource {
  param([object]$Context)

  $commit = Get-ReviewableSourceCommit
  $operatorHash = (Get-FileHash -LiteralPath $operatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    $commit -ne [string]$Context.SourceCommit -or
    $operatorHash -ne [string]$Context.OperatorSha256
  ) {
    throw "Execution requires the exact clean merged source used for review."
  }
}

function Assert-SameBoundary {
  param([object]$Expected, [object]$Actual)

  if (
    ($Expected | ConvertTo-Json -Depth 40 -Compress) -cne
    ($Actual | ConvertTo-Json -Depth 40 -Compress)
  ) {
    throw "The staging legacy runtime boundary changed after review."
  }
}

function Stop-ReviewedTask {
  param([string]$TaskArn)

  if (-not $TaskArn) { return }
  $description = Invoke-AwsJson @(
    "ecs", "describe-tasks", "--cluster", $clusterName, "--tasks", $TaskArn
  ) "The reviewed standalone worker status is unavailable."
  $task = Get-Only @($description.tasks) "The reviewed standalone worker is not singular."
  if ([string]$task.startedBy -ne $startedBy) {
    throw "The standalone worker is outside the reviewed ownership boundary."
  }
  if ([string]$task.lastStatus -ne "STOPPED") {
    $null = Invoke-AwsJson @(
      "ecs", "stop-task", "--cluster", $clusterName, "--task", $TaskArn,
      "--reason", "Reviewed bounded staging legacy Temporal drain completed or stopped"
    ) "The reviewed standalone worker could not be stopped."
  }
  & aws ecs wait tasks-stopped --cluster $clusterName --tasks $TaskArn --no-cli-pager 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The reviewed standalone worker did not stop within the bounded waiter window."
  }
}

function Assert-WorkerLogsClean {
  param([string]$TaskArn)

  $taskId = ($TaskArn -split "/")[-1]
  $stream = "worker/worker/$taskId"
  $messages = @()
  for ($attempt = 0; $attempt -lt 12 -and $messages.Count -eq 0; $attempt++) {
    try {
      $events = Invoke-AwsJson @(
        "logs", "get-log-events", "--log-group-name", "/ai-job-apply/staging/application",
        "--log-stream-name", $stream, "--start-from-head"
      ) "The reviewed worker log stream is unavailable."
      $messages = @($events.events | ForEach-Object { [string]$_.message } | Where-Object { $_ })
    } catch {
      if ($attempt -eq 11) { throw }
    }
    if ($messages.Count -eq 0) { Start-Sleep -Seconds 5 }
  }
  $started = 0
  $errors = 0
  foreach ($message in $messages) {
    try { $record = $message | ConvertFrom-Json } catch { continue }
    if ([string]$record.service -ne "workflow-worker") { continue }
    if ([string]$record.msg -eq "workflow worker started") { $started++ }
    if ([int]$record.level -ge 50) { $errors++ }
  }
  if ($started -ne 1 -or $errors -ne 0) {
    throw "The reviewed worker did not emit one clean aggregate startup record."
  }
  return [ordered]@{ StartupRecords = $started; ErrorRecords = $errors }
}

function Start-ReviewedWorker {
  param([object]$Runtime)

  $networkConfiguration = "awsvpcConfiguration={subnets=[$($Runtime.Subnets -join ',')],securityGroups=[$($Runtime.SecurityGroups -join ',')],assignPublicIp=$($Runtime.AssignPublicIp)}"
  $run = Invoke-AwsJson @(
    "ecs", "run-task", "--cluster", ([string]$Runtime.ClusterArn),
    "--task-definition", ([string]$Runtime.WorkerTaskDefinitionArn),
    "--launch-type", "FARGATE", "--count", "1",
    "--network-configuration", $networkConfiguration,
    "--started-by", $startedBy
  ) "AWS did not accept the reviewed standalone worker."
  if (@($run.failures).Count -ne 0 -or @($run.tasks).Count -ne 1) {
    throw "AWS did not start exactly one reviewed standalone worker."
  }
  $taskArn = [string]$run.tasks[0].taskArn
  Assert-OnlyReviewedTask $taskArn
  return $taskArn
}

function Wait-DrainComplete {
  param([object]$Runtime, [object]$Context)

  $lastInspection = $null
  for ($attempt = 0; $attempt -lt [int]$Context.MaxDrainAttempts; $attempt++) {
    Start-Sleep -Seconds ([int]$Context.DrainPollSeconds)
    $lastInspection = Get-OutboxInspection
    if ([int]$lastInspection.PendingCount -gt [int]$Context.ExpectedPendingCount) {
      throw "The pending outbox grew during the isolated legacy drain."
    }
    if (
      [int]$lastInspection.PendingCount -eq 0 -and
      (Test-ZeroOpenTemporalWorkflows $Runtime)
    ) {
      Start-Sleep -Seconds 3
      $confirmation = Get-OutboxInspection
      if (
        [int]$confirmation.PendingCount -eq 0 -and
        (Test-ZeroOpenTemporalWorkflows $Runtime)
      ) {
        return $confirmation
      }
    }
  }
  $remaining = if ($null -eq $lastInspection) { "unknown" } else {
    [string]$lastInspection.PendingCount
  }
  throw "The reviewed legacy drain did not reach the double-checked terminal boundary. Remaining=$remaining."
}

try {
  foreach ($command in @("aws", "git", "node", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }

  switch ($Action) {
    "Plan" {
      if ($Execute) { throw "Plan does not accept -Execute." }
      if (Test-Path -LiteralPath $contextPath) {
        throw "A reviewed staging legacy-drain context already exists."
      }
      $commit = Get-ReviewableSourceCommit
      $beforeRuntime = Get-LiveRuntime
      if (-not (Test-ZeroOpenTemporalWorkflows $beforeRuntime)) {
        throw "Staging Temporal must have zero running workflows before drain review."
      }
      $inspection = Get-OutboxInspection
      if (
        [int]$inspection.PendingCount -ne $expectedPendingCount -or
        [int]$inspection.MaxAttempts -ne 0
      ) {
        throw "Review requires exactly three untouched synthetic legacy outbox records."
      }
      $afterRuntime = Get-LiveRuntime
      Assert-SameBoundary $beforeRuntime.Boundary $afterRuntime.Boundary
      $context = [ordered]@{
        Schema = "applydash.staging.legacy-temporal-drain.v1"
        Environment = "staging"
        Region = $Region
        CreatedAt = [DateTime]::UtcNow.ToString("o")
        SourceCommit = $commit
        OperatorSha256 = (Get-FileHash -LiteralPath $operatorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Boundary = $afterRuntime.Boundary
        ExpectedPendingCount = $expectedPendingCount
        ExpectedMaxAttempts = 0
        ExpectedOrderedEventIdSha256 = [string]$inspection.OrderedEventIdSha256
        StandaloneWorkerTasks = 1
        MaxDrainAttempts = 8
        DrainPollSeconds = 10
        AwsMutationOnExecute = $true
        ProductRecordsTransition = $true
        PublicTrafficChange = $false
        TriggerChange = $false
        EcsServiceCapacityChange = $false
        EventTargetRewrite = $false
      }
      $hash = Save-Context $context
      [ordered]@{
        Environment = "staging"
        Action = "review"
        SourceCommit = $commit
        PlanSha256 = $hash
        PendingRecords = $expectedPendingCount
        PendingAttempts = 0
        StandaloneWorkerTasksOnExecute = 1
        ProductRecordsTransitionOnExecute = $true
        PublicTrafficChange = $false
        TriggerChange = $false
        EcsServiceCapacityChange = $false
        EventTargetRewrite = $false
        ContextPath = $contextPath
      } | ConvertTo-Json
    }

    "Execute" {
      if (-not $Execute) { throw "Execution requires -Execute." }
      $context = Get-Context
      Assert-ExactSource $context
      $runtime = Get-LiveRuntime
      Assert-SameBoundary $context.Boundary $runtime.Boundary
      if (-not (Test-ZeroOpenTemporalWorkflows $runtime)) {
        throw "Staging Temporal no longer has zero running workflows."
      }
      $inspection = Get-OutboxInspection
      if (
        [int]$inspection.PendingCount -ne [int]$context.ExpectedPendingCount -or
        [int]$inspection.MaxAttempts -ne [int]$context.ExpectedMaxAttempts -or
        [string]$inspection.OrderedEventIdSha256 -cne
          [string]$context.ExpectedOrderedEventIdSha256
      ) {
        throw "The reviewed three-record aggregate changed before execution."
      }
      $runtime = Get-LiveRuntime
      Assert-SameBoundary $context.Boundary $runtime.Boundary

      $taskArn = ""
      $logs = $null
      try {
        $taskArn = Start-ReviewedWorker $runtime
        $null = Wait-DrainComplete $runtime $context
        Stop-ReviewedTask $taskArn
        $logs = Assert-WorkerLogsClean $taskArn
        $taskArn = ""
      } finally {
        if ($taskArn) { Stop-ReviewedTask $taskArn }
      }

      $finalInspection = Get-OutboxInspection
      if (
        [int]$finalInspection.PendingCount -ne 0 -or
        -not (Test-ZeroOpenTemporalWorkflows $runtime)
      ) {
        throw "The stopped worker did not leave the legacy outbox and Temporal namespace terminal."
      }
      $finalRuntime = Get-LiveRuntime
      Assert-SameBoundary $context.Boundary $finalRuntime.Boundary
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = "staging"
        Result = "passed"
        ReviewedLegacyRecords = 3
        RemainingOutboxRecords = 0
        RunningTemporalWorkflows = 0
        StandaloneWorkerTasksStarted = 1
        StandaloneWorkerTasksRunning = 0
        WorkerStartupRecords = [int]$logs.StartupRecords
        WorkerErrorRecords = [int]$logs.ErrorRecords
        PublicTrafficChange = $false
        TriggerChange = $false
        EcsServiceCapacityChange = $false
        EventTargetRewrite = $false
        ContextRemoved = $true
      } | ConvertTo-Json
    }

    "Cleanup" {
      if (-not $Execute) { throw "Cleanup requires -Execute." }
      $context = Get-Context
      $caller = Invoke-AwsJson @("sts", "get-caller-identity") `
        "Refresh the staging IAM Identity Center session."
      if (
        (Get-Sha256Text ([string]$caller.Account)) -ne
          [string]$context.Boundary.AccountSha256
      ) {
        throw "Cleanup is not running in the reviewed staging account."
      }
      $tasks = @(
        @(Get-StandaloneTaskArns "RUNNING") + @(Get-StandaloneTaskArns "PENDING") |
          Sort-Object -Unique
      )
      if ($tasks.Count -gt 1) {
        throw "Cleanup found more than one reviewed standalone worker."
      }
      if ($tasks.Count -eq 1) { Stop-ReviewedTask ([string]$tasks[0]) }
      $inspection = Get-OutboxInspection
      $temporalZero = $false
      try {
        $runtime = Get-LiveRuntime
        $temporalZero = Test-ZeroOpenTemporalWorkflows $runtime
      } catch {
        $temporalZero = $false
      }
      Remove-Item -LiteralPath $contextPath -Force
      [ordered]@{
        Environment = "staging"
        Action = "cleanup"
        ReviewedTasksStopped = $tasks.Count
        RemainingOutboxRecords = [int]$inspection.PendingCount
        RemainingOutboxDigest = [string]$inspection.OrderedEventIdSha256
        RunningTemporalWorkflowsZero = [bool]$temporalZero
        ProductRecordsMayHaveTransitioned = $true
        ContextRemoved = $true
        ReplanRequired = $true
      } | ConvertTo-Json
    }
  }
} finally {
  if ($null -eq $priorProfile) {
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
  } else { $env:AWS_PROFILE = $priorProfile }
  if ($null -eq $priorRegion) {
    Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
  } else { $env:AWS_REGION = $priorRegion }
  if ($null -eq $priorDefaultRegion) {
    Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
  } else { $env:AWS_DEFAULT_REGION = $priorDefaultRegion }
}
