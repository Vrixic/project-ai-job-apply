[CmdletBinding()]
param(
  [ValidateSet("Status", "Publish", "Verify")]
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

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Publish `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT

  .\scripts\operate-development-ingestion-lambda-publication.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -ReceiptPath .terraform/development-ingestion-artifacts/receipt-....json `
    -ReviewedReceiptSha256 64_CHARACTER_SHA256

Status is read-only. Publish is the only action that writes S3 objects. It tests the workflow
package, runs the dependency audit, builds the exact ingestion source twice, and publishes only
ingestion-durable-lambda and ingestion-runtime-lambda plus their manifests, CycloneDX SBOMs, and
checksum companions. Verify independently reads all eight exact object versions back.

No action changes a Lambda function or alias, enables a trigger, applies Terraform, or runs a
migration. Receipts and logs remain below the ignored development .terraform directory.
"@
  exit 0
}

$publisher = Join-Path $PSScriptRoot "publish-development-document-lambdas.ps1"
if (-not (Test-Path -LiteralPath $publisher -PathType Leaf)) {
  throw "The shared immutable Lambda publication engine is missing."
}

$arguments = @{
  Action            = $Action
  ArtifactFamily    = "Ingestion"
  AwsProfile        = $AwsProfile
  Region            = $Region
  ExpectedAccountId = $ExpectedAccountId
  StateBucket       = $StateBucket
}
if (-not [string]::IsNullOrWhiteSpace($SourceSha)) { $arguments.SourceSha = $SourceSha }
if (-not [string]::IsNullOrWhiteSpace($ReceiptPath)) { $arguments.ReceiptPath = $ReceiptPath }
if (-not [string]::IsNullOrWhiteSpace($ReviewedReceiptSha256)) {
  $arguments.ReviewedReceiptSha256 = $ReviewedReceiptSha256
}

& $publisher @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
