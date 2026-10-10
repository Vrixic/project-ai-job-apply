Set-StrictMode -Version Latest
function ConvertTo-D1RestoreDarkBoolean {
  param([AllowNull()][object]$Value)
  if ($Value -is [bool]) { return $Value }
  if ($Value -is [string] -and $Value -ceq 'false') { return $false }
  if ($Value -is [string] -and $Value -ceq 'true') { return $true }
  throw 'Dark recovery requires canonical boolean inputs.'
}

function Assert-D1RestoreRecoveryMode {
  param([object]$Context, [string]$Environment, [bool]$DarkRecovery)
  if ($DarkRecovery -and $Environment -cne 'development') {
    throw 'Dark recovery is restricted to development.'
  }
  $property = $Context.PSObject.Properties['baseline_mode']
  $mode = if ($null -eq $property) { 'steady-state' } else { $property.Value }
  if ($mode -isnot [string] -or $mode -cnotin @('steady-state', 'dark-recovery') -or
      ($mode -ceq 'dark-recovery') -ne $DarkRecovery) {
    throw 'Restore context recovery mode does not match this invocation.'
  }
}

function Get-D1RestoreDarkValue {
  param([object]$Object, [string]$Name, [switch]$OptionalOff)
  $property = $Object.PSObject.Properties[$Name]
  # These callers name only optional(bool, false) fields in the root input schemas.
  if ($null -eq $property -and $OptionalOff) { return $false }
  if ($null -eq $property) { throw "Dark recovery input '$Name' is missing." }
  return ,$property.Value
}

function Assert-D1RestoreDarkWriterInputs {
  param([object]$Values)
  foreach ($name in @(
    'serverless_runtime_enabled', 'ingestion_runtime_enabled',
    'document_scan_mapping_enabled', 'document_scan_event_rule_enabled',
    'job_retention_enabled', 'job_retention_schedule_enabled',
    'privileged_audit_retention_enabled', 'privileged_audit_retention_schedule_enabled',
    'native_cleanup_enabled', 'native_cleanup_schedule_enabled'
  )) {
    if (ConvertTo-D1RestoreDarkBoolean (Get-D1RestoreDarkValue $Values $name)) {
      throw 'Dark recovery requires every writer activation gate off.'
    }
  }
  $community = Get-D1RestoreDarkValue $Values 'd2_community_runtime'
  if (ConvertTo-D1RestoreDarkBoolean (Get-D1RestoreDarkValue $community 'enabled')) {
    throw 'Dark recovery requires D2 writers off.'
  }
  $nativeGates = @{
    native_resume_source_access_releases = @('enabled')
    native_preparation_releases = @('enabled','launch_enabled','intake_enabled',
      'recovery_enabled','drain_enabled','route_enabled','route_creation_enabled')
    native_material_control_releases = @('owner_enabled','control_enabled',
      'recovery_enabled','new_launch_enabled','route_enabled')
    native_resume_preparation_releases = @('enabled','new_launch_enabled',
      'observation_events_enabled','observation_schedule_enabled','schedule_enabled',
      'route_enabled','route_creation_enabled','terminal_events_enabled',
      'execution_inspection_enabled','execution_reconciliation_enabled')
  }
  foreach ($name in $nativeGates.Keys) {
    $releases = Get-D1RestoreDarkValue $Values $name
    if ($releases -isnot [pscustomobject]) { throw 'Dark recovery release map is invalid.' }
    foreach ($release in @($releases.PSObject.Properties)) {
      foreach ($gate in $nativeGates[$name]) {
        if (ConvertTo-D1RestoreDarkBoolean (Get-D1RestoreDarkValue $release.Value $gate -OptionalOff)) {
          throw 'Dark recovery requires native writers off.'
        }
      }
    }
  }
  $gateway = Get-D1RestoreDarkValue $Values 'gateway_native_materials'
  if ($null -ne $gateway) {
    foreach ($name in @('owner_cleanup_enabled','disposal_enabled',
        'resume_preparation_enabled','cover_letter_preparation_enabled')) {
      if (ConvertTo-D1RestoreDarkBoolean (Get-D1RestoreDarkValue $gateway $name -OptionalOff)) {
        throw 'Dark recovery requires gateway native writers off.'
      }
    }
  }
  foreach ($name in @('legacy_receipt_transition', 'application_restore_reconciliation')) {
    if ($null -ne (Get-D1RestoreDarkValue $Values $name)) {
      throw 'Dark recovery cannot retain separate transition task authority.'
    }
  }
  if ((Get-D1RestoreDarkValue $Values 'development_database_mode') -cnotin @('retained', 'restore') -or
      [string](Get-D1RestoreDarkValue $Values 'database_backup_retention_days') -cne '35') {
    throw 'Dark recovery requires a retained protected data plane with 35-day backups.'
  }
}

function Get-D1RestoreDarkCollection {
  param([object]$Response, [string]$Name)
  $value = Get-D1RestoreDarkValue $Response $Name
  if ($value -isnot [array]) { throw 'Dark recovery inventory is malformed.' }
  return $value
}

function Assert-D1RestoreDarkWritersStopped {
  $prefix = 'ai-job-apply-development'
  $rules = Invoke-AwsJson @('events','list-rules','--name-prefix',$prefix,'--output','json')
  foreach ($rule in @(Get-D1RestoreDarkCollection $rules 'Rules')) {
    if ($rule.State -cne 'DISABLED') { throw 'Dark recovery found an active EventBridge rule.' }
  }
  $mappings = Invoke-AwsJson @('lambda','list-event-source-mappings','--output','json')
  foreach ($mapping in @(Get-D1RestoreDarkCollection $mappings 'EventSourceMappings')) {
    if ($mapping.FunctionArn -isnot [string] -or
        $mapping.FunctionArn -cnotmatch '^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]+(?::[A-Za-z0-9_$-]+)?$') {
      throw 'Dark recovery mapping identity is malformed.'
    }
    if ([string]$mapping.FunctionArn -clike "*:function:$prefix-*" -and $mapping.State -cne 'Disabled') {
      throw 'Dark recovery found an active queue consumer.'
    }
  }
  $apis = Invoke-AwsJson @('apigatewayv2','get-apis','--output','json')
  foreach ($api in @(Get-D1RestoreDarkCollection $apis 'Items' | Where-Object { $_.Name.StartsWith($prefix, [StringComparison]::Ordinal) })) {
    $routes = Invoke-AwsJson @('apigatewayv2','get-routes','--api-id',$api.ApiId,'--output','json')
    if (@(Get-D1RestoreDarkCollection $routes 'Items').Count) { throw 'Dark recovery found application routes.' }
  }
  $schedules = Invoke-AwsJson @('scheduler','list-schedules','--output','json')
  foreach ($schedule in @(Get-D1RestoreDarkCollection $schedules 'Schedules')) {
    if (($schedule.Name.StartsWith($prefix, [StringComparison]::Ordinal) -or
         $schedule.GroupName.StartsWith($prefix, [StringComparison]::Ordinal)) -and
        $schedule.State -cne 'DISABLED') { throw 'Dark recovery found an active Scheduler schedule.' }
  }
  $clusters = Invoke-AwsJson @('ecs','list-clusters','--output','json')
  foreach ($cluster in @(Get-D1RestoreDarkCollection $clusters 'clusterArns')) {
    if ($cluster -isnot [string] -or $cluster -cnotmatch '^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:cluster/[A-Za-z0-9_-]+$') {
      throw 'Dark recovery cluster identity is malformed.'
    }
    if ($cluster -cnotlike "*:cluster/$prefix*") { continue }
    $services = Invoke-AwsJson @('ecs','list-services','--cluster',$cluster,'--output','json')
    if (@(Get-D1RestoreDarkCollection $services 'serviceArns').Count) { throw 'Dark recovery found ECS services.' }
    foreach ($status in @('RUNNING','PENDING')) {
      $tasks = Invoke-AwsJson @('ecs','list-tasks','--cluster',$cluster,'--desired-status',$status,'--output','json')
      if (@(Get-D1RestoreDarkCollection $tasks 'taskArns').Count) { throw 'Dark recovery found ECS work.' }
    }
  }
  $functions = Invoke-AwsJson @('lambda','list-functions','--output','json')
  foreach ($function in @(Get-D1RestoreDarkCollection $functions 'Functions')) {
    if (-not $function.FunctionName.StartsWith("$prefix-", [StringComparison]::Ordinal) -or
        $null -eq $function.PSObject.Properties['DurableConfig'] -or $null -eq $function.DurableConfig) { continue }
    $executions = Invoke-AwsJson @('lambda','list-durable-executions-by-function','--function-name',$function.FunctionName,'--statuses','RUNNING','--output','json')
    if (@(Get-D1RestoreDarkCollection $executions 'DurableExecutions').Count) { throw 'Dark recovery found durable work.' }
  }
  $queues = Invoke-AwsJson @('sqs','list-queues','--queue-name-prefix',$prefix,'--output','json')
  foreach ($queue in @(Get-D1RestoreDarkCollection $queues 'QueueUrls')) {
    $counts = Invoke-AwsJson @('sqs','get-queue-attributes','--queue-url',$queue,'--attribute-names',
      'ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed','--output','json')
    foreach ($name in @('ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed')) {
      if ([string](Get-D1RestoreDarkValue $counts.Attributes $name) -cne '0') {
        throw 'Dark recovery found queue/DLQ work or invalid counts.'
      }
    }
  }
}

function Assert-D1RestoreDarkBaseline {
  if ($Environment -cne 'development' -or $ExpectedAccountId -notmatch '^[0-9]{12}$' -or
      [string]::IsNullOrWhiteSpace($StateBucket) -or [string]::IsNullOrWhiteSpace($RuntimePlanPath)) {
    throw 'Dark recovery requires the exact development account, backend and applied plan.'
  }
  Assert-DeploymentTerraformCli
  Assert-CurrentAwsCaller
  $allowedRoot = [IO.Path]::GetFullPath($terraformDataDirectory) + [IO.Path]::DirectorySeparatorChar
  $path = if ([IO.Path]::IsPathRooted($RuntimePlanPath)) { $RuntimePlanPath }
    else { Join-Path $environmentDirectory $RuntimePlanPath }
  $path = Resolve-DeploymentTerraformFile $path
  if (-not $path.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Dark recovery plan must be below the ignored development Terraform directory.'
  }
  $files = @(Get-ChildItem -LiteralPath $environmentDirectory -File -Force)
  if (@($files | Where-Object { $_.Name -cmatch '(^terraform\.tfvars(\.json)?$|\.auto\.tfvars(\.json)?$|(^|_)override\.tf(\.json)?$|\.tf\.json$)' }).Count) {
    throw 'Dark recovery refuses implicit Terraform input and override files.'
  }
  $names = @($files | Where-Object Extension -CEQ '.tf' | ForEach-Object {
    foreach ($match in [regex]::Matches((Get-Content -LiteralPath $_.FullName -Raw), '(?m)^variable\s+"([a-z0-9_]+)"\s*\{')) {
      $match.Groups[1].Value
    }
  } | Sort-Object -Unique)
  $savedData = $env:TF_DATA_DIR
  $saved = @{}
  $temporary = Join-Path $terraformDataDirectory "dark-recovery-$([guid]::NewGuid().ToString('N')).tfplan"
  $inputFile = "$temporary.tfvars.json"
  try {
    $env:TF_DATA_DIR = $terraformDataDirectory
    $plan = Read-DeploymentTerraformPlan -Path $path -TerraformDirectory $environmentDirectory
    Assert-D1RestoreExactObjectKeys $plan.variables $names 'Dark recovery variables'
    $values = [pscustomobject]@{}
    foreach ($name in $names) {
      Assert-D1RestoreExactObjectKeys $plan.variables.$name @('value') 'Dark recovery input binding'
      $values | Add-Member -NotePropertyName $name -NotePropertyValue $plan.variables.$name.value
    }
    Assert-D1RestoreDarkWriterInputs $values
    # Windows PowerShell cannot propagate an empty environment value to native
    # children. Bind the complete typed inputs explicitly as well as null-safe env.
    [IO.File]::WriteAllText($inputFile, (ConvertTo-Json -InputObject $values -Depth 100), [Text.UTF8Encoding]::new($false))
    foreach ($entry in @(Get-ChildItem Env: | Where-Object Name -Like 'TF_VAR_*')) {
      if ($entry.Name.Substring(7) -cnotin $names) { throw 'Dark recovery refuses unknown Terraform environment inputs.' }
    }
    foreach ($name in $names) {
      $key = "TF_VAR_$name"
      $saved[$key] = @{ Exists = Test-Path "Env:$key"; Value = [Environment]::GetEnvironmentVariable($key, 'Process') }
      $value = $values.$name
      $serialized = if ($null -eq $value) { 'null' }
        elseif ($value -is [bool]) { $value.ToString().ToLowerInvariant() }
        elseif ($value -is [string]) { $value }
        else { ConvertTo-Json -InputObject $value -Compress -Depth 100 }
      [Environment]::SetEnvironmentVariable($key, $serialized, 'Process')
    }
    $encryption = Invoke-AwsJson @('s3api','get-bucket-encryption','--bucket',$StateBucket,'--output','json')
    $rules = @($encryption.ServerSideEncryptionConfiguration.Rules)
    if ($rules.Count -ne 1 -or $rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'aws:kms') {
      throw 'Dark recovery requires one encrypted backend key.'
    }
    $kms = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
    if ($kms -cnotmatch "^arn:aws:kms:us-east-2:$ExpectedAccountId`:key/") { throw 'Dark recovery state key is outside the selected account.' }
    Assert-DeploymentTerraformBackend -TerraformDirectory $environmentDirectory -DataDirectory $terraformDataDirectory `
      -ExpectedBucket $StateBucket -ExpectedKey 'platform.tfstate' -ExpectedRegion $Region -ExpectedKmsKeyArn $kms
    & terraform "-chdir=$environmentDirectory" plan -input=false -lock-timeout=30s -detailed-exitcode "-var-file=$inputFile" "-out=$temporary" *> "$temporary.log"
    if ($LASTEXITCODE -ne 0) { throw 'Dark recovery requires fresh exact-input zero drift.' }
    $fresh = Read-DeploymentTerraformPlan -Path $temporary -TerraformDirectory $environmentDirectory
    foreach ($name in @('complete', 'errored', 'applyable')) {
      $value = Get-D1RestoreDarkValue $fresh $name
      $expected = $name -ceq 'complete'
      if ($value -isnot [bool] -or $value -ne $expected) {
        throw 'Dark recovery requires a complete, error-free, nonapplyable plan.'
      }
    }
    $drift = $fresh.PSObject.Properties['resource_drift']
    if (($null -ne $drift -and @($drift.Value).Count -ne 0) -or
        @($fresh.resource_changes | Where-Object { ($_.change.actions -join ',') -cne 'no-op' }).Count -ne 0 -or
        @($fresh.output_changes.PSObject.Properties | Where-Object { ($_.Value.actions -join ',') -cne 'no-op' }).Count -ne 0) {
      throw 'Dark recovery refuses drift or planned changes.'
    }
    Assert-D1RestoreDarkWritersStopped
    return [pscustomobject]@{ EcsRuntimeIdle = $true; ManagedRuntimeAlarmsOk = 0; WritersStopped = $true }
  }
  finally {
    foreach ($key in $saved.Keys) {
      if ($saved[$key].Exists) { [Environment]::SetEnvironmentVariable($key, $saved[$key].Value, 'Process') }
      else { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
    }
    $env:TF_DATA_DIR = $savedData
    foreach ($file in @($temporary, "$temporary.log", $inputFile)) {
      if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
    }
  }
}
