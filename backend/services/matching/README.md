# Matching Service

Owns candidate/job retrieval, hard-constraint filtering, feature scoring, ranking, calibration, explanations, and recommendation feedback.

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

`migrations/0001_saved_jobs.sql` is locally runnable through `db:migrate`, but this packet does not
add the service to the shared migration image, task definition, Terraform, or a deployed runtime.
It also does not implement hard-constraint evaluation, ranking, calibration, or explanations.
