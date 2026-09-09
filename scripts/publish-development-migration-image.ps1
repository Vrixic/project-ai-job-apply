[CmdletBinding()]
param(
  [ValidateSet("LocalBuild", "Status", "Publish", "Verify")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",

  [string]$ReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedReceiptSha256 = "",

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\publish-development-migration-image.ps1 -Action LocalBuild `
    -SourceSha MERGED_40_CHARACTER_COMMIT

  .\scripts\publish-development-migration-image.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\publish-development-migration-image.ps1 -Action Publish `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT

  .\scripts\publish-development-migration-image.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -ReceiptPath .terraform/development-migration-image/receipt-....json `
    -ReviewedReceiptSha256 64_CHARACTER_SHA256

LocalBuild performs the source-bound tests, dependency audit, two clean linux/amd64 OCI exports,
byte-identity proof, and hardened runtime smoke without contacting AWS or claiming a vulnerability
scan. Status and Verify are read-only. Publish is the explicit GitHub Actions-budget fallback and
is the only action that writes AWS state: one immutable ECR image tagged with the exact source
commit. It repeats the complete LocalBuild gate, publishes the exact platform and source index,
requires a COMPLETE platform ECR scan with zero Critical and High findings, and emits a
checksum-reviewed version-2 receipt whose imageUri uses the platform digest. It never runs a migration,
registers a task definition, applies Terraform, or changes application traffic.

Receipts and logs remain below the ignored development .terraform directory. Do not copy account
IDs, repository/KMS identifiers, image manifests, or command logs into shared evidence.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development image publication is restricted to us-east-2." }
if ($Action -ne "LocalBuild" -and
    ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket))) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-migration-image"
$terraformDataDirectory = Join-Path $terraformRoot "development-migration-image-data"
$stateKey = "platform.tfstate"
$repositoryName = "ai-job-apply/migration"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function Get-DockerBuildxPluginPath {
  $pluginJson = & docker info --format '{{json .ClientInfo.Plugins}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$pluginJson)) {
    throw "Docker could not report its installed CLI plugins."
  }
  try { $plugins = @($pluginJson | ConvertFrom-Json) }
  catch { throw "Docker returned invalid CLI plugin metadata." }
  $buildxPlugins = @($plugins | Where-Object { [string]$_.Name -ceq "buildx" })
  if ($buildxPlugins.Count -ne 1) {
    throw "Exactly one Docker Buildx CLI plugin must be installed."
  }
  $pluginPath = [IO.Path]::GetFullPath([string]$buildxPlugins[0].Path)
  $pluginName = [IO.Path]::GetFileName($pluginPath)
  if ($pluginName -cnotmatch '^docker-buildx(?:\.exe)?$' -or
      -not (Test-Path -LiteralPath $pluginPath -PathType Leaf)) {
    throw "Docker reported an invalid Buildx CLI plugin path."
  }
  return $pluginPath
}

function ConvertTo-CanonicalUtcWholeSecond {
  param(
    [AllowNull()][object]$Value,
    [Parameter(Mandatory)][string]$Description
  )
  if ($Value -is [DateTime]) {
    $dateTimeValue = [DateTime]$Value
    if ($dateTimeValue.Kind -ne [DateTimeKind]::Utc -or
        ($dateTimeValue.Ticks % [TimeSpan]::TicksPerSecond) -ne 0) {
      throw "$Description must be an exact UTC whole-second timestamp."
    }
    return $dateTimeValue.ToString("yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($Value -isnot [string] -or [string]$Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') {
    throw "$Description must be an exact UTC whole-second timestamp."
  }
  $parsed = [DateTime]::MinValue
  $valid = [DateTime]::TryParseExact(
    [string]$Value,
    "yyyy-MM-ddTHH:mm:ss'Z'",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
    [ref]$parsed
  )
  if (-not $valid -or $parsed.Kind -ne [DateTimeKind]::Utc -or
      [string]$Value -cne $parsed.ToString("yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture)) {
    throw "$Description must be an exact UTC whole-second timestamp."
  }
  return [string]$Value
}

function ConvertFrom-PublicationReceiptJson {
  param([Parameter(Mandatory)][string]$Json)
  $parameters = @{}
  if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey("DateKind")) {
    $parameters.DateKind = "String"
  }
  try { return $Json | ConvertFrom-Json @parameters }
  catch { throw "The publication receipt is not valid JSON." }
}

function Resolve-OperatorPath {
  param([Parameter(Mandatory)][string]$Candidate, [switch]$MustExist)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw "A required operator path is missing." }
  $candidatePath = if ([IO.Path]::IsPathRooted($Candidate)) { $Candidate } else { Join-Path $terraformDirectory $Candidate }
  $resolved = [IO.Path]::GetFullPath($candidatePath)
  $root = [IO.Path]::GetFullPath($operatorRoot)
  $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Publication artifacts must stay below the ignored development migration-image directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "A required publication receipt does not exist."
  }
  return $resolved
}

function Write-JsonFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value, [switch]$AllowReplace)
  if ((Test-Path -LiteralPath $Path) -and -not $AllowReplace) { throw "Refusing to replace an existing publication receipt." }
  $parent = Split-Path -Parent $Path
  $null = New-Item -ItemType Directory -Path $parent -Force
  $temporary = Join-Path $parent (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($Path), [guid]::NewGuid().ToString("N"))
  $backup = "$temporary.backup"
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
    if ($AllowReplace -and (Test-Path -LiteralPath $Path -PathType Leaf)) {
      [IO.File]::Replace($temporary, $Path, $backup)
      if (Test-Path -LiteralPath $backup -PathType Leaf) { Remove-Item -LiteralPath $backup -Force }
    } else {
      Move-Item -LiteralPath $temporary -Destination $Path
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
  }
}

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Operation,
    [switch]$AllowFailure
  )
  $raw = & aws @Arguments 2>$null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    if ($AllowFailure) { return $null }
    throw "$Operation failed. Refresh the development IAM Identity Center session and inspect it locally."
  }
  if (-not $raw) { return $null }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "$Operation returned invalid JSON." }
}

function Invoke-AwsScanJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [switch]$AllowNotFound)
  $null = New-Item -ItemType Directory -Path $operatorRoot -Force
  $errorPath = Join-Path $operatorRoot (".scan-{0}.stderr" -f [guid]::NewGuid().ToString("N"))
  try {
    $raw = & aws @Arguments 2> $errorPath
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $errorText = if (Test-Path -LiteralPath $errorPath -PathType Leaf) {
        Get-Content -LiteralPath $errorPath -Raw
      } else { "" }
      if ($AllowNotFound -and $errorText -match '(?:Image)?ScanNotFoundException') { return $null }
      throw "Migration image vulnerability scan lookup failed. Refresh credentials and inspect it locally."
    }
    if (-not $raw) { throw "Migration image vulnerability scan lookup returned no JSON." }
    try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
    catch { throw "Migration image vulnerability scan lookup returned invalid JSON." }
  } finally {
    if (Test-Path -LiteralPath $errorPath -PathType Leaf) { Remove-Item -LiteralPath $errorPath -Force }
  }
}

function Invoke-TerraformJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & terraform "-chdir=$terraformDirectory" @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "$Operation returned invalid JSON." }
}

function Add-ManagedResources {
  param(
    [AllowNull()][object]$Module,
    [Parameter(Mandatory)][Collections.Generic.Dictionary[string, object]]$Destination
  )
  if ($null -eq $Module) { return }
  foreach ($resource in @(Get-OptionalProperty -Object $Module -Name "resources")) {
    if ($null -ne $resource -and [string]$resource.mode -ceq "managed") {
      $Destination[[string]$resource.address] = $resource
    }
  }
  foreach ($child in @(Get-OptionalProperty -Object $Module -Name "child_modules")) {
    Add-ManagedResources -Module $child -Destination $Destination
  }
}

function Assert-RepositoryShape {
  param(
    [Parameter(Mandatory)][object]$Repository,
    [Parameter(Mandatory)][string]$ExpectedName,
    [Parameter(Mandatory)][string]$ExpectedUri,
    [Parameter(Mandatory)][string]$ExpectedArn,
    [Parameter(Mandatory)][string]$ExpectedAccount,
    [Parameter(Mandatory)][string]$ExpectedRegion,
    [Parameter(Mandatory)][string]$ExpectedKmsArn
  )
  $encryption = Get-OptionalProperty -Object $Repository -Name "encryptionConfiguration"
  $scanning = Get-OptionalProperty -Object $Repository -Name "imageScanningConfiguration"
  if ([string]$Repository.repositoryName -cne $ExpectedName -or
      [string]$Repository.repositoryUri -cne $ExpectedUri -or
      [string]$Repository.repositoryArn -cne $ExpectedArn -or
      [string]$Repository.registryId -cne $ExpectedAccount -or
      [string]$Repository.imageTagMutability -cne "IMMUTABLE" -or
      -not [bool]$scanning.scanOnPush -or
      [string]$encryption.encryptionType -cne "KMS" -or
      [string]$encryption.kmsKey -cne $ExpectedKmsArn -or
      $ExpectedArn -notmatch "^arn:aws:ecr:$([regex]::Escape($ExpectedRegion)):$ExpectedAccount`:repository/") {
    throw "The live migration repository is not the exact immutable, scan-on-push, customer-KMS Terraform boundary."
  }
  return $true
}

function Resolve-OciBlobPath {
  param(
    [Parameter(Mandatory)][string]$LayoutPath,
    [Parameter(Mandatory)][string]$Digest
  )
  if ($Digest -notmatch '^sha256:[a-f0-9]{64}$') { throw "An OCI descriptor contains an invalid digest." }
  $candidate = [IO.Path]::GetFullPath((Join-Path $LayoutPath "blobs\sha256\$($Digest.Substring(7))"))
  $root = [IO.Path]::GetFullPath($LayoutPath).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "An OCI descriptor references a missing or out-of-layout blob."
  }
  if ((Get-FileSha256 -Path $candidate) -cne $Digest.Substring(7)) {
    throw "An OCI blob does not match its content digest."
  }
  return $candidate
}

function Get-OciLayoutIdentity {
  param(
    [Parameter(Mandatory)][string]$LayoutPath,
    [Parameter(Mandatory)][string]$ExpectedSourceSha,
    [Parameter(Mandatory)][string]$ExpectedCreated
  )
  $layout = [IO.Path]::GetFullPath($LayoutPath)
  $layoutMarkerPath = Join-Path $layout "oci-layout"
  $indexPath = Join-Path $layout "index.json"
  if (-not (Test-Path -LiteralPath $layoutMarkerPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    throw "The deterministic build did not export a complete OCI image layout."
  }
  try {
    $layoutMarker = Get-Content -LiteralPath $layoutMarkerPath -Raw | ConvertFrom-Json
    $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
  } catch { throw "The deterministic build exported invalid OCI JSON." }
  if ([string]$layoutMarker.imageLayoutVersion -cne "1.0.0" -or [int]$index.schemaVersion -ne 2 -or
      [string]$index.mediaType -cne "application/vnd.oci.image.index.v1+json") {
    throw "The deterministic build did not export an OCI 1.0 image index."
  }
  $indexDigest = "sha256:$(Get-FileSha256 -Path $indexPath)"
  $wrapperDescriptors = @($index.manifests)
  if ($wrapperDescriptors.Count -eq 1 -and
      [string]$wrapperDescriptors[0].mediaType -ceq "application/vnd.oci.image.index.v1+json" -and
      $null -eq (Get-OptionalProperty -Object $wrapperDescriptors[0] -Name "platform")) {
    $indexPath = Resolve-OciBlobPath -LayoutPath $layout -Digest ([string]$wrapperDescriptors[0].digest)
    if ([long]$wrapperDescriptors[0].size -ne (Get-Item -LiteralPath $indexPath).Length) {
      throw "The OCI export wrapper does not bind its exact image index."
    }
    try { $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json }
    catch { throw "The OCI export wrapper references an invalid image index." }
    $indexDigest = [string]$wrapperDescriptors[0].digest
  }
  if ([int]$index.schemaVersion -ne 2 -or
      [string]$index.mediaType -cne "application/vnd.oci.image.index.v1+json") {
    throw "The deterministic export does not contain a canonical OCI image index."
  }
  $allDescriptors = @($index.manifests)
  $platformDescriptors = @($allDescriptors | Where-Object {
      [string]$_.platform.os -ceq "linux" -and [string]$_.platform.architecture -ceq "amd64"
    })
  # Provenance and SBOM attestations are disabled, so no non-platform descriptors are allowed.
  if ($allDescriptors.Count -ne 1 -or $platformDescriptors.Count -ne 1) {
    throw "The OCI index must contain exactly one linux/amd64 image and no attestations."
  }
  $platformDescriptor = $platformDescriptors[0]
  if ([string]$platformDescriptor.mediaType -cne "application/vnd.oci.image.manifest.v1+json") {
    throw "The linux/amd64 OCI child is not an image manifest."
  }
  $manifestPath = Resolve-OciBlobPath -LayoutPath $layout -Digest ([string]$platformDescriptor.digest)
  if ([long]$platformDescriptor.size -ne (Get-Item -LiteralPath $manifestPath).Length) {
    throw "The linux/amd64 OCI child size does not match its descriptor."
  }
  try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
  catch { throw "The linux/amd64 OCI child manifest is invalid JSON." }
  if ([int]$manifest.schemaVersion -ne 2 -or
      [string]$manifest.mediaType -cne "application/vnd.oci.image.manifest.v1+json" -or
      [string]$manifest.config.mediaType -cne "application/vnd.oci.image.config.v1+json") {
    throw "The linux/amd64 child does not use the required OCI image media types."
  }
  $configPath = Resolve-OciBlobPath -LayoutPath $layout -Digest ([string]$manifest.config.digest)
  if ([long]$manifest.config.size -ne (Get-Item -LiteralPath $configPath).Length) {
    throw "The OCI image configuration size does not match its descriptor."
  }
  try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
  catch { throw "The OCI image configuration is invalid JSON." }
  $layers = @($manifest.layers)
  $diffIds = @($config.rootfs.diff_ids)
  foreach ($layer in $layers) {
    if ([string]$layer.mediaType -notmatch '^application/vnd\.oci\.image\.layer\.v1\.tar\+gzip$') {
      throw "The OCI image contains an unsupported compressed layer type."
    }
    $layerPath = Resolve-OciBlobPath -LayoutPath $layout -Digest ([string]$layer.digest)
    if ([long]$layer.size -ne (Get-Item -LiteralPath $layerPath).Length) {
      throw "An OCI layer size does not match its descriptor."
    }
  }
  $configCreated = ConvertTo-CanonicalUtcWholeSecond -Value $config.created -Description "OCI config.created"
  $labelCreated = ConvertTo-CanonicalUtcWholeSecond `
    -Value (Get-OptionalProperty -Object $config.config.Labels -Name "org.opencontainers.image.created") `
    -Description "The org.opencontainers.image.created label"
  if ([string]$config.architecture -cne "amd64" -or [string]$config.os -cne "linux" -or
      $configCreated -cne $ExpectedCreated -or $labelCreated -cne $ExpectedCreated -or
      [string]$config.config.User -cne "65532:65532" -or
      [string]$config.config.WorkingDir -cne "/migration" -or
      @($config.config.Entrypoint).Count -ne 1 -or [string]@($config.config.Entrypoint)[0] -cne "/usr/local/bin/node" -or
      @($config.config.Cmd).Count -ne 1 -or [string]@($config.config.Cmd)[0] -cne "runner/dist/src/main.js" -or
      [string](Get-OptionalProperty -Object $config.config.Labels -Name "org.opencontainers.image.revision") -cne $ExpectedSourceSha -or
      [string](Get-OptionalProperty -Object $config.config.Labels -Name "org.opencontainers.image.title") -cne "ai-job-apply-migration" -or
      [string]$config.rootfs.type -cne "layers" -or $layers.Count -lt 1 -or $layers.Count -ne $diffIds.Count -or
      @($diffIds | Where-Object { [string]$_ -notmatch '^sha256:[a-f0-9]{64}$' }).Count -ne 0) {
    throw "The OCI config is not the exact source-bound linux/amd64 migration artifact."
  }
  $compressed = @($layers | ForEach-Object { [string]$_.digest })
  return [pscustomobject]@{
    IndexDigest                  = $indexDigest
    PlatformDigest               = [string]$platformDescriptor.digest
    ConfigDigest                 = [string]$manifest.config.digest
    CompressedLayerSetSha256     = Get-TextSha256 -Value ($compressed -join "`n")
    RootfsDiffIdSetSha256        = Get-TextSha256 -Value (($diffIds | ForEach-Object { [string]$_ }) -join "`n")
    ManifestJson                 = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8)
    IndexPath                    = $indexPath
  }
}

function Assert-DeterministicOciIdentity {
  param([Parameter(Mandatory)][object]$First, [Parameter(Mandatory)][object]$Second)
  foreach ($name in @("IndexDigest", "PlatformDigest", "ConfigDigest", "CompressedLayerSetSha256", "RootfsDiffIdSetSha256")) {
    if ([string](Get-OptionalProperty -Object $First -Name $name) -cne
        [string](Get-OptionalProperty -Object $Second -Name $name)) {
      throw "The two clean migration image builds were not byte-identical at the OCI $name boundary."
    }
  }
  return $true
}

function Assert-ExactPropertySet {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string[]]$ExpectedNames,
    [Parameter(Mandatory)][string]$Description
  )
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($ExpectedNames | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
  return $true
}

function Test-CanonicalUtcTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $false }
  $parsed = [DateTimeOffset]::MinValue
  $valid = [DateTimeOffset]::TryParseExact(
    [string]$Value,
    "o",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  )
  return $valid -and $parsed.Offset -eq [TimeSpan]::Zero -and [string]$Value -ceq $parsed.ToString("o")
}

function Get-CanonicalReceiptPropertyNames {
  return @(
    "schemaVersion", "kind", "environment", "region", "sourceSha", "boundarySha256",
    "repositoryName", "repositoryUri", "sourceTag", "handoffTag", "platform", "created",
    "indexDigest", "platformDigest", "configDigest", "compressedLayerSetSha256",
    "rootfsDiffIdSetSha256", "phase", "imageUri", "scanStatus", "criticalFindings",
    "highFindings", "publicationStartedAt", "publicationCompletedAt"
  )
}

function Assert-ResumablePublicationReceipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$Expected
  )
  $null = Assert-ExactPropertySet -Value $Receipt -ExpectedNames (Get-CanonicalReceiptPropertyNames) `
    -Description "The retained in-progress publication receipt"
  if ([int]$Receipt.schemaVersion -ne 2 -or
      [string]$Receipt.kind -cne "development-migration-image-publication" -or
      [string]$Receipt.environment -cne "development" -or
      [string]$Receipt.region -cne [string]$Expected.region -or
      [string]$Receipt.sourceSha -cne [string]$Expected.sourceSha -or
      [string]$Receipt.boundarySha256 -cne [string]$Expected.boundarySha256 -or
      [string]$Receipt.repositoryName -cne [string]$Expected.repositoryName -or
      [string]$Receipt.repositoryUri -cne [string]$Expected.repositoryUri -or
      [string]$Receipt.sourceTag -cne [string]$Expected.sourceTag -or
      [string]$Receipt.handoffTag -cne [string]$Expected.handoffTag -or
      [string]$Receipt.platform -cne "linux/amd64" -or
      [string]$Receipt.created -cne [string]$Expected.created -or
      [string]$Receipt.indexDigest -cne [string]$Expected.indexDigest -or
      [string]$Receipt.platformDigest -cne [string]$Expected.platformDigest -or
      [string]$Receipt.configDigest -cne [string]$Expected.configDigest -or
      [string]$Receipt.compressedLayerSetSha256 -cne [string]$Expected.compressedLayerSetSha256 -or
      [string]$Receipt.rootfsDiffIdSetSha256 -cne [string]$Expected.rootfsDiffIdSetSha256 -or
      [string]$Receipt.phase -cne "publishing" -or
      [string]$Receipt.imageUri -cne "" -or
      [string]$Receipt.scanStatus -cne "" -or [int]$Receipt.criticalFindings -ne -1 -or
      [int]$Receipt.highFindings -ne -1 -or
      -not (Test-CanonicalUtcTimestamp -Value $Receipt.publicationStartedAt) -or
      [string]$Receipt.publicationCompletedAt -cne "") {
    throw "The retained receipt is not the exact canonical in-progress publication."
  }
  return $true
}

function Resolve-PublicationResumeMode {
  param(
    [Parameter(Mandatory)][bool]$RemoteIndexExists,
    [Parameter(Mandatory)][bool]$RemotePlatformExists,
    [Parameter(Mandatory)][bool]$ReceiptExists,
    [AllowNull()][object]$Receipt,
    [Parameter(Mandatory)][object]$Expected
  )
  if (-not $ReceiptExists) {
    if ($RemoteIndexExists -or $RemotePlatformExists) { throw "An immutable publication tag already exists without the exact resumable receipt." }
    return "new-publication"
  }
  if ($null -eq $Receipt) { throw "The retained publication receipt could not be parsed." }
  $null = Assert-ResumablePublicationReceipt -Receipt $Receipt -Expected $Expected
  if ($RemoteIndexExists -and -not $RemotePlatformExists) { throw "The source index exists without its exact platform handoff." }
  if ($RemoteIndexExists) { return "resume-readback" }
  if ($RemotePlatformExists) { return "resume-index" }
  return "resume-push"
}

function Assert-RemoteOciImage {
  param(
    [Parameter(Mandatory)][object]$IndexDetail,
    [Parameter(Mandatory)][object]$IndexImage,
    [Parameter(Mandatory)][object]$PlatformImage,
    [Parameter(Mandatory)][object]$Scan,
    [Parameter(Mandatory)][string]$ExpectedTag,
    [Parameter(Mandatory)][string]$ExpectedIndexDigest,
    [Parameter(Mandatory)][string]$ExpectedPlatformDigest,
    [Parameter(Mandatory)][string]$ExpectedConfigDigest,
    [Parameter(Mandatory)][string]$ExpectedCompressedLayerSetSha256
  )
  $tags = @($IndexDetail.imageTags)
  if ([string]$IndexDetail.imageDigest -cne $ExpectedIndexDigest -or $tags -notcontains $ExpectedTag -or
      [string]$IndexImage.imageId.imageDigest -cne $ExpectedIndexDigest) {
    throw "The exact immutable source tag did not resolve to the expected OCI index digest."
  }
  $indexJson = [string]$IndexImage.imageManifest
  if (("sha256:$(Get-TextSha256 -Value $indexJson)") -cne $ExpectedIndexDigest) {
    throw "ECR did not return the exact byte-bound OCI index."
  }
  try { $index = $indexJson | ConvertFrom-Json }
  catch { throw "ECR returned an invalid OCI index." }
  $descriptors = @($index.manifests)
  $platformDescriptors = @($descriptors | Where-Object {
      [string]$_.platform.os -ceq "linux" -and [string]$_.platform.architecture -ceq "amd64"
    })
  if ($descriptors.Count -ne 1 -or $platformDescriptors.Count -ne 1 -or
      [string]$platformDescriptors[0].digest -cne $ExpectedPlatformDigest -or
      [string]$PlatformImage.imageId.imageDigest -cne $ExpectedPlatformDigest) {
    throw "The remote OCI index does not bind exactly one expected linux/amd64 child."
  }
  $manifestJson = [string]$PlatformImage.imageManifest
  if (("sha256:$(Get-TextSha256 -Value $manifestJson)") -cne $ExpectedPlatformDigest) {
    throw "ECR did not return the exact byte-bound linux/amd64 manifest."
  }
  try { $manifest = $manifestJson | ConvertFrom-Json }
  catch { throw "ECR returned an invalid linux/amd64 manifest." }
  $compressed = @($manifest.layers | ForEach-Object { [string]$_.digest })
  if ([int]$manifest.schemaVersion -ne 2 -or [string]$manifest.config.digest -cne $ExpectedConfigDigest -or
      $compressed.Count -lt 1 -or @($compressed | Where-Object { $_ -notmatch '^sha256:[a-f0-9]{64}$' }).Count -ne 0 -or
      (Get-TextSha256 -Value ($compressed -join "`n")) -cne $ExpectedCompressedLayerSetSha256) {
    throw "The remote platform manifest does not bind the exact configuration and compressed layers."
  }
  $scanStatusEnvelope = Get-OptionalProperty -Object $Scan -Name "imageScanStatus"
  $findingsEnvelope = Get-OptionalProperty -Object $Scan -Name "imageScanFindings"
  if ($null -eq $scanStatusEnvelope -or $null -eq $findingsEnvelope) {
    throw "ECR did not return the required image scan status and findings envelopes."
  }
  $scanStatus = [string](Get-OptionalProperty -Object $scanStatusEnvelope -Name "status")
  $counts = Get-OptionalProperty -Object $findingsEnvelope -Name "findingSeverityCounts"
  if ($null -eq $counts) { $counts = [pscustomobject]@{} }
  $criticalValue = Get-OptionalProperty -Object $counts -Name "CRITICAL"
  $highValue = Get-OptionalProperty -Object $counts -Name "HIGH"
  $critical = if ($null -eq $criticalValue) { 0 } else { [int]$criticalValue }
  $high = if ($null -eq $highValue) { 0 } else { [int]$highValue }
  if ($scanStatus -cne "COMPLETE" -or $critical -ne 0 -or $high -ne 0) {
    throw "The exact linux/amd64 image does not have a COMPLETE zero-Critical/zero-High ECR scan."
  }
  return [pscustomobject]@{
    IndexDigest    = $ExpectedIndexDigest
    PlatformDigest = $ExpectedPlatformDigest
    Critical       = $critical
    High           = $high
  }
}

function Assert-PublicationReceipt {
  param(
    [Parameter(Mandatory)][object]$Receipt,
    [Parameter(Mandatory)][object]$Boundary,
    [Parameter(Mandatory)][string]$ExpectedRegion,
    [Parameter(Mandatory)][string]$ExpectedSourceSha,
    [Parameter(Mandatory)][string]$ExpectedCreated
  )
  $null = Assert-ExactPropertySet -Value $Receipt -ExpectedNames (Get-CanonicalReceiptPropertyNames) `
    -Description "The verified publication receipt"
  if ([int]$Receipt.schemaVersion -ne 2 -or [string]$Receipt.kind -cne "development-migration-image-publication" -or
      [string]$Receipt.environment -cne "development" -or [string]$Receipt.region -cne $ExpectedRegion -or
      [string]$Receipt.sourceSha -cne $ExpectedSourceSha -or [string]$Receipt.boundarySha256 -cne $Boundary.BoundarySha256 -or
      [string]$Receipt.repositoryName -cne $Boundary.RepositoryName -or
      [string]$Receipt.repositoryUri -cne $Boundary.RepositoryUri -or [string]$Receipt.phase -cne "verified" -or
      [string]$Receipt.platform -cne "linux/amd64" -or [string]$Receipt.created -cne $ExpectedCreated -or
      [string]$Receipt.handoffTag -cne "$ExpectedSourceSha-linux-amd64" -or
      [string]$Receipt.indexDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$Receipt.platformDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$Receipt.configDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$Receipt.compressedLayerSetSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$Receipt.rootfsDiffIdSetSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$Receipt.imageUri -cne "$($Boundary.RepositoryUri)@$($Receipt.platformDigest)" -or
      [string]$Receipt.sourceTag -cne $ExpectedSourceSha -or [string]$Receipt.scanStatus -cne "COMPLETE" -or
      [int]$Receipt.criticalFindings -ne 0 -or [int]$Receipt.highFindings -ne 0 -or
      -not (Test-CanonicalUtcTimestamp -Value $Receipt.publicationStartedAt) -or
      -not (Test-CanonicalUtcTimestamp -Value $Receipt.publicationCompletedAt)) {
    throw "The publication receipt does not match the exact reviewed environment, source, image, and scan."
  }
  $started = [DateTimeOffset]::ParseExact(
    [string]$Receipt.publicationStartedAt, "o", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind
  )
  $completed = [DateTimeOffset]::ParseExact(
    [string]$Receipt.publicationCompletedAt, "o", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind
  )
  if ($completed -lt $started) { throw "The verified receipt completion timestamp precedes publication." }
  return $true
}

function Assert-CallerToolsAndSource {
  param(
    [switch]$RequireExplicitSource,
    [switch]$RequireDocker,
    [switch]$RequireAws,
    [switch]$RequireTerraform
  )
  if ($RequireAws) {
    $identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--output", "json") -Operation "AWS caller validation"
    if ([string]$identity.Account -cne $ExpectedAccountId -or
        -not ([string]$identity.Arn).Contains(":assumed-role/")) {
      throw "Use a temporary IAM Identity Center caller in the exact development account."
    }
  }
  if ($RequireTerraform) {
    Assert-DeploymentTerraformCli
  }
  if ($RequireDocker) {
    & docker buildx version *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker Buildx is required for deterministic linux/amd64 publication." }
  }
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $upstream -or $dirty.Count -ne 0) {
    throw "Publication requires a clean main checkout exactly matching origin/main."
  }
  if ($RequireExplicitSource -and ($SourceSha -notmatch '^[a-f0-9]{40}$' -or $SourceSha -cne $head)) {
    throw "SourceSha must equal the exact merged main checkout."
  }
  return $head
}

function Initialize-Backend {
  $encryption = Invoke-AwsJson -Arguments @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") -Operation "State encryption validation"
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and
      -not [string]::IsNullOrWhiteSpace([string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID) -and $_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) { throw "The state bucket must expose one bucket-key-enabled customer KMS default." }
  $stateKmsArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($stateKmsArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The state bucket KMS key is outside the exact development boundary."
  }
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=$stateKey" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$stateKmsArn" "-backend-config=encrypt=true" "-backend-config=use_lockfile=true" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted development backend could not be initialized." }
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $terraformDataDirectory `
    -ExpectedBucket $StateBucket -ExpectedKey $stateKey -ExpectedRegion $Region -ExpectedKmsKeyArn $stateKmsArn
  $head = Invoke-AwsJson -Arguments @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") -Operation "State object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne $stateKmsArn -or
      -not $head.BucketKeyEnabled -or [long]$head.ContentLength -le 0 -or [string]::IsNullOrWhiteSpace([string]$head.VersionId)) {
    throw "The current Terraform state object is not protected by the exact state KMS boundary."
  }
}

function Resolve-RepositoryBoundary {
  $state = Invoke-TerraformJson -Arguments @("show", "-json") -Operation "Terraform state inspection"
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  Add-ManagedResources -Module $state.values.root_module -Destination $resources
  $repositoryAddress = "module.platform.aws_ecr_repository.migration"
  $kmsAddress = "module.platform.aws_kms_key.platform"
  if (-not $resources.ContainsKey($repositoryAddress) -or -not $resources.ContainsKey($kmsAddress)) {
    throw "Terraform state does not own the required migration repository and platform KMS key."
  }
  $repositoryState = $resources[$repositoryAddress].values
  $kmsArn = [string]$resources[$kmsAddress].values.arn
  $repositoryUri = [string]$repositoryState.repository_url
  $repositoryArn = [string]$repositoryState.arn
  $outputUri = [string](Invoke-TerraformJson -Arguments @("output", "-json", "migration_repository_url") -Operation "Migration repository output validation")
  if ([string]$repositoryState.name -cne $repositoryName -or $repositoryUri -cne $outputUri -or
      [string]$repositoryState.image_tag_mutability -cne "IMMUTABLE" -or
      -not [bool]$repositoryState.image_scanning_configuration[0].scan_on_push -or
      [string]$repositoryState.encryption_configuration[0].encryption_type -cne "KMS" -or
      [string]$repositoryState.encryption_configuration[0].kms_key -cne $kmsArn -or
      $kmsArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "Terraform state does not define the exact hardened migration repository boundary."
  }
  $described = Invoke-AwsJson -Arguments @("ecr", "describe-repositories", "--repository-names", $repositoryName, "--output", "json") -Operation "Migration repository validation"
  $repositories = @($described.repositories)
  if ($repositories.Count -ne 1) { throw "AWS did not return exactly one migration repository." }
  $null = Assert-RepositoryShape -Repository $repositories[0] -ExpectedName $repositoryName `
    -ExpectedUri $repositoryUri -ExpectedArn $repositoryArn -ExpectedAccount $ExpectedAccountId `
    -ExpectedRegion $Region -ExpectedKmsArn $kmsArn
  $key = Invoke-AwsJson -Arguments @("kms", "describe-key", "--key-id", $kmsArn, "--output", "json") -Operation "Migration repository KMS validation"
  if ([string]$key.KeyMetadata.Arn -cne $kmsArn -or [string]$key.KeyMetadata.KeyManager -cne "CUSTOMER" -or
      [string]$key.KeyMetadata.KeyState -cne "Enabled" -or -not $key.KeyMetadata.Enabled -or
      [string]$key.KeyMetadata.KeyUsage -cne "ENCRYPT_DECRYPT") {
    throw "The migration repository KMS key is not an enabled customer-managed encryption key."
  }
  return [pscustomobject]@{
    RepositoryName = $repositoryName
    RepositoryUri  = $repositoryUri
    RepositoryArn  = $repositoryArn
    KmsArn         = $kmsArn
    BoundarySha256 = Get-TextSha256 -Value "$ExpectedAccountId|$Region|$repositoryArn|$repositoryUri|$kmsArn"
  }
}

function Invoke-LocalGate {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Command, [Parameter(Mandatory)][string]$LogPath)
  & $Command *> $LogPath
  if ($LASTEXITCODE -ne 0) { throw "$Name failed. Inspect the ignored local log." }
}

function Invoke-LocalMigrationImageBuild {
  param(
    [Parameter(Mandatory)][string]$ExpectedSourceSha,
    [Parameter(Mandatory)][string]$ExpectedOperatorRoot,
    [Parameter(Mandatory)][string]$ExpectedRepositoryRoot
  )
  $null = New-Item -ItemType Directory -Path $ExpectedOperatorRoot -Force
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $contractsLog = Join-Path $ExpectedOperatorRoot "contract-generation-$timestamp.log"
  $testLog = Join-Path $ExpectedOperatorRoot "migration-tests-$timestamp.log"
  $auditLog = Join-Path $ExpectedOperatorRoot "dependency-audit-$timestamp.log"
  $buildOneLog = Join-Path $ExpectedOperatorRoot "build-one-$timestamp.log"
  $buildTwoLog = Join-Path $ExpectedOperatorRoot "build-two-$timestamp.log"
  $smokeLog = Join-Path $ExpectedOperatorRoot "runtime-smoke-$timestamp.log"
  Invoke-LocalGate -Name "Contract generation" -LogPath $contractsLog -Command {
    pnpm contracts:generate
  }
  Invoke-LocalGate -Name "Migration owner tests" -LogPath $testLog -Command {
    pnpm turbo run test `
      --filter=@ai-job-apply/database-migrations `
      --filter=@ai-job-apply/profile-service `
      --filter=@ai-job-apply/jobs-service `
      --filter=@ai-job-apply/documents-service
  }
  Invoke-LocalGate -Name "Dependency audit" -LogPath $auditLog -Command { pnpm audit:dependencies }

  $commitEpoch = (& git -C $ExpectedRepositoryRoot show -s --format=%ct $ExpectedSourceSha 2>$null).Trim()
  if ($commitEpoch -notmatch '^[0-9]{10,}$') { throw "The exact source commit timestamp could not be resolved." }
  $created = [DateTimeOffset]::FromUnixTimeSeconds([long]$commitEpoch).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $buildTag = "ai-job-apply-migration:local-$ExpectedSourceSha"
  $layoutOne = Join-Path $ExpectedOperatorRoot "oci-$($ExpectedSourceSha.Substring(0, 12))-one-$timestamp"
  $layoutTwo = Join-Path $ExpectedOperatorRoot "oci-$($ExpectedSourceSha.Substring(0, 12))-two-$timestamp"
  foreach ($layout in @($layoutOne, $layoutTwo)) {
    if (Test-Path -LiteralPath $layout) { throw "Refusing to replace a deterministic OCI build layout." }
  }
  $buildArguments = @(
    "buildx", "build", "--no-cache", "--platform", "linux/amd64",
    "--provenance=false", "--sbom=false", "--build-arg", "SOURCE_DATE_EPOCH=$commitEpoch",
    "--build-arg", "BUILDKIT_MULTI_PLATFORM=1",
    "--label", "org.opencontainers.image.revision=$ExpectedSourceSha",
    "--label", "org.opencontainers.image.created=$created",
    "--label", "org.opencontainers.image.title=ai-job-apply-migration",
    "--file", (Join-Path $ExpectedRepositoryRoot "Dockerfile.migration")
  )
  Invoke-LocalGate -Name "First deterministic migration image build" -LogPath $buildOneLog -Command {
    docker @buildArguments --output "type=oci,dest=$layoutOne,tar=false,rewrite-timestamp=true" --tag $buildTag $ExpectedRepositoryRoot
  }
  $identityOne = Get-OciLayoutIdentity -LayoutPath $layoutOne -ExpectedSourceSha $ExpectedSourceSha -ExpectedCreated $created
  Invoke-LocalGate -Name "Second deterministic migration image build" -LogPath $buildTwoLog -Command {
    docker @buildArguments --output "type=oci,dest=$layoutTwo,tar=false,rewrite-timestamp=true" --tag $buildTag $ExpectedRepositoryRoot
  }
  $identityTwo = Get-OciLayoutIdentity -LayoutPath $layoutTwo -ExpectedSourceSha $ExpectedSourceSha -ExpectedCreated $created
  $null = Assert-DeterministicOciIdentity -First $identityOne -Second $identityTwo

  $loadArchive = Join-Path $ExpectedOperatorRoot "oci-load-$($ExpectedSourceSha.Substring(0, 12))-$timestamp.tar"
  try {
    Invoke-LocalGate -Name "Deterministic migration image load" -LogPath $smokeLog -Command {
      tar -cf $loadArchive -C $layoutTwo .
      if ($LASTEXITCODE -eq 0) { docker load -i $loadArchive }
    }
    $smokeScript = @'
import{access,readdir}from"node:fs/promises";import{createRequire}from"node:module";
const{migrationRunners}=await import("./runner/dist/src/index.js");
if(migrationRunners.map(x=>x.owner).join(",")!=="profile,jobs,documents,matching,billing,trust")throw new Error("owner/order mismatch");
for(const runner of migrationRunners)await access(runner.executable);
for(const entrypoint of ["profile/dist/src/run-private-feature-acceptance.js","profile/migrations/0007_candidate_rights_export_null_omission.sql","profile/migrations/0008_ugc_contribution_consents.sql","profile/migrations/0009_ugc_contribution_consent_candidate_rights.sql","jobs/dist/src/search-acceptance.js","jobs/dist/src/run-search-acceptance.js","documents/dist/src/run-document-processing-acceptance.js","matching/dist/src/run-private-feature-acceptance.js","runner/dist/src/restore-verifier-cli.js","runner/restore-manifest.v1.json","jobs/migrations/0009_provider_ingestion_sources.sql","jobs/migrations/0010_public_job_truth_fields.sql","jobs/migrations/0011_positive_source_withdrawal.sql","jobs/migrations/0012_candidate_rights.sql","jobs/migrations/0013_public_job_sitemap.sql","jobs/migrations/0014_job_contribution_intake.sql","jobs/migrations/0015_source_revalidation_lifecycle.sql","jobs/migrations/0016_job_contribution_candidate_rights.sql","jobs/migrations/0017_job_contribution_processing.sql","jobs/migrations/0018_job_contribution_processing_delivery.sql","jobs/migrations/0019_job_contribution_provider_publication.sql","jobs/migrations/0020_contribution_trust_reprocessing.sql","jobs/migrations/0021_development_contribution_operation_lease.sql","jobs/migrations/0022_development_contribution_provider_leases.sql","jobs/migrations/0023_contribution_verification_refresh.sql","matching/migrations/0003_private_saved_page_captures.sql","trust/dist/src/migrate.js","trust/migrations/0001_ugc_trust_foundation.sql","trust/migrations/0002_candidate_rights.sql","trust/migrations/0003_decision_signals.sql","trust/migrations/0004_accepted_independent_evidence.sql"])await access(entrypoint);
const{loadCurrentRestoreManifest}=await import("./runner/dist/src/restore-verifier.js");
const source=loadCurrentRestoreManifest();const manifest=source.manifest;
if(manifest.manifestId!=="d2-community-lifecycle-profile-jobs-documents-matching-billing-trust-v1"||manifest.contributors.length!==6||manifest.contributors.flatMap(x=>x.schemas).length!==10||manifest.contributors.flatMap(x=>x.relations).length!==68||manifest.contributors.flatMap(x=>x.migrations).length!==44)throw new Error("restore manifest mismatch");
for(const owner of ["profile","billing","trust"])createRequire(new URL(`./${owner}/package.json`,import.meta.url)).resolve("postgres");
const expected={profile:["0001_foundation.sql","0002_serverless_outbox.sql","0003_retire_legacy_dispatch.sql","0004_profile_fact_versions.sql","0005_resume_fact_proposals.sql","0006_candidate_rights.sql","0007_candidate_rights_export_null_omission.sql","0008_ugc_contribution_consents.sql","0009_ugc_contribution_consent_candidate_rights.sql"],jobs:["0001_job_catalog.sql","0002_duplicate_resolution.sql","0003_duplicate_resolution_audit_guard.sql","0004_job_search.sql","0005_ingestion_orchestration.sql","0006_public_job_reader.sql","0007_matchable_job_attributes.sql","0008_job_reporting_and_moderation.sql","0009_provider_ingestion_sources.sql","0010_public_job_truth_fields.sql","0011_positive_source_withdrawal.sql","0012_candidate_rights.sql","0013_public_job_sitemap.sql","0014_job_contribution_intake.sql","0015_source_revalidation_lifecycle.sql","0016_job_contribution_candidate_rights.sql","0017_job_contribution_processing.sql","0018_job_contribution_processing_delivery.sql","0019_job_contribution_provider_publication.sql","0020_contribution_trust_reprocessing.sql","0021_development_contribution_operation_lease.sql","0022_development_contribution_provider_leases.sql","0023_contribution_verification_refresh.sql"],documents:["0001_resume_intake.sql","0002_resume_processing.sql","0003_candidate_rights.sql"],matching:["0001_saved_jobs.sql","0002_candidate_rights.sql","0003_private_saved_page_captures.sql"],billing:["0001_entitlement_projection.sql","0002_candidate_rights.sql"],trust:["0001_ugc_trust_foundation.sql","0002_candidate_rights.sql","0003_decision_signals.sql","0004_accepted_independent_evidence.sql"]};
for(const[owner,names]of Object.entries(expected)){const files=(await readdir(`./${owner}/migrations`)).filter(x=>x.endsWith(".sql")).sort();if(files.join(",")!==names.join(","))throw new Error(`${owner} SQL migration set mismatch`)}
console.log("migration-runtime-smoke:ok")
'@
    & docker run --rm --platform linux/amd64 --network none --read-only --cap-drop ALL `
      --security-opt no-new-privileges --user 65532:65532 --entrypoint /usr/local/bin/node `
      $buildTag --input-type=module -e $smokeScript *> $smokeLog
    if ($LASTEXITCODE -ne 0) { throw "The deterministic migration runtime smoke test failed; inspect the ignored local log." }
  } finally {
    if (Test-Path -LiteralPath $loadArchive -PathType Leaf) { Remove-Item -LiteralPath $loadArchive -Force }
  }

  return [pscustomobject]@{
    Timestamp         = $timestamp
    Created           = $created
    BuildTag          = $buildTag
    LayoutPath        = $layoutTwo
    Identity          = $identityTwo
    EvidenceDirectory = $ExpectedOperatorRoot
  }
}

function Get-EcrTagState {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][string]$Tag)
  $response = Invoke-AwsJson -Arguments @(
    "ecr", "batch-get-image", "--repository-name", $Boundary.RepositoryName,
    "--image-ids", "imageTag=$Tag", "--accepted-media-types",
    "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
    "--output", "json"
  ) -Operation "Immutable migration tag lookup"
  $images = @($response.images)
  $failures = @($response.failures)
  if ($images.Count -eq 1 -and $failures.Count -eq 0) {
    return [pscustomobject]@{ Exists = $true; Image = $images[0] }
  }
  if ($images.Count -eq 0 -and $failures.Count -eq 1 -and
      [string]$failures[0].failureCode -ceq "ImageNotFound") {
    return [pscustomobject]@{ Exists = $false; Image = $null }
  }
  throw "An immutable migration-tag lookup returned an ambiguous result."
}

function Assert-PlatformHandoff {
  param(
    [Parameter(Mandatory)][object]$BatchImage,
    [Parameter(Mandatory)][object]$Identity
  )
  if ([string]$BatchImage.imageId.imageDigest -cne [string]$Identity.PlatformDigest) {
    throw "The immutable platform handoff resolves to the wrong digest."
  }
  $manifestJson = [string]$BatchImage.imageManifest
  if (("sha256:$(Get-TextSha256 -Value $manifestJson)") -cne [string]$Identity.PlatformDigest) {
    throw "The immutable platform handoff did not preserve the exact OCI manifest bytes."
  }
  try { $manifest = $manifestJson | ConvertFrom-Json }
  catch { throw "The immutable platform handoff is not valid OCI JSON." }
  $compressed = @($manifest.layers | ForEach-Object { [string]$_.digest })
  if ([string]$manifest.config.digest -cne [string]$Identity.ConfigDigest -or
      (Get-TextSha256 -Value ($compressed -join "`n")) -cne [string]$Identity.CompressedLayerSetSha256) {
    throw "The immutable platform handoff changed the config or compressed layer chain."
  }
  return $true
}

function Get-RemoteImageReadback {
  param(
    [Parameter(Mandatory)][object]$Boundary,
    [Parameter(Mandatory)][string]$Tag,
    [Parameter(Mandatory)][object]$Identity,
    [switch]$WaitForScan
  )
  $detailResponse = Invoke-AwsJson -Arguments @(
    "ecr", "describe-images", "--repository-name", $Boundary.RepositoryName,
    "--image-ids", "imageTag=$Tag", "--output", "json"
  ) -Operation "Immutable migration image lookup"
  $details = @($detailResponse.imageDetails)
  if ($details.Count -ne 1) { throw "The exact migration image tag did not resolve once." }
  $indexResponse = Invoke-AwsJson -Arguments @(
    "ecr", "batch-get-image", "--repository-name", $Boundary.RepositoryName,
    "--image-ids", "imageDigest=$($Identity.IndexDigest)", "--accepted-media-types",
    "application/vnd.oci.image.index.v1+json",
    "--output", "json"
  ) -Operation "Immutable migration index readback"
  $platformResponse = Invoke-AwsJson -Arguments @(
    "ecr", "batch-get-image", "--repository-name", $Boundary.RepositoryName,
    "--image-ids", "imageDigest=$($Identity.PlatformDigest)", "--accepted-media-types",
    "application/vnd.oci.image.manifest.v1+json", "--output", "json"
  ) -Operation "Immutable migration platform readback"
  if (@($indexResponse.images).Count -ne 1 -or @($indexResponse.failures).Count -ne 0 -or
      @($platformResponse.images).Count -ne 1 -or @($platformResponse.failures).Count -ne 0) {
    throw "ECR did not return exactly one index and one linux/amd64 child manifest."
  }
  $scan = $null
  $attemptLimit = if ($WaitForScan) { 60 } else { 1 }
  for ($attempt = 1; $attempt -le $attemptLimit; $attempt++) {
    $scan = Invoke-AwsScanJson -Arguments @(
      "ecr", "describe-image-scan-findings", "--repository-name", $Boundary.RepositoryName,
      "--image-id", "imageDigest=$($Identity.PlatformDigest)", "--output", "json"
    ) -AllowNotFound:$WaitForScan
    $scanStatus = if ($null -eq $scan) { "" } else { [string]$scan.imageScanStatus.status }
    if ($scanStatus -ceq "COMPLETE" -or $scanStatus -in @("FAILED", "UNSUPPORTED_IMAGE")) { break }
    if ($WaitForScan) { Start-Sleep -Seconds 10 }
  }
  return Assert-RemoteOciImage -IndexDetail $details[0] -IndexImage $indexResponse.images[0] `
    -PlatformImage $platformResponse.images[0] -Scan $scan -ExpectedTag $Tag `
    -ExpectedIndexDigest $Identity.IndexDigest -ExpectedPlatformDigest $Identity.PlatformDigest `
    -ExpectedConfigDigest $Identity.ConfigDigest `
    -ExpectedCompressedLayerSetSha256 $Identity.CompressedLayerSetSha256
}

function Read-AndValidateReceipt {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Sha256,
    [Parameter(Mandatory)][object]$Boundary
  )
  if ((Get-FileSha256 -Path $Path) -cne $Sha256) { throw "The publication receipt checksum does not match the reviewed value." }
  $receipt = ConvertFrom-PublicationReceiptJson -Json (Get-Content -LiteralPath $Path -Raw)
  $sourceEpoch = (& git -C $repositoryRoot show -s --format=%ct $SourceSha 2>$null).Trim()
  if ($sourceEpoch -notmatch '^[0-9]{10,}$') { throw "The exact source commit timestamp could not be resolved." }
  $expectedCreated = [DateTimeOffset]::FromUnixTimeSeconds([long]$sourceEpoch).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
  $null = Assert-PublicationReceipt -Receipt $receipt -Boundary $Boundary `
    -ExpectedRegion $Region -ExpectedSourceSha $SourceSha -ExpectedCreated $expectedCreated
  return $receipt
}

$requiresCloud = $Action -ne "LocalBuild"
$headSha = Assert-CallerToolsAndSource -RequireExplicitSource:($Action -ne "Status") `
  -RequireDocker:($Action -in @("LocalBuild", "Publish")) `
  -RequireAws:$requiresCloud -RequireTerraform:$requiresCloud
if ($Action -eq "LocalBuild") {
  $localBuild = Invoke-LocalMigrationImageBuild -ExpectedSourceSha $SourceSha `
    -ExpectedOperatorRoot $operatorRoot -ExpectedRepositoryRoot $repositoryRoot
  [pscustomobject]@{
    Outcome                 = "local-build-and-runtime-verified"
    SourceSha               = $SourceSha
    IndexDigest             = $localBuild.Identity.IndexDigest
    PlatformDigest          = $localBuild.Identity.PlatformDigest
    ConfigDigest            = $localBuild.Identity.ConfigDigest
    Platform                = "linux/amd64"
    DeterministicBuildCount = 2
    RuntimeSmokePassed      = $true
    VulnerabilityScanRun    = $false
    EvidenceDirectory       = $localBuild.EvidenceDirectory
    AwsContacted            = $false
    TerraformChanged        = $false
    MigrationExecuted       = $false
  }
  exit 0
}
Initialize-Backend
$boundary = Resolve-RepositoryBoundary

if ($Action -eq "Status") {
  [pscustomobject]@{
    Environment              = "development"
    Region                   = $Region
    SourceSha                = $headSha
    TerraformOwnedRepository = $true
    ImmutableTags            = $true
    ScanOnPush               = $true
    CustomerKmsEncrypted     = $true
    ImagesPublished          = 0
    TerraformChanged         = $false
    MigrationExecuted        = $false
  }
  exit 0
}

if ($Action -eq "Publish") {
  $localBuild = Invoke-LocalMigrationImageBuild -ExpectedSourceSha $SourceSha `
    -ExpectedOperatorRoot $operatorRoot -ExpectedRepositoryRoot $repositoryRoot
  $timestamp = $localBuild.Timestamp
  $created = $localBuild.Created
  $layoutTwo = $localBuild.LayoutPath
  $identityTwo = $localBuild.Identity

  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0, 12)).json"
  }
  $receipt = Resolve-OperatorPath -Candidate $ReceiptPath
  $plannedReceipt = [ordered]@{
    schemaVersion     = 2
    kind              = "development-migration-image-publication"
    environment       = "development"
    region            = $Region
    sourceSha         = $SourceSha
    boundarySha256    = $boundary.BoundarySha256
    repositoryName    = $boundary.RepositoryName
    repositoryUri     = $boundary.RepositoryUri
    sourceTag         = $SourceSha
    handoffTag        = "$SourceSha-linux-amd64"
    platform          = "linux/amd64"
    created           = $created
    indexDigest       = $identityTwo.IndexDigest
    platformDigest    = $identityTwo.PlatformDigest
    configDigest      = $identityTwo.ConfigDigest
    compressedLayerSetSha256 = $identityTwo.CompressedLayerSetSha256
    rootfsDiffIdSetSha256 = $identityTwo.RootfsDiffIdSetSha256
    phase             = "publishing"
    imageUri          = ""
    scanStatus        = ""
    criticalFindings  = -1
    highFindings      = -1
    publicationStartedAt = [DateTimeOffset]::UtcNow.ToString("o")
    publicationCompletedAt = ""
  }

  $receiptExisted = Test-Path -LiteralPath $receipt -PathType Leaf
  $sourceState = Get-EcrTagState -Boundary $boundary -Tag $SourceSha
  $handoffState = Get-EcrTagState -Boundary $boundary -Tag $plannedReceipt.handoffTag
  $retained = $null
  if ($receiptExisted) {
    try { $retained = ConvertFrom-PublicationReceiptJson -Json (Get-Content -LiteralPath $receipt -Raw) }
    catch { throw "The retained publication receipt is not valid JSON." }
  }
  $resumeMode = Resolve-PublicationResumeMode -RemoteIndexExists $sourceState.Exists `
    -RemotePlatformExists $handoffState.Exists `
    -ReceiptExists $receiptExisted -Receipt $retained -Expected $plannedReceipt
  if ($resumeMode -ceq "new-publication") {
    Write-JsonFile -Path $receipt -Value $plannedReceipt
  } else {
    $plannedReceipt = $retained
  }

  if ($resumeMode -in @("new-publication", "resume-push", "resume-index")) {
    $registryHost = $boundary.RepositoryUri.Split('/')[0]
    $buildxPluginPath = Get-DockerBuildxPluginPath
    $dockerAuthDirectory = Join-Path $operatorRoot ("docker-auth-{0}" -f [guid]::NewGuid().ToString("N"))
    $dockerAuthPluginDirectory = Join-Path $dockerAuthDirectory "cli-plugins"
    $previousDockerConfig = $env:DOCKER_CONFIG
    $null = New-Item -ItemType Directory -Path $dockerAuthPluginDirectory
    Copy-Item -LiteralPath $buildxPluginPath -Destination `
      (Join-Path $dockerAuthPluginDirectory ([IO.Path]::GetFileName($buildxPluginPath)))
    try {
      $env:DOCKER_CONFIG = $dockerAuthDirectory
      $password = & aws ecr get-login-password --region $Region 2>$null
      if ($LASTEXITCODE -ne 0 -or -not $password) { throw "ECR login-token retrieval failed." }
      $password | docker login --username AWS --password-stdin $registryHost *> $null
      if ($LASTEXITCODE -ne 0) { throw "Docker could not authenticate to the exact development registry." }
      $ociReference = "oci-layout://$([IO.Path]::GetFullPath($layoutTwo).Replace('\', '/'))@$($identityTwo.PlatformDigest)"
      if ($resumeMode -in @("new-publication", "resume-push")) {
        docker buildx imagetools create --prefer-index=false --tag `
          "$($boundary.RepositoryUri):$($plannedReceipt.handoffTag)" $ociReference `
          *> (Join-Path $operatorRoot "push-platform-$timestamp.log")
        if ($LASTEXITCODE -ne 0) { throw "The immutable linux/amd64 handoff push failed; inspect the ignored local log." }
      }
      $handoffReadback = Get-EcrTagState -Boundary $boundary -Tag $plannedReceipt.handoffTag
      if (-not $handoffReadback.Exists) { throw "The immutable linux/amd64 handoff tag is unavailable." }
      $null = Assert-PlatformHandoff -BatchImage $handoffReadback.Image -Identity $identityTwo
      $indexPublication = Invoke-AwsJson -Arguments @(
        "ecr", "put-image", "--repository-name", $boundary.RepositoryName,
        "--image-tag", $SourceSha, "--image-manifest", "file://$($identityTwo.IndexPath)",
        "--image-manifest-media-type", "application/vnd.oci.image.index.v1+json", "--output", "json"
      ) -Operation "Immutable OCI source index publication"
      if ([string]$indexPublication.image.imageId.imageDigest -cne $identityTwo.IndexDigest) {
        throw "ECR did not install the exact byte-bound OCI source index."
      }
    } finally {
      if ($null -eq $previousDockerConfig) { Remove-Item Env:\DOCKER_CONFIG -ErrorAction SilentlyContinue }
      else { $env:DOCKER_CONFIG = $previousDockerConfig }
      if (Test-Path -LiteralPath $dockerAuthDirectory -PathType Container) {
        Remove-Item -LiteralPath $dockerAuthDirectory -Recurse -Force
      }
    }
  }

  $finalHandoff = Get-EcrTagState -Boundary $boundary -Tag $plannedReceipt.handoffTag
  if (-not $finalHandoff.Exists) { throw "The immutable linux/amd64 handoff tag is unavailable." }
  $null = Assert-PlatformHandoff -BatchImage $finalHandoff.Image -Identity $identityTwo
  $readback = Get-RemoteImageReadback -Boundary $boundary -Tag $SourceSha -Identity $identityTwo -WaitForScan
  $plannedReceipt.phase = "verified"
  $plannedReceipt.imageUri = "$($boundary.RepositoryUri)@$($readback.PlatformDigest)"
  $plannedReceipt.scanStatus = "COMPLETE"
  $plannedReceipt.criticalFindings = $readback.Critical
  $plannedReceipt.highFindings = $readback.High
  $plannedReceipt.publicationCompletedAt = [DateTimeOffset]::UtcNow.ToString("o")
  Write-JsonFile -Path $receipt -Value $plannedReceipt -AllowReplace
  [pscustomobject]@{
    Outcome                 = "published-and-verified"
    SourceSha               = $SourceSha
    ImageUri                = $plannedReceipt.imageUri
    IndexDigest             = $readback.IndexDigest
    PlatformDigest          = $readback.PlatformDigest
    ReceiptPath             = $receipt
    ReceiptSha256           = Get-FileSha256 -Path $receipt
    Platform                = "linux/amd64"
    ScanStatus              = "COMPLETE"
    CriticalFindings        = 0
    HighFindings            = 0
    DeterministicBuildCount = 2
    TerraformChanged        = $false
    MigrationExecuted       = $false
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ReceiptPath) -or $ReviewedReceiptSha256 -notmatch '^[a-f0-9]{64}$') {
  throw "Verify requires the exact publication receipt and its reviewed SHA-256."
}
$receipt = Resolve-OperatorPath -Candidate $ReceiptPath -MustExist
$receiptValue = Read-AndValidateReceipt -Path $receipt -Sha256 $ReviewedReceiptSha256 -Boundary $boundary
$receiptIdentity = [pscustomobject]@{
  IndexDigest              = [string]$receiptValue.indexDigest
  PlatformDigest           = [string]$receiptValue.platformDigest
  ConfigDigest             = [string]$receiptValue.configDigest
  CompressedLayerSetSha256 = [string]$receiptValue.compressedLayerSetSha256
}
$verifiedHandoff = Get-EcrTagState -Boundary $boundary -Tag ([string]$receiptValue.handoffTag)
if (-not $verifiedHandoff.Exists) { throw "The reviewed linux/amd64 handoff tag is unavailable." }
$null = Assert-PlatformHandoff -BatchImage $verifiedHandoff.Image -Identity $receiptIdentity
$readback = Get-RemoteImageReadback -Boundary $boundary -Tag $SourceSha -Identity $receiptIdentity
[pscustomobject]@{
  Outcome              = "verified"
  SourceSha            = $SourceSha
  ImageUri             = $receiptValue.imageUri
  IndexDigest          = $readback.IndexDigest
  PlatformDigest       = $readback.PlatformDigest
  ReceiptSha256        = $ReviewedReceiptSha256
  Platform             = "linux/amd64"
  ScanStatus           = "COMPLETE"
  CriticalFindings     = 0
  HighFindings         = 0
  ImmutableReadback    = $true
  TerraformChanged     = $false
  MigrationExecuted    = $false
}
