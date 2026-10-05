# D3-077 restricted packet storage — started 2026-10-05

Status: In progress. Backend-only private WIP on isolated branch
`feat/d3-restricted-packet-storage`, started from `2b6f59aa` and now rebased onto merged #559/main
`18b6b2e2`. Local WIP checkpoints are not published or review-ready.
Hosted CI/CD remains deferred until production launch. No feature is activated or deployed.

## Confirmed gap and required end state

Applications `store.ts` writes `packet.fields` directly as ordinary JSON. `createPacket` and
preparation receipt preflight/queue also hash request bodies containing supplied answer values.
`packet.ts` hashes clear field values. Encrypting values alone would leave public/stored packet
and request hashes vulnerable to enumerating low-entropy answers. D3-076 must remain disabled.
ADR-010 and architecture 12.3 require separate restricted storage/keys and just-in-time access.

The intended complete path is candidate request → owning Applications policy/protection →
metadata-only packet and immutable encrypted value record → metadata approval/dispatch →
authorized immediate owner/adapter value read. Generated document material remains forbidden in
all durable value records, including encrypted ones (ADR-038). No inferred/hidden sensitive answer
or new public user flow is authorized by this work.

Completion must prove:

1. Restricted and selected vault values never enter ordinary packet/receipt/outbox/history JSON.
2. Value-free packet metadata binds randomized authenticated ciphertext; request replay uses a
   keyed fingerprint, with no persisted plaintext digest that enables answer enumeration.
3. Owner/application/original value identity and question/provenance/policy metadata are bound;
   malformed/moved/tampered envelopes and missing key/protection capabilities refuse.
4. KMS encryption/fingerprinting occurs before SQL locks, owner reads decrypt after releasing
   locks and revalidate ownership/current snapshot after the await. Approval and dispatch need no
   value decryption and preserve mandatory review, correction/expiry and duplicate safety.
5. Preparation retains exact protected values through original completion without decrypting
   inside transactions or renewing selected vault references. No plaintext fallback is accepted.
6. Authorized candidate export returns the exact chosen historical values through a narrow
   reader; deletion removes encrypted records only with existing privacy authority and writer
   checks. Real SQL, logical restore and migration/rollback compatibility must be tested.
7. Full maintained verification and private artifact isolation pass on clean committed source;
   release/IAM/key/retention/accountable and client/ATS gates remain distinct.

## Implemented prototype and focused evidence

Applications now declares a private type-only cipher port. A separate, uncomposed Gateway factory
implements envelope encryption (fresh AES-256 data key, AES-GCM/96-bit random IV/128-bit tag),
owner/application/protection-ID/value-free metadata context and a distinct KMS HMAC-SHA-256
request authority. Candidate value bytes are encrypted locally; KMS requests carry only data-key
context or an ephemeral request digest, never the candidate value body. Keys and MAC authority
are pinned to distinct exact ARNs in the same region/account. No alias/foreign key or configured
endpoint override is allowed. Both encryption and decryption clear controlled returned key bytes;
decryption withholds partial/late/refused plaintext. This is best-effort controlled-buffer cleanup,
not a claim of physical all-copy memory erasure.

The factory defaults off, is uncomposed, has one admitted original SDK promise and no retry.
Timeout/abort does not release admission while the original promise remains pending. Endpoint,
region, normal-client configuration and actually signed installed SDK serialization are exercised
with offline transports. Test client injection is restricted to NODE_ENV=test.

Thirty focused tests pass: randomized exact-byte round trip, moved context, tampering, strict
getter/hidden/symbol/size refusal, key-response validation/cleanup, keyed request identity,
late SDK timeout/admission, flag/environment changes, actual default client configuration and
signed offline SDK success/failure with one attempt. Applications build and Gateway typecheck
pass after the prototype; scoped lint has zero diagnostics. Logs are ignored under
`.tmp/d3-restricted-packet-cipher-unit.log` and `.tmp/d3-restricted-packet-typecheck.log`.
No SQL, migration, export integration, complete repository verifier, browser or live KMS evidence
is claimed yet. Docker/WSL were not started. Existing packet persistence remains unchanged until
the full storage wiring lands; this prototype does not close D3-077 or enable saved-answer reuse.

## Owning metadata codec — source-only checkpoint

The private Applications codec now masks restricted and selected vault values with null plus a
private protected marker. It returns immediate decoded values in a separate map rather than
hydrating a metadata-only packet used for approval. Its value-free commitment binds exact
owner/application/protection identity, job/form, provenance, selected vault revision/context and
field policy. Ciphertext identity covers every randomized envelope component. Definition
configuration and command context are captured before awaits.

The codec rejects extra, hidden, symbol and accessor properties before cloning; validates exact
field, form, provenance, confidence and envelope shapes; and refuses document material even when
misclassified as restricted. Reads require exact canonical JSON, preventing duplicate keys or
noncanonical representations from being silently normalized. Malformed UTF-8, mismatched value
types/field sets, changed metadata/policy and disabling during a decrypt await all withhold values.
Controlled encoded/decrypted byte buffers are cleared on success and refusal; immutable strings
and engine copies cannot be physically erased by this mechanism.

Local checkpoint: all 268 Applications unit tests across 18 files pass, including the new codec
cases using real offline AES-GCM; Applications typecheck passes. All 30 Gateway cipher tests also
pass again. Biome checks on all six changed TypeScript files have zero diagnostics. Logs are
`.tmp/d3-restricted-packet-applications-unit.log`, `.tmp/d3-restricted-packet-codec-typecheck.log`
and `.tmp/d3-restricted-packet-cipher-unit.log`. These are source unit checks on the uncommitted
isolated branch, with synthetic inputs and offline crypto/provider transports. No database,
production build, complete verifier, live KMS, deployment or UI evidence is claimed. The codec
is private and uncomposed; existing packet persistence has not changed.

## Packet commitment and immediate public projection — source-only checkpoint

Private packet metadata now supports an exact immutable restricted snapshot identity and a
protected marker. `application-packet.v2` binds those identities and the masked field metadata.
The old published v1 hash remains byte-for-byte unchanged when protection is absent, verified
against the compiled original fixture. Hash verification and approval refuse plaintext in a
protected field, missing/extra/malformed binding, auto/unreviewed/direct-action markers and
protected document fields. Opaque protected fields still require explicit acknowledgement;
empty direct candidate actions remain unresolved.

The owning codec has a synchronous bind step with no cipher calls. Ephemeral WeakMap proofs
admit only the exact prepared result for the exact classified fields, including answer values,
and original context. These comparison digests are never serializable/persisted/public. Changed,
moved or cloned results and changed candidate inputs refuse. Bound metadata is detached/frozen;
later mutation of the prepared record cannot alter a bound packet.

Public projection accepts a separate exact owner/application/packet/hash value map and emits the
existing strict API shape with chosen values, omitting internal storage markers and bindings.
Missing/foreign/incomplete/unsafe read results fail unavailable rather than silently displaying
null. The owning asynchronous authorized reader remains unwired; this mapper supplies no access
authority or active-candidate lease.

All 304 Applications unit tests across 19 files pass after these changes. Applications typecheck
and production TypeScript build pass, Gateway typecheck passes against that build, and ten-file
Biome checks have zero diagnostics. These are local uncommitted source checks with synthetic
inputs; SQL, complete verifier, UI/browser, live KMS and deployed acceptance remain absent.
Logs: `.tmp/d3-restricted-packet-applications-unit.log`,
`.tmp/d3-restricted-packet-codec-typecheck.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-typecheck.log`. [ADR-041](../../../adr/041-restricted-packet-values-and-keyed-replay.md)
records the proposed full storage/replay boundary, explicitly distinct from accepted product
policy and from still-unfinished persistence/key/rotation/export/deletion/restore wiring.

## First real PostgreSQL write boundary — unfinished slice

Applications source now requires enabled restricted protection and exact MAC authority for packet
creation and preparation request replay/queue. Owner/active-candidate reads complete before KMS;
request digests exist only as ephemeral MAC inputs. Original receipt algorithm/key authority is
stored and checked; unsupported historical authority refuses without a new MAC or fallback.
An existing exact receipt replays without another envelope encryption. Packet fields are classified
and encrypted before the write transaction, then exact owning binding and ciphertext/metadata/
receipt/history/outbox writes occur atomically. The owning configuration is uncomposed/default-off;
old callers without it now fail unavailable for these commands. Service composition/error mapping,
authorized reads and fixtures require updates before review.

Forward migration `0009_restricted_packet_values` adds a separate `applications_restricted` schema,
immutable encrypted snapshots, exact owner/application/digest packet foreign references, mandatory
masked restricted fields, keyed packet/preparation receipt authority, an active-candidate insert
lease and privacy-authorized snapshot deletion after packets. It refuses legacy restricted
plaintext/unmodelled packet fields and existing unkeyed packet/preparation receipts before changing
them. This is an explicit incompatible legacy-data transition gate, not a backfill or permission
to purge historical evidence. The latest existing preparation deletion order/privacy checks are
retained. Structural registration verifies the extra relation, guards, validated constraints and
restricted deletion body. Export enrichment, role grants/owner inventory, full migration/restore
boundary expectations and full integration fixture compatibility remain unfinished.

Eight real PostgreSQL 16.6 tests pass in an owned tmpfs fixture: first migration and exact replay,
masked ciphertext/metadata/keyed receipt/event commit and exact replay without encryption,
ordinary v1 metadata with a keyed request receipt, direct restricted plaintext refusal, concurrent
identity/application `FOR UPDATE NOWAIT` during encryption, rollback of ciphertext and packet on
metadata insertion failure, concurrent duplicate retention of one record, stale revision refusal
and unsupported historical MAC authority refusal without issuing a new MAC. The suite uses
synthetic candidates and an offline AES-GCM/HMAC port; wrapped-key/provider behavior is simulated.
This does not prove production KMS/IAM, live reads, submission, export/deletion or restore.

Applications typecheck/build pass; 307 local unit tests include three unavailable-configuration
cases proving no SQL/crypto effects. Logs: `.tmp/d3-restricted-packet-sql.log`,
`.tmp/d3-restricted-packet-store-typecheck.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-applications-unit.log`. The owned fixture
`2dd730bdf180db2d12765354b2a8c1dc2f26908ccf926c01a076db23d87ded10` was identity/label/tmpfs-validated
and removed; shared Docker volume inventory stayed identical. Docker Desktop stopped successfully
and WSL reports no running distributions. PR #559 merged as main `18b6b2e2`; main's complete tree
matches its verified head. This SQL checkpoint used the isolated restricted branch before ancestry
reconciliation; it is not evidence for the combined full restore boundary.

## Ancestry reconciliation

Local WIP `d084d74a` was rebased onto exact-tree merged #559/main `18b6b2e2`, producing
`50a6c8ce`. Only the two appended delivery-log conflicts needed resolution; both histories were
preserved. Git confirms the SQL-tested migration/store/driver/integration/packet/codec source is
unchanged through rebase. The combined branch now includes the reviewed native registry boundary,
so whole-boundary restore counts/inventory must include both additions. No authored PR is open;
this incomplete restricted slice has not been pushed or submitted for review. Full clean verifier
remains a requirement after the complete feature and compatible maintained fixtures are ready.

## Candidate-review reads and original preparation carry-forward

The owning read accepts an exact owner/application/packet/hash/revision. It admits the active
candidate and exact current packet/vault references in a short transaction, reads the original
immutable envelope and records identifier-only audit admission, commits, then decrypts. A fresh
transaction independently rechecks active ownership, revision/current packet, exact snapshot and
current vault versions/expiry before audit validation. Controlled returned maps are cleared on
refusal. This is point-in-time authorization, not a client response lease. Admission/validation
stages do not claim the caller displayed or submitted a value.

The same unshipped 0009 migration now includes a second private relation, `packet_read_audit`,
with exact owner/application/packet FK, append-only/active-candidate/privacy deletion guards and
closed purpose/stage labels. Its entries contain identifiers, fixed labels and timestamps only;
no answers, request/MAC hashes, encryption keys or provider/error bodies. Deletion removes audits
before packets and ciphertext after packets. New structural verification checks both relations and
six owning triggers; the combined future full boundary requires both private relations in inventory.
This migration remains unshipped WIP, so its changing checksum is not a production migration edit.

Service responses use the optional exact owning reader when protected fields exist; search reads
are sequential to respect bounded crypto admission. Projections retain existing strict public API
shapes, clear controlled source maps after copying immediate values and fail unavailable for absent
or mismatched reads. Gateway exposes an optional private protection configuration (absent by
default), wires the owning reader and maps store protection failures to stable value-free 503
problems. No keys/IAM/configuration/feature activation is supplied by this optional composition.

Preparation completion omits masked proposals from reclassification and synchronously restores
only the exact admitted original base fields/reference. It preserves review/provenance/policy and
ciphertext identity, performs no decrypt/re-encrypt, and refuses moved context, overlapping/new
restricted values, non-advancing versions or modified original metadata. Current base identity is
independently checked under the actual owning transaction; no renewed vault authority is inferred.

All 14 PostgreSQL 16.6 cases pass with synthetic candidates and offline crypto. Six added cases
exercise exact separate values/audit/strict owner API, identity/application lock availability during
decryption, cancellation/quarantine races, foreign owner refusal before decrypt and exact protected
preparation completion with one encrypted record and no cipher calls during completion. These
checks do not prove Profile-backed correction/expiry races, historical export, deletion/restore,
actual managed OIDC/KMS/provider, client final review or production deployment.

All 314 Applications unit tests pass, including seven new carry invariants and unavailable-reader
no-effect checks. Applications typecheck/build and Gateway typecheck pass; the focused HTTP problem
mapping case passes (one selected, 99 unrelated skips), using test authentication/fake API failures.
Logs: `.tmp/d3-restricted-packet-read-sql.log`, `.tmp/d3-restricted-packet-read-typecheck.log`,
`.tmp/d3-restricted-packet-applications-unit.log`, `.tmp/d3-restricted-packet-applications-build.log`,
`.tmp/d3-restricted-packet-typecheck.log`, `.tmp/d3-restricted-packet-http.log`.
The owned tmpfs fixture `eee854cf32bf6903eb68ae963887b1b5dd8d79b811fbc3f8b8598416e59fb5fb` was
identity/label/tmpfs-validated and removed. Shared Docker volumes stayed identical; Docker Desktop
stopped and WSL reports no running distributions. No UI/browser or complete-verifier claim is made.

## Next work

Finish Profile-backed selected-answer correction/expiry read acceptance, exact historical export
enrichment, inventory/role/restore boundary registration, legacy migration compatibility and full
export/deletion/restore acceptance. Update all maintained integration/runtime fixtures for mandatory
protection and complete the clean full verifier before review. Existing legacy restricted plaintext must be handled by an explicit
reviewed transition; do not silently rewrite approved/ambiguous submission evidence. Retain exact
key authority for supported historical records; key rotation must never silently change replay
or approval semantics. Complete the whole storage path before requesting review of this slice.
