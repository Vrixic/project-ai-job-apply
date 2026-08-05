[CmdletBinding()]
param(
  [ValidateSet("Status", "Apply")]
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

  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-gateway-runtime-release.ps1 `
    -Action Status -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan

  .\scripts\operate-staging-gateway-runtime-release.ps1 `
    -Action Apply -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/workflow-dark-plans/PLAN.tfplan `
    -ExpectedPlanSha256 REVIEWED_SHA256 -Execute

Status performs no AWS mutation. Apply accepts only an exact checksum-reviewed staging plan
created from the current clean, upstream-matched main commit. It permits either the two-update
immutable Lambda release or the one-update default-route scope correction. Both modes preserve
the JWT authorizer, Lambda integration, durable workflow triggers, retained idle ECS, data, and
every unrelated resource. Apply immediately runs the completed-runtime zero-drift verifier.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The staging gateway runtime release is restricted to us-east-2."
}
if ($Action -eq "Apply" -and (
  $ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)
)) {
  throw "Apply requires the exact staging account ID and encrypted state bucket."
}
if ($Action -eq "Apply" -and -not $Execute) { throw "Apply requires -Execute." }
if ($Action -eq "Status" -and $Execute) { throw "Status does not accept -Execute." }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\staging"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $environmentDirectory ".terraform"))
$planDirectory = [IO.Path]::GetFullPath((Join-Path $terraformRoot "workflow-dark-plans"))
$terraformDataDirectory = Join-Path $terraformRoot "dark-plan-data"
$verifier = Join-Path $PSScriptRoot "plan-staging-serverless-runtime-cutover.ps1"

function Assert-Tools {
  foreach ($command in @("aws", "git", "terraform")) {
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
    throw "Use an exact clean upstream-matched main checkout for a staging gateway release."
  }
  return $head
}

function Resolve-PlanPath {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    throw "The saved staging gateway release -PlanPath is required."
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
    throw "The plan must be an existing file below staging .terraform/workflow-dark-plans."
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
      throw "The saved staging gateway release plan could not be inspected."
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
  ) { return $expression[0].Value.constant_value }
  $variable = @($Plan.variables.PSObject.Properties | Where-Object { $_.Name -eq $Name })
  if (
    $expression.Count -ne 1 -or @($expression[0].Value.references).Count -ne 1 -or
    [string]$expression[0].Value.references[0] -ne "var.$Name" -or
    $variable.Count -ne 1 -or $variable[0].Value.PSObject.Properties.Name -notcontains "value"
  ) { throw "The saved plan does not contain exact platform input '$Name'." }
  return $variable[0].Value.value
}

function Get-PlanBoolean {
  param([Parameter(Mandatory = $true)][object]$Plan, [Parameter(Mandatory = $true)][string]$Name)
  $value = Get-PlanInput -Plan $Plan -Name $Name
  if ($value -is [bool]) { return $value }
  if ([string]$value -ceq "true") { return $true }
  if ([string]$value -ceq "false") { return $false }
  throw "The saved plan input '$Name' is not an exact boolean."
}

function Get-PlannedValue {
  param([object]$Plan, [string]$Address)
  $match = @($Plan.resource_changes | Where-Object { [string]$_.address -eq $Address })
  if ($match.Count -ne 1 -or $null -eq $match[0].change.after) {
    throw "The planned resource '$Address' is not singular."
  }
  return $match[0].change.after
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

function Assert-GatewayReleasePlan {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $expected = @(
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  )
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $updateAddresses = @(
    $updates | ForEach-Object { [string]$_.address } | Sort-Object
  )
  $expectedAddresses = @($expected | Sort-Object)
  $addressDifference = @(
    Compare-Object -ReferenceObject $updateAddresses -DifferenceObject $expectedAddresses
  )
  if (
    $changes.Count -ne 2 -or $updates.Count -ne 2 -or
    $addressDifference.Count -ne 0
  ) { throw "The plan is outside the exact two-update staging gateway release boundary." }

  foreach ($name in @(
    "deploy_applications", "deploy_gateway_lambda", "deploy_serverless_outbox",
    "deploy_profile_readiness_durable", "serverless_runtime_cutover"
  )) {
    if (-not (Get-PlanBoolean -Plan $Plan -Name $name)) {
      throw "The gateway release does not preserve the complete serverless runtime."
    }
  }
  if (Get-PlanBoolean -Plan $Plan -Name "run_continuous_ecs_runtime") {
    throw "The gateway release attempts to resume continuous ECS capacity."
  }

  $function = @($updates | Where-Object {
    [string]$_.address -eq "module.platform.aws_lambda_function.gateway[0]"
  })[0]
  Assert-OnlyPropertiesChanged $function @(
    "environment", "last_modified", "qualified_arn", "qualified_invoke_arn", "s3_key",
    "s3_object_version", "source_code_hash", "version"
  ) "The gateway release changes more than immutable artifact and computed version fields."
  if (-not [bool]$function.change.after_unknown.version) {
    throw "The gateway release does not create a new immutable version."
  }
  $artifactKey = [string](Get-PlanInput $Plan "gateway_lambda_artifact_s3_key")
  if ($artifactKey -notmatch '^lambda/gateway/([a-f0-9]{40})/[a-f0-9]{64}/gateway-lambda[.]zip$') {
    throw "The gateway release artifact key is invalid."
  }
  if (
    [string]$function.change.after.s3_key -ne $artifactKey -or
    [string]$function.change.after.s3_object_version -ne
      [string](Get-PlanInput $Plan "gateway_lambda_artifact_s3_object_version") -or
    [string]$function.change.after.source_code_hash -ne
      [string](Get-PlanInput $Plan "gateway_lambda_artifact_base64sha256")
  ) { throw "The function update does not use the exact reviewed immutable artifact." }
  $beforeVariables = $function.change.before.environment[0].variables
  $afterVariables = $function.change.after.environment[0].variables
  $beforeVariableNames = @($beforeVariables.PSObject.Properties.Name | Sort-Object)
  $afterVariableNames = @($afterVariables.PSObject.Properties.Name | Sort-Object)
  $variableNameDifference = @(
    Compare-Object `
      -ReferenceObject $beforeVariableNames `
      -DifferenceObject $afterVariableNames
  )
  if (
    $variableNameDifference.Count -ne 0 -or
    [string]$afterVariables.RELEASE_SHA -ne
      [string](Get-PlanInput $Plan "gateway_lambda_artifact_sha256") -or
    [string]$afterVariables.OUTBOX_DISPATCH_TARGET -ne "lambda_durable"
  ) { throw "The gateway release changes an environment key outside release identity." }
  foreach ($name in @($beforeVariables.PSObject.Properties.Name)) {
    if (
      $name -ne "RELEASE_SHA" -and
      [string]$beforeVariables.$name -ne [string]$afterVariables.$name
    ) { throw "The gateway release changes an unrelated environment value." }
  }

  $alias = @($updates | Where-Object {
    [string]$_.address -eq "module.platform.aws_lambda_alias.gateway[0]"
  })[0]
  Assert-OnlyPropertiesChanged $alias @("function_version") `
    "The public gateway alias changes more than its immutable version."
  if (-not [bool]$alias.change.after_unknown.function_version) {
    throw "The public gateway alias does not target the version created by this plan."
  }

  $route = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_route.gateway[0]"
  $integration = Get-PlannedValue $Plan "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]"
  $routeScopes = @($route.authorization_scopes | Sort-Object)
  $routeScopeDifference = @(
    Compare-Object `
      -ReferenceObject $routeScopes `
      -DifferenceObject @("profile:read", "profile:write")
  )
  if (
    $routeScopes.Count -ne 2 -or $routeScopeDifference.Count -ne 0 -or
    [string]$route.authorization_type -ne "JWT" -or
    [string]$route.target -ne "integrations/$([string]$integration.id)" -or
    [string]$integration.integration_type -ne "AWS_PROXY" -or
    [string]$integration.payload_format_version -ne "2.0"
  ) { throw "The release is outside the existing JWT-protected Lambda route." }
  if (
    -not [bool](Get-PlannedValue $Plan `
      "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]").enabled -or
    [string](Get-PlannedValue $Plan `
      "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]").state -ne "ENABLED" -or
    [string](Get-PlannedValue $Plan `
      "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]").state -ne "ENABLED"
  ) { throw "The gateway release does not preserve every live workflow trigger." }
  foreach ($address in @(
    "module.platform.aws_ecs_service.gateway[0]",
    "module.platform.aws_ecs_service.worker[0]"
  )) {
    if ([int](Get-PlannedValue $Plan $address).desired_count -ne 0) {
      throw "The gateway release does not preserve idle retained ECS."
    }
  }
}

function Assert-GatewayScopeBoundaryPlan {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $routeAddress = "module.platform.aws_apigatewayv2_route.gateway[0]"
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  if (
    $changes.Count -ne 1 -or $updates.Count -ne 1 -or
    [string]$updates[0].address -ne $routeAddress
  ) { throw "The plan is outside the exact one-update staging JWT scope boundary." }

  foreach ($name in @(
    "deploy_applications", "deploy_gateway_lambda", "deploy_serverless_outbox",
    "deploy_profile_readiness_durable", "serverless_runtime_cutover"
  )) {
    if (-not (Get-PlanBoolean -Plan $Plan -Name $name)) {
      throw "The JWT scope correction does not preserve the complete serverless runtime."
    }
  }
  if (Get-PlanBoolean -Plan $Plan -Name "run_continuous_ecs_runtime") {
    throw "The JWT scope correction attempts to resume continuous ECS capacity."
  }

  $routeChange = $updates[0]
  Assert-OnlyPropertiesChanged $routeChange @("authorization_scopes") `
    "The JWT scope correction changes more than the default route authorization scopes."
  $beforeScopes = @($routeChange.change.before.authorization_scopes | Sort-Object)
  $afterScopes = @($routeChange.change.after.authorization_scopes | Sort-Object)
  $scopeDifference = @(
    Compare-Object `
      -ReferenceObject $afterScopes `
      -DifferenceObject @("profile:read", "profile:write")
  )
  $integration = Get-PlannedValue $Plan `
    "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]"
  if (
    $beforeScopes.Count -ne 0 -or $afterScopes.Count -ne 2 -or
    $scopeDifference.Count -ne 0 -or
    [string]$routeChange.change.after.authorization_type -ne "JWT" -or
    [string]$routeChange.change.after.route_key -ne '$default' -or
    [string]$routeChange.change.after.target -ne
      "integrations/$([string]$integration.id)" -or
    [string]$integration.integration_type -ne "AWS_PROXY" -or
    [string]$integration.payload_format_version -ne "2.0"
  ) { throw "The default route is outside the exact reviewed JWT scope correction." }

  if (
    -not [bool](Get-PlannedValue $Plan `
      "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]").enabled -or
    [string](Get-PlannedValue $Plan `
      "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]").state -ne "ENABLED" -or
    [string](Get-PlannedValue $Plan `
      "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]").state -ne "ENABLED"
  ) { throw "The JWT scope correction does not preserve every live workflow trigger." }
  foreach ($address in @(
    "module.platform.aws_ecs_service.gateway[0]",
    "module.platform.aws_ecs_service.worker[0]"
  )) {
    if ([int](Get-PlannedValue $Plan $address).desired_count -ne 0) {
      throw "The JWT scope correction does not preserve idle retained ECS."
    }
  }
}

function Get-GatewayPlanKind {
  param([Parameter(Mandatory = $true)][object]$Plan)
  $addresses = @(
    $Plan.resource_changes |
      Where-Object { (@($_.change.actions) -join ",") -notin @("no-op", "read") } |
      ForEach-Object { [string]$_.address } |
      Sort-Object
  )
  $releaseAddresses = @(
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  ) | Sort-Object
  $releaseDifference = @(
    Compare-Object -ReferenceObject $addresses -DifferenceObject $releaseAddresses
  )
  if ($addresses.Count -eq 2 -and $releaseDifference.Count -eq 0) {
    return "artifact_release"
  }
  if (
    $addresses.Count -eq 1 -and
    $addresses[0] -eq "module.platform.aws_apigatewayv2_route.gateway[0]"
  ) {
    return "scope_boundary"
  }
  throw "The plan is outside every reviewed staging gateway change boundary."
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

function Get-VerificationArguments {
  param([object]$Plan)
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
  return @{
    Action = "Verify"; ExpectedAccountId = $ExpectedAccountId; StateBucket = $StateBucket
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
}

function Invoke-SavedPlan {
  param([string]$Path)
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
    if ($LASTEXITCODE -ne 0) { throw "The exact reviewed staging gateway release failed to apply." }
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
$planKind = Get-GatewayPlanKind $plan
if ($planKind -eq "artifact_release") { Assert-GatewayReleasePlan $plan }
else { Assert-GatewayScopeBoundaryPlan $plan }
$actualPlanSha256 = (Get-FileHash -LiteralPath $resolvedPlanPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($Action -eq "Status") {
  [ordered]@{
    Environment = "staging"
    Action = if ($planKind -eq "artifact_release") {
      "gateway_release_review"
    } else { "gateway_scope_boundary_review" }
    PlanSha256 = $actualPlanSha256
    Creates = 0; Updates = if ($planKind -eq "artifact_release") { 2 } else { 1 }
    Deletes = 0; Replacements = 0
    ApiTrafficChange = $true; WorkflowTriggerChange = $false; EcsCapacityChange = $false
    AwsMutation = $false
  } | ConvertTo-Json
  exit 0
}

$sourceCommit = Assert-ExactMain
$expectedPlanPrefix = if ($planKind -eq "artifact_release") {
  "gateway-runtime-release"
} else { "gateway-scope-boundary" }
if (-not (Split-Path $resolvedPlanPath -Leaf).StartsWith(
  "$expectedPlanPrefix-$($sourceCommit.Substring(0, 8))",
  [StringComparison]::Ordinal
)) { throw "The reviewed gateway release plan was not created from current exact main." }
Assert-Caller
if (
  $ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$" -or
  $actualPlanSha256 -ne $ExpectedPlanSha256.ToLowerInvariant()
) { throw "The saved gateway release plan does not match the exact reviewed checksum." }

Invoke-SavedPlan $resolvedPlanPath
$verificationArguments = Get-VerificationArguments $plan
$verificationRaw = & $verifier @verificationArguments
if ($LASTEXITCODE -ne 0 -or -not $verificationRaw) {
  throw "The completed staging runtime verification failed after the gateway release."
}
$verification = ($verificationRaw -join [Environment]::NewLine) | ConvertFrom-Json
if (
  -not [bool]$verification.CompletedRuntimeCutoverVerification -or
  -not [bool]$verification.NoDrift -or -not [bool]$verification.EcsRuntimeIdle -or
  [string]$verification.DispatchTarget -ne "lambda_durable" -or
  -not [bool]$verification.TriggersEnabled -or [int]$verification.Creates -ne 0 -or
  [int]$verification.Updates -ne 0 -or [int]$verification.Deletes -ne 0 -or
  [int]$verification.Replacements -ne 0
) { throw "The gateway release did not return to the accepted zero-drift runtime boundary." }

[ordered]@{
  Environment = "staging"
  Action = if ($planKind -eq "artifact_release") {
    "gateway_release"
  } else { "gateway_scope_boundary" }
  AppliedPlanSha256 = $actualPlanSha256
  NoDrift = $true; DispatchTarget = "lambda_durable"; TriggersEnabled = $true
  EcsRuntimeIdle = $true; PublicConformanceRequired = $true
} | ConvertTo-Json
