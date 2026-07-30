# ADR-007: Isolated AWS Environments

Status: Accepted; amended by ADR-013; lean development applications, authenticated E2E, and isolated restore evidence deployed
Date: 2026-07-28

## Decision

Use separate development and staging AWS accounts in `us-east-2`, each bootstrapped independently.
Provision persistent infrastructure with Terraform, use GitHub OIDC roles instead of access keys,
ECS/Fargate, RDS PostgreSQL, encrypted S3/SQS, KMS, Secrets Manager, immutable ECR, and managed
observability.

ADR-013 amends the initial shape to use one gateway, one worker, Single-AZ PostgreSQL, no Redis,
no NAT gateway, no Application Load Balancer, and on-demand staging until evidence requires
additional capacity. Application deployment remains fail-closed until immutable images, managed
OIDC, and Temporal are configured. The regional API Gateway endpoint requires no ACM certificate;
a certificate becomes necessary only when an approved custom domain is activated.

## Consequences

Environment compromise and changes have smaller blast radius. Account credentials and actual
deployment/restore evidence are still required to close D0.
