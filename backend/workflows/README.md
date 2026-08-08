# Durable Workflows

This directory contains durable workflow definitions for multi-step processes that must survive crashes, deploys, provider outages, and long user waits.

## Planned subfolders

- `applications/` — Prepare, inspect, review, approve, submit, and confirm.
- `job-ingestion/` — Normalize, deduplicate, verify, publish, and expire.
- `documents/` — Parse, tailor, validate, render, and verify.
- `notifications/` — Schedule, route, retry, and reconcile delivery.
- `integrations/` — OAuth sync, cursors, webhook reconciliation, and disconnect.
- `privacy/` — Export, revoke, delete, and subprocessor propagation.
- `billing/` — Webhook handling, reconciliation, and entitlement recovery.
- `tests/` — Replay, timeout, cancellation, compensation, and idempotency tests.

Workflow code orchestrates deterministic state transitions; external I/O belongs in retryable activities/workers.

## Phase 0 implementation

The first workflow calculates profile readiness after an idempotent preference update. Its
deployed Lambda durable implementation uses an immutable definition version, exact numeric
function targets, identifier-only inputs, named bounded retries, and a private activity Lambda for
PostgreSQL access. SQS nudges plus bounded reconciliation recover the transaction-to-dispatch gap.

Local development uses `src/local-runtime.ts`, a development-only adapter around the same outbox,
durable definition, and activity contracts. It does not add another production workflow engine or
require a local cloud service.

The profile-readiness workflow has no human-review callback or reversible external effect. Callback
success/expiry is therefore tested with a conformance-only fixture; production callback handling
will be added only with an application final-review workflow.
