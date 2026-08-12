# Event Schemas

Versioned JSON Schemas for identifier-only asynchronous payloads. Candidate preference, resume,
answer, token, and other unrestricted values are prohibited.

`document.scan-result.v1.json` is produced from GuardDuty events by an EventBridge input
transformer. It excludes threat names, filenames, user IDs, hashes, bytes, and extracted content.

`platform.outbox.nudge.v1` is an internal SQS transport message, not a domain event. It contains
only the immutable outbox identity, event type, optional trace context, and a deterministic
integrity digest; consumers reload authoritative event data from PostgreSQL.
