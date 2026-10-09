Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'deployment-operator-guards.ps1')
. (Join-Path $PSScriptRoot 'terraform-toolchain.ps1')

function Get-LegacyReceiptSha256([string]$Text) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
function Get-LegacyReceiptProperty($Value, [string]$Name) {
  if ($null -eq $Value) { return $null }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -ne $property) { return ,$property.Value }
  return $null
}
function Assert-LegacyReceiptEqual($Actual, $Expected, [string]$Boundary) {
  if ((ConvertTo-DeploymentCanonicalValue $Actual) -cne (ConvertTo-DeploymentCanonicalValue $Expected)) {
    throw "LegacyReceipt${Boundary}Mismatch"
  }
}
function Get-LegacyReceiptInstant([string]$Value) {
  if ($Value -cnotmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$') { throw 'LegacyReceiptTimestampInvalid' }
  return [DateTimeOffset]::ParseExact($Value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
}
function Assert-LegacyReceiptConfiguration($Configuration, [string]$Account, [DateTimeOffset]$Now) {
  $expected = @('schemaVersion','runId','sourceSha','imageDigest','accountId','region','databaseIdentifier',
    'databaseResourceId','databaseHostname','databaseName','databasePort','snapshotArn','snapshotCreatedAt',
    'encryptionKeyArn','expectedAppliedMigrations','expectedLegacyReceipts','issuedAt','expiresAt')
  Assert-LegacyReceiptEqual @($Configuration.PSObject.Properties.Name | Sort-Object) @($expected | Sort-Object) 'ConfigurationKeys'
  foreach ($name in $expected) {
    if ($name -cin @('schemaVersion','databasePort','expectedAppliedMigrations','expectedLegacyReceipts')) {
      if ($Configuration.$name -isnot [long] -and $Configuration.$name -isnot [int]) { throw 'LegacyReceiptConfigurationNumberInvalid' }
    } elseif ($Configuration.$name -isnot [string]) { throw 'LegacyReceiptConfigurationStringInvalid' }
  }
  $c = $Configuration
  if ($c.schemaVersion -ne 1 -or $c.runId -cnotmatch '^[a-f0-9]{32}$' -or $c.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or
      $c.imageDigest -cnotmatch '^[a-f0-9]{64}$' -or $Account -cnotmatch '^[0-9]{12}$' -or $c.accountId -cne $Account -or
      $c.region -cne 'us-east-2' -or $c.databaseIdentifier -cne 'ai-job-apply-development' -or
      $c.databaseResourceId -cnotmatch '^db-[A-Z0-9]{8,63}$' -or
      $c.databaseHostname -cnotmatch '^ai-job-apply-development\.[a-z0-9]{6,63}\.us-east-2\.rds\.amazonaws\.com$' -or
      $c.databaseName -cne 'ai_job_apply' -or $c.databasePort -ne 5432 -or
      $c.expectedAppliedMigrations -notin 3..8 -or $c.expectedLegacyReceipts -lt 1 -or $c.expectedLegacyReceipts -gt 1000 -or
      $c.snapshotArn -cnotmatch "^arn:aws:rds:us-east-2:${Account}:snapshot:ai-job-apply-development-[a-z0-9-]{1,180}$" -or
      $c.encryptionKeyArn -cnotmatch "^arn:aws:kms:us-east-2:${Account}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$") {
    throw 'LegacyReceiptConfigurationBindingInvalid'
  }
  $issued = Get-LegacyReceiptInstant $c.issuedAt
  $expires = Get-LegacyReceiptInstant $c.expiresAt
  $snapshot = Get-LegacyReceiptInstant $c.snapshotCreatedAt
  if ($expires -le $issued -or $expires -gt $issued.AddMinutes(30) -or $snapshot -gt $issued -or
      $snapshot -lt $issued.AddHours(-1) -or $Now -lt $issued -or $Now -ge $expires) { throw 'LegacyReceiptConfigurationExpiredOrInvalid' }
}
function Assert-LegacyReceiptRecoverySnapshot($Configuration, $Database, $Snapshot) {
  $c = $Configuration
  foreach ($flag in @('StorageEncrypted','DeletionProtection','PubliclyAccessible')) {
    if ($Database.$flag -isnot [bool]) { throw 'LegacyReceiptDatabaseBooleanInvalid' }
  }
  if ($Snapshot.Encrypted -isnot [bool]) { throw 'LegacyReceiptSnapshotBooleanInvalid' }
  if ($Database.DBInstanceIdentifier -cne $c.databaseIdentifier -or $Database.DbiResourceId -cne $c.databaseResourceId -or
      $Database.DBInstanceArn -cne "arn:aws:rds:us-east-2:$($c.accountId):db:$($c.databaseIdentifier)" -or
      $Database.DBInstanceStatus -cne 'available' -or $Database.StorageEncrypted -cne $true -or
      $Database.DeletionProtection -cne $true -or $Database.PubliclyAccessible -cne $false -or
      $Database.BackupRetentionPeriod -lt 7 -or -not $Database.LatestRestorableTime -or
      $Database.Endpoint.Address -cne $c.databaseHostname -or $Database.Endpoint.Port -ne $c.databasePort -or
      $Database.DBName -cne $c.databaseName -or $Snapshot.DBSnapshotArn -cne $c.snapshotArn -or
      $Snapshot.DBInstanceIdentifier -cne $c.databaseIdentifier -or $Snapshot.DbiResourceId -cne $c.databaseResourceId -or
      $Snapshot.Status -cne 'available' -or $Snapshot.SnapshotType -cne 'manual' -or $Snapshot.Encrypted -cne $true -or
      $Snapshot.KmsKeyId -cne $Database.KmsKeyId -or $Snapshot.KmsKeyId -cnotmatch "^arn:aws:kms:us-east-2:$($c.accountId):key/" -or
      ([DateTimeOffset]::Parse([string]$Snapshot.SnapshotCreateTime)).ToUniversalTime() -ne (Get-LegacyReceiptInstant $c.snapshotCreatedAt)) {
    throw 'LegacyReceiptRecoverySnapshotInvalid'
  }
}
function Assert-LegacyReceiptTask($Task, $Expected, [string]$Account, [string]$Image, [DateTimeOffset]$Now) {
  if ($Task.status -cne 'ACTIVE' -or $Task.family -cne 'ai-job-apply-development-legacy-receipt-transition' -or
      $Task.taskDefinitionArn -cne $Expected.arn -or $Task.taskRoleArn -cne "arn:aws:iam::${Account}:role/ai-job-apply-development-legacy-receipt-transition" -or
      $Task.executionRoleArn -cne "arn:aws:iam::${Account}:role/ai-job-apply-development-execution" -or
      $Task.networkMode -cne 'awsvpc' -or $Task.cpu -cne '256' -or $Task.memory -cne '512' -or
      $Task.runtimePlatform.cpuArchitecture -cne 'X86_64' -or $Task.runtimePlatform.operatingSystemFamily -cne 'LINUX' -or
      @($Task.containerDefinitions).Count -ne 1) { throw 'LegacyReceiptTaskBoundaryInvalid' }
  Assert-LegacyReceiptEqual @($Task.requiresCompatibilities) @('FARGATE') 'Compatibility'
  foreach ($field in @('enableFaultInjection','ipcMode','pidMode','volumes','placementConstraints','inferenceAccelerators','proxyConfiguration')) {
    $value = Get-LegacyReceiptProperty $Task $field
    if ($value -and @($value).Count) { throw 'LegacyReceiptTaskExtraAuthority' }
  }
  $storage = Get-LegacyReceiptProperty $Task 'ephemeralStorage'
  if ($storage -and $storage.sizeInGiB -ne 20) { throw 'LegacyReceiptUnexpectedEphemeralStorage' }
  foreach ($pair in @(@('taskRoleArn','task_role_arn'),@('executionRoleArn','execution_role_arn'),@('cpu','cpu'),@('memory','memory'),@('networkMode','network_mode'))) {
    Assert-LegacyReceiptEqual ([string]$Task.($pair[0])) ([string]$Expected.($pair[1])) 'TaskState'
  }
  $container = $Task.containerDefinitions[0]
  $expectedContainers = @($Expected.container_definitions | ConvertFrom-Json)
  if ($expectedContainers.Count -ne 1 -or $container.name -cne 'legacy-receipt-transition' -or
      $container.image -cne $Image -or $container.essential -isnot [bool] -or $container.readonlyRootFilesystem -isnot [bool] -or
      $container.essential -cne $true -or $container.readonlyRootFilesystem -cne $true) {
    throw 'LegacyReceiptContainerInvalid'
  }
  $expectedContainer = $expectedContainers[0]
  foreach ($property in $expectedContainer.PSObject.Properties) {
    if ($property.Name -cin @('environment','secrets')) {
      Assert-LegacyReceiptEqual @((Get-LegacyReceiptProperty $container $property.Name) | Sort-Object name) @($property.Value | Sort-Object name) 'ContainerState'
    } else { Assert-LegacyReceiptEqual (Get-LegacyReceiptProperty $container $property.Name) $property.Value 'ContainerState' }
  }
  foreach ($property in $container.PSObject.Properties) {
    if ($null -ne $expectedContainer.PSObject.Properties[$property.Name]) { continue }
    if ($property.Name -ceq 'cpu' -and $property.Value -eq 0) { continue }
    if ($property.Name -cin @('portMappings','mountPoints','volumesFrom','systemControls') -and @($property.Value).Count -eq 0) { continue }
    throw 'LegacyReceiptContainerExtraAuthority'
  }
  Assert-LegacyReceiptEqual @($container.command) @('applications/dist/src/run-legacy-receipt-transition.js') 'Command'
  $environment = @{}
  foreach ($entry in @($container.environment)) {
    if ($environment.ContainsKey($entry.name) -or $entry.value -isnot [string]) { throw 'LegacyReceiptEnvironmentAmbiguous' }
    $environment.Add($entry.name, $entry.value)
  }
  Assert-LegacyReceiptEqual @($environment.Keys | Sort-Object) @(@('NODE_ENV','LEGACY_RECEIPT_TRANSITION_ENABLED','LEGACY_RECEIPT_TRANSITION_CONFIG_JSON','LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256') | Sort-Object) 'Environment'
  if ($environment.NODE_ENV -cne 'production' -or $environment.LEGACY_RECEIPT_TRANSITION_ENABLED -cne 'true' -or
      $environment.LEGACY_RECEIPT_TRANSITION_CONFIG_JSON.Length -gt 4096 -or
      (Get-LegacyReceiptSha256 $environment.LEGACY_RECEIPT_TRANSITION_CONFIG_JSON) -cne $environment.LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256) { throw 'LegacyReceiptConfigurationHashInvalid' }
  $configuration = ConvertFrom-DeploymentTerraformJson $environment.LEGACY_RECEIPT_TRANSITION_CONFIG_JSON
  # Terraform emits sorted canonical JSON; duplicate keys or alternate spelling are not admitted.
  if ((ConvertTo-DeploymentCanonicalValue $configuration) -cne $environment.LEGACY_RECEIPT_TRANSITION_CONFIG_JSON) { throw 'LegacyReceiptConfigurationNotCanonical' }
  Assert-LegacyReceiptConfiguration $configuration $Account $Now
  if ($Image -cnotmatch "^${Account}\.dkr\.ecr\.us-east-2\.amazonaws\.com/ai-job-apply/migration@sha256:$($configuration.imageDigest)$") { throw 'LegacyReceiptImageInvalid' }
  if (@($container.secrets).Count -ne 1 -or $container.secrets[0].name -cne 'DATABASE_URL' -or
      $container.secrets[0].valueFrom -cnotmatch "^arn:aws:secretsmanager:us-east-2:${Account}:secret:ai-job-apply/development/database-url-[A-Za-z0-9]{6}$" -or
      $container.logConfiguration.logDriver -cne 'awslogs' -or
      $container.logConfiguration.options.'awslogs-region' -cne 'us-east-2' -or
      $container.logConfiguration.options.'awslogs-stream-prefix' -cne 'legacy-receipt-transition') { throw 'LegacyReceiptSecretOrLogInvalid' }
  return $configuration
}
function Assert-LegacyReceiptNoOverrides($Overrides) {
  if ($null -eq $Overrides) { return }
  foreach ($property in $Overrides.PSObject.Properties) {
    if ($property.Name -ceq 'containerOverrides') {
      $containers = @($property.Value)
      if ($containers.Count -eq 0) { continue }
      if ($containers.Count -ne 1) { throw 'LegacyReceiptOverridesRejected' }
      if ($containers[0].name -cne 'legacy-receipt-transition') { throw 'LegacyReceiptOverridesRejected' }
      foreach ($entry in $containers[0].PSObject.Properties) {
        if ($entry.Name -ceq 'name') { continue }
        if ($entry.Name -cnotin @('command','environment','environmentFiles','cpu','memory','memoryReservation','resourceRequirements') -or
            ($null -ne $entry.Value -and @($entry.Value).Count -ne 0)) { throw 'LegacyReceiptOverridesRejected' }
      }
    } elseif ($null -ne $property.Value -and @($property.Value).Count -ne 0) { throw 'LegacyReceiptOverridesRejected' }
  }
}
function Assert-LegacyReceiptTaskResult($Task, $Descriptor, $Messages) {
  if ($Task.taskArn -cne $Descriptor.taskArn -or $Task.taskDefinitionArn -cne $Descriptor.taskDefinitionArn -or
      $Task.clusterArn -cne $Descriptor.clusterArn -or $Task.startedBy -cne $Descriptor.runId -or
      $Task.launchType -cne 'FARGATE' -or $Task.lastStatus -cne 'STOPPED' -or
      $Task.enableExecuteCommand -isnot [bool] -or $Task.enableExecuteCommand -ne $false -or $Task.platformVersion -cne '1.4.0' -or
      @($Task.containers).Count -ne 1 -or $Task.containers[0].name -cne 'legacy-receipt-transition' -or
      ($Task.containers[0].exitCode -isnot [int] -and $Task.containers[0].exitCode -isnot [long]) -or
      $Task.containers[0].exitCode -ne 0 -or $Task.containers[0].imageDigest -cne "sha256:$($Descriptor.configuration.imageDigest)") {
    throw 'LegacyReceiptExecutionNotVerified'
  }
  Assert-LegacyReceiptNoOverrides (Get-LegacyReceiptProperty $Task 'overrides')
  if (@($Messages).Count -ne 1) { throw 'LegacyReceiptAggregateMissingOrAmbiguous' }
  $result = $Messages[0] | ConvertFrom-Json
  Assert-LegacyReceiptEqual $result ([pscustomobject]@{
    kind = 'legacy_receipt_transition_verified'; schemaVersion = 1; runId = $Descriptor.runId;
    sourceSha = $Descriptor.configuration.sourceSha; configurationSha256 = $Descriptor.configurationSha256;
    archivedReceipts = $Descriptor.configuration.expectedLegacyReceipts;
    appliedMigrations = $Descriptor.currentMigrationCount - $Descriptor.configuration.expectedAppliedMigrations
  }) 'Aggregate'
}
