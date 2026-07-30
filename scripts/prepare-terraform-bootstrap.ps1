[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("development", "staging")]
  [string]$Environment,

  [string]$Destination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$bootstrapSource = Join-Path $repositoryRoot "infrastructure\terraform\bootstrap"

if ([string]::IsNullOrWhiteSpace($Destination)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "LOCALAPPDATA is required when Destination is omitted."
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Destination = Join-Path $env:LOCALAPPDATA "ai-job-apply\terraform\$Environment-bootstrap-$timestamp"
}

$workspace = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $workspace) {
  throw "Bootstrap workspace already exists: $workspace"
}

New-Item -ItemType Directory -Path $workspace | Out-Null

foreach ($file in @("main.tf", "outputs.tf", "variables.tf", ".terraform.lock.hcl")) {
  Copy-Item -LiteralPath (Join-Path $bootstrapSource $file) -Destination $workspace
}

Copy-Item `
  -LiteralPath (Join-Path $bootstrapSource "versions.local.tf.example") `
  -Destination (Join-Path $workspace "versions.tf")

[pscustomobject]@{
  Environment = $Environment
  Workspace   = $workspace
  Backend     = "local"
  NextCommand = "terraform `"-chdir=$workspace`" init -input=false"
}
