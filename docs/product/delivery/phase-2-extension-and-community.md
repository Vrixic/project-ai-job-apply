# D2 — Extension and Community Loop

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d2--extension-and-community-loop)

## Objective

Deliver a minimum-permission browser extension that lets users save jobs and explicitly contribute public posting data to the shared catalog without collecting unrelated browsing, profile, session, or form data.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D2-001 | Implement Manifest V3 identity, side panel/popup, background worker, and secure API session. | Ready | Unassigned | D0 identity; D1 gateway | Open |
| D2-002 | Implement current-page job detection for Greenhouse, Lever, and Ashby. | Ready | Unassigned | D0 ATS SDK/fixtures | Open |
| D2-003 | Implement explicit save/contribution preview with field-level visibility and removal. | Ready | Unassigned | D1 contribution API; D0 consent | Open |
| D2-004 | Implement local sanitization, narrow optional host permissions, and privacy-safe telemetry. | Ready | Unassigned | D0 threat/privacy review | Open |
| D2-005 | Implement idempotent upload and safe offline pending-contribution retry. | Ready | Unassigned | D1 job service | Open |
| D2-006 | Implement server normalization, verification, moderation, provenance, and deduplication. | Ready | Unassigned | D1 catalog/trust | Open |
| D2-007 | Implement contributor/source trust signals, closed-job reports, takedowns, and appeals. | Ready | Unassigned | D1 trust/admin | Open |
| D2-008 | Integrate community observations with source-aware freshness and active-index expiry. | Ready | Unassigned | D1 lifecycle | Open |
| D2-009 | Complete Chrome Web Store disclosure, permission, privacy, security, and release checks. | Ready | Unassigned | D0 policy/legal | Open |

## Exit criteria

- [ ] Extension capabilities and requested permissions are understandable and minimal.
- [ ] No unrelated browsing history, cookies, authentication data, or third-party form values are collected.
- [ ] Users preview and explicitly approve every shared job contribution.
- [ ] Contributions are idempotent, sanitized, moderated, verified, deduplicated, and provenance-preserving.
- [ ] Offline/retry behavior cannot duplicate contributions or lose the user's private save.
- [ ] Community observations improve freshness without being treated as unquestioned source truth.
- [ ] Store policy, security, privacy, accessibility, adapter, and end-to-end tests pass.
- [ ] The extension can be disabled by version/domain without affecting web/mobile/catalog availability.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| — | No delivery work recorded yet. | — | — |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| — | None recorded. | — | — |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D2-R1 | Open | Browser-store review can reject overbroad permissions or unclear collection disclosures. | Unassigned | Design around optional hosts and explicit user actions from the first prototype. |
| D2-R2 | Open | Malicious/incorrect UGC can poison the catalog. | Unassigned | Require verification, source reputation, moderation, and rapid takedown controls. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
