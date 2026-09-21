Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$passed = 0
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function Assert-Contains {
  param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][string]$Needle, [Parameter(Mandatory)][string]$Message)
  if (-not $Text.Contains($Needle)) { throw $Message }
  $script:passed++
}

# ---- the source pins the exact change set (ADR-034)
$operator = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\operate-bootstrap-workload-boundary.ps1") -Raw
$terraform = Get-Content -LiteralPath (Join-Path $repositoryRoot "infrastructure\terraform\bootstrap\main.tf") -Raw
foreach ($needle in @(
    '$changeSet = "candidate-documents-version-delete-v1"',
    'Sid = "PurgeDeletedCandidateDocumentVersions"; Effect = "Allow"; Action = @("s3:DeleteObjectVersion")',
    'Resource = "$candidateDocumentBucketArn/*"',
    'Condition = [pscustomobject]@{ ArnEquals = [pscustomobject]@{ "aws:PrincipalArn" = $activityRoleArn } }',
    '$activityRoleArn = "arn:aws:iam::${ExpectedAccountId}:role/ai-job-apply-$Environment-profile-readiness-activity"',
    '$expectedModifiedStatements = @()',
    '$requiredStatements = @($requiredRetainedStatements) + @($expectedAddedStatements)'
  )) {
  Assert-Contains $operator $needle "The boundary operator does not pin: $needle"
}
foreach ($needle in @(
    'Sid      = "PurgeDeletedCandidateDocumentVersions"',
    'Action   = ["s3:DeleteObjectVersion"]',
    'Resource = "${local.candidate_document_bucket_arn}/*"',
    '"aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-profile-readiness-activity"'
  )) {
  Assert-Contains $terraform $needle "The bootstrap boundary does not contain: $needle"
}
# the previous change set no longer expects a modification, and nothing in the operator indexes an empty modified list
if ($operator.Contains('$expectedModifiedStatements[0]')) { throw "The operator still indexes a modified statement." }
$passed++

# ---- the exact delta guard accepts this statement and refuses every variant
$account = "111122223333"; $environment = "development"
$documents = "arn:aws:s3:::ai-job-apply-$environment-candidate-docs-*"
$role = "arn:aws:iam::${account}:role/ai-job-apply-$environment-profile-readiness-activity"
$retained = @(
  [pscustomobject]@{ Sid = "ConfigureCandidateDocumentBucketEvents"; Effect = "Allow"; Action = @("s3:GetBucketNotification", "s3:ListBucket", "s3:ListBucketVersions", "s3:PutBucketNotification"); Resource = $documents },
  [pscustomobject]@{ Sid = "ScanCandidateDocumentObjects"; Effect = "Allow"; Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"); Resource = "$documents/*" },
  [pscustomobject]@{ Sid = "OperateCandidateDataExportObjects"; Effect = "Allow"; Action = @("s3:DeleteObjectVersion", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"); Resource = "arn:aws:s3:::ai-job-apply-$environment-candidate-exports-*/candidate-data-exports/*" }
)
function New-Added {
  param([hashtable]$Override = @{})
  $statement = [ordered]@{
    Sid = "PurgeDeletedCandidateDocumentVersions"; Effect = "Allow"; Action = @("s3:DeleteObjectVersion"); Resource = "$documents/*"
    Condition = [ordered]@{ ArnEquals = [ordered]@{ "aws:PrincipalArn" = $role } }
  }
  foreach ($key in $Override.Keys) { $statement[$key] = $Override[$key] }
  return [pscustomobject]($statement | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
}
function New-Policy { param([object[]]$Statements) return ([ordered]@{ Version = "2012-10-17"; Statement = @($Statements) } | ConvertTo-Json -Depth 12 -Compress) }
$expectedAdded = @(New-Added)
$before = New-Policy $retained
$null = Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy (New-Policy (@($retained) + @(New-Added))) -AddedStatements $expectedAdded -ModifiedStatements @(); $passed++

foreach ($case in @(
    @{ Name = "an extra action"; After = (New-Added @{ Action = @("s3:DeleteObjectVersion", "s3:DeleteObject") }) },
    @{ Name = "a wildcard action"; After = (New-Added @{ Action = @("s3:*") }) },
    @{ Name = "a widened resource"; After = (New-Added @{ Resource = "arn:aws:s3:::*/*" }) },
    @{ Name = "the bucket itself"; After = (New-Added @{ Resource = $documents }) },
    @{ Name = "another bucket family"; After = (New-Added @{ Resource = "arn:aws:s3:::ai-job-apply-$environment-candidate-exports-*/*" }) },
    @{ Name = "no condition"; After = ([pscustomobject]([ordered]@{ Sid = "PurgeDeletedCandidateDocumentVersions"; Effect = "Allow"; Action = @("s3:DeleteObjectVersion"); Resource = "$documents/*" } | ConvertTo-Json | ConvertFrom-Json)) },
    @{ Name = "another principal"; After = (New-Added @{ Condition = [ordered]@{ ArnEquals = [ordered]@{ "aws:PrincipalArn" = "arn:aws:iam::${account}:role/ai-job-apply-$environment-gateway-lambda" } } }) },
    @{ Name = "a wildcard principal"; After = (New-Added @{ Condition = [ordered]@{ ArnLike = [ordered]@{ "aws:PrincipalArn" = "arn:aws:iam::${account}:role/*" } } }) },
    @{ Name = "another account's role"; After = (New-Added @{ Condition = [ordered]@{ ArnEquals = [ordered]@{ "aws:PrincipalArn" = "arn:aws:iam::999999999999:role/ai-job-apply-$environment-profile-readiness-activity" } } }) },
    @{ Name = "the other environment's role"; After = (New-Added @{ Condition = [ordered]@{ ArnEquals = [ordered]@{ "aws:PrincipalArn" = "arn:aws:iam::${account}:role/ai-job-apply-staging-profile-readiness-activity" } } }) },
    @{ Name = "a deny effect"; After = (New-Added @{ Effect = "Deny" }) },
    @{ Name = "another statement name"; After = (New-Added @{ Sid = "SomethingElse" }) }
  )) {
  $after = New-Policy (@($retained) + @($case.After))
  Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy $after -AddedStatements $expectedAdded -ModifiedStatements @() } "The boundary delta with $($case.Name) was accepted."
}
Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy $before -AddedStatements $expectedAdded -ModifiedStatements @() } "A plan that adds nothing was accepted."
Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy (New-Policy (@($retained) + @(New-Added) + @([pscustomobject]@{ Sid = "Extra"; Effect = "Allow"; Action = @("s3:*"); Resource = "*" }))) -AddedStatements $expectedAdded -ModifiedStatements @() } "A second added statement was accepted."
Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy (New-Policy (@($retained | Select-Object -Skip 1) + @(New-Added))) -AddedStatements $expectedAdded -ModifiedStatements @() } "A removed retained statement was accepted."
$widenedRetained = @($retained | ForEach-Object { $_ | ConvertTo-Json -Depth 8 | ConvertFrom-Json })
$widenedRetained[1].Action = @("s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObjectVersion")
Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy $before -AfterPolicy (New-Policy (@($widenedRetained) + @(New-Added))) -AddedStatements $expectedAdded -ModifiedStatements @() } "A widened existing statement was accepted."
Assert-Rejected { Assert-ExactIamStatementDelta -BeforePolicy (New-Policy (@($retained) + @(New-Added))) -AfterPolicy (New-Policy (@($retained) + @(New-Added))) -AddedStatements $expectedAdded -ModifiedStatements @() } "An already applied statement was accepted as an addition."

Write-Host "Bootstrap workload-boundary document-delete change set tests passed: $passed assertions; generated fixtures only."
