# Read-only check (ADR-059 decision 4): fails unless Amazon Bedrock model invocation logging is off in the expected
# account and region. Run it before turning live generation on and at every live sitting. It changes nothing and prints
# no prompt, completion or credential.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [ValidatePattern('^[a-z]{2}-[a-z]+-[0-9]$')][string]$AwsRegion = 'us-east-2',
  [ValidatePattern('^[A-Za-z0-9_.-]{1,128}$')][string]$AwsProfile = 'ai-job-apply-development-admin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/bedrock-invocation-logging.ps1')

function Invoke-BedrockCheckAws {
  param([string[]]$Arguments)
  $output = & aws @Arguments --profile $AwsProfile --region $AwsRegion --output json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "AwsCommandFailed: aws $($Arguments[0]) $($Arguments[1])" }
  return ($output | Out-String)
}

$identity = ConvertFrom-Json -InputObject (Invoke-BedrockCheckAws @('sts', 'get-caller-identity'))
if ([string]$identity.Account -cne $ExpectedAccountId) { throw 'BedrockInvocationLoggingAccountMismatch' }
Assert-BedrockInvocationLoggingOff -ConfigurationJson (Invoke-BedrockCheckAws @('bedrock', 'get-model-invocation-logging-configuration'))
[pscustomobject]@{
  AccountId         = $ExpectedAccountId
  Region            = $AwsRegion
  InvocationLogging = 'off'
  CheckedAtUtc      = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Compress
