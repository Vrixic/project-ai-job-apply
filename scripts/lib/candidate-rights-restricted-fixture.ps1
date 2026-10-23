# Fixed, generated-only candidate commands. Call only inside the reviewed disposable-identity
# lifecycle. Never use the export artifact to prepare these independent expectations.
function Assert-RestrictedFixtureRuntime {
  param([Parameter(Mandatory)][object]$Runtime)
  $gatewayKey = [string](Get-OptionalProperty $Runtime.Aliases.gateway.Environment 'RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN')
  $activityKey = [string](Get-OptionalProperty $Runtime.Aliases.activity.Environment 'RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN')
  $exportEnabled = [string](Get-OptionalProperty $Runtime.Aliases.activity.Environment 'RESTRICTED_ANSWER_EXPORT_ENABLED')
  if ($ExpectedPolicyVersion -cnotin @('d2-development-synthetic-v1','d3-development-synthetic-v1','d4-development-synthetic-v1') -or
      $gatewayKey -cnotmatch "^arn:aws:kms:us-east-2:${ExpectedAccountId}:key/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" -or
      $activityKey -cne $gatewayKey -or $exportEnabled -cne 'enabled') {
    throw 'The restricted fixture requires the exact deployed vault and export key bindings.'
  }
}

function Assert-RestrictedFixtureCollection {
  param([Parameter(Mandatory)][object]$Collection)
  $null = Assert-ExactPropertySet $Collection @('answers') 'Restricted fixture collection'
  if ($Collection.answers -isnot [array] -or @($Collection.answers).Count -gt 3) {
    throw 'The restricted fixture collection is invalid.'
  }
}

function Get-RestrictedFixtureInstant {
  param([Parameter(Mandatory)][string]$Timestamp)
  if ($Timestamp -cnotmatch '^(?<whole>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.(?<fraction>[0-9]{1,9}))?(?<offset>Z|[+-]\d{2}:\d{2})$') {
    throw 'The restricted fixture timestamp is invalid.'
  }
  $whole = $Matches.whole
  $offset = $Matches.offset
  $fraction = ([string]$Matches['fraction']).PadRight(9, '0')
  $seconds = [DateTimeOffset]::Parse("$whole$offset").ToUnixTimeSeconds()
  return "${seconds}:$fraction"
}

function Assert-RestrictedFixtureMetadata {
  param(
    [Parameter(Mandatory)][object]$Entry,
    [Parameter(Mandatory)][string]$Field,
    [Parameter(Mandatory)][int]$Version,
    [Parameter(Mandatory)][string]$State,
    [Parameter(Mandatory)][string]$ConfirmedAt,
    [string]$ExpiresAt = '',
    [string]$ExpectedId = '',
    [switch]$RequireCreation
  )
  $names = @('id','fieldKey','valueType','sensitivity','state','version','confirmedAt')
  if ($RequireCreation -or $null -ne (Get-OptionalProperty $Entry 'createdAt')) { $names += 'createdAt' }
  if ($ExpiresAt) { $names += 'expiresAt' }
  $null = Assert-ExactPropertySet $Entry $names 'Restricted fixture metadata'
  if ([string]$Entry.id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
      ($ExpectedId -and [string]$Entry.id -cne $ExpectedId) -or
      [string]$Entry.fieldKey -cne $Field -or [string]$Entry.valueType -cne 'boolean' -or
      [string]$Entry.sensitivity -cne 'restricted' -or [string]$Entry.state -cne $State -or
      ($Entry.version -isnot [int] -and $Entry.version -isnot [long]) -or $Entry.version -ne $Version) {
    throw 'The restricted fixture metadata does not match its fixed write.'
  }
  try {
    if ($Entry.confirmedAt -isnot [string] -or
        (Get-RestrictedFixtureInstant $Entry.confirmedAt) -cne (Get-RestrictedFixtureInstant $ConfirmedAt) -or
        ($ExpiresAt -and ($Entry.expiresAt -isnot [string] -or
          (Get-RestrictedFixtureInstant $Entry.expiresAt) -cne (Get-RestrictedFixtureInstant $ExpiresAt)))) {
      throw 'timestamp-mismatch'
    }
    if ($RequireCreation) {
      if ($Entry.createdAt -isnot [string]) { throw 'timestamp-invalid' }
      $null = Get-RestrictedFixtureInstant $Entry.createdAt
    }
  } catch { throw 'The restricted fixture timestamps are invalid.' }
}

function New-RestrictedAnswerFixture {
  param([Parameter(Mandatory)][string]$Token)
  # Refuse any pre-existing vault entries, including tombstones. Never overwrite another scope.
  $baseline = (Invoke-CandidateApi GET '/profile/restricted-answers' $Token $null).Body
  Assert-RestrictedFixtureCollection $baseline
  if (@($baseline.answers).Count -ne 0) { throw 'The disposable restricted fixture must start empty.' }
  $confirmed = [DateTimeOffset]::UtcNow.AddDays(-2).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $expiry = [DateTimeOffset]::UtcNow.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $fields = @('authorization.us_authorized','authorization.sponsorship_required','disclosure.non_compete')
  $ids = @{}
  foreach ($field in $fields) {
    $body = [ordered]@{
      expectedVersion = 0; valueType = 'boolean'; value = 'true'; sensitivity = 'restricted'
      sourceReference = 'synthetic.candidate-rights.restricted-v1'; confirmedAt = $confirmed
    }
    if ($field -ceq 'authorization.sponsorship_required') { $body.value = 'false'; $body.expiresAt = $expiry }
    $entry = (Invoke-CandidateApi PUT "/profile/restricted-answers/$field" $Token $body @{
      'idempotency-key' = "rights-vault-$([guid]::NewGuid().ToString('N'))"
    }).Body
    $expectedExpiry = if ($field -ceq 'authorization.sponsorship_required') { $expiry } else { '' }
    Assert-RestrictedFixtureMetadata $entry $field 1 'active' $confirmed -ExpiresAt $expectedExpiry
    if (@($ids.Values) -contains [string]$entry.id) { throw 'The restricted fixture reused an identity.' }
    $ids[$field] = [string]$entry.id
  }
  $correction = [ordered]@{
    expectedVersion = 1; valueType = 'boolean'; value = 'false'; sensitivity = 'restricted'
    sourceReference = 'synthetic.candidate-rights.restricted-v1'; confirmedAt = $confirmed
  }
  $revised = (Invoke-CandidateApi PUT '/profile/restricted-answers/authorization.us_authorized' $Token $correction @{
    'idempotency-key' = "rights-vault-revise-$([guid]::NewGuid().ToString('N'))"
  }).Body
  Assert-RestrictedFixtureMetadata $revised $fields[0] 2 'active' $confirmed -ExpectedId $ids[$fields[0]]
  $null = Invoke-CandidateApi DELETE '/profile/restricted-answers/disclosure.non_compete' $Token $null @{} @(204)
  $latest = (Invoke-CandidateApi GET '/profile/restricted-answers' $Token $null).Body
  Assert-RestrictedFixtureCollection $latest
  if (@($latest.answers).Count -ne 3) { throw 'The restricted fixture latest set is incomplete.' }
  $snapshot = @()
  foreach ($field in $fields) {
    $matches = @($latest.answers | Where-Object { [string]$_.fieldKey -ceq $field })
    if ($matches.Count -ne 1) { throw 'The restricted fixture latest reference is ambiguous.' }
    $entry = $matches[0]
    $deleted = $field -ceq 'disclosure.non_compete'
    $version = if ($field -ceq 'authorization.sponsorship_required') { 1 } else { 2 }
    $state = if ($deleted) { 'deleted' } else { 'active' }
    $expectedExpiry = if ($field -ceq 'authorization.sponsorship_required') { $expiry } else { '' }
    Assert-RestrictedFixtureMetadata $entry $field $version $state $confirmed -ExpiresAt $expectedExpiry -ExpectedId $ids[$field] -RequireCreation
    $expected = [ordered]@{}
    foreach ($property in $entry.PSObject.Properties) { $expected[$property.Name] = $property.Value }
    if (-not $deleted) { $expected.value = 'false' }
    $snapshot += [pscustomobject]$expected
  }
  return $snapshot
}
