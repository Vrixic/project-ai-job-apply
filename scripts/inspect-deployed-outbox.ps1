[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("development", "staging")]
  [string]$Environment,

  [string]$AwsProfile = "ai-job-apply-$Environment-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$IncludeEventIds,

  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentDirectory = Join-Path $repositoryRoot "infrastructure/terraform/environments/$Environment"
$applicationLogGroup = "/ai-job-apply/$Environment/application"

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $json = & aws @Arguments --profile $AwsProfile --region $Region
  if ($LASTEXITCODE -ne 0) {
    throw "AWS inspection failed. Refresh the selected SSO profile and retry."
  }
  return $json | ConvertFrom-Json
}

function Get-TerraformOutput {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [switch]$Json
  )

  $previousProfile = $env:AWS_PROFILE
  $previousRegion = $env:AWS_REGION
  try {
    $env:AWS_PROFILE = $AwsProfile
    $env:AWS_REGION = $Region
    $format = if ($Json) { "-json" } else { "-raw" }
    $value = & terraform "-chdir=$environmentDirectory" output $format $Name 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "Terraform could not read the encrypted $Environment state output."
    }
    return $value
  } finally {
    if ($null -eq $previousProfile) {
      Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
    } else {
      $env:AWS_PROFILE = $previousProfile
    }
    if ($null -eq $previousRegion) {
      Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
    } else {
      $env:AWS_REGION = $previousRegion
    }
  }
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI is required."
}
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
  throw "Terraform 1.9.8 is required."
}
if (-not (Test-Path -LiteralPath $environmentDirectory -PathType Container)) {
  throw "The selected Terraform environment does not exist."
}

$caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (-not [string]$caller.Account -or -not [string]$caller.Arn) {
  throw "The selected AWS caller identity is incomplete."
}

$clusterArn = Get-TerraformOutput -Name ecs_cluster_arn
$taskDefinitionArn = Get-TerraformOutput -Name migration_task_definition_arn
$subnetIds = @(
  Get-TerraformOutput -Name migration_subnet_ids -Json | ConvertFrom-Json
)
$securityGroupId = Get-TerraformOutput -Name application_security_group_id
if (
  -not $clusterArn -or
  -not $taskDefinitionArn -or
  $subnetIds.Count -ne 2 -or
  -not $securityGroupId
) {
  throw "The encrypted environment state does not expose the exact on-demand inspection runtime."
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
if ($containers.Count -ne 1) {
  throw "The expected on-demand database task container was not found."
}
$container = $containers[0]
if (
  [string]$taskDefinition.runtimePlatform.cpuArchitecture -ne "X86_64" -or
  [string]$taskDefinition.runtimePlatform.operatingSystemFamily -ne "LINUX" -or
  [string]$container.image -notmatch "^[^@]+@sha256:[a-f0-9]{64}$" -or
  @($container.secrets | Where-Object { $_.name -eq "DATABASE_URL" }).Count -ne 1 -or
  [string]$container.logConfiguration.logDriver -ne "awslogs" -or
  [string]$container.logConfiguration.options."awslogs-group" -ne $applicationLogGroup
) {
  throw "The on-demand inspection task does not match the reviewed immutable runtime boundary."
}

$preflight = [ordered]@{
  Environment                  = $Environment
  Region                       = $Region
  CallerVerified               = $true
  ImmutableTaskImage           = $true
  ReadOnlyTransaction          = $true
  PayloadFieldsSelected        = $false
  IndividualEventIdsRequested  = [bool]$IncludeEventIds
  CloudMutation                = [bool]$Execute
}

if (-not $Execute) {
  $preflight | ConvertTo-Json
  Write-Output "Preflight passed. Add -Execute to start exactly one bounded read-only Fargate task."
  exit 0
}

$override = @{
  containerOverrides = @(
    @{
      name        = "database-migration"
      command     = @("backend/services/profile/dist/src/inspect-outbox.js")
      environment = @(
        @{
          name  = "OUTBOX_INSPECTION_INCLUDE_EVENT_IDS"
          value = $(if ($IncludeEventIds) { "true" } else { "false" })
        }
      )
    }
  )
} | ConvertTo-Json -Depth 8 -Compress
$networkConfiguration = "awsvpcConfiguration={subnets=[$($subnetIds -join ',')],securityGroups=[$securityGroupId],assignPublicIp=ENABLED}"
$run = Invoke-AwsJson @(
  "ecs",
  "run-task",
  "--cluster",
  [string]$clusterArn,
  "--task-definition",
  [string]$taskDefinitionArn,
  "--launch-type",
  "FARGATE",
  "--count",
  "1",
  "--network-configuration",
  $networkConfiguration,
  "--overrides",
  $override,
  "--started-by",
  "phase0-outbox-inspection",
  "--no-enable-execute-command",
  "--output",
  "json"
)
if (@($run.failures).Count -ne 0 -or @($run.tasks).Count -ne 1) {
  throw "AWS did not accept exactly one inspection task."
}

$taskArn = [string]$run.tasks[0].taskArn
& aws ecs wait tasks-stopped --profile $AwsProfile --region $Region --cluster $clusterArn `
  --tasks $taskArn
if ($LASTEXITCODE -ne 0) {
  throw "The inspection task did not stop within the bounded AWS waiter window."
}
$stoppedTask = (
  Invoke-AwsJson @(
    "ecs",
    "describe-tasks",
    "--cluster",
    [string]$clusterArn,
    "--tasks",
    $taskArn,
    "--output",
    "json"
  )
).tasks[0]
$stoppedContainers = @(
  $stoppedTask.containers | Where-Object { $_.name -eq "database-migration" }
)
if ($stoppedContainers.Count -ne 1 -or [int]$stoppedContainers[0].exitCode -ne 0) {
  throw "The read-only inspection task did not complete successfully. Inspect the sanitized task log."
}

$taskId = ($taskArn -split "/")[-1]
$streamPrefix = [string]$container.logConfiguration.options."awslogs-stream-prefix"
$logStream = "$streamPrefix/database-migration/$taskId"
$messages = @()
for ($attempt = 0; $attempt -lt 12 -and $messages.Count -eq 0; $attempt++) {
  $events = Invoke-AwsJson @(
    "logs",
    "get-log-events",
    "--log-group-name",
    $applicationLogGroup,
    "--log-stream-name",
    $logStream,
    "--start-from-head",
    "--output",
    "json"
  )
  $messages = @($events.events | ForEach-Object { [string]$_.message } | Where-Object { $_ })
  if ($messages.Count -eq 0) {
    Start-Sleep -Seconds 5
  }
}
if ($messages.Count -ne 1) {
  throw "The inspection task did not emit exactly one sanitized result record."
}

try {
  $inspection = $messages[0] | ConvertFrom-Json
} catch {
  throw "The inspection result was not valid JSON."
}
if (
  [int]$inspection.version -ne 1 -or
  [int]$inspection.pendingCount -lt 0 -or
  [string]$inspection.orderedEventIdSha256 -notmatch "^[a-f0-9]{64}$"
) {
  throw "The inspection result did not match the sanitized version-one contract."
}
if (-not $IncludeEventIds -and $null -ne $inspection.eventIds) {
  throw "The inspection emitted event identifiers without explicit authorization."
}

$inspection | ConvertTo-Json -Depth 4
