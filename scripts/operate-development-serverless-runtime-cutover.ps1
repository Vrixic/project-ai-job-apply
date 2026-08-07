[CmdletBinding()]
param(
  [ValidateSet(
    "Status", "Apply", "Verify", "PlanRollback", "ApplyRollback",
    "VerifyRollbackTransition", "PlanRollbackCleanup", "ApplyRollbackCleanup",
    "VerifyRollback", "ContinueRollbackContext", "PlanRestore", "ApplyRestore",
    "ContinueRestoreContext", "Cleanup"
  )]
  [string]$Action = "Status",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-fA-F0-9]{64}$")][string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$ConfirmZeroTraffic,
  [switch]$ConfirmRollbackConformance,
  [switch]$ConfirmRestoreConformance,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "operate-staging-serverless-runtime-cutover.ps1"
$arguments = @{
  Environment                = "development"
  Action                     = $Action
  AwsProfile                 = $AwsProfile
  Region                     = $Region
  ConfirmZeroTraffic         = $ConfirmZeroTraffic
  ConfirmRollbackConformance = $ConfirmRollbackConformance
  ConfirmRestoreConformance  = $ConfirmRestoreConformance
  Execute                    = $Execute
  Help                       = $Help
}
foreach ($name in @("ExpectedAccountId", "StateBucket", "PlanPath", "ExpectedPlanSha256")) {
  $value = Get-Variable -Name $name -ValueOnly
  if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $arguments[$name] = $value }
}

& $operator @arguments
exit $LASTEXITCODE
