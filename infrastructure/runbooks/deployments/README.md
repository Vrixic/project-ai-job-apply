# Deployment Runbooks

Contains reviewed operational procedures for schema changes, application rollout, rollback, and
bad-release containment. Each procedure must identify the exact environment, immutable artifact,
saved infrastructure plan, success evidence, and recovery boundary.

## Current procedures

- [Serverless application release](serverless-application-release.md) — Publishes immutable Lambda
  artifacts, applies an exact saved plan, verifies the public/durable runtime, and defines
  fail-closed rollback without reconstructing a retired provider.
- [Development gateway release](development-gateway-release.md) — Publishes one source-bound,
  immutable gateway artifact set, limits Terraform changes to the gateway function and alias, and
  verifies the direct authenticated job-search boundary without retaining query values.
- [Database migration](database-migration.md) — Publishes the scanned migration-only image and
  runs exactly one hardened Fargate task while the retained cluster otherwise stays empty.
- [Staging runtime lifecycle](staging-runtime-lifecycle.md) — Activates isolated synthetic staging
  for bounded release exercises and returns its RDS/interface-endpoint data plane to a guarded
  dormant state.
