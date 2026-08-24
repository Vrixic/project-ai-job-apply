# D1 development PostgreSQL recovery preflight — 2026-08-24

## Outcome

Exact source `602630888c4472f454f1133f0bc7b5cfc487ff76` makes the current D1 PostgreSQL
point-in-time recovery procedure executable in the synthetic development environment. Its read-only
`Status` action passes. No restore target, verifier task, context, snapshot, backup, database write,
application redirect, or deletion was requested.

The preflight closes the missing development-operator foundation. It does not claim that PITR,
functional recovery, cleanup, row-value integrity, RTO, or RPO has been exercised.

## Implemented boundary

- The proven staging restore implementation now accepts only `development` or `staging` and derives
  the exact environment directory, source/target identifiers, tags, logs, inspector, context, task
  ownership, and output from that fixed choice.
- `scripts/operate-development-postgresql-restore.ps1` is a narrow development wrapper. It preserves
  the separate `-Execute` requirement for every state-changing action and the additional emergency
  cleanup gate.
- The shared workload inspector accepts the complete current 86-variable D1 plan boundary. Its
  Terraform environment serialization preserves one-element lists instead of flattening them to
  invalid scalars.
- Development recovery requires all 44 exact current D1 alarms to exist, retain one alarm and one
  recovery action, and report `OK`.
- ECR scan verification handles omitted zero-valued severity properties while still rejecting any
  High or Critical finding.
- The runbook now describes the five-owner, eight-schema, 42-relation, twenty-migration boundary
  through Jobs `0011_positive_source_withdrawal` and the resumable `Start`, `Verify`, and `Cleanup`
  sequence.

## Live read-only result

The exact development preflight reported:

- source available: `true`;
- source private and encrypted: `true` / `true`;
- source deletion protection: `true`;
- backup retention: `7` days;
- latest restorable point present: `true`;
- ECS runtime idle: `true`;
- managed alarms `OK`: `44`;
- disposable restore targets: `0`;
- ignored restore context present: `false`;
- restore state: `none`;
- refresh-backed Terraform drift: `0` changes.

The ignored saved plan, state bucket, account/resource identities, endpoints, image identity, and
future restore context remain local and are not copied into this evidence.

## Verification

- Shared restore guard suite: pass under PowerShell 7 and Windows PowerShell 5.1.
- Complete `pnpm infrastructure:validate`: pass, including the current document, gateway, migration,
  job-search, catalog, restore, and serverless infrastructure guards.
- Development `Status`: pass against live AWS and the current 86-variable state-190 boundary.
- `git diff --check`: pass.

## Remaining authorization

The next step creates a uniquely tagged private disposable RDS copy, runs immutable aggregate-only
source/target verification, and deletes only that authenticated copy and its derivative backups.
Because creation and cleanup are material AWS mutations, run `Start -Execute`, `Verify -Execute`,
and `Cleanup -Execute` only after the repository owner explicitly authorizes this exact isolated
exercise. Failure recovery remains resumable through the ignored authenticated context.
