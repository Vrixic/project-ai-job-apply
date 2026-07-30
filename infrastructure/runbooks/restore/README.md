# Restore Runbooks

Contains controlled recovery procedures for databases, object storage, search indexes, and durable
workflow state. Every procedure must isolate the restored copy, preserve the source, define
privacy-safe verification, measure recovery, and remove temporary data-bearing resources after
evidence is retained.

## Current procedures

- [Development PostgreSQL point-in-time restore](development-postgresql-point-in-time.md) —
  Restores the synthetic development RDS database into a private disposable instance, validates
  schema and aggregate integrity from ECS, measures recovery, and proves cleanup.
