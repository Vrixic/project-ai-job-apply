Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$operator = Join-Path $PSScriptRoot "../operate-staging-runtime-lifecycle.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operator, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "The staging lifecycle operator must parse." }
$definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-TriggerState"
  }, $true)
. ([scriptblock]::Create($definition.Extent.Text))

function Invoke-AwsJson([string[]]$Arguments) {
  $command = $Arguments -join " "
  $script:calls.Add($command)
  if ($script:failAt -and $command.Contains($script:failAt)) { throw "Synthetic read failure" }
  if ($Arguments[1] -eq "list-functions") { return $script:functions }
  if ($Arguments[1] -eq "list-event-source-mappings") {
    return [pscustomobject]@{ EventSourceMappings = $script:mappings }
  }
  if ($Arguments[1] -eq "describe-rule") { return [pscustomobject]@{ State = $script:ruleState } }
  throw "Unexpected AWS call"
}
function Reset-Scenario {
  $script:functions = @("ai-job-apply-staging-gateway", "ai-job-apply-development-document-processor")
  $script:mappings = @()
  $script:ruleState = "DISABLED"
  $script:failAt = ""
  $script:calls = [Collections.Generic.List[string]]::new()
}
function Assert-Refused([scriptblock]$Operation) {
  $refused = $false
  try { & $Operation | Out-Null } catch { $refused = $true }
  if (-not $refused) { throw "A failed runtime inventory read must refuse status." }
}

Reset-Scenario
$status = Get-TriggerState
if ($status.DocumentProcessorPresent -or $status.EnabledMappings -ne 0 -or $status.EnabledRules -ne 0) {
  throw "Absent document processing with empty mappings must report the base dormant boundary."
}
if (@($script:calls | Where-Object { $_.Contains("staging-document-") }).Count) {
  throw "An undeployed document processor must not require its mappings or rules."
}

Reset-Scenario
$script:functions += "ai-job-apply-staging-document-processor"
$status = Get-TriggerState
if (-not $status.DocumentProcessorPresent -or $status.EnabledMappings -ne 0 -or $status.EnabledRules -ne 0) {
  throw "A deployed but dark processor must remain present with zero triggers."
}
foreach ($required in @("staging-document-processor:staging", "staging-document-scan-results", "staging-document-processing-reconciler")) {
  if (-not @($script:calls | Where-Object { $_.Contains($required) }).Count) {
    throw "Deployed document processing must inspect $required."
  }
}

Reset-Scenario
$script:functions += "ai-job-apply-staging-document-processor"
$script:mappings = @([pscustomobject]@{State="Enabled"}, [pscustomobject]@{State="Enabling"}, [pscustomobject]@{State="Disabled"})
$script:ruleState = "ENABLED"
$status = Get-TriggerState
if ($status.EnabledMappings -ne 4 -or $status.EnabledRules -ne 4) {
  throw "Active base and document triggers must all be counted."
}

foreach ($failedRead in @("list-functions", "outbox-starter:staging", "staging-document-processor:staging", "staging-document-scan-results", "staging-document-processing-reconciler", "staging-outbox-reconciler")) {
  Reset-Scenario
  $script:functions += "ai-job-apply-staging-document-processor"
  $script:failAt = $failedRead
  Assert-Refused { Get-TriggerState }
}
Write-Output "Staging runtime status: 9 synthetic deployment/trigger/failure cases passed; AWS was not called."
