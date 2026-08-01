# D0-016 Runtime Baseline and Lambda Boundary Evidence — 2026-07-31

- Delivery: D0-016 scale-to-zero runtime migration
- Scope: SR-001 deployed read-only baseline and SR-002 local gateway boundary
- Cloud mutation: None
- Data classification: Sanitized operational metadata only; no secret value, token, candidate
  record, database URL, account identifier, or raw artifact is recorded here

## Deployed baseline

Read-only AWS and Temporal inspections were run from the isolated development and staging
administrator profiles in `us-east-2`. The inspection did not run Terraform, update a service,
invoke an application operation, or retrieve candidate data.

| Capability | Development | Staging |
|---|---:|---:|
| ECS gateway desired/running/pending | 1 / 1 / 0 | 1 / 1 / 0 |
| ECS workflow worker desired/running/pending | 1 / 1 / 0 | 1 / 1 / 0 |
| Total running ECS tasks | 2 | 2 |
| HTTP API named for the environment | 1 | 1 |
| Gateway VPC Link | `AVAILABLE` | `AVAILABLE` |
| Private Cloud Map namespace | 1 | 1 |
| RDS status/class | `available` / `db.t4g.micro` | `available` / `db.t4g.micro` |
| RDS Multi-AZ/public access/backup retention | false / false / 7 days | false / false / 7 days |
| Running Temporal executions | 0 | 0 |

The deployed application path therefore still has two continuously billed application tasks in
each environment. Nothing has been cut over: API traffic continues through API Gateway, VPC Link,
Cloud Map, and the gateway ECS service; outbox work continues through the Temporal worker ECS
service.

Terraform source inventory confirms the migration must explicitly dispose of the gateway and
worker ECS services/task definitions and their ADOT sidecars, VPC Link, Cloud Map namespace and
service, gateway/worker ECR repositories, Temporal secret access, container heartbeat filters and
alarms, and ECS-specific dashboard/runbook references. The RDS database and backups, KMS key,
artifact S3 bucket, event queue/DLQ, API Gateway, audit/outbox persistence, and migration task
capability remain owned persistent resources.

### Cost snapshot

The development account's Cost Explorer result for `2026-07-01` through `2026-08-01` was still
estimated and subject to billing latency:

| Service | Unblended cost (USD) |
|---|---:|
| Amazon Elastic Container Service | 1.3643 |
| Amazon Relational Database Service | 0.7667 |
| Amazon Virtual Private Cloud | 0.3694 |
| All returned services | 3.1784 |

The staging account returned no service groups at inspection time. That is recorded as unavailable
billing evidence, not as proof of zero cost. Cost will be inspected again after the provider's
normal reporting delay and after cutover.

### Remaining SR-001 baseline item

The exact PostgreSQL undispatched-outbox count was not queried because the database is private and
the current runtime has no approved read-only operator path into it. SR-001 remains in progress.
Before any event-routing cutover, a bounded in-VPC inspection must record the undispatched count,
oldest event age, and immutable event IDs; it must not print payloads. The queues and Temporal
execution counts alone are not substitutes for this database truth.

## Locally implemented Lambda boundary

- Extracted one shared NestJS/Fastify application factory used by the existing HTTP server and the
  new Lambda handler. The Fargate entrypoint remains buildable solely as a rollback path until the
  migration completion gate permits deletion.
- Added an API Gateway HTTP API payload-v2 adapter with request body/base64, query, cookie, response
  header, correlation-ID, and multi-cookie mapping.
- Made only `/health/live` and `/health/ready` public at the handler boundary. Every other path
  fails before application dispatch when validated JWT authorizer context is absent or malformed.
- Reconstructed the application principal from exact issuer, audience, and subject claims and kept
  it in invocation-local `AsyncLocalStorage`; the Lambda path does not make a second remote JWKS
  call or trust user-supplied identity headers.
- Preserved the existing application-level scope and ownership checks.
- Added an explicit two-connection database pool maximum for each warm gateway execution
  environment. Terraform must still calculate reserved concurrency from the RDS connection budget
  before deployment.

### Verification

| Check | Result |
|---|---|
| `pnpm --filter @ai-job-apply/profile-service typecheck` | Passed |
| `pnpm --filter @ai-job-apply/gateway typecheck` | Passed |
| `pnpm --filter @ai-job-apply/gateway build` | Passed |
| `pnpm --filter @ai-job-apply/gateway test` | Passed: 2 files, 9 tests |
| Biome check of changed source/package files | Passed |
| `pnpm check` repository gate | Passed: skills, format, lint, 19 typecheck tasks, 19 test tasks |

The tests cover the shared application factory, the existing authenticated preference flow,
missing authorizer context, wrong issuer, wrong audience, missing subject, invocation-local
principal propagation, base64 request mapping, query/cookie mapping, response cookie mapping, and
hop-by-hop header removal.

SR-002 remains in progress because artifact bundling, SBOM/dependency scanning, Lambda resource
policy enforcement, reserved concurrency, the version/alias, and dark deployed conformance belong
to the next infrastructure change and are not yet proven.
