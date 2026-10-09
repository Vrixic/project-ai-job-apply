# Delivery Tracker

Last updated: 2026-10-09. Program status: In progress. Started: 2026-07-27. Completion: Not completed.

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
The owner-approved separate SPA registration is configured and its saved grant/origin settings are inspected; live sign-in/native acceptance remains unverified. D3-086 adds default-off manual extension handoff with passing local regression/CSP/browser and full repository verification; focused installed acceptance remains open. D3-087 adds locally verified observed-form saved-answer selection and fresh form-confirmed manual Apply; repository checks, 95 PostgreSQL cases and synthetic Chromium journeys pass. Withdrawn-answer recovery (D3-088), compatible live release and provider adapter source remain. [Selection evidence](evidence/d3-observed-form-saved-answer-selection-2026-10-09.md). [Handoff evidence](evidence/d3-manual-extension-handoff-2026-10-09.md).
Connected native/provider acceptance, ATS adapters/fixtures, all-copy expiry, rights/restore and accountable reviews remain.
The D3-012 engineering review packet now links current evidence; existing development dispositions remain unchanged.
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

Work resumed for D3 on 2026-10-09; D1/D3 are not complete. Independent D1 acceptance remains deferred.
AWS access is sequential per the owner. The corrected lifecycle status command verifies dormant staging on 2026-10-09; staging does not need to remain signed in during development testing. Development's earlier dormant readback remains historical evidence; its next live session requires development sign-in. D3-085 fixes the optional-processor inventory check required by shutdown; it adds no independent D1 acceptance. No cloud runtime was started by these batches. Retained recovery/storage/security resources incur charges.
Docker/WSL shutdown is recorded in the linked evidence; the PC remains on.
[Current browser batch and shutdown evidence](evidence/d3-connected-candidate-journey-2026-10-09.md).

## Cross-delivery decisions and changes

Applications history belongs to D3, the generic inbox to D5, and structured Profile replacement to D3.1.
CI/CD work is deferred until production launch; independent launch security review remains required by ADR-015.
Real-candidate data and capability activation require their recorded authority; local tests do not establish production approval.

Historical work logs and decisions remain in Git history, phase documents, ADRs and linked evidence.
