#Requires -Version 7.5
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Bootstrap','Platform')][string]$Stage,
  [ValidateSet('Plan','Apply','Verify')][string]$Action='Plan',
  [Parameter(Mandatory)][ValidateSet('Enable','Disable')][string]$Transition,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceSha,
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [Parameter(Mandatory)][string]$StateBucket,
  [Parameter(Mandatory)][string]$StateKmsKeyArn,
  [Parameter(Mandatory)][string]$TerraformDataDirectory,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9-]{36}$')][string]$ExpectedStateLineage,
  [Parameter(Mandatory)][ValidateRange(0,2147483647)][long]$ExpectedStateSerial,
  [Parameter(Mandatory)][string]$BaselinePlanPath,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReviewedBaselineSha256,
  [string]$PlanPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedPlanSha256='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedMetadataSha256='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedAppliedReceiptSha256='',
  [ValidateSet('None','UnusedRole','CompletedDrill')][string]$CleanupMode='None',
  [string]$PriorVerificationPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedPriorVerificationSha256='',
  [string]$ReplayPreparationPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedReplayPreparationSha256='',
  [string]$RestoreContextPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedRestoreContextSha256='',
  [string]$ReplayCleanupJournalPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$ReviewedReplayCleanupJournalSha256='',
  [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$guardPath=Join-Path $PSScriptRoot 'lib/development-deletion-restore-role.ps1'
. $guardPath
. (Join-Path $PSScriptRoot 'lib/candidate-deletion-replay.ps1')
$phase='local-boundary'

function Invoke-RestoreRoleNative {
  param([string]$Program,[string[]]$Arguments,[int[]]$AllowedExitCodes=@(0))
  $process=$null
  try {
    $command=Get-Command $Program -ErrorAction Stop
    if($command.CommandType -ne [Management.Automation.CommandTypes]::Application) { throw 'RestoreRoleNativeShadowRejected' }
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$command.Source;$start.WorkingDirectory=$repository
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    foreach($argument in $Arguments){$start.ArgumentList.Add($argument)}
    $process=[Diagnostics.Process]::Start($start)
    $output=$process.StandardOutput.ReadToEndAsync();$errorOutput=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(900000)){$process.Kill($true);throw 'RestoreRoleNativeTimeout'}
    $text=$output.GetAwaiter().GetResult();$diagnostic=$errorOutput.GetAwaiter().GetResult()
    if($text.Length -gt 64MB -or $diagnostic.Length -gt 1MB){throw 'RestoreRoleNativeOutputLimit'}
    if($process.ExitCode -notin $AllowedExitCodes){throw 'RestoreRoleNativeFailure'}
    return @{ExitCode=$process.ExitCode;Text=$text;Diagnostic=$diagnostic}
  } finally {if($null -ne $process){$process.Dispose()}}
}
function Invoke-RestoreRoleAws {
  param([string[]]$Arguments,[switch]$AllowAbsent)
  $result=Invoke-RestoreRoleNative 'aws' ($Arguments+@('--region','us-east-2','--output','json','--no-cli-pager')) $(if($AllowAbsent){@(0,254)}else{@(0)})
  if($result.ExitCode -ne 0){
    if($AllowAbsent -and $result.Diagnostic -match '\((NoSuchEntity|ResourceNotFoundException|DBInstanceNotFound)\)'){return $null}
    throw 'RestoreRoleAwsReadFailed'
  }
  try{return ConvertFrom-Json -InputObject $result.Text -DateKind String}catch{throw 'RestoreRoleAwsJsonRejected'}
}
function Invoke-RestoreRoleTerraform {
  param([string[]]$Arguments,[int[]]$AllowedExitCodes=@(0))
  return Invoke-RestoreRoleNative 'terraform' (@("-chdir=$terraformDirectory")+$Arguments) $AllowedExitCodes
}
function Set-RestoreRoleInputs([object]$Inputs){
  foreach($property in $Inputs.PSObject.Properties){
    $value=$property.Value
    $text=if($value -is [string]){$value}elseif($value -is [bool]){$value.ToString().ToLowerInvariant()}else{ConvertTo-Json -InputObject $value -Depth 80 -Compress}
    Set-Item "Env:TF_VAR_$($property.Name)" $text
  }
}
function Get-RestoreRoleHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Resolve-RestoreRolePath {
  param([string]$Path,[switch]$New)
  $full=[IO.Path]::GetFullPath($Path,$repository)
  if(-not $full.StartsWith($repository+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'RestoreRoleEvidenceOutsideRepository'}
  if($New -and (Test-Path -LiteralPath $full)){throw 'RestoreRoleEvidenceAlreadyExists'}
  if(-not $New -and -not (Test-Path -LiteralPath $full -PathType Leaf)){throw 'RestoreRoleEvidenceMissing'}
  $cursor=$full
  while($cursor){
    if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'RestoreRoleReparsePathRejected'}}
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
  $null=Invoke-RestoreRoleNative 'git' @('-C',$repository,'check-ignore','--',$full)
  return $full
}
function Write-RestoreRoleJson {
  param([string]$Path,[object]$Value)
  if([IO.Path]::GetDirectoryName($Path) -cne $runDirectory){throw 'RestoreRoleWriteOutsideRun'}
  $null=Resolve-RestoreRolePath $Path -New
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
  try{$writer.Write((ConvertTo-Json -InputObject $Value -Depth 80));$writer.Flush();$stream.Flush($true)}finally{$writer.Dispose()}
}
function Assert-RestoreRoleSource {
  foreach($revision in @('HEAD','origin/main')){
    if((Invoke-RestoreRoleNative 'git' @('-C',$repository,'rev-parse',$revision)).Text.Trim() -cne $SourceSha){throw 'RestoreRoleSourceChanged'}
  }
  if((Invoke-RestoreRoleNative 'git' @('-C',$repository,'branch','--show-current')).Text.Trim() -cne 'main' -or
     (Invoke-RestoreRoleNative 'git' @('-C',$repository,'status','--porcelain')).Text.Trim()){throw 'RestoreRoleCleanMainRequired'}
}
function Assert-RestoreRoleSession {
  Assert-RestoreRoleSource
  Assert-DeploymentTerraformCli
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $TerraformDataDirectory `
    -ExpectedBucket $StateBucket -ExpectedKey $stateKey -ExpectedRegion 'us-east-2' -ExpectedKmsKeyArn $StateKmsKeyArn
  $identity=Invoke-RestoreRoleAws @('sts','get-caller-identity')
  if($identity.Account -cne $ExpectedAccountId -or $identity.Arn -cnotmatch "^arn:aws:sts::${ExpectedAccountId}:assumed-role/AWSReservedSSO_[A-Za-z0-9_]+/[A-Za-z0-9+=,.@_-]+$"){throw 'RestoreRoleTemporaryDevelopmentIdentityRequired'}
  Assert-RestoreRoleBackendProtection
}
function Assert-RestoreRoleBackendProtection {
  $common=@('--bucket',$StateBucket,'--expected-bucket-owner',$ExpectedAccountId)
  if((Invoke-RestoreRoleAws (@('s3api','get-bucket-location')+$common)).LocationConstraint -cne 'us-east-2' -or
    (Invoke-RestoreRoleAws (@('s3api','get-bucket-versioning')+$common)).Status -cne 'Enabled'){throw 'RestoreRoleStateBucketBoundaryRejected'}
  $public=(Invoke-RestoreRoleAws (@('s3api','get-public-access-block')+$common)).PublicAccessBlockConfiguration
  foreach($key in @('BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets')){
    if($public.$key -isnot [bool] -or -not $public.$key){throw 'RestoreRoleStateBucketNotPrivate'}
  }
  $rules=@((Invoke-RestoreRoleAws (@('s3api','get-bucket-encryption')+$common)).ServerSideEncryptionConfiguration.Rules)
  if($rules.Count -ne 1 -or $rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'aws:kms' -or
    $rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -cne $StateKmsKeyArn){throw 'RestoreRoleStateBucketEncryptionRejected'}
  $stateObject=Invoke-RestoreRoleAws (@('s3api','head-object')+$common+@('--key',$stateKey))
  if($stateObject.ServerSideEncryption -cne 'aws:kms' -or $stateObject.SSEKMSKeyId -cne $StateKmsKeyArn -or
    [string]::IsNullOrEmpty($stateObject.VersionId) -or $stateObject.VersionId -ceq 'null'){throw 'RestoreRoleStateObjectProtectionRejected'}
}
function Get-RestoreRoleState {
  $state=ConvertFrom-Json -InputObject (Invoke-RestoreRoleTerraform @('state','pull')).Text -DateKind String
  Assert-DeploymentTerraformStateVersion ([string]$state.terraform_version)
  return $state
}
function Assert-RestoreRoleStateMatchesPlan([object]$Plan){
  $shown=ConvertFrom-Json -InputObject (Invoke-RestoreRoleTerraform @('show','-json')).Text -DateKind String
  $actual=Get-RestoreRoleResourceMap $shown.values.root_module
  $expected=Get-RestoreRoleBeforeRefreshResources $Plan -Stage $Stage
  if((ConvertTo-RestoreRoleCanonical $actual) -cne (ConvertTo-RestoreRoleCanonical $expected)){throw 'RestoreRoleBaselineDoesNotMatchState'}
}
function Get-RestoreRoleLiveBoundary {
  $arn="arn:aws:iam::${ExpectedAccountId}:policy/ai-job-apply-development-workload-boundary"
  $policy=(Invoke-RestoreRoleAws @('iam','get-policy','--policy-arn',$arn)).Policy
  if($policy.Arn -cne $arn){throw 'RestoreRoleManagedBoundaryIdentityChanged'}
  return (Invoke-RestoreRoleAws @('iam','get-policy-version','--policy-arn',$arn,'--version-id',$policy.DefaultVersionId)).PolicyVersion.Document
}
function Assert-RestoreRoleLive {
  param([object]$Plan,[bool]$Enabled)
  $map=Get-RestoreRoleResourceMap $Plan.planned_values.root_module
  $managed=Get-RestoreRoleLiveBoundary
  if($Stage -ceq 'Bootstrap'){
    Assert-RestoreRolePolicyEqual $managed (Get-RestoreRoleResource $map 'aws_iam_policy.workload_boundary').policy
    return
  }
  $expected=Get-RestoreRolePlatformBoundary $map $ExpectedAccountId
  $normalized=ConvertFrom-Json (ConvertTo-RestoreRolePolicyCanonical $managed)
  foreach($statement in (Get-RestoreRoleBootstrapStatements $ExpectedAccountId)){
    $actual=@($normalized.Statement|Where-Object Sid -CEQ $statement.Sid)
    if($actual.Count -ne 1){throw 'RestoreRoleBootstrapNotEnabled'}
    Assert-RestoreRolePolicyEqual @{Version='2012-10-17';Statement=$actual} @{Version='2012-10-17';Statement=@($statement)}
  }
  $role=Invoke-RestoreRoleAws @('iam','get-role','--role-name','ai-job-apply-development-deletion-restore') -AllowAbsent
  if(-not $Enabled){if($null -ne $role){throw 'RestoreRoleExpectedAbsent'} }
  else{
    if($null -eq $role){throw 'RestoreRoleExpectedPresent'}
    $role=$role.Role
    if($role.Arn -cne $expected.RoleArn -or $role.PermissionsBoundary.PermissionsBoundaryArn -cne $expected.BoundaryArn){throw 'RestoreRoleLiveIdentityChanged'}
    Assert-RestoreRolePolicyEqual $role.AssumeRolePolicyDocument $expected.Trust
    $inline=@((Invoke-RestoreRoleAws @('iam','list-role-policies','--role-name',$role.RoleName)).PolicyNames)
    $attached=@((Invoke-RestoreRoleAws @('iam','list-attached-role-policies','--role-name',$role.RoleName)).AttachedPolicies)
    if($inline.Count -ne 1 -or $inline[0] -cne 'candidate-deletion-restore-read-only' -or $attached.Count -ne 0){throw 'RestoreRoleLivePolicyInventoryChanged'}
    $policy=(Invoke-RestoreRoleAws @('iam','get-role-policy','--role-name',$role.RoleName,'--policy-name',$inline[0])).PolicyDocument
    Assert-RestoreRolePolicyEqual $policy $expected.Policy
    $plannedRole=Get-RestoreRoleResource $map 'module.platform.aws_iam_role.candidate_deletion_restore[0]'
    if($role.RoleId -cne $plannedRole.unique_id){throw 'RestoreRoleLiveUniqueIdentityChanged'}
  }
  foreach($address in @('module.platform.aws_vpc_endpoint.candidate_documents_s3[0]','module.platform.aws_vpc_endpoint.secretsmanager[0]')){
    $endpoint=Get-RestoreRoleResource $map $address
    $live=@((Invoke-RestoreRoleAws @('ec2','describe-vpc-endpoints','--vpc-endpoint-ids',$endpoint.id)).VpcEndpoints)
    if($live.Count -ne 1 -or $live[0].VpcEndpointId -cne $endpoint.id -or $live[0].VpcId -cne $endpoint.vpc_id -or
      $live[0].ServiceName -cne $endpoint.service_name -or $live[0].State -cne 'available'){throw 'RestoreRoleEndpointIdentityChanged'}
    Assert-RestoreRolePolicyEqual $live[0].PolicyDocument $endpoint.policy
  }
}
function Assert-RestoreRoleDeactivation {
  if($Transition -cne 'Disable'){return}
  $roleName='ai-job-apply-development-deletion-restore'
  if($Stage -ceq 'Bootstrap'){
    if($null -ne (Invoke-RestoreRoleAws @('iam','get-role','--role-name',$roleName) -AllowAbsent)){throw 'RestoreRoleMustBeRemovedBeforeBootstrapDisable'}
    $normal=$prior.stage -ceq 'Platform' -and $prior.enabled -is [bool] -and -not $prior.enabled
    $unused=$CleanupMode -ceq 'UnusedRole' -and $prior.stage -ceq 'Bootstrap' -and $prior.enabled -is [bool] -and $prior.enabled -and $prior.lineage -ceq $ExpectedStateLineage -and [long]$prior.serial -le $ExpectedStateSerial
    if(-not $normal -and -not $unused){throw 'RestoreRolePlatformDisableVerificationRequired'}
  }elseif($CleanupMode -ceq 'None' -or $prior.stage -cne 'Platform' -or $prior.enabled -isnot [bool] -or $prior.enabled -ne $true -or
    $prior.lineage -cne $ExpectedStateLineage -or [long]$prior.serial -gt $ExpectedStateSerial){throw 'RestoreRoleActivationVerificationRequired'}
  $functions=@((Invoke-RestoreRoleAws @('lambda','list-functions','--function-version','ALL')).Functions)
  if($functions.Count -gt 2000 -or @($functions|Where-Object {$_.Role -ceq "arn:aws:iam::${ExpectedAccountId}:role/$roleName" -or $_.FunctionName -cmatch '^ai-job-apply-development-replay-[a-f0-9]{32}$'}).Count -ne 0){throw 'RestoreRoleExecutorStillPresent'}
  $databases=@((Invoke-RestoreRoleAws @('rds','describe-db-instances')).DBInstances)
  if($databases.Count -gt 1000 -or @($databases|Where-Object {$_.DBInstanceIdentifier -clike 'ai-job-apply-development-restore-*'}).Count -ne 0){throw 'RestoreRoleDisposableRestoreStillPresent'}
  if($Stage -ceq 'Platform' -and $CleanupMode -ceq 'CompletedDrill'){
    $prep=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ReplayPreparationPath)) -DateKind String
    $context=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($RestoreContextPath)) -DateKind String
    $journal=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ReplayCleanupJournalPath)) -DateKind String
    Assert-DeletionReplayPreparation $prep
    $config=Assert-DeletionReplayEnvironment $prep.createRequest.Environment.Variables -AllowExpired
    Assert-RestoreRoleCleanupEvidence $prep $config $context $journal $ReviewedReplayPreparationSha256 $ReviewedRestoreContextSha256 $ExpectedAccountId
  }
}

try{
  if($Action -ceq 'Apply' -and -not $Execute){throw 'RestoreRoleExplicitExecutionRequired'}
  foreach($entry in @(Get-ChildItem Env:)){
    if(($entry.Name -imatch '^(?:TF_VAR_|TF_CLI_ARGS|TF_LOG)' -or $entry.Name -imatch '^AWS_ENDPOINT_URL' -or $entry.Name -in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN')) -and $entry.Value){throw 'RestoreRoleAmbientOverrideRejected'}
  }
  $env:AWS_PROFILE='ai-job-apply-development-admin';$env:AWS_REGION='us-east-2';$env:AWS_DEFAULT_REGION='us-east-2';$env:AWS_PAGER=''
  $terraformDirectory=Join-Path $repository $(if($Stage -ceq 'Bootstrap'){'infrastructure/terraform/bootstrap'}else{'infrastructure/terraform/environments/development'})
  $stateKey=if($Stage -ceq 'Bootstrap'){'bootstrap.tfstate'}else{'platform.tfstate'}
  $TerraformDataDirectory=[IO.Path]::GetFullPath($TerraformDataDirectory,$repository)
  if(-not $TerraformDataDirectory.StartsWith($terraformDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'RestoreRoleDataDirectoryOutsideStage'}
  $env:TF_DATA_DIR=$TerraformDataDirectory
  if($StateKmsKeyArn -cnotmatch "^arn:aws:kms:us-east-2:${ExpectedAccountId}:key/[a-f0-9-]{36}$"){throw 'RestoreRoleStateKeyAccountRejected'}
  Assert-RestoreRoleSession
  $baselinePath=Resolve-RestoreRolePath $BaselinePlanPath
  $bindings=@(@{path=$baselinePath;sha256=$ReviewedBaselineSha256})
  foreach($file in @($PSCommandPath,$guardPath,(Join-Path $PSScriptRoot 'lib/terraform-toolchain.ps1'),(Join-Path $PSScriptRoot 'lib/deployment-operator-guards.ps1'),(Join-Path $PSScriptRoot 'lib/development-document-dark-guards.ps1'),(Join-Path $PSScriptRoot 'lib/candidate-deletion-replay.ps1'),(Join-Path $PSScriptRoot 'lib/staging-postgresql-restore-verifier.ps1'),(Join-Path $TerraformDataDirectory 'terraform.tfstate'),(Join-Path $terraformDirectory '.terraform.lock.hcl'))){
    $bindings+=@{path=[IO.Path]::GetFullPath($file);sha256=(Get-RestoreRoleHash $file)}
  }
  if($Transition -ceq 'Disable'){
    $PriorVerificationPath=Resolve-RestoreRolePath $PriorVerificationPath
    $bindings+=@{path=$PriorVerificationPath;sha256=$ReviewedPriorVerificationSha256}
    Assert-RestoreRoleFileBindings $bindings
    $prior=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($PriorVerificationPath)) -DateKind String
    if($prior.schemaVersion -ne 1 -or $prior.kind -cne 'development-deletion-restore-role-verification' -or $prior.accountId -cne $ExpectedAccountId -or $prior.stateBucket -cne $StateBucket){throw 'RestoreRolePriorVerificationRejected'}
    if($Stage -ceq 'Platform' -and $CleanupMode -ceq 'CompletedDrill'){
      $ReplayPreparationPath=Resolve-RestoreRolePath $ReplayPreparationPath;$RestoreContextPath=Resolve-RestoreRolePath $RestoreContextPath
      $bindings+=@{path=$ReplayPreparationPath;sha256=$ReviewedReplayPreparationSha256};$bindings+=@{path=$RestoreContextPath;sha256=$ReviewedRestoreContextSha256}
      $ReplayCleanupJournalPath=Resolve-RestoreRolePath $ReplayCleanupJournalPath
      $bindings+=@{path=$ReplayCleanupJournalPath;sha256=$ReviewedReplayCleanupJournalSha256}
    }elseif($ReplayPreparationPath -or $RestoreContextPath -or $ReplayCleanupJournalPath){throw 'RestoreRoleUnexpectedCleanupInput'}
  }elseif($CleanupMode -cne 'None' -or $PriorVerificationPath -or $ReplayPreparationPath -or $RestoreContextPath -or $ReplayCleanupJournalPath){throw 'RestoreRoleUnexpectedCleanupInput'}
  Assert-RestoreRoleFileBindings $bindings
  $baseline=Read-DeploymentTerraformPlan -Path $baselinePath -TerraformDirectory $terraformDirectory
  Assert-RestoreRolePlanEnvelope $baseline -ZeroDrift -Stage $Stage
  $enable=$Transition -ceq 'Enable'
  $privateRoot=Join-Path $repository '.tmp/deletion-restore-role'
  if($Action -ceq 'Plan'){
    if($PlanPath){throw 'RestoreRolePlanPathMustBeGenerated'}
    $runDirectory=Join-Path $privateRoot ($Stage.ToLowerInvariant()+'-'+[guid]::NewGuid().ToString('N'))
    $null=Resolve-RestoreRolePath (Join-Path $runDirectory 'transition.tfplan') -New
    $null=New-Item -ItemType Directory -Path $runDirectory
    $acl=[Security.AccessControl.DirectorySecurity]::new();$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $runDirectory -AclObject $acl
    $PlanPath=Join-Path $runDirectory 'transition.tfplan'
  }else{
    $PlanPath=Resolve-RestoreRolePath $PlanPath;$runDirectory=[IO.Path]::GetDirectoryName($PlanPath)
    if([IO.Path]::GetDirectoryName($runDirectory) -cne $privateRoot -or [IO.Path]::GetFileName($PlanPath) -cne 'transition.tfplan'){throw 'RestoreRoleRunPathRejected'}
  }
  $inputPath=Join-Path $runDirectory 'inputs.tfvars.json';$metadataPath=Join-Path $runDirectory 'review.json'
  $appliedPath=Join-Path $runDirectory 'applied.json';$attemptPath=Join-Path $runDirectory 'apply-attempt.json'
  if($Action -ceq 'Plan'){
    $phase='plan'
    Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $ExpectedStateLineage $ExpectedStateSerial
    Assert-RestoreRoleStateMatchesPlan $baseline
    Assert-RestoreRoleLive $baseline (-not $enable)
    Assert-RestoreRoleDeactivation
    $inputs=[ordered]@{}
    foreach($property in $baseline.variables.PSObject.Properties){$inputs[$property.Name]=$property.Value.value}
    $inputs['candidate_deletion_restore_role_enabled']=$enable
    Write-RestoreRoleJson $inputPath $inputs
    Set-RestoreRoleInputs (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($inputPath)) -DateKind String)
    $bindings+=@{path=$inputPath;sha256=(Get-RestoreRoleHash $inputPath)}
    Assert-RestoreRoleSession;Assert-RestoreRoleFileBindings $bindings
    $null=Invoke-RestoreRoleTerraform @('plan','-refresh=true','-input=false','-lock-timeout=5m',"-out=$PlanPath")
    $plan=Read-DeploymentTerraformPlan -Path $PlanPath -TerraformDirectory $terraformDirectory
    $summary=Assert-RestoreRoleTransitionPlan $plan $baseline $Stage $enable $ExpectedAccountId
    Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $ExpectedStateLineage $ExpectedStateSerial
    Assert-RestoreRoleFileBindings $bindings
    $bindings+=@{path=$PlanPath;sha256=(Get-RestoreRoleHash $PlanPath)}
    Write-RestoreRoleJson $metadataPath @{schemaVersion=1;kind='development-deletion-restore-role-plan';stage=$Stage;enabled=$enable;sourceSha=$SourceSha;accountId=$ExpectedAccountId;stateBucket=$StateBucket;stateKey=$stateKey;stateKmsKeyArn=$StateKmsKeyArn;lineage=$ExpectedStateLineage;serial=$ExpectedStateSerial;cleanupMode=$CleanupMode;bindings=$bindings;createdAt=[DateTimeOffset]::UtcNow.ToString('o')}
    @{stage='review-required';transition=$Transition;scope=$Stage;changedResources=$summary.ChangedResources;creates=$summary.Creates;deletes=$summary.Deletes;planPath=$PlanPath;planSha256=(Get-RestoreRoleHash $PlanPath);metadataPath=$metadataPath;metadataSha256=(Get-RestoreRoleHash $metadataPath)}|ConvertTo-Json -Compress
    exit 0
  }
  Assert-RestoreRoleFileBindings @(@{path=$PlanPath;sha256=$ReviewedPlanSha256},@{path=$metadataPath;sha256=$ReviewedMetadataSha256})
  $metadata=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($metadataPath)) -DateKind String
  if($metadata.schemaVersion -ne 1 -or $metadata.kind -cne 'development-deletion-restore-role-plan' -or $metadata.stage -cne $Stage -or $metadata.enabled -isnot [bool] -or
    $metadata.enabled -ne $enable -or $metadata.sourceSha -cne $SourceSha -or $metadata.accountId -cne $ExpectedAccountId -or $metadata.stateBucket -cne $StateBucket -or
    $metadata.stateKey -cne $stateKey -or $metadata.stateKmsKeyArn -cne $StateKmsKeyArn -or $metadata.lineage -cne $ExpectedStateLineage -or $metadata.serial -ne $ExpectedStateSerial -or
    $metadata.cleanupMode -cne $CleanupMode){throw 'RestoreRoleReviewedMetadataMismatch'}
  $expectedPaths=@($bindings.path)+@($inputPath,$PlanPath)
  if((@($metadata.bindings.path|Sort-Object)-join ',') -cne (@($expectedPaths|Sort-Object)-join ',')){throw 'RestoreRoleReviewedBindingInventoryChanged'}
  $bindings=@($metadata.bindings)+@(@{path=$metadataPath;sha256=$ReviewedMetadataSha256})
  Assert-RestoreRoleFileBindings $bindings
  Set-RestoreRoleInputs (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($inputPath)) -DateKind String)
  $plan=Read-DeploymentTerraformPlan -Path $PlanPath -TerraformDirectory $terraformDirectory
  $null=Assert-RestoreRoleTransitionPlan $plan $baseline $Stage $enable $ExpectedAccountId
  if($Action -ceq 'Apply'){
    $phase='apply'
    if(Test-Path -LiteralPath $attemptPath){throw 'RestoreRolePriorApplyAttemptRequiresIndependentRecovery'}
    Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $ExpectedStateLineage $ExpectedStateSerial
    Assert-RestoreRoleStateMatchesPlan $baseline;Assert-RestoreRoleLive $baseline (-not $enable)
    Assert-RestoreRoleDeactivation
    Write-RestoreRoleJson $attemptPath @{schemaVersion=1;planSha256=$ReviewedPlanSha256;metadataSha256=$ReviewedMetadataSha256;startedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    Assert-RestoreRoleSession
    Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $ExpectedStateLineage $ExpectedStateSerial
    Assert-RestoreRoleFileBindings $bindings
    $null=Invoke-RestoreRoleTerraform @('apply','-input=false','-lock-timeout=5m',$PlanPath)
    $after=Get-RestoreRoleState
    if($after.lineage -cne $ExpectedStateLineage -or [long]$after.serial -le $ExpectedStateSerial){throw 'RestoreRoleAppliedStateUnconfirmed'}
    Write-RestoreRoleJson $appliedPath @{schemaVersion=1;kind='development-deletion-restore-role-applied';sourceSha=$SourceSha;planSha256=$ReviewedPlanSha256;metadataSha256=$ReviewedMetadataSha256;lineage=$after.lineage;serial=$after.serial;appliedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    @{stage='applied-verification-required';scope=$Stage;transition=$Transition;receiptPath=$appliedPath;receiptSha256=(Get-RestoreRoleHash $appliedPath);stateSerial=$after.serial}|ConvertTo-Json -Compress
    exit 0
  }
  $phase='verify'
  $bindings+=@{path=$appliedPath;sha256=$ReviewedAppliedReceiptSha256}
  Assert-RestoreRoleFileBindings $bindings
  $applied=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($appliedPath)) -DateKind String
  if($applied.kind -cne 'development-deletion-restore-role-applied' -or $applied.sourceSha -cne $SourceSha -or $applied.planSha256 -cne $ReviewedPlanSha256 -or $applied.metadataSha256 -cne $ReviewedMetadataSha256 -or $applied.lineage -cne $ExpectedStateLineage -or [long]$applied.serial -le $ExpectedStateSerial){throw 'RestoreRoleAppliedReceiptRejected'}
  Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $applied.lineage ([long]$applied.serial)
  $verifyPath=Join-Path $runDirectory ('verify-'+[guid]::NewGuid().ToString('N')+'.tfplan')
  $null=Invoke-RestoreRoleTerraform @('plan','-refresh=true','-input=false','-lock-timeout=5m',"-out=$verifyPath")
  $verified=Read-DeploymentTerraformPlan -Path $verifyPath -TerraformDirectory $terraformDirectory
  $verifyHash=Get-RestoreRoleHash $verifyPath
  $bindings+=@{path=$verifyPath;sha256=$verifyHash}
  Assert-RestoreRolePlanEnvelope $verified -ZeroDrift -Stage $Stage
  if((ConvertTo-RestoreRoleCanonical $verified.variables) -cne (ConvertTo-RestoreRoleCanonical $plan.variables)){throw 'RestoreRoleVerificationInputsChanged'}
  Assert-RestoreRoleStateMatchesPlan $verified;Assert-RestoreRoleLive $verified $enable
  Assert-RestoreRoleSession;Assert-RestoreRoleStateIdentity (Get-RestoreRoleState) $applied.lineage ([long]$applied.serial)
  Assert-RestoreRoleFileBindings $bindings
  $receiptPath=Join-Path $runDirectory 'verified.json'
  Write-RestoreRoleJson $receiptPath @{schemaVersion=1;kind='development-deletion-restore-role-verification';stage=$Stage;enabled=$enable;accountId=$ExpectedAccountId;stateBucket=$StateBucket;sourceSha=$SourceSha;lineage=$applied.lineage;serial=$applied.serial;appliedReceiptSha256=$ReviewedAppliedReceiptSha256;planSha256=$ReviewedPlanSha256;runtimePlanPath=$verifyPath;runtimePlanSha256=$verifyHash;cleanupMode=$CleanupMode;verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  @{stage='verified';scope=$Stage;transition=$Transition;zeroDrift=$true;runtimePlanPath=$verifyPath;runtimePlanSha256=$verifyHash;receiptPath=$receiptPath;receiptSha256=(Get-RestoreRoleHash $receiptPath);stateSerial=$applied.serial}|ConvertTo-Json -Compress
}catch{
  $classification=if($_.Exception.Message -cmatch '^RestoreRole[A-Za-z0-9]{1,100}$'){$_.Exception.Message}else{'restore-role-boundary-or-operation-failed'}
  Write-Output (ConvertTo-Json -Compress @{stage=$phase;result='failed';classification=$classification;automaticRetryAllowed=$false})
  exit 1
}
