[CmdletBinding()]
param(
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidateRange(1, 24)]
  [int]$LookbackHours = 2,
  [ValidateRange(1, 30)]
  [int]$Attempts = 12,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\verify-development-tracing.ps1

Performs read-only, secret-safe checks of the deployed development tracing path. Run it after one
authenticated preference save has reached a succeeded operation. It verifies healthy fail-open
collector sidecars, exact X-Ray write permissions, and one trace containing the gateway, outbox
dispatch, and readiness activity spans without forbidden candidate or credential fields.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$expectedCollectorImage =
  "public.ecr.aws/aws-observability/aws-otel-collector@sha256:9b28046359054b414f4ba76056ba4e8cffda2d53fbcee06171d7eeecd71326c3"
$expectedGatewayHealthCommand = @(
  "CMD",
  "/nodejs/bin/node",
  "-e",
  "fetch('http://127.0.0.1:4000/health/live',{signal:AbortSignal.timeout(4000)}).then((response)=>process.exit(response.status===200?0:1)).catch(()=>process.exit(1))"
)
$expectedXrayActions = @("xray:PutTelemetryRecords", "xray:PutTraceSegments")
$forbiddenPatterns = @(
  "authorization",
  "bearer ",
  "targetroles",
  "locations",
  "resume",
  "password",
  "database_url",
  "temporal_api_key",
  "refresh_token",
  "access_token"
)

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' read failed. Refresh the development SSO session and retry."
  }
  return $raw | ConvertFrom-Json
}

function Get-ContainerEnvironment {
  param([object]$ContainerDefinition)

  $values = @{}
  foreach ($item in @($ContainerDefinition.environment)) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

function Get-RecentTraces {
  $end = (Get-Date).ToUniversalTime()
  $start = $end.AddHours(-$LookbackHours)
  $summaries = @(
    (
      Invoke-AwsJson @(
        "xray",
        "get-trace-summaries",
        "--start-time",
        $start.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        "--end-time",
        $end.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        "--no-sampling",
        "--output",
        "json"
      )
    ).TraceSummaries
  )
  $traceIds = @($summaries | Select-Object -First 25 | ForEach-Object { [string]$_.Id })
  $traces = @()
  for ($offset = 0; $offset -lt $traceIds.Count; $offset += 5) {
    $last = [Math]::Min($offset + 4, $traceIds.Count - 1)
    $batchIds = @($traceIds[$offset..$last])
    $traces += @(
      (
        Invoke-AwsJson (@("xray", "batch-get-traces", "--trace-ids") + $batchIds + @("--output", "json"))
      ).Traces
    )
  }
  return $traces
}

$identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
  throw "Use the temporary development IAM Identity Center session; long-lived callers are rejected."
}

$clusterArns = @(
  (Invoke-AwsJson @("ecs", "list-clusters", "--output", "json")).clusterArns |
    Where-Object { $_ -match "ai-job-apply-development" }
)
if ($clusterArns.Count -ne 1) {
  throw "The exact development ECS cluster is not available."
}
$clusterArn = [string]$clusterArns[0]
$services = @(
  (
    Invoke-AwsJson @(
      "ecs",
      "describe-services",
      "--cluster",
      $clusterArn,
      "--services",
      "gateway",
      "workflow-worker",
      "--output",
      "json"
    )
  ).services
)
if ($services.Count -ne 2) {
  throw "Both exact development application services must be available."
}

$taskRoleName = $null
$collectorCount = 0
foreach ($service in $services) {
  $primaryDeployment = @(
    $service.deployments | Where-Object { $_.status -eq "PRIMARY" }
  )
  if (
    [string]$service.status -ne "ACTIVE" -or
    [int]$service.desiredCount -ne 1 -or
    [int]$service.runningCount -ne 1 -or
    [int]$service.pendingCount -ne 0 -or
    $primaryDeployment.Count -ne 1 -or
    [string]$primaryDeployment[0].rolloutState -ne "COMPLETED"
  ) {
    throw "A development application service is not stable at the lean one-task baseline."
  }
  $taskDefinition = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$service.taskDefinition,
      "--output",
      "json"
    )
  ).taskDefinition
  $collector = @(
    $taskDefinition.containerDefinitions | Where-Object { $_.name -eq "otel-collector" }
  )
  if ($collector.Count -ne 1) {
    throw "A development task definition does not contain exactly one collector sidecar."
  }
  $collector = $collector[0]
  if (
    [string]$collector.image -ne $expectedCollectorImage -or
    [bool]$collector.essential -or
    -not [bool]$collector.readonlyRootFilesystem -or
    -not [bool]$collector.restartPolicy.enabled
  ) {
    throw "A collector sidecar does not match the reviewed immutable fail-open configuration."
  }
  $collectorHealthCommand = @(
    $collector.healthCheck.command | ForEach-Object { [string]$_ }
  )
  if (
    $collectorHealthCommand.Count -ne 2 -or
    $collectorHealthCommand[0] -ne "CMD" -or
    $collectorHealthCommand[1] -ne "/healthcheck"
  ) {
    throw "A collector sidecar does not invoke its bundled health-check binary directly."
  }
  $collectorEnvironment = Get-ContainerEnvironment $collector
  if (-not ([string]$collectorEnvironment["OTEL_CONFIG"]).Contains("awsxray")) {
    throw "A collector sidecar is not configured for the reviewed X-Ray exporter."
  }

  $applicationContainer = @(
    $taskDefinition.containerDefinitions |
      Where-Object { $_.name -eq "gateway" -or $_.name -eq "worker" }
  )
  if ($applicationContainer.Count -ne 1) {
    throw "A development task definition does not contain its exact application container."
  }
  $applicationEnvironment = Get-ContainerEnvironment $applicationContainer[0]
  if (
    [string]$applicationEnvironment["OTEL_EXPORTER_OTLP_ENDPOINT"] -ne
      "http://127.0.0.1:4318" -or
    [string]$applicationEnvironment["OTEL_TRACE_SAMPLE_RATIO"] -ne "1"
  ) {
    throw "A development application container does not use the reviewed local OTLP boundary."
  }
  if ([string]$applicationContainer[0].name -eq "gateway") {
    $gatewayHealthCommand = @(
      $applicationContainer[0].healthCheck.command | ForEach-Object { [string]$_ }
    )
    if (
      $gatewayHealthCommand.Count -ne $expectedGatewayHealthCommand.Count -or
      ($gatewayHealthCommand -join "`0") -ne ($expectedGatewayHealthCommand -join "`0")
    ) {
      throw "The gateway does not use the reviewed direct liveness health check."
    }
  }

  $roleName = ([string]$taskDefinition.taskRoleArn).Split("/")[-1]
  if ($taskRoleName -and $taskRoleName -ne $roleName) {
    throw "The development task definitions do not share the expected bounded application role."
  }
  $taskRoleName = $roleName

  $taskArns = @(
    (
      Invoke-AwsJson @(
        "ecs",
        "list-tasks",
        "--cluster",
        $clusterArn,
        "--service-name",
        [string]$service.serviceName,
        "--desired-status",
        "RUNNING",
        "--output",
        "json"
      )
    ).taskArns
  )
  if ($taskArns.Count -ne 1) {
    throw "A development service does not have exactly one running task."
  }
  $runningTask = (
    Invoke-AwsJson @(
      "ecs",
      "describe-tasks",
      "--cluster",
      $clusterArn,
      "--tasks",
      [string]$taskArns[0],
      "--output",
      "json"
    )
  ).tasks[0]
  $runningCollector = @(
    $runningTask.containers | Where-Object { $_.name -eq "otel-collector" }
  )
  if (
    $runningCollector.Count -ne 1 -or
    [string]$runningCollector[0].lastStatus -ne "RUNNING" -or
    [string]$runningCollector[0].healthStatus -ne "HEALTHY"
  ) {
    throw "A deployed collector sidecar is not running and healthy."
  }
  if (
    [string]$service.serviceName -eq "gateway" -and
    [string]$runningTask.healthStatus -ne "HEALTHY"
  ) {
    throw "The deployed gateway task is not healthy."
  }
  if ([string]$service.serviceName -eq "gateway") {
    $serviceRegistries = @($service.serviceRegistries)
    if ($serviceRegistries.Count -ne 1) {
      throw "The gateway does not have exactly one Cloud Map service registry."
    }
    $registryArn = [string]$serviceRegistries[0].registryArn
    $cloudMapServiceId = $registryArn.Split("/")[-1]
    $cloudMapInstances = @(
      (
        Invoke-AwsJson @(
          "servicediscovery",
          "list-instances",
          "--service-id",
          $cloudMapServiceId,
          "--output",
          "json"
        )
      ).Instances
    )
    $cloudMapHealth = (
      Invoke-AwsJson @(
        "servicediscovery",
        "get-instances-health-status",
        "--service-id",
        $cloudMapServiceId,
        "--output",
        "json"
      )
    ).Status
    $healthyCloudMapInstances = @(
      $cloudMapHealth.PSObject.Properties | Where-Object { [string]$_.Value -eq "HEALTHY" }
    )
    if (
      $cloudMapInstances.Count -ne 1 -or
      $healthyCloudMapInstances.Count -ne 1 -or
      [string]::IsNullOrWhiteSpace(
        [string]$cloudMapInstances[0].Attributes.AWS_INSTANCE_IPV4
      ) -or
      [string]::IsNullOrWhiteSpace(
        [string]$cloudMapInstances[0].Attributes.AWS_INSTANCE_PORT
      )
    ) {
      throw "Cloud Map does not contain one healthy gateway instance with IPv4 and port."
    }
  }
  $collectorCount += 1
}

$rolePolicy = (
  Invoke-AwsJson @(
    "iam",
    "get-role-policy",
    "--role-name",
    $taskRoleName,
    "--policy-name",
    "write-application-traces",
    "--output",
    "json"
  )
).PolicyDocument
$actualActions = @(
  @($rolePolicy.Statement)[0].Action | ForEach-Object { [string]$_ } | Sort-Object -Unique
)
if (
  (Compare-Object ($expectedXrayActions | Sort-Object) $actualActions).Count -ne 0 -or
  [string]@($rolePolicy.Statement)[0].Resource -ne "*"
) {
  throw "The bounded application role does not contain only the reviewed X-Ray write actions."
}

$pipelineTraceFound = $false
$tracesExamined = 0
for ($attempt = 1; $attempt -le $Attempts -and -not $pipelineTraceFound; $attempt += 1) {
  $traces = @(Get-RecentTraces)
  $tracesExamined = $traces.Count
  foreach ($candidateTrace in $traces) {
    $documents = @($candidateTrace.Segments | ForEach-Object { [string]$_.Document })
    $corpus = ($documents -join "`n").ToLowerInvariant()
    foreach ($pattern in $forbiddenPatterns) {
      if ($corpus.Contains($pattern)) {
        throw "A recent trace contains a forbidden candidate or credential field."
      }
    }
    if (
      $corpus -match '"name"\s*:\s*"gateway"' -and
      $corpus -match '"name"\s*:\s*"outbox\.dispatch"' -and
      $corpus -match '"name"\s*:\s*"profile-readiness\.mark-running"' -and
      $corpus -match '"name"\s*:\s*"profile-readiness\.calculate-and-persist"'
    ) {
      $pipelineTraceFound = $true
      break
    }
  }
  if (-not $pipelineTraceFound -and $attempt -lt $Attempts) {
    Start-Sleep -Seconds 10
  }
}

if (-not $pipelineTraceFound) {
  throw "No complete recent pipeline trace was found. Save preferences once, wait for succeeded, and retry."
}

[pscustomobject]@{
  ServicesVerified        = 2
  HealthyCollectorSidecars = $collectorCount
  XrayWriteActions         = $actualActions.Count
  TracesExamined           = $tracesExamined
  CompletePipelineTrace    = $pipelineTraceFound
  ForbiddenPatternMatches  = 0
} | ConvertTo-Json
