Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-gateway-release-guards.ps1")

$passed = 0
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function Copy-Fixture { param([Parameter(Mandatory)][object]$Value); return $Value | ConvertTo-Json -Depth 50 | ConvertFrom-Json }

$account = "111122223333"
$sourceSha = "a" * 40
$artifactSha = "b" * 64
$boundarySha = "c" * 64
$artifactBase64 = [Convert]::ToBase64String(([byte[]](1..32)))
$repositoryUrl = "$account.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration"
foreach ($case in @(
    @{ Label = "runtime false"; Value = $false; Expected = $false },
    @{ Label = "runtime true"; Value = $true; Expected = $true },
    @{ Label = "string false"; Value = "false"; Expected = $false },
    @{ Label = "string true"; Value = "true"; Expected = $true }
  )) {
  $actual = ConvertTo-ExactBoolean $case.Value $case.Label
  if ($actual -isnot [bool] -or $actual -ne $case.Expected) {
    throw "ConvertTo-ExactBoolean rejected or changed the $($case.Label) form."
  }
  $passed++
}
foreach ($case in @(
    @{ Label = "null"; Value = $null },
    @{ Label = "uppercase false"; Value = "False" },
    @{ Label = "uppercase true"; Value = "TRUE" },
    @{ Label = "leading whitespace"; Value = " false" },
    @{ Label = "trailing whitespace"; Value = "false " },
    @{ Label = "empty string"; Value = "" },
    @{ Label = "numeric zero"; Value = 0 },
    @{ Label = "numeric one"; Value = 1 },
    @{ Label = "string zero"; Value = "0" },
    @{ Label = "string one"; Value = "1" },
    @{ Label = "object"; Value = [pscustomobject]@{} },
    @{ Label = "array"; Value = [object[]]@($false) }
  )) {
  Assert-Rejected { ConvertTo-ExactBoolean $case.Value $case.Label } `
    "ConvertTo-ExactBoolean accepted the noncanonical $($case.Label) form."
}
function New-GatewayProviderDriftRecord {
  param(
    [Parameter(Mandatory)][string]$Address,
    [Parameter(Mandatory)][string]$Type,
    [Parameter(Mandatory)][object]$Before,
    [Parameter(Mandatory)][object]$After,
    [object]$BeforeSensitive = ([pscustomobject]@{}),
    [object]$AfterSensitive = ([pscustomobject]@{})
  )
  return [pscustomobject]@{
    address = $Address; mode = "managed"; type = $Type
    change = [pscustomobject]@{
      actions = @("update"); before = $Before; after = $After; after_unknown = [pscustomobject]@{}
      before_sensitive = $BeforeSensitive; after_sensitive = $AfterSensitive
    }
  }
}
function New-GatewayCompleteDarkProviderDriftFixture {
  $kmsArn = "arn:aws:kms:us-east-2:${account}:key/12345678-1234-1234-1234-123456789abc"
  $parserArn = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:1"
  $objectRoleArn = "arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access"
  $bucketArn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-${account}"
  $processorPolicy = @{ Version = "2012-10-17"; Statement = @(
      @{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = @("logs:CreateLogStream", "logs:PutLogEvents"); Resource = "arn:aws:logs:us-east-2:${account}:log-group:/ai-job-apply/development/application:*" },
      @{ Sid = "ManageVpcInterfaces"; Effect = "Allow"; Action = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); Resource = "*" },
      @{ Sid = "ReadDatabaseSecret"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = "arn:aws:secretsmanager:us-east-2:${account}:secret:ai-job-apply/development/database-url-x" },
      @{ Sid = "ConsumeExactScanQueue"; Effect = "Allow"; Action = @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"); Resource = "arn:aws:sqs:us-east-2:${account}:ai-job-apply-development-document-scan-results" },
      @{ Sid = "InvokeExactParserVersion"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $parserArn },
      @{ Sid = "AssumeExactObjectAccessRole"; Effect = "Allow"; Action = "sts:AssumeRole"; Resource = $objectRoleArn },
      @{ Sid = "ReadNormalizedDocumentsOnly"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$bucketArn/normalized/*" },
      @{ Sid = "DecryptOwnedRuntimeData"; Effect = "Allow"; Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = $kmsArn },
      @{ Sid = "WriteNativeTraces"; Effect = "Allow"; Action = @("xray:PutTelemetryRecords", "xray:PutTraceSegments"); Resource = "*" }
    ) } | ConvertTo-Json -Compress -Depth 40
  $defaultTags = [pscustomobject]@{ Environment = "development"; ManagedBy = "terraform"; Project = "ai-job-apply" }
  $runtimeInline = @([pscustomobject]@{ name = "document-processor-runtime"; policy = $processorPolicy })
  $role = New-GatewayProviderDriftRecord "module.platform.aws_iam_role.document_processor[0]" "aws_iam_role" `
    ([pscustomobject]@{ id = "processor-role"; inline_policy = @(); tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
    ([pscustomobject]@{ id = "processor-role"; inline_policy = $runtimeInline; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
    ([pscustomobject]@{ inline_policy = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @([pscustomobject]@{}); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
  $mapping = New-GatewayProviderDriftRecord "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]" `
    "aws_lambda_event_source_mapping" `
    ([pscustomobject]@{ id = "mapping"; enabled = $false; queues = $null; topics = $null; tags = $null; tags_all = $defaultTags }) `
    ([pscustomobject]@{ id = "mapping"; enabled = $false; queues = @(); topics = @(); tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ queues = @(); topics = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
  $processor = New-GatewayProviderDriftRecord "module.platform.aws_lambda_function.document_processor[0]" "aws_lambda_function" `
    ([pscustomobject]@{ id = "processor"; tags = $null; tags_all = $defaultTags }) `
    ([pscustomobject]@{ id = "processor"; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
  $sts = New-GatewayProviderDriftRecord "module.platform.aws_vpc_endpoint.sts[0]" "aws_vpc_endpoint" `
    ([pscustomobject]@{ id = "sts-endpoint"; tags = $null; tags_all = $defaultTags }) `
    ([pscustomobject]@{ id = "sts-endpoint"; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
  $rds = New-GatewayProviderDriftRecord "module.platform.aws_db_instance.postgres[0]" "aws_db_instance" `
    ([pscustomobject]@{ id = "postgres"; latest_restorable_time = "2026-08-14T16:08:52Z" }) `
    ([pscustomobject]@{ id = "postgres"; latest_restorable_time = "2026-08-14T18:58:53Z" })
  $root = [pscustomobject]@{ resources = @(
      [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kmsArn } },
      [pscustomobject]@{ address = $role.address; values = $role.change.after },
      [pscustomobject]@{ address = "module.platform.aws_iam_role_policy.document_processor[0]"; values = [pscustomobject]@{ role = "ai-job-apply-development-document-processor"; policy = $processorPolicy } },
      [pscustomobject]@{ address = $mapping.address; values = $mapping.change.after },
      [pscustomobject]@{ address = $processor.address; values = $processor.change.after },
      [pscustomobject]@{ address = $sts.address; values = $sts.change.after }
    ) }
  return [pscustomobject]@{ Records = @($rds, $role, $mapping, $processor, $sts); Root = $root }
}
$receipt = [pscustomobject]@{
  schemaVersion = 1; kind = "development-gateway-lambda-publication"; environment = "development"
  region = "us-east-2"; sourceSha = $sourceSha; boundarySha256 = $boundarySha; phase = "verified"
  createdAt = "2026-08-13T12:00:00Z"; completedAt = "2026-08-13T12:01:00Z"
  artifacts = @("zip", "cdx.json", "manifest.json", "sha256" | ForEach-Object {
      [pscustomobject]@{
        artifactName = "gateway-lambda"; artifactSha256 = $artifactSha; suffix = $_
        key = "lambda/gateway/$sourceSha/$artifactSha/gateway-lambda.$_"; versionId = "version-$_"
        objectSha256 = $(if ($_ -ceq "zip") { $artifactSha } else { "d" * 64 })
        objectBase64Sha256 = $artifactBase64; contentLength = 100
      }
    })
}
$artifact = Assert-GatewayPublicationReceipt $receipt $sourceSha $boundarySha
if ([string]$artifact.suffix -cne "zip") { throw "The receipt guard did not select the ZIP." }; $passed++
$tampered = Copy-Fixture $receipt; $tampered.artifacts[0].key = "lambda/gateway/other.zip"
Assert-Rejected { Assert-GatewayPublicationReceipt $tampered $sourceSha $boundarySha } "A relabeled publication key was accepted."
$tampered = Copy-Fixture $receipt; $tampered.artifacts[1].artifactSha256 = "e" * 64
Assert-Rejected { Assert-GatewayPublicationReceipt $tampered $sourceSha $boundarySha } "Mixed artifact digests were accepted."

$baselinePath = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "baseline.tfplan"))
$baselineSha = "e" * 64
$lineage = "12345678-1234-1234-1234-123456789abc"
$baselineMetadata = [pscustomobject]@{
  SchemaVersion = "1"; Kind = "development-document-zero-drift-baseline"; Environment = "development"
  AccountId = $account; Region = "us-east-2"; SourceSha = $sourceSha; StateLineage = $lineage
  StateSerial = 42; Stage = "parser-dark"; ReceiptSha256 = "f" * 64; ParserQualifiedArn = ""
  PlanPath = $baselinePath; PlanSha256 = $baselineSha; Applyable = $false; MeaningfulChanges = 0
  CreatedAt = "2026-08-13T12:00:00Z"
}
$baselineMigrationImage = "$repositoryUrl@sha256:$('1' * 64)"
$metadataPlan = [pscustomobject]@{ variables = [pscustomobject]@{
    document_processing_deployment_stage = [pscustomobject]@{ value = "parser-dark" }
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "" }
    migration_image = [pscustomobject]@{ value = $baselineMigrationImage }
  } }
$currentState = [pscustomobject]@{ Lineage = $lineage; Serial = 42 }
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadata $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
$baselineMetadataV2 = Copy-Fixture $baselineMetadata
$baselineMetadataV2.SchemaVersion = "2"
$baselineMetadataV2 | Add-Member MigrationImage $baselineMigrationImage
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV2 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
$baselineMetadataV3 = Copy-Fixture $baselineMetadata
$baselineMetadataV3.SchemaVersion = "3"
$baselineMetadataV3.PSObject.Properties.Remove("SourceSha")
$baselineMetadataV3 | Add-Member ReleaseSourceSha ("b" * 40)
$baselineMetadataV3 | Add-Member OperatorSourceSha $sourceSha
$baselineMetadataV3 | Add-Member OperatorDeltaSha256 ("c" * 64)
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV3 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
$baselineMetadataV4 = Copy-Fixture $baselineMetadataV3
$baselineMetadataV4.SchemaVersion = "4"
$baselineMetadataV4 | Add-Member MigrationImage $baselineMigrationImage
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV4 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
foreach ($mutation in @("release", "operator", "delta", "schema", "extra")) {
  $badDualMetadata = Copy-Fixture $baselineMetadataV4
  switch ($mutation) {
    "release" { $badDualMetadata.ReleaseSourceSha = "not-a-sha" }
    "operator" { $badDualMetadata.OperatorSourceSha = "d" * 40 }
    "delta" { $badDualMetadata.OperatorDeltaSha256 = "not-a-digest" }
    "schema" { $badDualMetadata.SchemaVersion = "5" }
    "extra" { $badDualMetadata | Add-Member Unexpected "value" }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badDualMetadata $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A dual-source baseline accepted $mutation tampering."
}
$badMetadata = Copy-Fixture $baselineMetadata; $badMetadata.Applyable = $true
Assert-Rejected { Assert-RetainedGatewayBaselineMetadata $badMetadata $metadataPlan $baselinePath $baselineSha $sourceSha $account "us-east-2" $repositoryUrl $currentState } "Applyable retained metadata was accepted."
$badMetadata = Copy-Fixture $baselineMetadata; $badMetadata.ParserQualifiedArn = "arn:aws:lambda:us-east-2:999999999999:function:ai-job-apply-development-document-parser:7"; $badMetadata.Stage = "complete-dark"
Assert-Rejected { Assert-RetainedGatewayBaselineMetadata $badMetadata $metadataPlan $baselinePath $baselineSha $sourceSha $account "us-east-2" $repositoryUrl $currentState } "A cross-account parser pin was accepted."
foreach ($mutation in @("migration", "serial", "stage", "extra", "missing", "kms")) {
  $badMetadata = Copy-Fixture $baselineMetadataV2
  switch ($mutation) {
    "migration" { $badMetadata.MigrationImage = "$repositoryUrl@sha256:$('2' * 64)" }
    "serial" { $badMetadata.StateSerial = 43 }
    "stage" { $badMetadata.Stage = "complete-dark" }
    "extra" { $badMetadata | Add-Member Unexpected "value" }
    "missing" { $badMetadata.PSObject.Properties.Remove("ReceiptSha256") }
    "kms" { $badMetadata.Stage = "kms-prerequisite" }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badMetadata $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A version-2 baseline accepted $mutation tampering."
}

function New-Variables {
  param([switch]$Released)
  return [pscustomobject]@{
    deploy_applications = [pscustomobject]@{ value = $true }
    deploy_gateway_lambda = [pscustomobject]@{ value = $true }
    serverless_runtime_enabled = [pscustomobject]@{ value = $true }
    gateway_lambda_artifact_s3_key = [pscustomobject]@{ value = $(if ($Released) { [string]$artifact.key } else { "lambda/gateway/old/old/gateway-lambda.zip" }) }
    gateway_lambda_artifact_s3_object_version = [pscustomobject]@{ value = $(if ($Released) { [string]$artifact.versionId } else { "old-version" }) }
    gateway_lambda_artifact_sha256 = [pscustomobject]@{ value = $(if ($Released) { $artifactSha } else { "0" * 64 }) }
    gateway_lambda_artifact_base64sha256 = [pscustomobject]@{ value = $(if ($Released) { $artifactBase64 } else { [Convert]::ToBase64String(([byte[]](33..64))) }) }
    document_processing_deployment_stage = [pscustomobject]@{ value = "parser-dark" }
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "" }
    document_parser_artifact_s3_key = [pscustomobject]@{ value = "lambda/documents/$sourceSha/$('3' * 64)/document-parser-lambda.zip" }
    document_parser_artifact_s3_object_version = [pscustomobject]@{ value = "parser-version" }
    document_parser_artifact_sha256 = [pscustomobject]@{ value = "3" * 64 }
    document_parser_artifact_base64sha256 = [pscustomobject]@{ value = $artifactBase64 }
    document_processor_artifact_s3_key = [pscustomobject]@{ value = "" }
    document_processor_artifact_s3_object_version = [pscustomobject]@{ value = "" }
    document_processor_artifact_sha256 = [pscustomobject]@{ value = "" }
    document_processor_artifact_base64sha256 = [pscustomobject]@{ value = "" }
    document_scan_mapping_enabled = [pscustomobject]@{ value = "false" }
    document_scan_event_rule_enabled = [pscustomobject]@{ value = "false" }
    migration_image = [pscustomobject]@{ value = "$repositoryUrl@sha256:$('1' * 64)" }
    oidc_audience = [pscustomobject]@{ value = "ai-job-apply-api" }
  }
}
$baselineVariables = New-Variables; $releaseVariables = New-Variables -Released
$documentReceiptSha = "f" * 64
$documentReceipt = [pscustomobject]@{
  schemaVersion = 1; kind = "development-document-lambda-publication"; environment = "development"
  region = "us-east-2"; sourceSha = $sourceSha; boundarySha256 = $boundarySha; phase = "verified"
  createdAt = "2026-08-13T12:00:00Z"; completedAt = "2026-08-13T12:01:00Z"
  artifacts = @(
    foreach ($name in @("document-parser-lambda", "document-processor-lambda")) {
      $digest = if ($name -ceq "document-parser-lambda") { "3" * 64 } else { "4" * 64 }
      foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
        [pscustomobject]@{
          artifactName = $name; artifactSha256 = $digest; suffix = $suffix
          key = "lambda/documents/$sourceSha/$digest/$name.$suffix"
          versionId = $(if ($name -ceq "document-parser-lambda" -and $suffix -ceq "zip") { "parser-version" } else { "version-$name-$suffix" })
          objectSha256 = $(if ($suffix -ceq "zip") { $digest } else { "5" * 64 })
          objectBase64Sha256 = $artifactBase64; contentLength = 100
        }
      }
    }
  )
}
$null = Assert-GatewayDocumentBaselineReceipt $documentReceipt $documentReceiptSha `
  ([pscustomobject]@{ variables = $baselineVariables }) $sourceSha $boundarySha; $passed++
$tamperedDocumentReceipt = Copy-Fixture $documentReceipt
$tamperedDocumentReceipt.artifacts[0].versionId = "wrong"
Assert-Rejected {
  Assert-GatewayDocumentBaselineReceipt $tamperedDocumentReceipt $documentReceiptSha `
    ([pscustomobject]@{ variables = $baselineVariables }) $sourceSha $boundarySha
} "A document receipt relabeled away from exact plan variables was accepted."
$baselinePlan = [pscustomobject]@{
  complete = $true; errored = $false; applyable = $false; terraform_version = "1.9.8"
  variables = $baselineVariables; planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @(); resource_drift = @(); output_changes = [pscustomobject]@{ stable = [pscustomobject]@{ actions = @("no-op") } }
}
$null = Assert-RetainedGatewayBaselinePlan $baselinePlan @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
$badBaseline = Copy-Fixture $baselinePlan; $badBaseline.applyable = $true
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "An applyable retained plan was accepted."
$badBaseline = Copy-Fixture $baselinePlan; $badBaseline.output_changes.stable.actions = @("update")
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "A retained plan output change was accepted."
$badBaseline = Copy-Fixture $baselinePlan; $badBaseline.resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "A retained plan resource change was accepted."
$badBaseline = Copy-Fixture $baselinePlan; $badBaseline.resource_drift = @([pscustomobject]@{ address = "module.platform.aws_s3_bucket.artifacts"; mode = "managed"; type = "aws_s3_bucket"; change = [pscustomobject]@{ actions = @("update"); before = @{}; after = @{}; replace_paths = @(); after_unknown = @{}; before_sensitive = @{}; after_sensitive = @{} } })
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "Unaccepted refresh drift in an exit-zero-shaped plan was accepted."
$completeDarkDriftFixture = New-GatewayCompleteDarkProviderDriftFixture
$completeDarkBaselinePlan = Copy-Fixture $baselinePlan
$completeDarkBaselinePlan.planned_values.root_module = $completeDarkDriftFixture.Root
$completeDarkBaselinePlan.resource_drift = $completeDarkDriftFixture.Records
$null = Assert-RetainedGatewayBaselinePlan $completeDarkBaselinePlan @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
foreach ($replacementShape in @("omitted", "null", "empty")) {
  $replacementPlan = Copy-Fixture $completeDarkBaselinePlan
  foreach ($record in @($replacementPlan.resource_drift)) {
    if ($replacementShape -ceq "omitted") { $record.change.PSObject.Properties.Remove("replace_paths") }
    elseif ($replacementShape -ceq "null") { $record.change | Add-Member NoteProperty replace_paths $null -Force }
    else { $record.change | Add-Member NoteProperty replace_paths @() -Force }
  }
  $null = Assert-RetainedGatewayBaselinePlan $replacementPlan @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
}
$badBaseline = Copy-Fixture $completeDarkBaselinePlan; $badBaseline.planned_values.PSObject.Properties.Remove("root_module")
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "CompleteDark drift without its planned root was accepted."
$badBaseline = Copy-Fixture $completeDarkBaselinePlan
@($badBaseline.planned_values.root_module.resources | Where-Object address -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]")[0].values.id = "other-mapping"
Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "CompleteDark drift detached from its planned mapping was accepted."
foreach ($mutation in @("duplicate", "address", "unknown", "sensitivity", "replacement")) {
  $badBaseline = Copy-Fixture $completeDarkBaselinePlan
  switch ($mutation) {
    "duplicate" { $badBaseline.resource_drift = @($badBaseline.resource_drift) + @($badBaseline.resource_drift[0]) }
    "address" { $badBaseline.resource_drift[4].address = "module.platform.aws_vpc_endpoint.sts_shadow[0]" }
    "unknown" { $badBaseline.resource_drift[3].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "sensitivity" { $badBaseline.resource_drift[3].change.after_sensitive.tags = [pscustomobject]@{ secret = $true } }
    "replacement" { $badBaseline.resource_drift[2].change | Add-Member NoteProperty replace_paths @(@("queues")) -Force }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name)
  } "The retained gateway baseline accepted CompleteDark $mutation tampering."
}
$null = Assert-GatewayReleaseVariables $baselineVariables $releaseVariables $artifact $account $repositoryUrl ""; $passed++
$runtimeBooleanBaseline = Copy-Fixture $baselineVariables
$runtimeBooleanRelease = Copy-Fixture $releaseVariables
foreach ($variables in @($runtimeBooleanBaseline, $runtimeBooleanRelease)) {
  $variables.document_scan_mapping_enabled.value = $false
  $variables.document_scan_event_rule_enabled.value = $false
}
$null = Assert-GatewayReleaseVariables $runtimeBooleanBaseline $runtimeBooleanRelease `
  $artifact $account $repositoryUrl ""; $passed++
$completeDarkParserArn = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:1"
$completeDarkBaseline = Copy-Fixture $baselineVariables
$completeDarkRelease = Copy-Fixture $releaseVariables
foreach ($variables in @($completeDarkBaseline, $completeDarkRelease)) {
  $variables.document_processing_deployment_stage.value = "complete-dark"
  $variables.document_parser_invocation_qualified_arn.value = $completeDarkParserArn
}
$null = Assert-GatewayReleaseVariables $completeDarkBaseline $completeDarkRelease `
  $artifact $account $repositoryUrl $completeDarkParserArn; $passed++
foreach ($name in @("document_scan_mapping_enabled", "document_scan_event_rule_enabled")) {
  foreach ($enabled in @($true, "true")) {
    $enabledBaseline = Copy-Fixture $baselineVariables
    $enabledRelease = Copy-Fixture $releaseVariables
    $enabledBaseline.$name.value = $enabled
    $enabledRelease.$name.value = $enabled
    Assert-Rejected {
      Assert-GatewayReleaseVariables $enabledBaseline $enabledRelease $artifact $account $repositoryUrl ""
    } "The gateway release accepted enabled processing-dark flag '$name'."
  }
}
foreach ($case in @(
    @{ Name = "document_scan_mapping_enabled"; Value = "False" },
    @{ Name = "document_scan_event_rule_enabled"; Value = "false " }
  )) {
  $malformedBaseline = Copy-Fixture $baselineVariables
  $malformedRelease = Copy-Fixture $releaseVariables
  $malformedBaseline.($case.Name).value = $case.Value
  $malformedRelease.($case.Name).value = $case.Value
  Assert-Rejected {
    Assert-GatewayReleaseVariables $malformedBaseline $malformedRelease $artifact $account $repositoryUrl ""
  } "The gateway release accepted noncanonical boolean '$($case.Name)'."
}
$changed = Copy-Fixture $releaseVariables; $changed.document_processing_deployment_stage.value = "complete-dark"
Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $changed $artifact $account $repositoryUrl "" } "A document-stage change was accepted."
$changed = Copy-Fixture $releaseVariables; $changed.migration_image.value = "999999999999.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('1' * 64)"
Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $changed $artifact $account $repositoryUrl "" } "A cross-account migration digest was accepted."

$functionBefore = [pscustomobject]@{
  arn = "function-arn"; code_sha256 = "old"; environment = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = "0" * 64; OIDC_AUDIENCE = "ai-job-apply-api" } })
  function_name = "gateway"; handler = "index.handler"; invoke_arn = "invoke"; kms_key_arn = "kms"; last_modified = "old"
  layers = @("layer"); memory_size = 1024; qualified_arn = "old-qualified"; qualified_invoke_arn = "old-invoke"
  reserved_concurrent_executions = 2; role = "role"; runtime = "nodejs24.x"; routing_config = @()
  s3_bucket = "bucket"; s3_key = "old-key"; s3_object_version = "old-version"; source_code_hash = "old-base64"
  timeout = 15; version = "7"; vpc_config = @([pscustomobject]@{ subnet_ids = @("subnet"); security_group_ids = @("sg") })
}
$functionAfter = Copy-Fixture $functionBefore
$functionAfter.code_sha256 = $artifactBase64; $functionAfter.last_modified = "new"
$functionAfter.qualified_arn = "new-qualified"; $functionAfter.qualified_invoke_arn = "new-invoke"
$functionAfter.s3_key = $artifact.key; $functionAfter.s3_object_version = $artifact.versionId
$functionAfter.source_code_hash = $artifactBase64; $functionAfter.version = "8"
$functionAfter.environment[0].variables.RELEASE_SHA = $artifactSha
$aliasBefore = [pscustomobject]@{ arn = "old-alias"; description = "reviewed"; function_name = "gateway"; function_version = "7"; invoke_arn = "old-invoke"; name = "development"; routing_config = @() }
$aliasAfter = Copy-Fixture $aliasBefore; $aliasAfter.arn = "new-alias"; $aliasAfter.function_version = "8"; $aliasAfter.invoke_arn = "new-invoke"
$plan = [pscustomobject]@{
  complete = $true; applyable = $true; errored = $false; terraform_version = "1.9.8"; resource_drift = @()
  output_changes = [pscustomobject]@{ gateway_lambda_alias_arn = [pscustomobject]@{ actions = @("no-op") } }
  resource_changes = @(
    [pscustomobject]@{ address = "module.platform.aws_lambda_function.gateway[0]"; mode = "managed"; type = "aws_lambda_function"; change = [pscustomobject]@{ actions = @("update"); before = $functionBefore; after = $functionAfter; replace_paths = @(); before_sensitive = @{}; after_sensitive = @{}; after_unknown = [pscustomobject]@{ code_sha256 = $true; last_modified = $true; qualified_arn = $true; qualified_invoke_arn = $true; version = $true } } },
    [pscustomobject]@{ address = "module.platform.aws_lambda_alias.gateway[0]"; mode = "managed"; type = "aws_lambda_alias"; change = [pscustomobject]@{ actions = @("update"); before = $aliasBefore; after = $aliasAfter; replace_paths = @(); before_sensitive = @{}; after_sensitive = @{}; after_unknown = [pscustomobject]@{ arn = $true; function_version = $true; invoke_arn = $true } } }
  )
}
$null = Assert-ExactGatewayReleasePlan $plan $artifact; $passed++
foreach ($replacementShape in @("omitted", "null", "empty")) {
  $replacementPlan = Copy-Fixture $plan
  foreach ($change in @($replacementPlan.resource_changes)) {
    if ($replacementShape -ceq "omitted") { $change.change.PSObject.Properties.Remove("replace_paths") }
    elseif ($replacementShape -ceq "null") { $change.change.replace_paths = $null }
    else { $change.change.replace_paths = @() }
  }
  $null = Assert-ExactGatewayReleasePlan $replacementPlan $artifact; $passed++
}
foreach ($index in @(0, 1)) {
  $replacementPlan = Copy-Fixture $plan
  $replacementPlan.resource_changes[$index].change.replace_paths = @(@("version"))
  Assert-Rejected { Assert-ExactGatewayReleasePlan $replacementPlan $artifact } "A gateway function or alias replacement path was accepted."
}
$completeDarkReleasePlan = Copy-Fixture $plan
$completeDarkReleasePlan | Add-Member NoteProperty planned_values ([pscustomobject]@{ root_module = $completeDarkDriftFixture.Root }) -Force
$completeDarkReleasePlan.resource_drift = $completeDarkDriftFixture.Records
$null = Assert-ExactGatewayReleasePlan $completeDarkReleasePlan $artifact; $passed++
$badPlan = Copy-Fixture $completeDarkReleasePlan
@($badPlan.planned_values.root_module.resources | Where-Object address -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]")[0].values.id = "other-mapping"
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A gateway release accepted CompleteDark drift detached from the planned mapping."
$badPlan = Copy-Fixture $completeDarkReleasePlan; $badPlan.resource_drift[3].change.after_unknown = [pscustomobject]@{ tags = $true }
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A gateway release accepted tampered CompleteDark drift."
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[0].change.after.memory_size = 2048
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A nonapproved function field change was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[1].change.after.routing_config = @([pscustomobject]@{ additional_version_weights = @{ "7" = 0.1 } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "Alias traffic routing was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.output_changes.gateway_lambda_alias_arn.actions = @("update")
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A meaningful output change was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[0].change.after_unknown | Add-Member NoteProperty memory_size $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "An unknown nonapproved field was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_drift = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "Unreviewed release-time resource drift was accepted."

Write-Output "Development gateway release guard tests passed: $passed"
