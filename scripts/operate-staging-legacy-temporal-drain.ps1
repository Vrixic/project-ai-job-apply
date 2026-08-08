[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "staging",

  [ValidateSet("Plan", "Execute", "Cleanup")]
  [string]$Action = "Plan",

  [ValidateSet("PreCutover", "PostCutover")]
  [string]$RuntimeBoundary = "PreCutover",

  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$Execute,

  [switch]$ConfirmZeroTraffic,

  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}
$commandName = if ($Environment -eq "development") {
  "operate-development-legacy-temporal-drain.ps1"
} else {
  "operate-staging-legacy-temporal-drain.ps1"
}

if ($Help) {
  @"
Usage:
  .\scripts\$commandName -Action Plan
  .\scripts\$commandName `
    -Action Execute -ExpectedPlanSha256 REVIEWED_SHA256 -Execute
  .\scripts\$commandName `
    -Action Cleanup -ExpectedPlanSha256 REVIEWED_SHA256 -Execute
  .\scripts\$commandName `
    -Action Plan -RuntimeBoundary PostCutover -ConfirmZeroTraffic
  .\scripts\$commandName `
    -Action Execute -RuntimeBoundary PostCutover -ConfirmZeroTraffic `
    -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Plan performs bounded AWS reads, starts one read-only outbox inspection task, and writes one ignored
checksum-reviewed context. Execute requires that exact checksum and clean merged source. It starts
exactly one retained immutable Temporal worker task, drains only the exact reviewed synthetic
legacy batch, proves zero pending outbox and zero running Temporal workflows, then stops the task.
Cleanup is only for interrupted execution: it stops at most the one reviewed standalone worker,
records the aggregate remaining count, and removes the local context so a new plan can be reviewed.

PostCutover requires -ConfirmZeroTraffic. It preserves Lambda durable dispatch, the JWT-protected
Lambda API, public health routes, and all durable triggers while the retained Temporal worker drains
only the reviewed legacy Temporal-targeted records. It does not pause or redirect the live runtime.

The operator never enables an ECS service, Lambda trigger, or public route; never rewrites an event
target; and never prints account IDs, ARNs, endpoints, event IDs, credentials, or candidate data.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The $Environment legacy drain is restricted to us-east-2."
}
if ($RuntimeBoundary -eq "PostCutover" -and -not $ConfirmZeroTraffic) {
  throw "Post-cutover legacy drain requires -ConfirmZeroTraffic."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$contextDirectory = Join-Path $environmentDirectory ".terraform\serverless-cutover"
$contextPath = Join-Path $contextDirectory "legacy-temporal-drain-context.json"
$operatorPath = $MyInvocation.MyCommand.Path
$resourcePrefix = "ai-job-apply-$Environment"
$clusterName = $resourcePrefix
$startedBy = "$Environment-legacy-temporal-drain"
$temporalSecretId = "ai-job-apply/$Environment/temporal-api-key"
$applicationLogGroup = "/ai-job-apply/$Environment/application"
$expectedContextSchema = "applydash.$Environment.legacy-temporal-drain.v3"
$utf8 = New-Object Text.UTF8Encoding($false)
$minimumPendingCount = 1
$maximumPendingCount = 100
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

function Get-OptionalPropertyValue {
  param([object]$Object, [string]$Name)

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
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
    -Environment $Environment -AwsProfile $AwsProfile -Region $Region -Execute
  if ($LASTEXITCODE -ne 0) {
    throw "The bounded read-only $Environment outbox inspection failed."
  }
  try {
    $inspection = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "The $Environment outbox inspection did not return its sanitized contract."
  }
  if (
    [int]$inspection.version -ne 1 -or
    [int]$inspection.pendingCount -lt 0 -or
    [int]$inspection.pendingCount -gt 100 -or
    [string]$inspection.orderedEventIdSha256 -notmatch "^[a-f0-9]{64}$" -or
    $null -ne $inspection.PSObject.Properties["eventIds"]
  ) {
    throw "The $Environment outbox inspection is outside the identifier-free version-one contract."
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
  ) "The $Environment running-task inventory is unavailable."
  $pending = Invoke-AwsJson @(
    "ecs", "list-tasks", "--cluster", $clusterName, "--desired-status", "PENDING"
  ) "The $Environment pending-task inventory is unavailable."
  return @(@($running.taskArns) + @($pending.taskArns) | Where-Object { $_ } | Sort-Object -Unique)
}

function Assert-NoReviewedTask {
  if (
    @(Get-StandaloneTaskArns "RUNNING").Count -ne 0 -or
    @(Get-StandaloneTaskArns "PENDING").Count -ne 0
  ) {
    throw "A reviewed standalone $Environment drain task is already active."
  }
}

function Assert-NoClusterTask {
  if (@(Get-ClusterActiveTaskArns).Count -ne 0) {
    throw "The $Environment cluster must have zero active tasks before review or execution."
  }
}

function Assert-OnlyReviewedTask {
  param([string]$TaskArn)

  $active = @(Get-ClusterActiveTaskArns)
  if ($active.Count -ne 1 -or [string]$active[0] -ne $TaskArn) {
    throw "The $Environment cluster does not contain only the one reviewed standalone worker."
  }
}

function Get-LiveRuntime {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") `
    "Refresh the $Environment IAM Identity Center session."
  if (
    [string]$caller.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$caller.Arn).Contains(":assumed-role/")
  ) {
    throw "Use the temporary $Environment IAM Identity Center caller."
  }

  $serviceResult = Invoke-AwsJson @(
    "ecs", "describe-services", "--cluster", $clusterName, "--services",
    "gateway", "workflow-worker"
  ) "The retained $Environment services are unavailable."
  if (@($serviceResult.failures).Count -ne 0 -or @($serviceResult.services).Count -ne 2) {
    throw "Both retained $Environment rollback services must exist."
  }
  foreach ($service in @($serviceResult.services)) {
    $primary = Get-Only @($service.deployments | Where-Object { $_.status -eq "PRIMARY" }) `
      "A retained service does not have one primary deployment."
    if (
      [string]$service.status -ne "ACTIVE" -or
      [int]$service.desiredCount -ne 0 -or [int]$service.runningCount -ne 0 -or
      [int]$service.pendingCount -ne 0 -or [string]$primary.rolloutState -ne "COMPLETED"
    ) {
      throw "Both retained $Environment services must remain at the accepted 0/0/0 posture."
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
  $workerEnvironment = Get-ContainerEnvironment $worker
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
    [string]$workerEnvironment.NODE_ENV -ne "production" -or
    [string]$workerEnvironment.TEMPORAL_TASK_QUEUE -ne "profile-readiness-v1" -or
    [string]$workerEnvironment.TEMPORAL_TLS -ne "true" -or
    [string]$workerEnvironment.TEMPORAL_ADDRESS -notmatch "^[a-z0-9-]+\.[a-z0-9]+\.tmprl\.cloud:7233$" -or
    [string]$workerEnvironment.TEMPORAL_NAMESPACE -ne
      ([string]$workerEnvironment.TEMPORAL_ADDRESS).Substring(
        0,
        ([string]$workerEnvironment.TEMPORAL_ADDRESS).Length - ".tmprl.cloud:7233".Length
      ) -or
    [string]$worker.logConfiguration.logDriver -ne "awslogs" -or
    [string]$worker.logConfiguration.options."awslogs-group" -ne
      $applicationLogGroup -or
    $collector.Count -gt 1
  ) {
    throw "The retained worker task is outside the immutable $Environment boundary."
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
    throw "The retained worker network is outside the accepted lean $Environment boundary."
  }

  Assert-NoReviewedTask
  Assert-NoClusterTask

  $gatewayAlias = Invoke-AwsJson @(
    "lambda", "get-alias", "--function-name", "$resourcePrefix-gateway", "--name", $Environment
  ) "The accepted $Environment gateway alias is unavailable."
  $gateway = Invoke-AwsJson @(
    "lambda", "get-function-configuration", "--function-name", "$resourcePrefix-gateway",
    "--qualifier", ([string]$gatewayAlias.FunctionVersion)
  ) "The accepted $Environment gateway version is unavailable."
  $expectedDispatchTarget = if ($RuntimeBoundary -eq "PostCutover") {
    "lambda_durable"
  } else { "temporal" }
  if (
    [string]$gateway.State -ne "Active" -or
    [string]$gateway.LastUpdateStatus -ne "Successful" -or
    [string]$gateway.Environment.Variables.OUTBOX_DISPATCH_TARGET -ne $expectedDispatchTarget
  ) {
    throw "The accepted $Environment gateway dispatch target is outside the selected runtime boundary."
  }

  $mappingResult = Invoke-AwsJson @(
    "lambda", "list-event-source-mappings", "--function-name",
    "$resourcePrefix-outbox-starter:$Environment"
  ) "The $Environment starter mapping is unavailable."
  $mapping = Get-Only @($mappingResult.EventSourceMappings) `
    "The $Environment starter mapping is not singular."
  $expectedMappingState = if ($RuntimeBoundary -eq "PostCutover") { "Enabled" } else { "Disabled" }
  if (
    [string]$mapping.State -ne $expectedMappingState -or
    @($mapping.FunctionResponseTypes) -notcontains "ReportBatchItemFailures"
  ) {
    throw "The $Environment Lambda starter is outside the selected partial-batch runtime boundary."
  }
  $expectedRuleState = if ($RuntimeBoundary -eq "PostCutover") { "ENABLED" } else { "DISABLED" }
  $ruleStates = [ordered]@{}
  foreach ($name in @(
    "$resourcePrefix-outbox-reconciler",
    "$resourcePrefix-profile-readiness-terminal"
  )) {
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $name) `
      "A replacement workflow rule is unavailable."
    if ([string]$rule.State -ne $expectedRuleState) {
      throw "A replacement workflow rule is outside the selected runtime boundary."
    }
    $ruleStates[$name] = $expectedRuleState
  }

  $apis = Invoke-AwsJson @("apigatewayv2", "get-apis") "The $Environment API is unavailable."
  $api = Get-Only @($apis.Items | Where-Object { $_.Name -eq "$resourcePrefix-gateway" }) `
    "The $Environment API is not singular."
  $integrations = Invoke-AwsJson @(
    "apigatewayv2", "get-integrations", "--api-id", ([string]$api.ApiId)
  ) "The $Environment API integration is unavailable."
  $integrationItems = @($integrations.Items)
  $routes = Invoke-AwsJson @(
    "apigatewayv2", "get-routes", "--api-id", ([string]$api.ApiId)
  ) "The $Environment API route is unavailable."
  $routeItems = @($routes.Items)
  $ecsIntegration = Get-Only @($integrationItems | Where-Object {
      [string]$_.IntegrationType -eq "HTTP_PROXY" -and
      [string]$_.IntegrationUri -match "^arn:aws:servicediscovery:"
    }) "The retained ECS rollback integration is not singular."
  $authorizerBoundary = Get-Sha256Text "absent"
  if ($RuntimeBoundary -eq "PreCutover") {
    $route = Get-Only $routeItems "The pre-cutover API must have only its default route."
    if (
      $integrationItems.Count -ne 1 -or
      [string]$route.RouteKey -ne '$default' -or
      [string]$route.Target -ne "integrations/$($ecsIntegration.IntegrationId)" -or
      [string]$route.AuthorizationType -ne "NONE"
    ) {
      throw "Public $Environment routing is outside the retained pre-cutover ECS boundary."
    }
  } else {
    $lambdaIntegration = Get-Only @($integrationItems | Where-Object {
        [string]$_.IntegrationType -eq "AWS_PROXY"
      }) "The post-cutover Lambda integration is not singular."
    $lambdaAliasArn = [string]$gatewayAlias.AliasArn
    $expectedInvokeArn = "arn:aws:apigateway:$Region`:lambda:path/2015-03-31/functions/$lambdaAliasArn/invocations"
    if (
      $integrationItems.Count -ne 2 -or
      [string]$lambdaIntegration.IntegrationMethod -ne "POST" -or
      [string]$lambdaIntegration.PayloadFormatVersion -ne "2.0" -or
      [int]$lambdaIntegration.TimeoutInMillis -ne 15000 -or
      [string]$lambdaIntegration.IntegrationUri -ne $expectedInvokeArn
    ) {
      throw "The post-cutover API integrations are outside the exact retained ECS and Lambda boundary."
    }
    $lambdaTarget = "integrations/$($lambdaIntegration.IntegrationId)"
    $defaultRoute = Get-Only @($routeItems | Where-Object {
        [string]$_.RouteKey -eq '$default'
      }) "The post-cutover default route is not singular."
    $healthRoutes = @($routeItems | Where-Object {
        [string]$_.RouteKey -in @("GET /health/live", "GET /health/ready")
      })
    $scopes = @($defaultRoute.AuthorizationScopes | Sort-Object)
    if (
      $routeItems.Count -ne 3 -or $healthRoutes.Count -ne 2 -or
      [string]$defaultRoute.AuthorizationType -ne "JWT" -or
      [string]$defaultRoute.Target -ne $lambdaTarget -or
      (Compare-Object $scopes @("profile:read", "profile:write")) -or
      @($healthRoutes | Where-Object {
          [string]$_.AuthorizationType -eq "NONE" -and
          [string]$_.Target -eq $lambdaTarget
        }).Count -ne 2
    ) {
      throw "The post-cutover API does not retain one scoped JWT default route and two public Lambda health routes."
    }
    $authorizer = Invoke-AwsJson @(
      "apigatewayv2", "get-authorizer", "--api-id", ([string]$api.ApiId),
      "--authorizer-id", ([string]$defaultRoute.AuthorizerId)
    ) "The post-cutover JWT authorizer is unavailable."
    $gatewayVariables = $gateway.Environment.Variables
    if (
      [string]$authorizer.AuthorizerType -ne "JWT" -or
      @($authorizer.IdentitySource).Count -ne 1 -or
      [string]@($authorizer.IdentitySource)[0] -ne '$request.header.Authorization' -or
      [string]$gatewayVariables.OIDC_ISSUER -notmatch '^https://[^/]+/$' -or
      [string]$gatewayVariables.OIDC_AUDIENCE -eq "" -or
      [string]$authorizer.JwtConfiguration.Issuer -ne [string]$gatewayVariables.OIDC_ISSUER -or
      @($authorizer.JwtConfiguration.Audience).Count -ne 1 -or
      [string]@($authorizer.JwtConfiguration.Audience)[0] -ne
        [string]$gatewayVariables.OIDC_AUDIENCE
    ) {
      throw "The post-cutover JWT authorizer is outside the gateway OIDC boundary."
    }
    $authorizerBoundary = Get-CanonicalHash ([ordered]@{
        Id = [string]$defaultRoute.AuthorizerId
        Type = [string]$authorizer.AuthorizerType
        IdentitySource = @($authorizer.IdentitySource)
        Issuer = [string]$authorizer.JwtConfiguration.Issuer
        Audience = @($authorizer.JwtConfiguration.Audience)
      })
  }

  $alarmResult = Invoke-AwsJson `
    (@("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames) `
    "The $Environment replacement alarm inventory is unavailable."
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
    WorkerEnvironmentSha256 = Get-CanonicalHash $workerEnvironment
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
    IntegrationsSha256 = Get-CanonicalHash @($integrationItems | Sort-Object IntegrationId | ForEach-Object {
        [ordered]@{
          Id = [string]$_.IntegrationId; Type = [string]$_.IntegrationType
          Method = [string](Get-OptionalPropertyValue $_ "IntegrationMethod")
          Format = [string](Get-OptionalPropertyValue $_ "PayloadFormatVersion")
          Timeout = [int](Get-OptionalPropertyValue $_ "TimeoutInMillis")
          Uri = [string]$_.IntegrationUri
        }
      })
    RoutesSha256 = Get-CanonicalHash @($routeItems | Sort-Object RouteKey | ForEach-Object {
        [ordered]@{
          Id = [string]$_.RouteId; Key = [string]$_.RouteKey; Target = [string]$_.Target
          Authorization = [string]$_.AuthorizationType
          AuthorizerId = [string](Get-OptionalPropertyValue $_ "AuthorizerId")
          Scopes = @((Get-OptionalPropertyValue $_ "AuthorizationScopes") | Sort-Object)
        }
      })
    AuthorizerSha256 = $authorizerBoundary
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
        DispatchTarget = $expectedDispatchTarget
      }
      RuntimeBoundary = $RuntimeBoundary
      Mapping = [ordered]@{ Uuid = [string]$mapping.UUID; State = $expectedMappingState }
      Rules = $ruleStates
      Api = $apiBoundary
      Alarms = $alarms
      Queues = $queueDepths
      EcsServicesIdle = $true
      ReviewedStandaloneTasks = 0
      TemporalIdentitySha256 = Get-CanonicalHash @(
        [string]$workerEnvironment.TEMPORAL_ADDRESS,
        [string]$workerEnvironment.TEMPORAL_NAMESPACE
      )
    }
    ClusterArn = [string]$workerService.clusterArn
    WorkerTaskDefinitionArn = [string]$workerService.taskDefinition
    Subnets = $subnets
    SecurityGroups = $securityGroups
    AssignPublicIp = [string]$network.assignPublicIp
    TemporalAddress = [string]$workerEnvironment.TEMPORAL_ADDRESS
    TemporalNamespace = [string]$workerEnvironment.TEMPORAL_NAMESPACE
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
    throw "No reviewed $Environment legacy-drain context exists."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "The exact reviewed context checksum is required."
  }
  $hash = (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $ExpectedPlanSha256.ToLowerInvariant()) {
    throw "The $Environment legacy-drain context checksum differs from the reviewed checksum."
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  if (
    [string]$context.Schema -ne $expectedContextSchema -or
    [string]$context.Environment -ne $Environment -or [string]$context.Region -ne "us-east-2" -or
    [string]$context.RuntimeBoundary -ne $RuntimeBoundary -or
    [string]$context.RuntimeBoundary -notin @("PreCutover", "PostCutover") -or
    [int]$context.ExpectedPendingCount -lt $minimumPendingCount -or
    [int]$context.ExpectedPendingCount -gt $maximumPendingCount -or
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
    throw "The reviewed $Environment legacy-drain context is outside its safety contract."
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
    throw "The $Environment legacy runtime boundary changed after review."
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
      "--reason", "Reviewed bounded $Environment legacy Temporal drain completed or stopped"
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
        "logs", "get-log-events", "--log-group-name", $applicationLogGroup,
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
        throw "A reviewed $Environment legacy-drain context already exists."
      }
      $commit = Get-ReviewableSourceCommit
      $beforeRuntime = Get-LiveRuntime
      if (-not (Test-ZeroOpenTemporalWorkflows $beforeRuntime)) {
        throw "Staging Temporal must have zero running workflows before drain review."
      }
      $inspection = Get-OutboxInspection
      if (
        [int]$inspection.PendingCount -lt $minimumPendingCount -or
        [int]$inspection.PendingCount -gt $maximumPendingCount -or
        [int]$inspection.MaxAttempts -ne 0
      ) {
        throw "Review requires a nonempty untouched synthetic legacy outbox batch within the bounded drain limit."
      }
      $expectedPendingCount = [int]$inspection.PendingCount
      $afterRuntime = Get-LiveRuntime
      Assert-SameBoundary $beforeRuntime.Boundary $afterRuntime.Boundary
      $context = [ordered]@{
        Schema = $expectedContextSchema
        Environment = $Environment
        Region = $Region
        RuntimeBoundary = $RuntimeBoundary
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
        Environment = $Environment
        Action = "review"
        RuntimeBoundary = $RuntimeBoundary
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
        throw "The reviewed synthetic legacy aggregate changed before execution."
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
        Environment = $Environment
        Result = "passed"
        RuntimeBoundary = $RuntimeBoundary
        ReviewedLegacyRecords = [int]$context.ExpectedPendingCount
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
        "Refresh the $Environment IAM Identity Center session."
      if (
        (Get-Sha256Text ([string]$caller.Account)) -ne
          [string]$context.Boundary.AccountSha256
      ) {
        throw "Cleanup is not running in the reviewed $Environment account."
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
        Environment = $Environment
        Action = "cleanup"
        RuntimeBoundary = $RuntimeBoundary
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
