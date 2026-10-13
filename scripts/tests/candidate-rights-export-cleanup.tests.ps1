Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$operator = Join-Path $PSScriptRoot '../operate-development-candidate-rights-acceptance.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operator, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw 'Candidate-rights operator has parser errors.' }
foreach ($name in @('Get-OptionalProperty','Confirm-RightsExportDeletion')) {
  $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
  if ($null -eq $function) { throw 'Export cleanup function is missing.' }
  Invoke-Expression $function.Extent.Text
}
$Region = 'us-east-2'
$script:Runtime = [pscustomobject]@{ ExportBucket = 'generated-export-bucket' }
$exportId = '019c2b89-79b2-7000-8000-000000000002'
$key = "candidate-data-exports/019c2b89-79b2-7000-8000-000000000004/$exportId.json"
$grant = [Uri]"https://generated-export-bucket.s3.us-east-2.amazonaws.com/$key`?versionId=generated-version"
$script:inventory = [pscustomobject]@{ Versions = @(); DeleteMarkers = @(); IsTruncated = $false }
$script:failure = $false
$script:inspections = 0
function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Operation)
  $script:inspections++
  if (($Arguments -join '|') -cne "s3api|list-object-versions|--bucket|generated-export-bucket|--prefix|$key|--output|json") {
    throw 'Cleanup did not inspect the state-owned exact export prefix.'
  }
  if ($script:failure) { throw 'SyntheticAccessDenied' }
  return $script:inventory
}
if ((Confirm-RightsExportDeletion $grant $exportId) -ne 1) { throw 'Empty exact inventory was rejected.' }
foreach ($category in @('Versions','DeleteMarkers')) {
  $script:inventory = [pscustomobject]@{ Versions = @(); DeleteMarkers = @(); IsTruncated = $false }
  $script:inventory.$category = @([pscustomobject]@{ Key = $key; VersionId = 'generated-version' })
  $rejected = $false
  try { $null = Confirm-RightsExportDeletion $grant $exportId } catch { $rejected = $true }
  if (-not $rejected) { throw 'The exact surviving version was falsely counted as cleaned.' }
}
$script:inventory = [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = $key; VersionId = 'different-version' }); IsTruncated = $false }
if ((Confirm-RightsExportDeletion $grant $exportId) -ne 1) { throw 'An unrelated version was mistaken for the exact exported version.' }
foreach ($invalid in @(
    [pscustomobject]@{},
    [pscustomobject]@{ IsTruncated = $null },
    [pscustomobject]@{ IsTruncated = 'false' },
    [pscustomobject]@{ IsTruncated = 0 },
    [pscustomobject]@{ IsTruncated = $false; Versions = $null },
    [pscustomobject]@{ IsTruncated = $false; Versions = [pscustomobject]@{ Key = $key; VersionId = 'version' } },
    [pscustomobject]@{ IsTruncated = $false; DeleteMarkers = [pscustomobject]@{} },
    [pscustomobject]@{ IsTruncated = $false; Versions = @([pscustomobject]@{ Key = $key; VersionId = '' }) },
    [pscustomobject]@{ IsTruncated = $false; Versions = @([pscustomobject]@{ Key = 'other-prefix'; VersionId = 'version' }) },
    [pscustomobject]@{ IsTruncated = $false; Versions = @([pscustomobject]@{ Key = $key; VersionId = 'null' }) },
    [pscustomobject]@{ IsTruncated = $false; Versions = @([pscustomobject]@{ Key = $key; VersionId = 123 }) },
    [pscustomobject]@{ IsTruncated = $false; Versions = @(
        [pscustomobject]@{ Key = $key; VersionId = 'same-version' },
        [pscustomobject]@{ Key = $key; VersionId = 'same-version' }
      ) },
    [pscustomobject]@{ IsTruncated = $true },
    [pscustomobject]@{ NextToken = 'unread-page' }
  )) {
  $script:inventory = $invalid
  $rejected = $false
  try { $null = Confirm-RightsExportDeletion $grant $exportId } catch { $rejected = $true }
  if (-not $rejected) { throw 'Malformed or incomplete inventory was accepted.' }
}
$script:failure = $true
$rejected = $false
try { $null = Confirm-RightsExportDeletion $grant $exportId } catch { $rejected = $true }
if (-not $rejected) { throw 'An access failure was mistaken for artifact absence.' }
$before = $script:inspections
foreach ($invalidGrant in @(
    "https://other-bucket.s3.us-east-2.amazonaws.com/$key`?versionId=generated-version",
    "https://generated-export-bucket.s3.us-east-2.amazonaws.com/$key",
    "https://generated-export-bucket.s3.us-east-2.amazonaws.com/$key`?versionId=null"
  )) {
  $rejected = $false
  try { $null = Confirm-RightsExportDeletion ([Uri]$invalidGrant) $exportId } catch { $rejected = $true }
  if (-not $rejected) { throw 'A changed artifact identity was accepted.' }
}
if ($script:inspections -ne $before) { throw 'Invalid artifact identity reached AWS.' }
$lifecycle = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-FixedLifecycle' }, $true).Extent.Text
$verified = $lifecycle.IndexOf('$exportsCleaned = Confirm-RightsExportDeletion')
$marker = $lifecycle.IndexOf('$null = Wait-DeletionCompletion')
$receipt = $lifecycle.IndexOf('$receipt = [ordered]@{')
if ($verified -lt $marker -or $verified -gt $receipt -or -not $lifecycle.Contains('exportObjectsCleaned = $exportsCleaned') -or $lifecycle.Contains('exportObjectsCleaned = 1')) {
  throw 'The lifecycle receipt does not derive cleanup from verified exact-version absence.'
}
Write-Output 'candidate-rights exact export cleanup tests passed (22 synthetic cases; no cloud calls)'
