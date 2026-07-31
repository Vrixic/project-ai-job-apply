# D0 Staging PostgreSQL Restore Evidence — 2026-07-31

## Scope

This record covers one isolated latest-point-in-time restore of the Terraform-managed PostgreSQL
database in the dedicated synthetic AWS staging environment in `us-east-2`. It proves that the
deployed staging backup chain can create a private, encrypted, functionally valid disposable copy
while the source database and lean application stay online.

It does not establish a production RTO/RPO objective, production high availability, cross-region
recovery, restore of real candidate data, identity-provider isolation, or accountable
legal/privacy or security/privacy approval. Staging remains synthetic-only and temporarily shares
the exact development Auth0 issuer under [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md).

No account, database, endpoint, VPC, subnet, security-group, task, log-stream, secret, identity,
row value, raw count, raw log event, provider value, or candidate value is retained in this
record.

## Preconditions and source baseline

The reviewed preflight and resumable operator merged through
[PR #49](https://github.com/Vrixic/project-ai-job-apply/pull/49). Before mutation, the operator
proved:

- a temporary IAM Identity Center caller in the exact staging account and Terraform `1.9.8`;
- one available, private, KMS-encrypted, deletion-protected, Single-AZ source with seven-day PITR
  and a current latest-restorable point;
- two stable lean application services with `200` live, `200` readiness, protected `401`, and all
  eight managed alarms `OK`;
- the digest-pinned `linux/amd64` verifier image had a complete zero-finding ECR scan;
- zero pre-existing disposable targets and no restore context; and
- a refresh-backed exact-input Terraform plan reported no drift.

The first source-verifier task failed before any restore request because an inline module evaluated
from the workspace root could not resolve the pnpm-linked `postgres` dependency. The operator
stopped without a context or target. [PR #50](https://github.com/Vrixic/project-ai-job-apply/pull/50)
anchored dependency resolution to the profile-service workspace and derived the deterministic
CloudWatch stream when ECS omits `logStreamName`. The corrected source verifier exited `0`, emitted
exactly one sanitized result event, and proved the eight expected tables plus exactly one
`0001_foundation` migration entry.

The verifier used one read-only transaction, held aggregate table counts only in memory, and
hashed them into a digest. No row value or raw count was printed or retained.

## Isolated restore and functional verification

AWS accepted exactly one restore request at `2026-07-31T16:16:45Z`. The target was never added to
Terraform state, API routing, Cloud Map, or an application service. It preserved the approved
engine/version, class, storage, database identity, KMS key, VPC, private subnet group, database
security group, IAM database-authentication setting, PostgreSQL log export, parameter group,
option group, and CA boundary. It was private, Single-AZ, and deletion-protection-disabled only for
guarded disposal.

AWS emitted its restoration event 603 seconds after the request, then completed initial
configuration and backup transitions. Immediately after the first observed stable `available`
state, the exact five target tags had not yet converged through the read API, so the operator
failed closed before target verification. A later read proved all five tag keys and values exactly
matched the saved context. The exercise resumed from that context rather than requesting another
restore. The operator now includes a bounded five-minute post-availability convergence wait so
future exercises tolerate this observed provider behavior without weakening the boundary.

The target verifier then exited `0` and emitted exactly one sanitized result event. It kept the
managed source connection secret in Secrets Manager and overrode only the restored hostname in
task memory. It proved:

- all eight expected foundation tables existed;
- exactly one expected migration journal entry existed;
- the restored aggregate digest exactly matched the source baseline; and
- the controlled verifier log contained zero forbidden credential, candidate, email, or JWT
  patterns.

Functional recovery completed 1,934 seconds after the restore request, or 32 minutes 14 seconds.
This is an observed staging measurement, not an approved production recovery objective.

## Guarded cleanup and final state

After verification, the operator re-resolved the exact target and required source inequality,
availability, private networking, encryption, deletion-protection-disabled state, exact current
configuration, and all five current-exercise tags. AWS accepted exactly one delete request at
`2026-07-31T16:49:30Z` and emitted the deletion event 206 seconds later. The final snapshot was
intentionally skipped and target automated backups were deleted.

Final acceptance established:

- zero disposable restore instances, manual snapshots, or target automated backups remained;
- the ignored restore context was removed;
- the source remained available, private, encrypted, deletion protected, and covered by seven-day
  PITR with a current latest-restorable point;
- both services remained stable at the lean one-task baseline;
- all eight managed alarms remained `OK`; and
- a final refresh-backed exact-input Terraform plan reported zero drift.

This closes the staging PostgreSQL restore substep of D0-006/D0-011. Reproducible workload and
initial operating-cost acceptance remain open, along with the separately tracked accountable
legal/privacy and security/privacy approvals.
