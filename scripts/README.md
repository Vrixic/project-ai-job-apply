# Repository Scripts

Scripts provide guarded local setup, artifact construction, deployed verification, restore,
observability, and policy validation. Historical cutover/provider operators were removed after
both AWS environments accepted the steady-state serverless runtime.

## Local setup and identity

- `start-local.ps1` — Starts PostgreSQL, Redis, and the OpenTelemetry collector. Workflow execution
  uses the local Lambda durable adapter; no external workflow service is required.
- `configure-auth0-local.ps1` — Writes ignored local Auth0 web settings with compatibility-safe
  session-secret generation.
- `configure-auth0-public-clients.ps1` — Configures the reviewed public-client boundaries.
- `verify-auth0-tenant.mjs` — Validates managed OIDC discovery and signing configuration without
  exposing credentials.

## Immutable artifact construction

- `build-gateway-lambda.mjs` — Builds the gateway Lambda artifact and provenance manifest.
- `build-workflow-ingress-lambda.mjs` — Builds the outbox-ingress Lambda artifact.
- `build-profile-readiness-lambdas.mjs` — Builds durable definition, activity, and terminal
  artifacts with exact-version metadata.

Artifacts are published by the protected GitHub workflows. The migration-only container is built
from `Dockerfile.migration`; no gateway or general worker image exists.

## Deployed verification and evidence

- `start-deployed-web-conformance.ps1` — Validates the selected steady-state API Gateway/Lambda
  runtime, Auth0 alignment, durable triggers, empty ECS application boundary, and `200/200/401`,
  then starts only the local web BFF against that deployed API.
- `verify-gateway-lambda-boundary.ps1` — Runs the direct immutable-alias request/identity boundary
  matrix for development or staging; the environment wrappers select the account.
- `inspect-deployed-outbox.ps1` — Performs bounded aggregate inspection of pending durable outbox
  work without retaining identifiers or candidate values.
- `inspect-development-workload-and-cost.ps1` and `inspect-staging-workload-and-cost.ps1` — Inspect
  accepted workload windows through serverless metrics, queues, alarms, logs, and drift.
- `inspect-phase0-cost.ps1` — Reconciles one selected environment or both accounts' budgets, CUR
  2.0 delivery, and account-scoped aggregate costs; its `LINKED_ACCOUNT` filter prevents an AWS
  Organizations payer from silently including member-account spend.
- `operate-platform-alerts.ps1` — Exercises environment-scoped synthetic alert delivery.
- `operate-staging-postgresql-restore.ps1` — Runs the guarded, resumable staging PITR exercise.
- `operate-staging-runtime-lifecycle.ps1` — Creates and applies checksum-reviewed, two-step
  staging activation/quiescence/dormancy plans while retaining the isolated control plane.

## Repository and infrastructure policy

- `prepare-terraform-bootstrap.ps1` — Prepares the exact isolated AWS bootstrap boundary.
- `validate-serverless-workflow-infrastructure.mjs` — Enforces the steady-state Lambda durable,
  migration-only container, and retired-path absence policies.
- `audit-dependencies.mjs` — Applies the centralized lockfile audit policy and exact expiring
  exceptions.
- `validate-skills.mjs` — Validates repository-local agent skills.
- `verify-phase0.ps1` — Runs the complete repository-side Phase 0 verification sequence.

Use Terraform `1.9.8`, temporary IAM Identity Center credentials, environment-specific encrypted
state, immutable artifacts, refresh-backed saved plans, and explicit checksum approval for every
material cloud change. Never replay historical cutover commands or reconstruct a retired runtime.
