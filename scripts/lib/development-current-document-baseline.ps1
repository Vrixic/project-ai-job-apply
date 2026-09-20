Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Schema 7 is a current-state capture, not the historical schema-6 Bootstrap chain. The
# document artifact release remains distinct from the current operator/migration release.
# Schema 8 (D3-020) is the same capture for a mixed document release, where the deployed parser and
# processor come from two different verified receipts. It exists only so a convergence release can
# start; every reader except the Gateway operator rejects it.
function Get-CurrentDocumentBaselineTextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($Value))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-CurrentDocumentBaselineSourceDeltaSha256 {
  param(
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][string]$DocumentReleaseSourceSha,
    [Parameter(Mandatory)][string]$SourceSha
  )
  $domain = "development-document-current-baseline-delta-v1"
  if ($DocumentReleaseSourceSha -cnotmatch '^[a-f0-9]{40}$' -or $SourceSha -cnotmatch '^[a-f0-9]{40}$') {
    throw "The current document baseline requires exact source commits."
  }
  & git -C $RepositoryRoot merge-base --is-ancestor $DocumentReleaseSourceSha $SourceSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The document artifact source is not an ancestor of the current baseline source." }
  if ($DocumentReleaseSourceSha -ceq $SourceSha) {
    return Get-CurrentDocumentBaselineTextSha256 "$domain`n$DocumentReleaseSourceSha`n$SourceSha`n--name-status--`n--patch--`n"
  }
  $range = "$DocumentReleaseSourceSha..$SourceSha"
  $detected = @(& git -C $RepositoryRoot diff --name-status --find-renames --find-copies-harder $range 2>$null)
  if ($LASTEXITCODE -ne 0 -or $detected.Count -eq 0 -or @($detected | Where-Object {
        $_ -notmatch '^(?:A|M|D)\t[^\t]+$' -and $_ -notmatch '^C[0-9]+\t[^\t]+\t[^\t]+$'
      }).Count -ne 0) {
    throw "The current document baseline source delta is unreadable, renamed, or ambiguous."
  }
  $records = @(& git -C $RepositoryRoot diff --name-status --no-renames $range 2>$null)
  $recordsExit = $LASTEXITCODE
  $numstat = @(& git -C $RepositoryRoot diff --numstat --no-renames $range 2>$null)
  if ($LASTEXITCODE -ne 0 -or $recordsExit -ne 0 -or $records.Count -eq 0 -or $records.Count -ne $numstat.Count) {
    throw "The current document baseline source records are incomplete."
  }
  # Read both immutable endpoint trees once per invocation. No trusted cache or per-file Git
  # process is used; only changed paths must be regular blobs, as in the original validator.
  $trees = @{}
  foreach ($revision in @($DocumentReleaseSourceSha, $SourceSha)) {
    $entries = @(& git -C $RepositoryRoot ls-tree -r --full-tree $revision 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "A current document baseline source tree is unreadable." }
    $tree = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
    foreach ($entry in $entries) {
      if ([string]$entry -cnotmatch '^(?<mode>[0-7]{6}) (?<kind>blob|commit) [a-f0-9]{40,64}\t(?<path>[^\t]+)$') {
        throw "A current document baseline source tree contains a malformed entry."
      }
      $entryPath = $Matches.path
      if ($tree.ContainsKey($entryPath)) { throw "A current document baseline source tree contains a duplicate path." }
      $tree.Add($entryPath, [pscustomobject]@{ Mode = $Matches.mode; Kind = $Matches.kind })
    }
    $trees[$revision] = $tree
  }
  foreach ($record in $records) {
    if ($record -notmatch '^(A|M|D)\t([^\t]+)$') { throw "The current document baseline contains an unsupported source record." }
    $status = $Matches[1]; $path = $Matches[2]
    $revisions = if ($status -ceq 'A') { @($SourceSha) } elseif ($status -ceq 'D') { @($DocumentReleaseSourceSha) } else { @($DocumentReleaseSourceSha, $SourceSha) }
    foreach ($revision in $revisions) {
      $tree = $trees[$revision]
      if (-not $tree.ContainsKey($path) -or $tree[$path].Mode -cnotin @("100644", "100755") -or $tree[$path].Kind -cne "blob") {
        throw "A current document baseline source path is not one regular blob."
      }
    }
  }
  $patch = @(& git -C $RepositoryRoot diff --full-index --binary --no-ext-diff --no-renames $range 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The current document baseline canonical patch is unreadable." }
  return Get-CurrentDocumentBaselineTextSha256 ("$domain`n$DocumentReleaseSourceSha`n$SourceSha`n--name-status--`n" +
    (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n"))
}

function New-CurrentDocumentBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$State,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$DocumentReleaseSourceSha,
    [Parameter(Mandatory)][string]$ReceiptSha256,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$RepositoryRoot,
    # Both or neither. When given, ReceiptSha256 and DocumentReleaseSourceSha describe the deployed
    # parser and these describe the deployed processor (schema 8).
    [string]$ProcessorReleaseSourceSha = "",
    [string]$ProcessorReceiptSha256 = ""
  )
  $twoReceipts = -not [string]::IsNullOrEmpty($ProcessorReleaseSourceSha) -or -not [string]::IsNullOrEmpty($ProcessorReceiptSha256)
  if ($twoReceipts -and ([string]::IsNullOrEmpty($ProcessorReleaseSourceSha) -or [string]::IsNullOrEmpty($ProcessorReceiptSha256))) {
    throw "A two-receipt baseline needs both the processor receipt checksum and its release source."
  }
  $metadata = [ordered]@{
    SchemaVersion = $(if ($twoReceipts) { "8" } else { "7" }); Kind = "development-document-zero-drift-baseline"
    Environment = "development"; AccountId = $AccountId; Region = $Region
    SourceSha = $SourceSha; DocumentReleaseSourceSha = $DocumentReleaseSourceSha
    DocumentSourceDeltaSha256 = Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $RepositoryRoot -DocumentReleaseSourceSha $DocumentReleaseSourceSha -SourceSha $SourceSha
    StateLineage = [string]$State.Lineage; StateSerial = [long]$State.Serial
    Stage = [string](Get-GatewayPlanVariableValue $Plan.variables "document_processing_deployment_stage")
    ReceiptSha256 = $ReceiptSha256
    ParserQualifiedArn = [string](Get-GatewayPlanVariableValue $Plan.variables "document_parser_invocation_qualified_arn")
    MigrationImage = [string](Get-GatewayPlanVariableValue $Plan.variables "migration_image")
    PlanPath = [IO.Path]::GetFullPath($PlanPath); PlanSha256 = $PlanSha256
    Applyable = $false; MeaningfulChanges = 0; CreatedAt = [datetime]::UtcNow.ToString("o")
  }
  if ($twoReceipts) {
    $metadata["ProcessorReceiptSha256"] = $ProcessorReceiptSha256
    $metadata["ProcessorReleaseSourceSha"] = $ProcessorReleaseSourceSha
    $metadata["ProcessorSourceDeltaSha256"] = Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $RepositoryRoot -DocumentReleaseSourceSha $ProcessorReleaseSourceSha -SourceSha $SourceSha
  }
  return $metadata
}

function Get-CurrentDocumentBaselineReceipt {
  param([Parameter(Mandatory)][string]$ReceiptDirectory, [Parameter(Mandatory)][string]$ReceiptSha256)
  $receipts = @(Get-ChildItem -LiteralPath $ReceiptDirectory -File -Filter "receipt-*.json" | Where-Object {
      -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
      (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $ReceiptSha256
    })
  if ($receipts.Count -ne 1) { throw "Exactly one local document receipt must match the current baseline checksum." }
  return Get-Content -LiteralPath $receipts[0].FullName -Raw | ConvertFrom-Json
}

function Assert-CurrentDocumentBaselineEvidence {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][object]$CurrentState,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][string]$ReceiptDirectory,
    [switch]$AllowOneSerialAdvance,
    # Only the Gateway operator passes this, so that a schema-8 (two-receipt) baseline is accepted there
    # and rejected by every other reader.
    [switch]$AllowTwoReceipts
  )
  $schema = [string]$Metadata.SchemaVersion
  if ($schema -cne "7" -and -not ($schema -ceq "8" -and $AllowTwoReceipts)) {
    throw "A current document baseline must use its distinct schema-7 format."
  }
  $null = Assert-RetainedGatewayBaselineMetadata -Metadata $Metadata -Plan $Plan -PlanPath $PlanPath -PlanSha256 $PlanSha256 `
    -SourceSha $SourceSha -AccountId $AccountId -Region $Region -CurrentState $CurrentState `
    -ExpectedMigrationRepositoryUrl "$AccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration" -AllowOneSerialAdvance:$AllowOneSerialAdvance
  $delta = Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $RepositoryRoot -DocumentReleaseSourceSha ([string]$Metadata.DocumentReleaseSourceSha) -SourceSha $SourceSha
  if ([string]$Metadata.DocumentSourceDeltaSha256 -cne $delta) { throw "The current document baseline source delta does not match its exact commits." }
  if ($schema -ceq "8") {
    $processorDelta = Get-CurrentDocumentBaselineSourceDeltaSha256 -RepositoryRoot $RepositoryRoot -DocumentReleaseSourceSha ([string]$Metadata.ProcessorReleaseSourceSha) -SourceSha $SourceSha
    if ([string]$Metadata.ProcessorSourceDeltaSha256 -cne $processorDelta) { throw "The current document baseline processor source delta does not match its exact commits." }
  }
  if (-not (Test-Path -LiteralPath $ReceiptDirectory -PathType Container)) { throw "The current document baseline receipt directory is unavailable." }
  $receipt = Get-CurrentDocumentBaselineReceipt -ReceiptDirectory $ReceiptDirectory -ReceiptSha256 ([string]$Metadata.ReceiptSha256)
  $resources = Get-TerraformStateResourceMap -RootModule $Plan.planned_values.root_module
  foreach ($address in @("module.platform.aws_s3_bucket.artifacts", "module.platform.aws_kms_key.platform", "module.platform.aws_ecr_repository.migration", "module.platform.aws_lambda_function.document_parser[0]")) {
    if (-not $resources.ContainsKey($address)) { throw "The current baseline lacks an exact document artifact resource boundary." }
  }
  $bucket = [string]$resources["module.platform.aws_s3_bucket.artifacts"].bucket
  $kmsArn = [string]$resources["module.platform.aws_kms_key.platform"].arn
  $repository = [string]$resources["module.platform.aws_ecr_repository.migration"].repository_url
  if ($bucket -cnotmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' -or
      $kmsArn -cnotmatch "^arn:aws:kms:$Region`:$AccountId`:key/[a-f0-9-]{36}$" -or
      $repository -cne "$AccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration") {
    throw "The current document baseline artifact boundary is outside the exact development account."
  }
  $boundarySha = Get-CurrentDocumentBaselineTextSha256 "$AccountId|$Region|$bucket|$kmsArn"
  if ($schema -ceq "8") {
    # Two receipts: the first describes only the deployed parser, the second only the deployed
    # processor. Each is held to the full single-receipt rules for its own archive and source.
    $null = Assert-GatewayDocumentBaselineReceipt -Receipt $receipt -ReceiptSha256 ([string]$Metadata.ReceiptSha256) `
      -Plan $Plan -SourceSha ([string]$Metadata.DocumentReleaseSourceSha) -ExpectedBoundarySha256 $boundarySha -Role parser
    $processorReceipt = Get-CurrentDocumentBaselineReceipt -ReceiptDirectory $ReceiptDirectory -ReceiptSha256 ([string]$Metadata.ProcessorReceiptSha256)
    $null = Assert-GatewayDocumentBaselineReceipt -Receipt $processorReceipt -ReceiptSha256 ([string]$Metadata.ProcessorReceiptSha256) `
      -Plan $Plan -SourceSha ([string]$Metadata.ProcessorReleaseSourceSha) -ExpectedBoundarySha256 $boundarySha -Role processor
  } else {
    $null = Assert-GatewayDocumentBaselineReceipt -Receipt $receipt -ReceiptSha256 ([string]$Metadata.ReceiptSha256) `
      -Plan $Plan -SourceSha ([string]$Metadata.DocumentReleaseSourceSha) -ExpectedBoundarySha256 $boundarySha
  }
  foreach ($kind in @("parser", "processor")) {
    if ($kind -ceq "processor" -and [string]$Metadata.Stage -ceq "parser-dark") { continue }
    $address = "module.platform.aws_lambda_function.document_$kind[0]"
    if (-not $resources.ContainsKey($address)) { throw "The current baseline document function is missing." }
    $function = $resources[$address]
    $prefix = "document_$($kind)_artifact"
    if ([string]$function.s3_bucket -cne $bucket -or
        [string]$function.s3_key -cne [string](Get-GatewayPlanVariableValue $Plan.variables "$($prefix)_s3_key") -or
        [string]$function.s3_object_version -cne [string](Get-GatewayPlanVariableValue $Plan.variables "$($prefix)_s3_object_version") -or
        [string]$function.source_code_hash -cne [string](Get-GatewayPlanVariableValue $Plan.variables "$($prefix)_base64sha256") -or
        [string]$function.qualified_arn -cnotmatch "^arn:aws:lambda:$Region`:$AccountId`:function:ai-job-apply-development-document-$($kind):[1-9][0-9]*$") {
      throw "The current baseline document function does not match its immutable artifact coordinates."
    }
    if ($kind -ceq "processor") {
      $environment = @($function.environment)
      if ($environment.Count -ne 1 -or [string]$environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN -cne [string]$Metadata.ParserQualifiedArn) {
        throw "The current baseline processor does not preserve the exact parser-version pin."
      }
    }
  }
  return $Metadata
}
