[CmdletBinding()]
param(
  [ValidateSet("Inspect", "Retire", "Recover")][string]$Action = "Inspect",
  [string]$AwsProfile = "ai-job-apply-development-admin",
  [string]$Region = "us-east-2",
  [ValidatePattern("^[0-9]{12}$")][string]$ExpectedAccountId = "",
  [ValidatePattern("^[a-z0-9.-]+$")][string]$StateBucket = "",
  [ValidatePattern("^[a-f0-9]{40}$")][string]$SourceSha = "",
  [string]$MigrationReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedMigrationReceiptSha256 = "",
  [string]$InspectionReceiptPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedInspectionReceiptSha256 = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ExpectedManifestSha256 = "",
  [string]$RecoveryContextPath = "",
  [ValidatePattern("^[a-f0-9]{64}$")][string]$ReviewedRecoveryContextSha256 = "",
  [switch]$Help
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/terraform-toolchain.ps1")
. (Join-Path $PSScriptRoot "lib/deployment-operator-guards.ps1")
if ($Help) {
  Write-Output "Inspect runs only the fixed generated-catalog read. Retire requires its reviewed receipt and exact manifest. Recover reconciles an existing task and deregisters its exact stopped temporary revision; it never resubmits. Every action requires development account, state bucket, clean merged SourceSha and verified migration receipt. No SQL, job, command, image, role, network or environment override is accepted."
  exit 0
}
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$terraformRoot = Join-Path $repositoryRoot "infrastructure/terraform/environments/development/.terraform"
$operatorRoot = Join-Path $terraformRoot "development-synthetic-catalog-retirement"
$migrationReceiptRoot = Join-Path $terraformRoot "development-migration-image"
$stateKey = "platform.tfstate"
$migrationFamily = "ai-job-apply-development-database-migration"
$containerName = "database-migration"
$applicationLogGroup = "/ai-job-apply/development/application"
$retirementCommand = @("jobs/dist/src/run-synthetic-catalog-retirement.js")
$confirmation = "retain-generated-source-neutral-history"
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)

function Assert-RetirementInputs {
  if ($Region -cne "us-east-2" -or $ExpectedAccountId -cnotmatch '^[0-9]{12}$' -or $StateBucket -cnotmatch '^[a-z0-9.-]+$' -or $AwsProfile -cnotmatch '^[A-Za-z0-9_.-]+$') { throw "The exact development account, region, profile and state bucket are required." }
  if ($SourceSha -cnotmatch '^[a-f0-9]{40}$' -or [string]::IsNullOrWhiteSpace($MigrationReceiptPath) -or $ReviewedMigrationReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') { throw "The clean source and reviewed migration receipt pair are required." }
  $inspection = @($InspectionReceiptPath, $ReviewedInspectionReceiptSha256, $ExpectedManifestSha256)
  $recovery = @($RecoveryContextPath, $ReviewedRecoveryContextSha256)
  if ($Action -ceq "Retire") {
    if (@($inspection | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0 -or @($recovery | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -ne 0) { throw "Retire requires only the exact inspection receipt pair and manifest." }
  } elseif ($Action -ceq "Recover") {
    if (@($recovery | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0 -or @($inspection | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -ne 0) { throw "Recover requires only the exact existing context pair." }
  } elseif (@($inspection + $recovery | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -ne 0) { throw "Inspect accepts no prior inspection, manifest or recovery input." }
}
function Assert-RetirementSource {
  Assert-DeploymentTerraformEnvironment
  foreach ($name in @([Environment]::GetEnvironmentVariables("Process").Keys | Where-Object { [string]$_ -cmatch '^AWS_ENDPOINT_URL($|_)' })) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name, "Process"))) { throw "AWS endpoint overrides are not permitted." }
  }
  $branch = & git -C $repositoryRoot branch --show-current 2>$null
  if ($LASTEXITCODE -ne 0 -or ($branch -join "").Trim() -cne "main") { throw "A clean merged main checkout is required." }
  foreach ($reference in @("HEAD", "origin/main")) {
    $revision = & git -C $repositoryRoot rev-parse $reference 2>$null
    if ($LASTEXITCODE -ne 0 -or ($revision -join "").Trim() -cne $SourceSha) { throw "SourceSha must equal HEAD and origin/main." }
  }
  $dirty = @(& git -C $repositoryRoot status --porcelain 2>$null)
  if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw "SourceSha must describe a clean checkout." }
}
function Assert-RetirementRegularPath {
  param([Parameter(Mandatory)][string]$Path, [switch]$Directory)
  $full = [IO.Path]::GetFullPath($Path)
  $item = Get-Item -LiteralPath $full -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or [bool]$item.PSIsContainer -ne [bool]$Directory) { throw "Evidence must be regular and contain no filesystem redirection." }
  $parent = if ($Directory) { $item.Parent } else { $item.Directory }
  while ($null -ne $parent) {
    if (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Evidence ancestors must contain no filesystem redirection." }
    $parent = $parent.Parent
  }
  return $full
}
function Initialize-RetirementDirectory {
  $created = -not (Test-Path -LiteralPath $operatorRoot)
  if ($created) { $null = New-Item -ItemType Directory -Path $operatorRoot }
  $null = Assert-RetirementRegularPath -Path $operatorRoot -Directory
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($created) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath $operatorRoot -AclObject $acl
  }
  $acl = Get-Acl -LiteralPath $operatorRoot
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value -or -not $acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -cne $sid.Value -or $rules[0].AccessControlType -ne "Allow" -or $rules[0].FileSystemRights -ne "FullControl") { throw "The retirement evidence directory must be protected current-user-only." }
}
function Write-RetirementJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Value, [switch]$Replace)
  $full = Resolve-PathBelowRoot -Candidate $Path -AllowedRoot $operatorRoot
  if (Test-Path -LiteralPath $full) {
    $null = Assert-RetirementRegularPath -Path $full
    if (-not $Replace) { throw "Retirement evidence already exists; do not repeat the operation." }
  }
  $bytes = $utf8WithoutBom.GetBytes(($Value | ConvertTo-Json -Depth 60 -Compress))
  $temporary = if ($Replace) { "$full.$([guid]::NewGuid().ToString('N')).tmp" } else { $full }
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  if ($Replace) { Move-Item -LiteralPath $temporary -Destination $full -Force }
}
function Read-RetirementJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][string]$Root)
  $full = Resolve-PathBelowRoot -Candidate $Path -AllowedRoot $Root -MustExist
  $null = Assert-RetirementRegularPath -Path $full
  $length = (Get-Item -LiteralPath $full).Length
  if ($length -le 0 -or $length -gt 1048576 -or (Get-FileSha256 $full) -cne $Sha256) { throw "The reviewed evidence bytes changed or exceed their bound." }
  return ConvertFrom-RetirementJson -Json ([IO.File]::ReadAllText($full)) -Description "Retirement evidence"
}
function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Operation)
  $raw = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --cli-connect-timeout 10 --cli-read-timeout 30 2>$null
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed; retain the exact context and do not resubmit." }
  $json = $raw -join [Environment]::NewLine
  if ($json.Length -gt 8388608) { throw "The bounded AWS response is too large." }
  return ConvertFrom-RetirementJson -Json $json -Description $Operation
}
function Get-RetirementStateResource {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Type, [Parameter(Mandatory)][string]$Name, [string]$IndexKey = "")
  $resource = @($Snapshot.State.resources | Where-Object { $_.mode -ceq "managed" -and (Get-OptionalProperty $_ "module") -ceq "module.platform" -and $_.type -ceq $Type -and $_.name -ceq $Name })
  if ($resource.Count -ne 1) { throw "The exact Terraform-owned resource is unavailable." }
  $instances = @($resource[0].instances)
  if ($IndexKey -cne "") { $instances = @($instances | Where-Object { (Get-OptionalProperty $_ "index_key") -ceq $IndexKey }) }
  if ($instances.Count -ne 1 -or $null -ne (Get-OptionalProperty $instances[0] "deposed")) { throw "The exact Terraform-owned resource is unavailable." }
  return $instances[0].attributes
}
function Assert-RetirementIdle {
  param([Parameter(Mandatory)][string]$ClusterArn, [string]$AllowedTaskArn = "")
  $services = Invoke-AwsJson -Arguments @("ecs", "list-services", "--cluster", $ClusterArn, "--output", "json") -Operation "ECS service check"
  if (@($services.serviceArns).Count -ne 0) { throw "The migration-only cluster must contain zero services." }
  foreach ($status in @("RUNNING", "PENDING")) {
    $tasks = Invoke-AwsJson -Arguments @("ecs", "list-tasks", "--cluster", $ClusterArn, "--desired-status", $status, "--output", "json") -Operation "ECS idle check"
    if (@($tasks.taskArns | Where-Object { [string]$_ -cne $AllowedTaskArn }).Count -ne 0) { throw "Another task is active in the migration-only cluster." }
  }
}

function Get-OptionalProperty {
  param([AllowNull()][object]$Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256 {
  param([Parameter(Mandatory)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}

function ConvertFrom-RetirementJson {
  param(
    [Parameter(Mandatory, ValueFromPipeline)][string]$Json,
    [Parameter(Mandatory)][string]$Description
  )
  process {
    try {
      $command = Get-Command ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop
      if ($command.Parameters.ContainsKey("DateKind")) {
        return $Json | ConvertFrom-Json -DateKind String
      }
      return $Json | ConvertFrom-Json
    } catch {
      throw "$Description is invalid JSON."
    }
  }
}

function Assert-ExactPropertySet {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string[]]$ExpectedNames,
    [Parameter(Mandatory)][string]$Description
  )
  $actual = if ($Value -is [System.Collections.IDictionary]) {
    @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
  } else {
    @($Value.PSObject.Properties.Name | Sort-Object)
  }
  $expected = @($ExpectedNames | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) {
    throw "$Description does not contain the exact canonical property set."
  }
  return $true
}

function Test-CanonicalUtcTimestamp {
  param([AllowNull()][object]$Value)
  if ($Value -isnot [string]) { return $false }
  $parsed = [DateTimeOffset]::MinValue
  $valid = [DateTimeOffset]::TryParseExact(
    [string]$Value, "o", [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed
  )
  return $valid -and $parsed.Offset -eq [TimeSpan]::Zero -and [string]$Value -ceq $parsed.ToString("o")
}

function Resolve-PathBelowRoot {
  param(
    [Parameter(Mandatory)][string]$Candidate,
    [Parameter(Mandatory)][string]$AllowedRoot,
    [switch]$MustExist
  )
  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) {
    [IO.Path]::GetFullPath($Candidate)
  } else {
    [IO.Path]::GetFullPath((Join-Path $root $Candidate))
  }
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The evidence path must stay below its exact ignored operator directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The required evidence file does not exist."
  }
  return $resolved
}

function Read-StateSnapshot {
  $versioning = Invoke-AwsJson -Arguments @("s3api", "get-bucket-versioning", "--bucket", $StateBucket, "--output", "json") -Operation "State versioning validation"
  $publicAccess = Invoke-AwsJson -Arguments @("s3api", "get-public-access-block", "--bucket", $StateBucket, "--output", "json") -Operation "State public-access validation"
  $encryption = Invoke-AwsJson -Arguments @("s3api", "get-bucket-encryption", "--bucket", $StateBucket, "--output", "json") -Operation "State encryption validation"
  $block = $publicAccess.PublicAccessBlockConfiguration
  $rules = @($encryption.ServerSideEncryptionConfiguration.Rules | Where-Object {
      [string]$_.ApplyServerSideEncryptionByDefault.SSEAlgorithm -ceq "aws:kms" -and
      $_.BucketKeyEnabled -and [string]$_.ApplyServerSideEncryptionByDefault.KMSMasterKeyID -match "^arn:aws:kms:$([regex]::Escape($Region)):$ExpectedAccountId`:key/"
    })
  if ([string]$versioning.Status -cne "Enabled" -or
      -not ($block.BlockPublicAcls -is [bool] -and $block.BlockPublicAcls -eq $true -and
        $block.IgnorePublicAcls -is [bool] -and $block.IgnorePublicAcls -eq $true -and
        $block.BlockPublicPolicy -is [bool] -and $block.BlockPublicPolicy -eq $true -and
        $block.RestrictPublicBuckets -is [bool] -and $block.RestrictPublicBuckets -eq $true) -or
      $rules.Count -ne 1) {
    throw "The state bucket is not the exact versioned, private, customer-KMS, bucket-key boundary."
  }
  $head = Invoke-AwsJson -Arguments @("s3api", "head-object", "--bucket", $StateBucket, "--key", $stateKey, "--output", "json") -Operation "State object validation"
  if ([string]$head.ServerSideEncryption -cne "aws:kms" -or [string]$head.SSEKMSKeyId -cne [string]$rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -or
      -not $head.BucketKeyEnabled -or [string]::IsNullOrWhiteSpace([string]$head.VersionId) -or [long]$head.ContentLength -le 0 -or [long]$head.ContentLength -gt 8388608) {
    throw "The current Terraform state object is outside the exact encrypted boundary."
  }
  $temporary = (Join-Path $operatorRoot ("state-" + [guid]::NewGuid().ToString('N') + '.json'))
  try {
    $download = Invoke-AwsJson -Arguments @("s3api", "get-object", "--bucket", $StateBucket, "--key", $stateKey, "--version-id", [string]$head.VersionId, "--output", "json", $temporary) -Operation "Versioned state read"
    if ([string]$download.VersionId -cne [string]$head.VersionId) { throw "The state version changed during its exact read." }
    $state = ConvertFrom-RetirementJson -Json (Get-Content -LiteralPath $temporary -Raw) -Description "The versioned Terraform state"
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
  Assert-DeploymentTerraformStateVersion -Version ([string]$state.terraform_version)
  if ([string]$state.lineage -notmatch '^[0-9a-f-]{36}$' -or [long]$state.serial -lt 1) {
    throw "The encrypted state identity is incomplete or uses an unexpected Terraform version."
  }
  return [pscustomobject]@{
    State = $state; VersionId = [string]$head.VersionId; Lineage = [string]$state.lineage; Serial = [long]$state.serial
    KmsKeyArn = [string]$head.SSEKMSKeyId
  }
}

function Get-StateOutput {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Name)
  $property = $Snapshot.State.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) { throw "The encrypted state is missing the required $Name output." }
  return $property.Value.value
}


function Invoke-RetirementImageVerification {
  $path = Resolve-PathBelowRoot -Candidate $MigrationReceiptPath -AllowedRoot $migrationReceiptRoot -MustExist
  $receipt = Read-RetirementJson -Path $path -Sha256 $ReviewedMigrationReceiptSha256 -Root $migrationReceiptRoot
  $verified = @(& (Join-Path $PSScriptRoot "publish-development-migration-image.ps1") -Action Verify -AwsProfile $AwsProfile -Region $Region -ExpectedAccountId $ExpectedAccountId -StateBucket $StateBucket -SourceSha $SourceSha -ReceiptPath $path -ReviewedReceiptSha256 $ReviewedMigrationReceiptSha256)
  if ($LASTEXITCODE -ne 0 -or $verified.Count -ne 1 -or $verified[0].Outcome -cne "verified" -or $verified[0].SourceSha -cne $SourceSha -or $verified[0].ReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or $verified[0].ImageUri -cne $receipt.imageUri -or $verified[0].Platform -cne "linux/amd64" -or $verified[0].ImmutableReadback -ne $true) { throw "The maintained migration-image verification did not pass." }
  if ([string]$receipt.imageUri -cnotmatch ("^" + [regex]::Escape("$ExpectedAccountId.dkr.ecr.$Region.amazonaws.com/ai-job-apply/migration@sha256:") + "[a-f0-9]{64}$")) { throw "The verified migration image is outside the exact repository." }
  return $receipt
}
function ConvertTo-RetirementContainer {
  param([Parameter(Mandatory)][object]$Container)
  $copy = ConvertFrom-RetirementJson -Json ($Container | ConvertTo-Json -Depth 30 -Compress) -Description "Migration container"
  foreach ($name in @("portMappings", "mountPoints", "volumesFrom", "systemControls", "resourceRequirements", "environmentFiles", "dependsOn", "ulimits", "credentialSpecs")) {
    $property = $copy.PSObject.Properties[$name]
    if ($null -ne $property) {
      if ($property.Value -isnot [array] -or $property.Value.Count -ne 0) { throw "The migration container has an unexpected capability." }
      $copy.PSObject.Properties.Remove($name)
    }
  }
  $cpu = $copy.PSObject.Properties["cpu"]
  if ($null -ne $cpu) {
    if (($cpu.Value -isnot [int] -and $cpu.Value -isnot [long]) -or $cpu.Value -ne 0) { throw "The migration container CPU override is invalid." }
    $copy.PSObject.Properties.Remove("cpu")
  }
  return $copy
}
function New-RetirementRegistration {
  param([Parameter(Mandatory)][object]$Response, [Parameter(Mandatory)][object]$OwnedTask, [Parameter(Mandatory)][string]$Image, [switch]$Temporary)
  $task = $Response.taskDefinition
  $arnPattern = "^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task-definition/" + [regex]::Escape($migrationFamily) + ":[1-9][0-9]*$"
  $allowed = @("taskDefinitionArn","containerDefinitions","family","executionRoleArn","networkMode","revision","volumes","status","requiresAttributes","placementConstraints","compatibilities","requiresCompatibilities","cpu","memory","registeredAt","registeredBy","deregisteredAt","runtimePlatform","enableFaultInjection","taskRoleArn")
  if (@($task.PSObject.Properties.Name | Where-Object { $_ -cnotin $allowed }).Count -ne 0 -or $task.taskDefinitionArn -cnotmatch $arnPattern -or (-not $Temporary -and $task.taskDefinitionArn -cne $OwnedTask.arn) -or $task.status -cne "ACTIVE" -or $task.family -cne $migrationFamily -or $task.executionRoleArn -cne $OwnedTask.execution_role_arn -or $task.networkMode -cne "awsvpc" -or [string]$task.cpu -cne "256" -or [string]$task.memory -cne "512" -or (@($task.requiresCompatibilities) -join "|") -cne "FARGATE" -or $task.runtimePlatform.cpuArchitecture -cne "X86_64" -or $task.runtimePlatform.operatingSystemFamily -cne "LINUX" -or @($task.volumes).Count -ne 0 -or @($task.placementConstraints).Count -ne 0 -or -not [string]::IsNullOrEmpty([string](Get-OptionalProperty $task "taskRoleArn"))) { throw "The exact hardened Terraform-owned migration task is required." }
  $fault = $task.PSObject.Properties["enableFaultInjection"]
  if ($null -ne $fault -and ($fault.Value -isnot [bool] -or $fault.Value)) { throw "Fault injection is not permitted." }
  $declared = ConvertFrom-RetirementJson -Json $OwnedTask.container_definitions -Description "Terraform migration container"
  $declared = @($declared)
  $containers = @($task.containerDefinitions)
  if ($declared.Count -ne 1 -or $containers.Count -ne 1) { throw "Exactly one migration container is required." }
  $container = $containers[0]
  $expected = $declared[0]
  if ($Temporary) { $expected.image = $Image }
  if ((ConvertTo-DeploymentCanonicalValue (ConvertTo-RetirementContainer $container)) -cne (ConvertTo-DeploymentCanonicalValue $expected) -or $container.name -cne $containerName -or $container.essential -isnot [bool] -or -not $container.essential -or $container.readonlyRootFilesystem -isnot [bool] -or -not $container.readonlyRootFilesystem -or (@($container.command) -join "|") -cne "runner/dist/src/main.js" -or @($container.environment).Count -ne 1 -or $container.environment[0].name -cne "NODE_ENV" -or $container.environment[0].value -cne "production" -or @($container.secrets).Count -ne 1 -or $container.secrets[0].name -cne "DATABASE_URL" -or $container.logConfiguration.logDriver -cne "awslogs" -or $container.logConfiguration.options.'awslogs-group' -cne $applicationLogGroup -or $container.logConfiguration.options.'awslogs-region' -cne $Region -or $container.logConfiguration.options.'awslogs-stream-prefix' -cne "database-migration") { throw "The migration container configuration changed or is not hardened." }
  $tagMap = @{}
  foreach ($tag in @($Response.tags)) {
    $null = Assert-ExactPropertySet $tag @("key","value") "Migration tag"
    if ($tag.key -isnot [string] -or $tag.value -isnot [string] -or $tagMap.ContainsKey($tag.key)) { throw "Migration tags are invalid." }
    $tagMap[$tag.key] = $tag.value
  }
  if ((ConvertTo-DeploymentCanonicalValue $tagMap) -cne (ConvertTo-DeploymentCanonicalValue $OwnedTask.tags_all)) { throw "The migration task tags differ from Terraform." }
  $copy = ConvertFrom-RetirementJson -Json ($task | ConvertTo-Json -Depth 40 -Compress) -Description "Temporary migration definition"
  foreach ($name in @("taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy","deregisteredAt")) { $copy.PSObject.Properties.Remove($name) }
  $copy.containerDefinitions[0].image = $Image
  if ($null -ne $copy.PSObject.Properties["taskRoleArn"]) { $copy.PSObject.Properties.Remove("taskRoleArn") }
  $copy | Add-Member -NotePropertyName tags -NotePropertyValue @($Response.tags)
  return $copy
}
function Read-RetirementApplicationBoundary {
  param([Parameter(Mandatory)][object]$Snapshot)
  $observations = @()
  foreach ($name in @("gateway_lambda_alias_arn","outbox_starter_alias_arn","outbox_reconciler_alias_arn","profile_readiness_durable_alias_arn","profile_readiness_activity_alias_arn","profile_readiness_terminal_alias_arn","d2_community_scheduled_alias_arn","d2_trust_signal_alias_arn")) {
    $aliasArn = [string](Get-StateOutput $Snapshot $name)
    $pattern = "^arn:aws:lambda:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":function:(ai-job-apply-development-[a-z0-9-]+):development$"
    if ($aliasArn -cnotmatch $pattern) { throw "The normal runtime alias is outside development." }
    $functionName = [string]$Matches[1]
    $alias = Invoke-AwsJson -Arguments @("lambda","get-alias","--function-name",$functionName,"--name","development","--output","json") -Operation "Normal alias readback"
    $routing = Get-OptionalProperty $alias "RoutingConfig"
    if ($alias.AliasArn -cne $aliasArn -or $alias.FunctionVersion -cnotmatch '^[1-9][0-9]*$' -or ($null -ne $routing -and @($routing.AdditionalVersionWeights.PSObject.Properties).Count -ne 0)) { throw "The normal runtime alias is not an exact unweighted version." }
    if ($name -ceq "profile_readiness_durable_alias_arn") {
      if (($aliasArn -replace ':development$', (":" + $alias.FunctionVersion)) -cne [string](Get-StateOutput $Snapshot "profile_readiness_durable_version_arn")) { throw "The durable version differs from Terraform." }
    } else {
      $ownedAliasName = $name -creplace '_lambda_alias_arn$', '' -creplace '_alias_arn$', ''
      $ownedAlias = Get-RetirementStateResource $Snapshot "aws_lambda_alias" $ownedAliasName
      if ($ownedAlias.arn -cne $aliasArn -or $ownedAlias.function_version -cne $alias.FunctionVersion -or $ownedAlias.function_name -cne $functionName) { throw "The normal runtime alias differs from Terraform." }
    }
    $configuration = Invoke-AwsJson -Arguments @("lambda","get-function-configuration","--function-name",$functionName,"--qualifier",$alias.FunctionVersion,"--output","json") -Operation "Normal runtime readback"
    if ($configuration.FunctionArn -cne ($aliasArn -replace ':development$', (":" + $alias.FunctionVersion)) -or $configuration.Version -cne $alias.FunctionVersion -or $configuration.State -cne "Active" -or $configuration.CodeSha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw "The normal runtime identity is invalid." }
    $observations += [ordered]@{ name=$name; alias=$alias; configuration=$configuration }
  }
  foreach ($name in @("coordinator","starter","terminal","activity")) {
    $owned = if ($name -ceq "activity") { Get-RetirementStateResource $Snapshot "aws_lambda_function" "ingestion_activity" } else { Get-RetirementStateResource $Snapshot "aws_lambda_function" "ingestion_runtime" $name }
    $variables = $owned.environment[0].variables
    if ($variables.INGESTION_SYNTHETIC_SOURCE_ENABLED -cne "false" -or $variables.INGESTION_PROVIDER_ACTIVATION_ALLOWED -cne "false" -or $variables.INGESTION_PROVIDER_SOURCES -cne "[]") { throw "Source ingestion must remain disabled." }
    foreach ($qualifier in @([string]$owned.version, '$LATEST')) {
      $arguments = @("lambda","get-function-configuration","--function-name",[string]$owned.function_name,"--output","json")
      if ($qualifier -cne '$LATEST') { $arguments += @("--qualifier",$qualifier) }
      $actual = Invoke-AwsJson -Arguments $arguments -Operation "Disabled ingestion configuration"
      $baseArn = "arn:aws:lambda:" + $Region + ":" + $ExpectedAccountId + ":function:" + $owned.function_name
      $expectedArn = if ($qualifier -ceq '$LATEST') { $baseArn } else { $baseArn + ":" + $qualifier }
      if ($actual.FunctionArn -cne $expectedArn -or $actual.Version -cne $qualifier -or $actual.CodeSha256 -cne $owned.source_code_hash -or (ConvertTo-DeploymentCanonicalValue $actual.Environment.Variables) -cne (ConvertTo-DeploymentCanonicalValue $variables)) { throw "Disabled ingestion configuration differs from Terraform." }
      $observations += [ordered]@{ name=$name; qualifier=$qualifier; configuration=$actual }
    }
  }
  $rule = Get-RetirementStateResource $Snapshot "aws_cloudwatch_event_rule" "ingestion_schedule"
  $actualRule = Invoke-AwsJson -Arguments @("events","describe-rule","--name",[string]$rule.name,"--output","json") -Operation "Disabled ingestion schedule"
  $mapping = Get-RetirementStateResource $Snapshot "aws_lambda_event_source_mapping" "ingestion_dispatch"
  $actualMapping = Invoke-AwsJson -Arguments @("lambda","get-event-source-mapping","--uuid",[string]$mapping.uuid,"--output","json") -Operation "Disabled ingestion mapping"
  if ($rule.state -cne "DISABLED" -or $actualRule.Arn -cne $rule.arn -or $actualRule.State -cne "DISABLED" -or $mapping.enabled -isnot [bool] -or $mapping.enabled -or $actualMapping.UUID -cne $mapping.uuid -or $actualMapping.State -cne "Disabled" -or $actualMapping.FunctionArn -cne $mapping.function_name -or $actualMapping.EventSourceArn -cne $mapping.event_source_arn) { throw "Source ingestion triggers must remain disabled." }
  $observations += [ordered]@{ rule=$actualRule; mapping=$actualMapping }
  return Get-TextSha256 (ConvertTo-DeploymentCanonicalValue $observations)
}
function Read-RetirementRuntime {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][string]$Image)
  $cluster = [string](Get-StateOutput $Snapshot "ecs_cluster_arn")
  $owned = Get-RetirementStateResource $Snapshot "aws_ecs_task_definition" "migration"
  $taskArn = [string](Get-StateOutput $Snapshot "migration_task_definition_arn")
  $subnets = @((Get-StateOutput $Snapshot "migration_subnet_ids") | Sort-Object)
  $group = [string](Get-StateOutput $Snapshot "application_security_group_id")
  $vpc = [string](Get-StateOutput $Snapshot "vpc_id")
  if ($cluster -cne ("arn:aws:ecs:" + $Region + ":" + $ExpectedAccountId + ":cluster/ai-job-apply-development") -or $taskArn -cne $owned.arn -or $subnets.Count -ne 2 -or @($subnets | Select-Object -Unique).Count -ne 2 -or @($subnets | Where-Object { $_ -cnotmatch '^subnet-[a-f0-9]+$' }).Count -ne 0 -or $group -cnotmatch '^sg-[a-f0-9]+$') { throw "The exact state-owned migration runtime is unavailable." }
  $response = Invoke-AwsJson -Arguments @("ecs","describe-task-definition","--task-definition",$taskArn,"--include","TAGS","--output","json") -Operation "Original migration definition"
  $registration = New-RetirementRegistration -Response $response -OwnedTask $owned -Image $Image
  $network = Invoke-AwsJson -Arguments (@("ec2","describe-subnets","--subnet-ids") + $subnets + @("--output","json")) -Operation "Migration subnet readback"
  $security = Invoke-AwsJson -Arguments @("ec2","describe-security-groups","--group-ids",$group,"--output","json") -Operation "Migration security group readback"
  if (@($network.Subnets).Count -ne 2 -or (@($network.Subnets.SubnetId | Sort-Object) -join "|") -cne ($subnets -join "|") -or @($network.Subnets | Where-Object { $_.VpcId -cne $vpc -or $_.OwnerId -cne $ExpectedAccountId }).Count -ne 0 -or @($security.SecurityGroups).Count -ne 1 -or $security.SecurityGroups[0].GroupId -cne $group -or $security.SecurityGroups[0].VpcId -cne $vpc -or $security.SecurityGroups[0].OwnerId -cne $ExpectedAccountId) { throw "The exact migration network changed." }
  $database = Invoke-AwsJson -Arguments @("rds","describe-db-instances","--db-instance-identifier","ai-job-apply-development","--output","json") -Operation "Development database safety"
  $ownedDatabase = Get-RetirementStateResource $Snapshot "aws_db_instance" "postgres"
  if (@($database.DBInstances).Count -ne 1 -or $database.DBInstances[0].DBInstanceArn -cne $ownedDatabase.arn -or $database.DBInstances[0].DBInstanceStatus -cne "available" -or $database.DBInstances[0].StorageEncrypted -ne $true -or $database.DBInstances[0].DeletionProtection -ne $true -or [int]$database.DBInstances[0].BackupRetentionPeriod -lt 7 -or $null -eq $database.DBInstances[0].LatestRestorableTime) { throw "The development database safety boundary is unavailable." }
  return [pscustomobject]@{ clusterArn=$cluster; originalTaskDefinitionArn=$taskArn; subnets=$subnets; securityGroup=$group; registration=$registration; ownedTask=$owned }
}


function New-RetirementTaskRequest {
  param([Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][string]$TemporaryArn, [Parameter(Mandatory)][ValidateSet("inspect","retire")][string]$Operation, [Parameter(Mandatory)][string]$RunId, [string]$Manifest = "")
  if ($RunId -cnotmatch '^[a-f0-9]{32}$' -or ($Operation -ceq "retire" -and $Manifest -cnotmatch '^[a-f0-9]{64}$') -or ($Operation -ceq "inspect" -and $Manifest -cne "")) { throw "The fixed retirement request inputs are invalid." }
  $values = @(
    [ordered]@{ name="SYNTHETIC_CATALOG_RETIREMENT_ENVIRONMENT"; value="development" },
    [ordered]@{ name="SYNTHETIC_CATALOG_RETIREMENT_CONFIRMATION"; value=$confirmation },
    [ordered]@{ name="SYNTHETIC_CATALOG_RETIREMENT_ACTION"; value=$Operation }
  )
  if ($Operation -ceq "retire") { $values += [ordered]@{ name="SYNTHETIC_CATALOG_RETIREMENT_EXPECTED_MANIFEST_SHA256"; value=$Manifest } }
  return [ordered]@{
    cluster=$Runtime.clusterArn; taskDefinition=$TemporaryArn; count=1; launchType="FARGATE"; platformVersion="1.4.0"; enableExecuteCommand=$false
    networkConfiguration=[ordered]@{ awsvpcConfiguration=[ordered]@{ subnets=@($Runtime.subnets); securityGroups=@($Runtime.securityGroup); assignPublicIp="DISABLED" } }
    overrides=[ordered]@{ containerOverrides=@([ordered]@{ name=$containerName; command=@($retirementCommand); environment=$values }) }
    clientToken="synthetic-retirement-$RunId"; startedBy="synthetic-retirement-$($RunId.Substring(0,12))"
  }
}
function Assert-RetirementResult {
  param([Parameter(Mandatory)][object]$Result, [Parameter(Mandatory)][ValidateSet("inspect","retire")][string]$Operation, [string]$Manifest = "")
  $null = Assert-ExactPropertySet $Result @("schemaVersion","action","namespace","manifestSha256","matchingJobs","matchingSources","retirableJobs","alreadyHiddenJobs","retiredJobs","appendedStatusEvents","otherActiveAuthorizedFixtureJobs") "The retirement result"
  if (($Result.schemaVersion -isnot [int] -and $Result.schemaVersion -isnot [long]) -or $Result.schemaVersion -ne 1 -or $Result.action -cne $Operation -or $Result.namespace -cne "synthetic-foundation-v1" -or $Result.manifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or ($Operation -ceq "retire" -and $Result.manifestSha256 -cne $Manifest)) { throw "The retirement result binding is invalid." }
  foreach ($name in @("matchingJobs","matchingSources","retirableJobs","alreadyHiddenJobs","retiredJobs","appendedStatusEvents","otherActiveAuthorizedFixtureJobs")) {
    $value = $Result.PSObject.Properties[$name].Value
    $maximum = if ($name -ceq "otherActiveAuthorizedFixtureJobs") { [long]9007199254740991 } else { 100 }
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -lt 0 -or $value -gt $maximum) { throw "The retirement result counts are invalid." }
  }
  $expectedRetired = if ($Operation -ceq "retire") { $Result.retirableJobs } else { 0 }
  if ($Result.retirableJobs + $Result.alreadyHiddenJobs -ne $Result.matchingJobs -or $Result.matchingSources -ne $Result.matchingJobs -or $Result.retiredJobs -ne $expectedRetired -or $Result.appendedStatusEvents -ne $expectedRetired) { throw "The retirement result counts are inconsistent." }
  return $true
}
function Get-RetirementStateIdentity {
  param([Parameter(Mandatory)][object]$Snapshot)
  return [ordered]@{ lineage=$Snapshot.Lineage; serial=$Snapshot.Serial; versionId=$Snapshot.VersionId }
}
function Assert-RetirementContext {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][string]$ApplicationSha256)
  $null = Assert-ExactPropertySet $Context @("schemaVersion","kind","environment","region","accountId","sourceSha","migrationReceiptSha256","imageUri","manifestSha256","action","runId","startedAt","stateIdentity","applicationSha256","runtime","registrationSha256","temporaryTaskDefinitionArn","request","taskArn","phase","result","temporaryRevisionDeregistered") "The retirement context"
  $runtimeBinding = [ordered]@{ clusterArn=$Runtime.clusterArn; originalTaskDefinitionArn=$Runtime.originalTaskDefinitionArn; subnets=@($Runtime.subnets); securityGroup=$Runtime.securityGroup }
  $temporaryPattern = "^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task-definition/" + [regex]::Escape($migrationFamily) + ":[1-9][0-9]*$"
  $taskPattern = "^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task/ai-job-apply-development/[a-f0-9]{32}$"
  if (($Context.schemaVersion -isnot [int] -and $Context.schemaVersion -isnot [long]) -or $Context.schemaVersion -ne 1 -or $Context.kind -cne "development-synthetic-catalog-retirement" -or $Context.environment -cne "development" -or $Context.region -cne $Region -or $Context.accountId -cne $ExpectedAccountId -or $Context.sourceSha -cne $SourceSha -or $Context.migrationReceiptSha256 -cne $ReviewedMigrationReceiptSha256 -or $Context.imageUri -cne $Receipt.imageUri -or $Context.action -cnotin @("inspect","retire") -or $Context.runId -cnotmatch '^[a-f0-9]{32}$' -or -not (Test-CanonicalUtcTimestamp $Context.startedAt) -or (ConvertTo-DeploymentCanonicalValue $Context.stateIdentity) -cne (ConvertTo-DeploymentCanonicalValue (Get-RetirementStateIdentity $Snapshot)) -or (ConvertTo-DeploymentCanonicalValue $Context.runtime) -cne (ConvertTo-DeploymentCanonicalValue $runtimeBinding) -or $Context.applicationSha256 -cne $ApplicationSha256 -or $Context.registrationSha256 -cne (Get-TextSha256 (ConvertTo-DeploymentCanonicalValue $Runtime.registration)) -or $Context.phase -cnotin @("registering","registered","submitting","running","stopped","complete") -or $Context.temporaryRevisionDeregistered -isnot [bool]) { throw "The retirement context no longer binds the exact source, image, state and runtime." }
  if (($Context.action -ceq "inspect" -and $Context.manifestSha256 -cne "") -or ($Context.action -ceq "retire" -and $Context.manifestSha256 -cnotmatch '^[a-f0-9]{64}$')) { throw "The retirement context manifest is invalid." }
  if ($Context.phase -ceq "registering") {
    if ($Context.temporaryTaskDefinitionArn -cne "" -or $Context.taskArn -cne "" -or $null -ne $Context.request -or $null -ne $Context.result -or $Context.temporaryRevisionDeregistered) { throw "The registration context is inconsistent." }
    return
  }
  if ($Context.temporaryTaskDefinitionArn -cnotmatch $temporaryPattern -or $Context.temporaryTaskDefinitionArn -ceq $Runtime.originalTaskDefinitionArn) { throw "The context does not identify one distinct temporary revision." }
  $request = New-RetirementTaskRequest $Runtime $Context.temporaryTaskDefinitionArn $Context.action $Context.runId $Context.manifestSha256
  if ((ConvertTo-DeploymentCanonicalValue $request) -cne (ConvertTo-DeploymentCanonicalValue $Context.request)) { throw "The fixed retirement task request changed." }
  if ($Context.phase -in @("registered","submitting") -and $Context.taskArn -cne "") { throw "The context predates task identification." }
  if ($Context.phase -in @("running","stopped","complete") -and $Context.taskArn -cnotmatch $taskPattern) { throw "The exact submitted task identity is missing." }
  if ($null -ne $Context.result) { $null = Assert-RetirementResult $Context.result $Context.action $Context.manifestSha256 }
  if ($Context.phase -ceq "complete" -and ($null -eq $Context.result -or -not $Context.temporaryRevisionDeregistered)) { throw "The completed context does not prove result and cleanup." }
}
function Invoke-RetirementJsonRequest {
  param([Parameter(Mandatory)][ValidateSet("register-task-definition","run-task")][string]$Operation, [Parameter(Mandatory)][object]$Request, [Parameter(Mandatory)][string]$RunId)
  $path = Join-Path $operatorRoot "$RunId-$Operation.json"
  Write-RetirementJson -Path $path -Value $Request
  # AWS_MAX_ATTEMPTS=1 is installed by the entrypoint; ambiguous writes are never replayed.
  return Invoke-AwsJson -Arguments @("ecs",$Operation,"--cli-input-json","file://$path","--output","json") -Operation "Temporary task submission"
}
function Read-RetirementTask {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][object]$Receipt)
  $response = Invoke-AwsJson -Arguments @("ecs","describe-tasks","--cluster",$Context.runtime.clusterArn,"--tasks",$Context.taskArn,"--output","json") -Operation "Exact retirement task readback"
  if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne 1) { throw "The submitted retirement task cannot be identified exactly." }
  $task = $response.tasks[0]
  $overrides = ConvertFrom-RetirementJson -Json ($task.overrides | ConvertTo-Json -Depth 40 -Compress) -Description "Retirement task overrides"
  $inference = $overrides.PSObject.Properties["inferenceAcceleratorOverrides"]
  if ($null -ne $inference) {
    if ($inference.Value -isnot [array] -or $inference.Value.Count -ne 0) { throw "Unexpected accelerator override." }
    $overrides.PSObject.Properties.Remove("inferenceAcceleratorOverrides")
  }
  foreach ($containerOverride in @($overrides.containerOverrides)) {
    $resources = $containerOverride.PSObject.Properties["resourceRequirements"]
    if ($null -ne $resources) {
      if ($resources.Value -isnot [array] -or $resources.Value.Count -ne 0) { throw "Unexpected task resource override." }
      $containerOverride.PSObject.Properties.Remove("resourceRequirements")
    }
  }
  if ($task.taskArn -cne $Context.taskArn -or $task.clusterArn -cne $Context.runtime.clusterArn -or $task.taskDefinitionArn -cne $Context.temporaryTaskDefinitionArn -or $task.launchType -cne "FARGATE" -or $task.platformVersion -cne "1.4.0" -or $task.startedBy -cne $Context.request.startedBy -or $task.enableExecuteCommand -ne $false -or @($task.containers).Count -ne 1 -or $task.containers[0].name -cne $containerName -or (ConvertTo-DeploymentCanonicalValue $overrides) -cne (ConvertTo-DeploymentCanonicalValue $Context.request.overrides)) { throw "The submitted task differs from the exact reviewed request." }
  if ($task.lastStatus -ceq "STOPPED" -and ($task.containers[0].image -cne $Receipt.imageUri -or $task.containers[0].imageDigest -cne $Receipt.platformDigest)) { throw "The task did not execute the exact verified image digest." }
  return $task
}
function Read-RetirementTaskResult {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][object]$Receipt)
  $task = Read-RetirementTask $Context $Receipt
  if ($task.lastStatus -cne "STOPPED" -or ($task.containers[0].exitCode -isnot [int] -and $task.containers[0].exitCode -isnot [long]) -or $task.containers[0].exitCode -ne 0) { throw "The retirement task did not stop successfully." }
  $stream = "database-migration/database-migration/" + ($Context.taskArn -split '/')[-1]
  $messages = @(); $token = ""; $complete = $false
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $arguments = @("logs","get-log-events","--log-group-name",$applicationLogGroup,"--log-stream-name",$stream,"--start-from-head","--limit","10","--output","json")
    if ($token -cne "") { $arguments += @("--next-token",$token) }
    $logs = Invoke-AwsJson -Arguments $arguments -Operation "Bounded retirement result read"
    foreach ($event in @($logs.events)) {
      if ($event.message -isnot [string] -or $event.message.Length -gt 4096) { throw "The retirement log record is invalid." }
      $messages += $event.message
    }
    if ($messages.Count -gt 1 -or $logs.nextForwardToken -isnot [string] -or $logs.nextForwardToken -ceq "") { throw "The task did not emit one bounded aggregate result." }
    if ($token -cne "" -and $token -ceq $logs.nextForwardToken -and $messages.Count -eq 1) { $complete = $true; break }
    $token = [string]$logs.nextForwardToken
    Start-Sleep -Seconds 2
  }
  if (-not $complete -or $messages.Count -ne 1) { throw "The task aggregate result is unavailable; do not rerun the task." }
  $result = ConvertFrom-RetirementJson -Json $messages[0] -Description "The retirement aggregate result"
  $null = Assert-RetirementResult $result $Context.action $Context.manifestSha256
  return $result
}
function Remove-RetirementRevision {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object]$Receipt)
  if ($Context.phase -cnotin @("registered","stopped","complete")) { throw "An unresolved task may still use the temporary revision; do not deregister it." }
  if ($Context.phase -cne "registered") {
    $task = Read-RetirementTask $Context $Receipt
    if ($task.lastStatus -cne "STOPPED") { throw "The temporary task has not stopped." }
  }
  $response = Invoke-AwsJson -Arguments @("ecs","describe-task-definition","--task-definition",$Context.temporaryTaskDefinitionArn,"--include","TAGS","--output","json") -Operation "Temporary revision readback"
  $definition = $response.taskDefinition
  if ($definition.taskDefinitionArn -cne $Context.temporaryTaskDefinitionArn -or $definition.taskDefinitionArn -ceq $Runtime.originalTaskDefinitionArn -or $definition.status -cnotin @("ACTIVE","INACTIVE")) { throw "The temporary revision identity changed." }
  $copy = ConvertFrom-RetirementJson -Json ($response | ConvertTo-Json -Depth 50 -Compress) -Description "Temporary revision semantic check"
  $copy.taskDefinition.status = "ACTIVE"
  $actual = New-RetirementRegistration -Response $copy -OwnedTask $Runtime.ownedTask -Image $Receipt.imageUri -Temporary
  if ((ConvertTo-DeploymentCanonicalValue $actual) -cne (ConvertTo-DeploymentCanonicalValue $Runtime.registration)) { throw "The temporary revision is not the exact image-only clone." }
  if ($definition.status -ceq "ACTIVE") {
    $removed = Invoke-AwsJson -Arguments @("ecs","deregister-task-definition","--task-definition",$Context.temporaryTaskDefinitionArn,"--output","json") -Operation "Exact temporary revision deregistration"
    if ($removed.taskDefinition.taskDefinitionArn -cne $Context.temporaryTaskDefinitionArn -or $removed.taskDefinition.status -cne "INACTIVE") { throw "Temporary revision deregistration is unresolved." }
  }
  $Context.temporaryRevisionDeregistered = $true
}


function Assert-RetirementUnchanged {
  param([Parameter(Mandatory)][object]$Snapshot, [Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object]$Receipt, [Parameter(Mandatory)][string]$ApplicationSha256, [string]$AllowedTaskArn = "")
  Assert-RetirementSource
  $current = Read-StateSnapshot
  if ((ConvertTo-DeploymentCanonicalValue (Get-RetirementStateIdentity $current)) -cne (ConvertTo-DeploymentCanonicalValue (Get-RetirementStateIdentity $Snapshot))) { throw "Terraform state changed during the operation." }
  $definition = Invoke-AwsJson -Arguments @("ecs","describe-task-definition","--task-definition",$Runtime.originalTaskDefinitionArn,"--include","TAGS","--output","json") -Operation "Original migration revision preservation"
  $registration = New-RetirementRegistration -Response $definition -OwnedTask $Runtime.ownedTask -Image $Receipt.imageUri
  if ((ConvertTo-DeploymentCanonicalValue $registration) -cne (ConvertTo-DeploymentCanonicalValue $Runtime.registration) -or (Read-RetirementApplicationBoundary $current) -cne $ApplicationSha256) { throw "The original migration definition or normal runtime changed." }
  Assert-RetirementIdle -ClusterArn $Runtime.clusterArn -AllowedTaskArn $AllowedTaskArn
}
function Assert-RetirementReservation {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][string]$ContextPath)
  if ($Context.action -cne "retire") { return }
  $path = Join-Path $operatorRoot ("retire-" + $Context.manifestSha256 + ".json")
  $reservation = Read-RetirementJson -Path $path -Sha256 (Get-FileSha256 $path) -Root $operatorRoot
  $null = Assert-ExactPropertySet $reservation @("schemaVersion","manifestSha256","runId","contextPath","sourceSha","inspectionReceiptSha256") "The one-shot retirement reservation"
  if (($reservation.schemaVersion -isnot [int] -and $reservation.schemaVersion -isnot [long]) -or $reservation.schemaVersion -ne 1 -or $reservation.manifestSha256 -cne $Context.manifestSha256 -or $reservation.runId -cne $Context.runId -or $reservation.contextPath -cne $ContextPath -or $reservation.sourceSha -cne $SourceSha -or $reservation.inspectionReceiptSha256 -cnotmatch '^[a-f0-9]{64}$') { throw "The original retirement reservation does not identify this exact context." }
}
function Find-RetirementSubmittedTask {
  param([Parameter(Mandatory)][object]$Context)
  if ($Context.phase -cne "submitting" -or $Context.taskArn -cne "") { throw "Only an unresolved submitted task can be discovered." }
  $candidates = @()
  foreach ($status in @("RUNNING","STOPPED")) {
    $response = Invoke-AwsJson -Arguments @("ecs","list-tasks","--cluster",$Context.runtime.clusterArn,"--family",$migrationFamily,"--desired-status",$status,"--max-items","101","--output","json") -Operation "Exact submission recovery"
    if ($null -ne (Get-OptionalProperty $response "NextToken") -or @($response.taskArns).Count -gt 100) { throw "The exact recovery inventory exceeds its bound." }
    $candidates += @($response.taskArns)
  }
  $candidates = @($candidates | Sort-Object -Unique)
  if ($candidates.Count -eq 0 -or $candidates.Count -gt 100) { throw "The original submitted task is unresolved; never resubmit." }
  $response = Invoke-AwsJson -Arguments (@("ecs","describe-tasks","--cluster",$Context.runtime.clusterArn,"--tasks") + $candidates + @("--output","json")) -Operation "Exact recovery task identities"
  if (@($response.failures).Count -ne 0 -or @($response.tasks).Count -ne $candidates.Count) { throw "Recovery task enumeration is incomplete." }
  $matches = @($response.tasks | Where-Object { $_.startedBy -ceq $Context.request.startedBy })
  if ($matches.Count -ne 1 -or $matches[0].taskArn -cnotmatch ("^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task/ai-job-apply-development/[a-f0-9]{32}$")) { throw "The original submitted task is unresolved; never resubmit or deregister by family." }
  $candidates = @([string]$matches[0].taskArn)
  $Context.taskArn = [string]$candidates[0]; $Context.phase = "running"
}
function Complete-RetirementTask {
  param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][string]$ContextPath, [Parameter(Mandatory)][object]$Runtime, [Parameter(Mandatory)][object]$Receipt)
  $script:failureStage="task-result"
  if ($Context.phase -ceq "registering") { throw "Task registration was ambiguous; preserve the context for exact revision reconciliation." }
  if ($Context.phase -ceq "registered") {
    $script:failureStage="cleanup"
    Remove-RetirementRevision $Context $Runtime $Receipt
    Write-RetirementJson -Path $ContextPath -Value $Context -Replace
    throw "The unused temporary revision was deregistered; no task was submitted."
  }
  if ($Context.phase -ceq "submitting") {
    Find-RetirementSubmittedTask $Context
    Write-RetirementJson -Path $ContextPath -Value $Context -Replace
  }
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(10)
  while ($true) {
    $task = Read-RetirementTask $Context $Receipt
    if ($task.lastStatus -ceq "STOPPED") { break }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "The task is still unresolved; retain the context and use Recover, never resubmit." }
    Assert-RetirementIdle -ClusterArn $Runtime.clusterArn -AllowedTaskArn $Context.taskArn
    Start-Sleep -Seconds 5
  }
  $Context.phase = "stopped"
  Write-RetirementJson -Path $ContextPath -Value $Context -Replace
  try {
    $Context.result = Read-RetirementTaskResult $Context $Receipt
    Write-RetirementJson -Path $ContextPath -Value $Context -Replace
  } finally {
    # Deregistration is allowed only after an independent exact task read confirms STOPPED.
    $script:failureStage="cleanup"
    Remove-RetirementRevision $Context $Runtime $Receipt
    Write-RetirementJson -Path $ContextPath -Value $Context -Replace
    $script:failureStage="task-result"
  }
}
Assert-RetirementInputs
$environmentNames = @("AWS_PROFILE","AWS_REGION","AWS_DEFAULT_REGION","AWS_PAGER","AWS_MAX_ATTEMPTS","TF_DATA_DIR")
$savedEnvironment = @{}
foreach ($name in $environmentNames) {
  $savedEnvironment[$name] = @{ present=(Test-Path -LiteralPath "Env:$name"); value=[Environment]::GetEnvironmentVariable($name,"Process") }
}
$context = $null; $contextPath = ""
$script:failureStage="source"
try {
  $env:AWS_PROFILE=$AwsProfile; $env:AWS_REGION=$Region; $env:AWS_DEFAULT_REGION=$Region; $env:AWS_PAGER=""; $env:AWS_MAX_ATTEMPTS="1"
  Assert-RetirementSource
  Initialize-RetirementDirectory
  $caller = Invoke-AwsJson -Arguments @("sts","get-caller-identity","--output","json") -Operation "Development caller check"
  if ($caller.Account -cne $ExpectedAccountId -or $caller.Arn -cnotmatch ("^arn:aws:sts::" + $ExpectedAccountId + ":assumed-role/[A-Za-z0-9+=,.@_/-]+$")) { throw "The exact development assumed-role caller is required." }
  $script:failureStage="image"
  $receipt = Invoke-RetirementImageVerification
  $script:failureStage="state"
  $snapshot = Read-StateSnapshot
  $script:failureStage="runtime"
  $runtime = Read-RetirementRuntime -Snapshot $snapshot -Image $receipt.imageUri
  $applicationSha256 = Read-RetirementApplicationBoundary $snapshot
  if ($Action -ceq "Recover") {
    $script:failureStage="inspect-binding"
    $contextPath = Resolve-PathBelowRoot -Candidate $RecoveryContextPath -AllowedRoot $operatorRoot -MustExist
    $context = Read-RetirementJson -Path $contextPath -Sha256 $ReviewedRecoveryContextSha256 -Root $operatorRoot
    Assert-RetirementContext $context $snapshot $runtime $receipt $applicationSha256
    if ($contextPath -cne (Join-Path $operatorRoot ("context-" + $context.runId + ".json"))) { throw "Recovery must use the original fixed context path." }
    Assert-RetirementReservation $context $contextPath
    if ($context.phase -cne "submitting") { Assert-RetirementIdle -ClusterArn $runtime.clusterArn -AllowedTaskArn $context.taskArn }
    Complete-RetirementTask $context $contextPath $runtime $receipt
  } else {
    Assert-RetirementIdle -ClusterArn $runtime.clusterArn
    if ($Action -ceq "Retire") {
      $script:failureStage="inspect-binding"
      $inspectionPath = Resolve-PathBelowRoot -Candidate $InspectionReceiptPath -AllowedRoot $operatorRoot -MustExist
      $inspection = Read-RetirementJson -Path $inspectionPath -Sha256 $ReviewedInspectionReceiptSha256 -Root $operatorRoot
      Assert-RetirementContext $inspection $snapshot $runtime $receipt $applicationSha256
      if ($inspection.action -cne "inspect" -or $inspection.phase -cne "complete" -or $inspection.result.manifestSha256 -cne $ExpectedManifestSha256 -or $inspectionPath -cne (Join-Path $operatorRoot ("context-" + $inspection.runId + ".json"))) { throw "Retire requires the exact completed inspection and expected preimage." }
      # A caller-supplied JSON/hash is not authority: independently re-read the actual stopped task and aggregate.
      $actualInspection = Read-RetirementTaskResult $inspection $receipt
      if ((ConvertTo-DeploymentCanonicalValue $actualInspection) -cne (ConvertTo-DeploymentCanonicalValue $inspection.result)) { throw "The actual inspection task result does not match its reviewed receipt." }
      Remove-RetirementRevision $inspection $runtime $receipt
    }
    $runId = [guid]::NewGuid().ToString("N")
    $contextPath = Join-Path $operatorRoot "context-$runId.json"
    $operation = $Action.ToLowerInvariant()
    $context = [pscustomobject][ordered]@{
      schemaVersion=1; kind="development-synthetic-catalog-retirement"; environment="development"; region=$Region; accountId=$ExpectedAccountId
      sourceSha=$SourceSha; migrationReceiptSha256=$ReviewedMigrationReceiptSha256; imageUri=$receipt.imageUri
      manifestSha256=$ExpectedManifestSha256; action=$operation; runId=$runId; startedAt=[DateTimeOffset]::UtcNow.ToString("o")
      stateIdentity=(Get-RetirementStateIdentity $snapshot); applicationSha256=$applicationSha256
      runtime=[ordered]@{ clusterArn=$runtime.clusterArn; originalTaskDefinitionArn=$runtime.originalTaskDefinitionArn; subnets=@($runtime.subnets); securityGroup=$runtime.securityGroup }
      registrationSha256=(Get-TextSha256 (ConvertTo-DeploymentCanonicalValue $runtime.registration))
      temporaryTaskDefinitionArn=""; request=$null; taskArn=""; phase="registering"; result=$null; temporaryRevisionDeregistered=$false
    }
    Write-RetirementJson -Path $contextPath -Value $context
    if ($Action -ceq "Retire") {
      Write-RetirementJson -Path (Join-Path $operatorRoot "retire-$ExpectedManifestSha256.json") -Value ([ordered]@{ schemaVersion=1; manifestSha256=$ExpectedManifestSha256; runId=$runId; contextPath=$contextPath; sourceSha=$SourceSha; inspectionReceiptSha256=$ReviewedInspectionReceiptSha256 })
    }
    Assert-RetirementUnchanged $snapshot $runtime $receipt $applicationSha256
    $script:failureStage="register"
    $registered = Invoke-RetirementJsonRequest -Operation "register-task-definition" -Request $runtime.registration -RunId $runId
    $temporaryArn = [string]$registered.taskDefinition.taskDefinitionArn
    if ($temporaryArn -cnotmatch ("^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task-definition/" + [regex]::Escape($migrationFamily) + ":[1-9][0-9]*$") -or $temporaryArn -ceq $runtime.originalTaskDefinitionArn) { throw "The newly registered revision is unresolved." }
    $context.temporaryTaskDefinitionArn=$temporaryArn
    $context.request=New-RetirementTaskRequest $runtime $temporaryArn $operation $runId $ExpectedManifestSha256
    $context.phase="registered"
    Write-RetirementJson -Path $contextPath -Value $context -Replace
    $readback = Invoke-AwsJson -Arguments @("ecs","describe-task-definition","--task-definition",$temporaryArn,"--include","TAGS","--output","json") -Operation "Image-only temporary revision verification"
    $actual = New-RetirementRegistration -Response $readback -OwnedTask $runtime.ownedTask -Image $receipt.imageUri -Temporary
    if ((ConvertTo-DeploymentCanonicalValue $actual) -cne (ConvertTo-DeploymentCanonicalValue $runtime.registration)) { throw "The temporary revision differs from the exact image-only clone." }
    Assert-RetirementUnchanged $snapshot $runtime $receipt $applicationSha256
    $script:failureStage="submit"
    $context.phase="submitting"; Write-RetirementJson -Path $contextPath -Value $context -Replace
    $submitted = Invoke-RetirementJsonRequest -Operation "run-task" -Request $context.request -RunId $runId
    if (@($submitted.failures).Count -ne 0 -or @($submitted.tasks).Count -ne 1 -or $submitted.tasks[0].taskArn -cnotmatch ("^arn:aws:ecs:" + [regex]::Escape($Region) + ":" + $ExpectedAccountId + ":task/ai-job-apply-development/[a-f0-9]{32}$")) { throw "Task submission is unresolved; do not resubmit." }
    $context.taskArn=[string]$submitted.tasks[0].taskArn; $context.phase="running"
    Write-RetirementJson -Path $contextPath -Value $context -Replace
    Complete-RetirementTask $context $contextPath $runtime $receipt
  }
  $script:failureStage="postcheck"
  Assert-RetirementUnchanged $snapshot $runtime $receipt $applicationSha256
  $context.phase="complete"; Write-RetirementJson -Path $contextPath -Value $context -Replace
  [pscustomobject]@{ Outcome="complete"; Action=$context.action; SourceSha=$SourceSha; ContextPath=$contextPath; ContextSha256=(Get-FileSha256 $contextPath); Result=$context.result; TemporaryRevisionDeregistered=$true; OriginalMigrationRevisionUnchanged=$true; NormalRuntimeUnchanged=$true; EcsIdle=$true }
} catch {
  $hash = if ($contextPath -cne "" -and (Test-Path -LiteralPath $contextPath -PathType Leaf)) { Get-FileSha256 $contextPath } else { "" }
  [pscustomobject]@{ Outcome="refused_or_unresolved"; FailureStage=$script:failureStage; ContextPath=$contextPath; ContextSha256=$hash; AutomaticResubmissionAllowed=$false }
  exit 1
} finally {
  foreach ($name in $environmentNames) {
    if ($savedEnvironment[$name].present) { [Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name].value,"Process") }
    else { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
  }
}
