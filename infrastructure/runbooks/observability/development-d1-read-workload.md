# Development D1 Managed-OIDC Read Workload

Use this procedure only with an approved synthetic development account. It exercises the exact
deployed API Gateway/Lambda boundary through the local web application's server-held managed-OIDC
session. It does not process real candidate data, activate a provider, create a job report, change
a saved job, write preferences, or invoke an external ATS.

This is a bounded read baseline, not the complete representative Phase 1 load/SLO gate. The final
gate still requires populated exact-source fixtures, write/failure/recovery coverage, CloudWatch
corroboration, and accountable acceptance against the frozen Phase 1 candidate.

## Fixed boundary

- The route exists only while Next runs in development mode with
  `ENABLE_D1_WORKLOAD_CONFORMANCE=1` and an exact development/staging environment selection.
- Same-origin POST plus the exact confirmation string is required.
- Auth0 tokens remain server-held and are sent only to the already validated deployed API origin.
- The run first validates the exact `JobPreferenceSet`, `EntitlementSummary`, `JobSearchPage`, and
  `SavedJobPage` response schemas.
- The development profile uses concurrency `2`, matching the deployed gateway reserved-concurrency
  ceiling. Staging uses `5`.
- The fixed profile sends 150 public requests: 50 liveness, 50 readiness, and 50 expected
  unauthenticated entitlement denials.
- It then sends 100 authenticated requests: 25 each for preferences, entitlements, canonical job
  search, and owner-scoped saved-job search.
- The result contains only timestamps, counts, pass/fail totals, duration, and aggregate p50/p95/max
  latency. It never contains a token, identity, preference, job, saved-job, request/response body,
  endpoint, AWS identifier, or Auth0 identifier.
- A second concurrent run is rejected. Every request has a fixed 15-second deadline and the browser
  request has a three-minute ceiling.

The account must already have valid synthetic preferences. An empty catalog and empty saved-job
page are valid schema-bound reads, but they do not satisfy the final representative-data gate.

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
6. Retain only the displayed aggregate metrics and exact start/end timestamps.
7. Stop the local server with Ctrl+C.

The launcher restores all prior process-scoped environment values on exit. It does not change
Auth0, AWS, Terraform, the database, or product data.

## Corroborate the exact window

Use the displayed timestamps with the exact development account, encrypted state bucket, and
already-applied ignored steady-state plan:

```powershell
.\scripts\inspect-development-workload-and-cost.ps1 `
  -Action Measure `
  -StartTime "<startedAt>" `
  -EndTime "<endedAt>" `
  -ExpectedAccountId "<DEVELOPMENT_ACCOUNT_ID>" `
  -StateBucket "<DEVELOPMENT_STATE_BUCKET>" `
  -RuntimePlanPath ".terraform/development-ingestion-provider-dark/zero-drift-7eb4fe33ba8c-state149.tfplan"
```

Require zero API `5xx`, Lambda errors/throttles, queue/DLQ backlog, forbidden log-pattern matches,
or alarm failures; require idle ECS and refresh-backed zero drift. Do not retain account/resource
identifiers or raw log events in shared evidence.

This corroboration measures the current read profile only. Do not invent a production latency SLO,
capacity claim, provider-failure claim, row-value recovery claim, or Phase 1 completion from it.
