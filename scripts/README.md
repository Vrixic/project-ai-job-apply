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
- `configure-auth0-admin-local.ps1` — Configures the separate MFA admin client. Use
  `-AuthorizationProfile appeals` for the human appeal-only login; the default `standard` profile
  preserves existing console behavior. Profile selection requests scopes but grants no server role.
- `verify-auth0-tenant.mjs` — Validates managed OIDC discovery and signing configuration without
  exposing credentials.

The root `pnpm test:integration` command deliberately runs package suites one at a time. Several
database-owner suites exercise fail-closed migration verification by temporarily introducing and
then restoring schema drift, so parallel package execution against the shared local PostgreSQL
database is unsafe.

The composed D2 cancellation and Trust-to-Jobs suites require separate disposable, loopback-only
PostgreSQL clusters via `D2_CANCELLATION_DATABASE_URL` and `D2_COMPOSED_DATABASE_URL`. They create
and remove only uniquely generated test databases. Do not point either variable at a cluster whose
other test database is already migrated: the public-reader migration verifier intentionally checks
cluster-wide database grants. Missing opt-ins are reported as skipped, not passing evidence.

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
  hardened runtime smoke against the exact six-owner, ten-schema, 68-relation, 41-migration Phase 2
  manifest, including the Trust runner and checksum-bound migration files. Publication separately
  resolves the Terraform-owned immutable KMS ECR
  repository, publishes the exact commit tag, requires a completed zero-High/zero-Critical scan,
  and emits a checksum-reviewed ignored receipt without changing Terraform or executing a migration. See
  `infrastructure/runbooks/deployments/development-migration-image-publication.md`.
- `operate-development-gateway-release.ps1` — Provides the source- and checksum-bound local gateway
  publication fallback plus exact Terraform plan/apply/verify flow. It preserves every non-gateway
  input, limits a release to the gateway Lambda function and immutable alias, and runs the direct
  authenticated search boundary. See
  `infrastructure/runbooks/deployments/development-gateway-release.md`.

Artifacts are normally published by the protected GitHub workflows; the development-only local
publishers preserve the same immutable boundary when that route is unavailable. The migration-only
container is built from `Dockerfile.migration` and runs the fail-fast
profile/jobs/documents/matching/billing/trust migration orchestrator. Its source package also
includes the strict restore-verifier CLI and canonical manifest; source inclusion does not claim
deployed Trust candidate-rights behavior, image publication, task-definition deployment,
migration execution, or AWS restore execution. No gateway or general worker image exists.

## Deployed verification and evidence

- `run-development-d2-public-boundary.mjs` — Verifies bounded unauthenticated contribution
  denials against the exact regional development API origin. The default signed mode also
  validates 20 paced signed-policy contract reads. Explicit `--capability-mode development`
  performs zero policy requests and still executes the 20 unauthenticated POST probes, with
  only `401` or managed `429` accepted. Its separate aggregate profile marks policy checks
  skipped and authenticated throughput unverified; it does not claim successful intake,
  processing, publication, or signed-policy health. Both modes require
  `--confirm run-d2-development-public-boundary-v1` and `--origin` with the exact API origin.
  Invalid modes and duplicate/unknown arguments are rejected. Mocked tests:
  `pnpm test:d2-public-boundary`.
- `run-development-d2-authenticated-intake.mjs` — Runs one explicitly approved disposable
  contribution, with aggregate-only output and exact-run cleanup. The paused-intake profile
  requires processing disabled and checks owner reads/replay/conflict/cancellation. The separate
  active-processing profile waits for independent verification and an owner Trust review case,
  then performs exact-version owner withdrawal from the observed pending-review case and checks
  its terminal disposition. A copied withdrawal suffices only after this run successfully withdrew
  that exact pending-review version; earlier ambiguous withdrawals require actual removal evidence
  or explicit scoped recovery. Accepted/published cases are not silently rebased into cleanup.
  Primary consent cleanup shares the cancellation revocation key; each ambiguous revocation gets
  at most one identical retry within the original deadline. It is bounded to
  one contribution, one concurrent request, 192 requests, ten-second polling, and twenty minutes,
  allowing the existing five-minute scheduler to complete normal processing/removal ticks.
  It does not decide cases or prove moderation, publication, or throughput capacity. Import its
  exported confirmation/actions/digest helpers to prepare the exact privately approved scope;
  execute with no arguments and the process-local `D2_AUTHENTICATED_INTAKE_CONFIRMATION`,
  `D2_AUTHENTICATED_INTAKE_SCOPE_JSON`, and `D2_AUTHENTICATED_INTAKE_ACCESS_TOKEN`. Never paste the
  token or scope into chat, command arguments, retained logs, or Turbo inputs. The account
  identity digest, source/preview, and workload time window must match the approval exactly.
  Existing schema-version-1 scopes also bind the signed policy and public keys. For the active
  processing profile only, schema version 2 uses `capabilityMode: "development"` instead of
  `signedPolicySha256` and `publicKeys`; it makes no policy request and is restricted to client
  `0.2.0`, Greenhouse `greenhouse-board-v1`, and the two accepted Greenhouse hosts. The deployed
  server must independently enable development contributions. This removes the policy preflight,
  not authentication, exact disposable-workload scope, cancellation, withdrawal, or cleanup.
  If `recoveryRequired` is true, retain the same private scope/run identity; inspect and recover
  it without creating another contribution or silently rebasing a Trust version. Mocked tests:
  `pnpm test:d2-authenticated-intake`. No live profile runs as part of repository verification.
- `operate-development-d2-provider-recovery.ps1` — Inspects at most 25 provider-held
  contribution queue items through the exact reviewed immutable development function. It returns
  only fixed reason counts and an opaque snapshot fingerprint. `Retry` requires that unchanged
  fingerprint plus `RETRY-REVIEWED-PROVIDER-VERIFICATION`, and requeues only temporary provider
  unavailability or observation mismatch. Closed jobs, probable duplicates, Trust holds, payloads,
  and catalog truth are unchanged; ordinary processing rechecks every gate. The command requires
  the expected account and reviewed Lambda code checksum and rejects weighted aliases, wrong
  artifacts, malformed results, and stale snapshots. No public route or job identifier is exposed.
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
- `operate-development-d2-contribution-policy.mjs` — Generates non-overwriting Ed25519 development
  key material, signs a bounded default-dark contribution capability policy with the Jobs-owned
  canonical digest, and independently verifies the current envelope. All private material and
  receipts remain below the ignored development `.terraform` directory; enabling any policy
  dimension requires a separate exact activation-authority token.
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
- `audit-dependencies.mjs` — Audits the complete lockfile and verifies the exact local
  `image-size@1.2.1` remediation: patch, lock binding, installed package bytes, and mobile-only
  dependency paths. No vulnerability exception or expiry renewal is used. Unexpected advisories
  and registry/tool failures remain blocking.
- `pnpm test:dependency-security` — Runs bounded parser regressions and applied-remediation audit
  tests. Included in `pnpm check` and `verify-phase0.ps1`.
- `validate-skills.mjs` — Validates repository-local agent skills.
- `verify-phase0.ps1` — Runs the complete repository-side Phase 0 verification sequence.

Use Terraform `1.9.8`, temporary IAM Identity Center credentials, environment-specific encrypted
state, immutable artifacts, refresh-backed saved plans, and explicit checksum approval for every
material cloud change. Never replay historical cutover commands or reconstruct a retired runtime.
