$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$publisherPath = Join-Path $repositoryRoot "scripts\publish-development-migration-image.ps1"
$source = Get-Content -LiteralPath $publisherPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The development migration image publisher did not parse." }

foreach ($functionName in @(
    "Get-OptionalProperty",
    "Get-TextSha256",
    "ConvertTo-CanonicalUtcWholeSecond",
    "Resolve-OperatorPath",
    "Write-JsonFile",
    "Assert-RepositoryShape",
    "Assert-BuildIdentity",
    "Assert-RemoteImage",
    "Assert-ExactPropertySet",
    "Test-CanonicalUtcTimestamp",
    "Get-CanonicalReceiptPropertyNames",
    "Assert-ResumablePublicationReceipt",
    "Resolve-PublicationResumeMode",
    "Assert-PublicationReceipt"
  )) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq $functionName
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
  repositoryName = $repositoryName
  repositoryUri = $repositoryUri
  repositoryArn = $repositoryArn
  registryId = $account
  imageTagMutability = "IMMUTABLE"
  imageScanningConfiguration = [pscustomobject]@{ scanOnPush = $true }
  encryptionConfiguration = [pscustomobject]@{ encryptionType = "KMS"; kmsKey = $kmsArn }
}
if (-not (Assert-RepositoryShape -Repository $repository -ExpectedName $repositoryName `
      -ExpectedUri $repositoryUri -ExpectedArn $repositoryArn -ExpectedAccount $account `
      -ExpectedRegion $region -ExpectedKmsArn $kmsArn)) {
  throw "The exact hardened repository was not accepted."
}
foreach ($mutation in @(
    @{ property = "imageTagMutability"; value = "MUTABLE" },
    @{ property = "registryId"; value = "999999999999" },
    @{ property = "imageScanningConfiguration"; value = [pscustomobject]@{ scanOnPush = $false } },
    @{ property = "encryptionConfiguration"; value = [pscustomobject]@{ encryptionType = "AES256"; kmsKey = "" } }
  )) {
  $copy = $repository | Select-Object *
  $copy.($mutation.property) = $mutation.value
  $rejected = $false
  try {
    $null = Assert-RepositoryShape -Repository $copy -ExpectedName $repositoryName `
      -ExpectedUri $repositoryUri -ExpectedArn $repositoryArn -ExpectedAccount $account `
      -ExpectedRegion $region -ExpectedKmsArn $kmsArn
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A malformed live repository boundary was accepted." }
}

$sourceSha = "a" * 40
$configDigest = "sha256:" + ("b" * 64)
$created = "2026-08-13T12:00:00Z"
$image = [pscustomobject]@{
  Id = $configDigest
  Os = "linux"
  Architecture = "amd64"
  Created = $created
  Config = [pscustomobject]@{ Labels = [pscustomobject]@{
      'org.opencontainers.image.revision' = $sourceSha
      'org.opencontainers.image.created' = $created
      'org.opencontainers.image.title' = "ai-job-apply-migration"
    } }
  RootFS = [pscustomobject]@{ Layers = @("sha256:$('c' * 64)", "sha256:$('d' * 64)") }
}
$identity = Assert-BuildIdentity -Image $image -ExpectedSourceSha $sourceSha -ExpectedCreated $created
if ($identity.ConfigDigest -cne $configDigest -or $identity.LayerSetSha256 -notmatch '^[a-f0-9]{64}$') {
  throw "The canonical local build identity was not accepted."
}
$powerShellSevenImage = [pscustomobject]@{
  Id = $configDigest
  Os = "linux"
  Architecture = "amd64"
  Created = [DateTime]::SpecifyKind([DateTime]::ParseExact(
      $created, "yyyy-MM-ddTHH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture
    ), [DateTimeKind]::Utc)
  Config = [pscustomobject]@{ Labels = [pscustomobject]@{
      'org.opencontainers.image.revision' = $sourceSha
      'org.opencontainers.image.created' = [DateTime]::SpecifyKind([DateTime]::ParseExact(
          $created, "yyyy-MM-ddTHH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture
        ), [DateTimeKind]::Utc)
      'org.opencontainers.image.title' = "ai-job-apply-migration"
    } }
  RootFS = [pscustomobject]@{ Layers = @("sha256:$('c' * 64)", "sha256:$('d' * 64)") }
}
$powerShellSevenIdentity = Assert-BuildIdentity -Image $powerShellSevenImage `
  -ExpectedSourceSha $sourceSha -ExpectedCreated $created
if ($powerShellSevenIdentity.ConfigDigest -cne $configDigest) {
  throw "The PowerShell 7 UTC DateTime-shaped image timestamps were not normalized."
}
$dockerInspectJson = @"
{
  "Id": "$configDigest",
  "Os": "linux",
  "Architecture": "amd64",
  "Created": "$created",
  "Config": {
    "Labels": {
      "org.opencontainers.image.revision": "$sourceSha",
      "org.opencontainers.image.created": "$created",
      "org.opencontainers.image.title": "ai-job-apply-migration"
    }
  },
  "RootFS": {
    "Layers": ["sha256:$('c' * 64)", "sha256:$('d' * 64)"]
  }
}
"@ | ConvertFrom-Json
$convertedIdentity = Assert-BuildIdentity -Image $dockerInspectJson `
  -ExpectedSourceSha $sourceSha -ExpectedCreated $created
if ($convertedIdentity.ConfigDigest -cne $configDigest) {
  throw "The runtime-specific ConvertFrom-Json image timestamps were not normalized."
}

foreach ($invalidCreated in @(
    [DateTime]::SpecifyKind([DateTime]::Parse("2026-08-13T12:00:00"), [DateTimeKind]::Local),
    [DateTime]::SpecifyKind([DateTime]::Parse("2026-08-13T12:00:00"), [DateTimeKind]::Unspecified),
    [DateTime]::SpecifyKind([DateTime]::Parse("2026-08-13T12:00:00.1000000"), [DateTimeKind]::Utc),
    [DateTimeOffset]::Parse("2026-08-13T12:00:00+00:00"),
    [DateTimeOffset]::Parse("2026-08-13T08:00:00-04:00"),
    "2026-08-13T12:00:00.0000000Z",
    "2026-08-13T12:00:00+00:00",
    "2026-08-13T08:00:00-04:00",
    "2026-02-30T12:00:00Z",
    "10000-01-01T00:00:00Z",
    "not-a-timestamp"
  )) {
  $invalidImageCreated = $powerShellSevenImage | Select-Object *
  $invalidImageCreated.Created = $invalidCreated
  $rejected = $false
  try { $null = Assert-BuildIdentity -Image $invalidImageCreated -ExpectedSourceSha $sourceSha -ExpectedCreated $created }
  catch { $rejected = $true }
  if (-not $rejected) { throw "A noncanonical Image.Created timestamp was accepted: $invalidCreated" }

  $invalidLabelCreated = $powerShellSevenImage | Select-Object *
  $invalidLabelCreated.Config = [pscustomobject]@{ Labels = [pscustomobject]@{
      'org.opencontainers.image.revision' = $sourceSha
      'org.opencontainers.image.created' = $invalidCreated
      'org.opencontainers.image.title' = "ai-job-apply-migration"
    } }
  $rejected = $false
  try { $null = Assert-BuildIdentity -Image $invalidLabelCreated -ExpectedSourceSha $sourceSha -ExpectedCreated $created }
  catch { $rejected = $true }
  if (-not $rejected) { throw "A noncanonical created label timestamp was accepted: $invalidCreated" }
}
foreach ($mutation in @(
    @{ property = "Architecture"; value = "arm64" },
    @{ property = "Os"; value = "windows" },
    @{ property = "Created"; value = "2026-08-13T12:00:01Z" }
  )) {
  $copy = $image | Select-Object *
  $copy.($mutation.property) = $mutation.value
  $rejected = $false
  try { $null = Assert-BuildIdentity -Image $copy -ExpectedSourceSha $sourceSha -ExpectedCreated $created }
  catch { $rejected = $true }
  if (-not $rejected) { throw "A malformed local image identity was accepted." }
}
$wrongLabelImage = $image | Select-Object *
$wrongLabelImage.Config = [pscustomobject]@{ Labels = [pscustomobject]@{
    'org.opencontainers.image.revision' = ("e" * 40)
    'org.opencontainers.image.created' = $created
    'org.opencontainers.image.title' = "ai-job-apply-migration"
  } }
$labelRejected = $false
try { $null = Assert-BuildIdentity -Image $wrongLabelImage -ExpectedSourceSha $sourceSha -ExpectedCreated $created }
catch { $labelRejected = $true }
if (-not $labelRejected) { throw "A source-label substitution was accepted." }

$registryDigest = "sha256:" + ("f" * 64)
$imageDetail = [pscustomobject]@{ imageDigest = $registryDigest; imageTags = @($sourceSha) }
$manifest = [ordered]@{
  schemaVersion = 2
  config = [ordered]@{ digest = $configDigest }
  layers = @([ordered]@{ digest = "sha256:" + ("1" * 64) })
} | ConvertTo-Json -Depth 5 -Compress
$batchImage = [pscustomobject]@{
  imageId = [pscustomobject]@{ imageDigest = $registryDigest }
  imageManifest = $manifest
}
$scan = [pscustomobject]@{
  imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }
  imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{} }
}
$remote = Assert-RemoteImage -ImageDetail $imageDetail -BatchImage $batchImage -Scan $scan `
  -ExpectedTag $sourceSha -ExpectedConfigDigest $configDigest -ExpectedRegistryDigest $registryDigest
if ($remote.RegistryDigest -cne $registryDigest -or $remote.Critical -ne 0 -or $remote.High -ne 0) {
  throw "The canonical immutable remote image was not accepted."
}
foreach ($badScan in @(
    [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "IN_PROGRESS" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{} } },
    [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{ HIGH = 1 } } },
    [pscustomobject]@{ imageScanStatus = [pscustomobject]@{ status = "COMPLETE" }; imageScanFindings = [pscustomobject]@{ findingSeverityCounts = [pscustomobject]@{ CRITICAL = 1 } } }
  )) {
  $rejected = $false
  try {
    $null = Assert-RemoteImage -ImageDetail $imageDetail -BatchImage $batchImage -Scan $badScan `
      -ExpectedTag $sourceSha -ExpectedConfigDigest $configDigest -ExpectedRegistryDigest $registryDigest
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A noncompliant vulnerability scan was accepted." }
}
$wrongManifest = [pscustomobject]@{
  imageId = [pscustomobject]@{ imageDigest = $registryDigest }
  imageManifest = ([ordered]@{
      schemaVersion = 2
      config = [ordered]@{ digest = "sha256:" + ("9" * 64) }
      layers = @([ordered]@{ digest = "sha256:" + ("1" * 64) })
    } | ConvertTo-Json -Depth 5 -Compress)
}
$manifestRejected = $false
try {
  $null = Assert-RemoteImage -ImageDetail $imageDetail -BatchImage $wrongManifest -Scan $scan `
    -ExpectedTag $sourceSha -ExpectedConfigDigest $configDigest -ExpectedRegistryDigest $registryDigest
} catch { $manifestRejected = $true }
if (-not $manifestRejected) { throw "A remote config-digest substitution was accepted." }

$boundary = [pscustomobject]@{
  BoundarySha256 = "2" * 64
  RepositoryName = $repositoryName
  RepositoryUri = $repositoryUri
}
$receipt = [pscustomobject]@{
  schemaVersion = 1
  kind = "development-migration-image-publication"
  environment = "development"
  region = $region
  sourceSha = $sourceSha
  boundarySha256 = $boundary.BoundarySha256
  repositoryName = $repositoryName
  repositoryUri = $repositoryUri
  sourceTag = $sourceSha
  platform = "linux/amd64"
  created = $created
  configDigest = $configDigest
  layerSetSha256 = "3" * 64
  phase = "verified"
  registryDigest = $registryDigest
  imageUri = "$repositoryUri@$registryDigest"
  scanStatus = "COMPLETE"
  criticalFindings = 0
  highFindings = 0
  publicationStartedAt = "2026-08-13T12:00:00.0000000+00:00"
  publicationCompletedAt = "2026-08-13T12:01:00.0000000+00:00"
}
if (-not (Assert-PublicationReceipt -Receipt $receipt -Boundary $boundary `
      -ExpectedRegion $region -ExpectedSourceSha $sourceSha -ExpectedCreated $created)) {
  throw "The exact verified receipt was not accepted."
}
foreach ($mutation in @(
    @{ property = "sourceSha"; value = "4" * 40 },
    @{ property = "boundarySha256"; value = "5" * 64 },
    @{ property = "created"; value = "2026-08-13T12:00:01Z" },
    @{ property = "registryDigest"; value = "sha256:" + ("6" * 64) },
    @{ property = "platform"; value = "linux/arm64" },
    @{ property = "phase"; value = "publishing" },
    @{ property = "publicationCompletedAt"; value = "2026-08-13T11:59:00.0000000+00:00" },
    @{ property = "highFindings"; value = 1 }
  )) {
  $copy = $receipt | Select-Object *
  $copy.($mutation.property) = $mutation.value
  $rejected = $false
  try {
    $null = Assert-PublicationReceipt -Receipt $copy -Boundary $boundary `
      -ExpectedRegion $region -ExpectedSourceSha $sourceSha -ExpectedCreated $created
  } catch { $rejected = $true }
  if (-not $rejected) { throw "A tampered publication receipt was accepted." }
}

$terraformDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development"))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-migration-image"
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-migration-image\receipt-test.json") -cne $expected -or
    (Resolve-OperatorPath -Candidate $expected) -cne $expected) {
  throw "The publisher did not constrain receipts to its ignored operator root."
}
$traversalRejected = $false
try { $null = Resolve-OperatorPath -Candidate "..\outside.json" } catch { $traversalRejected = $true }
if (-not $traversalRejected) { throw "The publisher accepted a path outside its ignored root." }

$publishingReceipt = $receipt | Select-Object *
$publishingReceipt.phase = "publishing"
$publishingReceipt.registryDigest = ""
$publishingReceipt.imageUri = ""
$publishingReceipt.scanStatus = ""
$publishingReceipt.criticalFindings = -1
$publishingReceipt.highFindings = -1
$publishingReceipt.publicationCompletedAt = ""
$expectedPublishing = $publishingReceipt | Select-Object *

$resumeCases = @(
  [pscustomobject]@{ Remote = $false; Exists = $false; Receipt = $null; ExpectedMode = "new-publication" },
  [pscustomobject]@{ Remote = $false; Exists = $true; Receipt = $publishingReceipt; ExpectedMode = "resume-push" },
  [pscustomobject]@{ Remote = $true; Exists = $true; Receipt = $publishingReceipt; ExpectedMode = "resume-readback" }
)
foreach ($case in $resumeCases) {
  $mode = Resolve-PublicationResumeMode -RemoteExists $case.Remote -ReceiptExists $case.Exists `
    -Receipt $case.Receipt -Expected $expectedPublishing
  if ($mode -cne $case.ExpectedMode) { throw "A valid publication/resume state resolved incorrectly." }
}

$malformedReceipt = $publishingReceipt | Select-Object *
$malformedReceipt.sourceTag = "7" * 40
$unexpectedReceipt = $publishingReceipt | Select-Object *, @{ Name = "unexpected"; Expression = { "value" } }
foreach ($invalidCase in @(
    [pscustomobject]@{ Remote = $true; Exists = $false; Receipt = $null },
    [pscustomobject]@{ Remote = $false; Exists = $true; Receipt = $receipt },
    [pscustomobject]@{ Remote = $true; Exists = $true; Receipt = $receipt },
    [pscustomobject]@{ Remote = $false; Exists = $true; Receipt = $malformedReceipt },
    [pscustomobject]@{ Remote = $true; Exists = $true; Receipt = $malformedReceipt },
    [pscustomobject]@{ Remote = $false; Exists = $true; Receipt = $unexpectedReceipt },
    [pscustomobject]@{ Remote = $true; Exists = $true; Receipt = $unexpectedReceipt }
  )) {
  $rejected = $false
  try {
    $null = Resolve-PublicationResumeMode -RemoteExists $invalidCase.Remote `
      -ReceiptExists $invalidCase.Exists -Receipt $invalidCase.Receipt -Expected $expectedPublishing
  } catch { $rejected = $true }
  if (-not $rejected) { throw "An unsafe tag/receipt resume state was accepted." }
}

$atomicRoot = Join-Path ([IO.Path]::GetTempPath()) ("migration-publisher-test-{0}" -f [guid]::NewGuid().ToString("N"))
$atomicPath = Join-Path $atomicRoot "receipt.json"
try {
  $null = New-Item -ItemType Directory -Path $atomicRoot
  [IO.File]::WriteAllText($atomicPath, '{"phase":"publishing"}', [Text.UTF8Encoding]::new($false))
  $locked = [IO.File]::Open($atomicPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    $replaceFailed = $false
    try { Write-JsonFile -Path $atomicPath -Value ([ordered]@{ phase = "verified" }) -AllowReplace }
    catch { $replaceFailed = $true }
    if (-not $replaceFailed) { throw "The locked atomic-finalization failure was not exercised." }
  } finally { $locked.Dispose() }
  if ((Get-Content -LiteralPath $atomicPath -Raw) -cne '{"phase":"publishing"}') {
    throw "Failed receipt finalization damaged the retained publishing receipt."
  }
  if (@(Get-ChildItem -LiteralPath $atomicRoot -Force | Where-Object { $_.Name -like ".*.tmp" }).Count -ne 0) {
    throw "Failed receipt finalization retained a temporary file."
  }
  Write-JsonFile -Path $atomicPath -Value ([ordered]@{ phase = "verified" }) -AllowReplace
  if ([string](Get-Content -LiteralPath $atomicPath -Raw | ConvertFrom-Json).phase -cne "verified") {
    throw "Atomic receipt finalization did not install the complete replacement."
  }
} finally {
  if (Test-Path -LiteralPath $atomicRoot -PathType Container) {
    Remove-Item -LiteralPath $atomicRoot -Recurse -Force
  }
}

foreach ($required in @(
    'ValidateSet("Status", "Publish", "Verify")',
    'clean main checkout exactly matching origin/main',
    'module.platform.aws_ecr_repository.migration',
    'module.platform.aws_kms_key.platform',
    '"--platform", "linux/amd64"',
    '"--provenance=false", "--sbom=false"',
    'SOURCE_DATE_EPOCH=$commitEpoch',
    '"BUILDKIT_MULTI_PLATFORM=1"',
    'First deterministic migration image build',
    'Second deterministic migration image build',
    'docker push "$($boundary.RepositoryUri):$SourceSha"',
    'docker-auth-{0}',
    'Remove-Item -LiteralPath $dockerAuthDirectory -Recurse -Force',
    'failureCode -ceq "ImageNotFound"',
    'kind              = "development-migration-image-publication"',
    'Resolve-PublicationResumeMode',
    '[IO.File]::Replace($temporary, $Path, $backup)',
    'ReviewedReceiptSha256',
    'imageScanStatus.status',
    'TerraformChanged        = $false',
    'MigrationExecuted       = $false'
  )) {
  if (-not $source.Contains($required)) { throw "Migration image publisher guard is missing: $required" }
}

foreach ($forbidden in @("terraform apply", "ecs run-task", "register-task-definition", "BatchDeleteImage")) {
  if ($source.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw "The publisher includes a forbidden deployment or deletion operation: $forbidden"
  }
}

Write-Host "Development migration image publisher pure guard tests passed."
