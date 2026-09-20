Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# D3-023: enabling or disabling the document scan triggers in development, one reviewed step at a time.
# ADR-023 fixes the order: the processor mapping and timeout reconciler first, and only after they pass a
# later reviewed plan enables the exact GuardDuty rule. Everything here is exact: the two variables, the
# three resources they drive, the one attribute each resource changes, and the values it changes between.
# Any other variable, resource, attribute, or output change is refused. Requires the Gateway release guards
# (Get-GatewayPlanVariableValue, canonical JSON helpers) and the document-dark guards (ConvertTo-ExactBoolean).

function Get-DocumentScanActivationTransition {
  param([Parameter(Mandatory)][ValidateSet("EnableMapping", "EnableRule", "DisableRule", "DisableMapping")][string]$Step)
  switch ($Step) {
    "EnableMapping" { return @{ FromMapping = $false; FromRule = $false; ToMapping = $true; ToRule = $false } }
    "EnableRule" { return @{ FromMapping = $true; FromRule = $false; ToMapping = $true; ToRule = $true } }
    "DisableRule" { return @{ FromMapping = $true; FromRule = $true; ToMapping = $true; ToRule = $false } }
    "DisableMapping" { return @{ FromMapping = $true; FromRule = $false; ToMapping = $false; ToRule = $false } }
  }
}

$script:DocumentScanMappingAddress = "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]"
$script:DocumentReconcilerAddress = "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"
$script:DocumentScanRuleAddress = "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]"

# The exact resources a step changes: address, Terraform type, the single attribute, and its before/after value.
function Get-DocumentScanActivationTargets {
  param([Parameter(Mandatory)][ValidateSet("EnableMapping", "EnableRule", "DisableRule", "DisableMapping")][string]$Step)
  $on = $Step -in @("EnableMapping", "EnableRule")
  switch ($Step) {
    { $_ -in @("EnableMapping", "DisableMapping") } {
      return @(
        @{ Address = $script:DocumentScanMappingAddress; Type = "aws_lambda_event_source_mapping"; Field = "enabled"
          Before = (-not $on); After = $on }
        @{ Address = $script:DocumentReconcilerAddress; Type = "aws_cloudwatch_event_rule"; Field = "state"
          Before = $(if ($on) { "DISABLED" } else { "ENABLED" }); After = $(if ($on) { "ENABLED" } else { "DISABLED" }) }
      )
    }
    default {
      return @(
        @{ Address = $script:DocumentScanRuleAddress; Type = "aws_cloudwatch_event_rule"; Field = "state"
          Before = $(if ($on) { "DISABLED" } else { "ENABLED" }); After = $(if ($on) { "ENABLED" } else { "DISABLED" }) }
      )
    }
  }
}

# The retained baseline must be exactly where this step starts, the planned variables must differ from it in
# exactly the two trigger flags, and nothing else about the deployed document boundary may move.
function Assert-DocumentScanActivationVariables {
  param(
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$PlanVariables,
    [Parameter(Mandatory)][ValidateSet("EnableMapping", "EnableRule", "DisableRule", "DisableMapping")][string]$Step
  )
  $transition = Get-DocumentScanActivationTransition $Step
  $flags = @("document_scan_mapping_enabled", "document_scan_event_rule_enabled")
  $baselineMapping = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $BaselineVariables $flags[0]) $flags[0]
  $baselineRule = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $BaselineVariables $flags[1]) $flags[1]
  if ($baselineMapping -ne $transition.FromMapping -or $baselineRule -ne $transition.FromRule) {
    throw "The retained baseline is not in the state this document scan activation step starts from."
  }
  $planMapping = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables $flags[0]) $flags[0]
  $planRule = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables $flags[1]) $flags[1]
  if ($planMapping -ne $transition.ToMapping -or $planRule -ne $transition.ToRule) {
    throw "The planned document scan trigger flags are not exactly the reviewed step."
  }
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "|") -cne ($planNames -join "|")) {
    throw "The document scan activation plan changed the Terraform variable inventory."
  }
  foreach ($name in $baselineNames) {
    if ($name -in $flags) { continue }
    if ((ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $BaselineVariables $name)) -cne
        (ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $PlanVariables $name))) {
      throw "The document scan activation changed non-activation input '$name'."
    }
  }
  $stage = [string](Get-GatewayPlanVariableValue $PlanVariables "document_processing_deployment_stage")
  $runtime = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables "serverless_runtime_enabled") "serverless_runtime_enabled"
  if ($stage -cne "complete-dark" -or -not $runtime) {
    throw "Document scan activation requires the deployed complete processing boundary and the active serverless runtime."
  }
  return $true
}

# Unknown-after-apply attributes the provider is allowed to recompute for each resource type.
$script:DocumentScanAllowedUnknown = @{
  aws_lambda_event_source_mapping = @()
  aws_cloudwatch_event_rule = @()
}

function Assert-ExactDocumentScanActivationPlan {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][ValidateSet("EnableMapping", "EnableRule", "DisableRule", "DisableMapping")][string]$Step
  )
  if ([string]$Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $Plan.errored -or -not $Plan.complete -or
      -not $Plan.applyable) {
    throw "The document scan activation must be a successful current-version Terraform plan."
  }
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
  $outputChanges = Get-GatewayOptionalProperty $Plan "output_changes"
  $meaningfulOutputs = @(
    if ($null -ne $outputChanges) {
      $outputChanges.PSObject.Properties | Where-Object {
        $actions = @($_.Value.actions); -not ($actions.Count -eq 1 -and $actions[0] -ceq "no-op")
      }
    }
  )
  if ($meaningfulOutputs.Count -ne 0) { throw "The document scan activation contains a meaningful output change." }
  $targets = @(Get-DocumentScanActivationTargets $Step)
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  $actual = @($changes | ForEach-Object { [string]$_.address } | Sort-Object)
  $expected = @($targets | ForEach-Object { [string]$_.Address } | Sort-Object)
  if (($actual -join "|") -cne ($expected -join "|")) {
    throw "The document scan activation plan is not limited to the reviewed resources."
  }
  foreach ($target in $targets) {
    $change = @($changes | Where-Object { [string]$_.address -ceq [string]$target.Address })[0]
    if ((@($change.change.actions) -join ",") -cne "update" -or [string]$change.mode -cne "managed" -or
        [string]$change.type -cne [string]$target.Type) {
      throw "The document scan activation may only update the reviewed resources in place."
    }
    Assert-NoTerraformReplacementPaths $change.change
    if ((ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $change.change "before_sensitive")) -cne
        (ConvertTo-GatewayCanonicalJson (Get-GatewayOptionalProperty $change.change "after_sensitive"))) {
      throw "The document scan activation changed sensitivity."
    }
    $before = $change.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $after = $change.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $field = [string]$target.Field
    $beforeValue = $before.PSObject.Properties[$field]
    $afterValue = $after.PSObject.Properties[$field]
    if ($null -eq $beforeValue -or $null -eq $afterValue -or
        $beforeValue.Value -cne $target.Before -or $afterValue.Value -cne $target.After -or
        $beforeValue.Value.GetType() -ne $target.Before.GetType() -or $afterValue.Value.GetType() -ne $target.After.GetType()) {
      throw "The document scan activation did not change '$field' between exactly the reviewed values."
    }
    $unknown = Get-GatewayOptionalProperty $change.change "after_unknown"
    $unknownPaths = @(if ($null -ne $unknown) { Get-GatewayUnknownTrueLeafPaths -Value $unknown | Sort-Object })
    $allowedUnknown = @($script:DocumentScanAllowedUnknown[[string]$target.Type])
    # Computed attributes are compared as unknown, never as a value, so drop them from both sides.
    foreach ($path in $unknownPaths) {
      if ($path -notin $allowedUnknown) { throw "The document scan activation contains an unknown nonapproved field '$path'." }
      $before.PSObject.Properties.Remove($path); $after.PSObject.Properties.Remove($path)
    }
    $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field)
    if ((ConvertTo-GatewayCanonicalJson $before) -cne (ConvertTo-GatewayCanonicalJson $after)) {
      throw "The document scan activation changed a nonapproved attribute of '$($target.Address)'."
    }
  }
  return $changes
}
