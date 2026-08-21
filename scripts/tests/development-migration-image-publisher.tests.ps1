$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$publisherPath = Join-Path $repositoryRoot "scripts\publish-development-migration-image.ps1"
$source = Get-Content -LiteralPath $publisherPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The development migration image publisher did not parse." }

foreach ($functionName in @(
    "Get-OptionalProperty", "Get-FileSha256", "Get-TextSha256",
    "ConvertTo-CanonicalUtcWholeSecond", "ConvertFrom-PublicationReceiptJson",
    "Resolve-OperatorPath", "Write-JsonFile",
    "Invoke-AwsScanJson",
    "Assert-RepositoryShape", "Resolve-OciBlobPath", "Get-OciLayoutIdentity",
    "Assert-DeterministicOciIdentity", "Assert-RemoteOciImage", "Assert-PlatformHandoff",
    "Assert-ExactPropertySet", "Test-CanonicalUtcTimestamp", "Get-CanonicalReceiptPropertyNames",
    "Assert-ResumablePublicationReceipt", "Resolve-PublicationResumeMode", "Assert-PublicationReceipt",
    "Invoke-LocalMigrationImageBuild"
  )) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$account = "123456789012"
$region = "us-east-2"
$repositoryName = "ai-job-apply/migration"
$repositoryUri = "$account.dkr.ecr.$region.amazonaws.com/$repositoryName"
$repositoryArn = "arn:aws:ecr:$region`:$account`:repository/$repositoryName"
$kmsArn = "arn:aws:kms:$region`:$account`:key/11111111-2222-3333-4444-555555555555"
$repository = [pscustomobject]@{
  repositoryName = $repositoryName; repositoryUri = $repositoryUri; repositoryArn = $repositoryArn
  registryId = $account; imageTagMutability = "IMMUTABLE"
  imageScanningConfiguration = [pscustomobject]@{ scanOnPush = $true }
  encryptionConfiguration = [pscustomobject]@{ encryptionType = "KMS"; kmsKey = $kmsArn }
}
$null = Assert-RepositoryShape -Repository $repository -ExpectedName $repositoryName `
  -ExpectedUri $repositoryUri -ExpectedArn $repositoryArn -ExpectedAccount $account `
  -ExpectedRegion $region -ExpectedKmsArn $kmsArn
foreach ($mutation in @(
    @{ property = "imageTagMutability"; value = "MUTABLE" },
    @{ property = "registryId"; value = "999999999999" },
    @{ property = "imageScanningConfiguration"; value = [pscustomobject]@{ scanOnPush = $false } }
  )) {
  $copy = $repository | Select-Object *; $copy.($mutation.property) = $mutation.value
  try { $null = Assert-RepositoryShape -Repository $copy -ExpectedName $repositoryName -ExpectedUri $repositoryUri -ExpectedArn $repositoryArn -ExpectedAccount $account -ExpectedRegion $region -ExpectedKmsArn $kmsArn; throw "bad repository accepted" } catch { if ($_.Exception.Message -eq "bad repository accepted") { throw } }
}

$sourceSha = "a" * 40
$created = "2026-08-13T12:00:00Z"
$layoutRoot = Join-Path ([IO.Path]::GetTempPath()) ("migration-oci-tests-{0}" -f [guid]::NewGuid().ToString("N"))
function New-TestLayout {
  param([Parameter(Mandatory)][string]$Path, [string]$Os = "linux", [string]$Architecture = "amd64", [int]$PlatformCount = 1, [string]$Revision = $sourceSha)
  $blobRoot = Join-Path $Path "blobs\sha256"
  $null = New-Item -ItemType Directory -Path $blobRoot -Force
  [IO.File]::WriteAllText((Join-Path $Path "oci-layout"), '{"imageLayoutVersion":"1.0.0"}', [Text.UTF8Encoding]::new($false))
  $layerBytes = [Text.Encoding]::UTF8.GetBytes("compressed-layer")
  $layerHash = (Get-TextSha256 -Value "compressed-layer")
  [IO.File]::WriteAllBytes((Join-Path $blobRoot $layerHash), $layerBytes)
  $layerDigest = "sha256:$layerHash"
  $diffId = "sha256:" + ("d" * 64)
  $configObject = [ordered]@{
    created = $created; architecture = "amd64"; os = "linux"
    config = [ordered]@{
      User = "65532:65532"; WorkingDir = "/migration"; Entrypoint = @("/nodejs/bin/node")
      Cmd = @("runner/dist/src/main.js")
      Labels = [ordered]@{
        "org.opencontainers.image.revision" = $Revision
        "org.opencontainers.image.created" = $created
        "org.opencontainers.image.title" = "ai-job-apply-migration"
      }
    }
    rootfs = [ordered]@{ type = "layers"; diff_ids = @($diffId) }
  }
  $configJson = $configObject | ConvertTo-Json -Depth 20 -Compress
  $configHash = Get-TextSha256 -Value $configJson
  [IO.File]::WriteAllText((Join-Path $blobRoot $configHash), $configJson, [Text.UTF8Encoding]::new($false))
  $manifestObject = [ordered]@{
    schemaVersion = 2; mediaType = "application/vnd.oci.image.manifest.v1+json"
    config = [ordered]@{ mediaType = "application/vnd.oci.image.config.v1+json"; digest = "sha256:$configHash"; size = [Text.Encoding]::UTF8.GetByteCount($configJson) }
    layers = @([ordered]@{ mediaType = "application/vnd.oci.image.layer.v1.tar+gzip"; digest = $layerDigest; size = $layerBytes.Length })
  }
  $manifestJson = $manifestObject | ConvertTo-Json -Depth 20 -Compress
  $manifestHash = Get-TextSha256 -Value $manifestJson
  [IO.File]::WriteAllText((Join-Path $blobRoot $manifestHash), $manifestJson, [Text.UTF8Encoding]::new($false))
  $descriptors = @()
  for ($index = 0; $index -lt $PlatformCount; $index++) {
    $descriptors += [ordered]@{
      mediaType = "application/vnd.oci.image.manifest.v1+json"; digest = "sha256:$manifestHash"
      size = [Text.Encoding]::UTF8.GetByteCount($manifestJson); platform = [ordered]@{ architecture = $Architecture; os = $Os }
    }
  }
  $indexJson = ([ordered]@{ schemaVersion = 2; mediaType = "application/vnd.oci.image.index.v1+json"; manifests = $descriptors } | ConvertTo-Json -Depth 20 -Compress)
  $indexHash = Get-TextSha256 -Value $indexJson
  [IO.File]::WriteAllText((Join-Path $blobRoot $indexHash), $indexJson, [Text.UTF8Encoding]::new($false))
  $outerJson = ([ordered]@{
      schemaVersion = 2; mediaType = "application/vnd.oci.image.index.v1+json"
      manifests = @([ordered]@{ mediaType = "application/vnd.oci.image.index.v1+json"; digest = "sha256:$indexHash"; size = [Text.Encoding]::UTF8.GetByteCount($indexJson) })
    } | ConvertTo-Json -Depth 20 -Compress)
  [IO.File]::WriteAllText((Join-Path $Path "index.json"), $outerJson, [Text.UTF8Encoding]::new($false))
  return [pscustomobject]@{ IndexJson = $indexJson; IndexDigest = "sha256:$indexHash"; ManifestJson = $manifestJson; ManifestDigest = "sha256:$manifestHash"; ConfigDigest = "sha256:$configHash"; LayerDigest = $layerDigest }
}

try {
  $canonicalPath = Join-Path $layoutRoot "canonical"
  $fixture = New-TestLayout -Path $canonicalPath
  $identity = Get-OciLayoutIdentity -LayoutPath $canonicalPath -ExpectedSourceSha $sourceSha -ExpectedCreated $created
  if ($identity.IndexDigest -cne $fixture.IndexDigest -or $identity.PlatformDigest -cne $fixture.ManifestDigest -or $identity.ConfigDigest -cne $fixture.ConfigDigest) { throw "canonical OCI identity rejected" }
  $null = Assert-DeterministicOciIdentity -First $identity -Second $identity
  foreach ($case in @(
      @{ name = "wrong-os"; os = "windows"; arch = "amd64"; count = 1 },
      @{ name = "wrong-arch"; os = "linux"; arch = "arm64"; count = 1 },
      @{ name = "missing-platform"; os = "linux"; arch = "amd64"; count = 0 },
      @{ name = "extra-platform"; os = "linux"; arch = "amd64"; count = 2 }
    )) {
    $path = Join-Path $layoutRoot $case.name; $null = New-TestLayout -Path $path -Os $case.os -Architecture $case.arch -PlatformCount $case.count
    try { $null = Get-OciLayoutIdentity -LayoutPath $path -ExpectedSourceSha $sourceSha -ExpectedCreated $created; throw "mutated platform accepted" } catch { if ($_.Exception.Message -eq "mutated platform accepted") { throw } }
  }
  $wrongLabelPath = Join-Path $layoutRoot "wrong-label"
  $null = New-TestLayout -Path $wrongLabelPath -Revision ("e" * 40)
  try { $null = Get-OciLayoutIdentity -LayoutPath $wrongLabelPath -ExpectedSourceSha $sourceSha -ExpectedCreated $created; throw "wrong source label accepted" } catch { if ($_.Exception.Message -eq "wrong source label accepted") { throw } }
  $nondeterministic = $identity | Select-Object *; $nondeterministic.ConfigDigest = "sha256:" + ("9" * 64)
  try { $null = Assert-DeterministicOciIdentity -First $identity -Second $nondeterministic; throw "nondeterminism accepted" } catch { if ($_.Exception.Message -eq "nondeterminism accepted") { throw } }

  $indexDetail = [pscustomobject]@{ imageDigest = $identity.IndexDigest; imageTags = @($sourceSha) }
  $indexImage = [pscustomobject]@{ imageId = [pscustomobject]@{ imageDigest = $identity.IndexDigest }; imageManifest = $fixture.IndexJson }
  $platformImage = [pscustomobject]@{ imageId = [pscustomobject]@{ imageDigest = $identity.PlatformDigest }; imageManifest = $fixture.ManifestJson }
  $scan = [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{} } }
  $remote = Assert-RemoteOciImage -IndexDetail $indexDetail -IndexImage $indexImage -PlatformImage $platformImage -Scan $scan -ExpectedTag $sourceSha -ExpectedIndexDigest $identity.IndexDigest -ExpectedPlatformDigest $identity.PlatformDigest -ExpectedConfigDigest $identity.ConfigDigest -ExpectedCompressedLayerSetSha256 $identity.CompressedLayerSetSha256
  if ($remote.PlatformDigest -cne $identity.PlatformDigest) { throw "canonical remote OCI rejected" }
  $null = Assert-PlatformHandoff -BatchImage $platformImage -Identity $identity
  foreach ($mutation in @(
      @{ name = "index-confusion"; index = "sha256:" + ("1" * 64); platform = $identity.PlatformDigest; config = $identity.ConfigDigest; layers = $identity.CompressedLayerSetSha256; scan = $scan },
      @{ name = "platform-confusion"; index = $identity.IndexDigest; platform = "sha256:" + ("2" * 64); config = $identity.ConfigDigest; layers = $identity.CompressedLayerSetSha256; scan = $scan },
      @{ name = "config-confusion"; index = $identity.IndexDigest; platform = $identity.PlatformDigest; config = "sha256:" + ("3" * 64); layers = $identity.CompressedLayerSetSha256; scan = $scan },
      @{ name = "layer-confusion"; index = $identity.IndexDigest; platform = $identity.PlatformDigest; config = $identity.ConfigDigest; layers = "4" * 64; scan = $scan },
      @{ name = "incomplete-scan"; index = $identity.IndexDigest; platform = $identity.PlatformDigest; config = $identity.ConfigDigest; layers = $identity.CompressedLayerSetSha256; scan = [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "IN_PROGRESS" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{} } } },
      @{ name = "vulnerable-scan"; index = $identity.IndexDigest; platform = $identity.PlatformDigest; config = $identity.ConfigDigest; layers = $identity.CompressedLayerSetSha256; scan = [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{ HIGH = 1 } } } }
      @{ name = "critical-scan"; index = $identity.IndexDigest; platform = $identity.PlatformDigest; config = $identity.ConfigDigest; layers = $identity.CompressedLayerSetSha256; scan = [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{ CRITICAL = 1 } } } }
    )) {
    try { $null = Assert-RemoteOciImage -IndexDetail $indexDetail -IndexImage $indexImage -PlatformImage $platformImage -Scan $mutation.scan -ExpectedTag $sourceSha -ExpectedIndexDigest $mutation.index -ExpectedPlatformDigest $mutation.platform -ExpectedConfigDigest $mutation.config -ExpectedCompressedLayerSetSha256 $mutation.layers; throw "$($mutation.name) accepted" } catch { if ($_.Exception.Message -eq "$($mutation.name) accepted") { throw } }
  }
} finally {
  if (Test-Path -LiteralPath $layoutRoot -PathType Container) { Remove-Item -LiteralPath $layoutRoot -Recurse -Force }
}

$boundary = [pscustomobject]@{ BoundarySha256 = "2" * 64; RepositoryName = $repositoryName; RepositoryUri = $repositoryUri }
$receipt = [pscustomobject]@{
  schemaVersion = 2; kind = "development-migration-image-publication"; environment = "development"; region = $region
  sourceSha = $sourceSha; boundarySha256 = $boundary.BoundarySha256; repositoryName = $repositoryName; repositoryUri = $repositoryUri
  sourceTag = $sourceSha; handoffTag = "$sourceSha-linux-amd64"; platform = "linux/amd64"; created = $created
  indexDigest = $identity.IndexDigest; platformDigest = $identity.PlatformDigest; configDigest = $identity.ConfigDigest
  compressedLayerSetSha256 = $identity.CompressedLayerSetSha256; rootfsDiffIdSetSha256 = $identity.RootfsDiffIdSetSha256
  phase = "verified"; imageUri = "$repositoryUri@$($identity.PlatformDigest)"; scanStatus = "COMPLETE"; criticalFindings = 0; highFindings = 0
  publicationStartedAt = "2026-08-13T20:33:10.2160450+00:00"; publicationCompletedAt = "2026-08-13T20:35:18.8312542+00:00"
}
$null = Assert-PublicationReceipt -Receipt $receipt -Boundary $boundary -ExpectedRegion $region -ExpectedSourceSha $sourceSha -ExpectedCreated $created
$receiptJson = $receipt | ConvertTo-Json -Depth 20
$receiptJsonSha = Get-TextSha256 -Value $receiptJson
$receiptFromJson = ConvertFrom-PublicationReceiptJson -Json $receiptJson
if ($receiptFromJson.created -isnot [string] -or
    $receiptFromJson.publicationStartedAt -isnot [string] -or
    $receiptFromJson.publicationCompletedAt -isnot [string]) {
  throw "Receipt JSON timestamps were not preserved as exact strings."
}
$null = Assert-PublicationReceipt -Receipt $receiptFromJson -Boundary $boundary -ExpectedRegion $region `
  -ExpectedSourceSha $sourceSha -ExpectedCreated $created
if ((Get-TextSha256 -Value $receiptJson) -cne $receiptJsonSha) { throw "Receipt JSON bytes changed during validation." }

foreach ($timestampMutation in @(
    @{ name = "Z publication timestamp"; from = "2026-08-13T20:33:10.2160450+00:00"; to = "2026-08-13T20:33:10.2160450Z" },
    @{ name = "short fractional timestamp"; from = "2026-08-13T20:33:10.2160450+00:00"; to = "2026-08-13T20:33:10.216045+00:00" },
    @{ name = "nonzero offset timestamp"; from = "2026-08-13T20:33:10.2160450+00:00"; to = "2026-08-13T20:33:10.2160450+01:00" },
    @{ name = "completion before start"; from = "2026-08-13T20:35:18.8312542+00:00"; to = "2026-08-13T20:32:18.8312542+00:00" },
    @{ name = "offset created timestamp"; from = $created; to = "2026-08-13T12:00:00+00:00" }
  )) {
  $mutatedJson = $receiptJson.Replace($timestampMutation.from, $timestampMutation.to)
  try {
    $mutatedReceipt = ConvertFrom-PublicationReceiptJson -Json $mutatedJson
    $null = Assert-PublicationReceipt -Receipt $mutatedReceipt -Boundary $boundary -ExpectedRegion $region `
      -ExpectedSourceSha $sourceSha -ExpectedCreated $created
    throw "$($timestampMutation.name) accepted"
  } catch { if ($_.Exception.Message -eq "$($timestampMutation.name) accepted") { throw } }
}
$nonStringTimestampJson = $receiptJson.Replace('"2026-08-13T20:33:10.2160450+00:00"', '123')
try {
  $nonStringTimestampReceipt = ConvertFrom-PublicationReceiptJson -Json $nonStringTimestampJson
  $null = Assert-PublicationReceipt -Receipt $nonStringTimestampReceipt -Boundary $boundary -ExpectedRegion $region `
    -ExpectedSourceSha $sourceSha -ExpectedCreated $created
  throw "non-string publication timestamp accepted"
} catch { if ($_.Exception.Message -eq "non-string publication timestamp accepted") { throw } }
try { $null = ConvertFrom-PublicationReceiptJson -Json ($receiptJson.Substring(0, $receiptJson.Length - 1)); throw "malformed receipt JSON accepted" }
catch { if ($_.Exception.Message -eq "malformed receipt JSON accepted") { throw } }

$utcWholeSecond = [datetime]::SpecifyKind([datetime]"2026-08-13T12:00:00", [DateTimeKind]::Utc)
if ((ConvertTo-CanonicalUtcWholeSecond -Value $utcWholeSecond -Description "test timestamp") -cne $created) {
  throw "UTC whole-second DateTime was not canonicalized."
}
foreach ($badDateTime in @(
    [datetime]::SpecifyKind([datetime]"2026-08-13T12:00:00", [DateTimeKind]::Local),
    [datetime]::SpecifyKind([datetime]"2026-08-13T12:00:00", [DateTimeKind]::Unspecified),
    $utcWholeSecond.AddTicks(1)
  )) {
  try { $null = ConvertTo-CanonicalUtcWholeSecond -Value $badDateTime -Description "test timestamp"; throw "noncanonical DateTime accepted" }
  catch { if ($_.Exception.Message -eq "noncanonical DateTime accepted") { throw } }
}
foreach ($property in @("imageUri", "handoffTag")) {
  $copy = $receipt | Select-Object *
  $copy.$property = if ($property -like "*Sha256") { "5" * 64 } elseif ($property -eq "imageUri") { "$repositoryUri@$($identity.IndexDigest)" } elseif ($property -eq "handoffTag") { "wrong" } else { "sha256:" + ("5" * 64) }
  try { $null = Assert-PublicationReceipt -Receipt $copy -Boundary $boundary -ExpectedRegion $region -ExpectedSourceSha $sourceSha -ExpectedCreated $created; throw "tampered $property accepted" } catch { if ($_.Exception.Message -eq "tampered $property accepted") { throw } }
}

$publishing = $receipt | Select-Object *
$publishing.phase = "publishing"; $publishing.imageUri = ""; $publishing.scanStatus = ""
$publishing.criticalFindings = -1; $publishing.highFindings = -1; $publishing.publicationCompletedAt = ""
foreach ($case in @(
    @{ index = $false; platform = $false; receipt = $false; value = $null; mode = "new-publication" },
    @{ index = $false; platform = $false; receipt = $true; value = $publishing; mode = "resume-push" },
    @{ index = $false; platform = $true; receipt = $true; value = $publishing; mode = "resume-index" },
    @{ index = $true; platform = $true; receipt = $true; value = $publishing; mode = "resume-readback" }
  )) {
  $mode = Resolve-PublicationResumeMode -RemoteIndexExists $case.index -RemotePlatformExists $case.platform -ReceiptExists $case.receipt -Receipt $case.value -Expected $publishing
  if ($mode -cne $case.mode) { throw "recovery mode mismatch" }
}
foreach ($bad in @(
    @{ index = $true; platform = $false; receipt = $true; value = $publishing },
    @{ index = $true; platform = $true; receipt = $false; value = $null },
    @{ index = $false; platform = $true; receipt = $false; value = $null },
    @{ index = $false; platform = $false; receipt = $true; value = ($receipt | Select-Object *) }
  )) {
  try { $null = Resolve-PublicationResumeMode -RemoteIndexExists $bad.index -RemotePlatformExists $bad.platform -ReceiptExists $bad.receipt -Receipt $bad.value -Expected $publishing; throw "unsafe recovery accepted" } catch { if ($_.Exception.Message -eq "unsafe recovery accepted") { throw } }
}

$v1 = $publishing | Select-Object *; $v1.schemaVersion = 1
try { $null = Resolve-PublicationResumeMode -RemoteIndexExists $false -RemotePlatformExists $false -ReceiptExists $true -Receipt $v1 -Expected $publishing; throw "v1 receipt accepted" } catch { if ($_.Exception.Message -eq "v1 receipt accepted") { throw } }

$terraformDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development"))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-migration-image"
$expectedPath = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-migration-image\receipt-test.json") -cne $expectedPath) { throw "operator path rejected" }
try { $null = Resolve-OperatorPath -Candidate "..\outside.json"; throw "traversal accepted" } catch { if ($_.Exception.Message -eq "traversal accepted") { throw } }

$atomicRoot = Join-Path ([IO.Path]::GetTempPath()) ("migration-publisher-atomic-{0}" -f [guid]::NewGuid().ToString("N"))
$atomicPath = Join-Path $atomicRoot "receipt.json"
try {
  $null = New-Item -ItemType Directory -Path $atomicRoot
  [IO.File]::WriteAllText($atomicPath, '{"phase":"publishing"}', [Text.UTF8Encoding]::new($false))
  $locked = [IO.File]::Open($atomicPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    try { Write-JsonFile -Path $atomicPath -Value ([ordered]@{ phase = "verified" }) -AllowReplace; throw "locked replacement accepted" }
    catch { if ($_.Exception.Message -eq "locked replacement accepted") { throw } }
  } finally { $locked.Dispose() }
  if ((Get-Content -LiteralPath $atomicPath -Raw) -cne '{"phase":"publishing"}') { throw "failed finalization damaged receipt" }
  Write-JsonFile -Path $atomicPath -Value ([ordered]@{ phase = "verified" }) -AllowReplace
  if ([string](Get-Content -LiteralPath $atomicPath -Raw | ConvertFrom-Json).phase -cne "verified") { throw "atomic finalization failed" }
} finally {
  if (Test-Path -LiteralPath $atomicRoot -PathType Container) { Remove-Item -LiteralPath $atomicRoot -Recurse -Force }
}

foreach ($required in @(
    '[ValidateSet("LocalBuild", "Status", "Publish", "Verify")]',
    '$requiresCloud = $Action -ne "LocalBuild"', 'AwsContacted            = $false',
    'VulnerabilityScanRun    = $false', 'pnpm contracts:generate',
    '--provenance=false', '--sbom=false', 'rewrite-timestamp=true', 'SOURCE_DATE_EPOCH=$commitEpoch',
    'Get-OciLayoutIdentity', 'Assert-DeterministicOciIdentity', 'Assert-PlatformHandoff',
    '(?:Image)?ScanNotFoundException',
    'oci-layout://', '--network none', '--read-only', '--cap-drop ALL', 'migration-runtime-smoke:ok',
    'jobs/dist/src/search-acceptance.js', 'jobs/dist/src/run-search-acceptance.js',
    'documents/dist/src/run-document-processing-acceptance.js',
    'runner/dist/src/restore-verifier-cli.js', 'runner/restore-manifest.v1.json',
    'jobs/migrations/0008_job_reporting_and_moderation.sql',
    'profile,jobs,documents,matching,billing', 'matching:["0001_saved_jobs.sql"]',
    'billing:["0001_entitlement_projection.sql"]',
    'manifest.contributors.length!==5', 'createRequire', './billing/package.json',
    'schemaVersion     = 2', 'indexDigest', 'platformDigest', 'rootfsDiffIdSetSha256',
    'compressedLayerSetSha256', 'imageUri = "$($boundary.RepositoryUri)@$($readback.PlatformDigest)"',
    'ReviewedReceiptSha256', '[IO.File]::Replace($temporary, $Path, $backup)',
    'TerraformChanged        = $false', 'MigrationExecuted       = $false'
  )) {
  if (-not $source.Contains($required)) { throw "Migration image publisher guard is missing: $required" }
}
$localBuildBranch = $source.IndexOf('if ($Action -eq "LocalBuild")', [StringComparison]::Ordinal)
$backendInitialization = $source.LastIndexOf('Initialize-Backend', [StringComparison]::Ordinal)
if ($localBuildBranch -lt 0 -or $backendInitialization -lt 0 -or $localBuildBranch -gt $backendInitialization) {
  throw "LocalBuild must exit before Terraform-state and AWS-boundary initialization."
}
if (-not $source.Contains('for(const entrypoint of ["jobs/dist/src/search-acceptance.js","jobs/dist/src/run-search-acceptance.js","documents/dist/src/run-document-processing-acceptance.js","runner/dist/src/restore-verifier-cli.js","runner/restore-manifest.v1.json","jobs/migrations/0008_job_reporting_and_moderation.sql"])await access(entrypoint)')) {
  throw "The migration runtime smoke gate does not require the exact acceptance entrypoint set."
}
foreach ($forbidden in @("terraform apply", "ecs run-task", "register-task-definition", "BatchDeleteImage")) {
  if ($source.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "Forbidden operation: $forbidden" }
}

$dockerfile = Get-Content -LiteralPath (Join-Path $repositoryRoot "Dockerfile.migration") -Raw
foreach ($required in @(
  '@ai-job-apply/matching-service build',
  '@ai-job-apply/matching-service deploy --prod --legacy /migration/matching',
  '@ai-job-apply/billing-service build',
  '@ai-job-apply/billing-service deploy --prod --legacy /migration/billing',
  'runner/dist/src/restore-verifier-cli.js',
  'runner/restore-manifest.v1.json',
  'jobs/migrations/0008_job_reporting_and_moderation.sql',
  'restore-verifier-package-smoke:ok',
  'file:///migration/billing/package.json',
  'expected exactly five generated .modules.yaml files'
)) {
  if (-not $dockerfile.Contains($required)) {
    throw "The migration Dockerfile package boundary is missing: $required"
  }
}
$workflow = Get-Content -LiteralPath `
  (Join-Path $repositoryRoot ".github\workflows\publish-environment-images.yml") -Raw
foreach ($required in @(
  'profile,jobs,documents,matching,billing',
  'runner/dist/src/restore-verifier-cli.js',
  'runner/restore-manifest.v1.json',
  'jobs:["0001_job_catalog.sql","0002_duplicate_resolution.sql","0003_duplicate_resolution_audit_guard.sql","0004_job_search.sql","0005_ingestion_orchestration.sql","0006_public_job_reader.sql","0007_matchable_job_attributes.sql","0008_job_reporting_and_moderation.sql"]',
  './billing/package.json',
  'matching:["0001_saved_jobs.sql"]',
  'billing:["0001_entitlement_projection.sql"]'
)) {
  if (-not $workflow.Contains($required)) {
    throw "The hosted migration runtime smoke boundary is missing: $required"
  }
}

Write-Host "Development migration image publisher OCI guard tests passed."
