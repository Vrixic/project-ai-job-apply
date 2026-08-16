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

## D1 synthetic ingestion source packet

`ingestion-durable.ts` and `ingestion-lambda.ts` provide an identifier-only durable orchestrator,
database activity, disabled schedule coordinator, SQS starter, and terminal recovery handler. The
workflow loads Jobs-owned state on every activity boundary; its persisted workflow input contains
only a dispatch UUID, schedule-derived execution digest, definition version, and bounded recovery
generation. Activity and terminal results expose only fixed statuses and aggregate counts.
The generated-synthetic configuration digest binds exact source ID `synthetic-foundation-v1`,
adapter version `synthetic-ingestion-v1`, provider,
provenance, observation bound, and synthetic seed; it contains no candidate or provider payload.
The activity binds its Lambda invocation context to the dispatch's persisted numeric version. The
terminal handler accepts the official EventBridge envelope for any retained numeric version of the
exact ingestion function, then binds account, Region, timestamps, function version, durable name,
opaque execution ID, and stored dispatch before it may create a current-version recovery.

The production artifact and Terraform composition are source-ready but dark by default. Deployment,
environment-wide runtime activation authority, ingestion mapping/schedule activation, and the
`synthetic-foundation-v1` source gate are explicit ordered gates. This packet publishes or enables
none of them and contains no real-provider adapter, credential, network client, real data, or
provider-specific schedule.
