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
