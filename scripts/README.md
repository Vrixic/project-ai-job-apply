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
- `prepare-terraform-bootstrap.ps1` — Creates an isolated, local-backend Terraform workspace for
  the first bootstrap of a development or staging AWS account without reusing another
  environment's backend metadata or state.
- `verify-phase0.ps1` — Regenerates contracts and runs repository quality, build, Compose, and
  removed-scope checks.
- `verify-auth0-tenant.mjs` — Performs read-only exact-issuer, authorization-code, PKCE, RS256,
  and JWKS checks against a managed OIDC tenant without reading client secrets or tokens.
- `configure-auth0-local.ps1` — Securely prompts for the development web client secret, generates
  the session-cookie encryption secret, and writes only gitignored local environment files.
- `configure-auth0-public-clients.ps1` — Writes ignored public Auth0 Native Application settings
  for the Expo and extension conformance shells and prints the exact mobile callback URLs. Use
  `-MobileOnly` or `-ExtensionOnly` to configure either client independently.
- `start-deployed-web-conformance.ps1` — Validates development or synthetic-staging AWS,
  Terraform, exact live/local Auth0 alignment, ECS stability, and gateway health; resolves the
  deployed HTTPS gateway without printing it; and runs only the local web/BFF for authenticated
  deployed conformance. Select staging with `-Environment staging`; add the explicit
  `-EnableWorkloadConformance` switch only for the reviewed fixed staging workload.
- `inspect-staging-workload-and-cost.ps1` — Reports the read-only staging workload/cost baseline
  and corroborates a completed browser workload window with aggregate API Gateway, ECS, RDS,
  queue, alarm, log, and no-drift measurements.
- `inspect-phase0-cost.ps1` — Reads actual service-attributed Cost Explorer totals plus budget and
  legacy CUR counts from both isolated Phase 0 accounts without printing account/provider records.
- `operate-platform-alerts.ps1` — Reports sanitized development or staging alert state, privately
  requests an SNS email subscription, and exercises ALARM → OK delivery using only the selected
  environment's dedicated synthetic metric. Select staging with `-Environment staging`.
- `operate-staging-application-recovery.ps1` — Reports the sanitized staging runtime state,
  performs an explicitly authorized worker-then-gateway rolling restart, and creates/applies
  separately checksum-gated application-only disable and enable plans. Sensitive reconstruction
  context and plans remain ignored under the staging Terraform data directory. Its read-only
  `NoDrift` action reconstructs exact live application inputs for other staging recovery gates.
- `operate-staging-postgresql-restore.ps1` — Reports the sanitized staging PITR baseline and runs
  a resumable, uniquely tagged restore through source verification, availability measurement,
  exact aggregate comparison, guarded target/backup deletion, and final application/no-drift
  acceptance. Only the ignored staging Terraform data directory holds resumable context.
- `preview-development-alert-plan.ps1` — Reconstructs the exact live development runtime inputs,
  produces a refresh-backed preview, rejects changes outside the reviewed alert scope, and removes
  the sensitive plan after printing only a sanitized summary and SHA-256.
- `verify-development-tracing.ps1` — Performs read-only aggregate checks of the deployed collector,
  X-Ray permissions, complete gateway/outbox/activity trace, and forbidden-field absence.
- `exercise-development-log-delivery.ps1` — Reports sanitized heartbeat state and performs or
  recovers the exact development-only gateway `PutLogEvents` interruption drill.
- `node backend/workflows/cloud-conformance.mjs` — Verifies the development AWS
  Secrets Manager destination and performs a read-only Temporal Cloud namespace request without
  printing the runtime key or environment identifiers.
- `validate-skills.mjs` — Validates repository skill structure, trigger metadata, UI metadata,
  routing, catalog coverage, and removal of scaffold placeholders.
