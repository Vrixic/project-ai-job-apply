[CmdletBinding()]
param(
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId,

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket,

  [ValidatePattern("^[0-9]+$")]
  [string]$OidcEvidenceRunId,

  [string]$AwsProfile = "ai-job-apply-development-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$AllowStateKmsCorrection,

  [switch]$Help
)

$ErrorActionPreference = "Stop"
$planner = Join-Path $PSScriptRoot "plan-serverless-workflow-bootstrap.ps1"
if ($Help) {
  & $planner -Help
  exit $LASTEXITCODE
}
& $planner `
  -Environment development `
  -ExpectedAccountId $ExpectedAccountId `
  -StateBucket $StateBucket `
  -OidcEvidenceRunId $OidcEvidenceRunId `
  -AwsProfile $AwsProfile `
  -Region $Region `
  -AllowStateKmsCorrection:$AllowStateKmsCorrection
exit $LASTEXITCODE
