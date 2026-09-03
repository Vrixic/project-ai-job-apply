[CmdletBinding()]
param(
  [string]$AwsProfile="ai-job-apply-development-admin",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId="",
  [switch]$AllowPolicyEndpoint
)
Set-StrictMode -Version Latest; $ErrorActionPreference="Stop"
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environment=Join-Path $root "infrastructure\terraform\environments\development"
$env:AWS_PROFILE=$AwsProfile;$env:AWS_REGION="us-east-2";$env:AWS_DEFAULT_REGION="us-east-2";$env:AWS_PAGER=""
function Json([string[]]$Arguments){$raw=& aws @Arguments 2>$null;if($LASTEXITCODE){throw "A read-only AWS verification failed."};$raw -join "`n"|ConvertFrom-Json}
$caller=Json @("sts","get-caller-identity","--output","json");if($caller.Account -cne $ExpectedAccountId){throw "AWS account mismatch."}
$mappings=Json @("lambda","list-event-source-mappings","--function-name","ai-job-apply-development-d2-trust-signal:development","--output","json")
if(@($mappings.EventSourceMappings|Where-Object State -eq "Enabled").Count -ne 0){throw "A D2 Trust signal mapping is enabled."}
$rules=Json @("events","list-rule-names-by-target","--target-arn","arn:aws:lambda:us-east-2:$ExpectedAccountId`:function:ai-job-apply-development-d2-community-scheduled:development","--output","json")
if(@($rules.RuleNames).Count -ne 0){throw "A D2 schedule targets the dark alias."}
$gatewayUrl=(& terraform "-chdir=$environment" output -raw gateway_url 2>$null)
if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gatewayUrl)){throw "The exact development gateway URL is unavailable."}
$gatewayMatch=[regex]::Match($gatewayUrl.Trim(),'^https://([a-z0-9]+)\.execute-api\.[a-z0-9-]+\.amazonaws\.com/?$')
if(-not $gatewayMatch.Success){throw "The exact development gateway API ID is unavailable."}
$apiId=$gatewayMatch.Groups[1].Value
$routes=Json @("apigatewayv2","get-routes","--api-id",$apiId.Trim(),"--output","json")
$policyRouteKey='GET /v1/extension/contribution-capability-policy'
$mutationRoutePattern='^((POST /v1/saved-job-captures)|(GET|DELETE) /v1/saved-job-captures/\{captureId\}|(POST /v1/profile/ugc-contribution-consents)|(POST /v1/profile/ugc-contribution-consents/\{consentId\}/revoke)|(POST /v1/jobs/contributions)|(GET /v1/jobs/contributions/\{contributionId\})|(GET /v1/trust/contributions/\{contributionId\})|(POST /v1/trust/contributions/\{contributionId\}/(withdraw|appeals))|(GET /v1/admin/trust/cases/\{caseId\})|(POST /v1/admin/trust/(contributions/\{contributionId\}/cases|cases/\{caseId\}/(decisions|takedowns|appeal-decisions))))$'
$mutationRoutes=@($routes.Items|Where-Object RouteKey -match $mutationRoutePattern)
if($mutationRoutes.Count -ne 0){throw "A D2 mutation, private-read, or Trust route is live."}
$policyRoutes=@($routes.Items|Where-Object RouteKey -ceq $policyRouteKey)
$expectedPolicyRouteCount=if($AllowPolicyEndpoint){1}else{0}
if($policyRoutes.Count -ne $expectedPolicyRouteCount){throw "The D2 policy endpoint state does not match the requested verification mode."}
[pscustomobject]@{Dark=$true;EnabledMappings=0;ScheduleTargets=0;PolicyEndpointRoutes=$policyRoutes.Count;D2MutationRoutes=0;MutationPerformed=$false}
