Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")

if ((ConvertTo-ExactBoolean -Value $true -Label "runtime true") -ne $true) {
  throw "A runtime true boolean was not preserved."
}
if ((ConvertTo-ExactBoolean -Value $false -Label "runtime false") -ne $false) {
  throw "A runtime false boolean was not preserved."
}
if ((ConvertTo-ExactBoolean -Value "true" -Label "serialized true") -ne $true) {
  throw "The exact serialized true boolean was not normalized."
}
if ((ConvertTo-ExactBoolean -Value "false" -Label "serialized false") -ne $false) {
  throw "The exact serialized false boolean was not normalized."
}
foreach ($invalidBoolean in @("False", 0, [pscustomobject]@{ value = $false })) {
  $rejected = $false
  try { $null = ConvertTo-ExactBoolean -Value $invalidBoolean -Label "invalid boolean" } catch { $rejected = $true }
  if (-not $rejected) { throw "A non-exact boolean representation was accepted." }
}

$savedPlanVariableFixture = [pscustomobject]@{
  oidc_issuer = [pscustomobject]@{ value = "https://issuer.example/"; sensitive = $true }
  candidate_document_cors_allowed_origins = [pscustomobject]@{ value = '["https://a.example","https://b.example"]' }
  gateway_lambda_reserved_concurrency = [pscustomobject]@{ value = "2" }
  deploy_document_processing = [pscustomobject]@{ value = "false" }
}
$environmentAssignments = Get-TerraformVariableEnvironmentAssignments -Variables $savedPlanVariableFixture
$expectedAssignments = @{
  TF_VAR_oidc_issuer = "https://issuer.example/"
  TF_VAR_candidate_document_cors_allowed_origins = '["https://a.example","https://b.example"]'
  TF_VAR_gateway_lambda_reserved_concurrency = "2"
  TF_VAR_deploy_document_processing = "false"
}
if ($environmentAssignments.Count -ne $expectedAssignments.Count) {
  throw "The saved-plan fixture did not produce the exact TF_VAR assignment set."
}
foreach ($entry in $expectedAssignments.GetEnumerator()) {
  if ([string]$environmentAssignments[$entry.Key] -cne [string]$entry.Value) {
    throw "Terraform environment serialization differs for '$($entry.Key)': '$($environmentAssignments[$entry.Key])'."
  }
}

$savedEnvironment = @{}
try {
  foreach ($entry in $environmentAssignments.GetEnumerator()) {
    $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable([string]$entry.Key, "Process")
    [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
    if ([Environment]::GetEnvironmentVariable([string]$entry.Key, "Process") -cne [string]$expectedAssignments[$entry.Key]) {
      throw "The exact serialized TF_VAR value was not written for '$($entry.Key)'."
    }
  }
}
finally {
  foreach ($entry in $savedEnvironment.GetEnumerator()) {
    if ($null -eq $entry.Value) {
      Remove-Item -LiteralPath "Env:\$($entry.Key)" -ErrorAction SilentlyContinue
    }
    else {
      [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
    }
  }
}
foreach ($entry in $savedEnvironment.GetEnumerator()) {
  $restoredValue = [Environment]::GetEnvironmentVariable([string]$entry.Key, "Process")
  if (-not [object]::Equals($restoredValue, $entry.Value)) {
    throw "The pre-test TF_VAR environment was not restored for '$($entry.Key)'."
  }
}
foreach ($invalidVariable in @(
    [pscustomobject]@{ Name = "candidate_document_cors_allowed_origins"; Value = $null },
    [pscustomobject]@{ Name = "gateway_lambda_reserved_concurrency"; Value = $false },
    [pscustomobject]@{ Name = "unsupported"; Value = [datetime]::UtcNow }
  )) {
  $rejected = $false
  try {
    $null = ConvertTo-TerraformVariableEnvironmentValue -Name $invalidVariable.Name -Value $invalidVariable.Value
  }
  catch { $rejected = $true }
  if (-not $rejected) { throw "An unsupported Terraform environment value was accepted." }
}

$serializedMap = '{"z":"last","a":1}' | ConvertFrom-Json
$structuredMap = [pscustomobject]@{ a = 1; z = "last" }
if ((ConvertTo-TerraformCompositeCanonicalValue $serializedMap) -cne
  (ConvertTo-TerraformCompositeCanonicalValue $structuredMap)) {
  throw "Equivalent serialized and structured maps do not compare canonically."
}
$serializedTuple = '["one",2,true]' | ConvertFrom-Json
$structuredTuple = @("one", 2, $true)
if ((ConvertTo-TerraformCompositeCanonicalValue $serializedTuple) -cne
  (ConvertTo-TerraformCompositeCanonicalValue $structuredTuple)) {
  throw "Equivalent serialized and structured tuples do not compare canonically."
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency "2" -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency ([int64]2))) {
  throw "Equivalent serialized and structured numeric values do not compare canonically."
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency "2" -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency "2")) {
  throw "Equivalent saved-plan and TF_VAR-provenance numeric strings do not compare canonically."
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue profile_readiness_execution_timeout_seconds "30.0" -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue profile_readiness_execution_timeout_seconds ([int64]30))) {
  throw "Equivalent timeout number representations do not compare canonically."
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue profile_readiness_retention_days "14" -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue profile_readiness_retention_days ([decimal]14.0))) {
  throw "Equivalent retention number representations do not compare canonically."
}
$baselineNumber = ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency "2" -SerializedBaseline
$freshNumber = ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency ([int64]3)
if ($baselineNumber -ceq $freshNumber) { throw "A semantically different Terraform number compared equal." }
foreach ($invalidNumber in @("02", "2e0", [double]::NaN, [double]::PositiveInfinity, $false)) {
  $rejected = $false
  try { $null = ConvertTo-TerraformCanonicalNumber $invalidNumber "invalid number" } catch { $rejected = $true }
  if (-not $rejected) { throw "An ambiguous or non-finite Terraform number was accepted." }
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue oidc_audience '["literal-string"]' -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue oidc_audience '["literal-string"]')) {
  throw "A JSON-looking string variable did not remain an exact string."
}

$expected = Get-DevelopmentDocumentDarkExpectedActions
if ($expected.Count -ne 44) { throw "Expected 44 exact post-prerequisite dark deployment changes." }
if (@($expected.Values | Where-Object { $_ -eq "create" }).Count -ne 39) { throw "Expected 39 creates." }
if (@($expected.Values | Where-Object { $_ -eq "update" }).Count -ne 5) { throw "Expected five post-prerequisite updates." }

$omittedOptionalChange = [pscustomobject]@{ actions = @("update") }
Assert-NoTerraformReplacementPaths $omittedOptionalChange
foreach ($metadataName in @("after_unknown", "before_sensitive", "after_sensitive")) {
  if ((ConvertTo-OptionalTerraformMetadataCanonicalValue $omittedOptionalChange $metadataName) -cne "{}") {
    throw "Omitted Terraform metadata '$metadataName' was not treated as exact empty metadata."
  }
}
$emptyOptionalChange = [pscustomobject]@{ actions = @("update"); replace_paths = @() }
Assert-NoTerraformReplacementPaths $emptyOptionalChange
$replacementChange = [pscustomobject]@{ actions = @("create", "delete"); replace_paths = @(@("policy")) }
$rejected = $false
try { Assert-NoTerraformReplacementPaths $replacementChange } catch { $rejected = $true }
if (-not $rejected) { throw "A nonempty Terraform replacement path was accepted." }
$unknownMetadataChange = [pscustomobject]@{ actions = @("update"); after_unknown = [pscustomobject]@{ policy = $true } }
if ((ConvertTo-OptionalTerraformMetadataCanonicalValue $unknownMetadataChange "after_unknown") -notmatch "true") {
  throw "Nonempty optional Terraform metadata was treated as empty."
}

$emptyRootMap = Get-TerraformStateResourceMap -RootModule ([pscustomobject]@{
    child_modules = @([pscustomobject]@{
        resources = @([pscustomobject]@{ address = "module.child.resource.example"; values = [pscustomobject]@{ id = "one" } })
      })
  })
if ($emptyRootMap.Count -ne 1 -or [string]$emptyRootMap["module.child.resource.example"].id -cne "one") {
  throw "A root module without resources was not traversed safely."
}
$leafMap = Get-TerraformStateResourceMap -RootModule ([pscustomobject]@{
    resources = @([pscustomobject]@{ address = "resource.leaf"; values = [pscustomobject]@{ id = "leaf" } })
  })
if ($leafMap.Count -ne 1 -or [string]$leafMap["resource.leaf"].id -cne "leaf") {
  throw "A leaf module without child_modules was not traversed safely."
}

$account = "123456789012"
$region = "us-east-2"
$processorRole = "arn:aws:iam::$account`:role/ai-job-apply-development-document-processor"
$base = [pscustomobject]@{ Sid = "Existing"; Effect = "Allow"; Action = "service:Read"; Resource = "exact" }
function New-PolicyJson { param([object[]]$Statements); return @{ Version = "2012-10-17"; Statement = $Statements } | ConvertTo-Json -Compress -Depth 30 }
function New-PolicyUpdate {
  param([string]$Before, [string]$After)
  return [pscustomobject]@{
    actions = @("update")
    before = [pscustomobject]@{ id = "same"; policy = $Before }
    after = [pscustomobject]@{ id = "same"; policy = $After }
    before_sensitive = [pscustomobject]@{ id = $false; policy = $false }
    after_sensitive = [pscustomobject]@{ id = $false; policy = $false }
    after_unknown = [pscustomobject]@{ id = $false; policy = $false }
  }
}
$kmsQueue = [pscustomobject]@{
  Sid = "AllowEventBridgeDocumentScanQueueEncryption"; Effect = "Allow"
  Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = "*"
  Principal = [pscustomobject]@{ Service = "events.amazonaws.com" }
  Condition = [pscustomobject]@{
    StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account }
    ArnEquals = [pscustomobject]@{ "aws:SourceArn" = @(
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-scan-results",
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-processing-reconciler"
      ) }
  }
}
$kmsAlerts = [pscustomobject]@{
  Sid = "AllowEventBridgeDocumentOperationalAlertEncryption"; Effect = "Allow"
  Action = @("kms:Decrypt", "kms:GenerateDataKey"); Resource = "*"
  Principal = [pscustomobject]@{ Service = "events.amazonaws.com" }
  Condition = [pscustomobject]@{
    StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account }
    ArnEquals = [pscustomobject]@{ "aws:SourceArn" = @(
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-scan-tag-failure",
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
      ) }
  }
}
$bucketArn = "arn:aws:s3:::ai-job-apply-development-candidate-docs-abc123"
$transport = [pscustomobject]@{ Sid = "DenyInsecureTransport"; Effect = "Deny"; Action = "s3:*"; Resource = @($bucketArn, "$bucketArn/*") }
$candidateDeny = [pscustomobject]@{
  Sid = "DenyQuarantineReadsWithoutCleanMalwareTag"; Effect = "Deny"
  Action = @("s3:GetObject", "s3:GetObjectVersion"); Resource = "$bucketArn/quarantine/*"
  Principal = [pscustomobject]@{ AWS = "*" }
  Condition = [pscustomobject]@{
    StringNotEquals = [pscustomobject]@{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = "NO_THREATS_FOUND" }
    ArnNotEquals = [pscustomobject]@{ "aws:PrincipalArn" = "arn:aws:iam::$account`:role/ai-job-apply-development-guardduty-malware" }
  }
}
$snsAlert = [pscustomobject]@{
  Sid = "AllowExactDocumentOperationalRules"; Effect = "Allow"; Action = "SNS:Publish"
  Resource = "arn:aws:sns:${region}:${account}:ai-job-apply-development-operational-alerts"
  Principal = [pscustomobject]@{ Service = "events.amazonaws.com" }
  Condition = [pscustomobject]@{
    StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account }
    ArnEquals = [pscustomobject]@{ "aws:SourceArn" = @(
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-scan-tag-failure",
        "arn:aws:events:${region}:${account}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
      ) }
  }
}
$sqsProcessor = [pscustomobject]@{
  Sid = "ExactDocumentProcessorQueueOnly"; Effect = "Allow"
  Action = @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage")
  Resource = "arn:aws:sqs:${region}:${account}:ai-job-apply-development-document-scan-results"
  Principal = [pscustomobject]@{ AWS = $processorRole }
}
$lambdaParser = [pscustomobject]@{
  Sid = "CoordinatorInvokesExactParserVersionOnly"; Effect = "Allow"; Action = "lambda:InvokeFunction"
  Resource = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:1"
  Principal = [pscustomobject]@{ AWS = $processorRole }
}
$secretBase = [pscustomobject]@{
  Sid = "ExactLambdaRolesDatabaseSecretOnly"; Effect = "Allow"; Action = "secretsmanager:GetSecretValue"
  Resource = "arn:aws:secretsmanager:${region}:${account}:secret:ai-job-apply/development/database-url-x"
  Principal = [pscustomobject]@{ AWS = "*" }
  Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{ "aws:PrincipalArn" = @("arn:aws:iam::$account`:role/existing") } }
}
$secretAfter = $secretBase | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$secretAfter.Condition.ArnEquals."aws:PrincipalArn" = @("arn:aws:iam::$account`:role/existing", $processorRole)
$updates = @{
  "module.platform.aws_kms_key.platform" = New-PolicyUpdate (New-PolicyJson @($base)) (New-PolicyJson @($base, $kmsQueue, $kmsAlerts))
  "module.platform.aws_s3_bucket_policy.candidate_documents[0]" = New-PolicyUpdate (New-PolicyJson @($transport)) (New-PolicyJson @($transport, $candidateDeny))
  "module.platform.aws_sns_topic_policy.operational_alerts" = New-PolicyUpdate (New-PolicyJson @($base)) (New-PolicyJson @($base, $snsAlert))
  "module.platform.aws_vpc_endpoint.sqs[0]" = New-PolicyUpdate (New-PolicyJson @($base)) (New-PolicyJson @($base, $sqsProcessor))
  "module.platform.aws_vpc_endpoint.lambda[0]" = New-PolicyUpdate (New-PolicyJson @($base)) (New-PolicyJson @($base, $lambdaParser))
  "module.platform.aws_vpc_endpoint.secretsmanager[0]" = New-PolicyUpdate (New-PolicyJson @($base, $secretBase)) (New-PolicyJson @($base, $secretAfter))
}
$lambdaTrust = New-PolicyJson @([pscustomobject]@{ Effect = "Allow"; Action = "sts:AssumeRole"; Principal = [pscustomobject]@{ Service = "lambda.amazonaws.com" } })
$objectTrust = New-PolicyJson @([pscustomobject]@{ Effect = "Allow"; Action = "sts:AssumeRole"; Principal = [pscustomobject]@{ AWS = $processorRole } })
$kmsArn = "arn:aws:kms:${region}:${account}:key/00000000-0000-0000-0000-000000000001"
$bucket = "arn:aws:s3:::ai-job-apply-development-candidate-docs-$account"
$processorStatements = @(
  [pscustomobject]@{ Sid="WriteOwnedLogs"; Effect="Allow"; Action=@("logs:CreateLogStream","logs:PutLogEvents"); Resource="arn:aws:logs:${region}:${account}:log-group:/ai-job-apply/development/application:*" },
  [pscustomobject]@{ Sid="ManageVpcInterfaces"; Effect="Allow"; Action=@("ec2:AssignPrivateIpAddresses","ec2:CreateNetworkInterface","ec2:DeleteNetworkInterface","ec2:DescribeNetworkInterfaces","ec2:DescribeSubnets","ec2:UnassignPrivateIpAddresses"); Resource="*" },
  [pscustomobject]@{ Sid="ReadDatabaseSecret"; Effect="Allow"; Action="secretsmanager:GetSecretValue"; Resource="arn:aws:secretsmanager:${region}:${account}:secret:ai-job-apply/development/database-url-x" },
  [pscustomobject]@{ Sid="ConsumeExactScanQueue"; Effect="Allow"; Action=@("sqs:ChangeMessageVisibility","sqs:DeleteMessage","sqs:GetQueueAttributes","sqs:ReceiveMessage"); Resource="arn:aws:sqs:${region}:${account}:ai-job-apply-development-document-scan-results" },
  [pscustomobject]@{ Sid="InvokeExactParserVersion"; Effect="Allow"; Action="lambda:InvokeFunction"; Resource="arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:1" },
  [pscustomobject]@{ Sid="AssumeExactObjectAccessRole"; Effect="Allow"; Action="sts:AssumeRole"; Resource="arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access" },
  [pscustomobject]@{ Sid="ReadNormalizedDocumentsOnly"; Effect="Allow"; Action=@("s3:GetObject","s3:GetObjectVersion"); Resource="$bucket/normalized/*" },
  [pscustomobject]@{ Sid="DecryptOwnedRuntimeData"; Effect="Allow"; Action=@("kms:Decrypt","kms:GenerateDataKey"); Resource=$kmsArn },
  [pscustomobject]@{ Sid="WriteNativeTraces"; Effect="Allow"; Action=@("xray:PutTelemetryRecords","xray:PutTraceSegments"); Resource="*" }
)
$parserStatements = @(
  $processorStatements[1],
  [pscustomobject]@{ Sid="DecryptLambdaEnvironment"; Effect="Allow"; Action="kms:Decrypt"; Resource=$kmsArn; Condition=[pscustomobject]@{ StringEquals=[pscustomobject]@{ "kms:ViaService"="lambda.${region}.amazonaws.com" } } }
)
$objectStatements = @(
  [pscustomobject]@{ Sid="SessionPolicyMustNarrowObjectAccess"; Effect="Allow"; Action=@("s3:GetObject","s3:GetObjectVersion","s3:GetObjectTagging","s3:GetObjectVersionTagging","s3:PutObject"); Resource=@("$bucket/quarantine/*","$bucket/normalized/*") },
  [pscustomobject]@{ Sid="EncryptAndDecryptViaS3Only"; Effect="Allow"; Action=@("kms:Decrypt","kms:GenerateDataKey"); Resource=$kmsArn; Condition=[pscustomobject]@{ StringEquals=[pscustomobject]@{ "kms:ViaService"="s3.${region}.amazonaws.com" } } }
)
function New-QueuePolicy([string]$Sid,[string]$Queue,[string[]]$Rules) {
  New-PolicyJson @([pscustomobject]@{ Sid=$Sid; Effect="Allow"; Action="sqs:SendMessage"; Resource="arn:aws:sqs:${region}:${account}:$Queue"; Principal=[pscustomobject]@{ Service="events.amazonaws.com" }; Condition=[pscustomobject]@{ ArnEquals=[pscustomobject]@{ "aws:SourceArn"=@($Rules|ForEach-Object{"arn:aws:events:${region}:${account}:rule/$_"}) }; StringEquals=[pscustomobject]@{ "aws:SourceAccount"=$account } } })
}
$s3EndpointStatements = @(
  [pscustomobject]@{ Sid="ExactParserQuarantineReadsOnly";Effect="Allow";Action=@("s3:GetObject","s3:GetObjectVersion","s3:GetObjectTagging","s3:GetObjectVersionTagging");Resource="$bucket/quarantine/*";Principal=[pscustomobject]@{AWS="*"};Condition=[pscustomobject]@{ArnEquals=[pscustomobject]@{"aws:PrincipalArn"="arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access"}}},
  [pscustomobject]@{ Sid="ExactParserNormalizedWritesAndVerification";Effect="Allow";Action=@("s3:GetObject","s3:GetObjectVersion","s3:PutObject");Resource="$bucket/normalized/*";Principal=[pscustomobject]@{AWS="*"};Condition=[pscustomobject]@{ArnEquals=[pscustomobject]@{"aws:PrincipalArn"="arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access"}}},
  [pscustomobject]@{ Sid="ExactCoordinatorNormalizedReadsOnly";Effect="Allow";Action=@("s3:GetObject","s3:GetObjectVersion");Resource="$bucket/normalized/*";Principal=[pscustomobject]@{AWS="*"};Condition=[pscustomobject]@{ArnEquals=[pscustomobject]@{"aws:PrincipalArn"=$processorRole}}}
)
$stsEndpointPolicy = New-PolicyJson @([pscustomobject]@{ Sid="CoordinatorAssumesExactDocumentObjectRoleOnly";Effect="Allow";Action="sts:AssumeRole";Resource="arn:aws:iam::${account}:role/ai-job-apply-development-document-object-access";Principal=[pscustomobject]@{AWS="*"};Condition=[pscustomobject]@{ArnEquals=[pscustomobject]@{"aws:PrincipalArn"=$processorRole}} })

$changes = @()
foreach ($entry in $expected.GetEnumerator()) {
  $after = [pscustomobject]@{}
  if ($entry.Key -like "module.platform.aws_cloudwatch_event_rule.document_*") {
    $after | Add-Member state "DISABLED"
  }
  if ($entry.Key -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]") {
    $after | Add-Member enabled $false
  }
  $securityValue = switch ($entry.Key) {
    "module.platform.aws_iam_role.document_processor[0]" { @("assume_role_policy",$lambdaTrust) }
    "module.platform.aws_iam_role.document_parser[0]" { @("assume_role_policy",$lambdaTrust) }
    "module.platform.aws_iam_role.document_parser_object_access[0]" { @("assume_role_policy",$objectTrust) }
    "module.platform.aws_iam_role_policy.document_parser[0]" { @("policy",(New-PolicyJson $parserStatements)) }
    "module.platform.aws_iam_role_policy.document_parser_object_access[0]" { @("policy",(New-PolicyJson $objectStatements)) }
    "module.platform.aws_iam_role_policy.document_processor[0]" { @("policy",(New-PolicyJson $processorStatements)) }
    "module.platform.aws_sqs_queue_policy.document_scan_delivery_dead_letter[0]" { @("policy",(New-QueuePolicy "ExactEventBridgeRuleDeadLettersOnly" "ai-job-apply-development-document-scan-delivery-dlq" @("ai-job-apply-development-document-scan-results","ai-job-apply-development-document-scan-tag-failure","ai-job-apply-development-document-scan-plan-unhealthy","ai-job-apply-development-document-processing-reconciler"))) }
    "module.platform.aws_sqs_queue_policy.document_scan_results[0]" { @("policy",(New-QueuePolicy "ExactGuardDutyResultRuleOnly" "ai-job-apply-development-document-scan-results" @("ai-job-apply-development-document-scan-results"))) }
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" { @("policy",(New-PolicyJson $s3EndpointStatements)) }
    "module.platform.aws_vpc_endpoint.sts[0]" { @("policy",$stsEndpointPolicy) }
  }
  if ($securityValue) { $after | Add-Member $securityValue[0] $securityValue[1] }
  if ($entry.Key -like "module.platform.aws_sqs_queue_policy.document_scan_*") {
    $queueName = if ($entry.Key -like "*delivery_dead_letter*") { "ai-job-apply-development-document-scan-delivery-dlq" } else { "ai-job-apply-development-document-scan-results" }
    $after | Add-Member queue_url "https://sqs.us-east-2.amazonaws.com/$account/$queueName"
  }
  $change = if ($entry.Value -eq "update") { $updates[$entry.Key] }
    else { [pscustomobject]@{ actions = @($entry.Value); after = $after; after_unknown = [pscustomobject]@{} } }
  $changes += [pscustomobject]@{ address = $entry.Key; mode = "managed"; change = $change }
}
$dataReads = @(Get-DevelopmentDocumentDarkExpectedDataReads | ForEach-Object {
    [pscustomobject]@{
      address = $_; mode = "data"; type = "aws_iam_policy_document"
      change = [pscustomobject]@{ actions = @("read"); before = $null; replace_paths = $null
        before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} }
    }
  })
$kmsNoop = [pscustomobject]@{
  address = "module.platform.aws_kms_key.platform"; mode = "managed"; type = "aws_kms_key"
  change = [pscustomobject]@{ actions = @("no-op"); before = [pscustomobject]@{ arn = $kmsArn }
    after = [pscustomobject]@{ arn = $kmsArn }; after_unknown = [pscustomobject]@{}
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} }
}
$resourceDrift = @(
  [pscustomobject]@{
    address = "module.platform.aws_db_instance.postgres[0]"; mode = "managed"; type = "aws_db_instance"
    change = [pscustomobject]@{ actions = @("update"); replace_paths = $null; after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
      before = [pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-12T22:13:52Z" }
      after = [pscustomobject]@{ id = "db"; latest_restorable_time = "2026-08-13T02:03:53Z" } }
  },
  [pscustomobject]@{
    address = "module.platform.aws_ecs_task_definition.migration[0]"; mode = "managed"; type = "aws_ecs_task_definition"
    change = [pscustomobject]@{ actions = @("update"); replace_paths = $null; after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{ id = $false }
      after_sensitive = [pscustomobject]@{ id = $false; tags = [pscustomobject]@{} }
      before = [pscustomobject]@{ id = "migration"; tags = $null }
      after = [pscustomobject]@{ id = "migration"; tags = [pscustomobject]@{} } }
  }
)
$plan = [pscustomobject]@{ resource_changes = @($changes + $dataReads + $kmsNoop); resource_drift = $resourceDrift }
$null = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $account

$nonemptyTagSensitivityPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$nonemptyTagSensitivityPlan.resource_drift[1].change.after_sensitive.tags = [pscustomobject]@{ Environment = $false }
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $nonemptyTagSensitivityPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "Nonempty migration-task tag sensitivity metadata was accepted." }

$trueTagSensitivityPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$trueTagSensitivityPlan.resource_drift[1].change.after_sensitive.tags = $true
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $trueTagSensitivityPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "True migration-task tag sensitivity metadata was accepted." }

$otherSensitivityPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$otherSensitivityPlan.resource_drift[1].change.after_sensitive | Add-Member unreviewed $false
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $otherSensitivityPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A migration-task sensitivity change outside tags was accepted." }

$differentAddressSensitivityPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$differentAddressSensitivityPlan.resource_drift[0].change.after_sensitive | Add-Member tags ([pscustomobject]@{})
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $differentAddressSensitivityPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "Empty tag sensitivity normalization was accepted for a different resource address." }

$dateObjectDriftPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$dateObjectDriftPlan.resource_drift[0].change.before.latest_restorable_time = [datetime]::Parse(
  "2026-08-12T22:13:52Z", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
$dateObjectDriftPlan.resource_drift[0].change.after.latest_restorable_time = [datetime]::Parse(
  "2026-08-13T02:03:53Z", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
$null = Assert-DevelopmentDocumentDarkPlan $dateObjectDriftPlan $account
$localDateDriftPlan = $dateObjectDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$localDateDriftPlan.resource_drift[0].change.after.latest_restorable_time = [datetime]::SpecifyKind(
  [datetime]"2026-08-13T02:03:53", [DateTimeKind]::Local)
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $localDateDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A local-kind RDS restore DateTime was accepted." }
$unspecifiedDateDriftPlan = $dateObjectDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$unspecifiedDateDriftPlan.resource_drift[0].change.after.latest_restorable_time = [datetime]::SpecifyKind(
  [datetime]"2026-08-13T02:03:53", [DateTimeKind]::Unspecified)
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $unspecifiedDateDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "An unspecified-kind RDS restore DateTime was accepted." }
$fractionalDateDriftPlan = $dateObjectDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$fractionalDateDriftPlan.resource_drift[0].change.after.latest_restorable_time = $dateObjectDriftPlan.resource_drift[0].change.after.latest_restorable_time.AddMilliseconds(1)
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $fractionalDateDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A fractional UTC RDS restore DateTime was accepted." }
foreach ($outOfRange in @("1999-12-31T23:59:59Z", "2100-01-01T00:00:00Z")) {
  $outOfRangeStringPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $outOfRangeStringPlan.resource_drift[0].change.after.latest_restorable_time = $outOfRange
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $outOfRangeStringPlan $account } catch { $rejected = $true }
  if (-not $rejected) { throw "An out-of-range RDS restore-time string was accepted." }

  $outOfRangeDatePlan = $dateObjectDriftPlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $outOfRangeDatePlan.resource_drift[0].change.after.latest_restorable_time = [datetime]::Parse(
    $outOfRange, [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
  $rejected = $false
  try { $null = Assert-DevelopmentDocumentDarkPlan $outOfRangeDatePlan $account } catch { $rejected = $true }
  if (-not $rejected) { throw "An out-of-range UTC RDS restore DateTime was accepted." }
}

$unknownSecurityPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$unknownSecurityChange = @($unknownSecurityPlan.resource_changes | Where-Object address -eq "module.platform.aws_iam_role_policy.document_processor[0]")[0]
$unknownSecurityChange.change.after_unknown | Add-Member policy $true
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $unknownSecurityPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "An unknown created security policy was accepted." }
$broadCreatedPolicyPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$broadCreatedPolicy = @($broadCreatedPolicyPlan.resource_changes | Where-Object address -eq "module.platform.aws_iam_role_policy.document_parser[0]")[0]
$broadCreatedPolicyJson = $broadCreatedPolicy.change.after.policy | ConvertFrom-Json
@($broadCreatedPolicyJson.Statement | Where-Object Sid -eq "DecryptLambdaEnvironment")[0].Action = @("kms:Decrypt", "kms:GenerateDataKey")
$broadCreatedPolicy.change.after.policy = $broadCreatedPolicyJson | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $broadCreatedPolicyPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A broadened created role policy was accepted." }
$broadTrustPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$broadTrust = @($broadTrustPlan.resource_changes | Where-Object address -eq "module.platform.aws_iam_role.document_processor[0]")[0]
$broadTrustJson = $broadTrust.change.after.assume_role_policy | ConvertFrom-Json
$broadTrustJson.Statement[0].Principal.Service = "ec2.amazonaws.com"
$broadTrust.change.after.assume_role_policy = $broadTrustJson | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $broadTrustPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A broadened created role trust was accepted." }
$extraTrustKeyPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$extraTrust = @($extraTrustKeyPlan.resource_changes | Where-Object address -eq "module.platform.aws_iam_role.document_processor[0]")[0]
$extraTrustJson = $extraTrust.change.after.assume_role_policy | ConvertFrom-Json
$extraTrustJson.Statement[0] | Add-Member Condition ([pscustomobject]@{ StringEquals = [pscustomobject]@{ "aws:SourceAccount" = $account } })
$extraTrust.change.after.assume_role_policy = $extraTrustJson | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $extraTrustKeyPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A role trust with an extra condition was accepted." }
$wrongS3VersionPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$wrongS3Version = @($wrongS3VersionPlan.resource_changes | Where-Object address -eq "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]")[0]
$wrongS3VersionJson = $wrongS3Version.change.after.policy | ConvertFrom-Json
$wrongS3VersionJson.Version = "2008-10-17"
$wrongS3Version.change.after.policy = $wrongS3VersionJson | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $wrongS3VersionPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "An S3 endpoint policy with the wrong version was accepted." }
$wrongKmsBindingPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$wrongKmsPolicy = @($wrongKmsBindingPlan.resource_changes | Where-Object address -eq "module.platform.aws_iam_role_policy.document_parser[0]")[0]
$wrongKmsPolicyJson = $wrongKmsPolicy.change.after.policy | ConvertFrom-Json
@($wrongKmsPolicyJson.Statement | Where-Object Sid -eq "DecryptLambdaEnvironment")[0].Resource = "arn:aws:kms:${region}:${account}:key/00000000-0000-0000-0000-000000000002"
$wrongKmsPolicy.change.after.policy = $wrongKmsPolicyJson | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $wrongKmsBindingPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A same-account but different KMS key was accepted." }
$wrongQueueUrlPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
@($wrongQueueUrlPlan.resource_changes | Where-Object address -eq "module.platform.aws_sqs_queue_policy.document_scan_results[0]")[0].change.after.queue_url = "https://sqs.us-east-2.amazonaws.com/$account/other"
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $wrongQueueUrlPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A queue policy with a different URL was accepted." }
$extraDataPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$extraDataPlan.resource_changes += [pscustomobject]@{
  address = "module.platform.data.aws_iam_policy_document.unreviewed[0]"; mode = "data"; type = "aws_iam_policy_document"
  change = [pscustomobject]@{ actions = @("read"); before = $null; replace_paths = $null
    before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} }
}
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $extraDataPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "An unreviewed deferred data read was accepted." }
$badDriftPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$badDriftPlan.resource_drift[0].change.after.id = "changed"
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $badDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "Resource drift affecting more than the accepted provider field was accepted." }
$backwardDriftPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$backwardDriftPlan.resource_drift[0].change.after.latest_restorable_time = "2026-08-12T21:13:52Z"
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $backwardDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A backward RDS restore clock was accepted." }
$fractionalDriftPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$fractionalDriftPlan.resource_drift[0].change.after.latest_restorable_time = "2026-08-13T02:03:53.123Z"
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan $fractionalDriftPlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A non-whole-second RDS restore clock was accepted." }

$badPlan = $plan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
@($badPlan.resource_changes | Where-Object address -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]")[0].change.after.enabled = $true
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan -Plan $badPlan -AccountId $account } catch { $rejected = $true }
if (-not $rejected) { throw "An enabled scan mapping was accepted." }

$broadPlan = $plan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$broadSqs = @($broadPlan.resource_changes | Where-Object address -eq "module.platform.aws_vpc_endpoint.sqs[0]")[0]
$broadPolicy = $broadSqs.change.after.policy | ConvertFrom-Json
@($broadPolicy.Statement | Where-Object Sid -eq "ExactDocumentProcessorQueueOnly")[0].Action += "sqs:SendMessage"
$broadSqs.change.after.policy = $broadPolicy | ConvertTo-Json -Compress -Depth 30
$rejected = $false
try { $null = Assert-DevelopmentDocumentDarkPlan -Plan $broadPlan -AccountId $account } catch { $rejected = $true }
if (-not $rejected) { throw "A broader SQS endpoint policy was accepted." }

$source = "a" * 40
$processorSha = "b" * 64
$parserSha = "c" * 64
$receiptArtifacts = @()
foreach ($definition in @(@("document-processor-lambda", $processorSha), @("document-parser-lambda", $parserSha))) {
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $receiptArtifacts += [pscustomobject]@{
      artifactName = $definition[0]; artifactSha256 = $definition[1]; suffix = $suffix
      key = "lambda/documents/$source/$($definition[1])/$($definition[0]).$suffix"
      versionId = "version-$suffix"; objectSha256 = "d" * 64
      objectBase64Sha256 = ("Z" * 43) + "="; contentLength = 1
    }
  }
}
$receipt = [pscustomobject]@{
  schemaVersion = 1; kind = "development-document-lambda-publication"; environment = "development"
  region = "us-east-2"; sourceSha = $source; boundarySha256 = "e" * 64; phase = "verified"
  artifacts = $receiptArtifacts
}
Assert-DevelopmentDocumentPublicationReceipt -Receipt $receipt
$baselineVariables = [pscustomobject]@{
  deploy_document_processing = [pscustomobject]@{ value = "false" }
  document_scan_mapping_enabled = [pscustomobject]@{ value = "false" }
  document_scan_event_rule_enabled = [pscustomobject]@{ value = "false" }
  document_processor_artifact_s3_key = [pscustomobject]@{ value = "" }
  document_processor_artifact_s3_object_version = [pscustomobject]@{ value = "" }
  document_processor_artifact_sha256 = [pscustomobject]@{ value = "" }
  document_processor_artifact_base64sha256 = [pscustomobject]@{ value = "" }
  document_parser_artifact_s3_key = [pscustomobject]@{ value = "" }
  document_parser_artifact_s3_object_version = [pscustomobject]@{ value = "" }
  document_parser_artifact_sha256 = [pscustomobject]@{ value = "" }
  document_parser_artifact_base64sha256 = [pscustomobject]@{ value = "" }
  document_processor_extension_layer_arn = [pscustomobject]@{ value = "" }
  candidate_document_cors_allowed_origins = [pscustomobject]@{ value = '["https://app.example"]' }
  gateway_lambda_reserved_concurrency = [pscustomobject]@{ value = "2" }
  oidc_audience = [pscustomobject]@{ value = "same" }
}
$planVariables = $baselineVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$planVariables | Add-Member document_processing_kms_prerequisite_enabled ([pscustomobject]@{ value = "true" })
$planVariables.deploy_document_processing.value = "true"
$planVariables.candidate_document_cors_allowed_origins.value = @("https://app.example")
$planVariables.gateway_lambda_reserved_concurrency.value = "2"
$planVariables.document_processor_artifact_s3_key.value = "lambda/documents/$source/$processorSha/document-processor-lambda.zip"
$planVariables.document_processor_artifact_s3_object_version.value = "version-zip"
$planVariables.document_processor_artifact_sha256.value = $processorSha
$planVariables.document_processor_artifact_base64sha256.value = ("Z" * 43) + "="
$planVariables.document_parser_artifact_s3_key.value = "lambda/documents/$source/$parserSha/document-parser-lambda.zip"
$planVariables.document_parser_artifact_s3_object_version.value = "version-zip"
$planVariables.document_parser_artifact_sha256.value = $parserSha
$planVariables.document_parser_artifact_base64sha256.value = ("Z" * 43) + "="
$planVariables.document_processor_extension_layer_arn.value = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baselineVariables -PlanVariables $planVariables -Receipt $receipt
$prerequisiteVariables = $baselineVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$prerequisiteVariables | Add-Member document_processing_kms_prerequisite_enabled ([pscustomobject]@{ value = "true" })
$prerequisiteVariables.candidate_document_cors_allowed_origins.value = @("https://app.example")
Assert-DevelopmentDocumentKmsPrerequisiteVariables $baselineVariables $prerequisiteVariables
$kmsPrerequisiteChange = [pscustomobject]@{
  address = "module.platform.aws_kms_key.platform"; mode = "managed"; type = "aws_kms_key"
  change = $updates["module.platform.aws_kms_key.platform"]
}
$kmsPrerequisiteChange.change.PSObject.Properties.Remove("after_unknown")
$kmsPrerequisiteChange.change.PSObject.Properties.Remove("before_sensitive")
$kmsPrerequisiteChange.change.PSObject.Properties.Remove("after_sensitive")
$kmsPrerequisitePlan = [pscustomobject]@{ resource_changes = @($kmsPrerequisiteChange); resource_drift = $resourceDrift }
$null = Assert-DevelopmentDocumentKmsPrerequisitePlan $kmsPrerequisitePlan $account
$badPrerequisitePlan = $kmsPrerequisitePlan | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$badPrerequisitePlan.resource_changes += [pscustomobject]@{
  address = "module.platform.aws_sns_topic_policy.operational_alerts"; mode = "managed"; type = "aws_sns_topic_policy"
  change = [pscustomobject]@{ actions = @("update") }
}
$rejected = $false
try { $null = Assert-DevelopmentDocumentKmsPrerequisitePlan $badPrerequisitePlan $account } catch { $rejected = $true }
if (-not $rejected) { throw "A second prerequisite mutation was accepted." }
$differentCompositeVariables = $planVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$differentCompositeVariables.candidate_document_cors_allowed_origins.value = @("https://other.example")
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baselineVariables -PlanVariables $differentCompositeVariables -Receipt $receipt } catch { $rejected = $true }
if (-not $rejected) { throw "A semantically different composite variable was accepted." }
$differentNumericVariables = $planVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$differentNumericVariables.gateway_lambda_reserved_concurrency.value = "3"
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baselineVariables -PlanVariables $differentNumericVariables -Receipt $receipt } catch { $rejected = $true }
if (-not $rejected) { throw "A semantically different numeric variable was accepted." }
$planVariables.oidc_audience.value = "changed"
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baselineVariables -PlanVariables $planVariables -Receipt $receipt } catch { $rejected = $true }
if (-not $rejected) { throw "An unrelated variable change was accepted." }

$lambdaEnvironment = @{ NODE_ENV = "production"; RELEASE_SHA = "f" * 64 }
$processorConfiguration = [pscustomobject]@{
  State = "Active"; LastUpdateStatus = "Successful"; Runtime = "nodejs24.x"; Handler = "index.handler"
  PackageType = "Zip"
  MemorySize = 1024; Timeout = 60; EphemeralStorage = [pscustomobject]@{ Size = 512 }
  Role = "arn:role:processor"; KMSKeyArn = "arn:kms:platform"; Architectures = @("x86_64")
  VpcConfig = [pscustomobject]@{ VpcId = "vpc-1"; SubnetIds = @("subnet-b", "subnet-a"); SecurityGroupIds = @("sg-app") }
  Environment = [pscustomobject]@{ Variables = [pscustomobject]$lambdaEnvironment }
  Layers = @([pscustomobject]@{ Arn = "arn:layer:114" }); TracingConfig = [pscustomobject]@{ Mode = "Active" }
  LoggingConfig = [pscustomobject]@{ LogFormat = "JSON"; ApplicationLogLevel = "INFO"; SystemLogLevel = "WARN"; LogGroup = "/shared" }
}
Assert-ExactDocumentLambdaRuntime $processorConfiguration ([pscustomobject]@{ ReservedConcurrentExecutions = 2 }) processor `
  "arn:role:processor" "arn:kms:platform" "vpc-1" @("subnet-a", "subnet-b") "sg-app" $lambdaEnvironment "/shared" "arn:layer:114"
$processorConfiguration.Timeout = 61
$rejected = $false
try { Assert-ExactDocumentLambdaRuntime $processorConfiguration ([pscustomobject]@{ ReservedConcurrentExecutions = 2 }) processor `
    "arn:role:processor" "arn:kms:platform" "vpc-1" @("subnet-a", "subnet-b") "sg-app" $lambdaEnvironment "/shared" "arn:layer:114" } catch { $rejected = $true }
if (-not $rejected) { throw "An overlong processor timeout was accepted." }

$parserEnvironment = @{ NODE_ENV = "production"; RELEASE_SHA = "e" * 64 }
$parserConfiguration = [pscustomobject]@{
  State = "Active"; LastUpdateStatus = "Successful"; Runtime = "nodejs24.x"; Handler = "index.handler"
  PackageType = "Zip"; MemorySize = 1536; Timeout = 45; EphemeralStorage = [pscustomobject]@{ Size = 512 }
  Role = "arn:role:parser"; KMSKeyArn = "arn:kms:platform"; Architectures = @("x86_64")
  VpcConfig = [pscustomobject]@{ VpcId = "vpc-1"; SubnetIds = @("subnet-a", "subnet-b"); SecurityGroupIds = @("sg-parser") }
  Environment = [pscustomobject]@{ Variables = [pscustomobject]$parserEnvironment }
  TracingConfig = [pscustomobject]@{ Mode = "PassThrough" }
  LoggingConfig = [pscustomobject]@{ LogFormat = "Text"; LogGroup = "/aws/lambda/parser" }
}
Assert-ExactDocumentLambdaRuntime $parserConfiguration ([pscustomobject]@{ ReservedConcurrentExecutions = 2 }) parser `
  "arn:role:parser" "arn:kms:platform" "vpc-1" @("subnet-a", "subnet-b") "sg-parser" $parserEnvironment "/shared"
$parserConfiguration | Add-Member Layers @([pscustomobject]@{ Arn = "arn:layer:unexpected" })
$rejected = $false
try { Assert-ExactDocumentLambdaRuntime $parserConfiguration ([pscustomobject]@{ ReservedConcurrentExecutions = 2 }) parser `
    "arn:role:parser" "arn:kms:platform" "vpc-1" @("subnet-a", "subnet-b") "sg-parser" $parserEnvironment "/shared" } catch { $rejected = $true }
if (-not $rejected) { throw "A nonempty parser layer set was accepted." }

$queueAttributes = [pscustomobject]@{
  KmsMasterKeyId = "arn:kms:platform"; DelaySeconds = "0"; MessageRetentionPeriod = "345600"
  VisibilityTimeout = "360"; ApproximateNumberOfMessages = "0"; ApproximateNumberOfMessagesNotVisible = "0"
  ApproximateNumberOfMessagesDelayed = "0"; RedrivePolicy = '{"deadLetterTargetArn":"arn:queue:dlq","maxReceiveCount":5}'
}
Assert-ExactDocumentQueueAttributes $queueAttributes "arn:kms:platform" 345600 360 "arn:queue:dlq"
$queueAttributes.DelaySeconds = "1"
$rejected = $false
try { Assert-ExactDocumentQueueAttributes $queueAttributes "arn:kms:platform" 345600 360 "arn:queue:dlq" } catch { $rejected = $true }
if (-not $rejected) { throw "A delayed document queue was accepted." }

$alarm = [pscustomobject]@{ AlarmName = "document-alarm"; ActionsEnabled = $true; StateValue = "OK"; AlarmActions = @("arn:topic"); OKActions = @("arn:topic") }
Assert-ExactDocumentAlarmSet @($alarm) @("document-alarm") "arn:topic"
$alarm.StateValue = "ALARM"
$rejected = $false
try { Assert-ExactDocumentAlarmSet @($alarm) @("document-alarm") "arn:topic" } catch { $rejected = $true }
if (-not $rejected) { throw "A non-OK document alarm was accepted." }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$platformSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "infrastructure\terraform\modules\platform\main.tf") -Raw
$documentSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "infrastructure\terraform\modules\platform\candidate-documents.tf") -Raw
foreach ($requiredSourceContract in @(
    "AllowEventBridgeDocumentScanQueueEncryption", "AllowEventBridgeDocumentOperationalAlertEncryption",
    "AllowExactDocumentOperationalRules", "ExactDocumentProcessorQueueOnly",
    "CoordinatorInvokesExactParserVersionOnly", "ExactLambdaRolesDatabaseSecretOnly"
  )) {
  if ($platformSource -notmatch [regex]::Escape($requiredSourceContract)) { throw "The semantic guard is detached from current platform policy source." }
}
if ($documentSource -notmatch "DenyQuarantineReadsWithoutCleanMalwareTag" -or
  $documentSource -notmatch 'document_scan_mapping_enabled\s*\?\s*"ENABLED"\s*:\s*"DISABLED"') {
  throw "The semantic guard is detached from current document isolation source."
}
if ($platformSource -notmatch 'platform_kms_key_arn\s*=\s*"arn:aws:kms:' -or
  @([regex]::Matches($platformSource, 'var\.document_processing_kms_prerequisite_enabled\s*\?\s*\[1\]\s*:\s*\[\]')).Count -ne 2) {
  throw "The KMS prerequisite is not isolated behind its exact plan-known source boundary."
}
foreach ($ruleName in @("document_scan_tag_failure", "document_scan_plan_unhealthy")) {
  $rulePattern = 'resource\s+"aws_cloudwatch_event_rule"\s+"' + $ruleName + '"(?s:.*?)state\s*=\s*"DISABLED"'
  if ($documentSource -notmatch $rulePattern) { throw "A document health rule is not explicitly dark." }
}

Write-Output "Development document dark guard tests passed: 94"
