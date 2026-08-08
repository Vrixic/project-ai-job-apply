[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("development", "staging")][string]$Environment,
  [ValidateSet("PlanRepository", "PlanMigration", "RunMigration", "PurgeLegacyImages", "PlanCleanup", "PlanCleanupRecovery", "Status", "Apply", "Verify")]
  [string]$Action = "Status",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$BaselinePlanPath = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-fA-F0-9]{64}$")][string]$ExpectedPlanSha256 = "",
  [ValidatePattern("^.+[.]dkr[.]ecr[.]us-east-2[.]amazonaws[.]com/ai-job-apply/migration@sha256:[a-f0-9]{64}$")]
  [string]$MigrationImage = "",
  [string]$AwsProfile = "",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$ConfirmTemporalKeyRevoked,
  [switch]$ConfirmLegacyArtifactsRetired,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}

if ($Help) {
  @"
Phase 0 provider-retirement sequence (one isolated environment at a time):

  1. PlanRepository -> Status -> Apply
  2. Publish Dockerfile.migration to the returned dedicated repository.
  3. PlanMigration -MigrationImage REPOSITORY@sha256:DIGEST -> Status -> Apply
  4. RunMigration -Execute
  5. Revoke the exact Temporal Cloud key, then prove it with temporal-retirement-inspect.mjs.
  6. PurgeLegacyImages -ConfirmTemporalKeyRevoked -ConfirmLegacyArtifactsRetired -Execute
  7. PlanCleanup -ConfirmTemporalKeyRevoked -> Status -> Apply
  8. If cleanup partially applies, PlanCleanupRecovery with both retirement confirmations.
  9. Verify

Every plan action requires the last accepted zero-change -BaselinePlanPath, exact account ID, and
encrypted state bucket. Apply requires an exact saved plan plus its reviewed SHA-256 and -Execute.
No action prints a secret, candidate identifier, Terraform plan body, or raw migration log.
"@
  exit 0
}

if ($Region -ne "us-east-2") { throw "Provider retirement is restricted to us-east-2." }
if ($Action -in @("PlanRepository", "PlanMigration", "RunMigration", "PurgeLegacyImages", "PlanCleanup", "PlanCleanupRecovery", "Verify") -and (
  $ExpectedAccountId -notmatch "^[0-9]{12}$" -or [string]::IsNullOrWhiteSpace($StateBucket)
)) { throw "$Action requires the exact $Environment account ID and encrypted state bucket." }
if ($Action -in @("PlanRepository", "PlanMigration", "PlanCleanup", "PlanCleanupRecovery", "Verify") -and
    [string]::IsNullOrWhiteSpace($BaselinePlanPath)) {
  throw "$Action requires the last accepted zero-change -BaselinePlanPath."
}
if ($Action -in @("PlanMigration", "RunMigration", "PlanCleanup", "PlanCleanupRecovery", "Verify") -and
    [string]::IsNullOrWhiteSpace($MigrationImage)) {
  throw "$Action requires the exact dedicated migration image digest."
}
if ($Action -in @("Status", "Apply") -and [string]::IsNullOrWhiteSpace($PlanPath)) {
  throw "$Action requires -PlanPath."
}
if ($Action -eq "Apply" -and (-not $Execute -or $ExpectedPlanSha256 -notmatch "^[a-fA-F0-9]{64}$")) {
  throw "Apply requires -Execute and the reviewed -ExpectedPlanSha256."
}
if ($Action -eq "PurgeLegacyImages" -and (
  -not $Execute -or -not $ConfirmTemporalKeyRevoked -or -not $ConfirmLegacyArtifactsRetired
)) { throw "PurgeLegacyImages requires both retirement confirmations and -Execute." }
if ($Action -eq "RunMigration" -and -not $Execute) { throw "RunMigration requires -Execute." }
if ($Action -in @("PlanCleanup", "PlanCleanupRecovery") -and -not $ConfirmTemporalKeyRevoked) {
  throw "$Action requires -ConfirmTemporalKeyRevoked after exact-key rejection passed."
}
if ($Action -eq "PlanCleanupRecovery" -and -not $ConfirmLegacyArtifactsRetired) {
  throw "PlanCleanupRecovery requires -ConfirmLegacyArtifactsRetired after the original cleanup partially applied."
}
if ($Execute -and $Action -notin @("Apply", "RunMigration", "PurgeLegacyImages")) {
  throw "$Action does not accept -Execute."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environmentDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\$Environment"
$terraformRoot = Join-Path $environmentDirectory ".terraform"
$planDirectory = Join-Path $terraformRoot "provider-retirement-plans"
$terraformDataDirectory = Join-Path $terraformRoot "provider-retirement-data"
$allowedVariableNames = @(
  "migration_image", "high_availability", "private_application_networking", "enable_redis",
  "database_instance_class", "database_engine_version", "database_performance_insights",
  "enable_container_insights", "oidc_issuer", "oidc_audience", "deploy_applications",
  "deploy_gateway_lambda", "gateway_lambda_artifact_s3_key",
  "gateway_lambda_artifact_s3_object_version", "gateway_lambda_artifact_sha256",
  "gateway_lambda_artifact_base64sha256", "gateway_lambda_extension_layer_arn",
  "gateway_lambda_reserved_concurrency", "deploy_serverless_outbox",
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
  "serverless_runtime_enabled"
)

function Assert-Tools {
  foreach ($command in @("aws", "git", "terraform")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
  }
  $version = & terraform version -json 2>$null | ConvertFrom-Json
  if ([string]$version.terraform_version -ne "1.9.8") { throw "Terraform 1.9.8 is required." }
}

function Invoke-Terraform {
  param([Parameter(Mandatory)][string[]]$Arguments)
  foreach ($name in @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
      throw "Clear explicit AWS credential environment variables before running provider retirement."
    }
  }
  $names = @("AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION")
  $saved = @{}
  foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
  try {
    $env:AWS_PROFILE = $AwsProfile
    $env:AWS_REGION = $Region
    $env:AWS_DEFAULT_REGION = $Region
    & terraform @Arguments
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process") }
  }
}

function Assert-ExactMain {
  $branch = (& git -C $repositoryRoot branch --show-current).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse "@{upstream}" 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
  if ($branch -ne "main" -or $head -ne $upstream -or $dirty.Count -ne 0) {
    throw "Use an exact clean upstream-matched main checkout for provider retirement."
  }
  return $head
}

function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$FailureMessage)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw $FailureMessage }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw $FailureMessage }
}

function Assert-Caller {
  $caller = Invoke-AwsJson @("sts", "get-caller-identity") "The $Environment AWS session is unavailable."
  if ([string]$caller.Account -ne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/")) {
    throw "Use the temporary IAM Identity Center session for the exact $Environment account."
  }
}

function Initialize-Backend {
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket) `
    "The encrypted $Environment state bucket could not be inspected."
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
    $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
    $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  })
  if ($rules.Count -ne 1) { throw "The state bucket does not expose one KMS default." }
  $keyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($keyArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state KMS key is outside the exact account and region."
  }
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  $null = Invoke-Terraform @(
    "-chdir=$environmentDirectory", "init", "-reconfigure", "-input=false", "-lockfile=readonly",
    "-backend-config=bucket=$StateBucket", "-backend-config=key=platform.tfstate",
    "-backend-config=region=$Region", "-backend-config=kms_key_id=$keyArn"
  ) 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The pinned provider set could not initialize." }
}

function Resolve-ExistingFile {
  param([string]$Candidate, [string]$Purpose)
  $path = if ([IO.Path]::IsPathRooted($Candidate)) { [IO.Path]::GetFullPath($Candidate) }
    else { [IO.Path]::GetFullPath((Join-Path $environmentDirectory $Candidate)) }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The $Purpose file does not exist." }
  return $path
}

function Resolve-PlanFile {
  param([string]$Candidate)
  $path = Resolve-ExistingFile $Candidate "saved plan"
  $prefix = [IO.Path]::GetFullPath($planDirectory).TrimEnd('\') + '\'
  if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The saved plan must be below the ignored provider-retirement plan directory."
  }
  return $path
}

function Get-PlanJson {
  param([string]$Path)
  $raw = Invoke-Terraform @("-chdir=$environmentDirectory", "show", "-json", $Path) 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "The saved Terraform plan could not be inspected." }
  return ($raw -join [Environment]::NewLine) | ConvertFrom-Json -Depth 100
}

function Get-PlanChanges {
  param([object]$Plan)
  $changes = @($Plan.resource_changes | Where-Object {
    (@($_.change.actions) -join ",") -notin @("no-op", "read")
  })
  return ,$changes
}

function Get-OptionalArray {
  param([object]$Object, [string]$PropertyName)
  if ($null -eq $Object) { return @() }
  $property = $Object.PSObject.Properties[$PropertyName]
  if ($null -eq $property -or $null -eq $property.Value) { return @() }
  return @($property.Value)
}

function Assert-Baseline {
  param([object]$Plan)
  if ((Get-PlanChanges $Plan).Count -ne 0) { throw "The accepted baseline is not zero-change." }
  foreach ($name in @(
    "deploy_applications", "deploy_gateway_lambda", "deploy_serverless_outbox",
    "deploy_profile_readiness_durable", "serverless_runtime_cutover"
  )) {
    $property = $Plan.variables.PSObject.Properties[$name]
    if ($null -eq $property -or $property.Value.value -ne $true) {
      throw "The accepted baseline does not have '$name' enabled."
    }
  }
}

function Invoke-WithBaselineVariables {
  param([object]$Baseline, [scriptblock]$Operation)
  $saved = @{}
  $names = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($name in $allowedVariableNames) {
      $property = $Baseline.variables.PSObject.Properties[$name]
      if ($null -eq $property -or $null -eq $property.Value.value) { continue }
      $environmentName = "TF_VAR_$name"
      $saved[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, "Process")
      $value = $property.Value.value
      $serialized = if ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
        elseif ($value -is [string]) { $value }
        else { $value | ConvertTo-Json -Compress -Depth 20 }
      [Environment]::SetEnvironmentVariable($environmentName, [string]$serialized, "Process")
      $names.Add($environmentName)
    }
    foreach ($override in @{
      TF_VAR_serverless_runtime_enabled = "true"
      TF_VAR_migration_image = $MigrationImage
    }.GetEnumerator()) {
      $saved[$override.Key] = [Environment]::GetEnvironmentVariable($override.Key, "Process")
      [Environment]::SetEnvironmentVariable($override.Key, [string]$override.Value, "Process")
      if (-not $names.Contains($override.Key)) { $names.Add($override.Key) }
    }
    & $Operation
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process") }
  }
}

function Assert-MigrationImage {
  $repository = Invoke-AwsJson @("ecr", "describe-repositories", "--repository-names", "ai-job-apply/migration") `
    "The dedicated migration repository is unavailable."
  if (@($repository.repositories).Count -ne 1 -or
      [string]$repository.repositories[0].imageTagMutability -ne "IMMUTABLE" -or
      -not [bool]$repository.repositories[0].imageScanningConfiguration.scanOnPush -or
      [string]$repository.repositories[0].encryptionConfiguration.encryptionType -ne "KMS") {
    throw "The dedicated migration repository is not immutable, scanned, and KMS encrypted."
  }
  $repositoryUri = [string]$repository.repositories[0].repositoryUri
  if (-not $MigrationImage.StartsWith("$repositoryUri@sha256:", [StringComparison]::Ordinal)) {
    throw "The migration image is outside the exact environment repository."
  }
  $digest = $MigrationImage.Substring($MigrationImage.IndexOf("@") + 1)
  $scan = Invoke-AwsJson @(
    "ecr", "describe-image-scan-findings", "--repository-name", "ai-job-apply/migration",
    "--image-id", "imageDigest=$digest"
  ) "The exact migration image scan could not be read."
  $severity = $scan.imageScanFindings.findingSeverityCounts
  $criticalProperty = if ($null -eq $severity) { $null } else { $severity.PSObject.Properties["CRITICAL"] }
  $highProperty = if ($null -eq $severity) { $null } else { $severity.PSObject.Properties["HIGH"] }
  $critical = if ($null -eq $criticalProperty) { 0 } else { [int]$criticalProperty.Value }
  $high = if ($null -eq $highProperty) { 0 } else { [int]$highProperty.Value }
  if ([string]$scan.imageScanStatus.status -ne "COMPLETE" -or $critical -ne 0 -or $high -ne 0) {
    throw "The exact migration image did not pass the required scan gate."
  }
}

function Assert-ApplicationIngressRemoval {
  param([object]$Change)
  if ([string]$Change.address -ne "module.platform.aws_security_group.application" -or
      (@($Change.change.actions) -join ",") -ne "update") {
    throw "The cleanup recovery does not contain the exact application security-group update."
  }
  $beforeIngress = @(Get-OptionalArray $Change.change.before "ingress")
  $afterIngress = @(Get-OptionalArray $Change.change.after "ingress")
  if ($beforeIngress.Count -ne 1 -or $afterIngress.Count -ne 0) {
    throw "The cleanup recovery does not remove exactly one historical ingress rule."
  }
  $rule = $beforeIngress[0]
  if ([string]$rule.protocol -ne "tcp" -or [int]$rule.from_port -ne 4000 -or
      [int]$rule.to_port -ne 4000 -or @(Get-OptionalArray $rule "security_groups").Count -ne 1 -or
      @(Get-OptionalArray $rule "cidr_blocks").Count -ne 0 -or
      @(Get-OptionalArray $rule "ipv6_cidr_blocks").Count -ne 0) {
    throw "The cleanup recovery changes an unexpected application ingress rule."
  }
  foreach ($property in $Change.change.before.PSObject.Properties) {
    if ($property.Name -eq "ingress") { continue }
    $afterProperty = $Change.change.after.PSObject.Properties[$property.Name]
    if ($null -eq $afterProperty -or
        ($property.Value | ConvertTo-Json -Compress -Depth 50) -ne
        ($afterProperty.Value | ConvertTo-Json -Compress -Depth 50)) {
      throw "The cleanup recovery changes the application security group beyond ingress."
    }
  }
}

function New-Plan {
  param([object]$Baseline, [string]$Kind, [string[]]$Targets = @())
  $null = New-Item -ItemType Directory -Path $planDirectory -Force
  $commit = (& git -C $repositoryRoot rev-parse --short=8 HEAD).Trim()
  $path = Join-Path $planDirectory "provider-retirement-$Kind-$commit.tfplan"
  if (Test-Path -LiteralPath $path) { throw "The destination plan already exists." }
  $arguments = @("-chdir=$environmentDirectory", "plan", "-input=false", "-lock-timeout=5m", "-out=$path")
  foreach ($target in $Targets) { $arguments += "-target=$target" }
  Invoke-WithBaselineVariables $Baseline {
    $null = Invoke-Terraform $arguments
    if ($LASTEXITCODE -ne 0) { throw "Terraform planning failed." }
  }
  $plan = Get-PlanJson $path
  $changes = Get-PlanChanges $plan
  if ($Kind -eq "repository") {
    if ($changes.Count -ne 1 -or [string]$changes[0].address -ne "module.platform.aws_ecr_repository.migration" -or
        (@($changes[0].change.actions) -join ",") -ne "create") {
      throw "The repository plan is outside the exact one-create boundary."
    }
  } elseif ($Kind -eq "migration") {
    $addresses = @($changes | ForEach-Object { [string]$_.address })
    if ($addresses.Count -lt 1 -or $addresses -notcontains "module.platform.aws_ecs_task_definition.migration[0]" -or
        @($addresses | Where-Object { $_ -notin @(
          "module.platform.aws_ecs_task_definition.migration[0]",
          "module.platform.aws_iam_role_policy.execution_secrets"
        ) }).Count -ne 0) {
      throw "The migration-task plan changes resources outside the reviewed boundary."
    }
  } elseif ($Kind -eq "cleanup-recovery") {
    if ($changes.Count -ne 2) { throw "The cleanup recovery is outside the exact two-change boundary." }
    $application = @($changes | Where-Object { [string]$_.address -eq "module.platform.aws_security_group.application" })
    $legacyIngress = @($changes | Where-Object { [string]$_.address -eq "module.platform.aws_security_group.ingress" })
    if ($application.Count -ne 1 -or $legacyIngress.Count -ne 1 -or
        (@($legacyIngress[0].change.actions) -join ",") -ne "delete") {
      throw "The cleanup recovery is outside the exact retained-rule and legacy-group boundary."
    }
    Assert-ApplicationIngressRemoval $application[0]
  } else {
    $forbidden = @($changes | Where-Object {
      [string]$_.address -match "aws_(db_instance|kms_key|s3_bucket|sqs_queue|lambda_function|lambda_alias|cloudformation_stack|apigatewayv2_api)"
    })
    if ($forbidden.Count -ne 0) { throw "The cleanup plan changes a protected durable/runtime resource." }
    $requiredDeletes = @(
      "module.platform.aws_ecr_repository.gateway",
      "module.platform.aws_ecr_repository.worker",
      "module.platform.aws_secretsmanager_secret.temporal_api_key",
      "module.platform.aws_iam_role.application",
      "module.platform.aws_security_group.ingress"
    )
    $deletes = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "delete" } |
      ForEach-Object { [string]$_.address })
    foreach ($address in $requiredDeletes) {
      if ($deletes -notcontains $address) { throw "The cleanup plan does not delete '$address'." }
    }
    $allowed = @(
      "module.platform.aws_ecr_repository.gateway",
      "module.platform.aws_ecr_repository.worker",
      "module.platform.aws_iam_role.application",
      "module.platform.aws_iam_role_policy.execution_secrets",
      "module.platform.aws_secretsmanager_secret.temporal_api_key",
      "module.platform.aws_security_group.application",
      "module.platform.aws_security_group.ingress",
      "module.platform.aws_vpc_endpoint.secretsmanager[0]"
    )
    if (@($changes | Where-Object { [string]$_.address -notin $allowed }).Count -ne 0) {
      throw "The cleanup plan changes a resource outside the exact provider-retirement boundary."
    }
    $application = @($changes | Where-Object { [string]$_.address -eq "module.platform.aws_security_group.application" })
    if ($application.Count -gt 1) { throw "The cleanup plan contains duplicate application security-group changes." }
    if ($application.Count -eq 1) { Assert-ApplicationIngressRemoval $application[0] }
  }
  $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{ Environment = $Environment; Action = "plan_$Kind"; PlanPath = $path; PlanSha256 = $sha; Changes = $changes.Count } |
    ConvertTo-Json -Compress
}

function Get-CurrentMigrationImage {
  $task = Invoke-AwsJson @(
    "ecs", "describe-task-definition", "--task-definition", "ai-job-apply-$Environment-database-migration"
  ) "The migration task definition is unavailable."
  $containers = @($task.taskDefinition.containerDefinitions | Where-Object { $_.name -eq "database-migration" })
  if ($containers.Count -ne 1) { throw "The exact migration container is unavailable." }
  return [string]$containers[0].image
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][string]$Uri)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 20
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw "The retained public API could not be reached."
  }
}

function Assert-RuntimeHealthy {
  $gatewayUrl = (Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-raw", "gateway_url") 2>$null).TrimEnd('/')
  if (-not $gatewayUrl.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
    throw "The retained HTTPS gateway endpoint is unavailable."
  }
  if ((Get-HttpStatus "$gatewayUrl/health/live") -ne 200 -or
      (Get-HttpStatus "$gatewayUrl/health/ready") -ne 200 -or
      (Get-HttpStatus "$gatewayUrl/v1/me") -ne 401) {
    throw "The retained API did not pass the expected 200/200/401 boundary."
  }

  $mappingId = (Invoke-Terraform @(
    "-chdir=$environmentDirectory", "output", "-raw", "outbox_starter_event_source_mapping_uuid"
  ) 2>$null).Trim()
  $mapping = Invoke-AwsJson @("lambda", "get-event-source-mapping", "--uuid", $mappingId) `
    "The durable outbox trigger could not be inspected."
  if ([string]$mapping.State -ne "Enabled") { throw "The durable outbox trigger is not enabled." }

  foreach ($outputName in @("outbox_reconciler_rule_arn", "profile_readiness_terminal_rule_arn")) {
    $ruleArn = (Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-raw", $outputName) 2>$null).Trim()
    $ruleName = $ruleArn.Substring($ruleArn.LastIndexOf('/') + 1)
    $rule = Invoke-AwsJson @("events", "describe-rule", "--name", $ruleName) `
      "A retained durable runtime rule could not be inspected."
    if ([string]$rule.State -ne "ENABLED") { throw "A retained durable runtime rule is not enabled." }
  }
}

function Assert-EcrRepositoryAbsent {
  param([Parameter(Mandatory)][string]$RepositoryName)
  $result = @(& aws ecr describe-repositories --profile $AwsProfile --region $Region `
    --repository-names $RepositoryName --no-cli-pager --output json 2>&1)
  if ($LASTEXITCODE -eq 0) { throw "Legacy repository '$RepositoryName' still exists." }
  if (($result -join [Environment]::NewLine) -notmatch "RepositoryNotFoundException") {
    throw "Legacy repository '$RepositoryName' absence could not be proven."
  }
}

function Assert-TemporalSecretRetired {
  $secretId = "ai-job-apply/$Environment/temporal-api-key"
  $result = @(& aws secretsmanager describe-secret --profile $AwsProfile --region $Region `
    --secret-id $secretId --no-cli-pager --output json 2>&1)
  if ($LASTEXITCODE -ne 0) {
    if (($result -join [Environment]::NewLine) -match "ResourceNotFoundException") { return }
    throw "The retired Temporal secret state could not be inspected."
  }
  try { $secret = ($result -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "The retired Temporal secret state could not be inspected." }
  if ($null -eq $secret.DeletedDate) {
    throw "The retired Temporal secret is neither absent nor scheduled for deletion."
  }
}

function Assert-IamRoleAbsent {
  param([Parameter(Mandatory)][string]$RoleName)
  $result = @(& aws iam get-role --profile $AwsProfile --region $Region `
    --role-name $RoleName --no-cli-pager --output json 2>&1)
  if ($LASTEXITCODE -eq 0) { throw "Legacy IAM role '$RoleName' still exists." }
  if (($result -join [Environment]::NewLine) -notmatch "NoSuchEntity") {
    throw "Legacy IAM role '$RoleName' absence could not be proven."
  }
}

Assert-Tools

if ($Action -eq "Status") {
  $path = Resolve-PlanFile $PlanPath
  $plan = Get-PlanJson $path
  $changes = Get-PlanChanges $plan
  [pscustomobject]@{
    Environment = $Environment
    Action = "status"
    PlanPath = $path
    PlanSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    Changes = $changes.Count
    Creates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "create" }).Count
    Updates = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "update" }).Count
    Deletes = @($changes | Where-Object { (@($_.change.actions) -join ",") -eq "delete" }).Count
    Replacements = @($changes | Where-Object { @($_.change.actions) -contains "create" -and @($_.change.actions) -contains "delete" }).Count
  } | ConvertTo-Json -Compress
  exit 0
}

Assert-Caller

if ($Action -in @("PlanRepository", "PlanMigration", "PlanCleanup", "PlanCleanupRecovery", "Verify")) {
  $null = Assert-ExactMain
  Initialize-Backend
  $baselinePath = Resolve-ExistingFile $BaselinePlanPath "accepted baseline plan"
  $baseline = Get-PlanJson $baselinePath
  Assert-Baseline $baseline
}

if ($Action -eq "PlanRepository") {
  New-Plan $baseline "repository" @("module.platform.aws_ecr_repository.migration")
  exit 0
}

if ($Action -eq "PlanMigration") {
  Assert-MigrationImage
  New-Plan $baseline "migration" @("module.platform.aws_ecs_task_definition.migration[0]")
  exit 0
}

if ($Action -eq "Apply") {
  $null = Assert-ExactMain
  Initialize-Backend
  $path = Resolve-PlanFile $PlanPath
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedPlanSha256.ToLowerInvariant()) { throw "The saved plan checksum does not match authorization." }
  Invoke-Terraform @("-chdir=$environmentDirectory", "apply", "-input=false", $path)
  if ($LASTEXITCODE -ne 0) { throw "The exact reviewed Terraform plan failed to apply." }
  [pscustomobject]@{ Environment = $Environment; Action = "applied"; AppliedPlanSha256 = $actual } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq "RunMigration") {
  Initialize-Backend
  Assert-MigrationImage
  if ((Get-CurrentMigrationImage) -ne $MigrationImage) { throw "The deployed task does not use the reviewed migration image." }
  $cluster = (Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-raw", "ecs_cluster_arn") 2>$null).Trim()
  $taskDefinition = (Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-raw", "migration_task_definition_arn") 2>$null).Trim()
  $subnets = @(Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-json", "migration_subnet_ids") 2>$null | ConvertFrom-Json)
  $securityGroup = (Invoke-Terraform @("-chdir=$environmentDirectory", "output", "-raw", "application_security_group_id") 2>$null).Trim()
  if (-not $cluster -or -not $taskDefinition -or $subnets.Count -ne 2 -or -not $securityGroup) {
    throw "The Terraform-owned migration boundary is incomplete."
  }
  $network = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$securityGroup],assignPublicIp=ENABLED}"
  $taskArn = (& aws ecs run-task --profile $AwsProfile --region $Region --cluster $cluster `
    --task-definition $taskDefinition --launch-type FARGATE --count 1 `
    --network-configuration $network --query "tasks[0].taskArn" --output text --no-cli-pager 2>$null).Trim()
  if (-not $taskArn -or $taskArn -eq "None") { throw "AWS did not start the one-off migration task." }
  & aws ecs wait tasks-stopped --profile $AwsProfile --region $Region --cluster $cluster --tasks $taskArn --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw "The migration task did not reach a stopped state." }
  $task = Invoke-AwsJson @("ecs", "describe-tasks", "--cluster", $cluster, "--tasks", $taskArn) `
    "The stopped migration task could not be inspected."
  $container = @($task.tasks[0].containers | Where-Object { $_.name -eq "database-migration" })
  if ($container.Count -ne 1 -or [int]$container[0].exitCode -ne 0) { throw "The migration task failed." }
  [pscustomobject]@{ Environment = $Environment; Action = "migration_succeeded"; ExitCode = 0 } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq "PurgeLegacyImages") {
  if ((Get-CurrentMigrationImage) -ne $MigrationImage) { throw "The dedicated migration image is not deployed." }
  foreach ($repositoryName in @("ai-job-apply/gateway", "ai-job-apply/worker")) {
    $images = Invoke-AwsJson @("ecr", "list-images", "--repository-name", $repositoryName, "--filter", "tagStatus=ANY") `
      "The exact legacy repository could not be inspected."
    $ids = @(Get-OptionalArray $images "imageIds")
    if ($ids.Count -gt 0) {
      $temporary = Join-Path ([IO.Path]::GetTempPath()) "applydash-ecr-$([guid]::NewGuid().ToString('N')).json"
      try {
        $payload = @{ repositoryName = $repositoryName; imageIds = $ids } | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($temporary, $payload, (New-Object Text.UTF8Encoding($false)))
        $responseRaw = & aws ecr batch-delete-image --profile $AwsProfile --region $Region `
          --cli-input-json "file://$temporary" --no-cli-pager --output json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $responseRaw) { throw "The exact legacy image purge failed." }
        try { $response = ($responseRaw -join [Environment]::NewLine) | ConvertFrom-Json }
        catch { throw "The exact legacy image purge response could not be inspected." }
        if (@(Get-OptionalArray $response "failures").Count -ne 0) {
          throw "The exact legacy image purge reported a failed manifest deletion."
        }
      } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
      }
    }
    $remaining = Invoke-AwsJson @(
      "ecr", "list-images", "--repository-name", $repositoryName, "--filter", "tagStatus=ANY"
    ) "The exact legacy repository could not be verified after purge."
    if (@(Get-OptionalArray $remaining "imageIds").Count -ne 0) {
      throw "The exact legacy repository still contains images after purge."
    }
  }
  [pscustomobject]@{ Environment = $Environment; Action = "legacy_images_purged"; Repositories = 2 } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq "PlanCleanup") {
  Assert-MigrationImage
  if ((Get-CurrentMigrationImage) -ne $MigrationImage) { throw "The dedicated migration image is not deployed." }
  foreach ($repositoryName in @("ai-job-apply/gateway", "ai-job-apply/worker")) {
    $images = Invoke-AwsJson @("ecr", "list-images", "--repository-name", $repositoryName, "--filter", "tagStatus=ANY") `
      "The exact legacy repository could not be inspected."
    $legacyImageIds = @(Get-OptionalArray $images "imageIds")
    if ($legacyImageIds.Count -ne 0) {
      throw "Legacy repository '$repositoryName' is not empty."
    }
  }
  New-Plan $baseline "cleanup"
  exit 0
}

if ($Action -eq "PlanCleanupRecovery") {
  Assert-MigrationImage
  if ((Get-CurrentMigrationImage) -ne $MigrationImage) { throw "The dedicated migration image is not deployed." }
  foreach ($repositoryName in @("ai-job-apply/gateway", "ai-job-apply/worker")) {
    Assert-EcrRepositoryAbsent $repositoryName
  }
  Assert-TemporalSecretRetired
  Assert-IamRoleAbsent "ai-job-apply-$Environment-application"
  New-Plan $baseline "cleanup-recovery"
  exit 0
}

if ($Action -eq "Verify") {
  Assert-MigrationImage
  if ((Get-CurrentMigrationImage) -ne $MigrationImage) { throw "The dedicated migration image is not retained." }
  $temporaryPlan = Join-Path $planDirectory "provider-retirement-verify-$([guid]::NewGuid().ToString('N')).tfplan"
  try {
    Invoke-WithBaselineVariables $baseline {
      $null = Invoke-Terraform @(
        "-chdir=$environmentDirectory", "plan", "-input=false", "-lock-timeout=5m",
        "-detailed-exitcode", "-out=$temporaryPlan"
      )
      if ($LASTEXITCODE -ne 0) { throw "The post-retirement environment is not zero drift." }
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPlan) { Remove-Item -LiteralPath $temporaryPlan -Force }
  }
  foreach ($repositoryName in @("ai-job-apply/gateway", "ai-job-apply/worker")) {
    Assert-EcrRepositoryAbsent $repositoryName
  }
  Assert-TemporalSecretRetired
  Assert-RuntimeHealthy
  [pscustomobject]@{
    Environment = $Environment
    Action = "provider_retirement_verified"
    NoDrift = $true
    LambdaApi = "200/200/401"
    DurableTriggersEnabled = $true
    TemporalSecretRetired = $true
  } | ConvertTo-Json -Compress
}
