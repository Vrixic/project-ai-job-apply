# Evaluation Sets

Contains versioned, representative evaluation cases for matching, parsing, document generation, application answers, outreach, and safety.

## Planned subfolders

- `matching/` — Relevance, hard constraints, calibration, and explanations.
- `extraction/` — Resume, job, email, and form parsing.
- `documents/` — Factuality, relevance, formatting, and rendered output.
- `answers/` — Field classification, grounding, and sensitivity.
- `outreach/` — Personalization truthfulness and restraint.
- `security/` — Prompt injection and malicious-content resistance.
- `rubrics/` — Versioned scoring definitions.

Cases use synthetic or consented/de-identified data and include expected outcomes, not only inputs.

The first executable set is the
[`D1 match-assessment set`](matching/d1-match-assessment.v1.json). It is generated-synthetic
scenario coverage for the already selected US-English early/mid-career software, data, and product
launch segment. It is not a statistical population sample, provider fixture, ranking or calibration
set, or evidence about hiring outcomes. Its candidate rubric remains pending accountable Product
and QA approval.
