# D3-101: Greenhouse execution bridge

Started: 2026-10-10. Status: In progress; source is not merged or deployed.

The first implementation batch supplies bounded exact-host/top-document inspection and
registry-gated ordinary field execution in the extension. It reuses the SDK extractor, planner
and sensitive-field rules. Stable control identity and full normalized form structure are checked
before every event; changed documents, challenges, concealed/readonly/disabled controls, browser
sanitization, reverted values and new validation failures stop effects and require review.
One fixed admission deadline/cancellation fence bounds asynchronous owning-approval checks.
Partial effects never replay. Default registry controls and declared application variants remain
unchanged and off. This batch adds the separate native file transport below; ATS attachment,
submission and provider-confirmation paths remain unfinished.

The focused pass has 96 tests across four files, including 42 new adapter probes and 54 existing
manual-handoff regressions. Installed headless Chromium passes 15 generated-synthetic page cases,
with every request intercepted locally, zero external requests/uploads/submissions and simulated
registry/approval authority. Type checking and targeted Biome checks pass. Independent review
identified per-event eligibility, exact value readback and post-handler validity gaps; fixes and
regressions are included, and the final primitive source review passes at `5b61b8ef`. Full repository verification has not
been repeated for this source batch. D3-100's earlier full verification does not verify this code.

The second batch connects explicit employer-tab selection and the approved native workspace via
closed generated contracts and one exact configured Chrome extension ID/HTTPS website origin.
Protected owner/job/material reads and destination document identity bracket admission and byte
validation. One-use nonces, bounded serialized/decoded sizes, hashes/format and original expiry
are enforced. Files and credentials never enter storage; native tokens remain in the workspace.
Exact-admission cancellation covers unresolved/lost acknowledgements; exact-receipt discard,
navigation, account changes, logout, approval revision, unmount and expiry withdraw local copies.
Only a separate unpacked/default-off execution build installs external messaging and requests the
existing application write scope. Production adapter controls remain dark; a build creates no grant.

The connected transport/lifecycle pass has 205 extension tests across seven files and 70 web tests
across four files. Installed headless Chromium passes the production workspace's search → Prepare
resume/cover letter → review → approve → manual Apply → candidate-confirmed history journey,
four approved downloads and PDF/Word transfer/withdrawal actions. Identity, native service, Chrome
receiver and provider responses are simulated. This is not installed-extension, ATS upload,
provider-confirmed submission or live acceptance. The reviewer cleared initial transport and
composition source; final batch review and full repository verification remain pending.

Remaining internal work: actual ATS attachment and effect-bound execution; live delegated-grant
verification; one-shot write-ahead dispatch, strict attempt-bound confirmation/results and the
connected installed/native/provider journey. Managed
privacy recovery and compatible publication still precede live activation. See
[proposed ADR-049](../../../adr/049-greenhouse-approved-application-execution.md).

Authorized provider fixtures/independent QA, all-copy retention conformance and accountable
capability approval remain external acceptance gates. Synthetic tests are not provider evidence.
No AWS activation or Docker/WSL restart occurred in this batch. Fresh development cloud readback
remains unavailable because STS reports expired SSO credentials; the last independent off proof
is the earlier D3-099 dormancy closure. Independent D1/admin acceptance remains deferred.
