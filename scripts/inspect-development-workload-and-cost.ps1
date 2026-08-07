[CmdletBinding()]
param(
  [ValidateSet("Status", "Measure")][string]$Action = "Status",
  [string]$StartTime = "",
  [string]$EndTime = "",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [string]$RuntimePlanPath = "",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$inspector = Join-Path $PSScriptRoot "inspect-staging-workload-and-cost.ps1"
$arguments = @{
  Environment       = "development"
  Action            = $Action
  StartTime         = $StartTime
  EndTime           = $EndTime
  AwsProfile        = $AwsProfile
  Region            = $Region
  Help              = $Help
}
foreach ($name in @("ExpectedAccountId", "StateBucket", "RuntimePlanPath")) {
  $value = Get-Variable -Name $name -ValueOnly
  if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $arguments[$name] = $value }
}

& $inspector @arguments
exit $LASTEXITCODE
