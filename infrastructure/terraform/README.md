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
