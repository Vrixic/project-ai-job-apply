# Deployment Runbooks

Contains reviewed operational procedures for schema changes, application rollout, rollback, and
bad-release containment. Each procedure must identify the exact environment, immutable artifact,
saved infrastructure plan, success evidence, and recovery boundary.

## Current procedures

- [Development database migration](development-database-migration.md) — Provisions and runs the
  one-off Phase 0 migration task without enabling long-running application services.
