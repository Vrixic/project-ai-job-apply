# Observability

Provides consistent structured logging, metrics, traces, audit correlation, redaction, and context propagation.

## Planned subfolders

- `logging/` — Structured logger and sensitive-field redaction.
- `metrics/` — Naming, dimensions, and service-level indicators.
- `tracing/` — OpenTelemetry setup and context propagation.
- `correlation/` — Request, workflow, application, job, and release IDs.
- `audit/` — Audit-event construction interfaces.
- `testing/` — Capture and assertion utilities.

Logs and traces identify workflows and versions without recording resume text, tokens, or application-field values.
