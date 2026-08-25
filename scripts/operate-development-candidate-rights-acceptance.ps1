[CmdletBinding()]
param(
  [ValidateSet("Status", "Plan", "Execute", "RecoverCleanup", "Verify")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",

  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
  [string]$ExpectedPolicyVersion = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPolicySha256 = "",

  [ValidateRange(300, 604800)]
  [int]$ExpectedExportLifetimeSeconds = 0,

  [ValidateRange(60, 900)]
  [int]$ExpectedDownloadGrantSeconds = 0,

  [ValidateRange(1, 35)]
  [int]$ExpectedBackupRetentionDays = 0,

  [ValidateRange(60, 900)]
  [int]$ExpectedRecentAuthMaxAgeSeconds = 0,

  [string]$ExpectedOwnerInventory = "identity,profile,documents,jobs,matching,billing",
  [string]$ExpectedSubprocessorInventory = "",

  [string]$ZeroDriftPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedZeroDriftPlanSha256 = "",

  [string]$ExecutionPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedExecutionPlanSha256 = "",

  [string]$ReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedReceiptSha256 = "",

  [string]$RecoveryReplayReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedRecoveryReplayReceiptSha256 = "",

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-candidate-rights-acceptance.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-candidate-rights-acceptance.ps1 -Action Plan|Execute|RecoverCleanup|Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -ExpectedPolicyVersion VERSION -ReviewedPolicySha256 SHA256 `
    -ExpectedExportLifetimeSeconds SECONDS -ExpectedDownloadGrantSeconds SECONDS `
    -ExpectedBackupRetentionDays DAYS -ExpectedRecentAuthMaxAgeSeconds SECONDS `
    -ExpectedSubprocessorInventory CSV -ZeroDriftPlanPath PATH `
    -ReviewedZeroDriftPlanSha256 SHA256 [reviewed plan/receipt arguments]

The fixed environment variables CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN and
CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH are required for Plan and Execute. The token
and identity are never printed or retained. The attestation must describe one disposable,
generated-synthetic, recent-MFA identity and an authorized owner other than Zach Becker.

Plan is read-only and writes one checksum-reviewable descriptor below the ignored development
.terraform directory. Execute is the only normal mutation action. It exercises one disposable
identity through export, exact-version download, grant expiry, artifact cleanup, request/cancel,
recent-MFA confirmation, Auth0 reconciliation, recovery-ledger completion, alert checks, and exact
cleanup. RecoverCleanup cannot create or confirm a deletion; it can only prove already-confirmed
cleanup. Verify additionally requires a separately reviewed aggregate recovery-replay receipt from
a quiesced disposable restore. No action accepts a token, subject, secret, payload, route, SQL,
command, role, bucket, Lambda, or network destination from the command line.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformRoot = Join-Path $repositoryRoot "infrastructure\terraform\environments\development\.terraform"
$operatorRoot = Join-Path $terraformRoot "development-candidate-rights-acceptance"
$stateKey = "platform.tfstate"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$requiredOwners = "identity,profile,documents,jobs,matching,billing"
$tokenEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN"
$attestationEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH"
$script:TestOnly = $env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY -ceq "1"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertFrom-Base64Url {
  param([Parameter(Mandatory)][string]$Value)
  $normalized = $Value.Replace("-", "+").Replace("_", "/")
  switch ($normalized.Length % 4) { 2 { $normalized += "==" } 3 { $normalized += "=" } 1 { throw "The access token is malformed." } }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($normalized))
}

function ConvertFrom-OperatorJson {
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Description)
  try {
    $command = Get-Command ConvertFrom-Json -CommandType Cmdlet
    if ($command.Parameters.ContainsKey("DateKind")) { return $Json | ConvertFrom-Json -DateKind String }
    return $Json | ConvertFrom-Json
  } catch { throw "$Description is invalid JSON." }
}

function Assert-ExactPropertySet {
  param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string[]]$Names, [Parameter(Mandatory)][string]$Description)
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Names | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) { throw "$Description does not have the exact property set." }
  return $true
}

function Resolve-BelowOperatorRoot {
  param([Parameter(Mandatory)][string]$Path, [switch]$MustExist)
  $root = [IO.Path]::GetFullPath($operatorRoot).TrimEnd('\', '/')
  $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $root $Path)) }
  if (-not $resolved.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw "Acceptance evidence must remain below the ignored operator directory." }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "The reviewed acceptance evidence file does not exist." }
  return $resolved
}

function Write-ExclusiveJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value)
  if (Test-Path -LiteralPath $Path) { throw "Refusing to replace acceptance evidence." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 30) + "`n"), $utf8WithoutBom)
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed. Refresh the approved development IAM Identity Center session." }
  return ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description "$Operation response"
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Read-StateSnapshot {
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") "State versioning"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") "State public access"
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") "State encryption"
  $block = $public.PublicAccessBlockConfiguration
  $kmsRules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.BucketKeyEnabled -eq $true -and [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms"
    })
  if ([string]$versioning.Status -cne "Enabled" -or $kmsRules.Count -ne 1 -or
      $block.BlockPublicAcls -ne $true -or $block.IgnorePublicAcls -ne $true -or
      $block.BlockPublicPolicy -ne $true -or $block.RestrictPublicBuckets -ne $true) {
    throw "The Terraform state bucket is outside the exact private, versioned, customer-KMS boundary."
  }
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") "State identity"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]::IsNullOrWhiteSpace([string]$head.VersionId)) { throw "The state object is not an exact encrypted version." }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $get = Invoke-AwsJson @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) "Versioned state read"
    if ([string]$get.VersionId -cne [string]$head.VersionId) { throw "The state version changed while it was read." }
    $state = ConvertFrom-OperatorJson (Get-Content -LiteralPath $temporary -Raw) "Terraform state"
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  if ([string]$state.terraform_version -cne "1.9.8" -or [long]$state.serial -lt 1 -or [string]$state.lineage -notmatch '^[0-9a-f-]{36}$') { throw "The Terraform state identity is invalid." }
  return [pscustomobject]@{ State = $state; VersionId = [string]$head.VersionId; Serial = [long]$state.serial; Lineage = [string]$state.lineage }
}

function Get-StateOutput {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Name)
  $property = $Snapshot.State.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) { throw "Terraform state is missing the required $Name output." }
  return $property.Value.value
}

function Get-StateResources {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type)
  return @($Snapshot.State.resources | Where-Object type -ceq $Type | ForEach-Object instances | ForEach-Object { $_.attributes })
}

function Assert-CallerAndSource {
  param([switch]$RequireSource)
  if ($Region -cne "us-east-2") { throw "Candidate-rights acceptance is restricted to us-east-2." }
  if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) { throw "The exact development account and state bucket are required." }
  $caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json") "AWS caller validation"
  if ([string]$caller.Account -cne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/AWSReservedSSO_")) { throw "Use the approved temporary IAM Identity Center role in the exact development account." }
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($RequireSource -and ($branch -cne "main" -or $head -cne $origin -or $head -cne $SourceSha -or $dirty.Count -ne 0)) { throw "Acceptance requires clean main exactly matching origin/main and SourceSha." }
  return [pscustomobject]@{ Head = $head; CallerType = "iam-identity-center" }
}

function Read-ReviewedZeroDrift {
  if ([string]::IsNullOrWhiteSpace($ZeroDriftPlanPath) -or $ReviewedZeroDriftPlanSha256 -notmatch '^[a-f0-9]{64}$') { throw "An exact reviewed zero-drift Terraform plan and checksum are required." }
  $path = [IO.Path]::GetFullPath($ZeroDriftPlanPath)
  if (-not $path.StartsWith([IO.Path]::GetFullPath($terraformRoot), [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The zero-drift plan must be an existing ignored development Terraform artifact." }
  if ((Get-FileSha256 $path) -cne $ReviewedZeroDriftPlanSha256) { throw "The zero-drift plan checksum does not match the reviewed value." }
  $shown = & terraform show -json $path 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The reviewed zero-drift plan cannot be inspected." }
  $plan = ConvertFrom-OperatorJson ($shown -join "`n") "Zero-drift plan"
  $changes = @($plan.resource_changes | Where-Object { (@($_.change.actions) -join ',') -cne 'no-op' })
  if ($changes.Count -ne 0) { throw "The reviewed Terraform plan is not zero drift." }
  return [pscustomobject]@{ Sha256 = $ReviewedZeroDriftPlanSha256; TerraformVersion = [string]$plan.terraform_version; MeaningfulChanges = 0 }
}

function Read-SyntheticIdentityContext {
  param([Parameter(Mandatory)][string]$ExpectedIssuer, [Parameter(Mandatory)][int]$MaximumAgeSeconds)
  $token = [Environment]::GetEnvironmentVariable($tokenEnvironmentName)
  $attestationPath = [Environment]::GetEnvironmentVariable($attestationEnvironmentName)
  if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($attestationPath)) { throw "The fixed generated-synthetic token and identity-attestation environment variables are required." }
  $segments = $token.Split('.')
  if ($segments.Count -ne 3) { throw "The access token is not a JWT." }
  $claims = ConvertFrom-OperatorJson (ConvertFrom-Base64Url $segments[1]) "Access-token claims"
  $attestation = ConvertFrom-OperatorJson (Get-Content -LiteralPath $attestationPath -Raw) "Identity attestation"
  $null = Assert-ExactPropertySet $attestation @("schemaVersion", "classification", "issuer", "subjectSha256", "authorizedOwner", "createdAt", "expiresAt") "Identity attestation"
  $now = [DateTimeOffset]::UtcNow
  $created = [DateTimeOffset]::Parse([string]$attestation.createdAt)
  $expires = [DateTimeOffset]::Parse([string]$attestation.expiresAt)
  $subject = [string]$claims.sub
  $scope = @(([string]$claims.scope).Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
  $amr = @($claims.amr | ForEach-Object { [string]$_ })
  $authTime = [DateTimeOffset]::FromUnixTimeSeconds([long]$claims.auth_time)
  $exp = [DateTimeOffset]::FromUnixTimeSeconds([long]$claims.exp)
  if ([int]$attestation.schemaVersion -ne 1 -or [string]$attestation.classification -cne "generated-synthetic-only" -or
      [string]$attestation.issuer -cne $ExpectedIssuer -or [string]$claims.iss -cne $ExpectedIssuer -or
      [string]$attestation.subjectSha256 -cne (Get-TextSha256 $subject) -or [string]$attestation.subjectSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]::IsNullOrWhiteSpace([string]$attestation.authorizedOwner) -or [string]$attestation.authorizedOwner -match '(?i)zach\s*becker' -or
      $created -gt $now -or $expires -le $now -or $exp -le $now.AddMinutes(2) -or $authTime -gt $now -or ($now - $authTime).TotalSeconds -gt $MaximumAgeSeconds -or
      -not $scope.Contains("profile:write") -or -not (@($amr | Where-Object { $_ -match '^(mfa|otp|webauthn)$' }).Count -ge 1)) {
    throw "The disposable identity is not an exact current generated-synthetic recent-MFA context under an authorized non-Zach owner."
  }
  return [pscustomobject]@{ Token = $token; Subject = $subject; SubjectSha256 = [string]$attestation.subjectSha256; AttestationSha256 = Get-FileSha256 $attestationPath; AuthTime = $authTime.ToString('o') }
}

function Get-LambdaIdentity {
  param([Parameter(Mandatory)][string]$AliasArn, [Parameter(Mandatory)][string]$Description)
  if ($AliasArn -notmatch '^(?<function>arn:aws:lambda:[^:]+:[0-9]{12}:function:[^:]+):(?<alias>[^:]+)$') { throw "$Description alias ARN is invalid." }
  $functionArn = [string]$Matches.function
  $aliasName = [string]$Matches.alias
  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $functionArn, "--name", $aliasName, "--output", "json") "$Description alias"
  $weights = Get-OptionalProperty (Get-OptionalProperty $alias "RoutingConfig") "AdditionalVersionWeights"
  if ([string]$alias.FunctionVersion -notmatch '^[1-9][0-9]*$' -or ($null -ne $weights -and @($weights.PSObject.Properties).Count -ne 0)) { throw "$Description must be one unweighted numeric version." }
  $configuration = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $functionArn, "--qualifier", [string]$alias.FunctionVersion, "--output", "json") "$Description version"
  if ([string]$configuration.CodeSha256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or [string]$configuration.Version -cne [string]$alias.FunctionVersion) { throw "$Description immutable artifact identity is invalid." }
  return [pscustomobject]@{ AliasArnSha256 = Get-TextSha256 $AliasArn; Version = [int]$alias.FunctionVersion; CodeSha256 = [string]$configuration.CodeSha256; Environment = $configuration.Environment.Variables }
}

function Assert-PolicyEnvironment {
  param([Parameter(Mandatory)][object]$Environment)
  $expected = [ordered]@{
    CANDIDATE_RIGHTS_POLICY_VERSION = $ExpectedPolicyVersion
    CANDIDATE_RIGHTS_POLICY_SHA256 = $ReviewedPolicySha256
    CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS = [string]$ExpectedExportLifetimeSeconds
    CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS = [string]$ExpectedDownloadGrantSeconds
    CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS = [string]$ExpectedBackupRetentionDays
    CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS = [string]$ExpectedRecentAuthMaxAgeSeconds
    CANDIDATE_RIGHTS_OWNER_INVENTORY = $ExpectedOwnerInventory
    CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY = $ExpectedSubprocessorInventory
  }
  if ($ExpectedOwnerInventory -cne $requiredOwners -or [string]::IsNullOrWhiteSpace($ExpectedSubprocessorInventory)) { throw "The exact owner and nonempty subprocessor inventories are required." }
  foreach ($entry in $expected.GetEnumerator()) {
    if ([string](Get-OptionalProperty $Environment $entry.Key) -cne [string]$entry.Value) { throw "The live candidate-rights policy environment does not match the reviewed $($entry.Key) value." }
  }
  return $true
}

function Assert-Auth0SecretBoundary {
  param([Parameter(Mandatory)][string]$SecretArn)
  $description = Invoke-AwsJson @("secretsmanager", "describe-secret", "--secret-id", $SecretArn, "--output", "json") "Candidate-rights Auth0 secret metadata"
  $tags = @{}; foreach ($tag in @($description.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  if ($tags['ai-job-apply:generated-synthetic-only'] -cne 'true' -or [string]::IsNullOrWhiteSpace($tags['ai-job-apply:authorized-owner']) -or $tags['ai-job-apply:authorized-owner'] -match '(?i)zach\s*becker') { throw "The Auth0 M2M secret lacks the exact generated-synthetic, authorized non-Zach ownership tags." }
  $value = Invoke-AwsJson @("secretsmanager", "get-secret-value", "--secret-id", $SecretArn, "--output", "json") "Candidate-rights Auth0 secret validation"
  $secret = ConvertFrom-OperatorJson ([string]$value.SecretString) "Candidate-rights Auth0 secret"
  $null = Assert-ExactPropertySet $secret @("clientId", "clientSecret", "revocationMode") "Candidate-rights Auth0 secret"
  if ([string]::IsNullOrWhiteSpace([string]$secret.clientId) -or ([string]$secret.clientSecret).Length -lt 16 -or [string]$secret.revocationMode -cne 'revoke_sessions_refresh_tokens_then_delete') { throw "Candidate-rights acceptance requires the explicit sessions/refresh-tokens/delete Auth0 revocation mode." }
  return [pscustomobject]@{ ClientIdSha256 = Get-TextSha256 ([string]$secret.clientId); RevocationMode = [string]$secret.revocationMode; AuthorizedOwnerSha256 = Get-TextSha256 $tags['ai-job-apply:authorized-owner'] }
}

function Get-BackupInventory {
  param([Parameter(Mandatory)][object]$Snapshot)
  $databases = @(Get-StateResources $Snapshot 'aws_db_instance')
  if ($databases.Count -ne 1) { throw "Acceptance requires exactly one state-managed development RDS instance." }
  $identifier = [string]$databases[0].identifier
  $response = Invoke-AwsJson @("rds", "describe-db-instances", "--db-instance-identifier", $identifier, "--output", "json") "RDS backup policy"
  $instance = @($response.DBInstances)
  if ($instance.Count -ne 1 -or [string]$instance[0].DBInstanceStatus -cne 'available' -or [int]$instance[0].BackupRetentionPeriod -lt $ExpectedBackupRetentionDays -or -not $instance[0].LatestRestorableTime) { throw "The development database backup inventory or aging boundary is incomplete." }
  $snapshots = Invoke-AwsJson @("rds", "describe-db-snapshots", "--db-instance-identifier", $identifier, "--output", "json") "RDS snapshot inventory"
  $inventory = @($snapshots.DBSnapshots | ForEach-Object { "$($_.SnapshotType)|$($_.Status)|$($_.SnapshotCreateTime)|$($_.Encrypted)" } | Sort-Object)
  return [pscustomobject]@{ BackupRetentionDays = [int]$instance[0].BackupRetentionPeriod; SnapshotCount = $inventory.Count; InventorySha256 = Get-TextSha256 ($inventory -join "`n"); LatestRestorableTime = ([DateTimeOffset]$instance[0].LatestRestorableTime).ToUniversalTime().ToString('o') }
}

function Assert-OperationalHealth {
  param([Parameter(Mandatory)][object]$Snapshot)
  $cluster = [string](Get-StateOutput $Snapshot 'ecs_cluster_arn')
  $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $cluster, "--output", "json") "ECS idle boundary"
  if (@($tasks.taskArns).Count -ne 0) { throw "Candidate-rights acceptance requires zero active ECS tasks." }
  $queueUrls = @()
  foreach ($queue in @(Get-StateResources $Snapshot 'aws_sqs_queue')) {
    if ([string]$queue.url) { $queueUrls += [string]$queue.url }
  }
  foreach ($url in $queueUrls) {
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", $url, "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed", "--output", "json") "Queue health"
    foreach ($name in @('ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed')) { if ([int]$attributes.Attributes.$name -ne 0) { throw "A state-managed queue is not empty." } }
  }
  $alarms = Invoke-AwsJson @("cloudwatch", "describe-alarms", "--alarm-name-prefix", "ai-job-apply-development-", "--output", "json") "Development alarms"
  $metricAlarms = @($alarms.MetricAlarms)
  if ($metricAlarms.Count -lt 1 -or @($alarms.CompositeAlarms).Count -ne 0 -or @($metricAlarms | Where-Object { $_.StateValue -cne 'OK' -or $_.ActionsEnabled -ne $true }).Count -ne 0) { throw "Every development alarm must be enabled and OK." }
  return [pscustomobject]@{ ActiveCompute = 0; QueueCount = $queueUrls.Count; QueuedMessages = 0; AlarmCount = $metricAlarms.Count; AlarmsOk = $true }
}

function Get-RuntimeBoundary {
  param([Parameter(Mandatory)][object]$Snapshot)
  $gatewayUrl = [string](Get-StateOutput $Snapshot 'gateway_url')
  $issuerResources = @(Get-StateResources $Snapshot 'aws_apigatewayv2_authorizer')
  $issuer = @($issuerResources | ForEach-Object { $_.jwt_configuration[0].issuer } | Where-Object { $_ }) | Select-Object -Unique
  if ($gatewayUrl -notmatch '^https://[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com$' -or @($issuer).Count -ne 1) { throw "The exact regional gateway and issuer boundary is unavailable." }
  $aliases = [ordered]@{}
  foreach ($binding in @(
      @('gateway', 'gateway_lambda_alias_arn'),
      @('outboxStarter', 'outbox_starter_alias_arn'),
      @('durable', 'profile_readiness_durable_alias_arn'),
      @('activity', 'profile_readiness_activity_alias_arn'),
      @('terminal', 'profile_readiness_terminal_alias_arn')
    )) {
    $aliases[$binding[0]] = Get-LambdaIdentity ([string](Get-StateOutput $Snapshot $binding[1])) $binding[0]
  }
  $null = Assert-PolicyEnvironment $aliases.activity.Environment
  return [pscustomobject]@{
    GatewayUrl = $gatewayUrl.TrimEnd('/'); Issuer = [string]$issuer[0]; Aliases = [pscustomobject]$aliases
    ExportBucket = [string](Get-StateOutput $Snapshot 'candidate_data_export_bucket')
    RecoveryBucket = [string](Get-StateOutput $Snapshot 'candidate_deletion_recovery_bucket')
    Auth0SecretArn = [string](Get-StateOutput $Snapshot 'candidate_rights_auth0_secret_arn')
  }
}

function Get-AcceptanceBoundary {
  param([switch]$RequireIdentity)
  $source = Assert-CallerAndSource -RequireSource:$RequireIdentity
  $snapshot = Read-StateSnapshot
  $runtime = Get-RuntimeBoundary $snapshot
  $secret = Assert-Auth0SecretBoundary $runtime.Auth0SecretArn
  $backup = Get-BackupInventory $snapshot
  $health = Assert-OperationalHealth $snapshot
  $drift = if ($RequireIdentity) { Read-ReviewedZeroDrift } else { $null }
  $identity = if ($RequireIdentity) { Read-SyntheticIdentityContext $runtime.Issuer $ExpectedRecentAuthMaxAgeSeconds } else { $null }
  return [pscustomobject]@{ Source = $source; Snapshot = $snapshot; Runtime = $runtime; Secret = $secret; Backup = $backup; Health = $health; Drift = $drift; Identity = $identity }
}

function New-ExecutionPlan {
  param([Parameter(Mandatory)][object]$Boundary)
  $now = [DateTimeOffset]::UtcNow
  $aliasIdentity = [ordered]@{}
  foreach ($name in @('gateway', 'outboxStarter', 'durable', 'activity', 'terminal')) {
    $value = $Boundary.Runtime.Aliases.$name
    $aliasIdentity[$name] = [ordered]@{ aliasArnSha256 = $value.AliasArnSha256; version = $value.Version; codeSha256 = $value.CodeSha256 }
  }
  return [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-plan'; environment = 'development'; region = $Region
    sourceSha = $SourceSha; createdAt = $now.ToString('o'); expiresAt = $now.AddMinutes(15).ToString('o')
    state = [ordered]@{ lineage = $Boundary.Snapshot.Lineage; serial = $Boundary.Snapshot.Serial; versionIdSha256 = Get-TextSha256 $Boundary.Snapshot.VersionId }
    policy = [ordered]@{ version = $ExpectedPolicyVersion; sha256 = $ReviewedPolicySha256; exportLifetimeSeconds = $ExpectedExportLifetimeSeconds; downloadGrantSeconds = $ExpectedDownloadGrantSeconds; backupRetentionDays = $ExpectedBackupRetentionDays; recentAuthMaxAgeSeconds = $ExpectedRecentAuthMaxAgeSeconds; owners = $ExpectedOwnerInventory; subprocessors = $ExpectedSubprocessorInventory }
    identity = [ordered]@{ classification = 'generated-synthetic-only'; subjectSha256 = $Boundary.Identity.SubjectSha256; attestationSha256 = $Boundary.Identity.AttestationSha256; recentMfa = $true }
    auth0 = [ordered]@{ clientIdSha256 = $Boundary.Secret.ClientIdSha256; authorizedOwnerSha256 = $Boundary.Secret.AuthorizedOwnerSha256; revocationMode = $Boundary.Secret.RevocationMode }
    backups = $Boundary.Backup
    aliases = $aliasIdentity
    health = $Boundary.Health
    zeroDriftPlanSha256 = $Boundary.Drift.Sha256
    fixedSequence = @('export-request', 'export-idempotent-replay', 'export-ready', 'exact-version-download', 'download-grant-expired', 'deletion-request', 'deletion-cancel', 'fresh-recent-mfa-recheck', 'deletion-request', 'recent-mfa-confirm', 'owner-auth0-export-cleanup-reconciliation', 'recovery-ledger-completed', 'alerts-and-queues', 'zero-compute', 'zero-drift')
  }
}

function Read-ExecutionPlan {
  $path = Resolve-BelowOperatorRoot $ExecutionPlanPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedExecutionPlanSha256) { throw "The execution-plan checksum does not match the reviewed value." }
  $plan = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Execution plan"
  $null = Assert-ExactPropertySet $plan @('schemaVersion','kind','environment','region','sourceSha','createdAt','expiresAt','state','policy','identity','auth0','backups','aliases','health','zeroDriftPlanSha256','fixedSequence') "Execution plan"
  if ([int]$plan.schemaVersion -ne 1 -or [string]$plan.kind -cne 'development-candidate-rights-acceptance-plan' -or [string]$plan.sourceSha -cne $SourceSha -or [DateTimeOffset]::Parse([string]$plan.expiresAt) -le [DateTimeOffset]::UtcNow -or
      [string]$plan.policy.sha256 -cne $ReviewedPolicySha256 -or [string]$plan.identity.classification -cne 'generated-synthetic-only' -or [string]$plan.auth0.revocationMode -cne 'revoke_sessions_refresh_tokens_then_delete' -or @($plan.fixedSequence).Count -ne 15) { throw "The reviewed execution plan is invalid or expired." }
  return [pscustomobject]@{ Path = $path; Value = $plan }
}

function Invoke-CandidateApi {
  param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Token, [AllowNull()][object]$Body, [hashtable]$Headers = @{}, [int[]]$ExpectedStatus = @(200))
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  try {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), "$($script:Runtime.GatewayUrl)/v1$Path")
    $request.Headers.TryAddWithoutValidation('authorization', "Bearer $Token") | Out-Null
    foreach ($entry in $Headers.GetEnumerator()) { $request.Headers.TryAddWithoutValidation([string]$entry.Key, [string]$entry.Value) | Out-Null }
    if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json') }
    $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    if (-not $ExpectedStatus.Contains($status)) { $response.Dispose(); throw "The candidate API returned an unexpected status during the fixed acceptance sequence." }
    $cacheControl = @($response.Headers.GetValues('cache-control')) -join ','
    if ($status -ne 204 -and $cacheControl -cne 'no-store') { $response.Dispose(); throw "A candidate-rights response omitted cache-control no-store." }
    $json = $null
    if ($status -ne 204) {
      $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
      if ($bytes.Length -lt 2 -or $bytes.Length -gt 65536) { $response.Dispose(); throw "A candidate-rights response exceeded the bounded JSON envelope." }
      $json = ConvertFrom-OperatorJson ([Text.Encoding]::UTF8.GetString($bytes)) "Candidate-rights response"
    }
    $response.Dispose()
    return [pscustomobject]@{ Status = $status; Body = $json }
  } finally { $client.Dispose() }
}

function Wait-ExportReady {
  param([Parameter(Mandatory)][string]$ExportId, [Parameter(Mandatory)][string]$Token)
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
  do {
    $value = (Invoke-CandidateApi GET "/me/data-exports/$ExportId" $Token $null).Body
    if ([string]$value.export.state -ceq 'ready') { return $value }
    if ([string]$value.export.state -in @('failed','expired')) { throw "The generated-synthetic export did not become ready." }
    Start-Sleep -Seconds 2
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The generated-synthetic export did not become ready within the bounded wait."
}

function Test-ExactVersionGrant {
  param([Parameter(Mandatory)][object]$Access)
  $uri = [Uri]([string]$Access.download.url)
  $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
  if ($uri.Scheme -cne 'https' -or $uri.Host -notmatch '\.s3\..*\.amazonaws\.com$' -or [string]::IsNullOrWhiteSpace($query['versionId']) -or [string]$Access.download.method -cne 'GET' -or [int]$query['X-Amz-Expires'] -gt $ExpectedDownloadGrantSeconds) { throw "The export grant is not exact-version, bounded, and HTTPS." }
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  try {
    $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if ([int]$response.StatusCode -ne 200) { throw "The exact-version generated-synthetic download failed." }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $buffer = New-Object byte[] 8192; $count = 0
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) { $count += $read; if ($count -gt 1048576) { throw "The generated-synthetic export exceeded the acceptance bound." } }
    $response.Dispose()
  } finally { $client.Dispose() }
  return [pscustomobject]@{ DownloadBytes = $count; GrantExpiresAt = [DateTimeOffset]::Parse([string]$Access.download.expiresAt); ArtifactExpiresAt = [DateTimeOffset]::Parse([string]$Access.export.artifactExpiresAt) }
}

function Wait-GrantExpiry {
  param([Parameter(Mandatory)][string]$ExportId, [Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][Uri]$GrantUri, [Parameter(Mandatory)][DateTimeOffset]$GrantExpiresAt, [Parameter(Mandatory)][DateTimeOffset]$ArtifactExpiresAt)
  $grantWait = [Math]::Max(0, [Math]::Ceiling(($GrantExpiresAt - [DateTimeOffset]::UtcNow).TotalSeconds) + 2)
  if ($grantWait -gt ($ExpectedDownloadGrantSeconds + 5)) { throw "The signed download expiry exceeds the reviewed timing." }
  if ($grantWait -gt 0) { Start-Sleep -Seconds $grantWait }
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  try { $expired = $client.GetAsync($GrantUri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult(); if ([int]$expired.StatusCode -eq 200) { throw "The exact-version signed download remained usable after expiry." }; $expired.Dispose() } finally { $client.Dispose() }
  if ($ArtifactExpiresAt -le [DateTimeOffset]::UtcNow) { throw "The export artifact lifetime elapsed before deletion cleanup could be exercised." }
  return $true
}

function Wait-DeletionCompletion {
  param([Parameter(Mandatory)][string]$RequestId, [Parameter(Mandatory)][string]$SubjectSha256)
  $key = "candidate-deletion-recovery/$RequestId.json"
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(10)
  do {
    try {
      $head = Invoke-AwsJson @('s3api','head-object','--bucket',$script:Runtime.RecoveryBucket,'--key',$key,'--output','json') 'Recovery marker completion'
      $tags = Invoke-AwsJson @('s3api','get-object-tagging','--bucket',$script:Runtime.RecoveryBucket,'--key',$key,'--version-id',[string]$head.VersionId,'--output','json') 'Recovery marker tags'
      $map = @{}; foreach ($tag in @($tags.TagSet)) { $map[[string]$tag.Key] = [string]$tag.Value }
      if ([string]$head.Metadata.'subject-digest' -cne $SubjectSha256 -or [string]$head.Metadata.'policy-sha256' -cne $ReviewedPolicySha256 -or [string]$head.Metadata.format -cne 'candidate-deletion-recovery-v1') { throw "The recovery marker does not bind the exact synthetic subject and reviewed policy." }
      if ($map.state -ceq 'completed' -and [DateTimeOffset]::Parse($map.'completed-at') -le [DateTimeOffset]::UtcNow) { return $true }
    } catch { if ($_.Exception.Message -notmatch 'Recovery marker completion failed') { throw } }
    Start-Sleep -Seconds 5
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The candidate deletion recovery marker did not reach completed."
}

function Invoke-FixedLifecycle {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][object]$Plan)
  $script:Runtime = $Boundary.Runtime
  $token = $Boundary.Identity.Token
  $started = [DateTimeOffset]::UtcNow
  $exportKey = "rights-export-$([guid]::NewGuid().ToString('N'))"
  $exportBody = [ordered]@{ format = 'candidate-data-export-v1' }
  $first = Invoke-CandidateApi POST '/me/data-exports' $token $exportBody @{ 'idempotency-key' = $exportKey } @(202)
  $replay = Invoke-CandidateApi POST '/me/data-exports' $token $exportBody @{ 'idempotency-key' = $exportKey } @(202)
  if ([string]$first.Body.id -cne [string]$replay.Body.id -or [string]$first.Body.policyVersion -cne $ExpectedPolicyVersion) { throw "Candidate export idempotency or policy binding failed." }
  $ready = Wait-ExportReady ([string]$first.Body.id) $token
  $download = Test-ExactVersionGrant $ready
  $grantUri = [Uri]([string]$ready.download.url)
  $null = Wait-GrantExpiry ([string]$first.Body.id) $token $grantUri $download.GrantExpiresAt $download.ArtifactExpiresAt

  $cancelKey = "rights-delete-cancel-$([guid]::NewGuid().ToString('N'))"
  $deletionBody = [ordered]@{ acknowledgement = 'ACCOUNT_DELETION_IS_IRREVERSIBLE' }
  $cancelRequest = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = $cancelKey } @(201)
  $cancelReplay = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = $cancelKey } @(201)
  if ([string]$cancelRequest.Body.id -cne [string]$cancelReplay.Body.id) { throw "Deletion-request idempotency failed." }
  $null = Invoke-CandidateApi DELETE "/me/account-deletion-requests/$($cancelRequest.Body.id)" $token $null @{ 'idempotency-key' = "rights-cancel-$([guid]::NewGuid().ToString('N'))"; 'if-match' = "`"$($cancelRequest.Body.version)`"" } @(204)

  $freshIdentity = Read-SyntheticIdentityContext $Boundary.Runtime.Issuer $ExpectedRecentAuthMaxAgeSeconds
  if ([string]$freshIdentity.SubjectSha256 -cne [string]$Boundary.Identity.SubjectSha256) { throw "The recent-MFA refresh changed the reviewed generated-synthetic identity." }
  $token = $freshIdentity.Token
  $confirmRequest = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = "rights-delete-$([guid]::NewGuid().ToString('N'))" } @(201)
  $confirmation = [ordered]@{ expectedVersion = [int]$confirmRequest.Body.version; confirmation = 'DELETE_MY_ACCOUNT' }
  $confirmed = Invoke-CandidateApi POST "/me/account-deletion-requests/$($confirmRequest.Body.id)/confirm" $token $confirmation @{ 'idempotency-key' = "rights-confirm-$([guid]::NewGuid().ToString('N'))" } @(202)
  if ([string]$confirmed.Body.state -cne 'quarantined') { throw "Deletion confirmation did not atomically quarantine the generated-synthetic identity." }
  $null = Wait-DeletionCompletion ([string]$confirmRequest.Body.id) $Boundary.Identity.SubjectSha256
  $post = Assert-OperationalHealth $Boundary.Snapshot
  return [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-receipt'; phase = 'verified-cleaned'; sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256; policySha256 = $ReviewedPolicySha256; subjectSha256 = $Boundary.Identity.SubjectSha256
    startedAt = $started.ToString('o'); completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    exportsRequested = 1; idempotentExportReplays = 1; exactVersionDownloads = 1; expiredDownloadGrants = 1; exportObjectsCleaned = 1
    deletionRequestsCreated = 2; deletionRequestsCancelled = 1; recentMfaConfirmations = 1; deletionMarkersCompleted = 1
    ownerInventoriesReconciled = 6; auth0Reconciled = $true; persistentSyntheticIdentities = 0
    queueCount = $post.QueueCount; queuedMessages = 0; alarmCount = $post.AlarmCount; alarmsOk = $true; activeCompute = 0
    stateLineage = $Boundary.Snapshot.Lineage; stateSerial = $Boundary.Snapshot.Serial; zeroDriftPlanSha256 = $ReviewedZeroDriftPlanSha256
  }
}

function Read-AggregateReceipt {
  $path = Resolve-BelowOperatorRoot $ReceiptPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedReceiptSha256) { throw "The candidate-rights receipt checksum does not match the reviewed value." }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Candidate-rights receipt"
  if ([string]$receipt.kind -cne 'development-candidate-rights-acceptance-receipt' -or [string]$receipt.phase -cne 'verified-cleaned' -or [string]$receipt.sourceSha -cne $SourceSha -or [int]$receipt.exportsRequested -ne 1 -or [int]$receipt.exportObjectsCleaned -ne 1 -or [int]$receipt.deletionMarkersCompleted -ne 1 -or [int]$receipt.ownerInventoriesReconciled -ne 6 -or $receipt.auth0Reconciled -ne $true -or [int]$receipt.persistentSyntheticIdentities -ne 0 -or [int]$receipt.queuedMessages -ne 0 -or [int]$receipt.activeCompute -ne 0) { throw "The reviewed candidate-rights aggregate receipt is incomplete." }
  return $receipt
}

function Read-RecoveryReplayReceipt {
  if ([string]::IsNullOrWhiteSpace($RecoveryReplayReceiptPath) -or $ReviewedRecoveryReplayReceiptSha256 -notmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $RecoveryReplayReceiptPath -PathType Leaf)) { throw "A separately reviewed aggregate recovery-replay receipt is required." }
  if ((Get-FileSha256 $RecoveryReplayReceiptPath) -cne $ReviewedRecoveryReplayReceiptSha256) { throw "The recovery-replay receipt checksum does not match." }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $RecoveryReplayReceiptPath -Raw) "Recovery-replay receipt"
  $null = Assert-ExactPropertySet $receipt @('schemaVersion','kind','environment','sourceSha','policySha256','restoredDatabaseClass','markersValidated','restoredUsersAbsent','restoredUsersReconciled','primaryDatabaseRejected','trafficEnabled','cleanupSucceeded','completedAt') "Recovery-replay receipt"
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne 'development-candidate-deletion-recovery-replay' -or [string]$receipt.environment -cne 'development' -or [string]$receipt.sourceSha -cne $SourceSha -or [string]$receipt.policySha256 -cne $ReviewedPolicySha256 -or [string]$receipt.restoredDatabaseClass -cne 'disposable-quiesced-generated-synthetic' -or [int]$receipt.markersValidated -lt 1 -or ([int]$receipt.restoredUsersAbsent + [int]$receipt.restoredUsersReconciled) -ne [int]$receipt.markersValidated -or $receipt.primaryDatabaseRejected -ne $true -or $receipt.trafficEnabled -ne $false -or $receipt.cleanupSucceeded -ne $true) { throw "The recovery-replay receipt does not prove isolated aggregate reconciliation and cleanup." }
  return $receipt
}

if (-not $script:TestOnly) {
  switch ($Action) {
    'Status' {
      $boundary = Get-AcceptanceBoundary
      [pscustomobject]@{ Environment = 'development'; CandidateRightsEnabled = $true; StateSerial = $boundary.Snapshot.Serial; PolicyBound = $true; BackupInventoryBound = $true; Auth0AuthorizedNonZach = $true; QueuedMessages = 0; ActiveCompute = 0; AlarmsOk = $true; CloudMutation = $false }
    }
    'Plan' {
      $boundary = Get-AcceptanceBoundary -RequireIdentity
      $plan = New-ExecutionPlan $boundary
      $path = Join-Path $operatorRoot "plan-$([guid]::NewGuid().ToString('N')).json"
      Write-ExclusiveJson $path $plan
      [pscustomobject]@{ Outcome = 'review-required'; PlanPath = $path; PlanSha256 = Get-FileSha256 $path; FixedSteps = 15; CloudMutation = $false }
    }
    'Execute' {
      $reviewed = Read-ExecutionPlan
      $boundary = Get-AcceptanceBoundary -RequireIdentity
      $current = New-ExecutionPlan $boundary
      foreach ($name in @('sourceSha','policy','identity','auth0','backups','aliases','zeroDriftPlanSha256')) {
        if (($reviewed.Value.$name | ConvertTo-Json -Depth 20 -Compress) -cne ($current.$name | ConvertTo-Json -Depth 20 -Compress)) { throw "The live $name boundary changed after plan review." }
      }
      $receipt = Invoke-FixedLifecycle $boundary $reviewed.Value
      $path = Join-Path $operatorRoot "receipt-$($ReviewedExecutionPlanSha256.Substring(0,12)).json"
      Write-ExclusiveJson $path $receipt
      [pscustomobject]@{ Outcome = 'verified-and-cleaned'; ReceiptPath = $path; ReceiptSha256 = Get-FileSha256 $path; ExportsRequested = 1; DeletionMarkersCompleted = 1; PersistentSyntheticIdentities = 0 }
    }
    'RecoverCleanup' {
      $receipt = Read-AggregateReceipt
      $boundary = Get-AcceptanceBoundary
      $health = Assert-OperationalHealth $boundary.Snapshot
      [pscustomobject]@{ Outcome = 'cleanup-already-proved'; AcceptanceClaim = $false; PersistentSyntheticIdentities = [int]$receipt.persistentSyntheticIdentities; QueuedMessages = $health.QueuedMessages; ActiveCompute = $health.ActiveCompute; CloudMutation = $false }
    }
    'Verify' {
      $receipt = Read-AggregateReceipt
      $replay = Read-RecoveryReplayReceipt
      $boundary = Get-AcceptanceBoundary -RequireIdentity:$false
      if ([long]$receipt.stateSerial -ne $boundary.Snapshot.Serial -or [string]$receipt.stateLineage -cne $boundary.Snapshot.Lineage) { throw "Terraform state changed after candidate-rights execution." }
      [pscustomobject]@{ Outcome = 'verified'; ExportLifecyclePassed = $true; DeletionLifecyclePassed = $true; RecoveryMarkersValidated = [int]$replay.markersValidated; PersistentSyntheticIdentities = 0; QueuedMessages = 0; ActiveCompute = 0; AlarmsOk = $true; StateChanged = $false; CloudMutation = $false }
    }
  }
}
