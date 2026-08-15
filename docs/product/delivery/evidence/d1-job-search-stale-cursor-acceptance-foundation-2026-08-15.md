# D1 Job Search Stale-Cursor Acceptance Foundation — 2026-08-15

## Outcome

The repository now has a Jobs-owned generated-synthetic contract and a dedicated fail-closed
development operator for the remaining deployed stale-cursor acceptance. The original package is
locally implemented and verified, but pre-deployment review found that the retained CompleteDark
Terraform baseline is bound to an earlier migration-operator commit and therefore would not have
been consumable after the package merge. The accepted correction adds a separately reviewed,
canonical baseline-operator-to-current delta handoff to `PlanTask` and `ApplyTask`; its focused
PowerShell 7 and Windows PowerShell 5.1 verification passes, and two independent reviews accept
the exact frozen correction and synchronized documentation. PR #278 squash-merged the accepted
23-file tree at `eb0b7a169dc41cf34159e32df42b32ea9ed69276`. It has not been published as an
immutable migration image, registered in a new task definition, or executed in AWS.

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

The retained-baseline handoff correction is deliberately tracked separately from those original
results. It accepts an older baseline only from schema-3 or schema-4 `CompleteDark` metadata,
requires its stored release/operator binding to remain valid, requires its operator commit to be
an ancestor of clean current `main == origin/main`, and checksum-binds the complete canonical
baseline-to-current Git delta on both task planning and apply. It does not generally permit an old
Terraform state: the sole stale-state case is the exact schema-3 `CompleteDark` plan
`2143c836f9c55d2126efef55b314f167b35d593d64338791cb6c3837c6e2a6a4` and sidecar
`e0efc63e7c17685e363e23f15f7f1d39e83c46beff3f08fdb768bd67e78b8011` from operator
`9d290416c61847f1682157c08312cdb920d42107`, lineage
`472ef790-b249-45ec-817f-718005980d9e`, retained serial `107`, handed to the same lineage at exact
planning serial `108`. Every other ancestor baseline must equal the planning state. Task-metadata
schema 2 separately binds both state identities, both operator identities, the reviewed delta,
and the task plan, and is itself independently checksum-bound for every downstream action.
Exact-current schema-1/3/4 baselines require the review-hash argument to be omitted. Clean-source
guards bind the explicit remote ref, Git exit status/index flags, every tracked Terraform source
byte, and all non-plan extras before Terraform initialization and again around plan/apply. The
correction has local code evidence but is not yet merged or deployed.

The corrected migration-operator AST parses, its focused suite passes on PowerShell 7 and Windows
PowerShell 5.1, and `git diff --check` passes. The locally reviewed file SHA-256 values are
`f93179ddedd99285154d9d591951a63ef8da24e08dd709102e27bba0d6e38793` for the operator and
`687646d06ad53a6aacdab435ba7b42ac6386b905d7be3661f10ac810aa5a0d33` for its focused tests.
These are the merged operator/test hashes; they are not an image, Terraform-plan, or AWS receipt.

## Remaining deployment gates

1. Freeze the final clean `main == origin/main` revision containing the synchronized tracking
   updates and rerun the exact-source checks. The acceptance operator hard-codes
   the Jobs entrypoint and exact environment keys, binds an immutable verified migration-image
   receipt and deployed task definition, uses a durable claimed run ID, retains recovery/cleanup
   evidence, and never accepts an arbitrary command or SQL statement.
2. Publish and independently verify a new migration image from that exact source. No image receipt
   or scan result exists for the current package.
3. Independently derive and review the retained CompleteDark baseline-to-current canonical delta;
   run `PlanTask` with its checksum and accept only the image-driven task-definition replacement.
   Review both the saved plan and adjacent task-metadata checksums. Run `ApplyTask` with the same
   delta checksum plus both reviewed task-plan hashes, then prove the digest-pinned definition is
   active and ECS returned to zero tasks. Running the normal migration command must remain distinct
   from acceptance execution.
4. With a temporary development AWS session, complete the separate status, plan, independent
   descriptor review, execute-once, receipt review, and verify gates. Execute one bounded
   synthetic flow against the deployed gateway: baseline full result set and
   page-one cursor, sentinel mutation, exact `409 job_search_catalog_changed`, fresh paginated
   restart with the same order and no duplicates/omissions, exact cleanup, clean logs/alarms, and
   refresh-backed zero drift.
5. Preserve explicit nonclaims: no real source or candidate data, public mutation API, saved jobs,
   matching, browser/OIDC acceptance, load result, production readiness, or independent security
   approval.
