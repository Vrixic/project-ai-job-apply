# D6 — Mobile and Paid Launch

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-08-12
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d6--mobile-and-paid-launch)

## Objective

Deliver a reliable mobile companion and a simple provider-neutral Free/Pro subscription experience across web, mobile, and extension.

## Deployment posture

Remain on the lean runtime for launch unless representative load, recovery testing, security
review, or provider limits require additional capacity. Provision isolated staging on demand for
the launch candidate, measure it, and activate only the replicas, private egress, Multi-AZ data,
cache, WAF, or ALB controls supported by evidence.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D6-001 | Provision the dedicated Auth0 Native Application and implement React Native/Expo identity, navigation, API layer, secure storage, and deep links. | Ready | Unassigned | Stable D1–D5 APIs; D0 identity baseline | The Phase 0 shell is locally verified only; real provider/device evidence is intentionally deferred here. |
| D6-002 | Implement mobile onboarding/profile corrections, job feed, search, save, hide, and report. | Ready | Unassigned | D1 | Open |
| D6-003 | Implement push notifications, action inbox, application packet review/approval, and technical history through confirmed submission. | Ready | Unassigned | D3, D5 | Open |
| D6-004 | Implement application-agent controls and desktop/remote-task handoff. | Ready | Unassigned | D3–D5 | Open |
| D6-005 | Implement Stripe web subscription lifecycle and project provider events into the provider-neutral entitlement model. | Ready | Unassigned | D1-008 entitlement contract; D6-008 product/pricing decision; provider/legal review before activation | Stripe remains an adapter; feature code consumes only the internal entitlement projection. |
| D6-006 | Implement StoreKit/Google Play subscription/receipt adapters where required by current policies. | Ready | Unassigned | Store/legal review | Open |
| D6-007 | Implement grace periods, cancellation, paid-through access, reconciliation, restore purchase, receipts, and support adjustments. | Ready | Unassigned | D6-005, D6-006 | Open |
| D6-008 | Implement one Pro product with transparent fair-use visibility and no hidden paid tiers. | Ready | Unassigned | Product/pricing decision | Open |
| D6-009 | Complete cross-device session/state/deep-link behavior, accessibility, store disclosures, support, and privacy lifecycle. | Ready | Unassigned | D6-001–D6-008 | Open |
| D6-010 | Complete Android/iOS PKCE, refresh rotation/replay, logout, cancellation, current/all-device revocation, recovery/lost-device, billing replay, provider outage, entitlement, accessibility, security, and store-release tests. | Ready | Unassigned | D6-001–D6-009 | Mobile Auth0 conformance must use representative real devices/builds and sanitized evidence; local shell tests alone are insufficient. |
| D6-011 | Obtain storefront, billing, account-deletion, legal, security, and privacy approval before public mobile or paid release. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete applications, products, disclosures and test evidence | Release gate LR-D6-01; no public store release until approved. |
| D6-012 | Finalize the public product name and production domain, complete conflict/domain/store/linguistic screening, and obtain product/counsel approval. | Ready | Product owner; legal counsel | Public-release candidate and production-origin plan | ApplyDash remains swappable and provisional; no production OAuth branding, email, store listing, paid release, or public launch before approval. |
| D6-013 | Provision on-demand staging for the launch candidate, run representative load/recovery tests, and record an evidence-based launch-capacity decision. | Ready | Platform engineering; product owner | Stable D1–D6 candidate; AWS/provider access | Default remains lean; activate only the availability/capacity controls justified by evidence. |
| D6-014 | Provision dedicated staging and production Auth0 tenants and environment-specific clients/APIs, cut staging over from the temporary shared development issuer, and replay applicable conformance before launch. | Ready | Platform engineering; security/privacy engineering | D0 identity baseline; D6-012; launch candidate | The Auth0 Free-plan exception in ADR-014 is synthetic-only. Production never trusts development identity, and no real-user staging or launch proceeds until isolation and replay pass. |
| D6-015 | Complete an independent open-book security/privacy assessment and penetration test of the inherited foundation and exact launch candidate, remediate and independently retest findings, and obtain the signed release disposition. | Ready | Independent security/privacy reviewer; platform/security engineering; product-risk owner | D0 review package and pre-audit; D6-001–D6-014; production-equivalent staging; exact release candidate | Inherits removed D0-015 under [ADR-020](../../adr/020-defer-accountable-foundation-security-review-to-launch.md). Review FR-01–FR-13 and the foundation evidence, then test the complete product under [ADR-015](../../adr/015-independent-prelaunch-security-review.md). Public launch is blocked by incomplete scope, unresolved Critical/High findings, unapproved Medium findings, or missing remediation/retest/sign-off. |
| D6-016 | Obtain accountable foundational legal/privacy counsel review of the then-current product and public-launch candidate. | Ready | Qualified US legal/privacy counsel; product owner | D0 review package; D1–D6 concrete providers, data flows, terms, notices, jurisdictions, and launch candidate | Transferred from D0-014 under [ADR-019](../../adr/019-defer-foundational-counsel-review-to-public-launch.md). Counsel must disposition LR-F01–LR-F07, reconcile every capability-specific legal gate, record conditions and revalidation, and provide an attributable conclusion before public launch. |

## Exit criteria

- [ ] Mobile reliably supports its declared companion scope without pretending to automate arbitrary ATS pages.
- [ ] The dedicated mobile OIDC client passes PKCE, secure-storage, refresh replay, logout,
      cancellation, revocation, recovery, and lost-device conformance on representative Android
      and iOS devices.
- [ ] Cross-device deep links and resumable tasks preserve identity, intent, and application state.
- [ ] Application approval on mobile follows the same immutable-packet and revalidation rules.
- [ ] Mobile contains no coaching, interview preparation, inbox/calendar reading, or post-submission hiring-outcome tracking.
- [ ] One internal entitlement model reconciles Stripe, StoreKit, and Google Play without direct feature/provider coupling.
- [ ] Billing outages and delayed webhooks do not incorrectly revoke valid paid access.
- [ ] Cancellation, paid-through access, restore, receipt, refund/support, and account deletion behavior is tested.
- [ ] There is one understandable Pro product, with monthly/annual intervals and transparent fair-use safeguards.
- [ ] Accessibility, privacy disclosures, mobile-store policy, security, support, and product acceptance evidence is complete.
- [ ] Qualified counsel has reviewed the then-current nationwide-US product, providers, data
      flows, terms/notices, external actions, and exact public-launch candidate; every
      release-blocking condition is closed or the affected capability remains disabled.
- [ ] The final public product name and production domain are owned, screened, approved, and consistently configured across web, mobile, extension, OAuth, email, stores, and support.
- [ ] On-demand staging evidence records launch capacity, recovery behavior, provider limits, and every approved deviation from the lean defaults.
- [ ] Dedicated staging and production Auth0 tenants are isolated from development, staging has
      cut over from the temporary issuer, and applicable client, lifecycle, outage, ownership, and
      recovery conformance has been replayed before real-user staging or public launch.
- [ ] Every externally reachable domain, API, route, method, webhook, object-access path, admin
      surface, and cloud service has an owned exposure class and appears in the tested inventory.
- [ ] Independent testing of the exact launch candidate covers anonymous and authenticated API
      use, cross-user/cross-role/property authorization, identity/session lifecycle, abuse and
      resource exhaustion, web/mobile/extension clients, application-agent business logic,
      cloud/IAM/configuration, supply chain, data protection, recovery, and incident readiness.
- [ ] The independent reviewer has dispositioned FR-01–FR-13 and the inherited Phase 0 evidence,
      reconciled every material change since the engineering pre-audit, and included resulting
      findings in the exact-candidate remediation and retest record.
- [ ] No Critical or High finding remains open; every remaining Medium has expiring accountable
      acceptance and compensating controls; material fixes passed independent retest; the
      independent reviewer and product owner signed the exact-release disposition.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-08-15 | Corrected the nonexistent D0 billing-contract dependency: D0 accepted product and provider-neutral direction, D1-008 authors the executable internal entitlement contract, and D6 provider adapters consume it. This is a dependency correction only; D6 did not start and no provider or paid access was activated. | D6-005 | [D1 tasks](phase-1-web-and-job-catalog.md), [architecture billing model](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#15-business-model-and-billing-architecture) |
| 2026-07-28 | Assigned mobile, billing, and storefront delta approval to D6 without starting implementation. | D6-011 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-07-28 | Accepted final public naming/domain approval as a D6 release gate without starting D6 implementation. | D6-012 | [Naming brief](../foundation/naming-brief.md), [ADR-009](../../adr/009-swappable-presentation-brand.md) |
| 2026-07-28 | Assigned on-demand staging and evidence-based launch-capacity review to D6 without starting implementation. | D6-013 | [ADR-013](../../adr/013-lean-until-demand-cloud-runtime.md) |
| 2026-07-29 | Accepted real mobile Auth0 Native Application provisioning and Android/iOS device conformance from D0 without starting D6. The locally verified Expo shell remains reusable preparation only. | D6-001, D6-010 | [ADR-012 amendment](../../adr/012-auth0-initial-managed-identity.md), [Auth0 conformance matrix](../../security/auth0-development-conformance.md) |
| 2026-07-30 | Accepted dedicated staging/production Auth0 tenant provisioning, cutover, and replay as a blocking launch task without starting D6. Synthetic Phase 0 staging may temporarily trust the development issuer, but cannot claim identity isolation or accept real users. | D6-014 | [ADR-014](../../adr/014-shared-development-auth0-for-synthetic-staging.md), [Auth0 baseline](../../security/auth0-configuration-baseline.md) |
| 2026-07-31 | Added the independent final security assessment as a blocking D6 release task without starting D6. The gate tests the exact deployed web/API/mobile/extension/application-agent/cloud candidate, requires explicit API exposure classes and unauthorized-access tests, and governs remediation, retest, residual-risk expiry, and sign-off. | D6-015 | [API security and final-review baseline](../../security/api-security-and-final-review.md), [ADR-015](../../adr/015-independent-prelaunch-security-review.md) |
| 2026-08-12 | Accepted the product-owner transfer of foundational counsel review from D0 to a mandatory public-launch gate. No legal approval was inferred; the review must cover the then-current product and reconcile the delivery-specific legal/provider decisions before launch. | D6-016 | [ADR-019](../../adr/019-defer-foundational-counsel-review-to-public-launch.md), [legal disposition worksheet](../foundation/foundational-legal-privacy-disposition.md) |
| 2026-08-12 | Accepted the product-owner transfer of accountable foundation security/privacy review from removed D0-015 into D6-015. The independent exact-candidate assessment must inspect the inherited foundation package and pre-audit in addition to the finished attack surface. | D6-015 | [ADR-020](../../adr/020-defer-accountable-foundation-security-review-to-launch.md), [engineering pre-audit](evidence/d0-security-privacy-engineering-preaudit-2026-08-12.md), [review record](../../security/phase-0-accountable-review-record.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-15 | Make D1-008 the owner of the first executable provider-neutral entitlement contract and require D6 provider adapters to consume it. | D0 accepted Free/Pro direction but did not create the billing contract previously named as a D6 dependency; correcting the dependency avoids coupling feature authorization directly to Stripe or store payloads. | [D1 tasks](phase-1-web-and-job-catalog.md), [architecture billing model](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#15-business-model-and-billing-architecture) |
| 2026-07-28 | Defer final public naming from D0 to D6 while retaining ApplyDash as the swappable development identity. | Naming is not a foundation dependency but must be settled before production OAuth, email, stores, billing, or public launch. | [Naming brief](../foundation/naming-brief.md) |
| 2026-07-28 | Keep launch capacity lean unless staging/load/recovery evidence requires a specific control. | Scaling is a measured operational decision, not an automatic consequence of completing product phases. | [ADR-013](../../adr/013-lean-until-demand-cloud-runtime.md) |
| 2026-07-29 | Perform real mobile identity/provider/device conformance in D6 rather than D0. | Conformance should test the actual mobile application and remains a blocking mobile-release gate, while current delivery stays focused on web. | [ADR-012 amendment](../../adr/012-auth0-initial-managed-identity.md) |
| 2026-07-30 | End the temporary shared-development Auth0 staging exception before real-user staging or launch. | Shared users, keys, logs, administration, availability, and failure modes do not provide environment isolation. | [ADR-014](../../adr/014-shared-development-auth0-for-synthetic-staging.md) |
| 2026-07-31 | Require an independent, open-book assessment and penetration test of the exact launch candidate before public release. | Foundation review, internal tests, and automated scanners cannot independently prove deployed API authorization, complete external-surface coverage, product-specific business-logic safety, cloud posture, or remediation. | [ADR-015](../../adr/015-independent-prelaunch-security-review.md), [final-review baseline](../../security/api-security-and-final-review.md) |
| 2026-08-12 | Defer foundational counsel review from D0 to D6 without treating it as approved. | Synthetic-only foundation work does not require immediate counsel, while concrete public terms, providers, jurisdictions, data flows, and the launch candidate require attributable review before release. | [ADR-019](../../adr/019-defer-foundational-counsel-review-to-public-launch.md) |
| 2026-08-12 | Defer accountable foundation security/privacy disposition from D0 to D6-015 after the engineering pre-audit passes, without treating it as approved. | The independent reviewer should assess the inherited foundation together with the complete deployed product and exact release candidate; all earlier capability gates remain enforceable. | [ADR-020](../../adr/020-defer-accountable-foundation-security-review-to-launch.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D6-R1 | Open | Store billing/linking rules vary by storefront and change over time. | Unassigned | Revalidate official policies immediately before implementation and release. |
| D6-R2 | Open | Provider webhook delay/replay can create entitlement mismatch. | Unassigned | Freeze D1-008's provider-neutral event/idempotency/reconciliation contract before implementing Stripe/store adapters; test delay, replay, out-of-order delivery, outage grace, and repair. |
| D6-R3 | Open | Mobile scope can expand into unreliable embedded ATS automation. | Unassigned | Keep mobile focused on discovery, review, approval, confirmed-submission history, and secure handoff. |
| D6-R4 | Open | ApplyDash and `applydash.ai` are provisional and may fail ownership, conflict, trademark, store, or linguistic review. | Product owner | Complete D6-012 before any public-release identity becomes irreversible. |
| D6-R5 | Blocked | The current Auth0 Free subscription provides one tenant, so synthetic staging temporarily shares the development issuer and cannot prove identity-provider isolation. | Product owner; platform engineering | Before real-user staging or launch, upgrade Auth0 or migrate providers, provision dedicated staging/production tenants, cut over, and replay the applicable conformance matrix. |
| D6-R6 | Open | The independent final assessor is unassigned, and incomplete scope or late authorization/business-logic findings can block launch. | Product owner; security owner | Select an independent qualified assessor before launch-candidate freeze, agree scope/rules of engagement, reserve remediation and retest, and keep every public surface in the owned inventory. |
| D6-R7 | Blocked | Foundational counsel review was deferred from D0 and no attributable legal conclusion exists. | Product owner; future legal/privacy counsel | Retain qualified counsel before launch-candidate freeze, complete D6-016 against the then-current product, and close or disable every affected capability. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
