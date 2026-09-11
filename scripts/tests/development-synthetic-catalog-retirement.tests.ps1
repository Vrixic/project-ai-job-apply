Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts/operate-development-synthetic-catalog-retirement.ps1"
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")
. (Join-Path $repositoryRoot "scripts/lib/deployment-operator-guards.ps1")
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The retirement operator does not parse." }
$definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
if (@($definitions | Group-Object Name | Where-Object Count -ne 1).Count -ne 0) { throw "Duplicate retirement functions." }
foreach ($definition in $definitions) { Invoke-Expression ("function " + $definition.Name + " " + $definition.Body.Extent.Text) }
$script:assertions=0
function Assert-Test {
  param([bool]$Condition,[string]$Description)
  if (-not $Condition) { throw "Failed: $Description" }
  $script:assertions++
}
function Assert-Rejected {
  param([scriptblock]$Operation,[string]$Description)
  $rejected=$false
  try { $null=& $Operation } catch { $rejected=$true }
  Assert-Test $rejected $Description
}
function Copy-Json {
  param([object]$Value)
  return ConvertFrom-RetirementJson -Json ($Value | ConvertTo-Json -Depth 60 -Compress) -Description "Generated fixture"
}
function Set-TestProperty {
  param([object]$Value,[string]$Name,[AllowNull()][object]$Replacement)
  $Value | Add-Member -NotePropertyName $Name -NotePropertyValue $Replacement -Force
}
# No external process, AWS, Docker, database or credential call is allowed by this suite.
$script:awsCalls=@()
$script:awsMock={ param($Arguments,$Operation) throw "Unexpected generated AWS call." }
function Invoke-AwsJson {
  param([string[]]$Arguments,[string]$Operation)
  $script:awsCalls += ,@($Arguments)
  return & $script:awsMock $Arguments $Operation
}
function Start-Sleep { param([int]$Seconds) }
$Region="us-east-2"; $ExpectedAccountId="111111111111"; $StateBucket="generated-state"
$AwsProfile="generated-profile"; $SourceSha="a"*40; $ReviewedMigrationReceiptSha256="b"*64
$MigrationReceiptPath="generated-receipt.json"; $InspectionReceiptPath=""; $ReviewedInspectionReceiptSha256=""
$ExpectedManifestSha256=""; $RecoveryContextPath=""; $ReviewedRecoveryContextSha256=""; $Action="Inspect"
$migrationFamily="ai-job-apply-development-database-migration"; $containerName="database-migration"
$applicationLogGroup="/ai-job-apply/development/application"
$retirementCommand=@("jobs/dist/src/run-synthetic-catalog-retirement.js")
$confirmation="retain-generated-source-neutral-history"
$utf8WithoutBom=New-Object Text.UTF8Encoding($false)
$originalArn="arn:aws:ecs:us-east-2:111111111111:task-definition/ai-job-apply-development-database-migration:51"
$temporaryArn="arn:aws:ecs:us-east-2:111111111111:task-definition/ai-job-apply-development-database-migration:52"
$clusterArn="arn:aws:ecs:us-east-2:111111111111:cluster/ai-job-apply-development"
$taskArn="arn:aws:ecs:us-east-2:111111111111:task/ai-job-apply-development/"+("c"*32)
$image="111111111111.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:"+("d"*64)
$receipt=Copy-Json @{imageUri=$image;platformDigest=("sha256:"+("e"*64))}
$declared=Copy-Json @{
  name=$containerName; image=("111111111111.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:"+("f"*64))
  essential=$true; command=@("runner/dist/src/main.js"); readonlyRootFilesystem=$true
  environment=@(@{name="NODE_ENV";value="production"})
  secrets=@(@{name="DATABASE_URL";valueFrom="arn:aws:secretsmanager:us-east-2:111111111111:secret:generated-database-abcdef"})
  logConfiguration=@{logDriver="awslogs";options=@{"awslogs-group"=$applicationLogGroup;"awslogs-region"=$Region;"awslogs-stream-prefix"="database-migration"}}
}
$owned=Copy-Json @{arn=$originalArn;execution_role_arn="arn:aws:iam::111111111111:role/ai-job-apply-development-execution";container_definitions=(ConvertTo-Json -InputObject @($declared) -Depth 30 -Compress);tags_all=@{Environment="development";Project="ai-job-apply"}}
$nativeContainer=Copy-Json $declared
foreach ($name in @("portMappings","mountPoints","volumesFrom","systemControls","resourceRequirements","environmentFiles","dependsOn","ulimits","credentialSpecs")) { Set-TestProperty $nativeContainer $name @() }
Set-TestProperty $nativeContainer "cpu" 0
$native=Copy-Json @{
  taskDefinition=@{
    taskDefinitionArn=$originalArn;family=$migrationFamily;revision=51;status="ACTIVE";executionRoleArn=$owned.execution_role_arn
    networkMode="awsvpc";cpu="256";memory="512";requiresCompatibilities=@("FARGATE");compatibilities=@("EC2","FARGATE")
    runtimePlatform=@{cpuArchitecture="X86_64";operatingSystemFamily="LINUX"};enableFaultInjection=$false
    volumes=@();placementConstraints=@();requiresAttributes=@(@{name="com.amazonaws.ecs.capability.ecr-auth"})
    registeredAt="2026-09-11T12:00:00+00:00";registeredBy="arn:aws:sts::111111111111:assumed-role/generated/session"
    containerDefinitions=@($nativeContainer)
  };tags=@(@{key="Environment";value="development"},@{key="Project";value="ai-job-apply"})
}
$registration=New-RetirementRegistration $native $owned $image
$runtime=Copy-Json @{clusterArn=$clusterArn;originalTaskDefinitionArn=$originalArn;subnets=@("subnet-a1","subnet-b2");securityGroup="sg-c3";registration=$registration;ownedTask=$owned}
$manifest="1"*64
$runId="2"*32
$result=Copy-Json @{schemaVersion=1;action="inspect";namespace="synthetic-foundation-v1";manifestSha256=$manifest;matchingJobs=3;matchingSources=3;retirableJobs=2;alreadyHiddenJobs=1;retiredJobs=0;appendedStatusEvents=0;otherActiveAuthorizedFixtureJobs=101}
$snapshot=Copy-Json @{Lineage="11111111-1111-1111-1111-111111111111";Serial=329;VersionId="generated-version"}
$context=Copy-Json @{
  schemaVersion=1;kind="development-synthetic-catalog-retirement";environment="development";region=$Region;accountId=$ExpectedAccountId;sourceSha=$SourceSha
  migrationReceiptSha256=$ReviewedMigrationReceiptSha256;imageUri=$image;manifestSha256="";action="inspect";runId=$runId;startedAt="2026-09-11T12:00:00.0000000+00:00"
  stateIdentity=(Get-RetirementStateIdentity $snapshot);applicationSha256=("3"*64)
  runtime=@{clusterArn=$clusterArn;originalTaskDefinitionArn=$originalArn;subnets=$runtime.subnets;securityGroup=$runtime.securityGroup}
  registrationSha256=(Get-TextSha256 (ConvertTo-DeploymentCanonicalValue $registration));temporaryTaskDefinitionArn=$temporaryArn
  request=(New-RetirementTaskRequest $runtime $temporaryArn "inspect" $runId "");taskArn=$taskArn;phase="complete";result=$result;temporaryRevisionDeregistered=$true
}
$expectedParameters=@("Action","AwsProfile","Region","ExpectedAccountId","StateBucket","SourceSha","MigrationReceiptPath","ReviewedMigrationReceiptSha256","InspectionReceiptPath","ReviewedInspectionReceiptSha256","ExpectedManifestSha256","RecoveryContextPath","ReviewedRecoveryContextSha256","Help")
Assert-Test ((@($ast.ParamBlock.Parameters | ForEach-Object {$_.Name.VariablePath.UserPath}) -join "|") -ceq ($expectedParameters -join "|")) "Exact public parameter surface"
foreach ($forbidden in @("Invoke-Expression","psql","DELETE FROM","TRUNCATE ","terraform apply","stop-task","update-service","put-role-policy")) { Assert-Test (-not $source.Contains($forbidden)) "No arbitrary or enduring mutation: $forbidden" }
Assert-RetirementInputs
Assert-Test ($script:awsCalls.Count -eq 0) "Input guards are local"
foreach ($actionName in @("Retire","Recover")) { $Action=$actionName; Assert-Rejected {Assert-RetirementInputs} "Missing $actionName evidence" }
$Action="Inspect"
foreach ($name in @("Region","ExpectedAccountId","StateBucket","AwsProfile","SourceSha","MigrationReceiptPath","ReviewedMigrationReceiptSha256")) {
  $old=Get-Variable $name -ValueOnly
  Set-Variable $name ""
  Assert-Rejected {Assert-RetirementInputs} "Missing $name refuses"
  Set-Variable $name $old
}
$before=ConvertTo-DeploymentCanonicalValue $native
Assert-Test ($registration.containerDefinitions[0].image -ceq $image) "Only image changes in registration"
Assert-Test ($before -ceq (ConvertTo-DeploymentCanonicalValue $native)) "Registration preserves native observation"
Assert-Test ($null -eq $registration.PSObject.Properties["taskDefinitionArn"]) "Registration removes only computed identity"
Assert-Test ($registration.containerDefinitions[0].cpu -eq 0) "Native integer CPU zero accepted"
# Terraform also persists ECS-normalized default fields in container_definitions.
$ownedDefaults=Copy-Json $owned
$ownedDefaults.container_definitions=ConvertTo-Json -InputObject @($nativeContainer) -Depth 30 -Compress
$ownedBefore=ConvertTo-DeploymentCanonicalValue $ownedDefaults
Assert-Test ((ConvertTo-DeploymentCanonicalValue (New-RetirementRegistration $native $ownedDefaults $image)) -ceq (ConvertTo-DeploymentCanonicalValue $registration)) "Both native and Terraform default metadata normalize identically"
Assert-Test ($ownedBefore -ceq (ConvertTo-DeploymentCanonicalValue $ownedDefaults)) "Symmetric normalization preserves original Terraform bytes"
foreach ($field in @("portMappings","mountPoints","volumesFrom","systemControls","resourceRequirements","environmentFiles","dependsOn","ulimits","credentialSpecs")) {
  foreach ($invalid in @($null,"",0,$false,@("nonempty"))) {
    $stateContainer=Copy-Json $nativeContainer; Set-TestProperty $stateContainer $field $invalid
    $badOwned=Copy-Json $ownedDefaults; $badOwned.container_definitions=ConvertTo-Json -InputObject @($stateContainer) -Depth 30 -Compress
    Assert-Rejected {New-RetirementRegistration $native $badOwned $image} "Terraform default $field exact empty array only"
  }
}
foreach ($invalid in @($null,"0",0.5,$false,1)) {
  $stateContainer=Copy-Json $nativeContainer; $stateContainer.cpu=$invalid
  $badOwned=Copy-Json $ownedDefaults; $badOwned.container_definitions=ConvertTo-Json -InputObject @($stateContainer) -Depth 30 -Compress
  Assert-Rejected {New-RetirementRegistration $native $badOwned $image} "Terraform CPU default integer zero only"
}
$stateContainer=Copy-Json $nativeContainer; Set-TestProperty $stateContainer "privileged" $true
$badOwned=Copy-Json $ownedDefaults; $badOwned.container_definitions=ConvertTo-Json -InputObject @($stateContainer) -Depth 30 -Compress
Assert-Rejected {New-RetirementRegistration $native $badOwned $image} "Symmetric normalization never removes unknown Terraform capabilities"
foreach ($name in @("privileged","user","entryPoint","dockerSecurityOptions","linuxParameters")) {
  $bad=Copy-Json $native; Set-TestProperty $bad.taskDefinition.containerDefinitions[0] $name "unexpected"
  Assert-Rejected {New-RetirementRegistration $bad $owned $image} "Container capability $name refuses"
}
foreach ($name in @("portMappings","mountPoints","volumesFrom","systemControls","resourceRequirements","environmentFiles","dependsOn","ulimits","credentialSpecs")) {
  foreach ($invalid in @($null,"",0,$false,@("nonempty"))) {
    $bad=Copy-Json $native; Set-TestProperty $bad.taskDefinition.containerDefinitions[0] $name $invalid
    Assert-Rejected {New-RetirementRegistration $bad $owned $image} "Native $name only exact empty array"
  }
}
foreach ($invalid in @($null,"0",0.5,$false,1)) {
  $bad=Copy-Json $native; $bad.taskDefinition.containerDefinitions[0].cpu=$invalid
  Assert-Rejected {New-RetirementRegistration $bad $owned $image} "CPU integer zero only"
}
foreach ($pair in @(@("family","other"),@("executionRoleArn","other"),@("networkMode","host"),@("cpu","512"),@("memory","1024"),@("status","INACTIVE"),@("taskDefinitionArn",$temporaryArn),@("enableFaultInjection",$true))) {
  $bad=Copy-Json $native; Set-TestProperty $bad.taskDefinition $pair[0] $pair[1]
  Assert-Rejected {New-RetirementRegistration $bad $owned $image} "Task boundary $($pair[0])"
}
$bad=Copy-Json $native; Set-TestProperty $bad.taskDefinition "taskRoleArn" "arn:aws:iam::111111111111:role/other"
Assert-Rejected {New-RetirementRegistration $bad $owned $image} "No task role"
$bad=Copy-Json $native; $bad.tags[0].value="production"
Assert-Rejected {New-RetirementRegistration $bad $owned $image} "Exact Terraform tags"
$temporary=Copy-Json $native; $temporary.taskDefinition.taskDefinitionArn=$temporaryArn; $temporary.taskDefinition.revision=52; $temporary.taskDefinition.containerDefinitions[0].image=$image
Assert-Test ((ConvertTo-DeploymentCanonicalValue (New-RetirementRegistration $temporary $owned $image -Temporary)) -ceq (ConvertTo-DeploymentCanonicalValue $registration)) "Exact temporary image-only clone"
foreach ($operation in @("inspect","retire")) {
  $digest=if($operation -ceq "retire"){$manifest}else{""}
  $request=Copy-Json (New-RetirementTaskRequest $runtime $temporaryArn $operation $runId $digest)
  Assert-Test (($request.overrides.containerOverrides[0].command -join "|") -ceq "jobs/dist/src/run-synthetic-catalog-retirement.js") "Fixed Node entrypoint-relative command"
  Assert-Test ($request.networkConfiguration.awsvpcConfiguration.assignPublicIp -ceq "DISABLED" -and -not $request.enableExecuteCommand -and $request.count -eq 1) "Private one-off task only"
  Assert-Test ($request.overrides.containerOverrides[0].environment.Count -eq $(if($operation -ceq "retire"){4}else{3})) "Closed action-specific environment"
}
Assert-Rejected {New-RetirementTaskRequest $runtime $temporaryArn "inspect" $runId $manifest} "Inspect forbids manifest injection"
Assert-Rejected {New-RetirementTaskRequest $runtime $temporaryArn "retire" $runId ""} "Retire requires exact digest"
Assert-Test (Assert-RetirementResult $result "inspect") "JSON integer aggregate accepted"
$retired=Copy-Json $result; $retired.action="retire"; $retired.retiredJobs=2; $retired.appendedStatusEvents=2
Assert-Test (Assert-RetirementResult $retired "retire" $manifest) "Retire exact preimage aggregate accepted"
Assert-Rejected {Assert-RetirementResult $retired "retire" ("9"*64)} "Retire preimage digest mismatch"
foreach ($field in @("schemaVersion","matchingJobs","matchingSources","retirableJobs","alreadyHiddenJobs","retiredJobs","appendedStatusEvents","otherActiveAuthorizedFixtureJobs")) {
  foreach ($invalid in @($null,"1",$true,-1,1.5)) {
    $bad=Copy-Json $result; Set-TestProperty $bad $field $invalid
    Assert-Rejected {Assert-RetirementResult $bad "inspect"} "Strict integer aggregate $field"
  }
}
$bad=Copy-Json $result; $bad.matchingSources=101
Assert-Rejected {Assert-RetirementResult $bad "inspect"} "Target source count bounded"
$bad=Copy-Json $result; $bad.matchingSources=4
Assert-Rejected {Assert-RetirementResult $bad "inspect"} "Exact one source per matching job"
$bad=Copy-Json $result; $bad.otherActiveAuthorizedFixtureJobs=[long]9007199254740991
Assert-Test (Assert-RetirementResult $bad "inspect") "Outside aggregate accepts exact safe integer bound"
$bad.otherActiveAuthorizedFixtureJobs=[long]9007199254740992
Assert-Rejected {Assert-RetirementResult $bad "inspect"} "Outside aggregate safe integer bound"
foreach ($field in @("jobIds","sql","sources")) {
  $bad=Copy-Json $result; Set-TestProperty $bad $field @()
  Assert-Rejected {Assert-RetirementResult $bad "inspect"} "No raw result $field"
}
Assert-RetirementContext $context $snapshot $runtime $receipt ("3"*64)
Assert-Test $true "JSON context native integer accepted"
foreach ($field in @("sourceSha","migrationReceiptSha256","imageUri","applicationSha256","registrationSha256","accountId","region","kind","environment","runId","startedAt","phase")) {
  $bad=Copy-Json $context; Set-TestProperty $bad $field "wrong"
  Assert-Rejected {Assert-RetirementContext $bad $snapshot $runtime $receipt ("3"*64)} "Context binding $field"
}
$bad=Copy-Json $context; $bad.request.overrides.containerOverrides[0].command=@("runner/dist/src/main.js")
Assert-Rejected {Assert-RetirementContext $bad $snapshot $runtime $receipt ("3"*64)} "Context cannot substitute migration command"
$bad=Copy-Json $context; $bad.request.networkConfiguration.awsvpcConfiguration.assignPublicIp="ENABLED"
Assert-Rejected {Assert-RetirementContext $bad $snapshot $runtime $receipt ("3"*64)} "Context cannot enable public IP"
$bad=Copy-Json $context; $bad.temporaryTaskDefinitionArn=$originalArn
Assert-Rejected {Assert-RetirementContext $bad $snapshot $runtime $receipt ("3"*64)} "Original revision never temporary target"
$bad=Copy-Json $context; $bad.temporaryRevisionDeregistered=$false
Assert-Rejected {Assert-RetirementContext $bad $snapshot $runtime $receipt ("3"*64)} "Completion requires cleanup"
$nativeTask=Copy-Json @{
  taskArn=$taskArn;clusterArn=$clusterArn;taskDefinitionArn=$temporaryArn;launchType="FARGATE";platformVersion="1.4.0";startedBy=$context.request.startedBy
  enableExecuteCommand=$false;lastStatus="STOPPED";overrides=$context.request.overrides
  containers=@(@{name=$containerName;image=$image;imageDigest=$receipt.platformDigest;exitCode=0})
}
Set-TestProperty $nativeTask.overrides "inferenceAcceleratorOverrides" @()
Set-TestProperty $nativeTask.overrides.containerOverrides[0] "resourceRequirements" @()
$script:taskFixture=$nativeTask; $script:definitionFixture=$temporary; $script:logReads=0
$script:awsMock={
  param($Arguments,$Operation)
  switch ($Arguments[1]) {
    "describe-tasks" { return Copy-Json @{failures=@();tasks=@($script:taskFixture)} }
    "describe-task-definition" { return Copy-Json $script:definitionFixture }
    "deregister-task-definition" { return Copy-Json @{taskDefinition=@{taskDefinitionArn=$temporaryArn;status="INACTIVE"}} }
    "get-log-events" {
      $script:logReads++
      $events=@()
      if($script:logReads -eq 1){$events=@(@{message=($result | ConvertTo-Json -Depth 10 -Compress)})}
      return Copy-Json @{events=$events;nextForwardToken="fixed-forward-token"}
    }
    default { throw "Unexpected generated AWS operation." }
  }
}
$before=ConvertTo-DeploymentCanonicalValue $nativeTask
Assert-Test ((Read-RetirementTask $context $receipt).taskArn -ceq $taskArn) "Native task default empty metadata accepted"
Assert-Test ($before -ceq (ConvertTo-DeploymentCanonicalValue $nativeTask)) "Task metadata normalized on clone only"
Assert-Test ((Read-RetirementTaskResult $context $receipt).manifestSha256 -ceq $manifest -and $script:logReads -eq 2) "Bounded exact task logs form result"
$originalAwsMock=$script:awsMock
$script:logReads=0
$script:awsMock={
  param($Arguments,$Operation)
  if($Arguments[1] -ceq "describe-tasks"){return Copy-Json @{failures=@();tasks=@($script:taskFixture)}}
  if($Arguments[1] -ceq "get-log-events"){
    $script:logReads++; $events=@()
    if($script:logReads -eq 1){$events=@(@{message=($result | ConvertTo-Json -Depth 10 -Compress)})}
    return Copy-Json @{events=$events;nextForwardToken=("unstable-"+$script:logReads)}
  }
  throw "Unexpected generated AWS operation."
}
Assert-Rejected {Read-RetirementTaskResult $context $receipt} "One result without complete bounded log enumeration refuses"
Assert-Test ($script:logReads -eq 10) "Log enumeration obeys ten-read bound"
$script:awsMock=$originalAwsMock
foreach ($field in @("inferenceAcceleratorOverrides","resourceRequirements")) {
  foreach ($invalid in @($null,"",@("unexpected"))) {
    $script:taskFixture=Copy-Json $nativeTask
    $target=if($field -ceq "resourceRequirements"){$script:taskFixture.overrides.containerOverrides[0]}else{$script:taskFixture.overrides}
    Set-TestProperty $target $field $invalid
    Assert-Rejected {Read-RetirementTask $context $receipt} "Native override $field exact empty only"
  }
}
$script:taskFixture=Copy-Json $nativeTask
$script:taskFixture.overrides.containerOverrides[0].command=@("other")
Assert-Rejected {Read-RetirementTask $context $receipt} "Actual task command differs"
$script:taskFixture=Copy-Json $nativeTask
$script:taskFixture.containers[0].imageDigest="sha256:"+("0"*64)
Assert-Rejected {Read-RetirementTask $context $receipt} "Actual platform digest differs"
$script:taskFixture=Copy-Json $nativeTask
foreach ($phase in @("registering","submitting","running")) {
  $bad=Copy-Json $context; $bad.phase=$phase; $count=$script:awsCalls.Count
  Assert-Rejected {Remove-RetirementRevision $bad $runtime $receipt} "No cleanup of unresolved $phase"
  Assert-Test ($script:awsCalls.Count -eq $count) "Unresolved cleanup has no AWS mutation"
}
$bad=Copy-Json $context; $bad.phase="stopped"; $bad.temporaryRevisionDeregistered=$false
Remove-RetirementRevision $bad $runtime $receipt
Assert-Test $bad.temporaryRevisionDeregistered "Stopped exact revision deregistered"
$deregister=@($script:awsCalls | Where-Object {$_[1] -ceq "deregister-task-definition"})
Assert-Test ($deregister.Count -eq 1 -and $deregister[0][3] -ceq $temporaryArn) "Only exact temporary revision deregistered once"
$script:taskFixture=Copy-Json $nativeTask; $script:taskFixture.lastStatus="RUNNING"
$bad=Copy-Json $context; $bad.phase="stopped"
Assert-Rejected {Remove-RetirementRevision $bad $runtime $receipt} "Context STOPPED cannot replace actual stopped observation"
$script:taskFixture=Copy-Json $nativeTask
# Bounded local fixture path is generated and verified before exact recursive cleanup.
$fixtureRoot=Join-Path $repositoryRoot (".tmp/retirement-tests-"+[guid]::NewGuid().ToString("N"))
$null=New-Item -ItemType Directory -Path $fixtureRoot
$operatorRoot=Join-Path $fixtureRoot "operator"
$outerEnvironment=@{}
foreach ($name in @("AWS_PROFILE","AWS_REGION","AWS_DEFAULT_REGION","AWS_PAGER","AWS_MAX_ATTEMPTS","TF_DATA_DIR")) { $outerEnvironment[$name]=@{present=(Test-Path "Env:$name");value=[Environment]::GetEnvironmentVariable($name,"Process")} }
try {
  Initialize-RetirementDirectory
  $file=Join-Path $operatorRoot "generated.json"
  Write-RetirementJson $file $result
  Assert-Test ((Assert-RetirementRegularPath $file) -ceq $file) "Native FileInfo accepted under strict mode"
  Assert-Test ((Assert-RetirementRegularPath $operatorRoot -Directory) -ceq $operatorRoot) "Native DirectoryInfo accepted"
  Assert-Test ((Read-RetirementJson $file (Get-FileSha256 $file) $operatorRoot).manifestSha256 -ceq $manifest) "Hash-bound generated file read"
  Assert-Rejected {Write-RetirementJson $file $retired} "Exclusive initial context cannot overwrite"
  Write-RetirementJson $file $retired -Replace
  Assert-Test ((Read-RetirementJson $file (Get-FileSha256 $file) $operatorRoot).action -ceq "retire") "Exact context update preserves parseable bytes"
  $completionContext=Copy-Json $context; $completionContext.phase="running"; $completionContext.result=$null; $completionContext.temporaryRevisionDeregistered=$false
  $completionPath=Join-Path $operatorRoot "completion.json"
  Write-RetirementJson $completionPath $completionContext
  $script:logReads=0
  Complete-RetirementTask $completionContext $completionPath $runtime $receipt
  $completed=Read-RetirementJson $completionPath (Get-FileSha256 $completionPath) $operatorRoot
  Assert-Test ($completed.phase -ceq "stopped" -and $completed.temporaryRevisionDeregistered -and $completed.result.manifestSha256 -ceq $manifest) "Real task completion functions persist result and cleanup with generated AWS responses"
  $script:awsMock={param($Arguments,$Operation) return Copy-Json @{accepted=$true}}
  $beforeCalls=$script:awsCalls.Count
  $request=New-RetirementTaskRequest $runtime $temporaryArn "inspect" $runId ""
  $null=Invoke-RetirementJsonRequest "run-task" $request $runId
  Assert-Rejected {Invoke-RetirementJsonRequest "run-task" $request $runId} "Persisted submission request cannot be replayed"
  Assert-Test ($script:awsCalls.Count -eq $beforeCalls+1) "Exactly one generated submission transport call"
  $script:awsMock=$originalAwsMock
  Assert-Rejected {Read-RetirementJson $file ("0"*64) $operatorRoot} "Changed reviewed bytes refuse"
  Assert-Rejected {Resolve-PathBelowRoot "../outside.json" $operatorRoot} "Evidence path traversal refuses"
  $currentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl=Get-Acl -LiteralPath $operatorRoot
  Assert-Test ($acl.AreAccessRulesProtected -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $currentSid) "Generated evidence directory private owner"
  $savedEnvironment=@{}; $environmentNames=@($outerEnvironment.Keys)
  foreach ($name in $environmentNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue; $savedEnvironment[$name]=@{present=$false;value=$null} }
  $savedEnvironment.AWS_PROFILE=@{present=$true;value="generated-parent-profile"}
  $savedEnvironment.AWS_PAGER=@{present=$true;value=""}
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name,"generated-child-value","Process") }
  $final=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})[-1].Finally
  & ([scriptblock]::Create($final.Extent.Text.Trim().Substring(1,$final.Extent.Text.Trim().Length-2)))
  Assert-Test ($env:AWS_PROFILE -ceq "generated-parent-profile") "Exact finally restores present environment"
  foreach ($name in @("AWS_REGION","AWS_DEFAULT_REGION","AWS_MAX_ATTEMPTS","TF_DATA_DIR")) { Assert-Test (-not (Test-Path "Env:$name")) "Exact finally restores absent $name" }
  Assert-Test ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable("AWS_PAGER","Process"))) "Exact finally restores empty value"
} finally {
  foreach ($name in $outerEnvironment.Keys) {
    if ($outerEnvironment[$name].present) { [Environment]::SetEnvironmentVariable($name,$outerEnvironment[$name].value,"Process") }
    else { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  }
  $resolved=[IO.Path]::GetFullPath($fixtureRoot)
  $allowed=[IO.Path]::GetFullPath((Join-Path $repositoryRoot ".tmp"))+[IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -cnotmatch '^retirement-tests-[a-f0-9]{32}$') { throw "Generated cleanup target escaped its exact scope." }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
$completion=@($definitions | Where-Object Name -ceq "Complete-RetirementTask")[0].Body.Extent.Text
$recovery=@($definitions | Where-Object Name -ceq "Find-RetirementSubmittedTask")[0].Body.Extent.Text
foreach ($body in @($completion,$recovery)) { Assert-Test (-not $body.Contains('"run-task"') -and -not $body.Contains('"register-task-definition"')) "Recovery cannot resubmit" }
Assert-Test ($source.Contains('$env:AWS_MAX_ATTEMPTS="1"')) "Single-attempt AWS mutation transport"
$inputCall=@($ast.EndBlock.Statements | Where-Object { $_.Extent.Text -ceq "Assert-RetirementInputs" })
Assert-Test ($inputCall.Count -eq 1 -and $inputCall[0].Extent.StartOffset -lt $source.LastIndexOf('$caller = Invoke-AwsJson')) "Input validation precedes external calls"
$stages=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$script:failureStage'},$true) | ForEach-Object { $_.Right.Extent.Text.Trim('"') } | Sort-Object -Unique)
Assert-Test (($stages -join "|") -ceq (@("cleanup","image","inspect-binding","postcheck","register","runtime","source","state","submit","task-result") -join "|")) "Failure diagnostics contain only fixed stages"
[pscustomobject]@{Outcome="passed";Assertions=$script:assertions;CloudCalls=0;DatabaseCalls=0;GeneratedFixtureRemoved=$true}
