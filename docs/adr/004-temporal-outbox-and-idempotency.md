# ADR-004: Temporal, Outbox, and Idempotency

Status: Accepted
Date: 2026-07-28

## Decision

Use Temporal for long-running workflows and a transactional outbox for state-to-event publication.
Every externally visible command has a scoped idempotency identity. The preference slice commits
state, operation, event, audit record, and replay response atomically. Temporal workflow IDs derive
from immutable event IDs.

## Consequences

Crashes may repeat safe work but cannot silently lose state or create a second workflow. Ambiguous
irreversible external actions are never blindly retried.
