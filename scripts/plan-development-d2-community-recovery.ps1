[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("RollbackPlan", "AlarmInjectionPlan")]
  [string]$Action,

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedCurrentArtifactSha256 = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPreviousArtifactSha256 = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$ReviewedCurrentSourceSha = "",

  [ValidatePattern("^[a-f0-9]{40}$")]
  [string]$ReviewedPreviousSourceSha = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedCurrentReceiptSha256 = "",

  [ValidatePattern("^[a-f0-9]{64}$")]
  [string]$ReviewedPreviousReceiptSha256 = "",

  [switch]$CurrentObjectVersionVerified,

  [switch]$PreviousObjectVersionVerified,

  [ValidatePattern("^arn:aws:cloudwatch:us-east-2:[0-9]{12}:alarm:ai-job-apply-development-d2-[a-z0-9-]+$")]
  [string]$ReviewedAlarmArn = "",

  [ValidateRange(0, [double]::MaxValue)]
  [double]$ReviewedAlarmThreshold = 0,

  [ValidateRange(1, 20)]
  [int]$ReviewedRecipientCount = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Sha256([string]$Value) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}

function Assert-ExactValue([string]$Value, [string]$Pattern, [string]$Message) {
  if ($Value -cnotmatch $Pattern) {
    throw $Message
  }
}

$common = [ordered]@{
  schemaVersion     = 1
  profile           = "d2_development_recovery_plan_v1"
  environment       = "development"
  region            = "us-east-2"
  action            = $Action
  ready             = $true
  mutationPerformed = $false
  preserveDark      = $true
}

if ($Action -ceq "RollbackPlan") {
  Assert-ExactValue $ReviewedCurrentArtifactSha256 "^[a-f0-9]{64}$" "The current artifact digest is required."
  Assert-ExactValue $ReviewedPreviousArtifactSha256 "^[a-f0-9]{64}$" "The previous artifact digest is required."
  Assert-ExactValue $ReviewedCurrentSourceSha "^[a-f0-9]{40}$" "The current source SHA is required."
  Assert-ExactValue $ReviewedPreviousSourceSha "^[a-f0-9]{40}$" "The previous source SHA is required."
  Assert-ExactValue $ReviewedCurrentReceiptSha256 "^[a-f0-9]{64}$" "The current receipt digest is required."
  Assert-ExactValue $ReviewedPreviousReceiptSha256 "^[a-f0-9]{64}$" "The previous receipt digest is required."
  if ($ReviewedCurrentArtifactSha256 -ceq $ReviewedPreviousArtifactSha256) {
    throw "Rollback requires distinct independently reviewed artifact digests."
  }
  if ($ReviewedCurrentSourceSha -ceq $ReviewedPreviousSourceSha) {
    throw "Rollback requires distinct independently reviewed source commits."
  }
  if ($ReviewedCurrentReceiptSha256 -ceq $ReviewedPreviousReceiptSha256) {
    throw "Rollback requires distinct independently reviewed publication receipts."
  }
  if (-not $CurrentObjectVersionVerified -or -not $PreviousObjectVersionVerified) {
    throw "Both exact immutable artifact object versions must be verified before rollback planning."
  }

  $details = [ordered]@{
    currentArtifactSha256  = $ReviewedCurrentArtifactSha256
    previousArtifactSha256 = $ReviewedPreviousArtifactSha256
    currentSourceSha       = $ReviewedCurrentSourceSha
    previousSourceSha      = $ReviewedPreviousSourceSha
    currentReceiptSha256   = $ReviewedCurrentReceiptSha256
    previousReceiptSha256  = $ReviewedPreviousReceiptSha256
    objectVersionsVerified = $true
    requiredSequence       = @(
      "verify both immutable publication receipts and object versions",
      "require empty D2 queues and healthy alarms",
      "pause the exact EventBridge target and Trust event-source mapping",
      "create and checksum-review a Terraform rollback plan with no destruction",
      "apply only that saved plan and verify both immutable aliases",
      "run bounded generated-synthetic rollback probes",
      "create and checksum-review the separate restoration plan",
      "restore the current artifact and verify queues, triggers, alarms, and zero drift"
    )
  }
}
else {
  Assert-ExactValue $ReviewedAlarmArn "^arn:aws:cloudwatch:us-east-2:[0-9]{12}:alarm:ai-job-apply-development-d2-[a-z0-9-]+$" "An exact development D2 alarm ARN is required."
  if ($ReviewedRecipientCount -lt 1) {
    throw "At least one reviewed notification recipient is required."
  }
  $details = [ordered]@{
    alarmArnSha256     = Get-Sha256 $ReviewedAlarmArn
    reviewedThreshold = $ReviewedAlarmThreshold
    recipientCount     = $ReviewedRecipientCount
    requiredSequence   = @(
      "verify the exact alarm is OK with actions enabled",
      "inject only the documented generated-synthetic metric breach",
      "observe one ALARM transition and obtain recipient confirmation",
      "stop injection and observe one OK transition",
      "obtain recipient recovery confirmation and verify all D2 alarms are OK"
    )
  }
}

$canonical = [ordered]@{}
foreach ($entry in $common.GetEnumerator()) {
  $canonical[$entry.Key] = $entry.Value
}
$canonical.details = $details
$payload = $canonical | ConvertTo-Json -Depth 6 -Compress
$result = [ordered]@{}
foreach ($entry in $canonical.GetEnumerator()) {
  $result[$entry.Key] = $entry.Value
}
$result.planSha256 = Get-Sha256 "d2-development-recovery-plan-v1`n$payload`n"
$result | ConvertTo-Json -Depth 6
