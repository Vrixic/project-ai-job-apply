Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY = '1'
. (Join-Path $repository 'scripts/operate-development-candidate-rights-acceptance.ps1') `
  -ExpectedAccountId '123456789012' -SourceSha ('a' * 40) `
  -ExpectedPolicyVersion 'd4-development-synthetic-v1' -ReviewedPolicySha256 ('b' * 64) `
  -ExpectedOwnerInventory 'identity,profile,documents,jobs,matching,billing,trust,applications,notifications'
Remove-Item Env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY
$script:checks = 0
function Assert-Test([bool]$Condition, [string]$Message) {
  $script:checks++
  if (-not $Condition) { throw $Message }
}
function Assert-Refused([scriptblock]$Work) {
  $refused = $false
  try { $null = & $Work } catch { $refused = $true }
  Assert-Test $refused 'Unsafe D4 evidence was accepted.'
}
function Invoke-AwsJson { throw 'No cloud call is permitted in this test.' }

Assert-Test ($requiredOwners.Split(',').Count -eq 9) 'D4 must bind exactly nine owners.'
Assert-Test ($requiredOwners.EndsWith(',applications,notifications')) 'D4 must add Notifications after Applications.'

$coverage = [ordered]@{
  valid = $true; consentCount = 0; contributionApprovalCount = 0; contributionCount = 0
  privateCaptureCount = 0; trustCaseCount = 0; trustCaseEventCount = 0
  applicationCount = 1; packetCount = 1; approvalCount = 1; attemptCount = 1; historyCount = 1
  notificationsPreferencesCount = 1; notificationsEmailDestinationCount = 0
  notificationsPushSubscriptionCount = 1; notificationsInboxCount = 0; notificationsDeliveryCount = 0
}
$parsed = Read-CandidateRightsExportHelperResult ($coverage | ConvertTo-Json -Compress)
Assert-Test (Assert-CandidateRightsAcceptanceCoverage $parsed) 'Complete D4 coverage was refused.'
# D3 gates still apply, and the two seeded Notifications records are required.
foreach ($name in @('applicationCount','packetCount','approvalCount','attemptCount','historyCount','notificationsPreferencesCount','notificationsPushSubscriptionCount')) {
  $copy = $coverage | ConvertTo-Json | ConvertFrom-Json
  $copy.$name = 0
  Assert-Refused { Assert-CandidateRightsAcceptanceCoverage $copy }
  $copy.PSObject.Properties.Remove($name)
  Assert-Refused { Read-CandidateRightsExportHelperResult ($copy | ConvertTo-Json -Compress) }
}
# Email, inbox and delivery rows are not seeded by the fixed fixture, so empty is acceptable.
foreach ($name in @('notificationsEmailDestinationCount','notificationsInboxCount','notificationsDeliveryCount')) {
  $copy = $coverage | ConvertTo-Json | ConvertFrom-Json
  $copy.$name = 0
  Assert-Test (Assert-CandidateRightsAcceptanceCoverage $copy) "An empty $name was refused."
}
$extra = $coverage | ConvertTo-Json | ConvertFrom-Json
$extra | Add-Member -NotePropertyName notificationsEndpoint -NotePropertyValue 'https://fcm.googleapis.com/fcm/send/secret'
Assert-Refused { Read-CandidateRightsExportHelperResult ($extra | ConvertTo-Json -Compress) }

# The runtime gate for protected-packet keys still covers D4 (it contains Applications).
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
$broken = $runtime | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$broken.Aliases.activity.Environment.RESTRICTED_PACKET_EXPORT_ENABLED = 'false'
Assert-Refused { Assert-ApplicationsRightsRuntime $broken }

# The fixture drives only the reviewed API routes, in order, with generated values.
$script:calls = [System.Collections.Generic.List[object]]::new()
function Invoke-CandidateApi {
  param($Method, $Path, $Token, $Body, $Headers = @{}, $ExpectedStatus)
  $script:calls.Add([pscustomobject]@{ Method = $Method; Path = $Path; Token = $Token; Body = $Body; Expected = @($ExpectedStatus) })
  if ($Method -ceq 'GET') { return [pscustomobject]@{ Status = 200; Body = [pscustomobject]@{ version = 3 } } }
  if ($Method -ceq 'PUT') { return [pscustomobject]@{ Status = 200; Body = [pscustomobject]@{ version = 4 } } }
  return [pscustomobject]@{ Status = 201; Body = [pscustomobject]@{ id = ([guid]::NewGuid().ToString()) } }
}
New-NotificationsFixture 'generated-token'
Assert-Test ($script:calls.Count -eq 3) 'The Notifications fixture must make exactly three API calls.'
Assert-Test ($script:calls[0].Method -ceq 'GET' -and $script:calls[0].Path -ceq '/notifications/preferences') 'The fixture must read the current preferences version first.'
Assert-Test ($script:calls[1].Method -ceq 'PUT' -and $script:calls[1].Body.expectedVersion -eq 3 -and -not $script:calls[1].Body.emailEnabled -and -not $script:calls[1].Body.pushEnabled) 'The fixture must save preferences at the current version with channels off.'
Assert-Test ($script:calls[2].Method -ceq 'POST' -and $script:calls[2].Path -ceq '/notifications/delivery/push-subscriptions' -and $script:calls[2].Expected -contains 201) 'The fixture must register one subscription.'
Assert-Test ([string]$script:calls[2].Body.endpoint -cmatch '^https://fcm\.googleapis\.com/fcm/send/generated-rights-acceptance-[a-f0-9]{32}$') 'The subscription must use an allow-listed push host and a generated path.'
foreach ($call in $script:calls) { Assert-Test ($call.Token -ceq 'generated-token') 'Every fixture call must use the disposable identity token.' }
Assert-Test (-not ($script:calls | Where-Object { $_.Path -like '*email*' })) 'The fixture must not trigger confirmation email.'

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('d4-rights-acceptance-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $operatorRoot = $temporary
  $ReceiptPath = Join-Path $temporary 'receipt.json'
  $receipt = [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-receipt'
    phase = 'verified-cleaned'; sourceSha = ('a' * 40); policySha256 = ('b' * 64)
    exportsRequested = 1; exportObjectsCleaned = 1; deletionMarkersCompleted = 1
    ownerInventoriesReconciled = 9; auth0Reconciled = $true; persistentSyntheticIdentities = 0
    queuedMessages = 0; activeCompute = 0; applicationsExportCoverage = $coverage
  }
  function Save-Receipt($Value) {
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReceiptPath
    $script:ReviewedReceiptSha256 = Get-FileSha256 $ReceiptPath
  }
  Save-Receipt $receipt
  Assert-Test ((Read-AggregateReceipt).ownerInventoriesReconciled -eq 9) 'Complete D4 receipt refused.'
  foreach ($name in @('ownerInventoriesReconciled','policySha256','applicationsExportCoverage')) {
    $copy = $receipt | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    switch ($name) {
      'ownerInventoriesReconciled' { $copy.$name = 8 }
      'policySha256' { $copy.$name = 'c' * 64 }
      'applicationsExportCoverage' { $copy.$name.notificationsPushSubscriptionCount = 0 }
    }
    Save-Receipt $copy
    Assert-Refused { Read-AggregateReceipt }
  }
} finally {
  $target = Get-Item -LiteralPath $temporary
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ($target.Name -cnotmatch '^d4-rights-acceptance-[a-f0-9]{32}$' -or $target.Parent.FullName -cne $expectedParent) { throw 'Unsafe test cleanup target.' }
  Remove-Item -LiteralPath $target.FullName -Recurse
}
# A D4 refusal is a reviewed pre-deletion message and is forwarded unchanged.
function Get-ReportedLifecycleFailure([string]$Step, [string]$Message) {
  $script:reportStep = $Step; $script:reportMessage = $Message
  function Invoke-FixedLifecycle { param($Boundary, $Plan) $script:RightsStep = $script:reportStep; throw $script:reportMessage }
  try { $null = Invoke-FixedLifecycleReported ([pscustomobject]@{}) ([pscustomobject]@{}); return '' }
  catch { return [string]$_.Exception.Message }
}
$d4Message = 'D4 acceptance stopped before account deletion: the Notifications export section lacks notificationsPushSubscriptionCount.'
Assert-Test ((Get-ReportedLifecycleFailure 'export-coverage' $d4Message) -ceq $d4Message) 'The reviewed D4 coverage refusal must be preserved.'
Write-Output "PASS $script:checks focused D4 rights acceptance assertions; no cloud calls."
