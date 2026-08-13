Set-StrictMode -Version Latest

function ConvertTo-ExactBoolean {
  param(
    [Parameter(Mandatory)][AllowNull()][object]$Value,
    [string]$Label = "boolean"
  )
  if ($Value -is [bool]) { return $Value }
  if ($Value -is [string]) {
    if ($Value -ceq "true") { return $true }
    if ($Value -ceq "false") { return $false }
  }
  throw "$Label must be a runtime boolean or the exact lowercase string 'true' or 'false'."
}

function Get-DevelopmentDocumentBooleanVariableNames {
  return @(
    "database_performance_insights", "deploy_applications", "deploy_document_intake",
    "deploy_document_processing", "deploy_gateway_lambda", "deploy_profile_readiness_durable",
    "deploy_serverless_outbox", "document_scan_event_rule_enabled", "document_scan_mapping_enabled",
    "enable_container_insights", "enable_redis", "high_availability",
    "private_application_networking", "serverless_runtime_enabled"
  )
}

function ConvertTo-TerraformVariableEnvironmentValue {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowNull()][object]$Value
  )

  if ($null -eq $Value) {
    throw "Terraform variable '$Name' has an unsupported null value."
  }
  if ($Name -in @(Get-DevelopmentDocumentBooleanVariableNames)) {
    return (ConvertTo-ExactBoolean -Value $Value -Label "Terraform variable $Name").ToString().ToLowerInvariant()
  }
  if ($Value -is [string]) { return $Value }
  if ($Value -is [bool]) {
    throw "Non-boolean Terraform variable '$Name' cannot contain a boolean value."
  }

  $numericTypeCodes = @(
    [TypeCode]::Byte, [TypeCode]::SByte, [TypeCode]::Int16, [TypeCode]::UInt16,
    [TypeCode]::Int32, [TypeCode]::UInt32, [TypeCode]::Int64, [TypeCode]::UInt64,
    [TypeCode]::Single, [TypeCode]::Double, [TypeCode]::Decimal
  )
  if ($Value -is [IConvertible] -and [Convert]::GetTypeCode($Value) -in $numericTypeCodes) {
    return ConvertTo-DeploymentCanonicalValue -Value $Value
  }

  $isDictionary = $Value -is [System.Collections.IDictionary]
  $isSequence = $Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]
  $isObject = $Value -is [pscustomobject]
  if ($isDictionary -or $isSequence -or $isObject) {
    return ConvertTo-DeploymentCanonicalValue -Value $Value
  }
  throw "Terraform variable '$Name' has unsupported runtime type '$($Value.GetType().FullName)'."
}

function Get-TerraformVariableEnvironmentAssignments {
  param([Parameter(Mandatory)][object]$Variables)
  $assignments = @{}
  foreach ($property in @($Variables.PSObject.Properties)) {
    if ($null -eq $property.Value) { throw "Terraform variable '$($property.Name)' has no saved-plan record." }
    $valueProperty = $property.Value.PSObject.Properties["value"]
    if ($null -eq $valueProperty) { throw "Terraform variable '$($property.Name)' has no saved-plan value." }
    $assignments["TF_VAR_$($property.Name)"] = ConvertTo-TerraformVariableEnvironmentValue `
      -Name ([string]$property.Name) -Value $valueProperty.Value
  }
  return $assignments
}

function Get-DevelopmentDocumentDarkExpectedActions {
  $creates = @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]",
    "module.platform.aws_cloudwatch_event_target.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_target.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_target.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_target.document_scan_tag_failure[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_security_contradiction[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_parser_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_processor_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_scan_dead_letter[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_scan_queue_age[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_security_contradiction[0]",
    "module.platform.aws_iam_role.document_parser[0]",
    "module.platform.aws_iam_role.document_parser_object_access[0]",
    "module.platform.aws_iam_role.document_processor[0]",
    "module.platform.aws_iam_role_policy.document_parser[0]",
    "module.platform.aws_iam_role_policy.document_parser_object_access[0]",
    "module.platform.aws_iam_role_policy.document_processor[0]",
    "module.platform.aws_lambda_alias.document_parser[0]",
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_lambda_function.document_parser[0]",
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_permission.document_processing_reconciler[0]",
    "module.platform.aws_security_group.document_parser[0]",
    "module.platform.aws_sqs_queue.document_scan_dead_letter[0]",
    "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_sqs_queue.document_scan_results[0]",
    "module.platform.aws_sqs_queue_policy.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_sqs_queue_policy.document_scan_results[0]",
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )
  $updates = @(
    "module.platform.aws_kms_key.platform",
    "module.platform.aws_s3_bucket_policy.candidate_documents[0]",
    "module.platform.aws_sns_topic_policy.operational_alerts",
    "module.platform.aws_vpc_endpoint.lambda[0]",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]",
    "module.platform.aws_vpc_endpoint.sqs[0]"
  )
  $result = @{}
  foreach ($address in $creates) { $result[$address] = "create" }
  foreach ($address in $updates) { $result[$address] = "update" }
  return $result
}

function Get-TerraformStateResourceMap {
  param([Parameter(Mandatory)][object]$RootModule)
  $map = @{}
  function Add-ModuleResources {
    param([Parameter(Mandatory)][object]$Module)
    $resourcesProperty = $Module.PSObject.Properties["resources"]
    if ($null -ne $resourcesProperty) {
      foreach ($resource in @($resourcesProperty.Value)) {
        if ($null -ne $resource -and -not [string]::IsNullOrWhiteSpace([string]$resource.address)) {
          $map[[string]$resource.address] = $resource.values
        }
      }
    }
    $childrenProperty = $Module.PSObject.Properties["child_modules"]
    if ($null -ne $childrenProperty) {
      foreach ($child in @($childrenProperty.Value)) {
        if ($null -ne $child) { Add-ModuleResources -Module $child }
      }
    }
  }
  Add-ModuleResources -Module $RootModule
  return $map
}

function Assert-DevelopmentDocumentDarkVariables {
  param(
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$PlanVariables,
    [Parameter(Mandatory)][object]$Receipt
  )

  $processor = @($Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq "document-processor-lambda" -and [string]$_.suffix -ceq "zip"
    })
  $parser = @($Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq "document-parser-lambda" -and [string]$_.suffix -ceq "zip"
    })
  if ($processor.Count -ne 1 -or $parser.Count -ne 1) {
    throw "The publication receipt must contain one verified ZIP for each document Lambda."
  }
  $overlay = @{
    deploy_document_processing = $true
    document_scan_mapping_enabled = $false
    document_scan_event_rule_enabled = $false
    document_processor_artifact_s3_key = [string]$processor[0].key
    document_processor_artifact_s3_object_version = [string]$processor[0].versionId
    document_processor_artifact_sha256 = [string]$processor[0].artifactSha256
    document_processor_artifact_base64sha256 = [string]$processor[0].objectBase64Sha256
    document_parser_artifact_s3_key = [string]$parser[0].key
    document_parser_artifact_s3_object_version = [string]$parser[0].versionId
    document_parser_artifact_sha256 = [string]$parser[0].artifactSha256
    document_parser_artifact_base64sha256 = [string]$parser[0].objectBase64Sha256
    document_processor_extension_layer_arn = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  }
  $baselineProperties = @($BaselineVariables.PSObject.Properties)
  $planProperties = @($PlanVariables.PSObject.Properties)
  $booleanNames = @(Get-DevelopmentDocumentBooleanVariableNames)
  if ($baselineProperties.Count -ne $planProperties.Count) {
    throw "The dark plan variable set differs from the accepted baseline."
  }
  foreach ($property in $baselineProperties) {
    $name = [string]$property.Name
    $planned = $PlanVariables.PSObject.Properties[$name]
    if ($null -eq $planned) { throw "The dark plan omits baseline variable '$name'." }
    $expected = if ($overlay.ContainsKey($name)) { $overlay[$name] } else { $property.Value.value }
    if ($name -in $booleanNames) {
      $actualCanonical = ConvertTo-DeploymentCanonicalValue -Value `
        (ConvertTo-ExactBoolean -Value $planned.Value.value -Label "planned $name")
      $expectedCanonical = ConvertTo-DeploymentCanonicalValue -Value `
        (ConvertTo-ExactBoolean -Value $expected -Label "baseline $name")
    }
    else {
      $actualCanonical = ConvertTo-DeploymentCanonicalValue -Value $planned.Value.value
      $expectedCanonical = ConvertTo-DeploymentCanonicalValue -Value $expected
    }
    if ($actualCanonical -cne $expectedCanonical) {
      throw "The dark plan changed unapproved variable '$name'."
    }
  }
  if (-not (ConvertTo-ExactBoolean $PlanVariables.deploy_document_processing.value "deploy_document_processing") -or
    (ConvertTo-ExactBoolean $PlanVariables.document_scan_mapping_enabled.value "document_scan_mapping_enabled") -or
    (ConvertTo-ExactBoolean $PlanVariables.document_scan_event_rule_enabled.value "document_scan_event_rule_enabled")) {
    throw "Document processing must be deployed dark with both processing triggers disabled."
  }
}

function Assert-DevelopmentDocumentPublicationReceipt {
  param([Parameter(Mandatory)][object]$Receipt)

  if ([string]$Receipt.schemaVersion -cne "1" -or
    [string]$Receipt.kind -cne "development-document-lambda-publication" -or
    [string]$Receipt.environment -cne "development" -or
    [string]$Receipt.region -cne "us-east-2" -or
    [string]$Receipt.phase -cne "verified" -or
    [string]$Receipt.sourceSha -notmatch "^[a-f0-9]{40}$" -or
    [string]$Receipt.boundarySha256 -notmatch "^[a-f0-9]{64}$") {
    throw "The publication receipt identity or phase is invalid."
  }
  $artifacts = @($Receipt.artifacts)
  if ($artifacts.Count -ne 8) { throw "The verified publication receipt must contain exactly eight objects." }
  $expectedNames = @("document-processor-lambda", "document-parser-lambda")
  $expectedSuffixes = @("zip", "cdx.json", "manifest.json", "sha256")
  foreach ($name in $expectedNames) {
    foreach ($suffix in $expectedSuffixes) {
      $matches = @($artifacts | Where-Object {
          [string]$_.artifactName -ceq $name -and [string]$_.suffix -ceq $suffix
        })
      if ($matches.Count -ne 1) { throw "The receipt does not contain the exact document artifact matrix." }
      $artifact = $matches[0]
      $expectedKey = "lambda/documents/$($Receipt.sourceSha)/$($artifact.artifactSha256)/$name.$suffix"
      if ([string]$artifact.artifactSha256 -notmatch "^[a-f0-9]{64}$" -or
        [string]$artifact.objectSha256 -notmatch "^[a-f0-9]{64}$" -or
        [string]$artifact.objectBase64Sha256 -notmatch "^[A-Za-z0-9+/]{43}=$" -or
        [string]$artifact.key -cne $expectedKey -or
        [string]::IsNullOrWhiteSpace([string]$artifact.versionId) -or
        [long]$artifact.contentLength -le 0) {
        throw "The publication receipt contains an invalid immutable object entry."
      }
    }
  }
}

function Assert-ExactStringSet {
  param([AllowNull()][object]$Actual, [Parameter(Mandatory)][string[]]$Expected, [Parameter(Mandatory)][string]$Label)
  $actualValues = @($Actual | ForEach-Object { [string]$_ } | Sort-Object)
  $expectedValues = @($Expected | Sort-Object)
  if (($actualValues -join "|") -cne ($expectedValues -join "|")) { throw "Unexpected $Label." }
}

function Assert-ExactObjectKeys {
  param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string[]]$Expected, [Parameter(Mandatory)][string]$Label)
  $actual = @($Value.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($actual -join "|") -cne (@($Expected | Sort-Object) -join "|")) { throw "Unexpected $Label shape." }
}

function Assert-ExactCondition {
  param(
    [Parameter(Mandatory)][object]$Condition,
    [Parameter(Mandatory)][hashtable]$Expected
  )
  Assert-ExactObjectKeys -Value $Condition -Expected @($Expected.Keys) -Label "condition operators"
  foreach ($operator in $Expected.Keys) {
    $actualOperator = $Condition.PSObject.Properties[[string]$operator].Value
    $expectedEntries = $Expected[$operator]
    Assert-ExactObjectKeys -Value $actualOperator -Expected @($expectedEntries.Keys) -Label "$operator condition"
    foreach ($key in $expectedEntries.Keys) {
      Assert-ExactStringSet -Actual $actualOperator.PSObject.Properties[[string]$key].Value `
        -Expected @($expectedEntries[$key]) -Label "$operator/$key values"
    }
  }
}

function Assert-ExactAddedStatement {
  param(
    [Parameter(Mandatory)][object]$Statement,
    [Parameter(Mandatory)][ValidateSet("KmsQueue", "KmsAlerts", "CandidateDeny", "SnsAlerts", "SqsProcessor", "LambdaParser")][string]$Kind,
    [Parameter(Mandatory)][string]$AccountId,
    [string]$CandidateBucketArn = ""
  )
  $region = "us-east-2"
  $processorRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor"
  $baseKeys = @("Action", "Effect", "Principal", "Resource", "Sid")
  if ($Kind -notin @("SqsProcessor", "LambdaParser")) { $baseKeys += "Condition" }
  Assert-ExactObjectKeys -Value $Statement -Expected $baseKeys -Label "$Kind statement"
  if ([string]$Statement.Effect -cne $(if ($Kind -eq "CandidateDeny") { "Deny" } else { "Allow" })) {
    throw "Unexpected $Kind effect."
  }
  switch ($Kind) {
    "KmsQueue" {
      if ([string]$Statement.Sid -cne "AllowEventBridgeDocumentScanQueueEncryption") { throw "Unexpected KMS queue Sid." }
      Assert-ExactStringSet $Statement.Action @("kms:Decrypt", "kms:GenerateDataKey") "KMS queue actions"
      Assert-ExactStringSet $Statement.Resource @("*") "KMS queue resources"
      Assert-ExactObjectKeys $Statement.Principal @("Service") "KMS queue principal"
      Assert-ExactStringSet $Statement.Principal.Service @("events.amazonaws.com") "KMS queue principals"
      Assert-ExactCondition $Statement.Condition @{
        StringEquals = @{ "aws:SourceAccount" = @($AccountId) }
        ArnEquals = @{ "aws:SourceArn" = @(
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-scan-results",
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-processing-reconciler"
          ) }
      }
    }
    "KmsAlerts" {
      if ([string]$Statement.Sid -cne "AllowEventBridgeDocumentOperationalAlertEncryption") { throw "Unexpected KMS alert Sid." }
      Assert-ExactStringSet $Statement.Action @("kms:Decrypt", "kms:GenerateDataKey") "KMS alert actions"
      Assert-ExactStringSet $Statement.Resource @("*") "KMS alert resources"
      Assert-ExactObjectKeys $Statement.Principal @("Service") "KMS alert principal"
      Assert-ExactStringSet $Statement.Principal.Service @("events.amazonaws.com") "KMS alert principals"
      Assert-ExactCondition $Statement.Condition @{
        StringEquals = @{ "aws:SourceAccount" = @($AccountId) }
        ArnEquals = @{ "aws:SourceArn" = @(
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-scan-tag-failure",
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
          ) }
      }
    }
    "CandidateDeny" {
      if ([string]$Statement.Sid -cne "DenyQuarantineReadsWithoutCleanMalwareTag" -or
        $CandidateBucketArn -notmatch "^arn:aws:s3:::ai-job-apply-development-candidate-docs-[a-z0-9]+$") {
        throw "Unexpected candidate-document deny identity."
      }
      Assert-ExactStringSet $Statement.Action @("s3:GetObject", "s3:GetObjectVersion") "candidate deny actions"
      Assert-ExactStringSet $Statement.Resource @("$CandidateBucketArn/quarantine/*") "candidate deny resources"
      Assert-ExactObjectKeys $Statement.Principal @("AWS") "candidate deny principal"
      Assert-ExactStringSet $Statement.Principal.AWS @("*") "candidate deny principals"
      Assert-ExactCondition $Statement.Condition @{
        StringNotEquals = @{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = @("NO_THREATS_FOUND") }
        ArnNotEquals = @{ "aws:PrincipalArn" = @("arn:aws:iam::${AccountId}:role/ai-job-apply-development-guardduty-malware") }
      }
    }
    "SnsAlerts" {
      if ([string]$Statement.Sid -cne "AllowExactDocumentOperationalRules") { throw "Unexpected SNS Sid." }
      Assert-ExactStringSet $Statement.Action @("SNS:Publish") "SNS actions"
      Assert-ExactStringSet $Statement.Resource @("arn:aws:sns:${region}:${AccountId}:ai-job-apply-development-operational-alerts") "SNS resources"
      Assert-ExactObjectKeys $Statement.Principal @("Service") "SNS principal"
      Assert-ExactStringSet $Statement.Principal.Service @("events.amazonaws.com") "SNS principals"
      Assert-ExactCondition $Statement.Condition @{
        StringEquals = @{ "aws:SourceAccount" = @($AccountId) }
        ArnEquals = @{ "aws:SourceArn" = @(
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-scan-tag-failure",
            "arn:aws:events:${region}:${AccountId}:rule/ai-job-apply-development-document-scan-plan-unhealthy"
          ) }
      }
    }
    "SqsProcessor" {
      if ([string]$Statement.Sid -cne "ExactDocumentProcessorQueueOnly") { throw "Unexpected SQS Sid." }
      Assert-ExactStringSet $Statement.Action @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage") "SQS actions"
      Assert-ExactStringSet $Statement.Resource @("arn:aws:sqs:${region}:${AccountId}:ai-job-apply-development-document-scan-results") "SQS resources"
      Assert-ExactObjectKeys $Statement.Principal @("AWS") "SQS principal"
      Assert-ExactStringSet $Statement.Principal.AWS @($processorRole) "SQS principals"
    }
    "LambdaParser" {
      if ([string]$Statement.Sid -cne "CoordinatorInvokesExactParserVersionOnly") { throw "Unexpected Lambda Sid." }
      Assert-ExactStringSet $Statement.Action @("lambda:InvokeFunction") "Lambda actions"
      $resources = @($Statement.Resource)
      if ($resources.Count -ne 1 -or [string]$resources[0] -notmatch "^arn:aws:lambda:${region}:${AccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$") {
        throw "The Lambda endpoint does not name one immutable parser version."
      }
      Assert-ExactObjectKeys $Statement.Principal @("AWS") "Lambda principal"
      Assert-ExactStringSet $Statement.Principal.AWS @($processorRole) "Lambda principals"
    }
  }
}

function Get-PolicyAddedStatements {
  param(
    [Parameter(Mandatory)][object]$BeforePolicy,
    [Parameter(Mandatory)][object]$AfterPolicy,
    [Parameter(Mandatory)][string[]]$ExpectedAddedSids
  )
  $before = ConvertFrom-IamPolicyValue $BeforePolicy
  $after = ConvertFrom-IamPolicyValue $AfterPolicy
  if ([string]$before.Version -cne [string]$after.Version) { throw "A policy version changed." }
  $beforeStatements = @($before.Statement)
  $afterStatements = @($after.Statement)
  foreach ($set in @($beforeStatements, $afterStatements)) {
    if (@($set | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Sid) }).Count -ne 0 -or
      @($set | Group-Object Sid | Where-Object Count -ne 1).Count -ne 0) { throw "Policy Sids must be unique." }
  }
  $added = @($afterStatements | Where-Object { [string]$_.Sid -notin @($beforeStatements | ForEach-Object Sid) })
  if ((@($added | ForEach-Object Sid | Sort-Object) -join "|") -cne (@($ExpectedAddedSids | Sort-Object) -join "|")) {
    throw "A policy added an unexpected statement."
  }
  foreach ($statement in $beforeStatements) {
    $match = @($afterStatements | Where-Object { [string]$_.Sid -ceq [string]$statement.Sid })
    if ($match.Count -ne 1 -or
      (ConvertTo-DeploymentCanonicalValue $statement -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue $match[0] -SortArrays)) { throw "An existing policy statement changed." }
  }
  return $added
}

function Assert-OnlyPolicyAttributeChanged {
  param([Parameter(Mandatory)][object]$Change)
  $afterCopy = $Change.after | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $afterCopy.policy = $Change.before.policy
  if ((ConvertTo-DeploymentCanonicalValue $Change.before -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $afterCopy -SortArrays)) { throw "An approved update changed more than its policy document." }
  $unknownPolicy = $Change.after_unknown.PSObject.Properties["policy"]
  $sensitivePolicy = $Change.after_sensitive.PSObject.Properties["policy"]
  if ((ConvertTo-DeploymentCanonicalValue $Change.before_sensitive -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $Change.after_sensitive -SortArrays) -or
    ($null -ne $unknownPolicy -and (ConvertTo-DeploymentCanonicalValue $unknownPolicy.Value -SortArrays) -match 'true') -or
    ($null -ne $sensitivePolicy -and (ConvertTo-DeploymentCanonicalValue $sensitivePolicy.Value -SortArrays) -match 'true')) {
    throw "An approved update changed sensitivity or contains an unknown result."
  }
}

function Assert-SecretEndpointPolicyDelta {
  param([Parameter(Mandatory)][object]$BeforePolicy, [Parameter(Mandatory)][object]$AfterPolicy, [Parameter(Mandatory)][string]$AccountId)
  $before = ConvertFrom-IamPolicyValue $BeforePolicy
  $after = ConvertFrom-IamPolicyValue $AfterPolicy
  $beforeStatements = @($before.Statement); $afterStatements = @($after.Statement)
  if ([string]$before.Version -cne [string]$after.Version -or $beforeStatements.Count -ne $afterStatements.Count) {
    throw "The Secrets endpoint policy structure changed."
  }
  foreach ($statement in $beforeStatements) {
    $match = @($afterStatements | Where-Object { [string]$_.Sid -ceq [string]$statement.Sid })
    if ($match.Count -ne 1) { throw "A Secrets endpoint statement was added or removed." }
    if ([string]$statement.Sid -cne "ExactLambdaRolesDatabaseSecretOnly") {
      if ((ConvertTo-DeploymentCanonicalValue $statement -SortArrays) -cne (ConvertTo-DeploymentCanonicalValue $match[0] -SortArrays)) {
        throw "An unrelated Secrets endpoint statement changed."
      }
      continue
    }
    $beforeValues = @($statement.Condition.ArnEquals."aws:PrincipalArn")
    $afterValues = @($match[0].Condition.ArnEquals."aws:PrincipalArn")
    $processor = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor"
    if (@($afterValues | Where-Object { [string]$_ -cne $processor -and [string]$_ -notin @($beforeValues | ForEach-Object { [string]$_ }) }).Count -ne 0 -or
      @($afterValues | Where-Object { [string]$_ -ceq $processor }).Count -ne 1 -or
      $afterValues.Count -ne ($beforeValues.Count + 1)) { throw "The Secrets endpoint added more than the exact processor role." }
    $copy = $match[0] | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $copy.Condition.ArnEquals."aws:PrincipalArn" = $statement.Condition.ArnEquals."aws:PrincipalArn"
    if ((ConvertTo-DeploymentCanonicalValue $statement -SortArrays) -cne (ConvertTo-DeploymentCanonicalValue $copy -SortArrays)) {
      throw "The Secrets endpoint broadened another permission."
    }
  }
}

function Assert-ApprovedPolicyUpdateSemantics {
  param([Parameter(Mandatory)][object[]]$Changes, [Parameter(Mandatory)][string]$AccountId)
  $byAddress = @{}; foreach ($change in $Changes) { $byAddress[[string]$change.address] = $change }
  $expectedActions = Get-DevelopmentDocumentDarkExpectedActions
  foreach ($address in @($expectedActions.Keys | Where-Object { $expectedActions[$_] -eq "update" })) {
    Assert-OnlyPolicyAttributeChanged $byAddress[$address].change
  }
  $kms = Get-PolicyAddedStatements $byAddress["module.platform.aws_kms_key.platform"].change.before.policy `
    $byAddress["module.platform.aws_kms_key.platform"].change.after.policy `
    @("AllowEventBridgeDocumentScanQueueEncryption", "AllowEventBridgeDocumentOperationalAlertEncryption")
  Assert-ExactAddedStatement @($kms | Where-Object Sid -eq "AllowEventBridgeDocumentScanQueueEncryption")[0] KmsQueue $AccountId
  Assert-ExactAddedStatement @($kms | Where-Object Sid -eq "AllowEventBridgeDocumentOperationalAlertEncryption")[0] KmsAlerts $AccountId

  $s3Change = $byAddress["module.platform.aws_s3_bucket_policy.candidate_documents[0]"].change
  $beforeS3 = ConvertFrom-IamPolicyValue $s3Change.before.policy
  $transport = @($beforeS3.Statement | Where-Object Sid -eq "DenyInsecureTransport")[0]
  $bucketArn = @($transport.Resource | Where-Object { [string]$_ -notlike "*/*" })[0]
  $s3 = Get-PolicyAddedStatements $s3Change.before.policy $s3Change.after.policy @("DenyQuarantineReadsWithoutCleanMalwareTag")
  Assert-ExactAddedStatement $s3[0] CandidateDeny $AccountId $bucketArn

  $sns = $byAddress["module.platform.aws_sns_topic_policy.operational_alerts"].change
  $addedSns = Get-PolicyAddedStatements $sns.before.policy $sns.after.policy @("AllowExactDocumentOperationalRules")
  Assert-ExactAddedStatement $addedSns[0] SnsAlerts $AccountId
  $sqs = $byAddress["module.platform.aws_vpc_endpoint.sqs[0]"].change
  $addedSqs = Get-PolicyAddedStatements $sqs.before.policy $sqs.after.policy @("ExactDocumentProcessorQueueOnly")
  Assert-ExactAddedStatement $addedSqs[0] SqsProcessor $AccountId
  $lambda = $byAddress["module.platform.aws_vpc_endpoint.lambda[0]"].change
  $addedLambda = Get-PolicyAddedStatements $lambda.before.policy $lambda.after.policy @("CoordinatorInvokesExactParserVersionOnly")
  Assert-ExactAddedStatement $addedLambda[0] LambdaParser $AccountId
  $secrets = $byAddress["module.platform.aws_vpc_endpoint.secretsmanager[0]"].change
  Assert-SecretEndpointPolicyDelta $secrets.before.policy $secrets.after.policy $AccountId
}

function Assert-ExactDocumentLambdaRuntime {
  param(
    [Parameter(Mandatory)][object]$Configuration,
    [Parameter(Mandatory)][object]$Concurrency,
    [Parameter(Mandatory)][ValidateSet("processor", "parser")][string]$Kind,
    [Parameter(Mandatory)][string]$ExpectedRoleArn,
    [Parameter(Mandatory)][string]$ExpectedKmsArn,
    [Parameter(Mandatory)][string]$ExpectedVpcId,
    [Parameter(Mandatory)][string[]]$ExpectedSubnetIds,
    [Parameter(Mandatory)][string]$ExpectedSecurityGroupId,
    [Parameter(Mandatory)][hashtable]$ExpectedEnvironment,
    [string]$ExpectedLogGroup = "",
    [string]$ExpectedExtensionLayerArn = ""
  )
  $expectedMemory = if ($Kind -eq "processor") { 1024 } else { 1536 }
  $expectedTimeout = if ($Kind -eq "processor") { 60 } else { 45 }
  if ([string]$Configuration.State -cne "Active" -or
    [string]$Configuration.LastUpdateStatus -cne "Successful" -or
    [string]$Configuration.Runtime -cne "nodejs24.x" -or
    [string]$Configuration.Handler -cne "index.handler" -or
    [string]$Configuration.PackageType -cne "Zip" -or
    [int]$Configuration.MemorySize -ne $expectedMemory -or [int]$Configuration.Timeout -ne $expectedTimeout -or
    [int]$Configuration.EphemeralStorage.Size -ne 512 -or
    [string]$Configuration.Role -cne $ExpectedRoleArn -or [string]$Configuration.KMSKeyArn -cne $ExpectedKmsArn -or
    [int]$Concurrency.ReservedConcurrentExecutions -ne 2) { throw "The $Kind Lambda execution configuration is not exact." }
  Assert-ExactStringSet $Configuration.Architectures @("x86_64") "$Kind architecture"
  Assert-ExactStringSet $Configuration.VpcConfig.SubnetIds $ExpectedSubnetIds "$Kind subnets"
  Assert-ExactStringSet $Configuration.VpcConfig.SecurityGroupIds @($ExpectedSecurityGroupId) "$Kind security groups"
  if ([string]$Configuration.VpcConfig.VpcId -cne $ExpectedVpcId) { throw "The $Kind Lambda uses the wrong VPC." }
  $actualEnvironment = @{}; foreach ($property in @($Configuration.Environment.Variables.PSObject.Properties)) {
    $actualEnvironment[$property.Name] = [string]$property.Value
  }
  if ((ConvertTo-DeploymentCanonicalValue $actualEnvironment) -cne (ConvertTo-DeploymentCanonicalValue $ExpectedEnvironment)) {
    throw "The $Kind Lambda environment is not exact."
  }
  $layersProperty = $Configuration.PSObject.Properties["Layers"]
  $layers = @()
  if ($null -ne $layersProperty) { $layers = @($layersProperty.Value | ForEach-Object Arn) }
  if ($Kind -eq "processor") {
    Assert-ExactStringSet $layers @($ExpectedExtensionLayerArn) "processor layers"
    if ([string]$Configuration.TracingConfig.Mode -cne "Active" -or
      [string]$Configuration.LoggingConfig.LogFormat -cne "JSON" -or
      [string]$Configuration.LoggingConfig.ApplicationLogLevel -cne "INFO" -or
      [string]$Configuration.LoggingConfig.SystemLogLevel -cne "WARN" -or
      [string]$Configuration.LoggingConfig.LogGroup -cne $ExpectedLogGroup) {
      throw "The processor tracing/logging configuration is not exact."
    }
  }
  else {
    $parserLogging = $Configuration.PSObject.Properties["LoggingConfig"]
    $parserLogGroup = if ($null -eq $parserLogging) { "" } else { [string]$parserLogging.Value.LogGroup }
    if ($layers.Count -ne 0 -or [string]$Configuration.TracingConfig.Mode -cne "PassThrough" -or
      $parserLogGroup -eq $ExpectedLogGroup -or
      $actualEnvironment.ContainsKey("DATABASE_SECRET_ID")) {
      throw "The parser is not isolated from layers, active tracing, shared logs, and database secrets."
    }
  }
}

function Assert-ExactDocumentQueueAttributes {
  param(
    [Parameter(Mandatory)][object]$Attributes,
    [Parameter(Mandatory)][string]$ExpectedKmsArn,
    [Parameter(Mandatory)][int]$ExpectedRetention,
    [Parameter(Mandatory)][int]$ExpectedVisibility,
    [string]$ExpectedDeadLetterArn = ""
  )
  if ([string]$Attributes.KmsMasterKeyId -cne $ExpectedKmsArn -or [int]$Attributes.DelaySeconds -ne 0 -or
    [int]$Attributes.MessageRetentionPeriod -ne $ExpectedRetention -or
    [int]$Attributes.VisibilityTimeout -ne $ExpectedVisibility -or
    [long]$Attributes.ApproximateNumberOfMessages -ne 0 -or
    [long]$Attributes.ApproximateNumberOfMessagesNotVisible -ne 0 -or
    [long]$Attributes.ApproximateNumberOfMessagesDelayed -ne 0) { throw "A document queue is not exact, encrypted, empty, and delay-free." }
  if ([string]::IsNullOrWhiteSpace($ExpectedDeadLetterArn)) {
    if ($null -ne $Attributes.PSObject.Properties["RedrivePolicy"] -and
      -not [string]::IsNullOrWhiteSpace([string]$Attributes.RedrivePolicy)) { throw "A terminal document queue has an unexpected redrive policy." }
  }
  else {
    $redrive = [string]$Attributes.RedrivePolicy | ConvertFrom-Json
    if ([string]$redrive.deadLetterTargetArn -cne $ExpectedDeadLetterArn -or [int]$redrive.maxReceiveCount -ne 5) {
      throw "The document scan queue redrive policy is not exact."
    }
  }
}

function Assert-ExactDocumentAlarmSet {
  param([Parameter(Mandatory)][object[]]$Alarms, [Parameter(Mandatory)][string[]]$ExpectedNames, [Parameter(Mandatory)][string]$TopicArn)
  if ((@($Alarms.AlarmName | Sort-Object) -join "|") -cne (@($ExpectedNames | Sort-Object) -join "|")) {
    throw "The exact document alarm set is not present."
  }
  foreach ($alarm in $Alarms) {
    if (-not (ConvertTo-ExactBoolean $alarm.ActionsEnabled "alarm ActionsEnabled") -or [string]$alarm.StateValue -cne "OK") { throw "A document alarm is not actionable and OK." }
    Assert-ExactStringSet $alarm.AlarmActions @($TopicArn) "alarm actions"
    Assert-ExactStringSet $alarm.OKActions @($TopicArn) "alarm recovery actions"
  }
}

function Assert-DevelopmentDocumentDarkPlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string]$AccountId)

  $expected = Get-DevelopmentDocumentDarkExpectedActions
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" })
  if ($changes.Count -ne $expected.Count) {
    throw "The dark plan has $($changes.Count) changes; exactly $($expected.Count) are approved."
  }
  foreach ($change in $changes) {
    $address = [string]$change.address
    if (-not $expected.ContainsKey($address)) { throw "The dark plan changes an unapproved resource: $address." }
    $action = @($change.change.actions) -join ","
    if ($action -cne $expected[$address]) { throw "The dark plan action for '$address' must be '$($expected[$address])'." }
  }

  $scanRule = @($changes | Where-Object address -eq "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]")[0]
  $reconciler = @($changes | Where-Object address -eq "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]")[0]
  $mapping = @($changes | Where-Object address -eq "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]")[0]
  if ([string]$scanRule.change.after.state -cne "DISABLED" -or
    [string]$reconciler.change.after.state -cne "DISABLED" -or
    (ConvertTo-ExactBoolean $mapping.change.after.enabled "document mapping enabled")) {
    throw "The scan rule, queue mapping, and reconciler must all be disabled in the dark plan."
  }
  Assert-ApprovedPolicyUpdateSemantics -Changes $changes -AccountId $AccountId
  return $changes
}
