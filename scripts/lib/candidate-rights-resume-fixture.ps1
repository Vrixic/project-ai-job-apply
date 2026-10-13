# Generated-only candidate upload and read-only prefix observations. No direct object deletion,
# SQL, arbitrary input file, caller-selected bucket, or parser invocation is admitted here.
function New-RightsResumePdf {
  # Same minimal ASCII PDF geometry as the existing generated document-processing corpus.
  $text = 'Generated synthetic candidate - Skills: TypeScript'
  $stream = "BT /F1 12 Tf 72 720 Td ($text) Tj ET`n"
  $objects = @(
    "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n",
    "2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n",
    "3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`nendobj`n",
    "4 0 obj`n<< /Length $($stream.Length) >>`nstream`n${stream}endstream`nendobj`n",
    "5 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`nendobj`n"
  )
  $source = "%PDF-1.4`n"
  $offsets = @()
  foreach ($item in $objects) { $offsets += $source.Length; $source += $item }
  $xref = $source.Length
  $source += "xref`n0 6`n0000000000 65535 f `n"
  foreach ($offset in $offsets) { $source += $offset.ToString('0000000000') + " 00000 n `n" }
  $source += "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
  return ,([Text.Encoding]::ASCII.GetBytes($source))
}

function Get-RightsResumeDigest {
  param([Parameter(Mandatory)][byte[]]$Bytes)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
}

function Assert-RightsResumeId {
  param([Parameter(Mandatory)][string]$Id)
  if ($Id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'The generated resume identity is invalid.'
  }
}

function Get-RightsResumePrefixCounts {
  param([Parameter(Mandatory)][object]$Resume, [Parameter(Mandatory)][string]$DocumentId)
  Assert-RightsResumeId $DocumentId
  if ([string]$Resume.Bucket -cnotmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') { throw 'The state-bound document bucket is invalid.' }
  $counts = [ordered]@{ sourceVersions = 0; normalizedVersions = 0; deleteMarkers = 0 }
  foreach ($kind in @('quarantine','normalized')) {
    $prefix = "$kind/$DocumentId/"
    $page = Invoke-AwsJson @('s3api','list-object-versions','--bucket',[string]$Resume.Bucket,'--prefix',$prefix,'--no-paginate','--max-keys','1000','--output','json') 'Generated resume prefix observation'
    if ((Get-OptionalProperty $page 'IsTruncated') -isnot [bool] -or $page.IsTruncated -ne $false) {
      throw 'The generated resume prefix observation is incomplete.'
    }
    foreach ($category in @('Versions','DeleteMarkers')) {
      $property = $page.PSObject.Properties[$category]
      if ($null -eq $property) { continue }
      $items = $property.Value
      if ($items -isnot [array] -or $items.Count -gt 1000) { throw 'The generated resume version inventory is invalid.' }
      foreach ($item in $items) {
        if ([string]$item.Key -cnotlike "$prefix*" -or [string]$item.Key -cmatch '[\x00-\x1f\x7f]' -or
            [string]::IsNullOrWhiteSpace([string]$item.VersionId)) { throw 'The generated resume prefix returned an out-of-scope version.' }
      }
      if ($category -ceq 'DeleteMarkers') { $counts.deleteMarkers += $items.Count }
      elseif ($kind -ceq 'quarantine') { $counts.sourceVersions += $items.Count }
      else { $counts.normalizedVersions += $items.Count }
    }
  }
  return [pscustomobject]$counts
}

function Assert-RightsResumeDocument {
  param([Parameter(Mandatory)][object]$Document, [Parameter(Mandatory)][int]$Size, [Parameter(Mandatory)][string]$Sha256, [string]$ExpectedId = '', [switch]$Parsed)
  $names = @('id','fileName','mediaType','sizeBytes','sha256','status','createdAt','updatedAt')
  foreach ($optional in @('pageCount','characterCount')) {
    if ($null -ne (Get-OptionalProperty $Document $optional)) { $names += $optional }
  }
  $null = Assert-ExactPropertySet $Document $names 'Generated resume metadata'
  Assert-RightsResumeId ([string]$Document.id)
  if (($ExpectedId -and [string]$Document.id -cne $ExpectedId) -or [string]$Document.fileName -cne 'generated-rights-resume.pdf' -or
      [string]$Document.mediaType -cne 'application/pdf' -or [string]$Document.sha256 -cne $Sha256 -or
      ($Document.sizeBytes -isnot [int] -and $Document.sizeBytes -isnot [long]) -or $Document.sizeBytes -ne $Size -or
      [string]$Document.status -cnotin @('awaiting_upload','scanning','parsing','parsed')) {
    throw 'The generated resume metadata differs from its fixed upload.'
  }
  try { $null = [DateTimeOffset]::Parse([string]$Document.createdAt); $null = [DateTimeOffset]::Parse([string]$Document.updatedAt) }
  catch { throw 'The generated resume metadata timestamp is invalid.' }
  if ($Parsed) {
    $pages = Get-OptionalProperty $Document 'pageCount'
    $characters = Get-OptionalProperty $Document 'characterCount'
    if ([string]$Document.status -cne 'parsed' -or ($pages -isnot [int] -and $pages -isnot [long]) -or
        ($characters -isnot [int] -and $characters -isnot [long]) -or $pages -ne 1 -or $characters -ne 50) {
      throw 'The generated resume did not parse to its exact fixed page and character counts.'
    }
  }
}

function Assert-RightsResumeGrant {
  param([Parameter(Mandatory)][object]$Grant, [Parameter(Mandatory)][object]$Resume, [Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][byte[]]$Bytes)
  $null = Assert-ExactPropertySet $Grant @('url','method','fields','expiresAt') 'Generated resume upload grant'
  Assert-RightsResumeId $Id
  $uri = [Uri]([string]$Grant.url)
  if ($uri.Scheme -cne 'https' -or $uri.Host -cne "$($Resume.Bucket).s3.us-east-2.amazonaws.com" -or
      $uri.Port -ne 443 -or $uri.AbsolutePath -cne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo -or
      [string]$Grant.method -cne 'POST') { throw 'The generated resume upload target is outside its exact S3 boundary.' }
  $expires = [DateTimeOffset]::Parse([string]$Grant.expiresAt)
  if ($expires -le [DateTimeOffset]::UtcNow -or $expires -gt [DateTimeOffset]::UtcNow.AddSeconds(305)) { throw 'The generated resume upload grant is expired or unbounded.' }
  $allowed = @('key','Content-Type','x-amz-checksum-algorithm','x-amz-checksum-sha256','x-amz-server-side-encryption','x-amz-server-side-encryption-aws-kms-key-id','x-amz-meta-document-id','x-amz-meta-sha256','success_action_status','bucket','X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Security-Token','Policy','X-Amz-Signature')
  foreach ($property in $Grant.fields.PSObject.Properties) {
    if ($property.Name -cnotin $allowed -or $property.Value -isnot [string] -or $property.Value.Length -lt 1 -or $property.Value.Length -gt 8192) {
      throw 'The generated resume upload fields are invalid.'
    }
  }
  $digest = Get-RightsResumeDigest $Bytes
  $expected = [ordered]@{
    key = "quarantine/$Id/source"; 'Content-Type' = 'application/pdf'; 'x-amz-checksum-algorithm' = 'SHA256'
    'x-amz-server-side-encryption' = 'aws:kms'; 'x-amz-server-side-encryption-aws-kms-key-id' = [string]$Resume.KmsKeyArn
    'x-amz-meta-document-id' = $Id; 'x-amz-meta-sha256' = $digest; success_action_status = '204'
    bucket = [string]$Resume.Bucket; 'X-Amz-Algorithm' = 'AWS4-HMAC-SHA256'
  }
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $expected['x-amz-checksum-sha256'] = [Convert]::ToBase64String($hash.ComputeHash($Bytes)) } finally { $hash.Dispose() }
  foreach ($name in $expected.Keys) {
    if ([string](Get-OptionalProperty $Grant.fields $name) -cne $expected[$name]) { throw 'The generated resume upload fields do not bind its fixed bytes and key.' }
  }
  foreach ($name in @('X-Amz-Credential','X-Amz-Date','Policy','X-Amz-Signature')) {
    if ([string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $Grant.fields $name))) { throw 'The generated resume upload is not signed.' }
  }
}

function Send-RightsResumeUpload {
  param([Parameter(Mandatory)][object]$Grant, [Parameter(Mandatory)][object]$Resume, [Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][byte[]]$Bytes)
  $client = $null; $content = $null; $response = $null; $deadline = $null; $request = $null
  try {
    Assert-RightsResumeGrant $Grant $Resume $Id $Bytes
    $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
    $content = [Net.Http.MultipartFormDataContent]::new()
    foreach ($property in $Grant.fields.PSObject.Properties) { $content.Add([Net.Http.StringContent]::new($property.Value), $property.Name) }
    $file = [Net.Http.ByteArrayContent]::new($Bytes)
    $file.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/pdf')
    $content.Add($file, 'file', 'generated-rights-resume.pdf')
    $deadline = [Threading.CancellationTokenSource]::new(60000)
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, [string]$Grant.url)
    $request.Content = $content
    $response = Wait-CandidateRightsTask ($client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token)) $deadline.Token
    if ([int]$response.StatusCode -ne 204) { throw 'upload-refused' }
  } catch { throw 'The generated resume upload failed; preserve the disposable scope and do not retry blindly.' }
  finally {
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $request) { $request.Dispose() }
    if ($null -ne $content) { $content.Dispose() }
    if ($null -ne $client) { $client.Dispose() }
    if ($null -ne $deadline) { $deadline.Dispose() }
  }
}

function Assert-RightsResumeCoverage {
  param([Parameter(Mandatory)][object]$Coverage)
  $null = Assert-ExactPropertySet $Coverage @('valid','parsedResumes','sourceVersionsBefore','normalizedVersionsBefore','sourceVersionsAfter','normalizedVersionsAfter','deleteMarkersAfter') 'Generated resume coverage'
  if ($Coverage.valid -isnot [bool] -or $Coverage.valid -ne $true) { throw 'Generated resume coverage is invalid.' }
  foreach ($name in @('parsedResumes','sourceVersionsBefore','normalizedVersionsBefore','sourceVersionsAfter','normalizedVersionsAfter','deleteMarkersAfter')) {
    $value = $Coverage.$name
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -lt 0 -or $value -gt 1000) { throw 'Generated resume coverage is not a bounded integer.' }
  }
  if ($Coverage.parsedResumes -ne 1 -or $Coverage.sourceVersionsBefore -lt 1 -or $Coverage.normalizedVersionsBefore -lt 1 -or
      $Coverage.sourceVersionsAfter -ne 0 -or $Coverage.normalizedVersionsAfter -ne 0 -or $Coverage.deleteMarkersAfter -ne 0) {
    throw 'Generated resume coverage does not prove parsed-prefix cleanup.'
  }
}

function Get-RightsResumeRuntime {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][object]$Runtime)
  if ($ExpectedPolicyVersion -cnotin @('d2-development-synthetic-v1','d3-development-synthetic-v1')) { throw 'The generated resume fixture requires the reviewed synthetic policy.' }
  $bucket = [string](Get-StateOutput $Snapshot 'candidate_document_bucket')
  $key = [string](Get-OptionalProperty $Runtime.Aliases.gateway.Environment 'DOCUMENT_UPLOAD_KMS_KEY_ARN')
  if ($bucket -cnotmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' -or
      $key -cnotmatch "^arn:aws:kms:us-east-2:$ExpectedAccountId`:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" -or
      [string](Get-OptionalProperty $Runtime.Aliases.gateway.Environment 'DOCUMENT_UPLOAD_BUCKET') -cne $bucket -or
      [string](Get-OptionalProperty $Runtime.Aliases.activity.Environment 'CANDIDATE_DOCUMENT_BUCKET') -cne $bucket) {
    throw 'The generated resume bucket and KMS boundary is unavailable.'
  }
  $processorArn = [string](Get-StateOutput $Snapshot 'document_processor_alias_arn')
  $processor = Get-LambdaIdentity $processorArn 'Document processor'
  $currentParserArn = [string](Get-StateOutput $Snapshot 'document_parser_version_arn')
  $parserArn = [string](Get-OptionalProperty $processor.Environment 'DOCUMENT_PARSER_FUNCTION_ARN')
  $parserPattern = "^arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:(?<name>[A-Za-z0-9_-]+):(?<version>[1-9][0-9]*)$"
  $currentParser = [regex]::Match($currentParserArn, $parserPattern)
  $pinnedParser = [regex]::Match($parserArn, $parserPattern)
  if (-not $currentParser.Success -or -not $pinnedParser.Success -or
      $currentParser.Groups['name'].Value -cne $pinnedParser.Groups['name'].Value -or
      [long]$pinnedParser.Groups['version'].Value -gt [long]$currentParser.Groups['version'].Value) {
    throw 'The generated resume parser must be an immutable regional version.'
  }
  $parserVersion = $pinnedParser.Groups['version'].Value
  $parser = Invoke-AwsJson @('lambda','get-function-configuration','--function-name',$parserArn,'--output','json') 'Document parser version'
  if ([string]$parser.Version -cne $parserVersion -or [string]$parser.CodeSha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw 'The generated resume parser identity is invalid.' }
  foreach ($environment in @($processor.Environment,$parser.Environment.Variables)) {
    if ([string](Get-OptionalProperty $environment 'CANDIDATE_DOCUMENT_BUCKET') -cne $bucket -or
        [string](Get-OptionalProperty $environment 'DOCUMENT_PARSER_VERSION') -cne 'resume-parser-v1') { throw 'The generated resume processor boundary differs from state.' }
  }
  if ([string](Get-OptionalProperty $processor.Environment 'PLATFORM_KMS_KEY_ARN') -cne $key -or
      [string](Get-OptionalProperty $processor.Environment 'DOCUMENT_PARSER_FUNCTION_ARN') -cne $parserArn) { throw 'The generated resume processor KMS or parser binding differs.' }
  $planArn = [string](Get-OptionalProperty $processor.Environment 'GUARDDUTY_PROTECTION_PLAN_ARN')
  if ($planArn -cnotmatch "^arn:aws:guardduty:us-east-2:$ExpectedAccountId`:malware-protection-plan/(?<id>[A-Za-z0-9]+)$") { throw 'The generated resume scan plan is invalid.' }
  $planId = $Matches.id
  $statePlan = [string](Get-StateOutput $Snapshot 'candidate_document_malware_protection_plan_id')
  if ($statePlan -cne $planId -and $statePlan -cne $planArn) { throw 'The generated resume scan plan differs from state.' }
  $scan = Invoke-AwsJson @('guardduty','get-malware-protection-plan','--malware-protection-plan-id',$planId,'--output','json') 'Document scan plan'
  if ([string]$scan.Status -cne 'ACTIVE' -or [string]$scan.ProtectedResource.S3Bucket.BucketName -cne $bucket -or
      (@($scan.ProtectedResource.S3Bucket.ObjectPrefixes) -join ',') -cne 'quarantine/' -or [string]$scan.Actions.Tagging.Status -cne 'ENABLED') {
    throw 'The generated resume requires active exact-prefix malware scanning and tagging.'
  }
  $mappingId = [string](Get-StateOutput $Snapshot 'document_scan_event_source_mapping_uuid')
  $mapping = Invoke-AwsJson @('lambda','get-event-source-mapping','--uuid',$mappingId,'--output','json') 'Document scan mapping'
  if ([string]$mapping.UUID -cne $mappingId -or [string]$mapping.State -cne 'Enabled' -or [string]$mapping.FunctionArn -cne $processorArn) { throw 'The generated resume scan mapping is not enabled and exact.' }
  $ruleArn = [string](Get-StateOutput $Snapshot 'document_scan_event_rule_arn')
  if ($ruleArn -cnotmatch "^arn:aws:events:us-east-2:$ExpectedAccountId`:rule/(?<name>[A-Za-z0-9_-]+)$") { throw 'The generated resume scan rule is invalid.' }
  $rule = Invoke-AwsJson @('events','describe-rule','--name',$Matches.name,'--output','json') 'Document scan rule'
  if ([string]$rule.Arn -cne $ruleArn -or [string]$rule.State -cne 'ENABLED') { throw 'The generated resume scan rule is not enabled and exact.' }
  return [pscustomobject]@{
    Bucket = $bucket; KmsKeyArn = $key
    Identity = [ordered]@{
      bucketSha256 = Get-TextSha256 $bucket; kmsKeyArnSha256 = Get-TextSha256 $key
      processor = [ordered]@{ aliasArnSha256 = $processor.AliasArnSha256; version = $processor.Version; codeSha256 = $processor.CodeSha256 }
      parser = [ordered]@{ currentVersionArnSha256 = Get-TextSha256 $currentParserArn; versionArnSha256 = Get-TextSha256 $parserArn; codeSha256 = [string]$parser.CodeSha256 }
      scanPlanArnSha256 = Get-TextSha256 $planArn; scanMappingSha256 = Get-TextSha256 ($mappingId + '|' + [string]$mapping.EventSourceArn)
      scanRuleSha256 = Get-TextSha256 ($ruleArn + '|' + [string]$rule.EventPattern)
    }
  }
}

function New-RightsResumeFixture {
  param([Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][object]$Resume)
  $collection = (Invoke-CandidateApi GET '/resumes' $Token $null).Body
  $null = Assert-ExactPropertySet $collection @('documents') 'Generated resume collection'
  if ($collection.documents -isnot [array] -or $collection.documents.Count -ne 0) { throw 'The disposable resume fixture must start empty.' }
  $bytes = New-RightsResumePdf
  try {
    $digest = Get-RightsResumeDigest $bytes
    $body = [ordered]@{ fileName = 'generated-rights-resume.pdf'; mediaType = 'application/pdf'; sizeBytes = $bytes.Length; sha256 = $digest }
    $created = (Invoke-CandidateApi POST '/resumes/uploads' $Token $body @{ 'idempotency-key' = "rights-resume-$([guid]::NewGuid().ToString('N'))" } @(201)).Body
    $null = Assert-ExactPropertySet $created @('document','upload') 'Generated resume registration'
    Assert-RightsResumeDocument $created.document $bytes.Length $digest
    $id = [string]$created.document.id
    $initial = Get-RightsResumePrefixCounts $Resume $id
    if ($initial.sourceVersions -ne 0 -or $initial.normalizedVersions -ne 0 -or $initial.deleteMarkers -ne 0) { throw 'The new generated resume identity has pre-existing objects.' }
    Send-RightsResumeUpload $created.upload $Resume $id $bytes
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
    do {
      $latest = (Invoke-CandidateApi GET '/resumes' $Token $null).Body
      $null = Assert-ExactPropertySet $latest @('documents') 'Generated resume collection'
      if ($latest.documents -isnot [array] -or $latest.documents.Count -ne 1) { throw 'The generated resume owner inventory changed.' }
      $entry = $latest.documents[0]
      Assert-RightsResumeDocument $entry $bytes.Length $digest -ExpectedId $id
      if ([string]$entry.status -ceq 'parsed') {
        Assert-RightsResumeDocument $entry $bytes.Length $digest -ExpectedId $id -Parsed
        $before = Get-RightsResumePrefixCounts $Resume $id
        if ($before.sourceVersions -lt 1 -or $before.normalizedVersions -lt 1 -or $before.deleteMarkers -ne 0) { throw 'The parsed generated resume has incomplete object-version evidence.' }
        return [pscustomobject]@{ DocumentId = $id; Before = $before }
      }
      Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The generated resume did not finish parsing within the bounded wait.'
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Confirm-RightsResumeDeletion {
  param([Parameter(Mandatory)][object]$Resume, [Parameter(Mandatory)][object]$Fixture)
  $after = Get-RightsResumePrefixCounts $Resume $Fixture.DocumentId
  if ($after.sourceVersions -ne 0 -or $after.normalizedVersions -ne 0 -or $after.deleteMarkers -ne 0) {
    throw 'Account deletion left generated resume versions or delete markers; preserve the failure scope.'
  }
  return [pscustomobject]@{
    valid = $true; parsedResumes = 1; sourceVersionsBefore = $Fixture.Before.sourceVersions
    normalizedVersionsBefore = $Fixture.Before.normalizedVersions
    sourceVersionsAfter = 0; normalizedVersionsAfter = 0; deleteMarkersAfter = 0
  }
}
