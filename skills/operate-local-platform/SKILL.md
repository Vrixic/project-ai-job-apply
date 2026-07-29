---
name: operate-local-platform
description: Set up, run, verify, and troubleshoot the AI job application platform locally. Use for dependency installation, environment configuration, Docker Compose services, PostgreSQL migrations, contract generation, development servers, test/build commands, local health checks, or diagnosing local gateway, web, database, Redis, Temporal, and telemetry failures.
---

# Operate the Local Platform

## Inspect before running

Read `../../README.md`, `../../scripts/README.md`, `../../.env.example`,
`../../compose.yaml`, and the README/package file for the affected workspace. Preserve an existing
`.env`; never print secrets or copy them into logs.

Check Node 24, pnpm 10, Docker Compose, and available ports. The local PostgreSQL host port is
defined by Compose; do not assume the PostgreSQL default port.

## Start the foundation

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm contracts:generate
.\scripts\start-local.ps1
pnpm --filter @ai-job-apply/profile-service build
pnpm --filter @ai-job-apply/profile-service db:migrate
pnpm dev
```

Do not claim the full authenticated slice is ready unless valid OIDC settings exist. Test signers
are restricted to `NODE_ENV=test`.

## Verify at the right depth

- Fast source checks: `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`.
- Package tests: `pnpm test`.
- Production compilation: `pnpm build`.
- Complete repository-side Phase 0 check: `.\scripts\verify-phase0.ps1`.
- Real profile persistence: start PostgreSQL and run:

```powershell
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/profile-service test:integration
```

Regenerate contracts before validating generated output. Do not hand-edit
`../../packages/api-contracts/generated/`.

## Diagnose safely

1. Run `docker compose config --quiet`, then `docker compose ps`.
2. Inspect only the affected service logs with `docker compose logs <service>`.
3. Check dependency readiness before changing code.
4. Reproduce with the narrowest package test.
5. Confirm environment parsing in `../../packages/config/`.
6. Escalate from package checks to the complete verification script.

Do not delete volumes, databases, caches, or lockfiles as a diagnostic shortcut. Obtain explicit
authorization for material data removal and identify the exact target first. Stop services with
`docker compose stop`; retain volumes unless removal is requested.

## Report evidence

State the command, pass/fail result, skipped external dependencies, and whether evidence was local
or deployed. A passing build is not deployment evidence.
