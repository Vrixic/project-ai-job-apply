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

The current application implementation lives in the owning active-tab client under
[frontend/extension/lib/greenhouse/](../../../frontend/extension/lib/greenhouse/); no separate worker
deployment is needed for that path. The connected source implements approved native file transfer,
registry-gated field/file execution, one-shot submission and attempt-bound confirmation/result/history
integration. Its locally verified synthetic scope is recorded in the
[D3-101 bridge evidence](../../../docs/product/delivery/evidence/d3-greenhouse-bridge-implementation-2026-10-10.md).

Production profiles remain empty and the registry stays default off with no accepted application
variants. The connected installed-extension/native/provider journey, live delegated grants,
authorized provider fixtures, exact-variant QA/live-effect approval and real submission/confirmed
history acceptance remain unverified. Proposed ADR-049 records the boundaries; synthetic tests do
not establish provider fidelity or authorize employer effects.
