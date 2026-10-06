# Repository Scripts

`node --test scripts/tests/cover-letter-provider-object-policy.test.mjs` renders the unattached
provider object policy with approved Terraform 1.16.2 and evaluates its supported IAM operators
offline, including extra broad grants and guard regressions. It creates no AWS resources or
state writes. Also run the module's native Terraform tests; see its
[README](../infrastructure/terraform/modules/cover-letter-provider-objects/README.md).

Scripts provide guarded local setup, artifact construction, deployed verification, restore,
observability, and policy validation. Historical cutover/provider operators were removed after
both AWS environments accepted the steady-state serverless runtime.

## Local setup and identity

- `start-development-d2-workload-session.mjs` — Separate fixed-purpose loopback sign-in for the
  approved single Mintlify disposable workload. Uses existing web-client identity configuration
  plus the extension's exact development API origin and UGC version. Requests only
  `openid profile email jobs:read jobs:contribute profile:write`, with fresh MFA and sufficient
  token lifetime. The local confirmation shows the exact title/source and excludes publication
  and account deletion. Credentials stay in memory; never extract extension/browser tokens.
  The operator supplies only the returned scope digest and fixed processing confirmation on
  stdin. One execution is permitted; ambiguous outcomes require scoped recovery, not a rerun.
  Before dispatch, an immutable, CurrentUser-DPAPI-encrypted, token-free scope is flushed under
  `infrastructure/terraform/environments/development/.terraform/development-d2-workload-session`.
  Directory/files are current-user-only and refuse links/overwrites; successful cleanup adds an
  immutable `.complete` marker. On failure preserve those files. An operator can enumerate the
  opaque `scope-*.dpapi` filenames and compute their SHA-256 privately, then use
  `readD2RecoveryScope({fileName, sha256})` from `lib/d2-workload-recovery.mjs` to recover the exact
  scope in process memory for read-only inspection and separately scoped cleanup. Never print the
  decrypted scope or blindly rerun the original workload. Session tokens are cleared on close.
  The existing rights helper/scopes are unchanged and reject workload-purpose attestations.
  Tests run sequentially under `pnpm test:candidate-rights-session` because both helpers use the
  same already configured `http://localhost:3000/auth/callback`; do not run them together.
  Before sign-in starts, reopening the landing page may issue a fresh transaction cookie and
  form token; an earlier unbound page request cannot permanently block the human browser.
  Once Sign in is pressed, keep the same browser and cookies through callback and confirmation.
  Missing/mismatched cookies during an active sign-in require a fresh helper session, not a bypass.
  Failed exchanges report fixed diagnostic categories for transport, response, signature
  verification, claims, lifetime, MFA and scopes. The operator receives the same safe category
  and a bounded closure reason. Never request tokens, full callback URLs or provider error bodies
  to diagnose a failed sign-in; no workload is dispatched by the sign-in step.
  MFA failures distinguish missing MFA method from invalid, future, stale or pre-session
  authentication time and verifier disagreement. For a future-time failure, inspect Windows time
  synchronization before changing identity-provider settings; do not bypass the freshness guard.

- `install-terraform-toolchain.ps1` — Installs isolated Windows Terraform 1.16.2 for current local
  deployment plus 1.9.8 for explicit historical plan reading. Requires PowerShell 7 and GPG;
  verifies HashiCorp's signing fingerprint, signature and pinned archive checksums before execution.
  It does not replace the system installation or modify the personal keyring.
- `use-deployment-terraform.ps1` — Dot-source in each operator shell to select the approved portable
  current binary through process PATH only. Historical decoding remains read-only through
  `lib/terraform-toolchain.ps1`; current plans/applies require 1.16.2 and an exact encrypted,
  S3-locking backend. Excluded GitHub Actions retain their historical pin and are not the current
  cloud-planning path. `pnpm test:terraform-toolchain` runs the offline regression boundary.
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
- `start-development-candidate-rights-session.mjs` — Maintained loopback OAuth/PKCE handoff for a
  human-confirmed disposable candidate. Reads the existing candidate web settings, never browser
  sessions. Keeps tokens and the identity attestation in process memory; accepts only separate
  reviewed Plan/Execute commands on operator stdin. Sign-in itself makes no candidate-data change.
  See the [rights acceptance runbook](../infrastructure/runbooks/deployments/development-candidate-rights-acceptance.md#disposable-account-preparation-and-local-sign-in).
  `pnpm test:candidate-rights-session` exercises generated-only loopback and operator boundaries.

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
- `build-candidate-deletion-restore-lambda.mjs` — Builds the separate temporary private restore
  executor. It has no live rights mutation adapters, public handler, or trigger. The guarded
  `operate-development-candidate-deletion-replay.ps1` performs Prepare/Create/Inspect/Replay/Cleanup
  against the exact maintained PITR target, with read-only cloud inventory and restored-only SQL.
  Its dedicated role remains default-off; see the existing
  [replay runbook](../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md).
  `pnpm test:deletion-restore` runs its synthetic PowerShell 7 contract/operator guards.
- `build-profile-readiness-lambdas.mjs` — Builds durable definition, activity, and terminal
  artifacts with exact-version metadata.
- `operate-development-workflow-lambda-publication.ps1` — Provides the fail-closed local
  development publisher for the exact current-source workflow ingress, profile-readiness durable,
  and profile-readiness activity artifacts. It tests and builds twice, refuses any existing key or
  delete marker, publishes twelve conditional/versioned/customer-KMS-bound ZIP/evidence objects,
  verifies exact-version readback, and writes a checksum-reviewed ignored receipt without changing
  a Lambda, alias, trigger, Terraform state, or database. See
  `infrastructure/runbooks/deployments/development-workflow-lambda-publication.md`.
- `operate-development-applications-recovery-publication.ps1`: Reproducibly publishes and
  exact-version verifies only the Applications attempt-recovery Lambda ZIP and its three evidence
  companions below `lambda/applications`. It cannot deploy the function, enable the schedule,
  apply Terraform, or run recovery. See
  `infrastructure/runbooks/deployments/development-applications-recovery-publication.md`.
- `operate-development-ingestion-lambda-publication.ps1` — Reproducibly publishes and
  exact-version verifies only the ingestion durable and runtime artifact sets below the dedicated
  `lambda/ingestion` boundary. It writes no Lambda, alias, trigger, Terraform, database, or
  provider state. See
  `infrastructure/runbooks/deployments/development-ingestion-lambda-publication.md`.
- `operate-development-ingestion-dark-release.ps1` — Plans, applies, and verifies only the
  checksum-reviewed ingestion durable/runtime artifact update while preserving disabled sources,
  provider authority, private egress, schedules, and queue mapping. Verification requires exact
  numeric unweighted versions, zero observed queue counters, idle ECS, exact application-subnet
  binding and fresh zero drift. Any shared provider NAT requires independent, unchanged D2
  authority plus exact state/live version and topology checks; ingestion remains default-dark. See
  `infrastructure/runbooks/providers/synthetic-ingestion-dark-release.md`.
- `operate-development-public-job-lambda-publication.ps1` — Publishes and exact-version verifies
  the separate anonymous edge and private projection artifacts from clean, exact merged source.
  It cannot deploy a function, move an alias, enable the anonymous routes or indexing, apply
  Terraform, or run a migration. See
  `infrastructure/runbooks/deployments/development-public-job-lambda-publication.md`.
- `build-document-lambdas.mjs` — Builds separate deterministic document coordinator and isolated
  parser artifacts, manifests, and CycloneDX SBOMs; the parser artifact has no database runtime.
- `build-private-document-lambdas.mjs` — Builds the closed four-entry provider-control, response-capture,
  maintenance-fence and response-disposal family into its separate private-control output root.
  Every actual bundle refuses default-off work and extra content without secret transport.
- `publish-development-document-lambdas.ps1` — Provides the fail-closed local development fallback
  for an exhausted GitHub Actions budget: it tests and reproducibly builds both document Lambda
  artifacts, publishes eight new conditional/versioned/KMS-bound objects, verifies exact checksums
  and metadata, and emits a checksum-reviewed ignored receipt without deploying either Lambda.
  `-ArtifactFamily PrivateDocumentControls` selects the dedicated four-artifact/sixteen-object
  family with isolated receipt/key roots and unchanged audit/source/KMS/immutable-write guards.
- `publish-development-migration-image.ps1` — Provides the corresponding fail-closed development
  fallback for the migration-only container. Its cloud-independent `LocalBuild` action proves two
  source-bound `linux/amd64` builds have identical configuration and rootfs identities and passes a
  hardened runtime smoke against the exact six-owner, ten-schema, 68-relation, 46-migration Phase 2
  manifest, including the Trust runner and checksum-bound migration files. Publication separately
  resolves the Terraform-owned immutable KMS ECR
  repository, publishes the exact commit tag, requires a completed zero-High/zero-Critical scan,
  and emits a checksum-reviewed ignored receipt without changing Terraform or executing a migration. See
  `infrastructure/runbooks/deployments/development-migration-image-publication.md`.
- `operate-development-gateway-release.ps1` — Provides the source- and checksum-bound local gateway
  publication fallback plus exact Terraform plan/apply/verify flow. It preserves every non-gateway
  input, limits a release to the gateway Lambda function and immutable alias, and runs the direct
  authenticated search boundary. Its separate D3 activation mode creates either the dedicated
  restricted-answer KMS boundary or the Applications attempt-recovery runtime from its reviewed
  artifact, never both in one plan. See
  `infrastructure/runbooks/deployments/development-gateway-release.md`.
- `operate-development-synthetic-catalog-retirement.ps1` — Inspects and retires only exact generated
  source-neutral development catalog fixtures through a reviewed immutable migration image and
  temporary migration-task revision. A reviewed manifest is required for retirement; posting/source
  rows, saved associations and audit history are retained. It performs no schema migration,
  provider activation or IAM expansion. The
  [Phase 2 record](../docs/product/delivery/phase-2-extension-and-community.md#d2-055--catalog-details-and-synthetic-fixture-retirement)
  owns scope and execution; `pnpm test:synthetic-catalog-retirement` runs offline operator guards.
- `operate-development-d2-runtime-release.ps1` — Separately plans, applies and verifies D2
  maintenance, paused worker-artifact replacement and compatible resumption. It preserves queues,
  provider/reviewer configuration and D1/private captures. A verified pause cutoff binds the old
  async-retention/runtime window; old versions cannot be resumed onto Jobs `0023`/Trust `0004`.
  See the coordinated ordering in
  `infrastructure/runbooks/deployments/database-migration.md`.
- `operate-development-deletion-restore-role.ps1` — Enables/disables only the separately approved
  development restore-role allowance, exact role policy and private endpoint changes. Bootstrap
  and platform stages have distinct saved plans, source/state bindings and live verification.
  Disable requires exact cleanup or bounded unused-role rollback; it is not a generic IAM removal
  command. See `infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md`.

Artifacts are normally published by the protected GitHub workflows; the development-only local
publishers preserve the same immutable boundary when that route is unavailable. The migration-only
container is built from `Dockerfile.migration` and runs the fail-fast
profile/jobs/documents/matching/billing/trust migration orchestrator. Its source package also
includes the strict restore-verifier CLI and canonical manifest; source inclusion does not claim
deployed Trust candidate-rights behavior, image publication, task-definition deployment,
migration execution, or AWS restore execution. No gateway or general worker image exists.

## Deployed verification and evidence

`pnpm test:d2-runtime-release` and `pnpm test:deletion-restore-role` run synthetic operator/guard
regressions only; they do not pause a deployment, create permissions, run a restore or contact AWS.
Both are included in maintained infrastructure and full repository verification.

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
  `0.2.0` and the server's exact fixed Greenhouse, Lever (global/EU), or Ashby provider/variant/host
  descriptor. Descriptors do not activate a provider: the deployed server must independently
  enable that provider and development contributions. This removes the policy preflight,
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
  `pnpm test:candidate-rights-acceptance` runs the offline operator and strict downloaded-export
  regressions; `pnpm test:candidate-rights-export` runs only the latter. Both use generated data
  without executing candidate rights or contacting a provider. The complete `pnpm check` and
  maintained repository verifier include this boundary.

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
  Development-only `D2PublicDevelopment`, `D2AuthenticatedIntake`, and `D2Processing` consume
  the corresponding successful runner's aggregate JSON using `WorkloadResultPath` and
  `WorkloadResultSha256`; retain it under ignored `.tmp/` or development `.terraform/`.
  Pass its exact `startedAt`/`endedAt` as `StartTime`/`EndTime`, with the usual exact-account
  and accepted-runtime-plan inputs. The current runtime mode must match the selected profile;
  persistent development processing cannot use paused-intake acceptance. Inspect after the two
  complete post-run queue-observation minutes and metric publication, not during the workload.
  Missing required data is inconclusive; absent optional signals remain explicitly unknown.
  Results corroborate bounded aggregates and cleanup only, not owner attribution, publication
  or throughput capacity. Historical `D2Public` retains its signed-policy 40-request/20-denial
  contract. Offline inspector regressions run in `pnpm test:staging-restore:ps7` and
  `pnpm test:staging-restore:ps5`; no workload or cloud request runs from those tests.
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

- `lib/development-d2-provider-configuration.ps1` — Pure saved-plan guard for a separate additive
  development provider configuration change. It preserves existing Greenhouse bindings and
  requires an explicit exact-domain subset, cross-bound sources/verification registrations and
  exactly two scheduled function/alias updates for a registry-only addition, or four
  Gateway/scheduled updates when provider/host selectors change. The development-only selected
  configuration budget is 3,000 encoded characters, with a separate 4,096-byte complete UTF-8
  serialized-JSON environment guard including delimiters and escaping. All artifacts, Trust settings, schema,
  maintenance, IAM/network and other variables stay unchanged. It performs no cloud operation;
  an operator must bind reviewed source/artifact receipts to actual aliases before application.
  `pnpm test:d2-provider-configuration` runs its generated positive/negative regressions and is
  included in the maintained repository verifier. This is not a bypass of migration maintenance.
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

Use portable Terraform `1.16.2`, temporary IAM Identity Center credentials, environment-specific encrypted
state, immutable artifacts, refresh-backed saved plans, and explicit checksum approval for every
material cloud change. Never replay historical cutover commands or reconstruct a retired runtime.

`build-isolated-provider-lambda.mjs` builds the source-only isolated cover-letter provider into
`backend/services/documents/dist/isolated-provider-lambda` and verifies the actual bundled
default-off/closed-envelope refusal. The package command builds its dependencies first.
`tests/isolated-provider-bundle.test.mjs` checks the compiled dependency graph for absence of
SQL/private persistence/rendering/disposal/test fixtures and is part of the full verifier.
This is local packaging only; existing publisher families are unchanged and no provider
publication, deployment, role grant or activation is authorized by the builder.

- `build-response-maintenance-lambda.mjs` builds the source-only internet-maintenance Lambda
  into `backend/services/documents/dist/response-maintenance-lambda`, separate from private SQL
  controls and isolated generation. Actual bundle smoke checks default-off/extra-content refusal;
  `tests/response-maintenance-bundle.test.mjs` verifies emitted capability isolation. Set exact
  clean `ARTIFACT_SOURCE_SHA` for committed provenance. No publisher or runtime activation is
  introduced. Reviewed IAM, scheduling, retention and original writer drain remain prerequisites.

`build-application-preparation-lambda.mjs` builds the separate source-bound private preparation
activity family under Workflow dist/preparation-lambda. It checks the actual bundled default-off
refusal and strict extra-content rejection with zero fetches. No publisher, deployment or activation
is added; see [D3-068 evidence](../docs/product/delivery/evidence/d3-preparation-activity-bootstrap-2026-10-04.md).

`build-application-preparation-durable-lambda.mjs` emits a separate native orchestration family
under Workflow dist/preparation-durable-lambda and probes actual bundled default-off/wrong-version
refusals before SDK state access with zero fetches. The maintained
`preparation-durable-bundle.test.mjs` checks emitted owning/AI/SQL/private-runtime isolation.
No publisher/deployment is added; see [D3-069](../docs/product/delivery/evidence/d3-preparation-durable-bootstrap-2026-10-04.md).

`build-application-preparation-starter-lambda.mjs` emits the separate source-bound native SQS
starter under Workflow dist/preparation-starter-lambda. Actual default-off/wrong-version/invalid
input probes perform zero fetches. `preparation-starter-bundle.test.mjs` positively requires owning
dispatch code and excludes emitted private/document/provider/terminal recovery actors.
No publisher/deployment is added; see [D3-070 evidence](../docs/product/delivery/evidence/d3-preparation-starter-bootstrap-2026-10-04.md).

`build-application-preparation-recovery-lambda.mjs` creates a separate source-bound native family
under Workflow dist/preparation-recovery-lambda, exporting index.terminalHandler and
index.reconcileHandler. Actual default-off, wrong-version and invalid-input probes run with zero
fetches. `preparation-recovery-bundle.test.mjs` positively requires owning recovery and excludes
emitted starter/Invoke/private/provider actors. No publisher/deployment is added; see
[D3-071 evidence](../docs/product/delivery/evidence/d3-preparation-recovery-bootstrap-2026-10-04.md).

`tests/cover-letter-export-bundle.test.mjs` checks the compiled owned export reader/codec and
excludes generation/work/provider/Invoke actors. It is part of the maintained verifier.
See [D3-072 evidence](../docs/product/delivery/evidence/d3-cover-letter-export-content-2026-10-04.md); no deployment is implied.

`verify-native-memory-session.mjs --enable-local-linux-tests --image sha256:<existing-image-id>`
runs the explicit local Linux kernel/session test. It never pulls an image or calls AWS/model
providers; network is disabled and only synthetic copied inputs are mounted read-only. Native
code compiles with warnings treated as errors. Exact owned container/staging cleanup preserves
other data. See [native session](../backend/workers/ai/native-session/README.md).

The native-memory-session verifier also runs a same-process TLS 1.3 content-read fixture with
signed test JWTs, owning scalar proof, strict request/CORS checks, packet races and actual socket
cancellation. It generates only synthetic TLS keys in test tmpfs and validates the exact test
certificate/hostname. SQL/provider/renderer/managed OIDC remain simulated; no hosted endpoint or
remote owner authentication is enabled.

`native-task-retirement-bundle.test.mjs` checks the compiled private retirement client has only its
control owner and ECS SDK, excludes SQL/Profile/model/object/render/Invoke owners, and refuses
default-off use in the actual emitted artifact. It performs no AWS call; the maintained verifier
runs it after build. Real managed-task terminal conformance remains a release prerequisite.

`build-native-material-launch-lambda.mjs` produces the independent unpublished default-off
private launcher artifact under `backend/workflows/dist/native-launch-lambda`. It uses the
maintained clean-source builder and actual bundled refusal checks. It creates no publication,
deployment or activation. `native-launch-control-bundle.test.mjs` verifies sender/receiver emitted
capabilities and is included in the maintained full verifier.
