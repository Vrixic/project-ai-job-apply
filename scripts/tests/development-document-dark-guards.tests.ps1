Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1")
. (Join-Path $repositoryRoot "scripts\lib\development-document-dark-guards.ps1")
$account = "123456789012"

$parser = Get-DevelopmentDocumentStageExpectedActions "parser-dark"
$complete = Get-DevelopmentDocumentStageExpectedActions "complete-dark"
$kms = Get-DevelopmentDocumentStageExpectedActions "kms-prerequisite"
if ($parser.Count -ne 34 -or @($parser.Values | Where-Object { $_ -ceq "create" }).Count -ne 32 -or
  @($parser.Values | Where-Object { $_ -ceq "update" }).Count -ne 2) {
  throw "Parser-dark does not retain its exact 32-create/2-update action boundary."
}
if ($complete.Count -ne 10 -or @($complete.Values | Where-Object { $_ -ceq "create" }).Count -ne 7 -or
  @($complete.Values | Where-Object { $_ -ceq "update" }).Count -ne 3) {
  throw "Complete-dark does not retain its exact 7-create/3-update action boundary."
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

$qualified = "arn:aws:lambda:us-east-2:${account}:function:ai-job-apply-development-document-parser:7"

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
$validParserPlan = [pscustomobject]@{ resource_drift = $kmsPlan.resource_drift; planned_values = $kmsPlan.planned_values; resource_changes = @($kmsNoop) + $parserChanges }
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
$stsPolicy = New-TestPolicy @(@{ Sid = "CoordinatorAssumesExactDocumentObjectRoleOnly"; Effect = "Allow"; Action = "sts:AssumeRole"; Resource = $objectRole; Principal = @{ AWS = "*" }; Condition = @{ ArnEquals = @{ "aws:PrincipalArn" = $processorRole } } })
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
$validCompletePlan = [pscustomobject]@{ resource_drift = $kmsPlan.resource_drift; planned_values = $kmsPlan.planned_values; resource_changes = @($kmsNoop) + $completeChanges }
$null = Assert-DevelopmentDocumentDarkPlan $validCompletePlan $account complete-dark

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
