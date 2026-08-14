Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-dark-deployment.ps1"
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
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
    'Assert-CompleteDarkVerifyRecoveryBaselineMetadata', 'Get-AppliedProcessorParserQualifiedArn',
    '-PinnedParserMatchesBaselineArtifact:$completeDarkVerifyRecovery',
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

$inventoryFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Get-LiveDocumentStageInventory"
    }, $true))
if ($inventoryFunctions.Count -ne 1) { throw "The live document inventory must be defined exactly once." }
Invoke-Expression $inventoryFunctions[0].Extent.Text

$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$processorName = "ai-job-apply-development-document-processor"
$processorArn = "arn:aws:lambda:${Region}:${ExpectedAccountId}:function:$processorName"
$processorAliasArn = "${processorArn}:development"
$script:testProcessorExists = $true
$script:testProcessorMappings = @()
$script:testInventoryMappingQueries = 0
$script:testLaterStageGrantCount = 3

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $signature = $Arguments -join " "
  switch -Regex ($signature) {
    '^lambda list-functions --output json$' {
      return [pscustomobject]@{ Functions = @($(if ($script:testProcessorExists) {
              [pscustomobject]@{ FunctionName = $processorName; FunctionArn = $processorArn }
            })) }
    }
    '^lambda list-event-source-mappings --output json$' {
      $script:testInventoryMappingQueries++
      return [pscustomobject]@{ EventSourceMappings = @($script:testProcessorMappings) }
    }
    '^lambda list-event-source-mappings .*--function-name' {
      throw "The live inventory used Lambda's function filter instead of enumerating all mappings."
    }
    '^lambda list-aliases --function-name ai-job-apply-development-document-processor --output json$' {
      return [pscustomobject]@{ Aliases = @([pscustomobject]@{ Name = "development"; AliasArn = $processorAliasArn }) }
    }
    '^lambda get-policy --function-name ai-job-apply-development-document-processor --qualifier development --output json$' {
      return [pscustomobject]@{ Policy = ([pscustomobject]@{
            Statement = @([pscustomobject]@{ Sid = "AllowExactDocumentReconcilerRule" })
          } | ConvertTo-Json -Compress) }
    }
    '^events list-targets-by-rule --rule ai-job-apply-development-document-processing-reconciler --output json$' {
      return [pscustomobject]@{ Targets = @($(if ($script:testProcessorExists) {
              [pscustomobject]@{ Id = "document-processing-reconciler" }
            })) }
    }
    '^ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-fixture --output json$' {
      $endpoints = if ($script:testProcessorExists) {
        @(
          [pscustomobject]@{ ServiceName = "com.amazonaws.us-east-2.sts"; PolicyDocument = '{"Statement":[]}' },
          [pscustomobject]@{ ServiceName = "com.amazonaws.us-east-2.sqs"; PolicyDocument = '{"Statement":[]}' },
          [pscustomobject]@{ ServiceName = "com.amazonaws.us-east-2.lambda"; PolicyDocument = '{"Statement":[]}' },
          [pscustomobject]@{ ServiceName = "com.amazonaws.us-east-2.secretsmanager"; PolicyDocument = '{"Statement":[]}' }
        )
      }
      else { @() }
      return [pscustomobject]@{ VpcEndpoints = $endpoints }
    }
    '^iam list-role-policies --role-name ai-job-apply-development-document-processor --output json$' {
      return [pscustomobject]@{ PolicyNames = @($(if ($script:testProcessorExists) { "document-processor-runtime" })) }
    }
    default { throw "Unexpected live-inventory AWS fixture call '$signature'." }
  }
}

function Get-DevelopmentDocumentLaterStageEndpointGrantCount {
  param([object[]]$Policies, [string]$AccountId)
  return $script:testLaterStageGrantCount
}

$inventoryState = @{
  "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]" = [pscustomobject]@{
    name = "ai-job-apply-development-document-processing-reconciler"
  }
  "module.platform.aws_vpc.this" = [pscustomobject]@{ id = "vpc-fixture" }
}
$requiredParserStateAddresses = @(
  "module.platform.aws_iam_role.document_processor[0]",
  "module.platform.aws_iam_role.document_parser[0]",
  "module.platform.aws_iam_role.document_parser_object_access[0]",
  "module.platform.aws_lambda_alias.document_parser[0]",
  "module.platform.aws_lambda_function.document_parser[0]",
  "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
)
$completeStateAddresses = @($requiredParserStateAddresses + @(
    "module.platform.aws_cloudwatch_event_target.document_processing_reconciler[0]",
    "module.platform.aws_iam_role_policy.document_processor[0]",
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_permission.document_processing_reconciler[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  ))

function Get-TestLiveDocumentInventory([object[]]$Mappings, [bool]$ProcessorExists = $true) {
  $script:testProcessorExists = $ProcessorExists
  $script:testProcessorMappings = @($Mappings)
  $script:testLaterStageGrantCount = if ($ProcessorExists) { 3 } else { 0 }
  $script:testInventoryMappingQueries = 0
  $inventory = Get-LiveDocumentStageInventory -State $inventoryState
  if ($script:testInventoryMappingQueries -ne 1) {
    throw "The live inventory did not enumerate all Lambda event-source mappings exactly once."
  }
  return $inventory
}

function Assert-TestCompleteInventoryRejected([object[]]$Mappings, [string]$Label) {
  $inventory = Get-TestLiveDocumentInventory -Mappings $Mappings
  $rejected = $false
  try {
    Assert-DevelopmentDocumentStageResourceInventory -Stage "complete-dark" `
      -StateAddresses $completeStateAddresses -LiveInventory $inventory
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark live inventory accepted '$Label'." }
}

$expectedAliasMapping = [pscustomobject]@{ FunctionArn = $processorAliasArn }
$unrelatedMapping = [pscustomobject]@{
  FunctionArn = "arn:aws:lambda:${Region}:${ExpectedAccountId}:function:unrelated:development"
}
$shadowPrefixMapping = [pscustomobject]@{ FunctionArn = "${processorArn}-shadow:development" }
foreach ($acceptedMappings in @(
    [pscustomobject]@{ Label = "expected development alias only"; Mappings = @($expectedAliasMapping) },
    [pscustomobject]@{ Label = "unrelated function ignored"; Mappings = @($expectedAliasMapping, $unrelatedMapping) },
    [pscustomobject]@{ Label = "shadow prefix ignored"; Mappings = @($expectedAliasMapping, $shadowPrefixMapping) }
  )) {
  $inventory = Get-TestLiveDocumentInventory -Mappings $acceptedMappings.Mappings
  if ([int]$inventory.ProcessorMappings -ne 1) {
    throw "The live inventory did not retain exactly one mapping for '$($acceptedMappings.Label)'."
  }
  Assert-DevelopmentDocumentStageResourceInventory -Stage "complete-dark" `
    -StateAddresses $completeStateAddresses -LiveInventory $inventory
}

foreach ($familyMember in @(
    [pscustomobject]@{ Label = "unqualified function"; FunctionArn = $processorArn },
    [pscustomobject]@{ Label = "numeric version"; FunctionArn = "${processorArn}:2" },
    [pscustomobject]@{ Label = "other alias"; FunctionArn = "${processorArn}:canary" }
  )) {
  $familyMappings = @($expectedAliasMapping, [pscustomobject]@{ FunctionArn = $familyMember.FunctionArn })
  $inventory = Get-TestLiveDocumentInventory -Mappings $familyMappings
  if ([int]$inventory.ProcessorMappings -ne 2) {
    throw "The live inventory did not count the expected alias plus '$($familyMember.Label)' as two mappings."
  }
  Assert-TestCompleteInventoryRejected -Mappings $familyMappings -Label "expected alias plus $($familyMember.Label)"
}
Assert-TestCompleteInventoryRejected -Mappings @() -Label "zero processor-family mappings"

$wrongFamilyMemberOnly = @([pscustomobject]@{ FunctionArn = "${processorArn}:2" })
$wrongOnlyInventory = Get-TestLiveDocumentInventory -Mappings $wrongFamilyMemberOnly
Assert-DevelopmentDocumentStageResourceInventory -Stage "complete-dark" `
  -StateAddresses $completeStateAddresses -LiveInventory $wrongOnlyInventory
$aliasQualifiedMappings = @($wrongFamilyMemberOnly | Where-Object FunctionArn -ceq $processorAliasArn)
$laterDeepCheckRejected = $false
try {
  if ($aliasQualifiedMappings.Count -ne 1) { throw "The exact development-alias mapping is absent." }
} catch { $laterDeepCheckRejected = $true }
if (-not $laterDeepCheckRejected) {
  throw "A sole wrong processor-family member bypassed the later alias-qualified mapping check."
}
$deepMappingQueryOffset = $source.IndexOf('"ai-job-apply-development-document-processor:development", "--output", "json")')
$deepMappingCountOffset = $source.IndexOf('if ($mappings.Count -ne 1 -or [string]$mappings[0].State -cne "Disabled"', $deepMappingQueryOffset)
$deepMappingArnOffset = $source.IndexOf('[string]$mappings[0].FunctionArn -cne $processorAliasArn', $deepMappingCountOffset)
if ($deepMappingQueryOffset -lt 0 -or $deepMappingCountOffset -lt $deepMappingQueryOffset -or
  $deepMappingArnOffset -lt $deepMappingCountOffset) {
  throw "The later alias-qualified deep mapping check was removed or weakened."
}

$parserInventory = Get-TestLiveDocumentInventory -Mappings @($unrelatedMapping, $shadowPrefixMapping) -ProcessorExists $false
Assert-DevelopmentDocumentStageResourceInventory -Stage "parser-dark" `
  -StateAddresses $requiredParserStateAddresses -LiveInventory $parserInventory
if (@($parserInventory.PSObject.Properties | Where-Object { [int]$_.Value -ne 0 }).Count -ne 0) {
  throw "ParserDark live inventory no longer proves every later-stage field absent."
}
$rogueParserInventory = Get-TestLiveDocumentInventory `
  -Mappings @([pscustomobject]@{ FunctionArn = "${processorArn}:development" }) -ProcessorExists $false
$rogueParserRejected = $false
try {
  Assert-DevelopmentDocumentStageResourceInventory -Stage "parser-dark" `
    -StateAddresses $requiredParserStateAddresses -LiveInventory $rogueParserInventory
} catch { $rogueParserRejected = $true }
if (-not $rogueParserRejected) { throw "ParserDark accepted an exact-family processor mapping." }

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

$setBaselineFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Set-BaselineVariables"
    }, $true))
if ($setBaselineFunctions.Count -ne 1) { throw "The baseline variable migration must be defined exactly once." }
Invoke-Expression $setBaselineFunctions[0].Extent.Text

function New-DeploymentBaselineVariableFixture([string[]]$Names) {
  $variables = [pscustomobject]@{}
  $kinds = Get-DevelopmentDocumentVariableKinds
  foreach ($name in $Names) {
    $value = if ($name -in @("deploy_document_processing", "document_processing_kms_prerequisite_enabled")) {
      $true
    }
    else {
      switch ($kinds[$name]) {
        "boolean" { $false }
        "number" { 7 }
        "composite" { , @("https://candidate.example") }
        "string" { "fixture-$name" }
        default { throw "The deployment fixture encountered unknown variable '$name'." }
      }
    }
    $variables | Add-Member $name ([pscustomobject]@{ value = $value })
  }
  return $variables
}

$derivedVariableNames = @(
  "document_processing_deployment_stage", "document_parser_invocation_qualified_arn",
  "document_security_health_rules_enabled"
)
$retiredVariableNames = @("deploy_document_processing", "document_processing_kms_prerequisite_enabled")
$testTfVariableNames = @($allowedVariableNames + $retiredVariableNames + "unexpected_variable")
function Clear-TestTerraformVariables {
  foreach ($name in $testTfVariableNames) {
    Remove-Item -LiteralPath "Env:TF_VAR_$name" -ErrorAction SilentlyContinue
  }
}

try {
  $currentSchema4Fixture = [pscustomobject]@{
    SchemaVersion = "4"
    variables = New-DeploymentBaselineVariableFixture $allowedVariableNames
  }
  $currentSchema4Fixture.variables.document_processing_deployment_stage.value = "tampered-stage"
  $currentSchema4Fixture.variables.document_parser_invocation_qualified_arn.value = "tampered-pin"
  $currentSchema4Fixture.variables.document_security_health_rules_enabled.value = "false"
  $currentSchema4Fixture.variables.migration_image | Add-Member before_unknown ([pscustomobject]@{ digest = $false })
  $currentSchema4Fixture.variables.migration_image | Add-Member after_sensitive ([pscustomobject]@{ digest = $true })
  $currentFixtureBefore = $currentSchema4Fixture | ConvertTo-Json -Depth 20
  $testParserPin = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-document-parser:7"

  Clear-TestTerraformVariables
  Set-BaselineVariables -Baseline $currentSchema4Fixture -DeploymentStage "complete-dark" `
    -ParserQualifiedArn $testParserPin
  if ([string][Environment]::GetEnvironmentVariable("TF_VAR_document_processing_deployment_stage", "Process") -cne "complete-dark" -or
    [string][Environment]::GetEnvironmentVariable("TF_VAR_document_parser_invocation_qualified_arn", "Process") -cne $testParserPin -or
    [string][Environment]::GetEnvironmentVariable("TF_VAR_document_security_health_rules_enabled", "Process") -cne "true") {
    throw "The schema-4 baseline did not receive the exact derived CompleteDark values."
  }
  foreach ($name in @($allowedVariableNames | Where-Object { $_ -notin $derivedVariableNames })) {
    $expected = ConvertTo-TerraformVariableEnvironmentValue -Name $name `
      -Value $currentSchema4Fixture.variables.PSObject.Properties[$name].Value.value
    if ([string][Environment]::GetEnvironmentVariable("TF_VAR_$name", "Process") -cne [string]$expected) {
      throw "The schema-4 baseline changed preserved variable '$name'."
    }
  }
  if (($currentSchema4Fixture | ConvertTo-Json -Depth 20) -cne $currentFixtureBefore) {
    throw "The schema-4 baseline migration mutated retained values, types, unknowns, or sensitivity metadata."
  }
  foreach ($name in $retiredVariableNames) {
    if (Test-Path -LiteralPath "Env:TF_VAR_$name") {
      throw "The current baseline migration retained retired variable '$name'."
    }
  }

  $legacyFixture = [pscustomobject]@{
    variables = New-DeploymentBaselineVariableFixture $legacyBaselineVariableNames
  }
  Clear-TestTerraformVariables
  Set-BaselineVariables -Baseline $legacyFixture -DeploymentStage "parser-dark"
  foreach ($name in $retiredVariableNames) {
    if (Test-Path -LiteralPath "Env:TF_VAR_$name") {
      throw "The historical baseline migration retained retired variable '$name'."
    }
  }
  if ([string][Environment]::GetEnvironmentVariable("TF_VAR_document_processing_deployment_stage", "Process") -cne "parser-dark" -or
    [string][Environment]::GetEnvironmentVariable("TF_VAR_document_parser_invocation_qualified_arn", "Process") -cne "" -or
    [string][Environment]::GetEnvironmentVariable("TF_VAR_document_security_health_rules_enabled", "Process") -cne "true") {
    throw "The historical baseline did not migrate to the exact current derived variable set."
  }

  $extraCurrentFixture = New-DeploymentBaselineVariableFixture $allowedVariableNames
  $extraCurrentFixture | Add-Member unexpected_variable ([pscustomobject]@{ value = "unexpected" })
  $extraCurrentRejected = $false
  try { $null = Get-DevelopmentDocumentBaselineShape $extraCurrentFixture "complete-dark" "parser-dark" "Plan" }
  catch { $extraCurrentRejected = $true }
  if (-not $extraCurrentRejected) { throw "A schema-4 current baseline with an extra variable was accepted." }

  $missingExactCurrentFixture = New-DeploymentBaselineVariableFixture $allowedVariableNames
  $missingExactCurrentFixture.PSObject.Properties.Remove("migration_image")
  $missingExactCurrentRejected = $false
  try { $null = Get-DevelopmentDocumentBaselineShape $missingExactCurrentFixture "complete-dark" "parser-dark" "Plan" }
  catch { $missingExactCurrentRejected = $true }
  if (-not $missingExactCurrentRejected) { throw "A schema-4 current baseline missing one exact variable was accepted." }

  $tamperedCurrentFixture = [pscustomobject]@{
    variables = New-DeploymentBaselineVariableFixture $allowedVariableNames
  }
  $tamperedCurrentFixture.variables.deploy_applications.value = "TRUE"
  $tamperedCurrentRejected = $false
  try { Set-BaselineVariables -Baseline $tamperedCurrentFixture -DeploymentStage "complete-dark" -ParserQualifiedArn $testParserPin }
  catch { $tamperedCurrentRejected = $true }
  if (-not $tamperedCurrentRejected) { throw "A current baseline with a type-tampered preserved variable was accepted." }
}
finally {
  Clear-TestTerraformVariables
}

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

$recoveryFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "Assert-CompleteDarkVerifyRecoveryBaselineMetadata",
        "Get-AppliedProcessorParserQualifiedArn"
      )
    }, $true))
if ($recoveryFunctions.Count -ne 2) { throw "The CompleteDark Verify recovery functions must each be defined once." }
foreach ($function in $recoveryFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$completeDarkRecoveryReleaseSourceSha = "a6d0fba09082b8bc61ee7b604ee1d5c47bd71624"
$completeDarkRecoveryBaselineReleaseSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
$completeDarkRecoveryBaselineOperatorSourceSha = "cd8bc47fd89239c5e224ccdd1baff097d13c5bf7"
$completeDarkRecoveryBaselineReceiptSha256 = "97d4084d0a5b2ddfc563f3e4f76bafb9598dcdd0e9579fb18821b6bdc9097677"
$completeDarkRecoveryReceiptSha256 = "524bbf645621a0aa744c3e84f7deff5f8430830e87330267ed5ca7243f40023e"
$completeDarkRecoveryStateLineage = "472ef790-b249-45ec-817f-718005980d9e"
$completeDarkRecoveryBaselineStateSerial = 103
$completeDarkRecoveryCurrentStateSerial = 106
$operatorCommit = "f" * 40
$releaseCommit = $completeDarkRecoveryReleaseSourceSha
$storedRecoveryDelta = "a" * 64
$expectedRecoveryBaselineDelta = "b" * 64
$expectedRecoveryReleaseDelta = "c" * 64
$ReviewedBaselineToOperatorDeltaSha256 = $expectedRecoveryBaselineDelta
$ReviewedOperatorDeltaSha256 = $expectedRecoveryReleaseDelta
$operatorDeltaSha256 = $ReviewedOperatorDeltaSha256
$ReviewedReceiptSha256 = $completeDarkRecoveryReceiptSha256
$recoveryPlanPath = "C:\ignored\parser-dark-recovery.tfplan"
$recoveryPlanSha = "d" * 64
$recoveryMigrationImage = "${ExpectedAccountId}.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('e' * 64)"
$recoveryParserArtifactSha = "6" * 64
$recoveryProcessorArtifactSha = "7" * 64
$recoveryBaseline = [pscustomobject]@{ variables = [pscustomobject]@{
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "" }
    document_parser_artifact_s3_key = [pscustomobject]@{
      value = "lambda/documents/$completeDarkRecoveryBaselineReleaseSourceSha/$recoveryParserArtifactSha/document-parser-lambda.zip"
    }
    document_parser_artifact_s3_object_version = [pscustomobject]@{ value = "baseline-parser-version" }
    document_parser_artifact_sha256 = [pscustomobject]@{ value = $recoveryParserArtifactSha }
    document_parser_artifact_base64sha256 = [pscustomobject]@{ value = ("Y" * 43) + "=" }
    document_processor_artifact_s3_key = [pscustomobject]@{ value = "" }
    document_processor_artifact_s3_object_version = [pscustomobject]@{ value = "" }
    document_processor_artifact_sha256 = [pscustomobject]@{ value = "" }
    document_processor_artifact_base64sha256 = [pscustomobject]@{ value = "" }
    document_processor_extension_layer_arn = [pscustomobject]@{ value = "" }
    migration_image = [pscustomobject]@{ value = $recoveryMigrationImage }
  } }
$recoveryReceipt = [pscustomobject]@{ artifacts = @(
    [pscustomobject]@{
      artifactName = "document-parser-lambda"; suffix = "zip"
      key = "lambda/documents/$completeDarkRecoveryReleaseSourceSha/$recoveryParserArtifactSha/document-parser-lambda.zip"
    },
    [pscustomobject]@{
      artifactName = "document-processor-lambda"; suffix = "zip"
      key = "lambda/documents/$completeDarkRecoveryReleaseSourceSha/$recoveryProcessorArtifactSha/document-processor-lambda.zip"
    }
  ) }
$recoveryStateIdentity = [pscustomobject]@{
  Lineage = $completeDarkRecoveryStateLineage
  Serial = $completeDarkRecoveryCurrentStateSerial
}

function New-TestRecoveryMetadata([ValidateSet("3", "4")][string]$SchemaVersion) {
  $values = [ordered]@{
    SchemaVersion = $SchemaVersion; Kind = "development-document-zero-drift-baseline"
    Environment = "development"; AccountId = $ExpectedAccountId; Region = $Region
    ReleaseSourceSha = $completeDarkRecoveryBaselineReleaseSourceSha
    OperatorSourceSha = $completeDarkRecoveryBaselineOperatorSourceSha
    OperatorDeltaSha256 = $storedRecoveryDelta
    StateLineage = $completeDarkRecoveryStateLineage; StateSerial = $completeDarkRecoveryBaselineStateSerial
    Stage = "parser-dark"; ReceiptSha256 = $completeDarkRecoveryBaselineReceiptSha256
    ParserQualifiedArn = ""; PlanPath = $recoveryPlanPath; PlanSha256 = $recoveryPlanSha
    Applyable = $false; MeaningfulChanges = 0; CreatedAt = "2026-08-14T05:49:55.4463539Z"
  }
  if ($SchemaVersion -ceq "4") { $values.MigrationImage = $recoveryMigrationImage }
  return [pscustomobject]$values
}

$script:rejectedRecoveryDeltaPair = ""
function Get-ReviewedOperatorDelta {
  param([string]$ReleaseSha, [string]$OperatorSha, [string]$ReviewedSha256)
  $pair = "$ReleaseSha->$OperatorSha"
  if ($pair -ceq $script:rejectedRecoveryDeltaPair) { throw "The fixture delta pair is not ancestral." }
  $expected = if ($ReleaseSha -ceq $completeDarkRecoveryBaselineReleaseSourceSha -and
    $OperatorSha -ceq $completeDarkRecoveryBaselineOperatorSourceSha) { $storedRecoveryDelta }
  elseif ($ReleaseSha -ceq $completeDarkRecoveryBaselineOperatorSourceSha -and $OperatorSha -ceq $operatorCommit) {
    $expectedRecoveryBaselineDelta
  }
  elseif ($ReleaseSha -ceq $completeDarkRecoveryReleaseSourceSha -and $OperatorSha -ceq $operatorCommit) {
    $expectedRecoveryReleaseDelta
  }
  else { throw "The fixture delta pair is outside the exact recovery graph." }
  if ([string]::IsNullOrEmpty($ReviewedSha256) -or $ReviewedSha256 -cne $expected) {
    throw "The fixture reviewed delta is missing or mismatched."
  }
  return $expected
}

function Assert-TestRecoveryAccepted([object]$Metadata, [object]$Baseline = $recoveryBaseline,
  [object]$Receipt = $recoveryReceipt, [object]$StateIdentity = $recoveryStateIdentity,
  [string]$RequestedStage = "complete-dark", [string]$AppliedStage = "complete-dark",
  [ValidateSet("Plan", "Apply", "Verify")][string]$Operation = "Verify") {
  Assert-CompleteDarkVerifyRecoveryBaselineMetadata -Metadata $Metadata -Baseline $Baseline `
    -ResolvedPlanPath $recoveryPlanPath -PlanSha256 $recoveryPlanSha `
    -CurrentStateIdentity $StateIdentity -Receipt $Receipt -RequestedStage $RequestedStage `
    -AppliedStage $AppliedStage -Operation $Operation
}

foreach ($schema in @("3", "4")) {
  Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata $schema)
}

$steadyCompletePin = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:1"
$steadyCompleteBaseline = [pscustomobject]@{ variables = [pscustomobject]@{
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = $steadyCompletePin }
    migration_image = [pscustomobject]@{ value = $recoveryMigrationImage }
  } }
$steadyCompleteMetadata = New-TestRecoveryMetadata "4"
$steadyCompleteMetadata.ReleaseSourceSha = $operatorCommit
$steadyCompleteMetadata.OperatorSourceSha = $operatorCommit
$steadyCompleteMetadata.OperatorDeltaSha256 = "5" * 64
$steadyCompleteMetadata.Stage = "complete-dark"
$steadyCompleteMetadata.ReceiptSha256 = $completeDarkRecoveryReceiptSha256
$steadyCompleteMetadata.ParserQualifiedArn = $steadyCompletePin
$steadyCompleteMetadata.StateSerial = $completeDarkRecoveryCurrentStateSerial
Assert-CurrentDocumentBaselineMetadata -Metadata $steadyCompleteMetadata -Baseline $steadyCompleteBaseline `
  -ResolvedPlanPath $recoveryPlanPath -PlanSha256 $recoveryPlanSha -AppliedStage "complete-dark" `
  -ReceiptSha256 $completeDarkRecoveryReceiptSha256 -StateIdentity $recoveryStateIdentity `
  -ReleaseSourceSha $operatorCommit -OperatorSourceSha $operatorCommit `
  -OperatorDeltaSha256 ("5" * 64)

foreach ($operation in @("Plan", "Apply")) {
  $rejected = $false
  try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") -Operation $operation }
  catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark ParserDark-baseline recovery accepted Action $operation." }
}
foreach ($stageCase in @(
    [pscustomobject]@{ Label = "wrong requested stage"; Requested = "parser-dark"; Applied = "complete-dark" },
    [pscustomobject]@{ Label = "wrong live stage"; Requested = "complete-dark"; Applied = "parser-dark" }
  )) {
  $rejected = $false
  try {
    Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") `
      -RequestedStage $stageCase.Requested -AppliedStage $stageCase.Applied
  } catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted $($stageCase.Label)." }
}

foreach ($metadataMutation in @(
    [pscustomobject]@{ Label = "baseline stage"; Property = "Stage"; Value = "complete-dark" },
    [pscustomobject]@{ Label = "baseline release source"; Property = "ReleaseSourceSha"; Value = ("1" * 40) },
    [pscustomobject]@{ Label = "baseline operator source"; Property = "OperatorSourceSha"; Value = ("2" * 40) },
    [pscustomobject]@{ Label = "stored release delta"; Property = "OperatorDeltaSha256"; Value = ("3" * 64) },
    [pscustomobject]@{ Label = "baseline receipt"; Property = "ReceiptSha256"; Value = ("4" * 64) },
    [pscustomobject]@{ Label = "baseline serial regression"; Property = "StateSerial"; Value = 102 },
    [pscustomobject]@{ Label = "baseline serial advance"; Property = "StateSerial"; Value = 104 },
    [pscustomobject]@{ Label = "baseline lineage"; Property = "StateLineage"; Value = "12345678-1234-1234-1234-123456789abc" }
  )) {
  $badMetadata = New-TestRecoveryMetadata "4"
  $badMetadata.($metadataMutation.Property) = $metadataMutation.Value
  $rejected = $false
  try { Assert-TestRecoveryAccepted -Metadata $badMetadata } catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted '$($metadataMutation.Label)' tampering." }
}

foreach ($currentStateMutation in @(
    [pscustomobject]@{ Label = "current state regression"; Lineage = $completeDarkRecoveryStateLineage; Serial = 105 },
    [pscustomobject]@{ Label = "current state advance"; Lineage = $completeDarkRecoveryStateLineage; Serial = 107 },
    [pscustomobject]@{ Label = "current state lineage"; Lineage = "12345678-1234-1234-1234-123456789abc"; Serial = 106 }
  )) {
  $rejected = $false
  try {
    Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") `
      -StateIdentity ([pscustomobject]@{ Lineage = $currentStateMutation.Lineage; Serial = $currentStateMutation.Serial })
  } catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted '$($currentStateMutation.Label)'." }
}

foreach ($deltaCase in @(
    [pscustomobject]@{ Label = "missing baseline-to-current delta"; Variable = "baseline"; Value = "" },
    [pscustomobject]@{ Label = "wrong baseline-to-current delta"; Variable = "baseline"; Value = ("8" * 64) },
    [pscustomobject]@{ Label = "missing release-to-current delta"; Variable = "release"; Value = "" },
    [pscustomobject]@{ Label = "wrong release-to-current delta"; Variable = "release"; Value = ("9" * 64) }
  )) {
  $savedBaselineDelta = $ReviewedBaselineToOperatorDeltaSha256
  $savedReleaseDelta = $ReviewedOperatorDeltaSha256
  try {
    if ($deltaCase.Variable -ceq "baseline") { $script:ReviewedBaselineToOperatorDeltaSha256 = $deltaCase.Value }
    else { $script:ReviewedOperatorDeltaSha256 = $deltaCase.Value }
    $rejected = $false
    try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") } catch { $rejected = $true }
    if (-not $rejected) { throw "CompleteDark Verify recovery accepted '$($deltaCase.Label)'." }
  }
  finally {
    $script:ReviewedBaselineToOperatorDeltaSha256 = $savedBaselineDelta
    $script:ReviewedOperatorDeltaSha256 = $savedReleaseDelta
  }
}
foreach ($pair in @(
    "$completeDarkRecoveryBaselineOperatorSourceSha->$operatorCommit",
    "$completeDarkRecoveryReleaseSourceSha->$operatorCommit"
  )) {
  $script:rejectedRecoveryDeltaPair = $pair
  $rejected = $false
  try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") } catch { $rejected = $true }
  $script:rejectedRecoveryDeltaPair = ""
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted nonancestor delta '$pair'." }
}

$tamperedBaselinePin = $recoveryBaseline | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$tamperedBaselinePin.variables.document_parser_invocation_qualified_arn.value =
  "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:1"
$tamperedBaselinePinRejected = $false
try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") -Baseline $tamperedBaselinePin }
catch { $tamperedBaselinePinRejected = $true }
if (-not $tamperedBaselinePinRejected) { throw "CompleteDark Verify recovery accepted a nonempty ParserDark baseline pin." }

foreach ($artifactCase in @("baseline-parser-source", "baseline-processor", "current-parser-source", "current-processor-source")) {
  $badBaseline = $recoveryBaseline | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $badReceipt = $recoveryReceipt | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  switch ($artifactCase) {
    "baseline-parser-source" { $badBaseline.variables.document_parser_artifact_s3_key.value = $badBaseline.variables.document_parser_artifact_s3_key.value -replace $completeDarkRecoveryBaselineReleaseSourceSha, $completeDarkRecoveryReleaseSourceSha }
    "baseline-processor" { $badBaseline.variables.document_processor_artifact_sha256.value = "1" * 64 }
    "current-parser-source" { $badReceipt.artifacts[0].key = $badReceipt.artifacts[0].key -replace $completeDarkRecoveryReleaseSourceSha, $completeDarkRecoveryBaselineReleaseSourceSha }
    "current-processor-source" { $badReceipt.artifacts[1].key = $badReceipt.artifacts[1].key -replace $completeDarkRecoveryReleaseSourceSha, $completeDarkRecoveryBaselineReleaseSourceSha }
  }
  $rejected = $false
  try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") -Baseline $badBaseline -Receipt $badReceipt }
  catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted '$artifactCase' tampering." }
}

$savedRecoveryRelease = $releaseCommit
$savedRecoveryReceiptSha = $ReviewedReceiptSha256
try {
  foreach ($bindingCase in @("release", "receipt")) {
    if ($bindingCase -ceq "release") { $script:releaseCommit = "1" * 40 }
    else { $script:ReviewedReceiptSha256 = "2" * 64 }
    $rejected = $false
    try { Assert-TestRecoveryAccepted -Metadata (New-TestRecoveryMetadata "4") } catch { $rejected = $true }
    if (-not $rejected) { throw "CompleteDark Verify recovery accepted wrong current $bindingCase binding." }
    $script:releaseCommit = $savedRecoveryRelease
    $script:ReviewedReceiptSha256 = $savedRecoveryReceiptSha
  }
}
finally {
  $script:releaseCommit = $savedRecoveryRelease
  $script:ReviewedReceiptSha256 = $savedRecoveryReceiptSha
}

$script:testAppliedProcessorPin = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:1"
function Get-StateResourceMap {
  return @{
    "module.platform.aws_lambda_function.document_processor[0]" = [pscustomobject]@{
      environment = @([pscustomobject]@{
          variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $script:testAppliedProcessorPin }
        })
    }
  }
}
if ((Get-AppliedProcessorParserQualifiedArn) -cne $script:testAppliedProcessorPin) {
  throw "CompleteDark Verify recovery did not derive the exact applied parser v1 pin."
}
foreach ($badPin in @("", "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser",
    "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:2",
    "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:development",
    "arn:aws:lambda:us-east-2:000000000000:function:ai-job-apply-development-document-parser:1")) {
  $script:testAppliedProcessorPin = $badPin
  $rejected = $false
  try { $null = Get-AppliedProcessorParserQualifiedArn } catch { $rejected = $true }
  if (-not $rejected) { throw "CompleteDark Verify recovery accepted invalid applied processor pin '$badPin'." }
}

Write-Output "Development document staged operator tests passed."
