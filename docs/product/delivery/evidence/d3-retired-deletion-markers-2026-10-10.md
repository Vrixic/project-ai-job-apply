# D3 retained deletion markers — 2026-10-10

Managed read-only inspection on the restored development primary refused at `marker_snapshot`,
before SQL opened. No deletion replay was attempted. Protected diagnostic evidence identifies
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

This is implementation and local verification, not managed replay or live candidate acceptance.
The failed executor is disabled pending its required cleanup drain; fresh managed testing follows
cleanup with a new source-bound packet. AWS shutdown is required before handoff. Independent
D1/admin acceptance remains deferred.
