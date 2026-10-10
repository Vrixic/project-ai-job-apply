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

## Native transport proposal for the next batch

Use Chrome's website-to-extension messaging with one exact configured first-party HTTPS origin
and one configured installed extension ID. A separate default-off execution build adds that
origin to `externally_connectable`; the existing manual handoff build remains unchanged. This
does not add employer host access, accept arbitrary website senders or discover installed
extensions. Missing API support falls back to existing candidate downloads/manual Apply.

The candidate first selects the exact employer tab/application in the extension. Background memory
holds only one pending scalar binding, including account fence, tab/document identity, canonical
job URL, packet/approval and original material references. An explicit first-party “Send approved
files to extension” action requests a one-use admission. Chrome sender origin, exact review URL,
top-frame tab/document identity and protected extension owner reads must all agree. The extension
returns a fresh nonce with at most a 60-second lease, bounded by all original material/approval
deadlines. It binds the sender document as well as the employer destination; navigation invalidates
the admission. A worker restart loses admission rather than restoring content from storage.

The first-party workspace reads approved files through its existing in-memory native session,
validates bytes/hash and the unchanged packet, then sends only the strict versioned file envelope
and nonce to the configured extension. No native/web credential crosses that channel. The extension
consumes admission once, repeats owning packet/material and sender/destination checks, independently
validates bounded file bytes/hash/format and retains content only in private memory until its
original expiry. No unsolicited, duplicated or late envelope can replace an admitted file. Failed
or unknown transfer acknowledgement requires a new explicit transfer; it never implies an ATS
submission or permits retrying a dispatched attempt.

The first-party web runtime is a trusted producer of native bytes; exact Chrome sender checks are
essential, since a file digest is integrity evidence and is not a server signature. A same-origin
script compromise is an existing native-material confidentiality/integrity risk, not evidence
that this transport is cryptographically independent of the workspace. Review CSP, strict sender
validation, DOM isolation and installed-browser behavior before activation. Versioned cross-client
envelopes belong to authoritative contracts with generated browser validators, not handwritten
TypeScript casts. The initial transport source and composition passed independent review;
regression/browser verification and exact-head review remain required for each implementation batch.
Cancellation uses the exact admitted nonce even before a receipt exists, so a withdrawn or lost-ACK
commit cannot retain bytes until its asynchronous check finishes. A completed transfer additionally
supports exact-receipt discard. Both operations require the original Chrome sender document.

Chrome API references: [website messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging),
[externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable),
[MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)
and [document-targeted scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).

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
