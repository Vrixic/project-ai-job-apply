Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$operator = Join-Path $PSScriptRoot '../operate-development-d2-provider-recovery.ps1'
$global:D2ProviderRecoveryMock = @{ mode = 'inspect'; invokes = 0 }
function global:aws {
  $items = @($args)
  $global:LASTEXITCODE = 0
  switch ("$($items[0]) $($items[1])") {
    'sts get-caller-identity' { if ($global:D2ProviderRecoveryMock.mode -eq 'wrong-account') { '"999999999999"' } else { '"123456789012"' }; return }
    'lambda get-alias' { if ($global:D2ProviderRecoveryMock.mode -eq 'weighted') { '{"version":"8","weights":{"7":0.1}}' } else { '{"version":"8","weights":null}' }; return }
    'lambda get-function-configuration' { @{ code = $(if ($global:D2ProviderRecoveryMock.mode -eq 'wrong-code') { 'wrong' } else { ('a' * 43) + '=' }); state='Active'; update='Successful' } | ConvertTo-Json -Compress; return }
    'events list-rule-names-by-target' { '{"RuleNames":["development-d2-community-batch"]}'; return }
    'events describe-rule' { '{"arn":"arn:aws:events:us-east-2:123456789012:rule/development-d2-community-batch","state":"ENABLED"}'; return }
    'lambda invoke' {
      $global:D2ProviderRecoveryMock.invokes++
      $index = [Array]::IndexOf($items, '--payload')
      $command = Get-Content -Raw -LiteralPath $items[$index + 1].Substring(8) | ConvertFrom-Json
      $resultPath = $items[$index + 2]
      if ($command.action -eq 'retry-provider-verification') { $result = @{ requeued=1 } }
      else { $result = @{ schemaVersion=1; inspected=1; retryable=1; unavailable=0; mismatch=1; closed=0; duplicate=0; other=0; fingerprint=('b' * 64) } }
      if ($global:D2ProviderRecoveryMock.mode -eq 'extra-result') { $result.secret = 'SYNTHETIC_FORBIDDEN_FIELD' }
      if ($global:D2ProviderRecoveryMock.mode -eq 'invalid-count') { $result.inspected = 26 }
      [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Compress))
      if ($global:D2ProviderRecoveryMock.mode -eq 'function-error') { '{"StatusCode":200,"FunctionError":"Unhandled"}' } else { '{"StatusCode":200}' }
      return
    }
    default { throw 'Unexpected mocked AWS operation.' }
  }
}
$parameters = @{ ExpectedAccountId='123456789012'; ExpectedCodeSha256=(('a' * 43) + '=') }
function Expect-Failure([scriptblock]$Run) {
  $failed = $false
  try { & $Run | Out-Null } catch { $failed = $true }
  if (-not $failed) { throw 'Expected recovery guard rejection.' }
}
$result = & $operator @parameters | ConvertFrom-Json
if ($result.Result.mismatch -ne 1 -or $global:D2ProviderRecoveryMock.invokes -ne 1) { throw 'Inspect did not return only the expected aggregate.' }
foreach ($case in @('wrong-account','weighted','wrong-code')) {
  $global:D2ProviderRecoveryMock.mode = $case
  $before = $global:D2ProviderRecoveryMock.invokes
  Expect-Failure { & $operator @parameters }
  if ($before -ne $global:D2ProviderRecoveryMock.invokes) { throw 'Preflight failure invoked recovery.' }
}
$global:D2ProviderRecoveryMock.mode = 'retry'
Expect-Failure { & $operator @parameters -Action Retry }
$result = & $operator @parameters -Action Retry -ExpectedFingerprint ('b' * 64) -Confirmation 'RETRY-REVIEWED-PROVIDER-VERIFICATION' | ConvertFrom-Json
if ($result.Result.requeued -ne 1) { throw 'Explicit recovery did not run.' }
foreach ($case in @('extra-result','invalid-count','function-error')) {
  $global:D2ProviderRecoveryMock.mode = $case
  Expect-Failure { & $operator @parameters }
}
'Development D2 provider recovery guards passed (mock AWS only).'
