# D1 Managed-OIDC Read Acceptance and Saved-Job Scope Blocker

- Date: 2026-08-24
- Environment: isolated development
- Status: read profile accepted; saved-job lifecycle blocked before its first write
- Correction source: `e28f739`

## Read result

The product owner ran the fixed managed-OIDC profile with the approved synthetic account. Only the
following aggregate result is retained:

```json
{
  "profile": "d1_deployed_read_v1",
  "startedAt": "2026-08-24T18:46:48.570Z",
  "endedAt": "2026-08-24T18:46:58.675Z",
  "durationMs": 10105,
  "baselineContractsValidated": 4,
  "publicRequests": 150,
  "publicFailures": 0,
  "authenticatedRequests": 100,
  "authenticatedFailures": 0,
  "publicLatency": {
    "p50Ms": 60,
    "p95Ms": 79,
    "maxMs": 266
  },
  "authenticatedLatency": {
    "p50Ms": 82,
    "p95Ms": 113,
    "maxMs": 152
  }
}
```

The corrected `D1Read` AWS inspector then passed the enclosing one-minute CloudWatch bucket with
254 API requests, 50 expected authorization refusals, zero API 5xx, zero Lambda errors or
throttles, zero queue/dead-letter backlog, zero error or forbidden-content log matches, ten healthy
runtime alarms, zero ECS services/tasks, Lambda Durable dispatch, and zero Terraform drift. This is
a bounded development result, not a production SLO or capacity claim.

## Saved-job blocker and cleanup state

The lifecycle established its catalog and owner baselines, then the deployed gateway returned
HTTP `403` for the first saved-job create. Aggregate log inspection for that bounded attempt found
seven completed requests: six `200`, one `403`, and zero DELETE requests. Authorization rejected
the create before persistence, so no workload-owned association exists and no cleanup is required.

The Platform API defines `jobs:write`, and the web source requests it. The remaining external
configuration blocker is the Auth0 Platform API's per-application user-delegated grant for the
development web application. Defining the API permission alone does not expand that application
grant.

Source `e28f739` now returns a stable aggregate-only `write_scope_required` result with
`failureStage=create_authorization`, `observedStatus=403`, and `cleanupRequired=false`; the browser
retains those diagnostics instead of replacing them with a generic failure. The workload inspector
now has separate `D1Read` and `D1SavedJob` request floors and no longer applies the legacy Phase 0
pre-padding to D1 metric buckets.

## Verification and next action

- Focused workload/UI tests: 14/14 passed.
- Complete web tests: 505/505 passed.
- Repository test tasks: 32/32 passed.
- Repository type/build checks: 31/31 passed.
- Production build tasks: 19/19 passed.
- Infrastructure/operator validation passed, including PowerShell 7 and Windows PowerShell 5.1
  parsing of the inspector interface.
- The global wrapper remains stopped by unrelated incomplete `skills/frontend-design` package
  validation/format/lint findings; no affected product or operator file fails its scoped checks.

In Auth0, grant the development web application user-delegated `jobs:write` access to the Platform
API. Then sign out, sign in again to obtain a fresh server-held token, rerun only the saved-job
lifecycle, and corroborate its timestamps with `-WorkloadProfile D1SavedJob`.

No token, identity, preference, job identifier, saved-job identifier, request identifier, response
body, or real candidate data is retained here.
