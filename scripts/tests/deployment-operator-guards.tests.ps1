Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")

$passed = 0

function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Message)
  if ([string]$Actual -cne [string]$Expected) { throw $Message }
  $script:passed++
}

function Assert-Throws {
  param([scriptblock]$Operation, [string]$Message)
  try { & $Operation; throw $Message }
  catch {
    if ($_.Exception.Message -ceq $Message) { throw }
  }
  $script:passed++
}

$before = @{
  Version = "2012-10-17"
  Statement = @(
    @{ Sid = "Existing"; Effect = "Allow"; Action = @("s3:GetObject", "s3:ListBucket"); Resource = "*" }
  )
}
$expected = @{
  Sid = "AssumeOwnedDocumentObjectAccessRole"
  Effect = "Allow"
  Action = @("sts:AssumeRole")
  Resource = "arn:aws:iam::123456789012:role/ai-job-apply-development-document-object-access"
}
$after = @{
  Statement = @(
    @{ Resource = "*"; Action = @("s3:ListBucket", "s3:GetObject"); Effect = "Allow"; Sid = "Existing" },
    $expected
  )
  Version = "2012-10-17"
}

$delta = Assert-SingleAddedIamStatement -BeforePolicy $before -AfterPolicy $after -ExpectedStatement $expected
Assert-Equal $delta.AddedSid $expected.Sid "The approved statement was not recognized."

$modifiedAfter = $after | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$modifiedAfter.Statement[0].Effect = "Deny"
Assert-Throws { Assert-SingleAddedIamStatement -BeforePolicy $before -AfterPolicy $modifiedAfter -ExpectedStatement $expected } `
  "A modified existing IAM statement was accepted."

$overbroadAfter = $after | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$overbroadAfter.Statement[1].Resource = "*"
Assert-Throws { Assert-SingleAddedIamStatement -BeforePolicy $before -AfterPolicy $overbroadAfter -ExpectedStatement $expected } `
  "An overbroad added IAM statement was accepted."

$exactAdded = @{
  Sid = "OperateCandidateDataExportObjects"
  Effect = "Allow"
  Action = @("s3:GetObjectVersion", "s3:PutObject")
  Resource = "arn:aws:s3:::candidate-exports/candidate-data-exports/*"
}
$exactBeforeModified = @{
  Sid = "ConfigureCandidateDocumentBucketEvents"
  Effect = "Allow"
  Action = @("s3:ListBucket")
  Resource = "arn:aws:s3:::candidate-docs"
}
$exactAfterModified = @{
  Sid = "ConfigureCandidateDocumentBucketEvents"
  Effect = "Allow"
  Action = @("s3:ListBucket", "s3:ListBucketVersions")
  Resource = "arn:aws:s3:::candidate-docs"
}
$exactBefore = @{
  Version = "2012-10-17"
  Statement = @($before.Statement[0], $exactBeforeModified)
}
$exactAfter = @{
  Version = "2012-10-17"
  Statement = @($before.Statement[0], $exactAfterModified, $exactAdded)
}
$exactDelta = Assert-ExactIamStatementDelta -BeforePolicy $exactBefore -AfterPolicy $exactAfter `
  -AddedStatements @($exactAdded) -ModifiedStatements @(@{ Before = $exactBeforeModified; After = $exactAfterModified })
Assert-Equal $exactDelta.AddedSids $exactAdded.Sid "The exact added IAM statement was not recognized."
Assert-Equal $exactDelta.ModifiedSids $exactAfterModified.Sid "The exact modified IAM statement was not recognized."

$modifiedOnlyBefore = @{ Version = "2012-10-17"; Statement = @($exactBeforeModified) }
$modifiedOnlyAfter = @{ Version = "2012-10-17"; Statement = @($exactAfterModified) }
$modifiedOnlyDelta = Assert-ExactIamStatementDelta -BeforePolicy $modifiedOnlyBefore `
  -AfterPolicy $modifiedOnlyAfter -AddedStatements @() `
  -ModifiedStatements @(@{ Before = $exactBeforeModified; After = $exactAfterModified })
Assert-Equal $modifiedOnlyDelta.AddedSids "" "A modified-only IAM delta reported an added statement."
Assert-Equal $modifiedOnlyDelta.ModifiedSids $exactAfterModified.Sid `
  "A modified-only IAM delta was not recognized."

$unexpectedExactAfter = $exactAfter | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$unexpectedExactAfter.Statement[0].Resource = "arn:aws:s3:::unexpected"
Assert-Throws { Assert-ExactIamStatementDelta -BeforePolicy $exactBefore -AfterPolicy $unexpectedExactAfter `
    -AddedStatements @($exactAdded) -ModifiedStatements @(@{ Before = $exactBeforeModified; After = $exactAfterModified }) } `
  "An unapproved existing statement change was accepted by the exact-delta guard."

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-job-apply-operator-guards-$([guid]::NewGuid())"
try {
  $null = New-Item -ItemType Directory -Path $testRoot
  $inside = Resolve-DeploymentPlanPath -Candidate "reviewed.tfplan" -AllowedRoot $testRoot
  Assert-Equal $inside (Join-Path $testRoot "reviewed.tfplan") "A valid plan path was not resolved."
  Assert-Throws { Resolve-DeploymentPlanPath -Candidate "..\escaped.tfplan" -AllowedRoot $testRoot } `
    "A path outside the operator plan root was accepted."
}
finally {
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

$metadata = [pscustomobject]@{
  Environment = "development"
  PlanSha256 = "abc"
}
Assert-ReviewedPlanMetadata -Metadata $metadata -Expected @{ Environment = "development"; PlanSha256 = "abc" }
$passed++
Assert-Throws { Assert-ReviewedPlanMetadata -Metadata $metadata -Expected @{ Environment = "staging" } } `
  "Mismatched reviewed metadata was accepted."

Write-Output "Deployment operator guard tests passed: $passed"
