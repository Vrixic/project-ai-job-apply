# Terraform

Defines persistent cloud resources, identity, networking, storage, databases, queues, encryption, and environment composition.

## Planned subfolders

- `modules/` — Reusable narrowly scoped infrastructure modules.
- `environments/` — Development, staging, and production composition.
- `bootstrap/` — State backend and initial identity setup.
- `policies/` — IAM and security policies.
- `tests/` — Validation, policy, plan, and drift checks.

State and secrets remain in managed backends. Modules expose explicit inputs/outputs and default to
least privilege, lean capacity, recoverable state, and an explicit path to Multi-AZ resilience.
Every remote S3 backend initialization must resolve the environment bucket's customer-managed KMS
key and pass it as `kms_key_id`; `encrypt=true` alone can cause the backend client to write SSE-S3
objects despite a KMS bucket default. Verify fresh state-object metadata after every apply that
changes this boundary.

## Phase 0 implementation

- `bootstrap/` creates encrypted remote state and an environment-scoped GitHub OIDC role.
- `modules/platform/` creates the network, lean data plane, queues, registries, ECS services,
  API Gateway/Cloud Map ingress, encryption, logs, and alarms.
- `modules/cost-controls/` creates same-account AWS Budgets alerts and CUR 2.0 Data Exports with
  private, versioned billing-evidence storage.
- `environments/development/` and `environments/staging/` compose separate AWS accounts.

The primary region is `us-east-2`. Application deployment defaults to disabled and cannot be
enabled without immutable images, an environment-specific Auth0 issuer, and Temporal Cloud.
Auth0 tenants and credentials are provisioned outside this AWS module and must satisfy the
[identity baseline](../../docs/security/auth0-configuration-baseline.md) before application
enablement.

Per [ADR-013](../../docs/adr/013-lean-until-demand-cloud-runtime.md), the default footprint uses one
gateway, one worker, Single-AZ PostgreSQL, no Redis, no NAT gateway, and no Application Load
Balancer. API Gateway reaches ECS through VPC Link and Cloud Map; application tasks use restricted
public-subnet egress. High availability, private application networking, Redis, extra replicas,
and continuously provisioned staging are explicit measured-demand or launch-review changes.

## Accepted scale-to-zero migration target

[ADR-016](../../docs/adr/016-scale-to-zero-application-runtime.md) supersedes the continuously
running gateway/worker and VPC Link/Cloud Map portions of ADR-013. The current module remains the
deployed baseline until [D0-016](../../docs/product/delivery/phase-0-serverless-runtime-migration.md)
is implemented and accepted; source configuration is not yet deployed evidence for the target.

The completed composition will retain API Gateway, RDS, SQS/DLQ, S3, KMS, backups, cost controls,
and an empty/on-demand ECS boundary, while replacing the gateway and general workflow worker with
versioned Lambda and Lambda durable functions. The migration plan owns the exact create/cutover/
rollback/delete sequence and requires removal of obsolete VPC Link, Cloud Map, ECS service/task,
ECR, Temporal-secret, heartbeat, output, script, and runbook paths after acceptance.

[ADR-017](../../docs/adr/017-zero-traffic-precutover-ecs-idle-posture.md) permits the confirmed
zero-traffic development and synthetic-staging environments to stop continuous ECS compute before
Lambda cutover. Their environment roots default `run_continuous_ecs_runtime` to false, while the
reusable platform module defaults it to true. The guarded operator must prove zero outbox/Temporal
work and apply only the two service desired-count and two heartbeat-alarm updates. ECS services,
task definitions, images, VPC Link, Cloud Map, and Temporal access remain until the later reviewed
retirement plan.

The first dark-deployment source is guarded by `deploy_gateway_lambda = false`. Enabling it requires
the exact immutable S3 key and object version, hexadecimal and base64 artifact digests, the reviewed
versioned `us-east-2` AWS Parameters and Secrets extension layer ARN, the existing API/OIDC runtime,
and a reserved-concurrency ceiling. It creates a versioned function and environment alias, dormant
JWT authorizer, exact-stage invocation permission, private RDS path, single-AZ Secrets Manager
interface endpoint, and alarms. It intentionally creates no Lambda integration or route, so the
current ECS API path cannot move during a dark deploy.

The environment roots use AWS provider 6.x because provider 5.100 does not recognize the accepted
Node.js 24 Lambda runtime. A refresh-backed provider-upgrade/no-drift plan is mandatory before the
first dark apply; local validation alone is not deployed evidence.
