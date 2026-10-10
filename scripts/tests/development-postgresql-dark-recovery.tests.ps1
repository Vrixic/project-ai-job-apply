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
    $global:LASTEXITCODE=if($script:baselineFault -ceq 'plan-failure'){1}else{0}
  }
  function Invoke-AwsJson([string[]]$CommandArguments) {
    if(($CommandArguments[0..1]-join ' ') -cne 's3api get-bucket-encryption'){throw 'Unexpected baseline AWS call'}
    return [pscustomobject]@{ServerSideEncryptionConfiguration=[pscustomobject]@{Rules=@(
      [pscustomobject]@{ApplyServerSideEncryptionByDefault=[pscustomobject]@{SSEAlgorithm='aws:kms';KMSMasterKeyID='arn:aws:kms:us-east-2:123456789012:key/synthetic'}})}}
  }
  function Assert-D1RestoreDarkWritersStopped {$script:drainCalls++}
  $savedInput=$env:TF_VAR_serverless_runtime_enabled
  $env:TF_VAR_serverless_runtime_enabled='synthetic-original'
  try {
    $result=Assert-D1RestoreDarkBaseline
    if(-not $result.WritersStopped -or $script:backendChecks -ne 1 -or $script:planCalls -ne 1 -or
       $script:drainCalls -ne 1 -or $env:TF_VAR_serverless_runtime_enabled -cne 'synthetic-original') {throw 'Baseline did not prove or restore exact input/backend/drain boundary'}
    $script:checks++
    foreach($fault in @('resource-change','output-change','drift','plan-failure',
        'complete-missing','complete-string','complete-wrong',
        'errored-missing','errored-string','errored-wrong',
        'applyable-missing','applyable-string','applyable-wrong')) {
      $script:baselineFault=$fault
      Expect-DarkRefusal { Assert-D1RestoreDarkBaseline }
      if($env:TF_VAR_serverless_runtime_enabled -cne 'synthetic-original'){throw 'Baseline failure leaked environment inputs'}
    }
    $script:baselineFault=''
    $variables.PSObject.Properties.Remove($names[0])
    Expect-DarkRefusal { Assert-D1RestoreDarkBaseline }
  } finally { [Environment]::SetEnvironmentVariable('TF_VAR_serverless_runtime_enabled',$savedInput,'Process') }
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
Write-Output "Development dark recovery guards: $script:checks cases passed; synthetic only, no cloud calls."
