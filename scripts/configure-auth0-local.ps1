param(
  [string]$Auth0Domain,
  [string]$ClientId,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Require-SingleLineValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw "$Name must be a non-empty single-line value."
  }
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$webEnvironmentPath = Join-Path $repositoryRoot "frontend\web\.env.local"
$rootEnvironmentPath = Join-Path $repositoryRoot ".env"
$rootEnvironmentExamplePath = Join-Path $repositoryRoot ".env.example"

if ((Test-Path -LiteralPath $webEnvironmentPath) -and -not $Force) {
  throw "$webEnvironmentPath already exists. Re-run with -Force only if replacing it is intended."
}

if ([string]::IsNullOrWhiteSpace($Auth0Domain)) {
  $Auth0Domain = Read-Host "Auth0 development tenant domain (without https://)"
}
if ([string]::IsNullOrWhiteSpace($ClientId)) {
  $ClientId = Read-Host "Auth0 Regular Web Application Client ID"
}
Require-SingleLineValue "Auth0Domain" $Auth0Domain
Require-SingleLineValue "ClientId" $ClientId
if ($Auth0Domain.Contains("://") -or $Auth0Domain.Contains("/") -or $Auth0Domain -match "\s") {
  throw "Auth0Domain must be a hostname without a scheme, path, or whitespace."
}

$secureClientSecret = Read-Host "Auth0 Regular Web Application Client Secret" -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureClientSecret)
try {
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}
Require-SingleLineValue "ClientSecret" $clientSecret

$randomBytes = [byte[]]::new(32)
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomNumberGenerator.GetBytes($randomBytes)
}
finally {
  $randomNumberGenerator.Dispose()
}
$sessionSecret = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()

$webEnvironment = @(
  "AUTH0_DOMAIN=$Auth0Domain"
  "AUTH0_CLIENT_ID=$ClientId"
  "AUTH0_CLIENT_SECRET=$clientSecret"
  "AUTH0_SECRET=$sessionSecret"
  "APP_BASE_URL=http://localhost:3000"
  "AUTH0_AUDIENCE=ai-job-apply-api"
  "PLATFORM_API_BASE_URL=http://localhost:4000"
) -join [Environment]::NewLine

Set-Content -LiteralPath $webEnvironmentPath -Value $webEnvironment -Encoding utf8 -NoNewline

$issuerLine = "OIDC_ISSUER=https://$Auth0Domain/"
if (Test-Path -LiteralPath $rootEnvironmentPath) {
  $rootEnvironment = Get-Content -Raw -LiteralPath $rootEnvironmentPath
  if ($rootEnvironment -match "(?m)^OIDC_ISSUER=.*$") {
    $rootEnvironment = $rootEnvironment -replace "(?m)^OIDC_ISSUER=.*$", $issuerLine
  }
  else {
    $rootEnvironment = $rootEnvironment.TrimEnd() + [Environment]::NewLine + $issuerLine
  }
}
else {
  $rootEnvironment = Get-Content -Raw -LiteralPath $rootEnvironmentExamplePath
  $rootEnvironment = $rootEnvironment -replace "(?m)^OIDC_ISSUER=.*$", $issuerLine
}
Set-Content -LiteralPath $rootEnvironmentPath -Value $rootEnvironment -Encoding utf8 -NoNewline

$clientSecret = $null
$sessionSecret = $null
[Array]::Clear($randomBytes, 0, $randomBytes.Length)

Write-Host "Auth0 local configuration written to ignored environment files."
Write-Host "No secret values were printed. Restart the web and gateway processes before testing."
