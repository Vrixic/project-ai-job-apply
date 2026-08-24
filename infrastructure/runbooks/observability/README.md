# Observability Runbooks

- [Development D1 managed-OIDC workloads](development-d1-read-workload.md) — Runs the
  development-only fixed read and saved-job lifecycle profiles through the server-held managed-OIDC
  session and deployed API Gateway, then corroborates each exact window without retaining private
  values.

Contains reviewed procedures for dashboards, metrics, logs, traces, alert routing, and operational
signal exercises. Procedures use synthetic signals and retain only sanitized state, counts, and
timestamps.

## Current procedures

- [Development alert delivery](development-alert-delivery.md) — Privately subscribes an operator
  to the provisioned encrypted route and exercises ALARM → OK delivery with a synthetic metric.
- [Staging alert delivery](staging-alert-delivery.md) — Subscribes and exercises the already
  provisioned synthetic staging notification path without retaining the destination.
- [Serverless distributed tracing](serverless-distributed-tracing.md) — Verifies privacy-safe W3C
  correlation through API Gateway/Lambda, outbox/SQS, durable execution, and private activity.
- [Staging workload and initial cost acceptance](staging-workload-and-cost.md) — Runs a fixed
  session-safe synthetic foundation workload and corroborates only aggregate runtime/billing
  evidence.
- [Development Auth0 recovery](../providers/development-provider-and-log-recovery.md) — Proves fresh-login
  failure and exact application-connection restoration without weakening the runtime.
