Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'deployment-operator-guards.ps1')
. (Join-Path $PSScriptRoot 'terraform-toolchain.ps1')
. (Join-Path $PSScriptRoot 'development-document-dark-guards.ps1')
. (Join-Path $PSScriptRoot 'development-gateway-release-guards.ps1')

function Get-D2RuntimeDigest {
  param([AllowNull()][object]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-DeploymentCanonicalValue $Value))
    return [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}
function ConvertFrom-D2RuntimeJson {
  param([string]$Text)
  # PS7.5 otherwise turns ISO strings into Dates; PS5.1 preserves strings. Keep review bytes'
  # date grammar visible on both hosts instead of normalizing malformed timestamps away.
  if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { return ConvertFrom-Json -InputObject $Text -DateKind String }
  return ConvertFrom-Json -InputObject $Text
}
function Copy-D2RuntimeValue { param([object]$Value); return ConvertFrom-D2RuntimeJson ($Value | ConvertTo-Json -Depth 80) }
function Get-D2RuntimeBoolean {
  param([AllowNull()][object]$Value)
  if ($Value -is [bool]) { return $Value }
  if ($Value -is [string] -and $Value -cin @('true', 'false')) { return $Value -ceq 'true' }
  throw 'D2RuntimeBooleanInvalid'
}
function Get-D2RuntimeMaintenance {
  param([object]$Runtime)
  if ($Runtime -isnot [pscustomobject]) { throw 'D2RuntimeInputsInvalid' }
  $property = $Runtime.PSObject.Properties['maintenance_mode']
  if ($null -eq $property) { return $false }
  return Get-D2RuntimeBoolean $property.Value
}
function Get-D2RuntimeConfiguration {
  param([object]$Variables)
  $property = $Variables.PSObject.Properties['d2_community_runtime']
  if ($null -eq $property) { throw 'D2RuntimeInputsInvalid' }
  $runtime = $property.Value.value
  if ($runtime -is [string]) {
    try { $runtime = ConvertFrom-D2RuntimeJson $runtime } catch { throw 'D2RuntimeInputsInvalid' }
  }
  if ($runtime -isnot [pscustomobject]) { throw 'D2RuntimeInputsInvalid' }
  if (-not (Get-D2RuntimeBoolean $runtime.deploy) -or -not (Get-D2RuntimeBoolean $runtime.enabled) -or
      -not (Get-D2RuntimeBoolean $Variables.deploy_applications.value) -or
      -not (Get-D2RuntimeBoolean $Variables.serverless_runtime_enabled.value) -or
      -not (Get-D2RuntimeBoolean $Variables.deploy_gateway_lambda.value)) { throw 'D2RuntimeNotAlreadyActivated' }
  return $runtime
}
function Assert-D2RuntimeArtifact {
  param([object]$Artifact, [string]$SourceSha, [string]$Bucket)
  Assert-ExactObjectKeys $Artifact @('schemaVersion','kind','sourceSha','artifactBucket','artifactSha256',
    'artifactBase64Sha256','key','versionId','phase') 'D2 immutable publication receipt'
  if ($Artifact.schemaVersion -ne 1 -or $Artifact.kind -cne 'development-d2-community-artifact-publication' -or
      $Artifact.phase -cne 'published' -or $Artifact.sourceSha -cne $SourceSha -or
      $SourceSha -cnotmatch '^[a-f0-9]{40}$' -or $Artifact.artifactBucket -cne $Bucket -or
      $Artifact.artifactSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $Artifact.artifactBase64Sha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or
      $Artifact.versionId -isnot [string] -or $Artifact.versionId -cnotmatch '^[A-Za-z0-9._-]{1,1024}$' -or
      $Artifact.versionId -ceq 'null' -or
      $Artifact.key -cne "lambda/d2-community/$SourceSha/$($Artifact.artifactSha256)/d2-community-runtime-lambda.zip") {
    throw 'D2RuntimeArtifactBindingInvalid'
  }
  $hex = [BitConverter]::ToString([Convert]::FromBase64String($Artifact.artifactBase64Sha256)).Replace('-', '').ToLowerInvariant()
  if ($hex -cne $Artifact.artifactSha256) { throw 'D2RuntimeArtifactDigestMismatch' }
}
function New-D2RuntimeReleaseVariables {
  param([object]$Variables, [ValidateSet('Pause','Workers','Resume')][string]$Transition, [AllowNull()][object]$Artifact)
  $runtime = Get-D2RuntimeConfiguration $Variables
  $maintenance = Get-D2RuntimeMaintenance $runtime
  if (($Transition -ceq 'Pause' -and $maintenance) -or ($Transition -cne 'Pause' -and -not $maintenance)) {
    throw 'D2RuntimeTransitionStateInvalid'
  }
  $next = Copy-D2RuntimeValue $Variables
  $nextRuntime = Get-D2RuntimeConfiguration $next
  $next.d2_community_runtime.value = $nextRuntime
  if ($Transition -ceq 'Workers') {
    if ($null -eq $Artifact -or $runtime.artifact_sha256 -ceq $Artifact.artifactSha256) { throw 'D2RuntimeWorkersArtifactInvalid' }
    $nextRuntime.artifact_s3_key = $Artifact.key
    $nextRuntime.artifact_s3_object_version = $Artifact.versionId
    $nextRuntime.artifact_sha256 = $Artifact.artifactSha256
    $nextRuntime.artifact_base64sha256 = $Artifact.artifactBase64Sha256
  } else {
    $nextRuntime | Add-Member -NotePropertyName maintenance_mode -NotePropertyValue ($Transition -ceq 'Pause') -Force
  }
  return $next
}
function Get-D2RuntimeAuthorityDigest {
  param([object]$Variables)
  $copy = Copy-D2RuntimeValue $Variables
  $runtime = Get-D2RuntimeConfiguration $copy
  $copy.d2_community_runtime.value = $runtime
  foreach ($name in @('maintenance_mode','artifact_s3_key','artifact_s3_object_version','artifact_sha256','artifact_base64sha256')) {
    $runtime.PSObject.Properties.Remove($name)
  }
  foreach ($name in @('gateway_lambda_artifact_s3_key','gateway_lambda_artifact_s3_object_version',
      'gateway_lambda_artifact_sha256','gateway_lambda_artifact_base64sha256','migration_image')) {
    $copy.PSObject.Properties.Remove($name)
  }
  return Get-D2RuntimeDigest (ConvertTo-D2RuntimeComparableVariables $copy)
}
function ConvertTo-D2RuntimeComparableVariables {
  param([object]$Variables)
  $copy = Copy-D2RuntimeValue $Variables
  # Native TF_VAR input records a root bool as a string. Normalize only this known root flag;
  # every other retained input, including nested runtime fields, stays canonical-exact.
  $flag = $copy.PSObject.Properties['candidate_deletion_restore_role_enabled']
  if ($null -ne $flag) { $flag.Value.value = Get-D2RuntimeBoolean $flag.Value.value }
  $runtime = $copy.PSObject.Properties['d2_community_runtime']
  if ($null -ne $runtime -and $runtime.Value.value -is [string]) { $runtime.Value.value = Get-D2RuntimeConfiguration $copy }
  return $copy
}
function Assert-D2RuntimeVariablesEqual {
  param([object]$Actual, [object]$Expected)
  if ((Get-D2RuntimeDigest (ConvertTo-D2RuntimeComparableVariables $Actual)) -cne
      (Get-D2RuntimeDigest (ConvertTo-D2RuntimeComparableVariables $Expected))) { throw 'D2RuntimePlanInputDeltaInvalid' }
}
function Assert-D2RuntimeReleasePlan {
  param([object]$Plan, [object]$Baseline, [ValidateSet('Pause','Workers','Resume')][string]$Transition,
    [AllowNull()][object]$Artifact)
  foreach ($property in @('complete','errored','applyable')) {
    if ($Plan.$property -isnot [bool]) { throw 'D2RuntimePlanShapeInvalid' }
  }
  if ($Plan.terraform_version -cne (Get-DeploymentTerraformVersion) -or -not $Plan.complete -or
      $Plan.errored -or -not $Plan.applyable) { throw 'D2RuntimePlanNotCurrentActionable' }
  $expectedVariables = New-D2RuntimeReleaseVariables $Baseline.variables $Transition $Artifact
  Assert-D2RuntimeVariablesEqual $Plan.variables $expectedVariables
  Assert-AcceptedGatewayProviderDrift -Plan $Plan
  foreach ($output in $Plan.output_changes.PSObject.Properties) {
    if ((@($output.Value.actions) -join ',') -cne 'no-op') { throw 'D2RuntimeOutputChangeRejected' }
  }
  $functions = @('d2_community_scheduled','d2_trust_signal')
  if ($Transition -cne 'Workers') { $functions += 'gateway' }
  $expectedAddresses = @($functions | ForEach-Object {
      "module.platform.aws_lambda_function.$($_)[0]"; "module.platform.aws_lambda_alias.$($_)[0]"
    })
  if ($Transition -cne 'Workers') {
    $expectedAddresses += @('module.platform.aws_cloudwatch_event_rule.d2_community_schedule[0]',
      'module.platform.aws_lambda_event_source_mapping.d2_trust_signal[0]')
  }
  $changes = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ',') -cne 'no-op' })
  if ((@($changes | ForEach-Object { $_.address } | Sort-Object) -join '|') -cne (@($expectedAddresses | Sort-Object) -join '|')) {
    throw 'D2RuntimeResourceInventoryInvalid'
  }
  $runtime = Get-D2RuntimeConfiguration $Plan.variables
  $active = $Transition -ceq 'Resume'
  foreach ($record in $changes) {
    if ($record.mode -cne 'managed' -or (@($record.change.actions) -join ',') -cne 'update') { throw 'D2RuntimeReplacementRejected' }
    Assert-NoTerraformReplacementPaths $record.change
    if ((ConvertTo-DeploymentCanonicalValue $record.change.before_sensitive) -cne
        (ConvertTo-DeploymentCanonicalValue $record.change.after_sensitive)) { throw 'D2RuntimeSensitiveShapeChanged' }
    $before = Copy-D2RuntimeValue $record.change.before
    $after = Copy-D2RuntimeValue $record.change.after
    $unknown = @(Get-GatewayUnknownTrueLeafPaths $record.change.after_unknown | Sort-Object)
    switch ($record.type) {
      'aws_lambda_function' {
        $kind = if ($record.address -cmatch '\.gateway\[0\]$') { 'gateway' }
          elseif ($record.address -cmatch '\.d2_community_scheduled\[0\]$') { 'scheduled' } else { 'signal' }
        if (@($before.environment).Count -ne 1 -or @($after.environment).Count -ne 1) { throw 'D2RuntimeEnvironmentShapeInvalid' }
        if ($Transition -ceq 'Workers') {
          if ($after.s3_key -cne $Artifact.key -or $after.s3_object_version -cne $Artifact.versionId -or
              $after.source_code_hash -cne $Artifact.artifactBase64Sha256 -or
              $after.environment[0].variables.RELEASE_SHA -cne $Artifact.artifactSha256 -or
              $after.reserved_concurrent_executions -ne 0 -or
              $after.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED -cne 'false') { throw 'D2RuntimeWorkerArtifactDeltaInvalid' }
          foreach ($field in @('s3_key','s3_object_version','source_code_hash')) {
            $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field)
          }
          $before.environment[0].variables.PSObject.Properties.Remove('RELEASE_SHA')
          $after.environment[0].variables.PSObject.Properties.Remove('RELEASE_SHA')
        } elseif ($kind -ceq 'gateway') {
          foreach ($key in @('D2_CONTRIBUTION_ROUTES_ENABLED','D2_TRUST_REVIEWER_ROUTES_ENABLED')) {
            if ($after.environment[0].variables.$key -cne $active.ToString().ToLowerInvariant() -or
                $before.environment[0].variables.$key -cne (-not $active).ToString().ToLowerInvariant()) { throw 'D2RuntimeGatewayGateInvalid' }
            $before.environment[0].variables.PSObject.Properties.Remove($key)
            $after.environment[0].variables.PSObject.Properties.Remove($key)
          }
          if ($after.environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED -cne 'true') { throw 'D2RuntimePrivateCaptureChanged' }
        } else {
          $configuredConcurrency = if ($kind -ceq 'scheduled') { $runtime.scheduled_reserved_concurrency } else { $runtime.signal_reserved_concurrency }
          $expectedConcurrency = if ($active) { $configuredConcurrency } else { 0 }
          $previousConcurrency = if ($active) { 0 } else { $configuredConcurrency }
          if ($after.reserved_concurrent_executions -ne $expectedConcurrency -or
              $before.reserved_concurrent_executions -ne $previousConcurrency -or
              $after.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED -cne $active.ToString().ToLowerInvariant() -or
              $before.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED -cne (-not $active).ToString().ToLowerInvariant()) { throw 'D2RuntimeWorkerGateInvalid' }
          $before.PSObject.Properties.Remove('reserved_concurrent_executions'); $after.PSObject.Properties.Remove('reserved_concurrent_executions')
          $before.environment[0].variables.PSObject.Properties.Remove('D2_COMMUNITY_RUNTIME_ENABLED')
          $after.environment[0].variables.PSObject.Properties.Remove('D2_COMMUNITY_RUNTIME_ENABLED')
        }
        foreach ($field in @('code_sha256','last_modified','qualified_arn','qualified_invoke_arn','version')) {
          $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field)
        }
        $expectedUnknown = if ($Transition -ceq 'Workers') { 'last_modified|qualified_arn|qualified_invoke_arn|version' }
          else { 'qualified_arn|qualified_invoke_arn|version' }
        if (($unknown -join '|') -cne $expectedUnknown) { throw 'D2RuntimeFunctionUnknownInvalid' }
      }
      'aws_lambda_alias' {
        if ($before.function_version -cnotmatch '^[1-9][0-9]*$' -or $null -ne $after.PSObject.Properties['function_version'] -or
            ($unknown -join '|') -cne 'function_version') { throw 'D2RuntimeAliasVersionInvalid' }
        foreach ($field in @('function_version','arn','invoke_arn')) { $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field) }
      }
      'aws_cloudwatch_event_rule' {
        $expectedState = if ($active) { 'ENABLED' } else { 'DISABLED' }
        $previousState = if ($active) { 'DISABLED' } else { 'ENABLED' }
        if ($after.state -cne $expectedState -or $before.state -cne $previousState -or $unknown.Count -ne 0) { throw 'D2RuntimeScheduleDeltaInvalid' }
        $before.PSObject.Properties.Remove('state'); $after.PSObject.Properties.Remove('state')
      }
      'aws_lambda_event_source_mapping' {
        if ($after.enabled -isnot [bool] -or $before.enabled -isnot [bool] -or
            $after.enabled -ne $active -or $before.enabled -eq $active -or
            @($unknown | Where-Object { $_ -cnotin @('last_modified','state','state_transition_reason','last_processing_result') }).Count -ne 0) { throw 'D2RuntimeMappingDeltaInvalid' }
        foreach ($field in @('enabled','last_modified','state','state_transition_reason','last_processing_result')) {
          $before.PSObject.Properties.Remove($field); $after.PSObject.Properties.Remove($field)
        }
      }
      default { throw 'D2RuntimeResourceTypeRejected' }
    }
    if ((ConvertTo-DeploymentCanonicalValue $before) -cne (ConvertTo-DeploymentCanonicalValue $after)) { throw 'D2RuntimeNonapprovedResourceDelta' }
  }
  return $changes
}
function ConvertTo-D2RuntimeUtc {
  param([object]$Value)
  if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') { throw 'D2RuntimeTimestampInvalid' }
  $parsed = [datetime]::ParseExact($Value, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  if ($parsed.Kind -ne [DateTimeKind]::Utc -or $parsed.ToString('o') -cne $Value) { throw 'D2RuntimeTimestampInvalid' }
  return $parsed
}
function New-D2RuntimePauseReceipt {
  param([object]$Snapshot, [object]$Binding, [datetime]$Now)
  if ($Now.Kind -ne [DateTimeKind]::Utc -or -not $Snapshot.paused -or $Snapshot.asyncMaximumAgeSeconds -ne 21600 -or
      $Snapshot.oldMaximumTimeoutSeconds -lt 1 -or $Snapshot.oldMaximumTimeoutSeconds -gt 900) { throw 'D2RuntimePauseCutoffInvalid' }
  return [ordered]@{
    schemaVersion = 1; kind = 'development-d2-runtime-pause'; accountId = $Binding.accountId
    region = 'us-east-2'; stateBucket = $Binding.stateBucket; stateLineage = $Binding.stateLineage
    stateSerial = $Binding.stateSerial; sourceSha = $Binding.sourceSha; pausePlanSha256 = $Binding.planSha256
    authoritySha256 = $Binding.authoritySha256; controlSha256 = $Snapshot.controlSha256
    cutoffAt = $Now.ToString('o'); asyncMaximumAgeSeconds = 21600
    oldMaximumTimeoutSeconds = $Snapshot.oldMaximumTimeoutSeconds; settlingSeconds = 60
    earliestResumeAt = $Now.AddSeconds(21600 + $Snapshot.oldMaximumTimeoutSeconds + 60).ToString('o')
  }
}
function Assert-D2RuntimePauseReceipt {
  param([object]$Receipt, [object]$Binding, [datetime]$Now, [switch]$RequireElapsed)
  Assert-ExactObjectKeys $Receipt @('schemaVersion','kind','accountId','region','stateBucket','stateLineage',
    'stateSerial','sourceSha','pausePlanSha256','authoritySha256','controlSha256','cutoffAt',
    'asyncMaximumAgeSeconds','oldMaximumTimeoutSeconds','settlingSeconds','earliestResumeAt') 'D2 pause receipt'
  $cutoff = ConvertTo-D2RuntimeUtc $Receipt.cutoffAt
  $earliest = ConvertTo-D2RuntimeUtc $Receipt.earliestResumeAt
  foreach ($key in @('schemaVersion','stateSerial','asyncMaximumAgeSeconds','oldMaximumTimeoutSeconds','settlingSeconds')) {
    if ($Receipt.$key -isnot [int] -and $Receipt.$key -isnot [long]) { throw 'D2RuntimePauseReceiptTypeInvalid' }
  }
  if ($Now.Kind -ne [DateTimeKind]::Utc -or $Receipt.schemaVersion -ne 1 -or
      $Receipt.kind -cne 'development-d2-runtime-pause' -or $Receipt.accountId -cne $Binding.accountId -or
      $Receipt.region -cne 'us-east-2' -or $Receipt.stateBucket -cne $Binding.stateBucket -or
      $Receipt.stateLineage -cne $Binding.stateLineage -or $Receipt.authoritySha256 -cne $Binding.authoritySha256 -or
      $Receipt.stateSerial -lt 1 -or $Receipt.stateSerial -gt $Binding.stateSerial -or
      $Receipt.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or $Receipt.pausePlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $Receipt.controlSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $Receipt.asyncMaximumAgeSeconds -ne 21600 -or $Receipt.oldMaximumTimeoutSeconds -lt 1 -or
      $Receipt.oldMaximumTimeoutSeconds -gt 900 -or $Receipt.settlingSeconds -ne 60 -or
      $cutoff -gt $Now -or $earliest -ne $cutoff.AddSeconds(21600 + $Receipt.oldMaximumTimeoutSeconds + 60) -or
      ($RequireElapsed -and $Now -lt $earliest)) { throw 'D2RuntimePauseRetirementNotProven' }
}
function Assert-D2RuntimeMigrationInventory {
  param([System.Collections.IDictionary]$Inventory)
  $expected = [ordered]@{
    profile = '0001_foundation|0002_serverless_outbox|0003_retire_legacy_dispatch|0004_profile_fact_versions|0005_resume_fact_proposals|0006_candidate_rights|0007_candidate_rights_export_null_omission|0008_ugc_contribution_consents|0009_ugc_contribution_consent_candidate_rights|0010_restricted_answer_vault'
    jobs = '0001_job_catalog|0002_duplicate_resolution|0003_duplicate_resolution_audit_guard|0004_job_search|0005_ingestion_orchestration|0006_public_job_reader|0007_matchable_job_attributes|0008_job_reporting_and_moderation|0009_provider_ingestion_sources|0010_public_job_truth_fields|0011_positive_source_withdrawal|0012_candidate_rights|0013_public_job_sitemap|0014_job_contribution_intake|0015_source_revalidation_lifecycle|0016_job_contribution_candidate_rights|0017_job_contribution_processing|0018_job_contribution_processing_delivery|0019_job_contribution_provider_publication|0020_contribution_trust_reprocessing|0021_development_contribution_operation_lease|0022_development_contribution_provider_leases|0023_contribution_verification_refresh|0024_contribution_appeal_restoration'
    documents = '0001_resume_intake|0002_resume_processing|0003_candidate_rights|0004_resume_deletion|0005_resume_purge'
    matching = '0001_saved_jobs|0002_candidate_rights|0003_private_saved_page_captures'
    billing = '0001_entitlement_projection|0002_candidate_rights'
    trust = '0001_ugc_trust_foundation|0002_candidate_rights|0003_decision_signals|0004_accepted_independent_evidence'
  }
  if ($Inventory.Count -ne $expected.Count) { throw 'D2RuntimeMigrationBoundaryUnsupported' }
  $modern = ($Inventory['profile'] -join '|') -ceq ($expected.profile + '|0011_active_candidate_lease')
  if ($modern) {
    $expected.profile += '|0011_active_candidate_lease'
    $expected.documents += '|0006_cover_letters'
    if (($Inventory['documents'] -join '|') -ceq ($expected.documents + '|0007_cover_letter_work_authorizations')) {
      $expected.documents += '|0007_cover_letter_work_authorizations'
    }
    $expected.trust += '|0005_development_test_removal'
  } elseif (($Inventory['trust'] -join '|') -ceq ($expected.trust + '|0005_development_test_removal')) {
    $expected.trust += '|0005_development_test_removal'
  }
  foreach ($owner in $expected.Keys) {
    if (-not $Inventory.Contains($owner) -or ($Inventory[$owner] -join '|') -cne $expected[$owner]) {
      throw 'D2RuntimeMigrationBoundaryUnsupported'
    }
  }
}
function Get-D2RuntimeMigrationMessages {
  param([string]$RepositoryRoot, [string]$SourceSha)
  if ($SourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'D2RuntimeMigrationSourceInvalid' }
  $labels = [ordered]@{ profile = 'Database'; jobs = 'Jobs'; documents = 'Documents'; matching = 'Matching'; billing = 'Billing'; trust = 'Trust' }
  $messages = [Collections.Generic.List[string]]::new()
  $inventory = [ordered]@{}
  foreach ($owner in $labels.Keys) {
    $raw = @(& git -C $RepositoryRoot show "$SourceSha`:backend/services/$owner/src/migrate.ts" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) { throw 'D2RuntimeMigrationSourceUnavailable' }
    $source = $raw -join "`n"
    $declarations = [regex]::Matches($source, '(?s)const migrationVersions = \[(.*?)\] as const;')
    if ($declarations.Count -ne 1) { throw 'D2RuntimeMigrationInventoryInvalid' }
    $pattern = '"([0-9]{4}_[a-z][a-z0-9_]{0,99})"'
    $list = $declarations[0].Groups[1].Value
    if ($list -cnotmatch ('^\s*' + $pattern + '(?:\s*,\s*' + $pattern + ')*\s*,?\s*$')) { throw 'D2RuntimeMigrationInventoryInvalid' }
    $versions = @([regex]::Matches($list, $pattern) | ForEach-Object { $_.Groups[1].Value })
    for ($index = 0; $index -lt $versions.Count; $index++) {
      if (-not $versions[$index].StartsWith(('{0:D4}_' -f ($index + 1)), [StringComparison]::Ordinal)) { throw 'D2RuntimeMigrationInventoryInvalid' }
    }
    $inventory[$owner] = $versions
    $statement = 'console.log(`' + $labels[$owner] + ' migrations through ${migrationVersions.at(-1)} applied and verified.`);'
    if ([regex]::Matches($source, 'console\.log\s*\(').Count -ne 1 -or -not $source.Contains($statement)) { throw 'D2RuntimeMigrationLogContractInvalid' }
    $messages.Add("$($labels[$owner]) migrations through $($versions[-1]) applied and verified.")
  }
  Assert-D2RuntimeMigrationInventory $inventory
  $messages.Add('All service-owned database migrations applied and verified.')
  return $messages.ToArray()
}
function Assert-D2RuntimeLiveFunction {
  param([object]$Configuration, [object]$Alias, [object]$Concurrency, [object]$Expected,
    [object]$ExpectedAlias, [string]$AccountId)
  $arn = "arn:aws:lambda:us-east-2:$AccountId`:function:$($Expected.function_name)"
  if ($Alias.Name -cne 'development' -or $Alias.AliasArn -cne "$arn`:development" -or
      $Alias.FunctionVersion -cne $ExpectedAlias.function_version -or
      $Alias.FunctionVersion -cnotmatch '^[1-9][0-9]*$' -or $Alias.FunctionVersion -cne $Expected.version -or
      $Configuration.FunctionArn -cne "$arn`:$($Alias.FunctionVersion)" -or
      $Configuration.Version -cne $Alias.FunctionVersion -or $Configuration.State -cne 'Active' -or
      $Configuration.CodeSha256 -cne $Expected.source_code_hash -or $Configuration.Role -cne $Expected.role -or
      $Configuration.Handler -cne $Expected.handler -or $Configuration.Runtime -cne $Expected.runtime -or
      $Configuration.Timeout -ne $Expected.timeout -or $Configuration.MemorySize -ne $Expected.memory_size -or
      $Concurrency.ReservedConcurrentExecutions -ne $Expected.reserved_concurrent_executions -or
      (ConvertTo-DeploymentCanonicalValue $Configuration.Environment.Variables) -cne
        (ConvertTo-DeploymentCanonicalValue $Expected.environment[0].variables) -or
      (@($Configuration.Architectures) -join '|') -cne (@($Expected.architectures) -join '|') -or
      (@($Configuration.VpcConfig.SubnetIds | Sort-Object) -join '|') -cne (@($Expected.vpc_config[0].subnet_ids | Sort-Object) -join '|') -or
      (@($Configuration.VpcConfig.SecurityGroupIds | Sort-Object) -join '|') -cne (@($Expected.vpc_config[0].security_group_ids | Sort-Object) -join '|')) {
    throw 'D2RuntimeLiveFunctionMismatch'
  }
  $routing = $Alias.PSObject.Properties['RoutingConfig']
  if ($null -ne $routing) {
    $weights = $routing.Value.PSObject.Properties['AdditionalVersionWeights']
    if ($null -ne $weights -and @($weights.Value.PSObject.Properties).Count -ne 0) { throw 'D2RuntimeWeightedAliasRejected' }
  }
  $update = $Configuration.PSObject.Properties['LastUpdateStatus']
  if ($null -ne $update -and $update.Value -cne 'Successful') { throw 'D2RuntimeFunctionUpdateIncomplete' }
}
function Assert-D2RuntimeSchedulePermission {
  param([object]$Policy, [string]$AliasArn, [string]$RuleArn)
  if ($Policy -is [string]) { $Policy = $Policy | ConvertFrom-Json }
  if ($Policy.Version -cne '2012-10-17' -or @($Policy.Statement).Count -ne 1) { throw 'D2RuntimeSchedulePermissionRejected' }
  $statement = @($Policy.Statement)[0]
  Assert-ExactObjectKeys $statement @('Sid','Effect','Principal','Action','Resource','Condition') 'D2 schedule permission'
  if ($statement.Sid -cne 'AllowExactD2CommunitySchedule' -or $statement.Effect -cne 'Allow' -or
      $statement.Action -cne 'lambda:InvokeFunction' -or $statement.Resource -cne $AliasArn -or
      (ConvertTo-DeploymentCanonicalValue $statement.Principal) -cne
        (ConvertTo-DeploymentCanonicalValue ([pscustomobject]@{ Service = 'events.amazonaws.com' })) -or
      (ConvertTo-DeploymentCanonicalValue $statement.Condition) -cne
        (ConvertTo-DeploymentCanonicalValue ([pscustomobject]@{ ArnLike = [pscustomobject]@{ 'AWS:SourceArn' = $RuleArn } }))) {
    throw 'D2RuntimeSchedulePermissionRejected'
  }
}
