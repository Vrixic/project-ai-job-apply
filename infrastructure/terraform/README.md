# Terraform

Defines the isolated AWS development and staging environments, encrypted remote state, identity,
networking, storage, PostgreSQL, queues, serverless application runtime, observability, and cost
controls.

## Layout

- `bootstrap/` — customer-KMS remote state and environment-scoped GitHub OIDC roles.
- `modules/platform/` — persistent data/network resources, API Gateway/Lambda runtime, durable
  workflows, and one-off migration capability.
- `modules/cost-controls/` — AWS Budgets alerts and CUR 2.0 export storage.
- `modules/cover-letter-provider-objects/` — Unattached source-only provider S3 identity policy;
  no environment composition, IAM attachment or runtime activation.
- `environments/` — isolated development and staging composition.

State and secrets remain in managed backends. For every remote backend initialization, resolve the
environment bucket's customer-managed KMS key and pass it as `kms_key_id`; `encrypt=true` alone can
still permit SSE-S3 writes. Verify state-object encryption after any apply that changes this
boundary.

## Runtime

The primary region is `us-east-2`. API Gateway invokes a versioned Lambda alias, PostgreSQL work
runs in private bounded Lambdas, and SQS/EventBridge drive exact-version Lambda durable workflows.
`serverless_runtime_enabled` is the fail-closed public route/trigger switch. It does not restore a
second provider.

The Phase 2 community seam is independently default-off. Its environment object defaults to
`deploy = false`, `enabled = false`, and `policy_endpoint_enabled = false`, creating no D2 function,
queue, schedule, mapping, route, or NAT. The separately gated anonymous policy endpoint may expose
only a verified signed all-disabled envelope through the existing Gateway; that gate never creates
an intake/reviewer route, schedule, queue consumer, or provider egress. A reviewed dark deployment
can publish immutable scheduled and Trust-signal Lambda aliases,
an exact encrypted Trust-signal queue/DLQ, least-privilege roles, and standard alarms while leaving
every trigger and route structurally absent. Activation is a separate change requiring the exact
artifact identities, concurrency, schedule, lease/retry/batch policy, signed contribution policy,
Trust authority/policy, an explicitly authorized non-empty provider source registry with matching
independent-verification registrations, route budgets, alarm thresholds, and accountable release
authority. These provider fields remain false/empty by default and are passed only to an activated
scheduled runtime; an empty verifier configuration cannot activate processing. Provider access
also requires a separate default-false private-egress authority. Only an activated scheduled
runtime is moved into the retained provider-only private subnets and uses their NAT path; a dark
deployment retains those non-overlapping subnets for immutable-version cleanup but creates no NAT.
Dark deployment also creates dimensionless aggregate alarms for scheduled-batch failure, terminal
processing and delivery outcomes, and Trust-signal failure in `AIJobApply/D2Community`, with both
ALARM and OK notifications. `JobsParked` is intentionally excluded because awaiting independent
verification or Trust review is expected parking rather than an actionable failure. The
anonymous policy GET and separately scoped private, candidate, and reviewer routes are then
created explicitly; D2 scopes never enter the generic `$default` route. No provider host, egress,
credential, or timing value is selected by the repository defaults.

An explicit development-only `development_contributions_enabled` input removes the expiring
signed contribution-policy dependency from the enabled Gateway and scheduled processor.
It defaults false, cannot activate the runtime by itself, and is rejected outside development.
Provider verification, Trust roles, identity, and all resource/runtime budgets remain intact.
See the [platform module](modules/platform/README.md) for its exact environment boundary.

The retained ECS cluster has no service. It exists only to run reviewed service-owned database
migrations through a fail-fast orchestrator as a short-lived Fargate task.
`ai-job-apply/migration` is the sole application ECR repository and must
hold an immutable, scanned, KMS-encrypted digest. Gateway and workflow artifacts use versioned,
KMS-encrypted S3 objects instead of containers.

Per [ADR-013](../../docs/adr/013-lean-until-demand-cloud-runtime.md) and
[ADR-016](../../docs/adr/016-scale-to-zero-application-runtime.md), the default footprint uses
Single-AZ PostgreSQL, no Redis, no NAT gateway, no ALB, and bounded Lambda concurrency. Multi-AZ,
private NAT egress, caches, custom domains, and higher concurrency require measured or launch
evidence.

The historical gateway/worker ECS services, Cloud Map, VPC Link, Temporal dispatch, container
heartbeat alarms, and gateway/worker image repositories are retired. Their ADRs and delivery
evidence remain audit history; current modules, scripts, and runbooks must not depend on them.

## Safe changes

Use portable Terraform 1.16.2, the exact environment SSO profile/account, the encrypted state bucket, a clean
upstream-matched `main`, refresh-backed saved plans, and explicit SHA-256 review before apply.
Database changes must use the dedicated migration digest and pass fail-closed migration checks.
Never print plan bodies, secrets, raw logs, candidate identifiers, or state values into shared
evidence.

Install the approved Windows binaries with `scripts/install-terraform-toolchain.ps1`, then
dot-source `scripts/use-deployment-terraform.ps1` in each operator shell. The installer verifies
HashiCorp's PGP signature/fingerprint and pinned archive checksums without replacing the existing
system installation or changing persistent PATH. Portable 1.9.8 remains available only for explicit
read-only historical-plan inspection; all new plans and applies require 1.16.2. Reconstruct reviewed
inputs and generate new binary plans, retaining old artifacts and unchanged provider locks.

Remote init must explicitly request `use_lockfile=true`, and operators must verify the effective
cached S3 backend's locking, encryption and exact identity before planning or applying. A provider
dependency lock is not a remote state lock. Never disable locking. The excluded GitHub Actions
files retain their old pin and must not be used for cloud planning during this local-only transition.

- `modules/native-resume-task/` supplies an unattached, default-empty native resume task/role release; no environment currently instantiates it.

- `modules/native-resume-source-access/` supplies an unattached owner/source Lambda pair with separate bounded roles and disabled runtime defaults.

- `modules/native-resume-preparation/` supplies unattached private control, durable and dispatcher release wiring with disabled launch/schedule defaults.
