Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# D3-027 (ADR-034): refresh the code of the profile-readiness activity Lambda in development, on its own.
#
# That artifact also serves the terminal Lambda, and the module binds the activity version into the durable workflow
# (its IAM policy, its CloudFormation-published version and alias, the outbox starter, and the terminal event rule), so an
# activity-only release changes exactly the resources named below and nothing else. The owner approved this exact set on
# 2026-09-21. Everything is derived from the four activity artifact variables: the baseline is a zero-drift plan at the same
# source, so any difference in the plan is caused by those variables. Requires the Gateway release guards
# (Get-GatewayPlanVariableValue, canonical JSON helpers, Assert-AcceptedGatewayProviderDrift) and the document-dark guards.

$script:CandidateRightsActivityArtifactName = "profile-readiness-activity-lambda"
$script:CandidateRightsActivityVariables = @(
  "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version",
  "profile_readiness_activity_artifact_sha256",
  "profile_readiness_activity_artifact_base64sha256"
)
$script:CandidateRightsActivityOutputs = @("profile_readiness_durable_alias_arn", "profile_readiness_durable_version_arn")

# Each entry: the exact action, the attribute paths that may be unknown after apply, the paths that may differ, and any
# sensitive leaves that already exist. A trailing * allows a whole subtree.
$script:CandidateRightsActivityChangeSet = [ordered]@{
  "module.platform.aws_lambda_function.profile_readiness_activity[0]" = @{
    Type = "aws_lambda_function"; Actions = "update"; Sensitive = @("environment[0].variables.OIDC_ISSUER")
    Unknown = @("last_modified", "qualified_arn", "qualified_invoke_arn", "version")
    Differs = @("environment[0].variables.RELEASE_SHA", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")
  }
  "module.platform.aws_lambda_alias.profile_readiness_activity[0]" = @{
    Type = "aws_lambda_alias"; Actions = "update"; Sensitive = @(); Unknown = @("function_version"); Differs = @("function_version")
  }
  "module.platform.aws_lambda_function.profile_readiness_terminal[0]" = @{
    Type = "aws_lambda_function"; Actions = "update"; Sensitive = @()
    Unknown = @("environment[0].variables", "last_modified", "qualified_arn", "qualified_invoke_arn", "version")
    Differs = @("environment[0]*", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key", "s3_object_version", "source_code_hash", "version")
  }
  "module.platform.aws_lambda_alias.profile_readiness_terminal[0]" = @{
    Type = "aws_lambda_alias"; Actions = "update"; Sensitive = @(); Unknown = @("function_version"); Differs = @("function_version")
  }
  "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]" = @{
    Type = "aws_cloudformation_stack"; Actions = "update"; Sensitive = @()
    Unknown = @("outputs", "template_body"); Differs = @("outputs*", "template_body")
  }
  "module.platform.aws_iam_role_policy.profile_readiness_durable[0]" = @{
    Type = "aws_iam_role_policy"; Actions = "update"; Sensitive = @(); Unknown = @("policy"); Differs = @("policy")
  }
  "module.platform.aws_lambda_function.outbox_starter[0]" = @{
    Type = "aws_lambda_function"; Actions = "update"; Sensitive = @()
    Unknown = @("environment[0].variables", "qualified_arn", "qualified_invoke_arn", "version")
    Differs = @("environment[0]*", "qualified_arn", "qualified_invoke_arn", "version")
  }
  "module.platform.aws_lambda_alias.outbox_starter[0]" = @{
    Type = "aws_lambda_alias"; Actions = "update"; Sensitive = @(); Unknown = @("function_version"); Differs = @("function_version")
  }
  "module.platform.aws_iam_role_policy.outbox_starter[0]" = @{
    Type = "aws_iam_role_policy"; Actions = "update"; Sensitive = @(); Unknown = @("policy"); Differs = @("policy")
  }
  "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]" = @{
    Type = "aws_cloudwatch_event_rule"; Actions = "update"; Sensitive = @(); Unknown = @("event_pattern"); Differs = @("event_pattern")
  }
  "module.platform.aws_vpc_endpoint.lambda[0]" = @{
    Type = "aws_vpc_endpoint"; Actions = "update"; Sensitive = @(); Unknown = @("policy"); Differs = @("policy")
  }
  "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]" = @{
    Type = "time_sleep"; Actions = "create,delete"; Sensitive = @(); ReplacePaths = @("triggers")
    Unknown = @("id", "triggers.policy_sha256"); Differs = @("id", "triggers.policy_sha256")
  }
}

# The activity archive of a verified core-workflow publication receipt, bound to the exact release source.
function Get-CandidateRightsActivityArtifact {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][string]$SourceSha,
    [Parameter(Mandatory)][string]$BoundarySha256
  )
  $expectedKeys = @("artifacts", "boundarySha256", "completedAt", "createdAt", "environment", "kind", "phase", "region", "schemaVersion", "sourceSha") | Sort-Object
  $actualKeys = @($Receipt.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($actualKeys -join "|") -cne ($expectedKeys -join "|") -or [int]$Receipt.schemaVersion -ne 1 -or
      [string]$Receipt.kind -cne "development-core-workflow-lambda-publication" -or [string]$Receipt.environment -cne "development" -or
      [string]$Receipt.region -cne "us-east-2" -or [string]$Receipt.phase -cne "verified" -or
      [string]$Receipt.sourceSha -cne $SourceSha -or [string]$Receipt.boundarySha256 -cne $BoundarySha256) {
    throw "The workflow publication receipt does not match the exact release source and boundary."
  }
  $entries = @($Receipt.artifacts | Where-Object { [string]$_.artifactName -ceq $script:CandidateRightsActivityArtifactName })
  $suffixes = @($entries | ForEach-Object { [string]$_.suffix } | Sort-Object)
  if ($entries.Count -ne 4 -or ($suffixes -join ",") -cne "cdx.json,manifest.json,sha256,zip") {
    throw "The workflow publication receipt must contain exactly one activity archive, manifest, SBOM, and checksum."
  }
  $zip = @($entries | Where-Object { [string]$_.suffix -ceq "zip" })[0]
  $artifactSha = [string]$zip.artifactSha256
  if ($artifactSha -cnotmatch '^[a-f0-9]{64}$' -or [string]$zip.objectSha256 -cne $artifactSha -or
      [string]$zip.objectBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or [string]::IsNullOrWhiteSpace([string]$zip.versionId) -or
      [long]$zip.contentLength -lt 1 -or
      [string]$zip.key -cne "lambda/workflows/$SourceSha/$artifactSha/$($script:CandidateRightsActivityArtifactName).zip") {
    throw "The activity archive entry is not the exact immutable object for this source."
  }
  return [pscustomobject]@{
    key = [string]$zip.key; versionId = [string]$zip.versionId; artifactSha256 = $artifactSha
    objectBase64Sha256 = [string]$zip.objectBase64Sha256; contentLength = [long]$zip.contentLength
  }
}

# Only the four activity artifact variables may change, and they must equal the verified archive.
function Assert-CandidateRightsActivityVariables {
  param(
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$PlanVariables,
    [Parameter(Mandatory)][object]$Artifact,
    [switch]$EnableRestrictedAnswerExport
  )
  $expected = @{
    profile_readiness_activity_artifact_s3_key = [string]$Artifact.key
    profile_readiness_activity_artifact_s3_object_version = [string]$Artifact.versionId
    profile_readiness_activity_artifact_sha256 = [string]$Artifact.artifactSha256
    profile_readiness_activity_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
  }
  if ($EnableRestrictedAnswerExport) {
    foreach ($flag in @("restricted_answer_vault_enabled", "candidate_rights_enabled")) {
      if (-not (ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $BaselineVariables $flag) $flag)) {
        throw "Restricted-answer export requires the already activated vault and candidate rights."
      }
    }
    if ((ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $BaselineVariables "restricted_answer_export_enabled") "restricted_answer_export_enabled") -or
        -not (ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables "restricted_answer_export_enabled") "restricted_answer_export_enabled")) {
      throw "Restricted-answer export activation must change exactly false to true."
    }
  }
  foreach ($name in $script:CandidateRightsActivityVariables) {
    if ([string](Get-GatewayPlanVariableValue $PlanVariables $name) -cne $expected[$name]) {
      throw "The planned activity variable '$name' is not the verified archive value."
    }
  }
  if ([string](Get-GatewayPlanVariableValue $BaselineVariables "profile_readiness_activity_artifact_sha256") -ceq [string]$Artifact.artifactSha256) {
    throw "The activity archive is already the released one."
  }
  foreach ($flag in @("deploy_profile_readiness_durable", "candidate_rights_enabled")) {
    if (-not (ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables $flag) $flag)) {
      throw "The activity refresh requires '$flag' to be enabled."
    }
  }
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "|") -cne ($planNames -join "|")) { throw "The activity refresh changed the Terraform variable inventory." }
  foreach ($name in $baselineNames) {
    if ($name -in $script:CandidateRightsActivityVariables) { continue }
    if ($EnableRestrictedAnswerExport -and $name -ceq "restricted_answer_export_enabled") { continue }
    if ((ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $BaselineVariables $name)) -cne
        (ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $PlanVariables $name))) {
      throw "The activity refresh changed unrelated input '$name'."
    }
  }
  return $true
}

function ConvertTo-CandidateRightsActivityPathMap {
  param([AllowNull()][object]$Value, [AllowEmptyString()][string]$Path = "", [Parameter(Mandatory)][hashtable]$Map)
  if ($null -eq $Value) { $Map[$Path] = "null"; return }
  if ($Value -is [array]) {
    if ($Value.Count -eq 0) { $Map[$Path] = "[]"; return }
    for ($index = 0; $index -lt $Value.Count; $index++) {
      ConvertTo-CandidateRightsActivityPathMap $Value[$index] "$Path[$index]" $Map
    }
    return
  }
  if ($Value -is [pscustomobject]) {
    $properties = @($Value.PSObject.Properties)
    if ($properties.Count -eq 0) { $Map[$Path] = "{}"; return }
    foreach ($property in $properties) {
      ConvertTo-CandidateRightsActivityPathMap $property.Value $(if ($Path -ceq "") { [string]$property.Name } else { "$Path.$($property.Name)" }) $Map
    }
    return
  }
  $Map[$Path] = [string]$Value
}

function Test-CandidateRightsActivityPathAllowed {
  param([Parameter(Mandatory)][string]$Path, [AllowEmptyCollection()][string[]]$Allowed = @())
  foreach ($entry in $Allowed) {
    if ($entry.EndsWith("*") -and $Path.StartsWith($entry.Substring(0, $entry.Length - 1), [StringComparison]::Ordinal)) { return $true }
    if ($Path -ceq $entry) { return $true }
  }
  return $false
}

# Exactly the reviewed set of resource and output changes, each limited to its reviewed attributes, with the two Lambda
# code updates bound to the verified archive.
function Assert-ExactCandidateRightsActivityPlan {
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][object]$Artifact, [switch]$EnableRestrictedAnswerExport)
  if ([string]$Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $Plan.errored -or -not $Plan.complete -or
      -not $Plan.applyable) {
    throw "The activity refresh must be a successful current-version Terraform plan."
  }
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
  $originalPlan = $Plan
  if ($EnableRestrictedAnswerExport) {
    $Plan = ConvertTo-RestrictedAnswerExportActivityPlan $Plan
  }
  $outputChanges = Get-GatewayOptionalProperty $Plan "output_changes"
  $changedOutputs = @(
    if ($null -ne $outputChanges) {
      $outputChanges.PSObject.Properties | Where-Object {
        $actions = @($_.Value.actions); -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
      }
    }
  )
  if ((@($changedOutputs | ForEach-Object Name | Sort-Object) -join "|") -cne (@($script:CandidateRightsActivityOutputs | Sort-Object) -join "|") -or
      @($changedOutputs | Where-Object { (@($_.Value.actions) -join ",") -cne "update" }).Count -ne 0) {
    throw "The activity refresh must change exactly the durable alias and version outputs."
  }
  $changes = @(Get-GatewayMeaningfulChanges @($Plan.resource_changes))
  $addresses = @($changes | ForEach-Object { [string]$_.address } | Sort-Object)
  $reviewed = @($script:CandidateRightsActivityChangeSet.Keys | Sort-Object)
  if (($addresses -join "|") -cne ($reviewed -join "|")) {
    throw "The activity refresh plan is not exactly the reviewed set of resources."
  }
  foreach ($change in $changes) {
    $rule = $script:CandidateRightsActivityChangeSet[[string]$change.address]
    $actions = @($change.change.actions | Sort-Object)
    if (($actions -join ",") -cne $rule.Actions -or [string]$change.mode -cne "managed" -or [string]$change.type -cne $rule.Type) {
      throw "The activity refresh has an unexpected action or type for '$($change.address)'."
    }
    if ($rule.ContainsKey("ReplacePaths")) {
      $paths = @(@(Get-GatewayOptionalProperty $change.change "replace_paths") | ForEach-Object { @($_) })
      if (($paths -join "|") -cne ($rule.ReplacePaths -join "|")) { throw "The timer replacement is not limited to its triggers." }
    } else {
      Assert-NoTerraformReplacementPaths $change.change
    }
    $beforeMap = @{}; $afterMap = @{}
    ConvertTo-CandidateRightsActivityPathMap (Get-GatewayOptionalProperty $change.change "before") "" $beforeMap
    ConvertTo-CandidateRightsActivityPathMap (Get-GatewayOptionalProperty $change.change "after") "" $afterMap
    $differing = @(($beforeMap.Keys + $afterMap.Keys) | Sort-Object -Unique | Where-Object {
        -not $beforeMap.ContainsKey($_) -or -not $afterMap.ContainsKey($_) -or $beforeMap[$_] -cne $afterMap[$_]
      } | Where-Object { $_ -cne "" })
    foreach ($path in $differing) {
      if (-not (Test-CandidateRightsActivityPathAllowed $path $rule.Differs)) {
        throw "The activity refresh changed a nonapproved attribute '$path' of '$($change.address)'."
      }
    }
    $unknown = Get-GatewayOptionalProperty $change.change "after_unknown"
    foreach ($path in @(if ($null -ne $unknown) { Get-GatewayUnknownTrueLeafPaths -Value $unknown })) {
      if (-not (Test-CandidateRightsActivityPathAllowed $path $rule.Unknown)) {
        throw "The activity refresh has an unexpected unknown value '$path' in '$($change.address)'."
      }
    }
    foreach ($side in @("before_sensitive", "after_sensitive")) {
      $tree = Get-GatewayOptionalProperty $change.change $side
      foreach ($path in @(if ($null -ne $tree) { Get-GatewayUnknownTrueLeafPaths -Value $tree })) {
        if (-not (Test-CandidateRightsActivityPathAllowed $path $rule.Sensitive)) {
          throw "The activity refresh involves a sensitive value '$path' in '$($change.address)'."
        }
      }
    }
  }
  foreach ($name in @("activity", "terminal")) {
    $function = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.profile_readiness_$name[0]" })[0]
    $after = $function.change.after
    if ([string]$after.s3_key -cne [string]$Artifact.key -or [string]$after.s3_object_version -cne [string]$Artifact.versionId -or
        [string]$after.source_code_hash -cne [string]$Artifact.objectBase64Sha256) {
      throw "The $name Lambda update is not bound to the exact verified archive."
    }
  }
  $activity = @($changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.profile_readiness_activity[0]" })[0]
  if ([string]$activity.change.after.environment[0].variables.RELEASE_SHA -cne [string]$Artifact.artifactSha256) {
    throw "The activity Lambda release identity is not the verified archive."
  }
  if ($EnableRestrictedAnswerExport) { return @(Get-GatewayMeaningfulChanges @($originalPlan.resource_changes)) }
  return $changes
}

# Validate the exact extra permission and two environment bindings, then reuse the unchanged
# code-refresh guard. This mode never broadens the ordinary activity refresh allowlist.
function ConvertTo-RestrictedAnswerExportActivityPlan {
  param([Parameter(Mandatory)][object]$Plan)
  if (-not (ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $Plan.variables "restricted_answer_export_enabled") "restricted_answer_export_enabled")) {
    throw "The saved plan does not enable restricted-answer export."
  }
  $planned = Get-TerraformStateResourceMap $Plan.planned_values.root_module
  $key = $planned["module.platform.aws_kms_key.restricted_answer_vault[0]"]
  $keyArn = if ($null -eq $key) { "" } else { [string]$key.arn }
  if ($keyArn -cnotmatch '^arn:aws:kms:us-east-2:[0-9]{12}:key/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw "Restricted-answer export requires the exact source-evaluated dedicated key."
  }
  $address = "module.platform.aws_iam_role_policy.candidate_rights_activity[0]"
  $grants = @($Plan.resource_changes | Where-Object { [string]$_.address -ceq $address })
  if ($grants.Count -ne 1) { throw "Restricted-answer export requires one exact rights policy update." }
  $grant = $grants[0]
  if ([string]$grant.mode -cne "managed" -or [string]$grant.type -cne "aws_iam_role_policy" -or
      (@($grant.change.actions) -join ",") -cne "update") { throw "Unexpected rights policy action or type." }
  Assert-NoTerraformReplacementPaths $grant.change
  foreach ($tree in @("after_unknown", "before_sensitive", "after_sensitive")) {
    if (@(Get-GatewayUnknownTrueLeafPaths -Value $grant.change.$tree).Count -ne 0) { throw "The rights grant must be completely known and nonsensitive." }
  }
  $before = $grant.change.before; $after = $grant.change.after
  if ([string]$after.name -cne "candidate-rights-activity-runtime" -or
      [string]$after.role -cne [string]$planned["module.platform.aws_iam_role.profile_readiness_activity[0]"].id -or
      [string]$after.policy -cne [string]$planned[$address].policy) { throw "The rights grant is not bound to the source-evaluated activity policy and role." }
  $beforeCopy = $before | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $afterCopy = $after | ConvertTo-Json -Depth 60 | ConvertFrom-Json
  $beforeCopy.PSObject.Properties.Remove("policy"); $afterCopy.PSObject.Properties.Remove("policy")
  if ((ConvertTo-GatewayCanonicalJson $beforeCopy) -cne (ConvertTo-GatewayCanonicalJson $afterCopy)) { throw "The rights grant changed unrelated policy attributes." }
  $beforePolicy = [string]$before.policy | ConvertFrom-Json
  $afterPolicy = [string]$after.policy | ConvertFrom-Json
  $sid = "DecryptRestrictedAnswersForCandidateExport"
  $added = @($afterPolicy.Statement | Where-Object { [string]$_.Sid -ceq $sid })
  if (@($beforePolicy.Statement | Where-Object { [string]$_.Sid -ceq $sid }).Count -ne 0 -or $added.Count -ne 1) { throw "The rights grant is not one new export statement." }
  $expected = [pscustomobject]@{
    Sid = $sid; Effect = "Allow"; Action = "kms:Decrypt"; Resource = $keyArn
    Condition = [pscustomobject]@{ StringEquals = [pscustomobject]@{ "kms:EncryptionContext:purpose" = "restricted-answer-vault-v1" } }
  }
  if ((ConvertTo-GatewayCanonicalJson $added[0]) -cne (ConvertTo-GatewayCanonicalJson $expected)) { throw "Restricted-answer export widened or changed its decrypt-only statement." }
  $afterPolicy.Statement = @($afterPolicy.Statement | Where-Object { [string]$_.Sid -cne $sid })
  if ((ConvertTo-GatewayCanonicalJson $beforePolicy) -cne (ConvertTo-GatewayCanonicalJson $afterPolicy)) { throw "Restricted-answer export changed existing IAM statements." }
  $copy = $Plan | ConvertTo-Json -Depth 80 | ConvertFrom-Json
  $copy.resource_changes = @($copy.resource_changes | Where-Object { [string]$_.address -cne $address })
  $activity = @($copy.resource_changes | Where-Object { [string]$_.address -ceq "module.platform.aws_lambda_function.profile_readiness_activity[0]" })
  if ($activity.Count -ne 1) { throw "Missing exact activity update." }
  $beforeEnv = $activity[0].change.before.environment[0].variables
  $afterEnv = $activity[0].change.after.environment[0].variables
  if ($null -ne $beforeEnv.PSObject.Properties["RESTRICTED_ANSWER_EXPORT_ENABLED"] -or
      $null -ne $beforeEnv.PSObject.Properties["RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN"] -or
      [string]$afterEnv.RESTRICTED_ANSWER_EXPORT_ENABLED -cne "enabled" -or
      [string]$afterEnv.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN -cne $keyArn) { throw "The activity export environment must gain exactly its enabled flag and dedicated key." }
  $afterEnv.PSObject.Properties.Remove("RESTRICTED_ANSWER_EXPORT_ENABLED")
  $afterEnv.PSObject.Properties.Remove("RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN")
  return $copy
}
