# Profile Service Source

Implements provider-neutral identity resolution, job-preference ownership, idempotent writes,
transactional outbox publication, operations, audit records, and readiness-result persistence.
The serverless outbox extension keeps post-commit SQS failure separate from the user transaction,
claims bounded recovery pages with `FOR UPDATE SKIP LOCKED`, and never places preference values in
transport messages.
