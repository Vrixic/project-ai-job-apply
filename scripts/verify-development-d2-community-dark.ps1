[CmdletBinding()]
param([string]$AwsProfile="ai-job-apply-development-admin",[ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId="")
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
$apiId=(& terraform "-chdir=$environment" output -raw gateway_api_id 2>$null)
if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($apiId)){throw "The exact development gateway API ID is unavailable."}
$routes=Json @("apigatewayv2","get-routes","--api-id",$apiId.Trim(),"--output","json")
$d2RoutePattern='^((GET /v1/extension/contribution-capability-policy)|(POST /v1/saved-job-captures)|(GET|DELETE) /v1/saved-job-captures/\{captureId\}|(POST /v1/profile/ugc-contribution-consents)|(POST /v1/profile/ugc-contribution-consents/\{consentId\}/revoke)|(POST /v1/jobs/contributions)|(GET /v1/jobs/contributions/\{contributionId\})|(GET /v1/trust/contributions/\{contributionId\})|(POST /v1/trust/contributions/\{contributionId\}/(withdraw|appeals))|(GET /v1/admin/trust/cases/\{caseId\})|(POST /v1/admin/trust/(contributions/\{contributionId\}/cases|cases/\{caseId\}/(decisions|takedowns|appeal-decisions))))$'
if(@($routes.Items|Where-Object RouteKey -match $d2RoutePattern).Count -ne 0){throw "A D2 route is live."}
[pscustomobject]@{Dark=$true;EnabledMappings=0;ScheduleTargets=0;D2Routes=0;MutationPerformed=$false}
