[CmdletBinding()]
param(
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId,
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket,

  [ValidatePattern("^lambda/gateway/[a-f0-9]{40}/[a-f0-9]{64}/gateway-lambda[.]zip$")]
  [string]$GatewayArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$GatewayArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{40}$")][string]$GatewayArtifactSourceSha,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$GatewayArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$GatewayArtifactBase64Sha256,

  [ValidatePattern("^[a-f0-9]{40}$")][string]$WorkflowArtifactSourceSha,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/workflow-ingress-lambda[.]zip$")]
  [string]$WorkflowIngressArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$WorkflowIngressArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$WorkflowIngressArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$WorkflowIngressArtifactBase64Sha256,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/profile-readiness-durable-lambda[.]zip$")]
  [string]$DurableArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$DurableArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$DurableArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$DurableArtifactBase64Sha256,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/profile-readiness-activity-lambda[.]zip$")]
  [string]$ActivityArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ActivityArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ActivityArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$ActivityArtifactBase64Sha256,

  [ValidatePattern("^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$")]
  [string]$PinnedExtensionLayerArn,
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Creates a refresh-backed development plan for the complete dark serverless workflow boundary.
It first runs the existing completed-gateway verifier, verifies all immutable workflow artifacts,
reconstructs every live platform input, and keeps dispatch on Temporal and all replacement triggers
disabled. The sensitive plan remains below the ignored Terraform .terraform directory.

This script rejects every action outside the reviewed 37-create/5-update dark boundary and never
applies infrastructure or changes traffic.
"@
  exit 0
}

$required = @(
  $ExpectedAccountId, $StateBucket, $GatewayArtifactS3Key,
  $GatewayArtifactS3ObjectVersion, $GatewayArtifactSourceSha, $GatewayArtifactSha256,
  $GatewayArtifactBase64Sha256, $WorkflowArtifactSourceSha,
  $WorkflowIngressArtifactS3Key, $WorkflowIngressArtifactS3ObjectVersion,
  $WorkflowIngressArtifactSha256, $WorkflowIngressArtifactBase64Sha256,
  $DurableArtifactS3Key, $DurableArtifactS3ObjectVersion, $DurableArtifactSha256,
  $DurableArtifactBase64Sha256, $ActivityArtifactS3Key,
  $ActivityArtifactS3ObjectVersion, $ActivityArtifactSha256,
  $ActivityArtifactBase64Sha256, $PinnedExtensionLayerArn
)
if (@($required | Where-Object { -not $_ }).Count -ne 0) {
  throw "All account, state, gateway, workflow artifact, checksum, version, and layer inputs are required."
}
if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

function Assert-ArtifactKey {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$SourceSha,
    [Parameter(Mandatory = $true)][string]$Digest,
    [Parameter(Mandatory = $true)][string]$FileName
  )
  $expected = "lambda/workflows/$SourceSha/$Digest/$FileName"
  if ($Key -ne $expected) {
    throw "A workflow artifact key does not match its reviewed source, digest, or filename."
  }
}

Assert-ArtifactKey $WorkflowIngressArtifactS3Key $WorkflowArtifactSourceSha `
  $WorkflowIngressArtifactSha256 "workflow-ingress-lambda.zip"
Assert-ArtifactKey $DurableArtifactS3Key $WorkflowArtifactSourceSha `
  $DurableArtifactSha256 "profile-readiness-durable-lambda.zip"
Assert-ArtifactKey $ActivityArtifactS3Key $WorkflowArtifactSourceSha `
  $ActivityArtifactSha256 "profile-readiness-activity-lambda.zip"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentDirectory = Join-Path $repositoryRoot "infrastructure/terraform/environments/development"
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform/dark-plan-data"
$planDirectory = Join-Path $environmentDirectory ".terraform/workflow-dark-plans"
$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$planPath = Join-Path $planDirectory "workflow-dark-$($sourceCommit.Substring(0, 8)).tfplan"

foreach ($command in @("aws", "git", "terraform")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required."
  }
}
if ((& terraform version -json | ConvertFrom-Json).terraform_version -ne "1.9.8") {
  throw "Terraform 1.9.8 is required."
}
& git -C $repositoryRoot diff --quiet -- infrastructure/terraform
if ($LASTEXITCODE -ne 0) {
  throw "Infrastructure Terraform has uncommitted changes; plan only committed source."
}

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "An AWS read required for dark planning failed. Refresh the development SSO session."
  }
  return $raw | ConvertFrom-Json
}

function Get-OnlyItem {
  param([object[]]$Items, [string]$FailureMessage)
  if ($Items.Count -ne 1) { throw $FailureMessage }
  return $Items[0]
}

function Get-ContainerEnvironment {
  param([object]$Container)
  $result = @{}
  foreach ($item in @($Container.environment)) {
    $result[[string]$item.name] = [string]$item.value
  }
  return $result
}

function Get-BaselineValue {
  param([object]$Plan, [string]$Address)
  $change = Get-OnlyItem `
    -Items @($Plan.resource_changes | Where-Object { [string]$_.address -eq $Address }) `
    -FailureMessage "The completed dark baseline is missing '$Address'."
  if ((@($change.change.actions) -join ",") -ne "no-op") {
    throw "The completed dark baseline contains a change for '$Address'."
  }
  return $change.change.before
}

$caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (
  [string]$caller.Account -ne $ExpectedAccountId -or
  -not ([string]$caller.Arn).Contains(":assumed-role/")
) {
  throw "Use the temporary IAM Identity Center session for the exact development account."
}

$baselinePlanPath = Join-Path $environmentDirectory (
  ".terraform/dark-plans/gateway-lambda-$($GatewayArtifactSourceSha.Substring(0, 8)).tfplan"
)
$baseline = $null
$acceptedEndpointSidCorrection = $false
try {
  $baselineRaw = & (Join-Path $PSScriptRoot "plan-development-gateway-lambda-dark.ps1") `
    -ExpectedAccountId $ExpectedAccountId `
    -StateBucket $StateBucket `
    -ArtifactS3Key $GatewayArtifactS3Key `
    -ArtifactS3ObjectVersion $GatewayArtifactS3ObjectVersion `
    -ArtifactSourceSha $GatewayArtifactSourceSha `
    -ArtifactSha256 $GatewayArtifactSha256 `
    -ArtifactBase64Sha256 $GatewayArtifactBase64Sha256 `
    -PinnedExtensionLayerArn $PinnedExtensionLayerArn `
    -VerifyCompletedDarkDeployment
  $baseline = $baselineRaw | ConvertFrom-Json
  if (
    -not [bool]$baseline.NoDrift -or
    -not [bool]$baseline.ExistingEcsServicesStable -or
    [bool]$baseline.ApiTrafficChange
  ) {
    throw "The completed gateway/ECS/API baseline is outside the accepted stable state."
  }
  $baselinePlanPath = [string]$baseline.SensitivePlanPath
}
catch {
  if (
    $_.Exception.Message -ne
      "The completed dark-deployment plan is not zero-change." -or
    -not (Test-Path -LiteralPath $baselinePlanPath)
  ) {
    throw
  }
  $temporaryPriorTerraformDataDirectory = $env:TF_DATA_DIR
  $env:TF_DATA_DIR = $terraformDataDirectory
  $candidateBaseline = & terraform "-chdir=$environmentDirectory" show -json `
    $baselinePlanPath 2>$null | ConvertFrom-Json
  if ($null -eq $temporaryPriorTerraformDataDirectory) {
    Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue
  } else {
    $env:TF_DATA_DIR = $temporaryPriorTerraformDataDirectory
  }
  if ($LASTEXITCODE -ne 0) {
    throw "The gateway baseline correction plan could not be inspected."
  }
  $baselineChanges = @(
    $candidateBaseline.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("no-op", "read")
    }
  )
  if (
    $baselineChanges.Count -ne 1 -or
    [string]$baselineChanges[0].address -ne
      "module.platform.aws_vpc_endpoint.secretsmanager[0]" -or
    (@($baselineChanges[0].change.actions) -join ",") -ne "update"
  ) {
    throw "The gateway baseline contains more than the reviewed endpoint SID correction."
  }
  $beforeEndpointPolicy = [string]$baselineChanges[0].change.before.policy | ConvertFrom-Json
  $afterEndpointPolicy = [string]$baselineChanges[0].change.after.policy | ConvertFrom-Json
  if (
    @($beforeEndpointPolicy.Statement).Count -ne 1 -or
    @($afterEndpointPolicy.Statement).Count -ne 1 -or
    [string]$beforeEndpointPolicy.Statement[0].Sid -ne "GatewayLambdaDatabaseSecretOnly" -or
    [string]$afterEndpointPolicy.Statement[0].Sid -ne "ExactLambdaRolesDatabaseSecretOnly"
  ) {
    throw "The gateway endpoint correction does not have the reviewed SID transition."
  }
  $afterEndpointPolicy.Statement[0].Sid = $beforeEndpointPolicy.Statement[0].Sid
  if (
    ($beforeEndpointPolicy | ConvertTo-Json -Depth 30 -Compress) -ne
    ($afterEndpointPolicy | ConvertTo-Json -Depth 30 -Compress)
  ) {
    throw "The gateway endpoint correction changes more than its statement SID."
  }
  $acceptedEndpointSidCorrection = $true
}

$previousTerraformDataDirectory = $env:TF_DATA_DIR
$previousAccessKeyId = $env:AWS_ACCESS_KEY_ID
$previousSecretAccessKey = $env:AWS_SECRET_ACCESS_KEY
$previousSessionToken = $env:AWS_SESSION_TOKEN
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$terraformVariables = @(
  "gateway_image", "worker_image", "migration_image", "gateway_desired_count",
  "gateway_cpu", "gateway_memory", "worker_desired_count", "worker_cpu",
  "worker_memory", "enable_tracing", "otel_collector_image", "trace_sample_ratio",
  "high_availability", "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "temporal_address",
  "temporal_namespace", "deploy_applications", "deploy_gateway_lambda",
  "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
  "gateway_lambda_artifact_sha256", "gateway_lambda_artifact_base64sha256",
  "gateway_lambda_extension_layer_arn", "gateway_lambda_reserved_concurrency",
  "gateway_outbox_dispatch_target", "deploy_serverless_outbox",
  "workflow_ingress_artifact_s3_key", "workflow_ingress_artifact_s3_object_version",
  "workflow_ingress_artifact_sha256", "workflow_ingress_artifact_base64sha256",
  "workflow_ingress_lambda_extension_layer_arn", "enable_serverless_workflow_triggers",
  "deploy_profile_readiness_durable", "profile_readiness_durable_artifact_s3_key",
  "profile_readiness_durable_artifact_s3_object_version",
  "profile_readiness_durable_artifact_sha256",
  "profile_readiness_durable_artifact_base64sha256",
  "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version",
  "profile_readiness_activity_artifact_sha256",
  "profile_readiness_activity_artifact_base64sha256",
  "profile_readiness_lambda_extension_layer_arn"
)

try {
  $env:TF_DATA_DIR = $terraformDataDirectory
  $env:AWS_REGION = $Region
  $env:AWS_DEFAULT_REGION = $Region
  $credentials = & aws configure export-credentials --profile $AwsProfile --format process 2>$null |
    ConvertFrom-Json
  if (-not $credentials.SessionToken) {
    throw "Short-lived development credentials could not be exported."
  }
  $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
  $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
  $null = New-Item -ItemType Directory -Path $planDirectory -Force

  $baselinePlan = & terraform "-chdir=$environmentDirectory" show -json `
    $baselinePlanPath 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "The completed dark baseline plan could not be inspected." }

  $artifactBucket = & terraform "-chdir=$environmentDirectory" output -raw artifact_bucket 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $artifactBucket) {
    throw "The encrypted development state does not expose the artifact bucket."
  }
  $artifacts = @(
    @($WorkflowIngressArtifactS3Key, $WorkflowIngressArtifactS3ObjectVersion,
      $WorkflowIngressArtifactSha256, $WorkflowIngressArtifactBase64Sha256),
    @($DurableArtifactS3Key, $DurableArtifactS3ObjectVersion,
      $DurableArtifactSha256, $DurableArtifactBase64Sha256),
    @($ActivityArtifactS3Key, $ActivityArtifactS3ObjectVersion,
      $ActivityArtifactSha256, $ActivityArtifactBase64Sha256)
  )
  foreach ($artifact in $artifacts) {
    $head = Invoke-AwsJson @(
      "s3api", "head-object", "--bucket", [string]$artifactBucket,
      "--key", [string]$artifact[0], "--version-id", [string]$artifact[1],
      "--checksum-mode", "ENABLED", "--output", "json"
    )
    if (
      [string]$head.VersionId -ne [string]$artifact[1] -or
      [string]$head.ChecksumSHA256 -ne [string]$artifact[3] -or
      [string]$head.Metadata."source-sha" -ne $WorkflowArtifactSourceSha -or
      [string]$head.Metadata."artifact-sha256" -ne [string]$artifact[2] -or
      [string]$head.ServerSideEncryption -ne "aws:kms" -or
      -not [bool]$head.BucketKeyEnabled
    ) {
      throw "A workflow artifact does not match its immutable version, checksum, metadata, or KMS boundary."
    }
  }

  $lambdaAccount = Invoke-AwsJson @("lambda", "get-account-settings", "--output", "json")
  if ([int]$lambdaAccount.AccountLimit.ConcurrentExecutions - 8 -lt 100) {
    throw "The effective Lambda quota cannot retain the standard unreserved concurrency pool."
  }
  $layer = Invoke-AwsJson @(
    "lambda", "get-layer-version-by-arn", "--arn", $PinnedExtensionLayerArn,
    "--output", "json"
  )
  if (
    @($layer.CompatibleArchitectures).Count -ne 1 -or
    [string]$layer.CompatibleArchitectures[0] -ne "x86_64"
  ) {
    throw "The pinned Secrets extension is not the reviewed x86_64 regional layer."
  }

  $gatewayService = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_service.gateway[0]"
  $workerService = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_service.worker[0]"
  $gatewayTask = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_task_definition.gateway[0]"
  $workerTask = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_task_definition.worker[0]"
  $migrationTask = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_task_definition.migration[0]"
  $database = Get-BaselineValue $baselinePlan "module.platform.aws_db_instance.postgres"
  $cluster = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_cluster.this"
  $gatewayLambda = Get-BaselineValue $baselinePlan "module.platform.aws_lambda_function.gateway[0]"
  $gatewayContainers = [string]$gatewayTask.container_definitions | ConvertFrom-Json
  $workerContainers = [string]$workerTask.container_definitions | ConvertFrom-Json
  $migrationContainers = [string]$migrationTask.container_definitions | ConvertFrom-Json
  $gatewayContainer = Get-OnlyItem @($gatewayContainers | Where-Object { $_.name -eq "gateway" }) `
    "The baseline gateway container is missing."
  $workerContainer = Get-OnlyItem @($workerContainers | Where-Object { $_.name -eq "worker" }) `
    "The baseline worker container is missing."
  $migrationContainer = Get-OnlyItem `
    @($migrationContainers | Where-Object { $_.name -eq "database-migration" }) `
    "The baseline migration container is missing."
  $gatewayCollector = Get-OnlyItem `
    @($gatewayContainers | Where-Object { $_.name -eq "otel-collector" }) `
    "The baseline gateway collector is missing."
  $workerCollector = Get-OnlyItem `
    @($workerContainers | Where-Object { $_.name -eq "otel-collector" }) `
    "The baseline worker collector is missing."
  if ([string]$gatewayCollector.image -ne [string]$workerCollector.image) {
    throw "The accepted gateway and worker collector images differ."
  }
  $gatewayEnvironment = Get-ContainerEnvironment $gatewayContainer
  $workerEnvironment = Get-ContainerEnvironment $workerContainer

  $env:TF_VAR_gateway_image = [string]$gatewayContainer.image
  $env:TF_VAR_worker_image = [string]$workerContainer.image
  $env:TF_VAR_migration_image = [string]$migrationContainer.image
  $env:TF_VAR_gateway_desired_count = [string]$gatewayService.desired_count
  $env:TF_VAR_gateway_cpu = [string]$gatewayTask.cpu
  $env:TF_VAR_gateway_memory = [string]$gatewayTask.memory
  $env:TF_VAR_worker_desired_count = [string]$workerService.desired_count
  $env:TF_VAR_worker_cpu = [string]$workerTask.cpu
  $env:TF_VAR_worker_memory = [string]$workerTask.memory
  $env:TF_VAR_enable_tracing = "true"
  $env:TF_VAR_otel_collector_image = [string]$gatewayCollector.image
  $env:TF_VAR_trace_sample_ratio = if ($gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]) {
    [string]$gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]
  } else { "1" }
  $env:TF_VAR_high_availability = ([bool]$database.multi_az).ToString().ToLowerInvariant()
  $env:TF_VAR_private_application_networking = (
    -not [bool]$gatewayService.network_configuration[0].assign_public_ip
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_enable_redis = "false"
  $env:TF_VAR_database_instance_class = [string]$database.instance_class
  $env:TF_VAR_database_engine_version = [string]$database.engine_version
  $env:TF_VAR_database_performance_insights = (
    [bool]$database.performance_insights_enabled
  ).ToString().ToLowerInvariant()
  $containerInsights = @(
    $cluster.setting | Where-Object { $_.name -eq "containerInsights" -and $_.value -eq "enabled" }
  ).Count -gt 0
  $env:TF_VAR_enable_container_insights = $containerInsights.ToString().ToLowerInvariant()
  $env:TF_VAR_oidc_issuer = [string]$gatewayEnvironment["OIDC_ISSUER"]
  $env:TF_VAR_oidc_audience = [string]$gatewayEnvironment["OIDC_AUDIENCE"]
  $env:TF_VAR_temporal_address = [string]$workerEnvironment["TEMPORAL_ADDRESS"]
  $env:TF_VAR_temporal_namespace = [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
  $env:TF_VAR_deploy_applications = "true"
  $env:TF_VAR_deploy_gateway_lambda = "true"
  $env:TF_VAR_gateway_lambda_artifact_s3_key = [string]$gatewayLambda.s3_key
  $env:TF_VAR_gateway_lambda_artifact_s3_object_version = [string]$gatewayLambda.s3_object_version
  $env:TF_VAR_gateway_lambda_artifact_sha256 = [string]$gatewayLambda.environment[0].variables.RELEASE_SHA
  $env:TF_VAR_gateway_lambda_artifact_base64sha256 = [string]$gatewayLambda.source_code_hash
  $env:TF_VAR_gateway_lambda_extension_layer_arn = $PinnedExtensionLayerArn
  $env:TF_VAR_gateway_lambda_reserved_concurrency = [string]$gatewayLambda.reserved_concurrent_executions
  $env:TF_VAR_gateway_outbox_dispatch_target = "temporal"
  $env:TF_VAR_deploy_serverless_outbox = "true"
  $env:TF_VAR_workflow_ingress_artifact_s3_key = $WorkflowIngressArtifactS3Key
  $env:TF_VAR_workflow_ingress_artifact_s3_object_version = $WorkflowIngressArtifactS3ObjectVersion
  $env:TF_VAR_workflow_ingress_artifact_sha256 = $WorkflowIngressArtifactSha256
  $env:TF_VAR_workflow_ingress_artifact_base64sha256 = $WorkflowIngressArtifactBase64Sha256
  $env:TF_VAR_workflow_ingress_lambda_extension_layer_arn = $PinnedExtensionLayerArn
  $env:TF_VAR_enable_serverless_workflow_triggers = "false"
  $env:TF_VAR_deploy_profile_readiness_durable = "true"
  $env:TF_VAR_profile_readiness_durable_artifact_s3_key = $DurableArtifactS3Key
  $env:TF_VAR_profile_readiness_durable_artifact_s3_object_version = $DurableArtifactS3ObjectVersion
  $env:TF_VAR_profile_readiness_durable_artifact_sha256 = $DurableArtifactSha256
  $env:TF_VAR_profile_readiness_durable_artifact_base64sha256 = $DurableArtifactBase64Sha256
  $env:TF_VAR_profile_readiness_activity_artifact_s3_key = $ActivityArtifactS3Key
  $env:TF_VAR_profile_readiness_activity_artifact_s3_object_version = $ActivityArtifactS3ObjectVersion
  $env:TF_VAR_profile_readiness_activity_artifact_sha256 = $ActivityArtifactSha256
  $env:TF_VAR_profile_readiness_activity_artifact_base64sha256 = $ActivityArtifactBase64Sha256
  $env:TF_VAR_profile_readiness_lambda_extension_layer_arn = $PinnedExtensionLayerArn

  $planOutput = & terraform "-chdir=$environmentDirectory" plan -input=false `
    -lock-timeout=5m -detailed-exitcode "-out=$planPath" 2>&1
  if ($LASTEXITCODE -ne 2) {
    $diagnostic = (@($planOutput) | Select-Object -Last 12) -join " "
    throw "The dark workflow plan did not produce a change-only result: $diagnostic"
  }
  $plan = & terraform "-chdir=$environmentDirectory" show -json $planPath 2>$null |
    ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "The dark workflow plan could not be inspected." }
  $changes = @(
    $plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("no-op", "read")
    }
  )

  $expectedCreates = @(
    "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]",
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_cloudwatch_event_target.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_target.profile_readiness_terminal[0]",
    "module.platform.aws_cloudwatch_metric_alarm.outbox_reconciler_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.outbox_starter_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.outbox_starter_throttles[0]",
    "module.platform.aws_cloudwatch_metric_alarm.profile_readiness_activity_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.profile_readiness_dead_letter[0]",
    "module.platform.aws_cloudwatch_metric_alarm.profile_readiness_durable_failed[0]",
    "module.platform.aws_cloudwatch_metric_alarm.profile_readiness_durable_timed_out[0]",
    "module.platform.aws_iam_role.outbox_reconciler[0]",
    "module.platform.aws_iam_role.outbox_starter[0]",
    "module.platform.aws_iam_role.profile_readiness_activity[0]",
    "module.platform.aws_iam_role.profile_readiness_durable[0]",
    "module.platform.aws_iam_role.profile_readiness_terminal[0]",
    "module.platform.aws_iam_role_policy.outbox_reconciler[0]",
    "module.platform.aws_iam_role_policy.outbox_starter[0]",
    "module.platform.aws_iam_role_policy.profile_readiness_activity[0]",
    "module.platform.aws_iam_role_policy.profile_readiness_durable[0]",
    "module.platform.aws_iam_role_policy.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_alias.outbox_reconciler[0]",
    "module.platform.aws_lambda_alias.outbox_starter[0]",
    "module.platform.aws_lambda_alias.profile_readiness_activity[0]",
    "module.platform.aws_lambda_alias.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_function.outbox_reconciler[0]",
    "module.platform.aws_lambda_function.outbox_starter[0]",
    "module.platform.aws_lambda_function.profile_readiness_activity[0]",
    "module.platform.aws_lambda_function.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_permission.outbox_reconciler_schedule[0]",
    "module.platform.aws_lambda_permission.profile_readiness_terminal[0]",
    "module.platform.aws_sqs_queue.profile_readiness_dead_letter[0]",
    "module.platform.aws_sqs_queue_policy.profile_readiness_dead_letter[0]",
    "module.platform.aws_vpc_endpoint.lambda[0]",
    "module.platform.aws_vpc_endpoint.sqs[0]"
  )
  $expectedUpdates = @(
    "module.platform.aws_iam_role_policy.gateway_lambda[0]",
    "module.platform.aws_kms_key.platform",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]"
  )
  $creates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "create" })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $otherActions = @(
    $changes | Where-Object { (@($_.change.actions) -join ",") -notin @("create", "update") }
  )
  $unexpectedCreates = @(
    $creates | Where-Object { $expectedCreates -notcontains [string]$_.address }
  )
  $missingCreates = @(
    $expectedCreates | Where-Object {
      @($creates | ForEach-Object { [string]$_.address }) -notcontains $_
    }
  )
  $unexpectedUpdates = @(
    $updates | Where-Object { $expectedUpdates -notcontains [string]$_.address }
  )
  $missingUpdates = @(
    $expectedUpdates | Where-Object {
      @($updates | ForEach-Object { [string]$_.address }) -notcontains $_
    }
  )
  if (
    $otherActions.Count -ne 0 -or
    $creates.Count -ne $expectedCreates.Count -or
    $updates.Count -ne $expectedUpdates.Count -or
    $unexpectedCreates.Count -ne 0 -or $missingCreates.Count -ne 0 -or
    $unexpectedUpdates.Count -ne 0 -or $missingUpdates.Count -ne 0
  ) {
    throw "The plan contains an action outside the reviewed 37-create/5-update dark boundary."
  }

  function Get-PlannedChange {
    param([string]$Address)
    return Get-OnlyItem `
      -Items @($changes | Where-Object { [string]$_.address -eq $Address }) `
      -FailureMessage "The reviewed plan change '$Address' is missing."
  }

  function Assert-OnlyPropertiesChanged {
    param([object]$Change, [string[]]$Allowed, [string]$FailureMessage)
    $before = $Change.change.before
    $after = $Change.change.after
    $names = @(
      @($before.PSObject.Properties.Name) + @($after.PSObject.Properties.Name) |
        Sort-Object -Unique
    )
    foreach ($name in $names) {
      if ($Allowed -contains $name) { continue }
      $beforeValue = if ($before.PSObject.Properties.Name -contains $name) {
        $before.$name | ConvertTo-Json -Depth 40 -Compress
      } else { "<absent>" }
      $afterValue = if ($after.PSObject.Properties.Name -contains $name) {
        $after.$name | ConvertTo-Json -Depth 40 -Compress
      } else { "<absent>" }
      if ($beforeValue -ne $afterValue) { throw $FailureMessage }
    }
  }

  $gatewayFunctionChange = Get-PlannedChange "module.platform.aws_lambda_function.gateway[0]"
  Assert-OnlyPropertiesChanged $gatewayFunctionChange @(
    "environment", "last_modified", "qualified_arn", "qualified_invoke_arn", "version"
  ) "The gateway function update changes more than its dark outbox environment/version."
  $beforeGatewayVariables = $gatewayFunctionChange.change.before.environment[0].variables
  $afterGatewayVariables = $gatewayFunctionChange.change.after.environment[0].variables
  $beforeNames = @($beforeGatewayVariables.PSObject.Properties.Name | Sort-Object)
  $afterNames = @($afterGatewayVariables.PSObject.Properties.Name | Sort-Object)
  $expectedAfterNames = @($beforeNames + "OUTBOX_DISPATCH_TARGET" + "OUTBOX_QUEUE_URL" | Sort-Object)
  if (
    (Compare-Object $afterNames $expectedAfterNames) -or
    [string]$afterGatewayVariables.OUTBOX_DISPATCH_TARGET -ne "temporal" -or
    -not [string]$afterGatewayVariables.OUTBOX_QUEUE_URL
  ) {
    throw "The gateway dark update does not add only the Temporal-routed outbox environment."
  }
  foreach ($name in $beforeNames) {
    if ([string]$beforeGatewayVariables.$name -ne [string]$afterGatewayVariables.$name) {
      throw "The gateway dark update changes an existing environment value."
    }
  }

  $gatewayAliasChange = Get-PlannedChange "module.platform.aws_lambda_alias.gateway[0]"
  Assert-OnlyPropertiesChanged $gatewayAliasChange @("function_version") `
    "The gateway alias update changes more than its immutable version."
  if (-not [bool]$gatewayAliasChange.change.after_unknown.function_version) {
    throw "The gateway alias is not moving to the function version created by this exact plan."
  }

  foreach ($policyUpdateAddress in @(
    "module.platform.aws_iam_role_policy.gateway_lambda[0]",
    "module.platform.aws_kms_key.platform",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]"
  )) {
    $policyChange = Get-PlannedChange $policyUpdateAddress
    Assert-OnlyPropertiesChanged $policyChange @("policy") `
      "A reviewed policy update changes more than its policy document."
    if (-not [bool]$policyChange.change.after_unknown.policy) {
      throw "A role-dependent policy update unexpectedly resolved before its exact roles exist."
    }
  }

  $starterMapping = (Get-PlannedChange `
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]").change.after
  if (
    [bool]$starterMapping.enabled -or
    @($starterMapping.function_response_types) -notcontains "ReportBatchItemFailures"
  ) {
    throw "The dark SQS starter mapping is enabled or lacks partial-batch failure handling."
  }
  foreach ($ruleAddress in @(
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]"
  )) {
    if ([string](Get-PlannedChange $ruleAddress).change.after.state -ne "DISABLED") {
      throw "A serverless workflow EventBridge trigger is enabled in the dark plan."
    }
  }

  $functionArtifacts = @(
    @("module.platform.aws_lambda_function.outbox_starter[0]", $WorkflowIngressArtifactS3Key,
      $WorkflowIngressArtifactS3ObjectVersion, $WorkflowIngressArtifactBase64Sha256),
    @("module.platform.aws_lambda_function.outbox_reconciler[0]", $WorkflowIngressArtifactS3Key,
      $WorkflowIngressArtifactS3ObjectVersion, $WorkflowIngressArtifactBase64Sha256),
    @("module.platform.aws_lambda_function.profile_readiness_activity[0]", $ActivityArtifactS3Key,
      $ActivityArtifactS3ObjectVersion, $ActivityArtifactBase64Sha256),
    @("module.platform.aws_lambda_function.profile_readiness_terminal[0]", $ActivityArtifactS3Key,
      $ActivityArtifactS3ObjectVersion, $ActivityArtifactBase64Sha256)
  )
  foreach ($expectedFunction in $functionArtifacts) {
    $function = (Get-PlannedChange ([string]$expectedFunction[0])).change.after
    if (
      [string]$function.s3_key -ne [string]$expectedFunction[1] -or
      [string]$function.s3_object_version -ne [string]$expectedFunction[2] -or
      [string]$function.source_code_hash -ne [string]$expectedFunction[3] -or
      @($function.layers).Count -ne 1 -or
      [string]$function.layers[0] -ne $PinnedExtensionLayerArn -or
      [int]$function.reserved_concurrent_executions -ne 1
    ) {
      throw "A dark workflow Lambda does not select its exact artifact, layer, or concurrency."
    }
  }

  $durableStackChange = Get-PlannedChange `
    "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]"
  $durableStack = $durableStackChange.change.after
  if (
    [string]$durableStack.name -ne "ai-job-apply-development-profile-readiness-durable" -or
    [string]$durableStack.on_failure -ne "DELETE"
  ) {
    throw "The durable CloudFormation stack is outside the reviewed development boundary."
  }
  if ($durableStack.template_body) {
    $template = [string]$durableStack.template_body | ConvertFrom-Json
    $durableProperties = $template.Resources.DurableFunction.Properties
    if (
      [string]$durableProperties.Code.S3Key -ne $DurableArtifactS3Key -or
      [string]$durableProperties.Code.S3ObjectVersion -ne $DurableArtifactS3ObjectVersion -or
      [int]$durableProperties.ReservedConcurrentExecutions -ne 2 -or
      [string]$template.Resources.DurableVersion.Properties.CodeSha256 -ne
        $DurableArtifactBase64Sha256
    ) {
      throw "The durable stack does not select the exact artifact, version, or bounded concurrency."
    }
  } elseif (-not [bool]$durableStackChange.change.after_unknown.template_body) {
    throw "The durable stack template is neither exact nor role-dependent unknown."
  }

  $changedAddresses = @($changes | ForEach-Object { [string]$_.address })
  if (@($changedAddresses | Where-Object {
      $_ -match "aws_apigatewayv2_(api|integration|route|stage)" -or
      $_ -match "aws_ecs_(service|task_definition|cluster)"
    }).Count -ne 0
  ) {
    throw "The dark workflow plan changes API routing or ECS capacity."
  }

  $planHash = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Environment                 = "development"
    SourceCommit               = $sourceCommit
    GatewayEcsApiBaselineStable = $true
    EndpointSidCorrection      = $acceptedEndpointSidCorrection
    ArtifactsVerified          = 3
    PinnedExtensionVerified    = $true
    DispatchTarget             = "temporal"
    TriggersEnabled            = $false
    ApiTrafficChange           = $false
    EcsCapacityChange          = $false
    Creates                    = $creates.Count
    Updates                    = $updates.Count
    Deletes                    = 0
    Replacements               = 0
    PlanSha256                 = $planHash
    SensitivePlanPath          = $planPath
    CreatedResources           = $expectedCreates
    UpdatedResources           = $expectedUpdates
  } | ConvertTo-Json -Depth 6
}
finally {
  foreach ($name in $terraformVariables) {
    Remove-Item "Env:TF_VAR_$name" -ErrorAction SilentlyContinue
  }
  if ($null -eq $previousTerraformDataDirectory) { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue } else { $env:TF_DATA_DIR = $previousTerraformDataDirectory }
  if ($null -eq $previousAccessKeyId) { Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue } else { $env:AWS_ACCESS_KEY_ID = $previousAccessKeyId }
  if ($null -eq $previousSecretAccessKey) { Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue } else { $env:AWS_SECRET_ACCESS_KEY = $previousSecretAccessKey }
  if ($null -eq $previousSessionToken) { Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue } else { $env:AWS_SESSION_TOKEN = $previousSessionToken }
  if ($null -eq $previousRegion) { Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue } else { $env:AWS_REGION = $previousRegion }
  if ($null -eq $previousDefaultRegion) { Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue } else { $env:AWS_DEFAULT_REGION = $previousDefaultRegion }
}
