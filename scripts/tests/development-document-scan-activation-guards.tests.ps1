Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-gateway-release-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-scan-activation-guards.ps1")

$passed = 0
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function Copy-Fixture { param([Parameter(Mandatory)][object]$Value); return $Value | ConvertTo-Json -Depth 50 | ConvertFrom-Json }

$steps = @("EnableMapping", "EnableRule", "DisableRule", "DisableMapping")
$mappingAddress = "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"
$reconcilerAddress = "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"
$ruleAddress = "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]"

# ---- transition table and targets
$expectedTransitions = @{
  EnableMapping = @($false, $false, $true, $false); EnableRule = @($true, $false, $true, $true)
  DisableRule = @($true, $true, $true, $false); DisableMapping = @($true, $false, $false, $false)
}
foreach ($step in $steps) {
  $t = Get-DocumentScanActivationTransition $step
  $e = $expectedTransitions[$step]
  if ($t.FromMapping -ne $e[0] -or $t.FromRule -ne $e[1] -or $t.ToMapping -ne $e[2] -or $t.ToRule -ne $e[3]) {
    throw "The $step transition changed."
  }
  $passed++
}
Assert-Rejected { Get-DocumentScanActivationTransition "EnableEverything" } "An unknown activation step was accepted."
# ADR-023 order: the rule can only be enabled after the mapping, and the mapping only disabled after the rule.
if ((Get-DocumentScanActivationTransition EnableRule).FromMapping -ne $true -or (Get-DocumentScanActivationTransition DisableMapping).FromRule -ne $false) {
  throw "The mapping-first activation order is not enforced by the transitions."
}
$passed++
$targetSets = @{
  EnableMapping = @($mappingAddress, $reconcilerAddress); DisableMapping = @($mappingAddress, $reconcilerAddress)
  EnableRule = @($ruleAddress); DisableRule = @($ruleAddress)
}
foreach ($step in $steps) {
  $actual = @(Get-DocumentScanActivationTargets $step | ForEach-Object { [string]$_.Address } | Sort-Object)
  if (($actual -join "|") -cne (($targetSets[$step] | Sort-Object) -join "|")) { throw "The $step targets changed." }
  $passed++
}

# ---- plan fixtures, in the exact shape Terraform reports for these three resources
function New-MappingChange {
  param([bool]$Before, [bool]$After)
  $base = [ordered]@{
    batch_size = 1; event_source_arn = "arn:aws:sqs:us-east-2:111122223333:generated-queue"
    function_name = "arn:aws:lambda:us-east-2:111122223333:function:generated-processor:development"
    function_response_types = @("ReportBatchItemFailures"); maximum_batching_window_in_seconds = 0
    scaling_config = @([ordered]@{ maximum_concurrency = 2 }); tags = [ordered]@{}
  }
  $beforeObject = [ordered]@{}; $afterObject = [ordered]@{}
  foreach ($key in $base.Keys) { $beforeObject[$key] = $base[$key]; $afterObject[$key] = $base[$key] }
  $beforeObject["enabled"] = $Before; $afterObject["enabled"] = $After
  return [pscustomobject]@{
    address = $mappingAddress; mode = "managed"; type = "aws_lambda_event_source_mapping"
    change = [pscustomobject]@{
      actions = @("update"); before = [pscustomobject]$beforeObject; after = [pscustomobject]$afterObject
      after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{ function_response_types = @($false); scaling_config = @([pscustomobject]@{}); tags = [pscustomobject]@{} }
      after_sensitive = [pscustomobject]@{ function_response_types = @($false); scaling_config = @([pscustomobject]@{}); tags = [pscustomobject]@{} }
    }
  }
}
function New-RuleChange {
  param([string]$Address, [string]$Before, [string]$After)
  $base = [ordered]@{ name = "generated-rule"; description = "generated"; schedule_expression = "rate(15 minutes)"; tags = [ordered]@{}; tags_all = [ordered]@{} }
  $beforeObject = [ordered]@{}; $afterObject = [ordered]@{}
  foreach ($key in $base.Keys) { $beforeObject[$key] = $base[$key]; $afterObject[$key] = $base[$key] }
  $beforeObject["state"] = $Before; $afterObject["state"] = $After
  return [pscustomobject]@{
    address = $Address; mode = "managed"; type = "aws_cloudwatch_event_rule"
    change = [pscustomobject]@{
      actions = @("update"); before = [pscustomobject]$beforeObject; after = [pscustomobject]$afterObject
      after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }
      after_sensitive = [pscustomobject]@{ tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{} }
    }
  }
}
function New-ActivationPlan {
  param([string]$Step)
  $on = $Step -in @("EnableMapping", "EnableRule")
  $from = if ($on) { "DISABLED" } else { "ENABLED" }; $to = if ($on) { "ENABLED" } else { "DISABLED" }
  $changes = @(
    if ($Step -in @("EnableMapping", "DisableMapping")) {
      New-MappingChange -Before (-not $on) -After $on
      New-RuleChange -Address $reconcilerAddress -Before $from -After $to
    } else {
      New-RuleChange -Address $ruleAddress -Before $from -After $to
    }
  )
  return [pscustomobject]@{
    terraform_version = "1.16.2"; complete = $true; errored = $false; applyable = $true; resource_drift = @()
    output_changes = [pscustomobject]@{ stable = [pscustomobject]@{ actions = @("no-op") } }
    resource_changes = @($changes)
  }
}

# ---- every step accepts exactly its own plan
foreach ($step in $steps) {
  $changes = @(Assert-ExactDocumentScanActivationPlan (New-ActivationPlan $step) $step)
  if ($changes.Count -ne $targetSets[$step].Count) { throw "The $step plan returned the wrong number of changes." }
  $passed++
}
# ...and refuses any other step's plan, so a reviewed plan cannot be replayed as a different step.
foreach ($planStep in $steps) {
  foreach ($asStep in $steps) {
    if ($planStep -ceq $asStep) { continue }
    Assert-Rejected { Assert-ExactDocumentScanActivationPlan (New-ActivationPlan $planStep) $asStep } "The $planStep plan was accepted as $asStep."
  }
}

# ---- adversarial plans, applied to every step
foreach ($step in $steps) {
  $good = New-ActivationPlan $step
  $first = 0
  $firstAddress = [string]$good.resource_changes[0].address

  $bad = Copy-Fixture $good; $bad.terraform_version = "1.9.8"
  Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted a non-approved Terraform version."
  foreach ($flag in @("errored", "complete", "applyable")) {
    $bad = Copy-Fixture $good; $bad.$flag = -not $bad.$flag
    Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted a plan with '$flag' flipped."
  }
  $bad = Copy-Fixture $good; $bad.output_changes.stable.actions = @("update")
  Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted an output change."
  $bad = Copy-Fixture $good; $bad.output_changes | Add-Member NoteProperty extra ([pscustomobject]@{ actions = @("create") })
  Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted a created output."

  # an extra resource change, including a Gateway or document Lambda change that a release would carry
  foreach ($extraAddress in @("module.platform.aws_lambda_function.gateway[0]", "module.platform.aws_lambda_alias.document_processor[0]", "module.platform.aws_iam_role_policy.gateway_lambda[0]")) {
    $bad = Copy-Fixture $good
    $extra = Copy-Fixture $bad.resource_changes[0]; $extra.address = $extraAddress
    $bad.resource_changes = @($bad.resource_changes) + @($extra)
    Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted an extra change to $extraAddress."
  }
  # a missing change
  $bad = Copy-Fixture $good; $bad.resource_changes = @($bad.resource_changes | Select-Object -Skip 1)
  Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted a plan missing a reviewed change."
  # no change at all
  $bad = Copy-Fixture $good; $bad.resource_changes = @()
  Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted an empty plan."

  foreach ($mutation in @("create", "delete", "replace", "no-op", "wrong type", "data mode", "sensitivity", "unknown field",
      "replace path", "unrelated attribute", "same value", "third value", "wrong value type", "removed field")) {
    $bad = Copy-Fixture $good
    $change = $bad.resource_changes[$first]
    $field = if ($change.type -ceq "aws_lambda_event_source_mapping") { "enabled" } else { "state" }
    switch ($mutation) {
      "create" { $change.change.actions = @("create") }
      "delete" { $change.change.actions = @("delete") }
      "replace" { $change.change.actions = @("delete", "create") }
      "no-op" { $change.change.actions = @("no-op") }
      "wrong type" { $change.type = "aws_lambda_function" }
      "data mode" { $change.mode = "data" }
      "sensitivity" { $change.change.after_sensitive | Add-Member NoteProperty tags_all $true -Force }
      "unknown field" { $change.change.after_unknown | Add-Member NoteProperty last_modified $true }
      "replace path" { $change.change | Add-Member NoteProperty replace_paths @(, @("tags")) -Force }
      "unrelated attribute" { $change.change.after | Add-Member NoteProperty description "changed" -Force; $change.change.after.tags | Add-Member NoteProperty leaked "x" }
      "same value" { $change.change.after.$field = $change.change.before.$field }
      "third value" { $change.change.after.$field = $(if ($field -ceq "enabled") { "true" } else { "PENDING" }) }
      "wrong value type" { $change.change.after.$field = $(if ($field -ceq "enabled") { "true" } else { $true }) }
      "removed field" { $change.change.after.PSObject.Properties.Remove($field) }
    }
    Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted the '$mutation' mutation."
  }
  # an attribute other than the one reviewed changed on the resource, on either side
  foreach ($side in @("before", "after")) {
    $bad = Copy-Fixture $good
    $target = $bad.resource_changes[$first].change.$side
    if ($null -ne $target.PSObject.Properties["batch_size"]) { $target.batch_size = 99 } else { $target.schedule_expression = "rate(1 minute)" }
    Assert-Rejected { Assert-ExactDocumentScanActivationPlan $bad $step } "$step accepted a changed unrelated $side attribute."
  }
}

# ---- variables
$baseVariables = [pscustomobject]@{
  document_processing_deployment_stage = [pscustomobject]@{ value = "complete-dark" }
  serverless_runtime_enabled = [pscustomobject]@{ value = $true }
  document_scan_mapping_enabled = [pscustomobject]@{ value = $false }
  document_scan_event_rule_enabled = [pscustomobject]@{ value = $false }
  document_parser_invocation_qualified_arn = [pscustomobject]@{ value = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-document-parser:7" }
  migration_image = [pscustomobject]@{ value = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('1' * 64)" }
  oidc_audience = [pscustomobject]@{ value = "ai-job-apply-api" }
}
function New-StateVariables {
  param([bool]$Mapping, [bool]$Rule)
  $v = Copy-Fixture $baseVariables
  $v.document_scan_mapping_enabled.value = $Mapping; $v.document_scan_event_rule_enabled.value = $Rule
  return $v
}
foreach ($step in $steps) {
  $t = Get-DocumentScanActivationTransition $step
  $fromVariables = New-StateVariables $t.FromMapping $t.FromRule
  $toVariables = New-StateVariables $t.ToMapping $t.ToRule
  $null = Assert-DocumentScanActivationVariables $fromVariables $toVariables $step; $passed++
  # string booleans, as Terraform's plan JSON records raw TF_VAR input, are exact booleans too
  $stringTo = Copy-Fixture $toVariables
  $stringTo.document_scan_mapping_enabled.value = ([string]$t.ToMapping).ToLowerInvariant()
  $stringTo.document_scan_event_rule_enabled.value = ([string]$t.ToRule).ToLowerInvariant()
  $stringFrom = Copy-Fixture $fromVariables
  $stringFrom.document_scan_mapping_enabled.value = ([string]$t.FromMapping).ToLowerInvariant()
  $stringFrom.document_scan_event_rule_enabled.value = ([string]$t.FromRule).ToLowerInvariant()
  $null = Assert-DocumentScanActivationVariables $stringFrom $stringTo $step; $passed++

  # the retained baseline must be exactly where the step starts
  foreach ($wrong in @(@($true, $true), @($false, $true), @($true, $false), @($false, $false))) {
    if ($wrong[0] -eq $t.FromMapping -and $wrong[1] -eq $t.FromRule) { continue }
    Assert-Rejected { Assert-DocumentScanActivationVariables (New-StateVariables $wrong[0] $wrong[1]) $toVariables $step } "$step accepted a baseline starting from ($($wrong -join ','))."
  }
  # the plan must land on exactly the reviewed flags
  foreach ($wrong in @(@($true, $true), @($false, $true), @($true, $false), @($false, $false))) {
    if ($wrong[0] -eq $t.ToMapping -and $wrong[1] -eq $t.ToRule) { continue }
    Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables (New-StateVariables $wrong[0] $wrong[1]) $step } "$step accepted a plan ending at ($($wrong -join ','))."
  }
  foreach ($name in @("document_scan_mapping_enabled", "document_scan_event_rule_enabled")) {
    foreach ($bad in @("True", "true ", "1", 1, $null)) {
      $malformed = Copy-Fixture $toVariables; $malformed.$name.value = $bad
      Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables $malformed $step } "$step accepted the noncanonical boolean '$bad' for $name."
    }
  }
  foreach ($name in @("migration_image", "oidc_audience", "document_parser_invocation_qualified_arn")) {
    $changed = Copy-Fixture $toVariables; $changed.$name.value = "changed"
    Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables $changed $step } "$step accepted a change to $name."
  }
  $changed = Copy-Fixture $toVariables; $changed | Add-Member NoteProperty unexpected_variable ([pscustomobject]@{ value = "x" })
  Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables $changed $step } "$step accepted an added variable."
  $changed = Copy-Fixture $toVariables; $changed.PSObject.Properties.Remove("oidc_audience")
  Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables $changed $step } "$step accepted a removed variable."
  foreach ($stage in @("parser-dark", "kms-prerequisite", "")) {
    $badFrom = Copy-Fixture $fromVariables; $badFrom.document_processing_deployment_stage.value = $stage
    $badTo = Copy-Fixture $toVariables; $badTo.document_processing_deployment_stage.value = $stage
    Assert-Rejected { Assert-DocumentScanActivationVariables $badFrom $badTo $step } "$step accepted the '$stage' stage."
  }
  $badFrom = Copy-Fixture $fromVariables; $badFrom.serverless_runtime_enabled.value = $false
  $badTo = Copy-Fixture $toVariables; $badTo.serverless_runtime_enabled.value = $false
  Assert-Rejected { Assert-DocumentScanActivationVariables $badFrom $badTo $step } "$step accepted an inactive serverless runtime."
  $stageOnly = Copy-Fixture $toVariables; $stageOnly.document_processing_deployment_stage.value = "parser-dark"
  Assert-Rejected { Assert-DocumentScanActivationVariables $fromVariables $stageOnly $step } "$step accepted a stage change."
}
Assert-Rejected { Assert-DocumentScanActivationVariables $baseVariables $baseVariables "EnableEverything" } "An unknown step was accepted for variables."

Write-Host "Document scan activation guard tests passed: $passed"
