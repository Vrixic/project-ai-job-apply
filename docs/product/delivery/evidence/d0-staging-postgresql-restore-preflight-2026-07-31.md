# D0 Staging PostgreSQL Restore Preflight — 2026-07-31

## Scope

This record covers the read-only staging PostgreSQL PITR baseline plus the reviewed, resumable
restore operator and runbook. It does not prove a source verifier run, restore request, target
creation, functional recovery, cleanup, cost measurement, or Phase 0 completion.

No ECS task, database restore, RDS target, snapshot, backup, Terraform apply, or other AWS mutation
occurred during this preflight.

## Read-only live baseline

The temporary staging IAM Identity Center caller and Terraform `1.9.8` were used in `us-east-2`.
Sanitized inspection established:

- the exact Terraform-managed source is available, private, KMS encrypted, deletion protected,
  and Single-AZ;
- backup retention is seven days, one automated-backup record exists, and a latest-restorable
  point is present;
- exact `Project`, `Environment`, and `ManagedBy` source tags pass;
- the staging account contains one database and zero disposable restore targets;
- gateway and workflow worker are stable at the lean one-task baseline;
- live/readiness/protected responses are `200/200/401`;
- all eight managed staging alarms are `OK`;
- the immutable migration/verifier task is digest pinned for `linux/amd64`, and its ECR scan is
  complete with zero critical, high, medium, and low findings; and
- an exact-live-input refresh-backed Terraform plan reports no drift.

No account, ARN, endpoint, database/network/task identifier, image/provider value, identity,
credential, row value, raw count, raw event, or candidate value is retained here.

## Reviewed operator boundary

The new
[staging restore operator](../../../../scripts/operate-staging-postgresql-restore.ps1) and
[runbook](../../../../infrastructure/runbooks/restore/staging-postgresql-point-in-time.md) define:

- read-only `Status` with no task or restore creation;
- explicit `-Execute` gates for source baseline/task execution, restore creation, target
  verification, and cleanup;
- one ignored resumable context under staging `.terraform/`;
- one unique target name and exact project/environment/purpose/manager/start-time tags;
- a latest-point-in-time restore that stays private, encrypted, Single-AZ, isolated from
  application routing, and outside Terraform state;
- the existing immutable task definition and digest-pinned zero-finding image as verifier;
- a read-only PostgreSQL transaction that validates eight tables, one migration entry, and only
  an in-memory digest of ordered aggregate counts;
- exact source/target digest equality without writing or inspecting candidate rows;
- target deletion only after source inequality, target identity, tag, network, encryption,
  availability, and deletion-protection guards;
- bounded waits for target creation, deletion, and backup/snapshot cleanup;
- a separately explicit unverified-target cleanup gate that relaxes only the successful-verifier
  prerequisite; and
- final source/application/alarm health plus exact-input Terraform no drift before context
  removal.

The no-`-Execute` start safeguard passed. Operator `Status` and the application operator's new
read-only `NoDrift` action both passed against the current live staging environment.

## Cost and interruption expectations

The future exercise will temporarily add one RDS instance and its storage in the staging account.
It should last roughly the time required for AWS restore, read-only verification, and deletion;
the development observation was about 27 minutes but is not a staging prediction or production
objective. The operator removes the target and its automated backups at the end so there is no
intentional idle restored database.

The source and application remain online. No application is pointed to the target, and no source
secret, ECS service, API/DNS boundary, migration history, or Terraform resource is modified.

## Next authorization

Merge the operator, runbook, and this preflight record, let repository checks pass, then repeat
`Status` and `NoDrift`. An accountable operator may then explicitly authorize:

```powershell
.\scripts\operate-staging-postgresql-restore.ps1 -Action Exercise -Execute
```

The exercise must stop at the first failed gate. If interrupted, resume through the exact saved
context rather than starting a second target.
