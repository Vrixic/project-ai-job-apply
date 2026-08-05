[CmdletBinding()]
param(
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [string]$AwsRegion = "us-east-2"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& (Join-Path $PSScriptRoot "verify-gateway-lambda-boundary.ps1") `
  -Environment staging `
  -AwsProfile $AwsProfile `
  -AwsRegion $AwsRegion
exit $LASTEXITCODE
