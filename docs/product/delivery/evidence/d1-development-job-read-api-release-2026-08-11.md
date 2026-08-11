# D1 Development Job-Read API Release and Acceptance Recovery — 2026-08-11

## Outcome

The first immutable development gateway release containing `GET /v1/jobs/{jobId}` was applied,
but authenticated acceptance exposed a protected-path timeout and is not accepted. Development
remains synthetic-only. The fault is locally remediated and fully repository-verified; a new
immutable artifact and separately reviewed alias release remain required before acceptance can be
replayed.

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

This corrected package is local evidence only. It has not been published or routed.

## Remaining acceptance gate

1. Merge the reviewed source.
2. Publish and read back the exact corrected artifact through the protected development workflow.
3. Prepare, review, and apply a refresh-backed Terraform alias release with no unrelated change.
4. Prove `200/200/401`, the direct boundary matrix, a fresh authenticated `jobs:read` missing-job
   `404`, all alarms `OK`, and zero Terraform drift.
5. Record only the sanitized browser success state.

D1-004 remains in progress. Moderation resolution and end-to-end catalog acceptance remain after
this development read-path recovery.
