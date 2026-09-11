Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")
$operator = Join-Path $repositoryRoot 'scripts\operate-development-candidate-rights-acceptance.ps1'
$source = Get-Content -LiteralPath $operator -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operator, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw 'The candidate-rights operator has parser errors.' }

$expectedParameters = @(
  'Action','AwsProfile','Region','ExpectedAccountId','StateBucket','SourceSha',
  'ExpectedPolicyVersion','ReviewedPolicySha256','ExpectedExportLifetimeSeconds',
  'ExpectedDownloadGrantSeconds','ExpectedBackupRetentionDays','ExpectedRecentAuthMaxAgeSeconds',
  'ExpectedOwnerInventory','ExpectedSubprocessorInventory','ZeroDriftPlanPath',
  'ReviewedZeroDriftPlanSha256','ExecutionPlanPath','ReviewedExecutionPlanSha256','RecoveryFailureTimestamp','ReceiptPath',
  'ReviewedReceiptSha256','RecoveryReplayReceiptPath','ReviewedRecoveryReplayReceiptSha256','Help'
)
$actualParameters = @($ast.ParamBlock.Parameters.Name.VariablePath.UserPath)
if (($actualParameters -join '|') -cne ($expectedParameters -join '|')) { throw 'The exact public parameter surface changed.' }
if ($actualParameters -contains 'AccessToken' -or $actualParameters -contains 'Subject' -or $actualParameters -contains 'Secret') { throw 'A sensitive caller-selected parameter was added.' }

foreach ($required in @(
    'generated-synthetic-only',
    'delete_user_only',
    'identity,profile,documents,jobs,matching,billing,trust',
    'DELETE_MY_ACCOUNT',
    'ACCOUNT_DELETION_IS_IRREVERSIBLE',
    'candidate-deletion-recovery-v1',
    'CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN',
    'CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET',
    "form['grant_type'] = 'refresh_token'",
    'Refresh-SyntheticIdentityContext $Boundary.Runtime.Issuer',
    'PersistentSyntheticIdentities = 0',
    'ActiveCompute = 0',
    'QueuedMessages = 0',
    'ownerInventoriesReconciled = 7',
    'MeaningfulChanges = 0'
  )) {
  if (-not $source.Contains($required)) { throw "The operator is missing the required fixed guard: $required" }
}
foreach ($requiredInspectionGuard in @(
    'development-candidate-rights-acceptance-data',
    'init -backend=false -input=false -lockfile=readonly',
    'Terraform provider schemas could not be initialized for zero-drift inspection.',
    "[Environment]::GetEnvironmentVariable('TF_DATA_DIR', 'Process')"
  )) {
  if (-not $source.Contains($requiredInspectionGuard)) {
    throw "The zero-drift inspection path is missing its isolated provider-schema guard: $requiredInspectionGuard"
  }
}
foreach ($forbidden in @('terraform apply', 'aws ecs run-task', 'docker ', 'wsl --shutdown', 'shutdown.exe', 'Stop-Computer', 'github workflow', 'vercel ')) {
  if ($source -match [regex]::Escape($forbidden)) { throw "The operator contains a forbidden mutation/control path: $forbidden" }
}
if ($source -notmatch [regex]::Escape('$issuerValue = [string]($issuer | Select-Object -First 1)') -or
    $source -match [regex]::Escape('Issuer = [string]$issuer[0]')) {
  throw 'The singular state-bound issuer is vulnerable to scalar character indexing.'
}
foreach ($backupProgressGuard in @(
    "'sourceSha','policy','identity','auth0','aliases','zeroDriftPlanSha256'",
    '$currentRestorable -lt $reviewedRestorable',
    'The live backup disposition regressed after plan review.'
  )) {
  if ($source -notmatch [regex]::Escape($backupProgressGuard)) {
    throw "The execution boundary does not safely tolerate monotonic backup progress: $backupProgressGuard"
  }
}
$identityBoundaryIndex = $source.IndexOf('$identity = if ($RequireIdentity) { Read-SyntheticIdentityContext')
$backupBoundaryIndex = $source.IndexOf('$backup = Get-BackupInventory')
$healthBoundaryIndex = $source.IndexOf('$health = Assert-OperationalHealth')
$driftBoundaryIndex = $source.IndexOf('$drift = if ($RequireIdentity) { Read-ReviewedZeroDrift')
if ($identityBoundaryIndex -lt 0 -or $identityBoundaryIndex -gt $backupBoundaryIndex -or
    $identityBoundaryIndex -gt $healthBoundaryIndex -or $identityBoundaryIndex -gt $driftBoundaryIndex) {
  throw 'The short-lived identity proof is not validated before the slow acceptance inspections.'
}

$env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY = '1'
. $operator `
  -ExpectedAccountId '123456789012' `
  -StateBucket 'state.example' `
  -SourceSha ('a' * 40) `
  -ExpectedPolicyVersion 'd1-synthetic-v1' `
  -ReviewedPolicySha256 ('b' * 64) `
  -ExpectedExportLifetimeSeconds 300 `
  -ExpectedDownloadGrantSeconds 60 `
  -ExpectedBackupRetentionDays 7 `
  -ExpectedRecentAuthMaxAgeSeconds 300 `
  -ExpectedSubprocessorInventory 'auth0,aws'

$policyEnvironment = [pscustomobject]@{
  CANDIDATE_RIGHTS_POLICY_VERSION = 'd1-synthetic-v1'
  CANDIDATE_RIGHTS_POLICY_SHA256 = ('b' * 64)
  CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS = '300'
  CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS = '60'
  CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS = '7'
  CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS = '300'
  CANDIDATE_RIGHTS_OWNER_INVENTORY = 'identity,profile,documents,jobs,matching,billing,trust'
  CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY = 'auth0,aws'
}
if (-not (Assert-PolicyEnvironment $policyEnvironment)) { throw 'The exact policy environment was not accepted.' }

foreach ($mutation in @(
    @{ Name = 'CANDIDATE_RIGHTS_POLICY_SHA256'; Value = ('c' * 64) },
    @{ Name = 'CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS'; Value = '301' },
    @{ Name = 'CANDIDATE_RIGHTS_OWNER_INVENTORY'; Value = 'identity,profile,documents,jobs,matching,billing' },
    @{ Name = 'CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY'; Value = 'none' }
  )) {
  $copy = $policyEnvironment | ConvertTo-Json | ConvertFrom-Json
  $copy.($mutation.Name) = $mutation.Value
  $rejected = $false
  try { $null = Assert-PolicyEnvironment $copy } catch { $rejected = $true }
  if (-not $rejected) { throw "The policy guard accepted changed $($mutation.Name)." }
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) "candidate-rights-operator-tests-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $temporary
try {
  $now = [DateTimeOffset]::UtcNow
  function New-TestJwt {
    param(
      [string]$Subject = 'auth0|generated-synthetic',
      [string[]]$Amr = @('pwd','mfa'),
      [int]$AuthAge = 30,
      [string]$Scope = 'profile:write',
      [object]$Audience = 'candidate-web-client'
    )
    $header = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}')).TrimEnd('=').Replace('+','-').Replace('/','_')
    $payloadObject = [ordered]@{ iss = 'https://identity.example/'; sub = $Subject; aud = $Audience; scope = $Scope; amr = $Amr; auth_time = $now.AddSeconds(-$AuthAge).ToUnixTimeSeconds(); exp = $now.AddMinutes(10).ToUnixTimeSeconds() }
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($payloadObject | ConvertTo-Json -Compress))).TrimEnd('=').Replace('+','-').Replace('/','_')
    return "$header.$payload.signature"
  }
  function Write-Attestation {
    param([string]$Path, [string]$Subject = 'auth0|generated-synthetic', [string]$Owner = 'authorized-operator')
    [IO.File]::WriteAllText($Path, ([ordered]@{
          schemaVersion = 1; classification = 'generated-synthetic-only'; issuer = 'https://identity.example/'
          subjectSha256 = Get-TextSha256 $Subject; authorizedOwner = $Owner
          createdAt = $now.AddMinutes(-2).ToString('o'); expiresAt = $now.AddMinutes(20).ToString('o')
        } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  }

  $attestationPath = Join-Path $temporary 'identity.json'
  Write-Attestation $attestationPath
  $env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN = New-TestJwt
  $env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN = New-TestJwt
  $env:CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH = $attestationPath
  $identity = Read-SyntheticIdentityContext 'https://identity.example/' 'candidate-web-client' 300
  if ([string]$identity.SubjectSha256 -cne (Get-TextSha256 'auth0|generated-synthetic') -or [string]$identity.Token -cne $env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN) { throw 'The exact generated-synthetic identity was not accepted.' }
  $ledgerSubjectDigest = Get-CandidateDeletionSubjectDigest 'https://identity.example/' 'auth0|generated-synthetic'
  if ($ledgerSubjectDigest -notmatch '^[a-f0-9]{64}$' -or
      $ledgerSubjectDigest -ceq $identity.SubjectSha256) {
    throw 'The recovery-ledger subject digest is not domain-separated from the attestation hash.'
  }

  foreach ($case in @(
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -Amr @('pwd'); Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -AuthAge 301; Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt -Scope 'profile:read'; IdToken = New-TestJwt; Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -Subject 'auth0|other-synthetic'; Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -Audience 'different-web-client'; Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -Audience @('candidate-web-client','other-client'); Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt -Amr @('pwd','otp','webauthn'); Owner = 'authorized-operator' },
      @{ AccessToken = New-TestJwt; IdToken = New-TestJwt; Owner = 'Zach Becker' }
    )) {
    Write-Attestation $attestationPath -Owner $case.Owner
    $env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN = $case.AccessToken
    $env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN = $case.IdToken
    $rejected = $false
    try { $null = Read-SyntheticIdentityContext 'https://identity.example/' 'candidate-web-client' 300 } catch { $rejected = $true }
    if (-not $rejected) { throw 'The identity guard accepted missing MFA, stale auth, missing scope, or Zach ownership.' }
  }
  Write-Attestation $attestationPath
  $env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN = New-TestJwt
  $env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN = New-TestJwt

  $recoveryRequestId = '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a'
  $recoveryReqId = 'privacy-safe-log-correlation'
  $recoveryAt = [DateTimeOffset]::UtcNow
  $recoveryEvents = @(
    [pscustomobject]@{
      timestamp = $recoveryAt.AddMilliseconds(-50).ToUnixTimeMilliseconds()
      message = ([ordered]@{
          reqId = $recoveryReqId; msg = 'incoming request'
          req = [ordered]@{ method = 'POST'; url = "/v1/me/account-deletion-requests/$recoveryRequestId/confirm" }
        } | ConvertTo-Json -Compress)
    },
    [pscustomobject]@{
      timestamp = $recoveryAt.ToUnixTimeMilliseconds()
      message = ([ordered]@{
          reqId = $recoveryReqId; event = 'unhandled_request_failure'
          route = '/v1/me/account-deletion-requests/:deletionRequestId/confirm'
          error_type = 'AccessDeniedException'
        } | ConvertTo-Json -Compress)
    }
  )
  $recovery = Get-UnconfirmedRequestFromLogEvents $recoveryEvents
  if ([string]$recovery.RequestId -cne $recoveryRequestId -or
      [long]$recovery.FailureTimestamp.ToUnixTimeMilliseconds() -ne [long]$recoveryAt.ToUnixTimeMilliseconds()) {
    throw 'The exact privacy-safe unconfirmed request was not recovered.'
  }
  $rejected = $false
  try { $null = Get-UnconfirmedRequestFromLogEvents @($recoveryEvents + $recoveryEvents[1]) } catch { $rejected = $true }
  if (-not $rejected) { throw 'Ambiguous failed-confirmation recovery logs were accepted.' }

  $script:weightedAlias = $false
  function global:Invoke-AwsJson {
    param([string[]]$Arguments, [string]$Operation)
    if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-alias') {
      return [pscustomobject]@{
        FunctionVersion = '12'
        RoutingConfig = [pscustomobject]@{ AdditionalVersionWeights = if ($script:weightedAlias) { [pscustomobject]@{ '11' = 0.1 } } else { [pscustomobject]@{} } }
      }
    }
    if ($Arguments[0] -ceq 'lambda' -and $Arguments[1] -ceq 'get-function-configuration') {
      return [pscustomobject]@{ Version = '12'; CodeSha256 = (('A' * 43) + '='); Environment = [pscustomobject]@{ Variables = $policyEnvironment } }
    }
    throw "Unexpected mocked AWS operation: $Operation"
  }
  $alias = Get-LambdaIdentity 'arn:aws:lambda:us-east-2:123456789012:function:test:development' 'test'
  if ($alias.Version -ne 12 -or [string]$alias.CodeSha256 -cne (('A' * 43) + '=')) { throw 'An exact unweighted alias was not accepted.' }
  $script:weightedAlias = $true
  $rejected = $false
  try { $null = Get-LambdaIdentity 'arn:aws:lambda:us-east-2:123456789012:function:test:development' 'test' } catch { $rejected = $true }
  if (-not $rejected) { throw 'A weighted Lambda alias was accepted.' }
  $script:weightedAlias = $false

  $boundary = [pscustomobject]@{
    Snapshot = [pscustomobject]@{ Lineage = '11111111-1111-4111-8111-111111111111'; Serial = 200; VersionId = 'state-version' }
    Runtime = [pscustomobject]@{ Aliases = [pscustomobject]@{} }
    Identity = [pscustomobject]@{ SubjectSha256 = Get-TextSha256 'auth0|generated-synthetic'; AttestationSha256 = ('d' * 64); IdTokenAudienceSha256 = ('9' * 64) }
    Secret = [pscustomobject]@{ ClientIdSha256 = ('e' * 64); AuthorizedOwnerSha256 = ('f' * 64); RevocationMode = 'delete_user_only' }
    Backup = [pscustomobject]@{ BackupRetentionDays = 7; SnapshotCount = 1; InventorySha256 = ('1' * 64); LatestRestorableTime = $now.ToString('o') }
    Health = [pscustomobject]@{ ActiveCompute = 0; QueueCount = 3; QueuedMessages = 0; AlarmCount = 44; AlarmsOk = $true }
    Drift = [pscustomobject]@{ Sha256 = ('2' * 64) }
  }
  foreach ($name in @('gateway','outboxStarter','durable','activity','terminal')) {
    Add-Member -InputObject $boundary.Runtime.Aliases -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{ AliasArnSha256 = ('3' * 64); Version = 12; CodeSha256 = (('A' * 43) + '=') })
  }
  $plan = New-ExecutionPlan $boundary
  $serialized = $plan | ConvertTo-Json -Depth 30 -Compress
  if (@($plan.fixedSequence).Count -ne 15 -or
      $serialized.Contains('auth0|generated-synthetic') -or
      $serialized.Contains('authorized-operator') -or
      $serialized.Contains($env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN) -or
      $serialized.Contains($env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN)) {
    throw 'The execution plan is not aggregate-only or omitted a fixed phase.'
  }

  # These names contain generated values only. No caller credential is read or overwritten.
  $generatedRefreshName = 'CANDIDATE_RIGHTS_TEST_GENERATED_REFRESH'
  $generatedClientName = 'CANDIDATE_RIGHTS_TEST_GENERATED_CLIENT'
  if ((Test-Path -LiteralPath "Env:$generatedRefreshName") -or
      (Test-Path -LiteralPath "Env:$generatedClientName")) {
    throw 'The generated refresh test environment must start absent.'
  }
  $originalRefreshName = $refreshTokenEnvironmentName
  $originalClientName = $clientSecretEnvironmentName
  $originalApiFunction = ${function:Invoke-CandidateApi}
  $originalRefreshFunction = ${function:Refresh-SyntheticIdentityContext}
  $originalReadinessFunction = ${function:Assert-CandidateRightsExportReady}
  $refreshPrerequisiteAssertions = 0
  function Assert-GeneratedRefreshCondition {
    param([bool]$Condition, [string]$Description)
    $script:refreshPrerequisiteAssertions += 1
    if (-not $Condition) { throw $Description }
  }
  try {
    $refreshTokenEnvironmentName = $generatedRefreshName
    $clientSecretEnvironmentName = $generatedClientName
    $script:generatedApiCalls = 0
    $script:generatedRefreshCalls = 0
    function Invoke-CandidateApi {
      $script:generatedApiCalls += 1
      throw 'generated-stop-before-network'
    }
    function Refresh-SyntheticIdentityContext {
      $script:generatedRefreshCalls += 1
      throw 'generated-unexpected-refresh'
    }
    function Assert-CandidateRightsExportReady { return $true }
    $lifecycleBoundary = [pscustomobject]@{
      Runtime = [pscustomobject]@{}
      Identity = [pscustomobject]@{ Token = 'generated-access'; IdToken = 'generated-id' }
    }
    $fixedPrerequisiteFailure = 'The fixed generated-synthetic refresh-token and client-authentication environment variables are required.'
    foreach ($case in @(
        @{ Refresh = $null; Client = $null },
        @{ Refresh = $null; Client = 'generated-client-auth' },
        @{ Refresh = ''; Client = 'generated-client-auth' },
        @{ Refresh = '   '; Client = 'generated-client-auth' },
        @{ Refresh = 'generated-refresh'; Client = $null },
        @{ Refresh = 'generated-refresh'; Client = '                ' },
        @{ Refresh = 'generated-refresh'; Client = ('x' * 15) }
      )) {
      [Environment]::SetEnvironmentVariable($generatedRefreshName, $case.Refresh, 'Process')
      [Environment]::SetEnvironmentVariable($generatedClientName, $case.Client, 'Process')
      $script:generatedApiCalls = 0
      $script:generatedRefreshCalls = 0
      $failure = ''
      try { $null = Invoke-FixedLifecycle $lifecycleBoundary $plan }
      catch { $failure = $_.Exception.Message }
      Assert-GeneratedRefreshCondition ($failure -ceq $fixedPrerequisiteFailure) 'Execute did not report the fixed prerequisite failure.'
      Assert-GeneratedRefreshCondition ($script:generatedApiCalls -eq 0) 'Execute reached an API write with incomplete refresh prerequisites.'
      Assert-GeneratedRefreshCondition ($script:generatedRefreshCalls -eq 0) 'Execute attempted refresh with incomplete prerequisites.'

      # Exercise the actual refresh function too: invalid inputs fail before HttpClient creation.
      $failure = ''
      try { $null = & $originalRefreshFunction 'https://identity.example/' 'candidate-web-client' 300 }
      catch { $failure = $_.Exception.Message }
      Assert-GeneratedRefreshCondition ($failure -ceq $fixedPrerequisiteFailure) 'Refresh no longer rechecks its fixed prerequisites.'
    }
    [Environment]::SetEnvironmentVariable($generatedRefreshName, 'generated-refresh', 'Process')
    [Environment]::SetEnvironmentVariable($generatedClientName, ('x' * 16), 'Process')
    Assert-GeneratedRefreshCondition (Assert-SyntheticRefreshPrerequisites) 'Exact minimum generated refresh prerequisites were rejected.'
    $script:generatedApiCalls = 0
    $script:generatedRefreshCalls = 0
    $failure = ''
    try { $null = Invoke-FixedLifecycle $lifecycleBoundary $plan }
    catch { $failure = $_.Exception.Message }
    Assert-GeneratedRefreshCondition ($failure -ceq 'generated-stop-before-network') 'Valid prerequisites did not continue to the existing lifecycle.'
    Assert-GeneratedRefreshCondition ($script:generatedApiCalls -eq 1 -and $script:generatedRefreshCalls -eq 0) 'The precheck changed the fixed first action or refreshed early.'

    Remove-Item -LiteralPath "Env:$generatedRefreshName" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:$generatedClientName" -ErrorAction SilentlyContinue
    $unchangedPlan = New-ExecutionPlan $boundary
    Assert-GeneratedRefreshCondition (@($unchangedPlan.fixedSequence).Count -eq 15) 'Plan unexpectedly requires Execute-only refresh inputs.'
    $planBranch = $ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.SwitchStatementAst]
      }, $false) | Where-Object { $_.Condition.Extent.Text -ceq '$Action' }
    $planBody = @($planBranch.Clauses | Where-Object { $_.Item1.Value -ceq 'Plan' })[0].Item2
    Assert-GeneratedRefreshCondition (-not $planBody.Extent.Text.Contains('Assert-SyntheticRefreshPrerequisites')) 'Plan gained an Execute-only prerequisite.'
  }
  finally {
    $refreshTokenEnvironmentName = $originalRefreshName
    $clientSecretEnvironmentName = $originalClientName
    Set-Item -LiteralPath Function:Invoke-CandidateApi -Value $originalApiFunction
    Set-Item -LiteralPath Function:Refresh-SyntheticIdentityContext -Value $originalRefreshFunction
    Set-Item -LiteralPath Function:Assert-CandidateRightsExportReady -Value $originalReadinessFunction
    Remove-Item -LiteralPath "Env:$generatedRefreshName" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:$generatedClientName" -ErrorAction SilentlyContinue
  }

  $exportVerificationAssertions = 0
  function Assert-GeneratedExportCondition {
    param([bool]$Condition, [string]$Description)
    $script:exportVerificationAssertions += 1
    if (-not $Condition) { throw $Description }
  }
  $zeroCoverage = [ordered]@{
    valid = $true; consentCount = 0; contributionApprovalCount = 0; contributionCount = 0
    privateCaptureCount = 0; trustCaseCount = 0; trustCaseEventCount = 0
  }
  $parsedCoverage = Read-CandidateRightsExportHelperResult ($zeroCoverage | ConvertTo-Json -Compress)
  Assert-GeneratedExportCondition ($parsedCoverage.consentCount -eq 0 -and $parsedCoverage.trustCaseCount -eq 0) 'Empty D2 coverage was fabricated as nonempty.'
  foreach ($mutation in @(
      @{ Name = 'valid'; Value = 'true' },
      @{ Name = 'valid'; Value = $false },
      @{ Name = 'consentCount'; Value = '1' },
      @{ Name = 'consentCount'; Value = $true },
      @{ Name = 'consentCount'; Value = -1 },
      @{ Name = 'consentCount'; Value = 0.5 },
      @{ Name = 'consentCount'; Value = 1048577 },
      @{ Name = 'contributionApprovalCount'; Value = 1 }
    )) {
    $changed = $zeroCoverage | ConvertTo-Json | ConvertFrom-Json
    $changed.($mutation.Name) = $mutation.Value
    $rejected = $false
    try { $null = Read-CandidateRightsExportHelperResult ($changed | ConvertTo-Json -Compress) }
    catch { $rejected = $true }
    Assert-GeneratedExportCondition $rejected 'Malformed fixed export coverage was accepted.'
  }
  foreach ($json in @('{"ready":false}', '{"ready":"true"}', '{"ready":true,"extra":0}', '{}', '[]')) {
    $rejected = $false
    try { $null = Read-CandidateRightsExportHelperResult -Json $json -CheckReady }
    catch { $rejected = $true }
    Assert-GeneratedExportCondition $rejected 'Malformed verifier readiness was accepted.'
  }
  $extraCoverage = $zeroCoverage | ConvertTo-Json | ConvertFrom-Json
  Add-Member -InputObject $extraCoverage -NotePropertyName candidate -NotePropertyValue 'generated-private-canary'
  $rejected = $false
  try { $null = Read-CandidateRightsExportHelperResult ($extraCoverage | ConvertTo-Json -Compress) }
  catch { $rejected = $true }
  Assert-GeneratedExportCondition $rejected 'Verifier output containing an unapproved field was accepted.'

  Add-Type -AssemblyName System.Net.Http
  $generatedHttpAssemblies = @([Net.Http.HttpClient].Assembly.Location, [Net.HttpStatusCode].Assembly.Location) | Select-Object -Unique
  Add-Type -ReferencedAssemblies $generatedHttpAssemblies -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class GeneratedRightsExportStream : MemoryStream {
  public bool Closed;
  public readonly bool Stall;
  public GeneratedRightsExportStream(byte[] bytes, bool stall) : base(bytes) { Stall = stall; }
  public override bool CanSeek { get { return false; } }
  public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token) {
    if (Stall) return new TaskCompletionSource<int>().Task;
    return base.ReadAsync(buffer, offset, count, token);
  }
  protected override void Dispose(bool disposing) { Closed = true; base.Dispose(disposing); }
}
public sealed class GeneratedRightsExportResponse : HttpResponseMessage {
  public bool Closed;
  protected override void Dispose(bool disposing) { Closed = true; base.Dispose(disposing); }
}
public sealed class GeneratedRightsExportHandler : HttpMessageHandler {
  public readonly byte[] Bytes;
  public readonly string Mode;
  public int Calls;
  public bool Closed;
  public GeneratedRightsExportStream Stream;
  public GeneratedRightsExportResponse Response;
  public GeneratedRightsExportHandler(byte[] bytes, string mode) { Bytes = bytes; Mode = mode; }
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
    Calls++;
    if (Mode == "headers-stall") return new TaskCompletionSource<HttpResponseMessage>().Task;
    Stream = new GeneratedRightsExportStream(Bytes, Mode == "body-stall");
    Response = new GeneratedRightsExportResponse();
    Response.StatusCode = Mode == "http-rejected" ? HttpStatusCode.Forbidden : HttpStatusCode.OK;
    Response.Content = new StreamContent(Stream);
    if (Mode == "declared-too-large") Response.Content.Headers.ContentLength = 1048577;
    return Task.FromResult<HttpResponseMessage>(Response);
  }
  protected override void Dispose(bool disposing) { Closed = true; base.Dispose(disposing); }
}
'@
  $originalDownloadClientFunction = ${function:New-CandidateExportHttpClient}
  $originalHelperFunction = ${function:Invoke-CandidateRightsExportHelper}
  $originalDownloadTimeout = $exportDownloadTimeoutMilliseconds
  $originalCandidateApiFunction = ${function:Invoke-CandidateApi}
  $originalRefreshAssertionFunction = ${function:Assert-SyntheticRefreshPrerequisites}
  $originalExportWaitFunction = ${function:Wait-ExportReady}
  $originalGrantWaitFunction = ${function:Wait-GrantExpiry}
  try {
    function New-CandidateExportHttpClient { return [Net.Http.HttpClient]::new($script:generatedDownloadHandler) }
    function Invoke-CandidateRightsExportHelper {
      param([switch]$CheckReady, [string]$ExpectedExportId, [string]$ExpectedPolicyVersion, [byte[]]$Artifact)
      if ($CheckReady) {
        if ($script:generatedReadinessFailure) { throw 'generated-verifier-unavailable' }
        return [pscustomobject]@{ ready = $true }
      }
      $script:generatedVerificationCalls += 1
      $script:generatedVerifiedBuffer = $Artifact
      Assert-GeneratedExportCondition ($ExpectedExportId -ceq '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a') 'The export verifier received the wrong request binding.'
      Assert-GeneratedExportCondition ($ExpectedPolicyVersion -ceq 'd1-synthetic-v1') 'The export verifier received the wrong policy binding.'
      if ($script:generatedVerificationFailure) { throw 'generated-artifact-rejected' }
      return [pscustomobject]$zeroCoverage
    }
    $script:generatedReadinessFailure = $false
    $script:generatedVerificationFailure = $false
    $exportDownloadTimeoutMilliseconds = 500
    $access = [pscustomobject]@{
      export = [pscustomobject]@{ artifactExpiresAt = $now.AddHours(1).ToString('o') }
      download = [pscustomobject]@{
        url = 'https://generated.s3.us-east-2.amazonaws.com/generated?versionId=generated&X-Amz-Expires=60'
        method = 'GET'; expiresAt = $now.AddSeconds(60).ToString('o')
      }
    }
    foreach ($case in @(
        @{ Mode = 'success'; Bytes = [Text.Encoding]::UTF8.GetBytes('{}'); Accept = $true; Verify = 1 },
        @{ Mode = 'empty'; Bytes = [byte[]]@(); Accept = $false; Verify = 0 },
        @{ Mode = 'http-rejected'; Bytes = [byte[]]@(1); Accept = $false; Verify = 0 },
        @{ Mode = 'declared-too-large'; Bytes = [byte[]]@(1); Accept = $false; Verify = 0 },
        @{ Mode = 'stream-too-large'; Bytes = (New-Object byte[] 1048577); Accept = $false; Verify = 0 },
        @{ Mode = 'headers-stall'; Bytes = [byte[]]@(1); Accept = $false; Verify = 0 },
        @{ Mode = 'body-stall'; Bytes = [byte[]]@(1); Accept = $false; Verify = 0 }
      )) {
      $script:generatedDownloadHandler = [GeneratedRightsExportHandler]::new($case.Bytes, $case.Mode)
      $script:generatedVerificationCalls = 0
      $script:generatedVerifiedBuffer = $null
      $failure = ''
      $timer = [Diagnostics.Stopwatch]::StartNew()
      try { $downloaded = Test-ExactVersionGrant $access '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a' }
      catch { $failure = $_.Exception.Message }
      Assert-GeneratedExportCondition (($failure -eq '') -eq $case.Accept) 'The generated export stream had an unexpected outcome.'
      Assert-GeneratedExportCondition ($script:generatedVerificationCalls -eq $case.Verify) 'The export stream bypassed verification or verified refused bytes.'
      Assert-GeneratedExportCondition ($script:generatedDownloadHandler.Closed) 'The generated download client was not disposed.'
      if ($case.Mode -cne 'headers-stall') {
        Assert-GeneratedExportCondition ($script:generatedDownloadHandler.Response.Closed -and $script:generatedDownloadHandler.Stream.Closed) 'The generated response/body stream was not disposed.'
      }
      if (-not $case.Accept) {
        Assert-GeneratedExportCondition ($failure -ceq 'The exact-version generated-synthetic export download or verification failed.') 'A private download failure escaped the fixed error.'
      }
      if ($case.Mode -in @('headers-stall', 'body-stall')) {
        Assert-GeneratedExportCondition ($timer.ElapsedMilliseconds -lt 3000) 'The header/body deadline did not bound an abort-ignoring task.'
      }
      if ($case.Accept) {
        Assert-GeneratedExportCondition ($downloaded.DownloadBytes -eq 2 -and $downloaded.ExportCoverage.consentCount -eq 0) 'The generated export result fabricated coverage.'
        Assert-GeneratedExportCondition (@($script:generatedVerifiedBuffer | Where-Object { $_ -ne 0 }).Count -eq 0) 'The verified artifact buffer was not cleared.'
      }
    }

    # Actual lifecycle ordering: unavailable verifier fails before all writes; rejected bytes
    # may follow the two idempotent export POSTs but never grant waiting or a deletion request.
    function Assert-SyntheticRefreshPrerequisites { return $true }
    function Invoke-CandidateApi {
      param([string]$Method, [string]$Path)
      $script:generatedLifecyclePaths.Add($Path)
      if ($Method -cne 'POST' -or $Path -cne '/me/data-exports') { throw 'generated-unexpected-write' }
      return [pscustomobject]@{ Body = [pscustomobject]@{ id = '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a'; policyVersion = 'd1-synthetic-v1' } }
    }
    function Wait-ExportReady { return $access }
    function Wait-GrantExpiry { throw 'generated-unexpected-grant-wait' }
    $lifecycleBoundary = [pscustomobject]@{ Runtime = [pscustomobject]@{}; Identity = [pscustomobject]@{ Token = 'generated-access'; IdToken = 'generated-id' } }
    foreach ($readinessFailure in @($true, $false)) {
      $script:generatedReadinessFailure = $readinessFailure
      $script:generatedVerificationFailure = $true
      $script:generatedVerificationCalls = 0
      $script:generatedLifecyclePaths = [Collections.Generic.List[string]]::new()
      $script:generatedDownloadHandler = [GeneratedRightsExportHandler]::new([Text.Encoding]::UTF8.GetBytes('{}'), 'success')
      $failure = ''
      try { $null = Invoke-FixedLifecycle $lifecycleBoundary $plan }
      catch { $failure = $_.Exception.Message }
      $expectedCalls = if ($readinessFailure) { 0 } else { 2 }
      $expectedFailure = if ($readinessFailure) { 'generated-verifier-unavailable' } else { 'The exact-version generated-synthetic export download or verification failed.' }
      Assert-GeneratedExportCondition ($script:generatedLifecyclePaths.Count -eq $expectedCalls) 'Verifier refusal allowed an unexpected candidate write.'
      Assert-GeneratedExportCondition ($failure -ceq $expectedFailure) 'The lifecycle continued after a verifier refusal.'
    }
  }
  finally {
    $exportDownloadTimeoutMilliseconds = $originalDownloadTimeout
    Set-Item -LiteralPath Function:New-CandidateExportHttpClient -Value $originalDownloadClientFunction
    Set-Item -LiteralPath Function:Invoke-CandidateRightsExportHelper -Value $originalHelperFunction
    Set-Item -LiteralPath Function:Invoke-CandidateApi -Value $originalCandidateApiFunction
    Set-Item -LiteralPath Function:Assert-SyntheticRefreshPrerequisites -Value $originalRefreshAssertionFunction
    Set-Item -LiteralPath Function:Wait-ExportReady -Value $originalExportWaitFunction
    Set-Item -LiteralPath Function:Wait-GrantExpiry -Value $originalGrantWaitFunction
  }

  $nativeReady = Invoke-CandidateRightsExportHelper -CheckReady
  Assert-GeneratedExportCondition ($nativeReady.ready -eq $true) 'The actual installed Node/source-schema readiness check failed.'
  $generatedExport = [ordered]@{
    schemaVersion = 1; format = 'candidate-data-export-v1'
    exportId = '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a'; policyVersion = 'd2-development-synthetic-v1'
    generatedAt = $now.ToString('o')
    candidate = @{ createdAt = $now.ToString('o'); connectedAccounts = @() }
    profile = @{ preferences = $null; facts = @(); contributionConsents = @() }
    documents = @{ resumes = @() }
    jobs = @{ reports = @(); contributions = @() }
    matching = @{ savedJobs = @(); privateSavedPageCaptures = @() }
    billing = @{ entitlement = @{ plan = 'free'; version = 0; effectiveAt = $now.ToString('o') } }
    trust = @{ schemaVersion = 1; cases = @(); caseEvents = @(); contributorReputationEvidence = @() }
    audit = @{ events = @() }
  }
  $generatedExportBytes = [Text.Encoding]::UTF8.GetBytes(($generatedExport | ConvertTo-Json -Depth 15 -Compress))
  $nativeCoverage = Invoke-CandidateRightsExportHelper -ExpectedExportId $generatedExport.exportId -ExpectedPolicyVersion $generatedExport.policyVersion -Artifact $generatedExportBytes
  Assert-GeneratedExportCondition ($nativeCoverage.valid -eq $true -and $nativeCoverage.contributionCount -eq 0) 'The actual UTF-8 stdin round-trip rejected a valid generated empty D2 export.'
  foreach ($binding in @(
      @{ Id = '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92b'; Policy = $generatedExport.policyVersion },
      @{ Id = $generatedExport.exportId; Policy = 'different-generated-policy' }
    )) {
    $rejected = $false
    try { $null = Invoke-CandidateRightsExportHelper -ExpectedExportId $binding.Id -ExpectedPolicyVersion $binding.Policy -Artifact $generatedExportBytes }
    catch { $rejected = $_.Exception.Message -ceq 'The generated-synthetic export verifier is unavailable or rejected the bounded artifact.' }
    Assert-GeneratedExportCondition $rejected 'The actual stdin-only verifier accepted changed export/policy binding.'
  }
  [Array]::Clear($generatedExportBytes, 0, $generatedExportBytes.Length)
  $rejected = $false
  try {
    $null = Invoke-CandidateRightsExportHelper -ExpectedExportId '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a' -ExpectedPolicyVersion 'd1-synthetic-v1' -Artifact ([Text.Encoding]::UTF8.GetBytes('{}'))
  }
  catch { $rejected = $_.Exception.Message -ceq 'The generated-synthetic export verifier is unavailable or rejected the bounded artifact.' }
  Assert-GeneratedExportCondition $rejected 'The actual stdin-only verifier accepted a schema-invalid export.'

  # Generated child processes prove bounded stdin, output, stderr and exit cleanup. They read no
  # configuration or credentials and never make network requests. Each has one new private slot.
  $actualRepositoryRoot = $repositoryRoot
  $originalHelperTimeout = $exportHelperTimeoutMilliseconds
  try {
    foreach ($case in @(
        @{ Name = 'oversize-output'; Code = "process.stdout.write('x'.repeat(8193));"; Artifact = $false; Slow = $false },
        @{ Name = 'stderr'; Code = "process.stderr.write('generated-private-canary'); process.stdout.write(JSON.stringify({ready:true}));"; Artifact = $false; Slow = $false },
        @{ Name = 'malformed-output'; Code = "process.stdout.write(JSON.stringify({ready:true,extra:0}));"; Artifact = $false; Slow = $false },
        @{ Name = 'nonzero-exit'; Code = "process.stdout.write(JSON.stringify({ready:true})); process.exitCode=1;"; Artifact = $false; Slow = $false },
        @{ Name = 'never-exits'; Code = "process.stdout.write(JSON.stringify({ready:true})); setTimeout(()=>{},60000);"; Artifact = $false; Slow = $true },
        @{ Name = 'never-reads-input'; Code = "setTimeout(()=>{},60000);"; Artifact = $true; Slow = $true }
      )) {
      $generatedRoot = Join-Path $temporary $case.Name
      $generatedLibrary = Join-Path $generatedRoot 'scripts/lib'
      $null = New-Item -ItemType Directory -Path $generatedLibrary -Force
      $generatedScript = Join-Path $generatedLibrary 'candidate-rights-export.mjs'
      $childPidPath = Join-Path $generatedLibrary 'generated-child.pid'
      $generatedSource = "import fs from 'node:fs'; fs.writeFileSync(new URL('./generated-child.pid',import.meta.url),String(process.pid),{flag:'wx'}); " + $case.Code
      [IO.File]::WriteAllText($generatedScript, $generatedSource, $utf8WithoutBom)
      $repositoryRoot = $generatedRoot
      $exportHelperTimeoutMilliseconds = if ($case.Slow) { 1500 } else { 10000 }
      $timer = [Diagnostics.Stopwatch]::StartNew()
      $failure = ''
      try {
        if ($case.Artifact) {
          $null = Invoke-CandidateRightsExportHelper -ExpectedExportId '018f0f6d-7b51-7c2e-8a91-1c4f35e1b92a' -ExpectedPolicyVersion 'd2-development-synthetic-v1' -Artifact (New-Object byte[] 1048576)
        }
        else { $null = Invoke-CandidateRightsExportHelper -CheckReady }
      }
      catch { $failure = $_.Exception.Message }
      Assert-GeneratedExportCondition ($failure -ceq 'The generated-synthetic export verifier is unavailable or rejected the bounded artifact.') 'A generated child failure leaked output or was accepted.'
      Assert-GeneratedExportCondition (Test-Path -LiteralPath $childPidPath -PathType Leaf) 'The generated child control did not actually start.'
      $generatedProcessId = [int](Get-Content -LiteralPath $childPidPath -Raw)
      $remainingChild = Get-Process -Id $generatedProcessId -ErrorAction SilentlyContinue
      Assert-GeneratedExportCondition ($null -eq $remainingChild) 'A generated verifier child remained running after refusal.'
      if ($case.Slow) {
        Assert-GeneratedExportCondition ($timer.ElapsedMilliseconds -lt 7000) 'The whole child deadline failed to bound a stalled pipe or process.'
      }
    }
  }
  finally {
    $repositoryRoot = $actualRepositoryRoot
    $exportHelperTimeoutMilliseconds = $originalHelperTimeout
  }

  $replayPath = Join-Path $temporary 'replay.json'
  $validReplay = [ordered]@{
    schemaVersion = 1; kind = 'development-candidate-deletion-recovery-replay'; environment = 'development'; sourceSha = ('a' * 40); policySha256 = ('b' * 64)
    restoredDatabaseClass = 'disposable-quiesced-generated-synthetic'; markersValidated = 2; restoredUsersAbsent = 1; restoredUsersReconciled = 1
    primaryDatabaseRejected = $true; trafficEnabled = $false; cleanupSucceeded = $true; completedAt = $now.ToString('o')
  }
  [IO.File]::WriteAllText($replayPath, ($validReplay | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $script:RecoveryReplayReceiptPath = $replayPath
  $script:ReviewedRecoveryReplayReceiptSha256 = Get-FileSha256 $replayPath
  $acceptedReplay = Read-RecoveryReplayReceipt
  if ($acceptedReplay.markersValidated -ne 2) { throw 'The exact aggregate replay receipt was not accepted.' }
  foreach ($name in @('trafficEnabled','cleanupSucceeded','primaryDatabaseRejected')) {
    $tampered = $validReplay | ConvertTo-Json | ConvertFrom-Json
    $tampered.$name = if ($name -ceq 'trafficEnabled') { $true } else { $false }
    [IO.File]::WriteAllText($replayPath, ($tampered | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $script:ReviewedRecoveryReplayReceiptSha256 = Get-FileSha256 $replayPath
    $rejected = $false
    try { $null = Read-RecoveryReplayReceipt } catch { $rejected = $true }
    if (-not $rejected) { throw "Recovery replay accepted unsafe $name." }
  }
}
finally {
  Remove-Item Env:CANDIDATE_RIGHTS_OPERATOR_TEST_ONLY -ErrorAction SilentlyContinue
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_ID_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_REFRESH_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_CLIENT_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $temporary) {
    $cleanupTarget = Get-Item -LiteralPath $temporary -Force
    $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $cleanupTarget.PSIsContainer -or
        $cleanupTarget.Name -cnotmatch '^candidate-rights-operator-tests-[a-f0-9]{32}$' -or
        -not [string]::Equals($cleanupTarget.Parent.FullName, $expectedParent, [StringComparison]::OrdinalIgnoreCase) -or
        ($cleanupTarget.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Generated operator test cleanup target is outside its exact temporary scope.'
    }
    Remove-Item -LiteralPath $cleanupTarget.FullName -Recurse -Force
  }
}

Write-Output "development-candidate-rights-acceptance-operator tests passed (refresh prerequisite assertions: $refreshPrerequisiteAssertions; export verification assertions: $exportVerificationAssertions)"
