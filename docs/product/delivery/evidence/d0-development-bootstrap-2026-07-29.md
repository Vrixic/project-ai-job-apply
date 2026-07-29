# D0 Development Bootstrap Evidence — 2026-07-29

## Scope

This record covers only the development-account Terraform bootstrap in AWS `us-east-2`. It does
not prove the persistent platform, application deployment, GitHub-originated OIDC conformance,
observability, database restore, staging rehearsal, billing, or Phase 0 completion.

## Reviewed execution

- Caller: temporary AWS IAM Identity Center administrator session in the dedicated development
  account; no long-lived IAM access key was used.
- Terraform: `1.9.8`.
- Saved-plan SHA-256:
  `D43D7CE3CB9AB4249E10E11BF9C9DEE71260D2719B914A8366B17C930DA2ADAA`.
- Reviewed actions: 12 creates, 0 updates, 0 deletions.
- Apply result: 12 added, 0 changed, 0 destroyed.
- Immediate refresh-backed plan result: no changes.

## Live controls verified

- The state bucket blocks every public-access mode.
- Bucket versioning is enabled.
- Default encryption is `aws:kms` with S3 Bucket Keys enabled.
- The customer-managed state key has automatic rotation enabled.
- Noncurrent state versions expire after 90 days.
- GitHub's OIDC provider uses audience `sts.amazonaws.com`.
- The deployment-role trust subject is restricted to
  `repo:Vrixic/project-ai-job-apply:environment:development`.
- The GitHub deployment role has a permissions boundary.
- ECS workload roles must use the environment-specific runtime permissions boundary.

## State migration

Bootstrap state was migrated from the ignored local state into the encrypted, versioned S3
backend under `bootstrap.tfstate`. A separately named KMS-encrypted pre-migration recovery object
was retained in the same private bucket. Remote state remained readable with all 12 managed
resources, a refresh-backed plan reported no changes, no stale lock remained, and local plaintext
state remnants were removed.

## Remaining acceptance

- Review and merge [draft PR #1](https://github.com/Vrixic/project-ai-job-apply/pull/1), then
  run the manual
  [AWS OIDC conformance workflow](../../../../.github/workflows/aws-oidc-conformance.yml) from
  `main`.
- Produce and review the saved persistent-platform plan with applications disabled.
- Deploy and verify logs, metrics, traces, alarms, queues, data services, and secrets.
- Run migration, application, rollback, and PostgreSQL restore acceptance.
- Retain staging as isolated, reproducibly provisionable, on-demand composition.
