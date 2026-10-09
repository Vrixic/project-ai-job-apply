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
native browser transport, cover-letter UI and saved-answer selection remain unfinished source work.
Connected native/provider acceptance, ATS adapters/fixtures, all-copy expiry, rights/restore and accountable reviews remain.
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
Development AWS runtimes, Docker and WSL were verified off on 2026-10-09; retained recovery/storage/security resources incur charges.
Staging was not freshly verified because separate SSO access was unavailable; the PC remains on.
[Current browser batch and shutdown evidence](evidence/d3-connected-candidate-journey-2026-10-09.md).

## Cross-delivery decisions and changes

Applications history belongs to D3, the generic inbox to D5, and structured Profile replacement to D3.1.
CI/CD work is deferred until production launch; independent launch security review remains required by ADR-015.
Real-candidate data and capability activation require their recorded authority; local tests do not establish production approval.

Historical work logs and decisions remain in Git history, phase documents, ADRs and linked evidence.
