[CmdletBinding()]
param(
  [ValidateSet("Status", "PlanRollback", "ApplyRollback", "PlanRestore", "ApplyRestore", "Cleanup")]
  [string]$Action = "Status",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [string]$StateBucket = "",
  [string]$CurrentReleasePlanPath = "",
  [string]$RollbackReleasePlanPath = "",
  [ValidatePattern("^[a-fA-F0-9]{64}$")][string]$ExpectedPlanSha256 = "",
  [string]$AwsProfile = "ai-job-apply-staging-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$ConfirmRollbackConformance,
  [switch]$ConfirmRestoreConformance,
  [switch]$Execute,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "operate-serverless-workflow-release-rollback.ps1"
if ($Help) {
  & $operator -Environment staging -Help
  exit $LASTEXITCODE
}

$arguments = @{
  Environment                = "staging"
  Action                     = $Action
  AwsProfile                 = $AwsProfile
  Region                     = $Region
  ConfirmRollbackConformance = $ConfirmRollbackConformance
  ConfirmRestoreConformance  = $ConfirmRestoreConformance
  Execute                    = $Execute
}
foreach ($name in @(
    "ExpectedAccountId", "StateBucket", "CurrentReleasePlanPath",
    "RollbackReleasePlanPath", "ExpectedPlanSha256"
  )) {
  if (-not [string]::IsNullOrWhiteSpace([string](Get-Variable -Name $name -ValueOnly))) {
    $arguments[$name] = Get-Variable -Name $name -ValueOnly
  }
}

& $operator @arguments
exit $LASTEXITCODE
