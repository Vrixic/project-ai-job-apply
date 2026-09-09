# Dot-source this script to select the verified portable binary for this PowerShell session only.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")
function Set-DeploymentTerraformSessionPath {
  param([string]$Directory, [string]$ExecutableSha256)
  $executable = Resolve-DeploymentTerraformFile -Path (Join-Path $Directory "terraform.exe")
  if ($ExecutableSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExecutableSha256) {
    throw "The portable Terraform executable does not match its verified installation."
  }
  $previousPath = $env:PATH
  try {
    $env:PATH = $Directory + [IO.Path]::PathSeparator + $env:PATH
    if ((Get-DeploymentTerraformExecutable) -cne $executable) {
      throw "The selected Terraform command does not resolve to the verified portable executable."
    }
    Assert-DeploymentTerraformCli
  } catch {
    $env:PATH = $previousPath
    throw
  }
}

$deploymentTerraformDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ("../.tmp/toolchains/terraform/" + (Get-DeploymentTerraformVersion))))
$deploymentTerraformExecutable = Join-Path $deploymentTerraformDirectory "terraform.exe"
if (-not (Test-Path -LiteralPath $deploymentTerraformExecutable -PathType Leaf)) {
  throw "Run scripts/install-terraform-toolchain.ps1 before selecting the portable deployment toolchain."
}
Set-DeploymentTerraformSessionPath -Directory $deploymentTerraformDirectory `
  -ExecutableSha256 "d51f533398d3bb2df73ffd85fd5c1af3e8db15433018fe818ce816248290fe96"
Write-Host ("Selected portable Terraform " + (Get-DeploymentTerraformVersion) + " for this process only.")
