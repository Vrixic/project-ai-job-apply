Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-GatewayPlanVariableValue {
  param([Parameter(Mandatory)][object]$Variables, [Parameter(Mandatory)][string]$Name)
  $property = $Variables.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.PSObject.Properties["value"]) {
    throw "The Terraform plan is missing required variable '$Name'."
  }
  return $property.Value.value
}

function ConvertTo-GatewayCanonicalJson {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return "null" }
  return ConvertTo-Json -InputObject $Value -Depth 50 -Compress
}

function Get-GatewayOptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-GatewayMeaningfulChanges {
  param([AllowNull()][object[]]$Changes)
  return @($Changes | Where-Object {
      $actions = @($_.change.actions)
      -not ($actions.Count -eq 1 -and $actions[0] -in @("no-op", "read"))
    })
}

function Assert-RetainedGatewayBaselineMetadata {
  param(
    [Parameter(Mandatory)][object]$Metadata,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region
  )
  $expectedKeys = @(
    "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
    "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
    "SourceSha", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $createdAt = [datetime]::MinValue
  $createdAtValid = [datetime]::TryParse([string]$Metadata.CreatedAt, [ref]$createdAt) -and
    $createdAt.Year -ge 2000 -and $createdAt.Year -le 2099
  $metadataPlanPath = if ([string]::IsNullOrWhiteSpace([string]$Metadata.PlanPath)) { "" } else { [IO.Path]::GetFullPath([string]$Metadata.PlanPath) }
  if (($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
      [string]$Metadata.SchemaVersion -cne "1" -or
      [string]$Metadata.Kind -cne "development-document-zero-drift-baseline" -or
      [string]$Metadata.Environment -cne "development" -or
      [string]$Metadata.AccountId -cne $AccountId -or [string]$Metadata.Region -cne $Region -or
      [string]$Metadata.SourceSha -cne $SourceSha -or
      $metadataPlanPath -cne [IO.Path]::GetFullPath($PlanPath) -or
      [string]$Metadata.PlanSha256 -cne $PlanSha256 -or -not $createdAtValid -or
      $Metadata.Applyable -isnot [bool] -or $Metadata.Applyable -or
      [int]$Metadata.MeaningfulChanges -ne 0 -or
      [string]$Metadata.StateLineage -cnotmatch '^[a-f0-9-]{36}$' -or [long]$Metadata.StateSerial -lt 1 -or
      [string]$Metadata.Stage -notin @("parser-dark", "complete-dark") -or
      [string]$Metadata.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      ([string]$Metadata.Stage -ceq "parser-dark" -and -not [string]::IsNullOrEmpty([string]$Metadata.ParserQualifiedArn)) -or
      ([string]$Metadata.Stage -ceq "complete-dark" -and
        [string]$Metadata.ParserQualifiedArn -cnotmatch "^arn:aws:lambda:$([regex]::Escape($Region)):$AccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
    throw "The retained baseline metadata does not match the exact document-to-gateway handoff."
  }
  return $true
}

function Test-GatewayAcceptedBaselineDrift {
  param([Parameter(Mandatory)][object]$Drift)
  $afterUnknown = Get-GatewayOptionalProperty $Drift.change "after_unknown"
  $afterUnknownCount = if ($null -eq $afterUnknown) { 0 } else { @($afterUnknown.PSObject.Properties).Count }
  if ([string]$Drift.mode -cne "managed" -or (@($Drift.change.actions) -join ",") -cne "update" -or
      @((Get-GatewayOptionalProperty $Drift.change "replace_paths")).Count -ne 0 -or
      $afterUnknownCount -ne 0 -or
      (ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $Drift.change "before_sensitive")) -cne
        (ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $Drift.change "after_sensitive"))) {
    return $false
  }
  $before = $Drift.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $after = $Drift.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  if ([string]$Drift.address -ceq "module.platform.aws_db_instance.postgres[0]" -and [string]$Drift.type -ceq "aws_db_instance") {
    $before.PSObject.Properties.Remove("latest_restorable_time")
    $after.PSObject.Properties.Remove("latest_restorable_time")
  } elseif ([string]$Drift.address -ceq "module.platform.aws_ecs_task_definition.migration[0]" -and [string]$Drift.type -ceq "aws_ecs_task_definition") {
    $before.PSObject.Properties.Remove("tags")
    $after.PSObject.Properties.Remove("tags")
    $before.PSObject.Properties.Remove("tags_all")
    $after.PSObject.Properties.Remove("tags_all")
  } else { return $false }
  return (ConvertTo-GatewayCanonicalJson $before) -ceq (ConvertTo-GatewayCanonicalJson $after)
}

function Assert-RetainedGatewayBaselinePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string[]]$DeclaredVariableNames)
  if ($Plan.complete -isnot [bool] -or -not $Plan.complete -or
      $Plan.errored -isnot [bool] -or $Plan.errored -or
      $Plan.applyable -isnot [bool] -or $Plan.applyable -or
      [string]$Plan.terraform_version -cne "1.9.8" -or
      $null -eq $Plan.variables -or $null -eq $Plan.planned_values -or $null -eq $Plan.planned_values.root_module) {
    throw "The retained gateway baseline is not a complete, nonerrored, nonapplyable Terraform 1.9.8 plan."
  }
  if (@(Get-GatewayMeaningfulChanges @($Plan.resource_changes)).Count -ne 0) {
    throw "The retained gateway baseline contains a meaningful resource change."
  }
  $outputChanges = Get-GatewayOptionalProperty $Plan "output_changes"
  $meaningfulOutputs = @(
    if ($null -ne $outputChanges) {
      $outputChanges.PSObject.Properties | Where-Object {
        $actions = @($_.Value.actions); -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
      }
    }
  )
  if ($meaningfulOutputs.Count -ne 0) { throw "The retained gateway baseline contains a meaningful output change." }
  $actualVariables = @($Plan.variables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $declared = @($DeclaredVariableNames | Sort-Object)
  if (($actualVariables -join "|") -cne ($declared -join "|")) {
    throw "The retained gateway baseline does not contain the exact current development variable set."
  }
  $seenDrift = @()
  foreach ($drift in @($Plan.resource_drift | Where-Object { $null -ne $_ })) {
    if ($seenDrift -ccontains [string]$drift.address -or -not (Test-GatewayAcceptedBaselineDrift $drift)) {
      throw "The retained gateway baseline contains unaccepted provider refresh drift."
    }
    $seenDrift += [string]$drift.address
  }
  return $true
}

function Assert-GatewayPublicationReceipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$BoundarySha256
  )
  $expectedKeys = @(
    "artifacts", "boundarySha256", "completedAt", "createdAt", "environment", "kind",
    "phase", "region", "schemaVersion", "sourceSha"
  ) | Sort-Object
  $actualKeys = @($Receipt.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
      [int]$Receipt.schemaVersion -ne 1 -or
      [string]$Receipt.kind -cne "development-gateway-lambda-publication" -or
      [string]$Receipt.environment -cne "development" -or
      [string]$Receipt.region -cne "us-east-2" -or
      [string]$Receipt.sourceSha -cne $SourceSha -or
      [string]$Receipt.boundarySha256 -cne $BoundarySha256 -or
      [string]$Receipt.phase -cne "verified") {
    throw "The gateway publication receipt does not match the exact release boundary."
  }
  $entries = @($Receipt.artifacts)
  $suffixes = @($entries | ForEach-Object { [string]$_.suffix } | Sort-Object)
  if ($entries.Count -ne 4 -or ($suffixes -join ",") -cne "cdx.json,manifest.json,sha256,zip") {
    throw "The gateway publication receipt must contain exactly one ZIP, manifest, SBOM, and checksum."
  }
  $artifactDigests = @($entries | ForEach-Object { [string]$_.artifactSha256 } | Sort-Object -Unique)
  $keys = @($entries | ForEach-Object { [string]$_.key } | Sort-Object -Unique)
  if ($artifactDigests.Count -ne 1 -or [string]$artifactDigests[0] -cnotmatch '^[a-f0-9]{64}$' -or
      $keys.Count -ne 4) {
    throw "The gateway publication receipt contains duplicate keys or inconsistent artifact digests."
  }
  foreach ($entry in $entries) {
    $expectedKey = "lambda/gateway/$SourceSha/$($entry.artifactSha256)/gateway-lambda.$($entry.suffix)"
    if ([string]$entry.key -cne $expectedKey -or
        [string]$entry.objectSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        [string]$entry.objectBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
        [string]::IsNullOrWhiteSpace([string]$entry.versionId) -or [long]$entry.contentLength -le 0) {
      throw "The gateway publication receipt contains an invalid immutable object entry."
    }
  }
  $zip = @($entries | Where-Object { [string]$_.suffix -ceq "zip" })
  if ($zip.Count -ne 1 -or [string]$zip[0].objectSha256 -cne [string]$zip[0].artifactSha256) {
    throw "The gateway ZIP digest does not match the artifact identity."
  }
  return $zip[0]
}

function Assert-GatewayReleaseVariables {
  param(
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$ReleaseVariables,
    [Parameter(Mandatory)][object]$Artifact,
    [Parameter(Mandatory)][string]$ExpectedAccountId,
    [Parameter(Mandatory)][string]$ExpectedMigrationRepositoryUrl,
    [AllowEmptyString()][string]$ExpectedParserQualifiedArn = ""
  )
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $releaseNames = @($ReleaseVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "|") -cne ($releaseNames -join "|")) {
    throw "The gateway release changed the exact Terraform variable inventory."
  }
  $allowed = @(
    "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
    "gateway_lambda_artifact_sha256", "gateway_lambda_artifact_base64sha256"
  )
  foreach ($name in $baselineNames) {
    $before = Get-GatewayPlanVariableValue -Variables $BaselineVariables -Name $name
    $after = Get-GatewayPlanVariableValue -Variables $ReleaseVariables -Name $name
    if ($name -notin $allowed -and
        (ConvertTo-GatewayCanonicalJson $before) -cne (ConvertTo-GatewayCanonicalJson $after)) {
      throw "The gateway release changed non-gateway input '$name'."
    }
  }
  $expected = @{
    gateway_lambda_artifact_s3_key = [string]$Artifact.key
    gateway_lambda_artifact_s3_object_version = [string]$Artifact.versionId
    gateway_lambda_artifact_sha256 = [string]$Artifact.artifactSha256
    gateway_lambda_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
  }
  foreach ($entry in $expected.GetEnumerator()) {
    if ([string](Get-GatewayPlanVariableValue -Variables $ReleaseVariables -Name $entry.Key) -cne [string]$entry.Value) {
      throw "The gateway release does not use the verified '$($entry.Key)'."
    }
  }
  $stage = [string](Get-GatewayPlanVariableValue $ReleaseVariables "document_processing_deployment_stage")
  $parserArn = [string](Get-GatewayPlanVariableValue $ReleaseVariables "document_parser_invocation_qualified_arn")
  if ($stage -notin @("parser-dark", "complete-dark") -or
      [bool](Get-GatewayPlanVariableValue $ReleaseVariables "document_scan_mapping_enabled") -or
      [bool](Get-GatewayPlanVariableValue $ReleaseVariables "document_scan_event_rule_enabled")) {
    throw "The gateway release must preserve the deployed processing-dark boundary."
  }
  if ($stage -ceq "parser-dark" -and -not [string]::IsNullOrEmpty($parserArn)) {
    throw "Parser-dark must preserve an empty processor parser-version pin."
  }
  if ($stage -ceq "complete-dark" -and
      ($parserArn -cne $ExpectedParserQualifiedArn -or
       $parserArn -cnotmatch "^arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
    throw "Complete-dark must preserve the exact numeric parser-version ARN."
  }
  $migrationImage = [string](Get-GatewayPlanVariableValue $ReleaseVariables "migration_image")
  if ($migrationImage -cnotmatch "^$([regex]::Escape($ExpectedMigrationRepositoryUrl))@sha256:[a-f0-9]{64}$" -or
      $ExpectedMigrationRepositoryUrl -cne "$ExpectedAccountId.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration") {
    throw "The gateway release must preserve an immutable digest in the exact Terraform-owned development migration repository."
  }
  return $true
}

function Assert-ExactGatewayReleasePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][object]$Artifact)
  if ([string]$Plan.terraform_version -cne "1.9.8" -or $Plan.errored -or -not $Plan.complete -or -not $Plan.applyable) {
    throw "The gateway release must be a successful Terraform 1.9.8 plan."
  }
  if (@(Get-GatewayMeaningfulChanges @($Plan.resource_drift)).Count -ne 0) {
    throw "The gateway release contains resource drift; reconcile it separately."
  }
  $outputChanges = Get-GatewayOptionalProperty $Plan "output_changes"
  $meaningfulOutputs = @(
    if ($null -ne $outputChanges) {
      $outputChanges.PSObject.Properties | Where-Object {
        $actions = @($_.Value.actions); -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
      }
    }
  )
  if ($meaningfulOutputs.Count -ne 0) { throw "The gateway release contains a meaningful output change." }
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  $expected = @(
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  ) | Sort-Object
  $actual = @($changes | ForEach-Object { [string]$_.address } | Sort-Object)
  if (($actual -join "|") -cne ($expected -join "|")) {
    throw "The release plan is not limited to the gateway Lambda function and immutable alias."
  }
  foreach ($change in $changes) {
    if ([string]$change.mode -cne "managed" -or (@($change.change.actions) -join ",") -cne "update" -or
        @((Get-GatewayOptionalProperty $change.change "replace_paths")).Count -ne 0 -or
        (ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $change.change "before_sensitive")) -cne
          (ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $change.change "after_sensitive"))) {
      throw "The gateway release may not create, delete, or replace infrastructure."
    }
  }
  $function = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.gateway[0]" })[0]
  if ([string]$function.type -cne "aws_lambda_function" -or
      [string]$function.change.after.s3_key -cne [string]$Artifact.key -or
      [string]$function.change.after.s3_object_version -cne [string]$Artifact.versionId -or
      [string]$function.change.after.source_code_hash -cne [string]$Artifact.objectBase64Sha256 -or
      [string]$function.change.after.environment[0].variables.RELEASE_SHA -cne [string]$Artifact.artifactSha256) {
    throw "The gateway function update is not bound to the exact reviewed artifact."
  }
  $functionBefore = $function.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $functionAfter = $function.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $functionBefore.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  $functionAfter.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  foreach ($field in @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")) {
    $functionBefore.PSObject.Properties.Remove($field); $functionAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $functionBefore) -cne (ConvertTo-GatewayCanonicalJson $functionAfter)) {
    throw "The gateway release changed a nonapproved Lambda function field."
  }
  $functionUnknown = Get-GatewayOptionalProperty $function.change "after_unknown"
  $unknownFunctionKeys = @($(if ($null -eq $functionUnknown) { @() } else { $functionUnknown.PSObject.Properties | ForEach-Object Name }))
  if (@($unknownFunctionKeys | Where-Object { $_ -notin @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "version") }).Count -ne 0) {
    throw "The gateway release contains an unknown nonapproved Lambda function field."
  }
  $alias = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_alias.gateway[0]" })[0]
  if ([string]$alias.type -cne "aws_lambda_alias") { throw "The gateway alias change has an unexpected Terraform type." }
  $aliasBefore = $alias.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $aliasAfter = $alias.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  foreach ($field in @("arn", "function_version", "invoke_arn")) {
    $aliasBefore.PSObject.Properties.Remove($field); $aliasAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $aliasBefore) -cne (ConvertTo-GatewayCanonicalJson $aliasAfter) -or
      [string]$alias.change.before.function_version -ceq [string]$alias.change.after.function_version) {
    throw "The gateway release changed alias routing or a non-version field."
  }
  $aliasUnknown = Get-GatewayOptionalProperty $alias.change "after_unknown"
  $unknownAliasKeys = @($(if ($null -eq $aliasUnknown) { @() } else { $aliasUnknown.PSObject.Properties | ForEach-Object Name }))
  if (@($unknownAliasKeys | Where-Object { $_ -notin @("arn", "function_version", "invoke_arn") }).Count -ne 0) {
    throw "The gateway release contains an unknown nonapproved alias field."
  }
  return $changes
}
