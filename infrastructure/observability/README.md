# Observability Infrastructure

Defines operational dashboards, alerts, SLOs, log/trace pipelines, and synthetic monitors as reviewed configuration.

## Planned subfolders

- `dashboards/` — API, workflow, ATS, AI, ingestion, billing, and security views.
- `alerts/` — Symptom-based alerts with ownership and runbook links.
- `slos/` — Service-level indicators, objectives, and error budgets.
- `synthetics/` — Safe end-to-end availability and freshness checks.
- `collectors/` — OpenTelemetry and log pipeline configuration.
- `tests/` — Rule validation and dashboard/config checks.

Alerting should identify user impact and avoid high-noise provider metrics without an actionable response.
