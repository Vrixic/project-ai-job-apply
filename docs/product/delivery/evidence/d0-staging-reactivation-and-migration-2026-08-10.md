# D0 Staging Reactivation and Migration — 2026-08-10

## Disposition

The first D0-017 recreation drill has restored the synthetic staging data plane from dormant and
applied every current database migration. Staging remains dark: the API has no public routes, all
workflow triggers are disabled, and queues are empty. No candidate-facing or ATS traffic is
authorized by this record.

The traffic-transition source is implemented locally but remains unapplied. Merge, fresh exact-main
planning, checksum review, apply, and acceptance still remain.

Subsequent work completed those boundaries and returned staging to dormancy. See the
[reactivation acceptance record](d0-staging-on-demand-reactivation-acceptance-2026-08-10.md). This
record retains the exact earlier dark-recreation and migration disposition rather than rewriting
the sequence as though traffic had already been released at this point.

## Dark activation

The lifecycle operator reconfirmed the exact dormant boundary before planning. The hardened
refresh-backed active plan passed its exact action and semantic guards:

- eight creates: encrypted private RDS, current database-secret version, three private-DNS
  interface endpoints, the on-demand migration task definition, and two database alarms;
- one operations-dashboard update from the dormant placeholder to the recreated database metric
  identifier;
- zero deletes, replacements, routes, event-source mappings, or EventBridge-rule changes; and
- RDS deletion protection enabled, seven-day backups, encrypted storage, and no public access.

The product owner explicitly approved SHA-256:

```text
d876a0bf5da2c6ab5a39e57a8a9735ff6d861a120ac7c78f4fcdc4b161800e9d
```

The exact plan applied successfully. Final live status was:

```json
{
  "Environment": "staging",
  "Mode": "active",
  "DatabasePresent": true,
  "DatabaseDeletionProtection": true,
  "ManagedInterfaceEndpoints": 3,
  "PublicRuntimeRoutes": 0,
  "EnabledEventMappings": 0,
  "EnabledEventRules": 0,
  "AggregateQueueDepth": 0
}
```

The database and endpoints now accrue their normal hourly charges until the bounded exercise returns
staging to dormant.

## Migration preflight

Read-only inspection proved:

- temporary IAM Identity Center caller and exact isolated staging state;
- database `available`, encrypted, non-public, deletion protected, and covered by seven-day backups;
- one active Fargate/`awsvpc` Linux `X86_64` task definition with read-only root filesystem;
- exact digest-pinned migration image, one `DATABASE_URL` secret reference, and no other secret;
- image scan `COMPLETE` with zero High and zero Critical findings;
- two reviewed migration subnets and the application security group; and
- zero running ECS tasks.

No identifier, image URI/digest, network value, secret, database URL, or raw log is recorded here.

## Migration execution

Exactly one on-demand Fargate task ran with the task definition's default migration command. It:

- reached `STOPPED` with exit code `0`;
- applied and verified migrations through `0003_retire_legacy_dispatch` inside the migration
  runner's advisory-lock and transaction boundary;
- emitted exactly one allowlisted sanitized success event; and
- returned the cluster to zero running tasks.

No retry occurred.

## Synthetic-data boundary

The Phase 0 schema binds candidate ownership to the managed OIDC `issuer + subject`. The repository
therefore has no direct database-seed executable that invents external identities. The approved
synthetic ATS HTML fixture is a source-controlled parser/adapter input and is not profile-database
seed data.

For this drill, synthetic profile and workflow records must be created through the normal
authenticated API by the approved disposable conformance accounts. That path simultaneously proves
identity mapping, owner-scoped persistence, durable orchestration, and cross-account denial. Later
capabilities may load their own approved fixtures only through an explicit owned seed contract.

## Traffic guard prepared locally

The existing lifecycle operator now also owns checksum-gated traffic transitions:

- enable only from the exact protected dark-active boundary;
- create exactly the JWT default route plus two anonymous health routes;
- enable exactly the outbox SQS mapping and two EventBridge rules;
- preserve exact `profile:read`/`profile:write` scopes;
- disable through the exact inverse six actions only when queues are empty; and
- reject every unrelated update, delete, replacement, artifact, IAM, data, or observability change.

Quiescence now supports both safe shutdown paths: seven actions from live traffic or the single RDS
deletion-protection update from an already-dark active environment. This permits recovery after an
activation fails before traffic release.

Local PowerShell parsing/help, infrastructure policy, formatting, lint, type checking, tests, and
`git diff --check` must pass before publication. No traffic plan or AWS mutation is claimed for this
source work.
