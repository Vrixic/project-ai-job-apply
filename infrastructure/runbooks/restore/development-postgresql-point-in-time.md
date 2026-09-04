# Development PostgreSQL Point-in-Time Restore

Use this procedure only in the dedicated synthetic development AWS account in `us-east-2`. It
proves that the Terraform-managed RDS PostgreSQL automated backups can produce an isolated,
functionally valid database copy without changing the source database or redirecting an
application service.

This is a development recovery measurement, not a production recovery objective, high-availability
claim, or authorization to restore real candidate data into a shared environment.

## Safety boundary

- Authenticate with the temporary `ai-job-apply-development-admin` IAM Identity Center profile.
- Resolve the exact Terraform-managed source and require the `Project`, `Environment`, and
  `ManagedBy` tags expected for development.
- Require the source to be available, private, KMS-encrypted, deletion-protected, and covered by
  the candidate-rights 35-day automated-backup window with a latest restorable point.
- Require stable gateway and worker services, healthy endpoints, managed alarms in `OK`, and a
  refresh-backed no-drift plan before the exercise.
- Use a unique target identifier and explicit `Purpose=d1-current-isolated-restore`,
  `ManagedBy=restore-drill`, and start-time tags.
- Never update the managed database secret, application task definitions, ECS services, DNS,
  Terraform state, or the source database.
- Never print or persist a database URL, password, endpoint, task/resource identifier, account
  identifier, row value, identity, or raw log event.

Stop if the exact account, region, source, target, backup, network, encryption, or caller identity
is ambiguous.

## Guarded operator

From the repository root, bind the exact development account, encrypted Terraform state bucket,
and an already applied current-runtime plan below the ignored development `.terraform` directory:

```powershell
$restoreBoundary = @{
  ExpectedAccountId = 'DEVELOPMENT_ACCOUNT_ID'
  StateBucket = 'DEVELOPMENT_TERRAFORM_STATE_BUCKET'
  RuntimePlanPath = '.terraform\APPLIED_CURRENT_RUNTIME.tfplan'
}

.\scripts\operate-development-postgresql-restore.ps1 -Action Status @restoreBoundary
```

`Status` is read-only. It requires the exact development account, source database, immutable
digest-pinned verifier image, healthy serverless runtime, current alarms, zero disposable targets,
and refresh-backed zero drift. It creates no database, task, context, or backup.

After separate approval of the exact output, execute the resumable sequence with one action at a
time:

```powershell
.\scripts\operate-development-postgresql-restore.ps1 -Action Start -Execute @restoreBoundary
.\scripts\operate-development-postgresql-restore.ps1 -Action Verify -Execute @restoreBoundary
.\scripts\operate-development-postgresql-restore.ps1 -Action Cleanup -Execute @restoreBoundary
```

`Exercise -Execute` performs those actions in sequence, but the explicit sequence is preferred for
reviewed Phase 1 evidence. `Cleanup -AllowUnverifiedCleanup -Execute` is emergency recovery only for
the exact authenticated disposable target; it never weakens account, tag, source, network, or
target-identity guards.

## Establish the source baseline

1. Resolve the existing immutable database-migration task definition, application subnets, and
   application security group from encrypted Terraform state.
2. Require the task image to be digest-pinned, scanned, and compatible with `linux/amd64`.
3. Run a read-only one-off Fargate verifier against the source connection secret. It must:
   - find the exact six-owner/ten-schema/68-relation Phase 2 manifest;
   - find all 39 expected migration journal entries through Profile `0009`, Jobs `0019`,
     Documents `0003`, Matching `0003`, Billing `0002`, and Trust `0003`;
   - query only aggregate row counts; and
   - emit one aggregate result for in-memory hashing.
4. Retain only the table/journal pass state and aggregate digest comparison value in operator
   memory. Do not retain individual counts in shared evidence.
5. Record the latest-restorable-point lag at the moment the restore is requested.

## Create the isolated copy

Call `restore-db-instance-to-point-in-time` with the exact managed source and
`use-latest-restorable-time`. Require the target to preserve:

- the source engine/version, instance class, storage type/size, database name, and master username;
- the source KMS key, database subnet group, VPC, and database security group;
- IAM database authentication, the PostgreSQL CloudWatch log export, parameter group, option
  group, and CA certificate; and
- private, Single-AZ development networking.

Set deletion protection to disabled only on the uniquely tagged disposable target. Do not make it
public, add security-group ingress, create a temporary plaintext secret, or add the target to
Terraform state.

Poll the control plane in bounded intervals. Measure from the accepted restore request until the
first observed `available` state. Treat any failure state as a failed exercise; do not promote or
connect applications to the target.

## Prove functional recovery

After the target becomes available:

1. Compare its encryption key, VPC, subnet group, security group, engine/version, class, storage,
   database name, master username, IAM database-authentication state, PostgreSQL log export,
   Multi-AZ state, deletion-protection state, and parameter-apply state with the approved boundary.
2. Run the same immutable one-off verifier. Keep the Terraform-managed source `DATABASE_URL` in
   Secrets Manager; pass only the non-secret restored hostname as `RESTORE_HOST`, and replace the
   hostname in memory inside the task.
3. Require the exact six-owner/ten-schema/68-relation/39-migration manifest and an exact
   aggregate digest match with the source baseline.
4. Measure functional recovery through the successful verifier exit.
5. Inspect only the two verifier streams in memory. Require zero credential/candidate-field,
   email, and JWT pattern matches, and retain only aggregate event/match counts.

If candidate rights are enabled, keep the target quiesced and run the
[candidate deletion recovery replay](candidate-deletion-recovery-replay.md) before any application
role or route can reach the restore.

Do not run migrations, write test rows, or inspect candidate values as a substitute for recovery
verification.

## Clean up and close

Before deletion, re-resolve the target and require all of these guards:

- its identifier is the unique drill target and is not the source;
- it is private, available, and not deletion-protected; and
- its project, environment, purpose, manager, and start-time tags match the current exercise.

Delete only that target with its automated backups. Skip a final snapshot because the copy is
disposable, already verified, and must not leave another data-bearing artifact. Wait until AWS
returns not found, and require no manual snapshot or automated-backup artifact for the target.

Finally require:

- the source RDS instance remains available with its backup retention and latest restorable point;
- gateway and durable Lambda triggers remain stable while ECS has no application service or task;
- live/readiness return `200` and an unauthenticated protected request returns `401`;
- managed alarms report `OK`; and
- a refresh-backed Terraform plan reconstructed from the exact live inputs reports no drift.

Record only sanitized configuration booleans, durations, aggregate verification outcomes, cleanup,
source health, and no-drift evidence. State explicitly that observed development measurements are
not adopted production RTO/RPO objectives.
