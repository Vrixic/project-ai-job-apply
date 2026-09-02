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

This source vertical adds no scoring, ranking, fit band, generated prose, eligibility claim,
application decision, deployment, or AWS behavior. Its component fixtures prove only mechanical
deterministic semantics. The separate exact PR #312 v1 evaluation candidate below is the accepted
generated-synthetic D1 baseline under D1-R2; that acceptance does not broaden these source claims
or complete D1-005.

## Private saved-page capture foundation

The default-dark Phase 2 foundation stores a private owner-scoped capture independently of public
job contribution. It accepts only exact Greenhouse, Lever (including `jobs.eu.lever.co`), and Ashby
provider/variant/HTTPS path combinations and typed bounded text fields. It rejects markup, control
and bidirectional-override characters, credentials, queries, fragments, arbitrary fields, and raw
DOM. No token, cookie, form value, page body, arbitrary JSON, public event, or outbox is stored.

The original capture is immutable and create commands use a client UUIDv7 plus a value-bound,
24-hour idempotency receipt. Reads and deletes always bind the authenticated owner. A later
canonical job link is a separate append-only row and identifier-only audit transition that the
service performs only after an injected independent verifier accepts the exact source and evidence
identifiers. It never publishes, activates, refreshes, or changes Jobs-owned catalog truth.
Account-active and resolution-verification dependencies default deny. The additive Phase 2
transport binding exposes create, owner read, and idempotent owner delete through Gateway. The
extension create request maps only the exact sanitized source/snapshot shape; it does not use
contribution consent and emits no public event. Gateway uses a real Profile-owned active-account
check, while missing authority remains fail-unavailable. Canonical resolution stays an
independently verified internal service operation with no candidate write route. Lambda's
method/path allowlist still excludes all capture routes, so this is locally verified and
default-dark rather than deployed activation.

## D1 evaluation candidate

The versioned generated-synthetic
[`d1-match-assessment-synthetic-v1`](../../../data/evals/matching/d1-match-assessment.v1.json)
candidate exercises the same pure kernel across 36 launch-segment scenarios. Its 24 core cases
cover all software/data/product and declared early/mid segment cells; 12 guardrails cover sparse,
normalization, semantic-near, compensation, dual-conflict, and restricted-preference behavior. The
strict evaluator requires exact results for all 36 cases, all 306 successful evidence tuples, all
13 known-conflict exclusions, zero false exclusions across 21 non-conflict assessments, both
restricted-preference refusals, deterministic replay, and all 15 reason codes.

The web presentation resolves those codes and both gates through typed fixed copy; neither the
kernel nor presentation interpolates candidate or job values into explanations. Vrij's Product
approval and independent QA acceptance freeze the exact PR #312 v1 corpus, all-or-nothing rubric
and evaluator thresholds, gate semantics, fixed copy, and documented conservative limitations;
D1-R2 is closed. Any material input, expectation, taxonomy, threshold, semantic, or copy change
requires a new version and renewed Product and QA review. The accepted baseline remains neither a
statistical sample nor evidence for ranking, calibration, provider behavior, real users,
deployment, eligibility, application outcomes, or production quality. See the
[`Product and QA acceptance`](../../../docs/product/delivery/evidence/d1-match-assessment-v1-product-qa-acceptance-2026-08-17.md)
and [`v1 rubric`](../../../data/evals/rubrics/d1-match-assessment.v1.md).
