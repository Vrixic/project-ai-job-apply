[CmdletBinding()]
param(
  [ValidateSet("development", "staging")]
  [string]$Environment = "development",

  [ValidatePattern("^[0-9]{12}$")]
  [string]$ExpectedAccountId,

  [ValidatePattern("^[a-z0-9.-]+$")]
  [string]$StateBucket,

  [ValidatePattern("^[0-9]+$")]
  [string]$OidcEvidenceRunId,

  [string]$AwsProfile,

  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")]
  [string]$Region = "us-east-2",

  [switch]$AllowStateKmsCorrection,

  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\plan-serverless-workflow-bootstrap.ps1 `
    -Environment development|staging `
    -ExpectedAccountId ACCOUNT_ID `
    -StateBucket TERRAFORM_STATE_BUCKET `
    -OidcEvidenceRunId SUCCESSFUL_GITHUB_RUN_ID `
    [-AllowStateKmsCorrection]

Creates a refresh-backed saved plan for the selected environment's bootstrap IAM changes required by the
serverless workflow release. The guard verifies the exact AWS account and region, encrypted
bootstrap state, immutable GitHub repository identity, effective OIDC trust, and one successful
protected-environment OIDC publication run. It accepts exactly three in-place policy updates:
the GitHub deployment boundary, its matching inline policy, and the workload boundary.

The sensitive saved plan remains under the ignored bootstrap .terraform directory for separate
review and checksum-gated application. This script never applies infrastructure.

The optional correction switch accepts only a private, versioned SSE-S3 bootstrap state object
whose bucket already has the reviewed customer-managed KMS default. The saved plan still contains
only the three IAM updates; a checksum-authorized apply through the corrected backend rewrites the
active state under that KMS key.
"@
  exit 0
}

if (-not $ExpectedAccountId -or -not $StateBucket -or -not $OidcEvidenceRunId) {
  throw "The expected account, state bucket, and successful OIDC evidence run are required."
}
if (-not $AwsProfile) {
  $AwsProfile = "ai-job-apply-$Environment-admin"
}
if ($Region -ne "us-east-2") {
  throw "The Phase 0 $Environment environment is restricted to us-east-2."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$bootstrapDirectory = Join-Path $repositoryRoot "infrastructure/terraform/bootstrap"
$terraformDataDirectory = Join-Path $bootstrapDirectory ".terraform/sr005-$Environment-plan-data"
$planDirectory = Join-Path $bootstrapDirectory ".terraform/sr005-$Environment-plans"
$expectedRepository = "Vrixic/project-ai-job-apply"
$expectedOwnerId = "92821975"
$expectedRepositoryId = "1315131410"
$subjectPrefix = "repo:Vrixic@$expectedOwnerId/project-ai-job-apply@$expectedRepositoryId"
$expectedSubject = "${subjectPrefix}:environment:$Environment"
$roleName = "ai-job-apply-$Environment-github-deploy"

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $raw = & aws @Arguments --profile $AwsProfile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($Arguments | Select-Object -First 2) -join " "
    throw "The AWS '$operation' read failed. Refresh the $Environment SSO session and retry."
  }
  return $raw | ConvertFrom-Json
}

function Get-OnlyItem {
  param(
    [Parameter(Mandatory = $true)][object[]]$Items,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  if ($Items.Count -ne 1) {
    throw $FailureMessage
  }
  return $Items[0]
}

function Get-Statement {
  param(
    [Parameter(Mandatory = $true)][object]$Policy,
    [Parameter(Mandatory = $true)][string]$Sid
  )

  return Get-OnlyItem `
    -Items @($Policy.Statement | Where-Object { [string]$_.Sid -eq $Sid }) `
    -FailureMessage "The reviewed '$Sid' policy statement is missing or duplicated."
}

function Assert-ExactSet {
  param(
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][object[]]$Expected,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $actualStrings = @($Actual | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $expectedStrings = @($Expected | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $unexpected = @($actualStrings | Where-Object { $expectedStrings -notcontains $_ })
  $missing = @($expectedStrings | Where-Object { $actualStrings -notcontains $_ })
  if (
    $actualStrings.Count -ne $expectedStrings.Count -or
    $unexpected.Count -ne 0 -or
    $missing.Count -ne 0
  ) {
    throw "$FailureMessage Actual=[$($actualStrings -join ',')] Expected=[$($expectedStrings -join ',')]."
  }
}

function ConvertTo-NormalizedJson {
  param([Parameter(Mandatory = $true)][object]$Value)
  return $Value | ConvertTo-Json -Depth 40 -Compress
}

function Assert-PoliciesEquivalent {
  param(
    [Parameter(Mandatory = $true)][object]$Left,
    [Parameter(Mandatory = $true)][object]$Right,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  $leftStatements = @($Left.Statement)
  $rightStatements = @($Right.Statement)
  if ($leftStatements.Count -ne $rightStatements.Count) {
    throw $FailureMessage
  }
  Assert-ExactSet `
    -Actual @($leftStatements | ForEach-Object { [string]$_.Sid }) `
    -Expected @($rightStatements | ForEach-Object { [string]$_.Sid }) `
    -FailureMessage $FailureMessage
  foreach ($leftStatement in $leftStatements) {
    $rightStatement = Get-Statement $Right ([string]$leftStatement.Sid)
    if ([string]$leftStatement.Effect -ne [string]$rightStatement.Effect) {
      throw $FailureMessage
    }
    Assert-ExactSet `
      -Actual @($leftStatement.Action) `
      -Expected @($rightStatement.Action) `
      -FailureMessage $FailureMessage
    Assert-ExactSet `
      -Actual @($leftStatement.Resource) `
      -Expected @($rightStatement.Resource) `
      -FailureMessage $FailureMessage
    $leftCondition = if ($null -eq $leftStatement.Condition) {
      "<absent>"
    } else {
      ConvertTo-NormalizedJson $leftStatement.Condition
    }
    $rightCondition = if ($null -eq $rightStatement.Condition) {
      "<absent>"
    } else {
      ConvertTo-NormalizedJson $rightStatement.Condition
    }
    if ($leftCondition -ne $rightCondition) {
      throw $FailureMessage
    }
  }
}

foreach ($command in @("aws", "gh", "git", "terraform")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required."
  }
}
$terraformVersion = (& terraform version -json | ConvertFrom-Json).terraform_version
if ([string]$terraformVersion -ne "1.9.8") {
  throw "Terraform 1.9.8 is required; found $terraformVersion."
}

$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch "^[a-f0-9]{40}$") {
  throw "The repository source commit could not be resolved."
}
& git -C $repositoryRoot diff --quiet -- infrastructure/terraform/bootstrap
if ($LASTEXITCODE -ne 0) {
  throw "Bootstrap Terraform has uncommitted changes; plan only committed source."
}

$repository = gh api "repos/$expectedRepository" 2>$null | ConvertFrom-Json
if (
  $LASTEXITCODE -ne 0 -or
  [string]$repository.full_name -ne $expectedRepository -or
  [string]$repository.owner.id -ne $expectedOwnerId -or
  [string]$repository.id -ne $expectedRepositoryId
) {
  throw "The authenticated GitHub repository does not match the immutable repository identity."
}
$oidcRun = gh api "repos/$expectedRepository/actions/runs/$OidcEvidenceRunId" 2>$null |
  ConvertFrom-Json
if (
  $LASTEXITCODE -ne 0 -or
  [string]$oidcRun.name -ne "Publish workflow Lambda artifacts" -or
  [string]$oidcRun.event -ne "workflow_dispatch" -or
  [string]$oidcRun.head_branch -ne "main" -or
  [string]$oidcRun.head_sha -ne $sourceCommit -or
  [string]$oidcRun.head_repository.full_name -ne $expectedRepository -or
  [string]$oidcRun.status -ne "completed" -or
  [string]$oidcRun.conclusion -ne "success"
) {
  throw "The supplied GitHub run is not a successful workflow-artifact OIDC publication from the exact current main commit."
}

$caller = Invoke-AwsJson @("sts", "get-caller-identity", "--output", "json")
if (
  [string]$caller.Account -ne $ExpectedAccountId -or
  -not ([string]$caller.Arn).Contains(":assumed-role/")
) {
  throw "Use the temporary IAM Identity Center session for the exact $Environment account."
}

$role = (Invoke-AwsJson @("iam", "get-role", "--role-name", $roleName, "--output", "json")).Role
$trustStatements = @($role.AssumeRolePolicyDocument.Statement)
$trust = Get-OnlyItem `
  -Items @($trustStatements | Where-Object { @($_.Action) -contains "sts:AssumeRoleWithWebIdentity" }) `
  -FailureMessage "The deployment role does not have one reviewed web-identity trust statement."
if (
  [string]$trust.Effect -ne "Allow" -or
  [string]$trust.Condition.StringEquals."token.actions.githubusercontent.com:aud" -ne
    "sts.amazonaws.com" -or
  [string]$trust.Condition.StringEquals."token.actions.githubusercontent.com:sub" -ne
    $expectedSubject -or
  [string]$trust.Principal.Federated -ne
    "arn:aws:iam::${ExpectedAccountId}:oidc-provider/token.actions.githubusercontent.com"
) {
  throw "The effective $Environment GitHub OIDC trust is outside the immutable reviewed boundary."
}

$stateKmsKeyArn = $null
$previousProfile = $env:AWS_PROFILE
$previousRegion = $env:AWS_REGION
$previousDefaultRegion = $env:AWS_DEFAULT_REGION
$previousTerraformDataDirectory = $env:TF_DATA_DIR
$previousAccessKeyId = $env:AWS_ACCESS_KEY_ID
$previousSecretAccessKey = $env:AWS_SECRET_ACCESS_KEY
$previousSessionToken = $env:AWS_SESSION_TOKEN

try {
  $env:AWS_PROFILE = $AwsProfile
  $env:AWS_REGION = $Region
  $env:AWS_DEFAULT_REGION = $Region
  $env:TF_DATA_DIR = $terraformDataDirectory

  $exportedCredentials = & aws configure export-credentials `
    --profile $AwsProfile `
    --format process 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The short-lived $Environment credentials could not be exported for Terraform."
  }
  $processCredentials = $exportedCredentials | ConvertFrom-Json
  if (
    -not $processCredentials.AccessKeyId -or
    -not $processCredentials.SecretAccessKey -or
    -not $processCredentials.SessionToken
  ) {
    throw "The exported $Environment credentials are incomplete."
  }
  $env:AWS_ACCESS_KEY_ID = [string]$processCredentials.AccessKeyId
  $env:AWS_SECRET_ACCESS_KEY = [string]$processCredentials.SecretAccessKey
  $env:AWS_SESSION_TOKEN = [string]$processCredentials.SessionToken

  $null = New-Item -ItemType Directory -Path $terraformDataDirectory -Force
  $null = New-Item -ItemType Directory -Path $planDirectory -Force

  $versioning = Invoke-AwsJson @(
    "s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json"
  )
  if ([string]$versioning.Status -ne "Enabled") {
    throw "The $Environment state bucket does not have versioning enabled."
  }
  $publicAccess = Invoke-AwsJson @(
    "s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json"
  )
  $publicConfig = $publicAccess.PublicAccessBlockConfiguration
  if (
    -not [bool]$publicConfig.BlockPublicAcls -or
    -not [bool]$publicConfig.IgnorePublicAcls -or
    -not [bool]$publicConfig.BlockPublicPolicy -or
    -not [bool]$publicConfig.RestrictPublicBuckets
  ) {
    throw "The $Environment state bucket public-access block is incomplete."
  }
  $stateEncryption = Invoke-AwsJson @(
    "s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json"
  )
  $stateKmsRule = Get-OnlyItem `
    -Items @(
      $stateEncryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
        $_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -eq "aws:kms" -and
        $_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -and
        [bool]$_.BucketKeyEnabled
      }
    ) `
    -FailureMessage "The $Environment state bucket does not expose one bucket-key-enabled KMS default."
  $stateKmsKeyArn = [string]$stateKmsRule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID
  if (
    $stateKmsKeyArn -notmatch
      "^arn:aws:kms:$([regex]::Escape($Region)):$([regex]::Escape($ExpectedAccountId)):key/"
  ) {
    throw "The $Environment state KMS key is outside the expected account or region."
  }
  $stateObject = Invoke-AwsJson @(
    "s3api", "head-object", "--bucket", $StateBucket, "--key", "bootstrap.tfstate",
    "--checksum-mode", "ENABLED", "--output", "json"
  )
  $stateUsesExpectedKms = -not (
    [string]$stateObject.ServerSideEncryption -ne "aws:kms" -or
    [string]$stateObject.SSEKMSKeyId -ne $stateKmsKeyArn -or
    -not [bool]$stateObject.BucketKeyEnabled -or
    -not $stateObject.VersionId
  )
  $stateUsesCorrectableSseS3 = (
    [string]$stateObject.ServerSideEncryption -eq "AES256" -and
    -not $stateObject.SSEKMSKeyId -and
    -not [bool]$stateObject.BucketKeyEnabled -and
    [bool]$stateObject.VersionId
  )
  if (-not $stateUsesExpectedKms -and -not (
    $AllowStateKmsCorrection -and $stateUsesCorrectableSseS3
  )) {
    throw "The remote bootstrap state is not a versioned object under the reviewed KMS boundary."
  }

  $initOutput = & terraform "-chdir=$bootstrapDirectory" init -reconfigure -input=false `
    "-backend-config=bucket=$StateBucket" `
    "-backend-config=key=bootstrap.tfstate" `
    "-backend-config=region=$Region" `
    "-backend-config=kms_key_id=$stateKmsKeyArn" 2>&1
  if ($LASTEXITCODE -ne 0) {
    $diagnostic = (@($initOutput) | Select-Object -Last 8) -join " "
    throw "Terraform could not initialize the encrypted bootstrap backend: $diagnostic"
  }

  $planPath = Join-Path $planDirectory "serverless-workflow-$Environment-$($sourceCommit.Substring(0, 8)).tfplan"
  $planOutput = & terraform "-chdir=$bootstrapDirectory" plan -input=false -lock-timeout=5m `
    -detailed-exitcode "-out=$planPath" `
    "-var=environment=$Environment" `
    "-var=state_bucket_name=$StateBucket" `
    "-var=github_environment=$Environment" `
    "-var=github_oidc_subject_prefix=$subjectPrefix" 2>&1
  $planExitCode = $LASTEXITCODE
  if ($planExitCode -ne 2) {
    $diagnostic = (@($planOutput) | Select-Object -Last 12) -join " "
    throw "The bootstrap plan did not produce the required reviewed change set (exit $planExitCode): $diagnostic"
  }

  $planJsonRaw = & terraform "-chdir=$bootstrapDirectory" show -json $planPath 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "The sensitive saved bootstrap plan could not be rendered for validation."
  }
  $plan = $planJsonRaw | ConvertFrom-Json
  $expectedUpdates = @(
    "aws_iam_policy.github_deploy_boundary",
    "aws_iam_policy.workload_boundary",
    "aws_iam_role_policy.github_deploy"
  )
  $changes = @(
    $plan.resource_changes | Where-Object { (@($_.change.actions) -join ",") -ne "no-op" }
  )
  if ($changes.Count -ne 3) {
    throw "The bootstrap plan must contain exactly three resource changes."
  }
  foreach ($change in $changes) {
    Assert-ExactSet `
      -Actual @($change.change.actions) `
      -Expected @("update") `
      -FailureMessage "The bootstrap plan contains a create, delete, or replacement."
  }
  Assert-ExactSet `
    -Actual @($changes | ForEach-Object { [string]$_.address }) `
    -Expected $expectedUpdates `
    -FailureMessage "The bootstrap plan changes a resource outside the three reviewed IAM policies."

  $managedChange = Get-OnlyItem `
    -Items @($changes | Where-Object { $_.address -eq "aws_iam_policy.github_deploy_boundary" }) `
    -FailureMessage "The GitHub managed-boundary update is missing."
  $inlineChange = Get-OnlyItem `
    -Items @($changes | Where-Object { $_.address -eq "aws_iam_role_policy.github_deploy" }) `
    -FailureMessage "The GitHub inline-policy update is missing."
  $workloadChange = Get-OnlyItem `
    -Items @($changes | Where-Object { $_.address -eq "aws_iam_policy.workload_boundary" }) `
    -FailureMessage "The workload-boundary update is missing."

  $managedBefore = ([string]$managedChange.change.before.policy) | ConvertFrom-Json
  $managedAfter = ([string]$managedChange.change.after.policy) | ConvertFrom-Json
  $inlineBefore = ([string]$inlineChange.change.before.policy) | ConvertFrom-Json
  $inlineAfter = ([string]$inlineChange.change.after.policy) | ConvertFrom-Json
  Assert-PoliciesEquivalent `
    -Left $managedBefore `
    -Right $inlineBefore `
    -FailureMessage "The existing managed GitHub boundary and inline policy are not equivalent."
  Assert-PoliciesEquivalent `
    -Left $managedAfter `
    -Right $inlineAfter `
    -FailureMessage "The planned managed GitHub boundary and inline policy are not equivalent."

  $stackStatement = Get-Statement $managedAfter "ManageEnvironmentDurableStack"
  Assert-ExactSet -Actual @($stackStatement.Action) -Expected @(
    "cloudformation:CreateStack", "cloudformation:DeleteStack",
    "cloudformation:DescribeStackEvents", "cloudformation:DescribeStackResource",
    "cloudformation:DescribeStackResources", "cloudformation:DescribeStacks",
    "cloudformation:GetTemplate", "cloudformation:ListStackResources",
    "cloudformation:UpdateStack"
  ) -FailureMessage "The durable-stack action boundary is not exact."
  if (
    [string]$stackStatement.Effect -ne "Allow" -or
    [string]$stackStatement.Resource -ne
      "arn:aws:cloudformation:${Region}:${ExpectedAccountId}:stack/ai-job-apply-$Environment-profile-readiness-durable/*"
  ) {
    throw "The durable-stack resource boundary is not environment scoped."
  }
  $validateStatement = Get-Statement $managedAfter "ValidateDurableTemplate"
  Assert-ExactSet -Actual @($validateStatement.Action) -Expected @(
    "cloudformation:ValidateTemplate"
  ) -FailureMessage "The template-validation action is not exact."
  if ([string]$validateStatement.Effect -ne "Allow" -or [string]$validateStatement.Resource -ne "*") {
    throw "The template-validation resource boundary is not exact."
  }
  $eventsStatement = Get-Statement $managedAfter "ManageEnvironmentWorkflowRules"
  Assert-ExactSet -Actual @($eventsStatement.Action) -Expected @(
    "events:DeleteRule", "events:DescribeRule", "events:ListTagsForResource",
    "events:ListTargetsByRule", "events:PutRule", "events:PutTargets",
    "events:RemoveTargets", "events:TagResource", "events:UntagResource"
  ) -FailureMessage "The workflow-rule action boundary is not exact."
  if (
    [string]$eventsStatement.Effect -ne "Allow" -or
    [string]$eventsStatement.Resource -ne
      "arn:aws:events:${Region}:${ExpectedAccountId}:rule/ai-job-apply-$Environment-*"
  ) {
    throw "The workflow-rule resource boundary is not environment scoped."
  }
  $lambdaStatement = Get-Statement $managedAfter "ManageEnvironmentLambda"
  Assert-ExactSet -Actual @($lambdaStatement.Action) -Expected @(
    "lambda:*"
  ) -FailureMessage "The environment Lambda deployment actions are not exact."
  Assert-ExactSet -Actual @($lambdaStatement.Resource) -Expected @(
    "arn:aws:lambda:${Region}:${ExpectedAccountId}:function:ai-job-apply-$Environment-*",
    "arn:aws:lambda:${Region}:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:*"
  ) -FailureMessage "The environment Lambda deployment resources are not exact."
  if ([string]$lambdaStatement.Effect -ne "Allow") {
    throw "The environment Lambda deployment statement is not an allow statement."
  }
  $passRoleStatement = Get-Statement $managedAfter "PassWorkloadRolesToApprovedServices"
  Assert-ExactSet -Actual @($passRoleStatement.Action) -Expected @(
    "iam:PassRole"
  ) -FailureMessage "The workload pass-role action is not exact."
  if (
    [string]$passRoleStatement.Effect -ne "Allow" -or
    [string]$passRoleStatement.Resource -ne
      "arn:aws:iam::${ExpectedAccountId}:role/ai-job-apply-$Environment-*"
  ) {
    throw "The workload pass-role resource is not environment scoped."
  }
  Assert-ExactSet `
    -Actual @($passRoleStatement.Condition.StringEquals."iam:PassedToService") `
    -Expected @("ecs-tasks.amazonaws.com", "lambda.amazonaws.com") `
    -FailureMessage "The workload pass-role service boundary is not exact."
  $allDeploymentActions = @($managedAfter.Statement | ForEach-Object { @($_.Action) })
  if ($allDeploymentActions -contains "cloudformation:*" -or $allDeploymentActions -contains "events:*") {
    throw "The deployment policy contains an account-wide CloudFormation or EventBridge wildcard."
  }
  $deploymentAddedSids = if ($Environment -eq "staging") {
    @(
      "ManageEnvironmentDurableStack", "ValidateDurableTemplate",
      "ManageEnvironmentWorkflowRules", "ManageEnvironmentLambda",
      "PassWorkloadRolesToApprovedServices"
    )
  } else {
    @("ManageEnvironmentDurableStack", "ValidateDurableTemplate", "ManageEnvironmentWorkflowRules")
  }
  $deploymentRemovedSids = if ($Environment -eq "staging") {
    @("PassWorkloadRolesToEcsTasks")
  } else {
    @()
  }
  foreach ($newSid in $deploymentAddedSids) {
    if (@($managedBefore.Statement | Where-Object { $_.Sid -eq $newSid }).Count -ne 0) {
      throw "The deployment-policy baseline already contains '$newSid'; this is not the reviewed delta."
    }
  }
  foreach ($removedSid in $deploymentRemovedSids) {
    if (
      @($managedBefore.Statement | Where-Object { $_.Sid -eq $removedSid }).Count -ne 1 -or
      @($managedAfter.Statement | Where-Object { $_.Sid -eq $removedSid }).Count -ne 0
    ) {
      throw "The deployment-policy removal for '$removedSid' is not the reviewed staging delta."
    }
  }
  $deploymentAfterWithoutAdditions = $managedAfter | ConvertTo-Json -Depth 40 | ConvertFrom-Json
  $deploymentAfterWithoutAdditions.Statement = @(
    $deploymentAfterWithoutAdditions.Statement | Where-Object {
      $_.Sid -notin $deploymentAddedSids
    }
  )
  foreach ($removedSid in $deploymentRemovedSids) {
    $deploymentAfterWithoutAdditions.Statement += @(
      $managedBefore.Statement | Where-Object { $_.Sid -eq $removedSid }
    )
  }
  Assert-PoliciesEquivalent `
    -Left $managedBefore `
    -Right $deploymentAfterWithoutAdditions `
    -FailureMessage "The GitHub deployment policy changes more than the reviewed statement additions."

  $workloadBefore = ([string]$workloadChange.change.before.policy) | ConvertFrom-Json
  $workloadAfter = ([string]$workloadChange.change.after.policy) | ConvertFrom-Json
  $beforeKms = Get-Statement $workloadBefore "DecryptTaggedRuntimeData"
  $afterKms = Get-Statement $workloadAfter "DecryptTaggedRuntimeData"
  Assert-ExactSet -Actual @($afterKms.Action) -Expected @(
    "kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"
  ) -FailureMessage "The runtime KMS action addition is not exact."
  if (@($beforeKms.Action) -contains "kms:GenerateDataKey") {
    throw "The workload-policy baseline already has GenerateDataKey; this is not the reviewed delta."
  }
  $durableStatement = Get-Statement $workloadAfter "OperateOwnedServerlessWorkflows"
  Assert-ExactSet -Actual @($durableStatement.Action) -Expected @(
    "lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState",
    "lambda:InvokeFunction"
  ) -FailureMessage "The durable-workflow runtime actions are not exact."
  if (
    [string]$durableStatement.Resource -ne
      "arn:aws:lambda:${Region}:${ExpectedAccountId}:function:ai-job-apply-$Environment-*:*"
  ) {
    throw "The durable-workflow runtime resource is not scoped to qualified $Environment functions."
  }
  $queueStatement = Get-Statement $workloadAfter "OperateOwnedWorkflowQueues"
  Assert-ExactSet -Actual @($queueStatement.Action) -Expected @(
    "sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes",
    "sqs:ReceiveMessage", "sqs:SendMessage"
  ) -FailureMessage "The workflow-queue runtime actions are not exact."
  if (
    [string]$queueStatement.Resource -ne
      "arn:aws:sqs:${Region}:${ExpectedAccountId}:ai-job-apply-$Environment-*"
  ) {
    throw "The workflow-queue resource is not environment scoped."
  }
  $vpcStatement = Get-Statement $workloadAfter "ManageLambdaVpcInterfaces"
  Assert-ExactSet -Actual @($vpcStatement.Action) -Expected @(
    "ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface",
    "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces",
    "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"
  ) -FailureMessage "The Lambda VPC-interface actions are not exact."
  if ([string]$vpcStatement.Effect -ne "Allow" -or [string]$vpcStatement.Resource -ne "*") {
    throw "The Lambda VPC-interface resource boundary is not exact."
  }
  $workloadAddedSids = @("OperateOwnedServerlessWorkflows", "OperateOwnedWorkflowQueues")
  if ($Environment -eq "staging") {
    $workloadAddedSids += "ManageLambdaVpcInterfaces"
  }
  foreach ($newSid in $workloadAddedSids) {
    if (@($workloadBefore.Statement | Where-Object { $_.Sid -eq $newSid }).Count -ne 0) {
      throw "The workload-policy baseline already contains '$newSid'; this is not the reviewed delta."
    }
  }
  $workloadAfterWithoutAdditions = $workloadAfter | ConvertTo-Json -Depth 40 | ConvertFrom-Json
  $normalizedAfterKms = Get-Statement $workloadAfterWithoutAdditions "DecryptTaggedRuntimeData"
  $normalizedAfterKms.Action = $beforeKms.Action
  $workloadAfterWithoutAdditions.Statement = @(
    $workloadAfterWithoutAdditions.Statement | Where-Object {
      $_.Sid -notin $workloadAddedSids
    }
  )
  Assert-PoliciesEquivalent `
    -Left $workloadBefore `
    -Right $workloadAfterWithoutAdditions `
    -FailureMessage "The workload boundary changes more than the reviewed KMS, Lambda, and SQS additions."

  $planHash = (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Environment                    = $Environment
    AccountVerified                = $true
    Region                         = $Region
    SourceCommit                   = $sourceCommit
    ImmutableGitHubIdentity        = $true
    EffectiveOidcTrustVerified     = $true
    SuccessfulOidcRunVerified      = $true
    StateVersioningVerified        = $true
    StatePublicAccessBlocked       = $true
    StateKmsVerified               = $stateUsesExpectedKms
    StateKmsCorrectionRequired     = -not $stateUsesExpectedKms
    Creates                        = 0
    Updates                        = 3
    Deletes                        = 0
    Replacements                   = 0
    ManagedAndInlinePoliciesMatch  = $true
    DeploymentPermissionDeltaExact = $true
    WorkloadPermissionDeltaExact   = $true
    PlanSha256                     = $planHash
    SensitivePlanPath              = $planPath
    UpdatedResources               = $expectedUpdates
  } | ConvertTo-Json -Depth 5
}
finally {
  if ($null -eq $previousProfile) {
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
  } else { $env:AWS_PROFILE = $previousProfile }
  if ($null -eq $previousRegion) {
    Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue
  } else { $env:AWS_REGION = $previousRegion }
  if ($null -eq $previousDefaultRegion) {
    Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue
  } else { $env:AWS_DEFAULT_REGION = $previousDefaultRegion }
  if ($null -eq $previousTerraformDataDirectory) {
    Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue
  } else { $env:TF_DATA_DIR = $previousTerraformDataDirectory }
  if ($null -eq $previousAccessKeyId) {
    Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
  } else { $env:AWS_ACCESS_KEY_ID = $previousAccessKeyId }
  if ($null -eq $previousSecretAccessKey) {
    Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
  } else { $env:AWS_SECRET_ACCESS_KEY = $previousSecretAccessKey }
  if ($null -eq $previousSessionToken) {
    Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
  } else { $env:AWS_SESSION_TOKEN = $previousSessionToken }
}
