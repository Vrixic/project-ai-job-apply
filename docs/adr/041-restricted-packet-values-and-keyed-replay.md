# ADR-041: Restricted packet values and keyed replay

Status: Proposed; private source implementation in progress, release/accountable review pending
Date: 2026-10-05

## Context

ADR-010 and architecture 12.3 require a separate restricted-data storage/key boundary. The vault
protects saved values, but selecting one into an Applications packet currently copies the value
into ordinary packet JSON. Direct restricted entries take the same path. Packet and command
request hashes also include low-entropy plaintext; merely encrypting SQL values would leave an
answer-enumeration oracle. Existing approvals and ambiguous submission evidence must remain exact.
ADR-038 continues to prohibit durable generated document content, including encrypted content.

## Proposed decision

Applications owns immutable restricted packet snapshots in a separate restricted schema, backed
by a distinct exact encryption-key authority. Protect every nonnull restricted field and selected
vault value. Store only value-free field metadata plus an opaque protected marker in ordinary
packet JSON. An immutable reference binds the original protection identity, value-free metadata
and randomized authenticated ciphertext identity. Never replace the stored packet with a hydrated
plaintext packet during approval, admission or hashing.

Preserve existing packet.v1 hashes when no protected record is present. A packet.v2 commitment
binds the original protected record and null metadata values. It still binds every other packet
input and requires explicit acknowledgement of protected fields. Restricted reads return values
separately, for immediate owner/adapter projection only. The owning reader independently verifies
active ownership and the exact snapshot after decrypt awaits. Approval and dispatch operate on
metadata and existing current-reference admission; they never invoke decryption under SQL locks.

Use fresh local AES-256-GCM envelopes with KMS-wrapped data keys and exact owner/application/
protection/value-free metadata context. Persist no plaintext request digest. Create-packet and
preparation replay require a distinct KMS HMAC authority before SQL locks; retain the exact
original algorithm/key authority for supported historical receipts. Unsupported keys or missing
capabilities fail unavailable rather than changing historical replay or approval semantics.
The current prototype pins one exact encryption/MAC key pair; historical-key composition and
rotation acceptance remain unfinished.

Encrypt a detached classified command before SQL admission. Synchronous binding checks the exact
owning prepare result against the same original fields/context before metadata and ciphertext are
committed atomically. Any temporary plaintext digest used solely for this local comparison stays
in ephemeral private memory, never a serializable result, packet, receipt, event, SQL or export.
Preparation completion carries exact original protected metadata without decrypting in the
transaction, renewing vault references or changing restricted answers.

Authorized candidate export must return exact chosen historical values through a private reader
and remove all internal markers/bindings before strict public export validation. Deletion must
remove encrypted snapshots through existing privacy authority after packet references and writer
checks permit it. Logical restore must preserve exact original authority and reject insufficient
migration/boundary evidence. Do not silently backfill, purge or rehash legacy approved/ambiguous
packets or receipts. An explicit compatible transition and legacy-data evidence are required
before activation.

## Current evidence and remaining gates

Private envelope crypto, strict metadata codec, synchronous binding, packet.v2 commitment, keyed
receipts, atomic restricted persistence, candidate-review JIT reads, identifier-only read audit and
preparation carry-forward, exact authorized historical export and privacy-authorized deletion have
local synthetic/offline unit and real PostgreSQL evidence. Profile owns export request/operation
admission through a narrow transaction callback; historical readers release SQL locks before crypto
and recheck exact authority afterward. Workflow assembly copies only authorized declared field
values into the strict portable envelope; private inventory/bindings remain outside artifacts.
Actual Profile metadata admission now verifies selected-answer correction/deletion/expiry read
races in real SQL, while historical export retains exact original chosen values. The expanded
65-migration/88-relation/12-schema boundary passes an actual PostgreSQL logical restore with exact
full-row equality, original values/keyed replay, private metadata-role read refusal and authorized
deletion. The deletion verifier includes both private relations and its actual SQL replay cases
seed restricted snapshots/audit. Maintained Applications/Gateway/Workflow fixtures pass with
explicit offline protection. Actual native preparation now carries original protected metadata
without cipher authority; emitted native/provider isolation checks pass. Legacy transition,
production role/key composition, broader artifact checks and complete verification remain unfinished. No
production data, live KMS/provider, deployment or activation is claimed. Saved-answer reuse remains
disabled. See [D3-077 evidence](../product/delivery/evidence/d3-restricted-packet-storage-2026-10-05.md).

This proposal refines the technical implementation of ADR-010. It does not supply legal/privacy,
security, retention, least-privilege/IAM/key, client final-review or enabled-ATS acceptance.
