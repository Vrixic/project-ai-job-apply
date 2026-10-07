Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../lib/development-d2-runtime-release.ps1')
$passed = 0
function Assert-True { param([bool]$Value,[string]$Message); if (-not $Value) { throw $Message }; $script:passed++ }
function Assert-Rejected {
  param([scriptblock]$Operation,[string]$Message)
  $rejected = $false
  try { $null = & $Operation } catch { $rejected = $true }
  Assert-True $rejected $Message
}
$account = '111122223333'; $sourceSha = 'a' * 40; $bucket = 'synthetic-private-artifacts'
$digest = 'b' * 64
$base64 = [Convert]::ToBase64String([byte[]](1..32))
$newDigest = [BitConverter]::ToString([Convert]::FromBase64String($base64)).Replace('-','').ToLowerInvariant()
$artifact = [pscustomobject]@{ schemaVersion = 1; kind = 'development-d2-community-artifact-publication'
  phase = 'published'; sourceSha = $sourceSha; artifactBucket = $bucket; artifactSha256 = $newDigest
  artifactBase64Sha256 = $base64; versionId = 'synthetic-version'; key = "lambda/d2-community/$sourceSha/$newDigest/d2-community-runtime-lambda.zip" }
$variables = [pscustomobject]@{
  deploy_applications = [pscustomobject]@{ value = 'true' }
  serverless_runtime_enabled = [pscustomobject]@{ value = 'true' }
  deploy_gateway_lambda = [pscustomobject]@{ value = 'true' }
  candidate_deletion_restore_role_enabled = [pscustomobject]@{ value = $false }
  migration_image = [pscustomobject]@{ value = 'old-image' }
  gateway_lambda_artifact_s3_key = [pscustomobject]@{ value = 'old-gateway-key' }
  gateway_lambda_artifact_s3_object_version = [pscustomobject]@{ value = 'old-gateway-version' }
  gateway_lambda_artifact_sha256 = [pscustomobject]@{ value = $digest }
  gateway_lambda_artifact_base64sha256 = [pscustomobject]@{ value = $base64 }
  d2_community_runtime = [pscustomobject]@{ value = [pscustomobject]@{
      deploy = $true; enabled = $true; artifact_s3_key = 'old-worker-key'; artifact_s3_object_version = 'old-worker-version'
      artifact_sha256 = $digest; artifact_base64sha256 = $base64; scheduled_reserved_concurrency = 1
      signal_reserved_concurrency = 2; provider = 'greenhouse'; approval_sha256 = ('c' * 64)
    } }
}
Assert-D2RuntimeArtifact $artifact $sourceSha $bucket
$passed++
$frozen = Get-D2RuntimeDigest $variables
$paused = New-D2RuntimeReleaseVariables $variables Pause $null
$upgraded = New-D2RuntimeReleaseVariables $paused Workers $artifact
$resumed = New-D2RuntimeReleaseVariables $upgraded Resume $null
Assert-True ((Get-D2RuntimeDigest $variables) -ceq $frozen) 'Input mutated during transition.'
Assert-True (-not (Get-D2RuntimeMaintenance $variables.d2_community_runtime.value)) 'Historical absent mode was not false.'
Assert-True (Get-D2RuntimeMaintenance $paused.d2_community_runtime.value) 'Pause did not set true.'
Assert-True (Get-D2RuntimeMaintenance $upgraded.d2_community_runtime.value) 'Workers resumed processing.'
Assert-True (-not (Get-D2RuntimeMaintenance $resumed.d2_community_runtime.value)) 'Resume did not restore configured operation.'
Assert-True ((Get-D2RuntimeAuthorityDigest $variables) -ceq (Get-D2RuntimeAuthorityDigest $resumed)) 'Compatible upgrades changed authority digest.'
$serializedRuntime = Copy-D2RuntimeValue $variables
$serializedRuntime.d2_community_runtime.value = $variables.d2_community_runtime.value | ConvertTo-Json -Depth 20 -Compress
Assert-D2RuntimeVariablesEqual $serializedRuntime $variables; $passed++
Assert-True ((Get-D2RuntimeAuthorityDigest $serializedRuntime) -ceq (Get-D2RuntimeAuthorityDigest $variables)) 'Known raw D2 JSON changed authority semantics.'
Assert-D2RuntimeVariablesEqual (New-D2RuntimeReleaseVariables $serializedRuntime Pause $null) $paused; $passed++
foreach ($malformed in @('not-json','[]','null','42')) {
  $bad = Copy-D2RuntimeValue $variables; $bad.d2_community_runtime.value = $malformed
  Assert-Rejected { Get-D2RuntimeConfiguration $bad } 'Nonobject raw D2 JSON accepted.'
}
foreach ($bad in @($null,0,1,'False','true ',[pscustomobject]@{},@($false))) {
  Assert-Rejected { Get-D2RuntimeBoolean $bad } 'Noncanonical boolean accepted.'
}
foreach ($value in @($true,$false,'true','false')) { $null = Get-D2RuntimeBoolean $value; $passed++ }
Assert-Rejected { New-D2RuntimeReleaseVariables $paused Pause $null } 'Double pause accepted.'
Assert-Rejected { New-D2RuntimeReleaseVariables $variables Workers $artifact } 'Workers upgraded outside maintenance.'
Assert-Rejected { New-D2RuntimeReleaseVariables $variables Resume $null } 'Resume accepted active baseline.'
$rootBoolean = Copy-D2RuntimeValue $variables
$rootBoolean.candidate_deletion_restore_role_enabled.value = 'false'
Assert-D2RuntimeVariablesEqual $rootBoolean $variables; $passed++
$rootBoolean.candidate_deletion_restore_role_enabled.value = 'False'
Assert-Rejected { Assert-D2RuntimeVariablesEqual $rootBoolean $variables } 'Noncanonical raw root flag accepted.'
$otherBoolean = Copy-D2RuntimeValue $variables
$otherBoolean.deploy_applications.value = $true
Assert-Rejected { Assert-D2RuntimeVariablesEqual $otherBoolean $variables } 'Unrelated raw input representation normalized.'
foreach ($mutate in @(
    { param($x) $x.sourceSha = 'c' * 40 }, { param($x) $x.artifactBucket = 'other-bucket' },
    { param($x) $x.artifactSha256 = 'd' * 64 }, { param($x) $x.key += '/extra' },
    { param($x) $x.versionId = 'null' }, { param($x) $x.versionId = '*' },
    { param($x) $x.phase = 'built' }, { param($x) $x | Add-Member extra $true }
  )) {
  $bad = Copy-D2RuntimeValue $artifact; & $mutate $bad
  Assert-Rejected { Assert-D2RuntimeArtifact $bad $sourceSha $bucket } 'Tampered artifact receipt accepted.'
}
function New-FunctionFixture {
  param([string]$Kind,[bool]$Maintenance,[object]$Variables)
  $runtime = $Variables.d2_community_runtime.value
  $gateway = $Kind -ceq 'gateway'
  $envValue = [pscustomobject]@{ RELEASE_SHA = $runtime.artifact_sha256; PRESERVED_AUTHORITY = 'exact' }
  if ($gateway) {
    $envValue | Add-Member D2_CONTRIBUTION_ROUTES_ENABLED (-not $Maintenance).ToString().ToLowerInvariant()
    $envValue | Add-Member D2_TRUST_REVIEWER_ROUTES_ENABLED (-not $Maintenance).ToString().ToLowerInvariant()
    $envValue | Add-Member D2_PRIVATE_CAPTURE_ROUTES_ENABLED 'true'
  } else { $envValue | Add-Member D2_COMMUNITY_RUNTIME_ENABLED (-not $Maintenance).ToString().ToLowerInvariant() }
  $concurrency = if ($gateway) { 5 } elseif ($Maintenance) { 0 } elseif ($Kind -ceq 'd2_community_scheduled') { 1 } else { 2 }
  return [pscustomobject]@{
    function_name = "synthetic-$Kind"; s3_bucket = $bucket; s3_key = $runtime.artifact_s3_key
    s3_object_version = $runtime.artifact_s3_object_version; source_code_hash = $runtime.artifact_base64sha256
    environment = @([pscustomobject]@{ variables = $envValue }); reserved_concurrent_executions = $concurrency
    runtime = 'nodejs24.x'; handler = 'index.handler'; role = "arn:aws:iam::$account`:role/synthetic"
    timeout = 180; memory_size = 512; architectures = @('arm64'); version = '17'
    vpc_config = @([pscustomobject]@{ subnet_ids = @('subnet-a','subnet-b'); security_group_ids = @('sg-exact') })
    last_modified = 'old'; qualified_arn = 'old'; qualified_invoke_arn = 'old'; code_sha256 = 'old'
  }
}
function New-PlanFixture {
  param([object]$InputVariables,[string]$Transition)
  $next = New-D2RuntimeReleaseVariables $InputVariables $Transition $artifact
  $baseline = [pscustomobject]@{ variables = $InputVariables }
  $changes = [Collections.Generic.List[object]]::new()
  $kinds = @('d2_community_scheduled','d2_trust_signal')
  if ($Transition -cne 'Workers') { $kinds += 'gateway' }
  foreach ($kind in $kinds) {
    $before = New-FunctionFixture $kind (Get-D2RuntimeMaintenance $InputVariables.d2_community_runtime.value) $InputVariables
    $after = Copy-D2RuntimeValue $before
    if ($Transition -ceq 'Workers') {
      $after.s3_key = $artifact.key; $after.s3_object_version = $artifact.versionId
      $after.source_code_hash = $artifact.artifactBase64Sha256; $after.environment[0].variables.RELEASE_SHA = $artifact.artifactSha256
    } else {
      $gate = ($Transition -ceq 'Resume').ToString().ToLowerInvariant()
      if ($kind -ceq 'gateway') {
        $after.environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED = $gate
        $after.environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED = $gate
      } else {
        $after.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED = $gate
        $after.reserved_concurrent_executions = if ($Transition -ceq 'Pause') { 0 } elseif ($kind -ceq 'd2_community_scheduled') { 1 } else { 2 }
      }
    }
    $unknown = [pscustomobject]@{ version = $true; qualified_arn = $true; qualified_invoke_arn = $true }
    foreach ($field in @('version','qualified_arn','qualified_invoke_arn')) { $after.PSObject.Properties.Remove($field) }
    if ($Transition -ceq 'Workers') { $after.PSObject.Properties.Remove('last_modified'); $unknown | Add-Member last_modified $true }
    $changes.Add([pscustomobject]@{ address = "module.platform.aws_lambda_function.$kind[0]"; type = 'aws_lambda_function'; mode = 'managed'
      change = [pscustomobject]@{ actions = @('update'); before = $before; after = $after; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
        after_unknown = $unknown } })
    $changes.Add([pscustomobject]@{ address = "module.platform.aws_lambda_alias.$kind[0]"; type = 'aws_lambda_alias'; mode = 'managed'
      change = [pscustomobject]@{ actions = @('update'); before = [pscustomobject]@{ name = 'development'; function_name = $before.function_name; function_version = '17' }
        after = [pscustomobject]@{ name = 'development'; function_name = $before.function_name }; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{}
        after_unknown = [pscustomobject]@{ function_version = $true } } })
  }
  if ($Transition -cne 'Workers') {
    $active = $Transition -ceq 'Resume'
    $changes.Add([pscustomobject]@{ address = 'module.platform.aws_cloudwatch_event_rule.d2_community_schedule[0]'; type = 'aws_cloudwatch_event_rule'; mode = 'managed'
      change = [pscustomobject]@{ actions = @('update'); before = [pscustomobject]@{ state = $(if ($active) { 'DISABLED' } else { 'ENABLED' }); schedule_expression = 'rate(1 minute)' }
        after = [pscustomobject]@{ state = $(if ($active) { 'ENABLED' } else { 'DISABLED' }); schedule_expression = 'rate(1 minute)' }
        after_unknown = [pscustomobject]@{}; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} } })
    $changes.Add([pscustomobject]@{ address = 'module.platform.aws_lambda_event_source_mapping.d2_trust_signal[0]'; type = 'aws_lambda_event_source_mapping'; mode = 'managed'
      change = [pscustomobject]@{ actions = @('update'); before = [pscustomobject]@{ enabled = (-not $active); scaling_config = @([pscustomobject]@{ maximum_concurrency = 2 }) }
        after = [pscustomobject]@{ enabled = $active; scaling_config = @([pscustomobject]@{ maximum_concurrency = 2 }) }
        after_unknown = [pscustomobject]@{}; before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} } })
  }
  return [pscustomobject]@{ Baseline = $baseline; Plan = [pscustomobject]@{ terraform_version = '1.16.2'; complete = $true; errored = $false; applyable = $true
      variables = $next; resource_changes = $changes.ToArray(); output_changes = [pscustomobject]@{}; resource_drift = @() } }
}
foreach ($case in @(@($variables,'Pause',8),@($paused,'Workers',4),@($upgraded,'Resume',8))) {
  $fixture = New-PlanFixture $case[0] $case[1]
  $accepted = @(Assert-D2RuntimeReleasePlan $fixture.Plan $fixture.Baseline $case[1] $artifact)
  Assert-True ($accepted.Count -eq $case[2]) 'Exact transition plan failed.'
}
$good = New-PlanFixture $variables Pause
foreach ($mutate in @(
    { param($x) $x.terraform_version = '1.9.8' }, { param($x) $x.complete = 'true' },
    { param($x) $x.errored = $true }, { param($x) $x.applyable = $false },
    { param($x) $x.variables.d2_community_runtime.value.provider = 'ashby' },
    { param($x) $x.variables.d2_community_runtime.value.approval_sha256 = 'd' * 64 },
    { param($x) $x.variables.PSObject.Properties.Remove('migration_image') },
    { param($x) $x.resource_changes = @($x.resource_changes | Select-Object -Skip 1) },
    { param($x) $x.resource_changes += $x.resource_changes[0] },
    { param($x) $x.resource_changes[0].change.actions = @('delete','create') },
    { param($x) $x.resource_changes[0].change.after.timeout = 900 },
    { param($x) $x.resource_changes[0].change.after.role = 'other' },
    { param($x) $x.resource_changes[0].change.after.s3_key = 'other' },
    { param($x) $x.resource_changes[0].change.after.environment[0].variables.PRESERVED_AUTHORITY = 'other' },
    { param($x) $x.resource_changes[0].change.after_unknown | Add-Member role $true },
    { param($x) $x.resource_changes[0].change.after_unknown | Add-Member last_modified $true },
    { param($x) $x.resource_changes[0].change.after_sensitive | Add-Member role $true },
    { param($x) $x.resource_changes[0].change | Add-Member replace_paths @(@('role')) },
    { param($x) $x.resource_changes[1].change.after.name = 'production' },
    { param($x) $x.resource_changes[1].change.after | Add-Member routing_config @([pscustomobject]@{ weight = 0.1 }) },
    { param($x) $x.resource_changes[4].change.after.environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED = 'false' },
    { param($x) $x.resource_changes[6].change.after.schedule_expression = 'rate(2 minutes)' },
    { param($x) $x.resource_changes[7].change.after.scaling_config[0].maximum_concurrency = 0 },
    { param($x) $x.resource_changes[7].change.after.enabled = 'false' },
    { param($x) $x.output_changes | Add-Member new ([pscustomobject]@{ actions = @('update') }) }
  )) {
  $bad = Copy-D2RuntimeValue $good.Plan; & $mutate $bad
  Assert-Rejected { Assert-D2RuntimeReleasePlan $bad $good.Baseline Pause $artifact } 'Nonapproved plan delta accepted.'
}
$workerPlan = New-PlanFixture $paused Workers
$workerPlan.Plan.resource_changes[0].change.after.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED = 'true'
Assert-Rejected { Assert-D2RuntimeReleasePlan $workerPlan.Plan $workerPlan.Baseline Workers $artifact } 'Worker upgrade activated processing.'

$now = [datetime]::SpecifyKind([datetime]'2026-09-09T00:00:00',[DateTimeKind]::Utc)
$binding = [pscustomobject]@{ accountId = $account; stateBucket = 'synthetic-state'; stateLineage = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  stateSerial = 292; sourceSha = $sourceSha; planSha256 = ('d' * 64); authoritySha256 = Get-D2RuntimeAuthorityDigest $paused }
$snapshot = [pscustomobject]@{ paused = $true; asyncMaximumAgeSeconds = 21600; oldMaximumTimeoutSeconds = 180; controlSha256 = ('e' * 64) }
$pause = Copy-D2RuntimeValue (New-D2RuntimePauseReceipt $snapshot $binding $now)
Assert-D2RuntimePauseReceipt $pause $binding $now; $passed++
Assert-Rejected { Assert-D2RuntimePauseReceipt $pause $binding $now.AddSeconds(21839) -RequireElapsed } 'Drain resumed one second early.'
Assert-D2RuntimePauseReceipt $pause $binding $now.AddSeconds(21840) -RequireElapsed; $passed++
foreach ($mutate in @(
    { param($x) $x.accountId = '999988887777' }, { param($x) $x.region = 'us-east-1' },
    { param($x) $x.stateBucket = 'other' }, { param($x) $x.stateLineage = 'other' },
    { param($x) $x.stateSerial = 999 }, { param($x) $x.stateSerial = '292' },
    { param($x) $x.authoritySha256 = 'b' * 64 }, { param($x) $x.sourceSha = 'bad' },
    { param($x) $x.pausePlanSha256 = 'bad' }, { param($x) $x.controlSha256 = 'bad' },
    { param($x) $x.asyncMaximumAgeSeconds = 60 }, { param($x) $x.asyncMaximumAgeSeconds = '21600' },
    { param($x) $x.oldMaximumTimeoutSeconds = 901 }, { param($x) $x.settlingSeconds = 0 },
    { param($x) $x.earliestResumeAt = $now.AddHours(6).ToString('o') },
    { param($x) $x.cutoffAt = $now.AddHours(7).ToString('o') },
    { param($x) $x.cutoffAt += ' ' }, { param($x) $x | Add-Member queueEmptyProven $true }
  )) {
  $bad = Copy-D2RuntimeValue $pause; & $mutate $bad
  Assert-Rejected { Assert-D2RuntimePauseReceipt $bad $binding $now.AddHours(8) -RequireElapsed } 'Invalid retirement proof accepted.'
}
$changedAuthority = Copy-D2RuntimeValue $binding
$changedAuthority.authoritySha256 = 'c' * 64
Assert-Rejected { Assert-D2RuntimePauseReceipt $pause $changedAuthority $now.AddHours(8) -RequireElapsed } 'Old cutoff survived changed authority.'
$expected = New-FunctionFixture d2_community_scheduled $true $paused
$arn = "arn:aws:lambda:us-east-2:$account`:function:$($expected.function_name)"
$alias = [pscustomobject]@{ Name = 'development'; AliasArn = "$arn`:development"; FunctionVersion = '17' }
$config = [pscustomobject]@{ FunctionArn = "$arn`:17"; Version = '17'; State = 'Active'; CodeSha256 = $expected.source_code_hash
  Role = $expected.role; Handler = $expected.handler; Runtime = $expected.runtime; Timeout = 180; MemorySize = 512
  Environment = [pscustomobject]@{ Variables = $expected.environment[0].variables }; Architectures = @('arm64')
  VpcConfig = [pscustomobject]@{ SubnetIds = @('subnet-b','subnet-a'); SecurityGroupIds = @('sg-exact') } }
$concurrency = [pscustomobject]@{ ReservedConcurrentExecutions = 0 }
$expectedAlias = [pscustomobject]@{ function_version = '17' }
Assert-D2RuntimeLiveFunction $config $alias $concurrency $expected $expectedAlias $account; $passed++
foreach ($mutate in @(
    { param($x) $x.Version = '18' }, { param($x) $x.State = 'Pending' }, { param($x) $x.FunctionArn += ':other' },
    { param($x) $x.CodeSha256 = 'other' }, { param($x) $x.Environment.Variables.D2_COMMUNITY_RUNTIME_ENABLED = 'true' },
    { param($x) $x.Runtime = 'nodejs22.x' }, { param($x) $x.Timeout = 900 },
    { param($x) $x.VpcConfig.SubnetIds += 'subnet-public' }, { param($x) $x | Add-Member LastUpdateStatus 'InProgress' }
  )) {
  $bad = Copy-D2RuntimeValue $config; & $mutate $bad
  Assert-Rejected { Assert-D2RuntimeLiveFunction $bad $alias $concurrency $expected $expectedAlias $account } 'Wrong live configuration accepted.'
}
$weighted = Copy-D2RuntimeValue $alias
$weighted | Add-Member RoutingConfig ([pscustomobject]@{ AdditionalVersionWeights = [pscustomobject]@{ '18' = 0.01 } })
Assert-Rejected { Assert-D2RuntimeLiveFunction $config $weighted $concurrency $expected $expectedAlias $account } 'Weighted alias accepted.'
Assert-Rejected { Assert-D2RuntimeLiveFunction $config $alias ([pscustomobject]@{ ReservedConcurrentExecutions = 1 }) $expected $expectedAlias $account } 'Missing worker concurrency fence accepted.'
$ruleArn = "arn:aws:events:us-east-2:$account`:rule/synthetic"
$policy = [pscustomobject]@{ Version = '2012-10-17'; Statement = @([pscustomobject]@{
    Sid = 'AllowExactD2CommunitySchedule'; Effect = 'Allow'; Principal = [pscustomobject]@{ Service = 'events.amazonaws.com' }
    Action = 'lambda:InvokeFunction'; Resource = $alias.AliasArn; Condition = [pscustomobject]@{ ArnLike = [pscustomobject]@{ 'AWS:SourceArn' = $ruleArn } }
  }) }
Assert-D2RuntimeSchedulePermission $policy $alias.AliasArn $ruleArn; $passed++
foreach ($mutate in @({ param($x) $x.Statement[0].Resource = "$arn`:17" },
    { param($x) $x.Statement[0].Condition.ArnLike.'AWS:SourceArn' = '*' },
    { param($x) $x.Statement += $x.Statement[0] }, { param($x) $x.Statement[0].Principal.Service = 'sns.amazonaws.com' })) {
  $bad = Copy-D2RuntimeValue $policy; & $mutate $bad
  Assert-Rejected { Assert-D2RuntimeSchedulePermission $bad $alias.AliasArn $ruleArn } 'Unreviewed async ingress accepted.'
}

# Execute actual operator function ASTs against injected response ports; never its main block.
$operatorPath = Join-Path $PSScriptRoot '../operate-development-d2-runtime-release.ps1'
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath,[ref]$tokens,[ref]$errors)
Assert-True (@($errors).Count -eq 0) 'Operator has parse errors.'
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($function.Extent.Text))
}
$script:awsResponse = '{}'; $script:awsExit = 0; $script:awsCalls = 0
function aws.exe { $script:awsCalls++; $global:LASTEXITCODE = $script:awsExit; return $script:awsResponse }
foreach ($operation in @(@('lambda','delete-function'),@('lambda','update-alias'),@('sqs','purge-queue'),@('ecs','run-task'),@('s3api','put-object'))) {
  Assert-Rejected { Invoke-D2ReleaseAws $operation } 'AWS write escaped readonly port.'
}
Assert-True ($script:awsCalls -eq 0) 'Rejected write reached native port.'
$script:awsResponse = '{"NextToken":"more"}'
Assert-Rejected { Invoke-D2ReleaseAws @('lambda','list-aliases') } 'Incomplete API pagination accepted.'
$script:awsResponse = '{"NextMarker":"more"}'
Assert-Rejected { Invoke-D2ReleaseAws @('lambda','list-aliases') } 'Native AWS marker ignored.'
$script:awsResponse = 'not JSON'
Assert-Rejected { Invoke-D2ReleaseAws @('sts','get-caller-identity') } 'Malformed AWS JSON accepted.'
$script:awsResponse = '{"createdAt":"2026-09-09T06:00:00.0000000Z"}'
$dateResponse = Invoke-D2ReleaseAws @('ecs','describe-tasks')
Assert-True ($dateResponse.createdAt -is [string] -and $dateResponse.createdAt -ceq '2026-09-09T06:00:00.0000000Z') 'AWS date bytes normalized across hosts.'
$script:awsResponse = '(ResourceNotFoundException)'; $script:awsExit = 1
Assert-True ($null -eq (Invoke-D2ReleaseAws @('lambda','get-policy') -AllowNotFound)) 'Explicit absent resource was not represented.'
$script:awsResponse = '(AccessDeniedException)'
Assert-Rejected { Invoke-D2ReleaseAws @('lambda','get-policy') -AllowNotFound } 'Access denial mistaken for no ingress.'
Remove-Item Function:aws.exe
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$head = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$rootVariablesSource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'infrastructure/terraform/environments/development/variables.tf') -Raw
$declaredRootNames = @([regex]::Matches($rootVariablesSource,'(?m)^variable "([a-z_]+)"') | ForEach-Object { $_.Groups[1].Value })
Assert-True ($declaredRootNames -ccontains 'deploy_applications' -and $declaredRootNames -ccontains 'serverless_runtime_enabled' -and
  $declaredRootNames -ccontains 'deploy_gateway_lambda' -and $declaredRootNames -cnotcontains 'runtime_activation_allowed') 'Fixtures drifted from actual root authority variable shape.'
$messages = @(Get-D2RuntimeMigrationMessages $repositoryRoot $head)
Assert-True ($messages.Count -eq 7 -and $messages[1] -ceq 'Jobs migrations through 0027_candidate_report_export_status applied and verified.' -and
  $messages[5] -cin @('Trust migrations through 0004_accepted_independent_evidence applied and verified.','Trust migrations through 0005_development_test_removal applied and verified.')) 'Actual source is not a supported exact migration boundary.'
$inventory = [ordered]@{}
foreach ($owner in @('profile','jobs','documents','matching','billing','trust')) {
  $source = @(& git -C $repositoryRoot show "$head`:backend/services/$owner/src/migrate.ts") -join "`n"
  $list = [regex]::Match($source,'(?s)const migrationVersions = \[(.*?)\] as const;').Groups[1].Value
  $inventory[$owner] = @([regex]::Matches($list,'"([0-9]{4}_[a-z][a-z0-9_]{0,99})"') | ForEach-Object { $_.Groups[1].Value })
}
Assert-D2RuntimeMigrationInventory $inventory; $passed++
$modern51 = [ordered]@{}
foreach ($owner in $inventory.Keys) { $modern51[$owner] = @($inventory[$owner]) }
$modern51.documents = @($inventory.documents | Where-Object { $_ -cnotin @('0007_cover_letter_work_authorizations', '0008_cover_letter_provider_responses', '0009_cover_letter_provider_failure', '0010_temporary_material_completion', '0011_native_material_allocations', '0012_native_material_launch_claim', '0013_native_material_ready', '0014_native_resume_generations', '0015_native_resume_observation') })
Assert-D2RuntimeMigrationInventory $modern51; $passed++
$modern52 = [ordered]@{}
foreach ($owner in $modern51.Keys) { $modern52[$owner] = @($modern51[$owner]) }
$modern52.documents += '0007_cover_letter_work_authorizations'
Assert-D2RuntimeMigrationInventory $modern52; $passed++
$modern53 = [ordered]@{}
foreach ($owner in $modern52.Keys) { $modern53[$owner] = @($modern52[$owner]) }
$modern53.documents += '0008_cover_letter_provider_responses'
Assert-D2RuntimeMigrationInventory $modern53; $passed++
$modern54 = [ordered]@{}
foreach ($owner in $modern53.Keys) { $modern54[$owner] = @($modern53[$owner]) }
$modern54.documents += '0009_cover_letter_provider_failure'
Assert-D2RuntimeMigrationInventory $modern54; $passed++
$modern55 = [ordered]@{}
foreach ($owner in $modern54.Keys) { $modern55[$owner] = @($modern54[$owner]) }
$modern55.documents += '0010_temporary_material_completion'
Assert-D2RuntimeMigrationInventory $modern55; $passed++
$modern56 = [ordered]@{}
foreach ($owner in $modern55.Keys) { $modern56[$owner] = @($modern55[$owner]) }
$modern56.documents += '0011_native_material_allocations'
Assert-D2RuntimeMigrationInventory $modern56; $passed++
$modern57 = [ordered]@{}
foreach ($owner in $modern56.Keys) { $modern57[$owner] = @($modern56[$owner]) }
$modern57.documents += '0012_native_material_launch_claim'
Assert-D2RuntimeMigrationInventory $modern57; $passed++
$modern58 = [ordered]@{}
foreach ($owner in $modern57.Keys) { $modern58[$owner] = @($modern57[$owner]) }
$modern58.documents += '0013_native_material_ready'
Assert-D2RuntimeMigrationInventory $modern58; $passed++
$modern59 = [ordered]@{}
foreach ($owner in $modern58.Keys) { $modern59[$owner] = @($modern58[$owner]) }
$modern59.documents += '0014_native_resume_generations'
Assert-D2RuntimeMigrationInventory $modern59; $passed++
$modern60 = [ordered]@{}
foreach ($owner in $modern59.Keys) { $modern60[$owner] = @($modern59[$owner]) }
$modern60.documents += '0015_native_resume_observation'
Assert-D2RuntimeMigrationInventory $modern60; $passed++
foreach ($mutation in @(
    { param($x) $x.documents[-1] = '0014_unknown_resume' },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0013_native_material_ready' }) },
    { param($x) $x.documents += '0014_native_resume_generations' },
    { param($x) $x.documents[-2] = '0014_native_resume_generations'; $x.documents[-1] = '0013_native_material_ready' }
  )) {
  $badResumeInventory = [ordered]@{}
  foreach ($owner in $modern59.Keys) { $badResumeInventory[$owner] = @($modern59[$owner]) }
  & $mutation $badResumeInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badResumeInventory } 'Native resume boundary must preserve exact names, order and completeness.'
}

foreach ($mutation in @(
    { param($x) $x.documents[-1] = '0013_unknown_ready' },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0012_native_material_launch_claim' }) },
    { param($x) $x.documents += '0013_native_material_ready' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern58.Keys) { $badInventory[$owner] = @($modern58[$owner]) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown, incomplete or duplicate native-ready inventory accepted.'
}
foreach ($mutation in @(
    { param($x) $x.documents[-1] = '0012_unknown_claim' },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0011_native_material_allocations' }) },
    { param($x) $x.documents += '0012_native_material_launch_claim' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern57.Keys) { $badInventory[$owner] = @($modern57[$owner]) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown, incomplete or duplicate native-launch inventory accepted.'
}

foreach ($mutation in @(
    { param($x) $x.documents[-1] = '0011_unknown_allocation' },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0010_temporary_material_completion' }) },
    { param($x) $x.documents += '0012_unknown_extension' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern56.Keys) { $badInventory[$owner] = @($modern56[$owner]) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed native-allocation inventory accepted.'
}

foreach ($mutation in @(
    { param($x) $x.documents[-1] = '0010_unknown_completion' },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0009_cover_letter_provider_failure' }) },
    { param($x) $x.documents += '0011_unknown_extension' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern55.Keys) { $badInventory[$owner] = @($modern55[$owner]) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed temporary-completion inventory accepted.'
}

foreach ($mutation in @(
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0008_cover_letter_provider_responses' }) },
    { param($x) $x.documents[-1] = '0009_unknown_failure' },
    { param($x) $x.documents += '0010_unknown_extension' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern54.Keys) { $badInventory[$owner] = @($modern54[$owner] | ForEach-Object { $_ }) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed failure-proof inventory accepted.'
}
$legacy49 = [ordered]@{}
foreach ($owner in $inventory.Keys) { $legacy49[$owner] = @($inventory[$owner]) }
$legacy49.profile = @($inventory.profile | Where-Object { $_ -cne '0011_active_candidate_lease' })
$legacy49.documents = @($inventory.documents | Where-Object { $_ -cnotin @('0006_cover_letters', '0007_cover_letter_work_authorizations', '0008_cover_letter_provider_responses', '0009_cover_letter_provider_failure', '0010_temporary_material_completion', '0011_native_material_allocations', '0012_native_material_launch_claim', '0013_native_material_ready', '0014_native_resume_generations', '0015_native_resume_observation') })
Assert-D2RuntimeMigrationInventory $legacy49; $passed++
$legacy48 = [ordered]@{}
foreach ($owner in $legacy49.Keys) { $legacy48[$owner] = @($legacy49[$owner]) }
$legacy48.trust = @($legacy49.trust | Where-Object { $_ -cne '0005_development_test_removal' })
Assert-D2RuntimeMigrationInventory $legacy48; $passed++
foreach ($mutation in @(
    { param($x) $x.profile = @($legacy49.profile) },
    { param($x) $x.documents = @($legacy49.documents) },
    { param($x) $x.trust = @($legacy48.trust) },
    { param($x) $x.jobs[0] = '0001_unknown_inventory' },
    { param($x) $x.documents += '0007_unknown_migration' },
    { param($x) $x.Remove('billing') },
    { param($x) $x['unknown'] = @('0001_unknown_owner') }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $inventory.Keys) { $badInventory[$owner] = @($inventory[$owner] | ForEach-Object { $_ }) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed migration inventory accepted.'
}
foreach ($mutation in @(
    { param($x) $x.profile = @($legacy49.profile) },
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0006_cover_letters' }) },
    { param($x) $x.documents[-1] = '0007_unknown_work_authorization' },
    { param($x) $x.documents += '0008_unknown_extension' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern52.Keys) { $badInventory[$owner] = @($modern52[$owner] | ForEach-Object { $_ }) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed work-authorization inventory accepted.'
}
foreach ($mutation in @(
    { param($x) $x.documents = @($x.documents | Where-Object { $_ -cne '0007_cover_letter_work_authorizations' }) },
    { param($x) $x.documents[-1] = '0008_unknown_response_inventory' },
    { param($x) $x.documents += '0009_unknown_extension' }
  )) {
  $badInventory = [ordered]@{}
  foreach ($owner in $modern53.Keys) { $badInventory[$owner] = @($modern53[$owner] | ForEach-Object { $_ }) }
  & $mutation $badInventory
  Assert-Rejected { Assert-D2RuntimeMigrationInventory $badInventory } 'Unknown or mixed response inventory accepted.'
}
# Full actual readback function, with a closed synthetic AWS port. No account, body, log or
# credential fixture is read from disk; all objects below are generated identifiers only.
$ExpectedAccountId = $account; $region = 'us-east-2'; $StateBucket = 'synthetic-state'; $SourceSha = $sourceSha
$liveVariables = Copy-D2RuntimeValue $paused
$liveRuntime = $liveVariables.d2_community_runtime.value
foreach ($pair in @(@('schedule_expression','rate(1 minute)'),@('trust_signal_batch_size',5),
    @('queue_visibility_timeout_seconds',240),@('queue_message_retention_seconds',345600))) {
  $liveRuntime | Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1]
}
$liveResources = New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
$script:liveFunctions = @{}
foreach ($kind in @('gateway','d2_community_scheduled','d2_trust_signal')) {
  $function = New-FunctionFixture $kind $true $liveVariables
  $suffix = $kind.Replace('_','-')
  $function.function_name = "ai-job-apply-development-$suffix"
  $functionArn = "arn:aws:lambda:us-east-2:$account`:function:$($function.function_name)"
  $liveResources.Add("module.platform.aws_lambda_function.$kind[0]", $function)
  $liveResources.Add("module.platform.aws_lambda_alias.$kind[0]", [pscustomobject]@{ function_version = '17' })
  $script:liveFunctions[$function.function_name] = [pscustomobject]@{ Kind = $kind; Function = $function
    Alias = [pscustomobject]@{ Name = 'development'; AliasArn = "$functionArn`:development"; FunctionVersion = '17' }
    Configuration = [pscustomobject]@{ FunctionArn = "$functionArn`:17"; Version = '17'; State = 'Active'; CodeSha256 = $function.source_code_hash
      Role = $function.role; Handler = $function.handler; Runtime = $function.runtime; Timeout = 180; MemorySize = 512
      Environment = [pscustomobject]@{ Variables = $function.environment[0].variables }; Architectures = @('arm64')
      VpcConfig = [pscustomobject]@{ SubnetIds = @('subnet-a','subnet-b'); SecurityGroupIds = @('sg-exact') } }
    Versions = @([pscustomobject]@{ Version = '$LATEST'; FunctionArn = $functionArn; Timeout = 180 },
      [pscustomobject]@{ Version = '17'; FunctionArn = "$functionArn`:17"; Timeout = 180 }) }
}
$script:liveRuleArn = "arn:aws:events:us-east-2:$account`:rule/ai-job-apply-development-d2-community-batch"
$queueArn = "arn:aws:sqs:us-east-2:$account`:ai-job-apply-development-d2-trust-signal"
$signalArn = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-d2-trust-signal:development"
$liveResources.Add('module.platform.aws_lambda_event_source_mapping.d2_trust_signal[0]',[pscustomobject]@{
    uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; function_name = $signalArn; event_source_arn = $queueArn })
$liveResources.Add('module.platform.aws_sqs_queue.d2_trust_signal[0]',[pscustomobject]@{
    arn = $queueArn; url = "https://sqs.us-east-2.amazonaws.com/$account/synthetic"; kms_master_key_id = 'synthetic-kms'
    redrive_policy = '{"deadLetterTargetArn":"synthetic-dlq","maxReceiveCount":5}' })
$liveState = [pscustomobject]@{ Resources = $liveResources; Lineage = $binding.stateLineage; Serial = 293 }
$script:liveMutation = $null
function Invoke-D2ReleaseAws {
  param([string[]]$Arguments,[switch]$AllowNotFound)
  $operation = ($Arguments | Select-Object -First 2) -join ' '
  $functionNameIndex = [array]::IndexOf($Arguments,'--function-name')
  $function = if ($functionNameIndex -ge 0) { $script:liveFunctions[$Arguments[$functionNameIndex + 1]] } else { $null }
  $qualifierIndex = [array]::IndexOf($Arguments,'--qualifier')
  $qualifier = if ($qualifierIndex -ge 0) { $Arguments[$qualifierIndex + 1] } else { '' }
  $result = switch ($operation) {
    'lambda get-alias' { $function.Alias }
    'lambda get-function-configuration' { $function.Configuration }
    'lambda get-function-concurrency' { [pscustomobject]@{ ReservedConcurrentExecutions = $function.Function.reserved_concurrent_executions } }
    'lambda list-aliases' { [pscustomobject]@{ Aliases = @($function.Alias) } }
    'lambda list-versions-by-function' { [pscustomobject]@{ Versions = $function.Versions } }
    'lambda list-function-event-invoke-configs' { [pscustomobject]@{ FunctionEventInvokeConfigs = @() } }
    'lambda list-function-url-configs' { [pscustomobject]@{ FunctionUrlConfigs = @() } }
    'lambda get-policy' {
      if ($function.Kind -ceq 'd2_community_scheduled' -and $qualifier -ceq 'development') {
        [pscustomobject]@{ Policy = ([pscustomobject]@{ Version = '2012-10-17'; Statement = @([pscustomobject]@{
              Sid = 'AllowExactD2CommunitySchedule'; Effect = 'Allow'; Principal = [pscustomobject]@{ Service = 'events.amazonaws.com' }
              Action = 'lambda:InvokeFunction'; Resource = $function.Alias.AliasArn
              Condition = [pscustomobject]@{ ArnLike = [pscustomobject]@{ 'AWS:SourceArn' = $script:liveRuleArn } } }) } | ConvertTo-Json -Depth 20) }
      } else { $null }
    }
    'events list-rule-names-by-target' {
      [pscustomobject]@{ RuleNames = @($(if ($Arguments[3] -clike '*d2-community-scheduled:development') { 'ai-job-apply-development-d2-community-batch' })) }
    }
    'lambda list-event-source-mappings' {
      # Match AWS's actual exact-qualifier behavior: unqualified lookups cannot see alias mappings.
      [pscustomobject]@{ EventSourceMappings = @($(if ($Arguments[3] -ceq $signalArn) { [pscustomobject]@{ UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } })) }
    }
    'events describe-rule' { [pscustomobject]@{ Arn = $script:liveRuleArn; State = 'DISABLED'; ScheduleExpression = 'rate(1 minute)' } }
    'events list-targets-by-rule' {
      [pscustomobject]@{ Targets = @([pscustomobject]@{ Id = 'd2-community-scheduled'
          Arn = "arn:aws:lambda:us-east-2:$account`:function:ai-job-apply-development-d2-community-scheduled:development"
          Input = ([pscustomobject]@{ schemaVersion = 1; action = 'run-d2-community-batch'; scheduleRuleArn = $script:liveRuleArn } | ConvertTo-Json) }) }
    }
    'lambda get-event-source-mapping' { [pscustomobject]@{ State = 'Disabled'; FunctionArn = $signalArn; EventSourceArn = $queueArn
        BatchSize = 5; MaximumBatchingWindowInSeconds = 0; ScalingConfig = [pscustomobject]@{ MaximumConcurrency = 2 }; FunctionResponseTypes = @('ReportBatchItemFailures') } }
    'sqs get-queue-attributes' { [pscustomobject]@{ Attributes = [pscustomobject]@{
          QueueArn = $queueArn; KmsMasterKeyId = 'synthetic-kms'; VisibilityTimeout = '240'; MessageRetentionPeriod = '345600'
          RedrivePolicy = '{"deadLetterTargetArn":"synthetic-dlq","maxReceiveCount":5}'; ApproximateNumberOfMessages = '3'; ApproximateNumberOfMessagesNotVisible = '1' } } }
    default { throw 'SyntheticUnexpectedAwsOperation' }
  }
  if ($null -ne $result) { $result = Copy-D2RuntimeValue $result }
  if ($null -ne $script:liveMutation) { $result = & $script:liveMutation $operation $result $Arguments }
  return $result
}
$readback = Get-D2ReleaseLiveSnapshot $liveState $liveVariables
Assert-True ($readback.paused -and -not $readback.queueEmptyProven -and $readback.pendingMessages -eq 3 -and
  $readback.inFlightMessages -eq 1 -and $readback.oldMaximumTimeoutSeconds -eq 180) 'Complete paused readback rejected or pending queue discarded.'
foreach ($mutation in @(
    { param($op,$x,$args) if ($op -ceq 'lambda get-alias') { $x.FunctionVersion = '18' }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda get-function-concurrency') { $x.ReservedConcurrentExecutions = 1 }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-aliases') { $x.Aliases += $x.Aliases[0] }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-versions-by-function') { $x.Versions[0].Timeout = 901 }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-versions-by-function') { $x.Versions[0] | Add-Member DeadLetterConfig ([pscustomobject]@{ TargetArn = 'unreviewed' }) }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-function-event-invoke-configs') { $x.FunctionEventInvokeConfigs = @([pscustomobject]@{ MaximumEventAgeInSeconds = 60 }) }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-function-url-configs') { $x.FunctionUrlConfigs = @([pscustomobject]@{ FunctionUrl = 'unreviewed' }) }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda list-event-source-mappings' -and $x.EventSourceMappings.Count -eq 0) { $x.EventSourceMappings = @([pscustomobject]@{ UUID = 'unexpected-version-mapping' }) }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda get-policy' -and $null -eq $x) { return [pscustomobject]@{ Policy = 'unreviewed numeric ingress' } }; return $x },
    { param($op,$x,$args) if ($op -ceq 'events list-rule-names-by-target' -and $x.RuleNames.Count -eq 0) { $x.RuleNames = @('other-rule') }; return $x },
    { param($op,$x,$args) if ($op -ceq 'events describe-rule') { $x.State = 'ENABLED' }; return $x },
    { param($op,$x,$args) if ($op -ceq 'events list-targets-by-rule') { $x.Targets[0].Arn = $x.Targets[0].Arn.Replace(':development',':17') }; return $x },
    { param($op,$x,$args) if ($op -ceq 'events list-targets-by-rule') { $x.Targets[0] | Add-Member RetryPolicy ([pscustomobject]@{ MaximumEventAgeInSeconds = 60 }) }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda get-event-source-mapping') { $x.State = 'Disabling' }; return $x },
    { param($op,$x,$args) if ($op -ceq 'lambda get-event-source-mapping') { $x.ScalingConfig.MaximumConcurrency = 0 }; return $x },
    { param($op,$x,$args) if ($op -ceq 'sqs get-queue-attributes') { $x.Attributes.KmsMasterKeyId = 'other' }; return $x }
  )) {
  $script:liveMutation = $mutation
  Assert-Rejected { Get-D2ReleaseLiveSnapshot $liveState $liveVariables } 'Incomplete/unreviewed live fencing accepted.'
}
$script:liveMutation = $null

$script:expectedMigrationMessages = $messages
function Get-D2RuntimeMigrationMessages { return $script:expectedMigrationMessages }
$migrationImage = "$account.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$digest"
$migrationVariables = Copy-D2RuntimeValue $liveVariables
$migrationVariables.migration_image.value = $migrationImage
$taskArn = "arn:aws:ecs:us-east-2:$account`:task/ai-job-apply-development/$('f' * 32)"
$clusterArn = "arn:aws:ecs:us-east-2:$account`:cluster/ai-job-apply-development"
$definitionArn = "arn:aws:ecs:us-east-2:$account`:task-definition/ai-job-apply-development-database-migration:9"
$taskContainer = [pscustomobject]@{ name = 'database-migration'; image = $migrationImage; essential = $true; readonlyRootFilesystem = $true
  command = @('runner/dist/src/main.js'); environment = @([pscustomobject]@{ name = 'NODE_ENV'; value = 'production' })
  secrets = @([pscustomobject]@{ name = 'DATABASE_URL'; valueFrom = 'arn:aws:secretsmanager:us-east-2:111122223333:secret:synthetic' })
  logConfiguration = [pscustomobject]@{ logDriver = 'awslogs'; options = [pscustomobject]@{
      'awslogs-region' = 'us-east-2'; 'awslogs-stream-prefix' = 'database-migration'; 'awslogs-group' = '/synthetic/application' } } }
$liveResources.Add('module.platform.aws_ecs_cluster.this',[pscustomobject]@{ arn = $clusterArn })
$liveResources.Add('module.platform.aws_ecs_task_definition.migration[0]',[pscustomobject]@{ arn = $definitionArn
    execution_role_arn = "arn:aws:iam::$account`:role/synthetic-execution"; task_role_arn = ''
    container_definitions = (ConvertTo-Json -InputObject @($taskContainer) -Depth 20) })
$liveResources.Add('module.platform.aws_cloudwatch_log_group.application',[pscustomobject]@{ name = '/synthetic/application' })
$script:taskResponse = [pscustomobject]@{ failures = @(); tasks = @([pscustomobject]@{
      taskArn = $taskArn; clusterArn = $clusterArn; taskDefinitionArn = $definitionArn; launchType = 'FARGATE'; lastStatus = 'STOPPED'
      overrides = [pscustomobject]@{ containerOverrides = @([pscustomobject]@{ name = 'database-migration' }) }
      createdAt = $now.AddHours(6).ToString('o'); stoppedAt = $now.AddHours(6).AddMinutes(2).ToString('o')
      containers = @([pscustomobject]@{ name = 'database-migration'; exitCode = 0; image = $migrationImage; imageDigest = "sha256:$digest" }) }) }
$script:definitionResponse = [pscustomobject]@{ taskDefinition = [pscustomobject]@{
    taskDefinitionArn = $definitionArn; networkMode = 'awsvpc'; executionRoleArn = "arn:aws:iam::$account`:role/synthetic-execution"
    status = 'ACTIVE'; family = 'ai-job-apply-development-database-migration'; cpu = '256'; memory = '512'; requiresCompatibilities = @('FARGATE')
    runtimePlatform = [pscustomobject]@{ cpuArchitecture = 'X86_64'; operatingSystemFamily = 'LINUX' }; containerDefinitions = @($taskContainer) } }
$migrationReceipt = [pscustomobject]@{ schemaVersion = 2; kind = 'development-document-migration-receipt'; environment = 'development'
  accountId = $account; stateBucket = $StateBucket; sourceSha = $SourceSha; operatorSourceSha = $SourceSha; migrationImage = $migrationImage
  taskPlanSha256 = $digest; taskPlanMetadataSha256 = $digest; executionPlanSha256 = $digest; executionClaimKey = 'synthetic-claim'
  executionClaimVersion = 'synthetic-version'; executionClaimChecksumSHA256 = $base64; taskArn = $taskArn; phase = 'verified'; exitCode = 0
  submittedAt = $now.AddHours(6).AddSeconds(5).ToString('o'); stoppedAt = $now.AddHours(6).AddMinutes(2).ToString('o') }
# Exercise the same JSON parser as Read-D2ReleaseEvidence: PS5.1 returns Int32 for zero,
# while PS7.5 returns Int64. A literal PowerShell receipt misses that compatibility boundary.
$migrationReceiptJson = $migrationReceipt | ConvertTo-Json -Depth 20 -Compress
Assert-True ([regex]::Matches($migrationReceiptJson, '"exitCode":0(?=[,}])').Count -eq 1) 'Synthetic receipt has an ambiguous exit-code field.'
$migrationReceipt = ConvertFrom-D2RuntimeJson $migrationReceiptJson
Assert-True (($migrationReceipt.exitCode -is [int] -or $migrationReceipt.exitCode -is [long]) -and
  $migrationReceipt.exitCode -eq 0) 'Successful JSON receipt did not retain an integral zero.'
$script:migrationMutation = $null
$script:migrationReadCalls = 0
function Invoke-D2ReleaseAws {
  param([string[]]$Arguments,[switch]$AllowNotFound)
  $script:migrationReadCalls++
  $operation = ($Arguments | Select-Object -First 2) -join ' '
  $result = switch ($operation) {
    'ecs describe-tasks' { $script:taskResponse }
    'ecs describe-task-definition' { $script:definitionResponse }
    'logs get-log-events' { [pscustomobject]@{ events = @($script:expectedMigrationMessages | ForEach-Object { [pscustomobject]@{ message = $_ } }) } }
    default { throw 'SyntheticUnexpectedMigrationAwsOperation' }
  }
  $result = Copy-D2RuntimeValue $result
  if ($null -ne $script:migrationMutation) { $result = & $script:migrationMutation $operation $result }
  return $result
}
Assert-D2ReleaseMigration $migrationReceipt $liveState $migrationVariables $pause; $passed++
foreach ($typedZero in @([int]0,[long]0)) {
  $typedReceipt = Copy-D2RuntimeValue $migrationReceipt
  $typedReceipt.exitCode = $typedZero
  Assert-D2ReleaseMigration $typedReceipt $liveState $migrationVariables $pause; $passed++
}
foreach ($exitCodeJson in @('"0"','""','true','false','0.0','0e0','-0.0','1','-1','2147483648','null','[]','{}')) {
  $badReceipt = ConvertFrom-D2RuntimeJson ($migrationReceiptJson.Replace('"exitCode":0', '"exitCode":' + $exitCodeJson))
  $beforeReads = $script:migrationReadCalls
  $rejectedByExitCodeGuard = $false
  try { Assert-D2ReleaseMigration $badReceipt $liveState $migrationVariables $pause }
  catch { $rejectedByExitCodeGuard = $_.Exception.Message -ceq 'D2RuntimeMigrationReceiptRejected' }
  Assert-True $rejectedByExitCodeGuard 'A noncanonical JSON exit code bypassed the migration receipt guard.'
  Assert-True ($script:migrationReadCalls -eq $beforeReads) 'Invalid JSON exit code reached the AWS read port.'
}
foreach ($typedExitCode in @([double]0,[single]0,[decimal]0,[System.Int16]0,[uint32]0,[uint64]0,[int]1,[long]1,[long]-1,$null)) {
  $badReceipt = Copy-D2RuntimeValue $migrationReceipt
  $badReceipt.exitCode = $typedExitCode
  $beforeReads = $script:migrationReadCalls
  $rejectedByExitCodeGuard = $false
  try { Assert-D2ReleaseMigration $badReceipt $liveState $migrationVariables $pause }
  catch { $rejectedByExitCodeGuard = $_.Exception.Message -ceq 'D2RuntimeMigrationReceiptRejected' }
  Assert-True $rejectedByExitCodeGuard 'An unsupported CLR exit-code type bypassed the migration receipt guard.'
  Assert-True ($script:migrationReadCalls -eq $beforeReads) 'Invalid CLR exit code reached the AWS read port.'
}
foreach ($mutation in @(
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks = @() }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks[0].lastStatus = 'RUNNING' }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks[0].taskDefinitionArn += '9' }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks[0].containers[0].exitCode = 1 }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks[0].createdAt = $now.AddSeconds(10).ToString('o') }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-tasks') { $x.tasks[0].overrides.containerOverrides[0] | Add-Member command @('other.js') }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-task-definition') { $x.taskDefinition.containerDefinitions[0].command = @('other.js') }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-task-definition') { $x.taskDefinition.containerDefinitions[0].secrets[0].valueFrom = 'other' }; return $x },
    { param($op,$x) if ($op -ceq 'ecs describe-task-definition') { $x.taskDefinition | Add-Member enableFaultInjection $true }; return $x },
    { param($op,$x) if ($op -ceq 'logs get-log-events') { $x.events = @($x.events | Select-Object -First 6) }; return $x },
    { param($op,$x) if ($op -ceq 'logs get-log-events') { $x.events += [pscustomobject]@{ message = 'unexpected-body' } }; return $x },
    { param($op,$x) if ($op -ceq 'logs get-log-events') { $x.events[1].message = 'Jobs migrations through 0022_other applied and verified.' }; return $x }
  )) {
  $script:migrationMutation = $mutation
  Assert-Rejected { Assert-D2ReleaseMigration $migrationReceipt $liveState $migrationVariables $pause } 'Unproven migration accepted.'
}
$script:migrationMutation = $null
$badReceipt = Copy-D2RuntimeValue $migrationReceipt; $badReceipt.submittedAt = $now.AddMinutes(1).ToString('o')
Assert-Rejected { Assert-D2ReleaseMigration $badReceipt $liveState $migrationVariables $pause } 'Migration submitted before active drain accepted.'
# Private-file lifecycle checks use a fresh bounded generated directory, not real operator evidence.
$temporaryRoot = Join-Path $repositoryRoot ('.tmp/d2-runtime-release-tests-' + [guid]::NewGuid().ToString('N'))
$privateRoot = Join-Path $temporaryRoot '.terraform'
$operatorRoot = Join-Path $privateRoot 'development-d2-runtime-release'
$null = New-Item -ItemType Directory -Path $operatorRoot -Force
try {
  $Action = 'Apply'; $Transition = 'Pause'; $SourceSha = $sourceSha; $ExpectedAccountId = $account
  $PlanPath = Join-Path $operatorRoot 'pause.tfplan'
  $ReviewedPlanSha256 = '1' * 64; $ReviewedPlanMetadataSha256 = '2' * 64
  $attempt = [pscustomobject]@{ schemaVersion = 1; kind = 'development-d2-runtime-apply-attempt'; transition = 'Pause'
    sourceSha = $sourceSha; accountId = $account; stateBucket = $StateBucket; stateLineage = $binding.stateLineage; stateSerial = 291
    planSha256 = $ReviewedPlanSha256; planMetadataSha256 = $ReviewedPlanMetadataSha256; beforeControlSha256 = ('3' * 64)
    attemptedAt = $now.ToString('o') }
  Write-D2ReleaseEvidence "$PlanPath.apply-attempt.json" $attempt
  Assert-Rejected { Write-D2ReleaseEvidence "$PlanPath.apply-attempt.json" $attempt } 'Ambiguous prior apply attempt overwritten.'
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $acl = Get-Acl -LiteralPath $operatorRoot
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    Assert-True ($acl.AreAccessRulesProtected -and @($acl.Access).Count -eq 1 -and
      $acl.Access[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ceq $sid.Value) 'Operator evidence directory is not current-user-only.'
  } else {
    $expectedDirectoryMode = [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite -bor [IO.UnixFileMode]::UserExecute
    $expectedFileMode = [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite
    Assert-True ([IO.File]::GetUnixFileMode($operatorRoot) -eq $expectedDirectoryMode) 'Operator evidence directory is not mode 0700.'
    Assert-True ([IO.File]::GetUnixFileMode("$PlanPath.apply-attempt.json") -eq $expectedFileMode) 'Operator evidence file is not mode 0600.'
  }
  $metadata = [pscustomobject]@{ stateSerial = 291; beforeControlSha256 = ('3' * 64) }
  $appliedState = [pscustomobject]@{ Lineage = $binding.stateLineage; Serial = 299 }
  $applied = [pscustomobject]@{ schemaVersion = 1; kind = 'development-d2-runtime-applied'; transition = 'Pause'
    sourceSha = $sourceSha; accountId = $account; stateBucket = $StateBucket; stateLineage = $binding.stateLineage
    beforeStateSerial = 291; stateSerial = 299; planSha256 = $ReviewedPlanSha256; planMetadataSha256 = $ReviewedPlanMetadataSha256
    attemptSha256 = Get-D2ReleaseFileHash "$PlanPath.apply-attempt.json"; consumptionSha256 = ''; appliedAt = $now.AddMinutes(1).ToString('o') }
  Assert-D2ReleaseAppliedReceipt $applied $appliedState $metadata $PlanPath; $passed++
  foreach ($mutation in @({ param($x) $x.stateSerial = 292 }, { param($x) $x.stateSerial = '299' },
      { param($x) $x.stateLineage = 'other' }, { param($x) $x.planSha256 = '4' * 64 },
      { param($x) $x.attemptSha256 = '4' * 64 }, { param($x) $x.beforeStateSerial = 290 })) {
    $bad = Copy-D2RuntimeValue $applied; & $mutation $bad
    Assert-Rejected { Assert-D2ReleaseAppliedReceipt $bad $appliedState $metadata $PlanPath } 'Applied proof was not bound to exact actual post-apply serial.'
  }
  $ReviewedPauseReceiptSha256 = '5' * 64; $Transition = 'Resume'
  $Action = 'Plan'; Assert-D2ReleasePauseConsumption; $passed++
  $consumption = [pscustomobject]@{ schemaVersion = 1; kind = 'development-d2-runtime-pause-consumed'
    pauseReceiptSha256 = $ReviewedPauseReceiptSha256; planSha256 = $ReviewedPlanSha256; planMetadataSha256 = $ReviewedPlanMetadataSha256
    sourceSha = $SourceSha; accountId = $account; consumedAt = $now.ToString('o') }
  Write-D2ReleaseEvidence (Get-D2ReleaseConsumptionPath) $consumption
  Assert-Rejected { Assert-D2ReleasePauseConsumption } 'Consumed cutoff reused for new Resume plan.'
  $Action = 'Apply'; Assert-Rejected { Assert-D2ReleasePauseConsumption } 'Failed/ambiguous Resume retried old cutoff.'
  $Action = 'Verify'; Assert-D2ReleasePauseConsumption; $passed++
  $ReviewedPlanSha256 = '6' * 64
  Assert-Rejected { Assert-D2ReleasePauseConsumption } 'Different Resume plan reused consumed cutoff.'
  $ReviewedPlanSha256 = '1' * 64; $Transition = 'Workers'
  Assert-Rejected { Assert-D2ReleasePauseConsumption } 'Resume then Pause accepted old cutoff for Workers.'
  $Transition = 'Pause'; $Action = 'Apply'
  $BaselinePlanPath = Join-Path $operatorRoot 'baseline.tfplan'; $BaselineMetadataPath = Join-Path $operatorRoot 'baseline.json'
  foreach ($path in @($BaselinePlanPath,$BaselineMetadataPath,$PlanPath,"$PlanPath.d2-runtime-release.json")) { Write-D2ReleaseEvidence $path ([pscustomobject]@{ generated = $true }) }
  $ReviewedBaselineSha256 = Get-D2ReleaseFileHash $BaselinePlanPath
  $ReviewedBaselineMetadataSha256 = Get-D2ReleaseFileHash $BaselineMetadataPath
  $ReviewedPlanSha256 = Get-D2ReleaseFileHash $PlanPath
  $ReviewedPlanMetadataSha256 = Get-D2ReleaseFileHash "$PlanPath.d2-runtime-release.json"
  Assert-D2ReleaseReviewedBytes; $passed++
  $ReviewedPlanSha256 = '7' * 64
  Assert-Rejected { Assert-D2ReleaseReviewedBytes } 'Late reviewed plan substitution accepted.'
  $ReviewedPlanSha256 = Get-D2ReleaseFileHash $PlanPath; $ReviewedBaselineMetadataSha256 = '7' * 64
  Assert-Rejected { Assert-D2ReleaseReviewedBytes } 'Late prerequisite substitution accepted.'
  $originalRepositoryRoot = $repositoryRoot
  try {
    $repositoryRoot = $temporaryRoot
    $sourceDirectory = Join-Path $temporaryRoot 'infrastructure/terraform/bootstrap'
    $null = New-Item -ItemType Directory -Path $sourceDirectory -Force
    $knownSource = New-Item -ItemType File -Path (Join-Path $sourceDirectory 'main.tf')
    $historicalPlan = New-Item -ItemType File -Path (Join-Path $sourceDirectory 'historical-july.tfplan')
    $historicalHash = Get-D2ReleaseFileHash $historicalPlan.FullName
    $knownPaths = @('infrastructure/terraform/bootstrap/main.tf')
    # The fresh fixture lives under the repository's ignored .tmp path, so real Git confirms
    # ignored status. No nested repository, branch, worktree or historical evidence is created.
    Assert-D2ReleaseTerraformSourceFiles $knownPaths; $passed++
    Assert-True ((Test-Path -LiteralPath $historicalPlan.FullName) -and
      (Get-D2ReleaseFileHash $historicalPlan.FullName) -ceq $historicalHash) 'Historical ignored plan was modified or removed.'
    foreach ($name in @('hidden.tf','hidden.auto.tfvars','hidden.tf.json','historical.tfplan.json')) {
      $hidden = New-Item -ItemType File -Path (Join-Path $sourceDirectory $name)
      [IO.File]::SetAttributes($hidden.FullName,[IO.FileAttributes]::Hidden)
      try { Assert-Rejected { Assert-D2ReleaseTerraformSourceFiles $knownPaths } 'Ignored hidden Terraform input was treated as harmless evidence.' }
      finally { Remove-Item -LiteralPath $hidden.FullName -Force }
    }
    function git { $global:LASTEXITCODE = 1 }
    try { Assert-Rejected { Assert-D2ReleaseTerraformSourceFiles $knownPaths } 'Unignored historical plan was permitted.' }
    finally { Remove-Item Function:git }
  } finally { $repositoryRoot = $originalRepositoryRoot }
} finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  $expectedPrefix = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.tmp')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTemporary.StartsWith($expectedPrefix,[StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $resolvedTemporary) -cnotmatch '^d2-runtime-release-tests-[a-f0-9]{32}$') { throw 'SyntheticCleanupBoundaryRejected' }
  Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
}
Write-Output "D2 runtime release tests passed: $passed assertions; synthetic-only responses, no cloud calls."
