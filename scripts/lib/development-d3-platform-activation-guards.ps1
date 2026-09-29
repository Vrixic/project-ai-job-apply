Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# D3-001 and D3-005 are activated independently. Both start from one checksum-reviewed,
# zero-drift Gateway baseline, and the operator refuses a plan that combines the two flags.
$script:D3PlatformActivationVariables = @(
  "restricted_answer_vault_enabled",
  "applications_attempt_recovery_enabled",
  "applications_attempt_recovery_artifact_s3_key",
  "applications_attempt_recovery_artifact_s3_object_version",
  "applications_attempt_recovery_artifact_sha256",
  "applications_attempt_recovery_artifact_base64sha256"
)
$script:ApplicationsRecoveryArtifactName = "applications-attempt-recovery-lambda"

$script:RestrictedAnswerVaultChanges = [ordered]@{
  "module.platform.aws_kms_key.restricted_answer_vault[0]" = @{
    Type = "aws_kms_key"; Actions = "create"
  }
  "module.platform.aws_kms_alias.restricted_answer_vault[0]" = @{
    Type = "aws_kms_alias"; Actions = "create"
  }
  "module.platform.aws_iam_role_policy.gateway_lambda[0]" = @{
    Type = "aws_iam_role_policy"; Actions = "update"
  }
  "module.platform.aws_lambda_function.gateway[0]" = @{
    Type = "aws_lambda_function"; Actions = "update"
  }
  "module.platform.aws_lambda_alias.gateway[0]" = @{
    Type = "aws_lambda_alias"; Actions = "update"
  }
}

$script:ApplicationsAttemptRecoveryChanges = [ordered]@{
  "module.platform.aws_iam_role.applications_attempt_recovery[0]" = @{ Type = "aws_iam_role"; Actions = "create" }
  "module.platform.aws_iam_role_policy.applications_attempt_recovery[0]" = @{ Type = "aws_iam_role_policy"; Actions = "create" }
  "module.platform.aws_sqs_queue.applications_attempt_recovery_dead_letter[0]" = @{ Type = "aws_sqs_queue"; Actions = "create" }
  "module.platform.aws_lambda_function.applications_attempt_recovery[0]" = @{ Type = "aws_lambda_function"; Actions = "create" }
  "module.platform.aws_lambda_alias.applications_attempt_recovery[0]" = @{ Type = "aws_lambda_alias"; Actions = "create" }
  "module.platform.aws_cloudwatch_event_rule.applications_attempt_recovery[0]" = @{ Type = "aws_cloudwatch_event_rule"; Actions = "create" }
  "module.platform.aws_cloudwatch_event_target.applications_attempt_recovery[0]" = @{ Type = "aws_cloudwatch_event_target"; Actions = "create" }
  "module.platform.aws_lambda_permission.applications_attempt_recovery[0]" = @{ Type = "aws_lambda_permission"; Actions = "create" }
  "module.platform.aws_cloudwatch_metric_alarm.applications_attempt_recovery_errors[0]" = @{ Type = "aws_cloudwatch_metric_alarm"; Actions = "create" }
  "module.platform.aws_cloudwatch_metric_alarm.applications_attempt_recovery_dead_letter[0]" = @{ Type = "aws_cloudwatch_metric_alarm"; Actions = "create" }
  "module.platform.aws_vpc_endpoint.secretsmanager[0]" = @{ Type = "aws_vpc_endpoint"; Actions = "update" }
}

function Get-ApplicationsRecoveryArtifact {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$BoundarySha256
  )
  $expectedKeys = @(
    "artifacts", "boundarySha256", "completedAt", "createdAt", "environment", "kind",
    "phase", "region", "schemaVersion", "sourceSha"
  ) | Sort-Object
  $actualKeys = @($Receipt.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (
    ($actualKeys -join "|") -cne ($expectedKeys -join "|") -or
    [int]$Receipt.schemaVersion -ne 1 -or
    [string]$Receipt.kind -cne "development-applications-recovery-lambda-publication" -or
    [string]$Receipt.environment -cne "development" -or
    [string]$Receipt.region -cne "us-east-2" -or
    [string]$Receipt.phase -cne "verified" -or
    [string]$Receipt.sourceSha -cne $SourceSha -or
    [string]$Receipt.boundarySha256 -cne $BoundarySha256
  ) {
    throw "The Applications recovery publication receipt does not match the exact release boundary."
  }
  $entries = @($Receipt.artifacts)
  $suffixes = @($entries | ForEach-Object { [string]$_.suffix } | Sort-Object)
  if (
    $entries.Count -ne 4 -or
    @($entries | Where-Object { [string]$_.artifactName -cne $script:ApplicationsRecoveryArtifactName }).Count -ne 0 -or
    ($suffixes -join ",") -cne "cdx.json,manifest.json,sha256,zip"
  ) {
    throw "The Applications recovery receipt must contain exactly one archive and its three evidence companions."
  }
  $zip = @($entries | Where-Object { [string]$_.suffix -ceq "zip" })[0]
  $artifactSha = [string]$zip.artifactSha256
  if (
    $artifactSha -cnotmatch "^[a-f0-9]{64}$" -or
    [string]$zip.objectSha256 -cne $artifactSha -or
    [string]$zip.objectBase64Sha256 -cnotmatch "^[A-Za-z0-9+/]{43}=$" -or
    [string]::IsNullOrWhiteSpace([string]$zip.versionId) -or
    [long]$zip.contentLength -lt 1 -or
    [string]$zip.key -cne "lambda/applications/$SourceSha/$artifactSha/$($script:ApplicationsRecoveryArtifactName).zip"
  ) {
    throw "The Applications recovery archive is not the exact immutable object for this source."
  }
  return [pscustomobject]@{
    key = [string]$zip.key
    versionId = [string]$zip.versionId
    artifactSha256 = $artifactSha
    objectBase64Sha256 = [string]$zip.objectBase64Sha256
    contentLength = [long]$zip.contentLength
  }
}

function Assert-D3PlatformActivationVariables {
  param(
    [Parameter(Mandatory)][ValidateSet("RestrictedAnswerVault", "ApplicationsAttemptRecovery")][string]$Component,
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$PlanVariables,
    [AllowNull()][object]$Artifact = $null
  )
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "|") -cne ($planNames -join "|")) {
    throw "The D3 platform activation changed the Terraform variable inventory."
  }
  foreach ($name in $script:D3PlatformActivationVariables) {
    if ($planNames -cnotcontains $name) { throw "The D3 platform activation variable '$name' is missing." }
  }

  $expected = @{}
  foreach ($name in $script:D3PlatformActivationVariables) {
    $expected[$name] = Get-GatewayPlanVariableValue $BaselineVariables $name
  }
  if ($Component -ceq "RestrictedAnswerVault") {
    if ($null -ne $Artifact) { throw "The vault activation cannot consume a Lambda artifact." }
    if (ConvertTo-ExactBoolean $expected.restricted_answer_vault_enabled "restricted_answer_vault_enabled") {
      throw "The restricted-answer vault is already enabled in the retained baseline."
    }
    $expected.restricted_answer_vault_enabled = $true
  } else {
    if ($null -eq $Artifact) { throw "The Applications recovery activation requires its verified artifact." }
    if (ConvertTo-ExactBoolean $expected.applications_attempt_recovery_enabled "applications_attempt_recovery_enabled") {
      throw "Applications attempt recovery is already enabled in the retained baseline."
    }
    $expected.applications_attempt_recovery_enabled = $true
    $expected.applications_attempt_recovery_artifact_s3_key = [string]$Artifact.key
    $expected.applications_attempt_recovery_artifact_s3_object_version = [string]$Artifact.versionId
    $expected.applications_attempt_recovery_artifact_sha256 = [string]$Artifact.artifactSha256
    $expected.applications_attempt_recovery_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
  }

  foreach ($name in $planNames) {
    $planned = Get-GatewayPlanVariableValue $PlanVariables $name
    $wanted = if ($expected.ContainsKey($name)) {
      $expected[$name]
    } else {
      Get-GatewayPlanVariableValue $BaselineVariables $name
    }
    if ((ConvertTo-GatewayCanonicalJson $planned) -cne (ConvertTo-GatewayCanonicalJson $wanted)) {
      throw "The D3 platform activation changed unrelated or incorrect input '$name'."
    }
  }
  return $true
}

function Get-D3MeaningfulOutputChanges {
  param([Parameter(Mandatory)][object]$Plan)
  $outputChanges = Get-GatewayOptionalProperty $Plan "output_changes"
  if ($null -eq $outputChanges) { return @() }
  return @($outputChanges.PSObject.Properties | Where-Object {
      $actions = @($_.Value.actions)
      -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
    })
}

function Assert-D3ActivationPlanEnvelope {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][System.Collections.Specialized.OrderedDictionary]$ExpectedChanges
  )
  if (
    [string]$Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or
    $Plan.errored -or
    -not $Plan.complete -or
    -not $Plan.applyable
  ) {
    throw "The D3 platform activation must be a successful current-version Terraform plan."
  }
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
  if (@(Get-D3MeaningfulOutputChanges $Plan).Count -ne 0) {
    throw "The D3 platform activation may not change Terraform outputs."
  }
  $changes = @(Get-GatewayMeaningfulChanges @($Plan.resource_changes))
  $addresses = @($changes | ForEach-Object { [string]$_.address } | Sort-Object)
  $reviewed = @($ExpectedChanges.Keys | Sort-Object)
  if (($addresses -join "|") -cne ($reviewed -join "|")) {
    throw "The D3 platform activation is not exactly the reviewed resource set."
  }
  foreach ($change in $changes) {
    $rule = $ExpectedChanges[[string]$change.address]
    $actions = @($change.change.actions | Sort-Object)
    if (
      [string]$change.mode -cne "managed" -or
      [string]$change.type -cne [string]$rule.Type -or
      ($actions -join ",") -cne [string]$rule.Actions
    ) {
      throw "The D3 platform activation has an unexpected action or type for '$($change.address)'."
    }
    Assert-NoTerraformReplacementPaths $change.change
  }
  return $changes
}

function Assert-ExactRestrictedAnswerVaultPlan {
  param([Parameter(Mandatory)][object]$Plan)
  $changes = @(Assert-D3ActivationPlanEnvelope -Plan $Plan -ExpectedChanges $script:RestrictedAnswerVaultChanges)
  $key = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_kms_key.restricted_answer_vault[0]" })[0]
  $alias = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_kms_alias.restricted_answer_vault[0]" })[0]
  $rolePolicy = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_iam_role_policy.gateway_lambda[0]" })[0]
  $function = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.gateway[0]" })[0]
  $afterKey = $key.change.after
  if (
    [int]$afterKey.deletion_window_in_days -ne 30 -or
    -not $afterKey.enable_key_rotation -or
    [string]$afterKey.description -cne "ai-job-apply development restricted-answer vault (ADR-010)"
  ) {
    throw "The restricted-answer vault key does not match its approved lifecycle and purpose."
  }
  if ([string]$alias.change.after.name -cne "alias/ai-job-apply-development-restricted-answer-vault") {
    throw "The restricted-answer vault alias is not the exact development alias."
  }
  $knownRolePolicy = Get-GatewayOptionalProperty $rolePolicy.change.after "policy"
  $unknownRolePolicy = Get-GatewayOptionalProperty $rolePolicy.change.after_unknown "policy"
  if ($null -eq $knownRolePolicy -and $unknownRolePolicy -ne $true) {
    throw "The Gateway role update does not carry the restricted-answer KMS grant."
  }
  $afterEnvironment = Get-GatewayOptionalProperty $function.change.after "environment"
  $unknownEnvironment = Get-GatewayOptionalProperty $function.change.after_unknown "environment"
  $environmentEntry = @($afterEnvironment | Where-Object { $null -ne $_ })
  $unknownEnvironmentEntry = @($unknownEnvironment | Where-Object { $null -ne $_ })
  $variables = if ($environmentEntry.Count -eq 1) {
    Get-GatewayOptionalProperty $environmentEntry[0] "variables"
  } else { $null }
  $unknownVariables = if ($unknownEnvironmentEntry.Count -eq 1) {
    Get-GatewayOptionalProperty $unknownEnvironmentEntry[0] "variables"
  } else { $null }
  $hasKnownBinding = $null -ne $variables -and $null -ne $variables.PSObject.Properties["RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN"]
  if (-not $hasKnownBinding -and $unknownVariables -ne $true -and
      ($null -eq $unknownVariables -or $null -eq $unknownVariables.PSObject.Properties["RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN"])) {
    throw "The Gateway update is not bound to the new restricted-answer vault key."
  }
  return $changes
}

function Assert-ExactApplicationsAttemptRecoveryPlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][object]$Artifact)
  $changes = @(Assert-D3ActivationPlanEnvelope -Plan $Plan -ExpectedChanges $script:ApplicationsAttemptRecoveryChanges)
  $function = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.applications_attempt_recovery[0]" })[0]
  $rule = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_cloudwatch_event_rule.applications_attempt_recovery[0]" })[0]
  $queue = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_sqs_queue.applications_attempt_recovery_dead_letter[0]" })[0]
  $permission = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_permission.applications_attempt_recovery[0]" })[0]
  $endpoint = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_vpc_endpoint.secretsmanager[0]" })[0]
  $after = $function.change.after
  if (
    [string]$after.function_name -cne "ai-job-apply-development-applications-attempt-recovery" -or
    [string]$after.runtime -cne "nodejs24.x" -or
    [string]$after.handler -cne "index.handler" -or
    [int]$after.memory_size -ne 512 -or
    [int]$after.timeout -ne 60 -or
    [int]$after.reserved_concurrent_executions -ne 1 -or
    -not $after.publish -or
    [string]$after.s3_key -cne [string]$Artifact.key -or
    [string]$after.s3_object_version -cne [string]$Artifact.versionId -or
    [string]$after.source_code_hash -cne [string]$Artifact.objectBase64Sha256 -or
    [string]@($after.environment)[0].variables.RELEASE_SHA -cne [string]$Artifact.artifactSha256
  ) {
    throw "The attempt-recovery Lambda is not the exact reviewed runtime and artifact."
  }
  if (
    [string]$rule.change.after.schedule_expression -cne "rate(5 minutes)" -or
    [string]$rule.change.after.state -cne "ENABLED" -or
    [long]$queue.change.after.message_retention_seconds -ne 1209600 -or
    [string]$permission.change.after.action -cne "lambda:InvokeFunction" -or
    [string]$permission.change.after.principal -cne "events.amazonaws.com"
  ) {
    throw "The attempt-recovery trigger, DLQ, or invocation grant is outside the reviewed boundary."
  }
  $knownEndpointPolicy = Get-GatewayOptionalProperty $endpoint.change.after "policy"
  $unknownEndpointPolicy = Get-GatewayOptionalProperty $endpoint.change.after_unknown "policy"
  if ($null -eq $knownEndpointPolicy -and $unknownEndpointPolicy -ne $true) {
    throw "The attempt-recovery plan does not update the private Secrets Manager endpoint policy."
  }
  foreach ($name in @("errors", "dead_letter")) {
    $alarm = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_cloudwatch_metric_alarm.applications_attempt_recovery_$name[0]" })[0]
    if ([double]$alarm.change.after.threshold -ne 0 -or [string]$alarm.change.after.treat_missing_data -cne "notBreaching") {
      throw "An attempt-recovery alarm does not fail visibly on the first signal."
    }
  }
  return $changes
}
