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
  gateway_lambda_reserved_concurrency = [pscustomobject]@{ value = 2 }
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
  (ConvertTo-DevelopmentDocumentComparableVariableValue gateway_lambda_reserved_concurrency 2)) {
  throw "Equivalent serialized and structured numeric values do not compare canonically."
}
if ((ConvertTo-DevelopmentDocumentComparableVariableValue oidc_audience '["literal-string"]' -SerializedBaseline) -cne
  (ConvertTo-DevelopmentDocumentComparableVariableValue oidc_audience '["literal-string"]')) {
  throw "A JSON-looking string variable did not remain an exact string."
}

$expected = Get-DevelopmentDocumentDarkExpectedActions
if ($expected.Count -ne 45) { throw "Expected 45 exact dark deployment changes." }
if (@($expected.Values | Where-Object { $_ -eq "create" }).Count -ne 39) { throw "Expected 39 creates." }
if (@($expected.Values | Where-Object { $_ -eq "update" }).Count -ne 6) { throw "Expected six updates." }

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

$changes = @()
foreach ($entry in $expected.GetEnumerator()) {
  $after = [pscustomobject]@{}
  if ($entry.Key -eq "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]" -or
    $entry.Key -eq "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]") {
    $after | Add-Member state "DISABLED"
  }
  if ($entry.Key -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]") {
    $after | Add-Member enabled $false
  }
  $change = if ($entry.Value -eq "update") { $updates[$entry.Key] }
    else { [pscustomobject]@{ actions = @($entry.Value); after = $after } }
  $changes += [pscustomobject]@{ address = $entry.Key; change = $change }
}
$plan = [pscustomobject]@{ resource_changes = $changes }
$null = Assert-DevelopmentDocumentDarkPlan -Plan $plan -AccountId $account

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
  oidc_audience = [pscustomobject]@{ value = "same" }
}
$planVariables = $baselineVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$planVariables.deploy_document_processing.value = "true"
$planVariables.candidate_document_cors_allowed_origins.value = @("https://app.example")
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
$differentCompositeVariables = $planVariables | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$differentCompositeVariables.candidate_document_cors_allowed_origins.value = @("https://other.example")
$rejected = $false
try { Assert-DevelopmentDocumentDarkVariables -BaselineVariables $baselineVariables -PlanVariables $differentCompositeVariables -Receipt $receipt } catch { $rejected = $true }
if (-not $rejected) { throw "A semantically different composite variable was accepted." }
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

Write-Output "Development document dark guard tests passed: 44"
