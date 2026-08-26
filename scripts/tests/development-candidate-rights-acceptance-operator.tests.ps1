Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
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
  'ReviewedZeroDriftPlanSha256','ExecutionPlanPath','ReviewedExecutionPlanSha256','ReceiptPath',
  'ReviewedReceiptSha256','RecoveryReplayReceiptPath','ReviewedRecoveryReplayReceiptSha256','Help'
)
$actualParameters = @($ast.ParamBlock.Parameters.Name.VariablePath.UserPath)
if (($actualParameters -join '|') -cne ($expectedParameters -join '|')) { throw 'The exact public parameter surface changed.' }
if ($actualParameters -contains 'AccessToken' -or $actualParameters -contains 'Subject' -or $actualParameters -contains 'Secret') { throw 'A sensitive caller-selected parameter was added.' }

foreach ($required in @(
    'generated-synthetic-only',
    'delete_user_only',
    'identity,profile,documents,jobs,matching,billing',
    'DELETE_MY_ACCOUNT',
    'ACCOUNT_DELETION_IS_IRREVERSIBLE',
    'candidate-deletion-recovery-v1',
    'PersistentSyntheticIdentities = 0',
    'ActiveCompute = 0',
    'QueuedMessages = 0',
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
  CANDIDATE_RIGHTS_OWNER_INVENTORY = 'identity,profile,documents,jobs,matching,billing'
  CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY = 'auth0,aws'
}
if (-not (Assert-PolicyEnvironment $policyEnvironment)) { throw 'The exact policy environment was not accepted.' }

foreach ($mutation in @(
    @{ Name = 'CANDIDATE_RIGHTS_POLICY_SHA256'; Value = ('c' * 64) },
    @{ Name = 'CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS'; Value = '301' },
    @{ Name = 'CANDIDATE_RIGHTS_OWNER_INVENTORY'; Value = 'identity,profile,documents,jobs,matching' },
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
  Remove-Item Env:CANDIDATE_RIGHTS_ACCEPTANCE_IDENTITY_ATTESTATION_PATH -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $temporary) { [IO.Directory]::Delete($temporary, $true) }
}

Write-Output 'development-candidate-rights-acceptance-operator tests passed'
