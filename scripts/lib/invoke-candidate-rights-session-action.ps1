# Invoked only by the in-memory local session. stdin contains reviewed nonsecret arguments;
# tokens and the candidate client secret are process-only environment inputs to the maintained operator.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function ConvertTo-SafeSessionFailure {
  param([string]$Message)
  $failure = [ordered]@{ outcome = 'failed'; reason = 'operator_failed_check_recovery' }
  $prefix = 'D2 acceptance stopped before account deletion: nonempty export coverage is required for '
  $suffix = ". Prepare the authorized disposable account's missing D2 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry."
  $d3 = $Message.StartsWith('D3 acceptance stopped before account deletion: nonempty Applications export coverage is required for ')
  if ($d3) {
    $prefix = 'D3 acceptance stopped before account deletion: nonempty Applications export coverage is required for '
    $suffix = ". Prepare the authorized disposable account's missing D3 test records, then obtain fresh MFA and a new reviewed run. The existing export remains subject to its configured expiry and cleanup."
  }
  if ($Message.Length -le 1024 -and $Message -cmatch ('\A' + [regex]::Escape($prefix) + '(?<names>[A-Za-z, ]+)' + [regex]::Escape($suffix) + '\z')) {
    $names = @($Matches.names -csplit ', ')
    $allowed = @('consentCount','contributionApprovalCount','contributionCount','privateCaptureCount','trustCaseCount','trustCaseEventCount')
    if ($d3) { $allowed = @('applicationCount','packetCount','approvalCount','attemptCount','historyCount') }
    if ($names.Count -ge 1 -and $names.Count -le $allowed.Count -and
        @($names | Where-Object { $_ -cnotin $allowed }).Count -eq 0 -and
        @($names | Select-Object -Unique).Count -eq $names.Count) {
      $failure.reason = if ($d3) { 'd3_coverage_missing' } else { 'd2_coverage_missing' }
      $failure.missingCoverage = $names
    }
  }
  elseif ($Message -cmatch '\ARightsLifecycleFailed:(?<step>[a-z-]{1,32}):(?<check>[a-z_]{1,32})\z' -and
      $Matches.step -cin @('resume-fixture','export-request','export-ready','export-download','export-coverage','grant-expiry','identity-refresh','deletion-cancel','recent-mfa','deletion-confirm','deletion-completion','export-cleanup','resume-cleanup','operational-health','receipt','preflight') -and
      $Matches.check -cin @('marker_not_completed','export_version_remains','export_inventory_invalid','export_binding_invalid','active_ecs_tasks','queue_not_empty','alarm_not_ok','aws_session','resume_cleanup_incomplete','unclassified')) {
    $failure.reason = 'operator_failed_at_step'
    $failure.step = $Matches.step
    $failure.check = $Matches.check
  }
  elseif ($Message -like 'The disposable identity is not an exact current*') { $failure.reason = 'identity_not_fresh' }
  elseif ($Message -ceq 'Acceptance requires clean main exactly matching origin/main and SourceSha.') { $failure.reason = 'source_not_ready' }
  return [pscustomobject]$failure
}
function Get-RightsSessionPolicy {
  param([bool]$ApplicationsInventory, [bool]$NotificationsInventory = $false)
  if ($NotificationsInventory) {
    return @{
      ExpectedPolicyVersion = 'd4-development-synthetic-v1'
      ReviewedPolicySha256 = '91d1b73e05191be5247a4708274a879c16593ddb5c6933db174fdd83f2385001'
      ExpectedOwnerInventory = 'identity,profile,documents,jobs,matching,billing,trust,applications,notifications'
    }
  }
  if ($ApplicationsInventory) {
    return @{
      ExpectedPolicyVersion = 'd3-development-synthetic-v1'
      ReviewedPolicySha256 = 'c47a4637cfd1f008f29147ec610d95d1f7ca9126a5242b8ff38706157a38ab6c'
      ExpectedOwnerInventory = 'identity,profile,documents,jobs,matching,billing,trust,applications'
    }
  }
  return @{
    ExpectedPolicyVersion = 'd2-development-synthetic-v1'
    ReviewedPolicySha256 = '7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf'
    ExpectedOwnerInventory = 'identity,profile,documents,jobs,matching,billing,trust'
  }
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
  $applications = $null -ne $request.options.PSObject.Properties['ApplicationsInventory']
  $notifications = $null -ne $request.options.PSObject.Properties['NotificationsInventory']
  $expectedNames = @('ExpectedAccountId','ReviewedZeroDriftPlanSha256','SourceSha','StateBucket','ZeroDriftPlanPath')
  if ($restricted) { $expectedNames += 'RestrictedAnswerFixture' }
  if ($resume) { $expectedNames += 'ResumeFixture' }
  if ($applications) { $expectedNames += 'ApplicationsInventory' }
  if ($notifications) { $expectedNames += 'NotificationsInventory' }
  $expectedOptionKeys = @($expectedNames | Sort-Object) -join ','
  if ($optionKeys -cne $expectedOptionKeys -or ($restricted -and ($request.options.RestrictedAnswerFixture -isnot [bool] -or $request.options.RestrictedAnswerFixture -ne $true)) -or
      ($resume -and ($request.options.ResumeFixture -isnot [bool] -or $request.options.ResumeFixture -ne $true)) -or
      ($applications -and ($request.options.ApplicationsInventory -isnot [bool] -or $request.options.ApplicationsInventory -ne $true)) -or
      ($notifications -and (-not $applications -or $request.options.NotificationsInventory -isnot [bool] -or $request.options.NotificationsInventory -ne $true))) { throw 'Invalid session options.' }
  $parameters = @{
    Action = $(if ($request.action -ceq 'plan') { 'Plan' } else { 'Execute' })
    ExpectedExportLifetimeSeconds = 3600
    ExpectedDownloadGrantSeconds = 300
    ExpectedBackupRetentionDays = 35
    ExpectedRecentAuthMaxAgeSeconds = 900
    ExpectedSubprocessorInventory = 'none'
  }
  $policy = Get-RightsSessionPolicy $applications $notifications
  foreach ($name in $policy.Keys) { $parameters[$name] = $policy[$name] }
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
