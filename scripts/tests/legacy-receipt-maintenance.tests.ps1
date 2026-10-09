#Requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../lib/legacy-receipt-maintenance-guards.ps1')
. (Join-Path $PSScriptRoot '../lib/terraform-toolchain.ps1')
$checks = 0
function Check([bool]$Value, [string]$Label) { if (-not $Value) { throw "Failed: $Label" }; $script:checks++ }
function Reject([scriptblock]$Body, [string]$Label) {
  $rejected = $false
  try { & $Body | Out-Null } catch { $rejected = $true }
  Check $rejected $Label
}
function Copy-Value($Value) { return ConvertFrom-DeploymentTerraformJson ($Value | ConvertTo-Json -Depth 60 -Compress) }
$account = '111122223333'
$now = [DateTimeOffset]::UtcNow
function Instant([DateTimeOffset]$Value) { return $Value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") }
$config = [pscustomobject]@{
  schemaVersion = 1; runId = ('a' * 32); sourceSha = ('b' * 40); imageDigest = ('c' * 64);
  accountId = $account; region = 'us-east-2'; databaseIdentifier = 'ai-job-apply-development';
  databaseResourceId = 'db-SYNTHETIC00000001'; databaseHostname = 'ai-job-apply-development.abcdefghijkl.us-east-2.rds.amazonaws.com';
  databaseName = 'ai_job_apply'; databasePort = 5432;
  snapshotArn = "arn:aws:rds:us-east-2:${account}:snapshot:ai-job-apply-development-synthetic";
  snapshotCreatedAt = Instant $now.AddMinutes(-5); encryptionKeyArn = "arn:aws:kms:us-east-2:${account}:key/11111111-1111-4111-8111-111111111111";
  expectedAppliedMigrations = 3; expectedLegacyReceipts = 7;
  issuedAt = Instant $now.AddMinutes(-1); expiresAt = Instant $now.AddMinutes(25)
}
Assert-LegacyReceiptConfiguration $config $account $now
Check $true 'exact configuration admitted'
foreach ($mutation in @(
  @{schemaVersion=2},@{runId='wrong'},@{sourceSha='latest'},@{imageDigest='latest'},@{accountId='444455556666'},
  @{region='us-east-1'},@{databaseIdentifier='other'},@{databaseResourceId='db-wrong'},@{databaseHostname='localhost'},
  @{databaseName='other'},@{databasePort=5433},@{expectedAppliedMigrations=9},@{expectedAppliedMigrations='3'},
  @{expectedLegacyReceipts=0},@{expectedLegacyReceipts=1001},@{expectedLegacyReceipts=1.5},
  @{snapshotArn=$config.snapshotArn.Replace($account,'444455556666')},@{encryptionKeyArn=$config.encryptionKeyArn.Replace($account,'444455556666')},
  @{snapshotCreatedAt=(Instant $now.AddHours(-2))},@{expiresAt=(Instant $now.AddHours(1))},@{issuedAt=(Instant $now.AddMinutes(1))}
)) {
  $bad = Copy-Value $config
  foreach ($name in $mutation.Keys) { $bad.$name = $mutation[$name] }
  Reject { Assert-LegacyReceiptConfiguration $bad $account $now } 'incompatible configuration'
}
$bad = Copy-Value $config; $bad | Add-Member unknown 'refuse'
Reject { Assert-LegacyReceiptConfiguration $bad $account $now } 'closed configuration'
Reject { Assert-LegacyReceiptConfiguration $config $account (Get-LegacyReceiptInstant $config.expiresAt) } 'exact deadline expired'

$database = [pscustomobject]@{
  DBInstanceIdentifier = $config.databaseIdentifier; DbiResourceId = $config.databaseResourceId;
  DBInstanceArn = "arn:aws:rds:us-east-2:${account}:db:ai-job-apply-development"; DBInstanceStatus = 'available';
  StorageEncrypted = $true; DeletionProtection = $true; PubliclyAccessible = $false; BackupRetentionPeriod = 7;
  LatestRestorableTime = Instant $now.AddMinutes(-1); Endpoint = @{Address=$config.databaseHostname;Port=5432};
  DBName = 'ai_job_apply'; KmsKeyId = "arn:aws:kms:us-east-2:${account}:key/22222222-2222-4222-8222-222222222222"
}
$snapshot = [pscustomobject]@{
  DBSnapshotArn=$config.snapshotArn;DBInstanceIdentifier=$config.databaseIdentifier;DbiResourceId=$config.databaseResourceId;
  Status='available';SnapshotType='manual';Encrypted=$true;KmsKeyId=$database.KmsKeyId;SnapshotCreateTime=$config.snapshotCreatedAt
}
Assert-LegacyReceiptRecoverySnapshot $config $database $snapshot
Check $true 'exact encrypted same-instance snapshot admitted'
foreach ($field in @('DBSnapshotArn','DBInstanceIdentifier','DbiResourceId','Status','SnapshotType','KmsKeyId','SnapshotCreateTime')) {
  $bad = Copy-Value $snapshot; $bad.$field = 'other'
  Reject { Assert-LegacyReceiptRecoverySnapshot $config $database $bad } 'snapshot substitution'
}
foreach ($value in @($false,'True',1)) {
  $bad = Copy-Value $snapshot; $bad.Encrypted = $value
  Reject { Assert-LegacyReceiptRecoverySnapshot $config $database $bad } 'snapshot encryption boolean'
}
foreach ($mutation in @(@{StorageEncrypted=$false},@{DeletionProtection=$false},@{PubliclyAccessible=$true},@{BackupRetentionPeriod=6},@{LatestRestorableTime=$null},@{DbiResourceId='db-OTHERINSTANCE1234'},@{StorageEncrypted='True'})) {
  $bad=Copy-Value $database; foreach($field in $mutation.Keys){$bad.$field=$mutation[$field]}
  Reject {Assert-LegacyReceiptRecoverySnapshot $config $bad $snapshot} 'database recovery mismatch'
}

$raw = ConvertTo-DeploymentCanonicalValue $config
$image = "${account}.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$($config.imageDigest)"
$container = [pscustomobject]@{
  name='legacy-receipt-transition';image=$image;essential=$true;readonlyRootFilesystem=$true;
  command=@('applications/dist/src/run-legacy-receipt-transition.js');
  environment=@(
    @{name='NODE_ENV';value='production'},@{name='LEGACY_RECEIPT_TRANSITION_ENABLED';value='true'},
    @{name='LEGACY_RECEIPT_TRANSITION_CONFIG_JSON';value=$raw},@{name='LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256';value=(Get-LegacyReceiptSha256 $raw)}
  );
  secrets=@(@{name='DATABASE_URL';valueFrom="arn:aws:secretsmanager:us-east-2:${account}:secret:ai-job-apply/development/database-url-AbCd12"});
  logConfiguration=@{logDriver='awslogs';options=@{'awslogs-region'='us-east-2';'awslogs-stream-prefix'='legacy-receipt-transition';'awslogs-group'='/ai-job-apply/development/application'}}
}
$taskDefinition = [pscustomobject]@{
  status='ACTIVE';family='ai-job-apply-development-legacy-receipt-transition';
  taskDefinitionArn="arn:aws:ecs:us-east-2:${account}:task-definition/ai-job-apply-development-legacy-receipt-transition:1";
  taskRoleArn="arn:aws:iam::${account}:role/ai-job-apply-development-legacy-receipt-transition";
  executionRoleArn="arn:aws:iam::${account}:role/ai-job-apply-development-execution";
  networkMode='awsvpc';cpu='256';memory='512';requiresCompatibilities=@('FARGATE');
  runtimePlatform=@{cpuArchitecture='X86_64';operatingSystemFamily='LINUX'};containerDefinitions=@($container)
}
$expected = [pscustomobject]@{arn=$taskDefinition.taskDefinitionArn;task_role_arn=$taskDefinition.taskRoleArn;
  execution_role_arn=$taskDefinition.executionRoleArn;cpu='256';memory='512';network_mode='awsvpc';
  container_definitions=ConvertTo-Json -InputObject @($container) -Depth 40 -Compress}
$admitted = Assert-LegacyReceiptTask $taskDefinition $expected $account $image $now
Check ($admitted.runId -ceq $config.runId) 'exact deployed task admitted'
foreach ($field in @('family','taskDefinitionArn','taskRoleArn','executionRoleArn','networkMode','cpu','memory')) {
  $bad=Copy-Value $taskDefinition;$bad.$field='other'
  Reject {Assert-LegacyReceiptTask $bad $expected $account $image $now} 'task authority substitution'
}
foreach ($field in @('privileged','entryPoint','environmentFiles','linuxParameters','user')) {
  $bad=Copy-Value $taskDefinition;$bad.containerDefinitions[0] | Add-Member $field 'unreviewed'
  Reject {Assert-LegacyReceiptTask $bad $expected $account $image $now} 'extra container authority'
}
$bad=Copy-Value $taskDefinition;$bad.containerDefinitions[0].environment+=@{name='NODE_OPTIONS';value='--inspect'}
Reject {Assert-LegacyReceiptTask $bad $expected $account $image $now} 'extra environment authority'
$bad=Copy-Value $taskDefinition;$bad.containerDefinitions[0].essential='True'
Reject {Assert-LegacyReceiptTask $bad $expected $account $image $now} 'boolean type preserved'
$bad=Copy-Value $taskDefinition;$bad | Add-Member enableFaultInjection $true
Reject {Assert-LegacyReceiptTask $bad $expected $account $image $now} 'fault injection refused'

# Import only function declarations, never the operator's entrypoint or real AWS transport.
$operator = Join-Path $PSScriptRoot '../operate-legacy-receipt-transition.ps1'
$maintenanceScriptRoot=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($operator))
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($operator,[ref]$tokens,[ref]$parseErrors)
Check (@($parseErrors).Count -eq 0) 'operator parses'
foreach ($name in @('Resolve-LegacyReceiptArtifact','Write-LegacyReceiptArtifact','Invoke-LegacyReceiptTransitionAction')) {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
  Invoke-Expression $definition.Extent.Text.Replace('$PSScriptRoot', '$maintenanceScriptRoot')
}
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot=Join-Path $repository '.tmp/legacy-receipt-maintenance-tests'
$privateRoot=Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $privateRoot -Force
$ExpectedAccountId=$account
$script:runCalls=0;$script:mode='success';$script:observationFailure=$false;$script:preflightMutated=$false
$taskArn="arn:aws:ecs:us-east-2:${account}:task/ai-job-apply-development/$('d'*32)"
$baseDescriptor=[pscustomobject]@{
  schemaVersion=1;accountId=$account;region='us-east-2';runId=$config.runId;configuration=$config;
  configurationSha256=Get-LegacyReceiptSha256 $raw;currentMigrationCount=15;
  taskDefinitionArn=$taskDefinition.taskDefinitionArn;clusterArn="arn:aws:ecs:us-east-2:${account}:cluster/ai-job-apply-development";
  logGroup='/ai-job-apply/development/application';request=@{clientToken=$config.runId;startedBy=$config.runId;count=1}
}
function Get-LegacyReceiptPreflight {
  $value=Copy-Value $script:planned
  if($script:preflightMutated){$value.clusterArn='changed'}
  return $value
}
function Read-LegacyReceiptAws([string[]]$Arguments) {
  switch ($Arguments[0]+':'+$Arguments[1]) {
    'ecs:run-task' {
      $script:runCalls++
      Check (Test-Path -LiteralPath (Join-Path $privateRoot "receipt-$($script:planned.runId).json")) 'claim persisted before RunTask'
      if($script:mode -ceq 'lost-ack'){throw 'simulated transport interruption after submission'}
      return [pscustomobject]@{failures=@();tasks=@([pscustomobject]@{taskArn=$taskArn})}
    }
    'ecs:list-tasks' {
      if($Arguments[-1] -ceq 'RUNNING'){return [pscustomobject]@{taskArns=@()}}
      return [pscustomobject]@{taskArns=@($taskArn)}
    }
    'ecs:describe-tasks' {
      if($script:observationFailure){throw 'simulated observation timeout'}
      $observedTask=[pscustomobject]@{
        taskArn=$taskArn;taskDefinitionArn=$script:planned.taskDefinitionArn;clusterArn=$script:planned.clusterArn;
        startedBy=$script:planned.runId;launchType='FARGATE';lastStatus='STOPPED';enableExecuteCommand=$false;platformVersion='1.4.0';
        overrides=[pscustomobject]@{containerOverrides=@([pscustomobject]@{name='legacy-receipt-transition'});inferenceAcceleratorOverrides=@()};
        containers=@([pscustomobject]@{name='legacy-receipt-transition';exitCode=0;imageDigest="sha256:$($config.imageDigest)"})
      }
      switch($script:mode) {
        'failed-task' {$observedTask.containers[0].exitCode=1}
        'wrong-image' {$observedTask.containers[0].imageDigest='sha256:'+('e'*64)}
        'override' {$observedTask.overrides|Add-Member cpu '512'}
        'wrong-original' {$observedTask.startedBy='f'*32}
        'pending' {$observedTask.lastStatus='RUNNING'}
      }
      return [pscustomobject]@{failures=@();tasks=@($observedTask)}
    }
    'logs:get-log-events' {
      $message=@{kind='legacy_receipt_transition_verified';schemaVersion=1;runId=$script:planned.runId;
        sourceSha=$config.sourceSha;configurationSha256=$script:planned.configurationSha256;archivedReceipts=7;appliedMigrations=12}
      if($script:mode -ceq 'wrong-aggregate'){$message.archivedReceipts=6}
      return [pscustomobject]@{events=@([pscustomobject]@{message=($message|ConvertTo-Json -Compress)})}
    }
    default {throw 'Unexpected cloud call in synthetic maintenance test'}
  }
}
try {
  foreach($scenario in @('success','lost-ack','wrong-aggregate','failed-task','wrong-image','override','wrong-original','pending')) {
    $script:mode=$scenario;$script:planned=Copy-Value $baseDescriptor
    $script:planned.runId=[guid]::NewGuid().ToString('N');$script:planned.configuration.runId=$script:planned.runId
    $script:planned.request.clientToken=$script:planned.runId;$script:planned.request.startedBy=$script:planned.runId
    $script:planned.configurationSha256=Get-LegacyReceiptSha256 (ConvertTo-DeploymentCanonicalValue $script:planned.configuration)
    $PlanPath=Join-Path $privateRoot "$scenario.json";$Action='PlanExecution'
    $result=Invoke-LegacyReceiptTransitionAction
    Check ($result.outcome -ceq 'planned') 'planning creates no task'
    $ReviewedPlanSha256=$result.planSha256;$Action='Execute';$before=$script:runCalls
    $script:preflightMutated=$true
    Reject {Invoke-LegacyReceiptTransitionAction} 'fresh preflight drift refuses execution'
    Check ($script:runCalls -eq $before) 'drift refusal never launches'
    Check (-not (Test-Path -LiteralPath (Join-Path $privateRoot "receipt-$($script:planned.runId).json"))) 'drift refused before claiming'
    $script:preflightMutated=$false
    if($scenario -ceq 'lost-ack'){Reject {Invoke-LegacyReceiptTransitionAction} 'ambiguous launch surfaced'}
    else {Check ((Invoke-LegacyReceiptTransitionAction).outcome -ceq 'submitted') 'one original submission'}
    Check ($script:runCalls -eq $before+1) 'exactly one RunTask'
    Reject {Invoke-LegacyReceiptTransitionAction} 'repeat Execute cannot submit again'
    $Action='Recover';$script:observationFailure=$true
    Reject {Invoke-LegacyReceiptTransitionAction} 'observation timeout retains original claim'
    Check ($script:runCalls -eq $before+1) 'timeout did not resubmit'
    $script:observationFailure=$false
    if($scenario -cin @('wrong-aggregate','failed-task','wrong-image','override','wrong-original')){Reject {Invoke-LegacyReceiptTransitionAction} 'incompatible execution cannot verify'}
    elseif($scenario -ceq 'pending') {
      Check ((Invoke-LegacyReceiptTransitionAction).outcome -ceq 'pending') 'live original task remains pending'
      $script:mode='success'
      Check ((Invoke-LegacyReceiptTransitionAction).outcome -ceq 'verified') 'same original task completes later'
    }
    else {Check ((Invoke-LegacyReceiptTransitionAction).outcome -ceq 'verified') 'original task recovered'}
    Check ($script:runCalls -eq $before+1) 'recovery never submits'
  }
  Reject {Resolve-LegacyReceiptArtifact (Join-Path $repository 'outside.json')} 'private artifact containment'
  $Action='Recover';$ReviewedPlanSha256='0'*64
  Reject {Invoke-LegacyReceiptTransitionAction} 'substituted plan hash cannot recover'
  # Construct an original synthetic receipt from yesterday; recovery has no new-run authority.
  $script:planned.configuration.issuedAt=Instant $now.AddDays(-1).AddMinutes(-1)
  $script:planned.configuration.expiresAt=Instant $now.AddDays(-1).AddMinutes(25)
  $script:planned.configuration.snapshotCreatedAt=Instant $now.AddDays(-1).AddMinutes(-5)
  $script:planned.configurationSha256=Get-LegacyReceiptSha256 (ConvertTo-DeploymentCanonicalValue $script:planned.configuration)
  Write-LegacyReceiptArtifact $PlanPath $script:planned -Replace
  $ReviewedPlanSha256=(Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-LegacyReceiptArtifact (Join-Path $privateRoot "receipt-$($script:planned.runId).json") ([pscustomobject]@{schemaVersion=1;planSha256=$ReviewedPlanSha256;state='submitted';taskArn=$taskArn}) -Replace
  $before=$script:runCalls
  Check ((Invoke-LegacyReceiptTransitionAction).outcome -ceq 'verified') 'expired authority still allows original observation'
  Check ($script:runCalls -eq $before) 'expired recovery never submits'
} finally {
  if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($privateRoot)) -cne $testRoot){throw 'Unsafe synthetic cleanup'}
  Remove-Item -LiteralPath $privateRoot -Recurse -Force
}
# Exercise the complete real preflight with injected AWS/CLI boundaries; no child command runs.
foreach ($name in @('Get-LegacyReceiptResource','Assert-LegacyReceiptManagedRole','Assert-LegacyReceiptLiveDrain','Get-LegacyReceiptPreflight')) {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
  Invoke-Expression $definition.Extent.Text.Replace('$PSScriptRoot', '$maintenanceScriptRoot')
}
$privateRoot=Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $privateRoot -Force
$PublicationReceiptPath=Join-Path $privateRoot 'publication.json'
Write-LegacyReceiptArtifact $PublicationReceiptPath @{sourceSha=$config.sourceSha;imageUri=$image}
$PublicationReceiptSha256=(Get-FileHash -LiteralPath $PublicationReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
$AwsProfile='synthetic';$StateBucket='synthetic-state'
$trust=@{Version='2012-10-17';Statement=@(@{Effect='Allow';Action='sts:AssumeRole';Principal=@{Service='ecs-tasks.amazonaws.com'}})}
$keyPolicy=@{Version='2012-10-17';Statement=@(@{Effect='Deny';Action=@('kms:Encrypt','kms:Decrypt');Resource='*'})}
$rolePolicy=@{Version='2012-10-17';Statement=@(@{Effect='Allow';Action=@('kms:Encrypt','kms:Decrypt');Resource=$config.encryptionKeyArn})}
$role=[pscustomobject]@{name='ai-job-apply-development-legacy-receipt-transition';arn=$taskDefinition.taskRoleArn;
  permissions_boundary="arn:aws:iam::${account}:policy/ai-job-apply-development-workload-boundary";
  assume_role_policy=($trust|ConvertTo-Json -Depth 20 -Compress)}
function Resource([string]$Type,[string]$Name,$Attributes) {
  return [pscustomobject]@{module='module.platform';mode='managed';type=$Type;name=$Name;instances=@(@{attributes=$Attributes})}
}
$state=[pscustomobject]@{lineage='synthetic-lineage';serial=456;resources=@(
  (Resource 'aws_ecs_task_definition' 'legacy_receipt_transition' $expected),
  (Resource 'aws_kms_key' 'legacy_receipt_encryption' @{arn=$config.encryptionKeyArn;policy=($keyPolicy|ConvertTo-Json -Depth 20 -Compress)}),
  (Resource 'aws_iam_role' 'legacy_receipt_transition' $role),
  (Resource 'aws_iam_role_policy' 'legacy_receipt_transition' @{name='legacy-receipt-transition';policy=($rolePolicy|ConvertTo-Json -Depth 20 -Compress)}),
  (Resource 'aws_db_instance' 'postgres' @{resource_id=$config.databaseResourceId}),
  (Resource 'aws_ecs_cluster' 'this' @{arn=$baseDescriptor.clusterArn}),
  (Resource 'aws_security_group' 'application' @{id='sg-11111111111111111';vpc_id='vpc-11111111111111111'}),
  [pscustomobject]@{module='module.platform';mode='managed';type='aws_subnet';name='public';instances=@(@{attributes=@{id='subnet-11111111111111111'}},@{attributes=@{id='subnet-22222222222222222'}})}
)}
$script:preflightMode='success';$script:stateReads=0;$script:imageVerifications=0;$script:drainVerifications=0;$script:nativeDrainReads=0
function Read-LegacyReceiptState {
  $script:stateReads++;$value=Copy-Value $state
  if($script:preflightMode -ceq 'state-drift' -and $script:stateReads -ge 2){$value.serial++}
  return $value
}
function pwsh {
  if($args -contains 'Verify'){$script:imageVerifications++;Check ($args -contains $PublicationReceiptSha256) 'publisher gets exact receipt hash'}
  elseif($args -contains 'Status'){$script:drainVerifications++}
  else{throw 'Unexpected child script mode'}
  $global:LASTEXITCODE=if($script:preflightMode -ceq 'publisher-failed' -and $args -contains 'Verify'){1}else{0}
}
function git {
  $global:LASTEXITCODE=0
  if($args -contains 'cat-file'){
    if($script:preflightMode -ceq 'missing-executable'){$global:LASTEXITCODE=1}
    return
  }
  if($args -contains 'show'){return (@{contributors=@(@{owner='applications';migrations=@(1..15)})}|ConvertTo-Json -Depth 5 -Compress)}
  throw 'Unexpected git operation'
}
function Read-LegacyReceiptAws([string[]]$Arguments) {
  switch($Arguments[0]+':'+$Arguments[1]) {
    'ecs:describe-task-definition' {return [pscustomobject]@{taskDefinition=(Copy-Value $taskDefinition)}}
    'kms:describe-key' {return [pscustomobject]@{KeyMetadata=@{Arn=$config.encryptionKeyArn;KeyState='Enabled';KeyUsage='ENCRYPT_DECRYPT';KeySpec='SYMMETRIC_DEFAULT'}}}
    'kms:get-key-policy' {return [pscustomobject]@{Policy=($keyPolicy|ConvertTo-Json -Depth 20 -Compress)}}
    'iam:get-role' {return [pscustomobject]@{Role=@{Arn=$role.arn;PermissionsBoundary=@{PermissionsBoundaryArn=$role.permissions_boundary};AssumeRolePolicyDocument=$trust}}}
    'iam:list-attached-role-policies' {return [pscustomobject]@{AttachedPolicies=@()}}
    'iam:list-role-policies' {return [pscustomobject]@{PolicyNames=@('legacy-receipt-transition')}}
    'iam:get-role-policy' {return [pscustomobject]@{PolicyDocument=$rolePolicy}}
    'lambda:list-functions' {return [pscustomobject]@{Functions=@([pscustomobject]@{FunctionName='ai-job-apply-development-resume-durable-r1';DurableConfig=@{ExecutionTimeout=600}},[pscustomobject]@{FunctionName='ai-job-apply-development-gateway'})}}
    'lambda:list-durable-executions-by-function' {
      $script:nativeDrainReads++
      return [pscustomobject]@{DurableExecutions=$(if($script:preflightMode -ceq 'native-running'){@('active')}else{@()})}
    }
    'rds:describe-db-instances' {return [pscustomobject]@{DBInstances=@($database)}}
    'rds:describe-db-snapshots' {return [pscustomobject]@{DBSnapshots=@($snapshot)}}
    'ecs:list-services' {return [pscustomobject]@{serviceArns=@()}}
    'ec2:describe-subnets' {return [pscustomobject]@{Subnets=@(@{SubnetId='subnet-11111111111111111';VpcId='vpc-11111111111111111'},@{SubnetId='subnet-22222222222222222';VpcId='vpc-11111111111111111'})}}
    'ec2:describe-security-groups' {return [pscustomobject]@{SecurityGroups=@(@{GroupId='sg-11111111111111111';VpcId='vpc-11111111111111111'})}}
    default {throw 'Unexpected preflight AWS call'}
  }
}
try {
  $preflight=Get-LegacyReceiptPreflight
  Check ($preflight.runId -ceq $config.runId -and $preflight.request.clientToken -ceq $config.runId) 'real preflight creates original request'
  Check ($preflight.request.count -eq 1 -and $preflight.request.enableExecuteCommand -eq $false) 'single noninteractive task'
  Check ($script:imageVerifications -eq 1 -and $script:drainVerifications -eq 1 -and $script:nativeDrainReads -eq 1 -and $script:stateReads -eq 2) 'all external prerequisites and late state read exercised'
  foreach($mode in @('publisher-failed','missing-executable','native-running','state-drift')) {
    $script:preflightMode=$mode;$script:stateReads=0
    Reject {Get-LegacyReceiptPreflight} 'failed prerequisite refuses plan'
  }
} finally {
  Remove-Item Function:pwsh,Function:git
  if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($privateRoot)) -cne $testRoot){throw 'Unsafe synthetic cleanup'}
  Remove-Item -LiteralPath $privateRoot -Recurse -Force
}
Write-Output "Legacy receipt maintenance: $checks checks passed; synthetic AWS responses and temporary local receipts only."
