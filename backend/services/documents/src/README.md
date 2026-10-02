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
No runtime handler, IAM enforcement or provider/drain port is composed here.
