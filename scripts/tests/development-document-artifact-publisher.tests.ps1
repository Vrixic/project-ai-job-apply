$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$publisherPath = Join-Path $repositoryRoot "scripts\publish-development-document-lambdas.ps1"
$source = Get-Content -LiteralPath $publisherPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The development document artifact publisher did not parse." }

foreach ($functionName in @(
    "Get-OptionalProperty",
    "Resolve-OperatorPath",
    "Get-FileSha256",
    "Get-FileBase64Sha256",
    "Get-KeyHistoryMatches",
    "Assert-ChecksumCompanion",
    "Assert-CanonicalReceiptMatrix"
  )) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$digest = "a" * 64
if (-not (Assert-ChecksumCompanion -Text "$digest  document-processor-lambda.zip`n" `
      -ExpectedDigest $digest -ExpectedFileName "document-processor-lambda.zip")) {
  throw "The canonical checksum companion was not accepted."
}
foreach ($invalid in @(
    [pscustomobject]@{ Text = "$("b" * 64)  document-processor-lambda.zip`n"; File = "document-processor-lambda.zip" },
    [pscustomobject]@{ Text = "$digest  document-parser-lambda.zip`n"; File = "document-processor-lambda.zip" },
    [pscustomobject]@{ Text = "$digest document-processor-lambda.zip`n"; File = "document-processor-lambda.zip" }
  )) {
  $rejected = $false
  try {
    $null = Assert-ChecksumCompanion -Text $invalid.Text `
      -ExpectedDigest $digest -ExpectedFileName $invalid.File
  } catch { $rejected = $true }
if (-not $rejected) { throw "A malformed checksum companion was accepted." }
}

$canonicalArtifacts = @()
foreach ($name in @("document-processor-lambda", "document-parser-lambda")) {
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $canonicalArtifacts += [pscustomobject]@{
      artifactName   = $name
      artifactSha256 = $digest
      suffix         = $suffix
    }
  }
}
if (-not (Assert-CanonicalReceiptMatrix -Artifacts $canonicalArtifacts `
      -ExpectedArtifactNames @("document-processor-lambda", "document-parser-lambda"))) {
  throw "The canonical eight-object receipt matrix was not accepted."
}
$twoRejected = $false
try {
  $null = Assert-CanonicalReceiptMatrix -Artifacts @($canonicalArtifacts[0], $canonicalArtifacts[4]) `
    -ExpectedArtifactNames @("document-processor-lambda", "document-parser-lambda")
} catch { $twoRejected = $true }
if (-not $twoRejected) { throw "A two-record receipt was accepted." }
$missingMatrix = @($canonicalArtifacts | Select-Object -First 7)
$missingMatrix += [pscustomobject]@{
  artifactName   = "document-parser-lambda"
  artifactSha256 = $digest
  suffix         = "zip"
}
$matrixRejected = $false
try {
  $null = Assert-CanonicalReceiptMatrix -Artifacts $missingMatrix `
    -ExpectedArtifactNames @("document-processor-lambda", "document-parser-lambda")
} catch { $matrixRejected = $true }
if (-not $matrixRejected) { throw "A receipt with a missing companion matrix was accepted." }

if (@(Get-KeyHistoryMatches -Result ([pscustomobject]@{}) -Key "exact/key").Count -ne 0) {
  throw "Omitted S3 version-history arrays were not treated as empty."
}
if (@(Get-KeyHistoryMatches -Result ([pscustomobject]@{ Versions = @(); DeleteMarkers = @() }) -Key "exact/key").Count -ne 0) {
  throw "Empty S3 version-history arrays were not treated as empty."
}
$versionHistory = [pscustomobject]@{
  Versions      = @([pscustomobject]@{ Key = "exact/key" })
  DeleteMarkers = @([pscustomobject]@{ Key = "other/key" })
}
if (@(Get-KeyHistoryMatches -Result $versionHistory -Key "exact/key").Count -ne 1) {
  throw "An existing exact object version was not detected."
}
$deleteHistory = [pscustomobject]@{
  DeleteMarkers = @([pscustomobject]@{ Key = "exact/key" })
}
if (@(Get-KeyHistoryMatches -Result $deleteHistory -Key "exact/key").Count -ne 1) {
  throw "An existing exact delete marker was not detected."
}

$terraformDirectory = [IO.Path]::GetFullPath((
    Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
  ))
$terraformRoot = [IO.Path]::GetFullPath((Join-Path $terraformDirectory ".terraform"))
$operatorRoot = Join-Path $terraformRoot "development-document-artifacts"
$expected = [IO.Path]::GetFullPath((Join-Path $operatorRoot "receipt-test.json"))
if ((Resolve-OperatorPath -Candidate ".terraform\development-document-artifacts\receipt-test.json") -cne $expected) {
  throw "The publisher did not resolve a relative receipt inside its ignored root."
}
if ((Resolve-OperatorPath -Candidate $expected) -cne $expected) {
  throw "The publisher did not preserve an absolute receipt inside its ignored root."
}
$traversalRejected = $false
try { $null = Resolve-OperatorPath -Candidate "..\outside.json" } catch { $traversalRejected = $true }
if (-not $traversalRejected) { throw "The publisher accepted a path outside its ignored root." }

$temporary = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($temporary, "abc", [Text.UTF8Encoding]::new($false))
  if ((Get-FileSha256 -Path $temporary) -cne "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
    throw "Hexadecimal file SHA-256 is incorrect."
  }
  if ((Get-FileBase64Sha256 -Path $temporary) -cne "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=") {
    throw "Base64 file SHA-256 is incorrect."
  }
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

foreach ($required in @(
    'ValidateSet("Status", "Publish", "Verify")',
    'pnpm --filter @ai-job-apply/documents-service test',
    'pnpm audit:dependencies',
    'First $artifactLabel Lambda build',
    'Second $artifactLabel Lambda build',
    '"--if-none-match", "*"',
    '"--checksum-mode", "ENABLED"',
    '"development-document-lambda-publication"',
    '@($receipt.artifacts).Count -ne $expectedObjectCount',
    'boundarySha256 = Get-TextSha256',
    'LambdaDeploymentChanged = $false',
    'TriggerChanged          = $false'
  )) {
  if (-not $source.Contains($required)) { throw "Publisher guard is missing: $required" }
}

if ($source.Contains('@($receipt.artifacts).Count -ne 2')) {
  throw "The publisher still accepts the obsolete two-entry receipt shape."
}

Write-Host "Development document artifact publisher pure guard tests passed."

$privateNames = @("cover-letter-provider-control-lambda", "cover-letter-response-capture-lambda", "cover-letter-cleanup-lambda", "cover-letter-response-disposal-lambda")
$privateMatrix = @()
foreach ($privateName in $privateNames) {
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $privateMatrix += [pscustomobject]@{ artifactName = $privateName; artifactSha256 = $digest; suffix = $suffix }
  }
}
if (-not (Assert-CanonicalReceiptMatrix -Artifacts $privateMatrix -ExpectedArtifactNames $privateNames)) {
  throw "The canonical sixteen-object private receipt was refused."
}
foreach ($invalidPrivateMatrix in @(
    [pscustomobject]@{ Entries = $canonicalArtifacts },
    [pscustomobject]@{ Entries = @($privateMatrix | Select-Object -First 12) },
    [pscustomobject]@{ Entries = @($privateMatrix | Select-Object -First 15) },
    [pscustomobject]@{ Entries = @($privateMatrix[0]) + @($privateMatrix | Select-Object -Skip 1 -First 14) + @($privateMatrix[0]) },
    [pscustomobject]@{ Entries = @($privateMatrix) + @($canonicalArtifacts) }
  )) {
  $refused = $false
  try { $null = Assert-CanonicalReceiptMatrix -Artifacts $invalidPrivateMatrix.Entries -ExpectedArtifactNames $privateNames }
  catch { $refused = $true }
  if (-not $refused) { throw "A mixed, incomplete or duplicated private receipt was accepted." }
}

# Execute only the family-selection assignments, never the live operator entrypoint.
$configurationAssignments = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -in @('$isCoreWorkflow', '$isIngestion', '$isPublicJob', '$isApplicationsRecovery',
      '$isPrivateDocumentControls', '$isNativeResume', '$isPrivilegedAuditRetention', '$operatorDirectoryName', '$artifactDirectory', '$artifactNames',
      '$artifactKeyRoot', '$receiptKind', '$artifactLabel', '$expectedObjectCount')
  }, $false) | Sort-Object { $_.Extent.StartOffset })
if ($configurationAssignments.Count -ne 14) { throw "Unexpected publication family-selection inventory." }
$resumeNames = @("native-resume-owner-rpc-lambda", "native-resume-source-rpc-lambda", "native-resume-preparation-control-lambda", "native-resume-preparation-durable-lambda", "native-resume-request-dispatch-lambda", "native-resume-task-observer-lambda")
foreach ($family in @("Document", "PrivateDocumentControls", "privatedocumentcontrols", "PRIVATEDOCUMENTCONTROLS", "NativeResume", "nativeresume", "NATIVERESUME", "PrivilegedAuditRetention", "privilegedauditretention", "PRIVILEGEDAUDITRETENTION")) {
  $ArtifactFamily = $family
  foreach ($assignment in $configurationAssignments) { Invoke-Expression $assignment.Extent.Text }
  if ($family -eq "PrivateDocumentControls") {
    if (($artifactNames -join ',') -cne ($privateNames -join ',') -or $expectedObjectCount -ne 16 -or
        $receiptKind -cne "development-private-document-controls-lambda-publication" -or
        $artifactKeyRoot -cne "lambda/documents/private-controls" -or
        $operatorDirectoryName -cne "development-private-document-control-artifacts" -or
        $artifactDirectory -cne (Join-Path $repositoryRoot 'backend/services/documents/dist/private-control-lambda')) {
      throw "Private artifact family escaped its exact dedicated boundary."
    }
  } elseif ($family -eq "NativeResume") {
    if (($artifactNames -join ',') -cne ($resumeNames -join ',') -or $expectedObjectCount -ne 24 -or
        $receiptKind -cne "development-native-resume-lambda-publication" -or
        $artifactKeyRoot -cne "lambda/documents/native-resume" -or
        $operatorDirectoryName -cne "development-native-resume-artifacts" -or
        $artifactDirectory -cne (Join-Path $repositoryRoot 'backend/workflows/dist/native-resume-lambda')) {
      throw "Native resume family escaped its exact dedicated boundary."
    }
  } elseif ($family -eq "PrivilegedAuditRetention") {
    if (($artifactNames -join ',') -cne 'privileged-moderation-audit-retention-lambda' -or $expectedObjectCount -ne 4 -or
        $receiptKind -cne 'development-privileged-audit-retention-lambda-publication' -or
        $artifactKeyRoot -cne 'lambda/profile/audit-retention' -or
        $operatorDirectoryName -cne 'development-privileged-audit-retention-artifacts' -or
        $artifactDirectory -cne (Join-Path $repositoryRoot 'backend/services/profile/dist/audit-retention-lambda')) {
      throw "Audit retention family escaped its dedicated boundary."
    }
  } elseif (($artifactNames -join ',') -cne 'document-processor-lambda,document-parser-lambda' -or
      $expectedObjectCount -ne 8 -or $receiptKind -cne 'development-document-lambda-publication') {
    throw "Existing document publication family changed."
  }
}
Write-Host "Private control family and receipt-isolation regressions passed; no cloud calls."
& node --test (Join-Path $repositoryRoot 'scripts/tests/private-document-artifacts.test.mjs')
if ($LASTEXITCODE -ne 0) { throw "Private artifact smoke regressions failed." }

$resumeMatrix = @()
foreach ($name in $resumeNames) {
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $resumeMatrix += [pscustomobject]@{ artifactName = $name; artifactSha256 = $digest; suffix = $suffix }
  }
}
if (-not (Assert-CanonicalReceiptMatrix -Artifacts $resumeMatrix -ExpectedArtifactNames $resumeNames)) {
  throw "Complete native resume receipt was refused."
}
foreach ($invalid in @(
    [pscustomobject]@{ Entries = $canonicalArtifacts },
    [pscustomobject]@{ Entries = $privateMatrix },
    [pscustomobject]@{ Entries = @($resumeMatrix | Where-Object artifactName -ne "native-resume-task-observer-lambda") },
    [pscustomobject]@{ Entries = @($resumeMatrix | Select-Object -First 23) },
    [pscustomobject]@{ Entries = @($resumeMatrix | Select-Object -First 23) + @($resumeMatrix[0]) },
    [pscustomobject]@{ Entries = @($resumeMatrix) + @($privateMatrix) }
  )) {
  $refused = $false
  try { $null = Assert-CanonicalReceiptMatrix -Artifacts $invalid.Entries -ExpectedArtifactNames $resumeNames }
  catch { $refused = $true }
  if (-not $refused) { throw "Mixed, duplicate or incomplete native resume receipt was accepted." }
}
Write-Host "Native resume family and twenty-four-object receipt guards passed; no cloud calls."

$auditNames = @('privileged-moderation-audit-retention-lambda')
$auditMatrix = @('zip', 'cdx.json', 'manifest.json', 'sha256') | ForEach-Object {
  [pscustomobject]@{ artifactName = $auditNames[0]; artifactSha256 = $digest; suffix = $_ }
}
if (-not (Assert-CanonicalReceiptMatrix -Artifacts $auditMatrix -ExpectedArtifactNames $auditNames)) { throw 'Audit receipt refused.' }
foreach ($invalid in @(
  [pscustomobject]@{ Entries = @($auditMatrix | Select-Object -First 3) },
  [pscustomobject]@{ Entries = @($auditMatrix | Select-Object -First 3) + @($auditMatrix[0]) },
  [pscustomobject]@{ Entries = @($auditMatrix) + @($resumeMatrix) },
  [pscustomobject]@{ Entries = $canonicalArtifacts }
)) {
  $refused = $false
  try { $null = Assert-CanonicalReceiptMatrix -Artifacts $invalid.Entries -ExpectedArtifactNames $auditNames }
  catch { $refused = $true }
  if (-not $refused) { throw 'Mixed, incomplete or duplicate audit receipt accepted.' }
}
Write-Host 'Audit retention family and four-object receipt guards passed; no cloud calls.'
