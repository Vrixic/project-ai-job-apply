[CmdletBinding()]
param(
  [ValidateSet("Status", "Exercise", "Recover")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\exercise-development-log-delivery.ps1
  .\scripts\exercise-development-log-delivery.ps1 -Action Exercise -Execute
  .\scripts\exercise-development-log-delivery.ps1 -Action Recover -Execute

Status is read-only. Exercise temporarily denies only logs:PutLogEvents for the gateway container's
exact CloudWatch log-stream prefix, waits for the missing-heartbeat alarm, removes the deny in a
finally block, and proves recovery. Recover removes only the drill's exact inline deny policy.

The drill is restricted to the synthetic development account. It does not modify application data,
task counts, images, provider settings, databases, queues, or the workflow-worker log stream.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

$clusterName = "ai-job-apply-development"
$gatewayServiceName = "gateway"
$workerServiceName = "workflow-worker"
$apiName = "ai-job-apply-development-gateway"
$logGroupName = "/ai-job-apply/development/application"
$alarmName = "ai-job-apply-development-gateway-log-heartbeat-missing"
$metricFilterName = "ai-job-apply-development-gateway-log-heartbeat"
$exercisePolicyName = "deny-gateway-log-delivery-exercise"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' request failed. Refresh the development SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Invoke-AwsMutation {
  param([string[]]$CommandArguments)

  $null = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' mutation failed. Run the exact Recover action before continuing."
  }
}

function Assert-DevelopmentCaller {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary development IAM Identity Center session; long-lived callers are rejected."
  }

  $configuredRegion = & aws configure get region --profile $AwsProfile 2>$null
  if ($LASTEXITCODE -ne 0 -or $configuredRegion.Trim() -ne $Region) {
    throw "The AWS profile region does not match the reviewed development region."
  }
  return [string]$identity.Account
}

function Get-ExerciseContext {
  param([string]$AccountId)

  $services = @(
    (
      Invoke-AwsJson @(
        "ecs",
        "describe-services",
        "--cluster",
        $clusterName,
        "--services",
        $gatewayServiceName,
        $workerServiceName,
        "--output",
        "json"
      )
    ).services
  )
  if ($services.Count -ne 2) {
    throw "Both exact Terraform-managed development services must be available."
  }

  $gatewayService = @($services | Where-Object { $_.serviceName -eq $gatewayServiceName })
  if ($gatewayService.Count -ne 1) {
    throw "The exact development gateway service is not available."
  }
  $taskDefinition = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$gatewayService[0].taskDefinition,
      "--output",
      "json"
    )
  ).taskDefinition
  $executionRoleArn = [string]$taskDefinition.executionRoleArn
  if (-not $executionRoleArn.EndsWith("-execution")) {
    throw "The gateway does not use the reviewed Terraform-managed execution role."
  }
  $executionRoleName = $executionRoleArn.Split("/")[-1]

  $logGroups = @(
    (
      Invoke-AwsJson @(
        "logs",
        "describe-log-groups",
        "--log-group-name-prefix",
        $logGroupName,
        "--output",
        "json"
      )
    ).logGroups | Where-Object { $_.logGroupName -eq $logGroupName }
  )
  if ($logGroups.Count -ne 1 -or -not [string]$logGroups[0].kmsKeyId) {
    throw "The exact KMS-encrypted application log group is not available."
  }

  $filters = @(
    (
      Invoke-AwsJson @(
        "logs",
        "describe-metric-filters",
        "--log-group-name",
        $logGroupName,
        "--filter-name-prefix",
        $metricFilterName,
        "--output",
        "json"
      )
    ).metricFilters | Where-Object { $_.filterName -eq $metricFilterName }
  )
  if ($filters.Count -ne 1) {
    throw "The exact gateway heartbeat metric filter is not available."
  }

  $alarms = @(
    (
      Invoke-AwsJson @(
        "cloudwatch",
        "describe-alarms",
        "--alarm-names",
        $alarmName,
        "--output",
        "json"
      )
    ).MetricAlarms
  )
  if ($alarms.Count -ne 1) {
    throw "The exact gateway missing-heartbeat alarm is not available."
  }

  $apis = @(
    (Invoke-AwsJson @("apigatewayv2", "get-apis", "--output", "json")).Items |
      Where-Object { $_.Name -eq $apiName }
  )
  if ($apis.Count -ne 1 -or -not [string]$apis[0].ApiEndpoint) {
    throw "The exact development API endpoint is not available."
  }

  $inlinePolicyNames = @(
    (
      Invoke-AwsJson @(
        "iam",
        "list-role-policies",
        "--role-name",
        $executionRoleName,
        "--output",
        "json"
      )
    ).PolicyNames
  )

  return @{
    AccountId             = $AccountId
    Alarm                 = $alarms[0]
    ApiEndpoint           = [string]$apis[0].ApiEndpoint
    ExecutionRoleName     = $executionRoleName
    ExercisePolicyPresent = $inlinePolicyNames -contains $exercisePolicyName
    Services              = $services
  }
}

function Assert-StableServices {
  param([object[]]$Services)

  foreach ($service in $Services) {
    $primary = @($service.deployments | Where-Object { $_.status -eq "PRIMARY" })
    if (
      [string]$service.status -ne "ACTIVE" -or
      [int]$service.desiredCount -ne 1 -or
      [int]$service.runningCount -ne 1 -or
      [int]$service.pendingCount -ne 0 -or
      $primary.Count -ne 1 -or
      [string]$primary[0].rolloutState -ne "COMPLETED"
    ) {
      throw "A development service is not stable at the lean one-task baseline."
    }
  }
}

function Assert-GatewayHealth {
  param([string]$ApiEndpoint)

  try {
    $response = Invoke-WebRequest `
      -Uri "$ApiEndpoint/health/live" `
      -Method Get `
      -UseBasicParsing `
      -TimeoutSec 15
  }
  catch {
    throw "The gateway live endpoint is unavailable."
  }
  if ([int]$response.StatusCode -ne 200) {
    throw "The gateway live endpoint did not return HTTP 200."
  }
}

function Wait-ForAlarmState {
  param(
    [ValidateSet("ALARM", "OK")]
    [string]$ExpectedState,
    [int]$TimeoutSeconds = 600
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $result = Invoke-AwsJson @(
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      $alarmName,
      "--output",
      "json"
    )
    $alarm = @($result.MetricAlarms)[0]
    if ($alarm -and [string]$alarm.StateValue -eq $ExpectedState) {
      return
    }
    Start-Sleep -Seconds 10
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "The gateway heartbeat alarm did not reach the expected state within the bounded wait."
}

function Remove-ExercisePolicy {
  param([string]$RoleName)

  Invoke-AwsMutation @(
    "iam",
    "delete-role-policy",
    "--role-name",
    $RoleName,
    "--policy-name",
    $exercisePolicyName
  )
}

function Add-ExercisePolicy {
  param(
    [string]$RoleName,
    [string]$AccountId
  )

  $policyPath = [IO.Path]::GetTempFileName()
  try {
    $policy = @{
      Version   = "2012-10-17"
      Statement = @(
        @{
          Sid      = "DenyGatewayLogDeliveryExercise"
          Effect   = "Deny"
          Action   = "logs:PutLogEvents"
          Resource = "arn:aws:logs:${Region}:${AccountId}:log-group:${logGroupName}:log-stream:gateway/*"
        }
      )
    } | ConvertTo-Json -Depth 5 -Compress
    [IO.File]::WriteAllText($policyPath, $policy, [Text.UTF8Encoding]::new($false))
    Invoke-AwsMutation @(
      "iam",
      "put-role-policy",
      "--role-name",
      $RoleName,
      "--policy-name",
      $exercisePolicyName,
      "--policy-document",
      "file://$policyPath"
    )
  }
  finally {
    if (Test-Path -LiteralPath $policyPath) {
      Remove-Item -LiteralPath $policyPath -Force
    }
  }
}

$accountId = Assert-DevelopmentCaller
$context = Get-ExerciseContext $accountId
Assert-StableServices $context.Services
Assert-GatewayHealth $context.ApiEndpoint

switch ($Action) {
  "Status" {
    [pscustomobject]@{
      GatewayHealthy       = $true
      StableServiceCount   = $context.Services.Count
      HeartbeatAlarmState  = [string]$context.Alarm.StateValue
      AlarmActionCount     = @($context.Alarm.AlarmActions).Count
      OkActionCount        = @($context.Alarm.OKActions).Count
      RecoveryPolicyAbsent = -not $context.ExercisePolicyPresent
    } | Format-List
  }
  "Recover" {
    if (-not $Execute) {
      throw "Recover removes the drill's exact IAM policy. Re-run with -Execute after review."
    }
    if ($context.ExercisePolicyPresent) {
      Remove-ExercisePolicy $context.ExecutionRoleName
    }
    Wait-ForAlarmState "OK"
    $recovered = Get-ExerciseContext $accountId
    Assert-StableServices $recovered.Services
    Assert-GatewayHealth $recovered.ApiEndpoint
    if ($recovered.ExercisePolicyPresent) {
      throw "The drill policy still exists after recovery."
    }
    Write-Output "Gateway log delivery recovered and the exact drill policy is absent."
  }
  "Exercise" {
    if (-not $Execute) {
      throw "Exercise temporarily changes one IAM permission and sends notifications. Re-run with -Execute."
    }
    if ($context.ExercisePolicyPresent) {
      throw "The exact drill policy already exists. Run Recover before starting a new exercise."
    }
    if ([string]$context.Alarm.StateValue -ne "OK") {
      throw "The gateway heartbeat alarm must begin in OK."
    }
    if (
      @($context.Alarm.AlarmActions).Count -lt 1 -or
      @($context.Alarm.OKActions).Count -lt 1
    ) {
      throw "The gateway heartbeat alarm must have both ALARM and OK notification actions."
    }

    $policyAdded = $false
    try {
      Add-ExercisePolicy $context.ExecutionRoleName $accountId
      $policyAdded = $true
      Wait-ForAlarmState "ALARM"
      Assert-GatewayHealth $context.ApiEndpoint
      Write-Output "Gateway log heartbeat reached ALARM while the live endpoint remained healthy."
    }
    finally {
      if ($policyAdded) {
        Remove-ExercisePolicy $context.ExecutionRoleName
      }
    }

    Wait-ForAlarmState "OK"
    $recovered = Get-ExerciseContext $accountId
    Assert-StableServices $recovered.Services
    Assert-GatewayHealth $recovered.ApiEndpoint
    if ($recovered.ExercisePolicyPresent) {
      throw "The drill policy still exists after the exercise."
    }
    Write-Output "Gateway log delivery recovered to OK; both services remain stable."
    Write-Output "Confirm receipt of the sanitized ALARM and OK notifications before recording evidence."
  }
}
