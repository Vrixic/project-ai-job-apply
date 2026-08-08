# Terraform

Defines the isolated AWS development and staging environments, encrypted remote state, identity,
networking, storage, PostgreSQL, queues, serverless application runtime, observability, and cost
controls.

## Layout

- `bootstrap/` — customer-KMS remote state and environment-scoped GitHub OIDC roles.
- `modules/platform/` — persistent data/network resources, API Gateway/Lambda runtime, durable
  workflows, and one-off migration capability.
- `modules/cost-controls/` — AWS Budgets alerts and CUR 2.0 export storage.
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

The retained ECS cluster has no service. It exists only to run a reviewed database migration as a
short-lived Fargate task. `ai-job-apply/migration` is the sole application ECR repository and must
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

Use Terraform 1.9.8, the exact environment SSO profile/account, the encrypted state bucket, a clean
upstream-matched `main`, refresh-backed saved plans, and explicit SHA-256 review before apply.
Database changes must use the dedicated migration digest and pass fail-closed migration checks.
Never print plan bodies, secrets, raw logs, candidate identifiers, or state values into shared
evidence.
