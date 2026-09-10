[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "staging",
  [ValidateSet("Status", "Measure")]
  [string]$Action = "Status",
  [string]$StartTime = "",
  [string]$EndTime = "",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [ValidateSet("Phase0", "D1Read", "D1SavedJob", "D1Match", "D2Public", "D2PublicDevelopment", "D2AuthenticatedIntake", "D2Processing")]
  [string]$WorkloadProfile = "Phase0",
  [string]$WorkloadResultPath = "",
  [string]$WorkloadResultSha256 = "",
  [string]$AwsProfile = "",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Help) {
  @"
Usage:
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/APPLIED_PLAN.tfplan
  .\scripts\inspect-staging-workload-and-cost.ps1 -Action Measure `
    -StartTime <ISO-8601> -EndTime <ISO-8601> `
    -WorkloadProfile Phase0 `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/APPLIED_PLAN.tfplan

Status proves the $Environment runtime boundary and reports aggregate month-to-date Cost Explorer,
budget, and CUR 2.0 Data Export availability. Measure accepts only a workload result's ISO timestamps and
returns aggregate API Gateway, Lambda, empty ECS application boundary, RDS, queue, alarm, log, and
no-drift evidence. RuntimePlanPath is an already applied saved plan used only to recover the exact
non-secret immutable artifact inputs for fresh read-only steady-state verification.

WorkloadProfile selects the fixed aggregate request floor: Phase0 requires 552 requests and 100
expected 4xx responses, D1Read requires 254 requests and 50 expected 401 responses,
D1SavedJob requires 10 requests and one expected 409 response, D1Match requires two reads with no
expected 4xx response, and D2Public requires 40 requests with 20 expected fail-closed unauthenticated
responses. D2Public also selects the exact Gateway plus D2 Lambda, Trust-queue, and sixteen-alarm
boundary.

D2PublicDevelopment, D2AuthenticatedIntake and D2Processing additionally require the exact
aggregate-only runner JSON via WorkloadResultPath and its lowercase WorkloadResultSha256.
StartTime/EndTime must equal that result. These development-only profiles corroborate observed
metrics, not exact-owner request attribution, publication or throughput capacity. Processing
allows transient queue activity and checks two complete post-run minutes for approximate drain.
Run only after that interval and metric publication; this inspector does not wait or run workloads.
Missing required metric data is inconclusive, never a manufactured zero. D2Public retains its
historical signed-policy 40-request boundary; its floor is not lowered implicitly.

Both actions are read-only. No account identifier, endpoint, resource ARN, trace, log message,
identity, token, preference, operation identifier, or raw provider record is printed.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 $Environment environment is restricted to us-east-2."
}
if ($WorkloadProfile -clike "D2*" -and $Environment -cne "development") {
  throw "The D2 public-boundary workload is restricted to development."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformDataDirectory = Join-Path $terraformDirectory ".terraform\workload-inspection-data"
$allowedVariableNames = @(
  "migration_image", "high_availability", "staging_runtime_mode",
  "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "deploy_applications",
  "deploy_gateway_lambda", "gateway_lambda_artifact_s3_key",
  "gateway_lambda_artifact_s3_object_version", "gateway_lambda_artifact_sha256",
  "gateway_lambda_artifact_base64sha256", "gateway_lambda_extension_layer_arn",
  "gateway_lambda_reserved_concurrency", "deploy_serverless_outbox", "outbox_starts_paused",
  "workflow_ingress_artifact_s3_key", "workflow_ingress_artifact_s3_object_version",
  "workflow_ingress_artifact_sha256", "workflow_ingress_artifact_base64sha256",
  "workflow_ingress_lambda_extension_layer_arn", "deploy_profile_readiness_durable",
  "profile_readiness_durable_artifact_s3_key",
  "profile_readiness_durable_artifact_s3_object_version",
  "profile_readiness_durable_artifact_sha256",
  "profile_readiness_durable_artifact_base64sha256",
  "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version",
  "profile_readiness_activity_artifact_sha256",
  "profile_readiness_activity_artifact_base64sha256",
  "profile_readiness_lambda_extension_layer_arn",
  "profile_readiness_execution_timeout_seconds", "profile_readiness_retention_days",
  "serverless_runtime_enabled", "deploy_document_intake",
  "candidate_document_cors_allowed_origins", "document_processing_deployment_stage",
  "document_scan_mapping_enabled", "document_scan_event_rule_enabled",
  "document_security_health_rules_enabled", "document_parser_artifact_s3_key",
  "document_parser_artifact_s3_object_version", "document_parser_artifact_sha256",
  "document_parser_artifact_base64sha256", "document_parser_version",
  "document_parser_invocation_qualified_arn", "document_processor_artifact_s3_key",
  "document_processor_artifact_s3_object_version", "document_processor_artifact_sha256",
  "document_processor_artifact_base64sha256", "document_processor_extension_layer_arn",
  "deploy_ingestion_runtime", "ingestion_runtime_enabled",
  "ingestion_synthetic_source_enabled", "ingestion_synthetic_seed",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress",
  "ingestion_provider_sources", "ingestion_execution_timeout_seconds",
  "ingestion_retention_days", "ingestion_lambda_extension_layer_arn",
  "ingestion_durable_artifact_s3_key", "ingestion_durable_artifact_s3_object_version",
  "ingestion_durable_artifact_sha256", "ingestion_durable_artifact_base64sha256",
  "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
  "ingestion_runtime_artifact_sha256", "ingestion_runtime_artifact_base64sha256",
  "deploy_public_job_reader", "public_job_database_boundary_version",
  "public_job_cluster_residual_accepted", "public_job_route_activation_allowed",
  "public_job_route_throttling_rate_limit", "public_job_route_throttling_burst_limit",
  "public_job_projection_artifact_s3_key", "public_job_projection_artifact_s3_object_version",
  "public_job_projection_artifact_sha256", "public_job_projection_artifact_base64sha256",
  "public_job_lambda_artifact_s3_key", "public_job_lambda_artifact_s3_object_version",
  "public_job_lambda_artifact_sha256", "public_job_lambda_artifact_base64sha256",
  "database_backup_retention_days",
  "candidate_rights_enabled", "candidate_rights_policy_version", "candidate_deletion_restore_role_enabled",
  "candidate_rights_policy_sha256", "candidate_rights_export_lifetime_seconds",
  "candidate_rights_export_lifecycle_days", "candidate_rights_download_grant_seconds",
  "candidate_rights_backup_retention_days", "candidate_rights_recent_auth_max_age_seconds",
  "candidate_rights_owner_inventory", "candidate_rights_subprocessor_inventory",
  "candidate_rights_id_token_audience", "candidate_rights_auth0_authorized_owner",
  "candidate_rights_auth0_secret_provisioned", "d2_community_runtime"
)
$applicationLogGroup = "/ai-job-apply/$Environment/application"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([string[]]$CommandArguments)

  $raw = & aws @CommandArguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' operation failed. Refresh the $Environment SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][string]$Uri)
  try { return [int](Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 20).StatusCode }
  catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw "The $Environment public API could not be reached."
  }
}

function Assert-CallerAndTerraform {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary $Environment IAM Identity Center session; long-lived callers are rejected."
  }
  Assert-DeploymentTerraformCli
  return $identity
}

function Assert-WorkloadSteadyStateInputs {
  param([Parameter(Mandatory)][object]$Plan)

  if ($null -eq $Plan.variables -or $Plan.variables -isnot [pscustomobject] -or
      $Plan.terraform_version -cnotin @("1.9.8", (Get-DeploymentTerraformVersion))) {
    throw "The runtime plan has an invalid input or reader-version boundary."
  }
  $properties = @($Plan.variables.PSObject.Properties)
  if (@($properties | Where-Object { $_.Name -cnotin $allowedVariableNames }).Count -ne 0) {
    throw "The applied plan contains an unapproved runtime input."
  }
  $pause = @($properties | Where-Object Name -CEQ "outbox_starts_paused")
  if ($pause.Count -eq 0) {
    # Only the explicitly supported historical reader may recover a pre-input plan.
    # The current root default is false; no value is injected into the historical evidence.
    if ($Plan.terraform_version -cne "1.9.8") {
      throw "The current runtime plan must retain the outbox pause input."
    }
    return
  }
  $binding = $pause[0].Value
  if ($binding -isnot [pscustomobject] -or
      (@($binding.PSObject.Properties.Name) -join ",") -cne "value") {
    throw "The runtime plan has an invalid outbox pause binding."
  }
  $value = $binding.value
  if (-not (($value -is [bool] -and $value -eq $false) -or
            ($value -is [string] -and $value -ceq "false"))) {
    throw "Steady-state inspection requires outbox_starts_paused=false."
  }
}

function Read-WorkloadRuntimePlan {
  if (
    $ExpectedAccountId -notmatch "^[0-9]{12}$" -or
    [string]::IsNullOrWhiteSpace($StateBucket) -or
    [string]::IsNullOrWhiteSpace($RuntimePlanPath)
  ) { throw "Runtime verification requires the exact $Environment account, state bucket, and applied plan." }
  $absolutePlanPath = if ([IO.Path]::IsPathRooted($RuntimePlanPath)) { $RuntimePlanPath }
    else { Join-Path $terraformDirectory $RuntimePlanPath }
  $planPath = [IO.Path]::GetFullPath($absolutePlanPath)
  $allowedPlanRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform")) + [IO.Path]::DirectorySeparatorChar
  if (-not $planPath.StartsWith($allowedPlanRoot, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $planPath -PathType Leaf)) {
    throw "RuntimePlanPath must be an existing ignored plan below the selected environment .terraform directory."
  }

  $savedTerraformDataDirectory = $env:TF_DATA_DIR
  try {
    $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
    $env:TF_DATA_DIR = $terraformDataDirectory
    $plan = Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformDirectory -AllowHistorical
    if ($null -eq $plan.variables) {
      throw "The applied runtime plan could not be inspected."
    }
  } finally {
    $env:TF_DATA_DIR = $savedTerraformDataDirectory
  }
  Assert-WorkloadSteadyStateInputs $plan
  return $plan
}

function Get-RuntimeStatus {
  param([Parameter(Mandatory)][object]$Plan)

  Assert-WorkloadSteadyStateInputs $Plan
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if ([string]$identity.Account -cne $ExpectedAccountId) {
    throw "The AWS caller does not match the exact $Environment account."
  }
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json")
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
    $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
    $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  })
  if ($rules.Count -ne 1) { throw "The state bucket does not expose one KMS default." }
  $kmsKeyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($kmsKeyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the selected account and region."
  }

  $variableProperties = @($Plan.variables.PSObject.Properties)
  $allowedPlanRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform")) + [IO.Path]::DirectorySeparatorChar

  $saved = @{}
  $names = New-Object Collections.Generic.List[string]
  $temporaryPlan = Join-Path $allowedPlanRoot "workload-inspection-$([Guid]::NewGuid().ToString('N')).tfplan"
  try {
    $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
    $saved["TF_DATA_DIR"] = $env:TF_DATA_DIR
    $env:TF_DATA_DIR = $terraformDataDirectory
    foreach ($property in $variableProperties) {
      $environmentName = "TF_VAR_$($property.Name)"
      $saved[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, "Process")
      $value = $property.Value.value
      if ($null -eq $value) {
        Remove-Item -LiteralPath "Env:$environmentName" -ErrorAction SilentlyContinue
      } else {
        $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
          elseif ($value -is [string]) { $value }
          else { ConvertTo-Json -InputObject $value -Compress -Depth 20 }
        [Environment]::SetEnvironmentVariable($environmentName, [string]$serialized, "Process")
      }
      $names.Add($environmentName)
    }
    $runtimeSetting = @($variableProperties | Where-Object Name -eq "serverless_runtime_enabled")
    if ($runtimeSetting.Count -ne 1 -or -not [bool]$runtimeSetting[0].Value.value) {
      throw "The applied plan does not describe the enabled steady-state runtime."
    }

    & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
      "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
      "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsKeyArn" "-backend-config=encrypt=true" "-backend-config=use_lockfile=true" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The encrypted backend could not be initialized." }
    Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $terraformDataDirectory `
      -ExpectedBucket $StateBucket -ExpectedKey "platform.tfstate" -ExpectedRegion $Region -ExpectedKmsKeyArn $kmsKeyArn
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m -detailed-exitcode `
      "-out=$temporaryPlan" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The $Environment runtime is not zero drift." }

    $clusterArn = (& terraform "-chdir=$terraformDirectory" output -raw ecs_cluster_arn 2>$null).Trim()
    $mappingId = (& terraform "-chdir=$terraformDirectory" output -raw outbox_starter_event_source_mapping_uuid 2>$null).Trim()
    $reconcilerArn = (& terraform "-chdir=$terraformDirectory" output -raw outbox_reconciler_rule_arn 2>$null).Trim()
    $terminalArn = (& terraform "-chdir=$terraformDirectory" output -raw profile_readiness_terminal_rule_arn 2>$null).Trim()
    $gatewayName = (& terraform "-chdir=$terraformDirectory" output -raw gateway_lambda_function_name 2>$null).Trim()
    $gatewayUrl = (& terraform "-chdir=$terraformDirectory" output -raw gateway_url 2>$null).TrimEnd("/")
    if ($LASTEXITCODE -ne 0 -or -not $clusterArn -or -not $mappingId -or -not $reconcilerArn -or
        -not $terminalArn -or -not $gatewayName -or -not $gatewayUrl.StartsWith("https://")) {
      throw "The steady-state outputs are incomplete."
    }

    $services = Invoke-AwsJson @("ecs", "list-services", "--cluster", $clusterArn, "--output", "json")
    $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $clusterArn, "--desired-status", "RUNNING", "--output", "json")
    if (@($services.serviceArns).Count -ne 0 -or @($tasks.taskArns).Count -ne 0) {
      throw "The ECS application boundary is not empty."
    }
    $gateway = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $gatewayName, "--qualifier", $Environment, "--output", "json")
    if ([string]$gateway.Environment.Variables.OUTBOX_DISPATCH_TARGET -cne "lambda_durable") {
      throw "The gateway dispatch target is not Lambda durable."
    }
    $mapping = Invoke-AwsJson @("lambda", "get-event-source-mapping", "--uuid", $mappingId, "--output", "json")
    $rulesEnabled = $true
    foreach ($arn in @($reconcilerArn, $terminalArn)) {
      $name = $arn.Substring($arn.LastIndexOf("/") + 1)
      $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $name, "--output", "json")
      if ([string]$rule.State -cne "ENABLED") { $rulesEnabled = $false }
    }
    if ([string]$mapping.State -cne "Enabled" -or -not $rulesEnabled) {
      throw "The durable workflow triggers are not enabled."
    }
    if ((Get-HttpStatus "$gatewayUrl/health/live") -ne 200 -or
        (Get-HttpStatus "$gatewayUrl/health/ready") -ne 200 -or
        (Get-HttpStatus "$gatewayUrl/v1/me") -ne 401) {
      throw "The public API did not pass the expected 200/200/401 boundary."
    }
    return [pscustomobject]@{
      NoDrift = $true
      EcsRuntimeIdle = $true
      TriggersEnabled = $true
      DispatchTarget = "lambda_durable"
      AwsMutation = $false
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPlan) { Remove-Item -LiteralPath $temporaryPlan -Force }
    foreach ($name in $names) {
      [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process")
    }
    $env:TF_DATA_DIR = $saved["TF_DATA_DIR"]
  }
}

function Get-Collection {
  param(
    [object]$Object,
    [string]$Property
  )

  if ($null -eq $Object -or $null -eq $Object.$Property) {
    return @()
  }
  return @($Object.$Property)
}

function Get-MonthToDateCost {
  $now = [DateTime]::UtcNow
  $start = [DateTime]::new($now.Year, $now.Month, 1, 0, 0, 0, [DateTimeKind]::Utc)
  $end = $start.AddMonths(1)
  $cost = Invoke-AwsJson @(
    "ce",
    "get-cost-and-usage",
    "--time-period",
    "Start=$($start.ToString('yyyy-MM-dd')),End=$($end.ToString('yyyy-MM-dd'))",
    "--granularity",
    "MONTHLY",
    "--metrics",
    "UnblendedCost",
    "--group-by",
    "Type=DIMENSION,Key=SERVICE",
    "--output",
    "json"
  )
  $periods = Get-Collection $cost "ResultsByTime"
  $groups = if ($periods.Count -eq 1) { Get-Collection $periods[0] "Groups" } else { @() }
  [decimal]$total = 0
  $nonzeroServices = 0
  foreach ($group in $groups) {
    [decimal]$amount = [decimal]$group.Metrics.UnblendedCost.Amount
    $total += $amount
    if ($amount -ne 0) {
      $nonzeroServices += 1
    }
  }
  return [pscustomobject]@{
    AmountUsd       = [Math]::Round($total, 4)
    NonzeroServices = $nonzeroServices
    Estimated       = if ($periods.Count -eq 1) { [bool]$periods[0].Estimated } else { $true }
  }
}

function Get-BillingControlCounts {
  param([string]$AccountId)

  $budgets = Invoke-AwsJson @(
    "budgets",
    "describe-budgets",
    "--account-id",
    $AccountId,
    "--max-results",
    "100",
    "--output",
    "json"
  )
  $exports = Invoke-AwsJson @(
    "bcm-data-exports",
    "list-exports",
    "--region",
    "us-east-1",
    "--max-results",
    "100",
    "--output",
    "json"
  )
  return [pscustomobject]@{
    Budgets = (Get-Collection $budgets "Budgets").Count
    Exports = (Get-Collection $exports "Exports").Count
  }
}

function Assert-D2AggregateFields {
  param([object]$Value, [string[]]$Names)
  if ($Value -isnot [pscustomobject] -or
      ((@($Value.PSObject.Properties.Name) | Sort-Object) -join ",") -cne (($Names | Sort-Object) -join ",")) {
    throw "The workload aggregate has an unexpected shape."
  }
}

function Assert-D2AggregateCount {
  param([object]$Value, [long]$Minimum, [long]$Maximum)
  if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -lt $Minimum -or $Value -gt $Maximum) {
    throw "The workload aggregate has an invalid numeric count."
  }
}

function Assert-D2AggregateFlag {
  param([object]$Value, [bool]$Expected)
  if ($Value -isnot [bool] -or $Value -ne $Expected) {
    throw "The workload aggregate has an invalid disposition."
  }
}

function ConvertTo-D2ResultTimestamp {
  param([object]$Value)
  $instant = [DateTimeOffset]::MinValue
  if ($Value -isnot [string] -or
      -not [DateTimeOffset]::TryParseExact($Value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$instant)) {
    throw "The workload aggregate requires its original canonical UTC timestamps."
  }
  return $instant.UtcDateTime
}

function Assert-D2WorkloadAggregate {
  param(
    [object]$Result, [object]$Configuration, [string]$Profile,
    [string]$ExpectedStart, [string]$ExpectedEnd, [DateTime]$Now = [DateTime]::UtcNow
  )

  if ($Profile -cnotin @("D2PublicDevelopment", "D2AuthenticatedIntake", "D2Processing")) {
    throw "The result-bound workload profile is invalid."
  }
  $public = $Profile -ceq "D2PublicDevelopment"
  $processing = $Profile -ceq "D2Processing"
  $common = @("profile", "startedAt", "endedAt", "durationMs", "serverFailures")
  $names = if ($public) {
    $common + @("policyRequests", "capabilityMode", "policyChecksSkipped", "authenticatedThroughputValidated",
      "unauthorizedContributionRequests", "unauthorizedResponses", "throttledResponses",
      "unexpectedResponses", "unauthorizedLatency")
  } else {
    $common + @("passed", "requests", "concurrency", "acknowledgedContributions", "consentGrants",
      "ownerReads", "idempotentReplays", "expectedConflicts", "ambiguousWrites", "cleanupAttempted",
      "cleanupSucceeded", "cleanupCancellations", "cleanupWithdrawals", "processingToReviewObserved",
      "processingPolls", "cleanupPolls", "cleanupRevocations", "recoveryRequired", "latency",
      "processingAcceptance", "moderationAcceptance", "publicationAcceptance", "capacityAcceptance")
  }
  Assert-D2AggregateFields $Result $names
  $expectedProfile = if ($public) { "d2_deployed_unauthenticated_contribution_boundary_v1" }
    elseif ($processing) { "d2_deployed_disposable_processing_to_review_v1" }
    else { "d2_deployed_disposable_authenticated_intake_v1" }
  if ($Result.profile -isnot [string] -or $Result.profile -cne $expectedProfile) {
    throw "The workload result does not match the selected profile."
  }
  $start = ConvertTo-D2ResultTimestamp $Result.startedAt
  $end = ConvertTo-D2ResultTimestamp $Result.endedAt
  $maximumMilliseconds = if ($processing) { 1200000 } elseif ($public) { 900000 } else { 120000 }
  Assert-D2AggregateCount $Result.durationMs 1 $maximumMilliseconds
  if ($ExpectedStart -cne $Result.startedAt -or $ExpectedEnd -cne $Result.endedAt -or
      $end -le $start -or $end -gt $Now -or ($end - $start).TotalMilliseconds -gt $maximumMilliseconds -or
      [Math]::Abs(($end - $start).TotalMilliseconds - $Result.durationMs) -gt 1000) {
    throw "The workload result and its exact bounded observation window disagree."
  }
  Assert-D2AggregateCount $Result.serverFailures 0 0

  if ($Configuration -isnot [pscustomobject]) { throw "The D2 runtime mode is unavailable." }
  foreach ($name in @("deploy", "enabled", "maintenance_mode", "development_contributions_enabled")) {
    if ($Configuration.PSObject.Properties.Name -cnotcontains $name) { throw "The D2 runtime mode is incomplete." }
  }
  Assert-D2AggregateFlag $Configuration.deploy $true
  Assert-D2AggregateFlag $Configuration.enabled $true
  Assert-D2AggregateFlag $Configuration.maintenance_mode $false
  if ($Configuration.development_contributions_enabled -isnot [bool]) { throw "The D2 runtime mode is invalid." }
  $developmentMode = $Configuration.development_contributions_enabled
  if ($public -and -not $developmentMode) { throw "The development public probe requires the matching runtime mode." }
  if (-not $public -and -not $processing -and $developmentMode) {
    throw "The paused-intake runner does not support persistent development processing."
  }
  if (-not $public -and -not $developmentMode) {
    if ($Configuration.PSObject.Properties.Name -cnotcontains "signed_policy_json" -or
        $Configuration.signed_policy_json -isnot [string]) { throw "The signed runtime mode is unavailable." }
    try { $policy = ConvertFrom-DeploymentTerraformJson $Configuration.signed_policy_json }
    catch { throw "The signed runtime mode is unreadable." }
    if ($policy -isnot [pscustomobject] -or $policy.payload -isnot [pscustomobject]) {
      throw "The signed runtime mode is unreadable."
    }
    # Observe the already-configured mode only. This does not approve, sign or renew a policy.
    Assert-D2AggregateFlag $policy.payload.intakeEnabled $true
    Assert-D2AggregateFlag $policy.payload.processingEnabled $processing
  }

  if ($public) {
    if ($Result.capabilityMode -isnot [string] -or $Result.capabilityMode -cne "development") { throw "The public probe mode is not explicit." }
    Assert-D2AggregateCount $Result.policyRequests 0 0
    Assert-D2AggregateFlag $Result.policyChecksSkipped $true
    Assert-D2AggregateFlag $Result.authenticatedThroughputValidated $false
    Assert-D2AggregateCount $Result.unauthorizedContributionRequests 20 20
    foreach ($name in @("unauthorizedResponses", "throttledResponses")) {
      Assert-D2AggregateCount $Result.$name 0 20
    }
    if ($Result.unauthorizedResponses + $Result.throttledResponses -ne 20) {
      throw "The public probe did not account for every denial."
    }
    Assert-D2AggregateCount $Result.unexpectedResponses 0 0
    $requests = 20
    $conflicts = 20
    $latency = $Result.unauthorizedLatency
  } else {
    foreach ($name in @("passed", "cleanupAttempted", "cleanupSucceeded")) {
      Assert-D2AggregateFlag $Result.$name $true
    }
    foreach ($name in @("recoveryRequired", "processingAcceptance", "moderationAcceptance",
        "publicationAcceptance", "capacityAcceptance")) { Assert-D2AggregateFlag $Result.$name $false }
    foreach ($name in @("concurrency", "acknowledgedContributions", "idempotentReplays", "expectedConflicts")) {
      Assert-D2AggregateCount $Result.$name 1 1
    }
    foreach ($name in @("consentGrants", "cleanupRevocations")) { Assert-D2AggregateCount $Result.$name 2 2 }
    Assert-D2AggregateCount $Result.ownerReads 1 10
    Assert-D2AggregateCount $Result.requests 12 $(if ($processing) { 192 } else { 36 })
    Assert-D2AggregateCount $Result.ambiguousWrites 0 ($Result.requests - 1)
    Assert-D2AggregateFlag $Result.processingToReviewObserved $processing
    Assert-D2AggregateCount $Result.cleanupCancellations $(if ($processing) { 0 } else { 1 }) $(if ($processing) { 0 } else { 1 })
    Assert-D2AggregateCount $Result.cleanupWithdrawals $(if ($processing) { 1 } else { 0 }) $(if ($processing) { 1 } else { 0 })
    Assert-D2AggregateCount $Result.processingPolls $(if ($processing) { 1 } else { 0 }) $(if ($processing) { 48 } else { 0 })
    Assert-D2AggregateCount $Result.cleanupPolls $(if ($processing) { 1 } else { 0 }) $(if ($processing) { 70 } else { 0 })
    $minimum = if ($processing) {
      9 + $Result.ownerReads + $Result.processingPolls + $Result.cleanupPolls + $(if ($developmentMode) { 0 } else { 1 })
    } else { 11 + $Result.ownerReads }
    if ($Result.requests -lt $minimum) { throw "The workload counters cannot describe the required lifecycle." }
    $requests = $Result.requests
    $conflicts = $Result.expectedConflicts
    $latency = $Result.latency
  }
  Assert-D2AggregateFields $latency @("p50Ms", "p95Ms", "maxMs")
  foreach ($name in @("p50Ms", "p95Ms", "maxMs")) { Assert-D2AggregateCount $latency.$name 0 $Result.durationMs }
  if ($latency.p50Ms -gt $latency.p95Ms -or $latency.p95Ms -gt $latency.maxMs) {
    throw "The workload latency summary is invalid."
  }
  $metricStart = [DateTime]::new($start.Year, $start.Month, $start.Day, $start.Hour, $start.Minute, 0, [DateTimeKind]::Utc)
  $metricEnd = [DateTime]::new($end.Year, $end.Month, $end.Day, $end.Hour, $end.Minute, 0, [DateTimeKind]::Utc)
  if ($metricEnd -lt $end) { $metricEnd = $metricEnd.AddMinutes(1) }
  $drainEnd = $metricEnd.AddMinutes(2)
  if ($drainEnd -gt $Now) { throw "The two-minute post-run observation interval has not completed; no requests were made." }
  return [pscustomobject]@{
    ResultProfile = $expectedProfile; Start = $metricStart; End = $metricEnd
    RunnerStart = $start; RunnerEnd = $end; DrainStart = $metricEnd; DrainEnd = $drainEnd
    MinimumRequests = $requests; MinimumExpected4xx = $conflicts
    Processing = $processing; Public = $public; Authenticated = -not $public
  }
}

function Read-D2WorkloadEvidence {
  param([object]$Plan)
  if ($WorkloadProfile -ilike "D2*" -and
      $WorkloadProfile -cnotin @("D2Public", "D2PublicDevelopment", "D2AuthenticatedIntake", "D2Processing")) {
    throw "The D2 workload profile requires its exact canonical spelling."
  }
  $boundProfile = $WorkloadProfile -cin @("D2PublicDevelopment", "D2AuthenticatedIntake", "D2Processing")
  if (-not $boundProfile) {
    if ($WorkloadResultPath -or $WorkloadResultSha256) { throw "This historical profile does not consume a D2 runner result." }
    return $null
  }
  if ($Action -cne "Measure" -or $Environment -cne "development" -or
      $WorkloadResultSha256 -cnotmatch "^[a-f0-9]{64}$" -or -not $WorkloadResultPath) {
    throw "D2 corroboration requires Measure and one checksum-reviewed aggregate result."
  }
  try {
    $path = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($WorkloadResultPath)) {
      $WorkloadResultPath
    } else { Join-Path $repositoryRoot $WorkloadResultPath }))
    $roots = @((Join-Path $repositoryRoot ".tmp"), (Join-Path $terraformDirectory ".terraform"))
    $root = @($roots | Where-Object {
      $path.StartsWith(([IO.Path]::GetFullPath($_).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar),
        [StringComparison]::OrdinalIgnoreCase)
    })
    if ($root.Count -ne 1) { throw "outside ignored roots" }
    $entry = Get-Item -LiteralPath $path -Force
    if ($entry.PSIsContainer -or $entry.Length -lt 2 -or $entry.Length -gt 16384) { throw "invalid aggregate file" }
    $ancestor = $entry
    while ($null -ne $ancestor -and $ancestor.FullName.Length -ge $root[0].Length) {
      if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "linked aggregate path" }
      $ancestor = if ($ancestor -is [IO.FileInfo]) { $ancestor.Directory } else { $ancestor.Parent }
    }
    $bytes = [IO.File]::ReadAllBytes($path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($hash -cne $WorkloadResultSha256) { throw "aggregate checksum mismatch" }
    $json = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes).TrimStart([char]0xfeff)
    $result = ConvertFrom-DeploymentTerraformJson $json
    # These fixed runner aggregates contain only ASCII member names, canonical timestamps and
    # fixed profile strings. The real runner emits no escapes; reject escaped/duplicate keys
    # instead of permitting ConvertFrom-Json's last-property-wins behavior.
    $members = @([regex]::Matches($json, '"([A-Za-z][A-Za-z0-9]*)"\s*:') | ForEach-Object { $_.Groups[1].Value })
    if ($json.Contains('\') -or $members.Count -ne @($members | Select-Object -Unique).Count) {
      throw "ambiguous aggregate members"
    }
  } catch { throw "The checksum-reviewed ignored workload aggregate is unavailable or invalid." }
  $configuration = $Plan.variables.d2_community_runtime.value
  return Assert-D2WorkloadAggregate $result $configuration $WorkloadProfile $StartTime $EndTime
}

function ConvertTo-D2MetricTimestamp {
  param([object]$Value)
  if ($Value -is [DateTime]) {
    if ($Value.Kind -eq [DateTimeKind]::Unspecified) { throw "A metric timestamp must include its timezone." }
    return $Value.ToUniversalTime()
  }
  if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime }
  $instant = [DateTimeOffset]::MinValue
  if ($Value -isnot [string] -or
      $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$' -or
      -not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None, [ref]$instant)) {
    throw "A metric timestamp is invalid."
  }
  return $instant.UtcDateTime
}

function Assert-D2MetricDatapoints {
  param([object[]]$Points, [DateTime]$Start, [DateTime]$End)
  $seen = @{}
  foreach ($point in $Points) {
    $instant = ConvertTo-D2MetricTimestamp $point.Timestamp
    if ($instant -lt $Start -or $instant -ge $End -or $instant.Ticks % [TimeSpan]::TicksPerMinute -ne 0 -or
        $seen.ContainsKey($instant.Ticks)) { throw "Metric datapoints are duplicated or outside the exact window." }
    $seen[$instant.Ticks] = $true
    foreach ($name in @("Sum", "Average", "Maximum", "SampleCount")) {
      $value = $point.$name
      if (($value -isnot [int] -and $value -isnot [long] -and $value -isnot [double] -and $value -isnot [decimal]) -or
          [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or $value -lt 0) {
        throw "A metric datapoint has an invalid statistic."
      }
    }
    if ($point.SampleCount -le 0) { throw "A metric datapoint has no samples." }
    if ($point.Average -gt $point.Maximum -or $point.Sum -lt $point.Maximum) {
      throw "A metric datapoint has inconsistent nonnegative statistics."
    }
  }
}

function Assert-D2MetricCoverage {
  param([object]$Metric, [string[]]$ExpectedTimestamps, [object]$SampleReference = $null)
  if ($Metric.Datapoints -eq 0 -or @($ExpectedTimestamps | Where-Object { $_ -cnotin $Metric.Timestamps }).Count -ne 0) {
    throw "Required metric coverage is incomplete; missing data is unknown, not zero."
  }
  if ($null -ne $SampleReference) {
    foreach ($timestamp in $ExpectedTimestamps) {
      if ($Metric.SampleCounts[$timestamp] -ne $SampleReference.SampleCounts[$timestamp]) {
        throw "Required same-sample metric coverage is incomplete; partial data is unknown."
      }
    }
  }
}

function Get-MetricAggregate {
  param(
    [string]$Namespace,
    [string]$MetricName,
    [string[]]$Dimensions,
    [DateTime]$WindowStart,
    [DateTime]$WindowEnd,
    [switch]$InspectCoverage,
    [switch]$RequireCoverage
  )

  $arguments = @(
    "cloudwatch",
    "get-metric-statistics",
    "--namespace",
    $Namespace,
    "--metric-name",
    $MetricName,
    "--start-time",
    $WindowStart.ToString("o"),
    "--end-time",
    $WindowEnd.ToString("o"),
    "--period",
    "60",
    "--statistics",
    "Sum",
    "Average",
    "Maximum",
    "SampleCount"
  )
  if ($Dimensions.Count -gt 0) {
    $arguments += "--dimensions"
    $arguments += $Dimensions
  }
  $arguments += @("--output", "json")
  $metric = Invoke-AwsJson $arguments
  $points = @(Get-Collection $metric "Datapoints")
  if ($InspectCoverage -or $RequireCoverage) {
    Assert-D2MetricDatapoints $points $WindowStart $WindowEnd
    if ($RequireCoverage -and $points.Count -eq 0) {
      throw "Required metric coverage is unavailable; missing data is unknown, not zero."
    }
  }
  [decimal]$sum = 0
  [decimal]$weighted = 0
  [decimal]$samples = 0
  [decimal]$maximum = 0
  $sampleCounts = @{}
  foreach ($point in $points) {
    $sum += [decimal]$point.Sum
    $weighted += [decimal]$point.Average * [decimal]$point.SampleCount
    $samples += [decimal]$point.SampleCount
    $maximum = [Math]::Max($maximum, [decimal]$point.Maximum)
    if ($InspectCoverage -or $RequireCoverage) {
      $sampleCounts[(ConvertTo-D2MetricTimestamp $point.Timestamp).ToString("o")] = [decimal]$point.SampleCount
    }
  }
  return [pscustomobject]@{
    Sum     = if ($InspectCoverage -and $points.Count -eq 0) { $null } else { [Math]::Round($sum, 2) }
    Average = if ($samples -gt 0) { [Math]::Round($weighted / $samples, 2) } elseif ($InspectCoverage) { $null } else { 0 }
    Maximum = if ($InspectCoverage -and $points.Count -eq 0) { $null } else { [Math]::Round($maximum, 2) }
    Samples = [int]$samples
    Datapoints = $points.Count
    SampleCounts = $sampleCounts
    Timestamps = if ($InspectCoverage -or $RequireCoverage) {
      @($points | ForEach-Object { (ConvertTo-D2MetricTimestamp $_.Timestamp).ToString("o") } | Sort-Object)
    } else { @() }
  }
}

function Get-LogAggregate {
  param(
    [DateTime]$WindowStart,
    [DateTime]$WindowEnd
  )

  $events = Get-Collection (
    Invoke-AwsJson @(
      "logs",
      "filter-log-events",
      "--log-group-name",
      $applicationLogGroup,
      "--start-time",
      ([DateTimeOffset]$WindowStart).ToUnixTimeMilliseconds().ToString(),
      "--end-time",
      ([DateTimeOffset]$WindowEnd).ToUnixTimeMilliseconds().ToString(),
      "--output",
      "json"
    )
  ) "events"
  $errorMatches = 0
  $forbiddenMatches = 0
  foreach ($event in $events) {
    $message = [string]$event.message
    $structured = $null
    try { $structured = $message | ConvertFrom-Json } catch { $structured = $null }
    $level = if ($null -ne $structured -and $structured.PSObject.Properties.Name -contains "level") {
      [int]$structured.level
    } else { 0 }
    $operationalMessage = if (
      $null -ne $structured -and $structured.PSObject.Properties.Name -contains "msg"
    ) { [string]$structured.msg } else { $message }
    if ($level -ge 40 -or $operationalMessage -match "(?i)error|exception|failed") {
      $errorMatches += 1
    }
    if (
      $message -match "(?i)authorization|bearer\s+|eyJ[A-Za-z0-9_-]+\.|postgres(ql)?://|api[_-]?key|client_secret|session_secret|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    ) {
      $forbiddenMatches += 1
    }
  }
  return [pscustomobject]@{
    Events           = $events.Count
    ErrorMatches     = $errorMatches
    ForbiddenMatches = $forbiddenMatches
  }
}

function Convert-WorkloadWindow {
  if (-not $StartTime -or -not $EndTime) {
    throw "Measure requires the workload result's StartTime and EndTime."
  }
  $start = [DateTime]::MinValue
  $end = [DateTime]::MinValue
  if (
    -not [DateTime]::TryParse(
      $StartTime,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$start
    ) -or
    -not [DateTime]::TryParse(
      $EndTime,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$end
    )
  ) {
    throw "Measure timestamps must be valid ISO-8601 values."
  }
  $start = $start.ToUniversalTime()
  $end = $end.ToUniversalTime()
  if ($end -le $start -or ($end - $start).TotalMinutes -gt 15 -or $end -gt [DateTime]::UtcNow.AddMinutes(1)) {
    throw "The workload window must be positive, no more than 15 minutes, and not in the future."
  }
  if ($WorkloadProfile -ne "Phase0") {
    $metricStart = [DateTime]::new(
      $start.Year, $start.Month, $start.Day, $start.Hour, $start.Minute, 0, [DateTimeKind]::Utc
    )
    $metricEnd = [DateTime]::new(
      $end.Year, $end.Month, $end.Day, $end.Hour, $end.Minute, 0, [DateTimeKind]::Utc
    )
    if ($metricEnd -lt $end) { $metricEnd = $metricEnd.AddMinutes(1) }
    return [pscustomobject]@{ Start = $metricStart; End = $metricEnd }
  }
  return [pscustomobject]@{
    Start = $start.AddMinutes(-1)
    End   = $end.AddMinutes(3)
  }
}

function Measure-D2WorkloadCorroboration {
  param([object]$Evidence, [string[]]$ApiDimensions, [object]$Runtime)
  $coverage = New-Object Collections.Generic.List[object]
  function Read-D2Metric {
    param([string]$Label, [string]$Namespace, [string]$Name, [string[]]$Dimensions,
      [DateTime]$Start, [DateTime]$End, [bool]$Required = $true)
    $metric = Get-MetricAggregate $Namespace $Name $Dimensions $Start $End -InspectCoverage -RequireCoverage:$Required
    $coverage.Add([pscustomobject]@{
      Signal = $Label; Required = $Required; Datapoints = $metric.Datapoints
      Availability = if ($metric.Datapoints -eq 0) { "unknown" } else { "observed" }
    })
    return $metric
  }
  function Get-MinuteTimestamps {
    param([DateTime]$Start, [DateTime]$End)
    for ($minute = $Start; $minute -lt $End; $minute = $minute.AddMinutes(1)) { $minute.ToString("o") }
  }
  $start = $Evidence.Start; $end = $Evidence.End
  $requests = Read-D2Metric "api_requests" "AWS/ApiGateway" "Count" $ApiDimensions $start $end
  $clientErrors = Read-D2Metric "api_4xx" "AWS/ApiGateway" "4xx" $ApiDimensions $start $end
  $serverErrors = Read-D2Metric "api_5xx" "AWS/ApiGateway" "5xx" $ApiDimensions $start $end
  $latency = Read-D2Metric "api_latency" "AWS/ApiGateway" "Latency" $ApiDimensions $start $end
  # The fixed profiles issue requests throughout their run, but first-call setup and final
  # result assembly may leave partial edge buckets empty. Require every wholly interior
  # minute, nonempty observed data and the runner's total floor; do not invent edge traffic.
  $fullRequestStart = $start; $fullRequestEnd = $end
  if ($fullRequestStart -lt $Evidence.RunnerStart) { $fullRequestStart = $fullRequestStart.AddMinutes(1) }
  if ($fullRequestEnd -gt $Evidence.RunnerEnd) { $fullRequestEnd = $fullRequestEnd.AddMinutes(-1) }
  Assert-D2MetricCoverage $requests @(Get-MinuteTimestamps $fullRequestStart $fullRequestEnd)
  if ($Evidence.Public) { Assert-D2MetricCoverage $clientErrors $requests.Timestamps }
  Assert-D2MetricCoverage $serverErrors $requests.Timestamps
  Assert-D2MetricCoverage $latency $requests.Timestamps
  if ($requests.Sum -lt $Evidence.MinimumRequests -or $clientErrors.Sum -lt $Evidence.MinimumExpected4xx -or
      $serverErrors.Sum -ne 0) { throw "The D2 API aggregates do not corroborate the successful workload." }

  [decimal]$observedLambdaErrors = 0; [decimal]$observedThrottles = 0
  $workerEnd = $Evidence.DrainEnd
  foreach ($role in @("gateway", "d2-community-scheduled", "d2-trust-signal")) {
    # An unauthenticated denial need not invoke any Lambda. Paused intake need not invoke either
    # worker. Absent optional data stays unknown; it is not evidence of a disabled/idle worker.
    $required = if ($role -ceq "gateway") { $Evidence.Authenticated } else { $Evidence.Processing }
    $dimensions = @("Name=FunctionName,Value=ai-job-apply-$Environment-$role")
    $functionEnd = if ($role -ceq "gateway") { $end } else { $workerEnd }
    $invocations = Read-D2Metric "$role-invocations" "AWS/Lambda" "Invocations" $dimensions $start $functionEnd $required
    # Native adverse series may be sparse. Reject every observed failure without inventing a
    # zero datum or requiring their timestamps to equal invocation-start minutes.
    $errors = Read-D2Metric "$role-errors" "AWS/Lambda" "Errors" $dimensions $start $functionEnd $false
    $throttles = Read-D2Metric "$role-throttles" "AWS/Lambda" "Throttles" $dimensions $start $functionEnd $false
    if ($required -and $invocations.Sum -le 0) { throw "An expected D2 runtime has no observed invocation." }
    if ($null -ne $errors.Sum) { $observedLambdaErrors += $errors.Sum }
    if ($null -ne $throttles.Sum) { $observedThrottles += $throttles.Sum }
  }
  if ($observedLambdaErrors -ne 0 -or $observedThrottles -ne 0) {
    throw "The D2 runtime has observed Lambda errors or throttles in its bounded observation window."
  }
  $database = @("Name=DBInstanceIdentifier,Value=ai-job-apply-$Environment")
  $databaseCpu = Read-D2Metric "database_cpu" "AWS/RDS" "CPUUtilization" $database $start $end
  $connections = Read-D2Metric "database_connections" "AWS/RDS" "DatabaseConnections" $database $start $end
  Assert-D2MetricCoverage $databaseCpu @(Get-MinuteTimestamps $start $end)
  Assert-D2MetricCoverage $connections @(Get-MinuteTimestamps $start $end)
  # Each reference and its failure fields share one actual EMF sample. Trust emits after
  # consume completes; scheduled recovery-only invocations emit no ordinary batch sample.
  # Observe completion through the drain interval, not by matching Lambda start minutes.
  foreach ($group in @(
      @{ Reference = "ScheduledBatchSucceeded"; Failures = @("JobsDead", "JobsDeliveryDead", "TrustDeliveryDead") },
      @{ Reference = "TrustSignalRecords"; Failures = @("TrustSignalFailed") })) {
    $reference = Read-D2Metric $group.Reference "AIJobApply/D2Community" $group.Reference @() $start $workerEnd $Evidence.Processing
    if ($Evidence.Processing -and $reference.Sum -le 0) { throw "An expected D2 worker has no observed completed batch sample." }
    foreach ($name in $group.Failures) {
      $metric = Read-D2Metric $name "AIJobApply/D2Community" $name @() $start $workerEnd $Evidence.Processing
      if ($null -ne $metric.Sum -and $metric.Sum -ne 0) { throw "The D2 observation window contains an application failure signal." }
      if ($reference.Datapoints -gt 0) { Assert-D2MetricCoverage $metric $reference.Timestamps $reference }
    }
  }
  # This signal is emitted only on failure, so its absence remains unknown rather than zero.
  $batchFailure = Read-D2Metric "ScheduledBatchFailed" "AIJobApply/D2Community" "ScheduledBatchFailed" @() $start $workerEnd $false
  if ($null -ne $batchFailure.Sum -and $batchFailure.Sum -ne 0) { throw "The D2 observation window contains a failed scheduled batch." }

  $queue = @("Name=QueueName,Value=ai-job-apply-$Environment-d2-trust-signals")
  $deadLetter = @("Name=QueueName,Value=ai-job-apply-$Environment-d2-trust-signals-dead-letter")
  $queueAge = Read-D2Metric "trust_queue_age" "AWS/SQS" "ApproximateAgeOfOldestMessage" $queue $start $end
  $queueVisible = Read-D2Metric "trust_queue_visible" "AWS/SQS" "ApproximateNumberOfMessagesVisible" $queue $start $end
  $workloadMinutes = @(Get-MinuteTimestamps $start $end)
  Assert-D2MetricCoverage $queueAge $workloadMinutes
  Assert-D2MetricCoverage $queueVisible $workloadMinutes
  # Transient queue activity is legitimate for active processing and unrelated shared-runtime
  # work. The exact runner cleanup and this later approximate settled observation are distinct.
  $drainMinutes = @(Get-MinuteTimestamps $Evidence.DrainStart $Evidence.DrainEnd)
  $deadLetterMinutes = @(Get-MinuteTimestamps $start $Evidence.DrainEnd)
  foreach ($name in @("ApproximateNumberOfMessagesVisible", "ApproximateNumberOfMessagesNotVisible",
      "ApproximateNumberOfMessagesDelayed")) {
    $drain = Read-D2Metric "trust_queue_drain-$name" "AWS/SQS" $name $queue $Evidence.DrainStart $Evidence.DrainEnd
    Assert-D2MetricCoverage $drain $drainMinutes
    if ($drain.Maximum -ne 0) { throw "The two-minute D2 approximate queue-drain observation is not empty." }
    $dead = Read-D2Metric "trust_dlq-$name" "AWS/SQS" $name $deadLetter $start $Evidence.DrainEnd
    Assert-D2MetricCoverage $dead $deadLetterMinutes
    if ($dead.Maximum -ne 0) { throw "The D2 workload/drain interval contains dead-letter messages." }
  }
  $alarmsExpected = @(
    "gateway-lambda-errors", "gateway-lambda-throttles", "gateway-lambda-duration",
    "d2-scheduled-errors", "d2-scheduled-throttles", "d2-scheduled-duration",
    "d2-trust-signal-errors", "d2-trust-signal-throttles", "d2-trust-signal-duration",
    "d2-scheduledbatchfailed", "d2-jobsdead", "d2-jobsdeliverydead", "d2-trustdeliverydead",
    "d2-trustsignalfailed", "d2-trust-signal-queue-age", "d2-trust-signal-dead-letter"
  ) | ForEach-Object { "ai-job-apply-$Environment-$_" }
  $alarms = Invoke-AwsJson (@("cloudwatch", "describe-alarms", "--alarm-names") +
    $alarmsExpected + @("--output", "json"))
  $actual = @(Get-Collection $alarms "MetricAlarms")
  if ($actual.Count -ne $alarmsExpected.Count -or
      ((@($actual.AlarmName) | Sort-Object) -join ",") -cne (($alarmsExpected | Sort-Object) -join ",") -or
      @($actual | Where-Object {
        $_.StateValue -cne "OK" -or $_.ActionsEnabled -isnot [bool] -or -not $_.ActionsEnabled -or
        @($_.AlarmActions).Count -ne 1 -or @($_.OKActions).Count -ne 1
      }).Count -ne 0) { throw "The exact D2/Gateway alarm boundary is not healthy." }
  $logs = Get-LogAggregate $start $end
  if ($logs.ErrorMatches -ne 0 -or $logs.ForbiddenMatches -ne 0) {
    throw "The workload window contains application error or forbidden log-pattern matches."
  }
  return [pscustomobject]@{
    Environment = $Environment; WorkloadProfile = $WorkloadProfile
    RunnerProfile = $Evidence.ResultProfile; RunnerAggregateSha256 = $WorkloadResultSha256
    RunnerStartedAt = $Evidence.RunnerStart.ToString("o"); RunnerEndedAt = $Evidence.RunnerEnd.ToString("o")
    MetricStartedAt = $start.ToString("o"); MetricEndedAt = $end.ToString("o")
    WorkerMetricStartedAt = $start.ToString("o"); WorkerMetricEndedAt = $workerEnd.ToString("o")
    QueueDrainStartedAt = $Evidence.DrainStart.ToString("o"); QueueDrainEndedAt = $Evidence.DrainEnd.ToString("o")
    AggregateCorroborated = $true; OwnerRequestAttribution = $false
    PublicationAcceptance = $false; CapacityAcceptance = $false; ProcessingAcceptance = $false
    ApiRequests = $requests.Sum; RunnerRequests = $Evidence.MinimumRequests
    Api4xx = $clientErrors.Sum; RunnerExpected4xx = $Evidence.MinimumExpected4xx; Api5xx = $serverErrors.Sum
    ApiLatencyAverageMs = $latency.Average; ApiLatencyMaximumMs = $latency.Maximum
    DatabaseCpuMaxPercent = $databaseCpu.Maximum; DatabaseConnectionsMax = $connections.Maximum
    ObservedLambdaErrors = $observedLambdaErrors; ObservedLambdaThrottles = $observedThrottles
    UnknownOptionalMetricSeries = @($coverage | Where-Object { -not $_.Required -and $_.Availability -ceq "unknown" }).Count
    MetricCoverage = @($coverage.ToArray()); MissingDataTreatedAsZero = $false
    EventQueueAgeMaxSeconds = $queueAge.Maximum; EventQueueVisibleMax = $queueVisible.Maximum
    FinalApproximateQueueDrained = $true; DeadLetterMessagesObserved = 0
    RuntimeAlarmsOk = $actual.Count; LogEvents = $logs.Events; LogErrorMatches = 0; ForbiddenLogMatches = 0
    EcsRuntimeIdle = $Runtime.EcsRuntimeIdle; TriggersEnabled = $Runtime.TriggersEnabled
    TerraformDrift = 0; AwsMutation = $false
  }
}

$runtimePlan = Read-WorkloadRuntimePlan
$d2Evidence = Read-D2WorkloadEvidence $runtimePlan
$identity = Assert-CallerAndTerraform
$runtime = Get-RuntimeStatus $runtimePlan

if ($Action -eq "Status") {
  $cost = Get-MonthToDateCost
  $billing = Get-BillingControlCounts ([string]$identity.Account)
  [pscustomobject]@{
    Environment                   = $Environment
    TemporaryCaller               = $true
    NoDrift                       = [bool]$runtime.NoDrift
    DispatchTarget                = [string]$runtime.DispatchTarget
    TriggersEnabled               = [bool]$runtime.TriggersEnabled
    EcsRuntimeIdle                = [bool]$runtime.EcsRuntimeIdle
    MonthToDateUnblendedCostUsd   = $cost.AmountUsd
    CostExplorerEstimated         = $cost.Estimated
    NonzeroCostServices           = $cost.NonzeroServices
    AwsBudgetCount                = $billing.Budgets
    Cur2DataExportCount           = $billing.Exports
  } | ConvertTo-Json
  exit 0
}

$window = if ($null -ne $d2Evidence) { $d2Evidence } else { Convert-WorkloadWindow }
$apis = Get-Collection (
  Invoke-AwsJson @("apigatewayv2", "get-apis", "--max-results", "100", "--output", "json")
) "Items"
$apiMatches = @($apis | Where-Object { [string]$_.Name -eq "ai-job-apply-$Environment-gateway" })
if ($apiMatches.Count -ne 1) { throw "The exact $Environment HTTP API could not be resolved." }
$apiId = [string]$apiMatches[0].ApiId

$apiDimensions = @("Name=ApiId,Value=$apiId")
if ($null -ne $d2Evidence) {
  Measure-D2WorkloadCorroboration $d2Evidence $apiDimensions $runtime | ConvertTo-Json -Depth 6
  exit 0
}
$databaseDimensions = @("Name=DBInstanceIdentifier,Value=ai-job-apply-$Environment")
$eventQueueName = if ($WorkloadProfile -ceq "D2Public") {
  "ai-job-apply-$Environment-d2-trust-signals"
} else { "ai-job-apply-$Environment-events" }
$deadLetterQueueName = if ($WorkloadProfile -ceq "D2Public") {
  "ai-job-apply-$Environment-d2-trust-signals-dead-letter"
} else { "ai-job-apply-$Environment-dead-letter" }
$eventQueueDimensions = @("Name=QueueName,Value=$eventQueueName")
$deadLetterDimensions = @("Name=QueueName,Value=$deadLetterQueueName")
$durableDeadLetterDimensions = @(
  "Name=QueueName,Value=ai-job-apply-$Environment-profile-readiness-dead-letter"
)

$requestCount = Get-MetricAggregate "AWS/ApiGateway" "Count" $apiDimensions $window.Start $window.End
$clientErrors = Get-MetricAggregate "AWS/ApiGateway" "4xx" $apiDimensions $window.Start $window.End
$serverErrors = Get-MetricAggregate "AWS/ApiGateway" "5xx" $apiDimensions $window.Start $window.End
$latency = Get-MetricAggregate "AWS/ApiGateway" "Latency" $apiDimensions $window.Start $window.End
$lambdaFunctionNames = if ($WorkloadProfile -ceq "D2Public") {
  @(
    "ai-job-apply-$Environment-gateway",
    "ai-job-apply-$Environment-d2-community-scheduled",
    "ai-job-apply-$Environment-d2-trust-signal"
  )
} else {
  @(
    "ai-job-apply-$Environment-gateway",
    "ai-job-apply-$Environment-outbox-starter",
    "ai-job-apply-$Environment-outbox-reconciler",
    "ai-job-apply-$Environment-profile-readiness-activity",
    "ai-job-apply-$Environment-profile-readiness-terminal",
    "ai-job-apply-$Environment-profile-readiness-durable"
  )
}
[decimal]$lambdaInvocations = 0
[decimal]$lambdaErrors = 0
[decimal]$lambdaThrottles = 0
[decimal]$lambdaDurationMaximum = 0
foreach ($functionName in $lambdaFunctionNames) {
  $dimensions = @("Name=FunctionName,Value=$functionName")
  $lambdaInvocations += (
    Get-MetricAggregate "AWS/Lambda" "Invocations" $dimensions $window.Start $window.End
  ).Sum
  $lambdaErrors += (
    Get-MetricAggregate "AWS/Lambda" "Errors" $dimensions $window.Start $window.End
  ).Sum
  $lambdaThrottles += (
    Get-MetricAggregate "AWS/Lambda" "Throttles" $dimensions $window.Start $window.End
  ).Sum
  $duration = Get-MetricAggregate "AWS/Lambda" "Duration" $dimensions $window.Start $window.End
  $lambdaDurationMaximum = [Math]::Max($lambdaDurationMaximum, [decimal]$duration.Maximum)
}
$databaseCpu = Get-MetricAggregate "AWS/RDS" "CPUUtilization" $databaseDimensions $window.Start $window.End
$connections = Get-MetricAggregate "AWS/RDS" "DatabaseConnections" $databaseDimensions $window.Start $window.End
$queueAge = Get-MetricAggregate "AWS/SQS" "ApproximateAgeOfOldestMessage" $eventQueueDimensions $window.Start $window.End
$queueVisible = Get-MetricAggregate `
  "AWS/SQS" "ApproximateNumberOfMessagesVisible" $eventQueueDimensions $window.Start $window.End
$deadLetters = Get-MetricAggregate "AWS/SQS" "ApproximateNumberOfMessagesVisible" $deadLetterDimensions $window.Start $window.End
$durableDeadLetters = Get-MetricAggregate `
  "AWS/SQS" "ApproximateNumberOfMessagesVisible" `
  $durableDeadLetterDimensions $window.Start $window.End
$logs = Get-LogAggregate $window.Start $window.End
$alarmNames = if ($WorkloadProfile -ceq "D2Public") {
  @(
    "ai-job-apply-$Environment-gateway-lambda-errors",
    "ai-job-apply-$Environment-gateway-lambda-throttles",
    "ai-job-apply-$Environment-gateway-lambda-duration",
    "ai-job-apply-$Environment-d2-scheduled-errors",
    "ai-job-apply-$Environment-d2-scheduled-throttles",
    "ai-job-apply-$Environment-d2-scheduled-duration",
    "ai-job-apply-$Environment-d2-trust-signal-errors",
    "ai-job-apply-$Environment-d2-trust-signal-throttles",
    "ai-job-apply-$Environment-d2-trust-signal-duration",
    "ai-job-apply-$Environment-d2-scheduledbatchfailed",
    "ai-job-apply-$Environment-d2-jobsdead",
    "ai-job-apply-$Environment-d2-jobsdeliverydead",
    "ai-job-apply-$Environment-d2-trustdeliverydead",
    "ai-job-apply-$Environment-d2-trustsignalfailed",
    "ai-job-apply-$Environment-d2-trust-signal-queue-age",
    "ai-job-apply-$Environment-d2-trust-signal-dead-letter"
  )
} else {
  @(
    "ai-job-apply-$Environment-outbox-reconciler-errors",
    "ai-job-apply-$Environment-outbox-starter-errors",
    "ai-job-apply-$Environment-outbox-starter-throttles",
    "ai-job-apply-$Environment-profile-readiness-activity-errors",
    "ai-job-apply-$Environment-profile-readiness-dead-letter",
    "ai-job-apply-$Environment-profile-readiness-durable-failed",
    "ai-job-apply-$Environment-profile-readiness-durable-timed-out",
    "ai-job-apply-$Environment-gateway-lambda-errors",
    "ai-job-apply-$Environment-gateway-lambda-throttles",
    "ai-job-apply-$Environment-gateway-lambda-duration"
  )
}
$alarms = Invoke-AwsJson (
  @("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json")
)
$healthyAlarms = @($alarms.MetricAlarms | Where-Object {
  [string]$_.StateValue -eq "OK" -and [bool]$_.ActionsEnabled -and
  @($_.AlarmActions).Count -eq 1 -and @($_.OKActions).Count -eq 1
}).Count
$serviceInventory = Invoke-AwsJson @(
  "ecs", "list-services", "--cluster", "ai-job-apply-$Environment", "--output", "json"
)
$taskInventory = Invoke-AwsJson @(
  "ecs", "list-tasks", "--cluster", "ai-job-apply-$Environment", "--desired-status", "RUNNING",
  "--output", "json"
)
$activeServices = @(Get-Collection $serviceInventory "serviceArns").Count
$runningTasks = @(Get-Collection $taskInventory "taskArns").Count

$minimumApiRequests = switch ($WorkloadProfile) {
  "D1Read" { 254 }
  "D1SavedJob" { 10 }
  "D1Match" { 2 }
  "D2Public" { 40 }
  default { 552 }
}
$minimumExpected4xx = switch ($WorkloadProfile) {
  "D1Read" { 50 }
  "D1SavedJob" { 1 }
  "D1Match" { 0 }
  "D2Public" { 20 }
  default { 100 }
}

$failedChecks = @()
if ([int]$requestCount.Sum -lt $minimumApiRequests) { $failedChecks += "api_request_floor" }
if ([int]$clientErrors.Sum -lt $minimumExpected4xx) { $failedChecks += "expected_4xx_floor" }
if ([int]$serverErrors.Sum -ne 0) { $failedChecks += "api_5xx" }
if ([int]$lambdaErrors -ne 0) { $failedChecks += "lambda_errors" }
if ([int]$lambdaThrottles -ne 0) { $failedChecks += "lambda_throttles" }
if ([decimal]$queueAge.Maximum -ne 0) { $failedChecks += "event_queue_age" }
if ([decimal]$queueVisible.Maximum -ne 0) { $failedChecks += "event_queue_visible" }
if ([decimal]$deadLetters.Maximum -ne 0) { $failedChecks += "event_dead_letters" }
if ([decimal]$durableDeadLetters.Maximum -ne 0) { $failedChecks += "durable_dead_letters" }
if ($logs.ErrorMatches -ne 0) { $failedChecks += "error_logs" }
if ($logs.ForbiddenMatches -ne 0) { $failedChecks += "forbidden_log_content" }
$expectedHealthyAlarmCount = if ($WorkloadProfile -ceq "D2Public") { 16 } else { 10 }
if ($healthyAlarms -ne $expectedHealthyAlarmCount) { $failedChecks += "alarm_health" }
if ($activeServices -ne 0) { $failedChecks += "active_ecs_services" }
if ($runningTasks -ne 0) { $failedChecks += "running_ecs_tasks" }
if ($failedChecks.Count -ne 0) {
  throw "The $Environment serverless workload did not pass aggregate AWS acceptance: $($failedChecks -join ', ')."
}

[pscustomobject]@{
  Environment              = $Environment
  WorkloadProfile          = $WorkloadProfile
  WindowMinutes            = [Math]::Round(($window.End - $window.Start).TotalMinutes, 2)
  ApiRequests              = [int]$requestCount.Sum
  MinimumApiRequests       = $minimumApiRequests
  ApiRequestsMeetMinimum   = [int]$requestCount.Sum -ge $minimumApiRequests
  Api4xx                   = [int]$clientErrors.Sum
  MinimumExpected4xx       = $minimumExpected4xx
  Expected4xxMeetMinimum   = [int]$clientErrors.Sum -ge $minimumExpected4xx
  Api5xx                   = [int]$serverErrors.Sum
  ApiLatencyAverageMs      = $latency.Average
  ApiLatencyMaximumMs      = $latency.Maximum
  LambdaInvocations        = [int]$lambdaInvocations
  LambdaErrors             = [int]$lambdaErrors
  LambdaThrottles          = [int]$lambdaThrottles
  LambdaDurationMaximumMs  = $lambdaDurationMaximum
  DatabaseCpuMaxPercent    = $databaseCpu.Maximum
  DatabaseConnectionsMax   = $connections.Maximum
  EventQueueAgeMaxSeconds  = $queueAge.Maximum
  EventQueueVisibleMax     = $queueVisible.Maximum
  DeadLetterMessagesMax    = $deadLetters.Maximum
  DurableDeadLetterMax     = $durableDeadLetters.Maximum
  LogEvents                = $logs.Events
  LogErrorMatches          = $logs.ErrorMatches
  ForbiddenLogMatches      = $logs.ForbiddenMatches
  ActiveEcsServices        = $activeServices
  RunningEcsTasks          = $runningTasks
  RuntimeAlarmsOk          = $healthyAlarms
  DispatchTarget           = [string]$runtime.DispatchTarget
  TriggersEnabled          = [bool]$runtime.TriggersEnabled
  TerraformDrift           = 0
} | ConvertTo-Json
