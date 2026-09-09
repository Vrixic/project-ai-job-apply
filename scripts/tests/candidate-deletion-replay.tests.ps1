#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $root 'scripts/lib/candidate-deletion-replay.ps1')
$fixture = ConvertFrom-D1RestoreJson ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/candidate-deletion-restore-contract.v1.json')))
$now = [datetimeoffset]$fixture.now
$script:checks = 0
function Assert([bool]$Condition, [string]$Label) { if (-not $Condition) { throw "Synthetic test failed: $Label" }; $script:checks++ }
function Reject([scriptblock]$Run, [string]$Label) { $rejected = $false; try { $null = & $Run } catch { $rejected = $true }; Assert $rejected $Label }
function Clone([object]$Value) { return ConvertFrom-D1RestoreJson (ConvertTo-Json -InputObject $Value -Depth 80) }

Assert ((Get-DeletionReplayConfigJson $fixture.configuration $now) -ceq $fixture.environment.RESTORE_REPLAY_CONFIG_JSON) 'TS/PowerShell exact ordered configuration'
Assert ((Get-DeletionReplayEnvironmentSha $fixture.environment) -ceq $fixture.configurationSha256) 'TS/PowerShell exact environment digest'
$null = Assert-DeletionReplayEnvironment $fixture.environment $now
Assert $true 'generated-only complete fixture accepted'
Assert ($fixture.configuration.acceptedPolicyCatalogSha256 -ceq '4549e90155b66007655f118dd597fa41c9711a5d76ef5d1562185277df842627') 'known immutable catalog digest matches shared fixture'
$boundaryConfig = Clone $fixture.configuration
$boundaryConfig.expiresAt = $now.AddSeconds(300).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$null = Get-DeletionReplayConfigJson $boundaryConfig $now
Assert $true 'exact300second invocation budget agrees with TypeScript'
$boundaryConfig.expiresAt = $now.AddMilliseconds(299999).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
Reject { Get-DeletionReplayConfigJson $boundaryConfig $now } 'less than300seconds is rejected'
$boundaryConfig = Clone $fixture.configuration
$boundaryConfig.acceptedPolicyCatalogSha256 = 'f'*64
Reject { Get-DeletionReplayConfigJson $boundaryConfig $now } 'unknown catalog rejected before creation'
$inspectionDigest = Get-DeletionReplaySha ("candidate-deletion-restore-inspection-v1`n" + (ConvertTo-Json -InputObject @($fixture.configurationSha256,$fixture.markerSnapshotSha256,$fixture.restoredPreflightSha256) -Compress) + "`n")
Assert ($inspectionDigest -ceq $fixture.inspectionSha256) 'TS/PowerShell exact inspection digest'
foreach ($key in $script:DeletionReplayConfigKeys) {
  $config = Clone $fixture.configuration
  $config.PSObject.Properties.Remove($key)
  Reject { Get-DeletionReplayConfigJson $config $now } "missing config $key"
  $config = Clone $fixture.configuration
  $config.$key = @($config.$key)
  Reject { Get-DeletionReplayConfigJson $config $now } "non-scalar config $key"
}
foreach ($change in @(
  @('schemaVersion','1'),@('schemaVersion',2),@('runId',('a'*31)),@('accountId','11112222333'),@('region','us-east-1'),
  @('sourceSha',('a'*39)),@('sourceIdentifier','ai-job-apply-staging'),@('targetIdentifier','ai-job-apply-development'),
  @('targetIdentifier','ai-job-apply-development-restore-example'),@('targetDbiResourceId',$fixture.configuration.sourceDbiResourceId),
  @('targetBoundarySha256',$fixture.configuration.sourceBoundarySha256),@('targetHostname',$fixture.configuration.sourceHostname),
  @('sourceHostname','ai-job-apply-development.example.invalid'),@('databasePort','5432'),@('databasePort',5433),
  @('databaseName','other_database'),@('restoreManifestSha256',('f'*64)),@('issuedAt','2026-09-08T00:00:00Z'),
  @('expiresAt',$now.AddMinutes(31).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")),
  @('expiresAt',$now.AddSeconds(299).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")),
  @('issuedAt',$now.AddMinutes(1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"))
)) {
  $config = Clone $fixture.configuration
  $config.($change[0]) = $change[1]
  Reject { Get-DeletionReplayConfigJson $config $now } "bad config $($change[0])"
}
$config = Clone $fixture.configuration
$config | Add-Member -NotePropertyName databaseUrl -NotePropertyValue 'postgresql://forbidden.invalid'
Reject { Get-DeletionReplayConfigJson $config $now } 'extra endpoint override'
$config = Clone $fixture.configuration
$config.expiresAt = $now.AddMinutes(-1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$config.issuedAt = $now.AddMinutes(-20).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
Reject { Get-DeletionReplayConfigJson $config $now } 'expired invocation refused'
$null = Get-DeletionReplayConfigJson $config $now -AllowExpired
Assert $true 'expiry bypass restricted to cleanup caller'

foreach ($key in $script:DeletionReplayEnvironmentKeys) {
  $environment = Clone $fixture.environment
  $environment.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayEnvironment $environment $now } "missing environment $key"
}
foreach ($key in @('DATABASE_URL','RESTORE_DATABASE_URL','AUTH0_CLIENT_SECRET','CANDIDATE_RIGHTS_AUTH0_SECRET_ID','AWS_ENDPOINT_URL')) {
  $environment = Clone $fixture.environment
  $environment | Add-Member -NotePropertyName $key -NotePropertyValue 'forbidden'
  Reject { Assert-DeletionReplayEnvironment $environment $now } "forbidden environment $key"
}
foreach ($change in @(
  @('NODE_ENV','development'),@('RELEASE_SHA','local'),@('DATABASE_SECRET_ID','arn:aws:secretsmanager:us-east-2:999900001111:secret:wrong'),
  @('CANDIDATE_DOCUMENT_BUCKET','wrong-bucket'),@('CANDIDATE_DELETION_RECOVERY_BUCKET',$fixture.environment.CANDIDATE_DOCUMENT_BUCKET),
  @('CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN','arn:aws:kms:us-east-2:999900001111:key/00000000-0000-0000-0000-000000000000')
)) {
  $environment = Clone $fixture.environment
  $environment.($change[0]) = $change[1]
  $environment.RESTORE_REPLAY_CONFIG_SHA256 = Get-DeletionReplayEnvironmentSha $environment
  Reject { Assert-DeletionReplayEnvironment $environment $now } "self-consistent but invalid environment $($change[0])"
}
$environment = Clone $fixture.environment
$environment.RESTORE_REPLAY_CONFIG_JSON = $fixture.environment.RESTORE_REPLAY_CONFIG_JSON + ' '
$environment.RESTORE_REPLAY_CONFIG_SHA256 = Get-DeletionReplayEnvironmentSha $environment
Reject { Assert-DeletionReplayEnvironment $environment $now } 'noncanonical JSON even with updated hash'

function New-Database([bool]$Target) {
  $id = if ($Target) { $fixture.configuration.targetIdentifier } else { $fixture.configuration.sourceIdentifier }
  return [pscustomobject]@{
    DBInstanceIdentifier=$id;DBInstanceArn="arn:aws:rds:us-east-2:$($fixture.configuration.accountId):db:$id"
    DbiResourceId=$(if($Target){$fixture.configuration.targetDbiResourceId}else{$fixture.configuration.sourceDbiResourceId})
    Endpoint=@{Address="$id.synthetic.us-east-2.rds.amazonaws.com";Port=5432};Engine='postgres';EngineVersion='16.6';DBInstanceClass='db.t4g.micro'
    AvailabilityZone='us-east-2a';AutoMinorVersionUpgrade=$false;StorageType='gp3';AllocatedStorage=20;MaxAllocatedStorage=0;Iops=0;StorageThroughput=0
    PerformanceInsightsEnabled=$false;KmsKeyId=$fixture.environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN;IAMDatabaseAuthenticationEnabled=$true
    DBName='ai_job_apply';MasterUsername='synthetic';NetworkType='IPV4';CACertificateIdentifier='rds-ca-rsa2048-g1'
    DBSubnetGroup=@{DBSubnetGroupName='synthetic-private';VpcId='vpc-00000000000000001'}
    VpcSecurityGroups=@(@{VpcSecurityGroupId='sg-00000000000000001'});DBParameterGroups=@(@{DBParameterGroupName='synthetic';ParameterApplyStatus='in-sync'})
    OptionGroupMemberships=@(@{OptionGroupName='synthetic';Status='in-sync'});EnabledCloudwatchLogsExports=@('postgresql')
    DBInstanceStatus='available';PubliclyAccessible=$false;StorageEncrypted=$true;DeletionProtection=(-not $Target);MultiAZ=$false;BackupRetentionPeriod=35
  }
}
$source = New-Database $false
$target = New-Database $true
$context = [pscustomobject]@{
  verified=$true;target_boundary_authenticated=$true;source_identifier=$source.DBInstanceIdentifier;target_identifier=$target.DBInstanceIdentifier
  source_resource_arn=$source.DBInstanceArn;target_resource_arn=$target.DBInstanceArn;source_dbi_resource_id=$source.DbiResourceId;target_dbi_resource_id=$target.DbiResourceId
  source_boundary_sha256=(Get-DeletionReplaySha (Get-DeletionReplayRdsBoundaryJson $source));target_boundary_sha256=(Get-DeletionReplaySha (Get-DeletionReplayRdsBoundaryJson $target));started_at='2026-09-08T00:00:00Z'
}
$tags = @{Project='ai-job-apply';Environment='development';ManagedBy='restore-drill';Purpose='d1-current-isolated-restore';StartedAt=$context.started_at}
$null = Assert-DeletionReplayRds $source $target $context $tags $fixture.configuration.accountId
Assert $true 'exact verified disposable restore accepted'
foreach ($side in @('source','target')) {
  foreach ($field in @('DBInstanceIdentifier','DBInstanceArn','DbiResourceId','DBInstanceStatus','PubliclyAccessible','StorageEncrypted','DeletionProtection','BackupRetentionPeriod')) {
    if ($side -ceq 'target' -and $field -ceq 'BackupRetentionPeriod') { continue }
    $changed = Clone $(if($side -ceq 'source'){$source}else{$target})
    $changed.$field = $(if($changed.$field -is [bool]){-not $changed.$field}elseif($changed.$field -is [int]){1}else{'changed'})
    Reject { if ($side -ceq 'source') { Assert-DeletionReplayRds $changed $target $context $tags $fixture.configuration.accountId } else { Assert-DeletionReplayRds $source $changed $context $tags $fixture.configuration.accountId } } "$side $field rejected"
  }
}
foreach ($field in @('Project','Environment','ManagedBy','Purpose','StartedAt')) {
  $changedTags = @{} + $tags; $changedTags[$field] = 'changed'
  Reject { Assert-DeletionReplayRds $source $target $context $changedTags $fixture.configuration.accountId } "target tag $field"
}
$tokens=$null; $errors=$null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/operate-staging-postgresql-restore.ps1'),[ref]$tokens,[ref]$errors)
$projection = $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-SourceIdentityBoundaryJson'},$true)
Assert ($projection.Count -eq 1) 'maintained PITR projection found exactly once'
. ([scriptblock]::Create($projection[0].Extent.Text))
Assert ((Get-SourceIdentityBoundaryJson $source) -ceq (Get-DeletionReplayRdsBoundaryJson $source)) 'current PITR source projection parity'
Assert ((Get-SourceIdentityBoundaryJson $target) -ceq (Get-DeletionReplayRdsBoundaryJson $target)) 'current PITR target projection parity'

$create = Clone ([pscustomobject]@{
  FunctionName="ai-job-apply-development-replay-$($fixture.configuration.runId)";Runtime='nodejs24.x'
  Role="arn:aws:iam::$($fixture.configuration.accountId):role/ai-job-apply-development-deletion-restore"
  Handler='index.handler';Description='Temporary private isolated restore deletion replay';Timeout=300;MemorySize=512;Publish=$true;Architectures=@('x86_64')
  Layers=@('arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114')
  VpcConfig=@{SubnetIds=@('subnet-00000000000000001','subnet-00000000000000002');SecurityGroupIds=@('sg-00000000000000001')}
  Environment=@{Variables=$fixture.environment};LoggingConfig=@{LogFormat='JSON';LogGroup='/ai-job-apply/development/application'}
  Tags=@{Project='ai-job-apply';Environment='development';ManagedBy='restore-drill';Purpose='candidate-deletion-restore';RunId=$fixture.configuration.runId;ConfigurationSha256=$fixture.configurationSha256;SourceSha=$fixture.configuration.sourceSha}
})
$preparation = Clone ([pscustomobject]@{
  schemaVersion=1;kind='candidate-deletion-restore-preparation';runId=$fixture.configuration.runId;accountId=$fixture.configuration.accountId
  sourceSha=$fixture.configuration.sourceSha;stateBucket='ai-job-apply-development-state-synthetic';runtimePlanPath='synthetic-only.tfplan';runtimePlanSha256=('e'*64)
  configurationSha256=$fixture.configurationSha256;artifactBucket='synthetic-artifact-bucket';artifactSha256=$fixture.environment.RELEASE_SHA
  artifactBase64Sha256=[Convert]::ToBase64String([Convert]::FromHexString($fixture.environment.RELEASE_SHA))
  artifactKey="lambda/candidate-deletion-restore/$($fixture.configuration.sourceSha)/$($fixture.environment.RELEASE_SHA)/candidate-deletion-restore-lambda.zip"
  roleBoundary=@{roleArn=$create.Role};createRequest=$create;fileBindings=@(1..8 | ForEach-Object { @{path="synthetic-$_.json";sha256=('e'*64)} })
})
Assert-DeletionReplayPreparation $preparation
Assert $true 'strict generated preparation accepted'
foreach ($key in $create.PSObject.Properties.Name) {
  $changed = Clone $preparation
  $changed.createRequest.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayPreparation $changed } "missing create request $key"
}
foreach ($key in @('KMSKeyArn','Code','ImageConfig','DeadLetterConfig','FileSystemConfigs')) {
  $changed = Clone $preparation
  $changed.createRequest | Add-Member -NotePropertyName $key -NotePropertyValue 'forbidden'
  Reject { Assert-DeletionReplayPreparation $changed } "unreviewed create capability $key"
}
$function = Clone ([pscustomobject]@{
  Configuration=@{
    FunctionName=$create.FunctionName;FunctionArn=$fixture.invokedFunctionArn;Version=$fixture.inspect.functionVersion
    Role=$create.Role;Runtime='nodejs24.x';Handler='index.handler';MemorySize=512;Timeout=300;Architectures=@('x86_64')
    CodeSha256=$preparation.artifactBase64Sha256;State='Active';LastUpdateStatus='Successful';Environment=$create.Environment
    Layers=@(@{Arn=$create.Layers[0]});VpcConfig=$create.VpcConfig;LoggingConfig=$create.LoggingConfig
  };Tags=$create.Tags
})
Assert-DeletionReplayFunction $function $preparation $fixture.inspect.functionVersion
Assert $true 'exact private numeric function readback accepted'
foreach ($change in @(
  @('FunctionName','other'),@('FunctionArn',($fixture.invokedFunctionArn + '-tampered')),
  @('Version','0'),@('Role','arn:aws:iam::111122223333:role/other'),@('Runtime','nodejs22.x'),@('Handler','index.activity'),
  @('MemorySize',1024),@('Timeout',900),@('Architectures',@('arm64')),@('CodeSha256','wrong'),@('State','Failed'),@('LastUpdateStatus','InProgress')
)) {
  $changed = Clone $function
  $changed.Configuration.($change[0]) = $change[1]
  Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion } "changed function $($change[0])"
}
$changed = Clone $function
$changed.Configuration | Add-Member -NotePropertyName KMSKeyArn -NotePropertyValue $fixture.environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN
Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion } 'custom environment KMS requires unavailable role permissions'
foreach ($field in @('Environment','Layers','VpcConfig','LoggingConfig')) {
  $changed = Clone $function; $changed.Configuration.$field = [pscustomobject]@{}
  Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion } "changed function $field"
}
$changed = Clone $function; $changed.Tags.RunId = 'other'
Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion } 'retagged function cleanup refused'
Reject { Assert-DeletionReplayFunction $function $preparation '$LATEST' } 'unqualified version refused'
Reject { Assert-DeletionReplayFunction $function $preparation $fixture.inspect.functionVersion 2 } 'higher concurrency refused'
foreach ($state in @('Pending','Failed','Inactive')) {
  $changed = Clone $function; $changed.Configuration.State=$state; $changed.Configuration.LastUpdateStatus='Failed'
  Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion } "inspection/replay rejects $state"
  Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion -1 -AllowUnready
  Assert $true "cleanup accepts exact $state version before forced zero/drain"
}
foreach ($count in @(-1,0)) { Reject { Assert-DeletionReplayFunction $function $preparation $fixture.inspect.functionVersion $count } 'inspection/replay require explicit concurrency one' }
foreach ($field in @('CodeSha256','Role','Version')) {
  $changed = Clone $function; $changed.Configuration.State='Failed'; $changed.Configuration.$field='wrong'
  Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion -1 -AllowUnready } "failed cleanup still checks $field"
}
$changed = Clone $function; $changed.Configuration.State='Failed'; $changed.Tags.Purpose='other'
Reject { Assert-DeletionReplayFunction $changed $preparation $fixture.inspect.functionVersion -1 -AllowUnready } 'failed cleanup still checks exact tags'
Reject { Assert-DeletionReplayFunction $function $preparation '$LATEST' -1 -AllowUnready } 'cleanup cannot widen to latest-only partial creation'

$aggregate = [pscustomobject]@{
  schemaVersion=1;action='inspect';outcome='inspected';runId=$fixture.configuration.runId;sourceSha=$fixture.configuration.sourceSha
  configurationSha256=$fixture.configurationSha256;functionVersion=$fixture.inspect.functionVersion;expiresAt=$fixture.configuration.expiresAt
  markerSnapshotSha256=$fixture.markerSnapshotSha256;restoredPreflightSha256=$fixture.restoredPreflightSha256;inspectionSha256=$fixture.inspectionSha256
  markersValidated=3;historicalPolicyMarkers=1;currentPolicyMarkers=2;restoredSubjectsPresent=2;restoredSubjectsAbsent=1;documentKeysChecked=4;documentVersionsObserved=0
}
Assert-DeletionReplayAggregate $aggregate $fixture.inspect $fixture.configuration
Assert $true 'aggregate inspection accepted'
$replayAggregate = Clone $aggregate
$replayAggregate.action='replay';$replayAggregate.outcome='replayed'
foreach ($pair in @(@('restoredUsersReconciled',1),@('restoredUsersAbsent',1),@('restoredUsersAlreadyReconciled',1),@('s3Writes',0),@('recoveryLedgerWrites',0),@('identityProviderCalls',0))) { $replayAggregate | Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1] }
Assert-DeletionReplayAggregate $replayAggregate $fixture.replay $fixture.configuration
Assert $true 'aggregate replay distinguishes retained tombstones from absent users'
foreach ($key in $replayAggregate.PSObject.Properties.Name) {
  $changed = Clone $replayAggregate; $changed.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } "missing aggregate $key"
}
foreach ($key in @('markersValidated','historicalPolicyMarkers','currentPolicyMarkers','restoredSubjectsPresent','restoredSubjectsAbsent','documentKeysChecked','documentVersionsObserved','restoredUsersReconciled','restoredUsersAbsent','restoredUsersAlreadyReconciled','s3Writes','recoveryLedgerWrites','identityProviderCalls')) {
  foreach ($bad in @(-1,'0',1.5,[long]2147483648)) {
    $changed = Clone $replayAggregate; $changed.$key = $bad
    Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } "unbounded/noninteger aggregate $key"
  }
}
foreach ($key in @('markersValidated','historicalPolicyMarkers','currentPolicyMarkers','restoredSubjectsPresent','restoredSubjectsAbsent','documentVersionsObserved','restoredUsersReconciled','restoredUsersAbsent','restoredUsersAlreadyReconciled','s3Writes','recoveryLedgerWrites','identityProviderCalls')) {
  $changed = Clone $replayAggregate; $changed.$key++
  Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } "aggregate algebra or effects $key"
}
$changed = Clone $replayAggregate; $changed.expiresAt=$fixture.configuration.issuedAt
Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'response expiry must match frozen configuration'
$changed = Clone $replayAggregate; $changed.inspectionSha256=('f'*64)
Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'canonical inspection digest recomputed'
$changed = Clone $replayAggregate; $changed | Add-Member -NotePropertyName candidateId -NotePropertyValue 'forbidden'
Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'nonaggregate response refused'

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai-job-apply-deletion-replay-tests-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $tempRoot
try {
  $path = Join-Path $tempRoot 'run/preparation.json'
  Assert ((Resolve-DeletionReplayPrivatePath $path $tempRoot) -ceq [IO.Path]::GetFullPath($path)) 'owned private child accepted'
  foreach ($pathAttempt in @($tempRoot,(Join-Path $tempRoot '../outside.json'),($tempRoot + '-neighbor/receipt.json'),[IO.Path]::GetPathRoot($tempRoot))) { Reject { Resolve-DeletionReplayPrivatePath $pathAttempt $tempRoot } 'outside private boundary rejected' }
  Write-DeletionReplayPrivateJson $path @{synthetic=$true}
  $reviewed = Get-D1RestoreFileSha256 $path
  Assert-DeletionReplayHash $path $reviewed
  Assert $true 'reviewed bytes accepted'
  Reject { Write-DeletionReplayPrivateJson $path @{synthetic=$true} } 'existing evidence never overwritten by default'
  Write-DeletionReplayPrivateJson $path @{synthetic=$false} -Replace
  Reject { Assert-DeletionReplayHash $path $reviewed } 'late substitution refused'
  $journal = [pscustomobject]@{schemaVersion=1;status='started';startedAt=$fixture.now}
  Assert ((Get-DeletionReplayCleanupReadyAt $journal) -eq $now.AddSeconds(330)) 'full timeout plus transport grace required'
  $journal.status='unexpected'
  Reject { Get-DeletionReplayCleanupReadyAt $journal } 'malformed invocation journal rejected'
} finally {
  $resolved = [IO.Path]::GetFullPath($tempRoot)
  if ($resolved -cnotmatch 'ai-job-apply-deletion-replay-tests-[a-f0-9]{32}$' -or -not $resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic cleanup target invalid' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

$operatorPath = Join-Path $root 'scripts/operate-development-candidate-deletion-replay.ps1'
$operator = [IO.File]::ReadAllText($operatorPath)
$tokens=$null; $errors=$null
$null = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
Assert (@($errors).Count -eq 0) 'operator PowerShell syntax'
Assert ($operator -match 'Push-Location \$root' -and $operator -match 'Pop-Location') 'workspace-relative maintained operators supported from package cwd'
Assert ($operator -notmatch 'function Git\(') 'shared native Git is never shadowed'
Assert ($operator -match "AWS_MAX_ATTEMPTS = '1'" -and $operator -match 'DeletionReplayAlreadyAttemptedInspectAndReviewRecovery') 'ambiguous replay never automatically retried'
Assert ($operator -match 'Assert-DeletionReplayHash \$disabledPath \$ReviewedCleanupDisabledSha256') 'cleanup drain journal checksum-bound'
$inspector = [IO.File]::ReadAllText((Join-Path $root 'scripts/inspect-staging-workload-and-cost.ps1'))
Assert ($inspector -match '"candidate_deletion_restore_role_enabled"') 'current exact runtime-plan reconstruction retains restore role flag'

# Execute the real operator role reader without loading its top-level cloud actions. Only the
# native AWS boundary is replaced; the plan lookup and policy/ARN comparisons remain unchanged.
& {
  $roleAst = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
  foreach ($name in @('Get-ReplayPlanResource','Read-ReplayPolicy','Get-ReplayRoleBoundary')) {
    $definitions = @($roleAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
    Assert ($definitions.Count -eq 1) "real operator $name found exactly once"
    . ([scriptblock]::Create($definitions[0].Extent.Text))
  }
  $account = '111122223333'
  $roleName = 'ai-job-apply-development-deletion-restore'
  $roleArn = "arn:aws:iam::$account`:role/$roleName"
  $boundaryArn = "arn:aws:iam::$account`:policy/ai-job-apply-development-workload-boundary"
  $assumePolicy = @{Version='2012-10-17';Statement=@(@{Effect='Allow';Action='sts:AssumeRole';Principal=@{Service='lambda.amazonaws.com'}})}
  $inlinePolicy = @{Version='2012-10-17';Statement=@(@{Effect='Allow';Action='s3:ListBucketVersions';Resource='arn:aws:s3:::synthetic-retained-markers'})}
  $endpointPolicy = @{Version='2012-10-17';Statement=@(@{Effect='Allow';Action='s3:ListBucketVersions';Resource='arn:aws:s3:::synthetic-retained-markers';Principal=@{AWS=$roleArn}})}
  $basePlan = Clone @{planned_values=@{root_module=@{child_modules=@(@{resources=@(
    @{address='module.platform.aws_iam_role.candidate_deletion_restore[0]';values=@{name=$roleName;arn=$roleArn;permissions_boundary=$boundaryArn;assume_role_policy=($assumePolicy | ConvertTo-Json -Depth 10 -Compress)}}
    @{address='module.platform.aws_iam_role_policy.candidate_deletion_restore[0]';values=@{name='candidate-deletion-restore-read-only';policy=($inlinePolicy | ConvertTo-Json -Depth 10 -Compress)}}
    @{address='module.platform.aws_vpc_endpoint.candidate_documents_s3[0]';values=@{id='vpce-synthetic-s3';policy=($endpointPolicy | ConvertTo-Json -Depth 10 -Compress)}}
    @{address='module.platform.aws_vpc_endpoint.secretsmanager[0]';values=@{id='vpce-synthetic-secrets';policy=($endpointPolicy | ConvertTo-Json -Depth 10 -Compress)}}
  )})}}}
  $baseCloud = Clone @{
    role=@{Role=@{Arn=$roleArn;RoleId='AROA00000000000000000';PermissionsBoundary=@{PermissionsBoundaryArn=$boundaryArn};AssumeRolePolicyDocument=[Uri]::EscapeDataString(($assumePolicy | ConvertTo-Json -Depth 10 -Compress))}}
    inline=@{PolicyNames=@('candidate-deletion-restore-read-only')}
    attached=@{AttachedPolicies=@()}
    policy=@{PolicyDocument=[Uri]::EscapeDataString(($inlinePolicy | ConvertTo-Json -Depth 10 -Compress))}
    boundary=@{Policy=@{DefaultVersionId='v1'}}
    boundaryVersion=@{PolicyVersion=@{Document=@{Version='2012-10-17';Statement=@(
      @{Sid='RestoreOnlyListRetainedVersions';Effect='Allow';Condition=@{ArnEquals=@{'aws:PrincipalArn'=$roleArn}}}
      @{Sid='RestoreOnlyReadRetainedVersions';Effect='Allow';Condition=@{ArnEquals=@{'aws:PrincipalArn'=$roleArn}}}
    )}}}
    s3=@{VpcEndpoints=@(@{VpcEndpointId='vpce-synthetic-s3';VpcId='vpc-synthetic';ServiceName='com.amazonaws.us-east-2.s3';State='available';PolicyDocument=($endpointPolicy | ConvertTo-Json -Depth 10 -Compress)})}
    secrets=@{VpcEndpoints=@(@{VpcEndpointId='vpce-synthetic-secrets';VpcId='vpc-synthetic';ServiceName='com.amazonaws.us-east-2.secretsmanager';State='available';PolicyDocument=($endpointPolicy | ConvertTo-Json -Depth 10 -Compress)})}
  }
  function Invoke-ReplayAws([string[]]$Arguments) {
    $request = $Arguments -join ' '
    $resultKey = switch -CaseSensitive ($request) {
      "iam get-role --role-name $roleName" { 'role' }
      "iam list-role-policies --role-name $roleName" { 'inline' }
      "iam list-attached-role-policies --role-name $roleName" { 'attached' }
      "iam get-role-policy --role-name $roleName --policy-name candidate-deletion-restore-read-only" { 'policy' }
      "iam get-policy --policy-arn $boundaryArn" { 'boundary' }
      "iam get-policy-version --policy-arn $boundaryArn --version-id v1" { 'boundaryVersion' }
      'ec2 describe-vpc-endpoints --vpc-endpoint-ids vpce-synthetic-s3' { 's3' }
      'ec2 describe-vpc-endpoints --vpc-endpoint-ids vpce-synthetic-secrets' { 'secrets' }
      default { throw 'UnexpectedSyntheticRoleBoundaryRequest' }
    }
    return $cloud.$resultKey
  }
  $plan = Clone $basePlan
  $cloud = Clone $baseCloud
  $result = Get-ReplayRoleBoundary $plan $account
  Assert ($result.roleArn -ceq $roleArn -and $result.roleId -ceq $cloud.role.Role.RoleId) 'real operator accepts standard role/name IAM ARN'
  Assert ($result.endpoints.Count -eq 2 -and $result.boundaryVersion -ceq 'v1') 'real operator validates both private endpoints and current workload boundary'
  foreach ($case in @('colon-delimited-role','wrong-account','wrong-live-role','wrong-boundary','changed-trust','extra-inline-policy','attached-policy','changed-inline-policy','missing-boundary-grant','wrong-boundary-principal','changed-endpoint-policy','unavailable-endpoint')) {
    $plan = Clone $basePlan
    $cloud = Clone $baseCloud
    $expectedRole = Get-ReplayPlanResource $plan 'module.platform.aws_iam_role.candidate_deletion_restore[0]'
    switch ($case) {
      'colon-delimited-role' { $expectedRole.arn=$roleArn.Replace(':role/',':role:'); $cloud.role.Role.Arn=$expectedRole.arn }
      'wrong-account' { $expectedRole.arn=$roleArn.Replace($account,'999900001111'); $cloud.role.Role.Arn=$expectedRole.arn }
      'wrong-live-role' { $cloud.role.Role.Arn=$roleArn + '-other' }
      'wrong-boundary' { $cloud.role.Role.PermissionsBoundary.PermissionsBoundaryArn=$boundaryArn + '-other' }
      'changed-trust' { $cloud.role.Role.AssumeRolePolicyDocument='{"Version":"2012-10-17","Statement":[]}' }
      'extra-inline-policy' { $cloud.inline.PolicyNames+=@('unexpected') }
      'attached-policy' { $cloud.attached.AttachedPolicies=@(@{PolicyArn=$boundaryArn}) }
      'changed-inline-policy' { $cloud.policy.PolicyDocument='{"Version":"2012-10-17","Statement":[]}' }
      'missing-boundary-grant' { $cloud.boundaryVersion.PolicyVersion.Document.Statement=@($cloud.boundaryVersion.PolicyVersion.Document.Statement[0]) }
      'wrong-boundary-principal' { $cloud.boundaryVersion.PolicyVersion.Document.Statement[0].Condition.ArnEquals.'aws:PrincipalArn'=$roleArn + '-other' }
      'changed-endpoint-policy' { $cloud.s3.VpcEndpoints[0].PolicyDocument='{"Version":"2012-10-17","Statement":[]}' }
      'unavailable-endpoint' { $cloud.secrets.VpcEndpoints[0].State='pending' }
    }
    $failure = ''
    try { $null = Get-ReplayRoleBoundary $plan $account } catch { $failure = $_.Exception.Message }
    Assert ($failure -cmatch '^DeletionReplay(RoleIdentityChanged|RolePoliciesUnexpected|RolePolicyChanged|BoundaryCapabilityMissing|EndpointCapabilityChanged)$') "real operator rejects $case through its strict boundary"
  }
}
[pscustomobject]@{suite='candidate-deletion-replay-generated-boundaries';checksPassed=$script:checks;cloudCalls=0;candidateDataRetained=$false} | ConvertTo-Json -Compress
