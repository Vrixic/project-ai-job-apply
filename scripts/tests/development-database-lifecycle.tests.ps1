$ErrorActionPreference = 'Stop'
$operator = Join-Path $PSScriptRoot '../operate-development-database-lifecycle.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operator, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Operator must parse without errors.' }
foreach ($functionName in @('Assert-RestoreSnapshotSelection','Assert-SafetySnapshot','Assert-PlanScope')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName }, $true)
  . ([scriptblock]::Create($definition.Extent.Text))
}
$script:checks = 0
function Check([string]$Name, [scriptblock]$Body, [bool]$Reject = $false) {
  $rejected = $false
  try { & $Body } catch { $rejected = $true }
  if ($rejected -ne $Reject) { throw "Failed: $Name" }
  $script:checks++
}
function Plan([string]$Address, [string[]]$Actions, $Before, $After) {
  return [pscustomobject]@{ variables = [pscustomobject]@{development_database_recovery=[pscustomobject]@{value=[pscustomobject]@{
    final_snapshot_identifier='exact-snapshot';restore_snapshot_identifier='exact-snapshot'
  }}}; resource_changes = @([pscustomobject]@{
    mode='managed'; address=$Address; change=[pscustomobject]@{actions=$Actions;before=$Before;after=$After}
  }) }
}
$safe = [pscustomobject]@{skip_final_snapshot=$false;delete_automated_backups=$false;deletion_protection=$false}
$TargetMode = 'dormant'
Check 'only prepared DB deletion accepted' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('delete') $safe $null) }
foreach ($address in @('module.platform.aws_s3_bucket.candidate_data_exports[0]','module.platform.aws_kms_key.platform','module.platform.aws_secretsmanager_secret.database_url','module.platform.aws_sqs_queue.events')) {
  Check "preserve $address" { Assert-PlanScope (Plan $address @('delete') $safe $null) } $true
}
Check 'replacement refused' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('delete','create') $safe $safe) } $true
foreach ($field in @('skip_final_snapshot','delete_automated_backups','deletion_protection')) {
  $unsafe = $safe | ConvertTo-Json | ConvertFrom-Json; $unsafe.$field = $true
  Check "refuse $field" { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('delete') $unsafe $null) } $true
}
$TargetMode = 'snapshot-prepared'
$before = [pscustomobject]@{deletion_protection=$true;final_snapshot_identifier='old';allocated_storage=20}
$after = [pscustomobject]@{deletion_protection=$false;final_snapshot_identifier='new';allocated_storage=20}
Check 'preparation accepted' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('update') $before $after) }
$after.allocated_storage = 30
Check 'storage mutation refused' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('update') $before $after) } $true
$TargetMode = 'restore'
$restored = [pscustomobject]@{snapshot_identifier='exact-snapshot';storage_encrypted=$true;publicly_accessible=$false;deletion_protection=$true}
Check 'exact protected restore accepted' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('create') $null $restored) }
$stale = Plan 'module.platform.aws_db_instance.postgres[0]' @('create') $null $restored
$stale.variables.development_database_recovery.value.final_snapshot_identifier = 'ai-job-apply-development-shutdown-20261009112116'
$stale.variables.development_database_recovery.value.restore_snapshot_identifier = 'ai-job-apply-development-shutdown-20261009023924'
Check 'pre-transition selection with post-transition final refused' { Assert-PlanScope $stale } $true
Check 'input preflight rejects stale selection before planning' { Assert-RestoreSnapshotSelection $stale.variables.development_database_recovery.value } $true
$substituted = Plan 'module.platform.aws_db_instance.postgres[0]' @('create') $null ([pscustomobject]@{snapshot_identifier='older-snapshot';storage_encrypted=$true;publicly_accessible=$false;deletion_protection=$true})
Check 'planned database must match exact reviewed snapshot' { Assert-PlanScope $substituted } $true
$missing = [pscustomobject]@{final_snapshot_identifier='';restore_snapshot_identifier=''}
Check 'missing final snapshot refused' { Assert-RestoreSnapshotSelection $missing } $true
$caseChanged = [pscustomobject]@{final_snapshot_identifier='exact-snapshot';restore_snapshot_identifier='EXACT-SNAPSHOT'}
Check 'snapshot comparison is exact' { Assert-RestoreSnapshotSelection $caseChanged } $true
$restored.snapshot_identifier = $null
Check 'empty database refused' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('create') $null $restored) } $true
$restored.snapshot_identifier = 'exact-snapshot'; $restored.publicly_accessible = $true
Check 'public restore refused' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('create') $null $restored) } $true
$connectionBefore = [pscustomobject]@{secret_id='arn:aws:secretsmanager:us-east-2:111122223333:secret:database-original'}
$connectionAfter = [pscustomobject]@{secret_id=$connectionBefore.secret_id}
Check 'refresh same connection secret accepted' { Assert-PlanScope (Plan 'module.platform.aws_secretsmanager_secret_version.database_url[0]' @('delete','create') $connectionBefore $connectionAfter) }
$connectionAfter.secret_id = 'arn:aws:secretsmanager:us-east-2:111122223333:secret:unrelated'
Check 'connection secret retarget refused' { Assert-PlanScope (Plan 'module.platform.aws_secretsmanager_secret_version.database_url[0]' @('delete','create') $connectionBefore $connectionAfter) } $true
$TargetMode = 'retained'
Check 'baseline changes refused' { Assert-PlanScope (Plan 'module.platform.aws_db_instance.postgres[0]' @('update') $before $after) } $true
$stale.resource_changes = @()
Check 'retained inputs preserve historical restore snapshot' { Assert-PlanScope $stale }
$TargetMode = 'snapshot-prepared'
Check 'snapshot preparation preserves historical restore snapshot' { Assert-PlanScope $stale }
$TargetMode = 'dormant'
$stale.resource_changes = @([pscustomobject]@{mode='managed';address='module.platform.aws_db_instance.postgres[0]';change=[pscustomobject]@{actions=@('delete');before=$safe;after=$null}})
Check 'dormancy preserves historical restore snapshot' { Assert-PlanScope $stale }
$database = 'ai-job-apply-development'
$ExpectedAccountId = '111122223333'
$snapshot = [pscustomobject]@{DbiResourceId='db-current';DBSnapshotIdentifier='exact-safety';Status='available';Encrypted=$true;DBInstanceIdentifier=$database;KmsKeyId='arn:aws:kms:us-east-2:111122223333:key/test'}
$source = [pscustomobject]@{DBInstanceIdentifier=$database;DbiResourceId='db-current';KmsKeyId=$snapshot.KmsKeyId}
Check 'encrypted available exact-source safety backup needs no restore rehearsal' { Assert-SafetySnapshot $snapshot 'exact-safety' $source }
foreach ($mutation in @(@('DbiResourceId','db-old'),@('DBSnapshotIdentifier','other'),@('Status','creating'),@('Encrypted',$false),@('DBInstanceIdentifier','other'),@('KmsKeyId','arn:aws:kms:us-east-2:999900001111:key/test'))) {
  $changed = $snapshot | ConvertTo-Json | ConvertFrom-Json
  $changed.($mutation[0]) = $mutation[1]
  Check "unsafe backup refuses $($mutation[0])" { Assert-SafetySnapshot $changed 'exact-safety' $source } $true
}
Check 'missing backup refuses' { Assert-SafetySnapshot $null 'exact-safety' $source } $true
Check 'missing physical source refuses' { Assert-SafetySnapshot $snapshot 'exact-safety' $null } $true
"Passed $script:checks lifecycle plan safety checks; AWS was not called."
