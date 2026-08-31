[CmdletBinding()]
param(
  [ValidateSet("Plan", "Apply", "Verify")]
  [string]$Action = "Verify",

  [ValidateSet("development", "staging")]
  [string]$Environment = "development",

  [string]$AwsProfile = "",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId = "",

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket = "",

  [string]$Region = "us-east-2",
  [string]$GithubEnvironment = "",
  [string]$PlanPath = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPlanSha256 = "",

  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-bootstrap-workload-boundary.ps1 -Action Plan `
    -Environment development -AwsProfile ai-job-apply-development-admin `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

  .\scripts\operate-bootstrap-workload-boundary.ps1 -Action Apply `
    -Environment development -AwsProfile ai-job-apply-development-admin `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
    -PlanPath PLAN_PATH_FROM_PLAN_OUTPUT `
    -ReviewedPlanSha256 64_CHARACTER_SHA256

  .\scripts\operate-bootstrap-workload-boundary.ps1 -Action Verify `
    -Environment development -AwsProfile ai-job-apply-development-admin `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

Plan permits exactly one resource update with the candidate-rights-journal-encryption-v2 semantic
change set.
Apply accepts only the checksum-reviewed saved plan
and matching metadata. Verify requires a drift-free bootstrap and compares the live managed IAM
policy with Terraform state. Plans and metadata remain in the ignored bootstrap .terraform tree.
"@
  exit 0
}

if ([string]::IsNullOrWhiteSpace($AwsProfile) -or
  $ExpectedAccountId -notmatch "^[0-9]{12}$" -or
  [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact AWS profile, account ID, and encrypted bootstrap state bucket are required."
}
if ($Region -cne "us-east-2") { throw "Bootstrap operation is restricted to us-east-2." }
if ([string]::IsNullOrWhiteSpace($GithubEnvironment)) { $GithubEnvironment = $Environment }
if ($GithubEnvironment -cne $Environment) {
  throw "The GitHub Environment must exactly match the isolated AWS environment."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\bootstrap"
$operatorRoot = Join-Path $terraformDirectory ".terraform\bootstrap-workload-boundary\$Environment"
$terraformDataDirectory = Join-Path $terraformDirectory ".terraform\bootstrap-operator-data\$Environment"
$metadataSuffix = ".bootstrap-workload-boundary.json"
$policyName = "ai-job-apply-$Environment-workload-boundary"
$policyArn = "arn:aws:iam::${ExpectedAccountId}:policy/$policyName"
$objectAccessRoleArn = "arn:aws:iam::${ExpectedAccountId}:role/ai-job-apply-$Environment-document-object-access"
$candidateDocumentBucketArn = "arn:aws:s3:::ai-job-apply-$Environment-candidate-docs-*"
$candidateExportBucketArn = "arn:aws:s3:::ai-job-apply-$Environment-candidate-exports-*"
$candidateRecoveryBucketArn = "arn:aws:s3:::ai-job-apply-$Environment-candidate-del-recovery-*"
$requiredRetainedStatements = @(
  [pscustomobject]@{
    Sid = "AssumeOwnedDocumentObjectAccessRole"; Effect = "Allow"; Action = @("sts:AssumeRole")
    Resource = $objectAccessRoleArn
  },
  [pscustomobject]@{
    Sid = "OperateCandidateDataExportObjects"; Effect = "Allow"
    Action = @("s3:DeleteObjectVersion", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject")
    Resource = "$candidateExportBucketArn/candidate-data-exports/*"
  },
  [pscustomobject]@{
    Sid = "ListCandidateDeletionRecoveryLedger"; Effect = "Allow"; Action = @("s3:ListBucket")
    Resource = $candidateRecoveryBucketArn
  },
  [pscustomobject]@{
    Sid = "OperateCandidateDeletionRecoveryLedger"; Effect = "Allow"
    Action = @("s3:GetObject", "s3:GetObjectTagging", "s3:PutObject", "s3:PutObjectRetention", "s3:PutObjectTagging", "s3:PutObjectVersionTagging")
    Resource = "$candidateRecoveryBucketArn/candidate-deletion-recovery/*"
  },
  [pscustomobject]@{
    Sid = "ConfigureCandidateDocumentBucketEvents"; Effect = "Allow"
    Action = @("s3:GetBucketNotification", "s3:ListBucket", "s3:ListBucketVersions", "s3:PutBucketNotification")
    Resource = $candidateDocumentBucketArn
  }
)
$expectedAddedStatements = @()
$expectedModifiedStatements = @(
  [pscustomobject]@{
    Before = [pscustomobject]@{
      Sid = "DecryptTaggedRuntimeData"; Effect = "Allow"
      Action = @("kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey")
      Resource = "*"
      Condition = @{ StringEquals = @{
        "aws:ResourceTag/Project" = "ai-job-apply"
        "aws:ResourceTag/Environment" = $Environment
      } }
    }
    After = [pscustomobject]@{
      Sid = "DecryptTaggedRuntimeData"; Effect = "Allow"
      Action = @("kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey")
      Resource = "*"
      Condition = @{ StringEquals = @{
        "aws:ResourceTag/Project" = "ai-job-apply"
        "aws:ResourceTag/Environment" = $Environment
      } }
    }
  }
)
$changeSet = "candidate-rights-journal-encryption-v2"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "AWS read '$($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ')' failed. Refresh the selected SSO session and retry."
  }
  if (-not $raw) { return $null }
  try { return $raw | ConvertFrom-Json }
  catch { throw "AWS returned invalid JSON for '$($Arguments[0])'." }
}

function Assert-CallerAndTools {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
  if ([string]$identity.Account -cne $ExpectedAccountId) {
    throw "The AWS caller is not the exact $Environment account."
  }
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use a temporary IAM Identity Center session; long-lived callers are rejected."
  }

  $versionRaw = & terraform version -json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Terraform is unavailable." }
  $version = $versionRaw | ConvertFrom-Json
  if ([string]$version.terraform_version -cne "1.9.8") {
    throw "Terraform 1.9.8 is required."
  }
}

function Assert-CleanMergedMain {
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $upstream = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $upstream -or $dirty.Count -ne 0) {
    throw "Bootstrap operations require a clean main checkout exactly matching origin/main."
  }
  return $head
}

function Resolve-KmsKeyId {
  param([Parameter(Mandatory)][string]$KeyReference)

  $key = Invoke-AwsJson @("kms", "describe-key", "--key-id", $KeyReference, "--output", "json")
  if ([string]$key.KeyMetadata.Arn -notmatch "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/" -or
    [string]::IsNullOrWhiteSpace([string]$key.KeyMetadata.KeyId)) {
    throw "A state encryption key is outside the exact account and region."
  }
  return [string]$key.KeyMetadata.KeyId
}

function Initialize-BootstrapBackend {
  $location = (& aws s3api get-bucket-location --bucket $StateBucket `
      --query "LocationConstraint" --output text 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $location -cne $Region) {
    throw "The bootstrap state bucket is not in the exact approved region."
  }
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json")
  if ([string]$versioning.Status -cne "Enabled") {
    throw "The bootstrap state bucket must have versioning enabled."
  }
  $publicAccess = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json")
  $publicConfiguration = $publicAccess.PublicAccessBlockConfiguration
  if (-not [bool]$publicConfiguration.BlockPublicAcls -or
    -not [bool]$publicConfiguration.IgnorePublicAcls -or
    -not [bool]$publicConfiguration.BlockPublicPolicy -or
    -not [bool]$publicConfiguration.RestrictPublicBuckets) {
    throw "The bootstrap state bucket public-access block is incomplete."
  }

  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json")
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
      $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -and
      [bool]$_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) { throw "The state bucket must expose one KMS default with Bucket Key enabled." }
  $kmsKeyArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  $bucketKmsKeyId = Resolve-KmsKeyId -KeyReference $kmsKeyArn

  $stateHead = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket,
    "--key", "bootstrap.tfstate", "--output", "json")
  if ([string]$stateHead.ServerSideEncryption -cne "aws:kms" -or
    -not [bool]$stateHead.BucketKeyEnabled -or
    [long]$stateHead.ContentLength -le 0 -or
    [string]::IsNullOrWhiteSpace([string]$stateHead.VersionId) -or
    [string]::IsNullOrWhiteSpace([string]$stateHead.SSEKMSKeyId)) {
    throw "The remote bootstrap state object is not a nonempty, versioned, KMS-encrypted object with Bucket Key enabled."
  }
  $objectKmsKeyId = Resolve-KmsKeyId -KeyReference ([string]$stateHead.SSEKMSKeyId)
  if ($objectKmsKeyId -cne $bucketKmsKeyId) {
    throw "The remote bootstrap state object does not use the bucket's exact KMS key."
  }

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=bootstrap.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsKeyArn" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted bootstrap backend could not be initialized." }

  $stateAccount = (& terraform "-chdir=$terraformDirectory" output -raw account_id 2>$null).Trim()
  $stateBucketOutput = (& terraform "-chdir=$terraformDirectory" output -raw state_bucket 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $stateAccount -cne $ExpectedAccountId -or $stateBucketOutput -cne $StateBucket) {
    throw "The remote bootstrap state does not match the exact account and bucket."
  }
}

function Get-ChangedResources {
  param([Parameter(Mandatory)][object]$Plan)
  return @($Plan.resource_changes | Where-Object {
      (@($_.change.actions) -join ",") -ne "no-op"
    })
}

function Assert-ApprovedPlanBoundary {
  param([Parameter(Mandatory)][object]$Plan)

  $changes = Get-ChangedResources -Plan $Plan
  if ($changes.Count -ne 1) { throw "The plan must change exactly one bootstrap resource." }
  $change = $changes[0]
  if ([string]$change.address -cne "aws_iam_policy.workload_boundary" -or
    (@($change.change.actions) -join ",") -cne "update") {
    throw "Only an in-place workload-boundary policy update is approved."
  }
  if ([string]$change.change.before.name -cne $policyName -or
    [string]$change.change.after.name -cne $policyName -or
    [string]$change.change.before.arn -cne $policyArn -or
    [string]$change.change.after.arn -cne $policyArn) {
    throw "The workload-boundary identity changed."
  }

  return Assert-ExactIamStatementDelta -BeforePolicy $change.change.before.policy `
    -AfterPolicy $change.change.after.policy -AddedStatements $expectedAddedStatements `
    -ModifiedStatements $expectedModifiedStatements
}

function Read-SavedPlan {
  param([Parameter(Mandatory)][string]$ResolvedPlan)

  $raw = & terraform "-chdir=$terraformDirectory" show -json $ResolvedPlan 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    throw "The saved bootstrap plan could not be inspected."
  }
  try { return $raw | ConvertFrom-Json }
  catch { throw "The saved bootstrap plan JSON is invalid." }
}

function Assert-PolicyValidation {
  param([Parameter(Mandatory)][object]$Policy)

  $temporary = New-TemporaryFile
  try {
    [IO.File]::WriteAllText($temporary.FullName, ($Policy | ConvertTo-Json -Depth 30 -Compress))
    $validation = Invoke-AwsJson @("accessanalyzer", "validate-policy", "--policy-type", "IDENTITY_POLICY",
      "--policy-document", "file://$($temporary.FullName)", "--output", "json")
    $blockingFindings = @($validation.findings | Where-Object {
        [string]$_.findingType -in @("ERROR", "SECURITY_WARNING")
      })
    if ($blockingFindings.Count -ne 0) {
      throw "IAM Access Analyzer returned a blocking finding for the planned policy."
    }
  }
  finally {
    Remove-Item -LiteralPath $temporary.FullName -Force -ErrorAction SilentlyContinue
  }
}

function Get-TerraformStatePolicy {
  $raw = & terraform "-chdir=$terraformDirectory" show -json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    throw "The bootstrap Terraform state could not be inspected."
  }
  $state = $raw | ConvertFrom-Json
  $resources = @($state.values.root_module.resources | Where-Object {
      [string]$_.address -ceq "aws_iam_policy.workload_boundary"
    })
  if ($resources.Count -ne 1) { throw "Terraform state does not contain one workload boundary." }
  return ConvertFrom-IamPolicyValue -Policy $resources[0].values.policy
}

function Get-LivePolicy {
  $policy = Invoke-AwsJson @("iam", "get-policy", "--policy-arn", $policyArn, "--output", "json")
  if ([string]$policy.Policy.Arn -cne $policyArn -or -not [bool]$policy.Policy.IsAttachable) {
    throw "The live workload permissions boundary identity is invalid."
  }
  $version = Invoke-AwsJson @("iam", "get-policy-version", "--policy-arn", $policyArn,
    "--version-id", [string]$policy.Policy.DefaultVersionId, "--output", "json")
  return $version.PolicyVersion.Document
}

function Invoke-Verification {
  $verificationPlan = Join-Path $operatorRoot "verify-$([guid]::NewGuid().ToString('N')).tfplan"
  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      "-var=environment=$Environment" "-var=state_bucket_name=$StateBucket" `
      "-var=github_environment=$GithubEnvironment" "-out=$verificationPlan" -detailed-exitcode | Out-Null
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 1) { throw "The refresh-backed bootstrap verification plan failed." }
    if ($exitCode -eq 2) { throw "Bootstrap verification found drift or an unapplied source change." }

    $statePolicy = Get-TerraformStatePolicy
    $livePolicy = Get-LivePolicy
    $stateCanonical = ConvertTo-DeploymentCanonicalValue -Value $statePolicy -SortArrays
    $liveCanonical = ConvertTo-DeploymentCanonicalValue -Value $livePolicy -SortArrays
    if ($stateCanonical -cne $liveCanonical) {
      throw "The live workload boundary does not semantically match Terraform state."
    }
    $requiredStatements = $requiredRetainedStatements + @($expectedModifiedStatements[0].After)
    foreach ($expected in $requiredStatements) {
      $expectedCanonical = ConvertTo-DeploymentCanonicalValue -Value $expected -SortArrays
      $matches = @($livePolicy.Statement | Where-Object {
          (ConvertTo-DeploymentCanonicalValue -Value $_ -SortArrays) -ceq $expectedCanonical
        })
      if ($matches.Count -ne 1) { throw "The live policy lacks an exact required workload-boundary statement." }
    }
    Assert-PolicyValidation -Policy $livePolicy
  }
  finally {
    if (Test-Path -LiteralPath $verificationPlan) {
      Remove-Item -LiteralPath $verificationPlan -Force
    }
  }

  return [pscustomobject]@{
    Result      = "verified"
    Environment = $Environment
    Region      = $Region
    Drift       = $false
    ChangeSet   = $changeSet
  }
}

Assert-CallerAndTools
$commit = Assert-CleanMergedMain
Initialize-BootstrapBackend
$null = New-Item -ItemType Directory -Path $operatorRoot -Force

if ($Action -eq "Verify") {
  Invoke-Verification | ConvertTo-Json -Depth 5
  exit 0
}

if ($Action -eq "Plan") {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) {
    $PlanPath = Join-Path $operatorRoot "workload-boundary-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan"
  }
  $resolvedPlan = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot
  if (Test-Path -LiteralPath $resolvedPlan) { throw "Refusing to overwrite an existing saved plan." }

  try {
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      "-var=environment=$Environment" "-var=state_bucket_name=$StateBucket" `
      "-var=github_environment=$GithubEnvironment" "-out=$resolvedPlan" | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedPlan -PathType Leaf)) {
      throw "The refresh-backed bootstrap workload-boundary plan failed."
    }
    $plan = Read-SavedPlan -ResolvedPlan $resolvedPlan
    $delta = Assert-ApprovedPlanBoundary -Plan $plan
    $afterPolicy = ConvertFrom-IamPolicyValue -Policy `
      (Get-ChangedResources -Plan $plan)[0].change.after.policy
    Assert-PolicyValidation -Policy $afterPolicy
  }
  catch {
    if (Test-Path -LiteralPath $resolvedPlan) { Remove-Item -LiteralPath $resolvedPlan -Force }
    throw
  }

  $sha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadataPath = "$resolvedPlan$metadataSuffix"
  [pscustomobject]@{
    SchemaVersion = "2"
    Operation     = "bootstrap-workload-boundary"
    Environment   = $Environment
    Region        = $Region
    AccountId     = $ExpectedAccountId
    StateBucket   = $StateBucket
    Commit        = $commit
    PlanPath      = $resolvedPlan
    PlanSha256    = $sha256
    Resource      = "aws_iam_policy.workload_boundary"
    ChangeSet     = $changeSet
    AddedSids     = [string]$delta.AddedSids
    ModifiedSids  = [string]$delta.ModifiedSids
    CreatedAt     = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataPath -Encoding utf8

  [pscustomobject]@{
    Result           = "review-required"
    Environment      = $Environment
    ChangedResources = 1
    ChangeSet        = $changeSet
    AddedSids        = [string]$delta.AddedSids
    ModifiedSids     = [string]$delta.ModifiedSids
    PlanPath         = $resolvedPlan
    PlanSha256       = $sha256
    ApprovalCommand  = "Apply reviewed $Environment bootstrap workload-boundary plan $sha256"
  } | ConvertTo-Json -Depth 5
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlanPath) -or [string]::IsNullOrWhiteSpace($ReviewedPlanSha256)) {
  throw "Apply requires the exact saved PlanPath and reviewed SHA-256."
}
$resolvedPlan = Resolve-DeploymentPlanPath -Candidate $PlanPath -AllowedRoot $operatorRoot -MustExist
$actualSha256 = (Get-FileHash -LiteralPath $resolvedPlan -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -cne $ReviewedPlanSha256) {
  throw "The saved bootstrap plan checksum does not match approval."
}
$metadataPath = "$resolvedPlan$metadataSuffix"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
  throw "Saved bootstrap plan metadata is missing."
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
Assert-ReviewedPlanMetadata -Metadata $metadata -Expected @{
  SchemaVersion = "2"
  Operation     = "bootstrap-workload-boundary"
  Environment   = $Environment
  Region        = $Region
  AccountId     = $ExpectedAccountId
  StateBucket   = $StateBucket
  Commit        = $commit
  PlanPath      = $resolvedPlan
  PlanSha256    = $ReviewedPlanSha256
  Resource      = "aws_iam_policy.workload_boundary"
  ChangeSet     = $changeSet
  AddedSids     = (@($expectedAddedStatements | ForEach-Object { [string]$_.Sid }) | Sort-Object) -join ","
  ModifiedSids  = (@($expectedModifiedStatements | ForEach-Object { [string]$_.After.Sid }) | Sort-Object) -join ","
}
$plan = Read-SavedPlan -ResolvedPlan $resolvedPlan
$null = Assert-ApprovedPlanBoundary -Plan $plan
$afterPolicy = ConvertFrom-IamPolicyValue -Policy `
  (Get-ChangedResources -Plan $plan)[0].change.after.policy
Assert-PolicyValidation -Policy $afterPolicy

& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $resolvedPlan
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed bootstrap plan did not apply successfully." }
Invoke-Verification | ConvertTo-Json -Depth 5
