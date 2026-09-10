# Generated fixtures only. No Terraform, AWS, Docker, or network commands are executed.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../lib/development-deletion-restore-role.ps1')
$script:checks=0
function Assert-Test([bool]$Value,[string]$Name){$script:checks++;if(-not $Value){throw "Assertion failed: $Name"}}
function Reject([scriptblock]$Action,[string]$Name){$failed=$false;try{$null=& $Action}catch{$failed=$true};Assert-Test $failed $Name}
function Clone([object]$Value){return Copy-RestoreRoleValue $Value}
function Policy([object[]]$Statements){return @{Version='2012-10-17';Statement=$Statements}|ConvertTo-Json -Depth 40 -Compress}
$account='123456789012';$lineage='11111111-1111-1111-1111-111111111111'
$roleAddress='module.platform.aws_iam_role.candidate_deletion_restore[0]'
$policyAddress='module.platform.aws_iam_role_policy.candidate_deletion_restore[0]'
$s3Address='module.platform.aws_vpc_endpoint.candidate_documents_s3[0]'
$secretAddress='module.platform.aws_vpc_endpoint.secretsmanager[0]'
$retained=@{Sid='Retained';Effect='Allow';Action='s3:GetObject';Resource='arn:aws:s3:::synthetic-retained/object'}
function New-Plan([object]$Resources,[bool]$Enabled){
  $records=@(foreach($key in $Resources.Keys){@{address=$key;mode='managed';values=$Resources[$key]}})
  return Clone @{terraform_version='1.16.2';complete=$true;errored=$false;resource_changes=@();resource_drift=@();output_changes=@{};variables=@{
    candidate_deletion_restore_role_enabled=@{value=$Enabled};environment=@{value='development'};
    d2_community_runtime=@{value=@{enabled=$true;maintenance_mode=$false;provider_ids=@('greenhouse');reviewer='unchanged'}}
  };planned_values=@{root_module=@{resources=$records}}}
}
function New-Change([string]$Address,[object]$Before,[object]$After,[string]$Action){
  return Clone @{address=$Address;mode='managed';change=@{before=$Before;after=$After;actions=@($Action);after_unknown=@{}}}
}
function New-Fixture([string]$Stage,[bool]$Enable){
  $resources=@{}
  if($Stage -ceq 'Bootstrap'){
    $off=@{name='ai-job-apply-development-workload-boundary';arn="arn:aws:iam::${account}:policy/ai-job-apply-development-workload-boundary";id='unchanged';policy=(Policy @($retained));tags_all=@{Environment='development'}}
    $on=Clone $off;$on.policy=Policy (@($retained)+@(Get-RestoreRoleBootstrapStatements $account))
    $resources['aws_iam_policy.workload_boundary']=$(if($Enable){$off}else{$on})
    $baseline=New-Plan $resources (-not $Enable)
    $plan=New-Plan $resources $Enable
    $plan.resource_changes=@(New-Change 'aws_iam_policy.workload_boundary' $(if($Enable){$off}else{$on}) $(if($Enable){$on}else{$off}) 'update')
    return @{Baseline=$baseline;Plan=$plan}
  }
  $resources['module.platform.aws_s3_bucket.candidate_deletion_recovery[0]']=@{arn="arn:aws:s3:::ai-job-apply-development-candidate-del-recovery-$account"}
  $resources['module.platform.aws_s3_bucket.candidate_documents[0]']=@{arn="arn:aws:s3:::ai-job-apply-development-candidate-docs-$account"}
  $resources['module.platform.aws_secretsmanager_secret.database_url']=@{arn="arn:aws:secretsmanager:us-east-2:${account}:secret:ai-job-apply/development/database-url-ABCdef"}
  $resources['module.platform.aws_kms_key.platform']=@{arn="arn:aws:kms:us-east-2:${account}:key/11111111-1111-1111-1111-111111111111"}
  $resources['module.platform.aws_cloudwatch_log_group.application']=@{arn="arn:aws:logs:us-east-2:${account}:log-group:/ai-job-apply/development/application"}
  $boundary=Get-RestoreRolePlatformBoundary $resources $account
  $role=Clone @{name='ai-job-apply-development-deletion-restore';name_prefix=$null;path='/';description=$null;max_session_duration=3600;force_detach_policies=$false;permissions_boundary=$boundary.BoundaryArn;assume_role_policy=(Policy $boundary.Trust.Statement);tags=$null;tags_all=@{Project='ai-job-apply';Environment='development';ManagedBy='terraform'}}
  $policy=Clone @{name='candidate-deletion-restore-read-only';name_prefix=$null;role=$role.name;policy=(Policy $boundary.Policy.Statement)}
  $s3off=Clone @{id='vpce-synthetic1';vpc_id='vpc-synthetic';service_name='com.amazonaws.us-east-2.s3';policy=(Policy @($retained))}
  $s3on=Clone $s3off;$s3on.policy=Policy (@($retained)+$boundary.EndpointStatements)
  $secretStatement=@{Sid='ExactLambdaRolesDatabaseSecretOnly';Effect='Allow';Action='secretsmanager:GetSecretValue';Resource=$boundary.SecretArn;Principal='*';Condition=@{ArnEquals=@{'aws:PrincipalArn'=@("arn:aws:iam::${account}:role/ai-job-apply-development-existing")}}}
  $secretOff=Clone @{id='vpce-synthetic2';vpc_id='vpc-synthetic';service_name='com.amazonaws.us-east-2.secretsmanager';policy=(Policy @($secretStatement,$retained))}
  $secretStatement.Condition.ArnEquals.'aws:PrincipalArn'+=@($boundary.RoleArn)
  $secretOn=Clone $secretOff;$secretOn.policy=Policy @($secretStatement,$retained)
  $resources[$s3Address]=$(if($Enable){$s3off}else{$s3on});$resources[$secretAddress]=$(if($Enable){$secretOff}else{$secretOn})
  if(-not $Enable){$resources[$roleAddress]=$role;$resources[$policyAddress]=$policy}
  $baseline=New-Plan $resources (-not $Enable);$plan=New-Plan $resources $Enable
  $plan.resource_changes=@(
    New-Change $roleAddress $(if($Enable){$null}else{$role}) $(if($Enable){$role}else{$null}) $(if($Enable){'create'}else{'delete'})
    New-Change $policyAddress $(if($Enable){$null}else{$policy}) $(if($Enable){$policy}else{$null}) $(if($Enable){'create'}else{'delete'})
    New-Change $s3Address $(if($Enable){$s3off}else{$s3on}) $(if($Enable){$s3on}else{$s3off}) 'update'
    New-Change $secretAddress $(if($Enable){$secretOff}else{$secretOn}) $(if($Enable){$secretOn}else{$secretOff}) 'update'
  )
  return @{Baseline=$baseline;Plan=$plan;Boundary=$boundary}
}
foreach($stageValue in @('Bootstrap','Platform')){
  foreach($enableValue in @($true,$false)){
    $fixture=New-Fixture $stageValue $enableValue
    $result=Assert-RestoreRoleTransitionPlan $fixture.Plan $fixture.Baseline $stageValue $enableValue $account
    Assert-Test ($result.ChangedResources -eq $(if($stageValue -ceq 'Bootstrap'){1}else{4})) "$stageValue exact transition $enableValue"
    foreach($mutate in @(
      {$p.terraform_version='1.9.8'},{$p.complete=$false},{$p.errored=$true},
      {$p.resource_drift=@(@{change=@{actions=@('update')}})},
      {$p.output_changes=Clone @{newOutput=@{actions=@('create')}}},
      {$p.variables.d2_community_runtime.value.maintenance_mode=$true},
      {$p.variables.d2_community_runtime.value.provider_ids=@('lever')},
      {$p.variables.candidate_deletion_restore_role_enabled.value='True'},
      {$p.resource_changes[0].change.actions=@('delete','create')},
      {$p.resource_changes[0].mode='data'},
      {$p.resource_changes+=@(New-Change 'unrelated.resource' $null @{} 'create')},
      {$p.resource_changes[0].change.after_unknown=Clone @{policy=$true}}
    )){
      $p=Clone $fixture.Plan;& $mutate
      Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline $stageValue $enableValue $account} 'reject unrelated or unsafe transition'
    }
    $b=Clone $fixture.Baseline;$b.resource_changes=@(New-Change 'unrelated.resource' @{} @{} 'update')
    Reject {Assert-RestoreRoleTransitionPlan $fixture.Plan $b $stageValue $enableValue $account} 'baseline must be zero drift'
  }
}
$fixture=New-Fixture 'Bootstrap' $true
$raw=Clone $fixture.Baseline;$raw.variables.candidate_deletion_restore_role_enabled.value='false'
$null=Assert-RestoreRoleTransitionPlan $fixture.Plan $raw 'Bootstrap' $true $account
Assert-Test $true 'literal lower-case false from native TF_VAR remains false'
$raw=Clone $fixture.Plan;$raw.variables.candidate_deletion_restore_role_enabled.value='true'
$null=Assert-RestoreRoleTransitionPlan $raw $fixture.Baseline 'Bootstrap' $true $account
Assert-Test $true 'literal lower-case true from native TF_VAR remains true'
foreach($field in @('complete','errored')){
  $p=Clone $fixture.Plan;$p.PSObject.Properties.Remove($field)
  Reject {Assert-RestoreRolePlanEnvelope $p} 'explicit current plan completeness metadata required'
}
foreach($index in 0..1){
  foreach($mutate in @(
    {$s.Action=@('s3:*')},{$s.Resource='*'},{$s.Effect='Deny'},
    {$s.Condition.ArnEquals.'aws:PrincipalArn'='*'},{$s.Sid='Other'},
    {$s.Condition=Clone @{ArnLike=@{'aws:PrincipalArn'="arn:aws:iam::${account}:role/*"}}}
  )){
    $p=Clone $fixture.Plan;$policy=ConvertFrom-Json $p.resource_changes[0].change.after.policy
    $s=$policy.Statement[$index+1];& $mutate;$p.resource_changes[0].change.after.policy=$policy|ConvertTo-Json -Depth 40 -Compress
    Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Bootstrap' $true $account} 'bootstrap SID exact condition and resource'
  }
}
$p=Clone $fixture.Plan;$policy=ConvertFrom-Json $p.resource_changes[0].change.after.policy;$policy.Statement[0].Action='s3:*';$p.resource_changes[0].change.after.policy=$policy|ConvertTo-Json -Depth 40 -Compress
Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Bootstrap' $true $account} 'retained bootstrap statements unchanged'
$fixture=New-Fixture 'Platform' $true
$raw=Clone $fixture.Baseline;$raw.variables.d2_community_runtime.value=$raw.variables.d2_community_runtime.value|ConvertTo-Json -Compress
$null=Assert-RestoreRoleTransitionPlan $fixture.Plan $raw 'Platform' $true $account
Assert-Test $true 'known structured runtime input supports native raw JSON without altering values'
# Real accepted-drift guard and exact reconstruction of the before-refresh state map.
$rdsAddress='module.platform.aws_db_instance.postgres[0]'
$before=Clone @{id='db';latest_restorable_time='2026-09-09T10:00:00Z'}
$after=Clone @{id='db';latest_restorable_time='2026-09-09T10:00:01Z'}
$b=Clone $fixture.Baseline
$b.planned_values.root_module.resources+=@(Clone @{address=$rdsAddress;mode='managed';values=$after})
$b.resource_drift=@(Clone @{address=$rdsAddress;mode='managed';type='aws_db_instance';change=@{actions=@('update');before=$before;after=$after;after_unknown=@{};before_sensitive=@{};after_sensitive=@{}}})
$reconstructed=Get-RestoreRoleBeforeRefreshResources $b
Assert-Test ((ConvertTo-RestoreRoleCanonical $reconstructed[$rdsAddress]) -ceq (ConvertTo-RestoreRoleCanonical $before)) 'accepted forward RDS clock reconstructs exact unrefreshed state'
$bad=Clone $b;$bad.resource_drift[0].change.after.latest_restorable_time='2026-09-09T09:59:59Z'
Reject {Get-RestoreRoleBeforeRefreshResources $bad} 'backward RDS clock rejected'
$bad=Clone $b;$bad.resource_drift[0].change.after.id='other'
Reject {Get-RestoreRoleBeforeRefreshResources $bad} 'RDS identity cannot drift'
$bad=Clone $b;$bad.planned_values.root_module.resources[-1].values.latest_restorable_time='2026-09-09T10:00:02Z'
Reject {Get-RestoreRoleBeforeRefreshResources $bad} 'accepted drift after must equal complete plan-owned resource'
$p=Clone $fixture.Plan;$p.resource_changes[1].change.after.role=$null;$p.resource_changes[1].change.after_unknown=Clone @{role=$true;id=$true}
$null=Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account
Assert-Test $true 'exact new computed role ID is allowed only until live readback'
# Generated fixed-name IAM prefix metadata. No native plan or account values are embedded.
function Reject-RestorePrefix([scriptblock]$Action,[string]$Classification,[string]$Name){
  $actual=$null;try{$null=& $Action}catch{$actual=$_.Exception.Message}
  Assert-Test ($actual -ceq $Classification) $Name
}
$nativePrefix=New-Fixture 'Platform' $true
$nativePrefix.Plan.resource_changes[0].change.after.PSObject.Properties.Remove('name_prefix')
$nativePrefix.Plan.resource_changes[0].change.after_unknown=Clone @{
  arn=$true;create_date=$true;id=$true;inline_policy=$true;managed_policy_arns=$true;name_prefix=$true;unique_id=$true
}
$nativePrefix.Plan.resource_changes[1].change.after.PSObject.Properties.Remove('name_prefix')
$nativePrefix.Plan.resource_changes[1].change.after.PSObject.Properties.Remove('role')
$nativePrefix.Plan.resource_changes[1].change.after_unknown=Clone @{id=$true;name_prefix=$true;role=$true}
$nativePrefixOriginal=ConvertTo-DeploymentCanonicalValue $nativePrefix.Plan
$null=Assert-RestoreRoleTransitionPlan $nativePrefix.Plan $nativePrefix.Baseline 'Platform' $true $account
Assert-Test $true 'native create masks permit only the exact pending fixed-name prefixes and existing computed fields'
Assert-Test ($null -eq $nativePrefix.Plan.resource_changes[1].change.after.PSObject.Properties['role']) 'pending role projection changes only the validation clone, never the original missing field'
$nullRoleBinding=Clone $nativePrefix.Plan
$nullRoleBinding.resource_changes[1].change.after|Add-Member -NotePropertyName role -NotePropertyValue $null
$null=Assert-RestoreRoleTransitionPlan $nullRoleBinding $nativePrefix.Baseline 'Platform' $true $account
Assert-Test ($null -eq $nullRoleBinding.resource_changes[1].change.after.role) 'explicit null binding with a literal true mask remains valid and unmodified'
$invalidRoleMasks=@(
  @{name='missing';present=$false;value=$null},@{name='false';present=$true;value=$false},
  @{name='null';present=$true;value=$null},@{name='string true';present=$true;value='true'},
  @{name='string false';present=$true;value='false'},@{name='empty string';present=$true;value=''},
  @{name='integer zero';present=$true;value=0},@{name='integer one';present=$true;value=1},
  @{name='empty object';present=$true;value=[pscustomobject]@{}},
  @{name='nested object';present=$true;value=[pscustomobject]@{value=$true}},
  @{name='empty array';present=$true;value=@()},@{name='null singleton array';present=$true;value=@($null)},
  @{name='true singleton array';present=$true;value=@($true)},@{name='false singleton array';present=$true;value=@($false)},
  @{name='mixed array';present=$true;value=@($true,$false)}
)
foreach($bindingShape in @('missing','null')){
  foreach($case in $invalidRoleMasks){
    $p=Clone $nativePrefix.Plan
    if($bindingShape -ceq 'null'){$p.resource_changes[1].change.after|Add-Member -NotePropertyName role -NotePropertyValue $null}
    if($case.present){$p.resource_changes[1].change.after_unknown.role=$case.value}
    else{$p.resource_changes[1].change.after_unknown.PSObject.Properties.Remove('role')}
    Reject {
      Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
    } "$bindingShape policy binding rejects $($case.name) mask instead of projecting a role"
  }
}
$wrongRoleBinding=Clone $nativePrefix.Plan
$wrongRoleBinding.resource_changes[1].change.after|Add-Member -NotePropertyName role -NotePropertyValue 'other'
Reject {Assert-RestoreRoleTransitionPlan $wrongRoleBinding $nativePrefix.Baseline 'Platform' $true $account} 'true role mask cannot replace a concrete wrong binding with the fixed role name'
foreach($index in 0..1){
  $p=Clone $nativePrefix.Plan
  $p.resource_changes[$index].change.after|Add-Member -NotePropertyName name_prefix -NotePropertyValue $null
  $null=Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
  Assert-Test $true 'literal pending prefix accepts null as well as omitted native after value'
}
$resolvedPrefix=New-Fixture 'Platform' $true
foreach($index in 0..1){
  $resolvedPrefix.Plan.resource_changes[$index].change.after.name_prefix=''
  $resolvedPrefix.Plan.resource_changes[$index].change.after_unknown=Clone @{name_prefix=$false}
}
Assert-RestoreRoleRecord $resolvedPrefix.Plan.resource_changes[0].change.after $resolvedPrefix.Plan.resource_changes[1].change.after $resolvedPrefix.Boundary
Assert-Test $true 'record validation accepts only typed empty resolved fixed-name prefixes'
$null=Assert-RestoreRoleTransitionPlan $resolvedPrefix.Plan $resolvedPrefix.Baseline 'Platform' $true $account
Assert-Test $true 'explicit false prefix masks accompany known empty prefixes'
$missingPrefix=New-Fixture 'Platform' $true
foreach($index in 0..1){$missingPrefix.Plan.resource_changes[$index].change.after.PSObject.Properties.Remove('name_prefix')}
$null=Assert-RestoreRoleTransitionPlan $missingPrefix.Plan $missingPrefix.Baseline 'Platform' $true $account
Assert-Test $true 'omitted record prefix and omitted unknown mask remain valid for exact fixed names'
$invalidPrefixes=@(
  @{name='nonempty';value='other'},@{name='space';value=' '},@{name='tab';value="`t"},
  @{name='role name is not a prefix';value='ai-job-apply-development-deletion-restore'},
  @{name='policy name is not a prefix';value='candidate-deletion-restore-read-only'},
  @{name='false Boolean';value=$false},@{name='true Boolean';value=$true},
  @{name='integer zero';value=0},@{name='integer one';value=1},@{name='decimal zero';value=0.0},
  @{name='empty object';value=[pscustomobject]@{}},@{name='nested object';value=[pscustomobject]@{value=''}},
  @{name='empty array';value=@()},@{name='null singleton array';value=@($null)},
  @{name='empty-string singleton array';value=@('')},@{name='mixed array';value=@('',$null)}
)
foreach($index in 0..1){
  foreach($case in $invalidPrefixes){
    $p=Clone $resolvedPrefix.Plan
    # Assign the property directly: a helper's pipeline output would erase empty/singleton array types.
    $p.resource_changes[$index].change.after.name_prefix=$case.value
    Reject-RestorePrefix {
      Assert-RestoreRoleRecord $p.resource_changes[0].change.after $p.resource_changes[1].change.after $resolvedPrefix.Boundary
    } 'RestoreRoleRecordRejected' "record rejects $($case.name) prefix on resource $index"
    Reject-RestorePrefix {
      Assert-RestoreRoleTransitionPlan $p $resolvedPrefix.Baseline 'Platform' $true $account
    } 'RestoreRoleRecordRejected' "transition rejects $($case.name) prefix on resource $index"
  }
}
$invalidPrefixMasks=@(
  @{name='null';value=$null},@{name='string true';value='true'},@{name='string false';value='false'},
  @{name='empty string';value=''},@{name='integer zero';value=0},@{name='integer one';value=1},
  @{name='empty object';value=[pscustomobject]@{}},@{name='nested object';value=[pscustomobject]@{value=$true}},
  @{name='empty array';value=@()},@{name='null singleton array';value=@($null)},
  @{name='true singleton array';value=@($true)},@{name='mixed array';value=@($true,$false)}
)
foreach($index in 0..1){
  foreach($case in $invalidPrefixMasks){
    $p=Clone $nativePrefix.Plan
    $p.resource_changes[$index].change.after_unknown.name_prefix=$case.value
    Reject-RestorePrefix {
      Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
    } 'RestoreRolePrefixMetadataRejected' "prefix unknown mask rejects $($case.name) on resource $index"
  }
  $p=Clone $nativePrefix.Plan
  $p.resource_changes[$index].change.after|Add-Member -NotePropertyName name_prefix -NotePropertyValue ''
  Reject-RestorePrefix {
    Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
  } 'RestoreRolePrefixMetadataRejected' 'literal unknown prefix cannot simultaneously contain a concrete value'
  foreach($field in $(if($index -eq 0){@('name','assume_role_policy','permissions_boundary','tags_all','unexpected')}else{@('name','policy','unexpected')})){
    $p=Clone $nativePrefix.Plan
    $p.resource_changes[$index].change.after_unknown|Add-Member -NotePropertyName $field -NotePropertyValue $true
    Reject-RestorePrefix {
      Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
    } 'RestoreRoleUnexpectedUnknown' 'new prefix compatibility does not allow another unknown field'
  }
  foreach($nested in @([pscustomobject]@{name_prefix=$true},@([pscustomobject]@{name_prefix=$true}))){
    $p=Clone $nativePrefix.Plan
    $p.resource_changes[$index].change.after_unknown|Add-Member -NotePropertyName nested -NotePropertyValue $nested
    Reject-RestorePrefix {
      Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
    } 'RestoreRoleUnexpectedUnknown' 'a nested prefix path is not the exact permitted computed field'
  }
}
foreach($index in 2..3){
  $p=Clone $nativePrefix.Plan
  $p.resource_changes[$index].change.after_unknown=Clone @{name_prefix=$true}
  Reject-RestorePrefix {
    Assert-RestoreRoleTransitionPlan $p $nativePrefix.Baseline 'Platform' $true $account
  } 'RestoreRoleUnexpectedUnknown' 'endpoint updates receive no prefix unknown allowance'
}
foreach($stageValue in @('Bootstrap','Platform')){
  $prefixDisable=New-Fixture $stageValue $false
  $prefixDisable.Plan.resource_changes[0].change.after_unknown=Clone @{name_prefix=$true}
  Reject-RestorePrefix {
    Assert-RestoreRoleTransitionPlan $prefixDisable.Plan $prefixDisable.Baseline $stageValue $false $account
  } 'RestoreRoleUnexpectedUnknown' 'Disable receives no prefix unknown allowance'
}
Assert-Test ((ConvertTo-DeploymentCanonicalValue $nativePrefix.Plan) -ceq $nativePrefixOriginal) 'prefix validation never rewrites the original generated native plan'
# BEGIN restore-role computed-policy observation regressions. Generated, never cloud evidence.
. (Join-Path $PSScriptRoot '../lib/development-gateway-release-guards.ps1')
function New-ObservationFixture {
  $source=New-Fixture 'Platform' $false
  $plan=Clone $source.Baseline
  $plan|Add-Member -NotePropertyName applyable -NotePropertyValue $false
  $map=Get-RestoreRoleResourceMap $plan.planned_values.root_module
  $role=Clone $map[$roleAddress]
  $role.name_prefix=''
  foreach($entry in @{
    arn=$source.Boundary.RoleArn;id='ai-job-apply-development-deletion-restore';unique_id='AROASYNTHETIC000000000';
    create_date='2026-09-10T03:00:00.000+0000';managed_policy_arns=@();inline_policy=@()
  }.GetEnumerator()){$role|Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value}
  $role.tags=Clone @{}
  $child=Clone $map[$policyAddress]
  $child.name_prefix=''
  $child|Add-Member -NotePropertyName id -NotePropertyValue ($role.name+':'+$child.name)
  $before=Clone $role
  $role.inline_policy=@(Clone @{name=$child.name;policy=$child.policy})
  $drift=Clone @{
    address=$roleAddress;module_address='module.platform';mode='managed';type='aws_iam_role';name='candidate_deletion_restore';index=0;provider_name='registry.terraform.io/hashicorp/aws';
    change=@{actions=@('update');before=$before;after=$role;after_unknown=@{};before_sensitive=@{inline_policy=@();managed_policy_arns=@();tags=@{}};after_sensitive=@{inline_policy=@(@{});managed_policy_arns=@();tags=@{}}}
  }
  foreach($resource in $plan.planned_values.root_module.resources){
    if($resource.address -ceq $roleAddress){$resource.values=$role}
    if($resource.address -ceq $policyAddress){$resource.values=$child}
  }
  $roleChange=Clone $drift;$roleChange.change.actions=@('no-op');$roleChange.change.before=$role
  $roleChange.change.before_sensitive=Clone $drift.change.after_sensitive
  $childChange=Clone $roleChange;$childChange.address=$policyAddress;$childChange.type='aws_iam_role_policy'
  $childChange.change=Clone @{actions=@('no-op');before=$child;after=$child;after_unknown=@{};before_sensitive=@{};after_sensitive=@{}}
  $plan.resource_changes=@($roleChange,$childChange);$plan.resource_drift=@($drift)
  return @{Plan=$plan;Before=$before;Boundary=$source.Boundary}
}
$observation=New-ObservationFixture
$originalObservation=ConvertTo-DeploymentCanonicalValue $observation.Plan
Assert-RestoreRolePlanEnvelope $observation.Plan -ZeroDrift
$null=Assert-RetainedGatewayBaselinePlan $observation.Plan @($observation.Plan.variables.PSObject.Properties.Name)
$reconstructed=Get-RestoreRoleBeforeRefreshResources $observation.Plan
Assert-Test ((ConvertTo-DeploymentCanonicalValue $reconstructed[$roleAddress]) -ceq (ConvertTo-DeploymentCanonicalValue $observation.Before)) 'role Verify restores exact raw before-refresh role values'
Assert-Test ((ConvertTo-DeploymentCanonicalValue $observation.Plan) -ceq $originalObservation) 'observation never rewrites original plan or timestamp strings'
$raw=Clone $observation.Plan;$raw.variables.candidate_deletion_restore_role_enabled.value='true'
Assert-RestoreRolePlanEnvelope $raw -ZeroDrift
Assert-Test $true 'native exact string true is accepted for observed enabled role'
$same=Clone $observation.Plan
$same.resource_drift[0].change.before_sensitive=Clone @{}
$same.resource_drift[0].change.after_sensitive=Clone @{}
$same.resource_changes[0].change.before_sensitive=Clone @{}
$same.resource_changes[0].change.after_sensitive=Clone @{}
Assert-RestoreRolePlanEnvelope $same -ZeroDrift
Assert-Test $true 'unchanged empty sensitivity is accepted without invented metadata'
$rdsObservation=Clone $observation.Plan
$rdsBefore=Clone @{id='db';latest_restorable_time='2026-09-10T03:00:00Z'}
$rdsAfter=Clone @{id='db';latest_restorable_time='2026-09-10T03:01:00Z'}
$rdsObservation.planned_values.root_module.resources+=@(Clone @{address=$rdsAddress;mode='managed';values=$rdsAfter})
$rdsObservation.resource_drift+=@(Clone @{address=$rdsAddress;mode='managed';type='aws_db_instance';change=@{actions=@('update');before=$rdsBefore;after=$rdsAfter;after_unknown=@{};before_sensitive=@{};after_sensitive=@{}}})
$reconstructed=Get-RestoreRoleBeforeRefreshResources $rdsObservation
Assert-Test ((ConvertTo-DeploymentCanonicalValue $reconstructed[$rdsAddress]) -ceq (ConvertTo-DeploymentCanonicalValue $rdsBefore)) 'unrelated accepted RDS drift still follows unchanged generic guard'
$mutations=@(
  {$p.variables.candidate_deletion_restore_role_enabled.value=$false},
  {$p.variables.candidate_deletion_restore_role_enabled.value='True'},
  {$p.variables.candidate_deletion_restore_role_enabled.value=1},
  {$p.variables.candidate_deletion_restore_role_enabled|Add-Member extra $true},
  {$p.variables.PSObject.Properties.Remove('candidate_deletion_restore_role_enabled')},
  {$p.terraform_version='1.9.8'},
  {$p.resource_drift+=@(Clone $p.resource_drift[0])},
  {$d.address='module.platform.aws_iam_role.other[0]'},{$d.module_address='module.other'},
  {$d.mode='data'},{$d.type='aws_iam_role_policy'},{$d.name='other'},{$d.index='0'},{$d.index=1},
  {$d.provider_name='other'},{$d|Add-Member previous_address 'other'},
  {$d.change|Add-Member importing (Clone @{id='other'})},
  {$d.change|Add-Member replace_paths @()},
  {$d.change.actions=@('create')},{$d.change.actions='update'},{$d.change.actions=@('update','delete')},
  {$d.change.after_unknown=Clone @{inline_policy=$true}},{$d.change.after_unknown=$false},
  {$d.change.before.inline_policy=$null},{$d.change.before.inline_policy=@(Clone $d.change.after.inline_policy[0])},
  {$d.change.after.inline_policy=@()},{$d.change.after.inline_policy+=@(Clone $d.change.after.inline_policy[0])},
  {$d.change.after.inline_policy[0]|Add-Member extra 'value'},
  {$d.change.after.inline_policy[0].name='other'},{$d.change.after.inline_policy[0].policy='{}'},
  {$d.change.after.path='/other/'},{$d.change.after.permissions_boundary='other'},
  {$d.change.after.unique_id='other'},{$d.change.after.create_date='2026-09-10T03:00:00Z'},
  {$d.change.after.tags=Clone @{Other='value'}},{$d.change.after|Add-Member unexpected 'value'},
  {$d.change.before_sensitive.inline_policy=$null},{$d.change.after_sensitive.inline_policy=@($true)},
  {$d.change.after_sensitive.inline_policy=@(Clone @{policy=$false})},
  {$d.change.after_sensitive.tags=Clone @{unexpected=$false}},
  {$d.change.before_sensitive='false'},{$d.change.after_sensitive=$null},
  {$p.resource_changes=@($p.resource_changes[0])},{$p.resource_changes+=@(Clone $p.resource_changes[1])},
  {$p.resource_changes[1].change.actions=@('update')},
  {$p.resource_changes[0].change.before=Clone $d.change.before},
  {$p.resource_changes[0].change.after_unknown=Clone @{arn=$true}},
  {$p.resource_changes[1].change.before_sensitive=Clone @{policy=$true}},
  {$p.resource_changes[1].change.after_sensitive=Clone @{other=$false}},
  {$p.resource_changes[1].change.after.role='other'},
  {$p.resource_changes[0].provider_name='other'},
  {$p.planned_values.root_module.resources=@($p.planned_values.root_module.resources|Where-Object address -CNE $policyAddress)},
  {$p.planned_values.root_module.resources+=@(Clone @($p.planned_values.root_module.resources|Where-Object address -CEQ $policyAddress)[0])},
  {$p.output_changes=Clone @{unexpected=@{actions=@('create')}}},
  {$p.resource_drift+=@(Clone @{address='module.platform.aws_iam_role.outbox_starter[0]';mode='managed';type='aws_iam_role';change=$d.change})}
)
foreach($mutate in $mutations){
  $p=Clone $observation.Plan;$d=$p.resource_drift[0];& $mutate
  Reject {Assert-RestoreRolePlanEnvelope $p -ZeroDrift} 'restore observation rejects unrelated value, authority, action, or metadata'
  Reject {Assert-RetainedGatewayBaselinePlan $p @($p.variables.PSObject.Properties.Name)} 'canonical baseline uses same strict observation guard'
}
$broadened=Clone $observation.Plan
$badPolicy=ConvertFrom-Json $broadened.resource_drift[0].change.after.inline_policy[0].policy
$badPolicy.Statement[0].Action=@('*');$badPolicy=$badPolicy|ConvertTo-Json -Depth 40 -Compress
foreach($resource in $broadened.planned_values.root_module.resources){
  if($resource.address -ceq $policyAddress){$resource.values.policy=$badPolicy}
  if($resource.address -ceq $roleAddress){$resource.values.inline_policy[0].policy=$badPolicy}
}
$broadened.resource_drift[0].change.after.inline_policy[0].policy=$badPolicy
foreach($change in $broadened.resource_changes){
  if($change.type -ceq 'aws_iam_role_policy'){$change.change.before.policy=$badPolicy;$change.change.after.policy=$badPolicy}
  else{$change.change.before.inline_policy[0].policy=$badPolicy;$change.change.after.inline_policy[0].policy=$badPolicy}
}
Reject {Assert-RestoreRolePlanEnvelope $broadened -ZeroDrift} 'matching child and echo cannot broaden the independently compiled read-only policy'
$removal=New-Fixture 'Platform' $false
$removal.Baseline=Clone $observation.Plan
$removal.Plan.planned_values.root_module.resources=@($removal.Plan.planned_values.root_module.resources|Where-Object {$_.address -cnotin @($roleAddress,$policyAddress)})
$removal.Plan|Add-Member prior_state (Clone @{values=@{root_module=$observation.Plan.planned_values.root_module}})
$removal.Plan.resource_drift=Clone $observation.Plan.resource_drift
foreach($index in 0..1){
  $record=Clone $observation.Plan.resource_changes[$index]
  $record.change.actions=@('delete');$record.change.after=$null;$record.change.after_unknown=$false;$record.change.after_sensitive=$false
  $removal.Plan.resource_changes[$index]=$record
}
$null=Assert-RestoreRoleTransitionPlan $removal.Plan $removal.Baseline 'Platform' $false $account
Assert-Test $true 'exact Platform Disable binds refreshed prior role and policy without persisting the echo'
Assert-Test ($removal.Plan.resource_changes[0].change.before.name_prefix -is [string] -and
  $removal.Plan.resource_changes[0].change.before.name_prefix.Length -eq 0 -and
  $removal.Plan.resource_changes[1].change.before.name_prefix -is [string] -and
  $removal.Plan.resource_changes[1].change.before.name_prefix.Length -eq 0) 'Verify observation and exact Disable retain both resolved empty prefixes'
Reject {Assert-RestoreRolePlanEnvelope $removal.Plan} 'removal observation unavailable outside explicit Platform Disable'
$bad=Clone $removal.Plan;$bad.resource_changes[0].change.before.unique_id='other'
Reject {Assert-RestoreRoleTransitionPlan $bad $removal.Baseline 'Platform' $false $account} 'delete before values cannot substitute refreshed role identity'
$bad=Clone $removal.Plan;$bad.resource_changes[1].change.actions=@('update')
Reject {Assert-RestoreRoleTransitionPlan $bad $removal.Baseline 'Platform' $false $account} 'removal observation cannot authorize a policy update'
$bad=Clone $removal.Plan;$bad.prior_state.values.root_module.resources=@($bad.prior_state.values.root_module.resources|Where-Object address -CNE $policyAddress)
Reject {Assert-RestoreRoleTransitionPlan $bad $removal.Baseline 'Platform' $false $account} 'removal requires complete refreshed prior child ownership'
Assert-Test ((ConvertTo-DeploymentCanonicalValue $observation.Plan) -ceq $originalObservation) 'all rejection and removal checks preserve original evidence'
# END restore-role computed-policy observation regressions.
foreach($mutate in @(
  {$r.permissions_boundary='wrong'},{$r.path='/other/'},{$r.name='other'},{$r.force_detach_policies='false'},
  {$r.max_session_duration=7200},{$r.name_prefix='other'},{$r.tags_all.Environment='staging'},
  {$r|Add-Member -NotePropertyName managed_policy_arns -NotePropertyValue @('arn:aws:iam::aws:policy/AdministratorAccess')},
  {$r|Add-Member -NotePropertyName unexpected -NotePropertyValue 'value'},
  {$r.assume_role_policy=Policy @(@{Effect='Allow';Action='sts:AssumeRole';Principal=@{Service='ecs-tasks.amazonaws.com'}})}
)){
  $p=Clone $fixture.Plan;$r=$p.resource_changes[0].change.after;& $mutate
  Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account} 'role entire identity and trust'
}
for($index=0;$index -lt 9;$index++){
  foreach($mutate in @({$s.Action=@('*')},{$s.Resource='*'},{$s.Sid='Wrong'})){
    $p=Clone $fixture.Plan;$policy=ConvertFrom-Json $p.resource_changes[1].change.after.policy;$s=$policy.Statement[$index]
    if($index -eq 1 -and $mutate.ToString() -eq '$s.Resource=''*'''){continue}
    & $mutate;$p.resource_changes[1].change.after.policy=$policy|ConvertTo-Json -Depth 40 -Compress
    Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account} 'entire restore inline permission policy'
  }
}
foreach($index in 2..3){
  $p=Clone $fixture.Plan;$p.resource_changes[$index].change.after.vpc_id='vpc-other'
  Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account} 'endpoint attributes preserved'
  $p=Clone $fixture.Plan;$policy=ConvertFrom-Json $p.resource_changes[$index].change.after.policy;$policy.Statement+=@(Clone @{Sid='Extra';Effect='Allow';Action='*';Resource='*';Principal='*'});$p.resource_changes[$index].change.after.policy=$policy|ConvertTo-Json -Depth 40 -Compress
  Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account} 'endpoint no unrelated permission'
}
foreach($index in 1..3){
  $p=Clone $fixture.Plan;$policy=ConvertFrom-Json $p.resource_changes[2].change.after.policy;$policy.Statement[$index].Condition.ArnEquals.'aws:PrincipalArn'='*';$p.resource_changes[2].change.after.policy=$policy|ConvertTo-Json -Depth 40 -Compress
  Reject {Assert-RestoreRoleTransitionPlan $p $fixture.Baseline 'Platform' $true $account} 'every S3 read restricted to exact restore principal'
}
foreach($version in @('1.9.8','1.16.2')){$null=Assert-RestoreRoleStateIdentity (Clone @{terraform_version=$version;lineage=$lineage;serial=3}) $lineage 3;Assert-Test $true 'supported historical state identity'}
foreach($serial in @('3',3.5,$true,4,-1)){
  Reject {Assert-RestoreRoleStateIdentity (Clone @{terraform_version='1.16.2';lineage=$lineage;serial=$serial}) $lineage 3} 'serial exact integer'
}
Reject {Assert-RestoreRoleUnknowns (Clone @{nested=@(@{policy=$true})})} 'nested unknown policy'

# Pure completed-drill binding uses generated metadata, never candidate content.
$config=Clone @{accountId=$account;restoreContextSha256=('c'*64);sourceIdentifier='ai-job-apply-development';sourceDbiResourceId='db-SOURCE';sourceBoundarySha256=('a'*64);targetIdentifier='ai-job-apply-development-restore-synthetic';targetDbiResourceId='db-TARGET';targetBoundarySha256=('b'*64);issuedAt='2026-09-09T10:00:00.000Z'}
$context=Clone @{source_identifier=$config.sourceIdentifier;source_dbi_resource_id=$config.sourceDbiResourceId;source_boundary_sha256=$config.sourceBoundarySha256;target_identifier=$config.targetIdentifier;target_dbi_resource_id=$config.targetDbiResourceId;target_boundary_sha256=$config.targetBoundarySha256;target_boundary_authenticated=$true;verified=$true;source_resource_arn="arn:aws:rds:us-east-2:${account}:db:ai-job-apply-development";target_resource_arn="arn:aws:rds:us-east-2:${account}:db:$($config.targetIdentifier)"}
$prep=Clone @{accountId=$account;roleBoundary=@{roleArn="arn:aws:iam::${account}:role/ai-job-apply-development-deletion-restore"}}
$journal=Clone @{schemaVersion=1;status='started';startedAt='2026-09-09T10:10:00.000Z';preparationSha256=('d'*64)}
$now=[datetimeoffset]::Parse('2026-09-09T10:15:30Z')
Assert-RestoreRoleCleanupEvidence $prep $config $context $journal ('d'*64) ('c'*64) $account $now
Assert-Test $true 'completed cleanup exact 330 second boundary'
foreach($name in @('sourceIdentifier','sourceDbiResourceId','sourceBoundarySha256','targetIdentifier','targetDbiResourceId','targetBoundarySha256','restoreContextSha256')){
  $bad=Clone $config;$bad.$name='wrong'
  Reject {Assert-RestoreRoleCleanupEvidence $prep $bad $context $journal ('d'*64) ('c'*64) $account $now} 'exact restore target and context binding'
}
Reject {Assert-RestoreRoleCleanupEvidence $prep $config $context $journal ('d'*64) ('c'*64) $account ($now.AddSeconds(-1))} 'cleanup drain incomplete'
$bad=Clone $journal;$bad.preparationSha256='wrong'
Reject {Assert-RestoreRoleCleanupEvidence $prep $config $context $bad ('d'*64) ('c'*64) $account $now} 'journal preparation substitution'

# Extract only the read-only deactivation function; its AWS command seam is always mocked.
$operator=Join-Path $PSScriptRoot '../operate-development-deletion-restore-role.ps1'
$parseErrors=$null;$tokens=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($operator,[ref]$tokens,[ref]$parseErrors)
Assert-Test (@($parseErrors).Count -eq 0) 'operator parses'
$definition=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-RestoreRoleDeactivation'},$true)
Invoke-Expression $definition.Extent.Text
function Invoke-RestoreRoleAws {
  param([string[]]$Arguments,[switch]$AllowAbsent)
  $script:awsCalls++
  switch($Arguments[0]){'iam'{return $script:liveRole}'lambda'{return @{Functions=$script:functions}}'rds'{return @{DBInstances=$script:databases}}default{throw 'Unexpected mock command'}}
}
$Stage='Platform';$Transition='Disable';$CleanupMode='UnusedRole';$ExpectedAccountId=$account;$ExpectedStateLineage=$lineage;$ExpectedStateSerial=10
$prior=Clone @{stage='Platform';enabled=$true;lineage=$lineage;serial=8}
$script:awsCalls=0;$script:liveRole=$null;$script:functions=@();$script:databases=@()
Assert-RestoreRoleDeactivation
Assert-Test ($script:awsCalls -eq 2) 'unused rollback requires no fabricated replay and exact live inventories'
$script:functions=@(@{Role="arn:aws:iam::${account}:role/ai-job-apply-development-deletion-restore";FunctionName='other';Version='2'})
Reject {Assert-RestoreRoleDeactivation} 'any version referencing exact role blocks rollback'
$script:functions=@(@{Role='other';FunctionName=('ai-job-apply-development-replay-'+('a'*32));Version='1'})
Reject {Assert-RestoreRoleDeactivation} 'temporary named executor blocks rollback even changed role'
$script:functions=@();$script:databases=@(@{DBInstanceIdentifier='ai-job-apply-development-restore-synthetic'})
Reject {Assert-RestoreRoleDeactivation} 'restore target still present'
$script:databases=@();$prior.lineage='wrong'
Reject {Assert-RestoreRoleDeactivation} 'activation receipt lineage binds same platform state'
$prior.lineage=$lineage;$prior.enabled=$false
Reject {Assert-RestoreRoleDeactivation} 'unused rollback needs activation verification'
$Stage='Bootstrap'
Assert-RestoreRoleDeactivation
Assert-Test $true 'bootstrap inverse only after platform role absent'
$prior=Clone @{stage='Bootstrap';enabled=$true;lineage=$lineage;serial=8}
Assert-RestoreRoleDeactivation
Assert-Test $true 'bootstrap-only activation can roll back with genuine own activation receipt'
$CleanupMode='None'
Reject {Assert-RestoreRoleDeactivation} 'bootstrap-only rollback explicitly declares unused role'
$CleanupMode='UnusedRole'
$script:liveRole=@{Role=@{RoleName='present'}}
Reject {Assert-RestoreRoleDeactivation} 'bootstrap cannot revoke boundary while role remains'

$definition=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-RestoreRoleBackendProtection'},$true)
Invoke-Expression $definition.Extent.Text
function Invoke-RestoreRoleAws {
  param([string[]]$Arguments,[switch]$AllowAbsent)
  Assert-Test (($Arguments -join '|').Contains("--expected-bucket-owner|$account")) 'every backend protection read binds exact owner'
  switch($Arguments[1]){
    'get-bucket-location'{return @{LocationConstraint=$script:location}}
    'get-bucket-versioning'{return @{Status=$script:versioning}}
    'get-public-access-block'{return @{PublicAccessBlockConfiguration=$script:public}}
    'get-bucket-encryption'{return @{ServerSideEncryptionConfiguration=@{Rules=@(@{ApplyServerSideEncryptionByDefault=@{SSEAlgorithm='aws:kms';KMSMasterKeyID=$script:encryption}})}}}
    'head-object'{Assert-Test (($Arguments -join '|').Contains("--key|$stateKey")) 'exact state object key';return $script:stateObject}
    default{throw 'Unexpected backend mock command'}
  }
}
$StateBucket='synthetic-state';$stateKey='platform.tfstate';$StateKmsKeyArn="arn:aws:kms:us-east-2:${account}:key/11111111-1111-1111-1111-111111111111"
$script:location='us-east-2';$script:versioning='Enabled';$script:encryption=$StateKmsKeyArn
$script:public=Clone @{BlockPublicAcls=$true;IgnorePublicAcls=$true;BlockPublicPolicy=$true;RestrictPublicBuckets=$true}
$script:stateObject=Clone @{ServerSideEncryption='aws:kms';SSEKMSKeyId=$StateKmsKeyArn;VersionId='synthetic-version'}
Assert-RestoreRoleBackendProtection
Assert-Test $true 'exact protected state bucket and object accepted'
$script:versioning='Suspended';Reject {Assert-RestoreRoleBackendProtection} 'suspended state versioning';$script:versioning='Enabled'
$script:location='us-east-1';Reject {Assert-RestoreRoleBackendProtection} 'wrong backend region';$script:location='us-east-2'
$script:encryption='wrong';Reject {Assert-RestoreRoleBackendProtection} 'wrong bucket encryption';$script:encryption=$StateKmsKeyArn
foreach($key in @('BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets')){
  $script:public.$key='true';Reject {Assert-RestoreRoleBackendProtection} 'strict true state public-block flag';$script:public.$key=$true
}
$script:stateObject.VersionId='null';Reject {Assert-RestoreRoleBackendProtection} 'unversioned state object';$script:stateObject.VersionId='synthetic-version'
$script:stateObject.SSEKMSKeyId='wrong';Reject {Assert-RestoreRoleBackendProtection} 'wrong exact state object KMS'

$definition=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Set-RestoreRoleInputs'},$true)
Invoke-Expression $definition.Extent.Text
# Mock only Env assignment, keeping tests from changing this process's deployment environment.
function Set-Item {param([string]$Path,[object]$Value);$script:assignments[$Path]=$Value}
$script:assignments=@{}
$rawD2='{"enabled":true,"maintenance_mode":false,"providers":["greenhouse"]}'
Set-RestoreRoleInputs (Clone @{d2_community_runtime=$rawD2;candidate_deletion_restore_role_enabled=$false;synthetic_scalar='false'})
Assert-Test ($script:assignments['Env:TF_VAR_d2_community_runtime'] -ceq $rawD2) 'retained structured raw input bytes preserved'
Assert-Test ($script:assignments['Env:TF_VAR_candidate_deletion_restore_role_enabled'] -ceq 'false') 'false never truthiness-coerced'
Assert-Test ($script:assignments['Env:TF_VAR_synthetic_scalar'] -ceq 'false') 'unrelated raw scalar preserved'
Remove-Item Function:Set-Item

$source=[IO.File]::ReadAllText($operator)
Assert-Test ($source.Contains("if(`$Action -ceq 'Apply' -and -not `$Execute)")) 'explicit Apply authorization'
Assert-Test ($source -notmatch '(?i)AllowHistorical|lock=false|operate-bootstrap-workload-boundary|terraform destroy') 'no legacy write or lock bypass'
Assert-Test ($source -match "Assert-RestoreRoleFileBindings \`$bindings\s+\`$null=Invoke-RestoreRoleTerraform @\('apply','-input=false','-lock-timeout=5m',\`$PlanPath\)") 'late hashes directly precede exact saved plan apply'
Assert-Test ($source.Contains('RestoreRolePriorApplyAttemptRequiresIndependentRecovery')) 'ambiguous prior apply never blindly retried'
Assert-Test ($source.Contains('Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $ExpectedStateLineage $ExpectedStateSerial')) 'late exact state serial checked'
Assert-Test ($source.Contains('$bindings+=@{path=$verifyPath;sha256=$verifyHash}')) 'verification plan bytes checked again before receipt'

# Generated exact local files only; cleanup is scoped and no user artifact is read.
$testRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.tmp/restore-role-guards'))
$testDirectory=Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $testDirectory -Force
try{
  $file=Join-Path $testDirectory 'synthetic.json';[IO.File]::WriteAllText($file,'synthetic-original')
  $binding=@{path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
  Assert-RestoreRoleFileBindings @($binding);Assert-Test $true 'exact reviewed file accepted'
  Reject {Assert-RestoreRoleFileBindings @($binding,$binding)} 'duplicate binding rejected'
  [IO.File]::WriteAllText($file,'synthetic-substitution')
  Reject {Assert-RestoreRoleFileBindings @($binding)} 'late file substitution rejected'
}finally{
  $resolved=[IO.Path]::GetFullPath($testDirectory)
  if([IO.Path]::GetDirectoryName($resolved) -cne $testRoot){throw 'Unsafe test cleanup'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output "Development deletion restore-role guards: $script:checks assertions passed (generated fixtures; no cloud calls)."
