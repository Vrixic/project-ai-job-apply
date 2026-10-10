# Delivery Tracker

Last updated: 2026-10-10. Program status: In progress. Started: 2026-07-27. Completion: Not completed.

## Summary

| Delivery | Scope | Status | Start | Completion | Details |
|---|---|---|---|---|---|
| D0 | Product, data, and legal foundation | Complete | 2026-07-27 | 2026-08-12 | [Phase 0 tasks](phase-0-foundation.md) |
| D1 | Useful web product and canonical job catalog | In progress | 2026-08-11 | Not completed | [Phase 1 tasks](phase-1-web-and-job-catalog.md) |
| D2 | Extension and community loop | Complete | 2026-09-01 | 2026-09-18 | [Phase 2 tasks](phase-2-extension-and-community.md) |
| D3 | High-quality application preparation | In progress | 2026-09-18 | Not completed | [Phase 3 tasks](phase-3-application-preparation.md) |
| D3.1 | Structured candidate profile | Not started | Not started | Not completed | [Phase 3.1 tasks](phase-3-1-structured-profile.md) |
| D4 | Workday and remote preparation | Not started | Not started | Not completed | [Phase 4 tasks](phase-4-workday-and-remote.md) |
| D5 | Personalized outreach and application notifications | Not started | Not started | Not completed | [Phase 5 tasks](phase-5-outreach-and-notifications.md) |
| D6 | Mobile and paid launch | In progress | 2026-09-28 | Not completed | [Phase 6 tasks](phase-6-mobile-and-paid.md) |
| D7 | Quality optimization, expansion, and optional employer product | Not started | Not started | Not completed | [Phase 7 tasks](phase-7-quality-and-expansion.md) |

## D1 — Useful web product and canonical job catalog

Authentication, canonical jobs, onboarding, search/saved jobs, moderation, entitlements and public-page source are implemented.
Final hosted/public acceptance, maintenance deployment and real-candidate/privacy/accessibility reviews remain.
[Implemented and remaining capabilities](phase-1-web-and-job-catalog.md).

## D3 — High-quality application preparation

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

## Cross-delivery decisions and changes

Applications history belongs to D3, the generic inbox to D5, and structured Profile replacement to D3.1.
CI/CD work is deferred until production launch; independent launch security review remains required by ADR-015.
Real-candidate data and capability activation require their recorded authority; local tests do not establish production approval.

Historical work logs and decisions remain in Git history, phase documents, ADRs and linked evidence.
