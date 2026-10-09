#Requires -Version 7.2
[CmdletBinding()]
param(
  [ValidateSet('PlanExecution','Execute','Recover')][string]$Action = 'PlanExecution',
  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [string]$ExpectedAccountId,
  [string]$StateBucket,
  [string]$StateKmsKeyArn,
  [string]$PublicationReceiptPath,
  [string]$PublicationReceiptSha256,
  [string]$PlanPath,
  [string]$ReviewedPlanSha256,
  [switch]$Help
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/terraform-toolchain.ps1')
. (Join-Path $PSScriptRoot 'lib/legacy-receipt-maintenance-guards.ps1')
if ($Help) {
  'Prepare the dedicated Terraform task first. PlanExecution verifies its current state, immutable image, drain and snapshot. Execute consumes the exact plan SHA once. Recover only observes the original task. See scripts/README.md. All artifacts belong under .tmp/legacy-receipt-maintenance; mandatory database shutdown remains a separate lifecycle gate.'
  exit 0
}
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$terraformDirectory = Join-Path $repository 'infrastructure/terraform/environments/development'
$privateRoot = Join-Path $repository '.tmp/legacy-receipt-maintenance'
if ($ExpectedAccountId -cnotmatch '^[0-9]{12}$') { throw 'LegacyReceiptAccountRequired' }
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = 'us-east-2'
$env:AWS_DEFAULT_REGION = 'us-east-2'
foreach ($entry in @(Get-ChildItem Env:)) {
  if ($entry.Name -imatch '^AWS_(?:ENDPOINT_URL(?:_.*)?|(?:S3|STS|IAM|DYNAMODB)_ENDPOINT|EC2_METADATA_SERVICE_ENDPOINT|CA_BUNDLE)$' -and $entry.Value) { throw 'LegacyReceiptAwsEndpointOverrideRejected' }
}
if ((Get-Command aws -ErrorAction Stop).CommandType -ne [Management.Automation.CommandTypes]::Application) { throw 'LegacyReceiptNativeAwsCliRequired' }

function Resolve-LegacyReceiptArtifact([string]$Path) {
  if (-not $Path) { throw 'LegacyReceiptPrivatePathRequired' }
  $full = [IO.Path]::GetFullPath($Path, $repository)
  if ([IO.Path]::GetDirectoryName($full) -cne $privateRoot -or [IO.Path]::GetExtension($full) -cne '.json') { throw 'LegacyReceiptPrivatePathInvalid' }
  $ancestor = $privateRoot
  while ($ancestor -and $ancestor -cne $repository) {
    if (Test-Path -LiteralPath $ancestor) {
      if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'LegacyReceiptPrivatePathReparsePoint' }
    }
    $ancestor = [IO.Path]::GetDirectoryName($ancestor)
  }
  if (Test-Path -LiteralPath $full) { $null = Resolve-DeploymentTerraformFile -Path $full }
  return $full
}
function Read-LegacyReceiptAws([string[]]$Arguments) {
  $raw = @(& aws @Arguments --profile $AwsProfile --region us-east-2 --output json --no-cli-pager --cli-connect-timeout 10 --cli-read-timeout 30 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "LegacyReceiptAwsReadFailed:$($Arguments[0]):$($Arguments[1])" }
  return ConvertFrom-DeploymentTerraformJson ($raw -join "`n")
}
function Write-LegacyReceiptArtifact([string]$Path, $Value, [switch]$Replace) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 60 -Compress) + "`n")
  if (-not $Replace) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes); $stream.Flush($true) } finally { $stream.Dispose() }
  } else {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllBytes($temporary, $bytes)
    [IO.File]::Move($temporary, $Path, $true)
  }
}
function Read-LegacyReceiptState {
  Assert-DeploymentTerraformCli
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -ExpectedBucket $StateBucket `
    -ExpectedKey 'platform.tfstate' -ExpectedRegion 'us-east-2' -ExpectedKmsKeyArn $StateKmsKeyArn
  $head = Read-LegacyReceiptAws @('s3api','head-object','--bucket',$StateBucket,'--key','platform.tfstate','--expected-bucket-owner',$ExpectedAccountId)
  if ($head.ServerSideEncryption -cne 'aws:kms' -or $head.SSEKMSKeyId -cne $StateKmsKeyArn -or -not $head.VersionId -or $head.VersionId -ceq 'null') { throw 'LegacyReceiptStateEncryptionInvalid' }
  $raw = @(& terraform "-chdir=$terraformDirectory" state pull 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'LegacyReceiptStateReadFailed' }
  $state = ConvertFrom-DeploymentTerraformJson ($raw -join "`n")
  Assert-DeploymentTerraformStateVersion $state.terraform_version
  return $state
}
function Get-LegacyReceiptResource($State, [string]$Type, [string]$Name) {
  $resources = @($State.resources | Where-Object { $_.mode -ceq 'managed' -and (Get-LegacyReceiptProperty $_ 'module') -ceq 'module.platform' -and $_.type -ceq $Type -and $_.name -ceq $Name })
  if ($resources.Count -ne 1 -or @($resources[0].instances).Count -ne 1) { throw 'LegacyReceiptManagedResourceMissingOrAmbiguous' }
  return $resources[0].instances[0].attributes
}
function Assert-LegacyReceiptManagedRole($State) {
  $role = Get-LegacyReceiptResource $State 'aws_iam_role' 'legacy_receipt_transition'
  $policy = Get-LegacyReceiptResource $State 'aws_iam_role_policy' 'legacy_receipt_transition'
  $live = (Read-LegacyReceiptAws @('iam','get-role','--role-name',$role.name)).Role
  Assert-LegacyReceiptEqual $live.Arn $role.arn 'RoleArn'
  Assert-LegacyReceiptEqual $live.PermissionsBoundary.PermissionsBoundaryArn $role.permissions_boundary 'RoleBoundary'
  Assert-LegacyReceiptEqual $live.AssumeRolePolicyDocument ($role.assume_role_policy | ConvertFrom-Json) 'RoleTrust'
  $attached = Read-LegacyReceiptAws @('iam','list-attached-role-policies','--role-name',$role.name)
  if (@($attached.AttachedPolicies).Count) { throw 'LegacyReceiptUnexpectedAttachedRolePolicy' }
  $inline = Read-LegacyReceiptAws @('iam','list-role-policies','--role-name',$role.name)
  Assert-LegacyReceiptEqual @($inline.PolicyNames) @($policy.name) 'RolePolicyInventory'
  $actual = Read-LegacyReceiptAws @('iam','get-role-policy','--role-name',$role.name,'--policy-name',$policy.name)
  Assert-LegacyReceiptEqual $actual.PolicyDocument ($policy.policy | ConvertFrom-Json) 'RolePolicy'
}
function Assert-LegacyReceiptLiveDrain {
  # The maintained lifecycle gate checks routes, rules, mappings, queues and original durable work.
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'operate-development-database-lifecycle.ps1') -Action Status `
    -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket -AwsProfile $AwsProfile *> (Join-Path $privateRoot 'drain.log')
  if ($LASTEXITCODE -ne 0) { throw 'LegacyReceiptRuntimeNotDrained' }
  # Include the newer native durable families rather than only the original two lifecycle names.
  $functions = Read-LegacyReceiptAws @('lambda','list-functions')
  foreach ($function in @($functions.Functions | Where-Object { $_.FunctionName.StartsWith('ai-job-apply-development-') -and (Get-LegacyReceiptProperty $_ 'DurableConfig') })) {
    $executions = Read-LegacyReceiptAws @('lambda','list-durable-executions-by-function','--function-name',$function.FunctionName,'--statuses','RUNNING')
    if (@($executions.DurableExecutions).Count) { throw 'LegacyReceiptNativeDurableWorkRemains' }
  }
}
function Get-LegacyReceiptPreflight {
  if ($PublicationReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      (Get-FileHash -LiteralPath $PublicationReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PublicationReceiptSha256) { throw 'LegacyReceiptPublicationHashInvalid' }
  $publication = ConvertFrom-DeploymentTerraformJson (Get-Content -LiteralPath $PublicationReceiptPath -Raw)
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'publish-development-migration-image.ps1') -Action Verify `
    -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket -AwsProfile $AwsProfile -SourceSha $publication.sourceSha `
    -ReceiptPath $PublicationReceiptPath -ReviewedReceiptSha256 $PublicationReceiptSha256 *> (Join-Path $privateRoot 'image-verification.log')
  if ($LASTEXITCODE -ne 0) { throw 'LegacyReceiptImmutableImageVerificationFailed' }
  $state = Read-LegacyReceiptState
  $expected = Get-LegacyReceiptResource $state 'aws_ecs_task_definition' 'legacy_receipt_transition'
  $task = (Read-LegacyReceiptAws @('ecs','describe-task-definition','--task-definition',$expected.arn)).taskDefinition
  $config = Assert-LegacyReceiptTask $task $expected $ExpectedAccountId $publication.imageUri ([DateTimeOffset]::UtcNow)
  if ($config.sourceSha -cne $publication.sourceSha) { throw 'LegacyReceiptSourceBindingInvalid' }
  & git -C $repository cat-file -e "$($config.sourceSha):backend/services/applications/src/run-legacy-receipt-transition.ts" 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'LegacyReceiptSourceExecutableMissing' }
  $key = Get-LegacyReceiptResource $state 'aws_kms_key' 'legacy_receipt_encryption'
  if ($key.arn -cne $config.encryptionKeyArn) { throw 'LegacyReceiptKeyStateMismatch' }
  $liveKey = (Read-LegacyReceiptAws @('kms','describe-key','--key-id',$key.arn)).KeyMetadata
  if ($liveKey.Arn -cne $key.arn -or $liveKey.KeyState -cne 'Enabled' -or $liveKey.KeyUsage -cne 'ENCRYPT_DECRYPT' -or $liveKey.KeySpec -cne 'SYMMETRIC_DEFAULT') { throw 'LegacyReceiptKeyUnavailable' }
  $keyPolicy = Read-LegacyReceiptAws @('kms','get-key-policy','--key-id',$key.arn,'--policy-name','default')
  Assert-LegacyReceiptEqual ($keyPolicy.Policy | ConvertFrom-Json) ($key.policy | ConvertFrom-Json) 'KeyPolicy'
  Assert-LegacyReceiptManagedRole $state
  Assert-LegacyReceiptLiveDrain
  $db = (Read-LegacyReceiptAws @('rds','describe-db-instances','--db-instance-identifier',$config.databaseIdentifier)).DBInstances
  $snapshot = (Read-LegacyReceiptAws @('rds','describe-db-snapshots','--db-snapshot-identifier',$config.snapshotArn)).DBSnapshots
  if (@($db).Count -ne 1 -or @($snapshot).Count -ne 1) { throw 'LegacyReceiptRecoveryInventoryAmbiguous' }
  Assert-LegacyReceiptRecoverySnapshot $config $db[0] $snapshot[0]
  $ownedDb = Get-LegacyReceiptResource $state 'aws_db_instance' 'postgres'
  Assert-LegacyReceiptEqual $ownedDb.resource_id $config.databaseResourceId 'DatabaseState'
  $cluster = (Get-LegacyReceiptResource $state 'aws_ecs_cluster' 'this').arn
  if ($cluster -cne "arn:aws:ecs:us-east-2:${ExpectedAccountId}:cluster/ai-job-apply-development") { throw 'LegacyReceiptClusterBoundaryInvalid' }
  $services = Read-LegacyReceiptAws @('ecs','list-services','--cluster',$cluster)
  if (@($services.serviceArns).Count) { throw 'LegacyReceiptClusterHasServices' }
  $group = Get-LegacyReceiptResource $state 'aws_security_group' 'application'
  $subnetResource = @($state.resources | Where-Object { (Get-LegacyReceiptProperty $_ 'module') -ceq 'module.platform' -and $_.type -ceq 'aws_subnet' -and $_.name -ceq 'public' })
  $subnets = @($subnetResource.instances.attributes.id | Sort-Object)
  if ($subnets.Count -ne 2 -or @($subnets | Select-Object -Unique).Count -ne 2) { throw 'LegacyReceiptNetworkInventoryInvalid' }
  $actualSubnets = Read-LegacyReceiptAws (@('ec2','describe-subnets','--subnet-ids') + $subnets)
  Assert-LegacyReceiptEqual @($actualSubnets.Subnets.SubnetId | Sort-Object) $subnets 'SubnetInventory'
  if (@($actualSubnets.Subnets | Where-Object VpcId -cne $group.vpc_id).Count) { throw 'LegacyReceiptSubnetVpcInvalid' }
  $actualGroup = Read-LegacyReceiptAws @('ec2','describe-security-groups','--group-ids',$group.id)
  if (@($actualGroup.SecurityGroups).Count -ne 1 -or $actualGroup.SecurityGroups[0].VpcId -cne $group.vpc_id) { throw 'LegacyReceiptSecurityGroupInvalid' }
  $manifestRaw = @(& git -C $repository show "$($config.sourceSha):backend/services/database-migrations/restore-manifest.v1.json" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'LegacyReceiptSourceManifestUnavailable' }
  $manifest = ($manifestRaw -join "`n") | ConvertFrom-Json
  $owners = @($manifest.contributors | Where-Object owner -ceq 'applications')
  if ($owners.Count -ne 1 -or @($owners[0].migrations).Count -ne 15) { throw 'LegacyReceiptSourceMigrationInventoryUnsupported' }
  $latestState = Read-LegacyReceiptState
  if ($latestState.lineage -cne $state.lineage -or $latestState.serial -ne $state.serial) { throw 'LegacyReceiptStateChangedDuringPreflight' }
  Assert-LegacyReceiptConfiguration $config $ExpectedAccountId ([DateTimeOffset]::UtcNow)
  return [pscustomobject]@{
    schemaVersion = 1; accountId = $ExpectedAccountId; region = 'us-east-2'; runId = $config.runId;
    stateLineage = $state.lineage; stateSerial = $state.serial; taskDefinitionArn = $task.taskDefinitionArn;
    taskDefinitionSha256 = Get-LegacyReceiptSha256 (ConvertTo-DeploymentCanonicalValue $task);
    clusterArn = $cluster; configuration = $config; currentMigrationCount = 15;
    configurationSha256 = ($task.containerDefinitions[0].environment | Where-Object name -ceq 'LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256').value;
    publicationReceiptSha256 = $PublicationReceiptSha256;
    logGroup = $task.containerDefinitions[0].logConfiguration.options.'awslogs-group';
    request = [pscustomobject]@{
      cluster = $cluster; taskDefinition = $task.taskDefinitionArn; count = 1; launchType = 'FARGATE';
      platformVersion = '1.4.0'; enableExecuteCommand = $false; clientToken = $config.runId; startedBy = $config.runId;
      networkConfiguration = @{ awsvpcConfiguration = @{ subnets = $subnets; securityGroups = @($group.id); assignPublicIp = 'ENABLED' } }
    }
  }
}

function Invoke-LegacyReceiptTransitionAction {
  if ($Action -ceq 'PlanExecution') {
    $descriptor = Get-LegacyReceiptPreflight
    Write-LegacyReceiptArtifact $PlanPath $descriptor
    [pscustomobject]@{ outcome = 'planned'; planSha256 = (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant(); expiresAt = $descriptor.configuration.expiresAt }
    return
  }
  if ($ReviewedPlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ReviewedPlanSha256) { throw 'LegacyReceiptPlanHashInvalid' }
  $descriptor = ConvertFrom-DeploymentTerraformJson (Get-Content -LiteralPath $PlanPath -Raw)
  if ($descriptor.schemaVersion -ne 1 -or $descriptor.accountId -cne $ExpectedAccountId -or $descriptor.region -cne 'us-east-2' -or
      $descriptor.runId -cnotmatch '^[a-f0-9]{32}$' -or $descriptor.runId -cne $descriptor.configuration.runId -or
      $descriptor.clusterArn -cne "arn:aws:ecs:us-east-2:${ExpectedAccountId}:cluster/ai-job-apply-development" -or
      $descriptor.taskDefinitionArn -cnotmatch "^arn:aws:ecs:us-east-2:${ExpectedAccountId}:task-definition/ai-job-apply-development-legacy-receipt-transition:[1-9][0-9]*$" -or
      $descriptor.logGroup -cne '/ai-job-apply/development/application' -or $descriptor.currentMigrationCount -ne 15 -or
      $descriptor.configurationSha256 -cne (Get-LegacyReceiptSha256 (ConvertTo-DeploymentCanonicalValue $descriptor.configuration))) { throw 'LegacyReceiptPlanBoundaryInvalid' }
  # Recovery validates the original configuration at issuance, not at today's clock: expiry must
  # prevent new execution without preventing observation of an already submitted original task.
  Assert-LegacyReceiptConfiguration $descriptor.configuration $ExpectedAccountId (Get-LegacyReceiptInstant $descriptor.configuration.issuedAt)
  $receiptPath = Resolve-LegacyReceiptArtifact (Join-Path $privateRoot "receipt-$($descriptor.runId).json")
  $lockPath = "$receiptPath.lock"
  $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    if ($Action -ceq 'Execute') {
      if (Test-Path -LiteralPath $receiptPath) { throw 'LegacyReceiptAlreadyClaimedUseRecover' }
      $current = Get-LegacyReceiptPreflight
      Assert-LegacyReceiptEqual $current $descriptor 'FreshPreflight'
      $receipt = [pscustomobject]@{ schemaVersion = 1; planSha256 = $ReviewedPlanSha256; state = 'claimed'; taskArn = $null; claimedAt = [DateTimeOffset]::UtcNow.ToString('o') }
      Write-LegacyReceiptArtifact $receiptPath $receipt
      $requestPath = Resolve-LegacyReceiptArtifact (Join-Path $privateRoot "request-$($descriptor.runId).json")
      Write-LegacyReceiptArtifact $requestPath $descriptor.request
      Assert-LegacyReceiptConfiguration $descriptor.configuration $ExpectedAccountId ([DateTimeOffset]::UtcNow)
      # The sole cloud mutation. A failed/ambiguous response leaves the permanent claim for Recover.
      $response = Read-LegacyReceiptAws @('ecs','run-task','--cli-input-json',"file://$requestPath")
      Write-LegacyReceiptArtifact (Join-Path $privateRoot "response-$($descriptor.runId).json") $response
      if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne 1) { throw 'LegacyReceiptSubmissionUnresolvedUseRecover' }
      $receipt.taskArn = $response.tasks[0].taskArn
      $receipt.state = 'submitted'
      Write-LegacyReceiptArtifact $receiptPath $receipt -Replace
      [pscustomobject]@{ outcome = 'submitted'; taskArn = $receipt.taskArn; receiptPath = $receiptPath }
      return
    }
    $receipt = ConvertFrom-DeploymentTerraformJson (Get-Content -LiteralPath $receiptPath -Raw)
    if ($receipt.planSha256 -cne $ReviewedPlanSha256) { throw 'LegacyReceiptOriginalClaimMismatch' }
    if (-not $receipt.taskArn) {
      $matches = @()
      foreach ($status in @('RUNNING','STOPPED')) {
        $listed = Read-LegacyReceiptAws @('ecs','list-tasks','--cluster',$descriptor.clusterArn,'--desired-status',$status)
        foreach ($arn in @($listed.taskArns)) {
          $candidate = Read-LegacyReceiptAws @('ecs','describe-tasks','--cluster',$descriptor.clusterArn,'--tasks',$arn)
          $matches += @($candidate.tasks | Where-Object startedBy -ceq $descriptor.runId)
        }
      }
      if ($matches.Count -ne 1) { throw 'LegacyReceiptOriginalTaskUnresolvedNeverResubmit' }
      $receipt.taskArn = $matches[0].taskArn
      $receipt.state = 'submitted'
      Write-LegacyReceiptArtifact $receiptPath $receipt -Replace
    }
    $observed = Read-LegacyReceiptAws @('ecs','describe-tasks','--cluster',$descriptor.clusterArn,'--tasks',$receipt.taskArn)
    if (@($observed.failures).Count -or @($observed.tasks).Count -ne 1) { throw 'LegacyReceiptOriginalTaskUnavailable' }
    $task = $observed.tasks[0]
    if ($task.lastStatus -cne 'STOPPED') {
      [pscustomobject]@{ outcome = 'pending'; taskArn = $receipt.taskArn; status = $task.lastStatus }
      return
    }
    $taskId = ($receipt.taskArn -split '/')[-1]
    $logs = Read-LegacyReceiptAws @('logs','get-log-events','--log-group-name',$descriptor.logGroup,'--log-stream-name',"legacy-receipt-transition/legacy-receipt-transition/$taskId",'--start-from-head')
    Write-LegacyReceiptArtifact (Join-Path $privateRoot "observed-$($descriptor.runId).json") @{ task = $task; logs = $logs } -Replace
    $descriptor | Add-Member -NotePropertyName taskArn -NotePropertyValue $receipt.taskArn
    Assert-LegacyReceiptTaskResult $task $descriptor @($logs.events.message)
    $receipt.state = 'verified'
    Write-LegacyReceiptArtifact $receiptPath $receipt -Replace
    [pscustomobject]@{ outcome = 'verified'; archivedReceipts = $descriptor.configuration.expectedLegacyReceipts; shutdownRequired = $true }
  } finally { $lock.Dispose() }
}

$identity = Read-LegacyReceiptAws @('sts','get-caller-identity')
if ($identity.Account -cne $ExpectedAccountId -or $identity.Arn -cnotmatch ":assumed-role/AWSReservedSSO_[^/]+/") { throw 'LegacyReceiptSsoIdentityRequired' }
$PlanPath = Resolve-LegacyReceiptArtifact $PlanPath
$null = New-Item -ItemType Directory -Path $privateRoot -Force
Invoke-LegacyReceiptTransitionAction
