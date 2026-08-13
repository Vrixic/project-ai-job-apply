Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
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
$null = Assert-RetainedGatewayBaselineMetadata $baselineMetadata $baselinePath $baselineSha $sourceSha $account "us-east-2"; $passed++
$badMetadata = Copy-Fixture $baselineMetadata; $badMetadata.Applyable = $true
Assert-Rejected { Assert-RetainedGatewayBaselineMetadata $badMetadata $baselinePath $baselineSha $sourceSha $account "us-east-2" } "Applyable retained metadata was accepted."
$badMetadata = Copy-Fixture $baselineMetadata; $badMetadata.ParserQualifiedArn = "arn:aws:lambda:us-east-2:999999999999:function:ai-job-apply-development-document-parser:7"; $badMetadata.Stage = "complete-dark"
Assert-Rejected { Assert-RetainedGatewayBaselineMetadata $badMetadata $baselinePath $baselineSha $sourceSha $account "us-east-2" } "A cross-account parser pin was accepted."

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
    document_scan_mapping_enabled = [pscustomobject]@{ value = $false }
    document_scan_event_rule_enabled = [pscustomobject]@{ value = $false }
    migration_image = [pscustomobject]@{ value = "$repositoryUrl@sha256:$('1' * 64)" }
    oidc_audience = [pscustomobject]@{ value = "ai-job-apply-api" }
  }
}
$baselineVariables = New-Variables; $releaseVariables = New-Variables -Released
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
$null = Assert-GatewayReleaseVariables $baselineVariables $releaseVariables $artifact $account $repositoryUrl ""; $passed++
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
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[0].change.after.memory_size = 2048
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A nonapproved function field change was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[1].change.after.routing_config = @([pscustomobject]@{ additional_version_weights = @{ "7" = 0.1 } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "Alias traffic routing was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.output_changes.gateway_lambda_alias_arn.actions = @("update")
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "A meaningful output change was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_changes[0].change.after_unknown | Add-Member NoteProperty memory_size $true
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "An unknown nonapproved field was accepted."
$badPlan = Copy-Fixture $plan; $badPlan.resource_drift = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
Assert-Rejected { Assert-ExactGatewayReleasePlan $badPlan $artifact } "Release-time resource drift was accepted."

Write-Output "Development gateway release guard tests passed: $passed"
