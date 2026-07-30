[CmdletBinding()]
param(
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\preview-development-alert-plan.ps1

Creates a refresh-backed, preview-only development Terraform plan using the exact live application
configuration. It rejects any action outside the reviewed alert-delivery scope, prints only a
sanitized change summary and plan hash, and always removes the sensitive plan artifact.

The development backend must already be initialized. This script never applies infrastructure.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

$environmentDirectory = Resolve-Path "infrastructure/terraform/environments/development"
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region

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
  foreach ($item in $ContainerDefinition.environment) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

$identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
  throw "Use the temporary development IAM Identity Center session; long-lived callers are rejected."
}

$clusterResult = Invoke-AwsJson @("ecs", "list-clusters", "--output", "json")
$clusterArns = @(
  $clusterResult.clusterArns | Where-Object { $_ -match "ai-job-apply-development" }
)
if ($clusterArns.Count -ne 1) {
  throw "The exact development ECS cluster is not available."
}
$clusterArn = [string]$clusterArns[0]

$serviceResult = Invoke-AwsJson @("ecs", "list-services", "--cluster", $clusterArn, "--output", "json")
$serviceArns = @($serviceResult.serviceArns)
$describeServiceArguments = @(
  "ecs",
  "describe-services",
  "--cluster",
  $clusterArn,
  "--services"
) + $serviceArns + @("--output", "json")
$services = @(
  (
    Invoke-AwsJson $describeServiceArguments
  ).services
)
$gatewayService = @($services | Where-Object { $_.serviceName -eq "gateway" })
$workerService = @($services | Where-Object { $_.serviceName -eq "workflow-worker" })
if ($gatewayService.Count -ne 1 -or $workerService.Count -ne 1) {
  throw "Both exact development application services must be available."
}
$gatewayService = $gatewayService[0]
$workerService = $workerService[0]

$gatewayTask = (
  Invoke-AwsJson @(
    "ecs",
    "describe-task-definition",
    "--task-definition",
    [string]$gatewayService.taskDefinition,
    "--output",
    "json"
  )
).taskDefinition
$workerTask = (
  Invoke-AwsJson @(
    "ecs",
    "describe-task-definition",
    "--task-definition",
    [string]$workerService.taskDefinition,
    "--output",
    "json"
  )
).taskDefinition
$gatewayContainer = @($gatewayTask.containerDefinitions | Where-Object { $_.name -eq "gateway" })[0]
$workerContainer = @($workerTask.containerDefinitions | Where-Object { $_.name -eq "worker" })[0]
$gatewayEnvironment = Get-ContainerEnvironment $gatewayContainer
$workerEnvironment = Get-ContainerEnvironment $workerContainer

$migrationTaskArn = & terraform "-chdir=$environmentDirectory" output -raw migration_task_definition_arn 2>$null
if ($LASTEXITCODE -ne 0 -or -not $migrationTaskArn) {
  throw "The initialized development state did not expose the migration task."
}
$migrationTask = (
  Invoke-AwsJson @(
    "ecs",
    "describe-task-definition",
    "--task-definition",
    [string]$migrationTaskArn,
    "--output",
    "json"
  )
).taskDefinition
$migrationContainer = @(
  $migrationTask.containerDefinitions | Where-Object { $_.name -eq "database-migration" }
)[0]

$database = @((Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")).DBInstances)
if ($database.Count -ne 1) {
  throw "The exact development database is not available."
}
$database = $database[0]

$cluster = (
  Invoke-AwsJson @(
    "ecs",
    "describe-clusters",
    "--clusters",
    $clusterArn,
    "--output",
    "json"
  )
).clusters[0]
$containerInsights = @(
  $cluster.settings | Where-Object {
    $_.name -eq "containerInsights" -and $_.value -eq "enabled"
  }
).Count -gt 0

$env:TF_VAR_gateway_image = [string]$gatewayContainer.image
$env:TF_VAR_worker_image = [string]$workerContainer.image
$env:TF_VAR_migration_image = [string]$migrationContainer.image
$env:TF_VAR_gateway_desired_count = [string]$gatewayService.desiredCount
$env:TF_VAR_gateway_cpu = [string]$gatewayTask.cpu
$env:TF_VAR_gateway_memory = [string]$gatewayTask.memory
$env:TF_VAR_worker_desired_count = [string]$workerService.desiredCount
$env:TF_VAR_worker_cpu = [string]$workerTask.cpu
$env:TF_VAR_worker_memory = [string]$workerTask.memory
$env:TF_VAR_high_availability = ([bool]$database.MultiAZ).ToString().ToLowerInvariant()
$env:TF_VAR_private_application_networking = (
  ([string]$gatewayService.networkConfiguration.awsvpcConfiguration.assignPublicIp) -ne "ENABLED"
).ToString().ToLowerInvariant()
$env:TF_VAR_enable_redis = "false"
$env:TF_VAR_database_instance_class = [string]$database.DBInstanceClass
$env:TF_VAR_database_engine_version = [string]$database.EngineVersion
$env:TF_VAR_database_performance_insights = (
  [bool]$database.PerformanceInsightsEnabled
).ToString().ToLowerInvariant()
$env:TF_VAR_enable_container_insights = $containerInsights.ToString().ToLowerInvariant()
$env:TF_VAR_oidc_issuer = [string]$gatewayEnvironment["OIDC_ISSUER"]
$env:TF_VAR_oidc_audience = [string]$gatewayEnvironment["OIDC_AUDIENCE"]
$env:TF_VAR_temporal_address = [string]$workerEnvironment["TEMPORAL_ADDRESS"]
$env:TF_VAR_temporal_namespace = [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
$env:TF_VAR_deploy_applications = "true"

$allowedChanges = @{
  "module.platform.aws_cloudwatch_dashboard.operations"                    = "create"
  "module.platform.aws_cloudwatch_log_metric_filter.application_errors"   = "create"
  "module.platform.aws_cloudwatch_metric_alarm.alert_delivery_canary"     = "create"
  "module.platform.aws_cloudwatch_metric_alarm.application_errors"        = "create"
  "module.platform.aws_cloudwatch_metric_alarm.database_cpu"              = "update"
  "module.platform.aws_cloudwatch_metric_alarm.database_free_storage"     = "update"
  "module.platform.aws_cloudwatch_metric_alarm.dead_letter_messages"      = "update"
  "module.platform.aws_cloudwatch_metric_alarm.event_queue_age"           = "update"
  "module.platform.aws_kms_key.platform"                                  = "update"
  "module.platform.aws_sns_topic.operational_alerts"                      = "create"
  "module.platform.aws_sns_topic_policy.operational_alerts"               = "create"
}

$planRelativePath = ".terraform/applydash-alert-preview-$PID.tfplan"
$planDirectory = Join-Path $environmentDirectory ".terraform"
$planPath = Join-Path $planDirectory "applydash-alert-preview-$PID.tfplan"
$showErrorPath = Join-Path ([IO.Path]::GetTempPath()) "applydash-alert-preview-$PID.stderr"
try {
  $null = & terraform "-chdir=$environmentDirectory" plan `
    -input=false `
    -lock-timeout=5m `
    "-out=$planRelativePath" `
    -detailed-exitcode 2>$null
  if ($LASTEXITCODE -ne 2) {
    throw "The preview did not produce the expected change-only plan."
  }

  $planJson = & terraform "-chdir=$environmentDirectory" show -json $planRelativePath 2> $showErrorPath
  if ($LASTEXITCODE -ne 0) {
    $showError = (Get-Content -LiteralPath $showErrorPath -Raw).Trim()
    if (-not $showError) {
      $showError = "Terraform did not provide an error message."
    }
    throw "The preview plan could not be inspected: $showError"
  }
  $plan = $planJson | ConvertFrom-Json
  $changes = @()
  foreach ($resourceChange in $plan.resource_changes) {
    $actions = @($resourceChange.change.actions)
    if ($actions -contains "no-op" -or $actions -contains "read") {
      continue
    }
    $normalizedAction = $actions -join ","
    $expectedAction = $allowedChanges[[string]$resourceChange.address]
    if (-not $expectedAction -or $expectedAction -ne $normalizedAction) {
      throw "The preview contains a resource action outside the reviewed alert-delivery scope."
    }
    $changes += [pscustomobject]@{
      Address = [string]$resourceChange.address
      Action  = $normalizedAction
    }
  }

  if ($changes.Count -ne $allowedChanges.Count) {
    throw "The preview does not contain the complete reviewed alert-delivery change set."
  }

  $hash = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash
  [pscustomobject]@{
    PreviewPlanSha256 = $hash
    Creates           = @($changes | Where-Object { $_.Action -eq "create" }).Count
    Updates           = @($changes | Where-Object { $_.Action -eq "update" }).Count
    Deletes           = 0
    Replacements      = 0
    Changes           = $changes | Sort-Object Address
  } | ConvertTo-Json -Depth 5
}
finally {
  if (Test-Path -LiteralPath $planPath) {
    $resolvedPlan = [IO.Path]::GetFullPath($planPath)
    $resolvedPlanDirectory = [IO.Path]::GetFullPath($planDirectory)
    if (-not $resolvedPlan.StartsWith($resolvedPlanDirectory, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a plan outside the Terraform data directory."
    }
    Remove-Item -LiteralPath $resolvedPlan -Force
  }
  if (Test-Path -LiteralPath $showErrorPath) {
    $resolvedShowError = [IO.Path]::GetFullPath($showErrorPath)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedShowError.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove diagnostics outside the temporary directory."
    }
    Remove-Item -LiteralPath $resolvedShowError -Force
  }
}
