Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\lib\deployment-operator-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-document-dark-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-gateway-release-guards.ps1")
. (Join-Path $PSScriptRoot "..\lib\development-candidate-rights-activity-guards.ps1")

$passed = 0
function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Operation, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
  $script:passed++
}
function Copy-Fixture { param([Parameter(Mandatory)][object]$Value); return $Value | ConvertTo-Json -Depth 60 | ConvertFrom-Json }

$sourceSha = "a" * 40
$boundarySha = "b" * 64
$oldSha = "1" * 64
$newSha = "2" * 64
$newBase64 = ("N" * 43) + "="
$newKey = "lambda/workflows/$sourceSha/$newSha/profile-readiness-activity-lambda.zip"
$oldKey = "lambda/workflows/$('c' * 40)/$oldSha/profile-readiness-activity-lambda.zip"

# ---- the publication receipt
function New-WorkflowReceipt {
  $entries = @()
  foreach ($name in @("workflow-ingress-lambda", "profile-readiness-durable-lambda", "profile-readiness-activity-lambda")) {
    $sha = if ($name -ceq "profile-readiness-activity-lambda") { $newSha } else { ("3" * 64) }
    foreach ($suffix in @("zip", "cdx.json", "manifest.json", "sha256")) {
      $entries += [pscustomobject]@{
        artifactName = $name; artifactSha256 = $sha; suffix = $suffix
        key = "lambda/workflows/$sourceSha/$sha/$name.$suffix"; versionId = "version-$name-$suffix"
        objectSha256 = $(if ($suffix -ceq "zip") { $sha } else { ("4" * 64) })
        objectBase64Sha256 = $(if ($name -ceq "profile-readiness-activity-lambda" -and $suffix -ceq "zip") { $newBase64 } else { ("M" * 43) + "=" })
        contentLength = 1000
      }
    }
  }
  return [pscustomobject]@{
    schemaVersion = 1; kind = "development-core-workflow-lambda-publication"; environment = "development"; region = "us-east-2"
    sourceSha = $sourceSha; boundarySha256 = $boundarySha; phase = "verified"
    createdAt = "2026-09-21T12:00:00.0000000Z"; completedAt = "2026-09-21T12:01:00.0000000Z"; artifacts = $entries
  }
}
$receipt = New-WorkflowReceipt
$artifact = Get-CandidateRightsActivityArtifact -Receipt $receipt -SourceSha $sourceSha -BoundarySha256 $boundarySha; $passed++
if ($artifact.key -cne $newKey -or $artifact.versionId -cne "version-profile-readiness-activity-lambda-zip" -or
    $artifact.artifactSha256 -cne $newSha -or $artifact.objectBase64Sha256 -cne $newBase64) { throw "The activity archive was not extracted exactly." }
$passed++

foreach ($case in @(
    @{ Name = "another source"; Mutate = { param($r) $r.sourceSha = "d" * 40 } },
    @{ Name = "another boundary"; Mutate = { param($r) $r.boundarySha256 = "e" * 64 } },
    @{ Name = "not verified"; Mutate = { param($r) $r.phase = "publishing" } },
    @{ Name = "another kind"; Mutate = { param($r) $r.kind = "development-gateway-lambda-publication" } },
    @{ Name = "another environment"; Mutate = { param($r) $r.environment = "staging" } },
    @{ Name = "another schema"; Mutate = { param($r) $r.schemaVersion = 2 } },
    @{ Name = "an extra property"; Mutate = { param($r) $r | Add-Member NoteProperty extra "x" } },
    @{ Name = "a missing companion"; Mutate = { param($r) $r.artifacts = @($r.artifacts | Where-Object { -not ($_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "sha256") }) } },
    @{ Name = "a duplicated archive"; Mutate = { param($r) $r.artifacts = @($r.artifacts) + @($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }) } },
    @{ Name = "no activity artifact"; Mutate = { param($r) $r.artifacts = @($r.artifacts | Where-Object { $_.artifactName -cne "profile-readiness-activity-lambda" }) } },
    @{ Name = "a key for another source"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].key = $oldKey } },
    @{ Name = "a key for another archive name"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].key = "lambda/workflows/$sourceSha/$newSha/profile-readiness-durable-lambda.zip" } },
    @{ Name = "object and artifact digests that differ"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].objectSha256 = "5" * 64 } },
    @{ Name = "an invalid base64 digest"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].objectBase64Sha256 = "short" } },
    @{ Name = "no object version"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].versionId = "" } },
    @{ Name = "an empty object"; Mutate = { param($r) (@($r.artifacts | Where-Object { $_.artifactName -ceq "profile-readiness-activity-lambda" -and $_.suffix -ceq "zip" }))[0].contentLength = 0 } }
  )) {
  $bad = Copy-Fixture $receipt
  & $case.Mutate $bad
  Assert-Rejected { Get-CandidateRightsActivityArtifact -Receipt $bad -SourceSha $sourceSha -BoundarySha256 $boundarySha } "The receipt with $($case.Name) was accepted."
}

# ---- variables
function New-ActivityVariables {
  param([string]$Key, [string]$Version, [string]$Sha, [string]$Base64, [string]$Other = "old", [string]$Durable = "true", [string]$Rights = "true")
  return [pscustomobject]@{
    profile_readiness_activity_artifact_s3_key = [pscustomobject]@{ value = $Key }
    profile_readiness_activity_artifact_s3_object_version = [pscustomobject]@{ value = $Version }
    profile_readiness_activity_artifact_sha256 = [pscustomobject]@{ value = $Sha }
    profile_readiness_activity_artifact_base64sha256 = [pscustomobject]@{ value = $Base64 }
    profile_readiness_durable_artifact_sha256 = [pscustomobject]@{ value = ("6" * 64) }
    gateway_lambda_artifact_sha256 = [pscustomobject]@{ value = ("7" * 64) }
    deploy_profile_readiness_durable = [pscustomobject]@{ value = $Durable }
    candidate_rights_enabled = [pscustomobject]@{ value = $Rights }
    oidc_audience = [pscustomobject]@{ value = $Other }
  }
}
$baselineVariables = New-ActivityVariables $oldKey "old-version" $oldSha (("O" * 43) + "=")
$plannedVariables = New-ActivityVariables $newKey $artifact.versionId $newSha $newBase64
$null = Assert-CandidateRightsActivityVariables $baselineVariables $plannedVariables $artifact; $passed++

foreach ($case in @(
    @{ Name = "another key"; Planned = { New-ActivityVariables ($newKey + "x") $artifact.versionId $newSha $newBase64 } },
    @{ Name = "another object version"; Planned = { New-ActivityVariables $newKey "other-version" $newSha $newBase64 } },
    @{ Name = "another digest"; Planned = { New-ActivityVariables $newKey $artifact.versionId ("8" * 64) $newBase64 } },
    @{ Name = "another base64 digest"; Planned = { New-ActivityVariables $newKey $artifact.versionId $newSha (("Q" * 43) + "=") } },
    @{ Name = "an unrelated change"; Planned = { New-ActivityVariables $newKey $artifact.versionId $newSha $newBase64 "changed" } },
    @{ Name = "the durable flag disabled"; Planned = { New-ActivityVariables $newKey $artifact.versionId $newSha $newBase64 "old" "false" } },
    @{ Name = "candidate rights disabled"; Planned = { New-ActivityVariables $newKey $artifact.versionId $newSha $newBase64 "old" "true" "false" } }
  )) {
  $planned = & $case.Planned
  Assert-Rejected { Assert-CandidateRightsActivityVariables $baselineVariables $planned $artifact } "The variables with $($case.Name) were accepted."
}
$alreadyReleased = New-ActivityVariables $newKey $artifact.versionId $newSha $newBase64
Assert-Rejected { Assert-CandidateRightsActivityVariables $alreadyReleased $plannedVariables $artifact } "An already released archive was accepted."
$extraVariable = Copy-Fixture $plannedVariables; $extraVariable | Add-Member NoteProperty extra_variable ([pscustomobject]@{ value = "x" })
Assert-Rejected { Assert-CandidateRightsActivityVariables $baselineVariables $extraVariable $artifact } "A changed variable inventory was accepted."

# ---- the plan
function New-Change {
  param(
    [string]$Address, [string]$Type, [string[]]$Actions = @("update"), [hashtable]$Before = @{}, [hashtable]$After = @{},
    [hashtable]$Unknown = @{}, [hashtable]$BeforeSensitive = @{}, [hashtable]$AfterSensitive = @{}, [string[]]$ReplacePaths = @()
  )
  $change = [pscustomobject]@{
    actions = $Actions; before = [pscustomobject]$Before; after = [pscustomobject]$After
    after_unknown = [pscustomobject]$Unknown; before_sensitive = [pscustomobject]$BeforeSensitive; after_sensitive = [pscustomobject]$AfterSensitive
  }
  if ($ReplacePaths.Count -gt 0) { $change | Add-Member NoteProperty replace_paths @(, @($ReplacePaths)) }
  return [pscustomobject]@{ address = $Address; mode = "managed"; type = $Type; name = "x"; change = $change }
}
function New-EnvVariables { param([hashtable]$Values) return , @([pscustomobject]@{ variables = [pscustomobject]$Values }) }
$sensitiveOidc = @{ environment = @([pscustomobject]@{ variables = [pscustomobject]@{ OIDC_ISSUER = $true } }) }
$functionUnknown = @{ last_modified = $true; qualified_arn = $true; qualified_invoke_arn = $true; version = $true }

function New-ActivityPlan {
  $activityBefore = @{
    function_name = "activity"; handler = "index.activity"; memory_size = 512; timeout = 300; layers = @("arn:layer:1")
    s3_key = $oldKey; s3_object_version = "old-version"; source_code_hash = ("O" * 43) + "="; version = "15"
    qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:activity:15"; qualified_invoke_arn = "arn:invoke:15"; last_modified = "2026-09-16"
    environment = New-EnvVariables @{ RELEASE_SHA = $oldSha; NODE_ENV = "production"; OIDC_ISSUER = "https://issuer.example/" }
  }
  $activityAfter = @{
    function_name = "activity"; handler = "index.activity"; memory_size = 512; timeout = 300; layers = @("arn:layer:1")
    s3_key = $newKey; s3_object_version = $artifact.versionId; source_code_hash = $newBase64
    environment = New-EnvVariables @{ RELEASE_SHA = $newSha; NODE_ENV = "production"; OIDC_ISSUER = "https://issuer.example/" }
  }
  $terminalBefore = @{
    function_name = "terminal"; handler = "index.terminal"; memory_size = 512; timeout = 30
    s3_key = $oldKey; s3_object_version = "old-version"; source_code_hash = ("O" * 43) + "="; version = "15"
    qualified_arn = "arn:t:15"; qualified_invoke_arn = "arn:ti:15"; last_modified = "2026-09-16"
    environment = New-EnvVariables @{ RELEASE_SHA = $oldSha; NODE_ENV = "production"; DURABLE_FUNCTION_ARN = "arn:durable:15" }
  }
  $terminalAfter = @{
    function_name = "terminal"; handler = "index.terminal"; memory_size = 512; timeout = 30
    s3_key = $newKey; s3_object_version = $artifact.versionId; source_code_hash = $newBase64
    environment = @([pscustomobject]@{})
  }
  $outboxBefore = @{
    function_name = "outbox"; handler = "index.handler"; version = "15"; qualified_arn = "arn:o:15"; qualified_invoke_arn = "arn:oi:15"
    environment = New-EnvVariables @{ NODE_ENV = "production"; DURABLE_FUNCTION_ARN = "arn:durable:15" }
  }
  $outboxAfter = @{ function_name = "outbox"; handler = "index.handler"; environment = @([pscustomobject]@{}) }
  $envUnknown = @{ environment = @([pscustomobject]@{ variables = $true }) }
  $aliasUnknown = @{ function_version = $true }
  $changes = @(
    (New-Change "module.platform.aws_lambda_function.profile_readiness_activity[0]" "aws_lambda_function" -Before $activityBefore -After $activityAfter -Unknown $functionUnknown -BeforeSensitive $sensitiveOidc -AfterSensitive $sensitiveOidc),
    (New-Change "module.platform.aws_lambda_alias.profile_readiness_activity[0]" "aws_lambda_alias" -Before @{ name = "development"; function_version = "15" } -After @{ name = "development" } -Unknown $aliasUnknown),
    (New-Change "module.platform.aws_lambda_function.profile_readiness_terminal[0]" "aws_lambda_function" -Before $terminalBefore -After $terminalAfter -Unknown ($functionUnknown + $envUnknown)),
    (New-Change "module.platform.aws_lambda_alias.profile_readiness_terminal[0]" "aws_lambda_alias" -Before @{ name = "development"; function_version = "15" } -After @{ name = "development" } -Unknown $aliasUnknown),
    (New-Change "module.platform.aws_cloudformation_stack.profile_readiness_durable[0]" "aws_cloudformation_stack" -Before @{ name = "durable"; template_body = "{old}"; outputs = [pscustomobject]@{ DurableVersionArn = "arn:durable:15" } } -After @{ name = "durable" } -Unknown @{ template_body = $true; outputs = $true }),
    (New-Change "module.platform.aws_iam_role_policy.profile_readiness_durable[0]" "aws_iam_role_policy" -Before @{ name = "durable"; policy = "{old}" } -After @{ name = "durable" } -Unknown @{ policy = $true }),
    (New-Change "module.platform.aws_lambda_function.outbox_starter[0]" "aws_lambda_function" -Before $outboxBefore -After $outboxAfter -Unknown (@{ qualified_arn = $true; qualified_invoke_arn = $true; version = $true } + $envUnknown)),
    (New-Change "module.platform.aws_lambda_alias.outbox_starter[0]" "aws_lambda_alias" -Before @{ name = "development"; function_version = "15" } -After @{ name = "development" } -Unknown $aliasUnknown),
    (New-Change "module.platform.aws_iam_role_policy.outbox_starter[0]" "aws_iam_role_policy" -Before @{ name = "outbox"; policy = "{old}" } -After @{ name = "outbox" } -Unknown @{ policy = $true }),
    (New-Change "module.platform.aws_cloudwatch_event_rule.profile_readiness_terminal[0]" "aws_cloudwatch_event_rule" -Before @{ name = "terminal"; event_pattern = "{old}" } -After @{ name = "terminal" } -Unknown @{ event_pattern = $true }),
    (New-Change "module.platform.aws_vpc_endpoint.lambda[0]" "aws_vpc_endpoint" -Before @{ service_name = "lambda"; policy = "{old}" } -After @{ service_name = "lambda" } -Unknown @{ policy = $true }),
    (New-Change "module.platform.time_sleep.profile_readiness_durable_policy_propagation[0]" "time_sleep" -Actions @("create", "delete") -Before @{ id = "2026"; triggers = [pscustomobject]@{ role_arn = "arn:role"; policy_sha256 = "old" } } -After @{ triggers = [pscustomobject]@{ role_arn = "arn:role" } } -Unknown @{ id = $true; triggers = [pscustomobject]@{ policy_sha256 = $true } } -ReplacePaths @("triggers"))
  )
  $outputs = [pscustomobject]@{
    profile_readiness_durable_alias_arn = [pscustomobject]@{ actions = @("update") }
    profile_readiness_durable_version_arn = [pscustomobject]@{ actions = @("update") }
    gateway_alias_arn = [pscustomobject]@{ actions = @("no-op") }
  }
  return [pscustomobject]@{
    terraform_version = (Get-DeploymentTerraformVersion); errored = $false; complete = $true; applyable = $true
    resource_changes = $changes; output_changes = $outputs; resource_drift = @()
    planned_values = [pscustomobject]@{ root_module = [pscustomobject]@{ resources = @() } }
  }
}
function Get-ChangeOf { param([object]$Plan, [string]$Stem); return @($Plan.resource_changes | Where-Object { $_.address.Contains($Stem) })[0] }

$plan = New-ActivityPlan
$null = Assert-ExactCandidateRightsActivityPlan $plan $artifact; $passed++
# a data-source read beside them is not a change
$withRead = Copy-Fixture $plan
$withRead.resource_changes = @($withRead.resource_changes) + @([pscustomobject]@{ address = "module.platform.data.aws_iam_policy_document.x[0]"; mode = "data"; type = "aws_iam_policy_document"; change = [pscustomobject]@{ actions = @("read"); before = $null; after = [pscustomobject]@{}; after_unknown = [pscustomobject]@{} } })
$null = Assert-ExactCandidateRightsActivityPlan $withRead $artifact; $passed++

# the shared plan requirements
foreach ($case in @(
    @{ Name = "a wrong Terraform version"; Mutate = { param($p) $p.terraform_version = "1.9.8" } },
    @{ Name = "an errored plan"; Mutate = { param($p) $p.errored = $true } },
    @{ Name = "an incomplete plan"; Mutate = { param($p) $p.complete = $false } },
    @{ Name = "a non-applyable plan"; Mutate = { param($p) $p.applyable = $false } }
  )) {
  $bad = Copy-Fixture $plan; & $case.Mutate $bad
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "The plan with $($case.Name) was accepted."
}

# the resource set
$missing = Copy-Fixture $plan
$missing.resource_changes = @($missing.resource_changes | Where-Object { $_.address -notlike "*vpc_endpoint.lambda*" })
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $missing $artifact } "A plan missing a reviewed resource was accepted."
foreach ($extra in @(
    @{ Address = "module.platform.aws_lambda_function.gateway[0]"; Type = "aws_lambda_function" },
    @{ Address = "module.platform.aws_iam_role_policy.gateway_lambda[0]"; Type = "aws_iam_role_policy" },
    @{ Address = "module.platform.aws_s3_bucket_policy.candidate_documents[0]"; Type = "aws_s3_bucket_policy" },
    @{ Address = "module.platform.aws_lambda_function.document_processor[0]"; Type = "aws_lambda_function" }
  )) {
  $bad = Copy-Fixture $plan
  $bad.resource_changes = @($bad.resource_changes) + @((New-Change $extra.Address $extra.Type -Before @{ a = 1 } -After @{ a = 2 }))
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "A plan that also changes '$($extra.Address)' was accepted."
}
$duplicated = Copy-Fixture $plan
$duplicated.resource_changes = @($duplicated.resource_changes) + @((Get-ChangeOf $duplicated "aws_vpc_endpoint.lambda"))
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $duplicated $artifact } "A duplicated resource change was accepted."

# actions and replacement
foreach ($stem in @("profile_readiness_activity[0]", "profile_readiness_terminal[0]", "outbox_starter[0]", "profile_readiness_durable[0]", "vpc_endpoint.lambda")) {
  foreach ($actions in @(@("delete"), @("create", "delete"), @("no-op"))) {
    $bad = Copy-Fixture $plan
    $target = @($bad.resource_changes | Where-Object { $_.address.Contains($stem) -and $_.address -notlike "*alias*" -and $_.address -notlike "*policy*" -and $_.address -notlike "*rule*" -and $_.address -notlike "*stack*" -and $_.address -notlike "*time_sleep*" })
    if ($target.Count -eq 0) { continue }
    $target[0].change.actions = $actions
    Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "Actions '$($actions -join ',')' were accepted for '$stem'."
  }
}
$replaced = Copy-Fixture $plan
(Get-ChangeOf $replaced "profile_readiness_activity[0]").change | Add-Member NoteProperty replace_paths @(, @("s3_key"))
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $replaced $artifact } "A replacement path on the activity Lambda was accepted."
$timerOnly = Copy-Fixture $plan
(Get-ChangeOf $timerOnly "time_sleep").change.actions = @("create")
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $timerOnly $artifact } "A timer that is only created was accepted."
$timerPaths = Copy-Fixture $plan
(Get-ChangeOf $timerPaths "time_sleep").change.replace_paths = @(, @("create_duration"))
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $timerPaths $artifact } "A timer replaced for another reason was accepted."
$wrongType = Copy-Fixture $plan
(Get-ChangeOf $wrongType "vpc_endpoint.lambda").type = "aws_vpc_endpoint_service"
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $wrongType $artifact } "A wrong resource type was accepted."

# attributes: a nonapproved change on each resource
foreach ($case in @(
    @{ Stem = "profile_readiness_activity[0]"; Attribute = "memory_size"; Value = 1024 },
    @{ Stem = "profile_readiness_activity[0]"; Attribute = "handler"; Value = "index.other" },
    @{ Stem = "profile_readiness_activity[0]"; Attribute = "layers"; Value = @("arn:layer:2") },
    @{ Stem = "profile_readiness_activity[0]"; Attribute = "timeout"; Value = 900 },
    @{ Stem = "profile_readiness_terminal[0]"; Attribute = "memory_size"; Value = 1024 },
    @{ Stem = "profile_readiness_terminal[0]"; Attribute = "handler"; Value = "index.other" },
    @{ Stem = "outbox_starter[0]"; Attribute = "handler"; Value = "index.other" },
    @{ Stem = "lambda_alias.profile_readiness_activity"; Attribute = "name"; Value = "other" },
    @{ Stem = "lambda_alias.profile_readiness_terminal"; Attribute = "name"; Value = "other" },
    @{ Stem = "lambda_alias.outbox_starter"; Attribute = "name"; Value = "other" },
    @{ Stem = "cloudformation_stack"; Attribute = "name"; Value = "other" },
    @{ Stem = "role_policy.profile_readiness_durable"; Attribute = "name"; Value = "other" },
    @{ Stem = "role_policy.outbox_starter"; Attribute = "name"; Value = "other" },
    @{ Stem = "event_rule"; Attribute = "name"; Value = "other" },
    @{ Stem = "vpc_endpoint.lambda"; Attribute = "service_name"; Value = "s3" }
  )) {
  $bad = Copy-Fixture $plan
  $target = @($bad.resource_changes | Where-Object { $_.address.Contains($case.Stem) })[0]
  $target.change.after | Add-Member NoteProperty $case.Attribute $case.Value -Force
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "A change to '$($case.Attribute)' of '$($case.Stem)' was accepted."
}
$envOther = Copy-Fixture $plan
(Get-ChangeOf $envOther "profile_readiness_activity[0]").change.after.environment[0].variables.NODE_ENV = "development"
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $envOther $artifact } "A changed activity environment variable was accepted."
$envAdded = Copy-Fixture $plan
(Get-ChangeOf $envAdded "profile_readiness_activity[0]").change.after.environment[0].variables | Add-Member NoteProperty EXTRA "x"
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $envAdded $artifact } "An added activity environment variable was accepted."

# unknown and sensitive values outside the reviewed ones
foreach ($case in @(
    @{ Stem = "profile_readiness_activity[0]"; Path = "kms_key_arn" },
    @{ Stem = "profile_readiness_activity[0]"; Path = "layers" },
    @{ Stem = "lambda_alias.profile_readiness_activity"; Path = "name" },
    @{ Stem = "role_policy.profile_readiness_durable"; Path = "role" },
    @{ Stem = "vpc_endpoint.lambda"; Path = "vpc_id" },
    @{ Stem = "event_rule"; Path = "state" }
  )) {
  $bad = Copy-Fixture $plan
  $target = @($bad.resource_changes | Where-Object { $_.address.Contains($case.Stem) })[0]
  $target.change.after_unknown | Add-Member NoteProperty $case.Path $true -Force
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "An unknown '$($case.Path)' of '$($case.Stem)' was accepted."
}
$sensitive = Copy-Fixture $plan
(Get-ChangeOf $sensitive "role_policy.profile_readiness_durable").change.after_sensitive | Add-Member NoteProperty policy $true
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $sensitive $artifact } "A new sensitive value was accepted."
$sensitiveMoved = Copy-Fixture $plan
(Get-ChangeOf $sensitiveMoved "profile_readiness_activity[0]").change.before_sensitive.environment[0].variables | Add-Member NoteProperty NODE_ENV $true
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $sensitiveMoved $artifact } "A different sensitive environment leaf was accepted."

# the Lambda code updates are bound to the verified archive
foreach ($case in @(
    @{ Stem = "profile_readiness_activity[0]"; Field = "s3_key"; Value = $oldKey },
    @{ Stem = "profile_readiness_activity[0]"; Field = "s3_object_version"; Value = "other" },
    @{ Stem = "profile_readiness_activity[0]"; Field = "source_code_hash"; Value = (("Q" * 43) + "=") },
    @{ Stem = "profile_readiness_terminal[0]"; Field = "s3_key"; Value = $oldKey },
    @{ Stem = "profile_readiness_terminal[0]"; Field = "s3_object_version"; Value = "other" },
    @{ Stem = "profile_readiness_terminal[0]"; Field = "source_code_hash"; Value = (("Q" * 43) + "=") }
  )) {
  $bad = Copy-Fixture $plan
  (Get-ChangeOf $bad $case.Stem).change.after.($case.Field) = $case.Value
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "The '$($case.Field)' of '$($case.Stem)' not equal to the archive was accepted."
}
$releaseSha = Copy-Fixture $plan
(Get-ChangeOf $releaseSha "profile_readiness_activity[0]").change.after.environment[0].variables.RELEASE_SHA = "9" * 64
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $releaseSha $artifact } "A release identity that is not the archive was accepted."

# outputs
foreach ($case in @(
    @{ Name = "an extra output"; Mutate = { param($p) $p.output_changes | Add-Member NoteProperty gateway_alias_arn ([pscustomobject]@{ actions = @("update") }) -Force } },
    @{ Name = "a missing output"; Mutate = { param($p) $p.output_changes.profile_readiness_durable_alias_arn.actions = @("no-op") } },
    @{ Name = "a deleted output"; Mutate = { param($p) $p.output_changes.profile_readiness_durable_version_arn.actions = @("delete") } },
    @{ Name = "an unrelated output"; Mutate = { param($p) $p.output_changes | Add-Member NoteProperty migration_task_definition_arn ([pscustomobject]@{ actions = @("update") }) } }
  )) {
  $bad = Copy-Fixture $plan; & $case.Mutate $bad
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact } "The plan with $($case.Name) was accepted."
}

# provider drift that is not an accepted refresh
$drift = Copy-Fixture $plan
$drift.resource_drift = @([pscustomobject]@{ address = "module.platform.aws_iam_role.gateway_lambda[0]"; mode = "managed"; type = "aws_iam_role"; change = [pscustomobject]@{ actions = @("update"); before = [pscustomobject]@{ a = 1 }; after = [pscustomobject]@{ a = 2 }; after_unknown = [pscustomobject]@{} } })
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $drift $artifact } "Unreviewed provider drift was accepted."

# ---- separately reviewed default-off restricted-answer export activation
$vaultArn = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001"
$rightsAddress = "module.platform.aws_iam_role_policy.candidate_rights_activity[0]"
$basePolicy = [pscustomobject]@{ Version = "2012-10-17"; Statement = @([pscustomobject]@{ Sid = "Existing"; Effect = "Allow"; Action = "s3:GetObject"; Resource = "arn:aws:s3:::synthetic/*" }) }
$exportGrant = [pscustomobject]@{
  Sid = "DecryptRestrictedAnswersForCandidateExport"; Effect = "Allow"; Action = "kms:Decrypt"; Resource = $vaultArn
  Condition = [pscustomobject]@{ StringEquals = [pscustomobject]@{ "kms:EncryptionContext:purpose" = "restricted-answer-vault-v1" } }
}
function New-ExportActivationPlan {
  $p = New-ActivityPlan
  $p | Add-Member NoteProperty variables ([pscustomobject]@{ restricted_answer_export_enabled = [pscustomobject]@{ value = $true } })
  $afterPolicy = Copy-Fixture $basePolicy
  $afterPolicy.Statement = @($afterPolicy.Statement) + @($exportGrant)
  $beforeJson = $basePolicy | ConvertTo-Json -Depth 30 -Compress
  $afterJson = $afterPolicy | ConvertTo-Json -Depth 30 -Compress
  $p.resource_changes += New-Change $rightsAddress "aws_iam_role_policy" -Before @{ name = "candidate-rights-activity-runtime"; role = "synthetic-role"; policy = $beforeJson } -After @{ name = "candidate-rights-activity-runtime"; role = "synthetic-role"; policy = $afterJson }
  $activity = Get-ChangeOf $p "aws_lambda_function.profile_readiness_activity"
  $activity.change.after.environment[0].variables | Add-Member NoteProperty RESTRICTED_ANSWER_EXPORT_ENABLED "enabled"
  $activity.change.after.environment[0].variables | Add-Member NoteProperty RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN $vaultArn
  $p.planned_values.root_module.resources = @(
    [pscustomobject]@{ address = "module.platform.aws_kms_key.restricted_answer_vault[0]"; values = [pscustomobject]@{ arn = $vaultArn } },
    [pscustomobject]@{ address = "module.platform.aws_iam_role.profile_readiness_activity[0]"; values = [pscustomobject]@{ id = "synthetic-role" } },
    [pscustomobject]@{ address = $rightsAddress; values = [pscustomobject]@{ policy = $afterJson } }
  )
  return $p
}
$exportPlan = New-ExportActivationPlan
$accepted = @(Assert-ExactCandidateRightsActivityPlan $exportPlan $artifact -EnableRestrictedAnswerExport)
if ($accepted.Count -ne ($script:CandidateRightsActivityChangeSet.Count + 1)) { throw "Export activation did not retain its complete change set." }; $passed++
Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $exportPlan $artifact } "Ordinary refresh accepted export activation."
foreach ($case in @(
  @{ Name = "disabled flag"; Mutate = { param($p) $p.variables.restricted_answer_export_enabled.value = $false } },
  @{ Name = "wrong runtime key"; Mutate = { param($p) (Get-ChangeOf $p "aws_lambda_function.profile_readiness_activity").change.after.environment[0].variables.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN = "other" } },
  @{ Name = "wrong runtime flag"; Mutate = { param($p) (Get-ChangeOf $p "aws_lambda_function.profile_readiness_activity").change.after.environment[0].variables.RESTRICTED_ANSWER_EXPORT_ENABLED = "true" } },
  @{ Name = "unrelated environment change"; Mutate = { param($p) (Get-ChangeOf $p "aws_lambda_function.profile_readiness_activity").change.after.environment[0].variables.NODE_ENV = "test" } },
  @{ Name = "unknown grant"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change.after_unknown | Add-Member NoteProperty policy $true } },
  @{ Name = "sensitive grant"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change.after_sensitive | Add-Member NoteProperty policy $true } },
  @{ Name = "role change"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change.after.role = "other" } },
  @{ Name = "policy replacement"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change.actions = @("delete", "create") } },
  @{ Name = "missing dedicated key"; Mutate = { param($p) $p.planned_values.root_module.resources = @($p.planned_values.root_module.resources | Where-Object { $_.address -notlike "*aws_kms_key*" }) } },
  @{ Name = "missing policy update"; Mutate = { param($p) $p.resource_changes = @($p.resource_changes | Where-Object { $_.address -cne $rightsAddress }) } }
  @{ Name = "duplicate policy update"; Mutate = { param($p) $p.resource_changes += Copy-Fixture (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity") } },
  @{ Name = "replacement path"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change | Add-Member NoteProperty replace_paths @(,@("policy")) } },
  @{ Name = "changed existing statement"; Mutate = { param($p) $g = Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity"; $j = $g.change.after.policy | ConvertFrom-Json; $j.Statement[0].Action = "s3:*"; $g.change.after.policy = $j | ConvertTo-Json -Depth 30 -Compress; $p.planned_values.root_module.resources[2].values.policy = $g.change.after.policy } },
  @{ Name = "source policy mismatch"; Mutate = { param($p) $p.planned_values.root_module.resources[2].values.policy = "{}" } },
  @{ Name = "additional policy attribute"; Mutate = { param($p) (Get-ChangeOf $p "aws_iam_role_policy.candidate_rights_activity").change.after | Add-Member NoteProperty unexpected "x" } }
)) {
  $bad = New-ExportActivationPlan; & $case.Mutate $bad
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact -EnableRestrictedAnswerExport } "Export activation accepted $($case.Name)."
}
foreach ($field in @("Action", "Resource", "Condition", "Effect", "Sid")) {
  $bad = New-ExportActivationPlan
  $change = Get-ChangeOf $bad "aws_iam_role_policy.candidate_rights_activity"
  $policy = $change.change.after.policy | ConvertFrom-Json
  $policy.Statement[1].$field = "widened"
  $change.change.after.policy = $policy | ConvertTo-Json -Depth 30 -Compress
  # Keep the source projection agreeing: policy semantics, not merely source equality, must refuse.
  $bad.planned_values.root_module.resources[2].values.policy = $change.change.after.policy
  Assert-Rejected { Assert-ExactCandidateRightsActivityPlan $bad $artifact -EnableRestrictedAnswerExport } "Export activation accepted widened $field."
}
$exportBaseline = Copy-Fixture $baselineVariables; $exportVariables = Copy-Fixture $plannedVariables
foreach ($v in @($exportBaseline, $exportVariables)) {
  $v | Add-Member NoteProperty restricted_answer_vault_enabled ([pscustomobject]@{ value = $true })
  $v | Add-Member NoteProperty restricted_answer_export_enabled ([pscustomobject]@{ value = $false })
}
$exportVariables.restricted_answer_export_enabled.value = $true
$null = Assert-CandidateRightsActivityVariables $exportBaseline $exportVariables $artifact -EnableRestrictedAnswerExport; $passed++
Assert-Rejected { Assert-CandidateRightsActivityVariables $exportBaseline $exportVariables $artifact } "Ordinary refresh accepted the activation flag."
$exportBaseline.restricted_answer_vault_enabled.value = $false
Assert-Rejected { Assert-CandidateRightsActivityVariables $exportBaseline $exportVariables $artifact -EnableRestrictedAnswerExport } "Export activation accepted a disabled vault."

Write-Host "Candidate-rights activity refresh guard tests passed: $passed assertions; generated fixtures only."
