Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repositoryRoot 'scripts\lib\bedrock-invocation-logging.ps1')

function Assert-Throws {
  param([scriptblock]$Operation, [string]$ExpectedMessage, [string]$Label)
  $message = $null
  try { & $Operation | Out-Null } catch { $message = $_.Exception.Message }
  if ($message -cne $ExpectedMessage) { throw "$Label : expected '$ExpectedMessage' but got '$message'" }
}

# Off: the AWS CLI prints nothing (exit code 0) when no configuration exists; an empty object is accepted too.
Assert-BedrockInvocationLoggingOff -ConfigurationJson ''
Assert-BedrockInvocationLoggingOff -ConfigurationJson "`r`n"
Assert-BedrockInvocationLoggingOff -ConfigurationJson '{}'
Assert-BedrockInvocationLoggingOff -ConfigurationJson "  {}`n"

# Any configured destination or delivery fails, even one that looks inert.
$cloudWatch = '{"loggingConfig":{"cloudWatchConfig":{"logGroupName":"/bedrock/invocations","roleArn":"arn:aws:iam::111122223333:role/x"},"textDataDeliveryEnabled":true}}'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson $cloudWatch } 'BedrockInvocationLoggingEnabled' 'cloudwatch'
$s3 = '{"loggingConfig":{"s3Config":{"bucketName":"b","keyPrefix":"p"},"textDataDeliveryEnabled":true,"imageDataDeliveryEnabled":false}}'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson $s3 } 'BedrockInvocationLoggingEnabled' 's3'
$inert = '{"loggingConfig":{"textDataDeliveryEnabled":false,"imageDataDeliveryEnabled":false,"embeddingDataDeliveryEnabled":false}}'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson $inert } 'BedrockInvocationLoggingEnabled' 'inert configuration'

# Anything that is not the documented empty shape is rejected, never treated as off.
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson 'not json' } 'BedrockInvocationLoggingResponseRejected' 'not json'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson '[]' } 'BedrockInvocationLoggingResponseRejected' 'array'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson '{"error":"AccessDenied"}' } 'BedrockInvocationLoggingResponseRejected' 'unexpected field'
Assert-Throws { Assert-BedrockInvocationLoggingOff -ConfigurationJson 'null' } 'BedrockInvocationLoggingResponseRejected' 'null'

# The operator script parses, is read only and checks the account before the configuration.
$scriptPath = Join-Path $repositoryRoot 'scripts\verify-bedrock-invocation-logging-off.ps1'
$source = Get-Content -LiteralPath $scriptPath -Raw
$tokens = $null; $errors = $null
[void][Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw 'The invocation logging verifier does not parse.' }
foreach ($forbidden in @('put-model-invocation-logging', 'delete-model-invocation-logging', 'invoke-model', 'converse')) {
  if ($source -match [regex]::Escape($forbidden)) { throw "The verifier must stay read only; found $forbidden." }
}
if ($source.IndexOf('sts', [StringComparison]::Ordinal) -gt $source.IndexOf('get-model-invocation-logging-configuration', [StringComparison]::Ordinal)) {
  throw 'The verifier must confirm the account before it reads the configuration.'
}
Write-Output 'Bedrock invocation logging verifier tests passed.'
