Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
$account = "123456789012"

$parser = Get-DevelopmentDocumentStageExpectedActions "parser-dark"
$complete = Get-DevelopmentDocumentStageExpectedActions "complete-dark"
$completeTransition = Get-DevelopmentDocumentStageExpectedActions "complete-dark" -ParserSourceTransition
$completeParserRefresh = Get-DevelopmentDocumentStageExpectedActions "complete-dark" -CompleteDarkParserRefresh
$completeProcessorRefresh = Get-DevelopmentDocumentStageExpectedActions "complete-dark" -CompleteDarkProcessorRefresh
$kms = Get-DevelopmentDocumentStageExpectedActions "kms-prerequisite"
if ($parser.Count -ne 34 -or @($parser.Values | Where-Object { $_ -ceq "create" }).Count -ne 32 -or
  @($parser.Values | Where-Object { $_ -ceq "update" }).Count -ne 2) {
  throw "Parser-dark does not retain its exact 32-create/2-update action boundary."
}
if ($complete.Count -ne 10 -or @($complete.Values | Where-Object { $_ -ceq "create" }).Count -ne 7 -or
  @($complete.Values | Where-Object { $_ -ceq "update" }).Count -ne 3) {
  throw "Complete-dark does not retain its exact 7-create/3-update action boundary."
}
if ($completeTransition.Count -ne 12 -or
  @($completeTransition.Values | Where-Object { $_ -ceq "create" }).Count -ne 7 -or
  @($completeTransition.Values | Where-Object { $_ -ceq "update" }).Count -ne 5 -or
  $completeTransition["module.platform.aws_lambda_function.document_parser[0]"] -cne "update" -or
  $completeTransition["module.platform.aws_lambda_alias.document_parser[0]"] -cne "update") {
  throw "CompleteDark source transition does not retain its exact 7-create/5-update boundary."
}
if ($completeParserRefresh.Count -ne 2 -or
  $completeParserRefresh["module.platform.aws_lambda_function.document_parser[0]"] -cne "update" -or
  $completeParserRefresh["module.platform.aws_lambda_alias.document_parser[0]"] -cne "update") {
  throw "CompleteDark parser refresh does not retain its exact two-update boundary."
}
if ($completeProcessorRefresh.Count -ne 3 -or
  $completeProcessorRefresh["module.platform.aws_iam_role_policy.document_processor[0]"] -cne "update" -or
  $completeProcessorRefresh["module.platform.aws_lambda_function.document_processor[0]"] -cne "update" -or
  $completeProcessorRefresh["module.platform.aws_lambda_alias.document_processor[0]"] -cne "update") {
  throw "CompleteDark processor refresh does not retain its exact three-update boundary."
}
foreach ($invalidRefresh in @(
    { Get-DevelopmentDocumentStageExpectedActions parser-dark -CompleteDarkParserRefresh },
    { Get-DevelopmentDocumentStageExpectedActions parser-dark -CompleteDarkProcessorRefresh },
    { Get-DevelopmentDocumentStageExpectedActions complete-dark -CompleteDarkParserRefresh -CompleteDarkProcessorRefresh }
  )) {
  $rejected = $false; try { & $invalidRefresh | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw "An invalid CompleteDark refresh-mode combination was accepted." }
}
if ($kms.Count -ne 1 -or $kms["module.platform.aws_kms_key.platform"] -cne "update") {
  throw "The KMS prerequisite is not exactly one in-place update."
}
if (@($parser.Keys | Where-Object { $complete.ContainsKey($_) }).Count -ne 0) {
  throw "Parser-dark and complete-dark action sets overlap."
}
$parserAddresses = @($parser.Keys)
$parserInventory = [pscustomobject]@{
  ProcessorFunctions = 0; ProcessorAliases = 0; ProcessorMappings = 0; StsEndpoints = 0
  ReconcilerTargets = 0; ReconcilerPermissions = 0; ProcessorInlinePolicies = 0; LaterStageEndpointGrants = 0
}
Assert-DevelopmentDocumentStageResourceInventory parser-dark $parserAddresses $parserInventory
foreach ($shadow in @(
    "module.platform.aws_cloudwatch_event_rule.document_health_shadow[0]",
    "module.platform.aws_cloudwatch_event_target.document_health_shadow[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_health_shadow[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_health_shadow[0]",
    "module.platform.aws_iam_role.document_parser_shadow[0]",
    "module.platform.aws_iam_role_policy.document_parser_shadow[0]",
    "module.platform.aws_lambda_alias.document_parser_shadow[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_shadow[0]",
    "module.platform.aws_lambda_function.document_processor_shadow[0]",
    "module.platform.aws_lambda_permission.document_health_shadow[0]",
    "module.platform.aws_security_group.document_parser_shadow[0]",
    "module.platform.aws_sns_topic.document_health_shadow[0]",
    "module.platform.aws_sqs_queue.document_scan_shadow[0]",
    "module.platform.aws_sqs_queue_policy.document_scan_shadow[0]",
    "module.platform.aws_vpc_endpoint.document_sts_shadow[0]"
  )) {
  $extraParserAddresses = @($parserAddresses + $shadow)
  $rejected = $false
  try { Assert-DevelopmentDocumentStageResourceInventory parser-dark $extraParserAddresses $parserInventory } catch { $rejected = $true }
  if (-not $rejected) { throw "Parser-dark accepted unmanaged document resource '$shadow'." }
  $extraCompleteAddresses = @($parserAddresses + $complete.Keys + $shadow)
  $completeShadowInventory = [pscustomobject]@{
    ProcessorFunctions = 1; ProcessorAliases = 1; ProcessorMappings = 1; StsEndpoints = 1
    ReconcilerTargets = 1; ReconcilerPermissions = 1; ProcessorInlinePolicies = 1; LaterStageEndpointGrants = 3
  }
  $rejected = $false
  try { Assert-DevelopmentDocumentStageResourceInventory complete-dark $extraCompleteAddresses $completeShadowInventory } catch { $rejected = $true }
  if (-not $rejected) { throw "Complete-dark accepted unmanaged document resource '$shadow'." }
}
$leakedInventory = $parserInventory | ConvertTo-Json | ConvertFrom-Json
$leakedInventory.ProcessorAliases = 1
$rejected = $false
try { Assert-DevelopmentDocumentStageResourceInventory parser-dark $parserAddresses $leakedInventory } catch { $rejected = $true }
if (-not $rejected) { throw "Parser-dark accepted a live processor alias outside Terraform state." }
$completeAddresses = @($parser.Keys + $complete.Keys)
$completeInventory = [pscustomobject]@{
  ProcessorFunctions = 1; ProcessorAliases = 1; ProcessorMappings = 1; StsEndpoints = 1
  ReconcilerTargets = 1; ReconcilerPermissions = 1; ProcessorInlinePolicies = 1; LaterStageEndpointGrants = 3
}
Assert-DevelopmentDocumentStageResourceInventory complete-dark $completeAddresses $completeInventory
$missingComplete = @($completeAddresses | Where-Object { $_ -ne "module.platform.aws_lambda_permission.document_processing_reconciler[0]" })
$rejected = $false
try { Assert-DevelopmentDocumentStageResourceInventory complete-dark $missingComplete $completeInventory } catch { $rejected = $true }
if (-not $rejected) { throw "Complete-dark accepted a missing reconciler permission." }

$processorRoleArn = "arn:aws:iam::${account}:role/ai-job-apply-development-document-processor"
$unrelatedConditionOmitted = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "Unrelated" }) }
$unrelatedConditionNull = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "Unrelated"; Condition = $null }) }
$unrelatedConditionScalar = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "Unrelated"; Condition = "not-an-object" }) }
$unrelatedConditionList = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "Unrelated"; Condition = @("not", "an-object") }) }
if ((Get-DevelopmentDocumentLaterStageEndpointGrantCount @(
      $unrelatedConditionOmitted, $unrelatedConditionNull, $unrelatedConditionScalar, $unrelatedConditionList
    ) $account) -ne 0) {
  throw "Optional absent, null, scalar, or list conditions on unrelated endpoint statements were counted as later-stage grants."
}
$queueGrant = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "ExactDocumentProcessorQueueOnly" }) }
$lambdaGrant = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "CoordinatorInvokesExactParserVersionOnly" }) }
$secretGrant = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{
      Sid = "ExactLambdaRolesDatabaseSecretOnly"
      Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{
          "aws:PrincipalArn" = @("arn:aws:iam::${account}:role/existing", $processorRoleArn)
        } }
    }) }
if ((Get-DevelopmentDocumentLaterStageEndpointGrantCount @($queueGrant, $lambdaGrant, $secretGrant) $account) -ne 3) {
  throw "The three exact later-stage endpoint grant forms were not counted."
}
foreach ($case in @(
    @{ Label = "present-null Condition on conditionless grant"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "ExactDocumentProcessorQueueOnly"; Condition = $null }) } },
    @{ Label = "unexpected Condition on conditionless grant"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "CoordinatorInvokesExactParserVersionOnly"; Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{ "aws:PrincipalArn" = $processorRoleArn } } }) } },
    @{ Label = "omitted required Condition"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "ExactLambdaRolesDatabaseSecretOnly" }) } },
    @{ Label = "present-null required Condition"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "ExactLambdaRolesDatabaseSecretOnly"; Condition = $null }) } },
    @{ Label = "unexpected required Condition operator"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "ExactLambdaRolesDatabaseSecretOnly"; Condition = [pscustomobject]@{ ArnLike = [pscustomobject]@{ "aws:PrincipalArn" = $processorRoleArn } } }) } },
    @{ Label = "broadened required Condition"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "ExactLambdaRolesDatabaseSecretOnly"; Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{ "aws:PrincipalArn" = @($processorRoleArn, "*") } } }) } },
    @{ Label = "unexpected processor grant"; Policy = [pscustomobject]@{ Statement = @([pscustomobject]@{ Sid = "UnexpectedProcessorGrant"; Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{ "aws:PrincipalArn" = $processorRoleArn } } }) } }
  )) {
  $rejected = $false
  try { $null = Get-DevelopmentDocumentLaterStageEndpointGrantCount @($case.Policy) $account } catch { $rejected = $true }
  if (-not $rejected) { throw "The endpoint grant inventory accepted $($case.Label)." }
}

Assert-ParserLambdaResourcePolicyAbsence -UnqualifiedPolicy $null -QualifiedPolicy $null
foreach ($parserPolicyLeak in @(
    @{ UnqualifiedPolicy = '{"Version":"2012-10-17","Statement":[]}'; QualifiedPolicy = $null },
    @{ UnqualifiedPolicy = $null; QualifiedPolicy = '{"Version":"2012-10-17","Statement":[]}' }
  )) {
  $rejected = $false
  try { Assert-ParserLambdaResourcePolicyAbsence @parserPolicyLeak } catch { $rejected = $true }
  if (-not $rejected) { throw "The parser resource-policy absence guard accepted a policy." }
}
$reconcilerArn = "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-processing-reconciler"
$processorResourcePolicyStatement = @{
  Sid = "AllowExactDocumentReconcilerRule"; Effect = "Allow"; Action = "lambda:InvokeFunction"
  Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-processor:development"
  Principal = @{ Service = "events.amazonaws.com" }
  Condition = @{ ArnLike = @{ "AWS:SourceArn" = $reconcilerArn } }
}
$processorResourcePolicy = @{ Version = "2012-10-17"; Statement = @($processorResourcePolicyStatement) } | ConvertTo-Json -Compress -Depth 20
Assert-ExactProcessorLambdaResourcePolicyDocument $processorResourcePolicy $account $reconcilerArn
foreach ($mutation in @("extra", "action", "principal", "sid", "source", "resource")) {
  $bad = $processorResourcePolicy | ConvertFrom-Json
  switch ($mutation) {
    "extra" { $bad.Statement = @($bad.Statement, $bad.Statement | ConvertTo-Json -Depth 20 | ConvertFrom-Json) }
    "action" { $bad.Statement[0].Action = "lambda:*" }
    "principal" { $bad.Statement[0].Principal.Service = "sns.amazonaws.com" }
    "sid" { $bad.Statement[0].Sid = "Unexpected" }
    "source" { $bad.Statement[0].Condition.ArnLike."AWS:SourceArn" = "*" }
    "resource" { $bad.Statement[0].Resource = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-processor" }
  }
  $rejected = $false
  try { Assert-ExactProcessorLambdaResourcePolicyDocument $bad $account $reconcilerArn } catch { $rejected = $true }
  if (-not $rejected) { throw "The processor resource-policy guard accepted '$mutation' broadening." }
}
foreach ($forbidden in @(
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )) {
  if ($parser.ContainsKey($forbidden)) { throw "Parser-dark contains complete-only resource '$forbidden'." }
}

$source = "a" * 40
$processorSha = "b" * 64
$parserSha = "c" * 64
$receipt = [pscustomobject]@{
  artifacts = @(
    [pscustomobject]@{ artifactName = "document-processor-lambda"; suffix = "zip"; key = "lambda/documents/$source/$processorSha/document-processor-lambda.zip"; versionId = "v1"; artifactSha256 = $processorSha; objectBase64Sha256 = (("Z" * 43) + "=") },
    [pscustomobject]@{ artifactName = "document-parser-lambda"; suffix = "zip"; key = "lambda/documents/$source/$parserSha/document-parser-lambda.zip"; versionId = "v2"; artifactSha256 = $parserSha; objectBase64Sha256 = (("Y" * 43) + "=") }
  )
}
$baseline = [pscustomobject]@{
  document_processing_deployment_stage = [pscustomobject]@{ value = "kms-prerequisite" }
  document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "" }
  document_scan_mapping_enabled = [pscustomobject]@{ value = "false" }
  document_scan_event_rule_enabled = [pscustomobject]@{ value = "false" }
  document_security_health_rules_enabled = [pscustomobject]@{ value = "false" }
  document_processor_artifact_s3_key = [pscustomobject]@{ value = "" }
  document_processor_artifact_s3_object_version = [pscustomobject]@{ value = "" }
  document_processor_artifact_sha256 = [pscustomobject]@{ value = "" }
  document_processor_artifact_base64sha256 = [pscustomobject]@{ value = "" }
  document_parser_artifact_s3_key = [pscustomobject]@{ value = "" }
  document_parser_artifact_s3_object_version = [pscustomobject]@{ value = "" }
  document_parser_artifact_sha256 = [pscustomobject]@{ value = "" }
  document_parser_artifact_base64sha256 = [pscustomobject]@{ value = "" }
  document_processor_extension_layer_arn = [pscustomobject]@{ value = "" }
}
$parserVariables = $baseline | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$parserVariables.document_processing_deployment_stage.value = "parser-dark"
$parserVariables.document_security_health_rules_enabled.value = "true"
$parserVariables.document_parser_artifact_s3_key.value = $receipt.artifacts[1].key
$parserVariables.document_parser_artifact_s3_object_version.value = "v2"
$parserVariables.document_parser_artifact_sha256.value = $parserSha
$parserVariables.document_parser_artifact_base64sha256.value = (("Y" * 43) + "=")
Assert-DevelopmentDocumentDarkVariables $baseline $parserVariables $receipt "parser-dark"

$qualified = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:1"

$existingStatement = [pscustomobject]@{ Sid = "Existing"; Effect = "Allow"; Action = "kms:DescribeKey"; Resource = "*" }
$kmsStatements = @(
  [pscustomobject]@{
    Sid = "AllowEventBridgeDocumentScanQueueEncryption"; Effect = "Allow"
    Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = "*"
    Principal = [pscustomobject]@{ Service = "events.amazonaws.com" }
    Condition = [pscustomobject]@{
      StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account }
      ArnEquals = [pscustomobject]@{ "aws:SourceArn" = @(
          "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-scan-results",
          "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-processing-reconciler"
        ) }
    }
  },
  [pscustomobject]@{
    Sid = "AllowEventBridgeDocumentOperationalAlertEncryption"; Effect = "Allow"
    Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = "*"
    Principal = [pscustomobject]@{ Service = "events.amazonaws.com" }
    Condition = [pscustomobject]@{
      StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account }
      ArnEquals = [pscustomobject]@{ "aws:SourceArn" = @(
          "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-scan-tag-failure",
          "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
        ) }
    }
  }
)
$beforeKms = @{ Version = "2012-10-17"; Statement = @($existingStatement) } | ConvertTo-Json -Compress -Depth 20
$afterKms = @{ Version = "2012-10-17"; Statement = @($existingStatement) + $kmsStatements } | ConvertTo-Json -Compress -Depth 20
$kmsArn = "arn:aws:kms:us-east-2:${account}:key/00000000-0000-0000-0000-000000000001"
$kmsPlan = [pscustomobject]@{
  resource_drift = @([pscustomobject]@{
      address = "module.platform.aws_db_instance.postgres[0]"; mode = "managed"; type = "aws_db_instance"
      change = [pscustomobject]@{
        actions = @("update"); after_unknown = [pscustomobject]@{}; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
        before = [pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-12T22:13:52Z" }
        after = [pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T02:03:53Z" }
      }
    })
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{ resources = @(
        [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kmsArn } }
      ) } }
  resource_changes = @([pscustomobject]@{
      address = "module.platform.aws_kms_key.platform"; mode = "managed"; type = "aws_kms_key"
      change = [pscustomobject]@{
        actions = @("update"); before = [pscustomobject]@{ id = "key"; policy = $beforeKms }
        after = [pscustomobject]@{ id = "key"; policy = $afterKms }; after_unknown = [pscustomobject]@{}
        before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
      }
    })
}
$null = Assert-DevelopmentDocumentKmsPrerequisitePlan $kmsPlan $account

$lambdaTrust = @{ Version = "2012-10-17"; Statement = @(@{ Effect = "Allow"; Action = "sts:AssumeRole"; Principal = @{ Service = "lambda.amazonaws.com" } }) } | ConvertTo-Json -Compress -Depth 10
Assert-ExactDocumentTrustPolicy $lambdaTrust Lambda $account
$broadTrust = $lambdaTrust | ConvertFrom-Json
$broadTrust.Statement[0].Principal.Service = "ec2.amazonaws.com"
$rejected = $false
try { Assert-ExactDocumentTrustPolicy $broadTrust Lambda $account } catch { $rejected = $true }
if (-not $rejected) { throw "The parser trust guard accepted a non-Lambda principal." }

$completeVariables = $parserVariables | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$completeVariables.document_processing_deployment_stage.value = "complete-dark"
$completeVariables.document_parser_invocation_qualified_arn.value = $qualified
$completeVariables.document_processor_artifact_s3_key.value = $receipt.artifacts[0].key
$completeVariables.document_processor_artifact_s3_object_version.value = "v1"
$completeVariables.document_processor_artifact_sha256.value = $processorSha
$completeVariables.document_processor_artifact_base64sha256.value = (("Z" * 43) + "=")
$completeVariables.document_processor_extension_layer_arn.value = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
Assert-DevelopmentDocumentDarkVariables $baseline $completeVariables $receipt "complete-dark" $qualified

$badPin = $completeVariables | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$badPin.document_parser_invocation_qualified_arn.value = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:0"
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables $baseline $badPin $receipt "complete-dark" $badPin.document_parser_invocation_qualified_arn.value } catch { $rejected = $true }
if (-not $rejected) { throw "Complete-dark accepted a non-positive parser version."
}
$enabled = $completeVariables | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$enabled.document_scan_mapping_enabled.value = "true"
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables $baseline $enabled $receipt "complete-dark" $qualified } catch { $rejected = $true }
if (-not $rejected) { throw "Complete-dark variable guard accepted an enabled trigger." }

$unknownPlan = [pscustomobject]@{
  resource_drift = @([pscustomobject]@{
      address = "module.platform.aws_ecs_task_definition.migration[0]"; mode = "managed"; type = "aws_ecs_task_definition"
      change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{ tags = $null }; after = [pscustomobject]@{ tags = [pscustomobject]@{} }; after_unknown = [pscustomobject]@{} }
    })
  resource_changes = @([pscustomobject]@{
      address = "module.platform.aws_sqs_queue_policy.document_scan_results[0]"; mode = "managed"; type = "aws_sqs_queue_policy"
      change = [pscustomobject]@{ actions = @("create"); before = $null; after = [pscustomobject]@{ policy = $null; queue_url = $null }; after_unknown = [pscustomobject]@{ policy = $true; queue_url = $true } }
    })
}
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $unknownPlan $account "parser-dark" } catch { $rejected = $true }
if (-not $rejected) { throw "The plan guard accepted a partial plan with unknown security fields." }

function New-TestPolicy([object[]]$Statements) {
  return @{ Version = "2012-10-17"; Statement = $Statements } | ConvertTo-Json -Compress -Depth 40
}
function New-TestCreate([string]$Address, [hashtable]$Fields = @{}) {
  $after = [pscustomobject]$Fields
  return [pscustomobject]@{ address = $Address; mode = "managed"; type = ($Address -split '\.')[2]
    change = [pscustomobject]@{ actions = @("create"); before = $null; after = $after; after_unknown = [pscustomobject]@{} } }
}
function New-TestPolicyUpdate([string]$Address, [string]$Before, [string]$After) {
  return [pscustomobject]@{ address = $Address; mode = "managed"; type = ($Address -split '\.')[2]
    change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{ id = "same"; policy = $Before }
      after = [pscustomobject]@{ id = "same"; policy = $After }; after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} } }
}
$kmsNoop = [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; mode = "managed"; type = "aws_kms_key"
  change = [pscustomobject]@{ actions = @("no-op"); before = [pscustomobject]@{ arn = $kmsArn }; after = [pscustomobject]@{ arn = $kmsArn }
    after_unknown = [pscustomobject]@{}; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} } }
$bucketArn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-${account}"
$processorRole = "arn:aws:iam::${account}:role/ai-job-apply-development-document-processor"
$objectRole = "arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access"
$lambdaTrustPolicy = New-TestPolicy @(@{ Effect = "Allow"; Action = "sts:AssumeRole"; Principal = @{ Service = "lambda.amazonaws.com" } })
$objectTrustPolicy = New-TestPolicy @(@{ Effect = "Allow"; Action = "sts:AssumeRole"; Principal = @{ AWS = $processorRole } })
$parserPolicy = New-TestPolicy @(
  @{ Sid = "ManageVpcInterfaces"; Effect = "Allow"; Action = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); Resource = "*" },
  @{ Sid = "DecryptLambdaEnvironment"; Effect = "Allow"; Action = "kms:Decrypt"; Resource = $kmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "lambda.us-east-2.amazonaws.com" } } }
)
$objectPolicy = New-TestPolicy @(
  @{ Sid = "SessionPolicyMustNarrowObjectAccess"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObject"); Resource = @("$bucketArn/quarantine/*", "$bucketArn/normalized/*") },
  @{ Sid = "EncryptAndDecryptViaS3Only"; Effect = "Allow"; Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = $kmsArn; Condition = @{ StringEquals = @{ "kms:ViaService" = "s3.us-east-2.amazonaws.com" } } }
)
function New-TestS3EndpointPolicy([object]$Principal) {
  return New-TestPolicy @(
    @{ Sid = "ExactParserQuarantineReadsOnly"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging"); Resource = "$bucketArn/quarantine/*"; Principal = $Principal; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = $objectRole } } },
    @{ Sid = "ExactParserNormalizedWritesAndVerification"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"); Resource = "$bucketArn/normalized/*"; Principal = $Principal; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = $objectRole } } },
    @{ Sid = "ExactCoordinatorNormalizedReadsOnly"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$bucketArn/normalized/*"; Principal = $Principal; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = $processorRole } } }
  )
}
$s3EndpointPolicy = New-TestS3EndpointPolicy "*"
function New-TestQueuePolicy([string]$Sid, [string]$QueueName, [string[]]$RuleNames) {
  return New-TestPolicy @(@{ Sid = $Sid; Effect = "Allow"; Action = "sqs:SendMessage"; Resource = "arn:aws:sqs:us-east-2:${account}:$QueueName"
      Principal = @{ Service = "events.amazonaws.com" }; Condition = @{ StringEquals = @{ "aws:SourceAccount" = $account }
        ArnEquals = @{ "aws:SourceArn" = @($RuleNames | ForEach-Object { "arn:aws:events:us-east-2:${account}:rule/$_" }) } } })
}
$parserChanges = @()
foreach ($entry in $parser.GetEnumerator()) {
  if ($entry.Value -eq "update") { continue }
  $fields = @{}
  if ($entry.Key -like "*aws_cloudwatch_event_rule.document_*") {
    $fields.state = if ($entry.Key -like "*tag_failure*" -or $entry.Key -like "*plan_unhealthy*") { "ENABLED" } else { "DISABLED" }
  }
  switch ($entry.Key) {
    "module.platform.aws_iam_role.document_processor[0]" { $fields.assume_role_policy = $lambdaTrustPolicy }
    "module.platform.aws_iam_role.document_parser[0]" { $fields.assume_role_policy = $lambdaTrustPolicy }
    "module.platform.aws_iam_role.document_parser_object_access[0]" { $fields.assume_role_policy = $objectTrustPolicy }
    "module.platform.aws_iam_role_policy.document_parser[0]" { $fields.policy = $parserPolicy; $fields.role = "ai-job-apply-development-document-parser" }
    "module.platform.aws_iam_role_policy.document_parser_object_access[0]" { $fields.policy = $objectPolicy; $fields.role = "ai-job-apply-development-document-object-access" }
    "module.platform.aws_sqs_queue_policy.document_scan_results[0]" { $fields.policy = New-TestQueuePolicy "ExactGuardDutyResultRuleOnly" "ai-job-apply-development-document-scan-results" @("ai-job-apply-development-document-scan-results"); $fields.queue_url = "https://sqs.us-east-2.amazonaws.com/${account}/ai-job-apply-development-document-scan-results" }
    "module.platform.aws_sqs_queue_policy.document_scan_delivery_dead_letter[0]" { $fields.policy = New-TestQueuePolicy "ExactEventBridgeRuleDeadLettersOnly" "ai-job-apply-development-document-scan-delivery-dlq" @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure", "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler"); $fields.queue_url = "https://sqs.us-east-2.amazonaws.com/${account}/ai-job-apply-development-document-scan-delivery-dlq" }
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" { $fields.policy = $s3EndpointPolicy }
  }
  $parserChanges += New-TestCreate $entry.Key $fields
}
$transport = @{ Sid = "DenyInsecureTransport"; Effect = "Deny"; Action = "s3:*"; Resource = @($bucketArn, "$bucketArn/*") }
$malwareScanRole = "arn:aws:iam::${account}:role/ai-job-apply-development-document-malware-scan"
$candidateDeny = @{ Sid = "DenyQuarantineReadsWithoutCleanMalwareTag"; Effect = "Deny"; Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$bucketArn/quarantine/*"; Principal = "*"; Condition = @{ StringNotEquals = @{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "NO_THREATS_FOUND" }; ArnNotEquals = @{ "aws:PrincipalArn" = $malwareScanRole } } }
$snsBase = @{ Sid = "Existing"; Effect = "Allow"; Action = "sns:GetTopicAttributes"; Resource = "*" }
$snsAdded = @{ Sid = "AllowExactDocumentOperationalRules"; Effect = "Allow"; Action = "SNS:Publish"; Resource = "arn:aws:sns:us-east-2:${account}:ai-job-apply-development-operational-alerts"; Principal = @{ Service = "events.amazonaws.com" }; Condition = @{ StringEquals = @{ "aws:SourceAccount" = $account }; ArnEquals = @{ "aws:SourceArn" = @("arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-scan-tag-failure", "arn:aws:events:us-east-2:${account}:rule/ai-job-apply-development-document-scan-plan-unhealthy") } } }
$parserChanges += New-TestPolicyUpdate "module.platform.aws_s3_bucket_policy.candidate_documents[0]" (New-TestPolicy @($transport)) (New-TestPolicy @($transport, $candidateDeny))
$parserChanges += New-TestPolicyUpdate "module.platform.aws_sns_topic_policy.operational_alerts" (New-TestPolicy @($snsBase)) (New-TestPolicy @($snsBase, $snsAdded))
$validParserPlan = [pscustomobject]@{
  terraform_version = "1.9.8"; complete = $true; errored = $false; applyable = $true
  output_changes = [pscustomobject]@{}; resource_drift = $kmsPlan.resource_drift
  planned_values = $kmsPlan.planned_values; resource_changes = @($kmsNoop) + $parserChanges
}
$null = Assert-DevelopmentDocumentDarkPlan $validParserPlan $account parser-dark
foreach ($fixture in @(
    [pscustomobject]@{ Label = "AWS wildcard object"; Principal = @{ AWS = "*" } },
    [pscustomobject]@{ Label = "service wildcard object"; Principal = @{ Service = "*" } },
    [pscustomobject]@{ Label = "different scalar"; Principal = "arn:aws:iam::${account}:root" },
    [pscustomobject]@{ Label = "wildcard list"; Principal = [object[]]@("*") }
  )) {
  $badCandidatePlan = $validParserPlan | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $candidatePolicyChange = @($badCandidatePlan.resource_changes | Where-Object {
      [string]$_.address -ceq "module.platform.aws_s3_bucket_policy.candidate_documents[0]"
    })
  $candidatePolicy = $candidatePolicyChange[0].change.after.policy | ConvertFrom-Json
  $candidateStatement = @($candidatePolicy.Statement | Where-Object {
      [string]$_.Sid -ceq "DenyQuarantineReadsWithoutCleanMalwareTag"
    })
  $candidateStatement[0].Principal = $fixture.Principal
  $candidatePolicyChange[0].change.after.policy = $candidatePolicy | ConvertTo-Json -Compress -Depth 40
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $badCandidatePlan $account parser-dark } catch { $rejected = $true }
  if (-not $rejected) { throw "The candidate bucket guard accepted the $($fixture.Label) principal shape." }
}
foreach ($fixture in @(
    [pscustomobject]@{ Label = "retired role name"; Value = "arn:aws:iam::${account}:role/ai-job-apply-development-guardduty-malware" },
    [pscustomobject]@{ Label = "different role"; Value = "arn:aws:iam::${account}:role/ai-job-apply-development-document-parser" },
    [pscustomobject]@{ Label = "wildcard scalar"; Value = "*" },
    [pscustomobject]@{ Label = "singleton list"; Value = [object[]]@($malwareScanRole) },
    [pscustomobject]@{ Label = "multiple values"; Value = [object[]]@($malwareScanRole, "arn:aws:iam::${account}:role/other") },
    [pscustomobject]@{ Label = "object value"; Value = [pscustomobject]@{ AWS = $malwareScanRole } }
  )) {
  $badCandidateConditionPlan = $validParserPlan | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $candidatePolicyChange = @($badCandidateConditionPlan.resource_changes | Where-Object {
      [string]$_.address -ceq "module.platform.aws_s3_bucket_policy.candidate_documents[0]"
    })
  $candidatePolicy = $candidatePolicyChange[0].change.after.policy | ConvertFrom-Json
  $candidateStatement = @($candidatePolicy.Statement | Where-Object {
      [string]$_.Sid -ceq "DenyQuarantineReadsWithoutCleanMalwareTag"
    })
  $candidateStatement[0].Condition.ArnNotEquals."aws:PrincipalArn" = $fixture.Value
  $candidatePolicyChange[0].change.after.policy = $candidatePolicy | ConvertTo-Json -Compress -Depth 40
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $badCandidateConditionPlan $account parser-dark } catch { $rejected = $true }
  if (-not $rejected) { throw "The candidate bucket guard accepted the $($fixture.Label) ArnNotEquals value." }
}
$badCandidateVersionPlan = $validParserPlan | ConvertTo-Json -Depth 60 | ConvertFrom-Json
$candidateVersionChange = @($badCandidateVersionPlan.resource_changes | Where-Object {
    [string]$_.address -ceq "module.platform.aws_s3_bucket_policy.candidate_documents[0]"
  })
$candidateVersionBefore = $candidateVersionChange[0].change.before.policy | ConvertFrom-Json
$candidateVersionAfter = $candidateVersionChange[0].change.after.policy | ConvertFrom-Json
$candidateVersionBefore.Version = "2008-10-17"
$candidateVersionAfter.Version = "2008-10-17"
$candidateVersionChange[0].change.before.policy = $candidateVersionBefore | ConvertTo-Json -Compress -Depth 40
$candidateVersionChange[0].change.after.policy = $candidateVersionAfter | ConvertTo-Json -Compress -Depth 40
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $badCandidateVersionPlan $account parser-dark } catch { $rejected = $true }
if (-not $rejected) { throw "The candidate bucket guard accepted a non-standard policy version." }
foreach ($fixture in @(
    [pscustomobject]@{ Label = "AWS wildcard object"; Principal = @{ AWS = "*" } },
    [pscustomobject]@{ Label = "service wildcard object"; Principal = @{ Service = "*" } },
    [pscustomobject]@{ Label = "different scalar"; Principal = "arn:aws:iam::${account}:root" },
    [pscustomobject]@{ Label = "wildcard list"; Principal = [object[]]@("*", "arn:aws:iam::${account}:root") }
  )) {
  $badPrincipalPlan = $validParserPlan | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $endpointChange = @($badPrincipalPlan.resource_changes | Where-Object {
      [string]$_.address -ceq "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
    })
  $endpointChange[0].change.after.policy = New-TestS3EndpointPolicy $fixture.Principal
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $badPrincipalPlan $account parser-dark } catch { $rejected = $true }
  if (-not $rejected) { throw "The S3 endpoint guard accepted the $($fixture.Label) principal shape." }
}

$processorPolicy = New-TestPolicy @(
  @{ Sid = "WriteOwnedLogs"; Effect = "Allow"; Action = @("logs:CreateLogStream", "logs:PutLogEvents"); Resource = "arn:aws:logs:us-east-2:${account}:log-group:/ai-job-apply/development/application:*" },
  @{ Sid = "ManageVpcInterfaces"; Effect = "Allow"; Action = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); Resource = "*" },
  @{ Sid = "ReadDatabaseSecret"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = "arn:aws:secretsmanager:us-east-2:${account}:secret:ai-job-apply/development/database-url-x" },
  @{ Sid = "ConsumeExactScanQueue"; Effect = "Allow"; Action = @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"); Resource = "arn:aws:sqs:us-east-2:${account}:ai-job-apply-development-document-scan-results" },
  @{ Sid = "InvokeExactParserVersion"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $qualified },
  @{ Sid = "AssumeExactObjectAccessRole"; Effect = "Allow"; Action = "sts:AssumeRole"; Resource = $objectRole },
  @{ Sid = "ReadNormalizedDocumentsOnly"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$bucketArn/normalized/*" },
  @{ Sid = "DecryptOwnedRuntimeData"; Effect = "Allow"; Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = $kmsArn },
  @{ Sid = "WriteNativeTraces"; Effect = "Allow"; Action = @("xray:PutTelemetryRecords", "xray:PutTraceSegments"); Resource = "*" }
)
$stsPolicy = New-TestPolicy @(@{ Sid = "CoordinatorAssumesExactDocumentObjectRoleOnly"; Effect = "Allow"; Action = "sts:AssumeRole"; Resource = $objectRole; Principal = "*"; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = $processorRole } } })
$completeChanges = @()
foreach ($entry in $complete.GetEnumerator()) {
  if ($entry.Value -eq "update") { continue }
  $fields = @{}
  if ($entry.Key -like "*event_source_mapping*") { $fields.enabled = $false }
  if ($entry.Key -like "*iam_role_policy.document_processor*") { $fields.policy = $processorPolicy; $fields.role = "ai-job-apply-development-document-processor" }
  if ($entry.Key -like "*vpc_endpoint.sts*") { $fields.policy = $stsPolicy }
  $completeChanges += New-TestCreate $entry.Key $fields
}
$endpointBase = @{ Sid = "Existing"; Effect = "Allow"; Action = "service:Read"; Resource = "*" }
$sqsAdded = @{ Sid = "ExactDocumentProcessorQueueOnly"; Effect = "Allow"; Action = @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"); Resource = "arn:aws:sqs:us-east-2:${account}:ai-job-apply-development-document-scan-results"; Principal = @{ AWS = $processorRole } }
$lambdaAdded = @{ Sid = "CoordinatorInvokesExactParserVersionOnly"; Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = $qualified; Principal = @{ AWS = $processorRole } }
$secretBase = @{ Sid = "ExactLambdaRolesDatabaseSecretOnly"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = "arn:aws:secretsmanager:us-east-2:${account}:secret:ai-job-apply/development/database-url-x"; Principal = @{ AWS = "*" }; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = @("arn:aws:iam::${account}:role/existing") } } }
$secretAfter = $secretBase | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$secretAfter.Condition.ArnEquals."aws:PrincipalArn" = @("arn:aws:iam::${account}:role/existing", $processorRole)
$completeChanges += New-TestPolicyUpdate "module.platform.aws_vpc_endpoint.sqs[0]" (New-TestPolicy @($endpointBase)) (New-TestPolicy @($endpointBase, $sqsAdded))
$completeChanges += New-TestPolicyUpdate "module.platform.aws_vpc_endpoint.lambda[0]" (New-TestPolicy @($endpointBase)) (New-TestPolicy @($endpointBase, $lambdaAdded))
$completeChanges += New-TestPolicyUpdate "module.platform.aws_vpc_endpoint.secretsmanager[0]" (New-TestPolicy @($endpointBase, $secretBase)) (New-TestPolicy @($endpointBase, $secretAfter))
$validCompletePlan = [pscustomobject]@{
  terraform_version = "1.9.8"; complete = $true; errored = $false; applyable = $true
  output_changes = [pscustomobject]@{}; resource_drift = $kmsPlan.resource_drift
  planned_values = $kmsPlan.planned_values; resource_changes = @($kmsNoop) + $completeChanges
}
$null = Assert-DevelopmentDocumentDarkPlan $validCompletePlan $account complete-dark
foreach ($principalMutation in @("object", "list", "null", "other", "service", "extra")) {
  $badStsPlan = $validCompletePlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $stsChange = @($badStsPlan.resource_changes | Where-Object {
      [string]$_.address -ceq "module.platform.aws_vpc_endpoint.sts[0]"
    })[0]
  $badStsPolicy = $stsChange.change.after.policy | ConvertFrom-Json
  switch ($principalMutation) {
    "object" { $badStsPolicy.Statement[0].Principal = [pscustomobject]@{ AWS = "*" } }
    "list" { $badStsPolicy.Statement[0].Principal = @("*") }
    "null" { $badStsPolicy.Statement[0].Principal = $null }
    "other" { $badStsPolicy.Statement[0].Principal = "arn:aws:iam::${account}:root" }
    "service" { $badStsPolicy.Statement[0].Principal = [pscustomobject]@{ Service = "sts.amazonaws.com" } }
    "extra" { $badStsPolicy.Statement[0].Principal = [pscustomobject]@{ AWS = "*"; Service = "sts.amazonaws.com" } }
  }
  $stsChange.change.after.policy = $badStsPolicy | ConvertTo-Json -Compress -Depth 40
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $badStsPlan $account complete-dark }
  catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark STS policy accepted '$principalMutation' principal tampering." }
}

$currentSource = "d" * 40
$currentParserSha = "e" * 64
$currentReceipt = [pscustomobject]@{ artifacts = @(
    [pscustomobject]@{ artifactName = "document-processor-lambda"; suffix = "zip"; key = "lambda/documents/$currentSource/$('f' * 64)/document-processor-lambda.zip"; versionId = "current-processor"; artifactSha256 = "f" * 64; objectBase64Sha256 = (("W" * 43) + "=") },
    [pscustomobject]@{ artifactName = "document-parser-lambda"; suffix = "zip"; key = "lambda/documents/$currentSource/$currentParserSha/document-parser-lambda.zip"; versionId = "current-parser"; artifactSha256 = $currentParserSha; objectBase64Sha256 = (("X" * 43) + "=") }
  ) }
$parserFunctionBefore = [pscustomobject]@{
  function_name = "ai-job-apply-development-document-parser"; description = "Isolated no-DB/no-internet bounded PDF and DOCX parser"
  runtime = "nodejs24.x"; handler = "index.handler"; timeout = 45; memory_size = 1536
  s3_key = $receipt.artifacts[1].key; s3_object_version = $receipt.artifacts[1].versionId
  source_code_hash = $receipt.artifacts[1].objectBase64Sha256; code_sha256 = $receipt.artifacts[1].objectBase64Sha256
  arn = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser"
  invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser/invocations"
  qualified_arn = $qualified; qualified_invoke_arn = "$qualified`:invoke"; version = "1"; last_modified = "old"
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{
        NODE_ENV = "production"; RELEASE_SHA = $parserSha; DOCUMENT_PARSER_VERSION = "resume-parser-v1"
      } })
}
$parserFunctionAfter = $parserFunctionBefore | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$parserFunctionAfter.s3_key = $currentReceipt.artifacts[1].key
$parserFunctionAfter.s3_object_version = $currentReceipt.artifacts[1].versionId
$parserFunctionAfter.source_code_hash = $currentReceipt.artifacts[1].objectBase64Sha256
$parserFunctionAfter.environment[0].variables.RELEASE_SHA = $currentParserSha
$parserFunctionAfter.code_sha256 = $parserFunctionBefore.code_sha256; $parserFunctionAfter.qualified_arn = $null
$parserFunctionAfter.qualified_invoke_arn = $null; $parserFunctionAfter.version = $null; $parserFunctionAfter.last_modified = $null
$parserFunctionTransition = [pscustomobject]@{
  address = "module.platform.aws_lambda_function.document_parser[0]"; mode = "managed"; type = "aws_lambda_function"
  change = [pscustomobject]@{
    actions = @("update"); before = $parserFunctionBefore; after = $parserFunctionAfter
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
    after_unknown = [pscustomobject][ordered]@{
      architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
      environment = @([pscustomobject]@{ variables = [pscustomobject]@{} }); ephemeral_storage = @([pscustomobject]@{})
      file_system_config = @(); image_config = @(); last_modified = $true; layers = @()
      logging_config = @([pscustomobject]@{}); qualified_arn = $true; qualified_invoke_arn = $true
      snap_start = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{}; tenancy_config = @()
      tracing_config = @([pscustomobject]@{}); version = $true
      vpc_config = @([pscustomobject]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
    }
  }
}
$parserAliasBefore = [pscustomobject]@{
  name = "development"; description = "Reviewed immutable development document parser release"
  function_name = "ai-job-apply-development-document-parser"; function_version = "1"
  arn = "old-alias-arn"; invoke_arn = "old-alias-invoke"; routing_config = @()
}
$parserAliasAfter = $parserAliasBefore | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$parserAliasAfter.function_version = $null
$parserAliasTransition = [pscustomobject]@{
  address = "module.platform.aws_lambda_alias.document_parser[0]"; mode = "managed"; type = "aws_lambda_alias"
  change = [pscustomobject]@{
    actions = @("update"); before = $parserAliasBefore; after = $parserAliasAfter
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
    after_unknown = [pscustomobject]@{ function_version = $true; routing_config = @() }
  }
}
$newParserQualifiedArn = $qualified -replace ':1$', ':2'
$processorFunctionBefore = $parserFunctionBefore | ConvertTo-Json -Depth 40 | ConvertFrom-Json
$processorFunctionBefore.function_name = "ai-job-apply-development-document-processor"
$processorFunctionBefore.s3_key = $completeVariables.document_processor_artifact_s3_key.value
$processorFunctionBefore.s3_object_version = $completeVariables.document_processor_artifact_s3_object_version.value
$processorFunctionBefore.source_code_hash = $completeVariables.document_processor_artifact_base64sha256.value
$processorFunctionBefore.code_sha256 = $completeVariables.document_processor_artifact_base64sha256.value
$processorFunctionBefore.environment[0].variables.RELEASE_SHA = $completeVariables.document_processor_artifact_sha256.value
$processorFunctionBefore.environment[0].variables | Add-Member DOCUMENT_PARSER_FUNCTION_ARN $qualified
$processorFunctionAfter = $processorFunctionBefore | ConvertTo-Json -Depth 40 | ConvertFrom-Json
$processorFunctionAfter.s3_key = $currentReceipt.artifacts[0].key
$processorFunctionAfter.s3_object_version = $currentReceipt.artifacts[0].versionId
$processorFunctionAfter.source_code_hash = $currentReceipt.artifacts[0].objectBase64Sha256
$processorFunctionAfter.environment[0].variables.RELEASE_SHA = $currentReceipt.artifacts[0].artifactSha256
$processorFunctionAfter.environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN = $newParserQualifiedArn
$processorFunctionAfter.qualified_arn = $null; $processorFunctionAfter.qualified_invoke_arn = $null
$processorFunctionAfter.version = $null; $processorFunctionAfter.last_modified = $null
$processorFunctionRefresh = [pscustomobject]@{
  address = "module.platform.aws_lambda_function.document_processor[0]"; mode = "managed"; type = "aws_lambda_function"
  change = [pscustomobject]@{
    actions = @("update"); before = $processorFunctionBefore; after = $processorFunctionAfter
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
    after_unknown = [pscustomobject][ordered]@{
      architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
      environment = @([pscustomobject]@{ variables = [pscustomobject]@{} }); ephemeral_storage = @([pscustomobject]@{})
      file_system_config = @(); image_config = @(); last_modified = $true; layers = @($false)
      logging_config = @([pscustomobject]@{}); qualified_arn = $true; qualified_invoke_arn = $true
      snap_start = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{}; tenancy_config = @()
      tracing_config = @([pscustomobject]@{}); version = $true
      vpc_config = @([pscustomobject]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
    }
  }
}
$processorAliasBefore = $parserAliasBefore | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$processorAliasBefore.function_name = "ai-job-apply-development-document-processor"
$processorAliasAfter = $processorAliasBefore | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$processorAliasAfter.function_version = $null
$processorAliasRefresh = [pscustomobject]@{
  address = "module.platform.aws_lambda_alias.document_processor[0]"; mode = "managed"; type = "aws_lambda_alias"
  change = [pscustomobject]@{ actions = @("update"); before = $processorAliasBefore; after = $processorAliasAfter
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
    after_unknown = [pscustomobject]@{ function_version = $true; routing_config = @() } }
}
$processorPolicyBefore = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{
      Sid = "CoordinatorInvokesExactParserVersionOnly"; Effect = "Allow"; Action = "lambda:InvokeFunction"
      Resource = $qualified
    }) }
$processorPolicyAfter = $processorPolicyBefore | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$processorPolicyAfter.Statement[0].Resource = $newParserQualifiedArn
$processorPolicyRefresh = [pscustomobject]@{
  address = "module.platform.aws_iam_role_policy.document_processor[0]"; mode = "managed"; type = "aws_iam_role_policy"
  change = [pscustomobject]@{ actions = @("update")
    before = [pscustomobject]@{ policy = ($processorPolicyBefore | ConvertTo-Json -Compress -Depth 20) }
    after = [pscustomobject]@{ policy = ($processorPolicyAfter | ConvertTo-Json -Compress -Depth 20) }
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}; after_unknown = [pscustomobject]@{} }
}
$processorRefreshChanges = @($processorFunctionRefresh, $processorAliasRefresh, $processorPolicyRefresh)
Assert-ExactDocumentProcessorRefresh -Changes $processorRefreshChanges -BaselineVariables $completeVariables `
  -Receipt $currentReceipt -ParserQualifiedArn $newParserQualifiedArn -AccountId $account
foreach ($pinMutation in @("environment", "policy", "extra")) {
  $badProcessorRefresh = $processorRefreshChanges | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($pinMutation) {
    "environment" { $badProcessorRefresh[0].change.after.environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN = $qualified }
    "policy" {
      $badPolicy = $badProcessorRefresh[2].change.after.policy | ConvertFrom-Json
      $badPolicy.Statement[0].Resource = $qualified
      $badProcessorRefresh[2].change.after.policy = $badPolicy | ConvertTo-Json -Compress -Depth 20
    }
    "extra" { $badProcessorRefresh += $parserAliasTransition }
  }
  $rejected = $false
  try { Assert-ExactDocumentProcessorRefresh $badProcessorRefresh $completeVariables $currentReceipt $newParserQualifiedArn $account }
  catch { $rejected = $true }
  if (-not $rejected) { throw "The processor refresh accepted '$pinMutation' parser-pin tampering." }
}
function New-TestCompleteDarkSourceTransitionOutputs([string]$ParserQualifiedArn) {
  $outputs = [ordered]@{}
  foreach ($name in @(
      "alert_delivery_canary_alarm_name", "application_security_group_id", "artifact_bucket",
      "candidate_document_bucket", "candidate_document_malware_protection_plan_id", "cost_export_arn",
      "cost_export_bucket", "document_scan_event_rule_arn", "ecs_cluster_arn", "gateway_lambda_alias_arn",
      "gateway_lambda_authorizer_id", "gateway_lambda_function_name", "gateway_url", "migration_repository_url",
      "migration_subnet_ids", "migration_task_definition_arn", "monthly_budget_name",
      "observability_dashboard_name", "operational_alert_topic_arn", "outbox_reconciler_alias_arn",
      "outbox_reconciler_rule_arn", "outbox_starter_alias_arn", "outbox_starter_event_source_mapping_uuid",
      "profile_readiness_activity_alias_arn", "profile_readiness_durable_alias_arn",
      "profile_readiness_durable_version_arn", "profile_readiness_terminal_alias_arn",
      "profile_readiness_terminal_rule_arn", "vpc_id"
    )) {
    $outputs[$name] = [pscustomobject][ordered]@{
      actions = @("no-op"); before = "known-$name"; after = "known-$name"; after_unknown = $false
      before_sensitive = $false; after_sensitive = $false
    }
  }
  $outputs.document_parser_version_arn = [pscustomobject][ordered]@{
    actions = @("update"); before = $ParserQualifiedArn; after_unknown = $true
    before_sensitive = $false; after_sensitive = $false
  }
  foreach ($name in @("document_processor_alias_arn", "document_scan_event_source_mapping_uuid")) {
    $outputs[$name] = [pscustomobject][ordered]@{
      actions = @("create"); before = $null; after_unknown = $true
      before_sensitive = $false; after_sensitive = $false
    }
  }
  return [pscustomobject]$outputs
}
$parserRefreshOutputs = New-TestCompleteDarkSourceTransitionOutputs $qualified
foreach ($name in @("document_processor_alias_arn", "document_scan_event_source_mapping_uuid")) {
  $parserRefreshOutputs.$name = [pscustomobject][ordered]@{
    actions = @("no-op"); before = "known-$name"; after = "known-$name"; after_unknown = $false
    before_sensitive = $false; after_sensitive = $false
  }
}
Assert-DevelopmentDocumentCompleteDarkParserRefreshOutputs $parserRefreshOutputs $qualified
$badParserRefreshOutputs = $parserRefreshOutputs | ConvertTo-Json -Depth 50 | ConvertFrom-Json
$badParserRefreshOutputs.document_processor_alias_arn.actions = @("update")
$rejected = $false
try { Assert-DevelopmentDocumentCompleteDarkParserRefreshOutputs $badParserRefreshOutputs $qualified }
catch { $rejected = $true }
if (-not $rejected) { throw "The parser refresh output guard accepted a meaningful processor output." }
$validTransitionPlan = $validCompletePlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$validTransitionPlan.resource_changes = @($validTransitionPlan.resource_changes) + @($parserFunctionTransition, $parserAliasTransition)
$validTransitionPlan.output_changes = New-TestCompleteDarkSourceTransitionOutputs $qualified
$null = Assert-DevelopmentDocumentDarkPlan $validTransitionPlan $account complete-dark `
  -ParserSourceTransition -BaselineVariables $parserVariables -Receipt $currentReceipt -ParserQualifiedArn $qualified
foreach ($replacePathsCase in @(
    [pscustomobject]@{ Label = "null"; Value = $null },
    [pscustomobject]@{ Label = "empty"; Value = @() }
  )) {
  $replacePathsPlan = $validTransitionPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  foreach ($address in @(
      "module.platform.aws_lambda_function.document_parser[0]",
      "module.platform.aws_lambda_alias.document_parser[0]"
    )) {
    $replacePathsChange = @($replacePathsPlan.resource_changes | Where-Object address -eq $address)[0]
    $replacePathsChange.change | Add-Member -NotePropertyName replace_paths -NotePropertyValue $replacePathsCase.Value
  }
  $null = Assert-DevelopmentDocumentDarkPlan $replacePathsPlan $account complete-dark `
    -ParserSourceTransition -BaselineVariables $parserVariables -Receipt $currentReceipt -ParserQualifiedArn $qualified
}

foreach ($mutation in @(
    "artifact", "stable-field", "known-code", "unknown", "unknown-false", "unknown-missing",
    "unknown-extra-false", "unknown-false-to-true", "unknown-nested", "unknown-security", "code-unknown",
    "alias-unknown-false", "alias-unknown-missing", "alias-unknown-arn", "alias-unknown-nested", "alias-known-arn", "replacement",
    "alias-routing", "pin", "output", "sensitivity"
  )) {
  $badTransition = $validTransitionPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $badFunction = @($badTransition.resource_changes | Where-Object address -eq "module.platform.aws_lambda_function.document_parser[0]")[0]
  $badAlias = @($badTransition.resource_changes | Where-Object address -eq "module.platform.aws_lambda_alias.document_parser[0]")[0]
  switch ($mutation) {
    "artifact" { $badFunction.change.after.s3_key = "lambda/documents/$currentSource/$currentParserSha/wrong.zip" }
    "stable-field" { $badFunction.change.after.timeout = 46 }
    "known-code" { $badFunction.change.after.code_sha256 = $null }
    "unknown" { $badFunction.change.after_unknown | Add-Member role $true }
    "unknown-false" { $badFunction.change.after_unknown.version = $false }
    "unknown-missing" { $badFunction.change.after_unknown.PSObject.Properties.Remove("last_modified") }
    "unknown-extra-false" { $badFunction.change.after_unknown | Add-Member extra_scaffolding @() }
    "unknown-false-to-true" { $badFunction.change.after_unknown.architectures[0] = $true }
    "unknown-nested" { $badFunction.change.after_unknown.environment[0].variables | Add-Member SECRET $true }
    "unknown-security" { $badFunction.change.after_unknown | Add-Member kms_key_arn $true }
    "code-unknown" { $badFunction.change.after_unknown | Add-Member code_sha256 $true }
    "alias-unknown-false" { $badAlias.change.after_unknown.function_version = $false }
    "alias-unknown-missing" { $badAlias.change.after_unknown.PSObject.Properties.Remove("function_version") }
    "alias-unknown-arn" { $badAlias.change.after_unknown | Add-Member arn $true }
    "alias-unknown-nested" { $badAlias.change.after_unknown.routing_config = @([pscustomobject]@{ additional_version_weights = $true }) }
    "alias-known-arn" { $badAlias.change.after.arn = "" }
    "replacement" { $badFunction.change | Add-Member replace_paths @(@("s3_key")) }
    "alias-routing" { $badAlias.change.after.routing_config = @([pscustomobject]@{ additional_version_weights = @{ "6" = 0.1 } }) }
    "pin" { $badAlias.change.before.function_version = "2" }
    "output" { $badTransition.output_changes = [pscustomobject]@{ parser = [pscustomobject]@{ actions = @("update") } } }
    "sensitivity" { $badFunction.change.after_sensitive = [pscustomobject]@{ environment = $true } }
  }
  $rejected = $false
  try {
    $null = Assert-DevelopmentDocumentDarkPlan $badTransition $account complete-dark `
      -ParserSourceTransition -BaselineVariables $parserVariables -Receipt $currentReceipt -ParserQualifiedArn $qualified
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark parser source-transition guard accepted '$mutation' tampering." }
}
$explicitNullOutputsPlan = $validTransitionPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
foreach ($name in @(
    "document_parser_version_arn", "document_processor_alias_arn", "document_scan_event_source_mapping_uuid"
  )) {
  $explicitNullOutputsPlan.output_changes.$name | Add-Member -NotePropertyName after -NotePropertyValue $null
}
$null = Assert-DevelopmentDocumentDarkPlan $explicitNullOutputsPlan $account complete-dark `
  -ParserSourceTransition -BaselineVariables $parserVariables -Receipt $currentReceipt -ParserQualifiedArn $qualified

foreach ($outputMutation in @(
    "missing-transition", "missing-noop", "extra", "parser-action", "create-action", "parser-before",
    "create-before", "known-after", "unknown-false", "before-sensitive", "after-sensitive",
    "noop-action", "noop-value", "noop-unknown", "noop-sensitive", "noop-missing-field", "noop-extra-field",
    "transition-extra-field"
  )) {
  $badOutputPlan = $validTransitionPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $parserOutput = $badOutputPlan.output_changes.document_parser_version_arn
  $processorOutput = $badOutputPlan.output_changes.document_processor_alias_arn
  $noOpOutput = $badOutputPlan.output_changes.artifact_bucket
  switch ($outputMutation) {
    "missing-transition" { $badOutputPlan.output_changes.PSObject.Properties.Remove("document_processor_alias_arn") }
    "missing-noop" { $badOutputPlan.output_changes.PSObject.Properties.Remove("artifact_bucket") }
    "extra" { $badOutputPlan.output_changes | Add-Member unexpected_output ([pscustomobject]@{ actions = @("no-op") }) }
    "parser-action" { $parserOutput.actions = @("create") }
    "create-action" { $processorOutput.actions = @("update") }
    "parser-before" { $parserOutput.before = $qualified -replace ':1$', ':2' }
    "create-before" { $processorOutput.before = "not-null" }
    "known-after" { $processorOutput | Add-Member after "known" }
    "unknown-false" { $processorOutput.after_unknown = $false }
    "before-sensitive" { $processorOutput.before_sensitive = $true }
    "after-sensitive" { $processorOutput.after_sensitive = $true }
    "noop-action" { $noOpOutput.actions = @("update") }
    "noop-value" { $noOpOutput.after = "changed" }
    "noop-unknown" { $noOpOutput.after_unknown = $true }
    "noop-sensitive" { $noOpOutput.after_sensitive = $true }
    "noop-missing-field" { $noOpOutput.PSObject.Properties.Remove("after_unknown") }
    "noop-extra-field" { $noOpOutput | Add-Member unexpected $false }
    "transition-extra-field" { $processorOutput | Add-Member unexpected $false }
  }
  $rejected = $false
  try {
    $null = Assert-DevelopmentDocumentDarkPlan $badOutputPlan $account complete-dark `
      -ParserSourceTransition -BaselineVariables $parserVariables -Receipt $currentReceipt -ParserQualifiedArn $qualified
  } catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark output guard accepted '$outputMutation' tampering." }
}
$diagnosticRoot = Join-Path $repositoryRoot `
  "infrastructure\terraform\environments\development\.terraform\development-document-dark-deployment"
$diagnosticPlanPath = Join-Path $diagnosticRoot "diagnostic-complete-dark-output-e56.tfplan"
$diagnosticShowPath = Join-Path $diagnosticRoot "diagnostic-complete-dark-output-e56-327f4ca835b8.show.json"
$diagnosticPlanPresent = Test-Path -LiteralPath $diagnosticPlanPath -PathType Leaf
$diagnosticShowPresent = Test-Path -LiteralPath $diagnosticShowPath -PathType Leaf
if ($diagnosticPlanPresent -xor $diagnosticShowPresent) {
  throw "The frozen CompleteDark diagnostic plan/show pair is incomplete."
}
if ($diagnosticPlanPresent) {
  if ((Get-FileHash -LiteralPath $diagnosticPlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      "327f4ca835b8cc3155ea4ffae8715f0ed7ffbabfecbc2632a821529e7e9cb2a4" -or
    (Get-FileHash -LiteralPath $diagnosticShowPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      "9c3bb8f7d3f198007d131c3fb90315573f236f2bd06fb69ab1022103b7ee59a5") {
    throw "The frozen CompleteDark diagnostic bytes changed before semantic acceptance."
  }
  $diagnosticPlan = Get-Content -LiteralPath $diagnosticShowPath -Raw | ConvertFrom-Json
  $diagnosticFunction = @($diagnosticPlan.resource_changes | Where-Object {
      [string]$_.address -ceq "module.platform.aws_lambda_function.document_parser[0]"
    })[0]
  $diagnosticBaselineVariables = [pscustomobject]@{
    document_parser_artifact_s3_key = [pscustomobject]@{ value = [string]$diagnosticFunction.change.before.s3_key }
    document_parser_artifact_s3_object_version = [pscustomobject]@{ value = [string]$diagnosticFunction.change.before.s3_object_version }
    document_parser_artifact_sha256 = [pscustomobject]@{ value = [string]$diagnosticFunction.change.before.environment[0].variables.RELEASE_SHA }
    document_parser_artifact_base64sha256 = [pscustomobject]@{ value = [string]$diagnosticFunction.change.before.source_code_hash }
  }
  $diagnosticReceipt = [pscustomobject]@{ artifacts = @([pscustomobject]@{
        artifactName = "document-parser-lambda"; suffix = "zip"
        key = [string]$diagnosticFunction.change.after.s3_key
        versionId = [string]$diagnosticFunction.change.after.s3_object_version
        artifactSha256 = [string]$diagnosticFunction.change.after.environment[0].variables.RELEASE_SHA
        objectBase64Sha256 = [string]$diagnosticFunction.change.after.source_code_hash
      }) }
  $diagnosticPin = [string]$diagnosticFunction.change.before.qualified_arn
  $diagnosticChanges = @(Assert-DevelopmentDocumentDarkPlan $diagnosticPlan "362544434697" complete-dark `
      -ParserSourceTransition -BaselineVariables $diagnosticBaselineVariables `
      -Receipt $diagnosticReceipt -ParserQualifiedArn $diagnosticPin)
  if ($diagnosticPin -cne "arn:aws:lambda:us-east-2:362544434697:function:ai-job-apply-development-document-parser:1" -or
    $diagnosticChanges.Count -ne 12 -or
    @($diagnosticChanges | Where-Object { (@($_.change.actions) -join ",") -ceq "create" }).Count -ne 7 -or
    @($diagnosticChanges | Where-Object { (@($_.change.actions) -join ",") -ceq "update" }).Count -ne 5) {
    throw "The frozen CompleteDark diagnostic did not retain its exact pin and 7-create/5-update boundary."
  }
}
$transitionWithoutModeRejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $validTransitionPlan $account complete-dark }
catch { $transitionWithoutModeRejected = $true }
if (-not $transitionWithoutModeRejected) { throw "Parser updates were accepted without the explicit CompleteDark source-transition mode." }
$wrongStageTransitionRejected = $false
try { $null = Get-DevelopmentDocumentStageExpectedActions parser-dark -ParserSourceTransition }
catch { $wrongStageTransitionRejected = $true }
if (-not $wrongStageTransitionRejected) { throw "Parser source transition was accepted outside CompleteDark." }

$retainedBaselinePlan = [pscustomobject]@{
  complete = $true
  applyable = $false
  errored = $false
  terraform_version = "1.9.8"
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = "example" } }
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
  output_changes = [pscustomobject]@{}
}
Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $retainedBaselinePlan

function New-DriftRecord([string]$Address, [string]$Type, [object]$Before, [object]$After,
  [object]$BeforeSensitive = ([pscustomobject]@{}), [object]$AfterSensitive = ([pscustomobject]@{})) {
  return [pscustomobject]@{
    address = $Address; mode = "managed"; type = $Type
    change = [pscustomobject]@{
      actions = @("update"); before = $Before; after = $After; after_unknown = [pscustomobject]@{}
      before_sensitive = $BeforeSensitive; after_sensitive = $AfterSensitive; replace_paths = @()
    }
  }
}
function New-TagDriftRecord([string]$Address, [string]$Type) {
  return New-DriftRecord $Address $Type `
    ([pscustomobject]@{ id = $Address; tags = $null }) `
    ([pscustomobject]@{ id = $Address; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}

$driftRecords = @()
foreach ($address in @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]"
  )) { $driftRecords += New-TagDriftRecord $address "aws_cloudwatch_event_rule" }
foreach ($address in @(
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_security_contradiction[0]"
  )) {
  $driftRecords += New-DriftRecord $address "aws_cloudwatch_log_metric_filter" `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = $null }) }) `
    ([pscustomobject]@{ id = $address; metric_transformation = @([pscustomobject]@{ name = "metric"; dimensions = [pscustomobject]@{} }) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{}) }) `
    ([pscustomobject]@{ metric_transformation = @([pscustomobject]@{ dimensions = [pscustomobject]@{} }) })
}
$dimensionAlarmNames = @("document_processing_record_failed", "document_processing_timed_out", "document_security_contradiction")
foreach ($name in @(
    "document_parser_errors", "document_processing_record_failed", "document_processing_timed_out",
    "document_processor_errors", "document_scan_dead_letter", "document_scan_delivery_dead_letter",
    "document_scan_queue_age", "document_security_contradiction"
  )) {
  $address = "module.platform.aws_cloudwatch_metric_alarm.$name[0]"
  $beforeAlarm = [ordered]@{ id = $address; insufficient_data_actions = $null; tags = $null }
  $afterAlarm = [ordered]@{ id = $address; insufficient_data_actions = @(); tags = [pscustomobject]@{} }
  $beforeAlarmSensitive = [ordered]@{ tags_all = [pscustomobject]@{} }
  $afterAlarmSensitive = [ordered]@{ insufficient_data_actions = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }
  if ($name -cin $dimensionAlarmNames) {
    $beforeAlarm.dimensions = $null; $afterAlarm.dimensions = [pscustomobject]@{}
    $afterAlarmSensitive.dimensions = [pscustomobject]@{}
  } else {
    $beforeAlarm.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $afterAlarm.dimensions = [pscustomobject]@{ FunctionName = "unchanged" }
    $beforeAlarmSensitive.dimensions = [pscustomobject]@{}
    $afterAlarmSensitive.dimensions = [pscustomobject]@{}
  }
  $driftRecords += New-DriftRecord $address "aws_cloudwatch_metric_alarm" `
    ([pscustomobject]$beforeAlarm) ([pscustomobject]$afterAlarm) `
    ([pscustomobject]$beforeAlarmSensitive) ([pscustomobject]$afterAlarmSensitive)
}
$driftRecords += New-DriftRecord "module.platform.aws_db_instance.postgres[0]" "aws_db_instance" `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:00Z" }) `
  ([pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T12:00:01Z" })

$parserInline = @([pscustomobject]@{ name = "document-parser-runtime"; policy = $parserPolicy })
$objectInline = @([pscustomobject]@{ name = "document-object-access-runtime"; policy = $objectPolicy })
foreach ($role in @(
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser[0]"; Inline = $parserInline },
    [pscustomobject]@{ Address = "module.platform.aws_iam_role.document_parser_object_access[0]"; Inline = $objectInline }
  )) {
  $driftRecords += New-DriftRecord $role.Address "aws_iam_role" `
    ([pscustomobject]@{ id = $role.Address; inline_policy = @(); tags = $null }) `
    ([pscustomobject]@{ id = $role.Address; inline_policy = $role.Inline; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @(); managed_policy_arns = @(); tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ inline_policy = @([pscustomobject]@{}); managed_policy_arns = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$driftRecords += New-TagDriftRecord "module.platform.aws_iam_role.document_processor[0]" "aws_iam_role"
$driftRecords += New-DriftRecord "module.platform.aws_lambda_function.document_parser[0]" "aws_lambda_function" `
  ([pscustomobject]@{ id = "parser"; layers = $null; tags = $null }) `
  ([pscustomobject]@{ id = "parser"; layers = @(); tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ layers = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })

$s3BaseStatements = @(
  [pscustomobject]@{ Sid = "DenyInsecureTransport"; Effect = "Deny" },
  [pscustomobject]@{ Sid = "DenyWrongEncryptionMode"; Effect = "Deny" },
  [pscustomobject]@{ Sid = "DenyWrongEncryptionKey"; Effect = "Deny" }
)
$s3DriftBefore = New-TestPolicy $s3BaseStatements
$s3DriftAfter = New-TestPolicy @($s3BaseStatements + $candidateDeny)
$driftRecords += New-DriftRecord "module.platform.aws_s3_bucket.candidate_documents[0]" "aws_s3_bucket" `
  ([pscustomobject]@{ id = "candidate"; policy = $s3DriftBefore }) `
  ([pscustomobject]@{ id = "candidate"; policy = $s3DriftAfter })
$driftRecords += New-TagDriftRecord "module.platform.aws_security_group.document_parser[0]" "aws_security_group"
$snsBaseStatements = @(
  [pscustomobject]@{ Sid = "AllowAccountAdministration"; Effect = "Allow" },
  [pscustomobject]@{ Sid = "AllowCloudWatchAlarmPublishing"; Effect = "Allow" },
  [pscustomobject]@{ Sid = "AllowAwsBudgetsPublishing"; Effect = "Allow" }
)
$snsDriftBefore = New-TestPolicy $snsBaseStatements
$snsDriftAfter = New-TestPolicy @($snsBaseStatements + $snsAdded)
$driftRecords += New-DriftRecord "module.platform.aws_sns_topic.operational_alerts" "aws_sns_topic" `
  ([pscustomobject]@{ id = "alerts"; policy = $snsDriftBefore }) `
  ([pscustomobject]@{ id = "alerts"; policy = $snsDriftAfter })

$deliveryQueuePolicy = New-TestQueuePolicy "ExactEventBridgeRuleDeadLettersOnly" `
  "ai-job-apply-development-document-scan-delivery-dlq" `
  @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure", "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler")
$resultQueuePolicy = New-TestQueuePolicy "ExactGuardDutyResultRuleOnly" `
  "ai-job-apply-development-document-scan-results" @("ai-job-apply-development-document-scan-results")
$driftRecords += New-TagDriftRecord "module.platform.aws_sqs_queue.document_scan_dead_letter[0]" "aws_sqs_queue"
foreach ($queue in @(
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; Policy = $deliveryQueuePolicy },
    [pscustomobject]@{ Address = "module.platform.aws_sqs_queue.document_scan_results[0]"; Policy = $resultQueuePolicy }
  )) {
  $driftRecords += New-DriftRecord $queue.Address "aws_sqs_queue" `
    ([pscustomobject]@{ id = $queue.Address; policy = ""; tags = $null }) `
    ([pscustomobject]@{ id = $queue.Address; policy = $queue.Policy; tags = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
    ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
}
$driftRecords += New-TagDriftRecord "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" "aws_vpc_endpoint"
if ($driftRecords.Count -ne 27) { throw "The full provider-normalization fixture does not contain exactly 27 unique records." }

$plannedDriftResources = @(
  [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kmsArn } },
  [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser[0]"; values = [pscustomobject]@{ inline_policy = $parserInline } },
  [pscustomobject]@{ address = "module.platform.aws_iam_role.document_parser_object_access[0]"; values = [pscustomobject]@{ inline_policy = $objectInline } },
  [pscustomobject]@{ address = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; values = [pscustomobject]@{ policy = $s3DriftAfter } },
  [pscustomobject]@{ address = "module.platform.aws_sns_topic_policy.operational_alerts"; values = [pscustomobject]@{ policy = $snsDriftAfter } },
  [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]"; values = [pscustomobject]@{ policy = $deliveryQueuePolicy } },
  [pscustomobject]@{ address = "module.platform.aws_sqs_queue.document_scan_results[0]"; values = [pscustomobject]@{ policy = $resultQueuePolicy } }
)
$plannedDriftRoot = [pscustomobject]@{ resources = $plannedDriftResources }
Assert-DevelopmentDocumentAcceptedResourceDrift -Records $driftRecords -RootModule $plannedDriftRoot
foreach ($record in $driftRecords) {
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($record) -RootModule $plannedDriftRoot
}
$ecsMigrationDrift = New-TagDriftRecord "module.platform.aws_ecs_task_definition.migration[0]" "aws_ecs_task_definition"
Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($ecsMigrationDrift) -RootModule $plannedDriftRoot
$retainedFullDriftPlan = $retainedBaselinePlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$retainedFullDriftPlan.planned_values.root_module = $plannedDriftRoot
$retainedFullDriftPlan.resource_drift = $driftRecords
Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $retainedFullDriftPlan

$s3EndpointAddress = "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
$s3EndpointBeforeCidrs = @("192.0.2.0/24", "198.51.100.0/24")
$s3EndpointAfterCidrs = @($s3EndpointBeforeCidrs + "203.0.113.0/24")
$s3EndpointCidrDrift = New-DriftRecord $s3EndpointAddress "aws_vpc_endpoint" `
  ([pscustomobject]@{ id = "s3-endpoint"; cidr_blocks = $s3EndpointBeforeCidrs; tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ id = "s3-endpoint"; cidr_blocks = $s3EndpointAfterCidrs; tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ cidr_blocks = @($false, $false); tags = [pscustomobject]@{} }) `
  ([pscustomobject]@{ cidr_blocks = @($false, $false, $false); tags = [pscustomobject]@{} })
$s3EndpointCidrRoot = [pscustomobject]@{ resources = @(
    [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kmsArn } },
    [pscustomobject]@{ address = $s3EndpointAddress; values = $s3EndpointCidrDrift.change.after }
  ) }
Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($s3EndpointCidrDrift) `
  -RootModule $s3EndpointCidrRoot

foreach ($mutation in @("removal", "duplicate", "invalid", "other", "planned", "sensitivity")) {
  $record = $s3EndpointCidrDrift | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $root = $s3EndpointCidrRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $plannedEndpoint = @($root.resources | Where-Object address -eq $s3EndpointAddress)[0]
  switch ($mutation) {
    "removal" {
      $record.change.after.cidr_blocks = @("192.0.2.0/24", "203.0.113.0/24", "10.0.0.0/8")
      $plannedEndpoint.values.cidr_blocks = $record.change.after.cidr_blocks
    }
    "duplicate" {
      $record.change.after.cidr_blocks = @($s3EndpointBeforeCidrs + "192.0.2.0/24")
      $plannedEndpoint.values.cidr_blocks = $record.change.after.cidr_blocks
    }
    "invalid" {
      $record.change.after.cidr_blocks = @($s3EndpointBeforeCidrs + "999.0.0.0/24")
      $plannedEndpoint.values.cidr_blocks = $record.change.after.cidr_blocks
    }
    "other" {
      $record.change.after | Add-Member -NotePropertyName policy -NotePropertyValue "changed"
      $plannedEndpoint.values = $record.change.after
    }
    "planned" { $plannedEndpoint.values.cidr_blocks = @($s3EndpointBeforeCidrs + "10.0.0.0/8") }
    "sensitivity" { $record.change.after_sensitive.cidr_blocks[2] = $true }
  }
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($record) -RootModule $root }
  catch { $rejected = $true }
  if (-not $rejected) { throw "The S3 endpoint CIDR drift guard accepted '$mutation'." }
}

$defaultTags = [pscustomobject]@{ Environment = "development"; ManagedBy = "terraform"; Project = "ai-job-apply" }
$processorRuntimeInline = @([pscustomobject]@{ name = "document-processor-runtime"; policy = $processorPolicy })
$processorRoleDrift = New-DriftRecord "module.platform.aws_iam_role.document_processor[0]" "aws_iam_role" `
  ([pscustomobject]@{ id = "processor-role"; inline_policy = @(); tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
  ([pscustomobject]@{ id = "processor-role"; inline_policy = $processorRuntimeInline; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
  ([pscustomobject]@{ inline_policy = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ inline_policy = @([pscustomobject]@{}); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$mappingDrift = New-DriftRecord "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]" `
  "aws_lambda_event_source_mapping" `
  ([pscustomobject]@{ id = "mapping"; enabled = $false; queues = $null; topics = $null; tags = $null; tags_all = $defaultTags }) `
  ([pscustomobject]@{ id = "mapping"; enabled = $false; queues = @(); topics = @(); tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ queues = @(); topics = @(); tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$processorFunctionDrift = New-DriftRecord "module.platform.aws_lambda_function.document_processor[0]" "aws_lambda_function" `
  ([pscustomobject]@{ id = "processor"; tags = $null; tags_all = $defaultTags }) `
  ([pscustomobject]@{ id = "processor"; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$stsEndpointDrift = New-DriftRecord "module.platform.aws_vpc_endpoint.sts[0]" "aws_vpc_endpoint" `
  ([pscustomobject]@{ id = "sts-endpoint"; tags = $null; tags_all = $defaultTags }) `
  ([pscustomobject]@{ id = "sts-endpoint"; tags = [pscustomobject]@{}; tags_all = $defaultTags }) `
  ([pscustomobject]@{ tags_all = [pscustomobject]@{} }) `
  ([pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} })
$rdsDrift = @($driftRecords | Where-Object address -eq "module.platform.aws_db_instance.postgres[0]")[0] |
  ConvertTo-Json -Depth 100 | ConvertFrom-Json
$completeDarkPostCreateDrift = @(
  $rdsDrift, $processorRoleDrift, $mappingDrift, $processorFunctionDrift, $stsEndpointDrift
)
$completeDarkPlannedResources = @(
  [pscustomobject]@{ address = "module.platform.aws_kms_key.platform"; values = [pscustomobject]@{ arn = $kmsArn } },
  [pscustomobject]@{ address = "module.platform.aws_iam_role.document_processor[0]"; values = $processorRoleDrift.change.after },
  [pscustomobject]@{ address = "module.platform.aws_iam_role_policy.document_processor[0]"; values = [pscustomobject]@{
      role = "ai-job-apply-development-document-processor"; policy = $processorPolicy
    } },
  [pscustomobject]@{ address = "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"; values = $mappingDrift.change.after },
  [pscustomobject]@{ address = "module.platform.aws_lambda_function.document_processor[0]"; values = $processorFunctionDrift.change.after },
  [pscustomobject]@{ address = "module.platform.aws_vpc_endpoint.sts[0]"; values = $stsEndpointDrift.change.after }
)
$completeDarkPlannedRoot = [pscustomobject]@{ resources = $completeDarkPlannedResources }
Assert-DevelopmentDocumentAcceptedResourceDrift -Records $completeDarkPostCreateDrift -RootModule $completeDarkPlannedRoot
foreach ($record in @($processorRoleDrift, $mappingDrift, $processorFunctionDrift, $stsEndpointDrift)) {
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($record) -RootModule $completeDarkPlannedRoot
}
$retainedCompleteDarkDriftPlan = $retainedBaselinePlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$retainedCompleteDarkDriftPlan.planned_values.root_module = $completeDarkPlannedRoot
$retainedCompleteDarkDriftPlan.resource_drift = $completeDarkPostCreateDrift
Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $retainedCompleteDarkDriftPlan

function Assert-CompleteDarkPostCreateDriftRejected([object[]]$Records, [object]$Root, [string]$Label) {
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records $Records -RootModule $Root } catch { $rejected = $true }
  if (-not $rejected) { throw "The CompleteDark post-create drift guard accepted '$Label'." }
}

foreach ($mutation in @(
    "missing", "extra", "name", "action", "resource", "managed-role", "separate-policy", "planned-role",
    "tags", "sensitivity", "missing-sensitivity", "other", "type", "address", "unknown", "replacement"
  )) {
  $record = $processorRoleDrift | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $root = $completeDarkPlannedRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $plannedRole = @($root.resources | Where-Object address -eq "module.platform.aws_iam_role.document_processor[0]")[0]
  $plannedPolicy = @($root.resources | Where-Object address -eq "module.platform.aws_iam_role_policy.document_processor[0]")[0]
  switch ($mutation) {
    "missing" { $record.change.after.inline_policy = @(); $plannedRole.values.inline_policy = @() }
    "extra" {
      $record.change.after.inline_policy = @($record.change.after.inline_policy) + @($record.change.after.inline_policy[0])
      $plannedRole.values.inline_policy = $record.change.after.inline_policy
    }
    "name" { $record.change.after.inline_policy[0].name = "unexpected"; $plannedRole.values.inline_policy = $record.change.after.inline_policy }
    "action" {
      $policy = $record.change.after.inline_policy[0].policy | ConvertFrom-Json
      @($policy.Statement | Where-Object Sid -eq "ReadDatabaseSecret")[0].Action = "secretsmanager:*"
      $value = $policy | ConvertTo-Json -Compress -Depth 50
      $record.change.after.inline_policy[0].policy = $value
      $plannedRole.values.inline_policy = $record.change.after.inline_policy
      $plannedPolicy.values.policy = $value
    }
    "resource" {
      $policy = $record.change.after.inline_policy[0].policy | ConvertFrom-Json
      @($policy.Statement | Where-Object Sid -eq "ConsumeExactScanQueue")[0].Resource = "*"
      $value = $policy | ConvertTo-Json -Compress -Depth 50
      $record.change.after.inline_policy[0].policy = $value
      $plannedRole.values.inline_policy = $record.change.after.inline_policy
      $plannedPolicy.values.policy = $value
    }
    "managed-role" { $plannedPolicy.values.role = "unexpected" }
    "separate-policy" { $plannedPolicy.values.policy = "{}" }
    "planned-role" { $plannedRole.values.inline_policy = @() }
    "tags" {
      $record.change.after.tags = [pscustomobject]@{ Unexpected = "value" }
      $plannedRole.values.tags = $record.change.after.tags
    }
    "sensitivity" { $record.change.after_sensitive.inline_policy[0] = [pscustomobject]@{ secret = $true } }
    "missing-sensitivity" { $record.change.after_sensitive.inline_policy = @() }
    "other" { $record.change.after.id = "changed"; $plannedRole.values.id = "changed" }
    "type" { $record.type = "aws_lambda_function" }
    "address" { $record.address = "module.platform.aws_iam_role.document_processor_shadow[0]" }
    "unknown" { $record.change.after_unknown = [pscustomobject]@{ inline_policy = $true } }
    "replacement" { $record.change.replace_paths = @(@("inline_policy")) }
  }
  Assert-CompleteDarkPostCreateDriftRejected @($record) $root "processor role $mutation"
}

foreach ($mutation in @(
    "queues", "topics", "tags", "missing-queues", "missing-topics", "reverse-tags", "sensitive-queues",
    "sensitive-topics", "sensitive-tags", "missing-sensitive-queues", "missing-sensitive-topics",
    "other", "planned", "type", "address", "unknown", "replacement"
  )) {
  $record = $mappingDrift | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $root = $completeDarkPlannedRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $planned = @($root.resources | Where-Object address -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]")[0]
  switch ($mutation) {
    "queues" { $record.change.after.queues = @("unexpected"); $planned.values.queues = $record.change.after.queues }
    "topics" { $record.change.after.topics = @("unexpected"); $planned.values.topics = $record.change.after.topics }
    "tags" { $record.change.after.tags = [pscustomobject]@{ Unexpected = "value" }; $planned.values.tags = $record.change.after.tags }
    "missing-queues" { $record.change.after.PSObject.Properties.Remove("queues"); $planned.values.PSObject.Properties.Remove("queues") }
    "missing-topics" { $record.change.after.PSObject.Properties.Remove("topics"); $planned.values.PSObject.Properties.Remove("topics") }
    "reverse-tags" { $record.change.before.tags = [pscustomobject]@{}; $record.change.after.tags = $null; $planned.values.tags = $null }
    "sensitive-queues" { $record.change.after_sensitive.queues = @([pscustomobject]@{ secret = $true }) }
    "sensitive-topics" { $record.change.after_sensitive.topics = @([pscustomobject]@{ secret = $true }) }
    "sensitive-tags" { $record.change.after_sensitive.tags = [pscustomobject]@{ secret = $true } }
    "missing-sensitive-queues" { $record.change.after_sensitive.PSObject.Properties.Remove("queues") }
    "missing-sensitive-topics" { $record.change.after_sensitive.PSObject.Properties.Remove("topics") }
    "other" { $record.change.after.enabled = $true; $planned.values.enabled = $true }
    "planned" { $planned.values.id = "unexpected" }
    "type" { $record.type = "aws_lambda_function" }
    "address" { $record.address = "module.platform.aws_lambda_event_source_mapping.document_scan_results_shadow[0]" }
    "unknown" { $record.change.after_unknown = [pscustomobject]@{ queues = $true } }
    "replacement" { $record.change.replace_paths = @(@("queues")) }
  }
  Assert-CompleteDarkPostCreateDriftRejected @($record) $root "event-source mapping $mutation"
}

foreach ($fixture in @(
    [pscustomobject]@{ Address = "module.platform.aws_lambda_function.document_processor[0]"; Type = "aws_lambda_function"; Record = $processorFunctionDrift },
    [pscustomobject]@{ Address = "module.platform.aws_vpc_endpoint.sts[0]"; Type = "aws_vpc_endpoint"; Record = $stsEndpointDrift }
  )) {
  foreach ($mutation in @("tags", "reverse", "sensitivity", "other", "planned", "type", "address", "unknown", "replacement")) {
    $record = $fixture.Record | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $root = $completeDarkPlannedRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $planned = @($root.resources | Where-Object address -eq $fixture.Address)[0]
    switch ($mutation) {
      "tags" { $record.change.after.tags = [pscustomobject]@{ Unexpected = "value" }; $planned.values.tags = $record.change.after.tags }
      "reverse" { $record.change.before.tags = [pscustomobject]@{}; $record.change.after.tags = $null; $planned.values.tags = $null }
      "sensitivity" { $record.change.after_sensitive.tags = [pscustomobject]@{ secret = $true } }
      "other" { $record.change.after.id = "changed"; $planned.values.id = "changed" }
      "planned" { $planned.values.id = "unexpected" }
      "type" { $record.type = $(if ($fixture.Type -ceq "aws_lambda_function") { "aws_vpc_endpoint" } else { "aws_lambda_function" }) }
      "address" { $record.address = "$($fixture.Address.TrimEnd('[0]'))_shadow[0]" }
      "unknown" { $record.change.after_unknown = [pscustomobject]@{ tags = $true } }
      "replacement" { $record.change.replace_paths = @(@("tags")) }
    }
    Assert-CompleteDarkPostCreateDriftRejected @($record) $root "$($fixture.Address) $mutation"
  }
}

$driftMutations = @(
  "duplicate", "extra", "type", "action", "unknown", "replacement", "reverse", "other", "sensitive", "policy",
  "nonempty-tags", "nonempty-layers", "nonempty-actions", "nonempty-metric-dimensions", "nonempty-alarm-dimensions"
)
foreach ($mutation in $driftMutations) {
  $badRecords = $driftRecords | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  switch ($mutation) {
    "duplicate" { $badRecords = @($badRecords) + @($badRecords[0]) }
    "extra" { $badRecords[0].address = "module.platform.aws_cloudwatch_event_rule.unreviewed[0]" }
    "type" { $badRecords[0].type = "aws_sns_topic" }
    "action" { $badRecords[0].change.actions = @("delete", "create") }
    "unknown" { $badRecords[0].change.after_unknown = [pscustomobject]@{ tags = $true } }
    "replacement" { $badRecords[0].change.replace_paths = @(@("tags")) }
    "reverse" { $badRecords[0].change.before.tags = [pscustomobject]@{}; $badRecords[0].change.after.tags = $null }
    "other" { $badRecords[0].change.after.id = "changed" }
    "sensitive" { $badRecords[0].change.after_sensitive.tags = [pscustomobject]@{ secret = $true } }
    "policy" {
      $queue = @($badRecords | Where-Object address -eq "module.platform.aws_sqs_queue.document_scan_results[0]")[0]
      $queue.change.after.policy = $queue.change.after.policy.Replace("sqs:SendMessage", "sqs:*")
    }
    "nonempty-tags" { $badRecords[0].change.after.tags = [pscustomobject]@{ Unexpected = "value" } }
    "nonempty-layers" {
      $lambda = @($badRecords | Where-Object address -eq "module.platform.aws_lambda_function.document_parser[0]")[0]
      $lambda.change.after.layers = @("arn:aws:lambda:us-east-2:${account}:layer:unexpected:1")
    }
    "nonempty-actions" {
      $alarm = @($badRecords | Where-Object address -eq "module.platform.aws_cloudwatch_metric_alarm.document_parser_errors[0]")[0]
      $alarm.change.after.insufficient_data_actions = @("arn:aws:sns:us-east-2:${account}:unexpected")
    }
    "nonempty-metric-dimensions" {
      $metric = @($badRecords | Where-Object address -eq "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]")[0]
      $metric.change.after.metric_transformation[0].dimensions = [pscustomobject]@{ Unexpected = "value" }
    }
    "nonempty-alarm-dimensions" {
      $alarm = @($badRecords | Where-Object address -eq "module.platform.aws_cloudwatch_metric_alarm.document_processing_record_failed[0]")[0]
      $alarm.change.after.dimensions = [pscustomobject]@{ Unexpected = "value" }
    }
  }
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($badRecords) -RootModule $plannedDriftRoot } catch { $rejected = $true }
  if (-not $rejected) { throw "The provider-normalization guard accepted '$mutation' drift." }
}
$emptyDriftRejected = $false
try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @() -RootModule $plannedDriftRoot } catch { $emptyDriftRejected = $true }
if (-not $emptyDriftRejected) { throw "The provider-normalization guard accepted an empty direct drift set." }

foreach ($mutation in @("action", "principal", "condition", "resource")) {
  $queueRecord = @($driftRecords | Where-Object address -eq "module.platform.aws_sqs_queue.document_scan_results[0]")[0] |
    ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $badRoot = $plannedDriftRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $policy = $queueRecord.change.after.policy | ConvertFrom-Json
  switch ($mutation) {
    "action" { $policy.Statement[0].Action = "sqs:*" }
    "principal" { $policy.Statement[0].Principal.Service = "lambda.amazonaws.com" }
    "condition" { $policy.Statement[0].Condition.StringEquals."aws:SourceAccount" = "000000000000" }
    "resource" { $policy.Statement[0].Resource = "arn:aws:sqs:us-east-2:${account}:unexpected" }
  }
  $badPolicy = $policy | ConvertTo-Json -Compress -Depth 50
  $queueRecord.change.after.policy = $badPolicy
  @($badRoot.resources | Where-Object address -eq "module.platform.aws_sqs_queue.document_scan_results[0]")[0].values.policy = $badPolicy
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($queueRecord) -RootModule $badRoot } catch { $rejected = $true }
  if (-not $rejected) { throw "The queue drift semantic guard accepted a wrong $mutation." }
}
foreach ($fixture in @(
    [pscustomobject]@{ Address = "module.platform.aws_s3_bucket.candidate_documents[0]"; Planned = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; Kind = "principal" },
    [pscustomobject]@{ Address = "module.platform.aws_s3_bucket.candidate_documents[0]"; Planned = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; Kind = "condition" },
    [pscustomobject]@{ Address = "module.platform.aws_s3_bucket.candidate_documents[0]"; Planned = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; Kind = "resource" },
    [pscustomobject]@{ Address = "module.platform.aws_sns_topic.operational_alerts"; Planned = "module.platform.aws_sns_topic_policy.operational_alerts"; Kind = "principal" }
  )) {
  $policyRecord = @($driftRecords | Where-Object address -eq $fixture.Address)[0] |
    ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $badRoot = $plannedDriftRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $policy = $policyRecord.change.after.policy | ConvertFrom-Json
  $added = @($policy.Statement)[-1]
  switch ($fixture.Kind) {
    "principal" { $added.Principal = [pscustomobject]@{ AWS = "*" } }
    "condition" { $added.Condition.StringNotEquals."s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "THREATS_FOUND" }
    "resource" { $added.Resource = "arn:aws:s3:::unexpected/quarantine/*" }
  }
  $badPolicy = $policy | ConvertTo-Json -Compress -Depth 50
  $policyRecord.change.after.policy = $badPolicy
  @($badRoot.resources | Where-Object address -eq $fixture.Planned)[0].values.policy = $badPolicy
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($policyRecord) -RootModule $badRoot } catch { $rejected = $true }
  if (-not $rejected) { throw "The $($fixture.Address) drift semantic guard accepted a wrong $($fixture.Kind)." }
}
foreach ($mutation in @("name", "action", "resource")) {
  $roleRecord = @($driftRecords | Where-Object address -eq "module.platform.aws_iam_role.document_parser[0]")[0] |
    ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $badRoot = $plannedDriftRoot | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $policy = $roleRecord.change.after.inline_policy[0].policy | ConvertFrom-Json
  switch ($mutation) {
    "name" { $roleRecord.change.after.inline_policy[0].name = "unexpected" }
    "action" { @($policy.Statement | Where-Object Sid -eq "DecryptLambdaEnvironment")[0].Action = "kms:*" }
    "resource" { @($policy.Statement | Where-Object Sid -eq "DecryptLambdaEnvironment")[0].Resource = "*" }
  }
  if ($mutation -cne "name") { $roleRecord.change.after.inline_policy[0].policy = $policy | ConvertTo-Json -Compress -Depth 50 }
  @($badRoot.resources | Where-Object address -eq "module.platform.aws_iam_role.document_parser[0]")[0].values.inline_policy = $roleRecord.change.after.inline_policy
  $rejected = $false
  try { Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($roleRecord) -RootModule $badRoot } catch { $rejected = $true }
  if (-not $rejected) { throw "The inline-policy drift guard accepted a wrong $mutation." }
}

$applyableBaselineRejected = $false
$applyableBaseline = $retainedBaselinePlan | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$applyableBaseline.applyable = $true
try { Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $applyableBaseline }
catch { $applyableBaselineRejected = $true }
if (-not $applyableBaselineRejected) { throw "A retained baseline was accepted as applyable." }

$changedBaselineRejected = $false
$changedBaseline = $retainedBaselinePlan | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$changedBaseline.resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
try { Assert-DevelopmentDocumentRetainedBaselinePlan -Plan $changedBaseline }
catch { $changedBaselineRejected = $true }
if (-not $changedBaselineRejected) { throw "A retained baseline accepted a meaningful resource change." }

$documentSource = Get-Content (Join-Path $repositoryRoot "infrastructure\terraform\modules\platform\candidate-documents.tf") -Raw
$platformSource = Get-Content (Join-Path $repositoryRoot "infrastructure\terraform\modules\platform\main.tf") -Raw
if (($documentSource + $platformSource) -match 'var\.deploy_document_processing|var\.document_processing_kms_prerequisite_enabled') {
  throw "Deprecated Terraform document switches remain in the platform module."
}
foreach ($required in @(
    "document_processing_deployment_stage", "document_parser_invocation_qualified_arn",
    "local.document_scan_results_queue_url", "local.document_parser_object_access_role_arn"
  )) {
  if (($documentSource + $platformSource) -notmatch [regex]::Escape($required)) { throw "Staged source is missing '$required'." }
}
if ($documentSource -match 'state\s*=\s*"ENABLED"') { throw "A document EventBridge rule is statically enabled." }

Write-Output "Development document staged dark guard tests passed."
