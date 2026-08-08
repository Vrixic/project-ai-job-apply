$ErrorActionPreference = "Stop"

docker compose config --quiet
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose configuration validation failed with exit code $LASTEXITCODE."
}

docker compose up -d --wait --wait-timeout 180 postgres redis otel-collector
if ($LASTEXITCODE -ne 0) {
  throw "Local dependencies failed to become ready with exit code $LASTEXITCODE. Run 'docker compose ps -a' and 'docker compose logs <service>' for details."
}

docker compose ps
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read local dependency status; docker compose ps exited with code $LASTEXITCODE."
}

Write-Host "Local dependencies are running and ready."
Write-Host "Run: pnpm --filter @ai-job-apply/profile-service build"
Write-Host "Then: pnpm --filter @ai-job-apply/profile-service db:migrate"
Write-Host "The workflow workspace runs the Lambda durable local adapter; no local Temporal service is required."
Write-Host "A real OIDC issuer is required to start the gateway outside tests."
