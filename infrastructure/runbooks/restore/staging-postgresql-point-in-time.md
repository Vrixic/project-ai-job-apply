# Staging PostgreSQL Point-in-Time Restore

This exercise requires `staging_runtime_mode = "active"`. Finish and remove every disposable
restore target before staging enters `quiesced`; dormant staging intentionally retains no source
database or recovery snapshot under ADR-018.

Use this procedure to prove that the dedicated synthetic-only staging PostgreSQL automated-backup
chain can produce a private, encrypted, functionally valid disposable copy while the source
database and lean application remain online.

This is a staging recovery measurement, not a production RTO/RPO objective, cross-region recovery
claim, or authorization to restore real candidate data. Under
[ADR-014](../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md), staging remains
synthetic-only and temporarily shares the exact development Auth0 issuer without claiming
identity-provider isolation.

## Safety and cost boundary

- Authenticate through the temporary `ai-job-apply-staging-admin` IAM Identity Center profile in
  `us-east-2`; require Terraform `1.9.8`.
- Resolve only the exact Terraform-managed `ai-job-apply-staging` source and require its project,
  environment, and manager tags.
- Require the source to be available, private, KMS encrypted, deletion protected, Single-AZ,
  covered by seven-day PITR, and backed by a current latest-restorable point.
- Require an empty ECS application boundary, `200/200/401` health/access responses, enabled Lambda
  durable triggers, all current runtime alarms `OK`, and exact-input Terraform no drift.
- Require the existing migration task definition, its digest-pinned `linux/amd64` image, and a
  complete zero-finding ECR scan.
- Permit exactly one uniquely named target with `Project=ai-job-apply`, `Environment=staging`,
  `ManagedBy=restore-drill`, `Purpose=phase0-isolated-restore`, and the current `StartedAt` tag.
- Never change the source secret, application tasks/services, API/DNS, Terraform state, source
  database, migration journal, or any candidate row.
- Never print or retain a database URL, password, endpoint, account/resource/task identifier,
  identity, row value, raw count, raw log event, or provider value in shared evidence.

The disposable RDS instance and its storage incur ordinary staging-account charges only while the
exercise exists. Start the exercise only when an operator can remain through verification and
guarded deletion. The operator removes the target, automated backups, and local context at the end;
it does not leave an idle restored database.

## Read-only preflight

Set the exact environment boundary from the accepted applied plan, then run:

```powershell
$restoreBoundary = @{
  ExpectedAccountId = "STAGING_ACCOUNT_ID"
  StateBucket = "STAGING_TERRAFORM_STATE_BUCKET"
  RuntimePlanPath = ".terraform/APPLIED_STEADY_STATE_PLAN.tfplan"
}

.\scripts\operate-staging-postgresql-restore.ps1 -Action Status @restoreBoundary
```

Require:

- one healthy managed source and zero disposable restore targets;
- a current latest-restorable point and seven-day retention;
- source private/encrypted/deletion-protected/Single-AZ booleans;
- zero ECS application services/tasks, enabled durable triggers, all managed runtime alarms `OK`,
  and Terraform drift `0`;
- a clean immutable verifier image; and
- no ignored restore context.

`Status` does not run an ECS task, request a restore, create a target, or change AWS.

## Start and measure the isolated restore

After merge and explicit authorization, run:

```powershell
.\scripts\operate-staging-postgresql-restore.ps1 -Action Start -Execute @restoreBoundary
```

The operator:

1. repeats all source/application/no-drift guards;
2. starts the immutable one-off Fargate verifier against the source-managed connection secret;
3. runs one read-only PostgreSQL transaction that proves the expected tables and all three accepted
   migration journal entries, hashes only ordered aggregate counts in memory, and emits one
   sanitized digest event;
4. records the latest-restorable-point lag;
5. saves only an ignored local target/context record;
6. requests `use-latest-restorable-time` into the uniquely tagged target; and
7. waits up to 60 minutes for the first observed `available` state, then up to five minutes for
   RDS tags and configuration metadata to converge to the exact approved boundary.

The target must preserve the exact source KMS key, VPC, private subnet group, database security
group, engine/version, class, storage, database identity, IAM database-authentication state,
PostgreSQL log export, parameter/option groups, and CA certificate. It must stay private,
Single-AZ, and deletion-protection-disabled only for guarded disposal.

If the command is interrupted after AWS accepts the request, do not run `Start` again. Reauthenticate,
run `Status`, inspect the exact target, then continue with `Verify` or the emergency cleanup gate.

## Verify functional recovery

After `Start` reports the target available, run:

```powershell
.\scripts\operate-staging-postgresql-restore.ps1 -Action Verify -Execute @restoreBoundary
```

The operator re-resolves and revalidates source, target, tags, network, encryption, and database
configuration. It then runs the same immutable read-only verifier while keeping the source
`DATABASE_URL` in Secrets Manager and passing only the restored hostname as an in-memory
`RESTORE_HOST` override.

Require:

- the expected tables;
- the `0001_foundation`, `0002_serverless_outbox`, and `0003_retire_legacy_dispatch` journal entries;
- exact aggregate digest equality with the source baseline;
- verifier exit code `0`;
- zero forbidden credential/candidate/email/JWT patterns in the two verifier streams; and
- a recorded functional-recovery duration.

Do not run migrations, write test rows, inspect candidate values, or route an application service
to the restored target.

## Guarded cleanup and final acceptance

For a verified target, run:

```powershell
.\scripts\operate-staging-postgresql-restore.ps1 -Action Cleanup -Execute @restoreBoundary
```

Cleanup revalidates that the target is not the source, is available/private/encrypted,
deletion-protection-disabled, and has every exact current-drill tag. It deletes only that target,
skips a final snapshot, deletes its automated backups, waits for the instance to disappear, and
requires zero target snapshots/backups and zero remaining restore targets.

It then requires the source, application, eight alarms, and exact-input Terraform no-drift check
to remain healthy before removing the one ignored local context.

If verification cannot pass, an accountable operator may remove the exact failed disposable copy
with:

```powershell
.\scripts\operate-staging-postgresql-restore.ps1 `
  -Action Cleanup `
  -AllowUnverifiedCleanup `
  -Execute `
  @restoreBoundary
```

That switch relaxes only the verified-result prerequisite. It does not relax target identifier,
source inequality, tags, private networking, encryption, availability, or deletion-protection
guards. Record the failed exercise honestly and investigate before attempting another restore.

For an uninterrupted reviewed exercise,
`.\scripts\operate-staging-postgresql-restore.ps1 -Action Exercise -Execute @restoreBoundary` runs
Start, Verify, and Cleanup in sequence, stopping at the first failed gate and retaining the
context/target for safe recovery.
