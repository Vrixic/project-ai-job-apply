[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",

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
  [string]$AwsProfile,
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$RecoverFailedApply,
  [switch]$AllowArtifactReleaseUpdate,
  [switch]$VerifyCompletedDarkDeployment,
  [switch]$PlanRuntimeCutover,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Creates a refresh-backed plan for the selected environment's complete dark serverless workflow boundary.
It verifies immutable artifacts, reconstructs every live platform input, and keeps dispatch on
Temporal and all replacement triggers disabled. Use -RecoverFailedApply only after the guarded
initial apply stopped at the documented durable-role IAM propagation race; that mode requires the
effective DLQ permission and exact partial dark boundary before planning the remainder. Use
-VerifyCompletedDarkDeployment after the full apply to require a refresh-backed zero-change plan
while rechecking the immutable artifacts and complete trigger-disabled workflow boundary.
Use -AllowArtifactReleaseUpdate after a completed dark deployment to permit only the exact
workflow function, immutable version/alias, version-scoped policy, disabled terminal-rule, durable
stack, and policy-propagation updates caused by three new reviewed immutable artifacts.
Use -PlanRuntimeCutover only after the accepted dark boundary and legacy outbox are clean. It
permits the coupled API Lambda integration/routes, gateway Lambda durable-dispatch version, and
three replacement-trigger transitions while retaining idle ECS and the legacy rollback resources.

The sensitive plan remains below the ignored Terraform .terraform directory. This script rejects
every action outside its exact initial or partial-recovery boundary and never applies
infrastructure or changes traffic.
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
if (-not $AwsProfile) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}
if ($Region -ne "us-east-2") {
  throw "The Phase 0 $Environment environment is restricted to us-east-2."
}
if (@($RecoverFailedApply, $AllowArtifactReleaseUpdate, $VerifyCompletedDarkDeployment,
    $PlanRuntimeCutover |
    Where-Object { $_ }).Count -gt 1) {
  throw "Recovery, artifact release, completed-dark verification, and cutover planning are mutually exclusive."
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
$environmentDirectory = Join-Path $repositoryRoot "infrastructure/terraform/environments/$Environment"
$terraformDataDirectory = Join-Path $environmentDirectory ".terraform/dark-plan-data"
$planDirectory = Join-Path $environmentDirectory ".terraform/workflow-dark-plans"
$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$planPrefix = if ($PlanRuntimeCutover) {
  "serverless-runtime-cutover"
} elseif ($VerifyCompletedDarkDeployment) {
  "workflow-dark-verify"
} elseif ($AllowArtifactReleaseUpdate) {
  "workflow-dark-release"
} elseif ($RecoverFailedApply) {
  "workflow-dark-recovery"
} else {
  "workflow-dark"
}
$planPath = Join-Path $planDirectory "$planPrefix-$($sourceCommit.Substring(0, 8)).tfplan"
$resourcePrefix = "ai-job-apply-$Environment"

foreach ($command in @("aws", "git", "terraform")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required."
  }
}
$sourceBranch = (& git -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceBranch -ne "main") {
  throw "Generate a reviewable dark plan only from the main branch."
}
if ($sourceCommit -notmatch "^[a-f0-9]{40}$") {
  throw "The exact planner source commit could not be resolved."
}
$sourceStatus = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $sourceStatus.Count -ne 0) {
  throw "Generate a reviewable dark plan only from a clean worktree."
}
$upstreamCommit = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
if (
  $LASTEXITCODE -ne 0 -or
  $upstreamCommit -notmatch "^[a-f0-9]{40}$" -or
  $upstreamCommit -ne $sourceCommit
) {
  throw "The local main branch must exactly match its configured upstream."
}
$terraformVersion = (& terraform version -json | ConvertFrom-Json).terraform_version
if ([string]$terraformVersion -ne "1.9.8") {
  throw "Terraform 1.9.8 is required; found $terraformVersion."
}

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "An AWS read required for dark planning failed. Refresh the $Environment SSO session."
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
  if ($Plan.PSObject.Properties.Name -contains "state_resources") {
    foreach ($resource in @($Plan.state_resources)) {
      $baseAddress = @([string]$resource.module, [string]$resource.type, [string]$resource.name) |
        Where-Object { $_ }
      $baseAddress = $baseAddress -join "."
      foreach ($instance in @($resource.instances)) {
        $instanceAddress = $baseAddress
        $indexKeyProperty = @(
          $instance.PSObject.Properties | Where-Object { $_.Name -eq "index_key" }
        )
        if ($indexKeyProperty.Count -gt 1) {
          throw "The partial dark state contains an ambiguous resource index."
        }
        if ($indexKeyProperty.Count -eq 1 -and $null -ne $indexKeyProperty[0].Value) {
          $indexKey = $indexKeyProperty[0].Value
          $instanceAddress += if ($indexKey -is [string]) {
            "[`"$indexKey`"]"
          } else {
            "[$indexKey]"
          }
        }
        if ($instanceAddress -eq $Address) { return $instance.attributes }
      }
    }
    throw "The partial dark state is missing '$Address'."
  }
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
  throw "Use the temporary IAM Identity Center session for the exact $Environment account."
}

$baselinePlanPath = Join-Path $environmentDirectory (
  ".terraform/dark-plans/gateway-lambda-$($GatewayArtifactSourceSha.Substring(0, 8)).tfplan"
)
$baseline = $null
$acceptedEndpointSidCorrection = $false
if (
  -not $RecoverFailedApply -and
  -not $AllowArtifactReleaseUpdate -and
  -not $VerifyCompletedDarkDeployment -and
  -not $PlanRuntimeCutover
) {
try {
  $baselineRaw = & (Join-Path $PSScriptRoot "plan-gateway-lambda-dark.ps1") `
    -Environment $Environment `
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
  "worker_memory", "run_continuous_ecs_runtime", "enable_tracing", "otel_collector_image", "trace_sample_ratio",
  "high_availability", "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "temporal_address",
  "temporal_namespace", "deploy_applications", "deploy_gateway_lambda",
  "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
  "gateway_lambda_artifact_sha256", "gateway_lambda_artifact_base64sha256",
  "gateway_lambda_extension_layer_arn", "gateway_lambda_reserved_concurrency",
  "serverless_runtime_cutover", "deploy_serverless_outbox",
  "workflow_ingress_artifact_s3_key", "workflow_ingress_artifact_s3_object_version",
  "workflow_ingress_artifact_sha256", "workflow_ingress_artifact_base64sha256",
  "workflow_ingress_lambda_extension_layer_arn",
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
    throw "Short-lived $Environment credentials could not be exported."
  }
  $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
  $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
  $null = New-Item -ItemType Directory -Path $planDirectory -Force

  $stateEncryption = Invoke-AwsJson @(
    "s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json"
  )
  $stateKmsRules = @(
    $stateEncryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
    }
  )
  $stateKmsRule = Get-OnlyItem $stateKmsRules `
    "The $Environment state bucket does not expose one KMS default."
  $stateKmsKeyArn = [string]$stateKmsRule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if (
    $stateKmsKeyArn -notmatch
      "^arn:aws:kms:$([regex]::Escape($Region)):$([regex]::Escape($ExpectedAccountId)):key/"
  ) {
    throw "The $Environment state bucket KMS key is outside the expected account or region."
  }

  $initOutput = & terraform "-chdir=$environmentDirectory" init -reconfigure -input=false `
    -lockfile=readonly -no-color "-backend-config=bucket=$StateBucket" `
    "-backend-config=key=platform.tfstate" "-backend-config=region=$Region" `
    "-backend-config=kms_key_id=$stateKmsKeyArn" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "The pinned $Environment provider set could not be initialized."
  }

  if (
    $RecoverFailedApply -or $AllowArtifactReleaseUpdate -or
    $VerifyCompletedDarkDeployment -or $PlanRuntimeCutover
  ) {
    $baselinePlan = [pscustomobject]@{
      state_resources = @(
        (& terraform "-chdir=$environmentDirectory" state pull 2>$null | ConvertFrom-Json).resources
      )
    }
    if ($LASTEXITCODE -ne 0 -or $baselinePlan.state_resources.Count -eq 0) {
      throw "The partial $Environment state could not be inspected."
    }
  } else {
    $baselinePlan = & terraform "-chdir=$environmentDirectory" show -json `
      $baselinePlanPath 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "The completed dark baseline plan could not be inspected." }
  }

  $artifactBucket = & terraform "-chdir=$environmentDirectory" output -raw artifact_bucket 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $artifactBucket) {
    throw "The encrypted $Environment state does not expose the artifact bucket."
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

  if ($AllowArtifactReleaseUpdate -or $PlanRuntimeCutover) {
    $releaseFunctions = @(
      @("$resourcePrefix-outbox-starter", 1, $WorkflowIngressArtifactBase64Sha256, $true),
      @("$resourcePrefix-outbox-reconciler", 1, $WorkflowIngressArtifactBase64Sha256, $true),
      @("$resourcePrefix-profile-readiness-activity", 1, $ActivityArtifactBase64Sha256, $true),
      @("$resourcePrefix-profile-readiness-terminal", 1, $ActivityArtifactBase64Sha256, $true),
      @("$resourcePrefix-profile-readiness-durable", 2, $DurableArtifactBase64Sha256, $false)
    )
    foreach ($releaseFunction in $releaseFunctions) {
      $functionName = [string]$releaseFunction[0]
      $latest = Invoke-AwsJson @(
        "lambda", "get-function-configuration", "--function-name", $functionName,
        "--output", "json"
      )
      $alias = Invoke-AwsJson @(
        "lambda", "get-alias", "--function-name", $functionName,
        "--name", $Environment, "--output", "json"
      )
      $aliased = Invoke-AwsJson @(
        "lambda", "get-function-configuration", "--function-name", $functionName,
        "--qualifier", ([string]$alias.FunctionVersion), "--output", "json"
      )
      $reserved = Invoke-AwsJson @(
        "lambda", "get-function-concurrency", "--function-name", $functionName,
        "--output", "json"
      )
      $routingConfiguration = @(
        $alias.PSObject.Properties | Where-Object { $_.Name -eq "RoutingConfig" }
      )
      $additionalWeights = @(
        if (
          $routingConfiguration.Count -eq 1 -and
          $null -ne $routingConfiguration[0].Value
        ) {
          $routingConfiguration[0].Value.PSObject.Properties |
            Where-Object { $_.Name -eq "AdditionalVersionWeights" }
        }
      )
      $weights = if ($additionalWeights.Count -eq 1 -and $null -ne $additionalWeights[0].Value) {
        @($additionalWeights[0].Value.PSObject.Properties).Count
      } else {
        0
      }
      $layers = @(
        $latest.PSObject.Properties |
          Where-Object { $_.Name -eq "Layers" } |
          ForEach-Object { $_.Value } |
          Where-Object { $_ -and $_.Arn } |
          ForEach-Object { [string]$_.Arn }
      )
      $aliasedLayers = @(
        $aliased.PSObject.Properties |
          Where-Object { $_.Name -eq "Layers" } |
          ForEach-Object { $_.Value } |
          Where-Object { $_ -and $_.Arn } |
          ForEach-Object { [string]$_.Arn }
      )
      $expectedLayers = if ([bool]$releaseFunction[3]) { 1 } else { 0 }
      if (
        [string]$latest.State -ne "Active" -or
        [string]$latest.LastUpdateStatus -ne "Successful" -or
        [string]$latest.Runtime -ne "nodejs24.x" -or
        ($AllowArtifactReleaseUpdate -and
          [string]$latest.CodeSha256 -eq [string]$releaseFunction[2]) -or
        ($PlanRuntimeCutover -and
          [string]$latest.CodeSha256 -ne [string]$releaseFunction[2]) -or
        [string]$latest.CodeSha256 -ne [string]$aliased.CodeSha256 -or
        [string]$alias.FunctionVersion -notmatch "^[1-9][0-9]*$" -or
        [string]$aliased.Version -ne [string]$alias.FunctionVersion -or
        $weights -ne 0 -or
        [int]$reserved.ReservedConcurrentExecutions -ne [int]$releaseFunction[1] -or
        $layers.Count -ne $expectedLayers -or
        $aliasedLayers.Count -ne $expectedLayers -or
        ($expectedLayers -eq 1 -and $layers[0] -ne $PinnedExtensionLayerArn) -or
        ($expectedLayers -eq 1 -and $aliasedLayers[0] -ne $PinnedExtensionLayerArn) -or
        [string]$latest.Environment.Variables.RELEASE_SHA -ne
          [string]$aliased.Environment.Variables.RELEASE_SHA -or
        [string]$aliased.Environment.Variables.RELEASE_SHA -notmatch "^[a-f0-9]{64}$" -or
        [string]$latest.KMSKeyArn -ne [string]$aliased.KMSKeyArn -or
        [string]::IsNullOrWhiteSpace([string]$aliased.KMSKeyArn)
      ) {
        throw "The live '$functionName' Lambda is outside the healthy immutable release boundary."
      }
    }

    $mappings = Invoke-AwsJson @(
      "lambda", "list-event-source-mappings", "--function-name",
      "$resourcePrefix-outbox-starter`:$Environment", "--output", "json"
    )
    $mapping = Get-OnlyItem @($mappings.EventSourceMappings) `
      "The exact starter mapping is not singular."
    if (
      [string]$mapping.State -ne "Disabled" -or
      @($mapping.FunctionResponseTypes) -notcontains "ReportBatchItemFailures"
    ) {
      throw "The starter mapping is enabled or lacks partial-batch handling."
    }

    foreach ($ruleName in @(
      "$resourcePrefix-outbox-reconciler",
      "$resourcePrefix-profile-readiness-terminal"
    )) {
      $rule = Invoke-AwsJson @(
        "events", "describe-rule", "--name", $ruleName, "--output", "json"
      )
      if ([string]$rule.State -ne "DISABLED") {
        throw "A workflow EventBridge rule is enabled before the dark release."
      }
    }

    $alarmNames = @(
      "$resourcePrefix-outbox-reconciler-errors",
      "$resourcePrefix-outbox-starter-errors",
      "$resourcePrefix-outbox-starter-throttles",
      "$resourcePrefix-profile-readiness-activity-errors",
      "$resourcePrefix-profile-readiness-dead-letter",
      "$resourcePrefix-profile-readiness-durable-failed",
      "$resourcePrefix-profile-readiness-durable-timed-out"
    )
    $alarmResult = Invoke-AwsJson `
      (@("cloudwatch", "describe-alarms", "--alarm-names") + $alarmNames + @("--output", "json"))
    $healthyAlarms = @(
      $alarmResult.MetricAlarms | Where-Object {
        [string]$_.StateValue -eq "OK" -and [bool]$_.ActionsEnabled -and
        @($_.AlarmActions).Count -eq 1 -and @($_.OKActions).Count -eq 1
      }
    )
    if ($healthyAlarms.Count -ne 7) {
      throw "The exact seven workflow alarms are not enabled and OK."
    }

    $dlq = Invoke-AwsJson @(
      "sqs", "get-queue-url", "--queue-name",
      "$resourcePrefix-profile-readiness-dead-letter", "--output", "json"
    )
    $dlqDepth = Invoke-AwsJson @(
      "sqs", "get-queue-attributes", "--queue-url", ([string]$dlq.QueueUrl),
      "--attribute-names", "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed",
      "--output", "json"
    )
    if (
      [int]$dlqDepth.Attributes.ApproximateNumberOfMessages +
      [int]$dlqDepth.Attributes.ApproximateNumberOfMessagesNotVisible +
      [int]$dlqDepth.Attributes.ApproximateNumberOfMessagesDelayed -ne 0
    ) {
      throw "The durable DLQ is not empty before the dark release."
    }

    $durableStack = Invoke-AwsJson @(
      "cloudformation", "describe-stacks", "--stack-name",
      "$resourcePrefix-profile-readiness-durable", "--output", "json"
    )
    if (
      [string]$durableStack.Stacks[0].StackStatus -notin @(
        "CREATE_COMPLETE", "UPDATE_COMPLETE"
      )
    ) {
      throw "The durable stack is not complete before the dark release."
    }

    $apis = Invoke-AwsJson @("apigatewayv2", "get-apis", "--output", "json")
    $api = Get-OnlyItem @(
      $apis.Items | Where-Object { [string]$_.Name -eq "$resourcePrefix-gateway" }
    ) "The $Environment API is not singular before the dark release."
    $integrations = Invoke-AwsJson @(
      "apigatewayv2", "get-integrations", "--api-id", ([string]$api.ApiId), "--output", "json"
    )
    $integration = Get-OnlyItem @($integrations.Items) `
      "The $Environment API integration is not singular before the dark release."
    if (
      [string]$integration.IntegrationType -ne "HTTP_PROXY" -or
      [string]$integration.IntegrationUri -notmatch "^arn:aws:servicediscovery:"
    ) {
      throw "Public API traffic is no longer on the accepted Cloud Map/ECS rollback path."
    }

    $serviceResult = Invoke-AwsJson @(
      "ecs", "describe-services", "--cluster", $resourcePrefix, "--services",
      "gateway", "workflow-worker", "--output", "json"
    )
    if (@($serviceResult.failures).Count -ne 0 -or @($serviceResult.services).Count -ne 2) {
      throw "Both $Environment ECS rollback services must exist before the dark release."
    }
    $servicePostures = @($serviceResult.services | ForEach-Object {
      "$([int]$_.desiredCount)/$([int]$_.runningCount)/$([int]$_.pendingCount)"
    })
    if (
      -not (
        @($servicePostures | Where-Object { $_ -eq "1/1/0" }).Count -eq 2 -or
        @($servicePostures | Where-Object { $_ -eq "0/0/0" }).Count -eq 2
      )
    ) {
      throw "The retained ECS rollback services are not uniformly continuous or idle."
    }
    foreach ($service in @($serviceResult.services)) {
      $primaryDeployment = Get-OnlyItem @(
        $service.deployments | Where-Object { [string]$_.status -eq "PRIMARY" }
      ) "An ECS rollback service does not have one primary deployment."
      if (
        [string]$service.status -ne "ACTIVE" -or
        [string]$primaryDeployment.rolloutState -ne "COMPLETED"
      ) {
        throw "An ECS rollback service is not stable before the dark release."
      }
    }

    $gatewayAlias = Invoke-AwsJson @(
      "lambda", "get-function-configuration", "--function-name",
      "$resourcePrefix-gateway", "--qualifier", $Environment, "--output", "json"
    )
    if ([string]$gatewayAlias.Environment.Variables.OUTBOX_DISPATCH_TARGET -ne "temporal") {
      throw "The $Environment gateway no longer dispatches through the accepted Temporal path."
    }
  }

  $gatewayService = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_service.gateway[0]"
  $workerService = Get-BaselineValue $baselinePlan "module.platform.aws_ecs_service.worker[0]"
  $ecsRuntimeIdle = (
    [int]$gatewayService.desired_count -eq 0 -and
    [int]$workerService.desired_count -eq 0
  )
  if (
    -not $ecsRuntimeIdle -and
    (
      [int]$gatewayService.desired_count -ne 1 -or
      [int]$workerService.desired_count -ne 1
    )
  ) {
    throw "The retained ECS services are outside the accepted continuous or idle capacity boundary."
  }
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

  if ($PlanRuntimeCutover) {
    $inspectionRaw = & (Join-Path $PSScriptRoot "inspect-deployed-outbox.ps1") `
      -Environment $Environment -AwsProfile $AwsProfile -Region $Region -Execute
    if ($LASTEXITCODE -ne 0) {
      throw "The bounded pre-cutover outbox inspection did not complete successfully."
    }
    try {
      $outboxInspection = ($inspectionRaw -join "`n") | ConvertFrom-Json
    } catch {
      throw "The bounded pre-cutover outbox inspection did not return one sanitized result."
    }
    if (
      [int]$outboxInspection.version -ne 1 -or
      [int]$outboxInspection.pendingCount -ne 0 -or
      [string]$outboxInspection.orderedEventIdSha256 -notmatch "^[a-f0-9]{64}$"
    ) {
      throw "Serverless cutover requires a fresh zero-pending-outbox inspection."
    }

    $temporalOutput = & node (Join-Path $repositoryRoot "backend/workflows/cloud-conformance.mjs") `
      --profile $AwsProfile --region $Region `
      --secret-id "ai-job-apply/$Environment/temporal-api-key" `
      --address ([string]$workerEnvironment["TEMPORAL_ADDRESS"]) `
      --namespace ([string]$workerEnvironment["TEMPORAL_NAMESPACE"]) `
      --require-zero-open-workflows 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Serverless cutover requires a fresh zero-running-Temporal-workflow check."
    }
  }

  $env:TF_VAR_gateway_image = [string]$gatewayContainer.image
  $env:TF_VAR_worker_image = [string]$workerContainer.image
  $env:TF_VAR_migration_image = [string]$migrationContainer.image
  $env:TF_VAR_gateway_desired_count = "1"
  $env:TF_VAR_gateway_cpu = [string]$gatewayTask.cpu
  $env:TF_VAR_gateway_memory = [string]$gatewayTask.memory
  $env:TF_VAR_worker_desired_count = "1"
  $env:TF_VAR_run_continuous_ecs_runtime = (-not $ecsRuntimeIdle).ToString().ToLowerInvariant()
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
  $env:TF_VAR_serverless_runtime_cutover = $PlanRuntimeCutover.ToString().ToLowerInvariant()
  $env:TF_VAR_deploy_serverless_outbox = "true"
  $env:TF_VAR_workflow_ingress_artifact_s3_key = $WorkflowIngressArtifactS3Key
  $env:TF_VAR_workflow_ingress_artifact_s3_object_version = $WorkflowIngressArtifactS3ObjectVersion
  $env:TF_VAR_workflow_ingress_artifact_sha256 = $WorkflowIngressArtifactSha256
  $env:TF_VAR_workflow_ingress_artifact_base64sha256 = $WorkflowIngressArtifactBase64Sha256
  $env:TF_VAR_workflow_ingress_lambda_extension_layer_arn = $PinnedExtensionLayerArn
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
  $expectedPlanExitCode = if ($VerifyCompletedDarkDeployment) { 0 } else { 2 }
  if ($LASTEXITCODE -ne $expectedPlanExitCode) {
    $diagnostic = (@($planOutput) | Select-Object -Last 12) -join " "
    $expectedResult = if ($VerifyCompletedDarkDeployment) { "zero-change" } else { "change-only" }
    throw "The dark workflow plan did not produce a $expectedResult result: $diagnostic"
  }
  $plan = & terraform "-chdir=$environmentDirectory" show -json $planPath 2>$null |
    ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "The dark workflow plan could not be inspected." }
  $changes = @(
    $plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("no-op", "read")
    }
  )

  if ($VerifyCompletedDarkDeployment -and $changes.Count -ne 0) {
    throw "The completed workflow dark-deployment plan is not zero-change."
  }

  $initialExpectedCreates = @(
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
    "module.platform.aws_vpc_endpoint.sqs[0]",
    "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
  )
  $initialExpectedUpdates = @(
    "module.platform.aws_iam_role_policy.gateway_lambda[0]",
    "module.platform.aws_kms_key.platform",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_function.gateway[0]",
    "module.platform.aws_vpc_endpoint.secretsmanager[0]"
  )
  $recoveryExpectedCreates = @(
    "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_cloudwatch_event_target.profile_readiness_terminal[0]",
    "module.platform.aws_cloudwatch_metric_alarm.outbox_starter_errors[0]",
    "module.platform.aws_cloudwatch_metric_alarm.outbox_starter_throttles[0]",
    "module.platform.aws_iam_role_policy.outbox_starter[0]",
    "module.platform.aws_lambda_alias.outbox_starter[0]",
    "module.platform.aws_lambda_alias.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_function.outbox_starter[0]",
    "module.platform.aws_lambda_function.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_permission.profile_readiness_terminal[0]",
    "module.platform.aws_sqs_queue_policy.profile_readiness_dead_letter[0]",
    "module.platform.aws_vpc_endpoint.lambda[0]",
    "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
  )
  $releaseExpectedUpdates = @(
    "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_iam_role_policy.outbox_starter[0]",
    "module.platform.aws_iam_role_policy.profile_readiness_durable[0]",
    "module.platform.aws_lambda_alias.outbox_reconciler[0]",
    "module.platform.aws_lambda_alias.outbox_starter[0]",
    "module.platform.aws_lambda_alias.profile_readiness_activity[0]",
    "module.platform.aws_lambda_alias.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_function.outbox_reconciler[0]",
    "module.platform.aws_lambda_function.outbox_starter[0]",
    "module.platform.aws_lambda_function.profile_readiness_activity[0]",
    "module.platform.aws_lambda_function.profile_readiness_terminal[0]",
    "module.platform.aws_sqs_queue_policy.profile_readiness_dead_letter[0]",
    "module.platform.aws_vpc_endpoint.lambda[0]"
  )
  $releaseExpectedReplacements = @(
    "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
  )
  $cutoverExpectedCreates = @(
    "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]",
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]'
  )
  $cutoverExpectedUpdates = @(
    "module.platform.aws_apigatewayv2_route.gateway[0]",
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_lambda_alias.gateway[0]",
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_function.gateway[0]"
  )
  $expectedCreates = @(
    if ($PlanRuntimeCutover) {
      $cutoverExpectedCreates
    } elseif ($RecoverFailedApply) {
      $recoveryExpectedCreates
    } elseif (-not ($AllowArtifactReleaseUpdate -or $VerifyCompletedDarkDeployment)) {
      $initialExpectedCreates
    }
  )
  $expectedUpdates = @(
    if ($PlanRuntimeCutover) {
      $cutoverExpectedUpdates
    } elseif ($AllowArtifactReleaseUpdate) {
      $releaseExpectedUpdates
    } elseif (-not ($VerifyCompletedDarkDeployment -or $RecoverFailedApply)) {
      $initialExpectedUpdates
    }
  )
  $expectedReplacements = @(
    if ($AllowArtifactReleaseUpdate) {
      $releaseExpectedReplacements
    }
  )
  $creates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "create" })
  $updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" })
  $replacements = @(
    $changes | Where-Object { (@($_.change.actions) -join ",") -eq "create,delete" }
  )
  $otherActions = @(
    $changes | Where-Object {
      (@($_.change.actions) -join ",") -notin @("create", "update", "create,delete")
    }
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
  $unexpectedReplacements = @(
    $replacements | Where-Object { $expectedReplacements -notcontains [string]$_.address }
  )
  $missingReplacements = @(
    $expectedReplacements | Where-Object {
      @($replacements | ForEach-Object { [string]$_.address }) -notcontains $_
    }
  )
  if (
    $otherActions.Count -ne 0 -or
    $creates.Count -ne $expectedCreates.Count -or
    $updates.Count -ne $expectedUpdates.Count -or
    $replacements.Count -ne $expectedReplacements.Count -or
    $unexpectedCreates.Count -ne 0 -or $missingCreates.Count -ne 0 -or
    $unexpectedUpdates.Count -ne 0 -or $missingUpdates.Count -ne 0 -or
    $unexpectedReplacements.Count -ne 0 -or $missingReplacements.Count -ne 0
  ) {
    throw "The plan contains an action outside the exact reviewed dark boundary for this mode."
  }

  function Get-PlannedChange {
    param([string]$Address)
    return Get-OnlyItem `
      -Items @($changes | Where-Object { [string]$_.address -eq $Address }) `
      -FailureMessage "The reviewed plan change '$Address' is missing."
  }

  function Get-PlannedValue {
    param([string]$Address)
    $resource = Get-OnlyItem `
      -Items @($plan.resource_changes | Where-Object { [string]$_.address -eq $Address }) `
      -FailureMessage "The reviewed planned resource '$Address' is missing."
    if ((@($resource.change.actions) -join ",") -eq "delete") {
      throw "The reviewed planned resource '$Address' is being deleted."
    }
    return $resource.change.after
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

  if (
    -not $RecoverFailedApply -and
    -not $AllowArtifactReleaseUpdate -and
    -not $VerifyCompletedDarkDeployment -and
    -not $PlanRuntimeCutover
  ) {
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
  }

  if ($PlanRuntimeCutover) {
    $gatewayFunctionChange = Get-PlannedChange "module.platform.aws_lambda_function.gateway[0]"
    Assert-OnlyPropertiesChanged $gatewayFunctionChange @(
      "environment", "last_modified", "qualified_arn", "qualified_invoke_arn", "version"
    ) "The cutover gateway update changes more than dispatch environment and immutable version."
    $beforeGatewayVariables = $gatewayFunctionChange.change.before.environment[0].variables
    $afterGatewayVariables = $gatewayFunctionChange.change.after.environment[0].variables
    if (
      [string]$beforeGatewayVariables.OUTBOX_DISPATCH_TARGET -ne "temporal" -or
      [string]$afterGatewayVariables.OUTBOX_DISPATCH_TARGET -ne "lambda_durable" -or
      (Compare-Object @($beforeGatewayVariables.PSObject.Properties.Name | Sort-Object) `
        @($afterGatewayVariables.PSObject.Properties.Name | Sort-Object))
    ) {
      throw "The cutover gateway version does not change only Temporal dispatch to Lambda durable."
    }
    foreach ($name in @($beforeGatewayVariables.PSObject.Properties.Name)) {
      if (
        $name -ne "OUTBOX_DISPATCH_TARGET" -and
        [string]$beforeGatewayVariables.$name -ne [string]$afterGatewayVariables.$name
      ) {
        throw "The cutover gateway version changes an unrelated environment value."
      }
    }

    $gatewayAliasChange = Get-PlannedChange "module.platform.aws_lambda_alias.gateway[0]"
    Assert-OnlyPropertiesChanged $gatewayAliasChange @("function_version") `
      "The cutover gateway alias changes more than its immutable version."
    if (-not [bool]$gatewayAliasChange.change.after_unknown.function_version) {
      throw "The cutover alias is not bound to the exact gateway version created by the plan."
    }

    $lambdaIntegration = Get-PlannedValue `
      "module.platform.aws_apigatewayv2_integration.gateway_lambda[0]"
    if (
      [string]$lambdaIntegration.integration_type -ne "AWS_PROXY" -or
      [string]$lambdaIntegration.integration_method -ne "POST" -or
      [string]$lambdaIntegration.payload_format_version -ne "2.0" -or
      [int]$lambdaIntegration.timeout_milliseconds -ne 15000
    ) {
      throw "The cutover Lambda integration is outside the reviewed HTTP API v2 boundary."
    }

    $defaultRoute = Get-PlannedValue "module.platform.aws_apigatewayv2_route.gateway[0]"
    if (
      [string]$defaultRoute.route_key -ne '$default' -or
      [string]$defaultRoute.authorization_type -ne "JWT"
    ) {
      throw "The cutover default route is not protected by the reviewed JWT authorizer."
    }
    foreach ($routeKey in @("GET /health/live", "GET /health/ready")) {
      $route = Get-PlannedValue `
        "module.platform.aws_apigatewayv2_route.gateway_lambda_public[`"$routeKey`"]"
      if (
        [string]$route.route_key -ne $routeKey -or
        [string]$route.authorization_type -ne "NONE"
      ) {
        throw "The cutover exposes a public route outside the exact health boundary."
      }
    }
  }

  if ($AllowArtifactReleaseUpdate) {
    function Assert-ReleaseFunctionChange {
      param(
        [string]$Address,
        [string]$ArtifactKey,
        [string]$ArtifactVersion,
        [string]$ArtifactBase64Sha256,
        [string]$ArtifactSha256,
        [bool]$EnvironmentRemainsKnown,
        [string[]]$ExpectedEnvironmentNames
      )
      $change = Get-PlannedChange $Address
      Assert-OnlyPropertiesChanged $change @(
        "environment", "last_modified", "qualified_arn", "qualified_invoke_arn",
        "s3_key", "s3_object_version", "source_code_hash", "version"
      ) "A workflow Lambda release changes more than artifact identity and computed version fields."
      $before = $change.change.before
      $after = $change.change.after
      if (
        [string]$after.s3_key -ne $ArtifactKey -or
        [string]$after.s3_object_version -ne $ArtifactVersion -or
        [string]$after.source_code_hash -ne $ArtifactBase64Sha256 -or
        -not [bool]$change.change.after_unknown.version
      ) {
        throw "A workflow Lambda release does not select its exact immutable artifact/version."
      }
      $beforeVariables = $before.environment[0].variables
      $beforeNames = @($beforeVariables.PSObject.Properties.Name | Sort-Object)
      if (Compare-Object $beforeNames @($ExpectedEnvironmentNames | Sort-Object)) {
        throw "A live workflow Lambda has an unexpected environment boundary before release."
      }
      if ($EnvironmentRemainsKnown) {
        $afterVariables = $after.environment[0].variables
        if ([string]$afterVariables.RELEASE_SHA -ne $ArtifactSha256) {
          throw "A workflow Lambda release does not select the exact artifact release digest."
        }
        $normalizedAfterEnvironment = $after.environment |
          ConvertTo-Json -Depth 30 | ConvertFrom-Json
        $normalizedAfterEnvironment[0].variables.RELEASE_SHA = [string]$beforeVariables.RELEASE_SHA
        if (
          ($before.environment | ConvertTo-Json -Depth 30 -Compress) -ne
          ($normalizedAfterEnvironment | ConvertTo-Json -Depth 30 -Compress)
        ) {
          throw "A workflow Lambda release changes more than its artifact release digest."
        }
      } elseif (-not [bool]$change.change.after_unknown.environment.variables) {
        throw "A version-coupled workflow Lambda environment is not explicitly plan-time unknown."
      }
    }

    Assert-ReleaseFunctionChange `
      "module.platform.aws_lambda_function.outbox_reconciler[0]" `
      $WorkflowIngressArtifactS3Key $WorkflowIngressArtifactS3ObjectVersion `
      $WorkflowIngressArtifactBase64Sha256 $WorkflowIngressArtifactSha256 $true `
      @("DATABASE_SECRET_ID", "NODE_ENV", "OUTBOX_QUEUE_URL", "RELEASE_SHA")
    Assert-ReleaseFunctionChange `
      "module.platform.aws_lambda_function.outbox_starter[0]" `
      $WorkflowIngressArtifactS3Key $WorkflowIngressArtifactS3ObjectVersion `
      $WorkflowIngressArtifactBase64Sha256 $WorkflowIngressArtifactSha256 $false `
      @("DATABASE_SECRET_ID", "DURABLE_FUNCTION_ARN", "NODE_ENV", "RELEASE_SHA")
    Assert-ReleaseFunctionChange `
      "module.platform.aws_lambda_function.profile_readiness_activity[0]" `
      $ActivityArtifactS3Key $ActivityArtifactS3ObjectVersion `
      $ActivityArtifactBase64Sha256 $ActivityArtifactSha256 $true `
      @("DATABASE_SECRET_ID", "NODE_ENV", "RELEASE_SHA")
    Assert-ReleaseFunctionChange `
      "module.platform.aws_lambda_function.profile_readiness_terminal[0]" `
      $ActivityArtifactS3Key $ActivityArtifactS3ObjectVersion `
      $ActivityArtifactBase64Sha256 $ActivityArtifactSha256 $false `
      @("DATABASE_SECRET_ID", "DURABLE_FUNCTION_ARN", "NODE_ENV", "RELEASE_SHA")

    foreach ($aliasAddress in @(
      "module.platform.aws_lambda_alias.outbox_reconciler[0]",
      "module.platform.aws_lambda_alias.outbox_starter[0]",
      "module.platform.aws_lambda_alias.profile_readiness_activity[0]",
      "module.platform.aws_lambda_alias.profile_readiness_terminal[0]"
    )) {
      $aliasChange = Get-PlannedChange $aliasAddress
      Assert-OnlyPropertiesChanged $aliasChange @("function_version") `
        "A workflow Lambda alias release changes more than its immutable function version."
      if (-not [bool]$aliasChange.change.after_unknown.function_version) {
        throw "A workflow Lambda alias is not moving to the version created by this exact plan."
      }
    }

    foreach ($policyAddress in @(
      "module.platform.aws_iam_role_policy.outbox_starter[0]",
      "module.platform.aws_iam_role_policy.profile_readiness_durable[0]",
      "module.platform.aws_sqs_queue_policy.profile_readiness_dead_letter[0]",
      "module.platform.aws_vpc_endpoint.lambda[0]"
    )) {
      $policyChange = Get-PlannedChange $policyAddress
      Assert-OnlyPropertiesChanged $policyChange @("policy") `
        "A version-scoped workflow release policy changes more than its policy document."
      if (-not [bool]$policyChange.change.after_unknown.policy) {
        throw "A version-scoped workflow release policy is not explicitly plan-time unknown."
      }
    }

    $terminalRuleChange = Get-PlannedChange `
      "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]"
    Assert-OnlyPropertiesChanged $terminalRuleChange @("event_pattern") `
      "The terminal rule release changes more than its exact durable-version event pattern."
    if (
      [string]$terminalRuleChange.change.before.state -ne "DISABLED" -or
      [string]$terminalRuleChange.change.after.state -ne "DISABLED" -or
      -not [bool]$terminalRuleChange.change.after_unknown.event_pattern
    ) {
      throw "The terminal rule release is enabled or its version pattern is not plan-time unknown."
    }

    $durableChange = Get-PlannedChange `
      "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]"
    Assert-OnlyPropertiesChanged $durableChange @("outputs", "template_body") `
      "The durable release changes more than its template and computed outputs."
    if (-not [bool]$durableChange.change.after_unknown.template_body) {
      throw "The activity-version-coupled durable template is not explicitly plan-time unknown."
    }
    $currentTemplate = [string]$durableChange.change.before.template_body | ConvertFrom-Json
    $currentDurable = $currentTemplate.Resources.DurableFunction.Properties
    if (
      [string]$currentDurable.Runtime -ne "nodejs24.x" -or
      [int]$currentDurable.ReservedConcurrentExecutions -ne 2 -or
      [string]$currentTemplate.Resources.DurableVersion.DeletionPolicy -ne "Retain" -or
      [string]$currentTemplate.Resources.DurableVersion.UpdateReplacePolicy -ne "Retain" -or
      [string]$currentTemplate.Resources.DurableAlias.Properties.Name -ne $Environment
    ) {
      throw "The current durable function is outside the retained immutable release boundary."
    }

    $propagationChange = Get-PlannedChange `
      "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
    if ((@($propagationChange.change.actions) -join ",") -ne "create,delete") {
      throw "The durable policy propagation gate is not a create-before-delete replacement."
    }
    Assert-OnlyPropertiesChanged $propagationChange @("id", "triggers") `
      "The durable policy propagation replacement changes more than its policy hash."
    if (
      [string]$propagationChange.change.before.create_duration -ne "45s" -or
      [string]$propagationChange.change.after.create_duration -ne "45s" -or
      [string]$propagationChange.change.before.triggers.role_arn -ne
        [string]$propagationChange.change.after.triggers.role_arn -or
      -not [bool]$propagationChange.change.after_unknown.triggers.policy_sha256
    ) {
      throw "The durable policy propagation replacement is outside its exact 45-second boundary."
    }
  }

  $starterMapping = Get-PlannedValue `
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]"
  $expectedTriggerEnabled = [bool]$PlanRuntimeCutover
  if (
    [bool]$starterMapping.enabled -ne $expectedTriggerEnabled -or
    @($starterMapping.function_response_types) -notcontains "ReportBatchItemFailures"
  ) {
    throw "The SQS starter mapping does not match the reviewed runtime state or partial-batch boundary."
  }
  foreach ($ruleAddress in @(
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]"
  )) {
    $expectedRuleState = if ($PlanRuntimeCutover) { "ENABLED" } else { "DISABLED" }
    if ([string](Get-PlannedValue $ruleAddress).state -ne $expectedRuleState) {
      throw "A serverless workflow EventBridge trigger does not match the reviewed runtime state."
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
    $function = Get-PlannedValue ([string]$expectedFunction[0])
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

  $durableStackChange = $null
  $durableStack = Get-PlannedValue `
    "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]"
  if (
    [string]$durableStack.name -ne "$resourcePrefix-profile-readiness-durable" -or
    [string]$durableStack.on_failure -ne "DELETE"
  ) {
    throw "The durable CloudFormation stack is outside the reviewed $Environment boundary."
  }
  $durableTemplateBodyProperty = @(
    $durableStack.PSObject.Properties | Where-Object { $_.Name -eq "template_body" }
  )
  if ($durableTemplateBodyProperty.Count -gt 1) {
    throw "The durable stack contains an ambiguous template body."
  }
  if (
    $durableTemplateBodyProperty.Count -eq 1 -and
    -not [string]::IsNullOrWhiteSpace([string]$durableTemplateBodyProperty[0].Value)
  ) {
    $template = [string]$durableTemplateBodyProperty[0].Value | ConvertFrom-Json
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
  } elseif ($VerifyCompletedDarkDeployment -or $PlanRuntimeCutover) {
    throw "The completed durable stack template is unavailable for exact verification."
  } else {
    $durableStackChange = Get-PlannedChange `
      "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]"
    if ([bool]$durableStackChange.change.after_unknown.template_body) {
      # The initial/recovery create can remain role-dependent until apply.
    } else {
      throw "The durable stack template is neither exact nor role-dependent unknown."
    }
  }

  $propagation = Get-PlannedValue `
    "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
  $initialDarkDeployment = -not (
    $RecoverFailedApply -or
    $AllowArtifactReleaseUpdate -or
    $VerifyCompletedDarkDeployment -or
    $PlanRuntimeCutover
  )
  $propagationResourceChange = Get-OnlyItem `
    -Items @($plan.resource_changes | Where-Object {
        [string]$_.address -eq
          "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]"
      }) `
    -FailureMessage "The durable IAM propagation gate is not singular."
  $durableRoleValue = Get-PlannedValue `
    "module.platform.aws_iam_role.profile_readiness_durable[0]"
  $durableRoleResourceChange = Get-OnlyItem `
    -Items @($plan.resource_changes | Where-Object {
        [string]$_.address -eq "module.platform.aws_iam_role.profile_readiness_durable[0]"
      }) `
    -FailureMessage "The durable execution role is not singular."
  $propagationRoleValid = if ($initialDarkDeployment) {
    [bool]$propagationResourceChange.change.after_unknown.triggers.role_arn -and
    [bool]$durableRoleResourceChange.change.after_unknown.arn
  } else {
    -not [string]::IsNullOrWhiteSpace([string]$propagation.triggers.role_arn) -and
    [string]$propagation.triggers.role_arn -eq [string]$durableRoleValue.arn
  }
  $propagationPolicyHashValid = if (
    $initialDarkDeployment -or $AllowArtifactReleaseUpdate
  ) {
    [bool]$propagationResourceChange.change.after_unknown.triggers.policy_sha256
  } else {
    -not [string]::IsNullOrWhiteSpace([string]$propagation.triggers.policy_sha256)
  }
  if (
    [string]$propagation.create_duration -ne "45s" -or
    -not $propagationRoleValid -or
    -not $propagationPolicyHashValid
  ) {
    throw "The dark plan does not contain the exact durable IAM propagation gate."
  }

  if ($RecoverFailedApply) {
    $durableRole = Get-BaselineValue $baselinePlan `
      "module.platform.aws_iam_role.profile_readiness_durable[0]"
    $deadLetterQueue = Get-BaselineValue $baselinePlan `
      "module.platform.aws_sqs_queue.profile_readiness_dead_letter[0]"
    $permissionDecision = & aws iam simulate-principal-policy --profile $AwsProfile `
      --policy-source-arn ([string]$durableRole.arn) --action-names "sqs:SendMessage" `
      --resource-arns ([string]$deadLetterQueue.arn) `
      --query "EvaluationResults[0].EvalDecision" --output text 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]$permissionDecision.Trim() -ne "allowed") {
      throw "The durable role's exact DLQ permission is not yet effective."
    }
    $existingDurable = & aws lambda get-function --profile $AwsProfile --region $Region `
      --function-name "$resourcePrefix-profile-readiness-durable" `
      --query "Configuration.FunctionName" --output text 2>$null
    if ($LASTEXITCODE -eq 0 -or $existingDurable) {
      throw "The failed durable function unexpectedly exists before recovery."
    }
  }

  $changedAddresses = @($changes | ForEach-Object { [string]$_.address })
  $unexpectedApiOrEcsChanges = @($changedAddresses | Where-Object {
      ($_ -match "aws_ecs_(service|task_definition|cluster)") -or
      (
        $_ -match "aws_apigatewayv2_(api|integration|route|stage)" -and
        $expectedCreates -notcontains $_ -and
        $expectedUpdates -notcontains $_
      )
    })
  if ($unexpectedApiOrEcsChanges.Count -ne 0) {
    throw "The workflow plan changes API or ECS resources outside the reviewed mode boundary."
  }

  $planHash = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Environment                 = $Environment
    SourceCommit               = $sourceCommit
    WorkflowArtifactSourceCommit = $WorkflowArtifactSourceSha
    RecoveryFromFailedApply    = [bool]$RecoverFailedApply
    ArtifactReleaseUpdate      = [bool]$AllowArtifactReleaseUpdate
    CompletedDarkVerification  = [bool]$VerifyCompletedDarkDeployment
    RuntimeCutover             = [bool]$PlanRuntimeCutover
    NoDrift                    = [bool]$VerifyCompletedDarkDeployment
    GatewayEcsApiBaselineStable = $true
    EcsRuntimeIdle             = [bool]$ecsRuntimeIdle
    LegacyOutboxEmpty          = if ($PlanRuntimeCutover) { $true } else { $null }
    TemporalOpenWorkflowsEmpty = if ($PlanRuntimeCutover) { $true } else { $null }
    EndpointSidCorrection      = $acceptedEndpointSidCorrection
    EffectiveDurableDlqPermission = if ($RecoverFailedApply) { $true } else { $null }
    ArtifactsVerified          = 3
    PinnedExtensionVerified    = $true
    DispatchTarget             = if ($PlanRuntimeCutover) { "lambda_durable" } else { "temporal" }
    TriggersEnabled            = [bool]$PlanRuntimeCutover
    ApiTrafficChange           = [bool]$PlanRuntimeCutover
    EcsCapacityChange          = $false
    Creates                    = $creates.Count
    Updates                    = $updates.Count
    Deletes                    = 0
    Replacements               = $replacements.Count
    PlanSha256                 = $planHash
    SensitivePlanPath          = $planPath
    CreatedResources           = [object[]]$expectedCreates
    UpdatedResources           = [object[]]$expectedUpdates
    ReplacedResources          = [object[]]$expectedReplacements
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
