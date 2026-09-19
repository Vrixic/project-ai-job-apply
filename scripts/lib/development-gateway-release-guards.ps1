Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "terraform-toolchain.ps1")
. (Join-Path $PSScriptRoot "development-deletion-restore-role.ps1")

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

function Get-GatewayUnknownTrueLeafPaths {
  param(
    [Parameter(Mandatory)][object]$Value,
    [AllowEmptyString()][string]$Path = ""
  )
  if ($Value -is [bool]) {
    if ($Value) { return $Path }
    return
  }
  if ($Value -is [array]) {
    for ($index = 0; $index -lt $Value.Count; $index++) {
      Get-GatewayUnknownTrueLeafPaths -Value $Value[$index] -Path "$Path[$index]"
    }
    return
  }
  if ($Value -is [pscustomobject]) {
    foreach ($property in $Value.PSObject.Properties) {
      $childPath = if ([string]::IsNullOrEmpty($Path)) { [string]$property.Name }
        else { "$Path.$($property.Name)" }
      Get-GatewayUnknownTrueLeafPaths -Value $property.Value -Path $childPath
    }
    return
  }
  throw "Terraform after_unknown contains a null or nonboolean scalar leaf."
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
    [Parameter(Mandatory)][object]$CurrentState,
    [switch]$AllowOneSerialAdvance
  )
  $v1Keys = @(
    "AccountId", "Applyable", "CreatedAt", "Environment", "Kind", "MeaningfulChanges",
    "ParserQualifiedArn", "PlanPath", "PlanSha256", "ReceiptSha256", "Region", "SchemaVersion",
    "SourceSha", "Stage", "StateLineage", "StateSerial"
  ) | Sort-Object
  $v2Keys = @($v1Keys + "MigrationImage" | Sort-Object)
  $v3Keys = @($v1Keys | Where-Object { $_ -cne "SourceSha" }) + @("OperatorDeltaSha256", "OperatorSourceSha", "ReleaseSourceSha") | Sort-Object
  $v4Keys = @($v3Keys + "MigrationImage" | Sort-Object)
  $v5Keys = @($v4Keys + @(
      "BaselineToReleaseDeltaSha256", "DocumentOperatorDeltaSha256",
      "DocumentOperatorSourceSha", "DocumentReleaseSourceSha"
    ) | Sort-Object)
  $v6Keys = @($v2Keys + "DocumentReleaseSourceSha" | Sort-Object)
  $actualKeys = @($Metadata.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $schemaVersion = [string]$Metadata.SchemaVersion
  $v7Keys = @($v6Keys + "DocumentSourceDeltaSha256" | Sort-Object)
  $expectedKeys = if ($schemaVersion -ceq "1") { $v1Keys } elseif ($schemaVersion -ceq "2") { $v2Keys } elseif ($schemaVersion -ceq "3") { $v3Keys } elseif ($schemaVersion -ceq "4") { $v4Keys } elseif ($schemaVersion -ceq "5") { $v5Keys } elseif ($schemaVersion -ceq "6") { $v6Keys } elseif ($schemaVersion -ceq "7") { $v7Keys } else { @() }
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
  } elseif ($schemaVersion -ceq "5") {
    [string]$Metadata.DocumentReleaseSourceSha -match '^[a-f0-9]{40}$' -and
      [string]$Metadata.DocumentOperatorSourceSha -match '^[a-f0-9]{40}$' -and
      [string]$Metadata.DocumentOperatorDeltaSha256 -match '^[a-f0-9]{64}$' -and
      [string]$Metadata.ReleaseSourceSha -match '^[a-f0-9]{40}$' -and
      [string]$Metadata.BaselineToReleaseDeltaSha256 -match '^[a-f0-9]{64}$' -and
      [string]$Metadata.OperatorSourceSha -ceq $SourceSha -and
      [string]$Metadata.OperatorDeltaSha256 -match '^[a-f0-9]{64}$'
  } elseif ($schemaVersion -in @("6", "7")) {
    [string]$Metadata.SourceSha -ceq $SourceSha -and
      [string]$Metadata.DocumentReleaseSourceSha -match '^[a-f0-9]{40}$' -and
      ($schemaVersion -cne "7" -or [string]$Metadata.DocumentSourceDeltaSha256 -cmatch '^[a-f0-9]{64}$')
  } else { [string]$Metadata.SourceSha -ceq $SourceSha }
  $stateBindingValid = [string]$Metadata.StateLineage -ceq [string]$CurrentState.Lineage -and
    ([long]$Metadata.StateSerial -eq [long]$CurrentState.Serial -or
      ($AllowOneSerialAdvance -and
        [long]$CurrentState.Serial -eq ([long]$Metadata.StateSerial + 1)))
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
      -not $stateBindingValid -or
      [string]$stage -notin @("parser-dark", "complete-dark") -or
      [string]$Metadata.Stage -cne [string]$stage -or
      [string]$Metadata.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Metadata.ParserQualifiedArn -cne [string]$parserQualifiedArn -or
      ([string]$stage -ceq "parser-dark" -and -not [string]::IsNullOrEmpty([string]$parserQualifiedArn)) -or
      ([string]$stage -ceq "complete-dark" -and
        [string]$parserQualifiedArn -cnotmatch "^arn:aws:lambda:$([regex]::Escape($Region)):$AccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$")) {
    throw "The retained baseline metadata does not match the exact document-to-gateway handoff."
  }
  if ($schemaVersion -in @("2", "4", "5", "6", "7") -and [string]$Metadata.MigrationImage -cne [string]$migrationImage) {
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
  Assert-RestoreRoleAcceptedPlanDrift -Plan $Plan
}

function Assert-RetainedGatewayBaselinePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string[]]$DeclaredVariableNames)
  if ($Plan.complete -isnot [bool] -or -not $Plan.complete -or
      $Plan.errored -isnot [bool] -or $Plan.errored -or
      $Plan.applyable -isnot [bool] -or $Plan.applyable -or
      [string]$Plan.terraform_version -cnotin @("1.9.8", (Get-DeploymentTerraformVersion)) -or
      $null -eq $Plan.variables -or $null -eq $Plan.planned_values -or $null -eq $Plan.planned_values.root_module) {
    throw "The retained gateway baseline is not a complete, nonerrored, nonapplyable approved-version Terraform plan."
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
    [AllowEmptyString()][string]$ExpectedParserQualifiedArn = "",
    # The verified document processor artifact, when this release also refreshes the processor.
    [AllowNull()][object]$ProcessorArtifact = $null
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
  $processorVariableNames = @(
    "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
    "document_processor_artifact_sha256", "document_processor_artifact_base64sha256"
  )
  if ($null -ne $ProcessorArtifact) { $allowed = @($allowed + $processorVariableNames) }
  foreach ($name in $baselineNames) {
    $before = Get-GatewayPlanVariableValue -Variables $BaselineVariables -Name $name
    $after = Get-GatewayPlanVariableValue -Variables $ReleaseVariables -Name $name
    if ($name -ceq "document_tailoring_invoke_enabled") {
      # The Gateway-to-Documents invoke grant (ADR-031) may be switched on once, never off here.
      $beforeEnabled = ConvertTo-ExactBoolean $before "document_tailoring_invoke_enabled"
      $afterEnabled = ConvertTo-ExactBoolean $after "document_tailoring_invoke_enabled"
      if ($beforeEnabled -and -not $afterEnabled) {
        throw "The gateway release may not switch off the document tailoring invoke grant."
      }
      continue
    }
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
  if ($null -ne $ProcessorArtifact) {
    $expected["document_processor_artifact_s3_key"] = [string]$ProcessorArtifact.key
    $expected["document_processor_artifact_s3_object_version"] = [string]$ProcessorArtifact.versionId
    $expected["document_processor_artifact_sha256"] = [string]$ProcessorArtifact.artifactSha256
    $expected["document_processor_artifact_base64sha256"] = [string]$ProcessorArtifact.objectBase64Sha256
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

function ConvertTo-GatewayStringList {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return @() }
  return @($Value | ForEach-Object { [string]$_ })
}

# Compares two IAM policy documents. `After` must equal `Before` plus exactly one statement, and that
# statement must be the reviewed one. Statement order is irrelevant; content is compared exactly.
function Assert-GatewayPolicyGainsExactlyOneStatement {
  param(
    [Parameter(Mandatory)][string]$BeforeJson,
    [Parameter(Mandatory)][string]$AfterJson,
    [Parameter(Mandatory)][string]$Sid,
    [Parameter(Mandatory)][string]$AliasArn,
    [AllowEmptyString()][string]$PrincipalRoleArn = "",
    [Parameter(Mandatory)][string]$Label
  )
  $before = $BeforeJson | ConvertFrom-Json
  $after = $AfterJson | ConvertFrom-Json
  $beforeStatements = @($before.Statement)
  $afterStatements = @($after.Statement)
  $added = @($afterStatements | Where-Object { [string]$_.Sid -ceq $Sid })
  if ([string]$before.Version -cne [string]$after.Version -or
      $afterStatements.Count -ne $beforeStatements.Count + 1 -or $added.Count -ne 1 -or
      @($beforeStatements | Where-Object { [string]$_.Sid -ceq $Sid }).Count -ne 0) {
    throw "The $Label change is not exactly one added statement."
  }
  $statement = $added[0]
  $properties = @($statement.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $expectedProperties = @("Action", "Effect", "Resource", "Sid") | Sort-Object
  if ($PrincipalRoleArn) { $expectedProperties = @("Action", "Effect", "Principal", "Resource", "Sid") | Sort-Object }
  if (($properties -join "|") -cne ($expectedProperties -join "|") -or
      [string]$statement.Effect -cne "Allow" -or
      ((ConvertTo-GatewayStringList $statement.Action) -join "|") -cne "lambda:InvokeFunction" -or
      ((ConvertTo-GatewayStringList $statement.Resource) -join "|") -cne $AliasArn) {
    throw "The $Label statement is not the exact reviewed invoke grant."
  }
  if ($PrincipalRoleArn) {
    $principal = $statement.Principal
    $principalProperties = @($principal.PSObject.Properties | ForEach-Object Name)
    if (($principalProperties -join "|") -cne "AWS" -or
        ((ConvertTo-GatewayStringList $principal.AWS) -join "|") -cne $PrincipalRoleArn) {
      throw "The $Label principal is not the exact Gateway role."
    }
  }
  $remaining = @($afterStatements | Where-Object { [string]$_.Sid -cne $Sid } |
      ForEach-Object { ConvertTo-GatewayCanonicalJson $_ } | Sort-Object)
  $original = @($beforeStatements | ForEach-Object { ConvertTo-GatewayCanonicalJson $_ } | Sort-Object)
  if (($remaining -join "|") -cne ($original -join "|")) {
    throw "The $Label change altered an existing statement."
  }
}

# The one document processor artifact a release may refresh, taken only from a verified publication
# receipt for the exact release source (ADR-031). Live object readback is done by the operator.
function Get-GatewayProcessorArtifact {
  param([Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][string]$SourceSha)
  Assert-DevelopmentDocumentPublicationReceipt -Receipt $Receipt
  if ([string]$Receipt.sourceSha -cne $SourceSha) {
    throw "The document publication receipt does not belong to the exact release source."
  }
  $zip = @($Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq "document-processor-lambda" -and [string]$_.suffix -ceq "zip"
    })
  if ($zip.Count -ne 1) { throw "The document publication receipt does not contain exactly one processor archive." }
  return [pscustomobject]@{
    key = [string]$zip[0].key; versionId = [string]$zip[0].versionId
    artifactSha256 = [string]$zip[0].artifactSha256; objectBase64Sha256 = [string]$zip[0].objectBase64Sha256
    contentLength = [long]$zip[0].contentLength
  }
}

# The processor function may change only its code coordinates and RELEASE_SHA, and its alias only its
# numeric version. The parser pin, policy, layers, network, and every other field must be unchanged.
function Assert-GatewayProcessorRefreshChanges {
  param([Parameter(Mandatory)][object[]]$Changes, [Parameter(Mandatory)][object]$ProcessorArtifact)
  $function = @($Changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.document_processor[0]" })[0]
  if ([string]$function.type -cne "aws_lambda_function" -or
      [string]$function.change.after.s3_key -cne [string]$ProcessorArtifact.key -or
      [string]$function.change.after.s3_object_version -cne [string]$ProcessorArtifact.versionId -or
      [string]$function.change.after.source_code_hash -cne [string]$ProcessorArtifact.objectBase64Sha256 -or
      [string]$function.change.after.environment[0].variables.RELEASE_SHA -cne [string]$ProcessorArtifact.artifactSha256) {
    throw "The document processor update is not bound to the exact verified artifact."
  }
  $before = $function.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $after = $function.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $before.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  $after.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  foreach ($field in @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")) {
    $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $before) -cne (ConvertTo-GatewayCanonicalJson $after)) {
    $differing = @($before.PSObject.Properties.Name | Where-Object {
        (ConvertTo-GatewayCanonicalJson $before.$_) -cne (ConvertTo-GatewayCanonicalJson $after.$_)
      })
    throw "The release changed a nonapproved document processor field: $($differing -join ', ')."
  }
  $unknown = Get-GatewayOptionalProperty $function.change "after_unknown"
  $unknownPaths = @(if ($null -ne $unknown) { Get-GatewayUnknownTrueLeafPaths -Value $unknown | Sort-Object })
  if (($unknownPaths -join "|") -cne ((@("last_modified", "qualified_arn", "qualified_invoke_arn", "version") | Sort-Object) -join "|")) {
    throw "The release contains an unknown nonapproved document processor field."
  }
  $alias = @($Changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_alias.document_processor[0]" })[0]
  if ([string]$alias.type -cne "aws_lambda_alias") { throw "The document processor alias change has an unexpected Terraform type." }
  $aliasBefore = $alias.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $aliasAfter = $alias.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $beforeVersion = $aliasBefore.PSObject.Properties["function_version"]
  $afterVersion = $aliasAfter.PSObject.Properties["function_version"]
  foreach ($field in @("arn", "function_version", "invoke_arn")) {
    $aliasBefore.PSObject.Properties.Remove($field); $aliasAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $aliasBefore) -cne (ConvertTo-GatewayCanonicalJson $aliasAfter) -or
      $null -eq $beforeVersion -or $beforeVersion.Value -isnot [string] -or
      [string]$beforeVersion.Value -cnotmatch '^[1-9][0-9]*$' -or $null -ne $afterVersion) {
    throw "The release changed the document processor alias routing or a non-version field."
  }
  $aliasUnknown = Get-GatewayOptionalProperty $alias.change "after_unknown"
  $aliasUnknownPaths = @(if ($null -ne $aliasUnknown) { Get-GatewayUnknownTrueLeafPaths -Value $aliasUnknown | Sort-Object })
  if (($aliasUnknownPaths -join "|") -cne "function_version") {
    throw "The release contains an unknown nonapproved document processor alias field."
  }
}

function Assert-ExactGatewayReleasePlan {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][object]$Artifact,
    [AllowEmptyString()][string]$ExpectedAccountId = "",
    [AllowNull()][object]$ProcessorArtifact = $null,
    [switch]$AllowHistorical
  )
  $acceptedVersions = @((Get-DeploymentTerraformVersion))
  if ($AllowHistorical) { $acceptedVersions += "1.9.8" }
  if ([string]$Plan.terraform_version -cnotin $acceptedVersions -or $Plan.errored -or -not $Plan.complete -or -not $Plan.applyable) {
    throw "The gateway release must be a successful current-version Terraform plan."
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
  $grantAddresses = @(
    "module.platform.aws_iam_role_policy.gateway_lambda[0]",
    "module.platform.aws_vpc_endpoint.lambda[0]"
  )
  $processorAddresses = @(
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_function.document_processor[0]"
  )
  $actual = @($changes | ForEach-Object { [string]$_.address } | Sort-Object)
  $grantCount = @($grantAddresses | Where-Object { $actual -ccontains $_ }).Count
  $processorCount = @($processorAddresses | Where-Object { $actual -ccontains $_ }).Count
  $grantRelease = $grantCount -eq 2
  $processorRelease = $processorCount -eq 2
  $expectedAddresses = @(
    $expected
    if ($grantRelease) { $grantAddresses }
    if ($processorRelease) { $processorAddresses }
  ) | Sort-Object
  if ($grantCount -notin @(0, 2) -or $processorCount -notin @(0, 2) -or
      ($actual -join "|") -cne ($expectedAddresses -join "|")) {
    throw "The release plan is not limited to the gateway Lambda function and immutable alias."
  }
  if ($grantRelease) {
    # The one-time reviewed invoke grant (ADR-031) needs its switch on and the reviewed account.
    $tailoringVariable = Get-GatewayOptionalProperty $Plan.variables "document_tailoring_invoke_enabled"
    if ($null -eq $tailoringVariable -or
        -not (ConvertTo-ExactBoolean $tailoringVariable.value "document_tailoring_invoke_enabled") -or
        $ExpectedAccountId -cnotmatch '^[0-9]{12}$') {
      throw "The release plan is not limited to the gateway Lambda function and immutable alias."
    }
  }
  if ($processorRelease -and $null -eq $ProcessorArtifact) {
    throw "A document processor refresh requires the exact verified processor artifact."
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
  if ($grantRelease) {
    $aliasArn = "arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:ai-job-apply-development-document-processor:development"
    $tailoringName = "DOCUMENT_TAILORING_FUNCTION_ARN"
    if ($null -ne $functionBefore.environment[0].variables.PSObject.Properties[$tailoringName] -or
        $null -eq $functionAfter.environment[0].variables.PSObject.Properties[$tailoringName] -or
        [string]$functionAfter.environment[0].variables.$tailoringName -cne $aliasArn) {
      throw "The gateway function must gain exactly the reviewed document tailoring function ARN."
    }
    $functionAfter.environment[0].variables.PSObject.Properties.Remove($tailoringName)
  }
  foreach ($field in @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")) {
    $functionBefore.PSObject.Properties.Remove($field); $functionAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $functionBefore) -cne (ConvertTo-GatewayCanonicalJson $functionAfter)) {
    throw "The gateway release changed a nonapproved Lambda function field."
  }
  $functionUnknown = Get-GatewayOptionalProperty $function.change "after_unknown"
  $unknownFunctionPaths = @(
    if ($null -ne $functionUnknown) {
      Get-GatewayUnknownTrueLeafPaths -Value $functionUnknown | Sort-Object
    }
  )
  $expectedFunctionUnknownPaths = @("last_modified", "qualified_arn", "qualified_invoke_arn", "version") | Sort-Object
  if (($unknownFunctionPaths -join "|") -cne ($expectedFunctionUnknownPaths -join "|")) {
    throw "The gateway release contains an unknown nonapproved Lambda function field."
  }
  $alias = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_alias.gateway[0]" })[0]
  if ([string]$alias.type -cne "aws_lambda_alias") { throw "The gateway alias change has an unexpected Terraform type." }
  $aliasBefore = $alias.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $aliasAfter = $alias.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $aliasBeforeVersion = $aliasBefore.PSObject.Properties["function_version"]
  $aliasAfterVersion = $aliasAfter.PSObject.Properties["function_version"]
  foreach ($field in @("arn", "function_version", "invoke_arn")) {
    $aliasBefore.PSObject.Properties.Remove($field); $aliasAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-GatewayCanonicalJson $aliasBefore) -cne (ConvertTo-GatewayCanonicalJson $aliasAfter) -or
      $null -eq $aliasBeforeVersion -or $aliasBeforeVersion.Value -isnot [string] -or
      [string]$aliasBeforeVersion.Value -cnotmatch '^[1-9][0-9]*$' -or $null -ne $aliasAfterVersion) {
    throw "The gateway release changed alias routing or a non-version field."
  }
  $aliasUnknown = Get-GatewayOptionalProperty $alias.change "after_unknown"
  $unknownAliasPaths = @(
    if ($null -ne $aliasUnknown) {
      Get-GatewayUnknownTrueLeafPaths -Value $aliasUnknown | Sort-Object
    }
  )
  if (($unknownAliasPaths -join "|") -cne "function_version") {
    throw "The gateway release contains an unknown nonapproved alias field."
  }
  if ($processorRelease) { Assert-GatewayProcessorRefreshChanges -Changes $changes -ProcessorArtifact $ProcessorArtifact }
  if ($grantRelease) {
    $aliasArn = "arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:ai-job-apply-development-document-processor:development"
    $gatewayRoleArn = "arn:aws:iam::$ExpectedAccountId`:role/ai-job-apply-development-gateway-lambda"
    $grants = @(
      @{ Address = "module.platform.aws_iam_role_policy.gateway_lambda[0]"; Type = "aws_iam_role_policy"; Sid = "InvokeExactDocumentTailoringRuntime"; Principal = ""; Label = "gateway role policy" },
      @{ Address = "module.platform.aws_vpc_endpoint.lambda[0]"; Type = "aws_vpc_endpoint"; Sid = "GatewayInvokesExactDocumentProcessorAlias"; Principal = $gatewayRoleArn; Label = "Lambda endpoint policy" }
    )
    foreach ($grant in $grants) {
      $change = @($changes | Where-Object { [string]$_.address -ceq $grant.Address })[0]
      if ([string]$change.type -cne $grant.Type) { throw "The $($grant.Label) change has an unexpected Terraform type." }
      $grantBefore = $change.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
      $grantAfter = $change.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
      $beforePolicy = [string]$grantBefore.policy
      $afterPolicy = [string]$grantAfter.policy
      $grantBefore.PSObject.Properties.Remove("policy"); $grantAfter.PSObject.Properties.Remove("policy")
      if ((ConvertTo-GatewayCanonicalJson $grantBefore) -cne (ConvertTo-GatewayCanonicalJson $grantAfter)) {
        throw "The $($grant.Label) change altered a field other than the policy."
      }
      $grantUnknown = Get-GatewayOptionalProperty $change.change "after_unknown"
      $unknownGrantPaths = @(if ($null -ne $grantUnknown) { Get-GatewayUnknownTrueLeafPaths -Value $grantUnknown })
      if ($unknownGrantPaths.Count -ne 0) { throw "The $($grant.Label) change contains an unknown field." }
      Assert-GatewayPolicyGainsExactlyOneStatement -BeforeJson $beforePolicy -AfterJson $afterPolicy `
        -Sid $grant.Sid -AliasArn $aliasArn -PrincipalRoleArn $grant.Principal -Label $grant.Label
    }
  }
  return $changes
}
