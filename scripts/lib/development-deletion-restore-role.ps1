Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'deployment-operator-guards.ps1')
. (Join-Path $PSScriptRoot 'terraform-toolchain.ps1')
. (Join-Path $PSScriptRoot 'development-document-dark-guards.ps1')

function Get-RestoreRoleProperty {
  param([AllowNull()][object]$Value, [string]$Name, [AllowNull()][object]$Default = $null)
  if ($null -eq $Value) { return $Default }
  if ($Value -is [Collections.IDictionary]) {
    if ($Value.Contains($Name)) { return $Value[$Name] }; return $Default
  }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $Default }; return $property.Value
}
function Copy-RestoreRoleValue {
  param([object]$Value)
  return ConvertFrom-DevelopmentDocumentJson -Json (ConvertTo-Json -InputObject $Value -Depth 80 -Compress)
}
function ConvertTo-RestoreRoleCanonical {
  param([AllowNull()][object]$Value)
  return ConvertTo-DeploymentCanonicalValue -Value $Value -SortArrays
}
function ConvertFrom-RestoreRolePolicy {
  param([object]$Value)
  if ($Value -is [string]) {
    try { $Value = ConvertFrom-Json -InputObject ([Uri]::UnescapeDataString($Value)) -ErrorAction Stop }
    catch { throw 'RestoreRolePolicyJsonRejected' }
  }
  return Copy-RestoreRoleValue $Value
}
function ConvertTo-RestoreRolePolicyCanonical {
  param([object]$Value)
  $policy = ConvertFrom-RestoreRolePolicy $Value
  foreach ($statement in @($policy.Statement)) {
    foreach ($name in @('Action','Resource')) {
      $property = $statement.PSObject.Properties[$name]
      if ($null -ne $property) { $property.Value = @($property.Value) }
    }
    $principal = Get-RestoreRoleProperty $statement 'Principal'
    if ($principal -is [pscustomobject]) {
      foreach ($property in $principal.PSObject.Properties) { $property.Value = @($property.Value) }
    }
    $condition = Get-RestoreRoleProperty $statement 'Condition'
    if ($condition -is [pscustomobject]) {
      foreach ($operator in $condition.PSObject.Properties) {
        foreach ($property in $operator.Value.PSObject.Properties) { $property.Value = @($property.Value) }
      }
    }
  }
  return ConvertTo-RestoreRoleCanonical $policy
}
function Assert-RestoreRolePolicyEqual {
  param([object]$Actual, [object]$Expected)
  if ((ConvertTo-RestoreRolePolicyCanonical $Actual) -cne (ConvertTo-RestoreRolePolicyCanonical $Expected)) {
    throw 'RestoreRolePolicyMismatch'
  }
}
function Get-RestoreRoleResourceMap {
  param([object]$Module)
  $map = @{}
  function Add-RestoreRoleModule([object]$Current) {
    foreach ($resource in @(Get-RestoreRoleProperty $Current 'resources' @())) {
      if ($resource.mode -cne 'managed') { continue }
      if ($map.ContainsKey($resource.address)) { throw 'RestoreRoleDuplicateResource' }
      $map[$resource.address] = $resource.values
    }
    foreach ($child in @(Get-RestoreRoleProperty $Current 'child_modules' @())) { Add-RestoreRoleModule $child }
  }
  Add-RestoreRoleModule $Module
  return $map
}
function Get-RestoreRoleResource {
  param([Collections.IDictionary]$Resources, [string]$Address)
  if (-not $Resources.Contains($Address)) { throw 'RestoreRoleRequiredResourceMissing' }
  return $Resources[$Address]
}
function Get-RestoreRoleBootstrapStatements {
  param([string]$AccountId)
  if ($AccountId -cnotmatch '^[0-9]{12}$') { throw 'RestoreRoleAccountRejected' }
  $role = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-deletion-restore"
  $bucket = 'arn:aws:s3:::ai-job-apply-development-candidate-del-recovery-*'
  return @(
    @{ Sid='RestoreOnlyListRetainedVersions'; Effect='Allow'; Action=@('s3:ListBucketVersions'); Resource=$bucket
      Condition=@{ ArnEquals=@{ 'aws:PrincipalArn'=$role }; StringEquals=@{ 's3:prefix'='candidate-deletion-recovery/' } } },
    @{ Sid='RestoreOnlyReadRetainedVersions'; Effect='Allow'; Action=@('s3:GetObjectVersion','s3:GetObjectRetention'); Resource="$bucket/candidate-deletion-recovery/*"
      Condition=@{ ArnEquals=@{ 'aws:PrincipalArn'=$role } } }
  )
}
function Assert-RestoreRoleStatementDelta {
  param([object]$Before, [object]$After, [object[]]$Added, [bool]$Enable)
  $left = ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical $Before)
  $right = ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical $After)
  $normalized = @((ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical @{Version='2012-10-17'; Statement=$Added})).Statement)
  if ($Enable) { $null = Assert-ExactIamStatementDelta -BeforePolicy $left -AfterPolicy $right -AddedStatements $normalized -ModifiedStatements @() }
  else { $null = Assert-ExactIamStatementDelta -BeforePolicy $right -AfterPolicy $left -AddedStatements $normalized -ModifiedStatements @() }
}
function Get-RestoreRolePlatformBoundary {
  param([Collections.IDictionary]$Resources, [string]$AccountId)
  if ($AccountId -cnotmatch '^[0-9]{12}$') { throw 'RestoreRoleAccountRejected' }
  $role = "arn:aws:iam::${AccountId}:role/ai-job-apply-development-deletion-restore"
  $recovery = (Get-RestoreRoleResource $Resources 'module.platform.aws_s3_bucket.candidate_deletion_recovery[0]').arn
  $documents = (Get-RestoreRoleResource $Resources 'module.platform.aws_s3_bucket.candidate_documents[0]').arn
  $secret = (Get-RestoreRoleResource $Resources 'module.platform.aws_secretsmanager_secret.database_url').arn
  $key = (Get-RestoreRoleResource $Resources 'module.platform.aws_kms_key.platform').arn
  $logs = (Get-RestoreRoleResource $Resources 'module.platform.aws_cloudwatch_log_group.application').arn
  if ($recovery -cne "arn:aws:s3:::ai-job-apply-development-candidate-del-recovery-$AccountId" -or
      $documents -cne "arn:aws:s3:::ai-job-apply-development-candidate-docs-$AccountId" -or
      $secret -cnotmatch "^arn:aws:secretsmanager:us-east-2:${AccountId}:secret:ai-job-apply/development/database-url-[A-Za-z0-9]{6}$" -or
      $key -cnotmatch "^arn:aws:kms:us-east-2:${AccountId}:key/[a-f0-9-]{36}$" -or
      $logs -cne "arn:aws:logs:us-east-2:${AccountId}:log-group:/ai-job-apply/development/application") {
    throw 'RestoreRolePlatformResourceIdentityRejected'
  }
  $prefix='candidate-deletion-recovery/'
  $policy = @{ Version='2012-10-17'; Statement=@(
    @{ Sid='WriteOwnedLogs'; Effect='Allow'; Action=@('logs:CreateLogStream','logs:PutLogEvents'); Resource="${logs}:*" },
    @{ Sid='ManagePrivateLambdaInterfaces'; Effect='Allow'; Action=@('ec2:AssignPrivateIpAddresses','ec2:CreateNetworkInterface','ec2:DeleteNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets','ec2:UnassignPrivateIpAddresses'); Resource='*' },
    @{ Sid='ReadExactDatabaseSecret'; Effect='Allow'; Action=@('secretsmanager:GetSecretValue'); Resource=$secret },
    @{ Sid='DecryptExactDatabaseSecret'; Effect='Allow'; Action=@('kms:Decrypt'); Resource=$key; Condition=@{StringEquals=@{'kms:ViaService'='secretsmanager.us-east-2.amazonaws.com';'kms:EncryptionContext:SecretARN'=$secret}} },
    @{ Sid='ListRetainedMarkerVersions'; Effect='Allow'; Action=@('s3:ListBucketVersions'); Resource=$recovery; Condition=@{StringEquals=@{'s3:prefix'=$prefix}} },
    @{ Sid='ReadExactRetainedMarkerVersions'; Effect='Allow'; Action=@('s3:GetObjectVersion','s3:GetObjectVersionTagging','s3:GetObjectRetention'); Resource="$recovery/$prefix*" },
    @{ Sid='ListDocumentVersionsOnly'; Effect='Allow'; Action=@('s3:ListBucketVersions'); Resource=$documents; Condition=@{StringLike=@{'s3:prefix'=@('quarantine/*','normalized/*')}} },
    @{ Sid='DecryptRetainedMarkerObjects'; Effect='Allow'; Action=@('kms:Decrypt'); Resource=$key; Condition=@{StringEquals=@{'kms:ViaService'='s3.us-east-2.amazonaws.com'};StringLike=@{'kms:EncryptionContext:aws:s3:arn'=@($recovery,"$recovery/$prefix*")}} },
    @{ Sid='DecryptExactRecoveryLocators'; Effect='Allow'; Action=@('kms:Decrypt'); Resource=$key; Condition=@{StringEquals=@{'kms:EncryptionContext:purpose'='candidate-deletion-recovery-v1'};StringLike=@{'kms:EncryptionContext:requestId'='????????-????-????-????-????????????'};'ForAllValues:StringEquals'=@{'kms:EncryptionContextKeys'=@('purpose','requestId')}} }
  ) }
  $endpointStatements=@(
    @{ Sid='RestoreOnlyRetainedVersionInventory'; Effect='Allow'; Action=@('s3:ListBucketVersions'); Resource=$recovery; Principal='*'; Condition=@{ArnEquals=@{'aws:PrincipalArn'=$role};StringEquals=@{'s3:prefix'=$prefix}} },
    @{ Sid='RestoreOnlyRetainedVersionReads'; Effect='Allow'; Action=@('s3:GetObjectVersion','s3:GetObjectVersionTagging','s3:GetObjectRetention'); Resource="$recovery/$prefix*"; Principal='*';Condition=@{ArnEquals=@{'aws:PrincipalArn'=$role}} },
    @{ Sid='RestoreOnlyDocumentAbsenceInventory'; Effect='Allow'; Action=@('s3:ListBucketVersions'); Resource=$documents; Principal='*';Condition=@{ArnEquals=@{'aws:PrincipalArn'=$role};StringLike=@{'s3:prefix'=@('quarantine/*','normalized/*')}} }
  )
  return @{ RoleArn=$role; BoundaryArn="arn:aws:iam::${AccountId}:policy/ai-job-apply-development-workload-boundary"
    Trust=@{Version='2012-10-17';Statement=@(@{Effect='Allow';Action=@('sts:AssumeRole');Principal=@{Service='lambda.amazonaws.com'}})}
    Policy=$policy; EndpointStatements=$endpointStatements; SecretArn=$secret }
}
function Assert-RestoreRoleRecord {
  param([object]$Role, [object]$Policy, [object]$Boundary)
  foreach($property in $Role.PSObject.Properties){
    if($property.Name -cnotin @('arn','id','create_date','unique_id','name','name_prefix','path','description','max_session_duration','force_detach_policies','permissions_boundary','assume_role_policy','managed_policy_arns','inline_policy','tags','tags_all')){throw 'RestoreRoleUnexpectedRoleAttribute'}
  }
  foreach($property in $Policy.PSObject.Properties){
    if($property.Name -cnotin @('id','name','name_prefix','role','policy')){throw 'RestoreRoleUnexpectedPolicyAttribute'}
  }
  # Fixed-name IAM resources resolve the provider's computed prefix to an empty string.
  # Read the property directly: a function return would enumerate arrays and lose their type.
  foreach($record in @($Role,$Policy)){
    $prefix=$record.PSObject.Properties['name_prefix']
    if($null -ne $prefix -and $null -ne $prefix.Value -and
      ($prefix.Value -isnot [string] -or $prefix.Value.Length -ne 0)){throw 'RestoreRoleRecordRejected'}
  }
  if ($Role.name -cne 'ai-job-apply-development-deletion-restore' -or $Role.permissions_boundary -cne $Boundary.BoundaryArn -or
      $Role.path -cne '/' -or $Role.max_session_duration -ne 3600 -or $Role.force_detach_policies -isnot [bool] -or $Role.force_detach_policies -ne $false -or
      -not [string]::IsNullOrEmpty([string](Get-RestoreRoleProperty $Role 'description')) -or
      @((Get-RestoreRoleProperty $Role 'managed_policy_arns' @())).Count -ne 0 -or
      $Policy.name -cne 'candidate-deletion-restore-read-only' -or $Policy.role -cne $Role.name) { throw 'RestoreRoleRecordRejected' }
  foreach ($name in @('arn','id')) {
    $value=Get-RestoreRoleProperty $Role $name
    if ($null -ne $value -and $value -cne $(if ($name -ceq 'arn') {$Boundary.RoleArn} else {$Role.name})) { throw 'RestoreRoleIdentityRejected' }
  }
  Assert-RestoreRolePolicyEqual $Role.assume_role_policy $Boundary.Trust
  Assert-RestoreRolePolicyEqual $Policy.policy $Boundary.Policy
  $inline=@(Get-RestoreRoleProperty $Role 'inline_policy' @())
  if ($inline.Count -gt 1) { throw 'RestoreRoleUnexpectedInlinePolicy' }
  if ($inline.Count -eq 1) {
    if ($inline[0].name -cne $Policy.name) { throw 'RestoreRoleUnexpectedInlinePolicy' }
    Assert-RestoreRolePolicyEqual $inline[0].policy $Boundary.Policy
  }
  $tags=Get-RestoreRoleProperty $Role 'tags_all'
  if ((ConvertTo-RestoreRoleCanonical $tags) -cne (ConvertTo-RestoreRoleCanonical @{Project='ai-job-apply';Environment='development';ManagedBy='terraform'})) { throw 'RestoreRoleTagsRejected' }
  $explicitTags=Get-RestoreRoleProperty $Role 'tags'
  if($null -ne $explicitTags -and (ConvertTo-RestoreRoleCanonical $explicitTags) -cne '{}'){throw 'RestoreRoleExplicitTagsRejected'}
}
function Assert-RestoreRoleUnknowns {
  param([AllowNull()][object]$Unknown, [string[]]$Allowed=@(), [string]$Prefix='')
  if ($null -eq $Unknown -or $Unknown -ceq $false) { return }
  if ($Unknown -is [bool]) {
    if ($Prefix -cnotin $Allowed) { throw 'RestoreRoleUnexpectedUnknown' }; return
  }
  if ($Unknown -is [array]) {
    for ($i=0;$i -lt $Unknown.Count;$i++) { Assert-RestoreRoleUnknowns $Unknown[$i] $Allowed "${Prefix}[$i]" }; return
  }
  foreach ($property in $Unknown.PSObject.Properties) {
    $path=if($Prefix){"$Prefix.$($property.Name)"}else{$property.Name}
    Assert-RestoreRoleUnknowns $property.Value $Allowed $path
  }
}
function Assert-RestoreRoleVariables {
  param([object]$Before, [object]$After, [bool]$Enable)
  $names=@($Before.PSObject.Properties.Name | Sort-Object)
  if (($names -join ',') -cne (@($After.PSObject.Properties.Name | Sort-Object) -join ',')) { throw 'RestoreRoleVariableInventoryChanged' }
  foreach($name in $names) {
    if($name -ceq 'candidate_deletion_restore_role_enabled') {
      if((ConvertTo-ExactBoolean $Before.$name.value 'restore flag') -eq $Enable -or (ConvertTo-ExactBoolean $After.$name.value 'restore flag') -ne $Enable) { throw 'RestoreRoleFlagTransitionRejected' }
    } elseif ((Get-RestoreRoleVariableCanonical $name $Before.$name.value) -cne (Get-RestoreRoleVariableCanonical $name $After.$name.value)) { throw 'RestoreRoleUnrelatedVariableChanged' }
  }
  if($names -cnotcontains 'candidate_deletion_restore_role_enabled') { throw 'RestoreRoleFlagMissing' }
}
function Get-RestoreRoleVariableCanonical {
  param([string]$Name,[AllowNull()][object]$Value)
  if($Name -ceq 'd2_community_runtime'){
    $structured=if($Value -is [string]){ConvertFrom-TerraformCompositeJson $Value 'D2 runtime input'}else{$Value}
    if($structured -isnot [pscustomobject]){throw 'RestoreRoleD2RuntimeInputRejected'}
    return ConvertTo-TerraformCompositeCanonicalValue $structured 'D2 runtime input'
  }
  if((Get-DevelopmentDocumentVariableKinds).ContainsKey($Name)){
    return ConvertTo-DevelopmentDocumentComparableVariableValue -Name $Name -Value $Value -SerializedBaseline
  }
  return ConvertTo-RestoreRoleCanonical $Value
}
function Assert-RestoreRoleObservationEqual {
  param([AllowNull()][object]$Actual,[AllowNull()][object]$Expected)
  # Preserve array order and timestamp strings. This is a local comparison, not a state rewrite.
  if((ConvertTo-DeploymentCanonicalValue $Actual) -cne (ConvertTo-DeploymentCanonicalValue $Expected)){
    throw 'RestoreRoleObservationValueChanged'
  }
}
function Assert-RestoreRoleObservationMetadata {
  param([AllowNull()][object]$Value)
  if($Value -is [bool]){if($Value){throw 'RestoreRoleObservationSensitiveValue'};return}
  if($Value -is [array]){foreach($item in $Value){Assert-RestoreRoleObservationMetadata $item};return}
  if($Value -is [pscustomobject]){foreach($property in $Value.PSObject.Properties){Assert-RestoreRoleObservationMetadata $property.Value};return}
  throw 'RestoreRoleObservationMetadataShape'
}
function Assert-RestoreRoleObservationRecord {
  param([object]$Record,[ValidateSet('aws_iam_role','aws_iam_role_policy')][string]$Type,[ValidateSet('update','no-op','delete')][string]$Action,[string]$AccountId='')
  $recordKeys=@('address','module_address','mode','type','name','index','provider_name','change')
  $changeKeys=@('actions','before','after','after_unknown','before_sensitive','after_sensitive')
  $beforeIdentity=$Record.change.PSObject.Properties['before_identity']
  $afterIdentity=$Record.change.PSObject.Properties['after_identity']
  $actionReason=$Record.PSObject.Properties['action_reason']
  $noOpIdentity=$Action -ceq 'no-op' -and ($null -ne $beforeIdentity -or $null -ne $afterIdentity)
  $deleteIdentity=$Action -ceq 'delete' -and ($null -ne $beforeIdentity -or $null -ne $afterIdentity -or $null -ne $actionReason)
  if($noOpIdentity){$changeKeys+=@('before_identity','after_identity')}
  if($deleteIdentity){$recordKeys+=@('action_reason');$changeKeys+=@('before_identity')}
  Assert-ExactObjectKeys $Record $recordKeys 'restore observation record'
  Assert-ExactObjectKeys $Record.change $changeKeys 'restore observation change'
  if($Record.address -cne "module.platform.$Type.candidate_deletion_restore[0]" -or
     $Record.module_address -cne 'module.platform' -or $Record.mode -cne 'managed' -or $Record.type -cne $Type -or
     $Record.name -cne 'candidate_deletion_restore' -or ($Record.index -isnot [int] -and $Record.index -isnot [long]) -or $Record.index -ne 0 -or
     $Record.provider_name -cne 'registry.terraform.io/hashicorp/aws' -or $Record.change.actions -isnot [array] -or
     $Record.change.actions.Count -ne 1 -or $Record.change.actions[0] -cne $Action){throw 'RestoreRoleObservationRecordRejected'}
  # No-op identity is an equal pair. The observed count-index delete carries only
  # before_identity, coupled to its exact reason; neither form extends drift records.
  if($deleteIdentity -and ($actionReason.Value -isnot [string] -or $actionReason.Value -cne 'delete_because_count_index')){throw 'RestoreRoleObservationDeleteReasonRejected'}
  if($noOpIdentity -or $deleteIdentity){
    if($AccountId -cnotmatch '^[0-9]{12}$' -or $beforeIdentity.Value -isnot [pscustomobject]){throw 'RestoreRoleObservationIdentityRejected'}
    $identityKeys=@('account_id','name')
    $identityName=if($Type -ceq 'aws_iam_role'){'ai-job-apply-development-deletion-restore'}else{'candidate-deletion-restore-read-only'}
    if($Type -ceq 'aws_iam_role_policy'){$identityKeys+=@('role')}
    Assert-ExactObjectKeys $beforeIdentity.Value $identityKeys 'restore observation identity'
    if($beforeIdentity.Value.account_id -isnot [string] -or $beforeIdentity.Value.account_id -cne $AccountId -or
       $beforeIdentity.Value.name -isnot [string] -or $beforeIdentity.Value.name -cne $identityName -or
       ($Type -ceq 'aws_iam_role_policy' -and ($beforeIdentity.Value.role -isnot [string] -or
         $beforeIdentity.Value.role -cne 'ai-job-apply-development-deletion-restore'))){throw 'RestoreRoleObservationIdentityRejected'}
    if($noOpIdentity){
      if($afterIdentity.Value -isnot [pscustomobject]){throw 'RestoreRoleObservationIdentityRejected'}
      Assert-RestoreRoleObservationEqual $afterIdentity.Value $beforeIdentity.Value
    }
  }
  if($Action -ceq 'delete'){
    if($null -ne $Record.change.after -or $Record.change.after_sensitive -isnot [bool] -or $Record.change.after_sensitive){throw 'RestoreRoleObservationDeleteRejected'}
    if(-not (($Record.change.after_unknown -is [bool] -and -not $Record.change.after_unknown) -or
      (Test-DevelopmentDocumentEmptyObject $Record.change.after_unknown))){throw 'RestoreRoleObservationDeleteUnknown'}
  }elseif(-not (Test-DevelopmentDocumentEmptyObject $Record.change.after_unknown)){throw 'RestoreRoleObservationUnknown'}
  Assert-RestoreRoleObservationMetadata $Record.change.before_sensitive
  Assert-RestoreRoleObservationMetadata $Record.change.after_sensitive
}
function Assert-RestoreRoleComputedPolicyObservation {
  param([object]$Plan,[object]$Record,[switch]$Removal)
  if($Plan.terraform_version -cne (Get-DeploymentTerraformVersion)){throw 'RestoreRoleObservationCurrentPlanRequired'}
  $flag=Get-RestoreRoleProperty $Plan.variables 'candidate_deletion_restore_role_enabled'
  Assert-ExactObjectKeys $flag @('value') 'restore observation flag'
  if((ConvertTo-ExactBoolean $flag.value 'restore observation flag') -ne (-not $Removal)){throw 'RestoreRoleObservationFlagRejected'}
  Assert-RestoreRoleObservationRecord $Record 'aws_iam_role' 'update'
  $roleAddress='module.platform.aws_iam_role.candidate_deletion_restore[0]'
  $policyAddress='module.platform.aws_iam_role_policy.candidate_deletion_restore[0]'
  # Only the exact Platform Disable transition may use refreshed prior values: the two
  # resources are then absent from planned_values and are independently checked as deletes.
  $module=if($Removal){$Plan.prior_state.values.root_module}else{$Plan.planned_values.root_module}
  $map=Get-RestoreRoleResourceMap $module
  $role=Get-RestoreRoleResource $map $roleAddress
  $policy=Get-RestoreRoleResource $map $policyAddress
  if($role.arn -isnot [string] -or $role.arn -cnotmatch '^arn:aws:iam::([0-9]{12}):role/ai-job-apply-development-deletion-restore$'){
    throw 'RestoreRoleObservationIdentityRejected'
  }
  $observationAccountId=$Matches[1]
  $boundary=Get-RestoreRolePlatformBoundary $map $observationAccountId
  $before=Copy-RestoreRoleValue $Record.change.before
  $after=Copy-RestoreRoleValue $Record.change.after
  $sensitivityBefore=Copy-RestoreRoleValue $Record.change.before_sensitive
  $sensitivityAfter=Copy-RestoreRoleValue $Record.change.after_sensitive
  # Native refresh pairs absent sensitivity with null -> empty explicit tags. Compare
  # that exact observation only on clones; preserve the original before-refresh state.
  $beforeTags=$before.PSObject.Properties['tags']
  $afterTags=$after.PSObject.Properties['tags']
  if($null -ne $beforeTags -and $null -eq $beforeTags.Value -and $null -ne $afterTags -and
     (Test-DevelopmentDocumentEmptyObject $afterTags.Value)){
    $beforeTagSensitivity=$sensitivityBefore.PSObject.Properties['tags']
    $afterTagSensitivity=$sensitivityAfter.PSObject.Properties['tags']
    if($sensitivityBefore -isnot [pscustomobject] -or $sensitivityAfter -isnot [pscustomobject] -or
       $null -ne $beforeTagSensitivity -or $null -eq $afterTagSensitivity -or
       -not (Test-DevelopmentDocumentEmptyObject $afterTagSensitivity.Value)){throw 'RestoreRoleObservationTagsMetadataRejected'}
    $before.tags=[pscustomobject]@{}
    $sensitivityBefore|Add-Member -NotePropertyName tags -NotePropertyValue ([pscustomobject]@{})
  }
  if(-not (Test-DevelopmentDocumentEmptyArray $before.inline_policy) -or $after.inline_policy -isnot [array] -or
     $after.inline_policy.Count -ne 1){throw 'RestoreRoleObservationNotEmptyToExactPolicy'}
  Assert-ExactObjectKeys $after.inline_policy[0] @('name','policy') 'restore observation inline policy'
  if($after.inline_policy[0].name -cne $policy.name -or $after.inline_policy[0].policy -isnot [string] -or
     $after.inline_policy[0].policy -cne $policy.policy -or $role.id -cne $role.name -or
     $role.unique_id -isnot [string] -or [string]::IsNullOrWhiteSpace($role.unique_id)){
    throw 'RestoreRoleObservationChildPolicyMismatch'
  }
  Assert-RestoreRoleRecord $before $policy $boundary
  Assert-RestoreRoleRecord $after $policy $boundary
  Assert-RestoreRoleObservationEqual $after $role
  $after.inline_policy=@()
  Assert-RestoreRoleObservationEqual $after $before
  Assert-RestoreRoleObservationMetadata $Record.change.before_sensitive
  Assert-RestoreRoleObservationMetadata $Record.change.after_sensitive
  if((ConvertTo-DeploymentCanonicalValue $sensitivityBefore) -cne (ConvertTo-DeploymentCanonicalValue $sensitivityAfter)){
    $left=$sensitivityBefore.PSObject.Properties['inline_policy']
    $right=$sensitivityAfter.PSObject.Properties['inline_policy']
    if($null -eq $left -or $null -eq $right -or -not (Test-DevelopmentDocumentEmptyArray $left.Value) -or
       $right.Value -isnot [array] -or $right.Value.Count -ne 1 -or
       -not (Test-DevelopmentDocumentEmptyObject $right.Value[0])){throw 'RestoreRoleObservationSensitivityChanged'}
    $sensitivityAfter.inline_policy=@()
    Assert-RestoreRoleObservationEqual $sensitivityAfter $sensitivityBefore
  }
  foreach($address in @($roleAddress,$policyAddress)){
    $changes=@($Plan.resource_changes | Where-Object address -CEQ $address)
    if($changes.Count -ne 1){throw 'RestoreRoleObservationConfigurationMissing'}
    $type=if($address -ceq $roleAddress){'aws_iam_role'}else{'aws_iam_role_policy'}
    $action=if($Removal){'delete'}else{'no-op'}
    Assert-RestoreRoleObservationRecord $changes[0] $type $action $observationAccountId
    Assert-RestoreRoleObservationEqual $changes[0].change.before $map[$address]
    if(-not $Removal){
      Assert-RestoreRoleObservationEqual $changes[0].change.after $map[$address]
      Assert-RestoreRoleObservationEqual $changes[0].change.before_sensitive $changes[0].change.after_sensitive
    }elseif((Get-RestoreRoleResourceMap $Plan.planned_values.root_module).ContainsKey($address)){
      throw 'RestoreRoleObservationDeletedResourceStillPlanned'
    }
    if($address -ceq $roleAddress){Assert-RestoreRoleObservationEqual $changes[0].change.before_sensitive $Record.change.after_sensitive}
  }
}
function Assert-RestoreRoleAcceptedPlanDrift {
  param([object]$Plan,[switch]$Removal)
  $drift=@(Get-RestoreRoleProperty $Plan 'resource_drift' @())
  $roleAddress='module.platform.aws_iam_role.candidate_deletion_restore[0]'
  $observations=@($drift | Where-Object address -CEQ $roleAddress)
  if($observations.Count -gt 1){throw 'RestoreRoleDuplicateObservation'}
  if($observations.Count -eq 1){Assert-RestoreRoleComputedPolicyObservation $Plan $observations[0] -Removal:$Removal}
  $other=@($drift | Where-Object address -CNE $roleAddress)
  if($other.Count -gt 0){Assert-DevelopmentDocumentAcceptedResourceDrift -Records $other -RootModule $Plan.planned_values.root_module}
}
function Assert-RestoreRolePlanEnvelope {
  param([object]$Plan, [switch]$ZeroDrift, [switch]$RestoreRoleRemoval)
  $errored=Get-RestoreRoleProperty $Plan 'errored';$complete=Get-RestoreRoleProperty $Plan 'complete'
  if($Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or $errored -isnot [bool] -or $errored -ne $false -or
      $complete -isnot [bool] -or $complete -ne $true -or @(Get-RestoreRoleProperty $Plan 'deferred_changes' @()).Count -ne 0) { throw 'RestoreRolePlanEnvelopeRejected' }
  $drift=@(Get-RestoreRoleProperty $Plan 'resource_drift' @())
  if($drift.Count -gt 0){Assert-RestoreRoleAcceptedPlanDrift $Plan -Removal:$RestoreRoleRemoval}
  foreach($property in (Get-RestoreRoleProperty $Plan 'output_changes' ([pscustomobject]@{})).PSObject.Properties) {
    if((@($property.Value.actions)-join ',') -cne 'no-op') { throw 'RestoreRoleOutputChanged' }
  }
  if($ZeroDrift -and @($Plan.resource_changes | Where-Object { (@($_.change.actions)-join ',') -cne 'no-op' }).Count -ne 0) { throw 'RestoreRoleBaselineNotZeroDrift' }
}
function Assert-RestoreRoleTransitionPlan {
  param([object]$Plan,[object]$Baseline,[ValidateSet('Bootstrap','Platform')][string]$Stage,[bool]$Enable,[string]$AccountId)
  Assert-RestoreRolePlanEnvelope $Baseline -ZeroDrift
  Assert-RestoreRolePlanEnvelope $Plan -RestoreRoleRemoval:($Stage -ceq 'Platform' -and -not $Enable)
  Assert-RestoreRoleVariables $Baseline.variables $Plan.variables $Enable
  $map=Get-RestoreRoleResourceMap $Baseline.planned_values.root_module
  $changes=@($Plan.resource_changes | Where-Object { (@($_.change.actions)-join ',') -cne 'no-op' })
  if(@($changes | Where-Object {$_.mode -cne 'managed'}).Count -ne 0) { throw 'RestoreRoleUnexpectedDataChange' }
  $addresses=if($Stage -ceq 'Bootstrap'){@('aws_iam_policy.workload_boundary')}else{@('module.platform.aws_iam_role.candidate_deletion_restore[0]','module.platform.aws_iam_role_policy.candidate_deletion_restore[0]','module.platform.aws_vpc_endpoint.candidate_documents_s3[0]','module.platform.aws_vpc_endpoint.secretsmanager[0]')}
  if((@($changes|ForEach-Object {$_.address}|Sort-Object)-join ',') -cne (@($addresses|Sort-Object)-join ',')) { throw 'RestoreRoleResourceDeltaRejected' }
  if($Stage -ceq 'Bootstrap' -and (@(Get-RestoreRoleProperty $Baseline 'resource_drift' @()).Count -ne 0 -or @(Get-RestoreRoleProperty $Plan 'resource_drift' @()).Count -ne 0)){throw 'RestoreRoleBootstrapDriftRejected'}
  foreach($change in $changes) {
    Assert-NoTerraformReplacementPaths $change.change
    if($map.ContainsKey($change.address) -and (ConvertTo-RestoreRoleCanonical $change.change.before) -cne (ConvertTo-RestoreRoleCanonical $map[$change.address])) { throw 'RestoreRoleBeforeStateMismatch' }
    if(-not $map.ContainsKey($change.address) -and $null -ne $change.change.before) { throw 'RestoreRoleUnexpectedBeforeResource' }
  }
  if($Stage -ceq 'Bootstrap') {
    $change=$changes[0]
    if((@($change.change.actions)-join ',') -cne 'update') { throw 'RestoreRoleBootstrapActionRejected' }
    Assert-RestoreRoleUnknowns $change.change.after_unknown
    $before=Copy-RestoreRoleValue $change.change.before; $after=Copy-RestoreRoleValue $change.change.after
    if($before.name -cne 'ai-job-apply-development-workload-boundary' -or $before.arn -cne "arn:aws:iam::${AccountId}:policy/ai-job-apply-development-workload-boundary") { throw 'RestoreRoleBootstrapIdentityRejected' }
    Assert-RestoreRoleStatementDelta $before.policy $after.policy (Get-RestoreRoleBootstrapStatements $AccountId) $Enable
    $before.PSObject.Properties.Remove('policy');$after.PSObject.Properties.Remove('policy')
    if((ConvertTo-RestoreRoleCanonical $before) -cne (ConvertTo-RestoreRoleCanonical $after)) { throw 'RestoreRoleUnrelatedPolicyAttributeChanged' }
  } else {
    $boundary=Get-RestoreRolePlatformBoundary $map $AccountId
    $roleChange=@($changes|Where-Object address -CEQ $addresses[0])[0]
    $policyChange=@($changes|Where-Object address -CEQ $addresses[1])[0]
    foreach($change in @($roleChange,$policyChange)) {
      if((@($change.change.actions)-join ',') -cne $(if($Enable){'create'}else{'delete'})) { throw 'RestoreRoleResourceActionRejected' }
      if(-not $Enable){
        if($null -ne $change.change.after){throw 'RestoreRoleDeletedResourceStillPlanned'}
        Assert-RestoreRoleUnknowns $change.change.after_unknown
      }
    }
    if($Enable) {
      foreach($change in @($roleChange,$policyChange)){
        $prefixMask=$change.change.after_unknown.PSObject.Properties['name_prefix']
        if($null -ne $prefixMask){
          if($prefixMask.Value -isnot [bool]){throw 'RestoreRolePrefixMetadataRejected'}
          $prefix=$change.change.after.PSObject.Properties['name_prefix']
          if($prefixMask.Value -and $null -ne $prefix -and $null -ne $prefix.Value){throw 'RestoreRolePrefixMetadataRejected'}
        }
      }
      Assert-RestoreRoleUnknowns $roleChange.change.after_unknown @('arn','id','create_date','unique_id','inline_policy','managed_policy_arns','name_prefix')
      Assert-RestoreRoleUnknowns $policyChange.change.after_unknown @('id','role','name_prefix')
    }
    $role=if($Enable){$roleChange.change.after}else{$roleChange.change.before}
    $policy=Copy-RestoreRoleValue $(if($Enable){$policyChange.change.after}else{$policyChange.change.before})
    # Terraform binds the inline policy through the new role's computed id. Only that exact
    # pending role binding may be projected to its fixed name for pre-apply validation.
    if($Enable){
      $roleBinding=$policy.PSObject.Properties['role']
      $roleMask=$policyChange.change.after_unknown.PSObject.Properties['role']
      if(($null -eq $roleBinding -or $null -eq $roleBinding.Value) -and
        $null -ne $roleMask -and $roleMask.Value -is [bool] -and $roleMask.Value){
        $policy|Add-Member -NotePropertyName role -NotePropertyValue $role.name -Force
      }
    }
    Assert-RestoreRoleRecord $role $policy $boundary
    foreach($address in $addresses[2..3]) {
      $change=@($changes|Where-Object address -CEQ $address)[0]
      if((@($change.change.actions)-join ',') -cne 'update') { throw 'RestoreRoleEndpointReplacementRejected' }
      Assert-RestoreRoleUnknowns $change.change.after_unknown
      $before=Copy-RestoreRoleValue $change.change.before; $after=Copy-RestoreRoleValue $change.change.after
      if($address -ceq $addresses[2]) { Assert-RestoreRoleStatementDelta $before.policy $after.policy $boundary.EndpointStatements $Enable }
      else {
        $left=ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical $before.policy)
        $right=ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical $after.policy)
        $from=if($Enable){$left}else{$right};$to=if($Enable){$right}else{$left}
        $statement=@($from.Statement|Where-Object Sid -CEQ 'ExactLambdaRolesDatabaseSecretOnly')
        if($statement.Count -ne 1 -or $statement[0].Effect -cne 'Allow' -or (@($statement[0].Action)-join ',') -cne 'secretsmanager:GetSecretValue' -or
          (@($statement[0].Resource)-join ',') -cne $boundary.SecretArn -or @($statement[0].Condition.ArnEquals.'aws:PrincipalArn') -ccontains $boundary.RoleArn) { throw 'RestoreRoleSecretEndpointBoundaryRejected' }
        $statement[0].Condition.ArnEquals.'aws:PrincipalArn'=@($statement[0].Condition.ArnEquals.'aws:PrincipalArn')+@($boundary.RoleArn)
        Assert-RestoreRolePolicyEqual $from $to
      }
      $before.PSObject.Properties.Remove('policy');$after.PSObject.Properties.Remove('policy')
      if((ConvertTo-RestoreRoleCanonical $before) -cne (ConvertTo-RestoreRoleCanonical $after)) { throw 'RestoreRoleEndpointAttributeChanged' }
    }
  }
  return [pscustomobject]@{Stage=$Stage;Enabled=$Enable;ChangedResources=@($addresses).Count;Creates=$(if($Stage -ceq 'Platform' -and $Enable){2}else{0});Deletes=$(if($Stage -ceq 'Platform' -and -not $Enable){2}else{0})}
}

function Get-RestoreRoleBeforeRefreshResources {
  param([object]$Plan)
  Assert-RestoreRolePlanEnvelope $Plan -ZeroDrift
  $map=Get-RestoreRoleResourceMap $Plan.planned_values.root_module
  foreach($drift in @(Get-RestoreRoleProperty $Plan 'resource_drift' @())){
    if(-not $map.ContainsKey($drift.address) -or (ConvertTo-RestoreRoleCanonical $map[$drift.address]) -cne (ConvertTo-RestoreRoleCanonical $drift.change.after)){throw 'RestoreRoleDriftNotPlanOwned'}
    $map[$drift.address]=$drift.change.before
  }
  return $map
}

function Assert-RestoreRoleStateIdentity {
  param([object]$State,[string]$Lineage,[long]$Serial)
  Assert-DeploymentTerraformStateVersion ([string]$State.terraform_version)
  if($Lineage -cnotmatch '^[a-f0-9-]{36}$' -or $Serial -lt 0 -or $State.lineage -cne $Lineage -or
    ($State.serial -isnot [int] -and $State.serial -isnot [long]) -or [long]$State.serial -ne $Serial) { throw 'RestoreRoleStateIdentityChanged' }
}
function Assert-RestoreRoleFileBindings {
  param([object[]]$Bindings)
  if($Bindings.Count -lt 1) { throw 'RestoreRoleFileBindingsMissing' }
  if(@($Bindings.path|Sort-Object -Unique).Count -ne $Bindings.Count){throw 'RestoreRoleDuplicateFileBinding'}
  foreach($binding in $Bindings) {
    if($binding.sha256 -cnotmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $binding.path -PathType Leaf) -or
      (Get-FileHash -LiteralPath $binding.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $binding.sha256) { throw 'RestoreRoleReviewedBytesChanged' }
  }
}

function Assert-RestoreRoleCleanupEvidence {
  param([object]$Preparation,[object]$Config,[object]$Context,[object]$Journal,[string]$PreparationSha256,[string]$ContextSha256,[string]$AccountId,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
  if($Preparation.accountId -cne $AccountId -or $Preparation.roleBoundary.roleArn -cne "arn:aws:iam::${AccountId}:role/ai-job-apply-development-deletion-restore" -or
    $Context.source_identifier -cne 'ai-job-apply-development' -or $Context.target_identifier -cnotmatch '^ai-job-apply-development-restore-[a-z0-9-]+$' -or
    $Context.target_boundary_authenticated -isnot [bool] -or -not $Context.target_boundary_authenticated -or $Context.verified -isnot [bool] -or -not $Context.verified){throw 'RestoreRoleCleanupEvidenceRejected'}
  if($Config.restoreContextSha256 -cne $ContextSha256 -or $Config.accountId -cne $AccountId -or
    $Config.sourceIdentifier -cne $Context.source_identifier -or $Config.sourceDbiResourceId -cne $Context.source_dbi_resource_id -or $Config.sourceBoundarySha256 -cne $Context.source_boundary_sha256 -or
    $Config.targetIdentifier -cne $Context.target_identifier -or $Config.targetDbiResourceId -cne $Context.target_dbi_resource_id -or $Config.targetBoundarySha256 -cne $Context.target_boundary_sha256 -or
    $Context.target_resource_arn -cne "arn:aws:rds:us-east-2:${AccountId}:db:$($Config.targetIdentifier)" -or $Context.source_resource_arn -cne "arn:aws:rds:us-east-2:${AccountId}:db:ai-job-apply-development"){throw 'RestoreRoleCleanupTargetBindingChanged'}
  if((@($Journal.PSObject.Properties.Name|Sort-Object)-join ',') -cne 'preparationSha256,schemaVersion,startedAt,status' -or
    ($Journal.schemaVersion -isnot [int] -and $Journal.schemaVersion -isnot [long]) -or $Journal.schemaVersion -ne 1 -or $Journal.status -cne 'started' -or $Journal.preparationSha256 -cne $PreparationSha256){throw 'RestoreRoleCleanupJournalRejected'}
  try{$started=[datetimeoffset]::Parse($Journal.startedAt,[Globalization.CultureInfo]::InvariantCulture)}catch{throw 'RestoreRoleCleanupTimestampRejected'}
  if($started -lt [datetimeoffset]::Parse($Config.issuedAt) -or $started.AddSeconds(330) -gt $Now){throw 'RestoreRoleCleanupDrainIncomplete'}
}
