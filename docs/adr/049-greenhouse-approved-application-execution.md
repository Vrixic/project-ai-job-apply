# ADR-049: Greenhouse approved application execution

Status: Proposed; implementation and release acceptance pending
Date: 2026-10-10

Initial internal inspection/ordinary-field primitives compile and pass focused synthetic tests
and intercepted Chromium probes. They are not connected to extension UI, native files or attempts.
The existing extension session requests `applications:read` for manual handoff only. Any future
execution build must separately opt into the existing `applications:write` grant, preserve
default-off/manual permissions and verify that exact public-client delegated grant before live use.
Neither this document nor a model-authored test grants provider or identity authority.

## Scope and authority

Implement the first application adapter in the extension, using the existing provider-neutral
extractor, taxonomy mapping, fill planner and fail-closed adapter registry. Greenhouse alone is
in scope. Supported variants require separate authorized, sanitized and independently QA-accepted
provider evidence under ADR-021. Synthetic fixtures establish implementation behavior only.
The existing manual handoff in ADR-045 remains available without granting automation authority.

The path is candidate action → extension approval/tab/form checks → Applications attempt admission
and write-ahead dispatch → one bounded Greenhouse page action → Applications result/history.
The extension uses its own public-client identity. No confidential web token or separate native
PKCE credential crosses into the extension or employer page. Existing Applications ownership,
packet hashing, saved-answer validation and attempt reconciliation remain authoritative.

## Implementation batches

1. Provider-specific detection, bounded structural inspection, exact-control execution and
   validation/confirmation classification, using synthetic pages. Page-local handles are valid
   only with the exact captured form structure and document; DOM position alone never identifies
   a field. Unknown widgets, duplicate controls, changed structures and iframe boundaries fail
   closed to candidate takeover. No whole-page bodies or entered values are retained as evidence.
2. Connect the current approved packet, native file transport and explicit candidate controls to
   the adapter. Native content stays in memory and every copy inherits its original fixed expiry.
   The file bridge must bind application, packet/hash, material generation/content hash, format,
   exact first-party source tab and employer destination tab. It must authenticate the first-party
   sender, bound size/time, reject unsolicited/replayed requests and clear late or expired work.
   The existing manual clipboard channel does not authorize file or token transport. The precise
   browser bridge and permission changes must be inspected and reviewed before they are added.
3. Wire one-shot submission to existing start/dispatch/result routes, with exact command identities,
   positive dispatch acknowledgement before the irreversible effect and positive provider evidence
   before confirmed history. Failure or loss of acknowledgement after dispatch is ambiguous.
   Neither a worker restart nor a timeout may retry the click. Candidate-attested manual outcomes
   remain distinct from provider confirmation.

## Safety and lifecycle

The adapter registry remains the action gate: default-off kill switch, accountable live-effect
approval and unexpired evidence for the exact declared variant are all mandatory. Production
controls cannot label a synthetic fixture as provider-derived. Inspecting a synthetic page never
authorizes a live employer request, file upload or submission.

Only immutable approved nonrestricted values may be filled. Every sensitive, authorization,
demographic, disclosure, signature and attestation control requires direct candidate action.
Options must match exactly and uniquely. A challenge blocks all fills, attachments and submission;
there is no CAPTCHA/MFA bypass. Required unknown controls and validation errors return to review.
Recheck owner/session, tab/URL, current job revision, packet/approval, exact form structure,
saved-answer validity and original material expiry before effects, including after asynchronous
work. Cancellation, account change, navigation, expiry and confirmation clear pending material
and fence late work. Partial fills are reported without silently replaying them.

Memory transport introduces no saved generated document, persistent queue, browser storage,
object upload or diagnostic body. Clear references and owned byte buffers at disposal; physical
JavaScript string erasure is not guaranteed. Employer copies require ADR-038 all-copy/no-retention
conformance before activation; uploading bytes is not evidence that a remote copy can be deleted.
Source implementation cannot waive that gate or extend an original 30-minute material deadline.

## Validation and rollout

Implement connected wiring in batches before the associated test pass. Test the nine owner-adopted
variants with synthetic pages, control changes during asynchronous work, exact option handling,
sensitive exclusion, challenge takeover, file binding/expiry, one-shot dispatch and ambiguous
outcomes. Exercise the actual extension/browser journey after unit checks, and distinguish
synthetic identity/API/provider responses from installed/live acceptance. Run the full repository
verifier and independent review before merge.

Managed recovery and compatible publication are required before live D3 activation against the
retained historical database. They do not block this default-off source work. Authorized provider
fixtures, independent QA, provider retention conformance and accountable security/privacy/product
approval remain external gates. Independent D1 and hosted admin acceptance remain deferred.
