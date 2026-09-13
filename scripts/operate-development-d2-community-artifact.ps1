[CmdletBinding()]
param(
  [ValidateSet("Status", "Publish", "Verify")][string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$ArtifactBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")][string]$SourceSha = "",
  [string]$ReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedReceiptSha256 = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$region = "us-east-2"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$privateRoot = [IO.Path]::GetFullPath((Join-Path $root "infrastructure\terraform\environments\development\.terraform\development-d2-community-artifacts"))
$artifact = Join-Path $root "backend\workflows\dist\lambda\d2-community-runtime-lambda.zip"

function Get-Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-Base64Sha([string]$Path) {
  $sha=[Security.Cryptography.SHA256]::Create();try{[Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))}finally{$sha.Dispose()}
}
function Set-D2ArtifactSourceEnvironment([AllowNull()][AllowEmptyString()][string]$Value, [bool]$Present) {
  if (-not $Present) {
    [Environment]::SetEnvironmentVariable('ARTIFACT_SOURCE_SHA', [NullString]::Value, 'Process')
  } elseif ($Value.Length -gt 0) {
    [Environment]::SetEnvironmentVariable('ARTIFACT_SOURCE_SHA', $Value, 'Process')
  } elseif ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    # .NET Framework/Windows PowerShell treats an empty value as deletion. Preserve an actual
    # present-empty process entry instead; never touch the user or machine environment.
    if (-not ('ApplyDash.D2ArtifactProcessEnvironment' -as [type])) {
      Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace ApplyDash {
  public static class D2ArtifactProcessEnvironment {
    [DllImport("kernel32.dll", EntryPoint="SetEnvironmentVariableW", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool Set(string name, string value);
  }
}
'@
    }
    if (-not [ApplyDash.D2ArtifactProcessEnvironment]::Set('ARTIFACT_SOURCE_SHA', '')) {
      throw 'The prior artifact source environment could not be restored.'
    }
  } else {
    [Environment]::SetEnvironmentVariable('ARTIFACT_SOURCE_SHA', '', 'Process')
  }
}
function Assert-D2ArtifactZipSource([string]$ArtifactPath, [string]$ReviewedSourceSha, [string]$ExpectedSha256, [string]$ExpectedBase64Sha256, [string]$ExpectedBundleSha256 = '', [long]$ExpectedBundleLength = -1) {
  if ($ReviewedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      -not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) { throw 'The D2 archive source binding is missing.' }
  $length = (Get-Item -LiteralPath $ArtifactPath).Length
  if ($length -lt 1 -or $length -gt 64MB) { throw 'The D2 archive size is invalid.' }
  if ((Get-Sha $ArtifactPath) -cne $ExpectedSha256 -or (Get-Base64Sha $ArtifactPath) -cne $ExpectedBase64Sha256) {
    throw 'The D2 archive checksum binding is invalid.'
  }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($ArtifactPath)
  try {
    if ($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -cne 'index.mjs' -or
        $zip.Entries[0].Length -lt 1 -or $zip.Entries[0].Length -gt 64MB -or
        ($ExpectedBundleLength -ge 0 -and $zip.Entries[0].Length -ne $ExpectedBundleLength)) { throw 'The D2 ZIP contents are invalid.' }
    $stream = $zip.Entries[0].Open()
    try {
      $expected = [Text.UTF8Encoding]::new($false).GetBytes("/* applydash-artifact-source:$ReviewedSourceSha */`n")
      foreach ($value in $expected) {
        if ($stream.ReadByte() -ne $value) { throw 'The D2 ZIP source marker is invalid.' }
      }
    } finally { $stream.Dispose() }
    $stream = $zip.Entries[0].Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $buffer = New-Object byte[] 65536
      $total = 0L
      while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $total += $count
        if ($total -gt 64MB -or $total -gt $zip.Entries[0].Length) { throw 'The D2 bundle exceeded its bounded length.' }
        $null = $sha.TransformBlock($buffer, 0, $count, $buffer, 0)
      }
      $null = $sha.TransformFinalBlock([byte[]]@(), 0, 0)
      $embeddedSha = [BitConverter]::ToString($sha.Hash).Replace('-', '').ToLowerInvariant()
      if ($total -ne $zip.Entries[0].Length -or ($ExpectedBundleSha256 -and $embeddedSha -cne $ExpectedBundleSha256)) {
        throw 'The D2 ZIP bundle binding is invalid.'
      }
    } finally { $sha.Dispose(); $stream.Dispose() }
  } finally { $zip.Dispose() }
}
function Get-VerifiedD2ArtifactBuild([string]$ArtifactPath, [string]$ReviewedSourceSha) {
  if ($ReviewedSourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'An exact artifact build source is required.' }
  $directory = Split-Path $ArtifactPath -Parent
  $name = 'd2-community-runtime-lambda'
  if ((Split-Path $ArtifactPath -Leaf) -cne "$name.zip") { throw 'Unexpected D2 artifact filename.' }
  $files = @{}
  foreach ($suffix in @('zip', 'mjs', 'manifest.json', 'cdx.json', 'sha256')) {
    $path = Join-Path $directory "$name.$suffix"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'A D2 artifact companion is missing.' }
    $length = (Get-Item -LiteralPath $path).Length
    if ($length -lt 1 -or $length -gt 64MB) { throw 'A D2 artifact companion has an invalid size.' }
    $files[$suffix] = [pscustomobject]@{ Path=$path; Sha256=(Get-Sha $path); Length=$length }
  }
  if ($files['manifest.json'].Length -gt 32768) { throw 'The D2 artifact manifest is oversized.' }
  $manifest = Get-Content -LiteralPath $files['manifest.json'].Path -Raw | ConvertFrom-Json
  $expectedKeys = @('schemaVersion','sourceSha','runtime','architecture','handlers','artifact','artifactBytes','artifactSha256','artifactBase64Sha256','bundleSha256','sbom','sbomSha256','componentCount')
  foreach ($key in @('sourceSha','runtime','architecture','artifact','artifactSha256','artifactBase64Sha256','bundleSha256','sbom','sbomSha256')) {
    if ($null -eq $manifest.PSObject.Properties[$key] -or $manifest.$key -isnot [string] -or -not $manifest.$key) {
      throw 'The D2 artifact manifest has an invalid source/file field.'
    }
  }
  if ((@($manifest.PSObject.Properties.Name | Sort-Object) -join '|') -cne (($expectedKeys | Sort-Object) -join '|') -or
      ($manifest.schemaVersion -isnot [int] -and $manifest.schemaVersion -isnot [long]) -or $manifest.schemaVersion -ne 2 -or
      $manifest.sourceSha -cne $ReviewedSourceSha -or $manifest.runtime -cne 'nodejs24.x' -or
      $manifest.architecture -cne 'x86_64' -or $manifest.handlers -isnot [Array] -or
      (@($manifest.handlers) -join '|') -cne 'index.scheduled|index.trustSignal' -or
      $manifest.artifact -cne "$name.zip" -or $manifest.sbom -cne "$name.cdx.json" -or
      ($manifest.artifactBytes -isnot [int] -and $manifest.artifactBytes -isnot [long]) -or
      $manifest.artifactBytes -ne $files['zip'].Length -or
      $manifest.artifactSha256 -cne $files['zip'].Sha256 -or
      $manifest.artifactBase64Sha256 -cne (Get-Base64Sha $ArtifactPath) -or
      $manifest.bundleSha256 -cne $files['mjs'].Sha256 -or
      $manifest.sbomSha256 -cne $files['cdx.json'].Sha256 -or
      ($manifest.componentCount -isnot [int] -and $manifest.componentCount -isnot [long]) -or
      $manifest.componentCount -lt 0) { throw 'The D2 artifact manifest/source binding is invalid.' }
  $checksum = [IO.File]::ReadAllText($files['sha256'].Path)
  if ($checksum -cne "$($files['zip'].Sha256)  $name.zip`n") { throw 'The D2 checksum companion is invalid.' }
  $sbom = Get-Content -LiteralPath $files['cdx.json'].Path -Raw | ConvertFrom-Json
  if ($sbom.bomFormat -cne 'CycloneDX' -or $sbom.specVersion -cne '1.6' -or
      $sbom.metadata.component.name -cne '@ai-job-apply/d2-community-runtime-lambda' -or
      $sbom.components -isnot [Array] -or @($sbom.components).Count -ne $manifest.componentCount -or
      @($sbom.metadata.component.hashes).Count -ne 1 -or
      $sbom.metadata.component.hashes[0].alg -cne 'SHA-256' -or
      $sbom.metadata.component.hashes[0].content -cne $files['mjs'].Sha256) { throw 'The D2 SBOM binding is invalid.' }
  Assert-D2ArtifactZipSource -ArtifactPath $ArtifactPath -ReviewedSourceSha $ReviewedSourceSha -ExpectedSha256 $files['zip'].Sha256 `
    -ExpectedBase64Sha256 $manifest.artifactBase64Sha256 -ExpectedBundleSha256 $files['mjs'].Sha256 -ExpectedBundleLength $files['mjs'].Length
  [pscustomobject]@{
    ArtifactSha256=$files['zip'].Sha256
    Fingerprint=(@('zip','mjs','manifest.json','cdx.json','sha256') | ForEach-Object { $files[$_].Sha256 }) -join '|'
  }
}
function Invoke-SourceBoundD2ArtifactBuilds([string]$ReviewedSourceSha, [string]$ArtifactPath, [scriptblock]$Build) {
  if ($ReviewedSourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'An exact artifact build source is required.' }
  $previousEnvironment = [Environment]::GetEnvironmentVariables('Process')
  $wasPresent = $previousEnvironment.Contains('ARTIFACT_SOURCE_SHA')
  $previous = if ($wasPresent) { [string]$previousEnvironment['ARTIFACT_SOURCE_SHA'] } else { $null }
  try {
    Set-D2ArtifactSourceEnvironment -Value $ReviewedSourceSha -Present $true
    & $Build 1 | Out-Host
    $first = Get-VerifiedD2ArtifactBuild -ArtifactPath $ArtifactPath -ReviewedSourceSha $ReviewedSourceSha
    # Rebind before the second invocation even if a child/test seam mutated its parent state.
    Set-D2ArtifactSourceEnvironment -Value $ReviewedSourceSha -Present $true
    & $Build 2 | Out-Host
    $second = Get-VerifiedD2ArtifactBuild -ArtifactPath $ArtifactPath -ReviewedSourceSha $ReviewedSourceSha
    if ($second.Fingerprint -cne $first.Fingerprint) { throw 'The D2 artifact and companions are not deterministic.' }
    $second
  } finally { Set-D2ArtifactSourceEnvironment -Value $previous -Present $wasPresent }
}
function Confirm-D2PublishedArtifactSource($Receipt, [string]$ReviewedSourceSha, [string]$BucketName, [string]$AccountId, [string]$PrivateDirectory) {
  foreach ($key in @('sourceSha','artifactBucket','artifactSha256','artifactBase64Sha256','versionId','key')) {
    if ($null -eq $Receipt.PSObject.Properties[$key] -or $Receipt.$key -isnot [string] -or -not $Receipt.$key) {
      throw 'The D2 publication source/object field is invalid.'
    }
  }
  if ($ReviewedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or $AccountId -cnotmatch '^[0-9]{12}$' -or
      $Receipt.sourceSha -cne $ReviewedSourceSha -or $Receipt.artifactBucket -cne $BucketName -or
      $Receipt.artifactSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Receipt.versionId -isnot [string] -or
      $Receipt.versionId -cnotmatch '^[A-Za-z0-9._-]{1,1024}$' -or $Receipt.versionId -ceq 'null' -or
      $Receipt.key -cne "lambda/d2-community/$ReviewedSourceSha/$($Receipt.artifactSha256)/d2-community-runtime-lambda.zip") {
    throw 'The D2 publication source/object binding is invalid.'
  }
  $head = Invoke-AwsJson @('s3api','head-object','--bucket',$BucketName,'--key',[string]$Receipt.key,'--version-id',[string]$Receipt.versionId,'--expected-bucket-owner',$AccountId,'--checksum-mode','ENABLED','--output','json')
  if ($head.VersionId -cne $Receipt.versionId -or $head.ChecksumSHA256 -cne $Receipt.artifactBase64Sha256 -or
      ($head.ContentLength -isnot [int] -and $head.ContentLength -isnot [long]) -or
      $head.ContentLength -lt 1 -or $head.ContentLength -gt 64MB) { throw 'The exact immutable D2 object metadata is invalid.' }
  $parent = [IO.Path]::GetFullPath($PrivateDirectory)
  $null = New-Item -ItemType Directory -Force -Path $parent
  $temporary = Join-Path $parent ('verify-source-' + [guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path $temporary
  $download = Join-Path $temporary 'd2-community-runtime-lambda.zip'
  try {
    $result = Invoke-AwsJson @('s3api','get-object','--bucket',$BucketName,'--key',[string]$Receipt.key,'--version-id',[string]$Receipt.versionId,'--expected-bucket-owner',$AccountId,'--range',"bytes=0-$($head.ContentLength-1)",'--cli-connect-timeout','10','--cli-read-timeout','30','--output','json',$download)
    if ($result.VersionId -cne $Receipt.versionId -or $result.ContentLength -ne $head.ContentLength -or
        -not (Test-Path -LiteralPath $download -PathType Leaf) -or (Get-Item -LiteralPath $download).Length -ne $head.ContentLength) {
      throw 'The exact immutable D2 download is incomplete.'
    }
    Assert-D2ArtifactZipSource -ArtifactPath $download -ReviewedSourceSha $ReviewedSourceSha `
      -ExpectedSha256 $Receipt.artifactSha256 -ExpectedBase64Sha256 $Receipt.artifactBase64Sha256
  } finally {
    $resolved = [IO.Path]::GetFullPath($temporary)
    if ((Split-Path $resolved -Parent) -cne $parent -or (Split-Path $resolved -Leaf) -cnotmatch '^verify-source-[a-f0-9]{32}$') {
      throw 'Refused unsafe D2 verification download cleanup.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
function Resolve-Private([string]$Path) {
  $value = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $root $Path)) }
  if (-not $value.StartsWith($privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "D2 evidence must remain below its ignored private operator directory." }
  $value
}
function Invoke-AwsJson([string[]]$Arguments) {
  $raw = & aws.exe @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "An exact AWS operation failed." }
  if ($raw) { $raw -join "`n" | ConvertFrom-Json } else { $null }
}
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or -not $StateBucket -or -not $ArtifactBucket) { throw "The exact account, encrypted state bucket, and versioned artifact bucket are required." }
$env:AWS_PROFILE=$AwsProfile; $env:AWS_REGION=$region; $env:AWS_DEFAULT_REGION=$region; $env:AWS_PAGER=""
$caller = Invoke-AwsJson @("sts","get-caller-identity","--output","json")
if ([string]$caller.Account -cne $ExpectedAccountId) { throw "AWS account mismatch." }
foreach ($bucketName in @($StateBucket, $ArtifactBucket)) {
  $bucket = Invoke-AwsJson @("s3api","get-bucket-versioning","--bucket",$bucketName,"--output","json")
  if ([string]$bucket.Status -cne "Enabled") { throw "Every D2 publication bucket must be versioned." }
  $encryption = Invoke-AwsJson @("s3api","get-bucket-encryption","--bucket",$bucketName,"--output","json")
  $algorithm = [string]$encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm
  if ($algorithm -notin @("AES256","aws:kms")) { throw "Every D2 publication bucket must enforce server-side encryption." }
}
if ($Action -ceq "Status") { [pscustomobject]@{ Action="Status"; AccountMatched=$true; StateBucketVersioning="Enabled"; ArtifactBucketVersioning="Enabled" }; exit 0 }
if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw "An exact reviewed source SHA is required." }
if ($Action -ceq "Publish") {
  if (@(git -C $root status --porcelain).Count -ne 0 -or (git -C $root rev-parse HEAD).Trim() -cne $SourceSha) { throw "Publication requires the exact clean reviewed source." }
  pnpm --filter @ai-job-apply/workflows test; if ($LASTEXITCODE) { throw "Workflow tests failed." }
  pnpm audit:dependencies; if ($LASTEXITCODE) { throw "Dependency audit failed." }
  $built = Invoke-SourceBoundD2ArtifactBuilds -ReviewedSourceSha $SourceSha -ArtifactPath $artifact -Build {
    param([int]$Attempt)
    pnpm --filter @ai-job-apply/workflows build:lambda:d2-community
    if ($LASTEXITCODE) { throw 'D2 source-bound build failed.' }
  }
  $first = $built.ArtifactSha256
  $key = "lambda/d2-community/$SourceSha/$first/d2-community-runtime-lambda.zip"
  $existing = & aws.exe s3api head-object --bucket $ArtifactBucket --key $key 2>$null
  if ($LASTEXITCODE -eq 0) { throw "The immutable D2 artifact key already exists." }
  $put = Invoke-AwsJson @("s3api","put-object","--bucket",$ArtifactBucket,"--key",$key,"--body",$artifact,"--checksum-algorithm","SHA256","--if-none-match","*","--output","json")
  if ($put.VersionId -isnot [string] -or $put.VersionId -cnotmatch '^[A-Za-z0-9._-]{1,1024}$' -or $put.VersionId -ceq 'null') { throw "The publication did not return an immutable version." }
  $path = Resolve-Private $(if ($ReceiptPath) {$ReceiptPath} else { Join-Path $privateRoot "receipt-$($SourceSha.Substring(0,12)).json" })
  $null = New-Item -ItemType Directory -Force -Path (Split-Path $path)
  [IO.File]::WriteAllText($path, ([ordered]@{schemaVersion=1;kind="development-d2-community-artifact-publication";sourceSha=$SourceSha;artifactBucket=$ArtifactBucket;artifactSha256=$first;artifactBase64Sha256=(Get-Base64Sha $artifact);key=$key;versionId=[string]$put.VersionId;phase="published"}|ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  [pscustomobject]@{ ReceiptPath=$path; ReceiptSha256=(Get-Sha $path); ArtifactSha256=$first }; exit 0
}
$path = Resolve-Private $ReceiptPath
if ((Get-Sha $path) -cne $ReviewedReceiptSha256) { throw "Receipt checksum mismatch." }
$receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
if ($receipt.kind -cne "development-d2-community-artifact-publication" -or $receipt.sourceSha -cne $SourceSha -or $receipt.artifactBucket -cne $ArtifactBucket -or $receipt.phase -cne "published") { throw "Receipt boundary mismatch." }
Confirm-D2PublishedArtifactSource -Receipt $receipt -ReviewedSourceSha $SourceSha -BucketName $ArtifactBucket -AccountId $ExpectedAccountId -PrivateDirectory $privateRoot
[pscustomobject]@{ Action="Verify"; SourceSha=$SourceSha; ArtifactSha256=[string]$receipt.artifactSha256; LambdaDeploymentChanged=$false; TriggerChanged=$false }
