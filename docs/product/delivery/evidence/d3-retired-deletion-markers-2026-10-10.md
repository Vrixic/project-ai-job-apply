# D3 retained deletion markers — 2026-10-10

The original managed read-only inspection on the restored development primary refused at
`marker_snapshot`, before SQL opened; that executor never attempted replay. Protected diagnostic evidence identifies
standard S3 URL-encoded listing output and an expired retained marker body hidden by a latest
delete marker; the original inspection packet and invocation journals are preserved.

D3-106 requests URL encoding explicitly and decodes only documented S3 key fields once. Opaque
version IDs remain unchanged. A retired marker requires exactly one retained body and one latest
tombstone with matching ownership and valid retention/time ordering. Its exact body version still
passes checksum, metadata, encryption, completed-tag, retention and KMS checks and remains an input
to deletion reconciliation. Nothing is ignored because its backup expiry elapsed. Extra, unpaired,
premature or changing versions refuse. Snapshot checks bind the tombstone as well as the body.
Historical completion-repair diagnosis remains restricted to a current marker.

257 focused AWS-reader, handler and policy tests pass, including the pinned SDK's actual XML
transport, cross-page pairing, retirement ambiguity and changed-tombstone regressions. Component
typechecking, changed-file lint and the simulated connected browser journey pass. Browser identity,
BFF, native service and Chrome receiver are simulated. Consequential independent source review
passes. No full repository checks run.

Fresh managed inspection and one explicit replay subsequently pass on merged `8e663f9f`, using
the immutable numeric executor and original, unextended admission window. Both authenticated
markers (one current, one historical retained body) resolve to subjects already reconciled:
newly reconciled 0, absent 0, already reconciled 2. Document versions, S3 writes, recovery-ledger
writes and identity-provider calls are all 0. This verifies current schema and transactional
deletion postconditions; it does not claim two new deletions or formal whole-database recovery proof.
The response SHA-256 is `5add846dd6d67311de0fd31da9201feafaaa24e62ee2b63544b693bcc916caf6`.
Independent result review passes against the exact request and approved inspection.

Both temporary executors are deleted and confirmed absent after their invocation drains;
immutable artifacts remain retained. Temporary IAM/boundary permissions and paid private endpoints
are removed. Data-preserving database dormancy and actual runtime shutdown pass; see the
[offline release and shutdown evidence](d3-compatible-gateway-offline-release-2026-10-10.md).
No live candidate/native/provider acceptance is claimed. Independent D1/admin acceptance remains deferred.
