[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("development", "staging")]
  [string]$Environment,

  [ValidateSet("Status", "PlanIdle", "ApplyIdle", "VerifyIdle", "PlanResume", "ApplyResume", "Cleanup")]
  [string]$Action = "Status",

  [string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$ConfirmZeroTraffic,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
    -Environment development -Action PlanIdle -ConfirmZeroTraffic

  .\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
    -Environment development -Action ApplyIdle `
    -ExpectedPlanSha256 REVIEWED_SHA256 -ConfirmZeroTraffic -Execute

  .\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
    -Environment development -Action VerifyIdle

PlanIdle requires an exact synchronized main commit, a clean infrastructure/operator tree, zero
undispatched outbox rows, zero running Temporal workflows, and both legacy ECS services at the
stable 1/1/0 posture. It creates one ignored targeted Terraform plan containing exactly four
in-place updates: gateway desired count 1 to 0, worker desired count 1 to 0, and both heartbeat
alarms to the non-notifying idle posture.

ApplyIdle accepts only the saved checksum-matched plan and repeats the zero-work preflight before
applying. VerifyIdle proves both services remain ACTIVE at 0/0/0, there are no running ECS tasks,
the task ENIs captured before shutdown no longer retain public IPs, heartbeat actions are disabled,
and a refresh-backed targeted plan has zero drift.

PlanResume and ApplyResume provide the exact reverse four-update rollback while the retained ECS
services, task definitions, images, VPC Link, Cloud Map, and Temporal credential remain available.
No action deletes persistent infrastructure or changes API routing, Lambda aliases, workflow
triggers, outbox dispatch, task definitions, or provider credentials.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "Phase 0 AWS environments are restricted to us-east-2."
}
if (-not $AwsProfile) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$artifactDirectory = Join-Path $environmentDirectory ".terraform\ecs-idle-shutdown"
$contextPath = Join-Path $artifactDirectory "$Environment-context.json"
$idlePlanPath = Join-Path $artifactDirectory "$Environment-idle.tfplan"
$resumePlanPath = Join-Path $artifactDirectory "$Environment-resume.tfplan"
$idlePlanRelativePath = ".terraform/ecs-idle-shutdown/$Environment-idle.tfplan"
$resumePlanRelativePath = ".terraform/ecs-idle-shutdown/$Environment-resume.tfplan"
$clusterName = "ai-job-apply-$Environment"
$temporalSecretId = "ai-job-apply/$Environment/temporal-api-key"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$terraformVariables = @(
  "gateway_image", "worker_image", "migration_image", "gateway_desired_count",
  "gateway_cpu", "gateway_memory", "worker_desired_count", "worker_cpu", "worker_memory",
  "run_continuous_ecs_runtime", "enable_tracing", "otel_collector_image", "trace_sample_ratio",
  "high_availability", "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "temporal_address",
  "temporal_namespace", "deploy_applications"
)

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $output = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  if (-not $output) {
    return $null
  }
  try {
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw $FailureMessage
  }
}

function Assert-Tooling {
  foreach ($command in @("aws", "git", "node", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
}

function Assert-TemporaryCaller {
  $identity = Invoke-AwsJson `
    -Arguments @("sts", "get-caller-identity") `
    -FailureMessage "The $Environment AWS session is unavailable. Refresh IAM Identity Center."
  if (
    [string]$identity.Account -notmatch "^[0-9]{12}$" -or
    -not ([string]$identity.Arn).Contains(":assumed-role/")
  ) {
    throw "Use the temporary $Environment IAM Identity Center session."
  }
  return $identity
}

function Assert-ExactMainSource {
  $status = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0 -or $status.Count -ne 0) {
    throw "Planning requires a clean repository."
  }
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $main = (& git -C $repositoryRoot rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne "main" -or $head -ne $main) {
    throw "Planning requires the exact synchronized origin/main commit."
  }
  return $head
}

function Get-OnlyItem {
  param([object[]]$Items, [string]$FailureMessage)
  if ($Items.Count -ne 1) {
    throw $FailureMessage
  }
  return $Items[0]
}

function Get-ContainerEnvironment {
  param([object]$Container)
  $values = @{}
  foreach ($item in @($Container.environment)) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

function Get-ApplicationServices {
  $response = Invoke-AwsJson `
    -Arguments @(
      "ecs", "describe-services", "--cluster", $clusterName, "--services",
      "gateway", "workflow-worker"
    ) `
    -FailureMessage "The exact $Environment ECS services could not be inspected."
  if (@($response.failures).Count -ne 0 -or @($response.services).Count -ne 2) {
    throw "Both retained $Environment ECS services must exist."
  }
  $gateway = Get-OnlyItem `
    -Items @($response.services | Where-Object { $_.serviceName -eq "gateway" }) `
    -FailureMessage "The retained gateway service is not singular."
  $worker = Get-OnlyItem `
    -Items @($response.services | Where-Object { $_.serviceName -eq "workflow-worker" }) `
    -FailureMessage "The retained workflow-worker service is not singular."
  return @($gateway, $worker)
}

function Assert-ServicePosture {
  param([object[]]$Services, [bool]$Idle)

  $expected = if ($Idle) { 0 } else { 1 }
  foreach ($service in $Services) {
    $primary = Get-OnlyItem `
      -Items @($service.deployments | Where-Object { $_.status -eq "PRIMARY" }) `
      -FailureMessage "A retained ECS service does not have one primary deployment."
    if (
      [string]$service.status -ne "ACTIVE" -or
      [int]$service.desiredCount -ne $expected -or
      [int]$service.runningCount -ne $expected -or
      [int]$service.pendingCount -ne 0 -or
      [string]$primary.rolloutState -ne "COMPLETED"
    ) {
      $label = if ($Idle) { "0/0/0 idle" } else { "1/1/0 continuous" }
      throw "Service '$($service.serviceName)' is not at the required $label posture."
    }
  }
}

function Get-TaskDefinition {
  param([string]$Arn)
  return (
    Invoke-AwsJson `
      -Arguments @("ecs", "describe-task-definition", "--task-definition", $Arn) `
      -FailureMessage "A retained task definition could not be inspected."
  ).taskDefinition
}

function Get-RequiredContainer {
  param([object]$TaskDefinition, [string]$Name)
  return Get-OnlyItem `
    -Items @($TaskDefinition.containerDefinitions | Where-Object { $_.name -eq $Name }) `
    -FailureMessage "Task definition does not contain the exact '$Name' container."
}

function Get-LiveConfiguration {
  param([object[]]$Services)

  $gatewayService = Get-OnlyItem @($Services | Where-Object { $_.serviceName -eq "gateway" }) `
    "The gateway service is missing."
  $workerService = Get-OnlyItem @($Services | Where-Object { $_.serviceName -eq "workflow-worker" }) `
    "The workflow-worker service is missing."
  $gatewayTask = Get-TaskDefinition ([string]$gatewayService.taskDefinition)
  $workerTask = Get-TaskDefinition ([string]$workerService.taskDefinition)
  $gatewayContainer = Get-RequiredContainer $gatewayTask "gateway"
  $workerContainer = Get-RequiredContainer $workerTask "worker"
  $gatewayEnvironment = Get-ContainerEnvironment $gatewayContainer
  $workerEnvironment = Get-ContainerEnvironment $workerContainer

  $migrationTaskArn = & terraform "-chdir=$environmentDirectory" output -raw `
    migration_task_definition_arn 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $migrationTaskArn) {
    throw "The encrypted $Environment state does not expose the migration task."
  }
  $migrationTask = Get-TaskDefinition ([string]$migrationTaskArn)
  $migrationContainer = Get-RequiredContainer $migrationTask "database-migration"

  $database = Get-OnlyItem `
    -Items @(
      (Invoke-AwsJson `
        -Arguments @("rds", "describe-db-instances") `
        -FailureMessage "The $Environment database could not be inspected.").DBInstances |
        Where-Object { $_.DBInstanceIdentifier -eq "ai-job-apply-$Environment" }
    ) `
    -FailureMessage "The exact $Environment database is not singular."
  $cluster = Get-OnlyItem `
    -Items @(
      (Invoke-AwsJson `
        -Arguments @("ecs", "describe-clusters", "--clusters", $clusterName, "--include", "SETTINGS") `
        -FailureMessage "The $Environment ECS cluster could not be inspected.").clusters
    ) `
    -FailureMessage "The exact $Environment ECS cluster is not singular."

  $gatewayCollector = @($gatewayTask.containerDefinitions | Where-Object { $_.name -eq "otel-collector" })
  $workerCollector = @($workerTask.containerDefinitions | Where-Object { $_.name -eq "otel-collector" })
  $tracingEnabled = $gatewayCollector.Count -eq 1 -and $workerCollector.Count -eq 1
  if ($gatewayCollector.Count -ne $workerCollector.Count) {
    throw "Gateway and worker tracing posture differs."
  }
  $collectorImage = if ($tracingEnabled) { [string]$gatewayCollector[0].image } else { "" }
  if ($tracingEnabled -and $collectorImage -ne [string]$workerCollector[0].image) {
    throw "Gateway and worker collector images differ."
  }

  $required = @(
    [string]$gatewayContainer.image,
    [string]$workerContainer.image,
    [string]$migrationContainer.image,
    [string]$gatewayEnvironment["OIDC_ISSUER"],
    [string]$gatewayEnvironment["OIDC_AUDIENCE"],
    [string]$workerEnvironment["TEMPORAL_ADDRESS"],
    [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
  )
  if (@($required | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) {
    throw "The retained application configuration is incomplete."
  }

  return [ordered]@{
    gateway_image                   = [string]$gatewayContainer.image
    worker_image                    = [string]$workerContainer.image
    migration_image                 = [string]$migrationContainer.image
    gateway_desired_count           = 1
    gateway_cpu                     = [int]$gatewayTask.cpu
    gateway_memory                  = [int]$gatewayTask.memory
    worker_desired_count            = 1
    worker_cpu                      = [int]$workerTask.cpu
    worker_memory                   = [int]$workerTask.memory
    enable_tracing                  = [bool]$tracingEnabled
    otel_collector_image            = $collectorImage
    trace_sample_ratio              = if ($gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]) {
      [string]$gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]
    } else { "1" }
    high_availability               = [bool]$database.MultiAZ
    private_application_networking  = (
      [string]$gatewayService.networkConfiguration.awsvpcConfiguration.assignPublicIp -ne "ENABLED"
    )
    enable_redis                    = $false
    database_instance_class         = [string]$database.DBInstanceClass
    database_engine_version         = [string]$database.EngineVersion
    database_performance_insights   = [bool]$database.PerformanceInsightsEnabled
    enable_container_insights       = @(
      $cluster.settings | Where-Object { $_.name -eq "containerInsights" -and $_.value -eq "enabled" }
    ).Count -gt 0
    oidc_issuer                     = [string]$gatewayEnvironment["OIDC_ISSUER"]
    oidc_audience                   = [string]$gatewayEnvironment["OIDC_AUDIENCE"]
    temporal_address                = [string]$workerEnvironment["TEMPORAL_ADDRESS"]
    temporal_namespace              = [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
    gateway_task_definition         = [string]$gatewayService.taskDefinition
    worker_task_definition          = [string]$workerService.taskDefinition
  }
}

function Set-TerraformVariables {
  param([object]$Configuration, [bool]$Idle)
  foreach ($name in @(
      "gateway_image", "worker_image", "migration_image", "gateway_desired_count",
      "gateway_cpu", "gateway_memory", "worker_desired_count", "worker_cpu", "worker_memory",
      "otel_collector_image", "trace_sample_ratio", "database_instance_class",
      "database_engine_version", "oidc_issuer", "oidc_audience", "temporal_address",
      "temporal_namespace"
    )) {
    Set-Item "Env:TF_VAR_$name" ([string]$Configuration.$name)
  }
  foreach ($name in @(
      "enable_tracing", "high_availability", "private_application_networking", "enable_redis",
      "database_performance_insights", "enable_container_insights"
    )) {
    Set-Item "Env:TF_VAR_$name" ([bool]$Configuration.$name).ToString().ToLowerInvariant()
  }
  $env:TF_VAR_run_continuous_ecs_runtime = (-not $Idle).ToString().ToLowerInvariant()
  $env:TF_VAR_deploy_applications = "true"
}

function Get-TaskNetworkInterfaces {
  param([object[]]$Services)
  $ids = @()
  foreach ($service in $Services) {
    $listed = Invoke-AwsJson `
      -Arguments @(
        "ecs", "list-tasks", "--cluster", $clusterName, "--service-name",
        [string]$service.serviceName, "--desired-status", "RUNNING"
      ) `
      -FailureMessage "Running task inventory failed."
    $taskArns = @($listed.taskArns)
    if ($taskArns.Count -eq 0) {
      continue
    }
    $described = Invoke-AwsJson `
      -Arguments (@("ecs", "describe-tasks", "--cluster", $clusterName, "--tasks") + $taskArns) `
      -FailureMessage "Running task attachment inventory failed."
    foreach ($task in @($described.tasks)) {
      foreach ($attachment in @($task.attachments | Where-Object { $_.type -eq "ElasticNetworkInterface" })) {
        $networkInterfaceId = @(
          $attachment.details | Where-Object { $_.name -eq "networkInterfaceId" }
        ).value
        if ($networkInterfaceId) {
          $ids += [string]$networkInterfaceId
        }
      }
    }
  }
  return @($ids | Sort-Object -Unique)
}

function Assert-ZeroPendingWork {
  param([object]$Configuration)

  $outboxScript = Join-Path $PSScriptRoot "inspect-deployed-outbox.ps1"
  $outboxRaw = & $outboxScript -Environment $Environment -AwsProfile $AwsProfile -Region $Region -Execute
  if ($LASTEXITCODE -ne 0) {
    throw "The bounded outbox inspection failed."
  }
  try {
    $outbox = ($outboxRaw -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "The bounded outbox inspection did not return its sanitized contract."
  }
  if ([int]$outbox.pendingCount -ne 0) {
    throw "The $Environment outbox still contains undispatched work."
  }

  $temporalVerifier = Join-Path $repositoryRoot "backend\workflows\cloud-conformance.mjs"
  $null = & node $temporalVerifier `
    --profile $AwsProfile `
    --region $Region `
    --secret-id $temporalSecretId `
    --address ([string]$Configuration.temporal_address) `
    --namespace ([string]$Configuration.temporal_namespace) `
    --require-zero-open-workflows
  if ($LASTEXITCODE -ne 0) {
    throw "Temporal authentication or zero-running-workflow conformance failed."
  }
}

function Save-Context {
  param([object]$Context)
  $null = New-Item -ItemType Directory -Path $artifactDirectory -Force
  [IO.File]::WriteAllText($contextPath, ($Context | ConvertTo-Json -Depth 12), $utf8WithoutBom)
}

function Get-Context {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw "The ignored $Environment idle-shutdown context is absent."
  }
  return Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
}

function Assert-ContextCaller {
  param([object]$Context, [object]$Identity)
  if (
    [string]$Context.account_id -notmatch "^[0-9]{12}$" -or
    [string]$Context.account_id -ne [string]$Identity.Account
  ) {
    throw "The current AWS caller does not match the ignored environment context."
  }
}

function Assert-OnlyPropertiesChanged {
  param([object]$Change, [string[]]$Allowed, [string]$FailureMessage)
  $beforeNames = @($Change.change.before.PSObject.Properties.Name)
  $afterNames = @($Change.change.after.PSObject.Properties.Name)
  foreach ($name in @($beforeNames + $afterNames | Sort-Object -Unique)) {
    if ($Allowed -contains $name) {
      continue
    }
    $before = if ($beforeNames -contains $name) {
      $Change.change.before.$name | ConvertTo-Json -Depth 40 -Compress
    } else { "<absent>" }
    $after = if ($afterNames -contains $name) {
      $Change.change.after.$name | ConvertTo-Json -Depth 40 -Compress
    } else { "<absent>" }
    if ($before -ne $after) {
      throw $FailureMessage
    }
  }
}

function Test-SavedPlan {
  param([string]$PlanRelativePath, [bool]$Idle)

  $raw = & terraform "-chdir=$environmentDirectory" show -json $PlanRelativePath 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The saved $Environment ECS plan could not be inspected."
  }
  $plan = $raw | ConvertFrom-Json
  $changes = @(
    $plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("no-op", "read")
    }
  )
  $serviceAddresses = @(
    "module.platform.aws_ecs_service.gateway[0]",
    "module.platform.aws_ecs_service.worker[0]"
  )
  $alarmAddresses = @(
    "module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
    "module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]"
  )
  $expectedAddresses = @($serviceAddresses + $alarmAddresses)
  if (
    $changes.Count -ne 4 -or
    @($changes | Where-Object { (@($_.change.actions) -join ",") -ne "update" }).Count -ne 0 -or
    (Compare-Object @($changes.address | Sort-Object) @($expectedAddresses | Sort-Object))
  ) {
    throw "The plan is outside the exact four-update ECS idle boundary."
  }

  $beforeDesired = if ($Idle) { 1 } else { 0 }
  $afterDesired = if ($Idle) { 0 } else { 1 }
  foreach ($address in $serviceAddresses) {
    $change = Get-OnlyItem @($changes | Where-Object { $_.address -eq $address }) `
      "The expected ECS service update is missing."
    Assert-OnlyPropertiesChanged $change @("desired_count") `
      "An ECS service update changes more than desired count."
    if (
      [int]$change.change.before.desired_count -ne $beforeDesired -or
      [int]$change.change.after.desired_count -ne $afterDesired
    ) {
      throw "An ECS service does not contain the reviewed desired-count transition."
    }
  }

  foreach ($address in $alarmAddresses) {
    $change = Get-OnlyItem @($changes | Where-Object { $_.address -eq $address }) `
      "The expected heartbeat alarm update is missing."
    Assert-OnlyPropertiesChanged $change @("actions_enabled", "treat_missing_data") `
      "A heartbeat alarm changes outside its idle notification posture."
    $expectedBeforeActions = $Idle
    $expectedAfterActions = -not $Idle
    $expectedBeforeMissing = if ($Idle) { "breaching" } else { "notBreaching" }
    $expectedAfterMissing = if ($Idle) { "notBreaching" } else { "breaching" }
    if (
      [bool]$change.change.before.actions_enabled -ne $expectedBeforeActions -or
      [bool]$change.change.after.actions_enabled -ne $expectedAfterActions -or
      [string]$change.change.before.treat_missing_data -ne $expectedBeforeMissing -or
      [string]$change.change.after.treat_missing_data -ne $expectedAfterMissing
    ) {
      throw "A heartbeat alarm does not contain the reviewed notification transition."
    }
  }
  return $changes
}

function New-TargetedPlan {
  param([object]$Configuration, [bool]$Idle, [string]$Path, [string]$RelativePath)
  if (Test-Path -LiteralPath $Path) {
    throw "A saved plan already exists at the exact $Environment path."
  }
  Set-TerraformVariables $Configuration $Idle
  $targets = @(
    "-target=module.platform.aws_ecs_service.gateway[0]",
    "-target=module.platform.aws_ecs_service.worker[0]",
    "-target=module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
    "-target=module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]"
  )
  $null = & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=5m `
    -detailed-exitcode "-out=$RelativePath" @targets 2>$null
  if ($LASTEXITCODE -ne 2) {
    throw "The refresh-backed targeted plan did not produce the expected change-only result."
  }
  $changes = Test-SavedPlan $RelativePath $Idle
  return [ordered]@{
    PlanSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    Updates = $changes.Count
    Creates = 0
    Deletes = 0
    Replacements = 0
  }
}

function Assert-ReviewedPlan {
  param([string]$Path, [string]$RelativePath, [string]$RecordedHash, [bool]$Idle)
  if (-not $Execute) {
    throw "Apply requires -Execute."
  }
  if ($ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "Apply requires the reviewed 64-character plan checksum."
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "The exact saved plan is absent."
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if (
    $actual -ne $ExpectedPlanSha256.ToLowerInvariant() -or
    $actual -ne $RecordedHash.ToLowerInvariant()
  ) {
    throw "The saved plan checksum does not match both the review and ignored context."
  }
  $null = Test-SavedPlan $RelativePath $Idle
}

function Assert-HeartbeatPosture {
  param([bool]$Idle)
  $names = @(
    "ai-job-apply-$Environment-gateway-log-heartbeat-missing",
    "ai-job-apply-$Environment-worker-log-heartbeat-missing"
  )
  $response = Invoke-AwsJson `
    -Arguments (@("cloudwatch", "describe-alarms", "--alarm-names") + $names) `
    -FailureMessage "The retained heartbeat alarms could not be inspected."
  if (@($response.MetricAlarms).Count -ne 2) {
    throw "Both retained heartbeat alarms must exist."
  }
  foreach ($alarm in @($response.MetricAlarms)) {
    if (
      [bool]$alarm.ActionsEnabled -ne (-not $Idle) -or
      [string]$alarm.TreatMissingData -ne $(if ($Idle) { "notBreaching" } else { "breaching" })
    ) {
      throw "A heartbeat alarm is outside the expected runtime posture."
    }
  }
}

function Assert-PublicTaskAddressesReleased {
  param([string[]]$NetworkInterfaceIds)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $publicAddressPresent = $false
    foreach ($networkInterfaceId in $NetworkInterfaceIds) {
      $raw = & aws ec2 describe-network-interfaces --network-interface-ids $networkInterfaceId `
        --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
      if ($LASTEXITCODE -ne 0) {
        continue
      }
      $response = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
      foreach ($networkInterface in @($response.NetworkInterfaces)) {
        if ($networkInterface.Association -and $networkInterface.Association.PublicIp) {
          $publicAddressPresent = $true
        }
      }
    }
    if (-not $publicAddressPresent) {
      return
    }
    if ($attempt -lt 29) {
      Start-Sleep -Seconds 10
    }
  }
  throw "A stopped ECS task network interface still retains a public IP."
}

function Assert-TargetedNoDrift {
  param([object]$Configuration, [bool]$Idle)
  Set-TerraformVariables $Configuration $Idle
  $targets = @(
    "-target=module.platform.aws_ecs_service.gateway[0]",
    "-target=module.platform.aws_ecs_service.worker[0]",
    "-target=module.platform.aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0]",
    "-target=module.platform.aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0]"
  )
  $null = & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=5m `
    -detailed-exitcode @targets 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The refresh-backed targeted verification reported drift or failed."
  }
}

try {
  Assert-Tooling
  $identity = Assert-TemporaryCaller
  if (-not (Test-Path -LiteralPath $environmentDirectory -PathType Container)) {
    throw "The selected Terraform environment is absent."
  }

  $services = Get-ApplicationServices
  switch ($Action) {
    "Status" {
      [pscustomobject]@{
        Environment = $Environment
        GatewayDesired = [int](Get-OnlyItem @($services | Where-Object serviceName -eq "gateway") "Gateway missing").desiredCount
        GatewayRunning = [int](Get-OnlyItem @($services | Where-Object serviceName -eq "gateway") "Gateway missing").runningCount
        WorkerDesired = [int](Get-OnlyItem @($services | Where-Object serviceName -eq "workflow-worker") "Worker missing").desiredCount
        WorkerRunning = [int](Get-OnlyItem @($services | Where-Object serviceName -eq "workflow-worker") "Worker missing").runningCount
        IdleContextPresent = Test-Path -LiteralPath $contextPath
      } | ConvertTo-Json
    }
    "PlanIdle" {
      if (-not $ConfirmZeroTraffic) {
        throw "PlanIdle requires -ConfirmZeroTraffic."
      }
      if (Test-Path -LiteralPath $contextPath) {
        throw "An idle-shutdown context already exists for $Environment."
      }
      $sourceCommit = Assert-ExactMainSource
      Assert-ServicePosture $services $false
      $configuration = Get-LiveConfiguration $services
      Assert-ZeroPendingWork $configuration
      $networkInterfaceIds = Get-TaskNetworkInterfaces $services
      if ($networkInterfaceIds.Count -ne 2) {
        throw "The continuous posture must expose exactly two running task network interfaces."
      }
      $context = [ordered]@{
        version = 1
        environment = $Environment
        account_id = [string]$identity.Account
        source_commit = $sourceCommit
        configuration = $configuration
        task_network_interface_ids = $networkInterfaceIds
        idle_plan_sha256 = ""
        resume_plan_sha256 = ""
      }
      Save-Context $context
      try {
        $summary = New-TargetedPlan $configuration $true $idlePlanPath $idlePlanRelativePath
        $context.idle_plan_sha256 = [string]$summary.PlanSha256
        Save-Context $context
        [pscustomobject]@{
          Environment = $Environment
          SourceCommit = $sourceCommit
          ZeroTrafficConfirmed = $true
          PendingOutboxRows = 0
          RunningTemporalWorkflows = 0
          Updates = 4
          Creates = 0
          Deletes = 0
          Replacements = 0
          PlanSha256 = [string]$summary.PlanSha256
        } | ConvertTo-Json
      } catch {
        if (Test-Path -LiteralPath $idlePlanPath) { Remove-Item -LiteralPath $idlePlanPath -Force }
        if (Test-Path -LiteralPath $contextPath) { Remove-Item -LiteralPath $contextPath -Force }
        throw
      }
    }
    "ApplyIdle" {
      if (-not $ConfirmZeroTraffic) {
        throw "ApplyIdle requires -ConfirmZeroTraffic."
      }
      $context = Get-Context
      Assert-ContextCaller $context $identity
      Assert-ServicePosture $services $false
      Assert-ZeroPendingWork $context.configuration
      Set-TerraformVariables $context.configuration $true
      Assert-ReviewedPlan $idlePlanPath $idlePlanRelativePath `
        ([string]$context.idle_plan_sha256) $true
      $null = & terraform "-chdir=$environmentDirectory" apply -input=false -auto-approve `
        $idlePlanRelativePath
      if ($LASTEXITCODE -ne 0) {
        throw "The exact reviewed $Environment idle plan failed to apply."
      }
      & aws ecs wait services-stable --cluster $clusterName --services gateway workflow-worker `
        --profile $AwsProfile --region $Region --no-cli-pager 2>$null
      if ($LASTEXITCODE -ne 0) {
        throw "The retained ECS services did not converge to the idle posture."
      }
      $services = Get-ApplicationServices
      Assert-ServicePosture $services $true
      Assert-HeartbeatPosture $true
      Assert-PublicTaskAddressesReleased @($context.task_network_interface_ids)
      Assert-TargetedNoDrift $context.configuration $true
      [pscustomobject]@{
        Environment = $Environment
        AppliedPlanSha256 = [string]$context.idle_plan_sha256
        Gateway = "0/0/0"
        Worker = "0/0/0"
        TaskPublicIpsReleased = $true
        HeartbeatActionsEnabled = $false
        TargetedNoDrift = $true
      } | ConvertTo-Json
    }
    "VerifyIdle" {
      $context = Get-Context
      Assert-ContextCaller $context $identity
      Assert-ServicePosture $services $true
      $running = Invoke-AwsJson `
        -Arguments @("ecs", "list-tasks", "--cluster", $clusterName, "--desired-status", "RUNNING") `
        -FailureMessage "Running ECS task inventory failed."
      if (@($running.taskArns).Count -ne 0) {
        throw "The idle cluster still contains a running ECS task."
      }
      Assert-HeartbeatPosture $true
      Assert-PublicTaskAddressesReleased @($context.task_network_interface_ids)
      Assert-TargetedNoDrift $context.configuration $true
      [pscustomobject]@{
        Environment = $Environment
        Gateway = "0/0/0"
        Worker = "0/0/0"
        RunningEcsTasks = 0
        TaskPublicIpsReleased = $true
        HeartbeatActionsEnabled = $false
        TargetedNoDrift = $true
      } | ConvertTo-Json
    }
    "PlanResume" {
      $null = Assert-ExactMainSource
      $context = Get-Context
      Assert-ContextCaller $context $identity
      Assert-ServicePosture $services $true
      $summary = New-TargetedPlan $context.configuration $false $resumePlanPath $resumePlanRelativePath
      $context.resume_plan_sha256 = [string]$summary.PlanSha256
      Save-Context $context
      [pscustomobject]@{
        Environment = $Environment
        Updates = 4
        Creates = 0
        Deletes = 0
        Replacements = 0
        PlanSha256 = [string]$summary.PlanSha256
      } | ConvertTo-Json
    }
    "ApplyResume" {
      $context = Get-Context
      Assert-ContextCaller $context $identity
      Assert-ServicePosture $services $true
      Set-TerraformVariables $context.configuration $false
      Assert-ReviewedPlan $resumePlanPath $resumePlanRelativePath `
        ([string]$context.resume_plan_sha256) $false
      $null = & terraform "-chdir=$environmentDirectory" apply -input=false -auto-approve `
        $resumePlanRelativePath
      if ($LASTEXITCODE -ne 0) {
        throw "The exact reviewed $Environment resume plan failed to apply."
      }
      & aws ecs wait services-stable --cluster $clusterName --services gateway workflow-worker `
        --profile $AwsProfile --region $Region --no-cli-pager 2>$null
      if ($LASTEXITCODE -ne 0) {
        throw "The retained ECS services did not return to the continuous posture."
      }
      $services = Get-ApplicationServices
      Assert-ServicePosture $services $false
      Assert-HeartbeatPosture $false
      Assert-TargetedNoDrift $context.configuration $false
      [pscustomobject]@{
        Environment = $Environment
        AppliedPlanSha256 = [string]$context.resume_plan_sha256
        Gateway = "1/1/0"
        Worker = "1/1/0"
        HeartbeatActionsEnabled = $true
        TargetedNoDrift = $true
      } | ConvertTo-Json
    }
    "Cleanup" {
      if (-not $Execute) {
        throw "Cleanup requires -Execute."
      }
      Assert-ServicePosture $services $false
      $root = [IO.Path]::GetFullPath($artifactDirectory)
      foreach ($path in @($idlePlanPath, $resumePlanPath, $contextPath)) {
        if (Test-Path -LiteralPath $path) {
          $resolved = [IO.Path]::GetFullPath($path)
          if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove an operator artifact outside its exact directory."
          }
          Remove-Item -LiteralPath $resolved -Force
        }
      }
      [pscustomobject]@{ Environment = $Environment; OperatorArtifactsRemoved = $true } |
        ConvertTo-Json
    }
  }
}
finally {
  foreach ($name in $terraformVariables) {
    Remove-Item "Env:TF_VAR_$name" -ErrorAction SilentlyContinue
  }
  if ($null -eq $previousProfile) { Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue } else { $env:AWS_PROFILE = $previousProfile }
  if ($null -eq $previousRegion) { Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue } else { $env:AWS_REGION = $previousRegion }
  if ($null -eq $previousDefaultRegion) { Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue } else { $env:AWS_DEFAULT_REGION = $previousDefaultRegion }
}
