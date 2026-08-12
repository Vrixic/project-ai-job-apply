# D1 Canonical Duplicate Resolution — 2026-08-11

## Outcome

D1-004 now has a repository-local, synthetic-only resolution boundary for probable duplicate jobs.
Reviewed exact matches become reversible canonical aliases rather than destructive row moves. A
canonical read follows the alias and aggregates the redacted source summaries from every member,
while reopening the candidate immediately restores both independent records and their provenance.

This is an internal jobs-catalog primitive. It does not add a public or admin API, a user-reporting
surface, real provider ingestion, public UGC, or production data processing. D1-007 continues to own
authenticated job reporting, source controls, and admin moderation.

## Persistence and privacy invariants

- Migration `0002_duplicate_resolution` constrains review outcomes to `exact`, `related_repost`, or
  `not_duplicate`; unresolved candidates remain `probable`. Forward migration
  `0003_duplicate_resolution_audit_guard` makes the audit ledger database-immutable.
- An exact resolution must select one member of the pair as canonical.
- Source rows and original canonical-job rows are never moved or deleted by merge/unmerge.
- A partial unique index prevents one job from aliasing to multiple canonical records.
- Transaction-scoped per-job locks and topology checks reject cycles, chains, or attempts to turn a
  canonical root with existing members into an alias.
- Repeated identical decisions are idempotent.
- Every state change, including reopen, appends a versioned audit event; a database trigger rejects
  direct updates and deletes of those events.
- Current review state stores only an opaque reviewer identifier and a bounded reason code. Free-text
  moderator notes, email addresses, candidate data, and raw artifacts do not belong in this table.
- Canonical reads expose only the existing redacted source summary and never expose review metadata.

## Local verification

The complete repository verifier passed: formatting, lint, contracts, skill validation, serverless
infrastructure policy, type checking, unit tests, and builds. PostgreSQL 16 integration verification
then applied and replayed all jobs migrations against the local catalog and passed all nine
database tests, including:

- probable matches remain separate before review;
- exact review makes either ID resolve to the selected canonical job;
- canonical reads aggregate both redacted source records;
- reopen restores both original jobs and one source per job;
- a later `related_repost` decision preserves separate identity;
- decision/reopen history remains ordered and versioned;
- non-opaque reviewer identifiers fail before database access; and
- ambiguous canonical topology fails closed.

The hardened non-root composed migration container also built successfully. Its first replay against
the reused local database failed closed on unrelated retained unpublished profile rows, as required
by the existing provider-retirement guard. A second replay against a newly created isolated database
applied and verified profile migrations through `0003_retire_legacy_dispatch`, jobs migrations
through `0003_duplicate_resolution_audit_guard`, and the complete multi-owner sequence. The isolated database
was then removed; the retained local records were not changed.

## Deployment state and next gate

This evidence is local only. The forward-only migration and updated gateway artifact are not yet in
development AWS. After merge, deployment must preserve ordering: publish the exact migration image,
apply and verify the jobs schema through `0003_duplicate_resolution_audit_guard`, then
publish/release the exact gateway artifact. Final
acceptance must prove canonical and alias reads, lossless reopen using synthetic records, healthy
alarms, no unhandled failures, and zero Terraform drift. Until then, the already accepted deployed
job-read path remains on its prior schema/runtime and D1-004 remains in progress.
