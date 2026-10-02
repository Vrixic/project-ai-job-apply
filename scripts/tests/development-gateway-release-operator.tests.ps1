Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-gateway-release.ps1"
$operator = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The gateway release operator does not parse: $($errors.Message -join '; ')." }
foreach ($coreOperator in @(
    "operate-bootstrap-workload-boundary.ps1", "operate-development-gateway-release.ps1",
    "operate-development-document-migration.ps1", "operate-development-document-dark-deployment.ps1"
  )) {
  $coreSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts/$coreOperator") -Raw
  foreach ($required in @(
      'lib\terraform-toolchain.ps1', 'Assert-DeploymentTerraformCli', '-backend-config=use_lockfile=true',
      'Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory',
      '-ExpectedBucket $StateBucket -ExpectedKey', '-ExpectedRegion $Region -ExpectedKmsKeyArn',
      'Read-DeploymentTerraformPlan -Path', 'Assert-DeploymentTerraformStateVersion'
    )) {
    if (-not $coreSource.Contains($required)) { throw "The core operator $coreOperator omits the current toolchain/locking boundary." }
  }
  if ($coreSource -notmatch '(?s) init -reconfigure.+?-backend-config=use_lockfile=true.+?if \(\$LASTEXITCODE -ne 0\).+?Assert-DeploymentTerraformBackend' -or
      $coreSource -match '-lock=false') {
    throw "The core operator $coreOperator does not validate native locking immediately after successful init."
  }
}
if (-not $operator.Contains('$plan = Read-Plan $planPath -AllowHistorical') -or
    -not $operator.Contains('$seed = Read-Plan $seedPath -AllowHistorical') -or
    $operator -match 'Read-Plan \$(path|reviewedPath|capturedPath) -AllowHistorical') {
  throw "Historical gateway reads are not restricted to retained baseline/seed paths."
}
foreach ($required in @(
    'Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf"',
    'The gateway baseline variable inventory is empty or duplicated.',
    'DocumentReleaseSourceSha', 'DocumentOperatorSourceSha',
    'DocumentOperatorDeltaSha256', 'BaselineToReleaseDeltaSha256',
    '9c1b4d52b1bfc7d3901a8d6131a77ff714f85d61fb549114e0165634e49eb4b6',
    'New-CurrentDocumentBaselineMetadata', 'Assert-CurrentDocumentBaselineEvidence', 'DocumentReceiptPath', 'ReviewedDocumentReceiptSha256',
    'Outcome = "captured-current-zero-drift"', 'Baseline capture did not produce an exact zero-drift plan.'
  )) {
  if (-not $operator.Contains($required)) {
    throw "The gateway operator does not preserve the exact split-source migration handoff."
  }
}
# D3-020: the two-receipt (schema 8) baseline is captured only from two different receipts, accepted only
# by this operator, and can only start a release that refreshes parser and processor together.
foreach ($twoReceiptMarker in @(
    'ProcessorDocumentReceiptPath', 'ReviewedProcessorDocumentReceiptSha256',
    'A two-receipt baseline requires a second, different processor publication receipt with its reviewed checksum.',
    'The processor document receipt checksum does not match review.',
    '-Role processor', '-Role parser', '-AllowTwoReceipts',
    'ProcessorReleaseSourceSha = [string]$processorReceipt.sourceSha',
    'A two-receipt baseline can only start a release that refreshes the document parser and processor together from one receipt.'
  )) {
  if (-not $operator.Contains($twoReceiptMarker)) {
    throw "The gateway operator does not preserve the two-receipt convergence boundary: $twoReceiptMarker"
  }
}
if (-not ($operator -match '(?s)\$baseline = Read-Baseline\s+\$documentArtifacts = Read-DocumentRefreshArtifacts\s+#[^\n]*\n(?:#[^\n]*\n)*if \(\[string\]\$baseline\.MetadataSchemaVersion -ceq "8" -and -not \(\$RefreshDocumentParser -and \$RefreshDocumentProcessor\)\) \{\s+throw')) {
  throw "The two-receipt baseline is not tied to a release that refreshes parser and processor together."
}
# No other reader may opt in to a two-receipt baseline.
foreach ($otherOperator in @("operate-development-document-migration.ps1", "operate-development-d2-runtime-release.ps1")) {
  $otherSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\$otherOperator") -Raw
  if ($otherSource.Contains("AllowTwoReceipts")) { throw "$otherOperator must not accept a two-receipt baseline." }
}
# D3-023: the document scan activation is a separate Plan/Apply/Verify mode that never combines with a release,
# needs a current schema-7 baseline, applies only the exact reviewed plan, and verifies live state and zero drift.
foreach ($activationMarker in @(
    'DocumentScanActivation', 'EnableMapping', 'EnableRule', 'DisableRule', 'DisableMapping',
    'development-document-scan-activation-guards.ps1',
    'A document scan activation is planned, applied, and verified on its own, from a retained baseline, and never with a release.',
    'A document scan activation requires a current schema-7 baseline.',
    'Assert-DocumentScanActivationVariables', 'Assert-ExactDocumentScanActivationPlan',
    'Assert-DocumentScanActivationLive', 'Invoke-ActivationZeroDrift',
    'The document scan activation did not produce an exact reviewable change.',
    'Remote state changed after review; generate a new activation plan.',
    'Post-activation verification requires exactly one state advance from the reviewed plan.',
    'The activation plan checksum does not match review.', 'development-document-scan-activation-plan'
  )) {
  if (-not $operator.Contains($activationMarker)) {
    throw "The gateway operator does not preserve the document scan activation boundary: $activationMarker"
  }
}
# The activation branch must run before the release publication receipt is read, so it can never be combined with one.
if ($operator.IndexOf('if ($DocumentScanActivation -cne "None") {') -lt 0 -or
    $operator.IndexOf('if ($DocumentScanActivation -cne "None") {') -gt $operator.IndexOf('$publication = Read-Receipt $boundary')) {
  throw "The document scan activation is not isolated from the release publication path."
}
foreach ($otherOperator in @("operate-development-document-migration.ps1", "operate-development-d2-runtime-release.ps1", "operate-development-document-dark-deployment.ps1")) {
  $otherSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\$otherOperator") -Raw
  if ($otherSource.Contains("DocumentScanActivation")) { throw "$otherOperator must not carry the document scan activation." }
}
# D3-024: appending one exact upload CORS origin is a separate Plan/Apply/Verify mode that never combines with a release
# or an activation, needs a current schema-7 baseline, applies only the exact reviewed plan, and verifies the live CORS.
foreach ($corsMarker in @(
    'DocumentUploadCorsOrigin', 'development-document-upload-cors-guards.ps1',
    'A document upload CORS change is planned, applied, and verified on its own, from a retained baseline, and never with a release.',
    'A document upload CORS change requires a current schema-7 baseline.',
    'Assert-DocumentUploadCorsVariables', 'Assert-ExactDocumentUploadCorsPlan', 'Assert-DocumentUploadCorsLive',
    'Invoke-UploadCorsZeroDrift', 'The document upload CORS change did not produce an exact reviewable change.',
    'Remote state changed after review; generate a new upload CORS plan.',
    'Post-change verification requires exactly one state advance from the reviewed plan.',
    'The upload CORS plan checksum does not match review.', 'development-document-upload-cors-plan',
    'The live upload CORS configuration does not match the reviewed change.'
  )) {
  if (-not $operator.Contains($corsMarker)) {
    throw "The gateway operator does not preserve the document upload CORS boundary: $corsMarker"
  }
}
if ($operator.IndexOf('if ($DocumentUploadCorsOrigin -cne "") {') -lt 0 -or
    $operator.IndexOf('if ($DocumentUploadCorsOrigin -cne "") {') -gt $operator.IndexOf('$publication = Read-Receipt $boundary')) {
  throw "The document upload CORS change is not isolated from the release publication path."
}
foreach ($otherOperator in @("operate-development-document-migration.ps1", "operate-development-d2-runtime-release.ps1", "operate-development-document-dark-deployment.ps1")) {
  $otherSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\$otherOperator") -Raw
  if ($otherSource.Contains("DocumentUploadCorsOrigin")) { throw "$otherOperator must not carry the document upload CORS change." }
}
# D3-027: the candidate-rights activity code refresh is a separate Plan/Apply/Verify mode that never combines with a release,
# an activation, or a CORS change, needs a current schema-7 baseline and a verified core-workflow receipt, applies only the exact
# reviewed plan, and verifies the whole live chain and zero drift.
foreach ($activityMarker in @(
    'RefreshCandidateRightsActivity', 'WorkflowReceiptPath', 'ReviewedWorkflowReceiptSha256',
    'EnableRestrictedAnswerExport', 'TF_VAR_restricted_answer_export_enabled',
    'Restricted-answer export activation requires its own candidate-rights activity refresh.',
    '-EnableRestrictedAnswerExport:$EnableRestrictedAnswerExport', 'RestrictedAnswerExportEnabled',
    'development-candidate-rights-activity-guards.ps1',
    'A candidate-rights activity refresh is planned, applied, and verified on its own, from a retained baseline, and never with a release.',
    'A candidate-rights activity refresh requires a current schema-7 baseline.',
    'The candidate-rights activity refresh is planned, applied, and verified only.',
    'A workflow publication receipt is accepted only by the candidate-rights activity refresh.',
    'Get-VerifiedWorkflowActivityArtifact', 'Get-CandidateRightsActivityArtifact', 'Assert-CandidateRightsActivityVariables',
    'Assert-ExactCandidateRightsActivityPlan', 'Assert-CandidateRightsActivityLive', 'Invoke-CandidateRightsActivityZeroDrift',
    'The workflow publication receipt checksum does not match review.',
    'The activity artifact failed independent exact-version readback.',
    'The candidate-rights activity refresh did not produce an exact reviewable change.',
    'Remote state changed after review; generate a new activity refresh plan.',
    'The activity refresh plan checksum does not match review.', 'development-candidate-rights-activity-plan',
    'The exact reviewed candidate-rights activity plan failed to apply.',
    'The live durable role does not invoke exactly the new activity version.'
  )) {
  if (-not $operator.Contains($activityMarker)) {
    throw "The gateway operator does not preserve the candidate-rights activity refresh boundary: $activityMarker"
  }
}
if ($operator.IndexOf('if ($RefreshCandidateRightsActivity) {') -lt 0 -or
    $operator.IndexOf('if ($RefreshCandidateRightsActivity) {') -gt $operator.IndexOf('$publication = Read-Receipt $boundary')) {
  throw "The candidate-rights activity refresh is not isolated from the release publication path."
}
# The other isolated modes refuse it, and no other operator carries it.
foreach ($isolatedMode in @('if ($DocumentScanActivation -cne "None") {', 'if ($DocumentUploadCorsOrigin -cne "") {')) {
  $start = $operator.IndexOf($isolatedMode)
  $end = $operator.IndexOf('throw "', $start)
  if ($start -lt 0 -or -not $operator.Substring($start, $end - $start).Contains('$RefreshCandidateRightsActivity')) {
    throw "An isolated mode does not refuse the candidate-rights activity refresh."
  }
}
foreach ($otherOperator in @("operate-development-document-migration.ps1", "operate-development-d2-runtime-release.ps1", "operate-development-document-dark-deployment.ps1")) {
  $otherSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\$otherOperator") -Raw
  if ($otherSource.Contains("RefreshCandidateRightsActivity")) { throw "$otherOperator must not carry the candidate-rights activity refresh." }
}
foreach ($recoveryMarker in @(
    "Assert-GatewayVerifySourceDelta", "The gateway verification-only delta is empty",
    'if ($Action -cne "Verify")', "The gateway drift variable inventory is empty or duplicated.",
    "AllowOneSerialAdvance", "Post-apply verification requires the exact reviewed gateway release plan",
    "The post-apply gateway release plan checksum does not match review.",
    '"docs/product/delivery/phase-3-application-preparation.md"',
    '"scripts/lib/development-current-document-baseline.ps1"',
    '"scripts/tests/development-current-document-baseline.tests.ps1"',
    "Assert-ExactApplicationsRecoveryTwoSnapshotVerification", "TwoSnapshotVerification",
    '"--page-size", "1000", "--max-items", "2000"'
  )) {
  if (-not $operator.Contains($recoveryMarker)) {
    throw "The gateway operator does not preserve the verifier-only post-apply recovery path."
  }
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Action } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
}

foreach ($functionName in @(
    "Get-OptionalProperty", "Get-GatewayKeyHistoryMatches", "Get-TextSha256",
    "Get-DocumentOperatorDeltaSha256", "Assert-GatewayVerifySourceDelta",
    "Get-StateDocumentProcessorParserQualifiedArn", "Assert-RetainedGatewayParserBinding"
  )) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$originalRepositoryRoot = $repositoryRoot
$script:documentDeltaMode = "valid"
$script:documentDeltaCatFileCalls = 0
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") {
    $global:LASTEXITCODE = if ($script:documentDeltaMode -ceq "nonancestor") { 1 } else { 0 }
    return
  }
  if ($arguments -contains "--name-status") {
    $global:LASTEXITCODE = 0
    switch ($script:documentDeltaMode) {
      "valid" { return @(
          "M`tbackend/services/jobs/src/persistence/catalog.ts",
          "M`tbackend/services/jobs/src/persistence/catalog.test.ts"
        ) }
      "unapproved" { return "M`tbackend/services/jobs/src/persistence/unapproved.ts" }
      "add" { return "A`tbackend/services/jobs/src/persistence/catalog.ts" }
      "delete" { return "D`tbackend/services/jobs/src/persistence/catalog.ts" }
      "rename" { return "R100`tbackend/services/jobs/src/persistence/catalog.ts`tbackend/services/jobs/src/persistence/catalog.test.ts" }
      default { return "M`tbackend/services/jobs/src/persistence/catalog.ts" }
    }
  }
  if ($arguments -contains "--numstat") {
    $global:LASTEXITCODE = 0
    if ($script:documentDeltaMode -ceq "binary") {
      return "-`t-`tbackend/services/jobs/src/persistence/catalog.ts"
    }
    return "1`t1`tbackend/services/jobs/src/persistence/catalog.ts"
  }
  if ($arguments -contains "cat-file") {
    $script:documentDeltaCatFileCalls++
    $global:LASTEXITCODE = 0
    if ($script:documentDeltaMode -ceq "gitlink") { return "commit" }
    return "blob"
  }
  if ($arguments -contains "--full-index") {
    $global:LASTEXITCODE = 0
    return "fixture patch $($script:documentDeltaMode)"
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  $releaseSha = "1" * 40
  $currentSha = "2" * 40
  $deltaSha = Get-DocumentOperatorDeltaSha256 -ReleaseSha $releaseSha -OperatorSha $currentSha
  if ($deltaSha -notmatch '^[a-f0-9]{64}$' -or $script:documentDeltaCatFileCalls -ne 4) {
    throw "The exact two-file Jobs timestamp delta was not accepted as modified regular blobs."
  }
  foreach ($mode in @("unapproved", "add", "delete", "rename", "binary", "gitlink", "nonancestor")) {
    $script:documentDeltaMode = $mode
    Assert-Rejected {
      Get-DocumentOperatorDeltaSha256 -ReleaseSha $releaseSha -OperatorSha $currentSha
    } "The canonical document delta accepted the '$mode' fixture."
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  Remove-Variable -Name documentDeltaMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name documentDeltaCatFileCalls -Scope Script -ErrorAction SilentlyContinue
}

$script:verifyDeltaPath = "docs/product/delivery/DELIVERY_TRACKER.md"
$script:verifyDeltaMode = "valid"
function git {
  $arguments = @($args)
  $global:LASTEXITCODE = 0
  if ($arguments -contains "merge-base") { if ($script:verifyDeltaMode -ceq "nonancestor") { $global:LASTEXITCODE = 1 }; return }
  if ($arguments -contains "--name-status") {
    switch ($script:verifyDeltaMode) {
      "add" { return "A`t$script:verifyDeltaPath" }
      "delete" { return "D`t$script:verifyDeltaPath" }
      "rename" { return "R100`t$script:verifyDeltaPath`tother.md" }
      "empty" { return }
      default { return "M`t$script:verifyDeltaPath" }
    }
  }
  if ($arguments -contains "--numstat") {
    if ($script:verifyDeltaMode -ceq "binary") { return "-`t-`t$script:verifyDeltaPath" }
    return "1`t1`t$script:verifyDeltaPath"
  }
  if ($arguments -contains "cat-file") { if ($script:verifyDeltaMode -ceq "gitlink") { return "commit" }; return "blob" }
  throw "Unexpected verification delta Git call."
}
try {
  foreach ($path in @("docs/product/delivery/DELIVERY_TRACKER.md", "scripts/operate-development-gateway-release.ps1", "scripts/lib/development-gateway-release-guards.ps1", "scripts/tests/development-gateway-release-guards.tests.ps1", "scripts/tests/development-gateway-release-operator.tests.ps1", "infrastructure/runbooks/deployments/development-gateway-release.md", "docs/product/delivery/phase-3-application-preparation.md")) {
    $script:verifyDeltaPath = $path
    Assert-GatewayVerifySourceDelta -ReleaseSha ("1" * 40) -OperatorSha ("2" * 40)
  }
  $script:verifyDeltaPath = "docs/product/delivery/DELIVERY_TRACKER.md"
  foreach ($mode in @("add", "delete", "rename", "empty", "binary", "gitlink", "nonancestor")) {
    $script:verifyDeltaMode = $mode
    Assert-Rejected { Assert-GatewayVerifySourceDelta -ReleaseSha ("1" * 40) -OperatorSha ("2" * 40) } "Verification accepted a $mode source delta."
  }
  $script:verifyDeltaMode = "valid"
  foreach ($path in @("backend/workflows/src/candidate-rights-aws.ts", "backend/gateway/src/app.module.ts", "infrastructure/terraform/modules/platform/main.tf", "docs/product/delivery/unapproved.md")) {
    $script:verifyDeltaPath = $path
    Assert-Rejected { Assert-GatewayVerifySourceDelta -ReleaseSha ("1" * 40) -OperatorSha ("2" * 40) } "Verification accepted unrelated source changes."
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  Remove-Variable -Name verifyDeltaPath, verifyDeltaMode -Scope Script -ErrorAction SilentlyContinue
}
$exactKey = "lambda/gateway/source/artifact/gateway-lambda.zip"
foreach ($emptyHistory in @(
    [pscustomobject]@{},
    [pscustomobject]@{ Versions = @(); DeleteMarkers = @() },
    [pscustomobject]@{ Versions = @($null); DeleteMarkers = @($null) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $emptyHistory -Key $exactKey).Count -ne 0) {
    throw "Empty or null S3 gateway history was treated as an existing immutable key."
  }
}
foreach ($existingHistory in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = $exactKey }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = $exactKey }) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $existingHistory -Key $exactKey).Count -ne 1) {
    throw "An exact gateway object version or delete marker was not detected."
  }
}
$unrelatedHistory = [pscustomobject]@{
  Versions = @($null, [pscustomobject]@{ Key = "$exactKey.unrelated" }, [pscustomobject]@{})
  DeleteMarkers = @([pscustomobject]@{ Key = "unrelated/$exactKey" })
}
if (@(Get-GatewayKeyHistoryMatches -Result $unrelatedHistory -Key $exactKey).Count -ne 0) {
  throw "Gateway history matching was relaxed beyond the exact immutable key."
}

$account = "362544434697"
$region = "us-east-2"
$parserOne = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:1"
$parserTwo = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:2"
$processorAddress = "module.platform.aws_lambda_function.document_processor[0]"
function New-ProcessorStateResources {
  param([AllowNull()][object]$Processor)
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  if ($null -ne $Processor) { $resources[$processorAddress] = $Processor }
  return $resources
}
function New-ProcessorResource {
  param([AllowNull()][object]$Environment)
  return [pscustomobject]@{ values = [pscustomobject]@{ environment = $Environment } }
}
function New-ProcessorEnvironment {
  param([AllowNull()][object]$ParserQualifiedArn)
  $environment = [object[]]@([pscustomobject]@{
      variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $ParserQualifiedArn }
    })
  Write-Output -NoEnumerate $environment
}

# Exact retained schema-3 CompleteDark shape: state serial 106, latest parser :2,
# and the deployed processor still invokes the checksum-reviewed parser :1.
$completeDarkHandoff = [pscustomobject]@{
  SchemaVersion = "3"; StateSerial = 106; Stage = "complete-dark"
  ParserQualifiedArn = $parserOne
}
$completeDarkResources = New-ProcessorStateResources `
  (New-ProcessorResource (New-ProcessorEnvironment $parserOne))
if ($completeDarkResources[$processorAddress].values.environment -isnot [array]) {
  throw "The CompleteDark positive fixture must preserve Terraform's JSON array block shape."
}
$completeDarkProcessorPin = Get-StateDocumentProcessorParserQualifiedArn `
  -Resources $completeDarkResources -AccountId $account -Region $region
if ($completeDarkProcessorPin -cne $parserOne) {
  throw "The exact CompleteDark processor parser pin was not extracted from Terraform state."
}
$null = Assert-RetainedGatewayParserBinding -Stage $completeDarkHandoff.Stage `
  -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $completeDarkHandoff.ParserQualifiedArn `
  -StateParserQualifiedArn $parserTwo -StateProcessorParserQualifiedArn $completeDarkProcessorPin `
  -AccountId $account -Region $region

# ParserDark has a deployed parser version but no processor or invocation pin.
$parserDarkResources = New-ProcessorStateResources $null
$parserDarkProcessorPin = Get-StateDocumentProcessorParserQualifiedArn `
  -Resources $parserDarkResources -AccountId $account -Region $region
if (-not [string]::IsNullOrEmpty($parserDarkProcessorPin)) {
  throw "ParserDark unexpectedly acquired a processor parser pin."
}
$null = Assert-RetainedGatewayParserBinding -Stage "parser-dark" `
  -PlanParserQualifiedArn "" -MetadataParserQualifiedArn "" `
  -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn "" `
  -AccountId $account -Region $region

# A CompleteDark handoff may also pin the latest parser version exactly.
$null = Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
  -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $parserOne `
  -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn $parserOne `
  -AccountId $account -Region $region

foreach ($case in @(
    @{ Label = "resource values omitted"; Processor = [pscustomobject]@{} },
    @{ Label = "resource values null"; Processor = [pscustomobject]@{ values = $null } },
    @{ Label = "environment omitted"; Processor = [pscustomobject]@{ values = [pscustomobject]@{} } },
    @{ Label = "environment null"; Processor = New-ProcessorResource $null },
    @{ Label = "environment empty"; Processor = New-ProcessorResource @() },
    @{ Label = "environment scalar"; Processor = [pscustomobject]@{ values = [pscustomobject]@{
          environment = [pscustomobject]@{
            variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne }
          }
        } } },
    @{ Label = "environment multiple"; Processor = New-ProcessorResource @(
        [pscustomobject]@{ variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne } },
        [pscustomobject]@{ variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne } }
      ) },
    @{ Label = "variables omitted"; Processor = New-ProcessorResource @([pscustomobject]@{}) },
    @{ Label = "variables null"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = $null }) },
    @{ Label = "variables scalar"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = "invalid" }) },
    @{ Label = "pin omitted"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = [pscustomobject]@{} }) }
  )) {
  $resources = New-ProcessorStateResources $case.Processor
  Assert-Rejected {
    Get-StateDocumentProcessorParserQualifiedArn -Resources $resources -AccountId $account -Region $region
  } "The processor-state parser extractor accepted $($case.Label)."
}

$invalidPins = @(
  $null, 1, "", " $parserOne", "$parserOne ",
  "arn:aws:lambda:us-east-2:999999999999:function:ai-job-apply-development-document-parser:1",
  "arn:aws:lambda:us-west-2:${account}:function:ai-job-apply-development-document-parser:1",
  "arn:aws:lambda:${region}:${account}:function:other-document-parser:1",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:development",
  'arn:aws:lambda:us-east-2:362544434697:function:ai-job-apply-development-document-parser:$LATEST',
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:0",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:01"
)
foreach ($invalidPin in $invalidPins) {
  $resources = New-ProcessorStateResources `
    (New-ProcessorResource (New-ProcessorEnvironment $invalidPin))
  Assert-Rejected {
    Get-StateDocumentProcessorParserQualifiedArn -Resources $resources -AccountId $account -Region $region
  } "The processor-state parser extractor accepted an invalid parser ARN."
}
foreach ($invalidPin in $invalidPins) {
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
      -PlanParserQualifiedArn $invalidPin -MetadataParserQualifiedArn $invalidPin `
      -StateParserQualifiedArn $parserTwo -StateProcessorParserQualifiedArn $invalidPin `
      -AccountId $account -Region $region
  } "The retained parser binding accepted an invalid retained parser ARN."
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
      -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $parserOne `
      -StateParserQualifiedArn $invalidPin -StateProcessorParserQualifiedArn $parserOne `
      -AccountId $account -Region $region
  } "The retained parser binding accepted an invalid latest parser ARN."
}

foreach ($case in @(
    @{ Label = "CompleteDark processor absent"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserTwo; Processor = "" },
    @{ Label = "CompleteDark processor repinned"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserTwo; Processor = $parserTwo },
    @{ Label = "arbitrary same-family retained pin"; Stage = "complete-dark"; Plan = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:7"; Metadata = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:7"; Latest = $parserTwo; Processor = $parserOne },
    @{ Label = "plan metadata mismatch"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserTwo; Latest = $parserTwo; Processor = $parserOne },
    @{ Label = "ParserDark retained pin"; Stage = "parser-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserOne; Processor = "" },
    @{ Label = "ParserDark processor present"; Stage = "parser-dark"; Plan = ""; Metadata = ""; Latest = $parserOne; Processor = $parserOne },
    @{ Label = "missing latest parser"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = ""; Processor = $parserOne },
    @{ Label = "wrong latest parser family"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = "arn:aws:lambda:${region}:${account}:function:other-document-parser:2"; Processor = $parserOne }
  )) {
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage $case.Stage `
      -PlanParserQualifiedArn $case.Plan -MetadataParserQualifiedArn $case.Metadata `
      -StateParserQualifiedArn $case.Latest -StateProcessorParserQualifiedArn $case.Processor `
      -AccountId $account -Region $region
  } "The retained parser binding accepted $($case.Label)."
}
Assert-Rejected {
  Assert-RetainedGatewayParserBinding -Stage "kms-prerequisite" `
    -PlanParserQualifiedArn "" -MetadataParserQualifiedArn "" `
    -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn "" `
    -AccountId $account -Region $region
} "The retained parser binding accepted an unsupported stage."

foreach ($required in @(
    'ValidateSet("Status", "CaptureBaseline", "Publish", "VerifyPublication", "Plan", "Apply", "Verify")',
    'SourceSha must equal the exact merged main checkout', 'ARTIFACT_SOURCE_SHA',
    'Assert-GatewayPublicationReceipt', 'Assert-GatewayReleaseVariables', 'Assert-ExactGatewayReleasePlan',
    'Assert-RetainedGatewayBaselineMetadata', 'Assert-RetainedGatewayBaselinePlan',
    'lib\development-document-dark-guards.ps1',
    'Get-GatewayKeyHistoryMatches -Result $history -Key $key',
    '$planPath.baseline.json', 'Read-BaselineDocumentReceipt',
    'Assert-GatewayDocumentBaselineReceipt', 'BaselineMetadataSchemaVersion',
    'BaselineMigrationImage',
    'MigrationRepositoryUrl', 'ParserQualifiedArn', 'ProcessorParserQualifiedArn',
    'Get-StateDocumentProcessorParserQualifiedArn', 'Assert-RetainedGatewayParserBinding',
    'Remote state changed after review', 'verify-development-gateway-lambda-boundary.ps1',
    'CodeSha256', 'RELEASE_SHA', '-detailed-exitcode', 'Get-StateIdentity',
    'Assert-RetainedGatewayBaselinePlan $plan $declaredVariables',
    'Remove-Item "Env:$($item.Name)"',
    'gateway_lambda_artifact_s3_object_version', '--if-none-match', 'lambda/gateway/$SourceSha/'
  )) {
  if (-not $operator.Contains($required)) { throw "The gateway release operator is missing '$required'." }
}
if ($operator.Contains('$parserArn -cne [string]$boundary.ParserQualifiedArn')) {
  throw "The gateway operator still conflates the retained processor pin with the latest parser version."
}
$deploymentGuardsOffset = $operator.IndexOf('lib\deployment-operator-guards.ps1', [StringComparison]::Ordinal)
$documentGuardsOffset = $operator.IndexOf('lib\development-document-dark-guards.ps1', [StringComparison]::Ordinal)
$gatewayGuardsOffset = $operator.IndexOf('lib\development-gateway-release-guards.ps1', [StringComparison]::Ordinal)
if ($deploymentGuardsOffset -lt 0 -or $documentGuardsOffset -le $deploymentGuardsOffset -or
    $gatewayGuardsOffset -le $documentGuardsOffset) {
  throw "The gateway operator must load deployment, document-drift, then gateway guards in fail-closed dependency order."
}
foreach ($forbidden in @('terraform destroy', '-target=', 'terraform import', 'serverless_runtime_enabled = "false"')) {
  if ($operator.Contains($forbidden)) { throw "The gateway release operator contains forbidden text '$forbidden'." }
}
if ($operator -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The gateway release operator uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($operator -match '(?m)terraform[^\r\n]*\s-target(?:=|\s)') { throw "The gateway release operator uses resource targeting." }

$buildScript = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\build-gateway-lambda.mjs") -Raw
if (-not $buildScript.Contains('buildLambdaArtifact') -or -not $buildScript.Contains('artifactName: "gateway-lambda"')) {
  throw "The gateway build does not use the shared commit-provenance artifact builder."
}
$workflow = Get-Content -LiteralPath (Join-Path $repositoryRoot ".github\workflows\publish-gateway-lambda.yml") -Raw
foreach ($binding in @('ARTIFACT_SOURCE_SHA: ${{ github.sha }}', '.sourceSha', '$GITHUB_SHA')) {
  if (-not $workflow.Contains($binding)) { throw "The protected gateway publication workflow is missing '$binding'." }
}

$boundaryPath = Join-Path $repositoryRoot "scripts\verify-gateway-lambda-boundary.ps1"
$boundary = Get-Content -LiteralPath $boundaryPath -Raw
[Management.Automation.Language.Parser]::ParseFile($boundaryPath, [ref]$tokens, [ref]$errors) | Out-Null
if (@($errors).Count -ne 0) { throw "The direct gateway verifier does not parse." }
foreach ($case in @(
    'Name = "job-search"', 'Name = "job-search-missing-authorizer"',
    'Name = "job-search-wrong-scope"', 'Name = "job-search-invalid-body"',
    'Name = "job-search-oversized"', 'Name = "job-search-wrong-media-type"',
    'Name = "job-search-wrong-path"', 'Name = "job-search-unexpected-query"',
    'Code = "invalid_request"',
    'SuccessContract = "JobSearchPage"', 'ForbiddenResponseText = $restrictedSearchMarker'
  )) {
  if (-not $boundary.Contains($case)) { throw "The direct verifier is missing '$case'." }
}
if ($boundary -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The direct verifier uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($boundary -match 'Write-(?:Host|Output)[^\r\n]*restrictedSearchMarker') {
  throw "The direct verifier writes the restricted search marker to output."
}

foreach ($wrapperName in @("verify-development-gateway-lambda-boundary.ps1", "verify-staging-gateway-lambda-boundary.ps1")) {
  $wrapperPath = Join-Path $repositoryRoot "scripts\$wrapperName"
  $wrapper = Get-Content -LiteralPath $wrapperPath -Raw
  [Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -ne 0) {
    throw "$wrapperName does not preserve the non-mutating generic verifier interface."
  }
}
$developmentWrapper = Get-Content -LiteralPath `
  (Join-Path $repositoryRoot "scripts\verify-development-gateway-lambda-boundary.ps1") -Raw
if ($developmentWrapper.Contains('exit $LASTEXITCODE') -or
    -not $developmentWrapper.Contains('throw "The development gateway Lambda boundary verification failed."')) {
  throw "The development gateway wrapper can still terminate its parent operator."
}

# Execute the real CaptureBaseline reconstruction/input fragment against synthetic plans.
# No operator entrypoint, Terraform process, receipt file, or cloud service is invoked.
& {
  . (Join-Path $repositoryRoot "scripts/lib/deployment-operator-guards.ps1")
  . (Join-Path $repositoryRoot "scripts/lib/development-document-dark-guards.ps1")
  . (Join-Path $repositoryRoot "scripts/lib/development-gateway-release-guards.ps1")
  foreach ($functionName in @("ConvertTo-GatewayCaptureRestoreFlag", "Get-GatewayCaptureSeedInputs", "Assert-GatewayCapturedSeedInputs",
      "Set-VariablesFromPlan", "Save-AndClearTerraformVariables", "Restore-TerraformVariables")) {
    $definitions = @($ast.FindAll({
          param($node)
          $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
        }, $true))
    if ($definitions.Count -ne 1) { throw "The actual capture helper is missing or duplicated." }
    Invoke-Expression $definitions[0].Extent.Text
  }
  $captureBranches = @($ast.EndBlock.Statements | Where-Object {
      $_ -is [Management.Automation.Language.IfStatementAst] -and
      $_.Clauses[0].Item1.Extent.Text -ceq '$Action -ceq "CaptureBaseline"'
    })
  if ($captureBranches.Count -ne 1) { throw "The exact CaptureBaseline action is unavailable." }
  $captureBranch = $captureBranches[0].Clauses[0].Item2
  $captureTries = @($captureBranch.Statements | Where-Object {
      $_ -is [Management.Automation.Language.TryStatementAst]
    })
  if ($captureTries.Count -ne 1 -or
      $captureTries[0].Body.Statements[0].Extent.Text -cne 'Set-VariablesFromPlan $seed $null' -or
      $captureTries[0].Body.Statements[1] -isnot [Management.Automation.Language.ForEachStatementAst] -or
      $captureTries[0].Body.Statements[1].Condition.Extent.Text -cne '$captureInputs.DefaultVariables.GetEnumerator()') {
    throw "The real CaptureBaseline input reconstruction fragment changed unexpectedly."
  }
  $captureInputFragment = [scriptblock]::Create((@(
        $captureTries[0].Body.Statements[0].Extent.Text,
        $captureTries[0].Body.Statements[1].Extent.Text
      ) -join "`n"))
  foreach ($required in @('$captureInputs = Get-GatewayCaptureSeedInputs $seed $declaredVariables',
      'Assert-RetainedGatewayBaselinePlan $captured $declaredVariables',
      'Assert-GatewayCapturedSeedInputs $seed $captured $declaredVariables',
      '-ReceiptSha256 $ReviewedDocumentReceiptSha256 -Plan $seed',
      '-ReceiptSha256 $ReviewedDocumentReceiptSha256 -Plan $captured')) {
    if (-not $captureBranch.Extent.Text.Contains($required)) { throw "CaptureBaseline omitted a seed/current/receipt boundary." }
  }
  $readBaseline = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Read-Baseline"
      }, $true))[0]
  if ($readBaseline.Extent.Text.Contains("Get-GatewayCaptureSeedInputs") -or
      -not $readBaseline.Extent.Text.Contains('Assert-RetainedGatewayBaselinePlan $plan $declaredVariables')) {
    throw "The historical input exception escaped CaptureBaseline into release/apply baseline validation."
  }

  $restoreFlag = "candidate_deletion_restore_role_enabled"
  $declaredVariables = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "infrastructure/terraform/environments/development") `
      -File -Filter "*.tf" | ForEach-Object {
      [regex]::Matches((Get-Content -LiteralPath $_.FullName -Raw), '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') |
        ForEach-Object { $_.Groups[1].Value }
    })
  if ($declaredVariables -cnotcontains $restoreFlag) { throw "The current source is missing the exact new restore flag." }
  $booleanVariableNames = @(Get-DevelopmentDocumentBooleanVariableNames) + @(
    $restoreFlag,
    "outbox_starts_paused",
    "restricted_answer_vault_enabled",
    "restricted_answer_export_enabled",
    "applications_attempt_recovery_enabled"
  )
  $declaredBooleanNames = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "infrastructure/terraform/environments/development") -File -Filter "*.tf" | ForEach-Object {
      $declarations = [regex]::Matches((Get-Content -LiteralPath $_.FullName -Raw), '(?ms)^variable\s+"([^"]+)"\s*\{(.*?)^\}')
      foreach ($declaration in $declarations) {
        if ($declaration.Groups[2].Value -cmatch '(?m)^\s*type\s*=\s*bool\s*$') { $declaration.Groups[1].Value }
      }
    })
  if (@($booleanVariableNames | Sort-Object -Unique).Count -ne $booleanVariableNames.Count -or
      (@($booleanVariableNames | Sort-Object) -join "|") -cne (@($declaredBooleanNames | Sort-Object) -join "|")) {
    throw "CaptureBaseline's Boolean allowlist must match the actual declared root Boolean inputs."
  }
  $variables = [ordered]@{}
  foreach ($name in $declaredVariables) {
    if ($name -cne $restoreFlag) {
      $value = if ($booleanVariableNames -ccontains $name) { $false } else { "synthetic-$name" }
      $variables[$name] = [pscustomobject]@{ value = $value }
    }
  }
  $variables["serverless_runtime_enabled"] = [pscustomobject]@{ value = $true }
  $variables["candidate_deletion_policy_json"] = [pscustomobject]@{ value = [pscustomobject]@{ synthetic = $true; version = 1 } }
  # Use the source's actual complete inventory without introducing an unrelated fixture name.
  if ($declaredVariables -cnotcontains "candidate_deletion_policy_json") { $variables.Remove("candidate_deletion_policy_json") }
  $historical = [pscustomobject]@{
    terraform_version = "1.9.8"; complete = $true; errored = $false; applyable = $false
    variables = [pscustomobject]$variables; planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{ resources = @() } }
    resource_changes = @([pscustomobject]@{ address = "synthetic.resource"; change = [pscustomobject]@{ actions = @("no-op") } })
    resource_drift = @()
    output_changes = [pscustomobject]@{ synthetic = [pscustomobject]@{ actions = @("no-op") } }
  }
  function Copy-CaptureFixture { param([object]$Value); return $Value | ConvertTo-Json -Depth 50 | ConvertFrom-Json }
  $original = ConvertTo-GatewayCanonicalJson $historical
  $inputs = Get-GatewayCaptureSeedInputs $historical $declaredVariables
  if (($inputs.SeedDeclaredVariableNames -join "|") -cne (@($declaredVariables | Where-Object { $_ -cne $restoreFlag }) -join "|") -or
      $inputs.DefaultVariables.Count -ne 1 -or $inputs.DefaultVariables[$restoreFlag] -isnot [bool] -or
      $inputs.DefaultVariables[$restoreFlag] -ne $false -or (ConvertTo-GatewayCanonicalJson $historical) -cne $original) {
    throw "Historical reconstruction changed retained evidence or did not return the exact false-only overlay."
  }
  $current = Copy-CaptureFixture $historical
  $current.terraform_version = "1.16.2"
  $current.variables | Add-Member -NotePropertyName $restoreFlag -NotePropertyValue ([pscustomobject]@{ value = $false })
  Assert-GatewayCapturedSeedInputs $historical $current $declaredVariables
  foreach ($version in @("1.9.8", "1.16.2")) {
    foreach ($enabled in @($false, $true, "false", "true")) {
      $complete = Copy-CaptureFixture $current
      $complete.terraform_version = $version
      $complete.variables.$restoreFlag.value = $enabled
      $completeInputs = Get-GatewayCaptureSeedInputs $complete $declaredVariables
      if ($completeInputs.DefaultVariables.Count -ne 0) { throw "A complete seed acquired a default overlay." }
      $captured = Copy-CaptureFixture $complete
      $captured.terraform_version = "1.16.2"
      Assert-GatewayCapturedSeedInputs $complete $captured $declaredVariables
      # Native TF_VAR plans retain the raw string, even for a declared bool.
      $captured.variables.$restoreFlag.value = ([string]$enabled).ToLowerInvariant()
      Assert-GatewayCapturedSeedInputs $complete $captured $declaredVariables
      $captured.variables.$restoreFlag.value = -not (ConvertTo-GatewayCaptureRestoreFlag $enabled)
      Assert-Rejected { Assert-GatewayCapturedSeedInputs $complete $captured $declaredVariables } `
        "A boolean representation change silently changed the effective restore flag."
    }
  }
  $rawCurrent = Copy-CaptureFixture $current
  $rawCurrent.variables.$restoreFlag.value = "false"
  Assert-GatewayCapturedSeedInputs $historical $rawCurrent $declaredVariables
  # A retained seed that predates the default-off invoke switch (ADR-031) is reconstructed with the
  # switch off, without relabeling the seed, and a captured baseline may not silently turn it on.
  $tailoringFlag = "document_tailoring_invoke_enabled"
  if ($declaredVariables -cnotcontains $tailoringFlag) { throw "The current source is missing the document tailoring invoke switch." }
  $preSwitch = Copy-CaptureFixture $current
  $preSwitch.variables.PSObject.Properties.Remove($tailoringFlag)
  $preSwitchOriginal = ConvertTo-GatewayCanonicalJson $preSwitch
  $preSwitchInputs = Get-GatewayCaptureSeedInputs $preSwitch $declaredVariables
  if ($preSwitchInputs.DefaultVariables.Count -ne 1 -or $preSwitchInputs.DefaultVariables[$tailoringFlag] -isnot [bool] -or
      $preSwitchInputs.DefaultVariables[$tailoringFlag] -ne $false -or
      $preSwitchInputs.SeedDeclaredVariableNames -ccontains $tailoringFlag -or
      (ConvertTo-GatewayCanonicalJson $preSwitch) -cne $preSwitchOriginal) {
    throw "A seed that predates the invoke switch was not reconstructed with the switch off and untouched evidence."
  }
  $preSwitchCaptured = Copy-CaptureFixture $current
  $preSwitchCaptured.variables.$tailoringFlag.value = "false"
  Assert-GatewayCapturedSeedInputs $preSwitch $preSwitchCaptured $declaredVariables
  $preSwitchCaptured.variables.$tailoringFlag.value = $true
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $preSwitch $preSwitchCaptured $declaredVariables } `
    "A captured baseline silently switched the document tailoring invoke grant on."
  # A retained baseline that predates D3 activation wiring reconstructs only the six exact
  # default-off/empty inputs. The fresh baseline must contain the complete current inventory.
  $d3Defaults = [ordered]@{
    restricted_answer_vault_enabled = $false
    restricted_answer_export_enabled = $false
    applications_attempt_recovery_enabled = $false
    applications_attempt_recovery_artifact_s3_key = ""
    applications_attempt_recovery_artifact_s3_object_version = ""
    applications_attempt_recovery_artifact_sha256 = ""
    applications_attempt_recovery_artifact_base64sha256 = ""
  }
  $preD3 = Copy-CaptureFixture $current
  foreach ($name in $d3Defaults.Keys) { $preD3.variables.PSObject.Properties.Remove($name) }
  $preD3Original = ConvertTo-GatewayCanonicalJson $preD3
  $preD3Inputs = Get-GatewayCaptureSeedInputs $preD3 $declaredVariables
  if ($preD3Inputs.DefaultVariables.Count -ne $d3Defaults.Count -or
      (ConvertTo-GatewayCanonicalJson $preD3) -cne $preD3Original) {
    throw "A pre-D3 baseline was not reconstructed without modifying retained evidence."
  }
  foreach ($entry in $d3Defaults.GetEnumerator()) {
    if ((ConvertTo-GatewayCanonicalJson $preD3Inputs.DefaultVariables[$entry.Key]) -cne
        (ConvertTo-GatewayCanonicalJson $entry.Value)) {
      throw "A pre-D3 baseline acquired an incorrect reconstructed default."
    }
  }
  $preD3Captured = Copy-CaptureFixture $current
  foreach ($entry in $d3Defaults.GetEnumerator()) {
    $preD3Captured.variables.($entry.Key).value = if ($entry.Value -is [bool]) {
      ([string]$entry.Value).ToLowerInvariant()
    } else { $entry.Value }
  }
  Assert-GatewayCapturedSeedInputs $preD3 $preD3Captured $declaredVariables
  $preD3Captured.variables.restricted_answer_vault_enabled.value = $true
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $preD3 $preD3Captured $declaredVariables } `
    "Baseline capture silently enabled the restricted-answer vault."
  $preD3Captured = Copy-CaptureFixture $current
  $preD3Captured.variables.applications_attempt_recovery_artifact_s3_key.value = "unreviewed"
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $preD3 $preD3Captured $declaredVariables } `
    "Baseline capture silently supplied an Applications recovery artifact."
  # Exercise every declared root Boolean in both directions, using actual JSON roundtrips.
  $booleanRoundTrips = 0; $booleanFlips = 0; $invalidBooleanCases = 0
  foreach ($name in $booleanVariableNames) {
    foreach ($value in @($false, $true, "false", "true")) {
      $typedSeed = Copy-CaptureFixture $current
      $typedSeed.variables.$name.value = $value
      $captured = Copy-CaptureFixture $typedSeed
      $captured.variables.$name.value = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
        else { ConvertTo-ExactBoolean $value }
      $typedSeed = Copy-CaptureFixture $typedSeed; $captured = Copy-CaptureFixture $captured
      $seedBefore = ConvertTo-GatewayCanonicalJson $typedSeed
      $capturedBefore = ConvertTo-GatewayCanonicalJson $captured
      Assert-GatewayCapturedSeedInputs $typedSeed $captured $declaredVariables
      if ((ConvertTo-GatewayCanonicalJson $typedSeed) -cne $seedBefore -or
          (ConvertTo-GatewayCanonicalJson $captured) -cne $capturedBefore) {
        throw "Boolean comparison must not modify either native plan."
      }
      $booleanRoundTrips++
      $captured.variables.$name.value = -not (ConvertTo-ExactBoolean $value)
      Assert-Rejected { Assert-GatewayCapturedSeedInputs $typedSeed $captured $declaredVariables } `
        "CaptureBaseline accepted an effective Boolean change for $name."
      $booleanFlips++
    }
  }
  $ingestionFlags = @("deploy_ingestion_runtime", "ingestion_provider_activation_allowed", "ingestion_provider_private_egress",
    "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled")
  $invalidBooleanInputs = @($null, "False", "True", " false", "false ", "0", "1", "yes", "", 0, 1, [pscustomobject]@{}, [object[]]@($false))
  foreach ($name in @($ingestionFlags + @($restoreFlag, "outbox_starts_paused"))) {
    foreach ($invalid in $invalidBooleanInputs) {
      $badSeed = Copy-CaptureFixture $current; $badSeed.variables.$name.value = $invalid
      $badCaptured = Copy-CaptureFixture $current; $badCaptured.variables.$name.value = $invalid
      Assert-Rejected { Assert-GatewayCapturedSeedInputs $badSeed $current $declaredVariables } `
        "CaptureBaseline accepted a malformed retained Boolean for $name."
      Assert-Rejected { Assert-GatewayCapturedSeedInputs $current $badCaptured $declaredVariables } `
        "CaptureBaseline accepted a malformed captured Boolean for $name."
      Assert-Rejected { Assert-GatewayCapturedSeedInputs $badSeed $badCaptured $declaredVariables } `
        "Matching malformed Boolean values escaped exact conversion for $name."
      $invalidBooleanCases += 3
    }
  }
  # Reproduce the five ingestion inputs through the real capture serialization fragment.
  $saved = Save-AndClearTerraformVariables
  try {
    $seed = Copy-CaptureFixture $current
    foreach ($name in $ingestionFlags) { $seed.variables.$name.value = $name -ceq "deploy_ingestion_runtime" }
    $seedBefore = ConvertTo-GatewayCanonicalJson $seed
    $captureInputs = Get-GatewayCaptureSeedInputs $seed $declaredVariables
    & $captureInputFragment
    $captured = Copy-CaptureFixture $seed
    foreach ($name in $ingestionFlags) {
      $value = [Environment]::GetEnvironmentVariable("TF_VAR_$name", "Process")
      $expectedText = if ($name -ceq "deploy_ingestion_runtime") { "true" } else { "false" }
      if ($value -isnot [string] -or $value -cne $expectedText) { throw "The native-input regression lost the exact ingestion flag serialization." }
      $captured.variables.$name.value = $value
    }
    $captured = Copy-CaptureFixture $captured
    Assert-GatewayCapturedSeedInputs $seed $captured $declaredVariables
    if ((ConvertTo-GatewayCanonicalJson $seed) -cne $seedBefore) { throw "CaptureBaseline altered the verified ingestion seed." }
  } finally { Restore-TerraformVariables $saved }
  # A Boolean-looking string, number, composite, or nested member is not a root Boolean.
  foreach ($case in @(
      @{ Name = "oidc_audience"; Before = "false"; After = $false },
      @{ Name = "ingestion_synthetic_seed"; Before = "true"; After = $true },
      @{ Name = "database_backup_retention_days"; Before = 1; After = "1" },
      @{ Name = "candidate_document_cors_allowed_origins"; Before = @("false"); After = '["false"]' },
      @{ Name = "d2_community_runtime"; Before = [pscustomobject]@{ maintenance_mode = $false }; After = [pscustomobject]@{ maintenance_mode = "false" } }
    )) {
    if ($booleanVariableNames -ccontains $case.Name -or $declaredVariables -cnotcontains $case.Name) {
      throw "A non-Boolean regression fixture is not a declared non-Boolean input."
    }
    $nonBooleanSeed = Copy-CaptureFixture $current; $nonBooleanSeed.variables.($case.Name).value = $case.Before
    $nonBooleanCaptured = Copy-CaptureFixture $nonBooleanSeed; $nonBooleanCaptured.variables.($case.Name).value = $case.After
    Assert-Rejected { Assert-GatewayCapturedSeedInputs $nonBooleanSeed $nonBooleanCaptured $declaredVariables } `
      "CaptureBaseline coerced an unrelated non-Boolean input."
  }
  Write-Output ("CaptureBaseline Boolean regressions passed: {0} declared flags, {1} representation roundtrips, {2} effective flips rejected, {3} malformed-input cases rejected, five native ingestion serializations, five strict non-Boolean cases." -f
    $booleanVariableNames.Count, $booleanRoundTrips, $booleanFlips, $invalidBooleanCases)
  foreach ($invalid in @($null, "False", "True", " false", "false ", "0", "1", "yes", "", 0, 1, [pscustomobject]@{}, [object[]]@($false))) {
    $bad = Copy-CaptureFixture $current
    $bad.variables.$restoreFlag.value = $invalid
    Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "A nonboolean restore-role seed value was accepted."
  }
  $bad = Copy-CaptureFixture $current
  $bad.variables.$restoreFlag.PSObject.Properties.Remove("value")
  Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "A restore-role wrapper without a value was accepted."
  foreach ($version in @("1.16.2", "1.9.7", "1.16.1", "1.9.8 ")) {
    $bad = Copy-CaptureFixture $historical
    $bad.terraform_version = $version
    Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "An unapproved missing-flag seed was accepted."
  }
  $otherName = @($declaredVariables | Where-Object { $_ -cne $restoreFlag })[0]
  $bad = Copy-CaptureFixture $historical
  $bad.variables.PSObject.Properties.Remove($otherName)
  Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "An unrelated missing seed variable was accepted."
  $bad = Copy-CaptureFixture $historical
  $bad.variables | Add-Member -NotePropertyName "unrelated_variable" -NotePropertyValue ([pscustomobject]@{ value = $false })
  Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "An unrelated extra seed variable was accepted."
  $bad = Copy-CaptureFixture $historical
  $bad.resource_changes[0].change.actions = @("update")
  Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "A changing historical resource was accepted."
  $bad = Copy-CaptureFixture $historical
  $bad.output_changes.synthetic.actions = @("update")
  Assert-Rejected { Get-GatewayCaptureSeedInputs $bad $declaredVariables } "A changing historical output was accepted."
  Assert-Rejected { Assert-RetainedGatewayBaselinePlan $historical $declaredVariables } `
    "The general retained/release baseline guard accepted the incomplete historical input set."
  foreach ($name in $declaredVariables) {
    $bad = Copy-CaptureFixture $current
    $bad.variables.$name.value = "changed-synthetic-value"
    Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } `
      "The captured baseline silently changed a retained or reconstructed input."
  }
  foreach ($value in @($true, $null, "true", "False", [object[]]@($false))) {
    $bad = Copy-CaptureFixture $current
    $bad.variables.$restoreFlag.value = $value
    Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } `
      "The captured historical-upgrade baseline did not retain exact effective boolean false."
  }
  $bad = Copy-CaptureFixture $current
  $bad.variables.PSObject.Properties.Remove($restoreFlag)
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } "The fresh baseline omitted the new input."
  $bad = Copy-CaptureFixture $current
  $bad.variables.PSObject.Properties.Remove($otherName)
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } "The fresh baseline omitted another retained input."
  $bad = Copy-CaptureFixture $current
  $bad.variables | Add-Member -NotePropertyName "unrelated_variable" -NotePropertyValue ([pscustomobject]@{ value = $false })
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } "The fresh baseline added an unrelated input."
  $bad = Copy-CaptureFixture $current
  $bad.resource_changes[0].change.actions = @("update")
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } "The fresh baseline contained a meaningful resource change."
  $bad = Copy-CaptureFixture $current
  $bad.terraform_version = "1.9.8"
  Assert-Rejected { Assert-GatewayCapturedSeedInputs $historical $bad $declaredVariables } "The fresh baseline used the historical CLI."

  $saved = Save-AndClearTerraformVariables
  try {
    foreach ($fixture in @($historical, $current, $complete)) {
      $seed = Copy-CaptureFixture $fixture
      $before = ConvertTo-GatewayCanonicalJson $seed
      $captureInputs = Get-GatewayCaptureSeedInputs $seed $declaredVariables
      $env:TF_VAR_candidate_deletion_restore_role_enabled = "unreviewed-ambient-value"
      & $captureInputFragment
      $expected = if ($captureInputs.DefaultVariables.Count -eq 1) { "false" }
        else { ([string]$seed.variables.$restoreFlag.value).ToLowerInvariant() }
      if ($env:TF_VAR_candidate_deletion_restore_role_enabled -cne $expected -or
          $env:TF_VAR_serverless_runtime_enabled -cne "true" -or
          (ConvertTo-GatewayCanonicalJson $seed) -cne $before) {
        throw "The actual capture input fragment changed retained seed data or omitted the explicit flag value."
      }
    }
  } finally { Restore-TerraformVariables $saved }
}


# ---- Document processor and parser refresh (ADR-031): opt-in, receipt-bound, and threaded through every plan.
$readerFunction = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Get-VerifiedDocumentArtifact"
    }, $true))
if ($readerFunction.Count -ne 1) { throw "The document artifact receipt reader must be defined exactly once." }
$refreshText = $readerFunction[0].Extent.Text
foreach ($required in @(
    '$Action -notin @("Plan", "Apply", "Verify")',
    'development-document-artifacts',
    'Get-GatewayProcessorArtifact -Receipt $receipt -SourceSha $SourceSha -Kind $Kind',
    '$boundary.BoundarySha256',
    '"--checksum-mode", "ENABLED"',
    '[string]$stored.Metadata."source-sha" -cne $SourceSha',
    '[string]$stored.ServerSideEncryption -cne "aws:kms"')) {
  if (-not $refreshText.Contains($required)) { throw "The document artifact receipt reader is missing '$required'." }
}
$selectorFunction = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Read-DocumentRefreshArtifacts"
    }, $true))
if ($selectorFunction.Count -ne 1 -or
    -not $selectorFunction[0].Extent.Text.Contains('if ($RefreshDocumentProcessor) { Get-VerifiedDocumentArtifact -Kind processor } else { $null }') -or
    -not $selectorFunction[0].Extent.Text.Contains('if ($RefreshDocumentParser) { Get-VerifiedDocumentArtifact -Kind parser } else { $null }')) {
  throw "Each document artifact must be read only when its own refresh switch is set."
}
if ($operator.IndexOf('$baseline = Read-Baseline') -lt 0 -or
    $operator.IndexOf('$documentArtifacts = Read-DocumentRefreshArtifacts') -lt $operator.IndexOf('$baseline = Read-Baseline')) {
  throw "The document refresh artifacts must be read after the retained baseline."
}
# Every release path that builds or checks a plan must carry the same verified artifacts.
$carried = '-ProcessorArtifact $documentArtifacts.Processor -ParserArtifact $documentArtifacts.Parser'
foreach ($needle in @(
    "Assert-ExactGatewayReleasePlan `$reviewedPlan `$publication.Artifact -ExpectedAccountId `$ExpectedAccountId $carried",
    "Assert-ExactGatewayReleasePlan `$plan `$publication.Artifact -ExpectedAccountId `$ExpectedAccountId $carried",
    "Invoke-ZeroDrift `$baseline `$publication.Artifact -EnableTailoringInvoke:`$EnableDocumentTailoringInvoke $carried",
    "Set-VariablesFromPlan `$baseline.Plan `$publication.Artifact -EnableTailoringInvoke:`$EnableDocumentTailoringInvoke $carried")) {
  if (-not $operator.Contains($needle)) { throw "A release path does not carry the verified document artifacts: $needle" }
}
if (([regex]::Matches($operator, [regex]::Escape($carried))).Count -lt 9) {
  throw "The variable and plan guards must each receive the verified document artifacts."
}
# CaptureBaseline never takes the document artifacts: it only reconstructs retained inputs.
$captureSetCall = [regex]::Match($operator, 'Set-VariablesFromPlan \$seed \$null[^\r\n]*')
if (-not $captureSetCall.Success -or $captureSetCall.Value.Contains("Artifact") -or $captureSetCall.Value.Contains("Tailoring")) {
  throw "CaptureBaseline must not apply a document refresh or the invoke switch."
}
$threeSnapshotGate = [regex]::Match($operator, 'if \(\$Action -ceq "Verify" -and \$RefreshCandidateRightsActivity -and \$EnableRestrictedAnswerExport -and\s+\[long\]\$state.Serial -eq \(\[long\]\$metadata.StateSerial \+ 3\)\) \{(?<body>[\s\S]*?)\n  \}')
if (-not $threeSnapshotGate.Success) { throw "The exact export history exception is not isolated to activation Verify at three advances." }
foreach ($required in @(
    'Assert-ExactRestrictedExportThreeSnapshotVerification', '-SourceSha $SourceSha',
    '-ReceiptSha256 $ReviewedWorkflowReceiptSha256', '-BaselineSha256 $ReviewedBaselineSha256',
    '-BaselineMetadataSha256 $ReviewedBaselineMetadataSha256', '-PlanSha256 $ReviewedPlanSha256',
    '-PlanMetadataSha256 (Get-FileSha256 $activityMetadataPath)', '-Metadata $metadata -CurrentState $state -StateHistory $stateHistory',
    '"--max-items", "2000"', '"--prefix", "platform.tfstate"'
  )) {
  if (-not $threeSnapshotGate.Groups['body'].Value.Contains($required)) { throw "The exact export recovery gate omits $required." }
}
if (-not $operator.Contains('$allowThreeSerialAdvances = $false') -or
    ([regex]::Matches($operator, [regex]::Escape('-AllowThreeSerialAdvances:$allowThreeSerialAdvances'))).Count -ne 2) {
  throw "Both baseline readers must receive only the verified three-snapshot recovery result."
}
# Execute the actual recovery branch under a function-local baseline $planPath, exactly the
# scope that shadowed the script's release-plan parameter in production.
$script:PlanPath = "generated-release.tfplan"
$script:expectedActivityMetadataPath = "$script:PlanPath.candidate-rights-activity.json"
$script:recoveryBranch = [scriptblock]::Create($threeSnapshotGate.Value)
$candidateRightsActivityMetadataSuffix = ".candidate-rights-activity.json"
$SourceSha = "4c557c35e18647ffd106fe754dc84394b59e9370"
$ReviewedWorkflowReceiptSha256 = "d2e18359f0e74858b72e9ac6424e2fce70d672d5efd2f4417abaaf82bc71df58"
$ReviewedBaselineSha256 = "46640629f435ccf0b20953f8f272f132d698de471e534b7dd9f992720fc4956a"
$ReviewedBaselineMetadataSha256 = "f88b7b755f9256d7e56e96ce084d885d21db4419858f3e3a55a128e2a2d831cc"
$ReviewedPlanSha256 = "c8b77d18b4e63e20081bb9bb26ffd692b64315930033e718035401903550420e"
$StateBucket = "generated-state-bucket"
function Resolve-GatewayOperatorPath {
  param([string]$Candidate, [switch]$MustExist)
  if (-not $MustExist -or $Candidate -cnotin @($script:PlanPath, $script:expectedActivityMetadataPath)) {
    throw "The recovery branch resolved the baseline instead of the release plan."
  }
  return $Candidate
}
function Invoke-AwsJson { param([string[]]$Arguments, [string]$Operation); return [pscustomobject]@{} }
function Get-FileSha256 {
  param([string]$Path)
  if ($Path -cne $script:expectedActivityMetadataPath) { throw "The recovery branch hashed the wrong sidecar." }
  return "d50a7362e06a2fe0c1ba5eae5906ad9e16896cb90558979a24a59cfb155758b9"
}
$script:exactRecoveryChecks = 0
function Assert-ExactRestrictedExportThreeSnapshotVerification {
  param([string]$SourceSha, [string]$ReceiptSha256, [string]$BaselineSha256, [string]$BaselineMetadataSha256,
    [string]$PlanSha256, [string]$PlanMetadataSha256, [object]$Metadata, [object]$CurrentState, [object]$StateHistory)
  if ($PlanMetadataSha256 -cne "d50a7362e06a2fe0c1ba5eae5906ad9e16896cb90558979a24a59cfb155758b9" -or
      $Metadata.StateSerial -ne 395 -or $CurrentState.Serial -ne 398) { throw "Wrong recovery branch inputs." }
  $script:exactRecoveryChecks++
  return $true
}
function Invoke-ShadowedRecoveryBranch {
  $planPath = "generated-baseline.tfplan"
  $metadata = [pscustomobject]@{ StateSerial = 395 }
  $state = [pscustomobject]@{ Serial = 398 }
  $allowThreeSerialAdvances = $false
  . $script:recoveryBranch
  return $allowThreeSerialAdvances
}
$Action = "Verify"; $RefreshCandidateRightsActivity = $true; $EnableRestrictedAnswerExport = $true
if (-not (Invoke-ShadowedRecoveryBranch) -or $script:exactRecoveryChecks -ne 1) {
  throw "The actual recovery branch did not use the script-scoped release input."
}
foreach ($mode in @("Apply", "Plan")) {
  $Action = $mode
  if (Invoke-ShadowedRecoveryBranch) { throw "The recovery branch ran outside Verify." }
}
$Action = "Verify"
foreach ($flag in @("RefreshCandidateRightsActivity", "EnableRestrictedAnswerExport")) {
  Set-Variable $flag $false
  if (Invoke-ShadowedRecoveryBranch) { throw "Recovery ran without both activation-mode switches." }
  Set-Variable $flag $true
}
if ($script:exactRecoveryChecks -ne 1) { throw "A non-verification path reached the historical recovery guard." }

$activitySnapshotGate = [regex]::Match($operator, 'if \(\$Action -ceq "Verify" -and \$RefreshCandidateRightsActivity -and -not \$EnableRestrictedAnswerExport -and\s+\[long\]\$state.Serial -eq \(\[long\]\$metadata.StateSerial \+ 3\)\) \{(?<body>[\s\S]*?)\n  \}')
if (-not $activitySnapshotGate.Success) { throw "Activity history recovery is not isolated to non-activation Verify." }
foreach ($required in @('Assert-ExactActivityRefreshThreeSnapshotVerification', '$script:PlanPath', '-SourceSha $SourceSha', '-ReceiptSha256 $ReviewedWorkflowReceiptSha256', '-BaselineSha256 $ReviewedBaselineSha256', '-BaselineMetadataSha256 $ReviewedBaselineMetadataSha256', '-PlanSha256 $ReviewedPlanSha256', '-PlanMetadataSha256 (Get-FileSha256 $activityMetadataPath)', '-Metadata $metadata -CurrentState $state -StateHistory $stateHistory', '"--max-items", "2000"', '"--prefix", "platform.tfstate"')) {
  if (-not $activitySnapshotGate.Value.Contains($required)) { throw "Activity recovery omits $required." }
}
$script:activityRecoveryBranch = [scriptblock]::Create($activitySnapshotGate.Value)
$script:activityRecoveryChecks = 0
function Assert-ExactActivityRefreshThreeSnapshotVerification {
  param([string]$SourceSha, [string]$ReceiptSha256, [string]$BaselineSha256, [string]$BaselineMetadataSha256,
    [string]$PlanSha256, [string]$PlanMetadataSha256, [object]$Metadata, [object]$CurrentState, [object]$StateHistory)
  if ($PlanMetadataSha256 -cne "d50a7362e06a2fe0c1ba5eae5906ad9e16896cb90558979a24a59cfb155758b9" -or
      $Metadata.StateSerial -ne 401 -or $CurrentState.Serial -ne 404 -or
      $SourceSha -cne $script:SourceSha -or $ReceiptSha256 -cne $script:ReviewedWorkflowReceiptSha256 -or
      $BaselineSha256 -cne $script:ReviewedBaselineSha256 -or $BaselineMetadataSha256 -cne $script:ReviewedBaselineMetadataSha256 -or
      $PlanSha256 -cne $script:ReviewedPlanSha256) { throw "Wrong activity recovery inputs." }
  $script:activityRecoveryChecks++
  return $true
}
function Invoke-ShadowedActivityRecoveryBranch {
  $planPath = "generated-baseline.tfplan"
  $metadata = [pscustomobject]@{ StateSerial = 401 }
  $state = [pscustomobject]@{ Serial = 404 }
  $allowThreeSerialAdvances = $false
  $allowActivityThreeSerialAdvances = $false
  . $script:activityRecoveryBranch
  if ($allowThreeSerialAdvances -ne $allowActivityThreeSerialAdvances) { throw "Activity baseline readers disagree on history evidence." }
  return $allowActivityThreeSerialAdvances
}
$EnableRestrictedAnswerExport = $false
if (-not (Invoke-ShadowedActivityRecoveryBranch) -or $script:activityRecoveryChecks -ne 1) { throw "Activity recovery resolved a shadowed baseline path." }
foreach ($mode in @("Apply", "Plan", "Status")) {
  $Action = $mode
  if (Invoke-ShadowedActivityRecoveryBranch) { throw "Activity recovery ran outside Verify." }
}
$Action = "Verify"
$EnableRestrictedAnswerExport = $true
if (Invoke-ShadowedActivityRecoveryBranch) { throw "Activity recovery ran during export activation." }
$EnableRestrictedAnswerExport = $false
$RefreshCandidateRightsActivity = $false
if (Invoke-ShadowedActivityRecoveryBranch) { throw "Activity recovery ran for another operation." }
$RefreshCandidateRightsActivity = $true
$EnableRestrictedAnswerExport = $true
if ($script:activityRecoveryChecks -ne 1) { throw "Unrelated modes reached activity history validation." }
$postStateFunction = @($ast.FindAll({ param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Assert-CandidateRightsActivityPostApplyState"
    }, $true))
if ($postStateFunction.Count -ne 1 -or
    -not $operator.Contains('Assert-CandidateRightsActivityPostApplyState -Baseline $baseline -Metadata $metadata -State $state') -or
    -not $operator.Contains('RestrictedExportRecoveryState = $(if ($allowThreeSerialAdvances -and -not $allowActivityThreeSerialAdvances)')) {
  throw "The final activity check must consume only the exact baseline recovery result."
}
Invoke-Expression $postStateFunction[0].Extent.Text
$recoveryLineage = "12345678-1234-1234-1234-123456789abc"
$recoveryMetadata = [pscustomobject]@{ StateSerial = 395; StateLineage = $recoveryLineage }
$recoveryState = [pscustomobject]@{ Serial = 398; Lineage = $recoveryLineage }
$recoveryBaseline = [pscustomobject]@{ RestrictedExportRecoveryState = $recoveryState }
Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata $recoveryState
Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{}) $recoveryMetadata ([pscustomobject]@{ Serial = 396; Lineage = $recoveryLineage })
foreach ($serial in @(395, 397, 399)) {
  Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata ([pscustomobject]@{ Serial = $serial; Lineage = $recoveryLineage }) } "Final recovery accepted another serial."
}
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{}) $recoveryMetadata $recoveryState } "Final recovery accepted missing history validation."
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{ RestrictedExportRecoveryState = $true }) $recoveryMetadata $recoveryState } "Final recovery accepted malformed evidence."
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata ([pscustomobject]@{ Serial = 398; Lineage = "87654321-4321-4321-4321-cba987654321" }) } "Final recovery accepted another lineage."
foreach ($flag in @("RefreshCandidateRightsActivity", "EnableRestrictedAnswerExport")) {
  Set-Variable $flag $false
  Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata $recoveryState } "Final recovery accepted missing activation mode."
  Set-Variable $flag $true
}
$SourceSha = "0" * 40
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata $recoveryState } "Final recovery accepted another release source."
$SourceSha = "4c557c35e18647ffd106fe754dc84394b59e9370"
$Action = "Apply"
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $recoveryBaseline $recoveryMetadata $recoveryState } "Final recovery weakened Apply's exact-state rule."
$activityBranches = @($ast.FindAll({ param($node)
      $node -is [Management.Automation.Language.IfStatementAst] -and
      $node.Clauses[0].Item1.Extent.Text -ceq '$RefreshCandidateRightsActivity'
    }, $true))
if ($activityBranches.Count -ne 1) { throw "The activity command branch must be unique." }
$activityBody = $activityBranches[0].Clauses[0].Item2
# Execute the real command branch, including metadata/artifact/state/live/drift ordering. Omit
# only its terminal process exit so that this test process can inspect the result and refusals.
$script:activityCommand = [scriptblock]::Create((@($activityBody.Statements | Where-Object {
        $_ -isnot [Management.Automation.Language.ExitStatementAst]
      } | ForEach-Object { $_.Extent.Text }) -join "`n"))
$Action = "Verify"
$DocumentScanActivation = "None"; $DocumentUploadCorsOrigin = ""
$RefreshDocumentProcessor = $false; $RefreshDocumentParser = $false; $EnableDocumentTailoringInvoke = $false
$ReceiptPath = ""; $DocumentReceiptPath = ""
$ExpectedAccountId = "111122223333"; $Region = "us-east-2"
$script:commandState = $recoveryState
$script:commandBaseline = [pscustomobject]@{
  MetadataSchemaVersion = "7"; RestrictedExportRecoveryState = $recoveryState
  Plan = [pscustomobject]@{ variables = [pscustomobject]@{} }
}
$script:activityCalls = [Collections.Generic.List[string]]::new()
function Read-Baseline { $script:activityCalls.Add("baseline"); return $script:commandBaseline }
function Get-VerifiedWorkflowActivityArtifact { $script:activityCalls.Add("artifact"); return [pscustomobject]@{ artifactSha256 = "a" * 64 } }
function Test-Path { param([string]$LiteralPath, [string]$PathType); return $LiteralPath -ceq $script:expectedActivityMetadataPath }
function Get-FileSha256 {
  param([string]$Path)
  if ($Path -cne $script:PlanPath) { throw "The activity command resolved a different release plan." }
  return $ReviewedPlanSha256
}
function Get-Content {
  param([string]$LiteralPath, [switch]$Raw)
  if ($LiteralPath -cne $script:expectedActivityMetadataPath -or -not $Raw) { throw "Wrong activity metadata path." }
  return $recoveryMetadata | ConvertTo-Json -Compress
}
function Get-CandidateRightsActivityExpectedMetadata { param($Baseline, $Artifact, $Path, $Hash); return $recoveryMetadata }
function Assert-ReviewedPlanMetadata { param($Metadata, $Expected); $script:activityCalls.Add("metadata") }
function Get-StateIdentity { $script:activityCalls.Add("fresh-state"); return $script:commandState }
function Read-Plan { param($Path); return [pscustomobject]@{ variables = [pscustomobject]@{} } }
function Assert-CandidateRightsActivityVariables { param($Before, $After, $Artifact, [switch]$EnableRestrictedAnswerExport); $script:activityCalls.Add("variables") }
function Assert-ExactCandidateRightsActivityPlan { param($Plan, $Artifact, [switch]$EnableRestrictedAnswerExport); $script:activityCalls.Add("plan") }
function Assert-CandidateRightsActivityLive { param($Artifact, $Plan); $script:activityCalls.Add("live") }
function Invoke-CandidateRightsActivityZeroDrift { param($Baseline, $Artifact); $script:activityCalls.Add("zero-drift"); return "b" * 64 }
function terraform { throw "The generated verification test must never dispatch Terraform apply or plan." }
$result = & $script:activityCommand | ConvertFrom-Json
if ($result.Outcome -cne "verified" -or $result.LiveState -cne "matches" -or $result.Drift -isnot [bool] -or $result.Drift -or
    ($script:activityCalls -join "|") -cne "baseline|artifact|metadata|fresh-state|variables|plan|live|zero-drift") {
  throw "The actual activity command did not reach live and zero-drift checks after exact recovery."
}
$script:commandBaseline.RestrictedExportRecoveryState = $null
$script:activityCalls.Clear()
Assert-Rejected { & $script:activityCommand } "The actual activity command accepted missing recovery evidence."
if ($script:activityCalls.Contains("live") -or $script:activityCalls.Contains("zero-drift")) {
  throw "The activity command continued after missing history validation."
}
$script:commandBaseline.RestrictedExportRecoveryState = $recoveryState
$script:commandState = [pscustomobject]@{ Serial = 399; Lineage = $recoveryLineage }
$script:activityCalls.Clear()
Assert-Rejected { & $script:activityCommand } "The actual activity command accepted a state advance after history validation."
if ($script:activityCalls.Contains("live") -or $script:activityCalls.Contains("zero-drift")) {
  throw "The activity command continued after stale history validation."
}
$script:commandBaseline.RestrictedExportRecoveryState = $null
$script:commandState = [pscustomobject]@{ Serial = 396; Lineage = $recoveryLineage }
$ordinary = & $script:activityCommand | ConvertFrom-Json
if ($ordinary.Outcome -cne "verified") { throw "Ordinary one-advance activity verification regressed." }
$SourceSha = "7aec47235e7de0ad5708a72aebe06a55ee8fc71a"
$EnableRestrictedAnswerExport = $false
$activityRecoveryMetadata = [pscustomobject]@{ StateSerial = 401; StateLineage = $recoveryLineage }
$activityRecoveryState = [pscustomobject]@{ Serial = 404; Lineage = $recoveryLineage }
$activityRecoveryBaseline = [pscustomobject]@{ ActivityRefreshRecoveryState = $activityRecoveryState }
Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata $activityRecoveryState
Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{}) $activityRecoveryMetadata ([pscustomobject]@{ Serial = 402; Lineage = $recoveryLineage })
foreach ($serial in @(401, 403, 405)) {
  Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata ([pscustomobject]@{ Serial = $serial; Lineage = $recoveryLineage }) } "Activity recovery accepted another serial."
}
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{}) $activityRecoveryMetadata $activityRecoveryState } "Activity recovery accepted missing history evidence."
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState ([pscustomobject]@{ ActivityRefreshRecoveryState = $true }) $activityRecoveryMetadata $activityRecoveryState } "Activity recovery accepted malformed evidence."
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata ([pscustomobject]@{ Serial = 404; Lineage = "87654321-4321-4321-4321-cba987654321" }) } "Activity recovery accepted another lineage."
$EnableRestrictedAnswerExport = $true
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata $activityRecoveryState } "Activity recovery accepted activation mode."
$EnableRestrictedAnswerExport = $false
$RefreshCandidateRightsActivity = $false
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata $activityRecoveryState } "Activity recovery accepted another command."
$RefreshCandidateRightsActivity = $true
$SourceSha = "0" * 40
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata $activityRecoveryState } "Activity recovery accepted another source."
$SourceSha = "7aec47235e7de0ad5708a72aebe06a55ee8fc71a"
$Action = "Apply"
Assert-Rejected { Assert-CandidateRightsActivityPostApplyState $activityRecoveryBaseline $activityRecoveryMetadata $activityRecoveryState } "Activity recovery weakened Apply."
$Action = "Verify"
$recoveryMetadata = $activityRecoveryMetadata
$script:commandBaseline = [pscustomobject]@{ MetadataSchemaVersion = "7"; ActivityRefreshRecoveryState = $activityRecoveryState; Plan = [pscustomobject]@{ variables = [pscustomobject]@{} } }
$script:commandState = $activityRecoveryState
$script:activityCalls.Clear()
$activityResult = & $script:activityCommand | ConvertFrom-Json
if ($activityResult.Outcome -cne "verified" -or ($script:activityCalls -join "|") -cne "baseline|artifact|metadata|fresh-state|variables|plan|live|zero-drift") { throw "Activity recovery skipped live/drift verification." }
$script:commandBaseline.ActivityRefreshRecoveryState = $null
$script:activityCalls.Clear()
Assert-Rejected { & $script:activityCommand } "Activity command accepted missing history validation."
if ($script:activityCalls.Contains("live")) { throw "Activity command continued after missing recovery evidence." }
$script:commandBaseline.ActivityRefreshRecoveryState = $activityRecoveryState
$script:commandState = [pscustomobject]@{ Serial = 405; Lineage = $recoveryLineage }
$script:activityCalls.Clear()
Assert-Rejected { & $script:activityCommand } "Activity command accepted state movement after history validation."
if ($script:activityCalls.Contains("live")) { throw "Activity command continued after stale recovery evidence." }
$corsBranches = @($ast.FindAll({ param($node)
      $node -is [Management.Automation.Language.IfStatementAst] -and
      $node.Clauses[0].Item1.Extent.Text -ceq '$DocumentUploadCorsOrigin -cne ""'
    }, $true))
if ($corsBranches.Count -ne 1 -or $corsBranches[0].Extent.Text.Contains("Assert-CandidateRightsActivityPostApplyState") -or
    -not $corsBranches[0].Extent.Text.Contains('[long]$state.Serial -ne ([long]$metadata.StateSerial + 1)') -or
    -not $activityBody.Extent.Text.Contains('Assert-CandidateRightsActivityPostApplyState -Baseline $baseline -Metadata $metadata -State $state')) {
  throw "The exact recovery helper must belong only to the activity command, never CORS."
}
Write-Output "Actual recovery scope, final state flow, and full activity Verify command passed (generated native boundaries; zero cloud calls)."
Write-Output "Development gateway release operator, capture-input reconstruction, and search-boundary tests passed."
