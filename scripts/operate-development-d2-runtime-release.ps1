[CmdletBinding()]
param(
  [ValidateSet('Plan','Apply','Verify')][string]$Action = 'Plan',
  [ValidateSet('Pause','Workers','Resume')][string]$Transition = 'Pause',
  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId = '',
  [ValidatePattern('^[a-z0-9.-]+$')][string]$StateBucket = '',
  [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceSha = '',
  [string]$BaselinePlanPath = '', [string]$ReviewedBaselineSha256 = '',
  [string]$BaselineMetadataPath = '', [string]$ReviewedBaselineMetadataSha256 = '',
  [string]$PlanPath = '', [string]$ReviewedPlanSha256 = '', [string]$ReviewedPlanMetadataSha256 = '',
  [string]$ReviewedApplyReceiptSha256 = '',
  [string]$WorkerReceiptPath = '', [string]$ReviewedWorkerReceiptSha256 = '',
  [string]$GatewayReceiptPath = '', [string]$ReviewedGatewayReceiptSha256 = '',
  [string]$MigrationReceiptPath = '', [string]$ReviewedMigrationReceiptSha256 = '',
  [string]$PauseReceiptPath = '', [string]$ReviewedPauseReceiptSha256 = '',
  [switch]$Help
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/development-d2-runtime-release.ps1')
. (Join-Path $PSScriptRoot 'lib/development-current-document-baseline.ps1')
if ($Help) {
  Write-Output 'Plan/Apply/Verify -Transition Pause|Workers|Resume. All actions require exact current source, account, state bucket, and checksum-reviewed schema-7 baseline. Apply/Verify additionally require saved plan and metadata hashes; Verify requires ReviewedApplyReceiptSha256. Workers requires immutable worker and verified pause receipts. Resume also requires compatible Gateway and current44 migration receipts plus elapsed pause retirement. No publication, migration invocation, version/queue deletion, identity changes or automatic rollback/resume. A failed or ambiguous Apply forbids retry and requires live recovery inspection; it does not prove a complete pause. Out-of-band fence changes invalidate the cutoff.'
  exit 0
}
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$terraformDirectory = Join-Path $repositoryRoot 'infrastructure/terraform/environments/development'
$privateRoot = Join-Path $terraformDirectory '.terraform'
$operatorRoot = Join-Path $privateRoot 'development-d2-runtime-release'
$terraformDataDirectory = Join-Path $privateRoot 'development-d2-runtime-release-data'
$region = 'us-east-2'
$stateKey = 'platform.tfstate'

function Resolve-D2ReleasePath {
  param([string]$Path, [switch]$Existing, [switch]$Output)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'D2RuntimePrivatePathRequired' }
  $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) }
    else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path)) }
  $allowedRoot = if ($Output) { $operatorRoot } else { $privateRoot }
  if (-not $resolved.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'D2RuntimePrivatePathRejected' }
  $cursor = $resolved
  while ($cursor.Length -ge $privateRoot.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'D2RuntimeReparsePathRejected' }
    }
    $cursor = Split-Path -Parent $cursor
  }
  if ($Existing -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'D2RuntimeEvidenceMissing' }
  return $resolved
}
function Get-D2ReleaseFileHash { param([string]$Path); return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Read-D2ReleaseEvidence {
  param([string]$Path, [string]$Sha256)
  $resolved = Resolve-D2ReleasePath $Path -Existing
  if ($Sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-D2ReleaseFileHash $resolved) -cne $Sha256 -or
      (Get-Item -LiteralPath $resolved).Length -gt 4194304) { throw 'D2RuntimeEvidenceHashRejected' }
  try { $value = ConvertFrom-D2RuntimeJson (Get-Content -LiteralPath $resolved -Raw) }
  catch { throw 'D2RuntimeEvidenceJsonInvalid' }
  if ($value -isnot [pscustomobject]) { throw 'D2RuntimeEvidenceJsonInvalid' }
  return $value
}
function Write-D2ReleaseEvidence {
  param([string]$Path, [object]$Value)
  $resolved = Resolve-D2ReleasePath $Path -Output
  Set-D2ReleasePrivateDirectory (Split-Path -Parent $resolved)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 50))
  $stream = [IO.File]::Open($resolved, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}
function Set-D2ReleasePrivateDirectory {
  param([string]$Path)
  $null = Resolve-D2ReleasePath (Join-Path $Path 'boundary-check')
  $null = New-Item -ItemType Directory -Path $Path -Force
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $Path
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.Value) { throw 'D2RuntimePrivateOwnerChanged' }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($rule) }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  $directory = [IO.DirectoryInfo]::new($Path)
  if ($PSVersionTable.PSEdition -ceq 'Desktop') { $directory.SetAccessControl($acl) }
  else { [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl) }
}
function Invoke-D2ReleaseAws {
  param([string[]]$Arguments, [switch]$AllowNotFound)
  # This port is read-only. The sole deployment write is the separately guarded saved-plan apply.
  $operation = @($Arguments | Select-Object -First 2) -join ' '
  if ($operation -cnotin @('sts get-caller-identity','s3api get-bucket-versioning','s3api get-bucket-encryption',
      's3api get-public-access-block','s3api head-object','lambda get-alias','lambda list-aliases',
      'lambda get-function-configuration','lambda get-function-concurrency','lambda list-versions-by-function',
      'lambda list-function-event-invoke-configs','lambda list-function-url-configs','lambda get-policy',
      'lambda list-event-source-mappings','lambda get-event-source-mapping','events describe-rule',
      'events list-targets-by-rule','events list-rule-names-by-target','sqs get-queue-attributes',
      'ecs describe-tasks','ecs describe-task-definition','logs get-log-events')) {
    throw 'D2RuntimeAwsOperationRejected'
  }
  $prior = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = @(& aws.exe @Arguments --output json --no-cli-pager 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prior }
  $text = $raw -join "`n"
  if ($code -ne 0) {
    if ($AllowNotFound -and $text -cmatch '\(ResourceNotFoundException\)') { return $null }
    throw 'D2RuntimeAwsReadFailed'
  }
  if ($text.Length -gt 8388608) { throw 'D2RuntimeAwsResponseTooLarge' }
  try { $result = ConvertFrom-D2RuntimeJson $text } catch { throw 'D2RuntimeAwsJsonInvalid' }
  if ($null -eq $result -or $result -isnot [pscustomobject]) { throw 'D2RuntimeAwsInventoryIncomplete' }
  foreach ($tokenName in @('NextToken','NextMarker')) {
    if ($null -ne $result.PSObject.Properties[$tokenName] -and $result.$tokenName) { throw 'D2RuntimeAwsInventoryIncomplete' }
  }
  return $result
}
function Invoke-D2ReleaseTerraform {
  param([string[]]$Arguments, [int[]]$AcceptedExitCodes = @(0))
  $prior = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = @(& terraform "-chdir=$terraformDirectory" @Arguments 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prior }
  if ($code -notin $AcceptedExitCodes) { throw 'D2RuntimeTerraformOperationFailed' }
  return [pscustomobject]@{ Code = $code; Text = ($raw -join "`n") }
}
function Assert-D2ReleaseSource {
  $gitCommand = Get-Command git -ErrorAction Stop | Select-Object -First 1
  if ($gitCommand.CommandType -ne [Management.Automation.CommandTypes]::Application) { throw 'D2RuntimeNativeGitRequired' }
  if ($SourceSha -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedAccountId -cnotmatch '^[0-9]{12}$' -or
      $StateBucket -cnotmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') { throw 'D2RuntimeExactBoundaryRequired' }
  foreach ($revision in @('HEAD','origin/main')) {
    $actual = @(& git -C $repositoryRoot rev-parse $revision 2>$null)
    if ($LASTEXITCODE -ne 0 -or $actual.Count -ne 1 -or $actual[0] -cne $SourceSha) { throw 'D2RuntimeSourceNotCurrentMain' }
  }
  $branch = @(& git -C $repositoryRoot branch --show-current 2>$null)
  $status = @(& git -C $repositoryRoot status --porcelain --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0 -or $branch.Count -ne 1 -or $branch[0] -cne 'main' -or $status.Count -ne 0) { throw 'D2RuntimeSourceNotClean' }
  $tracked = @(& git -C $repositoryRoot ls-files -v -- infrastructure/terraform 2>$null)
  if ($LASTEXITCODE -ne 0 -or $tracked.Count -eq 0 -or @($tracked | Where-Object { $_ -cnotmatch '^H ' }).Count -ne 0) { throw 'D2RuntimeTerraformIndexRejected' }
  $known = @($tracked | ForEach-Object { $_.Substring(2) })
  Assert-D2ReleaseTerraformSourceFiles $known
  Assert-DeploymentTerraformCli
  $awsCommand = Get-Command aws.exe -ErrorAction Stop | Select-Object -First 1
  if ($awsCommand.CommandType -ne [Management.Automation.CommandTypes]::Application) { throw 'D2RuntimeNativeAwsRequired' }
  foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Name -imatch '^(?:AWS_ENDPOINT_URL(?:_.*)?|AWS_(?:S3|STS|IAM|DYNAMODB)_ENDPOINT|AWS_EC2_METADATA_SERVICE_ENDPOINT|AWS_SSE_CUSTOMER_KEY|AWS_CA_BUNDLE)$' -and
        -not [string]::IsNullOrEmpty($entry.Value)) { throw 'D2RuntimeAwsEndpointOverrideRejected' }
  }
  $null = Resolve-D2ReleasePath $terraformDataDirectory
}
function Assert-D2ReleaseTerraformSourceFiles {
  param([string[]]$KnownPaths)
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push((Join-Path $repositoryRoot 'infrastructure/terraform'))
  while ($pending.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'D2RuntimeTerraformReparseRejected' }
      if ($item.Name -ceq '.terraform' -and $item.PSIsContainer) { continue }
      if ($item.PSIsContainer) { $pending.Push($item.FullName); continue }
      $relative = $item.FullName.Substring($repositoryRoot.Length + 1).Replace('\','/')
      if ($KnownPaths -ccontains $relative) { continue }
      # A saved binary plan is not auto-loaded Terraform configuration. Preserve ignored historical
      # evidence, including outside .terraform, without treating it as a current apply candidate.
      # Only the separately reviewed, hash-bound operator plan can reach saved-plan Apply.
      if ($item.Extension -ceq '.tfplan') {
        $null = & git -C $repositoryRoot check-ignore --quiet -- $relative 2>$null
        if ($LASTEXITCODE -eq 0) { continue }
      }
      throw 'D2RuntimeUntrackedTerraformInputRejected'
    }
  }
}
function Initialize-D2ReleaseBackend {
  $caller = Invoke-D2ReleaseAws @('sts','get-caller-identity')
  if ($caller.Account -cne $ExpectedAccountId -or $caller.Arn -cnotmatch "^arn:aws:sts::$ExpectedAccountId`:assumed-role/") { throw 'D2RuntimeCallerRejected' }
  $versioning = Invoke-D2ReleaseAws @('s3api','get-bucket-versioning','--bucket',$StateBucket,'--expected-bucket-owner',$ExpectedAccountId)
  $encryption = Invoke-D2ReleaseAws @('s3api','get-bucket-encryption','--bucket',$StateBucket,'--expected-bucket-owner',$ExpectedAccountId)
  $block = (Invoke-D2ReleaseAws @('s3api','get-public-access-block','--bucket',$StateBucket,'--expected-bucket-owner',$ExpectedAccountId)).PublicAccessBlockConfiguration
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules)
  if ($versioning.Status -cne 'Enabled' -or $rules.Count -ne 1 -or
      $rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'aws:kms' -or $rules[0].BucketKeyEnabled -ne $true -or
      @($block.PSObject.Properties | Where-Object { $_.Value -isnot [bool] -or -not $_.Value }).Count -ne 0 -or
      @($block.PSObject.Properties).Count -ne 4) { throw 'D2RuntimeBackendBoundaryRejected' }
  $script:stateKmsArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($stateKmsArn -cnotmatch "^arn:aws:kms:us-east-2:$ExpectedAccountId`:key/[a-f0-9-]{36}$") { throw 'D2RuntimeBackendKeyRejected' }
  Set-D2ReleasePrivateDirectory $terraformDataDirectory
  $env:TF_DATA_DIR = $terraformDataDirectory
  $null = Invoke-D2ReleaseTerraform @('init','-reconfigure','-input=false','-lockfile=readonly',
    "-backend-config=bucket=$StateBucket",'-backend-config=key=platform.tfstate','-backend-config=region=us-east-2',
    "-backend-config=kms_key_id=$stateKmsArn",'-backend-config=encrypt=true','-backend-config=use_lockfile=true')
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $terraformDataDirectory `
    -ExpectedBucket $StateBucket -ExpectedKey $stateKey -ExpectedRegion $region -ExpectedKmsKeyArn $stateKmsArn
}
function Read-D2ReleaseState {
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $terraformDataDirectory `
    -ExpectedBucket $StateBucket -ExpectedKey $stateKey -ExpectedRegion $region -ExpectedKmsKeyArn $stateKmsArn
  $read = Invoke-D2ReleaseTerraform @('state','pull')
  try { $state = $read.Text | ConvertFrom-Json } catch { throw 'D2RuntimeStateJsonInvalid' }
  Assert-DeploymentTerraformStateVersion ([string]$state.terraform_version)
  if ($state.lineage -cnotmatch '^[a-f0-9-]{36}$' -or $state.serial -lt 1) { throw 'D2RuntimeStateIdentityInvalid' }
  $resources = New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  foreach ($resource in $state.resources) {
    if ($resource.mode -cne 'managed') { continue }
    $module = if ($null -ne $resource.PSObject.Properties['module']) { "$($resource.module)." } else { '' }
    foreach ($instance in $resource.instances) {
      $index = if ($null -ne $instance.PSObject.Properties['index_key']) {
        '[' + (ConvertTo-Json -InputObject $instance.index_key -Compress) + ']'
      } else { '' }
      $address = "$module$($resource.type).$($resource.name)$index"
      if ($resources.ContainsKey($address)) { throw 'D2RuntimeStateDuplicateResource' }
      $resources.Add($address, $instance.attributes)
    }
  }
  return [pscustomobject]@{ Lineage = $state.lineage; Serial = $state.serial; Resources = $resources }
}
function Set-D2ReleaseVariables {
  param([object]$Variables)
  foreach ($entry in $Variables.PSObject.Properties) {
    $value = $entry.Value.value
    $serialized = if ($value -is [string]) { $value } elseif ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
      else { ConvertTo-Json -InputObject $value -Depth 50 -Compress }
    [Environment]::SetEnvironmentVariable("TF_VAR_$($entry.Name)", $serialized, 'Process')
  }
}
function Assert-D2ReleaseObject {
  param([string]$Bucket, [string]$Key, [string]$Version, [string]$Base64Sha)
  $head = Invoke-D2ReleaseAws @('s3api','head-object','--bucket',$Bucket,'--key',$Key,'--version-id',$Version,
    '--checksum-mode','ENABLED','--expected-bucket-owner',$ExpectedAccountId)
  if ($head.VersionId -cne $Version -or $head.ChecksumSHA256 -cne $Base64Sha -or $head.ContentLength -le 0 -or
      $head.ServerSideEncryption -cnotin @('AES256','aws:kms')) { throw 'D2RuntimeImmutableObjectRejected' }
}
function Get-D2ReleaseLiveSnapshot {
  param([object]$State, [object]$Variables)
  $runtime = Get-D2RuntimeConfiguration $Variables
  $paused = Get-D2RuntimeMaintenance $runtime
  $control = [ordered]@{}
  $maximumTimeout = 0
  $ruleName = 'ai-job-apply-development-d2-community-batch'
  $ruleArn = "arn:aws:events:us-east-2:$ExpectedAccountId`:rule/$ruleName"
  foreach ($kind in @('gateway','d2_community_scheduled','d2_trust_signal')) {
    $function = $State.Resources["module.platform.aws_lambda_function.$kind[0]"]
    $expectedAlias = $State.Resources["module.platform.aws_lambda_alias.$kind[0]"]
    $name = [string]$function.function_name
    $alias = Invoke-D2ReleaseAws @('lambda','get-alias','--function-name',$name,'--name','development')
    $configuration = Invoke-D2ReleaseAws @('lambda','get-function-configuration','--function-name',$name,'--qualifier',[string]$alias.FunctionVersion)
    $concurrency = Invoke-D2ReleaseAws @('lambda','get-function-concurrency','--function-name',$name)
    Assert-D2RuntimeLiveFunction $configuration $alias $concurrency $function $expectedAlias $ExpectedAccountId
    $maximumTimeout = [Math]::Max($maximumTimeout, [int]$configuration.Timeout)
    $environment = $configuration.Environment.Variables
    if ($kind -ceq 'gateway') {
      if ($environment.D2_PRIVATE_CAPTURE_ROUTES_ENABLED -cne 'true' -or
          $environment.D2_CONTRIBUTION_ROUTES_ENABLED -cne (-not $paused).ToString().ToLowerInvariant() -or
          $environment.D2_TRUST_REVIEWER_ROUTES_ENABLED -cne (-not $paused).ToString().ToLowerInvariant() -or
          $configuration.CodeSha256 -cne $Variables.gateway_lambda_artifact_base64sha256.value) { throw 'D2RuntimeLiveGatewayGateRejected' }
    } else {
      $expectedConcurrency = if ($paused) { 0 } elseif ($kind -ceq 'd2_community_scheduled') { $runtime.scheduled_reserved_concurrency } else { $runtime.signal_reserved_concurrency }
      if ($concurrency.ReservedConcurrentExecutions -ne $expectedConcurrency -or
          $environment.D2_COMMUNITY_RUNTIME_ENABLED -cne (-not $paused).ToString().ToLowerInvariant() -or
          $configuration.CodeSha256 -cne $runtime.artifact_base64sha256 -or $environment.RELEASE_SHA -cne $runtime.artifact_sha256) { throw 'D2RuntimeLiveWorkerGateRejected' }
      $aliases = @( (Invoke-D2ReleaseAws @('lambda','list-aliases','--function-name',$name,'--max-items','129')).Aliases )
      $versions = @( (Invoke-D2ReleaseAws @('lambda','list-versions-by-function','--function-name',$name,'--max-items','129')).Versions )
      if ($aliases.Count -ne 1 -or $aliases[0].Name -cne 'development' -or $versions.Count -lt 2 -or $versions.Count -gt 128) { throw 'D2RuntimeVersionInventoryRejected' }
      if (@((Invoke-D2ReleaseAws @('lambda','list-function-event-invoke-configs','--function-name',$name,'--max-items','129')).FunctionEventInvokeConfigs).Count -ne 0 -or
          @((Invoke-D2ReleaseAws @('lambda','list-function-url-configs','--function-name',$name,'--max-items','129')).FunctionUrlConfigs).Count -ne 0) { throw 'D2RuntimeUnreviewedAsyncConfiguration' }
      foreach ($version in $versions) {
        if ($version.Timeout -lt 1 -or $version.Timeout -gt 900) { throw 'D2RuntimeOldTimeoutInvalid' }
        $maximumTimeout = [Math]::Max($maximumTimeout, [int]$version.Timeout)
        $qualifier = [string]$version.Version
        if ($qualifier -cne '$LATEST' -and $qualifier -cnotmatch '^[1-9][0-9]*$') { throw 'D2RuntimeVersionInvalid' }
        $policyArguments = @('lambda','get-policy','--function-name',$name)
        if ($qualifier -cne '$LATEST') { $policyArguments += @('--qualifier',$qualifier) }
        if ($null -ne (Invoke-D2ReleaseAws $policyArguments -AllowNotFound)) { throw 'D2RuntimeUnexpectedVersionIngress' }
        $deadLetter = $version.PSObject.Properties['DeadLetterConfig']
        if ($null -ne $deadLetter -and $null -ne $deadLetter.Value.PSObject.Properties['TargetArn'] -and
            $deadLetter.Value.TargetArn) { throw 'D2RuntimeUnreviewedAsyncDestination' }
        $versionRules = Invoke-D2ReleaseAws @('events','list-rule-names-by-target','--target-arn',[string]$version.FunctionArn,'--max-items','129')
        if (@($versionRules.RuleNames).Count -ne 0) { throw 'D2RuntimeNumericScheduleIngressRejected' }
        # Lambda filters event-source mappings by the exact supplied qualifier. A bare function
        # name does not enumerate mappings bound to its alias (or a numeric version).
        $versionMappings = Invoke-D2ReleaseAws @('lambda','list-event-source-mappings','--function-name',[string]$version.FunctionArn,'--max-items','129')
        if (@($versionMappings.EventSourceMappings).Count -ne 0) { throw 'D2RuntimeNumericMappingIngressRejected' }
      }
      $aliasPolicy = Invoke-D2ReleaseAws @('lambda','get-policy','--function-name',$name,'--qualifier','development') -AllowNotFound
      $rules = @( (Invoke-D2ReleaseAws @('events','list-rule-names-by-target','--target-arn',[string]$alias.AliasArn,'--max-items','129')).RuleNames )
      $mappings = @( (Invoke-D2ReleaseAws @('lambda','list-event-source-mappings','--function-name',[string]$alias.AliasArn,'--max-items','129')).EventSourceMappings )
      if ($kind -ceq 'd2_community_scheduled') {
        if ($null -eq $aliasPolicy -or ($rules -join '|') -cne $ruleName -or $mappings.Count -ne 0) { throw 'D2RuntimeScheduledIngressRejected' }
        Assert-D2RuntimeSchedulePermission $aliasPolicy.Policy $alias.AliasArn $ruleArn
      } elseif ($null -ne $aliasPolicy -or $rules.Count -ne 0 -or $mappings.Count -ne 1 -or
          $mappings[0].UUID -cne $State.Resources['module.platform.aws_lambda_event_source_mapping.d2_trust_signal[0]'].uuid) { throw 'D2RuntimeTrustIngressRejected' }
    }
    $control[$kind] = [ordered]@{ version = $alias.FunctionVersion; code = $configuration.CodeSha256
      configurationSha256 = Get-D2RuntimeDigest $configuration.Environment.Variables
      reservedConcurrency = $concurrency.ReservedConcurrentExecutions }
  }
  $rule = Invoke-D2ReleaseAws @('events','describe-rule','--name',$ruleName)
  $targets = @((Invoke-D2ReleaseAws @('events','list-targets-by-rule','--rule',$ruleName,'--max-items','129')).Targets)
  $scheduleArn = "arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:ai-job-apply-development-d2-community-scheduled:development"
  $expectedRuleState = if ($paused) { 'DISABLED' } else { 'ENABLED' }
  if ($rule.Arn -cne $ruleArn -or $rule.State -cne $expectedRuleState -or $rule.ScheduleExpression -cne $runtime.schedule_expression -or
      $targets.Count -ne 1 -or $targets[0].Id -cne 'd2-community-scheduled' -or $targets[0].Arn -cne $scheduleArn) { throw 'D2RuntimeScheduleReadbackRejected' }
  Assert-ExactObjectKeys $targets[0] @('Id','Arn','Input') 'D2 exact default-retry schedule target'
  $inputValue = $targets[0].Input | ConvertFrom-Json
  if ((ConvertTo-DeploymentCanonicalValue $inputValue) -cne (ConvertTo-DeploymentCanonicalValue ([pscustomobject]@{
        schemaVersion = 1; action = 'run-d2-community-batch'; scheduleRuleArn = $ruleArn }))) { throw 'D2RuntimeScheduleInputRejected' }
  $expectedMapping = $State.Resources['module.platform.aws_lambda_event_source_mapping.d2_trust_signal[0]']
  $mapping = Invoke-D2ReleaseAws @('lambda','get-event-source-mapping','--uuid',[string]$expectedMapping.uuid)
  $expectedMappingState = if ($paused) { 'Disabled' } else { 'Enabled' }
  if ($mapping.State -cne $expectedMappingState -or $mapping.FunctionArn -cne $expectedMapping.function_name -or
      $mapping.EventSourceArn -cne $expectedMapping.event_source_arn -or $mapping.BatchSize -ne $runtime.trust_signal_batch_size -or
      $mapping.MaximumBatchingWindowInSeconds -ne 0 -or $mapping.ScalingConfig.MaximumConcurrency -ne $runtime.signal_reserved_concurrency -or
      (@($mapping.FunctionResponseTypes) -join '|') -cne 'ReportBatchItemFailures') { throw 'D2RuntimeMappingReadbackRejected' }
  $queue = $State.Resources['module.platform.aws_sqs_queue.d2_trust_signal[0]']
  $attributes = (Invoke-D2ReleaseAws @('sqs','get-queue-attributes','--queue-url',[string]$queue.url,'--attribute-names','All')).Attributes
  if ($attributes.QueueArn -cne $queue.arn -or $attributes.KmsMasterKeyId -cne $queue.kms_master_key_id -or
      [int]$attributes.VisibilityTimeout -ne $runtime.queue_visibility_timeout_seconds -or
      [int]$attributes.MessageRetentionPeriod -ne $runtime.queue_message_retention_seconds -or
      (ConvertTo-DeploymentCanonicalValue ($attributes.RedrivePolicy | ConvertFrom-Json)) -cne
        (ConvertTo-DeploymentCanonicalValue ($queue.redrive_policy | ConvertFrom-Json))) { throw 'D2RuntimeQueueBoundaryChanged' }
  $control.schedule = $rule.State; $control.mapping = $mapping.State
  return [pscustomobject]@{ paused = $paused; controlSha256 = Get-D2RuntimeDigest $control
    oldMaximumTimeoutSeconds = $maximumTimeout; asyncMaximumAgeSeconds = 21600
    pendingMessages = [long]$attributes.ApproximateNumberOfMessages
    inFlightMessages = [long]$attributes.ApproximateNumberOfMessagesNotVisible
    queueEmptyProven = $false }
}

function Assert-D2ReleaseMigration {
  param([object]$Receipt, [object]$State, [object]$Variables, [object]$Pause)
  $keys = @('schemaVersion','kind','environment','accountId','stateBucket','sourceSha','operatorSourceSha',
    'migrationImage','taskPlanSha256','taskPlanMetadataSha256','executionPlanSha256','executionClaimKey',
    'executionClaimVersion','executionClaimChecksumSHA256','taskArn','phase','submittedAt','stoppedAt','exitCode')
  if ($null -ne $Receipt.PSObject.Properties['recoveredByOperatorSourceSha']) { $keys += 'recoveredByOperatorSourceSha' }
  Assert-ExactObjectKeys $Receipt $keys 'D2 current migration receipt'
  if ($Receipt.schemaVersion -ne 2 -or $Receipt.kind -cne 'development-document-migration-receipt' -or
      $Receipt.environment -cne 'development' -or $Receipt.accountId -cne $ExpectedAccountId -or
      $Receipt.stateBucket -cne $StateBucket -or $Receipt.sourceSha -cne $SourceSha -or
      $Receipt.operatorSourceSha -cne $SourceSha -or $Receipt.phase -cne 'verified' -or
      $Receipt.exitCode -isnot [int] -or $Receipt.exitCode -ne 0 -or
      $Receipt.migrationImage -cne $Variables.migration_image.value -or
      $Receipt.migrationImage -cnotmatch "^$ExpectedAccountId\.dkr\.ecr\.us-east-2\.amazonaws\.com/ai-job-apply/migration@sha256:[a-f0-9]{64}$") {
    throw 'D2RuntimeMigrationReceiptRejected'
  }
  foreach ($field in @('taskPlanSha256','taskPlanMetadataSha256','executionPlanSha256')) {
    if ($Receipt.$field -cnotmatch '^[a-f0-9]{64}$') { throw 'D2RuntimeMigrationReceiptRejected' }
  }
  $submitted = ConvertTo-D2RuntimeUtc $Receipt.submittedAt
  $stopped = ConvertTo-D2RuntimeUtc $Receipt.stoppedAt
  if ($submitted -lt (ConvertTo-D2RuntimeUtc $Pause.cutoffAt).AddSeconds($Pause.oldMaximumTimeoutSeconds + 60) -or
      $stopped -lt $submitted -or $stopped -gt [datetime]::UtcNow) { throw 'D2RuntimeMigrationStartedBeforeDrain' }
  $cluster = $State.Resources['module.platform.aws_ecs_cluster.this'].arn
  $expectedDefinition = $State.Resources['module.platform.aws_ecs_task_definition.migration[0]']
  if ($Receipt.taskArn -cnotmatch "^arn:aws:ecs:us-east-2:$ExpectedAccountId`:task/ai-job-apply-development/[a-f0-9]{32}$") { throw 'D2RuntimeMigrationTaskIdentityRejected' }
  $response = Invoke-D2ReleaseAws @('ecs','describe-tasks','--cluster',[string]$cluster,'--tasks',[string]$Receipt.taskArn)
  if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne 1) { throw 'D2RuntimeMigrationTaskUnavailable' }
  $task = $response.tasks[0]
  $containers = @($task.containers)
  if ($task.taskArn -cne $Receipt.taskArn -or $task.clusterArn -cne $cluster -or
      $task.taskDefinitionArn -cne $expectedDefinition.arn -or $task.launchType -cne 'FARGATE' -or
      $task.lastStatus -cne 'STOPPED' -or $containers.Count -ne 1 -or $containers[0].name -cne 'database-migration' -or
      $containers[0].exitCode -ne 0 -or $containers[0].image -cne $Receipt.migrationImage -or
      $containers[0].imageDigest -cne ($Receipt.migrationImage -split '@',2)[1]) { throw 'D2RuntimeMigrationTaskMismatch' }
  # ECS returns empty container override records for default invocations; any effective override rejects.
  foreach ($property in $task.overrides.PSObject.Properties) {
    if ($property.Name -ceq 'containerOverrides') {
      foreach ($item in @($property.Value)) {
        if (@($item.PSObject.Properties | Where-Object { $_.Name -cne 'name' -and
              $null -ne $_.Value -and (ConvertTo-DeploymentCanonicalValue $_.Value) -cnotin @('[]','{}','""') }).Count -ne 0 -or
            $item.name -cne 'database-migration') { throw 'D2RuntimeMigrationOverrideRejected' }
      }
    } elseif ($null -ne $property.Value -and (ConvertTo-DeploymentCanonicalValue $property.Value) -cnotin @('[]','{}','""')) { throw 'D2RuntimeMigrationOverrideRejected' }
  }
  $definition = (Invoke-D2ReleaseAws @('ecs','describe-task-definition','--task-definition',[string]$expectedDefinition.arn)).taskDefinition
  $definitionContainers = @($definition.containerDefinitions)
  $decodedContainers = ConvertFrom-D2RuntimeJson $expectedDefinition.container_definitions
  $stateContainers = @($decodedContainers)
  if ($definition.taskDefinitionArn -cne $expectedDefinition.arn -or $definition.networkMode -cne 'awsvpc' -or
      $definition.executionRoleArn -cne $expectedDefinition.execution_role_arn -or
      [string](Get-GatewayOptionalProperty $definition 'taskRoleArn') -cne [string]$expectedDefinition.task_role_arn -or $definitionContainers.Count -ne 1 -or
      $stateContainers.Count -ne 1 -or $definitionContainers[0].image -cne $Receipt.migrationImage -or
      $definitionContainers[0].name -cne 'database-migration' -or
      (Get-D2RuntimeDigest $definitionContainers[0].logConfiguration) -cne (Get-D2RuntimeDigest $stateContainers[0].logConfiguration)) {
    throw 'D2RuntimeMigrationDefinitionMismatch'
  }
  if ($definition.status -cne 'ACTIVE' -or $definition.family -cne 'ai-job-apply-development-database-migration' -or
      [string]$definition.cpu -cne '256' -or [string]$definition.memory -cne '512' -or
      (@($definition.requiresCompatibilities) -join '|') -cne 'FARGATE' -or
      $definition.runtimePlatform.cpuArchitecture -cne 'X86_64' -or $definition.runtimePlatform.operatingSystemFamily -cne 'LINUX' -or
      $definitionContainers[0].essential -isnot [bool] -or -not $definitionContainers[0].essential -or
      $definitionContainers[0].readonlyRootFilesystem -isnot [bool] -or -not $definitionContainers[0].readonlyRootFilesystem -or
      (@($definitionContainers[0].command) -join '|') -cne 'runner/dist/src/main.js' -or
      (Get-D2RuntimeDigest $definitionContainers[0].environment) -cne (Get-D2RuntimeDigest $stateContainers[0].environment) -or
      (Get-D2RuntimeDigest $definitionContainers[0].secrets) -cne (Get-D2RuntimeDigest $stateContainers[0].secrets)) { throw 'D2RuntimeMigrationExecutionContractRejected' }
  foreach ($field in @('ipcMode','pidMode','taskRoleArn')) {
    if ([string](Get-GatewayOptionalProperty $definition $field)) { throw 'D2RuntimeMigrationExecutionContractRejected' }
  }
  $faultInjection = Get-GatewayOptionalProperty $definition 'enableFaultInjection'
  if ($null -ne $faultInjection -and ($faultInjection -isnot [bool] -or $faultInjection)) { throw 'D2RuntimeMigrationExecutionContractRejected' }
  foreach ($field in @('entryPoint','environmentFiles','mountPoints','volumesFrom','resourceRequirements','linuxParameters')) {
    $value = Get-GatewayOptionalProperty $definitionContainers[0] $field
    if ($null -ne $value -and (ConvertTo-DeploymentCanonicalValue $value) -cnotin @('[]','{}','""')) { throw 'D2RuntimeMigrationExecutionContractRejected' }
  }
  $logConfig = $definitionContainers[0].logConfiguration
  if ($logConfig.logDriver -cne 'awslogs' -or $logConfig.options.'awslogs-region' -cne $region -or
      $logConfig.options.'awslogs-stream-prefix' -cne 'database-migration' -or
      $logConfig.options.'awslogs-group' -cne $State.Resources['module.platform.aws_cloudwatch_log_group.application'].name) { throw 'D2RuntimeMigrationLogBoundaryRejected' }
  $stream = 'database-migration/database-migration/' + ($Receipt.taskArn -split '/')[-1]
  $logs = Invoke-D2ReleaseAws @('logs','get-log-events','--log-group-name',[string]$logConfig.options.'awslogs-group',
    '--log-stream-name',$stream,'--start-from-head','--limit','100')
  $expectedMessages = @(Get-D2RuntimeMigrationMessages $repositoryRoot $SourceSha)
  $messages = @($logs.events | ForEach-Object { [string]$_.message })
  if (($messages -join "`n") -cne ($expectedMessages -join "`n")) { throw 'D2RuntimeMigration44NotProven' }
  # submittedAt is recorded after RunTask returns, not the ECS creation clock. The actual task
  # must independently satisfy the pre-DDL active-invocation drain; do not equate those clocks.
  $createdAt = [datetimeoffset]::Parse([string]$task.createdAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
  $stoppedAt = [datetimeoffset]::Parse([string]$task.stoppedAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
  if ($createdAt -lt (ConvertTo-D2RuntimeUtc $Pause.cutoffAt).AddSeconds($Pause.oldMaximumTimeoutSeconds + 60) -or
      $createdAt -gt $stoppedAt -or [Math]::Abs(($stoppedAt - $stopped).TotalSeconds) -gt 1) { throw 'D2RuntimeMigrationTimeMismatch' }
}
function Read-D2ReleaseBaseline {
  $path = Resolve-D2ReleasePath $BaselinePlanPath -Existing
  if ($ReviewedBaselineSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-D2ReleaseFileHash $path) -cne $ReviewedBaselineSha256) { throw 'D2RuntimeBaselineHashRejected' }
  $metadata = Read-D2ReleaseEvidence $BaselineMetadataPath $ReviewedBaselineMetadataSha256
  $plan = Read-DeploymentTerraformPlan -Path $path -TerraformDirectory $terraformDirectory
  $declared = @(Get-ChildItem -LiteralPath $terraformDirectory -File -Filter '*.tf' | ForEach-Object {
      [regex]::Matches((Get-Content -LiteralPath $_.FullName -Raw), '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') |
        ForEach-Object { $_.Groups[1].Value }
    })
  if ($declared.Count -eq 0 -or @($declared | Sort-Object -Unique).Count -ne $declared.Count) { throw 'D2RuntimeDeclaredVariablesInvalid' }
  $null = Assert-RetainedGatewayBaselinePlan $plan $declared
  $recordedState = [pscustomobject]@{ Lineage = $metadata.StateLineage; Serial = $metadata.StateSerial }
  $null = Assert-CurrentDocumentBaselineEvidence -Metadata $metadata -Plan $plan -PlanPath $path -PlanSha256 $ReviewedBaselineSha256 `
    -CurrentState $recordedState -SourceSha $SourceSha -AccountId $ExpectedAccountId -Region $region `
    -RepositoryRoot $repositoryRoot -ReceiptDirectory (Join-Path $privateRoot 'development-document-artifacts')
  return [pscustomobject]@{ Plan = $plan; Metadata = $metadata; Declared = $declared; Path = $path }
}
function Get-D2ReleaseBinding {
  param([object]$State, [object]$Variables, [string]$PlanSha256 = '')
  return [pscustomobject]@{ accountId = $ExpectedAccountId; stateBucket = $StateBucket; stateLineage = $State.Lineage
    stateSerial = $State.Serial; sourceSha = $SourceSha; planSha256 = $PlanSha256
    authoritySha256 = Get-D2RuntimeAuthorityDigest $Variables }
}
function Read-D2ReleasePrerequisites {
  param([object]$State, [object]$Variables)
  $artifact = $null; $pause = $null
  if ($Transition -cne 'Pause') {
    $pause = Read-D2ReleaseEvidence $PauseReceiptPath $ReviewedPauseReceiptSha256
    Assert-D2RuntimePauseReceipt $pause (Get-D2ReleaseBinding $State $Variables) ([datetime]::UtcNow) -RequireElapsed:($Transition -ceq 'Resume')
    & git -C $repositoryRoot merge-base --is-ancestor $pause.sourceSha $SourceSha 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'D2RuntimePauseSourceNotAncestor' }
    Assert-D2ReleasePauseConsumption
    $artifact = Read-D2ReleaseEvidence $WorkerReceiptPath $ReviewedWorkerReceiptSha256
    $bucket = $State.Resources['module.platform.aws_s3_bucket.artifacts'].bucket
    Assert-D2RuntimeArtifact $artifact $SourceSha $bucket
    Assert-D2ReleaseObject $bucket $artifact.key $artifact.versionId $artifact.artifactBase64Sha256
    if ($Transition -ceq 'Resume') {
      $runtime = Get-D2RuntimeConfiguration $Variables
      if ($runtime.artifact_s3_key -cne $artifact.key -or $runtime.artifact_s3_object_version -cne $artifact.versionId -or
          $runtime.artifact_sha256 -cne $artifact.artifactSha256 -or $runtime.artifact_base64sha256 -cne $artifact.artifactBase64Sha256) { throw 'D2RuntimeCompatibleWorkersNotDeployed' }
      $gatewayReceipt = Read-D2ReleaseEvidence $GatewayReceiptPath $ReviewedGatewayReceiptSha256
      $kmsArn = $State.Resources['module.platform.aws_kms_key.platform'].arn
      $boundaryHash = Get-CurrentDocumentBaselineTextSha256 "$ExpectedAccountId|$region|$bucket|$kmsArn"
      $gateway = Assert-GatewayPublicationReceipt $gatewayReceipt $SourceSha $boundaryHash
      foreach ($pair in @(@('gateway_lambda_artifact_s3_key','key'), @('gateway_lambda_artifact_s3_object_version','versionId'),
          @('gateway_lambda_artifact_sha256','artifactSha256'), @('gateway_lambda_artifact_base64sha256','objectBase64Sha256'))) {
        if ($Variables.($pair[0]).value -cne $gateway.($pair[1])) { throw 'D2RuntimeCompatibleGatewayNotDeployed' }
      }
      Assert-D2ReleaseObject $bucket $gateway.key $gateway.versionId $gateway.objectBase64Sha256
      $migration = Read-D2ReleaseEvidence $MigrationReceiptPath $ReviewedMigrationReceiptSha256
      Assert-D2ReleaseMigration $migration $State $Variables $pause
    }
  } elseif ($WorkerReceiptPath -or $GatewayReceiptPath -or $MigrationReceiptPath -or $PauseReceiptPath) { throw 'D2RuntimeUnexpectedPausePrerequisite' }
  return [pscustomobject]@{ Artifact = $artifact; Pause = $pause }
}
function Get-D2ReleaseConsumptionPath {
  if ($ReviewedPauseReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'D2RuntimePauseHashRequired' }
  return Join-Path $operatorRoot "pause-$ReviewedPauseReceiptSha256.consumed.json"
}
function Assert-D2ReleasePauseConsumption {
  $path = Get-D2ReleaseConsumptionPath
  if (-not (Test-Path -LiteralPath $path)) {
    if ($Action -ceq 'Verify' -and $Transition -ceq 'Resume') { throw 'D2RuntimeResumeConsumptionMissing' }
    return
  }
  $path = Resolve-D2ReleasePath $path -Existing -Output
  $record = Read-D2ReleaseEvidence $path (Get-D2ReleaseFileHash $path)
  Assert-ExactObjectKeys $record @('schemaVersion','kind','pauseReceiptSha256','planSha256','planMetadataSha256','sourceSha','accountId','consumedAt') 'D2 consumed pause'
  if ($Action -cne 'Verify' -or $Transition -cne 'Resume' -or $record.schemaVersion -ne 1 -or
      $record.kind -cne 'development-d2-runtime-pause-consumed' -or $record.pauseReceiptSha256 -cne $ReviewedPauseReceiptSha256 -or
      $record.planSha256 -cne $ReviewedPlanSha256 -or $record.planMetadataSha256 -cne $ReviewedPlanMetadataSha256 -or
      $record.sourceSha -cne $SourceSha -or $record.accountId -cne $ExpectedAccountId -or
      (ConvertTo-D2RuntimeUtc $record.consumedAt) -gt [datetime]::UtcNow) { throw 'D2RuntimePauseAlreadyConsumed' }
}
function Assert-D2ReleaseReviewedBytes {
  # Repeat hashes after potentially slow native/network reads and immediately before mutation or
  # trusted proof emission. These are fixed reviewed paths, never ambient glob-selected inputs.
  $pairs = @(@($BaselinePlanPath,$ReviewedBaselineSha256),@($BaselineMetadataPath,$ReviewedBaselineMetadataSha256))
  if ($Action -cne 'Plan') { $pairs += @(@($PlanPath,$ReviewedPlanSha256),@("$PlanPath.d2-runtime-release.json",$ReviewedPlanMetadataSha256)) }
  if ($Transition -cne 'Pause') { $pairs += @(@($PauseReceiptPath,$ReviewedPauseReceiptSha256),@($WorkerReceiptPath,$ReviewedWorkerReceiptSha256)) }
  if ($Transition -ceq 'Resume') { $pairs += @(@($GatewayReceiptPath,$ReviewedGatewayReceiptSha256),@($MigrationReceiptPath,$ReviewedMigrationReceiptSha256)) }
  if ($Action -ceq 'Verify') { $pairs += ,@("$PlanPath.applied.json",$ReviewedApplyReceiptSha256) }
  foreach ($pair in $pairs) {
    $path = Resolve-D2ReleasePath $pair[0] -Existing
    if ($pair[1] -cnotmatch '^[a-f0-9]{64}$' -or (Get-D2ReleaseFileHash $path) -cne $pair[1]) { throw 'D2RuntimeReviewedEvidenceChanged' }
  }
}
function Assert-D2ReleaseAppliedReceipt {
  param([object]$Receipt,[object]$State,[object]$Metadata,[string]$PlanFile)
  Assert-ExactObjectKeys $Receipt @('schemaVersion','kind','transition','sourceSha','accountId','stateBucket','stateLineage',
    'beforeStateSerial','stateSerial','planSha256','planMetadataSha256','attemptSha256','consumptionSha256','appliedAt') 'D2 applied receipt'
  if ($Receipt.schemaVersion -ne 1 -or $Receipt.kind -cne 'development-d2-runtime-applied' -or
      $Receipt.transition -cne $Transition -or $Receipt.sourceSha -cne $SourceSha -or $Receipt.accountId -cne $ExpectedAccountId -or
      $Receipt.stateBucket -cne $StateBucket -or $Receipt.stateLineage -cne $State.Lineage -or
      ($Receipt.stateSerial -isnot [int] -and $Receipt.stateSerial -isnot [long]) -or
      $Receipt.beforeStateSerial -ne $Metadata.stateSerial -or $Receipt.stateSerial -le $Receipt.beforeStateSerial -or
      $Receipt.stateSerial -ne $State.Serial -or $Receipt.planSha256 -cne $ReviewedPlanSha256 -or
      $Receipt.planMetadataSha256 -cne $ReviewedPlanMetadataSha256 -or $Receipt.attemptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      (ConvertTo-D2RuntimeUtc $Receipt.appliedAt) -gt [datetime]::UtcNow) { throw 'D2RuntimeAppliedReceiptMismatch' }
  $attempt = Read-D2ReleaseEvidence "$PlanFile.apply-attempt.json" $Receipt.attemptSha256
  Assert-ExactObjectKeys $attempt @('schemaVersion','kind','transition','sourceSha','accountId','stateBucket','stateLineage',
    'stateSerial','planSha256','planMetadataSha256','beforeControlSha256','attemptedAt') 'D2 apply attempt'
  if ($attempt.schemaVersion -ne 1 -or $attempt.kind -cne 'development-d2-runtime-apply-attempt' -or
      $attempt.transition -cne $Transition -or $attempt.sourceSha -cne $SourceSha -or $attempt.accountId -cne $ExpectedAccountId -or
      $attempt.stateBucket -cne $StateBucket -or $attempt.stateLineage -cne $State.Lineage -or $attempt.stateSerial -ne $Receipt.beforeStateSerial -or
      $attempt.planSha256 -cne $ReviewedPlanSha256 -or $attempt.planMetadataSha256 -cne $ReviewedPlanMetadataSha256 -or
      $attempt.beforeControlSha256 -cne $Metadata.beforeControlSha256 -or
      (ConvertTo-D2RuntimeUtc $attempt.attemptedAt) -gt (ConvertTo-D2RuntimeUtc $Receipt.appliedAt)) { throw 'D2RuntimeApplyAttemptMismatch' }
  if ($Transition -ceq 'Resume') {
    Assert-D2ReleasePauseConsumption
    if ($Receipt.consumptionSha256 -cne (Get-D2ReleaseFileHash (Get-D2ReleaseConsumptionPath))) { throw 'D2RuntimeConsumptionReceiptChanged' }
  } elseif ($Receipt.consumptionSha256 -cne '') { throw 'D2RuntimeUnexpectedConsumptionReceipt' }
}

# There is deliberately no automatic Apply, Resume, task invocation, version deletion, or rollback.
# Any out-of-band alias/trigger/reservation change invalidates the cutoff: establish a new verified
# pause and wait the entire retirement window. Current metrics cannot prove uninterrupted fencing.
$savedEnvironment = @{}
foreach ($name in @('AWS_PROFILE','AWS_REGION','AWS_DEFAULT_REGION','AWS_PAGER','TF_DATA_DIR')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$savedVariables = @{}
foreach ($entry in Get-ChildItem Env: | Where-Object { $_.Name -imatch '^TF_VAR_' }) { $savedVariables[$entry.Name] = $entry.Value }
try {
  Assert-D2ReleaseSource
  foreach ($name in $savedVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $env:AWS_PROFILE = $AwsProfile; $env:AWS_REGION = $region; $env:AWS_DEFAULT_REGION = $region; $env:AWS_PAGER = ''
  Initialize-D2ReleaseBackend
  Set-D2ReleasePrivateDirectory $operatorRoot
  $baseline = Read-D2ReleaseBaseline
  $state = Read-D2ReleaseState
  if ($state.Lineage -cne $baseline.Metadata.StateLineage -or
      ($Action -cne 'Verify' -and $state.Serial -ne $baseline.Metadata.StateSerial) -or
      ($Action -ceq 'Verify' -and $state.Serial -le [long]$baseline.Metadata.StateSerial)) { throw 'D2RuntimeBaselineStateMoved' }
  $prerequisites = Read-D2ReleasePrerequisites $state $baseline.Plan.variables
  $targetVariables = New-D2RuntimeReleaseVariables $baseline.Plan.variables $Transition $prerequisites.Artifact
  $snapshotVariables = if ($Action -ceq 'Verify') { $targetVariables } else { $baseline.Plan.variables }
  $snapshot = Get-D2ReleaseLiveSnapshot $state $snapshotVariables
  $evidenceHashes = [ordered]@{ baseline = $ReviewedBaselineSha256; baselineMetadata = $ReviewedBaselineMetadataSha256
    worker = $ReviewedWorkerReceiptSha256; gateway = $ReviewedGatewayReceiptSha256
    migration = $ReviewedMigrationReceiptSha256; pause = $ReviewedPauseReceiptSha256 }
  if ($Action -ceq 'Plan') {
    if ($ReviewedPlanSha256 -or $ReviewedPlanMetadataSha256 -or $ReviewedApplyReceiptSha256) { throw 'D2RuntimeUnexpectedPlanReview' }
    if (-not $PlanPath) { $PlanPath = Join-Path $operatorRoot ("$($Transition.ToLowerInvariant())-$SourceSha-$([guid]::NewGuid().ToString('N')).tfplan") }
    $planFile = Resolve-D2ReleasePath $PlanPath -Output
    if ((Test-Path -LiteralPath $planFile) -or (Test-Path -LiteralPath "$planFile.d2-runtime-release.json")) { throw 'D2RuntimePlanOverwriteRejected' }
    Set-D2ReleaseVariables $targetVariables
    $result = Invoke-D2ReleaseTerraform @('plan','-input=false','-refresh=true','-lock-timeout=5m','-detailed-exitcode',"-out=$planFile") @(2)
    $generatedPlanSha = Get-D2ReleaseFileHash $planFile
    $plan = Read-DeploymentTerraformPlan -Path $planFile -TerraformDirectory $terraformDirectory
    $null = Assert-D2RuntimeReleasePlan $plan $baseline.Plan $Transition $prerequisites.Artifact
    $afterPlan = Read-D2ReleaseState
    if ($afterPlan.Lineage -cne $state.Lineage -or $afterPlan.Serial -ne $state.Serial) { throw 'D2RuntimeStateMovedDuringPlan' }
    $metadata = [ordered]@{ schemaVersion = 1; kind = 'development-d2-runtime-release-plan'; transition = $Transition
      accountId = $ExpectedAccountId; region = $region; stateBucket = $StateBucket; sourceSha = $SourceSha
      stateLineage = $state.Lineage; stateSerial = $state.Serial; planSha256 = $generatedPlanSha
      evidenceHashes = $evidenceHashes; authoritySha256 = Get-D2RuntimeAuthorityDigest $targetVariables
      beforeControlSha256 = $snapshot.controlSha256; oldMaximumTimeoutSeconds = $snapshot.oldMaximumTimeoutSeconds
      createdAt = [datetime]::UtcNow.ToString('o') }
    $metadataPath = "$planFile.d2-runtime-release.json"
    Assert-D2ReleaseReviewedBytes
    Assert-D2ReleaseSource
    if ((Get-D2ReleaseFileHash $planFile) -cne $generatedPlanSha) { throw 'D2RuntimeGeneratedPlanChanged' }
    Write-D2ReleaseEvidence $metadataPath $metadata
    Write-Output ([pscustomobject]@{ phase = 'planned'; transition = $Transition; sourceSha = $SourceSha
      planPath = $planFile; planSha256 = $metadata.planSha256; metadataSha256 = Get-D2ReleaseFileHash $metadataPath } | ConvertTo-Json -Compress)
  } else {
    $planFile = Resolve-D2ReleasePath $PlanPath -Existing -Output
    $metadata = Read-D2ReleaseEvidence "$planFile.d2-runtime-release.json" $ReviewedPlanMetadataSha256
    Assert-ExactObjectKeys $metadata @('schemaVersion','kind','transition','accountId','region','stateBucket','sourceSha',
      'stateLineage','stateSerial','planSha256','evidenceHashes','authoritySha256','beforeControlSha256','oldMaximumTimeoutSeconds','createdAt') 'D2 release plan metadata'
    if ($ReviewedPlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-D2ReleaseFileHash $planFile) -cne $ReviewedPlanSha256 -or
        $metadata.planSha256 -cne $ReviewedPlanSha256 -or $metadata.schemaVersion -ne 1 -or
        $metadata.kind -cne 'development-d2-runtime-release-plan' -or $metadata.transition -cne $Transition -or
        $metadata.accountId -cne $ExpectedAccountId -or $metadata.region -cne $region -or $metadata.stateBucket -cne $StateBucket -or
        $metadata.sourceSha -cne $SourceSha -or $metadata.stateLineage -cne $state.Lineage -or
        $metadata.stateSerial -ne $baseline.Metadata.StateSerial -or
        (Get-D2RuntimeDigest $metadata.evidenceHashes) -cne (Get-D2RuntimeDigest $evidenceHashes) -or
        $metadata.authoritySha256 -cne (Get-D2RuntimeAuthorityDigest $targetVariables) -or
        (ConvertTo-D2RuntimeUtc $metadata.createdAt) -gt [datetime]::UtcNow -or
        $metadata.oldMaximumTimeoutSeconds -lt $snapshot.oldMaximumTimeoutSeconds -or
        ($Action -ceq 'Apply' -and $metadata.beforeControlSha256 -cne $snapshot.controlSha256)) { throw 'D2RuntimePlanReviewMismatch' }
    $plan = Read-DeploymentTerraformPlan -Path $planFile -TerraformDirectory $terraformDirectory
    $null = Assert-D2RuntimeReleasePlan $plan $baseline.Plan $Transition $prerequisites.Artifact
    if ($Action -ceq 'Verify') {
      $appliedReceipt = Read-D2ReleaseEvidence "$planFile.applied.json" $ReviewedApplyReceiptSha256
      Assert-D2ReleaseAppliedReceipt $appliedReceipt $state $metadata $planFile
    } elseif ($ReviewedApplyReceiptSha256) { throw 'D2RuntimeUnexpectedAppliedReview' }
    Set-D2ReleaseVariables $targetVariables
    if ($Action -ceq 'Apply') {
      Assert-D2ReleaseSource
      $current = Read-D2ReleaseState
      if ($current.Lineage -cne $state.Lineage -or $current.Serial -ne $state.Serial) { throw 'D2RuntimeStateMovedBeforeApply' }
      $lateSnapshot = Get-D2ReleaseLiveSnapshot $current $baseline.Plan.variables
      if ($lateSnapshot.controlSha256 -cne $snapshot.controlSha256) { throw 'D2RuntimeControlsMovedBeforeApply' }
      $lateState = Read-D2ReleaseState
      if ($lateState.Lineage -cne $state.Lineage -or $lateState.Serial -ne $state.Serial) { throw 'D2RuntimeStateMovedBeforeApply' }
      Assert-D2ReleaseSource
      Assert-D2ReleaseReviewedBytes
      $attemptPath = "$planFile.apply-attempt.json"; $appliedPath = "$planFile.applied.json"
      if ((Test-Path -LiteralPath $attemptPath) -or (Test-Path -LiteralPath $appliedPath)) { throw 'D2RuntimePriorApplyAttemptRequiresRecovery' }
      Write-D2ReleaseEvidence $attemptPath ([ordered]@{ schemaVersion = 1; kind = 'development-d2-runtime-apply-attempt'
          transition = $Transition; sourceSha = $SourceSha; accountId = $ExpectedAccountId; stateBucket = $StateBucket
          stateLineage = $state.Lineage; stateSerial = $state.Serial; planSha256 = $ReviewedPlanSha256
          planMetadataSha256 = $ReviewedPlanMetadataSha256; beforeControlSha256 = $snapshot.controlSha256; attemptedAt = [datetime]::UtcNow.ToString('o') })
      $consumptionSha = ''
      if ($Transition -ceq 'Resume') {
        $consumptionPath = Get-D2ReleaseConsumptionPath
        Write-D2ReleaseEvidence $consumptionPath ([ordered]@{ schemaVersion = 1; kind = 'development-d2-runtime-pause-consumed'
            pauseReceiptSha256 = $ReviewedPauseReceiptSha256; planSha256 = $ReviewedPlanSha256; planMetadataSha256 = $ReviewedPlanMetadataSha256
            sourceSha = $SourceSha; accountId = $ExpectedAccountId; consumedAt = [datetime]::UtcNow.ToString('o') })
        $consumptionSha = Get-D2ReleaseFileHash $consumptionPath
      }
      $null = Invoke-D2ReleaseTerraform @('apply','-input=false','-lock-timeout=5m',$planFile)
      $appliedState = Read-D2ReleaseState
      if ($appliedState.Lineage -cne $state.Lineage -or $appliedState.Serial -le $state.Serial) { throw 'D2RuntimeApplyOutcomeRequiresRecovery' }
      Write-D2ReleaseEvidence $appliedPath ([ordered]@{ schemaVersion = 1; kind = 'development-d2-runtime-applied'
          transition = $Transition; sourceSha = $SourceSha; accountId = $ExpectedAccountId; stateBucket = $StateBucket
          stateLineage = $appliedState.Lineage; beforeStateSerial = $state.Serial; stateSerial = $appliedState.Serial
          planSha256 = $ReviewedPlanSha256; planMetadataSha256 = $ReviewedPlanMetadataSha256
          attemptSha256 = Get-D2ReleaseFileHash $attemptPath; consumptionSha256 = $consumptionSha; appliedAt = [datetime]::UtcNow.ToString('o') })
      Write-Output ([pscustomobject]@{ phase = 'applied-not-yet-verified'; transition = $Transition; sourceSha = $SourceSha
        planSha256 = $ReviewedPlanSha256; applyReceiptSha256 = Get-D2ReleaseFileHash $appliedPath } | ConvertTo-Json -Compress)
    } else {
      $capturePath = "$planFile.verified-baseline.tfplan"
      if (Test-Path -LiteralPath $capturePath) { throw 'D2RuntimeVerifiedEvidenceAlreadyExists' }
      $null = Invoke-D2ReleaseTerraform @('plan','-input=false','-refresh=true','-lock-timeout=5m','-detailed-exitcode',"-out=$capturePath") @(0)
      $captureSha = Get-D2ReleaseFileHash $capturePath
      $capture = Read-DeploymentTerraformPlan -Path $capturePath -TerraformDirectory $terraformDirectory
      $null = Assert-RetainedGatewayBaselinePlan $capture $baseline.Declared
      Assert-D2RuntimeVariablesEqual $capture.variables $targetVariables
      $finalState = Read-D2ReleaseState
      if ($finalState.Lineage -cne $state.Lineage -or $finalState.Serial -ne $state.Serial) { throw 'D2RuntimeStateMovedDuringVerify' }
      $finalSnapshot = Get-D2ReleaseLiveSnapshot $finalState $targetVariables
      if ($finalSnapshot.controlSha256 -cne $snapshot.controlSha256) { throw 'D2RuntimeControlsMovedDuringVerify' }
      $captureMetadata = New-CurrentDocumentBaselineMetadata -Plan $capture -PlanPath $capturePath -PlanSha256 $captureSha `
        -State $finalState -SourceSha $SourceSha -DocumentReleaseSourceSha $baseline.Metadata.DocumentReleaseSourceSha `
        -ReceiptSha256 $baseline.Metadata.ReceiptSha256 -AccountId $ExpectedAccountId -Region $region -RepositoryRoot $repositoryRoot
      $captureMetadataPath = "$capturePath.metadata.json"
      Assert-D2ReleaseSource
      Assert-D2ReleaseReviewedBytes
      Assert-D2ReleaseAppliedReceipt $appliedReceipt $finalState $metadata $planFile
      if ((Get-D2ReleaseFileHash $capturePath) -cne $captureSha) { throw 'D2RuntimeGeneratedBaselineChanged' }
      Write-D2ReleaseEvidence $captureMetadataPath $captureMetadata
      $pausePath = ''; $pauseSha = ''
      if ($Transition -ceq 'Pause') {
        $finalSnapshot.oldMaximumTimeoutSeconds = $metadata.oldMaximumTimeoutSeconds
        $pause = New-D2RuntimePauseReceipt $finalSnapshot (Get-D2ReleaseBinding $finalState $targetVariables $ReviewedPlanSha256) ([datetime]::UtcNow)
        $pausePath = "$planFile.pause.json"
        Write-D2ReleaseEvidence $pausePath $pause
        $pauseSha = Get-D2ReleaseFileHash $pausePath
      }
      Write-Output ([pscustomobject]@{ phase = 'verified'; transition = $Transition; sourceSha = $SourceSha
        baselinePath = $capturePath; baselineSha256 = $captureSha; baselineMetadataSha256 = Get-D2ReleaseFileHash $captureMetadataPath
        pauseReceiptPath = $pausePath; pauseReceiptSha256 = $pauseSha
        queueEmptyProven = $false; remainingMessages = $finalSnapshot.pendingMessages; inFlightMessages = $finalSnapshot.inFlightMessages } | ConvertTo-Json -Compress)
    }
  }
} finally {
  foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -imatch '^TF_VAR_' })) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
  foreach ($name in $savedVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $savedVariables[$name], 'Process') }
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
