# Development D1 Managed-OIDC Workloads

Use this procedure only with an approved synthetic development account. It exercises the exact
deployed API Gateway/Lambda boundary through the local web application's server-held managed-OIDC
session. It does not process real candidate data, activate a provider, create a job report, write
preferences, or invoke an external ATS. The match profile reads one assessment without retaining its
job, preference, gate, or reason values. The opt-in saved-job lifecycle does mutate one previously
unsaved catalog association, verifies it, and deletes it. Its bounded idempotency and append-only
audit records remain by design.

These are bounded read and write/failure/recovery foundations, not the complete representative
Phase 1 load/SLO gate. The final gate still requires authenticated execution, CloudWatch
corroboration, and accountable acceptance against the frozen Phase 1 candidate.

## Fixed boundary

- The route exists only while Next runs in development mode with
  `ENABLE_D1_WORKLOAD_CONFORMANCE=1` and an exact development/staging environment selection.
- Same-origin POST plus the exact confirmation string is required.
- Auth0 tokens remain server-held and are sent only to the already validated deployed API origin.
- The read run first validates the exact `JobPreferenceSet`, `EntitlementSummary`, `JobSearchPage`,
  and `SavedJobPage` response schemas.
- The development profile uses concurrency `2`, matching the deployed gateway reserved-concurrency
  ceiling. Staging uses `5`.
- The fixed profile sends 150 public requests: 50 liveness, 50 readiness, and 50 expected
  unauthenticated entitlement denials.
- It then sends 100 authenticated requests: 25 each for preferences, entitlements, canonical job
  search, and owner-scoped saved-job search.
- The separately confirmed saved-job lifecycle reads every bounded catalog and saved-job page,
  chooses only a job that was not already saved by the synthetic account, creates it with a fresh
  server-generated idempotency key, verifies exact replay, requires an `idempotency_conflict` for
  the same key and a different unsaved job, verifies owner-visible persistence, deletes the exact
  association, and verifies absence.
- The separately confirmed match profile reads one bounded catalog page, selects the first current
  result, and requires one exact no-store `MatchAssessment` response for that same job.
- A lifecycle failure attempts exact owner-scoped cleanup before returning an aggregate-only
  inconclusive result. Never retry when `cleanupSucceeded` is false; inspect and reconcile first.
- The result contains only timestamps, counts, pass/fail totals, duration, and aggregate p50/p95/max
  latency. It never contains a token, identity, preference, job, saved-job, request/response body,
  endpoint, match gate/reason, AWS identifier, or Auth0 identifier.
- A second concurrent run is rejected. Every request has a fixed 15-second deadline and the browser
  request has a three-minute ceiling.

The account must already have valid synthetic preferences for the read profile. The lifecycle
profile additionally requires at least two catalog jobs not already saved by that account. It will
not delete or overwrite an association that existed before its baseline.

## Read-only AWS/OIDC preflight

Refresh the temporary development IAM Identity Center session, then run:

```powershell
.\scripts\start-deployed-web-conformance.ps1 `
  -Environment development `
  -ValidateOnly
```

Require the exact Auth0 issuer/audience, API Gateway JWT authorizer, numeric unweighted Lambda
alias, durable triggers, idle ECS boundary, and public `200/200/401` checks to pass.

## Execute

Start the opt-in local surface:

```powershell
.\scripts\start-deployed-web-conformance.ps1 `
  -Environment development `
  -EnableD1WorkloadConformance
```

Then:

1. Open `http://localhost:3000/d1-conformance`.
2. Sign in with the approved synthetic Auth0 account if required.
3. If the account has no preference baseline, return to `/`, save a synthetic preference set, and
   wait for the operation to complete.
4. Return to `/d1-conformance`, select **Run D1 read workload**, and accept the fixed-profile
   confirmation.
5. Require `state=passed`, four validated baseline contracts, 150/150 public requests, 100/100
   authenticated requests, and zero failures.
6. Select **Run saved-job lifecycle**, accept its distinct mutation confirmation, and require
   `state=passed`, one successful write, one idempotent replay, one expected conflict, one cleanup
   delete, and `postCleanupAbsent=true`.
7. Select **Run match-assessment check**, accept its distinct read-only confirmation, and require
   `state=passed`, one validated catalog page, one match assessment, and a positive aggregate evidence
   item count.
8. Retain only the displayed aggregate metrics and exact start/end timestamps for all three runs.
9. Stop the local server with Ctrl+C.

If the lifecycle returns `write_scope_required`, the Platform API permission exists but the web
application's per-app user-delegated grant does not include `jobs:write`. Add that exact grant in
Auth0, sign out to discard the old server-held token, sign in again, and then rerun the lifecycle.
The aggregate failure result states `cleanupRequired=false`; do not attempt a blind delete.

The launcher restores all prior process-scoped environment values on exit. It does not change
Auth0, AWS, Terraform, the database, or product data.

## Corroborate the exact window

Use each displayed timestamp window with the exact development account, encrypted state bucket,
and already-applied ignored steady-state plan:

```powershell
.\scripts\inspect-development-workload-and-cost.ps1 `
  -Action Measure `
  -WorkloadProfile D1Read `
  -StartTime "<startedAt>" `
  -EndTime "<endedAt>" `
  -ExpectedAccountId "<DEVELOPMENT_ACCOUNT_ID>" `
  -StateBucket "<DEVELOPMENT_STATE_BUCKET>" `
  -RuntimePlanPath ".terraform/development-provider-activation/zero-drift-eb617045e98a-20260824-152628.tfplan"
```

Use `-WorkloadProfile D1SavedJob` with the lifecycle timestamps and `-WorkloadProfile D1Match` with
the match-check timestamps. The legacy/default `Phase0` profile has different fixed request floors
and cannot corroborate any D1 workload.

Require zero API `5xx`, Lambda errors/throttles, queue/DLQ backlog, forbidden log-pattern matches,
or alarm failures; require idle ECS and refresh-backed zero drift. Do not retain account/resource
identifiers or raw log events in shared evidence.

The read window and saved-job lifecycle window are distinct evidence. Do not invent a production
latency SLO, capacity claim, provider-failure claim, row-value recovery claim, or Phase 1 completion
from either one.
