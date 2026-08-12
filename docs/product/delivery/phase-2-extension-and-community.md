# D2 — Extension and Community Loop

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-08-12
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
| D2-001 | Implement Manifest V3 identity, side panel/popup, background worker, and secure API session. | Ready | Unassigned | D0 identity; D1 gateway | Open |
| D2-002 | Implement current-page job detection for Greenhouse, Lever, and Ashby. | Ready | Unassigned | D2-011 | Open |
| D2-003 | Implement explicit save/contribution preview with field-level visibility and removal. | Ready | Unassigned | D1 contribution API; D0 consent | Open |
| D2-004 | Implement local sanitization, narrow optional host permissions, and privacy-safe telemetry. | Ready | Unassigned | D0 threat/privacy review | Open |
| D2-005 | Implement idempotent upload and safe offline pending-contribution retry. | Ready | Unassigned | D1 job service | Open |
| D2-006 | Implement server normalization, verification, moderation, provenance, and deduplication. | Ready | Unassigned | D1 catalog/trust | Open |
| D2-007 | Implement contributor/source trust signals, closed-job reports, takedowns, and appeals. | Ready | Unassigned | D1 trust/admin | Open |
| D2-008 | Integrate community observations with source-aware freshness and active-index expiry. | Ready | Unassigned | D1 lifecycle | Open |
| D2-009 | Complete Chrome Web Store disclosure, permission, privacy, security, and release checks. | Ready | Unassigned | D0 policy/legal | Open |
| D2-010 | Obtain accountable UGC, extension-permission, privacy, security, and store approval before public contribution or distribution. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete contribution flow and extension manifest | Release gates LR-D2-01 and LR-D2-02; keep contribution/store release disabled until approved. |
| D2-011 | Define supported job-page variants and acquire authorized, sanitized provider fixtures with separate QA representativeness acceptance. | Ready | QA/automation; capability reviewers | D0-007 process; exact detection scope and source authorization | Blocking provider-evidence gate under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md); synthetic fixtures do not satisfy it. |

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

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
