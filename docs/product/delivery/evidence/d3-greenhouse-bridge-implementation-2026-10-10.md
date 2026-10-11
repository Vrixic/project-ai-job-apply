# D3-101: Greenhouse execution bridge

Started: 2026-10-10. Status: In progress; source locally verified, deployment and release acceptance incomplete.

The first implementation batch supplies bounded exact-host/top-document inspection and
registry-gated ordinary field execution in the extension. It reuses the SDK extractor, planner
and sensitive-field rules. Stable control identity and full normalized form structure are checked
before every event; changed documents, challenges, concealed/readonly/disabled controls, browser
sanitization, reverted values and new validation failures stop effects and require review.
One fixed admission deadline/cancellation fence bounds asynchronous owning-approval checks.
Partial effects never replay. Default registry controls and declared application variants remain
unchanged and off. This batch adds the separate native file transport below; ATS attachment,
submission and provider-confirmation paths are supplied by the connected source batch below.

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

The connected transport/lifecycle pass has 216 extension tests across seven files and 70 web tests
across four files. Installed headless Chromium passes the production workspace's search → Prepare
resume/cover letter → review → approve → manual Apply → candidate-confirmed history journey,
four approved downloads and PDF/Word transfer/withdrawal actions. Identity, native service, Chrome
receiver and provider responses are simulated. This is not installed-extension, ATS upload,
provider-confirmed submission or live acceptance. The reviewer cleared initial transport and
composition source; final batch review and full repository verification remain pending.
Review also identified PostgreSQL JSONB/native object key-order incompatibility. A bounded exact
plain-JSON comparator now ignores only object key order, preserving types, exact key sets and
array order. Reordered material/admission/receipt/owner proofs and malformed/deep inputs have
regressions. The initial full-verifier run was interrupted for this fix and is not pass evidence;
The corrected full run then reached repository tests and found the new public execution flag
missing from Turbo's exact allowlist. The two-line fix passes both real strict-mode dry-run checks
and independent review. Neither interrupted/failed full run is pass evidence.

The connected source batch now wires explicit Apply through existing start/dispatch/result routes,
one isolated-world page command and exact current attempt/material/job/document proofs. File
identity, ordinary-value readback, one-shot effect/click guards, challenge-first fresh confirmation,
payload cancellation and saved-answer/material expiry are enforced. Returning to the workspace
refreshes current submission/history state. Extension and web type checking, formatting and lint
pass. The connected focused pass has 104 extension tests across six files and 36 workspace tests.
Installed headless Chromium passes 23 generated-synthetic execution cases, including same-size
and cross-file replacement, challenge/confirmation races, stalled hashing and immediate cleanup;
there are zero false confirmations, external requests or uploads. The production workspace's
simulated search/preparation/review/approval/manual-Apply/history journey and 15 primitive browser
cases also pass. Actual content-entry tests cover two-file cleanup during a stalled first digest;
owning background tests cover lost dispatch/command/result acknowledgements, worker cancellation,
foreign proof documents, material withdrawal and terminal attempt timestamps. Full repository
verification now passes as recorded below. Production profiles remain empty and
registry controls off; source wiring grants no provider acceptance.

Remaining internal work: live delegated-grant
verification and the connected installed/native/provider journey. Managed
privacy recovery and compatible publication still precede live activation. See
[proposed ADR-049](../../../adr/049-greenhouse-approved-application-execution.md).

Authorized provider fixtures/independent QA, all-copy retention conformance and accountable
capability approval remain external acceptance gates. Synthetic tests are not provider evidence.
No AWS activation or Docker/WSL restart occurred in this batch. Earlier credential checks failed;
the final readback below supersedes that blocker. Independent D1/admin acceptance remains deferred.

## Connected batch verification — 2026-10-10

All 43 repository verification stages pass with terminal exit zero, including 680 extension tests
and 912 web tests. This is the first complete pass for the connected execution source; neither
earlier interrupted/failed run supplies pass evidence. The separate 104-test extension and
36-test workspace regressions, 23-case synthetic execution browser pass, 15 primitive browser
cases and production workspace simulated manual journey also pass. Independent targeted source
review passes; its private receipt SHA-256 is
`d091029c9a7cf4012ae692d497bb1bc3d07e930c1c928b741b6a0ef624511129`.

Private logs under `.tmp/d3-greenhouse-bridge-20261010/`:

| Check | Log | SHA-256 |
|---|---|---|
| 43 repository stages | `ats-execution-full-verification.log` | `33ce9aeae0636845a63fae9707b544d8a319253c1fa8f857f59db974ca21a276` |
| 104 focused extension cases | `ats-execution-extension-focused.log` | `d6ecf5f7a863d40ec58e8503f5dde364a7f03dc67a922a6efb880023bfca9784` |
| 36 workspace cases | `ats-execution-web-focused.log` | `35dfe80293bc10df7d9571d0373f4c58181c6be7681828ef00a38085565606f2` |
| 23 synthetic execution browser cases | `ats-execution-chromium.log` | `26c0abded0010d6bb61e7b4bff3e62e33526d07ff334be7cdcf88d6905c89c2f` |
| Simulated manual workspace journey | `ats-execution-workspace-chromium.log` | `c306a0371efeaa73862cb09e50a07fcc67fc102ad696e22dd55bf65d82ba07ce` |

Fresh development SSO identifies the expected account. Maintained drain checks and independent
readback verify zero databases, NAT gateways, Interface endpoints and Elastic IPs, with routes,
schedules, queues and running work drained. The exact final snapshot remains available/encrypted
with its original lineage; privacy reconciliation remains incomplete. Independent shutdown review
SHA-256: `a99c2622ee03f5aff6a6bafcf341f03c9778646fde4d40ff431d708970fcc089`.
The fresh saved dormant plan has zero resource/output changes and drift across all 143 inputs;
independent exact-plan review SHA-256:
`fe80e5890b6050d4164dd280785a32d828aec4f77cc4b56f5d6aaf3de331d27e`.
No cloud apply occurred. Retained storage/security resources incur charges. Docker and WSL remain
off; the PC remains on. Staging was not accessed.

These tests use simulated identity/owning APIs/provider profiles. Worker loss is modeled by
cancellation, not actual Chrome worker termination. They do not establish one installed-extension
Prepare-to-provider-confirmed-history journey, live grants, provider retention or accountable
acceptance. [PR #634](https://github.com/Vrixic/project-ai-job-apply/pull/634) carries this source.

Final independent exact-source review passes clean commit
`d4c0cf27cade4cf9ab6cce96aee717432fd53e4e`, confirms the tested source hashes and permits normal
source merge. Its private receipt SHA-256 is
`ebc9838283ad64f3d48100127d93012cc2e5e3e3f55f1b0bc2453b846b99ede2`.
Hosted quality CI did not start because of account billing/spending restrictions. Local checks
above supply verification; hosted failures are not pass evidence or authority to bypass protection.
