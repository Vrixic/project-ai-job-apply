Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$priorTestOnly = [Environment]::GetEnvironmentVariable('CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY', 'Process')
try {
  $env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY = '1'
  . (Join-Path $repositoryRoot 'scripts/operate-development-candidate-rights-acceptance.ps1')
} finally { [Environment]::SetEnvironmentVariable('CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY', $priorTestOnly, 'Process') }
$script:assertions = 0
function Assert-Test([bool]$Condition, [string]$Reason) {
  $script:assertions++
  if (-not $Condition) { throw $Reason }
}
function Assert-Refused([scriptblock]$Action) {
  $refused = $false
  try { & $Action } catch { $refused = $true }
  Assert-Test $refused 'Unsafe generated resume case was admitted.'
}
function Copy-TestObject($Value) { ConvertFrom-OperatorJson ($Value | ConvertTo-Json -Depth 30 -Compress) 'Generated test object' }
function Invoke-AwsJson { throw 'Unexpected AWS call in local fixture test.' }
function Invoke-CandidateApi { throw 'Unexpected API call in local fixture test.' }
function Invoke-WebRequest { throw 'Unexpected network call in local fixture test.' }

$id = '12345678-1234-4234-8234-123456789012'
$bytes = New-RightsResumePdf
$digest = Get-RightsResumeDigest $bytes
Assert-Test ($bytes.Length -eq 625) 'Generated PDF changed size.'
Assert-Test ($digest -ceq 'a7519896f053a2f52b1490d3d9c817151ba9b47ad8f2a326a6f6193d4f6d54eb') 'Generated PDF changed digest.'
$resume = [pscustomobject]@{ Bucket = 'generated-document-bucket'; KmsKeyArn = 'arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012' }
$document = [pscustomobject]@{ id = $id; fileName = 'generated-rights-resume.pdf'; mediaType = 'application/pdf'; sizeBytes = 625; sha256 = $digest; status = 'parsed'; pageCount = 1; characterCount = 50; createdAt = '2026-09-30T12:00:00Z'; updatedAt = '2026-09-30T12:00:00Z' }
Assert-RightsResumeDocument $document $bytes.Length $digest -ExpectedId $id -Parsed
foreach ($mutation in @('id','fileName','mediaType','sizeBytes','sha256','status','pageCount','characterCount','createdAt','extra','string-page','string-character')) {
  $copy = Copy-TestObject $document
  switch ($mutation) {
    'id' { $copy.id = 'not-a-uuid' }
    'sizeBytes' { $copy.sizeBytes = '625' }
    'pageCount' { $copy.pageCount = 2 }
    'characterCount' { $copy.characterCount = 49 }
    'string-page' { $copy.pageCount = '1' }
    'string-character' { $copy.characterCount = '50' }
    'extra' { Add-Member -InputObject $copy -NotePropertyName rawText -NotePropertyValue 'unexpected' }
    default { $copy.$mutation = 'unexpected' }
  }
  Assert-Refused { Assert-RightsResumeDocument $copy $bytes.Length $digest -ExpectedId $id -Parsed }
}
$hash = [Security.Cryptography.SHA256]::Create()
try { $checksum = [Convert]::ToBase64String($hash.ComputeHash($bytes)) } finally { $hash.Dispose() }
$grant = [pscustomobject]@{
  url = "https://$($resume.Bucket).s3.us-east-2.amazonaws.com/"; method = 'POST'; expiresAt = [DateTimeOffset]::UtcNow.AddSeconds(240).ToString('o')
  fields = [pscustomobject]@{
    key = "quarantine/$id/source"; 'Content-Type' = 'application/pdf'; 'x-amz-checksum-algorithm' = 'SHA256'; 'x-amz-checksum-sha256' = $checksum
    'x-amz-server-side-encryption' = 'aws:kms'; 'x-amz-server-side-encryption-aws-kms-key-id' = $resume.KmsKeyArn
    'x-amz-meta-document-id' = $id; 'x-amz-meta-sha256' = $digest; success_action_status = '204'; bucket = $resume.Bucket
    'X-Amz-Algorithm' = 'AWS4-HMAC-SHA256'; 'X-Amz-Credential' = 'generated'; 'X-Amz-Date' = 'generated'; Policy = 'generated'; 'X-Amz-Signature' = 'generated'
  }
}
Assert-RightsResumeGrant $grant $resume $id $bytes
foreach ($target in @('http://generated-document-bucket.s3.us-east-2.amazonaws.com/','https://other.s3.us-east-2.amazonaws.com/','https://generated-document-bucket.s3.us-east-2.amazonaws.com/?leak=true','https://generated-document-bucket.s3.us-east-2.amazonaws.com/path','https://user@generated-document-bucket.s3.us-east-2.amazonaws.com/','https://generated-document-bucket.s3.us-east-2.amazonaws.com:444/')) {
  $copy = Copy-TestObject $grant; $copy.url = $target
  Assert-Refused { Assert-RightsResumeGrant $copy $resume $id $bytes }
}
foreach ($name in @($grant.fields.PSObject.Properties.Name)) {
  $copy = Copy-TestObject $grant; $copy.fields.$name = 'wrong'
  # Signing fields are opaque; absence, not their contents, is the client-side invariant.
  if ($name -cin @('X-Amz-Credential','X-Amz-Date','Policy','X-Amz-Signature')) { $copy.fields.PSObject.Properties.Remove($name) }
  Assert-Refused { Assert-RightsResumeGrant $copy $resume $id $bytes }
}
$copy = Copy-TestObject $grant; $copy.expiresAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
Assert-Refused { Assert-RightsResumeGrant $copy $resume $id $bytes }
$copy.expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString('o')
Assert-Refused { Assert-RightsResumeGrant $copy $resume $id $bytes }
Add-Member -InputObject $copy.fields -NotePropertyName authorization -NotePropertyValue 'unexpected'
Assert-Refused { Assert-RightsResumeGrant $copy $resume $id $bytes }

$script:inventoryCase = 'before'
$script:awsCalls = 0
function Invoke-AwsJson($Arguments, $Description) {
  $script:awsCalls++
  Assert-Test ($Arguments[0] -ceq 's3api' -and $Arguments[1] -ceq 'list-object-versions') 'Object mutation attempted.'
  Assert-Test ($Arguments[3] -ceq $resume.Bucket -and $Arguments[5] -cin @("quarantine/$id/","normalized/$id/")) 'Unscoped object listing.'
  Assert-Test ($Arguments -contains '--no-paginate' -and $Arguments -contains '1000') 'Unbounded object listing.'
  $page = [pscustomobject]@{ IsTruncated = $false; Versions = @(); DeleteMarkers = @() }
  if ($script:inventoryCase -ceq 'before') { $page.Versions = @([pscustomobject]@{ Key = $Arguments[5] + 'fixed'; VersionId = 'generated' }) }
  switch ($script:inventoryCase) {
    'truncated' { $page.IsTruncated = $true }
    'missing-truncation' { $page.PSObject.Properties.Remove('IsTruncated') }
    'string-truncation' { $page.IsTruncated = 'false' }
    'wrong-key' { $page.Versions = @([pscustomobject]@{ Key = 'different/source'; VersionId = 'generated' }) }
    'missing-version' { $page.Versions = @([pscustomobject]@{ Key = $Arguments[5] + 'fixed'; VersionId = '' }) }
    'object-not-array' { $page.Versions = [pscustomobject]@{ Key = $Arguments[5] + 'fixed'; VersionId = 'generated' } }
    'marker' { $page.DeleteMarkers = @([pscustomobject]@{ Key = $Arguments[5] + 'fixed'; VersionId = 'marker' }) }
  }
  return $page
}
$before = Get-RightsResumePrefixCounts $resume $id
Assert-Test ($before.sourceVersions -eq 1 -and $before.normalizedVersions -eq 1 -and $before.deleteMarkers -eq 0) 'Before counts wrong.'
foreach ($case in @('truncated','missing-truncation','string-truncation','wrong-key','missing-version','object-not-array')) {
  $script:inventoryCase = $case
  Assert-Refused { Get-RightsResumePrefixCounts $resume $id }
}
$fixture = [pscustomobject]@{ DocumentId = $id; Before = $before }
$script:inventoryCase = 'after'
$coverage = Confirm-RightsResumeDeletion $resume $fixture
Assert-RightsResumeCoverage $coverage
Assert-Test (($coverage | ConvertTo-Json -Compress) -notmatch $id) 'Receipt leaked document identity.'
foreach ($case in @('before','marker','truncated')) {
  $script:inventoryCase = $case
  Assert-Refused { Confirm-RightsResumeDeletion $resume $fixture }
}
foreach ($name in @($coverage.PSObject.Properties.Name)) {
  $copy = Copy-TestObject $coverage
  if ($name -ceq 'valid') { $copy.valid = 'true' } else { $copy.$name = '0' }
  Assert-Refused { Assert-RightsResumeCoverage $copy }
}
$copy = Copy-TestObject $coverage; Add-Member -InputObject $copy -NotePropertyName documentId -NotePropertyValue $id
Assert-Refused { Assert-RightsResumeCoverage $copy }

# Complete fixed upload lifecycle uses mocked API/upload only. No credentials or AWS calls.
$script:apiCalls = 0; $script:uploads = 0; $script:fixtureCase = 'success'; $script:inventoryCase = 'after'
function Send-RightsResumeUpload($Grant, $Resume, $Id, $Bytes) {
  Assert-RightsResumeGrant $Grant $Resume $Id $Bytes
  $script:uploads++
  if ($script:fixtureCase -ceq 'upload-failure') { throw 'Simulated ambiguous upload failure.' }
  $script:inventoryCase = 'before'
}
function Invoke-CandidateApi($Method, $Path, $Token, $Body, $Headers, $ExpectedStatus) {
  $script:apiCalls++
  Assert-Test ($Token -ceq 'generated-token') 'Bearer scope changed.'
  if ($script:apiCalls -eq 1) {
    $documents = @()
    if ($script:fixtureCase -ceq 'nonempty') { $documents = @($document) }
    return [pscustomobject]@{ Body = [pscustomobject]@{ documents = $documents } }
  }
  if ($script:apiCalls -eq 2) {
    Assert-Test ($Method -ceq 'POST' -and $Path -ceq '/resumes/uploads' -and $ExpectedStatus[0] -eq 201) 'Unexpected registration.'
    Assert-Test ($Body.sha256 -ceq $digest -and $Body.sizeBytes -eq 625 -and $Headers['idempotency-key'] -cmatch '^rights-resume-[a-f0-9]{32}$') 'Unbound generated upload.'
    $copy = Copy-TestObject $document; $copy.status = 'awaiting_upload'
    return [pscustomobject]@{ Body = [pscustomobject]@{ document = $copy; upload = $grant } }
  }
  $copy = Copy-TestObject $document
  if ($script:fixtureCase -ceq 'rejected') { $copy.status = 'rejected' }
  return [pscustomobject]@{ Body = [pscustomobject]@{ documents = @($copy) } }
}
$actual = New-RightsResumeFixture 'generated-token' $resume
Assert-Test ($actual.DocumentId -ceq $id -and $script:uploads -eq 1 -and $script:apiCalls -eq 3) 'Fixture lifecycle wrong.'
foreach ($case in @('nonempty','collision','upload-failure','rejected')) {
  $script:fixtureCase = $case; $script:apiCalls = 0; $script:uploads = 0
  $script:inventoryCase = $(if ($case -ceq 'collision') { 'before' } else { 'after' })
  Assert-Refused { New-RightsResumeFixture 'generated-token' $resume }
  Assert-Test ($script:uploads -le 1) 'Ambiguous upload retried.'
  if ($case -cin @('nonempty','collision')) { Assert-Test ($script:uploads -eq 0) 'Pre-existing fixture uploaded.' }
}

# Plan selectors preserve historical modes and reject a changed fixture or sequence.
$planRoot = Join-Path ([IO.Path]::GetTempPath()) "resume-fixture-plans-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = $planRoot; $SourceSha = 'a' * 40; $ReviewedPolicySha256 = 'b' * 64
$aliases = [ordered]@{}
foreach ($name in @('gateway','outboxStarter','durable','activity','terminal')) { $aliases[$name] = [pscustomobject]@{ AliasArnSha256 = 'c' * 64; Version = 1; CodeSha256 = ('A' * 43) + '=' } }
$boundary = [pscustomobject]@{
  Runtime = [pscustomobject]@{ Aliases = [pscustomobject]$aliases }; Resume = [pscustomobject]@{ Identity = [ordered]@{ bucketSha256 = 'd' * 64 } }
  Snapshot = [pscustomobject]@{ Lineage = 'generated'; Serial = 1; VersionId = 'generated' }
  Identity = [pscustomobject]@{ SubjectSha256 = 'e' * 64; AttestationSha256 = 'f' * 64; IdTokenAudienceSha256 = '1' * 64 }
  Secret = [pscustomobject]@{ ClientIdSha256 = '2' * 64; AuthorizedOwnerSha256 = '3' * 64; RevocationMode = 'delete_user_only' }
  Backup = $null; Health = $null; Drift = [pscustomobject]@{ Sha256 = '4' * 64 }
}
try {
  foreach ($restricted in @($false,$true)) {
    foreach ($enabled in @($false,$true)) {
      $RestrictedAnswerFixture = $restricted; $ResumeFixture = $enabled
      $plan = New-ExecutionPlan $boundary
      Assert-Test ($plan.fixedSequence.Count -eq (15 + [int]$restricted + 2 * [int]$enabled)) 'Plan step count wrong.'
      $ExecutionPlanPath = Join-Path $planRoot 'generated.json'
      Write-ExclusiveJson $ExecutionPlanPath $plan; $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath
      $null = Read-ExecutionPlan
      if ($enabled) {
        $ResumeFixture = $false; Assert-Refused { Read-ExecutionPlan }; $ResumeFixture = $true
        $plan.fixedSequence[0] = 'different'
        Remove-Item -LiteralPath $ExecutionPlanPath
        Write-ExclusiveJson $ExecutionPlanPath $plan; $ReviewedExecutionPlanSha256 = Get-FileSha256 $ExecutionPlanPath
        Assert-Refused { Read-ExecutionPlan }
      }
      Remove-Item -LiteralPath $ExecutionPlanPath
    }
  }
} finally {
  if (Test-Path -LiteralPath $planRoot) { Remove-Item -LiteralPath $planRoot }
}
# All runtime observations are metadata-only and fail before an upload on drift or dark triggers.
$ExpectedPolicyVersion = 'd2-development-synthetic-v1'; $ExpectedAccountId = '123456789012'
$processorArn = 'arn:aws:lambda:us-east-2:123456789012:function:generated-processor:current'
$parserArn = 'arn:aws:lambda:us-east-2:123456789012:function:generated-parser:7'
$scanArn = 'arn:aws:guardduty:us-east-2:123456789012:malware-protection-plan/generated'
$ruleArn = 'arn:aws:events:us-east-2:123456789012:rule/generated-scan'
$outputs = [pscustomobject]@{
  candidate_document_bucket = $resume.Bucket; document_processor_alias_arn = $processorArn; document_parser_version_arn = $parserArn
  candidate_document_malware_protection_plan_id = 'generated'; document_scan_event_source_mapping_uuid = 'generated-mapping'; document_scan_event_rule_arn = $ruleArn
}
$runtime = [pscustomobject]@{ Aliases = [pscustomobject]@{
  gateway = [pscustomobject]@{ Environment = [pscustomobject]@{ DOCUMENT_UPLOAD_BUCKET = $resume.Bucket; DOCUMENT_UPLOAD_KMS_KEY_ARN = $resume.KmsKeyArn } }
  activity = [pscustomobject]@{ Environment = [pscustomobject]@{ CANDIDATE_DOCUMENT_BUCKET = $resume.Bucket } }
} }
$script:runtimeCase = 'success'
function Get-StateOutput($Snapshot, $Name) {
  if ($script:runtimeCase -ceq 'mutable-parser' -and $Name -ceq 'document_parser_version_arn') { return $parserArn.Replace(':7', ':current') }
  if ($script:runtimeCase -ceq 'state-plan' -and $Name -ceq 'candidate_document_malware_protection_plan_id') { return 'different' }
  return $outputs.$Name
}
function Get-LambdaIdentity($Arn, $Description) {
  Assert-Test ($Arn -ceq $processorArn) 'Different processor alias inspected.'
  $environment = [pscustomobject]@{ CANDIDATE_DOCUMENT_BUCKET = $resume.Bucket; DOCUMENT_PARSER_VERSION = 'resume-parser-v1'; PLATFORM_KMS_KEY_ARN = $resume.KmsKeyArn; DOCUMENT_PARSER_FUNCTION_ARN = $parserArn; GUARDDUTY_PROTECTION_PLAN_ARN = $scanArn }
  switch ($script:runtimeCase) {
    'processor-bucket' { $environment.CANDIDATE_DOCUMENT_BUCKET = 'different' }
    'processor-key' { $environment.PLATFORM_KMS_KEY_ARN = 'different' }
    'processor-parser' { $environment.DOCUMENT_PARSER_FUNCTION_ARN = $parserArn.Replace(':7', ':8') }
    'retained-parser' { $environment.DOCUMENT_PARSER_FUNCTION_ARN = $parserArn.Replace(':7', ':6') }
    'foreign-parser' { $environment.DOCUMENT_PARSER_FUNCTION_ARN = $parserArn.Replace('generated-parser', 'other-parser') }
    'mutable-pin' { $environment.DOCUMENT_PARSER_FUNCTION_ARN = $parserArn.Replace(':7', ':current') }
    'semantic-version' { $environment.DOCUMENT_PARSER_VERSION = 'different' }
    'foreign-plan' { $environment.GUARDDUTY_PROTECTION_PLAN_ARN = $scanArn.Replace('123456789012', '223456789012') }
  }
  return [pscustomobject]@{ AliasArnSha256 = 'c' * 64; Version = 1; CodeSha256 = ('A' * 43) + '='; Environment = $environment }
}
function Invoke-AwsJson($Arguments, $Description) {
  if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-function-configuration') {
    $value = [pscustomobject]@{ Version = '7'; CodeSha256 = ('A' * 43) + '='; Environment = [pscustomobject]@{ Variables = [pscustomobject]@{ CANDIDATE_DOCUMENT_BUCKET = $resume.Bucket; DOCUMENT_PARSER_VERSION = 'resume-parser-v1' } } }
    if ($script:runtimeCase -ceq 'parser-version') { $value.Version = '8' }
    if ($script:runtimeCase -ceq 'parser-hash') { $value.CodeSha256 = 'invalid' }
    if ($script:runtimeCase -ceq 'retained-parser') {
      Assert-Test ($Arguments[3] -ceq $parserArn.Replace(':7', ':6')) 'Retained parser inspected the current artifact instead.'
      $value.Version = '6'
    }
    return $value
  }
  if ($Arguments[0] -ceq 'guardduty') {
    $value = [pscustomobject]@{ Status = 'ACTIVE'; ProtectedResource = [pscustomobject]@{ S3Bucket = [pscustomobject]@{ BucketName = $resume.Bucket; ObjectPrefixes = @('quarantine/') } }; Actions = [pscustomobject]@{ Tagging = [pscustomobject]@{ Status = 'ENABLED' } } }
    if ($script:runtimeCase -ceq 'scan-inactive') { $value.Status = 'INACTIVE' }
    if ($script:runtimeCase -ceq 'scan-prefix') { $value.ProtectedResource.S3Bucket.ObjectPrefixes = @('quarantine/','different/') }
    if ($script:runtimeCase -ceq 'scan-bucket') { $value.ProtectedResource.S3Bucket.BucketName = 'different' }
    if ($script:runtimeCase -ceq 'scan-tagging') { $value.Actions.Tagging.Status = 'DISABLED' }
    return $value
  }
  if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-event-source-mapping') {
    $value = [pscustomobject]@{ UUID = 'generated-mapping'; State = 'Enabled'; FunctionArn = $processorArn; EventSourceArn = 'generated-queue' }
    if ($script:runtimeCase -ceq 'mapping-disabled') { $value.State = 'Disabled' }
    if ($script:runtimeCase -ceq 'mapping-target') { $value.FunctionArn = 'different' }
    return $value
  }
  if ($Arguments[0] -ceq 'events') {
    $value = [pscustomobject]@{ Arn = $ruleArn; State = 'ENABLED'; EventPattern = 'generated' }
    if ($script:runtimeCase -ceq 'rule-disabled') { $value.State = 'DISABLED' }
    if ($script:runtimeCase -ceq 'rule-target') { $value.Arn = 'different' }
    return $value
  }
  throw 'Unexpected metadata command.'
}
$observed = Get-RightsResumeRuntime ([pscustomobject]@{}) $runtime
Assert-Test ($observed.Bucket -ceq $resume.Bucket -and ($observed.Identity | ConvertTo-Json -Depth 10 -Compress) -notmatch $resume.Bucket) 'Runtime boundary leaked raw bucket.'
$script:runtimeCase = 'retained-parser'
$retained = Get-RightsResumeRuntime ([pscustomobject]@{}) $runtime
Assert-Test ($retained.Identity.parser.versionArnSha256 -ceq (Get-TextSha256 $parserArn.Replace(':7', ':6')) -and $retained.Identity.parser.currentVersionArnSha256 -ceq (Get-TextSha256 $parserArn)) 'Retained/current parser identities were not independently bound.'
foreach ($case in @('mutable-parser','foreign-parser','mutable-pin','state-plan','processor-bucket','processor-key','processor-parser','semantic-version','foreign-plan','parser-version','parser-hash','scan-inactive','scan-prefix','scan-bucket','scan-tagging','mapping-disabled','mapping-target','rule-disabled','rule-target')) {
  $script:runtimeCase = $case
  Assert-Refused { Get-RightsResumeRuntime ([pscustomobject]@{}) $runtime }
}
$script:runtimeCase = 'success'
foreach ($case in @('gateway-bucket','activity-bucket','foreign-key')) {
  $copy = Copy-TestObject $runtime
  switch ($case) {
    'gateway-bucket' { $copy.Aliases.gateway.Environment.DOCUMENT_UPLOAD_BUCKET = 'different' }
    'activity-bucket' { $copy.Aliases.activity.Environment.CANDIDATE_DOCUMENT_BUCKET = 'different' }
    'foreign-key' { $copy.Aliases.gateway.Environment.DOCUMENT_UPLOAD_KMS_KEY_ARN = $resume.KmsKeyArn.Replace('123456789012:', '223456789012:') }
  }
  Assert-Refused { Get-RightsResumeRuntime ([pscustomobject]@{}) $copy }
}
# Exercise the real lifecycle ordering around the marker, prefix proof and receipt creation.
$ResumeFixture = $true; $RestrictedAnswerFixture = $false
$script:lifecycleCase = 'success'; $script:events = @()
$ordinaryCoverage = [pscustomobject]@{ valid = $true; consentCount = 1; contributionApprovalCount = 1; contributionCount = 1; privateCaptureCount = 1; trustCaseCount = 1; trustCaseEventCount = 1 }
$syntheticIdentity = [pscustomobject]@{ Token = 'generated-token'; IdToken = 'generated-id-token'; Subject = 'generated-subject'; SubjectSha256 = 'e' * 64 }
$boundary.Identity = $syntheticIdentity
$boundary.Runtime | Add-Member -NotePropertyName Issuer -NotePropertyValue 'https://generated.example/'
$boundary.Runtime | Add-Member -NotePropertyName IdTokenAudience -NotePropertyValue 'generated-audience'
$boundary.Resume = $resume
function Assert-SyntheticRefreshPrerequisites { return $true }
function Assert-CandidateRightsExportReady { return $true }
function New-RightsResumeFixture($Token, $Resume) { $script:events += 'fixture'; return $fixture }
function Invoke-CandidateApi($Method, $Path, $Token, $Body, $Headers, $ExpectedStatus) {
  $script:events += $Path
  if ($Path -ceq '/me/data-exports') { return [pscustomobject]@{ Body = [pscustomobject]@{ id = 'generated-export'; policyVersion = $ExpectedPolicyVersion } } }
  if ($Path.EndsWith('/confirm')) { return [pscustomobject]@{ Body = [pscustomobject]@{ state = 'quarantined' } } }
  return [pscustomobject]@{ Body = [pscustomobject]@{ id = 'generated-deletion'; version = 1 } }
}
function Wait-ExportReady { return [pscustomobject]@{ download = [pscustomobject]@{ url = 'https://generated.example/' } } }
function Test-ExactVersionGrant { return [pscustomobject]@{ ExportCoverage = $ordinaryCoverage; GrantExpiresAt = 'generated'; ArtifactExpiresAt = 'generated' } }
function Wait-GrantExpiry { return $true }
function Refresh-SyntheticIdentityContext { return $syntheticIdentity }
function Read-SyntheticIdentityContext { return $syntheticIdentity }
function Get-CandidateDeletionSubjectDigest { return 'generated-digest' }
function Wait-DeletionCompletion {
  $script:events += 'marker'
  if ($script:lifecycleCase -ceq 'marker-failure') { throw 'Generated marker failure.' }
}
function Confirm-RightsResumeDeletion($Resume, $Fixture) {
  $script:events += 'prefix'
  if ($script:lifecycleCase -ceq 'prefix-failure') { throw 'Generated leftover version.' }
  return $coverage
}
function Assert-OperationalHealth {
  $script:events += 'health'
  return [pscustomobject]@{ QueueCount = 1; AlarmCount = 1 }
}
$receipt = Invoke-FixedLifecycle $boundary ([pscustomobject]@{})
Assert-Test ($receipt.schemaVersion -eq 3 -and $receipt.resumeCoverage.valid -eq $true) 'Missing resume receipt.'
Assert-Test ([Array]::IndexOf($script:events, 'fixture') -lt [Array]::IndexOf($script:events, '/me/data-exports')) 'Fixture started after export.'
Assert-Test ([Array]::IndexOf($script:events, 'marker') -lt [Array]::IndexOf($script:events, 'prefix') -and [Array]::IndexOf($script:events, 'prefix') -lt [Array]::IndexOf($script:events, 'health')) 'Prefix proof is not after the completed marker.'
foreach ($case in @('marker-failure','prefix-failure')) {
  $script:lifecycleCase = $case; $script:events = @()
  Assert-Refused { Invoke-FixedLifecycle $boundary ([pscustomobject]@{}) }
  Assert-Test ($script:events -cnotcontains 'health' -and $null -eq $script:VerifiedResumeCoverage) 'Failure promoted to completed cleanup.'
  if ($case -ceq 'marker-failure') { Assert-Test ($script:events -cnotcontains 'prefix') 'Prefix proof preceded the marker.' }
}
$receiptRoot = Join-Path ([IO.Path]::GetTempPath()) "resume-fixture-receipts-$([guid]::NewGuid().ToString('N'))"
$operatorRoot = $receiptRoot
try {
  foreach ($case in @('complete','historical','missing','leftover','private-field')) {
    $copy = Copy-TestObject $receipt
    switch ($case) {
      'historical' { $copy.schemaVersion = 1 }
      'missing' { $copy.PSObject.Properties.Remove('resumeCoverage') }
      'leftover' { $copy.resumeCoverage.sourceVersionsAfter = 1 }
      'private-field' { Add-Member -InputObject $copy.resumeCoverage -NotePropertyName documentId -NotePropertyValue $id }
    }
    $ReceiptPath = Join-Path $receiptRoot 'generated.json'
    Write-ExclusiveJson $ReceiptPath $copy
    $ReviewedReceiptSha256 = Get-FileSha256 $ReceiptPath
    if ($case -ceq 'complete') {
      $validated = Read-AggregateReceipt
      Assert-Test ($validated.resumeCoverage.valid -eq $true) 'Completed resume receipt refused.'
    } else { Assert-Refused { Read-AggregateReceipt } }
    Remove-Item -LiteralPath $ReceiptPath
  }
} finally {
  if (Test-Path -LiteralPath $ReceiptPath) { Remove-Item -LiteralPath $ReceiptPath }
  if (Test-Path -LiteralPath $receiptRoot) { Remove-Item -LiteralPath $receiptRoot }
}
Write-Output "Generated resume fixture assertions: $script:assertions; local mocks only."
