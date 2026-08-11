# D1 Canonical Job Foundation — 2026-08-11

## Outcome

D1-004 is in progress with its first repository-local vertical foundation implemented. The jobs
service now owns deterministic canonicalization and identity precedence, explicit duplicate
classifications, lifecycle/freshness rules, a separate canonical-job/source-observation data model,
a forward-only checksum migration, and transactional PostgreSQL behavior.

This is synthetic-only implementation under ADR-011. The repository defaults to accepting only
`authorized_fixture` provenance. `permitted_api` and `explicit_ugc` fail closed unless a future
approved runtime explicitly enables them. No real provider ingestion, public contribution, real
candidate data, external application action, deployment, or AWS mutation occurred.

## Contract and compatibility

The pre-release `CanonicalJobV1` schema was corrected before its first catalog deployment:

- lifecycle values now match the accepted `pending -> active -> suspect_stale -> expired |
  withdrawn | blocked` model;
- active/pending/suspect records require a description, while terminal tombstones may omit it;
- source observations carry canonical URL, content hash, optional ATS tenant/requisition identity,
  verified company domain, adapter version, and validity date;
- freshness includes first observation and verification-failure count.

No deployed job-catalog consumer or stored D1 record exists, so this is a pre-release correction,
not a production breaking change. The schema registry compiles under strict JSON Schema validation
and tests reject the obsolete `removed` value.

## Implemented invariants

- Exact identity follows ATS tenant/external ID, then verified-domain/requisition ID, then canonical
  URL hash.
- URL canonicalization removes fragments and tracking parameters and sorts retained parameters.
- URL userinfo is rejected and credential-like query parameters are removed before persistence.
- Title/company alone never causes an exact merge.
- Fuzzy equality creates a `probable` review candidate; it does not merge records.
- Related reposts and non-duplicates are explicitly classifiable.
- Canonical jobs and source observations remain separate, with partial unique indexes enforcing
  exact identity under concurrent writers.
- Successful exact observations are idempotent and can reactivate stale/expired jobs, but cannot
  revive withdrawn or blocked records.
- Three consecutive verification failures mark a live job `suspect_stale`.
- Jobs expire 30 days after positive verification unless a later trustworthy `validThrough` exists.
- Expiry, withdrawal, and blocking remove descriptions and raw source snapshots while retaining the
  minimal source-reference/lifecycle record.
- Conflicting exact identities fail closed for manual resolution.

## Verification

Verification completed locally on Node 24 and PostgreSQL 16:

- jobs-service type checking and build pass;
- 9 pure domain tests pass;
- 6 PostgreSQL integration tests pass, including migration replay and concurrent exact writers;
- domain schema compilation and live/tombstone contract tests pass.
- the fail-fast migration orchestrator runs profile then jobs and stops before later owners on
  failure;
- a clean temporary database passed both owner migrations through the composed orchestrator;
- the exact hardened, non-root migration container built and passed both owner migrations against
  a separate temporary database; the test database and image were removed afterward;
- the full repository check and full clean-database integration suite pass.

At the time of this repository-local verification, D1-004 remained in progress for API/read-model
contracts, cloud artifact release/migration, moderation resolution, and deployed acceptance; this
record made no deployment claim. The subsequent exact development artifact release and
transactional schema migration are recorded separately in the
[development job-catalog migration evidence](d1-development-job-catalog-migration-2026-08-11.md).
D1-004 remains in progress for its API/read model, moderation resolution, and end-to-end catalog
acceptance.
