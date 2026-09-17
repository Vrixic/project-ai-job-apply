Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$verifier = Join-Path $repository 'scripts/verify-development-d2-community-dark.ps1'
$composition = Get-Content -Raw -LiteralPath (Join-Path $repository 'infrastructure/terraform/modules/platform/community-runtime.tf')
$routes = @([regex]::Matches($composition, '"((?:GET|POST|DELETE) /v1/[^"]+)"\s*=\s*\[') | ForEach-Object { $_.Groups[1].Value })
if ($routes.Count -ne 19) { throw 'The exact D2 Terraform route inventory changed; review its acceptance matrix.' }
$global:D2DarkBoundaryMock = @{ routes=@() }
function global:aws {
  $global:LASTEXITCODE=0
  switch ("$($args[0]) $($args[1])") {
    'sts get-caller-identity' { '{"Account":"123456789012"}'; return }
    'lambda list-event-source-mappings' { '{"EventSourceMappings":[]}'; return }
    'events list-rule-names-by-target' { '{"RuleNames":[]}'; return }
    'apigatewayv2 get-routes' {
      @{ Items=@($global:D2DarkBoundaryMock.routes | ForEach-Object { @{ RouteKey=$_ } }) } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    default { throw 'Unexpected AWS call in read-only dark verification.' }
  }
}
function global:terraform {
  if (($args -join ' ') -notmatch 'output -raw gateway_url$') { throw 'Unexpected Terraform call.' }
  $global:LASTEXITCODE=0
  'https://synthetic123.execute-api.us-east-2.amazonaws.com'
}
$result = & $verifier -ExpectedAccountId '123456789012'
if (-not $result.Dark -or $result.D2MutationRoutes -ne 0) { throw 'Empty D2 boundary did not pass.' }
$global:D2DarkBoundaryMock.routes=@('GET /v1/extension/contribution-capability-policy','GET /v1/jobs')
$result = & $verifier -ExpectedAccountId '123456789012' -AllowPolicyEndpoint
if (-not $result.Dark -or $result.PolicyEndpointRoutes -ne 1) { throw 'Allowed policy-only boundary failed.' }
foreach ($route in @($routes + 'ANY /v1/admin/trust/future-review-action' + 'PATCH /v1/jobs/contributions/{contributionId}')) {
  $global:D2DarkBoundaryMock.routes=@($route)
  $rejected=$false
  try { $null = & $verifier -ExpectedAccountId '123456789012' } catch { $rejected=$true }
  if (-not $rejected) { throw "A deployed D2 route was incorrectly accepted as dark: $route" }
}
'Development D2 dark-route boundary passed for all 19 configured routes and future namespace variants (mock AWS only).'
