# Documents Source

The API/persistence surface contains only candidate-owned metadata and opaque object references.
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
final-document enforcement, retention and production drain composition remain unfinished.

The final-document S3 transport now checks single-attempt SDK policy before each PUT and returns
`created: true` only after an original one-attempt HTTP 200 receipt and pinned metadata verification.
Conditional conflicts return `created: false`; missing/ambiguous receipts never recover through
HEAD. Inputs are detached before asynchronous I/O, versions cannot be null/unsafe, and reads verify
both HEAD and GET versions plus bounded bytes/digest. Local deadlines bound stalled policy, I/O
and streams; late GET bodies are disposed without reading. Abort is not remote-quiescence proof.
The PostgreSQL completion path does not yet consume this receipt or enforce a final-document claim.
These offline transport controls are a prerequisite, not completed final-writer or deployed evidence.
