# Event Schemas

Versioned JSON Schemas for identifier-only asynchronous payloads. Candidate preference, resume,
answer, token, and other unrestricted values are prohibited.

`document.scan-result.v1.json` is produced from GuardDuty events by an EventBridge input
transformer. It excludes threat names, filenames, user IDs, hashes, bytes, and extracted content.

`platform.outbox.nudge.v1` is an internal SQS transport message, not a domain event. It contains
only the immutable outbox identity, event type, optional trace context, and a deterministic
integrity digest; consumers reload authoritative event data from PostgreSQL.

`job.contributed.v1` carries only the queued contribution UUIDv7. It intentionally excludes the
owner, public posting fields, URLs, source metadata, and consent references.

`job.normalized.v1`, `job.verified.v1`, and `job.expired.v1` carry only immutable workflow,
canonical-job, source, verification, and status-event UUIDv7 references. They intentionally exclude
posting content, source URLs, contributor identity, trust evidence, and lifecycle reasons.

`trust.contribution-decision.changed.v1` carries only the stable Trust transition UUID and the
Jobs-owned contribution UUID. It excludes contributor and reviewer identities, decision status,
reason/evidence, source URL, and contribution content. Consumers reload exact authoritative truth.

`application.status_changed.v1` and `application.applied.v1` are emitted by the Applications
outbox in the same transaction as the lifecycle change. They carry only the application and owner
UUIDs, the revision, and the resulting status. They exclude packet fields, hashes, artifacts,
attempt evidence, confirmation URLs or bodies, and any post-submission hiring outcome; consumers
(for example the future Notifications inbox) reload owner-scoped truth through the Applications API.
