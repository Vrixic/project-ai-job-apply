$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-migration.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$tokens,
  [ref]$errors
)
if (@($errors).Count -ne 0) { throw "The development migration operator did not parse." }
if ($source -notmatch 'if \(Test-Path -LiteralPath \$driftPlan -PathType Leaf\)\s*\{\s*\$planOwnedByInvocation = \$true' -or
    $source -match 'if \(\$driftExit -eq 0 -and \(Test-Path -LiteralPath \$driftPlan') {
  throw "Unexpected Terraform exit plans are not marked owned before exit validation and cleanup."
}
if ($source -notmatch 'Assert-RetainedMigrationBaselinePlan -Plan \$driftJson') {
  throw "Post-migration Verify does not route its retained plan through the shared provider-drift guard."
}
if ($source -notmatch 'ConvertTo-DeploymentCanonicalValue -Value \$beforeContainer' -or
    $source -notmatch 'ConvertTo-DeploymentCanonicalValue -Value \$afterContainer' -or
    $source -match 'ConvertTo-DeploymentCanonicalValue -Value \$(?:before|after)Container[^\r\n]*-SortArrays') {
  throw "The migration container comparison must canonicalize object keys without sorting arrays."
}

$currentJobsSuccessMarker =
  "Jobs migrations through 0004_job_search applied and verified."
$retiredJobsSuccessMarker =
  "Jobs migrations through 0003_duplicate_resolution_audit_guard applied and verified."
if (-not $source.Contains($currentJobsSuccessMarker)) {
  throw "The development migration operator does not require the current Jobs migration marker."
}
if ($source.Contains($retiredJobsSuccessMarker)) {
  throw "The development migration operator still accepts the retired Jobs migration marker."
}

$pathFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Resolve-OperatorPath"
    }, $true))
if ($pathFunctions.Count -ne 1) { throw "Resolve-OperatorPath must be defined exactly once." }
Invoke-Expression $pathFunctions[0].Extent.Text

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-migration"

$relative = Resolve-OperatorPath `
  -Candidate ".terraform\development-document-migration\test.json" `
  -RequireOperatorRoot
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "test.json"))
if ($relative -cne $expected) { throw "The relative operator path did not resolve exactly." }

$absolute = Resolve-OperatorPath -Candidate $expected -RequireOperatorRoot
if ($absolute -cne $expected) { throw "The absolute operator path did not resolve exactly." }

$traversalRejected = $false
try {
  $null = Resolve-OperatorPath -Candidate "..\outside.tfplan"
} catch {
  $traversalRejected = $true
}
if (-not $traversalRejected) { throw "The path resolver accepted a traversal outside .terraform." }

$baselineFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "ConvertTo-TerraformEnvironmentValue", "Get-MeaningfulChanges", "Assert-PlanWasApplied",
        "Assert-ExactTaskPlan", "Assert-CurrentGatewayArtifactEvidence",
        "Assert-AcceptedMigrationProviderDrift", "Test-IgnorableRdsRestorableTimeRefresh",
        "Test-IgnorableMigrationTaskTagsRefresh", "Get-UnacceptedVerificationDrift", "Get-OptionalProperty",
        "Test-EcsFaultInjectionDisabled", "Assert-ReleaseSourceBinding",
        "Assert-OperatorOnlyReleaseDelta", "Get-DocumentOperatorDeltaSha256", "Assert-ExecutionIdentity",
        "Assert-DurableClaimPutResult", "Assert-DurableExecutionClaimEvidence",
        "Test-DurableClaimHistoryExists", "Assert-RecoveryOperatorBinding", "Assert-RecoveryOperatorSource",
        "Resolve-TaskLogStreamName",
        "Set-RecoveredReceiptEvidence", "Get-DeclaredVariableNames",
        "Get-CurrentTerraformStateIdentity", "Assert-ExactCurrentBaselineVariableSet",
        "Assert-RetainedMigrationBaselinePlan", "Assert-RetainedBaselineCurrentState",
        "Read-RetainedMigrationBaseline", "Assert-TaskMetadataBaselineBinding",
        "Get-FileSha256", "Get-TextSha256", "Write-JsonFile", "Get-ExactStringPlanVariable",
        "New-PostMigrationBaselineMetadata", "Assert-PostMigrationBaselineMetadata",
        "Save-PostMigrationBaselineMetadata", "Remove-NewPostMigrationBaselineArtifacts"
      )
    }, $true))
if ($baselineFunctions.Count -ne 37) { throw "The input, plan, and retained-handoff guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$logTask = [pscustomobject]@{ taskArn = "arn:aws:ecs:us-east-2:111122223333:task/cluster/$('a' * 32)" }
$logContainer = [pscustomobject]@{ name = "database-migration" }
$logDefinition = [pscustomobject]@{ containerDefinitions = @([pscustomobject]@{
      name = "database-migration"
      logConfiguration = [pscustomobject]@{ options = [pscustomobject]@{
          'awslogs-stream-prefix' = "migration"
        } }
    }) }
$derivedLogStream = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer `
  -TaskDefinition $logDefinition
if ($derivedLogStream -cne "migration/database-migration/$('a' * 32)") {
  throw "The omitted ECS log stream did not resolve deterministically."
}
$logContainer | Add-Member -NotePropertyName logStreamName -NotePropertyValue $derivedLogStream
$null = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer -TaskDefinition $logDefinition
$logContainer.logStreamName = "wrong"
$wrongLogStreamRejected = $false
try {
  $null = Resolve-TaskLogStreamName -Task $logTask -Container $logContainer `
    -TaskDefinition $logDefinition
} catch { $wrongLogStreamRejected = $true }
if (-not $wrongLogStreamRejected) { throw "An unexpected ECS log stream was accepted." }

$submittedReceipt = [pscustomobject]@{ phase = "submitted" }
$finalizedReceipt = Set-RecoveredReceiptEvidence -Receipt $submittedReceipt `
  -StoppedAt ([datetime]::Parse("2026-08-12T23:00:00Z")) `
  -RecoveryOperatorSourceSha ("c" * 40)
if ([string]$finalizedReceipt.phase -cne "verified" -or [int]$finalizedReceipt.exitCode -ne 0 -or
    [string]$finalizedReceipt.stoppedAt -cne "2026-08-12T23:00:00.0000000Z" -or
    [string]$finalizedReceipt.recoveredByOperatorSourceSha -cne ("c" * 40)) {
  throw "The submitted recovery receipt was not finalized exactly."
}
$repeatFinalizationRejected = $false
try {
  $null = Set-RecoveredReceiptEvidence -Receipt $finalizedReceipt `
    -StoppedAt ([datetime]::UtcNow) -RecoveryOperatorSourceSha ("c" * 40)
} catch { $repeatFinalizationRejected = $true }
if (-not $repeatFinalizationRejected) { throw "A finalized receipt was recoverable twice." }

$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"

$emptyClaimHistory = [pscustomobject]@{}
if (Test-DurableClaimHistoryExists -History $emptyClaimHistory -ClaimKey "claim") {
  throw "An omitted S3 claim-history list was treated as an existing claim."
}
if (Test-DurableClaimHistoryExists -History ([pscustomobject]@{ Versions = @() }) -ClaimKey "claim") {
  throw "An explicit empty S3 version list was treated as an existing claim."
}
if (Test-DurableClaimHistoryExists -History ([pscustomobject]@{
      Versions = @($null)
      DeleteMarkers = @($null)
    }) -ClaimKey "claim") {
  throw "A null S3 history entry was treated as an existing claim."
}
foreach ($history in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = "claim" }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = "claim" }) }
  )) {
  if (-not (Test-DurableClaimHistoryExists -History $history -ClaimKey "claim")) {
    throw "Existing durable claim history was not rejected."
  }
}

$releaseSource = "a" * 40
$operatorSource = "b" * 40
Assert-ReleaseSourceBinding -ReleaseSourceSha $operatorSource -OperatorSourceSha $operatorSource
Assert-ReleaseSourceBinding -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource `
  -AllowAncestor -IsAncestor $true

foreach ($unsafeBinding in @(
    @{ release = $releaseSource; operator = $operatorSource; allow = $false; ancestor = $true },
    @{ release = $releaseSource; operator = $operatorSource; allow = $true; ancestor = $false },
    @{ release = "invalid"; operator = $operatorSource; allow = $true; ancestor = $true }
  )) {
  $bindingRejected = $false
  try {
    Assert-ReleaseSourceBinding -ReleaseSourceSha $unsafeBinding.release `
      -OperatorSourceSha $unsafeBinding.operator -AllowAncestor:$unsafeBinding.allow `
      -IsAncestor:$unsafeBinding.ancestor
  } catch {
    $bindingRejected = $true
  }
  if (-not $bindingRejected) { throw "An unsafe release/operator source binding was accepted." }
}

Assert-OperatorOnlyReleaseDelta -ChangeRecords @(
  "M`tscripts/operate-development-document-migration.ps1",
  "M`tscripts/tests/development-document-migration-operator.tests.ps1",
  "M`tscripts/validate-serverless-workflow-infrastructure.mjs",
  "M`tinfrastructure/runbooks/deployments/database-migration.md"
)
Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $releaseSource `
  -CurrentOperatorSourceSha $operatorSource -IsAncestor $true -ChangeRecords @(
    "M`tscripts/operate-development-document-migration.ps1"
  )
Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $operatorSource `
  -CurrentOperatorSourceSha $operatorSource -IsAncestor $true -ChangeRecords @()
foreach ($unsafeRecovery in @(
    @{ ancestor = $false; changes = @("M`tscripts/operate-development-document-migration.ps1") },
    @{ ancestor = $true; changes = @("M`tbackend/services/profile/src/index.ts") }
  )) {
  $recoveryRejected = $false
  try {
    Assert-RecoveryOperatorBinding -ExecutionOperatorSourceSha $releaseSource `
      -CurrentOperatorSourceSha $operatorSource -IsAncestor:$unsafeRecovery.ancestor `
      -ChangeRecords $unsafeRecovery.changes
  } catch { $recoveryRejected = $true }
  if (-not $recoveryRejected) { throw "An unsafe recovery operator source was accepted." }
}
foreach ($unsafeDelta in @(
    , @("M`tinfrastructure/terraform/environments/development/main.tf"),
    , @("A`tscripts/operate-development-document-migration.ps1"),
    , @()
  )) {
  $deltaRejected = $false
  try { Assert-OperatorOnlyReleaseDelta -ChangeRecords $unsafeDelta } catch { $deltaRejected = $true }
  if (-not $deltaRejected) { throw "A non-verifier release delta was accepted." }
}

$originalRepositoryRoot = $repositoryRoot
$operatorSourceVariableExisted = Test-Path -LiteralPath Variable:\operatorSourceSha
if ($operatorSourceVariableExisted) { $originalOperatorSourceSha = $operatorSourceSha }
$mockExecutionOperatorSourceSha = "c" * 40
$mockCurrentOperatorSourceSha = "d" * 40
$script:recoveryGitMode = "exact"
$script:recoveryGitDiffCalls = 0
$script:recoveryGitCatFileCalls = 0
function git {
  $arguments = @($args)
  if ($arguments -contains "merge-base") {
    $global:LASTEXITCODE = 0
    return
  }
  if ($arguments -contains "diff") {
    $script:recoveryGitDiffCalls++
    $global:LASTEXITCODE = 0
    if ($script:recoveryGitMode -ceq "valid") {
      return "M`tscripts/operate-development-document-migration.ps1"
    }
    if ($script:recoveryGitMode -ceq "invalid") {
      return "M`tbackend/services/profile/src/index.ts"
    }
    throw "The exact-current recovery path unexpectedly inspected a Git delta."
  }
  if ($arguments -contains "cat-file") {
    $script:recoveryGitCatFileCalls++
    $global:LASTEXITCODE = 0
    return "blob"
  }
  $global:LASTEXITCODE = 1
  throw "Unexpected mocked Git invocation: $($arguments -join ' ')"
}
try {
  $repositoryRoot = "mock-repository-root"
  $operatorSourceSha = $mockCurrentOperatorSourceSha

  Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockCurrentOperatorSourceSha
  if ($script:recoveryGitDiffCalls -ne 0 -or $script:recoveryGitCatFileCalls -ne 0) {
    throw "Exact-current recovery inspected a nonexistent operator delta."
  }

  $script:recoveryGitMode = "valid"
  Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockExecutionOperatorSourceSha
  if ($script:recoveryGitDiffCalls -ne 1 -or $script:recoveryGitCatFileCalls -ne 2) {
    throw "Allowlisted ancestor recovery did not inspect the exact nonempty blob delta."
  }

  $script:recoveryGitMode = "invalid"
  $invalidIntegratedRecoveryRejected = $false
  try {
    Assert-RecoveryOperatorSource -ExecutionOperatorSourceSha $mockExecutionOperatorSourceSha
  } catch {
    $invalidIntegratedRecoveryRejected = $true
  }
  if (-not $invalidIntegratedRecoveryRejected) {
    throw "The integrated recovery path accepted a non-verifier operator delta."
  }
} finally {
  Remove-Item -LiteralPath Function:\git -Force
  $repositoryRoot = $originalRepositoryRoot
  if ($operatorSourceVariableExisted) {
    $operatorSourceSha = $originalOperatorSourceSha
  } else {
    Remove-Variable -Name operatorSourceSha -ErrorAction SilentlyContinue
  }
  Remove-Variable -Name recoveryGitMode -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name recoveryGitDiffCalls -Scope Script -ErrorAction SilentlyContinue
  Remove-Variable -Name recoveryGitCatFileCalls -Scope Script -ErrorAction SilentlyContinue
}

$executionIdentity = [pscustomobject]@{
  schemaVersion = 2
  kind = "development-document-migration-execution"
  sourceSha = $releaseSource
  operatorSourceSha = $operatorSource
}
Assert-ExecutionIdentity -Value $executionIdentity `
  -ExpectedKind "development-document-migration-execution" `
  -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
foreach ($mutation in @(
    @{ property = "schemaVersion"; value = 1 },
    @{ property = "operatorSourceSha"; value = $releaseSource },
    @{ property = "sourceSha"; value = $operatorSource }
  )) {
  $invalidIdentity = $executionIdentity | ConvertTo-Json | ConvertFrom-Json
  $invalidIdentity.($mutation.property) = $mutation.value
  $identityRejected = $false
  try {
    Assert-ExecutionIdentity -Value $invalidIdentity `
      -ExpectedKind "development-document-migration-execution" `
      -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
  } catch { $identityRejected = $true }
  if (-not $identityRejected) { throw "Mismatched execution evidence was accepted." }
}

$receiptIdentity = [pscustomobject]@{
  schemaVersion = 2
  kind = "development-document-migration-receipt"
  sourceSha = $releaseSource
  operatorSourceSha = $operatorSource
}
Assert-ExecutionIdentity -Value $receiptIdentity `
  -ExpectedKind "development-document-migration-receipt" `
  -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
$receiptIdentity.operatorSourceSha = $releaseSource
$receiptRejected = $false
try {
  Assert-ExecutionIdentity -Value $receiptIdentity `
    -ExpectedKind "development-document-migration-receipt" `
    -ReleaseSourceSha $releaseSource -OperatorSourceSha $operatorSource
} catch { $receiptRejected = $true }
if (-not $receiptRejected) { throw "A receipt from a different operator revision was accepted." }

$claimChecksum = [Convert]::ToBase64String([byte[]](0..31))
Assert-DurableClaimPutResult -ExitCode 0 `
  -PutResult ([pscustomobject]@{ VersionId = "version"; ChecksumSHA256 = $claimChecksum }) `
  -ExpectedChecksum $claimChecksum
foreach ($claimResult in @(
    @{ exitCode = 1; value = $null },
    @{ exitCode = 0; value = [pscustomobject]@{ VersionId = ""; ChecksumSHA256 = $claimChecksum } },
    @{ exitCode = 0; value = [pscustomobject]@{ VersionId = "version"; ChecksumSHA256 = "wrong" } }
  )) {
  $claimRejected = $false
  try {
    Assert-DurableClaimPutResult -ExitCode $claimResult.exitCode -PutResult $claimResult.value `
      -ExpectedChecksum $claimChecksum
  } catch { $claimRejected = $true }
  if (-not $claimRejected) { throw "A replayed or non-versioned execution claim was accepted." }
}

$claimVersion = "claim-version"
$claimKmsArn = "arn:aws:kms:us-east-2:111122223333:key/00000000-0000-0000-0000-000000000000"
$claimHead = [pscustomobject]@{
  ServerSideEncryption = "aws:kms"
  SSEKMSKeyId = $claimKmsArn
  BucketKeyEnabled = $true
  ContentLength = 10
  VersionId = $claimVersion
  ChecksumSHA256 = $claimChecksum
  Metadata = [pscustomobject]@{
    'execution-plan-sha256' = "f" * 64
    'source-sha' = $releaseSource
    'operator-source-sha' = $operatorSource
  }
}
Assert-DurableExecutionClaimEvidence -Head $claimHead -ClaimVersion $claimVersion `
  -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
  -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
  -OperatorSourceSha $operatorSource
$historicalClaimHead = $claimHead | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historicalClaimHead.Metadata.'operator-source-sha' = $releaseSource
Assert-DurableExecutionClaimEvidence -Head $historicalClaimHead -ClaimVersion $claimVersion `
  -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
  -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
  -OperatorSourceSha $releaseSource
$historicalClaimMismatchRejected = $false
try {
  Assert-DurableExecutionClaimEvidence -Head $historicalClaimHead -ClaimVersion $claimVersion `
    -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
    -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
    -OperatorSourceSha $operatorSource
} catch { $historicalClaimMismatchRejected = $true }
if (-not $historicalClaimMismatchRejected) {
  throw "A historical claim was accepted as belonging to the current recovery operator."
}
foreach ($case in @(
    @{ property = "ChecksumSHA256"; value = "wrong" },
    @{ property = "SSEKMSKeyId"; value = "$claimKmsArn-wrong" },
    @{ property = "VersionId"; value = "wrong" },
    @{ property = "Metadata"; value = [pscustomobject]@{
        'execution-plan-sha256' = "e" * 64
        'source-sha' = $releaseSource
        'operator-source-sha' = $operatorSource
      } }
  )) {
  $badClaimHead = $claimHead | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badClaimHead.($case.property) = $case.value
  $claimEvidenceRejected = $false
  try {
    Assert-DurableExecutionClaimEvidence -Head $badClaimHead -ClaimVersion $claimVersion `
      -ExecutionPlanSha256 ("f" * 64) -ExpectedChecksum $claimChecksum `
      -ExpectedKmsKeyArn $claimKmsArn -ReleaseSourceSha $releaseSource `
      -OperatorSourceSha $operatorSource
  } catch { $claimEvidenceRejected = $true }
  if (-not $claimEvidenceRejected) { throw "Invalid durable claim evidence was accepted." }
}

$zeroChangePlan = [pscustomobject]@{
  complete = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = "example" } }
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
}
Assert-PlanWasApplied -Plan $zeroChangePlan

$refreshOnlyPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$refreshOnlyPlan.resource_drift = @(
  [pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } }
)
Assert-PlanWasApplied -Plan $refreshOnlyPlan

$changeRejected = $false
$changedPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$changedPlan.resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
try {
  Assert-PlanWasApplied -Plan $changedPlan
} catch {
  $changeRejected = $true
}
if (-not $changeRejected) { throw "The input baseline accepted an unapplied resource change." }

$retainedVariables = [pscustomobject]@{}
foreach ($name in @(Get-DeclaredVariableNames)) {
  $retainedVariables | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{ value = "test" })
}
$retainedVariables.document_processing_deployment_stage.value = "parser-dark"
$retainedVariables.document_parser_invocation_qualified_arn.value = ""
$retainedPlan = [pscustomobject]@{
  complete = $true
  applyable = $false
  errored = $false
  terraform_version = "1.9.8"
  variables = $retainedVariables
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
  output_changes = [pscustomobject]@{}
}

function New-MigrationDriftRecord([string]$Address, [string]$Type, [object]$Before, [object]$After,
  [object]$BeforeSensitive = ([pscustomobject]@{}), [object]$AfterSensitive = ([pscustomobject]@{})) {
  return [pscustomobject]@{
    address = $Address; mode = "managed"; type = $Type
    change = [pscustomobject]@{
      actions = @("update"); before = $Before; after = $After; after_unknown = [pscustomobject]@{}
      before_sensitive = $BeforeSensitive; after_sensitive = $AfterSensitive; replace_paths = @()
    }
  }
}
function New-MigrationTagDriftRecord([string]$Address, [string]$Type) {
  return New-MigrationDriftRecord $Address $Type `
    ([pscustomobject]@{ id = $Address; tags = $null }) `
    ([pscustomobject]@{ id = $Address; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
function New-MigrationTestPolicy([object[]]$Statements) {
  return @{ Version = "2012-10-17"; Statement = $Statements } | ConvertTo-Json -Compress -Depth 40
}
function New-MigrationQueuePolicy([string]$Sid, [string]$QueueName, [string[]]$RuleNames,
  [string]$AccountId) {
  return New-MigrationTestPolicy @(@{
      Sid = $Sid; Effect = "Allow"; Action = "sqs:SendMessage"
      Resource = "arn:aws:sqs:us-east-2:${AccountId}:$QueueName"
      Principal = @{ Service = "events.amazonaws.com" }
      Condition = @{
        StringEquals = @{ "aws:SourceAccount" = $AccountId }
        ArnEquals = @{ "aws:SourceArn" = @($RuleNames | ForEach-Object {
              "arn:aws:events:us-east-2:${AccountId}:rule/$_"
            }) }
      }
    })
}

$driftAccount = "111122223333"
$driftKmsArn = "arn:aws:kms:us-east-2:${driftAccount}:key/00000000-0000-0000-0000-000000000001"
$driftBucketArn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-${driftAccount}"
$driftMalwareRole = "arn:aws:iam::${driftAccount}:role/ai-job-apply-development-document-malware-scan"
$parserPolicy = New-MigrationTestPolicy @(
  @{ Sid = "ManageVpcInterfaces"; Effect = "Allow"; Action = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); Resource = "*" },
  @{ Sid = "DecryptLambdaEnvironment"; Effect = "Allow"; Action = "kms:Decrypt"; Resource = $driftKmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "lambda.us-east-2.amazonaws.com" } } }
)
$objectPolicy = New-MigrationTestPolicy @(
  @{ Sid = "SessionPolicyMustNarrowObjectAccess"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObject"); Resource = @("$driftBucketArn/quarantine/*", "$driftBucketArn/normalized/*") },
  @{ Sid = "EncryptAndDecryptViaS3Only"; Effect = "Allow"; Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = $driftKmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "s3.us-east-2.amazonaws.com" } } }
)
$parserInline = @([pscustomobject]@{ name = "document-parser-runtime"; policy = $parserPolicy })
$objectInline = @([pscustomobject]@{ name = "document-object-access-runtime"; policy = $objectPolicy })
$candidateDeny = @{
  Sid = "DenyQuarantineReadsWithoutCleanMalwareTag"; Effect = "Deny"
  Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$driftBucketArn/quarantine/*"; Principal = "*"
  Condition = @{
    StringNotEquals = @{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "NO_THREATS_FOUND" }
    ArnNotEquals = @{ "aws:PrincipalArn" = $driftMalwareRole }
  }
}
$s3Base = @(
  @{ Sid = "DenyInsecureTransport"; Effect = "Deny" },
  @{ Sid = "DenyWrongEncryptionMode"; Effect = "Deny" },
  @{ Sid = "DenyWrongEncryptionKey"; Effect = "Deny" }
)
$s3Before = New-MigrationTestPolicy $s3Base
$s3After = New-MigrationTestPolicy @($s3Base + $candidateDeny)
$snsAdded = @{
  Sid = "AllowExactDocumentOperationalRules"; Effect = "Allow"; Action = "SNS:Publish"
  Resource = "arn:aws:sns:us-east-2:${driftAccount}:ai-job-apply-development-operational-alerts"
  Principal = @{ Service = "events.amazonaws.com" }
  Condition = @{
    StringEquals = @{ "aws:SourceAccount" = $driftAccount }
    ArnEquals = @{ "aws:SourceArn" = @(
        "arn:aws:events:us-east-2:${driftAccount}:rule/ai-job-apply-development-document-scan-tag-failure",
        "arn:aws:events:us-east-2:${driftAccount}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
      ) }
  }
}
$snsBase = @(
  @{ Sid = "AllowAccountAdministration"; Effect = "Allow" },
  @{ Sid = "AllowCloudWatchAlarmPublishing"; Effect = "Allow" },
  @{ Sid = "AllowAwsBudgetsPublishing"; Effect = "Allow" }
)
$snsBefore = New-MigrationTestPolicy $snsBase
$snsAfter = New-MigrationTestPolicy @($snsBase + $snsAdded)
$deliveryPolicy = New-MigrationQueuePolicy "ExactEventBridgeRuleDeadLettersOnly" `
  "ai-job-apply-development-document-scan-delivery-dlq" `
  @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure", "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler") $driftAccount
$resultsPolicy = New-MigrationQueuePolicy "ExactGuardDutyResultRuleOnly" `
  "ai-job-apply-development-document-scan-results" @("ai-job-apply-development-document-scan-results") $driftAccount

$fullProviderDrift = @()
foreach ($address in @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]"
  )) { $fullProviderDrift += New-MigrationTagDriftRecord $address "aws_cloudwatch_event_rule" }
foreach ($address in @(
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_security_contradiction[0]"
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $address "aws_cloudwatch_log_metric_filter" `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = $null }) }) `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = [pscustomobject]@{} }) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{}) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{ dimensions = [pscustomobject]@{} }) })
}
$dimensionAlarms = @("document_processing_record_failed", "document_processing_timed_out", "document_security_contradiction")
foreach ($name in @(
    "document_parser_errors", "document_processing_record_failed", "document_processing_timed_out",
    "document_processor_errors", "document_scan_dead_letter", "document_scan_delivery_dead_letter",
    "document_scan_queue_age", "document_security_contradiction"
  )) {
  $address = "module.platform.aws_cloudwatch_metric_alarm.$name[0]"
  $before = [ordered]@{ id = $address; insufficient_data_actions = $null; tags = $null }
  $after = [ordered]@{ id = $address; insufficient_data_actions = @(); tags = [pscustomobject]@{} }
  $beforeSensitive = [ordered]@{ tags_all = [pscustomobject]@{} }
  $afterSensitive = [ordered]@{ insufficient_data_actions = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }
  if ($name -cin $dimensionAlarms) {
    $before.dimensions = $null; $after.dimensions = [pscustomobject]@{}; $afterSensitive.dimensions = [pscustomobject]@{}
  } else {
    $before.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $after.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $beforeSensitive.dimensions = [pscustomobject]@{}; $afterSensitive.dimensions = [pscustomobject]@{}
  }
  $fullProviderDrift += New-MigrationDriftRecord $address "aws_cloudwatch_metric_alarm" `
    ([pscustomobject]$before) ([pscustomobject]$after) `
    ([pscustomobject]$beforeSensitive) ([pscustomobject]$afterSensitive)
}
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_db_instance.postgres[0]" "aws_db_instance" `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:00Z" }) `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:01Z" })
foreach ($role in @(
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser[0]"; Inline = $parserInline },
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser_object_access[0]"; Inline = $objectInline }
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $role.Address "aws_iam_role" `
    ([pscustomobject]@{ id = $role.Address; inline_policy = @(); tags = $null }) `
    ([pscustomobject]@{ id = $role.Address; inline_policy = $role.Inline; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @(); managed_policy_arns = @(); tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @([pscustomobject]@{}); managed_policy_arns = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_iam_role.document_processor[0]" "aws_iam_role"
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_lambda_function.document_parser[0]" "aws_lambda_function" `
  ([pscustomobject]@{ id = "parser"; layers = $null; tags = $null }) `
  ([pscustomobject]@{ id = "parser"; layers = @(); tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ layers = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_s3_bucket.candidate_documents[0]" "aws_s3_bucket" `
  ([pscustomobject]@{ id = "candidate"; policy = $s3Before }) `
  ([pscustomobject]@{ id = "candidate"; policy = $s3After })
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_security_group.document_parser[0]" "aws_security_group"
$fullProviderDrift += New-MigrationDriftRecord "module.platform.aws_sns_topic.operational_alerts" "aws_sns_topic" `
  ([pscustomobject]@{ id = "alerts"; policy = $snsBefore }) `
  ([pscustomobject]@{ id = "alerts"; policy = $snsAfter })
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_sqs_queue.document_scan_dead_letter[0]" "aws_sqs_queue"
foreach ($queue in @(
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; Policy = $deliveryPolicy },
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_results[0]"; Policy = $resultsPolicy }
  )) {
  $fullProviderDrift += New-MigrationDriftRecord $queue.Address "aws_sqs_queue" `
    ([pscustomobject]@{ id = $queue.Address; policy = ""; tags = $null }) `
    ([pscustomobject]@{ id = $queue.Address; policy = $queue.Policy; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$fullProviderDrift += New-MigrationTagDriftRecord "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" "aws_vpc_endpoint"
if ($fullProviderDrift.Count -ne 27 -or
    @($fullProviderDrift | ForEach-Object address | Sort-Object -Unique).Count -ne 27) {
  throw "The migration consumer full provider-normalization fixture is not exactly 27 unique records."
}
$driftRoot = [pscustomobject]@{ resources = @(
    [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $driftKmsArn } },
    [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser[0]"; values = [pscustomobject]@{ inline_policy = $parserInline } },
    [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser_object_access[0]"; values = [pscustomobject]@{ inline_policy = $objectInline } },
    [pscustomobject]@{ address = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; values = [pscustomobject]@{ policy = $s3After } },
    [pscustomobject]@{ address = "module.platform.aws_sns_topic_policy.operational_alerts"; values = [pscustomobject]@{ policy = $snsAfter } },
    [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; values = [pscustomobject]@{ policy = $deliveryPolicy } },
    [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_results[0]"; values = [pscustomobject]@{ policy = $resultsPolicy } }
  ) }
$retainedPlan.planned_values.root_module = $driftRoot
$retainedPlan.resource_drift = $fullProviderDrift
Assert-RetainedMigrationBaselinePlan -Plan $retainedPlan
foreach ($record in $fullProviderDrift) {
  $subsetPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $subsetPlan.resource_drift = @($record)
  Assert-RetainedMigrationBaselinePlan -Plan $subsetPlan
}
$ecsTagDrift = New-MigrationTagDriftRecord $migrationAddress "aws_ecs_task_definition"
$ecsSubsetPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$ecsSubsetPlan.resource_drift = @($ecsTagDrift)
Assert-RetainedMigrationBaselinePlan -Plan $ecsSubsetPlan
$rdsSubset = @($fullProviderDrift | Where-Object address -eq "module.platform.aws_db_instance.postgres[0]")[0]
if (-not (Test-IgnorableRdsRestorableTimeRefresh -Drift $rdsSubset) -or
    -not (Test-IgnorableMigrationTaskTagsRefresh -Drift $ecsTagDrift) -or
    @(Get-UnacceptedVerificationDrift -Drift $fullProviderDrift -RootModule $driftRoot).Count -ne 0) {
  throw "The legacy migration drift entry points do not delegate to the shared semantic guard."
}
foreach ($mutation in @("duplicate", "action", "unknown", "sensitive", "other")) {
  $badPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" { $badPlan.resource_drift = @($badPlan.resource_drift) + @($badPlan.resource_drift[0]) }
    "action" { $badPlan.resource_drift[0].change.actions = @("delete", "create") }
    "unknown" { $badPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
    "other" { $badPlan.resource_drift[0].change.after.id = "changed" }
  }
  $rejected = $false
  try { Assert-RetainedMigrationBaselinePlan -Plan $badPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration retained-baseline path accepted '$mutation' provider drift." }
}

$SourceSha = "a" * 40
$operatorSourceSha = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$ExpectedAccountId = "111122223333"
$Region = "us-east-2"
$MigrationImage = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('e' * 64)"
$retainedPlan.variables.migration_image.value = $MigrationImage
$retainedState = [pscustomobject]@{ Lineage = "12345678-1234-1234-1234-123456789abc"; Serial = 51 }
$retainedTaskMetadata = [pscustomobject]@{
  appliedBaselineStage = "parser-dark"
  appliedBaselineReceiptSha256 = "b" * 64
  appliedBaselineParserQualifiedArn = ""
  appliedBaselineReleaseSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
  appliedBaselineOperatorSourceSha = "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
  appliedBaselineOperatorDeltaSha256 = Get-DocumentOperatorDeltaSha256 `
    -ReleaseSha "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8" `
    -OperatorSha "d0e55de86edfa6b5f655f5631bb1741d6c5b5ac8"
}
$postMigrationFullDriftPlan = $retainedPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
Assert-RetainedMigrationBaselinePlan -Plan $postMigrationFullDriftPlan
foreach ($mutation in @("duplicate", "unknown", "sensitive")) {
  $badPostMigrationPlan = $postMigrationFullDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" {
      $badPostMigrationPlan.resource_drift = @($badPostMigrationPlan.resource_drift) +
        @($badPostMigrationPlan.resource_drift[0])
    }
    "unknown" { $badPostMigrationPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badPostMigrationPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
  }
  $rejected = $false
  try { Assert-RetainedMigrationBaselinePlan -Plan $badPostMigrationPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The post-migration retained-plan path accepted '$mutation' provider drift." }
}
$handoffRoot = Join-Path $terraformRoot "post-migration-handoff-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $handoffRoot
try {
  $handoffPlanPath = Join-Path $handoffRoot "verified.tfplan"
  [IO.File]::WriteAllText($handoffPlanPath, "verified-current-plan", [Text.UTF8Encoding]::new($false))
  $handoffPlanSha = Get-FileSha256 -Path $handoffPlanPath
  $handoff = Save-PostMigrationBaselineMetadata -Plan $retainedPlan -PlanPath $handoffPlanPath `
    -PlanSha256 $handoffPlanSha -State $retainedState -TaskMetadata $retainedTaskMetadata
  if ([string]$handoff.Path -cne "$handoffPlanPath.baseline.json" -or
      [string]$handoff.Sha256 -cne (Get-FileSha256 -Path $handoff.Path)) {
    throw "Migration Verify did not emit the exact adjacent retained-baseline handoff."
  }
  $storedHandoff = Get-Content -LiteralPath $handoff.Path -Raw | ConvertFrom-Json
  $expectedLaterOperatorDelta = Get-DocumentOperatorDeltaSha256 `
    -ReleaseSha ([string]$retainedTaskMetadata.appliedBaselineReleaseSourceSha) -OperatorSha $operatorSourceSha
  if ([string]$storedHandoff.OperatorSourceSha -cne $operatorSourceSha -or
    [string]$storedHandoff.OperatorDeltaSha256 -cne $expectedLaterOperatorDelta -or
    [string]$storedHandoff.OperatorDeltaSha256 -ceq [string]$retainedTaskMetadata.appliedBaselineOperatorDeltaSha256) {
    throw "The post-migration handoff did not recompute the release delta for the later execution operator."
  }
  Assert-PostMigrationBaselineMetadata -Metadata $storedHandoff -Plan $retainedPlan `
    -PlanPath $handoffPlanPath -PlanSha256 $handoffPlanSha -State $retainedState `
    -TaskMetadata $retainedTaskMetadata

  foreach ($tamper in @(
      @{ Property = "MigrationImage"; Value = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('f' * 64)" },
      @{ Property = "ReceiptSha256"; Value = "c" * 64 },
      @{ Property = "Stage"; Value = "complete-dark" },
      @{ Property = "ParserQualifiedArn"; Value = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7" },
      @{ Property = "StateSerial"; Value = 52 },
      @{ Property = "PlanSha256"; Value = "d" * 64 },
      @{ Property = "SchemaVersion"; Value = "1" }
    )) {
    $badHandoff = $storedHandoff | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $badHandoff.($tamper.Property) = $tamper.Value
    $tamperRejected = $false
    try {
      Assert-PostMigrationBaselineMetadata -Metadata $badHandoff -Plan $retainedPlan `
        -PlanPath $handoffPlanPath -PlanSha256 $handoffPlanSha -State $retainedState `
        -TaskMetadata $retainedTaskMetadata
    } catch { $tamperRejected = $true }
    if (-not $tamperRejected) { throw "The post-migration handoff accepted tampered $($tamper.Property)." }
  }

  $overwriteRejected = $false
  $collisionPlanSha = Get-FileSha256 -Path $handoffPlanPath
  $collisionMetadataSha = Get-FileSha256 -Path $handoff.Path
  try {
    $null = Save-PostMigrationBaselineMetadata -Plan $retainedPlan -PlanPath $handoffPlanPath `
      -PlanSha256 $handoffPlanSha -State $retainedState -TaskMetadata $retainedTaskMetadata
  } catch { $overwriteRejected = $true }
  if (-not $overwriteRejected -or -not (Test-Path -LiteralPath $handoffPlanPath) -or
      -not (Test-Path -LiteralPath $handoff.Path)) {
    throw "The retained post-migration baseline did not preserve preexisting plan/sidecar bytes."
  }
  if ((Get-FileSha256 -Path $handoffPlanPath) -cne $collisionPlanSha -or
      (Get-FileSha256 -Path $handoff.Path) -cne $collisionMetadataSha) {
    throw "A rejected retained-baseline overwrite changed existing bytes."
  }

  Remove-NewPostMigrationBaselineArtifacts -PlanPath $handoffPlanPath -MetadataPath $handoff.Path `
    -PlanOwned $false -MetadataOwned $false
  if ((Get-FileSha256 -Path $handoffPlanPath) -cne $collisionPlanSha -or
      (Get-FileSha256 -Path $handoff.Path) -cne $collisionMetadataSha) {
    throw "Ownership-aware failure cleanup removed or changed another writer's artifacts."
  }

  # Model Terraform writing the requested plan and then returning detailed exit code 2. Because
  # the target was absent before invocation, Verify owns and must remove both newly-created bytes.
  $cleanupPlan = Join-Path $handoffRoot "unexpected-exit-two.tfplan"
  $cleanupMetadata = "$cleanupPlan.baseline.json"
  [IO.File]::WriteAllText($cleanupPlan, "unexpected-exit-two-plan", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($cleanupMetadata, "unexpected-exit-two-metadata", [Text.UTF8Encoding]::new($false))
  Remove-NewPostMigrationBaselineArtifacts -PlanPath $cleanupPlan -MetadataPath $cleanupMetadata `
    -PlanOwned $true -MetadataOwned $true
  if ((Test-Path -LiteralPath $cleanupPlan) -or (Test-Path -LiteralPath $cleanupMetadata)) {
    throw "Unexpected-exit-two cleanup retained a newly-created migration baseline artifact."
  }
} finally {
  if (Test-Path -LiteralPath $handoffRoot) { Remove-Item -LiteralPath $handoffRoot -Recurse -Force }
}

$missingVariablePlan = $retainedPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$missingVariablePlan.variables.PSObject.Properties.Remove(@(Get-DeclaredVariableNames)[0])
$missingVariableRejected = $false
try { Assert-RetainedMigrationBaselinePlan -Plan $missingVariablePlan }
catch { $missingVariableRejected = $true }
if (-not $missingVariableRejected) { throw "The retained migration baseline accepted a stale variable set." }

$stateMismatchRejected = $false
try {
  Assert-RetainedBaselineCurrentState `
    -Metadata ([pscustomobject]@{ StateLineage = $retainedState.Lineage; StateSerial = 50 }) `
    -State $retainedState
} catch { $stateMismatchRejected = $true }
if (-not $stateMismatchRejected) { throw "PlanTask accepted a retained baseline from a stale state serial." }

$retainedRoot = Join-Path $terraformRoot "retained-baseline-test-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $retainedRoot
try {
  $retainedPath = Join-Path $retainedRoot "parser-dark.tfplan"
  [IO.File]::WriteAllText($retainedPath, "verified-plan", [Text.UTF8Encoding]::new($false))
  $retainedSha = (Get-FileHash -LiteralPath $retainedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecarPath = "$retainedPath.baseline.json"
  $sidecar = [ordered]@{
    SchemaVersion = "1"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
    AccountId = $ExpectedAccountId; Region = $Region; SourceSha = $SourceSha
    StateLineage = $retainedState.Lineage; StateSerial = $retainedState.Serial; Stage = "parser-dark"
    ReceiptSha256 = "b" * 64; ParserQualifiedArn = ""; PlanPath = $retainedPath
    PlanSha256 = $retainedSha; Applyable = $false; MeaningfulChanges = 0
    CreatedAt = "2026-08-13T20:00:00.0000000Z"
  }
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $sidecarSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  function Get-PlanJson([string]$Path) { return $script:retainedPlanFixture }
  function Get-CurrentTerraformStateIdentity { return $script:retainedStateFixture }
  $script:retainedPlanFixture = $retainedPlan
  $script:retainedStateFixture = $retainedState

  $evidence = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
    -MetadataSha256 $sidecarSha -RequireCurrentState
  if ([string]$evidence.Metadata.Stage -cne "parser-dark" -or
    [string]$evidence.Metadata.StateLineage -cne [string]$retainedState.Lineage -or
    [long]$evidence.Metadata.StateSerial -ne [long]$retainedState.Serial -or
    [string]$evidence.MetadataSha256 -cne (Get-FileSha256 $sidecarPath)) {
    throw "PlanTask did not accept and bind the exact current retained-baseline handoff."
  }

  $sidecarChecksumRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 ("c" * 64)
  }
  catch { $sidecarChecksumRejected = $true }
  if (-not $sidecarChecksumRejected) { throw "PlanTask accepted a mismatched retained-sidecar checksum." }

  $sidecar.ReceiptSha256 = "d" * 64
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $receiptTamperRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $sidecarSha
  }
  catch { $receiptTamperRejected = $true }
  if (-not $receiptTamperRejected) { throw "PlanTask accepted a tampered receipt under the reviewed sidecar checksum." }

  $sidecar.ReceiptSha256 = "b" * 64
  $sidecar.Stage = "complete-dark"
  $sidecar.ParserQualifiedArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:7"
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $relabelSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $stageRelabelRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $relabelSha
  }
  catch { $stageRelabelRejected = $true }
  if (-not $stageRelabelRejected) { throw "PlanTask accepted a parser-dark plan relabeled complete-dark." }

  $sidecar.Stage = "parser-dark"
  $sidecar.ParserQualifiedArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:ai-job-apply-development-document-parser:8"
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $parserSubstitutionSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $parserSubstitutionRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $parserSubstitutionSha
  }
  catch { $parserSubstitutionRejected = $true }
  if (-not $parserSubstitutionRejected) { throw "PlanTask accepted a substituted parser ARN for parser-dark." }

  $sidecar.ParserQualifiedArn = ""
  $sidecar.PlanSha256 = "c" * 64
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $sidecarMismatchSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecarMismatchRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $sidecarMismatchSha
  }
  catch { $sidecarMismatchRejected = $true }
  if (-not $sidecarMismatchRejected) { throw "PlanTask accepted a retained sidecar with a mismatched plan hash." }

  $sidecar.PlanSha256 = $retainedSha
  [IO.File]::WriteAllText($sidecarPath, ($sidecar | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  $currentSidecarSha = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $script:retainedStateFixture = [pscustomobject]@{ Lineage = $retainedState.Lineage; Serial = 52 }
  $currentStateMismatchRejected = $false
  try {
    $null = Read-RetainedMigrationBaseline -PlanPath $retainedPath -PlanSha256 $retainedSha `
      -MetadataSha256 $currentSidecarSha -RequireCurrentState
  }
  catch { $currentStateMismatchRejected = $true }
  if (-not $currentStateMismatchRejected) { throw "PlanTask accepted a retained sidecar from a changed current state." }
}
finally {
  Remove-Item Function:\Get-PlanJson -ErrorAction SilentlyContinue
  Remove-Item Function:\Get-CurrentTerraformStateIdentity -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $retainedRoot) { Remove-Item -LiteralPath $retainedRoot -Recurse -Force }
}

$oneItemList = ConvertTo-TerraformEnvironmentValue -Value @("http://localhost:3000")
if ($oneItemList -cne '["http://localhost:3000"]') {
  throw "A one-item Terraform collection was serialized as a scalar."
}

$MigrationImage = "example.invalid/migration@sha256:$('a' * 64)"
$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"
$beforeContainer = [ordered]@{
  name = "database-migration"
  image = "example.invalid/migration@sha256:$('b' * 64)"
  command = @("runner/dist/src/main.js")
  essential = $true
  readonlyRootFilesystem = $true
  environment = @(
    [ordered]@{ name = "NODE_ENV"; value = "production" },
    [ordered]@{ name = "MIGRATION_MODE"; value = "run" }
  )
  logConfiguration = [ordered]@{
    logDriver = "awslogs"
    options = [ordered]@{
      'awslogs-region' = "us-east-2"
      'awslogs-stream-prefix' = "migration"
      'awslogs-group' = "/ai-job-apply/development/migration"
    }
  }
  mountPoints = @()
  portMappings = @()
  systemControls = @()
  volumesFrom = @()
}
$afterContainer = [ordered]@{
  name = "database-migration"
  image = $MigrationImage
  command = @("runner/dist/src/main.js")
  essential = $true
  readonlyRootFilesystem = $true
  environment = @(
    [ordered]@{ name = "NODE_ENV"; value = "production" },
    [ordered]@{ name = "MIGRATION_MODE"; value = "run" }
  )
  logConfiguration = [ordered]@{
    logDriver = "awslogs"
    options = [ordered]@{
      'awslogs-group' = "/ai-job-apply/development/migration"
      'awslogs-region' = "us-east-2"
      'awslogs-stream-prefix' = "migration"
    }
  }
}
$normalizedTaskPlan = [pscustomobject]@{
  complete = $true
  applyable = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = $MigrationImage } }
  planned_values = [pscustomobject]@{ root_module = $driftRoot }
  resource_drift = $fullProviderDrift
  resource_changes = @([pscustomobject]@{
      address = $migrationAddress
      change = [pscustomobject]@{
        actions = @("create", "delete")
        replace_paths = @(, @("container_definitions"))
        before = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$beforeContainer) -Compress -Depth 10
          tags = [pscustomobject]@{}
          enable_fault_injection = $false
          ipc_mode = ""
          pid_mode = ""
          task_role_arn = ""
        }
        after = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$afterContainer) -Compress -Depth 10
          tags = $null
          enable_fault_injection = $false
          ipc_mode = $null
          pid_mode = $null
          task_role_arn = $null
        }
        after_unknown = [pscustomobject]@{
          enable_fault_injection = $false
          ipc_mode = $false
          pid_mode = $false
          task_role_arn = $false
        }
      }
    })
  output_changes = [pscustomobject]@{
    migration_task_definition_arn = [pscustomobject]@{ actions = @("update") }
  }
}
Assert-ExactTaskPlan -Plan $normalizedTaskPlan

function Get-TaskPlanContainerFixture {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][ValidateSet("before", "after")][string]$Side
  )

  $json = [string]$Plan.resource_changes[0].change.$Side.container_definitions
  $containers = $json | ConvertFrom-Json
  return @($containers)[0]
}

function Set-TaskPlanContainerFixture {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][ValidateSet("before", "after")][string]$Side,
    [Parameter(Mandatory)][object]$Container
  )

  $Plan.resource_changes[0].change.$Side.container_definitions =
    ConvertTo-Json -InputObject @(,$Container) -Compress -Depth 30
}

$containerTamperCases = @(
  @{ Label = "array reorder"; Mutate = {
      param($container)
      $container.environment = @($container.environment[1], $container.environment[0])
    } },
  @{ Label = "array value"; Mutate = {
      param($container)
      $container.environment[1].value = "tampered"
    } },
  @{ Label = "value type"; Mutate = {
      param($container)
      $container.essential = "true"
    } },
  @{ Label = "key"; Mutate = {
      param($container)
      $region = $container.logConfiguration.options.'awslogs-region'
      $container.logConfiguration.options.PSObject.Properties.Remove('awslogs-region')
      $container.logConfiguration.options | Add-Member -NotePropertyName 'AWSLOGS-REGION' -NotePropertyValue $region
    } },
  @{ Label = "extra key"; Mutate = {
      param($container)
      $container.logConfiguration.options | Add-Member -NotePropertyName 'unexpected' -NotePropertyValue "value"
    } },
  @{ Label = "missing key"; Mutate = {
      param($container)
      $container.logConfiguration.options.PSObject.Properties.Remove('awslogs-group')
    } },
  @{ Label = "image"; Mutate = {
      param($container)
      $container.image = "example.invalid/migration@sha256:$('c' * 64)"
    } },
  @{ Label = "runtime"; Mutate = {
      param($container)
      $container.readonlyRootFilesystem = $false
    } }
)
foreach ($case in $containerTamperCases) {
  $tamperedPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $tamperedContainer = Get-TaskPlanContainerFixture -Plan $tamperedPlan -Side "after"
  & $case.Mutate $tamperedContainer
  Set-TaskPlanContainerFixture -Plan $tamperedPlan -Side "after" -Container $tamperedContainer
  $tamperRejected = $false
  try { Assert-ExactTaskPlan -Plan $tamperedPlan } catch { $tamperRejected = $true }
  if (-not $tamperRejected) {
    throw "The migration task plan accepted a $($case.Label) container-definition tamper."
  }
}

foreach ($mutation in @("duplicate", "unknown", "sensitive")) {
  $badTaskDriftPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" {
      $badTaskDriftPlan.resource_drift = @($badTaskDriftPlan.resource_drift) +
        @($badTaskDriftPlan.resource_drift[0])
    }
    "unknown" { $badTaskDriftPlan.resource_drift[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitive" {
      $badTaskDriftPlan.resource_drift[0].change.after_sensitive.tags =
        [pscustomobject]@{ restricted = $true }
    }
  }
  $rejected = $false
  try { Assert-ExactTaskPlan -Plan $badTaskDriftPlan } catch { $rejected = $true }
  if (-not $rejected) { throw "The migration task-plan path accepted '$mutation' provider drift." }
}

$omittedKnownFieldsPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
foreach ($field in @("ipc_mode", "pid_mode", "task_role_arn")) {
  $omittedKnownFieldsPlan.resource_changes[0].change.after_unknown.PSObject.Properties.Remove($field)
}
Assert-ExactTaskPlan -Plan $omittedKnownFieldsPlan

$unsafeNormalizationPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeContainer = $unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions | ConvertFrom-Json
$unsafeContainer | Add-Member -NotePropertyName mountPoints `
  -NotePropertyValue @([pscustomobject]@{ sourceVolume = "unexpected" }) -Force
$unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions =
  ConvertTo-Json -InputObject @($unsafeContainer) -Compress -Depth 10
$unsafeNormalizationRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeNormalizationPlan
} catch {
  $unsafeNormalizationRejected = $true
}
if (-not $unsafeNormalizationRejected) {
  throw "A non-empty provider-default container collection was accepted."
}

$unsafeTagsPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeTagsPlan.resource_changes[0].change.before.tags = [pscustomobject]@{ unexpected = "value" }
$unsafeTagsRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeTagsPlan
} catch {
  $unsafeTagsRejected = $true
}
if (-not $unsafeTagsRejected) { throw "A non-empty tag normalization was accepted." }

$unknownFaultPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unknownFaultPlan.resource_changes[0].change.after.enable_fault_injection = $null
$unknownFaultPlan.resource_changes[0].change.after_unknown.enable_fault_injection = $true
$unknownFaultRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unknownFaultPlan
} catch {
  $unknownFaultRejected = $true
}
if (-not $unknownFaultRejected) { throw "Unknown migration fault injection was accepted." }

foreach ($field in @("ipc_mode", "pid_mode", "task_role_arn")) {
  foreach ($unsafeValue in @("unsafe", "unknown")) {
    $unsafeEmptyFieldPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    if ($unsafeValue -ceq "unknown") {
      $unsafeEmptyFieldPlan.resource_changes[0].change.after_unknown.($field) = $true
    } else {
      $unsafeEmptyFieldPlan.resource_changes[0].change.before.($field) = $unsafeValue
    }
    $unsafeEmptyFieldRejected = $false
    try {
      Assert-ExactTaskPlan -Plan $unsafeEmptyFieldPlan
    } catch {
      $unsafeEmptyFieldRejected = $true
    }
    if (-not $unsafeEmptyFieldRejected) {
      throw "Unsafe $field normalization '$unsafeValue' was accepted."
    }
  }
}

$sourceSha = "c" * 40
$artifactSha = "d" * 64
$base64Sha = [Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xdd }))
$bucket = "example-artifacts"
$version = "exact-version"
$kmsArn = "arn:aws:kms:us-east-2:111122223333:key/00000000-0000-0000-0000-000000000000"
$gateway = [pscustomobject]@{
  s3_key = "lambda/gateway/$sourceSha/$artifactSha/gateway-lambda.zip"
  s3_object_version = $version
  source_code_hash = $base64Sha
  s3_bucket = $bucket
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = $artifactSha } })
}
$head = [pscustomobject]@{
  VersionId = $version
  ContentLength = 1
  ServerSideEncryption = "aws:kms"
  SSEKMSKeyId = $kmsArn
  BucketKeyEnabled = $true
  ChecksumSHA256 = $base64Sha
  Metadata = [pscustomobject]@{ 'source-sha' = $sourceSha; 'artifact-sha256' = $artifactSha }
}
$evidence = Assert-CurrentGatewayArtifactEvidence -Gateway $gateway -Head $head `
  -ExpectedBucket $bucket -ExpectedKmsKeyArn $kmsArn
if ($evidence.ArtifactSha256 -cne $artifactSha -or $evidence.ObjectVersion -cne $version) {
  throw "Valid current gateway evidence was not preserved exactly."
}

foreach ($case in @(
    @{ name = "bucket"; target = "gateway"; property = "s3_bucket"; value = "wrong" },
    @{ name = "key"; target = "gateway"; property = "s3_key"; value = "wrong" },
    @{ name = "hash"; target = "gateway"; property = "source_code_hash"; value = "not-base64" },
    @{ name = "decoded-hash"; target = "gateway"; property = "source_code_hash"; value = ([Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xee }))) },
    @{ name = "release"; target = "gateway"; property = "environment"; value = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = "e" * 64 } }) },
    @{ name = "version"; target = "head"; property = "VersionId"; value = "wrong" },
    @{ name = "content"; target = "head"; property = "ContentLength"; value = 0 },
    @{ name = "encryption"; target = "head"; property = "ServerSideEncryption"; value = "AES256" },
    @{ name = "checksum"; target = "head"; property = "ChecksumSHA256"; value = ([Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { 0xee }))) },
    @{ name = "kms"; target = "head"; property = "SSEKMSKeyId"; value = "$kmsArn-wrong" },
    @{ name = "bucket-key"; target = "head"; property = "BucketKeyEnabled"; value = $false },
    @{ name = "metadata"; target = "head"; property = "Metadata"; value = [pscustomobject]@{ 'source-sha' = $sourceSha; 'artifact-sha256' = "e" * 64 } }
  )) {
  $badGateway = $gateway | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badHead = $head | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  if ($case.target -ceq "gateway") { $badGateway.($case.property) = $case.value } else { $badHead.($case.property) = $case.value }
  $rejected = $false
  try {
    Assert-CurrentGatewayArtifactEvidence -Gateway $badGateway -Head $badHead `
      -ExpectedBucket $bucket -ExpectedKmsKeyArn $kmsArn | Out-Null
  } catch {
    $rejected = $true
  }
  if (-not $rejected) { throw "Invalid current gateway $($case.name) evidence was accepted." }
}

if (-not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{})) -or
    -not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{ enableFaultInjection = $false }))) {
  throw "An absent or explicitly false ECS fault-injection setting was rejected."
}
foreach ($unsafeFaultValue in @($true, $null, "false")) {
  $unsafeTask = [pscustomobject]@{ enableFaultInjection = $unsafeFaultValue }
  if (Test-EcsFaultInjectionDisabled -TaskDefinition $unsafeTask) {
    throw "Unsafe ECS fault-injection value was accepted."
  }
}

Write-Host "Development document migration operator path and baseline tests passed."
