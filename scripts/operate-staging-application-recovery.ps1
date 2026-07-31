[CmdletBinding()]
param(
  [ValidateSet("Status", "Restart", "PlanDisable", "ApplyDisable", "PlanEnable", "ApplyEnable", "Cleanup")]
  [string]$Action = "Status",
  [string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-application-recovery.ps1 -Action Status
  .\scripts\operate-staging-application-recovery.ps1 -Action Restart -Execute
  .\scripts\operate-staging-application-recovery.ps1 -Action PlanDisable
  .\scripts\operate-staging-application-recovery.ps1 -Action ApplyDisable `
    -ExpectedPlanSha256 <SHA256> -Execute
  .\scripts\operate-staging-application-recovery.ps1 -Action PlanEnable
  .\scripts\operate-staging-application-recovery.ps1 -Action ApplyEnable `
    -ExpectedPlanSha256 <SHA256> -Execute
  .\scripts\operate-staging-application-recovery.ps1 -Action Cleanup -Execute

Status is read-only. Restart forces a worker rolling deployment followed by a gateway rolling
deployment while retaining the exact task definitions. PlanDisable captures the exact live
configuration in the ignored Terraform data directory and creates a refresh-backed, strictly
allowlisted application-only disable plan. ApplyDisable accepts only the checksum-matched saved
plan. PlanEnable creates the exact reverse plan from the captured configuration; ApplyEnable
accepts only that checksum-matched plan. Cleanup removes only this script's ignored local recovery
artifacts after successful re-enablement.

Restart, ApplyDisable, ApplyEnable, and Cleanup require -Execute. This script never destroys RDS,
KMS, S3, SQS/DLQ, ECR, Secrets Manager containers, networking, state, or migration history.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 staging environment is restricted to us-east-2."
}

$environmentDirectory = (Resolve-Path "infrastructure/terraform/environments/staging").Path
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform"
$contextPath = Join-Path $terraformDataDirectory "applydash-staging-recovery-context.json"
$disablePlanPath = Join-Path $terraformDataDirectory "applydash-staging-disable.tfplan"
$enablePlanPath = Join-Path $terraformDataDirectory "applydash-staging-enable.tfplan"
$disablePlanRelativePath = ".terraform/applydash-staging-disable.tfplan"
$enablePlanRelativePath = ".terraform/applydash-staging-enable.tfplan"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' operation failed. Refresh the staging SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Assert-TemporaryStagingCaller {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary staging IAM Identity Center session; long-lived callers are rejected."
  }
}

function Assert-TerraformVersion {
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required for this recovery procedure."
  }
}

function Get-StagingClusterArn {
  $clusters = @(
    (Invoke-AwsJson @("ecs", "list-clusters", "--output", "json")).clusterArns |
      Where-Object { $_ -match "ai-job-apply-staging" }
  )
  if ($clusters.Count -ne 1) {
    throw "The exact staging ECS cluster is not available."
  }
  return [string]$clusters[0]
}

function Get-ApplicationServices {
  param(
    [string]$ClusterArn,
    [bool]$RequireEnabled
  )

  $listed = @(
    (Invoke-AwsJson @(
      "ecs", "list-services", "--cluster", $ClusterArn, "--output", "json"
    )).serviceArns
  )

  if (-not $RequireEnabled) {
    if ($listed.Count -ne 0) {
      throw "The applications-disabled posture must contain zero ECS services."
    }
    return @()
  }

  if ($listed.Count -ne 2) {
    throw "The applications-enabled posture must contain exactly two ECS services."
  }

  $arguments = @("ecs", "describe-services", "--cluster", $ClusterArn, "--services") +
    $listed + @("--output", "json")
  $services = @((Invoke-AwsJson $arguments).services)
  $gateway = @($services | Where-Object { $_.serviceName -eq "gateway" })
  $worker = @($services | Where-Object { $_.serviceName -eq "workflow-worker" })
  if ($gateway.Count -ne 1 -or $worker.Count -ne 1) {
    throw "The exact gateway and workflow-worker services are required."
  }
  return @($gateway[0], $worker[0])
}

function Assert-ServiceStable {
  param([object]$Service)

  $primary = @($Service.deployments | Where-Object { $_.status -eq "PRIMARY" })
  if (
    [string]$Service.status -ne "ACTIVE" -or
    [int]$Service.desiredCount -ne 1 -or
    [int]$Service.runningCount -ne 1 -or
    [int]$Service.pendingCount -ne 0 -or
    [int]$Service.deploymentConfiguration.minimumHealthyPercent -ne 100 -or
    [int]$Service.deploymentConfiguration.maximumPercent -ne 200 -or
    $primary.Count -ne 1 -or
    [string]$primary[0].rolloutState -ne "COMPLETED" -or
    @($Service.deployments).Count -ne 1
  ) {
    throw "Service '$($Service.serviceName)' is not at the reviewed stable 1/1/0 rolling baseline."
  }
}

function Get-ContainerEnvironment {
  param([object]$ContainerDefinition)

  $values = @{}
  foreach ($item in @($ContainerDefinition.environment)) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

function Get-TaskDefinition {
  param([string]$TaskDefinitionArn)

  return (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      $TaskDefinitionArn,
      "--output",
      "json"
    )
  ).taskDefinition
}

function Get-RequiredContainer {
  param(
    [object]$TaskDefinition,
    [string]$Name
  )

  $containers = @($TaskDefinition.containerDefinitions | Where-Object { $_.name -eq $Name })
  if ($containers.Count -ne 1) {
    throw "Task definition does not contain the exact '$Name' container."
  }
  return $containers[0]
}

function Get-LiveRecoveryContext {
  param(
    [string]$ClusterArn,
    [object[]]$Services
  )

  $gatewayService = @($Services | Where-Object { $_.serviceName -eq "gateway" })[0]
  $workerService = @($Services | Where-Object { $_.serviceName -eq "workflow-worker" })[0]
  Assert-ServiceStable $gatewayService
  Assert-ServiceStable $workerService

  $gatewayTask = Get-TaskDefinition ([string]$gatewayService.taskDefinition)
  $workerTask = Get-TaskDefinition ([string]$workerService.taskDefinition)
  $gatewayContainer = Get-RequiredContainer $gatewayTask "gateway"
  $workerContainer = Get-RequiredContainer $workerTask "worker"
  $gatewayEnvironment = Get-ContainerEnvironment $gatewayContainer
  $workerEnvironment = Get-ContainerEnvironment $workerContainer

  $migrationTaskArn = & terraform "-chdir=$environmentDirectory" output -raw `
    migration_task_definition_arn 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $migrationTaskArn) {
    throw "The initialized staging state did not expose the migration task definition."
  }
  $migrationTask = Get-TaskDefinition ([string]$migrationTaskArn)
  $migrationContainer = Get-RequiredContainer $migrationTask "database-migration"

  $databases = @(
    (Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")).DBInstances |
      Where-Object { $_.DBInstanceIdentifier -eq "ai-job-apply-staging" }
  )
  if ($databases.Count -ne 1) {
    throw "The exact staging database is not available."
  }
  $database = $databases[0]

  $cluster = (
    Invoke-AwsJson @(
      "ecs", "describe-clusters", "--clusters", $ClusterArn, "--output", "json"
    )
  ).clusters[0]
  $containerInsights = @(
    $cluster.settings | Where-Object {
      $_.name -eq "containerInsights" -and $_.value -eq "enabled"
    }
  ).Count -gt 0

  $requiredValues = @(
    [string]$gatewayContainer.image,
    [string]$workerContainer.image,
    [string]$migrationContainer.image,
    [string]$gatewayEnvironment["OIDC_ISSUER"],
    [string]$gatewayEnvironment["OIDC_AUDIENCE"],
    [string]$workerEnvironment["TEMPORAL_ADDRESS"],
    [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
  )
  if (@($requiredValues | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) {
    throw "The live staging application configuration is incomplete."
  }
  if (
    [string]$gatewayEnvironment["TEMPORAL_ADDRESS"] -ne
      [string]$workerEnvironment["TEMPORAL_ADDRESS"] -or
    [string]$gatewayEnvironment["TEMPORAL_NAMESPACE"] -ne
      [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
  ) {
    throw "Gateway and worker Temporal configuration do not match."
  }

  return [ordered]@{
    gateway_image                        = [string]$gatewayContainer.image
    worker_image                         = [string]$workerContainer.image
    migration_image                      = [string]$migrationContainer.image
    gateway_desired_count                = [int]$gatewayService.desiredCount
    gateway_cpu                          = [int]$gatewayTask.cpu
    gateway_memory                       = [int]$gatewayTask.memory
    worker_desired_count                 = [int]$workerService.desiredCount
    worker_cpu                           = [int]$workerTask.cpu
    worker_memory                        = [int]$workerTask.memory
    high_availability                    = [bool]$database.MultiAZ
    private_application_networking       = (
      [string]$gatewayService.networkConfiguration.awsvpcConfiguration.assignPublicIp -ne
        "ENABLED"
    )
    enable_redis                         = $false
    database_instance_class              = [string]$database.DBInstanceClass
    database_engine_version              = [string]$database.EngineVersion
    database_performance_insights        = [bool]$database.PerformanceInsightsEnabled
    enable_container_insights            = [bool]$containerInsights
    oidc_issuer                          = [string]$gatewayEnvironment["OIDC_ISSUER"]
    oidc_audience                        = [string]$gatewayEnvironment["OIDC_AUDIENCE"]
    temporal_address                     = [string]$workerEnvironment["TEMPORAL_ADDRESS"]
    temporal_namespace                   = [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
    gateway_task_definition              = [string]$gatewayService.taskDefinition
    worker_task_definition               = [string]$workerService.taskDefinition
    disable_plan_sha256                  = ""
    enable_plan_sha256                   = ""
  }
}

function Save-RecoveryContext {
  param([object]$Context)

  if (-not (Test-Path -LiteralPath $terraformDataDirectory)) {
    throw "The staging Terraform backend must already be initialized."
  }
  $Context | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $contextPath -Encoding UTF8
}

function Get-RecoveryContext {
  if (-not (Test-Path -LiteralPath $contextPath)) {
    throw "The ignored recovery context is absent. Run PlanDisable while applications are enabled."
  }
  return Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
}

function Set-TerraformVariables {
  param(
    [object]$Context,
    [bool]$DeployApplications
  )

  $env:TF_VAR_gateway_image = [string]$Context.gateway_image
  $env:TF_VAR_worker_image = [string]$Context.worker_image
  $env:TF_VAR_migration_image = [string]$Context.migration_image
  $env:TF_VAR_gateway_desired_count = [string]$Context.gateway_desired_count
  $env:TF_VAR_gateway_cpu = [string]$Context.gateway_cpu
  $env:TF_VAR_gateway_memory = [string]$Context.gateway_memory
  $env:TF_VAR_worker_desired_count = [string]$Context.worker_desired_count
  $env:TF_VAR_worker_cpu = [string]$Context.worker_cpu
  $env:TF_VAR_worker_memory = [string]$Context.worker_memory
  $env:TF_VAR_high_availability = ([bool]$Context.high_availability).ToString().ToLowerInvariant()
  $env:TF_VAR_private_application_networking = (
    [bool]$Context.private_application_networking
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_enable_redis = ([bool]$Context.enable_redis).ToString().ToLowerInvariant()
  $env:TF_VAR_database_instance_class = [string]$Context.database_instance_class
  $env:TF_VAR_database_engine_version = [string]$Context.database_engine_version
  $env:TF_VAR_database_performance_insights = (
    [bool]$Context.database_performance_insights
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_enable_container_insights = (
    [bool]$Context.enable_container_insights
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_oidc_issuer = [string]$Context.oidc_issuer
  $env:TF_VAR_oidc_audience = [string]$Context.oidc_audience
  $env:TF_VAR_temporal_address = [string]$Context.temporal_address
  $env:TF_VAR_temporal_namespace = [string]$Context.temporal_namespace
  $env:TF_VAR_deploy_applications = $DeployApplications.ToString().ToLowerInvariant()
}

function Get-AllowedApplicationChanges {
  param([string]$Direction)

  $applicationResources = @(
    "module.platform.aws_apigatewayv2_api.gateway[0]",
    "module.platform.aws_apigatewayv2_integration.gateway[0]",
    "module.platform.aws_apigatewayv2_route.gateway[0]",
    "module.platform.aws_apigatewayv2_stage.gateway[0]",
    "module.platform.aws_apigatewayv2_vpc_link.gateway[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.gateway_log_heartbeat[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.worker_log_heartbeat[0]",
    "module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
    "module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]",
    "module.platform.aws_ecs_service.gateway[0]",
    "module.platform.aws_ecs_service.worker[0]",
    "module.platform.aws_ecs_task_definition.gateway[0]",
    "module.platform.aws_ecs_task_definition.worker[0]",
    "module.platform.aws_iam_role_policy.application_tracing[0]",
    "module.platform.aws_service_discovery_private_dns_namespace.application[0]",
    "module.platform.aws_service_discovery_service.gateway[0]"
  )
  $action = if ($Direction -eq "Disable") { "delete" } else { "create" }
  $allowed = @{}
  foreach ($address in $applicationResources) {
    $allowed[$address] = $action
  }
  $allowed["module.platform.aws_cloudwatch_dashboard.operations"] = "update"
  return $allowed
}

function Test-SavedPlan {
  param(
    [string]$PlanRelativePath,
    [string]$Direction
  )

  $showErrorPath = Join-Path ([IO.Path]::GetTempPath()) `
    "applydash-staging-recovery-show-$PID.stderr"
  try {
    $planJson = & terraform "-chdir=$environmentDirectory" show -json `
      $PlanRelativePath 2> $showErrorPath
    if ($LASTEXITCODE -ne 0) {
      $detail = (Get-Content -LiteralPath $showErrorPath -Raw).Trim()
      if (-not $detail) {
        $detail = "Terraform did not provide an error message."
      }
      throw "The saved $Direction plan could not be inspected: $detail"
    }
    $plan = $planJson | ConvertFrom-Json
    $allowed = Get-AllowedApplicationChanges $Direction
    $changes = @()
    foreach ($resourceChange in @($plan.resource_changes)) {
      $actions = @($resourceChange.change.actions)
      if ($actions -contains "no-op" -or $actions -contains "read") {
        continue
      }
      $normalizedAction = $actions -join ","
      $expectedAction = $allowed[[string]$resourceChange.address]
      if (-not $expectedAction -or $expectedAction -ne $normalizedAction) {
        throw "The $Direction plan contains an action outside the application-only allowlist."
      }
      $changes += [pscustomobject]@{
        Address = [string]$resourceChange.address
        Action  = $normalizedAction
      }
    }
    if ($changes.Count -ne $allowed.Count) {
      throw "The $Direction plan does not contain the complete 16-resource application boundary."
    }
    return $changes
  }
  finally {
    if (Test-Path -LiteralPath $showErrorPath) {
      Remove-Item -LiteralPath $showErrorPath -Force
    }
  }
}

function New-RecoveryPlan {
  param(
    [object]$Context,
    [string]$Direction,
    [string]$PlanPath,
    [string]$PlanRelativePath
  )

  if (Test-Path -LiteralPath $PlanPath) {
    throw "A saved $Direction plan already exists. Complete or clean up the current drill first."
  }
  Set-TerraformVariables $Context ($Direction -eq "Enable")
  $null = & terraform "-chdir=$environmentDirectory" plan `
    -input=false `
    -lock-timeout=5m `
    "-out=$PlanRelativePath" `
    -detailed-exitcode 2>$null
  if ($LASTEXITCODE -ne 2) {
    throw "The refresh-backed $Direction plan did not produce the expected change-only result."
  }
  $changes = Test-SavedPlan $PlanRelativePath $Direction
  $hash = (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash
  return [pscustomobject]@{
    Direction    = $Direction
    PlanSha256   = $hash
    Creates      = @($changes | Where-Object { $_.Action -eq "create" }).Count
    Updates      = @($changes | Where-Object { $_.Action -eq "update" }).Count
    Deletes      = @($changes | Where-Object { $_.Action -eq "delete" }).Count
    Replacements = @($changes | Where-Object { $_.Action -match "," }).Count
  }
}

function Assert-ExpectedPlan {
  param(
    [string]$PlanPath,
    [string]$PlanRelativePath,
    [string]$Direction,
    [string]$ExpectedHash,
    [string]$RecordedHash
  )

  if (-not $Execute) {
    throw "$Direction apply requires -Execute."
  }
  if ($ExpectedHash -notmatch "^[A-Fa-f0-9]{64}$") {
    throw "$Direction apply requires the reviewed 64-character -ExpectedPlanSha256."
  }
  if (-not (Test-Path -LiteralPath $PlanPath)) {
    throw "The saved $Direction plan is absent."
  }
  $actualHash = (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash
  if (
    $actualHash -ne $ExpectedHash.ToUpperInvariant() -or
    $actualHash -ne ([string]$RecordedHash).ToUpperInvariant()
  ) {
    throw "The saved $Direction plan checksum does not match both approvals."
  }
  $null = Test-SavedPlan $PlanRelativePath $Direction
}

function Invoke-TerraformNoDrift {
  param(
    [object]$Context,
    [bool]$DeployApplications
  )

  Set-TerraformVariables $Context $DeployApplications
  $null = & terraform "-chdir=$environmentDirectory" plan `
    -input=false `
    -lock-timeout=5m `
    -detailed-exitcode 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The final refresh-backed Terraform plan reported drift or failed."
  }
}

function Get-HttpStatus {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 20
    return [int]$response.StatusCode
  }
  catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Get-GatewayUrl {
  $gatewayUrl = & terraform "-chdir=$environmentDirectory" output -raw gateway_url 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $gatewayUrl) {
    throw "The enabled staging state did not expose the gateway URL."
  }
  return [string]$gatewayUrl
}

function Assert-GatewayHealth {
  param([string]$GatewayUrl)

  $liveStatus = Get-HttpStatus "$GatewayUrl/health/live"
  $readyStatus = Get-HttpStatus "$GatewayUrl/health/ready"
  $protectedStatus = Get-HttpStatus "$GatewayUrl/v1/me"
  if ($liveStatus -ne 200 -or $readyStatus -ne 200 -or $protectedStatus -ne 401) {
    throw "Gateway acceptance failed; expected live=200, ready=200, protected=401."
  }
}

function Wait-ControlledDeployment {
  param(
    [string]$ClusterArn,
    [string]$ServiceName,
    [string]$OriginalTaskDefinition,
    [string]$GatewayUrl
  )

  $deadline = (Get-Date).AddMinutes(12)
  do {
    Start-Sleep -Seconds 10
    if ((Get-HttpStatus "$GatewayUrl/health/live") -ne 200) {
      throw "Gateway liveness failed during the controlled '$ServiceName' restart."
    }
    $service = @(
      (
        Invoke-AwsJson @(
          "ecs",
          "describe-services",
          "--cluster",
          $ClusterArn,
          "--services",
          $ServiceName,
          "--output",
          "json"
        )
      ).services
    )[0]
    if ([string]$service.taskDefinition -ne $OriginalTaskDefinition) {
      throw "The '$ServiceName' restart changed its task definition."
    }
    $primary = @($service.deployments | Where-Object { $_.status -eq "PRIMARY" })
    $stable = (
      [int]$service.desiredCount -eq 1 -and
      [int]$service.runningCount -eq 1 -and
      [int]$service.pendingCount -eq 0 -and
      $primary.Count -eq 1 -and
      [string]$primary[0].rolloutState -eq "COMPLETED" -and
      @($service.deployments).Count -eq 1
    )
    if ($stable) {
      return $service
    }
  } while ((Get-Date) -lt $deadline)
  throw "The '$ServiceName' restart did not converge within 12 minutes."
}

function Invoke-ControlledRestart {
  param(
    [string]$ClusterArn,
    [object[]]$Services,
    [object]$Context
  )

  if (-not $Execute) {
    throw "Restart requires -Execute."
  }
  $gatewayUrl = Get-GatewayUrl
  Assert-GatewayHealth $gatewayUrl

  $results = @()
  foreach ($serviceName in @("workflow-worker", "gateway")) {
    $service = @($Services | Where-Object { $_.serviceName -eq $serviceName })[0]
    $beforeTasks = @(
      (
        Invoke-AwsJson @(
          "ecs",
          "list-tasks",
          "--cluster",
          $ClusterArn,
          "--service-name",
          $serviceName,
          "--desired-status",
          "RUNNING",
          "--output",
          "json"
        )
      ).taskArns
    )
    if ($beforeTasks.Count -ne 1) {
      throw "The '$serviceName' service must start with exactly one running task."
    }
    $null = Invoke-AwsJson @(
      "ecs",
      "update-service",
      "--cluster",
      $ClusterArn,
      "--service",
      $serviceName,
      "--force-new-deployment",
      "--output",
      "json"
    )
    $stableService = Wait-ControlledDeployment `
      $ClusterArn $serviceName ([string]$service.taskDefinition) $gatewayUrl
    $afterTasks = @(
      (
        Invoke-AwsJson @(
          "ecs",
          "list-tasks",
          "--cluster",
          $ClusterArn,
          "--service-name",
          $serviceName,
          "--desired-status",
          "RUNNING",
          "--output",
          "json"
        )
      ).taskArns
    )
    if (
      $afterTasks.Count -ne 1 -or
      [string]$afterTasks[0] -eq [string]$beforeTasks[0]
    ) {
      throw "The '$serviceName' rolling restart did not replace exactly one running task."
    }
    Assert-ServiceStable $stableService
    Assert-GatewayHealth $gatewayUrl
    $results += [pscustomobject]@{
      Service             = $serviceName
      TaskReplaced        = $true
      TaskDefinitionKept  = $true
      StableDesired       = 1
      StableRunning       = 1
      StablePending       = 0
    }
  }
  Invoke-TerraformNoDrift $Context $true
  return $results
}

function Assert-ApplicationsDisabled {
  param([string]$ClusterArn)

  $null = Get-ApplicationServices $ClusterArn $false
  $runningTasks = @(
    (
      Invoke-AwsJson @(
        "ecs",
        "list-tasks",
        "--cluster",
        $ClusterArn,
        "--desired-status",
        "RUNNING",
        "--output",
        "json"
      )
    ).taskArns
  )
  if ($runningTasks.Count -ne 0) {
    throw "The applications-disabled posture must contain zero running ECS tasks."
  }
  $apis = @(
    (Invoke-AwsJson @("apigatewayv2", "get-apis", "--output", "json")).Items |
      Where-Object { $_.Name -eq "ai-job-apply-staging-gateway" }
  )
  if ($apis.Count -ne 0) {
    throw "The applications-disabled posture must contain zero platform gateway APIs."
  }
  $namespaces = @(
    (Invoke-AwsJson @("servicediscovery", "list-namespaces", "--output", "json")).Namespaces |
      Where-Object { $_.Name -eq "ai-job-apply-staging.internal" }
  )
  if ($namespaces.Count -ne 0) {
    throw "The applications-disabled posture must contain zero platform Cloud Map namespaces."
  }
}

Assert-TemporaryStagingCaller
Assert-TerraformVersion
$clusterArn = Get-StagingClusterArn

switch ($Action) {
  "Status" {
    $serviceArns = @(
      (
        Invoke-AwsJson @(
          "ecs", "list-services", "--cluster", $clusterArn, "--output", "json"
        )
      ).serviceArns
    )
    if ($serviceArns.Count -eq 0) {
      Assert-ApplicationsDisabled $clusterArn
      [pscustomobject]@{
        Environment       = "staging"
        Applications      = "disabled"
        Services          = 0
        RunningTasks      = 0
        RecoveryContext   = Test-Path -LiteralPath $contextPath
        DisablePlan       = Test-Path -LiteralPath $disablePlanPath
        EnablePlan        = Test-Path -LiteralPath $enablePlanPath
      } | ConvertTo-Json
      break
    }
    $services = Get-ApplicationServices $clusterArn $true
    foreach ($service in $services) {
      Assert-ServiceStable $service
    }
    $gatewayUrl = Get-GatewayUrl
    Assert-GatewayHealth $gatewayUrl
    [pscustomobject]@{
      Environment       = "staging"
      Applications      = "enabled"
      Services          = 2
      StableServices    = 2
      LiveStatus        = 200
      ReadyStatus       = 200
      ProtectedStatus   = 401
      RecoveryContext   = Test-Path -LiteralPath $contextPath
      DisablePlan       = Test-Path -LiteralPath $disablePlanPath
      EnablePlan        = Test-Path -LiteralPath $enablePlanPath
    } | ConvertTo-Json
  }
  "Restart" {
    $services = Get-ApplicationServices $clusterArn $true
    $context = Get-LiveRecoveryContext $clusterArn $services
    $results = Invoke-ControlledRestart $clusterArn $services $context
    [pscustomobject]@{
      Environment     = "staging"
      Restarted       = $results
      GatewayLive     = 200
      GatewayReady    = 200
      ProtectedRoute  = 401
      TerraformDrift  = 0
    } | ConvertTo-Json -Depth 5
  }
  "PlanDisable" {
    if (Test-Path -LiteralPath $contextPath) {
      throw "A recovery context already exists. Complete or clean up the current drill first."
    }
    $services = Get-ApplicationServices $clusterArn $true
    $context = Get-LiveRecoveryContext $clusterArn $services
    Save-RecoveryContext $context
    try {
      $summary = New-RecoveryPlan `
        $context "Disable" $disablePlanPath $disablePlanRelativePath
      $context.disable_plan_sha256 = $summary.PlanSha256
      Save-RecoveryContext $context
      $summary | ConvertTo-Json
    }
    catch {
      if (Test-Path -LiteralPath $disablePlanPath) {
        Remove-Item -LiteralPath $disablePlanPath -Force
      }
      if (Test-Path -LiteralPath $contextPath) {
        Remove-Item -LiteralPath $contextPath -Force
      }
      throw
    }
  }
  "ApplyDisable" {
    $services = Get-ApplicationServices $clusterArn $true
    foreach ($service in $services) {
      Assert-ServiceStable $service
    }
    $context = Get-RecoveryContext
    Assert-ExpectedPlan `
      $disablePlanPath $disablePlanRelativePath "Disable" `
      $ExpectedPlanSha256 ([string]$context.disable_plan_sha256)
    $null = & terraform "-chdir=$environmentDirectory" apply `
      -input=false `
      -lock-timeout=5m `
      $disablePlanRelativePath
    if ($LASTEXITCODE -ne 0) {
      throw "The exact reviewed application-disable plan failed to apply."
    }
    Assert-ApplicationsDisabled $clusterArn
    Invoke-TerraformNoDrift $context $false
    [pscustomobject]@{
      Environment       = "staging"
      Applications      = "disabled"
      DeletedResources  = 16
      DashboardUpdates  = 1
      Services          = 0
      RunningTasks      = 0
      GatewayApis       = 0
      CloudMapNamespaces = 0
      TerraformDrift    = 0
    } | ConvertTo-Json
  }
  "PlanEnable" {
    Assert-ApplicationsDisabled $clusterArn
    $context = Get-RecoveryContext
    if (Test-Path -LiteralPath $enablePlanPath) {
      throw "A saved Enable plan already exists."
    }
    $summary = New-RecoveryPlan `
      $context "Enable" $enablePlanPath $enablePlanRelativePath
    $context.enable_plan_sha256 = $summary.PlanSha256
    Save-RecoveryContext $context
    $summary | ConvertTo-Json
  }
  "ApplyEnable" {
    Assert-ApplicationsDisabled $clusterArn
    $context = Get-RecoveryContext
    Assert-ExpectedPlan `
      $enablePlanPath $enablePlanRelativePath "Enable" `
      $ExpectedPlanSha256 ([string]$context.enable_plan_sha256)
    $null = & terraform "-chdir=$environmentDirectory" apply `
      -input=false `
      -lock-timeout=5m `
      $enablePlanRelativePath
    if ($LASTEXITCODE -ne 0) {
      throw "The exact reviewed application-enable plan failed to apply."
    }
    $null = & aws ecs wait services-stable `
      --cluster $clusterArn `
      --services gateway workflow-worker 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "The re-enabled staging services did not stabilize."
    }
    $services = Get-ApplicationServices $clusterArn $true
    foreach ($service in $services) {
      Assert-ServiceStable $service
    }
    $gatewayUrl = Get-GatewayUrl
    Assert-GatewayHealth $gatewayUrl
    Invoke-TerraformNoDrift $context $true
    [pscustomobject]@{
      Environment       = "staging"
      Applications      = "enabled"
      CreatedResources  = 16
      DashboardUpdates  = 1
      StableServices    = 2
      GatewayLive       = 200
      GatewayReady      = 200
      ProtectedRoute    = 401
      TerraformDrift    = 0
    } | ConvertTo-Json
  }
  "Cleanup" {
    if (-not $Execute) {
      throw "Cleanup requires -Execute."
    }
    $services = Get-ApplicationServices $clusterArn $true
    foreach ($service in $services) {
      Assert-ServiceStable $service
    }
    $context = Get-RecoveryContext
    Invoke-TerraformNoDrift $context $true
    $resolvedDataDirectory = [IO.Path]::GetFullPath($terraformDataDirectory)
    $removed = 0
    foreach ($path in @($disablePlanPath, $enablePlanPath, $contextPath)) {
      if (Test-Path -LiteralPath $path) {
        $resolvedPath = [IO.Path]::GetFullPath($path)
        if (-not $resolvedPath.StartsWith(
          $resolvedDataDirectory,
          [StringComparison]::OrdinalIgnoreCase
        )) {
          throw "Refusing to remove a recovery artifact outside the Terraform data directory."
        }
        Remove-Item -LiteralPath $resolvedPath -Force
        $removed += 1
      }
    }
    [pscustomobject]@{
      Environment      = "staging"
      Applications     = "enabled"
      TerraformDrift   = 0
      ArtifactsRemoved = $removed
    } | ConvertTo-Json
  }
}
