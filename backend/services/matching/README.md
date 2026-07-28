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
