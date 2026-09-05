[CmdletBinding()]
param(
  [ValidateSet('Inspect','Retry')][string]$Action = 'Inspect',
  [string]$AwsProfile = 'ai-job-apply-development-admin',
  [ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [ValidatePattern('^[A-Za-z0-9+/]{43}=$')][string]$ExpectedCodeSha256,
  [ValidatePattern('^(|[a-f0-9]{64})$')][string]$ExpectedFingerprint = '',
  [string]$Confirmation = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ExpectedAccountId -or -not $ExpectedCodeSha256) { throw 'Exact development account and reviewed immutable code checksum are required.' }
if ($Action -eq 'Retry' -and ($ExpectedFingerprint.Length -ne 64 -or $Confirmation -cne 'RETRY-REVIEWED-PROVIDER-VERIFICATION')) { throw 'Retry requires the inspected fingerprint and explicit recovery confirmation.' }
$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = 'us-east-2'
$env:AWS_DEFAULT_REGION = 'us-east-2'
$env:AWS_PAGER = ''
function AwsJson([string[]]$ArgumentsList) {
  $raw = & aws @ArgumentsList 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'An exact development recovery AWS check failed.' }
  ($raw -join "`n") | ConvertFrom-Json
}
$account = AwsJson @('sts','get-caller-identity','--query','Account','--output','json')
if ($account -cne $ExpectedAccountId) { throw 'Development AWS account mismatch.' }
$functionName = 'ai-job-apply-development-d2-community-scheduled'
$alias = AwsJson @('lambda','get-alias','--function-name',$functionName,'--name','development','--query','{version:FunctionVersion,weights:RoutingConfig.AdditionalVersionWeights}','--output','json')
if ($alias.version -notmatch '^[1-9][0-9]*$' -or ($null -ne $alias.weights -and @($alias.weights.PSObject.Properties).Count -ne 0)) { throw 'Recovery requires an unweighted immutable development alias.' }
$qualifiedFunction = "${functionName}:$($alias.version)"
$configuration = AwsJson @('lambda','get-function-configuration','--function-name',$qualifiedFunction,'--query','{code:CodeSha256,state:State,update:LastUpdateStatus}','--output','json')
if ($configuration.code -cne $ExpectedCodeSha256 -or $configuration.state -cne 'Active' -or $configuration.update -cne 'Successful') { throw 'The deployed function does not match the reviewed healthy artifact.' }
$targetArn = "arn:aws:lambda:us-east-2:${ExpectedAccountId}:function:${functionName}:development"
$rules = AwsJson @('events','list-rule-names-by-target','--target-arn',$targetArn,'--output','json')
if (@($rules.RuleNames).Count -ne 1) { throw 'One exact development schedule is required.' }
$rule = AwsJson @('events','describe-rule','--name',([string]$rules.RuleNames[0]),'--query','{arn:Arn,state:State}','--output','json')
if ($rule.arn -notmatch "^arn:aws:events:us-east-2:${ExpectedAccountId}:rule/" -or $rule.state -cne 'ENABLED') { throw 'The development schedule boundary is not active.' }
$command = [ordered]@{ schemaVersion=1; action='inspect-provider-verification'; scheduleRuleArn=$rule.arn }
if ($Action -eq 'Retry') {
  $command.action = 'retry-provider-verification'
  $command.expectedFingerprint = $ExpectedFingerprint
  $command.confirmation = $Confirmation
}
$privateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../infrastructure/terraform/environments/development/.terraform/development-d2-provider-recovery'))
[IO.Directory]::CreateDirectory($privateRoot) | Out-Null
$run = [guid]::NewGuid().ToString('N')
$commandPath = Join-Path $privateRoot "command-$run.json"
$resultPath = Join-Path $privateRoot "result-$run.json"
try {
  [IO.File]::WriteAllText($commandPath, ($command | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $invocation = AwsJson @('lambda','invoke','--function-name',$qualifiedFunction,'--cli-binary-format','raw-in-base64-out','--payload',("fileb://" + $commandPath),$resultPath,'--output','json')
  if ($invocation.StatusCode -ne 200 -or $invocation.PSObject.Properties.Name -contains 'FunctionError') { throw 'Recovery was rejected or its snapshot changed. Inspect again; do not replay blindly.' }
  $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  $countKeys = if ($Action -eq 'Inspect') { @('inspected','retryable','unavailable','mismatch','closed','duplicate','other') } else { @('requeued') }
  $expectedKeys = if ($Action -eq 'Inspect') { @($countKeys + 'schemaVersion' + 'fingerprint') } else { $countKeys }
  if ((@($result.PSObject.Properties.Name | Sort-Object) -join ',') -cne (@($expectedKeys | Sort-Object) -join ',')) { throw 'Recovery response contains an unexpected field.' }
  foreach ($key in $countKeys) {
    if ($result.$key -isnot [long] -and $result.$key -isnot [int]) { throw 'Recovery count is not an integer.' }
    if ($result.$key -lt 0 -or $result.$key -gt 25) { throw 'Recovery count exceeds the bounded batch.' }
  }
  if ($Action -eq 'Inspect' -and ($result.schemaVersion -ne 1 -or $result.fingerprint -notmatch '^[a-f0-9]{64}$' -or $result.retryable -ne ($result.unavailable + $result.mismatch) -or $result.inspected -ne ($result.unavailable + $result.mismatch + $result.closed + $result.duplicate + $result.other))) { throw 'Recovery snapshot is inconsistent.' }
  [pscustomobject]@{ Action=$Action; FunctionVersion=$alias.version; Result=$result } | ConvertTo-Json -Depth 4
} finally {
  foreach ($path in @($commandPath,$resultPath)) {
    if (-not ([IO.Path]::GetFullPath($path)).StartsWith($privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery temporary path escaped its directory.' }
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
}
