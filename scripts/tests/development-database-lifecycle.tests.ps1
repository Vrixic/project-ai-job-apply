$ErrorActionPreference = 'Stop'
$operator = Join-Path $PSScriptRoot '../operate-development-database-lifecycle.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operator, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Operator must parse without errors.' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-PlanScope' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
$script:checks = 0
function Check([string]$Name, [scriptblock]$Body, [bool]$Reject = $false) {
  $rejected = $false
  try { & $Body } catch { $rejected = $true }
  if ($rejected -ne $Reject) { throw "Failed: $Name" }
  $script:checks++
}
function Plan([string]$Address, [string[]]$Actions, $Before, $After) {
  return [pscustomobject]@{ resource_changes = @([pscustomobject]@{
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
"Passed $script:checks lifecycle plan safety checks; AWS was not called."
