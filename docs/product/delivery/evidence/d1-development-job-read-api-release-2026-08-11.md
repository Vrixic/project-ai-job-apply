# D1 Development Job-Read API Release and Acceptance Recovery — 2026-08-11

## Outcome

Three immutable development gateway releases containing `GET /v1/jobs/{jobId}` were applied, but
the read path is not yet accepted. The first release performed an unnecessary profile identity
write and timed out. Version `8` removed that write and passed its reviewed release boundary, but a
new direct missing-job case proved that the bundled application returns `500` after authorization.
Version `9` safely classified the failure as `TypeError` / `ERR_INVALID_ARG_TYPE` at the job route.
The narrow parameter-serialization correction is locally verified but not merged or released.

## Applied release evidence

- Target: development account `362544434697`, `us-east-2`.
- Reviewed Terraform plan SHA-256:
  `e81d0a3d65285e59e5021f0431f7b3c221615c6f7e6dcb38562b4ffb6b48e447`.
- Source SHA: `3621e2b5b2743ae40d261ddbf313e0c8e9b8d8a1`.
- Gateway artifact SHA-256:
  `cef771c8230cb1fdc132b8724f2cda5e1c86403e3432d0ed6b493898fec992e6`.
- The apply changed only the protected API route, gateway Lambda function, and development alias.
  Alias version `7` became active with no weighted routing.
- The protected API route requires exactly `jobs:read`, `profile:read`, and `profile:write`.
- Public liveness, readiness, and anonymous denial returned `200/200/401`; all 16 development
  alarms were `OK`; the post-apply refresh plan had zero changes.
- The direct no-write Lambda boundary matrix initially passed before browser acceptance.

## Auth0 and browser findings

- The Auth0 API defines `jobs:read`, `profile:read`, and `profile:write` for audience
  `ai-job-apply-api`.
- Auth0's per-application user-delegated grant initially omitted `jobs:read`, producing the
  expected sanitized `403`. The grant was corrected to the three exact scopes; client access
  remains disabled.
- The local conformance control initially remained in `Checking…` because it awaited cancellation
  of an ignored upstream response stream. The body is now discarded asynchronously, the gateway
  request is bounded to 10 seconds, and the browser control is bounded to 15 seconds. A regression
  test proves a never-settling cancellation cannot hold the response open.
- After the Auth0 grant correction and a fresh authorization, the job route returned an unexpected
  response. Privacy-safe aggregate inspection found handled HTTP `500` responses and classified
  Lambda timeouts; no raw log, token, subject, or candidate value was printed or retained.
- Current liveness and database-backed readiness both continue to return `200`, RDS is available,
  and the migration-only ECS cluster has zero running or pending tasks.

## Boundary correction

The shared canonical catalog is not candidate-owned. Its read route previously called profile
identity resolution, which performs an unnecessary `last_seen_at` write before every catalog
read. The corrected route verifies the managed principal and exact `jobs:read` scope without
creating or updating an internal profile identity. Owner-scoped profile and operation routes keep
their existing issuer/subject-to-user resolution.

Tests assert successful, forbidden, missing, and malformed job reads perform zero profile identity
writes. Gateway tests pass `39/39`; web tests pass `40/40`; the complete
`scripts/verify-phase0.ps1` sequence passes generation, policy, format, lint, type checks, unit
tests, builds, Compose validation, and removed-scope checks.

Two consecutive corrected Lambda packages are identical:

- SHA-256: `74ed2ba72ad0d627c12236b16a6043bfc34ea617c31399548065b6db3635ebbd`
- Size: 1,225,151 bytes
- CycloneDX components: 139

At that checkpoint the corrected package was local evidence only. It was subsequently published
and routed as version `8` under the exception and reviewed plan below.

## Version 8 recovery release

GitHub Actions run
[31540953205](https://github.com/Vrixic/project-ai-job-apply/actions/runs/31540953205)
failed before runner allocation because no Actions capacity remained. With product-owner approval,
the exact merged artifact was published once through the temporary development IAM Identity Center
administrator session. This is a documented development-only exception, not a replacement for the
protected OIDC publisher.

- Source SHA: `787469bf5b1e82b54dc8d10b6a03be371c7dc042`.
- Artifact SHA-256: `74ed2ba72ad0d627c12236b16a6043bfc34ea617c31399548065b6db3635ebbd`.
- Four previously unused immutable keys were written to the versioned private artifact bucket.
- Every object used customer-managed KMS encryption and exact source/artifact metadata. The ZIP's
  stored checksum and independently downloaded SHA-256 matched.
- Reviewed release-plan SHA-256:
  `7bf25e349d2a68dd8215e47f8f831848274383afe4f8e72654bea23a47e240d2`.
- The exact plan applied `0` creates, `2` in-place updates, `0` deletes, and `0` replacements.
  Alias version `8` became active without weighted routing.
- Liveness, readiness, and anonymous denial returned `200/200/401`; the original 15-case direct
  matrix passed without writes; all 16 alarms were `OK`; post-apply zero-drift plan SHA-256 was
  `59b7e59b2648fe4bfcd780356f527e612c9560aa13832a46e41e16dd91969af7`.

Browser acceptance still returned the sanitized inconclusive state. The direct verifier previously
did not exercise the job route. Adding an exact `jobs:read` missing-job case reproduced status
`500` against version `8`, including with a version-7 UUID, while the Lambda invocation itself
completed normally.

One short-lived read-only diagnostic used the retained migration task definition and stopped with
exit code `0`. It proved schema/table permissions, a simple missing-ID query, and the exact active
catalog query all succeeded with zero rows. The RDS error log contained no corresponding database
error. This narrows the defect to an unclassified client-side exception in the bundled application
path rather than Auth0, API Gateway, database permissions, schema state, or the SQL statement.

The repository added the missing deployed job-route case and a privacy-safe internal-failure
classifier. It emits only an allowlisted route template, error type, and constrained error code;
tests prove messages, stacks, bearer values, email, location, and filesystem content cannot enter
the diagnostic. Gateway tests pass `40/40`, web tests pass `40/40`, type checks, lint, and formatting
pass.

## Version 9 diagnostic release

- Source SHA: `2d9090c5794b076b4dae36632f707b9ba305e7c0`.
- Artifact SHA-256: `9753fd74a81deddd7bc203a4b0121a5fdbbad2cf4223595a2df2ef610c7d9edd`.
- The artifact was reproduced twice, passed the dependency audit, and was written once under four
  previously unused keys in the private versioned artifact bucket. Customer-managed KMS,
  checksum, source metadata, and read-back verification passed.
- Reviewed release-plan SHA-256:
  `9cfaf60245686dd929c2ff24896c2e01fe9b4c8bcdcf4616145412a0c0599e5d`.
- The exact plan applied `0` creates, `2` in-place updates, `0` deletes, and `0` replacements.
  Alias version `9` became active without weighted routing and matched the artifact checksum.
- The full steady-state preflight passed Lambda state, durable triggers, Auth0 configuration,
  Terraform inputs, alarms, and public `200/200/401` behavior.
- One direct missing-job reproduction returned the expected diagnostic `500`. CloudWatch retained
  only the allowlisted classification: route `/v1/jobs/:jobId`, error type `TypeError`, and error
  code `ERR_INVALID_ARG_TYPE`.

The failing query was the only path passing a JavaScript `Date` object across this bundled
postgres.js parameter boundary. The local correction converts the already trusted internal
freshness boundary to an ISO timestamp before binding it; the job identifier and timestamp remain
parameterized. New repository tests prove primitive binding and fail-closed handling of an invalid
internal date. Jobs tests pass `12/12`, gateway tests pass `40/40`, both type checks pass, and the
Lambda bundle builds. Docker was unavailable, so deployed correction acceptance remains required
and no PostgreSQL integration pass is claimed for this change.

## Remaining acceptance gate

1. Merge the parameter-serialization correction.
2. Publish and apply a separately reviewed immutable correction release.
3. Prove `200/200/401`, all direct boundary cases including missing-job `404`, a fresh authenticated
   browser pass, all alarms `OK`, and zero Terraform drift.
4. Record only sanitized acceptance evidence.

D1-004 remains in progress. Moderation resolution and end-to-end catalog acceptance remain after
this development read-path recovery.
