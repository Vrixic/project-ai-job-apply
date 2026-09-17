Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'development-d2-runtime-release.ps1')

# Pure saved-plan validation only. The caller separately authenticates native plan bytes,
# current source/state/account, reviewed configuration, and both domain-aware artifact receipts.
# This is not an Apply operator, a fixture approval, or a replacement for live verification.
function Assert-D2ProviderConfigurationValueEqual {
  param([AllowNull()][object]$Actual, [AllowNull()][object]$Expected)
  if ((ConvertTo-DeploymentCanonicalValue $Actual) -cne (ConvertTo-DeploymentCanonicalValue $Expected)) {
    throw 'D2ProviderConfigurationValueChanged'
  }
}

function Assert-D2ProviderConfigurationSelection {
  param([object]$Configuration)
  Assert-ExactObjectKeys $Configuration @('development_contribution_providers', 'development_contribution_domains',
    'provider_sources_json', 'provider_verification_registrations_json') 'D2 provider configuration'
  $providers = $Configuration.development_contribution_providers
  $domains = $Configuration.development_contribution_domains
  if ($providers -isnot [array] -or $providers.Count -gt 3 -or
      @($providers | Select-Object -Unique).Count -ne $providers.Count) { throw 'D2ProviderSelectionRejected' }
  foreach ($provider in $providers) {
    if ($provider -isnot [string] -or $provider -cnotin @('greenhouse', 'lever', 'ashby')) { throw 'D2ProviderSelectionRejected' }
  }
  if ($null -ne $domains) {
    if ($domains -isnot [array] -or $domains.Count -gt 5 -or
        @($domains | Select-Object -Unique).Count -ne $domains.Count) { throw 'D2ProviderDomainSelectionRejected' }
    foreach ($domain in $domains) {
      if ($domain -isnot [string] -or $domain -cnotin @('boards.greenhouse.io', 'job-boards.greenhouse.io',
          'jobs.lever.co', 'jobs.eu.lever.co', 'jobs.ashbyhq.com')) { throw 'D2ProviderDomainSelectionRejected' }
    }
  }
  foreach ($field in @('provider_sources_json', 'provider_verification_registrations_json')) {
    if ($Configuration.$field -isnot [string] -or [Text.Encoding]::UTF8.GetByteCount($Configuration.$field) -gt 1800) {
      throw 'D2ProviderRegistrySizeRejected'
    }
  }
}

function New-D2ProviderConfigurationVariables {
  param([object]$Variables, [object]$Configuration)
  Assert-D2ProviderConfigurationSelection $Configuration
  $copy = Copy-D2RuntimeValue $Variables
  $runtime = Get-D2RuntimeConfiguration $copy
  if ($runtime.development_contributions_enabled -isnot [bool] -or -not $runtime.development_contributions_enabled -or
      $runtime.provider_activation_allowed -isnot [bool] -or -not $runtime.provider_activation_allowed) {
    throw 'D2ProviderDevelopmentModeRequired'
  }
  $copy.d2_community_runtime.value = $runtime
  $selection = Copy-D2RuntimeValue $Configuration
  foreach ($property in $selection.PSObject.Properties) {
    $runtime | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force
  }
  return $copy
}

function Read-D2ProviderConfigurationRegistries {
  param([object]$Runtime)
  try {
    $null = ConvertFrom-D2RuntimeJson $Runtime.provider_sources_json
    $null = ConvertFrom-D2RuntimeJson $Runtime.provider_verification_registrations_json
    # A nested array retains [] / [one] on both hosts; function output pipelines do not.
    # Validate the wrapper too, so a closing-brace suffix cannot add another property.
    $sourceWrapper = ConvertFrom-D2RuntimeJson ('{"items":' + $Runtime.provider_sources_json + '}')
    $registrationWrapper = ConvertFrom-D2RuntimeJson ('{"items":' + $Runtime.provider_verification_registrations_json + '}')
    Assert-ExactObjectKeys $sourceWrapper @('items') 'D2 source array wrapper'
    Assert-ExactObjectKeys $registrationWrapper @('items') 'D2 registration array wrapper'
    $sources = $sourceWrapper.items
    $registrations = $registrationWrapper.items
  } catch { throw 'D2ProviderRegistryJsonRejected' }
  if ($sources -isnot [array] -or $registrations -isnot [array] -or $sources.Count -lt 1 -or
      $sources.Count -gt 8 -or $registrations.Count -ne $sources.Count) { throw 'D2ProviderRegistryShapeRejected' }
  $byId = @{}
  foreach ($source in $sources) {
    if ($source -isnot [pscustomobject] -or $source.provider -cnotin @('greenhouse', 'lever', 'ashby')) {
      throw 'D2ProviderRegistrySourceRejected'
    }
    $keys = @('schemaVersion', 'provider', 'sourceId', 'enabled', 'companyName', 'verifiedCompanyDomain')
    $tenantField = switch ($source.provider) { 'greenhouse' { 'boardToken' }; 'lever' { 'site' }; 'ashby' { 'jobBoardName' } }
    $keys += $tenantField
    if ($source.provider -ceq 'lever') { $keys += 'region' }
    Assert-ExactObjectKeys $source $keys 'D2 provider source'
    if (($source.schemaVersion -isnot [int] -and $source.schemaVersion -isnot [long]) -or $source.schemaVersion -ne 1 -or
        $source.enabled -isnot [bool] -or -not $source.enabled -or
        $source.sourceId -isnot [string] -or $source.sourceId -cnotmatch '^[a-z0-9][a-z0-9-]{2,63}$' -or
        $byId.ContainsKey($source.sourceId) -or $source.companyName -isnot [string] -or
        $source.companyName.Length -lt 1 -or $source.companyName.Length -gt 200 -or
        $source.companyName -cne $source.companyName.Trim() -or $source.companyName -match '[\x00-\x1f\x7f<>]' -or
        $source.verifiedCompanyDomain -isnot [string] -or
        $source.verifiedCompanyDomain -cnotmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' -or
        $source.$tenantField -isnot [string] -or
        $source.$tenantField -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$' -or
        ($source.provider -ceq 'lever' -and $source.region -cne 'global')) { throw 'D2ProviderRegistrySourceRejected' }
    $byId[$source.sourceId] = $source
  }
  $seenIds = @{}
  $seenTenants = @{}
  foreach ($registration in $registrations) {
    Assert-ExactObjectKeys $registration @('sourceId', 'provider', 'pageVariant', 'atsTenant', 'sourcePolicyVersion') 'D2 provider verification registration'
    if ($registration.sourceId -isnot [string] -or -not $byId.ContainsKey($registration.sourceId) -or
        $seenIds.ContainsKey($registration.sourceId)) { throw 'D2ProviderRegistrationBindingRejected' }
    $source = $byId[$registration.sourceId]
    $tenantField = switch ($source.provider) { 'greenhouse' { 'boardToken' }; 'lever' { 'site' }; 'ashby' { 'jobBoardName' } }
    $variant = switch ($source.provider) { 'greenhouse' { 'greenhouse-board-v1' }; 'lever' { 'lever-posting-v1' }; 'ashby' { 'ashby-job-board-v1' } }
    $tenant = $source.$tenantField.Normalize([Text.NormalizationForm]::FormKC).ToLowerInvariant()
    $key = $source.provider + ':' + $tenant
    if ($registration.provider -cne $source.provider -or $registration.pageVariant -cne $variant -or
        $registration.atsTenant -isnot [string] -or $registration.atsTenant -cne $tenant -or
        $registration.sourcePolicyVersion -isnot [string] -or $registration.sourcePolicyVersion -cnotmatch '^[a-z0-9][a-z0-9._-]{2,99}$' -or
        $seenTenants.ContainsKey($key)) { throw 'D2ProviderRegistrationBindingRejected' }
    $seenIds[$registration.sourceId] = $true
    $seenTenants[$key] = $true
  }
  return [pscustomobject]@{ Sources = $sources; Registrations = $registrations }
}

function Assert-D2ProviderAdditiveConfiguration {
  param([object]$Before, [object]$After, [object]$Configuration)
  $providerProperty = $Before.PSObject.Properties['development_contribution_providers']
  $beforeProviders = @('greenhouse')
  if ($null -ne $providerProperty) { $beforeProviders = $providerProperty.Value }
  $domainProperty = $Before.PSObject.Properties['development_contribution_domains']
  $beforeDomains = $null
  if ($null -ne $domainProperty) { $beforeDomains = $domainProperty.Value }
  $beforeSelection = [pscustomobject]@{
    development_contribution_providers = $beforeProviders; development_contribution_domains = $beforeDomains
    provider_sources_json = $Before.provider_sources_json
    provider_verification_registrations_json = $Before.provider_verification_registrations_json
  }
  Assert-D2ProviderConfigurationSelection $beforeSelection
  if ($beforeProviders -cnotcontains 'greenhouse' -or $Configuration.development_contribution_providers -cnotcontains 'greenhouse' -or
      $null -eq $Configuration.development_contribution_domains -or
      @($beforeProviders | Where-Object { $Configuration.development_contribution_providers -cnotcontains $_ }).Count -ne 0) {
    throw 'D2ProviderAdditiveScopeRejected'
  }
  $expectedDomains = @('boards.greenhouse.io', 'job-boards.greenhouse.io')
  if ($Configuration.development_contribution_providers -ccontains 'lever') { $expectedDomains += 'jobs.lever.co' }
  if ($Configuration.development_contribution_providers -ccontains 'ashby') { $expectedDomains += 'jobs.ashbyhq.com' }
  Assert-D2ProviderConfigurationValueEqual @($Configuration.development_contribution_domains | Sort-Object -CaseSensitive) @($expectedDomains | Sort-Object -CaseSensitive)
  if ($null -ne $beforeDomains) {
    foreach ($domain in $beforeDomains) {
      if ($Configuration.development_contribution_domains -cnotcontains $domain) { throw 'D2ProviderExistingHostChanged' }
    }
  }
  $old = Read-D2ProviderConfigurationRegistries $Before
  $next = Read-D2ProviderConfigurationRegistries $After
  if ($next.Sources.Count -le $old.Sources.Count) { throw 'D2ProviderAdditionRequired' }
  foreach ($field in @('Sources', 'Registrations')) {
    for ($index = 0; $index -lt $old.$field.Count; $index++) {
      Assert-D2ProviderConfigurationValueEqual $next.$field[$index] $old.$field[$index]
    }
  }
  foreach ($source in $next.Sources) {
    if ($Configuration.development_contribution_providers -cnotcontains $source.provider) { throw 'D2ProviderSourceSelectionMismatch' }
  }
  foreach ($source in @($next.Sources | Select-Object -Skip $old.Sources.Count)) {
    if ($source.provider -cnotin @('lever', 'ashby')) { throw 'D2ProviderAdditionScopeRejected' }
  }
  foreach ($provider in $Configuration.development_contribution_providers) {
    if (@($next.Sources | Where-Object { $_.provider -ceq $provider }).Count -eq 0) { throw 'D2ProviderSelectedSourceMissing' }
  }
  $parts = @(
    $(if ((@($Configuration.development_contribution_providers) -join ',') -cne 'greenhouse') {
        ConvertTo-Json -InputObject $Configuration.development_contribution_providers -Compress
      } else { '' }),
    (ConvertTo-Json -InputObject $Configuration.development_contribution_domains -Compress),
    $After.trust_reviewer_assignments_json, $After.trust_evidence_allowlist_json,
    $After.provider_sources_json, $After.provider_verification_registrations_json
  )
  if ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($parts -join ''))).Length -gt 3000) {
    throw 'D2ProviderConfigurationBudgetRejected'
  }
}

function Assert-D2ProviderEnvironmentBudget {
  param([object]$Environment)
  if ($Environment -isnot [pscustomobject]) { throw 'D2ProviderEnvironmentBudgetRejected' }
  $bytes = 0
  $encoding = [Text.UTF8Encoding]::new($false, $true)
  foreach ($property in $Environment.PSObject.Properties) {
    if ($property.Value -isnot [string] -or $property.Name.Length -gt 4096 -or $property.Value.Length -gt 4096) {
      throw 'D2ProviderEnvironmentBudgetRejected'
    }
    try { $bytes += $encoding.GetByteCount($property.Name) + $encoding.GetByteCount($property.Value) }
    catch { throw 'D2ProviderEnvironmentBudgetRejected' }
    if ($bytes -gt 4096) { throw 'D2ProviderEnvironmentBudgetRejected' }
  }
}

function Get-D2ProviderExpectedEnvironment {
  param([object]$Environment, [object]$Configuration, [bool]$Scheduled)
  $copy = Copy-D2RuntimeValue $Environment
  $copy.PSObject.Properties.Remove('D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON')
  $copy.PSObject.Properties.Remove('D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON')
  if ((@($Configuration.development_contribution_providers) -join ',') -cne 'greenhouse') {
    $copy | Add-Member D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON (ConvertTo-Json -InputObject $Configuration.development_contribution_providers -Compress)
  }
  if ($null -ne $Configuration.development_contribution_domains) {
    $copy | Add-Member D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON (ConvertTo-Json -InputObject $Configuration.development_contribution_domains -Compress)
  }
  if ($Scheduled) {
    $copy | Add-Member D2_COMMUNITY_PROVIDER_SOURCES_JSON $Configuration.provider_sources_json -Force
    $copy | Add-Member D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON $Configuration.provider_verification_registrations_json -Force
  }
  return $copy
}

function Get-D2ProviderManagedWrappers {
  param([object]$Module)
  $map = @{}
  function Add-D2ProviderManagedModule([object]$Current) {
    foreach ($resource in @(Get-RestoreRoleProperty $Current 'resources' @())) {
      if ($resource.mode -cne 'managed') { continue }
      if ($map.ContainsKey($resource.address)) { throw 'D2ProviderDuplicateManagedWrapper' }
      $copy = Copy-D2RuntimeValue $resource
      $copy.PSObject.Properties.Remove('values')
      $map[$resource.address] = $copy
    }
    foreach ($child in @(Get-RestoreRoleProperty $Current 'child_modules' @())) { Add-D2ProviderManagedModule $child }
  }
  Add-D2ProviderManagedModule $Module
  return $map
}

function Assert-D2ProviderConfigurationPlan {
  param([object]$Plan, [object]$Baseline, [object]$Configuration, [string]$ExpectedAccountId)
  if ($ExpectedAccountId -cnotmatch '^[0-9]{12}$') { throw 'D2ProviderAccountRequired' }
  foreach ($value in @($Plan, $Baseline)) {
    if ($value.terraform_version -cne (Get-DeploymentTerraformVersion) -or $value.complete -isnot [bool] -or
        -not $value.complete -or $value.errored -isnot [bool] -or $value.errored -or $value.applyable -isnot [bool] -or
        @(Get-RestoreRoleProperty $value 'deferred_changes' @()).Count -ne 0) {
      throw 'D2ProviderPlanEnvelopeRejected'
    }
    foreach ($drift in @(Get-RestoreRoleProperty $value 'resource_drift' @())) {
      if ($drift.address -cne 'module.platform.aws_db_instance.postgres[0]') { throw 'D2ProviderUnexpectedDrift' }
    }
  }
  if (-not $Plan.applyable -or $Baseline.applyable) { throw 'D2ProviderPlanEnvelopeRejected' }
  $null = Assert-RetainedGatewayBaselinePlan $Baseline @($Baseline.variables.PSObject.Properties.Name)
  Assert-AcceptedGatewayProviderDrift $Plan
  $expectedVariables = New-D2ProviderConfigurationVariables $Baseline.variables $Configuration
  Assert-D2RuntimeVariablesEqual $Plan.variables $expectedVariables
  $oldRuntime = Get-D2RuntimeConfiguration $Baseline.variables
  $runtime = Get-D2RuntimeConfiguration $expectedVariables
  Assert-D2ProviderAdditiveConfiguration $oldRuntime $runtime $Configuration
  $oldSelection = [pscustomobject]@{
    development_contribution_providers = @('greenhouse'); development_contribution_domains = $null
    provider_sources_json = $oldRuntime.provider_sources_json
    provider_verification_registrations_json = $oldRuntime.provider_verification_registrations_json
  }
  foreach ($field in @('development_contribution_providers', 'development_contribution_domains')) {
    $property = $oldRuntime.PSObject.Properties[$field]
    if ($null -ne $property) { $oldSelection.$field = $property.Value }
  }
  Assert-D2ProviderConfigurationValueEqual $Plan.configuration $Baseline.configuration
  Assert-D2ProviderConfigurationValueEqual $Plan.planned_values.outputs $Baseline.planned_values.outputs
  foreach ($output in $Plan.output_changes.PSObject.Properties) {
    if ((@($output.Value.actions) -join ',') -cne 'no-op') { throw 'D2ProviderOutputChanged' }
    Assert-D2ProviderConfigurationValueEqual $output.Value.before $output.Value.after
  }
  $baselineMap = Get-RestoreRoleResourceMap $Baseline.planned_values.root_module
  $priorMap = Get-RestoreRoleResourceMap $Plan.prior_state.values.root_module
  $plannedMap = Get-RestoreRoleResourceMap $Plan.planned_values.root_module
  Assert-D2ProviderConfigurationValueEqual (Get-D2ProviderManagedWrappers $Plan.planned_values.root_module) (Get-D2ProviderManagedWrappers $Baseline.planned_values.root_module)
  Assert-D2ProviderConfigurationValueEqual @($baselineMap.Keys | Sort-Object -CaseSensitive) @($priorMap.Keys | Sort-Object -CaseSensitive)
  Assert-D2ProviderConfigurationValueEqual @($priorMap.Keys | Sort-Object -CaseSensitive) @($plannedMap.Keys | Sort-Object -CaseSensitive)
  $originalPrior = @{}
  foreach ($address in $priorMap.Keys) { $originalPrior[$address] = $priorMap[$address] }
  foreach ($drift in @($Plan.resource_drift)) {
    if ($null -eq $drift) { continue }
    if (-not $originalPrior.ContainsKey($drift.address)) { throw 'D2ProviderDriftInventoryRejected' }
    Assert-D2ProviderConfigurationValueEqual $priorMap[$drift.address] $drift.change.after
    $originalPrior[$drift.address] = $drift.change.before
  }
  # A fresh baseline refresh and the later transition can observe different RDS clocks.
  # Compare their exact original, before-refresh values; the maintained drift guard above
  # independently permits only the documented computed clock/observation fields.
  $originalBaseline = Get-RestoreRoleBeforeRefreshResources $Baseline
  Assert-D2ProviderConfigurationValueEqual $originalPrior $originalBaseline
  $providerAddresses = @(
    'module.platform.aws_lambda_function.gateway[0]', 'module.platform.aws_lambda_alias.gateway[0]',
    'module.platform.aws_lambda_function.d2_community_scheduled[0]', 'module.platform.aws_lambda_alias.d2_community_scheduled[0]'
  )
  foreach ($address in $providerAddresses) {
    if (-not $baselineMap.ContainsKey($address)) { throw 'D2ProviderRequiredResourceMissing' }
  }
  # Registry additions always change the scheduled function and its immutable alias.
  # Gateway receives only selectors, so require its pair exactly when those inputs change.
  # Preserve array order: the selectors are encoded into environment JSON in that order.
  $expectedAddresses = @($providerAddresses[2], $providerAddresses[3])
  foreach ($field in @('development_contribution_providers', 'development_contribution_domains')) {
    if ((ConvertTo-DeploymentCanonicalValue $oldSelection.$field) -cne (ConvertTo-DeploymentCanonicalValue $Configuration.$field)) {
      $expectedAddresses = $providerAddresses
      break
    }
  }
  $changed = @($Plan.resource_changes | Where-Object { (@($_.change.actions) -join ',') -cne 'no-op' })
  # Arrays themselves expose an Address method; use explicit member projection on both hosts.
  Assert-D2ProviderConfigurationValueEqual @($changed | ForEach-Object { $_.address } | Sort-Object -CaseSensitive) @($expectedAddresses | Sort-Object -CaseSensitive)
  $seen = @{}
  $baselineRecords = @{}
  foreach ($record in $Baseline.resource_changes) {
    if ($baselineRecords.ContainsKey($record.address)) { throw 'D2ProviderDuplicateBaselineRecord' }
    $baselineRecords[$record.address] = $record
  }
  foreach ($record in $Plan.resource_changes) {
    if ($seen.ContainsKey($record.address)) { throw 'D2ProviderDuplicatePlanRecord' }
    $seen[$record.address] = $true
    if ($record.mode -cne 'managed') {
      if ((@($record.change.actions) -join ',') -cne 'no-op') { throw 'D2ProviderUnexpectedDataRead' }
      continue
    }
    if (-not $baselineRecords.ContainsKey($record.address)) { throw 'D2ProviderBaselineRecordMissing' }
    $beforeWrapper = Copy-D2RuntimeValue $baselineRecords[$record.address]
    $afterWrapper = Copy-D2RuntimeValue $record
    $beforeWrapper.PSObject.Properties.Remove('change')
    $afterWrapper.PSObject.Properties.Remove('change')
    Assert-D2ProviderConfigurationValueEqual $afterWrapper $beforeWrapper
    foreach ($field in @('before_sensitive', 'after_sensitive')) {
      Assert-D2ProviderConfigurationValueEqual $record.change.$field $baselineRecords[$record.address].change.$field
    }
    # Preserve provider identity and other native change metadata as well as resource values.
    $beforeMetadata = Copy-D2RuntimeValue $baselineRecords[$record.address].change
    $afterMetadata = Copy-D2RuntimeValue $record.change
    foreach ($field in @('actions', 'before', 'after', 'after_unknown')) {
      $beforeMetadata.PSObject.Properties.Remove($field)
      $afterMetadata.PSObject.Properties.Remove($field)
    }
    Assert-D2ProviderConfigurationValueEqual $afterMetadata $beforeMetadata
    if (-not $priorMap.ContainsKey($record.address) -or -not $plannedMap.ContainsKey($record.address)) {
      throw 'D2ProviderPlanResourceMissing'
    }
    Assert-NoTerraformReplacementPaths $record.change
    Assert-D2ProviderConfigurationValueEqual $record.change.before $priorMap[$record.address]
    Assert-D2ProviderConfigurationValueEqual $record.change.after $plannedMap[$record.address]
    Assert-D2ProviderConfigurationValueEqual $record.change.before_sensitive $record.change.after_sensitive
    $unknowns = @(Get-GatewayUnknownTrueLeafPaths $record.change.after_unknown | Sort-Object -CaseSensitive)
    # A registry-only change must still bind the unchanged Gateway pair to the exact
    # development identity and baseline selectors; no-op is not a weaker identity check.
    if ($providerAddresses -ccontains $record.address) {
      $scheduled = $record.address -cmatch '\.d2_community_scheduled\[0\]$'
      $functionName = if ($scheduled) { 'ai-job-apply-development-d2-community-scheduled' } else { 'ai-job-apply-development-gateway' }
      $original = $record.change.before
      if ($record.type -ceq 'aws_lambda_function') {
        if ($original.function_name -cne $functionName -or $original.arn -cne "arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:$functionName" -or
            @($original.environment).Count -ne 1 -or @($record.change.after.environment).Count -ne 1 -or
            $original.environment[0].variables.D2_DEPLOYMENT_ENVIRONMENT -cne 'development' -or
            $original.environment[0].variables.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED -cne 'true' -or
            $original.version -isnot [string] -or $original.version -cnotmatch '^[1-9][0-9]*$') { throw 'D2ProviderFunctionBindingRejected' }
        Assert-D2ProviderEnvironmentBudget $original.environment[0].variables
        Assert-D2ProviderEnvironmentBudget $record.change.after.environment[0].variables
        Assert-D2ProviderConfigurationValueEqual $original.environment[0].variables (Get-D2ProviderExpectedEnvironment $original.environment[0].variables $oldSelection $scheduled)
      } elseif ($record.type -ceq 'aws_lambda_alias') {
        if ($original.name -cne 'development' -or $original.function_name -cne $functionName -or
            $original.function_version -isnot [string] -or $original.function_version -cnotmatch '^[1-9][0-9]*$') { throw 'D2ProviderAliasBindingRejected' }
      } else { throw 'D2ProviderTargetTypeRejected' }
    }
    if ($expectedAddresses -cnotcontains $record.address) {
      if ((@($record.change.actions) -join ',') -cne 'no-op' -or $unknowns.Count -ne 0) { throw 'D2ProviderNonTargetChanged' }
      Assert-D2ProviderConfigurationValueEqual $record.change.before $record.change.after
      continue
    }
    if ((@($record.change.actions) -join ',') -cne 'update') { throw 'D2ProviderNonUpdateRejected' }
    $before = Copy-D2RuntimeValue $record.change.before
    $after = Copy-D2RuntimeValue $record.change.after
    if ($record.type -ceq 'aws_lambda_function') {
      $expectedEnvironment = Get-D2ProviderExpectedEnvironment $before.environment[0].variables $Configuration $scheduled
      Assert-D2ProviderConfigurationValueEqual $after.environment[0].variables $expectedEnvironment
      $before.environment[0].variables = $expectedEnvironment
      Assert-D2ProviderConfigurationValueEqual $unknowns @('qualified_arn', 'qualified_invoke_arn', 'version')
      foreach ($field in @('qualified_arn', 'qualified_invoke_arn', 'version')) {
        if ($null -ne $after.PSObject.Properties[$field]) { throw 'D2ProviderFunctionVersionNotUnknown' }
        $before.PSObject.Properties.Remove($field)
      }
    } elseif ($record.type -ceq 'aws_lambda_alias') {
      if ($null -ne $after.PSObject.Properties['function_version']) { throw 'D2ProviderAliasBindingRejected' }
      Assert-D2ProviderConfigurationValueEqual $unknowns @('function_version')
      $before.PSObject.Properties.Remove('function_version')
    } else { throw 'D2ProviderTargetTypeRejected' }
    Assert-D2ProviderConfigurationValueEqual $before $after
  }
  if (@($Plan.resource_changes | Where-Object { $_.mode -ceq 'managed' }).Count -ne $priorMap.Count) {
    throw 'D2ProviderManagedInventoryIncomplete'
  }
  return [pscustomobject]@{
    Kind = 'development-d2-provider-configuration-plan-validation'; ChangedResources = $changed.Count
    ManagedResources = $priorMap.Count; ExistingSourcesPreserved = $true
    ConfigurationSha256 = Get-D2RuntimeDigest $Configuration
    DeploymentOrApprovalPerformed = $false
  }
}
