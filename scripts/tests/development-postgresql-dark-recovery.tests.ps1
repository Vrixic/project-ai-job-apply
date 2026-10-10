$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $root 'scripts/lib/staging-postgresql-restore-verifier.ps1')
. (Join-Path $root 'scripts/lib/development-postgresql-dark-recovery.ps1')
$script:checks = 0
function Expect-DarkRefusal([scriptblock]$Operation) {
  $script:checks++
  try { & $Operation } catch { return }
  throw 'Dark recovery regression did not refuse unsafe input.'
}
function New-DarkValues {
  $values = [pscustomobject]@{
    development_database_mode = 'restore'; database_backup_retention_days = 35
    serverless_runtime_enabled = $false; ingestion_runtime_enabled = $false
    document_scan_mapping_enabled = $false; document_scan_event_rule_enabled = $false
    job_retention_enabled = $false; job_retention_schedule_enabled = $false
    privileged_audit_retention_enabled = $false; privileged_audit_retention_schedule_enabled = $false
    native_cleanup_enabled = $false; native_cleanup_schedule_enabled = $false
    d2_community_runtime = [pscustomobject]@{enabled=$false}
    native_resume_source_access_releases = [pscustomobject]@{}
    native_preparation_releases = [pscustomobject]@{}
    native_material_control_releases = [pscustomobject]@{}
    native_resume_preparation_releases = [pscustomobject]@{}
    gateway_native_materials = [pscustomobject]@{packet_protection_enabled=$true}
    legacy_receipt_transition = $null; application_restore_reconciliation = $null
    candidate_rights_enabled = $true; restricted_answer_vault_enabled = $true
  }
  return $values
}
Assert-D1RestoreDarkWriterInputs (New-DarkValues)
$script:checks++
foreach ($bad in @($true,'true','False','FALSE',0,1,'',$null)) {
  $values = New-DarkValues
  $values.serverless_runtime_enabled = $bad
  Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
}
$values = New-DarkValues
$values.serverless_runtime_enabled = 'false'
Assert-D1RestoreDarkWriterInputs $values
$script:checks++
foreach ($name in @('ingestion_runtime_enabled','document_scan_mapping_enabled','document_scan_event_rule_enabled',
    'job_retention_enabled','job_retention_schedule_enabled','privileged_audit_retention_enabled',
    'privileged_audit_retention_schedule_enabled','native_cleanup_enabled','native_cleanup_schedule_enabled')) {
  $values=New-DarkValues; $values.$name=$true
  Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
}
foreach ($binding in @(
  @('native_resume_source_access_releases','enabled'),
  @('native_preparation_releases','enabled','launch_enabled','intake_enabled','recovery_enabled','drain_enabled','route_enabled','route_creation_enabled'),
  @('native_material_control_releases','owner_enabled','control_enabled','recovery_enabled','new_launch_enabled','route_enabled'),
  @('native_resume_preparation_releases','enabled','new_launch_enabled','observation_events_enabled','observation_schedule_enabled','schedule_enabled','route_enabled','route_creation_enabled','terminal_events_enabled','execution_inspection_enabled','execution_reconciliation_enabled')
)) {
  foreach ($gate in $binding[1..($binding.Count-1)]) {
    $values=New-DarkValues
    $release=[pscustomobject]@{}; $release|Add-Member -NotePropertyName $gate -NotePropertyValue $true
    $values.($binding[0])=[pscustomobject]@{original=$release}
    Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
  }
}
foreach ($gate in @('owner_cleanup_enabled','disposal_enabled','resume_preparation_enabled','cover_letter_preparation_enabled')) {
  $values=New-DarkValues; $values.gateway_native_materials|Add-Member -NotePropertyName $gate -NotePropertyValue $true
  Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
}
foreach ($name in @('legacy_receipt_transition','application_restore_reconciliation')) {
  $values=New-DarkValues; $values.$name=[pscustomobject]@{}
  Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
}
foreach ($mode in @('dormant','snapshot-prepared','RESTORE',$null)) {
  $values=New-DarkValues; $values.development_database_mode=$mode
  Expect-DarkRefusal { Assert-D1RestoreDarkWriterInputs $values }
}
Assert-D1RestoreRecoveryMode ([pscustomobject]@{}) 'development' $false
Assert-D1RestoreRecoveryMode ([pscustomobject]@{baseline_mode='dark-recovery'}) 'development' $true
$script:checks+=2
Expect-DarkRefusal { Assert-D1RestoreRecoveryMode ([pscustomobject]@{}) 'development' $true }
Expect-DarkRefusal { Assert-D1RestoreRecoveryMode ([pscustomobject]@{baseline_mode='dark-recovery'}) 'development' $false }
Expect-DarkRefusal { Assert-D1RestoreRecoveryMode ([pscustomobject]@{baseline_mode='steady-state'}) 'development' $true }
Expect-DarkRefusal { Assert-D1RestoreRecoveryMode ([pscustomobject]@{baseline_mode='unknown'}) 'development' $false }
Expect-DarkRefusal { Assert-D1RestoreRecoveryMode ([pscustomobject]@{baseline_mode='dark-recovery'}) 'staging' $true }

$script:fault=''
function Invoke-AwsJson([string[]]$CommandArguments) {
  $operation=$CommandArguments[0]+' '+$CommandArguments[1]
  if ($script:fault -ceq 'read-failure') { throw 'Synthetic AWS failure' }
  switch ($operation) {
    'events list-rules' { return [pscustomobject]@{Rules=@([pscustomobject]@{State=if($script:fault -ceq 'rule'){'ENABLED'}else{'DISABLED'}})} }
    'lambda list-event-source-mappings' {
      $mapping=[pscustomobject]@{FunctionArn='arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-native';State=if($script:fault -ceq 'mapping'){'Enabled'}else{'Disabled'}}
      if($script:fault -ceq 'mapping-missing'){$mapping.PSObject.Properties.Remove('FunctionArn')}
      if($script:fault -ceq 'mapping-invalid'){$mapping.FunctionArn='invalid'}
      return [pscustomobject]@{EventSourceMappings=@($mapping)}
    }
    'apigatewayv2 get-apis' { return [pscustomobject]@{Items=@([pscustomobject]@{Name='ai-job-apply-development';ApiId='synthetic'})} }
    'apigatewayv2 get-routes' { return [pscustomobject]@{Items=@(if($script:fault -ceq 'route'){[pscustomobject]@{RouteKey='ANY /'}})} }
    'scheduler list-schedules' { return [pscustomobject]@{Schedules=@([pscustomobject]@{Name='ai-job-apply-development-native';GroupName='default';State=if($script:fault -ceq 'schedule'){'ENABLED'}else{'DISABLED'}})} }
    'ecs list-clusters' { return [pscustomobject]@{clusterArns=@(if($script:fault -ceq 'cluster-invalid'){'invalid'}else{'arn:aws:ecs:us-east-2:123456789012:cluster/ai-job-apply-development'})} }
    'ecs list-services' { return [pscustomobject]@{serviceArns=@(if($script:fault -ceq 'service'){'synthetic-service'})} }
    'ecs list-tasks' {
      $index=[array]::IndexOf($CommandArguments,'--desired-status')
      return [pscustomobject]@{taskArns=@(if($script:fault -ceq $CommandArguments[$index+1]){'synthetic-task'})}
    }
    'lambda list-functions' { return [pscustomobject]@{Functions=@([pscustomobject]@{FunctionName='ai-job-apply-development-native-prepare';DurableConfig=[pscustomobject]@{ExecutionTimeout=600}})} }
    'lambda list-durable-executions-by-function' { return [pscustomobject]@{DurableExecutions=@(if($script:fault -ceq 'durable'){'synthetic-execution'})} }
    'sqs list-queues' { return [pscustomobject]@{QueueUrls=@('https://synthetic.invalid/queue')} }
    'sqs get-queue-attributes' {
      $attributes=[pscustomobject]@{ApproximateNumberOfMessages='0';ApproximateNumberOfMessagesNotVisible='0';ApproximateNumberOfMessagesDelayed='0'}
      if ($script:fault -ceq 'missing-count') { $attributes.PSObject.Properties.Remove('ApproximateNumberOfMessagesDelayed') }
      if ($script:fault -in @('ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed')) { $attributes.($script:fault)='1' }
      return [pscustomobject]@{Attributes=$attributes}
    }
    default { throw 'Unexpected synthetic AWS operation' }
  }
}
Assert-D1RestoreDarkWritersStopped
$script:checks++
foreach ($fault in @('rule','mapping','mapping-missing','mapping-invalid','cluster-invalid','route','schedule','service','RUNNING','PENDING','durable',
    'ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed','missing-count','read-failure')) {
  $script:fault=$fault
  Expect-DarkRefusal { Assert-D1RestoreDarkWritersStopped }
}
$script:fault=''
Expect-DarkRefusal { Get-D1RestoreDarkCollection ([pscustomobject]@{}) 'Items' }
Expect-DarkRefusal { Get-D1RestoreDarkCollection ([pscustomobject]@{Items='invalid'}) 'Items' }

$errors=$null
$fixtureAst=[Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot 'staging-postgresql-restore-verifier.tests.ps1'),[ref]$null,[ref]$errors)
$creator=$fixtureAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'New-TestContext'},$true)
Invoke-Expression $creator.Extent.Text
$boundary=Get-D1RestoreManifestBoundary $root
$context=New-TestContext $boundary
$context=($context|ConvertTo-Json -Depth 10).Replace('staging','development')|ConvertFrom-D1RestoreJson
$context|Add-Member -NotePropertyName baseline_mode -NotePropertyValue 'dark-recovery'
Assert-D1RestoreContextBoundary $context $boundary
$script:checks++
$private=Join-Path ([IO.Path]::GetTempPath()) "d3-dark-recovery-$([guid]::NewGuid().ToString('N'))"
$null=New-Item -ItemType Directory -Path $private
try {
  $contextFile=Join-Path $private 'context.json'
  Save-D1RestoreContextFile $context $contextFile $boundary
  $read=Read-D1RestoreContextFile $contextFile $boundary
  Assert-D1RestoreRecoveryMode $read 'development' $true
  $script:checks++
  $read.PSObject.Properties.Remove('baseline_mode')
  Expect-DarkRefusal { Assert-D1RestoreRecoveryMode $read 'development' $true }
  $context.baseline_mode='other'
  Expect-DarkRefusal { Assert-D1RestoreContextBoundary $context $boundary }

  # Run the actual baseline against complete source-derived inputs and synthetic native calls.
  $Environment='development'; $ExpectedAccountId='123456789012'; $StateBucket='synthetic-state'
  $Region='us-east-2'; $environmentDirectory=Join-Path $root 'infrastructure/terraform/environments/development'
  $terraformDataDirectory=$private; $RuntimePlanPath=Join-Path $private 'reviewed.tfplan'
  [IO.File]::WriteAllText($RuntimePlanPath,'synthetic')
  $names=@(Get-ChildItem -LiteralPath $environmentDirectory -File -Filter '*.tf'|ForEach-Object {
    foreach($match in [regex]::Matches((Get-Content $_.FullName -Raw),'(?m)^variable\s+"([a-z0-9_]+)"\s*\{')){$match.Groups[1].Value}
  }|Sort-Object -Unique)
  $known=New-DarkValues
  $variables=[pscustomobject]@{}
  foreach($name in $names) {
    $property=$known.PSObject.Properties[$name]
    $value=if($null -eq $property){$null}else{$property.Value}
    $variables|Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{value=$value})
  }
  $script:baselinePlan=[pscustomobject]@{variables=$variables}
  $script:baselineFault=''; $script:backendChecks=0; $script:planCalls=0; $script:drainCalls=0
  function Assert-DeploymentTerraformCli {}
  function Assert-CurrentAwsCaller {}
  function Assert-DeploymentTerraformBackend {
    param($TerraformDirectory,$DataDirectory,$ExpectedBucket,$ExpectedKey,$ExpectedRegion,$ExpectedKmsKeyArn)
    if($ExpectedBucket -cne 'synthetic-state' -or $ExpectedKey -cne 'platform.tfstate' -or
       $ExpectedRegion -cne 'us-east-2' -or $ExpectedKmsKeyArn -cne 'arn:aws:kms:us-east-2:123456789012:key/synthetic') {throw 'Synthetic backend binding mismatch'}
    $script:backendChecks++
  }
  function Resolve-DeploymentTerraformFile([string]$Path) { return [IO.Path]::GetFullPath($Path) }
  function Read-DeploymentTerraformPlan {
    param($Path,$TerraformDirectory)
    if($Path -ceq $RuntimePlanPath){return $script:baselinePlan}
    $fresh = [pscustomobject]@{
      complete=$true; errored=$false; applyable=$false
      resource_changes=@([pscustomobject]@{change=[pscustomobject]@{actions=@(if($script:baselineFault -ceq 'resource-change'){'update'}else{'no-op'})}})
      output_changes=[pscustomobject]@{synthetic=[pscustomobject]@{actions=@(if($script:baselineFault -ceq 'output-change'){'update'}else{'no-op'})}}
      resource_drift=@(if($script:baselineFault -ceq 'drift'){[pscustomobject]@{address='synthetic'}})
    }
    if($script:baselineFault -match '^(complete|errored|applyable)-(missing|string|wrong)$') {
      $name=$Matches[1]; $fault=$Matches[2]
      if($fault -ceq 'missing'){$fresh.PSObject.Properties.Remove($name)}
      elseif($fault -ceq 'string'){$fresh.$name='false'}
      else{$fresh.$name= -not $fresh.$name}
    }
    return $fresh
  }
  function terraform {
    $script:planCalls++
    $inputArgument=@($args|Where-Object {$_ -clike '-var-file=*'})
    if($inputArgument.Count -ne 1){throw 'Exact typed input file missing'}
    $inputPath=$inputArgument[0].Substring(10)
    $typed=Get-Content -LiteralPath $inputPath -Raw|ConvertFrom-Json
    if($null -ne $typed.application_restore_reconciliation -or $null -ne $typed.job_retention_release -or
       $typed.ingestion_durable_artifact_s3_key -cne '' -or $typed.serverless_runtime_enabled -isnot [bool] -or
       $typed.serverless_runtime_enabled -or $typed.d2_community_runtime.enabled -isnot [bool] -or $typed.d2_community_runtime.enabled){throw 'Typed input file changed exact values'}
    # A real child process must receive valid Terraform expressions. In particular,
    # null objects cannot be silently removed or inherited as empty expressions.
    $childCode=@'
$ErrorActionPreference='Stop'
if($env:TF_VAR_application_restore_reconciliation -cne 'null' -or $env:TF_VAR_job_retention_release -cne 'null'){throw 'Null expression lost'}
if($env:TF_VAR_serverless_runtime_enabled -cne 'false'){throw 'Boolean expression lost'}
# Windows PowerShell 5 cannot propagate empty env values; the explicit var-file
# above preserves that expression for Terraform in either shell.
if($null -ne $env:TF_VAR_ingestion_durable_artifact_s3_key -and $env:TF_VAR_ingestion_durable_artifact_s3_key -cne ''){throw 'Empty string expression changed'}
$object=ConvertFrom-Json $env:TF_VAR_d2_community_runtime
if($object.enabled -isnot [bool] -or $object.enabled){throw 'Object expression lost'}
'@
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
    $priorPreference=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$childOutput=& pwsh -NoProfile -EncodedCommand $encoded 2>&1;$childExit=$LASTEXITCODE}
    finally{$ErrorActionPreference=$priorPreference}
    if($childExit -ne 0){throw "Child environment did not preserve typed Terraform expressions: $childOutput"}
    $global:LASTEXITCODE=if($script:baselineFault -ceq 'plan-failure'){1}else{0}
  }
  function Invoke-AwsJson([string[]]$CommandArguments) {
    if(($CommandArguments[0..1]-join ' ') -cne 's3api get-bucket-encryption'){throw 'Unexpected baseline AWS call'}
    return [pscustomobject]@{ServerSideEncryptionConfiguration=[pscustomobject]@{Rules=@(
      [pscustomobject]@{ApplyServerSideEncryptionByDefault=[pscustomobject]@{SSEAlgorithm='aws:kms';KMSMasterKeyID='arn:aws:kms:us-east-2:123456789012:key/synthetic'}})}}
  }
  function Assert-D1RestoreDarkWritersStopped {$script:drainCalls++}
  $savedInput=$env:TF_VAR_serverless_runtime_enabled
  $variables.ingestion_durable_artifact_s3_key.value=''
  Remove-Item Env:TF_VAR_application_restore_reconciliation -ErrorAction SilentlyContinue
  [Environment]::SetEnvironmentVariable('TF_VAR_job_retention_release','','Process')
  $emptySupported=Test-Path Env:TF_VAR_job_retention_release
  $env:TF_VAR_serverless_runtime_enabled='synthetic-original'
  try {
    $result=Assert-D1RestoreDarkBaseline
    if(-not $result.WritersStopped -or $script:backendChecks -ne 1 -or $script:planCalls -ne 1 -or
       $script:drainCalls -ne 1 -or $env:TF_VAR_serverless_runtime_enabled -cne 'synthetic-original') {throw 'Baseline did not prove or restore exact input/backend/drain boundary'}
    $script:checks++
    if((Test-Path Env:TF_VAR_application_restore_reconciliation) -or
       ($emptySupported -and (-not (Test-Path Env:TF_VAR_job_retention_release) -or $env:TF_VAR_job_retention_release -cne ''))){throw 'Absent and empty original inputs were not restored distinctly'}
    $script:checks++
    foreach($fault in @('resource-change','output-change','drift','plan-failure',
        'complete-missing','complete-string','complete-wrong',
        'errored-missing','errored-string','errored-wrong',
        'applyable-missing','applyable-string','applyable-wrong')) {
      $script:baselineFault=$fault
      Expect-DarkRefusal { Assert-D1RestoreDarkBaseline }
      if($env:TF_VAR_serverless_runtime_enabled -cne 'synthetic-original'){throw 'Baseline failure leaked environment inputs'}
      if((Test-Path Env:TF_VAR_application_restore_reconciliation) -or
         ($emptySupported -and (-not (Test-Path Env:TF_VAR_job_retention_release) -or $env:TF_VAR_job_retention_release -cne ''))){throw 'Failure did not restore absent and empty inputs'}
    }
    $script:baselineFault=''
    $variables.PSObject.Properties.Remove($names[0])
    Expect-DarkRefusal { Assert-D1RestoreDarkBaseline }
  } finally {
    [Environment]::SetEnvironmentVariable('TF_VAR_serverless_runtime_enabled',$savedInput,'Process')
    Remove-Item Env:TF_VAR_job_retention_release -ErrorAction SilentlyContinue
  }
} finally {
  # Only this freshly generated test-owned directory is removed.
  if([IO.Path]::GetFullPath($private).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $private -Recurse -Force
  } else {throw 'Test temporary directory escaped its owned parent'}
}
$guardLog=Join-Path ([IO.Path]::GetTempPath()) "d3-dark-guard-$([guid]::NewGuid().ToString('N')).log"
try {
  $priorPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & pwsh -NoProfile -File (Join-Path $root 'scripts/operate-staging-postgresql-restore.ps1') -DarkRecovery -Help *> $guardLog
    $guardExit=$LASTEXITCODE
  } finally { $ErrorActionPreference=$priorPreference }
  $global:LASTEXITCODE=0
  if($guardExit -eq 0 -or (Get-Content $guardLog -Raw) -notmatch 'restricted to development') {throw 'Staging did not refuse dark mode before help or AWS'}
  $script:checks++
} finally {if(Test-Path -LiteralPath $guardLog){Remove-Item -LiteralPath $guardLog -Force}}
function Copy-DarkObservation([object]$Value){return ConvertFrom-D1RestoreJson (ConvertTo-Json -InputObject $Value -Depth 100)}
function New-DarkObservation {
  $account='123456789012'
  $db=Copy-DarkObservation @{arn="arn:aws:rds:us-east-2:${account}:db:ai-job-apply-development";identifier='ai-job-apply-development';resource_id='db-SYNTHETIC';engine='postgres';backup_retention_period=35;publicly_accessible=$false;storage_encrypted=$true;deletion_protection=$true;multi_az=$false;domain_dns_ips=@();tags=@{};latest_restorable_time='2026-09-01T10:01:00Z';kms_key_id='synthetic-key';vpc_security_group_ids=@('synthetic-private');password=$null}
  $beforeDb=Copy-DarkObservation $db;$beforeDb.domain_dns_ips=$null;$beforeDb.tags=$null;$beforeDb.latest_restorable_time='2026-09-01T10:00:00Z'
  $role=Copy-DarkObservation @{arn="arn:aws:iam::${account}:role/ai-job-apply-development-public-job-projection";id='ai-job-apply-development-public-job-projection';name='ai-job-apply-development-public-job-projection';permissions_boundary='synthetic-boundary';inline_policy=@()}
  $children=@{public_job_lambda='public-job-reader-runtime';public_job_lambda_kms_code_guard='public-job-reader-kms-code-guard';public_job_lambda_vpc_guard='public-job-reader-vpc-code-guard'}
  $key="arn:aws:kms:us-east-2:${account}:key/11111111-1111-1111-1111-111111111111"
  $db.kms_key_id=$key;$beforeDb.kms_key_id=$key
  $resources=@(Copy-DarkObservation @{address='module.platform.aws_kms_key.platform';mode='managed';values=@{arn=$key}});$changes=@();$drift=@()
  foreach($name in @($children.Keys|Sort-Object)){
    $value=Copy-DarkObservation @{name=$children[$name];role=$role.name;policy='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"synthetic:Read","Resource":"synthetic"}]}'}
    $role.inline_policy+=@(Copy-DarkObservation @{name=$value.name;policy=$value.policy})
    $address="module.platform.aws_iam_role_policy.$name"+'[0]'
    $resources+=@(Copy-DarkObservation @{address=$address;mode='managed';values=$value})
    $changes+=@(Copy-DarkObservation @{address=$address;module_address='module.platform';mode='managed';type='aws_iam_role_policy';name=$name;index=0;provider_name='registry.terraform.io/hashicorp/aws';change=@{actions=@('no-op');before=$value;after=$value;after_unknown=@{};before_sensitive=@{};after_sensitive=@{}}})
  }
  $beforeRole=Copy-DarkObservation $role
  ($beforeRole.inline_policy|Where-Object name -CEQ 'public-job-reader-runtime').policy='{"Version":"2012-10-17","Statement":[]}'
  foreach($definition in @(@('aws_db_instance','postgres',$beforeDb,$db),@('aws_iam_role','public_job_lambda',$beforeRole,$role))){
    $type=$definition[0];$name=$definition[1];$before=$definition[2];$after=$definition[3];$address="module.platform.$type.$name"+'[0]'
    $beforeMask=if($type -ceq 'aws_db_instance'){@{password=$true}}else{@{inline_policy=@(@{},@{},@{})}}
    $afterMask=Copy-DarkObservation $beforeMask
    if($type -ceq 'aws_db_instance'){$afterMask|Add-Member domain_dns_ips @();$afterMask|Add-Member tags ([pscustomobject]@{})}
    $record=Copy-DarkObservation @{address=$address;module_address='module.platform';mode='managed';type=$type;name=$name;index=0;provider_name='registry.terraform.io/hashicorp/aws';change=@{actions=@('update');before=$before;after=$after;after_unknown=@{};before_sensitive=$beforeMask;after_sensitive=$afterMask}}
    $drift+=@($record);$resources+=@(Copy-DarkObservation @{address=$address;mode='managed';values=$after})
    $noOp=Copy-DarkObservation $record;$noOp.change.actions=@('no-op');$noOp.change.before=Copy-DarkObservation $after;$noOp.change.before_sensitive=Copy-DarkObservation $afterMask
    $changes+=@($noOp)
  }
  return Copy-DarkObservation @{resource_drift=$drift;resource_changes=$changes;planned_values=@{root_module=@{resources=$resources}}}
}
function Sync-DarkObservation([object]$Plan){
  foreach($record in $Plan.resource_drift){
    $resource=@($Plan.planned_values.root_module.resources|Where-Object address -CEQ $record.address)
    if($resource.Count -eq 1){$resource[0].values=Copy-DarkObservation $record.change.after}
    $owned=@($Plan.resource_changes|Where-Object address -CEQ $record.address)
    if($owned.Count -eq 1){
      $owned[0].change.before=Copy-DarkObservation $record.change.after
      $owned[0].change.after=Copy-DarkObservation $record.change.after
      $owned[0].change.before_sensitive=Copy-DarkObservation $record.change.after_sensitive
      $owned[0].change.after_sensitive=Copy-DarkObservation $record.change.after_sensitive
    }
  }
}
$observation=New-DarkObservation
$original=ConvertTo-DeploymentCanonicalValue $observation
Assert-D1RestoreDarkPlanDrift $observation '123456789012'
if((ConvertTo-DeploymentCanonicalValue $observation) -cne $original){throw 'Dark observations mutated their original plan'}
$script:checks++
foreach($mutation in @(
  {$p.resource_drift+=@(Copy-DarkObservation $p.resource_drift[0])},
  {$p.resource_drift[0].address='module.platform.aws_db_instance.other[0]'},
  {$p.resource_drift[0].change.after.latest_restorable_time='2026-09-01T09:00:00Z'},
  {$p.resource_drift[0].change.after.latest_restorable_time='2099-09-01T10:00:00Z'},
  {$p.resource_drift[0].change.after.latest_restorable_time='not-time'},
  {$p.resource_drift[0].change.after.kms_key_id='other'},
  {$p.resource_drift[0].change.after.vpc_security_group_ids=@('public')},
  {$p.resource_drift[0].change.after.domain_dns_ips=@('127.0.0.1')},
  {$p.resource_drift[0].change.after.tags=Copy-DarkObservation @{New='tag'}},
  {$p.resource_drift[0].change.after.password='synthetic-password'},
  {$p.resource_drift[0].change.after_sensitive.password=$false},
  {$p.resource_drift[0].change.after_sensitive.tags=$true},
  {$p.resource_drift[0].change|Add-Member replace_paths @('identifier')},
  {$p.resource_drift[1].change.after.inline_policy=@()},
  {$p.resource_drift[1].change.after.inline_policy+=@(Copy-DarkObservation $p.resource_drift[1].change.after.inline_policy[0])},
  {$p.resource_drift[1].change.after.inline_policy[0].policy='{}'},
  {$p.resource_drift[1].change.after.permissions_boundary='other'},
  {$p.resource_changes[0].change.actions=@('update')},
  {$p.resource_changes[0].change.after.role='other'},
  {$p.resource_changes[0].change|Add-Member replace_paths @('policy')},
  {$p.resource_changes+=@(Copy-DarkObservation $p.resource_changes[0])},
  {$p.resource_drift[0].mode='data'},
  {$p.resource_drift[0].provider_name='untrusted'}
)){
  $p=Copy-DarkObservation $observation;& $mutation;Sync-DarkObservation $p
  Expect-DarkRefusal {Assert-D1RestoreDarkPlanDrift $p '123456789012'}
}
foreach($field in @('publicly_accessible','storage_encrypted','deletion_protection','multi_az','backup_retention_period','engine','identifier','resource_id','arn')){
  $p=Copy-DarkObservation $observation;$p.resource_drift[0].change.after.$field='invalid'
  Sync-DarkObservation $p
  Expect-DarkRefusal {Assert-D1RestoreDarkPlanDrift $p '123456789012'}
}
foreach($mask in @('false',0,$null,(Copy-DarkObservation @{unknown=$true}))){
  foreach($location in @('drift','owned','child')){
    $p=Copy-DarkObservation $observation
    if($location -ceq 'drift'){$p.resource_drift[0].change.after_unknown=$mask}
    else{$i=if($location -ceq 'child'){0}else{3};$p.resource_changes[$i].change.after_unknown=$mask}
    Expect-DarkRefusal {Assert-D1RestoreDarkPlanDrift $p '123456789012'}
  }
}
$noDrift=Copy-DarkObservation $observation;$noDrift.PSObject.Properties.Remove('resource_drift')
Assert-D1RestoreDarkPlanDrift $noDrift '123456789012';$script:checks++
foreach($i in @(0,4)){
  $p=Copy-DarkObservation $observation;$owned=$p.resource_changes[$i]
  $identity=Copy-DarkObservation @{account_id='123456789012';name=$owned.change.after.name}
  if($owned.type -ceq 'aws_iam_role_policy'){$identity|Add-Member role $owned.change.after.role}
  $owned.change|Add-Member before_identity (Copy-DarkObservation $identity)
  $owned.change|Add-Member after_identity (Copy-DarkObservation $identity)
  Assert-D1RestoreDarkPlanDrift $p '123456789012';$script:checks++
  foreach($badIdentity in @('missing-half','numeric-account','wrong-name','extra-key')){
    $bad=Copy-DarkObservation $p;$change=$bad.resource_changes[$i].change
    switch($badIdentity){
      'missing-half' {$change.PSObject.Properties.Remove('after_identity')}
      'numeric-account' {$change.before_identity.account_id=123456789012;$change.after_identity.account_id=123456789012}
      'wrong-name' {$change.before_identity.name='other';$change.after_identity.name='other'}
      'extra-key' {$change.before_identity|Add-Member unexpected $false;$change.after_identity|Add-Member unexpected $false}
    }
    Expect-DarkRefusal {Assert-D1RestoreDarkPlanDrift $bad '123456789012'}
  }
}
Write-Output "Development dark recovery guards: $script:checks cases passed; synthetic only, no cloud calls."
