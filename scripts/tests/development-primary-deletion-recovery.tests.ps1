#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../lib/candidate-deletion-replay.ps1')
$fixture = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/candidate-deletion-restore-contract.v1.json')))
$script:checks = 0
function Assert([bool]$Value, [string]$Name) { if (-not $Value) { throw "Failed: $Name" }; $script:checks++ }
function Reject([scriptblock]$Run, [string]$Name) { $failed=$false; try { $null=& $Run } catch { $failed=$true }; Assert $failed $Name }
function Clone($Value) { ConvertFrom-D1RestoreJson (ConvertTo-Json $Value -Depth 50) }
$config = Clone $fixture.configuration
$config | Add-Member recoveryMode 'primary_recovery'
$manifestPath=Join-Path $PSScriptRoot '../../backend/services/database-migrations/restore-manifest.v1.json'
$currentManifestHash=(Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest=ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText($manifestPath))
Assert (@($manifest.contributors | ForEach-Object { $_.migrations }).Count -eq 81) 'primary checks current 81 migrations'
Assert (($manifest.contributors | Where-Object owner -CEQ documents).migrations[-1].version -ceq '0018_native_resume_legacy_launch_rejection') 'legacy rejection migration included'
$config.restoreManifestSha256=$currentManifestHash
foreach ($part in @('Identifier','Hostname','DbiResourceId','BoundarySha256')) { $config."target$part" = $config."source$part" }
$encoded = Get-DeletionReplayConfigJson $config ([datetimeoffset]$fixture.now)
Assert ($encoded.EndsWith(',"recoveryMode":"primary_recovery"}')) 'mode is canonically hashed after original keys'
$changed=Clone $config; $changed.restoreManifestSha256=$fixture.configuration.restoreManifestSha256
Reject { Get-DeletionReplayConfigJson $changed ([datetimeoffset]$fixture.now) } 'primary rejects historical 79-migration fingerprint'
$operatorText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../operate-development-candidate-deletion-replay.ps1'))
Assert ($operatorText.Contains("source_manifest_sha256='$currentManifestHash'")) 'primary context producer binds same exact source bytes as admission'
foreach ($part in @('Identifier','Hostname','DbiResourceId','BoundarySha256')) {
  $changed=Clone $config; $changed."target$part"=$fixture.configuration."target$part"
  Reject { Get-DeletionReplayConfigJson $changed ([datetimeoffset]$fixture.now) } "primary target substitution $part"
}
$changed=Clone $config; $changed.PSObject.Properties.Remove('recoveryMode')
Reject { Get-DeletionReplayConfigJson $changed ([datetimeoffset]$fixture.now) } 'same-primary requires explicit mode'
$changed=Clone $config; $changed.recoveryMode='isolated'
Reject { Get-DeletionReplayConfigJson $changed ([datetimeoffset]$fixture.now) } 'unknown mode rejected'

$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../operate-development-candidate-deletion-replay.ps1'),[ref]$tokens,[ref]$errors)
Assert ($errors.Count -eq 0) 'operator parses'
foreach ($name in @('Assert-ReplayPrimaryDatabase','Assert-ReplayRecoveryMode','Get-ReplayDatabases')) {
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  . ([scriptblock]::Create($node.Extent.Text))
}
$ExpectedAccountId='123456789012'; $PrimaryRecovery=$true; $DarkRecovery=$false
$db=Clone @{DBInstanceIdentifier='ai-job-apply-development';DBInstanceArn="arn:aws:rds:us-east-2:$ExpectedAccountId`:db:ai-job-apply-development";DbiResourceId='db-ABCDEFGH';DBInstanceStatus='available';PubliclyAccessible=$false;StorageEncrypted=$true;DeletionProtection=$true;BackupRetentionPeriod=35;MultiAZ=$false;DBName='';Endpoint=@{Port=5432;Address='ai-job-apply-development.synthetic.us-east-2.rds.amazonaws.com'};KmsKeyId="arn:aws:kms:us-east-2:$ExpectedAccountId`:key/11111111-1111-1111-1111-111111111111"}
$backup=Clone @{DBSnapshotIdentifier='ai-job-apply-development-primary-safety';Status='available';Encrypted=$true;DBInstanceIdentifier=$db.DBInstanceIdentifier;DbiResourceId=$db.DbiResourceId;KmsKeyId=$db.KmsKeyId}
Assert-ReplayPrimaryDatabase $db $backup $backup.DBSnapshotIdentifier
Assert $true 'fresh private protected canonical with physical backup admitted despite empty AWS DBName metadata'
foreach ($pair in @(@('DBInstanceIdentifier','other'),@('DbiResourceId','db-OTHERDBX'),@('DBInstanceStatus','stopped'),@('PubliclyAccessible',$true),@('StorageEncrypted',$false),@('DeletionProtection',$false),@('BackupRetentionPeriod',7),@('MultiAZ',$true),@('DBName','other'))) {
 $changed=Clone $db; $changed.($pair[0])=$pair[1]
 Reject { Assert-ReplayPrimaryDatabase $changed $backup $backup.DBSnapshotIdentifier } "unsafe primary $($pair[0])"
}
foreach ($pair in @(@('DBSnapshotIdentifier','other'),@('Status','creating'),@('Encrypted',$false),@('DbiResourceId','db-OLDDBXXX'),@('KmsKeyId','other'))) {
 $changed=Clone $backup; $changed.($pair[0])=$pair[1]
 Reject { Assert-ReplayPrimaryDatabase $db $changed $backup.DBSnapshotIdentifier } "unsafe backup $($pair[0])"
}
Assert-ReplayRecoveryMode ([pscustomobject]@{baselineMode='primary-recovery'}) $null
Assert $true 'explicit operator mode accepted'
$PrimaryRecovery=$false
Reject { Assert-ReplayRecoveryMode ([pscustomobject]@{baselineMode='primary-recovery'}) $null } 'missing switch refuses before AWS'
$PrimaryRecovery=$true
Reject { Assert-ReplayRecoveryMode ([pscustomobject]@{baselineMode='dark-recovery'}) $null } 'isolated packet cannot become primary'
# Exercise the primary-only composition with the real saved-plan and writer-input guards.
. (Join-Path $PSScriptRoot '../lib/development-postgresql-dark-recovery.ps1')
foreach ($name in @('Read-ReplayPlan','Assert-ReplayPrimaryBaseline')) {
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  . ([scriptblock]::Create($node.Extent.Text))
}
$terraformRoot='synthetic-development';$terraformPrivate='synthetic-private';$AwsProfile='synthetic'
$script:hash='a'*64;$script:caller=$ExpectedAccountId;$script:liveWriter=$false;$script:drainChecks=0;$script:backendChecks=0
$script:backendAccount=$ExpectedAccountId;$script:sse='aws:kms'
$script:writerValues=[ordered]@{candidate_deletion_restore_role_enabled=$true;development_database_mode='restore';database_backup_retention_days=35;d2_community_runtime=@{enabled=$false};gateway_native_materials=$null;legacy_receipt_transition=$null;application_restore_reconciliation=$null}
$writerFlags=@('serverless_runtime_enabled','ingestion_runtime_enabled','document_scan_mapping_enabled','document_scan_event_rule_enabled','job_retention_enabled','job_retention_schedule_enabled','privileged_audit_retention_enabled','privileged_audit_retention_schedule_enabled','native_cleanup_enabled','native_cleanup_schedule_enabled')
foreach($name in $writerFlags){$script:writerValues[$name]=$false}
foreach($name in @('native_resume_source_access_releases','native_preparation_releases','native_material_control_releases','native_resume_preparation_releases')){$script:writerValues[$name]=@{}}
$script:actions=@('no-op')
function Resolve-DeletionReplayPrivatePath { param($Path,$Root,[switch]$MustExist) return $Path }
function Assert-DeletionReplayHash { param($Path,$Sha) if($Sha -cne $script:hash){throw 'ChangedSavedHash'} }
function Get-DeploymentTerraformVersion { '1.16.2' }
function Read-DeploymentTerraformPlan {
  param($Path,$TerraformDirectory)
  $variables=[ordered]@{};foreach($name in $script:writerValues.Keys){$variables[$name]=@{value=$script:writerValues[$name]}}
  Clone @{terraform_version='1.16.2';variables=$variables;resource_changes=@(@{change=@{actions=$script:actions}})}
}
function Invoke-ReplayAws {
  param($Arguments)
  switch($Arguments[0]){
    'sts' { Clone @{Account=$script:caller;Arn="arn:aws:sts::$script:caller`:assumed-role/Synthetic/Session"} }
    's3api' { Clone @{ServerSideEncryptionConfiguration=@{Rules=@(@{ApplyServerSideEncryptionByDefault=@{SSEAlgorithm=$script:sse;KMSMasterKeyID="arn:aws:kms:us-east-2:$script:backendAccount`:key/11111111-1111-1111-1111-111111111111"}})}} }
    default { throw 'UnexpectedAwsCall' }
  }
}
function Assert-DeploymentTerraformBackend {
  param($TerraformDirectory,$DataDirectory,$ExpectedBucket,$ExpectedKey,$ExpectedRegion,$ExpectedKmsKeyArn)
  Assert ($ExpectedBucket -ceq 'synthetic-state' -and $ExpectedKey -ceq 'platform.tfstate' -and $ExpectedRegion -ceq 'us-east-2') 'exact backend binding retained'
  $script:backendChecks++
}
function Assert-D1RestoreDarkWritersStopped { $script:drainChecks++;if($script:liveWriter){throw 'LiveWriterPresent'} }
function Assert-D1RestoreDarkBaseline { throw 'FormalRecoverySweepMustNotRunForPrimary' }
$preparation=[pscustomobject]@{accountId=$ExpectedAccountId;stateBucket='synthetic-state';runtimePlanPath='synthetic-plan';runtimePlanSha256=$script:hash}
Assert-ReplayPrimaryBaseline $preparation
Assert ($script:drainChecks -eq 1 -and $script:backendChecks -eq 1) 'primary uses actual writer and backend checks without isolated proof sweep'
$script:caller='999999999999'
Reject { Assert-ReplayPrimaryBaseline $preparation } 'wrong AWS account rejected'
$script:caller=$ExpectedAccountId
$bad=Clone $preparation;$bad.runtimePlanSha256='b'*64
Reject { Assert-ReplayPrimaryBaseline $bad } 'changed saved plan hash rejected'
$script:actions=@('update')
Reject { Assert-ReplayPrimaryBaseline $preparation } 'nonzero saved plan rejected'
$script:actions=@('no-op')
foreach($name in $writerFlags){
  $script:writerValues[$name]='true'
  Reject { Assert-ReplayPrimaryBaseline $preparation } "writer gate rejected $name"
  $script:writerValues[$name]='false'
}
Assert-ReplayPrimaryBaseline $preparation
Assert $true 'equivalent canonical false strings retain writer exclusion'
$script:backendAccount='999999999999'
Reject { Assert-ReplayPrimaryBaseline $preparation } 'foreign backend KMS key rejected'
$script:backendAccount=$ExpectedAccountId;$script:sse='AES256'
Reject { Assert-ReplayPrimaryBaseline $preparation } 'backend must retain exact KMS encryption'
$script:sse='aws:kms'
$script:liveWriter=$true
Reject { Assert-ReplayPrimaryBaseline $preparation } 'fresh live writer drain failure refuses admission'
[pscustomobject]@{suite='development-primary-deletion-recovery';checksPassed=$script:checks;cloudCalls=0} | ConvertTo-Json -Compress
