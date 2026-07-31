# Deployment Runbooks

Contains reviewed operational procedures for schema changes, application rollout, rollback, and
bad-release containment. Each procedure must identify the exact environment, immutable artifact,
saved infrastructure plan, success evidence, and recovery boundary.

## Current procedures

- [Development database migration](development-database-migration.md) — Provisions and runs the
  one-off Phase 0 migration task without enabling long-running application services.
- [Development application rollout](development-application-rollout.md) — Reviews, enables,
  verifies, and, when necessary, rolls back the lean gateway and worker deployment.
- [Staging application rollout](staging-application-rollout.md) — Reviews, enables, verifies, and
  returns the synthetic-only staging gateway and worker to their on-demand posture.
- [Staging application recovery](staging-application-recovery.md) — Proves controlled task
  replacement plus checksum-gated application-only disablement and exact re-enablement without
  changing persistent infrastructure or migration history.
