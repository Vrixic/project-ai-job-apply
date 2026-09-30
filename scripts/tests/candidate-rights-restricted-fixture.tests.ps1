Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$priorTestOnly = [Environment]::GetEnvironmentVariable('CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY', 'Process')
try {
  $env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY = '1'
  . (Join-Path $repositoryRoot 'scripts/operate-development-candidate-rights-acceptance.ps1')
} finally {
  [Environment]::SetEnvironmentVariable('CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY', $priorTestOnly, 'Process')
}
$script:assertions = 0
function Assert-FixtureTest {
  param([bool]$Condition, [string]$Reason)
  $script:assertions += 1
  if (-not $Condition) { throw $Reason }
}
Assert-FixtureTest ((Get-RestrictedFixtureInstant '2026-09-30T12:00:00.123456789Z') -ceq (Get-RestrictedFixtureInstant '2026-09-30T17:30:00.123456789+05:30')) 'Equivalent offsets differ.'
Assert-FixtureTest ((Get-RestrictedFixtureInstant '2026-09-30T12:00:00.123456789Z') -cne (Get-RestrictedFixtureInstant '2026-09-30T12:00:00.123456788Z')) 'Adjacent nanoseconds collapsed.'
Assert-FixtureTest ((Get-RestrictedFixtureInstant '2026-09-30T12:00:00Z') -ceq (Get-RestrictedFixtureInstant '2026-09-30T12:00:00.000000000Z')) 'Fraction padding differs.'
foreach ($invalid in @('2026-09-30T12:00:00.1234567890Z','not-a-date','2026-09-30T12:00:00')) {
  $refused = $false
  try { $null = Get-RestrictedFixtureInstant $invalid } catch { $refused = $true }
  Assert-FixtureTest $refused 'Invalid or unbounded timestamp accepted.'
}
$ExpectedPolicyVersion = 'd2-development-synthetic-v1'
$ExpectedAccountId = '123456789012'
$key = 'arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012'
$runtime = [pscustomobject]@{ Aliases = [pscustomobject]@{
  gateway = [pscustomobject]@{ Environment = [pscustomobject]@{ RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = $key } }
  activity = [pscustomobject]@{ Environment = [pscustomobject]@{ RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = $key; RESTRICTED_ANSWER_EXPORT_ENABLED = 'enabled' } }
} }
Assert-RestrictedFixtureRuntime $runtime
foreach ($case in @('gateway-key-missing','activity-key-missing','mismatched-key','wrong-account','alias-key','wrong-flag','malformed-key')) {
  $copy = ConvertFrom-OperatorJson ($runtime | ConvertTo-Json -Depth 10) 'Generated runtime'
  switch ($case) {
    'gateway-key-missing' { $copy.Aliases.gateway.Environment.PSObject.Properties.Remove('RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN') }
    'activity-key-missing' { $copy.Aliases.activity.Environment.PSObject.Properties.Remove('RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN') }
    'mismatched-key' { $copy.Aliases.activity.Environment.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = $key.Replace('12345678-', '22345678-') }
    'wrong-account' { $copy.Aliases.gateway.Environment.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = $key.Replace(':123456789012:', ':223456789012:') }
    'alias-key' { $copy.Aliases.gateway.Environment.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = 'alias/generated' }
    'wrong-flag' { $copy.Aliases.activity.Environment.RESTRICTED_ANSWER_EXPORT_ENABLED = 'true' }
    'malformed-key' { $copy.Aliases.gateway.Environment.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = $key.Substring(0, $key.Length - 36) + ('-' * 36) }
  }
  $refused = $false
  try { Assert-RestrictedFixtureRuntime $copy } catch { $refused = $true }
  Assert-FixtureTest $refused "Runtime mutation $case was accepted."
}
$ExpectedPolicyVersion = 'different-policy'
$refused = $false
try { Assert-RestrictedFixtureRuntime $runtime } catch { $refused = $true }
Assert-FixtureTest $refused 'Wrong fixture policy was accepted.'
$ExpectedPolicyVersion = 'd2-development-synthetic-v1'

# A mode change or modified sequence cannot reuse a previously reviewed plan.
$planRoot = Join-Path ([IO.Path]::GetTempPath()) "restricted-fixture-plans-$([guid]::NewGuid().ToString('N'))"
$originalOperatorRoot = $operatorRoot
$operatorRoot = $planRoot
$SourceSha = 'a' * 40
$ReviewedPolicySha256 = 'b' * 64
$boundary = [pscustomobject]@{
  Runtime = $runtime; Snapshot = [pscustomobject]@{ Lineage = 'generated'; Serial = 1; VersionId = 'generated-version' }
  Identity = [pscustomobject]@{ SubjectSha256 = 'c' * 64; AttestationSha256 = 'd' * 64; IdTokenAudienceSha256 = 'e' * 64 }
  Secret = [pscustomobject]@{ ClientIdSha256 = 'f' * 64; AuthorizedOwnerSha256 = '1' * 64; RevocationMode = 'delete_user_only' }
  Backup = $null; Health = $null; Drift = [pscustomobject]@{ Sha256 = '2' * 64 }
}
foreach ($name in @('gateway','outboxStarter','durable','activity','terminal')) {
  $alias = [pscustomobject]@{ AliasArnSha256 = '3' * 64; Version = 1; CodeSha256 = ('A' * 43) + '=' }
  Add-Member -InputObject $runtime.Aliases -NotePropertyName $name -NotePropertyValue $alias -Force
}
try {
  foreach ($case in @('legacy','restricted','changed-mode','changed-fixture','changed-sequence')) {
    $RestrictedAnswerFixture = $case -cne 'legacy'
    $plan = New-ExecutionPlan $boundary
    if ($case -ceq 'changed-fixture') { $plan.restrictedAnswerFixture = 'unreviewed' }
    if ($case -ceq 'changed-sequence') { $plan.fixedSequence[3] = 'unreviewed' }
    $ExecutionPlanPath = Join-Path $planRoot "$case.json"
    Write-ExclusiveJson $ExecutionPlanPath $plan
    $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath
    if ($case -ceq 'changed-mode') { $RestrictedAnswerFixture = $false }
    $refused = $false
    try { $null = Read-ExecutionPlan } catch { $refused = $true }
    Assert-FixtureTest ($refused -eq ($case -cin @('changed-mode','changed-fixture','changed-sequence'))) "Plan case $case did not enforce mode/sequence identity."
    Remove-Item -LiteralPath $ExecutionPlanPath
  }
} finally {
  $operatorRoot = $originalOperatorRoot
  $RestrictedAnswerFixture = $false
  if (Test-Path -LiteralPath $planRoot) { Remove-Item -LiteralPath $planRoot }
}
function Invoke-CandidateApi {
  param($Method, $Path, $Token, $Body, $Headers, $ExpectedStatus)
  $script:calls += "$Method $Path"
  if ($Token -cne 'generated-only-token') { throw 'UnexpectedGeneratedToken' }
  if ($Method -ceq 'GET') {
    $entries = @($script:entries.Values | ForEach-Object { ConvertFrom-OperatorJson ($_ | ConvertTo-Json) 'Generated metadata' })
    if ($script:mutation -ceq 'preexisting' -and $script:calls.Count -eq 1) { $entries = @([pscustomobject]@{ id = 'generated' }) }
    if ($script:calls.Count -gt 1) {
      if ($script:mutation -ceq 'creation-missing') { $entries[0].PSObject.Properties.Remove('createdAt') }
      if ($script:mutation -ceq 'additional') { $entries += $entries[0] }
      if ($script:mutation -ceq 'wrong-version') { $entries[0].version = 8 }
      if ($script:mutation -ceq 'wrong-field') { $entries[0].fieldKey = 'signature' }
      if ($script:mutation -ceq 'extra-value') { Add-Member -InputObject $entries[0] -NotePropertyName value -NotePropertyValue 'generated-private-canary' }
      if ($script:mutation -ceq 'changed-id') { $entries[0].id = '019d04cf-1f80-7000-8000-000000000099' }
      if ($script:mutation -ceq 'extra-context') { Add-Member -InputObject $entries[0] -NotePropertyName context -NotePropertyValue 'unexpected' }
      if ($script:mutation -ceq 'invalid-created') { $entries[0].createdAt = 'not-a-date' }
      if ($script:mutation -ceq 'wrong-confirmed') { $entries[0].confirmedAt = '2020-01-01T00:00:00Z' }
      if ($script:mutation -ceq 'missing-expiry') {
        ($entries | Where-Object fieldKey -CEQ 'authorization.sponsorship_required').PSObject.Properties.Remove('expiresAt')
      }
    }
    return [pscustomobject]@{ Body = [pscustomobject]@{ answers = $entries } }
  }
  $field = $Path.Substring('/profile/restricted-answers/'.Length)
  if ($Method -ceq 'DELETE') {
    Assert-FixtureTest ($field -ceq 'disclosure.non_compete' -and @($ExpectedStatus)[0] -eq 204) 'Deletion was not fixed.'
    $script:entries[$field].state = 'deleted'
    $script:entries[$field].version = 2
    return [pscustomobject]@{ Body = $null }
  }
  Assert-FixtureTest ($Method -ceq 'PUT' -and $Body.sourceReference -ceq 'synthetic.candidate-rights.restricted-v1') 'Write was not fixed.'
  Assert-FixtureTest ([string]$Headers.'idempotency-key' -match '^rights-vault-(revise-)?[0-9a-f]{32}$') 'Missing fixed idempotency key.'
  $version = [int]$Body.expectedVersion + 1
  if ($version -eq 1) {
    $id = '019d04cf-1f80-7000-8000-00000000000' + ($script:entries.Count + 1)
    $entry = [pscustomobject]@{
      id = $id; fieldKey = $field; valueType = $Body.valueType; sensitivity = $Body.sensitivity
      state = 'active'; version = 1; confirmedAt = $Body.confirmedAt; createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    if ($Body.Contains('expiresAt')) { Add-Member -InputObject $entry -NotePropertyName expiresAt -NotePropertyValue $Body.expiresAt }
    $script:entries[$field] = $entry
  } else {
    Assert-FixtureTest ($field -ceq 'authorization.us_authorized' -and $version -eq 2 -and $Body.value -ceq 'false') 'Correction was not fixed.'
    $script:entries[$field].version = $version
  }
  return [pscustomobject]@{ Body = $script:entries[$field] }
}
foreach ($case in @('valid','preexisting','creation-missing','additional','wrong-version','wrong-field','extra-value','changed-id','extra-context','invalid-created','wrong-confirmed','missing-expiry')) {
  $script:entries = @{}
  $script:calls = @()
  $script:mutation = $case
  $failure = ''
  $snapshot = $null
  try { $snapshot = @(New-RestrictedAnswerFixture 'generated-only-token') } catch { $failure = $_.Exception.Message }
  if ($case -ceq 'valid') {
    Assert-FixtureTest (-not $failure -and $snapshot.Count -eq 3) "Fixed fixture refused: $failure"
    Assert-FixtureTest ($script:calls.Count -eq 7) 'Fixture sequence changed.'
    Assert-FixtureTest ($snapshot[0].version -eq 2 -and $snapshot[0].value -ceq 'false') 'Correction expectation missing.'
    Assert-FixtureTest ($snapshot[1].value -ceq 'false' -and $snapshot[1].expiresAt) 'Expired expectation missing.'
    Assert-FixtureTest ($snapshot[2].state -ceq 'deleted' -and $null -eq $snapshot[2].PSObject.Properties['value']) 'Tombstone carried a value.'
    $validSnapshot = $snapshot
  } else {
    Assert-FixtureTest ([bool]$failure) "Mutation $case was accepted."
    Assert-FixtureTest (-not $failure.Contains('generated-private-canary') -and -not $failure.Contains('generated-only-token')) 'Failure reflected private inputs.'
    if ($case -ceq 'preexisting') { Assert-FixtureTest ($script:calls.Count -eq 1) 'Pre-existing scope received a write.' }
  }
}

# Invoke the actual bounded Node transport with generated bytes, never a network or cloud fixture.
$at = [DateTimeOffset]::UtcNow.ToString('o')
$artifact = [ordered]@{
  schemaVersion = 1; format = 'candidate-data-export-v1'; exportId = '019d04cf-1f80-7000-8000-000000000040'
  policyVersion = 'd2-development-synthetic-v1'; generatedAt = $at
  candidate = @{ createdAt = $at; connectedAccounts = @() }
  profile = @{ preferences = $null; facts = @(); contributionConsents = @(); restrictedAnswers = $validSnapshot }
  documents = @{ resumes = @() }; jobs = @{ reports = @(); contributions = @() }
  matching = @{ savedJobs = @(); privateSavedPageCaptures = @() }
  billing = @{ entitlement = @{ plan = 'free'; version = 0; effectiveAt = $at } }
  trust = @{ schemaVersion = 1; cases = @(); caseEvents = @(); contributorReputationEvidence = @() }
  audit = @{ events = @() }
}
$bytes = [Text.Encoding]::UTF8.GetBytes(($artifact | ConvertTo-Json -Depth 20 -Compress))
try {
  $result = Invoke-CandidateRightsExportHelper -ExpectedExportId $artifact.exportId -ExpectedPolicyVersion $artifact.policyVersion -Artifact $bytes -ExpectedRestrictedAnswers $validSnapshot
  Assert-FixtureTest ($result.valid -eq $true -and $result.activeValueCount -eq 1 -and $result.expiredValueCount -eq 1 -and $result.deletedTombstoneCount -eq 1 -and $result.revisedValueCount -eq 1) 'Native restricted transport failed.'
  $altered = ConvertFrom-OperatorJson ($validSnapshot | ConvertTo-Json -Depth 20) 'Generated altered snapshot'
  $altered[0].value = 'true'
  $refused = $false
  try { $null = Invoke-CandidateRightsExportHelper -ExpectedExportId $artifact.exportId -ExpectedPolicyVersion $artifact.policyVersion -Artifact $bytes -ExpectedRestrictedAnswers $altered }
  catch { $refused = $_.Exception.Message -ceq 'The generated-synthetic export verifier is unavailable or rejected the bounded artifact.' }
  Assert-FixtureTest $refused 'Native transport accepted an independent value mismatch.'
} finally { [Array]::Clear($bytes, 0, $bytes.Length) }
Write-Output "Restricted fixture assertions passed: $script:assertions; no network or cloud calls."
