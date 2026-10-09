# ADR-043: Protected legacy application receipts

Status: Proposed; protection component implemented locally, atomic transition/runtime work pending
Date: 2026-10-08

## Context

The managed development inventory records seven historical `create_packet` receipts, seven packets
and one packet with approval. Applications has three applied migrations. The immutable `0009`
guard refuses those receipts. Zero counted restricted values does not establish complete packet
compatibility. [Inventory evidence](../product/delivery/evidence/d3-native-application-disposal-2026-10-07.md#managed-legacy-inventory-from-revision-63).

Deleting receipts permits duplicate effects; changing their request identity changes historical
replay. Leaving unkeyed digests alongside low-entropy request inputs defeats ADR-041's restricted
boundary. Original packet/approval/attempt evidence must remain exact.

## Proposed decision

Applications retains each original receipt's metadata and original SHA-256 request digest, with
the digest encrypted under an explicitly admitted restricted-data key. An opaque protection ID,
owner, application, original operation and value-free original metadata commitment bind the
ciphertext. Do not include the original request digest or candidate values in that commitment,
KMS encryption context, logs, events or ordinary row metadata. Never relabel an old digest as a
new HMAC. New commands continue to use the existing keyed receipt scheme.

The private cipher encrypts exactly 64 ASCII digest bytes with symmetric KMS Encrypt and the
distinct `restricted-legacy-application-receipt.v1` purpose. Replay-only composition cannot encrypt.
The read returns only match/no-match after comparing a caller's ephemeral canonical digest with
the decrypted original. Unknown keys, invalid ciphertext, unavailable KMS or withdrawn authority
fail unavailable, never become a missing receipt. Pending SDK calls retain admission after abort
until settlement. SDK plaintext buffers are cleared; JavaScript input strings cannot be zeroized.
No public package export or production composition is added by this first component.

The proposed atomic transition must:

1. Use a separately reviewed, explicitly enabled maintenance operation with applications drained,
   exact original row/schema inventory and recoverable backups. Refuse unsupported field shapes,
   restricted plaintext, incomplete inventory or unexpected receipts. Counts alone are insufficient.
2. Prepare and round-trip-check encryption outside SQL locks, retaining no plaintext intermediate
   artifacts. Reacquire owning locks and compare the exact original inventory before any mutation.
3. Move the original receipt metadata and encrypted digest into an Applications-owned restricted
   archive, apply the unchanged migrations and install archived-key collision protection in one
   transaction. Preserve every packet, approval, attempt, original response revision, outcome,
   subject and timestamp. Any failure restores the original rows and schema through rollback.
   Immutable migration bytes/checksums remain unchanged; explicit versioned transition SQL and
   forward migration/manifest integration are required before this operation exists.
4. Make `(owner, idempotency key)` unique across archived and new receipts. Every command path must
   detect an archived operation mismatch, and database enforcement must prevent a new command
   from occupying an archived key, including concurrent commands for different applications.
5. Authorize active ownership before decryption and recheck the exact archived binding and owner
   after the await. Perform no crypto under SQL locks. A matching retry uses the original outcome
   and existing replay semantics without new packets, approvals, revision increments or events.
6. Include the archive in authorized candidate deletion, logical restore equality, privacy replay,
   schema manifests and migration verification. Do not add internal digests to candidate exports.
   Retain original encryption authority for supported receipts and backup/recovery windows;
   rotation or rollback must not silently disable historical replay.

## Evidence and remaining work

The bounded cipher is source-only and default-off. Eighteen local tests use a simulated KMS
transport with real local authenticated encryption. They cover exact match/conflict, context and
ciphertext substitution, explicit historical keys, read-only/default-off behavior, malformed
inputs, error redaction, buffer clearing, deadline admission and authority withdrawal. This is
not live KMS, SQL transition, runtime replay or release approval evidence.

Versioned archive SQL, atomic transfer, all-command collision prevention, original request
canonicalization, replay/store/runtime wiring, deletion/export/restore integration and actual
PostgreSQL adversarial tests remain unfinished. Begin SQL acceptance from the actual three-ledger
legacy shape and retain one original approval; also prove queue-preparation receipts, cross-owner
isolation, concurrent key reuse, rollback, key withdrawal and complete restored row equality.
No live data transition or saved-answer reuse activation is authorized by this proposal.

## Alternatives

- Purging or resetting development data discards original evidence and does not solve compatibility.
- Rehashing receipts under the new scheme loses original request identity without original bodies.
- Keeping plain legacy request hashes exposes a low-entropy answer comparison oracle.
- Disabling the `0009` guard or altering its applied checksum weakens the existing migration boundary.
