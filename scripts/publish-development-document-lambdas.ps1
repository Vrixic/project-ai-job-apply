[CmdletBinding()]
param(
  [ValidateSet("Status", "Publish", "Verify")]
  [string]$Action = "Status",

  [ValidateSet("Document", "CoreWorkflow", "Ingestion", "PublicJob", "ApplicationsRecovery", "PrivateDocumentControls", "NativeResume", "NativePreparation", "NativeMaterialControls", "PrivilegedAuditRetention", "JobRetention")]
  [string]$ArtifactFamily = "Document",

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
  .\scripts\publish-development-document-lambdas.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\publish-development-document-lambdas.ps1 -Action Publish `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT

  .\scripts\publish-development-document-lambdas.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -ReceiptPath .terraform/development-document-artifacts/receipt-....json `
    -ReviewedReceiptSha256 64_CHARACTER_SHA256

Status is read-only. Publish is the explicit GitHub Actions-budget fallback and is the only action
that writes S3 objects. It runs the selected artifact-family tests, the centralized dependency
audit, two deterministic builds, and every bucket/artifact guard before writing the exact immutable
object set. Verify performs an independent exact-version readback. No action deploys Lambda code or
enables a trigger.

PrivateDocumentControls is a separate four-artifact/sixteen-object family for the private
provider-control, response-capture, maintenance-fence and response-disposal entrypoints. It uses dedicated local
output, receipt and immutable key roots; it never extends an existing Document receipt. Select
it only for separately authorized publication. Building or publishing does not authenticate,
deploy or activate these default-off controls.

NativeResume selects six private artifacts/twenty-four objects: owner RPC, retained-source RPC,
preparation control, durable preparation, request dispatcher and task observer. Dedicated output/key/receipt
roots preserve existing families. Publication does not deploy task images, configure IAM/TLS
or enable processing.

NativeMaterialControls selects three artifacts/twelve objects: original launcher, owner RPC and task-event recovery.
NativePreparation selects four artifacts/sixteen objects: native activity, durable workflow,
SQS starter and dual-handler recovery. Its dedicated roots match the native application
preparation Terraform module. Publication does not create runtime resources or enable intake.

PrivilegedAuditRetention selects the private Profile expiry artifact and four companion objects.
It uses dedicated output/key/receipt roots and does not activate audit capture or expiry.

JobRetention selects one private Jobs expiry artifact/four objects without enabling maintenance.

Receipts and command logs remain below the ignored development .terraform directory. Do not copy
account IDs, bucket names, KMS identifiers, raw object content, or command logs into shared evidence.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development artifact publication is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$isCoreWorkflow = $ArtifactFamily -ceq "CoreWorkflow"
$isIngestion = $ArtifactFamily -ceq "Ingestion"
$isPublicJob = $ArtifactFamily -ceq "PublicJob"
$isApplicationsRecovery = $ArtifactFamily -ceq "ApplicationsRecovery"
# Match ValidateSet's case-insensitive binding; never fall back to parser/processor artifacts.
$isPrivateDocumentControls = $ArtifactFamily -eq "PrivateDocumentControls"
$isNativeResume = $ArtifactFamily -eq "NativeResume"
$isNativePreparation = $ArtifactFamily -eq "NativePreparation"
$isNativeMaterialControls = $ArtifactFamily -eq "NativeMaterialControls"
$isPrivilegedAuditRetention = $ArtifactFamily -eq "PrivilegedAuditRetention"
$isJobRetention = $ArtifactFamily -eq "JobRetention"
$operatorDirectoryName = if ($isCoreWorkflow) {
  "development-workflow-artifacts"
} elseif ($isIngestion) {
  "development-ingestion-artifacts"
} elseif ($isPublicJob) {
  "development-public-job-artifacts"
} elseif ($isApplicationsRecovery) {
  "development-applications-recovery-artifacts"
} elseif ($isPrivateDocumentControls) {
  "development-private-document-control-artifacts"
} elseif ($isNativeMaterialControls) {
  "development-native-material-controls-artifacts"
} elseif ($isNativePreparation) {
  "development-native-preparation-artifacts"
} elseif ($isNativeResume) {
  "development-native-resume-artifacts"
} elseif ($isPrivilegedAuditRetention) {
  "development-privileged-audit-retention-artifacts"
} elseif ($isJobRetention) {
  "development-job-retention-artifacts"
} else {
  "development-document-artifacts"
}
$operatorRoot = Join-Path $terraformRoot $operatorDirectoryName
$terraformDataDirectory = Join-Path $terraformRoot "$operatorDirectoryName-data"
$artifactDirectory = if ($isCoreWorkflow -or $isIngestion -or $isApplicationsRecovery) {
  Join-Path $repositoryRoot "backend\workflows\dist\lambda"
} elseif ($isPublicJob) {
  Join-Path $repositoryRoot "backend\gateway\dist\public-job-lambda"
} elseif ($isPrivateDocumentControls) {
  Join-Path $repositoryRoot "backend\services\documents\dist\private-control-lambda"
} elseif ($isNativeMaterialControls) {
  Join-Path $repositoryRoot "backend/workflows/dist/native-material-control-family"
} elseif ($isNativePreparation) {
  Join-Path $repositoryRoot "backend/workflows/dist/native-preparation-family"
} elseif ($isNativeResume) {
  Join-Path $repositoryRoot "backend/workflows/dist/native-resume-lambda"
} elseif ($isPrivilegedAuditRetention) {
  Join-Path $repositoryRoot "backend/services/profile/dist/audit-retention-lambda"
} elseif ($isJobRetention) {
  Join-Path $repositoryRoot "backend/workflows/dist/job-retention-lambda"
} else {
  Join-Path $repositoryRoot "backend\services\documents\dist\lambda"
}
$stateKey = "platform.tfstate"
$artifactNames = @(
  if ($isCoreWorkflow) {
    @("workflow-ingress-lambda", "profile-readiness-durable-lambda", "profile-readiness-activity-lambda")
  } elseif ($isIngestion) {
    @("ingestion-durable-lambda", "ingestion-runtime-lambda")
  } elseif ($isPublicJob) {
    @("public-job-edge-lambda", "public-job-projection-lambda")
  } elseif ($isApplicationsRecovery) {
    @("applications-attempt-recovery-lambda")
  } elseif ($isPrivateDocumentControls) {
    @("cover-letter-provider-control-lambda", "cover-letter-response-capture-lambda", "cover-letter-cleanup-lambda", "cover-letter-response-disposal-lambda")
  } elseif ($isNativeMaterialControls) {
    @("native-material-launch-lambda", "native-owner-rpc-lambda", "native-material-task-event-lambda")
} elseif ($isNativePreparation) {
    @("native-application-preparation-lambda", "application-preparation-durable-lambda", "application-preparation-starter-lambda", "application-preparation-recovery-lambda")
  } elseif ($isNativeResume) {
    @("native-resume-owner-rpc-lambda", "native-resume-source-rpc-lambda", "native-resume-preparation-control-lambda", "native-resume-preparation-durable-lambda", "native-resume-request-dispatch-lambda", "native-resume-task-observer-lambda")
  } elseif ($isPrivilegedAuditRetention) {
    @("privileged-moderation-audit-retention-lambda")
  } elseif ($isJobRetention) {
    @("job-retention-lambda")
  } else {
    @("document-processor-lambda", "document-parser-lambda")
  }
)
$artifactKeyRoot = if ($isCoreWorkflow) {
  "lambda/workflows"
} elseif ($isIngestion) {
  "lambda/ingestion"
} elseif ($isPublicJob) {
  "lambda/public-jobs"
} elseif ($isApplicationsRecovery) {
  "lambda/applications"
} elseif ($isPrivateDocumentControls) {
  "lambda/documents/private-controls"
} elseif ($isNativeMaterialControls) {
  "lambda/documents/native-material/control"
} elseif ($isNativePreparation) {
  "lambda/applications/native-preparation"
} elseif ($isNativeResume) {
  "lambda/documents/native-resume"
} elseif ($isPrivilegedAuditRetention) {
  "lambda/profile/audit-retention"
} elseif ($isJobRetention) {
  "lambda/jobs/retention"
} else {
  "lambda/documents"
}
$receiptKind = if ($isCoreWorkflow) {
  "development-core-workflow-lambda-publication"
} elseif ($isIngestion) {
  "development-ingestion-lambda-publication"
} elseif ($isPublicJob) {
  "development-public-job-lambda-publication"
} elseif ($isApplicationsRecovery) {
  "development-applications-recovery-lambda-publication"
} elseif ($isPrivateDocumentControls) {
  "development-private-document-controls-lambda-publication"
} elseif ($isNativeMaterialControls) {
  "development-native-material-controls-lambda-publication"
} elseif ($isNativePreparation) {
  "development-native-preparation-lambda-publication"
} elseif ($isNativeResume) {
  "development-native-resume-lambda-publication"
} elseif ($isPrivilegedAuditRetention) {
  "development-privileged-audit-retention-lambda-publication"
} elseif ($isJobRetention) {
  "development-job-retention-lambda-publication"
} else {
  "development-document-lambda-publication"
}
$artifactLabel = if ($isCoreWorkflow) {
  "core workflow"
} elseif ($isIngestion) {
  "ingestion"
} elseif ($isPublicJob) {
  "public job"
} elseif ($isApplicationsRecovery) {
  "applications recovery"
} elseif ($isPrivateDocumentControls) {
  "private document controls"
} elseif ($isNativeMaterialControls) {
  "native material controls"
} elseif ($isNativePreparation) {
  "native preparation"
} elseif ($isNativeResume) {
  "native resume"
} elseif ($isPrivilegedAuditRetention) {
  "privileged audit retention"
} elseif ($isJobRetention) {
  "job retention"
} else {
  "document"
}
$expectedObjectCount = $artifactNames.Count * 4

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

function Invoke-TerraformJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & terraform "-chdir=$terraformDirectory" @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "$Operation returned invalid JSON." }
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FileBase64Sha256 {
  param([Parameter(Mandatory)][string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function Resolve-OperatorPath {
  param([Parameter(Mandatory)][string]$Candidate, [switch]$MustExist)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw "A required operator path is missing." }
  $candidatePath = if ([IO.Path]::IsPathRooted($Candidate)) { $Candidate } else { Join-Path $terraformDirectory $Candidate }
  $resolved = [IO.Path]::GetFullPath($candidatePath)
  $root = [IO.Path]::GetFullPath($operatorRoot)
  $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Publication artifacts must stay below the ignored development artifact directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "A required publication artifact does not exist."
  }
  return $resolved
}

function Write-JsonFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value, [switch]$AllowReplace)
  if ((Test-Path -LiteralPath $Path) -and -not $AllowReplace) { throw "Refusing to replace an existing publication receipt." }
  $parent = Split-Path -Parent $Path
  $null = New-Item -ItemType Directory -Path $parent -Force
  $temporary = Join-Path $parent (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($Path), [guid]::NewGuid().ToString("N"))
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force:$AllowReplace
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Add-ManagedResources {
  param(
    [AllowNull()][object]$Module,
    [Parameter(Mandatory)][Collections.Generic.Dictionary[string, object]]$Destination
  )
  if ($null -eq $Module) { return }
  foreach ($resource in @(Get-OptionalProperty $Module "resources")) {
    if ($null -ne $resource -and [string]$resource.mode -ceq "managed") {
      $Destination[[string]$resource.address] = $resource
    }
  }
  foreach ($child in @(Get-OptionalProperty $Module "child_modules")) {
    Add-ManagedResources -Module $child -Destination $Destination
  }
}

function Assert-CallerToolsAndSource {
  param([switch]$RequireExplicitSource)
  $identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--output", "json") -Operation "AWS caller validation"
  if ([string]$identity.Account -cne $ExpectedAccountId) { throw "The AWS caller is not the exact development account." }
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use a temporary development IAM Identity Center session; long-lived callers are rejected."
  }
  Assert-DeploymentTerraformCli
  $nodeVersion = (& node --version 2>$null).Trim()
  $pnpmVersion = (& pnpm --version 2>$null).Trim()
  if ($nodeVersion -notmatch '^v24\.' -or $pnpmVersion -cne "10.24.0") {
    throw "Node.js 24 and pnpm 10.24.0 are required."
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
      -not [string]::IsNullOrWhiteSpace([string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID) -and
      $_.BucketKeyEnabled
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

function Resolve-ArtifactBoundary {
  $state = Invoke-TerraformJson -Arguments @("show", "-json") -Operation "Terraform state inspection"
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  Add-ManagedResources -Module $state.values.root_module -Destination $resources
  $bucketAddress = "module.platform.aws_s3_bucket.artifacts"
  $kmsAddress = "module.platform.aws_kms_key.platform"
  if (-not $resources.ContainsKey($bucketAddress) -or -not $resources.ContainsKey($kmsAddress)) {
    throw "Terraform state does not own the required development artifact bucket and platform KMS key."
  }
  $bucket = [string]$resources[$bucketAddress].values.bucket
  $kmsArn = [string]$resources[$kmsAddress].values.arn
  $outputBucket = [string](Invoke-TerraformJson -Arguments @("output", "-json", "artifact_bucket") -Operation "Artifact bucket output validation")
  if ([string]::IsNullOrWhiteSpace($bucket) -or $bucket -cne $outputBucket -or
      $kmsArn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/") {
    throw "The artifact output does not match the exact Terraform-owned bucket/KMS boundary."
  }
  $location = Invoke-AwsJson -Arguments @("s3api", "get-bucket-location", "--bucket", $bucket, "--output", "json") -Operation "Artifact bucket region validation"
  if ([string]$location.LocationConstraint -cne $Region) { throw "The artifact bucket is outside us-east-2." }
  $versioning = Invoke-AwsJson -Arguments @("s3api", "get-bucket-versioning", "--bucket", $bucket, "--output", "json") -Operation "Artifact bucket versioning validation"
  if ([string]$versioning.Status -cne "Enabled") { throw "The artifact bucket must have versioning enabled." }
  $public = Invoke-AwsJson -Arguments @("s3api", "get-public-access-block", "--bucket", $bucket, "--output", "json") -Operation "Artifact bucket public-access validation"
  $block = $public.PublicAccessBlockConfiguration
  if (-not ($block.BlockPublicAcls -and $block.IgnorePublicAcls -and $block.BlockPublicPolicy -and $block.RestrictPublicBuckets)) {
    throw "The artifact bucket must block every public-access path."
  }
  $encryption = Invoke-AwsJson -Arguments @("s3api", "get-bucket-encryption", "--bucket", $bucket, "--output", "json") -Operation "Artifact bucket encryption validation"
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and
      [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -ceq $kmsArn -and $_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) { throw "The artifact bucket does not use the exact Terraform platform KMS key with S3 Bucket Keys." }
  $key = Invoke-AwsJson -Arguments @("kms", "describe-key", "--key-id", $kmsArn, "--output", "json") -Operation "Artifact KMS validation"
  if ([string]$key.KeyMetadata.Arn -cne $kmsArn -or [string]$key.KeyMetadata.KeyManager -cne "CUSTOMER" -or
      [string]$key.KeyMetadata.KeyState -cne "Enabled" -or -not $key.KeyMetadata.Enabled -or
      [string]$key.KeyMetadata.KeyUsage -cne "ENCRYPT_DECRYPT") {
    throw "The Terraform platform KMS key is not an enabled customer-managed encryption key."
  }
  return [pscustomobject]@{ Bucket = $bucket; KmsArn = $kmsArn }
}

function Invoke-LocalGate {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Command, [Parameter(Mandatory)][string]$LogPath)
  & $Command *> $LogPath
  if ($LASTEXITCODE -ne 0) { throw "$Name failed. Inspect the ignored local log." }
}

function Assert-BundleSourceMarker {
  param([Parameter(Mandatory)][string]$ZipPath, [Parameter(Mandatory)][string]$ExpectedSourceSha)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entries = @($archive.Entries | Where-Object { [string]$_.FullName -ceq "index.mjs" })
    if ($entries.Count -ne 1) { throw "The Lambda ZIP does not contain exactly one index.mjs." }
    $reader = New-Object IO.StreamReader($entries[0].Open(), [Text.Encoding]::UTF8, $true)
    try { $source = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if (-not $source.Contains("/* applydash-artifact-source:$ExpectedSourceSha */")) {
      throw "The Lambda bundle does not attest to the exact merged source commit."
    }
  } finally { $archive.Dispose() }
}

function Assert-ChecksumCompanion {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][string]$ExpectedDigest,
    [Parameter(Mandatory)][string]$ExpectedFileName
  )
  if ($ExpectedDigest -notmatch '^[a-f0-9]{64}$' -or
      $ExpectedFileName -notmatch '^[a-z0-9-]+\.zip$') {
    throw "The expected checksum companion identity is invalid."
  }
  $normalized = $Text.Replace("`r`n", "`n")
  if ($normalized.Contains("`r")) { throw "The checksum companion contains an invalid line ending." }
  if ($normalized.EndsWith("`n", [StringComparison]::Ordinal)) {
    $normalized = $normalized.Substring(0, $normalized.Length - 1)
  }
  if ($normalized.Contains("`n") -or $normalized -cne "$ExpectedDigest  $ExpectedFileName") {
    throw "The checksum companion must contain the exact digest, two spaces, and exact ZIP filename."
  }
  return $true
}

function Get-ArtifactSet {
  param([Parameter(Mandatory)][string]$ExpectedSourceSha)
  $result = @()
  foreach ($name in $artifactNames) {
    $files = [ordered]@{}
    foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
      $path = Join-Path $artifactDirectory "$name.$suffix"
      if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -le 0) {
        throw "A required $artifactLabel Lambda artifact is missing or empty."
      }
      $files[$suffix] = [pscustomobject]@{
        Path         = $path
        Sha256       = Get-FileSha256 -Path $path
        Base64Sha256 = Get-FileBase64Sha256 -Path $path
        Length       = (Get-Item -LiteralPath $path).Length
      }
    }
    $manifest = Get-Content -LiteralPath $files["manifest.json"].Path -Raw | ConvertFrom-Json
    $sbom = Get-Content -LiteralPath $files["cdx.json"].Path -Raw | ConvertFrom-Json
    $checksumText = Get-Content -LiteralPath $files["sha256"].Path -Raw
    $checksumValid = Assert-ChecksumCompanion -Text $checksumText `
      -ExpectedDigest $files["zip"].Sha256 -ExpectedFileName "$name.zip"
    if ([int]$manifest.schemaVersion -ne 2 -or [string]$manifest.sourceSha -cne $ExpectedSourceSha -or
        [string]$manifest.artifactSha256 -cne $files["zip"].Sha256 -or
        [string]$manifest.artifactBase64Sha256 -cne $files["zip"].Base64Sha256 -or
        -not $checksumValid -or [string]$sbom.bomFormat -cne "CycloneDX" -or
        [string]$sbom.specVersion -cne "1.6") {
      throw "A $artifactLabel Lambda manifest, checksum, or CycloneDX SBOM failed validation."
    }
    Assert-BundleSourceMarker -ZipPath $files["zip"].Path -ExpectedSourceSha $ExpectedSourceSha
    $result += [pscustomobject]@{ Name = $name; ArtifactSha256 = $files["zip"].Sha256; Files = $files }
  }
  return $result
}

function Get-ArtifactFingerprint {
  param([Parameter(Mandatory)][object[]]$Artifacts)
  return @($Artifacts | ForEach-Object {
      $artifact = $_
      @("zip", "cdx.json", "manifest.json", "sha256") | ForEach-Object {
        "$($artifact.Name)|$_|$($artifact.Files[$_].Sha256)"
      }
    }) -join "`n"
}

function Get-KeyHistoryMatches {
  param([AllowNull()][object]$Result, [Parameter(Mandatory)][string]$Key)
  $versions = @(Get-OptionalProperty -Object $Result -Name "Versions")
  $deleteMarkers = @(Get-OptionalProperty -Object $Result -Name "DeleteMarkers")
  return @(@($versions + $deleteMarkers) | Where-Object {
      $null -ne $_ -and [string](Get-OptionalProperty -Object $_ -Name "Key") -ceq $Key
    })
}

function Assert-KeyAbsent {
  param([Parameter(Mandatory)][string]$Bucket, [Parameter(Mandatory)][string]$Key)
  $result = Invoke-AwsJson -Arguments @(
    "s3api", "list-object-versions", "--bucket", $Bucket, "--prefix", $Key, "--max-keys", "20", "--output", "json"
  ) -Operation "Immutable destination validation"
  $matches = @(Get-KeyHistoryMatches -Result $result -Key $Key)
  if ($matches.Count -ne 0) { throw "An immutable destination key or delete marker already exists." }
}

function Assert-StoredObject {
  param(
    [Parameter(Mandatory)][object]$Boundary,
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$VersionId,
    [Parameter(Mandatory)][string]$ExpectedObjectBase64Sha256,
    [Parameter(Mandatory)][string]$ArtifactSha256,
    [Parameter(Mandatory)][long]$ExpectedLength
  )
  $head = Invoke-AwsJson -Arguments @(
    "s3api", "head-object", "--bucket", $Boundary.Bucket, "--key", $Key, "--version-id", $VersionId,
    "--checksum-mode", "ENABLED", "--output", "json"
  ) -Operation "Published object readback"
  if ([string]$head.VersionId -cne $VersionId -or [long]$head.ContentLength -ne $ExpectedLength -or
      [string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne $Boundary.KmsArn -or
      -not $head.BucketKeyEnabled -or [string]$head.ChecksumSHA256 -cne $ExpectedObjectBase64Sha256 -or
      [string]$head.Metadata.'source-sha' -cne $SourceSha -or
      [string]$head.Metadata.'artifact-sha256' -cne $ArtifactSha256) {
    throw "A published object failed exact-version KMS, checksum, metadata, or length readback."
  }
}

function Assert-CanonicalReceiptMatrix {
  param(
    [AllowNull()][object[]]$Artifacts,
    [Parameter(Mandatory)][string[]]$ExpectedArtifactNames
  )
  $requiredObjectCount = $ExpectedArtifactNames.Count * 4
  if (@($Artifacts).Count -ne $requiredObjectCount) {
    throw "The canonical publication receipt has an invalid object count."
  }
  foreach ($artifactName in $ExpectedArtifactNames) {
    $entries = @($Artifacts | Where-Object { [string]$_.artifactName -ceq $artifactName })
    $suffixes = @($entries | ForEach-Object { [string]$_.suffix } | Sort-Object -Unique)
    $digests = @($entries | ForEach-Object { [string]$_.artifactSha256 } | Sort-Object -Unique)
    if ($entries.Count -ne 4 -or ($suffixes -join ',') -cne "cdx.json,manifest.json,sha256,zip" -or
        $digests.Count -ne 1 -or [string]$digests[0] -notmatch '^[a-f0-9]{64}$') {
      throw "The canonical receipt must contain one ZIP, manifest, SBOM, and checksum for each artifact digest."
    }
  }
  if (@($Artifacts | Where-Object { [string]$_.artifactName -notin $ExpectedArtifactNames }).Count -ne 0) {
    throw "The canonical receipt contains an unknown artifact name."
  }
  return $true
}

function Read-AndValidateReceipt {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][object]$Boundary)
  if ((Get-FileSha256 -Path $Path) -cne $Sha256) { throw "The publication receipt checksum does not match the reviewed value." }
  $receipt = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $binding = Get-TextSha256 -Value "$ExpectedAccountId|$Region|$($Boundary.Bucket)|$($Boundary.KmsArn)"
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne $receiptKind -or
      [string]$receipt.environment -cne "development" -or [string]$receipt.region -cne $Region -or
      [string]$receipt.sourceSha -cne $SourceSha -or [string]$receipt.boundarySha256 -cne $binding -or
      [string]$receipt.phase -cne "verified" -or @($receipt.artifacts).Count -ne $expectedObjectCount) {
    throw "The publication receipt does not match the exact reviewed environment and release."
  }
  $null = Assert-CanonicalReceiptMatrix -Artifacts @($receipt.artifacts) `
    -ExpectedArtifactNames $artifactNames
  return $receipt
}

$headSha = Assert-CallerToolsAndSource -RequireExplicitSource:($Action -ne "Status")
Initialize-Backend
$boundary = Resolve-ArtifactBoundary

if ($Action -eq "Status") {
  [pscustomobject]@{
    Environment               = "development"
    Region                    = $Region
    SourceSha                 = $headSha
    TerraformOwnedBucket      = $true
    CustomerKmsEncrypted      = $true
    BucketVersioningEnabled   = $true
    PublicAccessBlocked       = $true
    PublishedObjectCount      = 0
    LambdaDeploymentChanged   = $false
    TriggerChanged            = $false
  }
  exit 0
}

if ($Action -eq "Publish") {
  $null = New-Item -ItemType Directory -Path $operatorRoot -Force
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $testLog = Join-Path $operatorRoot "$artifactLabel-tests-$timestamp.log"
  $auditLog = Join-Path $operatorRoot "dependency-audit-$timestamp.log"
  $buildOneLog = Join-Path $operatorRoot "build-one-$timestamp.log"
  $buildTwoLog = Join-Path $operatorRoot "build-two-$timestamp.log"
  if ($isCoreWorkflow -or $isIngestion -or $isApplicationsRecovery -or $isNativeResume -or $isNativePreparation -or $isNativeMaterialControls -or $isJobRetention) {
    Invoke-LocalGate -Name "Workflow tests" -LogPath $testLog -Command {
      pnpm --filter @ai-job-apply/workflows test
    }
  } elseif ($isPrivilegedAuditRetention) {
    Invoke-LocalGate -Name "Profile tests" -LogPath $testLog -Command {
      pnpm --filter @ai-job-apply/profile-service test
    }
  } elseif ($isPublicJob) {
    Invoke-LocalGate -Name "Gateway tests" -LogPath $testLog -Command {
      pnpm --filter @ai-job-apply/gateway test
    }
  } else {
    Invoke-LocalGate -Name "Document service tests" -LogPath $testLog -Command {
      pnpm --filter @ai-job-apply/documents-service test
    }
  }
  Invoke-LocalGate -Name "Dependency audit" -LogPath $auditLog -Command { pnpm audit:dependencies }
  $previousSource = $env:ARTIFACT_SOURCE_SHA
  try {
    $env:ARTIFACT_SOURCE_SHA = $SourceSha
    Invoke-LocalGate -Name "First $artifactLabel Lambda build" -LogPath $buildOneLog -Command {
      if ($isCoreWorkflow) { pnpm --filter @ai-job-apply/workflows build:lambda }
      elseif ($isIngestion) { pnpm --filter @ai-job-apply/workflows build:lambda:ingestion }
      elseif ($isPublicJob) { pnpm --filter @ai-job-apply/gateway build:public-job-lambda }
      elseif ($isApplicationsRecovery) { pnpm --filter @ai-job-apply/workflows build:lambda:applications-attempt-recovery }
      elseif ($isPrivateDocumentControls) { pnpm --filter @ai-job-apply/documents-service build:lambda:private-controls }
      elseif ($isNativeMaterialControls) { pnpm --filter @ai-job-apply/workflows build:lambda:native-material-control-family }
      elseif ($isNativePreparation) { pnpm --filter @ai-job-apply/workflows build:lambda:native-preparation-family }
      elseif ($isNativeResume) { pnpm --filter @ai-job-apply/workflows build:lambda:native-resume }
      elseif ($isPrivilegedAuditRetention) { pnpm --filter @ai-job-apply/profile-service build:lambda:audit-retention }
      elseif ($isJobRetention) { pnpm --filter @ai-job-apply/workflows build:lambda:job-retention }
      else { pnpm --filter @ai-job-apply/documents-service build:lambda }
    }
    $first = @(Get-ArtifactSet -ExpectedSourceSha $SourceSha)
    $firstFingerprint = Get-ArtifactFingerprint -Artifacts $first
    Invoke-LocalGate -Name "Second $artifactLabel Lambda build" -LogPath $buildTwoLog -Command {
      if ($isCoreWorkflow) { pnpm --filter @ai-job-apply/workflows build:lambda }
      elseif ($isIngestion) { pnpm --filter @ai-job-apply/workflows build:lambda:ingestion }
      elseif ($isPublicJob) { pnpm --filter @ai-job-apply/gateway build:public-job-lambda }
      elseif ($isApplicationsRecovery) { pnpm --filter @ai-job-apply/workflows build:lambda:applications-attempt-recovery }
      elseif ($isPrivateDocumentControls) { pnpm --filter @ai-job-apply/documents-service build:lambda:private-controls }
      elseif ($isNativeMaterialControls) { pnpm --filter @ai-job-apply/workflows build:lambda:native-material-control-family }
      elseif ($isNativePreparation) { pnpm --filter @ai-job-apply/workflows build:lambda:native-preparation-family }
      elseif ($isNativeResume) { pnpm --filter @ai-job-apply/workflows build:lambda:native-resume }
      elseif ($isPrivilegedAuditRetention) { pnpm --filter @ai-job-apply/profile-service build:lambda:audit-retention }
      elseif ($isJobRetention) { pnpm --filter @ai-job-apply/workflows build:lambda:job-retention }
      else { pnpm --filter @ai-job-apply/documents-service build:lambda }
    }
    $second = @(Get-ArtifactSet -ExpectedSourceSha $SourceSha)
    $secondFingerprint = Get-ArtifactFingerprint -Artifacts $second
  } finally {
    if ($null -eq $previousSource) { Remove-Item Env:\ARTIFACT_SOURCE_SHA -ErrorAction SilentlyContinue }
    else { $env:ARTIFACT_SOURCE_SHA = $previousSource }
  }
  if ($firstFingerprint -cne $secondFingerprint) {
    throw "The two $artifactLabel Lambda builds were not byte-for-byte reproducible."
  }

  $objects = @()
  foreach ($artifact in $second) {
    $prefix = "$artifactKeyRoot/$SourceSha/$($artifact.ArtifactSha256)"
    foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
      $file = $artifact.Files[$suffix]
      $key = "$prefix/$($artifact.Name).$suffix"
      Assert-KeyAbsent -Bucket $boundary.Bucket -Key $key
      $objects += [pscustomobject]@{
        ArtifactName = $artifact.Name
        ArtifactSha256 = $artifact.ArtifactSha256
        Suffix = $suffix
        Key = $key
        Path = $file.Path
        Sha256 = $file.Sha256
        Base64Sha256 = $file.Base64Sha256
        Length = $file.Length
      }
    }
  }
  if ($objects.Count -ne $expectedObjectCount) {
    throw "Publication contains an invalid immutable release-object count."
  }

  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0, 12))-$timestamp.json"
  }
  $receipt = Resolve-OperatorPath -Candidate $ReceiptPath
  if (Test-Path -LiteralPath $receipt) { throw "Refusing to replace an existing publication receipt." }
  $receiptValue = [ordered]@{
    schemaVersion  = 1
    kind           = $receiptKind
    environment    = "development"
    region         = $Region
    sourceSha      = $SourceSha
    boundarySha256 = Get-TextSha256 -Value "$ExpectedAccountId|$Region|$($boundary.Bucket)|$($boundary.KmsArn)"
    phase          = "publishing"
    createdAt      = (Get-Date).ToUniversalTime().ToString("o")
    artifacts      = @($objects | ForEach-Object {
        [ordered]@{
          artifactName       = $_.ArtifactName
          artifactSha256     = $_.ArtifactSha256
          suffix             = $_.Suffix
          key                = $_.Key
          versionId          = ""
          objectSha256       = $_.Sha256
          objectBase64Sha256 = $_.Base64Sha256
          contentLength      = $_.Length
        }
      })
  }
  Write-JsonFile -Path $receipt -Value $receiptValue

  foreach ($object in $objects) {
    $put = Invoke-AwsJson -Arguments @(
      "s3api", "put-object", "--bucket", $boundary.Bucket, "--key", $object.Key,
      "--body", $object.Path, "--checksum-algorithm", "SHA256", "--checksum-sha256", $object.Base64Sha256,
      "--metadata", "source-sha=$SourceSha,artifact-sha256=$($object.ArtifactSha256)",
      "--if-none-match", "*", "--output", "json"
    ) -Operation "Immutable $artifactLabel Lambda object publication"
    $versionId = [string]$put.VersionId
    if ([string]::IsNullOrWhiteSpace($versionId) -or $versionId -ceq "null") {
      throw "S3 did not return an immutable object version."
    }
    $receiptEntry = @($receiptValue.artifacts | Where-Object { [string]$_.key -ceq $object.Key })
    if ($receiptEntry.Count -ne 1) { throw "The publication receipt lost its exact planned object entry." }
    $receiptEntry[0].versionId = $versionId
    Write-JsonFile -Path $receipt -Value $receiptValue -AllowReplace
    Assert-StoredObject -Boundary $boundary -Key $object.Key -VersionId $versionId `
      -ExpectedObjectBase64Sha256 $object.Base64Sha256 -ArtifactSha256 $object.ArtifactSha256 `
      -ExpectedLength $object.Length
  }
  $receiptValue.phase = "verified"
  $receiptValue.completedAt = (Get-Date).ToUniversalTime().ToString("o")
  Write-JsonFile -Path $receipt -Value $receiptValue -AllowReplace
  [pscustomobject]@{
    Outcome                 = "published-and-verified"
    SourceSha               = $SourceSha
    ReceiptPath             = $receipt
    ReceiptSha256           = Get-FileSha256 -Path $receipt
    ArtifactCount           = $artifactNames.Count
    PublishedObjectCount    = $expectedObjectCount
    DeterministicBuildCount = 2
    LambdaDeploymentChanged = $false
    TriggerChanged          = $false
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ReceiptPath) -or $ReviewedReceiptSha256 -notmatch '^[a-f0-9]{64}$') {
  throw "Verify requires the exact publication receipt and its reviewed SHA-256."
}
$receipt = Resolve-OperatorPath -Candidate $ReceiptPath -MustExist
$receiptValue = Read-AndValidateReceipt -Path $receipt -Sha256 $ReviewedReceiptSha256 -Boundary $boundary
$uniqueKeys = @($receiptValue.artifacts | ForEach-Object { [string]$_.key } | Sort-Object -Unique)
if ($uniqueKeys.Count -ne $expectedObjectCount) { throw "The publication receipt contains duplicate keys." }
foreach ($object in $receiptValue.artifacts) {
  if ([string]$object.artifactName -notin $artifactNames -or
      [string]$object.artifactSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$object.suffix -notin @("zip", "cdx.json", "manifest.json", "sha256") -or
      [string]$object.objectSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]::IsNullOrWhiteSpace([string]$object.versionId) -or [long]$object.contentLength -le 0 -or
      [string]$object.key -cne "$artifactKeyRoot/$SourceSha/$($object.artifactSha256)/$($object.artifactName).$($object.suffix)") {
    throw "The publication receipt contains an invalid artifact entry."
  }
  Assert-StoredObject -Boundary $boundary -Key ([string]$object.key) -VersionId ([string]$object.versionId) `
    -ExpectedObjectBase64Sha256 ([string]$object.objectBase64Sha256) `
    -ArtifactSha256 ([string]$object.artifactSha256) -ExpectedLength ([long]$object.contentLength)
}
[pscustomobject]@{
  Outcome                 = "verified"
  SourceSha               = $SourceSha
  ReceiptSha256           = $ReviewedReceiptSha256
  ArtifactCount           = $artifactNames.Count
  PublishedObjectCount    = $expectedObjectCount
  CustomerKmsEncrypted    = $true
  ExactVersionReadback    = $true
  LambdaDeploymentChanged = $false
  TriggerChanged          = $false
}
