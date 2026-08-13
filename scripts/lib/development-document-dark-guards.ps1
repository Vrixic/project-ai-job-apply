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
    "deploy_gateway_lambda", "deploy_profile_readiness_durable", "deploy_serverless_outbox",
    "document_scan_event_rule_enabled", "document_scan_mapping_enabled", "document_security_health_rules_enabled",
    "enable_container_insights", "enable_redis", "high_availability",
    "private_application_networking", "serverless_runtime_enabled"
  )
}

function Get-DevelopmentDocumentVariableKinds {
  $kinds = @{}
  foreach ($name in @(Get-DevelopmentDocumentBooleanVariableNames)) { $kinds[$name] = "boolean" }
  foreach ($name in @(
      "gateway_lambda_reserved_concurrency", "profile_readiness_execution_timeout_seconds",
      "profile_readiness_retention_days"
    )) { $kinds[$name] = "number" }
  $kinds["candidate_document_cors_allowed_origins"] = "composite"
  foreach ($name in @(
      "database_engine_version", "database_instance_class", "document_parser_artifact_base64sha256",
      "document_parser_invocation_qualified_arn", "document_processing_deployment_stage",
      "document_parser_artifact_s3_key", "document_parser_artifact_s3_object_version",
      "document_parser_artifact_sha256", "document_parser_version",
      "document_processor_artifact_base64sha256", "document_processor_artifact_s3_key",
      "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
      "document_processor_extension_layer_arn", "gateway_lambda_artifact_base64sha256",
      "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
      "gateway_lambda_artifact_sha256", "gateway_lambda_extension_layer_arn", "migration_image",
      "oidc_audience", "oidc_issuer", "profile_readiness_activity_artifact_base64sha256",
      "profile_readiness_activity_artifact_s3_key", "profile_readiness_activity_artifact_s3_object_version",
      "profile_readiness_activity_artifact_sha256", "profile_readiness_durable_artifact_base64sha256",
      "profile_readiness_durable_artifact_s3_key", "profile_readiness_durable_artifact_s3_object_version",
      "profile_readiness_durable_artifact_sha256", "profile_readiness_lambda_extension_layer_arn",
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
  param([Parameter(Mandatory)][ValidateSet("kms-prerequisite", "parser-dark", "complete-dark")][string]$Stage)
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
  $result = @{}
  $creates = if ($Stage -ceq "parser-dark") { $parserCreates } else { $completeCreates }
  $updates = if ($Stage -ceq "parser-dark") { $parserUpdates } else { $completeUpdates }
  foreach ($address in $creates) { $result[$address] = "create" }
  foreach ($address in $updates) { $result[$address] = "update" }
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

function Assert-DevelopmentDocumentAcceptedDriftSensitivity {
  param([Parameter(Mandatory)][object]$Record)
  $beforeCanonical = ConvertTo-OptionalTerraformMetadataCanonicalValue $Record.change "before_sensitive" -SortArrays
  $afterCanonical = ConvertTo-OptionalTerraformMetadataCanonicalValue $Record.change "after_sensitive" -SortArrays
  if ($beforeCanonical -ceq $afterCanonical) { return }

  if ([string]$Record.address -cne "module.platform.aws_ecs_task_definition.migration[0]") {
    throw "Accepted provider-observed drift has changed sensitivity metadata."
  }

  $beforeSensitive = Get-OptionalTerraformChangeValue $Record.change "before_sensitive"
  $afterSensitive = Get-OptionalTerraformChangeValue $Record.change "after_sensitive"
  if ($null -eq $beforeSensitive -or $null -eq $afterSensitive -or
    $null -ne $beforeSensitive.PSObject.Properties["tags"]) {
    throw "Migration task sensitivity drift is not the exact omitted-to-empty tags normalization."
  }

  $afterTagsProperty = $afterSensitive.PSObject.Properties["tags"]
  if ($null -eq $afterTagsProperty -or
    $afterTagsProperty.Value -isnot [Management.Automation.PSCustomObject] -or
    @($afterTagsProperty.Value.PSObject.Properties).Count -ne 0) {
    throw "Migration task sensitivity drift is not the exact omitted-to-empty tags normalization."
  }

  $normalizedAfterSensitive = [ordered]@{}
  foreach ($property in @($afterSensitive.PSObject.Properties)) {
    if ([string]$property.Name -cne "tags") { $normalizedAfterSensitive[[string]$property.Name] = $property.Value }
  }
  if ($beforeCanonical -cne
    (ConvertTo-DeploymentCanonicalValue ([pscustomobject]$normalizedAfterSensitive) -SortArrays)) {
    throw "Migration task sensitivity drift changed metadata other than the exact empty tags normalization."
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

function Assert-DevelopmentDocumentAcceptedResourceDrift {
  param([AllowNull()][object[]]$Records)
  $drift = @($Records)
  $allowed = @(
    "module.platform.aws_db_instance.postgres[0]",
    "module.platform.aws_ecs_task_definition.migration[0]"
  )
  if ($drift.Count -eq 0) { throw "The plan must contain a nonempty accepted resource-drift subset." }
  $seenAddresses = @()
  foreach ($record in $drift) {
    $address = [string]$record.address
    if (-not ($allowed -ccontains $address) -or $seenAddresses -ccontains $address) {
      throw "The plan contains unknown or duplicate resource drift."
    }
    $seenAddresses += $address
  }
  foreach ($record in $drift) {
    Assert-NoTerraformReplacementPaths $record.change
    if ([string]$record.mode -cne "managed" -or (@($record.change.actions) -join ",") -cne "update" -or
      (ConvertTo-OptionalTerraformMetadataCanonicalValue $record.change "after_unknown") -cne "{}") {
      throw "Accepted provider-observed drift has an unsafe action or metadata shape."
    }
    Assert-DevelopmentDocumentAcceptedDriftSensitivity $record
    $after = $record.change.after | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    if ([string]$record.address -ceq "module.platform.aws_db_instance.postgres[0]") {
      if ([string]$record.type -cne "aws_db_instance") { throw "RDS drift has an unexpected resource type." }
      $beforeClock = ConvertTo-StrictUtcWholeSecond $record.change.before.latest_restorable_time "RDS before restore clock"
      $afterClock = ConvertTo-StrictUtcWholeSecond $record.change.after.latest_restorable_time "RDS after restore clock"
      if ($afterClock -le $beforeClock) { throw "The provider-observed RDS restore clock did not move strictly forward." }
      $after.latest_restorable_time = $record.change.before.latest_restorable_time
    }
    else {
      if ([string]$record.type -cne "aws_ecs_task_definition" -or $null -ne $record.change.before.tags -or
        @($record.change.after.tags.PSObject.Properties).Count -ne 0) {
        throw "Migration task drift is not limited to provider-normalized empty tags."
      }
      $after.tags = $null
    }
    if ((ConvertTo-DeploymentCanonicalValue $record.change.before -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue $after -SortArrays)) { throw "Accepted drift changed another resource attribute." }
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
    [string]$ParserQualifiedArn = ""
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
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($Plan.resource_drift)
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
    Assert-ExactObjectKeys $sts[0].Principal @("AWS") "STS endpoint principal"
    Assert-ExactStringSet $sts[0].Principal.AWS @("*") "STS endpoint principal"
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
    Assert-ExactObjectKeys $statement.Principal @("AWS") "S3 endpoint principal"; Assert-ExactStringSet $statement.Principal.AWS @("*") "S3 endpoint principal"
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

function Assert-DevelopmentDocumentDarkPlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage)

  $expected = Get-DevelopmentDocumentStageExpectedActions -Stage $Stage
  Assert-DevelopmentDocumentAcceptedResourceDrift -Records @($Plan.resource_drift)
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

  $securityCreateFields = if ($Stage -ceq "parser-dark") { @{
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
  foreach ($address in @($expected.Keys | Where-Object { $expected[$_] -ceq "update" })) {
    $afterUnknown = Get-OptionalTerraformChangeValue $byAddress[$address].change "after_unknown"
    $unknown = if ($null -eq $afterUnknown) { $null } else { $afterUnknown.PSObject.Properties["policy"] }
    if (($null -ne $unknown -and (ConvertTo-DeploymentCanonicalValue $unknown.Value -SortArrays) -match 'true') -or
      [string]::IsNullOrWhiteSpace([string]$byAddress[$address].change.after.policy)) {
      throw "Updated security policy must be fully known before review for '$address'."
    }
  }
  Assert-ExactDocumentCreatedResourcePolicies -ByAddress $byAddress -AccountId $AccountId -PlatformKmsArn $platformKmsArn -Stage $Stage

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
  else {
    $mapping = $byAddress["module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"]
    if (ConvertTo-ExactBoolean $mapping.change.after.enabled "document mapping enabled") {
      throw "The document queue mapping must be disabled in complete-dark."
    }
  }
  Assert-ApprovedPolicyUpdateSemantics -Changes $changes -AccountId $AccountId -Stage $Stage
  return $changes
}
