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
$baselineMetadataV5 = Copy-Fixture $baselineMetadataV4
$baselineMetadataV5.SchemaVersion = "5"
$baselineMetadataV5 | Add-Member DocumentReleaseSourceSha ("d" * 40)
$baselineMetadataV5 | Add-Member DocumentOperatorSourceSha ("e" * 40)
$baselineMetadataV5 | Add-Member DocumentOperatorDeltaSha256 ("f" * 64)
$baselineMetadataV5 | Add-Member BaselineToReleaseDeltaSha256 ("1" * 64)
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV5 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
$baselineMetadataV6 = Copy-Fixture $baselineMetadataV2
$baselineMetadataV6.SchemaVersion = "6"
$baselineMetadataV6 | Add-Member DocumentReleaseSourceSha ("d" * 40)
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV6 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
$advancedState = [pscustomobject]@{ Lineage = $lineage; Serial = 43 }
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV5 $metadataPlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $advancedState -AllowOneSerialAdvance; $passed++
Assert-Rejected {
  Assert-RetainedGatewayBaselineMetadata $baselineMetadataV5 $metadataPlan $baselinePath $baselineSha `
    $sourceSha $account "us-east-2" $repositoryUrl $advancedState
} "A one-serial state advance was accepted without the post-apply gate."
foreach ($invalidState in @(
    [pscustomobject]@{ Lineage = $lineage; Serial = 44 },
    [pscustomobject]@{ Lineage = "87654321-4321-4321-4321-cba987654321"; Serial = 43 }
  )) {
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $baselineMetadataV5 $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $invalidState -AllowOneSerialAdvance
  } "The post-apply baseline accepted more than one serial advance or a different lineage."
}
foreach ($mutation in @("release", "operator", "delta", "schema", "extra")) {
  $badDualMetadata = Copy-Fixture $baselineMetadataV4
  switch ($mutation) {
    "release" { $badDualMetadata.ReleaseSourceSha = "not-a-sha" }
    "operator" { $badDualMetadata.OperatorSourceSha = "d" * 40 }
    "delta" { $badDualMetadata.OperatorDeltaSha256 = "not-a-digest" }
    "schema" { $badDualMetadata.SchemaVersion = "6" }
    "extra" { $badDualMetadata | Add-Member Unexpected "value" }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badDualMetadata $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A dual-source baseline accepted $mutation tampering."
}
foreach ($property in @(
    "DocumentReleaseSourceSha", "DocumentOperatorSourceSha",
    "DocumentOperatorDeltaSha256", "BaselineToReleaseDeltaSha256"
  )) {
  $badSplitMetadata = Copy-Fixture $baselineMetadataV5
  $badSplitMetadata.$property = "invalid"
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badSplitMetadata $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A version-5 baseline accepted invalid $property."
}
foreach ($mutation in @("source", "document release", "migration", "extra")) {
  $badCurrentMetadata = Copy-Fixture $baselineMetadataV6
  switch ($mutation) {
    "source" { $badCurrentMetadata.SourceSha = "e" * 40 }
    "document release" { $badCurrentMetadata.DocumentReleaseSourceSha = "invalid" }
    "migration" { $badCurrentMetadata.MigrationImage = "$repositoryUrl@sha256:$('2' * 64)" }
    "extra" { $badCurrentMetadata | Add-Member Unexpected "value" }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badCurrentMetadata $metadataPlan $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A current-state schema-6 baseline accepted $mutation tampering."
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
  param([switch]$Released, [switch]$Tailoring)
  return [pscustomobject]@{
    document_tailoring_invoke_enabled = [pscustomobject]@{ value = [bool]$Tailoring }
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

# ---- D3-020: schema-8 (two-receipt) baseline for a mixed document release
$parserPin = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-document-parser:7"
$completePlan = [pscustomobject]@{ variables = [pscustomobject]@{
    document_processing_deployment_stage = [pscustomobject]@{ value = "complete-dark" }
    document_parser_invocation_qualified_arn = [pscustomobject]@{ value = $parserPin }
    migration_image = [pscustomobject]@{ value = $baselineMigrationImage }
  } }
$baselineMetadataV8 = Copy-Fixture $baselineMetadataV6
$baselineMetadataV8.SchemaVersion = "8"
$baselineMetadataV8.Stage = "complete-dark"
$baselineMetadataV8.ParserQualifiedArn = $parserPin
$baselineMetadataV8 | Add-Member DocumentSourceDeltaSha256 ("1" * 64)
$baselineMetadataV8 | Add-Member ProcessorReceiptSha256 ("2" * 64)
$baselineMetadataV8 | Add-Member ProcessorReleaseSourceSha ("e" * 40)
$baselineMetadataV8 | Add-Member ProcessorSourceDeltaSha256 ("3" * 64)
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadataV8 $completePlan $baselinePath $baselineSha `
  $sourceSha $account "us-east-2" $repositoryUrl $currentState; $passed++
foreach ($mutation in @(
    "same receipt for both", "bad processor receipt", "bad processor source", "bad processor delta",
    "missing processor receipt", "missing parser delta", "extra key", "relabelled as schema 7",
    "relabelled as schema 6", "stale source", "parser-dark stage", "wrong migration image"
  )) {
  $badV8 = Copy-Fixture $baselineMetadataV8
  $planForCheck = $completePlan
  switch ($mutation) {
    "same receipt for both" { $badV8.ProcessorReceiptSha256 = $badV8.ReceiptSha256 }
    "bad processor receipt" { $badV8.ProcessorReceiptSha256 = "not-a-digest" }
    "bad processor source" { $badV8.ProcessorReleaseSourceSha = "invalid" }
    "bad processor delta" { $badV8.ProcessorSourceDeltaSha256 = "invalid" }
    "missing processor receipt" { $badV8.PSObject.Properties.Remove("ProcessorReceiptSha256") }
    "missing parser delta" { $badV8.PSObject.Properties.Remove("DocumentSourceDeltaSha256") }
    "extra key" { $badV8 | Add-Member Unexpected "value" }
    "relabelled as schema 7" { $badV8.SchemaVersion = "7" }
    "relabelled as schema 6" { $badV8.SchemaVersion = "6" }
    "stale source" { $badV8.SourceSha = "e" * 40 }
    "parser-dark stage" { $badV8.Stage = "parser-dark"; $badV8.ParserQualifiedArn = ""; $planForCheck = $metadataPlan }
    "wrong migration image" { $badV8.MigrationImage = "$repositoryUrl@sha256:$('2' * 64)" }
  }
  Assert-Rejected {
    Assert-RetainedGatewayBaselineMetadata $badV8 $planForCheck $baselinePath $baselineSha `
      $sourceSha $account "us-east-2" $repositoryUrl $currentState
  } "A schema-8 baseline accepted $mutation."
}

# Each receipt of a two-receipt baseline is held to the full rules for exactly its own archive.
function New-DocumentReceiptFixture {
  param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$ParserDigest, [Parameter(Mandatory)][string]$ProcessorDigest)
  return [pscustomobject]@{
    schemaVersion = 1; kind = "development-document-lambda-publication"; environment = "development"
    region = "us-east-2"; sourceSha = $Source; boundarySha256 = $boundarySha; phase = "verified"
    createdAt = "2026-08-13T12:00:00Z"; completedAt = "2026-08-13T12:01:00Z"
    artifacts = @(
      foreach ($name in @("document-parser-lambda", "document-processor-lambda")) {
        $digest = if ($name -ceq "document-parser-lambda") { $ParserDigest } else { $ProcessorDigest }
        foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
          [pscustomobject]@{
            artifactName = $name; artifactSha256 = $digest; suffix = $suffix
            key = "lambda/documents/$Source/$digest/$name.$suffix"
            versionId = "version-$($Source.Substring(0, 4))-$name-$suffix"
            objectSha256 = $(if ($suffix -ceq "zip") { $digest } else { "5" * 64 })
            objectBase64Sha256 = $artifactBase64; contentLength = 100
          }
        }
      }
    )
  }
}
function Get-ReceiptZip { param([object]$Receipt, [string]$Name)
  return @($Receipt.artifacts | Where-Object { [string]$_.artifactName -ceq $Name -and [string]$_.suffix -ceq "zip" })[0]
}
$parserSource = "d" * 40; $processorSource = "e" * 40
$parserReceipt = New-DocumentReceiptFixture $parserSource ("3" * 64) ("4" * 64)
$processorReceipt = New-DocumentReceiptFixture $processorSource ("6" * 64) ("7" * 64)
$mixedVariables = Copy-Fixture (New-Variables)
$mixedVariables.document_processing_deployment_stage.value = "complete-dark"
$deployedParser = Get-ReceiptZip $parserReceipt "document-parser-lambda"
$deployedProcessor = Get-ReceiptZip $processorReceipt "document-processor-lambda"
$mixedVariables.document_parser_artifact_s3_key.value = $deployedParser.key
$mixedVariables.document_parser_artifact_s3_object_version.value = $deployedParser.versionId
$mixedVariables.document_parser_artifact_sha256.value = $deployedParser.artifactSha256
$mixedVariables.document_parser_artifact_base64sha256.value = $deployedParser.objectBase64Sha256
$mixedVariables.document_processor_artifact_s3_key.value = $deployedProcessor.key
$mixedVariables.document_processor_artifact_s3_object_version.value = $deployedProcessor.versionId
$mixedVariables.document_processor_artifact_sha256.value = $deployedProcessor.artifactSha256
$mixedVariables.document_processor_artifact_base64sha256.value = $deployedProcessor.objectBase64Sha256
$mixedPlan = [pscustomobject]@{ variables = $mixedVariables }
$parserSha = "a" * 64; $processorSha = "b" * 64
$null = Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $parserSource $boundarySha -Role parser; $passed++
$null = Assert-GatewayDocumentBaselineReceipt $processorReceipt $processorSha $mixedPlan $processorSource $boundarySha -Role processor; $passed++
# Neither mixed receipt satisfies the single-receipt rule, which is why schema 8 exists at all.
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $parserSource $boundarySha } "The parser receipt alone described a mixed release."
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $processorReceipt $processorSha $mixedPlan $processorSource $boundarySha } "The processor receipt alone described a mixed release."
# A receipt cannot vouch for the other archive.
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $processorReceipt $processorSha $mixedPlan $processorSource $boundarySha -Role parser } "The processor receipt vouched for the parser."
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $parserSource $boundarySha -Role processor } "The parser receipt vouched for the processor."
# Each role still needs its receipt's own exact source, boundary, verified phase, and immutable objects.
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $processorSource $boundarySha -Role parser } "A parser receipt was accepted for another source."
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $parserSource ("0" * 64) -Role parser } "A parser receipt was accepted for another boundary."
foreach ($role in @("parser", "processor")) {
  $pendingReceipt = Copy-Fixture $(if ($role -ceq "parser") { $parserReceipt } else { $processorReceipt }); $pendingReceipt.phase = "publishing"
  Assert-Rejected {
    Assert-GatewayDocumentBaselineReceipt $pendingReceipt $parserSha $mixedPlan $(if ($role -ceq "parser") { $parserSource } else { $processorSource }) $boundarySha -Role $role
  } "An unverified $role receipt was accepted."
}
$tamperedParser = Copy-Fixture $parserReceipt; $tamperedParser.artifacts[0].versionId = "wrong"
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $tamperedParser $parserSha $mixedPlan $parserSource $boundarySha -Role parser } "A relabelled parser receipt version was accepted."
$tamperedProcessor = Copy-Fixture $processorReceipt
(Get-ReceiptZip $tamperedProcessor "document-processor-lambda").versionId = "wrong"
Assert-Rejected { Assert-GatewayDocumentBaselineReceipt $tamperedProcessor $processorSha $mixedPlan $processorSource $boundarySha -Role processor } "A relabelled processor receipt version was accepted."
# A processor-only receipt needs a stage where a processor exists.
Assert-Rejected {
  Assert-GatewayDocumentBaselineReceipt $processorReceipt $processorSha ([pscustomobject]@{ variables = $baselineVariables }) $processorSource $boundarySha -Role processor
} "A processor-only receipt was accepted for a parser-dark stage."
Assert-Rejected {
  Assert-GatewayDocumentBaselineReceipt $parserReceipt $parserSha $mixedPlan $parserSource $boundarySha -Role neither
} "An unknown receipt role was accepted."
$baselinePlan = [pscustomobject]@{
  complete = $true; errored = $false; applyable = $false; terraform_version = "1.9.8"
  variables = $baselineVariables; planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @(); resource_drift = @(); output_changes = [pscustomobject]@{ stable = [pscustomobject]@{ actions = @("no-op") } }
}
$null = Assert-RetainedGatewayBaselinePlan $baselinePlan @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
$currentBaseline = Copy-Fixture $baselinePlan; $currentBaseline.terraform_version = "1.16.2"
$null = Assert-RetainedGatewayBaselinePlan $currentBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
foreach ($invalidVersion in @("1.9.9", "1.16.1", "1.16.3", "1.16.2 ", "")) {
  $badBaseline = Copy-Fixture $baselinePlan; $badBaseline.terraform_version = $invalidVersion
  Assert-Rejected { Assert-RetainedGatewayBaselinePlan $badBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name) } "An unapproved retained Terraform version was accepted."
}
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
# D3-023: a release carries an activated state forward unchanged (never changes it), in the ADR-023 shape only.
foreach ($enabled in @($true, "true")) {
  foreach ($flags in @(@("document_scan_mapping_enabled"), @("document_scan_mapping_enabled", "document_scan_event_rule_enabled"))) {
    $activeBaseline = Copy-Fixture $completeDarkBaseline
    $activeRelease = Copy-Fixture $completeDarkRelease
    foreach ($flag in $flags) { $activeBaseline.$flag.value = $enabled; $activeRelease.$flag.value = $enabled }
    $null = Assert-GatewayReleaseVariables $activeBaseline $activeRelease $artifact $account $repositoryUrl $completeDarkParserArn; $passed++
    # ...but a release may not move a trigger either way, so only the activation steps can change them.
    foreach ($flag in $flags) {
      $enabling = Copy-Fixture $completeDarkRelease
      foreach ($other in $flags) { $enabling.$other.value = $enabled }
      $disabledBaseline = Copy-Fixture $completeDarkBaseline
      Assert-Rejected {
        Assert-GatewayReleaseVariables $disabledBaseline $enabling $artifact $account $repositoryUrl $completeDarkParserArn
      } "The gateway release enabled '$flag' itself."
      $disabling = Copy-Fixture $completeDarkRelease
      Assert-Rejected {
        Assert-GatewayReleaseVariables $activeBaseline $disabling $artifact $account $repositoryUrl $completeDarkParserArn
      } "The gateway release disabled '$flag' itself."
      break
    }
  }
  # the GuardDuty rule never runs without the processor mapping
  $ruleOnly = Copy-Fixture $completeDarkBaseline; $ruleOnlyRelease = Copy-Fixture $completeDarkRelease
  foreach ($variables in @($ruleOnly, $ruleOnlyRelease)) { $variables.document_scan_event_rule_enabled.value = $enabled }
  Assert-Rejected {
    Assert-GatewayReleaseVariables $ruleOnly $ruleOnlyRelease $artifact $account $repositoryUrl $completeDarkParserArn
  } "The gateway release accepted the scan rule without the processor mapping."
  # triggers only exist in the complete boundary
  foreach ($name in @("document_scan_mapping_enabled", "document_scan_event_rule_enabled")) {
    $parserDarkBaseline = Copy-Fixture $baselineVariables
    $parserDarkRelease = Copy-Fixture $releaseVariables
    foreach ($variables in @($parserDarkBaseline, $parserDarkRelease)) { $variables.document_scan_mapping_enabled.value = $enabled; $variables.$name.value = $enabled }
    Assert-Rejected {
      Assert-GatewayReleaseVariables $parserDarkBaseline $parserDarkRelease $artifact $account $repositoryUrl ""
    } "The gateway release accepted enabled flag '$name' outside the complete processing boundary."
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
$aliasAfter = Copy-Fixture $aliasBefore; $aliasAfter.arn = "new-alias"; $aliasAfter.PSObject.Properties.Remove("function_version"); $aliasAfter.invoke_arn = "new-invoke"
$functionUnknown = [pscustomobject]@{
  architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{} })
  ephemeral_storage = @([pscustomobject]@{}); file_system_config = @(); image_config = @()
  last_modified = $true; layers = @($false); logging_config = @([pscustomobject]@{})
  qualified_arn = $true; qualified_invoke_arn = $true; snap_start = @(); tags = [pscustomobject]@{}
  tags_all = [pscustomobject]@{}; tenancy_config = @(); tracing_config = @([pscustomobject]@{})
  version = $true
  vpc_config = @([pscustomobject]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
}
$functionSensitivity = [pscustomobject]@{
  architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{ OIDC_ISSUER = $true } })
  ephemeral_storage = @([pscustomobject]@{}); file_system_config = @(); image_config = @()
  layers = @($false); logging_config = @([pscustomobject]@{}); snap_start = @(); tags = [pscustomobject]@{}
  tags_all = [pscustomobject]@{}; tenancy_config = @(); tracing_config = @([pscustomobject]@{})
  vpc_config = @([pscustomobject]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
}
$aliasUnknown = [pscustomobject]@{ function_version = $true; routing_config = @() }
$aliasSensitivity = [pscustomobject]@{ routing_config = @() }
$plan = [pscustomobject]@{
  complete = $true; applyable = $true; errored = $false; terraform_version = "1.16.2"; resource_drift = @()
  output_changes = [pscustomobject]@{ gateway_lambda_alias_arn = [pscustomobject]@{ actions = @("no-op") } }
  resource_changes = @(
    [pscustomobject]@{ address = "module.platform.aws_lambda_function.gateway[0]"; mode = "managed"; type = "aws_lambda_function"; change = [pscustomobject]@{ actions = @("update"); before = $functionBefore; after = $functionAfter; replace_paths = @(); before_sensitive = $functionSensitivity; after_sensitive = (Copy-Fixture $functionSensitivity); after_unknown = $functionUnknown } },
    [pscustomobject]@{ address = "module.platform.aws_lambda_alias.gateway[0]"; mode = "managed"; type = "aws_lambda_alias"; change = [pscustomobject]@{ actions = @("update"); before = $aliasBefore; after = $aliasAfter; replace_paths = @(); before_sensitive = $aliasSensitivity; after_sensitive = (Copy-Fixture $aliasSensitivity); after_unknown = $aliasUnknown } }
  )
}
$null = Assert-ExactGatewayReleasePlan $plan $artifact; $passed++
$historicalRelease = Copy-Fixture $plan; $historicalRelease.terraform_version = "1.9.8"
Assert-Rejected { Assert-ExactGatewayReleasePlan $historicalRelease $artifact } "An actionable historical gateway plan was accepted."
$null = Assert-ExactGatewayReleasePlan $historicalRelease $artifact -AllowHistorical; $passed++
foreach ($invalidVersion in @("1.9.9", "1.16.1", "1.16.3", "1.16.2 ", "")) {
  $badPlan = Copy-Fixture $plan; $badPlan.terraform_version = $invalidVersion
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact -AllowHistorical } "The historical audit switch accepted an unapproved gateway plan version."
}
$unknownBefore = ConvertTo-GatewayCanonicalJson $plan.resource_changes[0].change.after_unknown
$actualUnknownPaths = @(Get-GatewayUnknownTrueLeafPaths $plan.resource_changes[0].change.after_unknown | Sort-Object)
if (($actualUnknownPaths -join "|") -cne "last_modified|qualified_arn|qualified_invoke_arn|version" -or
    (ConvertTo-GatewayCanonicalJson $plan.resource_changes[0].change.after_unknown) -cne $unknownBefore) {
  throw "Gateway unknown-leaf canonicalization changed its input or returned an unexpected path set."
}
$passed++
foreach ($field in @("last_modified", "qualified_arn", "qualified_invoke_arn", "version")) {
  $badPlan = Copy-Fixture $plan
  $badPlan.resource_changes[0].change.after_unknown.PSObject.Properties.Remove($field)
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } `
    "A gateway function plan omitted required computed unknown '$field'."
}
foreach ($mutation in @(
    @{ Label = "obsolete code digest"; Apply = { param($unknown) $unknown | Add-Member NoteProperty code_sha256 $true } },
    @{ Label = "architecture"; Apply = { param($unknown) $unknown.architectures[0] = $true } },
    @{ Label = "sensitive environment"; Apply = { param($unknown) $unknown.environment[0].variables | Add-Member NoteProperty OIDC_ISSUER $true } },
    @{ Label = "ephemeral storage"; Apply = { param($unknown) $unknown.ephemeral_storage[0] | Add-Member NoteProperty size $true } },
    @{ Label = "tag"; Apply = { param($unknown) $unknown.tags | Add-Member NoteProperty Unexpected $true } },
    @{ Label = "security group"; Apply = { param($unknown) $unknown.vpc_config[0].security_group_ids[0] = $true } },
    @{ Label = "subnet"; Apply = { param($unknown) $unknown.vpc_config[0].subnet_ids[1] = $true } },
    @{ Label = "null scalar"; Apply = { param($unknown) $unknown | Add-Member NoteProperty unexpected $null } },
    @{ Label = "string scalar"; Apply = { param($unknown) $unknown | Add-Member NoteProperty unexpected "false" } },
    @{ Label = "dictionary node"; Apply = { param($unknown) $unknown | Add-Member NoteProperty unexpected @{} } }
  )) {
  $badPlan = Copy-Fixture $plan
  & $mutation.Apply $badPlan.resource_changes[0].change.after_unknown
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } `
    "A gateway function plan accepted $($mutation.Label) unknown tampering."
}
$badPlan = Copy-Fixture $plan
$badPlan.resource_changes[1].change.after_unknown.PSObject.Properties.Remove("function_version")
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } `
  "A gateway alias plan omitted its required computed function version."
foreach ($mutation in @(
    @{ Label = "missing before version"; Apply = { param($change) $change.before.PSObject.Properties.Remove("function_version") } },
    @{ Label = "nonnumeric before version"; Apply = { param($change) $change.before.function_version = "latest" } },
    @{ Label = "concrete after version"; Apply = { param($change) $change.after | Add-Member NoteProperty function_version "8" } }
  )) {
  $badPlan = Copy-Fixture $plan
  & $mutation.Apply $badPlan.resource_changes[1].change
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } `
    "A gateway alias plan accepted $($mutation.Label)."
}
foreach ($mutation in @(
    @{ Label = "obsolete ARN"; Apply = { param($unknown) $unknown | Add-Member NoteProperty arn $true } },
    @{ Label = "obsolete invoke ARN"; Apply = { param($unknown) $unknown | Add-Member NoteProperty invoke_arn $true } },
    @{ Label = "routing weight"; Apply = { param($unknown) $unknown.routing_config = @([pscustomobject]@{ additional_version_weights = $true }) } },
    @{ Label = "null scalar"; Apply = { param($unknown) $unknown | Add-Member NoteProperty unexpected $null } },
    @{ Label = "numeric scalar"; Apply = { param($unknown) $unknown | Add-Member NoteProperty unexpected 0 } }
  )) {
  $badPlan = Copy-Fixture $plan
  & $mutation.Apply $badPlan.resource_changes[1].change.after_unknown
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } `
    "A gateway alias plan accepted $($mutation.Label) unknown tampering."
}
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


# ---- Document tailoring invoke grant (ADR-031): the one reviewed exception to a two-resource release.
$grantBaseline = New-Variables
$grantRelease = New-Variables -Released -Tailoring
$null = Assert-GatewayReleaseVariables $grantBaseline $grantRelease $artifact $account $repositoryUrl ""; $passed++
$steadyBaseline = New-Variables -Tailoring; $steadyRelease = New-Variables -Released -Tailoring
$null = Assert-GatewayReleaseVariables $steadyBaseline $steadyRelease $artifact $account $repositoryUrl ""; $passed++
$switchedOff = New-Variables -Released
Assert-Rejected { Assert-GatewayReleaseVariables $steadyBaseline $switchedOff $artifact $account $repositoryUrl "" } "The gateway release switched the invoke grant off."
$missingSwitch = Copy-Fixture $grantRelease; $missingSwitch.PSObject.Properties.Remove("document_tailoring_invoke_enabled")
Assert-Rejected { Assert-GatewayReleaseVariables $grantBaseline $missingSwitch $artifact $account $repositoryUrl "" } "The gateway release dropped the invoke switch from the variable inventory."
$malformedSwitch = Copy-Fixture $grantRelease; $malformedSwitch.document_tailoring_invoke_enabled.value = "True"
Assert-Rejected { Assert-GatewayReleaseVariables $grantBaseline $malformedSwitch $artifact $account $repositoryUrl "" } "A noncanonical invoke switch was accepted."

$aliasArn = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-document-processor:development"
$gatewayRoleArn = "arn:aws:iam::$account`:role/ai-job-apply-development-gateway-lambda"
function ConvertTo-PolicyJson { param([Parameter(Mandatory)][object]$Value); return ConvertTo-Json -InputObject $Value -Depth 20 -Compress }
$logsStatement = [ordered]@{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = @("logs:CreateLogStream", "logs:PutLogEvents"); Resource = "arn:aws:logs:us-east-2:${account}:log-group:app:*" }
$secretStatement = [ordered]@{ Sid = "ReadDatabaseSecret"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = "arn:aws:secretsmanager:us-east-2:${account}:secret:db" }
$roleGrant = [ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn }
$starterStatement = [ordered]@{ Sid = "StarterInvokesExactDurableVersionOnly"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "arn:aws:lambda:us-east-2:${account}:function:durable:3"; Principal = [ordered]@{ AWS = "*" } }
$endpointGrant = [ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn; Principal = [ordered]@{ AWS = $gatewayRoleArn } }

function New-GrantPlan {
  param(
    [object]$RoleAfter = @($logsStatement, $secretStatement, $roleGrant),
    [object]$EndpointAfter = @($starterStatement, $endpointGrant),
    [string]$EnvironmentValue = $aliasArn,
    [bool]$SwitchOn = $true
  )
  $grantPlan = Copy-Fixture $plan
  $grantPlan | Add-Member NoteProperty variables ([pscustomobject]@{
      document_tailoring_invoke_enabled = [pscustomobject]@{ value = $SwitchOn }
    })
  $grantPlan.resource_changes[0].change.after.environment[0].variables |
    Add-Member NoteProperty DOCUMENT_TAILORING_FUNCTION_ARN $EnvironmentValue
  $roleChange = [pscustomobject]@{
    address = "module.platform.aws_iam_role_policy.gateway_lambda[0]"; mode = "managed"; type = "aws_iam_role_policy"
    change = [pscustomobject]@{
      actions = @("update")
      before = [pscustomobject]@{ name = "gateway-lambda-runtime"; role = "role-id"; policy = (ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($logsStatement, $secretStatement) })) }
      after = [pscustomobject]@{ name = "gateway-lambda-runtime"; role = "role-id"; policy = (ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($RoleAfter) })) }
      before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}; after_unknown = [pscustomobject]@{}
    }
  }
  $endpointChange = [pscustomobject]@{
    address = "module.platform.aws_vpc_endpoint.lambda[0]"; mode = "managed"; type = "aws_vpc_endpoint"
    change = [pscustomobject]@{
      actions = @("update")
      before = [pscustomobject]@{ service_name = "com.amazonaws.us-east-2.lambda"; private_dns_enabled = $true; policy = (ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($starterStatement) })) }
      after = [pscustomobject]@{ service_name = "com.amazonaws.us-east-2.lambda"; private_dns_enabled = $true; policy = (ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($EndpointAfter) })) }
      before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}; after_unknown = [pscustomobject]@{}
    }
  }
  $grantPlan.resource_changes = @($grantPlan.resource_changes) + @($roleChange, $endpointChange)
  return $grantPlan
}

$grantPlan = New-GrantPlan
$grantChanges = @(Assert-ExactGatewayReleasePlan $grantPlan $artifact -ExpectedAccountId $account)
if ($grantChanges.Count -ne 4) { throw "The reviewed invoke grant plan did not return exactly four changes." }
$passed++
# Order of the added statement does not matter; content does.
$null = Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($roleGrant, $logsStatement, $secretStatement) -EndpointAfter @($endpointGrant, $starterStatement)) $artifact -ExpectedAccountId $account; $passed++

Assert-Rejected { Assert-ExactGatewayReleasePlan $grantPlan $artifact } "A four-resource plan was accepted without the reviewed account."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -SwitchOn $false) $artifact -ExpectedAccountId $account } "A four-resource plan was accepted with the invoke switch off."
Assert-Rejected { Assert-ExactGatewayReleasePlan $grantPlan $artifact -ExpectedAccountId "999999999999" } "A grant for a different account was accepted."
$noEnvironment = New-GrantPlan; $noEnvironment.resource_changes[0].change.after.environment[0].variables.PSObject.Properties.Remove("DOCUMENT_TAILORING_FUNCTION_ARN")
Assert-Rejected { Assert-ExactGatewayReleasePlan $noEnvironment $artifact -ExpectedAccountId $account } "The grant plan omitted the function ARN variable."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -EnvironmentValue "$aliasArn-other") $artifact -ExpectedAccountId $account } "The grant plan pointed the Gateway at a different function."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -EnvironmentValue "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-processor:`$LATEST") $artifact -ExpectedAccountId $account } "The grant plan pointed the Gateway at an unqualified function."
$extraEnvironment = New-GrantPlan; $extraEnvironment.resource_changes[0].change.after.environment[0].variables | Add-Member NoteProperty EXTRA "x"
Assert-Rejected { Assert-ExactGatewayReleasePlan $extraEnvironment $artifact -ExpectedAccountId $account } "The grant plan added an unreviewed function variable."

foreach ($case in @(
    @{ Name = "a wildcard resource"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "*" }) },
    @{ Name = "a broader action"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:*"; Resource = $aliasArn }) },
    @{ Name = "an extra action"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = @("lambda:InvokeFunction", "lambda:GetFunction"); Resource = $aliasArn }) },
    @{ Name = "an unqualified function"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-processor" }) },
    @{ Name = "a Deny effect"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Deny"; Action = "lambda:InvokeFunction"; Resource = $aliasArn }) },
    @{ Name = "a condition"; Statement = ([ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn; Condition = [ordered]@{ Bool = [ordered]@{ "x" = "y" } } }) },
    @{ Name = "a different Sid"; Statement = ([ordered]@{ Sid = "SomethingElse"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn }) }
  )) {
  Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($logsStatement, $secretStatement, $case.Statement)) $artifact -ExpectedAccountId $account } "The gateway role policy accepted $($case.Name)."
}
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($logsStatement, $secretStatement)) $artifact -ExpectedAccountId $account } "The gateway role policy grant was missing."
$secondStatement = [ordered]@{ Sid = "AnotherGrant"; Effect = "Allow"; Action = "s3:GetObject"; Resource = "*" }
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($logsStatement, $secretStatement, $roleGrant, $secondStatement)) $artifact -ExpectedAccountId $account } "The gateway role policy gained an unreviewed second statement."
$widenedLogs = [ordered]@{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = @("logs:*"); Resource = "*" }
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($widenedLogs, $secretStatement, $roleGrant)) $artifact -ExpectedAccountId $account } "The gateway role policy widened an existing statement."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -RoleAfter @($secretStatement, $roleGrant)) $artifact -ExpectedAccountId $account } "The gateway role policy dropped an existing statement."

foreach ($case in @(
    @{ Name = "a different principal"; Statement = ([ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn; Principal = [ordered]@{ AWS = "arn:aws:iam::${account}:role/other" } }) },
    @{ Name = "a wildcard principal"; Statement = ([ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn; Principal = [ordered]@{ AWS = "*" } }) },
    @{ Name = "no principal"; Statement = ([ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn }) },
    @{ Name = "a wildcard resource"; Statement = ([ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "*"; Principal = [ordered]@{ AWS = $gatewayRoleArn } }) },
    @{ Name = "a condition"; Statement = ([ordered]@{ Sid = "GatewayInvokesExactDocumentProcessorAlias"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $aliasArn; Principal = [ordered]@{ AWS = $gatewayRoleArn }; Condition = [ordered]@{ Bool = [ordered]@{ "x" = "y" } } }) }
  )) {
  Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -EndpointAfter @($starterStatement, $case.Statement)) $artifact -ExpectedAccountId $account } "The Lambda endpoint policy accepted $($case.Name)."
}
$alteredStarter = [ordered]@{ Sid = "StarterInvokesExactDurableVersionOnly"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "*"; Principal = [ordered]@{ AWS = "*" } }
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GrantPlan -EndpointAfter @($alteredStarter, $endpointGrant)) $artifact -ExpectedAccountId $account } "The Lambda endpoint policy altered an existing statement."

$renamedRole = New-GrantPlan; $renamedRole.resource_changes[2].change.after.name = "other-policy"
Assert-Rejected { Assert-ExactGatewayReleasePlan $renamedRole $artifact -ExpectedAccountId $account } "The gateway role policy change altered a non-policy field."
$movedEndpoint = New-GrantPlan; $movedEndpoint.resource_changes[3].change.after.service_name = "com.amazonaws.us-east-2.sqs"
Assert-Rejected { Assert-ExactGatewayReleasePlan $movedEndpoint $artifact -ExpectedAccountId $account } "The Lambda endpoint change altered a non-policy field."
$unknownGrant = New-GrantPlan; $unknownGrant.resource_changes[2].change.after_unknown | Add-Member NoteProperty policy $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $unknownGrant $artifact -ExpectedAccountId $account } "The gateway role policy change accepted an unknown field."
$replacedGrant = New-GrantPlan; $replacedGrant.resource_changes[3].change.actions = @("delete", "create")
Assert-Rejected { Assert-ExactGatewayReleasePlan $replacedGrant $artifact -ExpectedAccountId $account } "The grant plan accepted a replaced endpoint."
$partialGrant = New-GrantPlan; $partialGrant.resource_changes = @($partialGrant.resource_changes | Select-Object -First 3)
Assert-Rejected { Assert-ExactGatewayReleasePlan $partialGrant $artifact -ExpectedAccountId $account } "A three-resource plan was accepted."
$extraResource = New-GrantPlan
$extraResource.resource_changes = @($extraResource.resource_changes) + @([pscustomobject]@{ address = "module.platform.aws_s3_bucket.artifacts"; mode = "managed"; type = "aws_s3_bucket"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{}; after = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $extraResource $artifact -ExpectedAccountId $account } "A grant plan with an unreviewed extra resource was accepted."


# ---- Document processor refresh (ADR-031): the processor function and alias, bound to the verified receipt.
$processorArtifact = Get-GatewayProcessorArtifact $documentReceipt $sourceSha
if ([string]$processorArtifact.artifactSha256 -cne ("4" * 64) -or [string]$processorArtifact.key -cnotmatch "/document-processor-lambda\.zip$" -or
    [string]$processorArtifact.versionId -cne "version-document-processor-lambda-zip") {
  throw "The processor artifact was not taken from the exact processor archive entry."
}
$passed++
Assert-Rejected { Get-GatewayProcessorArtifact $documentReceipt ("d" * 40) } "A processor artifact was taken from a receipt for a different source."
$noProcessorZip = Copy-Fixture $documentReceipt
$noProcessorZip.artifacts = @($noProcessorZip.artifacts | Where-Object { -not ($_.artifactName -ceq "document-processor-lambda" -and $_.suffix -ceq "zip") })
Assert-Rejected { Get-GatewayProcessorArtifact $noProcessorZip $sourceSha } "A processor artifact was taken from a receipt without the processor archive."

$processorRelease = New-Variables -Released
$processorRelease.document_processor_artifact_s3_key.value = [string]$processorArtifact.key
$processorRelease.document_processor_artifact_s3_object_version.value = [string]$processorArtifact.versionId
$processorRelease.document_processor_artifact_sha256.value = [string]$processorArtifact.artifactSha256
$processorRelease.document_processor_artifact_base64sha256.value = [string]$processorArtifact.objectBase64Sha256
$null = Assert-GatewayReleaseVariables $baselineVariables $processorRelease $artifact $account $repositoryUrl "" -ProcessorArtifact $processorArtifact; $passed++
Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $processorRelease $artifact $account $repositoryUrl "" } "Processor variables changed without a verified processor artifact."
foreach ($name in @("document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256", "document_processor_artifact_base64sha256")) {
  $wrongVariable = Copy-Fixture $processorRelease; $wrongVariable.$name.value = "not-the-verified-value"
  Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $wrongVariable $artifact $account $repositoryUrl "" -ProcessorArtifact $processorArtifact } "The release accepted an unverified '$name'."
}
$unchangedProcessor = New-Variables -Released
Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $unchangedProcessor $artifact $account $repositoryUrl "" -ProcessorArtifact $processorArtifact } "A processor refresh accepted variables that do not use the verified artifact."
$parserMoved = Copy-Fixture $processorRelease; $parserMoved.document_parser_artifact_sha256.value = "9" * 64
Assert-Rejected { Assert-GatewayReleaseVariables $baselineVariables $parserMoved $artifact $account $repositoryUrl "" -ProcessorArtifact $processorArtifact } "A processor refresh also moved the parser artifact."

function New-ProcessorPlan {
  param([object]$Base = $plan, [object]$Artifact = $processorArtifact)
  $refreshed = Copy-Fixture $Base
  # Clone from the clean two-resource fixture so a grant variable on the Gateway change never leaks in.
  $function = Copy-Fixture @($plan.resource_changes | Where-Object { $_.address -ceq "module.platform.aws_lambda_function.gateway[0]" })[0]
  $alias = Copy-Fixture @($plan.resource_changes | Where-Object { $_.address -ceq "module.platform.aws_lambda_alias.gateway[0]" })[0]
  $function.address = "module.platform.aws_lambda_function.document_processor[0]"
  $function.change.before.function_name = "processor"; $function.change.after.function_name = "processor"
  $function.change.after.s3_key = [string]$Artifact.key
  $function.change.after.s3_object_version = [string]$Artifact.versionId
  $function.change.after.source_code_hash = [string]$Artifact.objectBase64Sha256
  $function.change.after.environment[0].variables.RELEASE_SHA = [string]$Artifact.artifactSha256
  $alias.address = "module.platform.aws_lambda_alias.document_processor[0]"
  $alias.change.before.function_name = "processor"; $alias.change.after.function_name = "processor"
  $refreshed.resource_changes = @($refreshed.resource_changes) + @($function, $alias)
  return $refreshed
}
$processorPlan = New-ProcessorPlan
$processorChanges = @(Assert-ExactGatewayReleasePlan $processorPlan $artifact -ProcessorArtifact $processorArtifact)
if ($processorChanges.Count -ne 4) { throw "The processor refresh plan did not return exactly four changes." }
$passed++
# The invoke grant and the processor refresh may be released together, and only together as exact pairs.
$combinedPlan = New-ProcessorPlan -Base (New-GrantPlan)
$combinedChanges = @(Assert-ExactGatewayReleasePlan $combinedPlan $artifact -ExpectedAccountId $account -ProcessorArtifact $processorArtifact)
if ($combinedChanges.Count -ne 6) { throw "The combined grant and processor refresh plan did not return exactly six changes." }
$passed++

Assert-Rejected { Assert-ExactGatewayReleasePlan $processorPlan $artifact } "A processor refresh plan was accepted without a verified processor artifact."
$otherArtifact = [pscustomobject]@{ key = "$($processorArtifact.key)-other"; versionId = "other"; artifactSha256 = "8" * 64; objectBase64Sha256 = [Convert]::ToBase64String(([byte[]](1..32))); contentLength = 100 }
Assert-Rejected { Assert-ExactGatewayReleasePlan $processorPlan $artifact -ProcessorArtifact $otherArtifact } "A processor refresh accepted a different artifact than the verified one."
foreach ($field in @("s3_key", "s3_object_version", "source_code_hash")) {
  $wrongField = Copy-Fixture $processorPlan; $wrongField.resource_changes[2].change.after.$field = "wrong"
  Assert-Rejected { Assert-ExactGatewayReleasePlan $wrongField $artifact -ProcessorArtifact $processorArtifact } "The processor update accepted a wrong '$field'."
}
$wrongRelease = Copy-Fixture $processorPlan; $wrongRelease.resource_changes[2].change.after.environment[0].variables.RELEASE_SHA = "0" * 64
Assert-Rejected { Assert-ExactGatewayReleasePlan $wrongRelease $artifact -ProcessorArtifact $processorArtifact } "The processor update accepted a wrong RELEASE_SHA."
foreach ($mutation in @("memory_size", "timeout", "handler", "role", "reserved_concurrent_executions")) {
  $mutated = Copy-Fixture $processorPlan
  $mutated.resource_changes[2].change.after.$mutation = if ($mutation -in @("handler", "role")) { "changed" } else { 999 }
  Assert-Rejected { Assert-ExactGatewayReleasePlan $mutated $artifact -ProcessorArtifact $processorArtifact } "The processor update changed nonapproved field '$mutation'."
}
$movedParserPin = Copy-Fixture $processorPlan
$movedParserPin.resource_changes[2].change.after.environment[0].variables | Add-Member NoteProperty DOCUMENT_PARSER_FUNCTION_ARN "arn:aws:lambda:us-east-2:${account}:function:parser:7"
Assert-Rejected { Assert-ExactGatewayReleasePlan $movedParserPin $artifact -ProcessorArtifact $processorArtifact } "The processor update moved its parser pin or added an environment variable."
$unknownProcessor = Copy-Fixture $processorPlan; $unknownProcessor.resource_changes[2].change.after_unknown | Add-Member NoteProperty memory_size $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $unknownProcessor $artifact -ProcessorArtifact $processorArtifact } "The processor update accepted an unknown nonapproved field."
$movedAlias = Copy-Fixture $processorPlan; $movedAlias.resource_changes[3].change.after.description = "changed"
Assert-Rejected { Assert-ExactGatewayReleasePlan $movedAlias $artifact -ProcessorArtifact $processorArtifact } "The processor alias update changed a non-version field."
$aliasWithVersion = Copy-Fixture $processorPlan; $aliasWithVersion.resource_changes[3].change.after | Add-Member NoteProperty function_version "9"
Assert-Rejected { Assert-ExactGatewayReleasePlan $aliasWithVersion $artifact -ProcessorArtifact $processorArtifact } "The processor alias update pinned a version at plan time."
$functionOnly = Copy-Fixture $processorPlan; $functionOnly.resource_changes = @($functionOnly.resource_changes | Select-Object -First 3)
Assert-Rejected { Assert-ExactGatewayReleasePlan $functionOnly $artifact -ProcessorArtifact $processorArtifact } "A processor function change without its alias was accepted."
$processorReplaced = Copy-Fixture $processorPlan; $processorReplaced.resource_changes[2].change.actions = @("delete", "create")
Assert-Rejected { Assert-ExactGatewayReleasePlan $processorReplaced $artifact -ProcessorArtifact $processorArtifact } "A processor replacement was accepted."
$processorPolicyToo = Copy-Fixture $processorPlan
$processorPolicyToo.resource_changes = @($processorPolicyToo.resource_changes) + @([pscustomobject]@{ address = "module.platform.aws_iam_role_policy.document_processor[0]"; mode = "managed"; type = "aws_iam_role_policy"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{}; after = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $processorPolicyToo $artifact -ProcessorArtifact $processorArtifact } "A processor refresh that also changed the processor IAM policy was accepted."
$parserToo = Copy-Fixture $processorPlan
$parserToo.resource_changes = @($parserToo.resource_changes) + @([pscustomobject]@{ address = "module.platform.aws_lambda_function.document_parser[0]"; mode = "managed"; type = "aws_lambda_function"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{}; after = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserToo $artifact -ProcessorArtifact $processorArtifact } "A processor refresh that also changed the parser was accepted."


# ---- Document parser refresh (ADR-031): the parser function and alias, bound to the same verified receipt.
$parserArtifact = Get-GatewayProcessorArtifact $documentReceipt $sourceSha -Kind parser
if ([string]$parserArtifact.artifactSha256 -cne ("3" * 64) -or [string]$parserArtifact.key -cnotmatch "/document-parser-lambda\.zip$" -or
    [string]$parserArtifact.versionId -cne "parser-version") {
  throw "The parser artifact was not taken from the exact parser archive entry."
}
$passed++
Assert-Rejected { Get-GatewayProcessorArtifact $documentReceipt ("d" * 40) -Kind parser } "A parser artifact was taken from a receipt for a different source."
$noParserZip = Copy-Fixture $documentReceipt
$noParserZip.artifacts = @($noParserZip.artifacts | Where-Object { -not ($_.artifactName -ceq "document-parser-lambda" -and $_.suffix -ceq "zip") })
Assert-Rejected { Get-GatewayProcessorArtifact $noParserZip $sourceSha -Kind parser } "A parser artifact was taken from a receipt without the parser archive."

$parserVariables = New-Variables -Released
$parserVariables.document_parser_artifact_s3_key.value = [string]$parserArtifact.key
$parserVariables.document_parser_artifact_s3_object_version.value = [string]$parserArtifact.versionId
$parserVariables.document_parser_artifact_sha256.value = [string]$parserArtifact.artifactSha256
$parserVariables.document_parser_artifact_base64sha256.value = [string]$parserArtifact.objectBase64Sha256
# The fixture baseline already names the receipt's parser archive, so build one that differs first.
$parserBaseline = Copy-Fixture $baselineVariables
$parserBaseline.document_parser_artifact_s3_key.value = "lambda/documents/older/$('2' * 64)/document-parser-lambda.zip"
$parserBaseline.document_parser_artifact_s3_object_version.value = "older-parser-version"
$parserBaseline.document_parser_artifact_sha256.value = "2" * 64
$parserBaseline.document_parser_artifact_base64sha256.value = [Convert]::ToBase64String(([byte[]](2..33)))
$null = Assert-GatewayReleaseVariables $parserBaseline $parserVariables $artifact $account $repositoryUrl "" -ParserArtifact $parserArtifact; $passed++
Assert-Rejected { Assert-GatewayReleaseVariables $parserBaseline $parserVariables $artifact $account $repositoryUrl "" } "Parser variables changed without a verified parser artifact."
foreach ($name in @("document_parser_artifact_s3_key", "document_parser_artifact_s3_object_version", "document_parser_artifact_sha256", "document_parser_artifact_base64sha256")) {
  $wrongParserVariable = Copy-Fixture $parserVariables; $wrongParserVariable.$name.value = "not-the-verified-value"
  Assert-Rejected { Assert-GatewayReleaseVariables $parserBaseline $wrongParserVariable $artifact $account $repositoryUrl "" -ParserArtifact $parserArtifact } "The release accepted an unverified '$name'."
}
$processorMovedWithParser = Copy-Fixture $parserVariables; $processorMovedWithParser.document_processor_artifact_sha256.value = "9" * 64
Assert-Rejected { Assert-GatewayReleaseVariables $parserBaseline $processorMovedWithParser $artifact $account $repositoryUrl "" -ParserArtifact $parserArtifact } "A parser refresh also moved the processor artifact without a verified processor artifact."
$pinMoved = Copy-Fixture $parserVariables; $pinMoved.document_parser_invocation_qualified_arn.value = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:99"
Assert-Rejected { Assert-GatewayReleaseVariables $parserBaseline $pinMoved $artifact $account $repositoryUrl "" -ParserArtifact $parserArtifact } "A parser refresh moved the processor's numeric parser pin."

function New-ParserPlan {
  param([object]$Base = $plan, [object]$Artifact = $parserArtifact)
  $refreshed = Copy-Fixture $Base
  $function = Copy-Fixture @($plan.resource_changes | Where-Object { $_.address -ceq "module.platform.aws_lambda_function.gateway[0]" })[0]
  $alias = Copy-Fixture @($plan.resource_changes | Where-Object { $_.address -ceq "module.platform.aws_lambda_alias.gateway[0]" })[0]
  $function.address = "module.platform.aws_lambda_function.document_parser[0]"
  $function.change.before.function_name = "parser"; $function.change.after.function_name = "parser"
  $function.change.after.s3_key = [string]$Artifact.key
  $function.change.after.s3_object_version = [string]$Artifact.versionId
  $function.change.after.source_code_hash = [string]$Artifact.objectBase64Sha256
  $function.change.after.environment[0].variables.RELEASE_SHA = [string]$Artifact.artifactSha256
  $alias.address = "module.platform.aws_lambda_alias.document_parser[0]"
  $alias.change.before.function_name = "parser"; $alias.change.after.function_name = "parser"
  $refreshed.resource_changes = @($refreshed.resource_changes) + @($function, $alias)
  # Terraform also reports the parser's recomputed latest-version ARN as a changed output.
  $refreshed.output_changes | Add-Member NoteProperty document_parser_version_arn ([pscustomobject]@{
      actions = @("update"); before = $parserVersionArn; after_unknown = $true
      before_sensitive = $false; after_sensitive = $false
    }) -Force
  return $refreshed
}
$parserVersionArn = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-document-parser:6"
$parserPlan = New-ParserPlan
$parserChanges = @(Assert-ExactGatewayReleasePlan $parserPlan $artifact -ParserArtifact $parserArtifact)
if ($parserChanges.Count -ne 4) { throw "The parser refresh plan did not return exactly four changes." }
$passed++
$bothPlan = New-ParserPlan -Base (New-ProcessorPlan)
$bothChanges = @(Assert-ExactGatewayReleasePlan $bothPlan $artifact -ProcessorArtifact $processorArtifact -ParserArtifact $parserArtifact)
if ($bothChanges.Count -ne 6) { throw "The processor and parser refresh plan did not return exactly six changes." }
$passed++
$allPlan = New-ParserPlan -Base (New-ProcessorPlan -Base (New-GrantPlan))
$allChanges = @(Assert-ExactGatewayReleasePlan $allPlan $artifact -ExpectedAccountId $account -ProcessorArtifact $processorArtifact -ParserArtifact $parserArtifact)
if ($allChanges.Count -ne 8) { throw "The grant, processor, and parser plan did not return exactly eight changes." }
$passed++

Assert-Rejected { Assert-ExactGatewayReleasePlan $parserPlan $artifact } "A parser refresh plan was accepted without a verified parser artifact."
# The parser's recomputed version ARN is the only output change a release may carry, and only with a parser refresh.
$null = Assert-ExactGatewayReleasePlan $parserPlan $artifact -ExpectedAccountId $account -ParserArtifact $parserArtifact; $passed++
$parserNoOutput = Copy-Fixture $parserPlan; $parserNoOutput.output_changes.PSObject.Properties.Remove("document_parser_version_arn")
$null = Assert-ExactGatewayReleasePlan $parserNoOutput $artifact -ParserArtifact $parserArtifact; $passed++
$outputWithoutRefresh = Copy-Fixture $plan
$outputWithoutRefresh.output_changes | Add-Member NoteProperty document_parser_version_arn $parserPlan.output_changes.document_parser_version_arn
Assert-Rejected { Assert-ExactGatewayReleasePlan $outputWithoutRefresh $artifact } "The parser version output changed without a parser refresh."
$processorOnlyOutput = New-ProcessorPlan
$processorOnlyOutput.output_changes | Add-Member NoteProperty document_parser_version_arn $parserPlan.output_changes.document_parser_version_arn
Assert-Rejected { Assert-ExactGatewayReleasePlan $processorOnlyOutput $artifact -ProcessorArtifact $processorArtifact } "The parser version output changed with only a processor refresh."
foreach ($mutation in @(
    "create", "delete", "replace", "known value", "sensitive before", "sensitive after", "not unknown", "not an arn",
    "other function", "other region", "other account", "version zero", "missing before", "extra output", "other output"
  )) {
  $badOutput = Copy-Fixture $parserPlan
  $output = $badOutput.output_changes.document_parser_version_arn
  switch ($mutation) {
    "create" { $output.actions = @("create") }
    "delete" { $output.actions = @("delete") }
    "replace" { $output.actions = @("delete", "create") }
    "known value" { $output | Add-Member NoteProperty after $parserVersionArn }
    "sensitive before" { $output.before_sensitive = $true }
    "sensitive after" { $output.after_sensitive = $true }
    "not unknown" { $output.after_unknown = $false }
    "not an arn" { $output.before = "not-an-arn" }
    "other function" { $output.before = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-gateway:6" }
    "other region" { $output.before = "arn:aws:lambda:eu-west-1:$account`:function:ai-job-apply-development-document-parser:6" }
    "other account" { $output.before = "arn:aws:lambda:us-east-2:999999999999:function:ai-job-apply-development-document-parser:6" }
    "version zero" { $output.before = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-document-parser:0" }
    "missing before" { $output.PSObject.Properties.Remove("before") }
    "extra output" {
      $badOutput.output_changes | Add-Member NoteProperty document_processor_alias_arn ([pscustomobject]@{
          actions = @("update"); before = "arn"; after_unknown = $true; before_sensitive = $false; after_sensitive = $false })
    }
    "other output" { $badOutput.output_changes.gateway_lambda_alias_arn.actions = @("update") }
  }
  Assert-Rejected { Assert-ExactGatewayReleasePlan $badOutput $artifact -ExpectedAccountId $account -ParserArtifact $parserArtifact } "The parser version output accepted: $mutation."
}
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserPlan $artifact -ProcessorArtifact $processorArtifact } "A parser refresh plan was accepted with only a processor artifact."
Assert-Rejected { Assert-ExactGatewayReleasePlan $bothPlan $artifact -ParserArtifact $parserArtifact } "A processor change was accepted without its verified artifact."
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserPlan $artifact -ParserArtifact $otherArtifact } "A parser refresh accepted a different artifact than the verified one."
foreach ($field in @("s3_key", "s3_object_version", "source_code_hash")) {
  $wrongParserField = Copy-Fixture $parserPlan; $wrongParserField.resource_changes[2].change.after.$field = "wrong"
  Assert-Rejected { Assert-ExactGatewayReleasePlan $wrongParserField $artifact -ParserArtifact $parserArtifact } "The parser update accepted a wrong '$field'."
}
$wrongParserRelease = Copy-Fixture $parserPlan; $wrongParserRelease.resource_changes[2].change.after.environment[0].variables.RELEASE_SHA = "0" * 64
Assert-Rejected { Assert-ExactGatewayReleasePlan $wrongParserRelease $artifact -ParserArtifact $parserArtifact } "The parser update accepted a wrong RELEASE_SHA."
foreach ($mutation in @("memory_size", "timeout", "handler", "role", "reserved_concurrent_executions")) {
  $mutatedParser = Copy-Fixture $parserPlan
  $mutatedParser.resource_changes[2].change.after.$mutation = if ($mutation -in @("handler", "role")) { "changed" } else { 999 }
  Assert-Rejected { Assert-ExactGatewayReleasePlan $mutatedParser $artifact -ParserArtifact $parserArtifact } "The parser update changed nonapproved field '$mutation'."
}
$parserEnvironment = Copy-Fixture $parserPlan
$parserEnvironment.resource_changes[2].change.after.environment[0].variables | Add-Member NoteProperty DOCUMENT_PARSER_VERSION "9.9.9"
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserEnvironment $artifact -ParserArtifact $parserArtifact } "The parser update added or changed an environment variable."
$unknownParser = Copy-Fixture $parserPlan; $unknownParser.resource_changes[2].change.after_unknown | Add-Member NoteProperty memory_size $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $unknownParser $artifact -ParserArtifact $parserArtifact } "The parser update accepted an unknown nonapproved field."
$movedParserAlias = Copy-Fixture $parserPlan; $movedParserAlias.resource_changes[3].change.after.description = "changed"
Assert-Rejected { Assert-ExactGatewayReleasePlan $movedParserAlias $artifact -ParserArtifact $parserArtifact } "The parser alias update changed a non-version field."
$parserAliasVersion = Copy-Fixture $parserPlan; $parserAliasVersion.resource_changes[3].change.after | Add-Member NoteProperty function_version "9"
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserAliasVersion $artifact -ParserArtifact $parserArtifact } "The parser alias update pinned a version at plan time."
$parserFunctionOnly = Copy-Fixture $parserPlan; $parserFunctionOnly.resource_changes = @($parserFunctionOnly.resource_changes | Select-Object -First 3)
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserFunctionOnly $artifact -ParserArtifact $parserArtifact } "A parser function change without its alias was accepted."
$parserReplaced = Copy-Fixture $parserPlan; $parserReplaced.resource_changes[2].change.actions = @("delete", "create")
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserReplaced $artifact -ParserArtifact $parserArtifact } "A parser replacement was accepted."
$parserPolicyToo = Copy-Fixture $parserPlan
$parserPolicyToo.resource_changes = @($parserPolicyToo.resource_changes) + @([pscustomobject]@{ address = "module.platform.aws_iam_role_policy.document_parser[0]"; mode = "managed"; type = "aws_iam_role_policy"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{}; after = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $parserPolicyToo $artifact -ParserArtifact $parserArtifact } "A parser refresh that also changed the parser IAM policy was accepted."
$objectAccessToo = Copy-Fixture $parserPlan
$objectAccessToo.resource_changes = @($objectAccessToo.resource_changes) + @([pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser_object_access[0]"; mode = "managed"; type = "aws_iam_role"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{}; after = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $objectAccessToo $artifact -ParserArtifact $parserArtifact } "A parser refresh that also changed the object-access role was accepted."


# ---- Gateway role inline-policy refresh drift after the invoke grant is applied (ADR-031).
$gatewayRoleArnValue = "arn:aws:iam::${account}:role/ai-job-apply-development-gateway-lambda"
$gatewayBeforePolicy = ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($logsStatement, $secretStatement) })
$gatewayAfterPolicy = ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($logsStatement, $secretStatement, $roleGrant) })
function New-GatewayRoleDriftPlan {
  param(
    [string]$BeforePolicy = $gatewayBeforePolicy,
    [string]$AfterPolicy = $gatewayAfterPolicy,
    [string]$PlannedPolicy = $gatewayAfterPolicy,
    [bool]$IncludePlannedPolicy = $true,
    [object]$Base = $completeDarkReleasePlan
  )
  $refreshPlan = Copy-Fixture $Base
  if ($IncludePlannedPolicy) {
    $refreshPlan.planned_values.root_module.resources = @($refreshPlan.planned_values.root_module.resources) + @(
      [pscustomobject]@{
        address = "module.platform.aws_iam_role_policy.gateway_lambda[0]"
        values = [pscustomobject]@{ name = "gateway-lambda-runtime"; role = "ai-job-apply-development-gateway-lambda"; policy = $PlannedPolicy }
      })
  }
  $roleBefore = [pscustomobject]@{
    arn = $gatewayRoleArnValue; name = "ai-job-apply-development-gateway-lambda"; path = "/"
    inline_policy = @([pscustomobject]@{ name = "gateway-lambda-runtime"; policy = $BeforePolicy })
    tags = [pscustomobject]@{}
  }
  $roleAfter = Copy-Fixture $roleBefore
  $roleAfter.inline_policy[0].policy = $AfterPolicy
  $refreshPlan.resource_drift = @($refreshPlan.resource_drift) + @(
    New-GatewayProviderDriftRecord -Address "module.platform.aws_iam_role.gateway_lambda[0]" -Type "aws_iam_role" -Before $roleBefore -After $roleAfter)
  return $refreshPlan
}
$roleDriftPlan = New-GatewayRoleDriftPlan
$null = Assert-ExactGatewayReleasePlan $roleDriftPlan $artifact; $passed++
$roleDriftBaseline = New-GatewayRoleDriftPlan -Base $completeDarkBaselinePlan
$null = Assert-RetainedGatewayBaselinePlan $roleDriftBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++

$otherStatement = [ordered]@{ Sid = "InvokeExactDocumentTailoringRuntime"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "*" }
$widenedPolicy = ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($logsStatement, $secretStatement, $otherStatement) })
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -AfterPolicy $widenedPolicy -PlannedPolicy $widenedPolicy) $artifact } "A widened Gateway role refresh was accepted."
$twoAdded = ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @($logsStatement, $secretStatement, $roleGrant, [ordered]@{ Sid = "Extra"; Effect = "Allow"; Action = "s3:GetObject"; Resource = "*" }) })
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -AfterPolicy $twoAdded -PlannedPolicy $twoAdded) $artifact } "A Gateway role refresh with a second added statement was accepted."
$alteredExisting = ConvertTo-PolicyJson ([ordered]@{ Version = "2012-10-17"; Statement = @([ordered]@{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = "logs:*"; Resource = "*" }, $secretStatement, $roleGrant) })
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -AfterPolicy $alteredExisting -PlannedPolicy $alteredExisting) $artifact } "A Gateway role refresh that altered an existing statement was accepted."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -PlannedPolicy $gatewayBeforePolicy) $artifact } "A Gateway role refresh differing from the source-evaluated policy was accepted."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -IncludePlannedPolicy $false) $artifact } "A Gateway role refresh without its planned policy was accepted."
Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayRoleDriftPlan -BeforePolicy $gatewayAfterPolicy) $artifact } "A Gateway role refresh that added no statement was accepted."

$otherAttribute = New-GatewayRoleDriftPlan
$otherAttribute.resource_drift[-1].change.after.path = "/service/"
Assert-Rejected { Assert-ExactGatewayReleasePlan $otherAttribute $artifact } "A Gateway role refresh that also changed another attribute was accepted."
$otherRole = New-GatewayRoleDriftPlan
$otherRole.resource_drift[-1].change.after.arn = "arn:aws:iam::${account}:role/some-other-role"
Assert-Rejected { Assert-ExactGatewayReleasePlan $otherRole $artifact } "A refresh of a different role was accepted as the Gateway role."
$otherPolicyName = New-GatewayRoleDriftPlan
$otherPolicyName.resource_drift[-1].change.after.inline_policy[0].name = "other-policy"
Assert-Rejected { Assert-ExactGatewayReleasePlan $otherPolicyName $artifact } "A Gateway role refresh with another inline policy name was accepted."
$duplicateRecord = New-GatewayRoleDriftPlan
$duplicateRecord.resource_drift = @($duplicateRecord.resource_drift) + @($duplicateRecord.resource_drift[-1])
Assert-Rejected { Assert-ExactGatewayReleasePlan $duplicateRecord $artifact } "A duplicated Gateway role refresh was accepted."
$unknownRole = New-GatewayRoleDriftPlan
$unknownRole.resource_drift[-1].change.after_unknown | Add-Member NoteProperty inline_policy $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $unknownRole $artifact } "A Gateway role refresh with an unknown field was accepted."
$replacedRole = New-GatewayRoleDriftPlan
$replacedRole.resource_drift[-1].change | Add-Member NoteProperty replace_paths @(@("inline_policy")) -Force
Assert-Rejected { Assert-ExactGatewayReleasePlan $replacedRole $artifact } "A Gateway role refresh with replacement paths was accepted."
$sensitiveRole = New-GatewayRoleDriftPlan
$sensitiveRole.resource_drift[-1].change.after_sensitive = [pscustomobject]@{ inline_policy = $true }
Assert-Rejected { Assert-ExactGatewayReleasePlan $sensitiveRole $artifact } "A Gateway role refresh that changed sensitivity was accepted."
$createdRole = New-GatewayRoleDriftPlan
$createdRole.resource_drift[-1].change.actions = @("delete", "create")
Assert-Rejected { Assert-ExactGatewayReleasePlan $createdRole $artifact } "A Gateway role replacement was accepted as refresh drift."

# ---- D3-024: refresh drift on the candidate-document bucket's CORS rules, after the reviewed upload-origin step
$corsLocal = "http://localhost:3000"; $corsHosted = "https://ai-job-apply-candidate.vercel.app"
$corsBucketAddress = "module.platform.aws_s3_bucket.candidate_documents[0]"
$corsConfigurationAddress = "module.platform.aws_s3_bucket_cors_configuration.candidate_documents[0]"
function New-CorsRule {
  param([string[]]$Origins)
  return [pscustomobject]@{
    allowed_headers = @("*"); allowed_methods = @("POST"); allowed_origins = @($Origins)
    expose_headers = @("ETag", "x-amz-version-id"); max_age_seconds = 300
  }
}
function New-CorsSensitivity {
  param([int]$OriginCount)
  return [pscustomobject]@{
    cors_rule = @([pscustomobject]@{
        allowed_headers = @($false); allowed_methods = @($false)
        allowed_origins = @(1..$OriginCount | ForEach-Object { $false }); expose_headers = @($false, $false) })
    tags = [pscustomobject]@{}
  }
}
function New-GatewayBucketCorsDriftPlan {
  param(
    [string[]]$Before = @($corsLocal), [string[]]$After = @($corsLocal, $corsHosted), [string[]]$Planned = @($corsLocal, $corsHosted),
    [bool]$IncludePlanned = $true, [object]$Base = $plan
  )
  $refreshPlan = Copy-Fixture $Base
  $plannedResources = @()
  if ($IncludePlanned) {
    $configuredRule = New-CorsRule $Planned; $configuredRule | Add-Member NoteProperty id ""
    $plannedResources = @([pscustomobject]@{
        address = $corsConfigurationAddress
        values = [pscustomobject]@{ bucket = "ai-job-apply-development-candidate-docs-$account"; cors_rule = @($configuredRule) }
      })
  }
  $existing = @()
  if ($null -ne $refreshPlan.PSObject.Properties["planned_values"] -and
      $null -ne $refreshPlan.planned_values.root_module.PSObject.Properties["resources"]) {
    $existing = @($refreshPlan.planned_values.root_module.resources)
  }
  $root = [pscustomobject]@{ resources = @($existing) + @($plannedResources) }
  if ($null -ne $refreshPlan.PSObject.Properties["planned_values"]) { $refreshPlan.planned_values = [pscustomobject]@{ root_module = $root } }
  else { $refreshPlan | Add-Member NoteProperty planned_values ([pscustomobject]@{ root_module = $root }) }
  $bucketBefore = [pscustomobject]@{
    arn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-$account"; bucket = "ai-job-apply-development-candidate-docs-$account"
    cors_rule = @(New-CorsRule $Before); force_destroy = $false; policy = "{}"; tags = [pscustomobject]@{}
    versioning = @([pscustomobject]@{ enabled = $true; mfa_delete = $false })
  }
  $bucketAfter = Copy-Fixture $bucketBefore
  $bucketAfter.cors_rule = @(New-CorsRule $After)
  $existingDrift = if ($null -ne $refreshPlan.PSObject.Properties["resource_drift"]) { @($refreshPlan.resource_drift) } else { @() }
  $record = New-GatewayProviderDriftRecord -Address $corsBucketAddress -Type "aws_s3_bucket" -Before $bucketBefore -After $bucketAfter `
    -BeforeSensitive (New-CorsSensitivity $Before.Count) -AfterSensitive (New-CorsSensitivity $After.Count)
  $refreshPlan.resource_drift = @($existingDrift) + @($record)
  return $refreshPlan
}
$corsDriftRelease = New-GatewayBucketCorsDriftPlan
$null = Assert-ExactGatewayReleasePlan $corsDriftRelease $artifact; $passed++
$corsDriftBaseline = New-GatewayBucketCorsDriftPlan -Base $baselinePlan
$null = Assert-RetainedGatewayBaselinePlan $corsDriftBaseline @($baselineVariables.PSObject.Properties | ForEach-Object Name); $passed++
$null = Assert-ExactGatewayReleasePlan (New-GatewayBucketCorsDriftPlan -Before @($corsLocal, "https://other.example.com") -After @($corsLocal, "https://other.example.com", $corsHosted) -Planned @($corsLocal, "https://other.example.com", $corsHosted)) $artifact; $passed++
$null = Assert-ExactGatewayReleasePlan (New-GatewayBucketCorsDriftPlan -Before @() -After @($corsHosted) -Planned @($corsHosted)) $artifact; $passed++

Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayBucketCorsDriftPlan -IncludePlanned $false) $artifact } "A bucket CORS refresh without its planned configuration was accepted."
foreach ($case in @(
    @{ Name = "planned lacks the origin"; Planned = @($corsLocal) },
    @{ Name = "planned reordered"; Planned = @($corsHosted, $corsLocal) },
    @{ Name = "planned has an extra origin"; Planned = @($corsLocal, $corsHosted, "https://extra.example.com") },
    @{ Name = "planned differs"; Planned = @($corsLocal, "https://other.example.com") }
  )) {
  Assert-Rejected { Assert-ExactGatewayReleasePlan (New-GatewayBucketCorsDriftPlan -Planned $case.Planned) $artifact } "A bucket CORS refresh accepted '$($case.Name)'."
}
foreach ($case in @(
    @{ Name = "baseline dropped"; Before = @($corsLocal); After = @($corsHosted) },
    @{ Name = "reordered"; Before = @($corsLocal, $corsHosted); After = @($corsHosted, $corsLocal) },
    @{ Name = "shrunk"; Before = @($corsLocal, $corsHosted); After = @($corsLocal) },
    @{ Name = "duplicate origin"; Before = @($corsLocal); After = @($corsLocal, $corsLocal) },
    @{ Name = "wildcard origin"; Before = @($corsLocal); After = @($corsLocal, "*") },
    @{ Name = "non-https origin"; Before = @($corsLocal); After = @($corsLocal, "http://example.com/path") }
  )) {
  Assert-Rejected {
    Assert-ExactGatewayReleasePlan (New-GatewayBucketCorsDriftPlan -Before $case.Before -After $case.After -Planned $case.After) $artifact
  } "A bucket CORS refresh accepted '$($case.Name)'."
}
foreach ($mutation in @(
    "methods", "headers", "expose", "max age", "second rule", "no rule", "bucket policy", "tags", "versioning", "force destroy",
    "arn", "unknown value", "sensitive before", "sensitive after", "replace path", "create", "delete", "replace", "no-op", "wrong type",
    "data mode", "other address"
  )) {
  $bad = New-GatewayBucketCorsDriftPlan
  $record = $bad.resource_drift[-1]
  switch ($mutation) {
    "methods" { $record.change.after.cors_rule[0].allowed_methods = @("POST", "GET") }
    "headers" { $record.change.after.cors_rule[0].allowed_headers = @("x-amz-*") }
    "expose" { $record.change.after.cors_rule[0].expose_headers = @("ETag") }
    "max age" { $record.change.after.cors_rule[0].max_age_seconds = 86400 }
    "second rule" { $record.change.after.cors_rule = @($record.change.after.cors_rule[0], (Copy-Fixture $record.change.after.cors_rule[0])) }
    "no rule" { $record.change.after.cors_rule = @() }
    "bucket policy" { $record.change.after.policy = '{"Statement":[]}' }
    "tags" { $record.change.after.tags | Add-Member NoteProperty leaked "x" }
    "versioning" { $record.change.after.versioning[0].enabled = $false }
    "force destroy" { $record.change.after.force_destroy = $true }
    "arn" { $record.change.after.arn = "arn:aws:s3:::another-bucket" }
    "unknown value" { $record.change.after_unknown | Add-Member NoteProperty cors_rule $true }
    "sensitive before" { $record.change.before_sensitive.cors_rule[0].allowed_origins[0] = $true }
    "sensitive after" { $record.change.after_sensitive.cors_rule[0].allowed_origins[1] = $true }
    "replace path" { $record.change | Add-Member NoteProperty replace_paths @(, @("cors_rule")) -Force }
    "create" { $record.change.actions = @("create") }
    "delete" { $record.change.actions = @("delete") }
    "replace" { $record.change.actions = @("delete", "create") }
    "no-op" { $record.change.actions = @("no-op") }
    "wrong type" { $record.type = "aws_s3_bucket_policy" }
    "data mode" { $record.mode = "data" }
    "other address" { $record.address = "module.platform.aws_s3_bucket.artifacts[0]" }
  }
  Assert-Rejected { Assert-ExactGatewayReleasePlan $bad $artifact } "A bucket CORS refresh accepted the '$mutation' mutation."
}
$duplicateBucketRecord = New-GatewayBucketCorsDriftPlan
$duplicateBucketRecord.resource_drift = @($duplicateBucketRecord.resource_drift) + @($duplicateBucketRecord.resource_drift[-1])
Assert-Rejected { Assert-ExactGatewayReleasePlan $duplicateBucketRecord $artifact } "A duplicated bucket CORS refresh was accepted."
# an unrelated drift record next to it is still judged by the shared check, not waved through
$withOtherDrift = New-GatewayBucketCorsDriftPlan
$withOtherDrift.resource_drift = @($withOtherDrift.resource_drift) + @(
  New-GatewayProviderDriftRecord -Address "module.platform.aws_lambda_function.gateway[0]" -Type "aws_lambda_function" `
    -Before ([pscustomobject]@{ memory_size = 1024 }) -After ([pscustomobject]@{ memory_size = 2048 }))
Assert-Rejected { Assert-ExactGatewayReleasePlan $withOtherDrift $artifact } "An unrelated drift record next to the bucket CORS refresh was accepted."

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$diagnosticPlanPath = Join-Path $terraformDirectory `
  ".terraform\development-gateway-release\release-1948a4d49366-20260814-184301-fd82e936c7bc4d46a8d867ab92266969.tfplan"
if (Test-Path -LiteralPath $diagnosticPlanPath -PathType Leaf) {
  $diagnosticPlanSha256 = "36d47da067e6448db3d72b110e2cad3cf27afa95c15959e3e0e8d3b092edb1f4"
  if ((Get-FileHash -LiteralPath $diagnosticPlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $diagnosticPlanSha256) {
    throw "The local gateway diagnostic plan does not match its checksum pin."
  }
  $diagnosticReceiptPath = Join-Path $terraformDirectory `
    ".terraform\development-gateway-release\receipt-1948a4d49366-20260814-183209.json"
  if (-not (Test-Path -LiteralPath $diagnosticReceiptPath -PathType Leaf) -or
      (Get-FileHash -LiteralPath $diagnosticReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        "9eee009f6076c1ebc2007ef9631a47b7f33b3993974ca3672f7df2fb0f856f49") {
    throw "The local gateway diagnostic receipt does not match its checksum pin."
  }
  $diagnosticReceipt = Get-Content -LiteralPath $diagnosticReceiptPath -Raw | ConvertFrom-Json
  $diagnosticArtifact = Assert-GatewayPublicationReceipt $diagnosticReceipt `
    "1948a4d49366872981a9419b76968b9bc372b8f3" `
    "6a2decf2ded0ea2c5b6d1236108d2eb61a5990af40434f38d7423a1c317624b9"
  $diagnosticPlan = Read-DeploymentTerraformPlan -Path $diagnosticPlanPath -TerraformDirectory $terraformDirectory -AllowHistorical
  $null = Assert-ExactGatewayReleasePlan $diagnosticPlan $diagnosticArtifact -AllowHistorical
  if ((Get-FileHash -LiteralPath $diagnosticPlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $diagnosticPlanSha256) {
    throw "The local gateway diagnostic plan changed during guard validation."
  }
  $passed++
}

# ---- D3-027: refresh drift on the two durable-chain roles, after the reviewed activity code refresh
$chainSpecs = @(
  @{
    Address = "module.platform.aws_iam_role.outbox_starter[0]"; RoleName = "ai-job-apply-development-outbox-starter"
    PolicyName = "outbox-starter-runtime"; PolicyAddress = "module.platform.aws_iam_role_policy.outbox_starter[0]"
    Sid = "StartExactDurableWorkflowVersion"; FunctionName = "ai-job-apply-development-profile-readiness-durable"
  },
  @{
    Address = "module.platform.aws_iam_role.profile_readiness_durable[0]"; RoleName = "ai-job-apply-development-profile-readiness-durable"
    PolicyName = "profile-readiness-durable-runtime"; PolicyAddress = "module.platform.aws_iam_role_policy.profile_readiness_durable[0]"
    Sid = "InvokeExactProfileActivityVersion"; FunctionName = "ai-job-apply-development-profile-readiness-activity"
  }
)
function New-ChainPolicyJson {
  param([Parameter(Mandatory)][hashtable]$Spec, [Parameter(Mandatory)][int]$Version, [scriptblock]$Mutate = $null)
  $statements = @(
    [ordered]@{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = @("logs:PutLogEvents", "logs:CreateLogStream"); Resource = "arn:aws:logs:us-east-2:${account}:log-group:/x:*" },
    [ordered]@{ Sid = "ReadDatabaseSecret"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = "arn:aws:secretsmanager:us-east-2:${account}:secret:db" },
    [ordered]@{ Sid = $Spec.Sid; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = "arn:aws:lambda:us-east-2:${account}:function:$($Spec.FunctionName):$Version" },
    [ordered]@{ Sid = "SendToDeadLetter"; Effect = "Allow"; Action = "sqs:SendMessage"; Resource = "arn:aws:sqs:us-east-2:${account}:dlq" }
  )
  $policy = [ordered]@{ Version = "2012-10-17"; Statement = $statements }
  if ($null -ne $Mutate) { $policy = & $Mutate $policy }
  return ($policy | ConvertTo-Json -Depth 20 -Compress)
}
function New-ChainRoleDriftPlan {
  param(
    [Parameter(Mandatory)][hashtable]$Spec, [int]$BeforeVersion = 15, [int]$AfterVersion = 16,
    [scriptblock]$MutateAfter = $null, [scriptblock]$MutateRecord = $null, [string]$PlannedPolicy = "", [switch]$OmitPlanned,
    [switch]$PlannedUnknown, [string[]]$PolicyChangeActions = @("update"), [bool]$PolicyUnknownFlag = $true, [int]$PolicyChangeCount = 1
  )
  $beforePolicy = New-ChainPolicyJson $Spec $BeforeVersion
  $afterPolicy = New-ChainPolicyJson $Spec $AfterVersion $MutateAfter
  $roleArn = "arn:aws:iam::${account}:role/$($Spec.RoleName)"
  $before = [pscustomobject]@{ arn = $roleArn; name = $Spec.RoleName; tags = [pscustomobject]@{}; inline_policy = @([pscustomobject]@{ name = $Spec.PolicyName; policy = $beforePolicy }) }
  $after = [pscustomobject]@{ arn = $roleArn; name = $Spec.RoleName; tags = [pscustomobject]@{}; inline_policy = @([pscustomobject]@{ name = $Spec.PolicyName; policy = $afterPolicy }) }
  $record = New-GatewayProviderDriftRecord -Address $Spec.Address -Type "aws_iam_role" -Before $before -After $after
  if ($null -ne $MutateRecord) { $record = & $MutateRecord $record }
  $expected = if ($PlannedPolicy -ne "") { $PlannedPolicy } else { $afterPolicy }
  $resources = @()
  if (-not $OmitPlanned) { $resources = @([pscustomobject]@{ address = $Spec.PolicyAddress; values = [pscustomobject]@{ policy = $expected } }) }
  if ($PlannedUnknown) {
    # this plan rewrites the role policy in place, so its planned text is absent (unknown)
    $resources = @([pscustomobject]@{ address = $Spec.PolicyAddress; values = [pscustomobject]@{ name = $Spec.PolicyName } })
  }
  $result = [pscustomobject]@{
    resource_drift = @($record)
    planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{ resources = $resources } }
  }
  if ($PolicyChangeCount -gt 0) {
    $policyChange = [pscustomobject]@{
      address = $Spec.PolicyAddress; mode = "managed"; type = "aws_iam_role_policy"
      change = [pscustomobject]@{ actions = $PolicyChangeActions; before = [pscustomobject]@{ policy = $beforePolicy }; after = [pscustomobject]@{}; after_unknown = [pscustomobject]@{ policy = $PolicyUnknownFlag } }
    }
    $result | Add-Member NoteProperty resource_changes @(1..$PolicyChangeCount | ForEach-Object { $policyChange })
  }
  return $result
}
foreach ($spec in $chainSpecs) {
  $null = Assert-AcceptedGatewayProviderDrift -Plan (New-ChainRoleDriftPlan $spec); $passed++
  $null = Assert-AcceptedGatewayProviderDrift -Plan (New-ChainRoleDriftPlan $spec -BeforeVersion 3 -AfterVersion 40); $passed++
  foreach ($case in @(
      @{ Name = "the same version"; Plan = { New-ChainRoleDriftPlan $spec -BeforeVersion 16 -AfterVersion 16 } },
      @{ Name = "a lower version"; Plan = { New-ChainRoleDriftPlan $spec -BeforeVersion 16 -AfterVersion 15 } },
      @{ Name = "no planned policy"; Plan = { New-ChainRoleDriftPlan $spec -OmitPlanned } },
      @{ Name = "a policy that is not the planned one"; Plan = { New-ChainRoleDriftPlan $spec -PlannedPolicy (New-ChainPolicyJson $spec 99) } },
      @{ Name = "another function"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-gateway:16"; $p } } },
      @{ Name = "an unversioned function"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:${account}:function:$($spec.FunctionName)"; $p } } },
      @{ Name = "an alias resource"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:${account}:function:$($spec.FunctionName):development"; $p } } },
      @{ Name = "a wildcard resource"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = "*"; $p } } },
      @{ Name = "another account"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:999999999999:function:$($spec.FunctionName):16"; $p } } },
      @{ Name = "two resources"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Resource = @("arn:aws:lambda:us-east-2:${account}:function:$($spec.FunctionName):16", "arn:aws:lambda:us-east-2:${account}:function:$($spec.FunctionName):17"); $p } } },
      @{ Name = "a widened action"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Action = "lambda:*"; $p } } },
      @{ Name = "a second action"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Action = @("lambda:InvokeFunction", "lambda:DeleteFunction"); $p } } },
      @{ Name = "a deny effect"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Effect = "Deny"; $p } } },
      @{ Name = "a condition added"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Condition = @{ StringEquals = @{ x = "y" } }; $p } } },
      @{ Name = "an extra statement"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement = @($p.Statement) + @([ordered]@{ Sid = "Extra"; Effect = "Allow"; Action = "s3:*"; Resource = "*" }); $p } } },
      @{ Name = "a removed statement"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement = @($p.Statement | Select-Object -First 3); $p } } },
      @{ Name = "another statement changed"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[1].Resource = "*"; $p } } },
      @{ Name = "another statement widened"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[0].Action = "logs:*"; $p } } },
      @{ Name = "a reordered policy"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement = @($p.Statement[1], $p.Statement[0], $p.Statement[2], $p.Statement[3]); $p } } },
      @{ Name = "another policy version"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Version = "2008-10-17"; $p } } },
      @{ Name = "the reviewed statement renamed"; Plan = { New-ChainRoleDriftPlan $spec -MutateAfter { param($p) $p.Statement[2].Sid = "Other"; $p } } },
      @{ Name = "another role"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after.arn = "arn:aws:iam::${account}:role/other"; $r } } },
      @{ Name = "another inline policy name"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after.inline_policy[0].name = "other"; $r } } },
      @{ Name = "a second inline policy"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after.inline_policy = @($r.change.after.inline_policy[0], $r.change.after.inline_policy[0]); $r } } },
      @{ Name = "a changed tag"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after.tags = [pscustomobject]@{ x = "y" }; $r } } },
      @{ Name = "an added attribute"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after | Add-Member NoteProperty description "changed"; $r } } },
      @{ Name = "an unknown value"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after_unknown = [pscustomobject]@{ inline_policy = $true }; $r } } },
      @{ Name = "a sensitivity change"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.after_sensitive = [pscustomobject]@{ tags = $true }; $r } } },
      @{ Name = "a replacement path"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change | Add-Member NoteProperty replace_paths @(, @("name")); $r } } },
      @{ Name = "a create action"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.actions = @("create"); $r } } },
      @{ Name = "a delete action"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.change.actions = @("delete"); $r } } },
      @{ Name = "a data-source mode"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.mode = "data"; $r } } },
      @{ Name = "another type"; Plan = { New-ChainRoleDriftPlan $spec -MutateRecord { param($r) $r.type = "aws_iam_policy"; $r } } }
    )) {
    $bad = & $case.Plan
    Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $bad } "The $($spec.RoleName) refresh with $($case.Name) was accepted."
  }
  # the planned policy text is unknown because this same plan rewrites the role policy in place
  $null = Assert-AcceptedGatewayProviderDrift -Plan (New-ChainRoleDriftPlan $spec -PlannedUnknown); $passed++
  foreach ($case in @(
      @{ Name = "no policy change in the plan"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyChangeCount 0 } },
      @{ Name = "a duplicated policy change"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyChangeCount 2 } },
      @{ Name = "a no-op policy change"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyChangeActions @("no-op") } },
      @{ Name = "a policy replacement"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyChangeActions @("create", "delete") } },
      @{ Name = "a policy delete"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyChangeActions @("delete") } },
      @{ Name = "a known policy attribute"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -PolicyUnknownFlag $false } },
      @{ Name = "an unknown policy but a widened statement"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -MutateAfter { param($p) $p.Statement[2].Action = "lambda:*"; $p } } },
      @{ Name = "an unknown policy but an extra statement"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -MutateAfter { param($p) $p.Statement = @($p.Statement) + @([ordered]@{ Sid = "Extra"; Effect = "Allow"; Action = "s3:*"; Resource = "*" }); $p } } },
      @{ Name = "an unknown policy but another function"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-gateway:16"; $p } } },
      @{ Name = "an unknown policy but a lower version"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -BeforeVersion 16 -AfterVersion 15 } },
      @{ Name = "an unknown policy but another attribute changed"; Plan = { New-ChainRoleDriftPlan $spec -PlannedUnknown -MutateRecord { param($r) $r.change.after.tags = [pscustomobject]@{ x = "y" }; $r } } }
    )) {
    $bad = & $case.Plan
    Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $bad } "The $($spec.RoleName) refresh with $($case.Name) was accepted."
  }
  $duplicated = New-ChainRoleDriftPlan $spec
  $duplicated.resource_drift = @($duplicated.resource_drift[0], $duplicated.resource_drift[0])
  Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $duplicated } "A duplicated $($spec.RoleName) refresh was accepted."
}
# each spec's grant may not be swapped for the other's function or statement name
$swapped = New-ChainRoleDriftPlan $chainSpecs[0] -MutateAfter { param($p) $p.Statement[2].Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-profile-readiness-activity:16"; $p }
Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $swapped } "The outbox starter role was accepted with the activity function."
$otherRole = New-ChainRoleDriftPlan $chainSpecs[1]
$otherRole.resource_drift[0].address = "module.platform.aws_iam_role.gateway_lambda[0]"
Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $otherRole } "A different role address was accepted as a chain role refresh."
# both records together are accepted, and an unrelated record beside them still refuses
$both = New-ChainRoleDriftPlan $chainSpecs[0]
$second = New-ChainRoleDriftPlan $chainSpecs[1]
$both.resource_drift = @($both.resource_drift[0], $second.resource_drift[0])
$both.planned_values.root_module.resources = @($both.planned_values.root_module.resources) + @($second.planned_values.root_module.resources)
$null = Assert-AcceptedGatewayProviderDrift -Plan $both; $passed++
$withUnknown = Copy-Fixture $both
$withUnknown.resource_drift = @($withUnknown.resource_drift) + @((New-GatewayProviderDriftRecord -Address "module.platform.aws_iam_role.unreviewed[0]" -Type "aws_iam_role" -Before ([pscustomobject]@{ a = 1 }) -After ([pscustomobject]@{ a = 2 })))
Assert-Rejected { Assert-AcceptedGatewayProviderDrift -Plan $withUnknown } "An unreviewed drift record beside the chain role refreshes was accepted."

Write-Output "Development gateway release guard tests passed: $passed"
