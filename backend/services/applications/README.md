# Applications Service

Owns application packets, field proposals, review requirements, approvals, attempts, confirmation evidence, audit history, and technical application history through confirmed submission.

## Planned subfolders

- `domain/` — Application state machine and invariants.
- `packets/` — Immutable packet assembly and hashing.
- `fields/` — Proposed values, evidence, confidence, and sensitivity.
- `approvals/` — User authorization and invalidation rules.
- `attempts/` — Submission attempts and confirmation reconciliation.
- `history/` — Saved, preparation, review, submission, failure, cancellation, and confirmation state.
- `api/` — Prepare, approve, cancel, and takeover commands.
- `tests/` — State, idempotency, duplicate-submit, and authorization tests.

External execution is delegated to workflows and workers; this service remains the durable source of truth. `applied` is terminal, and no recruiter/interview/offer result is stored.
