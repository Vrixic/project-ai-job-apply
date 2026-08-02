# Workflow Source

Contains deterministic Temporal workflows, retryable profile-owned activities, and the
identifier-only transactional-outbox dispatcher. The worker composition root also starts and
stops the privacy-safe log-delivery heartbeat without putting timers inside workflow code.

`serverless-outbox.ts` contains the provider-independent SQS/reconciliation protocol;
`serverless-outbox-lambda.ts` is the thin AWS composition boundary. Duplicate and reordered nudges
use the immutable event ID as the durable execution identity, and partial-batch failures preserve
per-message retry/DLQ behavior.
