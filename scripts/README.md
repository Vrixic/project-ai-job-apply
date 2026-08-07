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
- `build-gateway-lambda.mjs` — Bundles the emitted gateway Lambda code, preserves Nest metadata,
  creates a fixed-metadata ZIP, and emits SHA-256, manifest, and CycloneDX 1.6 SBOM evidence under
  the ignored gateway `dist/lambda/` directory.
- `build-workflow-ingress-lambda.mjs` — Reproducibly bundles the identifier-only SQS starter and
  scheduled outbox reconciler handlers into one immutable ZIP with manifest, checksum, and SBOM.
- `build-profile-readiness-lambdas.mjs` — Reproducibly bundles the versioned Lambda durable
  profile-readiness orchestrator and its private activity/terminal handlers into separate immutable
  ZIPs with manifests, checksums, and SBOMs.
- `.github/workflows/publish-workflow-lambdas.yml` — Rebuilds all three workflow Lambda artifacts
  twice, proves exact-source bundle/manifest attestation, byte reproducibility, and CycloneDX
  evidence, then publishes immutable versioned objects through GitHub OIDC without deploying
  functions or enabling triggers.
- `lib/build-lambda-artifact.mjs` — Shared deterministic Node.js 24 ZIP, checksum, manifest, and
  CycloneDX builder used by the workflow Lambda release scripts. Protected publication embeds the
  exact lowercase source commit in the bundle and manifest; local builds use an explicit `local`
  marker instead of claiming committed provenance.
- `prepare-terraform-bootstrap.ps1` — Creates an isolated, local-backend Terraform workspace for
  the first bootstrap of a development or staging AWS account without reusing another
  environment's backend metadata or state.
- `verify-phase0.ps1` — Regenerates contracts and runs repository quality, build, Compose, and
  removed-scope checks.
- `validate-serverless-workflow-infrastructure.mjs` — Enforces the dark-by-default durable
  workflow, immutable activity target, checkpoint KMS, replay-retention, terminal recovery,
  least-privilege permission, and environment-composition boundaries without contacting AWS.
- `verify-auth0-tenant.mjs` — Performs read-only exact-issuer, authorization-code, PKCE, RS256,
  and JWKS checks against a managed OIDC tenant without reading client secrets or tokens.
- `configure-auth0-local.ps1` — Securely prompts for the development web client secret, generates
  the session-cookie encryption secret, and writes only gitignored local environment files.
- `configure-auth0-public-clients.ps1` — Writes ignored public Auth0 Native Application settings
  for the Expo and extension conformance shells and prints the exact mobile callback URLs. Use
  `-MobileOnly` or `-ExtensionOnly` to configure either client independently.
- `start-deployed-web-conformance.ps1` — Validates development or synthetic-staging AWS,
  Terraform, exact live/local Auth0 alignment, and the selected gateway runtime. ECS mode requires
  a stable routed service and gateway health. `-GatewayRuntime lambda-dark` instead requires the
  retained ECS rollback service to remain idle, proves the selected environment's immutable alias,
  concurrency, JWT authorizer, and unchanged ECS public route, then uses a loopback-only
  token-validating bridge for real two-account conformance. The bridge forwards validated
  issuer/subject/audience/scopes but never the real token, exposes only the Phase 0 profile routes,
  and is stopped with the local web process. State is resolved only from the selected environment's
  initialized backend metadata and its KMS ownership is checked against the current caller. Select
  staging with `-Environment staging`; add the explicit `-EnableWorkloadConformance` switch only
  for the reviewed routed staging workload.
- `verify-gateway-lambda-boundary.ps1` — Runs the guarded, no-write failure matrix against the
  selected environment's immutable dark alias. It verifies exact route/method denial, missing and
  wrong-environment authorizer claims, scope denial, query/body/media constraints, malformed
  encoding, and the shared decoded-body ceiling while proving the public ECS rollback route and
  idle task posture are unchanged before and after the exercise.
- `verify-development-gateway-lambda-boundary.ps1` and
  `verify-staging-gateway-lambda-boundary.ps1` — Compatibility wrappers that fix the shared
  Lambda boundary verifier to one environment and its default IAM Identity Center profile.
- `inspect-staging-workload-and-cost.ps1` — Reports the read-only staging workload/cost baseline
  and corroborates a completed browser workload window with aggregate API Gateway, ECS, RDS,
  queue, alarm, log, and no-drift measurements.
- `inspect-phase0-cost.ps1` — Reads actual service-attributed Cost Explorer totals, exact monthly
  `$5 USD` budget/alert controls (including unexpected alert counts), CUR 2.0 export health, and
  real manifest/Parquet delivery from both isolated Phase 0 accounts without printing account,
  bucket/object-key, subscriber, or provider records.
- `inspect-deployed-outbox.ps1` — Reuses the immutable on-demand database task to run one bounded
  read-only transaction against development or staging and emit only pending count/age/attempt
  metadata plus an ordered identifier digest. Individual synthetic event IDs require the explicit
  `-IncludeEventIds` switch; AWS execution requires the separate `-Execute` switch.
- `operate-phase0-ecs-idle-shutdown.ps1` — Requires explicit zero-traffic acknowledgement, zero
  undispatched outbox rows and zero running Temporal workflows. It imports only the non-secret
  serverless inputs needed to preserve a deployed IAM/KMS boundary; when state proves no
  serverless resources exist, it uses explicit disabled defaults. It then creates and applies
  separate checksum-reviewed development/staging plans containing only two ECS desired-count and
  two heartbeat-alarm updates. Verification proves zero running tasks, released task public IPs,
  quiet expected-heartbeat monitoring, and targeted zero drift while retaining an exact reverse
  resume-plan boundary.
- `plan-gateway-lambda-dark.ps1` — Reconstructs exact live inputs for the selected isolated
  environment, verifies the merged versioned artifact, official regional Secrets extension, and customer-managed state
  key; creates a refresh-backed sensitive plan under the ignored Terraform data directory; and
  rejects anything except the reviewed dark-gateway creates. Explicit recovery switches can
  account for a partial apply, the exact `DescribeSubnets` role-policy correction, or an exact
  unlimited-to-bounded concurrency correction. Concurrency recovery requires the already deployed
  official extension layer to be pinned so a moving AWS `latest` parameter cannot enter the plan.
  `-AllowArtifactReleaseUpdate` verifies the healthy current function, immutable alias, pinned
  layer, bounded concurrency, and new publisher-owned artifact, then permits only the Lambda
  function artifact/version update and alias transition to that new immutable version.
  The same pin supports completed-dark verification, which accepts only a refresh-backed
  zero-change plan. It never applies infrastructure or changes API traffic.
- `plan-development-gateway-lambda-dark.ps1` — Compatibility wrapper for the development invocation
  of the environment-aware gateway planner.
- `plan-serverless-workflow-bootstrap.ps1` — Verifies the exact selected environment account,
  encrypted bootstrap state, immutable GitHub OIDC trust, and a successful protected-environment
  workflow-artifact publication before saving an exact three-policy serverless bootstrap plan. Its
  explicit one-time correction mode accepts only a versioned SSE-S3 state object beneath the
  reviewed CMK bucket default so the authorized apply can rewrite active state under that CMK.
- `plan-development-serverless-workflow-bootstrap.ps1` — Compatibility wrapper for the development
  invocation of the environment-aware bootstrap planner.
- `plan-serverless-workflow-dark.ps1` — Selects development or staging, reuses that environment's
  completed dark-gateway verifier for an initial deployment, and uses encrypted isolated live state
  for guarded recovery and release modes. It requires clean upstream-matched `main`, verifies all
  immutable workflow artifacts, the pinned official regional extension, exact action allowlists,
  Temporal dispatch, disabled SQS/EventBridge triggers, stable API/ECS capacity, and zero
  deletes/replacements. Recovery additionally requires effective exact durable-DLQ permission and
  the absent rolled-back durable function. Completed-dark verification requires a refresh-backed
  zero-change result while rechecking the immutable trigger-disabled boundary.
  `-AllowArtifactReleaseUpdate` additionally verifies the healthy live functions/aliases,
  concurrency, triggers, alarms, DLQ, durable stack, public API/ECS rollback path, Temporal
  dispatch, and three new immutable artifacts. It permits only the exact function/version/alias,
  version-scoped policy, disabled terminal-pattern, durable-stack, and policy-propagation changes
  required by one internally consistent release. The ignored plan is never applied by the script.
  `-PlanRuntimeCutover` is the separate fail-closed transition mode: it first requires a fresh empty
  deployed outbox and zero open Temporal workflows, then accepts only one direct Lambda integration,
  two public health routes, JWT protection on the default route, the gateway's immutable
  `temporal` to `lambda_durable` dispatch version, and coupled enablement of the SQS starter,
  reconciler, and terminal-recovery rule. ECS capacity and retained rollback resources cannot
  change, and the script still only writes an ignored reviewed plan.
  `-VerifyCompletedRuntimeCutover` is the post-apply zero-drift mode. It requires the exact Lambda
  API route/auth boundary, `lambda_durable` dispatch, all replacement triggers enabled, empty
  queues/outbox/Temporal work, seven healthy alarms, and both retained ECS services at `0/0/0`.
  `-AllowOutboxProducerKmsUpdate` permits only the two inline-policy updates that let the gateway
  and scheduled reconciler write to the platform-CMK-encrypted outbox queue. The matching
  completed-update verifier requires zero drift and the live cutover boundary without assuming a
  previously queued database retry completes inside the Terraform apply window.
- `plan-development-serverless-workflow-dark.ps1` — Compatibility wrapper for development calls to
  the environment-aware workflow planner.
- `plan-staging-serverless-runtime-cutover.ps1` — Staging-only wrapper for atomic runtime cutover,
  post-cutover immutable workflow or gateway artifact release, exact gateway concurrency and JWT
  route-scope correction, encrypted-outbox producer correction, and completed verification. It
  fixes the environment and default IAM Identity Center profile and cannot select dark deployment,
  recovery, or completed-dark modes.
- `operate-staging-gateway-runtime-release.ps1` — Reviews and applies an exact 13-update/one-gate
  immutable workflow release, two-update immutable gateway release, one-update concurrency or
  OAuth-scope correction, or two-role encrypted-outbox producer correction. Every path is
  checksum-gated, preserves the authorizer/integration/workflows/data/idle-ECS boundary, and
  requires its matching completed-runtime zero drift.
- `operate-staging-serverless-runtime-cutover.ps1` — Applies only the exact checksum-reviewed
  three-create/six-update cutover plan, then delegates to the refresh-backed completed-runtime
  verifier. It also creates separately reviewed rollback and restoration plans, requires zero
  legacy/serverless queued or running work, keeps ECS idle and all rollback resources retained,
  and blocks recovery cleanup until the restored Lambda runtime is accepted. A guarded context
  continuation can carry a verified rollback over later merged operator/evidence commits only when
  the retained runtime source remains an ancestor and current dark zero drift plus zero work pass;
  it changes only the ignored local context.
- `operate-staging-legacy-temporal-drain.ps1` — Checksum-gated bridge for an exact reviewed,
  bounded synthetic staging batch. Planning binds its identifier-free aggregate
  digest to the exact idle ECS/API, immutable worker, disabled replacement triggers, empty queues,
  healthy alarms, and zero-open-Temporal boundary. Execution runs exactly one standalone retained
  worker, double-checks terminal outbox/Temporal state, stops it, inspects aggregate logs, and proves
  the surrounding boundary unchanged. Interrupted execution has an exact-task cleanup path.
- `operate-serverless-workflow-dark-conformance.ps1` — Selects development or staging and creates
  an isolated ignored, checksum-reviewed context from that environment's exact-commit zero-drift
  plan and stable live boundary. Separate execution exercises three synchronous synthetic
  rejections plus one exact-version asynchronous durable rejection. It proves both owned alarms,
  deletes only the byte-identical synthetic DLQ message, and restores the empty/healthy boundary
  without invoking the reconciler, sending a product SQS event, writing product data, enabling
  triggers, or changing public routing.
- `operate-development-serverless-workflow-dark-conformance.ps1` and
  `operate-staging-serverless-workflow-dark-conformance.ps1` — Compatibility wrappers that fix the
  shared conformance operator to one environment and its default IAM Identity Center profile.
- `operate-serverless-workflow-release-rollback.ps1` — Selects development or staging and
  coordinates a coupled reverse and restoration Terraform release between two accepted workflow
  artifact sets. It reconstructs exact inputs from retained reviewed plans, delegates semantic
  validation to the strict environment-aware dark-release planner, checksum-gates each apply
  separately, requires zero drift before and after each transition, and blocks restoration/cleanup
  until the corresponding dark-conformance result is explicitly accepted. ECS remains retained
  idle and all replacement triggers remain disabled.
- `operate-development-serverless-workflow-release-rollback.ps1` and
  `operate-staging-serverless-workflow-release-rollback.ps1` — Compatibility wrappers that fix the
  shared rollback coordinator to one environment and its default IAM Identity Center profile.
- `operate-development-gateway-lambda-alias-rollback.ps1` — Creates a checksum-reviewed,
  read-only recovery context for two accepted immutable development Lambda versions. Explicit
  execution uses optimistic alias revision locking, proves the prior version through the guarded
  `200/200/401` dark bridge, restores the current version in `finally`, repeats the bridge and full
  preflight, and removes its ignored context only after success. Version `1`, weighted aliases,
  configuration drift, unreviewed context, and any public traffic change are rejected.
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
- `node backend/workflows/cloud-conformance.mjs` — Verifies an environment-scoped AWS Secrets
  Manager destination and performs a read-only Temporal Cloud namespace request without printing
  the runtime key or environment identifiers. `--require-zero-open-workflows` additionally fails
  closed when the namespace contains a running workflow.
- `validate-skills.mjs` — Validates repository skill structure, trigger metadata, UI metadata,
  routing, catalog coverage, and removal of scaffold placeholders.
