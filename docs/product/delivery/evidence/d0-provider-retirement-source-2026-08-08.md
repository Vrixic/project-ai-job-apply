# D0 provider-retirement source — 2026-08-08

## Proven preconditions

Development and staging each passed an environment-scoped read-only Temporal retirement
preflight. The exact managed credential remained active for inspection and each namespace returned
zero running workflows. No credential, namespace/account identifier, workflow identifier, or
candidate identifier was printed or retained.

Both environments had already accepted the Lambda/durable runtime, legacy ECS retirement,
authenticated preference persistence, and non-disclosing two-account operation isolation.

## Local implementation

- Local Compose and `pnpm dev` no longer require Temporal. The workflow workspace runs the same
  durable handler/activity contracts through the official local durable runner and a bounded
  PostgreSQL outbox reconciler.
- Migration `0003_retire_legacy_dispatch` fails if any unpublished Temporal row exists, relabels
  only published history as `retired_legacy`, and makes `lambda_durable` the only new dispatch
  default.
- Terraform removes the obsolete ECS gateway/worker source, Cloud Map, VPC Link, Temporal secret,
  gateway/worker ECR repositories, task role, ingress security group, and heartbeat resources.
  It retains API Gateway/Lambda, durable workflows, RDS/backups, KMS, S3, queues/DLQs, alarms,
  budgets, and an empty ECS cluster with a one-off migration task.
- A dedicated immutable, scan-on-push, KMS-encrypted `ai-job-apply/migration` repository and
  migration-only Dockerfile replace the overloaded gateway image. The runtime image contains only
  the deployed production package closure; generated/dependency/environment files are excluded
  from the build context.
- The guarded provider-retirement operator stages repository creation, exact-digest task update,
  fail-closed migration, external-key revocation proof, explicitly confirmed legacy-image purge,
  checksum-reviewed cleanup, and zero-drift verification independently per environment.

## Verification

- Full repository `pnpm check` passed.
- Disposable PostgreSQL migration/integration rehearsal passed all three tests and removed its
  temporary database.
- The pinned distroless migration image built locally, ran migration `0003` successfully against a
  separate disposable PostgreSQL database, and was removed after verification.
- Terraform format/validation passed.
- Terraform module tests passed four of four steady-state runtime/durable/migration boundaries.
- The provider-retirement PowerShell source parses under Windows PowerShell, its help contract
  passes, and a dirty checkout is rejected before Terraform planning.

No AWS resource, provider key, ECR image, secret, database row, route, trigger, or application
artifact changed during this source work. Cloud execution remains separately gated by merge,
environment-specific saved plans/checksums, the migration image, and explicit destructive
authorization.
