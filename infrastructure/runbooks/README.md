# Operational Runbooks

Contains executable, reviewed procedures for incidents and uncommon but high-impact operations.

## Planned subfolders

- `incidents/` — Triage, communications, roles, and severity handling.
- `restore/` — Database, object, search, and workflow recovery.
- `providers/` — AI, email, push, billing, OAuth, and ATS outages.
- `security/` — Token compromise, account abuse, and data exposure.
- `deployments/` — Rollback, migration, adapter kill switch, and bad release.
- `privacy/` — Export/deletion failure and takedown handling.
- `exercises/` — Game-day and restore-test records.

Every alert and privileged admin operation should link to a relevant runbook.

## Phase 0 procedures

- [Development alert delivery](observability/development-alert-delivery.md) — Creates encrypted
  operational routing and proves ALARM/OK delivery with a dedicated synthetic metric.
- [Development provider and log recovery](providers/development-provider-and-log-recovery.md) —
  Separately proves fresh Auth0 login failure/recovery and gateway log-delivery alarm/recovery.
- [Temporal Cloud runtime secret](temporal-cloud-runtime-secret.md) — Creates the least-privilege
  worker key, stores it directly in AWS Secrets Manager, verifies namespace access without
  printing the value, and defines safe rotation.
- [Development database migration](deployments/development-database-migration.md) — Provisions and
  runs the one-off migration task while long-running application services remain disabled.
- [Staging application rollout](deployments/staging-application-rollout.md) — Enables and verifies
  the isolated AWS/Temporal staging runtime under the temporary synthetic-only Auth0 exception,
  then defines its application-only rollback boundary.
- [Development PostgreSQL point-in-time restore](restore/development-postgresql-point-in-time.md) —
  Creates and validates a private disposable restore, measures recovery, and proves complete
  cleanup without changing the source database.
