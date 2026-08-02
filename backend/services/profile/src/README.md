# Profile Service Source

Implements provider-neutral identity resolution, job-preference ownership, idempotent writes,
transactional outbox publication, operations, audit records, and readiness-result persistence.
The serverless outbox extension keeps post-commit SQS failure separate from the user transaction,
claims bounded recovery pages with `FOR UPDATE SKIP LOCKED`, and never places preference values in
transport messages.

Readiness state changes verify the operation and preference set belong to the same internal user,
allow safe replay, and preserve a succeeded terminal result against late retry, failure, or stopped
execution signals.
