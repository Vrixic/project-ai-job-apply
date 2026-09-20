Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-gateway-release-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-upload-cors-guards.ps1")

$passed = 0
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function Copy-Fixture { param([Parameter(Mandatory)][object]$Value); return $Value | ConvertTo-Json -Depth 50 | ConvertFrom-Json }

$hosted = "https://ai-job-apply-candidate.vercel.app"
$local = "http://localhost:3000"
$address = "module.platform.aws_s3_bucket_cors_configuration.candidate_documents[0]"

# ---- the origin itself
foreach ($good in @($hosted, "https://example.com", "https://a.b.example.co:8443", "https://x1.example-site.org")) {
  $null = Assert-DocumentUploadCorsOrigin $good; $passed++
}
foreach ($bad in @(
    "", " ", "http://example.com", "https://EXAMPLE.com", "https://example.com/", "https://example.com/path", "https://example.com?x=1",
    "https://example.com#frag", "https://user@example.com", "https://*.example.com", "https://*", "*", "https://localhost",
    "https://example", "https://-bad.example.com", "https://bad-.example.com", "https://exa mple.com", "https://example.com:99999x",
    "https://exämple.com", "ftp://example.com", "https://example.com,https://other.com", "https://example..com"
  )) {
  Assert-Rejected { Assert-DocumentUploadCorsOrigin $bad } "The upload CORS origin '$bad' was accepted."
}

# ---- variables
function New-CorsVariables {
  param([string[]]$Origins, [switch]$AsJsonText)
  $value = @($Origins)
  if ($AsJsonText) { $value = ConvertTo-Json -InputObject @($Origins) -Compress }
  return [pscustomobject]@{
    candidate_document_cors_allowed_origins = [pscustomobject]@{ value = $value }
    deploy_document_intake = [pscustomobject]@{ value = "true" }
    migration_image = [pscustomobject]@{ value = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('1' * 64)" }
    oidc_audience = [pscustomobject]@{ value = "ai-job-apply-api" }
    document_scan_mapping_enabled = [pscustomobject]@{ value = "true" }
  }
}
$baselineVariables = New-CorsVariables @($local)
$plannedVariables = New-CorsVariables @($local, $hosted)
$null = Assert-DocumentUploadCorsVariables $baselineVariables $plannedVariables $hosted; $passed++
$null = Assert-DocumentUploadCorsVariables (New-CorsVariables @($local) -AsJsonText) (New-CorsVariables @($local, $hosted) -AsJsonText) $hosted; $passed++
$null = Assert-DocumentUploadCorsVariables (New-CorsVariables @($local, "https://other.example.com")) (New-CorsVariables @($local, "https://other.example.com", $hosted)) $hosted; $passed++
$null = Assert-DocumentUploadCorsVariables (New-CorsVariables @()) (New-CorsVariables @($hosted)) $hosted; $passed++

Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables $plannedVariables "https://*.vercel.app" } "A wildcard origin was accepted for variables."
Assert-Rejected { Assert-DocumentUploadCorsVariables (New-CorsVariables @($local, $hosted)) $plannedVariables $hosted } "An origin that is already allowed was accepted."
foreach ($case in @(
    @{ Name = "baseline dropped"; Planned = @($hosted) },
    @{ Name = "reordered"; Planned = @($hosted, $local) },
    @{ Name = "extra origin"; Planned = @($local, $hosted, "https://extra.example.com") },
    @{ Name = "replaced baseline"; Planned = @("https://other.example.com", $hosted) },
    @{ Name = "no change"; Planned = @($local) },
    @{ Name = "duplicate"; Planned = @($local, $hosted, $hosted) },
    @{ Name = "wildcard added"; Planned = @($local, $hosted, "*") }
  )) {
  Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables (New-CorsVariables $case.Planned) $hosted } "The upload CORS list '$($case.Name)' was accepted."
}
foreach ($name in @("migration_image", "oidc_audience", "document_scan_mapping_enabled")) {
  $changed = Copy-Fixture $plannedVariables; $changed.$name.value = "changed"
  Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables $changed $hosted } "The upload CORS step changed '$name'."
}
$added = Copy-Fixture $plannedVariables; $added | Add-Member NoteProperty unexpected ([pscustomobject]@{ value = "x" })
Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables $added $hosted } "An added variable was accepted."
$removed = Copy-Fixture $plannedVariables; $removed.PSObject.Properties.Remove("oidc_audience")
Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables $removed $hosted } "A removed variable was accepted."
foreach ($intake in @("false", $false, "False")) {
  $noIntake = Copy-Fixture $plannedVariables; $noIntake.deploy_document_intake.value = $intake
  Assert-Rejected { Assert-DocumentUploadCorsVariables $baselineVariables $noIntake $hosted } "The upload CORS step was accepted without the document intake ($intake)."
}
foreach ($bad in @(@("*"), @("http://example.com"), @("https://a.example.com", "https://a.example.com"), @(5), @("https://example.com/path"))) {
  Assert-Rejected { Assert-DocumentUploadCorsVariables (New-CorsVariables $bad) $plannedVariables $hosted } "A malformed retained list was accepted: $($bad -join ',')."
}

# ---- plan, in the exact shape Terraform reports for this resource
function New-CorsPlan {
  param([string[]]$Before = @($local), [string[]]$After = @($local, $hosted))
  $rule = { param([string[]]$Origins) [ordered]@{
      allowed_headers = @("*"); allowed_methods = @("POST"); allowed_origins = @($Origins)
      expose_headers = @("ETag", "x-amz-version-id"); id = ""; max_age_seconds = 300 } }
  $sensitive = { param([int]$Count) [pscustomobject]@{ cors_rule = @([pscustomobject]@{
        allowed_headers = @($false); allowed_methods = @($false)
        allowed_origins = @(1..$Count | ForEach-Object { $false }); expose_headers = @($false, $false) }) } }
  return [pscustomobject]@{
    terraform_version = "1.16.2"; complete = $true; errored = $false; applyable = $true; resource_drift = @()
    output_changes = [pscustomobject]@{ stable = [pscustomobject]@{ actions = @("no-op") } }
    resource_changes = @([pscustomobject]@{
        address = $address; mode = "managed"; type = "aws_s3_bucket_cors_configuration"
        change = [pscustomobject]@{
          actions = @("update")
          before = [pscustomobject]@{
            bucket = "ai-job-apply-development-candidate-docs-111122223333"
            cors_rule = @([pscustomobject](& $rule $Before)); expected_bucket_owner = ""
            id = "ai-job-apply-development-candidate-docs-111122223333"; region = "us-east-2"
          }
          after = [pscustomobject]@{
            bucket = "ai-job-apply-development-candidate-docs-111122223333"
            cors_rule = @([pscustomobject](& $rule $After)); expected_bucket_owner = ""
            id = "ai-job-apply-development-candidate-docs-111122223333"; region = "us-east-2"
          }
          after_unknown = [pscustomobject]@{}
          before_sensitive = (& $sensitive $Before.Count); after_sensitive = (& $sensitive $After.Count)
        }
      })
  }
}
$good = New-CorsPlan
$changes = @(Assert-ExactDocumentUploadCorsPlan $good @($local) $hosted)
if ($changes.Count -ne 1 -or [string]$changes[0].address -cne $address) { throw "The upload CORS plan did not return the reviewed change." }
$passed++
$null = Assert-ExactDocumentUploadCorsPlan (New-CorsPlan -Before @() -After @($hosted) | ForEach-Object { $_ }) @() $hosted; $passed++

# the baseline the operator passes must be exactly the current list
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $good @($local, "https://other.example.com") $hosted } "A plan was accepted against a different retained list."
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $good @() $hosted } "A plan was accepted against an empty retained list."
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $good @($local) "https://other.example.com" } "A plan for a different origin was accepted."
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $good @($local) "https://*.example.com" } "A wildcard origin was accepted for the plan."

foreach ($case in @(
    @{ Name = "origin missing"; After = @($local) },
    @{ Name = "reordered"; After = @($hosted, $local) },
    @{ Name = "extra origin"; After = @($local, $hosted, "https://extra.example.com") },
    @{ Name = "wildcard added"; After = @($local, $hosted, "*") },
    @{ Name = "baseline dropped"; After = @($hosted) },
    @{ Name = "duplicate"; After = @($local, $hosted, $hosted) }
  )) {
  Assert-Rejected { Assert-ExactDocumentUploadCorsPlan (New-CorsPlan -After $case.After) @($local) $hosted } "The upload CORS plan '$($case.Name)' was accepted."
}
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan (New-CorsPlan -Before @($local, "https://x.example.com")) @($local) $hosted } "A plan whose before list differs from the retained list was accepted."

$bad = Copy-Fixture $good; $bad.terraform_version = "1.9.8"
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "A non-approved Terraform version was accepted."
foreach ($flag in @("errored", "complete", "applyable")) {
  $bad = Copy-Fixture $good; $bad.$flag = -not $bad.$flag
  Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "A plan with '$flag' flipped was accepted."
}
$bad = Copy-Fixture $good; $bad.output_changes.stable.actions = @("update")
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "An output change was accepted."
foreach ($extraAddress in @("module.platform.aws_lambda_function.gateway[0]", "module.platform.aws_s3_bucket.candidate_documents[0]", "module.platform.aws_s3_bucket_policy.candidate_documents[0]")) {
  $bad = Copy-Fixture $good
  $extra = Copy-Fixture $bad.resource_changes[0]; $extra.address = $extraAddress
  $bad.resource_changes = @($bad.resource_changes) + @($extra)
  Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "An extra change to $extraAddress was accepted."
}
$bad = Copy-Fixture $good; $bad.resource_changes = @()
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "An empty plan was accepted."
$bad = Copy-Fixture $good; $bad.resource_changes[0].address = "module.platform.aws_s3_bucket_cors_configuration.other[0]"
Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "A different address was accepted."

foreach ($mutation in @(
    "create", "delete", "replace", "no-op", "wrong type", "data mode", "replace path", "unknown value", "sensitive before",
    "sensitive after", "second rule", "no rule", "methods", "headers", "expose", "max age", "rule id", "bucket", "bucket other",
    "owner", "region", "id", "extra attribute"
  )) {
  $bad = Copy-Fixture $good
  $change = $bad.resource_changes[0]
  switch ($mutation) {
    "create" { $change.change.actions = @("create") }
    "delete" { $change.change.actions = @("delete") }
    "replace" { $change.change.actions = @("delete", "create") }
    "no-op" { $change.change.actions = @("no-op") }
    "wrong type" { $change.type = "aws_s3_bucket_policy" }
    "data mode" { $change.mode = "data" }
    "replace path" { $change.change | Add-Member NoteProperty replace_paths @(, @("bucket")) -Force }
    "unknown value" { $change.change.after_unknown | Add-Member NoteProperty id $true }
    "sensitive before" { $change.change.before_sensitive.cors_rule[0].allowed_origins[0] = $true }
    "sensitive after" { $change.change.after_sensitive.cors_rule[0].allowed_origins[1] = $true }
    "second rule" { $change.change.after.cors_rule = @($change.change.after.cors_rule[0], (Copy-Fixture $change.change.after.cors_rule[0])) }
    "no rule" { $change.change.after.cors_rule = @() }
    "methods" { $change.change.after.cors_rule[0].allowed_methods = @("POST", "GET") }
    "headers" { $change.change.after.cors_rule[0].allowed_headers = @("x-amz-*") }
    "expose" { $change.change.after.cors_rule[0].expose_headers = @("ETag") }
    "max age" { $change.change.after.cors_rule[0].max_age_seconds = 86400 }
    "rule id" { $change.change.after.cors_rule[0].id = "added" }
    "bucket" { $change.change.after.bucket = "another-bucket" }
    "bucket other" { $change.change.before.bucket = "another-bucket" }
    "owner" { $change.change.after.expected_bucket_owner = "111122223333" }
    "region" { $change.change.after.region = "eu-west-1" }
    "id" { $change.change.after.id = "changed" }
    "extra attribute" { $change.change.after | Add-Member NoteProperty leaked "x" }
  }
  Assert-Rejected { Assert-ExactDocumentUploadCorsPlan $bad @($local) $hosted } "The upload CORS plan accepted the '$mutation' mutation."
}

Write-Host "Document upload CORS guard tests passed: $passed"
