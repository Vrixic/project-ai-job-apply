[CmdletBinding()]
param([ValidateSet("RollbackPlan","AlarmInjectionPlan")][string]$Action,[ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedCurrentArtifactSha256="",[ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedPreviousArtifactSha256="")
Set-StrictMode -Version Latest;$ErrorActionPreference="Stop"
if($Action -ceq "RollbackPlan" -and $ReviewedCurrentArtifactSha256 -ceq $ReviewedPreviousArtifactSha256){throw "Rollback requires distinct independently reviewed artifact digests."}
if($Action -ceq "RollbackPlan") {[pscustomobject]@{Action=$Action;MutationPerformed=$false;RequiredNextStep="checksum-reviewed Terraform rollback plan and separate approval";PreserveDark=$true}}
else {[pscustomobject]@{Action=$Action;MutationPerformed=$false;RequiredNextStep="accountable metric threshold, alarm ARN, SNS recipient, synthetic alarm and OK confirmations";PreserveDark=$true}}
