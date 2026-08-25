[CmdletBinding()]
param(
  [ValidateSet("Validate", "Plan", "Assess", "Execute")]
  [string]$Action = "Validate",
  [string]$ConfigPath = "infrastructure/observability/d1-representative-acceptance.example.json",
  [ValidatePattern("^[0-9a-f]{64}$")]
  [string]$ReviewedConfigSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-d1-representative-acceptance.ps1 -Action Validate
  .\scripts\operate-d1-representative-acceptance.ps1 -Action Plan `
    -ConfigPath <ignored-reviewed-config.json> -ReviewedConfigSha256 <sha256>
  .\scripts\operate-d1-representative-acceptance.ps1 -Action Assess `
    -ConfigPath <ignored-reviewed-config.json> -ReviewedConfigSha256 <sha256>

Validate accepts the source-controlled draft and reports why it is not executable. Plan and Assess
require an exact reviewed configuration checksum. Assess consumes only aggregate D1 workload and
AWS corroboration JSON below the ignored development .terraform acceptance directory. Execute is
fail-closed while the required provider-failure profile has no supported guarded synthetic fixture.
No action invokes GitHub Actions, Vercel, Docker, WSL, a provider, AWS mutation, or candidate data.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development"))
$evidenceRoot = [IO.Path]::GetFullPath((Join-Path $terraformRoot ".terraform\d1-representative-acceptance"))
$requiredArtifactNames = @(
  "gateway",
  "workflow-ingress",
  "profile-readiness-durable",
  "profile-readiness-activity"
)

function Resolve-RepositoryPath {
  param([Parameter(Mandatory)][string]$Path)
  if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
  return [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path))
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertFrom-StrictJson {
  param(
    [Parameter(Mandatory)][string]$Json,
    [Parameter(Mandatory)][string]$Description
  )
  try { return $Json | ConvertFrom-Json }
  catch { throw "$Description is not valid JSON." }
}

function Assert-ExactProperties {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string[]]$Names,
    [Parameter(Mandatory)][string]$Description
  )
  $actual = @($Value.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $expected = @($Names | Sort-Object)
  if (($actual -join "|") -cne ($expected -join "|")) {
    throw "$Description must contain exactly: $($expected -join ', ')."
  }
}

function Test-CanonicalTimestamp {
  param([object]$Value)
  if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') {
    return $false
  }
  $parsed = [DateTime]::MinValue
  return [DateTime]::TryParseExact(
    $Value,
    "yyyy-MM-ddTHH:mm:ss.fffZ",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$parsed
  )
}

function Test-IntegerValue {
  param([object]$Value, [int]$Minimum)
  if ($null -eq $Value -or $Value -is [bool]) { return $false }
  try { return ([long]$Value -eq [double]$Value) -and [long]$Value -ge $Minimum }
  catch { return $false }
}

function Get-ConfigurationIssues {
  param([Parameter(Mandatory)][object]$Config)
  $issues = New-Object Collections.Generic.List[string]
  try {
    Assert-ExactProperties $Config @(
      "schemaVersion", "kind", "status", "environment", "release", "run", "thresholds", "profiles"
    ) "Configuration"
    Assert-ExactProperties $Config.release @(
      "sourceSha", "terraformStateSerial", "runtimePlanPath", "runtimePlanSha256", "artifacts", "migrationImage"
    ) "Release"
    Assert-ExactProperties $Config.run @(
      "runId", "generatedSyntheticOnly", "oneRunOnly", "cleanupRequired", "recoveryRequired", "ledgerPath"
    ) "Run"
    Assert-ExactProperties $Config.thresholds @(
      "concurrency", "durationMs", "latencyMs", "errors", "queues", "alerts"
    ) "Thresholds"
    Assert-ExactProperties $Config.profiles @(
      "read", "savedJob", "match", "providerFailure", "alertDelivery", "postRun"
    ) "Profiles"
  } catch { $issues.Add($_.Exception.Message); return @($issues) }

  if ([int]$Config.schemaVersion -ne 1) { $issues.Add("schemaVersion must be 1") }
  if ([string]$Config.kind -cne "d1-representative-deployed-acceptance") { $issues.Add("kind is invalid") }
  if ([string]$Config.status -notin @("draft", "reviewed")) { $issues.Add("status must be draft or reviewed") }
  if ([string]$Config.environment -cne "development") { $issues.Add("environment must be development") }

  foreach ($flag in @("generatedSyntheticOnly", "oneRunOnly", "cleanupRequired", "recoveryRequired")) {
    if ($Config.run.$flag -isnot [bool] -or -not [bool]$Config.run.$flag) {
      $issues.Add("run.$flag must be true")
    }
  }
  if ($null -ne $Config.run.runId -and [string]$Config.run.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    $issues.Add("run.runId must be a lowercase version-4 UUID")
  }

  $thresholdGroups = [ordered]@{
    concurrency = [ordered]@{ read = 1; savedJob = 1; match = 1; providerFailure = 1 }
    durationMs = [ordered]@{ read = 1; savedJob = 1; match = 1; providerFailure = 1; recovery = 1; alertTransition = 1 }
    latencyMs = [ordered]@{ publicP95 = 1; authenticatedP95 = 1; apiAverage = 1; apiMaximum = 1; lambdaMaximum = 1 }
    errors = [ordered]@{ maxApplicationFailures = 0; maxApi5xx = 0; maxLambdaErrors = 0; maxLambdaThrottles = 0; maxErrorLogMatches = 0; maxForbiddenLogMatches = 0 }
    queues = [ordered]@{ maxOldestAgeSeconds = 0; maxVisible = 0; maxEventDlq = 0; maxDurableDlq = 0 }
  }
  foreach ($group in $thresholdGroups.GetEnumerator()) {
    try { Assert-ExactProperties $Config.thresholds.($group.Key) @($group.Value.Keys) "thresholds.$($group.Key)" }
    catch { $issues.Add($_.Exception.Message); continue }
    foreach ($entry in $group.Value.GetEnumerator()) {
      $value = $Config.thresholds.($group.Key).($entry.Key)
      if ($null -ne $value -and -not (Test-IntegerValue $value $entry.Value)) {
        $issues.Add("thresholds.$($group.Key).$($entry.Key) is invalid")
      }
    }
  }
  try {
    Assert-ExactProperties $Config.thresholds.alerts @(
      "expectedHealthyAlarmCount", "expectedConfirmedRecipientCount", "reviewedRecipientSetSha256"
    ) "thresholds.alerts"
  } catch { $issues.Add($_.Exception.Message) }
  foreach ($name in @("expectedHealthyAlarmCount", "expectedConfirmedRecipientCount")) {
    $value = $Config.thresholds.alerts.$name
    if ($null -ne $value -and -not (Test-IntegerValue $value 1)) {
      $issues.Add("thresholds.alerts.$name is invalid")
    }
  }
  if ($null -ne $Config.thresholds.alerts.reviewedRecipientSetSha256 -and
    [string]$Config.thresholds.alerts.reviewedRecipientSetSha256 -notmatch '^[0-9a-f]{64}$') {
    $issues.Add("thresholds.alerts.reviewedRecipientSetSha256 is invalid")
  }

  foreach ($profileName in @("read", "savedJob", "match")) {
    $profile = $Config.profiles.$profileName
    try { Assert-ExactProperties $profile @("required", "resultPath", "awsResultPath") "profiles.$profileName" }
    catch { $issues.Add($_.Exception.Message); continue }
    if ($profile.required -isnot [bool] -or -not [bool]$profile.required) {
      $issues.Add("profiles.$profileName.required must be true")
    }
  }
  try {
    Assert-ExactProperties $Config.profiles.providerFailure @(
      "required", "state", "blocker", "existingGuardedSyntheticFixture"
    ) "profiles.providerFailure"
    if ([string]$Config.profiles.providerFailure.state -cne "blocked" -or
      [string]::IsNullOrWhiteSpace([string]$Config.profiles.providerFailure.blocker) -or
      $null -ne $Config.profiles.providerFailure.existingGuardedSyntheticFixture) {
      $issues.Add("providerFailure must retain the fail-closed blocked placeholder")
    }
  } catch { $issues.Add($_.Exception.Message) }
  try {
    Assert-ExactProperties $Config.profiles.alertDelivery @(
      "required", "statusResultPath", "exerciseResultPath", "operatorDeliveryConfirmed"
    ) "profiles.alertDelivery"
    Assert-ExactProperties $Config.profiles.postRun @("aggregateResultPath", "zeroDriftResultPath") "profiles.postRun"
  } catch { $issues.Add($_.Exception.Message) }

  if ($null -ne $Config.release.sourceSha -and [string]$Config.release.sourceSha -notmatch '^[0-9a-f]{40}$') {
    $issues.Add("release.sourceSha is invalid")
  }
  if ($null -ne $Config.release.runtimePlanSha256 -and [string]$Config.release.runtimePlanSha256 -notmatch '^[0-9a-f]{64}$') {
    $issues.Add("release.runtimePlanSha256 is invalid")
  }
  if ($null -ne $Config.release.terraformStateSerial -and -not (Test-IntegerValue $Config.release.terraformStateSerial 1)) {
    $issues.Add("release.terraformStateSerial is invalid")
  }
  try {
    Assert-ExactProperties $Config.release.migrationImage @("sourceSha", "platformDigest", "receiptSha256") "Migration image"
    if ($null -ne $Config.release.migrationImage.sourceSha -and [string]$Config.release.migrationImage.sourceSha -notmatch '^[0-9a-f]{40}$') { $issues.Add("migration image sourceSha is invalid") }
    if ($null -ne $Config.release.migrationImage.platformDigest -and [string]$Config.release.migrationImage.platformDigest -notmatch '^sha256:[0-9a-f]{64}$') { $issues.Add("migration image platformDigest is invalid") }
    if ($null -ne $Config.release.migrationImage.receiptSha256 -and [string]$Config.release.migrationImage.receiptSha256 -notmatch '^[0-9a-f]{64}$') { $issues.Add("migration image receiptSha256 is invalid") }
  } catch { $issues.Add($_.Exception.Message) }
  $artifactNames = @()
  foreach ($artifact in @($Config.release.artifacts)) {
    try { Assert-ExactProperties $artifact @("name", "sha256", "base64Sha256", "objectVersionId") "Release artifact" }
    catch { $issues.Add($_.Exception.Message); continue }
    $artifactNames += [string]$artifact.name
    if ([string]$artifact.name -notin $requiredArtifactNames) { $issues.Add("release artifact name is invalid") }
    if ($null -ne $artifact.sha256 -and [string]$artifact.sha256 -notmatch '^[0-9a-f]{64}$') { $issues.Add("release artifact sha256 is invalid") }
    if ($null -ne $artifact.base64Sha256 -and [string]$artifact.base64Sha256 -notmatch '^[A-Za-z0-9+/]{43}=$') { $issues.Add("release artifact base64Sha256 is invalid") }
  }
  if (@($artifactNames | Select-Object -Unique).Count -ne $artifactNames.Count) {
    $issues.Add("release artifacts contain duplicate names")
  }
  return @($issues)
}

function Get-ReadinessIssues {
  param([Parameter(Mandatory)][object]$Config)
  $issues = New-Object Collections.Generic.List[string]
  if ([string]$Config.status -cne "reviewed") { $issues.Add("configuration status is not reviewed") }
  foreach ($path in @(
      "release.sourceSha", "release.terraformStateSerial", "release.runtimePlanPath",
      "release.runtimePlanSha256", "run.runId", "run.ledgerPath"
    )) {
    $parts = $path.Split('.')
    if ($null -eq $Config.($parts[0]).($parts[1]) -or [string]::IsNullOrWhiteSpace([string]$Config.($parts[0]).($parts[1]))) {
      $issues.Add("$path is required for a reviewed run")
    }
  }
  $thresholdJson = $Config.thresholds | ConvertTo-Json -Depth 10 -Compress
  if ($thresholdJson -match ':null') { $issues.Add("every threshold and reviewed recipient binding must be explicit") }
  if ($null -ne $Config.thresholds.concurrency.read -and [int]$Config.thresholds.concurrency.read -ne 2) {
    $issues.Add("the reviewed read concurrency must match the fixed deployed development profile concurrency of 2")
  }
  foreach ($name in @("savedJob", "match")) {
    if ($null -ne $Config.thresholds.concurrency.$name -and [int]$Config.thresholds.concurrency.$name -ne 1) {
      $issues.Add("the reviewed $name concurrency must match its single-flight profile concurrency of 1")
    }
  }
  if ((@($Config.release.artifacts | ForEach-Object name | Sort-Object) -join '|') -cne
    (@($requiredArtifactNames | Sort-Object) -join '|')) {
    $issues.Add("the exact four Lambda artifact bindings are required")
  }
  foreach ($artifact in @($Config.release.artifacts)) {
    if ($null -eq $artifact.sha256 -or $null -eq $artifact.base64Sha256 -or
      [string]::IsNullOrWhiteSpace([string]$artifact.objectVersionId)) {
      $issues.Add("every release artifact requires digest and exact object-version binding")
    }
  }
  if ([string]$Config.release.migrationImage.sourceSha -cne [string]$Config.release.sourceSha -or
    [string]$Config.release.migrationImage.platformDigest -notmatch '^sha256:[0-9a-f]{64}$' -or
    [string]$Config.release.migrationImage.receiptSha256 -notmatch '^[0-9a-f]{64}$') {
    $issues.Add("the migration image must bind the exact release source, platform digest, and receipt")
  }
  foreach ($profileName in @("read", "savedJob", "match")) {
    foreach ($property in @("resultPath", "awsResultPath")) {
      if ([string]::IsNullOrWhiteSpace([string]$Config.profiles.$profileName.$property)) {
        $issues.Add("profiles.$profileName.$property is required")
      }
    }
  }
  foreach ($property in @("statusResultPath", "exerciseResultPath")) {
    if ([string]::IsNullOrWhiteSpace([string]$Config.profiles.alertDelivery.$property)) {
      $issues.Add("profiles.alertDelivery.$property is required")
    }
  }
  if ($Config.profiles.alertDelivery.operatorDeliveryConfirmed -isnot [bool] -or
    -not [bool]$Config.profiles.alertDelivery.operatorDeliveryConfirmed) {
    $issues.Add("alert delivery requires attributable operator confirmation")
  }
  foreach ($property in @("aggregateResultPath", "zeroDriftResultPath")) {
    if ([string]::IsNullOrWhiteSpace([string]$Config.profiles.postRun.$property)) {
      $issues.Add("profiles.postRun.$property is required")
    }
  }
  $issues.Add("provider-failure/fault/recovery automation is blocked: $($Config.profiles.providerFailure.blocker)")
  return @($issues)
}

function Resolve-PrivateEvidencePath {
  param([Parameter(Mandatory)][string]$Path, [switch]$RequireFile)
  $resolved = Resolve-RepositoryPath $Path
  $prefix = $evidenceRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Acceptance evidence must remain below the ignored development .terraform acceptance directory."
  }
  if ($RequireFile -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "A required aggregate evidence file is missing."
  }
  return $resolved
}

function Read-AggregateJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)
  $resolved = Resolve-PrivateEvidencePath $Path -RequireFile
  return ConvertFrom-StrictJson (Get-Content -LiteralPath $resolved -Raw) $Description
}

function Assert-D1ApplicationResult {
  param(
    [Parameter(Mandatory)][ValidateSet("read", "savedJob", "match")][string]$Profile,
    [Parameter(Mandatory)][object]$Result,
    [Parameter(Mandatory)][object]$Thresholds
  )
  $common = @("profile", "startedAt", "endedAt", "durationMs")
  $expectedProfile = switch ($Profile) {
    "read" { "d1_deployed_read_v1" }
    "savedJob" { "d1_deployed_saved_job_lifecycle_v1" }
    default { "d1_deployed_match_assessment_v1" }
  }
  $specific = switch ($Profile) {
    "read" { @("baselineContractsValidated", "publicRequests", "publicFailures", "authenticatedRequests", "authenticatedFailures", "publicLatency", "authenticatedLatency") }
    "savedJob" { @("catalogPagesValidated", "savedJobPagesValidated", "writesSucceeded", "idempotentReplays", "expectedConflicts", "cleanupDeletes", "postCleanupAbsent") }
    default { @("catalogPagesValidated", "matchAssessmentsValidated", "evidenceItemsValidated") }
  }
  Assert-ExactProperties $Result @($common + $specific) "$Profile application aggregate"
  if ([string]$Result.profile -cne $expectedProfile -or -not (Test-CanonicalTimestamp $Result.startedAt) -or
    -not (Test-CanonicalTimestamp $Result.endedAt)) { throw "$Profile application aggregate binding is invalid." }
  $maximumDuration = [long]$Thresholds.durationMs.$Profile
  if (-not (Test-IntegerValue $Result.durationMs 1) -or [long]$Result.durationMs -gt $maximumDuration) {
    throw "$Profile application duration exceeds its reviewed threshold."
  }
  if ($Profile -ceq "read") {
    Assert-ExactProperties $Result.publicLatency @("p50Ms", "p95Ms", "maxMs") "Public latency"
    Assert-ExactProperties $Result.authenticatedLatency @("p50Ms", "p95Ms", "maxMs") "Authenticated latency"
    if ([int]$Result.baselineContractsValidated -ne 4 -or [int]$Result.publicRequests -ne 150 -or
      [int]$Result.authenticatedRequests -ne 100 -or
      [int]$Result.publicFailures -gt [int]$Thresholds.errors.maxApplicationFailures -or
      [int]$Result.authenticatedFailures -gt [int]$Thresholds.errors.maxApplicationFailures -or
      [int]$Result.publicLatency.p95Ms -gt [int]$Thresholds.latencyMs.publicP95 -or
      [int]$Result.authenticatedLatency.p95Ms -gt [int]$Thresholds.latencyMs.authenticatedP95) {
      throw "The read aggregate did not satisfy its reviewed fixed profile and thresholds."
    }
  } elseif ($Profile -ceq "savedJob") {
    if ([int]$Result.writesSucceeded -ne 1 -or [int]$Result.idempotentReplays -ne 1 -or
      [int]$Result.expectedConflicts -ne 1 -or [int]$Result.cleanupDeletes -ne 1 -or
      $Result.postCleanupAbsent -isnot [bool] -or -not [bool]$Result.postCleanupAbsent) {
      throw "The saved-job aggregate did not prove one-run cleanup semantics."
    }
  } else {
    if ([int]$Result.catalogPagesValidated -ne 1 -or [int]$Result.matchAssessmentsValidated -ne 1 -or
      [int]$Result.evidenceItemsValidated -lt 1) {
      throw "The match aggregate did not prove its bounded assessment contract."
    }
  }
}

function Assert-AwsAggregateResult {
  param(
    [Parameter(Mandatory)][ValidateSet("D1Read", "D1SavedJob", "D1Match")][string]$Profile,
    [Parameter(Mandatory)][object]$Result,
    [Parameter(Mandatory)][object]$Thresholds
  )
  $properties = @(
    "Environment", "WorkloadProfile", "WindowMinutes", "ApiRequests", "MinimumApiRequests",
    "ApiRequestsMeetMinimum", "Api4xx", "MinimumExpected4xx", "Expected4xxMeetMinimum", "Api5xx",
    "ApiLatencyAverageMs", "ApiLatencyMaximumMs", "LambdaInvocations", "LambdaErrors",
    "LambdaThrottles", "LambdaDurationMaximumMs", "DatabaseCpuMaxPercent", "DatabaseConnectionsMax",
    "EventQueueAgeMaxSeconds", "EventQueueVisibleMax", "DeadLetterMessagesMax", "DurableDeadLetterMax",
    "LogEvents", "LogErrorMatches", "ForbiddenLogMatches", "ActiveEcsServices", "RunningEcsTasks",
    "RuntimeAlarmsOk", "DispatchTarget", "TriggersEnabled", "TerraformDrift"
  )
  Assert-ExactProperties $Result $properties "$Profile AWS aggregate"
  if ([string]$Result.Environment -cne "development" -or [string]$Result.WorkloadProfile -cne $Profile -or
    $Result.ApiRequestsMeetMinimum -isnot [bool] -or -not [bool]$Result.ApiRequestsMeetMinimum -or
    $Result.Expected4xxMeetMinimum -isnot [bool] -or -not [bool]$Result.Expected4xxMeetMinimum -or
    [string]$Result.DispatchTarget -cne "lambda_durable" -or
    $Result.TriggersEnabled -isnot [bool] -or -not [bool]$Result.TriggersEnabled -or
    [int]$Result.TerraformDrift -ne 0) { throw "$Profile AWS aggregate binding is invalid." }
  $failed = @()
  if ([decimal]$Result.ApiLatencyAverageMs -gt [decimal]$Thresholds.latencyMs.apiAverage) { $failed += "api_average" }
  if ([decimal]$Result.ApiLatencyMaximumMs -gt [decimal]$Thresholds.latencyMs.apiMaximum) { $failed += "api_maximum" }
  if ([decimal]$Result.LambdaDurationMaximumMs -gt [decimal]$Thresholds.latencyMs.lambdaMaximum) { $failed += "lambda_maximum" }
  if ([int]$Result.Api5xx -gt [int]$Thresholds.errors.maxApi5xx) { $failed += "api_5xx" }
  if ([int]$Result.LambdaErrors -gt [int]$Thresholds.errors.maxLambdaErrors) { $failed += "lambda_errors" }
  if ([int]$Result.LambdaThrottles -gt [int]$Thresholds.errors.maxLambdaThrottles) { $failed += "lambda_throttles" }
  if ([int]$Result.LogErrorMatches -gt [int]$Thresholds.errors.maxErrorLogMatches) { $failed += "error_logs" }
  if ([int]$Result.ForbiddenLogMatches -gt [int]$Thresholds.errors.maxForbiddenLogMatches) { $failed += "forbidden_logs" }
  if ([decimal]$Result.EventQueueAgeMaxSeconds -gt [decimal]$Thresholds.queues.maxOldestAgeSeconds) { $failed += "queue_age" }
  if ([decimal]$Result.EventQueueVisibleMax -gt [decimal]$Thresholds.queues.maxVisible) { $failed += "queue_visible" }
  if ([decimal]$Result.DeadLetterMessagesMax -gt [decimal]$Thresholds.queues.maxEventDlq) { $failed += "event_dlq" }
  if ([decimal]$Result.DurableDeadLetterMax -gt [decimal]$Thresholds.queues.maxDurableDlq) { $failed += "durable_dlq" }
  if ([int]$Result.RuntimeAlarmsOk -ne [int]$Thresholds.alerts.expectedHealthyAlarmCount) { $failed += "alarm_count" }
  if ([int]$Result.ActiveEcsServices -ne 0 -or [int]$Result.RunningEcsTasks -ne 0) { $failed += "ecs_not_idle" }
  if ($failed.Count -ne 0) { throw "$Profile AWS aggregate failed reviewed checks: $($failed -join ', ')." }
}

function Assert-AlertDeliveryResults {
  param(
    [Parameter(Mandatory)][object]$StatusResult,
    [Parameter(Mandatory)][object]$ExerciseResult,
    [Parameter(Mandatory)][object]$Thresholds
  )
  Assert-ExactProperties $StatusResult @(
    "profile", "checkedAt", "confirmedRecipients", "pendingRecipients", "canaryState",
    "alarmActionCount", "okActionCount", "healthyRuntimeAlarms"
  ) "Alert status aggregate"
  Assert-ExactProperties $ExerciseResult @(
    "profile", "startedAt", "endedAt", "durationMs", "alarmTransitions", "recoveryTransitions",
    "deliveryConfirmed", "reviewedRecipientSetSha256", "finalCanaryState"
  ) "Alert exercise aggregate"
  if ([string]$StatusResult.profile -cne "d1_deployed_alert_status_v1" -or
    -not (Test-CanonicalTimestamp $StatusResult.checkedAt) -or
    [int]$StatusResult.confirmedRecipients -ne [int]$Thresholds.alerts.expectedConfirmedRecipientCount -or
    [int]$StatusResult.pendingRecipients -ne 0 -or [string]$StatusResult.canaryState -cne "OK" -or
    [int]$StatusResult.alarmActionCount -lt 1 -or [int]$StatusResult.okActionCount -lt 1 -or
    [int]$StatusResult.healthyRuntimeAlarms -ne [int]$Thresholds.alerts.expectedHealthyAlarmCount) {
    throw "Alert status does not match the reviewed recipient and alarm boundary."
  }
  if ([string]$ExerciseResult.profile -cne "d1_deployed_alert_delivery_v1" -or
    -not (Test-CanonicalTimestamp $ExerciseResult.startedAt) -or
    -not (Test-CanonicalTimestamp $ExerciseResult.endedAt) -or
    [int]$ExerciseResult.durationMs -gt [int]$Thresholds.durationMs.alertTransition -or
    [int]$ExerciseResult.alarmTransitions -ne 1 -or [int]$ExerciseResult.recoveryTransitions -ne 1 -or
    $ExerciseResult.deliveryConfirmed -isnot [bool] -or -not [bool]$ExerciseResult.deliveryConfirmed -or
    [string]$ExerciseResult.reviewedRecipientSetSha256 -cne [string]$Thresholds.alerts.reviewedRecipientSetSha256 -or
    [string]$ExerciseResult.finalCanaryState -cne "OK") {
    throw "Alert exercise does not prove reviewed ALARM-to-OK delivery and recovery."
  }
}

function Assert-PostRunResults {
  param(
    [Parameter(Mandatory)][object]$Aggregate,
    [Parameter(Mandatory)][object]$ZeroDrift,
    [Parameter(Mandatory)][object]$Config
  )
  Assert-ExactProperties $Aggregate @(
    "profile", "startedAt", "endedAt", "durationMs", "providerFaultsInjected",
    "providerFailuresObserved", "recoveriesSucceeded", "cleanupAttempted", "cleanupSucceeded",
    "postCleanupArtifacts", "alertDeliveriesConfirmed", "eventQueueAgeMaxSeconds",
    "eventQueueVisibleMax", "eventDeadLetterMax", "durableDeadLetterMax", "logErrorMatches",
    "forbiddenLogMatches"
  ) "Post-run aggregate"
  Assert-ExactProperties $ZeroDrift @(
    "profile", "checkedAt", "sourceSha", "runtimePlanSha256", "terraformStateSerial",
    "meaningfulChanges", "drift"
  ) "Post-run zero-drift aggregate"
  $thresholds = $Config.thresholds
  if ([string]$Aggregate.profile -cne "d1_deployed_provider_failure_recovery_v1" -or
    -not (Test-CanonicalTimestamp $Aggregate.startedAt) -or -not (Test-CanonicalTimestamp $Aggregate.endedAt) -or
    [int]$Aggregate.durationMs -gt [int]$thresholds.durationMs.providerFailure -or
    [int]$Aggregate.providerFaultsInjected -ne 1 -or [int]$Aggregate.providerFailuresObserved -ne 1 -or
    [int]$Aggregate.recoveriesSucceeded -ne 1 -or $Aggregate.cleanupAttempted -isnot [bool] -or
    -not [bool]$Aggregate.cleanupAttempted -or $Aggregate.cleanupSucceeded -isnot [bool] -or
    -not [bool]$Aggregate.cleanupSucceeded -or [int]$Aggregate.postCleanupArtifacts -ne 0 -or
    [int]$Aggregate.alertDeliveriesConfirmed -lt 1 -or
    [decimal]$Aggregate.eventQueueAgeMaxSeconds -gt [decimal]$thresholds.queues.maxOldestAgeSeconds -or
    [decimal]$Aggregate.eventQueueVisibleMax -gt [decimal]$thresholds.queues.maxVisible -or
    [decimal]$Aggregate.eventDeadLetterMax -gt [decimal]$thresholds.queues.maxEventDlq -or
    [decimal]$Aggregate.durableDeadLetterMax -gt [decimal]$thresholds.queues.maxDurableDlq -or
    [int]$Aggregate.logErrorMatches -gt [int]$thresholds.errors.maxErrorLogMatches -or
    [int]$Aggregate.forbiddenLogMatches -gt [int]$thresholds.errors.maxForbiddenLogMatches) {
    throw "Post-run provider failure, cleanup, recovery, queue, or privacy evidence did not pass."
  }
  if ([string]$ZeroDrift.profile -cne "d1_post_run_zero_drift_v1" -or
    -not (Test-CanonicalTimestamp $ZeroDrift.checkedAt) -or
    [string]$ZeroDrift.sourceSha -cne [string]$Config.release.sourceSha -or
    [string]$ZeroDrift.runtimePlanSha256 -cne [string]$Config.release.runtimePlanSha256 -or
    [long]$ZeroDrift.terraformStateSerial -ne [long]$Config.release.terraformStateSerial -or
    [int]$ZeroDrift.meaningfulChanges -ne 0 -or $ZeroDrift.drift -isnot [bool] -or
    [bool]$ZeroDrift.drift) { throw "Post-run zero drift is not bound to the exact reviewed release." }
}

function Read-ReviewedConfiguration {
  $resolvedConfig = Resolve-RepositoryPath $ConfigPath
  if (-not (Test-Path -LiteralPath $resolvedConfig -PathType Leaf)) { throw "The configuration file is missing." }
  $hash = Get-FileSha256 $resolvedConfig
  if ($Action -ne "Validate" -and ([string]::IsNullOrWhiteSpace($ReviewedConfigSha256) -or
    $hash -cne $ReviewedConfigSha256)) { throw "The configuration does not match its reviewed SHA-256." }
  $config = ConvertFrom-StrictJson (Get-Content -LiteralPath $resolvedConfig -Raw) "Acceptance configuration"
  $structuralIssues = @(Get-ConfigurationIssues $config)
  if ($structuralIssues.Count -ne 0) { throw "Configuration validation failed: $($structuralIssues -join '; ')." }
  return [pscustomobject]@{ Config = $config; Hash = $hash; Path = $resolvedConfig }
}

$configuration = Read-ReviewedConfiguration
$readinessIssues = @(Get-ReadinessIssues $configuration.Config)

if ($Action -ceq "Validate" -or $Action -ceq "Plan") {
  [pscustomobject]@{
    SchemaVersion = 1
    Kind = "d1-representative-deployed-acceptance-plan"
    ConfigSha256 = $configuration.Hash
    Status = [string]$configuration.Config.status
    GeneratedSyntheticOnly = [bool]$configuration.Config.run.generatedSyntheticOnly
    AggregateMetricsOnly = $true
    OrderedStages = @(
      "exact-release-binding", "managed-oidc-read", "managed-oidc-saved-job",
      "managed-oidc-match", "provider-failure-fault-recovery", "alert-delivery",
      "backlog-dlq-alarm-privacy", "cleanup-recovery", "post-run-zero-drift"
    )
    Executable = $readinessIssues.Count -eq 0
    BlockingIssues = $readinessIssues
  } | ConvertTo-Json -Depth 10
  exit 0
}

if ($Action -ceq "Execute") {
  if ($readinessIssues.Count -ne 0) {
    throw "Execution is fail-closed: $($readinessIssues -join '; ')."
  }
  throw "Execution is unavailable until a supported guarded generated-synthetic provider fixture is implemented and reviewed."
}

# Assess validates only already-produced aggregate evidence. It deliberately cannot create a
# provider fault, send an alert, move a queue item, mutate a candidate, or change Terraform.
$assessmentIssues = New-Object Collections.Generic.List[string]
foreach ($issue in $readinessIssues) { $assessmentIssues.Add($issue) }
$applicationProfiles = [ordered]@{ read = "D1Read"; savedJob = "D1SavedJob"; match = "D1Match" }
$passedProfiles = 0
foreach ($profile in $applicationProfiles.GetEnumerator()) {
  try {
    $applicationResult = Read-AggregateJson $configuration.Config.profiles.($profile.Key).resultPath "$($profile.Key) application aggregate"
    Assert-D1ApplicationResult $profile.Key $applicationResult $configuration.Config.thresholds
    $awsResult = Read-AggregateJson $configuration.Config.profiles.($profile.Key).awsResultPath "$($profile.Key) AWS aggregate"
    Assert-AwsAggregateResult $profile.Value $awsResult $configuration.Config.thresholds
    $passedProfiles += 1
  } catch { $assessmentIssues.Add($_.Exception.Message) }
}

$alertDeliveryAccepted = $false
try {
  $alertStatus = Read-AggregateJson $configuration.Config.profiles.alertDelivery.statusResultPath "Alert status aggregate"
  $alertExercise = Read-AggregateJson $configuration.Config.profiles.alertDelivery.exerciseResultPath "Alert exercise aggregate"
  Assert-AlertDeliveryResults $alertStatus $alertExercise $configuration.Config.thresholds
  $alertDeliveryAccepted = $true
} catch { $assessmentIssues.Add($_.Exception.Message) }

$postRunAccepted = $false
try {
  $postAggregate = Read-AggregateJson $configuration.Config.profiles.postRun.aggregateResultPath "Post-run aggregate"
  $zeroDrift = Read-AggregateJson $configuration.Config.profiles.postRun.zeroDriftResultPath "Post-run zero-drift aggregate"
  Assert-PostRunResults $postAggregate $zeroDrift $configuration.Config
  $postRunAccepted = $true
} catch { $assessmentIssues.Add($_.Exception.Message) }

[pscustomobject]@{
  SchemaVersion = 1
  Kind = "d1-representative-deployed-acceptance-assessment"
  ConfigSha256 = $configuration.Hash
  ApplicationAwsProfilesPassed = $passedProfiles
  ApplicationAwsProfilesRequired = 3
  ProviderFailureAutomated = $false
  AlertDeliveryAccepted = $alertDeliveryAccepted
  PostRunZeroDriftAccepted = $postRunAccepted
  AggregateMetricsOnly = $true
  Accepted = $false
  BlockingIssues = @($assessmentIssues | Select-Object -Unique)
} | ConvertTo-Json -Depth 10
