[CmdletBinding()]
param(
  [ValidateSet("Validate", "Preflight", "Verify")]
  [string]$Action = "Validate",
  [ValidateSet("Candidate", "Admin")]
  [string]$Surface = "Candidate",
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",
  [string]$AuthorizedVercelIdentity = "",
  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,99}$")]
  [string]$ExpectedProjectName = "",
  [string]$StableOrigin = "",
  [string]$HostedObservationPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedObservationSha256 = "",
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\operate-vercel-phase1-hosted-acceptance.ps1 -Action Validate `
    -Surface Candidate -SourceSha RELEASE_SHA -AuthorizedVercelIdentity EXACT_NON_ZACH_IDENTITY `
    -ExpectedProjectName PROJECT

  Preflight uses the same arguments and performs only pinned, read-only Vercel identity checks.

  Verify additionally requires -StableOrigin HTTPS_ORIGIN -HostedObservationPath PATH and
  -ReviewedObservationSha256 SHA256.

Validate is offline. Preflight calls only vercel@59.6.2 --version and whoami, then validates
the surface-specific local project binding. Verify repeats Preflight and accepts only a checksum-
reviewed, aggregate-only hosted observation below the ignored development .terraform directory.
This operator never logs in, links, deploys, changes environment variables, activates admin
identity, enables public indexing, requests arbitrary routes, or retains tokens, cookies, bodies,
identity attributes, candidate values, job values, or moderation records.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$operatorRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "infrastructure\terraform\environments\development\.terraform\vercel-phase1-hosted-acceptance"))
$vercelCliPackage = "vercel@59.6.2"
$vercelCliVersion = "59.6.2"
$profile = "d1_vercel_hosted_acceptance_v1"

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Text)
  $encoder = New-Object Text.UTF8Encoding($false)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($algorithm.ComputeHash($encoder.GetBytes($Text))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function ConvertFrom-OperatorJson {
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Description)
  try {
    $command = Get-Command ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop
    if ($command.Parameters.ContainsKey("DateKind")) { return $Json | ConvertFrom-Json -DateKind String }
    return $Json | ConvertFrom-Json
  } catch {
    throw "$Description is invalid JSON."
  }
}

function Assert-ExactProperties {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][string]$Description
  )
  $actual = if ($Value -is [System.Collections.IDictionary]) {
    @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  } else {
    @($Value.PSObject.Properties.Name | Sort-Object)
  }
  if (($actual -join "`n") -cne (@($Expected | Sort-Object) -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
  return $true
}

function Test-CanonicalTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string]) { return $false }
  $parsed = [DateTimeOffset]::MinValue
  return [DateTimeOffset]::TryParseExact(
    [string]$Value,
    "o",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  ) -and $parsed.Offset -eq [TimeSpan]::Zero -and [string]$Value -ceq $parsed.ToString("o")
}

function Get-SurfaceConfiguration {
  param([Parameter(Mandatory)][string]$ExactSurface)
  if ($ExactSurface -ceq "Candidate") {
    return [pscustomobject]@{
      Name = "candidate"
      RootDirectory = "frontend/web"
      PackageName = "@ai-job-apply/web"
      BffPath = "/api/platform/entitlements"
      RequiredRobotsHeader = ""
    }
  }
  if ($ExactSurface -ceq "Admin") {
    return [pscustomobject]@{
      Name = "admin"
      RootDirectory = "frontend/admin"
      PackageName = "@ai-job-apply/admin"
      BffPath = "/api/moderation/cases"
      RequiredRobotsHeader = "noindex, nofollow, noarchive"
    }
  }
  throw "The surface is not supported."
}

function Assert-ExactHttpsOrigin {
  param([Parameter(Mandatory)][string]$Value)
  if ($Value -cne $Value.Trim() -or $Value.EndsWith("/") -or $Value.Contains("@")) {
    throw "The stable host must be an exact HTTPS origin without credentials or a trailing slash."
  }
  $uri = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -cne "https" -or -not $uri.IsDefaultPort -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    $uri.AbsolutePath -cne "/" -or -not [string]::IsNullOrEmpty($uri.Query) -or
    -not [string]::IsNullOrEmpty($uri.Fragment) -or
    [string]::IsNullOrWhiteSpace($uri.DnsSafeHost) -or
    $uri.DnsSafeHost.EndsWith(".") -or $uri.DnsSafeHost -cne $uri.DnsSafeHost.ToLowerInvariant() -or
    -not $uri.DnsSafeHost.Contains(".") -or $uri.HostNameType -cne [UriHostNameType]::Dns -or
    $uri.GetLeftPart([UriPartial]::Authority) -cne $Value) {
    throw "The stable host must be one canonical lowercase HTTPS DNS origin."
  }
  return $true
}

function Assert-InputBoundary {
  if ($SourceSha -cnotmatch '^[a-f0-9]{40}$') { throw "SourceSha must be an exact lowercase Git SHA." }
  if ($AuthorizedVercelIdentity -cne $AuthorizedVercelIdentity.Trim() -or
    $AuthorizedVercelIdentity -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "The authorized Vercel identity must be one exact canonical username."
  }
  if ($AuthorizedVercelIdentity -match '(?i)zach|becker') {
    throw "The Zach Becker identity is prohibited for this platform boundary."
  }
  if ($ExpectedProjectName -cnotmatch '^[a-z0-9][a-z0-9-]{0,99}$') {
    throw "The expected project name must be exact and canonical."
  }
  if ($Action -ceq "Verify") {
    Assert-ExactHttpsOrigin $StableOrigin | Out-Null
    if ([string]::IsNullOrWhiteSpace($HostedObservationPath) -or
      $ReviewedObservationSha256 -cnotmatch '^[a-f0-9]{64}$') {
      throw "Verify requires one checksum-reviewed aggregate hosted observation."
    }
  } elseif (-not [string]::IsNullOrEmpty($StableOrigin) -or
    -not [string]::IsNullOrEmpty($HostedObservationPath) -or
    -not [string]::IsNullOrEmpty($ReviewedObservationSha256)) {
    throw "Hosted observation inputs are accepted only by Verify."
  }
}

function Invoke-GitText {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Description)
  $result = @(& git -C $repositoryRoot @Arguments 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "$Description could not be established." }
  return @($result)
}

function Assert-ExactSource {
  $branch = (Invoke-GitText @("branch", "--show-current") "The Git branch") -join "`n"
  $head = (Invoke-GitText @("rev-parse", "HEAD") "The Git HEAD") -join "`n"
  $origin = (Invoke-GitText @("rev-parse", "origin/main") "The origin/main revision") -join "`n"
  $dirty = @(Invoke-GitText @("status", "--porcelain") "The Git worktree state")
  if ($branch -cne "main" -or $head -cne $SourceSha -or $origin -cne $SourceSha -or $dirty.Count -ne 0) {
    throw "Hosted acceptance requires clean main with HEAD and origin/main exactly equal to SourceSha."
  }
  return $head
}

function Assert-SourceHostingConfiguration {
  param([Parameter(Mandatory)][object]$Configuration)
  $configPath = Join-Path $repositoryRoot "$($Configuration.RootDirectory)\vercel.json"
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "The surface Vercel configuration is missing." }
  $config = ConvertFrom-OperatorJson (Get-Content -LiteralPath $configPath -Raw) "The surface Vercel configuration"
  Assert-ExactProperties $config @('$schema', 'buildCommand', 'framework', 'installCommand', 'regions') "The surface Vercel configuration" | Out-Null
  $expectedBuild = "cd ../.. && pnpm exec turbo run build --filter=$($Configuration.PackageName)"
  if ([string]$config.'$schema' -cne "https://openapi.vercel.sh/vercel.json" -or
    [string]$config.buildCommand -cne $expectedBuild -or [string]$config.framework -cne "nextjs" -or
    [string]$config.installCommand -cne "cd ../.. && pnpm install --frozen-lockfile" -or
    @($config.regions).Count -ne 1 -or [string]$config.regions[0] -cne "iad1") {
    throw "The surface Vercel configuration does not match the reviewed Phase 1 boundary."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot ".vercelignore") -PathType Leaf)) {
    throw "The repository Vercel upload boundary is missing."
  }
}

function ConvertFrom-BoundedFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Description,
    [ValidateRange(1, 65536)][int]$MaximumBytes = 32768
  )
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0 -or $bytes.Length -gt $MaximumBytes -or
    ($bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf)) {
    throw "$Description is empty, BOM-prefixed, or exceeds its aggregate data bound."
  }
  $encoder = New-Object Text.UTF8Encoding($false, $true)
  try { $json = $encoder.GetString($bytes) } catch { throw "$Description is not strict UTF-8." }
  return ConvertFrom-OperatorJson $json $Description
}

function Read-ProjectBinding {
  param([Parameter(Mandatory)][object]$Configuration)
  $projectPath = Join-Path $repositoryRoot "$($Configuration.RootDirectory)\.vercel\project.json"
  if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "The $($Configuration.Name) root is not locally bound to its isolated Vercel project."
  }
  $binding = ConvertFrom-BoundedFile $projectPath "The $($Configuration.Name) Vercel project binding" 4096
  Assert-ExactProperties $binding @('orgId', 'projectId', 'projectName') "The $($Configuration.Name) Vercel project binding" | Out-Null
  foreach ($property in @("orgId", "projectId")) {
    if ([string]$binding.$property -cnotmatch '^[A-Za-z0-9_-]{3,128}$') {
      throw "The $($Configuration.Name) Vercel project binding has an invalid $property."
    }
  }
  if ([string]$binding.projectName -cne $ExpectedProjectName) {
    throw "The local Vercel project name does not exactly match the reviewed project."
  }

  $otherDirectory = if ($Configuration.Name -ceq "candidate") { "frontend/admin" } else { "frontend/web" }
  $otherPath = Join-Path $repositoryRoot "$otherDirectory\.vercel\project.json"
  if (Test-Path -LiteralPath $otherPath -PathType Leaf) {
    $other = ConvertFrom-BoundedFile $otherPath "The other Vercel project binding" 4096
    Assert-ExactProperties $other @('orgId', 'projectId', 'projectName') "The other Vercel project binding" | Out-Null
    if ([string]$other.projectId -ceq [string]$binding.projectId) {
      throw "Candidate and admin roots cannot share one Vercel project."
    }
  }
  return $binding
}

function Invoke-PinnedVercelText {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Description)
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) { throw "pnpm is required for the pinned Vercel read-only preflight." }
  $result = @(& pnpm dlx $vercelCliPackage @Arguments 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "$Description failed; do not log in or switch accounts implicitly." }
  return @($result | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-ReadOnlyProviderPreflight {
  $versionLines = @(Invoke-PinnedVercelText @("--version") "The pinned Vercel CLI version check")
  if ($versionLines.Count -ne 1 -or
    ($versionLines[0] -cne $vercelCliVersion -and $versionLines[0] -cne "Vercel CLI $vercelCliVersion")) {
    throw "The resolved Vercel CLI is not exactly version $vercelCliVersion."
  }
  $identityLines = @(Invoke-PinnedVercelText @("whoami") "The read-only Vercel identity check")
  if ($identityLines.Count -ne 1 -or $identityLines[0] -cne $AuthorizedVercelIdentity -or
    $identityLines[0] -match '(?i)zach|becker') {
    throw "The active Vercel identity is not the exact authorized non-Zach identity."
  }
}

function Resolve-ObservationPath {
  $root = $operatorRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $resolved = if ([IO.Path]::IsPathRooted($HostedObservationPath)) {
    [IO.Path]::GetFullPath($HostedObservationPath)
  } else {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot $HostedObservationPath))
  }
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The hosted observation must exist below its exact ignored operator directory."
  }
  return $resolved
}

function Assert-Boolean {
  param([AllowNull()][object]$Value, [Parameter(Mandatory)][bool]$Expected, [Parameter(Mandatory)][string]$Description)
  if ($Value -isnot [bool] -or [bool]$Value -ne $Expected) { throw "$Description is not exactly $Expected." }
}

function Test-JsonInteger {
  param([AllowNull()][object]$Value)
  return $Value -is [int] -or $Value -is [long]
}

function Assert-HostedObservation {
  param(
    [Parameter(Mandatory)][object]$Observation,
    [Parameter(Mandatory)][object]$Configuration,
    [Parameter(Mandatory)][object]$Binding
  )
  $properties = @(
    'schemaVersion', 'profile', 'startedAt', 'endedAt', 'durationMs', 'surface', 'sourceSha',
    'authorizedIdentitySha256', 'projectName', 'projectIdSha256', 'rootDirectory', 'deploymentId',
    'deploymentStatus', 'deploymentCommitSha', 'stableOrigin', 'functionRegion', 'protected',
    'identityMode', 'adminIdentityActivated', 'publicIndexingEnabled', 'tokensRetained',
    'cookiesRetained', 'responseBodiesRetained', 'restrictedValueMatches', 'headers', 'routes'
  )
  Assert-ExactProperties $Observation $properties "The hosted observation" | Out-Null
  if (-not (Test-JsonInteger $Observation.schemaVersion) -or [long]$Observation.schemaVersion -ne 1 -or
    [string]$Observation.profile -cne $profile -or
    -not (Test-CanonicalTimestamp $Observation.startedAt) -or
    -not (Test-CanonicalTimestamp $Observation.endedAt) -or
    -not (Test-JsonInteger $Observation.durationMs) -or [long]$Observation.durationMs -lt 0 -or
    [long]$Observation.durationMs -gt 3600000 -or
    [DateTimeOffset]::Parse([string]$Observation.endedAt) -lt [DateTimeOffset]::Parse([string]$Observation.startedAt)) {
    throw "The hosted observation envelope is not canonical or bounded."
  }
  if ([string]$Observation.surface -cne [string]$Configuration.Name -or
    [string]$Observation.sourceSha -cne $SourceSha -or
    [string]$Observation.authorizedIdentitySha256 -cne (Get-TextSha256 $AuthorizedVercelIdentity) -or
    [string]$Observation.projectName -cne $ExpectedProjectName -or
    [string]$Observation.projectIdSha256 -cne (Get-TextSha256 ([string]$Binding.projectId)) -or
    [string]$Observation.rootDirectory -cne [string]$Configuration.RootDirectory -or
    [string]$Observation.deploymentId -cnotmatch '^dpl_[A-Za-z0-9]{8,96}$' -or
    [string]$Observation.deploymentStatus -cne "READY" -or
    [string]$Observation.deploymentCommitSha -cne $SourceSha -or
    [string]$Observation.stableOrigin -cne $StableOrigin -or
    [string]$Observation.functionRegion -cne "iad1") {
    throw "The hosted deployment is not cross-bound to the reviewed source, identity, project, host, and region."
  }
  Assert-Boolean $Observation.protected $true "Deployment protection" | Out-Null
  Assert-Boolean $Observation.adminIdentityActivated $false "Admin identity activation" | Out-Null
  Assert-Boolean $Observation.publicIndexingEnabled $false "Public indexing" | Out-Null
  if ($Configuration.Name -ceq "admin" -and [string]$Observation.identityMode -cne "identity-dark") {
    throw "Admin hosted acceptance remains identity-dark until separately authorized."
  }
  if ($Configuration.Name -ceq "candidate" -and
    [string]$Observation.identityMode -cne "identity-dark" -and
    [string]$Observation.identityMode -cne "candidate-managed-oidc") {
    throw "The candidate identity mode is not recognized."
  }
  foreach ($counter in @('tokensRetained', 'cookiesRetained', 'responseBodiesRetained', 'restrictedValueMatches')) {
    if (-not (Test-JsonInteger $Observation.$counter) -or [long]$Observation.$counter -ne 0) {
      throw "Hosted acceptance must retain zero $counter."
    }
  }

  $headerProperties = @(
    'strictTransportSecurity', 'xContentTypeOptions', 'xFrameOptions', 'referrerPolicy',
    'permissionsPolicy', 'crossOriginOpenerPolicy', 'contentSecurityPolicy', 'xRobotsTag'
  )
  Assert-ExactProperties $Observation.headers $headerProperties "The sanitized security-header aggregate" | Out-Null
  if ([string]$Observation.headers.strictTransportSecurity -cne "max-age=31536000" -or
    [string]$Observation.headers.xContentTypeOptions -cne "nosniff" -or
    [string]$Observation.headers.xFrameOptions -cne "DENY" -or
    [string]$Observation.headers.referrerPolicy -cne "no-referrer" -or
    [string]$Observation.headers.permissionsPolicy -cne "camera=(), geolocation=(), microphone=(), payment=(), usb=()" -or
    [string]$Observation.headers.crossOriginOpenerPolicy -cne "same-origin" -or
    [string]$Observation.headers.contentSecurityPolicy -cne "base-uri 'self'; frame-ancestors 'none'; object-src 'none'" -or
    [string]$Observation.headers.xRobotsTag -cne [string]$Configuration.RequiredRobotsHeader) {
    throw "The hosted security-header aggregate does not match the source-owned policy."
  }

  $routes = @($Observation.routes)
  if ($routes.Count -ne 3) { throw "The hosted route matrix must contain exactly three bounded checks." }
  $expectedRoutes = @(
    [pscustomobject]@{ Kind = "root"; Path = "/"; Statuses = @(200); NoStore = $false },
    [pscustomobject]@{ Kind = "unknown"; Path = "/phase1-generated-synthetic-unknown"; Statuses = @(404); NoStore = $false },
    [pscustomobject]@{ Kind = "unauthenticated-bff"; Path = $Configuration.BffPath; Statuses = @(401, 503); NoStore = $true }
  )
  for ($index = 0; $index -lt $expectedRoutes.Count; $index += 1) {
    $route = $routes[$index]
    $expected = $expectedRoutes[$index]
    Assert-ExactProperties $route @('kind', 'path', 'status', 'noStore') "Hosted route matrix item $index" | Out-Null
    if ([string]$route.kind -cne $expected.Kind -or [string]$route.path -cne $expected.Path -or
      -not (Test-JsonInteger $route.status) -or [long]$route.status -notin @($expected.Statuses)) {
      throw "Hosted route matrix item $index is not the exact bounded route/status check."
    }
    Assert-Boolean $route.noStore $expected.NoStore "Hosted route matrix item $index no-store result" | Out-Null
  }
  return $true
}

function New-PreflightAggregate {
  param([Parameter(Mandatory)][object]$Configuration, [Parameter(Mandatory)][object]$Binding, [Parameter(Mandatory)][bool]$ProviderContacted)
  return [ordered]@{
    profile = "d1_vercel_hosted_preflight_v1"
    surface = $Configuration.Name
    sourceSha = $SourceSha
    projectName = $ExpectedProjectName
    projectIdSha256 = Get-TextSha256 ([string]$Binding.projectId)
    rootDirectory = $Configuration.RootDirectory
    cliVersion = $vercelCliVersion
    exactIdentityValidated = $ProviderContacted
    isolatedProjectBindingValidated = $true
    providerContacted = $ProviderContacted
    providerMutationAttempted = $false
    adminIdentityActivated = $false
    publicIndexingEnabled = $false
  }
}

Assert-InputBoundary
$configuration = Get-SurfaceConfiguration $Surface
Assert-ExactSource | Out-Null
Assert-SourceHostingConfiguration $configuration

if ($Action -ceq "Validate") {
  [ordered]@{
    profile = "d1_vercel_hosted_source_validation_v1"
    surface = $configuration.Name
    sourceSha = $SourceSha
    rootDirectory = $configuration.RootDirectory
    cliVersionPinned = $vercelCliVersion
    exactNonZachIdentityDeclared = $true
    providerContacted = $false
    providerMutationAttempted = $false
    adminIdentityActivated = $false
    publicIndexingEnabled = $false
  } | ConvertTo-Json -Depth 10
  exit 0
}

$binding = Read-ProjectBinding $configuration
Assert-ReadOnlyProviderPreflight
if ($Action -ceq "Preflight") {
  New-PreflightAggregate $configuration $binding $true | ConvertTo-Json -Depth 10
  exit 0
}

$observationPath = Resolve-ObservationPath
if ((Get-FileSha256 $observationPath) -cne $ReviewedObservationSha256) {
  throw "The aggregate hosted observation checksum is not the reviewed checksum."
}
$observation = ConvertFrom-BoundedFile $observationPath "The aggregate hosted observation"
Assert-HostedObservation $observation $configuration $binding | Out-Null
$observation | ConvertTo-Json -Depth 20
