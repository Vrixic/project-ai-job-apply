param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[0-9]{12}$')]
  [string]$ExpectedAccountId,

  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$')]
  [string]$AuthorizedOwner,

  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [string]$Region = 'us-east-2'
)

$ErrorActionPreference = 'Stop'
$secretName = 'ai-job-apply/development/candidate-rights/auth0-management'
$expectedRevocationMode = 'delete_user_only'

function Get-TextSha256([string]$Value) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}

function Invoke-AwsJson([string[]]$Arguments, [string]$Description) {
  $output = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed."
  }
  try {
    return ($output -join "`n") | ConvertFrom-Json
  }
  catch {
    throw "$Description returned invalid JSON."
  }
}

if ($Region -cne 'us-east-2' -or $AwsProfile -cne 'ai-job-apply-development-admin') {
  throw 'This configurator is restricted to the approved development SSO profile in us-east-2.'
}
if ($AuthorizedOwner -match '(?i)zach[^a-z0-9]*becker') {
  throw 'Zach Becker is not an authorized owner for this credential.'
}

$caller = Invoke-AwsJson @('sts', 'get-caller-identity') 'AWS caller validation'
if ([string]$caller.Account -cne $ExpectedAccountId -or
  -not ([string]$caller.Arn).Contains(':assumed-role/AWSReservedSSO_')) {
  throw 'Use the approved temporary IAM Identity Center role in the exact development account.'
}

$description = Invoke-AwsJson @('secretsmanager', 'describe-secret', '--secret-id', $secretName) 'Candidate-rights secret lookup'
$tags = @{}
foreach ($tag in @($description.Tags)) {
  $tags[[string]$tag.Key] = [string]$tag.Value
}
if ($tags['ai-job-apply:generated-synthetic-only'] -cne 'true' -or
  $tags['ai-job-apply:authorized-owner'] -cne $AuthorizedOwner) {
  throw 'The Terraform-managed generated-synthetic and authorized-owner tags do not match.'
}

$clientId = Read-Host 'Dedicated candidate-rights Auth0 M2M client ID'
if ([string]::IsNullOrWhiteSpace($clientId) -or $clientId.Contains("`r") -or $clientId.Contains("`n")) {
  throw 'The Auth0 client ID must be one nonempty line.'
}
$secureClientSecret = Read-Host 'Dedicated candidate-rights Auth0 M2M client secret' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureClientSecret)
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "ai-job-apply-rights-$([guid]::NewGuid().ToString('N'))"
$temporaryRequest = Join-Path $temporaryDirectory 'put-secret-value.json'

try {
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($clientSecret) -or $clientSecret.Length -lt 16 -or
    $clientSecret.Contains("`r") -or $clientSecret.Contains("`n")) {
    throw 'The Auth0 client secret must be one line of at least 16 characters.'
  }

  $secretJson = [ordered]@{
    clientId       = $clientId
    clientSecret   = $clientSecret
    revocationMode = $expectedRevocationMode
  } | ConvertTo-Json -Compress
  $requestJson = [ordered]@{
    SecretId     = [string]$description.ARN
    SecretString = $secretJson
  } | ConvertTo-Json -Compress

  $null = [IO.Directory]::CreateDirectory($temporaryDirectory)
  [IO.File]::WriteAllText($temporaryRequest, $requestJson, [Text.UTF8Encoding]::new($false))
  $put = Invoke-AwsJson @(
    'secretsmanager', 'put-secret-value',
    '--cli-input-json', "file://$temporaryRequest"
  ) 'Candidate-rights secret population'
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  $clientSecret = $null
  $secretJson = $null
  $requestJson = $null
  if (Test-Path -LiteralPath $temporaryDirectory) {
    $resolvedTemporaryDirectory = [IO.Path]::GetFullPath($temporaryDirectory)
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemporaryDirectory.StartsWith($resolvedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedTemporaryDirectory) -notmatch '^ai-job-apply-rights-[a-f0-9]{32}$') {
      throw 'Refusing to clean an unexpected temporary credential path.'
    }
    Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
  }
}

$stored = Invoke-AwsJson @('secretsmanager', 'get-secret-value', '--secret-id', $secretName) 'Candidate-rights secret verification'
$storedSecret = ([string]$stored.SecretString) | ConvertFrom-Json
$storedKeys = @($storedSecret.PSObject.Properties.Name | Sort-Object)
if (($storedKeys -join ',') -cne 'clientId,clientSecret,revocationMode' -or
  [string]$storedSecret.clientId -cne $clientId -or
  ([string]$storedSecret.clientSecret).Length -lt 16 -or
  [string]$storedSecret.revocationMode -cne $expectedRevocationMode) {
  throw 'The stored candidate-rights credential failed exact-schema verification.'
}

$result = [pscustomobject]@{
  SecretArnSha256 = Get-TextSha256 ([string]$description.ARN)
  ClientIdSha256  = Get-TextSha256 $clientId
  VersionIdSha256 = Get-TextSha256 ([string]$put.VersionId)
  RevocationMode  = $expectedRevocationMode
  SecretPrinted   = $false
}
$stored = $null
$storedSecret = $null
$clientId = $null
$result
