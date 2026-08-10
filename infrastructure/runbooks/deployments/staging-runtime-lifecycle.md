# Staging Runtime Lifecycle

Use this procedure to activate synthetic staging for a bounded release/restore/security exercise and
return it to its normal dormant state. Development remains the continuous prelaunch integration
environment. This procedure never applies to production.

## Retained and disposable boundaries

Dormant staging retains encrypted Terraform state, KMS, S3 artifacts, ECR migration images, IAM,
SQS/DLQs, API/Lambda definitions, logs/alarms, budgets, and CUR export. It removes PostgreSQL, the
current generated database connection value, RDS alarms/current migration task definition, and the
three hourly interface endpoints.

Staging permits synthetic data only. Shutdown intentionally retains no database snapshot.

## Operator prerequisites

- Terraform `1.9.8`, AWS CLI, and a fresh temporary `ai-job-apply-staging-admin` SSO session.
- A clean `main` checkout exactly matching `origin/main`.
- The exact staging account ID, encrypted platform-state bucket, and most recent applied saved plan.
- Empty event queues/DLQs and no disposable PITR copy or unfinished migration.
- Plans remain below `infrastructure/terraform/environments/staging/.terraform/` and are never
  committed.

Inspect without mutation:

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action Status `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" `
  -StateBucket "STAGING_STATE_BUCKET"
```

## Turn staging off

First create and review a `quiesced` plan using the last applied active plan. It disables routes and
triggers and changes RDS deletion protection from true to false; it must not delete RDS, KMS, state,
artifacts, queues, IAM, or backups.

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action Plan -TargetMode quiesced `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" -StateBucket "STAGING_STATE_BUCKET" `
  -RuntimePlanPath ".terraform/APPLIED_ACTIVE_PLAN.tfplan"
```

Apply only the exact output path and SHA-256 after explicit review. Verify `Mode=quiesced`, empty
queues, zero routes/triggers, one protected-network data plane, and database deletion protection
false.

Then create the separate destructive `dormant` plan using the applied quiesce plan:

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action Plan -TargetMode dormant `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" -StateBucket "STAGING_STATE_BUCKET" `
  -RuntimePlanPath ".terraform/staging-lifecycle/APPLIED_QUIESCED_PLAN.tfplan"
```

Review every delete and approve the exact checksum. The operator permits deletion only of the
staging RDS instance, current Terraform secret value, three interface endpoints, two RDS alarms,
and current migration task definition. After apply, require `Mode=dormant`, no database, zero
managed interface endpoints, zero routes/triggers, empty queues, and retained control resources.

## Activate staging

Create `active` from the last applied dormant plan. The activation plan may create the disposable
database, endpoint, alarm, secret-value, and migration-task resources but may delete nothing.

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action Plan -TargetMode active `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" -StateBucket "STAGING_STATE_BUCKET" `
  -RuntimePlanPath ".terraform/staging-lifecycle/APPLIED_DORMANT_PLAN.tfplan"
```

After checksum-reviewed apply, keep all routes and triggers disabled. Then:

1. publish/select the exact scanned migration image;
2. run the database migration procedure;
3. load only approved synthetic fixtures;
4. verify schema, encrypted storage, private networking, alarms, and empty queues;
5. release the exact development-approved immutable Lambda artifacts;
6. enable traffic through a separate checksum-reviewed serverless application release; and
7. execute persistence, readiness, workload, tenant-isolation, restore/security tests required by
   that release candidate.

When the bounded exercise ends, repeat the two-step shutdown. Never leave staging active merely to
preserve test records.

## Interrupted transitions

Do not regenerate or replay a partially consumed plan. Inspect status, refresh SSO, return to clean
merged `main`, and create a new refresh-backed plan from the last successfully applied plan. If
status reports `transition-or-drift`, stop: reconcile the exact AWS/Terraform state before any
further mutation.
