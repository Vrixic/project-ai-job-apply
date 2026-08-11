# D1 Canonical Job Read API — 2026-08-11

## Outcome

The first candidate-facing canonical-job read slice is implemented and locally verified. It adds
the authenticated `GET /v1/jobs/{jobId}` contract and carries it through the Lambda route boundary,
gateway authorization, jobs-owned PostgreSQL read model, readiness, and tests.

This is repository evidence, not deployment evidence. No gateway artifact, Lambda alias, API route,
Terraform state, database row, or Auth0 tenant changed as part of this slice. Real provider
ingestion, public UGC, real candidate data, and production activation remain disabled under
ADR-011.

## Boundary and behavior

- The endpoint requires the dedicated `jobs:read` OAuth scope. Existing profile endpoints retain
  their exact `profile:read` or `profile:write` application checks.
- Only `active`, unexpired jobs with a live description are readable. Missing, pending,
  suspect-stale, expired, withdrawn, and blocked records fail closed as `404`.
- The response includes canonical company/job display data and redacted source summaries. It does
  not expose raw snapshots, exact ATS/source identifiers, content hashes, deduplication keys, or
  tombstone details.
- Readiness now proves both the profile store and the jobs catalog schema.
- The Lambda route allowlist accepts only `GET` with a structurally valid job UUID; malformed or
  unsupported routes are rejected before application dispatch.
- Catalog display-field and URL bounds align with the public OpenAPI contract, so an accepted
  observation cannot create a response that violates those limits.

## Verification

- OpenAPI generation is stable and contract tests accept active redacted data while rejecting
  terminal status and internal source metadata.
- Jobs unit tests pass `10/10`; the PostgreSQL catalog integration suite previously passed `7/7`
  against a clean PostgreSQL 16 database for this query, including expiry and terminal-state
  exclusion.
- Gateway tests pass `39/39`, including exact-scope allow/deny behavior, malformed identifiers,
  missing records, response redaction, and the Lambda route boundary.
- Terraform module tests pass `7/7`, including the exact protected-scope set.
- The full `scripts/verify-phase0.ps1` repository sequence passes generation, skills,
  infrastructure policy, formatting, lint, type checks, unit tests, builds, Compose validation,
  and removed-scope checks.
- Two consecutive Lambda packages were identical: SHA-256
  `cef771c8230cb1fdc132b8724f2cda5e1c86403e3432d0ed6b493898fec992e6`, 1,225,132 bytes, and
  139 CycloneDX components.

## Release gate

Before a reviewed development release, an Auth0 administrator must add the `jobs:read` permission
to the `ai-job-apply-api` API. A fresh login must then issue a token containing `jobs:read`. The
merged source must be packaged and published through the normal immutable artifact workflow, and
any Terraform/API Gateway and Lambda release plan must be reviewed separately. Until then, this
endpoint is implemented and locally verified only.

D1-004 remains in progress for deployed API acceptance, moderation resolution, and end-to-end
catalog acceptance.
