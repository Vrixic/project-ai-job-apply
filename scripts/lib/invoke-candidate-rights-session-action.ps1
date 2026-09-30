# Invoked only by the in-memory local session. stdin contains reviewed nonsecret arguments;
# tokens and the candidate client secret are process-only environment inputs to the maintained operator.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function ConvertTo-SafeSessionFailure {
  param([string]$Message)
  $failure = [ordered]@{ outcome = 'failed'; reason = 'operator_failed_check_recovery' }
  $prefix = 'D2 acceptance stopped before account deletion: nonempty export coverage is required for '
  $suffix = ". Prepare the authorized disposable account's missing D2 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry."
  if ($Message.Length -le 1024 -and $Message -cmatch ('\A' + [regex]::Escape($prefix) + '(?<names>[A-Za-z, ]+)' + [regex]::Escape($suffix) + '\z')) {
    $names = @($Matches.names -csplit ', ')
    $allowed = @('consentCount','contributionApprovalCount','contributionCount','privateCaptureCount','trustCaseCount','trustCaseEventCount')
    if ($names.Count -ge 1 -and $names.Count -le 6 -and
        @($names | Where-Object { $_ -cnotin $allowed }).Count -eq 0 -and
        @($names | Select-Object -Unique).Count -eq $names.Count) {
      $failure.reason = 'd2_coverage_missing'
      $failure.missingCoverage = $names
    }
  }
  elseif ($Message -like 'The disposable identity is not an exact current*') { $failure.reason = 'identity_not_fresh' }
  elseif ($Message -match 'clean|origin/main|merged') { $failure.reason = 'source_not_ready' }
  return [pscustomobject]$failure
}
try {
  $inputJson = [Console]::In.ReadToEnd()
  if ($inputJson.Length -gt 16384) { throw 'Invalid session request.' }
  $request = $inputJson | ConvertFrom-Json
  $requestKeys = @($request.PSObject.Properties.Name | Sort-Object) -join ','
  if (($request.action -ceq 'plan' -and $requestKeys -cne 'action,options') -or
      ($request.action -ceq 'execute' -and $requestKeys -cne 'action,options,reviewedPlan') -or
      $request.action -cnotin @('plan', 'execute')) { throw 'Invalid session request.' }
  $optionKeys = @($request.options.PSObject.Properties.Name | Sort-Object) -join ','
  $restricted = $null -ne $request.options.PSObject.Properties['RestrictedAnswerFixture']
  $resume = $null -ne $request.options.PSObject.Properties['ResumeFixture']
  $expectedNames = @('ExpectedAccountId','ReviewedZeroDriftPlanSha256','SourceSha','StateBucket','ZeroDriftPlanPath')
  if ($restricted) { $expectedNames += 'RestrictedAnswerFixture' }
  if ($resume) { $expectedNames += 'ResumeFixture' }
  $expectedOptionKeys = @($expectedNames | Sort-Object) -join ','
  if ($optionKeys -cne $expectedOptionKeys -or ($restricted -and ($request.options.RestrictedAnswerFixture -isnot [bool] -or $request.options.RestrictedAnswerFixture -ne $true)) -or
      ($resume -and ($request.options.ResumeFixture -isnot [bool] -or $request.options.ResumeFixture -ne $true))) { throw 'Invalid session options.' }
  $parameters = @{
    Action = $(if ($request.action -ceq 'plan') { 'Plan' } else { 'Execute' })
    ExpectedPolicyVersion = 'd2-development-synthetic-v1'
    ReviewedPolicySha256 = '7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf'
    ExpectedExportLifetimeSeconds = 3600
    ExpectedDownloadGrantSeconds = 300
    ExpectedBackupRetentionDays = 35
    ExpectedRecentAuthMaxAgeSeconds = 900
    ExpectedSubprocessorInventory = 'none'
  }
  foreach ($name in @('ExpectedAccountId', 'StateBucket', 'SourceSha', 'ZeroDriftPlanPath', 'ReviewedZeroDriftPlanSha256')) {
    if ($request.options.$name -isnot [string]) { throw 'Invalid session option type.' }
    $parameters[$name] = $request.options.$name
  }
  if ($restricted) { $parameters.RestrictedAnswerFixture = $true }
  if ($resume) { $parameters.ResumeFixture = $true }
  if ($request.action -ceq 'execute') {
    if ((@($request.reviewedPlan.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'path,sha256') { throw 'Invalid reviewed plan.' }
    $parameters.ExecutionPlanPath = [string]$request.reviewedPlan.path
    $parameters.ReviewedExecutionPlanSha256 = [string]$request.reviewedPlan.sha256
  }
  $operator = Join-Path $PSScriptRoot '../operate-development-candidate-rights-acceptance.ps1'
  $result = & $operator @parameters
  $result | ConvertTo-Json -Depth 10 -Compress
} catch {
  ConvertTo-SafeSessionFailure $_.Exception.Message | ConvertTo-Json -Compress
  exit 1
}
