#Requires -Version 7.4
[CmdletBinding()]
param(
  [ValidateSet('Prepare','Create','Inspect','Replay','DiagnoseCompletion','Cleanup')][string]$Action = 'Prepare',
  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId = '',
  [string]$StateBucket = '',
  [string]$RuntimePlanPath = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedRuntimePlanSha256 = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedRestoreContextSha256 = '',
  [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceSha = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedArtifactManifestSha256 = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$AcceptedPolicyCatalogSha256 = '',
  [string]$PreparationPath = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedPreparationSha256 = '',
  [string]$InspectionPath = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedInspectionReceiptSha256 = '',
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedCleanupDisabledSha256 = '',
  [switch]$Execute,
  [switch]$DarkRecovery,
  [switch]$PrimaryRecovery,
  [string]$PrimarySafetySnapshotId = '',
  [switch]$Help
)
if ($PrimaryRecovery -and $DarkRecovery) { throw 'DeletionReplayConflictingRecoveryModes' }
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($Help) {
  @'
Development restore-only deletion replay: Prepare / Create / Inspect / Replay / DiagnoseCompletion / Cleanup.
Prepare is read-only in AWS and writes a private review packet. It requires a clean source-bound
Lambda artifact, the reviewed current no-drift runtime plan, and verified current-schema PITR
context. It cannot create or enable the separately reviewed default-off IAM role.
Use -PrimaryRecovery on every action to reconcile the exact writer-off restored development primary.
Prepare additionally requires -PrimarySafetySnapshotId for its available encrypted physical-source backup.
Primary mode checks current schema during invocation and needs no PITR context or proof rehearsal.
Use -DarkRecovery on every action for a writer-off PITR context. It uses the maintained
development recovery Status checks and binds that mode and its operator files in the packet.
Create requires -Execute and the packet checksum. Inspect invokes only the numeric version and
performs no database writes. Replay additionally requires -Execute and an exact reviewed inspection
receipt. Cleanup requires -Execute and removes only the exact temporary Lambda, after a full
in-flight timeout window; run the maintained PostgreSQL restore Cleanup separately afterward.
DiagnoseCompletion is a separate read-only diagnosis before normal preflight. Its protected receipt
contains only fixed comparisons, timestamps and opaque fingerprints, not an inspection approval or
permission to change a marker. An ambiguous diagnosis is never retried automatically; review its
started journal before a new explicit read. Cleanup includes every diagnosis invocation window.
Optional historical dispatch counts, timestamps and opaque bindings stay in that protected receipt.
They are not writer-exclusion proof: fresh execution retirement and verified PITR-cutoff joins are local.
All non-Prepare actions require -PreparationPath and -ReviewedPreparationSha256. A started replay
is never retried automatically. After an ambiguous result, inspect again and review recovery.
Only aggregates, checksums, and private receipt paths are printed. No credentials are read by this
operator. Candidate locators and raw records never enter requests or operator receipts.
'@
  exit 0
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$terraformRoot = Join-Path $root 'infrastructure/terraform/environments/development'
$terraformPrivate = Join-Path $terraformRoot '.terraform'
$privateRoot = Join-Path $terraformPrivate 'development-candidate-deletion-replay'
$restoreContextPath = Join-Path $terraformPrivate 'applydash-development-restore-context.json'
if ($DarkRecovery) { $restoreContextPath = Join-Path $terraformPrivate 'applydash-development-dark-restore-context.json' }
if ($PrimaryRecovery) { $restoreContextPath = Join-Path $privateRoot 'primary-context.json' }
$artifactRoot = Join-Path $root 'backend/workflows/dist/lambda'
$zipPath = Join-Path $artifactRoot 'candidate-deletion-restore-lambda.zip'
$manifestPath = Join-Path $artifactRoot 'candidate-deletion-restore-lambda.manifest.json'
$sbomPath = Join-Path $artifactRoot 'candidate-deletion-restore-lambda.cdx.json'
$guardPath = Join-Path $PSScriptRoot 'lib/candidate-deletion-replay.ps1'
. $guardPath
. (Join-Path $PSScriptRoot 'lib/development-postgresql-dark-recovery.ps1')
. (Join-Path $PSScriptRoot 'lib/terraform-toolchain.ps1')

function Invoke-ReplayAws([string[]]$Arguments, [switch]$AllowNotFound) {
  # A named SSO profile and fixed region are always explicit. Never dump AWS diagnostics.
  $raw = @(& aws.exe @Arguments --profile $AwsProfile --region us-east-2 --no-cli-pager --output json 2>&1)
  $code = $LASTEXITCODE
  $text = ($raw | ForEach-Object { [string]$_ }) -join "`n"
  if ($code -ne 0) {
    if ($AllowNotFound -and $text -match '\((ResourceNotFoundException|NoSuchEntity|NoSuchKey|404|NotFound)\)') { return $null }
    throw 'DeletionReplayAwsOperationFailed'
  }
  if ($text.Trim()) { return ConvertFrom-D1RestoreJson $text }
  return $null
}

function Invoke-ReplayGit([string[]]$Arguments) {
  $value = @(& git -C $root @Arguments 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'DeletionReplaySourceUnreadable' }
  return ($value -join "`n").Trim()
}

function Get-ReplayPlanResource([object]$Plan, [string]$Address) {
  function Visit([object]$Module) {
    if ($Module.PSObject.Properties.Name -contains 'resources') { foreach ($resource in @($Module.resources)) { if ($resource.address -ceq $Address) { $resource.values } } }
    if ($Module.PSObject.Properties.Name -contains 'child_modules') { foreach ($child in @($Module.child_modules)) { Visit $child } }
  }
  $found = @(Visit $Plan.planned_values.root_module)
  if ($found.Count -ne 1) { throw 'DeletionReplayRequiredPlanResourceMissing' }
  return $found[0]
}

function Read-ReplayPlan([string]$Path, [string]$Sha256) {
  $resolved = Resolve-DeletionReplayPrivatePath ([IO.Path]::GetFullPath($Path)) $terraformPrivate -MustExist
  Assert-DeletionReplayHash $resolved $Sha256
  $plan = Read-DeploymentTerraformPlan -Path $resolved -TerraformDirectory $terraformRoot
  if ($plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $plan.variables.candidate_deletion_restore_role_enabled.value -ne $true -or @($plan.resource_changes | Where-Object { (@($_.change.actions) -join ',') -cne 'no-op' }).Count -ne 0) { throw 'DeletionReplayPlanNotCurrentZeroDrift' }
  return $plan
}

function Assert-ReplayRecoveryMode([object]$Preparation, [object]$Context) {
  $mode = Get-DeletionReplayBaselineMode $Preparation
  if (($mode -ceq 'dark-recovery') -ne [bool]$DarkRecovery -or ($mode -ceq 'primary-recovery') -ne [bool]$PrimaryRecovery) { throw 'DeletionReplayBaselineModeChanged' }
  if ($null -ne $Context -and -not $PrimaryRecovery) { Assert-D1RestoreRecoveryMode $Context 'development' ([bool]$DarkRecovery) }
}

function Get-ReplayBoundFiles([string]$PlanPath) {
  $files = @($PSCommandPath,$guardPath,(Join-Path $PSScriptRoot 'lib/staging-postgresql-restore-verifier.ps1'),$restoreContextPath,[IO.Path]::GetFullPath($PlanPath),$manifestPath,$zipPath,$sbomPath)
  if ($DarkRecovery -or $PrimaryRecovery) {
    $files += @('operate-development-postgresql-restore.ps1','operate-staging-postgresql-restore.ps1','lib/development-postgresql-dark-recovery.ps1') | ForEach-Object { Join-Path $PSScriptRoot $_ }
  }
  return $files
}

function Assert-ReplayPrimaryBaseline([object]$Preparation) {
  # Primary recovery needs target/backup safety and fresh writer exclusion, not
  # the isolated recovery path's whole-Terraform observed-drift proof sweep.
  $Region = 'us-east-2'
  $ExpectedAccountId = $Preparation.accountId; $StateBucket = $Preparation.stateBucket
  $env:AWS_PROFILE = $AwsProfile; $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region
  function Invoke-AwsJson([string[]]$Arguments) { Invoke-ReplayAws $Arguments }
  Assert-D1RestoreAwsCallerBoundary (Invoke-ReplayAws @('sts','get-caller-identity')) $ExpectedAccountId
  $plan = Read-ReplayPlan $Preparation.runtimePlanPath $Preparation.runtimePlanSha256
  $values = [pscustomobject]@{}
  foreach ($property in $plan.variables.PSObject.Properties) {
    Assert-D1RestoreExactObjectKeys $property.Value @('value') 'Primary recovery input binding'
    $values | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value.value
  }
  Assert-D1RestoreDarkWriterInputs $values
  $encryption = Invoke-ReplayAws @('s3api','get-bucket-encryption','--bucket',$StateBucket,'--expected-bucket-owner',$ExpectedAccountId)
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules)
  if ($rules.Count -ne 1 -or $rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'aws:kms' -or
      $rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -cnotmatch "^arn:aws:kms:us-east-2:$ExpectedAccountId`:key/[a-f0-9-]{36}$") {
    throw 'DeletionReplayPrimaryBackendRejected'
  }
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformRoot -DataDirectory $terraformPrivate `
    -ExpectedBucket $StateBucket -ExpectedKey 'platform.tfstate' -ExpectedRegion $Region `
    -ExpectedKmsKeyArn $rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  Assert-D1RestoreDarkWritersStopped
}

function Assert-ReplayPrimaryDatabase([object]$Database, [object]$Snapshot, [string]$SnapshotId) {
  if ($Database.DBInstanceIdentifier -cne 'ai-job-apply-development' -or
      $Database.DBInstanceArn -cne "arn:aws:rds:us-east-2:$ExpectedAccountId`:db:ai-job-apply-development" -or
      $Database.DbiResourceId -cnotmatch '^db-[A-Z0-9]{8,63}$' -or
      $Database.DBInstanceStatus -cne 'available' -or $Database.PubliclyAccessible -isnot [bool] -or $Database.PubliclyAccessible -or
      $Database.StorageEncrypted -isnot [bool] -or -not $Database.StorageEncrypted -or
      $Database.DeletionProtection -isnot [bool] -or -not $Database.DeletionProtection -or
      -not (Test-D1RestoreBoundedInteger $Database.BackupRetentionPeriod) -or $Database.BackupRetentionPeriod -ne 35 -or $Database.MultiAZ -isnot [bool] -or $Database.MultiAZ -or
      $Database.DBName -cnotin @('ai_job_apply','',$null) -or -not (Test-D1RestoreBoundedInteger $Database.Endpoint.Port) -or $Database.Endpoint.Port -ne 5432 -or
      $Database.Endpoint.Address -cnotmatch '^ai-job-apply-development\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$' -or
      $Database.KmsKeyId -cnotmatch "^arn:aws:kms:us-east-2:$ExpectedAccountId`:key/[a-f0-9-]{36}$" -or
      $SnapshotId -cnotmatch '^ai-job-apply-development-[a-z0-9-]+$' -or
      $Snapshot.DBSnapshotIdentifier -cne $SnapshotId -or $Snapshot.Status -cne 'available' -or
      $Snapshot.Encrypted -isnot [bool] -or -not $Snapshot.Encrypted -or
      $Snapshot.DBInstanceIdentifier -cne $Database.DBInstanceIdentifier -or
      $Snapshot.DbiResourceId -cne $Database.DbiResourceId -or $Snapshot.KmsKeyId -cne $Database.KmsKeyId) {
    throw 'DeletionReplayPrimaryDatabaseOrBackupInvalid'
  }
}

function New-ReplayPrimaryContext {
  $source = @((Invoke-ReplayAws @('rds','describe-db-instances','--db-instance-identifier','ai-job-apply-development')).DBInstances)
  $snapshots = @((Invoke-ReplayAws @('rds','describe-db-snapshots','--db-snapshot-identifier',$PrimarySafetySnapshotId)).DBSnapshots)
  if ($source.Count -ne 1 -or $snapshots.Count -ne 1) { throw 'DeletionReplayPrimaryIdentityAmbiguous' }
  Assert-ReplayPrimaryDatabase $source[0] $snapshots[0] $PrimarySafetySnapshotId
  $boundary = Get-DeletionReplaySha (Get-DeletionReplayRdsBoundaryJson $source[0])
  return [pscustomobject][ordered]@{
    baseline_mode='primary-recovery'; source_identifier='ai-job-apply-development'; target_identifier='ai-job-apply-development'
    source_dbi_resource_id=$source[0].DbiResourceId; target_dbi_resource_id=$source[0].DbiResourceId
    source_boundary_sha256=$boundary; target_boundary_sha256=$boundary
    source_manifest_sha256='4eb3abc8d2b17290a4bf72f69fac27710bb7675fb5435fc63c393680659dd452'
    safety_snapshot_identifier=$PrimarySafetySnapshotId
  }
}

function Read-ReplayContext {
  if (-not $PrimaryRecovery) { return Read-D1RestoreContextFile $restoreContextPath (Get-D1RestoreManifestBoundary $root) }
  $context = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($restoreContextPath))
  Assert-D1RestoreExactObjectKeys $context @('baseline_mode','source_identifier','target_identifier','source_dbi_resource_id','target_dbi_resource_id','source_boundary_sha256','target_boundary_sha256','source_manifest_sha256','safety_snapshot_identifier') 'DeletionReplayPrimaryContext'
  if ($context.baseline_mode -cne 'primary-recovery' -or $context.source_identifier -cne 'ai-job-apply-development' -or $context.target_identifier -cne $context.source_identifier -or $context.source_dbi_resource_id -cne $context.target_dbi_resource_id -or $context.source_boundary_sha256 -cne $context.target_boundary_sha256) { throw 'DeletionReplayPrimaryContextInvalid' }
  return $context
}

function Assert-ReplayNoDrift([object]$Preparation) {
  Assert-ReplayRecoveryMode $Preparation $null
  if ($PrimaryRecovery) { Assert-ReplayPrimaryBaseline $Preparation; return }
  if ($DarkRecovery) {
    $raw = @(& (Join-Path $PSScriptRoot 'operate-development-postgresql-restore.ps1') -Action Status -DarkRecovery -ExpectedAccountId $Preparation.accountId -StateBucket $Preparation.stateBucket -RuntimePlanPath $Preparation.runtimePlanPath -AwsProfile $AwsProfile -Region us-east-2 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'DeletionReplayRuntimeDriftCheckFailed' }
    $result = ConvertFrom-D1RestoreJson ($raw -join "`n")
    if ($result.Environment -cne 'development' -or $result.BaselineMode -cne 'dark-recovery' -or $result.RestoreState -cne 'verified' -or
        -not (Test-D1RestoreBoundedInteger $result.BackupRetentionDays) -or $result.BackupRetentionDays -ne 35 -or
        -not (Test-D1RestoreBoundedInteger $result.DisposableRestoreTargets) -or $result.DisposableRestoreTargets -ne 1 -or
        $result.SourceMultiAz -isnot [bool] -or $result.SourceMultiAz) { throw 'DeletionReplayRecoveryBaselineInvalid' }
    foreach ($name in @('SourceAvailable','SourcePrivate','SourceEncrypted','SourceDeletionProtected','LatestRestorablePoint','EcsRuntimeIdle','RestoreContext')) {
      if ($result.$name -isnot [bool] -or -not $result.$name) { throw 'DeletionReplayRecoveryBaselineInvalid' }
    }
    return
  }
  $raw = @(& (Join-Path $PSScriptRoot 'inspect-staging-workload-and-cost.ps1') -Environment development -Action Status -ExpectedAccountId $Preparation.accountId -StateBucket $Preparation.stateBucket -RuntimePlanPath $Preparation.runtimePlanPath -AwsProfile $AwsProfile -Region us-east-2 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'DeletionReplayRuntimeDriftCheckFailed' }
  $result = ConvertFrom-D1RestoreJson ($raw -join "`n")
  if ($result.NoDrift -ne $true) { throw 'DeletionReplayRuntimeDriftDetected' }
}

function Read-ReplayPolicy([object]$Value) {
  if ($Value -is [string]) { return ConvertFrom-D1RestoreJson ([Uri]::UnescapeDataString($Value)) }
  return $Value
}

function Get-ReplayRoleBoundary([object]$Plan, [string]$AccountId) {
  $name = 'ai-job-apply-development-deletion-restore'
  $expected = Get-ReplayPlanResource $Plan 'module.platform.aws_iam_role.candidate_deletion_restore[0]'
  $expectedPolicy = Get-ReplayPlanResource $Plan 'module.platform.aws_iam_role_policy.candidate_deletion_restore[0]'
  $role = (Invoke-ReplayAws @('iam','get-role','--role-name',$name)).Role
  if ($expected.name -cne $name -or $expected.arn -cne "arn:aws:iam::$AccountId`:role/$name" -or $role.Arn -cne $expected.arn -or $role.PermissionsBoundary.PermissionsBoundaryArn -cne $expected.permissions_boundary -or (ConvertTo-DeletionReplayCanonicalJson (Read-ReplayPolicy $role.AssumeRolePolicyDocument)) -cne (ConvertTo-DeletionReplayCanonicalJson (Read-ReplayPolicy $expected.assume_role_policy))) { throw 'DeletionReplayRoleIdentityChanged' }
  $inline = @((Invoke-ReplayAws @('iam','list-role-policies','--role-name',$name)).PolicyNames)
  $attached = @((Invoke-ReplayAws @('iam','list-attached-role-policies','--role-name',$name)).AttachedPolicies)
  if ($inline.Count -ne 1 -or $inline[0] -cne $expectedPolicy.name -or $attached.Count -ne 0) { throw 'DeletionReplayRolePoliciesUnexpected' }
  $policy = Read-ReplayPolicy (Invoke-ReplayAws @('iam','get-role-policy','--role-name',$name,'--policy-name',$expectedPolicy.name)).PolicyDocument
  if ((ConvertTo-DeletionReplayCanonicalJson $policy) -cne (ConvertTo-DeletionReplayCanonicalJson (Read-ReplayPolicy $expectedPolicy.policy))) { throw 'DeletionReplayRolePolicyChanged' }
  $boundary = (Invoke-ReplayAws @('iam','get-policy','--policy-arn',$expected.permissions_boundary)).Policy
  $boundaryPolicy = Read-ReplayPolicy (Invoke-ReplayAws @('iam','get-policy-version','--policy-arn',$expected.permissions_boundary,'--version-id',$boundary.DefaultVersionId)).PolicyVersion.Document
  $statement = @($boundaryPolicy.Statement | Where-Object { $_.Sid -ceq 'RestoreOnlyReadRetainedVersions' })
  if ($statement.Count -ne 1 -or $statement[0].Effect -cne 'Allow' -or $statement[0].Condition.ArnEquals.'aws:PrincipalArn' -cne $role.Arn -or
      @(Compare-Object @($statement[0].Action) @('s3:ListBucketVersions','s3:GetObjectVersion','s3:GetObjectRetention') -CaseSensitive).Count -ne 0) { throw 'DeletionReplayBoundaryCapabilityMissing' }
  $endpointDigests = [ordered]@{}
  foreach ($address in @('module.platform.aws_vpc_endpoint.candidate_documents_s3[0]','module.platform.aws_vpc_endpoint.secretsmanager[0]')) {
    $expectedEndpoint = Get-ReplayPlanResource $Plan $address
    $actual = @((Invoke-ReplayAws @('ec2','describe-vpc-endpoints','--vpc-endpoint-ids',$expectedEndpoint.id)).VpcEndpoints)
    if ($actual.Count -ne 1 -or $actual[0].State -cne 'available' -or (ConvertTo-DeletionReplayCanonicalJson (Read-ReplayPolicy $actual[0].PolicyDocument)) -cne (ConvertTo-DeletionReplayCanonicalJson (Read-ReplayPolicy $expectedEndpoint.policy))) { throw 'DeletionReplayEndpointCapabilityChanged' }
    $endpointDigests[$address] = Get-DeletionReplaySha (ConvertTo-DeletionReplayCanonicalJson @{id=$actual[0].VpcEndpointId;vpcId=$actual[0].VpcId;serviceName=$actual[0].ServiceName;policy=(Read-ReplayPolicy $actual[0].PolicyDocument)})
  }
  return [ordered]@{roleId=$role.RoleId;roleArn=$role.Arn;policySha256=(Get-DeletionReplaySha (ConvertTo-DeletionReplayCanonicalJson $policy));boundaryVersion=$boundary.DefaultVersionId;boundarySha256=(Get-DeletionReplaySha (ConvertTo-DeletionReplayCanonicalJson $boundaryPolicy));endpoints=$endpointDigests}
}

function Get-ReplayDatabases([object]$Context) {
  if ($PrimaryRecovery) {
    $source = @((Invoke-ReplayAws @('rds','describe-db-instances','--db-instance-identifier','ai-job-apply-development')).DBInstances)
    $snapshot = @((Invoke-ReplayAws @('rds','describe-db-snapshots','--db-snapshot-identifier',$Context.safety_snapshot_identifier)).DBSnapshots)
    if ($source.Count -ne 1 -or $snapshot.Count -ne 1) { throw 'DeletionReplayPrimaryIdentityAmbiguous' }
    Assert-ReplayPrimaryDatabase $source[0] $snapshot[0] $Context.safety_snapshot_identifier
    if ($source[0].DbiResourceId -cne $Context.source_dbi_resource_id -or (Get-DeletionReplaySha (Get-DeletionReplayRdsBoundaryJson $source[0])) -cne $Context.source_boundary_sha256) { throw 'DeletionReplayPrimaryIdentityChanged' }
    return @{source=$source[0];target=$source[0]}
  }
  $source = @((Invoke-ReplayAws @('rds','describe-db-instances','--db-instance-identifier',$Context.source_identifier)).DBInstances)
  $target = @((Invoke-ReplayAws @('rds','describe-db-instances','--db-instance-identifier',$Context.target_identifier)).DBInstances)
  if ($source.Count -ne 1 -or $target.Count -ne 1) { throw 'DeletionReplayRdsIdentityAmbiguous' }
  $tags = @{}
  foreach ($tag in @((Invoke-ReplayAws @('rds','list-tags-for-resource','--resource-name',$target[0].DBInstanceArn)).TagList)) {
    if ($tags.ContainsKey($tag.Key)) { throw 'DeletionReplayRdsTagAmbiguous' }; $tags[$tag.Key] = $tag.Value
  }
  Assert-DeletionReplayRds $source[0] $target[0] $Context $tags $ExpectedAccountId
  return @{source=$source[0];target=$target[0]}
}

function Assert-ReplayReviewedFiles([object]$Preparation) {
  foreach ($binding in @($Preparation.fileBindings)) { Assert-DeletionReplayHash $binding.path $binding.sha256 }
  Assert-DeletionReplayHash $PreparationPath $ReviewedPreparationSha256
}

function Assert-ReplayCurrentBoundary([object]$Preparation, [switch]$Cleanup) {
  Assert-DeletionReplayPreparation $Preparation
  Assert-ReplayRecoveryMode $Preparation $null
  $expectedPaths = @(Get-ReplayBoundFiles $Preparation.runtimePlanPath)
  if ((@($Preparation.fileBindings.path | Sort-Object) -join "`n") -cne (@($expectedPaths | Sort-Object) -join "`n")) { throw 'DeletionReplayRequiredFileBindingsMissing' }
  Assert-ReplayReviewedFiles $Preparation
  $caller = Invoke-ReplayAws @('sts','get-caller-identity')
  Assert-D1RestoreAwsCallerBoundary $caller $Preparation.accountId
  if (-not $Cleanup -and ((Invoke-ReplayGit @('rev-parse','HEAD')) -cne $Preparation.sourceSha -or (Invoke-ReplayGit @('status','--porcelain')) -cne '')) { throw 'DeletionReplaySourceChanged' }
  $context = Read-ReplayContext
  Assert-ReplayRecoveryMode $Preparation $context
  $null = Get-ReplayDatabases $context
  $plan = Read-ReplayPlan $Preparation.runtimePlanPath $Preparation.runtimePlanSha256
  if ((ConvertTo-DeletionReplayCanonicalJson (Get-ReplayRoleBoundary $plan $Preparation.accountId)) -cne (ConvertTo-DeletionReplayCanonicalJson $Preparation.roleBoundary)) { throw 'DeletionReplayRoleBoundaryChanged' }
  $activity = Get-ReplayPlanResource $plan 'module.platform.aws_lambda_function.profile_readiness_activity[0]'
  $expectedNetwork = @{SubnetIds=@($activity.vpc_config[0].subnet_ids);SecurityGroupIds=@($activity.vpc_config[0].security_group_ids)}
  if ((ConvertTo-DeletionReplayCanonicalJson $Preparation.createRequest.VpcConfig) -cne (ConvertTo-DeletionReplayCanonicalJson $expectedNetwork) -or (@($Preparation.createRequest.Layers) -join ',') -cne (@($activity.layers) -join ',') -or $Preparation.artifactBucket -cne (Get-ReplayPlanResource $plan 'module.platform.aws_s3_bucket.artifacts').bucket) { throw 'DeletionReplayRuntimePlanBindingChanged' }
  foreach ($key in @('DATABASE_SECRET_ID','CANDIDATE_DOCUMENT_BUCKET','CANDIDATE_DELETION_RECOVERY_BUCKET')) { if ($Preparation.createRequest.Environment.Variables.$key -cne $activity.environment[0].variables.$key) { throw 'DeletionReplayRuntimeResourceBindingChanged' } }
  if ($Preparation.createRequest.Environment.Variables.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN -cne $activity.environment[0].variables.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN) { throw 'DeletionReplayRuntimeKeyBindingChanged' }
  Assert-ReplayNoDrift $Preparation
  $null = Assert-DeletionReplayEnvironment $Preparation.createRequest.Environment.Variables -AllowExpired:$Cleanup
  Assert-ReplayReviewedFiles $Preparation
}

function Assert-ReplayNoEntrypoints([string]$Name, [string]$Version) {
  if (@((Invoke-ReplayAws @('lambda','list-aliases','--function-name',$Name)).Aliases).Count -ne 0 -or @((Invoke-ReplayAws @('lambda','list-event-source-mappings','--function-name',$Name)).EventSourceMappings).Count -ne 0 -or @((Invoke-ReplayAws @('lambda','list-event-source-mappings','--function-name',"${Name}:$Version")).EventSourceMappings).Count -ne 0 -or $null -ne (Invoke-ReplayAws @('lambda','get-function-url-config','--function-name',$Name) -AllowNotFound) -or $null -ne (Invoke-ReplayAws @('lambda','get-policy','--function-name',$Name) -AllowNotFound) -or $null -ne (Invoke-ReplayAws @('lambda','get-policy','--function-name',$Name,'--qualifier',$Version) -AllowNotFound)) { throw 'DeletionReplayUnexpectedEntrypoint' }
  $versions = @((Invoke-ReplayAws @('lambda','list-versions-by-function','--function-name',$Name)).Versions.Version)
  if (($versions | Sort-Object) -join ',' -cne ((@('$LATEST',$Version) | Sort-Object) -join ',')) { throw 'DeletionReplayUnexpectedFunctionVersions' }
}

function Get-ReplayFunction([object]$Preparation, [string]$Version, [switch]$Cleanup) {
  $name = $Preparation.createRequest.FunctionName
  if ($Preparation.accountId -isnot [string] -or $Preparation.accountId -cnotmatch '^[0-9]{12}$' -or $name -isnot [string] -or $name -cnotmatch '^ai-job-apply-development-replay-[a-f0-9]{32}$' -or $Version -cnotmatch '^[1-9][0-9]{0,9}$') { throw 'DeletionReplayFunctionIdentityChanged' }
  $function = Invoke-ReplayAws @('lambda','get-function','--function-name',$name,'--qualifier',$Version)
  $functionArn = "arn:aws:lambda:us-east-2:$($Preparation.accountId):function:$name"
  $identity = $function.Configuration
  if ($identity -isnot [pscustomobject] -or $identity.FunctionName -isnot [string] -or $identity.FunctionName -cne $name -or $identity.FunctionArn -isnot [string] -or $identity.FunctionArn -cne "$functionArn`:$Version" -or $identity.Version -isnot [string] -or $identity.Version -cne $Version) { throw 'DeletionReplayFunctionIdentityChanged' }
  # Qualified GetFunction can omit function-level tags. Read the bound unqualified resource;
  # an optional embedded map must agree with the independent readback, never stand in for it.
  $tagResponse = Invoke-ReplayAws @('lambda','list-tags','--resource',$functionArn)
  if ($tagResponse -isnot [pscustomobject]) { throw 'DeletionReplayFunctionTagsInvalid' }
  Assert-D1RestoreExactObjectKeys $tagResponse @('Tags') 'DeletionReplayFunctionTagReadback'
  if ($tagResponse.Tags -isnot [pscustomobject]) { throw 'DeletionReplayFunctionTagsInvalid' }
  foreach ($tag in $tagResponse.Tags.PSObject.Properties) {
    if ($tag.Value -isnot [string]) { throw 'DeletionReplayFunctionTagsInvalid' }
  }
  $embeddedTags = $function.PSObject.Properties['Tags']
  if ($null -ne $embeddedTags -and (ConvertTo-DeletionReplayCanonicalJson $embeddedTags.Value) -cne (ConvertTo-DeletionReplayCanonicalJson $tagResponse.Tags)) { throw 'DeletionReplayFunctionTagsConflict' }
  $function = ConvertFrom-D1RestoreJson (ConvertTo-Json -InputObject $function -Depth 80 -Compress)
  $function | Add-Member -NotePropertyName Tags -NotePropertyValue $tagResponse.Tags -Force
  $concurrency = Invoke-ReplayAws @('lambda','get-function-concurrency','--function-name',$name)
  if ($concurrency -isnot [pscustomobject]) { throw 'DeletionReplayConcurrencyChanged' }
  $reservedProperty = $concurrency.PSObject.Properties['ReservedConcurrentExecutions']
  if ($null -eq $reservedProperty) {
    if (@($concurrency.PSObject.Properties).Count -ne 0) { throw 'DeletionReplayConcurrencyChanged' }
    $reserved = -1
  } else {
    Assert-D1RestoreExactObjectKeys $concurrency @('ReservedConcurrentExecutions') 'DeletionReplayFunctionConcurrency'
    if (-not (Test-D1RestoreBoundedInteger $reservedProperty.Value)) { throw 'DeletionReplayConcurrencyChanged' }
    $reserved = [int]$reservedProperty.Value
  }
  if (-not $Cleanup -and $reserved -ne 1) { throw 'DeletionReplayConcurrencyChanged' }
  Assert-DeletionReplayFunction $function $Preparation $Version $reserved -AllowUnready:$Cleanup
  Assert-ReplayNoEntrypoints $name $Version
  return $function
}


function Get-ReplayDiagnosisCleanupReadyAt([string]$RunDirectory, [object]$Preparation, [string]$PreparationSha256, [datetimeoffset]$ReadyAt, [datetimeoffset]$Now = [datetimeoffset]::UtcNow) {
  $journals = @(Get-ChildItem -LiteralPath $RunDirectory -Filter 'diagnose-*-started.json' -File)
  if ($journals.Count -gt 100) { throw 'DeletionReplayDiagnosisJournalInventoryRejected' }
  foreach ($file in $journals) {
    if ($file.Name -cnotmatch '^diagnose-[a-f0-9]{32}-started\.json$') { throw 'DeletionReplayDiagnosisJournalRejected' }
    $path = Resolve-DeletionReplayPrivatePath $file.FullName $RunDirectory -MustExist
    $journal = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($path))
    Assert-D1RestoreExactObjectKeys $journal @('schemaVersion','action','status','startedAt','preparationSha256','requestSha256') 'DeletionReplayDiagnosisJournal'
    foreach ($key in @('action','status','startedAt','preparationSha256','requestSha256')) { if ($journal.$key -isnot [string]) { throw 'DeletionReplayDiagnosisJournalRejected' } }
    if (-not (Test-D1RestoreBoundedInteger $journal.schemaVersion) -or $journal.schemaVersion -ne 1 -or $journal.action -cne 'diagnose_completion' -or $journal.status -cnotin @('started','completed','ambiguous') -or $journal.preparationSha256 -cne $PreparationSha256 -or $journal.startedAt -isnot [string] -or $journal.startedAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}\+00:00$') { throw 'DeletionReplayDiagnosisJournalRejected' }
    $started = [datetimeoffset]::ParseExact($journal.startedAt,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None)
    if ($started -gt $Now) { throw 'DeletionReplayDiagnosisJournalRejected' }
    $requestPath = Resolve-DeletionReplayPrivatePath ($path.Replace('-started.json','-request.json')) $RunDirectory -MustExist
    Assert-DeletionReplayHash $requestPath $journal.requestSha256
    $request = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($requestPath))
    Assert-D1RestoreExactObjectKeys $request @('schemaVersion','action','runId','configurationSha256','functionVersion') 'DeletionReplayDiagnosisJournalRequest'
    foreach ($key in @('action','runId','configurationSha256','functionVersion')) { if ($request.$key -isnot [string]) { throw 'DeletionReplayDiagnosisJournalRejected' } }
    if (-not (Test-D1RestoreBoundedInteger $request.schemaVersion) -or $request.schemaVersion -ne 1 -or $request.action -cne 'diagnose_completion' -or $request.runId -cne $Preparation.runId -or $request.configurationSha256 -cne $Preparation.configurationSha256 -or $request.functionVersion -cne '1') { throw 'DeletionReplayDiagnosisJournalRejected' }
    $invocationReady = Get-DeletionReplayCleanupReadyAt $journal
    if ($invocationReady -gt $ReadyAt) { $ReadyAt = $invocationReady }
  }
  return $ReadyAt
}

function Write-ReplayOutput([object]$Value) { $Value | ConvertTo-Json -Depth 8 -Compress }

try {
  Push-Location $root
  if (-not $IsWindows) { throw 'DeletionReplayPrivateOperatorRequiresWindows' }
  if (@(Get-ChildItem Env: | Where-Object { $_.Name -match '^AWS_ENDPOINT_URL' -or $_.Name -in @('AWS_CA_BUNDLE','NODE_TLS_REJECT_UNAUTHORIZED') }).Count -ne 0) { throw 'DeletionReplayEndpointOverrideRejected' }
  if ($Action -in @('Create','Replay','Cleanup') -and -not $Execute) { throw 'DeletionReplayExplicitExecutionRequired' }
  if ($Action -ceq 'Prepare') {
    if ($ExpectedAccountId -cnotmatch '^[0-9]{12}$' -or $SourceSha -cnotmatch '^[a-f0-9]{40}$' -or $StateBucket -cnotmatch '^ai-job-apply-development-[a-z0-9-]+$' -or $AcceptedPolicyCatalogSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayPreparationInputsMissing' }
    if ((Invoke-ReplayGit @('rev-parse','HEAD')) -cne $SourceSha -or (Invoke-ReplayGit @('status','--porcelain')) -cne '') { throw 'DeletionReplayCleanExactSourceRequired' }
    Assert-D1RestoreAwsCallerBoundary (Invoke-ReplayAws @('sts','get-caller-identity')) $ExpectedAccountId
    if ($PrimaryRecovery) {
      if ($PrimarySafetySnapshotId -cnotmatch '^ai-job-apply-development-[a-z0-9-]+$') { throw 'DeletionReplayPrimaryBackupRequired' }
      # Context is basic target/backup metadata, not a physical-restore proof.
      # A new run gets its own immutable context so older cleanup remains possible.
      $restoreContextPath = Join-Path $privateRoot ("primary-" + [guid]::NewGuid().ToString('N') + '.json')
      Write-DeletionReplayPrivateJson $restoreContextPath (New-ReplayPrimaryContext)
      $ReviewedRestoreContextSha256 = Get-D1RestoreFileSha256 $restoreContextPath
    }
    Assert-DeletionReplayHash $restoreContextPath $ReviewedRestoreContextSha256
    Assert-DeletionReplayHash $manifestPath $ReviewedArtifactManifestSha256
    $plan = Read-ReplayPlan $RuntimePlanPath $ReviewedRuntimePlanSha256
    $manifest = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($manifestPath))
    Assert-DeletionReplayArtifact $manifest $SourceSha $zipPath $sbomPath
    $context = Read-ReplayContext
    if (-not $PrimaryRecovery) { Assert-D1RestoreRecoveryMode $context 'development' ([bool]$DarkRecovery) }
    $databases = Get-ReplayDatabases $context
    $roleBoundary = Get-ReplayRoleBoundary $plan $ExpectedAccountId
    $activity = Get-ReplayPlanResource $plan 'module.platform.aws_lambda_function.profile_readiness_activity[0]'
    $artifactBucket = (Get-ReplayPlanResource $plan 'module.platform.aws_s3_bucket.artifacts').bucket
    $runId = [guid]::NewGuid().ToString('N')
    $now = [datetimeoffset]::UtcNow
    $configuration = [pscustomobject][ordered]@{
      schemaVersion=1;runId=$runId;accountId=$ExpectedAccountId;region='us-east-2';sourceSha=$SourceSha;restoreContextSha256=$ReviewedRestoreContextSha256
      sourceIdentifier=$context.source_identifier;sourceDbiResourceId=$context.source_dbi_resource_id;sourceBoundarySha256=$context.source_boundary_sha256;sourceHostname=$databases.source.Endpoint.Address
      targetIdentifier=$context.target_identifier;targetDbiResourceId=$context.target_dbi_resource_id;targetBoundarySha256=$context.target_boundary_sha256;targetHostname=$databases.target.Endpoint.Address
      databaseName=$(if ($PrimaryRecovery) { 'ai_job_apply' } else { $databases.target.DBName });databasePort=[int]$databases.target.Endpoint.Port;restoreManifestSha256=$context.source_manifest_sha256;acceptedPolicyCatalogSha256=$AcceptedPolicyCatalogSha256
      issuedAt=$now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");expiresAt=$now.AddMinutes(30).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    }
    if ($PrimaryRecovery) { $configuration | Add-Member -NotePropertyName recoveryMode -NotePropertyValue 'primary_recovery' }
    $activityEnvironment = $activity.environment[0].variables
    $environment = [pscustomobject][ordered]@{
      NODE_ENV='production';RELEASE_SHA=$manifest.artifactSha256;DATABASE_SECRET_ID=$activityEnvironment.DATABASE_SECRET_ID
      CANDIDATE_DOCUMENT_BUCKET=$activityEnvironment.CANDIDATE_DOCUMENT_BUCKET;CANDIDATE_DELETION_RECOVERY_BUCKET=$activityEnvironment.CANDIDATE_DELETION_RECOVERY_BUCKET
      CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN=$activityEnvironment.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN
      RESTORE_REPLAY_CONFIG_JSON=(Get-DeletionReplayConfigJson $configuration);RESTORE_REPLAY_CONFIG_SHA256=''
    }
    $environment.RESTORE_REPLAY_CONFIG_SHA256 = Get-DeletionReplayEnvironmentSha $environment
    $null = Assert-DeletionReplayEnvironment $environment
    $PreparationPath = Resolve-DeletionReplayPrivatePath (Join-Path $privateRoot "$runId/preparation.json") $privateRoot
    $key = "lambda/candidate-deletion-restore/$SourceSha/$($manifest.artifactSha256)/candidate-deletion-restore-lambda.zip"
    $create = [ordered]@{
      FunctionName="ai-job-apply-development-replay-$runId";Runtime='nodejs24.x';Role=$roleBoundary.roleArn;Handler='index.handler';Description='Temporary private isolated restore deletion replay'
      Timeout=300;MemorySize=512;Publish=$true;Architectures=@('x86_64')
      Layers=@($activity.layers);VpcConfig=@{SubnetIds=@($activity.vpc_config[0].subnet_ids);SecurityGroupIds=@($activity.vpc_config[0].security_group_ids)}
      Environment=@{Variables=$environment};LoggingConfig=@{LogFormat='JSON';LogGroup='/ai-job-apply/development/application'}
      Tags=[ordered]@{Project='ai-job-apply';Environment='development';ManagedBy='restore-drill';Purpose='candidate-deletion-restore';RunId=$runId;ConfigurationSha256=$environment.RESTORE_REPLAY_CONFIG_SHA256;SourceSha=$SourceSha}
    }
    $files = @(Get-ReplayBoundFiles $RuntimePlanPath)
    $preparation = [ordered]@{schemaVersion=1;kind='candidate-deletion-restore-preparation';runId=$runId;accountId=$ExpectedAccountId;sourceSha=$SourceSha;stateBucket=$StateBucket;runtimePlanPath=[IO.Path]::GetFullPath($RuntimePlanPath);runtimePlanSha256=$ReviewedRuntimePlanSha256;configurationSha256=$environment.RESTORE_REPLAY_CONFIG_SHA256;artifactBucket=$artifactBucket;artifactKey=$key;artifactSha256=$manifest.artifactSha256;artifactBase64Sha256=$manifest.artifactBase64Sha256;roleBoundary=$roleBoundary;createRequest=$create;fileBindings=@($files | ForEach-Object { [ordered]@{path=$_;sha256=(Get-D1RestoreFileSha256 $_)} })}
    $preparation.baselineMode = if ($PrimaryRecovery) { 'primary-recovery' } elseif ($DarkRecovery) { 'dark-recovery' } else { 'steady-state' }
    Assert-ReplayNoDrift ([pscustomobject]$preparation)
    foreach ($binding in $preparation.fileBindings) { Assert-DeletionReplayHash $binding.path $binding.sha256 }
    Write-DeletionReplayPrivateJson $PreparationPath $preparation
    Write-ReplayOutput @{stage='prepared';preparationPath=$PreparationPath;preparationSha256=(Get-D1RestoreFileSha256 $PreparationPath);configurationSha256=$environment.RESTORE_REPLAY_CONFIG_SHA256;cloudChanged=$false}
    exit 0
  }

  $PreparationPath = Resolve-DeletionReplayPrivatePath $PreparationPath $privateRoot -MustExist
  Assert-DeletionReplayHash $PreparationPath $ReviewedPreparationSha256
  $preparation = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($PreparationPath))
  if ($preparation.schemaVersion -ne 1 -or $preparation.kind -cne 'candidate-deletion-restore-preparation' -or $preparation.runId -cnotmatch '^[a-f0-9]{32}$' -or $preparation.createRequest.FunctionName -cne "ai-job-apply-development-replay-$($preparation.runId)" -or (Split-Path (Split-Path $PreparationPath -Parent) -Leaf) -cne $preparation.runId) { throw 'DeletionReplayPreparationInvalid' }
  Assert-ReplayRecoveryMode $preparation $null
  if ($PrimaryRecovery) {
    $contexts = @($preparation.fileBindings.path | Where-Object { (Split-Path $_ -Leaf) -cmatch '^primary-[a-f0-9]{32}\.json$' })
    if ($contexts.Count -ne 1) { throw 'DeletionReplayPrimaryContextMissing' }
    $restoreContextPath = Resolve-DeletionReplayPrivatePath $contexts[0] $privateRoot -MustExist
  }
  $ExpectedAccountId = $preparation.accountId
  $runDirectory = Split-Path $PreparationPath -Parent
  $createdPath = Join-Path $runDirectory 'created.json'
  $name = $preparation.createRequest.FunctionName
  Assert-ReplayCurrentBoundary $preparation -Cleanup:($Action -ceq 'Cleanup')

  if ($Action -ceq 'Create') {
    $attemptPath = Join-Path $runDirectory 'create-started.json'
    if ((Test-Path -LiteralPath $attemptPath) -or $null -ne (Invoke-ReplayAws @('lambda','get-function','--function-name',$name) -AllowNotFound)) { throw 'DeletionReplayCreationAlreadyAttempted' }
    $bucket = $preparation.artifactBucket
    if ((Invoke-ReplayAws @('s3api','get-bucket-versioning','--bucket',$bucket,'--expected-bucket-owner',$ExpectedAccountId)).Status -cne 'Enabled') { throw 'DeletionReplayArtifactBucketUnversioned' }
    $encryption = Invoke-ReplayAws @('s3api','get-bucket-encryption','--bucket',$bucket,'--expected-bucket-owner',$ExpectedAccountId)
    $artifactKmsKey = $preparation.createRequest.Environment.Variables.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN
    if ($encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'aws:kms' -or $encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -cne $artifactKmsKey) { throw 'DeletionReplayArtifactBucketEncryptionInvalid' }
    $remote = Invoke-ReplayAws @('s3api','head-object','--bucket',$bucket,'--key',$preparation.artifactKey,'--checksum-mode','ENABLED','--expected-bucket-owner',$ExpectedAccountId) -AllowNotFound
    Assert-ReplayReviewedFiles $preparation
    Write-DeletionReplayPrivateJson $attemptPath @{schemaVersion=1;startedAt=[datetimeoffset]::UtcNow.ToString('o');preparationSha256=$ReviewedPreparationSha256}
    if ($null -eq $remote) {
      $remote = Invoke-ReplayAws @('s3api','put-object','--bucket',$bucket,'--key',$preparation.artifactKey,'--body',$zipPath,'--if-none-match','*','--checksum-algorithm','SHA256','--server-side-encryption','aws:kms','--ssekms-key-id',$artifactKmsKey,'--expected-bucket-owner',$ExpectedAccountId)
    }
    if (-not $remote.VersionId -or $remote.VersionId -ceq 'null') { throw 'DeletionReplayArtifactVersionMissing' }
    $versionId = $remote.VersionId
    $remote = Invoke-ReplayAws @('s3api','head-object','--bucket',$bucket,'--key',$preparation.artifactKey,'--version-id',$versionId,'--checksum-mode','ENABLED','--expected-bucket-owner',$ExpectedAccountId)
    if ($remote.ChecksumSHA256 -cne $preparation.artifactBase64Sha256 -or $remote.SSEKMSKeyId -cne $artifactKmsKey -or $remote.ServerSideEncryption -cne 'aws:kms') { throw 'DeletionReplayRemoteArtifactChanged' }
    $request = $preparation.createRequest | ConvertTo-Json -Depth 50 | ConvertFrom-D1RestoreJson
    $request | Add-Member -NotePropertyName Code -NotePropertyValue @{S3Bucket=$bucket;S3Key=$preparation.artifactKey;S3ObjectVersion=$versionId}
    $requestPath = Join-Path $runDirectory 'create-request.json'
    Write-DeletionReplayPrivateJson $requestPath $request
    $requestHash = Get-D1RestoreFileSha256 $requestPath
    Assert-ReplayReviewedFiles $preparation
    Assert-DeletionReplayHash $requestPath $requestHash
    $created = Invoke-ReplayAws @('lambda','create-function','--cli-input-json',"file://$requestPath")
    if ($created.Version -cne '1') { throw 'DeletionReplayUnexpectedCreatedVersion' }
    $null = Invoke-ReplayAws @('lambda','put-function-concurrency','--function-name',$name,'--reserved-concurrent-executions','1')
    $deadline = [datetimeoffset]::UtcNow.AddMinutes(5)
    do {
      $live = Invoke-ReplayAws @('lambda','get-function','--function-name',$name,'--qualifier','1')
      if ($live.Configuration.State -ceq 'Active' -and $live.Configuration.LastUpdateStatus -ceq 'Successful') { break }
      if ($live.Configuration.State -ceq 'Failed' -or [datetimeoffset]::UtcNow -ge $deadline) { throw 'DeletionReplayFunctionNotReady' }
      Start-Sleep -Seconds 5
    } while ($true)
    $null = Get-ReplayFunction $preparation '1'
    Assert-ReplayReviewedFiles $preparation
    Write-DeletionReplayPrivateJson $createdPath @{schemaVersion=1;kind='candidate-deletion-restore-created';preparationSha256=$ReviewedPreparationSha256;version='1';artifactVersionId=$versionId;configurationSha256=$preparation.configurationSha256}
    Write-ReplayOutput @{stage='created';createdPath=$createdPath;createdSha256=(Get-D1RestoreFileSha256 $createdPath);functionVersion='1';publicEntrypoints=0}
    exit 0
  }

  if ($Action -ceq 'Cleanup') {
    $existing = Invoke-ReplayAws @('lambda','get-function','--function-name',$name,'--qualifier','1') -AllowNotFound
    if ($null -eq $existing) {
      if ($null -ne (Invoke-ReplayAws @('lambda','get-function','--function-name',$name) -AllowNotFound)) { throw 'DeletionReplayCleanupVersionAmbiguous' }
      Write-ReplayOutput @{stage='cleanup-complete';temporaryFunctionAbsent=$true;restoredDatabaseDeleted=$false}; exit 0
    }
    $null = Get-ReplayFunction $preparation '1' -Cleanup
    $disabledPath = Join-Path $runDirectory 'cleanup-disabled.json'
    if (-not (Test-Path -LiteralPath $disabledPath)) {
      Assert-ReplayReviewedFiles $preparation
      $null = Invoke-ReplayAws @('lambda','put-function-concurrency','--function-name',$name,'--reserved-concurrent-executions','0')
      if ((Invoke-ReplayAws @('lambda','get-function-concurrency','--function-name',$name)).ReservedConcurrentExecutions -ne 0) { throw 'DeletionReplayCleanupDisableNotConfirmed' }
      Write-DeletionReplayPrivateJson $disabledPath @{schemaVersion=1;status='started';startedAt=[datetimeoffset]::UtcNow.ToString('o');preparationSha256=$ReviewedPreparationSha256}
      $ReviewedCleanupDisabledSha256 = Get-D1RestoreFileSha256 $disabledPath
    }
    Assert-DeletionReplayHash $disabledPath $ReviewedCleanupDisabledSha256
    $disabled = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($disabledPath))
    if ($disabled.preparationSha256 -cne $ReviewedPreparationSha256) { throw 'DeletionReplayCleanupJournalChanged' }
    $ready = Get-DeletionReplayCleanupReadyAt $disabled
    $ready = Get-ReplayDiagnosisCleanupReadyAt $runDirectory $preparation $ReviewedPreparationSha256 $ready
    if ([datetimeoffset]::UtcNow -lt $ready) { Write-ReplayOutput @{stage='cleanup-waiting';earliestDeletionAt=$ready.ToString('o');disabledReceiptPath=$disabledPath;disabledReceiptSha256=$ReviewedCleanupDisabledSha256;concurrency=0;temporaryFunctionDeleted=$false}; exit 0 }
    $live = Get-ReplayFunction $preparation '1' -Cleanup
    $concurrency = Invoke-ReplayAws @('lambda','get-function-concurrency','--function-name',$name)
    if ($concurrency.ReservedConcurrentExecutions -ne 0) { throw 'DeletionReplayCleanupDrainInvalidated' }
    Assert-ReplayReviewedFiles $preparation
    Assert-DeletionReplayHash $disabledPath $ReviewedCleanupDisabledSha256
    $ready = Get-ReplayDiagnosisCleanupReadyAt $runDirectory $preparation $ReviewedPreparationSha256 $ready
    if ([datetimeoffset]::UtcNow -lt $ready) { throw 'DeletionReplayCleanupDrainInvalidated' }
    $null = Invoke-ReplayAws @('lambda','delete-function','--function-name',$name)
    if ($null -ne (Invoke-ReplayAws @('lambda','get-function','--function-name',$name) -AllowNotFound)) { throw 'DeletionReplayCleanupNotComplete' }
    Write-ReplayOutput @{stage='cleanup-complete';temporaryFunctionAbsent=$true;restoredDatabaseDeleted=$false;immutableArtifactRetained=$true}
    exit 0
  }

  if (-not (Test-Path -LiteralPath $createdPath)) { throw 'DeletionReplayCreatedReceiptMissing' }
  $createdHash = Get-D1RestoreFileSha256 $createdPath
  $created = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($createdPath))
  Assert-D1RestoreExactObjectKeys $created @('schemaVersion','kind','preparationSha256','version','artifactVersionId','configurationSha256') 'DeletionReplayCreatedReceipt'
  if ($created.schemaVersion -ne 1 -or $created.kind -cne 'candidate-deletion-restore-created' -or $created.preparationSha256 -cne $ReviewedPreparationSha256 -or $created.version -cne '1' -or $created.configurationSha256 -cne $preparation.configurationSha256 -or $created.artifactVersionId -isnot [string] -or $created.artifactVersionId -cnotmatch '^[A-Za-z0-9._-]{1,1024}$' -or $created.artifactVersionId -ceq 'null') { throw 'DeletionReplayCreatedReceiptInvalid' }
  $artifactReadback = Invoke-ReplayAws @('s3api','head-object','--bucket',$preparation.artifactBucket,'--key',$preparation.artifactKey,'--version-id',$created.artifactVersionId,'--checksum-mode','ENABLED','--expected-bucket-owner',$ExpectedAccountId)
  if ($artifactReadback.VersionId -cne $created.artifactVersionId -or $artifactReadback.ChecksumSHA256 -cne $preparation.artifactBase64Sha256 -or $artifactReadback.ServerSideEncryption -cne 'aws:kms' -or $artifactReadback.SSEKMSKeyId -cne $preparation.createRequest.Environment.Variables.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN) { throw 'DeletionReplayArtifactReadbackChanged' }
  $null = Get-ReplayFunction $preparation $created.version
  $request = [ordered]@{schemaVersion=1;action=(Get-DeletionReplayInvocationAction $Action);runId=$preparation.runId;configurationSha256=$preparation.configurationSha256;functionVersion=$created.version}
  if ($Action -ceq 'Replay') {
    $InspectionPath = Resolve-DeletionReplayPrivatePath $InspectionPath $runDirectory -MustExist
    Assert-DeletionReplayHash $InspectionPath $ReviewedInspectionReceiptSha256
    $inspection = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($InspectionPath))
    $inspectionRequest = [pscustomobject]@{action='inspect';configurationSha256=$preparation.configurationSha256;functionVersion=$created.version}
    Assert-DeletionReplayAggregate $inspection $inspectionRequest (ConvertFrom-D1RestoreJson $preparation.createRequest.Environment.Variables.RESTORE_REPLAY_CONFIG_JSON)
    $request.reviewedInspectionSha256 = $inspection.inspectionSha256
    $journalPath = Join-Path $runDirectory 'replay-started.json'
    if (Test-Path -LiteralPath $journalPath) { throw 'DeletionReplayAlreadyAttemptedInspectAndReviewRecovery' }
  } elseif ($Action -ceq 'DiagnoseCompletion') {
    $journalPath = Join-Path $runDirectory ("diagnose-" + [guid]::NewGuid().ToString('N') + '-started.json')
  } else { $journalPath = Join-Path $runDirectory ("inspect-" + [guid]::NewGuid().ToString('N') + '-started.json') }
  $requestPath = $journalPath.Replace('-started.json','-request.json')
  $responsePath = $journalPath.Replace('-started.json','-response.json')
  $temporaryResponsePath = $journalPath.Replace('-started.json','-unvalidated.tmp')
  Write-DeletionReplayPrivateJson $requestPath $request
  $requestHash = Get-D1RestoreFileSha256 $requestPath
  Assert-ReplayReviewedFiles $preparation
  Assert-DeletionReplayHash $createdPath $createdHash
  Assert-DeletionReplayHash $requestPath $requestHash
  if ($Action -ceq 'Replay') { Assert-DeletionReplayHash $InspectionPath $ReviewedInspectionReceiptSha256 }
  $journal = [ordered]@{schemaVersion=1;status='started';startedAt=[datetimeoffset]::UtcNow.ToString('o');preparationSha256=$ReviewedPreparationSha256;requestSha256=$requestHash}
  if ($Action -ceq 'DiagnoseCompletion') { $journal.action = 'diagnose_completion' }
  Write-DeletionReplayPrivateJson $journalPath $journal
  $oldAttempts = [Environment]::GetEnvironmentVariable('AWS_MAX_ATTEMPTS','Process')
  try {
    $env:AWS_MAX_ATTEMPTS = '1'
    $invocation = Invoke-ReplayAws @('lambda','invoke','--function-name',$name,'--qualifier',$created.version,'--invocation-type','RequestResponse','--log-type','None','--cli-connect-timeout','10','--cli-read-timeout','330','--payload',"fileb://$requestPath",$temporaryResponsePath)
    if ($invocation.StatusCode -ne 200 -or $invocation.ExecutedVersion -cne $created.version -or $invocation.PSObject.Properties.Name -contains 'FunctionError' -or (Get-Item -LiteralPath $temporaryResponsePath).Length -gt 8192) { throw 'DeletionReplayInvocationAmbiguousInspectBeforeRecovery' }
    $response = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($temporaryResponsePath))
    if ($Action -ceq 'DiagnoseCompletion') {
      Assert-DeletionReplayCompletionDiagnosis $response ([pscustomobject]$request) (ConvertFrom-D1RestoreJson $preparation.createRequest.Environment.Variables.RESTORE_REPLAY_CONFIG_JSON)
    } else {
      Assert-DeletionReplayAggregate $response ([pscustomobject]$request) (ConvertFrom-D1RestoreJson $preparation.createRequest.Environment.Variables.RESTORE_REPLAY_CONFIG_JSON)
    }
    Assert-ReplayReviewedFiles $preparation
    Assert-DeletionReplayHash $createdPath $createdHash
    if ($Action -ceq 'Replay') { Assert-DeletionReplayHash $InspectionPath $ReviewedInspectionReceiptSha256 }
    Write-DeletionReplayPrivateJson $responsePath $response
    if ($Action -ceq 'DiagnoseCompletion') {
      Write-ReplayOutput @{stage='diagnosed';outcome=$response.outcome;reason=$response.reason;responsePath=$responsePath;responseSha256=(Get-D1RestoreFileSha256 $responsePath);markersValidated=1;inspectionApproval=$false;automaticRetry=$false;publicEntrypoints=0}
    } else {
      Write-ReplayOutput @{stage=$response.outcome;responsePath=$responsePath;responseSha256=(Get-D1RestoreFileSha256 $responsePath);markersValidated=$response.markersValidated;documentVersionsObserved=0;publicEntrypoints=0}
    }
  } catch {
    if ($Action -ceq 'DiagnoseCompletion') { throw 'DeletionReplayDiagnosisAmbiguousReviewBeforeRetry' }
    throw
  } finally {
    [Environment]::SetEnvironmentVariable('AWS_MAX_ATTEMPTS',$oldAttempts,'Process')
    if (Test-Path -LiteralPath $temporaryResponsePath) { Remove-Item -LiteralPath (Resolve-DeletionReplayPrivatePath $temporaryResponsePath $runDirectory -MustExist) -Force }
  }
} catch {
  # Never forward SDK/native errors, SQL, resource metadata, credentials or candidate records.
  $safeCode = [string]$_.Exception.Message
  if ($safeCode -cnotmatch '^DeletionReplay[A-Za-z]+$') { $safeCode = 'DeletionReplayBoundaryCheckFailed' }
  Write-ReplayOutput @{stage='not-complete';failureCode=$safeCode;automaticRetry=$false}
  exit 1
} finally {
  Pop-Location
}
