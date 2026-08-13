[CmdletBinding()]
param(
  [ValidateSet("Status", "Plan", "Apply", "PlanTraffic", "ApplyTraffic")]
  [string]$Action = "Status",

  [ValidateSet("active", "quiesced", "dormant")]
  [string]$TargetMode = "dormant",

  [ValidateSet("enabled", "disabled")]
  [string]$TrafficTarget = "enabled",

  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [string]$RuntimePlanPath = "",
  [string]$PlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPlanSha256 = "",

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-staging-runtime-lifecycle.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-staging-runtime-lifecycle.ps1 -Action Plan `
    -TargetMode quiesced -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/APPLIED_ACTIVE_PLAN.tfplan

  .\scripts\operate-staging-runtime-lifecycle.ps1 -Action Apply `
    -TargetMode quiesced -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/staging-lifecycle/quiesced-....tfplan `
    -ReviewedPlanSha256 64_CHARACTER_SHA256

  .\scripts\operate-staging-runtime-lifecycle.ps1 -Action PlanTraffic `
    -TrafficTarget enabled -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -RuntimePlanPath .terraform/staging-lifecycle/APPLIED_ACTIVE_PLAN.tfplan

  .\scripts\operate-staging-runtime-lifecycle.ps1 -Action ApplyTraffic `
    -TrafficTarget enabled -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath .terraform/staging-lifecycle/traffic-enabled-....tfplan `
    -ReviewedPlanSha256 64_CHARACTER_SHA256

The lifecycle is deliberately two-step when turning staging off:
  active -> quiesced -> dormant

Quiesced disables every public route and workflow trigger, verifies empty queues, and removes RDS
deletion protection while retaining the database. Dormant then destroys the disposable synthetic
RDS instance, its Terraform-managed current connection value, database alarms/migration task, and
the hourly interface endpoints plus the document processor's S3 gateway endpoint when that
capability is deployed. It retains encrypted Terraform state, KMS, artifacts, ECR,
IAM, queues/DLQs, logs, alarms, API/Lambda definitions, and cost controls.

Activation is also dark-first:
  dormant -> active -> migrate/verify -> separately enable serverless traffic

Base traffic enablement creates exactly three routes and enables the outbox mapping plus its two
EventBridge rules only
after active data-plane verification. Traffic disablement is the exact inverse and requires empty
queues. Neither traffic transition may change artifacts, data resources, IAM, or observability.

Plan requires an already-applied saved plan so immutable artifact and non-secret deployment inputs
can be recovered exactly. Apply accepts only the exact checksum-reviewed saved plan and matching
metadata. Plans and metadata must stay under the ignored staging .terraform directory.
"@
  exit 0
}

if ($Region -ne "us-east-2") {
  throw "Staging is restricted to us-east-2."
}
if ($ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact staging account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\staging"
$allowedPlanRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$lifecyclePlanRoot = Join-Path $allowedPlanRoot "staging-lifecycle"
$terraformDataDirectory = Join-Path $allowedPlanRoot "staging-lifecycle-data"
$allowedVariableNames = @(
  "migration_image", "high_availability", "staging_runtime_mode",
  "private_application_networking", "enable_redis", "database_instance_class",
  "database_engine_version", "database_performance_insights", "enable_container_insights",
  "oidc_issuer", "oidc_audience", "deploy_applications", "deploy_gateway_lambda",
  "gateway_lambda_artifact_s3_key", "gateway_lambda_artifact_s3_object_version",
  "gateway_lambda_artifact_sha256", "gateway_lambda_artifact_base64sha256",
  "gateway_lambda_extension_layer_arn", "gateway_lambda_reserved_concurrency",
  "deploy_serverless_outbox", "workflow_ingress_artifact_s3_key",
  "workflow_ingress_artifact_s3_object_version", "workflow_ingress_artifact_sha256",
  "workflow_ingress_artifact_base64sha256", "workflow_ingress_lambda_extension_layer_arn",
  "deploy_profile_readiness_durable", "profile_readiness_durable_artifact_s3_key",
  "profile_readiness_durable_artifact_s3_object_version",
  "profile_readiness_durable_artifact_sha256",
  "profile_readiness_durable_artifact_base64sha256",
  "profile_readiness_activity_artifact_s3_key",
  "profile_readiness_activity_artifact_s3_object_version",
  "profile_readiness_activity_artifact_sha256",
  "profile_readiness_activity_artifact_base64sha256",
  "profile_readiness_lambda_extension_layer_arn",
  "profile_readiness_execution_timeout_seconds", "profile_readiness_retention_days",
  "document_processing_deployment_stage", "document_parser_invocation_qualified_arn",
  "deploy_document_processing",
  "document_scan_mapping_enabled",
  "document_scan_event_rule_enabled",
  "document_security_health_rules_enabled",
  "document_processor_artifact_s3_key", "document_processor_artifact_s3_object_version",
  "document_processor_artifact_sha256", "document_processor_artifact_base64sha256",
  "document_processor_extension_layer_arn", "document_parser_artifact_s3_key",
  "document_parser_artifact_s3_object_version", "document_parser_artifact_sha256",
  "document_parser_artifact_base64sha256", "document_parser_version",
  "serverless_runtime_enabled"
)

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "AWS operation '$($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ')' failed. Refresh the staging SSO session and retry."
  }
  if (-not $raw) { return $null }
  return $raw | ConvertFrom-Json
}

function Assert-CallerAndTools {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if ([string]$identity.Account -cne $ExpectedAccountId) {
    throw "The AWS caller is not the exact staging account."
  }
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use a temporary staging IAM Identity Center session; long-lived callers are rejected."
  }

  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]$version.terraform_version -ne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
}

function Assert-CleanMergedMain {
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $upstream -or $dirty.Count -ne 0) {
    throw "Lifecycle plans require a clean main checkout exactly matching origin/main."
  }
  return $head
}

function Initialize-Backend {
  $encryption = Invoke-AwsJson @(
    "s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json"
  )
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
    })
  if ($rules.Count -ne 1) {
    throw "The staging state bucket must expose exactly one KMS default."
  }
  $kmsKeyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($kmsKeyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact staging account and region."
  }

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsKeyArn" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted staging backend could not be initialized." }
}

function Resolve-PlanBelowTerraformData {
  param([Parameter(Mandatory)][string]$Candidate, [switch]$MustExist)

  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) { [IO.Path]::GetFullPath($Candidate) }
    else { [IO.Path]::GetFullPath((Join-Path $terraformDirectory $Candidate)) }
  $prefix = $allowedPlanRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Plan paths must stay below the ignored staging .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The required saved plan does not exist."
  }
  return $resolved
}

function Set-VariablesFromAppliedPlan {
  param(
    [Parameter(Mandatory)][string]$SourcePlanPath,
    [Parameter(Mandatory)][ValidateSet("active", "quiesced", "dormant")][string]$StagingMode,
    [Parameter(Mandatory)][bool]$RuntimeEnabled
  )

  $source = Resolve-PlanBelowTerraformData -Candidate $SourcePlanPath -MustExist
  $plan = & terraform "-chdir=$terraformDirectory" show -json $source 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $null -eq $plan.variables) {
    throw "The already-applied runtime plan could not be inspected."
  }
  $properties = @($plan.variables.PSObject.Properties)
  $unexpected = @($properties | Where-Object { $_.Name -notin $allowedVariableNames })
  if ($unexpected.Count -ne 0) {
    throw "The source plan contains an unapproved staging input: $($unexpected.Name -join ', ')."
  }
  foreach ($property in $properties) {
    if ([string]$property.Name -ceq "deploy_document_processing") {
      if ([bool]$property.Value.value) {
        throw "The staging lifecycle operator cannot migrate an active legacy document-processing boundary."
      }
      continue
    }
    $value = $property.Value.value
    $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
      elseif ($value -is [string]) { $value }
      else { $value | ConvertTo-Json -Compress -Depth 20 }
    [Environment]::SetEnvironmentVariable("TF_VAR_$($property.Name)", [string]$serialized, "Process")
  }
  if ($null -eq $plan.variables.PSObject.Properties["document_processing_deployment_stage"]) {
    $env:TF_VAR_document_processing_deployment_stage = "disabled"
    $env:TF_VAR_document_parser_invocation_qualified_arn = ""
  }
  $env:TF_VAR_staging_runtime_mode = $StagingMode
  $env:TF_VAR_serverless_runtime_enabled = $RuntimeEnabled.ToString().ToLowerInvariant()
  # General staging lifecycle changes never activate untrusted document processing. The mapping
  # and exact GuardDuty rule require their own reviewed, sequential activation plans.
  $env:TF_VAR_document_scan_mapping_enabled = "false"
  $env:TF_VAR_document_scan_event_rule_enabled = "false"
  $env:TF_VAR_document_security_health_rules_enabled = "false"
}

function Get-Database {
  $raw = & aws rds describe-db-instances --db-instance-identifier ai-job-apply-staging `
    --output json 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  $items = @(($raw | ConvertFrom-Json).DBInstances)
  if ($items.Count -ne 1) { return $null }
  return $items[0]
}

function Get-ManagedEndpointCount {
  $vpcId = (& terraform "-chdir=$terraformDirectory" output -raw vpc_id 2>$null).Trim()
  if (-not $vpcId) { throw "The staging VPC output is unavailable." }
  $result = Invoke-AwsJson @(
    "ec2", "describe-vpc-endpoints", "--filters", "Name=vpc-id,Values=$vpcId",
    "Name=service-name,Values=com.amazonaws.$Region.secretsmanager,com.amazonaws.$Region.sqs,com.amazonaws.$Region.lambda,com.amazonaws.$Region.sts",
    "--output", "json"
  )
  return @($result.VpcEndpoints | Where-Object { $_.State -notin @("deleted", "deleting") }).Count
}

function Get-QueueDepth {
  $total = 0L
  foreach ($queueName in @(
      "ai-job-apply-staging-events",
      "ai-job-apply-staging-dead-letter",
      "ai-job-apply-staging-profile-readiness-dead-letter",
      "ai-job-apply-staging-document-scan-results",
      "ai-job-apply-staging-document-scan-dlq",
      "ai-job-apply-staging-document-scan-delivery-dlq"
    )) {
    $rawUrl = & aws sqs get-queue-url --queue-name $queueName --output json 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    $urlResult = $rawUrl | ConvertFrom-Json
    $attributes = Invoke-AwsJson @(
      "sqs", "get-queue-attributes", "--queue-url", [string]$urlResult.QueueUrl,
      "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible",
      "ApproximateNumberOfMessagesDelayed", "--output", "json"
    )
    foreach ($name in @(
        "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed"
      )) {
      $property = $attributes.Attributes.PSObject.Properties[$name]
      if ($null -ne $property) { $total += [long]$property.Value }
    }
  }
  return $total
}

function Get-PublicRouteCount {
  $apis = @((Invoke-AwsJson @("apigatewayv2", "get-apis", "--output", "json")).Items |
      Where-Object { $_.Name -eq "ai-job-apply-staging-gateway" })
  if ($apis.Count -ne 1) { throw "The exact staging API Gateway definition is unavailable." }
  $routes = @((Invoke-AwsJson @(
        "apigatewayv2", "get-routes", "--api-id", [string]$apis[0].ApiId, "--output", "json"
      )).Items)
  return @($routes | Where-Object { $_.RouteKey -in @('$default', 'GET /health/live', 'GET /health/ready') }).Count
}

function Get-TriggerState {
  $mapping = @((Invoke-AwsJson @(
        "lambda", "list-event-source-mappings", "--function-name",
        "ai-job-apply-staging-outbox-starter:staging", "--output", "json"
      )).EventSourceMappings)
  $enabledMappings = @($mapping | Where-Object { $_.State -in @("Enabled", "Enabling") }).Count
  $documentProcessorPresent = $false
  $documentMappingRaw = & aws lambda list-event-source-mappings --function-name `
    "ai-job-apply-staging-document-processor:staging" --output json 2>$null
  if ($LASTEXITCODE -eq 0) {
    $documentProcessorPresent = $true
    $documentMappings = @(($documentMappingRaw | ConvertFrom-Json).EventSourceMappings)
    $enabledMappings += @($documentMappings | Where-Object {
        $_.State -in @("Enabled", "Enabling")
      }).Count
  }
  $enabledRules = 0
  foreach ($ruleName in @(
      "ai-job-apply-staging-outbox-reconciler",
      "ai-job-apply-staging-profile-readiness-terminal"
    )) {
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $ruleName, "--output", "json")
    if ([string]$rule.State -eq "ENABLED") { $enabledRules++ }
  }
  if ($documentProcessorPresent) {
    foreach ($documentRuleName in @(
        "ai-job-apply-staging-document-scan-results",
        "ai-job-apply-staging-document-processing-reconciler"
      )) {
      $documentRuleRaw = & aws events describe-rule --name $documentRuleName --output json 2>$null
      if ($LASTEXITCODE -ne 0) { throw "A deployed document-processing rule is unavailable." }
      if ([string](($documentRuleRaw | ConvertFrom-Json).State) -eq "ENABLED") { $enabledRules++ }
    }
  }
  return [pscustomobject]@{
    EnabledMappings          = $enabledMappings
    EnabledRules             = $enabledRules
    DocumentProcessorPresent = $documentProcessorPresent
  }
}

function Get-LifecycleStatus {
  $database = Get-Database
  $endpoints = Get-ManagedEndpointCount
  $routeCount = Get-PublicRouteCount
  $triggerState = Get-TriggerState
  $queueDepth = Get-QueueDepth
  $activeEndpointCount = if ($triggerState.DocumentProcessorPresent) { 4 } else { 3 }
  $mode = if (
    $null -eq $database -and $endpoints -eq 0 -and $routeCount -eq 0 -and
    $triggerState.EnabledMappings -eq 0 -and $triggerState.EnabledRules -eq 0
  ) { "dormant" }
    elseif ($null -ne $database -and -not [bool]$database.DeletionProtection -and
      $endpoints -eq $activeEndpointCount -and $routeCount -eq 0 -and $triggerState.EnabledMappings -eq 0 -and
      $triggerState.EnabledRules -eq 0) { "quiesced" }
    elseif ($null -ne $database -and [bool]$database.DeletionProtection -and
      $endpoints -eq $activeEndpointCount) { "active" }
    else { "transition-or-drift" }

  return [pscustomobject]@{
    Environment                = "staging"
    Mode                       = $mode
    DatabasePresent            = $null -ne $database
    DatabaseDeletionProtection = if ($null -eq $database) { $false } else { [bool]$database.DeletionProtection }
    ManagedInterfaceEndpoints  = $endpoints
    PublicRuntimeRoutes        = $routeCount
    EnabledEventMappings       = $triggerState.EnabledMappings
    EnabledEventRules          = $triggerState.EnabledRules
    DocumentProcessorPresent   = $triggerState.DocumentProcessorPresent
    AggregateQueueDepth        = $queueDepth
  }
}

function Assert-TransitionPreconditions {
  param([Parameter(Mandatory)][object]$Status)

  if ($Status.AggregateQueueDepth -ne 0) {
    throw "Staging queues must be empty before any lifecycle transition."
  }
  switch ($TargetMode) {
    "quiesced" {
      if ($Status.Mode -ne "active") { throw "Only active staging can transition to quiesced." }
    }
    "dormant" {
      if ($Status.Mode -ne "quiesced") {
        throw "Dormant destruction requires a separately applied and verified quiesced state."
      }
    }
    "active" {
      if ($Status.Mode -ne "dormant") { throw "Only dormant staging can be dark-activated." }
    }
  }
}

function Assert-PlanBoundary {
  param([Parameter(Mandatory)][object]$Plan)

  $documentProcessingDeployed = [string]$Plan.variables.document_processing_deployment_stage.value -cne "disabled"
  $changes = @($Plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -ne "no-op"
    })
  $deletes = @($changes | Where-Object { "delete" -in @($_.change.actions) })
  $protectedPattern = "aws_kms_|aws_s3_bucket|aws_ecr_repository|aws_sqs_queue|aws_iam_|aws_cloudformation_stack|random_password"
  $protectedDeletes = @($deletes | Where-Object { $_.address -match $protectedPattern })
  if ($protectedDeletes.Count -ne 0) {
    throw "The lifecycle plan attempts to delete a retained control-plane resource: $($protectedDeletes.address -join ', ')."
  }
  $replacements = @($changes | Where-Object {
      "create" -in @($_.change.actions) -and "delete" -in @($_.change.actions)
    })
  if ($replacements.Count -ne 0) {
    throw "Lifecycle transitions must not replace a managed resource: $($replacements.address -join ', ')."
  }
  if ($TargetMode -eq "quiesced") {
    $allowedAddresses = @(
      "module.platform.aws_db_instance.postgres[0]",
      "module.platform.aws_apigatewayv2_route.gateway[0]",
      'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
      'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]',
      "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
      "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
      "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
      "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
      "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
      "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"
    )
    $unexpected = @($changes | Where-Object { $_.address -notin $allowedAddresses })
    if ($unexpected.Count -ne 0) {
      throw "Quiescence contains an unexpected resource action: $($unexpected.address -join ', ')."
    }
    $databaseChange = @($changes | Where-Object {
        $_.address -eq "module.platform.aws_db_instance.postgres[0]" -and
        (@($_.change.actions) -join ",") -eq "update"
      })
    $routeDeletes = @($changes | Where-Object {
        $_.address -like "module.platform.aws_apigatewayv2_route.*" -and
        (@($_.change.actions) -join ",") -eq "delete"
      })
    $triggerUpdates = @($changes | Where-Object {
        ($_.address -like "module.platform.aws_lambda_event_source_mapping.*" -or
          $_.address -like "module.platform.aws_cloudwatch_event_rule.*") -and
        (@($_.change.actions) -join ",") -eq "update"
      })
    $expectedTriggerUpdates = if ($triggerUpdates.Count -eq 6) { 6 } else { 3 }
    $liveTransition = (
      $changes.Count -eq (4 + $expectedTriggerUpdates) -and $databaseChange.Count -eq 1 -and
      $routeDeletes.Count -eq 3 -and $triggerUpdates.Count -eq $expectedTriggerUpdates
    )
    $darkTransition = (
      $changes.Count -eq 1 -and $databaseChange.Count -eq 1 -and
      $routeDeletes.Count -eq 0 -and $triggerUpdates.Count -eq 0
    )
    if (-not $liveTransition -and -not $darkTransition) {
      throw "Quiescence must update database protection plus the exact enabled traffic/processing actions or no already-dark action."
    }
    if (
      -not [bool]$databaseChange[0].change.before.deletion_protection -or
      [bool]$databaseChange[0].change.after.deletion_protection
    ) {
      throw "Quiescence must change database deletion protection from enabled to disabled."
    }
    if ($liveTransition) {
      $mappingChange = @($triggerUpdates | Where-Object {
          $_.address -eq "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]"
        })
      $ruleChanges = @($triggerUpdates | Where-Object {
          $_.address -like "module.platform.aws_cloudwatch_event_rule.*"
        })
      if (
        $mappingChange.Count -ne 1 -or
        @($triggerUpdates | Where-Object {
            $_.address -like "module.platform.aws_lambda_event_source_mapping.*" -and
            (-not [bool]$_.change.before.enabled -or [bool]$_.change.after.enabled)
          }).Count -ne 0 -or
        @($ruleChanges | Where-Object {
            [string]$_.change.before.state -ne "ENABLED" -or
            [string]$_.change.after.state -ne "DISABLED"
          }).Count -ne 0
      ) {
        throw "Quiescence must disable every exact managed mapping and EventBridge rule."
      }
    }
  }
  if ($TargetMode -eq "dormant") {
    $allowedAddresses = @(
      "module.platform.aws_cloudwatch_dashboard.operations",
      "module.platform.aws_cloudwatch_metric_alarm.database_cpu[0]",
      "module.platform.aws_cloudwatch_metric_alarm.database_free_storage[0]",
      "module.platform.aws_db_instance.postgres[0]",
      "module.platform.aws_ecs_task_definition.migration[0]",
      "module.platform.aws_secretsmanager_secret_version.database_url[0]",
      "module.platform.aws_vpc_endpoint.lambda[0]",
      "module.platform.aws_vpc_endpoint.secretsmanager[0]",
      "module.platform.aws_vpc_endpoint.sqs[0]",
      "module.platform.aws_vpc_endpoint.sts[0]",
      "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
    )
    $unexpected = @($changes | Where-Object { $_.address -notin $allowedAddresses })
    if ($unexpected.Count -ne 0) {
      throw "Dormant mode contains an unexpected resource action: $($unexpected.address -join ', ')."
    }
    $dashboardUpdates = @($changes | Where-Object {
        $_.address -eq "module.platform.aws_cloudwatch_dashboard.operations" -and
        (@($_.change.actions) -join ",") -eq "update"
      })
    $expectedDeletes = @($changes | Where-Object {
        $_.address -ne "module.platform.aws_cloudwatch_dashboard.operations" -and
        (@($_.change.actions) -join ",") -eq "delete"
      })
    $expectedDisposableCount = if ($documentProcessingDeployed) { 10 } else { 8 }
    if ($changes.Count -ne (1 + $expectedDisposableCount) -or $dashboardUpdates.Count -ne 1 -or
      $expectedDeletes.Count -ne $expectedDisposableCount) {
      throw "Dormant mode must delete the exact disposable data plane and update one dashboard."
    }
  }
  if ($TargetMode -eq "active") {
    $allowedAddresses = @(
      "module.platform.aws_cloudwatch_dashboard.operations",
      "module.platform.aws_cloudwatch_metric_alarm.database_cpu[0]",
      "module.platform.aws_cloudwatch_metric_alarm.database_free_storage[0]",
      "module.platform.aws_db_instance.postgres[0]",
      "module.platform.aws_ecs_task_definition.migration[0]",
      "module.platform.aws_secretsmanager_secret_version.database_url[0]",
      "module.platform.aws_vpc_endpoint.lambda[0]",
      "module.platform.aws_vpc_endpoint.secretsmanager[0]",
      "module.platform.aws_vpc_endpoint.sqs[0]",
      "module.platform.aws_vpc_endpoint.sts[0]",
      "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
    )
    $unexpected = @($changes | Where-Object { $_.address -notin $allowedAddresses })
    if ($unexpected.Count -ne 0) {
      throw "Dark activation contains an unexpected resource action: $($unexpected.address -join ', ')."
    }
    $dashboardUpdates = @($changes | Where-Object {
        $_.address -eq "module.platform.aws_cloudwatch_dashboard.operations" -and
        (@($_.change.actions) -join ",") -eq "update"
      })
    $expectedCreates = @($changes | Where-Object {
        $_.address -ne "module.platform.aws_cloudwatch_dashboard.operations" -and
        (@($_.change.actions) -join ",") -eq "create"
      })
    $expectedDisposableCount = if ($documentProcessingDeployed) { 10 } else { 8 }
    if ($changes.Count -ne (1 + $expectedDisposableCount) -or $dashboardUpdates.Count -ne 1 -or
      $expectedCreates.Count -ne $expectedDisposableCount) {
      throw "Dark activation must create the exact disposable data plane and update one dashboard."
    }
    $databaseCreate = @($expectedCreates | Where-Object {
        $_.address -eq "module.platform.aws_db_instance.postgres[0]"
      })
    if (
      $databaseCreate.Count -ne 1 -or
      -not [bool]$databaseCreate[0].change.after.storage_encrypted -or
      [bool]$databaseCreate[0].change.after.publicly_accessible -or
      -not [bool]$databaseCreate[0].change.after.deletion_protection -or
      [int]$databaseCreate[0].change.after.backup_retention_period -lt 7
    ) {
      throw "Dark activation must create one encrypted private protected database with seven-day backups."
    }
    $interfaceEndpointCreates = @($expectedCreates | Where-Object {
        $_.address -in @(
          "module.platform.aws_vpc_endpoint.lambda[0]",
          "module.platform.aws_vpc_endpoint.secretsmanager[0]",
          "module.platform.aws_vpc_endpoint.sqs[0]",
          "module.platform.aws_vpc_endpoint.sts[0]"
        )
      })
    $expectedInterfaceEndpointCount = if ($documentProcessingDeployed) { 4 } else { 3 }
    if (
      $interfaceEndpointCreates.Count -ne $expectedInterfaceEndpointCount -or
      @($interfaceEndpointCreates | Where-Object {
          [string]$_.change.after.vpc_endpoint_type -ne "Interface" -or
          -not [bool]$_.change.after.private_dns_enabled
        }).Count -ne 0
    ) {
      throw "Dark activation must create the exact private-DNS interface endpoints for the deployed runtime."
    }
    $s3GatewayCreates = @($expectedCreates | Where-Object {
        $_.address -eq "module.platform.aws_vpc_endpoint.candidate_documents_s3[0]"
      })
    if (($documentProcessingDeployed -and
        ($s3GatewayCreates.Count -ne 1 -or
          [string]$s3GatewayCreates[0].change.after.vpc_endpoint_type -ne "Gateway")) -or
      (-not $documentProcessingDeployed -and $s3GatewayCreates.Count -ne 0)) {
      throw "Document processing activation must create exactly one S3 gateway endpoint."
    }
  }
  return $changes
}

function Assert-TrafficPreconditions {
  param([Parameter(Mandatory)][object]$Status)

  if ($Status.Mode -ne "active" -or -not $Status.DatabasePresent -or
    -not $Status.DatabaseDeletionProtection -or
    $Status.ManagedInterfaceEndpoints -ne $(if ($Status.DocumentProcessorPresent) { 4 } else { 3 })) {
    throw "Traffic transitions require the complete protected active staging data plane."
  }
  if ($Status.AggregateQueueDepth -ne 0) {
    throw "Staging queues must be empty before any traffic transition."
  }
  if ($TrafficTarget -eq "enabled") {
    if ($Status.PublicRuntimeRoutes -ne 0 -or $Status.EnabledEventMappings -ne 0 -or
      $Status.EnabledEventRules -ne 0) {
      throw "Traffic can be enabled only from the exact dark active boundary."
    }
  }
  elseif ($Status.PublicRuntimeRoutes -ne 3 -or
    ($Status.EnabledEventMappings -ne 1 -and $Status.EnabledEventMappings -ne 2) -or
    ($Status.EnabledEventRules -ne 2 -and $Status.EnabledEventRules -ne 4) -or
    ($Status.EnabledEventMappings -eq 2 -and $Status.EnabledEventRules -ne 4) -or
    ($Status.EnabledEventMappings -eq 1 -and $Status.EnabledEventRules -ne 2)) {
    throw "Traffic can be disabled only from the exact enabled active boundary."
  }
}

function Assert-TrafficPlanBoundary {
  param([Parameter(Mandatory)][object]$Plan)

  $documentIntakeDeployed = [bool]$Plan.variables.deploy_document_intake.value
  $changes = @($Plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -ne "no-op"
    })
  $allowedAddresses = @(
    "module.platform.aws_apigatewayv2_route.gateway[0]",
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/live"]',
    'module.platform.aws_apigatewayv2_route.gateway_lambda_public["GET /health/ready"]',
    "module.platform.aws_lambda_event_source_mapping.outbox_starter[0]",
    "module.platform.aws_lambda_event_source_mapping.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.outbox_reconciler[0]",
    "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]",
    "module.platform.aws_cloudwatch_event_rule.document_scan_results[0]",
    "module.platform.aws_cloudwatch_event_rule.document_processing_reconciler[0]"
  )
  $unexpected = @($changes | Where-Object { $_.address -notin $allowedAddresses })
  if ($unexpected.Count -ne 0) {
    throw "The traffic plan contains an unexpected resource action: $($unexpected.address -join ', ')."
  }
  $replacements = @($changes | Where-Object {
      "create" -in @($_.change.actions) -and "delete" -in @($_.change.actions)
    })
  $expectedChangeCounts = if ($TrafficTarget -eq "enabled") { @(6) } else { @(6, 9) }
  if ($changes.Count -notin $expectedChangeCounts -or $replacements.Count -ne 0) {
    throw "The traffic plan must contain three route actions and the exact base workflow trigger updates without replacement."
  }

  $routeChanges = @($changes | Where-Object {
      $_.address -like "module.platform.aws_apigatewayv2_route.*"
    })
  $mappingChanges = @($changes | Where-Object {
      $_.address -like "module.platform.aws_lambda_event_source_mapping.*"
    })
  $ruleChanges = @($changes | Where-Object {
      $_.address -like "module.platform.aws_cloudwatch_event_rule.*"
    })
  $expectedTriggerCounts = if ($TrafficTarget -eq "enabled") { @(3) } else { @(3, 6) }
  if ($routeChanges.Count -ne 3 -or $mappingChanges.Count -notin @(1, 2) -or
    $ruleChanges.Count -notin @(2, 4) -or
    $mappingChanges.Count + $ruleChanges.Count -notin $expectedTriggerCounts) {
    throw "The traffic plan does not contain the exact route, mapping, and EventBridge boundary."
  }

  if ($TrafficTarget -eq "enabled") {
    if (@($routeChanges | Where-Object { (@($_.change.actions) -join ",") -ne "create" }).Count -ne 0 -or
      @($mappingChanges | Where-Object {
          (@($_.change.actions) -join ",") -ne "update" -or
          [bool]$_.change.before.enabled -or -not [bool]$_.change.after.enabled
        }).Count -ne 0 -or
      @($ruleChanges | Where-Object {
          (@($_.change.actions) -join ",") -ne "update" -or
          [string]$_.change.before.state -ne "DISABLED" -or
          [string]$_.change.after.state -ne "ENABLED"
        }).Count -ne 0) {
      throw "Traffic enablement must create three routes and enable the exact three base workflow triggers."
    }
    $defaultRoute = @($routeChanges | Where-Object {
        $_.address -eq "module.platform.aws_apigatewayv2_route.gateway[0]"
      })
    $publicRoutes = @($routeChanges | Where-Object {
        $_.address -like "module.platform.aws_apigatewayv2_route.gateway_lambda_public*"
      })
    if ($defaultRoute.Count -ne 1 -or $publicRoutes.Count -ne 2) {
      throw "Traffic enablement must contain one default route and two public health routes."
    }
    $scopes = @($defaultRoute[0].change.after.authorization_scopes | Sort-Object)
    $expectedScopes = @("jobs:read", "profile:read", "profile:write")
    if ($documentIntakeDeployed) { $expectedScopes += @("documents:read", "documents:write") }
    if (
      [string]$defaultRoute[0].change.after.authorization_type -ne "JWT" -or
      (@($scopes) -join ",") -ne (@($expectedScopes | Sort-Object) -join ",") -or
      @($publicRoutes | Where-Object {
          [string]$_.change.after.authorization_type -ne "NONE"
        }).Count -ne 0) {
      throw "Traffic enablement must preserve exact JWT scopes and anonymous health routes only."
    }
  }
  else {
    if (@($routeChanges | Where-Object { (@($_.change.actions) -join ",") -ne "delete" }).Count -ne 0 -or
      @($mappingChanges | Where-Object {
          (@($_.change.actions) -join ",") -ne "update" -or
          -not [bool]$_.change.before.enabled -or [bool]$_.change.after.enabled
        }).Count -ne 0 -or
      @($ruleChanges | Where-Object {
          (@($_.change.actions) -join ",") -ne "update" -or
          [string]$_.change.before.state -ne "ENABLED" -or
          [string]$_.change.after.state -ne "DISABLED"
        }).Count -ne 0) {
      throw "Traffic disablement must delete three routes and disable the exact three base workflow triggers."
    }
  }
  return $changes
}

Assert-CallerAndTools
Initialize-Backend

if ($Action -eq "Status") {
  Get-LifecycleStatus | ConvertTo-Json -Depth 5
  exit 0
}

$commit = Assert-CleanMergedMain

if ($Action -eq "PlanTraffic") {
  if ([string]::IsNullOrWhiteSpace($RuntimePlanPath)) {
    throw "Traffic planning requires the exact already-applied active plan."
  }
  Set-VariablesFromAppliedPlan -SourcePlanPath $RuntimePlanPath -StagingMode active `
    -RuntimeEnabled ($TrafficTarget -eq "enabled")
  $current = Get-LifecycleStatus
  Assert-TrafficPreconditions -Status $current

  $null = New-Item -ItemType Directory -Path $lifecyclePlanRoot -Force
  if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    $PlanPath = Join-Path $lifecyclePlanRoot "traffic-$TrafficTarget-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan"
  }
  $resolvedPlan = Resolve-PlanBelowTerraformData -Candidate $PlanPath
  if (Test-Path -LiteralPath $resolvedPlan) { throw "Refusing to overwrite an existing saved plan." }

  try {
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m `
      "-out=$resolvedPlan" | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedPlan -PathType Leaf)) {
      throw "The refresh-backed staging traffic plan failed."
    }
    $planJson = (& terraform "-chdir=$terraformDirectory" show -json $resolvedPlan)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($planJson)) {
      throw "The saved traffic plan could not be inspected."
    }
    try { $plan = $planJson | ConvertFrom-Json }
    catch { throw "The saved traffic plan JSON is invalid." }
    if ($null -eq $plan) { throw "The saved traffic plan is empty." }
    $changes = Assert-TrafficPlanBoundary -Plan $plan
  }
  catch {
    if (Test-Path -LiteralPath $resolvedPlan -PathType Leaf) {
      Remove-Item -LiteralPath $resolvedPlan -Force
    }
    throw
  }
  $sha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadataPath = "$resolvedPlan.traffic.json"
  [pscustomobject]@{
    SchemaVersion     = 1
    Environment       = "staging"
    Operation         = "traffic"
    TrafficTarget     = $TrafficTarget
    AccountId         = $ExpectedAccountId
    StateBucket       = $StateBucket
    Commit            = $commit
    PlanPath          = $resolvedPlan
    PlanSha256        = $sha256
    SourcePlanSha256  = (Get-FileHash -LiteralPath (Resolve-PlanBelowTerraformData -Candidate $RuntimePlanPath -MustExist) -Algorithm SHA256).Hash.ToLowerInvariant()
    CreatedAt         = (Get-Date).ToUniversalTime().ToString("o")
    ChangedResources  = @($changes | ForEach-Object { [string]$_.address })
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding utf8

  [pscustomobject]@{
    Result           = "review-required"
    TrafficTarget    = $TrafficTarget
    ChangedResources = $changes.Count
    PlanPath         = $resolvedPlan
    PlanSha256       = $sha256
    ApprovalCommand  = "Apply reviewed staging traffic $TrafficTarget plan $sha256"
  } | ConvertTo-Json -Depth 5
  exit 0
}

if ($Action -eq "Plan") {
  if ([string]::IsNullOrWhiteSpace($RuntimePlanPath)) {
    throw "Plan requires the exact already-applied runtime plan."
  }
  Set-VariablesFromAppliedPlan -SourcePlanPath $RuntimePlanPath -StagingMode $TargetMode `
    -RuntimeEnabled $false
  $current = Get-LifecycleStatus
  Assert-TransitionPreconditions -Status $current

  $null = New-Item -ItemType Directory -Path $lifecyclePlanRoot -Force
  if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    $PlanPath = Join-Path $lifecyclePlanRoot "$TargetMode-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan"
  }
  $resolvedPlan = Resolve-PlanBelowTerraformData -Candidate $PlanPath
  if (Test-Path -LiteralPath $resolvedPlan) { throw "Refusing to overwrite an existing saved plan." }

  try {
    & terraform "-chdir=$terraformDirectory" plan -input=false -lock-timeout=5m `
      "-out=$resolvedPlan" | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedPlan -PathType Leaf)) {
      throw "The refresh-backed staging lifecycle plan failed."
    }
    $planJson = (& terraform "-chdir=$terraformDirectory" show -json $resolvedPlan)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($planJson)) {
      throw "The saved lifecycle plan could not be inspected."
    }
    try { $plan = $planJson | ConvertFrom-Json }
    catch { throw "The saved lifecycle plan JSON is invalid." }
    if ($null -eq $plan) { throw "The saved lifecycle plan is empty." }
    $changes = Assert-PlanBoundary -Plan $plan
  }
  catch {
    if (Test-Path -LiteralPath $resolvedPlan -PathType Leaf) {
      Remove-Item -LiteralPath $resolvedPlan -Force
    }
    throw
  }
  $sha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadataPath = "$resolvedPlan.lifecycle.json"
  [pscustomobject]@{
    SchemaVersion     = 1
    Environment       = "staging"
    TargetMode        = $TargetMode
    AccountId         = $ExpectedAccountId
    StateBucket       = $StateBucket
    Commit            = $commit
    PlanPath          = $resolvedPlan
    PlanSha256        = $sha256
    SourcePlanSha256  = (Get-FileHash -LiteralPath (Resolve-PlanBelowTerraformData -Candidate $RuntimePlanPath -MustExist) -Algorithm SHA256).Hash.ToLowerInvariant()
    CreatedAt         = (Get-Date).ToUniversalTime().ToString("o")
    ChangedResources  = @($changes | ForEach-Object { [string]$_.address })
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding utf8

  [pscustomobject]@{
    Result           = "review-required"
    TargetMode       = $TargetMode
    ChangedResources = $changes.Count
    PlanPath         = $resolvedPlan
    PlanSha256       = $sha256
    ApprovalCommand  = "Apply reviewed staging runtime $TargetMode plan $sha256"
  } | ConvertTo-Json -Depth 5
  exit 0
}

if ($Action -eq "ApplyTraffic") {
  if ([string]::IsNullOrWhiteSpace($PlanPath) -or [string]::IsNullOrWhiteSpace($ReviewedPlanSha256)) {
    throw "Traffic apply requires the exact saved PlanPath and reviewed SHA-256."
  }
  $resolvedPlan = Resolve-PlanBelowTerraformData -Candidate $PlanPath -MustExist
  $actualSha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -cne $ReviewedPlanSha256) { throw "The saved traffic plan checksum does not match approval." }
  $metadataPath = "$resolvedPlan.traffic.json"
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "Saved traffic metadata is missing." }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  if (
    [string]$metadata.Operation -cne "traffic" -or
    [string]$metadata.TrafficTarget -cne $TrafficTarget -or
    [string]$metadata.AccountId -cne $ExpectedAccountId -or
    [string]$metadata.StateBucket -cne $StateBucket -or
    [string]$metadata.Commit -cne $commit -or
    [string]$metadata.PlanSha256 -cne $ReviewedPlanSha256
  ) {
    throw "The reviewed traffic metadata does not match this exact apply boundary."
  }

  $current = Get-LifecycleStatus
  Assert-TrafficPreconditions -Status $current
  & terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolvedPlan
  if ($LASTEXITCODE -ne 0) { throw "The exact reviewed traffic plan did not apply successfully." }
  $result = Get-LifecycleStatus
  $expectedRoutes = if ($TrafficTarget -eq "enabled") { 3 } else { 0 }
  $expectedMappings = if ($TrafficTarget -eq "enabled") { 1 } else { 0 }
  $expectedRules = if ($TrafficTarget -eq "enabled") { 2 } else { 0 }
  if (
    $result.Mode -ne "active" -or $result.AggregateQueueDepth -ne 0 -or
    $result.PublicRuntimeRoutes -ne $expectedRoutes -or
    $result.EnabledEventMappings -ne $expectedMappings -or
    $result.EnabledEventRules -ne $expectedRules
  ) {
    throw "The traffic apply completed, but the verified staging traffic boundary does not match $TrafficTarget."
  }
  $result | ConvertTo-Json -Depth 5
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlanPath) -or [string]::IsNullOrWhiteSpace($ReviewedPlanSha256)) {
  throw "Apply requires the exact saved PlanPath and reviewed SHA-256."
}
$resolvedPlan = Resolve-PlanBelowTerraformData -Candidate $PlanPath -MustExist
$actualSha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -cne $ReviewedPlanSha256) { throw "The saved plan checksum does not match approval." }
$metadataPath = "$resolvedPlan.lifecycle.json"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "Saved lifecycle metadata is missing." }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if (
  [string]$metadata.TargetMode -cne $TargetMode -or
  [string]$metadata.AccountId -cne $ExpectedAccountId -or
  [string]$metadata.StateBucket -cne $StateBucket -or
  [string]$metadata.Commit -cne $commit -or
  [string]$metadata.PlanSha256 -cne $ReviewedPlanSha256
) {
  throw "The reviewed plan metadata does not match this exact apply boundary."
}

$current = Get-LifecycleStatus
Assert-TransitionPreconditions -Status $current
& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolvedPlan
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed lifecycle plan did not apply successfully." }
$result = Get-LifecycleStatus
if ($result.Mode -ne $TargetMode -or $result.AggregateQueueDepth -ne 0) {
  throw "The lifecycle apply completed, but the verified staging state does not match $TargetMode."
}
$result | ConvertTo-Json -Depth 5
