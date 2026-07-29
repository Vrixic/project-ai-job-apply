$ErrorActionPreference = "Stop"

pnpm contracts:generate
pnpm skills:validate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet

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
