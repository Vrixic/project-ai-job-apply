Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "../lib/terraform-toolchain.ps1")
$realExecutableResolver = ${function:Get-DeploymentTerraformExecutable}

$passed = 0
function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Message)
  if ([string]$Actual -cne [string]$Expected) { throw $Message }
  $script:passed++
}
function Assert-Throws {
  param([scriptblock]$Operation, [string]$Message)
  $failed = $false
  try { $null = & $Operation }
  catch {
    $failed = $true
    if ($_.Exception.Message.Contains("SYNTHETIC-PRIVATE-DIAGNOSTIC")) {
      throw "Native diagnostic content escaped a sanitized toolchain failure."
    }
  }
  if (-not $failed) { throw $Message }
  $script:passed++
}

function Assert-PlanTimestampStrings {
  param([object]$Plan, [string]$Reader)
  $values = $Plan.planned_values.root_module.resources[0].values
  $checks = @(
    @{ Actual = $Plan.timestamp; Expected = "2026-09-10T03:06:10.000+0000"; Name = "top-level zero-offset timestamp" },
    @{ Actual = $values.created_at; Expected = "2026-09-10T08:36:10+05:30"; Name = "positive-offset timestamp" },
    @{ Actual = $values.updated_at; Expected = "2026-09-10T03:06:10.1234567Z"; Name = "fractional timestamp" },
    @{ Actual = $values.nested.observations[0].captured_at; Expected = "2026-09-09T23:06:10.000-0400"; Name = "nested negative-offset timestamp" }
  )
  foreach ($check in $checks) {
    Assert-Equal ($check.Actual -is [string]) $true "$Reader converted the $($check.Name) into a non-string."
    Assert-Equal $check.Actual $check.Expected "$Reader changed the exact $($check.Name) spelling."
  }
}

$ownedName = "ai-job-apply-toolchain-tests-" + [guid]::NewGuid().ToString("N")
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$ownedRoot = [IO.Path]::GetFullPath((Join-Path $temporaryRoot $ownedName))
$savedEnvironment = @{}
$environmentNames = @("TF_WORKSPACE", "TF_DATA_DIR", "TF_CLI_ARGS", "TF_CLI_ARGS_plan",
  "TF_CLI_ARGS_show", "TF_CLI_ARGS_UNEXPECTED", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3",
  "AWS_S3_ENDPOINT", "AWS_STS_ENDPOINT", "AWS_EC2_METADATA_SERVICE_ENDPOINT", "AWS_SSE_CUSTOMER_KEY",
  "AWS_CA_BUNDLE", "APPLYDASH_LEGACY_TERRAFORM")
$environmentNames += @(Get-ChildItem Env: | Where-Object { $_.Name -imatch '^TF_CLI_ARGS' } | ForEach-Object { $_.Name })
foreach ($name in @($environmentNames | Select-Object -Unique)) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  [Environment]::SetEnvironmentVariable($name, $null, "Process")
}

try {
  $null = New-Item -ItemType Directory -Path $ownedRoot
  $terraformRoot = Join-Path $ownedRoot "configuration"
  $dataRoot = Join-Path $terraformRoot ".terraform"
  $alternateData = Join-Path $terraformRoot "other-data"
  $legacyRoot = Join-Path $ownedRoot "legacy"
  foreach ($directory in @($terraformRoot, $dataRoot, $alternateData, $legacyRoot)) {
    $null = New-Item -ItemType Directory -Path $directory
  }
  $metadataPath = Join-Path $dataRoot "terraform.tfstate"
  $planPath = Join-Path $ownedRoot "synthetic.tfplan"
  $currentExecutable = Join-Path $ownedRoot "terraform.exe"
  $legacyExecutable = Join-Path $legacyRoot "terraform.exe"
  foreach ($file in @($planPath, $currentExecutable, $legacyExecutable)) {
    [IO.File]::WriteAllText($file, "Generated fixture; never an executable or real saved plan.")
  }
  $backendArguments = @{
    TerraformDirectory = $terraformRoot
    ExpectedBucket = "synthetic-state-bucket"
    ExpectedKey = "development/terraform.tfstate"
    ExpectedRegion = "us-east-2"
    ExpectedKmsKeyArn = "arn:aws:kms:us-east-2:123456789012:key/11111111-2222-3333-4444-555555555555"
  }
  function New-BackendMetadata {
    return @{ backend = @{ type = "s3"; config = @{
      bucket = $backendArguments.ExpectedBucket; key = $backendArguments.ExpectedKey
      region = $backendArguments.ExpectedRegion; kms_key_id = $backendArguments.ExpectedKmsKeyArn
      encrypt = $true; use_lockfile = $true
    } } }
  }
  function Write-BackendMetadata {
    param([object]$Metadata = (New-BackendMetadata))
    [IO.File]::WriteAllText($metadataPath, ($Metadata | ConvertTo-Json -Depth 30 -Compress))
  }
  function Assert-BackendRejected {
    param([object]$Metadata, [string]$Message)
    Write-BackendMetadata -Metadata $Metadata
    Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments } $Message
  }

  # Mock the single private native boundary, not version/backend/plan validation. There is no
  # native Terraform, AWS, provider, or network execution anywhere in these generated fixtures.
  $nativeCalls = [Collections.Generic.List[object]]::new()
  function Get-DeploymentTerraformExecutable { return $currentExecutable }
  function Reset-NativeFixture {
    $script:currentVersion = '{"terraform_version":"1.16.2"}'
    $script:legacyVersion = '{"terraform_version":"1.9.8"}'
    $script:currentVersionExit = 0
    $script:legacyVersionExit = 0
    $script:currentShow = @'
{
  "format_version": "1.2",
  "terraform_version": "1.16.2",
  "resource_changes": [],
  "timestamp": "2026-09-10T03:06:10.000+0000",
  "planned_values": {
    "root_module": {
      "resources": [
        {
          "values": {
            "created_at": "2026-09-10T08:36:10+05:30",
            "updated_at": "2026-09-10T03:06:10.1234567Z",
            "nested": {
              "observations": [
                { "captured_at": "2026-09-09T23:06:10.000-0400" }
              ]
            }
          }
        }
      ]
    }
  }
}
'@
    $script:legacyShow = $script:currentShow.Replace('"terraform_version": "1.16.2"', '"terraform_version": "1.9.8"')
    $script:currentShowExit = 0
    $script:legacyShowExit = 0
    $script:replacePlanOnShow = $false
    $script:nativeCalls.Clear()
    $env:APPLYDASH_LEGACY_TERRAFORM = $legacyExecutable
  }
  function Invoke-DeploymentTerraformReadCommand {
    param([string]$Executable, [string]$Operation, [string]$TerraformDirectory, [string]$Path)
    if ($Operation -cnotin @("Version", "Show")) { throw "A non-read-only operation was requested." }
    $nativeCalls.Add([pscustomobject]@{ Executable = $Executable; Operation = $Operation; Directory = $TerraformDirectory; Path = $Path })
    if ($Executable -cnotin @($currentExecutable, $legacyExecutable)) { throw "An unbound executable was requested." }
    $legacy = $Executable -ceq $legacyExecutable
    if ($Operation -ceq "Version") {
      if ($legacy) { return [pscustomobject]@{ ExitCode = $legacyVersionExit; Output = $legacyVersion } }
      return [pscustomobject]@{ ExitCode = $currentVersionExit; Output = $currentVersion }
    }
    if ($TerraformDirectory -cne $terraformRoot -or $Path -cne $planPath) {
      throw "The plan reader changed the reviewed file/configuration path."
    }
    if ($replacePlanOnShow) { [IO.File]::WriteAllText($Path, "Generated substituted plan fixture.") }
    if ($legacy) { return [pscustomobject]@{ ExitCode = $legacyShowExit; Output = $legacyShow } }
    return [pscustomobject]@{ ExitCode = $currentShowExit; Output = $currentShow }
  }

  Assert-Equal (Get-DeploymentTerraformVersion) "1.16.2" "The current version pin changed."
  Assert-Throws { & {
    function terraform { throw "SYNTHETIC-PRIVATE-DIAGNOSTIC" }
    & $realExecutableResolver
  } } "A function shadowing the native Terraform command was accepted."
  Assert-Throws { & {
    Set-Alias -Name terraform -Value Write-Output -Scope Local
    & $realExecutableResolver
  } } "An alias shadowing the native Terraform command was accepted."
  foreach ($version in @("1.9.8", "1.16.2")) {
    Assert-Equal @(Assert-DeploymentTerraformStateVersion -Version $version).Count 0 "State validation emitted output."
  }
  foreach ($version in @("", "1.9.7", "1.10.0", "1.16.1", "1.16.3", "1.16.2-beta1", " 1.16.2")) {
    Assert-Throws { Assert-DeploymentTerraformStateVersion -Version $version } "An unapproved state writer was accepted."
  }
  Reset-NativeFixture
  Assert-Equal @(Assert-DeploymentTerraformCli).Count 0 "CLI validation emitted output."
  Assert-Equal $nativeCalls.Count 1 "CLI validation did not inspect exactly one native version."
  foreach ($json in @('{"terraform_version":"1.9.8"}', '{"terraform_version":"1.16.2-dev"}',
      '{"terraform_version":1162}', '{}', 'null', '[]', '"1.16.2"', '{bad json')) {
    Reset-NativeFixture
    $currentVersion = $json
    Assert-Throws { Assert-DeploymentTerraformCli } "An invalid current CLI version was accepted."
  }
  Reset-NativeFixture
  $currentVersionExit = 1
  $currentVersion = "SYNTHETIC-PRIVATE-DIAGNOSTIC"
  Assert-Throws { Assert-DeploymentTerraformCli } "A failed CLI version command was accepted."
  Reset-NativeFixture
  foreach ($name in @("TF_CLI_ARGS", "TF_CLI_ARGS_plan", "TF_CLI_ARGS_show", "TF_CLI_ARGS_UNEXPECTED")) {
    [Environment]::SetEnvironmentVariable($name, "-lock=false", "Process")
    $beforeCalls = $nativeCalls.Count
    Assert-Throws { Assert-DeploymentTerraformCli } "A Terraform argument override was accepted."
    Assert-Equal $nativeCalls.Count $beforeCalls "A native command ran before environment rejection."
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  foreach ($workspace in @("other", "DEFAULT", " ")) {
    $env:TF_WORKSPACE = $workspace
    Assert-Throws { Assert-DeploymentTerraformCli } "A nondefault workspace was accepted."
  }
  $env:TF_WORKSPACE = "default"
  Assert-Equal @(Assert-DeploymentTerraformCli).Count 0 "The exact default workspace was rejected."
  [Environment]::SetEnvironmentVariable("TF_WORKSPACE", $null, "Process")

  Write-BackendMetadata
  [IO.File]::WriteAllText((Join-Path $alternateData "terraform.tfstate"),
    ((New-BackendMetadata) | ConvertTo-Json -Depth 30 -Compress))
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "Valid backend validation emitted output."
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments -DataDirectory $dataRoot).Count 0 "Explicit data directory failed."
  Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments -DataDirectory $alternateData } `
    "A valid alternate cache was accepted while Terraform would use the default data directory."
  $env:TF_DATA_DIR = ".terraform"
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "Exact relative effective data directory failed."
  $env:TF_DATA_DIR = $dataRoot
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "Exact absolute effective data directory failed."
  $env:TF_DATA_DIR = $alternateData
  Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments } "An alternate effective data directory was accepted."
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments -DataDirectory $alternateData).Count 0 `
    "An exact explicitly reviewed alternate effective data directory failed."
  $env:TF_DATA_DIR = "other-data"
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments -DataDirectory $alternateData).Count 0 `
    "An exact relative alternate effective data directory failed."
  Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments -DataDirectory $dataRoot } `
    "An explicit default cache was accepted while Terraform would use another relative data directory."
  [Environment]::SetEnvironmentVariable("TF_DATA_DIR", $null, "Process")
  $workspacePath = Join-Path $dataRoot "environment"
  [IO.File]::WriteAllText($workspacePath, "other")
  Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments } "A cached nondefault workspace was accepted."
  [IO.File]::WriteAllText($workspacePath, "default`n")
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "The cached default workspace failed."
  foreach ($key in @("bucket", "key", "region", "kms_key_id")) {
    $metadata = New-BackendMetadata
    $metadata.backend.config[$key] = "wrong"
    Assert-BackendRejected $metadata "A mismatched backend identity was accepted."
    $metadata = New-BackendMetadata
    $metadata.backend.config.Remove($key)
    Assert-BackendRejected $metadata "A missing backend identity was accepted."
  }
  foreach ($key in @("encrypt", "use_lockfile")) {
    foreach ($value in @($false, "true", "false", 1, 0, $null)) {
      $metadata = New-BackendMetadata
      $metadata.backend.config[$key] = $value
      Assert-BackendRejected $metadata "Backend encryption or effective state locking was not strict boolean true."
    }
    $metadata = New-BackendMetadata
    $metadata.backend.config.Remove($key)
    Assert-BackendRejected $metadata "A missing encryption/locking field was accepted."
  }
  foreach ($metadata in @(@{}, @{ backend = $null }, @{ backend = @{ type = "local"; config = @{} } },
      @{ backend = @{ type = "s3"; config = @() } })) {
    Assert-BackendRejected $metadata "Malformed or nons3 cached metadata was accepted."
  }
  [IO.File]::WriteAllText($metadataPath, "SYNTHETIC-PRIVATE-DIAGNOSTIC")
  Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments } "Malformed backend JSON was accepted."
  foreach ($key in @("access_key", "secret_key", "token", "profile", "role_arn", "external_id",
      "endpoint", "iam_endpoint", "sts_endpoint", "dynamodb_endpoint", "sse_customer_key",
      "custom_ca_bundle", "http_proxy", "https_proxy", "unknown_setting", "workspace_key_prefix", "acl")) {
    $metadata = New-BackendMetadata
    $metadata.backend.config[$key] = "SYNTHETIC-PRIVATE-DIAGNOSTIC"
    Assert-BackendRejected $metadata "An active backend override was accepted."
  }
  foreach ($key in @("assume_role", "assume_role_with_web_identity", "endpoints")) {
    $metadata = New-BackendMetadata
    $metadata.backend.config[$key] = @{ nested = "SYNTHETIC-PRIVATE-DIAGNOSTIC" }
    Assert-BackendRejected $metadata "A nested backend authentication/endpoint override was accepted."
  }
  foreach ($key in @("shared_config_files", "shared_credentials_files", "allowed_account_ids")) {
    $metadata = New-BackendMetadata
    $metadata.backend.config[$key] = @("SYNTHETIC-PRIVATE-DIAGNOSTIC")
    Assert-BackendRejected $metadata "An active array backend override was accepted."
  }
  foreach ($key in @("insecure", "force_path_style", "use_path_style", "skip_credentials_validation",
      "skip_metadata_api_check", "skip_region_validation", "skip_requesting_account_id", "skip_s3_checksum",
      "use_dualstack_endpoint", "use_fips_endpoint")) {
    $metadata = New-BackendMetadata
    $metadata.backend.config[$key] = $true
    Assert-BackendRejected $metadata "An unsafe backend flag was accepted."
    $metadata.backend.config[$key] = $false
    Write-BackendMetadata $metadata
    Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "An inert false backend default was rejected."
  }
  $metadata = New-BackendMetadata
  $metadata.backend.config.endpoints = @{ s3 = $null; sts = "" }
  $metadata.backend.config.assume_role = $null
  $metadata.backend.config.shared_config_files = @()
  $metadata.backend.config.workspace_key_prefix = "env:"
  $metadata.backend.config.acl = "private"
  Write-BackendMetadata $metadata
  Assert-Equal @(Assert-DeploymentTerraformBackend @backendArguments).Count 0 "Inert/default backend fields were rejected."
  foreach ($name in @("AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "AWS_S3_ENDPOINT", "AWS_STS_ENDPOINT",
      "AWS_EC2_METADATA_SERVICE_ENDPOINT", "AWS_SSE_CUSTOMER_KEY", "AWS_CA_BUNDLE")) {
    [Environment]::SetEnvironmentVariable($name, "SYNTHETIC-PRIVATE-DIAGNOSTIC", "Process")
    Assert-Throws { Assert-DeploymentTerraformBackend @backendArguments } "An environment backend override was accepted."
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }

  Reset-NativeFixture
  $env:APPLYDASH_LEGACY_TERRAFORM = Join-Path $ownedRoot "missing-legacy/terraform.exe"
  $plan = Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical
  Assert-Equal $plan.terraform_version "1.16.2" "A current plan was relabeled."
  Assert-PlanTimestampStrings $plan "Current reader"
  Assert-Equal $nativeCalls.Count 2 "A current plan unnecessarily inspected a historical reader."
  Assert-Equal $nativeCalls[1].Operation "Show" "The current reader did not use read-only show."
  foreach ($show in @('{bad json', 'null', '[]', '{}', '{"terraform_version":"1.9.8"}',
      '{"terraform_version":"1.16.3"}', '{"terraform_version":1162}')) {
    Reset-NativeFixture
    $currentShow = $show
    Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
      "Malformed or incorrectly versioned current JSON was accepted."
    Assert-Equal $nativeCalls.Count 2 "Malformed current JSON/version triggered a historical fallback."
  }
  Reset-NativeFixture
  $currentShowExit = 1
  $currentShow = "SYNTHETIC-PRIVATE-DIAGNOSTIC"
  Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot } `
    "Historical decoding occurred without explicit permission."
  Assert-Equal $nativeCalls.Count 2 "The default current reader invoked a historical binary."
  $plan = Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical
  Assert-Equal $plan.terraform_version "1.9.8" "A historical plan was relabeled or rejected."
  Assert-PlanTimestampStrings $plan "Historical reader"
  Assert-Equal $nativeCalls[4].Operation "Version" "The fallback omitted exact legacy version verification."
  Assert-Equal $nativeCalls[5].Executable $legacyExecutable "The fallback did not use the reviewed legacy file."
  Assert-Equal $nativeCalls[5].Operation "Show" "The legacy reader invoked a command other than show."
  foreach ($version in @('{"terraform_version":"1.16.2"}', '{"terraform_version":"1.9.7"}', '{bad json')) {
    Reset-NativeFixture
    $currentShowExit = 1
    $legacyVersion = $version
    Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
      "An unapproved legacy executable was accepted."
    Assert-Equal $nativeCalls.Count 3 "A wrong-version legacy executable was used to decode a plan."
  }
  Reset-NativeFixture
  $currentShowExit = 1
  $legacyVersionExit = 1
  $legacyVersion = "SYNTHETIC-PRIVATE-DIAGNOSTIC"
  Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
    "A failed historical version read was accepted."
  Reset-NativeFixture
  $currentShowExit = 1
  $legacyShowExit = 1
  $legacyShow = "SYNTHETIC-PRIVATE-DIAGNOSTIC"
  Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
    "A failed historical plan read was accepted."
  foreach ($json in @('{bad json', '{"terraform_version":"1.16.2"}', '{}')) {
    Reset-NativeFixture
    $currentShowExit = 1
    $legacyShow = $json
    Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
      "Invalid historical plan JSON/version was accepted."
  }
  foreach ($legacyPath in @("relative/terraform.exe", (Join-Path $ownedRoot "absent/terraform.exe"), $planPath)) {
    Reset-NativeFixture
    $currentShowExit = 1
    $env:APPLYDASH_LEGACY_TERRAFORM = $legacyPath
    Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot -AllowHistorical } `
      "An invalid historical executable path was accepted."
    Assert-Equal $nativeCalls.Count 2 "An invalid historical path reached native invocation."
  }
  Reset-NativeFixture
  $replacePlanOnShow = $true
  Assert-Throws { Read-DeploymentTerraformPlan -Path $planPath -TerraformDirectory $terraformRoot } `
    "A saved plan substituted during inspection was accepted."

  # Guard the real primitive as well as the mocked composition: its only native argument
  # alternatives must stay version/show. This test reads source, never executes a fake binary.
  $tokens = $null
  $errors = $null
  $helperPath = Join-Path $PSScriptRoot "../lib/terraform-toolchain.ps1"
  $ast = [Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$errors)
  Assert-Equal @($errors).Count 0 "The toolchain helper is not valid PowerShell."
  $primitive = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq "Invoke-DeploymentTerraformReadCommand"
  }, $true)
  $validateSet = $primitive.Body.ParamBlock.Parameters[1].Attributes | Where-Object { $_.TypeName.FullName -ceq "ValidateSet" }
  Assert-Equal (($validateSet.PositionalArguments | ForEach-Object { $_.Value }) -join ",") "Version,Show" `
    "The native toolchain primitive gained an unrestricted operation."
  $nativeCommands = @($primitive.FindAll({ param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.InvocationOperator -eq "Ampersand"
  }, $true))
  Assert-Equal $nativeCommands.Count 1 "The toolchain primitive gained a second native command boundary."
  Assert-Equal $nativeCommands[0].CommandElements[0].VariablePath.UserPath "Executable" `
    "The primitive stopped using the resolved native executable."
} finally {
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], "Process")
  }
  if (Test-Path -LiteralPath $ownedRoot) {
    $resolvedOwned = [IO.Path]::GetFullPath((Get-Item -LiteralPath $ownedRoot).FullName)
    if ([IO.Path]::GetDirectoryName($resolvedOwned) -cne $temporaryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        [IO.Path]::GetFileName($resolvedOwned) -cne $ownedName -or $ownedName -cnotmatch '^ai-job-apply-toolchain-tests-[0-9a-f]{32}$') {
      throw "Refusing cleanup outside the exact generated toolchain fixture directory."
    }
    Remove-Item -LiteralPath $resolvedOwned -Recurse -Force
  }
}

Write-Host "Terraform toolchain tests passed: $passed assertions; synthetic files and native mocks only."
