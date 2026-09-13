$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$publisherPath = Join-Path $root 'scripts\operate-development-d2-community-artifact.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($publisherPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count) { throw 'The D2 publisher does not parse.' }
foreach ($name in @('Get-Sha','Get-Base64Sha','Set-D2ArtifactSourceEnvironment','Assert-D2ArtifactZipSource','Get-VerifiedD2ArtifactBuild','Invoke-SourceBoundD2ArtifactBuilds','Confirm-D2PublishedArtifactSource')) {
  $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }.GetNewClosure(), $true)
  if ($null -eq $function) { throw 'A D2 publisher source guard is missing.' }
  . ([scriptblock]::Create($function.Extent.Text))
}
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Label) {
  $script:checks++
  if (-not $Condition) { throw "D2 artifact source regression: $Label" }
}
function Assert-Rejected([scriptblock]$Action, [string]$Label) {
  $rejected = $false
  try { $null = & $Action } catch { $rejected = $true }
  Assert-True $rejected $Label
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$privateParent = [IO.Path]::GetFullPath((Join-Path $root '.tmp'))
$testDirectory = Join-Path $privateParent ('d2-artifact-source-tests-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$artifactPath = Join-Path $testDirectory 'd2-community-runtime-lambda.zip'
$reviewed = 'a' * 40
$priorEnvironment = [Environment]::GetEnvironmentVariables('Process')
$priorPresent = $priorEnvironment.Contains('ARTIFACT_SOURCE_SHA')
$priorValue = if ($priorPresent) { [string]$priorEnvironment['ARTIFACT_SOURCE_SHA'] } else { $null }
function Write-GeneratedD2Artifact([string]$ManifestSource = $reviewed, [string]$BundleSource = $reviewed, [string]$Change = '') {
  $base = Join-Path $testDirectory 'd2-community-runtime-lambda'
  $bundle = "/* applydash-artifact-source:$BundleSource */`nexport const scheduled = () => {}; export const trustSignal = () => {};`n"
  [IO.File]::WriteAllText("$base.mjs", $bundle, [Text.UTF8Encoding]::new($false))
  $zipFile = [IO.File]::Open("$base.zip", [IO.FileMode]::Create)
  $zip = [IO.Compression.ZipArchive]::new($zipFile, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    $entry = $zip.CreateEntry('index.mjs')
    $entry.LastWriteTime = [DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
    $stream = $entry.Open()
    try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($bundle); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    if ($Change -ceq 'extraZipEntry') {
      $extra = $zip.CreateEntry('unexpected.txt'); $extra.LastWriteTime = $entry.LastWriteTime
    }
  } finally { $zip.Dispose(); $zipFile.Dispose() }
  $bundleSha = Get-Sha "$base.mjs"
  $sbom = [ordered]@{
    bomFormat='CycloneDX'; specVersion='1.6'; version=1
    metadata=@{component=@{name='@ai-job-apply/d2-community-runtime-lambda';hashes=@(@{alg='SHA-256';content=$bundleSha})}}
    components=@()
  }
  if ($Change -ceq 'sbomName') { $sbom.metadata.component.name='@synthetic/unrelated' }
  [IO.File]::WriteAllText("$base.cdx.json", ($sbom | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  $artifactSha = Get-Sha "$base.zip"
  $manifest = [ordered]@{
    schemaVersion=2; sourceSha=$ManifestSource; runtime='nodejs24.x'; architecture='x86_64'
    handlers=@('index.scheduled','index.trustSignal'); artifact='d2-community-runtime-lambda.zip'
    artifactBytes=(Get-Item -LiteralPath "$base.zip").Length; artifactSha256=$artifactSha
    artifactBase64Sha256=(Get-Base64Sha "$base.zip"); bundleSha256=$bundleSha
    sbom='d2-community-runtime-lambda.cdx.json'; sbomSha256=(Get-Sha "$base.cdx.json"); componentCount=0
  }
  switch ($Change) {
    'manifestArtifactHash' { $manifest.artifactSha256='b'*64 }
    'manifestBundleHash' { $manifest.bundleSha256='b'*64 }
    'manifestSbomHash' { $manifest.sbomSha256='b'*64 }
    'manifestBase64Hash' { $manifest.artifactBase64Sha256=[Convert]::ToBase64String([byte[]](1..32)) }
    'manifestLength' { $manifest.artifactBytes++ }
    'manifestFilename' { $manifest.artifact='other.zip' }
    'manifestHandler' { $manifest.handlers=@('index.scheduled') }
    'manifestRuntime' { $manifest.runtime='nodejs22.x' }
    'manifestSchemaString' { $manifest.schemaVersion='2' }
    'manifestSourceArray' { $manifest.sourceSha=@($ManifestSource) }
    'manifestHashArray' { $manifest.artifactSha256=@($artifactSha) }
    'manifestExtra' { $manifest['unexpected']=$true }
    'manifestComponentCount' { $manifest.componentCount=1 }
  }
  [IO.File]::WriteAllText("$base.manifest.json", ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText("$base.sha256", "$artifactSha  d2-community-runtime-lambda.zip`n", [Text.UTF8Encoding]::new($false))
  if ($Change -ceq 'checksum') { [IO.File]::AppendAllText("$base.sha256", 'unexpected') }
  if ($Change -ceq 'bundle') { [IO.File]::AppendAllText("$base.mjs", '// changed') }
}
function Assert-Environment([bool]$Present, [AllowNull()][AllowEmptyString()][string]$Value) {
  $actual = [Environment]::GetEnvironmentVariables('Process')
  Assert-True ($actual.Contains('ARTIFACT_SOURCE_SHA') -eq $Present) 'process variable presence preserved'
  if ($Present) { Assert-True ([string]$actual['ARTIFACT_SOURCE_SHA'] -ceq $Value) 'process variable value preserved' }
}
function Invoke-AwsJson([string[]]$Arguments) {
  $script:remoteCalls++
  Assert-True ($Arguments[0] -ceq 's3api' -and $Arguments[1] -in @('head-object','get-object')) 'verification only reads S3'
  foreach ($binding in @(@('--bucket','synthetic-artifacts'),@('--key',$script:remoteReceipt.key),@('--version-id','synthetic-exact-version'),@('--expected-bucket-owner','123456789012'))) {
    $index = [Array]::IndexOf($Arguments, $binding[0])
    Assert-True ($index -ge 0 -and $Arguments[$index+1] -ceq $binding[1]) 'exact remote identity binding'
  }
  $length = (Get-Item -LiteralPath $artifactPath).Length
  if ($Arguments[1] -ceq 'head-object') {
    return [pscustomobject]@{
      VersionId=$(if ($script:remoteFault -ceq 'headVersion') { 'wrong-version' } else { 'synthetic-exact-version' })
      ChecksumSHA256=$(if ($script:remoteFault -ceq 'headChecksum') { 'wrong-checksum' } else { Get-Base64Sha $artifactPath })
      ContentLength=$(if ($script:remoteFault -ceq 'headSize') { 64MB+1 } else { $length })
    }
  }
  Assert-True ($Arguments[[Array]::IndexOf($Arguments,'--range')+1] -ceq "bytes=0-$($length-1)") 'download requests the complete bounded range'
  if ($script:remoteFault -ceq 'downloadFailure') { throw 'Synthetic download failure.' }
  $destination = $Arguments[-1]
  Assert-True (-not (Test-Path -LiteralPath $destination)) 'download destination is exclusive'
  [IO.File]::Copy($artifactPath, $destination, $false)
  if ($script:remoteFault -ceq 'downloadBytes') { [IO.File]::AppendAllText($destination, 'bad') }
  return [pscustomobject]@{
    VersionId=$(if ($script:remoteFault -ceq 'downloadVersion') { 'wrong-version' } else { 'synthetic-exact-version' })
    ContentLength=$(if ($script:remoteFault -ceq 'downloadLength') { $length-1 } else { $length })
  }
}
try {
  foreach ($state in @(@{present=$false;value=$null},@{present=$true;value=''},@{present=$true;value='local'},@{present=$true;value=('b'*40)},@{present=$true;value=$reviewed})) {
    foreach ($failAt in @(0,1,2)) {
      Set-D2ArtifactSourceEnvironment -Value $state.value -Present $state.present
      Assert-Environment -Present $state.present -Value $state.value
      $script:buildCalls = 0
      $build = {
        param([int]$Attempt)
        $script:buildCalls++
        Assert-True ([Environment]::GetEnvironmentVariable('ARTIFACT_SOURCE_SHA','Process') -ceq $reviewed) 'both builds receive reviewed source'
        if ($Attempt -eq $failAt) { throw 'Synthetic build failure.' }
        Write-GeneratedD2Artifact
        Set-D2ArtifactSourceEnvironment -Value 'synthetic-child-change' -Present $true
      }
      if ($failAt) {
        Assert-Rejected { Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath $build } 'build failure refuses publication'
      } else {
        $verified = Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath $build
        Assert-True ($verified.ArtifactSha256 -ceq (Get-Sha $artifactPath)) 'verified archive digest returned'
      }
      Assert-True ($script:buildCalls -eq $(if ($failAt) { $failAt } else { 2 })) 'bounded build count'
      Assert-Environment -Present $state.present -Value $state.value
    }
  }
  foreach ($change in @('manifestArtifactHash','manifestBundleHash','manifestSbomHash','manifestBase64Hash','manifestLength','manifestFilename','manifestHandler','manifestRuntime','manifestSchemaString','manifestSourceArray','manifestHashArray','manifestExtra','manifestComponentCount','sbomName','checksum','bundle','extraZipEntry')) {
    $script:puts = 0
    Assert-Rejected {
      $null = Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath { Write-GeneratedD2Artifact -Change $change }
      $script:puts++
    } 'malformed artifact refuses before put'
    Assert-True ($script:puts -eq 0) 'no put after malformed build'
    Assert-Environment -Present $true -Value $reviewed
  }
  foreach ($sources in @(@{manifest='local';bundle='local'},@{manifest='local';bundle=$reviewed},@{manifest=$reviewed;bundle='local'},@{manifest=('b'*40);bundle=$reviewed},@{manifest=$reviewed;bundle=('b'*40)})) {
    $script:puts = 0
    Assert-Rejected {
      $null = Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath {
        Write-GeneratedD2Artifact -ManifestSource $sources.manifest -BundleSource $sources.bundle
      }
      $script:puts++
    } 'local or mismatched source refuses before put'
    Assert-True ($script:puts -eq 0) 'no put after source mismatch'
    Assert-Environment -Present $true -Value $reviewed
  }
  $script:puts = 0
  Assert-Rejected {
    $null = Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath {
      param([int]$Attempt)
      Write-GeneratedD2Artifact -ManifestSource $(if ($Attempt -eq 2) { 'local' } else { $reviewed })
    }
    $script:puts++
  } 'second build source mismatch refuses before put'
  Assert-True ($script:puts -eq 0) 'no put after second source mismatch'
  Assert-Environment -Present $true -Value $reviewed
  Assert-Rejected {
    Invoke-SourceBoundD2ArtifactBuilds $reviewed $artifactPath {
      param([int]$Attempt)
      Write-GeneratedD2Artifact
      if ($Attempt -eq 2) { [IO.File]::AppendAllText((Join-Path $testDirectory 'd2-community-runtime-lambda.manifest.json'), "`n") }
    }
  } 'nondeterministic companion refuses publication'
  Assert-Rejected { Invoke-SourceBoundD2ArtifactBuilds 'local' $artifactPath { throw 'Must not build' } } 'local reviewed source refused'
  $verificationDirectory = Join-Path $testDirectory 'verification'
  $null = New-Item -ItemType Directory -Path $verificationDirectory
  $sentinel = Join-Path $verificationDirectory 'retained-evidence.txt'
  [IO.File]::WriteAllText($sentinel, 'preserve')
  foreach ($fault in @('none','headVersion','headChecksum','headSize','downloadFailure','downloadVersion','downloadLength','downloadBytes','localBundle','otherBundle','extraZipEntry')) {
    Write-GeneratedD2Artifact -BundleSource $(if ($fault -ceq 'localBundle') { 'local' } elseif ($fault -ceq 'otherBundle') { 'b'*40 } else { $reviewed }) -Change $(if ($fault -ceq 'extraZipEntry') { 'extraZipEntry' } else { '' })
    $script:remoteFault = $fault
    $script:remoteCalls = 0
    $sha = Get-Sha $artifactPath
    $script:remoteReceipt = [pscustomobject]@{
      sourceSha=$reviewed;artifactBucket='synthetic-artifacts';artifactSha256=$sha
      artifactBase64Sha256=(Get-Base64Sha $artifactPath);versionId='synthetic-exact-version'
      key="lambda/d2-community/$reviewed/$sha/d2-community-runtime-lambda.zip"
    }
    $verify = { Confirm-D2PublishedArtifactSource $script:remoteReceipt $reviewed 'synthetic-artifacts' '123456789012' $verificationDirectory }
    if ($fault -ceq 'none') { & $verify; Assert-True $true 'valid source-bound remote archive verifies' }
    else { Assert-Rejected $verify 'invalid remote source/version/bytes refuse verification' }
    Assert-True ($script:remoteCalls -eq $(if ($fault -like 'head*') { 1 } else { 2 })) 'remote verification remains bounded'
    Assert-True (@(Get-ChildItem -LiteralPath $verificationDirectory -Directory).Count -eq 0) 'download directory cleaned after success or failure'
    Assert-True ([IO.File]::ReadAllText($sentinel) -ceq 'preserve') 'pre-existing evidence retained'
  }
  foreach ($version in @('null','',('x'*1025),'bad/version',123,@('version-one','version-two'))) {
    $script:remoteReceipt.versionId=$version
    $script:remoteCalls=0
    Assert-Rejected { Confirm-D2PublishedArtifactSource $script:remoteReceipt $reviewed 'synthetic-artifacts' '123456789012' $verificationDirectory } 'nonimmutable or malformed version refuses before AWS'
    Assert-True ($script:remoteCalls -eq 0) 'invalid version causes no remote call'
  }
  Write-GeneratedD2Artifact
  $oversizePath = Join-Path $testDirectory 'oversize.zip'
  $oversize = [IO.File]::Open($oversizePath, [IO.FileMode]::CreateNew)
  try { $oversize.SetLength(64MB+1) } finally { $oversize.Dispose() }
  Assert-Rejected { Assert-D2ArtifactZipSource $oversizePath $reviewed ('a'*64) 'not-needed' } 'oversized archive rejects before hashing/decompression'
  $decompressedPath = Join-Path $testDirectory 'oversize-entry.zip'
  $decompressedFile = [IO.File]::Open($decompressedPath, [IO.FileMode]::CreateNew)
  $decompressedZip = [IO.Compression.ZipArchive]::new($decompressedFile,[IO.Compression.ZipArchiveMode]::Create,$false)
  try {
    $entry = $decompressedZip.CreateEntry('index.mjs')
    $stream = $entry.Open()
    try {
      $buffer = New-Object byte[] 65536
      for ($i=0; $i -lt 1024; $i++) { $stream.Write($buffer,0,$buffer.Length) }
      $stream.WriteByte(0)
    } finally { $stream.Dispose() }
  } finally { $decompressedZip.Dispose(); $decompressedFile.Dispose() }
  Assert-Rejected { Assert-D2ArtifactZipSource $decompressedPath $reviewed (Get-Sha $decompressedPath) (Get-Base64Sha $decompressedPath) } 'oversized decompressed entry refuses before reading'
  $source = [IO.File]::ReadAllText($publisherPath)
  Assert-True ($source.IndexOf('$built = Invoke-SourceBoundD2ArtifactBuilds') -lt $source.IndexOf('"s3api","put-object"')) 'production build guard precedes put'
  Assert-True ($source.Contains('pnpm --filter @ai-job-apply/workflows build:lambda:d2-community')) 'maintained builder remains wired'
  Assert-True ($source.Contains('Confirm-D2PublishedArtifactSource -Receipt $receipt')) 'maintained Verify checks the exact remote ZIP source'
  Write-Host "D2 artifact source binding passed: $script:checks assertions; zero cloud calls."
} finally {
  Set-D2ArtifactSourceEnvironment -Value $priorValue -Present $priorPresent
  $resolved = [IO.Path]::GetFullPath($testDirectory)
  if ((Split-Path $resolved -Parent) -cne $privateParent -or (Split-Path $resolved -Leaf) -notmatch '^d2-artifact-source-tests-[a-f0-9]{32}$') { throw 'Refused unsafe synthetic fixture cleanup.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
