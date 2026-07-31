[CmdletBinding()]
param(
  [ValidateSet("Status", "Start", "Verify", "Cleanup", "Exercise")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$AllowUnverifiedCleanup,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Status
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Start -Execute
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Verify -Execute
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Cleanup -Execute
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Exercise -Execute
  .\scripts\operate-staging-postgresql-restore.ps1 -Action Cleanup `
    -AllowUnverifiedCleanup -Execute

Status is read-only. Start runs the immutable read-only source verifier, requests one uniquely
tagged latest-point-in-time restore, and waits for it to become available. Verify runs the same
read-only verifier against the isolated copy and requires an exact aggregate digest match.
Cleanup deletes only the verified, uniquely tagged disposable target and its automated backups,
then proves source/application health and Terraform no drift. Exercise runs Start, Verify, and
Cleanup in sequence. State is retained in the ignored staging Terraform data directory so an
interrupted exercise can resume safely.

All state-changing actions require -Execute. AllowUnverifiedCleanup is an emergency cleanup gate
for an exact failed disposable target; it never weakens target identity, tag, network, or source
guards.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 staging environment is restricted to us-east-2."
}

$environmentDirectory = (Resolve-Path "infrastructure/terraform/environments/staging").Path
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform"
$contextPath = Join-Path $terraformDataDirectory "applydash-staging-restore-context.json"
$sourceIdentifier = "ai-job-apply-staging"
$targetPrefix = "ai-job-apply-staging-restore-"
$applicationLogGroup = "/ai-job-apply/staging/application"
$recoveryOperator = Join-Path $PSScriptRoot "operate-staging-application-recovery.ps1"

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

function Assert-ExecutionAuthorized {
  param([string]$Operation)

  if (-not $Execute) {
    throw "$Operation requires -Execute."
  }
}

function Assert-CallerAndTerraform {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary staging IAM Identity Center session; long-lived callers are rejected."
  }
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required for this restore procedure."
  }
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
    throw "The exact Terraform-managed staging source database is unavailable."
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

function Assert-SourceBoundary {
  param([object]$Source)

  $tags = Get-ResourceTags ([string]$Source.DBInstanceArn)
  if (
    [string]$Source.DBInstanceIdentifier -ne $sourceIdentifier -or
    [string]$Source.DBInstanceStatus -ne "available" -or
    [bool]$Source.PubliclyAccessible -or
    -not [bool]$Source.StorageEncrypted -or
    -not [bool]$Source.DeletionProtection -or
    [bool]$Source.MultiAZ -or
    [int]$Source.BackupRetentionPeriod -ne 7 -or
    $null -eq $Source.LatestRestorableTime -or
    $tags["Project"] -ne "ai-job-apply" -or
    $tags["Environment"] -ne "staging" -or
    $tags["ManagedBy"] -ne "terraform"
  ) {
    throw "The staging source database does not match the reviewed restore boundary."
  }
  if (
    @($Source.VpcSecurityGroups).Count -ne 1 -or
    @($Source.DBParameterGroups).Count -ne 1 -or
    @($Source.OptionGroupMemberships).Count -ne 1 -or
    [string]$Source.DBParameterGroups[0].ParameterApplyStatus -ne "in-sync" -or
    [string]$Source.OptionGroupMemberships[0].Status -ne "in-sync"
  ) {
    throw "The staging source database network or parameter boundary is not stable."
  }
}

function Get-DisposableTargets {
  $databases = @(
    (Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")).DBInstances
  )
  return @(
    $databases | Where-Object {
      [string]$_.DBInstanceIdentifier -like "$targetPrefix*"
    }
  )
}

function Assert-ApplicationBaseline {
  $statusJson = & $recoveryOperator -Action Status 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The staging application baseline did not pass."
  }
  $status = $statusJson | ConvertFrom-Json
  if (
    [string]$status.Applications -ne "enabled" -or
    [int]$status.StableServices -ne 2 -or
    [int]$status.LiveStatus -ne 200 -or
    [int]$status.ReadyStatus -ne 200 -or
    [int]$status.ProtectedStatus -ne 401
  ) {
    throw "The staging application baseline is not healthy."
  }

  $alarms = @(
    (
      Invoke-AwsJson @(
        "cloudwatch",
        "describe-alarms",
        "--alarm-name-prefix",
        "ai-job-apply-staging",
        "--output",
        "json"
      )
    ).MetricAlarms
  )
  if ($alarms.Count -ne 8 -or @($alarms | Where-Object { $_.StateValue -ne "OK" }).Count -ne 0) {
    throw "All eight managed staging alarms must be OK."
  }
}

function Assert-TerraformNoDrift {
  $resultJson = & $recoveryOperator -Action NoDrift 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The exact-input staging Terraform no-drift check failed."
  }
  $result = $resultJson | ConvertFrom-Json
  if ([int]$result.TerraformDrift -ne 0) {
    throw "The staging Terraform state is not drift free."
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
    throw "The encrypted staging state did not expose the exact verifier runtime."
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
    [string]$taskDefinition.runtimePlatform.cpuArchitecture -ne "X86_64" -or
    [string]$taskDefinition.runtimePlatform.operatingSystemFamily -ne "LINUX"
  ) {
    throw "The staging verifier task definition does not match the reviewed runtime."
  }
  $logConfiguration = $containers[0].logConfiguration
  if (
    [string]$logConfiguration.logDriver -ne "awslogs" -or
    [string]$logConfiguration.options."awslogs-group" -ne $applicationLogGroup -or
    [string]$logConfiguration.options."awslogs-region" -ne $Region -or
    -not [string]$logConfiguration.options."awslogs-stream-prefix"
  ) {
    throw "The staging verifier task definition does not match the reviewed log boundary."
  }
  $image = [string]$containers[0].image
  if ($image -notmatch "^[^@]+@sha256:[a-f0-9]{64}$") {
    throw "The staging verifier image must be digest pinned."
  }

  $imageParts = $image -split "@", 2
  $repositoryUri = [string]$imageParts[0]
  $digest = [string]$imageParts[1]
  $slashIndex = $repositoryUri.IndexOf("/")
  if ($slashIndex -lt 1) {
    throw "The staging verifier repository could not be resolved."
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
  if (
    [string]$scan.imageScanStatus.status -ne "COMPLETE" -or
    [int]$severity.CRITICAL -ne 0 -or
    [int]$severity.HIGH -ne 0 -or
    [int]$severity.MEDIUM -ne 0 -or
    [int]$severity.LOW -ne 0
  ) {
    throw "The immutable staging verifier image scan is not clean."
  }

  return [pscustomobject]@{
    ClusterArn        = [string]$clusterArn
    TaskDefinitionArn = [string]$taskDefinitionArn
    SubnetIds         = $subnetIds
    SecurityGroupId   = [string]$securityGroupId
    ContainerName     = [string]$containers[0].name
    LogStreamPrefix   = [string]$logConfiguration.options."awslogs-stream-prefix"
  }
}

function Invoke-DatabaseVerifier {
  param(
    [object]$Runtime,
    [string]$Mode,
    [string]$RestoreHost = ""
  )

  $verifierSource = @'
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const requireFromProfileService = createRequire(
  new URL("./backend/services/profile/package.json", import.meta.url)
);
const postgres = requireFromProfileService("postgres");

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
const url = new URL(sourceUrl);
if (process.env.RESTORE_HOST) url.hostname = process.env.RESTORE_HOST;

const tables = [
  "identity.users",
  "identity.external_identities",
  "profile.job_preferences",
  "platform.operations",
  "platform.outbox_events",
  "platform.idempotency_keys",
  "platform.audit_events",
  "platform.schema_migrations"
];
const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined });
try {
  const result = await sql.begin("read only", async (tx) => {
    const [shape] = await tx.unsafe(`
      SELECT (
        (to_regclass('identity.users') IS NOT NULL)::int +
        (to_regclass('identity.external_identities') IS NOT NULL)::int +
        (to_regclass('profile.job_preferences') IS NOT NULL)::int +
        (to_regclass('platform.operations') IS NOT NULL)::int +
        (to_regclass('platform.outbox_events') IS NOT NULL)::int +
        (to_regclass('platform.idempotency_keys') IS NOT NULL)::int +
        (to_regclass('platform.audit_events') IS NOT NULL)::int +
        (to_regclass('platform.schema_migrations') IS NOT NULL)::int
      )::int AS table_count,
      (SELECT count(*)::int FROM platform.schema_migrations
       WHERE version = '0001_foundation') AS migration_count
    `);
    if (shape.table_count !== 8 || shape.migration_count !== 1) {
      throw new Error("Restore schema verification failed");
    }
    const counts = [];
    for (const table of tables) {
      const [row] = await tx.unsafe(`SELECT count(*)::text AS count FROM ${table}`);
      counts.push([table, row.count]);
    }
    return {
      table_count: shape.table_count,
      migration_count: shape.migration_count,
      digest: createHash("sha256").update(JSON.stringify(counts)).digest("hex")
    };
  });
  console.log(JSON.stringify({ event: "phase0_restore_verification", ...result }));
} finally {
  await sql.end();
}
'@

  $containerOverride = [ordered]@{
    name    = "database-migration"
    command = @("--input-type=module", "--eval", $verifierSource)
  }
  if ($RestoreHost) {
    $containerOverride.environment = @(
      [ordered]@{ name = "RESTORE_HOST"; value = $RestoreHost }
    )
  }
  $overrides = [ordered]@{ containerOverrides = @($containerOverride) } |
    ConvertTo-Json -Depth 8 -Compress
  $network = [ordered]@{
    awsvpcConfiguration = [ordered]@{
      subnets        = @($Runtime.SubnetIds)
      securityGroups = @([string]$Runtime.SecurityGroupId)
      assignPublicIp = "ENABLED"
    }
  } | ConvertTo-Json -Depth 5 -Compress

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
    "phase0-staging-restore-$Mode",
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
    throw "The $Mode restore verifier task did not stop within the ECS waiter window."
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
  if (
    $containers.Count -ne 1 -or
    [int]$containers[0].exitCode -ne 0
  ) {
    throw "The $Mode restore verifier did not complete successfully."
  }
  $logStreamName = [string]$containers[0].logStreamName
  if (-not $logStreamName) {
    $taskId = ($taskArn -split "/")[-1]
    $logStreamName = "$($Runtime.LogStreamPrefix)/$($Runtime.ContainerName)/$taskId"
  }

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
      $_ -match "(?i)authorization|bearer\s+|eyJ[A-Za-z0-9_-]+\.|postgres(ql)?://|temporal-api-key|client_secret|session_secret|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    }
  )
  if ($forbidden.Count -ne 0) {
    throw "The $Mode verifier log contains a forbidden sensitive-field pattern."
  }
  $results = @()
  foreach ($event in $events) {
    try {
      $parsed = [string]$event.message | ConvertFrom-Json
      if ([string]$parsed.event -eq "phase0_restore_verification") {
        $results += $parsed
      }
    }
    catch {
      continue
    }
  }
  if (
    $results.Count -ne 1 -or
    [int]$results[0].table_count -ne 8 -or
    [int]$results[0].migration_count -ne 1 -or
    [string]$results[0].digest -notmatch "^[a-f0-9]{64}$"
  ) {
    throw "The $Mode verifier did not emit the exact sanitized aggregate result."
  }
  return [pscustomobject]@{
    Digest              = [string]$results[0].digest
    TableCount          = 8
    MigrationCount      = 1
    LogEventCount       = $events.Count
    ForbiddenLogMatches = 0
  }
}

function Save-RestoreContext {
  param([object]$Context)

  if (-not (Test-Path -LiteralPath $terraformDataDirectory)) {
    throw "The staging Terraform backend must already be initialized."
  }
  $Context | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $contextPath -Encoding UTF8
}

function Get-RestoreContext {
  if (-not (Test-Path -LiteralPath $contextPath)) {
    throw "The ignored staging restore context is absent. Run Start first."
  }
  return Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
}

function Get-TargetDatabase {
  param([string]$TargetIdentifier)

  $raw = & aws rds describe-db-instances `
    --db-instance-identifier $TargetIdentifier `
    --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }
  $targets = @(($raw | ConvertFrom-Json).DBInstances)
  if ($targets.Count -ne 1) {
    throw "The disposable restore target is ambiguous."
  }
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
    [string]$Target.DBInstanceIdentifier -ne [string]$Context.target_identifier -or
    [string]$Target.DBInstanceIdentifier -eq $sourceIdentifier -or
    -not ([string]$Target.DBInstanceIdentifier).StartsWith($targetPrefix) -or
    [bool]$Target.PubliclyAccessible -or
    -not [bool]$Target.StorageEncrypted -or
    [bool]$Target.DeletionProtection -or
    [bool]$Target.MultiAZ
  ) {
    throw "The disposable restore target does not match the immutable safety boundary."
  }
  if ($RequireAvailable -and [string]$Target.DBInstanceStatus -ne "available") {
    throw "The disposable restore target is not available."
  }

  $sourceSecurityGroups = @($Source.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
  $targetSecurityGroups = @($Target.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
  if (
    [string]$Target.KmsKeyId -ne [string]$Source.KmsKeyId -or
    [string]$Target.DBSubnetGroup.DBSubnetGroupName -ne [string]$Source.DBSubnetGroup.DBSubnetGroupName -or
    [string]$Target.DBSubnetGroup.VpcId -ne [string]$Source.DBSubnetGroup.VpcId -or
    ($sourceSecurityGroups -join ",") -ne ($targetSecurityGroups -join ",") -or
    [string]$Target.Engine -ne [string]$Source.Engine -or
    [string]$Target.EngineVersion -ne [string]$Source.EngineVersion -or
    [string]$Target.DBInstanceClass -ne [string]$Source.DBInstanceClass -or
    [string]$Target.StorageType -ne [string]$Source.StorageType -or
    [int]$Target.AllocatedStorage -ne [int]$Source.AllocatedStorage -or
    [string]$Target.DBName -ne [string]$Source.DBName -or
    [string]$Target.MasterUsername -ne [string]$Source.MasterUsername -or
    [bool]$Target.IAMDatabaseAuthenticationEnabled -ne [bool]$Source.IAMDatabaseAuthenticationEnabled -or
    [string]$Target.DBParameterGroups[0].DBParameterGroupName -ne [string]$Source.DBParameterGroups[0].DBParameterGroupName -or
    [string]$Target.OptionGroupMemberships[0].OptionGroupName -ne [string]$Source.OptionGroupMemberships[0].OptionGroupName -or
    [string]$Target.CACertificateIdentifier -ne [string]$Source.CACertificateIdentifier
  ) {
    throw "The disposable restore target configuration differs from the approved source boundary."
  }

  $tags = Get-ResourceTags ([string]$Target.DBInstanceArn)
  if (
    $tags["Project"] -ne "ai-job-apply" -or
    $tags["Environment"] -ne "staging" -or
    $tags["ManagedBy"] -ne "restore-drill" -or
    $tags["Purpose"] -ne "phase0-isolated-restore" -or
    $tags["StartedAt"] -ne [string]$Context.started_at
  ) {
    throw "The disposable restore target tags do not match the current exercise."
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
  if (Test-Path -LiteralPath $contextPath) {
    throw "A staging restore context already exists. Resume or clean up that exercise."
  }
  if ((Get-DisposableTargets).Count -ne 0) {
    throw "A disposable staging restore target already exists."
  }
  $source = Get-SourceDatabase
  Assert-SourceBoundary $source
  Assert-ApplicationBaseline
  Assert-TerraformNoDrift
  $runtime = Get-MigrationRuntime
  $sourceVerification = Invoke-DatabaseVerifier $runtime "source"

  $requestTime = [DateTime]::UtcNow
  $startedAt = $requestTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $targetIdentifier = "$targetPrefix$($requestTime.ToString('yyyyMMddHHmmss'))"
  $restorePoint = ([DateTime]$source.LatestRestorableTime).ToUniversalTime()
  $context = [ordered]@{
    source_identifier          = $sourceIdentifier
    target_identifier          = $targetIdentifier
    started_at                 = $startedAt
    source_digest              = [string]$sourceVerification.Digest
    source_table_count         = 8
    source_migration_count     = 1
    source_log_events          = [int]$sourceVerification.LogEventCount
    restore_point_lag_seconds  = [int][Math]::Max(0, ($requestTime - $restorePoint).TotalSeconds)
    restore_available_seconds  = 0
    functional_recovery_seconds = 0
    verified                   = $false
  }
  Save-RestoreContext $context

  $request = [ordered]@{
    SourceDBInstanceIdentifier       = $sourceIdentifier
    TargetDBInstanceIdentifier       = $targetIdentifier
    UseLatestRestorableTime          = $true
    DBInstanceClass                  = [string]$source.DBInstanceClass
    Port                             = [int]$source.Endpoint.Port
    AvailabilityZone                 = [string]$source.AvailabilityZone
    DBSubnetGroupName                = [string]$source.DBSubnetGroup.DBSubnetGroupName
    MultiAZ                         = $false
    PubliclyAccessible              = $false
    AutoMinorVersionUpgrade         = [bool]$source.AutoMinorVersionUpgrade
    OptionGroupName                 = [string]$source.OptionGroupMemberships[0].OptionGroupName
    CopyTagsToSnapshot              = $true
    StorageType                     = [string]$source.StorageType
    VpcSecurityGroupIds             = @($source.VpcSecurityGroups.VpcSecurityGroupId)
    EnableIAMDatabaseAuthentication = [bool]$source.IAMDatabaseAuthenticationEnabled
    EnableCloudwatchLogsExports     = @("postgresql")
    DBParameterGroupName            = [string]$source.DBParameterGroups[0].DBParameterGroupName
    DeletionProtection              = $false
    AllocatedStorage                = [int]$source.AllocatedStorage
    CACertificateIdentifier         = [string]$source.CACertificateIdentifier
    NetworkType                     = [string]$source.NetworkType
    Tags                            = @(
      [ordered]@{ Key = "Project"; Value = "ai-job-apply" },
      [ordered]@{ Key = "Environment"; Value = "staging" },
      [ordered]@{ Key = "ManagedBy"; Value = "restore-drill" },
      [ordered]@{ Key = "Purpose"; Value = "phase0-isolated-restore" },
      [ordered]@{ Key = "StartedAt"; Value = $startedAt }
    )
  }
  try {
    $null = Invoke-AwsJson @(
      "rds",
      "restore-db-instance-to-point-in-time",
      "--cli-input-json",
      ($request | ConvertTo-Json -Depth 8 -Compress),
      "--output",
      "json"
    )
  }
  catch {
    if ($null -eq (Get-TargetDatabase $targetIdentifier)) {
      Remove-Item -LiteralPath $contextPath -Force
    }
    throw
  }

  $deadline = (Get-Date).AddMinutes(60)
  do {
    Start-Sleep -Seconds 30
    $target = Get-TargetDatabase $targetIdentifier
    if ($null -ne $target -and [string]$target.DBInstanceStatus -eq "available") {
      break
    }
    if (
      $null -ne $target -and
      [string]$target.DBInstanceStatus -match "failed|incompatible|storage-full"
    ) {
      throw "The disposable staging restore entered a failure state."
    }
  } while ((Get-Date) -lt $deadline)
  if ($null -eq $target -or [string]$target.DBInstanceStatus -ne "available") {
    throw "The disposable staging restore did not become available within 60 minutes."
  }
  $context.restore_available_seconds = [int]([DateTime]::UtcNow - $requestTime).TotalSeconds
  Save-RestoreContext $context
  $target = Wait-TargetBoundary $source $context

  return [pscustomobject]@{
    Environment                = "staging"
    SourceSchemaTables         = 8
    SourceMigrationEntries     = 1
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
  $target = Get-TargetDatabase ([string]$context.target_identifier)
  Assert-TargetBoundary $source $target $context $true
  $runtime = Get-MigrationRuntime
  $verification = Invoke-DatabaseVerifier `
    $runtime "target" ([string]$target.Endpoint.Address)
  if ([string]$verification.Digest -ne [string]$context.source_digest) {
    throw "The restored aggregate digest does not match the source baseline."
  }
  $startedAt = [DateTime]::Parse(
    [string]$context.started_at,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  ).ToUniversalTime()
  $context.functional_recovery_seconds = [int]([DateTime]::UtcNow - $startedAt).TotalSeconds
  $context.verified = $true
  Save-RestoreContext $context
  return [pscustomobject]@{
    Environment               = "staging"
    TargetSchemaTables        = 8
    TargetMigrationEntries    = 1
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
  $target = Get-TargetDatabase ([string]$context.target_identifier)
  Assert-TargetBoundary $source $target $context (-not $AllowUnverifiedCleanup)

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
  $deadline = (Get-Date).AddMinutes(30)
  do {
    Start-Sleep -Seconds 20
    $remaining = Get-TargetDatabase ([string]$context.target_identifier)
  } while ($null -ne $remaining -and (Get-Date) -lt $deadline)
  if ($null -ne $remaining) {
    throw "The disposable staging restore target was not deleted within 30 minutes."
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
    throw "The disposable staging restore left a snapshot or automated-backup artifact."
  }
  if ((Get-DisposableTargets).Count -ne 0) {
    throw "A disposable staging restore target remains after cleanup."
  }
  Assert-SourceBoundary (Get-SourceDatabase)
  Assert-ApplicationBaseline
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

  return [pscustomobject]@{
    Environment             = "staging"
    TargetDeleted           = $true
    RemainingRestoreTargets = 0
    RemainingSnapshots      = 0
    RemainingTargetBackups  = 0
    SourceAvailable         = $true
    StableServices          = 2
    ManagedAlarmsOk         = 8
    TerraformDrift          = 0
    ContextRemoved          = $true
  }
}

Assert-CallerAndTerraform

switch ($Action) {
  "Status" {
    $source = Get-SourceDatabase
    Assert-SourceBoundary $source
    Assert-ApplicationBaseline
    $null = Get-MigrationRuntime
    $targets = Get-DisposableTargets
    $contextExists = Test-Path -LiteralPath $contextPath
    [pscustomobject]@{
      Environment               = "staging"
      SourceAvailable           = $true
      SourcePrivate             = $true
      SourceEncrypted           = $true
      SourceDeletionProtected   = $true
      SourceMultiAz             = $false
      BackupRetentionDays       = 7
      LatestRestorablePoint     = $true
      StableServices            = 2
      ManagedAlarmsOk           = 8
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
      Environment               = "staging"
      RestorePointLagSeconds    = $start.RestorePointLagSeconds
      RestoreAvailableSeconds   = $start.RestoreAvailableSeconds
      FunctionalRecoverySeconds = $verify.FunctionalRecoverySeconds
      AggregateDigestMatch      = $verify.AggregateDigestMatch
      TargetDeleted             = $cleanup.TargetDeleted
      RemainingRestoreTargets   = $cleanup.RemainingRestoreTargets
      StableServices            = $cleanup.StableServices
      ManagedAlarmsOk           = $cleanup.ManagedAlarmsOk
      TerraformDrift            = $cleanup.TerraformDrift
      ContextRemoved            = $cleanup.ContextRemoved
    } | ConvertTo-Json
  }
}
