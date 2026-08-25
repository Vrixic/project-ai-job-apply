[CmdletBinding()]
param(
  [ValidateSet("Status", "Start", "Verify", "Cleanup", "Exercise")]
  [string]$Action = "Status",
  [ValidateSet("development", "staging")]
  [string]$Environment = "staging",
  [string]$AwsProfile = "",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [switch]$Execute,
  [switch]$AllowUnverifiedCleanup,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Help) {
  @"
Usage:
  `$runtimeBoundary = @{
    ExpectedAccountId = "ENVIRONMENT_ACCOUNT_ID"
    StateBucket = "ENVIRONMENT_TERRAFORM_STATE_BUCKET"
    RuntimePlanPath = ".terraform/APPLIED_STEADY_STATE_PLAN.tfplan"
  }
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Status @runtimeBoundary
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Start -Execute @runtimeBoundary
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Verify -Execute @runtimeBoundary
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Cleanup -Execute @runtimeBoundary
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Exercise -Execute @runtimeBoundary
  .\scripts\operate-$Environment-postgresql-restore.ps1 -Action Cleanup `
    -AllowUnverifiedCleanup -Execute @runtimeBoundary

Status is read-only. Start runs the immutable read-only source verifier, requests one uniquely
tagged latest-point-in-time restore, and waits for it to become available. Verify runs the same
read-only verifier against the isolated copy and requires an exact aggregate digest match.
Cleanup deletes only the verified, uniquely tagged disposable target and its automated backups,
then proves source/application health and Terraform no drift. Exercise runs Start, Verify, and
Cleanup in sequence. State is retained in the ignored $Environment Terraform data directory so an
interrupted exercise can resume safely.

Every action requires the exact $Environment ExpectedAccountId, StateBucket, and an already applied
RuntimePlanPath below the ignored $Environment `.terraform` directory for steady-state/no-drift proof.
All state-changing actions require -Execute. AllowUnverifiedCleanup is an emergency cleanup gate
for an exact failed disposable target; it never weakens target identity, tag, network, or source
guards.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The D1 current-restore $Environment environment is restricted to us-east-2."
}

$environmentDirectory = (Resolve-Path "infrastructure/terraform/environments/$Environment").Path
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform"
$contextPath = Join-Path $terraformDataDirectory "applydash-$Environment-restore-context.json"
$sourceIdentifier = "ai-job-apply-$Environment"
$targetPrefix = "ai-job-apply-$Environment-restore-"
$applicationLogGroup = "/ai-job-apply/$Environment/application"
$runtimeInspector = Join-Path $PSScriptRoot "inspect-staging-workload-and-cost.ps1"
$repositoryRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "lib/staging-postgresql-restore-verifier.ps1")
$restoreManifestBoundary = Get-D1RestoreManifestBoundary $repositoryRoot

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' operation failed. Refresh the $Environment SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Assert-ExecutionAuthorized {
  param([string]$Operation)

  if (-not $Execute) {
    throw "$Operation requires -Execute."
  }
}

function Assert-CallerAndTerraform {
  Assert-CurrentAwsCaller
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -cne "1.9.8") {
    throw "Terraform 1.9.8 is required for this restore procedure."
  }
}

function Assert-CurrentAwsCaller {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  Assert-D1RestoreAwsCallerBoundary $identity $ExpectedAccountId
}

function Get-SourceDatabase {
  $databases = @(
    (
      Invoke-AwsJson @(
        "rds",
        "describe-db-instances",
        "--db-instance-identifier",
        $sourceIdentifier,
        "--output",
        "json"
      )
    ).DBInstances
  )
  if ($databases.Count -ne 1) {
    throw "The exact Terraform-managed $Environment source database is unavailable."
  }
  return $databases[0]
}

function Get-ResourceTags {
  param([string]$Arn)

  $items = @(
    (
      Invoke-AwsJson @(
        "rds", "list-tags-for-resource", "--resource-name", $Arn, "--output", "json"
      )
    ).TagList
  )
  $tags = @{}
  foreach ($item in $items) {
    $tags[[string]$item.Key] = [string]$item.Value
  }
  return $tags
}

function Get-SourceIdentityBoundaryJson {
  param([object]$Database)

  $project = {
    param([object]$Database)
    return [ordered]@{
      arn = [string]$Database.DBInstanceArn
      resource = [string]$Database.DbiResourceId
      address = [string]$Database.Endpoint.Address
      port = [int]$Database.Endpoint.Port
      engine = [string]$Database.Engine
      engine_version = [string]$Database.EngineVersion
      instance_class = [string]$Database.DBInstanceClass
      availability_zone = [string]$Database.AvailabilityZone
      auto_minor_upgrade = [bool]$Database.AutoMinorVersionUpgrade
      storage_type = [string]$Database.StorageType
      allocated_storage = [int]$Database.AllocatedStorage
      max_allocated_storage = [int]$Database.MaxAllocatedStorage
      iops = [int]$Database.Iops
      storage_throughput = [int]$Database.StorageThroughput
      performance_insights = [bool]$Database.PerformanceInsightsEnabled
      kms_key = [string]$Database.KmsKeyId
      iam_database_auth = [bool]$Database.IAMDatabaseAuthenticationEnabled
      database_name = [string]$Database.DBName
      master_username = [string]$Database.MasterUsername
      network_type = [string]$Database.NetworkType
      ca_certificate = [string]$Database.CACertificateIdentifier
      subnet_group = [string]$Database.DBSubnetGroup.DBSubnetGroupName
      subnet_vpc = [string]$Database.DBSubnetGroup.VpcId
      security_groups = @($Database.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
      parameter_groups = @($Database.DBParameterGroups | ForEach-Object {
        "$([string]$_.DBParameterGroupName):$([string]$_.ParameterApplyStatus)"
      } | Sort-Object)
      option_groups = @($Database.OptionGroupMemberships | ForEach-Object {
        "$([string]$_.OptionGroupName):$([string]$_.Status)"
      } | Sort-Object)
      log_exports = @($Database.EnabledCloudwatchLogsExports | Sort-Object)
    }
  }
  return (& $project $Database) | ConvertTo-Json -Depth 5 -Compress
}

function Get-D1RestoreStringSha256 {
  param([string]$Value)

  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $algorithm.Dispose()
  }
}

function Assert-SourceIdentityUnchanged {
  param(
    [object]$Before,
    [object]$After
  )

  $beforeBoundary = Get-SourceIdentityBoundaryJson $Before
  $afterBoundary = Get-SourceIdentityBoundaryJson $After
  if ($afterBoundary -cne $beforeBoundary) {
    throw "The $Environment source database changed during restore preparation."
  }
}

function New-RestoreRequest {
  param(
    [object]$Source,
    [string]$TargetIdentifier,
    [string]$StartedAt
  )

  return [ordered]@{
    SourceDbiResourceId              = [string]$Source.DbiResourceId
    TargetDBInstanceIdentifier       = $TargetIdentifier
    UseLatestRestorableTime          = $true
    DBInstanceClass                  = [string]$Source.DBInstanceClass
    Port                             = [int]$Source.Endpoint.Port
    AvailabilityZone                 = [string]$Source.AvailabilityZone
    DBSubnetGroupName                = [string]$Source.DBSubnetGroup.DBSubnetGroupName
    MultiAZ                         = $false
    PubliclyAccessible              = $false
    AutoMinorVersionUpgrade         = [bool]$Source.AutoMinorVersionUpgrade
    OptionGroupName                 = [string]$Source.OptionGroupMemberships[0].OptionGroupName
    CopyTagsToSnapshot              = $true
    StorageType                     = [string]$Source.StorageType
    AllocatedStorage                = [int]$Source.AllocatedStorage
    MaxAllocatedStorage             = [int]$Source.MaxAllocatedStorage
    Iops                            = [int]$Source.Iops
    StorageThroughput               = [int]$Source.StorageThroughput
    EnablePerformanceInsights       = [bool]$Source.PerformanceInsightsEnabled
    VpcSecurityGroupIds             = @($Source.VpcSecurityGroups.VpcSecurityGroupId)
    EnableIAMDatabaseAuthentication = [bool]$Source.IAMDatabaseAuthenticationEnabled
    EnableCloudwatchLogsExports     = @("postgresql")
    DBParameterGroupName            = [string]$Source.DBParameterGroups[0].DBParameterGroupName
    DeletionProtection              = $false
    CACertificateIdentifier         = [string]$Source.CACertificateIdentifier
    NetworkType                     = [string]$Source.NetworkType
    Tags                            = @(
      [ordered]@{ Key = "Project"; Value = "ai-job-apply" },
      [ordered]@{ Key = "Environment"; Value = $Environment },
      [ordered]@{ Key = "ManagedBy"; Value = "restore-drill" },
      [ordered]@{ Key = "Purpose"; Value = "d1-current-isolated-restore" },
      [ordered]@{ Key = "StartedAt"; Value = $StartedAt }
    )
  }
}

function Assert-SourceContextBoundary {
  param(
    [object]$Source,
    [object]$Context
  )

  $request = New-RestoreRequest $Source `
    ([string]$Context.target_identifier) ([string]$Context.started_at)
  $requestJson = $request | ConvertTo-Json -Depth 8 -Compress
  if (
    [string]$Source.DBInstanceArn -cne [string]$Context.source_resource_arn -or
    [string]$Source.DbiResourceId -cne [string]$Context.source_dbi_resource_id -or
    (Get-D1RestoreStringSha256 (Get-SourceIdentityBoundaryJson $Source)) -cne `
      [string]$Context.source_boundary_sha256 -or
    (Get-D1RestoreStringSha256 $requestJson) -cne [string]$Context.restore_request_sha256
  ) {
    throw "The $Environment source or restore request changed after the source baseline."
  }
}

function Assert-SourceBoundary {
  param([object]$Source)

  $tags = Get-ResourceTags ([string]$Source.DBInstanceArn)
  if (
    [string]$Source.DBInstanceIdentifier -cne $sourceIdentifier -or
    [string]$Source.DBInstanceStatus -cne "available" -or
    [bool]$Source.PubliclyAccessible -or
    -not [bool]$Source.StorageEncrypted -or
    -not [bool]$Source.DeletionProtection -or
    [bool]$Source.MultiAZ -or
    [int]$Source.BackupRetentionPeriod -ne 7 -or
    $null -eq $Source.LatestRestorableTime -or
    $tags["Project"] -cne "ai-job-apply" -or
    $tags["Environment"] -cne $Environment -or
    $tags["ManagedBy"] -cne "terraform"
  ) {
    throw "The $Environment source database does not match the reviewed restore boundary."
  }
  if (
    @($Source.VpcSecurityGroups).Count -ne 1 -or
    @($Source.DBParameterGroups).Count -ne 1 -or
    @($Source.OptionGroupMemberships).Count -ne 1 -or
    [string]$Source.DBParameterGroups[0].ParameterApplyStatus -cne "in-sync" -or
    [string]$Source.OptionGroupMemberships[0].Status -cne "in-sync"
  ) {
    throw "The $Environment source database network or parameter boundary is not stable."
  }
}

function Get-DisposableTargets {
  $databases = @(
    (Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")).DBInstances
  )
  return @(
    $databases | Where-Object {
      ([string]$_.DBInstanceIdentifier).StartsWith($targetPrefix, [StringComparison]::Ordinal)
    }
  )
}

function Assert-ApplicationBaseline {
  if ($ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket) -or
      [string]::IsNullOrWhiteSpace($RuntimePlanPath)) {
    throw "The exact $Environment account, state bucket, and applied runtime plan are required."
  }
  $statusJson = & $runtimeInspector -Environment $Environment -Action Status `
    -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket `
    -RuntimePlanPath $RuntimePlanPath -AwsProfile $AwsProfile -Region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The $Environment application baseline did not pass."
  }
  $status = $statusJson | ConvertFrom-Json
  if (
    -not [bool]$status.NoDrift -or
    [string]$status.DispatchTarget -cne "lambda_durable" -or
    -not [bool]$status.TriggersEnabled -or
    -not [bool]$status.EcsRuntimeIdle
  ) {
    throw "The $Environment application baseline is not healthy."
  }

  $alarmNames = @(
    "ai-job-apply-$Environment-outbox-reconciler-errors",
    "ai-job-apply-$Environment-outbox-starter-errors",
    "ai-job-apply-$Environment-outbox-starter-throttles",
    "ai-job-apply-$Environment-profile-readiness-activity-errors",
    "ai-job-apply-$Environment-profile-readiness-dead-letter",
    "ai-job-apply-$Environment-profile-readiness-durable-failed",
    "ai-job-apply-$Environment-profile-readiness-durable-timed-out",
    "ai-job-apply-$Environment-gateway-lambda-errors",
    "ai-job-apply-$Environment-gateway-lambda-throttles",
    "ai-job-apply-$Environment-gateway-lambda-duration"
  )
  if ($Environment -ceq "development") {
    $alarmNames += @(
      "ai-job-apply-development-alert-delivery-canary",
      "ai-job-apply-development-application-errors",
      "ai-job-apply-development-database-cpu",
      "ai-job-apply-development-database-free-storage",
      "ai-job-apply-development-dead-letter-messages",
      "ai-job-apply-development-document-parser-errors",
      "ai-job-apply-development-document-processing-record-failed",
      "ai-job-apply-development-document-processing-timed-out",
      "ai-job-apply-development-document-processor-errors",
      "ai-job-apply-development-document-scan-delivery-dlq",
      "ai-job-apply-development-document-scan-dlq",
      "ai-job-apply-development-document-scan-queue-age",
      "ai-job-apply-development-document-security-contradiction",
      "ai-job-apply-development-event-queue-age",
      "ai-job-apply-development-ingestion-activity-errors",
      "ai-job-apply-development-ingestion-activity-throttles",
      "ai-job-apply-development-ingestion-coordinator-errors",
      "ai-job-apply-development-ingestion-coordinator-throttles",
      "ai-job-apply-development-ingestion-dead-letter",
      "ai-job-apply-development-ingestion-dispatch-age",
      "ai-job-apply-development-ingestion-durable-duration",
      "ai-job-apply-development-ingestion-durable-failed",
      "ai-job-apply-development-ingestion-durable-throttles",
      "ai-job-apply-development-ingestion-durable-timed-out",
      "ai-job-apply-development-ingestion-starter-errors",
      "ai-job-apply-development-ingestion-starter-throttles",
      "ai-job-apply-development-ingestion-terminal-errors",
      "ai-job-apply-development-ingestion-terminal-throttles",
      "ai-job-apply-development-public-job-lambda-duration",
      "ai-job-apply-development-public-job-lambda-errors",
      "ai-job-apply-development-public-job-lambda-throttles",
      "ai-job-apply-development-public-job-projection-duration",
      "ai-job-apply-development-public-job-projection-errors",
      "ai-job-apply-development-public-job-projection-throttles"
    )
  }
  $alarms = @(
    (
      Invoke-AwsJson (
        @("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames +
          @("--output", "json")
      )
    ).MetricAlarms
  )
  $actualAlarmNames = @($alarms.AlarmName | Sort-Object)
  if (
    $alarms.Count -ne $alarmNames.Count -or
    ($actualAlarmNames -join "`n") -cne ((@($alarmNames | Sort-Object)) -join "`n") -or
    @($alarms | Where-Object {
      [string]$_.StateValue -cne "OK" -or
      -not [bool]$_.ActionsEnabled -or
      @($_.AlarmActions).Count -ne 1 -or
      @($_.OKActions).Count -ne 1
    }).Count -ne 0
  ) {
    throw "All managed $Environment runtime alarms must be OK."
  }
  return [pscustomobject]@{
    EcsRuntimeIdle = $true
    ManagedRuntimeAlarmsOk = $alarmNames.Count
  }
}

function Assert-TerraformNoDrift {
  $resultJson = & $runtimeInspector -Environment $Environment -Action Status `
    -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket `
    -RuntimePlanPath $RuntimePlanPath -AwsProfile $AwsProfile -Region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The exact-input $Environment Terraform no-drift check failed."
  }
  $result = $resultJson | ConvertFrom-Json
  if (-not [bool]$result.NoDrift) {
    throw "The $Environment Terraform state is not drift free."
  }
}

function Get-MigrationRuntime {
  $clusterArn = & terraform "-chdir=$environmentDirectory" output -raw ecs_cluster_arn 2>$null
  $taskDefinitionArn = & terraform "-chdir=$environmentDirectory" output -raw `
    migration_task_definition_arn 2>$null
  $subnetIds = @(
    & terraform "-chdir=$environmentDirectory" output -json migration_subnet_ids 2>$null |
      ConvertFrom-Json
  )
  $securityGroupId = & terraform "-chdir=$environmentDirectory" output -raw `
    application_security_group_id 2>$null
  if (
    -not $clusterArn -or
    -not $taskDefinitionArn -or
    $subnetIds.Count -ne 2 -or
    -not $securityGroupId
  ) {
    throw "The encrypted $Environment state did not expose the exact verifier runtime."
  }

  $taskDefinition = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$taskDefinitionArn,
      "--output",
      "json"
    )
  ).taskDefinition
  $containers = @(
    $taskDefinition.containerDefinitions | Where-Object { $_.name -eq "database-migration" }
  )
  if (
    $containers.Count -ne 1 -or
    [string]$taskDefinition.runtimePlatform.cpuArchitecture -cne "X86_64" -or
    [string]$taskDefinition.runtimePlatform.operatingSystemFamily -cne "LINUX" -or
    -not [bool]$containers[0].readonlyRootFilesystem -or
    @($containers[0].command).Count -ne 1 -or
    [string]$containers[0].command[0] -cne "runner/dist/src/main.js" -or
    @($containers[0].environment).Count -ne 1 -or
    [string]$containers[0].environment[0].name -cne "NODE_ENV" -or
    [string]$containers[0].environment[0].value -cne "production" -or
    @($containers[0].secrets).Count -ne 1 -or
    [string]$containers[0].secrets[0].name -cne "DATABASE_URL"
  ) {
    throw "The $Environment verifier task definition does not match the reviewed runtime."
  }
  $logConfiguration = $containers[0].logConfiguration
  if (
    [string]$logConfiguration.logDriver -cne "awslogs" -or
    [string]$logConfiguration.options."awslogs-group" -cne $applicationLogGroup -or
    [string]$logConfiguration.options."awslogs-region" -cne $Region -or
    -not [string]$logConfiguration.options."awslogs-stream-prefix"
  ) {
    throw "The $Environment verifier task definition does not match the reviewed log boundary."
  }
  $image = [string]$containers[0].image
  if ($image -cnotmatch "^[^@]+@sha256:[a-f0-9]{64}$") {
    throw "The $Environment verifier image must be digest pinned."
  }

  $imageParts = $image -split "@", 2
  $repositoryUri = [string]$imageParts[0]
  $digest = [string]$imageParts[1]
  $slashIndex = $repositoryUri.IndexOf("/")
  if ($slashIndex -lt 1) {
    throw "The $Environment verifier repository could not be resolved."
  }
  $repositoryName = $repositoryUri.Substring($slashIndex + 1)
  $scan = Invoke-AwsJson @(
    "ecr",
    "describe-image-scan-findings",
    "--repository-name",
    $repositoryName,
    "--image-id",
    "imageDigest=$digest",
    "--output",
    "json"
  )
  $severity = $scan.imageScanFindings.findingSeverityCounts
  $critical = if ($null -ne $severity.PSObject.Properties["CRITICAL"]) {
    [int]$severity.CRITICAL
  } else { 0 }
  $high = if ($null -ne $severity.PSObject.Properties["HIGH"]) {
    [int]$severity.HIGH
  } else { 0 }
  if (
    [string]$scan.imageScanStatus.status -cne "COMPLETE" -or
    $critical -ne 0 -or
    $high -ne 0
  ) {
    throw "The immutable $Environment verifier image scan is not clean."
  }

  return [pscustomobject]@{
    ClusterArn        = [string]$clusterArn
    TaskDefinitionArn = [string]$taskDefinitionArn
    SubnetIds         = @($subnetIds | Sort-Object)
    SecurityGroupId   = [string]$securityGroupId
    ContainerName     = [string]$containers[0].name
    LogStreamPrefix   = [string]$logConfiguration.options."awslogs-stream-prefix"
    Image             = $image
  }
}

function Invoke-DatabaseVerifier {
  param(
    [object]$Runtime,
    [string]$Mode,
    [Parameter(Mandatory = $true)]
    [string]$DatabaseHost
  )

  $containerOverride = New-D1RestoreTaskOverride $Mode $DatabaseHost
  $overrides = [ordered]@{ containerOverrides = @($containerOverride) } |
    ConvertTo-Json -Depth 8 -Compress
  $network = [ordered]@{
    awsvpcConfiguration = [ordered]@{
      subnets        = @($Runtime.SubnetIds)
      securityGroups = @([string]$Runtime.SecurityGroupId)
      assignPublicIp = "ENABLED"
    }
  } | ConvertTo-Json -Depth 5 -Compress

  Assert-CurrentAwsCaller
  $result = Invoke-AwsJson @(
    "ecs",
    "run-task",
    "--cluster",
    [string]$Runtime.ClusterArn,
    "--task-definition",
    [string]$Runtime.TaskDefinitionArn,
    "--launch-type",
    "FARGATE",
    "--count",
    "1",
    "--network-configuration",
    $network,
    "--overrides",
    $overrides,
    "--started-by",
    "d1-current-$Environment-restore-$Mode",
    "--output",
    "json"
  )
  if (@($result.failures).Count -ne 0 -or @($result.tasks).Count -ne 1) {
    throw "AWS did not start the exact $Mode restore verifier task."
  }
  $taskArn = [string]$result.tasks[0].taskArn

  $null = & aws ecs wait tasks-stopped `
    --cluster $Runtime.ClusterArn `
    --tasks $taskArn 2>$null
  if ($LASTEXITCODE -ne 0) {
    Assert-CurrentAwsCaller
    $stopped = Invoke-AwsJson @(
      "ecs", "stop-task", "--cluster", [string]$Runtime.ClusterArn,
      "--task", $taskArn, "--reason", "bounded restore verifier waiter expired",
      "--output", "json"
    )
    if ([string]$stopped.task.taskArn -cne $taskArn) {
      throw "The $Mode restore verifier task timed out and its exact stop request was not confirmed."
    }
    $null = & aws ecs wait tasks-stopped `
      --cluster $Runtime.ClusterArn `
      --tasks $taskArn 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "The $Mode restore verifier task timed out and did not reach a stopped state."
    }
    throw "The $Mode restore verifier task exceeded its bounded ECS waiter window and was stopped."
  }
  $task = @(
    (
      Invoke-AwsJson @(
        "ecs",
        "describe-tasks",
        "--cluster",
        [string]$Runtime.ClusterArn,
        "--tasks",
        $taskArn,
        "--output",
        "json"
      )
    ).tasks
  )[0]
  $containers = @($task.containers | Where-Object { $_.name -eq "database-migration" })
  $taskId = ($taskArn -split "/")[-1]
  $expectedLogStreamName = `
    "$($Runtime.LogStreamPrefix)/$($Runtime.ContainerName)/$taskId"
  $taskOverrides = @($task.overrides.containerOverrides)
  if (
    [string]$task.taskDefinitionArn -cne [string]$Runtime.TaskDefinitionArn -or
    [string]$task.clusterArn -cne [string]$Runtime.ClusterArn -or
    [string]$task.launchType -cne "FARGATE" -or
    [string]$task.lastStatus -cne "STOPPED" -or
    [string]$task.startedBy -cne "d1-current-$Environment-restore-$Mode" -or
    $taskOverrides.Count -ne 1 -or
    [string]$taskOverrides[0].name -cne "database-migration" -or
    @($taskOverrides[0].command).Count -ne 1 -or
    [string]$taskOverrides[0].command[0] -cne "runner/dist/src/restore-verifier-cli.js" -or
    @($taskOverrides[0].environment).Count -ne 1 -or
    [string]$taskOverrides[0].environment[0].name -cne "RESTORE_HOST" -or
    [string]$taskOverrides[0].environment[0].value -cne $DatabaseHost -or
    $containers.Count -ne 1 -or
    [int]$containers[0].exitCode -ne 0 -or
    [string]$containers[0].image -cne [string]$Runtime.Image -or
    [string]$containers[0].imageDigest -cne (($Runtime.Image -split "@", 2)[1]) -or
    (Test-D1RestoreLogStreamMismatch $containers[0] $expectedLogStreamName)
  ) {
    throw "The $Mode restore verifier did not complete successfully."
  }
  $logStreamName = $expectedLogStreamName

  $deadline = (Get-Date).AddMinutes(2)
  $events = @()
  do {
    $events = @(
      (
        Invoke-AwsJson @(
          "logs",
          "get-log-events",
          "--log-group-name",
          $applicationLogGroup,
          "--log-stream-name",
          $logStreamName,
          "--start-from-head",
          "--output",
          "json"
        )
      ).events
    )
    if ($events.Count -eq 0) {
      Start-Sleep -Seconds 5
    }
  } while ($events.Count -eq 0 -and (Get-Date) -lt $deadline)
  if ($events.Count -eq 0) {
    throw "The $Mode restore verifier emitted no encrypted log result."
  }

  $forbidden = @(
    $events.message | Where-Object {
      $_ -match "(?i)authorization|bearer\s+|eyJ[A-Za-z0-9_-]+\.|postgres(ql)?://|api[_-]?key|client_secret|session_secret|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    }
  )
  if ($forbidden.Count -ne 0) {
    throw "The $Mode verifier log contains a forbidden sensitive-field pattern."
  }
  $verification = ConvertFrom-D1RestoreVerifierEvents `
    @($events.message) $restoreManifestBoundary $Mode
  return [pscustomobject]@{
    ManifestId          = [string]$verification.ManifestId
    ManifestSha256      = [string]$verification.ManifestSha256
    OwnerCount          = [int]$verification.OwnerCount
    RelationCount       = [int]$verification.RelationCount
    MigrationCount      = [int]$verification.MigrationCount
    Digest              = [string]$verification.Digest
    LogEventCount       = $events.Count
    ForbiddenLogMatches = 0
  }
}

function Save-RestoreContext {
  param([object]$Context)

  if (-not (Test-Path -LiteralPath $terraformDataDirectory)) {
    throw "The $Environment Terraform backend must already be initialized."
  }
  Save-D1RestoreContextFile $Context $contextPath $restoreManifestBoundary
}

function Get-RestoreContext {
  if (
    -not (Test-Path -LiteralPath $contextPath -PathType Leaf) -and
    -not (Test-Path -LiteralPath "$contextPath.previous" -PathType Leaf)
  ) {
    throw "The ignored $Environment restore context is absent. Run Start first."
  }
  return Read-D1RestoreContextFile $contextPath $restoreManifestBoundary
}

function Get-TargetDatabase {
  param([string]$TargetIdentifier)

  $targets = @(
    (
      Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")
    ).DBInstances | Where-Object {
      [string]$_.DBInstanceIdentifier -ceq $TargetIdentifier
    }
  )
  if ($targets.Count -gt 1) {
    throw "The disposable restore target is ambiguous."
  }
  if ($targets.Count -eq 0) { return $null }
  return $targets[0]
}

function Assert-TargetBoundary {
  param(
    [object]$Source,
    [object]$Target,
    [object]$Context,
    [bool]$RequireAvailable
  )

  if (
    $null -eq $Target -or
    [string]$Target.DBInstanceIdentifier -cne [string]$Context.target_identifier -or
    [string]$Target.DBInstanceIdentifier -ceq $sourceIdentifier -or
    -not ([string]$Target.DBInstanceIdentifier).StartsWith($targetPrefix) -or
    [bool]$Target.PubliclyAccessible -or
    -not [bool]$Target.StorageEncrypted -or
    [bool]$Target.DeletionProtection -or
    [bool]$Target.MultiAZ -or
    (
      $null -ne $Context.target_resource_arn -and
      [string]$Target.DBInstanceArn -cne [string]$Context.target_resource_arn
    ) -or
    (
      $null -ne $Context.target_dbi_resource_id -and
      [string]$Target.DbiResourceId -cne [string]$Context.target_dbi_resource_id
    )
  ) {
    throw "The disposable restore target does not match the immutable safety boundary."
  }
  if ($RequireAvailable -and [string]$Target.DBInstanceStatus -cne "available") {
    throw "The disposable restore target is not available."
  }

  $sourceSecurityGroups = @($Source.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
  $targetSecurityGroups = @($Target.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
  $sourceParameterGroups = @($Source.DBParameterGroups)
  $targetParameterGroups = @($Target.DBParameterGroups)
  $sourceOptionGroups = @($Source.OptionGroupMemberships)
  $targetOptionGroups = @($Target.OptionGroupMemberships)
  $sourceLogExports = @($Source.EnabledCloudwatchLogsExports | Sort-Object)
  $targetLogExports = @($Target.EnabledCloudwatchLogsExports | Sort-Object)
  if (
    $sourceParameterGroups.Count -ne 1 -or
    $targetParameterGroups.Count -ne 1 -or
    $sourceOptionGroups.Count -ne 1 -or
    $targetOptionGroups.Count -ne 1 -or
    [string]$sourceParameterGroups[0].ParameterApplyStatus -cne "in-sync" -or
    [string]$targetParameterGroups[0].ParameterApplyStatus -cne "in-sync" -or
    [string]$sourceOptionGroups[0].Status -cne "in-sync" -or
    [string]$targetOptionGroups[0].Status -cne "in-sync" -or
    [string]$Target.KmsKeyId -cne [string]$Source.KmsKeyId -or
    [string]$Target.DBSubnetGroup.DBSubnetGroupName -cne [string]$Source.DBSubnetGroup.DBSubnetGroupName -or
    [string]$Target.DBSubnetGroup.VpcId -cne [string]$Source.DBSubnetGroup.VpcId -or
    ($sourceSecurityGroups -join ",") -cne ($targetSecurityGroups -join ",") -or
    [string]$Target.Engine -cne [string]$Source.Engine -or
    [string]$Target.EngineVersion -cne [string]$Source.EngineVersion -or
    [string]$Target.AvailabilityZone -cne [string]$Source.AvailabilityZone -or
    [bool]$Target.AutoMinorVersionUpgrade -ne [bool]$Source.AutoMinorVersionUpgrade -or
    [bool]$Target.CopyTagsToSnapshot -ne $true -or
    [string]$Target.NetworkType -cne [string]$Source.NetworkType -or
    [int]$Target.Endpoint.Port -ne [int]$Source.Endpoint.Port -or
    ($targetLogExports -join "`n") -cne ($sourceLogExports -join "`n") -or
    [string]$Target.DBInstanceClass -cne [string]$Source.DBInstanceClass -or
    [string]$Target.StorageType -cne [string]$Source.StorageType -or
    [int]$Target.AllocatedStorage -ne [int]$Source.AllocatedStorage -or
    [int]$Target.MaxAllocatedStorage -ne [int]$Source.MaxAllocatedStorage -or
    [int]$Target.Iops -ne [int]$Source.Iops -or
    [int]$Target.StorageThroughput -ne [int]$Source.StorageThroughput -or
    [bool]$Target.PerformanceInsightsEnabled -ne [bool]$Source.PerformanceInsightsEnabled -or
    [string]$Target.DBName -cne [string]$Source.DBName -or
    [string]$Target.MasterUsername -cne [string]$Source.MasterUsername -or
    [bool]$Target.IAMDatabaseAuthenticationEnabled -ne [bool]$Source.IAMDatabaseAuthenticationEnabled -or
    [string]$targetParameterGroups[0].DBParameterGroupName -cne [string]$sourceParameterGroups[0].DBParameterGroupName -or
    [string]$targetOptionGroups[0].OptionGroupName -cne [string]$sourceOptionGroups[0].OptionGroupName -or
    [string]$Target.CACertificateIdentifier -cne [string]$Source.CACertificateIdentifier
  ) {
    throw "The disposable restore target configuration differs from the approved source boundary."
  }

  $tags = Get-ResourceTags ([string]$Target.DBInstanceArn)
  if (
    $tags["Project"] -cne "ai-job-apply" -or
    $tags["Environment"] -cne $Environment -or
    $tags["ManagedBy"] -cne "restore-drill" -or
    $tags["Purpose"] -cne "d1-current-isolated-restore" -or
    $tags["StartedAt"] -cne [string]$Context.started_at
  ) {
    throw "The disposable restore target tags do not match the current exercise."
  }
  if (
    $null -ne $Context.target_boundary_sha256 -and
    (Get-D1RestoreStringSha256 (Get-SourceIdentityBoundaryJson $Target)) -cne `
      [string]$Context.target_boundary_sha256
  ) {
    throw "The disposable restore target instance identity changed."
  }
}

function Wait-TargetBoundary {
  param(
    [object]$Source,
    [object]$Context
  )

  $deadline = (Get-Date).AddMinutes(5)
  do {
    $candidate = Get-TargetDatabase ([string]$Context.target_identifier)
    try {
      Assert-TargetBoundary $Source $candidate $Context $true
      return $candidate
    }
    catch {
      if ((Get-Date) -ge $deadline) {
        throw "The available restore target did not converge to the approved boundary within five minutes."
      }
      Start-Sleep -Seconds 10
    }
  } while ($true)
}

function Invoke-StartRestore {
  Assert-ExecutionAuthorized "Restore start"
  if (
    (Test-Path -LiteralPath $contextPath -PathType Leaf) -or
    (Test-Path -LiteralPath "$contextPath.previous" -PathType Leaf)
  ) {
    throw "A $Environment restore context already exists. Resume or clean up that exercise."
  }
  if (@(Get-DisposableTargets).Count -ne 0) {
    throw "A disposable $Environment restore target already exists."
  }
  $source = Get-SourceDatabase
  Assert-SourceBoundary $source
  $null = Assert-ApplicationBaseline
  Assert-TerraformNoDrift
  $runtime = Get-MigrationRuntime
  $sourceVerification = Invoke-DatabaseVerifier `
    $runtime "source" ([string]$source.Endpoint.Address)

  $requestTime = [DateTime]::UtcNow
  $startedAt = $requestTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $targetIdentifier = "$targetPrefix$($requestTime.ToString('yyyyMMddHHmmss'))"
  $restorePoint = ([DateTime]$source.LatestRestorableTime).ToUniversalTime()
  $request = New-RestoreRequest $source $targetIdentifier $startedAt
  $requestJson = $request | ConvertTo-Json -Depth 8 -Compress
  $context = [pscustomobject][ordered]@{
    source_identifier          = $sourceIdentifier
    target_identifier          = $targetIdentifier
    started_at                 = $startedAt
    source_digest              = [string]$sourceVerification.Digest
    source_boundary_sha256     = Get-D1RestoreStringSha256 `
      (Get-SourceIdentityBoundaryJson $source)
    source_dbi_resource_id     = [string]$source.DbiResourceId
    source_resource_arn        = [string]$source.DBInstanceArn
    restore_request_sha256     = Get-D1RestoreStringSha256 $requestJson
    source_manifest_id         = [string]$sourceVerification.ManifestId
    source_manifest_sha256     = [string]$sourceVerification.ManifestSha256
    source_owner_count         = [int]$sourceVerification.OwnerCount
    source_relation_count      = [int]$sourceVerification.RelationCount
    source_migration_count     = [int]$sourceVerification.MigrationCount
    source_log_events          = [int]$sourceVerification.LogEventCount
    runtime_task_definition_arn = [string]$runtime.TaskDefinitionArn
    runtime_image              = [string]$runtime.Image
    runtime_cluster_arn        = [string]$runtime.ClusterArn
    runtime_subnet_ids         = @($runtime.SubnetIds)
    runtime_security_group_id  = [string]$runtime.SecurityGroupId
    runtime_container_name     = [string]$runtime.ContainerName
    runtime_log_stream_prefix  = [string]$runtime.LogStreamPrefix
    target_manifest_id         = $null
    target_manifest_sha256     = $null
    target_owner_count         = $null
    target_relation_count      = $null
    target_migration_count     = $null
    target_digest              = $null
    target_boundary_authenticated = $false
    target_boundary_sha256      = $null
    target_dbi_resource_id      = $null
    target_resource_arn          = $null
    restore_point_lag_seconds  = [int][Math]::Max(0, ($requestTime - $restorePoint).TotalSeconds)
    restore_available_seconds  = 0
    functional_recovery_seconds = 0
    verified                   = $false
  }
  $null = Assert-ApplicationBaseline
  Assert-TerraformNoDrift
  $freshRuntime = Get-MigrationRuntime
  Assert-D1RestoreRuntimeContext $freshRuntime $context
  $freshSource = Get-SourceDatabase
  Assert-SourceBoundary $freshSource
  Assert-SourceIdentityUnchanged $source $freshSource
  Assert-SourceContextBoundary $freshSource $context
  if (@(Get-DisposableTargets).Count -ne 0) {
    throw "A disposable $Environment restore target appeared during restore preparation."
  }
  Assert-CurrentAwsCaller
  Save-RestoreContext $context
  try {
    $null = Invoke-AwsJson @(
      "rds",
      "restore-db-instance-to-point-in-time",
      "--cli-input-json",
      $requestJson,
      "--output",
      "json"
    )
  }
  catch { throw }

  $deadline = (Get-Date).AddMinutes(60)
  do {
    Start-Sleep -Seconds 30
    $target = Get-TargetDatabase $targetIdentifier
    if ($null -ne $target -and [string]$target.DBInstanceStatus -ceq "available") {
      break
    }
    if (
      $null -ne $target -and
      @("failed", "incompatible-restore", "incompatible-network", "storage-full") `
        -ccontains [string]$target.DBInstanceStatus
    ) {
      throw "The disposable $Environment restore entered a failure state."
    }
  } while ((Get-Date) -lt $deadline)
  if ($null -eq $target -or [string]$target.DBInstanceStatus -cne "available") {
    throw "The disposable $Environment restore did not become available within 60 minutes."
  }
  $context.restore_available_seconds = [int]([DateTime]::UtcNow - $requestTime).TotalSeconds
  $target = Wait-TargetBoundary $source $context
  $context.target_boundary_authenticated = $true
  $context.target_boundary_sha256 = Get-D1RestoreStringSha256 `
    (Get-SourceIdentityBoundaryJson $target)
  $context.target_dbi_resource_id = [string]$target.DbiResourceId
  $context.target_resource_arn = [string]$target.DBInstanceArn
  Save-RestoreContext $context

  return [pscustomobject]@{
    Environment                = $Environment
    SourceManifestId           = [string]$context.source_manifest_id
    SourceManifestSha256       = [string]$context.source_manifest_sha256
    SourceOwners               = [int]$context.source_owner_count
    SourceRelations            = [int]$context.source_relation_count
    SourceMigrationEntries     = [int]$context.source_migration_count
    SourceForbiddenLogMatches  = 0
    RestorePointLagSeconds     = [int]$context.restore_point_lag_seconds
    TargetAvailable            = $true
    RestoreAvailableSeconds    = [int]$context.restore_available_seconds
    TargetPrivate              = $true
    TargetEncrypted            = $true
    TargetDeletionProtected    = $false
  }
}

function Invoke-VerifyRestore {
  Assert-ExecutionAuthorized "Restore verification"
  $context = Get-RestoreContext
  $source = Get-SourceDatabase
  Assert-SourceBoundary $source
  Assert-SourceContextBoundary $source $context
  $target = Get-TargetDatabase ([string]$context.target_identifier)
  Assert-TargetBoundary $source $target $context $true
  $context.target_boundary_authenticated = $true
  $context.target_boundary_sha256 = Get-D1RestoreStringSha256 `
    (Get-SourceIdentityBoundaryJson $target)
  $context.target_dbi_resource_id = [string]$target.DbiResourceId
  $context.target_resource_arn = [string]$target.DBInstanceArn
  Save-RestoreContext $context
  $runtime = Get-MigrationRuntime
  Assert-D1RestoreRuntimeContext $runtime $context
  $verification = Invoke-DatabaseVerifier `
    $runtime "target" ([string]$target.Endpoint.Address)
  if (
    [string]$verification.ManifestId -cne [string]$context.source_manifest_id -or
    [string]$verification.ManifestSha256 -cne [string]$context.source_manifest_sha256 -or
    [int]$verification.OwnerCount -ne [int]$context.source_owner_count -or
    [int]$verification.RelationCount -ne [int]$context.source_relation_count -or
    [int]$verification.MigrationCount -ne [int]$context.source_migration_count -or
    [string]$verification.Digest -cne [string]$context.source_digest
  ) {
    throw "The restored aggregate digest does not match the source baseline."
  }
  $startedAt = [DateTime]::Parse(
    [string]$context.started_at,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $context.functional_recovery_seconds = [int]([DateTime]::UtcNow - $startedAt).TotalSeconds
  $context.target_manifest_id = [string]$verification.ManifestId
  $context.target_manifest_sha256 = [string]$verification.ManifestSha256
  $context.target_owner_count = [int]$verification.OwnerCount
  $context.target_relation_count = [int]$verification.RelationCount
  $context.target_migration_count = [int]$verification.MigrationCount
  $context.target_digest = [string]$verification.Digest
  $context.verified = $true
  Assert-D1RestoreContextBoundary $context $restoreManifestBoundary
  Save-RestoreContext $context
  return [pscustomobject]@{
    Environment               = $Environment
    TargetManifestId          = [string]$verification.ManifestId
    TargetManifestSha256      = [string]$verification.ManifestSha256
    TargetOwners              = [int]$verification.OwnerCount
    TargetRelations           = [int]$verification.RelationCount
    TargetMigrationEntries    = [int]$verification.MigrationCount
    AggregateDigestMatch      = $true
    VerifierLogEvents         = [int]$verification.LogEventCount
    ForbiddenLogMatches       = 0
    FunctionalRecoverySeconds = [int]$context.functional_recovery_seconds
  }
}

function Invoke-CleanupRestore {
  Assert-ExecutionAuthorized "Restore cleanup"
  $context = Get-RestoreContext
  if (-not [bool]$context.verified -and -not $AllowUnverifiedCleanup) {
    throw "Cleanup requires a verified target or the explicit -AllowUnverifiedCleanup emergency gate."
  }
  $source = Get-SourceDatabase
  Assert-SourceBoundary $source
  Assert-SourceContextBoundary $source $context
  $target = Get-TargetDatabase ([string]$context.target_identifier)
  $cleanupDisposition = Get-D1RestoreCleanupDisposition $context ($null -ne $target)
  if ($cleanupDisposition -ceq "authenticate-and-delete") {
    Assert-TargetBoundary $source $target $context (-not $AllowUnverifiedCleanup)
    $context.target_boundary_authenticated = $true
    $context.target_boundary_sha256 = Get-D1RestoreStringSha256 `
      (Get-SourceIdentityBoundaryJson $target)
    $context.target_dbi_resource_id = [string]$target.DbiResourceId
    $context.target_resource_arn = [string]$target.DBInstanceArn
    Save-RestoreContext $context
    Assert-CurrentAwsCaller
    $finalDeleteTarget = Get-TargetDatabase ([string]$context.target_identifier)
    if ($null -ne $finalDeleteTarget) {
      Assert-TargetBoundary $source $finalDeleteTarget $context `
        (-not $AllowUnverifiedCleanup)
      $null = Invoke-AwsJson @(
        "rds",
        "delete-db-instance",
        "--db-instance-identifier",
        [string]$context.target_identifier,
        "--skip-final-snapshot",
        "--delete-automated-backups",
        "--output",
        "json"
      )
    }
  }
  $deadline = (Get-Date).AddMinutes(30)
  do {
    Start-Sleep -Seconds 20
    $remaining = Get-TargetDatabase ([string]$context.target_identifier)
  } while ($null -ne $remaining -and (Get-Date) -lt $deadline)
  if ($null -ne $remaining) {
    throw "The disposable $Environment restore target was not deleted within 30 minutes."
  }

  $artifactDeadline = (Get-Date).AddMinutes(10)
  do {
    $snapshots = @(
      (
        Invoke-AwsJson @(
          "rds", "describe-db-snapshots", "--snapshot-type", "manual", "--output", "json"
        )
      ).DBSnapshots | Where-Object {
        $_.DBInstanceIdentifier -eq [string]$context.target_identifier
      }
    )
    $backups = @(
      (
        Invoke-AwsJson @(
          "rds", "describe-db-instance-automated-backups", "--output", "json"
        )
      ).DBInstanceAutomatedBackups | Where-Object {
        $_.DBInstanceIdentifier -eq [string]$context.target_identifier
      }
    )
    if ($snapshots.Count -ne 0 -or $backups.Count -ne 0) {
      Start-Sleep -Seconds 20
    }
  } while (
    ($snapshots.Count -ne 0 -or $backups.Count -ne 0) -and
    (Get-Date) -lt $artifactDeadline
  )
  if ($snapshots.Count -ne 0 -or $backups.Count -ne 0) {
    throw "The disposable $Environment restore left a snapshot or automated-backup artifact."
  }
  if (@(Get-DisposableTargets).Count -ne 0) {
    throw "A disposable $Environment restore target remains after cleanup."
  }
  $finalSource = Get-SourceDatabase
  Assert-SourceBoundary $finalSource
  Assert-SourceContextBoundary $finalSource $context
  $finalBaseline = Assert-ApplicationBaseline
  Assert-TerraformNoDrift

  $resolvedContext = [IO.Path]::GetFullPath($contextPath)
  $resolvedDataDirectory = [IO.Path]::GetFullPath($terraformDataDirectory)
  if (-not $resolvedContext.StartsWith(
    $resolvedDataDirectory,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove restore context outside the Terraform data directory."
  }
  Remove-Item -LiteralPath $resolvedContext -Force
  $backupContext = "$resolvedContext.previous"
  if (Test-Path -LiteralPath $backupContext -PathType Leaf) {
    Remove-Item -LiteralPath $backupContext -Force
  }

  return [pscustomobject]@{
    Environment             = $Environment
    TargetDeleted           = $true
    RemainingRestoreTargets = 0
    RemainingSnapshots      = 0
    RemainingTargetBackups  = 0
    SourceAvailable         = $true
    EcsRuntimeIdle          = [bool]$finalBaseline.EcsRuntimeIdle
    ManagedRuntimeAlarmsOk  = [int]$finalBaseline.ManagedRuntimeAlarmsOk
    TerraformDrift          = 0
    ContextRemoved          = $true
  }
}

Assert-CallerAndTerraform

switch ($Action) {
  "Status" {
    $source = Get-SourceDatabase
    Assert-SourceBoundary $source
    $baseline = Assert-ApplicationBaseline
    $null = Get-MigrationRuntime
    $targets = @(Get-DisposableTargets)
    $contextExists = (
      (Test-Path -LiteralPath $contextPath -PathType Leaf) -or
      (Test-Path -LiteralPath "$contextPath.previous" -PathType Leaf)
    )
    [pscustomobject]@{
      Environment               = $Environment
      SourceAvailable           = $true
      SourcePrivate             = $true
      SourceEncrypted           = $true
      SourceDeletionProtected   = $true
      SourceMultiAz             = $false
      BackupRetentionDays       = 7
      LatestRestorablePoint     = $true
      EcsRuntimeIdle            = [bool]$baseline.EcsRuntimeIdle
      ManagedRuntimeAlarmsOk    = [int]$baseline.ManagedRuntimeAlarmsOk
      DisposableRestoreTargets = $targets.Count
      RestoreContext            = $contextExists
      RestoreState              = if ($contextExists) {
        if ([bool](Get-RestoreContext).verified) { "verified" } else { "in-progress" }
      } else {
        "none"
      }
    } | ConvertTo-Json
  }
  "Start" {
    Invoke-StartRestore | ConvertTo-Json
  }
  "Verify" {
    Invoke-VerifyRestore | ConvertTo-Json
  }
  "Cleanup" {
    Invoke-CleanupRestore | ConvertTo-Json
  }
  "Exercise" {
    Assert-ExecutionAuthorized "Restore exercise"
    $start = Invoke-StartRestore
    $verify = Invoke-VerifyRestore
    $cleanup = Invoke-CleanupRestore
    [pscustomobject]@{
      Environment               = $Environment
      RestorePointLagSeconds    = $start.RestorePointLagSeconds
      RestoreAvailableSeconds   = $start.RestoreAvailableSeconds
      FunctionalRecoverySeconds = $verify.FunctionalRecoverySeconds
      AggregateDigestMatch      = $verify.AggregateDigestMatch
      TargetDeleted             = $cleanup.TargetDeleted
      RemainingRestoreTargets   = $cleanup.RemainingRestoreTargets
      EcsRuntimeIdle            = $cleanup.EcsRuntimeIdle
      ManagedRuntimeAlarmsOk    = $cleanup.ManagedRuntimeAlarmsOk
      TerraformDrift            = $cleanup.TerraformDrift
      ContextRemoved            = $cleanup.ContextRemoved
    } | ConvertTo-Json
  }
}
