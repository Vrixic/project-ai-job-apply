$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
  param(
    [string]$Name,
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

Invoke-CheckedCommand "Contract generation" { pnpm contracts:generate }
Invoke-CheckedCommand "Repository skill validation" { pnpm skills:validate }
Invoke-CheckedCommand "Serverless workflow infrastructure policy validation" { node scripts/validate-serverless-workflow-infrastructure.mjs }
Invoke-CheckedCommand "Portable Terraform and locked-backend operator validation" { pnpm test:terraform-toolchain }
Invoke-CheckedCommand "Deployment operator guard validation" { & scripts/tests/deployment-operator-guards.tests.ps1 }
Invoke-CheckedCommand "Isolated deletion restore contract/operator validation" { pnpm test:deletion-restore }
Invoke-CheckedCommand "Coordinated D2 maintenance and runtime release validation" { pnpm test:d2-runtime-release }
Invoke-CheckedCommand "Scoped D2 provider configuration validation" { pnpm test:d2-provider-configuration }
Invoke-CheckedCommand "Generated synthetic catalog retirement operator validation" { pnpm test:synthetic-catalog-retirement }
Invoke-CheckedCommand "Candidate rights prerequisites and export validation" { pnpm test:candidate-rights-acceptance }
Invoke-CheckedCommand "D2 complete-description client/intake compatibility" { pnpm test:d2-contribution-intake }
Invoke-CheckedCommand "D2 immutable artifact source binding" { pnpm test:d2-artifact-source }
Invoke-CheckedCommand "Development document dark guard validation" { & scripts/tests/development-document-dark-guards.tests.ps1 }
Invoke-CheckedCommand "Development document dark operator validation" { & scripts/tests/development-document-dark-operator.tests.ps1 }
Invoke-CheckedCommand "Development document migration operator path validation" { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/development-document-migration-operator.tests.ps1 }
Invoke-CheckedCommand "Admin Auth0 authorization profile setup" { & scripts/tests/configure-auth0-admin-local.tests.ps1 }
Invoke-CheckedCommand "Formatting" { pnpm format:check }
Invoke-CheckedCommand "Private Documents artifact publication guards" { & scripts/tests/development-document-artifact-publisher.tests.ps1 }
Invoke-CheckedCommand "Lint" { pnpm lint }
Invoke-CheckedCommand "Type checking" { pnpm typecheck }
Invoke-CheckedCommand "Dependency security regressions" { pnpm test:dependency-security }
Invoke-CheckedCommand "Tests" { pnpm test }
Invoke-CheckedCommand "Build" { pnpm build }
Invoke-CheckedCommand "Isolated provider bundle dependency isolation" { node --test scripts/tests/isolated-provider-bundle.test.mjs }
Invoke-CheckedCommand "Response maintenance bundle dependency isolation" { node --test scripts/tests/response-maintenance-bundle.test.mjs }
Invoke-CheckedCommand "Private preparation port model isolation" { node --test scripts/tests/private-preparation-port-bundle.test.mjs }
Invoke-CheckedCommand "Preparation durable orchestration isolation" { node --test scripts/tests/preparation-durable-bundle.test.mjs }
Invoke-CheckedCommand "Preparation starter actor isolation" { node --test scripts/tests/preparation-starter-bundle.test.mjs }
Invoke-CheckedCommand "Preparation recovery actor isolation" { node --test scripts/tests/preparation-recovery-bundle.test.mjs }
Invoke-CheckedCommand "Cover-letter export read isolation" { node --test scripts/tests/cover-letter-export-bundle.test.mjs }
Invoke-CheckedCommand "Native task retirement control isolation" { node --test scripts/tests/native-task-retirement-bundle.test.mjs }
Invoke-CheckedCommand "Native launch control composition isolation" { node --test scripts/tests/native-launch-control-bundle.test.mjs }
Invoke-CheckedCommand "Compose validation" { docker compose config --quiet }

$legacy = rg -n -i `
  "email\.job_status_detected|EmailObservation|recruiter_screen|→ interviewing|→ offer" `
  --glob "*.md" --glob "*.ts" --glob "*.json" --glob "!.git/**" .
if ($LASTEXITCODE -eq 0) {
  throw "Removed product-scope references remain:`n$legacy"
}
if ($LASTEXITCODE -gt 1) {
  throw "Scope validation failed with exit code $LASTEXITCODE"
}

Write-Host "Phase 0 repository verification passed."
exit 0
