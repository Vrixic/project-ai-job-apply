Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-d1-representative-acceptance.ps1"
$schemaPath = Join-Path $repositoryRoot "infrastructure\observability\d1-representative-acceptance.schema.json"
$examplePath = Join-Path $repositoryRoot "infrastructure\observability\d1-representative-acceptance.example.json"
$source = Get-Content -LiteralPath $operatorPath -Raw
$schemaSource = Get-Content -LiteralPath $schemaPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The D1 representative operator does not parse." }
$null = $schemaSource | ConvertFrom-Json

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Operator function $Name must be defined exactly once." }
  Invoke-Expression "function global:$Name $($matches[0].Body.Extent.Text)"
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw "$Description was accepted." }
}

function Invoke-OperatorFailure {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & $hostExecutable -NoProfile -File $operatorPath @Arguments 2>&1
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } finally { $ErrorActionPreference = $savedPreference }
}

$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$expectedParameters = @("Action", "ConfigPath", "ReviewedConfigSha256", "Help")
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The operator public parameter surface changed."
}
foreach ($forbidden in @("& aws", "Invoke-WebRequest", "terraform plan", "docker", "wsl", "shutdown", "Start-Process")) {
  if ($source.Contains($forbidden)) { throw "The source-only operator contains forbidden execution text '$forbidden'." }
}
if ($schemaSource.Contains('"$ref": "#/$defs/thresholdGroup"')) {
  throw "Threshold properties are hidden behind an additionalProperties-false referenced schema."
}
foreach ($group in @("concurrency", "durationMs", "latencyMs", "errors", "queues", "alerts")) {
  $groupPattern = '"' + [regex]::Escape($group) + '"\s*:\s*\{\s*"type"\s*:\s*"object"\s*,\s*"additionalProperties"\s*:\s*false'
  if ($schemaSource -notmatch $groupPattern) { throw "Schema group $group is not a direct closed object." }
}

foreach ($functionName in @(
    "Resolve-RepositoryPath", "Get-FileSha256", "ConvertFrom-StrictJson", "Assert-ExactProperties", "Test-CanonicalTimestamp",
    "Test-IntegerValue", "Get-ConfigurationIssues", "Get-ReadinessIssues",
    "Assert-D1ApplicationResult", "Assert-AwsAggregateResult", "Assert-AlertDeliveryResults",
    "Assert-PostRunResults"
  )) { Import-OperatorFunction $functionName }
$requiredArtifactNames = @(
  "gateway", "workflow-ingress", "profile-readiness-durable",
  "profile-readiness-activity"
)

$example = ConvertFrom-StrictJson (Get-Content -LiteralPath $examplePath -Raw) "Draft example"
$draftIssues = @(Get-ConfigurationIssues $example)
if ($draftIssues.Count -ne 0) { throw "The source-controlled draft is structurally invalid: $($draftIssues -join '; ')." }

$hostExecutable = (Get-Process -Id $PID).Path
$validateOutput = & $hostExecutable -NoProfile -File $operatorPath -Action Validate 2>&1
if ($LASTEXITCODE -ne 0) { throw "Default validation failed: $($validateOutput -join "`n")" }
$defaultPlan = ($validateOutput -join "`n") | ConvertFrom-Json
if ([bool]$defaultPlan.Executable -or [string]$defaultPlan.Status -cne "draft" -or
  @($defaultPlan.BlockingIssues | Where-Object { $_ -match "provider-failure" }).Count -ne 1) {
  throw "The default configuration is not visibly fail-closed."
}
$missingHash = Invoke-OperatorFailure @("-Action", "Plan", "-ConfigPath", $examplePath)
if ($missingHash.ExitCode -eq 0 -or $missingHash.Output -notmatch "reviewed SHA-256") {
  throw "Plan did not require an exact reviewed configuration checksum."
}

$reviewed = $example | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$reviewed.status = "reviewed"
$reviewed.release.sourceSha = "a" * 40
$reviewed.release.terraformStateSerial = 197
$reviewed.release.runtimePlanPath = ".terraform/frozen.tfplan"
$reviewed.release.runtimePlanSha256 = "b" * 64
$reviewed.release.artifacts = @(
  [pscustomobject]@{ name = "gateway"; sha256 = "1" * 64; base64Sha256 = ("A" * 43) + "="; objectVersionId = "v1" },
  [pscustomobject]@{ name = "workflow-ingress"; sha256 = "2" * 64; base64Sha256 = ("B" * 43) + "="; objectVersionId = "v2" },
  [pscustomobject]@{ name = "profile-readiness-durable"; sha256 = "3" * 64; base64Sha256 = ("C" * 43) + "="; objectVersionId = "v3" },
  [pscustomobject]@{ name = "profile-readiness-activity"; sha256 = "4" * 64; base64Sha256 = ("D" * 43) + "="; objectVersionId = "v4" }
)
$reviewed.release.migrationImage.sourceSha = "a" * 40
$reviewed.release.migrationImage.platformDigest = "sha256:$('5' * 64)"
$reviewed.release.migrationImage.receiptSha256 = "7" * 64
$reviewed.run.runId = "12345678-1234-4abc-8def-1234567890ab"
$reviewed.run.ledgerPath = ".terraform/d1-representative-acceptance/ledger.json"
foreach ($group in @("concurrency", "durationMs", "latencyMs", "errors", "queues")) {
  foreach ($property in $reviewed.thresholds.$group.PSObject.Properties) {
    $property.Value = if ($group -in @("errors", "queues")) { 0 } else { 10000 }
  }
}
$reviewed.thresholds.concurrency.read = 2
$reviewed.thresholds.concurrency.savedJob = 1
$reviewed.thresholds.concurrency.match = 1
$reviewed.thresholds.alerts.expectedHealthyAlarmCount = 10
$reviewed.thresholds.alerts.expectedConfirmedRecipientCount = 1
$reviewed.thresholds.alerts.reviewedRecipientSetSha256 = "6" * 64
foreach ($profileName in @("read", "savedJob", "match")) {
  $reviewed.profiles.$profileName.resultPath = ".terraform/d1-representative-acceptance/$profileName.json"
  $reviewed.profiles.$profileName.awsResultPath = ".terraform/d1-representative-acceptance/$profileName-aws.json"
}
$reviewed.profiles.alertDelivery.statusResultPath = ".terraform/d1-representative-acceptance/alert-status.json"
$reviewed.profiles.alertDelivery.exerciseResultPath = ".terraform/d1-representative-acceptance/alert-exercise.json"
$reviewed.profiles.alertDelivery.operatorDeliveryConfirmed = $true
$reviewed.profiles.postRun.aggregateResultPath = ".terraform/d1-representative-acceptance/post-run.json"
$reviewed.profiles.postRun.zeroDriftResultPath = ".terraform/d1-representative-acceptance/zero-drift.json"

$reviewedIssues = @(Get-ConfigurationIssues $reviewed)
if ($reviewedIssues.Count -ne 0) { throw "The fully populated reviewed shape is invalid: $($reviewedIssues -join '; ')." }
$reviewedSchemaFixture = Join-Path ([IO.Path]::GetTempPath()) "d1-representative-reviewed-$PID-$([guid]::NewGuid().ToString('N')).json"
$reviewedSchemaCheck = Join-Path $repositoryRoot "packages\api-contracts\.d1-representative-reviewed-$PID-$([guid]::NewGuid().ToString('N')).cjs"
$savedSchemaPath = $env:D1_ACCEPTANCE_SCHEMA_PATH
$savedFixturePath = $env:D1_ACCEPTANCE_FIXTURE_PATH
try {
  [IO.File]::WriteAllText(
    $reviewedSchemaFixture,
    ($reviewed | ConvertTo-Json -Depth 30),
    (New-Object Text.UTF8Encoding($false))
  )
  $env:D1_ACCEPTANCE_SCHEMA_PATH = $schemaPath
  $env:D1_ACCEPTANCE_FIXTURE_PATH = $reviewedSchemaFixture
  [IO.File]::WriteAllText(
    $reviewedSchemaCheck,
    @'
const fs = require("fs");
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats").default;
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(process.env.D1_ACCEPTANCE_SCHEMA_PATH, "utf8"));
const reviewed = JSON.parse(fs.readFileSync(process.env.D1_ACCEPTANCE_FIXTURE_PATH, "utf8"));
const validate = ajv.compile(schema);
if (!validate(reviewed)) throw new Error(JSON.stringify(validate.errors));
reviewed.thresholds.latencyMs.inventedSlo = 1;
if (validate(reviewed)) throw new Error("Unknown threshold key was accepted.");
'@,
    (New-Object Text.UTF8Encoding($false))
  )
  $schemaPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $schemaCheck = & pnpm --filter @ai-job-apply/api-contracts exec node $reviewedSchemaCheck 2>&1
    $schemaExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $schemaPreference }
  if ($schemaExitCode -ne 0) { throw "JSON Schema reviewed-shape validation failed: $($schemaCheck -join "`n")" }
} finally {
  $env:D1_ACCEPTANCE_SCHEMA_PATH = $savedSchemaPath
  $env:D1_ACCEPTANCE_FIXTURE_PATH = $savedFixturePath
  if (Test-Path -LiteralPath $reviewedSchemaFixture) { Remove-Item -LiteralPath $reviewedSchemaFixture -Force }
  if (Test-Path -LiteralPath $reviewedSchemaCheck) { Remove-Item -LiteralPath $reviewedSchemaCheck -Force }
}
$readiness = @(Get-ReadinessIssues $reviewed)
if ($readiness.Count -ne 1 -or $readiness[0] -notmatch "provider-failure") {
  throw "A fully populated reviewed configuration must be blocked only by provider-failure automation."
}
$unknownThreshold = $reviewed | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unknownThreshold.thresholds.latencyMs | Add-Member NoteProperty inventedSlo 1
if (@(Get-ConfigurationIssues $unknownThreshold).Count -eq 0) { throw "An invented threshold was accepted." }
$duplicateArtifact = $reviewed | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$duplicateArtifact.release.artifacts[3].name = "gateway"
if (@(Get-ConfigurationIssues $duplicateArtifact).Count -eq 0) { throw "A duplicate artifact binding was accepted." }

$at = "2026-08-25T01:06:56.213Z"
$later = "2026-08-25T01:07:09.107Z"
$readResult = [pscustomobject]@{
  profile = "d1_deployed_read_v1"; startedAt = $at; endedAt = $later; durationMs = 1000
  baselineContractsValidated = 4; publicRequests = 150; publicFailures = 0
  authenticatedRequests = 100; authenticatedFailures = 0
  publicLatency = [pscustomobject]@{ p50Ms = 10; p95Ms = 20; maxMs = 30 }
  authenticatedLatency = [pscustomobject]@{ p50Ms = 10; p95Ms = 20; maxMs = 30 }
}
$savedResult = [pscustomobject]@{
  profile = "d1_deployed_saved_job_lifecycle_v1"; startedAt = $at; endedAt = $later; durationMs = 1000
  catalogPagesValidated = 2; savedJobPagesValidated = 1; writesSucceeded = 1
  idempotentReplays = 1; expectedConflicts = 1; cleanupDeletes = 1; postCleanupAbsent = $true
}
$matchResult = [pscustomobject]@{
  profile = "d1_deployed_match_assessment_v1"; startedAt = $at; endedAt = $later; durationMs = 1000
  catalogPagesValidated = 1; matchAssessmentsValidated = 1; evidenceItemsValidated = 9
}
Assert-D1ApplicationResult read $readResult $reviewed.thresholds
Assert-D1ApplicationResult savedJob $savedResult $reviewed.thresholds
Assert-D1ApplicationResult match $matchResult $reviewed.thresholds
$leakyRead = $readResult | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$leakyRead | Add-Member NoteProperty candidateId "forbidden"
Assert-Rejected { Assert-D1ApplicationResult read $leakyRead $reviewed.thresholds } "private application detail"
$uncleanSaved = $savedResult | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$uncleanSaved.postCleanupAbsent = $false
Assert-Rejected { Assert-D1ApplicationResult savedJob $uncleanSaved $reviewed.thresholds } "unclean saved-job run"

$awsResult = [ordered]@{
  Environment = "development"; WorkloadProfile = "D1Read"; WindowMinutes = 2
  ApiRequests = 254; MinimumApiRequests = 254; ApiRequestsMeetMinimum = $true
  Api4xx = 50; MinimumExpected4xx = 50; Expected4xxMeetMinimum = $true; Api5xx = 0
  ApiLatencyAverageMs = 10; ApiLatencyMaximumMs = 20; LambdaInvocations = 200
  LambdaErrors = 0; LambdaThrottles = 0; LambdaDurationMaximumMs = 30
  DatabaseCpuMaxPercent = 5; DatabaseConnectionsMax = 2; EventQueueAgeMaxSeconds = 0
  EventQueueVisibleMax = 0; DeadLetterMessagesMax = 0; DurableDeadLetterMax = 0
  LogEvents = 20; LogErrorMatches = 0; ForbiddenLogMatches = 0; ActiveEcsServices = 0
  RunningEcsTasks = 0; RuntimeAlarmsOk = 10; DispatchTarget = "lambda_durable"
  TriggersEnabled = $true; TerraformDrift = 0
}
Assert-AwsAggregateResult D1Read ([pscustomobject]$awsResult) $reviewed.thresholds
$privacyFailure = ([pscustomobject]$awsResult) | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$privacyFailure.ForbiddenLogMatches = 1
Assert-Rejected { Assert-AwsAggregateResult D1Read $privacyFailure $reviewed.thresholds } "forbidden log match"

$alertStatus = [pscustomobject]@{
  profile = "d1_deployed_alert_status_v1"; checkedAt = $at; confirmedRecipients = 1
  pendingRecipients = 0; canaryState = "OK"; alarmActionCount = 1; okActionCount = 1
  healthyRuntimeAlarms = 10
}
$alertExercise = [pscustomobject]@{
  profile = "d1_deployed_alert_delivery_v1"; startedAt = $at; endedAt = $later
  durationMs = 1000; alarmTransitions = 1; recoveryTransitions = 1; deliveryConfirmed = $true
  reviewedRecipientSetSha256 = "6" * 64; finalCanaryState = "OK"
}
Assert-AlertDeliveryResults $alertStatus $alertExercise $reviewed.thresholds

$postRun = [pscustomobject]@{
  profile = "d1_deployed_provider_failure_recovery_v1"; startedAt = $at; endedAt = $later
  durationMs = 1000; providerFaultsInjected = 1; providerFailuresObserved = 1
  recoveriesSucceeded = 1; cleanupAttempted = $true; cleanupSucceeded = $true
  postCleanupArtifacts = 0; alertDeliveriesConfirmed = 1; eventQueueAgeMaxSeconds = 0
  eventQueueVisibleMax = 0; eventDeadLetterMax = 0; durableDeadLetterMax = 0
  logErrorMatches = 0; forbiddenLogMatches = 0
}
$zeroDrift = [pscustomobject]@{
  profile = "d1_post_run_zero_drift_v1"; checkedAt = $at; sourceSha = "a" * 40
  runtimePlanSha256 = "b" * 64; terraformStateSerial = 197; meaningfulChanges = 0; drift = $false
}
Assert-PostRunResults $postRun $zeroDrift $reviewed
$drifted = $zeroDrift | ConvertTo-Json | ConvertFrom-Json
$drifted.drift = $true
Assert-Rejected { Assert-PostRunResults $postRun $drifted $reviewed } "post-run drift"

Write-Output "D1 representative acceptance operator tests passed."
