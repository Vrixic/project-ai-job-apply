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
    "Get-TextSha256", "ConvertFrom-OperatorJson", "ConvertFrom-BoundedFile", "Assert-ExactProperties",
    "Test-CanonicalTimestamp", "Get-SurfaceConfiguration", "Read-ProjectBinding",
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

function New-Observation {
  param([Parameter(Mandatory)][object]$Configuration, [Parameter(Mandatory)][object]$Binding)
  $robots = if ($Configuration.Name -ceq "admin") { "noindex, nofollow, noarchive" } else { "" }
  $mode = if ($Configuration.Name -ceq "admin") { "identity-dark" } else { "candidate-managed-oidc" }
  return [ordered]@{
    schemaVersion = 1
    profile = $profile
    startedAt = "2026-08-26T12:00:00.0000000+00:00"
    endedAt = "2026-08-26T12:00:01.0000000+00:00"
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
      [ordered]@{ kind = "root"; path = "/"; status = 200; noStore = $false },
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

$originalRepositoryRoot = $repositoryRoot
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "vercel-hosted-operator-$PID-$([guid]::NewGuid().ToString('N'))"
try {
  $repositoryRoot = $temporaryRoot
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
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"wrong-project"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "wrong local project name"
  [IO.File]::WriteAllText($candidateProjectPath, '{"orgId":"team_123","projectId":"prj_candidate123","projectName":"ai-job-apply-candidate","token":"prohibited"}')
  Assert-Rejected { Read-ProjectBinding $candidateConfiguration } "extra local project binding field"
} finally {
  $repositoryRoot = $originalRepositoryRoot
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$candidate = Get-SurfaceConfiguration "Candidate"
$candidateBinding = [pscustomobject]@{ orgId = "team_123"; projectId = "prj_candidate123"; projectName = $ExpectedProjectName }
$validCandidate = New-Observation $candidate $candidateBinding
Assert-HostedObservation $validCandidate $candidate $candidateBinding | Out-Null

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
