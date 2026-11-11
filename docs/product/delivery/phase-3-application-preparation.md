# D3 — High-Quality Application Preparation

2026-10-26 owner decisions on closing D3: (1) the accountable legal and security review is carried to D6-015 (independent assessment) and D6-016 (counsel review), as D1's was, so D3 closes on its engineering criteria. (2) Live AI generation is the product's main feature but cannot meet ADR-038's 30-minute all-copy retention with any provider or account the owner has today, so it moves to the new [D3.2 Live AI generation](phase-3-2-live-ai-generation.md); D3 closes with live AI off and deterministic tailoring. (3) Greenhouse is the live submission proof for D3; Ashby's live submission proof moves to D3.2. (4) One working session with the owner will run the live Greenhouse submission and the canonical export and deletion run (the D4 nine-owner policy) with a disposable MFA user; before it, the failing step of the 2026-10-17 run is diagnosed and fixed locally. D3 stays In progress until that session passes.

2026-11-10: D3-155 "What changed" view for the generated resume (owner request): the generated-resume panel has a
"See what changed" button that reads the candidate's own uploaded PDF (the existing owner-only
`GET /v1/applications/{id}/resume/uploaded` through a new BFF operation, checked against its digest) and shows it
beside the tailored PDF. Both files are read in the browser only: PDF.js text lines are matched in order
(`web/lib/resume-diff.ts`) into kept, changed (with the words that changed), removed and added lines, drawn
as boxes over each page and listed as text, so nothing depends on colour. Today's tailoring only removes and
reorders existing lines, so "changed" and "added" appear when rewriting does. No contract change.
The original is fetched once per application packet: it is verified, then held in page memory only
(`web/lib/uploaded-resume-cache.ts`, one file, keyed by application and packet hash), so hiding and showing the
comparison, or the panel coming back, makes no further request. It is zeroed when the packet changes, the page is
left or the candidate signs out.
Found live on dev (2026-11-10): the button ended in a 409 for every generated resume, because
`/resume/uploaded` serves the original only while the packet is bound to it (`packetUsesUploadedResume`), which a
generated packet is not; the extension's attach flow relies on that refusal, so it stays. The unit tests had mocked
a 200 and could not see it. The button was hidden (#824) until the fix: a new owner-only
`GET /v1/applications/{id}/resume/original` serves the original of the document the generation was made from.
The Applications service refuses it unless the packet carries a current generated resume (the opposite guard of
`/resume/uploaded`), and the Documents processor's `generation_file` mode resolves the document from the
generation ledger (`base_document_id`, `base_version` and `base_sha256` checked), so the caller names no
document. The web client reads this route; the unit tests now run the real service guard on a generated-resume
packet and check the Gateway client's request against the processor's own parser. Release order: the Documents
processor, then the Gateway (same `UPLOADED_RESUME_ATTACHMENT_ENABLED` flag, no new Terraform). Released and
verified live on dev the same night (one original read per packet, none on hide and show or on reopening).
Owner feedback after that check (2026-11-10): the inline view was too small, and a reorder is not a change the
candidate cares about. The comparison is now a side panel (`web/app/resume-compare-sheet.tsx`) that slides in from
the right over the whole height of the window, up to 1680 px wide, with two pages side by side (stacked on a
narrow window); it is a modal dialog (focus kept inside, Escape, Close or a click beside it closes it, the page
behind does not scroll, no animation under reduced motion). It opens by itself once per mount as soon as the
generated resume is on screen, so after generation and on coming back to an application that already has one,
and "See what changed" opens it again. When it cannot open on its own (the original is not a PDF, or the read
is refused) it stays quiet; the button then explains. "Moved" is gone: a line whose text only changed place is
kept (`diffResumeLines`), so the counts, legend, boxes and lists show only removed, changed and added.
Size: the web proxy's default 512 KB response cap would have refused the comparison for an original above about
380 KB, though the contract allows 2 MiB (2,796,212 base64 characters). The two original-resume operations now
carry their own 3 MiB cap (`maximumResponseBytes`); every other operation keeps 512 KB, and a body past 3 MiB is
still refused.

2026-11-07: D3-154 edit the candidate's own PDF in place ([ADR-058](../../adr/058-edit-the-candidates-own-pdf-in-place.md)):
the owner asked that the generated PDF never change the look of their own PDF. For single-flow Word-style
PDFs the page content stream is edited (dropped and moved text blocks, rules and links with their line, text
written in the new reading order) and written as a new whitelisted file, verified by re-parsing, with the
ADR-051 redraw as the fallback. Reading zones (columns, sidebars) and clip wrappers are handled too, so all
four of the owner's resumes edit in place locally; the original is passed to the native process only
through the source RPC, bound to the document's hash, and the source reader is off by default. The owner approved the
source-read IAM entry (`quarantine/*/source`) on 2026-11-07; it is a flagged Terraform change, off by default.
Released to development 2026-11-08 (#810 to #813): native resume r3 live (r1 retired, r2 stopped), parser v11 and
processor v17 from one receipt, Gateway v148, all verified with zero drift. Remaining: the owner uploads the resumes
again (zones are recorded at parse time) and a live test; the image's Alpine `zlib` and `musl` findings have no fix yet.

2026-10-21: D3-152 web preview as the rendered PDF with a User_Job_Name_ID download and attachment name
(merged, #705); D3-153 style-preserving generation ([ADR-051](../../adr/051-style-preserving-generated-resume.md);
[evidence](evidence/d3-style-preserving-resume-2026-10-21.md)): PDF layout capture in the parser, wrapped
bullets kept whole, standard-font redraw of the source lines. Local source and tests only; parser and
native image releases, re-upload of existing resumes and live acceptance remain.

2026-10-20: D3-147 to D3-151 reshape the candidate flow to Generate-or-Apply
([ADR-050](../../adr/050-generate-then-apply-flow.md); [evidence](evidence/d3-generate-then-apply-flow-2026-10-20.md)). Implemented and locally
tested: BFF material reads with no popup sign-in, honest generation states with retry, Apply as the
approval act (server hash binding unchanged), PDF-only generated resumes, an uploaded-resume
fallback and extension arming. Not accepted: nothing is deployed, the native image still predates
#701, and live token, installed-extension and security reviews remain open. D3 stays
In progress.

2026-10-17: installed-Chrome and hosted testing found and fixed eight defects (D3-139 to D3-146, below);
see [evidence](evidence/d3-installed-extension-and-rights-2026-10-17.md). Capture, saved-answer selection, approved handoff, correction, withdrawal, reuse
and a not-submitted outcome passed on a synthetic account. The canonical rights run is still FAILED/open
(confirmed deletion completed, operator failed at an unidentified step, Auth0 deletion unverified).
Development is shut down and verified. Live AI, authorized Greenhouse, Edge/expiry checks and
accountable acceptance remain open.

2026-10-14: Gateway 117's no-store correction and PR #682's original identity/MFA lease fix are
verified. PR #684's scoped IAM repair is applied and independently verified. One continuation of
the already-confirmed deletion completed all eight owners through unchanged Profile activity 25.
SQL, original document/export version absence and the same completed marker with unchanged
retention are verified. All three original failure notices were archived and individually
acknowledged, followed by thirteen empty queues and temporary-authority absence. Recovery reused
the persisted confirmation; it required no new candidate request or Execute. The canonical
17-step run remains FAILED without a success receipt; full rights and expiry acceptance remain open.

Development shutdown, credential rotation and encrypted 144-field input archival pass. The fresh
post-rotation plan has zero resource/data/output changes and all 177 checks pass with no apply.
Docker/WSL and owned local runtimes are off; the PC remains on. D3 stays In progress. AI retention,
authorized Greenhouse fixtures/exact-variant authority, installed-extension and accountable
acceptance remain open. Live AI and employer submission stay off; independent D1/admin acceptance
stays deferred. Formal recovery-proof gates stay removed; encrypted backups, exact targets and
completed-deletion safeguards remain required.
[Current evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-115–120 are merged. Managed development testing on Gateway 108/native preparation 9 passed
synthetic search, preparation, separate in-memory sign-in, exact preview/review, approval and
PDF/DOCX downloads. The manual Apply UI and truthful not-submitted reconciliation passed;
refreshed Applied history showed no confirmed applications. Employer submission was not performed.
D3-121 adds bounded read-only observation after ambiguous cancellation; 61 workspace tests,
web typecheck, focused checks/review and the simulated connected journey pass. Live retest remains.
Live AI stays off without the required 30-minute all-copy provider policy. Authorized ATS QA/fixtures,
installed-extension and accountable acceptance remain open. Independent D1/admin acceptance is deferred.
The earlier session's shutdown passed at 2026-10-12T19:02:04Z; see the managed checkpoint for the latest session.
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

Owner revision (2026-10-10): formal recovery-proof gates and full-repository check requirements
are removed. Keep backups, migration/target checks, transactional completed-deletion safeguards,
truthfulness, sensitive-answer review, submission safety and material expiry. Verify changed
components and the connected journey. Historical proof records remain historical; optional
reconciled-copy operators and physical restore rehearsals are not D3 dependencies. Independent
D1/admin acceptance stays deferred.

Status: In progress. Started: 2026-09-18. Completion: Not completed. Updated: 2026-10-21.

## Task register

2026-10-22 (owner direction: Greenhouse and Ashby work fully, [ADR-053](../../adr/053-candidate-approved-submission-greenhouse-and-ashby.md)): D3-154 decision and design (this ADR); D3-155 late-bound form for packets with no form binding (Applications binding resolver); D3-156 provider-neutral execution modules in the extension; D3-157 page fit on real boards (invisible reCAPTCHA is not a challenge, custom comboboxes and their hidden shims, candidate-completed controls; merged in the D3-157 PR); D3-160 Greenhouse post-submit confirmation and reviewed profile (a board moves to its `/confirmation` page, which the executor now allows only after the one click, and a message heading must match; no reference is required); D3-158 Ashby inspection, fill, attach and submit (a provider module for pages with no form element: field-entry blocks, Yes/No buttons, a sibling submit button, in-place confirmation; a full name is composed from the approved first and last name); D3-159 enable both providers in the execution build (`EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON`; kill switches stay off without it; evidence is bound to the adapter version and source hash and expires after 90 days). D3-154 (#727), D3-155 (#728), D3-156 (#729) and D3-157 (#730) and D3-160 (#731) and D3-158 (#732) and D3-159 are merged or in review; each lands as its own PR with synthetic-page tests; nothing is run against a live employer by me, and the confirmation markers need the owner's first real run.

D3-147 to D3-151 started and implemented 2026-10-20 on one branch (local source and tests only; no
deployment, no paid runtime): D3-147 replace the popup material sign-in with authenticated BFF reads
(ADR-044 superseded); D3-148 server-derived `resumeGeneration` state with loading, failed-with-retry
and expired states in place of the manual check button; D3-149 Apply as the candidate's approval act
with explicit sensitive-answer checks kept (ADR-050 decision 2); D3-150 generated resumes PDF only
across OpenAPI, Documents, native completion and extension transfer; D3-151 uploaded-resume
fallback (`resume: uploaded`, owner-scoped original read, default off) and identifiers-only apply
intent for the extension. Implemented and locally tested; not accepted. Open: the Greenhouse
submit-click discrepancy (owner decision), Documents/Gateway/web release order, a governed native
image release, native acceptance of the web session token, and security review.

D3-139 to D3-146 started 2026-10-15 and merged 2026-10-15/17 with before/after regressions, targeted
runs and independent review where consequential (hosted CI executed zero steps because of billing):
D3-139 [#687](https://github.com/Vrixic/project-ai-job-apply/pull/687) single restore boundary statement
within the IAM size limit; D3-140 [#688](https://github.com/Vrixic/project-ai-job-apply/pull/688) omit empty
KMS context for context-free saved answers (Gateway 119, Profile activity 26); D3-141
[#689](https://github.com/Vrixic/project-ai-job-apply/pull/689) provider application subpages (ADR-045
amended); D3-142 [#690](https://github.com/Vrixic/project-ai-job-apply/pull/690) record challenges in
read-only capture (ADR-046 amended); D3-143 [#691](https://github.com/Vrixic/project-ai-job-apply/pull/691)
job detail no-store (Gateway 120); D3-144 [#692](https://github.com/Vrixic/project-ai-job-apply/pull/692)
heading labels for legend-less radio groups; D3-145 [#693](https://github.com/Vrixic/project-ai-job-apply/pull/693)
accept the bound native resume digest in approved handoff; D3-146
[#694](https://github.com/Vrixic/project-ai-job-apply/pull/694) bounded clock skew in the rights session.
Open from this session: surface the rights operator's failing step, then read-only verification of owner
SQL and Auth0 deletion before any new run; automated fill despite a challenge; installed Edge; D2-only
workload operator keeps zero skew.

D3-138 started 2026-10-14: correct the document-intake mocked runtime test's stale scope set.
Its existing global `deploy_applications=true` and per-run document intake require the five base
scopes plus two Applications and two Documents scopes. Exact set equality now includes all nine;
no production policy changes. The isolated actual run fails before and passes after (0/1 then
1/0), with the original mock providers/global variables and scoped Terraform formatting passing.
Only that run executes, with no AWS access, runtime startup or full-suite claim.

D3-137 started 2026-10-14: refresh the [engineering approval packet](../../security/d3-application-approval-packet.md)
against merged source `7fa98b29` and the dated October 13/14 evidence. Replace stale native
sign-in/download and rights statements, preserve the FAILED/open canonical acceptance result,
and distinguish prerequisite-blocked agent execution from human authority/acceptance. Review
dispositions, activation gates and all five exit checkboxes remain unchanged. Documentation-only
verification and independent review are recorded with this batch; no runtime is started.

D3-135 started 2026-10-14: [PR #682](https://github.com/Vrixic/project-ai-job-apply/pull/682)
separates original verified ID-token expiry from current access admission and caps confirmation
at the original ID expiry/MFA 900-second lease. Refresh renews neither proof nor MFA authority.
Meaningful before/after regressions, 69 serial Node tests, PowerShell checks in both hosts, scoped
Biome and consequential review pass. This scripts-only fix required no Gateway redeployment.
Hosted CI executed zero steps because of billing; live outcomes are recorded separately in
[rights evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-136 started 2026-10-14: [PR #684](https://github.com/Vrixic/project-ai-job-apply/pull/684)
repairs exact role/bucket/prefix export-version inventory and document `DeleteObject` grants in
the existing policy layers. Bootstrap tests pass 9/0, the focused platform case passes 1/0, and
all 30 historical operator assertions pass in each PowerShell host; scoped formatting and
consequential review pass. The initial broader platform run, before repair, had 55 passes/2
failures, including an existing 7-versus-9 scope assertion; a broader full-green run is not claimed.
Hosted PR jobs executed zero steps because of billing. Both IAM applies and whole-policy/scoped
simulation readback pass. The original confirmed deletion and notice disposition are recovered;
canonical acceptance remains open. Final shutdown, credential containment and encrypted recovery
archival are verified. [Evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-134 started 2026-10-14: fix the resume list/upload producers' missing `Cache-Control: no-store`
after the reviewed live rights run stopped on its first GET. The bounded Gateway audit records
one GET 200 and no upload/export/deletion requests; the preserved deployed artifact confirms the
missing headers. The two established header decorators and two actual-route assertions pass
the focused red/green regression, Gateway build and scoped Biome checks.
Gateway 117/source `a45c456c` is released and verified. The preserved first-read failure is
historical; later failures and the recovered original deletion are recorded separately.
Canonical document-inclusive acceptance remains open.
[Evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-133 started 2026-10-14: repair the resume-rights lifecycle test's missing export-cleanup mock.
The focused suite now verifies completed marker → export cleanup → resume-prefix cleanup → health,
and refuses completion when export cleanup fails. This is test-harness verification only;
document-inclusive live rights acceptance remains open.
[Evidence](evidence/d3-rights-readiness-2026-10-14.md).

D3-132 started 2026-10-13: settle one legacy missing-digest launch claim only with exact original
AWS rejection evidence, preserving the absent request digest and normal launch/recovery paths.
PR 675 is merged as `ab1de3c9`; 21 reviewed source hashes, 77 unit tests, 89 real PostgreSQL cases
(eight new), 216 workflow tests, 27 migration tests, targeted packaging and three component
typechecks pass. The two image builds match, hardened smoke and immutable publication/scan pass,
and the sole effective task-image update is applied. Managed source `ab1de3c9` migration stopped
with exit 0, all seven owner/final markers and Documents 0018 verified. One live original claim is
`launch_rejected`; exact proof/claim/head-seal readback passes and the original request digest stays
NULL. Temporary Plan/Apply functions are absent. Qualified Profile 25 maintenance subsequently
scanned/purged one source with zero failures or held work. The private runner's overlong-name correction
passes focused name/self-binding/reproducibility checks and changes no public product source or
managed native release. The owner transition adds no task launch, public API or permanent permission.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-131 started 2026-10-13: retain all eight prior recovery versions while admitting one current
version, preserving numeric-only scopes and two-result execution bounds. PR 674 is merged as
`1d1a5a77`; 63 workflow/6 Applications tests, 24 mocked Terraform cases, component checks and
consequential review pass. Sixteen immutable native artifacts are published. Paused version 15
code/environment/IAM/qualified-recipient readback passes at 22:40 UTC; old version 14 and seven
earlier versions remain retained, with zero executions on current version 15. This adds no launch
authority or acceptance claim.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-130 started 2026-10-13: explicitly admit existing bounded fact provenance and optional boolean
sponsorship preference in portable exports. PR 673 is merged; SQL-coupled reproduction failed
three supported cases before correction, and 33 domain/150 focused workflow tests, component checks
and consequential review now pass. No SQL migration is needed. Double build/smoke, profile activity
25 qualified release/readback and ordinary UI export download/current-source schema validation
pass. Eight owners and latest vault values/context/tombstone match; plaintext was removed.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-129 started 2026-10-13: add bounded static export-validation diagnostics without candidate
details or changing the fixed public refusal. PR 672 is merged; 28 domain and 144 focused workflow
tests, component checks and consequential privacy review pass. Profile activity 24 release/readback
and one static `metadata`/`profile` additional-property diagnostic containing no candidate values
pass. D3-130 corrects source-proven omissions; the exact private offending field was not read.
Hosted Actions could not start because of account billing.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-128 started 2026-10-13: portable export metadata now accepts four existing native producer
values without weakening closed objects or content exclusions. PR 671 is merged; 21 domain and
135 focused workflow tests, component checks and consequential review pass. The live
`CandidateExportSchemaRejected` failure persisted after profile activity 23 release/readback;
its precise offending row was not read. D3-129/130 provide diagnostics and the tested correction.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-127 started 2026-10-13: reconcile exact portable-export versions, including failed-publication
orphans, before account deletion advances. PR 670 is merged; 128 focused tests, two PostgreSQL
cases, 22 operator cases and consequential review pass. Cleanup is deployed through profile activity 25; live
account deletion and multi-export cleanup remain pending.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-126 started 2026-10-13: accept a bounded truly empty Next.js DELETE stream for a saved restricted
answer. PR 669 is merged; 29 focused BFF tests and web typecheck pass. Protected source `55f8b7bc`
passes synthetic delete/reload with values hidden. Ordinary portable export confirms the latest
two active entries and deleted tombstone; expired-value acceptance was not exercised.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

D3-125 started 2026-10-12: the generated-resume rights fixture now admits only the fixed D2/D3
synthetic policies. All 287 fixture assertions, 23 focused D3 rights assertions, 67 session tests
and the production PDF parser check pass. Consequential source review and managed runtime status pass;
the actual rights fixture remains pending authentication.
[Evidence](evidence/d3-synthetic-resume-fixture-policy-2026-10-12.md).

D3-124 started 2026-10-12: the in-memory rights session now supports explicit fixed D3 policy
selection and exact Applications coverage while preserving D2 defaults, token memory boundaries
and OAuth scopes. All 67 focused session tests, formatting checks and consequential source
review pass. Dark restore/replay and managed configuration checks pass; the authenticated rights
fixture remains pending. The managed checkpoint records the latest shutdown and remaining tests.

D3-122/123 started 2026-10-12: complete agent-owned verification before human acceptance.
Audit found missing default-off saved-answer reuse deployment wiring and D2-only rights-test
coverage. Implementation adds guarded reuse wiring, exact D3 Applications export/deletion
coverage and optional formal restore diagnostics. Targeted local verification and consequential
source review pass; managed tests remain. [Evidence](evidence/d3-independent-release-guards-2026-10-12.md).

D3-121 started 2026-10-12: after an ambiguous cancellation, observe the exact newer cancelled
application once without replaying the command. 61 targeted workspace tests, web typecheck,
focused review and the simulated connected journey pass; live retest remains.
[Evidence](evidence/d3-native-connected-journey-2026-10-12.md).

D3-119/120 started 2026-10-12: original-deadline DNS propagation observation and explicit
revision-bound replacement consent. 58 workflow and 50 workspace tests, component typechecks
and focused Biome pass. Managed Gateway 108/native 9 approval and direct PDF/DOCX downloads pass.
[Evidence](evidence/d3-native-propagation-wait-2026-10-12.md).

D3-118 started 2026-10-12: real Fastify injection reproduces and fixes lazy-thenable credential
context loss. 144 targeted tests and Gateway build/typecheck pass; Gateway 108 live approval passes.
[Evidence](evidence/d3-native-fastify-credential-2026-10-12.md).

D3-117 started 2026-10-12: invocation-scoped original JWT forwarding corrects the diagnosed
Lambda/native credential mismatch. 144 focused tests, Gateway build/typecheck and consequential
security review pass; the subsequent Fastify fix and Gateway 108 live approval pass.
[Evidence](evidence/d3-native-invocation-credential-2026-10-12.md).

D3-116 started 2026-10-12: bounded native approval diagnostics; 31 focused tests, Gateway typecheck
and focused Biome pass. The diagnosed 503 is corrected by D3-118; Gateway 108 live approval passes.
[Evidence](evidence/d3-native-availability-diagnostics-2026-10-12.md).

D3-113 started 2026-10-11; source verification passes. Managed native generation, preview, review, approval and direct downloads pass in the current synthetic journey.

D3-114 started 2026-10-11: native API scope admission is corrected and passes focused Terraform/controller tests and consequential review. Managed scope/binding readback passes; native acceptance remains open. [Evidence](evidence/d3-native-api-scope-admission-2026-10-11.md).

Implemented means merged source; deployment and live acceptance are stated separately.

| Capability / task IDs | Implemented | Remaining |
|---|---|---|
| Facts and saved answers (profile facts were replaced by saved Profile entries in D3.1, ADR-052; D3-001, D3-039, D3-055, D3-056, D3-075, D3-076) | Fact grounding, encrypted answer storage, selected-version checks and expiry/correction/quarantine guards are locally verified. | Compatible release and live saved-answer reuse acceptance; D3-087 supplies locally verified selection/review and reuse remains off. |
| Resume import (D3-002, D3-023, D3-024) | Immutable import, normalized resume structure and upload registration are implemented; synthetic scan/parse has development evidence. | Real-resume processing approval and final connected onboarding acceptance. |
| Resume preparation (D3-003, D3-016, D3-022) | Deterministic tailoring, visible diffs, factuality checks and verified PDF/DOCX rendering are implemented. | Managed synthetic native generation/direct downloads pass; candidate output-quality acceptance remains. |
| AI generation (D3-004, D3-037, D3-038) | A gated model adapter, grounded output validation and fresh disclosure checks are locally verified. | Externally blocked: owner confirms no provider/account policy meeting ADR-038's 30-minute all-copy retention limit. Keep live AI off. Provider configuration, evaluation and live acceptance remain. |
| Applications (D3-005, D3-021, D3-074) | Immutable packets, owner-scoped lifecycle/history, application reopening and approval rechecks are implemented. | Final connected generation, approval, dispatch and confirmation acceptance. |
| Review (D3-006) | Review-by-exception and explicit approve/cancel UI are implemented. | Live native material/saved-answer integration and final accessibility acceptance. |
| ATS adapters (D3-007, D3-013) | Provider-neutral extraction, mapping, approved-field planning and challenge detection are locally verified; D3-101 implements the default-off Greenhouse bridge. | Authorized provider fixtures, exact-variant QA and installed/live acceptance; Lever/Ashby follow later. |
| Submission safety (D3-008) | Attempt idempotency, validation, takeover, ambiguity handling and terminal confirmed-submission history are implemented. | Connected extension submission and provider confirmation acceptance. |
| Assisted/manual Apply (D3-009, D3-018) | Canonical job opening, approved-answer copying and safe manual fallback are implemented; the deployed manual flow passed human review. | Managed direct native PDF/DOCX downloads pass; installed-extension handoff acceptance remains. |
| Metrics (D3-010, D3-036) | Versioned correction/outcome metrics and strict detached telemetry envelopes are locally verified. | Production sinks/dashboards/alarms are deferred from the candidate-journey critical path. |
| Verification (D3-011, D3-019) | Local adversarial, owner-isolation, duplicate-start and crash/replay checks pass; basic manual Apply is accepted. | Full generated-material journey, installed-extension checks and final security/privacy/accessibility/product acceptance. |
| Capability approval (D3-012) | Engineering approval packet refreshed on October 9 against current source/evidence; existing limited development owner dispositions are linked without amendment. | Provider retention under ADR-038, exact release/source review and accountable legal/security gates remain; development direction alone does not close them. |
| Candidate rights (D3-014, D3-028, D3-029, D3-030, D3-031, D3-073) | Applications export/delete support, restricted-answer export and document-prefix cleanup have local and partial managed evidence. Basic completed-deletion replay and D3 document-runtime status pass. | Current document-inclusive deletion/export lifecycle, backup aging and accountable review. Formal recovery proofs remain removed. |
| Migration/release tooling (D3-015, D3-020, D3-032, D3-033, D3-034, D3-040, D3-041) | Release convergence, provenance guards, dependency corrections and checksum-bound migration/restore tooling are implemented and verified. | Fresh compatible publication and exact managed release/restore checks for the next activation. |
| Resume limits/deletion (D3-025, D3-026, D3-027) | Plan-driven limits, in-progress upload exclusion, deletion and version/prefix byte purge are implemented and accepted in development. | Document-inclusive account-deletion acceptance remains under candidate rights. |
| Cover-letter preparation (D3-017, D3-042, D3-043, D3-044, D3-050, D3-067) | Private initialization, single-dispatch admission, original-work recovery and failure fences are locally verified. | Live provider composition, positive remote settlement, temporary-copy cleanup and candidate preview acceptance. |
| Provider response lifecycle (D3-045, D3-046, D3-047, D3-048, D3-049, D3-057, D3-059, D3-060, D3-061, D3-063, D3-065) | Original-response capture, eligibility, completion/failure settlement and disposal ports are locally verified. | Managed provider behavior, original-writer quiescence, retention and end-to-end cleanup acceptance. |
| Private runtime (D3-051, D3-052, D3-053, D3-054, D3-058, D3-062, D3-066, D3-078) | Isolated control/maintenance/provider bootstraps, artifact publishers and restrictive IAM composition are implemented. | Complete managed release, effective permissions, scheduling/drain and live acceptance for cover-letter work. |
| Preparation workflow (D3-068, D3-069, D3-070, D3-071) | Native preparation activity, durable entrypoint, starter and recovery artifacts are implemented and qualified locally. | Complete connected activation and original-work recovery/drain acceptance. |
| One-off material policy (D3-064, D3-072) | Memory-only storage, bounded expiry, hash-only packet guards and legacy export readers are implemented locally. | Complete no-persistence/30-minute enforcement across provider, browser, ATS and all copies; legacy saved-content paths must remain inactive or be replaced. |
| Restricted packets (D3-077) | Separate-key packet protection and legacy receipt migration are implemented; managed archival of seven receipts passed. | Managed original-request replay, saved-answer reuse and broader candidate acceptance. |
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
| Restore data comparison (D3-093) | Bounded SQL-side whole-row hashes, exact catalogs, explicit snapshot contracts and strict comparison are implemented. 93 unit tests, all 96 restored relation digests and 21 real PostgreSQL probes pass. Both isolated managed inventories pass independent original-task review; 84 of 88 shared relations match exactly, including all 80 relations of the other six owners. | All 12 Applications differences now reconcile with seven actual KMS original-digest proofs. Managed primary completed-deletion replay passes under D3-106; compatible release and live acceptance remain. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#managed-snapshot-data-comparison--2026-10-10). |
| Restore transition reconciliation (D3-094) | Fixed read-only three-to-fifteen Applications comparison, exact original/added catalogs, ledger/default accounting and seven original-digest proofs are implemented. Independent review, 65 focused tests and seven real PostgreSQL reconciliation probes pass with simulated KMS. The new immutable diagnostic is published and independently verified. Separate default-off timed decrypt-only task registration passes 22 Terraform cases, configuration validation and all 43 repository stages. | Managed read-only reconciliation and independent result review pass; temporary authority and both restores are removed. Primary recovery and completed-deletion replay pass under D3-106; the live journey remains. [Evidence](evidence/d3-native-application-disposal-2026-10-07.md#restore-transition-reconciliation--2026-10-10). |
| Privacy replay inventory (D3-095) | Restore reconciliation counts all fifteen Applications tables, including independent native withdrawals and their cleanup queue. Eight real PostgreSQL cases, 234 focused store/contract tests, the maintained 96-relation dump/restore harness and all 43 repository stages pass. | Primary restore and completed-deletion replay pass under D3-106; live acceptance remains. [Evidence](evidence/d3-privacy-replay-inventory-2026-10-10.md). |
| Quiescent privacy recovery (D3-096) | Default-off development-only PITR checks writer drain and exact-input zero drift while preserving source/target safeguards. All 98 focused synthetic cases and 43 repository stages pass. | Primary restore and completed-deletion replay pass under D3-106; live acceptance remains. [Evidence](evidence/d3-dark-privacy-recovery-2026-10-10.md). |
| Quiescent deletion replay (D3-097) | Default-off development replay binds the dark context/mode and recovery dependencies, using maintained writer-off PITR preflight. All 778 synthetic replay checks, 908 restore-role assertions and 43 repository stages pass; independent source review passes. | Managed primary replay passes under D3-106; connected live acceptance remains. [Evidence](evidence/d3-dark-deletion-replay-2026-10-10.md). |
| Recovery bootstrap inputs (D3-098) | Complete: bounded observations and typed inputs pass focused tests, independent review and all 43 repository stages. | Managed primary replay passes under D3-106; connected live acceptance remains. [Evidence](evidence/d3-bootstrap-recovery-inputs-2026-10-10.md). |
| Replay data preservation (D3-099) | Complete for repository implementation: 348 focused tests, 790 operator assertions, 11 real PostgreSQL regressions, independent review and all 43 repository stages pass. | Formal promotion-proof gate removed; managed primary completed-deletion reconciliation passes under D3-106; live acceptance remains. [Evidence](evidence/d3-replay-data-preservation-2026-10-10.md). |
| Reconciled-copy verification (D3-100) | Complete for repository implementation: PR #633 merged after 500 focused tests, 17 real PostgreSQL regressions, independent final review and all 43 repository stages. | Optional diagnostic runtime; managed primary completed-deletion reconciliation passes under D3-106; live acceptance remains. [Evidence](evidence/d3-reconciled-copy-verification-2026-10-10.md). |
| Greenhouse execution bridge (D3-101) | Locally verified: connected attachment/one-shot attempt/result, 104 focused extension and 36 workspace regressions, 23 synthetic browser cases and the simulated manual journey pass. All 43 repository stages pass, including 680 extension and 912 web tests. [PR #634](https://github.com/Vrixic/project-ai-job-apply/pull/634). | Installed/native/provider journey, compatible release, live grants and external acceptance remain; primary recovery/replay pass under D3-106. |
| Private reconciled-copy runtime (D3-102) | Complete for repository runtime implementation: separate fresh admission, schema/SQL/document continuity, strict promoted-primary resolver and bounded cancellation/close. 207 focused tests, packaged refusal smoke and all 43 repository stages pass. | Formal operator/proof gates removed by owner; basic managed restore/deletion reconciliation passes under D3-106; live acceptance remains. [Evidence](evidence/d3-reconciled-copy-runtime-2026-10-10.md). |
| Recovery gate simplification (D3-103) | Formal recovery-proof gates removed; encrypted backups, exact targets and transactional deletion safeguards retained. Targeted checks and simulated journey pass. | No independent D1/admin acceptance is added. [Evidence](evidence/d3-recovery-safeguards-simplification-2026-10-10.md). |
| Primary deletion replay (D3-104) | Explicit writer-off primary mode implemented and locally verified; managed restore and replay pass under D3-106. | Compatible release and live acceptance remain. [Evidence](evidence/d3-primary-deletion-recovery-2026-10-10.md). |
| Primary operational guards (D3-105) | Bounded backup-status/endpoint-tag observations, primary permission cleanup and basic writer/account/backend checks are verified. | Current runtime and live acceptance remain separate. [Evidence](evidence/d3-primary-recovery-operational-guards-2026-10-10.md). |
| Retained deletion markers (D3-106) | 257 focused tests, component typecheck/build, simulated journey and consequential review pass. Managed replay passes: two already-reconciled subjects, no new deletion or external writes. | Live native/provider acceptance remains. [Evidence](evidence/d3-retired-deletion-markers-2026-10-10.md). |
| Compatible release (D3-107) | Gateway version 90, shutdown/recovery preservation and protected native candidate host are verified. 154 focused client tests and component typechecks pass; unpacked extension built with provider registry disabled. | Host/candidate sign-in completed under D3-108; installed ID/grants and full live native journey remain. [Evidence](evidence/d3-compatible-gateway-offline-release-2026-10-10.md). |
| Native live admission (D3-108) | Profile, launch, status refresh, exact STS identity and RPC serialization fixes merged with targeted tests/typechecks and consequential review. Live synthetic sign-in/search/upload/fact confirmation pass; corrected default-off worker image smoke passes. | Enabled worker publication, migration and managed launch pass; full connected native acceptance remains. D3-109 covers future definitive rejection settlement; the historical claim remains unresolved. AI retention policy and authorized ATS QA/fixtures unavailable. [Evidence](evidence/d3-native-live-admission-fixes-2026-10-11.md). |
| Native launch rejection (D3-109) | Original request digest, definitive SDK rejection capture, immutable terminal SQL and disposal/fresh-epoch guards are implemented and locally tested. Six reproducible native Lambda artifacts are published; revision-2 RPCs are staged disabled. | Consequential reviews, immutable image publication/scans, migration 0017 and bounded r2 activation pass. Live acceptance remains. Historical unknown claims remain unresolved. [Evidence](evidence/d3-native-launch-rejection-2026-10-11.md). |
| Native download approval expiry (D3-110) | Exact approval/material deadlines gate downloads before reads and after hashing; expiry aborts pending files and withdraws transfers while preserving previews. 52 focused tests, web typecheck, simulated Chromium journey and consequential review pass. | Compatible candidate host is Ready; live download acceptance remains. [Evidence](evidence/d3-native-download-approval-expiry-2026-10-11.md). |
| Retained native deployment policy (D3-111) | Compact serialized deployment grant/boundary preserves authorization and both original revisions; 25 bootstrap Terraform test runs and validation pass. | Consequential review and managed application pass; live acceptance remains. [Evidence](evidence/d3-retained-native-deployment-policy-2026-10-11.md). |
| Primary manifest fingerprint (D3-112) | Primary context/admission/schema verification binds current 80-migration source and rejects the old fingerprint. 311 focused tests, 841 PowerShell checks and component typecheck pass. | Current 80-migration managed replay and temporary authority cleanup pass; live acceptance remains. [Evidence](evidence/d3-primary-manifest-fingerprint-2026-10-11.md). |
| Native packet recovery (D3-113) | Explicit packet replacement preserves revision/idempotency and requires fresh review. Material verification failures carry only safe phase-specific guidance. 95 focused tests and web typecheck pass. | Consequential review, hosted expiry controls and explicit replacement pass; native preview remains open. [Evidence](evidence/d3-native-packet-recovery-2026-10-11.md). |
| Native API scope admission (D3-114) | Application scopes conditionally included; two Terraform mock plans, three controller tests, focused review and managed Gateway 102 readback pass. | Live native preview remains open. [Evidence](evidence/d3-native-api-scope-admission-2026-10-11.md). |
| Retired-epoch reprepare (D3-115) | Guarded fresh-epoch replacement implemented; five real PostgreSQL cases, component build, focused review and simulated connected journey pass. | Managed native release, synthetic preview, approval and PDF/DOCX download pass; accountable output-quality/provider acceptance remains. [Evidence](evidence/d3-retired-epoch-reprepare-2026-10-12.md). |
| Retained workflow capacity (D3-131) | Eight prior/nine total numeric versions, bounded execution inspection, focused tests and review pass. Sixteen immutable artifacts, paused native version 15 bindings and final drain/shutdown pass. | D3 live acceptance remains separate; no new launch authority. [Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md). |
| Legacy launch-claim settlement (D3-132) | Exact-evidence owner transition/migration 0018, targeted checks, reproducible image/publication and managed migration/single-claim settlement pass. Original missing request digest stays absent; head sealing and temporary-function absence are verified. | Original confirmed deletion is recovered under D3-136; canonical acceptance remains open. No new legacy task launch or D3 acceptance is inferred. [Evidence](evidence/d3-rights-readiness-2026-10-14.md). |

## Decisions and scope changes

2026-10-11: Native public settings and component build are deployed on the existing exact HTTPS
candidate origin. All-deployment authentication protection, stable alias/source and focused client
checks pass. Installed/native/provider acceptance is still open; successful extension transfer
requires the existing provider registry gate. No AWS runtime is reactivated after shutdown while
human host sign-in and development SSO renewal are pending.

2026-10-10: D3-107 installs the existing compatible Gateway artifact with runtime disabled.
Development shutdown and exact encrypted recovery archival pass. No live journey or independent
D1/admin acceptance is inferred. The owner confirms no qualifying AI-provider retention policy
exists; live AI remains disabled while independent native work continues.

2026-10-10: D3-106 closes basic primary restoration and completed-deletion replay with a fresh
source-bound managed run and independent result review. Both subjects were already reconciled;
no new deletion occurred. Formal whole-database comparison remains optional. The owner confirms
no qualifying provider retention policy exists, so live AI cover letters remain externally blocked
and off. Continue compatible native-resume release and installed/live journey work independently.

2026-10-10: D3-102 completes the private read-only runtime source and local verification only.
Fresh admission never extends original replay or generated-material deadlines. That planned formal operator batch was subsequently removed by the owner;
basic restoration and completed-deletion safeguards remain. Independent D1/admin acceptance stays deferred.

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

2026-10-21: Owner decision. Non-security testing, acceptance and evidence work is removed from D3:
installed Edge and expiry-drill testing, candidate output-quality acceptance, accessibility
acceptance, product acceptance, AI evaluation, ATS-fixture QA representativeness and restore
rehearsals. Rights/deletion, expiry enforcement, restricted-answer review, submission safety and
the legal and security review stay. D3.1 no longer waits for D3 to complete. Privacy reviews were
removed from all phases on 2026-10-22.

Generated cover letters and tailored resumes must never persist and must expire within 30 minutes (ADR-038).
Manual Apply is the first acceptance path; Greenhouse is the first automated adapter.
Application history ends at confirmed submission; sensitive answers and irreversible actions require candidate review.

## Exit criteria

Owner decision 2026-10-21: rendered-document verification, ATS accuracy acceptance, restore
rehearsals, AI evaluation, accessibility and product acceptance are removed. Security criteria
remain; privacy reviews were removed 2026-10-22.

- [ ] Truthful preparation, review, approval, Apply and confirmed-submission history work for the candidate.
- [ ] Immutable approval bindings and duplicate-submission safety hold.
- [ ] No generated-content persistence and all-copy expiry within 30 minutes (ADR-038) hold with live AI off; the live provider is [D3.2](phase-3-2-live-ai-generation.md).
- [ ] The Greenhouse adapter fills, attaches and submits after the candidate's approval on one live posting the owner picks, with a safe manual fallback. Ashby is built and tested on synthetic pages; its live proof is D3.2-007.
- [ ] Candidate export and deletion complete in one successful canonical run (the 2026-10-17 run FAILED). The accountable legal and security review is carried to D6-015 and D6-016.

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
- [Generate-then-apply flow, 2026-10-20](evidence/d3-generate-then-apply-flow-2026-10-20.md)
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

2026-10-10: D3-102 private runtime implementation passes 207 focused tests, packaged default-off
refusal, independent exact-source review and all 43 repository stages. The simulated connected
Chromium journey passes. Development, Docker and WSL are verified off; the PC remains on.
Guarded operator/result/provenance, managed recovery/promotion and live acceptance remain internal
work; independent D1/admin acceptance stays deferred. Hosted jobs could not start due to account
billing/spending limits. [Evidence](evidence/d3-reconciled-copy-runtime-2026-10-10.md).

2026-10-11: D3-108 fixes failures found in the synthetic live journey through PRs #643–#647.
Targeted regressions/typechecks and consequential review pass. Native image rebuild is blocked
by Docker startup; no generated material or submission was accepted. Original unresolved failures
are retained without relaunch or guessed settlement. Independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-native-live-admission-fixes-2026-10-11.md).

2026-10-11: Sequential staging SSO renewal permits fresh read-only shutdown verification at
18:01:49Z. Lifecycle and supplemental inventory confirm dormant with no running work or queued
messages. Development shutdown remains verified; Docker/WSL are off and the PC remains on.
D3 remains In progress; independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-native-live-admission-fixes-2026-10-11.md).

2026-10-11: D3-109 adds distinct original-launch rejection settlement without task-death fiction
or retry. Targeted tests/typechecks, real PostgreSQL ledger tests and the simulated connected
Chromium journey pass. Docker startup is repaired; immutable release and live acceptance remain.
[Evidence](evidence/d3-native-launch-rejection-2026-10-11.md).

2026-10-11: D3-110 closes stale-browser approved-download expiry, with immediate pending-buffer
wipe and transfer withdrawal. Focused tests, web typecheck and the simulated Chromium journey pass;
consequential review passes. Docker is repaired again and publication resumes; AWS runtimes remain
off. The historical rejected claim is scoped to its original application and does not block a new
r2 journey. Independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-native-download-approval-expiry-2026-10-11.md).

2026-10-11: Corrected default-off worker image passes actual isolated render/deadline smoke;
migration image passes hardened package/checksum smoke. Six reproducible native Lambda artifacts
are published and revision-2 RPCs are staged disabled under an exact reviewed plan with zero
resource/output drift. Current inputs are archived encrypted. Normal Docker restart again fails
at the Secrets Engine socket; remaining image publication has not run. Development is freshly
verified off at 18:49:53Z; staging remains unchanged since its 18:01:49Z verification. Docker/WSL
are off and the PC stays on. D3 remains In progress; independent D1/admin acceptance is deferred.
[Evidence](evidence/d3-native-launch-rejection-2026-10-11.md).

2026-10-11: D3-111 compacts only the serialized deployment grant/boundary to 5,913 characters for
both retained resume revisions, preserving authorization. 25 bootstrap test runs and validation pass.
Image scans/publication pass; development is temporarily restored writer-off and Docker/WSL are off.
Managed activation/live acceptance and final shutdown remain. Independent D1/admin acceptance is deferred.
[Evidence](evidence/d3-retained-native-deployment-policy-2026-10-11.md).

2026-10-11: D3-112 binds primary deletion recovery to the current 80-migration fingerprint and
rejects the old label. 311 focused tests, 841 PowerShell checks, component typecheck and consequential
review pass. Migration 0017 and paused compatible Gateway/cleanup deployment pass; basic replay,
native acceptance and final shutdown remain. Independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-primary-manifest-fingerprint-2026-10-11.md).


2026-10-12: D3-115 fixes retired unsealed epoch replacement. Five targeted PostgreSQL cases, Documents build, focused checks/review and simulated connected journey pass. Managed release/live acceptance remain; development shutdown is being reverified after an interrupted apply and expired SSO. [Evidence](evidence/d3-retired-epoch-reprepare-2026-10-12.md).


2026-10-12: D3-115–120 managed native release and synthetic preview/review/approval/PDF/DOCX journey pass. D3-121 adds locally verified ambiguous-cancellation observation. Real employer confirmation, live AI and accountable acceptance remain open. [Evidence](evidence/d3-native-connected-journey-2026-10-12.md).

2026-10-12: D3-122–125 source/review and targeted checks pass. Managed D3 policy, native bindings,
completed-deletion replay and document-runtime status pass. Authenticated saved-answer, cancellation
and document-inclusive rights tests await candidate sign-in. Development shutdown, encrypted recovery
archive and zero-change dormant baseline pass at 2026-10-13T01:15:40Z; Docker/WSL are off and the PC stays on.
Independent D1/admin acceptance remains deferred. [Evidence](evidence/d3-independent-managed-verification-2026-10-12.md).

2026-10-13: D3-126–132 are merged with targeted checks and consequential review passing. Hosted
vault deletion/reload, synthetic native review/approval/PDF/DOCX, truthful not-submitted history,
cancellation drain and old-resume cleanup pass. Profile activity 25/source `cc464385` ordinary UI
export/schema/latest-vault comparison passes; three failed notices are archived/acknowledged and
all thirteen queues were empty. Sixteen capacity artifacts and paused Gateway 115/native version
15 bindings pass; eight prior versions remain retained and current version 15 has no executions.
PR 675/source `ab1de3c9` migration image builds match, hardened smoke/publication and COMPLETE scan
with zero High/Critical findings pass; the sole task-image update is applied. One migration launch
was unacknowledged before SSO expiry and was not retried. At 23:30:06 UTC no matching running/stopped
tasks were found; managed 0018 completion, legacy settlement and account deletion remain unverified.
Candidate memory authentication has expired and fresh development SSO is pending. Encrypted
backup/safety preflight passes, but database/NAT/EIP/ten paid Interface endpoints remain on with
intake/maintenance/dispatch paused; mandatory AWS shutdown is incomplete because SSO expired.
Docker/WSL were off at 23:07:15 UTC, the owned PostgreSQL fixture is off and the PC remains on.
Live AI/provider policy, ATS QA/fixtures, installed extension and accountable acceptance remain
open; independent D1/admin acceptance stays deferred and formal recovery-proof gates stay removed.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

2026-10-13 owner-local update (2026-10-14 UTC): managed source `ab1de3c9` migration stopped with
exit 0/all seven owners/final marker including 0018 verified. One legacy claim settled as
`launch_rejected`, preserving its NULL request digest with exact proof/claim/head-seal readback;
temporary Plan/Apply functions are absent. The private runner's name/self-binding correction and
reproducible artifact checks pass without a public source or managed native-release change.
Normal qualified Profile 25 maintenance scanned 1/purged 1/failed 0/held 0 at 00:39:04Z. Both scanner
stages and actual bindings pass; the pre-test refresh-backed source `b94e47a2` plan has zero managed
changes at 00:50Z. D3 ResumeFixture Status passes at 00:55Z: empty queues, no active compute and
healthy alarms with policy/backup/Auth0 owner bindings. The rights session expired automatically
before identity confirmation, Plan, Execute or fixture creation; account deletion has not started.
No listener remained on localhost port 3000 at 01:15Z. The earlier UI export had zero versions/markers and
no local plaintext at 01:04Z before the planned deletion test, so its absence is not deletion evidence. Gateway
preparation/new launches are disabled; the dispatch schedule is disabled while its handler flag
remained plan-enabled during that test checkpoint. Development shutdown passes at 02:05:48Z:
database/NAT/paid Interface/EIP counts are zero, writers/queues drained and temporary executors/
restore roles absent. Exact final/safety snapshots are available/encrypted, and all 144 dormant
inputs have encrypted exact-version/checksum archival. The fresh final dormant plan has zero
managed-resource/output changes with no apply. Docker/WSL and the owned PostgreSQL fixture are
off; the PC is on. Retained backup/storage/
security resources incur charges; staging is unchanged from its October 11 verified-off checkpoint.
[Evidence](evidence/d3-vault-native-rights-verification-2026-10-13.md).

2026-10-14: D3-133–136 fixes and targeted checks/reviews are verified. One continuation recovered
the persisted eight-owner deletion; object/marker, SQL and individual notice archive/ACK readbacks
pass. The canonical 17-step run remains failed/open. Development shutdown passes at 23:37:37Z,
with new encrypted final/safety snapshots, exact full144 input archival, credential rotation and
a fresh zero-change plan with all 177 checks passing. Owned local runtimes are off and the PC
stays on. Live AI, authorized ATS QA, installed-extension and accountable acceptance remain open;
independent D1/admin acceptance stays deferred.
[Evidence](evidence/d3-rights-readiness-2026-10-14.md).

2026-10-14: D3-137 refreshes the engineering review packet with the verified native journey and
recovered deletion, preserving the missing full rights/expiry receipt and external gates. The
ownership table identifies agent test/fix work awaiting account, installed-browser, AI-policy or
authorized ATS inputs separately from accountable decisions. D3 remains In progress; independent
D1/admin acceptance stays deferred. No product behavior or runtime configuration changes.

2026-10-14: D3-138 closes the documented document-intake test expectation mismatch with an exact
nine-scope assertion and focused mocked red/green evidence. D3-137 also corrects the Greenhouse
worker README's stale implementation description. Production generation-quiescence composition
remains unfinished agent engineering; positive writer/provider proof and reviewed runtime/IAM
are required before activation. These offline corrections supply no additional live acceptance.
