[CmdletBinding()]
param(
  [string]$Auth0Domain,
  [string]$ClientId,
  [string]$PlatformApiBaseUrl = "http://localhost:4000",
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-SingleLineValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw "$Name must be a non-empty single-line value."
  }
}

function Get-EnvironmentValue([string]$Content, [string]$Name) {
  $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=([^`r`n]*)")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$adminEnvironmentPath = Join-Path $repositoryRoot "frontend\admin\.env.local"
$webEnvironmentPath = Join-Path $repositoryRoot "frontend\web\.env.local"
if ((Test-Path -LiteralPath $adminEnvironmentPath) -and -not $Force) {
  throw "$adminEnvironmentPath already exists. Re-run with -Force only if replacement is intended."
}

if ([string]::IsNullOrWhiteSpace($Auth0Domain)) {
  $Auth0Domain = Read-Host "Auth0 development tenant domain (without https://)"
}
if ([string]::IsNullOrWhiteSpace($ClientId)) {
  $ClientId = Read-Host "Dedicated moderation Regular Web Application Client ID"
}
Require-SingleLineValue "Auth0Domain" $Auth0Domain
Require-SingleLineValue "ClientId" $ClientId
Require-SingleLineValue "PlatformApiBaseUrl" $PlatformApiBaseUrl
if ($Auth0Domain.Contains("://") -or $Auth0Domain.Contains("/") -or $Auth0Domain -match "\s") {
  throw "Auth0Domain must be a hostname without a scheme, path, or whitespace."
}
if ($ClientId -notmatch '^[A-Za-z0-9_-]{8,128}$') {
  throw "ClientId is not a canonical Auth0 client identifier."
}
[Uri]$platformUri = $null
if (-not [Uri]::TryCreate($PlatformApiBaseUrl, [UriKind]::Absolute, [ref]$platformUri) -or
    -not [string]::IsNullOrEmpty($platformUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($platformUri.Query) -or
    -not [string]::IsNullOrEmpty($platformUri.Fragment) -or
    ($platformUri.Scheme -cne "https" -and
      -not ($platformUri.Scheme -ceq "http" -and $platformUri.IsLoopback))) {
  throw "PlatformApiBaseUrl must be HTTPS or an HTTP loopback URL without credentials or query data."
}
$PlatformApiBaseUrl = $PlatformApiBaseUrl.TrimEnd("/")

$webEnvironment = if (Test-Path -LiteralPath $webEnvironmentPath -PathType Leaf) {
  [IO.File]::ReadAllText($webEnvironmentPath)
} else { "" }
$webClientId = Get-EnvironmentValue -Content $webEnvironment -Name "AUTH0_CLIENT_ID"
$webClientSecret = Get-EnvironmentValue -Content $webEnvironment -Name "AUTH0_CLIENT_SECRET"
if (-not [string]::IsNullOrEmpty($webClientId) -and $ClientId -ceq $webClientId) {
  throw "The moderation client must not reuse the candidate web client ID."
}

$secureClientSecret = Read-Host "Dedicated moderation client secret" -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureClientSecret)
try {
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
Require-SingleLineValue "ClientSecret" $clientSecret
if (-not [string]::IsNullOrEmpty($webClientSecret) -and $clientSecret -ceq $webClientSecret) {
  $clientSecret = $null
  throw "The moderation client must not reuse the candidate web client secret."
}

$randomBytes = [byte[]]::new(32)
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomNumberGenerator.GetBytes($randomBytes)
} finally {
  $randomNumberGenerator.Dispose()
}
$sessionSecret = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()
$adminEnvironment = @(
  "AUTH0_DOMAIN=$Auth0Domain"
  "AUTH0_CLIENT_ID=$ClientId"
  "AUTH0_CLIENT_SECRET=$clientSecret"
  "AUTH0_SECRET=$sessionSecret"
  "APP_BASE_URL=http://localhost:3001"
  "AUTH0_AUDIENCE=ai-job-apply-api"
  "PLATFORM_API_BASE_URL=$PlatformApiBaseUrl"
) -join [Environment]::NewLine
[IO.File]::WriteAllText(
  $adminEnvironmentPath,
  $adminEnvironment,
  [Text.UTF8Encoding]::new($false)
)

$clientSecret = $null
$sessionSecret = $null
$webClientSecret = $null
[Array]::Clear($randomBytes, 0, $randomBytes.Length)

Write-Host "Dedicated moderation Auth0 configuration written to the ignored admin environment file."
Write-Host "No secret values were printed. Restart the admin application before testing."
