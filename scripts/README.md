# Repository Scripts

Contains reviewed automation for local setup, code generation, validation, fixtures, migrations, and release checks.

## Planned subfolders

- `setup/` — Idempotent developer-environment setup and checks.
- `codegen/` — API, event, database, and client generation.
- `fixtures/` — Sanitization, validation, and fixture maintenance.
- `database/` — Migration, seed, and safe reconciliation helpers.
- `quality/` — Cross-repository lint, test, dependency, and policy checks.
- `release/` — Versioning, artifact, migration, and rollout verification.

Scripts should be non-interactive where practical, support `--help` and dry-run for risky operations, and never embed secrets or production identifiers.

## Phase 0 commands

- `start-local.ps1` — Starts PostgreSQL, Redis, Temporal, Temporal UI, and the local OTel collector.
- `verify-phase0.ps1` — Regenerates contracts and runs repository quality, build, Compose, and
  removed-scope checks.
- `verify-auth0-tenant.mjs` — Performs read-only exact-issuer, authorization-code, PKCE, RS256,
  and JWKS checks against a managed OIDC tenant without reading client secrets or tokens.
- `configure-auth0-local.ps1` — Securely prompts for the development web client secret, generates
  the session-cookie encryption secret, and writes only gitignored local environment files.
- `configure-auth0-public-clients.ps1` — Writes ignored public Auth0 Native Application settings
  for the Expo and extension conformance shells and prints the exact mobile callback URLs. Use
  `-MobileOnly` or `-ExtensionOnly` to configure either client independently.
- `start-deployed-web-conformance.ps1` — Validates the development AWS/Auth0 prerequisites,
  resolves the deployed HTTPS gateway from encrypted Terraform state without printing it, and
  runs only the local web/BFF for authenticated deployed conformance.
- `operate-development-alerts.ps1` — Reports sanitized alert state, privately requests an SNS email
  subscription, and exercises ALARM → OK delivery using only a dedicated synthetic metric.
- `preview-development-alert-plan.ps1` — Reconstructs the exact live development runtime inputs,
  produces a refresh-backed preview, rejects changes outside the reviewed alert scope, and removes
  the sensitive plan after printing only a sanitized summary and SHA-256.
- `verify-development-tracing.ps1` — Performs read-only aggregate checks of the deployed collector,
  X-Ray permissions, complete gateway/outbox/activity trace, and forbidden-field absence.
- `pnpm --filter @ai-job-apply/workflows cloud:verify` — Verifies the development AWS
  Secrets Manager destination and performs a read-only Temporal Cloud namespace request without
  printing the runtime key or environment identifiers.
- `validate-skills.mjs` — Validates repository skill structure, trigger metadata, UI metadata,
  routing, catalog coverage, and removal of scaffold placeholders.
