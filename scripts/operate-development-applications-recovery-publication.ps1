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
  .\scripts\operate-development-applications-recovery-publication.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-applications-recovery-publication.ps1 -Action Publish `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT

  .\scripts\operate-development-applications-recovery-publication.ps1 -Action Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -SourceSha MERGED_40_CHARACTER_COMMIT `
    -ReceiptPath .terraform/development-applications-recovery-artifacts/receipt-....json `
    -ReviewedReceiptSha256 64_CHARACTER_SHA256

Status is read-only. Publish is the only action that writes S3 objects. It runs the workflow
tests and dependency audit, builds the exact Applications attempt-recovery artifact twice, and
publishes only that ZIP, manifest, CycloneDX SBOM, and checksum companion. Verify independently
reads all four exact object versions back.

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
  ArtifactFamily    = "ApplicationsRecovery"
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
