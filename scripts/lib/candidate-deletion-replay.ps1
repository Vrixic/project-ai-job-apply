Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'staging-postgresql-restore-verifier.ps1')

$script:DeletionReplayConfigKeys = @(
  'schemaVersion','runId','accountId','region','sourceSha','restoreContextSha256',
  'sourceIdentifier','sourceDbiResourceId','sourceBoundarySha256','sourceHostname',
  'targetIdentifier','targetDbiResourceId','targetBoundarySha256','targetHostname',
  'databaseName','databasePort','restoreManifestSha256','acceptedPolicyCatalogSha256','issuedAt','expiresAt'
)
$script:DeletionReplayEnvironmentKeys = @(
  'NODE_ENV','RELEASE_SHA','DATABASE_SECRET_ID','CANDIDATE_DOCUMENT_BUCKET',
  'CANDIDATE_DELETION_RECOVERY_BUCKET','CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN',
  'RESTORE_REPLAY_CONFIG_JSON','RESTORE_REPLAY_CONFIG_SHA256'
)

function Get-DeletionReplaySha([string]$Text) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function ConvertTo-DeletionReplayCanonicalJson([object]$Value) {
  function Convert-Node([object]$Node) {
    if ($null -eq $Node -or $Node -is [string] -or $Node -is [ValueType]) { return $Node }
    if ($Node -is [Collections.IDictionary]) {
      $result = [ordered]@{}
      foreach ($key in @($Node.Keys | Sort-Object -CaseSensitive)) { $result[[string]$key] = Convert-Node $Node[$key] }
      return $result
    }
    if ($Node -is [Collections.IEnumerable]) { return ,@($Node | ForEach-Object { Convert-Node $_ }) }
    $result = [ordered]@{}
    foreach ($key in @($Node.PSObject.Properties.Name | Sort-Object -CaseSensitive)) { $result[$key] = Convert-Node $Node.$key }
    return $result
  }
  return ConvertTo-Json -InputObject (Convert-Node $Value) -Depth 80 -Compress
}

function Assert-DeletionReplayHash([string]$Path, [string]$ReviewedSha256) {
  if ($ReviewedSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-D1RestoreFileSha256 $Path) -cne $ReviewedSha256) { throw 'DeletionReplayReviewedBytesChanged' }
}

function Resolve-DeletionReplayPrivatePath([string]$Path, [string]$PrivateRoot, [switch]$MustExist) {
  $boundary = [IO.Path]::GetFullPath($PrivateRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($boundary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'DeletionReplayPrivatePathInvalid' }
  $probe = $resolved
  while ($probe) {
    if (Test-Path -LiteralPath $probe) {
      if (((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'DeletionReplayPrivatePathReparsePoint' }
    }
    $probe = Split-Path $probe -Parent
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'DeletionReplayPrivateFileMissing' }
  return $resolved
}

function Write-DeletionReplayPrivateJson([string]$Path, [object]$Value, [switch]$Replace) {
  if (-not $Replace -and (Test-Path -LiteralPath $Path)) { throw 'DeletionReplayEvidenceAlreadyExists' }
  $parent = Split-Path $Path -Parent
  $null = New-Item -ItemType Directory -Path $parent -Force
  if ($IsWindows) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $parent
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.Value) { throw 'DeletionReplayPrivateDirectoryOwnerChanged' }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($rule) }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($parent), $acl)
  }
  $text = (ConvertTo-Json -InputObject $Value -Depth 80) + "`n"
  $mode = if ($Replace) { [IO.FileMode]::Create } else { [IO.FileMode]::CreateNew }
  $stream = [IO.File]::Open($Path, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
}

function Get-DeletionReplayConfigJson([object]$Config, [datetimeoffset]$Now = [datetimeoffset]::UtcNow, [switch]$AllowExpired) {
  $keys = @($script:DeletionReplayConfigKeys)
  $primary = $null -ne $Config.PSObject.Properties['recoveryMode']
  if ($primary) { $keys += 'recoveryMode'; if ($Config.recoveryMode -cne 'primary_recovery') { throw 'DeletionReplayModeInvalid' } }
  Assert-D1RestoreExactObjectKeys $Config $keys 'DeletionReplayConfig'
  foreach ($key in $keys) {
    if ($key -in @('schemaVersion','databasePort')) {
      if (-not (Test-D1RestoreBoundedInteger $Config.$key)) { throw 'DeletionReplayConfigNumberInvalid' }
    } elseif ($Config.$key -isnot [string] -or $Config.$key.Length -gt 512) { throw 'DeletionReplayConfigStringInvalid' }
  }
  if ($Config.schemaVersion -cne 1 -or $Config.runId -cnotmatch '^[a-f0-9]{32}$' -or $Config.accountId -cnotmatch '^[0-9]{12}$' -or $Config.region -cne 'us-east-2' -or $Config.sourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'DeletionReplayConfigIdentityInvalid' }
  foreach ($key in @('restoreContextSha256','sourceBoundarySha256','targetBoundarySha256','restoreManifestSha256','acceptedPolicyCatalogSha256')) {
    if ($Config.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayConfigDigestInvalid' }
  }
  if ($Config.acceptedPolicyCatalogSha256 -cne '73f2705e6227b6ad597e4b57cd21683f2faff311029b31bddd27ad5ac4843d77') { throw 'DeletionReplayPolicyCatalogMismatch' }
  if ($Config.sourceIdentifier -cne 'ai-job-apply-development' -or $(if ($primary) { $Config.targetIdentifier -cne 'ai-job-apply-development' } else { $Config.targetIdentifier -cnotmatch '^ai-job-apply-development-restore-[0-9]{14}$' }) -or $Config.sourceDbiResourceId -cnotmatch '^db-[A-Z0-9]{8,63}$' -or $Config.targetDbiResourceId -cnotmatch '^db-[A-Z0-9]{8,63}$' -or $(if ($primary) { $Config.sourceDbiResourceId -cne $Config.targetDbiResourceId -or $Config.sourceBoundarySha256 -cne $Config.targetBoundarySha256 } else { $Config.sourceDbiResourceId -ceq $Config.targetDbiResourceId -or $Config.sourceBoundarySha256 -ceq $Config.targetBoundarySha256 }) -or $Config.restoreManifestSha256 -cne $(if ($primary) { '4eb3abc8d2b17290a4bf72f69fac27710bb7675fb5435fc63c393680659dd452' } else { 'd5c2b6d9f7204ef87c4798b2dbced4c96c1d2c3258dd6b06945a64ae17396fc5' })) { throw 'DeletionReplayDatabaseIdentityInvalid' }
  if ($Config.sourceHostname -cnotmatch '^ai-job-apply-development\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$' -or $Config.targetHostname -cnotmatch ('^' + [regex]::Escape($Config.targetIdentifier) + '\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$') -or $(if ($primary) { $Config.sourceHostname -cne $Config.targetHostname } else { $Config.sourceHostname -ceq $Config.targetHostname }) -or $Config.databasePort -ne 5432 -or $Config.databaseName -cne 'ai_job_apply') { throw 'DeletionReplayDatabaseEndpointInvalid' }
  foreach ($key in @('issuedAt','expiresAt')) { if ($Config.$key -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'DeletionReplayClockInvalid' } }
  $issued = [datetimeoffset]::ParseExact($Config.issuedAt,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
  $expires = [datetimeoffset]::ParseExact($Config.expiresAt,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
  if ($expires -le $issued -or ($expires - $issued).TotalSeconds -gt 1800 -or $issued -gt $Now -or (-not $AllowExpired -and $expires -lt $Now.AddSeconds(300))) { throw 'DeletionReplayClockExpiredOrInsufficient' }
  $ordered = [ordered]@{}
  foreach ($key in $keys) {
    if ([string]$Config.$key -match '[^\x20-\x7e]') { throw 'DeletionReplayNonAsciiConfig' }
    $ordered[$key] = $Config.$key
  }
  return ConvertTo-Json -InputObject $ordered -Depth 5 -Compress
}

function Get-DeletionReplayEnvironmentSha([object]$Environment) {
  $pairs = [Collections.Generic.List[object]]::new()
  foreach ($key in @($script:DeletionReplayEnvironmentKeys | Where-Object { $_ -cne 'RESTORE_REPLAY_CONFIG_SHA256' } | Sort-Object -CaseSensitive)) {
    $value = [string]$Environment.$key
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match '[^\x20-\x7e]') { throw 'DeletionReplayEnvironmentInvalid' }
    $pairs.Add(@($key,$value))
  }
  return Get-DeletionReplaySha ("candidate-deletion-restore-configuration-v1`n" + (ConvertTo-Json -InputObject $pairs.ToArray() -Depth 5 -Compress) + "`n")
}

function Assert-DeletionReplayEnvironment([object]$Environment, [datetimeoffset]$Now = [datetimeoffset]::UtcNow, [switch]$AllowExpired) {
  Assert-D1RestoreExactObjectKeys $Environment $script:DeletionReplayEnvironmentKeys 'DeletionReplayEnvironment'
  $config = ConvertFrom-D1RestoreJson $Environment.RESTORE_REPLAY_CONFIG_JSON
  if ((Get-DeletionReplayConfigJson $config $Now -AllowExpired:$AllowExpired) -cne $Environment.RESTORE_REPLAY_CONFIG_JSON -or (Get-DeletionReplayEnvironmentSha $Environment) -cne $Environment.RESTORE_REPLAY_CONFIG_SHA256) { throw 'DeletionReplayEnvironmentBindingInvalid' }
  $account = $config.accountId
  if ($Environment.NODE_ENV -cne 'production' -or $Environment.RELEASE_SHA -cnotmatch '^[a-f0-9]{64}$' -or $Environment.DATABASE_SECRET_ID -cnotmatch "^arn:aws:secretsmanager:us-east-2:$account`:secret:ai-job-apply/development/database-url-[A-Za-z0-9]{6}$" -or $Environment.CANDIDATE_DOCUMENT_BUCKET -cne "ai-job-apply-development-candidate-docs-$account" -or $Environment.CANDIDATE_DELETION_RECOVERY_BUCKET -cne "ai-job-apply-development-candidate-del-recovery-$account" -or $Environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN -cnotmatch "^arn:aws:kms:us-east-2:$account`:key/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$") { throw 'DeletionReplayEnvironmentResourceInvalid' }
  $bytes = 0
  foreach ($key in $script:DeletionReplayEnvironmentKeys) { $bytes += [Text.Encoding]::UTF8.GetByteCount($key + [string]$Environment.$key) }
  if ($bytes -gt 4096) { throw 'DeletionReplayEnvironmentTooLarge' }
  return $config
}

function Get-DeletionReplayRdsBoundaryJson([object]$Database) {
  # Same fixed projection as the maintained PITR operator; parity is regression-tested.
  return ([ordered]@{
    arn=[string]$Database.DBInstanceArn; resource=[string]$Database.DbiResourceId; address=[string]$Database.Endpoint.Address; port=[int]$Database.Endpoint.Port
    engine=[string]$Database.Engine; engine_version=[string]$Database.EngineVersion; instance_class=[string]$Database.DBInstanceClass; availability_zone=[string]$Database.AvailabilityZone
    auto_minor_upgrade=[bool]$Database.AutoMinorVersionUpgrade; storage_type=[string]$Database.StorageType; allocated_storage=[int]$Database.AllocatedStorage; max_allocated_storage=[int]$Database.MaxAllocatedStorage
    iops=[int]$Database.Iops; storage_throughput=[int]$Database.StorageThroughput; performance_insights=[bool]$Database.PerformanceInsightsEnabled; kms_key=[string]$Database.KmsKeyId
    iam_database_auth=[bool]$Database.IAMDatabaseAuthenticationEnabled; database_name=[string]$Database.DBName; master_username=[string]$Database.MasterUsername; network_type=[string]$Database.NetworkType
    ca_certificate=[string]$Database.CACertificateIdentifier; subnet_group=[string]$Database.DBSubnetGroup.DBSubnetGroupName; subnet_vpc=[string]$Database.DBSubnetGroup.VpcId
    security_groups=@($Database.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
    parameter_groups=@($Database.DBParameterGroups | ForEach-Object { "$([string]$_.DBParameterGroupName):$([string]$_.ParameterApplyStatus)" } | Sort-Object)
    option_groups=@($Database.OptionGroupMemberships | ForEach-Object { "$([string]$_.OptionGroupName):$([string]$_.Status)" } | Sort-Object)
    log_exports=@($Database.EnabledCloudwatchLogsExports | Sort-Object)
  } | ConvertTo-Json -Depth 5 -Compress)
}

function Assert-DeletionReplayRds([object]$Source, [object]$Target, [object]$Context, [object]$TargetTags, [string]$AccountId) {
  if ($Context.verified -ne $true -or $Context.target_boundary_authenticated -ne $true -or $Context.source_identifier -cne 'ai-job-apply-development' -or $Context.target_identifier -cnotmatch '^ai-job-apply-development-restore-[a-z0-9-]+$') { throw 'DeletionReplayRestoreNotVerified' }
  foreach ($side in @('source','target')) {
    $database = if ($side -ceq 'source') { $Source } else { $Target }
    if ($database.DBInstanceIdentifier -cne $Context."${side}_identifier" -or $database.DBInstanceArn -cne "arn:aws:rds:us-east-2:$AccountId`:db:$($Context."${side}_identifier")" -or $database.DBInstanceArn -cne $Context."${side}_resource_arn" -or $database.DbiResourceId -cne $Context."${side}_dbi_resource_id" -or (Get-DeletionReplaySha (Get-DeletionReplayRdsBoundaryJson $database)) -cne $Context."${side}_boundary_sha256" -or $database.DBInstanceStatus -cne 'available' -or $database.PubliclyAccessible -ne $false -or $database.StorageEncrypted -ne $true) { throw 'DeletionReplayRdsBoundaryChanged' }
  }
  if ($Source.DeletionProtection -ne $true -or $Source.BackupRetentionPeriod -ne 35 -or $Target.DeletionProtection -ne $false -or $Target.MultiAZ -ne $false -or $Target.DbiResourceId -ceq $Source.DbiResourceId -or $Target.Endpoint.Address -ceq $Source.Endpoint.Address) { throw 'DeletionReplayRdsSafetyInvalid' }
  $expected = @{Project='ai-job-apply';Environment='development';ManagedBy='restore-drill';Purpose='d1-current-isolated-restore';StartedAt=[string]$Context.started_at}
  if (@(Get-D1RestoreTagMismatchNames $TargetTags $expected).Count -ne 0) { throw 'DeletionReplayRestoreTagsChanged' }
}

function Assert-DeletionReplayArtifact([object]$Manifest, [string]$SourceSha, [string]$ZipPath, [string]$SbomPath) {
  Assert-D1RestoreExactObjectKeys $Manifest @('schemaVersion','sourceSha','runtime','architecture','handlers','artifact','artifactBytes','artifactSha256','artifactBase64Sha256','bundleSha256','sbom','sbomSha256','componentCount') 'DeletionReplayArtifact'
  if ($Manifest.schemaVersion -ne 2 -or $Manifest.sourceSha -cne $SourceSha -or $Manifest.runtime -cne 'nodejs24.x' -or $Manifest.architecture -cne 'x86_64' -or @($Manifest.handlers).Count -ne 1 -or $Manifest.handlers[0] -cne 'index.handler' -or $Manifest.artifact -cne 'candidate-deletion-restore-lambda.zip' -or $Manifest.sbom -cne 'candidate-deletion-restore-lambda.cdx.json' -or (Get-Item -LiteralPath $ZipPath).Length -ne $Manifest.artifactBytes) { throw 'DeletionReplayArtifactInvalid' }
  Assert-DeletionReplayHash $ZipPath $Manifest.artifactSha256
  Assert-DeletionReplayHash $SbomPath $Manifest.sbomSha256
  if ([Convert]::ToBase64String([Convert]::FromHexString($Manifest.artifactSha256)) -cne $Manifest.artifactBase64Sha256) { throw 'DeletionReplayArtifactEncodingInvalid' }
}

function Assert-DeletionReplayFunction([object]$Function, [object]$Preparation, [string]$Version, [int]$Concurrency = 1, [switch]$AllowUnready) {
  $config = $Function.Configuration
  $expected = $Preparation.createRequest
  $updateStatus = if ($config.PSObject.Properties.Name -contains 'LastUpdateStatus') { [string]$config.LastUpdateStatus } else { '' }
  $ready = if ($AllowUnready) { $config.State -cin @('Active','Pending','Failed','Inactive') -and $updateStatus -cin @('Successful','InProgress','Failed','') -and $Concurrency -in @(-1,0,1) } else { $config.State -ceq 'Active' -and $updateStatus -ceq 'Successful' -and $Concurrency -eq 1 }
  if ($config.FunctionName -cne $expected.FunctionName -or $config.FunctionArn -cne "arn:aws:lambda:us-east-2:$($Preparation.accountId):function:$($expected.FunctionName):$Version" -or $config.Version -cne $Version -or $Version -cnotmatch '^[1-9][0-9]{0,9}$' -or $config.Role -cne $expected.Role -or $config.Runtime -cne 'nodejs24.x' -or $config.Handler -cne 'index.handler' -or $config.MemorySize -ne 512 -or $config.Timeout -ne 300 -or ($config.Architectures -join ',') -cne 'x86_64' -or $config.CodeSha256 -cne $Preparation.artifactBase64Sha256 -or -not $ready -or ($config.PSObject.Properties.Name -contains 'KMSKeyArn' -and -not [string]::IsNullOrEmpty($config.KMSKeyArn))) { throw 'DeletionReplayFunctionBoundaryChanged' }
  if ((ConvertTo-DeletionReplayCanonicalJson $config.Environment.Variables) -cne (ConvertTo-DeletionReplayCanonicalJson $expected.Environment.Variables) -or (@($config.Layers.Arn) -join ',') -cne (@($expected.Layers) -join ',') -or (@($config.VpcConfig.SubnetIds | Sort-Object) -join ',') -cne (@($expected.VpcConfig.SubnetIds | Sort-Object) -join ',') -or (@($config.VpcConfig.SecurityGroupIds | Sort-Object) -join ',') -cne (@($expected.VpcConfig.SecurityGroupIds | Sort-Object) -join ',') -or $config.LoggingConfig.LogGroup -cne $expected.LoggingConfig.LogGroup) { throw 'DeletionReplayFunctionConfigurationChanged' }
  foreach ($name in @($expected.Tags.PSObject.Properties.Name)) { if ($Function.Tags.$name -cne $expected.Tags.$name) { throw 'DeletionReplayFunctionTagsChanged' } }
}

function Get-DeletionReplayCleanupReadyAt([object]$InvocationJournal) {
  if ($null -eq $InvocationJournal) { return [datetimeoffset]::MinValue }
  if ($InvocationJournal.schemaVersion -ne 1 -or $InvocationJournal.status -cnotin @('started','completed','ambiguous')) { throw 'DeletionReplayInvocationJournalInvalid' }
  return ([datetimeoffset]::Parse($InvocationJournal.startedAt)).AddSeconds(330)
}

function Get-DeletionReplayBaselineMode([object]$Preparation) {
  $property = $Preparation.PSObject.Properties['baselineMode']
  if ($null -eq $property) { return 'steady-state' }
  if ($property.Value -isnot [string] -or $property.Value -cnotin @('steady-state','dark-recovery','primary-recovery')) { throw 'DeletionReplayBaselineModeInvalid' }
  return $property.Value
}

function Assert-DeletionReplayPreparation([object]$Preparation) {
  $mode = Get-DeletionReplayBaselineMode $Preparation
  $keys = @('schemaVersion','kind','runId','accountId','sourceSha','stateBucket','runtimePlanPath','runtimePlanSha256','configurationSha256','artifactBucket','artifactKey','artifactSha256','artifactBase64Sha256','roleBoundary','createRequest','fileBindings')
  if ($null -ne $Preparation.PSObject.Properties['baselineMode']) { $keys += 'baselineMode' }
  Assert-D1RestoreExactObjectKeys $Preparation $keys 'DeletionReplayPreparation'
  $create = $Preparation.createRequest
  Assert-D1RestoreExactObjectKeys $create @('FunctionName','Runtime','Role','Handler','Description','Timeout','MemorySize','Publish','Architectures','Layers','VpcConfig','Environment','LoggingConfig','Tags') 'DeletionReplayCreateRequest'
  Assert-D1RestoreExactObjectKeys $create.VpcConfig @('SubnetIds','SecurityGroupIds') 'DeletionReplayVpcConfiguration'
  Assert-D1RestoreExactObjectKeys $create.Environment @('Variables') 'DeletionReplayFunctionEnvironment'
  Assert-D1RestoreExactObjectKeys $create.LoggingConfig @('LogFormat','LogGroup') 'DeletionReplayLoggingConfiguration'
  Assert-D1RestoreExactObjectKeys $create.Tags @('Project','Environment','ManagedBy','Purpose','RunId','ConfigurationSha256','SourceSha') 'DeletionReplayFunctionTags'
  if ($Preparation.schemaVersion -ne 1 -or $Preparation.kind -cne 'candidate-deletion-restore-preparation' -or $Preparation.runId -cnotmatch '^[a-f0-9]{32}$' -or $Preparation.accountId -cnotmatch '^[0-9]{12}$' -or $Preparation.sourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'DeletionReplayPreparationIdentityInvalid' }
  if ($create.FunctionName -cne "ai-job-apply-development-replay-$($Preparation.runId)" -or $create.FunctionName.Length -gt 64 -or $create.Role -cne "arn:aws:iam::$($Preparation.accountId):role/ai-job-apply-development-deletion-restore" -or $create.Role -cne $Preparation.roleBoundary.roleArn -or $create.Runtime -cne 'nodejs24.x' -or $create.Handler -cne 'index.handler' -or $create.Description -cne 'Temporary private isolated restore deletion replay' -or $create.Timeout -ne 300 -or $create.MemorySize -ne 512 -or $create.Publish -isnot [bool] -or -not $create.Publish -or (@($create.Architectures) -join ',') -cne 'x86_64' -or $create.LoggingConfig.LogFormat -cne 'JSON' -or $create.LoggingConfig.LogGroup -cne '/ai-job-apply/development/application') { throw 'DeletionReplayCreateRequestInvalid' }
  if ($create.Tags.Project -cne 'ai-job-apply' -or $create.Tags.Environment -cne 'development' -or $create.Tags.ManagedBy -cne 'restore-drill' -or $create.Tags.Purpose -cne 'candidate-deletion-restore' -or $create.Tags.RunId -cne $Preparation.runId -or $create.Tags.ConfigurationSha256 -cne $Preparation.configurationSha256 -or $create.Tags.SourceSha -cne $Preparation.sourceSha) { throw 'DeletionReplayCreateTagsInvalid' }
  $environment = $create.Environment.Variables
  $config = ConvertFrom-D1RestoreJson $environment.RESTORE_REPLAY_CONFIG_JSON
  if ($config.accountId -cne $Preparation.accountId -or $config.runId -cne $Preparation.runId -or $config.sourceSha -cne $Preparation.sourceSha -or $environment.RESTORE_REPLAY_CONFIG_SHA256 -cne $Preparation.configurationSha256 -or $environment.RELEASE_SHA -cne $Preparation.artifactSha256 -or $Preparation.artifactKey -cne "lambda/candidate-deletion-restore/$($Preparation.sourceSha)/$($Preparation.artifactSha256)/candidate-deletion-restore-lambda.zip" -or [Convert]::ToBase64String([Convert]::FromHexString($Preparation.artifactSha256)) -cne $Preparation.artifactBase64Sha256) { throw 'DeletionReplayPreparationArtifactBindingInvalid' }
  if (($mode -ceq 'primary-recovery') -ne ($null -ne $config.PSObject.Properties['recoveryMode'])) { throw 'DeletionReplayPreparationModeChanged' }
  $expectedFiles = if ($mode -in @('dark-recovery','primary-recovery')) { 11 } else { 8 }
  if (@($Preparation.fileBindings).Count -ne $expectedFiles) { throw 'DeletionReplayFileBindingInventoryInvalid' }
  foreach ($binding in @($Preparation.fileBindings)) {
    Assert-D1RestoreExactObjectKeys $binding @('path','sha256') 'DeletionReplayFileBinding'
    if ($binding.path -isnot [string] -or $binding.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayFileBindingInvalid' }
  }
}

function Assert-DeletionReplayPreservation([object]$Evidence) {
  Assert-D1RestoreExactObjectKeys $Evidence @('schemaVersion','unchanged','reconciled') 'DeletionReplayPreservation'
  if (-not (Test-D1RestoreBoundedInteger $Evidence.schemaVersion) -or $Evidence.schemaVersion -ne 1) { throw 'DeletionReplayPreservationVersionRejected' }
  foreach ($digest in @($Evidence.unchanged,$Evidence.reconciled)) {
    Assert-D1RestoreExactObjectKeys $digest @('sha256','relationCount','rowCount','byteCount') 'DeletionReplayDataDigest'
    if ($digest.sha256 -isnot [string] -or $digest.sha256 -cnotmatch '^[a-f0-9]{64}$' -or -not (Test-D1RestoreBoundedInteger $digest.relationCount) -or $digest.relationCount -ne 105 -or -not (Test-D1RestoreBoundedInteger $digest.rowCount) -or $digest.rowCount -gt 100000 -or -not (Test-D1RestoreBoundedInteger $digest.byteCount) -or $digest.byteCount -gt 67108864) { throw 'DeletionReplayDataDigestRejected' }
  }
  if ($Evidence.unchanged.rowCount -gt $Evidence.reconciled.rowCount -or $Evidence.unchanged.byteCount -gt $Evidence.reconciled.byteCount) { throw 'DeletionReplayPreservationScopeRejected' }
}

function Assert-DeletionReplayAggregate([object]$Response, [object]$Request, [object]$Config) {
  $keys = @('schemaVersion','action','outcome','runId','sourceSha','configurationSha256','functionVersion','expiresAt','markerSnapshotSha256','restoredPreflightSha256','inspectionSha256','markersValidated','historicalPolicyMarkers','currentPolicyMarkers','restoredSubjectsPresent','restoredSubjectsAbsent','documentKeysChecked','documentVersionsObserved')
  $counts = @('markersValidated','historicalPolicyMarkers','currentPolicyMarkers','restoredSubjectsPresent','restoredSubjectsAbsent','documentKeysChecked','documentVersionsObserved')
  if ($Request.action -ceq 'replay') {
    $keys += @('restoredUsersReconciled','restoredUsersAbsent','restoredUsersAlreadyReconciled','s3Writes','recoveryLedgerWrites','identityProviderCalls')
    $counts += @('restoredUsersReconciled','restoredUsersAbsent','restoredUsersAlreadyReconciled','s3Writes','recoveryLedgerWrites','identityProviderCalls')
    if ($null -ne $Response.PSObject.Properties['preservation']) {
      $keys += 'preservation'
      Assert-DeletionReplayPreservation $Response.preservation
    }
  }
  Assert-D1RestoreExactObjectKeys $Response $keys 'DeletionReplayAggregateResponse'
  if (-not (Test-D1RestoreBoundedInteger $Response.schemaVersion) -or $Response.schemaVersion -ne 1 -or $Response.action -cne $Request.action -or $Response.outcome -cne $(if ($Request.action -ceq 'replay') {'replayed'} else {'inspected'}) -or $Response.runId -cne $Config.runId -or $Response.configurationSha256 -cne $Request.configurationSha256 -or $Response.sourceSha -cne $Config.sourceSha -or $Response.functionVersion -cne $Request.functionVersion -or $Response.expiresAt -cne $Config.expiresAt) { throw 'DeletionReplayAggregateResponseRejected' }
  foreach ($key in @('markerSnapshotSha256','restoredPreflightSha256','inspectionSha256')) { if ($Response.$key -isnot [string] -or $Response.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayAggregateDigestRejected' } }
  foreach ($key in $counts) { if (-not (Test-D1RestoreBoundedInteger $Response.$key)) { throw 'DeletionReplayAggregateCountRejected' } }
  $digest = Get-DeletionReplaySha ("candidate-deletion-restore-inspection-v1`n" + (ConvertTo-Json -InputObject @($Request.configurationSha256,$Response.markerSnapshotSha256,$Response.restoredPreflightSha256) -Compress) + "`n")
  if ($Response.inspectionSha256 -cne $digest -or $Response.documentVersionsObserved -ne 0 -or ([long]$Response.historicalPolicyMarkers + [long]$Response.currentPolicyMarkers) -ne $Response.markersValidated -or ([long]$Response.restoredSubjectsPresent + [long]$Response.restoredSubjectsAbsent) -ne $Response.markersValidated) { throw 'DeletionReplayAggregateAlgebraRejected' }
  if ($Request.action -ceq 'replay' -and ($Response.s3Writes -ne 0 -or $Response.recoveryLedgerWrites -ne 0 -or $Response.identityProviderCalls -ne 0 -or $Response.inspectionSha256 -cne $Request.reviewedInspectionSha256 -or ([long]$Response.restoredUsersReconciled + [long]$Response.restoredUsersAlreadyReconciled) -ne $Response.restoredSubjectsPresent -or $Response.restoredUsersAbsent -ne $Response.restoredSubjectsAbsent)) { throw 'DeletionReplaySideEffectsOrInspectionMismatch' }
}

# This diagnostic result is not compatible with an Inspect/Replay approval receipt.
function Assert-DeletionReplayCompletionDiagnosis([object]$Response, [object]$Request, [object]$Config) {
  Assert-D1RestoreExactObjectKeys $Request @('schemaVersion','action','runId','configurationSha256','functionVersion') 'DeletionReplayDiagnosisRequest'
  Assert-D1RestoreExactObjectKeys $Response @('schemaVersion','action','outcome','runId','sourceSha','configurationSha256','functionVersion','expiresAt','markerSnapshotSha256','markersValidated','comparison','reason','corroboration','candidate','dispatchEvidence','databaseWrites','s3Writes','recoveryLedgerWrites','identityProviderCalls') 'DeletionReplayDiagnosisResponse'
  foreach ($key in @('action','runId','configurationSha256','functionVersion')) { if ($Request.$key -isnot [string]) { throw 'DeletionReplayDiagnosisRequestRejected' } }
  if ($Request.configurationSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Request.functionVersion -cnotmatch '^[1-9][0-9]{0,9}$') { throw 'DeletionReplayDiagnosisRequestRejected' }
  if ($Request.action -cne 'diagnose_completion' -or -not (Test-D1RestoreBoundedInteger $Request.schemaVersion) -or $Request.schemaVersion -ne 1 -or $Request.runId -cne $Config.runId) { throw 'DeletionReplayDiagnosisRequestRejected' }
  foreach ($key in @('action','outcome','runId','sourceSha','configurationSha256','functionVersion','expiresAt','markerSnapshotSha256')) { if ($Response.$key -isnot [string]) { throw 'DeletionReplayDiagnosisResponseRejected' } }
  if (-not (Test-D1RestoreBoundedInteger $Response.schemaVersion) -or $Response.schemaVersion -ne 1 -or $Response.action -cne 'diagnose_completion' -or $Response.outcome -cnotin @('refused','consistent','persisted_candidate') -or $Response.runId -cne $Config.runId -or $Response.sourceSha -cne $Config.sourceSha -or $Response.configurationSha256 -cne $Request.configurationSha256 -or $Response.functionVersion -cne $Request.functionVersion -or $Response.expiresAt -cne $Config.expiresAt -or $Response.markerSnapshotSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayDiagnosisResponseRejected' }
  foreach ($key in @('markersValidated','databaseWrites','s3Writes','recoveryLedgerWrites','identityProviderCalls')) {
    $expected = if ($key -ceq 'markersValidated') { 1 } else { 0 }
    if (-not (Test-D1RestoreBoundedInteger $Response.$key) -or $Response.$key -ne $expected) { throw 'DeletionReplayDiagnosisCountRejected' }
  }
  $format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"
  if ($Response.expiresAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'DeletionReplayDiagnosisClockRejected' }
  $expires = [datetimeoffset]::ParseExact($Response.expiresAt,$format,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
  if ($null -ne $Response.dispatchEvidence) {
    $dispatch = $Response.dispatchEvidence
    Assert-D1RestoreExactObjectKeys $dispatch @('status','attemptCount','bindingSha256','latestCreatedAt','latestAcknowledgedAt') 'DeletionReplayDiagnosisDispatch'
    if ($dispatch.status -isnot [string] -or $dispatch.status -cne 'acknowledged_unclaimed' -or -not (Test-D1RestoreBoundedInteger $dispatch.attemptCount) -or $dispatch.attemptCount -lt 1 -or $dispatch.attemptCount -gt 3 -or $dispatch.bindingSha256 -isnot [array] -or $dispatch.bindingSha256.Count -ne $dispatch.attemptCount) { throw 'DeletionReplayDiagnosisDispatchRejected' }
    for ($index = 0; $index -lt $dispatch.bindingSha256.Count; $index++) {
      $binding = $dispatch.bindingSha256[$index]
      if ($binding -isnot [string] -or $binding -cnotmatch '^[a-f0-9]{64}\z' -or ($index -gt 0 -and [string]::CompareOrdinal($dispatch.bindingSha256[$index - 1],$binding) -ge 0)) { throw 'DeletionReplayDiagnosisDispatchRejected' }
    }
    foreach ($key in @('latestCreatedAt','latestAcknowledgedAt')) { if ($dispatch.$key -isnot [string] -or $dispatch.$key -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\z') { throw 'DeletionReplayDiagnosisDispatchRejected' } }
    $sqlFormat = "yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'"
    $created = [datetimeoffset]::ParseExact($dispatch.latestCreatedAt,$sqlFormat,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
    $acknowledged = [datetimeoffset]::ParseExact($dispatch.latestAcknowledgedAt,$sqlFormat,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
    if ($created -gt $acknowledged -or $acknowledged -gt $expires) { throw 'DeletionReplayDiagnosisDispatchRejected' }
  }
  if ($null -ne $Response.comparison) {
    Assert-D1RestoreExactObjectKeys $Response.comparison @('requestMatchesTag','ledgerMatchesTag','persistedPairAgrees','completionCollisions') 'DeletionReplayDiagnosisComparison'
    foreach ($key in @('requestMatchesTag','ledgerMatchesTag','persistedPairAgrees')) { if ($Response.comparison.$key -isnot [bool]) { throw 'DeletionReplayDiagnosisComparisonRejected' } }
    $predicates = $Response.comparison.completionCollisions
    if ($predicates -isnot [array] -or $predicates.Count -gt 5) { throw 'DeletionReplayDiagnosisComparisonRejected' }
    foreach ($predicate in $predicates) { if ($predicate -isnot [string] -or $predicate -cnotin @('request_completion_mismatch','request_timestamp_state_conflict','ledger_completion_mismatch','ledger_timestamp_state_conflict','backup_expiry_conflict')) { throw 'DeletionReplayDiagnosisComparisonRejected' } }
    if (@($predicates | Select-Object -Unique).Count -ne $predicates.Count) { throw 'DeletionReplayDiagnosisComparisonRejected' }
  }
  switch -CaseSensitive ($Response.outcome) {
    'refused' {
      if ($Response.reason -isnot [string] -or $Response.reason -cnotin @('input_invalid','proof_binding_mismatch','proof_expired','marker_invalid','row_cardinality','identity_binding_mismatch','historical_policy_mismatch','timestamp_invalid','timestamp_chronology','completion_state_conflict','persisted_completion_disagreement','nonterminal_state','owner_inventory_incomplete','operation_corroboration_missing','dispatch_corroboration_missing','durable_evidence_insufficient','retention_expired') -or $null -ne $Response.candidate -or $null -ne $Response.corroboration -or $null -ne $Response.dispatchEvidence) { throw 'DeletionReplayDiagnosisOutcomeRejected' }
    }
    'consistent' {
      if ($null -ne $Response.reason -or $null -ne $Response.candidate -or $null -ne $Response.corroboration -or $null -eq $Response.comparison -or -not $Response.comparison.requestMatchesTag -or -not $Response.comparison.ledgerMatchesTag -or -not $Response.comparison.persistedPairAgrees -or $Response.comparison.completionCollisions.Count -ne 0) { throw 'DeletionReplayDiagnosisOutcomeRejected' }
    }
    'persisted_candidate' {
      if ($null -ne $Response.reason -or $Response.corroboration -isnot [string] -or $Response.corroboration -cnotin @('persisted_transaction','persisted_transaction_and_dispatch','persisted_transaction_and_durable') -or $null -eq $Response.comparison -or $Response.comparison.requestMatchesTag -or $Response.comparison.ledgerMatchesTag -or -not $Response.comparison.persistedPairAgrees -or (@($Response.comparison.completionCollisions | Sort-Object -CaseSensitive) -join ',') -cne 'ledger_completion_mismatch,request_completion_mismatch') { throw 'DeletionReplayDiagnosisOutcomeRejected' }
      Assert-D1RestoreExactObjectKeys $Response.candidate @('correctedCompletedAt','evidenceSha256','candidateSha256') 'DeletionReplayDiagnosisCandidate'
      foreach ($key in @('evidenceSha256','candidateSha256')) { if ($Response.candidate.$key -isnot [string] -or $Response.candidate.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'DeletionReplayDiagnosisCandidateRejected' } }
      if ($Response.candidate.correctedCompletedAt -isnot [string] -or $Response.candidate.correctedCompletedAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'DeletionReplayDiagnosisCandidateRejected' }
      $completed = [datetimeoffset]::ParseExact($Response.candidate.correctedCompletedAt,$format,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
      if ($completed -gt $expires) { throw 'DeletionReplayDiagnosisClockRejected' }
    }
  }
}

function Get-DeletionReplayInvocationAction([string]$Action) {
  switch -CaseSensitive ($Action) {
    'Inspect' { return 'inspect' }
    'Replay' { return 'replay' }
    'DiagnoseCompletion' { return 'diagnose_completion' }
    default { throw 'DeletionReplayInvocationActionRejected' }
  }
}
