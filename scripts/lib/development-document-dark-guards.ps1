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
    "candidate_rights_auth0_secret_provisioned", "candidate_rights_enabled",
    "database_performance_insights", "deploy_applications", "deploy_document_intake",
    "deploy_gateway_lambda", "deploy_ingestion_runtime", "deploy_profile_readiness_durable",
    "deploy_public_job_reader", "deploy_serverless_outbox",
    "document_scan_event_rule_enabled", "document_scan_mapping_enabled", "document_security_health_rules_enabled",
    "enable_container_insights", "enable_redis", "high_availability",
    "ingestion_provider_activation_allowed", "ingestion_provider_private_egress",
    "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled",
    "private_application_networking", "public_job_cluster_residual_accepted",
    "public_job_route_activation_allowed", "serverless_runtime_enabled"
  )
}

function Get-DevelopmentDocumentVariableKinds {
  $kinds = @{}
  foreach ($name in @(Get-DevelopmentDocumentBooleanVariableNames)) { $kinds[$name] = "boolean" }
  foreach ($name in @(
      "candidate_rights_backup_retention_days", "candidate_rights_download_grant_seconds",
      "candidate_rights_export_lifecycle_days", "candidate_rights_export_lifetime_seconds",
      "candidate_rights_recent_auth_max_age_seconds", "database_backup_retention_days",
      "gateway_lambda_reserved_concurrency", "ingestion_execution_timeout_seconds",
      "ingestion_retention_days", "profile_readiness_execution_timeout_seconds",
      "profile_readiness_retention_days", "public_job_route_throttling_burst_limit",
      "public_job_route_throttling_rate_limit"
    )) { $kinds[$name] = "number" }
  $kinds["candidate_document_cors_allowed_origins"] = "composite"
  $kinds["ingestion_provider_sources"] = "composite"
  foreach ($name in @(
      "candidate_rights_auth0_authorized_owner", "candidate_rights_id_token_audience",
      "candidate_rights_owner_inventory", "candidate_rights_policy_sha256",
      "candidate_rights_policy_version", "candidate_rights_subprocessor_inventory",
      "database_engine_version", "database_instance_class", "document_parser_artifact_base64sha256",
      "document_parser_invocation_qualified_arn", "document_processing_deployment_stage",
      "document_parser_artifact_s3_key", "document_parser_artifact_s3_object_version",
      "document_parser_artifact_sha256", "document_parser_version",
      "document_processor_artifact_base64sha256", "document_processor_artifact_s3_key",
      "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
      "document_processor_extension_layer_arn", "gateway_lambda_artifact_base64sha256",
      "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
      "gateway_lambda_artifact_sha256", "gateway_lambda_extension_layer_arn",
      "ingestion_durable_artifact_base64sha256", "ingestion_durable_artifact_s3_key",
      "ingestion_durable_artifact_s3_object_version", "ingestion_durable_artifact_sha256",
      "ingestion_lambda_extension_layer_arn", "ingestion_runtime_artifact_base64sha256",
      "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
      "ingestion_runtime_artifact_sha256", "ingestion_synthetic_seed", "migration_image",
      "oidc_audience", "oidc_issuer", "profile_readiness_activity_artifact_base64sha256",
      "profile_readiness_activity_artifact_s3_key", "profile_readiness_activity_artifact_s3_object_version",
      "profile_readiness_activity_artifact_sha256", "profile_readiness_durable_artifact_base64sha256",
      "profile_readiness_durable_artifact_s3_key", "profile_readiness_durable_artifact_s3_object_version",
      "profile_readiness_durable_artifact_sha256", "profile_readiness_lambda_extension_layer_arn",
      "public_job_database_boundary_version", "public_job_lambda_artifact_base64sha256",
      "public_job_lambda_artifact_s3_key", "public_job_lambda_artifact_s3_object_version",
      "public_job_lambda_artifact_sha256", "public_job_projection_artifact_base64sha256",
      "public_job_projection_artifact_s3_key", "public_job_projection_artifact_s3_object_version",
      "public_job_projection_artifact_sha256",
      "workflow_ingress_artifact_base64sha256", "workflow_ingress_artifact_s3_key",
      "workflow_ingress_artifact_s3_object_version", "workflow_ingress_artifact_sha256",
      "workflow_ingress_lambda_extension_layer_arn"
    )) { $kinds[$name] = "string" }
  return $kinds
}

function ConvertTo-TerraformCanonicalNumber {
  param([Parameter(Mandatory)][AllowNull()][object]$Value, [string]$Label = "Terraform number")
  if ($null -eq $Value -or $Value -is [bool]) { throw "$Label must be a finite numeric value." }
  $invariant = [Globalization.CultureInfo]::InvariantCulture
  $number = $null
  if ($Value -is [string]) {
    if ($Value -cnotmatch '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$') {
      throw "$Label must use exact invariant non-exponent numeric syntax."
    }
    try {
      $number = [decimal]::Parse($Value,
        [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint,
        $invariant)
    }
    catch { throw "$Label is outside the supported exact decimal range." }
  }
  else {
    $supported = $Value -is [sbyte] -or $Value -is [byte] -or
      $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or
      $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or
      $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]
    if (-not $supported -or
      ($Value -is [single] -and ([single]::IsNaN($Value) -or [single]::IsInfinity($Value))) -or
      ($Value -is [double] -and ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)))) {
      throw "$Label must be a supported finite CLR numeric value."
    }
    try { $number = [Convert]::ToDecimal($Value, $invariant) }
    catch { throw "$Label is outside the supported exact decimal range." }
  }
  return $number.ToString("G29", $invariant)
}

function ConvertTo-TerraformCompositeCanonicalValue {
  param([Parameter(Mandatory)][AllowNull()][object]$Value, [string]$Label = "Terraform composite")
  if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) {
    throw "$Label must be a structured list, map, object, tuple, or set value."
  }
  $isDictionary = $Value -is [System.Collections.IDictionary]
  $isSequence = $Value -is [System.Collections.IEnumerable]
  $isObject = $Value -is [pscustomobject]
  if (-not ($isDictionary -or $isSequence -or $isObject)) {
    throw "$Label has an unsupported runtime type."
  }
  return ConvertTo-DeploymentCanonicalValue -Value $Value
}

function ConvertFrom-TerraformCompositeJson {
  param([Parameter(Mandatory)][string]$Json, [string]$Label = "Terraform composite")
  $trimmed = $Json.Trim()
  if (-not ($trimmed.StartsWith("[") -or $trimmed.StartsWith("{"))) {
    throw "$Label must be a JSON array or object."
  }
  try {
    if ($trimmed.StartsWith("[")) {
      $parsedArray = $trimmed | ConvertFrom-Json
      if ($parsedArray -is [array]) { return ,$parsedArray }
      return ,@($parsedArray)
    }
    return $trimmed | ConvertFrom-Json
  }
  catch { throw "$Label is not valid composite JSON." }
}

function ConvertTo-DevelopmentDocumentComparableVariableValue {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowNull()][object]$Value,
    [switch]$SerializedBaseline
  )
  $kinds = Get-DevelopmentDocumentVariableKinds
  if (-not $kinds.ContainsKey($Name)) { throw "Unknown development Terraform variable '$Name'." }
  if ($null -eq $Value) { throw "Terraform variable '$Name' cannot be null." }
  switch ($kinds[$Name]) {
    "boolean" { return ConvertTo-DeploymentCanonicalValue (ConvertTo-ExactBoolean $Value "Terraform variable $Name") }
    "string" {
      if ($Value -isnot [string]) { throw "Terraform variable '$Name' must remain a string." }
      return ConvertTo-DeploymentCanonicalValue $Value
    }
    "number" {
      return ConvertTo-TerraformCanonicalNumber $Value "Terraform variable $Name"
    }
    "composite" {
      $normalized = $Value
      if ($SerializedBaseline -and $Value -is [string]) {
        $normalized = ConvertFrom-TerraformCompositeJson $Value "Terraform variable $Name"
      }
      elseif (-not $SerializedBaseline -and $Value -is [string]) {
        throw "Fresh-plan Terraform variable '$Name' must be structured."
      }
      return ConvertTo-TerraformCompositeCanonicalValue $normalized "Terraform variable $Name"
    }
  }
}

function ConvertTo-TerraformVariableEnvironmentValue {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowNull()][object]$Value
  )

  $kinds = Get-DevelopmentDocumentVariableKinds
  if (-not $kinds.ContainsKey($Name)) { throw "Unknown development Terraform variable '$Name'." }
  $null = ConvertTo-DevelopmentDocumentComparableVariableValue -Name $Name -Value $Value -SerializedBaseline
  switch ($kinds[$Name]) {
    "boolean" { return (ConvertTo-ExactBoolean $Value "Terraform variable $Name").ToString().ToLowerInvariant() }
    "string" { return [string]$Value }
    "number" {
      return ConvertTo-TerraformCanonicalNumber $Value "Terraform variable $Name"
    }
    "composite" {
      if ($Value -is [string]) {
        return ConvertTo-TerraformCompositeCanonicalValue `
          (ConvertFrom-TerraformCompositeJson $Value "Terraform variable $Name") "Terraform variable $Name"
      }
      return ConvertTo-TerraformCompositeCanonicalValue $Value "Terraform variable $Name"
    }
  }
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

function Get-DevelopmentDocumentStageExpectedActions {
  param(
    [Parameter(Mandatory)][ValidateSet("kms-prerequisite", "parser-dark", "complete-dark")][string]$Stage,
    [switch]$ParserSourceTransition,
    [switch]$CompleteDarkParserRefresh,
    [switch]$CompleteDarkProcessorRefresh
  )
  if (@(@($ParserSourceTransition, $CompleteDarkParserRefresh, $CompleteDarkProcessorRefresh) |
      Where-Object { $_ }).Count -gt 1) {
    throw "A CompleteDark plan may select only one artifact-transition mode."
  }
  if ($ParserSourceTransition -and $Stage -cne "complete-dark") {
    throw "A parser source transition is permitted only while advancing to complete-dark."
  }
  if (($CompleteDarkParserRefresh -or $CompleteDarkProcessorRefresh) -and $Stage -cne "complete-dark") {
    throw "A CompleteDark refresh is permitted only while already complete-dark."
  }
  if ($Stage -ceq "kms-prerequisite") {
    return @{ "module.platform.aws_kms_key.platform" = "update" }
  }
  $parserCreates = @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]",
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
    "module.platform.aws_lambda_alias.document_parser[0]",
    "module.platform.aws_lambda_function.document_parser[0]",
    "module.platform.aws_security_group.document_parser[0]",
    "module.platform.aws_sqs_queue.document_scan_dead_letter[0]",
    "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_sqs_queue.document_scan_results[0]",
    "module.platform.aws_sqs_queue_policy.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_sqs_queue_policy.document_scan_results[0]",
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
  )
  $parserUpdates = @(
    "module.platform.aws_s3_bucket_policy.candidate_documents[0]",
    "module.platform.aws_sns_topic_policy.operational_alerts"
  )
  $completeCreates = @(
    "module.platform.aws_cloudwatch_event_target.document_processing_reconciler[0]",
    "module.platform.aws_iam_role_policy.document_processor[0]",
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_permission.document_processing_reconciler[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )
  $completeUpdates = @(
    "module.platform.aws_vpc_endpoint.lambda[0]",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]",
    "module.platform.aws_vpc_endpoint.sqs[0]"
  )
  if ($CompleteDarkParserRefresh) {
    return @{
      "module.platform.aws_lambda_function.document_parser[0]" = "update"
      "module.platform.aws_lambda_alias.document_parser[0]" = "update"
    }
  }
  if ($CompleteDarkProcessorRefresh) {
    return @{
      "module.platform.aws_iam_role_policy.document_processor[0]" = "update"
      "module.platform.aws_lambda_function.document_processor[0]" = "update"
      "module.platform.aws_lambda_alias.document_processor[0]" = "update"
    }
  }
  $result = @{}
  $creates = if ($Stage -ceq "parser-dark") { $parserCreates } else { $completeCreates }
  $updates = if ($Stage -ceq "parser-dark") { $parserUpdates } else { $completeUpdates }
  foreach ($address in $creates) { $result[$address] = "create" }
  foreach ($address in $updates) { $result[$address] = "update" }
  if ($ParserSourceTransition) {
    $result["module.platform.aws_lambda_function.document_parser[0]"] = "update"
    $result["module.platform.aws_lambda_alias.document_parser[0]"] = "update"
  }
  return $result
}

function Get-DevelopmentDocumentDarkExpectedActions { return Get-DevelopmentDocumentStageExpectedActions -Stage "complete-dark" }

function Get-DevelopmentDocumentDarkExpectedDataReads { return @() }

function Assert-DevelopmentDocumentStageResourceInventory {
  param(
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage,
    [Parameter(Mandatory)][string[]]$StateAddresses,
    [Parameter(Mandatory)][object]$LiveInventory
  )
  $laterStage = @(
    "module.platform.aws_cloudwatch_event_target.document_processing_reconciler[0]",
    "module.platform.aws_iam_role_policy.document_processor[0]",
    "module.platform.aws_lambda_alias.document_processor[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_lambda_permission.document_processing_reconciler[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )
  $requiredParser = @(
    "module.platform.aws_iam_role.document_processor[0]",
    "module.platform.aws_iam_role.document_parser[0]",
    "module.platform.aws_iam_role.document_parser_object_access[0]",
    "module.platform.aws_lambda_alias.document_parser[0]",
    "module.platform.aws_lambda_function.document_parser[0]",
    "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
  )
  foreach ($address in $requiredParser) {
    if ($address -notin $StateAddresses) { throw "The staged document state is missing '$address'." }
  }
  if ($Stage -ceq "parser-dark") {
    foreach ($address in $laterStage) {
      if ($address -in $StateAddresses) { throw "Parser-dark contains later-stage resource '$address'." }
    }
    foreach ($name in @("ProcessorFunctions", "ProcessorAliases", "ProcessorMappings", "StsEndpoints", "ReconcilerTargets", "ReconcilerPermissions", "ProcessorInlinePolicies", "LaterStageEndpointGrants")) {
      $property = $LiveInventory.PSObject.Properties[$name]
      if ($null -eq $property -or [int]$property.Value -ne 0) { throw "Parser-dark live inventory contains or cannot prove absence of '$name'." }
    }
  }
  else {
    foreach ($address in $laterStage) {
      if ($address -notin $StateAddresses) { throw "Complete-dark is missing '$address'." }
    }
    foreach ($name in @("ProcessorFunctions", "ProcessorAliases", "ProcessorMappings", "StsEndpoints", "ReconcilerTargets", "ReconcilerPermissions", "ProcessorInlinePolicies")) {
      $property = $LiveInventory.PSObject.Properties[$name]
      if ($null -eq $property -or [int]$property.Value -ne 1) { throw "Complete-dark live inventory is not exact for '$name'." }
    }
    $endpointGrants = $LiveInventory.PSObject.Properties["LaterStageEndpointGrants"]
    if ($null -eq $endpointGrants -or [int]$endpointGrants.Value -ne 3) {
      throw "Complete-dark must contain exactly three later-stage endpoint grants."
    }
  }
  $known = @((Get-DevelopmentDocumentStageExpectedActions -Stage "parser-dark").Keys) + $laterStage
  $documentOwnedPattern = '^module\.platform\.aws_[^.]+\.document_[A-Za-z0-9_]+(?:\[[0-9]+\])?$'
  $unmanaged = @($StateAddresses | Where-Object { $_ -match $documentOwnedPattern -and $_ -notin $known })
  if ($unmanaged.Count -ne 0) { throw "The document stage contains an unmanaged or unexpected runtime resource: $($unmanaged -join ', ')." }
}

function Get-DevelopmentDocumentLaterStageEndpointGrantCount {
  param(
    [Parameter(Mandatory)][object[]]$Policies,
    [Parameter(Mandatory)][ValidatePattern("^[0-9]{12}$")][string]$AccountId
  )
  $processorArn = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor"
  $conditionlessSids = @("ExactDocumentProcessorQueueOnly", "CoordinatorInvokesExactParserVersionOnly")
  $count = 0
  foreach ($policy in $Policies) {
    if ($null -eq $policy) { throw "A live endpoint policy is null." }
    $statementsProperty = $policy.PSObject.Properties["Statement"]
    if ($null -eq $statementsProperty -or $null -eq $statementsProperty.Value) {
      throw "A live endpoint policy lacks statements."
    }
    foreach ($statement in @($statementsProperty.Value)) {
      if ($null -eq $statement) { throw "A live endpoint policy contains a null statement." }
      $sidProperty = $statement.PSObject.Properties["Sid"]
      $sid = if ($null -eq $sidProperty -or $null -eq $sidProperty.Value) { "" } else { [string]$sidProperty.Value }
      $conditionProperty = $statement.PSObject.Properties["Condition"]

      if ($sid -in $conditionlessSids) {
        if ($null -ne $conditionProperty) {
          throw "The '$sid' endpoint grant must omit Condition canonically."
        }
        $count++
        continue
      }

      if ($sid -ceq "ExactLambdaRolesDatabaseSecretOnly") {
        if ($null -eq $conditionProperty -or $null -eq $conditionProperty.Value) {
          throw "The Secrets endpoint Lambda-role grant requires its exact principal condition."
        }
        $condition = $conditionProperty.Value
        Assert-ExactObjectKeys $condition @("ArnEquals") "Secrets endpoint Lambda-role condition"
        $arnEqualsProperty = $condition.PSObject.Properties["ArnEquals"]
        if ($null -eq $arnEqualsProperty -or $null -eq $arnEqualsProperty.Value) {
          throw "The Secrets endpoint Lambda-role grant lacks ArnEquals."
        }
        Assert-ExactObjectKeys $arnEqualsProperty.Value @("aws:PrincipalArn") "Secrets endpoint Lambda-role ArnEquals condition"
        $principalsProperty = $arnEqualsProperty.Value.PSObject.Properties["aws:PrincipalArn"]
        $principals = if ($null -eq $principalsProperty -or $null -eq $principalsProperty.Value) { @() } else { @($principalsProperty.Value) }
        if ($principals.Count -eq 0 -or @($principals | Where-Object {
              $_ -isnot [string] -or [string]$_ -cnotmatch "^arn:aws:iam::${AccountId}:role/[A-Za-z0-9+=,.@_/-]+$"
            }).Count -ne 0 -or @($principals | Select-Object -Unique).Count -ne $principals.Count) {
          throw "The Secrets endpoint Lambda-role principal condition is empty, duplicated, or broadened."
        }
        if ($principals -ccontains $processorArn) { $count++ }
        continue
      }

      if ($null -eq $conditionProperty -or $null -eq $conditionProperty.Value) { continue }
      $arnEqualsProperty = $conditionProperty.Value.PSObject.Properties["ArnEquals"]
      if ($null -eq $arnEqualsProperty -or $null -eq $arnEqualsProperty.Value) { continue }
      $principalsProperty = $arnEqualsProperty.Value.PSObject.Properties["aws:PrincipalArn"]
      if ($null -ne $principalsProperty -and @($principalsProperty.Value) -ccontains $processorArn) {
        throw "An unexpected endpoint statement grants the document processor role."
      }
    }
  }
  return $count
}

function Assert-ParserLambdaResourcePolicyAbsence {
  param([AllowNull()][object]$UnqualifiedPolicy, [AllowNull()][object]$QualifiedPolicy)
  if ($null -ne $UnqualifiedPolicy -or $null -ne $QualifiedPolicy) {
    throw "The parser Lambda must not have a function or alias resource policy."
  }
}

function Assert-ExactProcessorLambdaResourcePolicyDocument {
  param([Parameter(Mandatory)][object]$PolicyValue, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$ExpectedSourceArn)
  $policy = ConvertFrom-IamPolicyValue $PolicyValue
  $statements = @($policy.Statement)
  if ([string]$policy.Version -cne "2012-10-17" -or $statements.Count -ne 1) {
    throw "The processor Lambda resource policy must contain exactly one statement."
  }
  $statement = $statements[0]
  Assert-ExactObjectKeys $statement @("Action", "Condition", "Effect", "Principal", "Resource", "Sid") "processor Lambda resource-policy statement"
  if ([string]$statement.Sid -cne "AllowExactDocumentReconcilerRule") { throw "The processor Lambda resource policy has an unexpected Sid." }
  Assert-ExactStringSet $statement.Effect @("Allow") "processor Lambda resource-policy effect"
  Assert-ExactStringSet $statement.Action @("lambda:InvokeFunction") "processor Lambda resource-policy actions"
  Assert-ExactObjectKeys $statement.Principal @("Service") "processor Lambda resource-policy principal"
  Assert-ExactStringSet $statement.Principal.Service @("events.amazonaws.com") "processor Lambda resource-policy principal"
  Assert-ExactCondition $statement.Condition @{ ArnLike = @{ "AWS:SourceArn" = @($ExpectedSourceArn) } }
  Assert-ExactStringSet $statement.Resource @("arn:aws:lambda:us-east-2:${AccountId}:function:ai-job-apply-development-document-processor:development") "processor Lambda resource-policy target"
}

function Get-OptionalTerraformChangeValue {
  param([Parameter(Mandatory)][object]$Change, [Parameter(Mandatory)][string]$Name)
  $property = $Change.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Assert-ExactDocumentParserSourceTransition {
  param(
    [Parameter(Mandatory)][object[]]$Changes,
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ParserQualifiedArn
  )

  if ($ParserQualifiedArn -cnotmatch '^arn:aws:lambda:us-east-2:[0-9]{12}:function:ai-job-apply-development-document-parser:([1-9][0-9]*)$') {
    throw "The parser source transition requires the exact already-applied numeric parser version."
  }
  $pinnedVersion = [string]$Matches[1]
  $artifact = @($Receipt.artifacts | Where-Object {
      [string]$_.artifactName -ceq "document-parser-lambda" -and [string]$_.suffix -ceq "zip"
    })
  if ($artifact.Count -ne 1) { throw "The parser source transition requires one exact reviewed parser ZIP." }
  $artifact = $artifact[0]

  $oldKey = [string]$BaselineVariables.document_parser_artifact_s3_key.value
  $oldVersionId = [string]$BaselineVariables.document_parser_artifact_s3_object_version.value
  $oldArtifactSha = [string]$BaselineVariables.document_parser_artifact_sha256.value
  $oldObjectSha = [string]$BaselineVariables.document_parser_artifact_base64sha256.value
  if ($oldKey -cnotmatch "^lambda/documents/[a-f0-9]{40}/$oldArtifactSha/document-parser-lambda\.zip$" -or
    [string]::IsNullOrWhiteSpace($oldVersionId) -or $oldArtifactSha -cnotmatch '^[a-f0-9]{64}$' -or
    $oldObjectSha -cnotmatch '^[A-Za-z0-9+/]{43}=$') {
    throw "The retained ParserDark baseline does not bind one immutable parser artifact."
  }
  if ($oldKey -ceq [string]$artifact.key -or $oldVersionId -ceq [string]$artifact.versionId -or
    $oldArtifactSha -ceq [string]$artifact.artifactSha256 -or $oldObjectSha -ceq [string]$artifact.objectBase64Sha256) {
    throw "The CompleteDark source transition must move every parser artifact identity to the exact-current receipt."
  }

  $function = @($Changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.document_parser[0]" })
  $alias = @($Changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_alias.document_parser[0]" })
  if ($function.Count -ne 1 -or $alias.Count -ne 1 -or [string]$function[0].type -cne "aws_lambda_function" -or
    [string]$alias[0].type -cne "aws_lambda_alias") {
    throw "The parser source transition lacks its exact function and alias updates."
  }
  $function = $function[0]; $alias = $alias[0]
  foreach ($change in @($function, $alias)) {
    if ([string]$change.mode -cne "managed" -or (@($change.change.actions) -join ",") -cne "update" -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $change.change "before_sensitive" -SortArrays) -cne
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $change.change "after_sensitive" -SortArrays)) {
      throw "The parser source transition may not create, delete, replace, or broaden sensitivity."
    }
    Assert-NoTerraformReplacementPaths $change.change
  }

  if ([string]$function.change.before.s3_key -cne $oldKey -or
    [string]$function.change.before.s3_object_version -cne $oldVersionId -or
    [string]$function.change.before.source_code_hash -cne $oldObjectSha -or
    [string]$function.change.before.environment[0].variables.RELEASE_SHA -cne $oldArtifactSha -or
    [string]$function.change.before.qualified_arn -cne $ParserQualifiedArn -or
    [string]$function.change.before.version -cne $pinnedVersion -or
    [string]$function.change.after.s3_key -cne [string]$artifact.key -or
    [string]$function.change.after.s3_object_version -cne [string]$artifact.versionId -or
    [string]$function.change.after.source_code_hash -cne [string]$artifact.objectBase64Sha256 -or
    [string]::IsNullOrWhiteSpace([string]$function.change.before.code_sha256) -or
    [string]$function.change.after.code_sha256 -cne [string]$function.change.before.code_sha256 -or
    [string]$function.change.after.environment[0].variables.RELEASE_SHA -cne [string]$artifact.artifactSha256) {
    throw "The parser function transition is not bound from the retained artifact/version to the exact-current receipt."
  }
  $functionBefore = $function.change.before | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $functionAfter = $function.change.after | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $functionBefore.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  $functionAfter.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
  foreach ($field in @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")) {
    $functionBefore.PSObject.Properties.Remove($field); $functionAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-DeploymentCanonicalValue $functionBefore -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $functionAfter -SortArrays)) {
    throw "The parser source transition changes a non-artifact Lambda field."
  }
  $functionUnknown = Get-OptionalTerraformChangeValue $function.change "after_unknown"
  $expectedFunctionUnknown = [ordered]@{
    architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
    environment = @([ordered]@{ variables = [ordered]@{} }); ephemeral_storage = @([ordered]@{})
    file_system_config = @(); image_config = @(); last_modified = $true; layers = @()
    logging_config = @([ordered]@{}); qualified_arn = $true; qualified_invoke_arn = $true
    snap_start = @(); tags = [ordered]@{}; tags_all = [ordered]@{}; tenancy_config = @()
    tracing_config = @([ordered]@{}); version = $true
    vpc_config = @([ordered]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
  }
  if ($null -eq $functionUnknown -or
    (ConvertTo-DeploymentCanonicalValue $functionUnknown) -cne
    (ConvertTo-DeploymentCanonicalValue $expectedFunctionUnknown)) {
    throw "The parser source transition Lambda unknowns differ from the exact provider shape."
  }

  if ([string]$alias.change.before.function_version -cne $pinnedVersion) {
    throw "The parser alias transition does not start at the exact pinned parser version."
  }
  $aliasBefore = $alias.change.before | ConvertTo-Json -Depth 40 | ConvertFrom-Json
  $aliasAfter = $alias.change.after | ConvertTo-Json -Depth 40 | ConvertFrom-Json
  foreach ($field in @("function_version")) {
    $aliasBefore.PSObject.Properties.Remove($field); $aliasAfter.PSObject.Properties.Remove($field)
  }
  if ((ConvertTo-DeploymentCanonicalValue $aliasBefore -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $aliasAfter -SortArrays)) {
    throw "The parser source transition changes alias routing or a non-version field."
  }
  $aliasUnknown = Get-OptionalTerraformChangeValue $alias.change "after_unknown"
  $expectedAliasUnknown = [ordered]@{ function_version = $true; routing_config = @() }
  if ($null -eq $aliasUnknown -or
    (ConvertTo-DeploymentCanonicalValue $aliasUnknown) -cne
    (ConvertTo-DeploymentCanonicalValue $expectedAliasUnknown)) {
    throw "The parser source transition alias unknowns differ from the exact provider shape."
  }
}

function Assert-ExactDocumentProcessorRefresh {
  param(
    [Parameter(Mandatory)][object[]]$Changes,
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$ParserQualifiedArn,
    [Parameter(Mandatory)][string]$AccountId
  )
  $oldPin = [string]$BaselineVariables.document_parser_invocation_qualified_arn.value
  if ($oldPin -cnotmatch "^arn:aws:lambda:us-east-2:${AccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" -or
    $ParserQualifiedArn -cnotmatch "^arn:aws:lambda:us-east-2:${AccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" -or
    $ParserQualifiedArn -ceq $oldPin) { throw "The processor refresh requires distinct exact old and new numeric parser pins." }
  $artifact = @($Receipt.artifacts | Where-Object { $_.artifactName -ceq "document-processor-lambda" -and $_.suffix -ceq "zip" })
  if ($artifact.Count -ne 1) { throw "The processor refresh requires one exact reviewed processor ZIP." }
  $artifact = $artifact[0]
  $oldKey = [string]$BaselineVariables.document_processor_artifact_s3_key.value
  $oldVersion = [string]$BaselineVariables.document_processor_artifact_s3_object_version.value
  $oldSha = [string]$BaselineVariables.document_processor_artifact_sha256.value
  $oldObjectSha = [string]$BaselineVariables.document_processor_artifact_base64sha256.value
  if ($oldKey -cnotmatch "^lambda/documents/[a-f0-9]{40}/$oldSha/document-processor-lambda\.zip$" -or
    [string]::IsNullOrWhiteSpace($oldVersion) -or $oldSha -cnotmatch '^[a-f0-9]{64}$' -or
    $oldObjectSha -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
    $oldKey -ceq [string]$artifact.key -or $oldVersion -ceq [string]$artifact.versionId -or
    $oldSha -ceq [string]$artifact.artifactSha256 -or $oldObjectSha -ceq [string]$artifact.objectBase64Sha256) {
    throw "The processor refresh does not move every processor artifact identity."
  }
  $function = @($Changes | Where-Object address -ceq "module.platform.aws_lambda_function.document_processor[0]")
  $alias = @($Changes | Where-Object address -ceq "module.platform.aws_lambda_alias.document_processor[0]")
  $policy = @($Changes | Where-Object address -ceq "module.platform.aws_iam_role_policy.document_processor[0]")
  if ($Changes.Count -ne 3 -or $function.Count -ne 1 -or $alias.Count -ne 1 -or $policy.Count -ne 1 -or
    [string]$function[0].type -cne "aws_lambda_function" -or [string]$alias[0].type -cne "aws_lambda_alias" -or
    [string]$policy[0].type -cne "aws_iam_role_policy") {
    throw "The processor refresh lacks its exact policy, function, and alias updates."
  }
  foreach ($change in @($function[0], $alias[0], $policy[0])) {
    if ([string]$change.mode -cne "managed" -or (@($change.change.actions) -join ",") -cne "update" -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $change.change "before_sensitive" -SortArrays) -cne
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $change.change "after_sensitive" -SortArrays)) {
      throw "The processor refresh may not create, delete, replace, or broaden sensitivity."
    }
    Assert-NoTerraformReplacementPaths $change.change
  }
  $function = $function[0]; $alias = $alias[0]; $policy = $policy[0]
  if ([string]$function.change.before.s3_key -cne $oldKey -or
    [string]$function.change.before.s3_object_version -cne $oldVersion -or
    [string]$function.change.before.source_code_hash -cne $oldObjectSha -or
    [string]$function.change.before.environment[0].variables.RELEASE_SHA -cne $oldSha -or
    [string]$function.change.before.environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN -cne $oldPin -or
    [string]$function.change.after.s3_key -cne [string]$artifact.key -or
    [string]$function.change.after.s3_object_version -cne [string]$artifact.versionId -or
    [string]$function.change.after.source_code_hash -cne [string]$artifact.objectBase64Sha256 -or
    [string]$function.change.after.environment[0].variables.RELEASE_SHA -cne [string]$artifact.artifactSha256 -or
    [string]$function.change.after.environment[0].variables.DOCUMENT_PARSER_FUNCTION_ARN -cne $ParserQualifiedArn -or
    [string]::IsNullOrWhiteSpace([string]$function.change.before.code_sha256) -or
    [string]$function.change.after.code_sha256 -cne [string]$function.change.before.code_sha256) {
    throw "The processor function refresh is not bound to the exact artifact and new parser pin."
  }
  $beforeFunction = $function.change.before | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $afterFunction = $function.change.after | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  foreach ($copy in @($beforeFunction, $afterFunction)) {
    $copy.environment[0].variables.PSObject.Properties.Remove("RELEASE_SHA")
    $copy.environment[0].variables.PSObject.Properties.Remove("DOCUMENT_PARSER_FUNCTION_ARN")
    foreach ($field in @("code_sha256", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")) { $copy.PSObject.Properties.Remove($field) }
  }
  if ((ConvertTo-DeploymentCanonicalValue $beforeFunction -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $afterFunction -SortArrays)) {
    throw "The processor refresh changes a non-artifact Lambda field."
  }
  $expectedFunctionUnknown = [ordered]@{
    architectures = @($false); capacity_provider_config = @(); dead_letter_config = @(); durable_config = @()
    environment = @([ordered]@{ variables = [ordered]@{} }); ephemeral_storage = @([ordered]@{})
    file_system_config = @(); image_config = @(); last_modified = $true; layers = @($false)
    logging_config = @([ordered]@{}); qualified_arn = $true; qualified_invoke_arn = $true
    snap_start = @(); tags = [ordered]@{}; tags_all = [ordered]@{}; tenancy_config = @()
    tracing_config = @([ordered]@{}); version = $true
    vpc_config = @([ordered]@{ security_group_ids = @($false); subnet_ids = @($false, $false) })
  }
  if ((ConvertTo-DeploymentCanonicalValue (Get-OptionalTerraformChangeValue $function.change "after_unknown")) -cne
    (ConvertTo-DeploymentCanonicalValue $expectedFunctionUnknown)) {
    throw "The processor refresh Lambda unknowns differ from the exact provider shape."
  }
  $aliasBefore = $alias.change.before | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $aliasAfter = $alias.change.after | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $aliasBefore.PSObject.Properties.Remove("function_version"); $aliasAfter.PSObject.Properties.Remove("function_version")
  if ([string]$alias.change.before.function_version -cnotmatch '^[1-9][0-9]*$' -or
    (ConvertTo-DeploymentCanonicalValue $aliasBefore -SortArrays) -cne (ConvertTo-DeploymentCanonicalValue $aliasAfter -SortArrays) -or
    (ConvertTo-DeploymentCanonicalValue (Get-OptionalTerraformChangeValue $alias.change "after_unknown")) -cne
    (ConvertTo-DeploymentCanonicalValue ([ordered]@{ function_version = $true; routing_config = @() }))) {
    throw "The processor refresh changes alias routing or has unexpected unknowns."
  }
  $beforePolicy = ConvertFrom-IamPolicyValue $policy.change.before.policy
  $afterPolicy = ConvertFrom-IamPolicyValue $policy.change.after.policy
  $beforeStatement = @($beforePolicy.Statement | Where-Object Sid -ceq "CoordinatorInvokesExactParserVersionOnly")
  $afterStatement = @($afterPolicy.Statement | Where-Object Sid -ceq "CoordinatorInvokesExactParserVersionOnly")
  if ($beforeStatement.Count -ne 1 -or $afterStatement.Count -ne 1 -or
    [string]$beforeStatement[0].Resource -cne $oldPin -or [string]$afterStatement[0].Resource -cne $ParserQualifiedArn) {
    throw "The processor policy refresh does not rebind the exact parser version."
  }
  $beforeStatement[0].Resource = "__PIN__"; $afterStatement[0].Resource = "__PIN__"
  if ((ConvertTo-DeploymentCanonicalValue $beforePolicy -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $afterPolicy -SortArrays)) {
    throw "The processor policy refresh changes more than the exact parser-version resource."
  }
  $beforePolicyRecord = $policy.change.before | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $afterPolicyRecord = $policy.change.after | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $beforePolicyRecord.PSObject.Properties.Remove("policy"); $afterPolicyRecord.PSObject.Properties.Remove("policy")
  if ((ConvertTo-DeploymentCanonicalValue $beforePolicyRecord -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue $afterPolicyRecord -SortArrays) -or
    (ConvertTo-OptionalTerraformMetadataCanonicalValue $policy.change "after_unknown") -cne "{}") {
    throw "The processor policy refresh changes a non-policy field or contains unknown values."
  }
}

function ConvertTo-OptionalTerraformMetadataCanonicalValue {
  param([Parameter(Mandatory)][object]$Change, [Parameter(Mandatory)][string]$Name, [switch]$SortArrays)
  $value = Get-OptionalTerraformChangeValue $Change $Name
  if ($null -eq $value) { return "{}" }
  return ConvertTo-DeploymentCanonicalValue $value -SortArrays:$SortArrays
}

function Assert-NoTerraformReplacementPaths {
  param([Parameter(Mandatory)][object]$Change)
  $paths = Get-OptionalTerraformChangeValue $Change "replace_paths"
  if ($null -ne $paths -and @($paths).Count -ne 0) { throw "A Terraform change contains replacement paths." }
}

function Test-DevelopmentDocumentEmptyObject {
  param([AllowNull()][object]$Value)
  return $null -ne $Value -and $Value -is [Management.Automation.PSCustomObject] -and
    @($Value.PSObject.Properties).Count -eq 0
}

function Test-DevelopmentDocumentEmptyArray {
  param([AllowNull()][object]$Value)
  return $null -ne $Value -and $Value -is [System.Array] -and @($Value).Count -eq 0
}

function Assert-DevelopmentDocumentS3EndpointCidrRefresh {
  param(
    [Parameter(Mandatory)][object]$Before,
    [Parameter(Mandatory)][object]$After,
    [Parameter(Mandatory)][object]$Expected
  )
  $beforeCidrs = @($Before.cidr_blocks)
  $afterCidrs = @($After.cidr_blocks)
  if ($beforeCidrs.Count -eq 0 -or $afterCidrs.Count -le $beforeCidrs.Count -or
      @($beforeCidrs | Sort-Object -Unique).Count -ne $beforeCidrs.Count -or
      @($afterCidrs | Sort-Object -Unique).Count -ne $afterCidrs.Count) {
    throw "The S3 endpoint CIDR refresh is empty, non-growing, or contains duplicates."
  }
  foreach ($cidr in @($beforeCidrs + $afterCidrs)) {
    if ($cidr -isnot [string] -or [string]$cidr -cnotmatch '^([^/]+)/([0-9]{1,2})$') {
      throw "The S3 endpoint CIDR refresh contains a non-IPv4-CIDR value."
    }
    $address = [Net.IPAddress]::None
    if (-not [Net.IPAddress]::TryParse([string]$Matches[1], [ref]$address) -or
        $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        [int]$Matches[2] -lt 0 -or [int]$Matches[2] -gt 32) {
      throw "The S3 endpoint CIDR refresh contains an invalid IPv4 CIDR."
    }
  }
  if (@($beforeCidrs | Where-Object { $_ -notin $afterCidrs }).Count -ne 0 -or
      @($afterCidrs | Where-Object { $_ -notin $beforeCidrs }).Count -ne
        ($afterCidrs.Count - $beforeCidrs.Count) -or
      (ConvertTo-DeploymentCanonicalValue $After -SortArrays) -cne
        (ConvertTo-DeploymentCanonicalValue $Expected -SortArrays)) {
    throw "The S3 endpoint CIDR refresh removes a prior range or differs from the exact planned value."
  }
  $After.cidr_blocks = $Before.cidr_blocks
}

function Assert-DevelopmentDocumentNullToEmptyObject {
  param([Parameter(Mandatory)][object]$Before, [Parameter(Mandatory)][object]$After,
    [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Label)
  $beforeProperty = $Before.PSObject.Properties[$Name]
  $afterProperty = $After.PSObject.Properties[$Name]
  if ($null -eq $beforeProperty -or $null -ne $beforeProperty.Value -or $null -eq $afterProperty -or
    -not (Test-DevelopmentDocumentEmptyObject $afterProperty.Value)) {
    throw "$Label is not the exact null-to-empty-object provider normalization."
  }
  $afterProperty.Value = $null
}

function Assert-DevelopmentDocumentNullToEmptyArray {
  param([Parameter(Mandatory)][object]$Before, [Parameter(Mandatory)][object]$After,
    [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Label)
  $beforeProperty = $Before.PSObject.Properties[$Name]
  $afterProperty = $After.PSObject.Properties[$Name]
  if ($null -eq $beforeProperty -or $null -ne $beforeProperty.Value -or $null -eq $afterProperty -or
    -not (Test-DevelopmentDocumentEmptyArray $afterProperty.Value)) {
    throw "$Label is not the exact null-to-empty-array provider normalization."
  }
  $afterProperty.Value = $null
}

function Assert-DevelopmentDocumentAcceptedDriftSensitivity {
  param([Parameter(Mandatory)][object]$Record,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Normalizations)
  $beforeValue = Get-OptionalTerraformChangeValue $Record.change "before_sensitive"
  $afterValue = Get-OptionalTerraformChangeValue $Record.change "after_sensitive"
  if ($null -eq $beforeValue) { $beforeValue = [pscustomobject]@{} }
  if ($null -eq $afterValue) { $afterValue = [pscustomobject]@{} }
  $before = $beforeValue | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $after = $afterValue | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  foreach ($normalization in $Normalizations) {
    switch ($normalization) {
      "tags" {
        if ($null -ne $before.PSObject.Properties["tags"] -or
          -not (Test-DevelopmentDocumentEmptyObject $after.PSObject.Properties["tags"].Value)) {
          throw "Tag sensitivity metadata is not the exact omitted-to-empty normalization."
        }
        $after.PSObject.Properties.Remove("tags")
      }
      "layers" {
        if ($null -ne $before.PSObject.Properties["layers"] -or
          -not (Test-DevelopmentDocumentEmptyArray $after.PSObject.Properties["layers"].Value)) {
          throw "Layer sensitivity metadata is not the exact omitted-to-empty normalization."
        }
        $after.PSObject.Properties.Remove("layers")
      }
      "inline_policy" {
        $beforePolicies = $before.PSObject.Properties["inline_policy"]
        $afterPolicies = $after.PSObject.Properties["inline_policy"]
        if ($null -eq $beforePolicies -or -not (Test-DevelopmentDocumentEmptyArray $beforePolicies.Value) -or
          $null -eq $afterPolicies -or @($afterPolicies.Value).Count -ne 1 -or
          -not (Test-DevelopmentDocumentEmptyObject @($afterPolicies.Value)[0])) {
          throw "Inline-policy sensitivity metadata is not the exact empty-to-singleton-empty normalization."
        }
        $afterPolicies.Value = @()
      }
      "event_source_mapping_filters" {
        foreach ($name in @("queues", "topics")) {
          if ($null -ne $before.PSObject.Properties[$name] -or
            -not (Test-DevelopmentDocumentEmptyArray $after.PSObject.Properties[$name].Value)) {
            throw "Event-source mapping $name sensitivity metadata is not the exact omitted-to-empty-array normalization."
          }
          $after.PSObject.Properties.Remove($name)
        }
      }
      "insufficient_data_actions" {
        if ($null -ne $before.PSObject.Properties["insufficient_data_actions"] -or
          -not (Test-DevelopmentDocumentEmptyArray $after.PSObject.Properties["insufficient_data_actions"].Value)) {
          throw "Alarm sensitivity metadata is not the exact omitted-to-empty-array normalization."
        }
        $after.PSObject.Properties.Remove("insufficient_data_actions")
      }
      "dimensions" {
        if ($null -ne $before.PSObject.Properties["dimensions"] -or
          -not (Test-DevelopmentDocumentEmptyObject $after.PSObject.Properties["dimensions"].Value)) {
          throw "Dimension sensitivity metadata is not the exact omitted-to-empty normalization."
        }
        $after.PSObject.Properties.Remove("dimensions")
      }
      "metric_transformation_dimensions" {
        $beforeTransform = @($before.PSObject.Properties["metric_transformation"].Value)
        $afterTransform = @($after.PSObject.Properties["metric_transformation"].Value)
        if ($beforeTransform.Count -ne 1 -or $afterTransform.Count -ne 1 -or
          $null -ne $beforeTransform[0].PSObject.Properties["dimensions"] -or
          -not (Test-DevelopmentDocumentEmptyObject $afterTransform[0].PSObject.Properties["dimensions"].Value)) {
          throw "Metric-filter sensitivity metadata is not the exact omitted-to-empty dimension normalization."
        }
        $afterTransform[0].PSObject.Properties.Remove("dimensions")
      }
      "cidr_blocks" {
        $beforeCidrs = @($before.PSObject.Properties["cidr_blocks"].Value)
        $afterCidrs = @($after.PSObject.Properties["cidr_blocks"].Value)
        if ($beforeCidrs.Count -eq 0 -or $afterCidrs.Count -le $beforeCidrs.Count -or
            @($beforeCidrs | Where-Object { $_ -isnot [bool] -or $_ }).Count -ne 0 -or
            @($afterCidrs | Where-Object { $_ -isnot [bool] -or $_ }).Count -ne 0) {
          throw "S3 endpoint CIDR sensitivity metadata is not the exact growing all-false shape."
        }
        $after.PSObject.Properties["cidr_blocks"].Value = $beforeCidrs
      }
      default { throw "Unknown accepted sensitivity normalization '$normalization'." }
    }
  }
  if ((ConvertTo-DeploymentCanonicalValue $before -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $after -SortArrays)) {
    throw "Accepted provider-observed drift changed other sensitivity metadata."
  }
}

function ConvertTo-StrictUtcWholeSecond {
  param([Parameter(Mandatory)][AllowNull()][object]$Value, [string]$Label = "UTC timestamp")
  if ($Value -is [datetime]) {
    $parsed = [datetime]$Value
    if ($parsed.Kind -ne [DateTimeKind]::Utc -or $parsed.Ticks % [TimeSpan]::TicksPerSecond -ne 0 -or
      $parsed.Year -lt 2000 -or $parsed.Year -gt 2099) {
      throw "$Label must be a UTC whole-second DateTime within 2000-2099."
    }
    return $parsed
  }
  if ($Value -isnot [string] -or $Value -cnotmatch '^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') {
    throw "$Label must be an exact RFC3339 whole-second UTC string within 2000-2099."
  }
  $parsed = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($Value, "yyyy-MM-dd'T'HH:mm:ss'Z'",
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
      [ref]$parsed)) { throw "$Label is not a valid UTC timestamp." }
  return $parsed
}

function Assert-DevelopmentDocumentExactDataReads {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Records)
  $expected = @(Get-DevelopmentDocumentDarkExpectedDataReads | Sort-Object)
  $actual = @($Records | ForEach-Object { [string]$_.address } | Sort-Object)
  if (($actual -join "|") -cne ($expected -join "|")) { throw "The dark plan has an unexpected deferred data read set." }
  foreach ($record in $Records) {
    Assert-NoTerraformReplacementPaths $record.change
    if ([string]$record.mode -cne "data" -or [string]$record.type -cne "aws_iam_policy_document" -or
      (@($record.change.actions) -join ",") -cne "read" -or $null -ne $record.change.before -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $record.change "before_sensitive") -match 'true' -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $record.change "after_sensitive") -match 'true') {
      throw "A deferred data read has an unsafe mode, action, prior value, replacement, or sensitivity shape."
    }
  }
}

function Assert-DevelopmentDocumentExactQueueDriftPolicy {
  param([Parameter(Mandatory)][object]$PolicyValue, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][ValidateSet("Results", "DeliveryDeadLetter")][string]$Kind)
  $definition = if ($Kind -ceq "Results") {
    @("ExactGuardDutyResultRuleOnly", "ai-job-apply-development-document-scan-results",
      @("ai-job-apply-development-document-scan-results"))
  } else {
    @("ExactEventBridgeRuleDeadLettersOnly", "ai-job-apply-development-document-scan-delivery-dlq",
      @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure",
        "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler"))
  }
  $policy = ConvertFrom-IamPolicyValue $PolicyValue
  $statements = @($policy.Statement)
  if ([string]$policy.Version -cne "2012-10-17" -or $statements.Count -ne 1 -or
    [string]$statements[0].Sid -cne [string]$definition[0]) {
    throw "A computed document queue policy has an unexpected shape."
  }
  $statement = $statements[0]
  Assert-ExactObjectKeys $statement @("Action", "Condition", "Effect", "Principal", "Resource", "Sid") "computed queue-policy statement"
  Assert-ExactStringSet $statement.Effect @("Allow") "computed queue-policy effect"
  Assert-ExactStringSet $statement.Action @("sqs:SendMessage") "computed queue-policy actions"
  Assert-ExactStringSet $statement.Resource @("arn:aws:sqs:us-east-2:${AccountId}:$($definition[1])") "computed queue-policy resources"
  Assert-ExactObjectKeys $statement.Principal @("Service") "computed queue-policy principal"
  Assert-ExactStringSet $statement.Principal.Service @("events.amazonaws.com") "computed queue-policy principal"
  Assert-ExactCondition $statement.Condition @{
    ArnEquals = @{ "aws:SourceArn" = @($definition[2] | ForEach-Object { "arn:aws:events:us-east-2:${AccountId}:rule/$_" }) }
    StringEquals = @{ "aws:SourceAccount" = @($AccountId) }
  }
}

function Assert-DevelopmentDocumentAcceptedResourceDrift {
  param([AllowNull()][object[]]$Records, [Parameter(Mandatory)][object]$RootModule)
  $drift = @($Records)
  if ($drift.Count -eq 0) { throw "The plan must contain a nonempty accepted resource-drift subset." }

  $eventRules = @(
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]"
  )
  $metricFilters = @(
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_log_metric_filter.document_security_contradiction[0]"
  )
  $dimensionAlarms = @(
    "module.platform.aws_cloudwatch_metric_alarm.document_processing_record_failed[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_processing_timed_out[0]",
    "module.platform.aws_cloudwatch_metric_alarm.document_security_contradiction[0]"
  )
  $alarms = @($dimensionAlarms + @(
      "module.platform.aws_cloudwatch_metric_alarm.document_parser_errors[0]",
      "module.platform.aws_cloudwatch_metric_alarm.document_processor_errors[0]",
      "module.platform.aws_cloudwatch_metric_alarm.document_scan_dead_letter[0]",
      "module.platform.aws_cloudwatch_metric_alarm.document_scan_delivery_dead_letter[0]",
      "module.platform.aws_cloudwatch_metric_alarm.document_scan_queue_age[0]"
    ))
  $tagOnly = @($eventRules + @(
      "module.platform.aws_ecs_task_definition.migration[0]",
      "module.platform.aws_security_group.document_parser[0]",
      "module.platform.aws_sqs_queue.document_scan_dead_letter[0]",
      "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
    ))
  $processorRole = "module.platform.aws_iam_role.document_processor[0]"
  $completeDarkMapping = "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"
  $completeDarkTagOnly = @(
    "module.platform.aws_lambda_function.document_processor[0]",
    "module.platform.aws_vpc_endpoint.sts[0]"
  )
  $parserRoles = @(
    "module.platform.aws_iam_role.document_parser[0]",
    "module.platform.aws_iam_role.document_parser_object_access[0]"
  )
  $policyAddresses = @(
    "module.platform.aws_s3_bucket.candidate_documents[0]",
    "module.platform.aws_sns_topic.operational_alerts",
    "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]",
    "module.platform.aws_sqs_queue.document_scan_results[0]"
  )
  $allowedTypes = @{}
  foreach ($address in $eventRules) { $allowedTypes[$address] = "aws_cloudwatch_event_rule" }
  foreach ($address in $metricFilters) { $allowedTypes[$address] = "aws_cloudwatch_log_metric_filter" }
  foreach ($address in $alarms) { $allowedTypes[$address] = "aws_cloudwatch_metric_alarm" }
  foreach ($address in @($parserRoles + "module.platform.aws_iam_role.document_processor[0]")) { $allowedTypes[$address] = "aws_iam_role" }
  $allowedTypes["module.platform.aws_db_instance.postgres[0]"] = "aws_db_instance"
  $allowedTypes["module.platform.aws_ecs_task_definition.migration[0]"] = "aws_ecs_task_definition"
  $allowedTypes[$completeDarkMapping] = "aws_lambda_event_source_mapping"
  $allowedTypes["module.platform.aws_lambda_function.document_parser[0]"] = "aws_lambda_function"
  $allowedTypes["module.platform.aws_lambda_function.document_processor[0]"] = "aws_lambda_function"
  $allowedTypes["module.platform.aws_s3_bucket.candidate_documents[0]"] = "aws_s3_bucket"
  $allowedTypes["module.platform.aws_security_group.document_parser[0]"] = "aws_security_group"
  $allowedTypes["module.platform.aws_sns_topic.operational_alerts"] = "aws_sns_topic"
  foreach ($address in @(
      "module.platform.aws_sqs_queue.document_scan_dead_letter[0]",
      "module.platform.aws_sqs_queue.document_scan_delivery_dead_letter[0]",
      "module.platform.aws_sqs_queue.document_scan_results[0]"
    )) { $allowedTypes[$address] = "aws_sqs_queue" }
  $allowedTypes["module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"] = "aws_vpc_endpoint"
  $allowedTypes["module.platform.aws_vpc_endpoint.sts[0]"] = "aws_vpc_endpoint"

  $planned = Get-TerraformStateResourceMap $RootModule
  $kms = $planned["module.platform.aws_kms_key.platform"]
  if ($null -eq $kms -or [string]$kms.arn -cnotmatch '^arn:aws:kms:us-east-2:([0-9]{12}):key/[a-f0-9-]+$') {
    throw "The retained plan lacks the exact plan-owned KMS identity."
  }
  $accountId = [string]$Matches[1]
  $kmsArn = [string]$kms.arn
  $seenAddresses = @()
  foreach ($record in $drift) {
    $address = [string]$record.address
    if (-not $allowedTypes.ContainsKey($address) -or $seenAddresses -ccontains $address -or
      [string]$record.type -cne [string]$allowedTypes[$address]) {
      throw "The plan contains unknown, mistyped, or duplicate resource drift."
    }
    $seenAddresses += $address
    Assert-NoTerraformReplacementPaths $record.change
    if ([string]$record.mode -cne "managed" -or (@($record.change.actions) -join ",") -cne "update" -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $record.change "after_unknown") -cne "{}" -or
      $null -eq $record.change.before -or $null -eq $record.change.after) {
      throw "Accepted provider-observed drift has an unsafe action or metadata shape."
    }

    $before = $record.change.before | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $after = $record.change.after | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $sensitivity = @()
    if ($address -ceq $processorRole) {
      $beforePolicies = $before.PSObject.Properties["inline_policy"]
      $afterPolicies = $after.PSObject.Properties["inline_policy"]
      if ($null -eq $beforePolicies -and $null -eq $afterPolicies) {
        Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Processor role tag drift"
        $sensitivity += "tags"
      } elseif ($null -eq $beforePolicies -or $null -eq $afterPolicies -or
        -not (Test-DevelopmentDocumentEmptyArray $beforePolicies.Value)) {
        throw "The processor role drift has an unexpected inline-policy boundary."
      } elseif (Test-DevelopmentDocumentEmptyArray $afterPolicies.Value) {
        Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Processor role tag drift"
        $sensitivity += "tags"
      } else {
        $expectedRole = $planned[$processorRole]
        $expectedPolicy = $planned["module.platform.aws_iam_role_policy.document_processor[0]"]
        if (@($afterPolicies.Value).Count -ne 1 -or
          [string]@($afterPolicies.Value)[0].name -cne "document-processor-runtime" -or
          -not (Test-DevelopmentDocumentEmptyObject $before.tags) -or
          -not (Test-DevelopmentDocumentEmptyObject $after.tags) -or
          $null -eq $expectedRole -or $null -eq $expectedPolicy -or
          [string]$expectedPolicy.role -cne "ai-job-apply-development-document-processor" -or
          [string]$expectedPolicy.policy -cne [string]@($afterPolicies.Value)[0].policy -or
          (ConvertTo-DeploymentCanonicalValue $after -SortArrays) -cne
          (ConvertTo-DeploymentCanonicalValue $expectedRole -SortArrays)) {
          throw "The processor role inline-policy normalization differs from the exact source-evaluated policy."
        }
        Assert-ExactDocumentIdentityPolicy @($afterPolicies.Value)[0].policy Processor $accountId $kmsArn
        $afterPolicies.Value = @()
        $sensitivity += "inline_policy"
      }
    } elseif ($address -ceq $completeDarkMapping) {
      $expected = $planned[$address]
      if ($null -eq $expected -or (ConvertTo-DeploymentCanonicalValue $after -SortArrays) -cne
        (ConvertTo-DeploymentCanonicalValue $expected -SortArrays)) {
        throw "The CompleteDark event-source mapping normalization differs from the exact source-evaluated value."
      }
      Assert-DevelopmentDocumentNullToEmptyArray $before $after queues "Event-source mapping queue drift"
      Assert-DevelopmentDocumentNullToEmptyArray $before $after topics "Event-source mapping topic drift"
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Event-source mapping tag drift"
      $sensitivity += @("event_source_mapping_filters", "tags")
    } elseif ($address -cin $completeDarkTagOnly) {
      $expected = $planned[$address]
      if ($null -eq $expected -or (ConvertTo-DeploymentCanonicalValue $after -SortArrays) -cne
        (ConvertTo-DeploymentCanonicalValue $expected -SortArrays)) {
        throw "A CompleteDark post-create tag normalization differs from the exact source-evaluated value."
      }
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "CompleteDark post-create tag drift"
      $sensitivity += "tags"
    } elseif ($address -ceq "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]") {
      if ($null -eq $before.PSObject.Properties["tags"].Value -and
          (Test-DevelopmentDocumentEmptyObject $after.PSObject.Properties["tags"].Value)) {
        Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Resource tag drift"
        $sensitivity += "tags"
      } else {
        if (-not (Test-DevelopmentDocumentEmptyObject $before.PSObject.Properties["tags"].Value) -or
            -not (Test-DevelopmentDocumentEmptyObject $after.PSObject.Properties["tags"].Value)) {
          throw "The S3 endpoint CIDR refresh changed the exact empty tag boundary."
        }
        $expected = $planned[$address]
        if ($null -eq $expected) { throw "The S3 endpoint CIDR refresh lacks its exact planned value." }
        Assert-DevelopmentDocumentS3EndpointCidrRefresh $before $after $expected
        $sensitivity += "cidr_blocks"
      }
    } elseif ($address -cin $tagOnly) {
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Resource tag drift"
      $sensitivity += "tags"
    } elseif ($address -cin $metricFilters) {
      $beforeTransforms = @($before.metric_transformation); $afterTransforms = @($after.metric_transformation)
      if ($beforeTransforms.Count -ne 1 -or $afterTransforms.Count -ne 1) { throw "Metric-filter drift has an unexpected transformation count." }
      Assert-DevelopmentDocumentNullToEmptyObject $beforeTransforms[0] $afterTransforms[0] dimensions "Metric-filter dimension drift"
      $sensitivity += "metric_transformation_dimensions"
    } elseif ($address -cin $alarms) {
      Assert-DevelopmentDocumentNullToEmptyArray $before $after insufficient_data_actions "Alarm action drift"
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Alarm tag drift"
      $sensitivity += @("insufficient_data_actions", "tags")
      if ($address -cin $dimensionAlarms) {
        Assert-DevelopmentDocumentNullToEmptyObject $before $after dimensions "Alarm dimension drift"
        $sensitivity += "dimensions"
      }
    } elseif ($address -ceq "module.platform.aws_db_instance.postgres[0]") {
      $beforeClock = ConvertTo-StrictUtcWholeSecond $before.latest_restorable_time "RDS before restore clock"
      $afterClock = ConvertTo-StrictUtcWholeSecond $after.latest_restorable_time "RDS after restore clock"
      if ($afterClock -le $beforeClock) { throw "The provider-observed RDS restore clock did not move strictly forward." }
      $after.latest_restorable_time = $before.latest_restorable_time
    } elseif ($address -cin $parserRoles) {
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Role tag drift"
      $roleKind = if ($address -ceq "module.platform.aws_iam_role.document_parser[0]") { "Parser" } else { "ObjectAccess" }
      if (-not (Test-DevelopmentDocumentEmptyArray $before.inline_policy) -or @($after.inline_policy).Count -ne 1 -or
        [string]$after.inline_policy[0].name -cne $(if ($roleKind -ceq "Parser") { "document-parser-runtime" } else { "document-object-access-runtime" })) {
        throw "The parser role inline-policy normalization has an unexpected shape."
      }
      $expected = $planned[$address]
      if ($null -eq $expected -or (ConvertTo-DeploymentCanonicalValue $after.inline_policy -SortArrays) -cne
        (ConvertTo-DeploymentCanonicalValue $expected.inline_policy -SortArrays)) {
        throw "The parser role inline policy differs from the exact source-evaluated policy."
      }
      Assert-ExactDocumentIdentityPolicy $after.inline_policy[0].policy $roleKind $accountId $kmsArn
      $after.inline_policy = @()
      $sensitivity += @("tags", "inline_policy")
    } elseif ($address -ceq "module.platform.aws_lambda_function.document_parser[0]") {
      Assert-DevelopmentDocumentNullToEmptyArray $before $after layers "Parser layer drift"
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Parser tag drift"
      $sensitivity += @("layers", "tags")
    } elseif ($address -ceq "module.platform.aws_s3_bucket.candidate_documents[0]") {
      $expected = $planned["module.platform.aws_s3_bucket_policy.candidate_documents[0]"]
      if ($null -eq $expected -or [string]$after.policy -cne [string]$expected.policy) {
        throw "Candidate-document bucket drift differs from the exact source-evaluated policy."
      }
      $beforePolicy = ConvertFrom-IamPolicyValue $before.policy
      if ([string]$beforePolicy.Version -cne "2012-10-17" -or
        (@($beforePolicy.Statement.Sid | Sort-Object) -join "|") -cne
        ((@("DenyInsecureTransport", "DenyWrongEncryptionKey", "DenyWrongEncryptionMode") | Sort-Object) -join "|")) {
        throw "Candidate-document bucket drift does not start from the exact three-statement boundary."
      }
      $added = Get-PolicyAddedStatements $before.policy $after.policy @("DenyQuarantineReadsWithoutCleanMalwareTag")
      $statement = @($added)[0]
      $bucketArn = ([string]@($statement.Resource)[0]) -replace '/quarantine/\*$', ''
      Assert-ExactAddedStatement $statement CandidateDeny $accountId $bucketArn
      $after.policy = $before.policy
    } elseif ($address -ceq "module.platform.aws_sns_topic.operational_alerts") {
      $expected = $planned["module.platform.aws_sns_topic_policy.operational_alerts"]
      if ($null -eq $expected -or [string]$after.policy -cne [string]$expected.policy) {
        throw "Operational-alert topic drift differs from the exact source-evaluated policy."
      }
      $beforePolicy = ConvertFrom-IamPolicyValue $before.policy
      if ([string]$beforePolicy.Version -cne "2012-10-17" -or
        (@($beforePolicy.Statement.Sid | Sort-Object) -join "|") -cne
        ((@("AllowAccountAdministration", "AllowAwsBudgetsPublishing", "AllowCloudWatchAlarmPublishing") | Sort-Object) -join "|")) {
        throw "Operational-alert topic drift does not start from the exact three-statement boundary."
      }
      $added = Get-PolicyAddedStatements $before.policy $after.policy @("AllowExactDocumentOperationalRules")
      Assert-ExactAddedStatement @($added)[0] SnsAlerts $accountId
      $after.policy = $before.policy
    } elseif ($address -cin $policyAddresses) {
      Assert-DevelopmentDocumentNullToEmptyObject $before $after tags "Queue tag drift"
      if (-not [string]::IsNullOrEmpty([string]$before.policy)) { throw "A computed document queue policy did not start empty." }
      $expected = $planned[$address]
      if ($null -eq $expected -or [string]$after.policy -cne [string]$expected.policy) {
        throw "Document queue drift differs from the exact source-evaluated policy."
      }
      Assert-DevelopmentDocumentExactQueueDriftPolicy $after.policy $accountId `
        $(if ($address -ceq "module.platform.aws_sqs_queue.document_scan_results[0]") { "Results" } else { "DeliveryDeadLetter" })
      $after.policy = $before.policy
      $sensitivity += "tags"
    } else { throw "The accepted resource drift category is not implemented." }

    Assert-DevelopmentDocumentAcceptedDriftSensitivity $record $sensitivity
    if ((ConvertTo-DeploymentCanonicalValue $before -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue $after -SortArrays)) {
      throw "Accepted drift changed another resource attribute."
    }
  }
}

function Assert-DevelopmentDocumentRetainedBaselinePlan {
  param([Parameter(Mandatory)][object]$Plan)

  if ($Plan.complete -isnot [bool] -or -not $Plan.complete -or
    $Plan.errored -isnot [bool] -or $Plan.errored -or
    $Plan.applyable -isnot [bool] -or $Plan.applyable -or
    [string]$Plan.terraform_version -cne "1.9.8" -or
    $null -eq $Plan.variables -or $null -eq $Plan.planned_values -or
    $null -eq $Plan.planned_values.root_module) {
    throw "The retained document baseline is not a complete, nonerrored, nonapplyable Terraform 1.9.8 zero-change plan."
  }

  $meaningfulResources = @($Plan.resource_changes | Where-Object {
      $null -ne $_ -and (@($_.change.actions) -join ",") -cne "no-op"
    })
  $outputChangesProperty = $Plan.PSObject.Properties["output_changes"]
  $meaningfulOutputs = @(
    if ($null -ne $outputChangesProperty -and $null -ne $outputChangesProperty.Value) {
      $outputChangesProperty.Value.PSObject.Properties | Where-Object {
        $null -ne $_.Value -and (@($_.Value.actions) -join ",") -cne "no-op"
      }
    }
  )
  if ($meaningfulResources.Count -ne 0 -or $meaningfulOutputs.Count -ne 0) {
    throw "The retained document baseline contains a meaningful resource or output change."
  }

  $drift = @($Plan.resource_drift | Where-Object { $null -ne $_ })
  if ($drift.Count -ne 0) {
    Assert-DevelopmentDocumentAcceptedResourceDrift -Records $drift -RootModule $Plan.planned_values.root_module
  }
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
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][ValidateSet("kms-prerequisite", "parser-dark", "complete-dark")][string]$Stage,
    [string]$ParserQualifiedArn = "",
    [switch]$CompleteDarkParserRefresh
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
    document_processing_deployment_stage = $Stage
    document_parser_invocation_qualified_arn = $(if ($Stage -ceq "complete-dark") { $ParserQualifiedArn } else { "" })
    document_scan_mapping_enabled = $false
    document_scan_event_rule_enabled = $false
    document_security_health_rules_enabled = $Stage -in @("parser-dark", "complete-dark")
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
  if ($Stage -cne "complete-dark") {
    foreach ($name in @(
        "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
        "document_processor_artifact_sha256", "document_processor_artifact_base64sha256",
        "document_processor_extension_layer_arn"
      )) { $null = $overlay.Remove($name) }
  }
  elseif ($CompleteDarkParserRefresh) {
    foreach ($name in @(
        "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
        "document_processor_artifact_sha256", "document_processor_artifact_base64sha256",
        "document_processor_extension_layer_arn"
      )) { $null = $overlay.Remove($name) }
  }
  $baselineByCurrentName = @{}
  foreach ($property in @($BaselineVariables.PSObject.Properties)) {
    $name = [string]$property.Name
    if ($name -in @("deploy_document_processing", "document_processing_kms_prerequisite_enabled")) { continue }
    $baselineByCurrentName[$name] = $property.Value.value
  }
  $baselineByCurrentName["document_processing_deployment_stage"] = "kms-prerequisite"
  $baselineByCurrentName["document_parser_invocation_qualified_arn"] = ""
  $baselineByCurrentName["document_security_health_rules_enabled"] = $false
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($planNames -join "|") -cne (@($baselineByCurrentName.Keys | Sort-Object) -join "|")) {
    throw "The staged plan variable set is not the exact migrated baseline variable set."
  }
  foreach ($name in @($baselineByCurrentName.Keys)) {
    $planned = $PlanVariables.PSObject.Properties[$name]
    if ($null -eq $planned) { throw "The dark plan omits baseline variable '$name'." }
    $actualCanonical = ConvertTo-DevelopmentDocumentComparableVariableValue `
      -Name $name -Value $planned.Value.value
    $expectedCanonical = if ($overlay.ContainsKey($name)) {
      ConvertTo-DevelopmentDocumentComparableVariableValue -Name $name -Value $overlay[$name]
    } else {
      ConvertTo-DevelopmentDocumentComparableVariableValue -Name $name -Value $baselineByCurrentName[$name] -SerializedBaseline
    }
    if ($actualCanonical -cne $expectedCanonical) {
      throw "The dark plan changed unapproved variable '$name'."
    }
  }
  if ([string]$PlanVariables.document_processing_deployment_stage.value -cne $Stage -or
    (ConvertTo-ExactBoolean $PlanVariables.document_scan_mapping_enabled.value "document_scan_mapping_enabled") -or
    (ConvertTo-ExactBoolean $PlanVariables.document_scan_event_rule_enabled.value "document_scan_event_rule_enabled") -or
    (ConvertTo-ExactBoolean $PlanVariables.document_security_health_rules_enabled.value "document_security_health_rules_enabled") -ne
    ($Stage -in @("parser-dark", "complete-dark"))) {
    throw "The requested stage must keep processing dark and set only the two security-health alert rules active."
  }
  if ($Stage -ceq "complete-dark" -and $ParserQualifiedArn -cnotmatch '^arn:aws:lambda:us-east-2:[0-9]{12}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$') {
    throw "Complete-dark requires one exact positive numeric parser-version ARN."
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
      if ($Statement.Principal -isnot [string] -or [string]$Statement.Principal -cne "*") {
        throw "Unexpected candidate deny principal shape."
      }
      $malwareRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-malware-scan"
      $principalArn = $Statement.Condition.ArnNotEquals."aws:PrincipalArn"
      if ($principalArn -isnot [string] -or [string]$principalArn -cne $malwareRole) {
        throw "Unexpected candidate deny malware-scan role condition."
      }
      Assert-ExactCondition $Statement.Condition @{
        StringNotEquals = @{ "s3:ExistingObjectTag/GuardDutyMalwareScanStatus" = @("NO_THREATS_FOUND") }
        ArnNotEquals = @{ "aws:PrincipalArn" = @($malwareRole) }
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
  Assert-NoTerraformReplacementPaths $Change
  $afterCopy = $Change.after | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $afterCopy.policy = $Change.before.policy
  if ((ConvertTo-DeploymentCanonicalValue $Change.before -SortArrays) -cne
    (ConvertTo-DeploymentCanonicalValue $afterCopy -SortArrays)) { throw "An approved update changed more than its policy document." }
  $afterUnknown = Get-OptionalTerraformChangeValue $Change "after_unknown"
  $afterSensitive = Get-OptionalTerraformChangeValue $Change "after_sensitive"
  $unknownPolicy = if ($null -eq $afterUnknown) { $null } else { $afterUnknown.PSObject.Properties["policy"] }
  $sensitivePolicy = if ($null -eq $afterSensitive) { $null } else { $afterSensitive.PSObject.Properties["policy"] }
  if ((ConvertTo-OptionalTerraformMetadataCanonicalValue $Change "before_sensitive" -SortArrays) -cne
    (ConvertTo-OptionalTerraformMetadataCanonicalValue $Change "after_sensitive" -SortArrays) -or
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
  param([Parameter(Mandatory)][object[]]$Changes, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage)
  $byAddress = @{}; foreach ($change in $Changes) { $byAddress[[string]$change.address] = $change }
  $expectedActions = Get-DevelopmentDocumentStageExpectedActions -Stage $Stage
  foreach ($address in @($expectedActions.Keys | Where-Object { $expectedActions[$_] -eq "update" })) {
    Assert-OnlyPolicyAttributeChanged $byAddress[$address].change
  }
  if ($Stage -ceq "parser-dark") {
    $s3Change = $byAddress["module.platform.aws_s3_bucket_policy.candidate_documents[0]"].change
    $beforeS3 = ConvertFrom-IamPolicyValue $s3Change.before.policy
    $afterS3 = ConvertFrom-IamPolicyValue $s3Change.after.policy
    if ([string]$beforeS3.Version -cne "2012-10-17" -or [string]$afterS3.Version -cne "2012-10-17") {
      throw "The candidate-document bucket policy version is not exact."
    }
    $transport = @($beforeS3.Statement | Where-Object Sid -eq "DenyInsecureTransport")[0]
    $bucketArn = @($transport.Resource | Where-Object { [string]$_ -notlike "*/*" })[0]
    $s3 = Get-PolicyAddedStatements $s3Change.before.policy $s3Change.after.policy @("DenyQuarantineReadsWithoutCleanMalwareTag")
    Assert-ExactAddedStatement $s3[0] CandidateDeny $AccountId $bucketArn
    $sns = $byAddress["module.platform.aws_sns_topic_policy.operational_alerts"].change
    $addedSns = Get-PolicyAddedStatements $sns.before.policy $sns.after.policy @("AllowExactDocumentOperationalRules")
    Assert-ExactAddedStatement $addedSns[0] SnsAlerts $AccountId
    return
  }
  $sqs = $byAddress["module.platform.aws_vpc_endpoint.sqs[0]"].change
  $addedSqs = Get-PolicyAddedStatements $sqs.before.policy $sqs.after.policy @("ExactDocumentProcessorQueueOnly")
  Assert-ExactAddedStatement $addedSqs[0] SqsProcessor $AccountId
  $lambda = $byAddress["module.platform.aws_vpc_endpoint.lambda[0]"].change
  $addedLambda = Get-PolicyAddedStatements $lambda.before.policy $lambda.after.policy @("CoordinatorInvokesExactParserVersionOnly")
  Assert-ExactAddedStatement $addedLambda[0] LambdaParser $AccountId
  $secrets = $byAddress["module.platform.aws_vpc_endpoint.secretsmanager[0]"].change
  Assert-SecretEndpointPolicyDelta $secrets.before.policy $secrets.after.policy $AccountId
}

function Assert-DevelopmentDocumentKmsPrerequisiteVariables {
  param([Parameter(Mandatory)][object]$BaselineVariables, [Parameter(Mandatory)][object]$PlanVariables)
  $emptyReceipt = [pscustomobject]@{ artifacts = @(
      [pscustomobject]@{ artifactName = "document-processor-lambda"; suffix = "zip"; key = ""; versionId = ""; artifactSha256 = ""; objectBase64Sha256 = "" },
      [pscustomobject]@{ artifactName = "document-parser-lambda"; suffix = "zip"; key = ""; versionId = ""; artifactSha256 = ""; objectBase64Sha256 = "" }
    ) }
  Assert-DevelopmentDocumentDarkVariables $BaselineVariables $PlanVariables $emptyReceipt "kms-prerequisite"
}

function Assert-DevelopmentDocumentKmsPrerequisitePlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string]$AccountId)
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($Plan.resource_drift) -RootModule $Plan.planned_values.root_module
  $nonNoop = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" })
  $data = @($nonNoop | Where-Object mode -eq "data")
  if ($data.Count -ne 0) { throw "The KMS prerequisite plan must not defer any data reads." }
  $managed = @($nonNoop | Where-Object mode -eq "managed")
  if ($managed.Count -ne 1 -or [string]$managed[0].address -cne "module.platform.aws_kms_key.platform" -or
    [string]$managed[0].type -cne "aws_kms_key" -or (@($managed[0].change.actions) -join ",") -cne "update") {
    throw "The KMS prerequisite must contain exactly one in-place platform KMS update."
  }
  Assert-OnlyPolicyAttributeChanged $managed[0].change
  $added = Get-PolicyAddedStatements $managed[0].change.before.policy $managed[0].change.after.policy `
    @("AllowEventBridgeDocumentScanQueueEncryption", "AllowEventBridgeDocumentOperationalAlertEncryption")
  Assert-ExactAddedStatement @($added | Where-Object Sid -eq "AllowEventBridgeDocumentScanQueueEncryption")[0] KmsQueue $AccountId
  Assert-ExactAddedStatement @($added | Where-Object Sid -eq "AllowEventBridgeDocumentOperationalAlertEncryption")[0] KmsAlerts $AccountId
  return $managed[0]
}

function Assert-ExactDocumentTrustPolicy {
  param([Parameter(Mandatory)][object]$PolicyValue, [Parameter(Mandatory)][ValidateSet("Lambda", "ObjectAccess")][string]$Kind,
    [Parameter(Mandatory)][string]$AccountId)
  $policy = ConvertFrom-IamPolicyValue $PolicyValue
  $statements = @($policy.Statement)
  if ([string]$policy.Version -cne "2012-10-17" -or $statements.Count -ne 1) { throw "A document role trust policy has an unexpected shape." }
  $statement = $statements[0]
  Assert-ExactObjectKeys $statement @("Action", "Effect", "Principal") "document trust statement"
  Assert-ExactStringSet $statement.Action @("sts:AssumeRole") "document trust actions"
  Assert-ExactStringSet $statement.Effect @("Allow") "document trust effect"
  Assert-ExactObjectKeys $statement.Principal @($(if ($Kind -eq "Lambda") { "Service" } else { "AWS" })) "document trust principal"
  if ($Kind -eq "Lambda") {
    Assert-ExactStringSet $statement.Principal.Service @("lambda.amazonaws.com") "document Lambda trust principal"
  } else {
    Assert-ExactStringSet $statement.Principal.AWS @("arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor") "object-access trust principal"
  }
}

function Assert-ExactDocumentIdentityPolicy {
  param([Parameter(Mandatory)][object]$PolicyValue, [Parameter(Mandatory)][ValidateSet("Processor", "Parser", "ObjectAccess")][string]$Kind,
    [Parameter(Mandatory)][string]$AccountId, [Parameter(Mandatory)][string]$PlatformKmsArn)
  if ($PlatformKmsArn -notmatch "^arn:aws:kms:us-east-2:${AccountId}:key/[a-f0-9-]+$") { throw "The exact plan-owned platform KMS ARN is unavailable." }
  $policy = ConvertFrom-IamPolicyValue $PolicyValue
  if ([string]$policy.Version -cne "2012-10-17") { throw "A document identity policy version is invalid." }
  $statements = @($policy.Statement)
  $expected = switch ($Kind) {
    "Processor" { @{
        WriteOwnedLogs = @("logs:CreateLogStream", "logs:PutLogEvents"); ManageVpcInterfaces = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses")
        ReadDatabaseSecret = @("secretsmanager:GetSecretValue"); ConsumeExactScanQueue = @("sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage")
        InvokeExactParserVersion = @("lambda:InvokeFunction"); AssumeExactObjectAccessRole = @("sts:AssumeRole"); ReadNormalizedDocumentsOnly = @("s3:GetObject", "s3:GetObjectVersion")
        DecryptOwnedRuntimeData = @("kms:Decrypt", "kms:GenerateDataKey"); WriteNativeTraces = @("xray:PutTelemetryRecords", "xray:PutTraceSegments")
      } }
    "Parser" { @{ ManageVpcInterfaces = @("ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"); DecryptLambdaEnvironment = @("kms:Decrypt") } }
    "ObjectAccess" { @{ SessionPolicyMustNarrowObjectAccess = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObject"); EncryptAndDecryptViaS3Only = @("kms:Decrypt", "kms:GenerateDataKey") } }
  }
  if ((@($statements.Sid | Sort-Object) -join "|") -cne (@($expected.Keys | Sort-Object) -join "|")) { throw "A document identity policy has unexpected Sids." }
  foreach ($statement in $statements) {
    Assert-ExactStringSet $statement.Effect @("Allow") "document identity effect"
    Assert-ExactStringSet $statement.Action @($expected[[string]$statement.Sid]) "document identity actions"
    if ($null -ne $statement.PSObject.Properties["Principal"]) { throw "An identity policy contains a principal." }
    $resources = @($statement.Resource | ForEach-Object { [string]$_ })
    $resourcePattern = switch ([string]$statement.Sid) {
      "WriteOwnedLogs" { "^arn:aws:logs:us-east-2:${AccountId}:log-group:/ai-job-apply/development/application:\*$" }
      "ReadDatabaseSecret" { "^arn:aws:secretsmanager:us-east-2:${AccountId}:secret:ai-job-apply/development/database-url-[A-Za-z0-9]+$" }
      "ConsumeExactScanQueue" { "^arn:aws:sqs:us-east-2:${AccountId}:ai-job-apply-development-document-scan-results$" }
      "InvokeExactParserVersion" { "^arn:aws:lambda:us-east-2:${AccountId}:function:ai-job-apply-development-document-parser:[1-9][0-9]*$" }
      "AssumeExactObjectAccessRole" { "^arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-object-access$" }
      "ReadNormalizedDocumentsOnly" { "^arn:aws:s3:::ai-job-apply-development-candidate-docs-${AccountId}/normalized/\*$" }
      "SessionPolicyMustNarrowObjectAccess" { "^arn:aws:s3:::ai-job-apply-development-candidate-docs-${AccountId}/(quarantine|normalized)/\*$" }
      "DecryptOwnedRuntimeData" { "^$([regex]::Escape($PlatformKmsArn))$" }
      "DecryptLambdaEnvironment" { "^$([regex]::Escape($PlatformKmsArn))$" }
      "EncryptAndDecryptViaS3Only" { "^$([regex]::Escape($PlatformKmsArn))$" }
      default { "^\*$" }
    }
    if (@($resources | Where-Object { $_ -notmatch $resourcePattern }).Count -ne 0 -or
      ([string]$statement.Sid -eq "SessionPolicyMustNarrowObjectAccess" -and $resources.Count -ne 2) -or
      ([string]$statement.Sid -ne "SessionPolicyMustNarrowObjectAccess" -and $resources.Count -ne 1)) { throw "A document identity statement has unexpected resources." }
    if ([string]$statement.Sid -eq "DecryptLambdaEnvironment") {
      Assert-ExactCondition $statement.Condition @{ StringEquals = @{ "kms:ViaService" = @("lambda.us-east-2.amazonaws.com") } }
    } elseif ([string]$statement.Sid -eq "EncryptAndDecryptViaS3Only") {
      Assert-ExactCondition $statement.Condition @{ StringEquals = @{ "kms:ViaService" = @("s3.us-east-2.amazonaws.com") } }
    } elseif ($null -ne $statement.PSObject.Properties["Condition"]) { throw "An unexpected identity-policy condition is present." }
  }
}

function Assert-ExactDocumentCreatedResourcePolicies {
  param([Parameter(Mandatory)][hashtable]$ByAddress, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$PlatformKmsArn,
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage)
  if ($Stage -ceq "complete-dark") {
    Assert-ExactDocumentIdentityPolicy $ByAddress["module.platform.aws_iam_role_policy.document_processor[0]"].change.after.policy Processor $AccountId $PlatformKmsArn
    $objectRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-object-access"
    $processorRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor"
    $stsPolicy = ConvertFrom-IamPolicyValue $ByAddress["module.platform.aws_vpc_endpoint.sts[0]"].change.after.policy
    $sts = @($stsPolicy.Statement)
    if ([string]$stsPolicy.Version -cne "2012-10-17" -or $sts.Count -ne 1 -or [string]$sts[0].Sid -cne "CoordinatorAssumesExactDocumentObjectRoleOnly") { throw "The STS endpoint policy has an unexpected shape." }
    Assert-ExactStringSet $sts[0].Effect @("Allow") "STS endpoint effect"
    Assert-ExactStringSet $sts[0].Action @("sts:AssumeRole") "STS endpoint actions"
    Assert-ExactStringSet $sts[0].Resource @($objectRole) "STS endpoint resources"
    if ($sts[0].Principal -isnot [string] -or [string]$sts[0].Principal -cne "*") {
      throw "The STS endpoint principal must be the exact canonical scalar wildcard."
    }
    Assert-ExactCondition $sts[0].Condition @{ ArnEquals = @{ "aws:PrincipalArn" = @($processorRole) } }
    return
  }
  Assert-ExactDocumentTrustPolicy $ByAddress["module.platform.aws_iam_role.document_processor[0]"].change.after.assume_role_policy Lambda $AccountId
  Assert-ExactDocumentTrustPolicy $ByAddress["module.platform.aws_iam_role.document_parser[0]"].change.after.assume_role_policy Lambda $AccountId
  Assert-ExactDocumentTrustPolicy $ByAddress["module.platform.aws_iam_role.document_parser_object_access[0]"].change.after.assume_role_policy ObjectAccess $AccountId
  Assert-ExactDocumentIdentityPolicy $ByAddress["module.platform.aws_iam_role_policy.document_parser[0]"].change.after.policy Parser $AccountId $PlatformKmsArn
  Assert-ExactDocumentIdentityPolicy $ByAddress["module.platform.aws_iam_role_policy.document_parser_object_access[0]"].change.after.policy ObjectAccess $AccountId $PlatformKmsArn

  foreach ($definition in @(
      @("document_scan_results", "ExactGuardDutyResultRuleOnly", "ai-job-apply-development-document-scan-results", @("ai-job-apply-development-document-scan-results")),
      @("document_scan_delivery_dead_letter", "ExactEventBridgeRuleDeadLettersOnly", "ai-job-apply-development-document-scan-delivery-dlq", @("ai-job-apply-development-document-scan-results", "ai-job-apply-development-document-scan-tag-failure", "ai-job-apply-development-document-scan-plan-unhealthy", "ai-job-apply-development-document-processing-reconciler"))
    )) {
    $change = $ByAddress["module.platform.aws_sqs_queue_policy.$($definition[0])[0]"].change.after
    $expectedUrl = "https://sqs.us-east-2.amazonaws.com/${AccountId}/$($definition[2])"
    if ([string]$change.queue_url -cne $expectedUrl) { throw "A document queue policy targets an unexpected URL." }
    $policy = ConvertFrom-IamPolicyValue $change.policy; $statements = @($policy.Statement)
    if ([string]$policy.Version -cne "2012-10-17" -or $statements.Count -ne 1 -or [string]$statements[0].Sid -cne [string]$definition[1]) { throw "A document queue policy has an unexpected shape." }
    Assert-ExactStringSet $statements[0].Effect @("Allow") "queue policy effect"; Assert-ExactStringSet $statements[0].Action @("sqs:SendMessage") "queue policy actions"
    Assert-ExactStringSet $statements[0].Resource @("arn:aws:sqs:us-east-2:${AccountId}:$($definition[2])") "queue policy resources"
    Assert-ExactObjectKeys $statements[0].Principal @("Service") "queue policy principal"; Assert-ExactStringSet $statements[0].Principal.Service @("events.amazonaws.com") "queue policy principal"
    Assert-ExactCondition $statements[0].Condition @{ ArnEquals = @{ "aws:SourceArn" = @($definition[3] | ForEach-Object { "arn:aws:events:us-east-2:${AccountId}:rule/$_" }) }; StringEquals = @{ "aws:SourceAccount" = @($AccountId) } }
  }

  $objectRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-object-access"; $processorRole = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-document-processor"
  $s3Policy = ConvertFrom-IamPolicyValue $ByAddress["module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"].change.after.policy
  $expectedS3 = @{ ExactParserQuarantineReadsOnly = @("s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging"); ExactParserNormalizedWritesAndVerification = @("s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"); ExactCoordinatorNormalizedReadsOnly = @("s3:GetObject", "s3:GetObjectVersion") }
  if ([string]$s3Policy.Version -cne "2012-10-17" -or
    (@($s3Policy.Statement.Sid | Sort-Object) -join "|") -cne (@($expectedS3.Keys | Sort-Object) -join "|")) { throw "The S3 endpoint policy has an unexpected version or Sids." }
  foreach ($statement in @($s3Policy.Statement)) {
    Assert-ExactStringSet $statement.Effect @("Allow") "S3 endpoint effect"; Assert-ExactStringSet $statement.Action @($expectedS3[[string]$statement.Sid]) "S3 endpoint actions"
    if ($statement.Principal -isnot [string] -or [string]$statement.Principal -cne "*") {
      throw "The S3 endpoint principal must be the exact canonical scalar wildcard."
    }
    $prefix = if ([string]$statement.Sid -eq "ExactParserQuarantineReadsOnly") { "quarantine" } else { "normalized" }
    Assert-ExactStringSet $statement.Resource @("arn:aws:s3:::ai-job-apply-development-candidate-docs-${AccountId}/$prefix/*") "S3 endpoint resources"
    Assert-ExactCondition $statement.Condition @{ ArnEquals = @{ "aws:PrincipalArn" = @($(if ([string]$statement.Sid -eq "ExactCoordinatorNormalizedReadsOnly") { $processorRole } else { $objectRole })) } }
  }
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

function Get-DevelopmentDocumentCurrentOutputNames {
  @(
    "alert_delivery_canary_alarm_name", "application_security_group_id", "artifact_bucket",
    "candidate_data_export_bucket", "candidate_deletion_recovery_bucket", "candidate_document_bucket",
    "candidate_document_malware_protection_plan_id", "candidate_rights_auth0_secret_arn", "cost_export_arn",
    "cost_export_bucket", "document_parser_version_arn", "document_processor_alias_arn",
    "document_scan_event_rule_arn", "document_scan_event_source_mapping_uuid", "ecs_cluster_arn",
    "gateway_lambda_alias_arn", "gateway_lambda_authorizer_id", "gateway_lambda_function_name", "gateway_url",
    "ingestion_dead_letter_queue_arn", "ingestion_dispatch_queue_arn", "ingestion_durable_version_arn",
    "ingestion_provider_activation_allowed", "ingestion_provider_private_egress", "ingestion_provider_source_count",
    "ingestion_runtime_deployed", "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled",
    "migration_repository_url", "migration_subnet_ids", "migration_task_definition_arn", "monthly_budget_name",
    "observability_dashboard_name", "operational_alert_topic_arn", "outbox_reconciler_alias_arn",
    "outbox_reconciler_rule_arn", "outbox_starter_alias_arn", "outbox_starter_event_source_mapping_uuid",
    "profile_readiness_activity_alias_arn", "profile_readiness_durable_alias_arn",
    "profile_readiness_durable_version_arn", "profile_readiness_terminal_alias_arn",
    "profile_readiness_terminal_rule_arn", "public_job_lambda_alias_arn", "public_job_lambda_function_name",
    "public_job_projection_lambda_alias_arn", "public_job_projection_lambda_function_name",
    "public_job_route_id", "public_job_sitemap_route_id", "vpc_id"
  )
}

function Assert-DevelopmentDocumentCompleteDarkSourceTransitionOutputs {
  param(
    [Parameter(Mandatory)][object]$OutputChanges,
    [Parameter(Mandatory)][string]$ParserQualifiedArn
  )

  $transitionActions = [ordered]@{
    document_parser_version_arn = "update"
    document_processor_alias_arn = "create"
    document_scan_event_source_mapping_uuid = "create"
  }
  $noOpNames = @(Get-DevelopmentDocumentCurrentOutputNames | Where-Object { -not $transitionActions.Contains($_) })
  Assert-ExactObjectKeys $OutputChanges @($noOpNames + $transitionActions.Keys) `
    "CompleteDark source-transition outputs"

  foreach ($name in $noOpNames) {
    $change = $OutputChanges.PSObject.Properties[$name].Value
    Assert-ExactObjectKeys $change @(
      "actions", "after", "after_sensitive", "after_unknown", "before", "before_sensitive"
    ) "CompleteDark no-op output '$name'"
    $allowsNull = $name -in @("public_job_route_id", "public_job_sitemap_route_id")
    if ((@($change.actions) -join ",") -cne "no-op" -or
      ($allowsNull -and ($null -ne $change.before -or $null -ne $change.after)) -or
      (-not $allowsNull -and ($null -eq $change.before -or $null -eq $change.after)) -or
      (ConvertTo-DeploymentCanonicalValue $change.before) -cne
      (ConvertTo-DeploymentCanonicalValue $change.after) -or
      $change.after_unknown -isnot [bool] -or $change.after_unknown -or
      $change.before_sensitive -isnot [bool] -or $change.after_sensitive -isnot [bool] -or
      $change.before_sensitive -ne $change.after_sensitive) {
      throw "CompleteDark output '$name' is not an exact known sensitivity-stable no-op."
    }
  }

  foreach ($entry in $transitionActions.GetEnumerator()) {
    $name = [string]$entry.Key
    $change = $OutputChanges.PSObject.Properties[$name].Value
    $keys = @("actions", "after_sensitive", "after_unknown", "before", "before_sensitive")
    if ($null -ne $change.PSObject.Properties["after"]) { $keys += "after" }
    Assert-ExactObjectKeys $change $keys "CompleteDark transitioning output '$name'"
    $expectedBefore = if ($name -ceq "document_parser_version_arn") { $ParserQualifiedArn } else { $null }
    if ((@($change.actions) -join ",") -cne [string]$entry.Value -or
      $(if ($null -eq $expectedBefore) { $null -ne $change.before } else { [string]$change.before -cne $expectedBefore }) -or
      $null -ne (Get-OptionalTerraformChangeValue $change "after") -or
      $change.after_unknown -isnot [bool] -or -not $change.after_unknown -or
      $change.before_sensitive -isnot [bool] -or $change.before_sensitive -or
      $change.after_sensitive -isnot [bool] -or $change.after_sensitive) {
      throw "CompleteDark output '$name' is not its exact nonsensitive unknown transition."
    }
  }
}

function Assert-DevelopmentDocumentCompleteDarkParserRefreshOutputs {
  param(
    [Parameter(Mandatory)][object]$OutputChanges,
    [Parameter(Mandatory)][string]$ParserQualifiedArn
  )

  $expectedNames = @(Get-DevelopmentDocumentCurrentOutputNames)
  Assert-ExactObjectKeys $OutputChanges $expectedNames "CompleteDark parser-refresh outputs"
  foreach ($name in $expectedNames) {
    $change = $OutputChanges.PSObject.Properties[$name].Value
    if ($name -ceq "document_parser_version_arn") {
      $keys = @("actions", "after_sensitive", "after_unknown", "before", "before_sensitive")
      if ($null -ne $change.PSObject.Properties["after"]) { $keys += "after" }
      Assert-ExactObjectKeys $change $keys "CompleteDark parser-refresh output"
      if ((@($change.actions) -join ",") -cne "update" -or [string]$change.before -cne $ParserQualifiedArn -or
        $null -ne (Get-OptionalTerraformChangeValue $change "after") -or
        $change.after_unknown -isnot [bool] -or -not $change.after_unknown -or
        $change.before_sensitive -isnot [bool] -or $change.before_sensitive -or
        $change.after_sensitive -isnot [bool] -or $change.after_sensitive) {
        throw "The CompleteDark parser-refresh output is not its exact nonsensitive unknown update."
      }
      continue
    }
    Assert-ExactObjectKeys $change @(
      "actions", "after", "after_sensitive", "after_unknown", "before", "before_sensitive"
    ) "CompleteDark parser-refresh no-op output '$name'"
    $allowsNull = $name -in @("public_job_route_id", "public_job_sitemap_route_id")
    if ((@($change.actions) -join ",") -cne "no-op" -or
      ($allowsNull -and ($null -ne $change.before -or $null -ne $change.after)) -or
      (-not $allowsNull -and ($null -eq $change.before -or $null -eq $change.after)) -or
      (ConvertTo-DeploymentCanonicalValue $change.before) -cne
      (ConvertTo-DeploymentCanonicalValue $change.after) -or
      $change.after_unknown -isnot [bool] -or $change.after_unknown -or
      $change.before_sensitive -isnot [bool] -or $change.after_sensitive -isnot [bool] -or
      $change.before_sensitive -ne $change.after_sensitive) {
      throw "CompleteDark parser-refresh output '$name' is not an exact known sensitivity-stable no-op."
    }
  }
}

function Assert-DevelopmentDocumentDarkPlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage,
    [switch]$ParserSourceTransition,
    [switch]$CompleteDarkParserRefresh,
    [switch]$CompleteDarkProcessorRefresh,
    [AllowNull()][object]$BaselineVariables,
    [AllowNull()][object]$Receipt,
    [string]$ParserQualifiedArn = "")

  if ([string]$Plan.terraform_version -cne "1.9.8" -or $Plan.errored -or -not $Plan.complete -or -not $Plan.applyable) {
    throw "The document dark transition must be a successful applyable Terraform 1.9.8 plan."
  }
  $outputChanges = Get-OptionalTerraformChangeValue $Plan "output_changes"
  if (@(@($ParserSourceTransition, $CompleteDarkParserRefresh, $CompleteDarkProcessorRefresh) |
      Where-Object { $_ }).Count -gt 1) {
    throw "A CompleteDark plan may select only one artifact-transition mode."
  }
  if (($ParserSourceTransition -or $CompleteDarkParserRefresh -or $CompleteDarkProcessorRefresh) -and
    ($Stage -cne "complete-dark" -or $null -eq $BaselineVariables -or
      $null -eq $Receipt -or [string]::IsNullOrWhiteSpace($ParserQualifiedArn))) {
    throw "A CompleteDark artifact transition requires retained variables, receipt, and version pin."
  }
  if ($ParserSourceTransition) {
    Assert-DevelopmentDocumentCompleteDarkSourceTransitionOutputs `
      -OutputChanges $outputChanges -ParserQualifiedArn $ParserQualifiedArn
  }
  elseif ($CompleteDarkParserRefresh) {
    Assert-DevelopmentDocumentCompleteDarkParserRefreshOutputs `
      -OutputChanges $outputChanges -ParserQualifiedArn $ParserQualifiedArn
  }
  else {
    $meaningfulOutputs = @(
      if ($null -ne $outputChanges) {
        $outputChanges.PSObject.Properties | Where-Object {
          $actions = @($_.Value.actions)
          -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
        }
      }
    )
    if ($meaningfulOutputs.Count -ne 0) { throw "The document dark transition contains a meaningful output change." }
  }
  $expected = Get-DevelopmentDocumentStageExpectedActions -Stage $Stage `
    -ParserSourceTransition:$ParserSourceTransition -CompleteDarkParserRefresh:$CompleteDarkParserRefresh `
    -CompleteDarkProcessorRefresh:$CompleteDarkProcessorRefresh
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($Plan.resource_drift) -RootModule $Plan.planned_values.root_module
  $kmsRecords = @($Plan.resource_changes | Where-Object { [string]$_.address -ceq "module.platform.aws_kms_key.platform" })
  if ($kmsRecords.Count -ne 1 -or [string]$kmsRecords[0].mode -cne "managed" -or
    [string]$kmsRecords[0].type -cne "aws_kms_key" -or (@($kmsRecords[0].change.actions) -join ",") -cne "no-op" -or
    [string]$kmsRecords[0].change.before.arn -cne [string]$kmsRecords[0].change.after.arn -or
    (ConvertTo-OptionalTerraformMetadataCanonicalValue $kmsRecords[0].change "after_unknown") -cne "{}" -or
    (ConvertTo-OptionalTerraformMetadataCanonicalValue $kmsRecords[0].change "before_sensitive" -SortArrays) -cne
    (ConvertTo-OptionalTerraformMetadataCanonicalValue $kmsRecords[0].change "after_sensitive" -SortArrays)) {
    throw "The final dark plan does not bind security policies to one exact no-op platform KMS key."
  }
  $platformKmsArn = [string]$kmsRecords[0].change.after.arn
  Assert-NoTerraformReplacementPaths $kmsRecords[0].change
  $nonNoop = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" })
  $dataReads = @($nonNoop | Where-Object mode -eq "data")
  Assert-DevelopmentDocumentExactDataReads -Records $dataReads
  $changes = @($nonNoop | Where-Object mode -eq "managed")
  if ($changes.Count -ne $expected.Count) {
    throw "The dark plan has $($changes.Count) changes; exactly $($expected.Count) are approved."
  }
  foreach ($change in $changes) {
    $address = [string]$change.address
    if (-not $expected.ContainsKey($address)) { throw "The dark plan changes an unapproved resource: $address." }
    $action = @($change.change.actions) -join ","
    if ($action -cne $expected[$address]) { throw "The dark plan action for '$address' must be '$($expected[$address])'." }
  }

  $refresh = $CompleteDarkParserRefresh -or $CompleteDarkProcessorRefresh
  $securityCreateFields = if ($refresh) { @{} } elseif ($Stage -ceq "parser-dark") { @{
      "module.platform.aws_iam_role.document_processor[0]" = @("assume_role_policy")
      "module.platform.aws_iam_role.document_parser[0]" = @("assume_role_policy")
      "module.platform.aws_iam_role.document_parser_object_access[0]" = @("assume_role_policy")
      "module.platform.aws_iam_role_policy.document_parser[0]" = @("policy", "role")
      "module.platform.aws_iam_role_policy.document_parser_object_access[0]" = @("policy", "role")
      "module.platform.aws_sqs_queue_policy.document_scan_delivery_dead_letter[0]" = @("policy", "queue_url")
      "module.platform.aws_sqs_queue_policy.document_scan_results[0]" = @("policy", "queue_url")
      "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]" = @("policy")
    } } else { @{
      "module.platform.aws_iam_role_policy.document_processor[0]" = @("policy", "role")
      "module.platform.aws_vpc_endpoint.sts[0]" = @("policy")
    } }
  $byAddress = @{}; foreach ($change in $changes) { $byAddress[[string]$change.address] = $change }
  foreach ($entry in $securityCreateFields.GetEnumerator()) {
    foreach ($field in @($entry.Value)) {
      $afterUnknown = Get-OptionalTerraformChangeValue $byAddress[$entry.Key].change "after_unknown"
      $unknown = if ($null -eq $afterUnknown) { $null } else { $afterUnknown.PSObject.Properties[$field] }
      if ($null -ne $unknown -and (ConvertTo-DeploymentCanonicalValue $unknown.Value -SortArrays) -match 'true') {
        throw "Security field '$field' must be fully known before review for '$($entry.Key)'."
      }
      $value = $byAddress[$entry.Key].change.after.PSObject.Properties[$field]
      if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value.Value)) {
        throw "Security field '$field' is unavailable for exact review on '$($entry.Key)'."
      }
    }
  }
  $policyUpdates = Get-DevelopmentDocumentStageExpectedActions -Stage $Stage `
    -CompleteDarkParserRefresh:$CompleteDarkParserRefresh `
    -CompleteDarkProcessorRefresh:$CompleteDarkProcessorRefresh
  foreach ($address in @($policyUpdates.Keys | Where-Object { $policyUpdates[$_] -ceq "update" })) {
    $afterUnknown = Get-OptionalTerraformChangeValue $byAddress[$address].change "after_unknown"
    $unknown = if ($null -eq $afterUnknown) { $null } else { $afterUnknown.PSObject.Properties["policy"] }
    if (($null -ne $unknown -and (ConvertTo-DeploymentCanonicalValue $unknown.Value -SortArrays) -match 'true') -or
      [string]::IsNullOrWhiteSpace([string]$byAddress[$address].change.after.policy)) {
      throw "Updated security policy must be fully known before review for '$address'."
    }
  }
  if (-not $refresh) {
    Assert-ExactDocumentCreatedResourcePolicies -ByAddress $byAddress -AccountId $AccountId -PlatformKmsArn $platformKmsArn -Stage $Stage
  }

  if ($Stage -ceq "parser-dark") {
    foreach ($ruleAddress in @(
      "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
      "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]",
      "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]",
      "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"
      )) {
      $expectedState = if ($ruleAddress -in @(
          "module.platform.aws_cloudwatch_event_rule.document_scan_tag_failure[0]",
          "module.platform.aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0]"
        )) { "ENABLED" } else { "DISABLED" }
      if ([string]$byAddress[$ruleAddress].change.after.state -cne $expectedState) {
        throw "A document EventBridge rule does not match its reviewed processing-dark/security-alert state."
      }
    }
  }
  elseif (-not $refresh) {
    $mapping = $byAddress["module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"]
    if (ConvertTo-ExactBoolean $mapping.change.after.enabled "document mapping enabled") {
      throw "The document queue mapping must be disabled in complete-dark."
    }
  }
  if (-not $refresh) {
    Assert-ApprovedPolicyUpdateSemantics -Changes $changes -AccountId $AccountId -Stage $Stage
  }
  if ($ParserSourceTransition) {
    Assert-ExactDocumentParserSourceTransition -Changes $changes -BaselineVariables $BaselineVariables `
      -Receipt $Receipt -ParserQualifiedArn $ParserQualifiedArn
  }
  elseif ($CompleteDarkParserRefresh) {
    Assert-ExactDocumentParserSourceTransition -Changes $changes -BaselineVariables $BaselineVariables `
      -Receipt $Receipt -ParserQualifiedArn $ParserQualifiedArn
  }
  elseif ($CompleteDarkProcessorRefresh) {
    Assert-ExactDocumentProcessorRefresh -Changes $changes -BaselineVariables $BaselineVariables `
      -Receipt $Receipt -ParserQualifiedArn $ParserQualifiedArn -AccountId $AccountId
  }
  return $changes
}
