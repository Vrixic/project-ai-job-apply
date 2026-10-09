# ADR-047: Withdrawn-answer application recovery

- Status: Proposed; locally verified source, compatible release and accountable acceptance pending
- Date: 2026-10-09

An immutable packet may reference a saved answer that was corrected, removed or expired.
Its candidate value-read capability must refuse that value. Making the entire Application
unavailable also prevents reopening, fresh preparation, reconciliation and submission history.

Applications v1 adds optional `packetAvailability: "withheld"`. This explicit projection contains
only existing application/status/revision/action/attempt/timestamp metadata. It omits the entire
packet and approval, including ordinary fields, artifact references, answer versions and hashes.
The strict contract forbids a withheld projection with a packet, approval or ready-to-submit action.
The persisted status is retained; a ready-to-submit presentation action becomes re-review.
No value is substituted with null, no immutable packet is rewritten and no approval is granted.

Only the owning restricted reader can classify this condition. It first admits the exact active
owner/current application revision/packet/hash and locks current Profile-owned references. A
positive binding mismatch or original expiry produces a distinct internal error. The second
post-decryption admission can produce the same refusal and clears decrypted values. SQL, crypto,
configuration, integrity and other failures remain unavailable. Export keeps its separate exact
rights admission and original-value semantics; it never returns this recovery projection.

Existing owner-scoped read, search and command responses use this projection. Existing optimistic
revision, idempotency, approval and attempt transactions stay authoritative. An approved candidate
can explicitly reopen; review-required candidates can prepare anew from confirmed facts and fresh
explicit entries or selected versions. Web clears remembered entries and never reconstructs a
withheld packet's selections, form or values. Fresh packets require fresh review/approval.
An in-flight attempt permits only its existing status/reconciliation actions. Candidate-confirmed
submission remains candidate evidence, and not-submitted reconciliation still requires explicit
duplicate-risk acknowledgement. Applied history retains submission metadata without old values.

Deploy upgraded strict Gateway, web, extension and other v1 readers before producing the optional
property; old responses remain valid, while old closed-object readers reject the new property.
Rollback stops producers before reverting readers. The producer requires the existing default-off
restricted packet/reuse composition; this change does not activate that composition. There is no
new endpoint, migration, event, worker, provider effect, retention extension or generated content.
Live owner identity, installed-browser/provider behavior and accountable reviews remain separate.
Independent D1 acceptance remains deferred.
