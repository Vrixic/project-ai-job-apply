[CmdletBinding()]
param(
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId,

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket,

  [ValidatePattern("^lambda/gateway/[a-f0-9]{40}/[a-f0-9]{64}/gateway-lambda[.]zip$")]
  [string]$ArtifactS3Key,

  [ValidatePattern("^[A-Za-z0-9._-]+$")]
  [string]$ArtifactS3ObjectVersion,

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$ArtifactSourceSha,

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ArtifactSha256,

  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")]
  [string]$ArtifactBase64Sha256,

  [string]$AwsProfile = "ai-job-apply-development-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [ValidateRange(1, 5)]
  [int]$ReservedConcurrency = 2,

  [ValidatePattern("^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$")]
  [string]$PinnedExtensionLayerArn,

  [switch]$ResumePartialApply,

  [switch]$AllowLambdaVpcPolicyRecovery,

  [switch]$AllowLambdaConcurrencyRecovery,

  [switch]$AllowArtifactReleaseUpdate,

  [switch]$VerifyCompletedDarkDeployment,

  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\plan-development-gateway-lambda-dark.ps1 `
    -ExpectedAccountId ACCOUNT_ID `
    -StateBucket TERRAFORM_STATE_BUCKET `
    -ArtifactS3Key VERSIONED_RELEASE_KEY `
    -ArtifactS3ObjectVersion OBJECT_VERSION `
    -ArtifactSourceSha MERGED_COMMIT_SHA `
    -ArtifactSha256 HEX_SHA256 `
    -ArtifactBase64Sha256 BASE64_SHA256 `
    [-ResumePartialApply] `
    [-AllowLambdaVpcPolicyRecovery] `
    [-PinnedExtensionLayerArn REVIEWED_LAYER_ARN] `
    [-AllowLambdaConcurrencyRecovery] `
    [-AllowArtifactReleaseUpdate] `
    [-VerifyCompletedDarkDeployment]

Creates a refresh-backed development plan for the dark gateway Lambda only. It reconstructs the
exact live ECS/RDS inputs, verifies the immutable KMS-encrypted artifact, resolves and pins the
current official x86_64 AWS Parameters and Secrets extension layer, and rejects every update,
delete, replacement, or create outside the reviewed 11-resource dark boundary.

Use -ResumePartialApply only after a failed exact-plan apply. In that mode, every dark resource
must be either an unchanged object already in Terraform state or one of the remaining reviewed
creates; by default the script still rejects all updates, deletes, replacements, and unrelated
creates.

Use -AllowLambdaVpcPolicyRecovery with -ResumePartialApply only for the reviewed correction that
adds ec2:DescribeSubnets to the existing Lambda VPC role policy. Every other update remains denied.

Use -PinnedExtensionLayerArn with -AllowLambdaConcurrencyRecovery and -ResumePartialApply only
after a failed Lambda creation. The pinned official layer must already be attached to the healthy
dark function, and the plan may change only reserved concurrency from unlimited to the reviewed
ceiling. This prevents a moving "latest" extension from entering a recovery plan.

Use -PinnedExtensionLayerArn with -VerifyCompletedDarkDeployment after the dark deployment is
complete. That mode verifies the healthy live function and reviewed concurrency, requires a
refresh-backed zero-change plan, and still proves ECS stability and no API traffic change.

Use -PinnedExtensionLayerArn with -AllowArtifactReleaseUpdate for a subsequent immutable dark
release. That mode verifies the healthy current function, immutable alias, reviewed concurrency,
and new KMS-encrypted artifact, then permits only the Lambda function artifact/version update and
the alias transition to that new immutable version. It rejects every other infrastructure or
traffic change.

The sensitive saved plan remains under the ignored Terraform .terraform directory for separate
review and exact-plan apply. This script never applies infrastructure or changes API traffic.
"@
  exit 0
}

if (
  -not $ExpectedAccountId -or
  -not $StateBucket -or
  -not $ArtifactS3Key -or
  -not $ArtifactS3ObjectVersion -or
  -not $ArtifactSourceSha -or
  -not $ArtifactSha256 -or
  -not $ArtifactBase64Sha256
) {
  throw "All account, state, source, artifact, checksum, and object-version inputs are required."
}

if ($Region -ne "us-east-2") {
  throw "The Phase 0 development environment is restricted to us-east-2."
}

if ($AllowLambdaVpcPolicyRecovery -and -not $ResumePartialApply) {
  throw "Lambda VPC policy recovery requires -ResumePartialApply."
}

if ($AllowLambdaConcurrencyRecovery -and -not $ResumePartialApply) {
  throw "Lambda concurrency recovery requires -ResumePartialApply."
}

if (
  $AllowArtifactReleaseUpdate -and
  ($ResumePartialApply -or $VerifyCompletedDarkDeployment)
) {
  throw "Artifact release update cannot be combined with recovery or completed verification."
}

if (
  $PinnedExtensionLayerArn -and
  -not $AllowLambdaConcurrencyRecovery -and
  -not $AllowArtifactReleaseUpdate -and
  -not $VerifyCompletedDarkDeployment
) {
  throw "A pinned extension layer is allowed only for concurrency recovery, artifact release, or completed verification."
}

if (
  (
    $AllowLambdaConcurrencyRecovery -or
    $AllowArtifactReleaseUpdate -or
    $VerifyCompletedDarkDeployment
  ) -and
  -not $PinnedExtensionLayerArn
) {
  throw "Lambda recovery, artifact release, and completed verification require the deployed reviewed extension layer ARN."
}

if (
  $VerifyCompletedDarkDeployment -and
  ($ResumePartialApply -or $AllowLambdaVpcPolicyRecovery -or $AllowLambdaConcurrencyRecovery)
) {
  throw "Completed dark-deployment verification cannot be combined with recovery switches."
}

$keyMatch = [regex]::Match(
  $ArtifactS3Key,
  "^lambda/gateway/(?<source>[a-f0-9]{40})/(?<digest>[a-f0-9]{64})/gateway-lambda[.]zip$"
)
if (
  -not $keyMatch.Success -or
  $keyMatch.Groups["source"].Value -ne $ArtifactSourceSha -or
  $keyMatch.Groups["digest"].Value -ne $ArtifactSha256
) {
  throw "The artifact key does not match the supplied source commit and SHA-256."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentDirectory = Join-Path $repositoryRoot "infrastructure/terraform/environments/development"
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform/dark-plan-data"
$planDirectory = Join-Path $environmentDirectory ".terraform/dark-plans"
$planPath = Join-Path $planDirectory "gateway-lambda-$($ArtifactSourceSha.Substring(0, 8)).tfplan"
$clusterName = "ai-job-apply-development"
$extensionParameter = "/aws/service/aws-parameters-and-secrets-lambda-extension/x86/latest"

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $raw = & aws @Arguments --profile $AwsProfile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($Arguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' read failed. Refresh the development SSO session and retry."
  }
  return $raw | ConvertFrom-Json
}

function Get-ContainerEnvironment {
  param([Parameter(Mandatory = $true)][object]$ContainerDefinition)

  $values = @{}
  foreach ($item in $ContainerDefinition.environment) {
    $values[[string]$item.name] = [string]$item.value
  }
  return $values
}

function Get-OnlyItem {
  param(
    [Parameter(Mandatory = $true)][object[]]$Items,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  if ($Items.Count -ne 1) {
    throw $FailureMessage
  }
  return $Items[0]
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI is required."
}
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
  throw "Terraform 1.9.8 is required."
}
$terraformVersion = (& terraform version -json | ConvertFrom-Json).terraform_version
if ([string]$terraformVersion -ne "1.9.8") {
  throw "Terraform 1.9.8 is required; found $terraformVersion."
}

$caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (
  [string]$caller.Account -ne $ExpectedAccountId -or
  -not ([string]$caller.Arn).Contains(":assumed-role/")
) {
  throw "Use the temporary IAM Identity Center session for the exact development account."
}

$artifactBucket = $null
$extensionLayerArn = $null
$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$previousTerraformDataDirectory = $env:TF_DATA_DIR
$previousAccessKeyId = $env:AWS_ACCESS_KEY_ID
$previousSecretAccessKey = $env:AWS_SECRET_ACCESS_KEY
$previousSessionToken = $env:AWS_SESSION_TOKEN
$terraformVariables = @(
  "gateway_image",
  "worker_image",
  "migration_image",
  "gateway_desired_count",
  "gateway_cpu",
  "gateway_memory",
  "worker_desired_count",
  "worker_cpu",
  "worker_memory",
  "enable_tracing",
  "otel_collector_image",
  "trace_sample_ratio",
  "high_availability",
  "private_application_networking",
  "enable_redis",
  "database_instance_class",
  "database_engine_version",
  "database_performance_insights",
  "enable_container_insights",
  "oidc_issuer",
  "oidc_audience",
  "temporal_address",
  "temporal_namespace",
  "deploy_applications",
  "deploy_gateway_lambda",
  "gateway_lambda_artifact_s3_key",
  "gateway_lambda_artifact_s3_object_version",
  "gateway_lambda_artifact_sha256",
  "gateway_lambda_artifact_base64sha256",
  "gateway_lambda_extension_layer_arn",
  "gateway_lambda_reserved_concurrency"
)

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $Region
  $env:AWS_DEFAULT_REGION = $Region
  $env:TF_DATA_DIR = $terraformDataDirectory

  $exportedCredentials = & aws configure export-credentials `
    --profile $AwsProfile `
    --format process 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The short-lived development SSO credentials could not be exported for Terraform."
  }
  $processCredentials = $exportedCredentials | ConvertFrom-Json
  if (
    -not $processCredentials.AccessKeyId -or
    -not $processCredentials.SecretAccessKey -or
    -not $processCredentials.SessionToken
  ) {
    throw "The exported development credentials are incomplete."
  }
  $env:AWS_ACCESS_KEY_ID = [string]$processCredentials.AccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = [string]$processCredentials.SecretAccessKey
  $env:AWS_SESSION_TOKEN = [string]$processCredentials.SessionToken

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $null = New-Item -ItemType Directory -Path $planDirectory -Force

  $stateEncryption = Invoke-AwsJson @(
    "s3api",
    "get-bucket-encryption",
    "--bucket",
    $StateBucket,
    "--output",
    "json"
  )
  $stateKmsRules = @(
    $stateEncryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
    }
  )
  $stateKmsRule = Get-OnlyItem `
    -Items $stateKmsRules `
    -FailureMessage "The development state bucket does not expose one KMS default."
  $stateKmsKeyArn = [string]$stateKmsRule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if (
    $stateKmsKeyArn -notmatch
      "^arn:aws:kms:$([regex]::Escape($Region)):$([regex]::Escape($ExpectedAccountId)):key/"
  ) {
    throw "The development state bucket KMS key is outside the expected account or region."
  }

  $initArguments = @(
    "-chdir=$environmentDirectory",
    "init",
    "-reconfigure",
    "-input=false",
    "-backend-config=bucket=$StateBucket",
    "-backend-config=key=platform.tfstate",
    "-backend-config=region=$Region",
    "-backend-config=kms_key_id=$stateKmsKeyArn"
  )
  $initOutput = & terraform @initArguments 2>&1
  $initSucceeded = $?
  if (-not $initSucceeded) {
    $initDiagnostic = (@($initOutput) | Select-Object -Last 8) -join " "
    throw "Terraform could not initialize the encrypted development backend: $initDiagnostic"
  }

  $artifactBucket = & terraform "-chdir=$environmentDirectory" output -raw artifact_bucket 2>$null
  $migrationTaskArn = & terraform `
    "-chdir=$environmentDirectory" output -raw migration_task_definition_arn 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $artifactBucket -or -not $migrationTaskArn) {
    throw "The encrypted development state does not expose the required release boundaries."
  }

  $artifactHead = Invoke-AwsJson @(
    "s3api",
    "head-object",
    "--bucket",
    [string]$artifactBucket,
    "--key",
    $ArtifactS3Key,
    "--version-id",
    $ArtifactS3ObjectVersion,
    "--checksum-mode",
    "ENABLED",
    "--output",
    "json"
  )
  if (
    [string]$artifactHead.VersionId -ne $ArtifactS3ObjectVersion -or
    [string]$artifactHead.ChecksumSHA256 -ne $ArtifactBase64Sha256 -or
    [string]$artifactHead.Metadata."source-sha" -ne $ArtifactSourceSha -or
    [string]$artifactHead.Metadata."artifact-sha256" -ne $ArtifactSha256 -or
    [string]$artifactHead.ServerSideEncryption -ne "aws:kms" -or
    -not [bool]$artifactHead.BucketKeyEnabled
  ) {
    throw "The immutable artifact does not match the reviewed source, checksum, version, or KMS boundary."
  }

  $extensionParameterResult = Invoke-AwsJson @(
    "ssm",
    "get-parameter",
    "--name",
    $extensionParameter,
    "--output",
    "json"
  )
  $latestExtensionLayerArn = [string]$extensionParameterResult.Parameter.Value
  if (
    $latestExtensionLayerArn -notmatch
      "^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$"
  ) {
    throw "The official extension parameter resolved outside the reviewed regional publisher."
  }
  $extensionLayerArn = if ($PinnedExtensionLayerArn) {
    $PinnedExtensionLayerArn
  } else {
    $latestExtensionLayerArn
  }
  $extensionLayer = Invoke-AwsJson @(
    "lambda",
    "get-layer-version-by-arn",
    "--arn",
    $extensionLayerArn,
    "--output",
    "json"
  )
  if (
    $extensionLayerArn -notmatch "^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$" -or
    @($extensionLayer.CompatibleArchitectures).Count -ne 1 -or
    [string]$extensionLayer.CompatibleArchitectures[0] -ne "x86_64"
  ) {
    throw "The official extension parameter did not resolve to the reviewed regional x86_64 layer."
  }

  if (
    $AllowLambdaConcurrencyRecovery -or
    $AllowArtifactReleaseUpdate -or
    $VerifyCompletedDarkDeployment
  ) {
    $lambdaAccount = Invoke-AwsJson @(
      "lambda",
      "get-account-settings",
      "--output",
      "json"
    )
    if (
      [int]$lambdaAccount.AccountLimit.ConcurrentExecutions -
        $ReservedConcurrency -lt 100
    ) {
      throw "The effective Lambda quota cannot retain the standard unreserved concurrency pool."
    }
    $liveLambda = Invoke-AwsJson @(
      "lambda",
      "get-function",
      "--function-name",
      "ai-job-apply-development-gateway",
      "--output",
      "json"
    )
    $liveLayers = @($liveLambda.Configuration.Layers | ForEach-Object { [string]$_.Arn })
    if (
      [string]$liveLambda.Configuration.State -ne "Active" -or
      [string]$liveLambda.Configuration.LastUpdateStatus -ne "Successful" -or
      $liveLayers.Count -ne 1 -or
      $liveLayers[0] -ne $PinnedExtensionLayerArn
    ) {
      throw "The live dark Lambda does not match the reviewed healthy layer boundary."
    }
    $liveConcurrency = Invoke-AwsJson @(
      "lambda",
      "get-function-concurrency",
      "--function-name",
      "ai-job-apply-development-gateway",
      "--output",
      "json"
    )
    if (
      $AllowLambdaConcurrencyRecovery -and
      $null -ne $liveConcurrency.ReservedConcurrentExecutions
    ) {
      throw "The dark Lambda already has a reserved-concurrency configuration."
    }
    if (
      $VerifyCompletedDarkDeployment -and
      [int]$liveConcurrency.ReservedConcurrentExecutions -ne $ReservedConcurrency
    ) {
      throw "The completed dark Lambda does not have the reviewed concurrency ceiling."
    }
    if (
      ($AllowLambdaConcurrencyRecovery -or $VerifyCompletedDarkDeployment) -and
      [string]$liveLambda.Configuration.CodeSha256 -ne $ArtifactBase64Sha256
    ) {
      throw "The live dark Lambda does not match the reviewed recovery artifact."
    }
    if ($AllowArtifactReleaseUpdate) {
      if (
        [string]$liveLambda.Configuration.CodeSha256 -eq $ArtifactBase64Sha256 -or
        [int]$liveConcurrency.ReservedConcurrentExecutions -ne $ReservedConcurrency
      ) {
        throw "The artifact release requires a different artifact and the existing reviewed concurrency ceiling."
      }
      $liveAlias = Invoke-AwsJson @(
        "lambda",
        "get-alias",
        "--function-name",
        "ai-job-apply-development-gateway",
        "--name",
        "development",
        "--output",
        "json"
      )
      if (
        [string]$liveAlias.Name -ne "development" -or
        [string]$liveAlias.FunctionVersion -notmatch "^[1-9][0-9]*$"
      ) {
        throw "The dark alias is not pinned to one immutable Lambda version."
      }
      $aliasedLambda = Invoke-AwsJson @(
        "lambda",
        "get-function",
        "--function-name",
        "ai-job-apply-development-gateway",
        "--qualifier",
        "development",
        "--output",
        "json"
      )
      if (
        [string]$aliasedLambda.Configuration.Version -ne
          [string]$liveAlias.FunctionVersion -or
        [string]$aliasedLambda.Configuration.CodeSha256 -ne
          [string]$liveLambda.Configuration.CodeSha256
      ) {
        throw "The dark alias does not resolve to the current healthy Lambda artifact."
      }
    }
  }

  $services = @(
    (
      Invoke-AwsJson @(
        "ecs",
        "describe-services",
        "--cluster",
        $clusterName,
        "--services",
        "gateway",
        "workflow-worker",
        "--output",
        "json"
      )
    ).services
  )
  $gatewayService = Get-OnlyItem `
    -Items @($services | Where-Object { $_.serviceName -eq "gateway" }) `
    -FailureMessage "The exact live development gateway service was not found."
  $workerService = Get-OnlyItem `
    -Items @($services | Where-Object { $_.serviceName -eq "workflow-worker" }) `
    -FailureMessage "The exact live development worker service was not found."
  if (
    [int]$gatewayService.runningCount -ne [int]$gatewayService.desiredCount -or
    [int]$workerService.runningCount -ne [int]$workerService.desiredCount
  ) {
    throw "The existing rollback services must be stable before dark planning."
  }

  $gatewayTask = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$gatewayService.taskDefinition,
      "--output",
      "json"
    )
  ).taskDefinition
  $workerTask = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$workerService.taskDefinition,
      "--output",
      "json"
    )
  ).taskDefinition
  $migrationTask = (
    Invoke-AwsJson @(
      "ecs",
      "describe-task-definition",
      "--task-definition",
      [string]$migrationTaskArn,
      "--output",
      "json"
    )
  ).taskDefinition

  $gatewayContainer = Get-OnlyItem `
    -Items @($gatewayTask.containerDefinitions | Where-Object { $_.name -eq "gateway" }) `
    -FailureMessage "The live gateway container was not found."
  $workerContainer = Get-OnlyItem `
    -Items @($workerTask.containerDefinitions | Where-Object { $_.name -eq "worker" }) `
    -FailureMessage "The live worker container was not found."
  $migrationContainer = Get-OnlyItem `
    -Items @($migrationTask.containerDefinitions | Where-Object { $_.name -eq "database-migration" }) `
    -FailureMessage "The immutable migration container was not found."
  $gatewayCollector = Get-OnlyItem `
    -Items @($gatewayTask.containerDefinitions | Where-Object { $_.name -eq "otel-collector" }) `
    -FailureMessage "The live gateway telemetry collector was not found."
  $workerCollector = Get-OnlyItem `
    -Items @($workerTask.containerDefinitions | Where-Object { $_.name -eq "otel-collector" }) `
    -FailureMessage "The live worker telemetry collector was not found."
  if ([string]$gatewayCollector.image -ne [string]$workerCollector.image) {
    throw "The live gateway and worker telemetry images are inconsistent."
  }

  $gatewayEnvironment = Get-ContainerEnvironment $gatewayContainer
  $workerEnvironment = Get-ContainerEnvironment $workerContainer
  foreach ($requiredValue in @(
      $gatewayEnvironment["OIDC_ISSUER"],
      $gatewayEnvironment["OIDC_AUDIENCE"],
      $workerEnvironment["TEMPORAL_ADDRESS"],
      $workerEnvironment["TEMPORAL_NAMESPACE"]
    )) {
    if (-not [string]$requiredValue) {
      throw "The live application configuration is incomplete."
    }
  }

  $databases = @(
    (
      Invoke-AwsJson @("rds", "describe-db-instances", "--output", "json")
    ).DBInstances | Where-Object { $_.DBInstanceIdentifier -eq "ai-job-apply-development" }
  )
  $database = Get-OnlyItem `
    -Items $databases `
    -FailureMessage "The exact development database was not found."

  $cluster = (
    Invoke-AwsJson @(
      "ecs",
      "describe-clusters",
      "--clusters",
      $clusterName,
      "--include",
      "SETTINGS",
      "--output",
      "json"
    )
  ).clusters[0]
  $containerInsights = @(
    $cluster.settings | Where-Object {
      $_.name -eq "containerInsights" -and $_.value -eq "enabled"
    }
  ).Count -gt 0

  $env:TF_VAR_gateway_image = [string]$gatewayContainer.image
  $env:TF_VAR_worker_image = [string]$workerContainer.image
  $env:TF_VAR_migration_image = [string]$migrationContainer.image
  $env:TF_VAR_gateway_desired_count = [string]$gatewayService.desiredCount
  $env:TF_VAR_gateway_cpu = [string]$gatewayTask.cpu
  $env:TF_VAR_gateway_memory = [string]$gatewayTask.memory
  $env:TF_VAR_worker_desired_count = [string]$workerService.desiredCount
  $env:TF_VAR_worker_cpu = [string]$workerTask.cpu
  $env:TF_VAR_worker_memory = [string]$workerTask.memory
  $env:TF_VAR_enable_tracing = "true"
  $env:TF_VAR_otel_collector_image = [string]$gatewayCollector.image
  $env:TF_VAR_trace_sample_ratio = if ($gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]) {
    [string]$gatewayEnvironment["OTEL_TRACES_SAMPLER_ARG"]
  } else {
    "1"
  }
  $env:TF_VAR_high_availability = ([bool]$database.MultiAZ).ToString().ToLowerInvariant()
  $env:TF_VAR_private_application_networking = (
    ([string]$gatewayService.networkConfiguration.awsvpcConfiguration.assignPublicIp) -ne "ENABLED"
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_enable_redis = "false"
  $env:TF_VAR_database_instance_class = [string]$database.DBInstanceClass
  $env:TF_VAR_database_engine_version = [string]$database.EngineVersion
  $env:TF_VAR_database_performance_insights = (
    [bool]$database.PerformanceInsightsEnabled
  ).ToString().ToLowerInvariant()
  $env:TF_VAR_enable_container_insights = $containerInsights.ToString().ToLowerInvariant()
  $env:TF_VAR_oidc_issuer = [string]$gatewayEnvironment["OIDC_ISSUER"]
  $env:TF_VAR_oidc_audience = [string]$gatewayEnvironment["OIDC_AUDIENCE"]
  $env:TF_VAR_temporal_address = [string]$workerEnvironment["TEMPORAL_ADDRESS"]
  $env:TF_VAR_temporal_namespace = [string]$workerEnvironment["TEMPORAL_NAMESPACE"]
  $env:TF_VAR_deploy_applications = "true"
  $env:TF_VAR_deploy_gateway_lambda = "true"
  $env:TF_VAR_gateway_lambda_artifact_s3_key = $ArtifactS3Key
  $env:TF_VAR_gateway_lambda_artifact_s3_object_version = $ArtifactS3ObjectVersion
  $env:TF_VAR_gateway_lambda_artifact_sha256 = $ArtifactSha256
  $env:TF_VAR_gateway_lambda_artifact_base64sha256 = $ArtifactBase64Sha256
  $env:TF_VAR_gateway_lambda_extension_layer_arn = $extensionLayerArn
  $env:TF_VAR_gateway_lambda_reserved_concurrency = [string]$ReservedConcurrency

  $null = & terraform "-chdir=$environmentDirectory" plan `
    -input=false `
    -lock-timeout=5m `
    "-out=$planPath" `
    -detailed-exitcode 2>$null
  $planExitCode = $LASTEXITCODE
  if ($VerifyCompletedDarkDeployment -and $planExitCode -ne 0) {
    throw "The completed dark-deployment plan is not zero-change."
  }
  if (-not $VerifyCompletedDarkDeployment -and $planExitCode -ne 2) {
    throw "The refresh-backed dark plan did not produce the expected change-only result."
  }

  $planJson = & terraform "-chdir=$environmentDirectory" show -json $planPath 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The saved dark plan could not be inspected."
  }
  $plan = $planJson | ConvertFrom-Json

  $expectedCreates = @(
    "module.platform.aws_apigatewayv2_authorizer.gateway[0]",
    "module.platform.aws_cloudwatch_metric_alarm.gateway_lambda_duration[0]",
    "module.platform.aws_cloudwatch_metric_alarm.gateway_lambda_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.gateway_lambda_throttles[0]",
    "module.platform.aws_iam_role_policy.gateway_lambda[0]",
    "module.platform.aws_iam_role.gateway_lambda[0]",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]",
    "module.platform.aws_lambda_permission.gateway_api[0]",
    "module.platform.aws_security_group.secrets_endpoint[0]",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]"
  )
  $changes = @()
  $existing = @()
  $updates = @()
  foreach ($resourceChange in $plan.resource_changes) {
    $actions = @($resourceChange.change.actions)
    if ($actions -contains "no-op" -or $actions -contains "read") {
      if ($expectedCreates -contains [string]$resourceChange.address) {
        $existing += [string]$resourceChange.address
      }
      continue
    }
    $normalizedAction = $actions -join ","
    if (
      $AllowArtifactReleaseUpdate -and
      $normalizedAction -eq "update" -and
      [string]$resourceChange.address -eq
        "module.platform.aws_lambda_function.gateway[0]"
    ) {
      $beforeFunction = $resourceChange.change.before | ConvertTo-Json -Depth 30 | ConvertFrom-Json
      $afterFunction = $resourceChange.change.after | ConvertTo-Json -Depth 30 | ConvertFrom-Json
      $afterVariables = $afterFunction.environment[0].variables
      if (
        [string]$afterFunction.s3_key -ne $ArtifactS3Key -or
        [string]$afterFunction.s3_object_version -ne $ArtifactS3ObjectVersion -or
        [string]$afterFunction.source_code_hash -ne $ArtifactBase64Sha256 -or
        [string]$afterVariables.RELEASE_SHA -ne $ArtifactSha256
      ) {
        throw "The Lambda release update does not select the reviewed immutable artifact."
      }
      $beforeFunctionProperties = @($beforeFunction.PSObject.Properties.Name)
      $afterFunctionProperties = @($afterFunction.PSObject.Properties.Name)
      $functionProperties = @(
        $beforeFunctionProperties + $afterFunctionProperties | Sort-Object -Unique
      )
      $allowedFunctionChanges = @(
        "environment",
          "last_modified",
          "qualified_arn",
          "qualified_invoke_arn",
          "s3_key",
          "s3_object_version",
          "source_code_hash",
          "version"
      )
      $unexpectedFunctionChanges = @(
        foreach ($property in $functionProperties) {
          if ($allowedFunctionChanges -contains $property) {
            continue
          }
          $beforeValue = if ($beforeFunctionProperties -contains $property) {
            $beforeFunction.$property | ConvertTo-Json -Depth 30 -Compress
          } else {
            "<absent>"
          }
          $afterValue = if ($afterFunctionProperties -contains $property) {
            $afterFunction.$property | ConvertTo-Json -Depth 30 -Compress
          } else {
            "<absent>"
          }
          if ($beforeValue -ne $afterValue) {
            $property
          }
        }
      )
      $afterFunction.environment[0].variables.RELEASE_SHA =
        $beforeFunction.environment[0].variables.RELEASE_SHA
      $normalizedBeforeEnvironment =
        $beforeFunction.environment | ConvertTo-Json -Depth 30 -Compress
      $normalizedAfterEnvironment =
        $afterFunction.environment | ConvertTo-Json -Depth 30 -Compress
      if (
        $unexpectedFunctionChanges.Count -ne 0 -or
        $normalizedBeforeEnvironment -ne $normalizedAfterEnvironment
      ) {
        throw "The Lambda release update changes more than artifact identity and computed version fields."
      }
      $updates += [string]$resourceChange.address
      continue
    }
    if (
      $AllowArtifactReleaseUpdate -and
      $normalizedAction -eq "update" -and
      [string]$resourceChange.address -eq
        "module.platform.aws_lambda_alias.gateway[0]"
    ) {
      $beforeAlias = $resourceChange.change.before | ConvertTo-Json -Depth 20 | ConvertFrom-Json
      $afterAlias = $resourceChange.change.after | ConvertTo-Json -Depth 20 | ConvertFrom-Json
      $beforeAliasProperties = @($beforeAlias.PSObject.Properties.Name)
      $afterAliasProperties = @($afterAlias.PSObject.Properties.Name)
      $aliasProperties = @(
        $beforeAliasProperties + $afterAliasProperties | Sort-Object -Unique
      )
      $unexpectedAliasChanges = @(
        foreach ($property in $aliasProperties) {
          if ($property -eq "function_version") {
            continue
          }
          $beforeValue = if ($beforeAliasProperties -contains $property) {
            $beforeAlias.$property | ConvertTo-Json -Depth 20 -Compress
          } else {
            "<absent>"
          }
          $afterValue = if ($afterAliasProperties -contains $property) {
            $afterAlias.$property | ConvertTo-Json -Depth 20 -Compress
          } else {
            "<absent>"
          }
          if ($beforeValue -ne $afterValue) {
            $property
          }
        }
      )
      if (
        $unexpectedAliasChanges.Count -ne 0 -or
        $beforeAliasProperties -notcontains "function_version" -or
        $afterAliasProperties -contains "function_version"
      ) {
        throw "The Lambda release alias update changes more than its immutable function version."
      }
      $updates += [string]$resourceChange.address
      continue
    }
    if (
      $AllowLambdaVpcPolicyRecovery -and
      $normalizedAction -eq "update" -and
      [string]$resourceChange.address -eq
        "module.platform.aws_iam_role_policy.gateway_lambda[0]"
    ) {
      $beforePolicy = [string]$resourceChange.change.before.policy | ConvertFrom-Json
      $afterPolicy = [string]$resourceChange.change.after.policy | ConvertFrom-Json
      $beforeVpc = @($beforePolicy.Statement | Where-Object { $_.Sid -eq "ManageVpcInterfaces" })
      $afterVpc = @($afterPolicy.Statement | Where-Object { $_.Sid -eq "ManageVpcInterfaces" })
      if ($beforeVpc.Count -ne 1 -or $afterVpc.Count -ne 1) {
        throw "The Lambda VPC policy recovery update has an unexpected statement shape."
      }
      $beforeActions = @($beforeVpc[0].Action | Sort-Object)
      $afterActions = @($afterVpc[0].Action | Sort-Object)
      $expectedAfterActions = @($beforeActions + "ec2:DescribeSubnets" | Sort-Object -Unique)
      if (
        $beforeActions -contains "ec2:DescribeSubnets" -or
        (Compare-Object $afterActions $expectedAfterActions)
      ) {
        throw "The Lambda VPC policy recovery update is not the exact DescribeSubnets addition."
      }
      $afterVpc[0].Action = $beforeVpc[0].Action
      $normalizedBefore = $beforePolicy | ConvertTo-Json -Depth 20 -Compress
      $normalizedAfter = $afterPolicy | ConvertTo-Json -Depth 20 -Compress
      if ($normalizedBefore -ne $normalizedAfter) {
        throw "The Lambda VPC policy recovery update changes more than DescribeSubnets."
      }
      $updates += [string]$resourceChange.address
      continue
    }
    if (
      $AllowLambdaConcurrencyRecovery -and
      $normalizedAction -eq "update" -and
      [string]$resourceChange.address -eq
        "module.platform.aws_lambda_function.gateway[0]"
    ) {
      if (
        [int]$resourceChange.change.before.reserved_concurrent_executions -ne -1 -or
        [int]$resourceChange.change.after.reserved_concurrent_executions -ne
          $ReservedConcurrency
      ) {
        throw "The Lambda concurrency recovery update has an unexpected ceiling transition."
      }
      $beforeFunction = $resourceChange.change.before | ConvertTo-Json -Depth 30 | ConvertFrom-Json
      $afterFunction = $resourceChange.change.after | ConvertTo-Json -Depth 30 | ConvertFrom-Json
      $afterFunction.reserved_concurrent_executions =
        $beforeFunction.reserved_concurrent_executions
      $normalizedBefore = $beforeFunction | ConvertTo-Json -Depth 30 -Compress
      $normalizedAfter = $afterFunction | ConvertTo-Json -Depth 30 -Compress
      if ($normalizedBefore -ne $normalizedAfter) {
        throw "The Lambda concurrency recovery update changes more than reserved concurrency."
      }
      $updates += [string]$resourceChange.address
      continue
    }
    if (
      $normalizedAction -ne "create" -or
      $expectedCreates -notcontains [string]$resourceChange.address
    ) {
      throw "The plan contains an action outside the reviewed dark gateway boundary."
    }
    $changes += [string]$resourceChange.address
  }

  if ($VerifyCompletedDarkDeployment) {
    if ($changes.Count -ne 0 -or $updates.Count -ne 0) {
      throw "The completed dark-deployment verification contains a resource change."
    }
    foreach ($expectedCreate in $expectedCreates) {
      if ($existing -notcontains $expectedCreate) {
        throw "The completed dark deployment does not account for every reviewed resource."
      }
    }
  } elseif ($AllowArtifactReleaseUpdate) {
    $expectedReleaseUpdates = @(
      "module.platform.aws_lambda_alias.gateway[0]",
      "module.platform.aws_lambda_function.gateway[0]"
    )
    if ($changes.Count -ne 0 -or $updates.Count -ne $expectedReleaseUpdates.Count) {
      throw "The artifact release plan must contain only the function and alias updates."
    }
    foreach ($expectedUpdate in $expectedReleaseUpdates) {
      if ($updates -notcontains $expectedUpdate) {
        throw "The artifact release plan is missing a required reviewed update."
      }
    }
    foreach ($expectedCreate in $expectedCreates) {
      if (
        $existing -notcontains $expectedCreate -and
        $updates -notcontains $expectedCreate
      ) {
        throw "The artifact release plan does not account for every dark gateway resource."
      }
    }
  } elseif ($ResumePartialApply) {
    if ($changes.Count -lt 1 -or $changes.Count -ge $expectedCreates.Count) {
      throw "The partial-apply recovery plan must contain between 1 and 10 remaining creates."
    }
    foreach ($expectedCreate in $expectedCreates) {
      if (
        $changes -notcontains $expectedCreate -and
        $updates -notcontains $expectedCreate -and
        $existing -notcontains $expectedCreate
      ) {
        throw "The partial-apply recovery plan does not account for every dark gateway resource."
      }
    }
    if (
      $AllowLambdaVpcPolicyRecovery -and
      $updates -notcontains "module.platform.aws_iam_role_policy.gateway_lambda[0]"
    ) {
      throw "The recovery plan must contain the exact Lambda VPC role-policy update."
    }
    if (
      $AllowLambdaConcurrencyRecovery -and
      $updates -notcontains "module.platform.aws_lambda_function.gateway[0]"
    ) {
      throw "The recovery plan must contain the exact Lambda concurrency update."
    }
    $expectedUpdateCount =
      [int][bool]$AllowLambdaVpcPolicyRecovery +
      [int][bool]$AllowLambdaConcurrencyRecovery
    if ($updates.Count -ne $expectedUpdateCount) {
      throw "The partial-apply recovery plan contains an unapproved update."
    }
  } else {
    if ($changes.Count -ne $expectedCreates.Count) {
      throw "The plan does not contain the complete reviewed 11-resource dark boundary."
    }
    foreach ($expectedCreate in $expectedCreates) {
      if ($changes -notcontains $expectedCreate) {
        throw "The plan is missing a required dark gateway resource."
      }
    }
  }

  $planHash = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Environment               = "development"
    AccountVerified           = $true
    StateKmsKeyVerified       = $true
    Region                    = $Region
    SourceSha                 = $ArtifactSourceSha
    ArtifactSha256            = $ArtifactSha256
    ArtifactVersionVerified   = $true
    ExtensionLayerArn         = $extensionLayerArn
    ReservedConcurrency       = $ReservedConcurrency
    ResumePartialApply        = [bool]$ResumePartialApply
    LambdaVpcPolicyRecovery   = [bool]$AllowLambdaVpcPolicyRecovery
    LambdaConcurrencyRecovery = [bool]$AllowLambdaConcurrencyRecovery
    ArtifactReleaseUpdate     = [bool]$AllowArtifactReleaseUpdate
    CompletedDarkVerification = [bool]$VerifyCompletedDarkDeployment
    NoDrift                   = [bool]$VerifyCompletedDarkDeployment
    LatestExtensionLayerArn   = $latestExtensionLayerArn
    ExistingReviewedResources = $existing.Count
    Creates                   = $changes.Count
    Updates                   = $updates.Count
    Deletes                   = 0
    Replacements              = 0
    ExistingEcsServicesStable = $true
    ApiTrafficChange          = $false
    PlanSha256                = $planHash
    SensitivePlanPath         = $planPath
    Changes                   = $changes | Sort-Object
    UpdatedResources          = $updates | Sort-Object
  } | ConvertTo-Json -Depth 5
}
finally {
  foreach ($terraformVariable in $terraformVariables) {
    Remove-Item "Env:TF_VAR_$terraformVariable" -ErrorAction SilentlyContinue
  }
  if ($null -eq $previousProfile) {
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
  } else {
    $env:AWS_PROFILE = $previousProfile
  }
  if ($null -eq $previousRegion) {
    Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_REGION = $previousRegion
  }
  if ($null -eq $previousDefaultRegion) {
    Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
  } else {
    $env:AWS_DEFAULT_REGION = $previousDefaultRegion
  }
  if ($null -eq $previousTerraformDataDirectory) {
    Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue
  } else {
    $env:TF_DATA_DIR = $previousTerraformDataDirectory
  }
  if ($null -eq $previousAccessKeyId) {
    Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
  } else {
    $env:AWS_ACCESS_KEY_ID = $previousAccessKeyId
  }
  if ($null -eq $previousSecretAccessKey) {
    Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
  } else {
    $env:AWS_SECRET_ACCESS_KEY = $previousSecretAccessKey
  }
  if ($null -eq $previousSessionToken) {
    Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
  } else {
    $env:AWS_SESSION_TOKEN = $previousSessionToken
  }
}
