[CmdletBinding()]
param(
  [ValidateSet("Plan", "Verify")][string]$Action = "Plan",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId,
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket,
  [ValidatePattern("^lambda/gateway/[a-f0-9]{40}/[a-f0-9]{64}/gateway-lambda[.]zip$")]
  [string]$GatewayArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$GatewayArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{40}$")][string]$GatewayArtifactSourceSha,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$GatewayArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$GatewayArtifactBase64Sha256,
  [ValidatePattern("^[a-f0-9]{40}$")][string]$WorkflowArtifactSourceSha,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/workflow-ingress-lambda[.]zip$")]
  [string]$WorkflowIngressArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$WorkflowIngressArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$WorkflowIngressArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$WorkflowIngressArtifactBase64Sha256,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/profile-readiness-durable-lambda[.]zip$")]
  [string]$DurableArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$DurableArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$DurableArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$DurableArtifactBase64Sha256,
  [ValidatePattern("^lambda/workflows/[a-f0-9]{40}/[a-f0-9]{64}/profile-readiness-activity-lambda[.]zip$")]
  [string]$ActivityArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ActivityArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ActivityArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$ActivityArtifactBase64Sha256,
  [ValidatePattern("^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$")]
  [string]$PinnedExtensionLayerArn,
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$planner = Join-Path $PSScriptRoot "plan-serverless-workflow-dark.ps1"
if ($Help) {
  Write-Host "Development runtime wrapper. Plan creates the initial coupled cutover plan; Verify creates the post-cutover zero-drift runtime baseline."
  & $planner -Help
  exit $LASTEXITCODE
}

$arguments = @{
  Environment                            = "development"
  ExpectedAccountId                      = $ExpectedAccountId
  StateBucket                            = $StateBucket
  GatewayArtifactS3Key                   = $GatewayArtifactS3Key
  GatewayArtifactS3ObjectVersion         = $GatewayArtifactS3ObjectVersion
  GatewayArtifactSourceSha               = $GatewayArtifactSourceSha
  GatewayArtifactSha256                  = $GatewayArtifactSha256
  GatewayArtifactBase64Sha256            = $GatewayArtifactBase64Sha256
  WorkflowArtifactSourceSha              = $WorkflowArtifactSourceSha
  WorkflowIngressArtifactS3Key           = $WorkflowIngressArtifactS3Key
  WorkflowIngressArtifactS3ObjectVersion = $WorkflowIngressArtifactS3ObjectVersion
  WorkflowIngressArtifactSha256          = $WorkflowIngressArtifactSha256
  WorkflowIngressArtifactBase64Sha256    = $WorkflowIngressArtifactBase64Sha256
  DurableArtifactS3Key                   = $DurableArtifactS3Key
  DurableArtifactS3ObjectVersion         = $DurableArtifactS3ObjectVersion
  DurableArtifactSha256                  = $DurableArtifactSha256
  DurableArtifactBase64Sha256            = $DurableArtifactBase64Sha256
  ActivityArtifactS3Key                  = $ActivityArtifactS3Key
  ActivityArtifactS3ObjectVersion        = $ActivityArtifactS3ObjectVersion
  ActivityArtifactSha256                 = $ActivityArtifactSha256
  ActivityArtifactBase64Sha256           = $ActivityArtifactBase64Sha256
  PinnedExtensionLayerArn                = $PinnedExtensionLayerArn
  AwsProfile                             = $AwsProfile
  Region                                 = $Region
}

if ($Action -eq "Plan") { $arguments["PlanRuntimeCutover"] = $true }
else { $arguments["VerifyCompletedRuntimeCutover"] = $true }

& $planner @arguments
exit $LASTEXITCODE
