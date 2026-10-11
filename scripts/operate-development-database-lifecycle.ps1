[CmdletBinding()]
param(
  [ValidateSet('Status', 'Plan', 'Apply')][string]$Action = 'Status',
  [ValidateSet('retained', 'snapshot-prepared', 'dormant', 'restore')][string]$TargetMode = 'dormant',
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [Parameter(Mandatory)][string]$StateBucket,
  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [string]$InputPath,
  [string]$PlanPath,
  [string]$ReviewedPlanSha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/terraform-toolchain.ps1')
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = Join-Path $repository 'infrastructure/terraform/environments/development'
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = 'us-east-2'
$env:AWS_DEFAULT_REGION = 'us-east-2'
$database = 'ai-job-apply-development'

function Read-Aws([string[]]$Arguments) {
  $raw = & aws @Arguments --region us-east-2 --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS $($Arguments[0]) $($Arguments[1]) failed." }
  if ($raw) { return ($raw | ConvertFrom-Json) }
}
function Get-SourceDigest {
  $records = foreach ($directory in @('environments/development','modules/platform','modules/cost-controls')) {
    Get-ChildItem (Join-Path $repository "infrastructure/terraform/$directory") -File -Filter '*.tf' | Sort-Object Name | ForEach-Object {
      $directory + '/' + $_.Name + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    }
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($records -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Assert-PrivateArtifact([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.tmp')) + [IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep private lifecycle artifacts under this checkout .tmp directory.' }
  return $full
}
function Assert-Drained {
  $rules = Read-Aws @('events','list-rules','--name-prefix',$database)
  if (@($rules.Rules | Where-Object State -ne 'DISABLED').Count) { throw 'Application EventBridge rules are enabled.' }
  $mappings = Read-Aws @('lambda','list-event-source-mappings')
  if (@($mappings.EventSourceMappings | Where-Object { $_.FunctionArn.Contains(":function:$database-") -and $_.State -ne 'Disabled' }).Count) { throw 'Application queue consumers are enabled.' }
  $apis = Read-Aws @('apigatewayv2','get-apis')
  foreach ($api in @($apis.Items | Where-Object { $_.Name.StartsWith($database) })) {
    $routes = Read-Aws @('apigatewayv2','get-routes','--api-id',$api.ApiId)
    if (@($routes.Items).Count) { throw 'Application API routes remain.' }
  }
  $clusters = Read-Aws @('ecs','list-clusters')
  foreach ($cluster in @($clusters.clusterArns | Where-Object { $_.Contains($database) })) {
    foreach ($status in @('RUNNING','PENDING')) {
      $tasks = Read-Aws @('ecs','list-tasks','--cluster',$cluster,'--desired-status',$status)
      if (@($tasks.taskArns).Count) { throw 'ECS work remains.' }
    }
  }
  foreach ($name in @("$database-profile-readiness-durable", "$database-ingestion-durable")) {
    $executions = Read-Aws @('lambda','list-durable-executions-by-function','--function-name',$name,'--statuses','RUNNING')
    if (@($executions.DurableExecutions).Count) { throw 'Durable executions remain.' }
  }
  $queues = Read-Aws @('sqs','list-queues','--queue-name-prefix',$database)
  foreach ($queue in $queues.QueueUrls) {
    $counts = Read-Aws @('sqs','get-queue-attributes','--queue-url',$queue,'--attribute-names','ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed')
    if (@($counts.Attributes.PSObject.Properties | Where-Object { [long]$_.Value -ne 0 }).Count) { throw 'Queue/DLQ work remains; never discard it for shutdown.' }
  }
}
function Assert-RestoreSnapshotSelection($Recovery) {
  if ([string]::IsNullOrWhiteSpace([string]$Recovery.final_snapshot_identifier) -or
      [string]$Recovery.restore_snapshot_identifier -cne [string]$Recovery.final_snapshot_identifier) {
    throw 'Restore must select the exact final snapshot from the reviewed recovery inputs; historical snapshot selection requires separate recovery review.'
  }
}
function Assert-SafetySnapshot($Snapshot, [string]$SnapshotId, $Source) {
  if (-not $Source -or $Source.DBInstanceIdentifier -cne $database -or -not $Source.DbiResourceId -or -not $Snapshot -or $Snapshot.DbiResourceId -cne $Source.DbiResourceId -or $Snapshot.KmsKeyId -cne $Source.KmsKeyId -or $Snapshot.DBSnapshotIdentifier -cne $SnapshotId -or $Snapshot.Status -cne 'available' -or -not $Snapshot.Encrypted -or $Snapshot.DBInstanceIdentifier -cne $database -or -not $Snapshot.KmsKeyId.StartsWith("arn:aws:kms:us-east-2:$ExpectedAccountId`:key/")) {
    throw 'An available encrypted safety snapshot of the exact development database is required before deletion.'
  }
}
function Assert-PlanScope($Plan) {
  if ($TargetMode -eq 'restore') {
    $recovery = $Plan.variables.development_database_recovery.value
    Assert-RestoreSnapshotSelection $recovery
  }
  foreach ($resource in @($Plan.resource_changes | Where-Object { $_.mode -eq 'managed' -and ($_.change.actions -join ',') -ne 'no-op' })) {
    $actions = $resource.change.actions -join ','
    if ($TargetMode -eq 'dormant') {
      if ($resource.address -ne 'module.platform.aws_db_instance.postgres[0]' -or $actions -ne 'delete' -or $resource.change.before.skip_final_snapshot -or $resource.change.before.delete_automated_backups -or $resource.change.before.deletion_protection) { throw 'Dormant plan must only delete the prepared database with final and automated backups retained.' }
    } elseif ($TargetMode -eq 'snapshot-prepared') {
      if ($resource.address -ne 'module.platform.aws_db_instance.postgres[0]' -or $actions -ne 'update') { throw 'Preparation may only update the database in place.' }
      foreach ($property in $resource.change.after.PSObject.Properties) {
        if ($property.Name -in @('deletion_protection','final_snapshot_identifier','skip_final_snapshot','delete_automated_backups')) { continue }
        if (($property.Value | ConvertTo-Json -Depth 100 -Compress) -cne ($resource.change.before.($property.Name) | ConvertTo-Json -Depth 100 -Compress)) { throw "Unexpected preparation change: $($property.Name)" }
      }
    } elseif ($TargetMode -eq 'restore') {
      if ($resource.address -eq 'module.platform.aws_db_instance.postgres[0]' -and $actions -eq 'create') {
        if ($resource.change.after.snapshot_identifier -cne $recovery.restore_snapshot_identifier -or -not $resource.change.after.storage_encrypted -or $resource.change.after.publicly_accessible -or -not $resource.change.after.deletion_protection) { throw 'Restore must use the exact encrypted snapshot and protected private database.' }
      } elseif ($resource.address -eq 'module.platform.aws_secretsmanager_secret_version.database_url[0]' -and $actions -in @('delete,create','create,delete')) {
        if (-not $resource.change.after.secret_id -or $resource.change.before.secret_id -cne $resource.change.after.secret_id) { throw 'Restore may refresh only the existing database connection secret version.' }
      } elseif ($actions -ne 'update' -or $resource.address -notin @('module.platform.aws_iam_role_policy.public_job_lambda[0]','module.platform.aws_lambda_function.public_job_projection[0]','module.platform.aws_lambda_alias.public_job_projection[0]')) { throw 'Unexpected resource change in restore plan.' }
    } else { throw 'Retained baseline must be resource-change free.' }
  }
}

$identity = Read-Aws @('sts','get-caller-identity')
if ($identity.Account -cne $ExpectedAccountId -or -not $identity.Arn.Contains(':assumed-role/')) { throw 'Use the exact temporary development SSO identity.' }
Assert-DeploymentTerraformCli
$encryption = Read-Aws @('s3api','get-bucket-encryption','--bucket',$StateBucket)
$kms = $encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
if (-not $kms.StartsWith("arn:aws:kms:us-east-2:$ExpectedAccountId`:key/")) { throw 'Unexpected state KMS identity.' }
Assert-DeploymentTerraformBackend -TerraformDirectory $root -ExpectedBucket $StateBucket -ExpectedKey 'platform.tfstate' -ExpectedRegion 'us-east-2' -ExpectedKmsKeyArn $kms
if ($Action -eq 'Status') {
  Assert-Drained
  $dbs = Read-Aws @('rds','describe-db-instances')
  $dbs.DBInstances | Where-Object { $_.DBInstanceIdentifier.StartsWith($database) } | Select-Object DBInstanceIdentifier,DBInstanceStatus,StorageEncrypted,DeletionProtection
  'Application routes, schedules, queues and running work are drained.'
  exit 0
}
$PlanPath = Assert-PrivateArtifact $PlanPath
if ($Action -eq 'Plan') {
  $InputPath = Assert-PrivateArtifact $InputPath
  $inputs = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
  if ($inputs.development_database_mode -cne $TargetMode) { throw 'Input mode mismatch.' }
  if ($TargetMode -eq 'restore') { Assert-RestoreSnapshotSelection $inputs.development_database_recovery }
  Assert-Drained
  & terraform "-chdir=$root" plan -input=false -lock-timeout=30s "-var-file=$InputPath" "-out=$PlanPath" -no-color > "$PlanPath.log" 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Plan failed; inspect the private log.' }
  $plan = Read-DeploymentTerraformPlan -Path $PlanPath -TerraformDirectory $root
  Assert-PlanScope $plan
  $metadata = @{Mode=$TargetMode;Account=$ExpectedAccountId;SourceSha256=(Get-SourceDigest);PlanSha256=(Get-FileHash $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant();InputSha256=(Get-FileHash $InputPath -Algorithm SHA256).Hash.ToLowerInvariant()}
  $metadata | ConvertTo-Json | Set-Content -LiteralPath "$PlanPath.metadata.json" -Encoding utf8
  $metadata | Select-Object Mode,SourceSha256,PlanSha256
  exit 0
}
$metadata = Get-Content -LiteralPath "$PlanPath.metadata.json" -Raw | ConvertFrom-Json
if ($metadata.Mode -cne $TargetMode -or $metadata.Account -cne $ExpectedAccountId -or $metadata.SourceSha256 -cne (Get-SourceDigest) -or $ReviewedPlanSha256 -cne $metadata.PlanSha256 -or (Get-FileHash $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ReviewedPlanSha256) { throw 'Plan checksum, source or environment mismatch.' }
$plan = Read-DeploymentTerraformPlan -Path $PlanPath -TerraformDirectory $root
Assert-PlanScope $plan
Assert-Drained
if ($TargetMode -eq 'restore') {
  $snapshotId = $plan.variables.development_database_recovery.value.restore_snapshot_identifier
  $snapshot = (Read-Aws @('rds','describe-db-snapshots','--db-snapshot-identifier',$snapshotId)).DBSnapshots[0]
  if ($snapshot.Status -ne 'available' -or -not $snapshot.Encrypted -or $snapshot.DBInstanceIdentifier -ne $database -or -not $snapshot.KmsKeyId.StartsWith("arn:aws:kms:us-east-2:$ExpectedAccountId`:key/")) { throw 'Restore snapshot is unavailable or outside the exact encrypted development boundary.' }
}
if ($TargetMode -eq 'dormant') {
  $recovery = $plan.variables.development_database_recovery.value
  $source = (Read-Aws @('rds','describe-db-instances','--db-instance-identifier',$database)).DBInstances[0]
  Assert-SafetySnapshot (Read-Aws @('rds','describe-db-snapshots','--db-snapshot-identifier',($recovery.final_snapshot_identifier + '-safety'))).DBSnapshots[0] ($recovery.final_snapshot_identifier + '-safety') $source
}
& terraform "-chdir=$root" apply -input=false -lock-timeout=30s -no-color $PlanPath > "$PlanPath.apply.log" 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Apply failed; inspect the private log and replan from actual state. Do not replay.' }
'Exact reviewed lifecycle plan applied. Verify live state and retain recovery evidence before handoff.'
