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

## Restricted answer reuse reads

The internal `readActiveValue` port returns only the exact owner's latest active field/context
snapshot before database wall-clock expiry. KMS decryption holds no SQL lock; a second read
withholds the value if its version, state or expiry changed while decryption was pending.
Both reads require an active Identity owner, so account quarantine withholds ordinary reuse
before privacy cleanup removes the retained vault rows, including quarantine during decryption.
Owner, field and context are detached before asynchronous work. This is a point-in-time read,
not packet approval or an active-candidate lease; an eventual Applications consumer must preserve
those separate controls and mandatory review. No public route exposes this plaintext port.
The separate candidate-export reader intentionally permits expired saved values for portability.
It pins the original entry ID, version, field and context before awaiting SQL or KMS. Caller
mutation cannot retarget decryption or the post-decrypt correction/deletion check to a neighbour.
It remains a point-in-time export snapshot, without a SQL lock across KMS or packet approval.

The private `RestrictedAnswerReuseReader` port adds two exact-selection reads for Applications:
`readSelectedValue(owner, {id, version, fieldKey, context})` never substitutes a newer revision,
and `readCurrentReference` checks that same latest active revision without KMS or ciphertext.
Both detach caller input and require an active owner and database wall-clock expiry. Metadata
receipts include `validUntilEpochMs` (null means no recorded expiry), so a future admission guard
can recheck the immutable deadline after waiting for its own lock. Same-value corrections still
invalidate an old selection. The existing unselected read and portable export retain their shapes.
This is a locally verified owner boundary, not connected packet reuse, semantic question mapping,
mandatory candidate review or approval invalidation. No public plaintext route is added.

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

Fact corrections lock the candidate-owned stable parent in a separate SQL statement before
reading the latest append-only version. Competing idempotency keys therefore see a fresh version
after waiting and return the existing version-conflict error, not a duplicate-key database error.
The lock, version insert, idempotency receipt and value-free audit remain one transaction.

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
Candidate export includes an allowlisted owner-scoped consent history without preview digests,
internal lineage identifiers, or command receipts. Candidate deletion removes that history only
inside the existing privacy-authorized transaction; normal mutation remains fail-closed.
