Set-StrictMode -Version Latest

function Get-DeploymentTerraformVersion { return "1.16.2" }

function Assert-DeploymentTerraformEnvironment {
  foreach ($entry in @(Get-ChildItem Env:)) {
    if ($entry.Name -imatch '^TF_CLI_ARGS' -and -not [string]::IsNullOrEmpty($entry.Value)) {
      throw "Terraform CLI argument overrides are not allowed."
    }
  }
  if (-not [string]::IsNullOrEmpty($env:TF_WORKSPACE) -and $env:TF_WORKSPACE -cne "default") {
    throw "Only the default Terraform workspace is allowed."
  }
}

function Resolve-DeploymentTerraformFile {
  param([Parameter(Mandatory)][string]$Path, [switch]$Directory)
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.PSProvider.Name -cne "FileSystem" -or $item.PSIsContainer -ne [bool]$Directory -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Rejected" }
    return [IO.Path]::GetFullPath($item.FullName)
  } catch { throw "The Terraform local file boundary is unavailable or invalid." }
}

function Get-DeploymentTerraformExecutable {
  try {
    # Operators also invoke `& terraform` after this guard. An alias/function must not
    # redirect that later invocation while validation quietly inspects a different native file.
    $command = Get-Command terraform -ErrorAction Stop | Select-Object -First 1
    if ($command.CommandType -ne [Management.Automation.CommandTypes]::Application) { throw "Rejected" }
    return Resolve-DeploymentTerraformFile -Path $command.Source
  } catch { throw "The current native Terraform executable is unavailable." }
}

# This deliberately exposes no generic argument/command execution interface. Historical readers
# may execute only version/show, never initialize a backend, plan, apply, or change a workspace.
function Invoke-DeploymentTerraformReadCommand {
  param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][ValidateSet("Version", "Show")][string]$Operation,
    [string]$TerraformDirectory,
    [string]$Path
  )
  $arguments = if ($Operation -ceq "Version") { @("version", "-json") }
    else { @("-chdir=$TerraformDirectory", "show", "-json", $Path) }
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& $Executable @arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } catch { throw "The Terraform read-only command could not start." }
  finally { $ErrorActionPreference = $priorPreference }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n") }
}

function ConvertFrom-DeploymentTerraformJson {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Json)
  try {
    $result = ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    if ($null -eq $result -or $result -isnot [pscustomobject]) { throw "Rejected" }
    return $result
  } catch { throw "Terraform returned invalid JSON." }
}

function Assert-DeploymentTerraformExecutableVersion {
  param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$ExpectedVersion)
  $result = Invoke-DeploymentTerraformReadCommand -Executable $Executable -Operation Version
  if ($result.ExitCode -ne 0) { throw "Terraform version inspection failed." }
  $version = ConvertFrom-DeploymentTerraformJson -Json $result.Output
  $property = $version.PSObject.Properties["terraform_version"]
  if ($null -eq $property -or $property.Value -isnot [string] -or
      $property.Value -cne $ExpectedVersion) { throw "The Terraform executable version is not approved." }
}

function Assert-DeploymentTerraformCli {
  Assert-DeploymentTerraformEnvironment
  Assert-DeploymentTerraformExecutableVersion -Executable (Get-DeploymentTerraformExecutable) `
    -ExpectedVersion (Get-DeploymentTerraformVersion)
}

function Assert-DeploymentTerraformStateVersion {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Version)
  if ($Version -cnotin @("1.9.8", (Get-DeploymentTerraformVersion))) {
    throw "The Terraform state writer version is not approved."
  }
}

function Test-DeploymentTerraformEmptySetting {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return $true }
  if ($Value -is [string]) { return $Value.Length -eq 0 }
  if ($Value -is [array]) { return $Value.Count -eq 0 }
  if ($Value -is [pscustomobject]) {
    foreach ($property in $Value.PSObject.Properties) {
      if (-not (Test-DeploymentTerraformEmptySetting -Value $property.Value)) { return $false }
    }
    return $true
  }
  return $false
}

function Assert-DeploymentTerraformBackend {
  param(
    [Parameter(Mandatory)][string]$TerraformDirectory,
    [string]$DataDirectory = "",
    [Parameter(Mandatory)][string]$ExpectedBucket,
    [Parameter(Mandatory)][string]$ExpectedKey,
    [Parameter(Mandatory)][string]$ExpectedRegion,
    [Parameter(Mandatory)][string]$ExpectedKmsKeyArn
  )
  Assert-DeploymentTerraformEnvironment
  $root = Resolve-DeploymentTerraformFile -Path $TerraformDirectory -Directory
  if ([string]::IsNullOrEmpty($DataDirectory)) { $DataDirectory = Join-Path $root ".terraform" }
  $data = Resolve-DeploymentTerraformFile -Path $DataDirectory -Directory
  $configuredData = if ([string]::IsNullOrEmpty($env:TF_DATA_DIR)) { Join-Path $root ".terraform" }
    elseif ([IO.Path]::IsPathRooted($env:TF_DATA_DIR)) { $env:TF_DATA_DIR }
    else { Join-Path $root $env:TF_DATA_DIR }
  if ((Resolve-DeploymentTerraformFile -Path $configuredData -Directory) -cne $data) {
    throw "The effective Terraform data directory does not match the reviewed directory."
  }
  # Terraform also remembers workspace selection on disk when TF_WORKSPACE is absent.
  $workspaceFile = Join-Path $data "environment"
  if (Test-Path -LiteralPath $workspaceFile) {
    $workspacePath = Resolve-DeploymentTerraformFile -Path $workspaceFile
    if ([IO.File]::ReadAllText($workspacePath).Trim() -cne "default") {
      throw "Only the default Terraform workspace is allowed."
    }
  }
  foreach ($entry in @(Get-ChildItem Env:)) {
    if ($entry.Name -imatch '^(?:AWS_ENDPOINT_URL(?:_.*)?|AWS_(?:S3|STS|IAM|DYNAMODB)_ENDPOINT|AWS_EC2_METADATA_SERVICE_ENDPOINT|AWS_SSE_CUSTOMER_KEY|AWS_CA_BUNDLE)$' -and
        -not [string]::IsNullOrEmpty($entry.Value)) {
      throw "Terraform backend endpoint or encryption overrides are not allowed."
    }
  }
  if ($ExpectedBucket -cnotmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' -or
      $ExpectedKey -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$' -or
      $ExpectedKey.Split('/') -contains '..' -or $ExpectedKey.Contains('//') -or
      $ExpectedRegion -cnotmatch '^[a-z]{2}(?:-[a-z]+)+-[0-9]+$' -or
      $ExpectedKmsKeyArn -cnotmatch ('^arn:aws:kms:' + [regex]::Escape($ExpectedRegion) + ':[0-9]{12}:key/[a-f0-9-]{36}$')) {
    throw "The expected Terraform backend identity is invalid."
  }
  $metadataPath = Resolve-DeploymentTerraformFile -Path (Join-Path $data "terraform.tfstate")
  try { $metadataText = [IO.File]::ReadAllText($metadataPath) }
  catch { throw "The cached Terraform backend metadata is unavailable." }
  $metadata = ConvertFrom-DeploymentTerraformJson -Json $metadataText
  $backendProperty = $metadata.PSObject.Properties["backend"]
  if ($null -eq $backendProperty -or $backendProperty.Value -isnot [pscustomobject]) {
    throw "The cached Terraform backend is not a reviewed S3 backend."
  }
  $backend = $backendProperty.Value
  $type = $backend.PSObject.Properties["type"]
  $configProperty = $backend.PSObject.Properties["config"]
  if ($null -eq $type -or $type.Value -cne "s3" -or
      $null -eq $configProperty -or $configProperty.Value -isnot [pscustomobject]) {
    throw "The cached Terraform backend is not a reviewed S3 backend."
  }
  $config = $configProperty.Value
  $expected = @{ bucket = $ExpectedBucket; key = $ExpectedKey; region = $ExpectedRegion; kms_key_id = $ExpectedKmsKeyArn }
  foreach ($key in $expected.Keys) {
    $property = $config.PSObject.Properties[$key]
    if ($null -eq $property -or $property.Value -isnot [string] -or $property.Value -cne $expected[$key]) {
      throw "The cached Terraform backend does not match the reviewed identity."
    }
  }
  foreach ($key in @("encrypt", "use_lockfile")) {
    $property = $config.PSObject.Properties[$key]
    if ($null -eq $property -or $property.Value -isnot [bool] -or -not $property.Value) {
      throw "Terraform backend encryption and S3 state locking must both be enabled."
    }
  }
  $falseDefaults = @("insecure", "force_path_style", "use_path_style", "skip_credentials_validation",
    "skip_metadata_api_check", "skip_region_validation", "skip_requesting_account_id", "skip_s3_checksum",
    "use_dualstack_endpoint", "use_fips_endpoint")
  foreach ($property in $config.PSObject.Properties) {
    if ($property.Name -cin @("bucket", "key", "region", "kms_key_id", "encrypt", "use_lockfile")) { continue }
    if (Test-DeploymentTerraformEmptySetting -Value $property.Value) { continue }
    if ($property.Name -cin $falseDefaults -and $property.Value -is [bool] -and -not $property.Value) { continue }
    if ($property.Name -ceq "workspace_key_prefix" -and $property.Value -ceq "env:") { continue }
    if ($property.Name -ceq "acl" -and $property.Value -ceq "private") { continue }
    throw "The cached Terraform backend contains an unreviewed setting or override."
  }
}

function Get-DeploymentTerraformLegacyExecutable {
  $path = $env:APPLYDASH_LEGACY_TERRAFORM
  if ([string]::IsNullOrEmpty($path)) {
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
    $path = Join-Path $repositoryRoot ".tmp/toolchains/terraform/1.9.8/terraform.exe"
  } elseif (-not [IO.Path]::IsPathRooted($path)) {
    throw "The historical Terraform executable must use an explicit absolute path."
  }
  $resolved = Resolve-DeploymentTerraformFile -Path $path
  if ([IO.Path]::GetFileName($resolved) -cne "terraform.exe") {
    throw "The historical Terraform executable path is invalid."
  }
  Assert-DeploymentTerraformExecutableVersion -Executable $resolved -ExpectedVersion "1.9.8"
  return $resolved
}

function Read-DeploymentTerraformPlan {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$TerraformDirectory,
    [switch]$AllowHistorical
  )
  Assert-DeploymentTerraformEnvironment
  $executable = Get-DeploymentTerraformExecutable
  $readerVersion = Get-DeploymentTerraformVersion
  Assert-DeploymentTerraformExecutableVersion -Executable $executable -ExpectedVersion $readerVersion
  $planPath = Resolve-DeploymentTerraformFile -Path $Path
  $directory = Resolve-DeploymentTerraformFile -Path $TerraformDirectory -Directory
  $before = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash
  $result = Invoke-DeploymentTerraformReadCommand -Executable $executable -Operation Show -TerraformDirectory $directory -Path $planPath
  if ($result.ExitCode -ne 0) {
    if (-not $AllowHistorical) { throw "The current Terraform saved plan could not be decoded." }
    $executable = Get-DeploymentTerraformLegacyExecutable
    $readerVersion = "1.9.8"
    $result = Invoke-DeploymentTerraformReadCommand -Executable $executable -Operation Show -TerraformDirectory $directory -Path $planPath
    if ($result.ExitCode -ne 0) { throw "The historical Terraform saved plan could not be decoded." }
  }
  # Invalid JSON/version is never a signal to try a different decoder.
  $plan = ConvertFrom-DeploymentTerraformJson -Json $result.Output
  $version = $plan.PSObject.Properties["terraform_version"]
  if ($null -eq $version -or $version.Value -isnot [string] -or $version.Value -cne $readerVersion) {
    throw "The Terraform saved plan does not match its approved reader version."
  }
  if ((Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash -cne $before) {
    throw "The saved Terraform plan changed during read-only inspection."
  }
  return $plan
}
