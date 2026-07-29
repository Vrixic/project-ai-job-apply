# D0 Development Persistent Platform Evidence — 2026-07-29

## Scope

This record covers the first persistent-platform deployment in the dedicated AWS development
account in `us-east-2`. Applications remained disabled. It does not prove application deployment,
API Gateway or Cloud Map behavior, migrations, Auth0 against the deployed gateway, Temporal Cloud
execution, populated telemetry, alert delivery, rollback, database restore, staging, or Phase 0
completion.

## Reviewed source and plan

- Source revision: `d348a75744428a6427e32b9a5f3fcb6bc86b0e3c`.
- Review vehicle: draft pull request
  [#9](https://github.com/Vrixic/project-ai-job-apply/pull/9).
- Remote checks passed:
  [CI](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30487631251),
  [static analysis](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30487631244), and
  [Terraform validation](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30487631280).
- Terraform version: `1.9.8`.
- Caller: temporary AWS IAM Identity Center administrator session in the dedicated development
  account; no long-lived AWS access key was used.
- Saved persistent-plan SHA-256:
  `92CD8366687F8959A1EA82D6C8F3904B16828E76774892D6EEC35324547C0DF2`.
- Reviewed actions: 42 creates, 0 updates, 0 deletions.
- Apply result: 42 added, 0 changed, 0 destroyed.
- A second saved plan added only safe root outputs and contained zero resource changes. Its
  SHA-256 was `1DC94413D31392770466195E47706D13317C52F6ACE758E4718626E718A127D9`.
- Final refresh-backed plan: no changes.

The plan explicitly set `deploy_applications`, high availability, private application networking,
Redis, RDS Performance Insights, and ECS Container Insights to `false`. The plan contained no NAT,
Elasticache, API Gateway, Cloud Map, ECS task definition, or ECS service resource.

## Live controls verified

### Network and identity

- One DNS-enabled VPC spans two public and two private subnets across two availability zones.
- The ingress security group has no public ingress rules.
- The future application security group accepts port 4000 only from the ingress security group.
- The data security group accepts PostgreSQL port 5432 only from the application security group.
- No NAT gateway exists.
- ECS execution and application roles use the environment workload permissions boundary.

### Encryption, storage, queues, and secrets

- The platform customer-managed KMS key is enabled with automatic key rotation.
- Its key policy delegates account IAM control and narrowly authorizes the regional CloudWatch
  Logs service for the application log group encryption context.
- The artifact bucket has versioning, KMS default encryption, S3 Bucket Keys, and every public
  access block enabled.
- The event queue and dead-letter queue use the platform KMS key. Event redrive is configured;
  event retention is four days and dead-letter retention is fourteen days.
- The database URL secret is KMS encrypted and has a generated value without exposing it in
  evidence.
- The KMS-encrypted Temporal API-key destination exists with zero value versions; no placeholder
  credential was inserted.

### Database

- RDS PostgreSQL `16.14` is `available` on `db.t4g.micro` with encrypted `gp3` storage.
- The instance is private, Single-AZ, deletion-protected, and IAM database authentication is
  enabled.
- Seven-day automated backup retention and a backup window are configured.
- AWS reports a latest restorable point, establishing current PITR availability; an isolated
  restore test remains required.
- PostgreSQL log export is enabled and its CloudWatch log group exists.

### Runtime preparation and observability

- The ECS cluster is active with zero services and zero running tasks.
- Gateway and worker ECR repositories are KMS encrypted, immutable-tagged, and scan on push.
- The KMS-encrypted application log group retains logs for 30 days and is currently empty.
- Four metric alarms exist for RDS CPU, RDS free storage, dead-letter messages, and event-queue
  age. They currently have no notification action; alert routing remains observability work.
- API Gateway, Cloud Map, ECS application services, and a public application endpoint do not
  exist while applications are disabled.

## Secret handling

The generated saved plan contained sensitive database material and was retained only through exact
plan review and apply. Local plan files were removed after hashes and results were recorded. No
database endpoint, generated password, API key, token, or raw Terraform state is included here.

## Remaining acceptance

- Merge pull request #9 so `main` matches the deployed persistent state.
- Place the dedicated expiring Temporal Cloud API key directly into the empty managed secret.
- Build, scan, and push immutable images; run the controlled migration; and review application
  enablement separately.
- Deploy API Gateway, Cloud Map, one gateway, and one worker only with the reviewed application
  prerequisites.
- Prove deployed authentication, owner isolation, persistence, outbox/Temporal completion,
  telemetry/redaction, alert delivery, rollback, and PostgreSQL restore.
- Rehearse isolated staging on demand.
