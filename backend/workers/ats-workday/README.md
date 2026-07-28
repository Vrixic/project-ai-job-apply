# Workday ATS Worker

Implements Workday tenant-, account-, and widget-aware application behavior. Workday is isolated because its multi-step flows, session requirements, and resume parsing are materially different from simpler ATS platforms.

## Planned subfolders

- `detection/` — Tenant, career site, route, and state detection.
- `accounts/` — Account/session and user-takeover coordination.
- `forms/` — Workday component and field mappings.
- `resume-import/` — Detection and correction of parser-overwritten fields.
- `actions/` — Fill, validate, submit, and confirm operations.
- `fixtures/` — Sanitized tenant/variant fixtures.
- `telemetry/` — Variant-specific quality and failure metrics.
- `tests/` — Session, widget, resume, takeover, and regression tests.

Unsupported variants fall back to active-tab assistance or manual completion rather than risky generic automation.
