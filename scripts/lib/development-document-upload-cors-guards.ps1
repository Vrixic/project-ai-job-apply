Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# D3-024: allow one more exact browser origin to use the candidate-document upload grants in development.
# The bucket CORS list (`candidate_document_cors_allowed_origins`) only allowed http://localhost:3000, so the
# hosted app's browser could not post a file to its short-lived, exact upload grant. This step may only append
# ONE exact HTTPS origin to that list: the one variable, the one CORS configuration resource, updated in place with
# only that origin added, and nothing else. Requires the Gateway release guards (Get-GatewayPlanVariableValue,
# canonical JSON helpers, Assert-AcceptedGatewayProviderDrift) and the document-dark guards.

$script:DocumentUploadCorsAddress = "module.platform.aws_s3_bucket_cors_configuration.candidate_documents[0]"
$script:DocumentUploadCorsVariable = "candidate_document_cors_allowed_origins"

# An exact lowercase HTTPS origin with a dotted host: no wildcard, path, query, userinfo, or trailing slash.
function Assert-DocumentUploadCorsOrigin {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Origin)
  if ($Origin -cnotmatch '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$') {
    throw "The upload CORS origin must be one exact lowercase HTTPS origin without a wildcard, path, query, or credentials."
  }
  return $true
}

# The current list, from a plan's variables: an array of strings, each a valid existing origin (the module's own rule).
function Get-DocumentUploadCorsOrigins {
  param([Parameter(Mandatory)][object]$Variables)
  # Read the property directly: returning a one-element array from a function would unroll it to a bare string.
  $property = $Variables.PSObject.Properties[$script:DocumentUploadCorsVariable]
  if ($null -eq $property -or $null -eq $property.Value.PSObject.Properties["value"]) {
    throw "The Terraform plan is missing the upload CORS origin list."
  }
  $value = $property.Value.value
  # A plan may keep the raw JSON text of the list input; a bare string is never a valid list.
  if ($value -is [string]) {
    if (-not $value.TrimStart().StartsWith("[")) { throw "The retained upload CORS origin list is not a list." }
    $value = $value | ConvertFrom-Json
  }
  $origins = @($value)
  foreach ($origin in $origins) {
    if ($origin -isnot [string] -or
        $origin -cnotmatch '^(https://[^/\s]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$') {
      throw "The retained upload CORS origin list contains a value outside the module's origin rule."
    }
  }
  if (@($origins | Sort-Object -Unique).Count -ne $origins.Count) { throw "The upload CORS origin list has a duplicate." }
  return $origins
}

# The planned list must be exactly the retained list with the one reviewed origin appended, and no other variable
# may change.
function Assert-DocumentUploadCorsVariables {
  param(
    [Parameter(Mandatory)][object]$BaselineVariables,
    [Parameter(Mandatory)][object]$PlanVariables,
    [Parameter(Mandatory)][string]$Origin
  )
  $null = Assert-DocumentUploadCorsOrigin $Origin
  $baseline = @(Get-DocumentUploadCorsOrigins $BaselineVariables)
  $planned = @(Get-DocumentUploadCorsOrigins $PlanVariables)
  if ($baseline -ccontains $Origin) { throw "The upload CORS origin is already allowed." }
  if (($planned -join "|") -cne ((@($baseline) + @($Origin)) -join "|")) {
    throw "The planned upload CORS list is not exactly the retained list plus the reviewed origin."
  }
  $intake = ConvertTo-ExactBoolean (Get-GatewayPlanVariableValue $PlanVariables "deploy_document_intake") "deploy_document_intake"
  if (-not $intake) { throw "Upload CORS requires the deployed document intake." }
  $baselineNames = @($BaselineVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  $planNames = @($PlanVariables.PSObject.Properties | ForEach-Object Name | Sort-Object)
  if (($baselineNames -join "|") -cne ($planNames -join "|")) { throw "The upload CORS plan changed the Terraform variable inventory." }
  foreach ($name in $baselineNames) {
    if ($name -ceq $script:DocumentUploadCorsVariable) { continue }
    if ((ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $BaselineVariables $name)) -cne
        (ConvertTo-GatewayCanonicalJson (Get-GatewayPlanVariableValue $PlanVariables $name))) {
      throw "The upload CORS step changed non-CORS input '$name'."
    }
  }
  return $true
}

# Exactly one in-place update of the bucket CORS configuration, adding only the reviewed origin.
function Assert-ExactDocumentUploadCorsPlan {
  param(
    [Parameter(Mandatory)][object]$Plan,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$BaselineOrigins,
    [Parameter(Mandatory)][string]$Origin
  )
  $null = Assert-DocumentUploadCorsOrigin $Origin
  if ([string]$Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $Plan.errored -or -not $Plan.complete -or
      -not $Plan.applyable) {
    throw "The upload CORS step must be a successful current-version Terraform plan."
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
  if ($meaningfulOutputs.Count -ne 0) { throw "The upload CORS step contains a meaningful output change." }
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -cne "no-op" })
  if ($changes.Count -ne 1 -or [string]$changes[0].address -cne $script:DocumentUploadCorsAddress) {
    throw "The upload CORS plan is not limited to the reviewed CORS configuration."
  }
  $change = $changes[0]
  if ((@($change.change.actions) -join ",") -cne "update" -or [string]$change.mode -cne "managed" -or
      [string]$change.type -cne "aws_s3_bucket_cors_configuration") {
    throw "The upload CORS step may only update the reviewed CORS configuration in place."
  }
  Assert-NoTerraformReplacementPaths $change.change
  # Nothing here is sensitive, and the sensitivity tree grows with the list, so require no sensitive leaf at all.
  foreach ($side in @("before_sensitive", "after_sensitive")) {
    $tree = Get-GatewayOptionalProperty $change.change $side
    if ($null -ne $tree -and @(Get-GatewayUnknownTrueLeafPaths -Value $tree).Count -ne 0) {
      throw "The upload CORS step involves a sensitive value."
    }
  }
  $unknown = Get-GatewayOptionalProperty $change.change "after_unknown"
  if ($null -ne $unknown -and @(Get-GatewayUnknownTrueLeafPaths -Value $unknown).Count -ne 0) {
    throw "The upload CORS step contains an unknown value."
  }
  $before = $change.change.before | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $after = $change.change.after | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  $beforeRules = @($before.cors_rule); $afterRules = @($after.cors_rule)
  if ($beforeRules.Count -ne 1 -or $afterRules.Count -ne 1) { throw "The upload CORS configuration must keep exactly one rule." }
  $beforeOrigins = @($beforeRules[0].allowed_origins); $afterOrigins = @($afterRules[0].allowed_origins)
  if (($beforeOrigins -join "|") -cne ($BaselineOrigins -join "|") -or
      ($afterOrigins -join "|") -cne ((@($BaselineOrigins) + @($Origin)) -join "|")) {
    throw "The upload CORS change is not exactly the retained origin list plus the reviewed origin."
  }
  $beforeRules[0].PSObject.Properties.Remove("allowed_origins"); $afterRules[0].PSObject.Properties.Remove("allowed_origins")
  if ((ConvertTo-GatewayCanonicalJson $beforeRules[0]) -cne (ConvertTo-GatewayCanonicalJson $afterRules[0])) {
    throw "The upload CORS step changed a nonapproved rule attribute."
  }
  $before.PSObject.Properties.Remove("cors_rule"); $after.PSObject.Properties.Remove("cors_rule")
  if ((ConvertTo-GatewayCanonicalJson $before) -cne (ConvertTo-GatewayCanonicalJson $after)) {
    throw "The upload CORS step changed a nonapproved attribute of the configuration."
  }
  return $changes
}
