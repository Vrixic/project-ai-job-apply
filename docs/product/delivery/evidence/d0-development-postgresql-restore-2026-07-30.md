# D0 Development PostgreSQL Restore Evidence — 2026-07-30

## Scope

This record covers one isolated point-in-time restore of the Terraform-managed PostgreSQL database
in the dedicated synthetic AWS development environment in `us-east-2`. It proves that the deployed
automated backup chain can create a private, encrypted, functionally valid disposable copy while
the source database and lean application remain available.

It does not establish a production RTO/RPO objective, production high availability, cross-region
recovery, staging acceptance, restore of real candidate data, or accountable legal/privacy or
security/privacy approval.

No account, database, endpoint, VPC, subnet, security-group, task, log-stream, secret, identity, row
value, raw count, raw log event, or candidate value is retained in this record.

## Preconditions and source baseline

The drill ran from merged `main` commit
`8b4b2bc8932b13afa90ae21f888929a7b07b8a6c`, after the immutable rollback evidence merged in
[PR #28](https://github.com/Vrixic/project-ai-job-apply/pull/28).

Sanitized preflight established:

- the caller used a temporary IAM Identity Center assumed role in the exact development account;
- the source was available, private, KMS-encrypted, deletion-protected, Single-AZ, and configured
  with seven-day automated backups and a latest restorable point;
- gateway and workflow worker were stable at one desired, one running, and zero pending tasks;
- live/readiness returned `200`, an unauthenticated protected request returned `401`, and all six
  managed alarms reported `OK`; and
- the immutable one-off source verifier found the eight expected foundation tables and exactly one
  `0001_foundation` migration entry.

The verifier read only aggregate table counts and converted them to an in-memory digest. No raw
count or row value was retained. At restore request time, the provider's latest restorable point
was 455 seconds behind the request, which is the observed development restore-point lag for this
exercise.

## Isolated restore and functional verification

AWS accepted a latest-point-in-time restore into a uniquely named and tagged disposable instance.
The target was never added to Terraform state or application discovery. It retained the source
engine/version, class, storage, database identity, KMS key, VPC, private subnet group, database
security group, IAM database authentication, PostgreSQL log export, parameter group, option group,
and CA boundary. It was explicitly private, Single-AZ, and deletion-protection-disabled for
controlled cleanup.

The first observed `available` state occurred 24.2 minutes after the accepted request. The same
digest-pinned migration image then ran as an isolated Fargate verifier. It kept the managed source
connection secret in Secrets Manager and replaced only the non-secret hostname in task memory.
The verifier proved:

- all eight expected tables existed;
- exactly one expected migration journal entry existed; and
- the restored aggregate data digest exactly matched the source baseline.

Functional recovery completed 1,612 seconds after the restore request, or 26 minutes 52 seconds.
These are observed development measurements, not approved production recovery objectives.

Aggregate inspection of the two verifier log streams found exactly two verifier-result events and
zero forbidden candidate/credential field, email, or JWT pattern matches. No temporary database
secret was created, no migration or test row was written, and no application service was pointed
at the restored copy.

## Cleanup and final state

Cleanup re-resolved the exact target and required its disposable purpose, manager, environment,
project, and start-time tags before deletion. AWS deleted only that target and its automated
backups. A final snapshot was intentionally skipped so the verified disposable copy left no
additional data-bearing artifact.

Final acceptance established:

- the temporary instance, manual snapshots, and automated-backup artifacts were absent;
- exactly one managed development database remained;
- the source remained available with seven-day PITR and a current latest restorable point;
- both services remained stable at the lean one-task baseline;
- live/readiness/protected responses remained `200`/`200`/`401`;
- all six managed alarms remained `OK`; and
- a final refresh-backed Terraform plan reconstructed from exact live inputs reported no drift.

This closes the isolated PostgreSQL restore substep of D0-011 and the measured restore portion of
SP-13. On-demand staging acceptance, identity/provider recovery checks, runtime-secret rotation,
quality/fixture evidence, and accountable approvals remain open.
