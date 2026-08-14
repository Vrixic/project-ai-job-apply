Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$operatorPath = Join-Path $repositoryRoot "scripts\operate-development-gateway-release.ps1"
$operator = Get-Content -LiteralPath $operatorPath -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($operatorPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "The gateway release operator does not parse: $($errors.Message -join '; ')." }

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$Message)
  $rejected = $false
  try { & $Action } catch { $rejected = $true }
  if (-not $rejected) { throw $Message }
}

foreach ($functionName in @(
    "Get-OptionalProperty", "Get-GatewayKeyHistoryMatches",
    "Get-StateDocumentProcessorParserQualifiedArn", "Assert-RetainedGatewayParserBinding"
  )) {
  $functions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
      }, $true))
  if ($functions.Count -ne 1) { throw "$functionName must be defined exactly once." }
  Invoke-Expression $functions[0].Extent.Text
}

$exactKey = "lambda/gateway/source/artifact/gateway-lambda.zip"
foreach ($emptyHistory in @(
    [pscustomobject]@{},
    [pscustomobject]@{ Versions = @(); DeleteMarkers = @() },
    [pscustomobject]@{ Versions = @($null); DeleteMarkers = @($null) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $emptyHistory -Key $exactKey).Count -ne 0) {
    throw "Empty or null S3 gateway history was treated as an existing immutable key."
  }
}
foreach ($existingHistory in @(
    [pscustomobject]@{ Versions = @([pscustomobject]@{ Key = $exactKey }) },
    [pscustomobject]@{ DeleteMarkers = @([pscustomobject]@{ Key = $exactKey }) }
  )) {
  if (@(Get-GatewayKeyHistoryMatches -Result $existingHistory -Key $exactKey).Count -ne 1) {
    throw "An exact gateway object version or delete marker was not detected."
  }
}
$unrelatedHistory = [pscustomobject]@{
  Versions = @($null, [pscustomobject]@{ Key = "$exactKey.unrelated" }, [pscustomobject]@{})
  DeleteMarkers = @([pscustomobject]@{ Key = "unrelated/$exactKey" })
}
if (@(Get-GatewayKeyHistoryMatches -Result $unrelatedHistory -Key $exactKey).Count -ne 0) {
  throw "Gateway history matching was relaxed beyond the exact immutable key."
}

$account = "362544434697"
$region = "us-east-2"
$parserOne = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:1"
$parserTwo = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:2"
$processorAddress = "module.platform.aws_lambda_function.document_processor[0]"
function New-ProcessorStateResources {
  param([AllowNull()][object]$Processor)
  $resources = New-Object 'Collections.Generic.Dictionary[string, object]' ([StringComparer]::Ordinal)
  if ($null -ne $Processor) { $resources[$processorAddress] = $Processor }
  return $resources
}
function New-ProcessorResource {
  param([AllowNull()][object]$Environment)
  return [pscustomobject]@{ values = [pscustomobject]@{ environment = $Environment } }
}
function New-ProcessorEnvironment {
  param([AllowNull()][object]$ParserQualifiedArn)
  $environment = [object[]]@([pscustomobject]@{
      variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $ParserQualifiedArn }
    })
  Write-Output -NoEnumerate $environment
}

# Exact retained schema-3 CompleteDark shape: state serial 106, latest parser :2,
# and the deployed processor still invokes the checksum-reviewed parser :1.
$completeDarkHandoff = [pscustomobject]@{
  SchemaVersion = "3"; StateSerial = 106; Stage = "complete-dark"
  ParserQualifiedArn = $parserOne
}
$completeDarkResources = New-ProcessorStateResources `
  (New-ProcessorResource (New-ProcessorEnvironment $parserOne))
if ($completeDarkResources[$processorAddress].values.environment -isnot [array]) {
  throw "The CompleteDark positive fixture must preserve Terraform's JSON array block shape."
}
$completeDarkProcessorPin = Get-StateDocumentProcessorParserQualifiedArn `
  -Resources $completeDarkResources -AccountId $account -Region $region
if ($completeDarkProcessorPin -cne $parserOne) {
  throw "The exact CompleteDark processor parser pin was not extracted from Terraform state."
}
$null = Assert-RetainedGatewayParserBinding -Stage $completeDarkHandoff.Stage `
  -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $completeDarkHandoff.ParserQualifiedArn `
  -StateParserQualifiedArn $parserTwo -StateProcessorParserQualifiedArn $completeDarkProcessorPin `
  -AccountId $account -Region $region

# ParserDark has a deployed parser version but no processor or invocation pin.
$parserDarkResources = New-ProcessorStateResources $null
$parserDarkProcessorPin = Get-StateDocumentProcessorParserQualifiedArn `
  -Resources $parserDarkResources -AccountId $account -Region $region
if (-not [string]::IsNullOrEmpty($parserDarkProcessorPin)) {
  throw "ParserDark unexpectedly acquired a processor parser pin."
}
$null = Assert-RetainedGatewayParserBinding -Stage "parser-dark" `
  -PlanParserQualifiedArn "" -MetadataParserQualifiedArn "" `
  -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn "" `
  -AccountId $account -Region $region

# A CompleteDark handoff may also pin the latest parser version exactly.
$null = Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
  -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $parserOne `
  -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn $parserOne `
  -AccountId $account -Region $region

foreach ($case in @(
    @{ Label = "resource values omitted"; Processor = [pscustomobject]@{} },
    @{ Label = "resource values null"; Processor = [pscustomobject]@{ values = $null } },
    @{ Label = "environment omitted"; Processor = [pscustomobject]@{ values = [pscustomobject]@{} } },
    @{ Label = "environment null"; Processor = New-ProcessorResource $null },
    @{ Label = "environment empty"; Processor = New-ProcessorResource @() },
    @{ Label = "environment scalar"; Processor = [pscustomobject]@{ values = [pscustomobject]@{
          environment = [pscustomobject]@{
            variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne }
          }
        } } },
    @{ Label = "environment multiple"; Processor = New-ProcessorResource @(
        [pscustomobject]@{ variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne } },
        [pscustomobject]@{ variables = [pscustomobject]@{ DOCUMENT_PARSER_FUNCTION_ARN = $parserOne } }
      ) },
    @{ Label = "variables omitted"; Processor = New-ProcessorResource @([pscustomobject]@{}) },
    @{ Label = "variables null"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = $null }) },
    @{ Label = "variables scalar"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = "invalid" }) },
    @{ Label = "pin omitted"; Processor = New-ProcessorResource @([pscustomobject]@{ variables = [pscustomobject]@{} }) }
  )) {
  $resources = New-ProcessorStateResources $case.Processor
  Assert-Rejected {
    Get-StateDocumentProcessorParserQualifiedArn -Resources $resources -AccountId $account -Region $region
  } "The processor-state parser extractor accepted $($case.Label)."
}

$invalidPins = @(
  $null, 1, "", " $parserOne", "$parserOne ",
  "arn:aws:lambda:us-east-2:999999999999:function:ai-job-apply-development-document-parser:1",
  "arn:aws:lambda:us-west-2:${account}:function:ai-job-apply-development-document-parser:1",
  "arn:aws:lambda:${region}:${account}:function:other-document-parser:1",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:development",
  'arn:aws:lambda:us-east-2:362544434697:function:ai-job-apply-development-document-parser:$LATEST',
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:0",
  "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:01"
)
foreach ($invalidPin in $invalidPins) {
  $resources = New-ProcessorStateResources `
    (New-ProcessorResource (New-ProcessorEnvironment $invalidPin))
  Assert-Rejected {
    Get-StateDocumentProcessorParserQualifiedArn -Resources $resources -AccountId $account -Region $region
  } "The processor-state parser extractor accepted an invalid parser ARN."
}
foreach ($invalidPin in $invalidPins) {
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
      -PlanParserQualifiedArn $invalidPin -MetadataParserQualifiedArn $invalidPin `
      -StateParserQualifiedArn $parserTwo -StateProcessorParserQualifiedArn $invalidPin `
      -AccountId $account -Region $region
  } "The retained parser binding accepted an invalid retained parser ARN."
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage "complete-dark" `
      -PlanParserQualifiedArn $parserOne -MetadataParserQualifiedArn $parserOne `
      -StateParserQualifiedArn $invalidPin -StateProcessorParserQualifiedArn $parserOne `
      -AccountId $account -Region $region
  } "The retained parser binding accepted an invalid latest parser ARN."
}

foreach ($case in @(
    @{ Label = "CompleteDark processor absent"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserTwo; Processor = "" },
    @{ Label = "CompleteDark processor repinned"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserTwo; Processor = $parserTwo },
    @{ Label = "arbitrary same-family retained pin"; Stage = "complete-dark"; Plan = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:7"; Metadata = "arn:aws:lambda:${region}:${account}:function:ai-job-apply-development-document-parser:7"; Latest = $parserTwo; Processor = $parserOne },
    @{ Label = "plan metadata mismatch"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserTwo; Latest = $parserTwo; Processor = $parserOne },
    @{ Label = "ParserDark retained pin"; Stage = "parser-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = $parserOne; Processor = "" },
    @{ Label = "ParserDark processor present"; Stage = "parser-dark"; Plan = ""; Metadata = ""; Latest = $parserOne; Processor = $parserOne },
    @{ Label = "missing latest parser"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = ""; Processor = $parserOne },
    @{ Label = "wrong latest parser family"; Stage = "complete-dark"; Plan = $parserOne; Metadata = $parserOne; Latest = "arn:aws:lambda:${region}:${account}:function:other-document-parser:2"; Processor = $parserOne }
  )) {
  Assert-Rejected {
    Assert-RetainedGatewayParserBinding -Stage $case.Stage `
      -PlanParserQualifiedArn $case.Plan -MetadataParserQualifiedArn $case.Metadata `
      -StateParserQualifiedArn $case.Latest -StateProcessorParserQualifiedArn $case.Processor `
      -AccountId $account -Region $region
  } "The retained parser binding accepted $($case.Label)."
}
Assert-Rejected {
  Assert-RetainedGatewayParserBinding -Stage "kms-prerequisite" `
    -PlanParserQualifiedArn "" -MetadataParserQualifiedArn "" `
    -StateParserQualifiedArn $parserOne -StateProcessorParserQualifiedArn "" `
    -AccountId $account -Region $region
} "The retained parser binding accepted an unsupported stage."

foreach ($required in @(
    'ValidateSet("Status", "Publish", "VerifyPublication", "Plan", "Apply", "Verify")',
    'SourceSha must equal the exact merged main checkout', 'ARTIFACT_SOURCE_SHA',
    'Assert-GatewayPublicationReceipt', 'Assert-GatewayReleaseVariables', 'Assert-ExactGatewayReleasePlan',
    'Assert-RetainedGatewayBaselineMetadata', 'Assert-RetainedGatewayBaselinePlan',
    'lib\development-document-dark-guards.ps1',
    'Get-GatewayKeyHistoryMatches -Result $history -Key $key',
    '$planPath.baseline.json', 'Read-BaselineDocumentReceipt',
    'Assert-GatewayDocumentBaselineReceipt', 'BaselineMetadataSchemaVersion',
    'BaselineMigrationImage',
    'MigrationRepositoryUrl', 'ParserQualifiedArn', 'ProcessorParserQualifiedArn',
    'Get-StateDocumentProcessorParserQualifiedArn', 'Assert-RetainedGatewayParserBinding',
    'Remote state changed after review', 'verify-development-gateway-lambda-boundary.ps1',
    'CodeSha256', 'RELEASE_SHA', '-detailed-exitcode', 'Get-StateIdentity',
    'Assert-RetainedGatewayBaselinePlan $plan $declaredVariables',
    'Remove-Item "Env:$($item.Name)"',
    'gateway_lambda_artifact_s3_object_version', '--if-none-match', 'lambda/gateway/$SourceSha/'
  )) {
  if (-not $operator.Contains($required)) { throw "The gateway release operator is missing '$required'." }
}
if ($operator.Contains('$parserArn -cne [string]$boundary.ParserQualifiedArn')) {
  throw "The gateway operator still conflates the retained processor pin with the latest parser version."
}
$deploymentGuardsOffset = $operator.IndexOf('lib\deployment-operator-guards.ps1', [StringComparison]::Ordinal)
$documentGuardsOffset = $operator.IndexOf('lib\development-document-dark-guards.ps1', [StringComparison]::Ordinal)
$gatewayGuardsOffset = $operator.IndexOf('lib\development-gateway-release-guards.ps1', [StringComparison]::Ordinal)
if ($deploymentGuardsOffset -lt 0 -or $documentGuardsOffset -le $deploymentGuardsOffset -or
    $gatewayGuardsOffset -le $documentGuardsOffset) {
  throw "The gateway operator must load deployment, document-drift, then gateway guards in fail-closed dependency order."
}
foreach ($forbidden in @('terraform destroy', '-target=', 'terraform import', 'serverless_runtime_enabled = "false"')) {
  if ($operator.Contains($forbidden)) { throw "The gateway release operator contains forbidden text '$forbidden'." }
}
if ($operator -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The gateway release operator uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($operator -match '(?m)terraform[^\r\n]*\s-target(?:=|\s)') { throw "The gateway release operator uses resource targeting." }

$buildScript = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\build-gateway-lambda.mjs") -Raw
if (-not $buildScript.Contains('buildLambdaArtifact') -or -not $buildScript.Contains('artifactName: "gateway-lambda"')) {
  throw "The gateway build does not use the shared commit-provenance artifact builder."
}
$workflow = Get-Content -LiteralPath (Join-Path $repositoryRoot ".github\workflows\publish-gateway-lambda.yml") -Raw
foreach ($binding in @('ARTIFACT_SOURCE_SHA: ${{ github.sha }}', '.sourceSha', '$GITHUB_SHA')) {
  if (-not $workflow.Contains($binding)) { throw "The protected gateway publication workflow is missing '$binding'." }
}

$boundaryPath = Join-Path $repositoryRoot "scripts\verify-gateway-lambda-boundary.ps1"
$boundary = Get-Content -LiteralPath $boundaryPath -Raw
[Management.Automation.Language.Parser]::ParseFile($boundaryPath, [ref]$tokens, [ref]$errors) | Out-Null
if (@($errors).Count -ne 0) { throw "The direct gateway verifier does not parse." }
foreach ($case in @(
    'Name = "job-search"', 'Name = "job-search-missing-authorizer"',
    'Name = "job-search-wrong-scope"', 'Name = "job-search-invalid-body"',
    'Name = "job-search-oversized"', 'Name = "job-search-wrong-media-type"',
    'Name = "job-search-wrong-path"', 'Name = "job-search-unexpected-query"',
    'Code = "invalid_request"',
    'SuccessContract = "JobSearchPage"', 'ForbiddenResponseText = $restrictedSearchMarker'
  )) {
  if (-not $boundary.Contains($case)) { throw "The direct verifier is missing '$case'." }
}
if ($boundary -match '\.Contains\([^\)]*,\s*\[StringComparison\]') {
  throw "The direct verifier uses a Windows PowerShell 5.1-incompatible string Contains overload."
}
if ($boundary -match 'Write-(?:Host|Output)[^\r\n]*restrictedSearchMarker') {
  throw "The direct verifier writes the restricted search marker to output."
}

foreach ($wrapperName in @("verify-development-gateway-lambda-boundary.ps1", "verify-staging-gateway-lambda-boundary.ps1")) {
  $wrapperPath = Join-Path $repositoryRoot "scripts\$wrapperName"
  $wrapper = Get-Content -LiteralPath $wrapperPath -Raw
  [Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -ne 0) {
    throw "$wrapperName does not preserve the non-mutating generic verifier interface."
  }
}

Write-Output "Development gateway release operator and search-boundary tests passed."
