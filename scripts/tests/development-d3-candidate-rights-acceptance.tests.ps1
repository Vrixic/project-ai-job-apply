Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY = '1'
. (Join-Path $repository 'scripts/operate-development-candidate-rights-acceptance.ps1') `
  -ExpectedAccountId '123456789012' -SourceSha ('a' * 40) `
  -ExpectedPolicyVersion 'd3-development-synthetic-v1' -ReviewedPolicySha256 ('b' * 64) `
  -ExpectedOwnerInventory 'identity,profile,documents,jobs,matching,billing,trust,applications'
Remove-Item Env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY
$script:checks = 0
function Assert-Test([bool]$Condition, [string]$Message) {
  $script:checks++
  if (-not $Condition) { throw $Message }
}
function Assert-Refused([scriptblock]$Work) {
  $refused = $false
  try { $null = & $Work } catch { $refused = $true }
  Assert-Test $refused 'Unsafe D3 evidence was accepted.'
}
function Invoke-AwsJson { throw 'No cloud call is permitted in this test.' }
Assert-Test ($requiredOwners.Split(',').Count -eq 8) 'D3 must bind exactly eight owners.'
$coverage = [ordered]@{
  valid = $true; consentCount = 0; contributionApprovalCount = 0; contributionCount = 0
  privateCaptureCount = 0; trustCaseCount = 0; trustCaseEventCount = 0
  applicationCount = 1; packetCount = 1; approvalCount = 1; attemptCount = 1; historyCount = 1
}
$parsed = Read-CandidateRightsExportHelperResult ($coverage | ConvertTo-Json -Compress)
Assert-Test (Assert-CandidateRightsAcceptanceCoverage $parsed) 'Complete D3 coverage was refused.'
foreach ($name in @('applicationCount','packetCount','approvalCount','attemptCount','historyCount')) {
  $copy = $coverage | ConvertTo-Json | ConvertFrom-Json
  $copy.$name = 0
  Assert-Refused { Assert-CandidateRightsAcceptanceCoverage $copy }
  $copy.PSObject.Properties.Remove($name)
  Assert-Refused { Read-CandidateRightsExportHelperResult ($copy | ConvertTo-Json -Compress) }
}
$key = 'arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012'
$runtime = [pscustomobject]@{ Aliases = [pscustomobject]@{
  gateway = [pscustomobject]@{ Environment = [pscustomobject]@{
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN = $key; RESTRICTED_PACKET_FINGERPRINT_KEY_ARN = $key
  } }
  activity = [pscustomobject]@{ Environment = [pscustomobject]@{
    RESTRICTED_PACKET_EXPORT_ENABLED = 'true'
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN = $key; RESTRICTED_PACKET_FINGERPRINT_KEY_ARN = $key
  } }
} }
Assert-ApplicationsRightsRuntime $runtime
Assert-Test $true 'Exact packet export keys accepted.'
foreach ($name in @('RESTRICTED_PACKET_EXPORT_ENABLED','RESTRICTED_PACKET_ENCRYPTION_KEY_ARN','RESTRICTED_PACKET_FINGERPRINT_KEY_ARN')) {
  $copy = $runtime | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $copy.Aliases.activity.Environment.$name = 'mismatch'
  Assert-Refused { Assert-ApplicationsRightsRuntime $copy }
}
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('d3-rights-acceptance-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $operatorRoot = $temporary
  $ReceiptPath = Join-Path $temporary 'receipt.json'
  $receipt = [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-receipt'
    phase = 'verified-cleaned'; sourceSha = ('a' * 40); policySha256 = ('b' * 64)
    exportsRequested = 1; exportObjectsCleaned = 1; deletionMarkersCompleted = 1
    ownerInventoriesReconciled = 8; auth0Reconciled = $true; persistentSyntheticIdentities = 0
    queuedMessages = 0; activeCompute = 0; applicationsExportCoverage = $coverage
  }
  function Save-Receipt($Value) {
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReceiptPath
    $script:ReviewedReceiptSha256 = Get-FileSha256 $ReceiptPath
  }
  Save-Receipt $receipt
  Assert-Test ((Read-AggregateReceipt).ownerInventoriesReconciled -eq 8) 'Complete D3 receipt refused.'
  foreach ($name in @('ownerInventoriesReconciled','policySha256','applicationsExportCoverage')) {
    $copy = $receipt | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    switch ($name) {
      'ownerInventoriesReconciled' { $copy.$name = 7 }
      'policySha256' { $copy.$name = 'c' * 64 }
      'applicationsExportCoverage' { $copy.$name.packetCount = 0 }
    }
    Save-Receipt $copy
    Assert-Refused { Read-AggregateReceipt }
  }
  Remove-Variable -Name ReviewedRecoveryReplayReceiptSha256 -Scope Script
  $RecoveryReplayReceiptPath = ''
  $ReviewedRecoveryReplayReceiptSha256 = ''
  Assert-Test ($null -eq (Read-RecoveryReplayReceipt)) 'Omitted optional restore evidence must remain unverified.'
  $ReviewedRecoveryReplayReceiptSha256 = 'd' * 64
  Assert-Refused { Read-RecoveryReplayReceipt }
  $ReviewedRecoveryReplayReceiptSha256 = ''
  $RecoveryReplayReceiptPath = Join-Path $temporary 'absent.json'
  Assert-Refused { Read-RecoveryReplayReceipt }
} finally {
  $target = Get-Item -LiteralPath $temporary
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ($target.Name -cnotmatch '^d3-rights-acceptance-[a-f0-9]{32}$' -or $target.Parent.FullName -cne $expectedParent) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $target.FullName -Recurse
}
# Lifecycle failures after the first request expose only an allowlisted step and check, never the raw text.
function Get-ReportedLifecycleFailure([string]$Step, [string]$Message) {
  $script:reportStep = $Step; $script:reportMessage = $Message
  function Invoke-FixedLifecycle { param($Boundary, $Plan) $script:RightsStep = $script:reportStep; throw $script:reportMessage }
  try { $null = Invoke-FixedLifecycleReported ([pscustomobject]@{}) ([pscustomobject]@{}); return '' }
  catch { return [string]$_.Exception.Message }
}
Assert-Test ((Get-ReportedLifecycleFailure 'operational-health' 'Every development alarm must be OK secret-detail.') -ceq 'RightsLifecycleFailed:operational-health:alarm_not_ok') 'Alarm failure was not tagged.'
Assert-Test ((Get-ReportedLifecycleFailure 'export-cleanup' 'The exact exported object version remains after account deletion.') -ceq 'RightsLifecycleFailed:export-cleanup:export_version_remains') 'Export cleanup failure was not tagged.'
Assert-Test ((Get-ReportedLifecycleFailure 'resume-cleanup' 'provider said generated-secret') -ceq 'RightsLifecycleFailed:resume-cleanup:unclassified') 'Unknown text was not reduced to unclassified.'
Assert-Test ((Get-ReportedLifecycleFailure 'not-a-step' 'generated-secret') -ceq 'generated-secret') 'An unknown step must keep the original pre-mutation error.'
Assert-Test ((Get-ReportedLifecycleFailure 'preflight' 'generated-fixed-prerequisite') -ceq 'generated-fixed-prerequisite') 'Pre-mutation errors must stay unchanged.'
$coverageMessage = "D3 acceptance stopped before account deletion: nonempty Applications export coverage is required for historyCount. Prepare the authorized disposable account's missing D3 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry and cleanup."
Assert-Test ((Get-ReportedLifecycleFailure 'export-coverage' $coverageMessage) -ceq $coverageMessage) 'Reviewed coverage refusal must be preserved for the bridge.'
foreach ($tagged in @('operational-health','export-cleanup','receipt')) {
  Assert-Test (-not ((Get-ReportedLifecycleFailure $tagged 'token generated-secret') -match 'generated-secret')) 'Raw text leaked through the step tag.'
}
Write-Output "PASS $script:checks focused D3 rights acceptance assertions; no cloud calls."
