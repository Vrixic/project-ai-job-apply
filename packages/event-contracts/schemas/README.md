# Event Schemas

Versioned JSON Schemas for identifier-only asynchronous payloads. Candidate preference, resume,
answer, token, and other unrestricted values are prohibited.

`platform.outbox.nudge.v1` is an internal SQS transport message, not a domain event. It contains
only the immutable outbox identity, event type, optional trace context, and a deterministic
integrity digest; consumers reload authoritative event data from PostgreSQL.
