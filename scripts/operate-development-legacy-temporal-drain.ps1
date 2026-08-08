[CmdletBinding()]
param(
  [ValidateSet("Plan", "Execute", "Cleanup")]
  [string]$Action = "Plan",

  [ValidateSet("PreCutover", "PostCutover")]
  [string]$RuntimeBoundary = "PreCutover",

  [string]$ExpectedPlanSha256 = "",

  [string]$AwsProfile = "ai-job-apply-development-admin",

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$Execute,
  [switch]$ConfirmZeroTraffic,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "operate-staging-legacy-temporal-drain.ps1"
$arguments = @{
  Environment        = "development"
  Action             = $Action
  RuntimeBoundary    = $RuntimeBoundary
  AwsProfile         = $AwsProfile
  Region             = $Region
  Execute            = $Execute
  ConfirmZeroTraffic = $ConfirmZeroTraffic
  Help               = $Help
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedPlanSha256)) {
  $arguments["ExpectedPlanSha256"] = $ExpectedPlanSha256
}

& $operator @arguments
exit $LASTEXITCODE
