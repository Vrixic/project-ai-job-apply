param(
  [string]$Auth0Domain,
  [string]$MobileClientId,
  [string]$ExtensionClientId,
  [switch]$MobileOnly,
  [switch]$ExtensionOnly,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Require-SingleLineValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw "$Name must be a non-empty single-line value."
  }
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$mobileEnvironmentPath = Join-Path $repositoryRoot "frontend\mobile\.env.local"
$extensionEnvironmentPath = Join-Path $repositoryRoot "frontend\extension\.env.local"

if ($MobileOnly -and $ExtensionOnly) {
  throw "MobileOnly and ExtensionOnly cannot be used together."
}

$configureMobile = -not $ExtensionOnly
$configureExtension = -not $MobileOnly
$targetPaths = @()
if ($configureMobile) {
  $targetPaths += $mobileEnvironmentPath
}
if ($configureExtension) {
  $targetPaths += $extensionEnvironmentPath
}

foreach ($path in $targetPaths) {
  if ((Test-Path -LiteralPath $path) -and -not $Force) {
    throw "$path already exists. Re-run with -Force only if replacing it is intended."
  }
}

if ([string]::IsNullOrWhiteSpace($Auth0Domain)) {
  $Auth0Domain = Read-Host "Auth0 development tenant domain (without https://)"
}
if ($configureMobile -and [string]::IsNullOrWhiteSpace($MobileClientId)) {
  $MobileClientId = Read-Host "Auth0 Native Application client ID for Expo mobile"
}
if ($configureExtension -and [string]::IsNullOrWhiteSpace($ExtensionClientId)) {
  $ExtensionClientId = Read-Host "Auth0 Native Application client ID for the browser extension"
}

Require-SingleLineValue "Auth0Domain" $Auth0Domain
if ($configureMobile) {
  Require-SingleLineValue "MobileClientId" $MobileClientId
}
if ($configureExtension) {
  Require-SingleLineValue "ExtensionClientId" $ExtensionClientId
}
if ($Auth0Domain.Contains("://") -or $Auth0Domain.Contains("/") -or $Auth0Domain -match "\s") {
  throw "Auth0Domain must be a hostname without a scheme, path, or whitespace."
}

if ($configureMobile) {
  $mobileEnvironment = @(
    "EXPO_PUBLIC_AUTH0_DOMAIN=$Auth0Domain"
    "EXPO_PUBLIC_AUTH0_CLIENT_ID=$MobileClientId"
    "EXPO_PUBLIC_AUTH0_AUDIENCE=ai-job-apply-api"
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $mobileEnvironmentPath -Value $mobileEnvironment -Encoding utf8 -NoNewline
}

if ($configureExtension) {
  $extensionEnvironment = @(
    "EXTENSION_AUTH0_DOMAIN=$Auth0Domain"
    "EXTENSION_AUTH0_CLIENT_ID=$ExtensionClientId"
    "EXTENSION_AUTH0_AUDIENCE=ai-job-apply-api"
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $extensionEnvironmentPath -Value $extensionEnvironment -Encoding utf8 -NoNewline
}

Write-Host "Public Auth0 client configuration written to ignored environment files."
Write-Host "No client secret was requested or written."
if ($configureMobile) {
  $iosCallback = "applydashdev://$Auth0Domain/ios/com.vrix.applydash.dev/callback"
  $androidCallback = "applydashdev://$Auth0Domain/android/com.vrix.applydash.dev/callback"
  Write-Host "Add these exact mobile callback and logout URLs in the mobile Native Application:"
  Write-Host "  $iosCallback"
  Write-Host "  $androidCallback"
}
if ($configureExtension) {
  Write-Host "Build and load the extension to obtain its development ID and chromiumapp.org URL."
}
