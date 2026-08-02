# Profile Service

Owns the reusable candidate truth profile: verified facts, job preferences, answer-vault entries, consent references, and fact provenance.

## Planned subfolders

- `domain/` — Profile entities, policies, and invariants.
- `application/` — Import, confirmation, correction, and preference use cases.
- `persistence/` — Profile-owned repositories and migrations.
- `api/` — Service endpoints and event handlers.
- `events/` — Profile fact and preference events.
- `tests/` — Parsing confirmation, authorization, and invariant tests.

Generated job-specific artifacts belong to the documents service. Protected-class data is isolated and never exposed to matching.

## Phase 0 implementation

The initial PostgreSQL module owns provider-neutral identities, job preferences, operations,
idempotency keys, audit events, and an identifier-only transactional outbox. Its SQL migration is
kept explicit alongside Drizzle types. Forward migration `0002_serverless_outbox` adds an immutable
per-event dispatch target and crash-safe nudge/start metadata while preserving Temporal as the
default route until a separately reviewed cutover.
