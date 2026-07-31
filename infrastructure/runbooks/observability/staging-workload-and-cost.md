# Staging Workload and Initial Cost Acceptance

Use this procedure to establish a reproducible synthetic baseline for the Phase 0 gateway,
PostgreSQL/outbox, Temporal worker, observability, and lean AWS cost model. This is foundation
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
  unauthenticated protected reads, 25 sequential preference/outbox/Temporal workflows, and one
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

Run the read-only baselines:

```powershell
.\scripts\inspect-staging-workload-and-cost.ps1 -Action Status
.\scripts\inspect-phase0-cost.ps1
```

Require the staging source and both services healthy, all eight alarms `OK`, zero restore targets
or context, and temporary callers in both accounts. Cost Explorer can lag provider usage by more
than a day; a zero or estimated current-period value is not evidence of zero cost.

The initial preflight found no AWS Budget and no CUR 2.0 Data Export in staging. Do not create
either ad hoc. Apply the environment-isolated Terraform controls only from a reviewed plan, then
wait for the first export delivery and provider cost data to post. AWS can take up to 24 hours to
start delivering a new export.

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
  -EndTime "<endedAt>"
```

Require:

- API Gateway count at least 552: 500 public probes, one baseline preference read, 26 writes
  including the replay, and at least 25 operation reads;
- at least 100 expected `4xx` responses from the protected unauthenticated probes and zero `5xx`;
- 25/25 successful workflow results and a matched idempotent replay in the browser aggregate;
- zero DLQ messages, zero application error matches, and zero forbidden log-pattern matches;
- two stable lean services, all eight alarms `OK`, and Terraform drift `0`.

Record the observed browser p50/p95/max latency and AWS API/ECS/RDS/queue metrics without imposing
an invented production threshold. A saturation signal, alarm transition, error, timeout, workflow
miss, duplicate result, or authorization mismatch fails this baseline and must become explicit
capacity/reliability work.

## Accept initial cost evidence

Cost acceptance requires a later read after provider charges post:

```powershell
.\scripts\inspect-phase0-cost.ps1 -StartDate "<YYYY-MM-DD>" -EndDate "<YYYY-MM-DD>"
```

Reconcile non-credit development and scheduled-staging service costs against
[the initial estimate](../../../docs/product/foundation/initial-operating-cost-baseline.md). Record
the actual observation interval, partial-month status, service attribution, credits excluded from
steady-state economics, and any unexplained service. Do not annualize a partial day as a capacity
forecast.

Phase 0 workload/cost acceptance closes only after the synthetic workload and AWS corroboration
pass, billing data is nonzero and attributable, and the reviewed budget/export controls exist.
