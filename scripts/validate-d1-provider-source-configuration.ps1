[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
  throw "The provider source configuration must be one exact file."
}
$configuration = [IO.File]::ReadAllText($resolved, [Text.UTF8Encoding]::new($false, $true))
if ([Text.Encoding]::UTF8.GetByteCount($configuration) -gt 1800) {
  throw "The provider source configuration exceeds the runtime boundary."
}

$previousConfirmation = [Environment]::GetEnvironmentVariable(
  "D1_PROVIDER_SOURCE_PREFLIGHT_CONFIRMATION",
  "Process"
)
$previousConfiguration = [Environment]::GetEnvironmentVariable(
  "D1_PROVIDER_SOURCE_CONFIGURATION",
  "Process"
)
try {
  $env:D1_PROVIDER_SOURCE_PREFLIGHT_CONFIRMATION = "validate-default-off-provider-source"
  $env:D1_PROVIDER_SOURCE_CONFIGURATION = $configuration
  & pnpm --dir $repositoryRoot --filter "@ai-job-apply/workflows" preflight:provider-source
  if ($LASTEXITCODE -ne 0) {
    throw "The default-off provider source configuration failed production preflight."
  }
} finally {
  [Environment]::SetEnvironmentVariable(
    "D1_PROVIDER_SOURCE_PREFLIGHT_CONFIRMATION",
    $previousConfirmation,
    "Process"
  )
  [Environment]::SetEnvironmentVariable(
    "D1_PROVIDER_SOURCE_CONFIGURATION",
    $previousConfiguration,
    "Process"
  )
}
