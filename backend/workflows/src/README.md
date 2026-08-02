# Workflow Source

Contains deterministic Temporal workflows, retryable profile-owned activities, and the
identifier-only transactional-outbox dispatcher. The worker composition root also starts and
stops the privacy-safe log-delivery heartbeat without putting timers inside workflow code.

`serverless-outbox.ts` contains the provider-independent SQS/reconciliation protocol;
`serverless-outbox-lambda.ts` is the thin AWS composition boundary. Duplicate and reordered nudges
use the immutable event ID as the durable execution identity, and partial-batch failures preserve
per-message retry/DLQ behavior.

`profile-readiness-durable.ts` is the version-one Lambda durable orchestrator. It validates the
authoritative identifier-only input and invokes an exact numeric version of the private activity
function through named, bounded, deterministic retry blocks. `profile-readiness-lambda.ts` owns the
database activity and durable terminal-event handlers; STOPPED, FAILED, and TIMED_OUT executions
are reconciled idempotently into PostgreSQL. No product callback is exposed by this Phase 0 flow.
