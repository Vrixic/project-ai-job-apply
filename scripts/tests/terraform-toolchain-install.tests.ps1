Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Message)
  if ([string]$Actual -cne [string]$Expected) { throw $Message }
  $script:passed++
}
function Assert-Throws {
  param([scriptblock]$Operation, [string]$Message)
  $failed = $false
  try { $null = & $Operation } catch { $failed = $true }
  if (-not $failed) { throw $Message }
  $script:passed++
}
function Read-TestSourceAst {
  param([string]$Path)
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  Assert-Equal @($errors).Count 0 "A toolchain source file does not parse."
  return $ast
}

$installerAst = Read-TestSourceAst (Join-Path $PSScriptRoot "../install-terraform-toolchain.ps1")
$selectorAst = Read-TestSourceAst (Join-Path $PSScriptRoot "../use-deployment-terraform.ps1")
# Load only validator definitions, never the installer's download/native execution body.
foreach ($definition in $installerAst.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true)) { . ([scriptblock]::Create($definition.Extent.Text)) }
. (Join-Path $PSScriptRoot "../lib/terraform-toolchain.ps1")
foreach ($definition in $selectorAst.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true)) { . ([scriptblock]::Create($definition.Extent.Text)) }

$fingerprint = "C874011F0AB405110D02105534365D9472D7468F"
$subkey = "A" * 40
$keyRecords = @("pub:-:4096:1:synthetic:", ("fpr:::::::::" + $fingerprint + ":"),
  "sub:e:4096:1:synthetic:", ("fpr:::::::::" + $subkey + ":"))
Assert-Equal @(Assert-TerraformSigningKey -Records $keyRecords -Fingerprint $fingerprint).Count 0 "The pinned primary key was rejected."
foreach ($records in @(@(), @("sub:x:", ("fpr:::::::::" + $fingerprint + ":")), @("pub:x:"),
    @("pub:x:", "fpr:short"), @("pub:x:", "sub:x:", ("fpr:::::::::" + $fingerprint + ":")),
    @("pub:x:", ("fpr:::::::::" + $subkey + ":")),
    @($keyRecords + @("pub:x:", ("fpr:::::::::" + $fingerprint + ":"))))) {
  Assert-Throws { Assert-TerraformSigningKey -Records $records -Fingerprint $fingerprint } "An invalid imported primary-key set was accepted."
}
Assert-Throws { Assert-TerraformSigningKey -Records $keyRecords -Fingerprint $fingerprint.ToLowerInvariant() } "A noncanonical fingerprint was accepted."

$goodStatus = @("[GNUPG:] GOODSIG AAAAAAAAAAAAAAAA Synthetic signer",
  "[GNUPG:] VALIDSIG $subkey 2026-09-09 1788912000 0 4 0 1 10 00 $fingerprint")
Assert-Equal @(Assert-TerraformReleaseSignature -Status $goodStatus -ExitCode 0 -Fingerprint $fingerprint).Count 0 "A valid signing subkey was rejected."
Assert-Equal @(Assert-TerraformReleaseSignature -Status (@("[GNUPG:] KEYEXPIRED 1700000000") + $goodStatus) `
  -ExitCode 0 -Fingerprint $fingerprint).Count 0 "An unused expired historical subkey incorrectly rejected the valid actual signer."
$primaryStatus = @("[GNUPG:] GOODSIG 34365D9472D7468F Synthetic signer",
  "[GNUPG:] VALIDSIG $fingerprint 2026-09-09 1788912000 0 4 0 1 10 00")
Assert-Equal @(Assert-TerraformReleaseSignature -Status $primaryStatus -ExitCode 0 -Fingerprint $fingerprint).Count 0 "A valid pinned primary signer was rejected."
foreach ($status in @("BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "KEYREVOKED", "SIGEXPIRED")) {
  Assert-Throws { Assert-TerraformReleaseSignature -Status ($goodStatus + "[GNUPG:] $status synthetic") -ExitCode 0 -Fingerprint $fingerprint } `
    "An invalid actual release signature was accepted."
}
Assert-Throws { Assert-TerraformReleaseSignature -Status $goodStatus -ExitCode 1 -Fingerprint $fingerprint } "A failing GPG result was accepted."
foreach ($status in @(@(), @($goodStatus[0]), @($goodStatus[1]), @($goodStatus + $goodStatus),
    @("[GNUPG:] GOODSIG BBBBBBBBBBBBBBBB Synthetic signer", $goodStatus[1]),
    @($goodStatus[0], "[GNUPG:] VALIDSIG malformed $fingerprint"),
    @($goodStatus[0], $goodStatus[1].Replace($fingerprint, ("B" * 40))),
    @($goodStatus[0], $goodStatus[1].Replace($subkey, $subkey.ToLowerInvariant())))) {
  Assert-Throws { Assert-TerraformReleaseSignature -Status $status -ExitCode 0 -Fingerprint $fingerprint } `
    "Malformed, mismatched, or duplicated signature records were accepted."
}

$archiveName = "terraform_1.16.2_windows_amd64.zip"
$archiveSha = "6ef140ce1d399dc43b8315194176ddc2dfb5c21d607968e82ef20a55cfff40d0"
$checksumLine = "$archiveSha  $archiveName"
Assert-Equal @(Assert-TerraformReleaseChecksum -Records @($checksumLine) -ArchiveName $archiveName -Sha256 $archiveSha).Count 0 `
  "The exact signed and independently pinned archive checksum was rejected."
foreach ($records in @(@(), @($checksumLine, $checksumLine), @($checksumLine.Replace($archiveSha, ("b" * 64))),
    @($checksumLine.Replace("  ", " ")), @($checksumLine.Replace("  ", " *")),
    @($checksumLine.Replace($archiveName, "terraform_1.16.2_linux_amd64.zip")),
    @($checksumLine, $checksumLine.Replace("  ", " *")))) {
  Assert-Throws { Assert-TerraformReleaseChecksum -Records $records -ArchiveName $archiveName -Sha256 $archiveSha } `
    "A missing, malformed, duplicated, or different archive checksum was accepted."
}
Assert-Throws { Assert-TerraformReleaseChecksum -Records @($checksumLine) -ArchiveName "../terraform.exe" -Sha256 $archiveSha } `
  "An unbounded archive filename was accepted."

function New-TestEntries {
  return @([pscustomobject]@{ FullName = "terraform.exe"; Length = 100; ExternalAttributes = 0 },
    [pscustomobject]@{ FullName = "LICENSE.txt"; Length = 50; ExternalAttributes = 0 })
}
Assert-Equal @(Assert-TerraformArchiveEntries -Entries (New-TestEntries)).Count 0 "The exact two regular archive files were rejected."
foreach ($name in @("../terraform.exe", "nested/terraform.exe", "/terraform.exe", "C:/terraform.exe",
    "terraform.exe:stream", "terraform.EXE", "terraform.exe\", "LICENSE.txt")) {
  $entries = New-TestEntries
  $entries[0].FullName = $name
  Assert-Throws { Assert-TerraformArchiveEntries -Entries $entries } "An unsafe or duplicate archive entry was accepted."
}
foreach ($length in @(0, -1, (256MB + 1))) {
  $entries = New-TestEntries
  $entries[0].Length = $length
  Assert-Throws { Assert-TerraformArchiveEntries -Entries $entries } "An empty or oversized archive entry was accepted."
}
foreach ($attributes in @(0x10, 0x400, (0xa000 -shl 16), (0x4000 -shl 16))) {
  $entries = New-TestEntries
  $entries[0].ExternalAttributes = $attributes
  Assert-Throws { Assert-TerraformArchiveEntries -Entries $entries } "A directory, link, or reparse archive entry was accepted."
}
$entries = New-TestEntries
$entries[0].ExternalAttributes = 0x8000 -shl 16
Assert-Equal @(Assert-TerraformArchiveEntries -Entries $entries).Count 0 "A regular Unix-attributed archive file was rejected."
Assert-Throws { Assert-TerraformArchiveEntries -Entries @((New-TestEntries)[0]) } "An incomplete archive was accepted."
Assert-Throws { Assert-TerraformArchiveEntries -Entries @((New-TestEntries) + (New-TestEntries)[0]) } "An extra archive entry was accepted."

$ownedName = "ai-job-apply-toolchain-install-tests-" + [guid]::NewGuid().ToString("N")
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$ownedRoot = [IO.Path]::GetFullPath((Join-Path $temporaryRoot $ownedName))
$previousPath = $env:PATH
$junction = ""
try {
  $null = New-Item -ItemType Directory -Path $ownedRoot
  $toolchainRoot = Join-Path $ownedRoot "toolchains"
  $destination = Join-Path $toolchainRoot "1.16.2"
  $outside = Join-Path $ownedRoot "outside"
  foreach ($directory in @($toolchainRoot, $outside)) { $null = New-Item -ItemType Directory -Path $directory }
  $sourceExecutable = Join-Path $ownedRoot "generated-source"
  $sourceLicense = Join-Path $ownedRoot "generated-license"
  [IO.File]::WriteAllText($sourceExecutable, "Synthetic file; never an executable.")
  [IO.File]::WriteAllText($sourceLicense, "Synthetic license.")
  $exeSha = (Get-FileHash -LiteralPath $sourceExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
  $licenseSha = (Get-FileHash -LiteralPath $sourceLicense -Algorithm SHA256).Hash.ToLowerInvariant()
  $destinationArgs = @{ ToolchainRoot = $toolchainRoot; Version = "1.16.2"; ExecutableSha256 = $exeSha; LicenseSha256 = $licenseSha }
  Assert-Equal (Test-TerraformToolchainDestination @destinationArgs) $false "A missing destination was not reported as missing."
  foreach ($path in @($toolchainRoot, $outside, (Join-Path $toolchainRoot "../outside"), ($toolchainRoot + "-other/file"))) {
    Assert-Throws { Assert-TerraformToolchainLocalPath -ScopeRoot $toolchainRoot -Path $path } "A path outside the exact installation scope was accepted."
  }
  $null = New-Item -ItemType Directory -Path $destination
  Assert-Throws { Test-TerraformToolchainDestination @destinationArgs } "An existing incomplete destination was accepted."
  $installedExe = Join-Path $destination "terraform.exe"
  $installedLicense = Join-Path $destination "LICENSE.txt"
  [IO.File]::Copy($sourceExecutable, $installedExe, $false)
  [IO.File]::Copy($sourceLicense, $installedLicense, $false)
  Assert-Equal (Test-TerraformToolchainDestination @destinationArgs) $true "An exactly identical installation was rejected."
  Assert-Throws { [IO.File]::Copy($sourceExecutable, $installedExe, $false) } "The exclusive copy overwrote an existing executable."
  Assert-Equal ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash.ToLowerInvariant()) $exeSha "A rejected copy changed the installation."
  [IO.File]::WriteAllText($installedExe, "Different generated executable.")
  Assert-Throws { Test-TerraformToolchainDestination @destinationArgs } "A different executable was accepted for overwrite."
  [IO.File]::WriteAllText($installedExe, [IO.File]::ReadAllText($sourceExecutable))
  [IO.File]::WriteAllText($installedLicense, "Different generated license.")
  Assert-Throws { Test-TerraformToolchainDestination @destinationArgs } "A different license was accepted for overwrite."
  [IO.File]::WriteAllText($installedLicense, [IO.File]::ReadAllText($sourceLicense))
  [IO.File]::WriteAllText((Join-Path $destination "unexpected.txt"), "Generated unrelated file.")
  Assert-Throws { Test-TerraformToolchainDestination @destinationArgs } "A destination with unrelated content was accepted."
  $invalidDestinationArgs = $destinationArgs.Clone()
  $invalidDestinationArgs.Version = "../outside"
  Assert-Throws { Test-TerraformToolchainDestination @invalidDestinationArgs } "A nonapproved version destination was accepted."
  if ($env:OS -ceq "Windows_NT") {
    $junction = Join-Path $toolchainRoot "linked"
    $null = New-Item -ItemType Junction -Path $junction -Target $outside
    Assert-Throws { Assert-TerraformToolchainLocalPath -ScopeRoot $toolchainRoot -Path (Join-Path $junction "future-file") } `
      "A reparse ancestor redirected installation outside its scope."
    [IO.Directory]::Delete($junction)
    $junction = ""
  }

  # Exercise actual selector control flow against generated files with only the native CLI
  # boundary mocked. No fixture is ever executed, and PATH remains process-local.
  $cliCalls = 0
  $cliShouldFail = $false
  $resolvedExecutable = $installedExe
  function Get-DeploymentTerraformExecutable { return $resolvedExecutable }
  function Assert-DeploymentTerraformCli {
    $script:cliCalls++
    if ($cliShouldFail) { throw "Generated version rejection." }
  }
  Set-DeploymentTerraformSessionPath -Directory $destination -ExecutableSha256 $exeSha
  Assert-Equal $env:PATH ($destination + [IO.Path]::PathSeparator + $previousPath) "The selector did not prepend only the process PATH."
  Assert-Equal $cliCalls 1 "The selector omitted CLI version validation."
  $env:PATH = $previousPath
  $cliShouldFail = $true
  Assert-Throws { Set-DeploymentTerraformSessionPath -Directory $destination -ExecutableSha256 $exeSha } "A failed CLI validation selected the toolchain."
  Assert-Equal $env:PATH $previousPath "A failed selection did not restore PATH."
  $cliShouldFail = $false
  $resolvedExecutable = $sourceExecutable
  $beforeCalls = $cliCalls
  Assert-Throws { Set-DeploymentTerraformSessionPath -Directory $destination -ExecutableSha256 $exeSha } "A shadowing executable was selected."
  Assert-Equal $cliCalls $beforeCalls "A shadowing executable reached native version execution."
  Assert-Equal $env:PATH $previousPath "A shadowed selection changed PATH."
  $resolvedExecutable = $installedExe
  Assert-Throws { Set-DeploymentTerraformSessionPath -Directory $destination -ExecutableSha256 ("a" * 64) } "An unverified executable reached selection."
  Assert-Equal $cliCalls $beforeCalls "An executable with the wrong hash was executed."
  Assert-Throws { Set-DeploymentTerraformSessionPath -Directory $outside -ExecutableSha256 $exeSha } "A missing executable was selected."
  Assert-Equal $env:PATH $previousPath "A missing or checksum-rejected installation changed PATH."

  # Maintain checksum-before-execution and exclusive installation ordering in the real body,
  # independently of pure validator tests. The installer has no ValidateOnly/bypass parameter.
  Assert-Equal (($installerAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) -join ",") "GpgExecutable" `
    "The installer gained an unreviewed verification-bypass input."
  $source = $installerAst.Extent.Text
  $orderedFragments = @('Assert-TerraformSigningKey -Records $keyRecords',
    'Assert-TerraformReleaseSignature -Status $signatureStatus',
    'Assert-TerraformReleaseChecksum -Records',
    'Invoke-WebRequest -Uri "$releaseBase/$archiveName"',
    '(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256)',
    '[IO.Compression.ZipFile]::OpenRead($archivePath)',
    'Assert-TerraformArchiveEntries -Entries @($zip.Entries)',
    '[IO.Compression.ZipFileExtensions]::ExtractToFile',
    '$versionOutput = @(& $executable version -json',
    'Test-TerraformToolchainDestination -ToolchainRoot $toolchainRoot',
    '[IO.File]::Copy($executable, (Join-Path $destination "terraform.exe"), $false)')
  $lastOffset = -1
  foreach ($fragment in $orderedFragments) {
    $offset = $source.IndexOf($fragment, [StringComparison]::Ordinal)
    Assert-Equal ($offset -gt $lastOffset) $true "Verification, extraction, execution, or exclusive-copy ordering changed."
    $lastOffset = $offset
  }
  foreach ($fragment in @('"--no-options"', '"--no-autostart"', '"--homedir"', '"--no-auto-key-retrieve"',
      '".tmp/tf-gpg-"', '"https://www.hashicorp.com/.well-known/pgp-key.txt"',
      '"https://releases.hashicorp.com/terraform/$version"', $fingerprint, $archiveSha,
      '2667de56106bc6707968286357e29c20f8dbbb2f429ef57099b04994f82d9684')) {
    Assert-Equal $source.Contains($fragment) $true "A fixed release trust/keyring boundary changed."
  }
  Assert-Equal $selectorAst.Extent.Text.Contains('d51f533398d3bb2df73ffd85fd5c1af3e8db15433018fe818ce816248290fe96') $true `
    "The selector no longer pins the independently verified executable bytes before execution."
  Assert-Equal $selectorAst.Extent.Text.Contains('[Environment]::SetEnvironmentVariable') $false "The selector gained persistent environment mutation."
} finally {
  $env:PATH = $previousPath
  if (-not [string]::IsNullOrEmpty($junction) -and (Test-Path -LiteralPath $junction)) {
    [IO.Directory]::Delete($junction)
  }
  if (Test-Path -LiteralPath $ownedRoot) {
    $resolved = [IO.Path]::GetFullPath((Get-Item -LiteralPath $ownedRoot).FullName)
    if ([IO.Path]::GetDirectoryName($resolved) -cne $temporaryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        [IO.Path]::GetFileName($resolved) -cne $ownedName -or $ownedName -cnotmatch '^ai-job-apply-toolchain-install-tests-[0-9a-f]{32}$') {
      throw "Refusing cleanup outside the exact generated installer fixture directory."
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
Write-Host "Terraform toolchain installer tests passed: $passed assertions; offline validators and generated files only."
