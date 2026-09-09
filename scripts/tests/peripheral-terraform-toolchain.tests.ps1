Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
. (Join-Path $repositoryRoot "scripts/lib/terraform-toolchain.ps1")

$passed = 0
function Assert-Test([bool]$Condition, [string]$Description) {
  if (-not $Condition) { throw $Description }
  $script:passed += 1
}
function Assert-Rejected([scriptblock]$Operation, [string]$Description) {
  $rejected = $false
  try { $null = & $Operation } catch { $rejected = $true }
  Assert-Test $rejected $Description
}
function Read-OperatorAst([string]$Name) {
  $path = Join-Path $repositoryRoot "scripts/$Name.ps1"
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-Test (@($errors).Count -eq 0) "$Name must parse."
  return $ast
}
function Import-OperatorFunction([object]$Ast, [string]$Name) {
  $definitions = @($Ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  Assert-Test ($definitions.Count -eq 1) "Expected one exact $Name function."
  Set-Item "Function:script:$Name" -Value ([scriptblock]::Create(
      $definitions[0].Body.Extent.Text.TrimStart('{').TrimEnd('}')))
}

$names = @(
  "inspect-deployed-outbox", "inspect-staging-workload-and-cost",
  "operate-development-candidate-rights-acceptance", "operate-development-candidate-rights-stage-b",
  "operate-development-d1-provider-failure-acceptance", "operate-development-document-processing-acceptance",
  "operate-development-ingestion-dark-release", "operate-development-job-search-acceptance",
  "operate-staging-runtime-lifecycle", "operate-staging-postgresql-restore",
  "publish-development-document-lambdas", "publish-development-migration-image", "start-deployed-web-conformance"
)
$remoteInitializers = @(
  "inspect-staging-workload-and-cost", "operate-development-candidate-rights-stage-b",
  "operate-development-document-processing-acceptance", "operate-staging-runtime-lifecycle",
  "publish-development-document-lambdas", "publish-development-migration-image", "start-deployed-web-conformance"
)
$asts = @{}
foreach ($name in $names) {
  $ast = Read-OperatorAst $name
  $asts[$name] = $ast
  $source = $ast.Extent.Text
  Assert-Test ($source.Contains('lib/terraform-toolchain.ps1')) "$name must import the shared toolchain."
  Assert-Test (-not $source.Contains('Terraform 1.9.8 is required')) "$name must not require the legacy executable."
  if ($name -cne "operate-development-job-search-acceptance") {
    Assert-Test ($source.Contains('Assert-DeploymentTerraformCli')) "$name must validate the current CLI."
  }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "peripheral-terraform-$([guid]::NewGuid().ToString('N'))"
$terraformDirectory = Join-Path $testRoot "environment"
$terraformDataDirectory = Join-Path $terraformDirectory ".terraform"
$terraformRuntimeData = $terraformDataDirectory
$StateBucket = "synthetic-development-terraform-state"
$stateKey = "platform.tfstate"
$Region = "us-east-2"
$AwsRegion = $Region
$ExpectedAccountId = "111122223333"
$kmsKeyArn = "arn:aws:kms:us-east-2:111122223333:key/11111111-2222-3333-4444-555555555555"
$kmsArn = $kmsKeyArn
$stateKmsArn = $kmsKeyArn
$stateKmsKeyArn = $kmsKeyArn
$priorDataDirectory = $env:TF_DATA_DIR
$script:backendMutation = ""
$script:initCalls = 0
$script:headCalls = 0

# Only the exact init fragments/functions are executed. AWS is synthetic and the native
# Terraform name is intercepted; the production backend validator itself remains real.
function terraform {
  $nativeArguments = @($args | ForEach-Object { [string]$_ })
  if ($nativeArguments.Count -lt 2 -or $nativeArguments[0] -cne "-chdir=$terraformDirectory" -or
      $nativeArguments[1] -cne "init") { throw "Unexpected Terraform command in synthetic initializer." }
  foreach ($required in @("-reconfigure", "-input=false", "-lockfile=readonly",
      "-backend-config=bucket=$StateBucket", "-backend-config=key=$stateKey",
      "-backend-config=region=$Region", "-backend-config=kms_key_id=$kmsKeyArn",
      "-backend-config=encrypt=true", "-backend-config=use_lockfile=true")) {
    if (@($nativeArguments | Where-Object { $_ -ceq $required }).Count -ne 1) {
      throw "An initializer omitted or duplicated a required exact backend flag."
    }
  }
  $script:initCalls += 1
  $config = [ordered]@{
    bucket = $StateBucket; key = $stateKey; region = $Region; kms_key_id = $kmsKeyArn
    encrypt = $true; use_lockfile = $true
  }
  switch ($script:backendMutation) {
    "lock-false" { $config.use_lockfile = $false }
    "lock-string" { $config.use_lockfile = "true" }
    "lock-absent" { $config.Remove("use_lockfile") }
    "encrypt-false" { $config.encrypt = $false }
    "bucket" { $config.bucket = "other-terraform-state" }
    "key" { $config.key = "other.tfstate" }
    "region" { $config.region = "us-east-1" }
    "kms" { $config.kms_key_id = $kmsKeyArn.Replace("111122223333", "444455556666") }
    "profile" { $config.profile = "unexpected" }
    "endpoint" { $config.endpoint = "https://example.invalid" }
  }
  $metadata = [ordered]@{ backend = [ordered]@{ type = "s3"; config = $config } }
  [IO.File]::WriteAllText((Join-Path $terraformDataDirectory "terraform.tfstate"),
    ($metadata | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
  $global:LASTEXITCODE = 0
}
function aws { throw "Direct AWS commands are forbidden in this synthetic test." }
function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Operation)
  if (($Arguments[0..1] -join " ") -ceq "s3api get-bucket-encryption") {
    return [pscustomobject]@{ ServerSideEncryptionConfiguration = [pscustomobject]@{
        Rules = @([pscustomobject]@{ BucketKeyEnabled = $true
            ApplyServerSideEncryptionByDefault = [pscustomobject]@{ SSEAlgorithm = "aws:kms"; KMSMasterKeyID = $kmsKeyArn }
          })
      } }
  }
  if (($Arguments[0..1] -join " ") -ceq "s3api head-object") {
    $script:headCalls += 1
    return [pscustomobject]@{ ServerSideEncryption = "aws:kms"; SSEKMSKeyId = $kmsKeyArn
      BucketKeyEnabled = $true; ContentLength = 100; VersionId = "synthetic-version" }
  }
  throw "Unexpected AWS fixture operation."
}

try {
  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $env:TF_DATA_DIR = $terraformDataDirectory
  foreach ($name in $remoteInitializers) {
    $ast = $asts[$name]
    $source = $ast.Extent.Text
    $initializers = @($ast.FindAll({
          param($node)
          $node -is [Management.Automation.Language.CommandAst] -and
          $node.GetCommandName() -ceq "terraform" -and
          @($node.CommandElements | Where-Object { $_.Extent.Text -ceq "init" }).Count -eq 1
        }, $true))
    Assert-Test ($initializers.Count -eq 1) "$name must contain one explicit remote init."
    $init = $initializers[0]
    $backendChecks = @($ast.FindAll({
          param($node)
          $node -is [Management.Automation.Language.CommandAst] -and
          $node.GetCommandName() -ceq "Assert-DeploymentTerraformBackend"
        }, $true) | Where-Object { $_.Extent.StartOffset -gt $init.Extent.EndOffset })
    Assert-Test ($backendChecks.Count -eq 1) "$name must validate its initialized effective backend."
    $check = $backendChecks[0]
    $fragment = $source.Substring($init.Parent.Extent.StartOffset,
      $check.Extent.EndOffset - $init.Parent.Extent.StartOffset)
    Assert-Test (-not ($fragment -match 'terraform[^\r\n]*\s(?:plan|apply)\s')) "$name must check before plan/apply."
    $operation = [scriptblock]::Create($fragment)
    $script:backendMutation = ""
    $before = $script:initCalls
    & $operation
    Assert-Test ($script:initCalls -eq $before + 1) "$name must initialize once before checking."
    foreach ($mutation in @("lock-false", "lock-string", "lock-absent", "encrypt-false", "bucket", "key", "region", "kms", "profile", "endpoint")) {
      $script:backendMutation = $mutation
      Assert-Rejected $operation "$name must reject cached backend mutation $mutation."
    }
  }

  # Exercise complete maintained initialization functions as well as all seven inline paths.
  foreach ($name in @("operate-staging-runtime-lifecycle", "publish-development-document-lambdas", "publish-development-migration-image")) {
    Import-OperatorFunction $asts[$name] "Initialize-Backend"
    $script:backendMutation = ""
    Initialize-Backend
    $script:backendMutation = "lock-false"
    $headCallsBefore = $script:headCalls
    Assert-Rejected { Initialize-Backend } "$name must reject an unlocked backend before using state."
    Assert-Test ($script:headCalls -eq $headCallsBefore) "$name continued after failed backend validation."
  }

  # Inspect actual plan-reader commands: retained inputs are explicit, but plans which can
  # reach apply may never request the legacy decoder. The ingestion Verify action is read-only.
  foreach ($name in @("operate-staging-runtime-lifecycle", "operate-development-candidate-rights-stage-b")) {
    $calls = @($asts[$name].FindAll({
          param($node)
          $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq "Read-DeploymentTerraformPlan"
        }, $true))
    $historical = @($calls | Where-Object { $_.Extent.Text.Contains("-AllowHistorical") })
    Assert-Test ($historical.Count -eq 1) "$name must reserve historical decoding for the one retained input."
    Assert-Test (@($calls | Where-Object { $_.Extent.Text.Contains('-Path $resolvedPlan') -and $_.Extent.Text.Contains('-AllowHistorical') }).Count -eq 0) "$name must not apply a historically decoded plan."
  }
  $ingestionSource = $asts["operate-development-ingestion-dark-release"].Extent.Text
  Assert-Test ($ingestionSource.Contains('-AllowHistorical:($Action -ceq "Verify")')) "Only read-only ingestion verification may decode historical applied release plans."
  Import-OperatorFunction $asts["operate-development-ingestion-dark-release"] "Invoke-TerraformJson"
  $actualReader = ${function:Read-DeploymentTerraformPlan}
  try {
    function Read-DeploymentTerraformPlan {
      param([string]$Path, [string]$TerraformDirectory, [switch]$AllowHistorical)
      if ($Path -cne "synthetic-current.tfplan" -or $AllowHistorical) { throw "Executable plan incorrectly selected historical decoding." }
      return [pscustomobject]@{ terraform_version = "1.16.2" }
    }
    $plan = Invoke-TerraformJson @("show", "-json", "synthetic-current.tfplan") "Synthetic current release inspection"
    Assert-Test ($plan.terraform_version -ceq "1.16.2") "Ingestion release plan did not pass through the current decoder."
  } finally { Set-Item Function:Read-DeploymentTerraformPlan -Value $actualReader }
} finally {
  $env:TF_DATA_DIR = $priorDataDirectory
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporaryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^peripheral-terraform-[a-f0-9]{32}$') {
      throw "Refusing cleanup outside the exact synthetic fixture directory."
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
Write-Output "Peripheral Terraform toolchain guards: $passed passed."
