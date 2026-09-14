# Invoked only by the in-memory local session. stdin contains reviewed nonsecret arguments;
# tokens and the candidate client secret are process-only environment inputs to the maintained operator.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  $inputJson = [Console]::In.ReadToEnd()
  if ($inputJson.Length -gt 16384) { throw 'Invalid session request.' }
  $request = $inputJson | ConvertFrom-Json
  $requestKeys = @($request.PSObject.Properties.Name | Sort-Object) -join ','
  if (($request.action -ceq 'plan' -and $requestKeys -cne 'action,options') -or
      ($request.action -ceq 'execute' -and $requestKeys -cne 'action,options,reviewedPlan') -or
      $request.action -cnotin @('plan', 'execute')) { throw 'Invalid session request.' }
  $optionKeys = @($request.options.PSObject.Properties.Name | Sort-Object) -join ','
  if ($optionKeys -cne 'ExpectedAccountId,ReviewedZeroDriftPlanSha256,SourceSha,StateBucket,ZeroDriftPlanPath') { throw 'Invalid session options.' }
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
  if ($request.action -ceq 'execute') {
    if ((@($request.reviewedPlan.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'path,sha256') { throw 'Invalid reviewed plan.' }
    $parameters.ExecutionPlanPath = [string]$request.reviewedPlan.path
    $parameters.ReviewedExecutionPlanSha256 = [string]$request.reviewedPlan.sha256
  }
  $operator = Join-Path $PSScriptRoot '../operate-development-candidate-rights-acceptance.ps1'
  $result = & $operator @parameters
  $result | ConvertTo-Json -Depth 10 -Compress
} catch {
  $reason = 'operator_failed_check_recovery'
  if ($_.Exception.Message -like 'D2 acceptance stopped before account deletion:*') { $reason = 'd2_coverage_missing' }
  elseif ($_.Exception.Message -like 'The disposable identity is not an exact current*') { $reason = 'identity_not_fresh' }
  elseif ($_.Exception.Message -match 'clean|origin/main|merged') { $reason = 'source_not_ready' }
  [pscustomobject]@{ outcome = 'failed'; reason = $reason } | ConvertTo-Json -Compress
  exit 1
}
