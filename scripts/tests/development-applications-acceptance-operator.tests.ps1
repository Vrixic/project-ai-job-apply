Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-applications-acceptance.ps1"
$guardPath = Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1"
$scriptSourcePath = Join-Path $repositoryRoot "backend\services\applications\src\lifecycle-acceptance.ts"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) {
  throw "The development Applications acceptance operator does not parse: $($parseErrors.Message -join '; ')."
}

$script:checks = 0
function Assert-Test {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Description)
  if (-not $Condition) { throw "Guard failed: $Description" }
  $script:checks++
}

function Assert-TestRejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw "$Description was accepted." }
  $script:checks++
}

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Operator function $Name must be defined exactly once." }
  Invoke-Expression "function global:$Name $($matches[0].Body.Extent.Text)"
}

# --- Source contract -------------------------------------------------------------------------
Assert-Test ($source.Contains('lib/terraform-toolchain.ps1')) "The operator imports the shared pinned toolchain."
Assert-Test ($source -notmatch '(?im)^\s*&?\s*terraform\s+(plan|apply|destroy)\b') "The operator never runs terraform plan, apply, or destroy."
Assert-Test ($source -notmatch '-lock=false') "The operator never disables state locking."
Assert-Test ($source.Contains('$acceptanceCommand = @("applications/dist/src/run-lifecycle-acceptance.js")')) "The task command is exactly the reviewed in-image entry point."
Assert-Test ($source.Contains('$confirmation = "generated-synthetic-applications-acceptance"')) "The generated-synthetic confirmation is fixed."
Assert-Test ($source.Contains('[ValidateSet("Status", "Plan", "Execute", "RecoverCleanup", "Verify")]')) "The action set is exact."
Assert-Test ($source.Contains('if ($Region -cne "us-east-2")')) "The region is pinned."
foreach ($forbidden in @("Command", "Sql", "Query", "Container", "Environment", "Payload", "Token", "Jwt", "Bearer")) {
  $declared = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -match $forbidden })
  Assert-Test ($declared.Count -eq 0) "The operator declares no caller-controlled '$forbidden' parameter."
}
Assert-Test ((@($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) -join ",") -ceq
  "Action,AwsProfile,Region,ExpectedAccountId,StateBucket,SourceSha,MigrationReceiptPath,ReviewedMigrationReceiptSha256,ExpectedGatewayArtifactSha256,ExpectedGatewayVersion,RunId,ExecutionPlanPath,ReviewedExecutionPlanSha256,ReceiptPath,ReviewedReceiptSha256,Help") `
  "The public parameter surface is exact."

# The operator and the in-image script must agree on every environment name and the confirmation.
$imageSource = Get-Content -LiteralPath $scriptSourcePath -Raw
$imageNames = @([regex]::Matches($imageSource, 'APPLICATIONS_ACCEPTANCE_[A-Z_]+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
$operatorNames = @([regex]::Matches($source, 'APPLICATIONS_ACCEPTANCE_[A-Z_]+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
Assert-Test (($imageNames -join "|") -ceq ($operatorNames -join "|")) "The operator and image script use exactly the same environment names."
Assert-Test ($imageSource.Contains('"generated-synthetic-applications-acceptance"')) "The image script requires the same confirmation."
Assert-Test ($imageSource.Contains('d3-applications-acceptance:${role}:${runId}')) "The image script derives the same fixed subjects."
Assert-Test ($source.Contains('d3-applications-acceptance:owner:$($Plan.runId)') -and $source.Contains('d3-applications-acceptance:other:$($Plan.runId)')) "The operator uses the same fixed subjects."

# The lifecycle is a closed, ordered, uniquely named set of steps that equals the declared count.
$lifecycle = @($ast.FindAll({ param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Invoke-Lifecycle" }, $true))[0]
$stepNames = @([regex]::Matches($lifecycle.Extent.Text, 'Assert-Step "([a-z0-9-]+)"') | ForEach-Object { $_.Groups[1].Value })
$declaredCount = [int]([regex]::Match($source, '\$expectedCaseCount = (\d+)').Groups[1].Value)
Assert-Test ($stepNames.Count -eq $declaredCount) "The declared step count equals the lifecycle steps."
Assert-Test (@($stepNames | Sort-Object -Unique).Count -eq $stepNames.Count) "Every lifecycle step name is unique."
foreach ($required in @("create-no-scope", "create-read-only", "create-replay", "foreign-get", "foreign-history", "approve-wrong-hash",
    "start-changed-form", "start-duplicate", "dispatch-repeat", "result-timeout", "start-after-ambiguous", "reconcile-attested",
    "history", "start-after-applied", "idempotency-conflict")) {
  Assert-Test ($stepNames -contains $required) "The lifecycle proves '$required'."
}
Assert-Test ($lifecycle.Extent.Text -notmatch 'provider_confirmation_page|provider_api_response|kind = "confirmed"') "The lifecycle never claims a provider confirmation."
Assert-Test ($lifecycle.Extent.Text.Contains('user_attested_submitted')) "The submitted state is reached only by candidate attestation."

# The gateway is never called after cleanup or during verification: a request for a removed identity would create a new one.
$verifySection = $source.Substring($source.LastIndexOf('if ([string]$acceptanceReceipt.phase -cne "verified"'))
Assert-Test ($verifySection -notmatch 'Invoke-AppsGateway|Submit-AcceptanceTask') "Verify makes no gateway call and submits no task."
$recoverSection = $source.Substring($source.IndexOf('if ($Action -ceq "RecoverCleanup")'), 1400)
Assert-Test ($recoverSection -notmatch 'Invoke-AppsGateway' -and $recoverSection.Contains('requestByPhase.cleanup') -and $recoverSection -notmatch 'requestByPhase.prepare') "RecoverCleanup can only submit the fixed cleanup request."
Assert-Test ($source.Contains('if ($prepareMayHaveStarted)')) "Cleanup is always attempted once prepare may have started."
Assert-Test ($source -notmatch 'Invoke-AppsGateway[^\n]*-Subject\s+"(?!d3-applications-acceptance)') "Every gateway subject is a generated acceptance subject."

# --- Functions -------------------------------------------------------------------------------
. $guardPath
foreach ($name in @(
    "Get-OptionalProperty", "Get-OptionalCollection", "Assert-ExactPropertySet", "Test-CanonicalUtcTimestamp", "Get-FileSha256",
    "Get-TextSha256", "ConvertFrom-AcceptanceJson", "Resolve-PathBelowRoot", "Write-JsonFile", "New-UuidV7",
    "New-AcceptanceEnvironment", "New-RunTaskRequest", "Assert-RunTaskRequest", "Assert-Step", "Get-StepValue",
    "Invoke-Lifecycle", "Read-AcceptanceReceipt", "Assert-ActionInputs")) {
  Import-OperatorFunction $name
}
$script:caseLog = [Collections.Generic.List[string]]::new()
$containerName = "database-migration"
$acceptanceCommand = @("applications/dist/src/run-lifecycle-acceptance.js")
$confirmation = "generated-synthetic-applications-acceptance"
$planKind = "development-applications-lifecycle-acceptance"
$expectedCaseCount = $declaredCount
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$Region = "us-east-2"
$ExpectedAccountId = "111122223333"
$SourceSha = "a" * 40
$ReviewedMigrationReceiptSha256 = "b" * 64
$ExpectedGatewayArtifactSha256 = "c" * 64
$ExpectedGatewayVersion = 77
$ReviewedExecutionPlanSha256 = "d" * 64
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "applications-acceptance-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = Join-Path $testRoot "development-applications-acceptance"
$null = New-Item -ItemType Directory -Path $operatorRoot -Force

try {
  # UUID v7 identities are well formed, time ordered, and distinct.
  $first = New-UuidV7
  Start-Sleep -Milliseconds 5
  $second = New-UuidV7
  $uuidV7 = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  Assert-Test ($first -match $uuidV7 -and $second -match $uuidV7 -and $first -cne $second) "Generated identities are distinct UUID v7 values."
  Assert-Test ($first.Substring(0, 13) -le $second.Substring(0, 13)) "Generated identities are time ordered."

  # The task environment is the exact reviewed set, and only prepare carries a timestamp.
  $identity = [pscustomobject]@{
    RunId = "0f6f2d5e-6a54-4d27-9c3a-4b0f2b8e8c11"; Issuer = "https://example-tenant.us.auth0.com/"
    OwnerUserId = "019d04cf-1f80-7000-8000-000000000001"; OtherUserId = "019d04cf-1f80-7000-8000-000000000002"
  }
  $at = "2026-09-18T12:00:00.000Z"
  $prepareEnvironment = @(New-AcceptanceEnvironment -Phase prepare -Identity $identity -At $at)
  $cleanupEnvironment = @(New-AcceptanceEnvironment -Phase cleanup -Identity $identity -At $at)
  Assert-Test ($prepareEnvironment.Count -eq 7 -and $cleanupEnvironment.Count -eq 6) "Only prepare carries the timestamp."
  Assert-Test (@($cleanupEnvironment | Where-Object { $_.name -ceq "APPLICATIONS_ACCEPTANCE_AT" }).Count -eq 0) "Cleanup carries no timestamp."

  # The run-task request is exact and any deviation is refused.
  $runtime = [pscustomobject]@{
    ClusterArn = "arn:aws:ecs:us-east-2:111122223333:cluster/ai-job-apply-development"
    TaskDefinitionArn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-database-migration:55"
    Subnets = @("subnet-aaaaaaaa", "subnet-bbbbbbbb"); SecurityGroup = "sg-cccccccc"
  }
  function New-Request([string]$phase) {
    return New-RunTaskRequest -Runtime $runtime -Phase $phase -Identity $identity -At $at -ClientToken "d3-apps-$phase-$('a' * 32)" -StartedBy "d3-apps-aaaaaaaaaaaa"
  }
  foreach ($phase in @("prepare", "cleanup")) {
    Assert-Test (Assert-RunTaskRequest -Request (New-Request $phase) -Runtime $runtime -Phase $phase -Identity $identity -At $at) "The exact $phase request is accepted."
  }
  $mutations = @{
    "an extra environment entry"  = { param($r) $r.overrides.containerOverrides[0].environment += [ordered]@{ name = "EXTRA"; value = "1" } }
    "a changed command"           = { param($r) $r.overrides.containerOverrides[0].command = @("runner/dist/src/main.js") }
    "a changed container name"    = { param($r) $r.overrides.containerOverrides[0].name = "other" }
    "a second container override" = { param($r) $r.overrides.containerOverrides += $r.overrides.containerOverrides[0] }
    "a changed task definition"   = { param($r) $r.taskDefinition = "arn:aws:ecs:us-east-2:111122223333:task-definition/other:1" }
    "a changed run id value"      = { param($r) $r.overrides.containerOverrides[0].environment[2].value = "1f6f2d5e-6a54-4d27-9c3a-4b0f2b8e8c11" }
    "a bad client token"          = { param($r) $r.clientToken = "d1-search-prepare-$('a' * 32)" }
    "a bad startedBy"             = { param($r) $r.startedBy = "d3-apps-zz" }
    "a count of two"              = { param($r) $r.count = 2 }
    "an extra top-level property" = { param($r) $r["taskRoleOverride"] = "x" }
  }
  foreach ($label in $mutations.Keys) {
    $request = New-Request "prepare"
    & $mutations[$label] $request
    Assert-TestRejected { $null = Assert-RunTaskRequest -Request $request -Runtime $runtime -Phase prepare -Identity $identity -At $at } "A prepare request with $label"
  }

  # Input combinations are exact per action.
  function Test-Inputs([string]$action, [hashtable]$values) {
    $script:Action = $action
    foreach ($name in @("SourceSha", "MigrationReceiptPath", "ReviewedMigrationReceiptSha256", "ExpectedGatewayArtifactSha256", "RunId",
        "ExecutionPlanPath", "ReviewedExecutionPlanSha256", "ReceiptPath", "ReviewedReceiptSha256")) { Set-Variable -Name $name -Value "" -Scope Script }
    $script:ExpectedGatewayVersion = 0
    foreach ($key in $values.Keys) { Set-Variable -Name $key -Value $values[$key] -Scope Script }
    Assert-ActionInputs
  }
  $release = @{ SourceSha = "a" * 40; MigrationReceiptPath = "r.json"; ReviewedMigrationReceiptSha256 = "b" * 64; ExpectedGatewayArtifactSha256 = "c" * 64; ExpectedGatewayVersion = 77 }
  Test-Inputs "Status" @{}
  Assert-TestRejected { Test-Inputs "Status" @{ SourceSha = "a" * 40 } } "Status with a source"
  Test-Inputs "Plan" $release
  Assert-TestRejected { Test-Inputs "Plan" @{} } "Plan without release inputs"
  Assert-TestRejected { Test-Inputs "Plan" ($release + @{ RunId = "not-a-uuid" }) } "Plan with a malformed run id"
  Assert-TestRejected { Test-Inputs "Plan" ($release + @{ ReviewedExecutionPlanSha256 = "d" * 64 }) } "Plan with a reviewed plan hash"
  Test-Inputs "Execute" ($release + @{ ExecutionPlanPath = "p.json"; ReviewedExecutionPlanSha256 = "d" * 64 })
  Assert-TestRejected { Test-Inputs "Execute" ($release + @{ ExecutionPlanPath = "p.json"; ReviewedExecutionPlanSha256 = "d" * 64; RunId = ("0f6f2d5e-6a54-4d27-9c3a-4b0f2b8e8c11") }) } "Execute with a caller-selected run id"
  Assert-TestRejected { Test-Inputs "Execute" ($release + @{ ExecutionPlanPath = "p.json"; ReviewedExecutionPlanSha256 = "d" * 64; ReceiptPath = "x.json"; ReviewedReceiptSha256 = "e" * 64 }) } "Execute with prior receipt evidence"
  Assert-TestRejected { Test-Inputs "Verify" ($release + @{ ExecutionPlanPath = "p.json"; ReviewedExecutionPlanSha256 = "d" * 64 }) } "Verify without a receipt pair"
  Test-Inputs "RecoverCleanup" ($release + @{ ExecutionPlanPath = "p.json"; ReviewedExecutionPlanSha256 = "d" * 64; ReceiptPath = "x.json"; ReviewedReceiptSha256 = "e" * 64 })

  # --- Receipt matrix ------------------------------------------------------------------------
  $Region = "us-east-2"
  $taskA = "arn:aws:ecs:us-east-2:111122223333:task/ai-job-apply-development/$('1' * 32)"
  $taskB = "arn:aws:ecs:us-east-2:111122223333:task/ai-job-apply-development/$('2' * 32)"
  $planEvidence = [pscustomobject]@{ Plan = [pscustomobject]@{ runId = $identity.RunId }; Runtime = $runtime }
  function New-Receipt([hashtable]$overrides = @{}) {
    $value = [ordered]@{
      schemaVersion = 1; kind = $planKind; environment = "development"; sourceSha = $SourceSha
      executionPlanSha256 = $ReviewedExecutionPlanSha256; migrationReceiptSha256 = $ReviewedMigrationReceiptSha256
      gatewayArtifactSha256 = $ExpectedGatewayArtifactSha256; gatewayVersion = $ExpectedGatewayVersion; runId = $identity.RunId
      phase = "verified"; claimKey = "operator-claims/development-applications-acceptance/$ReviewedExecutionPlanSha256.json"
      claimVersionId = "version-1"; claimChecksumSHA256 = ("A" * 43) + "="; prepareTaskArn = $taskA; cleanupTaskArn = $taskB
      caseResultsSha256 = "e" * 64; caseCount = $expectedCaseCount; applicationsDeleted = 1; postCleanupRows = 0
      startedAt = "2026-09-18T12:00:00.0000000+00:00"; completedAt = "2026-09-18T12:05:00.0000000+00:00"
    }
    foreach ($key in $overrides.Keys) { $value[$key] = $overrides[$key] }
    $path = Join-Path $operatorRoot "receipt-$([guid]::NewGuid().ToString('N')).json"
    Write-JsonFile -Path $path -Value $value
    return $path
  }
  function Read-Receipt([hashtable]$overrides = @{}) {
    $path = New-Receipt $overrides
    return Read-AcceptanceReceipt -Path $path -Sha256 (Get-FileSha256 -Path $path) -PlanEvidence $planEvidence
  }
  Assert-Test ((Read-Receipt).Receipt.phase -ceq "verified") "The exact verified receipt is accepted."
  $badReceipts = [ordered]@{
    "a different source"              = @{ sourceSha = "f" * 40 }
    "a different plan hash"           = @{ executionPlanSha256 = "f" * 64 }
    "a different gateway version"     = @{ gatewayVersion = 78 }
    "a different run"                 = @{ runId = "1f6f2d5e-6a54-4d27-9c3a-4b0f2b8e8c11" }
    "an unknown phase"                = @{ phase = "done" }
    "a verified receipt with 23 cases" = @{ caseCount = $expectedCaseCount - 1 }
    "a verified receipt deleting none" = @{ applicationsDeleted = 0 }
    "a verified receipt with leftovers" = @{ postCleanupRows = -1 }
    "a verified receipt with one task" = @{ cleanupTaskArn = $taskA }
    "a verified receipt without hash" = @{ caseResultsSha256 = "" }
    "a foreign task ARN"              = @{ cleanupTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/another-cluster/$('2' * 32)" }
    "a missing claim"                 = @{ claimVersionId = "" }
    "an unfinished terminal receipt"  = @{ completedAt = "" }
    "a terminal receipt that skipped cleanup" = @{ phase = "failed-cleaned"; cleanupTaskArn = ""; postCleanupRows = -1 }
  }
  foreach ($label in $badReceipts.Keys) {
    Assert-TestRejected { $null = Read-Receipt $badReceipts[$label] } "A receipt with $label"
  }
  Assert-Test ((Read-Receipt @{ phase = "failed-cleaned"; caseCount = 3; caseResultsSha256 = ""; applicationsDeleted = 1 }).Receipt.phase -ceq "failed-cleaned") "A failed but cleaned receipt is a valid, non-accepting record."
  Assert-Test ((Read-Receipt @{ phase = "claiming"; claimKey = ""; claimVersionId = ""; claimChecksumSHA256 = ""; prepareTaskArn = ""; cleanupTaskArn = ""; caseResultsSha256 = ""; caseCount = 0; applicationsDeleted = -1; postCleanupRows = -1; completedAt = "" }).Receipt.phase -ceq "claiming") "A claiming receipt proves no claim and no task."
  Assert-TestRejected { $null = Read-Receipt @{ phase = "claiming"; claimKey = ""; claimVersionId = ""; claimChecksumSHA256 = ""; prepareTaskArn = $taskA; cleanupTaskArn = ""; caseResultsSha256 = ""; caseCount = 0; applicationsDeleted = -1; postCleanupRows = -1; completedAt = "" } } "A claiming receipt that recorded a task"

  # --- Simulated lifecycle ----------------------------------------------------------------------
  $appId = "019d04cf-1f80-7000-8000-0000000000a1"
  $attemptId = "019d04cf-1f80-7000-8000-0000000000b1"
  $script:deviation = @{}
  $script:invocations = [Collections.Generic.List[string]]::new()
  function New-Response([int]$status, $body) {
    $type = if ($status -ge 400) { "application/problem+json" } else { "application/json" }
    if ($script:deviation.ContainsKey("type")) { $type = "text/html" }
    return [pscustomobject]@{ statusCode = $status; headers = [pscustomobject]@{ "content-type" = $type }; body = ($body | ConvertTo-Json -Depth 20 -Compress) }
  }
  function Invoke-AppsGateway {
    param($Gateway, [string]$Subject, [string[]]$Scopes, [string]$Method, [string]$Path, [string]$CaseName, $Body = $null, [string]$IdempotencyKey = "")
    $script:invocations.Add("$CaseName|$Subject|$($Scopes -join ' ')|$Method|$Path")
    if ($script:deviation.ContainsKey($CaseName)) { return New-Response $script:deviation[$CaseName].status $script:deviation[$CaseName].body }
    $problem = { param($status, $code) New-Response $status @{ type = "urn:ai-job-apply:problem:$code"; title = "t"; status = $status; code = $code; traceId = "x" } }
    switch ($CaseName) {
      { $_ -in @("create-no-scope", "create-read-only") } { return & $problem 403 "forbidden" }
      "create" { return New-Response 201 @{ id = $appId; status = "preparing"; revision = 1; currentAction = "prepare_packet"; attempts = @() } }
      "create-replay" { return New-Response 201 @{ id = $appId; status = "preparing"; revision = 1; currentAction = "prepare_packet"; attempts = @() } }
      { $_ -in @("foreign-get", "foreign-packet", "foreign-history") } { return & $problem 404 "application_not_found" }
      "packet" { return New-Response 201 @{ id = $appId; status = "review_required"; revision = 2; currentPacket = @{ packetHash = ("a" * 64) } } }
      "approve-wrong-hash" { return & $problem 409 "application_approval_refused" }
      "approve" { return New-Response 200 @{ id = $appId; status = "approved"; revision = 3 } }
      "start-changed-form" { return New-Response 200 @{ outcome = "approval_invalidated"; invalidationReasons = @("form_changed"); application = @{ status = "review_required"; revision = 4 } } }
      "packet-again" { return New-Response 201 @{ id = $appId; status = "review_required"; revision = 5; currentPacket = @{ packetHash = ("b" * 64) } } }
      "approve-again" { return New-Response 200 @{ id = $appId; status = "approved"; revision = 6 } }
      "start" { return New-Response 200 @{ outcome = "started"; attemptId = $attemptId; application = @{ status = "submitting"; revision = 7 } } }
      { $_ -in @("start-duplicate", "dispatch-repeat", "start-after-ambiguous", "start-after-applied") } { return & $problem 409 "application_attempt_refused" }
      "dispatch" { return New-Response 200 @{ id = $attemptId; status = "dispatched" } }
      "result-timeout" { return New-Response 200 @{ id = $appId; status = "reconciliation_required"; revision = 9 } }
      "reconcile-attested" { return New-Response 200 @{ id = $appId; status = "applied"; revision = 10 } }
      "history" {
        $kinds = @("application_created", "packet_created", "approval_recorded", "approval_invalidated", "packet_created", "approval_recorded", "attempt_started", "attempt_dispatched", "submission_ambiguous", "submission_confirmed")
        return New-Response 200 @{ entries = @($kinds | ForEach-Object { @{ kind = $_ } }); hasMore = $false }
      }
      "get-final" { return New-Response 200 @{ id = $appId; status = "applied"; attempts = @(@{ status = "confirmed"; confirmation = @{ kind = "user_attested" } }) } }
      "idempotency-conflict" { return & $problem 409 "idempotency_conflict" }
      default { throw "The simulated gateway has no response for '$CaseName'." }
    }
  }
  $gateway = [pscustomobject]@{ Issuer = "https://example-tenant.us.auth0.com/"; Audience = "ai-job-apply-api"; FunctionName = "f"; AliasName = "development"; Version = "77" }
  $plan = [pscustomobject]@{ runId = $identity.RunId; jobId = "019d04cf-1f80-7000-8000-0000000000e1" }

  $cases = @(Invoke-Lifecycle -Gateway $gateway -Plan $plan)
  Assert-Test ($cases.Count -eq $expectedCaseCount) "The simulated lifecycle completes every declared step."
  Assert-Test (($cases -join "|") -ceq (($cases | Select-Object -Unique) -join "|")) "Every recorded step is unique."
  $ownerSubject = "d3-applications-acceptance:owner:$($identity.RunId)"
  $otherSubject = "d3-applications-acceptance:other:$($identity.RunId)"
  $subjects = @($script:invocations | ForEach-Object { $_.Split("|")[1] } | Sort-Object -Unique)
  Assert-Test (($subjects -join "|") -ceq ((@($ownerSubject, $otherSubject) | Sort-Object) -join "|")) "Only the two generated subjects ever call the gateway."
  Assert-Test (@($script:invocations | Where-Object { $_ -match '^foreign-' -and $_.Split("|")[1] -cne $otherSubject }).Count -eq 0) "Foreign steps use only the foreign subject."
  Assert-Test (@($script:invocations | Where-Object { $_ -match '^create-no-scope\|.*\|profile:read\|' }).Count -eq 1) "The missing-scope step carries no Applications scope."
  Assert-Test (@($script:invocations | Where-Object { $_ -match '^create-read-only\|.*\|applications:read profile:read\|' }).Count -eq 1) "The read-only step carries no write scope."
  Assert-Test (@($script:invocations | Where-Object { $_ -match '/v1/applications' } | Where-Object { $_ -notmatch '^plan-' }).Count -eq $expectedCaseCount) "Every step targets only an Applications route."

  # Any deviation in a single step fails the whole lifecycle instead of being recorded as success.
  $deviationCases = @(
    @("start-duplicate", 200, @{ outcome = "started" }),
    @("dispatch-repeat", 200, @{ status = "dispatched" }),
    @("start-after-ambiguous", 200, @{ outcome = "started" }),
    @("start-after-applied", 200, @{ outcome = "started" }),
    @("foreign-get", 200, @{ id = $appId }),
    @("foreign-history", 200, @{ entries = @(); hasMore = $false }),
    @("create-no-scope", 201, @{ id = $appId; status = "preparing"; revision = 1 }),
    @("approve-wrong-hash", 200, @{ id = $appId; status = "approved"; revision = 3 }),
    @("start-changed-form", 200, @{ outcome = "started"; attemptId = $attemptId; application = @{ status = "submitting"; revision = 5 } }),
    @("result-timeout", 200, @{ id = $appId; status = "applied"; revision = 9 }),
    @("reconcile-attested", 200, @{ id = $appId; status = "reconciliation_required"; revision = 10 }),
    @("history", 200, @{ entries = @(@{ kind = "interview_scheduled" }); hasMore = $false }),
    @("get-final", 200, @{ id = $appId; status = "applied"; attempts = @(@{ status = "confirmed"; confirmation = @{ kind = "provider_confirmation_page" } }) }),
    @("idempotency-conflict", 409, @{ type = "urn:ai-job-apply:problem:other"; title = "t"; status = 409; code = "application_revision_conflict"; traceId = "x" })
  )
  foreach ($deviation in $deviationCases) {
    $script:deviation = @{ $deviation[0] = @{ status = $deviation[1]; body = $deviation[2] } }
    Assert-TestRejected { $null = Invoke-Lifecycle -Gateway $gateway -Plan $plan } "A lifecycle where '$($deviation[0])' deviates"
  }
  $script:deviation = @{ type = $true }
  Assert-TestRejected { $null = Invoke-Lifecycle -Gateway $gateway -Plan $plan } "A lifecycle answered with a non-JSON content type"
  $script:deviation = @{}
  Assert-Test (@(Invoke-Lifecycle -Gateway $gateway -Plan $plan).Count -eq $expectedCaseCount) "The lifecycle is repeatable after deviations."
} finally {
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Host "Development Applications acceptance operator guard tests passed ($script:checks checks; no cloud calls)."
