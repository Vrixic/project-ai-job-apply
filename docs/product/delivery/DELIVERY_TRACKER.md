# Delivery Tracker

Last updated: 2026-07-28
Program status: In progress
Program start: 2026-07-27
Program completion: Not completed

This is the master record for the delivery phases defined in the [product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#20-delivery-roadmap). It intentionally tracks actual start and completion dates rather than predicted schedules.

## Summary

| ID | Delivery | Status | Start | Completion | Living task document |
|---|---|---|---|---|---|
| D0 | Product, data, and legal foundation | In progress | 2026-07-27 | Not completed | [Phase 0 tasks](phase-0-foundation.md) |
| D1 | Useful web product and canonical job catalog | Not started | Not started | Not completed | [Phase 1 tasks](phase-1-web-and-job-catalog.md) |
| D2 | Extension and community loop | Not started | Not started | Not completed | [Phase 2 tasks](phase-2-extension-and-community.md) |
| D3 | High-quality application preparation | Not started | Not started | Not completed | [Phase 3 tasks](phase-3-application-preparation.md) |
| D4 | Workday and remote preparation | Not started | Not started | Not completed | [Phase 4 tasks](phase-4-workday-and-remote.md) |
| D5 | Personalized outreach and application notifications | Not started | Not started | Not completed | [Phase 5 tasks](phase-5-outreach-and-notifications.md) |
| D6 | Mobile and paid launch | Not started | Not started | Not completed | [Phase 6 tasks](phase-6-mobile-and-paid.md) |
| D7 | Quality optimization, expansion, and optional employer product | Not started | Not started | Not completed | [Phase 7 tasks](phase-7-quality-and-expansion.md) |

## D0 — Product, data, and legal foundation

- Status: In progress
- Start: 2026-07-27
- Completion: Not completed
- Depends on: Approved product direction
- Task document: [Phase 0 tasks](phase-0-foundation.md)
- Exit gate: Schemas, policies, threat/data maps, engineering foundation, and an authenticated end-to-end skeleton are reviewed and evidenced.

## D1 — Useful web product and canonical job catalog

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 foundation and owned schemas
- Task document: [Phase 1 tasks](phase-1-web-and-job-catalog.md)
- Exit gate: Users can reliably find, understand, save, report, and track fresh canonical jobs.

## D2 — Extension and community loop

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 consent/security foundations and D1 job contribution APIs
- Task document: [Phase 2 tasks](phase-2-extension-and-community.md)
- Exit gate: Users can privately save and explicitly contribute a public job without unrelated browsing or profile data being collected.

## D3 — High-quality application preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D0 facts/contracts and D1 jobs; may use D2 active-tab extension
- Task document: [Phase 3 tasks](phase-3-application-preparation.md)
- Exit gate: Users can prepare, review by exception, approve, submit, and confirm applications on supported ATS sites with measured factuality and field accuracy.

## D4 — Workday and remote preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D3 application packets, workflows, adapter SDK, and approval invariants
- Task document: [Phase 4 tasks](phase-4-workday-and-remote.md)
- Exit gate: Supported Workday/remote variants operate safely with isolation, takeover, revalidation, confirmation, and conservative fallback.

## D5 — Personalized outreach and application notifications

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: D1 application history, D3 application truth, and D0 privacy/OAuth policies
- Task document: [Phase 5 tasks](phase-5-outreach-and-notifications.md)
- Exit gate: Relevant application notifications and truthful, user-approved outreach work without inbox/calendar access or post-submission outcome tracking.

## D6 — Mobile and paid launch

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: Stable APIs from D1–D5 and provider-neutral entitlement contracts
- Task document: [Phase 6 tasks](phase-6-mobile-and-paid.md)
- Exit gate: Web, mobile, extension, billing, support, accessibility, and privacy behavior form a reliable cross-device Free/Pro experience.

## D7 — Quality optimization, expansion, and optional employer product

- Status: Not started
- Start: Not started
- Completion: Not completed
- Depends on: Trustworthy preference/workflow-quality data and stable production foundations from prior deliveries
- Task document: [Phase 7 tasks](phase-7-quality-and-expansion.md)
- Exit gate: Application-quality optimization is governed; every new ATS, region, or employer capability passes its own readiness and isolation gates.

## Program work log

Append only material cross-delivery events.

| Date | Delivery | Update | Evidence |
|---|---|---|---|
| 2026-07-28 | Program | Delivery tracking system created; D0 remains in progress and D1–D7 remain not started. | This tracker and linked phase documents |
| 2026-07-28 | Program | Product scope refocused on rapid, tailored applications ending at confirmed submission. | Updated architecture, READMEs, tracker, and phase documents |

## Cross-delivery decisions and changes

| Date | Decision or change | Reason | Affected deliveries | Evidence |
|---|---|---|---|---|
| 2026-07-28 | Track actual start/completion without forecast dates. | Delivery is governed by quality gates rather than schedule predictions. | D0–D7 | Architecture delivery-roadmap principles |
| 2026-07-28 | Exclude all coaching and post-submission hiring-outcome tracking. | The product is focused on rapid, tailored, confirmed applications. | D0–D7 | Updated product architecture and phase records |

## Program blockers and risks

| ID | State | Risk or blocker | Affected deliveries | Owner | Mitigation or next action |
|---|---|---|---|---|---|
| PR-001 | Open | Launch segment, geography, and product name are not yet selected. | D0 onward | Unassigned | Resolve during D0 product foundation. |
