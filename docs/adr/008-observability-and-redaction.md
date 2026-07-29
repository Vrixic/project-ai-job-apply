# ADR-008: Observability and Redaction

Status: Accepted
Date: 2026-07-28

## Decision

Propagate correlation/trace identifiers through request, database operation, event, and workflow.
Emit structured logs and OpenTelemetry signals with release and service identity. Redact
authorization, email, preferences, resume content, answers, and tokens at the shared logger.
Operational events use opaque IDs; raw values are prohibited.

## Consequences

Failures can be reconstructed without turning telemetry into a candidate-data store. Redaction
tests are release blocking.
