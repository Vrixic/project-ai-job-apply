Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("ai-job-apply-admin-setup-test-" + [guid]::NewGuid().ToString("N"))
$passed = 0
function Assert-Test([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  if (-not $AsSecureString) { throw "The fixture must not request interactive input." }
  return ConvertTo-SecureString "synthetic-admin-secret-not-a-credential" -AsPlainText -Force
}
try {
  $null = New-Item -ItemType Directory -Path (Join-Path $testRoot "scripts") -Force
  $null = New-Item -ItemType Directory -Path (Join-Path $testRoot "frontend/admin") -Force
  $null = New-Item -ItemType Directory -Path (Join-Path $testRoot "frontend/web") -Force
  $helper = Join-Path $testRoot "scripts/configure-auth0-admin-local.ps1"
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts/configure-auth0-admin-local.ps1") -Destination $helper
  $outputPath = Join-Path $testRoot "frontend/admin/.env.local"
  $arguments = @{Auth0Domain="synthetic.example.auth0.com";ClientId="synthetic-admin-client-id";PlatformApiBaseUrl="http://localhost:4000"}
  & $helper @arguments *> $null
  $standard = [IO.File]::ReadAllText($outputPath)
  Assert-Test ($standard -match '(?m)^ADMIN_AUTHORIZATION_PROFILE=standard\r?$') "Default profile changed."
  Assert-Test ($standard -match '(?m)^AUTH0_SECRET=[a-f0-9]{64}\r?$') "Session secret shape is invalid."
  $passed++
  & $helper @arguments -AuthorizationProfile appeals -Force *> $null
  $appeals = [IO.File]::ReadAllText($outputPath)
  Assert-Test ($appeals -match '(?m)^ADMIN_AUTHORIZATION_PROFILE=appeals\r?$') "Appeal profile was not written."
  Assert-Test ($appeals -match '(?m)^AUTH0_CLIENT_ID=synthetic-admin-client-id\r?$') "Client identity changed."
  Assert-Test ($appeals -notmatch 'trust:case:decide|trust:case:takedown|trust:case:open') "Setup invented extra grants."
  $passed++
  & $helper @arguments -AuthorizationProfile APPEALS -Force *> $null
  Assert-Test ([IO.File]::ReadAllText($outputPath) -match '(?m)^ADMIN_AUTHORIZATION_PROFILE=appeals\r?$') "Profile was not canonicalized."
  $passed++
  $before = [IO.File]::ReadAllText($outputPath)
  $refused = $false
  try { & $helper @arguments -AuthorizationProfile invalid -Force *> $null } catch { $refused = $true }
  Assert-Test $refused "Unknown profile was accepted."
  Assert-Test ([IO.File]::ReadAllText($outputPath) -ceq $before) "Invalid input overwrote the environment."
  $passed++
  $refused = $false
  try { & $helper @arguments -AuthorizationProfile standard *> $null } catch { $refused = $true }
  Assert-Test $refused "Existing environment was overwritten without Force."
  Assert-Test ([IO.File]::ReadAllText($outputPath) -ceq $before) "Refused overwrite changed the environment."
  $passed++
  [pscustomobject]@{Passed=$passed;RealCredentialsUsed=$false;RepositoryEnvironmentChanged=$false}
} finally {
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTestRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($resolvedTestRoot) -notmatch '^ai-job-apply-admin-setup-test-[a-f0-9]{32}$') {
    throw "Refusing cleanup outside the exact generated test directory."
  }
  if (Test-Path -LiteralPath $resolvedTestRoot) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
}
