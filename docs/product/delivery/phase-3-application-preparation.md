# D3 — High-Quality Application Preparation

Status: In progress. Started: 2026-09-18. Completion: Not completed. Updated: 2026-10-10.

## Task register

Implemented means merged source; deployment and live acceptance are stated separately.

| Capability / task IDs | Implemented | Remaining |
|---|---|---|
| Facts and saved answers (D3-001, D3-039, D3-055, D3-056, D3-075, D3-076) | Fact grounding, encrypted answer storage, selected-version checks and expiry/correction/quarantine guards are locally verified. | Compatible release and live saved-answer reuse acceptance; D3-087 supplies locally verified selection/review and reuse remains off. |
| Resume import (D3-002, D3-023, D3-024) | Immutable import, normalized resume structure and upload registration are implemented; synthetic scan/parse has development evidence. | Real-resume processing approval and final connected onboarding acceptance. |
| Resume preparation (D3-003, D3-016, D3-022) | Deterministic tailoring, visible diffs, factuality checks and verified PDF/DOCX rendering are implemented. | Connected native generation/download and candidate output-quality acceptance. |
| AI generation (D3-004, D3-037, D3-038) | A gated model adapter, grounded output validation and fresh disclosure checks are locally verified. | Provider configuration, real-model evaluation and live generation acceptance. |
| Applications (D3-005, D3-021, D3-074) | Immutable packets, owner-scoped lifecycle/history, application reopening and approval rechecks are implemented. | Final connected generation, approval, dispatch and confirmation acceptance. |
| Review (D3-006) | Review-by-exception and explicit approve/cancel UI are implemented. | Live native material/saved-answer integration and final accessibility acceptance. |
| ATS adapters (D3-007, D3-013) | Provider-neutral extraction, mapping, approved-field planning and challenge detection are locally verified. | Authorized provider fixtures, independent QA acceptance and the first Greenhouse adapter; Lever/Ashby follow later. |
| Submission safety (D3-008) | Attempt idempotency, validation, takeover, ambiguity handling and terminal confirmed-submission history are implemented. | Connected extension submission and provider confirmation acceptance. |
| Assisted/manual Apply (D3-009, D3-018) | Canonical job opening, approved-answer copying and safe manual fallback are implemented; the deployed manual flow passed human review. | Direct native downloads and extension handoff acceptance. |
| Metrics (D3-010, D3-036) | Versioned correction/outcome metrics and strict detached telemetry envelopes are locally verified. | Production sinks/dashboards/alarms are deferred from the candidate-journey critical path. |
| Verification (D3-011, D3-019) | Local adversarial, owner-isolation, duplicate-start and crash/replay checks pass; basic manual Apply is accepted. | Full generated-material journey, installed-extension checks and final security/privacy/accessibility/product acceptance. |
| Capability approval (D3-012) | Engineering approval packet refreshed on October 9 against current source/evidence; existing limited development owner dispositions are linked without amendment. | Provider retention under ADR-038, exact release/source review and accountable legal/security/privacy gates remain; development direction alone does not close them. |
| Candidate rights (D3-014, D3-028, D3-029, D3-030, D3-031, D3-073) | Applications export/delete/restore support, restricted-answer export and document-prefix cleanup are implemented with local and partial managed evidence. | Current deployed document-inclusive deletion/export/restore acceptance and backup-aging/accountable review. |
| Migration/release tooling (D3-015, D3-020, D3-032, D3-033, D3-034, D3-040, D3-041) | Release convergence, provenance guards, dependency corrections and checksum-bound migration/restore tooling are implemented and verified. | Fresh compatible publication and exact managed release/restore checks for the next activation. |
| Resume limits/deletion (D3-025, D3-026, D3-027) | Plan-driven limits, in-progress upload exclusion, deletion and version/prefix byte purge are implemented and accepted in development. | Document-inclusive account-deletion acceptance remains under candidate rights. |
| Cover-letter preparation (D3-017, D3-042, D3-043, D3-044, D3-050, D3-067) | Private initialization, single-dispatch admission, original-work recovery and failure fences are locally verified. | Live provider composition, positive remote settlement, temporary-copy cleanup and candidate preview acceptance. |
| Provider response lifecycle (D3-045, D3-046, D3-047, D3-048, D3-049, D3-057, D3-059, D3-060, D3-061, D3-063, D3-065) | Original-response capture, eligibility, completion/failure settlement and disposal ports are locally verified. | Managed provider behavior, original-writer quiescence, retention and end-to-end cleanup acceptance. |
| Private runtime (D3-051, D3-052, D3-053, D3-054, D3-058, D3-062, D3-066, D3-078) | Isolated control/maintenance/provider bootstraps, artifact publishers and restrictive IAM composition are implemented. | Complete managed release, effective permissions, scheduling/drain and live acceptance for cover-letter work. |
| Preparation workflow (D3-068, D3-069, D3-070, D3-071) | Native preparation activity, durable entrypoint, starter and recovery artifacts are implemented and qualified locally. | Complete connected activation and original-work recovery/drain acceptance. |
| One-off material policy (D3-064, D3-072) | Memory-only storage, bounded expiry, hash-only packet guards and legacy export readers are implemented locally. | Complete no-persistence/30-minute enforcement across provider, browser, ATS and all copies; legacy saved-content paths must remain inactive or be replaced. |
| Restricted packets (D3-077) | Separate-key packet protection and legacy receipt migration are implemented; managed archival of seven receipts passed. | Managed original-request replay, saved-answer reuse and broader candidate/privacy acceptance. |
| Native material session (D3-079) | Native HTTPS/image, route/disposal bindings, preparation/cleanup resources and a bounded backend test driver are implemented; managed resources are deployed disabled. | Controlled sign-in, source/owner activation, live preview/PDF/DOCX, expiry/retirement, browser/CORS and client/ATS acceptance. |
| Connected browser safety (D3-080) | Exact material/hash/deadline guards, explicit generated-material review, boolean sensitive answers, packet-change resets, retry-stable commands, async preparation/scalar-location BFF routes and immediate confirmed-history refresh are locally verified. D3-088 supplies locally verified withdrawn-answer recovery. | Native identity/CORS activation and live acceptance remain; D3-083 supplies locally tested native browser source. |
| Cover-letter request/status UI (D3-081) | Default-off versioned disclosure opt-in, explicit asynchronous requests, retry-stable admission, bounded status polling, current-packet checks and latest-revision cancellation are locally verified, including the full repository verifier and synthetic Chromium checks. Preview availability binds every material-reference scalar, including later versions of the same generation. | Live native preview/download, generation and cleanup acceptance remain open; browser source is tracked in D3-083. |
| Form-plan safety (D3-082) | Conflicting control claims and duplicate normalized options fail closed; challenges produce no fill/attach actions; restricted fields always require candidate action under the adopted D3-013 threshold. All 20 synthetic SDK tests, the synthetic connected Chromium journey and the full repository verifier pass. | Provider fixtures, first adapter integration and live acceptance remain open. |
| Native browser materials (D3-083) | Owner-selected separate in-memory Auth0 popup PKCE, direct native resume/cover-letter previews, explicit review integration and approved PDF/DOCX downloads are implemented behind a default-off flag. 35 new auth/transport/UI/header regressions and the synthetic Chromium journey pass. The owner-approved separate SPA registration is configured and saved grant/origin settings are inspected. | Controlled same-owner sign-in, live DNS/TLS/CORS and native/provider/release acceptance remain. |
| Form extraction limits (D3-084) | Oversized forms/options/question text are rejected instead of hashing or planning from a prefix. All 24 synthetic SDK tests pass, including exact-boundary, overflow and radio-requiredness regressions. | The full repository verifier and synthetic Chromium journey pass; future adapter integration must handle extraction refusal. Provider fixtures and live acceptance remain open. |
| Shutdown status dependency (D3-085) | Staging status uses exact function inventory rather than treating empty mappings as proof of deployment. Nine synthetic absence/presence/active-trigger/read-failure cases, the full repository verifier and the synthetic connected Chromium journey pass. The corrected read-only operator verifies dormant staging. | AWS access/checks are sequential per the owner. This required shutdown dependency adds no D1 acceptance or D3 provider activation. |
| Manual extension handoff (D3-086) | Default-off approved-answer handoff, exact application return, per-copy owner/job/approval/expiry/withdrawal checks and fresh sensitive context confirmation are implemented. Local regressions, the full repository verifier and the synthetic CSP/connected Chromium journeys pass. | Focused installed Chrome/Edge, live identity/endpoints and release acceptance. Automated provider integration and live acceptance remain unfinished. [Evidence](evidence/d3-manual-extension-handoff-2026-10-09.md). |
| Observed-form saved-answer selection (D3-087) | Explicit bounded question capture, exact saved version/context selection, final sensitive review, original expiry and fresh form-confirmed manual Apply are implemented and locally verified. All repository checks, 95 PostgreSQL cases and both synthetic Chromium journeys pass. | Compatible release, installed/live reuse/native/provider acceptance. [Evidence](evidence/d3-observed-form-saved-answer-selection-2026-10-09.md). |
| Withdrawn-answer recovery (D3-088) | Explicit metadata-only recovery is implemented across contract, Applications and web; private value refusal and immutable packet safety remain. Full repository verification, 72 real PostgreSQL cases and three synthetic Chromium journeys pass. | Compatible release and live acceptance remain. [Evidence](evidence/d3-withdrawn-answer-recovery-2026-10-09.md). |
| Release guard recovery (D3-089) | Complete boolean comparison and bounded deferred native identity-read validation pass focused regressions, independent source review, full repository verification and three synthetic Chromium journeys. Publication, restore and baseline checks are independently verified; fresh development shutdown and recovery archive pass. | Current-source deployment and live acceptance remain. [Evidence](evidence/d3-release-guard-recovery-2026-10-09.md). |
| Candidate hosting build recovery (D3-090) | Exact frozen-install patches and ATS SDK upload, preflight guards and omission regressions are implemented and verified. All 42 repository stages, independent review, three synthetic Chromium journeys and the real Vercel preview build pass. | Compatible live release and candidate/native/provider acceptance remain. [Evidence](evidence/d3-candidate-hosting-build-recovery-2026-10-09.md). |
| Restore-selection correction (D3-091) | Ordinary restore requires the reviewed final snapshot and actual database creation to select the same snapshot. All 25 focused cases pass in both PowerShell hosts; all 41 pre-hosting repository stages and independent source review pass. Actual saved-plan regressions reject the earlier incorrect restore. | Historical snapshot schema/checksums are now freshly verified under D3-092. Durable-data/privacy reconciliation, corrective recovery, compatible release and live journey remain. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-selection-correction--2026-10-09). |
| Restore verifier boundary recovery (D3-092) | Current 96-relation/79-migration verification replaces stale 93/74 expectations. Older evidence is rejected as current; focused PowerShell tests, independent review and all 43 repository stages pass. The isolated historical snapshot passes live read-only schema/checksum verification. | Durable-data/privacy reconciliation against the newest backup, compatible release and connected live acceptance remain. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-verifier-boundary-recovery--2026-10-09). |
| Restore data comparison (D3-093) | Bounded SQL-side whole-row hashes, exact catalogs, explicit snapshot contracts and strict comparison are implemented. 93 unit tests, all 96 restored relation digests and 21 real PostgreSQL probes pass. Both isolated managed inventories pass independent original-task review; 84 of 88 shared relations match exactly, including all 80 relations of the other six owners. | All 12 Applications differences now reconcile with seven actual KMS original-digest proofs. Complete privacy replay before primary promotion/live release. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#managed-snapshot-data-comparison--2026-10-10). |
| Restore transition reconciliation (D3-094) | Fixed read-only three-to-fifteen Applications comparison, exact original/added catalogs, ledger/default accounting and seven original-digest proofs are implemented. Independent review, 65 focused tests and seven real PostgreSQL reconciliation probes pass with simulated KMS. The new immutable diagnostic is published and independently verified. Separate default-off timed decrypt-only task registration passes 22 Terraform cases, configuration validation and all 43 repository stages. | Managed read-only reconciliation and independent result review pass; temporary authority and both restores are removed. Privacy replay, primary recovery and the live journey remain. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-transition-reconciliation--2026-10-10). |
| Privacy replay inventory (D3-095) | Restore reconciliation counts all fifteen Applications tables, including independent native withdrawals and their cleanup queue. Eight real PostgreSQL cases, 234 focused store/contract tests, the maintained 96-relation dump/restore harness and all 43 repository stages pass. | Managed privacy replay and primary recovery remain. [Evidence](evidence/d3-privacy-replay-inventory-2026-10-10.md). |
| Quiescent privacy recovery (D3-096) | Default-off development-only PITR checks writer drain and exact-input zero drift while preserving source/target safeguards. All 98 focused synthetic cases and 43 repository stages pass. | Managed recovery/privacy replay and live acceptance remain. [Evidence](evidence/d3-dark-privacy-recovery-2026-10-10.md). |
| Quiescent deletion replay (D3-097) | Default-off development replay binds the dark context/mode and recovery dependencies, using maintained writer-off PITR preflight. All 778 synthetic replay checks, 908 restore-role assertions and 43 repository stages pass; independent source review passes. | Managed replay and connected acceptance remain. [Evidence](evidence/d3-dark-deletion-replay-2026-10-10.md). |
| Recovery bootstrap inputs (D3-098) | Complete: bounded observations and typed inputs pass focused tests, independent review and all 43 repository stages. | Managed replay and connected acceptance remain. [Evidence](evidence/d3-bootstrap-recovery-inputs-2026-10-10.md). |
| Replay data preservation (D3-099) | Complete for repository implementation: 348 focused tests, 790 operator assertions, 11 real PostgreSQL regressions, independent review and all 43 repository stages pass. | Dedicated promotion, managed replay and live acceptance remain separate. [Evidence](evidence/d3-replay-data-preservation-2026-10-10.md). |
| Reconciled-copy verification (D3-100) | Complete for repository implementation: PR #633 merged after 500 focused tests, 17 real PostgreSQL regressions, independent final review and all 43 repository stages. | Private runtime/promotion wiring, managed replay and live acceptance. [Evidence](evidence/d3-reconciled-copy-verification-2026-10-10.md). |
| Greenhouse execution bridge (D3-101) | In progress: bounded DOM inspection and registry-gated ordinary field execution source compiles; scoped design in proposed ADR-049 passes independent review. | Complete adapter/browser verification, safe native file bridge, write authorization and dispatch/result wiring; external activation gates remain. |

## Decisions and scope changes

2026-10-10: D3-100 addresses independently confirmed recovery inventory omissions before primary
promotion. Valid historical completed inventories remain compatible when all current owners are
empty. The new read-only primitive is internal evidence, not cutover authority; ordinary cleanup
and original expiry rules remain unchanged.

D3-090 restores candidate hosting build inputs: exact frozen-install patches and the ATS SDK.
All 42 repository stages, independent review, three synthetic Chromium journeys and the real
Vercel preview build pass. Live journey acceptance remains separate.
See [hosting build recovery](evidence/d3-candidate-hosting-build-recovery-2026-10-09.md).

D3-087 is locally verified; live acceptance remains separate. D3-088 implements locally verified recovery found
by the negative-path inspection; see [recovery evidence](evidence/d3-withdrawn-answer-recovery-2026-10-09.md). See [current evidence](evidence/d3-observed-form-saved-answer-selection-2026-10-09.md).

Generated cover letters and tailored resumes must never persist and must expire within 30 minutes (ADR-038).
Manual Apply is the first acceptance path; Greenhouse is the first automated adapter.
Application history ends at confirmed submission; sensitive answers and irreversible actions require candidate review.

## Exit criteria

- [ ] Complete truthful preparation, review, approval, Apply and confirmed-submission history.
- [ ] Verify rendered documents, immutable approval bindings and duplicate-submission safety.
- [ ] Prove no generated-content persistence and all-copy expiry within 30 minutes.
- [ ] Accept supported ATS fixtures/accuracy and safe manual fallback.
- [ ] Complete rights/restore, AI evaluation, accessibility and accountable legal/security/privacy/product reviews.

## Evidence

- [Candidate hosting build recovery, 2026-10-09](evidence/d3-candidate-hosting-build-recovery-2026-10-09.md)

- [Connected browser implementation and verification, 2026-10-09](evidence/d3-connected-candidate-journey-2026-10-09.md)
- [Independent release review and guard recovery, 2026-10-09](evidence/d3-release-guard-recovery-2026-10-09.md)
- [Current native release, deployment and remaining acceptance](evidence/d3-native-application-disposal-2026-10-07.md)
- [Native preparation composition](evidence/d3-native-application-preparation-release-2026-10-07.md)
- [One-off material policy](../../adr/038-one-off-generated-application-materials.md)
- [Saved-answer packet binding](evidence/d3-vault-packet-binding-2026-10-04.md)
- [Restricted receipt migration](evidence/d3-legacy-receipt-transition-2026-10-08.md)
- [Capability approval packet](../../security/d3-application-approval-packet.md)
- [Provider fixture request](../foundation/d3-provider-fixture-request.md)

Historical checkpoints are retained in Git history and the linked evidence; this document records current status only.

2026-10-09: Implemented and verified D3-080 browser safety batch. Full D3 remains in progress;
the native identity choice was subsequently resolved by ADR-044; live/provider/accountable gates remain open.
Independent D1 acceptance, including hosted admin acceptance, remains deferred.

2026-10-09: Added D3-081 preparation/status UI without activating providers or sending generated
content through the BFF. Synthetic browser checks cover the opt-in and queued/running/succeeded
path; missing exact cover-letter previews continue to block approval.

2026-10-09: Refreshed the [D3-012 engineering approval packet](../../security/d3-application-approval-packet.md)
to remove obsolete missing-vault/workflow claims and link current protection, native lifecycle,
browser and managed evidence. The named development provider choice remains distinct from
ADR-038 retention approval; no reviewer disposition or release gate was changed.

2026-10-09: The owner selected separate in-memory Auth0 PKCE. D3-083 connects native resume/cover-letter review and four approved downloads; expiry/disconnect revoke local availability. Synthetic Chromium includes ten-minute credential expiry, reconnect, review/approve and confirmed manual history. Live registration identity/configuration is being inspected; no new SPA or permission grant was assumed.

2026-10-09: After inventory inspection found no SPA and an application limit, the owner confirmed
repurposing Default App. The saved separate SPA has Authorization Code only, the existing exact
HTTPS candidate origin and one user-delegated platform scope, `applications:read`; machine and
anonymous platform access remain zero. This is configuration evidence, not live sign-in or
native acceptance. Public identifiers are held only in ignored local configuration; UI stays off.

2026-10-09: D3-084 rejects incomplete form extraction; 24 SDK tests, the full repository verifier
and the synthetic connected Chromium journey pass. Development SSO is restored and dormant
runtime readback is verified; staging fresh verification now lacks its separate SSO session.
D3 remains In progress; no provider/native release or independent D1 acceptance is claimed.

2026-10-09: D3-085 fixes the optional-processor detection that blocked staging shutdown status.
Nine regressions, the full repository verifier and the synthetic connected Chromium journey pass;
live read-only staging status verifies dormant. The owner clarified that AWS access must be
sequential; staging need not remain signed in during development testing. D3 remains In progress.

2026-10-09: D3-086 adds manual approved-answer handoff and exact application return. Reproducible
local UI/background/CSP checks pass; actual unpacked focus/clipboard acceptance remains open.
No provider action or capability activation is claimed. See the linked batch evidence.

2026-10-09: D3-087 completes default-off observed-form selection/review and fresh form-confirmed
manual Apply source. Repository verification gates (resumed after documented repairs), 95 real
PostgreSQL cases and synthetic Chromium journeys pass. No provider effect or live acceptance is
claimed. D3-088 remains implementation work: preserve withdrawn-value refusal while allowing
owner-scoped reopening/repreparation/reconciliation. AWS access stays sequential; staging is
freshly dormant, development was last verified dormant at 18:40Z with no later mutation,
Docker/WSL are stopped and the PC stays on. D3 remains In progress; independent D1 acceptance stays deferred.


2026-10-09: D3-088 adds explicit metadata-only recovery after saved-answer withdrawal, retaining
private value refusal, immutable packets and existing attempt fences. Full repository verification,
72 real PostgreSQL cases and three synthetic Chromium journeys pass. Compatible release/live
acceptance remain; D3 is In progress and independent D1 acceptance stays deferred. Staging is
freshly dormant at 21:55Z; development was last verified dormant at 18:40Z with no subsequent
mutation. Docker/WSL are off and the PC stays on. [PR #615](https://github.com/Vrixic/project-ai-job-apply/pull/615) carries the verified batch; hosted CI is blocked by account billing/spending limits. See the linked recovery evidence.

2026-10-09: D3-089 repairs two release guard refusals found during owner-requested independent
review. All 41 repository verification stages, 687 focused guard checks and three fresh synthetic
Chromium journeys pass. No release, migration or live candidate acceptance occurred. Fresh
data-preserving development shutdown, physical restore, zero-drift plan and versioned recovery
archive pass; Docker/WSL are off and the PC stays on. D3 remains In progress; independent D1
acceptance stays deferred. [Evidence](evidence/d3-release-guard-recovery-2026-10-09.md).

2026-10-09: D3-090 fixes candidate hosting's omitted security patches and ATS SDK. All 42
repository stages, independent review, three synthetic Chromium journeys and the real Vercel
preview build pass. Live candidate/native/provider acceptance remains open; independent D1
and hosted admin acceptance stay deferred. [Evidence](evidence/d3-candidate-hosting-build-recovery-2026-10-09.md).

2026-10-09: D3-091 corrects restore selection after independent review traced the migration refusal
back to an earlier pre-transition snapshot restore. Focused guards, full source verification and
actual saved-plan regressions pass. Corrective SQL recovery and live acceptance remain open;
this is an internal recovery issue, not missing AWS access. Fresh development shutdown, physical
restore, zero-drift and versioned KMS archive pass; Docker/WSL are off and the PC remains on.
Independent D1/admin acceptance stays deferred. See the linked recovery correction.

2026-10-09: D3-092 repairs the stale restore manifest guard found before the corrective SQL
check and adds its omitted suite to full verification. Both PowerShell hosts, independent review
and all 43 repository stages pass. The isolated historical backup passes live read-only current
schema/checksum verification. Durable-data/privacy comparison and primary recovery remain;
independent D1/admin acceptance stays deferred. See the linked boundary recovery evidence.

2026-10-10: D3-093 adds strict read-only data comparison for recovery. All 43 repository stages,
93 unit tests, 96 restored relation digests and 21 real PostgreSQL probes pass, with independent
review. Managed comparison, transition reconciliation, privacy replay and primary recovery remain.
AWS test runtimes, Docker and WSL are verified off; the PC remains on. Independent D1/admin
acceptance stays deferred. See the linked comparison evidence.

2026-10-10: D3-093's diagnostic image is published from reviewed main, with matching clean builds,
zero High/Critical scan findings and independent registry/runtime verification. Only dormant task
revision 66 was registered; no task or database was started. State 506/current full inputs and the
original recovery warning are archived with exact-version KMS/hash readback. AWS test runtimes,
Docker and WSL are verified off; managed comparison and live acceptance remain unfinished.

2026-10-10: Both D3-093 isolated managed inventories and original task evidence pass independent
review. Strict comparison confirms 84 identical shared relations and 12 Applications differences;
transition-aware reconciliation, seven encrypted original-request proofs, privacy replay and live
acceptance remain. Both disposable restores are deleted and fresh development shutdown passes.
Docker/WSL are off; the PC remains on. Independent D1/admin acceptance stays deferred.

2026-10-10: D3-094 supplies the explicit transition reconciliation required by D3-093. Independent
source review, all 43 repository stages, 65 focused tests and the maintained PostgreSQL recovery harness pass, including
seven new probes. The actual read-only test exposed and fixed a locking Identity-check mismatch;
Identity now supplies a bounded snapshot check without a write lease. Managed KMS/reconciliation,
privacy replay, primary recovery and live acceptance remain open. Independent D1/admin acceptance
stays deferred. See the linked reconciliation evidence.

2026-10-10: D3-094 source merged in PR #623. Its two clean image builds match, the ECR scan
completes with zero High/Critical findings, and maintained/independent publication verification and
the packaged diagnostic smoke pass. No live KMS or managed reconciliation ran. Fresh development
shutdown and four-snapshot/state preservation checks pass; Docker/WSL are off and the PC is on.

2026-10-10: Added separate default-null, development-only timed decrypt-only diagnostic task
registration. Its image and permissions are isolated from the ordinary migration task and Gateway.
Independent source review, 22 Terraform cases, module/development/staging validation and all 43 repository stages pass. Operational activation, dual-restore execution and managed acceptance remain pending.

2026-10-10: The managed reconciliation preflight exposed an unnecessary replay-permission
restriction. Independent review supports preserving the retained Gateway release while requiring
runtime off. The correction passes 24 Terraform cases and 13 private canonical-boolean regressions;
all 43 repository stages pass; managed execution remains pending. See the
[dormant admission evidence](evidence/d3-native-application-disposal-2026-10-07.md#dormant-reconciliation-admission-correction--2026-10-10).

2026-10-10: D3-094 managed reconciliation passes on the original bounded task: 88 common
relations, eight added tables, twelve migrations and seven original receipts, using actual KMS.
Independent actual-task/log review passes. Neither privacy replay nor primary promotion is accepted.
The exact cleanup plan removes only the three diagnostic resources; both disposable restores are
absent and all four source snapshots remain encrypted/available. Fresh development shutdown,
state 508 recovery archival and zero-change/zero-drift baseline verification pass. Docker/WSL are
off and the PC stays on. Privacy replay inspection identified an omitted independent native
withdrawal root in reconciliation counts; its regression is the next internal batch. Independent
D1/admin acceptance remains deferred. See the
[managed result](evidence/d3-native-application-disposal-2026-10-07.md#managed-transition-reconciliation-and-cleanup--2026-10-10).

2026-10-10: D3-095 fixes a restored completed deletion being skipped when only native withdrawal
data remains. All fifteen Applications tables now participate in preflight/completion/post-delete
counts. Real PostgreSQL regressions verify withdrawal/cleanup/archive deletion, owner isolation
and idempotency; 234 focused tests, the maintained dump/restore harness and all 43 repository
stages pass. Managed privacy replay remains pending. Independent D1/admin acceptance stays
deferred. [Evidence](evidence/d3-privacy-replay-inventory-2026-10-10.md).

2026-10-10: D3-096 and D3-097 resolve live-runtime preflight dependencies in writer-off privacy
recovery and replay. D3-096 passes 98 focused cases in both PowerShell hosts and all 43 repository
stages. D3-097 passes 778 synthetic replay checks, 908 restore-role assertions and all 43 repository stages, recorded in its
[evidence](evidence/d3-dark-deletion-replay-2026-10-10.md). Managed replay/recovery and connected
acceptance remain separate. Independent D1/admin acceptance stays deferred.

2026-10-10: D3-098 starts after managed preflight exposed bootstrap-specific refresh observations
and null/empty Terraform input serialization failures. The obsolete bootstrap plan was never
applied. Source recovery binding readback passes; managed privacy acceptance is pending.
[Evidence](evidence/d3-bootstrap-recovery-inputs-2026-10-10.md).

2026-10-10: D3-098 repository implementation passes 1,015 restore-role assertions, 155 dark cases
in both PowerShell hosts, independent source review and all 43 repository stages. Read-only managed
dark Status passes. Managed replay, primary privacy recovery and connected acceptance remain pending;
development RDS shutdown remains mandatory before handoff. Hosted checks could not start due to
billing/spending limits. [Evidence](evidence/d3-bootstrap-recovery-inputs-2026-10-10.md).

2026-10-10: D3-099 adds transactional whole-row preservation around deletion replay. The real
PostgreSQL pass found and corrected the exact-marker pre-confirmation null-operation case.
348 focused tests and 790 operator assertions pass; final PostgreSQL verification, independent
review and full repository checks remain in progress. Promotion and connected acceptance remain
internal work. [Evidence](evidence/d3-replay-data-preservation-2026-10-10.md).

2026-10-10: D3-099 repository implementation is verified by 348 focused tests, 790 operator
assertions, 11 real PostgreSQL cases, independent review and all 43 repository stages. Simulated
connected Chromium acceptance also passes; live identity/provider/submission acceptance remains
open. Development is independently verified dormant with versioned recovery inputs; Docker/WSL
are off and the PC is on. [Evidence](evidence/d3-replay-data-preservation-2026-10-10.md).
