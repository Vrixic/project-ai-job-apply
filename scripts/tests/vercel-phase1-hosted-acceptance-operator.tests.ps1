Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-vercel-phase1-hosted-acceptance.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "The Vercel hosted-acceptance operator does not parse." }

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Operator function $Name must be defined exactly once." }
  Invoke-Expression "function global:$Name $($matches[0].Body.Extent.Text)"
}

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Description)
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw "$Description was accepted." }
}

$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$expectedParameters = @(
  "Action", "Surface", "SourceSha", "AuthorizedVercelIdentity", "ExpectedProjectName",
  "StableOrigin", "HostedObservationPath", "ReviewedObservationSha256", "Help"
)
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The Vercel hosted-acceptance operator public parameter surface changed."
}

foreach ($requiredText in @(
    '[ValidateSet("Validate", "Preflight", "Verify")]',
    '[ValidateSet("Candidate", "Admin")]',
    '"vercel@59.6.2"',
    '@("--version")',
    '@("whoami")',
    '"frontend/web"',
    '"frontend/admin"',
    '"d1_vercel_hosted_acceptance_v1"',
    'Assert-DependencyPatchBoundary | Out-Null',
    'clean main with HEAD and origin/main exactly equal to SourceSha.',
    '"Admin identity activation"',
    '"Public indexing"'
  )) {
  if (-not $source.Contains($requiredText)) { throw "The operator is missing required contract text '$requiredText'." }
}
foreach ($forbiddenText in @(
    "vercel@latest", "--token", "Invoke-WebRequest", "Invoke-RestMethod",
    "Start-Process", "Invoke-Expression"
  )) {
  if ($source -match [regex]::Escape($forbiddenText)) {
    throw "The read-only Vercel operator contains forbidden effect '$forbiddenText'."
  }
}
foreach ($forbiddenVercelArgument in @("login", "logout", "link", "deploy", "promote", "rollback", "env")) {
  if ($source -match ('@\(\s*"' + [regex]::Escape($forbiddenVercelArgument) + '"')) {
    throw "The read-only Vercel operator invokes forbidden Vercel action '$forbiddenVercelArgument'."
  }
}
if ([regex]::Matches($source, '& pnpm dlx \$vercelCliPackage').Count -ne 1) {
  throw "The Vercel CLI must have one centralized pinned invocation boundary."
}

foreach ($name in @(
    "Get-FileSha256", "Get-TextSha256", "ConvertFrom-OperatorJson", "ConvertFrom-BoundedFile", "Assert-ExactProperties",
    "Invoke-GitText", "Assert-DependencyPatchBoundary",
    "Assert-ExactVercelIgnoreBoundary", "Test-CanonicalTimestamp", "Get-SurfaceConfiguration", "Read-ProjectBinding",
    "Assert-ExactHttpsOrigin", "Assert-InputBoundary", "Assert-Boolean", "Test-JsonInteger",
    "Assert-HostedObservation"
  )) { Import-OperatorFunction $name }

$SourceSha = "a" * 40
$AuthorizedVercelIdentity = "approved-owner"
$ExpectedProjectName = "ai-job-apply-candidate"
$StableOrigin = "https://candidate.example.com"
$HostedObservationPath = "observation.json"
$ReviewedObservationSha256 = "b" * 64
$Action = "Verify"
$profile = "d1_vercel_hosted_acceptance_v1"
$maximumObservationAge = [TimeSpan]::FromMinutes(30)
$maximumObservationClockSkew = [TimeSpan]::FromMinutes(5)

function New-Observation {
  param([Parameter(Mandatory)][object]$Configuration, [Parameter(Mandatory)][object]$Binding)
  $robots = if ($Configuration.Name -ceq "admin") { "noindex, nofollow, noarchive" } else { "noindex" }
  $mode = if ($Configuration.Name -ceq "admin") { "identity-dark" } else { "candidate-managed-oidc" }
  $endedAt = [DateTimeOffset]::UtcNow.AddSeconds(-1)
  $startedAt = $endedAt.AddSeconds(-1)
  return [ordered]@{
    schemaVersion = 1
    profile = $profile
    startedAt = $startedAt.ToString("o")
    endedAt = $endedAt.ToString("o")
    durationMs = 1000
    surface = $Configuration.Name
    sourceSha = $SourceSha
    authorizedIdentitySha256 = Get-TextSha256 $AuthorizedVercelIdentity
    projectName = $ExpectedProjectName
    projectIdSha256 = Get-TextSha256 ([string]$Binding.projectId)
    rootDirectory = $Configuration.RootDirectory
    deploymentId = "dpl_1234567890abcdef"
    deploymentStatus = "READY"
    deploymentCommitSha = $SourceSha
    stableOrigin = $StableOrigin
    functionRegion = "iad1"
    protected = $true
    identityMode = $mode
    adminIdentityActivated = $false
    publicIndexingEnabled = $false
    tokensRetained = 0
    cookiesRetained = 0
    responseBodiesRetained = 0
    restrictedValueMatches = 0
    headers = [ordered]@{
      strictTransportSecurity = "max-age=31536000"
      xContentTypeOptions = "nosniff"
      xFrameOptions = "DENY"
      referrerPolicy = "no-referrer"
      permissionsPolicy = "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
      crossOriginOpenerPolicy = "same-origin"
      contentSecurityPolicy = "base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
      xRobotsTag = $robots
    }
    routes = @(
      [ordered]@{ kind = "root"; path = "/"; status = 200; noStore = $true },
      [ordered]@{ kind = "unknown"; path = "/phase1-generated-synthetic-unknown"; status = 404; noStore = $false },
      [ordered]@{ kind = "unauthenticated-bff"; path = $Configuration.BffPath; status = 401; noStore = $true }
    )
  }
}

foreach ($validOrigin in @("https://candidate.example.com", "https://admin.example.com")) {
  Assert-ExactHttpsOrigin $validOrigin | Out-Null
}
foreach ($invalidOrigin in @(
    "http://candidate.example.com", "https://candidate.example.com/", "https://user@candidate.example.com",
    "https://candidate.example.com/path", "https://candidate.example.com?x=1",
    "https://candidate.example.com#fragment", "https://candidate.example.com.",
    "https://LOCALHOST", " https://candidate.example.com"
  )) { Assert-Rejected { Assert-ExactHttpsOrigin $invalidOrigin } "invalid stable origin $invalidOrigin" }

foreach ($invalidIdentity in @("zach", "zach-becker", "ZBecker", "approved owner", " approved-owner", "")) {
  $AuthorizedVercelIdentity = $invalidIdentity
  Assert-Rejected { Assert-InputBoundary } "invalid or prohibited Vercel identity '$invalidIdentity'"
}
$AuthorizedVercelIdentity = "approved-owner"
Assert-InputBoundary
Assert-DependencyPatchBoundary | Out-Null

$originalRepositoryRoot = $repositoryRoot
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "vercel-hosted-operator-$PID-$([guid]::NewGuid().ToString('N'))"
try {
  $vercelIgnorePath = Join-Path $temporaryRoot ".vercelignore"
  $null = New-Item -ItemType Directory -Path $temporaryRoot -Force
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot ".vercelignore") -Destination $vercelIgnorePath
  Assert-ExactVercelIgnoreBoundary $vercelIgnorePath | Out-Null
  Add-Content -LiteralPath $vercelIgnorePath -Value "!docs/"
  Assert-Rejected { Assert-ExactVercelIgnoreBoundary $vercelIgnorePath } "broadened Vercel upload boundary"
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot ".vercelignore") -Destination $vercelIgnorePath -Force
  $tamperedIgnore = (Get-Content -LiteralPath $vercelIgnorePath -Raw).Replace("**/.env*", "**/.env.local")
  [IO.File]::WriteAllText($vercelIgnorePath, $tamperedIgnore)
  Assert-Rejected { Assert-ExactVercelIgnoreBoundary $vercelIgnorePath } "tampered Vercel upload boundary"
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot ".vercelignore") -Destination $vercelIgnorePath -Force
  $nonRecursiveIgnore = (Get-Content -LiteralPath $vercelIgnorePath -Raw).Replace("!frontend/**`r`n", "")
  $nonRecursiveIgnore = $nonRecursiveIgnore.Replace("!frontend/**`n", "")
  [IO.File]::WriteAllText($vercelIgnorePath, $nonRecursiveIgnore)
  Assert-Rejected { Assert-ExactVercelIgnoreBoundary $vercelIgnorePath } "non-recursive Vercel frontend allowlist"
  $canonicalIgnore = Get-Content -LiteralPath (Join-Path $originalRepositoryRoot ".vercelignore") -Raw
  foreach ($patchRule in @("!patches/node-forge@1.4.0.patch", "!patches/braces@3.0.3.patch", "!packages/ats-sdk", "!packages/ats-sdk/**")) {
    [IO.File]::WriteAllText($vercelIgnorePath, $canonicalIgnore.Replace($patchRule, ""))
    Assert-Rejected { Assert-ExactVercelIgnoreBoundary $vercelIgnorePath } "missing required frozen-install or frontend dependency upload rule"
  }
  foreach ($changedIgnore in @(
      $canonicalIgnore.Replace("!patches/image-size@1.2.1.patch", ""),
      $canonicalIgnore.Replace("!patches/image-size@1.2.1.patch", "!patches/**"),
      $canonicalIgnore.Replace("patches/*", ""),
      $canonicalIgnore.Replace("!patches/image-size@1.2.1.patch", "!patches/../private.patch")
    )) {
    [IO.File]::WriteAllText($vercelIgnorePath, $changedIgnore)
    Assert-Rejected { Assert-ExactVercelIgnoreBoundary $vercelIgnorePath } "missing or broadened exact dependency patch upload rule"
  }
  [IO.File]::WriteAllText($vercelIgnorePath, $canonicalIgnore)
  Assert-ExactVercelIgnoreBoundary $vercelIgnorePath | Out-Null

  $repositoryRoot = $temporaryRoot
  $patchDirectory = Join-Path $temporaryRoot "patches"
  $patchPath = Join-Path $patchDirectory "image-size@1.2.1.patch"
  $manifestPath = Join-Path $temporaryRoot "package.json"
  $lockPath = Join-Path $temporaryRoot "pnpm-lock.yaml"
  $null = New-Item -ItemType Directory -Path $patchDirectory
  $approvedPatchPaths = @("patches/image-size@1.2.1.patch", "patches/node-forge@1.4.0.patch", "patches/braces@3.0.3.patch")
  foreach ($relative in $approvedPatchPaths) {
    Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot $relative) -Destination (Join-Path $temporaryRoot $relative)
  }
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot "package.json") -Destination $manifestPath
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot "pnpm-lock.yaml") -Destination $lockPath
  $canonicalManifest = Get-Content -LiteralPath $manifestPath -Raw
  $canonicalLock = (Get-Content -LiteralPath $lockPath -Raw).Replace("`r`n", "`n")
  $trackedPatch = "patches/image-size@1.2.1.patch"
  $trackedPatchOverrides = @{}
  function global:Invoke-GitText {
    param([string[]]$Arguments, [string]$Description)
    if ($Arguments.Count -ne 4 -or ($Arguments[0..2] -join "|") -cne "ls-files|--error-unmatch|--" -or
        $Arguments[3] -cnotin $approvedPatchPaths) {
      throw "Unexpected Git operation in the generated dependency-patch fixture."
    }
    if ($trackedPatchOverrides.ContainsKey($Arguments[3])) { return @($trackedPatchOverrides[$Arguments[3]]) }
    if ($Arguments[3] -ceq "patches/image-size@1.2.1.patch") { return @($trackedPatch) }
    return @($Arguments[3])
  }
  Assert-DependencyPatchBoundary | Out-Null
  foreach ($wrongPath in @("patches/../private.patch", "patches/*.patch", "patches/other.patch", "D:/private.patch")) {
    $changedManifest = ConvertFrom-OperatorJson $canonicalManifest "The generated patch manifest"
    $changedManifest.pnpm.patchedDependencies.'image-size@1.2.1' = $wrongPath
    [IO.File]::WriteAllText($manifestPath, ($changedManifest | ConvertTo-Json -Depth 20))
    Assert-Rejected { Assert-DependencyPatchBoundary } "dependency patch outside the exact approved path"
  }
  foreach ($mutation in @("missing", "additional", "wrong-version")) {
    $changedManifest = ConvertFrom-OperatorJson $canonicalManifest "The generated patch manifest"
    switch ($mutation) {
      "missing" { $changedManifest.pnpm.patchedDependencies.PSObject.Properties.Remove('image-size@1.2.1') }
      "additional" { $changedManifest.pnpm.patchedDependencies | Add-Member -NotePropertyName 'future@1.0.0' -NotePropertyValue 'patches/future.patch' }
      "wrong-version" {
        $changedManifest.pnpm.patchedDependencies.PSObject.Properties.Remove('image-size@1.2.1')
        $changedManifest.pnpm.patchedDependencies | Add-Member -NotePropertyName 'image-size@1.2.2' -NotePropertyValue 'patches/image-size@1.2.1.patch'
      }
    }
    [IO.File]::WriteAllText($manifestPath, ($changedManifest | ConvertTo-Json -Depth 20))
    Assert-Rejected { Assert-DependencyPatchBoundary } "changed dependency patch declaration '$mutation'"
  }
  [IO.File]::WriteAllText($manifestPath, $canonicalManifest)
  Assert-DependencyPatchBoundary | Out-Null
  Remove-Item -LiteralPath $patchPath
  Assert-Rejected { Assert-DependencyPatchBoundary } "missing dependency patch file"
  [IO.File]::WriteAllText($patchPath, "generated changed patch bytes")
  Assert-Rejected { Assert-DependencyPatchBoundary } "changed dependency patch bytes"
  Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot "patches/image-size@1.2.1.patch") -Destination $patchPath -Force
  foreach ($invalidTracking in @("", "patches/other.patch")) {
    $trackedPatch = $invalidTracking
    Assert-Rejected { Assert-DependencyPatchBoundary } "untracked or differently tracked dependency patch"
  }
  $trackedPatch = "patches/image-size@1.2.1.patch"
  Assert-DependencyPatchBoundary | Out-Null
  $patchSha256 = Get-FileSha256 $patchPath
  foreach ($changedLock in @(
      $canonicalLock.Replace($patchSha256, ("a" * 64)),
      $canonicalLock.Replace("path: patches/image-size@1.2.1.patch", "path: patches/other.patch"),
      $canonicalLock.Replace("patchedDependencies:", "unrelatedDependencies:"),
      $canonicalLock.Replace("    path: patches/image-size@1.2.1.patch", "    path: patches/image-size@1.2.1.patch`n  future@1.0.0:`n    path: patches/future.patch"),
      ($canonicalLock + "`npatchedDependencies:`n  image-size@1.2.1:`n    hash: $patchSha256`n    path: patches/image-size@1.2.1.patch`n")
    )) {
    [IO.File]::WriteAllText($lockPath, $changedLock)
    Assert-Rejected { Assert-DependencyPatchBoundary } "missing, duplicated, or altered lockfile patch binding"
  }
  [IO.File]::WriteAllBytes($lockPath, [byte[]]@(0xff, 0xfe))
  Assert-Rejected { Assert-DependencyPatchBoundary } "non-UTF8 patch lockfile"
  [IO.File]::WriteAllBytes($lockPath, (New-Object byte[] 2097153))
  Assert-Rejected { Assert-DependencyPatchBoundary } "oversized patch lockfile"
  [IO.File]::WriteAllText($lockPath, $canonicalLock)
  Assert-DependencyPatchBoundary | Out-Null
  foreach ($relative in $approvedPatchPaths) {
    $dependency = [IO.Path]::GetFileNameWithoutExtension($relative)
    $currentPatchPath = Join-Path $temporaryRoot $relative
    foreach ($invalidTracking in @("", "patches/other.patch")) {
      $trackedPatchOverrides[$relative] = $invalidTracking
      Assert-Rejected { Assert-DependencyPatchBoundary } "untracked or differently tracked security patch $dependency"
      $trackedPatchOverrides.Remove($relative)
    }
    $changedManifest = ConvertFrom-OperatorJson $canonicalManifest "The generated patch manifest"
    $changedManifest.pnpm.patchedDependencies.PSObject.Properties.Remove($dependency)
    [IO.File]::WriteAllText($manifestPath, ($changedManifest | ConvertTo-Json -Depth 20))
    Assert-Rejected { Assert-DependencyPatchBoundary } "omitted required security patch $dependency"
    [IO.File]::WriteAllText($manifestPath, $canonicalManifest)
    Remove-Item -LiteralPath $currentPatchPath
    Assert-Rejected { Assert-DependencyPatchBoundary } "omitted uploaded security patch $dependency"
    [IO.File]::WriteAllText($currentPatchPath, "generated changed patch bytes")
    Assert-Rejected { Assert-DependencyPatchBoundary } "changed security patch bytes $dependency"
    Copy-Item -LiteralPath (Join-Path $originalRepositoryRoot $relative) -Destination $currentPatchPath -Force
    $currentHash = Get-FileSha256 $currentPatchPath
    foreach ($changedLock in @(
        $canonicalLock.Replace($currentHash, ("a" * 64)),
        $canonicalLock.Replace("path: $relative", "path: patches/other.patch")
      )) {
      [IO.File]::WriteAllText($lockPath, $changedLock)
      Assert-Rejected { Assert-DependencyPatchBoundary } "changed security patch lock binding $dependency"
    }
    [IO.File]::WriteAllText($lockPath, $canonicalLock)
    Assert-DependencyPatchBoundary | Out-Null
  }
  Import-OperatorFunction "Invoke-GitText"

  $candidateProjectRoot = Join-Path $temporaryRoot "frontend\web\.vercel"
  $adminProjectRoot = Join-Path $temporaryRoot "frontend\admin\.vercel"
  $null = New-Item -ItemType Directory -Path $candidateProjectRoot -Force
  $null = New-Item -ItemType Directory -Path $adminProjectRoot -Force
  $candidateProjectPath = Join-Path $candidateProjectRoot "project.json"
  $adminProjectPath = Join-Path $adminProjectRoot "project.json"
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"ai-job-apply-candidate"}')
  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_123","projectId":"prj_admin123","projectName":"ai-job-apply-admin"}')
  $ExpectedProjectName = "ai-job-apply-candidate"
  $candidateConfiguration = Get-SurfaceConfiguration "Candidate"
  $acceptedBinding = Read-ProjectBinding $candidateConfiguration
  if ([string]$acceptedBinding.projectId -cne "prj_candidate123") { throw "The isolated candidate binding was not accepted." }

  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"ai-job-apply-admin"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "one project reused across candidate and admin"
  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_123","projectId":"prj_admin123","projectName":"ai-job-apply-admin"}')
  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_other","projectId":"prj_admin123","projectName":"ai-job-apply-admin"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "projects from different Vercel organizations"
  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_123","projectId":"prj_admin123","projectName":"ai-job-apply-candidate"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "one project name reused across candidate and admin"
  [IO.File]::WriteAllText($adminProjectPath, '{"orgId":"team_123","projectId":"prj_admin123","projectName":"ai-job-apply-admin"}')
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"wrong-project"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "wrong local project name"
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"candidate123","projectName":"ai-job-apply-candidate"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "project binding without a real Vercel project ID"
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"ai-job-apply-candidate","token":"prohibited"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "extra local project binding field"
} finally {
  $repositoryRoot = $originalRepositoryRoot
  Import-OperatorFunction "Invoke-GitText"
  if (Test-Path -LiteralPath $temporaryRoot) {
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTemporaryRoot.StartsWith($temporaryParent, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedTemporaryRoot) -notmatch '^vercel-hosted-operator-[0-9]+-[a-f0-9]{32}$') {
      throw "Refusing cleanup outside the exact generated Vercel operator test directory."
    }
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}

$candidate = Get-SurfaceConfiguration "Candidate"
$candidateBinding = [pscustomobject]@{ orgId = "team_123"; projectId = "prj_candidate123"; projectName = $ExpectedProjectName }
$validCandidate = New-Observation $candidate $candidateBinding
Assert-HostedObservation $validCandidate $candidate $candidateBinding | Out-Null

$candidateBffUnavailable = ConvertFrom-OperatorJson ($validCandidate | ConvertTo-Json -Depth 20) "The 503 candidate fixture"
$candidateBffUnavailable.routes[2].status = 503
Assert-HostedObservation $candidateBffUnavailable $candidate $candidateBinding | Out-Null

$candidateRobotsMissing = ConvertFrom-OperatorJson ($validCandidate | ConvertTo-Json -Depth 20) "The candidate crawler fixture"
$candidateRobotsMissing.headers.xRobotsTag = ""
Assert-Rejected { Assert-HostedObservation $candidateRobotsMissing $candidate $candidateBinding } "candidate crawler denial removed"

$cacheableRoot = ConvertFrom-OperatorJson ($validCandidate | ConvertTo-Json -Depth 20) "The candidate root cache fixture"
$cacheableRoot.routes[0].noStore = $false
Assert-Rejected { Assert-HostedObservation $cacheableRoot $candidate $candidateBinding } "cacheable dynamic root"

$noncacheableUnknown = ConvertFrom-OperatorJson ($validCandidate | ConvertTo-Json -Depth 20) "The candidate unknown-route cache fixture"
$noncacheableUnknown.routes[1].noStore = $true
Assert-Rejected { Assert-HostedObservation $noncacheableUnknown $candidate $candidateBinding } "unexpected unknown-route cache boundary"

$invalidDuration = $validCandidate | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$invalidDuration.durationMs = 999
Assert-Rejected { Assert-HostedObservation $invalidDuration $candidate $candidateBinding } "timestamp/duration mismatch"

$staleObservation = $validCandidate | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$staleEnd = [DateTimeOffset]::UtcNow.Subtract($maximumObservationAge).AddMinutes(-1)
$staleObservation.startedAt = $staleEnd.AddSeconds(-1).ToString("o")
$staleObservation.endedAt = $staleEnd.ToString("o")
Assert-Rejected { Assert-HostedObservation $staleObservation $candidate $candidateBinding } "stale hosted observation"

$futureObservation = $validCandidate | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$futureEnd = [DateTimeOffset]::UtcNow.Add($maximumObservationClockSkew).AddMinutes(1)
$futureObservation.startedAt = $futureEnd.AddSeconds(-1).ToString("o")
$futureObservation.endedAt = $futureEnd.ToString("o")
Assert-Rejected { Assert-HostedObservation $futureObservation $candidate $candidateBinding } "future hosted observation"

$ExpectedProjectName = "ai-job-apply-admin"
$StableOrigin = "https://admin.example.com"
$admin = Get-SurfaceConfiguration "Admin"
$adminBinding = [pscustomobject]@{ orgId = "team_123"; projectId = "prj_admin123"; projectName = $ExpectedProjectName }
$validAdmin = New-Observation $admin $adminBinding
Assert-HostedObservation $validAdmin $admin $adminBinding | Out-Null

foreach ($tamper in @(
    "extra", "source", "identity", "project", "deployment", "commit", "host", "region", "protection",
    "adminIdentity", "indexing", "token", "cookie", "body", "restricted", "header", "robots",
    "routeCount", "routePath", "routeStatus", "routeNoStore", "adminMode"
  )) {
  $candidate = $validAdmin | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  switch ($tamper) {
    "extra" { $candidate | Add-Member -NotePropertyName token -NotePropertyValue "prohibited" }
    "source" { $candidate.sourceSha = "b" * 40 }
    "identity" { $candidate.authorizedIdentitySha256 = "c" * 64 }
    "project" { $candidate.projectIdSha256 = "d" * 64 }
    "deployment" { $candidate.deploymentStatus = "BUILDING" }
    "commit" { $candidate.deploymentCommitSha = "e" * 40 }
    "host" { $candidate.stableOrigin = "https://other.example.com" }
    "region" { $candidate.functionRegion = "sfo1" }
    "protection" { $candidate.protected = $false }
    "adminIdentity" { $candidate.adminIdentityActivated = $true }
    "indexing" { $candidate.publicIndexingEnabled = $true }
    "token" { $candidate.tokensRetained = 1 }
    "cookie" { $candidate.cookiesRetained = 1 }
    "body" { $candidate.responseBodiesRetained = 1 }
    "restricted" { $candidate.restrictedValueMatches = 1 }
    "header" { $candidate.headers.xFrameOptions = "SAMEORIGIN" }
    "robots" { $candidate.headers.xRobotsTag = "" }
    "routeCount" { $candidate.routes = @($candidate.routes[0], $candidate.routes[1]) }
    "routePath" { $candidate.routes[2].path = "/api/arbitrary" }
    "routeStatus" { $candidate.routes[2].status = 200 }
    "routeNoStore" { $candidate.routes[2].noStore = $false }
    "adminMode" { $candidate.identityMode = "candidate-managed-oidc" }
  }
  Assert-Rejected { Assert-HostedObservation $candidate $admin $adminBinding } "hosted observation tampering '$tamper'"
}

$ExpectedProjectName = "ai-job-apply-candidate"
$StableOrigin = "https://candidate.example.com"
Assert-Rejected { Assert-HostedObservation $validAdmin $candidate $candidateBinding } "cross-surface observation reuse"

Write-Output "Vercel Phase 1 hosted-acceptance operator tests passed."
