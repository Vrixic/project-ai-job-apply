[CmdletBinding()]
param(
  [ValidateSet("Plan", "Execute", "Cleanup")][string]$Action = "Plan",
  [string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "operate-serverless-workflow-dark-conformance.ps1"
if ($Help) {
  & $operator -Environment development -Help
  exit $LASTEXITCODE
}

$arguments = @{
  Environment        = "development"
  Action             = $Action
  ExpectedPlanSha256 = $ExpectedPlanSha256
  AwsProfile         = $AwsProfile
  Region             = $Region
  Execute            = $Execute
}

& $operator @arguments
exit $LASTEXITCODE
