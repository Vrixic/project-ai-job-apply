# D4 — Workday and Remote Preparation

- Status: In progress
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-08-12
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
| D4-001 | Catalog and prioritize representative Workday tenant, account, widget, and application variants. | Ready | Unassigned | D3 telemetry; D4-012 | 2026-10-22 owner decision: Workday waits until authorized sanitized tenant fixtures exist (D4-012); no Workday adapter is built before then. |
| D4-002 | Implement Workday detection, session/account state, multi-step form, and custom-widget behavior pack. | Ready | Unassigned | D3 ATS SDK | 2026-10-22 owner decision: Workday waits until authorized sanitized tenant fixtures exist (D4-012); no Workday adapter is built before then. |
| D4-003 | Detect and correct resume-parser overwrites without replacing saved Profile entries (imports only create drafts, ADR-052). | Complete | Unassigned | D3 fact/document model | 2026-10-22: satisfied by design. A resume import only creates unsaved drafts and never replaces a saved Profile entry (ADR-052), so a parser overwrite cannot happen. |
| D4-004 | Implement ephemeral isolated browser runtime, lifecycle, resource limits, and domain/egress controls. | Removed | Owner decision | D0 infrastructure/security | 2026-10-22: removed by owner decision. No job filling runs remotely; every application is filled in the candidate's own Chrome by the extension, so no isolated remote browser is built. |
| D4-005 | Implement encrypted session handoff and destruction without storing plaintext credentials. | Removed | Owner decision | D0 identity/threat model | 2026-10-22: removed by owner decision. No job filling runs remotely; every application is filled in the candidate's own Chrome by the extension, so no isolated remote browser is built. |
| D4-006 | Implement secure web/mobile takeover for login, MFA, CAPTCHA, and ambiguous questions. | Removed | Owner decision | D3 workflow; D6 may enhance mobile | 2026-10-22: removed by owner decision. No job filling runs remotely; every application is filled in the candidate's own Chrome by the extension, so no isolated remote browser is built. |
| D4-007 | Implement pre-submit job/form/packet revalidation and changed-field review. | Ready | Unassigned | D3 approval hash | 2026-10-22: for Greenhouse and Ashby the extension executor revalidates the job, packet, approval, materials and the page structure before and after the one click (ADR-049, ADR-053). A Workday adapter would reuse it. |
| D4-008 | Implement ambiguous-submit reconciliation and confirmation evidence. | Ready | Unassigned | D3 application state | 2026-10-22: for Greenhouse and Ashby a result that is not positively confirmed is recorded as ambiguous and blocks another attempt until the candidate reconciles it (ADR-049, ADR-053). Not built for Workday. |
| D4-009 | Implement per-variant canaries, telemetry, kill switches, and active-tab/manual fallback. | Ready | Unassigned | D3 adapter release system | 2026-10-22: per-provider kill switches (the build's execution provider list) and the manual fallback exist for Greenhouse and Ashby; canaries and telemetry are not built. |
| D4-010 | Complete isolation, session, redirect, cleanup and security testing of the remote browser runtime. | Ready | Unassigned | D4-001–D4-009 | Open. Replay, load and takeover-usability testing removed 2026-10-21 (owner decision). 2026-10-22: the remote browser part is removed with D4-004 to D4-006; only the local extension paths remain in scope. |
| D4-011 | Obtain Workday/tenant-specific legal and independent security approval for remote-browser and session processing. | Ready | Legal counsel; independent security reviewer | Concrete variants, runtime, data flow, isolation and test evidence | Release gate LR-D4-01; live tenant/remote execution remains disabled until approved. 2026-10-22: remote-browser and session processing no longer exist, so this gate covers the local Workday extension path only. |
| D4-012 | Acquire authorized, sanitized Workday tenant/widget/application fixtures for the declared supported matrix (no separate QA representativeness acceptance; removed 2026-10-21). | Ready | QA/automation; capability reviewers | D0-007 process; exact Workday scope and source authorization | Blocking provider-evidence gate under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md); synthetic fixtures do not satisfy it. 2026-10-22 owner decision: Workday waits until authorized sanitized tenant fixtures exist (D4-012); no Workday adapter is built before then. |

## Exit criteria

- [ ] Supported Workday variants are explicitly declared, fixture-tested, and independently disableable.
- [ ] Every enabled Workday variant has current authorization, sanitization and scan evidence, and raw-capture disposition.
- [ ] Browser sessions are isolated, resource-bounded, egress-restricted, and destroyed after use.
- [ ] Plaintext credentials, unrestricted cookies, and sensitive field values do not enter logs/events/analytics.
- [ ] Login, MFA, CAPTCHA, and ambiguous legal/sensitive fields always support safe user takeover.
- [ ] Resume-import overwrites and material form changes are detected and re-reviewed.
- [ ] Timeout/ambiguous submission handling prevents duplicate attempts.
- [ ] Active-tab and manual fallback preserve the application packet when remote work fails.
- [ ] Security and isolation evidence is complete. Reliability, load, adapter and product acceptance were removed 2026-10-21.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-28 | Assigned Workday and remote-browser delta approval to D4 without starting implementation. | D4-011 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-08-12 | Accepted ownership of authorized representative Workday fixtures from D0; this assignment does not start D4 or approve a tenant or remote-browser action. | D4-001, D4-012 | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), [fixture policy](../foundation/ats-fixture-policy.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-12 | Workday fixture evidence is acquired and accepted with the declared tenant/behavior matrix. | Workday variability cannot be represented responsibly before the supported matrix exists. | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md) |

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
