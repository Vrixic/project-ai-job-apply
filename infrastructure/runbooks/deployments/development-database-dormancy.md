# Development database dormancy

Use after [runtime/network shutdown](development-prelaunch-shutdown.md), under
[ADR-042](../../../docs/adr/042-data-preserving-development-dormancy.md). Never use staging's
synthetic database disposal procedure for development. Never apply an old binary plan again.

## Capture and prepare

1. Use the exact development temporary SSO identity, region `us-east-2`, Terraform 1.16.2 and the
   encrypted, locking S3 backend. Capture the full latest applied inputs and state privately under
   this checkout's ignored `.tmp/`. Do not reconstruct inputs from an old feature-release plan.
2. Verify the existing shutdown and drain. Leave deployment/storage flags unchanged. Capture the
   database address, port, database name and resource ID in `development_database_recovery`.
   Choose a unique `ai-job-apply-development-shutdown-<UTC timestamp>` final snapshot name.
3. Establish a resource-change-free baseline with `development_database_mode=retained`.
4. If stopped, temporarily start the database only to capture its safety backup. Keep application
   traffic and background work off. Wait for `available`, then create an encrypted manual safety
   snapshot named `<final snapshot name>-safety`.
5. Wait for that exact snapshot to be available and verify its source database, account, region
   and KMS key. A physical restore rehearsal and restore-proof receipt are not required.

## Review and apply

Initialize the backend explicitly with `use_lockfile=true`; select the verified portable Terraform
first. The operator also checks exact backend identity, source checksum, account and drain.

```powershell
./scripts/operate-development-database-lifecycle.ps1 -Action Plan `
  -TargetMode snapshot-prepared -ExpectedAccountId ACCOUNT -StateBucket BUCKET `
  -InputPath ABSOLUTE_PRIVATE_INPUT -PlanPath ABSOLUTE_PRIVATE_PLAN

./scripts/operate-development-database-lifecycle.ps1 -Action Apply `
  -TargetMode snapshot-prepared -ExpectedAccountId ACCOUNT -StateBucket BUCKET `
  -PlanPath ABSOLUTE_PRIVATE_PLAN -ReviewedPlanSha256 EXACT_REVIEWED_SHA256
```

Preparation may update only database deletion protection and backup/final snapshot settings.
After preparation, generate a fresh plan with mode `dormant` and otherwise identical inputs. Review
exactly one deletion: `module.platform.aws_db_instance.postgres[0]`. The before-state must require
a final snapshot, preserve automated backups, and have deletion protection off. Apply with the
the same interface. The operator rechecks the live exact-source encrypted safety snapshot before
applying; no `-RestoreProofPath` is required.

Wait for original database absence and the final encrypted snapshot's `available` state. Keep
source safety/final snapshots and automated backups. Verify no NAT/EIPs/interface endpoints,
application routes/consumers/rules or running tasks. Archive complete current dormant inputs
privately in the encrypted versioned state bucket; never commit environment inputs or state.
Record retained storage costs and any shutdown blockers.

## Reactivation

Start from the **latest dormant inputs**, not a historical active plan. Set mode `restore` and
`development_database_recovery.restore_snapshot_identifier` to the exact final snapshot. Verify
its account, source database, availability and KMS key first. Ordinary restore rejects a selected
snapshot that differs from the reviewed
`final_snapshot_identifier`, including a stale pre-transition snapshot alongside newer recovery
metadata. The actual database creation must also use that exact selection. Retained, preparation
and dormancy inputs preserve their historical restore identifier to avoid resource replacement.
Recovery from a known rollback using an older verified snapshot requires separate selection and
data-provenance review; do not silently rewrite the latest recovery identity to bypass this guard.
Plan and inspect the private protected database creation and any required public-reader
IAM/configuration updates or connection-secret
version refresh within the existing secret. The operator refuses
unrelated resource changes; unusual restoration differences require an explicit reviewed extension.

Restore with runtime off. The new RDS resource ID can require IAM policy changes even when the
hostname stays the same. Validate credentials, schema, migrations, candidate deletion/recovery
replay and readiness before separately enabling a bounded test session. Keep the restore snapshot
input unchanged in subsequent plans to avoid replacement. For the next shutdown use a **new** final
snapshot name and a fresh encrypted safety snapshot.

## Failure handling

On any failure retain snapshots, original data and recovery metadata. Never force-unlock another
operator or apply stale plans. Reconcile current state and generate a new saved plan. If an instance
is temporarily stopped, report its automatic restart exposure as incomplete shutdown. Remove any
temporary restorecheck instance before handoff once another verified recovery copy is available.
Never quietly leave a restore test running after a failed test.
