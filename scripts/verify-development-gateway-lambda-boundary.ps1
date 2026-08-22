[CmdletBinding()]
param(
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$AwsRegion = "us-east-2"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& (Join-Path $PSScriptRoot "verify-gateway-lambda-boundary.ps1") `
  -Environment development `
  -AwsProfile $AwsProfile `
  -AwsRegion $AwsRegion
if ($LASTEXITCODE -ne 0) {
  throw "The development gateway Lambda boundary verification failed."
}
