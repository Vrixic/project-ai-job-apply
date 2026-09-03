$ErrorActionPreference="Stop";$root=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$paths=@("scripts\operate-development-d2-community-artifact.ps1","scripts\verify-development-d2-community-dark.ps1","scripts\plan-development-d2-community-recovery.ps1")
foreach($relative in $paths){$path=Join-Path $root $relative;$tokens=$null;$errors=$null;$source=Get-Content $path -Raw;$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if(@($errors).Count){throw "$relative does not parse"}}
$publication=Get-Content (Join-Path $root $paths[0]) -Raw
foreach($required in @("get-bucket-encryption","artifactBase64Sha256","ChecksumSHA256","--if-none-match","*","--checksum-mode","ENABLED","build:lambda:d2-community","LambdaDeploymentChanged=`$false","TriggerChanged=`$false","development-d2-community-artifact-publication")){if(-not $publication.Contains($required)){throw "Publisher missing $required"}}
if($publication -match '(?im)^function\s+Aws\b'){throw "Publisher AWS helper would recursively shadow aws.exe"}
if(-not $publication.Contains('function Invoke-AwsJson') -or -not $publication.Contains('& aws.exe @Arguments')){throw "Publisher must invoke aws.exe through the non-shadowing JSON helper"}
if(-not $publication.Contains('@(git -C $root status --porcelain).Count')){throw "Publisher clean-tree check must remain strict-mode safe"}
$dark=Get-Content (Join-Path $root $paths[1]) -Raw
foreach($forbidden in @("update-function-code","update-alias","put-rule","create-event-source-mapping","terraform apply")){if($dark.IndexOf($forbidden,[StringComparison]::OrdinalIgnoreCase)-ge 0){throw "Dark verifier contains mutation $forbidden"}}
foreach($required in @('extension/contribution-capability-policy','saved-job-captures','profile/ugc-contribution-consents','jobs/contributions','admin/trust','-chdir=$environment')){if(-not $dark.Contains($required)){throw "Dark verifier misses $required"}}
$plan=Get-Content (Join-Path $root $paths[2]) -Raw
if(-not $plan.Contains('MutationPerformed=$false') -or -not $plan.Contains('PreserveDark=$true')){throw "Recovery planning is not explicitly non-mutating"}
$policyOperator=Join-Path $root "scripts\operate-development-d2-contribution-policy.mjs"
$policySource=Get-Content -LiteralPath $policyOperator -Raw
foreach($required in @('generateKeyPairSync("ed25519")','private-key.pem','server-public-keys.json','extension-public-keys.json','contributionCapabilityPolicyDigestInput','verifySignedContributionCapabilityPolicy','CONFIRM-D2-DEVELOPMENT-POLICY-ACTIVATION','existingMaterialReplaced: false')){if(-not $policySource.Contains($required)){throw "Policy operator misses $required"}}
foreach($forbidden in @('console.log(private','process.stdout.write(private','PRIVATE KEY-----`n${')){if($policySource.Contains($forbidden)){throw "Policy operator may print private key material"}}
Write-Host "Development D2 community operator source guards passed."
