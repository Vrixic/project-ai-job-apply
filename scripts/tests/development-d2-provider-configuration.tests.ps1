Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../lib/development-d2-provider-configuration.ps1')
$passed = 0
function Assert-True {
  param([bool]$Value, [string]$Case)
  if (-not $Value) { throw "Generated assertion failed: $Case" }
  $script:passed++
}
function Assert-Rejected {
  param([scriptblock]$Operation, [string]$Case)
  $rejected = $false
  try { $null = & $Operation } catch { $rejected = $true }
  Assert-True $rejected $Case
}
function ConvertTo-FixtureJson { param([object]$Value); ConvertTo-Json -InputObject $Value -Depth 80 -Compress }
$account = '111122223333'
$sources = @(
  [pscustomobject]@{ schemaVersion = 1; provider = 'greenhouse'; sourceId = 'gh-existing'; enabled = $true
    boardToken = 'example'; companyName = 'Example'; verifiedCompanyDomain = 'example.com' },
  [pscustomobject]@{ schemaVersion = 1; provider = 'lever'; sourceId = 'lever-new'; enabled = $true
    site = 'examplelever'; region = 'global'; companyName = 'Lever Example'; verifiedCompanyDomain = 'lever.example.com' },
  [pscustomobject]@{ schemaVersion = 1; provider = 'ashby'; sourceId = 'ashby-new'; enabled = $true
    jobBoardName = 'exampleashby'; companyName = 'Ashby Example'; verifiedCompanyDomain = 'ashby.example.com' }
)
$registrations = @(
  [pscustomobject]@{ sourceId = 'gh-existing'; provider = 'greenhouse'; pageVariant = 'greenhouse-board-v1'; atsTenant = 'example'; sourcePolicyVersion = 'policy-v1' },
  [pscustomobject]@{ sourceId = 'lever-new'; provider = 'lever'; pageVariant = 'lever-posting-v1'; atsTenant = 'examplelever'; sourcePolicyVersion = 'policy-v1' },
  [pscustomobject]@{ sourceId = 'ashby-new'; provider = 'ashby'; pageVariant = 'ashby-job-board-v1'; atsTenant = 'exampleashby'; sourcePolicyVersion = 'policy-v1' }
)
$configuration = [pscustomobject]@{
  development_contribution_providers = @('greenhouse', 'lever', 'ashby')
  development_contribution_domains = @('boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com')
  provider_sources_json = ConvertTo-FixtureJson $sources
  provider_verification_registrations_json = ConvertTo-FixtureJson $registrations
}
$variables = [pscustomobject]@{
  deploy_applications = [pscustomobject]@{ value = 'true' }
  deploy_gateway_lambda = [pscustomobject]@{ value = 'true' }
  serverless_runtime_enabled = [pscustomobject]@{ value = 'true' }
  candidate_deletion_restore_role_enabled = [pscustomobject]@{ value = $false }
  gateway_lambda_artifact_s3_key = [pscustomobject]@{ value = 'exact-gateway-key' }
  gateway_lambda_artifact_s3_object_version = [pscustomobject]@{ value = 'exact-gateway-version' }
  gateway_lambda_artifact_sha256 = [pscustomobject]@{ value = ('a' * 64) }
  gateway_lambda_artifact_base64sha256 = [pscustomobject]@{ value = [Convert]::ToBase64String([byte[]](1..32)) }
  migration_image = [pscustomobject]@{ value = 'exact-image@sha256:synthetic' }
  d2_community_runtime = [pscustomobject]@{ value = [pscustomobject]@{
      deploy = $true; enabled = $true; development_contributions_enabled = $true; provider_activation_allowed = $true
      artifact_s3_key = 'exact-worker-key'; artifact_s3_object_version = 'exact-worker-version'
      artifact_sha256 = ('b' * 64); artifact_base64sha256 = [Convert]::ToBase64String([byte[]](33..64))
      scheduled_reserved_concurrency = 1; signal_reserved_concurrency = 2
      provider_sources_json = ConvertTo-FixtureJson @($sources[0])
      provider_verification_registrations_json = ConvertTo-FixtureJson @($registrations[0])
      trust_reviewer_assignments_json = '[]'; trust_evidence_allowlist_json = '[]'
      processing_policy_json = '{"preserved":true}'; policy_version = 'exact-policy-v1'
    } }
}
for ($index = 0; @($variables.PSObject.Properties).Count -lt 103; $index++) {
  $variables | Add-Member ("retained_input_$index") ([pscustomobject]@{ value = [pscustomobject]@{ exact = $index; order = @('b', 'a') } })
}
function New-FixtureResource {
  param([string]$Type, [string]$Name, [object]$Value)
  [pscustomobject]@{ address = "module.platform.$Type.$Name"; mode = 'managed'; type = $Type
    name = ($Name -replace '\[0\]$', ''); provider_name = 'registry.terraform.io/hashicorp/aws'
    schema_version = 0; values = $Value; sensitive_values = [pscustomobject]@{} }
}
function New-FixtureChange {
  param([object]$Resource)
  [pscustomobject]@{ address = $Resource.address; module_address = 'module.platform'; mode = $Resource.mode
    type = $Resource.type; name = $Resource.name; provider_name = $Resource.provider_name
    change = [pscustomobject]@{ actions = @('no-op'); before = Copy-D2RuntimeValue $Resource.values
      after = Copy-D2RuntimeValue $Resource.values; after_unknown = [pscustomobject]@{}
      before_sensitive = [pscustomobject]@{}; after_sensitive = [pscustomobject]@{} } }
}
function New-ConfigurationFixture {
  param([bool]$Maintenance = $false, [object]$Selection = $configuration,
    [AllowNull()][object]$BaselineSelection = $null, [int[]]$UpdatedIndices = @(0, 1, 2, 3))
  $inputVariables = Copy-D2RuntimeValue $variables
  if ($null -ne $BaselineSelection) { $inputVariables = New-D2ProviderConfigurationVariables $inputVariables $BaselineSelection }
  if ($Maintenance) { $inputVariables.d2_community_runtime.value | Add-Member maintenance_mode $true }
  $resources = [Collections.Generic.List[object]]::new()
  foreach ($kind in @('gateway', 'd2_community_scheduled')) {
    $scheduled = $kind -ceq 'd2_community_scheduled'
    $name = if ($scheduled) { 'ai-job-apply-development-d2-community-scheduled' } else { 'ai-job-apply-development-gateway' }
    $arn = "arn:aws:lambda:us-east-2:$account`:function:$name"
    $environment = [pscustomobject]@{
      RELEASE_SHA = ('c' * 40); D2_DEPLOYMENT_ENVIRONMENT = 'development'; D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED = 'true'
      AUTH0_ISSUER_BASE_URL = 'https://synthetic.example.invalid/'; DATABASE_SECRET_ARN = 'exact-preserved-reference'
      D2_TRUST_REVIEWER_ASSIGNMENTS_JSON = '[]'; D2_TRUST_EVIDENCE_ALLOWLIST_JSON = '[]'
    }
    if ($scheduled) {
      $environment | Add-Member D2_COMMUNITY_PROVIDER_SOURCES_JSON $inputVariables.d2_community_runtime.value.provider_sources_json
      $environment | Add-Member D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON $inputVariables.d2_community_runtime.value.provider_verification_registrations_json
      $environment | Add-Member D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED 'true'
      $environment | Add-Member D2_COMMUNITY_RUNTIME_ENABLED (-not $Maintenance).ToString().ToLowerInvariant()
    } else {
      $environment | Add-Member D2_CONTRIBUTION_ROUTES_ENABLED (-not $Maintenance).ToString().ToLowerInvariant()
      $environment | Add-Member D2_TRUST_REVIEWER_ROUTES_ENABLED (-not $Maintenance).ToString().ToLowerInvariant()
    }
    if ($null -ne $BaselineSelection) { $environment = Get-D2ProviderExpectedEnvironment $environment $BaselineSelection $scheduled }
    $functionValue = [pscustomobject]@{
      arn = $arn; function_name = $name; version = '61'; qualified_arn = "$arn`:61"; qualified_invoke_arn = 'exact-qualified-invoke'
      s3_bucket = 'synthetic-private-artifacts'; s3_key = "exact-$kind-key"; s3_object_version = "exact-$kind-version"
      source_code_hash = 'exact-code'; code_sha256 = 'exact-code'; last_modified = '2026-09-11T00:00:00.000+0000'
      environment = @([pscustomobject]@{ variables = $environment }); runtime = 'nodejs24.x'; handler = 'index.handler'
      role = "arn:aws:iam::$account`:role/synthetic-$kind"; timeout = 180; memory_size = 512; architectures = @('arm64')
      reserved_concurrent_executions = $(if ($scheduled -and $Maintenance) { 0 } elseif ($scheduled) { 1 } else { 5 })
      vpc_config = @([pscustomobject]@{ subnet_ids = @('subnet-a', 'subnet-b'); security_group_ids = @('sg-exact') })
      tags = [pscustomobject]@{}; tags_all = [pscustomobject]@{ Environment = 'development' }
    }
    $resources.Add((New-FixtureResource aws_lambda_function "$kind[0]" $functionValue))
    $resources.Add((New-FixtureResource aws_lambda_alias "$kind[0]" ([pscustomobject]@{
          arn = "$arn`:development"; name = 'development'; function_name = $name; function_version = '61'
          routing_config = @(); description = 'exact development alias'
        })))
  }
  $resources.Add((New-FixtureResource aws_lambda_function 'd2_trust_signal[0]' ([pscustomobject]@{
        function_name = 'exact-trust'; environment = @([pscustomobject]@{ variables = [pscustomobject]@{ PRESERVED = 'yes' } })
        source_code_hash = 'exact-trust'; role = 'exact-trust-role'; reserved_concurrent_executions = 2
      })))
  $resources.Add((New-FixtureResource aws_iam_role_policy 'gateway[0]' ([pscustomobject]@{ policy = '{"Statement":[]}'; role = 'exact' })))
  $resources.Add((New-FixtureResource aws_vpc_endpoint 'candidate_documents_s3[0]' ([pscustomobject]@{ policy = '{"Statement":[]}'; vpc_id = 'exact' })))
  $resources.Add((New-FixtureResource aws_db_instance 'postgres[0]' ([pscustomobject]@{ id = 'exact-postgres'; latest_restorable_time = '2026-09-11T00:00:00Z'; publicly_accessible = $false })))
  $resources.Add((New-FixtureResource aws_kms_key 'platform' ([pscustomobject]@{ arn = "arn:aws:kms:us-east-2:$account`:key/12345678-1234-1234-1234-123456789abc" })))
  $resources.Add((New-FixtureResource aws_cloudwatch_event_rule 'd2_community_schedule[0]' ([pscustomobject]@{ state = $(if ($Maintenance) { 'DISABLED' } else { 'ENABLED' }); schedule_expression = 'rate(1 minute)' })))
  $rootModule = [pscustomobject]@{ child_modules = @([pscustomobject]@{ address = 'module.platform'; resources = $resources.ToArray() }) }
  $baseline = [pscustomobject]@{
    terraform_version = '1.16.2'; complete = $true; errored = $false; applyable = $false
    variables = $inputVariables; resource_drift = @(); configuration = [pscustomobject]@{ preserved = @('all', 'source', 'expressions') }
    planned_values = [pscustomobject]@{ root_module = $rootModule; outputs = [pscustomobject]@{ exact = [pscustomobject]@{ sensitive = $false; type = 'string'; value = 'unchanged' } } }
    resource_changes = @($resources.ToArray() | ForEach-Object { New-FixtureChange $_ })
    output_changes = [pscustomobject]@{ exact = [pscustomobject]@{ actions = @('no-op'); before = 'unchanged'; after = 'unchanged'; after_unknown = $false; before_sensitive = $false; after_sensitive = $false } }
  }
  $plan = Copy-D2RuntimeValue $baseline
  $plan.applyable = $true
  $plan.variables = New-D2ProviderConfigurationVariables $inputVariables $Selection
  $plan | Add-Member prior_state ([pscustomobject]@{ values = [pscustomobject]@{ root_module = Copy-D2RuntimeValue $rootModule } })
  foreach ($index in $UpdatedIndices) {
    $record = $plan.resource_changes[$index]
    $record.change.actions = @('update')
    if ($record.type -ceq 'aws_lambda_function') {
      $record.change.after.environment[0].variables = Get-D2ProviderExpectedEnvironment $record.change.before.environment[0].variables $Selection ($index -eq 2)
      $record.change.after_unknown = [pscustomobject]@{ qualified_arn = $true; qualified_invoke_arn = $true; version = $true }
      foreach ($field in @('qualified_arn', 'qualified_invoke_arn', 'version')) { $record.change.after.PSObject.Properties.Remove($field) }
    } else {
      $record.change.after_unknown = [pscustomobject]@{ function_version = $true }
      $record.change.after.PSObject.Properties.Remove('function_version')
    }
    $plan.planned_values.root_module.child_modules[0].resources[$index].values = Copy-D2RuntimeValue $record.change.after
  }
  [pscustomobject]@{ Baseline = $baseline; Plan = $plan; Configuration = Copy-D2RuntimeValue $Selection }
}
function Assert-Fixture {
  param([object]$Fixture)
  Assert-D2ProviderConfigurationPlan $Fixture.Plan $Fixture.Baseline $Fixture.Configuration $account
}
function Sync-PlannedValue {
  param([object]$Fixture, [int]$Index)
  $Fixture.Plan.planned_values.root_module.child_modules[0].resources[$Index].values = Copy-D2RuntimeValue $Fixture.Plan.resource_changes[$Index].change.after
}

$null = Assert-D2ProviderEnvironmentBudget ([pscustomobject]@{ AA = ('x' * 4094) }); $passed++
$null = Assert-D2ProviderEnvironmentBudget ([pscustomobject]@{ AA = ([string][char]0x00e9 * 2047) }); $passed++
$null = Assert-D2ProviderEnvironmentBudget ([pscustomobject]@{ AA = ('x' * 2045); BB = ('x' * 2047) }); $passed++
foreach ($oversized in @(
    [pscustomobject]@{ AA = ('x' * 4095) },
    [pscustomobject]@{ AA = ([string][char]0x00e9 * 2048) },
    [pscustomobject]@{ AA = ('x' * 2046); BB = ('x' * 2047) }
  )) {
  Assert-Rejected { Assert-D2ProviderEnvironmentBudget $oversized } 'exact environment budget includes all UTF8 keys and values'
}
$wideKey = [pscustomobject]@{}
$wideKey | Add-Member ([string][char]0x00e9 * 2048) 'x'
Assert-Rejected { Assert-D2ProviderEnvironmentBudget $wideKey } 'environment key UTF8 bytes are counted'
foreach ($invalid in @([pscustomobject]@{ AA = 1 }, [pscustomobject]@{ AA = $null }, [pscustomobject]@{ AA = [string][char]0xd800 })) {
  Assert-Rejected { Assert-D2ProviderEnvironmentBudget $invalid } 'environment values require bounded well-formed UTF8 strings'
}
$safeBudgetError = ''
try { Assert-D2ProviderEnvironmentBudget ([pscustomobject]@{ PRIVATE_VALUE_MARKER = ('synthetic-private-value-' * 200) }) }
catch { $safeBudgetError = $_.Exception.Message }
Assert-True ($safeBudgetError -ceq 'D2ProviderEnvironmentBudgetRejected') 'environment budget error never reflects names or values'

$old = Read-D2ProviderConfigurationRegistries $variables.d2_community_runtime.value
Assert-True ($old.Sources -is [array] -and $old.Sources.Count -eq 1 -and $old.Registrations -is [array] -and $old.Registrations.Count -eq 1) 'single existing GH arrays retain shape'
$beforeDigest = Get-D2RuntimeDigest $variables
$selectionDigest = Get-D2RuntimeDigest $configuration
$next = New-D2ProviderConfigurationVariables $variables $configuration
Assert-True ((Get-D2RuntimeDigest $variables) -ceq $beforeDigest -and (Get-D2RuntimeDigest $configuration) -ceq $selectionDigest) 'reconstruction does not mutate inputs'
Assert-True (@($next.PSObject.Properties).Count -eq 103) 'entire 103 input inventory retained'
$next.d2_community_runtime.value.development_contribution_domains[0] = 'synthetic-change'
Assert-True ((Get-D2RuntimeDigest $configuration) -ceq $selectionDigest) 'reconstructed selection is an independent clone'
foreach ($emptyMode in @('null', 'empty')) {
  $selection = Copy-D2RuntimeValue $configuration
  if ($emptyMode -ceq 'null') { $selection.development_contribution_domains = $null } else { $selection.development_contribution_domains = @() }
  $copy = New-D2ProviderConfigurationVariables $variables $selection
  $environment = Get-D2ProviderExpectedEnvironment ([pscustomobject]@{ PRESERVED = 'yes' }) $selection $false
  if ($emptyMode -ceq 'null') {
    Assert-True ($null -eq $copy.d2_community_runtime.value.development_contribution_domains -and $null -eq $environment.PSObject.Properties['D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON']) 'null omits domain environment key'
  } else {
    Assert-True ($copy.d2_community_runtime.value.development_contribution_domains -is [array] -and $copy.d2_community_runtime.value.development_contribution_domains.Count -eq 0 -and $environment.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON -ceq '[]') 'empty means explicit deny all'
  }
  Assert-Rejected { Assert-D2ProviderAdditiveConfiguration $variables.d2_community_runtime.value $copy.d2_community_runtime.value $selection } 'activation-specific scope must retain GH and explicitly exclude EU'
}
foreach ($maintenance in @($false, $true)) {
  $good = New-ConfigurationFixture $maintenance
  $frozen = Get-D2RuntimeDigest $good
  $result = Assert-Fixture $good
  Assert-True ($result.ChangedResources -eq 4 -and $result.ManagedResources -eq 10 -and $result.ExistingSourcesPreserved -and -not $result.DeploymentOrApprovalPerformed) 'exact configuration-only plan accepted without deployment claim'
  Assert-True ((Get-D2RuntimeDigest $good) -ceq $frozen) 'plan validation is pure'
  Assert-True ((Get-D2RuntimeMaintenance (Get-D2RuntimeConfiguration $good.Plan.variables)) -eq $maintenance) 'maintenance preserved with no migration prerequisite'
}
$leverSelection = Copy-D2RuntimeValue $configuration
$leverSelection.development_contribution_providers = @('greenhouse', 'lever')
$leverSelection.development_contribution_domains = @('boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co')
$leverSelection.provider_sources_json = ConvertTo-FixtureJson @($sources[0], $sources[1])
$leverSelection.provider_verification_registrations_json = ConvertTo-FixtureJson @($registrations[0], $registrations[1])
foreach ($maintenance in @($false, $true)) {
  $leverFixture = New-ConfigurationFixture -Maintenance $maintenance -Selection $leverSelection
  $result = Assert-Fixture $leverFixture
  Assert-True ($result.ChangedResources -eq 4 -and $result.ExistingSourcesPreserved) 'global Lever-only addition with three hosts accepted'
}
$boardSelection = Copy-D2RuntimeValue $configuration
$boardSelection.provider_sources_json = ConvertTo-FixtureJson (@($sources) + @(
    [pscustomobject]@{ schemaVersion = 1; provider = 'ashby'; sourceId = 'ashby-fourth'; enabled = $true
      jobBoardName = 'FourthBoard'; companyName = 'Fourth Example'; verifiedCompanyDomain = 'fourth.example.com' }
  ))
$boardSelection.provider_verification_registrations_json = ConvertTo-FixtureJson (@($registrations) + @(
    [pscustomobject]@{ sourceId = 'ashby-fourth'; provider = 'ashby'; pageVariant = 'ashby-job-board-v1'; atsTenant = 'fourthboard'; sourcePolicyVersion = 'policy-v1' }
  ))
foreach ($maintenance in @($false, $true)) {
  $boardFixture = New-ConfigurationFixture -Maintenance $maintenance -Selection $boardSelection -BaselineSelection $configuration -UpdatedIndices @(2, 3)
  $frozen = Get-D2RuntimeDigest $boardFixture
  $result = Assert-Fixture $boardFixture
  Assert-True ($result.ChangedResources -eq 2 -and $result.ManagedResources -eq 10 -and $result.ExistingSourcesPreserved -and -not $result.DeploymentOrApprovalPerformed) 'fourth same-provider board requires only scheduled function and alias'
  Assert-True ((Get-D2RuntimeDigest $boardFixture) -ceq $frozen) 'registry-only validation is pure'
  Assert-True ((Get-D2RuntimeMaintenance (Get-D2RuntimeConfiguration $boardFixture.Plan.variables)) -eq $maintenance) 'registry-only update preserves maintenance'
  foreach ($index in @(0, 1)) {
    Assert-True ((ConvertTo-DeploymentCanonicalValue $boardFixture.Plan.resource_changes[$index]) -ceq (ConvertTo-DeploymentCanonicalValue $boardFixture.Baseline.resource_changes[$index])) 'Gateway function and alias remain exact no-ops'
  }
  $added = Read-D2ProviderConfigurationRegistries $boardFixture.Plan.variables.d2_community_runtime.value
  Assert-True ($added.Sources.Count -eq 4 -and $added.Registrations.Count -eq 4 -and $added.Sources[3].jobBoardName -ceq 'FourthBoard' -and $added.Registrations[3].atsTenant -ceq 'fourthboard') 'board token case is preserved while registration tenant is normalized'
}
$boardFixture = New-ConfigurationFixture -Selection $boardSelection -BaselineSelection $configuration -UpdatedIndices @(2, 3)
foreach ($index in @(0, 1)) {
  $bad = Copy-D2RuntimeValue $boardFixture
  $missingAddress = $bad.Plan.resource_changes[$index].address
  foreach ($nativePlan in @($bad.Plan, $bad.Baseline)) {
    $nativePlan.resource_changes = @($nativePlan.resource_changes | Where-Object { $_.address -cne $missingAddress })
    $nativePlan.planned_values.root_module.child_modules[0].resources = @($nativePlan.planned_values.root_module.child_modules[0].resources | Where-Object { $_.address -cne $missingAddress })
  }
  $bad.Plan.prior_state.values.root_module.child_modules[0].resources = @($bad.Plan.prior_state.values.root_module.child_modules[0].resources | Where-Object { $_.address -cne $missingAddress })
  Assert-Rejected { Assert-Fixture $bad } 'registry-only cannot consistently omit a required unchanged Gateway resource'
}
Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $boardSelection -BaselineSelection $configuration) } 'registry-only plan cannot include otherwise unnecessary Gateway pair updates'
foreach ($missing in @(2, 3)) {
  $indices = @(2, 3) | Where-Object { $_ -ne $missing }
  Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $boardSelection -BaselineSelection $configuration -UpdatedIndices $indices) } 'both scheduled function and alias are required'
}
Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -UpdatedIndices @(2, 3)) } 'provider and domain expansion cannot use the registry-only resource set'
$hostBaseline = Copy-D2RuntimeValue $configuration
$hostBaseline.development_contribution_domains = $null
Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $boardSelection -BaselineSelection $hostBaseline -UpdatedIndices @(2, 3)) } 'domain-only selector change still requires Gateway pair'
$null = Assert-Fixture (New-ConfigurationFixture -Selection $boardSelection -BaselineSelection $hostBaseline); $passed++
$providerOrder = Copy-D2RuntimeValue $boardSelection
$providerOrder.development_contribution_providers = @('greenhouse', 'ashby', 'lever')
Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $providerOrder -BaselineSelection $configuration -UpdatedIndices @(2, 3)) } 'provider-only encoded selector change still requires Gateway pair'
$null = Assert-Fixture (New-ConfigurationFixture -Selection $providerOrder -BaselineSelection $configuration); $passed++
foreach ($mutation in @(
    @{ Name = 'Gateway function unexpected update'; Edit = { param($x) $x.Plan.resource_changes[0].change.actions = @('update') } },
    @{ Name = 'Gateway alias unexpected update'; Edit = { param($x) $x.Plan.resource_changes[1].change.actions = @('update') } },
    @{ Name = 'Gateway hidden env delta'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.environment[0].variables.RELEASE_SHA = 'changed'; Sync-PlannedValue $x 0 } },
    @{ Name = 'Gateway hidden alias delta'; Edit = { param($x) $x.Plan.resource_changes[1].change.after.function_version = '62'; Sync-PlannedValue $x 1 } },
    @{ Name = 'Gateway unknown no-op'; Edit = { param($x) $x.Plan.resource_changes[0].change.after_unknown | Add-Member version $true } },
    @{ Name = 'missing no-op inventory'; Edit = { param($x) $x.Plan.resource_changes = @($x.Plan.resource_changes | Select-Object -Skip 1) } },
    @{ Name = 'scheduled replacement'; Edit = { param($x) $x.Plan.resource_changes[2].change.actions = @('delete', 'create') } },
    @{ Name = 'scheduled replacement path'; Edit = { param($x) $x.Plan.resource_changes[2].change | Add-Member replace_paths @(@('role')) } },
    @{ Name = 'scheduled provider wrapper'; Edit = { param($x) $x.Plan.resource_changes[2].provider_name = 'other' } },
    @{ Name = 'scheduled planned wrapper'; Edit = { param($x) $x.Plan.planned_values.root_module.child_modules[0].resources[2].schema_version = 1 } },
    @{ Name = 'scheduled sensitive metadata'; Edit = { param($x) $x.Plan.resource_changes[2].change.before_sensitive | Add-Member role $true; $x.Plan.resource_changes[2].change.after_sensitive | Add-Member role $true } },
    @{ Name = 'scheduled identity metadata'; Edit = { param($x) $x.Plan.resource_changes[2].change | Add-Member before_identity ([pscustomobject]@{ altered = $true }) } },
    @{ Name = 'scheduled artifact delta'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.s3_object_version = 'changed'; Sync-PlannedValue $x 2 } },
    @{ Name = 'scheduled reviewer delta'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON = '[{}]'; Sync-PlannedValue $x 2 } },
    @{ Name = 'scheduled unknown artifact'; Edit = { param($x) $x.Plan.resource_changes[2].change.after_unknown | Add-Member code_sha256 $true } },
    @{ Name = 'scheduled missing unknown'; Edit = { param($x) $x.Plan.resource_changes[2].change.after_unknown.PSObject.Properties.Remove('version') } },
    @{ Name = 'scheduled typed unknown'; Edit = { param($x) $x.Plan.resource_changes[2].change.after_unknown.version = 'true' } },
    @{ Name = 'scheduled known function version'; Edit = { param($x) $x.Plan.resource_changes[2].change.after | Add-Member version '62'; Sync-PlannedValue $x 2 } },
    @{ Name = 'scheduled known alias version'; Edit = { param($x) $x.Plan.resource_changes[3].change.after | Add-Member function_version '62'; Sync-PlannedValue $x 3 } },
    @{ Name = 'scheduled alias weights'; Edit = { param($x) $x.Plan.resource_changes[3].change.after.routing_config = @([pscustomobject]@{ additional_version_weights = [pscustomobject]@{ '60' = 0.1 } }); Sync-PlannedValue $x 3 } },
    @{ Name = 'scheduled IAM change'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.role = 'changed'; Sync-PlannedValue $x 2 } },
    @{ Name = 'scheduled network change'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.vpc_config[0].subnet_ids[0] = 'changed'; Sync-PlannedValue $x 2 } },
    @{ Name = 'scheduled budget change'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.reserved_concurrent_executions = 2; Sync-PlannedValue $x 2 } },
    @{ Name = 'Trust no-op change'; Edit = { param($x) $x.Plan.resource_changes[4].change.after.source_code_hash = 'changed'; Sync-PlannedValue $x 4 } },
    @{ Name = 'changed plan source'; Edit = { param($x) $x.Plan.configuration.preserved[0] = 'changed' } },
    @{ Name = 'output change'; Edit = { param($x) $x.Plan.planned_values.outputs.exact.value = 'changed' } }
  )) {
  $bad = Copy-D2RuntimeValue $boardFixture
  & $mutation.Edit $bad
  Assert-Rejected { Assert-Fixture $bad } ('registry-only ' + $mutation.Name)
}
foreach ($index in @(0, 2)) {
  foreach ($field in @('arn', 'function_name')) {
    $bad = Copy-D2RuntimeValue $boardFixture
    foreach ($value in @($bad.Baseline.resource_changes[$index].change.before, $bad.Baseline.resource_changes[$index].change.after,
        $bad.Baseline.planned_values.root_module.child_modules[0].resources[$index].values,
        $bad.Plan.prior_state.values.root_module.child_modules[0].resources[$index].values,
        $bad.Plan.resource_changes[$index].change.before, $bad.Plan.resource_changes[$index].change.after)) { $value.$field = 'wrong-target' }
    Sync-PlannedValue $bad $index
    Assert-Rejected { Assert-Fixture $bad } 'registry-only both Gateway and scheduled identities remain independently bound'
  }
}
Assert-Rejected { Assert-D2ProviderConfigurationPlan $boardFixture.Plan $boardFixture.Baseline $boardFixture.Configuration '999988887777' } 'registry-only exact account remains caller-bound'
foreach ($index in @(0, 2)) {
  foreach ($padding in @(('x' * 4090), ([string][char]0x00e9 * 2040))) {
    $bad = Copy-D2RuntimeValue $boardFixture
    # Keep every before/after map and no-op record synchronized. Only the full
    # Lambda environment budget, not a plan inconsistency, should reject this.
    foreach ($value in @($bad.Baseline.resource_changes[$index].change.before, $bad.Baseline.resource_changes[$index].change.after,
        $bad.Baseline.planned_values.root_module.child_modules[0].resources[$index].values,
        $bad.Plan.prior_state.values.root_module.child_modules[0].resources[$index].values,
        $bad.Plan.resource_changes[$index].change.before, $bad.Plan.resource_changes[$index].change.after)) {
      $value.environment[0].variables | Add-Member SYNTHETIC_PADDING $padding
    }
    Sync-PlannedValue $bad $index
    Assert-Rejected { Assert-Fixture $bad } 'full before/after environment cap also binds unchanged Gateway'
  }
}
$grown = Copy-D2RuntimeValue $boardFixture
$beforeEnvironmentBytes = 0
foreach ($property in $grown.Plan.resource_changes[2].change.before.environment[0].variables.PSObject.Properties) {
  $beforeEnvironmentBytes += [Text.Encoding]::UTF8.GetByteCount($property.Name) + [Text.Encoding]::UTF8.GetByteCount($property.Value)
}
$padding = 'x' * (4096 - $beforeEnvironmentBytes - 'SYNTHETIC_PADDING'.Length)
foreach ($value in @($grown.Baseline.resource_changes[2].change.before, $grown.Baseline.resource_changes[2].change.after,
    $grown.Baseline.planned_values.root_module.child_modules[0].resources[2].values,
    $grown.Plan.prior_state.values.root_module.child_modules[0].resources[2].values,
    $grown.Plan.resource_changes[2].change.before, $grown.Plan.resource_changes[2].change.after)) {
  $value.environment[0].variables | Add-Member SYNTHETIC_PADDING $padding
}
Sync-PlannedValue $grown 2
$null = Assert-D2ProviderEnvironmentBudget $grown.Plan.resource_changes[2].change.before.environment[0].variables; $passed++
$growthError = ''
try { $null = Assert-Fixture $grown } catch { $growthError = $_.Exception.Message }
Assert-True ($growthError -ceq 'D2ProviderEnvironmentBudgetRejected') 'valid 4096-byte baseline refuses registry growth beyond full environment limit'
foreach ($edit in @(
    { param($x) $x.sources[2].companyName = 'changed' },
    { param($x) $x.registrations[2].sourcePolicyVersion = 'policy-v2' },
    { param($x) $x.registrations[3].atsTenant = 'FourthBoard' },
    { param($x) $x.sources[3].jobBoardName = 'exampleashby'; $x.registrations[3].atsTenant = 'exampleashby' }
  )) {
  $selection = Copy-D2RuntimeValue $boardSelection
  $wrapper = ConvertFrom-D2RuntimeJson ('{"sources":' + $selection.provider_sources_json + ',"registrations":' + $selection.provider_verification_registrations_json + '}')
  & $edit $wrapper
  $selection.provider_sources_json = ConvertTo-FixtureJson $wrapper.sources
  $selection.provider_verification_registrations_json = ConvertTo-FixtureJson $wrapper.registrations
  Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $selection -BaselineSelection $configuration -UpdatedIndices @(2, 3)) } 'registry-only preserves old entries and normalized unique tenant binding'
}
$boardRuntime = (New-D2ProviderConfigurationVariables $variables $boardSelection).d2_community_runtime.value
$parts = (ConvertTo-FixtureJson $boardSelection.development_contribution_providers) +
  (ConvertTo-FixtureJson $boardSelection.development_contribution_domains) +
  $boardRuntime.trust_evidence_allowlist_json + $boardRuntime.provider_sources_json +
  $boardRuntime.provider_verification_registrations_json
$reviewerPadding = 2100 - [Text.Encoding]::UTF8.GetByteCount($parts) - 4
Assert-True ($reviewerPadding -gt 0) 'generated fourth-board fixture fits the reviewed 2800 encoded budget'
$boardRuntime.trust_reviewer_assignments_json = '["' + ('x' * $reviewerPadding) + '"]'
$null = Assert-D2ProviderAdditiveConfiguration $configuration $boardRuntime $boardSelection; $passed++
$boardRuntime.trust_reviewer_assignments_json = '["' + ('x' * ($reviewerPadding + 1)) + '"]'
Assert-Rejected { Assert-D2ProviderAdditiveConfiguration $configuration $boardRuntime $boardSelection } 'combined development configuration refuses 2804 encoded characters'
$missingAshby = Copy-D2RuntimeValue $leverSelection
$missingAshby.development_contribution_providers += 'ashby'
$missingAshby.development_contribution_domains += 'jobs.ashbyhq.com'
Assert-Rejected { Assert-Fixture (New-ConfigurationFixture -Selection $missingAshby) } 'Ashby cannot be enabled without its exact source and registration'
$good = New-ConfigurationFixture
$raw = Copy-D2RuntimeValue $good
$raw.Baseline.variables.d2_community_runtime.value = ConvertTo-FixtureJson $raw.Baseline.variables.d2_community_runtime.value
$raw.Plan.variables.d2_community_runtime.value = ConvertTo-FixtureJson $raw.Plan.variables.d2_community_runtime.value
$null = Assert-Fixture $raw; $passed++
$explicitDefault = Copy-D2RuntimeValue $good
foreach ($value in @($explicitDefault.Baseline.variables.d2_community_runtime.value)) {
  $value | Add-Member development_contribution_providers @('greenhouse')
  $value | Add-Member development_contribution_domains $null
}
$null = Assert-Fixture $explicitDefault; $passed++

foreach ($badValue in @('null', '{}', '42', '"text"', '[]', 'not-json', '[],"items":[]')) {
  foreach ($field in @('provider_sources_json', 'provider_verification_registrations_json')) {
    $bad = Copy-D2RuntimeValue $variables.d2_community_runtime.value
    $bad.$field = $badValue
    Assert-Rejected { Read-D2ProviderConfigurationRegistries $bad } 'registry requires an actual nonempty array'
  }
}
foreach ($field in @('development_contribution_domains', 'development_contribution_providers')) {
  foreach ($badValue in @('[]', 1, $true, [pscustomobject]@{}, @('greenhouse', 'greenhouse'), @($null))) {
    $bad = Copy-D2RuntimeValue $configuration; $bad.$field = $badValue
    Assert-Rejected { Assert-D2ProviderConfigurationSelection $bad } 'typed exact unique selections'
  }
}
foreach ($domain in @('JOBS.LEVER.CO', 'jobs.lever.co ', '*.lever.co', 'https://jobs.lever.co', 'jobs.lever.co:443', 'jobs.lever.co.', 'other.invalid')) {
  $bad = Copy-D2RuntimeValue $configuration; $bad.development_contribution_domains = @($domain)
  Assert-Rejected { Assert-D2ProviderConfigurationSelection $bad } 'no domain normalization or alternate spelling'
}
foreach ($field in @('provider_sources_json', 'provider_verification_registrations_json')) {
  $bad = Copy-D2RuntimeValue $configuration; $bad.$field = 'x' * 1801
  Assert-Rejected { Assert-D2ProviderConfigurationSelection $bad } 'bounded registry bytes'
}
$bad = Copy-D2RuntimeValue $configuration; $bad | Add-Member approval $true
Assert-Rejected { Assert-D2ProviderConfigurationSelection $bad } 'closed four-field selection'
foreach ($field in @('development_contributions_enabled', 'provider_activation_allowed')) {
  foreach ($flag in @($false, 'true')) {
    $bad = Copy-D2RuntimeValue $variables; $bad.d2_community_runtime.value.$field = $flag
    Assert-Rejected { New-D2ProviderConfigurationVariables $bad $configuration } 'explicit existing development activation required'
  }
}

# Semantically synchronized plan mutations must still fail; a record/map mismatch alone
# is not enough coverage for immutable code, IAM/network, pins, or environment controls.
$mutations = @(
  @{ Name = 'old toolchain'; Edit = { param($x) $x.Plan.terraform_version = '1.9.8' } },
  @{ Name = 'incomplete'; Edit = { param($x) $x.Plan.complete = $false } },
  @{ Name = 'typed envelope'; Edit = { param($x) $x.Plan.errored = 'false' } },
  @{ Name = 'nonapplyable'; Edit = { param($x) $x.Plan.applyable = $false } },
  @{ Name = 'deferred'; Edit = { param($x) $x.Plan | Add-Member deferred_changes @([pscustomobject]@{}) } },
  @{ Name = 'source config'; Edit = { param($x) $x.Plan.configuration.preserved[0] = 'different' } },
  @{ Name = 'output values'; Edit = { param($x) $x.Plan.planned_values.outputs.exact.value = 'changed' } },
  @{ Name = 'output action'; Edit = { param($x) $x.Plan.output_changes.exact.actions = @('update') } },
  @{ Name = 'output no-op data'; Edit = { param($x) $x.Plan.output_changes.exact.after = 'changed' } },
  @{ Name = 'missing input'; Edit = { param($x) $x.Plan.variables.PSObject.Properties.Remove('retained_input_0') } },
  @{ Name = 'additional input'; Edit = { param($x) $x.Plan.variables | Add-Member extra ([pscustomobject]@{ value = $true }) } },
  @{ Name = 'missing record'; Edit = { param($x) $x.Plan.resource_changes = @($x.Plan.resource_changes | Select-Object -Skip 1) } },
  @{ Name = 'duplicate record'; Edit = { param($x) $x.Plan.resource_changes += $x.Plan.resource_changes[0] } },
  @{ Name = 'create'; Edit = { param($x) $x.Plan.resource_changes[0].change.actions = @('create') } },
  @{ Name = 'replace'; Edit = { param($x) $x.Plan.resource_changes[0].change.actions = @('delete', 'create') } },
  @{ Name = 'replacement path'; Edit = { param($x) $x.Plan.resource_changes[0].change | Add-Member replace_paths @(@('role')) } },
  @{ Name = 'provider wrapper'; Edit = { param($x) $x.Plan.resource_changes[0].provider_name = 'other' } },
  @{ Name = 'planned wrapper'; Edit = { param($x) $x.Plan.planned_values.root_module.child_modules[0].resources[0].schema_version = 1 } },
  @{ Name = 'sensitivity both'; Edit = { param($x) $x.Plan.resource_changes[0].change.before_sensitive | Add-Member role $true; $x.Plan.resource_changes[0].change.after_sensitive | Add-Member role $true } },
  @{ Name = 'opaque identity'; Edit = { param($x) $x.Plan.resource_changes[0].change | Add-Member before_identity ([pscustomobject]@{ altered = $true }) } },
  @{ Name = 'code hash'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.source_code_hash = 'new'; Sync-PlannedValue $x 0 } },
  @{ Name = 'code object'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.s3_object_version = 'new'; Sync-PlannedValue $x 2 } },
  @{ Name = 'release source'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.environment[0].variables.RELEASE_SHA = 'changed'; Sync-PlannedValue $x 0 } },
  @{ Name = 'reviewer env'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON = '[{}]'; Sync-PlannedValue $x 0 } },
  @{ Name = 'identity provider'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.environment[0].variables.AUTH0_ISSUER_BASE_URL = 'changed'; Sync-PlannedValue $x 0 } },
  @{ Name = 'gateway maintenance'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED = 'false'; Sync-PlannedValue $x 0 } },
  @{ Name = 'scheduled concurrency'; Edit = { param($x) $x.Plan.resource_changes[2].change.after.reserved_concurrent_executions = 0; Sync-PlannedValue $x 2 } },
  @{ Name = 'function role'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.role = 'changed'; Sync-PlannedValue $x 0 } },
  @{ Name = 'function network'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.vpc_config[0].subnet_ids[0] = 'changed'; Sync-PlannedValue $x 0 } },
  @{ Name = 'function timeout'; Edit = { param($x) $x.Plan.resource_changes[0].change.after.timeout = 900; Sync-PlannedValue $x 0 } },
  @{ Name = 'unknown code'; Edit = { param($x) $x.Plan.resource_changes[0].change.after_unknown | Add-Member code_sha256 $true } },
  @{ Name = 'unknown scalar type'; Edit = { param($x) $x.Plan.resource_changes[0].change.after_unknown.version = 'true' } },
  @{ Name = 'missing unknown'; Edit = { param($x) $x.Plan.resource_changes[0].change.after_unknown.PSObject.Properties.Remove('version') } },
  @{ Name = 'known function version'; Edit = { param($x) $x.Plan.resource_changes[0].change.after | Add-Member version '62'; Sync-PlannedValue $x 0 } },
  @{ Name = 'known alias version'; Edit = { param($x) $x.Plan.resource_changes[1].change.after | Add-Member function_version '62'; Sync-PlannedValue $x 1 } },
  @{ Name = 'alias weights'; Edit = { param($x) $x.Plan.resource_changes[1].change.after.routing_config = @([pscustomobject]@{ additional_version_weights = [pscustomobject]@{ '60' = 0.1 } }); Sync-PlannedValue $x 1 } },
  @{ Name = 'alias name'; Edit = { param($x) $x.Plan.resource_changes[1].change.after.name = 'production'; Sync-PlannedValue $x 1 } },
  @{ Name = 'trust changes'; Edit = { param($x) $x.Plan.resource_changes[4].change.after.source_code_hash = 'changed'; Sync-PlannedValue $x 4 } },
  @{ Name = 'IAM no-op data'; Edit = { param($x) $x.Plan.resource_changes[5].change.after.policy = 'changed'; Sync-PlannedValue $x 5 } },
  @{ Name = 'network no-op data'; Edit = { param($x) $x.Plan.resource_changes[6].change.after.policy = 'changed'; Sync-PlannedValue $x 6 } },
  @{ Name = 'schedule'; Edit = { param($x) $x.Plan.resource_changes[9].change.after.schedule_expression = 'rate(2 minutes)'; Sync-PlannedValue $x 9 } },
  @{ Name = 'missing managed resource'; Edit = { param($x) $x.Plan.planned_values.root_module.child_modules[0].resources = @($x.Plan.planned_values.root_module.child_modules[0].resources | Select-Object -Skip 1) } },
  @{ Name = 'duplicated managed resource'; Edit = { param($x) $x.Plan.planned_values.root_module.child_modules[0].resources += $x.Plan.planned_values.root_module.child_modules[0].resources[0] } },
  @{ Name = 'undeclared live change'; Edit = { param($x) $x.Plan.prior_state.values.root_module.child_modules[0].resources[5].values.policy = 'changed' } }
)
foreach ($mutation in $mutations) {
  $bad = Copy-D2RuntimeValue $good
  & $mutation.Edit $bad
  Assert-Rejected { Assert-Fixture $bad } $mutation.Name
}
foreach ($field in $variables.PSObject.Properties.Name) {
  if ($field -ceq 'd2_community_runtime') { continue }
  $bad = Copy-D2RuntimeValue $good
  $bad.Plan.variables.$field.value = 'changed'
  Assert-Rejected { Assert-Fixture $bad } 'every unrelated root input remains exact'
}
foreach ($field in $variables.d2_community_runtime.value.PSObject.Properties.Name) {
  if ($field -cin @('provider_sources_json', 'provider_verification_registrations_json')) { continue }
  $bad = Copy-D2RuntimeValue $good
  $bad.Plan.variables.d2_community_runtime.value.$field = 'changed'
  Assert-Rejected { Assert-Fixture $bad } 'every unrelated runtime field remains exact'
}
Assert-Rejected { Assert-D2ProviderConfigurationPlan $good.Plan $good.Baseline $good.Configuration '999988887777' } 'exact private account is caller-bound'
foreach ($field in @('arn', 'function_name')) {
  $bad = Copy-D2RuntimeValue $good
  foreach ($value in @($bad.Baseline.resource_changes[0].change.before, $bad.Baseline.resource_changes[0].change.after,
      $bad.Baseline.planned_values.root_module.child_modules[0].resources[0].values,
      $bad.Plan.prior_state.values.root_module.child_modules[0].resources[0].values,
      $bad.Plan.resource_changes[0].change.before, $bad.Plan.resource_changes[0].change.after)) { $value.$field = 'wrong-target' }
  Sync-PlannedValue $bad 0
  Assert-Rejected { Assert-Fixture $bad } 'target identity is independently fixed'
}

function Assert-RegistryMutationRejected {
  param([scriptblock]$Edit, [string]$Case)
  $badConfiguration = Copy-D2RuntimeValue $configuration
  $wrapper = ConvertFrom-D2RuntimeJson ('{"sources":' + $badConfiguration.provider_sources_json + ',"registrations":' + $badConfiguration.provider_verification_registrations_json + '}')
  & $Edit $wrapper
  $badConfiguration.provider_sources_json = ConvertTo-FixtureJson $wrapper.sources
  $badConfiguration.provider_verification_registrations_json = ConvertTo-FixtureJson $wrapper.registrations
  Assert-Rejected {
    $nextVariables = New-D2ProviderConfigurationVariables $variables $badConfiguration
    Assert-D2ProviderAdditiveConfiguration $variables.d2_community_runtime.value $nextVariables.d2_community_runtime.value $badConfiguration
  } $Case
}
foreach ($mutation in @(
    @{ Name = 'existing company'; Edit = { param($x) $x.sources[0].companyName = 'changed' } },
    @{ Name = 'existing provenance domain'; Edit = { param($x) $x.sources[0].verifiedCompanyDomain = 'other.example.com' } },
    @{ Name = 'existing tenant'; Edit = { param($x) $x.sources[0].boardToken = 'changed'; $x.registrations[0].atsTenant = 'changed' } },
    @{ Name = 'existing source ID'; Edit = { param($x) $x.sources[0].sourceId = 'changed'; $x.registrations[0].sourceId = 'changed' } },
    @{ Name = 'existing source policy'; Edit = { param($x) $x.registrations[0].sourcePolicyVersion = 'policy-v2' } },
    @{ Name = 'source order'; Edit = { param($x) $x.sources = @($x.sources[1], $x.sources[0], $x.sources[2]) } },
    @{ Name = 'registration order'; Edit = { param($x) $x.registrations = @($x.registrations[1], $x.registrations[0], $x.registrations[2]) } },
    @{ Name = 'disabled source'; Edit = { param($x) $x.sources[1].enabled = $false } },
    @{ Name = 'typed schema'; Edit = { param($x) $x.sources[1].schemaVersion = '1' } },
    @{ Name = 'source extra'; Edit = { param($x) $x.sources[1] | Add-Member authority $true } },
    @{ Name = 'registration extra'; Edit = { param($x) $x.registrations[1] | Add-Member authority $true } },
    @{ Name = 'EU source'; Edit = { param($x) $x.sources[1].region = 'eu' } },
    @{ Name = 'new wrong tenant'; Edit = { param($x) $x.registrations[1].atsTenant = 'other' } },
    @{ Name = 'new wrong variant'; Edit = { param($x) $x.registrations[1].pageVariant = 'lever-posting-v2' } },
    @{ Name = 'new wrong provider'; Edit = { param($x) $x.registrations[1].provider = 'ashby' } },
    @{ Name = 'duplicate source'; Edit = { param($x) $x.sources += $x.sources[1]; $x.registrations += $x.registrations[1] } },
    @{ Name = 'missing binding'; Edit = { param($x) $x.registrations = @($x.registrations | Select-Object -Skip 1) } },
    @{ Name = 'missing GH'; Edit = { param($x) $x.sources = @($x.sources | Select-Object -Skip 1); $x.registrations = @($x.registrations | Select-Object -Skip 1) } },
    @{ Name = 'missing selected source'; Edit = { param($x) $x.sources = @($x.sources[0], $x.sources[1]); $x.registrations = @($x.registrations[0], $x.registrations[1]) } },
    @{ Name = 'no addition'; Edit = { param($x) $x.sources = @($x.sources[0]); $x.registrations = @($x.registrations[0]) } }
  )) { Assert-RegistryMutationRejected $mutation.Edit $mutation.Name }
$badConfiguration = Copy-D2RuntimeValue $configuration
$badConfiguration.development_contribution_domains += 'jobs.eu.lever.co'
Assert-Rejected {
  $nextVariables = New-D2ProviderConfigurationVariables $variables $badConfiguration
  Assert-D2ProviderAdditiveConfiguration $variables.d2_community_runtime.value $nextVariables.d2_community_runtime.value $badConfiguration
} 'explicit EU domain is outside this reviewed rollout'
$budgetVariables = Copy-D2RuntimeValue $variables
$budgetVariables.d2_community_runtime.value.trust_reviewer_assignments_json = 'x' * 1800
Assert-Rejected {
  $nextVariables = New-D2ProviderConfigurationVariables $budgetVariables $configuration
  Assert-D2ProviderAdditiveConfiguration $budgetVariables.d2_community_runtime.value $nextVariables.d2_community_runtime.value $configuration
} 'joined encoded budget includes unchanged reviewer configuration'

# Genuine before-refresh reconstruction: each saved plan has a later observed RDS clock,
# but both retain the same actual original state value. No managed field is normalized.
$clock = Copy-D2RuntimeValue $good
foreach ($entry in @(@($clock.Baseline, '2026-09-11T01:00:00Z'), @($clock.Plan, '2026-09-11T02:00:00Z'))) {
  $nativePlan = $entry[0]
  $before = Copy-D2RuntimeValue $nativePlan.planned_values.root_module.child_modules[0].resources[7].values
  $after = Copy-D2RuntimeValue $before; $after.latest_restorable_time = $entry[1]
  $drift = Copy-D2RuntimeValue $nativePlan.resource_changes[7]
  $drift.change.actions = @('update'); $drift.change.before = $before; $drift.change.after = $after
  $nativePlan.resource_drift = @($drift)
  $nativePlan.planned_values.root_module.child_modules[0].resources[7].values = Copy-D2RuntimeValue $after
  $nativePlan.resource_changes[7].change.before = Copy-D2RuntimeValue $after
  $nativePlan.resource_changes[7].change.after = Copy-D2RuntimeValue $after
  if ($nativePlan.applyable) { $nativePlan.prior_state.values.root_module.child_modules[0].resources[7].values = Copy-D2RuntimeValue $after }
}
$null = Assert-Fixture $clock; $passed++
foreach ($mutation in @(
    { param($x) $x.Plan.resource_drift[0].change.before.latest_restorable_time = '2026-09-10T23:00:00Z' },
    { param($x) $x.Plan.resource_drift[0].change.after.publicly_accessible = $true },
    { param($x) $x.Plan.resource_drift[0].change.after.latest_restorable_time = '2026-09-10T23:00:00Z' },
    { param($x) $x.Plan.resource_drift[0].change.after_unknown | Add-Member latest_restorable_time $true },
    { param($x) $x.Plan.resource_drift[0].address = 'module.platform.aws_iam_role.gateway[0]' },
    { param($x) $x.Plan.resource_drift += $x.Plan.resource_drift[0] }
  )) {
  $bad = Copy-D2RuntimeValue $clock; & $mutation $bad
  Assert-Rejected { Assert-Fixture $bad } 'only actual forward RDS clock observation with the same original state is accepted'
}
Write-Output "PASS: $passed generated D2 provider configuration assertions. No deployment or approval performed."
