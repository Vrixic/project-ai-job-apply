# D1 Managed-OIDC Read Acceptance and Saved-Job Remediation

- Date: 2026-08-24
- Environment: isolated development
- Status: read and saved-job application/AWS workload acceptance passed
- Correction sources: `e28f739`, `a6dfae43cd98dd0cab546ef37af84aee0b649bf8`,
  `9421e22bc9c9278191536f9dad396ae25538130f`,
  `5cea6782e7c3e0fe3ffc669b84c1f4536c4af6de`,
  `ec6aaca463893d89d43263bc1848b0a55ff6440b`,
  `3a169890d42067ccc58268622b8ef6845382cfc5`,
  `8307694f6b92adb104e048f8cf3d1e6936916d7c`,
  `d05b54fd2bdfd8380914bc9eadae9ab5f4d42a03`

## Read result

The product owner ran the fixed managed-OIDC profile with the approved synthetic account. Only the
following aggregate result is retained:

```json
{
  "profile": "d1_deployed_read_v1",
  "startedAt": "2026-08-25T01:06:56.213Z",
  "endedAt": "2026-08-25T01:07:09.107Z",
  "durationMs": 12894,
  "baselineContractsValidated": 4,
  "publicRequests": 150,
  "publicFailures": 0,
  "authenticatedRequests": 100,
  "authenticatedFailures": 0,
  "publicLatency": {
    "p50Ms": 62,
    "p95Ms": 78,
    "maxMs": 1495
  },
  "authenticatedLatency": {
    "p50Ms": 79,
    "p95Ms": 111,
    "maxMs": 227
  }
}
```

The exact two-minute `D1Read` AWS corroboration passed. Its aggregate-only result is retained below:

```json
{
  "environment": "development",
  "workloadProfile": "D1Read",
  "windowMinutes": 2,
  "apiRequests": 254,
  "minimumApiRequests": 254,
  "api4xx": 50,
  "minimumExpected4xx": 50,
  "api5xx": 0,
  "apiLatencyAverageMs": 38.22,
  "apiLatencyMaximumMs": 2383,
  "lambdaInvocations": 206,
  "lambdaErrors": 0,
  "lambdaThrottles": 0,
  "lambdaDurationMaximumMs": 670.58,
  "databaseCpuMaxPercent": 5.86,
  "databaseConnectionsMax": 5,
  "eventQueueAgeMaxSeconds": 0,
  "eventQueueVisibleMax": 0,
  "deadLetterMessagesMax": 0,
  "durableDeadLetterMax": 0,
  "logEvents": 472,
  "logErrorMatches": 0,
  "forbiddenLogMatches": 0,
  "activeEcsServices": 0,
  "runningEcsTasks": 0,
  "runtimeAlarmsOk": 10,
  "dispatchTarget": "lambda_durable",
  "triggersEnabled": true,
  "terraformDrift": 0
}
```

This closes the fixed read workload's application and AWS gate. It is a bounded development result,
not a production SLO or capacity claim.

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

The alias-`33` rerun again returned `failureStage=create`; cleanup was attempted and succeeded. The
value-free boundary code is `SAVED_JOB_FIND_REPLAY`, isolating the failure to the pre-transaction
idempotency replay query. Exact source `ec6aaca463893d89d43263bc1848b0a55ff6440b` now accepts only a
single scalar idempotency key at the HTTP boundary, repeats that invariant before PostgreSQL I/O,
and sends the replay lookup only validated string parameters with explicit `uuid`, `text`, and
`timestamptz` casts. Matching unit 84, Gateway 108, both typechecks, and real PostgreSQL integration
5/5 pass. Docker Desktop and WSL were stopped afterward. Deterministic artifact
`81f6458c0166224c739abe5666e17d9d611442dcba579e0c4461cc08ebed653e` is deployed on immutable
gateway alias `34` at state serial `194`; the exact plan changed only the gateway function and
alias, and the refresh-backed plan has zero meaningful changes with SHA-256
`5c33f802b72a3a40658fc0e8fe90507f72106a9a043f20d11981131503bdcd60`.

The alias-`34` rerun again returned `failureStage=create`; cleanup was attempted and succeeded.
The replay correction is therefore live and moved the value-free failure boundary forward to
`SAVED_JOB_CATALOG_LOOKUP`. The saved-job resolver was unnecessarily loading the complete active
job, including source aggregation, when it needed only the bounded public summary. Exact source
`3a169890d42067ccc58268622b8ef6845382cfc5` now resolves that summary through the existing bounded
batch reader and binds its PostgreSQL UUID collection with the driver's explicit array helper.
Jobs unit 63, Gateway 108, both typechecks, and Jobs real-PostgreSQL integration 41/41 pass. Docker
Desktop and WSL were stopped afterward. Deterministic artifact
`ba1d7b3d033a81583cb457707a5d7e53155c09373323e213a68248450f7c876e` is deployed on immutable
gateway alias `35` at state serial `195`; plan SHA-256
`3381b60cbb3fe36620636a697e33817a3555d7f62bd7a710b5fa9a649ec563df` changed only the gateway
function and alias. Live code/release binding passed, and the refresh-backed plan has zero
meaningful changes with SHA-256
`41f88fba419b271ccee2820b3d640a72167d11c7c074fd135dd4257b1925df60`.

The alias-`35` rerun again returned `failureStage=create`; cleanup was attempted and succeeded.
The catalog correction is live and advanced the value-free boundary into the atomic transaction at
`SAVED_JOB_EXPIRED_CLEANUP`, before any association insert. That statement was the remaining
create-path query that bound a JavaScript `Date` directly. Exact source
`8307694f6b92adb104e048f8cf3d1e6936916d7c` normalizes every transaction clock value to canonical
ISO text with explicit PostgreSQL `timestamptz` casts and explicitly types the cleanup/count/lookup
identifiers. Its regression test proves no `Date` object crosses the create transaction boundary.
Matching unit 85, Gateway 108, both typechecks, and Matching real-PostgreSQL integration 5/5 pass.
Docker Desktop and WSL were stopped afterward. Deterministic artifact
`14eeac7cf5a4c02b483694c0a29308bef8b3d88c25b6976cff9d24f819530296` is deployed on immutable
gateway alias `36` at state serial `196`; reviewed plan SHA-256
`f16bb76c967a8c78490043a654f3e8cc4b3b73f55f7e245ea34681a2a18ede96` changed only the gateway
function and alias. Live binding and the 24-case direct boundary passed, and the refresh-backed plan
has zero meaningful changes with SHA-256
`3281cca064e3f36e64247077f92e28e66ce5ef8a26a5980b63cb108067c0dfe9`.

The alias-`36` lifecycle passed create, exact replay, expected conflict, and read-after-write, then
returned `failureStage=delete`; cleanup was attempted and failed. Both DELETE requests reached the
owner-scoped route and failed with the same privacy-safe `TypeError` / `ERR_INVALID_ARG_TYPE`.
Delete and its audit are atomic, so both delete attempts rolled back while the earlier successful
create remained committed. Exactly one workload-created association therefore remains as the
newest saved-job item for the approved synthetic account; no pre-existing association was touched.

The unsave audit statement contained the last direct JavaScript `Date` binding. Exact source
`d05b54fd2bdfd8380914bc9eadae9ab5f4d42a03` normalizes it to canonical ISO text with an explicit
PostgreSQL `timestamptz` cast and explicitly types the delete owner/resource predicates. Its
regression covers the complete delete transaction and proves no `Date` crosses that boundary.
Matching unit 86, Gateway 108, both typechecks, and Matching real-PostgreSQL integration 5/5 pass.
Docker Desktop and WSL were stopped afterward. Deterministic artifact
`87c2b53ea0d13302d1b860628d8122f591579e5da9c0fd073fbbcd6df5199aa6` is deployed on immutable
gateway alias `37` at state serial `197`; reviewed plan SHA-256
`9393c4ae8679ae331fbee1925f54987d60768c2993fb7be09db3d46ca24f3b97` changed only the gateway
function and alias. Live binding and the 24-case direct boundary passed, and the refresh-backed plan
has zero meaningful changes with SHA-256
`84fba83630f3ead3fad98e78eefcaec28416153e85a0224c1565026b3c7547ad`.

The product owner then removed the one retained workload-owned association through the normal
authenticated UI and confirmed that it left the list. A fresh alias-`37` lifecycle passed every
application assertion and removed its own association. Only this aggregate result is retained:

```json
{
  "profile": "d1_deployed_saved_job_lifecycle_v1",
  "startedAt": "2026-08-25T00:57:35.638Z",
  "endedAt": "2026-08-25T00:57:37.842Z",
  "durationMs": 2204,
  "catalogPagesValidated": 2,
  "savedJobPagesValidated": 1,
  "writesSucceeded": 1,
  "idempotentReplays": 1,
  "expectedConflicts": 1,
  "cleanupDeletes": 1,
  "postCleanupAbsent": true
}
```

The exact minute-rounded `D1SavedJob` AWS corroboration passed. Its aggregate-only result is retained
below:

```json
{
  "environment": "development",
  "workloadProfile": "D1SavedJob",
  "windowMinutes": 1,
  "apiRequests": 13,
  "minimumApiRequests": 10,
  "api4xx": 1,
  "minimumExpected4xx": 1,
  "api5xx": 0,
  "apiLatencyAverageMs": 89.23,
  "apiLatencyMaximumMs": 431,
  "lambdaInvocations": 14,
  "lambdaErrors": 0,
  "lambdaThrottles": 0,
  "lambdaDurationMaximumMs": 287.57,
  "databaseCpuMaxPercent": 5.1,
  "databaseConnectionsMax": 2,
  "eventQueueAgeMaxSeconds": 0,
  "eventQueueVisibleMax": 0,
  "deadLetterMessagesMax": 0,
  "durableDeadLetterMax": 0,
  "logEvents": 27,
  "logErrorMatches": 0,
  "forbiddenLogMatches": 0,
  "activeEcsServices": 0,
  "runningEcsTasks": 0,
  "runtimeAlarmsOk": 10,
  "dispatchTarget": "lambda_durable",
  "triggersEnabled": true,
  "terraformDrift": 0
}
```

The preceding application pass at `00:48` remains useful lifecycle evidence, but its shared AWS
bucket was correctly rejected because it contained 21 requests, one API 5xx, and one Lambda
throttle. It is not recorded as an AWS pass.

## Verification and next action

- Saved-job persistence: Matching unit 86 and real PostgreSQL integration 5/5 passed.
- Gateway boundary: Gateway 108 and both affected typechecks passed.
- Corrective release: deterministic double build, immutable publication/readback, alias `37`,
  exact two-resource plan, live code/release binding, and zero meaningful Terraform changes passed.
- Residual cleanup: the one alias-`36` workload-owned association was removed through the normal UI.
- Alias-`37` application lifecycle: the accepted 2,204 ms run validated two catalog pages and one
  saved-job page; one write, replay, expected conflict, cleanup delete, and post-cleanup absence passed.
- Saved-job AWS bucket: accepted with 13 API requests, one expected 4xx, zero 5xx/errors/throttles,
  zero queue/dead-letter backlog, zero error/restricted log matches, ten healthy alarms, idle ECS,
  Lambda Durable dispatch, and zero Terraform drift.
- Read application/AWS workload: four baselines, 150 public and 100 authenticated reads, zero
  failures, exact 254-request AWS floor, 50 expected 4xx responses, zero 5xx/errors/throttles,
  zero backlog or error/restricted log matches, ten healthy alarms, idle ECS, and zero drift passed.

Both fixed managed-OIDC workload profiles and their AWS windows require no further rerun. D1-R10
remains open only for its separately tracked browser/security-header breadth, representative SLO,
assistive-technology/human accessibility, independent security/privacy, and product acceptance.

No token, identity, preference, job identifier, saved-job identifier, request identifier, response
body, or real candidate data is retained here.
