# D6 — Mobile and Paid Launch

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d6--mobile-and-paid-launch)

## Objective

Deliver a reliable mobile companion and a simple provider-neutral Free/Pro subscription experience across web, mobile, and extension.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D6-001 | Implement React Native/Expo identity, navigation, API layer, secure storage, and deep links. | Ready | Unassigned | Stable D1–D5 APIs | Open |
| D6-002 | Implement mobile onboarding/profile corrections, job feed, search, save, hide, and report. | Ready | Unassigned | D1 | Open |
| D6-003 | Implement push notifications, action inbox, application packet review/approval, and technical history through confirmed submission. | Ready | Unassigned | D3, D5 | Open |
| D6-004 | Implement application-agent controls and desktop/remote-task handoff. | Ready | Unassigned | D3–D5 | Open |
| D6-005 | Implement Stripe web subscription lifecycle and internal entitlement projection. | Ready | Unassigned | D0 billing contracts | Open |
| D6-006 | Implement StoreKit/Google Play subscription/receipt adapters where required by current policies. | Ready | Unassigned | Store/legal review | Open |
| D6-007 | Implement grace periods, cancellation, paid-through access, reconciliation, restore purchase, receipts, and support adjustments. | Ready | Unassigned | D6-005, D6-006 | Open |
| D6-008 | Implement one Pro product with transparent fair-use visibility and no hidden paid tiers. | Ready | Unassigned | Product/pricing decision | Open |
| D6-009 | Complete cross-device session/state/deep-link behavior, accessibility, store disclosures, support, and privacy lifecycle. | Ready | Unassigned | D6-001–D6-008 | Open |
| D6-010 | Complete device, billing replay, provider outage, entitlement, accessibility, security, and store-release tests. | Ready | Unassigned | D6-001–D6-009 | Open |

## Exit criteria

- [ ] Mobile reliably supports its declared companion scope without pretending to automate arbitrary ATS pages.
- [ ] Cross-device deep links and resumable tasks preserve identity, intent, and application state.
- [ ] Application approval on mobile follows the same immutable-packet and revalidation rules.
- [ ] Mobile contains no coaching, interview preparation, inbox/calendar reading, or post-submission hiring-outcome tracking.
- [ ] One internal entitlement model reconciles Stripe, StoreKit, and Google Play without direct feature/provider coupling.
- [ ] Billing outages and delayed webhooks do not incorrectly revoke valid paid access.
- [ ] Cancellation, paid-through access, restore, receipt, refund/support, and account deletion behavior is tested.
- [ ] There is one understandable Pro product, with monthly/annual intervals and transparent fair-use safeguards.
- [ ] Accessibility, privacy disclosures, mobile-store policy, security, support, and product acceptance evidence is complete.

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
| D6-R1 | Open | Store billing/linking rules vary by storefront and change over time. | Unassigned | Revalidate official policies immediately before implementation and release. |
| D6-R2 | Open | Provider webhook delay/replay can create entitlement mismatch. | Unassigned | Use idempotent webhooks, internal projection, grace, and scheduled reconciliation. |
| D6-R3 | Open | Mobile scope can expand into unreliable embedded ATS automation. | Unassigned | Keep mobile focused on discovery, review, approval, confirmed-submission history, and secure handoff. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
