# Operational Runbooks

Contains executable, reviewed procedures for incidents and uncommon but high-impact operations.

## Current subfolders

- `incidents/` — Triage, communications, roles, and severity handling.
- `restore/` — Database, object, search, and workflow recovery.
- `providers/` — AI, email, push, billing, OAuth, and ATS outages.
- `security/` — Token compromise, account abuse, and data exposure.
- `deployments/` — Rollback, migration, adapter kill switch, and bad release.
- `observability/` — Alert delivery, tracing, workload, and cost inspection.

Privacy-specific and additional exercise procedures are added with their owning capabilities. A
directory name is not evidence that an operational process is staffed or exercised.

Every alert and privileged admin operation should link to a relevant runbook.

## Phase 0 procedures

- [Phase 0 incident response](incidents/phase-0-incident-response.md) — Classifies, contains,
  recovers, reconciles, and closes foundation incidents without copying sensitive values into
  ordinary evidence.
- [Vulnerability intake and remediation](security/vulnerability-management.md) — Defines exact
  intake, triage, containment, remediation, exception, retest, and closure boundaries.
- [Development alert delivery](observability/development-alert-delivery.md) — Creates encrypted
  operational routing and proves ALARM/OK delivery with a dedicated synthetic metric.
- [Staging alert delivery](observability/staging-alert-delivery.md) — Proves the isolated staging
  ALARM/OK notification path through the environment-scoped synthetic canary.
- [Development Auth0 recovery](providers/development-provider-and-log-recovery.md) — Proves fresh Auth0 login
  failure/recovery without an identity bypass or AWS mutation.
- [Serverless application release](deployments/serverless-application-release.md) — Releases and
  verifies immutable API Gateway/Lambda and Lambda durable artifacts through exact saved plans.
- [Database migration](deployments/database-migration.md) — Runs the retained hardened one-off
  migration task without introducing a continuously running application service.
- [Development PostgreSQL point-in-time restore](restore/development-postgresql-point-in-time.md) —
  Creates and validates a private disposable restore, measures recovery, and proves complete
  cleanup without changing the source database.
- [Staging PostgreSQL point-in-time restore](restore/staging-postgresql-point-in-time.md) —
  Rehearses isolated staging PITR with resumable state, immutable read-only verification, guarded
  deletion, and final application/no-drift acceptance.
- [Staging workload and initial cost acceptance](observability/staging-workload-and-cost.md) —
  Measures the fixed authenticated foundation workload, lean runtime signals, and attributable
  development/staging billing without exposing session or provider data.

## Phase 1 procedures

- [Development document-processing acceptance](deployments/development-document-processing-acceptance.md) —
  Executes the generated-synthetic direct-dark document lifecycle with exact runtime, claim,
  privacy, recovery, and cleanup guards while all document-processing triggers remain disabled.
- [Ingestion dark release](providers/synthetic-ingestion-dark-release.md) — Verifies the durable
  ingestion packet, its generated-synthetic and bounded public ATS adapters, provider/source
  default-off controls, and shared lifecycle activation authority without authorizing publication,
  AWS mutation, provider activation, or real data.
