Set-StrictMode -Version Latest

# ADR-059 decision 4: Amazon Bedrock model invocation logging must stay off in every account that runs live generation,
# because a configured destination would write prompts and completions (candidate material) outside the 30 minute
# window of ADR-038. The AWS CLI prints nothing at all (exit code 0) when no configuration exists, so the caller must have
# checked the exit code; an empty response is then "off", and any loggingConfig fails.
function Assert-BedrockInvocationLoggingOff {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$ConfigurationJson)
  $text = $ConfigurationJson.Trim()
  if ($text.Length -eq 0) { return }
  try { $configuration = ConvertFrom-Json -InputObject $text -ErrorAction Stop }
  catch { throw 'BedrockInvocationLoggingResponseRejected' }
  if ($null -eq $configuration -or $configuration -isnot [pscustomobject]) { throw 'BedrockInvocationLoggingResponseRejected' }
  $unexpected = @($configuration.PSObject.Properties | ForEach-Object { $_.Name } | Where-Object { $_ -cne 'loggingConfig' })
  if ($unexpected.Count -ne 0) { throw 'BedrockInvocationLoggingResponseRejected' }
  if ($null -ne $configuration.PSObject.Properties['loggingConfig'] -and $null -ne $configuration.loggingConfig) {
    throw 'BedrockInvocationLoggingEnabled'
  }
}
