[CmdletBinding()]
param(
  [ValidateSet("Status", "Publish", "Verify")][string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
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
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or -not $StateBucket) { throw "The exact account and encrypted state bucket are required." }
$env:AWS_PROFILE=$AwsProfile; $env:AWS_REGION=$region; $env:AWS_DEFAULT_REGION=$region; $env:AWS_PAGER=""
$caller = Invoke-AwsJson @("sts","get-caller-identity","--output","json")
if ([string]$caller.Account -cne $ExpectedAccountId) { throw "AWS account mismatch." }
$bucket = Invoke-AwsJson @("s3api","get-bucket-versioning","--bucket",$StateBucket,"--output","json")
if ([string]$bucket.Status -cne "Enabled") { throw "The artifact bucket must be versioned." }
$encryption = Invoke-AwsJson @("s3api","get-bucket-encryption","--bucket",$StateBucket,"--output","json")
$algorithm = [string]$encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm
if ($algorithm -notin @("AES256","aws:kms")) { throw "The artifact bucket must enforce server-side encryption." }
if ($Action -ceq "Status") { [pscustomobject]@{ Action="Status"; AccountMatched=$true; BucketVersioning="Enabled" }; exit 0 }
if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw "An exact reviewed source SHA is required." }
if ($Action -ceq "Publish") {
  if ((git -C $root status --porcelain).Count -ne 0 -or (git -C $root rev-parse HEAD).Trim() -cne $SourceSha) { throw "Publication requires the exact clean reviewed source." }
  pnpm --filter @ai-job-apply/workflows test; if ($LASTEXITCODE) { throw "Workflow tests failed." }
  pnpm audit:dependencies; if ($LASTEXITCODE) { throw "Dependency audit failed." }
  pnpm --filter @ai-job-apply/workflows build:lambda:d2-community; if ($LASTEXITCODE) { throw "D2 build failed." }
  $first = Get-Sha $artifact
  pnpm --filter @ai-job-apply/workflows build:lambda:d2-community; if ($LASTEXITCODE) { throw "D2 rebuild failed." }
  if ((Get-Sha $artifact) -cne $first) { throw "The D2 artifact is not deterministic." }
  $key = "lambda/d2-community/$SourceSha/$first/d2-community-runtime-lambda.zip"
  $existing = & aws s3api head-object --bucket $StateBucket --key $key 2>$null
  if ($LASTEXITCODE -eq 0) { throw "The immutable D2 artifact key already exists." }
  $put = Invoke-AwsJson @("s3api","put-object","--bucket",$StateBucket,"--key",$key,"--body",$artifact,"--checksum-algorithm","SHA256","--if-none-match","*","--output","json")
  if (-not $put.VersionId) { throw "The publication did not return an immutable version." }
  $path = Resolve-Private $(if ($ReceiptPath) {$ReceiptPath} else { Join-Path $privateRoot "receipt-$($SourceSha.Substring(0,12)).json" })
  $null = New-Item -ItemType Directory -Force -Path (Split-Path $path)
  [IO.File]::WriteAllText($path, ([ordered]@{schemaVersion=1;kind="development-d2-community-artifact-publication";sourceSha=$SourceSha;artifactSha256=$first;artifactBase64Sha256=(Get-Base64Sha $artifact);key=$key;versionId=[string]$put.VersionId;phase="published"}|ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  [pscustomobject]@{ ReceiptPath=$path; ReceiptSha256=(Get-Sha $path); ArtifactSha256=$first }; exit 0
}
$path = Resolve-Private $ReceiptPath
if ((Get-Sha $path) -cne $ReviewedReceiptSha256) { throw "Receipt checksum mismatch." }
$receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
if ($receipt.kind -cne "development-d2-community-artifact-publication" -or $receipt.sourceSha -cne $SourceSha -or $receipt.phase -cne "published") { throw "Receipt boundary mismatch." }
$remote = Invoke-AwsJson @("s3api","head-object","--bucket",$StateBucket,"--key",[string]$receipt.key,"--version-id",[string]$receipt.versionId,"--checksum-mode","ENABLED","--output","json")
if (-not $remote.VersionId -or [string]$remote.ChecksumSHA256 -cne [string]$receipt.artifactBase64Sha256) { throw "The exact immutable object version or checksum is unavailable." }
[pscustomobject]@{ Action="Verify"; SourceSha=$SourceSha; ArtifactSha256=[string]$receipt.artifactSha256; LambdaDeploymentChanged=$false; TriggerChanged=$false }
