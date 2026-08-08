# ADR-016: Scale-to-Zero Application Runtime

Status: Accepted target; migration in progress
Date: 2026-07-31

## Context

The deployed Phase 0 slice keeps one ECS/Fargate gateway task and one ECS/Fargate Temporal worker
task running continuously. That proved routing, identity, persistence, outbox delivery, durable
execution, observability, recovery, and isolated deployment, but it also incurs compute and public
IPv4 charges while the pre-launch environment is idle. Initial billing evidence shows that this is
a real operating characteristic rather than only a planning estimate.

The product still requires a stable authenticated API, transactional state/event publication,
durable code-first workflows, long waits for user review and provider recovery, idempotent external
effects, replay-safe upgrades, tenant isolation, and auditable failure handling. Replacing idle
compute must preserve those properties and must not introduce an always-on NAT gateway, polling
process, database proxy, or substitute container under another name.

AWS Lambda durable functions are generally available in the primary `us-east-2` region and support
versioned TypeScript/Node.js workflows, checkpoints, retries, callbacks, waits, encrypted execution
state, and asynchronous executions lasting up to one year. The existing PostgreSQL, SQS/DLQ, KMS,
S3, API Gateway, and isolated-account boundaries can remain authoritative.

## Decision

Adopt a scale-to-zero application control plane and complete its migration as the highest-priority
open Phase 0 engineering task.

- Keep the regional API Gateway HTTP API, but replace its VPC Link/Cloud Map HTTP proxy with a
  direct Lambda proxy integration.
- Use an API Gateway JWT authorizer for the exact Auth0 issuer, audience, and route scopes. The API
  Lambda must still enforce user/object ownership, consent, business authorization, payload
  validation, and idempotency and must reject invocations without the trusted authorizer context.
- Package the TypeScript gateway as a Node.js 24 Lambda handler. Publish immutable Lambda versions
  and move an environment alias only after conformance; do not use `$LATEST` as a deployed target
  and do not enable provisioned concurrency without measured latency evidence.
- Place only database-owning functions in private application subnets. Retrieve the existing
  database credential through the cached AWS Parameters and Secrets Lambda Extension and a
  least-privilege Secrets Manager interface endpoint. Do not expose PostgreSQL publicly, embed
  credentials in artifacts or Terraform inputs, enable an idle NAT gateway, or enable RDS IAM
  authentication on the memory-constrained initial database without a separate load/memory review.
- Preserve PostgreSQL as domain, operation, audit, and outbox truth. A committed outbox record is
  nudged to SQS after commit; a scheduled reconciliation Lambda republishes any undispatched row so
  a crash between commit and enqueue cannot lose work.
- Use an SQS-triggered starter Lambda to validate and claim the outbox record and start a versioned
  Lambda durable function asynchronously. Derive the durable execution name from the immutable
  event ID. Duplicate SQS delivery or reconciliation must resolve to the same execution rather than
  create a second workflow.
- Replace Temporal workflow definitions with Lambda durable functions. Durable workflow code owns
  orchestration only; completed steps, external effects, waits, callbacks, compensation, and final
  state transitions have explicit checkpoint and idempotency semantics. AWS execution history is
  operational evidence, not product truth; user-visible status and required audit history remain in
  PostgreSQL.
- Separate private database activities from internet-facing provider activities. Private activity
  Lambdas receive identifiers and use VPC-only database access. Provider activity Lambdas run
  outside the application VPC, receive minimum identifier/object references, have no database
  credentials, and use approved managed secrets. This avoids a continuously billed NAT path.
- Keep ECS/Fargate only for explicitly on-demand workloads that need a container, browser, migration
  runtime, or resource envelope Lambda cannot provide. No gateway, general workflow worker,
  ingestion poller, or browser pool runs continuously by default.
- Replace container-heartbeat alarms with API Gateway errors/latency, Lambda errors/throttles/
  duration/concurrency, durable execution terminal-event alarms, SQS age/DLQ alarms, RDS health,
  and privacy-safe structured logs/traces. Idle functions must not alarm merely because they emit no
  heartbeat.
- Keep staging reproducibly provisionable and normally application-disabled. Development and
  staging use the same Terraform composition with different state, accounts, aliases, keys,
  secrets, queues, databases, and authorizer configuration.

The migration is complete only after the replacement passes the existing Phase 0 conformance and
recovery gates and the old runtime is removed after a bounded rollback window. Removal includes the
gateway and worker ECS services/task definitions, their ADOT sidecars and heartbeat alarms, the
gateway VPC Link, Cloud Map service/namespace, gateway/worker ECR repositories when no rollback or
on-demand consumer remains, public task IP usage, Temporal runtime secret and provider key, stale
outputs/variables/scripts/runbooks, and obsolete cost assumptions. The ECS cluster and migration
task may remain only while they have an owned on-demand use; an empty cluster has no always-on task.

The product owner explicitly expired the development and staging rollback windows at
`2026-08-08T02:56:32.831Z` after both environments passed routed Lambda acceptance,
rollback/restoration, fixed workload, tenant isolation, empty-work, alarm/log, and zero-drift
evidence. This decision authorizes separate checksum-reviewed retirement planning; it does not
authorize an unreviewed Terraform apply or combine Temporal/provider cleanup with the legacy AWS
resource deletion boundary.

## Compatibility and supersession

This ADR supersedes [ADR-004](004-temporal-outbox-and-idempotency.md) only for the selection of
Temporal as the workflow engine. Transactional outbox, immutable workflow identity, idempotency,
and ambiguous-effect safety remain mandatory.

This ADR supersedes [ADR-013](013-lean-until-demand-cloud-runtime.md) for continuous ECS gateway/
worker tasks and API Gateway VPC Link/Cloud Map ingress. Its `us-east-2`, isolated-environment,
Single-AZ-with-recovery, no-premature-NAT/ALB/Redis/replica, measured-scaling, and quality
requirements remain accepted.

## Consequences

- Idle gateway and orchestration compute scales to zero; Fargate and public IPv4 charges remain only
  for explicitly started on-demand tasks.
- API and worker process lifecycle code becomes invocation lifecycle code. Database pools must be
  bounded per execution environment, and function reserved concurrency must protect the initial
  PostgreSQL connection budget.
- The Secrets Manager interface endpoint is a small fixed network cost chosen over public database
  exposure, credential embedding, memory-risky IAM database authentication, or an idle NAT gateway.
- Durable function versions must remain available while executions using them can resume. Deployment
  cleanup needs execution reachability checks rather than immediate deletion of old versions.
- The workflow implementation becomes AWS-specific. Domain contracts, event schemas, outbox rows,
  application status, and external-effect idempotency remain provider-neutral enough to permit a
  future engine migration.
- Temporal histories and keys are retired only after all pre-cutover executions are terminal or
  explicitly disposed, required evidence is retained without PII, and rollback authority expires.

## Alternatives

- Keep one continuously running gateway and worker. Rejected as the default because the measured
  pre-launch workload does not justify 24/7 application compute.
- Schedule ECS desired counts to zero. Rejected as the target because it creates availability
  windows and operator/scheduler state while preserving the server-process deployment model.
- Use Temporal Serverless Workers on Lambda. Deferred because the feature is pre-release, account/
  SDK availability is not yet proven, and it does not by itself replace the current PostgreSQL
  outbox poller or private-RDS/public-Temporal network path.
- Use Step Functions Standard. Viable, but not selected because the repository already uses
  code-first TypeScript workflow definitions and Lambda durable functions retain that development
  and local-testing model with fewer orchestration representations.
- Replace PostgreSQL with DynamoDB or Aurora solely for Lambda connectivity. Rejected because
  application data ownership and relational correctness should not be rewritten to optimize one
  compute boundary.
