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
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][string]$PlanPath,
    [Parameter(Mandatory)][string]$PlanSha256,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ExpectedMigrationRepositoryUrl,
    [Parameter(Mandatory)][object]$CurrentState
  )
  $v1Keys = @(
    "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
    "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
    "SourceSha", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  $v2Keys = @($v1Keys + "MigrationImage" | Sort-Object)
  $v3Keys = @($v1Keys | Where-Object { $_ -cne "SourceSha" }) + @("OperatorDeltaSha256", "OperatorSourceSha", "ReleaseSourceSha") | Sort-Object
  $v4Keys = @($v3Keys + "MigrationImage" | Sort-Object)
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $schemaVersion = [string]$Metadata.SchemaVersion
  $expectedKeys = if ($schemaVersion -ceq "1") { $v1Keys } elseif ($schemaVersion -ceq "2") { $v2Keys } elseif ($schemaVersion -ceq "3") { $v3Keys } elseif ($schemaVersion -ceq "4") { $v4Keys } else { @() }
  $createdAt = [datetime]::MinValue
  $createdAtValid = [datetime]::TryParse([string]$Metadata.CreatedAt, [ref]$createdAt) -and
    $createdAt.Year -ge 2000 -and $createdAt.Year -le 2099
  $metadataPlanPath = if ([string]::IsNullOrWhiteSpace([string]$Metadata.PlanPath)) { "" } else { [IO.Path]::GetFullPath([string]$Metadata.PlanPath) }
  $stage = Get-GatewayPlanVariableValue -Variables $Plan.variables -Name "document_processing_deployment_stage"
  $parserQualifiedArn = Get-GatewayPlanVariableValue -Variables $Plan.variables -Name "document_parser_invocation_qualified_arn"
  $migrationImage = Get-GatewayPlanVariableValue -Variables $Plan.variables -Name "migration_image"
  if ($stage -isnot [string] -or $parserQualifiedArn -isnot [string] -or $migrationImage -isnot [string]) {
    throw "The retained baseline stage, parser pin, and migration image must be exact strings."
  }
  if ($ExpectedMigrationRepositoryUrl -cne "$AccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration" -or
      [string]$migrationImage -cnotmatch "^$([regex]::Escape($ExpectedMigrationRepositoryUrl))@sha256:[a-f0-9]{64}$") {
    throw "The retained baseline migration image is outside the exact Terraform-owned development repository."
  }
  $sourceBindingValid = if ($schemaVersion -in @("3", "4")) {
    [string]$Metadata.ReleaseSourceSha -match '^[a-f0-9]{40}$' -and
      [string]$Metadata.OperatorSourceSha -ceq $SourceSha -and
      [string]$Metadata.OperatorDeltaSha256 -match '^[a-f0-9]{64}$'
  } else { [string]$Metadata.SourceSha -ceq $SourceSha }
  if ($expectedKeys.Count -eq 0 -or ($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
      [string]$Metadata.Kind -cne "development-document-zero-drift-baseline" -or
      [string]$Metadata.Environment -cne "development" -or
      [string]$Metadata.AccountId -cne $AccountId -or [string]$Metadata.Region -cne $Region -or
      -not $sourceBindingValid -or
      $metadataPlanPath -cne [IO.Path]::GetFullPath($PlanPath) -or
      [string]$Metadata.PlanSha256 -cne $PlanSha256 -or -not $createdAtValid -or
      $Metadata.Applyable -isnot [bool] -or $Metadata.Applyable -or
      [int]$Metadata.MeaningfulChanges -ne 0 -or
      [string]$CurrentState.Lineage -cnotmatch '^[a-f0-9-]{36}$' -or [long]$CurrentState.Serial -lt 1 -or
      [string]$Metadata.StateLineage -cne [string]$CurrentState.Lineage -or
      [long]$Metadata.StateSerial -ne [long]$CurrentState.Serial -or
      [string]$stage -notin @("parser-dark", "complete-dark") -or
      [string]$Metadata.Stage -cne [string]$stage -or
      [string]$Metadata.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Metadata.ParserQualifiedArn -cne [string]$parserQualifiedArn -or
      ([string]$stage -ceq "parser-dark" -and -not [string]::IsNullOrEmpty([string]$parserQualifiedArn)) -or
      ([string]$stage -ceq "complete-dark" -and
        [string]$parserQualifiedArn -cnotmatch "^arn:aws:lambda:$([regex]::Escape($Region)):$AccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
    throw "The retained baseline metadata does not match the exact document-to-gateway handoff."
  }
  if ($schemaVersion -in @("2", "4") -and [string]$Metadata.MigrationImage -cne [string]$migrationImage) {
    throw "The version-2 retained baseline metadata does not bind the exact migration image."
  }
  return $true
}

function Assert-GatewayDocumentBaselineReceipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ReceiptSha256,
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$ExpectedBoundarySha256
  )
  $expectedKeys = @(
    "artifacts", "boundarySha256", "completedAt", "createdAt", "environment", "kind",
    "phase", "region", "schemaVersion", "sourceSha"
  ) | Sort-Object
  $actualKeys = @($Receipt.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if ($ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      ($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
      [int]$Receipt.schemaVersion -ne 1 -or
      [string]$Receipt.kind -cne "development-document-lambda-publication" -or
      [string]$Receipt.environment -cne "development" -or [string]$Receipt.region -cne "us-east-2" -or
      [string]$Receipt.sourceSha -cne $SourceSha -or
      [string]$Receipt.boundarySha256 -cne $ExpectedBoundarySha256 -or
      [string]$Receipt.phase -cne "verified") {
    throw "The retained baseline document receipt does not match the exact release boundary."
  }
  $entries = @($Receipt.artifacts)
  if ($entries.Count -ne 8) { throw "The retained baseline document receipt must contain exactly eight objects." }
  foreach ($name in @("document-parser-lambda", "document-processor-lambda")) {
    $named = @($entries | Where-Object { [string]$_.artifactName -ceq $name })
    $suffixes = @($named | ForEach-Object { [string]$_.suffix } | Sort-Object)
    $digests = @($named | ForEach-Object { [string]$_.artifactSha256 } | Sort-Object -Unique)
    if ($named.Count -ne 4 -or ($suffixes -join ",") -cne "cdx.json,manifest.json,sha256,zip" -or
        $digests.Count -ne 1 -or [string]$digests[0] -cnotmatch '^[a-f0-9]{64}$') {
      throw "The retained baseline document receipt has an invalid artifact matrix."
    }
    foreach ($entry in $named) {
      if ([string]$entry.key -cne "lambda/documents/$SourceSha/$($entry.artifactSha256)/$name.$($entry.suffix)" -or
          [string]::IsNullOrWhiteSpace([string]$entry.versionId) -or
          [string]$entry.objectSha256 -cnotmatch '^[a-f0-9]{64}$' -or
          [string]$entry.objectBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
          [long]$entry.contentLength -le 0 -or
          ([string]$entry.suffix -ceq "zip" -and
            [string]$entry.objectSha256 -cne [string]$entry.artifactSha256)) {
        throw "The retained baseline document receipt contains an invalid immutable object."
      }
    }
  }
  $parser = @($entries | Where-Object { [string]$_.artifactName -ceq "document-parser-lambda" -and [string]$_.suffix -ceq "zip" })
  $processor = @($entries | Where-Object { [string]$_.artifactName -ceq "document-processor-lambda" -and [string]$_.suffix -ceq "zip" })
  if ($parser.Count -ne 1 -or $processor.Count -ne 1) { throw "The document receipt lacks an exact parser/processor ZIP pair." }
  foreach ($binding in @(
      @{ Variable = "document_parser_artifact_s3_key"; Value = [string]$parser[0].key },
      @{ Variable = "document_parser_artifact_s3_object_version"; Value = [string]$parser[0].versionId },
      @{ Variable = "document_parser_artifact_sha256"; Value = [string]$parser[0].artifactSha256 },
      @{ Variable = "document_parser_artifact_base64sha256"; Value = [string]$parser[0].objectBase64Sha256 }
    )) {
    if ([string](Get-GatewayPlanVariableValue $Plan.variables $binding.Variable) -cne $binding.Value) {
      throw "The retained baseline plan does not match its document receipt '$($binding.Variable)'."
    }
  }
  $stage = [string](Get-GatewayPlanVariableValue $Plan.variables "document_processing_deployment_stage")
  $processorBindings = @(
    @{ Variable = "document_processor_artifact_s3_key"; Value = [string]$processor[0].key },
    @{ Variable = "document_processor_artifact_s3_object_version"; Value = [string]$processor[0].versionId },
    @{ Variable = "document_processor_artifact_sha256"; Value = [string]$processor[0].artifactSha256 },
    @{ Variable = "document_processor_artifact_base64sha256"; Value = [string]$processor[0].objectBase64Sha256 }
  )
  foreach ($binding in $processorBindings) {
    $actual = [string](Get-GatewayPlanVariableValue $Plan.variables $binding.Variable)
    $expected = if ($stage -ceq "complete-dark") { $binding.Value } else { "" }
    if ($actual -cne $expected) {
      throw "The retained baseline plan does not preserve its stage-specific document receipt '$($binding.Variable)'."
    }
  }
  return $true
}

function Assert-AcceptedGatewayProviderDrift {
  param([Parameter(Mandatory)][object]$Plan)

  $drift = @($Plan.resource_drift | Where-Object { $null -ne $_ })
  if ($drift.Count -eq 0) { return }
  $plannedValues = Get-GatewayOptionalProperty $Plan "planned_values"
  $rootModule = Get-GatewayOptionalProperty $plannedValues "root_module"
  if ($null -eq $rootModule) {
    throw "Accepted gateway provider drift requires the exact source-evaluated planned root module."
  }
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records $drift -RootModule $rootModule
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
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
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
  $mappingEnabled = ConvertTo-ExactBoolean `
    (Get-GatewayPlanVariableValue $ReleaseVariables "document_scan_mapping_enabled") `
    "document_scan_mapping_enabled"
  $eventRuleEnabled = ConvertTo-ExactBoolean `
    (Get-GatewayPlanVariableValue $ReleaseVariables "document_scan_event_rule_enabled") `
    "document_scan_event_rule_enabled"
  if ($stage -notin @("parser-dark", "complete-dark") -or
      $mappingEnabled -or $eventRuleEnabled) {
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
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
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
    Assert-NoTerraformReplacementPaths $change.change
    if ([string]$change.mode -cne "managed" -or (@($change.change.actions) -join ",") -cne "update" -or
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
