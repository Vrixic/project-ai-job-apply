# Staging Runtime Lifecycle

Use this procedure to activate synthetic staging for a bounded release/restore/security exercise and
return it to its normal dormant state. Development remains the continuous prelaunch integration
environment. This procedure never applies to production.

## Retained and disposable boundaries

Dormant staging retains encrypted Terraform state, KMS, S3 artifacts, ECR migration images, IAM,
SQS/DLQs, API/Lambda definitions, logs/alarms, budgets, and CUR export. It removes PostgreSQL, the
current generated database connection value, RDS alarms/current migration task definition, and the
hourly endpoints: three interface endpoints for the base runtime, plus the private STS interface and
S3 gateway endpoints when document processing is deployed.

Staging permits synthetic data only. Shutdown intentionally retains no database snapshot.

## Operator prerequisites

- Terraform `1.16.2`, AWS CLI, and a fresh temporary `ai-job-apply-staging-admin` SSO session.
- A clean `main` checkout exactly matching `origin/main`.
- The exact staging account ID, encrypted platform-state bucket, and most recent applied saved plan.
- Empty event queues/DLQs and no disposable PITR copy or unfinished migration.
- Plans remain below `infrastructure/terraform/environments/staging/.terraform/` and are never
  committed.

Inspect without mutation:

Status resolves the optional document processor from the exact Lambda function inventory. An
empty event-source-mapping list alone does not establish whether the function is deployed.
Inventory failures refuse status; a deployed processor still requires its mappings and rules.

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
staging RDS instance, current Terraform secret value, the applicable base/document-processing
endpoints, two RDS alarms, and current migration task definition. After apply, require `Mode=dormant`, no database, zero
managed interface endpoints, zero routes/triggers, empty queues, and retained control resources.

## Activate staging

Create `active` from the last applied dormant plan. Without document processing, activation creates
the eight base disposable resources: database, three interface endpoints, two database alarms,
current secret value, and migration task. With document processing deployed, it additionally creates
the private STS interface and S3 gateway endpoints, for ten creates total. Both forms update the
operations dashboard once, may delete or replace nothing, and may not create or update a route or
workflow trigger. The operator requires encrypted non-public RDS with deletion protection and
seven-day backups; all interface endpoints use private DNS and the S3 endpoint is type `Gateway`.

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action Plan -TargetMode active `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" -StateBucket "STAGING_STATE_BUCKET" `
  -RuntimePlanPath ".terraform/staging-lifecycle/APPLIED_DORMANT_PLAN.tfplan"
```

After checksum-reviewed apply, keep all routes and triggers disabled. Then:

1. publish/select the exact scanned migration image;
2. run the database migration procedure;
3. create Phase 0 records through the approved disposable Auth0/API conformance boundary; use a
   fixture loader only for a later capability with an explicit owned seed contract;
4. verify schema, encrypted storage, private networking, alarms, and empty queues;
5. release the exact development-approved immutable Lambda artifacts;
6. enable traffic through a separate checksum-reviewed serverless application release; and
7. execute persistence, readiness, workload, tenant-isolation, restore/security tests required by
   that release candidate.

Generate the base traffic plan from the applied active plan. It must create exactly the JWT default
route and two anonymous health routes, then enable the outbox SQS mapping plus its reconciler and
terminal EventBridge rules. Document scan processing remains independently dark and requires the
mapping/reconciler-first, GuardDuty-rule-second release described by its D1 evidence. It may change
nothing else.

```powershell
.\scripts\operate-staging-runtime-lifecycle.ps1 -Action PlanTraffic -TrafficTarget enabled `
  -ExpectedAccountId "STAGING_ACCOUNT_ID" -StateBucket "STAGING_STATE_BUCKET" `
  -RuntimePlanPath ".terraform/staging-lifecycle/APPLIED_ACTIVE_PLAN.tfplan"
```

Apply only the exact reviewed checksum with `-Action ApplyTraffic`. Require `Mode=active`, three
routes, one base mapping, two base rules, document processing still dark, and empty queues before
starting acceptance traffic.

For a bounded recovery that keeps the protected database, create a separate `TrafficTarget=disabled`
plan from the applied enabled plan. It must delete only the three routes and disable only the three
base triggers. Document processing must already have been disabled through its separate drain and
rollback procedure. If staging is already dark when shutdown begins, the subsequent quiescence plan
contains only the database-deletion-protection update; from live base traffic it contains that update
plus the exact six traffic actions. Both forms remain separately checksum reviewed.

When the bounded exercise ends, repeat the two-step shutdown. Never leave staging active merely to
preserve test records.

## Accept the dormant billing interval

After at least one complete UTC day has elapsed in verified dormant mode and AWS has posted that
day, refresh only the staging IAM Identity Center session and run:

```powershell
.\scripts\inspect-phase0-cost.ps1 -Environment staging `
  -StartDate "<DORMANT_UTC_DAY>" -EndDate "<NEXT_UTC_DAY>" `
  -VerifyDormantStaging
```

The switch performs one additional Cost Explorer request and fails closed if the completed day has
any RDS instance-hours or VPC endpoint-hours. Retained KMS, Secrets Manager, S3/ECR, logs, queues,
budgets, and export controls can keep the total above zero. Preserve only the sanitized aggregate
output; do not retain account identifiers, object keys, or raw CUR rows.

## Interrupted transitions

Do not regenerate or replay a partially consumed plan. Inspect status, refresh SSO, return to clean
merged `main`, and create a new refresh-backed plan from the last successfully applied plan. If
status reports `transition-or-drift`, stop: reconcile the exact AWS/Terraform state before any
further mutation.
