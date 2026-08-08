[CmdletBinding()]
param(
  [ValidateSet("Plan", "Status", "Apply", "Verify")][string]$Action = "Status",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$BaselinePlanPath = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-fA-F0-9]{64}$")][string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$ConfirmRollbackExpired,
  [switch]$Execute,
  [switch]$Help
)
$arguments = @{ Environment = "development"; Action = $Action; AwsProfile = $AwsProfile; Region = $Region; ConfirmRollbackExpired = $ConfirmRollbackExpired; Execute = $Execute; Help = $Help }
foreach ($name in @("ExpectedAccountId", "StateBucket", "BaselinePlanPath", "PlanPath", "ExpectedPlanSha256")) {
  $value = Get-Variable -Name $name -ValueOnly
  if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $arguments[$name] = $value }
}
& (Join-Path $PSScriptRoot "operate-phase0-legacy-runtime-retirement.ps1") @arguments
exit $LASTEXITCODE
