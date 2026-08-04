[CmdletBinding()]
param(
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId,
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket,
  [ValidatePattern("^lambda/gateway/[a-f0-9]{40}/[a-f0-9]{64}/gateway-lambda[.]zip$")][string]$ArtifactS3Key,
  [ValidatePattern("^[A-Za-z0-9._-]+$")][string]$ArtifactS3ObjectVersion,
  [ValidatePattern("^[a-f0-9]{40}$")][string]$ArtifactSourceSha,
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ArtifactSha256,
  [ValidatePattern("^[A-Za-z0-9+/]{43}=$")][string]$ArtifactBase64Sha256,
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [ValidatePattern("^[a-z]{2}-[a-z]+-[0-9]+$")][string]$Region = "us-east-2",
  [ValidateRange(1, 5)][int]$ReservedConcurrency = 2,
  [ValidatePattern("^arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$")][string]$PinnedExtensionLayerArn,
  [switch]$ResumePartialApply,
  [switch]$AllowLambdaVpcPolicyRecovery,
  [switch]$AllowLambdaConcurrencyRecovery,
  [switch]$AllowArtifactReleaseUpdate,
  [switch]$VerifyCompletedDarkDeployment,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$planner = Join-Path $PSScriptRoot "plan-gateway-lambda-dark.ps1"
if ($Help) {
  & $planner -Help
  exit $LASTEXITCODE
}
$arguments = @{
  Environment                    = "development"
  ExpectedAccountId              = $ExpectedAccountId
  StateBucket                    = $StateBucket
  ArtifactS3Key                  = $ArtifactS3Key
  ArtifactS3ObjectVersion        = $ArtifactS3ObjectVersion
  ArtifactSourceSha              = $ArtifactSourceSha
  ArtifactSha256                 = $ArtifactSha256
  ArtifactBase64Sha256           = $ArtifactBase64Sha256
  AwsProfile                     = $AwsProfile
  Region                         = $Region
  ReservedConcurrency            = $ReservedConcurrency
  ResumePartialApply             = $ResumePartialApply
  AllowLambdaVpcPolicyRecovery   = $AllowLambdaVpcPolicyRecovery
  AllowLambdaConcurrencyRecovery = $AllowLambdaConcurrencyRecovery
  AllowArtifactReleaseUpdate     = $AllowArtifactReleaseUpdate
  VerifyCompletedDarkDeployment  = $VerifyCompletedDarkDeployment
}
if ($PinnedExtensionLayerArn) {
  $arguments.PinnedExtensionLayerArn = $PinnedExtensionLayerArn
}

& $planner @arguments
exit $LASTEXITCODE
