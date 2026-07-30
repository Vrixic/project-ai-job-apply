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

## Phase 0 implementation

The Terraform platform module owns the KMS-encrypted application log group, aggregate error metric,
RDS/SQS/application/canary alarms, encrypted SNS routing, and the synthetic-safe operational
dashboard. The [development alert-delivery runbook](../runbooks/observability/development-alert-delivery.md)
proves notification state transitions without manufacturing a database, queue, or application
incident.

The local OpenTelemetry collector is development preparation only. A deployed trace pipeline is a
separate Phase 0 evidence step and must not be inferred from the dashboard or structured logs.
