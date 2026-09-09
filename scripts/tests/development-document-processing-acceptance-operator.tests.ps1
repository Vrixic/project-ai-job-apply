$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-processing-acceptance.ps1"
$fixtureGenerator = Join-Path $repositoryRoot "scripts\lib\development-document-processing-fixtures.mjs"
$corpusGenerator = Join-Path $repositoryRoot "scripts\lib\development-document-parser-corpus.mjs"
$source = Get-Content -LiteralPath $operatorPath -Raw
function Get-TestFileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
$errors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The operator does not parse under this PowerShell host." }

$parameterNames = @($ast.ParamBlock.Parameters.Name.VariablePath.UserPath)
$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ExpectedAccountId", "StateBucket", "SourceSha",
  "FixtureSetSha256", "MigrationReceiptPath", "ReviewedMigrationReceiptSha256",
  "ExecutionPlanPath", "ReviewedExecutionPlanSha256", "ReceiptPath", "ReviewedReceiptSha256",
  "Help"
)
if (($parameterNames -join "|") -cne ($expectedParameters -join "|")) {
  throw "The public parameter surface is not the exact fixed acceptance boundary."
}

foreach ($required in @(
    'ValidateSet("Status", "PlanExecution", "Execute", "ServiceDetection", "ObjectRecovery", "RecoverCleanup", "Verify", "CorpusPlan", "CorpusExecute", "CorpusRecoverCleanup", "CorpusVerify")',
    '. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")',
    'documents/dist/src/run-document-processing-acceptance.js',
    'DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM',
    'DOCUMENT_PROCESSING_ACCEPTANCE_ACTION',
    'DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID',
    'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256',
    'DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST',
    'DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER',
    'd1-document-processing-acceptance:',
    'candidate-$compact@example.test',
    'TypeScript (reviewed synthetic)',
    'GuardDutyServiceDetectionProved = $false',
    'GuardDutyServiceDetectionProved = $true',
    'VersionedObjectRecoveryProved = $objectRecoveryRequested',
    'DeleteMarkerRecoveryProved = $objectRecoveryRequested',
    'RestoredVersionRescanProved = $objectRecoveryRequested',
    "'versioned-object-recovery-verified-and-cleaned'",
    "'guardduty', 'get-malware-protection-plan'",
    "'GuardDutyMalwareScanStatus'",
    "'NO_THREATS_FOUND'",
    'EventBridgeDeliveryProved = $false',
    'ApiGatewayAuthorizerEnforcementProved = $false',
    'TerraformZeroDriftClaim = $false',
    'development-document-operator-delta-v1',
    'development-document-recovery-operator-delta-v1',
    'sourceToOperatorDeltaSha256',
    'Get-OperatorDeltaEvidence',
    'Get-RecoveryOperatorDeltaEvidence',
    'A recovery operator dependency changed after the reviewed source.',
    '$corpusRecoveryOrVerify',
    "`$Action -in @('CorpusRecoverCleanup', 'CorpusVerify')",
    '[long]$plan.stateSerial -le [long]$identity.Serial',
    '$recoveryOnlyStateAdvance',
    '[long]$identity.Serial -gt [long]$planEvidence.Plan.stateSerial',
    '$null = Assert-RecoveryDescriptor',
    "ConvertFrom-Json -DateKind String",
    'The reviewed operator delta changes deployed application or infrastructure source.',
    '[Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Documents',
    'Assert-DocumentOperationalHealth -WaitForOk',
    '$scanAfter = $end.AddSeconds(30)',
    '$handler.AllowAutoRedirect = $false',
    '$script:acceptanceStage = "$Operation.runtime-revalidation"',
    '$script:acceptanceStage = "$Role.registration-response-validation"',
    '$script:acceptanceStage = "$Role.upload-binding-validation"',
    '$script:acceptanceStage = "$Role.upload-readback-request"',
    "'profile-review-initial-read-response-validation'",
    "'profile-review-initial-aggregate-validation'",
    "'profile-review-email-proposal-validation'",
    "'profile-review-typescript-proposal-validation'",
    "'profile-review-postgresql-proposal-validation'",
    "'profile-review-proposal-envelope-validation'",
    '"profile-review-$($update.Key)-response-validation"',
    '"profile-review-$($update.Key)-version-validation"',
    "'profile-review-final-read-response-validation'",
    "'profile-review-final-state-validation'",
    "'x-amz-checksum-algorithm' -cne 'SHA256'",
    "'x-amz-checksum-sha256' -cne `$expectedChecksum",
    '$expiryMilliseconds -lt 300000 -or $expiryMilliseconds -ge 301000',
    "Document acceptance failed during guarded stage '",
    "and did not prove exact cleanup. Retain and review the receipt before RecoverCleanup.",
    "'recovery-cleanup'",
    "delete-object",
    "--version-id",
    "Get-OptionalProperty -Object `$deleted -Name 'DeleteMarker'",
    "list-object-versions"
    'development-document-parser-corpus-v1'
    'd1_deployed_document_parser_adversarial_corpus_v1'
    'Corpus cleanup did not reduce the exact generated namespace to zero.'
    "[string]`$processorVariables.DOCUMENT_PARSER_VERSION -cne 'resume-parser-v1'"
    "[string]`$parserVariables.DOCUMENT_PARSER_VERSION -cne 'resume-parser-v1'"
  )) {
  if (-not $source.Contains($required)) { throw "The operator omits required boundary text: $required" }
}
if ($source -match "Uploaded object readback[^\r\n]+checksum-mode") {
  throw "Upload readback must not require candidate-document KMS decrypt permission."
}
$versionHistoryOffset = $source.IndexOf('$script:acceptanceStage = "$Role.upload-version-history"')
$versionReadbackOffset = $source.IndexOf('$script:acceptanceStage = "$Role.upload-readback-request"')
if ($versionHistoryOffset -lt 0 -or $versionReadbackOffset -le $versionHistoryOffset -or
    $source -notmatch 'head-object[^\r\n]+--version-id[^\r\n]+\$version') {
  throw "Upload readback must discover one exact version before version-bound HeadObject."
}
if ($source.Contains('[long]$planEvidence.Plan.stateSerial +')) {
  throw "Recovery safety must depend on exact runtime identity, not an arbitrary state-serial distance."
}
if ($source -match '\[long\]\$plan\.stateSerial -ne \$identity\.Serial') {
  throw "Corpus recovery and verification must not require the execution-plan state serial to remain current."
}
$corpusRecoveryOffset = $source.IndexOf("if (`$Action -eq 'CorpusRecoverCleanup')")
$corpusVerifyOutputOffset = $source.IndexOf("Outcome = 'verified'", $corpusRecoveryOffset)
$corpusClosingRegion = $source.Substring($corpusRecoveryOffset, $corpusVerifyOutputOffset - $corpusRecoveryOffset)
if ([regex]::Matches($corpusClosingRegion, [regex]::Escape('Assert-ReviewedRuntimeUnchanged')).Count -ne 2 -or
  [regex]::Matches($corpusClosingRegion, [regex]::Escape('Assert-ZeroTasks $runtime.ClusterArn')).Count -ne 2) {
  throw "Corpus cleanup recovery and verification must both revalidate the live runtime and idle task boundary before success."
}
if ($source -notmatch 'function Remove-DescriptorObjects \{[\s\S]{0,250}\[AllowEmptyCollection\(\)\]\[object\[\]\]\$Documents') {
  throw "Descriptor cleanup must accept a reviewed receipt containing zero fixture objects."
}
if ($source -notmatch 'function Register-And-UploadFixture \{[\s\S]{0,500}\[AllowEmptyCollection\(\)\]\[Collections\.ArrayList\]\$Documents') {
  throw "Fixture registration must accept the initially empty recovery document list."
}
foreach ($forbidden in @(
    'PlanTransition', 'ApplyTransition', 'terraform "-chdir=$terraformDirectory" apply',
    'document_scan_mapping_enabled = true', 'document_scan_event_rule_enabled = true',
    'events put-events', 'send-message', 'Invoke-Expression', 'New-ZeroDriftEvidence'
  )) {
  if ($source.Contains($forbidden)) { throw "The operator contains forbidden activation surface: $forbidden" }
}
if (
  -not $source.Contains("'^AGENTS\.md$'") -or
  -not $source.Contains("'^docs/'") -or
  -not $source.Contains("'^scripts/operate-development-document-processing-acceptance\.ps1$'") -or
  -not $source.Contains("'^scripts/operate-development-d1-provider-failure-acceptance\.ps1$'") -or
  -not $source.Contains("'^scripts/operate-development-postgresql-restore\.ps1$'") -or
  -not $source.Contains("'^scripts/tests/development-d1-provider-failure-acceptance-operator\.tests\.ps1$'") -or
  -not $source.Contains("'^scripts/tests/staging-postgresql-restore-verifier\.tests\.ps1$'") -or
  -not $source.Contains("'^scripts/tests/development-document-processing-acceptance-operator\.tests\.ps1$'") -or
  -not $source.Contains("'^infrastructure/runbooks/deployments/development-document-processing-acceptance\.md$'") -or
  -not $source.Contains("'^infrastructure/runbooks/observability/development-d1-provider-failure-acceptance\.md$'") -or
  -not $source.Contains("'^infrastructure/runbooks/restore/development-postgresql-point-in-time\.md$'")
) {
  throw "The application-to-operator delta allowlist is not exact."
}
$operatorDeltaDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-OperatorDeltaEvidence'
    }, $true))[0].Extent.Text
foreach ($forbidden in @('.vercelignore', 'operate-vercel-phase1-hosted-acceptance', 'vercel-nextjs-hosting')) {
  if ($operatorDeltaDefinition.Contains($forbidden)) {
    throw "The document-processing provenance boundary must not admit pre-AWS Vercel change: $forbidden"
  }
}
$guardedMutationFunctions = @(
  'Submit-Task', 'New-DurableClaim', 'Invoke-LambdaJson', 'Invoke-PresignedPost',
  'Set-ExactScanTag', 'Save-RecoveryDescriptor', 'Remove-ExactObjectVersion',
  'Remove-RecoveryObjectVersion', 'Invoke-VersionedObjectRecovery', 'Publish-CorpusSource',
  'Remove-CorpusObjects'
)
foreach ($name in $guardedMutationFunctions) {
  $definition = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
      }, $true))
  if ($definition.Count -ne 1 -or -not $definition[0].Extent.Text.Contains('Assert-ReviewedRuntimeUnchanged')) {
    throw "Cloud mutation function '$name' does not revalidate the full reviewed runtime identity."
  }
}

$corpusExecuteStart = $source.IndexOf("if (`$Action -eq 'CorpusExecute')")
$corpusExecuteEnd = $source.IndexOf('$receiptPath = Resolve-OperatorPath $ReceiptPath $operatorRoot -MustExist', $corpusExecuteStart)
if ($corpusExecuteStart -lt 0 -or $corpusExecuteEnd -le $corpusExecuteStart) {
  throw 'The corpus execution implementation could not be isolated.'
}
$corpusExecuteRegion = $source.Substring($corpusExecuteStart, $corpusExecuteEnd - $corpusExecuteStart)
$fullRuntimeRevalidations = [regex]::Matches($corpusExecuteRegion, [regex]::Escape('Assert-ReviewedRuntimeUnchanged')).Count
if ($fullRuntimeRevalidations -ne 3) {
  throw "Corpus execution must perform exactly three explicit full runtime validations at batch boundaries; found $fullRuntimeRevalidations."
}
$uploadOffset = $corpusExecuteRegion.IndexOf('Publish-CorpusSource')
$terminalOffset = $corpusExecuteRegion.IndexOf('Wait-CorpusGuardDutyTerminalTag')
$syntheticOffset = $corpusExecuteRegion.IndexOf('Set-ExactScanTag')
$sourceReadbackOffset = $corpusExecuteRegion.IndexOf('Read-CorpusSourceExact')
$finalTagOffset = $corpusExecuteRegion.IndexOf('Assert-CorpusSyntheticScanTag')
$processorOffset = $corpusExecuteRegion.IndexOf('Invoke-LambdaJson')
if ($uploadOffset -lt 0 -or $terminalOffset -le $uploadOffset -or $syntheticOffset -le $terminalOffset -or
  $sourceReadbackOffset -le $syntheticOffset -or $finalTagOffset -le $sourceReadbackOffset -or $processorOffset -le $finalTagOffset -or
  -not $corpusExecuteRegion.Contains('Assert-ActiveGuardDutyTaggingBoundary -Runtime $runtime') -or
  -not $corpusExecuteRegion.Contains('$managedScanDeadline = [DateTimeOffset]::UtcNow.AddMinutes(15)') -or
  -not $corpusExecuteRegion.Contains("if (`$entry.Count -ne 1) { throw 'The tagged corpus source case is missing or ambiguous.' }")) {
  throw 'Corpus execution does not preserve upload, managed-terminal, synthetic-tag, exact-source-readback, final-tag-readback, invocation ordering.'
}
foreach ($required in @(
    "failureStage = 'preflight'; failureCaseId = ''; failureOperation = 'none'",
    "-Stage 'upload' -CaseId",
    "-Operation 'source-upload'",
    "-Operation 'source-readback-request'",
    "-Operation 'source-readback-validation'",
    "-Stage 'guardduty-terminal' -CaseId",
    "-Stage 'synthetic-tag' -CaseId",
    "-Stage 'tag-revalidation' -CaseId",
    "-Stage 'processor-invocation'",
    "-Stage 'aggregate-validation'",
    "-Stage 'cleanup'",
    '$Receipt.failureStage = $Stage',
    '$Receipt.failureCaseId = $CaseId',
    '$Receipt.failureOperation = $Operation'
  )) {
  if (-not $source.Contains($required)) { throw "Corpus durable failure attribution omits: $required" }
}
foreach ($name in @('Publish-CorpusSource', 'Set-ExactScanTag', 'Remove-CorpusObjects')) {
  $definition = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
      }, $true))[0].Extent.Text
  if (-not $definition.Contains('[switch]$CorpusBatch') -or -not $definition.Contains('Assert-CorpusMutationBoundary -Runtime $Runtime')) {
    throw "Corpus cloud mutation function '$name' omits the exact live state/dark mutation guard."
  }
}
$mutationBoundaryDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-CorpusMutationBoundary'
    }, $true))[0].Extent.Text
foreach ($required in @(
    '$identity = Get-StateIdentity',
    '[string]$identity.Lineage -cne [string]$script:reviewedStateLineage',
    '[long]$identity.Serial -ne [long]$script:reviewedStateSerial',
    'Assert-TriggersDark -State $Runtime.State'
  )) {
  if (-not $mutationBoundaryDefinition.Contains($required)) {
    throw "The corpus per-mutation guard omits exact live state/dark enforcement: $required"
  }
}
if (-not $corpusExecuteRegion.Contains("schemaVersion = 3; kind = 'development-document-parser-corpus-receipt'")) {
  throw 'The durable corpus failure receipt schema was not versioned.'
}
if ($source.Contains("`$receipt.phase = 'recovered-cleaned'; `$receipt.failureStage = 'none'")) {
  throw 'Corpus cleanup recovery must preserve its durable failure attribution.'
}
$sourceReadbackDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-CorpusSourceExact'
    }, $true))[0].Extent.Text
foreach ($required in @(
    '$maximumAttempts = 5',
    '$retryDelaySeconds = 2',
    "'s3api', 'head-object'",
    "'--version-id', `$Document.sourceVersion",
    "-Operation 'source-readback-request'",
    "-Operation 'source-readback-validation'",
    '[string]$head.SSEKMSKeyId -ceq [string]$Runtime.PlatformKmsKeyArn',
    "[string]`$head.Metadata.'document-id' -ceq [string]`$Entry.documentId",
    '[string]$head.Metadata.sha256 -ceq [string]$Entry.sha256'
  )) {
  if (-not $sourceReadbackDefinition.Contains($required)) {
    throw "The bounded exact corpus source readback omits: $required"
  }
}
if ($sourceReadbackDefinition.Contains('put-object')) {
  throw 'The corpus source readback retry helper must never repeat PutObject.'
}
$publishCorpusDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Publish-CorpusSource'
    }, $true))[0].Extent.Text
if ([regex]::Matches($publishCorpusDefinition, "'s3api', 'put-object'").Count -ne 1 -or
  $publishCorpusDefinition.Contains('Read-CorpusSourceExact')) {
  throw 'Corpus publication must perform one upload and defer readback until the exact clean tags exist.'
}
$terminalDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Wait-CorpusGuardDutyTerminalTag'
    }, $true))[0].Extent.Text
foreach ($status in @('NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED')) {
  if (-not $terminalDefinition.Contains("'$status'")) { throw "Corpus GuardDuty terminal wait omits $status." }
}

$removeExactDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Remove-ExactObjectVersion'
    }, $true))[0].Extent.Text
if ($removeExactDefinition.Contains("'head-object'")) {
  throw "Exact cleanup must not require read access to a descriptor-bound quarantined version."
}

$waitTaskDefinition = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Wait-Task'
    }, $true))[0].Extent.Text
if ($waitTaskDefinition.Contains("'runId'") -or $waitTaskDefinition.Contains('$result.runId')) {
  throw "Acceptance task logs must not expose or require the generated run identifier."
}

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $functionAst = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($functionAst.Count -ne 1) { throw "Unable to import exact operator function '$Name'." }
  $body = $functionAst[0].Body.Extent.Text
  $definition = [scriptblock]::Create($body.Substring(1, $body.Length - 2))
  Set-Item -Path "Function:global:$Name" -Value $definition
}

. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
foreach ($name in @(
    "Assert-ExactPropertySet", "ConvertFrom-OperatorJson", "Get-TextSha256", "Get-OperatorDeltaEvidence",
    "Get-OptionalProperty", "Get-OptionalItems",
    "Test-CanonicalTimestamp", "New-TaskRequest", "Assert-TaskRequest", "ConvertTo-ReviewedTaskOverrides", "Add-RecoveryTaskEvidence",
    "Get-ExpectedAggregate", "New-RecoveryAttemptToken", "New-GatewayEvent", "Assert-RecoveryDescriptor",
    "Test-ExactObjectAlreadyRemoved", "Assert-DocumentOperationalHealth", "Assert-PrivacySafeLogs",
    "Get-OptionalProperty", "New-DirectProcessorEvent", "Get-LambdaVersionIdentity",
    "Get-LambdaAliasIdentity", "Assert-DocumentParserVersionBoundary", "Assert-PresignedUploadTarget", "Complete-SourceDescriptor",
    "Remove-ExactObjectVersion", "Remove-DescriptorObjects", "Assert-ReviewedRuntimeUnchanged", "Assert-CorpusMutationBoundary",
    "Assert-ActiveGuardDutyTaggingBoundary", "Get-ExactScanStatus", "Wait-GuardDutyServiceScan", "Wait-CorpusGuardDutyTerminalTag",
    "Assert-CorpusSyntheticScanTag", "Remove-RecoveryObjectVersion", "Invoke-VersionedObjectRecovery",
    "Assert-CorpusAggregate", "Write-JsonFile", "Write-CorpusReceipt", "Set-CorpusFailureCheckpoint", "Assert-CorpusFailureCheckpoint",
    "Read-CorpusSourceExact", "Remove-CorpusFiles"
  )) {
  Import-OperatorFunction -Name $name
}

$script:ExpectedAccountId = "123456789012"
$script:Region = "us-east-2"
$parserArn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-document-parser"
Assert-DocumentParserVersionBoundary -CurrentVersionArn "$parserArn`:3" -PinnedVersionArn "$parserArn`:2"
Assert-DocumentParserVersionBoundary -CurrentVersionArn "$parserArn`:3" -PinnedVersionArn "$parserArn`:3"
foreach ($invalidBoundary in @(
    @("$parserArn`:2", "$parserArn`:3"),
    @("$parserArn`:3", "arn:aws:lambda:us-east-2:123456789012:function:other-parser:2")
  )) {
  try {
    Assert-DocumentParserVersionBoundary `
      -CurrentVersionArn $invalidBoundary[0] `
      -PinnedVersionArn $invalidBoundary[1]
    throw "The invalid parser pin was accepted."
  }
  catch {
    if ($_.Exception.Message -ceq "The invalid parser pin was accepted.") { throw }
  }
}

$currentSource = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$sameSourceDelta = Get-OperatorDeltaEvidence -FromSha $currentSource -ToSha $currentSource
if (
  [string]$sameSourceDelta.FromSha -cne $currentSource -or
  [string]$sameSourceDelta.ToSha -cne $currentSource -or
  [string]$sameSourceDelta.Sha256 -notmatch '^[a-f0-9]{64}$'
) {
  throw "The reviewed operator delta evidence is not deterministic for an identical source."
}

$timestampJson = '{"createdAt":"2026-08-22T20:01:57.8939303+00:00"}'
$timestampObject = ConvertFrom-OperatorJson -Json $timestampJson -Description 'Timestamp fixture'
if ($timestampObject.createdAt -isnot [string] -or -not (Test-CanonicalTimestamp $timestampObject.createdAt)) {
  throw "Operator JSON parsing did not preserve a canonical timestamp string."
}

$script:containerName = "database-migration"
$script:acceptanceCommand = @("documents/dist/src/run-document-processing-acceptance.js")
$script:confirmation = "generated-synthetic-only"
$script:ExpectedAccountId = "123456789012"
$script:Region = "us-east-2"
$runtime = [pscustomobject]@{
  ClusterArn = "arn:aws:ecs:us-east-2:123456789012:cluster/ai-job-apply-development"
  TaskDefinitionArn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-database-migration:9"
  Subnets = @("subnet-aaaa", "subnet-bbbb")
  SecurityGroup = "sg-aaaa"
  Issuer = "https://identity.example.test/"
  Audience = "ai-job-apply-api"
  CandidateDocumentBucket = "ai-job-apply-development-candidate-docs-123456789012"
  ProtectionPlanArn = "arn:aws:guardduty:us-east-2:123456789012:malware-protection-plan/plan1"
  PlatformKmsKeyArn = "arn:aws:kms:us-east-2:123456789012:key/01234567-89ab-4def-8123-456789abcdef"
  State = [pscustomobject]@{}
}
$runId = "abcdef01-abcd-4abc-8abc-abcdef012345"
$digest = "a" * 64
$manifest = '[{"fixture":"clean-docx","fileName":"generated-abcdef01abcd4abc8abcabcdef012345-clean.docx","mediaType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","sizeBytes":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'

$request = New-TaskRequest -Runtime $runtime -Phase "clean" -RunId $runId -ManifestJson $manifest -ManifestDigest $digest -Issuer $runtime.Issuer
Assert-TaskRequest -Request $request -Runtime $runtime -Phase "clean" -RunId $runId -ManifestJson $manifest -ManifestDigest $digest -Issuer $runtime.Issuer
$environment = @($request.overrides.containerOverrides[0].environment)
if ($environment.Count -ne 6 -or @($environment.name | Sort-Object -Unique).Count -ne 6) {
  throw "The task request does not contain exactly six unique environment entries."
}
if ([string]$request.overrides.containerOverrides[0].command[0] -cne "documents/dist/src/run-document-processing-acceptance.js") {
  throw "The task request does not use the exact fixed entrypoint."
}
$cleanup = New-TaskRequest -Runtime $runtime -Phase "cleanup" -RunId $runId -ManifestJson $manifest -ManifestDigest $digest -Issuer $runtime.Issuer
$recovery = New-TaskRequest -Runtime $runtime -Phase "recovery-cleanup" -RunId $runId -ManifestJson $manifest -ManifestDigest $digest -Issuer $runtime.Issuer
if (
  [string]$cleanup.clientToken -ceq [string]$recovery.clientToken -or
  [string]$cleanup.overrides.containerOverrides[0].environment[1].value -cne "cleanup" -or
  [string]$recovery.overrides.containerOverrides[0].environment[1].value -cne "cleanup"
) {
  throw "Normal and recovery cleanup must bind distinct reviewed tokens to the same fixed action."
}
$ecsReadback = $request.overrides | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$ecsReadback | Add-Member -NotePropertyName inferenceAcceleratorOverrides -NotePropertyValue @()
$normalizedReadback = ConvertTo-ReviewedTaskOverrides -Overrides $ecsReadback
if (
  $normalizedReadback.PSObject.Properties.Name -contains 'inferenceAcceleratorOverrides' -or
  (ConvertTo-DeploymentCanonicalValue $normalizedReadback) -cne (ConvertTo-DeploymentCanonicalValue $request.overrides)
) {
  throw "The exact empty ECS readback default was not normalized."
}
$ecsReadback.inferenceAcceleratorOverrides = @([pscustomobject]@{ deviceName = 'device-1'; deviceType = 'eia1.medium' })
$rejectedAccelerator = $false
try { $null = ConvertTo-ReviewedTaskOverrides -Overrides $ecsReadback }
catch { $rejectedAccelerator = $true }
if (-not $rejectedAccelerator) { throw "An unreviewed ECS accelerator override was accepted." }
$recoveryEvidenceReceipt = [pscustomobject]@{
  taskArns = [pscustomobject]@{}
  resultSha256ByAction = [pscustomobject]@{}
}
$recoveryTaskArn = 'arn:aws:ecs:us-east-2:123456789012:task/ai-job-apply-development/0123456789abcdef0123456789abcdef'
Add-RecoveryTaskEvidence -Receipt $recoveryEvidenceReceipt -TaskArn $recoveryTaskArn -ResultSha256 ('b' * 64)
if (
  [string]$recoveryEvidenceReceipt.taskArns.'recovery-cleanup' -cne $recoveryTaskArn -or
  [string]$recoveryEvidenceReceipt.resultSha256ByAction.'recovery-cleanup' -cne ('b' * 64)
) {
  throw "Recovery cleanup evidence was not added to an empty parsed receipt object."
}
$rejectedDuplicateEvidence = $false
try { Add-RecoveryTaskEvidence -Receipt $recoveryEvidenceReceipt -TaskArn $recoveryTaskArn -ResultSha256 ('b' * 64) }
catch { $rejectedDuplicateEvidence = $true }
if (-not $rejectedDuplicateEvidence) { throw "Duplicate recovery cleanup evidence was accepted." }
$recoveryTokenOne = New-RecoveryAttemptToken -RunId $runId -InvocationId '0123456789abcdef' -Attempt 1
$recoveryTokenTwo = New-RecoveryAttemptToken -RunId $runId -InvocationId 'fedcba9876543210' -Attempt 1
$recoveryTokenRetry = New-RecoveryAttemptToken -RunId $runId -InvocationId '0123456789abcdef' -Attempt 2
if (
  $recoveryTokenOne -cne 'doc-rcln-abcdef01abcd4abc8abcabcdef012345-0123456789abcdef-a1' -or
  $recoveryTokenOne -ceq $recoveryTokenTwo -or
  $recoveryTokenOne -ceq $recoveryTokenRetry -or
  $recoveryTokenOne.Length -gt 64
) {
  throw "Recovery cleanup tokens do not isolate invocation and attempt idempotency."
}

$tampered = $request | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$tampered.overrides.containerOverrides[0].environment[5].value = "https://other.example.test/"
$rejected = $false
try {
  Assert-TaskRequest -Request $tampered -Runtime $runtime -Phase "clean" -RunId $runId -ManifestJson $manifest -ManifestDigest $digest -Issuer $runtime.Issuer
}
catch { $rejected = $true }
if (-not $rejected) { throw "The task guard accepted an unreviewed issuer." }

$expectedPhases = @("preflight", "clean", "reviewed", "terminal", "contradiction", "rollback-probe", "cleanup")
$expectedCounts = @(
  "0|0|0|0|0|0|0|0|0|0|0|False",
  "2|2|0|0|0|2|2|3|3|3|30|False",
  "2|2|0|0|0|2|2|3|6|5|41|False",
  "4|2|2|0|0|4|4|3|6|5|56|False",
  "4|1|2|1|1|5|4|3|7|6|61|False",
  "4|1|2|1|1|5|4|3|7|6|61|True",
  "0|0|0|0|0|0|0|0|0|0|0|False"
)
for ($index = 0; $index -lt $expectedPhases.Count; $index += 1) {
  $value = Get-ExpectedAggregate -Phase $expectedPhases[$index]
  $actual = @(
    $value.documentCount, $value.parsedCount, $value.rejectedCount, $value.failedCount,
    $value.securityHoldCount, $value.receiptCount, $value.dispositionCount,
    $value.profileFactCount, $value.profileVersionCount, $value.evidenceCount,
    $value.persistentRows, $value.rollbackProved
  ) -join "|"
  if ($actual -cne $expectedCounts[$index]) { throw "The exact phase counts changed." }
}

$gateway = New-GatewayEvent -Runtime $runtime -RunId $runId -Method "POST" -Path "/v1/resumes/uploads" -Body ([ordered]@{ test = $true }) -IdempotencyKey "fixed-key"
if (
  [string]$gateway.requestContext.authorizer.jwt.claims.iss -cne $runtime.Issuer -or
  [string]$gateway.requestContext.authorizer.jwt.claims.sub -cne "d1-document-processing-acceptance:$runId" -or
  (@($gateway.requestContext.authorizer.jwt.scopes) -join "|") -cne "documents:read|documents:write|profile:read|profile:write"
) {
  throw "The direct gateway event does not bind the exact generated identity and scopes."
}
$gatewayRead = New-GatewayEvent -Runtime $runtime -RunId $runId -Method "GET" -Path "/v1/profile/facts" -Body $null -IdempotencyKey $null
if (
  $gatewayRead.Contains('body') -or
  -not $gateway.Contains('body') -or
  [string]$gateway.body -cne '{"test":true}'
) {
  throw "The direct gateway event does not preserve the bodyless GET and JSON POST boundary."
}
$expectedKey = 'quarantine/11111111-1111-4111-8111-111111111111/source'
$uploadFields = [pscustomobject]@{
  'Content-Type' = 'application/pdf'
  Policy = 'cG9saWN5'
  'X-Amz-Algorithm' = 'AWS4-HMAC-SHA256'
  'X-Amz-Credential' = 'ABCDEFGHIJKLMNOPQRST/20260815/us-east-2/s3/aws4_request'
  'X-Amz-Date' = '20260815T120000Z'
  'X-Amz-Security-Token' = 'synthetic-session-token'
  'X-Amz-Signature' = ('c' * 64)
  bucket = $runtime.CandidateDocumentBucket
  key = $expectedKey
  success_action_status = '204'
  'x-amz-checksum-algorithm' = 'SHA256'
  'x-amz-checksum-sha256' = 'u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s='
  'x-amz-meta-document-id' = '11111111-1111-4111-8111-111111111111'
  'x-amz-meta-sha256' = ('b' * 64)
  'x-amz-server-side-encryption' = 'aws:kms'
  'x-amz-server-side-encryption-aws-kms-key-id' = $runtime.PlatformKmsKeyArn
}
$upload = [pscustomobject]@{
  url = "https://$($runtime.CandidateDocumentBucket).s3.us-east-2.amazonaws.com/"
  fields = $uploadFields
}
if (-not (Assert-PresignedUploadTarget -Runtime $runtime -Upload $upload -ExpectedKey $expectedKey)) {
  throw "The exact presigned upload target was not accepted."
}
foreach ($badUrl in @(
    "http://$($runtime.CandidateDocumentBucket).s3.us-east-2.amazonaws.com/",
    'https://other-bucket.s3.us-east-2.amazonaws.com/',
    "https://$($runtime.CandidateDocumentBucket).s3.us-east-2.amazonaws.com/quarantine/other/source",
    "https://$($runtime.CandidateDocumentBucket).s3.us-east-2.amazonaws.com/?redirect=other"
  )) {
  $tamperedUpload = [pscustomobject]@{ url = $badUrl; fields = $uploadFields }
  $targetRejected = $false
  try { $null = Assert-PresignedUploadTarget -Runtime $runtime -Upload $tamperedUpload -ExpectedKey $expectedKey }
  catch { $targetRejected = $true }
  if (-not $targetRejected) { throw "An alternate presigned upload target was accepted." }
}
$tamperedKeyFields = $uploadFields | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$tamperedKeyFields.key = 'quarantine/other/source'
$tamperedKey = [pscustomobject]@{ url = $upload.url; fields = $tamperedKeyFields }
$keyRejected = $false
try { $null = Assert-PresignedUploadTarget -Runtime $runtime -Upload $tamperedKey -ExpectedKey $expectedKey }
catch { $keyRejected = $true }
if (-not $keyRejected) { throw "An alternate presigned upload key was accepted." }
foreach ($unexpectedName in @('file', 'redirect')) {
  $unexpectedFields = $uploadFields | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  Add-Member -InputObject $unexpectedFields -NotePropertyName $unexpectedName -NotePropertyValue 'unexpected'
  $unexpectedUpload = [pscustomobject]@{ url = $upload.url; fields = $unexpectedFields }
  $fieldRejected = $false
  try { $null = Assert-PresignedUploadTarget -Runtime $runtime -Upload $unexpectedUpload -ExpectedKey $expectedKey }
  catch { $fieldRejected = $true }
  if (-not $fieldRejected) { throw "An unexpected presigned upload form field was accepted." }
}
foreach ($ordinal in 1..4) {
  $pattern = "-Ordinal $ordinal -ObservedAt " + '\$(?<observedAt>[A-Za-z0-9]+) -ScanResult'
  $matches = [regex]::Matches($source, $pattern)
  if ($matches.Count -ne 2 -or $matches[0].Groups['observedAt'].Value -cne $matches[1].Groups['observedAt'].Value) {
    throw "The operator does not submit one exact duplicate replay for processor ordinal $ordinal."
  }
}
if ([regex]::Matches($source, '-Ordinal 5 -ObservedAt \$[A-Za-z0-9]+ -ScanResult').Count -ne 1) {
  throw "The contradiction event must be submitted exactly once."
}
$eventDocument = [pscustomobject]@{
  role = 'clean-pdf'
  sourceKey = 'quarantine/11111111-1111-4111-8111-111111111111/source'
  sourceVersion = 'exact-version'
}
$eventTime = '2026-08-15T12:34:56.0000000+00:00'
$firstEvent = New-DirectProcessorEvent -Runtime $runtime -Document $eventDocument -RunId $runId -Ordinal 1 -ObservedAt $eventTime -ScanResult 'NO_THREATS_FOUND'
$secondEvent = New-DirectProcessorEvent -Runtime $runtime -Document $eventDocument -RunId $runId -Ordinal 1 -ObservedAt $eventTime -ScanResult 'NO_THREATS_FOUND'
$firstBytes = [Text.Encoding]::UTF8.GetBytes(($firstEvent | ConvertTo-Json -Depth 20 -Compress))
$secondBytes = [Text.Encoding]::UTF8.GetBytes(($secondEvent | ConvertTo-Json -Depth 20 -Compress))
if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$firstBytes, [byte[]]$secondBytes)) {
  throw "The duplicate direct processor event is not byte-identical."
}
$domainEvent = $firstEvent.Records[0].body | ConvertFrom-Json
if (
  [string]$domainEvent.eventId -cne "direct-dark:$runId`:clean-pdf:1" -or
  -not ([string]$firstEvent.Records[0].body).Contains("`"observedAt`":`"$eventTime`"") -or
  [string]$firstEvent.Records[0].attributes.SentTimestamp -cne [string]([DateTimeOffset]::Parse($eventTime).ToUnixTimeMilliseconds())
) {
  throw "The deterministic direct processor envelope changed."
}

$emptyHistory = [pscustomobject]@{ Versions = @(); DeleteMarkers = @() }
if (-not (Test-ExactObjectAlreadyRemoved -History $emptyHistory -Key 'quarantine/id/source' -Version 'v1')) {
  throw "Exact object cleanup does not accept an already-proved zero history."
}
$omittedEmptyHistory = [pscustomobject]@{}
if (-not (Test-ExactObjectAlreadyRemoved -History $omittedEmptyHistory -Key 'quarantine/id/source' -Version 'v1')) {
  throw "Exact object cleanup does not accept AWS's omitted empty history fields."
}
$exactHistory = [pscustomobject]@{
  Versions = @([pscustomobject]@{ Key = 'quarantine/id/source'; VersionId = 'v1' })
  DeleteMarkers = @()
}
if (Test-ExactObjectAlreadyRemoved -History $exactHistory -Key 'quarantine/id/source' -Version 'v1') {
  throw "Exact object cleanup skipped a present reviewed version."
}
$historyRejected = $false
try {
  $badHistory = [pscustomobject]@{
    Versions = @([pscustomobject]@{ Key = 'quarantine/id/source'; VersionId = 'other' })
    DeleteMarkers = @()
  }
  $null = Test-ExactObjectAlreadyRemoved -History $badHistory -Key 'quarantine/id/source' -Version 'v1'
}
catch { $historyRejected = $true }
if (-not $historyRejected) { throw "Exact object cleanup accepted unrelated version history." }

$alarmNames = @(
  'ai-job-apply-development-document-scan-queue-age',
  'ai-job-apply-development-document-scan-dlq',
  'ai-job-apply-development-document-scan-delivery-dlq',
  'ai-job-apply-development-document-processor-errors',
  'ai-job-apply-development-document-parser-errors',
  'ai-job-apply-development-document-security-contradiction',
  'ai-job-apply-development-document-processing-record-failed',
  'ai-job-apply-development-document-processing-timed-out'
)
$topicArn = 'arn:aws:sns:us-east-2:123456789012:ai-job-apply-development-operational-alerts'
function global:Get-TerraformState { [pscustomobject]@{} }
function global:Get-StateOutput { param($State, $Name) $topicArn }
function global:Assert-TriggersDark { param($State) [pscustomobject]@{ MappingState = 'Disabled'; GuardDutyRuleState = 'DISABLED'; ReconcilerState = 'DISABLED' } }
$script:scanStatus = 'NO_THREATS_FOUND'
$script:corpusHeadMode = 'off'
$script:corpusHeadAttempts = 0
function global:Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Operation)
  if ($Arguments[0] -ceq 'guardduty' -and $Arguments[1] -ceq 'get-malware-protection-plan') {
    return [pscustomobject]@{
      Status = 'ACTIVE'
      ProtectedResource = [pscustomobject]@{
        S3Bucket = [pscustomobject]@{
          BucketName = $runtime.CandidateDocumentBucket
          ObjectPrefixes = @('quarantine/')
        }
      }
      Actions = [pscustomobject]@{ Tagging = [pscustomobject]@{ Status = 'ENABLED' } }
    }
  }
  if ($Arguments[0] -ceq 's3api' -and $Arguments[1] -ceq 'get-object-tagging') {
    $tagSet = if ([string]::IsNullOrEmpty([string]$script:scanStatus)) { @() }
    else { @([pscustomobject]@{ Key = 'GuardDutyMalwareScanStatus'; Value = [string]$script:scanStatus }) }
    return [pscustomobject]@{
      VersionId = 'source-version'
      TagSet = $tagSet
    }
  }
  if ($script:corpusHeadMode -cne 'off' -and $Arguments[0] -ceq 's3api' -and $Arguments[1] -ceq 'head-object') {
    $script:corpusHeadAttempts += 1
    if ($script:corpusHeadMode -ceq 'request-fail' -or
      ($script:corpusHeadMode -ceq 'transient-request' -and $script:corpusHeadAttempts -eq 1)) {
      throw 'Synthetic HeadObject request failure.'
    }
    $sha = if ($script:corpusHeadMode -ceq 'validation-fail') { 'd' * 64 } else { 'c' * 64 }
    return [pscustomobject]@{
      VersionId = 'source-version'
      ContentLength = 64
      ContentType = 'application/pdf'
      ServerSideEncryption = 'aws:kms'
      SSEKMSKeyId = $runtime.PlatformKmsKeyArn
      Metadata = [pscustomobject]@{ 'document-id' = '22222222-2222-4222-8222-222222222222'; sha256 = $sha }
    }
  }
  if ($script:orphanProofMode -and $Arguments[0] -ceq 's3api') {
    if ($Arguments[1] -ceq 'list-object-versions') {
      if ($script:objectPresent) {
        return [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = $expectedKey; VersionId = 'source-version' }); DeleteMarkers = @() }
      }
      return [pscustomobject]@{ Versions = @(); DeleteMarkers = @() }
    }
    if ($Arguments[1] -ceq 'head-object') {
      $script:objectHeadReads++
      return [pscustomobject]@{
        VersionId = 'source-version'
        ContentLength = 128
        ContentType = 'application/pdf'
        ServerSideEncryption = 'aws:kms'
        SSEKMSKeyId = $runtime.PlatformKmsKeyArn
        Metadata = [pscustomobject]@{ 'document-id' = '11111111-1111-4111-8111-111111111111'; sha256 = ('b' * 64) }
      }
    }
    if ($Arguments[1] -ceq 'delete-object') {
      $script:objectPresent = $false
      return [pscustomobject]@{ VersionId = 'source-version'; DeleteMarker = $false }
    }
  }
  if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-alias') {
    $weights = if ($script:weightedAlias) { [pscustomobject]@{ '8' = 0.1 } } else { [pscustomobject]@{} }
    return [pscustomobject]@{
      AliasArn = "$($Arguments[3]):$($Arguments[5])"
      Name = [string]$Arguments[5]
      FunctionVersion = '7'
      RevisionId = '11111111-1111-4111-8111-111111111111'
      RoutingConfig = [pscustomobject]@{ AdditionalVersionWeights = $weights }
    }
  }
  if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-function-configuration') {
    return [pscustomobject]@{
      FunctionArn = "$($Arguments[3]):$($Arguments[5])"
      Version = [string]$Arguments[5]
      CodeSha256 = ('A' * 43) + '='
      RevisionId = '22222222-2222-4222-8222-222222222222'
      Environment = [pscustomobject]@{ Variables = [pscustomobject]@{} }
    }
  }
  if ($Arguments[0] -ceq 'sqs' -and $Arguments[1] -ceq 'get-queue-url') {
    return [pscustomobject]@{ QueueUrl = "https://sqs.us-east-2.amazonaws.com/123456789012/$($Arguments[3])" }
  }
  if ($Arguments[0] -ceq 'sqs' -and $Arguments[1] -ceq 'get-queue-attributes') {
    return [pscustomobject]@{ Attributes = [pscustomobject]@{ ApproximateNumberOfMessages = '0'; ApproximateNumberOfMessagesNotVisible = '0'; ApproximateNumberOfMessagesDelayed = '0' } }
  }
  if ($Arguments[0] -ceq 'cloudwatch') {
    return [pscustomobject]@{ MetricAlarms = @($alarmNames | ForEach-Object {
          [pscustomobject]@{ AlarmName = $_; ActionsEnabled = $true; StateValue = 'OK'; AlarmActions = @($topicArn); OKActions = @($topicArn); InsufficientDataActions = @() }
        }) }
  }
  if ($Arguments[0] -ceq 'logs') {
    $message = '{"timestamp":"2026-08-15T12:00:00.000Z","level":"ERROR","requestId":"redacted","message":{"event":"document_processing_security_contradiction"}}'
    if (-not [string]::IsNullOrWhiteSpace([string]$script:privacyLeak)) { $message += " $($script:privacyLeak)" }
    return [pscustomobject]@{
      events = @([pscustomobject]@{ message = $message })
      nextToken = ''
    }
  }
  throw "Unexpected mocked AWS operation: $Operation"
}
$script:weightedAlias = $false
$script:orphanProofMode = $false
$script:privacyLeak = ''
$aliasIdentity = Get-LambdaAliasIdentity -AliasArn 'arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-gateway:development' -Description 'Test gateway'
if (
  [string]$aliasIdentity.FunctionVersion -cne '7' -or
  [string]$aliasIdentity.VersionArn -cne 'arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-gateway:7' -or
  [string]$aliasIdentity.CodeSha256 -cne (('A' * 43) + '=')
) {
  throw "The live Lambda alias/version identity was not bound exactly."
}
$script:weightedAlias = $true
$weightedRejected = $false
try {
  $null = Get-LambdaAliasIdentity -AliasArn 'arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-gateway:development' -Description 'Test gateway'
}
catch { $weightedRejected = $true }
$script:weightedAlias = $false
if (-not $weightedRejected) { throw "A weighted Lambda alias was accepted." }
$script:reviewedRuntimeIdentity = $null
$managedScanDocument = [pscustomobject]@{
  sourceKey = $expectedKey
  sourceVersion = 'source-version'
}
$managedScan = Wait-GuardDutyServiceScan -Runtime $runtime -Document $managedScanDocument -TimeoutSeconds 60
if (
  [string]$managedScan.ProtectionPlanStatus -cne 'ACTIVE' -or
  [string]$managedScan.TaggingStatus -cne 'ENABLED' -or
  [string]$managedScan.ScanResult -cne 'NO_THREATS_FOUND'
) {
  throw "The managed GuardDuty scan boundary was not accepted."
}
foreach ($terminalStatus in @('NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED')) {
  $script:scanStatus = $terminalStatus
  $acceptedTerminal = Wait-CorpusGuardDutyTerminalTag -Runtime $runtime -Document $managedScanDocument -Deadline ([DateTimeOffset]::UtcNow)
  if ([string]$acceptedTerminal -cne $terminalStatus) {
    throw "Corpus GuardDuty terminal wait changed or rejected $terminalStatus."
  }
}
$script:scanStatus = 'UNKNOWN'
$unknownTerminalRejected = $false
try { $null = Wait-CorpusGuardDutyTerminalTag -Runtime $runtime -Document $managedScanDocument -Deadline ([DateTimeOffset]::UtcNow) }
catch { $unknownTerminalRejected = $true }
if (-not $unknownTerminalRejected) { throw 'Corpus GuardDuty terminal wait accepted an unknown result.' }
$script:scanStatus = 'NO_THREATS_FOUND'
if (-not (Assert-CorpusSyntheticScanTag -Runtime $runtime -Document $managedScanDocument)) {
  throw 'The exact synthetic corpus tag was not accepted after readback.'
}
$readbackReceiptPath = [IO.Path]::GetTempFileName()
$readbackEntry = [pscustomobject]@{
  caseId = 'case-001'
  documentId = '22222222-2222-4222-8222-222222222222'
  mediaType = 'application/pdf'
  sizeBytes = 64
  sha256 = 'c' * 64
}
$readbackDocument = [pscustomobject]@{
  caseId = 'case-001'
  sourceKey = 'quarantine/22222222-2222-4222-8222-222222222222/source'
  sourceVersion = 'source-version'
}
$readbackReceipt = [pscustomobject]@{
  phase = 'running'
  failureStage = 'upload'
  failureCaseId = 'case-001'
  failureOperation = 'source-upload'
}
function global:Start-Sleep { param([int]$Seconds) }
try {
  $script:corpusHeadMode = 'transient-request'
  $script:corpusHeadAttempts = 0
  $null = Read-CorpusSourceExact -Runtime $runtime -Entry $readbackEntry -Document $readbackDocument -Receipt $readbackReceipt -ReceiptPath $readbackReceiptPath
  if ($script:corpusHeadAttempts -ne 2 -or [string]$readbackReceipt.failureOperation -cne 'source-readback-validation') {
    throw 'The bounded corpus readback did not recover from one HeadObject request failure without another upload.'
  }

  $script:corpusHeadMode = 'request-fail'
  $script:corpusHeadAttempts = 0
  $requestFailureClosed = $false
  try { $null = Read-CorpusSourceExact -Runtime $runtime -Entry $readbackEntry -Document $readbackDocument -Receipt $readbackReceipt -ReceiptPath $readbackReceiptPath }
  catch { $requestFailureClosed = $_.Exception.Message -ceq 'The exact corpus source object readback request did not succeed within the bounded retry window.' }
  if (-not $requestFailureClosed -or $script:corpusHeadAttempts -ne 5 -or [string]$readbackReceipt.failureOperation -cne 'source-readback-request') {
    throw 'The bounded corpus readback did not retain its closed request-failure attribution.'
  }

  $script:corpusHeadMode = 'validation-fail'
  $script:corpusHeadAttempts = 0
  $validationFailureClosed = $false
  try { $null = Read-CorpusSourceExact -Runtime $runtime -Entry $readbackEntry -Document $readbackDocument -Receipt $readbackReceipt -ReceiptPath $readbackReceiptPath }
  catch { $validationFailureClosed = $_.Exception.Message -ceq 'The exact corpus source object readback remained outside the reviewed generated bytes after the bounded retry window.' }
  if (-not $validationFailureClosed -or $script:corpusHeadAttempts -ne 5 -or [string]$readbackReceipt.failureOperation -cne 'source-readback-validation') {
    throw 'The bounded corpus readback did not retain its closed validation-failure attribution.'
  }
}
finally {
  $script:corpusHeadMode = 'off'
  Remove-Item -LiteralPath $readbackReceiptPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath Function:global:Start-Sleep -Force -ErrorAction SilentlyContinue
}
$checkpointPlan = [pscustomobject]@{ cases = @([pscustomobject]@{ caseId = 'case-001' }) }
$checkpointReceipt = [pscustomobject]@{ phase = 'running'; failureStage = 'upload'; failureCaseId = 'case-001'; failureOperation = 'source-upload' }
if (-not (Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan)) {
  throw 'A valid corpus case failure checkpoint was not accepted.'
}
$checkpointReceipt.failureStage = 'none'
$checkpointReceipt.failureCaseId = ''
$checkpointReceipt.failureOperation = 'none'
$invalidNoneRejected = $false
try { $null = Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan }
catch { $invalidNoneRejected = $true }
if (-not $invalidNoneRejected) { throw 'A running corpus receipt accepted a closed none failure stage.' }
$checkpointReceipt.phase = 'verified'
if (-not (Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan)) {
  throw 'A verified corpus receipt did not accept the closed none failure stage.'
}
$checkpointReceipt.phase = 'recovered-cleaned'
$recoveredNoneRejected = $false
try { $null = Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan }
catch { $recoveredNoneRejected = $true }
if (-not $recoveredNoneRejected) { throw 'A recovered corpus receipt erased its original failure with a none stage.' }
$checkpointReceipt.failureStage = 'cleanup'
if (-not (Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan)) {
  throw 'A recovered corpus receipt did not preserve its cleanup failure attribution.'
}
$checkpointReceipt.failureStage = 'upload'
$checkpointReceipt.failureCaseId = 'case-001'
$checkpointReceipt.failureOperation = 'source-readback-validation'
if (-not (Assert-CorpusFailureCheckpoint -Receipt $checkpointReceipt -Plan $checkpointPlan)) {
  throw 'A recovered corpus receipt did not preserve its case-bound original failure attribution.'
}
$script:orphanProofMode = $true
$script:objectPresent = $true
$script:objectHeadReads = 0
$orphan = [pscustomobject]@{
  sourceKey = $expectedKey
  sourceVersion = ''
  sizeBytes = 128
  mediaType = 'application/pdf'
  documentId = '11111111-1111-4111-8111-111111111111'
  sha256 = ('b' * 64)
  normalizedKey = ''
  normalizedVersion = ''
}
Complete-SourceDescriptor -Runtime $runtime -Document $orphan
if ([string]$orphan.sourceVersion -cne 'source-version') {
  throw "Cleanup could not recover the exact version of an uploaded source orphan."
}
$headReadsBeforeCleanup = $script:objectHeadReads
Remove-DescriptorObjects -Runtime $runtime -Documents @($orphan)
if ($script:objectPresent) { throw "Cleanup left the recovered exact source version orphaned." }
if ($script:objectHeadReads -ne $headReadsBeforeCleanup) {
  throw "Cleanup required read access to a descriptor-bound quarantined version."
}
$script:orphanProofMode = $false
$health = Assert-DocumentOperationalHealth
if ($health.QueueCount -ne 3 -or $health.AlarmCount -ne 8 -or -not $health.AllAlarmsOk) {
  throw "The functional operational-health gate did not prove the exact queues and alarms."
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-job-apply-document-fixtures-$([guid]::NewGuid().ToString('N'))"
$firstDirectory = Join-Path $temporaryRoot "first"
$secondDirectory = Join-Path $temporaryRoot "second"
$harnessPath = Join-Path $temporaryRoot "parse-fixtures.mjs"
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  & node $fixtureGenerator --run-id $runId --output-directory $firstDirectory
  if ($LASTEXITCODE -ne 0) { throw "The first fixture build failed." }
  & node $fixtureGenerator --run-id $runId --output-directory $secondDirectory
  if ($LASTEXITCODE -ne 0) { throw "The second fixture build failed." }
  $first = Get-Content -LiteralPath (Join-Path $firstDirectory "descriptor.json") -Raw | ConvertFrom-Json
  $second = Get-Content -LiteralPath (Join-Path $secondDirectory "descriptor.json") -Raw | ConvertFrom-Json
  if (
    [string]$first.fixtureSetSha256 -cne [string]$second.fixtureSetSha256 -or
    @($first.manifest).Count -ne 4 -or
    (@($first.manifest.fixture) -join "|") -cne "clean-docx|clean-pdf|invalid-pdf|malware-test"
  ) {
    throw "The fixture manifest is not exact and deterministic."
  }
  $script:SourceSha = 'b' * 40
  $script:ReviewedExecutionPlanSha256 = 'c' * 64
  $receipt = [pscustomobject]@{ runId = $runId }
  $manifestByRole = @{}
  foreach ($entry in @($first.manifest)) { $manifestByRole[[string]$entry.fixture] = $entry }
  $documentId = '019b4e12-7ea3-7c36-9357-aea35ab542ca'
  $entry = $manifestByRole['clean-pdf']
  $recovery = [pscustomobject]@{
    schemaVersion = 1
    kind = 'development-document-processing-recovery'
    sourceSha = $script:SourceSha
    executionPlanSha256 = $script:ReviewedExecutionPlanSha256
    runId = $runId
    documents = @([pscustomobject]@{
        role = 'clean-pdf'
        documentId = $documentId
        sourceKey = "quarantine/$documentId/source"
        sourceVersion = 'source-version'
        mediaType = [string]$entry.mediaType
        sizeBytes = [long]$entry.sizeBytes
        sha256 = [string]$entry.sha256
        normalizedKey = "normalized/$documentId/$($entry.sha256)/resume-parser-v1/resume.json"
        normalizedVersion = 'normalized-version'
      })
    updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  $fixtureEvidence = [pscustomobject]@{ Descriptor = $first }
  if (-not (Assert-RecoveryDescriptor -Descriptor $recovery -Receipt $receipt -FixtureEvidence $fixtureEvidence)) {
    throw "The exact recovery descriptor was not accepted."
  }
  $tamperedRecovery = $recovery | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $tamperedRecovery.documents[0].sourceKey = 'quarantine/other/source'
  $recoveryRejected = $false
  try { $null = Assert-RecoveryDescriptor -Descriptor $tamperedRecovery -Receipt $receipt -FixtureEvidence $fixtureEvidence }
  catch { $recoveryRejected = $true }
  if (-not $recoveryRejected) { throw "Recovery accepted an arbitrary source key." }
  $script:applicationLogGroup = '/ai-job-apply/development/application'
  $privacyReceipt = [pscustomobject]@{
    runId = $runId
    startedAt = [DateTimeOffset]::UtcNow.AddMinutes(-6).ToString('o')
    completedAt = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('o')
  }
  if (-not (Assert-PrivacySafeLogs -Receipt $privacyReceipt -FixtureEvidence $fixtureEvidence -Documents @($recovery.documents))) {
    throw "The functional privacy-safe log gate did not complete."
  }
  $cleanPdfFile = [string]@($first.files | Where-Object fixture -ceq 'clean-pdf')[0].path
  $privacyLeaks = @(
    $runId,
    [string]@($first.manifest | Where-Object fixture -ceq 'clean-pdf')[0].sha256,
    'source-version',
    'TypeScript',
    [string]@($first.manifest | Where-Object fixture -ceq 'clean-docx')[0].fileName,
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($cleanPdfFile))
  )
  foreach ($leak in $privacyLeaks) {
    $script:privacyLeak = $leak
    $leakRejected = $false
    try { $null = Assert-PrivacySafeLogs -Receipt $privacyReceipt -FixtureEvidence $fixtureEvidence -Documents @($recovery.documents) }
    catch { $leakRejected = $true }
    if (-not $leakRejected) { throw "The privacy scan accepted a generated identifier, digest, version, value, filename, or fixture body." }
  }
  $script:privacyLeak = ''
  foreach ($entry in @($first.manifest)) {
    $firstFile = @($first.files | Where-Object fixture -ceq $entry.fixture)[0].path
    $secondFile = @($second.files | Where-Object fixture -ceq $entry.fixture)[0].path
    if (
      (Get-TestFileSha256 -Path $firstFile) -cne [string]$entry.sha256 -or
      (Get-TestFileSha256 -Path $firstFile) -cne (Get-TestFileSha256 -Path $secondFile) -or
      (Get-Item -LiteralPath $firstFile).Length -ne [long]$entry.sizeBytes
    ) {
      throw "Generated fixture size or SHA parity failed."
    }
    if ($entry.fixture -ceq 'malware-test') {
      $bytes = [IO.File]::ReadAllBytes($firstFile)
      if ([Text.Encoding]::ASCII.GetString($bytes, 0, 5) -cne '%PDF-' -or -not [Text.Encoding]::ASCII.GetString($bytes).Contains('%%EOF')) {
        throw "The harmless malware-disposition fixture is not a bounded structural PDF."
      }
    }
  }

  & pnpm --filter @ai-job-apply/documents-service... build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The production parser build failed." }
  $parsingModule = (Join-Path $repositoryRoot "backend\services\documents\dist\src\parsing\index.js").Replace("\", "/")
  $harness = @"
import { readFile } from "node:fs/promises";
import { parseResume } from "file:///$parsingModule";
const descriptor = JSON.parse(await readFile(process.argv[2], "utf8"));
const byRole = new Map(descriptor.manifest.map(entry => [entry.fixture, entry]));
const paths = new Map(descriptor.files.map(entry => [entry.fixture, entry.path]));
for (const role of ["clean-pdf", "clean-docx"]) {
  const entry = byRole.get(role);
  const normalized = await parseResume({ documentId:"019b4e12-7ea3-7c36-9357-aea35ab542ca", documentVersion:1, parserVersion:"resume-parser-v1", mediaType:entry.mediaType, sourceSha256:entry.sha256, createdAt:"2026-08-15T00:00:00.000Z", bytes:new Uint8Array(await readFile(paths.get(role))) });
  if (!normalized.blocks.length) throw new Error("empty parsed role");
}
let rejected = false;
try { const entry=byRole.get("invalid-pdf"); await parseResume({ documentId:"019b4e12-7ea3-7c36-9357-aea35ab542ca", documentVersion:1, parserVersion:"resume-parser-v1", mediaType:entry.mediaType, sourceSha256:entry.sha256, createdAt:"2026-08-15T00:00:00.000Z", bytes:new Uint8Array(await readFile(paths.get("invalid-pdf"))) }); } catch { rejected=true; }
if (!rejected) throw new Error("invalid PDF parsed");
"@
  [IO.File]::WriteAllText($harnessPath, $harness, [Text.UTF8Encoding]::new($false))
  & node $harnessPath (Join-Path $firstDirectory "descriptor.json")
  if ($LASTEXITCODE -ne 0) { throw "Generated fixtures failed the production parser harness." }
}
finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  $systemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($systemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemporary)) {
    [IO.Directory]::Delete($resolvedTemporary, $true)
  }
}

$corpusRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-job-apply-parser-corpus-$([guid]::NewGuid().ToString('N'))"
try {
  $corpusFirst = Join-Path $corpusRoot 'first'
  $corpusSecond = Join-Path $corpusRoot 'second'
  & node $corpusGenerator --run-id $runId --output-directory $corpusFirst 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The first bounded parser corpus generation failed.' }
  & node $corpusGenerator --run-id $runId --output-directory $corpusSecond 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The second bounded parser corpus generation failed.' }
  $firstCorpus = Get-Content -LiteralPath (Join-Path $corpusFirst 'descriptor.json') -Raw | ConvertFrom-Json
  $secondCorpus = Get-Content -LiteralPath (Join-Path $corpusSecond 'descriptor.json') -Raw | ConvertFrom-Json
  if (@($firstCorpus.cases).Count -ne 43 -or @($firstCorpus.files).Count -ne 43 -or
    [string]$firstCorpus.corpusSha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$firstCorpus.corpusSha256 -cne [string]$secondCorpus.corpusSha256 -or
    (@($firstCorpus.cases.sha256) -join '|') -cne (@($secondCorpus.cases.sha256) -join '|')) {
    throw 'The generated parser corpus is not exact, bounded, and byte deterministic.'
  }
  foreach ($entry in @($firstCorpus.cases)) {
    if ([string]$entry.expectedReasonCode -notmatch '^[A-Z0-9_]{1,64}$' -or
      [string]$entry.expectedFailureCode -notin @('invalid_document', 'parse_failed')) {
      throw 'The generated parser corpus includes an unbounded result expectation.'
    }
  }
  $script:SourceSha = 'b' * 40
  $reasonCounts = [ordered]@{}
  foreach ($entry in @($firstCorpus.cases)) {
    $reason = [string]$entry.expectedReasonCode
    $reasonCounts[$reason] = 1 + [int]$reasonCounts[$reason]
  }
  $aggregate = [pscustomobject]@{
    schemaVersion = 1
    profile = 'd1_deployed_document_parser_adversarial_corpus_v1'
    corpusVersion = [string]$firstCorpus.corpusVersion
    corpusSha256 = [string]$firstCorpus.corpusSha256
    releaseSourceSha = $script:SourceSha
    runId = [string]$firstCorpus.runId
    parserVersion = 'resume-parser-v1'
    caseCount = 43
    rejectedCount = 43
    databaseAccessed = $false
    reasonCodeCounts = [pscustomobject]$reasonCounts
  }
  $plan = [pscustomobject]@{
    corpusVersion = [string]$firstCorpus.corpusVersion
    corpusSha256 = [string]$firstCorpus.corpusSha256
    runId = [string]$firstCorpus.runId
    cases = @($firstCorpus.cases)
  }
  if (-not (Assert-CorpusAggregate -Aggregate $aggregate -Plan $plan)) {
    throw 'The exact aggregate-only corpus result was not accepted.'
  }
  $aggregate | Add-Member -NotePropertyName payload -NotePropertyValue 'forbidden'
  $leakRejected = $false
  try { $null = Assert-CorpusAggregate -Aggregate $aggregate -Plan $plan } catch { $leakRejected = $true }
  if (-not $leakRejected) { throw 'Corpus evidence accepted a payload-bearing result.' }
}
finally {
  $resolvedCorpusRoot = [IO.Path]::GetFullPath($corpusRoot)
  $systemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedCorpusRoot.StartsWith($systemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedCorpusRoot)) {
    [IO.Directory]::Delete($resolvedCorpusRoot, $true)
  }
}

Write-Output "development-document-processing-acceptance-operator tests passed"
