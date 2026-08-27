Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-d1-provider-failure-acceptance.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The provider-failure acceptance operator does not parse." }

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

$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ExpectedAccountId", "StateBucket", "SourceSha",
  "ProviderFixtureBindingPath", "ReviewedProviderFixtureBindingSha256", "RunId", "ExpectedDurableVersion",
  "ExpectedActivityVersion", "ExpectedDurableArtifactSha256", "ExpectedDurableCodeSha256",
  "ExpectedActivityArtifactSha256", "ExpectedActivityCodeSha256", "ExecutionPlanPath",
  "ReviewedExecutionPlanSha256", "ReceiptPath", "ReviewedReceiptSha256", "MaximumPollSeconds", "Help"
)
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The provider-failure operator public parameter surface changed."
}

foreach ($requiredText in @(
    '[ValidateSet("Validate", "Plan", "Execute", "Verify")]',
    '"d1-generated-synthetic-provider-failure-v1"',
    '"synthetic-d1-provider-fault-v1"',
    '"d1_deployed_provider_failure_recovery_v1"',
    '"d1_post_run_zero_drift_v1"',
    '"lambda", "list-durable-executions-by-function"',
    '"lambda", "get-durable-execution"',
    '--durable-execution-name $ExecutionName',
    '--function-name $Boundary.DurableArn',
    '"$($_):development"',
    '"--function-name", $functionTarget'
  )) {
  if (-not $source.Contains($requiredText)) { throw "The operator is missing required contract text '$requiredText'." }
}
foreach ($forbiddenText in @(
    "send-message", "enable-rule", "update-event-source-mapping", "run-task", "start-task",
    "Invoke-WebRequest", "Invoke-RestMethod", "docker", "wsl", "terraform apply", "terraform destroy"
  )) {
  if ($source -match [regex]::Escape($forbiddenText)) { throw "The operator contains forbidden effect '$forbiddenText'." }
}
$durableLookupDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-DurableExecutionMatches'
    }, $true))[0].Extent.Text
if (-not $durableLookupDefinition.Contains('"--function-name", $durableFunctionName') -or
  -not $durableLookupDefinition.Contains('"--durable-execution-name", $ExecutionName') -or
  $durableLookupDefinition.Contains('"--qualifier"')) {
  throw 'The durable execution lookup must use the supported function/name filter and validate the numeric version locally.'
}
$allowlistMatch = [regex]::Match($source, '(?s)\$allowedOperatorDelta\s*=\s*@\((.*?)\)')
if (-not $allowlistMatch.Success) { throw "The exact provider operator-source allowlist is missing." }
$allowlistLiterals = @([regex]::Matches($allowlistMatch.Groups[1].Value, '"([^"\r\n]+)"') | ForEach-Object { $_.Groups[1].Value })
$expectedAllowlistLiterals = @(
  "scripts/operate-development-d1-provider-failure-acceptance.ps1",
  "scripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1",
  "scripts/operate-development-document-processing-acceptance.ps1",
  "scripts/tests/development-document-processing-acceptance-operator.tests.ps1"
)
if (($allowlistLiterals -join "|") -cne ($expectedAllowlistLiterals -join "|") -or
  @([regex]::Matches($allowlistMatch.Groups[1].Value, '\$runbookPath')).Count -ne 1 -or
  $allowlistMatch.Groups[1].Value -match '(?i)vercel|\.vercelignore') {
  throw "The operator-source allowlist is not limited to the two provider and two corpus operator artifacts plus the provider runbook."
}
foreach ($provenanceText in @(
    'Assert-AllowedOperatorDelta -FromSha $SourceSha -ToSha $ExpectedOperatorSourceSha',
    'Assert-AllowedOperatorDelta -FromSha $ExpectedOperatorSourceSha -ToSha $head',
    'Plan and Execute require clean origin/main to equal the reviewed operator source.'
  )) {
  if (-not $source.Contains($provenanceText)) { throw "The operator is missing provenance constraint '$provenanceText'." }
}
$executeOffset = $source.IndexOf('if ($Action -ceq "Execute")')
$receiptWriteOffset = $source.IndexOf('Write-JsonFile -Path $resolvedReceipt -Value $receipt', $executeOffset)
$invokeOffset = $source.IndexOf('Invoke-ExactDurableExecution', $receiptWriteOffset)
$verifyOffset = $source.IndexOf('$resolvedReceipt = Resolve-PathBelowRoot', $invokeOffset)
if ($executeOffset -lt 0 -or $receiptWriteOffset -lt $executeOffset -or $invokeOffset -lt $receiptWriteOffset -or $verifyOffset -lt $invokeOffset) {
  throw "Execute does not persist its one-run receipt before the sole durable invocation."
}
$verifySource = $source.Substring($verifyOffset)
if ($verifySource.Contains('Invoke-ExactDurableExecution') -or $verifySource -match 'aws\s+lambda\s+invoke') {
  throw "Verify can start a second durable execution."
}
$invokeDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-ExactDurableExecution'
    }, $true))[0].Extent.Text
if ($invokeDefinition.Contains('ExecutedVersion') -or
  -not $invokeDefinition.Contains('[int]$response.StatusCode -ne 202') -or
  -not $invokeDefinition.Contains('[regex]::Escape($Boundary.DurableArn)') -or
  -not $invokeDefinition.Contains('[regex]::Escape($ExecutionName)')) {
  throw 'The async durable response must bind status, qualified version ARN, and execution name without requiring an absent ExecutedVersion field.'
}
$preDriftOffset = $source.IndexOf('Invoke-FreshZeroDriftPlan $reviewedZeroDrift.Plan "pre-run"')
$planBuildOffset = $source.IndexOf('New-ExecutionPlan $binding $boundary $executionName $freshZeroDrift')
$waitOffset = $source.IndexOf('Wait-ExactDurableResult -DurableExecutionArn $executionArn')
$postStateOffset = $source.IndexOf('$postSnapshot = Read-StateSnapshot', $waitOffset)
$postDriftOffset = $source.IndexOf('Invoke-FreshZeroDriftPlan $Binding.ReviewedPlan "post-run"', $postStateOffset)
if ($preDriftOffset -lt 0 -or $planBuildOffset -lt $preDriftOffset -or $waitOffset -lt 0 -or
  $postStateOffset -lt $waitOffset -or $postDriftOffset -lt $postStateOffset) {
  throw "Fresh refresh-backed drift plans are not ordered before Plan approval and after the deployed execution."
}
$freshPlanDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-FreshZeroDriftPlan'
    }, $true))[0].Extent.Text
if (-not $freshPlanDefinition.Contains('ConvertTo-TerraformVariableText $property.Value.value') -or
  $freshPlanDefinition.Contains('ConvertTo-TerraformVariableText (Get-OptionalProperty')) {
  throw 'Terraform variable reconstruction must preserve plan variable arrays without pipeline enumeration.'
}

foreach ($name in @(
    "Get-FileSha256", "ConvertFrom-OperatorJson", "ConvertFrom-BoundedJsonString", "Assert-ExactProperties", "Test-CanonicalTimestamp", "Get-OptionalProperty",
    "Resolve-PathBelowRoot", "Write-JsonFile", "New-DurableExecutionName", "Assert-OperatorDeltaRecordSet", "Read-ProviderFixtureBinding",
    "Assert-ZeroChangePlan", "ConvertTo-TerraformVariableText", "Assert-StateBoundary", "Get-StateResource", "Get-StateResourceInstances", "Get-IngestionNetworkBoundary",
    "Assert-LiveIngestionNetworkBoundary", "Assert-LiveBoundary", "Get-AllIngestionMappings", "Get-DurableExecutionMatches", "New-WorkflowPayload",
    "New-ExecutionPlan", "Read-ExecutionPlan", "Wait-ExactDurableResult", "New-Receipt", "Assert-Receipt",
    "Assert-InvocationArtifactsAbsent", "Assert-ProviderAggregate", "Assert-ZeroDriftEvidence", "Write-OrValidateEvidence", "Complete-Evidence"
  )) { Import-OperatorFunction $name }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "d1-provider-failure-operator-$PID-$([guid]::NewGuid().ToString('N'))"
$representativeRoot = Join-Path $temporaryRoot "representative"
$operatorRoot = Join-Path $temporaryRoot "operator"
$terraformDataRoot = $temporaryRoot
$null = New-Item -ItemType Directory -Path $representativeRoot -Force
$null = New-Item -ItemType Directory -Path $operatorRoot -Force
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$Region = "us-east-2"
$ExpectedAccountId = "111122223333"
$SourceSha = "a" * 40
$ReviewedProviderFixtureBindingSha256 = ""
$RunId = "12345678-1234-4abc-8def-1234567890ab"
$ExpectedDurableVersion = 17
$ExpectedActivityVersion = 23
$ExpectedDurableArtifactSha256 = "b" * 64
$ExpectedDurableCodeSha256 = ("A" * 43) + "="
$ExpectedActivityArtifactSha256 = "c" * 64
$ExpectedActivityCodeSha256 = ("B" * 43) + "="
$ReviewedExecutionPlanSha256 = "d" * 64
$MaximumPollSeconds = 30
$fixtureKind = "d1-generated-synthetic-provider-failure-v1"
$fixtureSourceId = "synthetic-d1-provider-fault-v1"
$fixtureAdapterVersion = "synthetic-d1-provider-fault-v1"
$durableFunctionName = "ai-job-apply-development-ingestion-durable"
$activityFunctionName = "ai-job-apply-development-ingestion-activity"
$scheduleRuleName = "ai-job-apply-development-ingestion-schedule"
$terminalRuleName = "ai-job-apply-development-ingestion-terminal"
$dispatchQueueName = "ai-job-apply-development-ingestion-dispatch"
$deadLetterQueueName = "ai-job-apply-development-ingestion-dead-letter"
$ecsClusterName = "ai-job-apply-development"
$applicationLogGroup = "/ai-job-apply/development/application"
$allowedOperatorDelta = @(
  "scripts/operate-development-d1-provider-failure-acceptance.ps1",
  "scripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1",
  "infrastructure/runbooks/observability/development-d1-provider-failure-acceptance.md",
  "scripts/operate-development-document-processing-acceptance.ps1",
  "scripts/tests/development-document-processing-acceptance-operator.tests.ps1"
)

try {
  if ((ConvertTo-TerraformVariableText @('http://localhost:3000')) -cne '["http://localhost:3000"]' -or
    (ConvertTo-TerraformVariableText @('one', 'two')) -cne '["one","two"]') {
    throw 'Terraform variable reconstruction did not preserve one- and multi-element composite values.'
  }
  $executionName = New-DurableExecutionName $RunId
  if ($executionName -cne "d1-provider-failure-1234567812344abc8def1234567890ab" -or $executionName.Length -gt 64) {
    throw "The durable execution name is not the exact bounded UUID-derived identity."
  }
  foreach ($invalidRun in @(
      $RunId.ToUpperInvariant(), "12345678-1234-7abc-8def-1234567890ab", "12345678-1234-4abc-0def-1234567890ab"
    )) { Assert-Rejected { New-DurableExecutionName $invalidRun } "invalid run ID $invalidRun" }

  foreach ($allowedPath in $allowedOperatorDelta) {
    $allowedRecord = "M`t$allowedPath"
    $null = Assert-OperatorDeltaRecordSet -Detected @($allowedRecord) -Records @($allowedRecord) `
      -Numstat @("1`t1`t$allowedPath")
  }
  $allowedRecord = "M`tscripts/operate-development-d1-provider-failure-acceptance.ps1"
  foreach ($deltaTamper in @(
      "empty", "unapproved", "vercel-operator", "vercel-ignore", "rename", "copy", "binary", "record-mismatch", "path-mismatch"
    )) {
    $detected = @($allowedRecord)
    $records = @($allowedRecord)
    $numstat = @("1`t1`tscripts/operate-development-d1-provider-failure-acceptance.ps1")
    switch ($deltaTamper) {
      "empty" { $detected = @(); $records = @(); $numstat = @() }
      "unapproved" { $detected = @("M`tpackages/runtime/provider.ts"); $records = $detected; $numstat = @("1`t1`tpackages/runtime/provider.ts") }
      "vercel-operator" { $detected = @("M`tscripts/operate-vercel-phase1-hosted-acceptance.ps1"); $records = $detected; $numstat = @("1`t1`tscripts/operate-vercel-phase1-hosted-acceptance.ps1") }
      "vercel-ignore" { $detected = @("M`t.vercelignore"); $records = $detected; $numstat = @("1`t1`t.vercelignore") }
      "rename" { $detected = @("R100`told.ps1`tnew.ps1") }
      "copy" { $detected = @("C100`told.ps1`tnew.ps1") }
      "binary" { $numstat = @("-`t-`tscripts/operate-development-d1-provider-failure-acceptance.ps1") }
      "record-mismatch" { $records = @("A`tscripts/operate-development-d1-provider-failure-acceptance.ps1") }
      "path-mismatch" { $numstat = @("1`t1`tscripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1") }
    }
    Assert-Rejected {
      Assert-OperatorDeltaRecordSet -Detected $detected -Records $records -Numstat $numstat
    } "operator delta tampering '$deltaTamper'"
  }

  $aggregateRelative = Join-Path $representativeRoot "provider-failure.json"
  $zeroRelative = Join-Path $representativeRoot "zero-drift.json"
  $bindingDocument = [ordered]@{
    schemaVersion = 1
    kind = "development-d1-provider-failure-fixture-binding"
    status = "reviewed"
    scope = "provider-fixture-only"
    representativeAcceptanceAuthorized = $false
    release = [ordered]@{
      sourceSha = $SourceSha; operatorSourceSha = "f" * 40; terraformStateSerial = 208
      runtimePlanPath = "runtime-zero.tfplan"; runtimePlanSha256 = "e" * 64
    }
    run = [ordered]@{
      runId = $RunId; generatedSyntheticOnly = $true; oneRunOnly = $true
      cleanupRequired = $true; recoveryRequired = $true
    }
    fixture = [ordered]@{
      kind = $fixtureKind; sourceId = $fixtureSourceId; adapterVersion = $fixtureAdapterVersion
      operatorPath = "scripts/operate-development-d1-provider-failure-acceptance.ps1"
      aggregateResultPath = $aggregateRelative; zeroDriftResultPath = $zeroRelative
    }
  }
  $ProviderFixtureBindingPath = Join-Path $operatorRoot "fixture-binding.json"
  [IO.File]::WriteAllText($ProviderFixtureBindingPath, ($bindingDocument | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedProviderFixtureBindingSha256 = Get-FileSha256 $ProviderFixtureBindingPath
  $binding = Read-ProviderFixtureBinding
  $actualBindingSha256 = $ReviewedProviderFixtureBindingSha256
  $ReviewedProviderFixtureBindingSha256 = "0" * 64
  Assert-Rejected { Read-ProviderFixtureBinding } "provider-fixture binding checksum mismatch"
  $ReviewedProviderFixtureBindingSha256 = $actualBindingSha256
  if ([long]$binding.StateSerial -ne 208 -or [string]$binding.OperatorSourceSha -cne ("f" * 40) -or
    [string]$binding.AggregatePath -cne (Join-Path $representativeRoot "provider-failure.json") -or
    [string]$binding.ZeroDriftPath -cne (Join-Path $representativeRoot "zero-drift.json")) {
    throw "The exact provider-fixture binding was not accepted."
  }
  foreach ($tamper in @(
      "extra", "schema", "schema-type", "kind", "status", "scope", "authority", "source", "operator-source", "state", "state-type", "runtime-path-type", "run",
      "fixture", "adapter", "operator", "flags", "aggregate-path", "aggregate-path-type", "zero-path", "same-path", "case-same-path"
    )) {
    $candidate = $bindingDocument | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($tamper) {
      "extra" { $candidate | Add-Member NoteProperty thresholds ([pscustomobject]@{}) }
      "schema" { $candidate.schemaVersion = 2 }
      "schema-type" { $candidate.schemaVersion = "1" }
      "kind" { $candidate.kind = "d1-representative-acceptance" }
      "status" { $candidate.status = "draft" }
      "scope" { $candidate.scope = "representative-acceptance" }
      "authority" { $candidate.representativeAcceptanceAuthorized = $true }
      "source" { $candidate.release.sourceSha = "0" * 40 }
      "operator-source" { $candidate.release.operatorSourceSha = "NOT-A-SHA" }
      "state" { $candidate.release.terraformStateSerial = 0 }
      "state-type" { $candidate.release.terraformStateSerial = 208.5 }
      "runtime-path-type" { $candidate.release.runtimePlanPath = 123 }
      "run" { $candidate.run.runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      "fixture" { $candidate.fixture.kind = "other" }
      "adapter" { $candidate.fixture.adapterVersion = "other" }
      "operator" { $candidate.fixture.operatorPath = "other.ps1" }
      "flags" { $candidate.run.oneRunOnly = $false }
      "aggregate-path" { $candidate.fixture.aggregateResultPath = Join-Path $operatorRoot "provider-failure.json" }
      "aggregate-path-type" { $candidate.fixture.aggregateResultPath = 123 }
      "zero-path" { $candidate.fixture.zeroDriftResultPath = Join-Path $operatorRoot "zero-drift.json" }
      "same-path" { $candidate.fixture.zeroDriftResultPath = $candidate.fixture.aggregateResultPath }
      "case-same-path" { $candidate.fixture.zeroDriftResultPath = ([string]$candidate.fixture.aggregateResultPath).ToUpperInvariant() }
    }
    [IO.File]::WriteAllText($ProviderFixtureBindingPath, ($candidate | ConvertTo-Json -Depth 20), $utf8WithoutBom)
    $ReviewedProviderFixtureBindingSha256 = Get-FileSha256 $ProviderFixtureBindingPath
    Assert-Rejected { Read-ProviderFixtureBinding } "provider-fixture binding tampering '$tamper'"
  }
  [IO.File]::WriteAllText($ProviderFixtureBindingPath, ($bindingDocument | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedProviderFixtureBindingSha256 = Get-FileSha256 $ProviderFixtureBindingPath
  $binding = Read-ProviderFixtureBinding

  $durableArn = "arn:aws:lambda:us-east-2:111122223333:function:$durableFunctionName`:17"
  $activityArn = "arn:aws:lambda:us-east-2:111122223333:function:$activityFunctionName`:23"
  function New-StateResource([string]$Type, [string]$Name, [object]$Attributes) {
    return [pscustomobject]@{ type = $Type; name = $Name; instances = @([pscustomobject]@{ attributes = $Attributes }) }
  }
  function New-StateResourceInstances([string]$Type, [string]$Name, [object[]]$Attributes) {
    return [pscustomobject]@{
      type = $Type; name = $Name
      instances = @($Attributes | ForEach-Object { [pscustomobject]@{ attributes = $_ } })
    }
  }
  $privateSubnetIds = @("subnet-private-a", "subnet-private-b")
  $providerSubnetIds = @("subnet-provider-a", "subnet-provider-b")
  $privateRouteIds = @("rtb-private-a", "rtb-private-b")
  $providerRouteIds = @("rtb-provider-a", "rtb-provider-b")
  $template = [ordered]@{ Resources = [ordered]@{
      DurableFunction = [ordered]@{ Properties = [ordered]@{
          Environment = [ordered]@{ Variables = [ordered]@{
              RELEASE_SHA = $ExpectedDurableArtifactSha256; INGESTION_ACTIVITY_FUNCTION_ARN = $activityArn
            } }
        } }
      DurableVersion = [ordered]@{ Properties = [ordered]@{ CodeSha256 = $ExpectedDurableCodeSha256 } }
    } }
  $runtimeVariables = [pscustomobject]@{
    RELEASE_SHA = $ExpectedActivityArtifactSha256; INGESTION_SYNTHETIC_SOURCE_ENABLED = "false"
    INGESTION_PROVIDER_ACTIVATION_ALLOWED = "false"; INGESTION_PROVIDER_SOURCES = "[]"
  }
  $runtimeResource = [pscustomobject]@{
    type = "aws_lambda_function"; name = "ingestion_runtime"; instances = @(
      [pscustomobject]@{ index_key = "coordinator"; attributes = [pscustomobject]@{
          function_name = "ai-job-apply-development-ingestion-coordinator"; version = "31"; source_code_hash = $ExpectedActivityCodeSha256
          environment = @([pscustomobject]@{ variables = $runtimeVariables })
        } },
      [pscustomobject]@{ index_key = "starter"; attributes = [pscustomobject]@{
          function_name = "ai-job-apply-development-ingestion-starter"; version = "32"; source_code_hash = $ExpectedActivityCodeSha256
          environment = @([pscustomobject]@{ variables = $runtimeVariables })
        } },
      [pscustomobject]@{ index_key = "terminal"; attributes = [pscustomobject]@{
          function_name = "ai-job-apply-development-ingestion-terminal"; version = "33"; source_code_hash = $ExpectedActivityCodeSha256
          environment = @([pscustomobject]@{ variables = $runtimeVariables })
        } }
    )
  }
  $resources = @(
    (New-StateResource "aws_cloudformation_stack" "ingestion_durable" ([pscustomobject]@{
          outputs = [pscustomobject]@{ DurableVersionArn = $durableArn }; template_body = ($template | ConvertTo-Json -Compress -Depth 20)
        })),
    (New-StateResource "aws_lambda_function" "ingestion_activity" ([pscustomobject]@{
          qualified_arn = $activityArn; version = "23"; source_code_hash = $ExpectedActivityCodeSha256
          vpc_config = @([pscustomobject]@{ subnet_ids = $privateSubnetIds })
          environment = @([pscustomobject]@{ variables = [pscustomobject]@{
                RELEASE_SHA = $ExpectedActivityArtifactSha256; INGESTION_SYNTHETIC_SOURCE_ENABLED = "false"
                INGESTION_PROVIDER_ACTIVATION_ALLOWED = "false"; INGESTION_PROVIDER_SOURCES = "[]"
              } })
        })),
    $runtimeResource,
    (New-StateResource "aws_lambda_event_source_mapping" "ingestion_dispatch" ([pscustomobject]@{ enabled = $false; uuid = "mapping-fixture" })),
    (New-StateResource "aws_cloudwatch_event_rule" "ingestion_schedule" ([pscustomobject]@{ state = "DISABLED" })),
    (New-StateResource "aws_cloudwatch_event_rule" "ingestion_terminal" ([pscustomobject]@{ state = "DISABLED" })),
    (New-StateResource "aws_sqs_queue" "ingestion_dispatch" ([pscustomobject]@{ name = $dispatchQueueName })),
    (New-StateResource "aws_sqs_queue" "ingestion_dead_letter" ([pscustomobject]@{ name = $deadLetterQueueName })),
    (New-StateResource "aws_ecs_cluster" "this" ([pscustomobject]@{ name = $ecsClusterName })),
    (New-StateResourceInstances "aws_subnet" "private" @($privateSubnetIds | ForEach-Object { [pscustomobject]@{ id = $_ } })),
    (New-StateResourceInstances "aws_subnet" "ingestion_provider" @($providerSubnetIds | ForEach-Object { [pscustomobject]@{ id = $_ } })),
    (New-StateResourceInstances "aws_route_table" "private" @($privateRouteIds | ForEach-Object {
          [pscustomobject]@{ id = $_; route = @([pscustomobject]@{ nat_gateway_id = "nat-candidate-rights" }) }
        })),
    (New-StateResourceInstances "aws_route_table" "ingestion_provider" @($providerRouteIds | ForEach-Object { [pscustomobject]@{ id = $_ } })),
    (New-StateResourceInstances "aws_route_table_association" "private" @(
        [pscustomobject]@{ subnet_id = $privateSubnetIds[0]; route_table_id = $privateRouteIds[0] },
        [pscustomobject]@{ subnet_id = $privateSubnetIds[1]; route_table_id = $privateRouteIds[1] }
      )),
    (New-StateResourceInstances "aws_route_table_association" "ingestion_provider" @(
        [pscustomobject]@{ subnet_id = $providerSubnetIds[0]; route_table_id = $providerRouteIds[0] },
        [pscustomobject]@{ subnet_id = $providerSubnetIds[1]; route_table_id = $providerRouteIds[1] }
      )),
    (New-StateResource "aws_nat_gateway" "this" ([pscustomobject]@{ id = "nat-candidate-rights" }))
  )
  $snapshot = [pscustomobject]@{
    Serial = 208; VersionId = "state-version"; Lineage = "11111111-2222-3333-4444-555555555555"
    State = [pscustomobject]@{ resources = $resources }
  }
  $boundary = Assert-StateBoundary $snapshot $binding
  if ([string]$boundary.DurableArn -cne $durableArn -or [string]$boundary.ActivityArn -cne $activityArn) {
    throw "The exact immutable state boundary was not accepted."
  }
  foreach ($stateTamper in @("serial", "activity-version", "provider", "synthetic", "runtime-provider", "runtime-set", "durable-code", "mapping", "schedule", "provider-nat", "provider-subnet", "provider-route", "unknown-nat", "durable-activity")) {
    $candidate = $snapshot | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    switch ($stateTamper) {
      "serial" { $candidate.Serial = 209 }
      "activity-version" { @($candidate.State.resources | Where-Object name -ceq "ingestion_activity")[0].instances[0].attributes.version = "24" }
      "provider" { @($candidate.State.resources | Where-Object name -ceq "ingestion_activity")[0].instances[0].attributes.environment[0].variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED = "true" }
      "synthetic" { @($candidate.State.resources | Where-Object name -ceq "ingestion_activity")[0].instances[0].attributes.environment[0].variables.INGESTION_SYNTHETIC_SOURCE_ENABLED = "true" }
      "runtime-provider" { @($candidate.State.resources | Where-Object name -ceq "ingestion_runtime")[0].instances[0].attributes.environment[0].variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED = "true" }
      "runtime-set" { @($candidate.State.resources | Where-Object name -ceq "ingestion_runtime")[0].instances[0].index_key = "other" }
      "durable-code" {
        $stack = @($candidate.State.resources | Where-Object name -ceq "ingestion_durable")[0].instances[0].attributes
        $body = $stack.template_body | ConvertFrom-Json
        $body.Resources.DurableVersion.Properties.CodeSha256 = ("Z" * 43) + "="
        $stack.template_body = $body | ConvertTo-Json -Compress -Depth 20
      }
      "mapping" { @($candidate.State.resources | Where-Object name -ceq "ingestion_dispatch" | Where-Object type -ceq "aws_lambda_event_source_mapping")[0].instances[0].attributes.enabled = $true }
      "schedule" { @($candidate.State.resources | Where-Object name -ceq "ingestion_schedule")[0].instances[0].attributes.state = "ENABLED" }
      "provider-nat" { $candidate.State.resources += New-StateResource "aws_nat_gateway" "ingestion_provider" ([pscustomobject]@{ id = "nat-fixture" }) }
      "provider-subnet" { @($candidate.State.resources | Where-Object name -ceq "ingestion_activity")[0].instances[0].attributes.vpc_config[0].subnet_ids = $providerSubnetIds }
      "provider-route" { @($candidate.State.resources | Where-Object name -ceq "private" | Where-Object type -ceq "aws_route_table_association")[0].instances[0].attributes.route_table_id = $providerRouteIds[0] }
      "unknown-nat" { @($candidate.State.resources | Where-Object name -ceq "private" | Where-Object type -ceq "aws_route_table")[0].instances[0].attributes.route[0].nat_gateway_id = "nat-unowned" }
      "durable-activity" {
        $stack = @($candidate.State.resources | Where-Object name -ceq "ingestion_durable")[0].instances[0].attributes
        $body = $stack.template_body | ConvertFrom-Json
        $body.Resources.DurableFunction.Properties.Environment.Variables.INGESTION_ACTIVITY_FUNCTION_ARN = "$activityArn-wrong"
        $stack.template_body = $body | ConvertTo-Json -Compress -Depth 20
      }
    }
    Assert-Rejected { Assert-StateBoundary $candidate $binding } "state tampering '$stateTamper'"
  }

  $script:liveMutation = ""
  function Invoke-AwsJson {
    param([string[]]$Arguments, [string]$Operation)
    $call = $Arguments[0..1] -join " "
    switch ($call) {
      "lambda get-function-configuration" {
        $arn = [string]$Arguments[3]
        if ($arn -ceq $durableArn) {
          return [pscustomobject]@{
            FunctionArn = $boundary.DurableArn; Version = "17"; State = "Active"; LastUpdateStatus = "Successful"
            CodeSha256 = $ExpectedDurableCodeSha256; Environment = [pscustomobject]@{ Variables = [pscustomobject]@{
                RELEASE_SHA = $ExpectedDurableArtifactSha256; INGESTION_ACTIVITY_FUNCTION_ARN = $activityArn
              } }
          }
        }
        if ($arn -ceq $activityArn) {
          return [pscustomobject]@{
            FunctionArn = $boundary.ActivityArn; Version = "23"; State = "Active"; LastUpdateStatus = "Successful"
            CodeSha256 = $ExpectedActivityCodeSha256
            VpcConfig = [pscustomobject]@{ SubnetIds = if ($script:liveMutation -ceq "provider-subnet") { $providerSubnetIds } else { $privateSubnetIds } }
            Environment = [pscustomobject]@{ Variables = [pscustomobject]@{
                RELEASE_SHA = $ExpectedActivityArtifactSha256; INGESTION_SYNTHETIC_SOURCE_ENABLED = "false"
                INGESTION_PROVIDER_ACTIVATION_ALLOWED = if ($script:liveMutation -ceq "provider") { "true" } else { "false" }
                INGESTION_PROVIDER_SOURCES = "[]"
              } }
          }
        }
        $runtime = @($boundary.RuntimeFunctions | Where-Object { "$($_.Name):$($_.Version)" -ceq $arn })
        if ($runtime.Count -ne 1) { throw "Unexpected mocked function configuration '$arn'." }
        return [pscustomobject]@{
          FunctionName = [string]$runtime[0].Name
          FunctionArn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:$($runtime[0].Name)"; Version = [string]$runtime[0].Version
          State = "Active"; LastUpdateStatus = "Successful"
          CodeSha256 = $ExpectedActivityCodeSha256; Environment = [pscustomobject]@{ Variables = [pscustomobject]@{
              RELEASE_SHA = $ExpectedActivityArtifactSha256; INGESTION_SYNTHETIC_SOURCE_ENABLED = "false"
              INGESTION_PROVIDER_ACTIVATION_ALLOWED = if ($script:liveMutation -ceq "runtime-provider" -and $runtime[0].Name.EndsWith("coordinator")) { "true" } else { "false" }
              INGESTION_PROVIDER_SOURCES = "[]"
            } }
        }
      }
      "events describe-rule" { return [pscustomobject]@{ State = if ($script:liveMutation -ceq "rule") { "ENABLED" } else { "DISABLED" } } }
      "lambda get-event-source-mapping" { return [pscustomobject]@{ State = if ($script:liveMutation -ceq "mapping") { "Enabled" } else { "Disabled" } } }
      "lambda list-event-source-mappings" {
        $functionName = [string]$Arguments[3]
        $mappings = @()
        if ($functionName.EndsWith("ingestion-starter")) {
          $mappings += [pscustomobject]@{ UUID = "mapping-fixture"; State = "Disabled" }
        }
        if ($script:liveMutation -ceq "extra-mapping" -and $functionName -ceq $activityFunctionName) {
          $mappings += [pscustomobject]@{ UUID = "unexpected-mapping"; State = "Disabled" }
        }
        return [pscustomobject]@{ EventSourceMappings = $mappings }
      }
      "lambda list-durable-executions-by-function" {
        return [pscustomobject]@{ DurableExecutions = @(
            [pscustomobject]@{ DurableExecutionName = $executionName; FunctionArn = $boundary.DurableArn; Status = "SUCCEEDED" },
            [pscustomobject]@{ DurableExecutionName = "$executionName-suffix"; FunctionArn = $boundary.DurableArn; Status = "RUNNING" },
            [pscustomobject]@{ DurableExecutionName = $executionName; FunctionArn = "$($boundary.DurableFunctionArn):18"; Status = "RUNNING" }
          ) }
      }
      "ec2 describe-route-tables" {
        return [pscustomobject]@{ RouteTables = @(
            [pscustomobject]@{
              RouteTableId = if ($script:liveMutation -ceq "provider-route") { $providerRouteIds[0] } else { $privateRouteIds[0] }
              Associations = @([pscustomobject]@{ SubnetId = $privateSubnetIds[0] })
              Routes = @([pscustomobject]@{ GatewayId = "local" }, [pscustomobject]@{ NatGatewayId = if ($script:liveMutation -ceq "unknown-nat") { "nat-unowned" } else { "nat-candidate-rights" } })
            },
            [pscustomobject]@{ RouteTableId = $privateRouteIds[1]; Associations = @([pscustomobject]@{ SubnetId = $privateSubnetIds[1] }); Routes = @([pscustomobject]@{ GatewayId = "local" }, [pscustomobject]@{ NatGatewayId = "nat-candidate-rights" }) }
          ) }
      }
      "ecs list-tasks" { return [pscustomobject]@{ taskArns = if ($script:liveMutation -ceq "task") { @("private-arn") } else { @() } } }
      "ecs list-services" { return [pscustomobject]@{ serviceArns = @() } }
      default { throw "Unexpected mocked AWS call '$call' for $Operation." }
    }
  }
  function Get-QueueAttributes([string]$QueueName) {
    if ($script:liveMutation -ceq "queue" -and $QueueName -ceq $dispatchQueueName) {
      return [pscustomobject]@{ Visible = 1; NotVisible = 0; Delayed = 0 }
    }
    return [pscustomobject]@{ Visible = 0; NotVisible = 0; Delayed = 0 }
  }
  $exactMatches = @(Get-DurableExecutionMatches $executionName)
  if ($exactMatches.Count -ne 1 -or [string]$exactMatches[0].DurableExecutionName -cne $executionName -or
    [string]$exactMatches[0].FunctionArn -cne $boundary.DurableArn) {
    throw "The contains-filter durable lookup did not reduce to the exact name and numeric function version."
  }
  function Get-DurableExecutionMatches([string]$ExecutionName) {
    if ($script:liveMutation -ceq "execution") { return @([pscustomobject]@{ Status = "RUNNING" }) }
    return @()
  }
  $null = Assert-LiveBoundary $boundary $executionName -RequireNoExecution
  foreach ($liveTamper in @("provider", "runtime-provider", "rule", "mapping", "extra-mapping", "provider-subnet", "provider-route", "unknown-nat", "task", "queue", "execution")) {
    $script:liveMutation = $liveTamper
    Assert-Rejected { Assert-LiveBoundary $boundary $executionName -RequireNoExecution } "live boundary tampering '$liveTamper'"
  }
  $script:liveMutation = ""

  $payload = New-WorkflowPayload
  $null = Assert-ExactProperties $payload @(
    "schemaVersion", "workflowDefinitionVersion", "fixtureKind", "runId", "reviewedConfigSha256", "releaseSourceSha"
  ) "Workflow payload"
  $null = Assert-ZeroChangePlan ([pscustomobject]@{
      resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
    }) "No-op fixture"
  Assert-Rejected {
    Assert-ZeroChangePlan ([pscustomobject]@{
        resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
      }) "Drift fixture"
  } "nonzero fresh plan"
  $freshPlanPath = Join-Path $operatorRoot "pre-run.tfplan"
  [IO.File]::WriteAllText($freshPlanPath, "bounded-test-plan", $utf8WithoutBom)
  $freshPlan = [pscustomobject]@{ Path = $freshPlanPath; Sha256 = Get-FileSha256 $freshPlanPath }
  $plan = New-ExecutionPlan $binding $boundary $executionName $freshPlan
  $ExecutionPlanPath = Join-Path $operatorRoot "plan.json"
  [IO.File]::WriteAllText($ExecutionPlanPath, ($plan | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath
  $null = Read-ExecutionPlan $binding $boundary
  foreach ($planTamper in @("extra", "run", "binding", "source", "operator-source", "durable", "activity", "state", "fresh", "mutation")) {
    $candidate = $plan | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($planTamper) {
      "extra" { $candidate | Add-Member NoteProperty payload "caller-controlled" }
      "run" { $candidate.runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      "binding" { $candidate.providerFixtureBindingSha256 = "0" * 64 }
      "source" { $candidate.releaseSourceSha = "0" * 40 }
      "operator-source" { $candidate.operatorSourceSha = "0" * 40 }
      "durable" { $candidate.durableVersion = 18 }
      "activity" { $candidate.activityVersion = 24 }
      "state" { $candidate.terraformStateSerial = 209 }
      "fresh" { $candidate.freshZeroDriftPlanSha256 = "0" * 64 }
      "mutation" { $candidate.mutation = "arbitrary" }
    }
    [IO.File]::WriteAllText($ExecutionPlanPath, ($candidate | ConvertTo-Json -Depth 20), $utf8WithoutBom)
    $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath
    Assert-Rejected { Read-ExecutionPlan $binding $boundary } "plan tampering '$planTamper'"
  }
  [IO.File]::WriteAllText($ExecutionPlanPath, ($plan | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath

  $script:durableResultMutation = ""
  function Invoke-AwsJson {
    param([string[]]$Arguments, [string]$Operation)
    if (($Arguments[0..1] -join " ") -cne "lambda get-durable-execution") { throw "Unexpected durable mock call." }
    $result = [ordered]@{
      schemaVersion = 1; profile = "d1_deployed_provider_failure_durable_v1"; fixtureKind = $fixtureKind
      sourceId = $fixtureSourceId; adapterVersion = $fixtureAdapterVersion; runId = $RunId
      reviewedConfigSha256 = $ReviewedProviderFixtureBindingSha256; releaseSourceSha = $SourceSha
      providerFaultsInjected = 1; providerFailuresObserved = 1; recoveryAttempts = 1; recoveriesSucceeded = 1
      providerRequests = 0; observationCount = 0; createdCount = 0; updatedCount = 0
    }
    switch ($script:durableResultMutation) {
      "provider" { $result.providerRequests = 1 }
      "write" { $result.createdCount = 1 }
      "binding" { $result.reviewedConfigSha256 = "0" * 64 }
      "extra" { $result.raw = "forbidden" }
    }
    return [pscustomobject]@{
      DurableExecutionArn = "$durableArn/durable-execution/$executionName/opaque01"
      DurableExecutionName = $executionName; FunctionArn = $boundary.DurableArn; Version = "17"; Status = "SUCCEEDED"
      InputPayload = (New-WorkflowPayload | ConvertTo-Json -Compress -Depth 10)
      OutputPayload = ($result | ConvertTo-Json -Compress -Depth 10)
    }
  }
  $executionArn = "$durableArn/durable-execution/$executionName/opaque01"
  $null = Wait-ExactDurableResult $executionArn $boundary
  foreach ($resultTamper in @("provider", "write", "binding", "extra")) {
    $script:durableResultMutation = $resultTamper
    Assert-Rejected { Wait-ExactDurableResult $executionArn $boundary } "durable result tampering '$resultTamper'"
  }
  $script:durableResultMutation = ""
  foreach ($invalidPayload in @("%%%", "x" * 8193)) {
    Assert-Rejected { ConvertFrom-BoundedJsonString $invalidPayload "Invalid durable JSON string" 8192 } "invalid durable JSON string"
  }
  Assert-Rejected {
    ConvertFrom-BoundedJsonString "$([char]0xfeff){}" "BOM durable JSON string" 8192
  } "BOM-prefixed durable JSON string"

  $startedAt = [DateTimeOffset]::UtcNow.AddSeconds(-2).ToString("o")
  $receipt = New-Receipt $executionName $ReviewedExecutionPlanSha256 $startedAt $binding
  $null = Assert-Receipt $receipt $binding $boundary
  $receipt.phase = "running"
  $receipt.durableExecutionArn = $executionArn
  function Wait-ExactDurableResult { param([string]$DurableExecutionArn, [object]$Boundary) return [pscustomobject]@{} }
  function Assert-LiveBoundary {
    param([object]$StateBoundary, [string]$ExecutionName, [switch]$RequireNoExecution)
    return [pscustomobject]@{ ExecutionMatches = @([pscustomobject]@{ DurableExecutionArn = $executionArn; Status = "SUCCEEDED" }) }
  }
  function Get-DurableExecutionMatches([string]$ExecutionName) { return @([pscustomobject]@{ DurableExecutionArn = $executionArn; Status = "SUCCEEDED" }) }
  function Get-CloudWatchMaximum { param([string]$QueueName, [string]$MetricName, [DateTimeOffset]$Started, [DateTimeOffset]$Ended) return [decimal]0 }
  function Get-AggregateLogCount { param([string]$FilterExpression, [DateTimeOffset]$Started, [DateTimeOffset]$Ended) return 0 }
  function Read-StateSnapshot { return $snapshot }
  function Assert-StateBoundary { param([object]$Snapshot, [object]$Binding) return $boundary }
  $postPlanPath = Join-Path $operatorRoot "post-run.tfplan"
  [IO.File]::WriteAllText($postPlanPath, "bounded-post-run-plan", $utf8WithoutBom)
  function Invoke-FreshZeroDriftPlan {
    param([object]$ReviewedPlan, [string]$Phase, [switch]$AllowExisting)
    if ($Phase -cne "post-run" -or -not $AllowExisting) { throw "Unexpected fresh-plan mock invocation." }
    return [pscustomobject]@{ Path = $postPlanPath; Sha256 = Get-FileSha256 $postPlanPath }
  }
  $binding | Add-Member NoteProperty ReviewedPlan ([pscustomobject]@{
      variables = [pscustomobject]@{}; resource_changes = @()
    }) -Force
  $completed = Complete-Evidence $receipt $binding $boundary
  $firstAggregateSha = Get-FileSha256 $completed.aggregatePath
  $firstZeroSha = Get-FileSha256 $completed.zeroDriftPath
  $completed = Complete-Evidence $completed $binding $boundary
  if ((Get-FileSha256 $completed.aggregatePath) -cne $firstAggregateSha -or
    (Get-FileSha256 $completed.zeroDriftPath) -cne $firstZeroSha) {
    throw "Crash-resume replaced already validated evidence instead of preserving it."
  }
  $null = Assert-Receipt $completed $binding $boundary
  $aggregate = Get-Content -LiteralPath $completed.aggregatePath -Raw | ConvertFrom-Json
  $null = Assert-ExactProperties $aggregate @(
    "profile", "fixtureKind", "sourceId", "adapterVersion", "startedAt", "endedAt", "durationMs",
    "providerFaultsInjected", "providerFailuresObserved", "recoveriesSucceeded", "cleanupAttempted",
    "cleanupSucceeded", "postCleanupArtifacts", "retainedAuditRows", "retainedDurableExecutions",
    "eventQueueAgeMaxSeconds", "eventQueueVisibleMax", "eventDeadLetterMax",
    "durableDeadLetterMax", "logErrorMatches", "forbiddenLogMatches"
  ) "Aggregate result"
  if (-not $aggregate.cleanupAttempted -or -not $aggregate.cleanupSucceeded -or
    [int]$aggregate.postCleanupArtifacts -ne 0 -or [int]$aggregate.retainedAuditRows -ne 0 -or
    [int]$aggregate.retainedDurableExecutions -ne 1 -or
    @($aggregate.PSObject.Properties.Name | Where-Object { $_ -match "arn|payload|logBody|runId|configSha|releaseSha" }).Count -ne 0) {
    throw "The aggregate is not cleanup-complete, audit-empty, one-history, non-inferential, and private."
  }
  $zero = Get-Content -LiteralPath $completed.zeroDriftPath -Raw | ConvertFrom-Json
  if ([int]$zero.meaningfulChanges -ne 0 -or $zero.drift -isnot [bool] -or [bool]$zero.drift) {
    throw "The post-run zero-drift aggregate is invalid."
  }
  foreach ($receiptTamper in @("binding", "operator-source", "aggregate-path", "aggregate-hash", "ended", "state", "post-plan")) {
    $candidate = $completed | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($receiptTamper) {
      "binding" { $candidate.providerFixtureBindingSha256 = "0" * 64 }
      "operator-source" { $candidate.operatorSourceSha = "0" * 40 }
      "aggregate-path" { $candidate.aggregatePath = $candidate.zeroDriftPath }
      "aggregate-hash" { $candidate.aggregateSha256 = "0" * 64 }
      "ended" { $candidate.endedAt = [DateTimeOffset]::Parse($candidate.startedAt).AddSeconds(-1).ToString("o") }
      "state" { $candidate.postRunStateVersionId = "other-state-version" }
      "post-plan" { $candidate.postRunZeroDriftPlanSha256 = "0" * 64 }
    }
    Assert-Rejected { Assert-Receipt $candidate $binding $boundary } "verified receipt tampering '$receiptTamper'"
  }
  $aggregateJson = Get-Content -LiteralPath $completed.aggregatePath -Raw
  $badAggregate = $aggregateJson | ConvertFrom-Json
  $badAggregate | Add-Member NoteProperty durableExecutionArn "private-arn"
  [IO.File]::WriteAllText($completed.aggregatePath, ($badAggregate | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $candidate = $completed | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $candidate.aggregateSha256 = Get-FileSha256 $completed.aggregatePath
  Assert-Rejected { Assert-Receipt $candidate $binding $boundary } "private or extra verified aggregate field"
  [IO.File]::WriteAllText($completed.aggregatePath, $aggregateJson, $utf8WithoutBom)

  $payloadArtifact = Join-Path $operatorRoot "payload-$RunId.json"
  [IO.File]::WriteAllText($payloadArtifact, "{}", $utf8WithoutBom)
  Assert-Rejected { Assert-InvocationArtifactsAbsent } "retained invocation payload"
  Remove-Item -LiteralPath $payloadArtifact -Force
  $null = Assert-InvocationArtifactsAbsent
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

Write-Output "Development D1 provider-failure acceptance operator tests passed."
