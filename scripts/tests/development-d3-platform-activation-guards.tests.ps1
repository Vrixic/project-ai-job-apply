$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-gateway-release-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-d3-platform-activation-guards.ps1")

$passed = 0
function Copy-Fixture {
  param([Parameter(Mandatory)][object]$Value)
  return $Value | ConvertTo-Json -Depth 60 | ConvertFrom-Json
}
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}

$sourceSha = "a" * 40
$boundarySha = "b" * 64
$artifactSha = "c" * 64
$artifactBase64 = ("N" * 43) + "="
$artifactKey = "lambda/applications/$sourceSha/$artifactSha/applications-attempt-recovery-lambda.zip"
$entries = @()
foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
  $entries += [pscustomobject]@{
    artifactName = "applications-attempt-recovery-lambda"
    artifactSha256 = $artifactSha
    suffix = $suffix
    key = "lambda/applications/$sourceSha/$artifactSha/applications-attempt-recovery-lambda.$suffix"
    versionId = "version-$suffix"
    objectSha256 = $(if ($suffix -ceq "zip") { $artifactSha } else { "d" * 64 })
    objectBase64Sha256 = $(if ($suffix -ceq "zip") { $artifactBase64 } else { ("M" * 43) + "=" })
    contentLength = 1000
  }
}
$receipt = [pscustomobject]@{
  schemaVersion = 1
  kind = "development-applications-recovery-lambda-publication"
  environment = "development"
  region = "us-east-2"
  sourceSha = $sourceSha
  boundarySha256 = $boundarySha
  phase = "verified"
  createdAt = "2026-09-29T12:00:00Z"
  completedAt = "2026-09-29T12:01:00Z"
  artifacts = $entries
}
$artifact = Get-ApplicationsRecoveryArtifact -Receipt $receipt -SourceSha $sourceSha -BoundarySha256 $boundarySha
if (
  $artifact.key -cne $artifactKey -or
  $artifact.versionId -cne "version-zip" -or
  $artifact.artifactSha256 -cne $artifactSha -or
  $artifact.objectBase64Sha256 -cne $artifactBase64
) { throw "The Applications recovery artifact was not extracted exactly." }
$passed++

foreach ($case in @(
    @{ Name = "wrong source"; Mutate = { param($r) $r.sourceSha = "e" * 40 } },
    @{ Name = "wrong boundary"; Mutate = { param($r) $r.boundarySha256 = "f" * 64 } },
    @{ Name = "wrong kind"; Mutate = { param($r) $r.kind = "development-core-workflow-lambda-publication" } },
    @{ Name = "unverified"; Mutate = { param($r) $r.phase = "publishing" } },
    @{ Name = "missing companion"; Mutate = { param($r) $r.artifacts = @($r.artifacts | Select-Object -First 3) } },
    @{ Name = "wrong key"; Mutate = { param($r) (@($r.artifacts | Where-Object suffix -CEQ "zip"))[0].key += "x" } }
  )) {
  $bad = Copy-Fixture $receipt
  & $case.Mutate $bad
  Assert-Rejected {
    Get-ApplicationsRecoveryArtifact -Receipt $bad -SourceSha $sourceSha -BoundarySha256 $boundarySha
  } "A receipt with $($case.Name) was accepted."
}

function New-Variables {
  param(
    [bool]$Vault = $false,
    [bool]$Recovery = $false,
    [string]$Key = "",
    [string]$Version = "",
    [string]$Sha = "",
    [string]$Base64 = "",
    [string]$Other = "retained"
  )
  return [pscustomobject]@{
    restricted_answer_vault_enabled = [pscustomobject]@{ value = $Vault }
    applications_attempt_recovery_enabled = [pscustomobject]@{ value = $Recovery }
    applications_attempt_recovery_artifact_s3_key = [pscustomobject]@{ value = $Key }
    applications_attempt_recovery_artifact_s3_object_version = [pscustomobject]@{ value = $Version }
    applications_attempt_recovery_artifact_sha256 = [pscustomobject]@{ value = $Sha }
    applications_attempt_recovery_artifact_base64sha256 = [pscustomobject]@{ value = $Base64 }
    oidc_audience = [pscustomobject]@{ value = $Other }
  }
}
$baselineVariables = New-Variables
$vaultVariables = New-Variables -Vault $true
$recoveryVariables = New-Variables -Recovery $true -Key $artifact.key -Version $artifact.versionId `
  -Sha $artifact.artifactSha256 -Base64 $artifact.objectBase64Sha256
$null = Assert-D3PlatformActivationVariables -Component RestrictedAnswerVault `
  -BaselineVariables $baselineVariables -PlanVariables $vaultVariables
$passed++
$null = Assert-D3PlatformActivationVariables -Component ApplicationsAttemptRecovery `
  -BaselineVariables $baselineVariables -PlanVariables $recoveryVariables -Artifact $artifact
$passed++

Assert-Rejected {
  Assert-D3PlatformActivationVariables -Component RestrictedAnswerVault `
    -BaselineVariables $baselineVariables -PlanVariables (New-Variables -Vault $true -Recovery $true)
} "A combined vault and recovery activation was accepted."
Assert-Rejected {
  Assert-D3PlatformActivationVariables -Component ApplicationsAttemptRecovery `
    -BaselineVariables $baselineVariables -PlanVariables (New-Variables -Recovery $true -Key "wrong" `
      -Version $artifact.versionId -Sha $artifact.artifactSha256 -Base64 $artifact.objectBase64Sha256) -Artifact $artifact
} "A recovery activation using another artifact key was accepted."
Assert-Rejected {
  Assert-D3PlatformActivationVariables -Component RestrictedAnswerVault `
    -BaselineVariables $baselineVariables -PlanVariables (New-Variables -Vault $true -Other "changed")
} "A vault activation changed an unrelated variable."

function New-Change {
  param(
    [Parameter(Mandatory)][string]$Address,
    [Parameter(Mandatory)][string]$Type,
    [string[]]$Actions = @("create"),
    [AllowNull()][object]$Before = $null,
    [AllowNull()][object]$After = ([pscustomobject]@{}),
    [AllowNull()][object]$Unknown = ([pscustomobject]@{})
  )
  return [pscustomobject]@{
    address = $Address
    mode = "managed"
    type = $Type
    name = "fixture"
    change = [pscustomobject]@{
      actions = $Actions
      before = $Before
      after = $After
      after_unknown = $Unknown
      before_sensitive = [pscustomobject]@{}
      after_sensitive = [pscustomobject]@{}
    }
  }
}
function New-Plan {
  param([Parameter(Mandatory)][object[]]$Changes)
  return [pscustomobject]@{
    terraform_version = Get-DeploymentTerraformVersion
    errored = $false
    complete = $true
    applyable = $true
    resource_changes = $Changes
    resource_drift = @()
    output_changes = [pscustomobject]@{ gateway_alias_arn = [pscustomobject]@{ actions = @("no-op") } }
  }
}

$vaultChanges = @(
  (New-Change "module.platform.aws_kms_key.restricted_answer_vault[0]" "aws_kms_key" -After ([pscustomobject]@{
      deletion_window_in_days = 30
      enable_key_rotation = $true
      description = "ai-job-apply development restricted-answer vault (ADR-010)"
    })),
  (New-Change "module.platform.aws_kms_alias.restricted_answer_vault[0]" "aws_kms_alias" -After ([pscustomobject]@{
      name = "alias/ai-job-apply-development-restricted-answer-vault"
    })),
  (New-Change "module.platform.aws_iam_role_policy.gateway_lambda[0]" "aws_iam_role_policy" `
    -Actions @("update") -Before ([pscustomobject]@{ policy = "old" }) -After ([pscustomobject]@{ policy = "new" })),
  (New-Change "module.platform.aws_lambda_function.gateway[0]" "aws_lambda_function" `
    -Actions @("update") -Before ([pscustomobject]@{ environment = @([pscustomobject]@{ variables = [pscustomobject]@{} }) }) `
    -After ([pscustomobject]@{ environment = @([pscustomobject]@{ variables = [pscustomobject]@{
              RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = "arn:aws:kms:us-east-2:123456789012:key/new"
            } }) })),
  (New-Change "module.platform.aws_lambda_alias.gateway[0]" "aws_lambda_alias" `
    -Actions @("update") -Before ([pscustomobject]@{ function_version = "85" }) -After ([pscustomobject]@{}) `
    -Unknown ([pscustomobject]@{ function_version = $true }))
)
$vaultPlan = New-Plan $vaultChanges
$null = Assert-ExactRestrictedAnswerVaultPlan $vaultPlan
$passed++

$recoveryAfter = [pscustomobject]@{
  function_name = "ai-job-apply-development-applications-attempt-recovery"
  runtime = "nodejs24.x"
  handler = "index.handler"
  memory_size = 512
  timeout = 60
  reserved_concurrent_executions = 1
  publish = $true
  s3_key = $artifact.key
  s3_object_version = $artifact.versionId
  source_code_hash = $artifact.objectBase64Sha256
  environment = @([pscustomobject]@{ variables = [pscustomobject]@{ RELEASE_SHA = $artifact.artifactSha256 } })
}
$recoveryChanges = @(
  (New-Change "module.platform.aws_iam_role.applications_attempt_recovery[0]" "aws_iam_role"),
  (New-Change "module.platform.aws_iam_role_policy.applications_attempt_recovery[0]" "aws_iam_role_policy"),
  (New-Change "module.platform.aws_sqs_queue.applications_attempt_recovery_dead_letter[0]" "aws_sqs_queue" `
    -After ([pscustomobject]@{ message_retention_seconds = 1209600 })),
  (New-Change "module.platform.aws_lambda_function.applications_attempt_recovery[0]" "aws_lambda_function" -After $recoveryAfter),
  (New-Change "module.platform.aws_lambda_alias.applications_attempt_recovery[0]" "aws_lambda_alias"),
  (New-Change "module.platform.aws_cloudwatch_event_rule.applications_attempt_recovery[0]" "aws_cloudwatch_event_rule" `
    -After ([pscustomobject]@{ schedule_expression = "rate(5 minutes)"; state = "ENABLED" })),
  (New-Change "module.platform.aws_cloudwatch_event_target.applications_attempt_recovery[0]" "aws_cloudwatch_event_target"),
  (New-Change "module.platform.aws_lambda_permission.applications_attempt_recovery[0]" "aws_lambda_permission" `
    -After ([pscustomobject]@{ action = "lambda:InvokeFunction"; principal = "events.amazonaws.com" })),
  (New-Change "module.platform.aws_cloudwatch_metric_alarm.applications_attempt_recovery_errors[0]" "aws_cloudwatch_metric_alarm" `
    -After ([pscustomobject]@{ threshold = 0; treat_missing_data = "notBreaching" })),
  (New-Change "module.platform.aws_cloudwatch_metric_alarm.applications_attempt_recovery_dead_letter[0]" "aws_cloudwatch_metric_alarm" `
    -After ([pscustomobject]@{ threshold = 0; treat_missing_data = "notBreaching" })),
  (New-Change "module.platform.aws_vpc_endpoint.secretsmanager[0]" "aws_vpc_endpoint" `
    -Actions @("update") -Before ([pscustomobject]@{ policy = "old" }) -After ([pscustomobject]@{}) `
    -Unknown ([pscustomobject]@{ policy = $true }))
)
$recoveryPlan = New-Plan $recoveryChanges
$null = Assert-ExactApplicationsAttemptRecoveryPlan $recoveryPlan $artifact
$passed++

$extra = Copy-Fixture $recoveryPlan
$extra.resource_changes += New-Change "module.platform.aws_s3_bucket.unreviewed" "aws_s3_bucket"
Assert-Rejected { Assert-ExactApplicationsAttemptRecoveryPlan $extra $artifact } "An extra resource was accepted."
$destroy = Copy-Fixture $recoveryPlan
$destroy.resource_changes[0].change.actions = @("delete")
Assert-Rejected { Assert-ExactApplicationsAttemptRecoveryPlan $destroy $artifact } "A deletion was accepted."
$wrongArtifact = Copy-Fixture $recoveryPlan
$wrongArtifact.resource_changes[3].change.after.s3_key = "lambda/applications/wrong.zip"
Assert-Rejected { Assert-ExactApplicationsAttemptRecoveryPlan $wrongArtifact $artifact } "Another Lambda artifact was accepted."
$wrongSchedule = Copy-Fixture $recoveryPlan
$wrongSchedule.resource_changes[5].change.after.schedule_expression = "rate(1 minute)"
Assert-Rejected { Assert-ExactApplicationsAttemptRecoveryPlan $wrongSchedule $artifact } "Another schedule was accepted."
$outputChange = Copy-Fixture $vaultPlan
$outputChange.output_changes.gateway_alias_arn.actions = @("update")
Assert-Rejected { Assert-ExactRestrictedAnswerVaultPlan $outputChange } "A Terraform output change was accepted."

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-gateway-release.ps1"
$operatorSource = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$errors = $null
$null = [Management.Automation.Language.Parser]::ParseInput($operatorSource, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The Gateway operator with D3 activation support did not parse." }
foreach ($required in @(
    'ValidateSet("None", "RestrictedAnswerVault", "ApplicationsAttemptRecovery")',
    'throw "A D3 platform capability is activated on its own and never with another release or activation."',
    'Assert-D3PlatformActivationVariables',
    'Assert-ExactRestrictedAnswerVaultPlan',
    'Assert-ExactApplicationsAttemptRecoveryPlan',
    'Get-VerifiedApplicationsRecoveryArtifact',
    'Assert-D3PlatformActivationLive',
    'Invoke-D3PlatformActivationZeroDrift',
    'Remote state changed after review; generate a new D3 platform activation plan.',
    'terraform "-chdir=$terraformDirectory" apply -input=false -lock-timeout=5m $path',
    'ApplicationsRecoveryReceiptSha256',
    'ReviewedPlanSha256'
  )) {
  if (-not $operatorSource.Contains($required)) { throw "The D3 activation operator is missing: $required" }
}

foreach ($environment in @("development", "staging")) {
  $environmentRoot = Join-Path $repositoryRoot "infrastructure\terraform\environments\$environment"
  $mainSource = Get-Content -LiteralPath (Join-Path $environmentRoot "main.tf") -Raw
  $variablesSource = Get-Content -LiteralPath (Join-Path $environmentRoot "variables.tf") -Raw
  foreach ($name in @(
      "restricted_answer_vault_enabled",
      "applications_attempt_recovery_enabled",
      "applications_attempt_recovery_artifact_s3_key",
      "applications_attempt_recovery_artifact_s3_object_version",
      "applications_attempt_recovery_artifact_sha256",
      "applications_attempt_recovery_artifact_base64sha256"
    )) {
    if ($mainSource -notmatch "(?m)^\s+$name\s*=|(?m)^\s+$name\s+\(=") {
      throw "$environment does not pass '$name' into the platform module."
    }
    if ($variablesSource -notmatch ('(?m)^variable "' + [regex]::Escape($name) + '" \{')) {
      throw "$environment does not declare '$name'."
    }
  }
  foreach ($flag in @("restricted_answer_vault_enabled", "applications_attempt_recovery_enabled")) {
    $declaration = [regex]::Match(
      $variablesSource,
      ('(?ms)^variable "' + [regex]::Escape($flag) + '" \{(.*?)^\}')
    )
    if (-not $declaration.Success -or $declaration.Groups[1].Value -notmatch '(?m)^\s*default\s*=\s*false\s*$') {
      throw "$environment does not keep '$flag' default-off."
    }
  }
}
$moduleSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "infrastructure\terraform\modules\platform\main.tf") -Raw
if (-not $moduleSource.Contains(
    'var.applications_attempt_recovery_enabled ? aws_iam_role.applications_attempt_recovery[0].arn : ""'
  )) {
  throw "The private Secrets Manager endpoint does not include the Applications recovery role."
}

Write-Host "D3 platform activation guard tests passed: $passed assertions; generated fixtures only."
