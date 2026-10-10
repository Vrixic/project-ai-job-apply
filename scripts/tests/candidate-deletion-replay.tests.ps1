#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $root 'scripts/lib/candidate-deletion-replay.ps1')
. (Join-Path $root 'scripts/lib/terraform-toolchain.ps1')
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
Assert ($fixture.configuration.acceptedPolicyCatalogSha256 -ceq '571ee233eac79d81e988840c0bd2271f27fedebe2c9c0a46d5c623625d131b1a') 'known immutable catalog digest matches shared fixture'
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
$preservation = Clone @{schemaVersion=1;unchanged=@{sha256=('a'*64);relationCount=96;rowCount=12;byteCount=240};reconciled=@{sha256=('b'*64);relationCount=96;rowCount=15;byteCount=300}}
$withPreservation = Clone $replayAggregate
$withPreservation | Add-Member -NotePropertyName preservation -NotePropertyValue $preservation
Assert-DeletionReplayAggregate $withPreservation $fixture.replay $fixture.configuration
Assert $true 'new replay whole-row evidence accepted alongside historical receipts'
foreach ($pair in @(@('relationCount',95),@('relationCount','96'),@('rowCount',100001),@('rowCount',-1),@('byteCount',67108865),@('sha256','invalid'))) {
  $changed=Clone $withPreservation; $changed.preservation.unchanged.($pair[0])=$pair[1]
  Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'malformed or unbounded preservation digest refuses'
}
foreach ($key in @('schemaVersion','unchanged','reconciled')) {
  $changed=Clone $withPreservation; $changed.preservation.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'incomplete preservation refuses'
}
$changed=Clone $withPreservation; $changed.preservation.unchanged.rowCount=16
Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'preserved subset cannot exceed complete reconciled data'
$changed=Clone $aggregate; $changed | Add-Member -NotePropertyName preservation -NotePropertyValue $preservation
Reject { Assert-DeletionReplayAggregate $changed $fixture.inspect $fixture.configuration } 'inspection cannot claim committed replay evidence'
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

# The replay executor is actionable: even an otherwise matching historical zero-drift plan is
# not an approved runtime authority. Exercise the real wrapper with only file/decoder ports mocked.
& {
  $readerAst = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
  $definition = @($readerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-ReplayPlan'},$true))
  Assert ($definition.Count -eq 1) 'real replay plan reader found once'
  . ([scriptblock]::Create($definition[0].Extent.Text))
  $terraformRoot = $root
  $terraformPrivate = $root
  $syntheticPath = Join-Path $root 'synthetic-current-plan.tfplan'
  function Resolve-DeletionReplayPrivatePath([string]$Path,[string]$Root,[switch]$MustExist) { return $Path }
  function Assert-DeletionReplayHash([string]$Path,[string]$Sha256) {}
  function Read-DeploymentTerraformPlan([string]$Path,[string]$TerraformDirectory,[switch]$AllowHistorical) {
    Assert (-not $AllowHistorical) 'replay plan decoder never permits historical fallback'
    return $runtimePlan
  }
  $runtimePlan = Clone @{terraform_version='1.16.2';variables=@{candidate_deletion_restore_role_enabled=@{value=$true}};resource_changes=@()}
  $null = Read-ReplayPlan $syntheticPath ('a'*64)
  Assert $true 'current exact-version replay plan accepted'
  foreach ($version in @('1.9.8','1.16.1','1.16.3','1.16.2 ','')) {
    $runtimePlan.terraform_version=$version
    Reject { Read-ReplayPlan $syntheticPath ('a'*64) } 'historical or unapproved replay runtime plan refused'
  }
}

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
# Exercise the actual qualified function reader and entrypoint checks, not a copied adapter.
# AWS JSON responses are the only stubs; no cloud command or operator top-level action runs.
& {
  $functionAst = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
  foreach ($name in @('Get-ReplayFunction','Assert-ReplayNoEntrypoints')) {
    $definitions = @($functionAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
    Assert ($definitions.Count -eq 1) "real operator $name found exactly once"
    . ([scriptblock]::Create($definitions[0].Extent.Text))
  }
  $functionName = $create.FunctionName
  $functionVersion = $fixture.inspect.functionVersion
  $unqualifiedArn = "arn:aws:lambda:us-east-2:$($preparation.accountId):function:$functionName"
  $baseFunction = Clone $function
  $baseFunction.PSObject.Properties.Remove('Tags')
  $baseCloud = Clone @{
    function=$baseFunction;tags=@{Tags=$create.Tags};concurrency=@{ReservedConcurrentExecutions=1}
    aliases=@{Aliases=@()};mappings=@{EventSourceMappings=@()};qualifiedMappings=@{EventSourceMappings=@()};url=$null;policy=$null;qualifiedPolicy=$null
    versions=@{Versions=@(@{Version='$LATEST'},@{Version=$functionVersion})}
  }
  $calls = [Collections.Generic.List[string]]::new()
  $tagReadFails = $false
  function Invoke-ReplayAws([string[]]$Arguments,[switch]$AllowNotFound) {
    $request = $Arguments -join ' '
    $calls.Add($request)
    switch -CaseSensitive ($request) {
      "lambda get-function --function-name $functionName --qualifier $functionVersion" { return $cloud.function }
      "lambda list-tags --resource $unqualifiedArn" {
        if ($tagReadFails) { throw 'SyntheticTagReadFailed' }
        return $cloud.tags
      }
      "lambda get-function-concurrency --function-name $functionName" { return ,$cloud.concurrency }
      "lambda list-aliases --function-name $functionName" { return $cloud.aliases }
      "lambda list-event-source-mappings --function-name $functionName" { return $cloud.mappings }
      "lambda list-event-source-mappings --function-name ${functionName}:$functionVersion" { return $cloud.qualifiedMappings }
      "lambda get-function-url-config --function-name $functionName" { return $cloud.url }
      "lambda get-policy --function-name $functionName" { return $cloud.policy }
      "lambda get-policy --function-name $functionName --qualifier $functionVersion" { return $cloud.qualifiedPolicy }
      "lambda list-versions-by-function --function-name $functionName" { return $cloud.versions }
      default { throw 'UnexpectedSyntheticFunctionReadbackRequest' }
    }
  }

  $cloud = Clone $baseCloud
  $result = Get-ReplayFunction $preparation $functionVersion
  Assert ((ConvertTo-DeletionReplayCanonicalJson $result.Tags) -ceq (ConvertTo-DeletionReplayCanonicalJson $create.Tags)) 'qualified readback with omitted Tags uses actual function-level tags'
  Assert ($null -eq $cloud.function.PSObject.Properties['Tags']) 'raw qualified readback is not rewritten by tag projection'
  Assert ($calls.Count -eq 10 -and $calls[0] -ceq "lambda get-function --function-name $functionName --qualifier $functionVersion" -and $calls[1] -ceq "lambda list-tags --resource $unqualifiedArn") 'numeric identity is read before one fixed unqualified tag query'
  Assert ($calls[9] -ceq "lambda list-versions-by-function --function-name $functionName") 'real no-entrypoint checks still complete before returning'
  Assert ($calls[4] -ceq "lambda list-event-source-mappings --function-name $functionName" -and $calls[5] -ceq "lambda list-event-source-mappings --function-name ${functionName}:$functionVersion") 'mapping checks cover both exact bare name and numeric-qualified target'

  $cloud = Clone $baseCloud
  $calls.Clear()
  $orderedTags = [ordered]@{}
  foreach ($key in @($create.Tags.PSObject.Properties.Name | Sort-Object -Descending)) { $orderedTags[$key]=$create.Tags.$key }
  $cloud.function | Add-Member -NotePropertyName Tags -NotePropertyValue ([pscustomobject]$orderedTags)
  $orderedEnvironment = [ordered]@{}
  foreach ($key in @($create.Environment.Variables.PSObject.Properties.Name | Sort-Object -Descending)) { $orderedEnvironment[$key]=$create.Environment.Variables.$key }
  $cloud.function.Configuration.Environment.Variables=[pscustomobject]$orderedEnvironment
  $null = Get-ReplayFunction $preparation $functionVersion
  Assert ($calls.Count -eq 10) 'equal embedded tags and environment accept JSON property reordering'
  Assert (@($calls | Where-Object { $_ -ceq "lambda list-tags --resource $unqualifiedArn" }).Count -eq 1) 'embedded tags never bypass independent list-tags'

  foreach ($case in @('null-response','scalar-response','missing-map','extra-response-key','null-map','array-map','scalar-map','empty-map','missing-required-tag','wrong-required-tag','numeric-tag','array-tag','null-tag','tag-read-failure')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    $tagReadFails = $false
    switch ($case) {
      'null-response' { $cloud.tags=$null }
      'scalar-response' { $cloud.tags='invalid' }
      'missing-map' { $cloud.tags=[pscustomobject]@{} }
      'extra-response-key' { $cloud.tags | Add-Member -NotePropertyName Unexpected -NotePropertyValue $true }
      'null-map' { $cloud.tags.Tags=$null }
      'array-map' { $cloud.tags.Tags=@($cloud.tags.Tags) }
      'scalar-map' { $cloud.tags.Tags='invalid' }
      'empty-map' { $cloud.tags.Tags=[pscustomobject]@{} }
      'missing-required-tag' { $cloud.tags.Tags.PSObject.Properties.Remove('RunId') }
      'wrong-required-tag' { $cloud.tags.Tags.Purpose='other' }
      'numeric-tag' { $cloud.tags.Tags.RunId=1 }
      'array-tag' { $cloud.tags.Tags.RunId=@($create.Tags.RunId) }
      'null-tag' { $cloud.tags.Tags.RunId=$null }
      'tag-read-failure' { $tagReadFails=$true }
    }
    Reject { Get-ReplayFunction $preparation $functionVersion } "real function reader rejects $case"
    Assert (@($calls | Where-Object { $_ -like 'lambda list-aliases *' }).Count -eq 0) "$case never reaches successful entrypoint validation"
  }
  $tagReadFails = $false

  foreach ($case in @('conflicting-value','null-embedded-map','array-embedded-map','scalar-embedded-map','missing-embedded-tag','extra-embedded-tag')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    $embedded = Clone $create.Tags
    switch ($case) {
      'conflicting-value' { $embedded.RunId='other' }
      'null-embedded-map' { $embedded=$null }
      'array-embedded-map' { $embedded=@($embedded) }
      'scalar-embedded-map' { $embedded='invalid' }
      'missing-embedded-tag' { $embedded.PSObject.Properties.Remove('RunId') }
      'extra-embedded-tag' { $embedded | Add-Member -NotePropertyName Unexpected -NotePropertyValue 'extra' }
    }
    $cloud.function | Add-Member -NotePropertyName Tags -NotePropertyValue $embedded
    $failure=''
    try { $null = Get-ReplayFunction $preparation $functionVersion } catch { $failure=$_.Exception.Message }
    Assert ($failure -ceq 'DeletionReplayFunctionTagsConflict') "real function reader rejects $case without replacing conflicting evidence"
    Assert (@($calls | Where-Object { $_ -like 'lambda get-function-concurrency *' }).Count -eq 0) "$case fails before other readbacks"
  }

  foreach ($case in @('wrong-function-name','wrong-function-account','unqualified-arn','wrong-numeric-version','array-function-name','array-function-arn','numeric-version','missing-identity')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    switch ($case) {
      'wrong-function-name' { $cloud.function.Configuration.FunctionName='other' }
      'wrong-function-account' { $cloud.function.Configuration.FunctionArn=$fixture.invokedFunctionArn.Replace($preparation.accountId,'999900001111') }
      'unqualified-arn' { $cloud.function.Configuration.FunctionArn=$unqualifiedArn }
      'wrong-numeric-version' { $cloud.function.Configuration.Version='2' }
      'array-function-name' { $cloud.function.Configuration.FunctionName=@($functionName) }
      'array-function-arn' { $cloud.function.Configuration.FunctionArn=@($fixture.invokedFunctionArn) }
      'numeric-version' { $cloud.function.Configuration.Version=1 }
      'missing-identity' { $cloud.function.PSObject.Properties.Remove('Configuration') }
    }
    Reject { Get-ReplayFunction $preparation $functionVersion } "real function reader rejects $case"
    Assert ($calls.Count -eq 1) "$case cannot direct a function-level tag query"
  }
  foreach ($badVersion in @('$LATEST','0','alias','1:other')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    Reject { Get-ReplayFunction $preparation $badVersion } 'invalid requested qualifier rejected before readback'
    Assert ($calls.Count -eq 0) 'invalid requested qualifier makes no AWS boundary call'
  }

  foreach ($case in @('code','role','environment','layers','network','logging','concurrency')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    switch ($case) {
      'code' { $cloud.function.Configuration.CodeSha256='wrong' }
      'role' { $cloud.function.Configuration.Role=$create.Role + '-other' }
      'environment' { $cloud.function.Configuration.Environment.Variables.NODE_ENV='development' }
      'layers' { $cloud.function.Configuration.Layers=@() }
      'network' { $cloud.function.Configuration.VpcConfig.SecurityGroupIds=@('sg-other') }
      'logging' { $cloud.function.Configuration.LoggingConfig.LogGroup='/other' }
      'concurrency' { $cloud.concurrency.ReservedConcurrentExecutions=2 }
    }
    Reject { Get-ReplayFunction $preparation $functionVersion } "tag readback retains exact $case guard"
  }
  foreach ($case in @('aliases','mappings','qualifiedMappings','url','policy','qualifiedPolicy','versions')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    switch ($case) {
      'aliases' { $cloud.aliases.Aliases=@(@{Name='unexpected'}) }
      'mappings' { $cloud.mappings.EventSourceMappings=@(@{UUID='unexpected'}) }
      'qualifiedMappings' { $cloud.qualifiedMappings.EventSourceMappings=@(@{UUID='unexpected'}) }
      'url' { $cloud.url=[pscustomobject]@{FunctionUrl='https://synthetic.invalid'} }
      'policy' { $cloud.policy=[pscustomobject]@{Policy='unexpected'} }
      'qualifiedPolicy' { $cloud.qualifiedPolicy=[pscustomobject]@{Policy='unexpected'} }
      'versions' { $cloud.versions.Versions+=@(@{Version='2'}) }
    }
    Reject { Get-ReplayFunction $preparation $functionVersion } "real function reader still refuses $case"
  }
  foreach ($reserved in @(-1,0,1)) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    $cloud.function.Configuration.State='Failed'
    $cloud.function.Configuration.LastUpdateStatus='Failed'
    $cloud.concurrency=if($reserved -eq -1){[pscustomobject]@{}}else{[pscustomobject]@{ReservedConcurrentExecutions=$reserved}}
    $null = Get-ReplayFunction $preparation $functionVersion -Cleanup
    Assert ($calls.Count -eq 10) "cleanup retains exact failed numeric version and $reserved concurrency handling with omitted Tags"
    $cloud.tags.Tags.RunId='other'
    Reject { Get-ReplayFunction $preparation $functionVersion -Cleanup } 'cleanup never bypasses required real tags'
  }
  $cloud = Clone $baseCloud
  $cloud.concurrency=[pscustomobject]@{}
  Reject { Get-ReplayFunction $preparation $functionVersion } 'normal operation rejects genuinely unset concurrency'
  foreach ($case in @('null-response','number-response','string-response','bool-response','array-response','unknown-field','extra-field','null-value','string-value','bool-value','array-value','object-value','fractional-value','negative-value','overflow-value')) {
    $cloud = Clone $baseCloud
    $calls.Clear()
    switch ($case) {
      'null-response' { $cloud.concurrency=$null }
      'number-response' { $cloud.concurrency=1 }
      'string-response' { $cloud.concurrency='1' }
      'bool-response' { $cloud.concurrency=$true }
      'array-response' { $cloud.concurrency=@($cloud.concurrency) }
      'unknown-field' { $cloud.concurrency=[pscustomobject]@{Unexpected=1} }
      'extra-field' { $cloud.concurrency | Add-Member -NotePropertyName Unexpected -NotePropertyValue 1 }
      'null-value' { $cloud.concurrency.ReservedConcurrentExecutions=$null }
      'string-value' { $cloud.concurrency.ReservedConcurrentExecutions='1' }
      'bool-value' { $cloud.concurrency.ReservedConcurrentExecutions=$true }
      'array-value' { $cloud.concurrency.ReservedConcurrentExecutions=@(1) }
      'object-value' { $cloud.concurrency.ReservedConcurrentExecutions=[pscustomobject]@{} }
      'fractional-value' { $cloud.concurrency.ReservedConcurrentExecutions=1.5 }
      'negative-value' { $cloud.concurrency.ReservedConcurrentExecutions=-1 }
      'overflow-value' { $cloud.concurrency.ReservedConcurrentExecutions=[long]2147483648 }
    }
    foreach ($cleanup in @($false,$true)) {
      Reject { Get-ReplayFunction $preparation $functionVersion -Cleanup:$cleanup } "malformed concurrency $case refused for cleanup=$cleanup"
    }
    Assert (@($calls | Where-Object { $_ -like 'lambda list-aliases *' }).Count -eq 0) "$case never reaches successful entrypoint validation"
  }
}


# Explicit private diagnosis is neither inspection approval nor marker repair authority.
$diagnosisRequest = Clone $fixture.inspect
$diagnosisRequest.action = 'diagnose_completion'
$diagnosis = Clone @{
  schemaVersion=1;action='diagnose_completion';outcome='persisted_candidate'
  runId=$fixture.configuration.runId;sourceSha=$fixture.configuration.sourceSha;configurationSha256=$fixture.configurationSha256
  functionVersion='1';expiresAt=$fixture.configuration.expiresAt;markerSnapshotSha256=$fixture.markerSnapshotSha256;markersValidated=1
  comparison=@{requestMatchesTag=$false;ledgerMatchesTag=$false;persistedPairAgrees=$true;completionCollisions=@('request_completion_mismatch','ledger_completion_mismatch')}
  reason=$null;corroboration='persisted_transaction'
  candidate=@{correctedCompletedAt=$fixture.configuration.issuedAt;evidenceSha256=('a'*64);candidateSha256=('b'*64)}
  dispatchEvidence=$null
  databaseWrites=0;s3Writes=0;recoveryLedgerWrites=0;identityProviderCalls=0
}
Assert-DeletionReplayCompletionDiagnosis $diagnosis $diagnosisRequest $fixture.configuration
Assert $true 'strict minimal diagnostic candidate accepted'
$consistent = Clone $diagnosis
$consistent.outcome='consistent';$consistent.candidate=$null;$consistent.corroboration=$null
$consistent.comparison.requestMatchesTag=$true;$consistent.comparison.ledgerMatchesTag=$true;$consistent.comparison.completionCollisions=@()
Assert-DeletionReplayCompletionDiagnosis $consistent $diagnosisRequest $fixture.configuration
Assert $true 'consistent is not a repair candidate'
$refusal = Clone $diagnosis
$refusal.outcome='refused';$refusal.candidate=$null;$refusal.corroboration=$null;$refusal.comparison=$null;$refusal.reason='row_cardinality'
Assert-DeletionReplayCompletionDiagnosis $refusal $diagnosisRequest $fixture.configuration
Assert $true 'closed early refusal carries no invented comparison'
$dispatchFixture = Clone @{
  status='acknowledged_unclaimed';attemptCount=1;bindingSha256=@('c'*64)
  latestCreatedAt=$fixture.configuration.issuedAt.Replace('Z','000Z');latestAcknowledgedAt=$fixture.configuration.issuedAt.Replace('Z','000Z')
}
foreach ($count in @(1,2,3)) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture
  $changed.dispatchEvidence.attemptCount=$count
  $changed.dispatchEvidence.bindingSha256=@(@(('c'*64),('d'*64),('e'*64)) | Select-Object -First $count)
  Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration
  Assert $true "exact $count opaque dispatch bindings accepted privately"
  Reject { Assert-DeletionReplayAggregate $changed $fixture.inspect $fixture.configuration } 'dispatch evidence never becomes inspection approval'
  Reject { Assert-DeletionReplayAggregate $changed $fixture.replay $fixture.configuration } 'dispatch evidence never becomes replay approval'
  $observedConsistent=Clone $consistent;$observedConsistent.dispatchEvidence=Clone $changed.dispatchEvidence
  Assert-DeletionReplayCompletionDiagnosis $observedConsistent $diagnosisRequest $fixture.configuration
  Assert $true 'consistent diagnostic may retain non-authoritative dispatch summary'
}
$changed=Clone $refusal;$changed.dispatchEvidence=Clone $dispatchFixture
Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'refusal must not carry dispatch proof'
foreach ($bad in @(@(),[pscustomobject]@{},$false,0,'synthetic-secret-sentinel')) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch summary is null or exact object only'
}
foreach ($key in $dispatchFixture.PSObject.Properties.Name) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture
  $changed.dispatchEvidence.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "missing dispatch field $key"
}
foreach ($key in @('executionName','executionArn','operationId','eventId','rows','sql','credentials','writerExclusionProof','restoreTime')) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture
  $changed.dispatchEvidence | Add-Member -NotePropertyName $key -NotePropertyValue 'synthetic-secret-sentinel'
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "dispatch refuses private locator or invented proof $key"
}
foreach ($bad in @(-1,0,4,1.5,'1',$true,$null,@(),[pscustomobject]@{})) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.attemptCount=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch exact bounded numeric attempt count'
}
foreach ($bad in @(@(),$null,('c'*64),@(('c'*64),('d'*64)),@('C'*64),@('c'*63),@(('c'*64)+"`n"),@($null),@([pscustomobject]@{}),@('synthetic-secret-sentinel'))) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.bindingSha256=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch exact array of scalar opaque hashes'
}
foreach ($bad in @(@(('c'*64),('c'*64)),@(('d'*64),('c'*64)))) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.attemptCount=2;$changed.dispatchEvidence.bindingSha256=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch hashes are unique and sorted'
}
foreach ($bad in @('pending',"acknowledged_unclaimed`n",'synthetic-secret-sentinel',$null,@())) {
  $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.status=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch status is one literal only'
}
foreach ($key in @('latestCreatedAt','latestAcknowledgedAt')) {
  foreach ($bad in @('2026-02-30T00:00:00.000000Z','2026-09-08T00:00:00Z','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.0000001Z','2026-09-08T00:00:00.000000+00:00',"2026-09-08T00:00:00.000000Z`n",'0000-01-01T00:00:00.000000Z','2099-01-01T00:00:00.000000Z',$null,@(),[pscustomobject]@{})) {
    $changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.$key=$bad
    Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "dispatch canonical bounded timestamp $key"
  }
}
$changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.latestCreatedAt=$fixture.configuration.expiresAt.Replace('Z','000Z')
Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'dispatch creation cannot follow acknowledgment'
$changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.latestAcknowledgedAt=$fixture.configuration.expiresAt.Replace('Z','000Z')
Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration
Assert $true 'transport does not invent a PITR cutoff or reject exact expiry equality'
$changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture
$changed.dispatchEvidence.latestCreatedAt=$fixture.configuration.issuedAt.Replace('Z','123Z');$changed.dispatchEvidence.latestAcknowledgedAt=$fixture.configuration.issuedAt.Replace('Z','456Z')
Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration
Assert $true 'real SQL microseconds remain valid and are not rounded'
$changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.latestCreatedAt=$fixture.configuration.issuedAt.Replace('Z','001Z')
Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'one-microsecond creation-after-acknowledgment is not hidden by millisecond truncation'
$changed=Clone $diagnosis;$changed.dispatchEvidence=Clone $dispatchFixture;$changed.dispatchEvidence.latestAcknowledgedAt=$fixture.configuration.expiresAt.Replace('Z','001Z')
Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'one-microsecond expiry excess is refused exactly'
Assert ($operator -match 'fresh execution retirement and verified PITR-cutoff joins are local') 'dispatch summary is not standalone writer exclusion'
Reject { Assert-DeletionReplayAggregate $diagnosis $fixture.inspect $fixture.configuration } 'diagnosis cannot approve inspection'
Reject { Assert-DeletionReplayAggregate $diagnosis $fixture.replay $fixture.configuration } 'diagnosis cannot approve replay'
Reject { Assert-DeletionReplayCompletionDiagnosis $aggregate $diagnosisRequest $fixture.configuration } 'inspection cannot impersonate diagnosis'
foreach ($key in $diagnosis.PSObject.Properties.Name) {
  $changed = Clone $diagnosis; $changed.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "missing diagnostic field $key"
}
foreach ($key in @('userId','requestId','bucketName','key','versionId','rows','sql','credentials','inspectionSha256')) {
  foreach ($scope in @('response','candidate','comparison')) {
    $changed=Clone $diagnosis
    $node=if($scope -ceq 'response'){$changed}else{$changed.$scope}
    $node | Add-Member -NotePropertyName $key -NotePropertyValue 'synthetic-secret-sentinel'
    Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "forbidden $scope diagnostic field $key"
  }
  $changed=Clone $diagnosisRequest
  $changed | Add-Member -NotePropertyName $key -NotePropertyValue 'synthetic-secret-sentinel'
  Reject { Assert-DeletionReplayCompletionDiagnosis $diagnosis $changed $fixture.configuration } "diagnosis request forbids $key"
}
foreach ($key in @('runId','sourceSha','configurationSha256','functionVersion','expiresAt','markerSnapshotSha256')) {
  $changed=Clone $diagnosis;$changed.$key='changed'
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "diagnosis binds $key"
}
foreach ($key in @('markersValidated','databaseWrites','s3Writes','recoveryLedgerWrites','identityProviderCalls')) {
  foreach ($bad in @(-1,2,1.5,'0',$null,@(),[pscustomobject]@{})) {
    $changed=Clone $diagnosis;$changed.$key=$bad
    Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "diagnosis exact numeric $key"
  }
}
foreach ($key in @('requestMatchesTag','ledgerMatchesTag','persistedPairAgrees')) {
  foreach ($bad in @('false',0,$null,@($false),[pscustomobject]@{})) {
    $changed=Clone $diagnosis;$changed.comparison.$key=$bad
    Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "diagnosis typed comparison $key"
  }
  $changed=Clone $diagnosis;$changed.comparison.$key=-not $changed.comparison.$key
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "candidate comparison contradiction $key"
}
foreach ($bad in @(@(),@('request_completion_mismatch'),@('request_completion_mismatch','request_completion_mismatch'),@('request_completion_mismatch','synthetic-secret-sentinel'),'request_completion_mismatch',$null)) {
  $changed=Clone $diagnosis;$changed.comparison.completionCollisions=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'candidate requires exact two unique collision predicates'
}
foreach ($key in @('correctedCompletedAt','evidenceSha256','candidateSha256')) {
  $changed=Clone $diagnosis;$changed.candidate.PSObject.Properties.Remove($key)
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "candidate requires $key"
  $changed=Clone $diagnosis;$changed.candidate.$key=@($diagnosis.candidate.$key)
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } "candidate scalar $key"
}
foreach ($bad in @('2026-02-30T00:00:00.000Z','2026-09-08T00:00:00Z','2026-09-08T00:00:00.000+00:00','2099-01-01T00:00:00.000Z','synthetic-secret-sentinel')) {
  $changed=Clone $diagnosis;$changed.candidate.correctedCompletedAt=$bad
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'candidate canonical bounded timestamp'
}
foreach ($outcome in @('refused','consistent','replayed','synthetic-secret-sentinel')) {
  $changed=Clone $diagnosis;$changed.outcome=$outcome
  Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'outcome cannot carry contradictory proof'
}
$changed=Clone $refusal;$changed.reason='synthetic-secret-sentinel'
Reject { Assert-DeletionReplayCompletionDiagnosis $changed $diagnosisRequest $fixture.configuration } 'refusal never reflects an untrusted message'
Assert ((Get-DeletionReplayInvocationAction 'DiagnoseCompletion') -ceq 'diagnose_completion') 'diagnosis has explicit snake-case action'
Assert ((Get-DeletionReplayInvocationAction 'Inspect') -ceq 'inspect') 'original inspection mapping unchanged'
Assert ((Get-DeletionReplayInvocationAction 'Replay') -ceq 'replay') 'original replay mapping unchanged'
Reject { Get-DeletionReplayInvocationAction 'Cleanup' } 'no other operator stage becomes an invocation'
Assert ($operator -match 'DeletionReplayDiagnosisAmbiguousReviewBeforeRetry' -and $operator -match 'inspectionApproval=\$false') 'ambiguous diagnosis has fixed refusal and never creates approval'
Assert (@([regex]::Matches($operator,'Get-ReplayDiagnosisCleanupReadyAt \$runDirectory')).Count -eq 2) 'cleanup checks diagnosis windows before waiting and immediately before delete'

# Execute only the real local journal reader; all files contain generated fixture data.
& {
  $journalAst=[Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
  $definition=@($journalAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-ReplayDiagnosisCleanupReadyAt'},$true))
  Assert ($definition.Count -eq 1) 'real diagnostic cleanup reader found once'
  . ([scriptblock]::Create($definition[0].Extent.Text))
  $journalRoot=Join-Path ([IO.Path]::GetTempPath()) ('ai-job-apply-diagnosis-journal-tests-'+[guid]::NewGuid().ToString('N'))
  $null=New-Item -ItemType Directory -Path $journalRoot
  try {
    $preparationSha='c'*64
    $ready=$now.AddSeconds(330)
    Assert ((Get-ReplayDiagnosisCleanupReadyAt $journalRoot $preparation $preparationSha $ready $now) -eq $ready) 'no diagnostic journal preserves original disable timeout'
    $requestPath=Join-Path $journalRoot ('diagnose-'+('d'*32)+'-request.json')
    $journalPath=Join-Path $journalRoot ('diagnose-'+('d'*32)+'-started.json')
    Write-DeletionReplayPrivateJson $requestPath $diagnosisRequest
    $journal=Clone @{schemaVersion=1;action='diagnose_completion';status='started';startedAt=$now.AddSeconds(30).ToString('o');preparationSha256=$preparationSha;requestSha256=(Get-D1RestoreFileSha256 $requestPath)}
    foreach ($status in @('started','completed','ambiguous')) {
      $journal.status=$status
      Write-DeletionReplayPrivateJson $journalPath $journal -Replace
      Assert ((Get-ReplayDiagnosisCleanupReadyAt $journalRoot $preparation $preparationSha $ready $now.AddSeconds(60)) -eq $now.AddSeconds(360)) "full 330-second window for $status diagnosis"
    }
    foreach ($key in @('action','preparationSha256','requestSha256','startedAt','status')) {
      $changed=Clone $journal;$changed.$key='synthetic-secret-sentinel'
      Write-DeletionReplayPrivateJson $journalPath $changed -Replace
      Reject { Get-ReplayDiagnosisCleanupReadyAt $journalRoot $preparation $preparationSha $ready $now.AddSeconds(60) } "cleanup refuses changed diagnosis journal $key"
    }
    Write-DeletionReplayPrivateJson $journalPath $journal -Replace
    $changed=Clone $diagnosisRequest;$changed.functionVersion='2'
    Write-DeletionReplayPrivateJson $requestPath $changed -Replace
    Reject { Get-ReplayDiagnosisCleanupReadyAt $journalRoot $preparation $preparationSha $ready $now.AddSeconds(60) } 'cleanup retains exact request checksum'
    foreach ($key in @('action','runId','configurationSha256','functionVersion')) {
      $changed=Clone $diagnosisRequest;$changed.$key=@($diagnosisRequest.$key)
      Write-DeletionReplayPrivateJson $requestPath $changed -Replace
      $journal.requestSha256=Get-D1RestoreFileSha256 $requestPath
      Write-DeletionReplayPrivateJson $journalPath $journal -Replace
      Reject { Get-ReplayDiagnosisCleanupReadyAt $journalRoot $preparation $preparationSha $ready $now.AddSeconds(60) } "cleanup preserves request scalar type $key"
    }
  } finally {
    $resolved=[IO.Path]::GetFullPath($journalRoot)
    if ($resolved -cnotmatch 'ai-job-apply-diagnosis-journal-tests-[a-f0-9]{32}$' -or -not $resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic cleanup target invalid' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

# Exercise the real mode, file-inventory and preflight functions with synthetic child Status
# scripts. No top-level operator actions, AWS calls or Terraform processes run in this block.
& {
  . (Join-Path $root 'scripts/lib/development-postgresql-dark-recovery.ps1')
  $modeAst = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
  foreach ($name in @('Assert-ReplayRecoveryMode','Get-ReplayBoundFiles','Assert-ReplayNoDrift','Assert-ReplayCurrentBoundary')) {
    $definitions = @($modeAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
    Assert ($definitions.Count -eq 1) "real recovery function $name found once"
    . ([scriptblock]::Create($definitions[0].Extent.Text))
  }
  $darkPreparation = Clone $preparation
  $darkPreparation | Add-Member -NotePropertyName baselineMode -NotePropertyValue 'dark-recovery'
  $darkPreparation.fileBindings += @(9..11 | ForEach-Object { Clone @{path="synthetic-$_.json";sha256=('e'*64)} })
  Assert-DeletionReplayPreparation $darkPreparation
  Assert ((Get-DeletionReplayBaselineMode $preparation) -ceq 'steady-state') 'legacy preparation remains steady-state'
  Assert ((Get-DeletionReplayBaselineMode $darkPreparation) -ceq 'dark-recovery') 'explicit dark preparation accepted'
  foreach ($value in @($null,$true,1,'DARK-RECOVERY','dark-recovery ','unknown')) {
    $changed = Clone $darkPreparation; $changed.baselineMode=$value
    Reject { Assert-DeletionReplayPreparation $changed } 'noncanonical mode refuses'
  }
  $changed = Clone $darkPreparation; $changed.PSObject.Properties.Remove('baselineMode')
  Reject { Assert-DeletionReplayPreparation $changed } 'stripped dark mode cannot become legacy'
  $changed = Clone $darkPreparation; $changed.fileBindings=@($changed.fileBindings | Select-Object -First 8)
  Reject { Assert-DeletionReplayPreparation $changed } 'dark preparation requires recovery operator inventory'
  $changed = Clone $preparation; $changed | Add-Member -NotePropertyName baselineMode -NotePropertyValue 'steady-state'
  Assert-DeletionReplayPreparation $changed
  Assert $true 'explicit steady-state remains compatible'

  $DarkRecovery=$true
  Assert-ReplayRecoveryMode $darkPreparation (Clone @{baseline_mode='dark-recovery'})
  Assert $true 'dark context and preparation agree'
  foreach ($context in @((Clone @{}),(Clone @{baseline_mode='steady-state'}),(Clone @{baseline_mode=$null}))) {
    Reject { Assert-ReplayRecoveryMode $darkPreparation $context } 'dark invocation refuses legacy or wrong context'
  }
  Reject { Assert-ReplayRecoveryMode $preparation $null } 'dark invocation refuses normal preparation'
  $DarkRecovery=$false
  Assert-ReplayRecoveryMode $preparation (Clone @{})
  Reject { Assert-ReplayRecoveryMode $preparation (Clone @{baseline_mode='dark-recovery'}) } 'normal invocation refuses dark context'
  foreach ($cleanup in @($false,$true)) {
    $awsCalls=0
    function Invoke-ReplayAws { $awsCalls++; throw 'UnexpectedSyntheticAwsCall' }
    Reject { Assert-ReplayCurrentBoundary $darkPreparation -Cleanup:$cleanup } 'mode mismatch refuses before AWS including cleanup'
    Assert ($awsCalls -eq 0) 'mode mismatch performed no AWS read'
  }

  $temporary = Join-Path ([IO.Path]::GetTempPath()) "ai-job-apply-replay-mode-tests-$([guid]::NewGuid().ToString('N'))"
  $null = New-Item -ItemType Directory -Path $temporary
  try {
    # Preserve PowerShell's definition-file automatic paths for the real functions.
    $functionFile=Join-Path $temporary 'synthetic-functions.ps1'
    $functionText=@($modeAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin @('Assert-ReplayRecoveryMode','Get-ReplayBoundFiles','Assert-ReplayNoDrift','Assert-ReplayCurrentBoundary')},$true) | ForEach-Object { $_.Extent.Text }) -join "`n"
    [IO.File]::WriteAllText($functionFile,$functionText,[Text.UTF8Encoding]::new($false))
    . $functionFile
    $guardPath=Join-Path $root 'scripts/lib/candidate-deletion-replay.ps1'
    $restoreContextPath=Join-Path $temporary 'applydash-development-dark-restore-context.json'
    $manifestPath=Join-Path $temporary 'manifest.json'; $zipPath=Join-Path $temporary 'artifact.zip'; $sbomPath=Join-Path $temporary 'sbom.json'
    $DarkRecovery=$true
    $bound=@(Get-ReplayBoundFiles $darkPreparation.runtimePlanPath)
    Assert ($bound.Count -eq 11 -and $bound -ccontains $restoreContextPath) 'dark file inventory binds selected context and eleven files'
    foreach ($file in @('operate-development-postgresql-restore.ps1','operate-staging-postgresql-restore.ps1','lib/development-postgresql-dark-recovery.ps1')) {
      Assert ($bound -ccontains (Join-Path $temporary $file)) 'dark recovery dependency checksum-bound'
    }
    $DarkRecovery=$false
    Assert (@(Get-ReplayBoundFiles $preparation.runtimePlanPath).Count -eq 8) 'steady-state inventory unchanged'
    $child=@'
param($Action,[switch]$DarkRecovery,$Environment,$ExpectedAccountId,$StateBucket,$RuntimePlanPath,$AwsProfile,$Region)
$calls.Add([pscustomobject]@{action=$Action;dark=[bool]$DarkRecovery;environment=$Environment;account=$ExpectedAccountId;bucket=$StateBucket;plan=$RuntimePlanPath;profile=$AwsProfile;region=$Region})
if ($childFailure) { exit 1 }
$statusResponse | ConvertTo-Json -Depth 10 -Compress
exit 0
'@
    foreach ($file in @('operate-development-postgresql-restore.ps1','inspect-staging-workload-and-cost.ps1')) {
      [IO.File]::WriteAllText((Join-Path $temporary $file),$child,[Text.UTF8Encoding]::new($false))
    }
    $calls=[Collections.Generic.List[object]]::new(); $childFailure=$false; $AwsProfile='synthetic-development'
    $validStatus=Clone @{Environment='development';BaselineMode='dark-recovery';RestoreState='verified';BackupRetentionDays=35;DisposableRestoreTargets=1;SourceMultiAz=$false;SourceAvailable=$true;SourcePrivate=$true;SourceEncrypted=$true;SourceDeletionProtected=$true;LatestRestorablePoint=$true;EcsRuntimeIdle=$true;RestoreContext=$true}
    $statusResponse=Clone $validStatus; $DarkRecovery=$true
    Assert-ReplayNoDrift $darkPreparation
    Assert ($calls.Count -eq 1 -and $calls[0].dark -and $calls[0].action -ceq 'Status' -and $calls[0].account -ceq $darkPreparation.accountId -and $calls[0].bucket -ceq $darkPreparation.stateBucket -and $calls[0].plan -ceq $darkPreparation.runtimePlanPath -and $calls[0].profile -ceq $AwsProfile -and $calls[0].region -ceq 'us-east-2') 'dark Status receives exact reviewed authority'
    foreach ($name in @('SourceAvailable','SourcePrivate','SourceEncrypted','SourceDeletionProtected','LatestRestorablePoint','EcsRuntimeIdle','RestoreContext')) {
      foreach ($value in @($false,'true',1,$null)) {
        $statusResponse=Clone $validStatus; $statusResponse.$name=$value
        Reject { Assert-ReplayNoDrift $darkPreparation } "missing or nonboolean recovery proof $name refuses"
      }
      $statusResponse=Clone $validStatus; $statusResponse.PSObject.Properties.Remove($name)
      Reject { Assert-ReplayNoDrift $darkPreparation } "absent recovery proof $name refuses"
    }
    foreach ($pair in @(@('Environment','staging'),@('BaselineMode','steady-state'),@('RestoreState','in-progress'),@('BackupRetentionDays',34),@('BackupRetentionDays','35'),@('DisposableRestoreTargets',0),@('DisposableRestoreTargets',2),@('DisposableRestoreTargets','1'),@('SourceMultiAz',$true),@('SourceMultiAz','false'))) {
      $statusResponse=Clone $validStatus; $statusResponse.($pair[0])=$pair[1]
      Reject { Assert-ReplayNoDrift $darkPreparation } 'changed recovery baseline refuses'
    }
    $statusResponse=Clone $validStatus; $childFailure=$true
    Reject { Assert-ReplayNoDrift $darkPreparation } 'failed recovery Status refuses'
    $childFailure=$false; $calls.Clear()
    $DarkRecovery=$false; $statusResponse=Clone @{NoDrift=$true}
    Assert-ReplayNoDrift $preparation
    Assert ($calls.Count -eq 1 -and -not $calls[0].dark -and $calls[0].environment -ceq 'development') 'normal preflight retains maintained workload inspector'
    $statusResponse.NoDrift=$false
    Reject { Assert-ReplayNoDrift $preparation } 'normal drift still refuses'
    $calls.Clear(); $DarkRecovery=$true
    Reject { Assert-ReplayNoDrift $preparation } 'preflight mode mismatch refuses before child execution'
    Assert ($calls.Count -eq 0) 'mode mismatch invoked no child'
  } finally {
    $resolved=[IO.Path]::GetFullPath($temporary)
    if ($resolved -cnotmatch 'ai-job-apply-replay-mode-tests-[a-f0-9]{32}$' -or -not $resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic cleanup target invalid' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    $global:LASTEXITCODE=0
  }
}

[pscustomobject]@{suite='candidate-deletion-replay-generated-boundaries';checksPassed=$script:checks;cloudCalls=0;candidateDataRetained=$false} | ConvertTo-Json -Compress
