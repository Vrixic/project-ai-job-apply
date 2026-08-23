Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-job-search-acceptance.ps1"
$guardPath = Join-Path $repositoryRoot "scripts\lib\deployment-operator-guards.ps1"
$source = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  $operatorPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -ne 0) {
  throw "The development job-search acceptance operator does not parse: $($parseErrors.Message -join '; ')."
}

function Assert-TestRejected {
  param(
    [Parameter(Mandatory)][scriptblock]$Operation,
    [Parameter(Mandatory)][string]$Description
  )
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw "$Description was accepted." }
}

function Import-OperatorFunction {
  param([Parameter(Mandatory)][string]$Name)
  $matches = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
      }, $true))
  if ($matches.Count -ne 1) { throw "Operator function $Name must be defined exactly once." }
  Invoke-Expression "function global:$Name $($matches[0].Body.Extent.Text)"
}

# Keep the public surface exact. In particular, callers cannot supply a command, SQL, an
# environment override, a search query, a gateway payload, or an arbitrary ECS container.
$expectedParameters = @(
  "Action", "AwsProfile", "Region", "ExpectedAccountId", "StateBucket", "SourceSha",
  "MigrationReceiptPath", "ReviewedMigrationReceiptSha256", "ExpectedGatewayArtifactSha256",
  "ExpectedGatewayVersion", "RunId", "ExecutionPlanPath", "ReviewedExecutionPlanSha256",
  "ReceiptPath", "ReviewedReceiptSha256", "Help"
)
$actualParameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
if (($actualParameters -join "|") -cne ($expectedParameters -join "|")) {
  throw "The acceptance operator public parameter surface changed."
}
foreach ($forbiddenParameter in @("Command", "Sql", "Query", "Payload", "Environment", "Container", "TaskDefinition")) {
  if ($actualParameters -contains $forbiddenParameter) {
    throw "The operator exposes forbidden caller-controlled $forbiddenParameter input."
  }
}

foreach ($requiredSource in @(
    '[ValidateSet("Status", "Plan", "Execute", "RecoverCleanup", "Verify")]',
    '$acceptanceCommand = @("jobs/dist/src/run-search-acceptance.js")',
    '$confirmation = "generated-synthetic-only"',
    '[ValidateSet("prepare", "mutate", "cleanup")]',
    'JOB_SEARCH_ACCEPTANCE_CONFIRM', 'JOB_SEARCH_ACCEPTANCE_ACTION',
    'JOB_SEARCH_ACCEPTANCE_RUN_ID', 'JOB_SEARCH_ACCEPTANCE_AT',
    '"s3api", "get-public-access-block"', 'Test-EcsFaultInjectionDisabled -TaskDefinition $task',
    '[string]$task.status -cne "ACTIVE"', 'Get-OptionalProperty $task "ipcMode"',
    'Get-OptionalProperty $task "pidMode"',
    'routeKey = "POST /v1/jobs/search"', 'rawPath = "/v1/jobs/search"',
    'scope = "jobs:read"', 'scopes = @("jobs:read")',
    'job_search_catalog_changed', 'application/problem+json',
    'PersistentFixtureRows = 0', 'PersistentCatalogRevisionChange = $true',
    'finally {', 'Submit-AcceptanceTask -Request $requestByPhase.cleanup',
    'if ($Action -ceq "RecoverCleanup")',
    'Submit-AcceptanceTask -Request $requestByPhase.cleanup'
  )) {
  if (-not $source.Contains($requiredSource)) {
    throw "The acceptance operator is missing required boundary text '$requiredSource'."
  }
}
foreach ($forbiddenSource in @("Invoke-Expression", "psql", "DROP TABLE", "DELETE FROM", "TRUNCATE ", "--command")) {
  if ($source.Contains($forbiddenSource)) {
    throw "The acceptance operator contains forbidden arbitrary-execution text '$forbiddenSource'."
  }
}
if ($source.Contains('PersistentApplicationWrites')) {
  throw "The acceptance operator makes the false claim that no application write persists."
}
if ($source -match '(?im)^\s*param\([^)]*\$(?:Command|Sql|Query|Payload|Environment|Container)\b') {
  throw "The operator accepts a caller-controlled execution or data payload."
}

# Missing mutation prerequisites must fail before caller identity, state, Lambda, ECS, or S3
# access. This makes malformed invocations safe to exercise in either supported shell.
$inputGuardOffset = $source.IndexOf('Assert-ActionInputs')
$externalAccessOffset = $source.IndexOf('$null = Assert-CallerAndSource')
if ($inputGuardOffset -lt 0 -or $externalAccessOffset -lt 0 -or $inputGuardOffset -gt $externalAccessOffset) {
  throw "Mutation-action required-input validation does not precede AWS and Git access."
}

$hostExecutable = (Get-Process -Id $PID).Path
function Invoke-OperatorFailure {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & $hostExecutable -NoProfile -File $operatorPath @Arguments 2>&1
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } finally { $ErrorActionPreference = $savedPreference }
}

foreach ($bindingCase in @(
    [pscustomobject]@{ Arguments = @("-Action", "DeleteEverything"); Pattern = "ValidateSet" },
    [pscustomobject]@{ Arguments = @("-Action", "Plan", "-Region", "us-west-2", "-ExpectedAccountId", "111122223333", "-StateBucket", "fixture-state"); Pattern = "restricted to us-east-2" },
    [pscustomobject]@{ Arguments = @("-Action", "Plan", "-ExpectedAccountId", "111122223333"); Pattern = "exact development account ID" },
    [pscustomobject]@{ Arguments = @("-Action", "Execute", "-ExpectedAccountId", "111122223333", "-StateBucket", "fixture-state"); Pattern = "requires the exact source, migration receipt pair" }
  )) {
  $result = Invoke-OperatorFailure -Arguments $bindingCase.Arguments
  if ($result.ExitCode -eq 0 -or $result.Output -notmatch $bindingCase.Pattern) {
    throw "An invalid operator invocation was not rejected at its local boundary. Output: $($result.Output)"
  }
}

. $guardPath
foreach ($functionName in @(
    "Get-OptionalProperty", "Test-OptionalCollectionEmpty", "Get-OptionalCollection", "Test-EcsFaultInjectionDisabled", "Get-FileSha256Base64", "ConvertFrom-AcceptanceJson", "Assert-ExactPropertySet", "Test-CanonicalUtcTimestamp",
    "New-AcceptanceEnvironment", "New-RunTaskRequest", "Assert-RunTaskRequest",
    "Assert-PlanFresh", "Assert-PlanTimestamps", "Read-ExecutionPlan", "New-AuthorizerClaims", "New-SearchEvent",
    "Assert-SearchPageResponse", "Assert-StaleCursorResponse", "Read-AcceptanceReceipt",
    "Assert-DurableClaimEvidence", "Read-StateSnapshot", "Assert-TaskDefinition"
  )) {
  Import-OperatorFunction -Name $functionName
}

$canonicalTimestamp = "2026-08-15T12:00:00.1234567Z"
$parsedTimestampFixture = ConvertFrom-AcceptanceJson `
  -Json "{`"createdAt`":`"$canonicalTimestamp`"}" -Description "Timestamp fixture"
if ($parsedTimestampFixture.createdAt -isnot [string] -or
  [string]$parsedTimestampFixture.createdAt -cne $canonicalTimestamp) {
  throw "Acceptance JSON parsing does not preserve reviewed timestamp text in this PowerShell host."
}
Assert-TestRejected -Description "invalid acceptance JSON" -Operation {
  $null = ConvertFrom-AcceptanceJson -Json "{" -Description "Invalid fixture"
}

$Region = "us-east-2"
$ExpectedAccountId = "111122223333"
$StateBucket = "fixture-development-state"
$SourceSha = "a" * 40
$ReviewedMigrationReceiptSha256 = "b" * 64
$ReviewedExecutionPlanSha256 = "c" * 64
$ExpectedGatewayArtifactSha256 = "d" * 64
$ExpectedGatewayVersion = 17
$stateKey = "platform.tfstate"
$containerName = "database-migration"
$migrationFamily = "ai-job-apply-development-database-migration"
$applicationLogGroup = "/ai-job-apply/development/application"
$acceptanceCommand = @("jobs/dist/src/run-search-acceptance.js")
$confirmation = "generated-synthetic-only"
$operatorRoot = Join-Path ([IO.Path]::GetTempPath()) "applydash-search-acceptance-tests-$PID-$([guid]::NewGuid().ToString('N'))"

$missingCollections = @(Get-OptionalCollection -Object ([pscustomobject]@{}) -Name "omitted")
$emptyCollections = @(Get-OptionalCollection -Object ([pscustomobject]@{ empty = @() }) -Name "empty")
$presentCollections = @(Get-OptionalCollection -Object ([pscustomobject]@{ present = @("one", "two") }) -Name "present")
if ($missingCollections.Count -ne 0 -or $emptyCollections.Count -ne 0 -or
  ($presentCollections -join "|") -cne "one|two") {
  throw "Optional AWS response collections are not normalized without inventing entries."
}

$runId = "12345678-1234-4abc-8def-1234567890ab"
$prepareAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$prepareTimestamp = [DateTime]::ParseExact(
  $prepareAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
).ToUniversalTime()
$mutateAt = $prepareTimestamp.AddSeconds(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$runtime = [pscustomobject]@{
  ClusterArn = "arn:aws:ecs:us-east-2:111122223333:cluster/fixture"
  TaskDefinitionArn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-database-migration:12"
  Subnets = @("subnet-111aaa", "subnet-222bbb")
  SecurityGroup = "sg-123abc"
  Image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:$('e' * 64)"
}

# The state bucket and one-off task definition retain the same fail-closed controls as the
# migration operator they reuse. Exercise the public-access and ECS task-definition parity here.
$script:statePublicAccessTamper = ""
$script:taskTamper = ""
$script:testStateKmsKey = "arn:aws:kms:us-east-2:111122223333:key/11111111-2222-3333-4444-555555555555"
function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Operation)
  $operationKey = $Arguments[0..1] -join " "
  switch ($operationKey) {
    "s3api get-bucket-versioning" { return [pscustomobject]@{ Status = "Enabled" } }
    "s3api get-public-access-block" {
      return [pscustomobject]@{ PublicAccessBlockConfiguration = [pscustomobject]@{
          BlockPublicAcls = if ($script:statePublicAccessTamper -ceq "false") { $false } elseif ($script:statePublicAccessTamper -ceq "string") { "false" } else { $true }
          IgnorePublicAcls = $true
          BlockPublicPolicy = $true
          RestrictPublicBuckets = $true
        } }
    }
    "s3api get-bucket-encryption" {
      return [pscustomobject]@{ ServerSideEncryptionConfiguration = [pscustomobject]@{
          Rules = @([pscustomobject]@{
              BucketKeyEnabled = $true
              ApplyServerSideEncryptionByDefault = [pscustomobject]@{
                SSEAlgorithm = "aws:kms"; KMSMasterKeyID = $script:testStateKmsKey
              }
            })
        } }
    }
    "s3api head-object" {
      return [pscustomobject]@{
        ServerSideEncryption = "aws:kms"; SSEKMSKeyId = $script:testStateKmsKey
        BucketKeyEnabled = $true; VersionId = "state-version"
      }
    }
    "s3api get-object" {
      $outputPath = [string]$Arguments[-1]
      [IO.File]::WriteAllText(
        $outputPath,
        '{"lineage":"11111111-2222-3333-4444-555555555555","serial":108,"terraform_version":"1.9.8","outputs":{}}',
        (New-Object Text.UTF8Encoding($false))
      )
      return [pscustomobject]@{ VersionId = "state-version" }
    }
    "ecs describe-task-definition" {
      $task = [pscustomobject]@{
        taskDefinitionArn = $runtime.TaskDefinitionArn
        status = "ACTIVE"
        family = $migrationFamily
        enableFaultInjection = $false
        networkMode = "awsvpc"
        cpu = "256"
        memory = "512"
        requiresCompatibilities = @("FARGATE")
        runtimePlatform = [pscustomobject]@{ cpuArchitecture = "X86_64"; operatingSystemFamily = "LINUX" }
        taskRoleArn = $null
        ipcMode = $null
        pidMode = $null
        volumes = @()
        containerDefinitions = @([pscustomobject]@{
            name = $containerName
            image = $runtime.Image
            essential = $true
            readonlyRootFilesystem = $true
            command = @("runner/dist/src/main.js")
            environment = @([pscustomobject]@{ name = "NODE_ENV"; value = "production" })
            secrets = @([pscustomobject]@{
                name = "DATABASE_URL"
                valueFrom = "arn:aws:secretsmanager:us-east-2:111122223333:secret:database"
              })
            logConfiguration = [pscustomobject]@{
              logDriver = "awslogs"
              options = [pscustomobject]@{
                "awslogs-group" = $applicationLogGroup
                "awslogs-region" = $Region
                "awslogs-stream-prefix" = "database-migration"
              }
            }
            portMappings = @(); mountPoints = @(); volumesFrom = @(); systemControls = @(); resourceRequirements = @()
          })
      }
      switch ($script:taskTamper) {
        "status" { $task.status = "INACTIVE" }
        "fault-true" { $task.enableFaultInjection = $true }
        "fault-string" { $task.enableFaultInjection = "false" }
        "ipc" { $task.ipcMode = "host" }
        "pid" { $task.pidMode = "task" }
        "omit-empty-container-collections" {
          foreach ($propertyName in @("portMappings", "mountPoints", "volumesFrom", "systemControls", "resourceRequirements")) {
            $task.containerDefinitions[0].PSObject.Properties.Remove($propertyName)
          }
        }
      }
      return [pscustomobject]@{ taskDefinition = $task }
    }
    default { throw "Unexpected state/task AWS fixture call '$($Arguments -join ' ')' for $Operation." }
  }
}

$stateEvidence = Read-StateSnapshot
if ([string]$stateEvidence.VersionId -cne "state-version" -or [long]$stateEvidence.Serial -ne 108) {
  throw "The exact private encrypted state fixture was not accepted."
}
foreach ($publicAccessTamper in @("false", "string")) {
  $script:statePublicAccessTamper = $publicAccessTamper
  Assert-TestRejected -Description "state bucket public-access tampering '$publicAccessTamper'" -Operation {
    $null = Read-StateSnapshot
  }
}
$script:statePublicAccessTamper = ""

if (-not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{})) -or
  -not (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{ enableFaultInjection = $false })) -or
  (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{ enableFaultInjection = $true })) -or
  (Test-EcsFaultInjectionDisabled -TaskDefinition ([pscustomobject]@{ enableFaultInjection = "false" }))) {
  throw "The task fault-injection type boundary is not fail closed."
}
$null = Assert-TaskDefinition -TaskDefinitionArn $runtime.TaskDefinitionArn -ExpectedImage $runtime.Image
$script:taskTamper = "omit-empty-container-collections"
$null = Assert-TaskDefinition -TaskDefinitionArn $runtime.TaskDefinitionArn -ExpectedImage $runtime.Image
foreach ($taskTamper in @("status", "fault-true", "fault-string", "ipc", "pid")) {
  $script:taskTamper = $taskTamper
  Assert-TestRejected -Description "task-definition parity tampering '$taskTamper'" -Operation {
    $null = Assert-TaskDefinition -TaskDefinitionArn $runtime.TaskDefinitionArn -ExpectedImage $runtime.Image
  }
}
$script:taskTamper = ""

$prepareEnvironment = @(New-AcceptanceEnvironment -Phase "prepare" -PlanRunId $runId -At $prepareAt)
if ($prepareEnvironment.Count -ne 4 -or
  (@($prepareEnvironment | ForEach-Object { "$(($_.name))=$(($_.value))" }) -join "|") -cne
  "JOB_SEARCH_ACCEPTANCE_CONFIRM=generated-synthetic-only|JOB_SEARCH_ACCEPTANCE_ACTION=prepare|JOB_SEARCH_ACCEPTANCE_RUN_ID=$runId|JOB_SEARCH_ACCEPTANCE_AT=$prepareAt") {
  throw "Prepare does not produce the exact fixed acceptance environment."
}
$mutateEnvironment = @(New-AcceptanceEnvironment -Phase "mutate" -PlanRunId $runId -At $mutateAt)
if ($mutateEnvironment.Count -ne 4 -or
  (@($mutateEnvironment | ForEach-Object { "$(($_.name))=$(($_.value))" }) -join "|") -cne
  "JOB_SEARCH_ACCEPTANCE_CONFIRM=generated-synthetic-only|JOB_SEARCH_ACCEPTANCE_ACTION=mutate|JOB_SEARCH_ACCEPTANCE_RUN_ID=$runId|JOB_SEARCH_ACCEPTANCE_AT=$mutateAt") {
  throw "Mutate does not produce its exact later acceptance environment."
}
$cleanupEnvironment = @(New-AcceptanceEnvironment -Phase "cleanup" -PlanRunId $runId -At $prepareAt)
if ($cleanupEnvironment.Count -ne 3 -or @($cleanupEnvironment | Where-Object name -ceq "JOB_SEARCH_ACCEPTANCE_AT").Count -ne 0) {
  throw "Cleanup unexpectedly receives a caller timestamp."
}

foreach ($phase in @("prepare", "mutate", "cleanup")) {
  $phaseAt = if ($phase -ceq "mutate") { $mutateAt } else { $prepareAt }
  $request = New-RunTaskRequest -Runtime $runtime -Phase $phase -PlanRunId $runId -At $phaseAt `
    -ClientToken "d1-search-$phase-$('f' * 32)" -StartedBy "d1-search-$($SourceSha.Substring(0, 12))"
  $null = Assert-RunTaskRequest -Request $request -Runtime $runtime -Phase $phase -PlanRunId $runId -At $phaseAt
  $override = @($request.overrides.containerOverrides)[0]
  if ((@($override.command) -join "|") -cne "jobs/dist/src/run-search-acceptance.js") {
    throw "$phase did not retain the one fixed Jobs-owned command."
  }

  foreach ($tamper in @("command", "container", "cluster", "security-group", "public-ip", "environment", "token", "top-level-extra", "network-extra", "override-extra", "container-extra")) {
    $candidate = $request | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    switch ($tamper) {
      "command" { $candidate.overrides.containerOverrides[0].command = @("runner/dist/src/main.js") }
      "container" { $candidate.overrides.containerOverrides[0].name = "other" }
      "cluster" { $candidate.cluster += "-other" }
      "security-group" { $candidate.networkConfiguration.awsvpcConfiguration.securityGroups = @("sg-other") }
      "public-ip" { $candidate.networkConfiguration.awsvpcConfiguration.assignPublicIp = "DISABLED" }
      "environment" { $candidate.overrides.containerOverrides[0].environment[0].value = "not-confirmed" }
      "token" { $candidate.clientToken = "caller-token" }
      "top-level-extra" { $candidate | Add-Member NoteProperty tags @([pscustomobject]@{ key = "x"; value = "y" }) }
      "network-extra" { $candidate.networkConfiguration | Add-Member NoteProperty extra "unexpected" }
      "override-extra" { $candidate.overrides | Add-Member NoteProperty inferenceAcceleratorOverrides @() }
      "container-extra" { $candidate.overrides.containerOverrides[0] | Add-Member NoteProperty resourceRequirements @([pscustomobject]@{ type = "GPU"; value = "1" }) }
    }
    Assert-TestRejected -Description "$phase request tampering '$tamper'" -Operation {
      $null = Assert-RunTaskRequest -Request $candidate -Runtime $runtime -Phase $phase -PlanRunId $runId -At $phaseAt
    }
  }
}

$null = Assert-PlanFresh -At $prepareAt -RequireFresh
$null = Assert-PlanFresh -At $mutateAt -RequireFresh
$null = Assert-PlanTimestamps -PrepareAt $prepareAt -MutateAt $mutateAt -RequireFresh
foreach ($badTimestamp in @(
    "2026-08-15T12:00:00Z",
    "2026-08-15T12:00:00.000+00:00"
  )) {
  Assert-TestRejected -Description "non-fresh plan timestamp '$badTimestamp'" -Operation {
    Assert-PlanFresh -At $badTimestamp
  }
}
$agedAt = [DateTime]::UtcNow.AddHours(-2).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$null = Assert-PlanFresh -At $agedAt
Assert-TestRejected -Description "aged Execute plan timestamp" -Operation {
  Assert-PlanFresh -At $agedAt -RequireFresh
}
$agedMutateAt = [DateTime]::ParseExact(
  $agedAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::AssumeUniversal
).ToUniversalTime().AddSeconds(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
Assert-TestRejected -Description "aged ordered Execute timestamps" -Operation {
  Assert-PlanTimestamps -PrepareAt $agedAt -MutateAt $agedMutateAt -RequireFresh
}
foreach ($orderingCase in @(
    [pscustomobject]@{ Description = "equal"; MutateAt = $prepareAt },
    [pscustomobject]@{ Description = "before"; MutateAt = $prepareTimestamp.AddSeconds(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") },
    [pscustomobject]@{ Description = "two-seconds-after"; MutateAt = $prepareTimestamp.AddSeconds(2).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
  )) {
  Assert-TestRejected -Description "$($orderingCase.Description) prepare/mutate timestamp ordering" -Operation {
    Assert-PlanTimestamps -PrepareAt $prepareAt -MutateAt $orderingCase.MutateAt -RequireFresh
  }
}

$gateway = [pscustomobject]@{
  FunctionName = "ai-job-apply-development-gateway"; AliasName = "development"; Version = "17"
  ArtifactSha256 = $ExpectedGatewayArtifactSha256; CodeSha256 = ("A" * 43) + "="
  Issuer = "https://issuer.example.test/"; Audience = "applydash-development"
}
$requestBody = [ordered]@{ query = "d1search$($runId.Replace('-', ''))"; sort = "freshness"; pageSize = 1 }
$event = New-SearchEvent -Gateway $gateway -RequestId "d1-search-fixture-123456789abc" -Body ($requestBody | ConvertTo-Json -Compress)
if ([string]$event.version -cne "2.0" -or [string]$event.routeKey -cne "POST /v1/jobs/search" -or
  [string]$event.rawPath -cne "/v1/jobs/search" -or [string]$event.requestContext.http.method -cne "POST" -or
  [string]$event.requestContext.authorizer.jwt.claims.sub -cne "synthetic-job-search-acceptance" -or
  [string]$event.requestContext.authorizer.jwt.claims.scope -cne "jobs:read" -or
  (@($event.requestContext.authorizer.jwt.scopes) -join "|") -cne "jobs:read" -or $event.isBase64Encoded) {
  throw "The synthetic API Gateway v2 request does not preserve the exact validated jobs:read boundary."
}
$decodedBody = [string]$event.body | ConvertFrom-Json
if ([string]$decodedBody.query -cne [string]$requestBody.query -or [int]$decodedBody.pageSize -ne 1) {
  throw "The synthetic gateway event changed the fixed search body."
}
foreach ($missingIdentity in @("Issuer", "Audience")) {
  $candidateGateway = $gateway | Select-Object *
  $candidateGateway.$missingIdentity = ""
  Assert-TestRejected -Description "gateway without $missingIdentity" -Operation {
    $null = New-AuthorizerClaims -Gateway $candidateGateway
  }
}

$jobOne = "018f1234-5678-7abc-8def-1234567890ab"
$jobTwo = "018f1234-5678-7abc-9def-1234567890ac"
function New-SearchResponseFixture {
  param([object[]]$Items, [AllowNull()][string]$Cursor = $null)
  $page = [ordered]@{ items = @($Items) }
  if ($null -ne $Cursor) { $page.nextCursor = $Cursor }
  return [pscustomobject]@{
    statusCode = 200
    headers = [pscustomobject]@{ "cache-control" = "no-store"; "content-type" = "application/json; charset=utf-8" }
    body = ($page | ConvertTo-Json -Depth 10 -Compress)
  }
}
$activeOne = [pscustomobject]@{ id = $jobOne; status = "active" }
$activeTwo = [pscustomobject]@{ id = $jobTwo; status = "active" }
$cursor = "$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('cursor')).TrimEnd('=').Replace('+','-').Replace('/','_')).signature"
$pageResult = Assert-SearchPageResponse -Response (New-SearchResponseFixture -Items @($activeOne) -Cursor $cursor) -ExpectedCount 1 -RequireCursor
if ($pageResult.Ids.Count -ne 1 -or [string]$pageResult.Ids[0] -cne $jobOne -or [string]$pageResult.Cursor -cne $cursor) {
  throw "The accepted first page did not return its exact job identity and cursor."
}
$terminalResult = Assert-SearchPageResponse -Response (New-SearchResponseFixture -Items @($activeOne, $activeTwo)) -ExpectedCount 2 -ForbidCursor
if (($terminalResult.Ids -join "|") -cne "$jobOne|$jobTwo") { throw "The terminal page changed result ordering." }
$null = Assert-SearchPageResponse -Response (New-SearchResponseFixture -Items @()) -ExpectedCount 0 -ForbidCursor

foreach ($pageTamper in @("status", "cache", "content", "body", "root-shape", "count", "id-version", "status-value", "cursor-missing", "cursor-malformed", "cursor-long", "cursor-terminal")) {
  $candidate = New-SearchResponseFixture -Items @($activeOne) -Cursor $cursor
  switch ($pageTamper) {
    "status" { $candidate.statusCode = 201 }
    "cache" { $candidate.headers.'cache-control' = "private" }
    "content" { $candidate.headers.'content-type' = "text/plain" }
    "body" { $candidate.body = "{" }
    "root-shape" { $candidate.body = ([ordered]@{ items = @($activeOne); total = 1 } | ConvertTo-Json -Compress) }
    "count" { $candidate.body = ([ordered]@{ items = @() } | ConvertTo-Json -Compress) }
    "id-version" { $candidate.body = ([ordered]@{ items = @([pscustomobject]@{ id = $runId; status = "active" }) } | ConvertTo-Json -Compress) }
    "status-value" { $candidate.body = ([ordered]@{ items = @([pscustomobject]@{ id = $jobOne; status = "expired" }) } | ConvertTo-Json -Compress) }
    "cursor-missing" { $candidate = New-SearchResponseFixture -Items @($activeOne) }
    "cursor-malformed" { $candidate.body = ([ordered]@{ items = @($activeOne); nextCursor = "not-a-token" } | ConvertTo-Json -Compress) }
    "cursor-long" { $candidate.body = ([ordered]@{ items = @($activeOne); nextCursor = "$(('a' * 1023)).b" } | ConvertTo-Json -Compress) }
    "cursor-terminal" { }
  }
  $arguments = @{ Response = $candidate; ExpectedCount = 1 }
  if ($pageTamper -ceq "cursor-terminal") { $arguments.ForbidCursor = $true } else { $arguments.RequireCursor = $true }
  Assert-TestRejected -Description "search-page tampering '$pageTamper'" -Operation {
    $null = Assert-SearchPageResponse @arguments
  }
}

function New-StaleResponseFixture {
  return [pscustomobject]@{
    statusCode = 409
    headers = [pscustomobject]@{
      "cache-control" = "no-store"
      "content-type" = "application/problem+json; charset=utf-8"
      "x-correlation-id" = "trace-fixture"
    }
    body = ([ordered]@{
        type = "urn:ai-job-apply:problem:job_search_catalog_changed"
        title = "Job catalog changed"
        status = 409
        code = "job_search_catalog_changed"
        traceId = "trace-fixture"
        detail = "The job catalog changed; restart the search from the first page"
      } | ConvertTo-Json -Compress)
  }
}
$null = Assert-StaleCursorResponse -Response (New-StaleResponseFixture)
$withoutDetail = New-StaleResponseFixture
$withoutDetailBody = $withoutDetail.body | ConvertFrom-Json
$withoutDetailBody.PSObject.Properties.Remove("detail")
$withoutDetail.body = $withoutDetailBody | ConvertTo-Json -Compress
$null = Assert-StaleCursorResponse -Response $withoutDetail
foreach ($problemTamper in @(
    "status", "cache", "content", "body", "missing", "extra", "type", "title", "body-status",
    "code", "trace", "trace-type", "detail", "detail-type", "header-missing", "header"
  )) {
  $candidate = New-StaleResponseFixture
  switch ($problemTamper) {
    "status" { $candidate.statusCode = 400 }
    "cache" { $candidate.headers.'cache-control' = "private" }
    "content" { $candidate.headers.'content-type' = "application/json" }
    "body" { $candidate.body = "{" }
    "header-missing" { $candidate.headers.PSObject.Properties.Remove("x-correlation-id") }
    "header" { $candidate.headers.'x-correlation-id' = "different-trace" }
    default {
      $problem = $candidate.body | ConvertFrom-Json
      switch ($problemTamper) {
        "missing" { $problem.PSObject.Properties.Remove("code") }
        "extra" { $problem | Add-Member NoteProperty instance "/v1/jobs/search" }
        "type" { $problem.type = "about:blank" }
        "title" { $problem.title = "Conflict" }
        "body-status" { $problem.status = 400 }
        "code" { $problem.code = "conflict" }
        "trace" { $problem.traceId = "" }
        "trace-type" { $problem.traceId = 409 }
        "detail" { $problem.detail = "restart later" }
        "detail-type" { $problem.detail = 409 }
      }
      $candidate.body = $problem | ConvertTo-Json -Compress
    }
  }
  Assert-TestRejected -Description "stale-cursor tampering '$problemTamper'" -Operation {
    $null = Assert-StaleCursorResponse -Response $candidate
  }
}

# Exercise the complete reviewed-plan boundary without contacting AWS. Nested exact-property checks
# are intentional: a reviewed descriptor must not be able to smuggle additional ECS API fields.
$snapshot = [pscustomobject]@{ Lineage = "11111111-2222-3333-4444-555555555555"; Serial = 108; VersionId = "state-version" }
$migrationReceipt = [pscustomobject]@{ Path = "C:\fixture\migration-receipt.json"; ImageUri = $runtime.Image }
$script:testPlanPath = Join-Path $operatorRoot "fixture-plan.json"
$script:testPlanHash = "c" * 64
function Resolve-PathBelowRoot {
  param([string]$Candidate, [string]$AllowedRoot, [switch]$MustExist)
  return $script:testPlanPath
}
function Get-FileSha256 { param([string]$Path) return $script:testPlanHash }
function Get-ExactRuntime { param([object]$Snapshot, [string]$ExpectedImage) return $runtime }
$null = New-Item -ItemType Directory -Path $operatorRoot -Force

function New-PlanFixture {
  $requests = @()
  foreach ($phase in @("prepare", "mutate", "cleanup")) {
    $phaseAt = if ($phase -ceq "mutate") { $mutateAt } else { $prepareAt }
    $request = New-RunTaskRequest -Runtime $runtime -Phase $phase -PlanRunId $runId -At $phaseAt `
      -ClientToken "d1-search-$phase-$('f' * 32)" -StartedBy "d1-search-$($SourceSha.Substring(0, 12))"
    $requests += [ordered]@{ phase = $phase; request = $request }
  }
  return [ordered]@{
    schemaVersion = 1; kind = "development-job-search-stale-cursor-acceptance"; environment = "development"
    region = $Region; accountId = $ExpectedAccountId; stateBucket = $StateBucket; stateKey = $stateKey
    stateLineage = $snapshot.Lineage; stateSerial = $snapshot.Serial; stateVersionId = $snapshot.VersionId
    sourceSha = $SourceSha; migrationReceiptPath = $migrationReceipt.Path
    migrationReceiptSha256 = $ReviewedMigrationReceiptSha256; migrationImage = $migrationReceipt.ImageUri
    gateway = [ordered]@{ functionName = $gateway.FunctionName; aliasName = $gateway.AliasName; version = $gateway.Version; artifactSha256 = $gateway.ArtifactSha256; codeSha256 = $gateway.CodeSha256 }
    runId = $runId; prepareAt = $prepareAt; mutateAt = $mutateAt; createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    runtime = [ordered]@{ clusterArn = $runtime.ClusterArn; taskDefinitionArn = $runtime.TaskDefinitionArn; subnets = @($runtime.Subnets); securityGroup = $runtime.SecurityGroup }
    requests = $requests
  }
}
function Write-TestPlan([object]$Value) {
  [IO.File]::WriteAllText($script:testPlanPath, ($Value | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
}

$positivePlan = New-PlanFixture
Write-TestPlan $positivePlan
$planEvidence = Read-ExecutionPlan -Path $script:testPlanPath -Sha256 $script:testPlanHash -Snapshot $snapshot -Receipt $migrationReceipt -Gateway $gateway -RequireFresh
if ([string]$planEvidence.Plan.runId -cne $runId -or
  [string]$planEvidence.Plan.prepareAt -cne $prepareAt -or
  [string]$planEvidence.Plan.mutateAt -cne $mutateAt -or
  @($planEvidence.Plan.requests).Count -ne 3) {
  throw "The exact positive reviewed execution plan was not accepted."
}

foreach ($planTamper in @(
    "checksum", "root-extra", "source", "state", "receipt", "gateway", "gateway-extra", "runtime", "runtime-extra",
    "phase-order", "request-command", "request-network-extra", "request-container-extra", "prepare-time-format",
    "mutate-time-format", "mutate-time-equal", "mutate-time-before", "mutate-time-two-seconds", "prepare-environment-time",
    "mutate-environment-time", "cleanup-environment-time", "stale"
  )) {
  $candidate = ConvertFrom-AcceptanceJson `
    -Json ((New-PlanFixture) | ConvertTo-Json -Depth 30) -Description "Candidate acceptance plan"
  $script:testPlanHash = "c" * 64
  switch ($planTamper) {
    "checksum" { $script:testPlanHash = "0" * 64 }
    "root-extra" { $candidate | Add-Member NoteProperty sql "select 1" }
    "source" { $candidate.sourceSha = "0" * 40 }
    "state" { $candidate.stateSerial = 109 }
    "receipt" { $candidate.migrationReceiptSha256 = "0" * 64 }
    "gateway" { $candidate.gateway.version = "18" }
    "gateway-extra" { $candidate.gateway | Add-Member NoteProperty qualifier "caller-controlled" }
    "runtime" { $candidate.runtime.securityGroup = "sg-other" }
    "runtime-extra" { $candidate.runtime | Add-Member NoteProperty assignPublicIp "DISABLED" }
    "phase-order" { $candidate.requests = @($candidate.requests[1], $candidate.requests[0], $candidate.requests[2]) }
    "request-command" { $candidate.requests[0].request.overrides.containerOverrides[0].command = @("runner/dist/src/main.js") }
    "request-network-extra" { $candidate.requests[0].request.networkConfiguration | Add-Member NoteProperty extra "unexpected" }
    "request-container-extra" { $candidate.requests[0].request.overrides.containerOverrides[0] | Add-Member NoteProperty cpu 2048 }
    "prepare-time-format" { $candidate.prepareAt = ([string]$candidate.prepareAt).Replace("Z", "+00:00") }
    "mutate-time-format" { $candidate.mutateAt = ([string]$candidate.mutateAt).Replace("Z", "+00:00") }
    "mutate-time-equal" { $candidate.mutateAt = $candidate.prepareAt }
    "mutate-time-before" { $candidate.mutateAt = $prepareTimestamp.AddSeconds(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
    "mutate-time-two-seconds" { $candidate.mutateAt = $prepareTimestamp.AddSeconds(2).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
    "prepare-environment-time" {
      @($candidate.requests[0].request.overrides.containerOverrides[0].environment | Where-Object {
          [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
        })[0].value = $candidate.mutateAt
    }
    "mutate-environment-time" {
      @($candidate.requests[1].request.overrides.containerOverrides[0].environment | Where-Object {
          [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
        })[0].value = $candidate.prepareAt
    }
    "cleanup-environment-time" {
      $candidate.requests[2].request.overrides.containerOverrides[0].environment += [pscustomobject]@{
        name = "JOB_SEARCH_ACCEPTANCE_AT"; value = $candidate.prepareAt
      }
    }
    "stale" {
      $candidate.prepareAt = [DateTime]::UtcNow.AddMinutes(-16).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
      $candidate.mutateAt = [DateTime]::ParseExact(
        $candidate.prepareAt, "yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal
      ).ToUniversalTime().AddSeconds(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
      @($candidate.requests[0].request.overrides.containerOverrides[0].environment | Where-Object {
          [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
        })[0].value = $candidate.prepareAt
      @($candidate.requests[1].request.overrides.containerOverrides[0].environment | Where-Object {
          [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
        })[0].value = $candidate.mutateAt
    }
  }
  Write-TestPlan $candidate
  Assert-TestRejected -Description "reviewed plan tampering '$planTamper'" -Operation {
    $null = Read-ExecutionPlan -Path $script:testPlanPath -Sha256 ("c" * 64) -Snapshot $snapshot -Receipt $migrationReceipt -Gateway $gateway -RequireFresh
  }
}
$script:testPlanHash = "c" * 64

$agedPlan = New-PlanFixture
$agedPlan.prepareAt = $agedAt
$agedPlan.mutateAt = $agedMutateAt
@($agedPlan.requests[0].request.overrides.containerOverrides[0].environment | Where-Object {
    [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
  })[0].value = $agedPlan.prepareAt
@($agedPlan.requests[1].request.overrides.containerOverrides[0].environment | Where-Object {
    [string]$_.name -ceq "JOB_SEARCH_ACCEPTANCE_AT"
  })[0].value = $agedPlan.mutateAt
Write-TestPlan $agedPlan
$null = Read-ExecutionPlan -Path $script:testPlanPath -Sha256 $script:testPlanHash -Snapshot $snapshot -Receipt $migrationReceipt -Gateway $gateway
Assert-TestRejected -Description "aged reviewed plan in Execute mode" -Operation {
  $null = Read-ExecutionPlan -Path $script:testPlanPath -Sha256 $script:testPlanHash -Snapshot $snapshot -Receipt $migrationReceipt -Gateway $gateway -RequireFresh
}
if (-not $source.Contains('-RequireFresh:($Action -ceq "Execute")')) {
  throw "Execute is not the sole plan consumer that enforces the 15-minute submission window."
}

# Receipts are recovery authority, so their complete shape and every plan/source binding must be
# authenticated before RecoverCleanup can reach task submission.
$receiptFixture = [ordered]@{
  schemaVersion = 1; kind = "development-job-search-stale-cursor-acceptance"; environment = "development"
  sourceSha = $SourceSha; executionPlanSha256 = $ReviewedExecutionPlanSha256
  migrationReceiptSha256 = $ReviewedMigrationReceiptSha256; gatewayArtifactSha256 = $ExpectedGatewayArtifactSha256
  gatewayVersion = $ExpectedGatewayVersion; runId = $runId; phase = "cleanup-required"
  claimKey = "operator-claims/development-job-search-acceptance/$ReviewedExecutionPlanSha256.json"
  claimVersionId = "claim-version"; claimChecksumSHA256 = ("A" * 43) + "="
  prepareTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('1' * 32)"
  mutateTaskArn = ""; cleanupTaskArn = ""; queryTokenSha256 = ""; baselineJobSetSha256 = ""
  restartJobSetSha256 = ""; staleCursorRejected = $false; postCleanupCount = -1
  startedAt = [DateTimeOffset]::UtcNow.ToString("o"); completedAt = ""
}
$planEvidence = [pscustomobject]@{ Plan = [pscustomobject]@{ runId = $runId }; Runtime = $runtime }
Write-TestPlan $receiptFixture
$receiptEvidence = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
if ([string]$receiptEvidence.Receipt.phase -cne "cleanup-required") { throw "The bound recovery receipt was not accepted." }
foreach ($receiptTamper in @("checksum", "extra", "source", "plan", "image", "gateway", "run", "phase")) {
  $candidate = $receiptFixture | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $script:testPlanHash = "c" * 64
  switch ($receiptTamper) {
    "checksum" { $script:testPlanHash = "0" * 64 }
    "extra" { $candidate | Add-Member NoteProperty cleanupCommand "caller-controlled" }
    "source" { $candidate.sourceSha = "0" * 40 }
    "plan" { $candidate.executionPlanSha256 = "0" * 64 }
    "image" { $candidate.migrationReceiptSha256 = "0" * 64 }
    "gateway" { $candidate.gatewayVersion = 18 }
    "run" { $candidate.runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    "phase" { $candidate.phase = "unknown" }
  }
  Write-TestPlan $candidate
  Assert-TestRejected -Description "acceptance receipt tampering '$receiptTamper'" -Operation {
    $null = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 ("c" * 64) -PlanEvidence $planEvidence
  }
}

$claimingReceipt = ConvertFrom-AcceptanceJson -Json ($receiptFixture | ConvertTo-Json -Depth 20) -Description "Claiming receipt fixture"
$claimingReceipt.phase = "claiming"
$claimingReceipt.claimKey = ""
$claimingReceipt.claimVersionId = ""
$claimingReceipt.claimChecksumSHA256 = ""
$claimingReceipt.prepareTaskArn = ""
$claimingReceipt.mutateTaskArn = ""
$claimingReceipt.cleanupTaskArn = ""
$claimingReceipt.queryTokenSha256 = ""
$claimingReceipt.baselineJobSetSha256 = ""
$claimingReceipt.restartJobSetSha256 = ""
$claimingReceipt.staleCursorRejected = $false
$claimingReceipt.postCleanupCount = -1
$claimingReceipt.completedAt = ""
Write-TestPlan $claimingReceipt
$claimingEvidence = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
if ([string]$claimingEvidence.Receipt.phase -cne "claiming") {
  throw "The exact plan-bound preclaim receipt was not authenticated for human diagnosis."
}
foreach ($claimingTamper in @("phase", "claim-key", "claim-version", "claim-checksum", "prepare-task", "query-hash", "stale", "count", "completed")) {
  $candidate = ConvertFrom-AcceptanceJson -Json ($claimingReceipt | ConvertTo-Json -Depth 20) -Description "Candidate claiming receipt"
  switch ($claimingTamper) {
    "phase" { $candidate.phase = "preclaim" }
    "claim-key" { $candidate.claimKey = "operator-claims/uncommitted" }
    "claim-version" { $candidate.claimVersionId = "uncommitted-version" }
    "claim-checksum" { $candidate.claimChecksumSHA256 = ("A" * 43) + "=" }
    "prepare-task" { $candidate.prepareTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('3' * 32)" }
    "query-hash" { $candidate.queryTokenSha256 = "3" * 64 }
    "stale" { $candidate.staleCursorRejected = $true }
    "count" { $candidate.postCleanupCount = 0 }
    "completed" { $candidate.completedAt = [DateTimeOffset]::UtcNow.ToString("o") }
  }
  Write-TestPlan $candidate
  Assert-TestRejected -Description "claiming receipt tampering '$claimingTamper'" -Operation {
    $null = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
  }
}

$executeOffset = $source.IndexOf('if ($Action -ceq "Execute")')
$receiptPathOffset = $source.IndexOf('$ReceiptPath = Join-Path $operatorRoot', $executeOffset)
$claimingPhaseOffset = $source.IndexOf('phase = "claiming"', $receiptPathOffset)
$initialReceiptWriteOffset = $source.IndexOf('Write-JsonFile -Path $resolvedReceipt -Value $receipt', $claimingPhaseOffset)
$durableClaimOffset = $source.IndexOf('$claim = New-DurableClaim -PlanEvidence $planEvidence', $initialReceiptWriteOffset)
$claimedPhaseOffset = $source.IndexOf('$receipt.phase = "claimed"', $durableClaimOffset)
$claimedReceiptWriteOffset = $source.IndexOf('Write-JsonFile -Path $resolvedReceipt -Value $receipt -AllowReplace', $claimedPhaseOffset)
$firstTaskSubmitOffset = $source.IndexOf('Submit-AcceptanceTask -Request $requestByPhase.prepare', $claimedReceiptWriteOffset)
if ($executeOffset -lt 0 -or $receiptPathOffset -lt $executeOffset -or $claimingPhaseOffset -lt $receiptPathOffset -or
  $initialReceiptWriteOffset -lt $claimingPhaseOffset -or $durableClaimOffset -lt $initialReceiptWriteOffset -or
  $claimedPhaseOffset -lt $durableClaimOffset -or $claimedReceiptWriteOffset -lt $claimedPhaseOffset -or
  $firstTaskSubmitOffset -lt $claimedReceiptWriteOffset) {
  throw "Execute does not persist exclusive claiming evidence, bind the durable claim, and persist claimed evidence before ECS submission."
}
$initialReceiptWriteLine = $source.Substring(
  $initialReceiptWriteOffset,
  $source.IndexOf("`n", $initialReceiptWriteOffset) - $initialReceiptWriteOffset
)
if ($initialReceiptWriteLine.Contains("-AllowReplace")) {
  throw "Execute can replace another run's exclusive preclaim receipt."
}
$receiptPathLine = $source.Substring(
  $receiptPathOffset,
  $source.IndexOf("`n", $receiptPathOffset) - $receiptPathOffset
)
if (-not $receiptPathLine.Contains('$ReviewedExecutionPlanSha256') -or $receiptPathLine.Contains('Get-Date')) {
  throw "The exclusive claiming receipt path is not deterministic and bound to the reviewed execution plan."
}

$receiptReadOffset = $source.IndexOf('$receiptEvidence = Read-AcceptanceReceipt')
$claimingActionGuardOffset = $source.IndexOf('if ([string]$acceptanceReceipt.phase -ceq "claiming")', $receiptReadOffset)
$claimEvidenceOffset = $source.IndexOf('$null = Assert-DurableClaimEvidence -Receipt $acceptanceReceipt', $receiptReadOffset)
if ($receiptReadOffset -lt 0 -or $claimingActionGuardOffset -lt $receiptReadOffset -or
  $claimEvidenceOffset -lt $claimingActionGuardOffset) {
  throw "RecoverCleanup or Verify can consume a claiming receipt or reread an uncommitted durable claim."
}

# Recovery and verification authenticate the immutable S3 claim, not merely caller-reviewed local
# JSON. Exercise both its encrypted-object binding and its exact six-field claim body.
$claimFixture = [ordered]@{
  schemaVersion = 1; kind = "development-job-search-acceptance-claim"; sourceSha = $SourceSha
  executionPlanSha256 = $ReviewedExecutionPlanSha256; runId = $runId
  claimedAt = [DateTimeOffset]::UtcNow.ToString("o")
}
$script:claimBody = $claimFixture | ConvertTo-Json -Depth 10
$claimAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
  $script:claimChecksum = [Convert]::ToBase64String($claimAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:claimBody)))
} finally { $claimAlgorithm.Dispose() }
$claimReceipt = ConvertFrom-AcceptanceJson -Json ($receiptFixture | ConvertTo-Json -Depth 20) -Description "Claim receipt fixture"
$claimReceipt.claimChecksumSHA256 = $script:claimChecksum
$script:currentState = [pscustomobject]@{
  KmsKeyArn = "arn:aws:kms:us-east-2:111122223333:key/11111111-2222-3333-4444-555555555555"
}
$script:claimTamper = ""
function Invoke-AwsJson {
  param([string[]]$Arguments, [string]$Operation)
  if (($Arguments[0..1] -join " ") -cne "s3api get-object") {
    throw "Unexpected durable-claim AWS fixture call '$($Arguments -join ' ')'."
  }
  $outputPath = [string]$Arguments[-1]
  [IO.File]::WriteAllText($outputPath, $script:claimBody, (New-Object Text.UTF8Encoding($false)))
  $result = [pscustomobject]@{
    VersionId = "claim-version"; ServerSideEncryption = "aws:kms"
    SSEKMSKeyId = $script:currentState.KmsKeyArn; BucketKeyEnabled = $true
    ContentLength = [Text.Encoding]::UTF8.GetByteCount($script:claimBody)
    ChecksumSHA256 = $script:claimChecksum
    Metadata = [pscustomobject]@{
      "execution-plan-sha256" = $ReviewedExecutionPlanSha256
      "source-sha" = $SourceSha
      "run-id" = $runId
    }
  }
  switch ($script:claimTamper) {
    "version" { $result.VersionId = "other-version" }
    "encryption" { $result.ServerSideEncryption = "AES256" }
    "kms" { $result.SSEKMSKeyId += "-other" }
    "bucket-key" { $result.BucketKeyEnabled = $false }
    "length" { $result.ContentLength++ }
    "checksum" { $result.ChecksumSHA256 = ("A" * 43) + "=" }
    "metadata-plan" { $result.Metadata.'execution-plan-sha256' = "0" * 64 }
    "metadata-source" { $result.Metadata.'source-sha' = "0" * 40 }
    "metadata-run" { $result.Metadata.'run-id' = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    "metadata-extra" { $result.Metadata | Add-Member NoteProperty unexpected "value" }
  }
  return $result
}
$null = Assert-DurableClaimEvidence -Receipt $claimReceipt -PlanEvidence $planEvidence
foreach ($objectTamper in @("version", "encryption", "kms", "bucket-key", "length", "checksum", "metadata-plan", "metadata-source", "metadata-run", "metadata-extra")) {
  $script:claimTamper = $objectTamper
  Assert-TestRejected -Description "durable claim object tampering '$objectTamper'" -Operation {
    $null = Assert-DurableClaimEvidence -Receipt $claimReceipt -PlanEvidence $planEvidence
  }
}
$script:claimTamper = ""
foreach ($bodyTamper in @("extra", "kind", "source", "plan", "run", "claimed-at")) {
  $candidateClaim = ConvertFrom-AcceptanceJson -Json ($claimFixture | ConvertTo-Json -Depth 10) -Description "Candidate claim fixture"
  switch ($bodyTamper) {
    "extra" { $candidateClaim | Add-Member NoteProperty command "caller-controlled" }
    "kind" { $candidateClaim.kind = "other" }
    "source" { $candidateClaim.sourceSha = "0" * 40 }
    "plan" { $candidateClaim.executionPlanSha256 = "0" * 64 }
    "run" { $candidateClaim.runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    "claimed-at" { $candidateClaim.claimedAt = "2026-08-15T12:00:00Z" }
  }
  $script:claimBody = $candidateClaim | ConvertTo-Json -Depth 10
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $script:claimChecksum = [Convert]::ToBase64String($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:claimBody)))
  } finally { $algorithm.Dispose() }
  $candidateReceipt = ConvertFrom-AcceptanceJson -Json ($claimReceipt | ConvertTo-Json -Depth 20) -Description "Candidate claim receipt"
  $candidateReceipt.claimChecksumSHA256 = $script:claimChecksum
  Assert-TestRejected -Description "durable claim body tampering '$bodyTamper'" -Operation {
    $null = Assert-DurableClaimEvidence -Receipt $candidateReceipt -PlanEvidence $planEvidence
  }
}

$claimVerifyOffset = $source.IndexOf('$null = Assert-DurableClaimEvidence -Receipt $acceptanceReceipt')
$recoverActionOffset = $source.IndexOf('if ($Action -ceq "RecoverCleanup")')
if ($claimVerifyOffset -lt 0 -or $recoverActionOffset -lt $claimVerifyOffset) {
  throw "RecoverCleanup can reach task submission before authenticating the durable one-time claim."
}

$prepareSubmitOffset = $source.IndexOf('$receipt.prepareTaskArn = Submit-AcceptanceTask')
$cleanupArmedOffset = $source.IndexOf('$prepareMayHaveStarted = $true')
if ($cleanupArmedOffset -lt 0 -or $prepareSubmitOffset -lt $cleanupArmedOffset) {
  throw "Execute can submit prepare before arming its finally cleanup boundary."
}
$primaryFailureOffset = $source.IndexOf('if ($null -ne $primaryFailure)')
$failedCleanedOffset = $source.IndexOf('$receipt.phase = "failed-cleaned"', $primaryFailureOffset)
$nextInvariantOffset = $source.IndexOf('if (-not $receipt.staleCursorRejected', $primaryFailureOffset)
if ($primaryFailureOffset -lt 0 -or $failedCleanedOffset -lt $primaryFailureOffset -or
  $nextInvariantOffset -lt $failedCleanedOffset) {
  throw "A primary acceptance failure followed by proved cleanup is not recorded as terminal failed-cleaned."
}
$recoverStart = $source.IndexOf('if ($Action -ceq "RecoverCleanup")')
$verifyStart = $source.IndexOf('if ([string]$acceptanceReceipt.phase -cne "verified"', $recoverStart)
$recoverSource = $source.Substring($recoverStart, $verifyStart - $recoverStart)
if ($recoverSource -match 'requestByPhase\.(?:prepare|mutate)' -or
  ([regex]::Matches($recoverSource, 'Submit-AcceptanceTask -Request \$requestByPhase\.cleanup')).Count -ne 1) {
  throw "RecoverCleanup can do more than submit the one reviewed cleanup request."
}
if ($recoverSource -notmatch '\$acceptanceReceipt\.phase\s+-notin\s+@\("running",\s*"cleanup-required"\)' -or
  $recoverSource -notmatch '\$acceptanceReceipt\.phase\s*=\s*"recovered-cleaned"' -or
  $recoverSource -notmatch 'AcceptanceClaim\s*=\s*\$false') {
  throw "RecoverCleanup does not terminate as non-accepting recovered-cleaned or reject terminal receipt replay."
}

foreach ($terminalPhase in @("failed-cleaned", "recovered-cleaned")) {
  $terminalReceipt = ConvertFrom-AcceptanceJson -Json ($receiptFixture | ConvertTo-Json -Depth 20) -Description "Terminal receipt fixture"
  $terminalReceipt.phase = $terminalPhase
  $terminalReceipt.cleanupTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('2' * 32)"
  $terminalReceipt.postCleanupCount = 0
  $terminalReceipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
  Write-TestPlan $terminalReceipt
  $terminalEvidence = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
  if ([string]$terminalEvidence.Receipt.phase -cne $terminalPhase) {
    throw "The $terminalPhase terminal recovery receipt was not authenticated."
  }
}

$verifiedReceipt = ConvertFrom-AcceptanceJson -Json ($receiptFixture | ConvertTo-Json -Depth 20) -Description "Verified receipt fixture"
$verifiedReceipt.phase = "verified"
$verifiedReceipt.prepareTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('1' * 32)"
$verifiedReceipt.mutateTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('2' * 32)"
$verifiedReceipt.cleanupTaskArn = "arn:aws:ecs:us-east-2:111122223333:task/fixture/$('3' * 32)"
$verifiedReceipt.queryTokenSha256 = "4" * 64
$verifiedReceipt.baselineJobSetSha256 = "5" * 64
$verifiedReceipt.restartJobSetSha256 = "5" * 64
$verifiedReceipt.staleCursorRejected = $true
$verifiedReceipt.postCleanupCount = 0
$verifiedReceipt.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
Write-TestPlan $verifiedReceipt
$verifiedEvidence = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
if ([string]$verifiedEvidence.Receipt.phase -cne "verified") {
  throw "The fully bound verified receipt was not accepted."
}
foreach ($verifiedTamper in @(
    "prepare-missing", "mutate-missing", "cleanup-missing", "duplicate-task", "query-missing",
    "baseline-missing", "restart-missing", "restart-mismatch", "stale", "count", "completed"
  )) {
  $candidate = ConvertFrom-AcceptanceJson -Json ($verifiedReceipt | ConvertTo-Json -Depth 20) -Description "Candidate verified receipt"
  switch ($verifiedTamper) {
    "prepare-missing" { $candidate.prepareTaskArn = "" }
    "mutate-missing" { $candidate.mutateTaskArn = "" }
    "cleanup-missing" { $candidate.cleanupTaskArn = "" }
    "duplicate-task" { $candidate.mutateTaskArn = $candidate.prepareTaskArn }
    "query-missing" { $candidate.queryTokenSha256 = "" }
    "baseline-missing" { $candidate.baselineJobSetSha256 = "" }
    "restart-missing" { $candidate.restartJobSetSha256 = "" }
    "restart-mismatch" { $candidate.restartJobSetSha256 = "6" * 64 }
    "stale" { $candidate.staleCursorRejected = $false }
    "count" { $candidate.postCleanupCount = -1 }
    "completed" { $candidate.completedAt = "2026-08-15T12:00:00Z" }
  }
  Write-TestPlan $candidate
  Assert-TestRejected -Description "verified receipt tampering '$verifiedTamper'" -Operation {
    $null = Read-AcceptanceReceipt -Path $script:testPlanPath -Sha256 $script:testPlanHash -PlanEvidence $planEvidence
  }
}

if (Test-Path -LiteralPath $script:testPlanPath) { Remove-Item -LiteralPath $script:testPlanPath -Force }
if (Test-Path -LiteralPath $operatorRoot) { Remove-Item -LiteralPath $operatorRoot -Force }
Write-Output "Development job-search acceptance operator tests passed."
