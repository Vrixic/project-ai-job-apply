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

$baselineFunctions = @($ast.FindAll({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -in @(
        "ConvertTo-TerraformEnvironmentValue", "Get-MeaningfulChanges", "Assert-PlanWasApplied",
        "Assert-ExactTaskPlan"
      )
    }, $true))
if ($baselineFunctions.Count -ne 4) { throw "The input and plan guards must each be defined once." }
foreach ($function in $baselineFunctions | Sort-Object { $_.Extent.StartOffset }) {
  Invoke-Expression $function.Extent.Text
}

$zeroChangePlan = [pscustomobject]@{
  complete = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = "example" } }
  planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{} }
  resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("no-op") } })
  resource_drift = @()
}
Assert-PlanWasApplied -Plan $zeroChangePlan

$refreshOnlyPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$refreshOnlyPlan.resource_drift = @(
  [pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } }
)
Assert-PlanWasApplied -Plan $refreshOnlyPlan

$changeRejected = $false
$changedPlan = $zeroChangePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$changedPlan.resource_changes = @([pscustomobject]@{ change = [pscustomobject]@{ actions = @("update") } })
try {
  Assert-PlanWasApplied -Plan $changedPlan
} catch {
  $changeRejected = $true
}
if (-not $changeRejected) { throw "The input baseline accepted an unapplied resource change." }

$oneItemList = ConvertTo-TerraformEnvironmentValue -Value @("http://localhost:3000")
if ($oneItemList -cne '["http://localhost:3000"]') {
  throw "A one-item Terraform collection was serialized as a scalar."
}

$MigrationImage = "example.invalid/migration@sha256:$('a' * 64)"
$migrationAddress = "module.platform.aws_ecs_task_definition.migration[0]"
$beforeContainer = [ordered]@{
  name = "database-migration"
  image = "example.invalid/migration@sha256:$('b' * 64)"
  command = @("runner/dist/src/main.js")
  mountPoints = @()
  portMappings = @()
  systemControls = @()
  volumesFrom = @()
}
$afterContainer = [ordered]@{
  name = "database-migration"
  image = $MigrationImage
  command = @("runner/dist/src/main.js")
}
$normalizedTaskPlan = [pscustomobject]@{
  complete = $true
  applyable = $true
  errored = $false
  variables = [pscustomobject]@{ migration_image = [pscustomobject]@{ value = $MigrationImage } }
  resource_drift = @()
  resource_changes = @([pscustomobject]@{
      address = $migrationAddress
      change = [pscustomobject]@{
        actions = @("create", "delete")
        replace_paths = @(, @("container_definitions"))
        before = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$beforeContainer) -Compress -Depth 10
          tags = [pscustomobject]@{}
          enable_fault_injection = $false
        }
        after = [pscustomobject]@{
          container_definitions = ConvertTo-Json -InputObject @(,$afterContainer) -Compress -Depth 10
          tags = $null
          enable_fault_injection = $false
        }
        after_unknown = [pscustomobject]@{ enable_fault_injection = $false }
      }
    })
  output_changes = [pscustomobject]@{
    migration_task_definition_arn = [pscustomobject]@{ actions = @("update") }
  }
}
Assert-ExactTaskPlan -Plan $normalizedTaskPlan

$unsafeNormalizationPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeContainer = $unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions | ConvertFrom-Json
$unsafeContainer | Add-Member -NotePropertyName mountPoints `
  -NotePropertyValue @([pscustomobject]@{ sourceVolume = "unexpected" }) -Force
$unsafeNormalizationPlan.resource_changes[0].change.before.container_definitions =
  ConvertTo-Json -InputObject @($unsafeContainer) -Compress -Depth 10
$unsafeNormalizationRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeNormalizationPlan
} catch {
  $unsafeNormalizationRejected = $true
}
if (-not $unsafeNormalizationRejected) {
  throw "A non-empty provider-default container collection was accepted."
}

$unsafeTagsPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unsafeTagsPlan.resource_changes[0].change.before.tags = [pscustomobject]@{ unexpected = "value" }
$unsafeTagsRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unsafeTagsPlan
} catch {
  $unsafeTagsRejected = $true
}
if (-not $unsafeTagsRejected) { throw "A non-empty tag normalization was accepted." }

$unknownFaultPlan = $normalizedTaskPlan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$unknownFaultPlan.resource_changes[0].change.after.enable_fault_injection = $null
$unknownFaultPlan.resource_changes[0].change.after_unknown.enable_fault_injection = $true
$unknownFaultRejected = $false
try {
  Assert-ExactTaskPlan -Plan $unknownFaultPlan
} catch {
  $unknownFaultRejected = $true
}
if (-not $unknownFaultRejected) { throw "Unknown migration fault injection was accepted." }

Write-Host "Development document migration operator path and baseline tests passed."
