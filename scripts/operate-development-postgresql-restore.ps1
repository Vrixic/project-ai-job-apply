[CmdletBinding()]
param(
  [ValidateSet("Status", "Start", "Verify", "Cleanup", "Exercise")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [switch]$Execute,
  [switch]$AllowUnverifiedCleanup,
  [switch]$DarkRecovery,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "operate-staging-postgresql-restore.ps1"
$arguments = @{
  Environment            = "development"
  Action                 = $Action
  AwsProfile             = $AwsProfile
  Region                 = $Region
  Execute                = $Execute
  AllowUnverifiedCleanup = $AllowUnverifiedCleanup
  DarkRecovery           = $DarkRecovery
  Help                   = $Help
}
foreach ($name in @("ExpectedAccountId", "StateBucket", "RuntimePlanPath")) {
  $value = Get-Variable -Name $name -ValueOnly
  if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $arguments[$name] = $value }
}

& $operator @arguments
exit $LASTEXITCODE
