# Greenhouse ATS Worker

Implements and tests Greenhouse-specific job/form detection, inspection, field mapping, filling, validation, and confirmation behavior.

## Planned subfolders

- `detection/` — Provider, tenant, and page-state detection.
- `forms/` — Greenhouse question and widget mappings.
- `actions/` — Fill, validate, submit, and confirm operations.
- `fixtures/` — Sanitized permitted Greenhouse variants.
- `telemetry/` — Adapter-specific quality and failure metrics.
- `tests/` — Contract, fixture, canary, and regression tests.

Public Job Board API ingestion is separate from application execution; direct API submission requires employer authorization.

The current application implementation is being built in the owning active-tab client under
`frontend/extension/lib/greenhouse/`; no separate worker deployment is needed for that path.
Bounded structural inspection and ordinary field execution reuse the SDK and remain unreachable
from the extension UI while the complete approval/file/submission bridge is unfinished. No file
upload, submit click or provider confirmation is implemented by those primitives. The action
registry remains default off with no accepted application variants. Proposed ADR-049 records the
remaining identity, transport, one-shot dispatch and acceptance requirements; synthetic tests do
not establish provider fidelity or authorize employer effects.
