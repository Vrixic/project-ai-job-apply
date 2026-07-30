# D0 Staging Persistent Platform Evidence — 2026-07-30

## Scope

This record covers the isolated applications-disabled staging platform in AWS `us-east-2`. It
does not prove staging application deployment, Auth0 or Temporal configuration, image scanning,
database migration, authenticated workflows, observability delivery, restore, workload baselines,
cost attribution, or Phase 0 completion.

## Reviewed execution

- Terraform source: merged `main` commit `6616816fbd43cad05805c8b148b2789ecd80ebed`.
- Terraform: `1.9.8`.
- Caller: temporary AWS IAM Identity Center administrator session in the dedicated staging
  account; development/staging account inequality passed.
- Remote backend: isolated KMS-encrypted `platform.tfstate`; no prior platform-state object
  existed.
- Saved-plan SHA-256:
  `68D77C6D4E5A94DA80A4CB3CEE40B5176267F2C7A15D019373344811A7FA8241`.
- Reviewed actions: 48 creates, 0 updates, 0 replacements, 0 deletions.
- Reviewed exclusions: 0 application/API resources, 0 NAT resources, and 0 Redis resources.
- Apply result: 48 added, 0 changed, 0 destroyed.
- Immediate refresh-backed remote-state plan: no changes.

## Live controls verified

### Network and data

- The staging VPC is available with the exact non-overlapping `10.30.0.0/16` range.
- Four subnets exist; none automatically assigns public IPs.
- No security-group ingress rule permits `0.0.0.0/0`.
- No NAT gateway exists.
- PostgreSQL is available, private, KMS encrypted, deletion protected, and Single-AZ.
- PostgreSQL has seven-day backup retention, IAM database authentication, and PostgreSQL log
  export enabled.
- The platform KMS key is enabled with automatic rotation.

### Storage, queues, and registries

- The artifact bucket is versioned, KMS encrypted, and blocks every public-access mode.
- The event queue and dead-letter queue are KMS encrypted.
- The event queue has a dead-letter redrive policy and the DLQ retains messages for 14 days.
- Both ECR repositories are KMS encrypted, immutable, and scan on push.

### Runtime boundary and secrets

- The ECS cluster is active with zero services and zero tasks.
- No API Gateway API, Cloud Map namespace, or Redis replication group exists.
- Application and execution roles use the staging workload permissions boundary.
- Exactly two managed secret destinations exist.
- The database URL has one Terraform-managed encrypted version.
- The Temporal API-key destination intentionally has zero versions until a dedicated staging key
  is written directly by an operator.

### Observability and state

- The application log group is KMS encrypted with 30-day retention.
- Six persistent alarms exist, and every alarm routes both ALARM and OK actions to the encrypted
  operational SNS topic.
- The staging dashboard and application-error metric filter exist.
- Active `platform.tfstate` is reachable, KMS encrypted with the expected staging state key, and
  drift free.

No account number, VPC/subnet/security-group identifier, endpoint, bucket name, repository URL,
queue URL, role ARN, secret ARN/value, database credential, or state content is retained in this
evidence.

## Remaining staging acceptance

- Create or confirm a staging-only Temporal namespace and dedicated namespace-scoped key, then
  write it directly into the empty managed secret.
- Create or confirm a staging-only Auth0 tenant/application/API configuration.
- Publish and scan immutable staging gateway and worker images.
- Run the controlled database migration and enable the one-gateway/one-worker application.
- Prove identity, ownership isolation, workflow completion, logs/traces/alerts, restart, rollback,
  restore, workload, and cost attribution.
- Record no drift and return staging to its reviewed lean posture when acceptance finishes.
