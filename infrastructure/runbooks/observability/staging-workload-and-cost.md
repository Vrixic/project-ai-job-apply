# Staging Workload and Initial Cost Acceptance

Use this procedure to establish a reproducible synthetic baseline for the Phase 0 gateway,
PostgreSQL/outbox, Lambda durable workflows, observability, and lean AWS cost model. This is foundation
measurement, not a production capacity test, launch load claim, public benchmark, or permission to
process real candidate data.

## Safety boundary

- Run only against the dedicated synthetic staging account in `us-east-2` from the temporary
  `ai-job-apply-staging-admin` IAM Identity Center profile.
- Start the local web/BFF only through the reviewed staging conformance launcher. The browser never
  receives an access token, gateway origin, AWS identifier, or provider credential.
- Require an authenticated synthetic staging account with existing saved preferences. The runner
  reuses the exact saved preference content so the visible preference choice does not change.
- The fixed profile performs 200 liveness reads, 200 readiness/database reads, 100 expected
  unauthenticated protected reads, 25 sequential preference/outbox/Lambda durable workflows, and one
  same-key/same-body idempotent replay. Counts, paths, concurrency, and payload source are not
  browser configurable.
- Public probes use concurrency five. Durable writes are sequential so this measures the current
  foundation without inventing a multi-user capacity claim or creating same-user update races.
- The runner returns only ISO timestamps, counts, booleans, and aggregate latency summaries. It
  never returns the token, identity, preferences, operation identifiers, response bodies, traces,
  logs, endpoints, or resource identifiers.
- A workload failure stops the gate. Do not retry until the AWS aggregate evidence and application
  logs have been inspected.

The 25 synthetic operations, audit records, and idempotency records remain in staging as durable
test evidence. No application/submission action exists in this Phase 0 slice, and no external ATS,
email, notification, browser runner, or irreversible action is invoked.

## Preflight

Refresh both account sessions before cost inspection:

```powershell
aws sso login --profile ai-job-apply-development-admin
aws sso login --profile ai-job-apply-staging-admin
```

Set each environment's exact account, encrypted state bucket, and already-applied steady-state plan,
then run the read-only baselines. The plan must remain below that environment's ignored
`.terraform` directory.

```powershell
$stagingBoundary = @{
  ExpectedAccountId = "STAGING_ACCOUNT_ID"
  StateBucket = "STAGING_TERRAFORM_STATE_BUCKET"
  RuntimePlanPath = ".terraform/APPLIED_STEADY_STATE_PLAN.tfplan"
}

.\scripts\inspect-staging-workload-and-cost.ps1 -Action Status @stagingBoundary
.\scripts\inspect-phase0-cost.ps1 -Environment staging
```

Require the staging API and durable triggers healthy, zero ECS application services/tasks, all ten
runtime alarms `OK`, zero restore targets or context, and temporary callers in both accounts. Cost Explorer can lag provider usage by more
than a day; a zero or estimated current-period value is not evidence of zero cost.

For each environment, require one expected monthly `COST` budget at `$5 USD`,
`ExpectedAlertCount=1`, `OtherAlertCount=0`, and one expected export with
`Cur2ExportStatus=HEALTHY`. Review any nonzero `OtherBudgetCount`, `OtherAlertCount`, or
`OtherExportCount`; a duplicate environment cost control must be retired or explicitly accepted.
A real first delivery requires `FirstCurDeliveryPresent=true` and at least one Parquet object under
the configured `cur-2/` prefix. AWS's small bucket-validation object is outside that prefix and
must not be accepted as CUR evidence.

Historical preflight initially found no staging budget/export. The reviewed controls are now
deployed, and real Parquet/manifest delivery plus nonzero billing pass in both accounts. Do not
create duplicate controls ad hoc; retain exactly one expected budget/alert and export per account.

## Run the fixed workload

After the workload package has merged, start the local web client:

```powershell
.\scripts\start-deployed-web-conformance.ps1 `
  -Environment staging `
  -EnableWorkloadConformance
```

At `http://localhost:3000`:

1. Sign in with the approved synthetic account.
2. Confirm its saved preferences load. Save once first if the account has no baseline.
3. Select **Run staging workload** and confirm the fixed request profile.
4. Keep the terminal and browser open until the aggregate result appears.
5. Require `state=passed`, 500 public requests, zero public failures, 25/25 successful workflows,
   and a matching idempotent replay.
6. Retain only the displayed aggregate metrics and their `startedAt`/`endedAt` timestamps.

Stop the local server with Ctrl+C after the AWS measurement. The launcher restores the prior
process-scoped workload switch and gateway setting.

## Corroborate AWS signals

Allow CloudWatch at least five minutes to publish the last metric minute, then use the exact
aggregate result timestamps:

```powershell
.\scripts\inspect-staging-workload-and-cost.ps1 `
  -Action Measure `
  -StartTime "<startedAt>" `
  -EndTime "<endedAt>" `
  @stagingBoundary
```

Require:

- API Gateway count at least 552: 500 public probes, one baseline preference read, 26 writes
  including the replay, and at least 25 operation reads;
- at least 100 expected `4xx` responses from the protected unauthenticated probes and zero `5xx`;
- 25/25 successful workflow results and a matched idempotent replay in the browser aggregate;
- zero DLQ messages, zero application error matches, and zero forbidden log-pattern matches;
- zero ECS application services/tasks, all ten runtime alarms `OK`, and Terraform drift `0`.

Record the observed browser p50/p95/max latency and AWS API/Lambda/RDS/queue metrics without imposing
an invented production threshold. A saturation signal, alarm transition, error, timeout, workflow
miss, duplicate result, or authorization mismatch fails this baseline and must become explicit
capacity/reliability work.

## Accept initial cost evidence

Cost acceptance requires a later read after provider charges post:

```powershell
.\scripts\inspect-phase0-cost.ps1 -StartDate "<YYYY-MM-DD>" -EndDate "<YYYY-MM-DD>"
```

If the two independently configured IAM Identity Center sessions cannot remain simultaneously
active, run the same exact window once with `-Environment development` and once with
`-Environment staging`; retain both sanitized outputs as one reconciliation record.

Reconcile non-credit development and scheduled-staging service costs against
[the initial estimate](../../../docs/product/foundation/initial-operating-cost-baseline.md). Record
the actual observation interval, partial-month status, service attribution, credits excluded from
steady-state economics, and any unexplained service. Do not annualize a partial day as a capacity
forecast.

Phase 0 workload/cost acceptance closes only after the synthetic workload and AWS corroboration
pass, billing data is nonzero and attributable, reviewed budget/export controls exist, and one
complete UTC day wholly after runtime retirement shows no new gateway/worker ECS compute. The
operator's `FirstCurDeliveryPresent` must be true independently for development and staging.
