# Delivery Tracker

Last updated: 2026-10-22. Program status: In progress. Started: 2026-07-27. Completion: Not completed.

## Summary

| Delivery | Scope | Status | Start | Completion | Details |
|---|---|---|---|---|---|
| D0 | Product, data, and legal foundation | Complete | 2026-07-27 | 2026-08-12 | [Phase 0 tasks](phase-0-foundation.md) |
| D1 | Useful web product and canonical job catalog | Complete | 2026-08-11 | 2026-10-22 | [Phase 1 tasks](phase-1-web-and-job-catalog.md) |
| D2 | Extension and community loop | Complete | 2026-09-01 | 2026-09-18 | [Phase 2 tasks](phase-2-extension-and-community.md) |
| D3 | High-quality application preparation | In progress | 2026-09-18 | Not completed | [Phase 3 tasks](phase-3-application-preparation.md) |
| D3.1 | Structured candidate profile | In progress | 2026-10-22 | Not completed | [Phase 3.1 tasks](phase-3-1-structured-profile.md) |
| D3.2 | Live AI generation | Ready (not started) | Not started | Not completed | [Phase 3.2 tasks](phase-3-2-live-ai-generation.md) |
| D4 | Workday and remote preparation | In progress | 2026-10-22 | Not completed | [Phase 4 tasks](phase-4-workday-and-remote.md) |
| D5 | Personalized outreach and application notifications | In progress | 2026-10-22 | Not completed | [Phase 5 tasks](phase-5-outreach-and-notifications.md) |
| D6 | Mobile and paid launch | In progress | 2026-09-28 | Not completed | [Phase 6 tasks](phase-6-mobile-and-paid.md) |
| D7 | Quality optimization, expansion, and optional employer product | In progress | 2026-10-22 | Not completed | [Phase 7 tasks](phase-7-quality-and-expansion.md) |

## D1 — Useful web product and canonical job catalog

Authentication, canonical jobs, onboarding, search/saved jobs, moderation, entitlements and public-page source are implemented.
Completed 2026-10-22 by owner direction, in development only. D1-011 was removed (sources are user-contributed and vetted by an automated AI system, D7-012). Items needing AWS or production resources are carried to D6: maintenance-Lambda deployment and the ADR-023 DNS residual (D6-021), production and moderator identity (D6-014), public publication (D6-012).
[Implemented and remaining capabilities](phase-1-web-and-job-catalog.md).

## Owner decisions (2026-10-22)

The owner answered the open questions in chat. Recorded decisions:

- **Approved:** deploy D3.1 through the guarded operators (migrations 0012 to 0014, Gateway, web) and update the release tooling with it; the Stripe webhook route without the JWT authorizer plus the Stripe keys as secrets; the Notifications inbox, preferences and delivery state as a new schema (D5-001, D5-002); AI vetting of contributed sources (D7-012) with the model allowed to read contributed content and zero provider retention.
- **Product:** Pro costs $25 a month and allows 2 stored resumes (Free 1). The price is created in the owner's Stripe account.
- **Declined or removed:** saved answers for free-text questions (D3.1-013), the remote browser (D4-004 to D4-006; all filling runs in the candidate's own Chrome through the extension), and the mobile client (D6-001 to D6-004, D6-006, D6-009).
- **Greenhouse and Ashby:** both are to work fully, including the application submit step after the candidate's explicit approval.
- **Deferred:** Workday waits for authorized sanitized fixtures. ApplyDash stays the provisional product name.

2026-10-23 owner answers: D3.1 works in the hosted app; the development runtime was shut down again (final snapshot `shutdown-20261023032139`); Stripe waits until it is needed for testing; email and push notifications (D5-002) are to be built now, ahead of search and matching work ([ADR-056](../../adr/056-notification-email-and-push-delivery.md)).

2026-10-26 owner answers on closing D3: legal and security review is carried to D6-015 and D6-016; live AI generation (the main product feature) moves to the new [D3.2](phase-3-2-live-ai-generation.md) because no provider or account meets ADR-038's 30-minute retention yet, and D3 closes with live AI off; Greenhouse is the live submission proof and Ashby's moves to D3.2; one working session will run the live Greenhouse submission and the canonical export and deletion run. Email notifications (D5-002) were verified live the same day; the development runtime is dormant (final snapshot `shutdown-20261026144736`).

2026-11-07 owner direction: free-text employer questions get an AI-draft icon in the extension, using OpenAI `gpt-6-luna` with the Terms of Service as consent ([ADR-057](../../adr/057-narrative-answers-drafted-in-the-candidates-browser.md), D3.2-009). The Gateway route, grounding checks and kill switch are built and dark; the extension icon and the live test follow.

Still needing the owner: an AWS sign-in for the deployment, the Stripe account values (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRETS`, `STRIPE_PRO_PRICE_ID`, `BILLING_APP_BASE_URL`), counsel, the independent assessor, and staging and production accounts and Auth0 tenants (D6-013, D6-014, D6-021).

## D3 — High-quality application preparation

2026-10-22 owner direction (ADR-053, PRs #727 to #736): Greenhouse and Ashby fill, attach and submit once after the candidate's approval, in the candidate's own Chrome. Built and tested against synthetic pages (extension 781 tests and real-Chromium fixtures for both providers) and modeled on read-only inspection of public pages; nothing was run against a live employer, and the post-submit confirmation text of both providers was not observed, so the owner's first real application is the first live evidence. Sensitive questions stay with the candidate, a visible challenge stops the run, and the build enables providers only through `EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON`.

2026-10-22 also: D5-001 Notifications inbox built (ADR-055; not deployed, rights wiring open), D7-012 automated source vetting built (ADR-054; not deployed, kill switch off), Pro plan set to $25 a month and two stored resumes, release tooling pins updated for the D3.1 migrations.

2026-10-21 owner decision: all non-security testing, acceptance, evidence and friction work is
removed from every incomplete phase (D1, D3, D3.1, D4, D5, D6, D7). Hosted admin, accessibility,
load, restore-rehearsal, AI-evaluation, QA-representativeness and product acceptance no longer
gate any phase; D3.1-012 and D6-019 are Removed and D3.1 no longer waits for D3. Security,
privacy, legal and the ADR-015 independent assessment remain, as do AWS shutdown before handoff
and the product-scope rules. See each phase document's exit criteria and decision log.

2026-10-22 owner decision: privacy reviews and approvals are removed from all phases (D3.1-002 is
Removed; privacy dropped from the D1, D3, D4, D5, D6 and D7 review gates). Security review, legal
review, counsel and the ADR-015 independent assessment remain; privacy controls already built in
code (deletion, export, expiry) stay as engineering. D0 and D2 records are unchanged.

2026-10-21: D3-152 and D3-153 ([ADR-051](../../adr/051-style-preserving-generated-resume.md)): the web preview is the
rendered PDF with a User_Job_Name_ID file name (merged, #705), and generated PDFs are redrawn in the
style of the candidate's own resume with whole wrapped bullets reordered or trimmed (local source and
tests only; needs a parser and a governed native image release, then live acceptance). D3 stays In
progress. [Evidence](evidence/d3-style-preserving-resume-2026-10-21.md).

2026-10-20: D3-147 to D3-151 ([ADR-050](../../adr/050-generate-then-apply-flow.md)) implement and
locally test the Generate-or-Apply flow: BFF material reads without a popup sign-in, server-derived
generation states with retry, Apply as the approval act, PDF-only generated resumes, and an
uploaded-resume fallback with extension arming. Nothing is deployed or accepted; release order,
a governed native image, live acceptance and security review remain. D3 stays In progress.
[Evidence](evidence/d3-generate-then-apply-flow-2026-10-20.md).

2026-10-17: D3-139 to D3-146 (PRs #687-#694)
fix eight defects found in installed Chrome and hosted testing (boundary size, empty KMS context,
Ashby/Lever form pages, challenge pages, job no-store, radio labels, native digest handoff, clock skew).
Installed Chrome passed capture, saved-answer selection, approved handoff, correction, withdrawal, reuse
and a truthful not-submitted outcome on a synthetic account; Edge, expiry, Greenhouse and live AI were not
run. The document-inclusive rights run still has no success receipt: the confirmed deletion completed
(marker, buckets, queues) but the operator failed at an unidentified step and Auth0 deletion is
unverified. Development is shut down and verified. D3 stays In progress. [Evidence](evidence/d3-installed-extension-and-rights-2026-10-17.md).

D3-133/134's focused harness and resume no-store fixes pass; Gateway 117/source `a45c456c` is
released and verified. D3-135 ([PR #682](https://github.com/Vrixic/project-ai-job-apply/pull/682))
preserves the original identity/MFA lease across access refresh. D3-136
([PR #684](https://github.com/Vrixic/project-ai-job-apply/pull/684)) repairs the scoped export-version
inventory and document bulk-delete grants. Targeted checks, consequential review, both reviewed
IAM applies and actual policy readback pass. Hosted CI executed zero steps because of billing.

One continuation of the already-confirmed deletion completed all eight owners through unchanged
Profile activity 25. SQL, document/export version absence, the original completed marker and
unchanged retention are verified. Three original failure notices were archived and individually
acknowledged; all thirteen queues and temporary authority are clear. The original canonical
17-step run remains FAILED without a success receipt; full rights and expiry acceptance remain open.
Development shutdown, credential rotation, the fresh zero-change plan and encrypted recovery-input
archive pass. D3 remains In progress behind clean rights, installed-extension, AI retention,
authorized Greenhouse QA and accountable acceptance gates. Live AI and employer submission stay
off; independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-137 refreshes the [engineering approval packet](../../security/d3-application-approval-packet.md)
against the dated native and rights evidence. Remaining tests/fixes are agent work after their
access/authority prerequisites; accountable approvals remain human decisions. This documentation
refresh changes no disposition, activation gate or exit criterion; D3 stays In progress.
D3-138 repairs the known document-intake mock's stale scope expectation; the isolated actual
run fails before and passes after, with scoped formatting passing and no production-policy change.
Production generation-quiescence proof remains unfinished engineering and continues to fail closed.

Historical 2026-10-13 checkpoint:

D3-126–132 are merged. Hosted synthetic vault deletion/reload and the current native preparation,
separate sign-in, review, approval, PDF/DOCX and truthful not-submitted/cancellation journey pass.
The old resume's source/normalized copies are absent. Profile activity 25/source `cc464385` release
and ordinary UI export download/schema/latest-vault comparison pass. Three failed export notices
are archived and individually acknowledged; all thirteen queues were empty on readback. Capacity
checks, sixteen published native artifacts and paused version 15 binding readback pass. Legacy
claim settlement and managed migration 0018 now pass exact live readback: the migration task stopped
with exit 0/all seven owners verified, and one original claim is `launch_rejected` with its missing
request digest preserved and original head sealed. Temporary owner functions are absent. Normal
source-purge maintenance, both scanner stages, pre-test zero-change plan and read-only D3 ResumeFixture
Status pass. The rights session expired before identity confirmation, Plan, Execute or fixture
creation; account deletion has not started. The earlier UI export was already absent before the
planned deletion test. Live account cleanup remains untested. Development shutdown and encrypted
144-field input archival pass; the fresh final plan has zero managed-resource/output changes and
required no apply. Hosted Actions could not start
because of account billing. Live AI stays off; authorized ATS QA/fixtures, installed-extension
and accountable acceptance remain open. Independent D1/admin acceptance is
deferred. [Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-124 started 2026-10-12: the in-memory rights session now supports explicit fixed D3 policy
selection and exact Applications coverage while preserving D2 defaults, token memory boundaries
and OAuth scopes. All 67 focused session tests, formatting checks and consequential source
review pass. Dark restore/replay and managed configuration checks pass; the authenticated rights
fixture remains pending. The managed checkpoint records the latest shutdown and remaining tests.

D3-122/123 implement guarded saved-answer reuse release wiring and exact D3 Applications rights
test coverage. Targeted local checks and source review pass; agent-owned managed verification
is continuing before human acceptance. [Evidence](evidence/d3-independent-release-guards-2026-10-12.md).

D3-115–120 are merged. Managed development testing on Gateway 108/native preparation 9 passed
synthetic search, preparation, separate in-memory sign-in, exact preview/review, approval and
PDF/DOCX downloads. The manual Apply UI and truthful not-submitted reconciliation passed;
refreshed Applied history showed no confirmed applications. Employer submission was not performed.
D3-121 adds bounded read-only observation after ambiguous cancellation; 61 workspace tests,
web typecheck, focused checks/review and the simulated connected journey pass. Live retest remains.
Live AI stays off without the required 30-minute all-copy provider policy. Authorized ATS QA/fixtures,
installed-extension and accountable acceptance remain open. Independent D1/admin acceptance is deferred.
Development shutdown was freshly verified at 2026-10-12T19:02:04Z; encrypted backups and recovery inputs are retained.
[Current evidence](evidence/d3-native-connected-journey-2026-10-12.md).

D3-106 handles standard S3 URL encoding and authenticates retired deletion markers without skipping
their deletion authority. 257 focused tests, managed primary replay and consequential review pass.
Both subjects were already reconciled; no new deletion occurred. Live native/provider acceptance
remains. [Evidence](evidence/d3-retired-deletion-markers-2026-10-10.md).

D3-105 fixes backup-status/endpoint-tag observations found during managed primary recovery and adds
explicit primary replay permission cleanup. Restoration and its encrypted safety backup are complete;
primary basic safety/live writer checks and completed-deletion replay pass without the isolated
drift-proof sweep. Live acceptance remains. [Evidence](evidence/d3-primary-recovery-operational-guards-2026-10-10.md).

D3-104 adds explicit writer-off primary deletion replay, preserving isolated defaults and basic backup/deletion safeguards. 466 focused tests, 816 operator assertions, 17 PostgreSQL cases, component typecheck/build, packaged refusal and simulated connected journey pass. Managed primary restore/replay passes under D3-106; compatible release and live acceptance remain. [Evidence](evidence/d3-primary-deletion-recovery-2026-10-10.md).

D3-103 removes formal recovery-proof gates, preserving backups and deletion safeguards. 337 focused tests, 34 lifecycle assertions, component typecheck, 16 PostgreSQL cases and the simulated connected journey pass; consequential review passes. [Evidence](evidence/d3-recovery-safeguards-simplification-2026-10-10.md).

Owner revision (2026-10-10): formal database recovery-proof gates are removed. Retain encrypted
backups, exact-target and completed-deletion safeguards. Use targeted changed-component tests,
typechecks and connected-journey verification; no full-repository check requirement. Review only
consequential changes. Independent D1/admin acceptance remains deferred. Historical verification
records below describe checks already executed, not current delivery gates.

D3-102 completes repository runtime implementation with fresh admission and document continuity.
207 focused tests, packaged default-off refusal, all 43 repository stages and the simulated browser
journey pass. Managed restoration with completed-deletion reconciliation and live acceptance
remain internal work; independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-reconciled-copy-runtime-2026-10-10.md).

D3-099 transactional replay preservation passes 348 focused tests, 790 operator assertions,
11 real PostgreSQL regressions, independent review and all 43 repository stages. The simulated
connected browser journey passes; development, Docker and WSL are off with recovery data retained.
Dedicated primary promotion, managed replay and live connected acceptance remain internal work.
[Evidence](evidence/d3-replay-data-preservation-2026-10-10.md).

D3-100 complete independent recovery roots, cover-letter namespace absence and separate read-only
reconciled-copy verification pass 500 focused tests, 17 real PostgreSQL regressions and all 43
repository stages and independent final review; PR #633 is merged. Greenhouse execution, private runtime/promotion
wiring and managed/live acceptance remain unfinished. No cloud activation occurred in this batch;
the subsequent D3-101 readback verifies development off after successful SSO renewal.
[Evidence](evidence/d3-reconciled-copy-verification-2026-10-10.md).

D3-101 connects bounded Greenhouse inspection, approved native transfer, attachment, one-shot
write-ahead dispatch and strict attempt-bound confirmation/result/history. All 43 repository
stages pass, including 680 extension and 912 web tests; 23 synthetic execution browser cases and
the simulated manual candidate journey pass. Production profiles remain empty/default-off.
Installed/native/provider acceptance and managed recovery/publication remain incomplete.
Fresh independently reviewed development readback and the 143-input baseline verify off/no drift.
[Evidence](evidence/d3-greenhouse-bridge-implementation-2026-10-10.md).

Grounded preparation, packets/review, safe manual Apply, submission-safety controls and native runtime/test tooling are implemented.
The 2026-10-09 browser safety batch passes a simulated connected search-to-confirmed-history journey;
cover-letter opt-in/status/cancellation UI is locally tested behind a separate default-off flag.
Provider-neutral form plans reject conflicting claims/duplicate options and leave restricted answers and challenges to candidate action.
The owner-selected separate in-memory Auth0 PKCE path now supplies default-off native resume/cover-letter previews and approved PDF/DOCX downloads with local regression and synthetic Chromium evidence.
The owner-approved separate SPA registration is configured and its saved grant/origin settings are inspected; live sign-in/native acceptance remains unverified. D3-086 adds default-off manual extension handoff with passing local regression/CSP/browser and full repository verification; focused installed acceptance remains open. D3-087 adds locally verified observed-form saved-answer selection and fresh form-confirmed manual Apply; repository checks, 95 PostgreSQL cases and synthetic Chromium journeys pass. Withdrawn-answer recovery (D3-088) is implemented and locally verified: full repository checks, 72 real PostgreSQL cases and three synthetic Chromium journeys pass. Compatible live release and provider adapter source remain. [Recovery evidence](evidence/d3-withdrawn-answer-recovery-2026-10-09.md). [Selection evidence](evidence/d3-observed-form-saved-answer-selection-2026-10-09.md). [Handoff evidence](evidence/d3-manual-extension-handoff-2026-10-09.md).
Connected native/provider acceptance, ATS adapters/fixtures, all-copy expiry, rights/restore and accountable reviews remain.
An owner-requested independent reviewer verified the current publications, restore bindings and baseline.
The managed Gateway plan was refused before deployment; D3-089 repairs boolean comparison and
deferred native identity-read handling. All 41 repository verification stages, focused regressions
and three fresh synthetic Chromium journeys pass, with independent source review.
[Release review evidence](evidence/d3-release-guard-recovery-2026-10-09.md).
D3-091 adds verified restore-selection guards after an earlier pre-transition backup restore.
D3-092 fixes the stale restore-verifier boundary; all 43 repository stages and independent review
pass. The isolated historical backup passes live read-only schema/checksum verification.
Durable-data/privacy reconciliation and compatible live release remain internal work.
D3-093 implements bounded whole-row comparison with 93 unit tests, all 96 restored relation
digests and 21 real PostgreSQL probes passing. Its current immutable image is published, scanned
and independently verified. Both isolated managed inventories and their original tasks pass independent
review: 84 of 88 shared relations match exactly, including all 80 relations of the other six owners.
All twelve Applications differences now pass managed read-only transition reconciliation, including
seven original-request hashes through actual KMS. Privacy replay and primary recovery remain; no promotion or privacy acceptance is claimed.
D3-094 adds explicit read-only transition reconciliation: all 43 repository stages, independent review, 65 focused tests and
seven real PostgreSQL reconciliation probes pass with simulated KMS. Its new immutable image is published, scanned and independently verified;
separate timed decrypt-only authority passes 24 Terraform cases and all 43 repository stages. The original managed task passes independent result review; its authority and both restores are removed. Privacy replay, primary recovery and the live journey remain open.
[Reconciliation evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-transition-reconciliation--2026-10-10).
[Comparison evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-data-comparison--2026-10-10).
[Recovery evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-verifier-boundary-recovery--2026-10-09).
The D3-012 engineering review packet now links current evidence; existing development dispositions remain unchanged.
D3-090 repairs missing candidate hosting build inputs; all 42 repository checks, independent review,
three synthetic Chromium journeys and the actual Vercel preview build pass. Live acceptance remains
open. [Hosting evidence](evidence/d3-candidate-hosting-build-recovery-2026-10-09.md).
[Implemented and remaining capabilities](phase-3-application-preparation.md).

## D0 — Product, data, and legal foundation

[Phase 0 tasks](phase-0-foundation.md).

## D2 — Extension and community loop

[Phase 2 tasks](phase-2-extension-and-community.md).

## D3.1 - Structured candidate profile

2026-10-22: D3.1 started. D3.1-001 is complete: [ADR-052](../../adr/052-structured-candidate-profile.md)
is accepted (structured Profile sections, draft-then-save resume import, entry references for
grounding, existing development facts discarded, restricted answers kept out) with a consumer map.
D3.1-003 is complete: the Profile section, answer and import-draft contracts are added (additive, version 1) with generated clients and tests. D3.1-004 slice 1 is implemented: migration 0012 and the Profile section store are tested on real PostgreSQL. D3.1-004 is complete: persistence, Gateway routes and export and deletion coverage are tested locally. D3.1-005 (exact-key answer matching) and D3.1-006 (resume import as drafts) are done in source. D3.1-007 to D3.1-010 are done in source: the web Profile area, grounding and packets on saved entries, and the retirement of the fact model (migrations 0012 to 0014). Open: D3.1-011 deployment, which needs the owner's AWS authorization, and the newly found D3.1-013 (free-text answer reuse). Nothing is deployed.
2026-10-22: D3.1-011 deployment through the guarded operators is complete (final candidate-rights activity release from 079eefc6; notes below were written mid-deployment from 58e7d488): migration image published and verified (zero High/Critical), document Lambdas published, Profile migrations 0012 to 0014 executed and verified, and the Gateway, document parser and document processor released (Gateway 126, parser 10, processor 16; code hashes match the receipts, hosted readiness 200). The post-apply boundary verifier expected reserved concurrency 2 while the reviewed ceiling is 5; it now expects 5, and the gateway verification-only allowlist includes it.
2026-10-22: D3.1-011: the retained isolated-recovery reconciled-copy runtime imported the advancing live restore manifest while pinned to the 2026-10-08 one, which failed the workflow test gate; it now uses the retained, hash-checked copy (same as the Applications transition diagnostic).
[Phase 3.1 tasks](phase-3-1-structured-profile.md).

## D4 — Workday and remote preparation

[Phase 4 tasks](phase-4-workday-and-remote.md).

## D5 — Personalized outreach and application notifications

[Phase 5 tasks](phase-5-outreach-and-notifications.md).

## D6 — Mobile and paid launch

[Phase 6 tasks](phase-6-mobile-and-paid.md).

## D7 — Quality optimization, expansion, and optional employer product

[Phase 7 tasks](phase-7-quality-and-expansion.md).

## Current operating state

2026-10-17: development shutdown is verified (database, NAT, EIP, interface endpoints, routes, rules,
mappings, tasks and queues all zero; Docker/WSL off; PC on). Final snapshot
`ai-job-apply-development-shutdown-20261017204046` and its safety snapshot are available/encrypted with
retained automated backups; the 144 dormant inputs are archived encrypted and the final plan has zero
changes. For a future restore, create NEW inputs selecting that snapshot for BOTH final and restore
selectors. Staging was not accessed. [Evidence](evidence/d3-installed-extension-and-rights-2026-10-17.md).

2026-10-14: development shutdown is verified at `23:37:37Z`. Database, NAT, EIP and paid Interface
endpoint counts are zero; API routes, enabled triggers/consumers, ECS/durable work and all thirteen
queues are drained. All temporary functions/versions/roles and restore-role uses are absent.
Docker/WSL and owned PostgreSQL/rights listeners are off; the preserved fixture and unrelated
system PostgreSQL service are untouched, and the PC remains on.

New final snapshot `ai-job-apply-development-shutdown-20261014224151` and its `-safety` snapshot
are available/encrypted from the exact database. Automated backups are retained; their 35-day
configuration was verified before deletion. All 144 dormant inputs have encrypted exact-version,
checksum and length archival. The exposed development database credential was rotated after
database removal; current-secret metadata matches Terraform state. Historical encrypted snapshots
and state versions were preserved. The post-rotation plan has zero resource/data/output changes
and all 177 checks pass; no apply was needed.

For a future restore, create NEW inputs selecting `ai-job-apply-development-shutdown-20261014224151`
for BOTH final and restore snapshot selectors. Preserve archived bytes; the dormant archive keeps
the historical `20261013213003` restore selector used while the database was live.
Staging was untouched; its last verified-off observation remains October 11. Retained backups,
S3/ECR, KMS, secrets, DNS, logs and security/monitoring resources incur charges.
[Current evidence](evidence/d3-rights-readiness-2026-10-14.md).

The entries below are historical checkpoints.

2026-10-13 owner-local checkpoint (2026-10-14 UTC): development shutdown is verified at 02:05:48Z.
Project databases, NATs, paid Interface endpoints and EIPs are absent; writers/queues are drained.
Temporary replay, legacy and inspection functions and restore roles are absent. The exact
database's final and safety snapshots are available/encrypted. All 144 current dormant inputs are
archived with encrypted exact-version/checksum readback. The fresh final dormant plan has zero
managed-resource/output changes; no apply was performed. Docker/WSL and the owned PostgreSQL
fixture are off; the PC remains on. Optional
recursive fixture deletion was blocked by automatic approval and the fixture files are preserved.
The rights session expired unstarted; account deletion still requires a fresh live run. Staging was
unchanged; its last verified-off observation remains 2026-10-11. Retained backups, S3/ECR, KMS,
secrets and security/monitoring resources incur charges.
[Current evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

The entries below are historical checkpoints.

2026-10-12: [Current native journey and cancellation evidence](evidence/d3-native-connected-journey-2026-10-12.md)
records managed synthetic review/approval/download success and targeted cancellation verification.
Development shutdown was freshly verified at 2026-10-12T19:02:04Z; encrypted backups and recovery inputs are retained.
Docker/WSL are off and the PC stays on. Staging was last verified off on 2026-10-11 and was unchanged.
Independent D1/admin acceptance stays deferred.

The entries below are historical checkpoints.

2026-10-11: [D3-112](evidence/d3-primary-manifest-fingerprint-2026-10-11.md) corrects the primary
deletion check's stale manifest fingerprint with targeted regressions. Migration 0017 and paused
Gateway/cleanup deployment pass; candidate traffic stays off pending basic replay and native testing.
Development shutdown remains required before handoff. Docker/WSL are off; independent D1/admin
acceptance stays deferred.

2026-10-11: [D3-111](evidence/d3-retained-native-deployment-policy-2026-10-11.md) fixes the retained-r2
deployment policy size limit with unchanged authorization and 25 bootstrap test runs. Enabled worker
and migration images/scans and compatible Gateway/cleanup publication pass. Development is temporarily
restored with writers off for testing; shutdown remains required before handoff. Docker/WSL are off;
the PC stays on. D3 live acceptance remains open; independent D1/admin acceptance stays deferred.
The entries below are historical checkpoints.

2026-10-11: See [D3-108 live-test and shutdown evidence](evidence/d3-native-live-admission-fixes-2026-10-11.md).
Candidate sign-in is complete; full live generation/submission acceptance remains open.
[D3-109](evidence/d3-native-launch-rejection-2026-10-11.md) adds locally verified definitive launch-rejection settlement. Corrected local worker/migration smoke and six immutable native Lambda publications pass; revision-2 RPCs are staged disabled. Historical claims and live acceptance remain unresolved. Docker is repaired again; remaining image publication resumes.
Development shutdown is freshly verified at 2026-10-11T18:49:53Z; staging was verified dormant at 2026-10-11T18:01:49Z and was not changed. Docker/WSL were verified off after that batch. The owner repaired Docker again; it is active for the next publication batch. The PC remains on.
[D3-110](evidence/d3-native-download-approval-expiry-2026-10-11.md) closes stale approved-download expiry with 52 focused tests, web typecheck, the simulated connected Chromium journey and consequential review. Hosted/live acceptance remains.
The records below describe earlier sessions.

Work continues for D3 on 2026-10-10; D1/D3 are not complete. Independent D1 acceptance remains deferred.
AWS access is sequential per the owner. Staging retains its 2026-10-09 dormant verification, with
no subsequent mutation. Development shutdown was verified at 2026-10-10T15:48:59Z, state 506:
the primary and both previous diagnostic restores were absent; paid network runtimes, application routes,
triggers, ECS/durable work and queued messages are off. Both retained backups pass isolated
read-only data inventory. Strict comparison finds 84 identical shared relations and 12 Applications
differences; transition-aware row/default/ledger accounting and seven encrypted original-request
proofs remain internal work before privacy replay and corrective primary recovery. All four encrypted
source snapshots and the exact-version state-506 recovery archive remain retained. The follow-up
plan has no resource/output actions and one task-tags refresh difference; strict zero drift is not
claimed. No Gateway release or live native acceptance occurred. Retained storage/security/artifact
resources incur charges.
Docker/WSL are off; the PC remains on.
[Current recovery and shutdown evidence](evidence/d3-native-application-disposal-2026-10-07.md#managed-snapshot-data-comparison--2026-10-10).

Current batch: managed reconciliation passes for all seven original receipts. The task stopped;
its temporary task/role/policy and both disposable restores are removed. Fresh development
shutdown at `2026-10-10T18:47:12Z` verifies test runtimes off; all four encrypted source snapshots
are preserved. Recovery state 508 and its manifest have exact-version KMS/hash readback, with
zero baseline resource/output changes or drift and unchanged 142 inputs. Docker/WSL are off;
the PC stays on. Retained storage/security resources incur charges; staging was not accessed.
Privacy replay coverage now includes all fifteen Applications tables, with eight real PostgreSQL
cases, 234 focused tests, the maintained 96-relation recovery harness and all 43 repository stages
passing. Managed privacy replay remains pending before recovery/live release.
[Privacy replay inventory evidence](evidence/d3-privacy-replay-inventory-2026-10-10.md).
Independent D1/admin acceptance remains deferred.
[Managed reconciliation evidence](evidence/d3-native-application-disposal-2026-10-07.md#managed-transition-reconciliation-and-cleanup--2026-10-10).

D3-096 adds a default-off development-only quiescent PITR path; 98 focused synthetic safety
cases and all 43 repository stages pass. Managed source/privacy recovery remains pending.
[Quiescent recovery evidence](evidence/d3-dark-privacy-recovery-2026-10-10.md).

D3-097 adds matching default-off writer-off replay preflight, exact mode/context and recovery-file
bindings. All 778 synthetic replay checks, 908 restore-role assertions and all 43 repository stages pass; managed replay
remains pending. [Replay evidence](evidence/d3-dark-deletion-replay-2026-10-10.md).

D3-098 repository implementation is verified: bounded bootstrap observations and typed recovery
inputs pass focused checks, independent review and all 43 repository stages. Managed replay remains pending.
[Recovery input evidence](evidence/d3-bootstrap-recovery-inputs-2026-10-10.md).

## Cross-delivery decisions and changes

2026-10-21: Non-security testing and acceptance work removed from all incomplete phases; D3.1 may
start before D3 completes. The `AGENTS.md` testing section and the `govern-delivery` skill now
reflect this.

Applications history belongs to D3, the generic inbox to D5, and structured Profile replacement to D3.1. D1 was completed 2026-10-22 with its deployment items carried to D6.
CI/CD work is deferred until production launch; independent launch security review remains required by ADR-015.
Real-candidate data and capability activation require their recorded authority; local tests do not establish production approval.

Historical work logs and decisions remain in Git history, phase documents, ADRs and linked evidence.
