[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApiOrigin,
  [ValidateRange(1, 65535)][int]$Port = 3000,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$environmentPath = Join-Path $repositoryRoot "frontend/web/.env.local"
$origin = $null
if (-not [Uri]::TryCreate($ApiOrigin, [UriKind]::Absolute, [ref]$origin) -or
    $origin.UserInfo -or $origin.Query -or $origin.Fragment -or
    $origin.AbsolutePath -ne "/" -or
    ($origin.Scheme -ne "https" -and
      -not ($origin.Scheme -eq "http" -and $origin.Host -in @("localhost", "127.0.0.1")))) {
  throw "ApiOrigin must be an HTTPS origin, or an HTTP loopback origin."
}
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw "Configure ignored frontend/web/.env.local identity settings first."
}
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($environmentPath)) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=(.*)$') {
    $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}
foreach ($key in @("AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "AUTH0_AUDIENCE", "APP_BASE_URL")) {
  if ([string]::IsNullOrWhiteSpace($settings[$key])) {
    throw "Local managed identity setting $key is missing."
  }
}
if ($settings.APP_BASE_URL -ne "http://localhost:$Port") {
  throw "APP_BASE_URL must match http://localhost:$Port and its registered callback."
}
$settings.Clear()
$apiBase = $origin.GetLeftPart([UriPartial]::Authority)
try {
  $live = Invoke-RestMethod -Uri "$apiBase/health/live" -TimeoutSec 15
  $ready = Invoke-RestMethod -Uri "$apiBase/health/ready" -TimeoutSec 15
} catch {
  throw "The selected API health endpoints are unavailable."
}
if ($live.status -ne "ok" -or $ready.status -ne "ok" -or
    $live.service -ne "gateway" -or $ready.service -ne "gateway" -or
    $live.releaseSha -notmatch '^[a-f0-9]{64}$' -or
    $ready.releaseSha -ne $live.releaseSha) {
  throw "The selected API did not return matching healthy Gateway releases."
}
Write-Host "Development API health passed. Managed sign-in remains required."
if ($CheckOnly) { return }
$previousApiBase = $env:PLATFORM_API_BASE_URL
try {
  # Process-only override wins over .env.local; no environment file is rewritten.
  $env:PLATFORM_API_BASE_URL = $apiBase
  Push-Location -LiteralPath $repositoryRoot
  try {
    Write-Host "Starting local web at http://localhost:$Port against the selected API."
    Write-Host "Use your regular browser for Google sign-in."
    & pnpm --filter @ai-job-apply/web dev --hostname 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw "Local web exited with code $LASTEXITCODE." }
  } finally { Pop-Location }
} finally {
  $env:PLATFORM_API_BASE_URL = $previousApiBase
}
