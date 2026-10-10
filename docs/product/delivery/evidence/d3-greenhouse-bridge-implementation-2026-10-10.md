# D3-101: Greenhouse execution bridge

Started: 2026-10-10. Status: In progress; source is not merged or deployed.

The first implementation batch supplies bounded exact-host/top-document inspection and
registry-gated ordinary field execution in the extension. It reuses the SDK extractor, planner
and sensitive-field rules. Stable control identity and full normalized form structure are checked
before every event; changed documents, challenges, concealed/readonly/disabled controls, browser
sanitization, reverted values and new validation failures stop effects and require review.
One fixed admission deadline/cancellation fence bounds asynchronous owning-approval checks.
Partial effects never replay. Default registry controls and declared application variants remain
unchanged and off. No UI, native file, upload, submit or provider-confirmation path is wired.

The focused pass has 96 tests across four files, including 42 new adapter probes and 54 existing
manual-handoff regressions. Installed headless Chromium passes 15 generated-synthetic page cases,
with every request intercepted locally, zero external requests/uploads/submissions and simulated
registry/approval authority. Type checking and targeted Biome checks pass. Independent review
identified per-event eligibility, exact value readback and post-handler validity gaps; fixes and
regressions are included, with final fix review pending. Full repository verification has not
been repeated for this source batch. D3-100's earlier full verification does not verify this code.

Remaining internal work: connect exact approved packets and document/navigation identities;
select and review authenticated memory-only native file transport; separately gate the existing
extension write scope and verify the public-client grant; implement one-shot write-ahead
dispatch, strict attempt-bound confirmation/results and connected browser journeys. Managed
privacy recovery and compatible publication still precede live activation. See
[proposed ADR-049](../../../adr/049-greenhouse-approved-application-execution.md).

Authorized provider fixtures/independent QA, all-copy retention conformance and accountable
capability approval remain external acceptance gates. Synthetic tests are not provider evidence.
No AWS activation or Docker/WSL restart occurred in this batch. Fresh development cloud readback
remains unavailable because STS reports expired SSO credentials; the last independent off proof
is the earlier D3-099 dormancy closure. Independent D1/admin acceptance remains deferred.
