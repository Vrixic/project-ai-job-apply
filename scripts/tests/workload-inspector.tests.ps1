[CmdletBinding()]
param(
  [string]$InspectorPath = "",
  [string]$DevelopmentInspectorPath = "",
  [string]$RepositoryRoot = "",
  [string]$GeneratedRunnerResultsPath = ""
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if (-not $InspectorPath) { $InspectorPath = Join-Path $PSScriptRoot "../inspect-staging-workload-and-cost.ps1" }
if (-not $DevelopmentInspectorPath) { $DevelopmentInspectorPath = Join-Path $PSScriptRoot "../inspect-development-workload-and-cost.ps1" }
if (-not $RepositoryRoot) { $RepositoryRoot = Join-Path $PSScriptRoot "../.." }
. (Join-Path $RepositoryRoot "scripts/lib/terraform-toolchain.ps1")
$passed = 0
function Assert-Test([bool]$Condition, [string]$Label) {
  if (-not $Condition) { throw $Label }
  $script:passed++
}
function Reject([scriptblock]$Operation, [string]$Label) {
  $rejected = $false
  try { $null = & $Operation } catch { $rejected = $true }
  Assert-Test $rejected $Label
}
function Clone([object]$Value) {
  return ConvertFrom-DeploymentTerraformJson (ConvertTo-Json -InputObject $Value -Depth 30 -Compress)
}
$source = Get-Content -LiteralPath $InspectorPath -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
Assert-Test (@($errors).Count -eq 0) "The actual shared inspector must parse."
foreach ($name in @("Assert-D2AggregateFields", "Assert-D2AggregateCount", "Assert-D2AggregateFlag",
    "ConvertTo-D2ResultTimestamp", "Assert-D2WorkloadAggregate", "Read-D2WorkloadEvidence",
    "ConvertTo-D2MetricTimestamp", "Assert-D2MetricDatapoints", "Assert-D2MetricCoverage",
    "Get-MetricAggregate", "Get-Collection", "Measure-D2WorkloadCorroboration")) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-Test ($definitions.Count -eq 1) "The exact $name function must exist once."
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
function aws { throw "Real AWS calls are forbidden in this offline test." }
function terraform { throw "Real Terraform calls are forbidden in this offline test." }

# Execute the exact inspector cleanup with synthetic process variables only. The native
# ports above remain fail-closed; this fixture creates no plan, receipt, or deployment state.
$environmentFunctions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Get-RuntimeStatus"
}, $false))
Assert-Test ($environmentFunctions.Count -eq 1) "The actual runtime cleanup owner must be unique."
$environmentTryNodes = @($environmentFunctions[0].Body.FindAll({
  param($node)
  $node -is [Management.Automation.Language.TryStatementAst] -and $null -ne $node.Finally
}, $false))
Assert-Test ($environmentTryNodes.Count -eq 1) "The actual runtime cleanup finally must be unique."
$environmentCleanup = [scriptblock]::Create((@($environmentTryNodes[0].Finally.Statements |
  ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine))
$environmentProbePrefix = "TF_VAR_codex_inspector_cleanup_" + [Guid]::NewGuid().ToString("N") + "_"
$environmentProbeNames = @(
  ($environmentProbePrefix + "absent"),
  ($environmentProbePrefix + "empty"),
  ($environmentProbePrefix + "composite"),
  ($environmentProbePrefix + "already_removed"),
  ($environmentProbePrefix + "unrelated")
)
foreach ($probeName in $environmentProbeNames) {
  Assert-Test (-not (Test-Path -LiteralPath ("Env:" + $probeName))) "A synthetic environment name must not overwrite a caller entry."
}
$originalDataPresent = Test-Path -LiteralPath "Env:TF_DATA_DIR"
$originalDataValue = [Environment]::GetEnvironmentVariable("TF_DATA_DIR", "Process")
$environmentSentinel = Join-Path ([IO.Path]::GetTempPath()) ("inspector-env-never-created-" + [Guid]::NewGuid().ToString("N") + ".tfplan")
Assert-Test (-not (Test-Path -LiteralPath $environmentSentinel)) "The cleanup sentinel must not name an existing file."

function Invoke-InspectorEnvironmentRegressionCycle([bool]$FailBody) {
  $names = @($environmentProbeNames[0], $environmentProbeNames[1], $environmentProbeNames[2], $environmentProbeNames[3])
  $saved = @{}
  foreach ($probeName in $names) {
    $saved[$probeName] = [Environment]::GetEnvironmentVariable($probeName, "Process")
  }
  $saved["TF_DATA_DIR"] = $env:TF_DATA_DIR
  $expectedEmptyPresent = Test-Path -LiteralPath ("Env:" + $environmentProbeNames[1])
  $expectedEmptyValue = [Environment]::GetEnvironmentVariable($environmentProbeNames[1], "Process")
  $expectedDataPresent = Test-Path -LiteralPath "Env:TF_DATA_DIR"
  $expectedDataValue = [Environment]::GetEnvironmentVariable("TF_DATA_DIR", "Process")
  $temporaryPlan = $environmentSentinel
  $bodyFailureObserved = $false
  try {
    try {
      foreach ($probeName in $names) {
        [Environment]::SetEnvironmentVariable($probeName, "synthetic-temporary-input", "Process")
      }
      $env:TF_DATA_DIR = "synthetic-temporary-data"
      Remove-Item -LiteralPath ("Env:" + $environmentProbeNames[3])
      if ($FailBody) { throw "SyntheticInspectorBodyFailure" }
    } finally {
      . $environmentCleanup
    }
  } catch {
    if ($_.Exception.Message -cne "SyntheticInspectorBodyFailure") { throw }
    $bodyFailureObserved = $true
  }
  Assert-Test (-not (Test-Path -LiteralPath ("Env:" + $environmentProbeNames[0]))) "The inspector must restore an originally absent input to absence."
  Assert-Test ((Test-Path -LiteralPath ("Env:" + $environmentProbeNames[1])) -eq $expectedEmptyPresent) "Cleanup must preserve the original presence of an empty input."
  Assert-Test ([Environment]::GetEnvironmentVariable($environmentProbeNames[1], "Process") -ceq $expectedEmptyValue) "Cleanup must preserve the exact empty input value."
  Assert-Test ([Environment]::GetEnvironmentVariable($environmentProbeNames[2], "Process") -ceq '{"synthetic":["exact"]}') "Cleanup must restore a composite string byte-for-byte."
  Assert-Test (-not (Test-Path -LiteralPath ("Env:" + $environmentProbeNames[3]))) "Cleanup must tolerate an absent input already removed by the body."
  Assert-Test ([Environment]::GetEnvironmentVariable($environmentProbeNames[4], "Process") -ceq "caller-unrelated-sentinel") "Cleanup must not purge unrelated caller Terraform variables."
  Assert-Test ((Test-Path -LiteralPath "Env:TF_DATA_DIR") -eq $expectedDataPresent) "Cleanup must preserve original Terraform data-directory presence."
  Assert-Test ([Environment]::GetEnvironmentVariable("TF_DATA_DIR", "Process") -ceq $expectedDataValue) "Cleanup must preserve the exact Terraform data-directory value."
  Assert-Test ($bodyFailureObserved -eq $FailBody) "The body exception must propagate after cleanup."
  return [pscustomobject]@{ Restored = $true; BodyFailureObserved = $bodyFailureObserved }
}

try {
  foreach ($dataMode in @("absent", "empty", "value")) {
    foreach ($bodyFails in @($false, $true)) {
      foreach ($probeName in $environmentProbeNames) {
        if (Test-Path -LiteralPath ("Env:" + $probeName)) { Remove-Item -LiteralPath ("Env:" + $probeName) }
      }
      [Environment]::SetEnvironmentVariable($environmentProbeNames[1], "", "Process")
      [Environment]::SetEnvironmentVariable($environmentProbeNames[2], '{"synthetic":["exact"]}', "Process")
      [Environment]::SetEnvironmentVariable($environmentProbeNames[4], "caller-unrelated-sentinel", "Process")
      if ($PSVersionTable.PSVersion -ge [Version]"7.5") {
        Assert-Test (Test-Path -LiteralPath ("Env:" + $environmentProbeNames[1])) "PowerShell 7.5 must exercise present-empty input restoration."
      }
      if ($dataMode -ceq "absent") {
        if (Test-Path -LiteralPath "Env:TF_DATA_DIR") { Remove-Item -LiteralPath "Env:TF_DATA_DIR" }
      } elseif ($dataMode -ceq "empty") { $env:TF_DATA_DIR = "" }
      else { $env:TF_DATA_DIR = "synthetic-original-data" }
      # Two sequential nested/pipelined cycles reproduce the Start versus Status boundary.
      $null = Invoke-InspectorEnvironmentRegressionCycle $bodyFails | ConvertTo-Json -Compress
      $null = Invoke-InspectorEnvironmentRegressionCycle $bodyFails | ConvertTo-Json -Compress
    }
  }
} finally {
  foreach ($probeName in $environmentProbeNames) {
    if (Test-Path -LiteralPath ("Env:" + $probeName)) { Remove-Item -LiteralPath ("Env:" + $probeName) }
  }
  if ($originalDataPresent) {
    [Environment]::SetEnvironmentVariable("TF_DATA_DIR", $originalDataValue, "Process")
  } elseif (Test-Path -LiteralPath "Env:TF_DATA_DIR") { Remove-Item -LiteralPath "Env:TF_DATA_DIR" }
}

$wrapper = Get-Content -LiteralPath $DevelopmentInspectorPath -Raw
$null = [Management.Automation.Language.Parser]::ParseInput($wrapper, [ref]$tokens, [ref]$errors)
Assert-Test (@($errors).Count -eq 0) "The development wrapper must parse."
foreach ($profile in @("D2PublicDevelopment", "D2AuthenticatedIntake", "D2Processing")) {
  Assert-Test ($source.Contains('"' + $profile + '"') -and $wrapper.Contains('"' + $profile + '"')) "Both inspectors retain the explicit $profile profile."
}
foreach ($name in @("WorkloadResultPath", "WorkloadResultSha256")) {
  Assert-Test ($wrapper.Contains('"' + $name + '"')) "The development wrapper forwards $name."
}
Assert-Test ($source.IndexOf('$d2Evidence = Read-D2WorkloadEvidence $runtimePlan') -lt
  $source.IndexOf('$identity = Assert-CallerAndTerraform')) "Result validation must precede AWS."
Assert-Test ($source.Contains('"D2Public" { 40 }') -and $source.Contains('"D2Public" { 20 }')) "Historical signed public floors must remain exact."

$Environment = "development"; $Action = "Measure"
$WorkloadProfile = "D2Processing"; $WorkloadResultSha256 = "a" * 64
$now = [DateTime]::Parse("2026-09-10T13:00:00Z").ToUniversalTime()
$configuration = Clone @{ deploy = $true; enabled = $true; maintenance_mode = $false
  development_contributions_enabled = $true }
function New-RunnerResult([bool]$Processing = $true) {
  $duration = if ($Processing) { 900000 } else { 6500 }
  return Clone @{
    profile = if ($Processing) { "d2_deployed_disposable_processing_to_review_v1" } else { "d2_deployed_disposable_authenticated_intake_v1" }
    startedAt = "2026-09-10T12:00:00.000Z"
    endedAt = if ($Processing) { "2026-09-10T12:15:00.000Z" } else { "2026-09-10T12:00:06.500Z" }
    durationMs = $duration; passed = $true; requests = if ($Processing) { 100 } else { 14 }
    concurrency = 1; acknowledgedContributions = 1; consentGrants = 2; ownerReads = 3
    idempotentReplays = 1; expectedConflicts = 1; ambiguousWrites = 0; serverFailures = 0
    cleanupAttempted = $true; cleanupSucceeded = $true
    cleanupCancellations = if ($Processing) { 0 } else { 1 }; cleanupWithdrawals = if ($Processing) { 1 } else { 0 }
    processingToReviewObserved = $Processing
    processingPolls = if ($Processing) { 30 } else { 0 }; cleanupPolls = if ($Processing) { 55 } else { 0 }
    cleanupRevocations = 2; recoveryRequired = $false
    latency = @{ p50Ms = 4; p95Ms = 6; maxMs = 9 }
    processingAcceptance = $false; moderationAcceptance = $false
    publicationAcceptance = $false; capacityAcceptance = $false
  }
}
function Validate-Result([object]$Result, [object]$Config = $configuration, [string]$Profile = "D2Processing") {
  Assert-D2WorkloadAggregate $Result $Config $Profile $Result.startedAt $Result.endedAt $now
}
$processing = New-RunnerResult
$evidence = Validate-Result $processing
Assert-Test ($evidence.Processing -and $evidence.MinimumRequests -eq 100 -and
  ($evidence.DrainEnd - $evidence.DrainStart).TotalMinutes -eq 2) "Processing uses its real 20-minute-capable result and a separate bounded drain interval."
$signed = Clone $configuration
$signed.development_contributions_enabled = $false
$signed | Add-Member signed_policy_json '{"payload":{"intakeEnabled":true,"processingEnabled":false}}'
$intake = New-RunnerResult $false
$intakeEvidence = Validate-Result $intake $signed "D2AuthenticatedIntake"
Assert-Test (-not $intakeEvidence.Processing -and $intakeEvidence.Authenticated) "Paused signed intake remains supported."
$signed.signed_policy_json = '{"payload":{"intakeEnabled":true,"processingEnabled":true}}'
$null = Validate-Result $processing $signed
Assert-Test $true "Signed active processing remains supported without renewing any policy."
Reject { Validate-Result $intake $signed "D2AuthenticatedIntake" } "Paused intake cannot use active signed processing."
Reject { Validate-Result $intake $configuration "D2AuthenticatedIntake" } "Paused intake cannot use persistent development mode."

$public = Clone @{
  profile = "d2_deployed_unauthenticated_contribution_boundary_v1"
  startedAt = "2026-09-10T12:00:00.000Z"; endedAt = "2026-09-10T12:00:00.200Z"; durationMs = 200
  policyRequests = 0; capabilityMode = "development"; policyChecksSkipped = $true
  authenticatedThroughputValidated = $false; unauthorizedContributionRequests = 20
  unauthorizedResponses = 12; throttledResponses = 8; unexpectedResponses = 0; serverFailures = 0
  unauthorizedLatency = @{ p50Ms = 1; p95Ms = 2; maxMs = 3 }
}
$publicEvidence = Validate-Result $public $configuration "D2PublicDevelopment"
Assert-Test ($publicEvidence.MinimumRequests -eq 20 -and $publicEvidence.Public) "Only the explicitly bound development probe has a 20-request floor."
Reject { Validate-Result $public $signed "D2PublicDevelopment" } "A development probe cannot silently lower the signed runtime floor."
foreach ($entry in @(
  @("passed", $false), @("passed", "true"), @("cleanupAttempted", $false),
  @("cleanupSucceeded", $false), @("cleanupWithdrawals", 0), @("cleanupCancellations", 1),
  @("cleanupRevocations", 1), @("recoveryRequired", $true), @("processingToReviewObserved", $false),
  @("acknowledgedContributions", 0), @("consentGrants", 1), @("ownerReads", 0),
  @("ownerReads", 11), @("idempotentReplays", 0), @("expectedConflicts", 0),
  @("requests", 193), @("requests", 12), @("requests", "100"), @("requests", 100.0),
  @("requests", $true), @("requests", $null), @("ambiguousWrites", -1),
  @("serverFailures", 1), @("durationMs", 1200001), @("processingPolls", 49),
  @("cleanupPolls", 71), @("publicationAcceptance", $true), @("capacityAcceptance", $true),
  @("profile", "d2_deployed_disposable_authenticated_intake_v1")
)) {
  $bad = Clone $processing
  $bad.($entry[0]) = $entry[1]
  Reject { Validate-Result $bad } "Reject invalid runner disposition/count $($entry[0])."
}
$bad = Clone $processing; $bad | Add-Member token "PRIVATE-NEVER-RETAIN"
Reject { Validate-Result $bad } "Unknown fields and candidate/token material are refused."
$bad = Clone $processing; $bad | Add-Member failureStage "cleanup"
Reject { Validate-Result $bad } "A failure stage cannot masquerade as success."
$bad = Clone $processing; $bad.latency.p50Ms = 20
Reject { Validate-Result $bad } "Malformed latency ordering is refused."
foreach ($stamp in @("2026-09-10T12:00:00", "2026-09-10T08:00:00.000-04:00", "2026-09-10T12:00:00Z", "not-a-time")) {
  $bad = Clone $processing; $bad.startedAt = $stamp
  Reject { Validate-Result $bad } "Only the original result timestamp representation is accepted."
}
Reject { Assert-D2WorkloadAggregate $processing $configuration "D2Processing" $processing.startedAt "2026-09-10T12:15:01.000Z" $now } "An independently selected end window is rejected."
Reject { Assert-D2WorkloadAggregate $processing $configuration "D2Processing" $processing.startedAt $processing.endedAt $evidence.RunnerStart } "Future runner results are rejected before AWS."
Reject { Assert-D2WorkloadAggregate $processing $configuration "D2Processing" $processing.startedAt $processing.endedAt $evidence.RunnerEnd } "The drain interval must finish before inspection."
foreach ($name in @("deploy", "enabled", "maintenance_mode", "development_contributions_enabled")) {
  $bad = Clone $configuration; $bad.$name = if ($name -ceq "maintenance_mode") { $true } else { $false }
  if ($name -ceq "development_contributions_enabled") { $bad.$name = "true" }
  Reject { Validate-Result $processing $bad } "Wrong or ambiguous runtime mode $name is rejected."
}
$bad = Clone $public; $bad.policyRequests = 20
Reject { Validate-Result $bad $configuration "D2PublicDevelopment" } "Skipped policy reads cannot be fabricated."
$bad = Clone $public; $bad.capabilityMode = @("development")
Reject { Validate-Result $bad $configuration "D2PublicDevelopment" } "The public mode must be an actual string."
$bad = Clone $public; $bad.unauthorizedResponses = 11
Reject { Validate-Result $bad $configuration "D2PublicDevelopment" } "The public result accounts for every denied request."

$script:metricMode = "healthy"
$script:awsReads = 0
function Invoke-AwsJson {
  param([string[]]$CommandArguments)
  $script:awsReads++
  if (($CommandArguments[0..1] -join " ") -ceq "cloudwatch describe-alarms") {
    $names = @($CommandArguments[3..($CommandArguments.Count - 3)])
    $alarms = @($names | ForEach-Object {
      [pscustomobject]@{ AlarmName = $_; StateValue = "OK"; ActionsEnabled = $true
        AlarmActions = @("PRIVATE-ALARM-TARGET"); OKActions = @("PRIVATE-ALARM-TARGET") }
    })
    if ($script:metricMode -ceq "alarm") { $alarms[0].StateValue = "ALARM" }
    if ($script:metricMode -ceq "missing-alarm") { $alarms = @($alarms | Select-Object -Skip 1) }
    if ($script:metricMode -ceq "duplicate-alarm") { $alarms[1].AlarmName = $alarms[0].AlarmName }
    return [pscustomobject]@{ MetricAlarms = $alarms }
  }
  if (($CommandArguments[0..1] -join " ") -cne "cloudwatch get-metric-statistics") {
    throw "Unexpected AWS fixture operation."
  }
  function Argument([string]$Name) { return $CommandArguments[[Array]::IndexOf($CommandArguments, $Name) + 1] }
  $namespace = Argument "--namespace"; $name = Argument "--metric-name"
  $start = ConvertTo-D2MetricTimestamp (Argument "--start-time")
  $end = ConvertTo-D2MetricTimestamp (Argument "--end-time")
  $joined = $CommandArguments -join " "
  $worker = $namespace -ceq "AIJobApply/D2Community" -or $joined.Contains("d2-community-scheduled") -or $joined.Contains("d2-trust-signal")
  if ($script:metricMode -ceq "missing-required" -or
      ($script:metricMode -ceq "idle-workers" -and $worker -and $namespace -cne "AWS/SQS") -or
      ($script:metricMode -ceq "sparse-native-adverse" -and $namespace -ceq "AWS/Lambda" -and $name -cin @("Errors", "Throttles")) -or
      ($script:metricMode -ceq "no-completed-batches" -and $name -cin @("ScheduledBatchSucceeded", "TrustSignalRecords")) -or
      ($script:metricMode -ceq "missing-custom-field" -and $name -ceq "TrustSignalFailed")) {
    return [pscustomobject]@{ Datapoints = @() }
  }
  $points = @(
    for ($minute = $start; $minute -lt $end; $minute = $minute.AddMinutes(1)) {
      $value = if ($name -cin @("Count", "Invocations", "Latency", "ScheduledBatchSucceeded", "TrustSignalRecords")) { 100 } elseif ($name -ceq "4xx") { 20 } else { 0 }
      if ($script:metricMode -ceq "zero-completed-batches" -and $name -cin @("ScheduledBatchSucceeded", "TrustSignalRecords")) { $value = 0 }
      if ($script:metricMode -ceq "lambda-errors" -and $name -ceq "Errors") { $value = 1 }
      if ($script:metricMode -ceq "lambda-throttles" -and $name -ceq "Throttles") { $value = 1 }
      if ($script:metricMode -ceq "api-errors" -and $name -ceq "5xx") { $value = 1 }
      if ($script:metricMode -ceq "application-failure" -and $name -ceq "JobsDeliveryDead") { $value = 1 }
      if ($minute -ge $script:activeEvidence.DrainStart) {
        if ($script:metricMode -ceq "late-worker-error" -and $worker -and $name -ceq "Errors") { $value = 1 }
        if ($script:metricMode -ceq "late-worker-throttle" -and $worker -and $name -ceq "Throttles") { $value = 1 }
        if ($script:metricMode -ceq "late-trust-failure" -and $name -ceq "TrustSignalFailed") { $value = 1 }
        if ($script:metricMode -ceq "late-scheduled-failure" -and $name -ceq "ScheduledBatchFailed") { $value = 1 }
      }
      if ($namespace -ceq "AWS/SQS" -and -not $joined.Contains("dead-letter")) {
        if ($start -lt $script:activeEvidence.DrainStart) { $value = 2 }
        if ($script:metricMode -ceq "unfinished-drain" -and $start -eq $script:activeEvidence.DrainStart) { $value = 1 }
      }
      if ($script:metricMode -ceq "dlq" -and $joined.Contains("dead-letter")) { $value = 1 }
      $stamp = $minute.ToString("o")
      if ($script:metricMode -ceq "offset") { $stamp = ([DateTimeOffset]$minute).ToOffset([TimeSpan]::FromHours(-4)).ToString("o") }
      [pscustomobject]@{ Timestamp = $stamp; Sum = $value; Average = $value; Maximum = $value; SampleCount = 1 }
    }
  )
  if ($script:metricMode -ceq "completion-and-recovery") {
    # A scheduled recovery-only call at N emits native metrics but no ordinary batch EMF.
    # A regular batch at N+1 has its own success and failure fields in that same EMF sample.
    if ($namespace -ceq "AWS/Lambda" -and $joined.Contains("d2-community-scheduled") -and $name -ceq "Invocations") {
      $points = @($points | Where-Object { (ConvertTo-D2MetricTimestamp $_.Timestamp) -lt $start.AddMinutes(2) })
    }
    if ($name -cin @("ScheduledBatchSucceeded", "JobsDead", "JobsDeliveryDead", "TrustDeliveryDead")) {
      $points = @($points | Where-Object { (ConvertTo-D2MetricTimestamp $_.Timestamp) -eq $start.AddMinutes(1) })
    }
    # Trust starts just before the runner end; its post-consume sample crosses into drain N+1.
    if ($namespace -ceq "AWS/Lambda" -and $joined.Contains("d2-trust-signal") -and $name -ceq "Invocations") {
      $points = @($points | Where-Object { (ConvertTo-D2MetricTimestamp $_.Timestamp) -eq $script:activeEvidence.End.AddMinutes(-1) })
    }
    if ($name -cin @("TrustSignalRecords", "TrustSignalFailed")) {
      $points = @($points | Where-Object { (ConvertTo-D2MetricTimestamp $_.Timestamp) -eq $script:activeEvidence.DrainStart })
    }
    if ($name -ceq "ScheduledBatchFailed") { $points = @() }
  }
  if ($script:metricMode -ceq "partial-drain" -and $start -eq $script:activeEvidence.DrainStart) { $points = @($points | Select-Object -Skip 1) }
  if ($script:metricMode -ceq "partial-requests" -and $name -ceq "Count") { $points = @($points | Select-Object -Skip 1) }
  if ($script:metricMode -cin @("empty-partial-edges", "missing-interior-request") -and $name -ceq "Count") {
    $points = @($points | Where-Object {
      $minute = ConvertTo-D2MetricTimestamp $_.Timestamp
      $minute -ge $script:activeEvidence.RunnerStart -and $minute.AddMinutes(1) -le $script:activeEvidence.RunnerEnd
    })
    if ($script:metricMode -ceq "missing-interior-request") { $points = @($points | Select-Object -Skip 1) }
  }
  if ($script:metricMode -ceq "partial-errors" -and $name -ceq "Errors") { $points = @($points | Select-Object -Skip 1) }
  if ($script:metricMode -ceq "partial-completion-field" -and $name -ceq "JobsDead") { $points = @($points | Select-Object -Skip 1) }
  if ($script:metricMode -ceq "partial-completion-samples" -and $name -cin @("ScheduledBatchSucceeded", "JobsDeliveryDead", "TrustDeliveryDead")) {
    $points[0].SampleCount = 2; $points[0].Sum = 2 * $points[0].Average
  }
  if ($script:metricMode -ceq "duplicate") { $points += $points[0] }
  if ($script:metricMode -ceq "outside") { $points[0].Timestamp = $end.ToString("o") }
  if ($script:metricMode -ceq "malformed-stat") { $points[0].Sum = "0" }
  if ($script:metricMode -ceq "no-samples") { $points[0].SampleCount = 0 }
  if ($script:metricMode -ceq "nonfinite") { $points[0].Sum = [double]::NaN }
  if ($script:metricMode -ceq "inconsistent") { $points[0].Maximum = $points[0].Sum + 1 }
  return [pscustomobject]@{ Datapoints = $points; Extra = "PRIVATE-NEVER-RETAIN" }
}
function Get-LogAggregate {
  param([DateTime]$WindowStart, [DateTime]$WindowEnd)
  return [pscustomobject]@{ Events = 3; ErrorMatches = $(if ($script:metricMode -ceq "log-error") { 1 } else { 0 }); ForbiddenMatches = 0 }
}
$runtime = [pscustomobject]@{ EcsRuntimeIdle = $true; TriggersEnabled = $true }
$script:activeEvidence = $evidence
$result = Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime
Assert-Test ($result.AggregateCorroborated -and $result.FinalApproximateQueueDrained -and
  $result.EventQueueVisibleMax -gt 0 -and $result.UnknownOptionalMetricSeries -eq 0) "Transient processing queue activity can settle and corroborate."
foreach ($name in @("OwnerRequestAttribution", "PublicationAcceptance", "CapacityAcceptance", "ProcessingAcceptance", "MissingDataTreatedAsZero", "AwsMutation")) {
  Assert-Test ($result.$name -eq $false) "Output cannot claim $name."
}
$retained = ConvertTo-Json -InputObject $result -Depth 8
Assert-Test ($retained -cnotmatch 'PRIVATE|synthetic|arn:|Bearer|auth0|execute-api|contributionId') "Raw resource/owner/credential/payload values are excluded."
$script:metricMode = "completion-and-recovery"
$completed = Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime
Assert-Test ($completed.AggregateCorroborated -and $completed.WorkerMetricEndedAt -ceq $evidence.DrainEnd.ToString("o")) "A Trust completion crossing into drain and a scheduled recovery-only invocation do not require cross-source minute equality."
Assert-Test (@($completed.MetricCoverage | Where-Object { $_.Signal -cin @("ScheduledBatchSucceeded", "TrustSignalRecords") -and $_.Datapoints -eq 1 }).Count -eq 2) "Actual completed-batch references, not every invocation minute, anchor custom coverage."
Assert-Test (@($completed.MetricCoverage | Where-Object { $_.Signal -ceq "ScheduledBatchFailed" -and $_.Availability -ceq "unknown" }).Count -eq 1) "An absent failure-only scheduled series remains explicitly unknown."
$edgeResult = New-RunnerResult
$edgeResult.startedAt = "2026-09-10T12:00:00.500Z"; $edgeResult.endedAt = "2026-09-10T12:15:00.500Z"
$edgeEvidence = Validate-Result $edgeResult
$script:activeEvidence = $edgeEvidence; $script:metricMode = "empty-partial-edges"
$edges = Measure-D2WorkloadCorroboration $edgeEvidence @("Name=ApiId,Value=synthetic") $runtime
Assert-Test ($edges.AggregateCorroborated -and $edges.ApiRequests -ge $edgeResult.requests) "Empty partial API edge buckets preserve the observed request floor."
Assert-Test ($edges.RunnerStartedAt -ceq $edgeEvidence.RunnerStart.ToString("o") -and $edges.MetricStartedAt -ceq $edgeEvidence.Start.ToString("o")) "Exact runner and minute-rounded query windows remain distinct."
$script:metricMode = "missing-interior-request"
Reject { Measure-D2WorkloadCorroboration $edgeEvidence @("Name=ApiId,Value=synthetic") $runtime } "A missing full interior request minute remains inconclusive despite sufficient aggregate traffic."
$script:activeEvidence = $evidence
foreach ($mode in @("sparse-native-adverse", "partial-errors")) {
  $script:metricMode = $mode
  $sparse = Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime
  Assert-Test $sparse.AggregateCorroborated "Sparse native adverse series do not claim per-invocation zero coverage."
  if ($mode -ceq "sparse-native-adverse") {
    Assert-Test ($sparse.UnknownOptionalMetricSeries -eq 6 -and -not $sparse.MissingDataTreatedAsZero) "Missing Errors and Throttles remain unknown for all three runtimes."
  }
}
foreach ($mode in @("missing-required", "partial-drain", "unfinished-drain", "dlq", "lambda-errors",
    "lambda-throttles", "api-errors", "application-failure", "alarm", "missing-alarm", "duplicate-alarm",
    "duplicate", "outside", "malformed-stat", "no-samples", "nonfinite", "log-error",
    "partial-requests", "inconsistent", "no-completed-batches", "zero-completed-batches",
    "missing-custom-field", "partial-completion-field", "partial-completion-samples", "late-worker-error", "late-worker-throttle",
    "late-trust-failure", "late-scheduled-failure")) {
  $script:metricMode = $mode
  Reject { Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime } "Fail closed on $mode evidence."
}
$script:metricMode = "offset"
$null = Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime
Assert-Test $true "AWS offset-bearing metric timestamps normalize to UTC."
foreach ($stamp in @("12:00:00Z", "09/10/2026 12:00:00Z", "2026-09-10T12:00:00", "not-a-time")) {
  Reject { ConvertTo-D2MetricTimestamp $stamp } "Metric timestamps require a full explicit-zone ISO value."
}
Reject { ConvertTo-D2MetricTimestamp ([DateTime]::SpecifyKind($now, [DateTimeKind]::Unspecified)) } "Unspecified native DateTime metadata is refused."
$script:metricMode = "idle-workers"
$script:activeEvidence = $intakeEvidence
$WorkloadProfile = "D2AuthenticatedIntake"
$idle = Measure-D2WorkloadCorroboration $intakeEvidence @("Name=ApiId,Value=synthetic") $runtime
Assert-Test ($idle.AggregateCorroborated -and $idle.UnknownOptionalMetricSeries -gt 0) "Paused intake does not demand worker invocations it did not cause."
Assert-Test (@($idle.MetricCoverage | Where-Object Availability -CEQ "unknown").Count -gt 0) "Optional absence stays unknown rather than zero/disabled."
$script:activeEvidence = $evidence
Reject { Measure-D2WorkloadCorroboration $evidence @("Name=ApiId,Value=synthetic") $runtime } "Active processing requires worker coverage."

if ($GeneratedRunnerResultsPath) {
  $generated = ConvertFrom-DeploymentTerraformJson (Get-Content -LiteralPath $GeneratedRunnerResultsPath -Raw)
  foreach ($fixture in @($generated.runs)) {
    $configurationForRun = Clone $configuration
    if (-not $fixture.development) {
      $configurationForRun.development_contributions_enabled = $false
      $configurationForRun | Add-Member signed_policy_json (
        @{ payload = @{ intakeEnabled = $true; processingEnabled = [bool]$fixture.processing } } | ConvertTo-Json -Compress)
    }
    $name = if ($fixture.processing) { "D2Processing" } else { "D2AuthenticatedIntake" }
    $testNow = (ConvertTo-D2ResultTimestamp $fixture.result.endedAt).AddMinutes(10)
    $null = Assert-D2WorkloadAggregate $fixture.result $configurationForRun $name $fixture.result.startedAt $fixture.result.endedAt $testNow
    Assert-Test $true "An aggregate produced by the actual synthetic runner passes the real JSON decoder."
  }
}

# Exercise the real ignored-result reader with generated aggregate bytes only. Every test-owned
# file has an exclusive random directory; neither an operator receipt nor a retained plan is read.
$testRoot = Join-Path $RepositoryRoot (".tmp/d2-workload-reader-tests-" + [guid]::NewGuid().ToString("N"))
$null = New-Item -ItemType Directory -Path $testRoot
$path = Join-Path $testRoot "aggregate.json"
$originalEnvironment = $Environment
$terraformDirectory = Join-Path $RepositoryRoot "infrastructure/terraform/environments/development"
$WorkloadProfile = "D2Processing"; $Action = "Measure"; $Environment = "development"
$readerResult = New-RunnerResult
$readerStart = [DateTime]::UtcNow.AddMinutes(-30)
$readerResult.startedAt = $readerStart.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$readerResult.endedAt = $readerStart.AddMinutes(15).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$StartTime = $readerResult.startedAt; $EndTime = $readerResult.endedAt
$readerPlan = Clone @{ variables = @{ d2_community_runtime = @{ value = $configuration } } }
function Write-ReaderFixture([string]$Json) {
  [IO.File]::WriteAllText($path, $Json, (New-Object Text.UTF8Encoding($false)))
  $script:WorkloadResultSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
try {
  $WorkloadResultPath = $path
  $json = ConvertTo-Json -InputObject $readerResult -Depth 8 -Compress
  Write-ReaderFixture $json
  $before = $script:awsReads
  $read = Read-D2WorkloadEvidence $readerPlan
  Assert-Test ($read.Processing -and $script:awsReads -eq $before) "A checksum-bound aggregate is parsed before any cloud call."
  $WorkloadResultPath = $path.Substring([IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\', '/').Length + 1)
  $null = Read-D2WorkloadEvidence $readerPlan
  Assert-Test $true "Relative aggregate paths resolve from the repository, not the current package."
  $WorkloadResultPath = $path
  $WorkloadResultSha256 = "0" * 64
  Reject { Read-D2WorkloadEvidence $readerPlan } "A mismatched aggregate checksum is refused."
  Write-ReaderFixture $json
  $WorkloadResultPath = Join-Path $RepositoryRoot "package.json"
  Reject { Read-D2WorkloadEvidence $readerPlan } "An aggregate outside ignored roots is refused."
  $WorkloadResultPath = $path
  foreach ($invalid in @($json.Replace('"passed":true', '"passed":false,"passed":true'),
      $json.Replace('"passed":true', '"pa\u0073sed":true'), "[]", "null", "not json", (' ' * 17000))) {
    Write-ReaderFixture $invalid
    Reject { Read-D2WorkloadEvidence $readerPlan } "Malformed, ambiguous or oversized aggregate bytes are refused."
  }
  Write-ReaderFixture $json
  $Environment = "staging"
  Reject { Read-D2WorkloadEvidence $readerPlan } "D2 aggregate corroboration cannot cross into staging."
  $Environment = "development"; $Action = "Status"
  Reject { Read-D2WorkloadEvidence $readerPlan } "Result-bound profiles cannot run through Status."
  $Action = "Measure"; $WorkloadProfile = "D2Public"
  Reject { Read-D2WorkloadEvidence $readerPlan } "A new aggregate cannot reinterpret the historical signed profile."
  $WorkloadResultPath = ""; $WorkloadResultSha256 = ""
  Assert-Test ($null -eq (Read-D2WorkloadEvidence $readerPlan)) "Historical signed inspection remains unchanged without a new result."
  $WorkloadProfile = "d2processing"
  Reject { Read-D2WorkloadEvidence $readerPlan } "Case-insensitive parameter binding cannot fall through into a historical profile."
  Assert-Test ($script:awsReads -eq $before) "All result-reader positive and negative checks remain offline."
} finally {
  $Environment = $originalEnvironment
  $resolved = [IO.Path]::GetFullPath($testRoot)
  $prefix = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot ".tmp")).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -cnotmatch '^d2-workload-reader-tests-[a-f0-9]{32}$') {
    throw "Refusing cleanup outside the exact generated test directory."
  }
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  Remove-Item -LiteralPath $resolved -Force
}
Write-Output "D2 workload inspector guards: $passed passed; PowerShell $($PSVersionTable.PSVersion); no cloud calls."
