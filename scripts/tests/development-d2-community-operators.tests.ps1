$ErrorActionPreference="Stop";$root=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$paths=@("scripts\operate-development-d2-community-artifact.ps1","scripts\verify-development-d2-community-dark.ps1","scripts\plan-development-d2-community-recovery.ps1")
foreach($relative in $paths){$path=Join-Path $root $relative;$tokens=$null;$errors=$null;$source=Get-Content $path -Raw;$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if(@($errors).Count){throw "$relative does not parse"}}
$publication=Get-Content (Join-Path $root $paths[0]) -Raw
foreach($required in @("get-bucket-encryption","artifactBase64Sha256","ChecksumSHA256","--if-none-match","*","--checksum-mode","ENABLED","build:lambda:d2-community","LambdaDeploymentChanged=`$false","TriggerChanged=`$false","development-d2-community-artifact-publication")){if(-not $publication.Contains($required)){throw "Publisher missing $required"}}
$dark=Get-Content (Join-Path $root $paths[1]) -Raw
foreach($forbidden in @("update-function-code","update-alias","put-rule","create-event-source-mapping","terraform apply")){if($dark.IndexOf($forbidden,[StringComparison]::OrdinalIgnoreCase)-ge 0){throw "Dark verifier contains mutation $forbidden"}}
foreach($required in @('contribution-capability-policy','private/job-captures','profile/contribution-consents','jobs/contributions','trust/reviewer','-chdir=$environment')){if(-not $dark.Contains($required)){throw "Dark verifier misses $required"}}
$plan=Get-Content (Join-Path $root $paths[2]) -Raw
if(-not $plan.Contains('MutationPerformed=$false') -or -not $plan.Contains('PreserveDark=$true')){throw "Recovery planning is not explicitly non-mutating"}
Write-Host "Development D2 community operator source guards passed."
