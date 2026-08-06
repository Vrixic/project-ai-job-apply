[CmdletBinding()]
param(
  [ValidateSet(
    "Status", "Apply", "Verify", "PlanRollback", "ApplyRollback", "VerifyRollback",
    "PlanRestore", "ApplyRestore", "Cleanup"
  )]
  [string]$Action = "Status",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [string]$PlanPath = "",

  [ValidatePattern("^[a-fA-F0-9]{64}$")]
  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "ai-job-apply-staging-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$ConfirmZeroTraffic,
  [switch]$ConfirmRollbackConformance,
  [switch]$ConfirmRestoreConformance,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action Status -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action Apply -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan `
    -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action Verify -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action PlanRollback -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan -ConfirmZeroTraffic

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action ApplyRollback -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan `
    -ExpectedPlanSha256 REVIEWED_ROLLBACK_SHA256 -ConfirmZeroTraffic -Execute

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action PlanRestore -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan -ConfirmRollbackConformance

  .\scripts\operate-staging-serverless-runtime-cutover.ps1 `
    -Action ApplyRestore -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan `
    -ExpectedPlanSha256 REVIEWED_RESTORE_SHA256 -Execute

Apply accepts only the exact checksum-reviewed staging cutover plan created from the current clean,
upstream-matched main commit. It independently proves the exact three creates and six updates,
requires idle retained ECS, zero pending outbox records, and zero open Temporal workflows, then
applies that saved plan without regenerating it. Apply and Verify both run the refresh-backed
completed-cutover verifier. After cutover, Verify and every rollback/restoration action require a
fresh zero-change serverless-runtime-cutover-verify plan created from the current exact main commit.
That runtime baseline preserves accepted maintenance releases instead of reconstructing the stale
original cutover inputs. Rollback and restoration are separate checksum-reviewed plans, require an
empty serverless/legacy work boundary, never change ECS capacity, and retain the Lambda, ECS, Cloud
Map, API, queue, database, and Temporal resources. Rollback intentionally makes the public API
unavailable while the retained ECS service remains idle; it is a zero-traffic recovery drill.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The staging runtime cutover is restricted to us-east-2."
}
if ($Action -ne "Status" -and (
  $ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)
)) {
  throw "$Action requires the exact staging account ID and encrypted state bucket."
}
if ($Action -in @("Apply", "ApplyRollback", "ApplyRestore", "Cleanup") -and -not $Execute) {
  throw "$Action requires -Execute."
}
if ($Action -notin @("Apply", "ApplyRollback", "ApplyRestore", "Cleanup") -and $Execute) {
  throw "$Action does not accept -Execute."
}
if ($Action -in @("PlanRollback", "ApplyRollback") -and -not $ConfirmZeroTraffic) {
  throw "$Action requires -ConfirmZeroTraffic because rollback leaves idle ECS unavailable."
}
if ($Action -eq "PlanRestore" -and -not $ConfirmRollbackConformance) {
  throw "PlanRestore requires -ConfirmRollbackConformance."
}
if ($Action -eq "Cleanup" -and -not $ConfirmRestoreConformance) {
  throw "Cleanup requires -ConfirmRestoreConformance."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\staging"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $environmentDirectory ".terraform"))
$planDirectory = [IO.Path]::GetFullPath((Join-Path $terraformRoot "workflow-dark-plans"))
$terraformDataDirectory = Join-Path $terraformRoot "dark-plan-data"
$transitionDirectory = Join-Path $terraformRoot "serverless-runtime-cutover"
$contextPath = Join-Path $transitionDirectory "context.json"
$rollbackPlanPath = Join-Path $transitionDirectory "rollback.tfplan"
$restorePlanPath = Join-Path $transitionDirectory "restore.tfplan"
$planner = Join-Path $PSScriptRoot "plan-serverless-workflow-dark.ps1"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

function Assert-Tools {
  foreach ($command in @("aws", "git", "node", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "$command is required."
    }
  }
  $terraformVersion = & terraform version -json 2>$null | ConvertFrom-Json
  if ([string]$terraformVersion.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
}

function Assert-ExactMain {
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
  if ($branch -ne "main" -or $head -ne $upstream -or $dirty.Count -ne 0) {
    throw "Use an exact clean upstream-matched main checkout for staging cutover."
  }
  return $head
}

function Resolve-PlanPath {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    throw "The saved staging cutover -PlanPath is required."
  }
  $candidate = if ([IO.Path]::IsPathRooted($PlanPath)) {
    [IO.Path]::GetFullPath($PlanPath)
  } else {
    [IO.Path]::GetFullPath((Join-Path $environmentDirectory $PlanPath))
  }
  $prefix = $planDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) +
    [IO.Path]::DirectorySeparatorChar
  if (
    -not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $candidate -PathType Leaf)
  ) {
    throw "The cutover plan must be an existing file below staging .terraform/workflow-dark-plans."
  }
  return $candidate
}

function Get-PlanJson {
  param([Parameter(Mandatory = $true)][string]$Path)
  $previous = $env:TF_DATA_DIR
  try {
    $env:TF_DATA_DIR = $terraformDataDirectory
    $raw = & terraform "-chdir=$environmentDirectory" show -json $Path 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
      throw "The saved staging cutover plan could not be inspected with the pinned provider set."
    }
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  } finally {
    if ($null -eq $previous) { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue }
    else { $env:TF_DATA_DIR = $previous }
  }
}

function Get-PlanInput {
  param([Parameter(Mandatory = $true)][object]$Plan, [Parameter(Mandatory = $true)][string]$Name)
  $expression = @(
    $Plan.configuration.root_module.module_calls.platform.expressions.PSObject.Properties |
      Where-Object { $_.Name -eq $Name }
  )
  if (
    $expression.Count -eq 1 -and
    $expression[0].Value.PSObject.Properties.Name -contains "constant_value"
  ) {
    return $expression[0].Value.constant_value
  }
  $variable = @($Plan.variables.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if (
    $expression.Count -ne 1 -or @($expression[0].Value.references).Count -ne 1 -or
    [string]$expression[0].Value.references[0] -ne "var.$Name" -or
    $variable.Count -ne 1 -or $variable[0].Value.PSObject.Properties.Name -notcontains "value"
  ) {
    throw "The saved cutover plan does not contain exact platform input '$Name'."
  }
  return $variable[0].Value.value
}

function Get-PlanBooleanInput {
  param([Parameter(Mandatory = $true)][object]$Plan, [Parameter(Mandatory = $true)][string]$Name)
  $value = Get-PlanInput -Plan $Plan -Name $Name
  if ($value -is [bool]) { return $value }
  if ([string]$value -ceq "true") { return $true }
  if ([string]$value -ceq "false") { return $false }
  throw "The saved cutover plan input '$Name' is not an exact boolean."
}

function Assert-OnlyPropertiesChanged {
  param([object]$Change, [string[]]$Allowed, [string]$FailureMessage)
  $beforeNames = @($Change.change.before.PSObject.Properties.Name)
  $afterNames = @($Change.change.after.PSObject.Properties.Name)
  foreach ($name in @($beforeNames + $afterNames | Sort-Object -Unique)) {
    if ($Allowed -contains $name) { continue }
    $before = if ($beforeNames -contains $name) {
      $Change.change.before.$name | ConvertTo-Json -Depth 40 -Compress
    } else { "<absent>" }
    $after = if ($afterNames -contains $name) {
      $Change.change.after.$name | ConvertTo-Json -Depth 40 -Compress
    } else { "<absent>" }
    if ($before -ne $after) { throw $FailureMessage }
  }
}

function Get-OnlyChange {
  param([object[]]$Changes, [string]$Address)
  $match = @($Changes | Where-Object { [string]$_.address -eq $Address })
  if ($match.Count -ne 1) { throw "The exact cutover change '$Address' is not singular." }
  return $match[0]
}

function Get-PlannedValue {
  param([object]$Plan, [string]$Address)
  $match = @($Plan.resource_changes | Where-Object { [string]$_.address -eq $Address })
  if ($match.Count -ne 1 -or $null -eq $match[0].change.after) {
    throw "The planned resource '$Address' is not singular."
  }
  return $match[0].change.after
}

function Assert-CutoverPlan {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $createsExpected = @(
    "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]",
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]'
  )
  $updatesExpected = @(
    "module.platform.aws_apigatewayv2_route.gateway[0]",
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  )
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  $creates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "create" })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $createAddressDifference = @(
    Compare-Object `
      -ReferenceObject @($creates | ForEach-Object { [string]$_.address } | Sort-Object) `
      -DifferenceObject @($createsExpected | Sort-Object)
  )
  $updateAddressDifference = @(
    Compare-Object `
      -ReferenceObject @($updates | ForEach-Object { [string]$_.address } | Sort-Object) `
      -DifferenceObject @($updatesExpected | Sort-Object)
  )
  if (
    $changes.Count -ne 9 -or $creates.Count -ne 3 -or $updates.Count -ne 6 -or
    $createAddressDifference.Count -ne 0 -or $updateAddressDifference.Count -ne 0
  ) {
    throw "The saved plan is outside the exact three-create, six-update staging cutover boundary."
  }
  if (-not (Get-PlanBooleanInput -Plan $Plan -Name "serverless_runtime_cutover")) {
    throw "The saved plan does not select the atomic serverless runtime cutover switch."
  }

  $gateway = Get-OnlyChange $changes "module.platform.aws_lambda_function.gateway[0]"
  Assert-OnlyPropertiesChanged $gateway @(
    "environment", "last_modified", "qualified_arn", "qualified_invoke_arn", "version"
  ) "The gateway cutover changes more than dispatch environment and immutable version."
  $beforeVariables = $gateway.change.before.environment[0].variables
  $afterVariables = $gateway.change.after.environment[0].variables
  if (
    [string]$beforeVariables.OUTBOX_DISPATCH_TARGET -ne "temporal" -or
    [string]$afterVariables.OUTBOX_DISPATCH_TARGET -ne "lambda_durable" -or
    (Compare-Object @($beforeVariables.PSObject.Properties.Name | Sort-Object) `
      @($afterVariables.PSObject.Properties.Name | Sort-Object))
  ) {
    throw "The gateway plan does not change only Temporal dispatch to Lambda durable dispatch."
  }
  foreach ($name in @($beforeVariables.PSObject.Properties.Name)) {
    if (
      $name -ne "OUTBOX_DISPATCH_TARGET" -and
      [string]$beforeVariables.$name -ne [string]$afterVariables.$name
    ) { throw "The gateway cutover changes an unrelated environment value." }
  }

  $integration = (Get-OnlyChange $changes $createsExpected[0]).change.after
  if (
    [string]$integration.integration_type -ne "AWS_PROXY" -or
    [string]$integration.integration_method -ne "POST" -or
    [string]$integration.payload_format_version -ne "2.0" -or
    [int]$integration.timeout_milliseconds -ne 15000
  ) { throw "The saved plan contains an invalid Lambda HTTP API integration." }
  $defaultRoute = (Get-OnlyChange $changes $updatesExpected[0]).change.after
  $authorizer = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_authorizer.gateway[0]"
  if (
    [string]$defaultRoute.route_key -ne '$default' -or
    [string]$defaultRoute.authorization_type -ne "JWT" -or
    [string]$defaultRoute.authorizer_id -ne [string]$authorizer.id
  ) { throw "The saved plan does not protect the Lambda default route with JWT authorization." }
  $alias = Get-OnlyChange $changes "module.platform.aws_lambda_alias.gateway[0]"
  Assert-OnlyPropertiesChanged $alias @("function_version") `
    "The gateway alias cutover changes more than its immutable function version."
  if (-not [bool]$alias.change.after_unknown.function_version) {
    throw "The gateway cutover alias does not target the exact new immutable version."
  }
  $publicRouteKeys = @()
  foreach ($address in $createsExpected[1..2]) {
    $route = (Get-OnlyChange $changes $address).change.after
    if (
      [string]$route.route_key -notin @("GET /health/live", "GET /health/ready") -or
      [string]$route.authorization_type -ne "NONE"
    ) { throw "The saved plan exposes a public route outside the exact health boundary." }
    $publicRouteKeys += [string]$route.route_key
  }
  if (Compare-Object @($publicRouteKeys | Sort-Object) @(
    "GET /health/live", "GET /health/ready"
  )) { throw "The saved plan does not create both exact public health routes." }
  $mappingChange = Get-OnlyChange $changes $updatesExpected[4]
  $mapping = $mappingChange.change.after
  if (
    [bool]$mappingChange.change.before.enabled -or -not [bool]$mapping.enabled -or
    @($mapping.function_response_types) -notcontains "ReportBatchItemFailures"
  ) {
    throw "The saved plan does not transition the starter mapping from disabled to enabled with partial-batch handling."
  }
  foreach ($address in $updatesExpected[1..2]) {
    $rule = (Get-OnlyChange $changes $address).change
    if ([string]$rule.before.state -ne "DISABLED" -or [string]$rule.after.state -ne "ENABLED") {
      throw "The saved plan does not enable both durable workflow rules."
    }
  }
  return $changes
}

function Assert-RuntimeBaselinePlan {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  if ($changes.Count -ne 0) {
    throw "The runtime baseline must be a refresh-backed zero-change plan."
  }
  foreach ($name in @(
    "deploy_applications", "deploy_gateway_lambda", "deploy_serverless_outbox",
    "deploy_profile_readiness_durable", "serverless_runtime_cutover"
  )) {
    if (-not (Get-PlanBooleanInput -Plan $Plan -Name $name)) {
      throw "The runtime baseline does not retain required input '$name'."
    }
  }
  if (Get-PlanBooleanInput -Plan $Plan -Name "run_continuous_ecs_runtime") {
    throw "The runtime baseline does not retain idle rollback-only ECS capacity."
  }

  $gateway = Get-PlannedValue $Plan "module.platform.aws_lambda_function.gateway[0]"
  if ([string]$gateway.environment[0].variables.OUTBOX_DISPATCH_TARGET -ne "lambda_durable") {
    throw "The runtime baseline does not retain Lambda durable dispatch."
  }
  $integration = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]"
  if (
    [string]$integration.integration_type -ne "AWS_PROXY" -or
    [string]$integration.integration_method -ne "POST" -or
    [string]$integration.payload_format_version -ne "2.0" -or
    [int]$integration.timeout_milliseconds -ne 15000
  ) { throw "The runtime baseline does not retain the accepted Lambda HTTP API integration." }
  $defaultRoute = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_route.gateway[0]"
  $authorizer = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_authorizer.gateway[0]"
  if (
    [string]$defaultRoute.route_key -ne '$default' -or
    [string]$defaultRoute.authorization_type -ne "JWT" -or
    [string]$defaultRoute.authorizer_id -ne [string]$authorizer.id -or
    (Compare-Object @($defaultRoute.authorization_scopes | Sort-Object) @(
      "profile:read", "profile:write"
    ))
  ) { throw "The runtime baseline does not retain the accepted JWT route boundary." }
  foreach ($routeKey in @("GET /health/live", "GET /health/ready")) {
    $address = 'module.platform.aws_apigatewayv2_route.gateway_lambda_public["' + $routeKey + '"]'
    $route = Get-PlannedValue $Plan $address
    if ([string]$route.route_key -ne $routeKey -or [string]$route.authorization_type -ne "NONE") {
      throw "The runtime baseline exposes a route outside the exact public health boundary."
    }
  }
  $mapping = Get-PlannedValue $Plan "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]"
  if (-not [bool]$mapping.enabled -or @($mapping.function_response_types) -notcontains "ReportBatchItemFailures") {
    throw "The runtime baseline does not retain the enabled partial-batch starter mapping."
  }
  foreach ($address in @(
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]"
  )) {
    if ([string](Get-PlannedValue $Plan $address).state -ne "ENABLED") {
      throw "The runtime baseline does not retain both enabled workflow rules."
    }
  }
  foreach ($address in @(
    "module.platform.aws_ecs_service.gateway[0]",
    "module.platform.aws_ecs_service.worker[0]"
  )) {
    if ([int](Get-PlannedValue $Plan $address).desired_count -ne 0) {
      throw "The runtime baseline does not retain idle rollback-only ECS services."
    }
  }
  return $changes
}

function Assert-RollbackPlan {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $deletesExpected = @(
    "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]",
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]'
  )
  $updatesExpected = @(
    "module.platform.aws_apigatewayv2_route.gateway[0]",
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  )
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  $deletes = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "delete" })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $deleteAddressDifference = @(
    Compare-Object `
      -ReferenceObject @($deletes | ForEach-Object { [string]$_.address } | Sort-Object) `
      -DifferenceObject @($deletesExpected | Sort-Object)
  )
  $updateAddressDifference = @(
    Compare-Object `
      -ReferenceObject @($updates | ForEach-Object { [string]$_.address } | Sort-Object) `
      -DifferenceObject @($updatesExpected | Sort-Object)
  )
  if (
    $changes.Count -ne 9 -or $deletes.Count -ne 3 -or $updates.Count -ne 6 -or
    $deleteAddressDifference.Count -ne 0 -or $updateAddressDifference.Count -ne 0
  ) {
    throw "The rollback plan is outside the exact three-delete, six-update recovery boundary."
  }
  if (Get-PlanBooleanInput -Plan $Plan -Name "serverless_runtime_cutover") {
    throw "The rollback plan does not select the retained dark runtime boundary."
  }
  $gateway = Get-OnlyChange $changes "module.platform.aws_lambda_function.gateway[0]"
  Assert-OnlyPropertiesChanged $gateway @(
    "environment", "last_modified", "qualified_arn", "qualified_invoke_arn", "version"
  ) "The rollback gateway changes more than dispatch environment and immutable version."
  $beforeVariables = $gateway.change.before.environment[0].variables
  $afterVariables = $gateway.change.after.environment[0].variables
  if (
    [string]$beforeVariables.OUTBOX_DISPATCH_TARGET -ne "lambda_durable" -or
    [string]$afterVariables.OUTBOX_DISPATCH_TARGET -ne "temporal" -or
    (Compare-Object @($beforeVariables.PSObject.Properties.Name | Sort-Object) `
      @($afterVariables.PSObject.Properties.Name | Sort-Object))
  ) { throw "The rollback does not restore only Lambda durable dispatch to Temporal dispatch." }
  foreach ($name in @($beforeVariables.PSObject.Properties.Name)) {
    if (
      $name -ne "OUTBOX_DISPATCH_TARGET" -and
      [string]$beforeVariables.$name -ne [string]$afterVariables.$name
    ) { throw "The rollback changes an unrelated gateway environment value." }
  }
  $defaultRoute = (Get-OnlyChange $changes $updatesExpected[0]).change
  $ecsIntegration = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_integration.gateway[0]"
  if (
    [string]$defaultRoute.before.authorization_type -ne "JWT" -or
    [string]$defaultRoute.after.authorization_type -ne "NONE" -or
    [string]$defaultRoute.after.route_key -ne '$default' -or
    [string]$defaultRoute.after.target -ne "integrations/$([string]$ecsIntegration.id)" -or
    [string]$defaultRoute.before.target -eq [string]$defaultRoute.after.target
  ) { throw "The rollback does not restore the default route to the retained ECS integration." }
  $alias = Get-OnlyChange $changes "module.platform.aws_lambda_alias.gateway[0]"
  Assert-OnlyPropertiesChanged $alias @("function_version") `
    "The gateway rollback alias changes more than its immutable function version."
  if (-not [bool]$alias.change.after_unknown.function_version) {
    throw "The gateway rollback alias does not target the exact restored immutable version."
  }
  $mapping = (Get-OnlyChange $changes $updatesExpected[4]).change
  if (-not [bool]$mapping.before.enabled -or [bool]$mapping.after.enabled) {
    throw "The rollback does not disable the serverless starter mapping."
  }
  foreach ($address in $updatesExpected[1..2]) {
    $rule = (Get-OnlyChange $changes $address).change
    if ([string]$rule.before.state -ne "ENABLED" -or [string]$rule.after.state -ne "DISABLED") {
      throw "The rollback does not disable both serverless workflow rules."
    }
  }
  return $changes
}

function Get-VerificationArguments {
  param(
    [Parameter(Mandatory = $true)][object]$Plan,
    [ValidateSet("Runtime", "Dark")][string]$Mode = "Runtime"
  )
  $gatewayKey = [string](Get-PlanInput $Plan "gateway_lambda_artifact_s3_key")
  $workflowKey = [string](Get-PlanInput $Plan "workflow_ingress_artifact_s3_key")
  if ($gatewayKey -notmatch '^lambda/gateway/([a-f0-9]{40})/[a-f0-9]{64}/gateway-lambda[.]zip$') {
    throw "The saved plan has an invalid gateway artifact key."
  }
  $gatewaySourceSha = $Matches[1]
  if ($workflowKey -notmatch '^lambda/workflows/([a-f0-9]{40})/[a-f0-9]{64}/workflow-ingress-lambda[.]zip$') {
    throw "The saved plan has an invalid workflow artifact key."
  }
  $workflowSourceSha = $Matches[1]
  $gatewayLayer = [string](Get-PlanInput $Plan "gateway_lambda_extension_layer_arn")
  $workflowLayer = [string](Get-PlanInput $Plan "profile_readiness_lambda_extension_layer_arn")
  if ($gatewayLayer -ne $workflowLayer) { throw "The saved plan does not use one pinned extension layer." }
  $arguments = @{
    Environment = "staging"; ExpectedAccountId = $ExpectedAccountId; StateBucket = $StateBucket
    GatewayArtifactS3Key = $gatewayKey
    GatewayArtifactS3ObjectVersion = [string](Get-PlanInput $Plan "gateway_lambda_artifact_s3_object_version")
    GatewayArtifactSourceSha = $gatewaySourceSha
    GatewayArtifactSha256 = [string](Get-PlanInput $Plan "gateway_lambda_artifact_sha256")
    GatewayArtifactBase64Sha256 = [string](Get-PlanInput $Plan "gateway_lambda_artifact_base64sha256")
    WorkflowArtifactSourceSha = $workflowSourceSha
    WorkflowIngressArtifactS3Key = $workflowKey
    WorkflowIngressArtifactS3ObjectVersion = [string](Get-PlanInput $Plan "workflow_ingress_artifact_s3_object_version")
    WorkflowIngressArtifactSha256 = [string](Get-PlanInput $Plan "workflow_ingress_artifact_sha256")
    WorkflowIngressArtifactBase64Sha256 = [string](Get-PlanInput $Plan "workflow_ingress_artifact_base64sha256")
    DurableArtifactS3Key = [string](Get-PlanInput $Plan "profile_readiness_durable_artifact_s3_key")
    DurableArtifactS3ObjectVersion = [string](Get-PlanInput $Plan "profile_readiness_durable_artifact_s3_object_version")
    DurableArtifactSha256 = [string](Get-PlanInput $Plan "profile_readiness_durable_artifact_sha256")
    DurableArtifactBase64Sha256 = [string](Get-PlanInput $Plan "profile_readiness_durable_artifact_base64sha256")
    ActivityArtifactS3Key = [string](Get-PlanInput $Plan "profile_readiness_activity_artifact_s3_key")
    ActivityArtifactS3ObjectVersion = [string](Get-PlanInput $Plan "profile_readiness_activity_artifact_s3_object_version")
    ActivityArtifactSha256 = [string](Get-PlanInput $Plan "profile_readiness_activity_artifact_sha256")
    ActivityArtifactBase64Sha256 = [string](Get-PlanInput $Plan "profile_readiness_activity_artifact_base64sha256")
    PinnedExtensionLayerArn = $workflowLayer; AwsProfile = $AwsProfile; Region = $Region
  }
  if ($Mode -eq "Runtime") { $arguments["VerifyCompletedRuntimeCutover"] = $true }
  else { $arguments["VerifyCompletedDarkDeployment"] = $true }
  return $arguments
}

function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$FailureMessage)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw $FailureMessage }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw $FailureMessage }
}

function Assert-Caller {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") "The staging AWS session is unavailable."
  if (
    [string]$caller.Account -ne $ExpectedAccountId -or
    -not ([string]$caller.Arn).Contains(":assumed-role/")
  ) { throw "Use the temporary IAM Identity Center session for the exact staging account." }
}

function Assert-ZeroLegacyWork {
  param([object]$Plan)
  $inspectionRaw = & (Join-Path $PSScriptRoot "inspect-deployed-outbox.ps1") `
    -Environment staging -AwsProfile $AwsProfile -Region $Region -Execute
  if ($LASTEXITCODE -ne 0) { throw "The bounded staging outbox inspection failed." }
  try { $inspection = ($inspectionRaw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "The bounded staging outbox inspection returned an invalid result." }
  if (
    [int]$inspection.version -ne 1 -or [int]$inspection.pendingCount -ne 0 -or
    [string]$inspection.orderedEventIdSha256 -notmatch "^[a-f0-9]{64}$"
  ) { throw "Staging cutover requires a fresh zero-pending-outbox inspection." }
  & node (Join-Path $repositoryRoot "backend/workflows/cloud-conformance.mjs") `
    --profile $AwsProfile --region $Region `
    --secret-id "ai-job-apply/staging/temporal-api-key" `
    --address ([string](Get-PlanInput $Plan "temporal_address")) `
    --namespace ([string](Get-PlanInput $Plan "temporal_namespace")) `
    --require-zero-open-workflows
  if ($LASTEXITCODE -ne 0) { throw "Staging cutover requires zero open Temporal workflows." }
}

function Assert-ZeroServerlessWork {
  foreach ($queueName in @(
    "ai-job-apply-staging-events",
    "ai-job-apply-staging-dead-letter",
    "ai-job-apply-staging-profile-readiness-dead-letter"
  )) {
    $queue = Invoke-AwsJson `
      @("sqs", "get-queue-url", "--queue-name", $queueName) `
      "A staging serverless queue could not be resolved."
    $depth = Invoke-AwsJson @(
      "sqs", "get-queue-attributes", "--queue-url", ([string]$queue.QueueUrl),
      "--attribute-names", "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"
    ) "A staging serverless queue depth could not be inspected."
    if (
      [int]$depth.Attributes.ApproximateNumberOfMessages +
      [int]$depth.Attributes.ApproximateNumberOfMessagesNotVisible +
      [int]$depth.Attributes.ApproximateNumberOfMessagesDelayed -ne 0
    ) { throw "Rollback requires every serverless queue and DLQ to be empty." }
  }
  $running = Invoke-AwsJson @(
    "lambda", "list-durable-executions-by-function", "--function-name",
    "ai-job-apply-staging-profile-readiness-durable", "--statuses", "RUNNING",
    "--max-items", "1", "--no-paginate"
  ) "The staging durable execution inventory could not be inspected."
  if (@($running.DurableExecutions).Count -ne 0) {
    throw "Rollback requires zero running durable executions."
  }
}

function Save-Context {
  param([Parameter(Mandatory = $true)][object]$Context)
  $null = New-Item -ItemType Directory -Path $transitionDirectory -Force
  [IO.File]::WriteAllText($contextPath, ($Context | ConvertTo-Json -Depth 8), $utf8WithoutBom)
}

function Get-Context {
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw "The ignored staging cutover rollback context is absent."
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  if (
    [string]$context.Schema -ne "applydash.staging.serverless-runtime-cutover.v2" -or
    [string]$context.SourceCommit -notmatch "^[a-f0-9]{40}$" -or
    [string]$context.RuntimeBaselinePlanSha256 -notmatch "^[a-f0-9]{64}$"
  ) { throw "The ignored staging cutover rollback context is invalid." }
  return $context
}

function Assert-Context {
  param([object]$Context, [string]$SourceCommit, [string]$RuntimeBaselinePlanSha256)
  if (
    [string]$Context.SourceCommit -ne $SourceCommit -or
    [string]$Context.ExpectedAccountId -ne $ExpectedAccountId -or
    [string]$Context.StateBucket -ne $StateBucket -or
    [string]$Context.RuntimeBaselinePlanPath -ne $resolvedPlanPath -or
    [string]$Context.RuntimeBaselinePlanSha256 -ne $RuntimeBaselinePlanSha256
  ) { throw "The ignored rollback context does not match the exact source, account, state, and runtime baseline." }
}

function Set-RetainedPlanVariables {
  param([object]$SourcePlan, [bool]$RuntimeCutover)
  $prior = [ordered]@{}
  foreach ($property in @($SourcePlan.variables.PSObject.Properties)) {
    $name = "TF_VAR_$([string]$property.Name)"
    $prior[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    $value = $property.Value.value
    $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
      elseif ($value -is [string]) { $value }
      elseif ($null -eq $value) { "" }
      elseif ($value -is [ValueType]) { [Convert]::ToString($value, [Globalization.CultureInfo]::InvariantCulture) }
      else { $value | ConvertTo-Json -Depth 30 -Compress }
    [Environment]::SetEnvironmentVariable($name, $serialized, "Process")
  }
  $cutoverName = "TF_VAR_serverless_runtime_cutover"
  if (-not $prior.Contains($cutoverName)) {
    $prior[$cutoverName] = [Environment]::GetEnvironmentVariable($cutoverName, "Process")
  }
  [Environment]::SetEnvironmentVariable(
    $cutoverName, $RuntimeCutover.ToString().ToLowerInvariant(), "Process"
  )
  return $prior
}

function Restore-EnvironmentVariables {
  param([System.Collections.IDictionary]$Prior)
  foreach ($name in $Prior.Keys) {
    [Environment]::SetEnvironmentVariable($name, $Prior[$name], "Process")
  }
}

function New-TransitionPlan {
  param([object]$SourcePlan, [bool]$RuntimeCutover, [string]$Destination)
  if (Test-Path -LiteralPath $Destination) {
    throw "A saved staging transition plan already exists at the exact ignored path."
  }
  $null = New-Item -ItemType Directory -Path $transitionDirectory -Force
  $previous = [ordered]@{
    TF_DATA_DIR = $env:TF_DATA_DIR; AWS_ACCESS_KEY_ID = $env:AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = $env:AWS_SECRET_ACCESS_KEY; AWS_SESSION_TOKEN = $env:AWS_SESSION_TOKEN
    AWS_REGION = $env:AWS_REGION; AWS_DEFAULT_REGION = $env:AWS_DEFAULT_REGION
  }
  $priorVariables = $null
  try {
    $credentials = & aws configure export-credentials --profile $AwsProfile --format process 2>$null |
      ConvertFrom-Json
    if (-not $credentials.SessionToken) { throw "Short-lived staging credentials are unavailable." }
    $env:TF_DATA_DIR = $terraformDataDirectory
    $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
    $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region
    Initialize-Backend
    $priorVariables = Set-RetainedPlanVariables $SourcePlan $RuntimeCutover
    $output = & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=5m `
      -detailed-exitcode "-out=$Destination" 2>&1
    if ($LASTEXITCODE -ne 2) {
      $diagnostic = (@($output) | Select-Object -Last 8) -join " "
      throw "The staging transition did not produce the required change-only plan: $diagnostic"
    }
  } finally {
    if ($null -ne $priorVariables) { Restore-EnvironmentVariables $priorVariables }
    foreach ($name in $previous.Keys) {
      if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$name" $previous[$name] }
    }
  }
  $transition = Get-PlanJson $Destination
  if ($RuntimeCutover) { $null = Assert-CutoverPlan $transition }
  else { $null = Assert-RollbackPlan $transition }
  return [ordered]@{
    Path = $Destination
    Sha256 = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Creates = if ($RuntimeCutover) { 3 } else { 0 }
    Updates = 6
    Deletes = if ($RuntimeCutover) { 0 } else { 3 }
    Replacements = 0
  }
}

function Assert-ReviewedTransitionPlan {
  param([string]$Path, [string]$RecordedSha256, [ValidateSet("Rollback", "Restore")][string]$Mode)
  if (
    $ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
    -not (Test-Path -LiteralPath $Path -PathType Leaf)
  ) { throw "$Mode requires its exact saved plan and reviewed SHA-256." }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedPlanSha256.ToLowerInvariant() -or $actual -ne $RecordedSha256) {
    throw "The saved $Mode plan does not match the reviewed checksum and ignored context."
  }
  $plan = Get-PlanJson $Path
  if ($Mode -eq "Rollback") { $null = Assert-RollbackPlan $plan }
  else { $null = Assert-CutoverPlan $plan }
}

function Invoke-CompletedVerification {
  param(
    [object]$Plan,
    [ValidateSet("Runtime", "Dark")][string]$Mode = "Runtime"
  )
  $arguments = Get-VerificationArguments $Plan $Mode
  $raw = & $planner @arguments
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "Completed staging $Mode verification failed." }
  $result = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  $modeValid = if ($Mode -eq "Runtime") {
    [bool]$result.CompletedRuntimeCutoverVerification -and
    [string]$result.DispatchTarget -eq "lambda_durable" -and [bool]$result.TriggersEnabled -and
    [bool]$result.LegacyOutboxEmpty -and [bool]$result.TemporalOpenWorkflowsEmpty -and
    [bool]$result.DurableOpenExecutionsEmpty
  } else {
    [bool]$result.CompletedDarkVerification -and
    [string]$result.DispatchTarget -eq "temporal" -and -not [bool]$result.TriggersEnabled
  }
  if (
    -not $modeValid -or -not [bool]$result.NoDrift -or -not [bool]$result.EcsRuntimeIdle -or
    [int]$result.Creates -ne 0 -or [int]$result.Updates -ne 0 -or
    [int]$result.Deletes -ne 0 -or [int]$result.Replacements -ne 0
  ) { throw "Completed staging $Mode verification returned an invalid boundary." }
  return $result
}

function Initialize-Backend {
  $stateEncryption = Invoke-AwsJson `
    @("s3api", "get-bucket-encryption", "--bucket", $StateBucket) `
    "The encrypted staging state bucket could not be inspected."
  $rules = @($stateEncryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
    $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
    $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  })
  if ($rules.Count -ne 1) { throw "The staging state bucket does not expose one KMS default." }
  $keyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($keyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The staging state key is outside the exact account and region."
  }
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  & terraform "-chdir=$environmentDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$keyArn" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The pinned staging provider set could not initialize." }
}

function Invoke-SavedPlan {
  param([string]$Path, [string]$FailureMessage)
  $previous = [ordered]@{
    TF_DATA_DIR = $env:TF_DATA_DIR; AWS_ACCESS_KEY_ID = $env:AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = $env:AWS_SECRET_ACCESS_KEY; AWS_SESSION_TOKEN = $env:AWS_SESSION_TOKEN
    AWS_REGION = $env:AWS_REGION; AWS_DEFAULT_REGION = $env:AWS_DEFAULT_REGION
  }
  try {
    $credentials = & aws configure export-credentials --profile $AwsProfile --format process 2>$null |
      ConvertFrom-Json
    if (-not $credentials.SessionToken) { throw "Short-lived staging credentials are unavailable." }
    $env:TF_DATA_DIR = $terraformDataDirectory
    $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
    $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region
    Initialize-Backend
    & terraform "-chdir=$environmentDirectory" apply -input=false $Path
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
  } finally {
    foreach ($name in $previous.Keys) {
      if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$name" $previous[$name] }
    }
  }
}

Assert-Tools
$resolvedPlanPath = Resolve-PlanPath
$plan = Get-PlanJson $resolvedPlanPath
$planLeaf = Split-Path $resolvedPlanPath -Leaf
$planKind = if ($planLeaf.StartsWith("serverless-runtime-cutover-verify-", [StringComparison]::Ordinal)) {
  $null = Assert-RuntimeBaselinePlan $plan
  "runtime_baseline"
} else {
  $null = Assert-CutoverPlan $plan
  "cutover"
}
$actualPlanSha256 = (Get-FileHash -LiteralPath $resolvedPlanPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($Action -eq "Status") {
  [ordered]@{
    Environment = "staging"; PlanKind = $planKind; PlanSha256 = $actualPlanSha256
    Creates = if ($planKind -eq "cutover") { 3 } else { 0 }
    Updates = if ($planKind -eq "cutover") { 6 } else { 0 }
    Deletes = 0; Replacements = 0; AwsMutation = $false
    RollbackContextPresent = Test-Path -LiteralPath $contextPath
    RollbackPlanPresent = Test-Path -LiteralPath $rollbackPlanPath
    RestorePlanPresent = Test-Path -LiteralPath $restorePlanPath
  } | ConvertTo-Json
  exit 0
}

$sourceCommit = Assert-ExactMain
$requiredPlanPrefix = if ($Action -eq "Apply") {
  if ($planKind -ne "cutover") { throw "Apply requires the original reviewed cutover plan." }
  "serverless-runtime-cutover-$($sourceCommit.Substring(0, 8))"
} else {
  if ($planKind -ne "runtime_baseline") {
    throw "$Action requires a fresh zero-change runtime baseline from the current accepted source."
  }
  "serverless-runtime-cutover-verify-$($sourceCommit.Substring(0, 8))"
}
if (-not $planLeaf.StartsWith(
  $requiredPlanPrefix,
  [StringComparison]::Ordinal
)) { throw "The reviewed plan was not created from the current exact main commit." }
Assert-Caller

switch ($Action) {
  "Apply" {
    if (
      $ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
      $actualPlanSha256 -ne $ExpectedPlanSha256.ToLowerInvariant()
    ) { throw "The saved cutover plan does not match the exact reviewed checksum." }
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    Invoke-SavedPlan $resolvedPlanPath "The exact reviewed staging cutover plan failed to apply."
    $verification = Invoke-CompletedVerification $plan Runtime
    [ordered]@{
      Environment = "staging"; Action = "apply"; AppliedPlanSha256 = $actualPlanSha256
      NoDrift = [bool]$verification.NoDrift; DispatchTarget = "lambda_durable"
      TriggersEnabled = $true; EcsRuntimeIdle = $true
      LegacyOutboxEmpty = $true; TemporalOpenWorkflowsEmpty = $true
      PublicConformanceRequired = $true
    } | ConvertTo-Json
  }
  "Verify" {
    $verification = Invoke-CompletedVerification $plan Runtime
    [ordered]@{
      Environment = "staging"; Action = "verify"; NoDrift = [bool]$verification.NoDrift
      DispatchTarget = "lambda_durable"; TriggersEnabled = $true; EcsRuntimeIdle = $true
      LegacyOutboxEmpty = $true; TemporalOpenWorkflowsEmpty = $true
      PublicConformanceRequired = $true
    } | ConvertTo-Json
  }
  "PlanRollback" {
    if (Test-Path -LiteralPath $contextPath) { throw "A staging cutover rollback context already exists." }
    $null = Invoke-CompletedVerification $plan Runtime
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    $summary = New-TransitionPlan $plan $false $rollbackPlanPath
    $context = [ordered]@{
      Schema = "applydash.staging.serverless-runtime-cutover.v2"
      SourceCommit = $sourceCommit; ExpectedAccountId = $ExpectedAccountId
      StateBucket = $StateBucket; RuntimeBaselinePlanPath = $resolvedPlanPath
      RuntimeBaselinePlanSha256 = $actualPlanSha256; RollbackPlanSha256 = [string]$summary.Sha256
      RestorePlanSha256 = ""; State = "rollback_planned"
    }
    Save-Context $context
    [ordered]@{
      Environment = "staging"; Action = "rollback_review"; PlanSha256 = [string]$summary.Sha256
      Creates = 0; Updates = 6; Deletes = 3; Replacements = 0
      PublicApiAvailableAfterApply = $false; EcsCapacityChange = $false; AwsMutation = $false
    } | ConvertTo-Json
  }
  "ApplyRollback" {
    $context = Get-Context
    Assert-Context $context $sourceCommit $actualPlanSha256
    if ([string]$context.State -ne "rollback_planned") { throw "The rollback context is not ready to apply." }
    Assert-ReviewedTransitionPlan $rollbackPlanPath ([string]$context.RollbackPlanSha256) Rollback
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    Invoke-SavedPlan $rollbackPlanPath "The exact reviewed staging rollback plan failed to apply."
    $verification = Invoke-CompletedVerification $plan Dark
    $context.State = "rollback_verified"
    Save-Context $context
    [ordered]@{
      Environment = "staging"; Action = "rollback"; NoDrift = [bool]$verification.NoDrift
      DispatchTarget = "temporal"; TriggersEnabled = $false; EcsRuntimeIdle = $true
      PublicApiAvailable = $false; RollbackConformanceRequired = $true
    } | ConvertTo-Json
  }
  "VerifyRollback" {
    $context = Get-Context
    Assert-Context $context $sourceCommit $actualPlanSha256
    $verification = Invoke-CompletedVerification $plan Dark
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    [ordered]@{
      Environment = "staging"; Action = "verify_rollback"; NoDrift = [bool]$verification.NoDrift
      DispatchTarget = "temporal"; TriggersEnabled = $false; EcsRuntimeIdle = $true
      PublicApiAvailable = $false
    } | ConvertTo-Json
  }
  "PlanRestore" {
    $context = Get-Context
    Assert-Context $context $sourceCommit $actualPlanSha256
    if ([string]$context.State -ne "rollback_verified") {
      throw "Restoration planning requires the verified rollback context."
    }
    $null = Invoke-CompletedVerification $plan Dark
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    $summary = New-TransitionPlan $plan $true $restorePlanPath
    $context.RestorePlanSha256 = [string]$summary.Sha256
    $context.State = "restore_planned"
    Save-Context $context
    [ordered]@{
      Environment = "staging"; Action = "restore_review"; PlanSha256 = [string]$summary.Sha256
      Creates = 3; Updates = 6; Deletes = 0; Replacements = 0
      EcsCapacityChange = $false; AwsMutation = $false
    } | ConvertTo-Json
  }
  "ApplyRestore" {
    $context = Get-Context
    Assert-Context $context $sourceCommit $actualPlanSha256
    if ([string]$context.State -ne "restore_planned") { throw "The restoration context is not ready to apply." }
    Assert-ReviewedTransitionPlan $restorePlanPath ([string]$context.RestorePlanSha256) Restore
    Assert-ZeroLegacyWork $plan
    Assert-ZeroServerlessWork
    Invoke-SavedPlan $restorePlanPath "The exact reviewed staging restoration plan failed to apply."
    $verification = Invoke-CompletedVerification $plan Runtime
    $context.State = "restore_verified"
    Save-Context $context
    [ordered]@{
      Environment = "staging"; Action = "restore"; NoDrift = [bool]$verification.NoDrift
      DispatchTarget = "lambda_durable"; TriggersEnabled = $true; EcsRuntimeIdle = $true
      PublicConformanceRequired = $true
    } | ConvertTo-Json
  }
  "Cleanup" {
    $context = Get-Context
    Assert-Context $context $sourceCommit $actualPlanSha256
    if ([string]$context.State -ne "restore_verified") {
      throw "Cleanup requires the verified restored runtime context."
    }
    $null = Invoke-CompletedVerification $plan Runtime
    foreach ($path in @($rollbackPlanPath, $restorePlanPath, $contextPath)) {
      if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
    [ordered]@{
      Environment = "staging"; Action = "cleanup"; RestoredRuntimeVerified = $true
      RemovedIgnoredArtifacts = 3; AwsMutation = $false
    } | ConvertTo-Json
  }
}
