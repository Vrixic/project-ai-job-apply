# Matching Service

Owns candidate/job retrieval, hard-constraint filtering, feature scoring, ranking, calibration,
explanations, and recommendation feedback.

## Planned subfolders

- `retrieval/` — Lexical, taxonomy, location, and vector candidate retrieval.
- `constraints/` — Authorization, location, compensation, and other hard gates.
- `ranking/` — Feature construction and ranking strategies.
- `explanations/` — Grounded reasons, gaps, and warnings.
- `feedback/` — Saves, hides, preparation choices, corrections, and workflow-quality signals.
- `evaluation/` — Offline relevance and calibration evaluation.
- `tests/` — Constraint, ranking, bias-guardrail, and fallback tests.

The service consumes profile and job facts through contracts and does not use voluntary demographic data or post-submission hiring outcomes.

## Saved-job source slice

The implemented source slice owns private saved-job associations in the `matching` schema. It
persists the immutable requested job identifier, canonical identifier at save time, and a bounded
public snapshot in typed columns. It never stores descriptions, raw source records, candidate
profile values, arbitrary JSON, matching scores, explanations, or post-submission outcomes.

Lists use owner-bound, revision-bound HMAC keyset cursors and bounded Jobs-owned batch resolution.
Unavailable postings retain their historical public snapshot without exposing lifecycle reasons.
Each explicit requested target remains independently visible; repeating the same requested target
is idempotently deduplicated. Future grouping across different requested targets requires a bounded
Jobs dedupe event/projection and must not destroy the requested identity needed for reversible
reopen behavior.
An owner can retain at most 1,000 saved associations and 2,000 create-command replay records.
Create idempotency is retained for 24 hours; expired rows are removed lazily under the same
owner-scoped transaction before another command is admitted. Replays inside that window return the
original typed projection without reading a changed catalog.

`migrations/0001_saved_jobs.sql` is locally runnable through `db:migrate` and is present in the
source migration-image composition. No immutable image containing it is published or deployed.

## Constraint assessment vertical

The implemented source-only assessment service reads the owner-self Profile preference snapshot
and the bounded Jobs-owned active match projection, then applies the deterministic kernel. It emits
value-free reason codes in a fixed order. Exact known work-mode or employment-type contradictions
can set the gate to `excluded`.
Missing or unknown job values never exclude. Exact normalized title and location overlap is only
supporting evidence; non-overlap remains `unknown` rather than becoming a negative inference.

Compensation remains unavailable because the current preference pair has no pay cadence or
base-versus-total meaning and the current job projection has no typed compensation. Authorization,
sponsorship, seniority, blocked-company, and qualification evidence also remain unavailable. A
legacy sponsorship boolean, regardless of value, blocks the assessment without exposing or using
that Restricted value. The kernel does not accept profile facts, protected or voluntary demographic
data, descriptions, raw source material, or arbitrary explanation text.

The owner-self `jobs:read` API and saved-job UI expose this fixed evidence only on demand and never
accept a client owner identifier. Responses bind the requested and canonical job identities,
preference version, catalog revision, and trusted assessment time, are `no-store`, and fail closed
if either dependency is malformed or the job expires during the read. No assessment is persisted,
cached, emitted as an event, or used to reorder search results.

This packet adds no scoring, ranking, fit band, generated prose, eligibility claim, application
decision, deployment, or AWS behavior. Its generated-synthetic fixtures prove only mechanical
deterministic semantics. They are not the representative D1 matching set or accepted evaluation
rubric required by D1-R2, so grounded product explanations and matching-quality acceptance remain
open.
