# D2 — Extension and Community Loop

- Status: In progress
- Start: 2026-09-01
- Completion: Not completed
- Owners: Platform engineering; product owner
- Last updated: 2026-09-01
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d2--extension-and-community-loop)

## Objective

Deliver a minimum-permission browser extension that lets users save jobs and explicitly contribute public posting data to the shared catalog without collecting unrelated browsing, profile, session, or form data.

## Deployment posture

Run contribution and catalog processing in the existing lean services/workers. Scale ingestion
concurrency or split a worker only from queue-age, provider isolation, abuse, or measured load; do
not add idle replicas or always-on staging merely because the extension adds traffic.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D2-001 | Implement Manifest V3 identity, side panel/popup, background worker, and secure API session. | In progress | Platform engineering | D0 identity; D1 gateway | Existing Auth0 public-client shell is the fail-closed starting point; D2 side-panel and API-session work started 2026-09-01. |
| D2-002 | Implement current-page job detection for Greenhouse, Lever, and Ashby. | In progress | Platform engineering; QA/automation | D2-011 | Supported-variant definition and synthetic detector implementation started; activation remains blocked on D2-011 evidence. |
| D2-003 | Implement explicit save/contribution preview with field-level visibility and removal. | In progress | Platform engineering; product owner | D2-006 contribution API; D1 saved-job API; D0 consent | Private save and public contribution remain separate actions; implementation started 2026-09-01. |
| D2-004 | Implement local sanitization, narrow optional host permissions, and privacy-safe telemetry. | In progress | Platform engineering; security engineering | D0 threat/privacy review | Minimum-permission and no-unrelated-page-data implementation started; accountable approval remains D2-010. |
| D2-005 | Implement idempotent upload and safe offline pending-contribution retry. | In progress | Platform engineering | D2-006; D1 saved-job API | Local retry and server idempotency slice started 2026-09-01. |
| D2-006 | Implement server normalization, verification, moderation, provenance, and deduplication. | In progress | Platform engineering | D1 catalog/trust | Jobs-owned contract, persistence, and moderation integration design started 2026-09-01. |
| D2-007 | Implement contributor/source trust signals, closed-job reports, takedowns, and appeals. | Ready | Unassigned | D1 trust/admin | Open |
| D2-008 | Integrate community observations with source-aware freshness and active-index expiry. | Ready | Unassigned | D1 lifecycle | Open |
| D2-009 | Complete Chrome Web Store disclosure, permission, privacy, security, and release checks. | Ready | Unassigned | D0 policy/legal | Open |
| D2-010 | Obtain accountable UGC, extension-permission, privacy, security, and store approval before public contribution or distribution. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete contribution flow and extension manifest | Release gates LR-D2-01 and LR-D2-02; keep contribution/store release disabled until approved. |
| D2-011 | Define supported job-page variants and acquire authorized, sanitized provider fixtures with separate QA representativeness acceptance. | In progress | QA/automation; capability reviewers | D0-007 process; exact detection scope and source authorization | Supported-variant definition started 2026-09-01. Authorized fixture acquisition and separate acceptance remain blocking under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md); synthetic fixtures do not satisfy them. |
| D2-012 | Configure a dedicated extension Auth0 Native Application and prove Chrome/Edge PKCE, token rotation/replay, cancellation, logout, and revocation. | Ready | Platform engineering; security engineering | D2-001; provider access | Source can proceed fail-closed; provider configuration and manual browser evidence are external execution gates. |
| D2-013 | Complete the D2 data-flow, threat, privacy, consent, retention, subprocessor, and aggregate-telemetry delta. | In progress | Platform engineering; product owner; accountable reviewers | ADR-028; concrete implementation | The engineering delta is recorded; accountable security/privacy and legal dispositions remain D2-010. [D2 security/privacy delta](../../security/d2-extension-ugc-security-privacy.md) |
| D2-014 | Implement independent client-version, provider-variant, and domain kill switches without affecting web/catalog/private-save availability. | In progress | Platform engineering | D2-001, D2-002, D2-006 | Source implementation started default-off; deployed isolation evidence remains. |
| D2-015 | Complete accessibility, malicious-UGC, cross-user, offline/restart, permission, and installed-browser end-to-end assurance. | Ready | QA/automation; security engineering | D2-001–D2-008 | Automated source tests may proceed; human and installed Chrome/Edge evidence remain required. |
| D2-016 | Complete default-dark migration/release, alarms, rollback, restore, load/abuse, and activation-gate evidence. | Ready | Platform engineering; security/operations reviewers | D2-001–D2-015 | No cloud mutation is authorized by local implementation; keep all contribution/provider/store gates off. |

## Exit criteria

- [ ] Extension capabilities and requested permissions are understandable and minimal.
- [ ] No unrelated browsing history, cookies, authentication data, or third-party form values are collected.
- [ ] Users preview and explicitly approve every shared job contribution.
- [ ] Contributions are idempotent, sanitized, moderated, verified, deduplicated, and provenance-preserving.
- [ ] Offline/retry behavior cannot duplicate contributions or lose the user's private save.
- [ ] Community observations improve freshness without being treated as unquestioned source truth.
- [ ] Store policy, security, privacy, accessibility, adapter, and end-to-end tests pass.
- [ ] Every enabled job-page detector has current authorized provider fixtures, sanitization and scan evidence, and separate QA representativeness acceptance.
- [ ] The extension can be disabled by version/domain without affecting web/mobile/catalog availability.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-09-01 | Started Phase 2 from clean checkpoint branch `phase-2-extension-and-community`. The primary worktree was clean; the stale ignored Phase 0 extension bundle was removed, and an ancestry/patch-equivalence audit began for the separately registered historical Phase 1 worktrees and branches before any cleanup. Docker Desktop and its remaining WSL engine were stopped because the initial contract, extension, and governance work does not require them. Read-only architecture and gap audits confirmed that the inherited extension is only a fail-closed Auth0 shell and that the Jobs contribution API is D2-owned work not yet implemented. Public contribution, provider detector activation, and store distribution remain default-off behind D2-010/D2-011. | D2-001, D2-002, D2-003, D2-004, D2-005, D2-006, D2-011 | [Extension boundary](../../../frontend/extension/README.md), [UGC lifecycle](../../adr/005-ugc-lifecycle.md), [Phase 2 tasks](phase-2-extension-and-community.md) |
| 2026-07-28 | Assigned UGC and extension delta approval to D2 without starting implementation. | D2-010 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-08-12 | Accepted ownership of authorized representative job-page fixtures from D0; this assignment does not start D2 or approve any provider source. | D2-002, D2-011 | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), [fixture policy](../foundation/ats-fixture-policy.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-12 | Provider-derived job-page fixture evidence is acquired and accepted with the detector capability, not in the generic foundation. | Supported variants can only be judged against the concrete detector behavior. | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D2-R1 | Open | Browser-store review can reject overbroad permissions or unclear collection disclosures. | Unassigned | Design around optional hosts and explicit user actions from the first prototype. |
| D2-R2 | Open | Malicious/incorrect UGC can poison the catalog. | Unassigned | Require verification, source reputation, moderation, and rapid takedown controls. |
| D2-R3 | Open | D1 real-candidate, admin/moderation, public-publication, accessibility, and final accountable gates remain incomplete and do not transfer authority to D2. | Product owner; platform engineering | Continue only synthetic/default-dark D2 engineering until each applicable prerequisite and D2-specific gate passes. |
| D2-R4 | Open | No authorized representative Greenhouse, Lever, or Ashby job-page fixture is accepted. | QA/automation; capability reviewers | Define the exact supported variants, then complete ADR-021 authorization, scanning, human sanitization, separate QA acceptance, and raw disposition before activation. |
| D2-R5 | Open | Dedicated extension identity-provider configuration and real Chrome/Edge lifecycle evidence do not exist. | Platform engineering; security engineering | Complete D2-012 without placing provider credentials or tokens in source/evidence. |
| D2-R6 | Open | Accountable UGC/license, extension permission/privacy, security/privacy, and Chrome Web Store approval remain pending. | Product owner; accountable reviewers | Complete D2-009/D2-010 only against the exact release candidate; keep public contribution and distribution disabled. |
| D2-R7 | Open | The architecture's older raw-snapshot example conflicts with the newer 30-day maximum quarantine specification. | Product owner; privacy/security reviewers | ADR-028 selects zero normal raw-snapshot retention; use the 30-day maximum only for separately authorized external fixture quarantine and obtain accountable acceptance. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
