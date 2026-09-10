Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-ingestion-dark-release.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The ingestion dark-release operator does not parse." }

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Expected one operator function named $Name." }
  $definition = [scriptblock]::Create($matches[0].Body.Extent.Text.TrimStart('{').TrimEnd('}'))
  Set-Item -Path "Function:script:$Name" -Value $definition
}

foreach ($name in @(
    "Get-FileSha256", "Get-TextSha256", "ConvertFrom-OperatorJson", "Assert-ExactProperties", "Resolve-PrivatePath", "Get-OptionalProperty",
    "Remove-SensitiveTemporaryFile", "Assert-TerraformVersion", "Assert-IngestionMappingInventory",
    "Read-PublicationReceipt", "Get-ZipRecord", "Convert-BaselineDarkVariables", "Test-ExactFalse", "Assert-DarkVariables",
    "New-ReleaseVariables", "Get-ArtifactCoordinates", "Assert-ReleasePlan", "Get-StateResourceAttributes",
    "Get-StateResourceInstances", "Read-ReviewedBoolean", "Get-PlatformNetworkAttributes",
    "Get-ReviewedSharedProviderNetwork", "Assert-LiveSharedProviderNetwork",
    "Get-IngestionNetworkBoundary", "Assert-LiveIngestionNetworkBoundary", "New-PlanReceipt",
    "Read-PlanReceipt"
  )) { Import-OperatorFunction $name }

$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ExpectedAccountId", "StateBucket", "SourceSha",
  "PublicationReceiptPath", "ReviewedPublicationReceiptSha256", "BaselinePlanPath",
  "ReviewedBaselinePlanSha256", "ExpectedStateLineage", "ExpectedStateSerial", "PlanPath",
  "PlanReceiptPath", "ReviewedPlanReceiptSha256", "VerificationReceiptPath", "Help"
)
$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) { throw "The operator parameter surface changed." }

foreach ($requiredSource in @(
    'plan -input=false -lock-timeout=5m -refresh=true',
    '$null = & terraform "-chdir=$terraformDirectory" plan',
    'apply -input=false -lock-timeout=5m -auto-approve $resolvedPlan',
    'Read-EncryptedStateSnapshot',
    'Assert-LiveDarkRelease',
    'Invoke-ZeroDriftPlan',
    'rollbackArtifactCoordinates',
    'describe-route-tables',
    'list-event-source-mappings',
    '$starterAliasArn',
    'INGESTION_ACTIVITY_FUNCTION_ARN -cne $activityArn',
    'Assert-DeploymentTerraformCli',
    '$values = Convert-BaselineDarkVariables $values',
    'Remove-SensitiveTemporaryFile $temporary',
    'Remove-SensitiveTemporaryFile $varsPath'
  )) {
  if (-not $source.Contains($requiredSource)) { throw "The operator lost required guard source: $requiredSource" }
}
if ($source -match '(?m)^\s*terraform\s+apply\s*$' -or $actualParameters -contains "ProviderSources") {
  throw "The operator contains an unbounded apply or caller-defined provider source."
}

$SourceSha = "a" * 40
$Region = "us-east-2"
$ExpectedAccountId = "111122223333"
$ExpectedStateLineage = "11111111-2222-3333-4444-555555555555"
$ExpectedStateSerial = 200
$ReviewedBaselinePlanSha256 = "b" * 64
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$artifactNames = @("ingestion-durable-lambda", "ingestion-runtime-lambda")
$artifactSuffixes = @("zip", "cdx.json", "manifest.json", "sha256")
$artifactVariableNames = @(
  "ingestion_durable_artifact_s3_key", "ingestion_durable_artifact_s3_object_version",
  "ingestion_durable_artifact_sha256", "ingestion_durable_artifact_base64sha256",
  "ingestion_runtime_artifact_s3_key", "ingestion_runtime_artifact_s3_object_version",
  "ingestion_runtime_artifact_sha256", "ingestion_runtime_artifact_base64sha256"
)
$darkBooleanVariables = @(
  "ingestion_runtime_enabled", "ingestion_synthetic_source_enabled",
  "ingestion_provider_activation_allowed", "ingestion_provider_private_egress"
)
$allowedReleaseActions = [ordered]@{
  "module.platform.data.aws_iam_policy_document.ingestion_durable[0]" = "read"
  "module.platform.aws_cloudformation_stack.ingestion_durable[0]" = "update"
  "module.platform.aws_iam_role_policy.ingestion_durable[0]" = "update"
  "module.platform.aws_lambda_alias.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_alias.ingestion_runtime["terminal"]' = "update"
  "module.platform.aws_lambda_function.ingestion_activity[0]" = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["coordinator"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["starter"]' = "update"
  'module.platform.aws_lambda_function.ingestion_runtime["terminal"]' = "update"
  "module.platform.time_sleep.ingestion_policy_propagation[0]" = "create,delete"
}
$expectedOutputChanges = @("ingestion_durable_version_arn")
if ($allowedReleaseActions.Count -ne 12) { throw "The exact real artifact-induced plan inventory must contain twelve changes." }
$functionNames = [ordered]@{
  activity = "ai-job-apply-development-ingestion-activity"
  coordinator = "ai-job-apply-development-ingestion-coordinator"
  starter = "ai-job-apply-development-ingestion-starter"
  terminal = "ai-job-apply-development-ingestion-terminal"
  durable = "ai-job-apply-development-ingestion-durable"
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)
  $failed = $false
  try { & $Operation } catch { $failed = $true }
  if (-not $failed) { throw "The operator accepted $Description." }
}

$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformDataRoot = Join-Path $terraformDirectory ".terraform"
$testRoot = Join-Path $terraformDataRoot "development-ingestion-dark-release-test-$PID-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = $testRoot
$PublicationReceiptPath = Join-Path $testRoot "publication.json"
$PlanReceiptPath = Join-Path $testRoot "plan-receipt.json"
$repositoryRoot = $repositoryRoot

try {
  $null = New-Item -ItemType Directory -Path $testRoot -Force
  $objects = @()
  $index = 0
  foreach ($name in $artifactNames) {
    $zipDigest = if ($name -ceq "ingestion-durable-lambda") { "1" * 64 } else { "2" * 64 }
    foreach ($suffix in $artifactSuffixes) {
      $index += 1
      $objectDigest = if ($suffix -ceq "zip") { $zipDigest } else { ([string]([string]$index)[0]) * 64 }
      $objects += [pscustomobject]@{
        artifactName = $name; artifactSha256 = $zipDigest; suffix = $suffix
        key = "lambda/ingestion/$SourceSha/$zipDigest/$name.$suffix"
        versionId = "version-$index"; objectSha256 = $objectDigest
        objectBase64Sha256 = (([char](64 + $index)).ToString() * 43) + "="
        contentLength = 100 + $index
      }
    }
  }
  $receipt = [ordered]@{
    schemaVersion = 1; kind = "development-ingestion-lambda-publication"; environment = "development"
    region = "us-east-2"; sourceSha = $SourceSha; boundarySha256 = "9" * 64; phase = "verified"
    createdAt = "2026-08-26T00:00:00.0000000+00:00"; completedAt = "2026-08-26T00:01:00.0000000+00:00"; artifacts = $objects
  }
  [IO.File]::WriteAllText($PublicationReceiptPath, ($receipt | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
  $publication = Read-PublicationReceipt
  if (@($publication.Receipt.artifacts).Count -ne 8) { throw "The exact publication receipt was not accepted." }

  foreach ($mutation in @("duplicate", "source", "phase", "artifact", "key", "count", "extra")) {
    $candidate = $receipt | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($mutation) {
      "duplicate" { $candidate.artifacts[7].artifactName = "ingestion-durable-lambda"; $candidate.artifacts[7].suffix = "zip" }
      "source" { $candidate.sourceSha = "0" * 40 }
      "phase" { $candidate.phase = "publishing" }
      "artifact" { $candidate.artifacts[1].artifactSha256 = "8" * 64 }
      "key" { $candidate.artifacts[0].key = "lambda/other.zip" }
      "count" { $candidate.artifacts = @($candidate.artifacts | Select-Object -First 7) }
      "extra" { $candidate.artifacts[0] | Add-Member NoteProperty bucket "caller" }
    }
    [IO.File]::WriteAllText($PublicationReceiptPath, ($candidate | ConvertTo-Json -Depth 20), $utf8WithoutBom)
    $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
    Assert-Rejected { Read-PublicationReceipt } "publication mutation '$mutation'"
  }
  [IO.File]::WriteAllText($PublicationReceiptPath, ($receipt | ConvertTo-Json -Depth 20), $utf8WithoutBom)
  $ReviewedPublicationReceiptSha256 = Get-FileSha256 $PublicationReceiptPath
  $publication = Read-PublicationReceipt

  $sensitive = Join-Path $testRoot "sensitive.auto.tfvars.json"
  [IO.File]::WriteAllText($sensitive, '{"private":"value"}', $utf8WithoutBom)
  Remove-SensitiveTemporaryFile $sensitive
  if (Test-Path -LiteralPath $sensitive) { throw "Sensitive temporary cleanup did not prove deletion." }

  $nativeResolver = ${function:Get-DeploymentTerraformExecutable}
  $nativeReader = ${function:Invoke-DeploymentTerraformReadCommand}
  try {
    function Get-DeploymentTerraformExecutable { return "synthetic-current-terraform.exe" }
    function Invoke-DeploymentTerraformReadCommand {
      param([string]$Executable, [string]$Operation)
      if ($Executable -cne "synthetic-current-terraform.exe" -or $Operation -cne "Version") {
        throw "Unexpected native Terraform operation."
      }
      return [pscustomobject]@{ ExitCode = 0; Output = ('{"terraform_version":"' + $script:syntheticTerraformVersion + '"}') }
    }
    $script:syntheticTerraformVersion = "1.16.2"
    Assert-TerraformVersion
    foreach ($invalidVersion in @("1.9.8", "1.9.7", "1.16.1", "1.16.3", "1.16.2 ")) {
      $script:syntheticTerraformVersion = $invalidVersion
      Assert-Rejected { Assert-TerraformVersion } "active Terraform other than exact 1.16.2"
    }
  } finally {
    Set-Item Function:Get-DeploymentTerraformExecutable -Value $nativeResolver
    Set-Item Function:Invoke-DeploymentTerraformReadCommand -Value $nativeReader
  }

  $mapping = [pscustomobject]@{ EventSourceMappings = @([pscustomobject]@{
        State = "Disabled"
        EventSourceArn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-ingestion-dispatch"
        FunctionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-ingestion-starter:development"
        BatchSize = 10
        FunctionResponseTypes = @("ReportBatchItemFailures")
      }) }
  Assert-IngestionMappingInventory $mapping
  foreach ($mutation in @("enabled", "extra", "queue", "function", "batch", "response")) {
    $candidate = $mapping | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    switch ($mutation) {
      "enabled" { $candidate.EventSourceMappings[0].State = "Enabled" }
      "extra" { $candidate.EventSourceMappings = @($candidate.EventSourceMappings[0], $candidate.EventSourceMappings[0]) }
      "queue" { $candidate.EventSourceMappings[0].EventSourceArn += "-other" }
      "function" { $candidate.EventSourceMappings[0].FunctionArn += "-other" }
      "batch" { $candidate.EventSourceMappings[0].BatchSize = 1 }
      "response" { $candidate.EventSourceMappings[0].FunctionResponseTypes = @() }
    }
    Assert-Rejected { Assert-IngestionMappingInventory $candidate } "event-source mapping mutation '$mutation'"
  }

  function New-NetworkResource([string]$Type, [string]$Name, [object[]]$Attributes) {
    return [pscustomobject]@{
      type = $Type; name = $Name; module = "module.platform"; mode = "managed"
      instances = @($Attributes | ForEach-Object { [pscustomobject]@{ attributes = $_ } })
    }
  }
  $darkNetworkValues = [ordered]@{
    deploy_ingestion_runtime = $true; ingestion_runtime_enabled = $false
    ingestion_synthetic_source_enabled = $false; ingestion_provider_activation_allowed = $false
    ingestion_provider_private_egress = $false; ingestion_provider_sources = @()
  }
  $privateSubnetIds = @("subnet-private-a", "subnet-private-b")
  $providerSubnetIds = @("subnet-provider-a", "subnet-provider-b")
  $privateRouteIds = @("rtb-private-a", "rtb-private-b")
  $providerRouteIds = @("rtb-provider-a", "rtb-provider-b")
  $networkSnapshot = [pscustomobject]@{ State = [pscustomobject]@{ resources = @(
        (New-NetworkResource "aws_lambda_function" "ingestion_activity" @([pscustomobject]@{
              vpc_config = @([pscustomobject]@{ subnet_ids = $privateSubnetIds })
            })),
        (New-NetworkResource "aws_subnet" "private" @($privateSubnetIds | ForEach-Object { [pscustomobject]@{ id = $_ } })),
        (New-NetworkResource "aws_subnet" "ingestion_provider" @($providerSubnetIds | ForEach-Object { [pscustomobject]@{ id = $_ } })),
        (New-NetworkResource "aws_route_table" "private" @($privateRouteIds | ForEach-Object {
              [pscustomobject]@{ id = $_; route = @([pscustomobject]@{ nat_gateway_id = "nat-candidate-rights" }) }
            })),
        (New-NetworkResource "aws_route_table" "ingestion_provider" @($providerRouteIds | ForEach-Object { [pscustomobject]@{ id = $_; route = @() } })),
        (New-NetworkResource "aws_route_table_association" "private" @(
            [pscustomobject]@{ subnet_id = $privateSubnetIds[0]; route_table_id = $privateRouteIds[0] },
            [pscustomobject]@{ subnet_id = $privateSubnetIds[1]; route_table_id = $privateRouteIds[1] }
          )),
        (New-NetworkResource "aws_route_table_association" "ingestion_provider" @(
            [pscustomobject]@{ subnet_id = $providerSubnetIds[0]; route_table_id = $providerRouteIds[0] },
            [pscustomobject]@{ subnet_id = $providerSubnetIds[1]; route_table_id = $providerRouteIds[1] }
          )),
        (New-NetworkResource "aws_nat_gateway" "this" @([pscustomobject]@{ id = "nat-candidate-rights" }))
      ) } }
  $network = Get-IngestionNetworkBoundary $networkSnapshot $darkNetworkValues
  $liveActivity = [pscustomobject]@{ VpcConfig = [pscustomobject]@{ SubnetIds = $privateSubnetIds } }
  $liveRoutes = [pscustomobject]@{ RouteTables = @(
      [pscustomobject]@{ RouteTableId = $privateRouteIds[0]; Associations = @([pscustomobject]@{ SubnetId = $privateSubnetIds[0] }); Routes = @([pscustomobject]@{ GatewayId = "local" }, [pscustomobject]@{ NatGatewayId = "nat-candidate-rights" }) },
      [pscustomobject]@{ RouteTableId = $privateRouteIds[1]; Associations = @([pscustomobject]@{ SubnetId = $privateSubnetIds[1] }); Routes = @([pscustomobject]@{ GatewayId = "local" }, [pscustomobject]@{ NatGatewayId = "nat-candidate-rights" }) }
    ) }
  Assert-LiveIngestionNetworkBoundary $network $liveActivity $liveRoutes
  foreach ($mutation in @("activity-provider-subnet", "provider-nat", "provider-route", "unknown-nat")) {
    $candidate = $networkSnapshot | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($mutation) {
      "activity-provider-subnet" { @($candidate.State.resources | Where-Object name -ceq "ingestion_activity")[0].instances[0].attributes.vpc_config[0].subnet_ids = $providerSubnetIds }
      "provider-nat" { $candidate.State.resources += New-NetworkResource "aws_nat_gateway" "ingestion_provider" @([pscustomobject]@{ id = "nat-provider" }) }
      "provider-route" { @($candidate.State.resources | Where-Object name -ceq "private" | Where-Object type -ceq "aws_route_table_association")[0].instances[0].attributes.route_table_id = $providerRouteIds[0] }
      "unknown-nat" { @($candidate.State.resources | Where-Object name -ceq "private" | Where-Object type -ceq "aws_route_table")[0].instances[0].attributes.route[0].nat_gateway_id = "nat-unowned" }
    }
    Assert-Rejected { Get-IngestionNetworkBoundary $candidate $darkNetworkValues } "ingestion topology mutation '$mutation'"
  }
  $badLiveRoutes = $liveRoutes | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badLiveRoutes.RouteTables[0].RouteTableId = $providerRouteIds[0]
  Assert-Rejected { Assert-LiveIngestionNetworkBoundary $network $liveActivity $badLiveRoutes } "live provider-route topology"
  $badLiveNat = $liveRoutes | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $badLiveNat.RouteTables[0].Routes[1].NatGatewayId = "nat-unowned"
  Assert-Rejected { Assert-LiveIngestionNetworkBoundary $network $liveActivity $badLiveNat } "live unowned NAT route"

  # Synthetic state and live readbacks; never contact AWS or activate a source.
  function New-SharedD2Fixture([bool]$HighAvailability = $false) {
    $snapshot = $networkSnapshot | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $values = [ordered]@{}
    foreach ($key in $darkNetworkValues.Keys) { $values[$key] = $darkNetworkValues[$key] }
    $values.deploy_applications = "true"
    $values.serverless_runtime_enabled = "true"
    $values.deploy_gateway_lambda = "true"
    $values.high_availability = if ($HighAvailability) { "true" } else { "false" }
    $values.d2_community_runtime = [pscustomobject]@{
      deploy = $true; enabled = $true; maintenance_mode = $false
      provider_activation_allowed = $true; provider_private_egress = $true
      provider_sources_json = '[{"provider":"greenhouse","sourceId":"greenhouse-synthetic","enabled":true}]'
      provider_verification_registrations_json = '[{"provider":"greenhouse","sourceId":"greenhouse-synthetic"}]'
      artifact_sha256 = "7" * 64; artifact_base64sha256 = ("G" * 43) + "="
    }
    $vpcId = "vpc-platform"; $vpcCidr = "10.20.0.0/16"; $group = "sg-application"
    $publicIds = @("subnet-public-a", "subnet-public-b")
    $publicSubnets = @()
    for ($index = 0; $index -lt 2; $index++) {
      $az = "us-east-2" + [char](97 + $index)
      $publicSubnets += [pscustomobject]@{ id = $publicIds[$index]; vpc_id = $vpcId; availability_zone = $az }
      $providerSubnet = @($snapshot.State.resources | Where-Object { $_.type -ceq "aws_subnet" -and $_.name -ceq "ingestion_provider" })[0].instances[$index].attributes
      $providerSubnet | Add-Member NoteProperty vpc_id $vpcId
      $providerSubnet | Add-Member NoteProperty availability_zone $az
    }
    $natCount = if ($HighAvailability) { 2 } else { 1 }
    $natAttributes = @(); $eipAttributes = @(); $liveNats = @()
    for ($index = 0; $index -lt $natCount; $index++) {
      $natId = "nat-d2-$index"; $allocation = "eipalloc-d2-$index"
      $natAttributes += [pscustomobject]@{
        id = $natId; vpc_id = $vpcId; subnet_id = $publicIds[$index]
        allocation_id = $allocation; connectivity_type = "public"
      }
      $eipAttributes += [pscustomobject]@{ id = $allocation; domain = "vpc" }
      $liveNats += [pscustomobject]@{
        NatGatewayId = $natId; VpcId = $vpcId; SubnetId = $publicIds[$index]; State = "available"
        ConnectivityType = "public"; NatGatewayAddresses = @([pscustomobject]@{ AllocationId = $allocation })
      }
    }
    $liveProviderRoutes = @()
    for ($index = 0; $index -lt 2; $index++) {
      $natId = if ($HighAvailability) { "nat-d2-$index" } else { "nat-d2-0" }
      $route = @($snapshot.State.resources | Where-Object { $_.type -ceq "aws_route_table" -and $_.name -ceq "ingestion_provider" })[0].instances[$index].attributes
      $route | Add-Member NoteProperty vpc_id $vpcId
      $route.route = @([pscustomobject]@{ cidr_block = "0.0.0.0/0"; nat_gateway_id = $natId })
      $liveProviderRoutes += [pscustomobject]@{
        RouteTableId = $providerRouteIds[$index]; VpcId = $vpcId
        Associations = @([pscustomobject]@{ SubnetId = $providerSubnetIds[$index] })
        Routes = @(
          [pscustomobject]@{ GatewayId = "local"; DestinationCidrBlock = $vpcCidr; State = "active" },
          [pscustomobject]@{ NatGatewayId = $natId; DestinationCidrBlock = "0.0.0.0/0"; State = "active" }
        )
      }
    }
    $d2Name = "ai-job-apply-development-d2-community-scheduled"
    $d2Arn = "arn:aws:lambda:{0}:{1}:function:{2}" -f $Region, $ExpectedAccountId, $d2Name
    $d2Environment = [pscustomobject]@{
      D2_COMMUNITY_RUNTIME_ENABLED = "true"; D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED = "true"
      D2_COMMUNITY_PROVIDER_SOURCES_JSON = $values.d2_community_runtime.provider_sources_json
      D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON = $values.d2_community_runtime.provider_verification_registrations_json
      RELEASE_SHA = $values.d2_community_runtime.artifact_sha256
    }
    $scheduled = [pscustomobject]@{
      function_name = $d2Name; arn = $d2Arn; version = "19"
      source_code_hash = $values.d2_community_runtime.artifact_base64sha256
      environment = @([pscustomobject]@{ variables = $d2Environment })
      vpc_config = @([pscustomobject]@{ subnet_ids = $providerSubnetIds; security_group_ids = @($group) })
    }
    $alias = [pscustomobject]@{ function_name = $d2Name; name = "development"; function_version = "19"; routing_config = @() }
    $snapshot.State.resources += @(
      (New-NetworkResource "aws_vpc" "this" @([pscustomobject]@{ id = $vpcId; cidr_block = $vpcCidr })),
      (New-NetworkResource "aws_subnet" "public" $publicSubnets),
      (New-NetworkResource "aws_security_group" "application" @([pscustomobject]@{ id = $group })),
      (New-NetworkResource "aws_nat_gateway" "ingestion_provider" $natAttributes),
      (New-NetworkResource "aws_eip" "ingestion_provider_nat" $eipAttributes),
      (New-NetworkResource "aws_lambda_function" "d2_community_scheduled" @($scheduled)),
      (New-NetworkResource "aws_lambda_alias" "d2_community_scheduled" @($alias))
    )
    return [pscustomobject]@{
      Snapshot = $snapshot; Values = $values
      Alias = [pscustomobject]@{ Name = "development"; AliasArn = $d2Arn + ":development"; FunctionVersion = "19" }
      Configuration = [pscustomobject]@{
        FunctionArn = $d2Arn + ":19"; CodeSha256 = $values.d2_community_runtime.artifact_base64sha256
        State = "Active"; LastUpdateStatus = "Successful"; Environment = [pscustomobject]@{ Variables = $d2Environment }
        VpcConfig = [pscustomobject]@{ VpcId = $vpcId; SubnetIds = $providerSubnetIds; SecurityGroupIds = @($group) }
      }
      NatGateways = [pscustomobject]@{ NatGateways = $liveNats }
      RouteTables = [pscustomobject]@{ RouteTables = $liveProviderRoutes }
    }
  }
  function Get-SyntheticSharedResource($Fixture, [string]$Type, [string]$Name) {
    return @($Fixture.Snapshot.State.resources | Where-Object { $_.type -ceq $Type -and $_.name -ceq $Name })[0]
  }
  foreach ($ha in @($false, $true)) {
    $fixture = New-SharedD2Fixture $ha
    $sharedNetwork = Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values
    if ($null -eq $sharedNetwork.SharedProviderNetwork -or
      @($sharedNetwork.SharedProviderNetwork.Nats).Count -ne $(if ($ha) { 2 } else { 1 })) {
      throw "The exact D2-owned shared provider NAT topology was not accepted."
    }
    Assert-LiveIngestionNetworkBoundary $sharedNetwork $liveActivity $liveRoutes
    Assert-LiveSharedProviderNetwork $sharedNetwork.SharedProviderNetwork $fixture.Alias $fixture.Configuration $fixture.NatGateways $fixture.RouteTables
  }
  foreach ($gate in $darkBooleanVariables) {
    $fixture = New-SharedD2Fixture
    $fixture.Values[$gate] = $true
    Assert-Rejected { Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values } "enabled ingestion gate with a D2-owned NAT"
  }
  $fixture = New-SharedD2Fixture
  $fixture.Values.d2_community_runtime = $fixture.Values.d2_community_runtime | ConvertTo-Json -Compress -Depth 10
  $null = Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values
  $explicitDarkValues = [ordered]@{}
  foreach ($key in $darkNetworkValues.Keys) { $explicitDarkValues[$key] = $darkNetworkValues[$key] }
  $explicitDarkValues.d2_community_runtime = [pscustomobject]@{ provider_private_egress = $false }
  $explicitDarkNetwork = Get-IngestionNetworkBoundary $networkSnapshot $explicitDarkValues
  if ($null -ne $explicitDarkNetwork.SharedProviderNetwork) { throw "Disabled D2 gained a shared provider network." }
  foreach ($mutation in @(
      "d2-deploy", "d2-enabled", "d2-provider", "d2-egress", "d2-maintenance", "global-disabled",
      "d2-string-boolean", "global-noncanonical", "d2-invalid-json", "ingestion-source",
      "provider-source-empty", "verification-empty", "foreign-owner", "nat-missing", "nat-duplicate",
      "nat-vpc", "nat-subnet", "nat-allocation", "nat-private", "nat-application",
      "provider-route-nat", "provider-route-association", "provider-route-vpc", "d2-missing",
      "d2-code", "d2-version", "d2-weighted", "d2-subnets", "d2-source-environment", "d2-runtime-disabled"
    )) {
    $fixture = New-SharedD2Fixture
    switch ($mutation) {
      "d2-deploy" { $fixture.Values.d2_community_runtime.deploy = $false }
      "d2-enabled" { $fixture.Values.d2_community_runtime.enabled = $false }
      "d2-provider" { $fixture.Values.d2_community_runtime.provider_activation_allowed = $false }
      "d2-egress" { $fixture.Values.d2_community_runtime.provider_private_egress = $false }
      "d2-maintenance" { $fixture.Values.d2_community_runtime.maintenance_mode = $true }
      "global-disabled" { $fixture.Values.serverless_runtime_enabled = "false" }
      "d2-string-boolean" { $fixture.Values.d2_community_runtime.enabled = "true" }
      "global-noncanonical" { $fixture.Values.serverless_runtime_enabled = "TRUE" }
      "d2-invalid-json" { $fixture.Values.d2_community_runtime = '{"broken":' }
      "ingestion-source" { $fixture.Values.ingestion_provider_sources = @([pscustomobject]@{ enabled = $true }) }
      "provider-source-empty" { $fixture.Values.d2_community_runtime.provider_sources_json = "[]" }
      "verification-empty" { $fixture.Values.d2_community_runtime.provider_verification_registrations_json = "{}" }
      "foreign-owner" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").module = "module.unrelated" }
      "nat-missing" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances = @() }
      "nat-duplicate" { $resource = Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider"; $resource.instances += $resource.instances[0] }
      "nat-vpc" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[0].attributes.vpc_id = "vpc-other" }
      "nat-subnet" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[0].attributes.subnet_id = "subnet-provider-a" }
      "nat-allocation" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[0].attributes.allocation_id = "eipalloc-other" }
      "nat-private" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[0].attributes.connectivity_type = "private" }
      "nat-application" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[0].attributes.id = "nat-candidate-rights" }
      "provider-route-nat" { (Get-SyntheticSharedResource $fixture "aws_route_table" "ingestion_provider").instances[0].attributes.route[0].nat_gateway_id = "nat-unowned" }
      "provider-route-association" { (Get-SyntheticSharedResource $fixture "aws_route_table_association" "ingestion_provider").instances[0].attributes.subnet_id = "subnet-private-a" }
      "provider-route-vpc" { (Get-SyntheticSharedResource $fixture "aws_route_table" "ingestion_provider").instances[0].attributes.vpc_id = "vpc-other" }
      "d2-missing" { (Get-SyntheticSharedResource $fixture "aws_lambda_function" "d2_community_scheduled").instances = @() }
      "d2-code" { (Get-SyntheticSharedResource $fixture "aws_lambda_function" "d2_community_scheduled").instances[0].attributes.source_code_hash = ("A" * 43) + "=" }
      "d2-version" { (Get-SyntheticSharedResource $fixture "aws_lambda_alias" "d2_community_scheduled").instances[0].attributes.function_version = "20" }
      "d2-weighted" { (Get-SyntheticSharedResource $fixture "aws_lambda_alias" "d2_community_scheduled").instances[0].attributes.routing_config = @([pscustomobject]@{ additional_version_weights = [pscustomobject]@{ "18" = 0.1 } }) }
      "d2-subnets" { (Get-SyntheticSharedResource $fixture "aws_lambda_function" "d2_community_scheduled").instances[0].attributes.vpc_config[0].subnet_ids = $privateSubnetIds }
      "d2-source-environment" { (Get-SyntheticSharedResource $fixture "aws_lambda_function" "d2_community_scheduled").instances[0].attributes.environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON = "[]" }
      "d2-runtime-disabled" { (Get-SyntheticSharedResource $fixture "aws_lambda_function" "d2_community_scheduled").instances[0].attributes.environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED = "false" }
    }
    Assert-Rejected { Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values } "D2 shared provider state mutation '$mutation'"
  }
  foreach ($mutation in @("zone", "allocation", "missing-nat")) {
    $fixture = New-SharedD2Fixture $true
    switch ($mutation) {
      "zone" { (Get-SyntheticSharedResource $fixture "aws_subnet" "public").instances[1].attributes.availability_zone = "us-east-2a" }
      "allocation" { (Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider").instances[1].attributes.allocation_id = "eipalloc-d2-0" }
      "missing-nat" { $resource = Get-SyntheticSharedResource $fixture "aws_nat_gateway" "ingestion_provider"; $resource.instances = @($resource.instances[0]) }
    }
    Assert-Rejected { Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values } "high-availability shared NAT mutation '$mutation'"
  }
  $fixture = New-SharedD2Fixture
  $sharedNetwork = (Get-IngestionNetworkBoundary $fixture.Snapshot $fixture.Values).SharedProviderNetwork
  foreach ($mutation in @(
      "alias-version", "alias-weighted", "function-family", "code", "runtime-disabled", "provider-config",
      "activity-subnets", "vpc", "security-group", "nat-missing", "nat-health", "nat-private",
      "nat-allocation", "nat-subnet", "nat-vpc", "route-nat", "route-extra", "route-cidr",
      "route-blackhole", "route-association"
    )) {
    $candidate = New-SharedD2Fixture
    switch ($mutation) {
      "alias-version" { $candidate.Alias.FunctionVersion = "20" }
      "alias-weighted" { $candidate.Alias | Add-Member NoteProperty RoutingConfig ([pscustomobject]@{ AdditionalVersionWeights = [pscustomobject]@{ "18" = 0.1 } }) }
      "function-family" { $candidate.Configuration.FunctionArn += "-other" }
      "code" { $candidate.Configuration.CodeSha256 = ("A" * 43) + "=" }
      "runtime-disabled" { $candidate.Configuration.Environment.Variables.D2_COMMUNITY_RUNTIME_ENABLED = "false" }
      "provider-config" { $candidate.Configuration.Environment.Variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON = "[]" }
      "activity-subnets" { $candidate.Configuration.VpcConfig.SubnetIds = $privateSubnetIds }
      "vpc" { $candidate.Configuration.VpcConfig.VpcId = "vpc-other" }
      "security-group" { $candidate.Configuration.VpcConfig.SecurityGroupIds = @("sg-other") }
      "nat-missing" { $candidate.NatGateways.NatGateways = @() }
      "nat-health" { $candidate.NatGateways.NatGateways[0].State = "failed" }
      "nat-private" { $candidate.NatGateways.NatGateways[0].ConnectivityType = "private" }
      "nat-allocation" { $candidate.NatGateways.NatGateways[0].NatGatewayAddresses[0].AllocationId = "eipalloc-other" }
      "nat-subnet" { $candidate.NatGateways.NatGateways[0].SubnetId = "subnet-other" }
      "nat-vpc" { $candidate.NatGateways.NatGateways[0].VpcId = "vpc-other" }
      "route-nat" { $candidate.RouteTables.RouteTables[0].Routes[1].NatGatewayId = "nat-other" }
      "route-extra" { $candidate.RouteTables.RouteTables[0].Routes += [pscustomobject]@{ GatewayId = "igw-unreviewed"; DestinationCidrBlock = "0.0.0.0/0"; State = "active" } }
      "route-cidr" { $candidate.RouteTables.RouteTables[0].Routes[1].DestinationCidrBlock = "0.0.0.0/1" }
      "route-blackhole" { $candidate.RouteTables.RouteTables[0].Routes[1].State = "blackhole" }
      "route-association" { $candidate.RouteTables.RouteTables[0].Associations[0].SubnetId = "subnet-private-a" }
    }
    Assert-Rejected {
      Assert-LiveSharedProviderNetwork $sharedNetwork $candidate.Alias $candidate.Configuration $candidate.NatGateways $candidate.RouteTables
    } "live shared provider mutation '$mutation'"
  }

  $baselineValues = [ordered]@{
    deploy_ingestion_runtime = $true
    ingestion_runtime_enabled = $false
    ingestion_synthetic_source_enabled = $false
    ingestion_provider_activation_allowed = $false
    ingestion_provider_private_egress = $false
    ingestion_provider_sources = @()
    ingestion_durable_artifact_s3_key = "lambda/ingestion/old/durable.zip"
    ingestion_durable_artifact_s3_object_version = "old-durable-version"
    ingestion_durable_artifact_sha256 = "3" * 64
    ingestion_durable_artifact_base64sha256 = ("C" * 43) + "="
    ingestion_runtime_artifact_s3_key = "lambda/ingestion/old/runtime.zip"
    ingestion_runtime_artifact_s3_object_version = "old-runtime-version"
    ingestion_runtime_artifact_sha256 = "4" * 64
    ingestion_runtime_artifact_base64sha256 = ("D" * 43) + "="
    unrelated_baseline_value = "retained"
  }
  $serializedBaselineValues = [ordered]@{}
  foreach ($key in $baselineValues.Keys) { $serializedBaselineValues[$key] = $baselineValues[$key] }
  $serializedBaselineValues.deploy_ingestion_runtime = "true"
  foreach ($gate in $darkBooleanVariables) { $serializedBaselineValues[$gate] = "false" }
  $normalizedBaselineValues = Convert-BaselineDarkVariables $serializedBaselineValues
  Assert-DarkVariables $normalizedBaselineValues
  foreach ($name in @("deploy_ingestion_runtime") + $darkBooleanVariables) {
    if ($normalizedBaselineValues[$name] -isnot [bool]) {
      throw "The real Terraform baseline boolean string for $name was not normalized to a native boolean."
    }
  }
  if ($normalizedBaselineValues.unrelated_baseline_value -cne "retained") {
    throw "Baseline-only boolean normalization changed an unrelated variable."
  }
  if ($serializedBaselineValues.deploy_ingestion_runtime -isnot [string] -or
    $serializedBaselineValues.ingestion_runtime_enabled -isnot [string]) {
    throw "Baseline-only boolean normalization mutated the reviewed Terraform plan projection."
  }
  foreach ($invalid in @("True", "FALSE", " true", "false ", 1, $null)) {
    $invalidBaselineValues = [ordered]@{}
    foreach ($key in $serializedBaselineValues.Keys) { $invalidBaselineValues[$key] = $serializedBaselineValues[$key] }
    $invalidBaselineValues.ingestion_runtime_enabled = $invalid
    Assert-Rejected { Convert-BaselineDarkVariables $invalidBaselineValues } "noncanonical baseline boolean '$invalid'"
  }
  $baseline = [pscustomobject]@{ Values = $normalizedBaselineValues; Sha256 = $ReviewedBaselinePlanSha256 }
  $release = New-ReleaseVariables $baseline $publication
  $releaseValues = $release
  Assert-DarkVariables $release
  if ([string]$release.unrelated_baseline_value -cne "retained" -or
    [string]$release.ingestion_durable_artifact_sha256 -cne ("1" * 64) -or
    [string]$release.ingestion_runtime_artifact_sha256 -cne ("2" * 64)) {
    throw "The release overlay did not preserve baseline values and exact ZIP coordinates."
  }
  foreach ($gate in $darkBooleanVariables) {
    $bad = [ordered]@{}
    foreach ($key in $release.Keys) { $bad[$key] = $release[$key] }
    $bad[$gate] = $true
    Assert-Rejected { Assert-DarkVariables $bad } "enabled dark gate '$gate'"
  }
  $badSources = [ordered]@{}
  foreach ($key in $release.Keys) { $badSources[$key] = $release[$key] }
  $badSources.ingestion_provider_sources = @([pscustomobject]@{ source = "provider" })
  Assert-Rejected { Assert-DarkVariables $badSources } "nonempty provider source list"

  $planVariables = [ordered]@{}
  foreach ($key in $release.Keys) { $planVariables[$key] = [pscustomobject]@{ value = $release[$key] } }
  $resourceChanges = @($allowedReleaseActions.GetEnumerator() | ForEach-Object {
      [pscustomobject]@{ address = $_.Key; change = [pscustomobject]@{ actions = @($_.Value.Split(',')) } }
    })
  $plan = [pscustomobject]@{
    variables = [pscustomobject]$planVariables
    resource_changes = $resourceChanges
    output_changes = [pscustomobject]@{
      ingestion_durable_version_arn = [pscustomobject]@{ actions = @("update") }
      unchanged = [pscustomobject]@{ actions = @("no-op") }
    }
  }
  $inventory = @(Assert-ReleasePlan $plan $release)
  if ($inventory.Count -ne $allowedReleaseActions.Count) { throw "The exact release plan inventory was not accepted." }
  $stringBooleanPlan = $plan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $stringBooleanPlan.variables.ingestion_runtime_enabled.value = "false"
  Assert-Rejected { Assert-ReleasePlan $stringBooleanPlan $release } "a non-native release-plan boolean"

  foreach ($mutation in @("route", "action", "missing", "gate", "source", "baseline", "output")) {
    $candidate = $plan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    switch ($mutation) {
      "route" { $candidate.resource_changes[0].address = "module.platform.aws_route.provider_default[0]" }
      "action" { $candidate.resource_changes[0].change.actions = @("delete", "create") }
      "missing" { $candidate.resource_changes = @($candidate.resource_changes | Select-Object -Skip 1) }
      "gate" { $candidate.variables.ingestion_runtime_enabled.value = $true }
      "source" { $candidate.variables.ingestion_provider_sources.value = @([pscustomobject]@{ enabled = $true }) }
      "baseline" { $candidate.variables.unrelated_baseline_value.value = "changed" }
      "output" { $candidate.output_changes | Add-Member NoteProperty route_url ([pscustomobject]@{ actions = @("update") }) }
    }
    Assert-Rejected { Assert-ReleasePlan $candidate $release } "release-plan mutation '$mutation'"
  }

  $state = [pscustomobject]@{ Lineage = $ExpectedStateLineage; Serial = $ExpectedStateSerial; VersionId = "state-version" }
  $planPath = Join-Path $testRoot "release.tfplan"
  [IO.File]::WriteAllText($planPath, "saved-plan", $utf8WithoutBom)
  $planReceipt = New-PlanReceipt $publication $baseline $state $planPath $inventory
  [IO.File]::WriteAllText($PlanReceiptPath, ($planReceipt | ConvertTo-Json -Depth 30), $utf8WithoutBom)
  $ReviewedPlanReceiptSha256 = Get-FileSha256 $PlanReceiptPath
  $loadedPlanReceipt = Read-PlanReceipt
  if (@($loadedPlanReceipt.Receipt.releaseArtifactCoordinates.PSObject.Properties).Count -ne 8 -or
    @($loadedPlanReceipt.Receipt.rollbackArtifactCoordinates.PSObject.Properties).Count -ne 8) {
    throw "The plan receipt did not retain exact release and rollback coordinates."
  }
  $tamperedPlanReceipt = $planReceipt | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $tamperedPlanReceipt.dark.provider = $true
  [IO.File]::WriteAllText($PlanReceiptPath, ($tamperedPlanReceipt | ConvertTo-Json -Depth 30), $utf8WithoutBom)
  $ReviewedPlanReceiptSha256 = Get-FileSha256 $PlanReceiptPath
  Assert-Rejected { Read-PlanReceipt } "a plan receipt with an enabled provider gate"
  if (-not $source.Contains('dark = [ordered]@{ deploy = $true; runtime = $false; synthetic = $false; provider = $false; privateEgress = $false; sourceCount = 0 }')) {
    throw "The plan receipt does not bind the exact dark summary."
  }
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $expectedTestPrefix = [IO.Path]::GetFullPath($terraformDataRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar + "development-ingestion-dark-release-test-"
    if (-not $resolvedTestRoot.StartsWith($expectedTestPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "The disposable test directory is outside the exact development test boundary."
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

Write-Output "Development ingestion dark-release operator tests passed."
