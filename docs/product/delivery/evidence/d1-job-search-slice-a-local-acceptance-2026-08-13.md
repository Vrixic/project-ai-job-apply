# D1 Job Search Slice A Local Acceptance — 2026-08-13

- Task: D1-005
- Result: Local Slice A acceptance passed; D1-005 remains in progress
- Environment: Local source, synthetic fixtures, and disposable PostgreSQL 16
- Deployment state: Not migrated or released

## Implemented scope

The first D1-005 slice implements non-personalized discovery over the existing canonical catalog:

- a strict `POST /v1/jobs/search` OpenAPI contract with the exact `jobs:read` scope, a bounded JSON
  body, supported keyword/title/company/location/freshness filters, relevance or freshness sort,
  bounded pages, and active redacted summaries;
- a jobs-owned forward migration for weighted PostgreSQL full-text retrieval and supporting active,
  title, location, and freshness indexes, plus a catalog revision guard for continuations;
- a parameterized active-catalog read that excludes expired, terminal, incomplete, and reviewed
  exact-duplicate loser records;
- an exact Lambda route and application authorization check that do not create a profile identity
  record or return descriptions, source metadata, raw snapshots, hashes, or candidate facts;
- a narrow server-side BFF that keeps the Auth0 token server-held and rejects query strings,
  non-JSON media, empty bodies, invalid UTF-8, and bodies larger than 64 KiB; and
- a responsive labelled web form with bounded filters, active-job summaries, an explicit
  non-personalization statement, a 20-second browser timeout, and continuation-page handling.

This slice does not implement saved jobs, hard-constraint profile matching, grounded match
explanations, provider ingestion, UGC, public job pages, or application submission behavior.

## Validation convention

The API intentionally uses `400 Bad Request` for strict schema and bounded domain failures,
including unsupported search fields, filters, sort values, page sizes, and continuation cursors.
Malformed JSON is also `400`; unsupported media and oversized bodies are `415` and `413`. The
platform does not use `422` for this route. Search-specific validation errors are value-free and do
not reflect candidate query or filter text.

## Local verification

The composed working tree passed these read-only checks on 2026-08-13:

- generated TypeScript output exactly matched the OpenAPI source;
- API contracts: 11/11 tests;
- jobs unit tests: 14/14 tests;
- jobs PostgreSQL integration: 13/13 tests, including two-pass migration replay;
- gateway: 50/50 tests;
- web: 58/58 tests, including rendered loading, live-region, timeout, and catalog-restart behavior;
- focused API-contract, jobs, gateway, and web type checks;
- repository formatting and lint commands; and
- `git diff --check` plus relative Markdown file/anchor validation.

The PostgreSQL suite ran against the repository's disposable PostgreSQL 16 dependency. It replayed
all Jobs migrations through `0004_job_search` twice, exercised search/filter pagination, active and
duplicate exclusion, parameterized injection text, catalog-mutation continuation rejection, and an
`EXPLAIN (FORMAT JSON)` proof for the location GIN index.

## Independent review remediation

Independent review identified and the combined working tree closed these findings before local
acceptance:

1. continuation cursors are now versioned, HMAC-SHA256 authenticated with a server-only,
   domain-separated 32-byte key, bound to the canonical request, short lived, and rejected after
   tampering or credential rotation;
2. statement-level catalog revision triggers and a read-only repeatable-read search transaction
   reject a continuation after catalog mutation, with a bounded `409 job_search_catalog_changed`
   response that tells the browser to restart from page one; and
3. the location predicate now uses array containment aligned with the GIN index and its executable
   PostgreSQL plan contains `canonical_jobs_normalized_locations_gin`.

The development migration operator and its focused source test now require the exact Jobs
`0004_job_search` aggregate success marker and reject the retired `0003` marker.

## Deployment gates and non-claims

No AWS, Auth0, database, traffic, or real-data state changed for this slice. After local review
passes, deployment still requires one immutable merged revision, a scanned digest-pinned migration
image, a checksum-reviewed development migration task, an immutable gateway artifact/release,
authenticated browser acceptance, anonymous and insufficient-scope denial, bounded workload and
log review, rollback readiness, and refresh-backed zero drift.

This evidence does not complete D1-005 or any D1 exit criterion. Real provider data, real candidate
data, production activation, source permission, capability-specific privacy/security approval, and
independent launch review remain blocked by their owning gates.

## References

- [Phase 1 task register](../phase-1-web-and-job-catalog.md)
- [API security inventory](../../../security/api-security-and-final-review.md)
- [Canonical job acceptance](d1-development-duplicate-resolution-acceptance-2026-08-12.md)
- [OpenAPI source](../../../../packages/api-contracts/openapi/platform.v1.json)
- [Jobs persistence](../../../../backend/services/jobs/src/persistence/catalog.ts)
