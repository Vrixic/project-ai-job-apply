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
- `operate-development-workflow-lambda-publication.ps1` — Provides the fail-closed local
  development publisher for the exact current-source workflow ingress, profile-readiness durable,
  and profile-readiness activity artifacts. It tests and builds twice, refuses any existing key or
  delete marker, publishes twelve conditional/versioned/customer-KMS-bound ZIP/evidence objects,
  verifies exact-version readback, and writes a checksum-reviewed ignored receipt without changing
  a Lambda, alias, trigger, Terraform state, or database. See
  `infrastructure/runbooks/deployments/development-workflow-lambda-publication.md`.
- `operate-development-ingestion-lambda-publication.ps1` — Reproducibly publishes and
  exact-version verifies only the ingestion durable and runtime artifact sets below the dedicated
  `lambda/ingestion` boundary. It writes no Lambda, alias, trigger, Terraform, database, or
  provider state. See
  `infrastructure/runbooks/deployments/development-ingestion-lambda-publication.md`.
- `operate-development-ingestion-dark-release.ps1` — Plans, applies, and verifies only the
  checksum-reviewed ingestion durable/runtime artifact update while preserving disabled sources,
  provider authority, private egress, schedules, and queue mapping. Verification requires exact
  numeric unweighted versions, empty queues, idle ECS, no NAT, and fresh zero drift. See
  `infrastructure/runbooks/providers/synthetic-ingestion-dark-release.md`.
- `operate-development-public-job-lambda-publication.ps1` — Publishes and exact-version verifies
  the separate anonymous edge and private projection artifacts from clean, exact merged source.
  It cannot deploy a function, move an alias, enable the anonymous routes or indexing, apply
  Terraform, or run a migration. See
  `infrastructure/runbooks/deployments/development-public-job-lambda-publication.md`.
- `build-document-lambdas.mjs` — Builds separate deterministic document coordinator and isolated
  parser artifacts, manifests, and CycloneDX SBOMs; the parser artifact has no database runtime.
- `publish-development-document-lambdas.ps1` — Provides the fail-closed local development fallback
  for an exhausted GitHub Actions budget: it tests and reproducibly builds both document Lambda
  artifacts, publishes eight new conditional/versioned/KMS-bound objects, verifies exact checksums
  and metadata, and emits a checksum-reviewed ignored receipt without deploying either Lambda.
- `publish-development-migration-image.ps1` — Provides the corresponding fail-closed development
  fallback for the migration-only container. Its cloud-independent `LocalBuild` action proves two
  source-bound `linux/amd64` builds have identical configuration and rootfs identities and passes a
  hardened runtime smoke. Publication separately resolves the Terraform-owned immutable KMS ECR
  repository, publishes the exact commit tag, requires a completed zero-High/zero-Critical scan,
  and emits a checksum-reviewed ignored receipt without changing Terraform or executing a migration. See
  `infrastructure/runbooks/deployments/development-migration-image-publication.md`.
- `operate-development-gateway-release.ps1` — Provides the source- and checksum-bound local gateway
  publication fallback plus exact Terraform plan/apply/verify flow. It preserves every non-gateway
  input, limits a release to the gateway Lambda function and immutable alias, and runs the direct
  authenticated search boundary. See
  `infrastructure/runbooks/deployments/development-gateway-release.md`.

Artifacts are normally published by the protected GitHub workflows; the development-only local
publishers preserve the same immutable boundary when that route is unavailable. The migration-only container is built
from `Dockerfile.migration` and runs the fail-fast profile/jobs/documents/matching migration
orchestrator. Its source package also includes the strict restore-verifier CLI and canonical
manifest; source inclusion does not claim image publication, task-definition deployment,
migration execution, or AWS restore execution. No gateway or general worker image exists.

## Deployed verification and evidence

- `operate-d1-representative-acceptance.ps1` — Validates a checksum-reviewed, aggregate-only D1
  representative-assurance packet with explicit thresholds and recipients. It composes already
  produced workload, provider-failure, alert-delivery, and zero-drift aggregates and never performs
  the fixture mutation itself. See
  `infrastructure/runbooks/observability/d1-representative-deployed-acceptance.md`.
- `operate-development-d1-provider-failure-acceptance.ps1` — Plans, runs, resumes, and verifies
  exactly one IAM-invoked generated-synthetic fail-once/recover execution through the deployed
  numeric ingestion durable/activity versions while every scheduler, provider, NAT, queue mapping,
  and normal synthetic-source gate remains off. See
  `infrastructure/runbooks/observability/development-d1-provider-failure-acceptance.md`.
- `operate-development-candidate-rights-acceptance.ps1` — Plans, executes, recovers, and verifies
  one generated-synthetic candidate export/deletion lifecycle only after exact policy, backup,
  Auth0, identity, runtime, and zero-drift prerequisites pass. See
  `infrastructure/runbooks/deployments/development-candidate-rights-acceptance.md`.

- `start-deployed-web-conformance.ps1` — Validates the selected steady-state API Gateway/Lambda
  runtime, Auth0 alignment, durable triggers, empty ECS application boundary, and `200/200/401`,
  then starts only the local web BFF against that deployed API.
- `verify-gateway-lambda-boundary.ps1` — Runs the direct immutable-alias request/identity boundary
  matrix for development or staging, including strict `POST /v1/jobs/search`
  `200/401/403/400/413/415/404` cases, nested JSON response-shape validation, and query-string
  non-reflection without printing candidate query values; the environment wrappers select the
  account. Deployed stale-cursor `409` acceptance remains a separate guarded synthetic procedure.
- `inspect-deployed-outbox.ps1` — Performs bounded aggregate inspection of pending durable outbox
  work without retaining identifiers or candidate values.
- `inspect-development-workload-and-cost.ps1` and `inspect-staging-workload-and-cost.ps1` — Inspect
  accepted workload windows through serverless metrics, queues, alarms, logs, and drift.
- `start-deployed-web-conformance.ps1 -EnableD1WorkloadConformance` — Exposes the opt-in local
  `/d1-conformance` surface after exact AWS/Auth0/API Gateway validation. Its fixed read profile
  retains aggregate timings and counts only; see the D1 workload runbook.
- `inspect-phase0-cost.ps1` — Reconciles one selected environment or both accounts' budgets, CUR
  2.0 delivery, and account-scoped aggregate costs; its `LINKED_ACCOUNT` filter prevents an AWS
  Organizations payer from silently including member-account spend. Its explicit dormant-staging
  mode verifies one completed UTC day has zero RDS instance-hours and VPC endpoint-hours.
- `operate-platform-alerts.ps1` — Exercises environment-scoped synthetic alert delivery.
- `operate-staging-postgresql-restore.ps1` — Runs the guarded, resumable, single-writer staging
  PITR exercise with strict source/target/runtime identity and aggregate-only evidence. The local
  guard suite is source-only and makes no AWS execution or RTO/RPO claim.
- `operate-staging-runtime-lifecycle.ps1` — Creates and applies checksum-reviewed, two-step
  staging activation/quiescence/dormancy plans while retaining the isolated control plane.
- `operate-development-document-migration.ps1` — Reconstructs development Terraform inputs from
  the exact retained ParserDark/CompleteDark zero-change plan and adjacent checksum-bound sidecar,
  plans/applies only an immutable migration task-definition replacement, and executes one
  checksum-reviewed no-override Fargate migration with aggregate-log, zero-task, encrypted-state,
  and zero-drift postconditions.
- `operate-development-document-processing-acceptance.ps1` — Runs a checksum-reviewed,
  generated-synthetic direct-dark acceptance lifecycle against exact gateway, processor, and
  numeric parser identities while mapping, GuardDuty rule, and reconciler stay disabled. It uses
  durable claims, exact-version upload/cleanup, aggregate-only receipts, and a bounded recovery
  path. Its separate `Corpus*` actions run only the fixed 43-case generated adversarial corpus
  against the exact numeric dark processor/parser path and retain reason-code counts only. Direct
  authorizer context is a test harness and does not prove API Gateway routing,
  JWT/JWKS validation, or authorizer enforcement.
  See
  `infrastructure/runbooks/deployments/development-document-processing-acceptance.md`.

## Repository and infrastructure policy

- `prepare-terraform-bootstrap.ps1` — Prepares the exact isolated AWS bootstrap boundary.
- `operate-bootstrap-workload-boundary.ps1` — Produces, checksum-gates, applies, and independently
  verifies the one-statement document-role bootstrap boundary change. See
  `docs/security/bootstrap-workload-boundary-runbook.md`.
- `operate-development-document-dark-deployment.ps1` — Reconstructs exact current inputs from a
  checksum-reviewed zero-change baseline, consumes a checksum-reviewed immutable publication
  receipt, and advances KMS, parser-dark, and complete-dark stages one at a time with processing
  triggers disabled, bounded security-health alerts active, and plans bound to the exact state
  lineage/serial and parser version. Its read-only `Verify` action retains a checksum-bound,
  nonapplyable zero-change baseline and metadata sidecar for the next guarded migration release. See
  `infrastructure/runbooks/deployments/development-document-dark-deployment.md`.
- `validate-serverless-workflow-infrastructure.mjs` — Enforces the steady-state Lambda durable,
  migration-only container, and retired-path absence policies.
- `audit-dependencies.mjs` — Applies the centralized lockfile audit policy and exact expiring
  exceptions.
- `validate-skills.mjs` — Validates repository-local agent skills.
- `verify-phase0.ps1` — Runs the complete repository-side Phase 0 verification sequence.

Use Terraform `1.9.8`, temporary IAM Identity Center credentials, environment-specific encrypted
state, immutable artifacts, refresh-backed saved plans, and explicit checksum approval for every
material cloud change. Never replay historical cutover commands or reconstruct a retired runtime.
