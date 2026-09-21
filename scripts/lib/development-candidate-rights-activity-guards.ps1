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
    [Parameter(Mandatory)][object]$Artifact
  )
  $expected = @{
    profile_readiness_activity_artifact_s3_key = [string]$Artifact.key
    profile_readiness_activity_artifact_s3_object_version = [string]$Artifact.versionId
    profile_readiness_activity_artifact_sha256 = [string]$Artifact.artifactSha256
    profile_readiness_activity_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
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
  param([Parameter(Mandatory)][object]$Plan, [Parameter(Mandatory)][object]$Artifact)
  if ([string]$Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $Plan.errored -or -not $Plan.complete -or
      -not $Plan.applyable) {
    throw "The activity refresh must be a successful current-version Terraform plan."
  }
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
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
  return $changes
}
