# D1 Managed-OIDC Read Acceptance and Saved-Job Remediation

- Date: 2026-08-24
- Environment: isolated development
- Status: read profile accepted; saved-job create remains under bounded deployed diagnosis
- Correction sources: `e28f739`, `a6dfae43cd98dd0cab546ef37af84aee0b649bf8`,
  `9421e22bc9c9278191536f9dad396ae25538130f`,
  `5cea6782e7c3e0fe3ffc669b84c1f4536c4af6de`

## Read result

The product owner ran the fixed managed-OIDC profile with the approved synthetic account. Only the
following aggregate result is retained:

```json
{
  "profile": "d1_deployed_read_v1",
  "startedAt": "2026-08-24T19:54:45.156Z",
  "endedAt": "2026-08-24T19:54:54.634Z",
  "durationMs": 9478,
  "baselineContractsValidated": 4,
  "publicRequests": 150,
  "publicFailures": 0,
  "authenticatedRequests": 100,
  "authenticatedFailures": 0,
  "publicLatency": {
    "p50Ms": 59,
    "p95Ms": 81,
    "maxMs": 256
  },
  "authenticatedLatency": {
    "p50Ms": 79,
    "p95Ms": 114,
    "maxMs": 168
  }
}
```

An earlier isolated read run passed the corrected `D1Read` AWS inspector with 254 API requests,
50 expected authorization refusals, zero API 5xx, zero Lambda errors or throttles, zero
queue/dead-letter backlog, zero error or forbidden-content log matches, ten healthy runtime
alarms, zero ECS services/tasks, Lambda Durable dispatch, and zero Terraform drift. The newer
repeat above is accepted at the application boundary, but its one-minute CloudWatch bucket is
inconclusive: the saved-job attempt began in the same metric minute and contributed the known API
`500`, and the aggregate bucket also reported Lambda throttling. The read profile will be repeated
in a quiet minute before final D1 load acceptance. This is a bounded development result, not a
production SLO or capacity claim.

## Saved-job diagnosis, correction, and cleanup state

The lifecycle established its catalog and owner baselines, then the deployed gateway returned
HTTP `403` for the first saved-job create. Aggregate log inspection for that bounded attempt found
seven completed requests: six `200`, one `403`, and zero DELETE requests. Authorization rejected
the create before persistence, so no workload-owned association exists and no cleanup is required.

The Platform API defines `jobs:write`, and the web source requests it. The Auth0 Platform API's
per-application user-delegated grant was corrected and a fresh login reached the saved-job handler.
That second lifecycle attempt completed its catalog and owner baselines, then the first create
returned `500`. Cleanup was attempted and succeeded. Aggregate inspection found seven requests:
six `200`, one `500`, and zero DELETE requests. The create failed before an association was
persisted, so no workload-owned saved job remains.

Source `e28f739` returns a stable aggregate-only `write_scope_required` result with
`failureStage=create_authorization`, `observedStatus=403`, and `cleanupRequired=false`; the browser
retains those diagnostics instead of replacing them with a generic failure. The workload inspector
now has separate `D1Read` and `D1SavedJob` request floors and no longer applies the legacy Phase 0
pre-padding to D1 metric buckets.

Privacy-safe Lambda classification isolated the second failure to `TypeError` /
`ERR_INVALID_ARG_TYPE` on `POST /v1/saved-jobs`. The saved-job store was passing JavaScript arrays
directly into `postgres` parameters for two `text[]` snapshot writes, unlike the repository's other
typed array writes. Source `a6dfae43cd98dd0cab546ef37af84aee0b649bf8` uses
`transaction.array(...)` for both the saved association and idempotency snapshot. It also reports a
stable aggregate-only failure stage for every lifecycle assertion.

The exact source passed the Matching unit suite (79 passed, five integration cases skipped without
a database), the focused web workload suite (9/9), both affected type checks, and all five real
PostgreSQL integration cases. The governed immutable artifact passed Gateway 108/108, dependency
audit, two byte-identical builds, exact-version publication/readback, and direct-boundary checks.
A checksum-bound Terraform plan changed only the gateway function and immutable alias, advancing
development to alias `31` and state serial `191`; the refresh-backed plan is zero drift. Docker
Desktop and all WSL distributions were stopped after PostgreSQL verification.

The first alias-`31` rerun still failed at `failureStage=create`; cleanup was attempted and
succeeded. The bounded gateway window contained one `POST /v1/saved-jobs` `500`, while safe error
classification remained `TypeError` / `ERR_INVALID_ARG_TYPE`. This proves the typed-array change
is live but was not the complete root cause; no saved association remains.

Source `9421e22bc9c9278191536f9dad396ae25538130f` adds value-free stage classification around each
atomic create-transaction step. It retains no SQL, values, identifiers, messages, or stack traces,
preserves the existing domain errors, and leaves transaction semantics unchanged. Matching unit
80 plus real PostgreSQL integration 5/5 pass. The exact deterministic artifact is deployed on
immutable gateway alias `32` at state serial `192`; its saved plan changed only the gateway
function and alias, and the refresh-backed post-release plan has zero changes with SHA-256
`f2a2cd2b79722e9bfb7864900c77775ad7c66af4df2472316aba774fda3ec671`.

The alias-`32` rerun again returned `failureStage=create` with cleanup successful, while the safe
error remained the original `TypeError` / `ERR_INVALID_ARG_TYPE` rather than any transaction-stage
code. This proves the exception occurs before the atomic create transaction begins. Exact source
`5cea6782e7c3e0fe3ffc669b84c1f4536c4af6de` extends the same value-free classification to the only
three remaining boundaries: replay lookup, catalog lookup, and persistence entry. Matching unit 83
and typecheck pass. The deterministic artifact is deployed on immutable alias `33` at state serial
`193`; its plan changed only the gateway function and alias, and post-release zero drift SHA-256 is
`e5a229bef7f62ab5129a9baaa42107f7726c83a05a3379df3fc6326bc2a4c211`.

## Verification and next action

- Saved-job persistence: Matching unit 83 passed; the unchanged transaction path retains its prior
  real PostgreSQL integration 5/5 acceptance.
- Workload diagnostics: focused web 9/9 and affected type checks passed.
- Diagnostic release: deterministic double build, immutable publication/readback, alias `33`,
  exact two-resource plan, and zero drift passed. Its direct boundary check remains to be rerun
  after the temporary AWS session is refreshed.
- The newest read AWS metric bucket is inconclusive because the next workload shared its minute;
  it is not recorded as a false pass.

Rerun only the saved-job lifecycle against alias `33`. If it fails, retain the displayed aggregate
result and use the exact bounded CloudWatch window only to read the value-free persistence stage.
Correct that exact stage and repeat until the lifecycle passes, then corroborate its timestamps
with `-WorkloadProfile D1SavedJob`. Finally wait for a quiet CloudWatch minute, repeat the read
profile, and corroborate that distinct window.

No token, identity, preference, job identifier, saved-job identifier, request identifier, response
body, or real candidate data is retained here.
