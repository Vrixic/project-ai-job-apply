$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-gateway-release-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-current-document-baseline.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-migration.ps1"
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The migration operator did not parse." }
foreach ($definition in @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true))) {
  Invoke-Expression $definition.Extent.Text
}
function Assert-Rejected {
  param([scriptblock]$Action, [string]$Reason)
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw "Current-baseline guard accepted $Reason." }
}
function Copy-Fixture($Value) { return $Value | ConvertTo-Json -Depth 70 | ConvertFrom-Json }
$script:gitMode = "valid"
$script:treeCallRevisions = @()
function git {
  $arguments = @($args)
  $global:LASTEXITCODE = 0
  if ($arguments -contains "merge-base") {
    if ($script:gitMode -ceq "nonancestor") { $global:LASTEXITCODE = 1 }
    return
  }
  if ($arguments -contains "--name-status") {
    if ($script:gitMode -ceq "git-error") { $global:LASTEXITCODE = 1; return }
    if ($script:gitMode -ceq "rename") { return "R100`told.ts`tnew.ts" }
    return "M`tbackend/services/jobs/src/synthetic-test.ts"
  }
  if ($arguments -contains "--numstat") {
    if ($script:gitMode -ceq "missing-numstat") { return }
    if ($script:gitMode -ceq "binary") { return "-`t-`tbackend/services/jobs/src/synthetic-test.ts" }
    return "1`t1`tbackend/services/jobs/src/synthetic-test.ts"
  }
  if ($arguments -contains "ls-tree") {
    if ($arguments -notcontains "-r" -or $arguments -notcontains "--full-tree" -or $arguments -contains "--") {
      throw "Tree validation must use complete batch snapshots, never per-file processes."
    }
    $revision = [string]$arguments[-1]
    $script:treeCallRevisions += $revision
    if ($script:gitMode -ceq "tree-error") { $global:LASTEXITCODE = 1; return }
    if ($script:gitMode -ceq "malformed-tree") { return "malformed" }
    if ($script:gitMode -ceq "missing-old" -and $revision -ceq ("b" * 40)) { return }
    $mode = "100644"; $kind = "blob"; $path = "backend/services/jobs/src/synthetic-test.ts"
    if ($script:gitMode -ceq "symlink" -or ($script:gitMode -ceq "symlink-old" -and $revision -ceq ("b" * 40))) { $mode = "120000" }
    if ($script:gitMode -ceq "gitlink") { $mode = "160000"; $kind = "commit" }
    if ($script:gitMode -ceq "invalid-mode") { $mode = "100664" }
    if ($script:gitMode -ceq "executable") { $mode = "100755" }
    if ($script:gitMode -ceq "path-case") { $path = "backend/services/jobs/src/Synthetic-Test.ts" }
    $entry = "$mode $kind $('c' * 40)`t$path"
    if ($script:gitMode -ceq "duplicate-tree") { return @($entry, $entry) }
    if ($script:gitMode -ceq "unrelated-symlink") { return @($entry, "120000 blob $('d' * 40)`tunrelated-link") }
    return $entry
  }
  if ($arguments -contains "--full-index") {
    if ($script:gitMode -ceq "patch-error") { $global:LASTEXITCODE = 1; return }
    return "diff --git generated-unit-fixture"
  }
  throw "Unexpected Git operation in isolated baseline test."
}
function aws { throw "Current-baseline tests must not invoke AWS." }
function terraform { throw "Current-baseline tests must not invoke Terraform." }

$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$parentRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$terraformRoot = Join-Path $parentRoot "current-baseline-test-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = Join-Path $terraformRoot "development-document-migration"
$receiptRoot = Join-Path $terraformRoot "development-document-artifacts"
$null = New-Item -ItemType Directory -Path $operatorRoot, $receiptRoot -Force
try {
  $ExpectedAccountId = "123456789012"; $Region = "us-east-2"
  $SourceSha = "a" * 40; $operatorSourceSha = $SourceSha; $documentSource = "b" * 40
  $oldImage = "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration@sha256:$('1' * 64)"
  $MigrationImage = "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration@sha256:$('2' * 64)"
  $bucket = "synthetic-development-artifacts"
  $kms = "arn:aws:kms:$Region`:$ExpectedAccountId`:key/11111111-1111-4111-8111-111111111111"
  $pin = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:7"
  $variables = [ordered]@{}
  foreach ($name in @(Get-DeclaredVariableNames)) { $variables[$name] = [pscustomobject]@{ value = "" } }
  $variables.document_processing_deployment_stage.value = "complete-dark"
  $variables.document_parser_invocation_qualified_arn.value = $pin
  $variables.migration_image.value = $oldImage
  $artifacts = @(); $resources = @(
    [pscustomobject]@{ address = "module.platform.aws_s3_bucket.artifacts"; values = [pscustomobject]@{ bucket = $bucket } },
    [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kms } },
    [pscustomobject]@{ address = "module.platform.aws_ecr_repository.migration"; values = [pscustomobject]@{ repository_url = $oldImage.Split('@')[0] } }
  )
  foreach ($kind in @("parser", "processor")) {
    $artifactName = "document-$kind-lambda"; $digest = $(if ($kind -ceq "parser") { "3" } else { "4" }) * 64
    $base64 = [Convert]::ToBase64String((New-Object byte[] 32))
    foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
      $artifacts += [pscustomobject]@{
        artifactName = $artifactName; artifactSha256 = $digest; suffix = $suffix
        key = "lambda/documents/$documentSource/$digest/$artifactName.$suffix"; versionId = "synthetic-version-$kind-$suffix"
        objectSha256 = $digest; objectBase64Sha256 = $base64; contentLength = 128
      }
    }
    $zip = @($artifacts | Where-Object { $_.artifactName -ceq $artifactName -and $_.suffix -ceq "zip" })[0]
    $prefix = "document_$($kind)_artifact"
    $variables["$($prefix)_s3_key"].value = $zip.key
    $variables["$($prefix)_s3_object_version"].value = $zip.versionId
    $variables["$($prefix)_sha256"].value = $zip.artifactSha256
    $variables["$($prefix)_base64sha256"].value = $base64
    $values = [pscustomobject]@{
      s3_bucket = $bucket; s3_key = $zip.key; s3_object_version = $zip.versionId; source_code_hash = $base64
      qualified_arn = "arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-$($kind):7"
      environment = @([pscustomobject]@{ variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $pin } })
    }
    $resources += [pscustomobject]@{ address = "module.platform.aws_lambda_function.document_$kind[0]"; values = $values }
  }
  $receipt = [pscustomobject]@{
    schemaVersion = 1; kind = "development-document-lambda-publication"; environment = "development"; region = $Region
    sourceSha = $documentSource; phase = "verified"; createdAt = "2026-09-01T00:00:00Z"; completedAt = "2026-09-01T00:00:01Z"
    boundarySha256 = Get-CurrentDocumentBaselineTextSha256 "$ExpectedAccountId|$Region|$bucket|$kms"
    artifacts = $artifacts
  }
  $receiptPath = Join-Path $receiptRoot "receipt-generated.json"
  [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  $receiptSha = Get-FileSha256 $receiptPath
  $plan = [pscustomobject]@{
    terraform_version = "1.9.8"; complete = $true; errored = $false; applyable = $false
    variables = [pscustomobject]$variables; resource_changes = @(); resource_drift = @(); output_changes = [pscustomobject]@{}
    planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{ resources = $resources } }
  }
  $state = [pscustomobject]@{ Lineage = "11111111-1111-4111-8111-111111111111"; Serial = 276 }
  $planPath = Join-Path $operatorRoot "capture.tfplan"
  [IO.File]::WriteAllText($planPath, "generated-saved-plan-fixture", [Text.UTF8Encoding]::new($false))
  $planSha = Get-FileSha256 $planPath
  $metadata = [pscustomobject](New-CurrentDocumentBaselineMetadata -Plan $plan -PlanPath $planPath -PlanSha256 $planSha -State $state `
    -SourceSha $SourceSha -DocumentReleaseSourceSha $documentSource -ReceiptSha256 $receiptSha -AccountId $ExpectedAccountId -Region $Region -RepositoryRoot $repositoryRoot)
  $sidecar = "$planPath.baseline.json"
  [IO.File]::WriteAllText($sidecar, ($metadata | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  $sidecarSha = Get-FileSha256 $sidecar
  $script:fixturePlan = $plan; $script:fixtureState = $state
  function Get-PlanJson([string]$Path) { return $script:fixturePlan }
  function Get-CurrentTerraformStateIdentity { return $script:fixtureState }
  $read = @{ PlanPath = $planPath; PlanSha256 = $planSha; MetadataSha256 = $sidecarSha; RequireCurrentState = $true }
  $evidence = Read-RetainedMigrationBaseline @read
  if ($evidence.Metadata.SchemaVersion -cne "7" -or $evidence.ReleaseSourceSha -cne $SourceSha -or $evidence.Metadata.DocumentReleaseSourceSha -cne $documentSource) {
    throw "Capture-to-migration normalization lost the separate original document release."
  }
  $task = [pscustomobject]@{
    appliedPlanPath = $planPath; appliedPlanSha256 = $planSha; appliedBaselineMetadataPath = $sidecar; appliedBaselineMetadataSha256 = $sidecarSha
    appliedBaselineStage = $metadata.Stage; appliedBaselineStateLineage = $state.Lineage; appliedBaselineStateSerial = $state.Serial
    appliedBaselineReceiptSha256 = $receiptSha; appliedBaselineParserQualifiedArn = $pin
    appliedBaselineReleaseSourceSha = $SourceSha; appliedBaselineOperatorSourceSha = $SourceSha
    appliedBaselineOperatorDeltaSha256 = $evidence.OperatorDeltaSha256; appliedBaselineCurrentOperatorSourceSha = $SourceSha
    appliedBaselineToCurrentDeltaSha256 = $evidence.BaselineToCurrentDeltaSha256
    planningStateLineage = $state.Lineage; planningStateSerial = $state.Serial
  }
  Assert-TaskMetadataBaselineBinding -TaskMetadata $task -Baseline $evidence
  $postPlan = Copy-Fixture $plan; $postPlan.variables.migration_image.value = $MigrationImage
  $postState = [pscustomobject]@{ Lineage = $state.Lineage; Serial = 277 }
  $postPath = Join-Path $operatorRoot "post.tfplan"; $postSha = "f" * 64
  $post = [pscustomobject](New-PostMigrationBaselineMetadata -Plan $postPlan -PlanPath $postPath -PlanSha256 $postSha -State $postState -TaskMetadata $task)
  Assert-PostMigrationBaselineMetadata -Metadata $post -Plan $postPlan -PlanPath $postPath -PlanSha256 $postSha -State $postState -TaskMetadata $task
  $check = @{ Metadata = $post; Plan = $postPlan; PlanPath = $postPath; PlanSha256 = $postSha; CurrentState = $postState; SourceSha = $SourceSha
    AccountId = $ExpectedAccountId; Region = $Region; RepositoryRoot = $repositoryRoot; ReceiptDirectory = $receiptRoot }
  $null = Assert-CurrentDocumentBaselineEvidence @check
  if ($post.SchemaVersion -cne "7" -or $post.DocumentReleaseSourceSha -cne $documentSource -or $post.ReceiptSha256 -cne $receiptSha) {
    throw "Migration-to-gateway handoff attributed old document artifacts to a new source."
  }
  foreach ($change in @(
      @{ Name = "source"; Mutate = { param($v) $v.SourceSha = "e" * 40 } },
      @{ Name = "document source"; Mutate = { param($v) $v.DocumentReleaseSourceSha = "e" * 40 } },
      @{ Name = "source delta"; Mutate = { param($v) $v.DocumentSourceDeltaSha256 = "e" * 64 } },
      @{ Name = "serial"; Mutate = { param($v) $v.StateSerial++ } },
      @{ Name = "lineage"; Mutate = { param($v) $v.StateLineage = "22222222-2222-4222-8222-222222222222" } },
      @{ Name = "receipt hash"; Mutate = { param($v) $v.ReceiptSha256 = "e" * 64 } },
      @{ Name = "parser pin"; Mutate = { param($v) $v.ParserQualifiedArn += "1" } },
      @{ Name = "schema relabel"; Mutate = { param($v) $v.SchemaVersion = "6" } },
      @{ Name = "unknown key"; Mutate = { param($v) $v | Add-Member Unexpected $true } },
      @{ Name = "missing provenance"; Mutate = { param($v) $v.PSObject.Properties.Remove("DocumentReleaseSourceSha") } }
    )) {
    $bad = Copy-Fixture $post; & $change.Mutate $bad
    $badCheck = @{} + $check; $badCheck.Metadata = $bad
    Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @badCheck } $change.Name
  }
  foreach ($mode in @("nonancestor", "rename", "git-error", "missing-numstat", "symlink", "symlink-old", "gitlink", "invalid-mode", "path-case", "tree-error", "malformed-tree", "missing-old", "duplicate-tree", "patch-error")) {
    $script:gitMode = $mode
    Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @check } $mode
  }
  $script:gitMode = "binary"
  if ((Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $repositoryRoot -DocumentReleaseSourceSha $documentSource -SourceSha $SourceSha) -cne $post.DocumentSourceDeltaSha256) {
    throw "A regular binary blob was not bound through the canonical full-index patch."
  }
  $script:gitMode = "valid"
  $script:treeCallRevisions = @()
  foreach ($mode in @("valid", "executable", "unrelated-symlink")) {
    $script:gitMode = $mode
    if ((Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $repositoryRoot -DocumentReleaseSourceSha $documentSource -SourceSha $SourceSha) -cne $post.DocumentSourceDeltaSha256) {
      throw "Batch endpoint validation changed canonical digest bytes or rejected an unchanged unrelated entry."
    }
  }
  if (($script:treeCallRevisions -join "|") -cne ((@($documentSource, $SourceSha, $documentSource, $SourceSha, $documentSource, $SourceSha)) -join "|")) {
    throw "Each source-delta validation must freshly read exactly two immutable endpoint trees."
  }
  $script:gitMode = "valid"
  $reattributed = Copy-Fixture $post
  $reattributed.DocumentReleaseSourceSha = $SourceSha
  $reattributed.DocumentSourceDeltaSha256 = Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $repositoryRoot -DocumentReleaseSourceSha $SourceSha -SourceSha $SourceSha
  $badCheck = @{} + $check; $badCheck.Metadata = $reattributed
  Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @badCheck } "a coherently rehashed source that disagrees with the actual document receipt"
  foreach ($property in @("s3_bucket", "s3_key", "s3_object_version", "source_code_hash", "qualified_arn")) {
    $badPlan = Copy-Fixture $postPlan; $badPlan.planned_values.root_module.resources[3].values.$property = "different"
    $badCheck = @{} + $check; $badCheck.Plan = $badPlan
    Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @badCheck } "function $property"
  }
  $badPlan = Copy-Fixture $postPlan
  $badPlan.planned_values.root_module.resources[4].values.environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN += "1"
  $badCheck = @{} + $check; $badCheck.Plan = $badPlan
  Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @badCheck } "processor parser pin"
  $script:fixtureState = [pscustomobject]@{ Lineage = $state.Lineage; Serial = 277 }
  Assert-Rejected { Read-RetainedMigrationBaseline @read } "stale capture at PlanTask/ApplyTask"
  $script:fixtureState = $state
  Assert-Rejected { Read-RetainedMigrationBaseline @read -ReviewedBaselineToCurrentDeltaSha256 ("e" * 64) } "unnecessary ancestor override"
  foreach ($invalidPlan in @("applyable", "incomplete", "extra-route", "missing-variable")) {
    $badPlan = Copy-Fixture $plan
    switch ($invalidPlan) {
      "applyable" { $badPlan.applyable = $true }
      "incomplete" { $badPlan.complete = $false }
      "extra-route" { $badPlan.resource_changes = @([pscustomobject]@{ address = "module.platform.aws_apigatewayv2_route.unapproved"; change = [pscustomobject]@{ actions = @("create") } }) }
      "missing-variable" { $badPlan.variables.PSObject.Properties.Remove("migration_image") }
    }
    $script:fixturePlan = $badPlan
    Assert-Rejected { Read-RetainedMigrationBaseline @read } $invalidPlan
  }
  $script:fixturePlan = $plan
  $duplicatePath = Join-Path $receiptRoot "receipt-duplicate.json"
  [IO.File]::WriteAllText($duplicatePath, (Get-Content -LiteralPath $receiptPath -Raw), [Text.UTF8Encoding]::new($false))
  Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @check } "duplicate matching receipt"
  Remove-Item -LiteralPath $duplicatePath -Force
  $badReceipt = Copy-Fixture $receipt; $badReceipt.artifacts[0].versionId = "different-version"
  [IO.File]::WriteAllText($receiptPath, ($badReceipt | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  $badMetadata = Copy-Fixture $post; $badMetadata.ReceiptSha256 = Get-FileSha256 $receiptPath
  $badCheck = @{} + $check; $badCheck.Metadata = $badMetadata
  Assert-Rejected { Assert-CurrentDocumentBaselineEvidence @badCheck } "coherently rehashed receipt with changed artifact version"
  [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  $badTask = Copy-Fixture $task; $badTask.appliedBaselineReceiptSha256 = "e" * 64
  Assert-Rejected { New-PostMigrationBaselineMetadata -Plan $postPlan -PlanPath $postPath -PlanSha256 $postSha -State $postState -TaskMetadata $badTask } "task receipt reattribution"
  [IO.File]::AppendAllText($sidecar, " ")
  Assert-Rejected { Read-RetainedMigrationBaseline @read } "changed sidecar bytes"
  Assert-Rejected { New-PostMigrationBaselineMetadata -Plan $postPlan -PlanPath $postPath -PlanSha256 $postSha -State $postState -TaskMetadata $task } "changed original sidecar during post-Verify"
  Write-Host "Current schema-7 capture/migration/gateway round-trip and adversarial tests passed."
} finally {
  $resolved = [IO.Path]::GetFullPath($terraformRoot)
  if ($resolved.StartsWith("$parentRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolved) -cmatch '^current-baseline-test-[a-f0-9]{32}$') {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  } else { throw "Refusing cleanup outside the exact generated baseline-test directory." }
}
