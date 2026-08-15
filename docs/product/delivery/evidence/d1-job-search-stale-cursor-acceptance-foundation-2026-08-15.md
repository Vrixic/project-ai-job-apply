# D1 Job Search Stale-Cursor Acceptance Foundation — 2026-08-15

## Outcome

The repository now has a Jobs-owned generated-synthetic contract and a dedicated fail-closed
development operator for the remaining deployed stale-cursor acceptance. Both are locally
implemented, verified, and independently accepted in the current review package; that package has
not been merged, published as an immutable migration image, or executed in AWS.

This does not close D1-005's deployed `409 job_search_catalog_changed` gate.

## Boundary

- The internal entrypoint accepts only exact `prepare`, `mutate`, or `cleanup` actions, one
  lowercase UUID v4/v7 run identifier, an explicit `generated-synthetic-only` confirmation, and a
  bounded UTC timestamp where required. It is not an API or general SQL/command runner.
- `prepare` transactionally creates one exact synthetic company, two query-matching active UUIDv7
  jobs, and one nonmatching revision sentinel using only `authorized_fixture` provenance. It first
  requires the exact Jobs `0004_job_search` migration checksum and an unused run identity.
- `mutate` authenticates the complete company/job/source/event fixture shape and updates only the
  nonmatching sentinel. The existing statement trigger advances the real catalog revision while
  the query's ordered result set stays unchanged.
- `cleanup` repeats the exact-shape and relationship checks, refuses any duplicate relationship,
  deletes only the three claimed synthetic jobs and their otherwise-unused synthetic company, and
  verifies that job, source, status-event, and company rows are gone.
- Every action holds a run-scoped PostgreSQL advisory lock and requires the catalog revision to
  increase. The CLI emits one bounded JSON result with action, run ID, synthetic query token,
  before/after revision, and affected count; failures emit no catalog values.
- The migration task's default command remains the migration runner. The image publisher's
  networkless, read-only, non-root smoke gate now additionally proves both Jobs acceptance modules
  exist in the immutable runtime.

## Local verification

- Jobs type checking and build passed.
- All 21 Jobs unit tests passed, including exact environment/action/time parsing, stable synthetic
  identities, two-match/one-sentinel separation, and bounded-clock rejection.
- All 18 current Jobs PostgreSQL integration cases passed on an isolated loopback-only PostgreSQL
  16.14 cluster. They prove prepare/page/mutate/`409`/restart/cleanup plus adversarial source,
  lifecycle, event, timestamp, and relationship tamper refusal before destructive cleanup. The
  same suite also passed on disposable PostgreSQL 18 as a supplemental compatibility check; both
  servers were stopped after the runs.
- The migration-image publisher guard passed under PowerShell 7 and Windows PowerShell 5.1.
- The dedicated acceptance-operator suite passed under PowerShell 7 and Windows PowerShell 5.1.
- Full infrastructure validation, repository formatting, focused Markdown links, credential-shape
  scanning, and diff checks passed.

## Remaining deployment gates

1. Merge the independently accepted development acceptance operator. It hard-codes the Jobs
   entrypoint and exact environment keys, binds an immutable verified migration-image receipt and
   deployed task definition, uses a durable claimed run ID, retains recovery/cleanup evidence, and
   never accepts an arbitrary command or SQL statement.
2. Publish and verify a new migration image from the merged exact source, and apply a separately
   reviewed task-definition-only Plan. Running the normal migration command must remain distinct
   from acceptance execution.
3. Execute one bounded synthetic flow against the deployed gateway: baseline full result set and
   page-one cursor, sentinel mutation, exact `409 job_search_catalog_changed`, fresh paginated
   restart with the same order and no duplicates/omissions, exact cleanup, clean logs/alarms, and
   refresh-backed zero drift.
4. Preserve explicit nonclaims: no real source or candidate data, public mutation API, saved jobs,
   matching, browser/OIDC acceptance, load result, production readiness, or independent security
   approval.
