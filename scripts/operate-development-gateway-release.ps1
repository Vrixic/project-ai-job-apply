[CmdletBinding()]
param(
  [ValidateSet("Status", "CaptureBaseline", "Publish", "VerifyPublication", "Plan", "Apply", "Verify")]
  [string]$Action = "Status",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")][string]$SourceSha = "",
  [string]$ReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedReceiptSha256 = "",
  [string]$DocumentReceiptPath = "",
  [ValidatePattern("^(?:|[a-f0-9]{64})$")][string]$ReviewedDocumentReceiptSha256 = "",
  [string]$BaselinePlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselineSha256 = "",
  [string]$BaselineMetadataPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedBaselineMetadataSha256 = "",
  [string]$PlanPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPlanSha256 = "",
  # Switches the Gateway-to-Documents invoke grant (ADR-031) on, once. Required for Plan, Apply, and
  # Verify of the release that first carries it; the guards accept only the reviewed grant content.
  [switch]$EnableDocumentTailoringInvoke,
  # Also refreshes the document processor to the verified artifact named by -DocumentReceiptPath
  # (ADR-031). The processor function and alias are the only additional changes the guards accept.
  [switch]$RefreshDocumentProcessor,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "lib\terraform-toolchain.ps1")
. (Join-Path $PSScriptRoot "lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-gateway-release-guards.ps1")
. (Join-Path $PSScriptRoot "lib\development-current-document-baseline.ps1")

if ($Help) {
  @"
Usage:
  .\scripts\operate-development-gateway-release.ps1 -Action Publish -ExpectedAccountId ACCOUNT_ID `
    -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT
  .\scripts\operate-development-gateway-release.ps1 -Action CaptureBaseline `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
    -BaselinePlanPath REVIEWED_ZERO_DRIFT_SEED -ReviewedBaselineSha256 SEED_SHA256 `
    -DocumentReceiptPath VERIFIED_DOCUMENT_RECEIPT `
    -ReviewedDocumentReceiptSha256 DOCUMENT_RECEIPT_SHA256
  .\scripts\operate-development-gateway-release.ps1 -Action VerifyPublication `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
    -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256
  .\scripts\operate-development-gateway-release.ps1 -Action Plan `
    -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET -SourceSha MERGED_COMMIT `
    -ReceiptPath RECEIPT -ReviewedReceiptSha256 RECEIPT_SHA256 `
    -BaselinePlanPath CURRENT_PLAN -ReviewedBaselineSha256 BASELINE_SHA256 `
    -BaselineMetadataPath CURRENT_PLAN_METADATA -ReviewedBaselineMetadataSha256 METADATA_SHA256
  .\scripts\operate-development-gateway-release.ps1 -Action Apply [same inputs] `
    -PlanPath RELEASE_PLAN -ReviewedPlanSha256 RELEASE_PLAN_SHA256
  .\scripts\operate-development-gateway-release.ps1 -Action Verify [same receipt and baseline inputs]

Publish is the GitHub Actions-budget fallback and writes only four new immutable, versioned,
KMS-encrypted gateway release objects. Plan overlays only the verified gateway artifact onto a
checksum-reviewed current input baseline. Apply consumes only the reviewed saved plan. Verify
checks the exact numeric Lambda alias, direct search/auth/input boundary, and zero Terraform drift.
All receipts, saved plans, metadata, and logs remain below the ignored development .terraform tree.
"@
  exit 0
}

if ($Region -cne "us-east-2") { throw "Development gateway release is restricted to us-east-2." }
if ($ExpectedAccountId -notmatch '^[0-9]{12}$' -or [string]::IsNullOrWhiteSpace($StateBucket)) {
  throw "The exact development account ID and encrypted Terraform state bucket are required."
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformDirectory = Join-Path $repositoryRoot "infrastructure\terraform\environments\development"
$terraformRoot = Join-Path $terraformDirectory ".terraform"
$operatorRoot = Join-Path $terraformRoot "development-gateway-release"
$terraformDataDirectory = Join-Path $terraformRoot "development-gateway-release-data"
$artifactDirectory = Join-Path $repositoryRoot "backend\gateway\dist\lambda"
$artifactName = "gateway-lambda"
$metadataSuffix = ".gateway-release.json"

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_PAGER = ""

function Get-FileSha256 { param([Parameter(Mandatory)][string]$Path); return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-FileBase64Sha256 {
  param([Parameter(Mandatory)][string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path)
  try { return [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}
function Get-GatewayKeyHistoryMatches {
  param([AllowNull()][object]$Result, [Parameter(Mandatory)][string]$Key)
  $versions = @(Get-OptionalProperty -Object $Result -Name "Versions")
  $deleteMarkers = @(Get-OptionalProperty -Object $Result -Name "DeleteMarkers")
  return @(@($versions + $deleteMarkers) | Where-Object {
      $null -ne $_ -and [string](Get-OptionalProperty -Object $_ -Name "Key") -ceq $Key
    })
}
function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed. Refresh the development IAM Identity Center session and inspect locally." }
  if (-not $raw) { return $null }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "$Operation returned invalid JSON." }
}
function Invoke-TerraformJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & terraform "-chdir=$terraformDirectory" @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed." }
  try { return ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
  catch { throw "$Operation returned invalid JSON." }
}
function Resolve-GatewayOperatorPath {
  param([Parameter(Mandatory)][string]$Candidate, [switch]$MustExist, [switch]$ReleaseOnly)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { throw "A required operator path is missing." }
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) { [IO.Path]::GetFullPath($Candidate) }
    else { [IO.Path]::GetFullPath((Join-Path $terraformDirectory $Candidate)) }
  $root = [IO.Path]::GetFullPath($(if ($ReleaseOnly) { $operatorRoot } else { $terraformRoot })).TrimEnd([char[]]@("\", "/"))
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Gateway release artifacts must stay below the ignored development .terraform directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "A required operator artifact does not exist." }
  return $resolved
}
function Write-ExclusiveJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value, [switch]$Replace)
  if ((Test-Path -LiteralPath $Path) -and -not $Replace) { throw "Refusing to overwrite an operator artifact." }
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 50), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force:$Replace
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}
function Assert-GatewayVerifySourceDelta {
  param(
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$OperatorSha
  )
  $allowed = @(
    "scripts/operate-development-gateway-release.ps1",
    "scripts/verify-development-gateway-lambda-boundary.ps1",
    "scripts/lib/development-gateway-release-guards.ps1",
    "scripts/tests/development-gateway-release-operator.tests.ps1",
    "scripts/tests/development-gateway-release-guards.tests.ps1",
    "scripts/validate-serverless-workflow-infrastructure.mjs",
    "infrastructure/runbooks/deployments/development-gateway-release.md"
  )
  & git -C $repositoryRoot merge-base --is-ancestor $ReleaseSha $OperatorSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The applied gateway release is not an ancestor of the verification operator." }
  $records = @(& git -C $repositoryRoot diff --name-status --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  $numstat = @(& git -C $repositoryRoot diff --numstat --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $records.Count -eq 0 -or $records.Count -ne $numstat.Count -or
      @($numstat | Where-Object { $_ -match '^-\t-\t' }).Count -ne 0) {
    throw "The gateway verification-only delta is empty, unreadable, or binary."
  }
  foreach ($record in $records) {
    if ($record -notmatch '^M\t(.+)$' -or $Matches[1] -notin $allowed) {
      throw "The applied gateway release differs from the verification operator outside the exact allowlist."
    }
    $path = $Matches[1]
    foreach ($revision in @($ReleaseSha, $OperatorSha)) {
      $type = (& git -C $repositoryRoot cat-file -t "$revision`:$path" 2>$null).Trim()
      if ($LASTEXITCODE -ne 0 -or $type -cne "blob") {
        throw "The gateway verification-only delta contains a missing or non-blob path."
      }
    }
  }
}
function Assert-CallerAndSource {
  $identity = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json") "AWS caller validation"
  if ([string]$identity.Account -cne $ExpectedAccountId -or -not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "Use the exact temporary development IAM Identity Center caller."
  }
  Assert-DeploymentTerraformCli
  if ((& node --version 2>$null).Trim() -notmatch '^v24\.' -or (& pnpm --version 2>$null).Trim() -cne "10.24.0") {
    throw "Node.js 24 and pnpm 10.24.0 are required."
  }
  $branch = (& git -C $repositoryRoot branch --show-current 2>$null).Trim()
  $head = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
  $origin = (& git -C $repositoryRoot rev-parse origin/main 2>$null).Trim()
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($branch -cne "main" -or $head -cne $origin -or $dirty.Count -ne 0) { throw "The release requires clean main exactly matching origin/main." }
  if ($Action -ne "Status") {
    if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw "SourceSha must equal the exact merged main checkout." }
    if ($SourceSha -cne $head) {
      if ($Action -cne "Verify") { throw "SourceSha must equal the exact merged main checkout." }
      Assert-GatewayVerifySourceDelta -ReleaseSha $SourceSha -OperatorSha $head
    }
  }
  return $head
}

function Get-DocumentOperatorDeltaSha256 {
  param([Parameter(Mandatory)][string]$ReleaseSha, [Parameter(Mandatory)][string]$OperatorSha)
  if ($ReleaseSha -notmatch '^[a-f0-9]{40}$' -or $OperatorSha -notmatch '^[a-f0-9]{40}$') { throw "The document baseline source SHAs are invalid." }
  if ($ReleaseSha -ceq $OperatorSha) {
    return Get-TextSha256 "development-operator-delta-v1`n$ReleaseSha`n$OperatorSha`n--name-status--`n--patch--`n"
  }
  & git -C $repositoryRoot merge-base --is-ancestor $ReleaseSha $OperatorSha 2>$null
  if ($LASTEXITCODE -ne 0) { throw "The document baseline release is not an ancestor of the gateway operator." }
  $allowed = @(
    "backend/services/jobs/src/persistence/catalog.ts", "backend/services/jobs/src/persistence/catalog.test.ts",
    "scripts/lib/development-document-dark-guards.ps1", "scripts/lib/development-gateway-release-guards.ps1",
    "scripts/operate-development-document-dark-deployment.ps1", "scripts/operate-development-document-migration.ps1",
    "scripts/operate-development-gateway-release.ps1", "scripts/tests/development-document-dark-guards.tests.ps1",
    "scripts/tests/development-document-dark-operator.tests.ps1", "scripts/tests/development-document-migration-operator.tests.ps1",
    "scripts/tests/development-gateway-release-guards.tests.ps1", "scripts/tests/development-gateway-release-operator.tests.ps1",
    "scripts/validate-serverless-workflow-infrastructure.mjs", "scripts/verify-development-gateway-lambda-boundary.ps1",
    "infrastructure/runbooks/deployments/development-document-dark-deployment.md", "infrastructure/runbooks/deployments/database-migration.md",
    "infrastructure/runbooks/deployments/development-gateway-release.md"
  )
  $records = @(& git -C $repositoryRoot diff --name-status --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  $numstat = @(& git -C $repositoryRoot diff --numstat --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $records.Count -eq 0 -or @($numstat | Where-Object { $_ -match '^-\t-\t' }).Count -ne 0) { throw "The document operator delta is empty, unreadable, or binary." }
  foreach ($record in $records) {
    if ($record -notmatch '^M\t(.+)$' -or $Matches[1] -notin $allowed) { throw "The document operator delta is outside the modified-file allowlist." }
    $path = $Matches[1]
    foreach ($revision in @($ReleaseSha, $OperatorSha)) {
      $type = (& git -C $repositoryRoot cat-file -t "$revision`:$path" 2>$null).Trim()
      if ($LASTEXITCODE -ne 0 -or $type -cne "blob") { throw "The document operator delta contains a missing or non-blob path." }
    }
  }
  $patch = @(& git -C $repositoryRoot diff --full-index --binary --no-ext-diff --no-renames "$ReleaseSha..$OperatorSha" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "The document canonical operator patch could not be read." }
  return Get-TextSha256 ("development-operator-delta-v1`n$ReleaseSha`n$OperatorSha`n--name-status--`n" + (($records -join "`n") + "`n--patch--`n" + ($patch -join "`n") + "`n"))
}
function Initialize-Backend {
  $location = (& aws s3api get-bucket-location --bucket $StateBucket --query LocationConstraint --output text 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $location -cne $Region) { throw "The state bucket is outside us-east-2." }
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") "State encryption validation"
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and $_.BucketKeyEnabled
    })
  if ($rules.Count -ne 1) { throw "The state bucket must use one bucket-key-enabled KMS default." }
  $kmsArn = [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if ($kmsArn -cnotmatch "^arn:aws:kms:$Region`:$ExpectedAccountId`:key/") { throw "The state KMS key is outside the exact boundary." }
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") "State versioning validation"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") "State public-access validation"
  $block = $public.PublicAccessBlockConfiguration
  if ([string]$versioning.Status -cne "Enabled" -or -not ($block.BlockPublicAcls -and $block.IgnorePublicAcls -and $block.BlockPublicPolicy -and $block.RestrictPublicBuckets)) {
    throw "The state bucket must be versioned and fully private."
  }
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  & terraform "-chdir=$terraformDirectory" init -reconfigure -input=false -lockfile=readonly `
    "-backend-config=bucket=$StateBucket" "-backend-config=key=platform.tfstate" `
    "-backend-config=region=$Region" "-backend-config=kms_key_id=$kmsArn" "-backend-config=use_lockfile=true" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The encrypted development backend could not be initialized." }
  Assert-DeploymentTerraformBackend -TerraformDirectory $terraformDirectory -DataDirectory $terraformDataDirectory `
    -ExpectedBucket $StateBucket -ExpectedKey "platform.tfstate" -ExpectedRegion $Region -ExpectedKmsKeyArn $kmsArn
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $StateBucket, "--key", "platform.tfstate", "--output", "json") "State object validation"
  if ([long]$head.ContentLength -le 0 -or [string]::IsNullOrWhiteSpace([string]$head.VersionId) -or
      [string]$head.ServerSideEncryption -cne "aws:kms" -or -not $head.BucketKeyEnabled) {
    throw "The remote state object is not nonempty, versioned, and KMS encrypted."
  }
}
function Add-ManagedResources {
  param([AllowNull()][object]$Module, [Parameter(Mandatory)][Collections.Generic.Dictionary[string, object]]$Destination)
  if ($null -eq $Module) { return }
  $resourceProperty = $Module.PSObject.Properties["resources"]
  $childProperty = $Module.PSObject.Properties["child_modules"]
  foreach ($resource in @($(if ($null -eq $resourceProperty) { @() } else { $resourceProperty.Value }))) {
    if ($null -ne $resource -and [string]$resource.mode -ceq "managed") { $Destination[[string]$resource.address] = $resource }
  }
  foreach ($child in @($(if ($null -eq $childProperty) { @() } else { $childProperty.Value }))) { Add-ManagedResources $child $Destination }
}
function Get-StateDocumentProcessorParserQualifiedArn {
  param(
    [Parameter(Mandatory)][Collections.Generic.Dictionary[string, object]]$Resources,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region
  )
  $processorAddress = "module.platform.aws_lambda_function.document_processor[0]"
  if (-not $Resources.ContainsKey($processorAddress)) { return "" }
  $processor = $Resources[$processorAddress]
  $valuesProperty = $processor.PSObject.Properties["values"]
  if ($null -eq $valuesProperty -or $null -eq $valuesProperty.Value) {
    throw "Terraform state contains an invalid document processor resource boundary."
  }
  $environmentProperty = $valuesProperty.Value.PSObject.Properties["environment"]
  if ($null -eq $environmentProperty -or $environmentProperty.Value -isnot [array]) {
    throw "Terraform state contains an invalid document processor environment boundary."
  }
  $environment = @($environmentProperty.Value | Where-Object { $null -ne $_ })
  if ($environment.Count -ne 1) {
    throw "Terraform state contains an invalid document processor environment boundary."
  }
  $variablesProperty = $environment[0].PSObject.Properties["variables"]
  if ($null -eq $variablesProperty -or $null -eq $variablesProperty.Value) {
    throw "Terraform state contains an invalid document processor environment boundary."
  }
  $parserProperty = $variablesProperty.Value.PSObject.Properties["DOCUMENT_PARSER_FUNCTION_ARN"]
  if ($null -eq $parserProperty -or $parserProperty.Value -isnot [string] -or
      [string]$parserProperty.Value -cnotmatch "^arn:aws:lambda:$Region`:$AccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$") {
    throw "Terraform state contains an invalid document processor parser-version boundary."
  }
  return [string]$parserProperty.Value
}
function Assert-RetainedGatewayParserBinding {
  param(
    [Parameter(Mandatory)][ValidateSet("parser-dark", "complete-dark")][string]$Stage,
    [Parameter(Mandatory)][AllowEmptyString()][string]$PlanParserQualifiedArn,
    [Parameter(Mandatory)][AllowEmptyString()][string]$MetadataParserQualifiedArn,
    [Parameter(Mandatory)][AllowEmptyString()][string]$StateParserQualifiedArn,
    [Parameter(Mandatory)][AllowEmptyString()][string]$StateProcessorParserQualifiedArn,
    [Parameter(Mandatory)][string]$AccountId,
    [Parameter(Mandatory)][string]$Region
  )
  $parserPattern = "^arn:aws:lambda:$Region`:$AccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$"
  if ($PlanParserQualifiedArn -cne $MetadataParserQualifiedArn -or
      $StateParserQualifiedArn -cnotmatch $parserPattern -or
      ($Stage -ceq "parser-dark" -and
        (-not [string]::IsNullOrEmpty($PlanParserQualifiedArn) -or
         -not [string]::IsNullOrEmpty($StateProcessorParserQualifiedArn))) -or
      ($Stage -ceq "complete-dark" -and
        ($PlanParserQualifiedArn -cnotmatch $parserPattern -or
         $PlanParserQualifiedArn -cne $StateProcessorParserQualifiedArn))) {
    throw "The retained baseline stage/parser binding does not match its plan and Terraform state."
  }
  return $true
}
function Resolve-ArtifactBoundary {
  $state = Invoke-TerraformJson @("show", "-json") "Terraform state inspection"
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  Add-ManagedResources $state.values.root_module $resources
  foreach ($address in @("module.platform.aws_s3_bucket.artifacts", "module.platform.aws_kms_key.platform", "module.platform.aws_ecr_repository.migration")) {
    if (-not $resources.ContainsKey($address)) { throw "Terraform state does not own '$address'." }
  }
  $bucket = [string]$resources["module.platform.aws_s3_bucket.artifacts"].values.bucket
  $kmsArn = [string]$resources["module.platform.aws_kms_key.platform"].values.arn
  $migrationRepositoryUrl = [string]$resources["module.platform.aws_ecr_repository.migration"].values.repository_url
  if ($migrationRepositoryUrl -cne "$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration") {
    throw "Terraform state does not own the exact development migration repository."
  }
  $location = (& aws s3api get-bucket-location --bucket $bucket --query LocationConstraint --output text 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $location -cne $Region) { throw "The Terraform-owned artifact bucket is outside us-east-2." }
  $versioning = Invoke-AwsJson @("s3api", "get-bucket-versioning", "--bucket", $bucket, "--output", "json") "Artifact versioning validation"
  $encryption = Invoke-AwsJson @("s3api", "get-bucket-encryption", "--bucket", $bucket, "--output", "json") "Artifact encryption validation"
  $public = Invoke-AwsJson @("s3api", "get-public-access-block", "--bucket", $bucket, "--output", "json") "Artifact public-access validation"
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object { [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -ceq $kmsArn -and $_.BucketKeyEnabled })
  $key = Invoke-AwsJson @("kms", "describe-key", "--key-id", $kmsArn, "--output", "json") "Artifact KMS validation"
  $block = $public.PublicAccessBlockConfiguration
  if ([string]$versioning.Status -cne "Enabled" -or $rules.Count -ne 1 -or
      [string]$key.KeyMetadata.Arn -cne $kmsArn -or [string]$key.KeyMetadata.KeyManager -cne "CUSTOMER" -or
      [string]$key.KeyMetadata.KeyState -cne "Enabled" -or -not $key.KeyMetadata.Enabled -or
      -not ($block.BlockPublicAcls -and $block.IgnorePublicAcls -and $block.BlockPublicPolicy -and $block.RestrictPublicBuckets)) {
    throw "The Terraform-owned artifact bucket is not immutable, private, and protected by the exact platform KMS key."
  }
  $parserAddress = "module.platform.aws_lambda_function.document_parser[0]"
  $parserQualifiedArn = if ($resources.ContainsKey($parserAddress)) { [string]$resources[$parserAddress].values.qualified_arn } else { "" }
  if (-not [string]::IsNullOrEmpty($parserQualifiedArn) -and
      $parserQualifiedArn -cnotmatch "^arn:aws:lambda:$Region`:$ExpectedAccountId`:function:ai-job-apply-development-document-parser:[1-9][0-9]*$") {
    throw "Terraform state contains an invalid document parser version boundary."
  }
  $processorParserQualifiedArn = Get-StateDocumentProcessorParserQualifiedArn -Resources $resources `
    -AccountId $ExpectedAccountId -Region $Region
  return [pscustomobject]@{
    Bucket = $bucket; KmsArn = $kmsArn
    BoundarySha256 = Get-TextSha256 "$ExpectedAccountId|$Region|$bucket|$kmsArn"
    MigrationRepositoryUrl = $migrationRepositoryUrl; ParserQualifiedArn = $parserQualifiedArn
    ProcessorParserQualifiedArn = $processorParserQualifiedArn
  }
}
function Read-Plan {
  param([Parameter(Mandatory)][string]$Path, [switch]$AllowHistorical)
  return Read-DeploymentTerraformPlan -Path $Path -TerraformDirectory $terraformDirectory -AllowHistorical:$AllowHistorical
}
function Get-StateIdentity {
  $raw = & terraform "-chdir=$terraformDirectory" state pull 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "Current Terraform state identity could not be read." }
  $state = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  Assert-DeploymentTerraformStateVersion -Version ([string]$state.terraform_version)
  if ([string]$state.lineage -cnotmatch '^[a-f0-9-]{36}$' -or [long]$state.serial -lt 1) { throw "Current Terraform state identity is invalid." }
  return [pscustomobject]@{ Lineage = [string]$state.lineage; Serial = [long]$state.serial }
}
function Save-AndClearTerraformVariables {
  $saved = @{}
  foreach ($item in @(Get-ChildItem Env: | Where-Object Name -like "TF_VAR_*")) { $saved[$item.Name] = $item.Value; Remove-Item "Env:$($item.Name)" }
  return $saved
}
function Restore-TerraformVariables {
  param([Parameter(Mandatory)][hashtable]$Saved)
  foreach ($item in @(Get-ChildItem Env: | Where-Object Name -like "TF_VAR_*")) { Remove-Item "Env:$($item.Name)" }
  foreach ($entry in $Saved.GetEnumerator()) { Set-Item "Env:$($entry.Key)" ([string]$entry.Value) }
}
function Set-VariablesFromPlan {
  param([Parameter(Mandatory)][object]$Plan, [AllowNull()][object]$Artifact, [switch]$EnableTailoringInvoke, [AllowNull()][object]$ProcessorArtifact = $null)
  foreach ($property in $Plan.variables.PSObject.Properties) {
    $value = $property.Value.value
    $serialized = if ($value -is [bool]) { ([string]$value).ToLowerInvariant() }
      elseif ($value -is [string]) { $value }
      else { ConvertTo-Json -InputObject $value -Depth 30 -Compress }
    Set-Item "Env:TF_VAR_$($property.Name)" $serialized
  }
  if ($null -ne $Artifact) {
    $env:TF_VAR_gateway_lambda_artifact_s3_key = [string]$Artifact.key
    $env:TF_VAR_gateway_lambda_artifact_s3_object_version = [string]$Artifact.versionId
    $env:TF_VAR_gateway_lambda_artifact_sha256 = [string]$Artifact.artifactSha256
    $env:TF_VAR_gateway_lambda_artifact_base64sha256 = [string]$Artifact.objectBase64Sha256
  }
  if ($EnableTailoringInvoke) { $env:TF_VAR_document_tailoring_invoke_enabled = "true" }
  if ($null -ne $ProcessorArtifact) {
    $env:TF_VAR_document_processor_artifact_s3_key = [string]$ProcessorArtifact.key
    $env:TF_VAR_document_processor_artifact_s3_object_version = [string]$ProcessorArtifact.versionId
    $env:TF_VAR_document_processor_artifact_sha256 = [string]$ProcessorArtifact.artifactSha256
    $env:TF_VAR_document_processor_artifact_base64sha256 = [string]$ProcessorArtifact.objectBase64Sha256
  }
}
function ConvertTo-GatewayCaptureRestoreFlag {
  param([AllowNull()][object]$Value)
  if ($Value -is [bool]) { return $Value }
  # Terraform's plan JSON retains raw TF_VAR input strings before its declared
  # boolean conversion. Accept only these exact representations, never truthiness.
  if ($Value -is [string] -and $Value -ceq "false") { return $false }
  if ($Value -is [string] -and $Value -ceq "true") { return $true }
  throw "The retained restore role flag must be an exact boolean input."
}
function Get-GatewayCaptureSeedInputs {
  param([Parameter(Mandatory)][object]$Seed, [Parameter(Mandatory)][string[]]$DeclaredVariableNames)
  $restoreFlag = "candidate_deletion_restore_role_enabled"
  if ($DeclaredVariableNames.Count -eq 0 -or
      @($DeclaredVariableNames | Sort-Object -Unique).Count -ne $DeclaredVariableNames.Count -or
      $DeclaredVariableNames -cnotcontains $restoreFlag -or $Seed.variables -isnot [pscustomobject]) {
    throw "The baseline capture current variable inventory is invalid."
  }
  $seedDeclared = @($DeclaredVariableNames)
  $defaults = @{}
  # The Gateway-to-Documents invoke switch (ADR-031) is default-off and newer than every retained
  # seed. Its absence is reconstructed as false for the fresh plan, never relabeled on the seed.
  $tailoringFlag = "document_tailoring_invoke_enabled"
  if ($DeclaredVariableNames -ccontains $tailoringFlag -and $null -eq $Seed.variables.PSObject.Properties[$tailoringFlag]) {
    $seedDeclared = @($seedDeclared | Where-Object { $_ -cne $tailoringFlag })
    $defaults[$tailoringFlag] = $false
  }
  $restoreProperty = $Seed.variables.PSObject.Properties[$restoreFlag]
  if ($null -eq $restoreProperty) {
    # This is input reconstruction for a fresh plan, never a mutation or relabeling of
    # retained evidence. Only this new default-off flag may be absent from a 1.9.8 seed.
    if ([string]$Seed.terraform_version -cne "1.9.8") {
      throw "Only the historical baseline seed may omit the new default-off restore role flag."
    }
    $seedDeclared = @($seedDeclared | Where-Object { $_ -cne $restoreFlag })
    $defaults[$restoreFlag] = $false
  } else {
    $restoreValue = $restoreProperty.Value.PSObject.Properties["value"]
    if ($null -eq $restoreValue) { throw "The retained restore role flag value is missing." }
    $null = ConvertTo-GatewayCaptureRestoreFlag $restoreValue.Value
  }
  $null = Assert-RetainedGatewayBaselinePlan $Seed $seedDeclared
  return [pscustomobject]@{ SeedDeclaredVariableNames = $seedDeclared; DefaultVariables = $defaults }
}
function Assert-GatewayCapturedSeedInputs {
  param(
    [Parameter(Mandatory)][object]$Seed,
    [Parameter(Mandatory)][object]$Captured,
    [Parameter(Mandatory)][string[]]$DeclaredVariableNames
  )
  $inputs = Get-GatewayCaptureSeedInputs $Seed $DeclaredVariableNames
  # A fresh baseline is always current, fully populated, and still zero drift.
  if ([string]$Captured.terraform_version -cne (Get-DeploymentTerraformVersion)) {
    throw "The captured baseline must use the current Terraform version."
  }
  $null = Assert-RetainedGatewayBaselinePlan $Captured $DeclaredVariableNames
  # Native TF_VAR serialization may retain lowercase strings for declared root booleans.
  # Keep the shared typed inventory unchanged; these two newer root flags are local additions.
  $booleanVariableNames = @(Get-DevelopmentDocumentBooleanVariableNames) +
    @("candidate_deletion_restore_role_enabled", "outbox_starts_paused")
  foreach ($name in $DeclaredVariableNames) {
    if ($inputs.DefaultVariables.ContainsKey($name)) { $expected = $inputs.DefaultVariables[$name] }
    else {
      $seedValue = $Seed.variables.PSObject.Properties[$name].Value.PSObject.Properties["value"]
      if ($null -eq $seedValue) { throw "The retained baseline variable value is missing." }
      $expected = $seedValue.Value
    }
    $capturedValue = $Captured.variables.PSObject.Properties[$name].Value.PSObject.Properties["value"]
    if ($null -eq $capturedValue) { throw "The captured baseline variable value is missing." }
    $actual = $capturedValue.Value
    if ($booleanVariableNames -ccontains $name) {
      $expected = ConvertTo-ExactBoolean $expected "Retained Terraform variable $name"
      $actual = ConvertTo-ExactBoolean $actual "Captured Terraform variable $name"
    }
    if ((ConvertTo-GatewayCanonicalJson $actual) -cne (ConvertTo-GatewayCanonicalJson $expected)) {
      throw "The captured baseline changed a retained or reconstructed variable value."
    }
  }
}
function Read-BaselineDocumentReceipt {
  param([Parameter(Mandatory)][string]$ReceiptSha256)
  if ($ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw "The retained baseline does not contain an exact document receipt checksum."
  }
  $receiptRoot = Join-Path $terraformRoot "development-document-artifacts"
  if (-not (Test-Path -LiteralPath $receiptRoot -PathType Container)) {
    throw "The ignored development document receipt directory is unavailable."
  }
  $matches = @(
    Get-ChildItem -LiteralPath $receiptRoot -File -Filter "receipt-*.json" | Where-Object {
      (Get-FileSha256 -Path $_.FullName) -ceq $ReceiptSha256
    }
  )
  if ($matches.Count -ne 1) {
    throw "Exactly one local document publication receipt must match the retained baseline checksum."
  }
  return Get-Content -LiteralPath $matches[0].FullName -Raw | ConvertFrom-Json
}
# The document publication receipt for the exact release source, re-verified against the live private,
# versioned, customer-KMS artifact bucket. Only its processor archive is used, and only when the caller
# asks for a processor refresh; otherwise nothing about the document runtime may change.
function Read-ProcessorRefreshArtifact {
  if (-not $RefreshDocumentProcessor) { return $null }
  if ($Action -notin @("Plan", "Apply", "Verify") -or [string]::IsNullOrWhiteSpace($DocumentReceiptPath) -or
      $ReviewedDocumentReceiptSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "A document processor refresh requires Plan, Apply, or Verify with the reviewed publication receipt."
  }
  $receiptRoot = [IO.Path]::GetFullPath((Join-Path $terraformRoot "development-document-artifacts"))
  $candidate = if ([IO.Path]::IsPathRooted($DocumentReceiptPath)) { $DocumentReceiptPath } else { Join-Path $terraformDirectory $DocumentReceiptPath }
  $resolved = [IO.Path]::GetFullPath($candidate)
  if (-not $resolved.StartsWith($receiptRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The document publication receipt must be an existing file in the ignored document artifact directory."
  }
  if ((Get-FileSha256 $resolved) -cne $ReviewedDocumentReceiptSha256) {
    throw "The document publication receipt checksum does not match review."
  }
  $receipt = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
  $artifact = Get-GatewayProcessorArtifact -Receipt $receipt -SourceSha $SourceSha
  if ([string]$receipt.boundarySha256 -cne [string]$boundary.BoundarySha256) {
    throw "The document publication receipt is outside the live development artifact and KMS boundary."
  }
  $stored = Invoke-AwsJson @("s3api", "head-object", "--bucket", $boundary.Bucket, "--key", $artifact.key,
    "--version-id", $artifact.versionId, "--checksum-mode", "ENABLED", "--output", "json") "Processor artifact readback"
  $storedKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", [string]$stored.SSEKMSKeyId, "--output", "json") "Processor artifact KMS readback"
  $platformKey = Invoke-AwsJson @("kms", "describe-key", "--key-id", $boundary.KmsArn, "--output", "json") "Platform KMS readback"
  if ([string]$stored.VersionId -cne $artifact.versionId -or [long]$stored.ContentLength -ne $artifact.contentLength -or
      [string]$stored.ChecksumSHA256 -cne $artifact.objectBase64Sha256 -or [string]$stored.ServerSideEncryption -cne "aws:kms" -or
      [string]$storedKey.KeyMetadata.KeyId -cne [string]$platformKey.KeyMetadata.KeyId -or
      [string]$stored.Metadata."source-sha" -cne $SourceSha -or
      [string]$stored.Metadata."artifact-sha256" -cne $artifact.artifactSha256) {
    throw "The document processor artifact failed independent exact-version readback."
  }
  return $artifact
}
function Read-Baseline {
  foreach ($required in @($BaselinePlanPath, $ReviewedBaselineSha256, $BaselineMetadataPath, $ReviewedBaselineMetadataSha256)) {
    if ([string]::IsNullOrWhiteSpace($required)) { throw "A checksum-reviewed current Terraform input baseline and metadata sidecar are required." }
  }
  $planPath = Resolve-GatewayOperatorPath $BaselinePlanPath -MustExist
  $metadataPath = Resolve-GatewayOperatorPath $BaselineMetadataPath -MustExist
  $expectedMetadataPath = "$planPath.baseline.json"
  if ([IO.Path]::GetFullPath($metadataPath) -cne [IO.Path]::GetFullPath($expectedMetadataPath)) {
    throw "The retained baseline metadata must be the plan's adjacent .baseline.json sidecar."
  }
  if ((Get-FileSha256 $planPath) -cne $ReviewedBaselineSha256 -or (Get-FileSha256 $metadataPath) -cne $ReviewedBaselineMetadataSha256) {
    throw "A baseline plan or metadata checksum does not match review."
  }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  $plan = Read-Plan $planPath -AllowHistorical
  $terraformFiles = @(Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf" | Sort-Object Name)
  $declaredVariables = @($terraformFiles | ForEach-Object {
      $variableSource = Get-Content -LiteralPath $_.FullName -Raw
      [regex]::Matches($variableSource, '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') |
        ForEach-Object { $_.Groups[1].Value }
    })
  if ($terraformFiles.Count -eq 0 -or $declaredVariables.Count -eq 0 -or
      @($declaredVariables | Sort-Object -Unique).Count -ne $declaredVariables.Count) {
    throw "The gateway baseline variable inventory is empty or duplicated."
  }
  $null = Assert-RetainedGatewayBaselinePlan $plan $declaredVariables
  $state = Get-StateIdentity
  $null = Assert-RetainedGatewayBaselineMetadata -Metadata $metadata -Plan $plan `
    -PlanPath $planPath -PlanSha256 $ReviewedBaselineSha256 -SourceSha $SourceSha `
    -AccountId $ExpectedAccountId -Region $Region `
    -ExpectedMigrationRepositoryUrl $boundary.MigrationRepositoryUrl -CurrentState $state `
    -AllowOneSerialAdvance:($Action -ceq "Verify")
  if ([string]$metadata.SchemaVersion -ceq "7") {
    $null = Assert-CurrentDocumentBaselineEvidence -Metadata $metadata -Plan $plan -PlanPath $planPath `
      -PlanSha256 $ReviewedBaselineSha256 -CurrentState $state -SourceSha $SourceSha `
      -AccountId $ExpectedAccountId -Region $Region -RepositoryRoot $repositoryRoot `
      -ReceiptDirectory (Join-Path $terraformRoot "development-document-artifacts") `
      -AllowOneSerialAdvance:($Action -ceq "Verify")
  }
  $documentReleaseSha = if ([string]$metadata.SchemaVersion -ceq "5") {
    if ([string]$metadata.DocumentReleaseSourceSha -cne 'a6d0fba09082b8bc61ee7b604ee1d5c47bd71624' -or
      [string]$metadata.DocumentOperatorSourceSha -cne '9d290416c61847f1682157c08312cdb920d42107' -or
      [string]$metadata.DocumentOperatorDeltaSha256 -cne
        (Get-DocumentOperatorDeltaSha256 -ReleaseSha ([string]$metadata.DocumentReleaseSourceSha) `
          -OperatorSha ([string]$metadata.DocumentOperatorSourceSha)) -or
      [string]$metadata.ReleaseSourceSha -cne 'c310d537027e4a224149996b0714ee45ce6b104e' -or
      [string]$metadata.BaselineToReleaseDeltaSha256 -cne
        '9c1b4d52b1bfc7d3901a8d6131a77ff714f85d61fb549114e0165634e49eb4b6' -or
      [string]$metadata.OperatorSourceSha -cne $SourceSha -or
      [string]$metadata.OperatorDeltaSha256 -cne
        (Get-DocumentOperatorDeltaSha256 -ReleaseSha ([string]$metadata.ReleaseSourceSha) `
          -OperatorSha $SourceSha)) {
      throw "The retained document baseline does not preserve the exact reviewed historical migration handoff."
    }
    [string]$metadata.DocumentReleaseSourceSha
  } elseif ([string]$metadata.SchemaVersion -in @("3", "4")) {
    if ([string]$metadata.OperatorSourceSha -cne $SourceSha -or
      [string]$metadata.OperatorDeltaSha256 -cne
        (Get-DocumentOperatorDeltaSha256 -ReleaseSha ([string]$metadata.ReleaseSourceSha) -OperatorSha $SourceSha)) {
      throw "The retained document baseline operator delta does not match the current gateway release source."
    }
    [string]$metadata.ReleaseSourceSha
  } elseif ([string]$metadata.SchemaVersion -in @("6", "7")) {
    [string]$metadata.DocumentReleaseSourceSha
  } else { $SourceSha }
  $documentReceipt = Read-BaselineDocumentReceipt -ReceiptSha256 ([string]$metadata.ReceiptSha256)
  $null = Assert-GatewayDocumentBaselineReceipt -Receipt $documentReceipt `
    -ReceiptSha256 ([string]$metadata.ReceiptSha256) -Plan $plan -SourceSha $documentReleaseSha `
    -ExpectedBoundarySha256 $boundary.BoundarySha256
  $stage = [string](Get-GatewayPlanVariableValue $plan.variables "document_processing_deployment_stage")
  $parserArn = [string](Get-GatewayPlanVariableValue $plan.variables "document_parser_invocation_qualified_arn")
  if ($stage -cne [string]$metadata.Stage) {
    throw "The retained baseline stage/parser binding does not match its plan and Terraform state."
  }
  $null = Assert-RetainedGatewayParserBinding -Stage $stage -PlanParserQualifiedArn $parserArn `
    -MetadataParserQualifiedArn ([string]$metadata.ParserQualifiedArn) `
    -StateParserQualifiedArn ([string]$boundary.ParserQualifiedArn) `
    -StateProcessorParserQualifiedArn ([string]$boundary.ProcessorParserQualifiedArn) `
    -AccountId $ExpectedAccountId -Region $Region
  $migrationImage = [string](Get-GatewayPlanVariableValue $plan.variables "migration_image")
  if ($migrationImage -cnotmatch "^$([regex]::Escape([string]$boundary.MigrationRepositoryUrl))@sha256:[a-f0-9]{64}$") {
    throw "The retained baseline migration digest is outside the exact Terraform-owned repository."
  }
  return [pscustomobject]@{
    Path = $planPath; MetadataPath = $metadataPath; Metadata = $metadata; Plan = $plan
    DocumentReceiptSha256 = [string]$metadata.ReceiptSha256
    MigrationImage = $migrationImage; MetadataSchemaVersion = [string]$metadata.SchemaVersion
  }
}
function Get-BuiltArtifact {
  $files = [ordered]@{}
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $path = Join-Path $artifactDirectory "$artifactName.$suffix"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item $path).Length -le 0) { throw "A gateway release artifact is missing or empty." }
    $files[$suffix] = [pscustomobject]@{ Path = $path; Sha256 = Get-FileSha256 $path; Base64Sha256 = Get-FileBase64Sha256 $path; Length = (Get-Item $path).Length }
  }
  $manifest = Get-Content -LiteralPath $files["manifest.json"].Path -Raw | ConvertFrom-Json
  $sbom = Get-Content -LiteralPath $files["cdx.json"].Path -Raw | ConvertFrom-Json
  $checksum = (Get-Content -LiteralPath $files["sha256"].Path -Raw).Replace("`r`n", "`n").TrimEnd("`n")
  if ([int]$manifest.schemaVersion -ne 2 -or [string]$manifest.sourceSha -cne $SourceSha -or
      [string]$manifest.artifactSha256 -cne $files["zip"].Sha256 -or
      [string]$manifest.artifactBase64Sha256 -cne $files["zip"].Base64Sha256 -or
      $checksum -cne "$($files['zip'].Sha256)  gateway-lambda.zip" -or
      [string]$sbom.bomFormat -cne "CycloneDX" -or [string]$sbom.specVersion -cne "1.6") {
    throw "The gateway manifest, checksum, provenance, or CycloneDX SBOM is invalid."
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($files["zip"].Path)
  try {
    $entry = @($archive.Entries | Where-Object FullName -CEQ "index.mjs")
    if ($entry.Count -ne 1) { throw "The gateway ZIP does not contain exactly one handler bundle." }
    $reader = [IO.StreamReader]::new($entry[0].Open(), [Text.Encoding]::UTF8, $true)
    try { $bundle = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($bundle.IndexOf("/* applydash-artifact-source:$SourceSha */", [StringComparison]::Ordinal) -lt 0) {
      throw "The gateway bundle does not attest to the exact merged source commit."
    }
  } finally { $archive.Dispose() }
  return [pscustomobject]@{ ArtifactSha256 = $files["zip"].Sha256; Files = $files }
}
function Assert-StoredObject {
  param([Parameter(Mandatory)][object]$Boundary, [Parameter(Mandatory)][object]$Entry)
  $head = Invoke-AwsJson @("s3api", "head-object", "--bucket", $Boundary.Bucket, "--key", [string]$Entry.key, "--version-id", [string]$Entry.versionId, "--checksum-mode", "ENABLED", "--output", "json") "Gateway object readback"
  if ([string]$head.VersionId -cne [string]$Entry.versionId -or [long]$head.ContentLength -ne [long]$Entry.contentLength -or
      [string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne $Boundary.KmsArn -or -not $head.BucketKeyEnabled -or
      [string]$head.ChecksumSHA256 -cne [string]$Entry.objectBase64Sha256 -or [string]$head.Metadata.'source-sha' -cne $SourceSha -or
      [string]$head.Metadata.'artifact-sha256' -cne [string]$Entry.artifactSha256) { throw "A gateway object failed exact-version KMS, checksum, metadata, or length readback." }
}
function Read-Receipt {
  param([Parameter(Mandatory)][object]$Boundary)
  if ([string]::IsNullOrWhiteSpace($ReceiptPath) -or $ReviewedReceiptSha256 -notmatch '^[a-f0-9]{64}$') { throw "The exact publication receipt and reviewed checksum are required." }
  $path = Resolve-GatewayOperatorPath $ReceiptPath -MustExist
  if ((Get-FileSha256 $path) -cne $ReviewedReceiptSha256) { throw "The publication receipt checksum does not match review." }
  $receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $zip = Assert-GatewayPublicationReceipt $receipt $SourceSha $Boundary.BoundarySha256
  foreach ($entry in @($receipt.artifacts)) { Assert-StoredObject $Boundary $entry }
  return [pscustomobject]@{ Path = $path; Receipt = $receipt; Artifact = $zip }
}
function Assert-LiveGateway {
  param([Parameter(Mandatory)][object]$Artifact)
  $alias = Invoke-AwsJson @("lambda", "get-alias", "--function-name", "ai-job-apply-development-gateway", "--name", "development", "--output", "json") "Gateway alias validation"
  if ([string]$alias.FunctionVersion -cnotmatch '^[1-9][0-9]*$') { throw "The development alias is not pinned to an immutable numeric version." }
  $function = Invoke-AwsJson @("lambda", "get-function", "--function-name", "ai-job-apply-development-gateway:development", "--output", "json") "Gateway function validation"
  if ([string]$function.Configuration.Version -cne [string]$alias.FunctionVersion -or [string]$function.Configuration.State -cne "Active" -or
      [string]$function.Configuration.LastUpdateStatus -cne "Successful" -or [string]$function.Configuration.CodeSha256 -cne [string]$Artifact.objectBase64Sha256 -or
      [string]$function.Configuration.Environment.Variables.RELEASE_SHA -cne [string]$Artifact.artifactSha256) { throw "The live gateway alias does not match the checksum-reviewed immutable artifact." }
}
function Invoke-ZeroDrift {
  param([Parameter(Mandatory)][object]$Baseline, [Parameter(Mandatory)][object]$Artifact, [switch]$EnableTailoringInvoke, [AllowNull()][object]$ProcessorArtifact = $null)
  $path = Join-Path $operatorRoot "verify-$($SourceSha.Substring(0,12))-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan"
  if (Test-Path $path) { throw "Refusing to overwrite a verification plan." }
  $saved = Save-AndClearTerraformVariables
  try {
    Set-VariablesFromPlan $Baseline.Plan $Artifact -EnableTailoringInvoke:$EnableTailoringInvoke -ProcessorArtifact $ProcessorArtifact
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m -detailed-exitcode "-out=$path" *> "$path.log"
    $exitCode = $LASTEXITCODE
  } finally { Restore-TerraformVariables $saved }
  if ($exitCode -ne 0) { throw "The post-release Terraform plan is not zero drift. Inspect the ignored verification log." }
  $plan = Read-Plan $path
  $terraformFiles = @(Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf" | Sort-Object Name)
  $declaredVariables = @($terraformFiles | ForEach-Object {
      $variableSource = Get-Content -LiteralPath $_.FullName -Raw
      [regex]::Matches($variableSource, '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') |
        ForEach-Object { $_.Groups[1].Value }
    })
  if ($terraformFiles.Count -eq 0 -or $declaredVariables.Count -eq 0 -or
      @($declaredVariables | Sort-Object -Unique).Count -ne $declaredVariables.Count) {
    throw "The gateway drift variable inventory is empty or duplicated."
  }
  $null = Assert-RetainedGatewayBaselinePlan $plan $declaredVariables
  $null = Assert-GatewayReleaseVariables $Baseline.Plan.variables $plan.variables $Artifact `
    $ExpectedAccountId $boundary.MigrationRepositoryUrl $Baseline.Metadata.ParserQualifiedArn `
    -ProcessorArtifact $ProcessorArtifact
  return Get-FileSha256 $path
}

$commit = Assert-CallerAndSource
Initialize-Backend
$boundary = Resolve-ArtifactBoundary
$null = New-Item -ItemType Directory -Path $operatorRoot -Force

if ($Action -ceq "Status") {
  [pscustomobject]@{ Environment = "development"; SourceSha = $commit; TerraformOwnedBucket = $true; CustomerKmsEncrypted = $true; MutationPerformed = $false } | ConvertTo-Json
  exit 0
}

if ($Action -ceq "CaptureBaseline") {
  if ([string]::IsNullOrWhiteSpace($BaselinePlanPath) -or
      $ReviewedBaselineSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]::IsNullOrWhiteSpace($DocumentReceiptPath) -or
      $ReviewedDocumentReceiptSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "Baseline capture requires a reviewed zero-drift seed and verified document receipt."
  }
  $seedPath = Resolve-GatewayOperatorPath $BaselinePlanPath -MustExist
  if ((Get-FileSha256 $seedPath) -cne $ReviewedBaselineSha256) {
    throw "The zero-drift seed checksum does not match review."
  }
  $seed = Read-Plan $seedPath -AllowHistorical
  $terraformFiles = @(Get-ChildItem -LiteralPath $terraformDirectory -File -Filter "*.tf" | Sort-Object Name)
  $declaredVariables = @($terraformFiles | ForEach-Object {
      $variableSource = Get-Content -LiteralPath $_.FullName -Raw
      [regex]::Matches($variableSource, '(?m)^\s*variable\s+"([a-zA-Z0-9_]+)"\s*\{') |
        ForEach-Object { $_.Groups[1].Value }
    })
  if ($terraformFiles.Count -eq 0 -or $declaredVariables.Count -eq 0 -or
      @($declaredVariables | Sort-Object -Unique).Count -ne $declaredVariables.Count) {
    throw "The baseline capture variable inventory is empty or duplicated."
  }
  $captureInputs = Get-GatewayCaptureSeedInputs $seed $declaredVariables

  $documentPath = Resolve-GatewayOperatorPath $DocumentReceiptPath -MustExist
  if ((Get-FileSha256 $documentPath) -cne $ReviewedDocumentReceiptSha256) {
    throw "The document receipt checksum does not match review."
  }
  $documentReceipt = Get-Content -LiteralPath $documentPath -Raw | ConvertFrom-Json
  $null = Assert-GatewayDocumentBaselineReceipt -Receipt $documentReceipt `
    -ReceiptSha256 $ReviewedDocumentReceiptSha256 -Plan $seed `
    -SourceSha ([string]$documentReceipt.sourceSha) -ExpectedBoundarySha256 $boundary.BoundarySha256

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $capturedPath = Resolve-GatewayOperatorPath `
    (Join-Path $operatorRoot "baseline-$($SourceSha.Substring(0,12))-$timestamp.tfplan") -ReleaseOnly
  $captureStateBefore = Get-StateIdentity
  $saved = Save-AndClearTerraformVariables
  try {
    Set-VariablesFromPlan $seed $null
    foreach ($entry in $captureInputs.DefaultVariables.GetEnumerator()) {
      Set-Item "Env:TF_VAR_$($entry.Key)" ([string]$entry.Value).ToLowerInvariant()
    }
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m `
      -detailed-exitcode "-out=$capturedPath" *> "$capturedPath.log"
    $exitCode = $LASTEXITCODE
  } finally { Restore-TerraformVariables $saved }
  if ($exitCode -ne 0) {
    if (Test-Path -LiteralPath $capturedPath) { Remove-Item -LiteralPath $capturedPath -Force }
    throw "Baseline capture did not produce an exact zero-drift plan."
  }
  $captured = Read-Plan $capturedPath
  $null = Assert-RetainedGatewayBaselinePlan $captured $declaredVariables
  Assert-GatewayCapturedSeedInputs $seed $captured $declaredVariables
  $null = Assert-GatewayDocumentBaselineReceipt -Receipt $documentReceipt `
    -ReceiptSha256 $ReviewedDocumentReceiptSha256 -Plan $captured `
    -SourceSha ([string]$documentReceipt.sourceSha) -ExpectedBoundarySha256 $boundary.BoundarySha256
  $state = Get-StateIdentity
  if ([string]$state.Lineage -cne [string]$captureStateBefore.Lineage -or [long]$state.Serial -ne [long]$captureStateBefore.Serial) {
    throw "Terraform state changed while capturing the current document baseline."
  }
  $stage = [string](Get-GatewayPlanVariableValue $captured.variables "document_processing_deployment_stage")
  $parserArn = [string](Get-GatewayPlanVariableValue $captured.variables "document_parser_invocation_qualified_arn")
  $null = Assert-RetainedGatewayParserBinding -Stage $stage -PlanParserQualifiedArn $parserArn `
    -MetadataParserQualifiedArn $parserArn -StateParserQualifiedArn $boundary.ParserQualifiedArn `
    -StateProcessorParserQualifiedArn $boundary.ProcessorParserQualifiedArn `
    -AccountId $ExpectedAccountId -Region $Region
  $migrationImage = [string](Get-GatewayPlanVariableValue $captured.variables "migration_image")
  if ($migrationImage -cnotmatch "^$([regex]::Escape([string]$boundary.MigrationRepositoryUrl))@sha256:[a-f0-9]{64}$") {
    throw "The captured baseline migration digest is outside the exact Terraform-owned repository."
  }
  $capturedSha = Get-FileSha256 $capturedPath
  $metadata = New-CurrentDocumentBaselineMetadata -Plan $captured -PlanPath $capturedPath `
    -PlanSha256 $capturedSha -State $state -SourceSha $SourceSha `
    -DocumentReleaseSourceSha ([string]$documentReceipt.sourceSha) -ReceiptSha256 $ReviewedDocumentReceiptSha256 `
    -AccountId $ExpectedAccountId -Region $Region -RepositoryRoot $repositoryRoot
  $null = Assert-CurrentDocumentBaselineEvidence -Metadata ([pscustomobject]$metadata) -Plan $captured `
    -PlanPath $capturedPath -PlanSha256 $capturedSha -CurrentState $state -SourceSha $SourceSha `
    -AccountId $ExpectedAccountId -Region $Region -RepositoryRoot $repositoryRoot `
    -ReceiptDirectory (Join-Path $terraformRoot "development-document-artifacts")
  $metadataPath = "$capturedPath.baseline.json"
  Write-ExclusiveJson $metadataPath $metadata
  [pscustomobject]@{
    Outcome = "captured-current-zero-drift"; BaselinePlanPath = $capturedPath
    BaselinePlanSha256 = $capturedSha; BaselineMetadataPath = $metadataPath
    BaselineMetadataSha256 = Get-FileSha256 $metadataPath; StateSerial = $state.Serial
    MeaningfulChanges = 0; MutationPerformed = $false
  } | ConvertTo-Json
  exit 0
}

if ($Action -ceq "Publish") {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  foreach ($gate in @(
      @{ Name = "gateway-tests"; Command = { pnpm --filter @ai-job-apply/gateway test } },
      @{ Name = "dependency-audit"; Command = { pnpm audit:dependencies } }
    )) {
    & $gate.Command *> (Join-Path $operatorRoot "$($gate.Name)-$timestamp.log")
    if ($LASTEXITCODE -ne 0) { throw "$($gate.Name) failed. Inspect the ignored local log." }
  }
  $previous = $env:ARTIFACT_SOURCE_SHA
  try {
    $env:ARTIFACT_SOURCE_SHA = $SourceSha
    pnpm --filter @ai-job-apply/gateway build:lambda *> (Join-Path $operatorRoot "build-one-$timestamp.log")
    if ($LASTEXITCODE -ne 0) { throw "The first gateway build failed." }; $first = Get-BuiltArtifact
    $fingerprint = @($first.Files.Values | ForEach-Object Sha256) -join "|"
    pnpm --filter @ai-job-apply/gateway build:lambda *> (Join-Path $operatorRoot "build-two-$timestamp.log")
    if ($LASTEXITCODE -ne 0) { throw "The second gateway build failed." }; $second = Get-BuiltArtifact
    if ((@($second.Files.Values | ForEach-Object Sha256) -join "|") -cne $fingerprint) { throw "The gateway builds were not byte-for-byte reproducible." }
  } finally { if ($null -eq $previous) { Remove-Item Env:ARTIFACT_SOURCE_SHA -ErrorAction SilentlyContinue } else { $env:ARTIFACT_SOURCE_SHA = $previous } }
  $prefix = "lambda/gateway/$SourceSha/$($second.ArtifactSha256)"
  $entries = @()
  foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
    $key = "$prefix/gateway-lambda.$suffix"
    $history = Invoke-AwsJson @("s3api", "list-object-versions", "--bucket", $boundary.Bucket, "--prefix", $key, "--max-keys", "20", "--output", "json") "Immutable destination validation"
    if (@(Get-GatewayKeyHistoryMatches -Result $history -Key $key).Count -ne 0) { throw "An immutable gateway destination key or delete marker already exists." }
    $file = $second.Files[$suffix]
    $entries += [ordered]@{ artifactName = $artifactName; artifactSha256 = $second.ArtifactSha256; suffix = $suffix; key = $key; versionId = ""; objectSha256 = $file.Sha256; objectBase64Sha256 = $file.Base64Sha256; contentLength = $file.Length; localPath = $file.Path }
  }
  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) { $ReceiptPath = Join-Path $operatorRoot "receipt-$($SourceSha.Substring(0,12))-$timestamp.json" }
  $receipt = Resolve-GatewayOperatorPath $ReceiptPath -ReleaseOnly
  $value = [ordered]@{ schemaVersion = 1; kind = "development-gateway-lambda-publication"; environment = "development"; region = $Region; sourceSha = $SourceSha; boundarySha256 = $boundary.BoundarySha256; phase = "publishing"; createdAt = (Get-Date).ToUniversalTime().ToString("o"); artifacts = @($entries | ForEach-Object { $copy = [ordered]@{}; foreach ($keyName in @("artifactName","artifactSha256","suffix","key","versionId","objectSha256","objectBase64Sha256","contentLength")) { $copy[$keyName] = $_[$keyName] }; $copy }) }
  Write-ExclusiveJson $receipt $value
  foreach ($entry in $entries) {
    $put = Invoke-AwsJson @("s3api", "put-object", "--bucket", $boundary.Bucket, "--key", $entry.key, "--body", $entry.localPath, "--checksum-algorithm", "SHA256", "--checksum-sha256", $entry.objectBase64Sha256, "--metadata", "source-sha=$SourceSha,artifact-sha256=$($entry.artifactSha256)", "--if-none-match", "*", "--output", "json") "Immutable gateway publication"
    if ([string]::IsNullOrWhiteSpace([string]$put.VersionId)) { throw "S3 did not return an immutable object version." }
    (@($value.artifacts | Where-Object key -CEQ $entry.key))[0].versionId = [string]$put.VersionId
    Write-ExclusiveJson $receipt $value -Replace
    Assert-StoredObject $boundary (@($value.artifacts | Where-Object key -CEQ $entry.key))[0]
  }
  $value.phase = "verified"; $value.completedAt = (Get-Date).ToUniversalTime().ToString("o"); Write-ExclusiveJson $receipt $value -Replace
  [pscustomobject]@{ Outcome = "published-and-verified"; ReceiptPath = $receipt; ReceiptSha256 = Get-FileSha256 $receipt; SourceSha = $SourceSha; PublishedObjectCount = 4; DeploymentChanged = $false } | ConvertTo-Json
  exit 0
}

$publication = Read-Receipt $boundary
if ($Action -ceq "VerifyPublication") {
  [pscustomobject]@{ Outcome = "verified"; SourceSha = $SourceSha; ReceiptSha256 = $ReviewedReceiptSha256; PublishedObjectCount = 4; DeploymentChanged = $false } | ConvertTo-Json
  exit 0
}
$baseline = Read-Baseline
$processorArtifact = Read-ProcessorRefreshArtifact

if ($Action -ceq "Verify") {
  $currentState = Get-StateIdentity
  if ([long]$currentState.Serial -ne [long]$baseline.Metadata.StateSerial) {
    if ([string]::IsNullOrWhiteSpace($PlanPath) -or $ReviewedPlanSha256 -notmatch '^[a-f0-9]{64}$') {
      throw "Post-apply verification requires the exact reviewed gateway release plan and SHA-256."
    }
    $reviewedPath = Resolve-GatewayOperatorPath $PlanPath -MustExist -ReleaseOnly
    if ((Get-FileSha256 $reviewedPath) -cne $ReviewedPlanSha256) {
      throw "The post-apply gateway release plan checksum does not match review."
    }
    $reviewedMetadataPath = "$reviewedPath$metadataSuffix"
    if (-not (Test-Path -LiteralPath $reviewedMetadataPath -PathType Leaf)) {
      throw "The post-apply gateway release plan metadata is missing."
    }
    $reviewedMetadata = Get-Content -LiteralPath $reviewedMetadataPath -Raw | ConvertFrom-Json
    Assert-ReviewedPlanMetadata $reviewedMetadata @{
      SchemaVersion = "1"; Kind = "development-gateway-release-plan"; Environment = "development"
      AccountId = $ExpectedAccountId; Region = $Region; StateBucket = $StateBucket; StateKey = "platform.tfstate"
      StateLineage = [string]$baseline.Metadata.StateLineage; StateSerial = [long]$baseline.Metadata.StateSerial
      SourceSha = $SourceSha; ReceiptSha256 = $ReviewedReceiptSha256
      BaselinePath = $baseline.Path; BaselineSha256 = $ReviewedBaselineSha256
      BaselineMetadataPath = $baseline.MetadataPath; BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256
      BaselineMetadataSchemaVersion = $baseline.MetadataSchemaVersion
      BaselineStage = [string]$baseline.Metadata.Stage
      BaselineParserQualifiedArn = [string]$baseline.Metadata.ParserQualifiedArn
      BaselineDocumentReceiptSha256 = $baseline.DocumentReceiptSha256
      BaselineStateLineage = [string]$baseline.Metadata.StateLineage
      BaselineStateSerial = [long]$baseline.Metadata.StateSerial
      BaselineMigrationImage = $baseline.MigrationImage
      MigrationImage = [string](Get-GatewayPlanVariableValue $baseline.Plan.variables "migration_image")
      PlanPath = $reviewedPath; PlanSha256 = $ReviewedPlanSha256
    }
    $reviewedPlan = Read-Plan $reviewedPath
    $null = Assert-GatewayReleaseVariables $baseline.Plan.variables $reviewedPlan.variables $publication.Artifact `
      $ExpectedAccountId $boundary.MigrationRepositoryUrl $baseline.Metadata.ParserQualifiedArn `
    -ProcessorArtifact $processorArtifact
    $null = Assert-ExactGatewayReleasePlan $reviewedPlan $publication.Artifact -ExpectedAccountId $ExpectedAccountId -ProcessorArtifact $processorArtifact
  }
  Assert-LiveGateway $publication.Artifact
  & (Join-Path $PSScriptRoot "verify-development-gateway-lambda-boundary.ps1") -AwsProfile $AwsProfile -AwsRegion $Region | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The direct development gateway/search boundary failed." }
  $driftSha = Invoke-ZeroDrift $baseline $publication.Artifact -EnableTailoringInvoke:$EnableDocumentTailoringInvoke -ProcessorArtifact $processorArtifact
  [pscustomobject]@{ Outcome = "verified"; SourceSha = $SourceSha; AliasImmutable = $true; SearchBoundary = "passed"; Drift = $false; VerificationPlanSha256 = $driftSha } | ConvertTo-Json
  exit 0
}

if ($Action -ceq "Plan") {
  if ([string]::IsNullOrWhiteSpace($PlanPath)) { $PlanPath = Join-Path $operatorRoot "release-$($SourceSha.Substring(0,12))-$(Get-Date -Format 'yyyyMMdd-HHmmss').tfplan" }
  $path = Resolve-GatewayOperatorPath $PlanPath -ReleaseOnly
  if (Test-Path $path) { throw "Refusing to overwrite a release plan." }
  $state = Get-StateIdentity; $saved = Save-AndClearTerraformVariables
  try {
    Set-VariablesFromPlan $baseline.Plan $publication.Artifact -EnableTailoringInvoke:$EnableDocumentTailoringInvoke -ProcessorArtifact $processorArtifact
    & terraform "-chdir=$terraformDirectory" plan -refresh=true -input=false -lock-timeout=5m -detailed-exitcode "-out=$path" *> "$path.log"
    $exitCode = $LASTEXITCODE
  } finally { Restore-TerraformVariables $saved }
  if ($exitCode -ne 2) { if (Test-Path $path) { Remove-Item $path -Force }; throw "The gateway release did not produce an exact reviewable change." }
  $plan = Read-Plan $path
  $null = Assert-GatewayReleaseVariables $baseline.Plan.variables $plan.variables $publication.Artifact `
    $ExpectedAccountId $boundary.MigrationRepositoryUrl $baseline.Metadata.ParserQualifiedArn `
    -ProcessorArtifact $processorArtifact
  $changes = @(Assert-ExactGatewayReleasePlan $plan $publication.Artifact -ExpectedAccountId $ExpectedAccountId -ProcessorArtifact $processorArtifact)
  $sha = Get-FileSha256 $path
  $metadata = [ordered]@{ SchemaVersion = "1"; Kind = "development-gateway-release-plan"; Environment = "development"; AccountId = $ExpectedAccountId; Region = $Region; StateBucket = $StateBucket; StateKey = "platform.tfstate"; StateLineage = $state.Lineage; StateSerial = $state.Serial; SourceSha = $SourceSha; ReceiptSha256 = $ReviewedReceiptSha256; BaselinePath = $baseline.Path; BaselineSha256 = $ReviewedBaselineSha256; BaselineMetadataPath = $baseline.MetadataPath; BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256; BaselineMetadataSchemaVersion = $baseline.MetadataSchemaVersion; BaselineStage = [string]$baseline.Metadata.Stage; BaselineParserQualifiedArn = [string]$baseline.Metadata.ParserQualifiedArn; BaselineDocumentReceiptSha256 = $baseline.DocumentReceiptSha256; BaselineStateLineage = [string]$baseline.Metadata.StateLineage; BaselineStateSerial = [long]$baseline.Metadata.StateSerial; BaselineMigrationImage = $baseline.MigrationImage; MigrationImage = [string](Get-GatewayPlanVariableValue $baseline.Plan.variables "migration_image"); PlanPath = $path; PlanSha256 = $sha; ChangedResources = @($changes | ForEach-Object address | Sort-Object); CreatedAt = (Get-Date).ToUniversalTime().ToString("o") }
  Write-ExclusiveJson "$path$metadataSuffix" $metadata
  [pscustomobject]@{ Outcome = "review-required"; PlanPath = $path; PlanSha256 = $sha; Updates = $changes.Count; ApprovalCommand = "Apply reviewed development gateway release plan $sha" } | ConvertTo-Json
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlanPath) -or $ReviewedPlanSha256 -notmatch '^[a-f0-9]{64}$') { throw "Apply requires the exact reviewed release plan and SHA-256." }
$path = Resolve-GatewayOperatorPath $PlanPath -MustExist -ReleaseOnly
if ((Get-FileSha256 $path) -cne $ReviewedPlanSha256) { throw "The gateway release plan checksum does not match review." }
$metadataPath = "$path$metadataSuffix"
if (-not (Test-Path $metadataPath -PathType Leaf)) { throw "The gateway release plan metadata is missing." }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
Assert-ReviewedPlanMetadata $metadata @{ SchemaVersion = "1"; Kind = "development-gateway-release-plan"; Environment = "development"; AccountId = $ExpectedAccountId; Region = $Region; StateBucket = $StateBucket; StateKey = "platform.tfstate"; SourceSha = $SourceSha; ReceiptSha256 = $ReviewedReceiptSha256; BaselinePath = $baseline.Path; BaselineSha256 = $ReviewedBaselineSha256; BaselineMetadataPath = $baseline.MetadataPath; BaselineMetadataSha256 = $ReviewedBaselineMetadataSha256; BaselineMetadataSchemaVersion = $baseline.MetadataSchemaVersion; BaselineStage = [string]$baseline.Metadata.Stage; BaselineParserQualifiedArn = [string]$baseline.Metadata.ParserQualifiedArn; BaselineDocumentReceiptSha256 = $baseline.DocumentReceiptSha256; BaselineStateLineage = [string]$baseline.Metadata.StateLineage; BaselineStateSerial = [long]$baseline.Metadata.StateSerial; BaselineMigrationImage = $baseline.MigrationImage; MigrationImage = [string](Get-GatewayPlanVariableValue $baseline.Plan.variables "migration_image"); PlanPath = $path; PlanSha256 = $ReviewedPlanSha256 }
$state = Get-StateIdentity
if ([string]$state.Lineage -cne [string]$metadata.StateLineage -or [long]$state.Serial -ne [long]$metadata.StateSerial) { throw "Remote state changed after review; generate a new gateway release plan." }
$plan = Read-Plan $path
$null = Assert-GatewayReleaseVariables $baseline.Plan.variables $plan.variables $publication.Artifact `
  $ExpectedAccountId $boundary.MigrationRepositoryUrl $baseline.Metadata.ParserQualifiedArn `
    -ProcessorArtifact $processorArtifact
$null = Assert-ExactGatewayReleasePlan $plan $publication.Artifact -ExpectedAccountId $ExpectedAccountId -ProcessorArtifact $processorArtifact
& terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $path *> "$path.apply.log"
if ($LASTEXITCODE -ne 0) { throw "The exact reviewed gateway release plan failed to apply." }
Assert-LiveGateway $publication.Artifact
& (Join-Path $PSScriptRoot "verify-development-gateway-lambda-boundary.ps1") -AwsProfile $AwsProfile -AwsRegion $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The direct development gateway/search boundary failed after apply." }
$driftSha = Invoke-ZeroDrift $baseline $publication.Artifact -EnableTailoringInvoke:$EnableDocumentTailoringInvoke -ProcessorArtifact $processorArtifact
[pscustomobject]@{ Outcome = "applied-and-verified"; SourceSha = $SourceSha; AliasImmutable = $true; SearchBoundary = "passed"; Drift = $false; VerificationPlanSha256 = $driftSha } | ConvertTo-Json
