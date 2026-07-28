# AI Workers

Execute model calls for parsing, matching support, grounded document generation, application answers, outreach drafts, application-agent tasks, and evaluations.

## Planned subfolders

- `tasks/` — Structured AI task implementations.
- `routing/` — Model/provider selection, budgets, and fallbacks.
- `prompts/` — Versioned prompts and tool policies.
- `schemas/` — Strict structured-output definitions.
- `safety/` — Grounding, PII, injection, and unsupported-claim checks.
- `evals/` — Online/offline quality evaluation runners.
- `tests/` — Provider, schema, failure, and adversarial tests.

AI output is a proposal. Domain services validate and authorize any persisted fact or external side effect. AI workers provide no coaching, interview preparation, or post-submission hiring analysis.
