Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-dark-deployment.ps1"
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The staged document operator does not parse: $($errors.Message -join '; ')." }

foreach ($required in @(
    '[ValidateSet("KmsPrerequisite", "ParserDark", "CompleteDark")]',
    'StateLineage = $stateIdentity.Lineage', 'StateSerial = $stateIdentity.Serial',
    'Get-AppliedParserQualifiedArn', 'Assert-MonotonicDocumentStage',
    'ParserQualifiedArn = $parserQualifiedArn', 'Assert-LiveStageBoundary',
    'Assert-LiveParserDarkBoundary -Receipt $Receipt', 'Assert-LiveDarkBoundary -Receipt $Receipt',
    'Get-LiveDocumentStageInventory', 'Assert-DevelopmentDocumentStageResourceInventory',
    'Assert-NoLambdaResourcePolicy', 'Assert-ExactProcessorLambdaResourcePolicy',
    'Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $plan',
    'Save-RetainedBaselineMetadata', 'BaselinePath = $retainedBaseline.PlanPath',
    'Use verified development $stageValue migration baseline',
    'ReviewedBaselineMetadataSha256',
    '$metadataSha256 -cne $ReviewedBaselineMetadataSha256'
    'ReviewedBaselineToOperatorDeltaSha256', 'Assert-CompleteDarkTransitionBaselineMetadata',
    'ParserSourceTransition = [bool]$parserSourceTransition',
    'Assert-LivePinnedParserVersion', 'MustMatchBaselineArtifact',
    '-Retain:($Stage -ceq "CompleteDark")',
    '$result.BaselineMetadataSha256 = $postApplyBaseline.MetadataSha256',
    'Plan and Apply require the exact current release', 'SchemaVersion = "2"', '$planMetadata.Commit = $operatorCommit'
  )) {
  if (-not $source.Contains($required)) { throw "The staged operator is missing '$required'." }
}
foreach ($forbidden in @(
    'PlanPrerequisite', 'ApplyPrerequisite', 'VerifyPrerequisite',
    'TF_VAR_deploy_document_processing', 'TF_VAR_document_processing_kms_prerequisite_enabled'
  )) {
  if ($source.Contains($forbidden)) { throw "The staged operator retains forbidden text '$forbidden'." }
}
if ($source -match '(?m)terraform[^\r\n]*\s-target(?:=|\s)') { throw "The staged operator uses Terraform resource targeting." }
if ($source -notmatch 'document_scan_mapping_enabled\s*=\s*"false"' -or
  $source -notmatch 'document_scan_event_rule_enabled\s*=\s*"false"') {
  throw "The operator does not force both trigger switches dark."
}
if ($source -notmatch 'state pull' -or $source -notmatch 'Remote state lineage or serial changed after review') {
  throw "Apply is not fail-closed against state changes after plan review."
}
$metadataHashOffset = $source.IndexOf('$metadataSha256 = (Get-FileHash -LiteralPath $metadataPath')
$metadataParseOffset = $source.IndexOf('$metadata = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $metadataPath -Raw)')
if ($metadataHashOffset -lt 0 -or $metadataParseOffset -lt $metadataHashOffset) {
  throw "The current retained baseline metadata is parsed before its reviewed checksum is verified."
}
if ($source -notmatch '\$convertFromJson\.Parameters\.ContainsKey\("DateKind"\)' -or
  $source -notmatch 'ConvertFrom-Json -InputObject \$Json -DateKind String') {
  throw "The retained baseline sidecar parser does not preserve ISO timestamp strings when supported."
}
$stagingLifecycle = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\operate-staging-runtime-lifecycle.ps1") -Raw
if ($stagingLifecycle -match '\[IO\.Path\]::GetFullPath\(\$Candidate,') {
  throw "The staging lifecycle operator uses a two-argument GetFullPath overload unavailable in Windows PowerShell 5.1."
}
if ($stagingLifecycle -notmatch 'GetFullPath\(\(Join-Path \$terraformDirectory \$Candidate\)\)') {
  throw "The staging lifecycle operator does not resolve relative paths through a PS5-compatible join."
}

$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
$compatibilityFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "Get-DevelopmentDocumentBaselineShape", "ConvertFrom-DocumentBaselineJson",
        "Assert-CurrentDocumentBaselineMetadata",
        "Assert-CompleteDarkTransitionBaselineMetadata", "Assert-MonotonicDocumentStage"
      )
    }, $true))
if ($compatibilityFunctions.Count -ne 5) { throw "The retained baseline compatibility guards must each be defined once." }
foreach ($function in $compatibilityFunctions | Sort-Object { $_.Extent.StartOffset }) { Invoke-Expression $function.Extent.Text }

$deltaFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @("Get-TextSha256", "Get-ReviewedOperatorDelta")
    }, $true))
if ($deltaFunctions.Count -ne 2) { throw "The canonical operator-delta guards must each be defined once." }
foreach ($function in $deltaFunctions | Sort-Object { $_.Extent.StartOffset }) { Invoke-Expression $function.Extent.Text }
$releaseSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
$operatorSha = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$records = @(& git -C $repositoryRoot diff --name-status --no-renames "$releaseSha..$operatorSha")
$patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$releaseSha..$operatorSha")
$ReviewedOperatorDeltaSha256 = Get-TextSha256 ("development-operator-delta-v1`n$releaseSha`n$operatorSha`n--name-status--`n" +
  (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n"))
if ((Get-ReviewedOperatorDelta $releaseSha $operatorSha) -cne $ReviewedOperatorDeltaSha256) {
  throw "The exact reviewed descendant operator delta was not accepted."
}
$ReviewedOperatorDeltaSha256 = "0" * 64
$deltaTamperRejected = $false
try { $null = Get-ReviewedOperatorDelta $releaseSha $operatorSha } catch { $deltaTamperRejected = $true }
if (-not $deltaTamperRejected) { throw "A tampered descendant operator-delta checksum was accepted." }
$ReviewedOperatorDeltaSha256 = ""
$currentDelta = Get-ReviewedOperatorDelta $operatorSha $operatorSha
if ($currentDelta -cne (Get-TextSha256 "development-operator-delta-v1`n$operatorSha`n$operatorSha`n--name-status--`n--patch--`n")) {
  throw "The exact-current operator delta is not deterministic."
}
$ReviewedOperatorDeltaSha256 = "1" * 64
$currentReviewedRejected = $false
try { $null = Get-ReviewedOperatorDelta $operatorSha $operatorSha } catch { $currentReviewedRejected = $true }
if (-not $currentReviewedRejected) { throw "An exact-current operation accepted a spurious reviewed delta." }
$ReviewedOperatorDeltaSha256 = "2" * 64
$nonAncestorRejected = $false
try { $null = Get-ReviewedOperatorDelta ("f" * 40) $operatorSha } catch { $nonAncestorRejected = $true }
if (-not $nonAncestorRejected) { throw "A nonancestor release source was accepted." }

# Exercise Git's actual name-status, binary, rename, and object-type behavior in an isolated fixture.
$realRepositoryRoot = $repositoryRoot
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "applydash-operator-delta-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $fixtureRoot
try {
  $repositoryRoot = $fixtureRoot
  & git -C $fixtureRoot init -q; & git -C $fixtureRoot config user.email "fixture@example.invalid"
  & git -C $fixtureRoot config user.name "Operator Delta Fixture"
  & git -C $fixtureRoot config core.autocrlf false
  $allowedPath = Join-Path $fixtureRoot "scripts\operate-development-document-dark-deployment.ps1"
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $allowedPath) -Force
  [IO.File]::WriteAllText($allowedPath, "base`n", [Text.UTF8Encoding]::new($false))
  & git -C $fixtureRoot add .; & git -C $fixtureRoot commit -q -m base
  $fixtureBase = (& git -C $fixtureRoot rev-parse HEAD).Trim()

  function Get-FixtureDeltaSha([string]$From, [string]$To) {
    $fixtureRecords = @(& git -C $fixtureRoot diff --name-status --no-renames "$From..$To")
    $fixturePatch = @(& git -C $fixtureRoot diff --full-index --binary --no-ext-diff --no-renames "$From..$To")
    return Get-TextSha256 ("development-operator-delta-v1`n$From`n$To`n--name-status--`n" +
      (($fixtureRecords -join "`n") + "`n--patch--`n" + ($fixturePatch -join "`n") + "`n"))
  }
  function Assert-FixtureDeltaRejected([string]$From, [string]$To, [string]$Label) {
    $script:ReviewedOperatorDeltaSha256 = Get-FixtureDeltaSha $From $To
    $wasRejected = $false
    try { $null = Get-ReviewedOperatorDelta $From $To } catch { $wasRejected = $true }
    if (-not $wasRejected) { throw "The operator delta accepted fixture '$Label'." }
  }

  [IO.File]::WriteAllText($allowedPath, "safe verifier correction`n", [Text.UTF8Encoding]::new($false))
  & git -C $fixtureRoot add .; & git -C $fixtureRoot commit -q -m allowed
  $fixtureAllowed = (& git -C $fixtureRoot rev-parse HEAD).Trim()
  $ReviewedOperatorDeltaSha256 = Get-FixtureDeltaSha $fixtureBase $fixtureAllowed
  if ((Get-ReviewedOperatorDelta $fixtureBase $fixtureAllowed) -cne $ReviewedOperatorDeltaSha256) {
    throw "The isolated allowed modified-blob delta was rejected."
  }

  & git -C $fixtureRoot checkout -q $fixtureBase
  [IO.File]::WriteAllText((Join-Path $fixtureRoot "README.md"), "outside`n", [Text.UTF8Encoding]::new($false))
  & git -C $fixtureRoot add .; & git -C $fixtureRoot commit -q -m outside
  Assert-FixtureDeltaRejected $fixtureBase ((& git -C $fixtureRoot rev-parse HEAD).Trim()) "outside allowlist/add"

  & git -C $fixtureRoot checkout -q $fixtureBase
  & git -C $fixtureRoot mv "scripts/operate-development-document-dark-deployment.ps1" "scripts/renamed.ps1"
  & git -C $fixtureRoot commit -q -m rename
  Assert-FixtureDeltaRejected $fixtureBase ((& git -C $fixtureRoot rev-parse HEAD).Trim()) "rename/add-delete"

  & git -C $fixtureRoot checkout -q $fixtureBase
  [IO.File]::WriteAllBytes($allowedPath, [byte[]](0, 255, 1, 254, 2, 253))
  & git -C $fixtureRoot add .; & git -C $fixtureRoot commit -q -m binary
  Assert-FixtureDeltaRejected $fixtureBase ((& git -C $fixtureRoot rev-parse HEAD).Trim()) "binary"

  & git -C $fixtureRoot checkout -q $fixtureBase
  & git -C $fixtureRoot update-index --add --cacheinfo "160000,$fixtureBase,scripts/operate-development-document-dark-deployment.ps1"
  & git -C $fixtureRoot commit -q -m gitlink
  Assert-FixtureDeltaRejected $fixtureBase ((& git -C $fixtureRoot rev-parse HEAD).Trim()) "non-blob gitlink"
} finally {
  $repositoryRoot = $realRepositoryRoot
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedFixture.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Fixture cleanup escaped the temporary directory." }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}

Assert-MonotonicDocumentStage "kms-prerequisite" "parser-dark" "Plan"
Assert-MonotonicDocumentStage "parser-dark" "complete-dark" "Plan"
Assert-MonotonicDocumentStage "parser-dark" "parser-dark" "Verify"
foreach ($transition in @(
    @{ Applied = "kms-prerequisite"; Requested = "complete-dark"; Operation = "Plan"; Label = "skipped stage" },
    @{ Applied = "parser-dark"; Requested = "kms-prerequisite"; Operation = "Plan"; Label = "reversed stage" },
    @{ Applied = "parser-dark"; Requested = "parser-dark"; Operation = "Plan"; Label = "same-stage plan" },
    @{ Applied = "complete-dark"; Requested = "parser-dark"; Operation = "Verify"; Label = "wrong-stage verify" }
  )) {
  $rejected = $false
  try { Assert-MonotonicDocumentStage $transition.Applied $transition.Requested $transition.Operation }
  catch { $rejected = $true }
  if (-not $rejected) { throw "The monotonic stage guard accepted $($transition.Label)." }
}

function New-TestBaselineVariables([string[]]$Names) {
  $variables = [pscustomobject]@{}
  foreach ($name in $Names) {
    $value = if ($name -ceq "document_processing_kms_prerequisite_enabled") { $true } else { "value" }
    $variables | Add-Member $name ([pscustomobject]@{ value = $value })
  }
  return $variables
}

$variableAssignments = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.AssignmentStatementAst] -and
      $node.Left.Extent.Text -in @('$allowedVariableNames', '$legacyBaselineVariableNames')
    }, $true) | Sort-Object { $_.Extent.StartOffset })
if ($variableAssignments.Count -ne 2) { throw "The current and historical variable sets must each be assigned exactly once." }
foreach ($assignment in $variableAssignments) { Invoke-Expression $assignment.Extent.Text }

$legacyKmsName = "document_processing_kms_prerequisite_enabled"
$expectedLegacyNames = @($legacyBaselineVariableNames)
if ($expectedLegacyNames.Count -ne 53 -or
  @($expectedLegacyNames | Where-Object { $_ -cne $legacyKmsName }).Count -ne 52) {
  throw "The historical ParserDark recovery boundary is not the exact 52/53-variable baseline pair."
}
$withoutLegacyKms = New-TestBaselineVariables @($expectedLegacyNames | Where-Object { $_ -cne $legacyKmsName })
if ((Get-DevelopmentDocumentBaselineShape $withoutLegacyKms "parser-dark" "kms-prerequisite" "Plan") -cne "historical") {
  throw "The exact accepted baseline without the later legacy KMS variable was not accepted."
}
$withLegacyKms = New-TestBaselineVariables $expectedLegacyNames
if ((Get-DevelopmentDocumentBaselineShape $withLegacyKms "parser-dark" "kms-prerequisite" "Apply") -cne "historical") {
  throw "An exact historical baseline with a true KMS prerequisite was not accepted."
}
foreach ($historical in @($withoutLegacyKms, $withLegacyKms)) {
  if ((Get-DevelopmentDocumentBaselineShape $historical "parser-dark" "parser-dark" "Verify") -cne "historical") {
    throw "Exact applied ParserDark verification rejected an accepted 52/53-variable historical KMS baseline."
  }
}
foreach ($case in @(
    @{ Label = "false KMS prerequisite"; Variables = $withLegacyKms | ConvertTo-Json -Depth 10 | ConvertFrom-Json; Mutation = "false" },
    @{ Label = "non-boolean KMS prerequisite"; Variables = $withLegacyKms | ConvertTo-Json -Depth 10 | ConvertFrom-Json; Mutation = "wrong" },
    @{ Label = "multiple missing variables"; Variables = New-TestBaselineVariables @("deploy_document_intake"); Mutation = "none" },
    @{ Label = "unexpected variable"; Variables = New-TestBaselineVariables @("deploy_document_intake", "deploy_document_processing", "unexpected"); Mutation = "none" }
  )) {
  if ($case.Mutation -ceq "false") { $case.Variables.$legacyKmsName.value = $false }
  if ($case.Mutation -ceq "wrong") { $case.Variables.$legacyKmsName.value = "TRUE" }
  $rejected = $false
  try {
    $null = Get-DevelopmentDocumentBaselineShape $case.Variables "parser-dark" "kms-prerequisite" "Plan"
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The compatibility guard accepted $($case.Label)." }
}
foreach ($recoveryRejection in @(
    @{ Requested = "parser-dark"; Applied = "parser-dark"; Operation = "Plan"; Label = "same-stage Plan" },
    @{ Requested = "parser-dark"; Applied = "parser-dark"; Operation = "Apply"; Label = "same-stage Apply" },
    @{ Requested = "complete-dark"; Applied = "parser-dark"; Operation = "Verify"; Label = "CompleteDark Verify" },
    @{ Requested = "parser-dark"; Applied = "complete-dark"; Operation = "Verify"; Label = "different live stage" }
  )) {
  $rejected = $false
  try {
    $null = Get-DevelopmentDocumentBaselineShape $withoutLegacyKms $recoveryRejection.Requested `
      $recoveryRejection.Applied $recoveryRejection.Operation
  } catch { $rejected = $true }
  if (-not $rejected) { throw "Historical baseline recovery accepted $($recoveryRejection.Label)." }
}
$currentVariables = New-TestBaselineVariables $allowedVariableNames
if ((Get-DevelopmentDocumentBaselineShape $currentVariables "complete-dark" "parser-dark" "Plan") -cne "current") {
  throw "The exact current retained baseline shape was not accepted for the monotonic next stage."
}
$missingCurrentRejected = $false
try {
  $null = Get-DevelopmentDocumentBaselineShape (New-TestBaselineVariables @("deploy_document_intake")) `
    "complete-dark" "parser-dark" "Plan"
} catch { $missingCurrentRejected = $true }
if (-not $missingCurrentRejected) { throw "A current retained baseline with a missing variable was accepted." }

$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$metadataPlanPath = "C:\ignored\baseline.tfplan"
$metadataPlanSha = "d" * 64
$metadataReceiptSha = "e" * 64
$metadataSourceSha = "f" * 40
$metadataLineage = "12345678-1234-1234-1234-123456789abc"
$migrationImage = "${ExpectedAccountId}.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('a' * 64)"
$metadataBaseline = [pscustomobject]@{ variables = [pscustomobject]@{
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "" }
    migration_image = [pscustomobject]@{ value = $migrationImage }
  } }
$metadataCommon = [ordered]@{
  SchemaVersion = "1"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
  AccountId = $ExpectedAccountId; Region = $Region; SourceSha = $metadataSourceSha
  StateLineage = $metadataLineage; StateSerial = 42; Stage = "parser-dark"
  ReceiptSha256 = $metadataReceiptSha; ParserQualifiedArn = ""; PlanPath = $metadataPlanPath
  PlanSha256 = $metadataPlanSha; Applyable = $false; MeaningfulChanges = 0
  CreatedAt = "2026-08-13T20:00:00.0000000Z"
}
$stateIdentity = [pscustomobject]@{ Lineage = $metadataLineage; Serial = 42 }
$metadataV1 = [pscustomobject]$metadataCommon
Assert-CurrentDocumentBaselineMetadata $metadataV1 $metadataBaseline $metadataPlanPath $metadataPlanSha `
  "parser-dark" $metadataReceiptSha $stateIdentity $metadataSourceSha $metadataSourceSha ("a" * 64)
$metadataV2Values = [ordered]@{}
foreach ($entry in $metadataCommon.GetEnumerator()) { $metadataV2Values[$entry.Key] = $entry.Value }
$metadataV2Values.SchemaVersion = "2"
$metadataV2Values.MigrationImage = $migrationImage
$metadataV2 = [pscustomobject]$metadataV2Values
Assert-CurrentDocumentBaselineMetadata $metadataV2 $metadataBaseline $metadataPlanPath $metadataPlanSha `
  "parser-dark" $metadataReceiptSha $stateIdentity $metadataSourceSha $metadataSourceSha ("a" * 64)
$metadataV3Values = [ordered]@{}
foreach ($entry in $metadataCommon.GetEnumerator()) { if ($entry.Key -cne "SourceSha") { $metadataV3Values[$entry.Key] = $entry.Value } }
$metadataV3Values.SchemaVersion = "3"
$metadataV3Values.ReleaseSourceSha = "e" * 40
$metadataV3Values.OperatorSourceSha = $metadataSourceSha
$metadataV3Values.OperatorDeltaSha256 = "a" * 64
$metadataV3 = [pscustomobject]$metadataV3Values
Assert-CurrentDocumentBaselineMetadata $metadataV3 $metadataBaseline $metadataPlanPath $metadataPlanSha `
  "parser-dark" $metadataReceiptSha $stateIdentity ("e" * 40) $metadataSourceSha ("a" * 64)

$sidecarFixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "applydash-baseline-json-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $sidecarFixtureRoot
try {
  $sidecarFixturePath = Join-Path $sidecarFixtureRoot "baseline.tfplan.baseline.json"
  $sidecarCreatedAt = "2026-08-13T20:00:00.0000000Z"
  [IO.File]::WriteAllText(
    $sidecarFixturePath,
    ($metadataV3 | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )
  $parsedSidecar = ConvertFrom-DocumentBaselineJson -Json (Get-Content -LiteralPath $sidecarFixturePath -Raw)
  if ($parsedSidecar.CreatedAt -isnot [string] -or [string]$parsedSidecar.CreatedAt -cne $sidecarCreatedAt) {
    throw "The retained baseline sidecar parser changed the exact CreatedAt JSON string."
  }
  Assert-CurrentDocumentBaselineMetadata $parsedSidecar $metadataBaseline $metadataPlanPath $metadataPlanSha `
    "parser-dark" $metadataReceiptSha $stateIdentity ("e" * 40) $metadataSourceSha ("a" * 64)

  $malformedJsonRejected = $false
  try { $null = ConvertFrom-DocumentBaselineJson -Json '{"CreatedAt":' } catch { $malformedJsonRejected = $true }
  if (-not $malformedJsonRejected) { throw "Malformed retained baseline JSON was accepted." }

  foreach ($createdAtMutation in @(
      [pscustomobject]@{ Label = "number"; Value = 20260813 },
      [pscustomobject]@{ Label = "boolean"; Value = $true },
      [pscustomobject]@{ Label = "array"; Value = @($sidecarCreatedAt) },
      [pscustomobject]@{ Label = "null"; Value = $null },
      [pscustomobject]@{ Label = "missing uppercase T"; Value = "2026-08-13 20:00:00.0000000Z" },
      [pscustomobject]@{ Label = "lowercase t"; Value = "2026-08-13t20:00:00.0000000Z" },
      [pscustomobject]@{ Label = "out-of-range century"; Value = "1999-08-13T20:00:00.0000000Z" },
      [pscustomobject]@{ Label = "leading whitespace"; Value = " 2026-08-13T20:00:00.0000000Z" }
    )) {
    $badSidecarValues = [ordered]@{}
    foreach ($entry in $metadataV3Values.GetEnumerator()) { $badSidecarValues[$entry.Key] = $entry.Value }
    $badSidecarValues.CreatedAt = $createdAtMutation.Value
    $badSidecar = ConvertFrom-DocumentBaselineJson -Json ([pscustomobject]$badSidecarValues | ConvertTo-Json -Depth 20)
    $createdAtRejected = $false
    try {
      Assert-CurrentDocumentBaselineMetadata $badSidecar $metadataBaseline $metadataPlanPath $metadataPlanSha `
        "parser-dark" $metadataReceiptSha $stateIdentity ("e" * 40) $metadataSourceSha ("a" * 64)
    } catch { $createdAtRejected = $true }
    if (-not $createdAtRejected) {
      throw "The retained baseline sidecar accepted the '$($createdAtMutation.Label)' CreatedAt mutation."
    }
  }
}
finally {
  Remove-Item -LiteralPath $sidecarFixtureRoot -Recurse -Force
}

$metadataV3.OperatorDeltaSha256 = "b" * 64
$dualDeltaRejected = $false
try {
  Assert-CurrentDocumentBaselineMetadata $metadataV3 $metadataBaseline $metadataPlanPath $metadataPlanSha `
    "parser-dark" $metadataReceiptSha $stateIdentity ("e" * 40) $metadataSourceSha ("a" * 64)
} catch { $dualDeltaRejected = $true }
if (-not $dualDeltaRejected) { throw "A tampered retained-baseline operator delta was accepted." }

function Get-TestCanonicalOperatorDelta([string]$From, [string]$To) {
  if ($From -ceq $To) {
    return Get-TextSha256 "development-operator-delta-v1`n$From`n$To`n--name-status--`n--patch--`n"
  }
  $deltaRecords = @(& git -C $repositoryRoot diff --name-status --no-renames "$From..$To")
  $deltaPatch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$From..$To")
  if ($LASTEXITCODE -ne 0) { throw "The transition metadata fixture could not read its commit delta." }
  return Get-TextSha256 ("development-operator-delta-v1`n$From`n$To`n--name-status--`n" +
    (($deltaRecords -join "`n") + "`n--patch--`n" + ($deltaPatch -join "`n") + "`n"))
}
$transitionReleaseSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
$transitionBaselineOperatorSha = "d7844ba85b5b8291de4a78c47c88e1ec218211fa"
$operatorCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$transitionMetadata = $metadataV3 | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$transitionMetadata.ReleaseSourceSha = $transitionReleaseSha
$transitionMetadata.OperatorSourceSha = $transitionBaselineOperatorSha
$transitionMetadata.OperatorDeltaSha256 = Get-TestCanonicalOperatorDelta $transitionReleaseSha $transitionBaselineOperatorSha
$transitionMetadata.ReceiptSha256 = "7" * 64
$transitionMetadata.CreatedAt = "2026-08-13T20:00:00.0000000Z"
$transitionBaseline = $metadataBaseline | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$transitionArtifactSha = "6" * 64
$transitionBaseline.variables | Add-Member document_parser_artifact_s3_key ([pscustomobject]@{
    value = "lambda/documents/$transitionReleaseSha/$transitionArtifactSha/document-parser-lambda.zip"
  })
$transitionBaseline.variables | Add-Member document_parser_artifact_s3_object_version ([pscustomobject]@{ value = "version-1" })
$transitionBaseline.variables | Add-Member document_parser_artifact_sha256 ([pscustomobject]@{ value = $transitionArtifactSha })
$transitionBaseline.variables | Add-Member document_parser_artifact_base64sha256 ([pscustomobject]@{ value = (("Y" * 43) + "=") })
$ReviewedReceiptSha256 = "8" * 64
$ReviewedBaselineToOperatorDeltaSha256 = if ($transitionBaselineOperatorSha -ceq $operatorCommit) { "" } else {
  Get-TestCanonicalOperatorDelta $transitionBaselineOperatorSha $operatorCommit
}
Assert-CompleteDarkTransitionBaselineMetadata $transitionMetadata $transitionBaseline $metadataPlanPath `
  $metadataPlanSha $stateIdentity
$transitionMetadataV4 = $transitionMetadata | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$transitionMetadataV4.SchemaVersion = "4"
$transitionMetadataV4.CreatedAt = "2026-08-13T20:00:00.0000000Z"
$transitionMetadataV4 | Add-Member MigrationImage $migrationImage
Assert-CompleteDarkTransitionBaselineMetadata $transitionMetadataV4 $transitionBaseline $metadataPlanPath `
  $metadataPlanSha $stateIdentity
foreach ($mutation in @("receipt", "release", "delta", "parser-key", "serial", "extra")) {
  $badTransitionMetadata = $transitionMetadata | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $badTransitionBaseline = $transitionBaseline | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $badTransitionMetadata.CreatedAt = "2026-08-13T20:00:00.0000000Z"
  switch ($mutation) {
    "receipt" { $badTransitionMetadata.ReceiptSha256 = $ReviewedReceiptSha256 }
    "release" { $badTransitionMetadata.ReleaseSourceSha = "f" * 40 }
    "delta" { $badTransitionMetadata.OperatorDeltaSha256 = "0" * 64 }
    "parser-key" { $badTransitionBaseline.variables.document_parser_artifact_s3_key.value = "lambda/documents/$operatorCommit/$transitionArtifactSha/document-parser-lambda.zip" }
    "serial" { $badTransitionMetadata.StateSerial = 43 }
    "extra" { $badTransitionMetadata | Add-Member Unexpected "value" }
  }
  $rejected = $false
  try {
    Assert-CompleteDarkTransitionBaselineMetadata $badTransitionMetadata $badTransitionBaseline `
      $metadataPlanPath $metadataPlanSha $stateIdentity
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark source-transition baseline accepted '$mutation' tampering." }
}
$ReviewedBaselineToOperatorDeltaSha256 = "0" * 64
$baselineDeltaTamperRejected = $false
try {
  Assert-CompleteDarkTransitionBaselineMetadata $transitionMetadata $transitionBaseline $metadataPlanPath `
    $metadataPlanSha $stateIdentity
} catch { $baselineDeltaTamperRejected = $true }
if (-not $baselineDeltaTamperRejected) {
  throw "A tampered baseline-to-current operator delta was accepted."
}
foreach ($mutation in @("migration", "receipt", "serial", "extra")) {
  $badMetadata = $metadataV2 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  switch ($mutation) {
    "migration" { $badMetadata.MigrationImage = $badMetadata.MigrationImage -replace "a$", "b" }
    "receipt" { $badMetadata.ReceiptSha256 = "0" * 64 }
    "serial" { $badMetadata.StateSerial = 43 }
    "extra" { $badMetadata | Add-Member Unexpected "value" }
  }
  $rejected = $false
  try {
    Assert-CurrentDocumentBaselineMetadata $badMetadata $metadataBaseline $metadataPlanPath $metadataPlanSha `
      "parser-dark" $metadataReceiptSha $stateIdentity $metadataSourceSha $metadataSourceSha ("a" * 64)
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The current retained baseline metadata accepted '$mutation' tampering." }
}

$metadataFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "Write-ExclusiveJsonFile", "New-RetainedBaselineMetadata",
        "Assert-RetainedBaselineMetadata", "Save-RetainedBaselineMetadata",
        "Assert-RetainedBaselinePathsAvailable", "Assert-StateIdentityStable",
        "Remove-NewRetainedBaselineArtifacts"
      )
    }, $true))
if ($metadataFunctions.Count -ne 7) { throw "The retained-baseline functions must each be defined once." }
foreach ($function in $metadataFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$sourceSha = "a" * 40
$operatorDeltaSha = "b" * 64
$receiptSha = "b" * 64
$lineage = "12345678-1234-1234-1234-123456789abc"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "applydash-document-baseline-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $temporaryRoot
try {
  $planPath = Join-Path $temporaryRoot "parser-dark.tfplan"
  [IO.File]::WriteAllText($planPath, "zero-change-plan", [Text.UTF8Encoding]::new($false))
  $saved = Save-RetainedBaselineMetadata -ReleaseSourceSha $sourceSha -OperatorSourceSha $sourceSha `
    -OperatorDeltaSha256 $operatorDeltaSha -DeploymentStage "parser-dark" `
    -PlanPath $planPath -StateLineage $lineage -StateSerial 42 -ReceiptSha256 $receiptSha
  $expectedPlanSha = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([string]$saved.PlanPath -cne $planPath -or [string]$saved.PlanSha256 -cne $expectedPlanSha -or
    -not (Test-Path -LiteralPath $saved.MetadataPath -PathType Leaf) -or
    [string]$saved.MetadataSha256 -cne
      (Get-FileHash -LiteralPath $saved.MetadataPath -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw "The retained baseline writer did not create the exact checksum-bound handoff."
  }
  $stored = Get-Content -LiteralPath $saved.MetadataPath -Raw | ConvertFrom-Json
  if ([string]$stored.Stage -cne "parser-dark" -or [string]$stored.ReceiptSha256 -cne $receiptSha -or
    [string]$stored.ReleaseSourceSha -cne $sourceSha -or [string]$stored.OperatorSourceSha -cne $sourceSha -or
    [string]$stored.OperatorDeltaSha256 -cne $operatorDeltaSha -or [long]$stored.StateSerial -ne 42 -or
    [string]$stored.PlanSha256 -cne $expectedPlanSha -or $stored.Applyable -isnot [bool] -or $stored.Applyable) {
    throw "The retained baseline metadata omitted its exact stage, source, state, hash, or applyable boundary."
  }

  $overwriteRejected = $false
  try {
    $null = Save-RetainedBaselineMetadata -ReleaseSourceSha $sourceSha -OperatorSourceSha $sourceSha `
      -OperatorDeltaSha256 $operatorDeltaSha -DeploymentStage "parser-dark" `
      -PlanPath $planPath -StateLineage $lineage -StateSerial 42 -ReceiptSha256 $receiptSha
  } catch { $overwriteRejected = $true }
  if (-not $overwriteRejected) { throw "The retained baseline writer overwrote an existing metadata sidecar." }

  $hashMismatchRejected = $false
  try { Assert-RetainedBaselineMetadata -Metadata $stored -Expected @{ PlanSha256 = "c" * 64 } }
  catch { $hashMismatchRejected = $true }
  if (-not $hashMismatchRejected) { throw "Retained baseline metadata accepted a mismatched plan hash." }

  $stageMismatchRejected = $false
  try { Assert-RetainedBaselineMetadata -Metadata $stored -Expected @{ Stage = "complete-dark" } }
  catch { $stageMismatchRejected = $true }
  if (-not $stageMismatchRejected) { throw "Retained baseline metadata accepted a mismatched stage." }

  $stateMismatchRejected = $false
  try {
    Assert-StateIdentityStable `
      -Before ([pscustomobject]@{ Lineage = $lineage; Serial = 42 }) `
      -After ([pscustomobject]@{ Lineage = $lineage; Serial = 43 })
  } catch { $stateMismatchRejected = $true }
  if (-not $stateMismatchRejected) { throw "The retained baseline accepted a changed state serial." }

  $existingPlanRejected = $false
  try { Assert-RetainedBaselinePathsAvailable -PlanPath $planPath -MetadataPath (Join-Path $temporaryRoot "unused.json") }
  catch { $existingPlanRejected = $true }
  if (-not $existingPlanRejected) { throw "The retained baseline accepted a preexisting plan path." }

  $existingSidecarPlan = Join-Path $temporaryRoot "sidecar-only.tfplan"
  $existingSidecar = "$existingSidecarPlan.baseline.json"
  [IO.File]::WriteAllText($existingSidecar, "preexisting", [Text.UTF8Encoding]::new($false))
  $existingSidecarRejected = $false
  try { Assert-RetainedBaselinePathsAvailable -PlanPath $existingSidecarPlan -MetadataPath $existingSidecar }
  catch { $existingSidecarRejected = $true }
  if (-not $existingSidecarRejected -or (Get-Content -LiteralPath $existingSidecar -Raw) -cne "preexisting") {
    throw "The retained baseline did not preserve and reject a preexisting sidecar."
  }

  $failedPlan = Join-Path $temporaryRoot "failed.tfplan"
  $failedSidecar = "$failedPlan.baseline.json"
  [IO.File]::WriteAllText($failedPlan, "partial-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($failedSidecar, "invalid-sidecar", [Text.UTF8Encoding]::new($false))
  Remove-NewRetainedBaselineArtifacts -PlanPath $failedPlan -MetadataPath $failedSidecar
  if ((Test-Path -LiteralPath $failedPlan) -or (Test-Path -LiteralPath $failedSidecar)) {
    throw "A simulated retained-sidecar validation failure left an orphan artifact."
  }
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$saveCallOffset = $source.IndexOf('$result = Save-RetainedBaselineMetadata')
$successAfterSaveOffset = $source.IndexOf('$succeeded = $true', $saveCallOffset)
if ($saveCallOffset -lt 0 -or $successAfterSaveOffset -lt $saveCallOffset -or
  -not $source.Contains('Remove-NewRetainedBaselineArtifacts -PlanPath $path -MetadataPath $metadataPath')) {
  throw "Verify can report retained-baseline success before sidecar validation or leave failed artifacts behind."
}

Write-Output "Development document staged operator tests passed."
