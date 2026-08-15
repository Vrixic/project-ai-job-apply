$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$verifierPath = Join-Path $repositoryRoot "scripts\verify-d1-004-catalog-invariants.ps1"
if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
  throw "The D1-004 catalog invariant verifier is missing."
}

$source = Get-Content -LiteralPath $verifierPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) {
  throw "The D1-004 catalog invariant verifier did not parse."
}

$inventoryFunction = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Get-D1CatalogTestInventory"
    }, $true))
if ($inventoryFunction.Count -ne 1) {
  throw "The verifier must define the exact inventory once."
}
Invoke-Expression $inventoryFunction[0].Extent.Text

function New-ExpectedEntry {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string[]]$RepositoryPaths
  )
  return [pscustomobject]@{
    Mode = $Mode
    Name = $Name
    Executable = $Executable
    Arguments = @($Arguments)
    RepositoryPaths = @($RepositoryPaths)
  }
}

$expectedInventory = @(
  New-ExpectedEntry -Mode "Unit" -Name "Generate API contracts" -Executable "pnpm" `
    -Arguments @("contracts:generate") `
    -RepositoryPaths @("packages/api-contracts/package.json", "packages/api-contracts/openapi/platform.v1.json")
  New-ExpectedEntry -Mode "Unit" -Name "Verify generated API contracts are current" -Executable "git" `
    -Arguments @("diff", "--exit-code", "--", "packages/api-contracts/generated") `
    -RepositoryPaths @("packages/api-contracts/generated")
  New-ExpectedEntry -Mode "Unit" -Name "D1-004 API contract invariants" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/api-contracts", "exec", "vitest", "run", "src/contracts.test.ts") `
    -RepositoryPaths @("packages/api-contracts/src/contracts.test.ts")
  New-ExpectedEntry -Mode "Unit" -Name "D1-004 domain schema invariants" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/domain", "exec", "vitest", "run", "src/schemas.test.ts") `
    -RepositoryPaths @("packages/domain/src/schemas.test.ts")
  New-ExpectedEntry -Mode "Unit" -Name "D1-004 Jobs catalog invariants" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/jobs-service", "exec", "vitest", "run", "src/domain/canonical-job.test.ts", "src/persistence/catalog.test.ts") `
    -RepositoryPaths @("backend/services/jobs/src/domain/canonical-job.test.ts", "backend/services/jobs/src/persistence/catalog.test.ts")
  New-ExpectedEntry -Mode "Unit" -Name "D1-004 gateway catalog invariants" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/gateway", "exec", "vitest", "run", "src/app.test.ts", "src/lambda.test.ts", "src/job-search-cursor-key.test.ts") `
    -RepositoryPaths @("backend/gateway/src/app.test.ts", "backend/gateway/src/lambda.test.ts", "backend/gateway/src/job-search-cursor-key.test.ts")
  New-ExpectedEntry -Mode "Unit" -Name "API contracts focused typecheck" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/api-contracts", "typecheck") `
    -RepositoryPaths @("packages/api-contracts/tsconfig.json")
  New-ExpectedEntry -Mode "Unit" -Name "Domain focused typecheck" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/domain", "typecheck") `
    -RepositoryPaths @("packages/domain/tsconfig.json")
  New-ExpectedEntry -Mode "Unit" -Name "Jobs focused typecheck" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/jobs-service", "typecheck") `
    -RepositoryPaths @("backend/services/jobs/tsconfig.json")
  New-ExpectedEntry -Mode "Unit" -Name "Gateway focused typecheck" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/gateway", "typecheck") `
    -RepositoryPaths @("backend/gateway/tsconfig.json")
  New-ExpectedEntry -Mode "Unit" -Name "Gateway boundary verifier self-test" -Executable "pwsh" `
    -Arguments @("-NoProfile", "-File", "scripts/tests/gateway-boundary-verifier.tests.ps1") `
    -RepositoryPaths @("scripts/verify-gateway-lambda-boundary.ps1", "scripts/tests/gateway-boundary-verifier.tests.ps1")
  New-ExpectedEntry -Mode "PostgreSql" -Name "D1-004 PostgreSQL catalog invariants" -Executable "pnpm" `
    -Arguments @("--filter", "@ai-job-apply/jobs-service", "exec", "vitest", "run", "--config", "vitest.integration.config.ts", "src/persistence/catalog.integration.test.ts") `
    -RepositoryPaths @("backend/services/jobs/vitest.integration.config.ts", "backend/services/jobs/src/persistence/catalog.integration.test.ts")
)

$inventory = @(Get-D1CatalogTestInventory)
if ($inventory.Count -ne $expectedInventory.Count -or
    (@($inventory | ForEach-Object { [string]$_.Mode }) -join "|") -cne
    "Unit|Unit|Unit|Unit|Unit|Unit|Unit|Unit|Unit|Unit|Unit|PostgreSql") {
  throw "The verifier inventory must contain the exact ordered authoritative Unit packet followed by PostgreSql."
}

for ($index = 0; $index -lt $expectedInventory.Count; $index += 1) {
  $actual = $inventory[$index]
  $expected = $expectedInventory[$index]
  if ([string]$actual.Mode -cne [string]$expected.Mode -or
      [string]$actual.Name -cne [string]$expected.Name -or
      [string]$actual.Executable -cne [string]$expected.Executable -or
      (@($actual.Arguments) -join "|") -cne (@($expected.Arguments) -join "|") -or
      (@($actual.RepositoryPaths) -join "|") -cne (@($expected.RepositoryPaths) -join "|")) {
    throw "The D1-004 inventory entry at index $index changed."
  }
  foreach ($relativePath in @($actual.RepositoryPaths)) {
    $resolvedPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot ([string]$relativePath)))
    if (-not (Test-Path -LiteralPath $resolvedPath)) {
      throw "The D1-004 inventory references a missing test, configuration, contract, or generated path."
    }
  }
}

if ($source -match '(?i)passWithNoTests') {
  throw "The D1-004 verifier must never permit an empty test selection."
}

$commandAsts = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.CommandAst]
    }, $true))
foreach ($forbiddenCommand in @("aws", "terraform", "docker", "docker-compose")) {
  if (@($commandAsts | Where-Object { $_.GetCommandName() -ceq $forbiddenCommand }).Count -ne 0) {
    throw "The D1-004 verifier must not invoke cloud or dependency lifecycle commands."
  }
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("d1-004-verifier-tests-{0}" -f [guid]::NewGuid().ToString("N"))
$isWindowsPlatform = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$capturePath = Join-Path $temporaryRoot "commands.log"
$originalPath = $env:PATH
$originalDatabaseUrl = $env:DATABASE_URL
$originalCi = $env:CI
$originalCapture = $env:D1_004_CAPTURE_PATH
$originalPnpmExitCode = $env:D1_004_FAKE_PNPM_EXIT_CODE
$originalGitExitCode = $env:D1_004_FAKE_GIT_EXIT_CODE
$originalPwshExitCode = $env:D1_004_FAKE_PWSH_EXIT_CODE

function Write-FakeExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ExitVariable
  )

  $fakePath = Join-Path $temporaryRoot $(if ($isWindowsPlatform) { "$Name.cmd" } else { $Name })
  if ($isWindowsPlatform) {
    $template = @'
@echo off
echo __LABEL__^|%*>>"%D1_004_CAPTURE_PATH%"
exit /b %__EXIT_VARIABLE__%
'@
    $content = $template.Replace("__LABEL__", $Label).Replace("__EXIT_VARIABLE__", $ExitVariable)
    [IO.File]::WriteAllText($fakePath, $content, [Text.Encoding]::ASCII)
    return
  }

  $template = @'
#!/usr/bin/env sh
printf '%s|%s\n' '__LABEL__' "$*" >> "$D1_004_CAPTURE_PATH"
exit "${__EXIT_VARIABLE__:-0}"
'@
  $content = $template.Replace("__LABEL__", $Label).Replace("__EXIT_VARIABLE__", $ExitVariable)
  $content = $content.Replace("`r`n", "`n")
  [IO.File]::WriteAllText($fakePath, $content, [Text.UTF8Encoding]::new($false))
  & chmod +x -- $fakePath
  if ($LASTEXITCODE -ne 0) {
    throw "The cross-platform fake $Name command could not be made executable."
  }
}

function Reset-Capture {
  if (Test-Path -LiteralPath $capturePath -PathType Leaf) {
    Remove-Item -LiteralPath $capturePath -Force
  }
}

function Get-CapturedCommands {
  if (-not (Test-Path -LiteralPath $capturePath -PathType Leaf)) {
    return @()
  }
  return @(Get-Content -LiteralPath $capturePath)
}

function Invoke-VerifierCase {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [switch]$AllowNonLocalCiDatabase
  )

  $arguments = @{ Mode = $Mode }
  if ($AllowNonLocalCiDatabase) {
    $arguments.AllowNonLocalCiDatabase = $true
  }
  try {
    $script:lastVerifierError = ""
    $null = & $verifierPath @arguments
    return 0
  } catch {
    $script:lastVerifierError = [string]$_.Exception.Message
    return 1
  }
}

$expectedUnitCommands = @(
  "pnpm|contracts:generate",
  "git|diff --exit-code -- packages/api-contracts/generated",
  "pnpm|--filter @ai-job-apply/api-contracts exec vitest run src/contracts.test.ts",
  "pnpm|--filter @ai-job-apply/domain exec vitest run src/schemas.test.ts",
  "pnpm|--filter @ai-job-apply/jobs-service exec vitest run src/domain/canonical-job.test.ts src/persistence/catalog.test.ts",
  "pnpm|--filter @ai-job-apply/gateway exec vitest run src/app.test.ts src/lambda.test.ts src/job-search-cursor-key.test.ts",
  "pnpm|--filter @ai-job-apply/api-contracts typecheck",
  "pnpm|--filter @ai-job-apply/domain typecheck",
  "pnpm|--filter @ai-job-apply/jobs-service typecheck",
  "pnpm|--filter @ai-job-apply/gateway typecheck",
  "pwsh|-NoProfile -File scripts/tests/gateway-boundary-verifier.tests.ps1"
)
$expectedPostgreSqlCommand = "pnpm|--filter @ai-job-apply/jobs-service exec vitest run --config vitest.integration.config.ts src/persistence/catalog.integration.test.ts"

try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  Write-FakeExecutable -Name "pnpm" -Label "pnpm" -ExitVariable "D1_004_FAKE_PNPM_EXIT_CODE"
  Write-FakeExecutable -Name "git" -Label "git" -ExitVariable "D1_004_FAKE_GIT_EXIT_CODE"
  Write-FakeExecutable -Name "pwsh" -Label "pwsh" -ExitVariable "D1_004_FAKE_PWSH_EXIT_CODE"

  $env:PATH = "$temporaryRoot$([IO.Path]::PathSeparator)$originalPath"
  $env:D1_004_CAPTURE_PATH = $capturePath
  $env:D1_004_FAKE_PNPM_EXIT_CODE = "0"
  $env:D1_004_FAKE_GIT_EXIT_CODE = "0"
  $env:D1_004_FAKE_PWSH_EXIT_CODE = "0"
  $env:CI = $null
  $env:DATABASE_URL = $null

  Reset-Capture
  if ((Invoke-VerifierCase -Mode "Unit") -ne 0) {
    throw "Unit mode failed with the exact fake command runners: $script:lastVerifierError"
  }
  $unitCommands = @(Get-CapturedCommands)
  if (($unitCommands -join "|") -cne ($expectedUnitCommands -join "|")) {
    throw "Unit mode did not invoke the exact authoritative command packet in order."
  }

  Reset-Capture
  $env:DATABASE_URL = "postgres://catalog_test:local_only@127.0.0.1:55432/catalog_test"
  if ((Invoke-VerifierCase -Mode "PostgreSql") -ne 0 -or
      (@(Get-CapturedCommands) -join "|") -cne $expectedPostgreSqlCommand) {
    throw "PostgreSql mode did not invoke only the exact integration inventory."
  }

  Reset-Capture
  if ((Invoke-VerifierCase -Mode "All") -ne 0) {
    throw "All mode failed with the exact fake command runners: $script:lastVerifierError"
  }
  $allCommands = @(Get-CapturedCommands)
  if (($allCommands -join "|") -cne (@($expectedUnitCommands + $expectedPostgreSqlCommand) -join "|")) {
    throw "All mode did not preserve exact Unit then PostgreSql isolation."
  }

  Reset-Capture
  $env:DATABASE_URL = $null
  if ((Invoke-VerifierCase -Mode "PostgreSql") -eq 0 -or @(Get-CapturedCommands).Count -ne 0) {
    throw "PostgreSql mode did not fail closed before invocation when DATABASE_URL was absent."
  }

  Reset-Capture
  $env:DATABASE_URL = "postgres://catalog_test:synthetic_only@db.example.test:5432/catalog_test"
  $env:CI = "true"
  if ((Invoke-VerifierCase -Mode "PostgreSql") -eq 0 -or @(Get-CapturedCommands).Count -ne 0) {
    throw "PostgreSql mode accepted a nonlocal CI URL without the explicit override."
  }

  Reset-Capture
  if ((Invoke-VerifierCase -Mode "PostgreSql" -AllowNonLocalCiDatabase) -ne 0 -or
      (@(Get-CapturedCommands) -join "|") -cne $expectedPostgreSqlCommand) {
    throw "PostgreSql mode rejected the explicit CI-only nonlocal database boundary."
  }

  $env:DATABASE_URL = "postgres://catalog_test:local_only@localhost:55432/catalog_test"
  $env:CI = $null

  Reset-Capture
  $env:D1_004_FAKE_PNPM_EXIT_CODE = "23"
  if ((Invoke-VerifierCase -Mode "Unit") -ne 1 -or $script:lastVerifierError -notmatch 'Generate API contracts failed with exit code 23') {
    throw "The verifier did not propagate a failing first pnpm command."
  }
  if ((@(Get-CapturedCommands) -join "|") -cne $expectedUnitCommands[0]) {
    throw "The verifier did not stop immediately after the failing first command."
  }

  Reset-Capture
  $env:D1_004_FAKE_PNPM_EXIT_CODE = "0"
  $env:D1_004_FAKE_GIT_EXIT_CODE = "24"
  if ((Invoke-VerifierCase -Mode "Unit") -ne 1 -or $script:lastVerifierError -notmatch 'generated API contracts are current failed with exit code 24') {
    throw "The verifier did not propagate a generated-contract diff failure."
  }
  if ((@(Get-CapturedCommands) -join "|") -cne (@($expectedUnitCommands[0..1]) -join "|")) {
    throw "The verifier did not stop immediately after the generated-contract diff failure."
  }

  Reset-Capture
  $env:D1_004_FAKE_GIT_EXIT_CODE = "0"
  $env:D1_004_FAKE_PWSH_EXIT_CODE = "25"
  if ((Invoke-VerifierCase -Mode "Unit") -ne 1 -or $script:lastVerifierError -notmatch 'Gateway boundary verifier self-test failed with exit code 25') {
    throw "The verifier did not propagate a child PowerShell boundary-test failure."
  }
  if ((@(Get-CapturedCommands) -join "|") -cne ($expectedUnitCommands -join "|")) {
    throw "The verifier changed command ordering before the boundary-test failure."
  }
} finally {
  $env:PATH = $originalPath
  $env:DATABASE_URL = $originalDatabaseUrl
  $env:CI = $originalCi
  $env:D1_004_CAPTURE_PATH = $originalCapture
  $env:D1_004_FAKE_PNPM_EXIT_CODE = $originalPnpmExitCode
  $env:D1_004_FAKE_GIT_EXIT_CODE = $originalGitExitCode
  $env:D1_004_FAKE_PWSH_EXIT_CODE = $originalPwshExitCode
  if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

Write-Host "D1-004 catalog invariant verifier tests passed."
