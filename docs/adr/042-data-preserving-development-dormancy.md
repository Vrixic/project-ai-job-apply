# ADR-042: Data-preserving development dormancy

Date: 2026-10-08
Status: Accepted for owner-authorized prelaunch shutdown; deployed evidence tracked separately

## Context

The owner requires AWS test runtimes off between authorized test sessions. September development
cost was $151.27 versus $79.74 in August, primarily NAT availability and private endpoint hours.
ADR-018's continuously available development assumption is superseded. Its synthetic staging
database deletion procedure is not suitable for development data.

Feature deployment flags can own export/recovery buckets, keys and secrets. Turning those flags
off is not a safe runtime shutdown. A stopped RDS instance also restarts after seven days.

## Decision

Retain the separately implemented traffic/trigger shutdown and private endpoint switch. Add an
independent development database lifecycle: retained, snapshot-prepared, dormant and restore.
Only development may use the new lifecycle; production and staging retain their own boundaries.

Before dormancy, require no application routes, enabled rules/consumers, queued work, active
durable executions or ECS tasks. Retain all feature storage, credentials, encryption keys,
network/security definitions, immutable artifacts and recovery journals. Capture only non-secret
connection metadata in private lifecycle inputs to preserve retained configuration while RDS is absent.

Owner revision (2026-10-10): create a current encrypted safety snapshot, verify availability and
bind its physical source ID/KMS key to the live database. A private physical restore rehearsal and
formal recovery-proof receipt are optional diagnostics, not dormancy or D3 gates. Preserve basic
migration and completed-deletion reconciliation checks before serving a restored database.

Use a separately reviewed preparation plan to remove deletion protection without deleting RDS.
The dormant plan may then delete only that database, with a unique final snapshot and automated
backups retained. Verify the final snapshot before removing the temporary restore instance.
Never delete a source snapshot, key, state object, secret, bucket or recovery journal for savings.

Restoration must explicitly name the exact retained snapshot. Development's default is dormant;
missing recovery inputs fail validation rather than silently creating an empty database. Restore
dark-first, validate database/authentication/privacy readiness, then separately release networking
and traffic. Preserve the restore snapshot input for the lifetime of the restored instance.

## Consequences

There is no database instance left to restart while dormant. Snapshot, key, object, log, secret and
DNS/control-plane storage can still incur charges; dormancy is not a zero-cost claim. Reactivation
takes longer and requires an explicit bounded test session. The operator binds applies to exact
plan/source checksums, the development SSO account and locked encrypted state.
