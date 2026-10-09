# ADR-046: Observed form and explicit saved-answer selection

- Status: Proposed; default-off implementation, release/accountable acceptance pending
- Date: 2026-10-09

ADR-010 reuse needs an observed form and explicit semantic/context confirmation. The existing
Applications request binds form/question hashes and exact vault versions. Do not manufacture
hashes from taxonomy labels or infer jurisdiction from job location.

An explicitly invoked unpacked extension action reads standard top-frame question structure on
the current canonical employer URL. It checks the authenticated owner/application/job, current
tab/account and application revision around extraction. No fields are filled or submitted.
The self-contained generic extractor excludes values, hidden/password/action controls and text
inside controls when resolving labels. Oversized structures and detected challenges are refused.

The candidate copies a strict, at-most-64-KiB structure envelope to their clipboard and pastes it
into the exact web application within its original 60-second lease. This manual transfer adds no
external bridge, persistent queue, browser-storage entry, new host permission or service endpoint.
The envelope contains destination, application/job IDs, capture time and bounded question metadata.
Treat imported data as untrusted candidate input, never as signed provider evidence.

Web rechecks the current job destination and reads saved metadata only. Offer choices only for
unambiguous supported restricted questions. Each choice names an exact ID/version/context and
requires fresh meaning confirmation; unknown, conflicting and direct-action questions remain
manual. Derive hashes from the actual imported structure using the existing SDK algorithm.
Send only existing form/selection fields to Applications, never raw question text or vault values.
The backend reads exact protected values and preserves correction, deletion, expiry and immutable
approval guards. Final packet review shows each value/version/context.

Selection state is memory only; clear on exit/hidden state, original lease expiry, packet change
or unmount. Clipboard copies remain candidate controlled. Preserve user-entered answers, form
binding and unchanged vault references during later packet edits; explicit edits replace that
field's saved reference. Every new packet requires fresh final review and approval.


For a form-bound packet, manual Apply now accepts optional v1 `observedForm` on the existing
`StartManualApplicationSubmissionRequest`: exact form binding, original capture time and explicit
candidate confirmation. Web compares a newly imported structure with the approved hash and current
canonical destination before enabling confirmation. The transaction checks adapter/variant and the
original 60-second lease after application/vault locks; existing approval, artifact and saved-version
guards still decide admission. Missing observation preserves the original form invalidation; a
fresh changed hash commits invalidation. This is candidate attestation, never provider proof.
Only scalar binding/time/confirmation enter the command and idempotency fingerprint; no new event,
table, endpoint or generated-content persistence is introduced. Identical accepted commands replay
after lease expiry; changed proofs conflict under the same action key. Lost responses trigger an
owner-scoped application refresh before another capture is offered.

Roll out the compatible Gateway/Applications validator and reader before enabling new web commands.
Legacy requests remain valid and retain their behavior; older strict servers reject the optional
property, so client-first activation is unsafe. No SQL migration is required. Rollback disables the
new UI before reverting readers. Raw questions are processed only in extension/clipboard/web memory;
identifiers and structure metadata can still be confidential and are excluded from telemetry.

Web requires `NEXT_PUBLIC_APPLICATION_SAVED_ANSWER_SELECTION_UI=enabled`; extension capture uses
ADR-045's unpacked-only default-off handoff configuration. Backend reuse remains off unless
separately authorized/configured. Installed browser, live identity/owner checks and accountable
legal/privacy/security acceptance remain required before activation. No provider fixture or
adapter acceptance is claimed. Independent D1 acceptance remains deferred.
