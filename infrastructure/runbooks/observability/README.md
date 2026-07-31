# Observability Runbooks

Contains reviewed procedures for dashboards, metrics, logs, traces, alert routing, and operational
signal exercises. Procedures use synthetic signals and retain only sanitized state, counts, and
timestamps.

## Current procedures

- [Development alert delivery](development-alert-delivery.md) — Provisions encrypted routing,
  privately subscribes an operator, and exercises ALARM → OK delivery with a dedicated synthetic
  metric.
- [Staging alert delivery](staging-alert-delivery.md) — Subscribes and exercises the already
  provisioned synthetic staging notification path without retaining the destination.
- [Development distributed tracing](development-distributed-tracing.md) — Continues privacy-safe
  W3C context through the deployed gateway, outbox, Temporal worker, and X-Ray.
- [Staging workload and initial cost acceptance](staging-workload-and-cost.md) — Runs a fixed
  session-safe synthetic foundation workload and corroborates only aggregate runtime/billing
  evidence.
- [Development provider and log recovery](../providers/development-provider-and-log-recovery.md) —
  Uses continuous privacy-safe heartbeats to detect and recover from a gateway log-delivery
  interruption.
