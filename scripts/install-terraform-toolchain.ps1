#Requires -Version 7.0
[CmdletBinding()]
param([string]$GpgExecutable = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# These validators are pure or local read-only checks. Tests extract their definitions without
# running the installer, downloading releases, or introducing a verification bypass switch.
function Assert-TerraformSigningKey {
  param([string[]]$Records, [string]$Fingerprint)
  $primaryFingerprints = @()
  $awaitingPrimary = $false
  foreach ($record in $Records) {
    if ($record.StartsWith("pub:")) {
      if ($awaitingPrimary) { throw "TerraformSigningKeyFingerprintMismatch" }
      $awaitingPrimary = $true
    } elseif ($record.StartsWith("sub:")) {
      if ($awaitingPrimary) { throw "TerraformSigningKeyFingerprintMismatch" }
    } elseif ($awaitingPrimary -and $record.StartsWith("fpr:")) {
      $parts = $record.Split(":")
      if ($parts.Count -lt 10) { throw "TerraformSigningKeyFingerprintMismatch" }
      $primaryFingerprints += $parts[9]
      $awaitingPrimary = $false
    }
  }
  if ($Fingerprint -cnotmatch '^[A-F0-9]{40}$' -or $awaitingPrimary -or
      $primaryFingerprints.Count -ne 1 -or $primaryFingerprints[0] -cne $Fingerprint) {
    throw "TerraformSigningKeyFingerprintMismatch"
  }
}

function Assert-TerraformReleaseSignature {
  param([string[]]$Status, [int]$ExitCode, [string]$Fingerprint)
  $valid = @($Status | Where-Object { $_ -cmatch '^\[GNUPG:\] VALIDSIG ' })
  $good = @($Status | Where-Object { $_ -cmatch '^\[GNUPG:\] GOODSIG ' })
  # An unused historical subkey can emit KEYEXPIRED. Only actual expired/revoked signatures
  # are rejected here; GPG must still report exactly one matching GOODSIG and VALIDSIG.
  if ($ExitCode -ne 0 -or $valid.Count -ne 1 -or $good.Count -ne 1 -or
      @($Status | Where-Object { $_ -cmatch '^\[GNUPG:\] (BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG|KEYREVOKED|SIGEXPIRED)\b' }).Count -ne 0) {
    throw "TerraformReleaseSignatureRejected"
  }
  $parts = $valid[0] -split ' '
  $goodParts = $good[0] -split ' ', 4
  if ($Fingerprint -cnotmatch '^[A-F0-9]{40}$' -or $parts.Count -notin @(11, 12) -or
      $parts[2] -cnotmatch '^[A-F0-9]{40}$' -or $goodParts.Count -lt 3 -or
      $goodParts[2] -cnotmatch '^(?:[A-F0-9]{16}|[A-F0-9]{40})$' -or
      -not $parts[2].EndsWith($goodParts[2], [StringComparison]::Ordinal) -or
      ($parts[2] -cne $Fingerprint -and ($parts.Count -ne 12 -or $parts[11] -cne $Fingerprint))) {
    throw "TerraformReleaseSignerMismatch"
  }
}

function Assert-TerraformReleaseChecksum {
  param([string[]]$Records, [string]$ArchiveName, [string]$Sha256)
  if ($ArchiveName -cnotmatch '^terraform_(?:1\.16\.2|1\.9\.8)_windows_amd64\.zip$' -or
      $Sha256 -cnotmatch '^[a-f0-9]{64}$') { throw "TerraformReleaseChecksumPinMismatch" }
  $matches = @($Records | Where-Object { $_ -cmatch ('(?:^|\s)\*?' + [regex]::Escape($ArchiveName) + '$') })
  if ($matches.Count -ne 1 -or $matches[0] -cne ($Sha256 + "  " + $ArchiveName)) {
    throw "TerraformReleaseChecksumPinMismatch"
  }
}

function Assert-TerraformArchiveEntries {
  param([object[]]$Entries)
  if ($Entries.Count -ne 2 -or
      @($Entries | Where-Object { $_.FullName -ceq "terraform.exe" }).Count -ne 1 -or
      @($Entries | Where-Object { $_.FullName -ceq "LICENSE.txt" }).Count -ne 1) {
    throw "TerraformArchiveEntriesRejected"
  }
  foreach ($entry in $Entries) {
    $unixType = ($entry.ExternalAttributes -shr 16) -band 0xf000
    if ($entry.Length -le 0 -or $entry.Length -gt 256MB -or $unixType -notin @(0, 0x8000) -or
        ($entry.ExternalAttributes -band 0x410) -ne 0) { throw "TerraformArchiveEntriesRejected" }
  }
}

function Assert-TerraformToolchainLocalPath {
  param([string]$ScopeRoot, [string]$Path)
  $scope = [IO.Path]::GetFullPath($ScopeRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($scope + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "TerraformToolchainPathOutsideScope"
  }
  $cursor = $full
  while (-not [string]::IsNullOrEmpty($cursor)) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "TerraformToolchainReparsePathRejected" }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
}

function Test-TerraformToolchainDestination {
  param([string]$ToolchainRoot, [string]$Version, [string]$ExecutableSha256, [string]$LicenseSha256)
  if ($Version -cnotin @("1.16.2", "1.9.8") -or $ExecutableSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $LicenseSha256 -cnotmatch '^[a-f0-9]{64}$') { throw "TerraformToolchainDestinationRejected" }
  $destination = Join-Path $ToolchainRoot $Version
  Assert-TerraformToolchainLocalPath -ScopeRoot $ToolchainRoot -Path $destination
  if (-not (Test-Path -LiteralPath $destination)) { return $false }
  if (-not (Test-Path -LiteralPath $destination -PathType Container) -or
      @(Get-ChildItem -LiteralPath $destination -Force).Count -ne 2) { throw "TerraformToolchainDestinationAlreadyExistsWithDifferentContent" }
  foreach ($file in @(@{ Name = "terraform.exe"; Sha256 = $ExecutableSha256 }, @{ Name = "LICENSE.txt"; Sha256 = $LicenseSha256 })) {
    $path = Join-Path $destination $file.Name
    Assert-TerraformToolchainLocalPath -ScopeRoot $ToolchainRoot -Path $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.Sha256) {
      throw "TerraformToolchainDestinationAlreadyExistsWithDifferentContent"
    }
  }
  return $true
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$toolchainRoot = Join-Path $repositoryRoot ".tmp/toolchains/terraform"
$signerFingerprint = "C874011F0AB405110D02105534365D9472D7468F"
$archives = @(
  @{ Version = "1.16.2"; Sha256 = "6ef140ce1d399dc43b8315194176ddc2dfb5c21d607968e82ef20a55cfff40d0" },
  @{ Version = "1.9.8"; Sha256 = "2667de56106bc6707968286357e29c20f8dbbb2f429ef57099b04994f82d9684" }
)
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") {
  throw "TerraformToolchainRequiresWindowsX64"
}
if ([string]::IsNullOrWhiteSpace($GpgExecutable)) {
  $gpgCommand = Get-Command gpg -CommandType Application -ErrorAction SilentlyContinue
  $GpgExecutable = if ($gpgCommand) { $gpgCommand.Source } else { "C:/Program Files/Git/usr/bin/gpg.exe" }
}
if (-not (Test-Path -LiteralPath $GpgExecutable -PathType Leaf)) { throw "TerraformToolchainRequiresGpg" }
$GpgExecutable = (Resolve-Path -LiteralPath $GpgExecutable).Path
# All downloads and the isolated public-key ring stay in a new ignored directory. Never alter
# the user's existing Terraform installation, personal GPG keyring, or machine/user PATH.
$downloadRoot = Join-Path $toolchainRoot ("download-" + [guid]::NewGuid().ToString("N"))
# Git for Windows GPG uses a short socket path even for public-key inspection. Keep this
# isolated path short and prohibit agent startup; importing/verifying needs no private key.
$gpgDirectory = Join-Path $repositoryRoot (".tmp/tf-gpg-" + [guid]::NewGuid().ToString("N").Substring(0, 16))
Assert-TerraformToolchainLocalPath -ScopeRoot $repositoryRoot -Path $gpgDirectory
Assert-TerraformToolchainLocalPath -ScopeRoot $repositoryRoot -Path $downloadRoot
$null = New-Item -ItemType Directory -Path $gpgDirectory
$null = New-Item -ItemType Directory -Path $downloadRoot
$publicKeyPath = Join-Path $downloadRoot "hashicorp-public-key.asc"
Invoke-WebRequest -Uri "https://www.hashicorp.com/.well-known/pgp-key.txt" -OutFile $publicKeyPath -TimeoutSec 60
if ((Get-Item -LiteralPath $publicKeyPath).Length -gt 1MB) { throw "TerraformSigningKeyTooLarge" }
$gpgArguments = @("--no-options", "--no-autostart", "--homedir", $gpgDirectory.Replace("\", "/"), "--batch", "--no-tty", "--no-auto-key-retrieve")
$null = & $GpgExecutable @gpgArguments --import ($publicKeyPath.Replace("\", "/")) 2>$null
if ($LASTEXITCODE -ne 0) { throw "TerraformSigningKeyImportFailed" }
$keyRecords = @(& $GpgExecutable @gpgArguments --with-colons --fingerprint --list-keys 2>$null)
if ($LASTEXITCODE -ne 0) { throw "TerraformSigningKeyInspectionFailed" }
Assert-TerraformSigningKey -Records $keyRecords -Fingerprint $signerFingerprint

$results = @()
foreach ($archive in $archives) {
  $version = $archive.Version
  $archiveName = "terraform_${version}_windows_amd64.zip"
  $releaseBase = "https://releases.hashicorp.com/terraform/$version"
  $checksumName = "terraform_${version}_SHA256SUMS"
  $checksumPath = Join-Path $downloadRoot $checksumName
  $signaturePath = "$checksumPath.sig"
  $archivePath = Join-Path $downloadRoot $archiveName
  Invoke-WebRequest -Uri "$releaseBase/$checksumName" -OutFile $checksumPath -TimeoutSec 60
  Invoke-WebRequest -Uri "$releaseBase/$checksumName.sig" -OutFile $signaturePath -TimeoutSec 60
  if ((Get-Item -LiteralPath $checksumPath).Length -gt 1MB -or (Get-Item -LiteralPath $signaturePath).Length -gt 64KB) {
    throw "TerraformSignatureInputTooLarge"
  }
  $signatureStatus = @(& $GpgExecutable @gpgArguments --status-fd 1 --verify ($signaturePath.Replace("\", "/")) ($checksumPath.Replace("\", "/")) 2>$null)
  $signatureExitCode = $LASTEXITCODE
  Assert-TerraformReleaseSignature -Status $signatureStatus -ExitCode $signatureExitCode -Fingerprint $signerFingerprint
  Assert-TerraformReleaseChecksum -Records @(Get-Content -LiteralPath $checksumPath) -ArchiveName $archiveName -Sha256 $archive.Sha256
  Invoke-WebRequest -Uri "$releaseBase/$archiveName" -OutFile $archivePath -TimeoutSec 60
  if ((Get-Item -LiteralPath $archivePath).Length -gt 128MB -or
      (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $archive.Sha256) {
    throw "TerraformArchiveChecksumMismatch"
  }
  $unpacked = Join-Path $downloadRoot $version
  $null = New-Item -ItemType Directory -Path $unpacked
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    Assert-TerraformArchiveEntries -Entries @($zip.Entries)
    foreach ($entry in $zip.Entries) {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $unpacked $entry.FullName), $false)
    }
  } finally { $zip.Dispose() }
  # No downloaded executable runs until signed checksums and the independent archive pin pass.
  $executable = Join-Path $unpacked "terraform.exe"
  Assert-TerraformToolchainLocalPath -ScopeRoot $downloadRoot -Path $executable
  $versionOutput = @(& $executable version -json 2>$null)
  if ($LASTEXITCODE -ne 0 -or (($versionOutput -join "`n") | ConvertFrom-Json).terraform_version -cne $version) {
    throw "TerraformArchiveVersionMismatch"
  }
  $destination = Join-Path $toolchainRoot $version
  $executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
  $licensePath = Join-Path $unpacked "LICENSE.txt"
  $licenseSha256 = (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not (Test-TerraformToolchainDestination -ToolchainRoot $toolchainRoot -Version $version -ExecutableSha256 $executableSha256 -LicenseSha256 $licenseSha256)) {
    $null = New-Item -ItemType Directory -Path $destination
    Assert-TerraformToolchainLocalPath -ScopeRoot $toolchainRoot -Path $destination
    [IO.File]::Copy($executable, (Join-Path $destination "terraform.exe"), $false)
    [IO.File]::Copy($licensePath, (Join-Path $destination "LICENSE.txt"), $false)
  }
  $results += [pscustomobject]@{
    Version = $version
    Purpose = $(if ($version -ceq "1.16.2") { "current-deployment" } else { "historical-plan-show-only" })
    SignatureVerified = $true
    ArchiveSha256 = $archive.Sha256
    ExecutableSha256 = $executableSha256
  }
}
$results
