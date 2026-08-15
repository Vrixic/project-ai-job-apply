[CmdletBinding()]
param(
  [ValidateSet("Unit", "PostgreSql", "All")]
  [string]$Mode = "All",

  [switch]$AllowNonLocalCiDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

function Get-D1CatalogTestInventory {
  return @(
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Generate API contracts"
      Executable = "pnpm"
      Arguments = @("contracts:generate")
      RepositoryPaths = @(
        "packages/api-contracts/package.json",
        "packages/api-contracts/openapi/platform.v1.json"
      )
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Verify generated API contracts are current"
      Executable = "git"
      Arguments = @("diff", "--exit-code", "--", "packages/api-contracts/generated")
      RepositoryPaths = @("packages/api-contracts/generated")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "D1-004 API contract invariants"
      Executable = "pnpm"
      Arguments = @(
        "--filter", "@ai-job-apply/api-contracts", "exec", "vitest", "run",
        "src/contracts.test.ts"
      )
      RepositoryPaths = @("packages/api-contracts/src/contracts.test.ts")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "D1-004 domain schema invariants"
      Executable = "pnpm"
      Arguments = @(
        "--filter", "@ai-job-apply/domain", "exec", "vitest", "run",
        "src/schemas.test.ts"
      )
      RepositoryPaths = @("packages/domain/src/schemas.test.ts")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "D1-004 Jobs catalog invariants"
      Executable = "pnpm"
      Arguments = @(
        "--filter", "@ai-job-apply/jobs-service", "exec", "vitest", "run",
        "src/domain/canonical-job.test.ts",
        "src/persistence/catalog.test.ts"
      )
      RepositoryPaths = @(
        "backend/services/jobs/src/domain/canonical-job.test.ts",
        "backend/services/jobs/src/persistence/catalog.test.ts"
      )
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "D1-004 gateway catalog invariants"
      Executable = "pnpm"
      Arguments = @(
        "--filter", "@ai-job-apply/gateway", "exec", "vitest", "run",
        "src/app.test.ts",
        "src/lambda.test.ts",
        "src/job-search-cursor-key.test.ts"
      )
      RepositoryPaths = @(
        "backend/gateway/src/app.test.ts",
        "backend/gateway/src/lambda.test.ts",
        "backend/gateway/src/job-search-cursor-key.test.ts"
      )
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "API contracts focused typecheck"
      Executable = "pnpm"
      Arguments = @("--filter", "@ai-job-apply/api-contracts", "typecheck")
      RepositoryPaths = @("packages/api-contracts/tsconfig.json")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Domain focused typecheck"
      Executable = "pnpm"
      Arguments = @("--filter", "@ai-job-apply/domain", "typecheck")
      RepositoryPaths = @("packages/domain/tsconfig.json")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Jobs focused typecheck"
      Executable = "pnpm"
      Arguments = @("--filter", "@ai-job-apply/jobs-service", "typecheck")
      RepositoryPaths = @("backend/services/jobs/tsconfig.json")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Gateway focused typecheck"
      Executable = "pnpm"
      Arguments = @("--filter", "@ai-job-apply/gateway", "typecheck")
      RepositoryPaths = @("backend/gateway/tsconfig.json")
    },
    [pscustomobject]@{
      Mode = "Unit"
      Name = "Gateway boundary verifier self-test"
      Executable = "pwsh"
      Arguments = @("-NoProfile", "-File", "scripts/tests/gateway-boundary-verifier.tests.ps1")
      RepositoryPaths = @(
        "scripts/verify-gateway-lambda-boundary.ps1",
        "scripts/tests/gateway-boundary-verifier.tests.ps1"
      )
    },
    [pscustomobject]@{
      Mode = "PostgreSql"
      Name = "D1-004 PostgreSQL catalog invariants"
      Executable = "pnpm"
      Arguments = @(
        "--filter", "@ai-job-apply/jobs-service", "exec", "vitest", "run",
        "--config", "vitest.integration.config.ts",
        "src/persistence/catalog.integration.test.ts"
      )
      RepositoryPaths = @(
        "backend/services/jobs/vitest.integration.config.ts",
        "backend/services/jobs/src/persistence/catalog.integration.test.ts"
      )
    }
  )
}

function Assert-D1CatalogTestInventory {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Inventory
  )

  $allowedExecutables = @("pnpm", "git", "pwsh")
  $repositoryPrefix = $repositoryRoot.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  ) + [IO.Path]::DirectorySeparatorChar

  foreach ($entry in $Inventory) {
    if ([string]$entry.Mode -notin @("Unit", "PostgreSql") -or
        [string]$entry.Executable -notin $allowedExecutables -or
        [string]::IsNullOrWhiteSpace([string]$entry.Name) -or
        @($entry.Arguments).Count -eq 0 -or
        @($entry.RepositoryPaths).Count -eq 0) {
      throw "The exact D1-004 test inventory contains an invalid command entry."
    }
    foreach ($relativePath in @($entry.RepositoryPaths)) {
      $resolvedPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot ([string]$relativePath)))
      if (-not $resolvedPath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $resolvedPath)) {
        throw "The exact D1-004 test inventory contains a missing or invalid repository path."
      }
    }
  }
}

function Assert-D1CatalogDatabaseBoundary {
  if ([string]::IsNullOrWhiteSpace([string]$env:DATABASE_URL)) {
    throw "PostgreSql verification requires an explicit DATABASE_URL."
  }

  $databaseUri = $null
  if (-not [Uri]::TryCreate([string]$env:DATABASE_URL, [UriKind]::Absolute, [ref]$databaseUri) -or
      [string]$databaseUri.Scheme -notin @("postgres", "postgresql") -or
      [string]::IsNullOrWhiteSpace([string]$databaseUri.Host)) {
    throw "DATABASE_URL must be one absolute PostgreSQL connection URL."
  }

  $databaseHost = ([string]$databaseUri.DnsSafeHost).Trim("[", "]").ToLowerInvariant()
  $isLocal = $databaseHost -in @("localhost", "127.0.0.1", "::1")
  $isExplicitCi = $AllowNonLocalCiDatabase.IsPresent -and
    [string]$env:CI -ceq "true"

  if (-not $isLocal -and -not $isExplicitCi) {
    throw "A nonlocal DATABASE_URL is refused unless an explicit CI-only override is active."
  }
}

function Assert-D1CatalogExecutables {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Inventory
  )

  foreach ($executable in @($Inventory | ForEach-Object { [string]$_.Executable } | Sort-Object -Unique)) {
    if (-not (Get-Command $executable -ErrorAction SilentlyContinue)) {
      throw "$executable is required to verify the selected D1-004 catalog invariants."
    }
  }
}

function Invoke-D1CatalogTestEntry {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Entry
  )

  $executable = [string]$Entry.Executable
  $arguments = @($Entry.Arguments)
  & $executable @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$($Entry.Name) failed with exit code $LASTEXITCODE."
  }
}

$inventory = @(Get-D1CatalogTestInventory)
Assert-D1CatalogTestInventory -Inventory $inventory

$selected = @(if ($Mode -ceq "All") {
    $inventory
  } else {
    $inventory | Where-Object { [string]$_.Mode -ceq $Mode }
  })

if ($selected.Count -eq 0) {
  throw "The selected D1-004 verification mode has no exact test inventory."
}

Assert-D1CatalogExecutables -Inventory $selected

if (@($selected | Where-Object { [string]$_.Mode -ceq "PostgreSql" }).Count -eq 1) {
  Assert-D1CatalogDatabaseBoundary
}

Push-Location $repositoryRoot
try {
  foreach ($entry in $selected) {
    Invoke-D1CatalogTestEntry -Entry $entry
  }
} finally {
  Pop-Location
}

Write-Host "D1-004 catalog invariant verification passed ($Mode)."
