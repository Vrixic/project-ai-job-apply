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
