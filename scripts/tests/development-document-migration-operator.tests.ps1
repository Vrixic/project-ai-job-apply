$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-document-migration.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$tokens,
  [ref]$errors
)
if (@($errors).Count -ne 0) { throw "The development migration operator did not parse." }

$pathFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq "Resolve-OperatorPath"
    }, $true))
if ($pathFunctions.Count -ne 1) { throw "Resolve-OperatorPath must be defined exactly once." }
Invoke-Expression $pathFunctions[0].Extent.Text

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-migration"

$relative = Resolve-OperatorPath `
  -Candidate ".terraform\development-document-migration\test.json" `
  -RequireOperatorRoot
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "test.json"))
if ($relative -cne $expected) { throw "The relative operator path did not resolve exactly." }

$absolute = Resolve-OperatorPath -Candidate $expected -RequireOperatorRoot
if ($absolute -cne $expected) { throw "The absolute operator path did not resolve exactly." }

$traversalRejected = $false
try {
  $null = Resolve-OperatorPath -Candidate "..\outside.tfplan"
} catch {
  $traversalRejected = $true
}
if (-not $traversalRejected) { throw "The path resolver accepted a traversal outside .terraform." }

Write-Host "Development document migration operator path tests passed."
