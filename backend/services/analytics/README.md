# Analytics Service

Owns product-event validation, experiment assignment, funnel construction, attribution, de-identification, and application-efficiency metric definitions.

## Planned subfolders

- `events/` — Approved event taxonomy and runtime validation.
- `experiments/` — Assignment, exposure, and guardrail logic.
- `funnels/` — Discovery-to-confirmed-submission measurement.
- `attribution/` — Source, strategy, and application-workflow attribution.
- `privacy/` — Minimization, hashing, aggregation, and deletion propagation.
- `exports/` — Warehouse and business-intelligence pipelines.
- `tests/` — Schema, privacy, assignment, and metric-consistency tests.

Analytics is not an operational source of truth and must not receive resumes, tokens, unrestricted application content, or recruiter/interview/offer outcomes.
