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
per-event dispatch target and crash-safe nudge/start metadata. Migration
`0003_retire_legacy_dispatch` fails closed if any unpublished legacy work remains, relabels only
already-published historical rows, and makes `lambda_durable` the default for new work.

Readiness operation transitions are replay-safe: duplicate running/completion/failure calls cannot
downgrade a succeeded operation or emit a second completion event. The durable terminal reconciler
maps only an exact recorded execution name back to its owned operation.

## Phase 1 implementation

Profile facts now have stable candidate-owned identities and append-only PostgreSQL versions.
Direct user entry is explicitly confirmed and source-labeled by the server; correction and
rejection require the expected version, are idempotent, and never overwrite prior values. Reads
return only the authenticated candidate's latest versions, and audit metadata excludes fact
values. Resume binaries, parsing, supporting spans, and proposed-fact confirmation remain the
next D1-002 slice and must not be added to events or logs.

## Phase 2 default-dark implementation

Profile owns immutable `ugc_contribution` consent grants for the extension plus append-only
revocation and supersession records. The narrow creator/verifier interfaces bind an authenticated
owner to the exact document version, policy version, final preview SHA-256, grant/expiry time, and
current lineage. Creation is idempotent and audited without payload values. Verification rejects
owner/hash/version mismatches, expired or non-current grants, quarantined owners, malformed input,
and persistence failures. Gateway wiring and contribution activation remain default-off.
Grant and revoke receipts intentionally exclude server-selected timestamps from their request
hashes, so an ambiguous retry with the same semantic input returns the original immutable server
time. Audit metadata contains only fixed purpose/client and version identifiers; it never contains
the preview digest or selected posting content.
