# D4 — Workday and Remote Preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d4--workday-and-remote-preparation)

## Objective

Extend the application system to supported Workday variants and isolated remote browser preparation while preserving user control, safe takeover, session security, revalidation, and conservative fallback.

## Deployment posture

Create remote browsers only per approved task and terminate them immediately. Keep concurrency
capped at the smallest safe value; add browser pools or dedicated ATS capacity only from queue,
isolation, failure, or demand evidence. Do not keep idle browser fleets running.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D4-001 | Catalog and prioritize representative Workday tenant, account, widget, and application variants. | Ready | Unassigned | D0 fixtures; D3 telemetry | Open |
| D4-002 | Implement Workday detection, session/account state, multi-step form, and custom-widget behavior pack. | Ready | Unassigned | D3 ATS SDK | Open |
| D4-003 | Detect and correct resume-parser overwrites without replacing user-confirmed facts. | Ready | Unassigned | D3 fact/document model | Open |
| D4-004 | Implement ephemeral isolated browser runtime, lifecycle, resource limits, and domain/egress controls. | Ready | Unassigned | D0 infrastructure/security | Open |
| D4-005 | Implement encrypted session handoff and destruction without storing plaintext credentials. | Ready | Unassigned | D0 identity/threat model | Open |
| D4-006 | Implement secure web/mobile takeover for login, MFA, CAPTCHA, and ambiguous questions. | Ready | Unassigned | D3 workflow; D6 may enhance mobile | Open |
| D4-007 | Implement pre-submit job/form/packet revalidation and changed-field review. | Ready | Unassigned | D3 approval hash | Open |
| D4-008 | Implement ambiguous-submit reconciliation and confirmation evidence. | Ready | Unassigned | D3 application state | Open |
| D4-009 | Implement per-variant canaries, telemetry, kill switches, and active-tab/manual fallback. | Ready | Unassigned | D3 adapter release system | Open |
| D4-010 | Complete isolation, takeover, session, redirect, cleanup, replay, security, and load testing. | Ready | Unassigned | D4-001–D4-009 | Open |
| D4-011 | Obtain Workday/tenant-specific legal and independent security/privacy approval for remote-browser and session processing. | Ready | Legal/privacy counsel; independent security reviewer | Concrete variants, runtime, data flow, isolation and test evidence | Release gate LR-D4-01; live tenant/remote execution remains disabled until approved. |

## Exit criteria

- [ ] Supported Workday variants are explicitly declared, fixture-tested, and independently disableable.
- [ ] Browser sessions are isolated, resource-bounded, egress-restricted, and destroyed after use.
- [ ] Plaintext credentials, unrestricted cookies, and sensitive field values do not enter logs/events/analytics.
- [ ] Login, MFA, CAPTCHA, and ambiguous legal/sensitive fields always support safe user takeover.
- [ ] Resume-import overwrites and material form changes are detected and re-reviewed.
- [ ] Timeout/ambiguous submission handling prevents duplicate attempts.
- [ ] Active-tab and manual fallback preserve the application packet when remote work fails.
- [ ] Security, privacy, isolation, reliability, load, adapter, and product acceptance evidence is complete.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-28 | Assigned Workday and remote-browser delta approval to D4 without starting implementation. | D4-011 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| — | None recorded. | — | — |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D4-R1 | Open | Workday behavior varies by tenant and can require candidate accounts or changing widgets. | Unassigned | Define a supported-variant matrix rather than claiming universal support. |
| D4-R2 | Open | Remote sessions concentrate sensitive data and account access. | Unassigned | Complete a dedicated threat model and isolation review before implementation. |
| D4-R3 | Open | Third-party anti-automation changes can block remote execution. | Unassigned | Preserve active-tab/manual fallback and do not bypass site security controls. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
