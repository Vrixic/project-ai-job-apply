$ErrorActionPreference = 'Stop'
$actualRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$publisher = Get-Content (Join-Path $actualRoot 'scripts/publish-development-migration-image.ps1') -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($publisher, [ref]$tokens, [ref]$errors)
if (@($errors).Count) { throw 'Publisher failed to parse.' }
$functions = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-CallerToolsAndSource'
}, $true))
if ($functions.Count -ne 1) { throw 'Expected the actual publisher source guard.' }
Invoke-Expression $functions[0].Extent.Text
if (-not $publisher.Contains('-AllowMergedSource:($Action -eq "Verify")')) {
  throw 'Historical source verification must be confined to read-only Verify.'
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('migration-source-' + [guid]::NewGuid().ToString('N'))
$repositoryRoot = $fixtureRoot
$SourceSha = ''
$checks = 0
function Invoke-FixtureGit {
  param([string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell treats successful Git checkout notices as error records.
    $ErrorActionPreference = 'Continue'
    $result = @(& git -C $fixtureRoot @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($exitCode -ne 0) { throw 'Fixture Git operation failed.' }
  return ($result -join "`n").Trim()
}
function Assert-SourceAccepted {
  param([switch]$Historical)
  $result = Assert-CallerToolsAndSource -RequireExplicitSource -AllowMergedSource:$Historical
  if ($result -cne $mainHead) { throw 'Source verification changed the checkout identity.' }
  $script:checks++
}
function Assert-SourceRejected {
  param([switch]$Historical)
  $rejected = $false
  try { $null = Assert-CallerToolsAndSource -RequireExplicitSource -AllowMergedSource:$Historical }
  catch { $rejected = $true }
  if (-not $rejected) { throw 'Unsafe source accepted.' }
  $script:checks++
}
try {
  $null = New-Item -ItemType Directory -Path $fixtureRoot
  $null = Invoke-FixtureGit @('init', '--initial-branch=main')
  $null = Invoke-FixtureGit @('config', 'user.name', 'Generated source fixture')
  $null = Invoke-FixtureGit @('config', 'user.email', 'fixture@example.invalid')
  $null = Invoke-FixtureGit @('config', 'core.autocrlf', 'false')
  $tracked = Join-Path $fixtureRoot 'source.txt'
  [IO.File]::WriteAllText($tracked, "published runtime`n")
  $null = Invoke-FixtureGit @('add', 'source.txt')
  $null = Invoke-FixtureGit @('commit', '-m', 'Published source')
  $published = Invoke-FixtureGit @('rev-parse', 'HEAD')
  [IO.File]::WriteAllText((Join-Path $fixtureRoot 'evidence.txt'), "Recorded acceptance`n")
  $null = Invoke-FixtureGit @('add', 'evidence.txt')
  $null = Invoke-FixtureGit @('commit', '-m', 'Later evidence')
  $mainHead = Invoke-FixtureGit @('rev-parse', 'HEAD')
  $null = Invoke-FixtureGit @('update-ref', 'refs/remotes/origin/main', $mainHead)

  $SourceSha = $mainHead
  Assert-SourceAccepted
  Assert-SourceAccepted -Historical
  $SourceSha = $published
  Assert-SourceRejected
  Assert-SourceAccepted -Historical

  $null = Invoke-FixtureGit @('checkout', '-b', 'unmerged', $published)
  [IO.File]::WriteAllText($tracked, "unmerged runtime`n")
  $null = Invoke-FixtureGit @('commit', '-am', 'Unmerged source')
  $unmerged = Invoke-FixtureGit @('rev-parse', 'HEAD')
  $null = Invoke-FixtureGit @('checkout', 'main')
  $SourceSha = $unmerged
  Assert-SourceRejected -Historical
  $SourceSha = 'f' * 40
  Assert-SourceRejected -Historical
  $SourceSha = 'not-a-commit'
  Assert-SourceRejected -Historical

  $SourceSha = $published
  [IO.File]::WriteAllText($tracked, "dirty runtime`n")
  Assert-SourceRejected -Historical
  $null = Invoke-FixtureGit @('checkout', '--', 'source.txt')
  $untracked = Join-Path $fixtureRoot 'untracked.txt'
  [IO.File]::WriteAllText($untracked, 'untracked')
  Assert-SourceRejected -Historical
  Remove-Item -LiteralPath $untracked
  $null = Invoke-FixtureGit @('update-ref', 'refs/remotes/origin/main', $published)
  Assert-SourceRejected -Historical
  $null = Invoke-FixtureGit @('update-ref', 'refs/remotes/origin/main', $mainHead)
  $null = Invoke-FixtureGit @('checkout', 'unmerged')
  Assert-SourceRejected -Historical
  $null = Invoke-FixtureGit @('checkout', '--detach', $mainHead)
  Assert-SourceRejected -Historical
  $null = Invoke-FixtureGit @('checkout', 'main')
  Assert-SourceAccepted -Historical
  # Verification can attest an old image after later runtime work, without calling it current.
  [IO.File]::WriteAllText($tracked, "later runtime`n")
  $null = Invoke-FixtureGit @('commit', '-am', 'Later runtime')
  $mainHead = Invoke-FixtureGit @('rev-parse', 'HEAD')
  $null = Invoke-FixtureGit @('update-ref', 'refs/remotes/origin/main', $mainHead)
  Assert-SourceAccepted -Historical
  Assert-SourceRejected
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -cnotmatch '^migration-source-[a-f0-9]{32}$') {
    throw 'Unsafe fixture cleanup path.'
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Host "Migration source verification passed $checks real-Git checks without AWS or Docker."
