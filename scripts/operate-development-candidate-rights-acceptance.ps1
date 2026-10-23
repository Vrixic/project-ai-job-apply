[CmdletBinding()]
param(
  [ValidateSet("Status", "Plan", "Execute", "RecoverUnconfirmed", "RecoverCleanup", "Verify")]
  [string]$Action = "Status",

  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$SourceSha = "",

  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
  [string]$ExpectedPolicyVersion = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPolicySha256 = "",

  [ValidateRange(300, 604800)]
  [int]$ExpectedExportLifetimeSeconds = 0,

  [ValidateRange(60, 900)]
  [int]$ExpectedDownloadGrantSeconds = 0,

  [ValidateRange(1, 35)]
  [int]$ExpectedBackupRetentionDays = 0,

  [ValidateRange(60, 900)]
  [int]$ExpectedRecentAuthMaxAgeSeconds = 0,

  [string]$ExpectedOwnerInventory = "identity,profile,documents,jobs,matching,billing,trust",
  [string]$ExpectedSubprocessorInventory = "",

  [string]$ZeroDriftPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedZeroDriftPlanSha256 = "",

  [string]$ExecutionPlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedExecutionPlanSha256 = "",

  [string]$RecoveryFailureTimestamp = "",

  [string]$ReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedReceiptSha256 = "",

  [string]$RecoveryReplayReceiptPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedRecoveryReplayReceiptSha256 = "",

  [switch]$RestrictedAnswerFixture,

  [switch]$ResumeFixture,

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")
. (Join-Path $PSScriptRoot "lib/candidate-rights-restricted-fixture.ps1")
. (Join-Path $PSScriptRoot "lib/candidate-rights-resume-fixture.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-candidate-rights-acceptance.ps1 -Action Status `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-development-candidate-rights-acceptance.ps1 -Action Plan|Execute|RecoverUnconfirmed|RecoverCleanup|Verify `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_SHA `
    -ExpectedPolicyVersion VERSION -ReviewedPolicySha256 SHA256 `
    -ExpectedExportLifetimeSeconds SECONDS -ExpectedDownloadGrantSeconds SECONDS `
    -ExpectedBackupRetentionDays DAYS -ExpectedRecentAuthMaxAgeSeconds SECONDS `
    -ExpectedSubprocessorInventory CSV -ZeroDriftPlanPath PATH `
    -ReviewedZeroDriftPlanSha256 SHA256 [reviewed plan/receipt arguments]

The fixed environment variables CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN and
CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN are required for Plan and Execute, with exactly one of
CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH (existing private file) or
CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_JSON (process-only JSON, at most 8192 UTF-8 bytes).
Supplying both attestation inputs is rejected. JSON input is never written to a file; its exact
UTF-8 text is checksum-bound without reserialization. Existing file checksums remain unchanged.
The tokens and identity are never printed or retained. The access token supplies API scope; the separately
verified ID token supplies recent-authentication and MFA proof for the same subject. The attestation
must describe one disposable generated-synthetic identity and an authorized owner other than Zach
Becker.

Execute also requires CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN and
CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET in the same process. Their prerequisites are checked
before the first candidate API mutation and again before refresh. Plan does not require them.
Access-token refresh does not renew the separately retained ID token's recent-MFA authority.

Plan is read-only and writes one checksum-reviewable descriptor below the ignored development
.terraform directory. Execute is the only normal mutation action. It exercises one disposable
identity. Optional -RestrictedAnswerFixture selects the fixed empty-vault-only synthetic fixture,
binds a schema-2 plan with 16 steps, and requires exact restricted export coverage. Use the same
selection for Plan, Execute and Verify. The old lifecycle remains unchanged when omitted.
Optional -ResumeFixture selects one generated PDF, requires enabled exact malware processing,
binds a schema-3 plan (17 steps, or 18 with the vault fixture), and proves both document prefixes
have no versions or delete markers after the completed deletion marker. It accepts no input file.
The fixed lifecycle exercises that disposable
identity through export, exact-version download, grant expiry, artifact cleanup, request/cancel,
recent-MFA confirmation, Auth0 reconciliation, recovery-ledger completion, alert checks, and exact
cleanup. RecoverUnconfirmed accepts only the exact UTC timestamp of a privacy-safe failed
confirmation log, discovers its request identifier without printing it, and can only cancel that
still-requested record. RecoverCleanup cannot create or confirm a deletion; it can only prove
already-confirmed cleanup. The D3 policy requires the exact eight-owner inventory including
Applications and nonempty Applications export coverage. Verify can optionally inspect a separately
reviewed recovery-replay receipt; it never claims unperformed restore checks. No action accepts a token, subject,
secret, payload, route, SQL, command, role, bucket, Lambda, or network destination from the command
line.
"@
  exit 0
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformRoot "development-candidate-rights-acceptance"
$terraformInspectionDataDirectory = Join-Path $terraformRoot "development-candidate-rights-acceptance-data"
$stateKey = "platform.tfstate"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
$requiredOwners = "identity,profile,documents,jobs,matching,billing,trust"
# D4 is D3 plus Notifications (ADR-056), so every Applications gate applies to both.
$applicationsPolicies = @('d3-development-synthetic-v1', 'd4-development-synthetic-v1')
$notificationsPolicy = 'd4-development-synthetic-v1'
if ($ExpectedPolicyVersion -cin $applicationsPolicies) { $requiredOwners += ',applications' }
if ($ExpectedPolicyVersion -ceq $notificationsPolicy) { $requiredOwners += ',notifications' }
$tokenEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN"
$idTokenEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN"
$refreshTokenEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN"
$clientSecretEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET"
$attestationEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH"
$attestationJsonEnvironmentName = "CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_JSON"
$exportDownloadTimeoutMilliseconds = 20000
$exportHelperTimeoutMilliseconds = 30000
$maximumExportBytes = 1048576
$maximumExportHelperOutputBytes = 8192
$script:TestOnly = $env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY -ceq "1"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function Get-CandidateDeletionSubjectDigest {
  param(
    [Parameter(Mandatory)][string]$Issuer,
    [Parameter(Mandatory)][string]$Subject
  )
  return Get-TextSha256 "ai-job-apply/account-deletion-subject/v1`0$Issuer`0$Subject"
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertFrom-Base64Url {
  param([Parameter(Mandatory)][string]$Value)
  $normalized = $Value.Replace("-", "+").Replace("_", "/")
  switch ($normalized.Length % 4) { 2 { $normalized += "==" } 3 { $normalized += "=" } 1 { throw "The access token is malformed." } }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($normalized))
}

function ConvertFrom-OperatorJson {
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Description)
  try {
    $command = Get-Command ConvertFrom-Json -CommandType Cmdlet
    if ($command.Parameters.ContainsKey("DateKind")) { return $Json | ConvertFrom-Json -DateKind String }
    return $Json | ConvertFrom-Json
  } catch { throw "$Description is invalid JSON." }
}

function Assert-ExactPropertySet {
  param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string[]]$Names, [Parameter(Mandatory)][string]$Description)
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Names | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) { throw "$Description does not have the exact property set." }
  return $true
}

function Resolve-BelowOperatorRoot {
  param([Parameter(Mandatory)][string]$Path, [switch]$MustExist)
  $root = [IO.Path]::GetFullPath($operatorRoot).TrimEnd('\', '/')
  $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $root $Path)) }
  if (-not $resolved.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw "Acceptance evidence must remain below the ignored operator directory." }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "The reviewed acceptance evidence file does not exist." }
  return $resolved
}

function Write-ExclusiveJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value)
  if (Test-Path -LiteralPath $Path) { throw "Refusing to replace acceptance evidence." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 30) + "`n"), $utf8WithoutBom)
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed. Refresh the approved development IAM Identity Center session." }
  return ConvertFrom-OperatorJson -Json ($raw -join "`n") -Description "$Operation response"
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Read-StateSnapshot {
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") "State versioning"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") "State public access"
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") "State encryption"
  $block = $public.PublicAccessBlockConfiguration
  $kmsRules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.BucketKeyEnabled -eq $true -and [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms"
    })
  if ([string]$versioning.Status -cne "Enabled" -or $kmsRules.Count -ne 1 -or
      $block.BlockPublicAcls -ne $true -or $block.IgnorePublicAcls -ne $true -or
      $block.BlockPublicPolicy -ne $true -or $block.RestrictPublicBuckets -ne $true) {
    throw "The Terraform state bucket is outside the exact private, versioned, customer-KMS boundary."
  }
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") "State identity"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]::IsNullOrWhiteSpace([string]$head.VersionId)) { throw "The state object is not an exact encrypted version." }
  $temporary = [IO.Path]::GetTempFileName()
  try {
    $get = Invoke-AwsJson @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) "Versioned state read"
    if ([string]$get.VersionId -cne [string]$head.VersionId) { throw "The state version changed while it was read." }
    $state = ConvertFrom-OperatorJson (Get-Content -LiteralPath $temporary -Raw) "Terraform state"
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  Assert-DeploymentTerraformStateVersion -Version ([string]$state.terraform_version)
  if ([long]$state.serial -lt 1 -or [string]$state.lineage -notmatch '^[0-9a-f-]{36}$') { throw "The Terraform state identity is invalid." }
  return [pscustomobject]@{ State = $state; VersionId = [string]$head.VersionId; Serial = [long]$state.serial; Lineage = [string]$state.lineage }
}

function Get-StateOutput {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Name)
  $property = $Snapshot.State.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) { throw "Terraform state is missing the required $Name output." }
  return $property.Value.value
}

function Get-StateResources {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type)
  return @($Snapshot.State.resources | Where-Object type -ceq $Type | ForEach-Object instances | ForEach-Object { $_.attributes })
}

function Assert-CallerAndSource {
  param([switch]$RequireSource)
  if ($Region -cne "us-east-2") { throw "Candidate-rights acceptance is restricted to us-east-2." }
  if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) { throw "The exact development account and state bucket are required." }
  $caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json") "AWS caller validation"
  if ([string]$caller.Account -cne $ExpectedAccountId -or -not ([string]$caller.Arn).Contains(":assumed-role/AWSReservedSSO_")) { throw "Use the approved temporary IAM Identity Center role in the exact development account." }
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($RequireSource -and ($branch -cne "main" -or $head -cne $origin -or $head -cne $SourceSha -or $dirty.Count -ne 0)) { throw "Acceptance requires clean main exactly matching origin/main and SourceSha." }
  return [pscustomobject]@{ Head = $head; CallerType = "iam-identity-center" }
}

function Read-ReviewedZeroDrift {
  if ([string]::IsNullOrWhiteSpace($ZeroDriftPlanPath) -or $ReviewedZeroDriftPlanSha256 -notmatch '^[a-f0-9]{64}$') { throw "An exact reviewed zero-drift Terraform plan and checksum are required." }
  $path = [IO.Path]::GetFullPath($ZeroDriftPlanPath)
  if (-not $path.StartsWith([IO.Path]::GetFullPath($terraformRoot), [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The zero-drift plan must be an existing ignored development Terraform artifact." }
  if ((Get-FileSha256 $path) -cne $ReviewedZeroDriftPlanSha256) { throw "The zero-drift plan checksum does not match the reviewed value." }
  $savedTerraformDataDirectory = [Environment]::GetEnvironmentVariable('TF_DATA_DIR', 'Process')
  try {
    $env:TF_DATA_DIR = $terraformInspectionDataDirectory
    $null = New-Item -ItemType Directory -Path $terraformInspectionDataDirectory -Force
    Assert-DeploymentTerraformCli
    & terraform "-chdir=$terraformDirectory" init -backend=false -input=false -lockfile=readonly 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Terraform provider schemas could not be initialized for zero-drift inspection." }
    $plan = Read-DeploymentTerraformPlan -Path $path -TerraformDirectory $terraformDirectory -AllowHistorical
  } finally {
    if ($null -eq $savedTerraformDataDirectory) { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue }
    else { $env:TF_DATA_DIR = $savedTerraformDataDirectory }
  }
  $changes = @($plan.resource_changes | Where-Object { (@($_.change.actions) -join ',') -cne 'no-op' })
  if ($changes.Count -ne 0) { throw "The reviewed Terraform plan is not zero drift." }
  return [pscustomobject]@{ Sha256 = $ReviewedZeroDriftPlanSha256; TerraformVersion = [string]$plan.terraform_version; MeaningfulChanges = 0 }
}

function Read-SyntheticIdentityContext {
  param(
    [Parameter(Mandatory)][string]$ExpectedIssuer,
    [Parameter(Mandatory)][string]$ExpectedIdTokenAudience,
    [Parameter(Mandatory)][int]$MaximumAgeSeconds
  )
  $token = [Environment]::GetEnvironmentVariable($tokenEnvironmentName)
  $idToken = [Environment]::GetEnvironmentVariable($idTokenEnvironmentName)
  $attestationPath = [Environment]::GetEnvironmentVariable($attestationEnvironmentName)
  $attestationJson = [Environment]::GetEnvironmentVariable($attestationJsonEnvironmentName)
  if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($idToken)) { throw "The fixed generated-synthetic token and identity-attestation environment variables are required." }
  $hasAttestationPath = $null -ne $attestationPath
  $hasAttestationJson = $null -ne $attestationJson
  if ($hasAttestationPath -eq $hasAttestationJson) { throw "Exactly one fixed identity-attestation input is required: PATH or JSON, never both." }
  if ($hasAttestationJson) {
    try {
      if ([string]::IsNullOrWhiteSpace($attestationJson) -or $attestationJson.Length -gt 8192 -or
          [Text.UTF8Encoding]::new($false, $true).GetByteCount($attestationJson) -gt 8192) { throw 'invalid-attestation-size' }
    } catch { throw "The process-only identity attestation must be nonempty valid UTF-8 JSON of at most 8192 bytes." }
  }
  $accessSegments = $token.Split('.')
  $idSegments = $idToken.Split('.')
  if ($accessSegments.Count -ne 3 -or $idSegments.Count -ne 3) { throw "The acceptance tokens are not compact JWTs." }
  $accessClaims = ConvertFrom-OperatorJson (ConvertFrom-Base64Url $accessSegments[1]) "Access-token claims"
  $idClaims = ConvertFrom-OperatorJson (ConvertFrom-Base64Url $idSegments[1]) "ID-token claims"
  $attestationText = if ($hasAttestationJson) { $attestationJson } else { Get-Content -LiteralPath $attestationPath -Raw }
  $attestation = ConvertFrom-OperatorJson $attestationText "Identity attestation"
  $null = Assert-ExactPropertySet $attestation @("schemaVersion", "classification", "issuer", "subjectSha256", "authorizedOwner", "createdAt", "expiresAt") "Identity attestation"
  $now = [DateTimeOffset]::UtcNow
  $created = [DateTimeOffset]::Parse([string]$attestation.createdAt)
  $expires = [DateTimeOffset]::Parse([string]$attestation.expiresAt)
  $subject = [string]$accessClaims.sub
  $scope = @(([string]$accessClaims.scope).Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
  if ($RestrictedAnswerFixture -and -not $scope.Contains('profile:read')) {
    throw 'The restricted fixture requires profile:read as well as profile:write.'
  }
  if ($ResumeFixture -and (-not $scope.Contains('documents:read') -or -not $scope.Contains('documents:write'))) {
    throw 'The generated resume fixture requires documents:read and documents:write.'
  }
  $idAudience = @($idClaims.aud | ForEach-Object { [string]$_ })
  $amr = @($idClaims.amr | ForEach-Object { [string]$_ })
  $authTime = [DateTimeOffset]::FromUnixTimeSeconds([long]$idClaims.auth_time)
  $accessExp = [DateTimeOffset]::FromUnixTimeSeconds([long]$accessClaims.exp)
  $idExp = [DateTimeOffset]::FromUnixTimeSeconds([long]$idClaims.exp)
  if ([int]$attestation.schemaVersion -ne 1 -or [string]$attestation.classification -cne "generated-synthetic-only" -or
      [string]$attestation.issuer -cne $ExpectedIssuer -or [string]$accessClaims.iss -cne $ExpectedIssuer -or [string]$idClaims.iss -cne $ExpectedIssuer -or
      [string]$idClaims.sub -cne $subject -or
      $ExpectedIdTokenAudience -notmatch '^[A-Za-z0-9_-]{16,256}$' -or $idAudience.Count -ne 1 -or $idAudience[0] -cne $ExpectedIdTokenAudience -or
      [string]$attestation.subjectSha256 -cne (Get-TextSha256 $subject) -or [string]$attestation.subjectSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]::IsNullOrWhiteSpace([string]$attestation.authorizedOwner) -or [string]$attestation.authorizedOwner -match '(?i)zach\s*becker' -or
      $created -gt $now -or $expires -le $now -or $accessExp -le $now.AddMinutes(2) -or $idExp -le $now.AddMinutes(2) -or $authTime -gt $now -or ($now - $authTime).TotalSeconds -gt $MaximumAgeSeconds -or
      -not $scope.Contains("profile:write") -or -not $amr.Contains("mfa")) {
    throw "The disposable identity is not an exact current generated-synthetic recent-MFA context under an authorized non-Zach owner."
  }
  $attestationSha256 = if ($hasAttestationJson) { Get-TextSha256 $attestationJson } else { Get-FileSha256 $attestationPath }
  return [pscustomobject]@{ Token = $token; IdToken = $idToken; Subject = $subject; SubjectSha256 = [string]$attestation.subjectSha256; AttestationSha256 = $attestationSha256; IdTokenAudienceSha256 = Get-TextSha256 $ExpectedIdTokenAudience; AuthTime = $authTime.ToString('o') }
}

function Assert-SyntheticRefreshPrerequisites {
  $refreshToken = [Environment]::GetEnvironmentVariable($refreshTokenEnvironmentName)
  $clientSecret = [Environment]::GetEnvironmentVariable($clientSecretEnvironmentName)
  if ([string]::IsNullOrWhiteSpace($refreshToken) -or
      [string]::IsNullOrWhiteSpace($clientSecret) -or $clientSecret.Length -lt 16) {
    throw "The fixed generated-synthetic refresh-token and client-authentication environment variables are required."
  }
  return $true
}

function Refresh-SyntheticIdentityContext {
  param(
    [Parameter(Mandatory)][string]$ExpectedIssuer,
    [Parameter(Mandatory)][string]$ExpectedIdTokenAudience,
    [Parameter(Mandatory)][int]$MaximumAgeSeconds
  )
  $null = Assert-SyntheticRefreshPrerequisites
  $refreshToken = [Environment]::GetEnvironmentVariable($refreshTokenEnvironmentName)
  $clientSecret = [Environment]::GetEnvironmentVariable($clientSecretEnvironmentName)
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  $content = $null
  try {
    $form = [Collections.Generic.Dictionary[string,string]]::new()
    $form['grant_type'] = 'refresh_token'
    $form['client_id'] = $ExpectedIdTokenAudience
    $form['client_secret'] = $clientSecret
    $form['refresh_token'] = $refreshToken
    $content = [Net.Http.FormUrlEncodedContent]::new($form)
    $response = $client.PostAsync("$($ExpectedIssuer.TrimEnd('/'))/oauth/token", $content).GetAwaiter().GetResult()
    try {
      if ([int]$response.StatusCode -ne 200) {
        throw "The generated-synthetic in-memory token refresh was rejected with status $([int]$response.StatusCode)."
      }
      $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
      if ($bytes.Length -lt 2 -or $bytes.Length -gt 65536) {
        throw "The generated-synthetic token refresh exceeded the bounded JSON envelope."
      }
      $refreshed = ConvertFrom-OperatorJson ([Text.Encoding]::UTF8.GetString($bytes)) "Refreshed token set"
    }
    finally { $response.Dispose() }
  }
  finally {
    if ($null -ne $content) { $content.Dispose() }
    $client.Dispose()
  }
  if ([string]$refreshed.token_type -cne 'Bearer' -or [int]$refreshed.expires_in -le 120 -or
      [string]::IsNullOrWhiteSpace([string]$refreshed.access_token)) {
    throw "The generated-synthetic refresh response is incomplete."
  }
  [Environment]::SetEnvironmentVariable($tokenEnvironmentName, [string]$refreshed.access_token, 'Process')
  $rotated = [string](Get-OptionalProperty $refreshed 'refresh_token')
  if (-not [string]::IsNullOrWhiteSpace($rotated)) {
    [Environment]::SetEnvironmentVariable($refreshTokenEnvironmentName, $rotated, 'Process')
  }
  return Read-SyntheticIdentityContext $ExpectedIssuer $ExpectedIdTokenAudience $MaximumAgeSeconds
}

function Get-LambdaIdentity {
  param([Parameter(Mandatory)][string]$AliasArn, [Parameter(Mandatory)][string]$Description)
  if ($AliasArn -notmatch '^(?<function>arn:aws:lambda:[^:]+:[0-9]{12}:function:[^:]+):(?<alias>[^:]+)$') { throw "$Description alias ARN is invalid." }
  $functionArn = [string]$Matches.function
  $aliasName = [string]$Matches.alias
  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", $functionArn, "--name", $aliasName, "--output", "json") "$Description alias"
  $weights = Get-OptionalProperty (Get-OptionalProperty $alias "RoutingConfig") "AdditionalVersionWeights"
  if ([string]$alias.FunctionVersion -notmatch '^[1-9][0-9]*$' -or ($null -ne $weights -and @($weights.PSObject.Properties).Count -ne 0)) { throw "$Description must be one unweighted numeric version." }
  $configuration = Invoke-AwsJson @("lambda", "get-function-configuration", "--function-name", $functionArn, "--qualifier", [string]$alias.FunctionVersion, "--output", "json") "$Description version"
  if ([string]$configuration.CodeSha256 -notmatch '^[A-Za-z0-9+/]{43}=$' -or [string]$configuration.Version -cne [string]$alias.FunctionVersion) { throw "$Description immutable artifact identity is invalid." }
  return [pscustomobject]@{ AliasArnSha256 = Get-TextSha256 $AliasArn; Version = [int]$alias.FunctionVersion; CodeSha256 = [string]$configuration.CodeSha256; Environment = $configuration.Environment.Variables }
}

function Assert-PolicyEnvironment {
  param([Parameter(Mandatory)][object]$Environment)
  $expected = [ordered]@{
    CANDIDATE_RIGHTS_POLICY_VERSION = $ExpectedPolicyVersion
    CANDIDATE_RIGHTS_POLICY_SHA256 = $ReviewedPolicySha256
    CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS = [string]$ExpectedExportLifetimeSeconds
    CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS = [string]$ExpectedDownloadGrantSeconds
    CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS = [string]$ExpectedBackupRetentionDays
    CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS = [string]$ExpectedRecentAuthMaxAgeSeconds
    CANDIDATE_RIGHTS_OWNER_INVENTORY = $ExpectedOwnerInventory
    CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY = $ExpectedSubprocessorInventory
  }
  if ($ExpectedOwnerInventory -cne $requiredOwners -or [string]::IsNullOrWhiteSpace($ExpectedSubprocessorInventory)) { throw "The exact owner and nonempty subprocessor inventories are required." }
  foreach ($entry in $expected.GetEnumerator()) {
    if ([string](Get-OptionalProperty $Environment $entry.Key) -cne [string]$entry.Value) { throw "The live candidate-rights policy environment does not match the reviewed $($entry.Key) value." }
  }
  return $true
}

function Assert-Auth0SecretBoundary {
  param([Parameter(Mandatory)][string]$SecretArn)
  $description = Invoke-AwsJson @("secretsmanager", "describe-secret", "--secret-id", $SecretArn, "--output", "json") "Candidate-rights Auth0 secret metadata"
  $tags = @{}; foreach ($tag in @($description.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  if ($tags['ai-job-apply:generated-synthetic-only'] -cne 'true' -or [string]::IsNullOrWhiteSpace($tags['ai-job-apply:authorized-owner']) -or $tags['ai-job-apply:authorized-owner'] -match '(?i)zach\s*becker') { throw "The Auth0 M2M secret lacks the exact generated-synthetic, authorized non-Zach ownership tags." }
  $value = Invoke-AwsJson @("secretsmanager", "get-secret-value", "--secret-id", $SecretArn, "--output", "json") "Candidate-rights Auth0 secret validation"
  $secret = ConvertFrom-OperatorJson ([string]$value.SecretString) "Candidate-rights Auth0 secret"
  $null = Assert-ExactPropertySet $secret @("clientId", "clientSecret", "revocationMode") "Candidate-rights Auth0 secret"
  if ([string]::IsNullOrWhiteSpace([string]$secret.clientId) -or ([string]$secret.clientSecret).Length -lt 16 -or [string]$secret.revocationMode -cne 'delete_user_only') { throw "Development candidate-rights acceptance requires the reviewed generated-synthetic Auth0 user-deletion mode." }
  return [pscustomobject]@{ ClientIdSha256 = Get-TextSha256 ([string]$secret.clientId); RevocationMode = [string]$secret.revocationMode; AuthorizedOwnerSha256 = Get-TextSha256 $tags['ai-job-apply:authorized-owner'] }
}

function Get-BackupInventory {
  param([Parameter(Mandatory)][object]$Snapshot)
  $databases = @(Get-StateResources $Snapshot 'aws_db_instance')
  if ($databases.Count -ne 1) { throw "Acceptance requires exactly one state-managed development RDS instance." }
  $identifier = [string]$databases[0].identifier
  $response = Invoke-AwsJson @("rds", "describe-db-instances", "--db-instance-identifier", $identifier, "--output", "json") "RDS backup policy"
  $instance = @($response.DBInstances)
  if ($instance.Count -ne 1 -or [string]$instance[0].DBInstanceStatus -cne 'available' -or [int]$instance[0].BackupRetentionPeriod -lt $ExpectedBackupRetentionDays -or -not $instance[0].LatestRestorableTime) { throw "The development database backup inventory or aging boundary is incomplete." }
  $snapshots = Invoke-AwsJson @("rds", "describe-db-snapshots", "--db-instance-identifier", $identifier, "--output", "json") "RDS snapshot inventory"
  $inventory = @($snapshots.DBSnapshots | ForEach-Object { "$($_.SnapshotType)|$($_.Status)|$($_.SnapshotCreateTime)|$($_.Encrypted)" } | Sort-Object)
  return [pscustomobject]@{ BackupRetentionDays = [int]$instance[0].BackupRetentionPeriod; SnapshotCount = $inventory.Count; InventorySha256 = Get-TextSha256 ($inventory -join "`n"); LatestRestorableTime = ([DateTimeOffset]$instance[0].LatestRestorableTime).ToUniversalTime().ToString('o') }
}

function Assert-OperationalHealth {
  param([Parameter(Mandatory)][object]$Snapshot)
  $cluster = [string](Get-StateOutput $Snapshot 'ecs_cluster_arn')
  $tasks = Invoke-AwsJson @("ecs", "list-tasks", "--cluster", $cluster, "--output", "json") "ECS idle boundary"
  if (@($tasks.taskArns).Count -ne 0) { throw "Candidate-rights acceptance requires zero active ECS tasks." }
  $queueUrls = @()
  foreach ($queue in @(Get-StateResources $Snapshot 'aws_sqs_queue')) {
    if ([string]$queue.url) { $queueUrls += [string]$queue.url }
  }
  foreach ($url in $queueUrls) {
    $attributes = Invoke-AwsJson @("sqs", "get-queue-attributes", "--queue-url", $url, "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed", "--output", "json") "Queue health"
    foreach ($name in @('ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed')) { if ([int]$attributes.Attributes.$name -ne 0) { throw "A state-managed queue is not empty." } }
  }
  $alarms = Invoke-AwsJson @("cloudwatch", "describe-alarms", "--alarm-name-prefix", "ai-job-apply-development-", "--output", "json") "Development alarms"
  $metricAlarms = @($alarms.MetricAlarms)
  if ($metricAlarms.Count -lt 1 -or @($alarms.CompositeAlarms).Count -ne 0 -or @($metricAlarms | Where-Object { $_.StateValue -cne 'OK' -or $_.ActionsEnabled -ne $true }).Count -ne 0) { throw "Every development alarm must be enabled and OK." }
  return [pscustomobject]@{ ActiveCompute = 0; QueueCount = $queueUrls.Count; QueuedMessages = 0; AlarmCount = $metricAlarms.Count; AlarmsOk = $true }
}

function Get-RuntimeBoundary {
  param([Parameter(Mandatory)][object]$Snapshot)
  $gatewayUrl = [string](Get-StateOutput $Snapshot 'gateway_url')
  $issuerResources = @(Get-StateResources $Snapshot 'aws_apigatewayv2_authorizer')
  $issuer = @($issuerResources | ForEach-Object { $_.jwt_configuration[0].issuer } | Where-Object { $_ }) | Select-Object -Unique
  if ($gatewayUrl -notmatch '^https://[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com$' -or @($issuer).Count -ne 1) { throw "The exact regional gateway and issuer boundary is unavailable." }
  $issuerValue = [string]($issuer | Select-Object -First 1)
  $aliases = [ordered]@{}
  foreach ($binding in @(
      @('gateway', 'gateway_lambda_alias_arn'),
      @('outboxStarter', 'outbox_starter_alias_arn'),
      @('durable', 'profile_readiness_durable_alias_arn'),
      @('activity', 'profile_readiness_activity_alias_arn'),
      @('terminal', 'profile_readiness_terminal_alias_arn')
    )) {
    $aliases[$binding[0]] = Get-LambdaIdentity ([string](Get-StateOutput $Snapshot $binding[1])) $binding[0]
  }
  $null = Assert-PolicyEnvironment $aliases.activity.Environment
  $idTokenAudience = [string](Get-OptionalProperty $aliases.gateway.Environment 'OIDC_ID_TOKEN_AUDIENCE')
  return [pscustomobject]@{
    GatewayUrl = $gatewayUrl.TrimEnd('/'); Issuer = $issuerValue; Aliases = [pscustomobject]$aliases
    IdTokenAudience = $idTokenAudience
    ExportBucket = [string](Get-StateOutput $Snapshot 'candidate_data_export_bucket')
    RecoveryBucket = [string](Get-StateOutput $Snapshot 'candidate_deletion_recovery_bucket')
    Auth0SecretArn = [string](Get-StateOutput $Snapshot 'candidate_rights_auth0_secret_arn')
  }
}

function Assert-ApplicationsRightsRuntime {
  param([Parameter(Mandatory)][object]$Runtime)
  if ($ExpectedPolicyVersion -cnotin $applicationsPolicies) { return }
  if ([string](Get-OptionalProperty $Runtime.Aliases.activity.Environment 'RESTRICTED_PACKET_EXPORT_ENABLED') -cne 'true') {
    throw 'D3 rights acceptance requires the private protected-packet export reader.'
  }
  foreach ($name in @('RESTRICTED_PACKET_ENCRYPTION_KEY_ARN','RESTRICTED_PACKET_FINGERPRINT_KEY_ARN')) {
    $gateway = [string](Get-OptionalProperty $Runtime.Aliases.gateway.Environment $name)
    $activity = [string](Get-OptionalProperty $Runtime.Aliases.activity.Environment $name)
    if ($gateway -cnotmatch "^arn:aws:kms:us-east-2:${ExpectedAccountId}:key/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" -or $activity -cne $gateway) {
      throw 'D3 rights acceptance requires the exact protected-packet key bindings.'
    }
  }
}

function Get-AcceptanceBoundary {
  param([switch]$RequireIdentity)
  $source = Assert-CallerAndSource -RequireSource:$RequireIdentity
  $snapshot = Read-StateSnapshot
  $runtime = Get-RuntimeBoundary $snapshot
  Assert-ApplicationsRightsRuntime $runtime
  if ($RestrictedAnswerFixture) {
    Assert-RestrictedFixtureRuntime $runtime
  }
  if ($RequireIdentity -and $runtime.IdTokenAudience -notmatch '^[A-Za-z0-9_-]{16,256}$') { throw "The gateway does not expose the exact candidate web ID-token audience." }
  # Validate the short-lived caller proof as soon as the state-bound issuer and audience are known.
  # Backup, queue, alarm, and drift inspection can be comparatively slow and must not consume the
  # token's usable acceptance window before its first exact validation.
  $identity = if ($RequireIdentity) { Read-SyntheticIdentityContext $runtime.Issuer $runtime.IdTokenAudience $ExpectedRecentAuthMaxAgeSeconds } else { $null }
  $resume = if ($ResumeFixture) { Get-RightsResumeRuntime $snapshot $runtime } else { $null }
  $secret = Assert-Auth0SecretBoundary $runtime.Auth0SecretArn
  $backup = Get-BackupInventory $snapshot
  $health = Assert-OperationalHealth $snapshot
  $drift = if ($RequireIdentity) { Read-ReviewedZeroDrift } else { $null }
  return [pscustomobject]@{ Source = $source; Snapshot = $snapshot; Runtime = $runtime; Secret = $secret; Backup = $backup; Health = $health; Drift = $drift; Identity = $identity; Resume = $resume }
}

function Get-FixedAcceptanceSequence {
  $sequence = @('export-request', 'export-idempotent-replay', 'export-ready', 'exact-version-download', 'download-grant-expired', 'deletion-request', 'deletion-cancel', 'fresh-recent-mfa-recheck', 'deletion-request', 'recent-mfa-confirm', 'owner-auth0-export-cleanup-reconciliation', 'recovery-ledger-completed', 'alerts-and-queues', 'zero-compute', 'zero-drift')
  if ($RestrictedAnswerFixture) { $sequence = @('restricted-answer-fixture') + $sequence }
  if ($ResumeFixture) {
    $sequence = @('parsed-resume-fixture') + $sequence
    $index = [Array]::IndexOf($sequence, 'recovery-ledger-completed') + 1
    $sequence = @($sequence[0..($index - 1)]) + @('resume-prefix-absence') + @($sequence[$index..($sequence.Count - 1)])
  }
  return $sequence
}

function New-ExecutionPlan {
  param([Parameter(Mandatory)][object]$Boundary)
  $now = [DateTimeOffset]::UtcNow
  $aliasIdentity = [ordered]@{}
  foreach ($name in @('gateway', 'outboxStarter', 'durable', 'activity', 'terminal')) {
    $value = $Boundary.Runtime.Aliases.$name
    $aliasIdentity[$name] = [ordered]@{ aliasArnSha256 = $value.AliasArnSha256; version = $value.Version; codeSha256 = $value.CodeSha256 }
  }
  $plan = [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-plan'; environment = 'development'; region = $Region
    sourceSha = $SourceSha; createdAt = $now.ToString('o'); expiresAt = $now.AddMinutes(15).ToString('o')
    state = [ordered]@{ lineage = $Boundary.Snapshot.Lineage; serial = $Boundary.Snapshot.Serial; versionIdSha256 = Get-TextSha256 $Boundary.Snapshot.VersionId }
    policy = [ordered]@{ version = $ExpectedPolicyVersion; sha256 = $ReviewedPolicySha256; exportLifetimeSeconds = $ExpectedExportLifetimeSeconds; downloadGrantSeconds = $ExpectedDownloadGrantSeconds; backupRetentionDays = $ExpectedBackupRetentionDays; recentAuthMaxAgeSeconds = $ExpectedRecentAuthMaxAgeSeconds; owners = $ExpectedOwnerInventory; subprocessors = $ExpectedSubprocessorInventory }
    identity = [ordered]@{ classification = 'generated-synthetic-only'; subjectSha256 = $Boundary.Identity.SubjectSha256; attestationSha256 = $Boundary.Identity.AttestationSha256; idTokenAudienceSha256 = $Boundary.Identity.IdTokenAudienceSha256; recentMfa = $true }
    auth0 = [ordered]@{ clientIdSha256 = $Boundary.Secret.ClientIdSha256; authorizedOwnerSha256 = $Boundary.Secret.AuthorizedOwnerSha256; revocationMode = $Boundary.Secret.RevocationMode }
    backups = $Boundary.Backup
    aliases = $aliasIdentity
    health = $Boundary.Health
    zeroDriftPlanSha256 = $Boundary.Drift.Sha256
    fixedSequence = @(Get-FixedAcceptanceSequence)
  }
  if ($RestrictedAnswerFixture) {
    $plan.schemaVersion = 2
    $plan.restrictedAnswerFixture = 'restricted-answers-v1'
  }
  if ($ResumeFixture) {
    $plan.schemaVersion = 3
    $plan.resumeFixture = 'parsed-resume-v1'
    $plan.resumeRuntime = $Boundary.Resume.Identity
  }
  return $plan
}

function Read-ExecutionPlan {
  $path = Resolve-BelowOperatorRoot $ExecutionPlanPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedExecutionPlanSha256) { throw "The execution-plan checksum does not match the reviewed value." }
  $plan = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Execution plan"
  $names = @('schemaVersion','kind','environment','region','sourceSha','createdAt','expiresAt','state','policy','identity','auth0','backups','aliases','health','zeroDriftPlanSha256','fixedSequence')
  $schemaVersion = 1
  $sequenceCount = 15
  if ($RestrictedAnswerFixture) { $names += 'restrictedAnswerFixture'; $schemaVersion = 2; $sequenceCount = 16 }
  if ($ResumeFixture) { $names += @('resumeFixture','resumeRuntime'); $schemaVersion = 3; $sequenceCount += 2 }
  $null = Assert-ExactPropertySet $plan $names "Execution plan"
  if (($RestrictedAnswerFixture -or $ResumeFixture) -and (@($plan.fixedSequence) -join ',') -cne (@(Get-FixedAcceptanceSequence) -join ',')) {
    throw 'The reviewed fixture sequence changed.'
  }
  if (($RestrictedAnswerFixture -and [string]$plan.restrictedAnswerFixture -cne 'restricted-answers-v1') -or
      ($ResumeFixture -and [string]$plan.resumeFixture -cne 'parsed-resume-v1') -or
      [int]$plan.schemaVersion -ne $schemaVersion -or [string]$plan.kind -cne 'development-candidate-rights-acceptance-plan' -or [string]$plan.sourceSha -cne $SourceSha -or [DateTimeOffset]::Parse([string]$plan.expiresAt) -le [DateTimeOffset]::UtcNow -or
      [string]$plan.policy.sha256 -cne $ReviewedPolicySha256 -or [string]$plan.identity.classification -cne 'generated-synthetic-only' -or [string]$plan.auth0.revocationMode -cne 'delete_user_only' -or @($plan.fixedSequence).Count -ne $sequenceCount) { throw "The reviewed execution plan is invalid or expired." }
  return [pscustomobject]@{ Path = $path; Value = $plan }
}

function Invoke-CandidateApi {
  param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Token, [AllowNull()][object]$Body, [hashtable]$Headers = @{}, [int[]]$ExpectedStatus = @(200))
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  try {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), "$($script:Runtime.GatewayUrl)/v1$Path")
    $request.Headers.TryAddWithoutValidation('authorization', "Bearer $Token") | Out-Null
    foreach ($entry in $Headers.GetEnumerator()) { $request.Headers.TryAddWithoutValidation([string]$entry.Key, [string]$entry.Value) | Out-Null }
    if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json') }
    $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    if (-not $ExpectedStatus.Contains($status)) {
      $response.Dispose()
      $safePath = $Path -replace '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', ':id'
      throw "The candidate API $Method $safePath returned unexpected status $status during the fixed acceptance sequence."
    }
    $cacheControl = @($response.Headers.GetValues('cache-control')) -join ','
    if ($status -ne 204 -and $cacheControl -cne 'no-store') { $response.Dispose(); throw "A candidate-rights response omitted cache-control no-store." }
    $json = $null
    if ($status -ne 204) {
      $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
      if ($bytes.Length -lt 2 -or $bytes.Length -gt 65536) { $response.Dispose(); throw "A candidate-rights response exceeded the bounded JSON envelope." }
      $json = ConvertFrom-OperatorJson ([Text.Encoding]::UTF8.GetString($bytes)) "Candidate-rights response"
    }
    $response.Dispose()
    return [pscustomobject]@{ Status = $status; Body = $json }
  } finally { $client.Dispose() }
}

function Get-UnconfirmedRequestFromLogEvents {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Events)
  $decoded = @(
    foreach ($logEvent in $Events) {
      try { $message = ConvertFrom-OperatorJson ([string]$logEvent.message) "Candidate-rights application log" }
      catch { continue }
      [pscustomobject]@{ Timestamp = [long]$logEvent.timestamp; Message = $message }
    }
  )
  $failures = @($decoded | Where-Object {
      [string](Get-OptionalProperty $_.Message 'event') -ceq 'unhandled_request_failure' -and
      [string](Get-OptionalProperty $_.Message 'route') -ceq '/v1/me/account-deletion-requests/:deletionRequestId/confirm' -and
      [string](Get-OptionalProperty $_.Message 'error_type') -ceq 'AccessDeniedException' -and
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $_.Message 'reqId'))
    })
  if ($failures.Count -ne 1) {
    throw "Recovery requires exactly one matching privacy-safe failed confirmation event."
  }
  $failureRequestId = [string](Get-OptionalProperty $failures[0].Message 'reqId')
  $requestLogs = @($decoded | Where-Object {
      $request = Get-OptionalProperty $_.Message 'req'
      [string](Get-OptionalProperty $_.Message 'reqId') -ceq $failureRequestId -and
      [string](Get-OptionalProperty $_.Message 'msg') -ceq 'incoming request' -and
      [string](Get-OptionalProperty $request 'method') -ceq 'POST'
    })
  if ($requestLogs.Count -ne 1) {
    throw "Recovery could not resolve one exact failed confirmation request."
  }
  $requestEnvelope = Get-OptionalProperty $requestLogs[0].Message 'req'
  $match = [regex]::Match(
    [string](Get-OptionalProperty $requestEnvelope 'url'),
    '^/v1/me/account-deletion-requests/(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/confirm$'
  )
  if (-not $match.Success) {
    throw "Recovery rejected an unexpected failed confirmation route."
  }
  return [pscustomobject]@{
    RequestId = [string]$match.Groups['id'].Value
    FailureTimestamp = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$failures[0].Timestamp)
  }
}

function Read-UnconfirmedFailureRequest {
  if ([string]::IsNullOrWhiteSpace($RecoveryFailureTimestamp)) {
    throw "RecoverUnconfirmed requires the exact failed-confirmation UTC timestamp."
  }
  try {
    $failureAt = [DateTimeOffset]::Parse(
      $RecoveryFailureTimestamp,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
  }
  catch { throw "The failed-confirmation timestamp is invalid." }
  $now = [DateTimeOffset]::UtcNow
  if ($failureAt.Offset -ne [TimeSpan]::Zero -or $failureAt -gt $now -or $failureAt -lt $now.AddDays(-7)) {
    throw "The failed-confirmation timestamp must be recent and explicitly UTC."
  }
  $events = Invoke-AwsJson @(
    'logs','filter-log-events','--log-group-name','/ai-job-apply/development/application',
    '--start-time',[string]$failureAt.AddSeconds(-2).ToUnixTimeMilliseconds(),
    '--end-time',[string]$failureAt.AddSeconds(2).ToUnixTimeMilliseconds(),'--output','json'
  ) 'Failed confirmation recovery lookup'
  $resolved = Get-UnconfirmedRequestFromLogEvents @($events.events)
  if ([Math]::Abs(($resolved.FailureTimestamp - $failureAt).TotalSeconds) -gt 1) {
    throw "The failed confirmation did not match the exact reviewed timestamp."
  }
  return $resolved
}

function Invoke-RecoverUnconfirmedRequest {
  param([Parameter(Mandatory)][object]$Boundary)
  $script:Runtime = $Boundary.Runtime
  $failed = Read-UnconfirmedFailureRequest
  $current = Invoke-CandidateApi GET "/me/account-deletion-requests/$($failed.RequestId)" $Boundary.Identity.Token $null
  if ([string]$current.Body.state -cne 'requested' -or
      [string]$current.Body.policyVersion -cne $ExpectedPolicyVersion -or
      [int]$current.Body.version -lt 1) {
    throw "Recovery can only cancel an unconfirmed request under the reviewed policy."
  }
  $null = Invoke-CandidateApi DELETE "/me/account-deletion-requests/$($failed.RequestId)" `
    $Boundary.Identity.Token $null @{
      'idempotency-key' = "rights-recover-cancel-$([guid]::NewGuid().ToString('N'))"
      'if-match' = "`"$($current.Body.version)`""
      'x-ai-job-apply-reauthentication' = $Boundary.Identity.IdToken
    } @(204)
  $absent = Invoke-CandidateApi GET "/me/account-deletion-requests/$($failed.RequestId)" `
    $Boundary.Identity.Token $null @{} @(404)
  if ([int]$absent.Status -ne 404) { throw "The unconfirmed deletion request remained after recovery." }
  return [pscustomobject]@{
    Outcome = 'unconfirmed-request-cancelled'; RequestsDiscovered = 1; RequestsCancelled = 1
    ConfirmedDeletions = 0; PersistentSyntheticIdentitiesChanged = 0; CloudMutation = $true
  }
}

function Wait-ExportReady {
  param([Parameter(Mandatory)][string]$ExportId, [Parameter(Mandatory)][string]$Token)
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
  do {
    $value = (Invoke-CandidateApi GET "/me/data-exports/$ExportId" $Token $null).Body
    if ([string]$value.export.state -ceq 'ready') { return $value }
    if ([string]$value.export.state -in @('failed','expired')) { throw "The generated-synthetic export did not become ready." }
    Start-Sleep -Seconds 2
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The generated-synthetic export did not become ready within the bounded wait."
}

function Wait-CandidateRightsTask {
  param(
    [Parameter(Mandatory)][Threading.Tasks.Task]$Task,
    [Parameter(Mandatory)][Threading.CancellationToken]$CancellationToken
  )
  $Task.Wait($CancellationToken)
  return $Task.GetAwaiter().GetResult()
}

function Read-CandidateRightsExportHelperResult {
  param([Parameter(Mandatory)][string]$Json, [switch]$CheckReady, [switch]$RestrictedAnswers)
  $result = ConvertFrom-OperatorJson $Json 'Candidate export verification'
  if ($CheckReady) {
    $null = Assert-ExactPropertySet $result @('ready') 'Candidate export verifier readiness'
    if ($result.ready -isnot [bool] -or $result.ready -ne $true) { throw 'Candidate export verifier is not ready.' }
  }
  else {
    $countNames = if ($RestrictedAnswers) { @('activeValueCount','expiredValueCount','deletedTombstoneCount','revisedValueCount') } else { @('consentCount','contributionApprovalCount','contributionCount','privateCaptureCount','trustCaseCount','trustCaseEventCount') }
    if (-not $RestrictedAnswers -and $ExpectedPolicyVersion -cin $applicationsPolicies) {
      $countNames += @('applicationCount','packetCount','approvalCount','attemptCount','historyCount')
    }
    if (-not $RestrictedAnswers -and $ExpectedPolicyVersion -ceq $notificationsPolicy) {
      $countNames += @('notificationsPreferencesCount','notificationsEmailDestinationCount','notificationsPushSubscriptionCount','notificationsInboxCount','notificationsDeliveryCount')
    }
    $null = Assert-ExactPropertySet $result (@('valid') + $countNames) 'Candidate export verification'
    if ($result.valid -isnot [bool] -or $result.valid -ne $true) { throw 'Candidate export verification failed.' }
    foreach ($name in $countNames) {
      $count = $result.$name
      if (($count -isnot [int] -and $count -isnot [long]) -or $count -lt 0 -or $count -gt $maximumExportBytes) { throw 'Candidate export coverage count is invalid.' }
    }
    if ($RestrictedAnswers) {
      foreach ($name in $countNames) { if ($result.$name -ne 1) { throw 'Restricted fixture export coverage is incomplete.' } }
    } elseif ($result.contributionApprovalCount -ne $result.contributionCount) { throw 'Candidate export approval coverage is invalid.' }
  }
  return $result
}

# Generated-only Notifications records through the real candidate API: preferences (compare-and-set
# on the current version) and one browser push subscription on an allow-listed push host. Email is
# not seeded here, because confirmation sends mail; the PostgreSQL tests cover that table.
function New-NotificationsFixture {
  param([Parameter(Mandatory)][string]$Token)
  $current = Invoke-CandidateApi GET '/notifications/preferences' $Token $null @{} @(200)
  $version = [int]$current.Body.version
  $preferences = [ordered]@{
    expectedVersion = $version
    emailEnabled = $false
    pushEnabled = $false
    quietHours = [ordered]@{ enabled = $false; startMinute = 1320; endMinute = 420; timeZone = 'UTC' }
  }
  $null = Invoke-CandidateApi PUT '/notifications/preferences' $Token $preferences @{} @(200)
  $endpoint = "https://fcm.googleapis.com/fcm/send/generated-rights-acceptance-$([guid]::NewGuid().ToString('N'))"
  $null = Invoke-CandidateApi POST '/notifications/delivery/push-subscriptions' $Token ([ordered]@{ endpoint = $endpoint }) @{} @(201)
}

function Assert-CandidateRightsAcceptanceCoverage {
  param([Parameter(Mandatory)][object]$Coverage)
  if ($ExpectedPolicyVersion -ceq $notificationsPolicy) {
    # The fixed fixture creates these two records through the real API before the export is requested.
    $missingNotifications = @(
      foreach ($name in @('notificationsPreferencesCount','notificationsPushSubscriptionCount')) {
        if ($Coverage.$name -lt 1) { $name }
      }
    )
    if ($missingNotifications.Count) {
      throw "D4 acceptance stopped before account deletion: the Notifications export section lacks $($missingNotifications -join ', ')."
    }
  }
  if ($ExpectedPolicyVersion -cin $applicationsPolicies) {
    $missing = @(
      foreach ($name in @('applicationCount','packetCount','approvalCount','attemptCount','historyCount')) {
        if ($Coverage.$name -lt 1) { $name }
      }
    )
    if ($missing.Count) {
      throw "D3 acceptance stopped before account deletion: nonempty Applications export coverage is required for $($missing -join ', '). Prepare the authorized disposable account's missing D3 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry and cleanup."
    }
    return $true
  }
  if ($ExpectedPolicyVersion -cne 'd2-development-synthetic-v1') { return $true }
  # The download verifier already checks the exact aggregate shape and integer bounds. This
  # acceptance-only gate does not change the export contract: empty exports remain valid data.
  $missing = @(
    foreach ($name in @('consentCount','contributionApprovalCount','contributionCount','privateCaptureCount','trustCaseCount','trustCaseEventCount')) {
      if ($Coverage.$name -lt 1) { $name }
    }
  )
  if ($missing.Count -gt 0) {
    throw "D2 acceptance stopped before account deletion: nonempty export coverage is required for $($missing -join ', '). Prepare the authorized disposable account's missing D2 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry."
  }
  return $true
}

function Invoke-CandidateRightsExportHelper {
  param(
    [switch]$CheckReady,
    [string]$ExpectedExportId = '',
    [string]$ExpectedPolicyVersion = '',
    [AllowNull()][byte[]]$Artifact = $null,
    [AllowNull()][object[]]$ExpectedRestrictedAnswers = $null
  )
  $process = $null
  $output = $null
  $inputWriter = $null
  $deadline = $null
  $processStarted = $false
  try {
    $helperPath = Join-Path $repositoryRoot 'scripts/lib/candidate-rights-export.mjs'
    if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) { throw 'helper-unavailable' }
    $node = @(Get-Command node -CommandType Application -ErrorAction Stop)[0]
    $inputJson = ''
    if (-not $CheckReady) {
      if ($null -eq $Artifact -or $Artifact.Length -lt 1 -or $Artifact.Length -gt $maximumExportBytes) { throw 'artifact-bound' }
      $envelope = [ordered]@{
        schemaVersion = 1
        expectedExportId = $ExpectedExportId
        expectedPolicyVersion = $ExpectedPolicyVersion
        artifactBase64 = [Convert]::ToBase64String($Artifact)
      }
      if ($null -ne $ExpectedRestrictedAnswers) {
        if ($ExpectedRestrictedAnswers.Count -ne 3) { throw 'fixture-bound' }
        $envelope.expectedRestrictedAnswers = $ExpectedRestrictedAnswers
      }
      $inputJson = $envelope | ConvertTo-Json -Depth 20 -Compress
    }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $node.Source
    $start.Arguments = '"' + $helperPath + '"' + $(if ($CheckReady) { ' --check-ready' } elseif ($null -ne $ExpectedRestrictedAnswers) { ' --restricted-answer-acceptance' } else { '' })
    $start.WorkingDirectory = $repositoryRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $deadline = [Threading.CancellationTokenSource]::new($exportHelperTimeoutMilliseconds)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    if (-not $process.Start()) { throw 'helper-unavailable' }
    $processStarted = $true
    # ProcessStartInfo.StandardInputEncoding is absent on Windows PowerShell 5.1.
    # An explicit writer keeps the same BOM-free UTF-8 wire representation on both hosts.
    $inputWriter = [IO.StreamWriter]::new($process.StandardInput.BaseStream, $utf8WithoutBom)
    $inputWriter.AutoFlush = $true
    $null = Wait-CandidateRightsTask ($inputWriter.WriteAsync($inputJson)) $deadline.Token
    $inputWriter.Close()
    $inputWriter = $null

    $output = [IO.MemoryStream]::new()
    $buffer = New-Object byte[] ($maximumExportHelperOutputBytes + 1)
    do {
      $read = Wait-CandidateRightsTask ($process.StandardOutput.BaseStream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token)) $deadline.Token
      if ($read -eq 0) { break }
      if ($output.Length + $read -gt $maximumExportHelperOutputBytes) { throw 'helper-output-bound' }
      $output.Write($buffer, 0, $read)
    } while ($true)
    # Consume at most one stderr byte: any stderr is a closed refusal, never evidence.
    $errorBuffer = New-Object byte[] 1
    $errorRead = Wait-CandidateRightsTask ($process.StandardError.BaseStream.ReadAsync($errorBuffer, 0, 1, $deadline.Token)) $deadline.Token
    $remaining = [Math]::Max(0, $exportHelperTimeoutMilliseconds - [int]$clock.ElapsedMilliseconds)
    if ($errorRead -ne 0 -or -not $process.WaitForExit($remaining) -or $process.ExitCode -ne 0) { throw 'helper-rejected' }
    $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
    return Read-CandidateRightsExportHelperResult -Json ($strictUtf8.GetString($output.ToArray())) -CheckReady:$CheckReady -RestrictedAnswers:($null -ne $ExpectedRestrictedAnswers)
  }
  catch { throw 'The generated-synthetic export verifier is unavailable or rejected the bounded artifact.' }
  finally {
    if ($null -ne $output) { $output.Dispose() }
    if ($null -ne $deadline) { $deadline.Dispose() }
    if ($null -ne $process) {
      try {
        if ($processStarted -and -not $process.HasExited) {
          $process.Kill()
          if (-not $process.WaitForExit(2000)) { throw 'helper-cleanup-incomplete' }
        }
      }
      catch { throw 'The generated-synthetic export verifier process cleanup could not be confirmed.' }
      finally {
        $process.Dispose()
        if ($null -ne $inputWriter) { try { $inputWriter.Dispose() } catch { } }
      }
    }
  }
}

function Assert-CandidateRightsExportReady {
  $null = Invoke-CandidateRightsExportHelper -CheckReady
  return $true
}

function New-CandidateExportHttpClient {
  return [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
}

function Test-ExactVersionGrant {
  param([Parameter(Mandatory)][object]$Access, [Parameter(Mandatory)][string]$ExpectedExportId, [AllowNull()][object[]]$ExpectedRestrictedAnswers = $null)
  $client = $null
  $response = $null
  $stream = $null
  $body = $null
  $artifact = $null
  $buffer = $null
  $deadline = $null
  try {
    $uri = [Uri]([string]$Access.download.url)
    $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
    if ($uri.Scheme -cne 'https' -or $uri.Host -notmatch '\.s3\..*\.amazonaws\.com$' -or [string]::IsNullOrWhiteSpace($query['versionId']) -or [string]$Access.download.method -cne 'GET' -or [int]$query['X-Amz-Expires'] -gt $ExpectedDownloadGrantSeconds) { throw 'grant-rejected' }
    $deadline = [Threading.CancellationTokenSource]::new($exportDownloadTimeoutMilliseconds)
    $client = New-CandidateExportHttpClient
    $response = Wait-CandidateRightsTask ($client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token)) $deadline.Token
    if ([int]$response.StatusCode -ne 200) { throw 'download-rejected' }
    if ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $maximumExportBytes) { throw 'artifact-bound' }
    $stream = Wait-CandidateRightsTask ($response.Content.ReadAsStreamAsync()) $deadline.Token
    $body = [IO.MemoryStream]::new()
    $buffer = New-Object byte[] 8192
    do {
      $read = Wait-CandidateRightsTask ($stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token)) $deadline.Token
      if ($read -eq 0) { break }
      if ($body.Length + $read -gt $maximumExportBytes) { throw 'artifact-bound' }
      $body.Write($buffer, 0, $read)
    } while ($true)
    if ($body.Length -eq 0) { throw 'artifact-empty' }
    $artifact = $body.ToArray()
    $coverage = Invoke-CandidateRightsExportHelper -ExpectedExportId $ExpectedExportId -ExpectedPolicyVersion $ExpectedPolicyVersion -Artifact $artifact
    if ($null -ne $ExpectedRestrictedAnswers) {
      $script:VerifiedRestrictedAnswerCoverage = Invoke-CandidateRightsExportHelper -ExpectedExportId $ExpectedExportId -ExpectedPolicyVersion $ExpectedPolicyVersion -Artifact $artifact -ExpectedRestrictedAnswers $ExpectedRestrictedAnswers
    }
    return [pscustomobject]@{
      DownloadBytes = $artifact.Length
      GrantExpiresAt = [DateTimeOffset]::Parse([string]$Access.download.expiresAt)
      ArtifactExpiresAt = [DateTimeOffset]::Parse([string]$Access.export.artifactExpiresAt)
      ExportCoverage = $coverage
    }
  }
  catch { throw 'The exact-version generated-synthetic export download or verification failed.' }
  finally {
    if ($null -ne $artifact) { [Array]::Clear($artifact, 0, $artifact.Length) }
    if ($null -ne $buffer) { [Array]::Clear($buffer, 0, $buffer.Length) }
    if ($null -ne $body) {
      $storage = $body.GetBuffer()
      [Array]::Clear($storage, 0, $storage.Length)
      $body.Dispose()
    }
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $client) { $client.Dispose() }
    if ($null -ne $deadline) { $deadline.Dispose() }
  }
}

function Wait-GrantExpiry {
  param([Parameter(Mandatory)][string]$ExportId, [Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][Uri]$GrantUri, [Parameter(Mandatory)][DateTimeOffset]$GrantExpiresAt, [Parameter(Mandatory)][DateTimeOffset]$ArtifactExpiresAt)
  $grantWait = [Math]::Max(0, [Math]::Ceiling(($GrantExpiresAt - [DateTimeOffset]::UtcNow).TotalSeconds) + 2)
  if ($grantWait -gt ($ExpectedDownloadGrantSeconds + 5)) { throw "The signed download expiry exceeds the reviewed timing." }
  if ($grantWait -gt 0) { Start-Sleep -Seconds $grantWait }
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  try { $expired = $client.GetAsync($GrantUri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult(); if ([int]$expired.StatusCode -eq 200) { throw "The exact-version signed download remained usable after expiry." }; $expired.Dispose() } finally { $client.Dispose() }
  if ($ArtifactExpiresAt -le [DateTimeOffset]::UtcNow) { throw "The export artifact lifetime elapsed before deletion cleanup could be exercised." }
  return $true
}

function Wait-DeletionCompletion {
  param([Parameter(Mandatory)][string]$RequestId, [Parameter(Mandatory)][string]$ExpectedSubjectDigest)
  $key = "candidate-deletion-recovery/$RequestId.json"
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(10)
  do {
    try {
      $head = Invoke-AwsJson @('s3api','head-object','--bucket',$script:Runtime.RecoveryBucket,'--key',$key,'--output','json') 'Recovery marker completion'
      $tags = Invoke-AwsJson @('s3api','get-object-tagging','--bucket',$script:Runtime.RecoveryBucket,'--key',$key,'--version-id',[string]$head.VersionId,'--output','json') 'Recovery marker tags'
      $map = @{}; foreach ($tag in @($tags.TagSet)) { $map[[string]$tag.Key] = [string]$tag.Value }
      if ([string]$head.Metadata.'subject-digest' -cne $ExpectedSubjectDigest -or [string]$head.Metadata.'policy-sha256' -cne $ReviewedPolicySha256 -or [string]$head.Metadata.format -cne 'candidate-deletion-recovery-v1') { throw "The recovery marker does not bind the exact synthetic subject and reviewed policy." }
      if ($map.state -ceq 'completed' -and [DateTimeOffset]::Parse($map.'completed-at') -le [DateTimeOffset]::UtcNow) { return $true }
    } catch { if ($_.Exception.Message -notmatch 'Recovery marker completion failed') { throw } }
    Start-Sleep -Seconds 5
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The candidate deletion recovery marker did not reach completed."
}

function Confirm-RightsExportDeletion {
  param([Parameter(Mandatory)][Uri]$GrantUri, [Parameter(Mandatory)][string]$ExportId)
  $query = [Web.HttpUtility]::ParseQueryString($GrantUri.Query)
  $key = [Uri]::UnescapeDataString($GrantUri.AbsolutePath.TrimStart('/'))
  $version = [string]$query['versionId']
  $bucket = [string]$script:Runtime.ExportBucket
  if ($GrantUri.Scheme -cne 'https' -or $GrantUri.Host -cne "$bucket.s3.$Region.amazonaws.com" -or
      $ExportId -cnotmatch '^[a-f0-9-]{36}$' -or
      $key -cnotmatch "^candidate-data-exports/[a-f0-9-]{36}/$([regex]::Escape($ExportId))\.json$" -or
      [string]::IsNullOrWhiteSpace($version) -or $version -ceq 'null') {
    throw 'The deleted export does not bind the exact state-owned object version.'
  }
  # A completed deletion marker or expired grant alone does not prove artifact cleanup.
  # The AWS CLI paginates this exact-prefix version inventory; access errors fail closed.
  $inventory = Invoke-AwsJson @('s3api','list-object-versions','--bucket',$bucket,'--prefix',$key,'--output','json') 'Deleted export version inventory'
  $truncated = Get-OptionalProperty $inventory 'IsTruncated'
  if ($truncated -isnot [bool] -or $truncated -ne $false -or
      -not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $inventory 'NextToken'))) {
    throw 'The deleted export version inventory is incomplete.'
  }
  $seenVersions = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($property in @('Versions','DeleteMarkers')) {
    $entries = $inventory.PSObject.Properties[$property]
    if ($null -eq $entries) { continue }
    if ($entries.Value -isnot [array]) { throw 'The deleted export version inventory is malformed.' }
    foreach ($item in $entries.Value) {
      $itemKey = Get-OptionalProperty $item 'Key'
      $itemVersion = Get-OptionalProperty $item 'VersionId'
      if ($itemKey -isnot [string] -or [string]::IsNullOrWhiteSpace($itemKey) -or
          -not $itemKey.StartsWith($key, [StringComparison]::Ordinal) -or
          $itemVersion -isnot [string] -or [string]::IsNullOrWhiteSpace($itemVersion) -or $itemVersion -ceq 'null' -or
          -not $seenVersions.Add("$itemKey`0$itemVersion")) {
        throw 'The deleted export version inventory is malformed.'
      }
      if ($itemKey -ceq $key -and $itemVersion -ceq $version) {
        throw 'The exact exported object version remains after account deletion.'
      }
    }
  }
  return 1
}

# Fixed, nonsensitive failure vocabulary. Only these tokens ever leave the lifecycle on failure; raw error
# text may contain provider details and is never forwarded (see ConvertTo-SafeSessionFailure).
$script:RightsLifecycleSteps = @('resume-fixture','export-request','export-ready','export-download','export-coverage','grant-expiry','identity-refresh','deletion-cancel','recent-mfa','deletion-confirm','deletion-completion','export-cleanup','resume-cleanup','operational-health','receipt')
$script:RightsStep = 'preflight'
function Get-RightsFailureCheck {
  param([string]$Message)
  $checks = [ordered]@{
    'marker_not_completed' = 'did not reach completed'
    'export_version_remains' = 'exported object version remains'
    'export_inventory_invalid' = 'deleted export version inventory'
    'export_binding_invalid' = 'does not bind the exact state-owned'
    'active_ecs_tasks' = 'zero active ECS tasks'
    'queue_not_empty' = 'state-managed queue is not'
    'alarm_not_ok' = 'development alarm must'
    'aws_session' = 'IAM Identity Center session'
  }
  foreach ($name in $checks.Keys) { if ($Message -like "*$($checks[$name])*") { return $name } }
  # Only the resume-prefix absence check is attributable to this step; never label other failures with it.
  if ($script:RightsStep -ceq 'resume-cleanup' -and $Message -match '(?i)resume') { return 'resume_cleanup_incomplete' }
  return 'unclassified'
}
function Invoke-FixedLifecycleReported {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][object]$Plan)
  $script:RightsStep = 'preflight'
  try { return (Invoke-FixedLifecycle $Boundary $Plan) }
  catch {
    $message = [string]$_.Exception.Message
    # Preserve the reviewed pre-deletion refusals that the session bridge already classifies.
    if ($message.StartsWith('D2 acceptance stopped before account deletion:') -or $message.StartsWith('D3 acceptance stopped before account deletion:') -or $message.StartsWith('D4 acceptance stopped before account deletion:') -or
        $message -like 'The disposable identity is not an exact current*' -or $message -ceq 'Acceptance requires clean main exactly matching origin/main and SourceSha.') { throw }
    $step = if ($script:RightsStep -cin $script:RightsLifecycleSteps) { $script:RightsStep } else { 'preflight' }
    # Nothing has been requested yet: keep the original fixed prerequisite message.
    if ($step -ceq 'preflight') { throw }
    throw "RightsLifecycleFailed:$step`:$(Get-RightsFailureCheck $message)"
  }
}

function Invoke-FixedLifecycle {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][object]$Plan)
  $script:VerifiedExportCoverage = $null
  $script:VerifiedRestrictedAnswerCoverage = $null
  $script:VerifiedResumeCoverage = $null
  $null = Assert-SyntheticRefreshPrerequisites
  $null = Assert-CandidateRightsExportReady
  $script:Runtime = $Boundary.Runtime
  $token = $Boundary.Identity.Token
  $idToken = $Boundary.Identity.IdToken
  $started = [DateTimeOffset]::UtcNow
  $script:RightsStep = 'resume-fixture'
  $resumeFixture = if ($ResumeFixture) { New-RightsResumeFixture $token $Boundary.Resume } else { $null }
  $restrictedSnapshot = if ($RestrictedAnswerFixture) { @(New-RestrictedAnswerFixture $token) } else { $null }
  if ($ExpectedPolicyVersion -ceq $notificationsPolicy) { New-NotificationsFixture $token }
  $exportKey = "rights-export-$([guid]::NewGuid().ToString('N'))"
  $exportBody = [ordered]@{ format = 'candidate-data-export-v1' }
  $script:RightsStep = 'export-request'
  $first = Invoke-CandidateApi POST '/me/data-exports' $token $exportBody @{ 'idempotency-key' = $exportKey; 'x-ai-job-apply-reauthentication' = $idToken } @(202)
  $replay = Invoke-CandidateApi POST '/me/data-exports' $token $exportBody @{ 'idempotency-key' = $exportKey; 'x-ai-job-apply-reauthentication' = $idToken } @(202)
  if ([string]$first.Body.id -cne [string]$replay.Body.id -or [string]$first.Body.policyVersion -cne $ExpectedPolicyVersion) { throw "Candidate export idempotency or policy binding failed." }
  $script:RightsStep = 'export-ready'
  $ready = Wait-ExportReady ([string]$first.Body.id) $token
  $script:RightsStep = 'export-download'
  $download = if ($RestrictedAnswerFixture) { Test-ExactVersionGrant $ready ([string]$first.Body.id) -ExpectedRestrictedAnswers $restrictedSnapshot } else { Test-ExactVersionGrant $ready ([string]$first.Body.id) }
  $script:RightsStep = 'export-coverage'
  $null = Assert-CandidateRightsAcceptanceCoverage $download.ExportCoverage
  $script:VerifiedExportCoverage = $download.ExportCoverage
  $grantUri = [Uri]([string]$ready.download.url)
  $script:RightsStep = 'grant-expiry'
  $null = Wait-GrantExpiry ([string]$first.Body.id) $token $grantUri $download.GrantExpiresAt $download.ArtifactExpiresAt

  $script:RightsStep = 'identity-refresh'
  $refreshedIdentity = Refresh-SyntheticIdentityContext $Boundary.Runtime.Issuer $Boundary.Runtime.IdTokenAudience $ExpectedRecentAuthMaxAgeSeconds
  if ([string]$refreshedIdentity.SubjectSha256 -cne [string]$Boundary.Identity.SubjectSha256) {
    throw "The in-memory token refresh changed the reviewed generated-synthetic identity."
  }
  $token = $refreshedIdentity.Token
  $idToken = $refreshedIdentity.IdToken

  $script:RightsStep = 'deletion-cancel'
  $cancelKey = "rights-delete-cancel-$([guid]::NewGuid().ToString('N'))"
  $deletionBody = [ordered]@{ acknowledgement = 'ACCOUNT_DELETION_IS_IRREVERSIBLE' }
  $cancelRequest = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = $cancelKey; 'x-ai-job-apply-reauthentication' = $idToken } @(201)
  $cancelReplay = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = $cancelKey; 'x-ai-job-apply-reauthentication' = $idToken } @(201)
  if ([string]$cancelRequest.Body.id -cne [string]$cancelReplay.Body.id) { throw "Deletion-request idempotency failed." }
  $null = Invoke-CandidateApi DELETE "/me/account-deletion-requests/$($cancelRequest.Body.id)" $token $null @{ 'idempotency-key' = "rights-cancel-$([guid]::NewGuid().ToString('N'))"; 'if-match' = "`"$($cancelRequest.Body.version)`""; 'x-ai-job-apply-reauthentication' = $idToken } @(204)

  $script:RightsStep = 'recent-mfa'
  $freshIdentity = Read-SyntheticIdentityContext $Boundary.Runtime.Issuer $Boundary.Runtime.IdTokenAudience $ExpectedRecentAuthMaxAgeSeconds
  if ([string]$freshIdentity.SubjectSha256 -cne [string]$Boundary.Identity.SubjectSha256) { throw "The recent-MFA refresh changed the reviewed generated-synthetic identity." }
  $token = $freshIdentity.Token
  $idToken = $freshIdentity.IdToken
  $script:RightsStep = 'deletion-confirm'
  $confirmRequest = Invoke-CandidateApi POST '/me/account-deletion-requests' $token $deletionBody @{ 'idempotency-key' = "rights-delete-$([guid]::NewGuid().ToString('N'))"; 'x-ai-job-apply-reauthentication' = $idToken } @(201)
  $confirmation = [ordered]@{ expectedVersion = [int]$confirmRequest.Body.version; confirmation = 'DELETE_MY_ACCOUNT' }
  $confirmed = Invoke-CandidateApi POST "/me/account-deletion-requests/$($confirmRequest.Body.id)/confirm" $token $confirmation @{ 'idempotency-key' = "rights-confirm-$([guid]::NewGuid().ToString('N'))"; 'x-ai-job-apply-reauthentication' = $idToken } @(202)
  if ([string]$confirmed.Body.state -cne 'quarantined') { throw "Deletion confirmation did not atomically quarantine the generated-synthetic identity." }
  $expectedSubjectDigest = Get-CandidateDeletionSubjectDigest $Boundary.Runtime.Issuer $Boundary.Identity.Subject
  $script:RightsStep = 'deletion-completion'
  $null = Wait-DeletionCompletion ([string]$confirmRequest.Body.id) $expectedSubjectDigest
  $script:RightsStep = 'export-cleanup'
  $exportsCleaned = Confirm-RightsExportDeletion $grantUri ([string]$first.Body.id)
  $script:RightsStep = 'resume-cleanup'
  if ($ResumeFixture) {
    $script:VerifiedResumeCoverage = Confirm-RightsResumeDeletion $Boundary.Resume $resumeFixture
    Assert-RightsResumeCoverage $script:VerifiedResumeCoverage
  }
  $script:RightsStep = 'operational-health'
  $post = Assert-OperationalHealth $Boundary.Snapshot
  $script:RightsStep = 'receipt'
  $receipt = [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-rights-acceptance-receipt'; phase = 'verified-cleaned'; sourceSha = $SourceSha
    executionPlanSha256 = $ReviewedExecutionPlanSha256; policySha256 = $ReviewedPolicySha256; subjectSha256 = $Boundary.Identity.SubjectSha256
    startedAt = $started.ToString('o'); completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    exportsRequested = 1; idempotentExportReplays = 1; exactVersionDownloads = 1; expiredDownloadGrants = 1; exportObjectsCleaned = $exportsCleaned
    deletionRequestsCreated = 2; deletionRequestsCancelled = 1; recentMfaConfirmations = 1; deletionMarkersCompleted = 1
    ownerInventoriesReconciled = @($requiredOwners.Split(',')).Count; auth0Reconciled = $true; persistentSyntheticIdentities = 0
    queueCount = $post.QueueCount; queuedMessages = 0; alarmCount = $post.AlarmCount; alarmsOk = $true; activeCompute = 0
    stateLineage = $Boundary.Snapshot.Lineage; stateSerial = $Boundary.Snapshot.Serial; zeroDriftPlanSha256 = $ReviewedZeroDriftPlanSha256
  }
  if ($RestrictedAnswerFixture) {
    if ($null -eq $script:VerifiedRestrictedAnswerCoverage) { throw 'Restricted fixture export verification is missing.' }
    $receipt.schemaVersion = 2
    $receipt.restrictedAnswerCoverage = $script:VerifiedRestrictedAnswerCoverage
  }
  if ($ResumeFixture) {
    Assert-RightsResumeCoverage $script:VerifiedResumeCoverage
    $receipt.schemaVersion = 3
    $receipt.resumeCoverage = $script:VerifiedResumeCoverage
  }
  if ($ExpectedPolicyVersion -cin $applicationsPolicies) {
    $null = Assert-CandidateRightsAcceptanceCoverage $script:VerifiedExportCoverage
    $receipt.applicationsExportCoverage = $script:VerifiedExportCoverage
  }
  return $receipt
}

function Read-AggregateReceipt {
  $path = Resolve-BelowOperatorRoot $ReceiptPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedReceiptSha256) { throw "The candidate-rights receipt checksum does not match the reviewed value." }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $path -Raw) "Candidate-rights receipt"
  if ($RestrictedAnswerFixture) {
    $expectedSchema = if ($ResumeFixture) { 3 } else { 2 }
    if ([int]$receipt.schemaVersion -ne $expectedSchema) { throw 'The reviewed receipt does not include the restricted fixture.' }
    $coverage = Get-OptionalProperty $receipt 'restrictedAnswerCoverage'
    if ($null -eq $coverage) { throw 'The reviewed receipt omits restricted fixture coverage.' }
    $null = Read-CandidateRightsExportHelperResult ($coverage | ConvertTo-Json -Compress) -RestrictedAnswers
  }
  if ($ResumeFixture) {
    if ([int]$receipt.schemaVersion -ne 3) { throw 'The reviewed receipt does not include the resume fixture.' }
    Assert-RightsResumeCoverage (Get-OptionalProperty $receipt 'resumeCoverage')
  }
  if ($ExpectedPolicyVersion -cin $applicationsPolicies) {
    $coverage = Get-OptionalProperty $receipt 'applicationsExportCoverage'
    if ($null -eq $coverage) { throw 'The reviewed receipt omits Applications export coverage.' }
    $validated = Read-CandidateRightsExportHelperResult ($coverage | ConvertTo-Json -Compress)
    $null = Assert-CandidateRightsAcceptanceCoverage $validated
  }
  if ([string]$receipt.kind -cne 'development-candidate-rights-acceptance-receipt' -or [string]$receipt.phase -cne 'verified-cleaned' -or [string]$receipt.sourceSha -cne $SourceSha -or [string]$receipt.policySha256 -cne $ReviewedPolicySha256 -or [int]$receipt.exportsRequested -ne 1 -or [int]$receipt.exportObjectsCleaned -ne 1 -or [int]$receipt.deletionMarkersCompleted -ne 1 -or [int]$receipt.ownerInventoriesReconciled -ne @($requiredOwners.Split(',')).Count -or $receipt.auth0Reconciled -ne $true -or [int]$receipt.persistentSyntheticIdentities -ne 0 -or [int]$receipt.queuedMessages -ne 0 -or [int]$receipt.activeCompute -ne 0) { throw "The reviewed candidate-rights aggregate receipt is incomplete." }
  return $receipt
}

function Read-RecoveryReplayReceipt {
  if ([string]::IsNullOrWhiteSpace($RecoveryReplayReceiptPath) -and [string]::IsNullOrWhiteSpace($ReviewedRecoveryReplayReceiptSha256)) { return $null }
  if ([string]::IsNullOrWhiteSpace($RecoveryReplayReceiptPath) -or $ReviewedRecoveryReplayReceiptSha256 -notmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $RecoveryReplayReceiptPath -PathType Leaf)) { throw "A separately reviewed aggregate recovery-replay receipt is required." }
  if ((Get-FileSha256 $RecoveryReplayReceiptPath) -cne $ReviewedRecoveryReplayReceiptSha256) { throw "The recovery-replay receipt checksum does not match." }
  $receipt = ConvertFrom-OperatorJson (Get-Content -LiteralPath $RecoveryReplayReceiptPath -Raw) "Recovery-replay receipt"
  $null = Assert-ExactPropertySet $receipt @('schemaVersion','kind','environment','sourceSha','policySha256','restoredDatabaseClass','markersValidated','restoredUsersAbsent','restoredUsersReconciled','primaryDatabaseRejected','trafficEnabled','cleanupSucceeded','completedAt') "Recovery-replay receipt"
  if ([int]$receipt.schemaVersion -ne 1 -or [string]$receipt.kind -cne 'development-candidate-deletion-recovery-replay' -or [string]$receipt.environment -cne 'development' -or [string]$receipt.sourceSha -cne $SourceSha -or [string]$receipt.policySha256 -cne $ReviewedPolicySha256 -or [string]$receipt.restoredDatabaseClass -cne 'disposable-quiesced-generated-synthetic' -or [int]$receipt.markersValidated -lt 1 -or ([int]$receipt.restoredUsersAbsent + [int]$receipt.restoredUsersReconciled) -ne [int]$receipt.markersValidated -or $receipt.primaryDatabaseRejected -ne $true -or $receipt.trafficEnabled -ne $false -or $receipt.cleanupSucceeded -ne $true) { throw "The recovery-replay receipt does not prove isolated aggregate reconciliation and cleanup." }
  return $receipt
}

if (-not $script:TestOnly) {
  switch ($Action) {
    'Status' {
      $boundary = Get-AcceptanceBoundary
      [pscustomobject]@{ Environment = 'development'; CandidateRightsEnabled = $true; StateSerial = $boundary.Snapshot.Serial; PolicyBound = $true; BackupInventoryBound = $true; Auth0AuthorizedNonZach = $true; QueuedMessages = 0; ActiveCompute = 0; AlarmsOk = $true; CloudMutation = $false }
    }
    'Plan' {
      $boundary = Get-AcceptanceBoundary -RequireIdentity
      $plan = New-ExecutionPlan $boundary
      $path = Join-Path $operatorRoot "plan-$([guid]::NewGuid().ToString('N')).json"
      Write-ExclusiveJson $path $plan
      [pscustomobject]@{ Outcome = 'review-required'; PlanPath = $path; PlanSha256 = Get-FileSha256 $path; FixedSteps = @(Get-FixedAcceptanceSequence).Count; CloudMutation = $false }
    }
    'Execute' {
      $reviewed = Read-ExecutionPlan
      $boundary = Get-AcceptanceBoundary -RequireIdentity
      $current = New-ExecutionPlan $boundary
      $comparisonNames = @('sourceSha','policy','identity','auth0','aliases','zeroDriftPlanSha256')
      if ($ResumeFixture) { $comparisonNames += 'resumeRuntime' }
      foreach ($name in $comparisonNames) {
        if (($reviewed.Value.$name | ConvertTo-Json -Depth 20 -Compress) -cne ($current.$name | ConvertTo-Json -Depth 20 -Compress)) { throw "The live $name boundary changed after plan review." }
      }
      # RDS advances LatestRestorableTime continuously and rotates snapshots under the reviewed
      # retention policy. Require the durable disposition to remain exact and recovery coverage to
      # be non-regressing without treating normal backup progress as an acceptance-boundary change.
      $reviewedRestorable = [DateTimeOffset]::Parse([string]$reviewed.Value.backups.LatestRestorableTime)
      $currentRestorable = [DateTimeOffset]::Parse([string]$current.backups.LatestRestorableTime)
      if ([int]$current.backups.BackupRetentionDays -ne [int]$reviewed.Value.backups.BackupRetentionDays -or
          [int]$reviewed.Value.backups.SnapshotCount -lt 1 -or [int]$current.backups.SnapshotCount -lt 1 -or
          $currentRestorable -lt $reviewedRestorable) {
        throw "The live backup disposition regressed after plan review."
      }
      $receipt = Invoke-FixedLifecycleReported $boundary $reviewed.Value
      $path = Join-Path $operatorRoot "receipt-$($ReviewedExecutionPlanSha256.Substring(0,12)).json"
      Write-ExclusiveJson $path $receipt
      $result = [ordered]@{ Outcome = 'verified-and-cleaned'; ReceiptPath = $path; ReceiptSha256 = Get-FileSha256 $path; ExportsRequested = 1; DeletionMarkersCompleted = 1; PersistentSyntheticIdentities = 0; ExportCoverage = $script:VerifiedExportCoverage }
      if ($RestrictedAnswerFixture) { $result.RestrictedAnswerCoverage = $script:VerifiedRestrictedAnswerCoverage }
      if ($ResumeFixture) { $result.ResumeCoverage = $script:VerifiedResumeCoverage }
      [pscustomobject]$result
    }
    'RecoverUnconfirmed' {
      $boundary = Get-AcceptanceBoundary -RequireIdentity
      Invoke-RecoverUnconfirmedRequest $boundary
    }
    'RecoverCleanup' {
      $receipt = Read-AggregateReceipt
      $boundary = Get-AcceptanceBoundary
      $health = Assert-OperationalHealth $boundary.Snapshot
      [pscustomobject]@{ Outcome = 'cleanup-already-proved'; AcceptanceClaim = $false; PersistentSyntheticIdentities = [int]$receipt.persistentSyntheticIdentities; QueuedMessages = $health.QueuedMessages; ActiveCompute = $health.ActiveCompute; CloudMutation = $false }
    }
    'Verify' {
      $receipt = Read-AggregateReceipt
      $replay = Read-RecoveryReplayReceipt
      $boundary = Get-AcceptanceBoundary -RequireIdentity:$false
      if ([long]$receipt.stateSerial -ne $boundary.Snapshot.Serial -or [string]$receipt.stateLineage -cne $boundary.Snapshot.Lineage) { throw "Terraform state changed after candidate-rights execution." }
      [pscustomobject]@{ Outcome = 'verified'; ExportLifecyclePassed = $true; DeletionLifecyclePassed = $true; RecoveryReplayVerified = ($null -ne $replay); RecoveryMarkersValidated = $(if ($null -ne $replay) { [int]$replay.markersValidated } else { $null }); PersistentSyntheticIdentities = 0; QueuedMessages = 0; ActiveCompute = 0; AlarmsOk = $true; StateChanged = $false; CloudMutation = $false }
    }
  }
}
