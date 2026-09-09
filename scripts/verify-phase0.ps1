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
Invoke-CheckedCommand "Development document dark guard validation" { & scripts/tests/development-document-dark-guards.tests.ps1 }
Invoke-CheckedCommand "Development document dark operator validation" { & scripts/tests/development-document-dark-operator.tests.ps1 }
Invoke-CheckedCommand "Development document migration operator path validation" { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/development-document-migration-operator.tests.ps1 }
Invoke-CheckedCommand "Admin Auth0 authorization profile setup" { & scripts/tests/configure-auth0-admin-local.tests.ps1 }
Invoke-CheckedCommand "Formatting" { pnpm format:check }
Invoke-CheckedCommand "Lint" { pnpm lint }
Invoke-CheckedCommand "Type checking" { pnpm typecheck }
Invoke-CheckedCommand "Dependency security regressions" { pnpm test:dependency-security }
Invoke-CheckedCommand "Tests" { pnpm test }
Invoke-CheckedCommand "Build" { pnpm build }
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
