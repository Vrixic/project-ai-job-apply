# Documents Source

The API/persistence surface contains only candidate-owned metadata and opaque object references.

`cover-letter-read.ts` is the owner-approved source-only read separation. Context/binding/preview/
file behavior no longer requires the generation service or its model/mutation capabilities.
`PostgresCoverLetterReadStore` admits an active candidate before handing a fixed-owner reader to
the service; SQL lookup, exact pinned object read, context comparison and rendering use that same
lease. No nested Documents transaction or object-write port is needed. Public routes and schemas
are unchanged. Local single-connection quarantine races pass; deployed composition and broader
provider quiescence, retention and export acceptance remain separate gates.

The private provider-control RPC is source-only and default-off. Its strict version-one envelopes
carry document IDs, request hashes, original consent expiry and fixed-purpose references only.
The isolated client can claim existing provider work and acknowledge positive original provider
completion, not issue/renew work, select an owner or settle another phase. Both endpoints pin an
exact numeric Lambda version; the client enforces one SDK attempt and bounded strict receipts.
Positive settlement acknowledgements bind the original grant ID and request digest. Lost claim
ACKs cannot dispatch a model; lost settlement ACKs can recover the original already-settled result
without another model call. Local RPC timeout does not prove remote SQL/effects stopped.
The invoked-function ARN binds the target, not its caller: reviewed least-privilege IAM,
runtime composition and trusted failed-call settlement remain mandatory before deployment.
Current evidence: 574 Documents unit tests and 112 real PostgreSQL cases using synthetic model,
object and Lambda transport, including seven connected original-work pipeline cases.

`upload-signer.ts` is the sole direct-upload capability issuer. Processing code must verify the
managed malware tag and the declared checksum before parsing and must never log filenames, bytes,
text blocks, profile proposals, or storage credentials.

`cover-letter-work-store.ts` is a private default-off generation control ledger. Migration `0007`
records only request digests, owner/document IDs, fixed purposes and operational times/statuses.
Each purpose has one immutable authorization and one non-renewable server-timed claim window,
bounded to 90 seconds; model/private-slot admission also ends at original consent expiry.
Claimed work never becomes settled from elapsed time. Cancellation permanently fences missing and
unclaimed phases without treating running work as stopped. Final-document admission requires the
original provider phase settled; it can finalize the original result after consent expiry without
granting another model dispatch. Unresolved rows block cascaded deletion, and individual terminal
rows cannot be removed to reissue authority while their document exists.
Ledger settlement is not a production quiescence proof: every writer/provider must use the claims,
and a trusted actor must positively prove all original effects stopped before recording settlement.
No production runtime, IAM enforcement or drain authority is composed here.

`cover-letter-preparation.ts` connects private initialization to one original provider Invoke and
owned read-only recovery/finalization. Fixed-purpose issuance requires settled original slot work
and exact owner/request/consent binding under the parent lock. Only a fresh committed grant winner
may Invoke; already-issued, running, settled or cancelled grants permit recovery only. Lost control
or Invoke acknowledgements, local cancellation and kill-switch changes cannot renew authority or
settle unresolved work. Original result recovery remains available after consent expiry. Five
connected SQL cases use the real initializer, control store, isolated handler and final writer,
with offline model/object/Lambda transports and no seeded provider settlement. Authenticated private
RPC, IAM, runtime bootstrap, failed-call settlement and retention remain prerequisites for activation.

The private slot initializer now requires this ledger before any creation: only a fresh exact-bound
`private_slots` grant and its one committed claim can create request/result/dispatch, with dispatch
last. Only the original actor's three positively acknowledged and pinned writes can settle that
phase. Partial/conflicting/aborted/lost-acknowledgement paths and read-only replay never settle it.
The S3 transport requires an explicit single-attempt SDK policy and a one-attempt HTTP 200 receipt
before acknowledging any creation or conditional replacement. Real SDK offline tests verify one
HTTP PUT on a server error. These acknowledgements alone are not a production drain authority.
Tests use synthetic SQL/object data, not live S3/KMS/model
permissions or accountable privacy acceptance.

The isolated provider now requires a fixed-purpose control port before any dispatch replacement,
model call or result replacement. It can only claim a pre-issued `provider_dispatch` authorization
with the original request/consent binding and settle that phase; it cannot issue/renew authority,
choose a candidate owner or settle another phase. The Documents private control method resolves
the persisted owner and uses the existing atomic active-candidate/server-time claim. Only the
original positive dispatch/model/result path can settle. Read-only ready-result recovery, ambiguous
control/write responses and local timeout/late model completion never settle running work.
The isolated compiled handler imports no SQL runtime. The connected SQL tests use an in-process
control port and offline model/objects, not a deployed authenticated RPC. Remote control/IAM,
retention and production drain composition remain unfinished.

The final-document S3 transport now checks single-attempt SDK policy before each PUT and returns
`created: true` only after an original one-attempt HTTP 200 receipt and pinned metadata verification.
Conditional conflicts return `created: false`; missing/ambiguous receipts never recover through
HEAD. Inputs are detached before asynchronous I/O, versions cannot be null/unsafe, and reads verify
both HEAD and GET versions plus bounded bytes/digest. Local deadlines bound stalled policy, I/O
and streams; late GET bodies are disposed without reading. Abort is not remote-quiescence proof.
The PostgreSQL completion path now requires a private final-document control port for every new
write. Admission derives the original request/consent from its settled provider ledger row, never
from the caller, and consumes one fresh final grant. Completion uses a separate advisory lock before
independent control transactions to avoid a parent-row lock cycle. It snapshots inputs/references,
verifies exact pinned bytes and settles only an original positively acknowledged creation.
Read-only current-version recovery can complete metadata after a lost ACK or SQL rollback without
another PUT; it never settles running work, and a missing/deleted object cannot be recreated.
Missing/default-off control refuses writes. Existing ready metadata remains non-mutating.
The 94 connected Documents SQL cases and six preparation-workflow cases use synthetic objects/models
and in-process controls. Legacy offline-model fixtures explicitly seed synthetic provider settlement;
that fixture setup is not production permission or remote-stopped proof. Production control/RPC/IAM,
trusted failed-call settlement, retention, read/export/restore and drain composition remain open.
