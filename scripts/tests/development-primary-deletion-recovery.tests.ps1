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
foreach ($part in @('Identifier','Hostname','DbiResourceId','BoundarySha256')) { $config."target$part" = $config."source$part" }
$encoded = Get-DeletionReplayConfigJson $config ([datetimeoffset]$fixture.now)
Assert ($encoded.EndsWith(',"recoveryMode":"primary_recovery"}')) 'mode is canonically hashed after original keys'
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
[pscustomobject]@{suite='development-primary-deletion-recovery';checksPassed=$script:checks;cloudCalls=0} | ConvertTo-Json -Compress
