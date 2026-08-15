# Development Job-Search Stale-Cursor Acceptance

Use this procedure to prove the deployed D1-005 search catalog-change behavior in the isolated
development account with generated synthetic Jobs rows. The guarded operator creates three
run-scoped jobs, obtains a real continuation cursor from the deployed gateway Lambda, advances the
catalog revision through a separate synthetic mutation, requires the old cursor to return the
stable `409 job_search_catalog_changed` problem, proves a complete duplicate-free restart, and
removes the exact fixture.

This is a narrow acceptance procedure, not a migration runner or a general database tool. The
operator accepts no SQL, container name, command, environment name, query, job value, or gateway
payload from its caller. Its fixed ECS override runs only
`jobs/dist/src/run-search-acceptance.js` with the exact `prepare`, `mutate`, or `cleanup` action and
the `generated-synthetic-only` confirmation.

## Preconditions

- Work from a clean `main` checkout exactly equal to `origin/main`. Use that merged 40-character
  commit for every `SourceSha` below. Do not publish or accept an artifact built from a working
  tree or a different commit.
- Use PowerShell 7, Terraform `1.9.8`, AWS CLI v2, Node.js 24, pnpm `10.24.0`, Docker Buildx, and a
  temporary IAM Identity Center assumed-role session for the exact development account in
  `us-east-2`.
- Resolve the development account ID and the Terraform state bucket locally. Require versioning,
  all four S3 public-access-block settings, and the exact customer-KMS bucket-key boundary. Do not
  put account IDs, state-bucket names, ARNs, tokens, synthetic query values, or raw CloudWatch
  records in repository evidence.
- Require current RDS availability and acceptable backup/PITR evidence. Require the retained ECS
  cluster to have zero `RUNNING` or `PENDING` database tasks and no service.
- Require Jobs migration `0004_job_search` to be applied with its reviewed checksum. Do not use
  this procedure to apply a schema migration.
- Require the exact healthy deployed gateway artifact and unrouted numeric `development` alias.
  Record its 64-character artifact SHA-256 and numeric version out of band. The operator rejects a
  changed release, nonnumeric alias, routing weights, failed update, or missing OIDC boundary.
- Require the exact merged migration image to contain the two Jobs acceptance entrypoints and to
  be published, scanned, independently verified, and applied to the one-off migration task
  definition through the separate gates below.
- Run the local source checks before merge and again against the merged commit:

  ```powershell
  pnpm --filter @ai-job-apply/jobs-service test
  pnpm --filter @ai-job-apply/jobs-service build
  powershell.exe -NoProfile -File scripts/tests/development-job-search-acceptance-operator.tests.ps1
  pwsh -NoProfile -File scripts/tests/development-job-search-acceptance-operator.tests.ps1
  pnpm check
  ```

All plans, receipts, and logs produced by this procedure stay below the ignored
`infrastructure/terraform/environments/development/.terraform/` directory. Never commit them or
paste their bodies into shared delivery evidence.

## Gate 1: publish and verify the migration image

Publishing the image is separate from registering it and from running acceptance. Follow the
[development migration-image publication](development-migration-image-publication.md) procedure:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action Status `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET

.\scripts\publish-development-migration-image.ps1 -Action Publish `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT
```

Reviewer A must inspect the ignored version-2 publication receipt and sanitized publication
result, record its SHA-256 independently, and verify it:

```powershell
.\scripts\publish-development-migration-image.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -ReceiptPath MIGRATION_RECEIPT_PATH `
  -ReviewedReceiptSha256 REVIEWED_MIGRATION_RECEIPT_SHA256
```

Proceed only when the receipt is `verified`, binds the exact source and development repository,
identifies one `linux/amd64` platform digest, and reports a complete scan with zero High and zero
Critical findings. Use only its digest-pinned `imageUri`; a tag is not a task-definition input.
Publication does not authorize Terraform apply or ECS execution.

## Gate 2: update only the migration task definition

Use only `PlanTask` and `ApplyTask` from the guarded
[database-migration](database-migration.md) procedure. Start from the latest checksum-reviewed,
refresh-backed zero-change CompleteDark baseline and its adjacent metadata sidecar. If that
baseline's recorded operator source is not the exact merged current source, Reviewer A must first
inspect the complete canonical baseline-operator-to-current Git delta and independently record
its SHA-256. The recorded baseline operator must be an ancestor of clean
`main == origin/main`; do not refresh or broaden the document-dark recovery allowlist merely to
admit this release delta. Use the byte-identical derivation and regular-blob inspection in the
[database migration runbook](database-migration.md), and recompute it after any merged-source
change.

For this release, the only permitted stale-state handoff is the exact schema-3 `CompleteDark`
baseline at operator `9d290416c61847f1682157c08312cdb920d42107`, plan SHA-256
`2143c836f9c55d2126efef55b314f167b35d593d64338791cb6c3837c6e2a6a4`, sidecar SHA-256
`e0efc63e7c17685e363e23f15f7f1d39e83c46beff3f08fdb768bd67e78b8011`, lineage
`472ef790-b249-45ec-817f-718005980d9e`, and retained serial `107`, while the current planning state
is the same lineage at serial `108`. This exception is not a general stale-baseline allowance:

```powershell
.\scripts\operate-development-document-migration.ps1 -Action PlanTask `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationImage EXACT_IMAGE_URI_AT_PLATFORM_DIGEST `
  -AppliedPlanPath CURRENT_ZERO_CHANGE_BASELINE `
  -AppliedPlanSha256 REVIEWED_BASELINE_SHA256 `
  -AppliedPlanMetadataSha256 REVIEWED_BASELINE_METADATA_SHA256 `
  -ReviewedBaselineToCurrentDeltaSha256 REVIEWED_BASELINE_TO_CURRENT_DELTA_SHA256
```

Omit `-ReviewedBaselineToCurrentDeltaSha256` only when the retained baseline already binds the
exact current operator source. An ancestor baseline is accepted only from schema-3 or schema-4
`CompleteDark` metadata, with its stored release-to-operator binding intact and an exact reviewed
delta containing only unambiguous added, modified, or deleted blobs. Missing review, a wrong
checksum, a nonancestor, rename, binary/non-blob record, dirty/divergent source, or changed current
HEAD is a blocker.

Reviewer A must inspect the saved plan, its metadata, and their hashes. The only meaningful change
allowed is the create-before-destroy replacement of
`module.platform.aws_ecs_task_definition.migration[0]` caused by the exact new image digest. The
default container command must remain `runner/dist/src/main.js`; the task must remain a single
non-root, read-only-root, `linux/amd64` Fargate container with only the `DATABASE_URL` secret and
the existing application log boundary. Any other resource, output, variable, IAM, network,
secret, runtime, or trigger change is a blocker.

Task-metadata schema 2 must preserve the retained release/operator/delta binding, the exact
current operator source, the reviewed baseline-to-current delta checksum, the historical retained
state identity, and the exact current planning-state identity. Record the returned `PlanPath`,
`PlanSha256`, `PlanMetadataPath`, and `PlanMetadataSha256`. Reviewer A must rehash and confirm both
closed files and those fields in addition to the existing baseline plan, state, stage, receipt,
and parser-pin handoff.

Apply only those reviewed bytes:

```powershell
.\scripts\operate-development-document-migration.ps1 -Action ApplyTask `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationImage EXACT_IMAGE_URI_AT_PLATFORM_DIGEST `
  -TaskPlanPath REVIEWED_TASK_PLAN `
  -ReviewedTaskPlanSha256 REVIEWED_TASK_PLAN_SHA256 `
  -ReviewedTaskPlanMetadataSha256 REVIEWED_TASK_PLAN_METADATA_SHA256 `
  -AppliedPlanMetadataSha256 REVIEWED_BASELINE_METADATA_SHA256 `
  -ReviewedBaselineToCurrentDeltaSha256 REVIEWED_BASELINE_TO_CURRENT_DELTA_SHA256
```

Use the same omission rule for an exact-current baseline. `ApplyTask` must recompute the reviewed
delta and revalidate the current clean source, every tracked Terraform-source byte, retained
baseline bytes, exact planning-state lineage/serial, and every checksum-reviewed task-plan
metadata binding before it consumes the reviewed plan.

Do not continue to `PlanExecution` or `Execute` in the database-migration operator. This gate
registers the image; it does not run the normal migration command. Confirm the new task-definition
revision is the exact digest-pinned image and the cluster returned to zero active tasks.

## Read-only status

Before planning acceptance, verify the account, encrypted state identity, and idle ECS boundary:

```powershell
.\scripts\operate-development-job-search-acceptance.ps1 -Action Status `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET
```

The expected result reports `Environment=development`, the state lineage and serial,
`ActiveDatabaseTaskCount=0`, and `CloudMutation=false`. Stop if the account, region, state
versioning, four-setting public-access block, encryption, Terraform version, or zero-task boundary
does not validate.

## Plan and second review

Create one short-lived execution descriptor. The operator generates a lowercase UUID v4 when
`RunId` is omitted; supply a reviewed UUID only when operational coordination requires it.

```powershell
.\scripts\operate-development-job-search-acceptance.ps1 -Action Plan `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationReceiptPath MIGRATION_RECEIPT_PATH `
  -ReviewedMigrationReceiptSha256 REVIEWED_MIGRATION_RECEIPT_SHA256 `
  -ExpectedGatewayArtifactSha256 REVIEWED_GATEWAY_ARTIFACT_SHA256 `
  -ExpectedGatewayVersion REVIEWED_NUMERIC_ALIAS_VERSION
```

`Plan` is read-only with respect to AWS application state. It writes one checksum-reviewable JSON
descriptor under the ignored `development-job-search-acceptance` directory and reports
`Outcome=review-required`, its path, SHA-256, run ID, three requested tasks, and zero database
writes.

Reviewer B must inspect the exact descriptor and record its SHA-256 independently. Require all of
the following:

- exact development account, `us-east-2`, source commit, state bucket with all four public-access
  blocks plus versioning and the exact customer-KMS bucket-key boundary,
  lineage/serial/version, verified migration receipt and platform digest, gateway function,
  unrouted alias version, artifact hash, and code hash;
- exactly one run ID and two exact UTC-millisecond timestamps: `prepareAt`, then `mutateAt`
  exactly one second later;
- exactly three ordered requests: `prepare`, `mutate`, and `cleanup`;
- an `ACTIVE`, fault-injection-disabled task definition with no IPC or PID namespace broadening;
- count one, Fargate, the state-derived task definition, exactly two state-derived subnets, one
  state-derived application security group, and public IP enabled only for bounded image/control
  plane access;
- one `database-migration` container override whose only command is
  `jobs/dist/src/run-search-acceptance.js`;
- only `JOB_SEARCH_ACCEPTANCE_CONFIRM=generated-synthetic-only`, the exact action, and the exact
  run ID; `prepare` receives `JOB_SEARCH_ACCEPTANCE_AT=prepareAt`, `mutate` receives
  `JOB_SEARCH_ACCEPTANCE_AT=mutateAt`, and `cleanup` receives no `JOB_SEARCH_ACCEPTANCE_AT`; and
- a distinct bounded client token for each phase and no caller-selected SQL, payload, query, job,
  secret, role, image, or network override.

This is the second review gate. Do not let the person who generated the descriptor self-approve
its checksum. The one-second timestamp separation is part of the reviewed persistence invariant:
the mutation must be later than the prepared fixture so it can advance the catalog revision.
`Execute` accepts the plan only while both timestamps are within the 15-minute window. If review
cannot finish in time, discard it as execution input and generate a new plan with a new run ID;
never edit or rehash an old descriptor.

## Execute exactly once

Immediately before execution, repeat `Status` and confirm no migration, restore, or other
acceptance work is scheduled. Then consume the exact independently reviewed descriptor:

```powershell
.\scripts\operate-development-job-search-acceptance.ps1 -Action Execute `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationReceiptPath MIGRATION_RECEIPT_PATH `
  -ReviewedMigrationReceiptSha256 REVIEWED_MIGRATION_RECEIPT_SHA256 `
  -ExpectedGatewayArtifactSha256 REVIEWED_GATEWAY_ARTIFACT_SHA256 `
  -ExpectedGatewayVersion REVIEWED_NUMERIC_ALIAS_VERSION `
  -ExecutionPlanPath REVIEWED_ACCEPTANCE_PLAN `
  -ReviewedExecutionPlanSha256 REVIEWED_ACCEPTANCE_PLAN_SHA256
```

Do not pass `ReceiptPath` to `Execute`; it chooses a deterministic, plan-bound exclusive path.
Before any task submission, it writes a local `phase=claiming` receipt with blank claim and task
fields, creates and reads back a customer-KMS encrypted, versioned, one-time claim in the state
bucket keyed by the reviewed plan hash, and then promotes the local receipt to `phase=claimed`
with the exact claim key, version, and checksum. Only after that promotion does it write
`phase=running` and submit `prepare`. The durable claim is permanent replay evidence. Never delete
it and never run `Execute` again for the same descriptor, including after a timeout or local
interruption.

The guarded sequence is:

1. `prepare` creates exactly three generated-synthetic Jobs rows and returns one bounded result
   with `affectedJobs=3` and an increased search revision.
2. The exact gateway alias returns two active matching summaries for the run-scoped query. A
   separate page-size-one request returns a genuine bounded cursor.
3. `mutate`, using the reviewed timestamp exactly one second after `prepare`, changes only the
   nonmatching sentinel, reports `affectedJobs=1`, and advances the real catalog revision.
4. Reusing the old cursor must return `409`, `application/problem+json`, `cache-control: no-store`,
   and an exact no-extra Problem Details body containing
   `type=urn:ai-job-apply:problem:job_search_catalog_changed`, `title=Job catalog changed`,
   `status=409`, `code=job_search_catalog_changed`, and a nonempty string `traceId` exactly equal
   to the `x-correlation-id` response header. `detail` may be absent; when present it must equal
   `The job catalog changed; restart the search from the first page` exactly.
5. A fresh page-size-one restart must return exactly the same two jobs in the same order, with two
   unique IDs and no cursor after page two.
6. A `finally` path submits `cleanup`, requires `affectedJobs=3` and another increased revision,
   and proves the run-scoped query returns zero jobs and no cursor.

Each ECS phase must resolve to exactly one stopped task, the exact reviewed task definition and
override, exit code `0`, and exactly one bounded JSON log record. The operator retains hashes of
the query token and job sets, not their raw values.

Success is only:

```text
Outcome=verified-and-cleaned
StaleCursorStatus=409
RestartedJobCount=2
DuplicateJobCount=0
PostCleanupJobCount=0
PersistentFixtureRows=0
PersistentCatalogRevisionChange=true
```

Retain the printed receipt path and SHA-256. No partial or failed run is acceptance evidence.

Receipt phases have exact recovery meaning:

- `claiming` is the local pre-claim record. If claim creation or local promotion fails, no ECS task
  was submitted, but the S3 claim may be absent or may already exist. Preserve both plan and
  receipt, do not retry `Execute`, and escalate for operations review; `RecoverCleanup` and
  `Verify` reject this phase.
- `claimed` proves the exact durable claim was recorded locally, but still proves no ECS task was
  submitted. Preserve it and escalate rather than starting or recovering fixture work manually.
- `running` means `prepare` may have started. A failure that cannot prove cleanup advances to
  `cleanup-required`; these are the only phases accepted by reviewed `RecoverCleanup`.
- `failed-cleaned` proves the acceptance path failed but exact cleanup succeeded;
  `recovered-cleaned` proves only reviewed recovery cleanup; neither is acceptance evidence.
- `verified` alone proves the complete stale-cursor sequence and exact cleanup and is eligible for
  independent `Verify`. Its receipt must bind three valid and mutually distinct task ARNs, a valid
  query-token hash, matching valid baseline/restart job-set hashes, `staleCursorRejected=true`,
  `postCleanupCount=0`, and a canonical UTC `completedAt`.

## Recover cleanup only

Use `RecoverCleanup` only when `Execute` created a receipt but did not prove cleanup. Have an
independent reviewer inspect the exact current receipt, its phase, task ARNs, durable claim
binding, plan binding, and SHA-256. Preserve the original descriptor and every receipt version.

```powershell
.\scripts\operate-development-job-search-acceptance.ps1 -Action RecoverCleanup `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationReceiptPath MIGRATION_RECEIPT_PATH `
  -ReviewedMigrationReceiptSha256 REVIEWED_MIGRATION_RECEIPT_SHA256 `
  -ExpectedGatewayArtifactSha256 REVIEWED_GATEWAY_ARTIFACT_SHA256 `
  -ExpectedGatewayVersion REVIEWED_NUMERIC_ALIAS_VERSION `
  -ExecutionPlanPath REVIEWED_ACCEPTANCE_PLAN `
  -ReviewedExecutionPlanSha256 REVIEWED_ACCEPTANCE_PLAN_SHA256 `
  -ReceiptPath REVIEWED_INCOMPLETE_RECEIPT `
  -ReviewedReceiptSha256 REVIEWED_INCOMPLETE_RECEIPT_SHA256
```

Recovery accepts only a durably authenticated `running` or `cleanup-required` receipt and may
submit only the descriptor's fixed `cleanup` request. It cannot prepare or mutate rows. It must
prove the cleanup task stopped with exit `0`, affected exactly three fixture jobs, advanced the
revision, and left the run-scoped search empty. The result is
`Outcome=cleanup-recovered`, `PostCleanupJobCount=0`, and `AcceptanceClaim=false`, plus a new
receipt hash. Cleanup recovery is evidence of cleanup only; it never converts a failed or
ambiguous run into stale-cursor acceptance.

The cleanup path must remain usable for the exact reviewed, durably claimed descriptor after the
normal 15-minute prepare/mutate window. If the operator rejects such recovery, state/image/gateway
bindings changed, the task result is ambiguous, or the local receipt is missing or altered, stop
and obtain code/operations review. Do not use direct SQL, a console task, a copied ECS request, a
new run ID, or another `Execute` as recovery.

## Independent read-only verification

Reviewer B rehashes a successful `phase=verified` receipt and runs:

```powershell
.\scripts\operate-development-job-search-acceptance.ps1 -Action Verify `
  -ExpectedAccountId ACCOUNT_ID -StateBucket STATE_BUCKET `
  -SourceSha MERGED_40_CHARACTER_COMMIT `
  -MigrationReceiptPath MIGRATION_RECEIPT_PATH `
  -ReviewedMigrationReceiptSha256 REVIEWED_MIGRATION_RECEIPT_SHA256 `
  -ExpectedGatewayArtifactSha256 REVIEWED_GATEWAY_ARTIFACT_SHA256 `
  -ExpectedGatewayVersion REVIEWED_NUMERIC_ALIAS_VERSION `
  -ExecutionPlanPath REVIEWED_ACCEPTANCE_PLAN `
  -ReviewedExecutionPlanSha256 REVIEWED_ACCEPTANCE_PLAN_SHA256 `
  -ReceiptPath VERIFIED_ACCEPTANCE_RECEIPT `
  -ReviewedReceiptSha256 REVIEWED_ACCEPTANCE_RECEIPT_SHA256
```

`Verify` accepts only an internally consistent completed receipt with three valid distinct task
ARNs, a valid query-token hash, matching valid baseline/restart job-set hashes, a true stale-cursor
flag, zero post-cleanup rows, and canonical completion time. It repeats the exact alias post-cleanup
empty search, requires Terraform state lineage/serial/version to stay unchanged, and requires zero
active database tasks. Expected output includes `Outcome=verified`, `StaleCursorStatus=409`,
`RestartedJobCount=2`, `DuplicateJobCount=0`, `PostCleanupJobCount=0`,
`PersistentFixtureRows=0`, `PersistentCatalogRevisionChange=true`, `StateChanged=false`, and
`CloudMutation=false`.

Retain sanitized evidence containing only the source commit, reviewed receipt and plan hashes,
immutable image digest, gateway artifact hash and numeric version, aggregate outcomes above,
review identities/dates, and links to the ignored local evidence locations. Do not retain the
query token, cursor, synthetic job IDs, account ID, bucket name, ARNs, raw logs, state contents,
credentials, or candidate/source content.

## Stop rules

Stop without improvising when any prerequisite or exact binding fails, including:

- dirty, divergent, unmerged, or mismatched source;
- a missing, unexpected, or mismatched reviewed baseline-to-current delta; a nonancestor retained
  baseline operator; an ancestor baseline outside `CompleteDark`; or a changed source/state
  binding between `PlanTask` and `ApplyTask`;
- wrong account, region, caller type, state bucket, any non-blocked public-access setting, KMS
  boundary, state version, Terraform version, image, scan, source receipt, gateway artifact, alias,
  or code hash;
- any active database task, unexpected ECS service, unavailable database, unacceptable backup/PITR
  evidence, or concurrent migration/restore/catalog work;
- any task-definition plan change beyond the exact image-driven task-definition replacement;
- an expired, edited, reused, already-claimed, or checksum-mismatched descriptor;
- an unexpected command/environment/network override, task count, task result, exit code, log
  count, affected-row count, revision transition, response type, status, problem code, ordering,
  duplicate, cursor, or cleanup count;
- any Terraform state change during acceptance verification; or
- any indication that the fixture or telemetry contains real candidate or source data.

Never retry `Execute` after its durable claim may have been written. Never delete or overwrite a
claim to make a run eligible. Never forge a cursor, bypass CAPTCHA/MFA or OIDC, change the Lambda
alias in the console, edit a receipt, run arbitrary ECS overrides, or issue ad hoc SQL. Preserve
the evidence, use only reviewed `RecoverCleanup` when eligible, and escalate every ambiguous data
or submission state for human operations review.

## Evidence boundary and nonclaims

A verified run proves only that the exact immutable development gateway and Jobs persistence
boundary handled one generated-synthetic catalog revision as specified and removed its fixture.
The prepare, sentinel mutation, and cleanup transactions intentionally advance the persistent
catalog revision. `PersistentFixtureRows=0` proves the exact synthetic rows were removed; it does
not mean the database was unchanged.
It does **not** prove or authorize:

- real OIDC token validation, API Gateway routing, browser behavior, real candidate access, real
  job-source ingestion, staging, production, public launch, or provider/legal approval;
- candidate owner isolation beyond the existing gateway suite, search quality or relevance,
  matching explanations, saved jobs, performance/load behavior, availability, or abuse controls;
- completion of D1-005 or Phase 1; or
- execution of the normal migration orchestrator or any schema change. The durable encrypted
  operator claim and retained operational evidence are control-plane audit records, not
  candidate/product data.

Keep D1-005 in progress until real managed-OIDC/browser acceptance and the remaining saved-job and
matching work have their own reviewed evidence. See the
[Phase 1 register](../../../docs/product/delivery/phase-1-web-and-job-catalog.md),
[API security boundary](../../../docs/security/api-security-and-final-review.md), and the local
[stale-cursor acceptance foundation](../../../docs/product/delivery/evidence/d1-job-search-stale-cursor-acceptance-foundation-2026-08-15.md).
