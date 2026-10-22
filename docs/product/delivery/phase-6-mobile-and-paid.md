# D6 — Mobile and Paid Launch

- Status: In progress
- Start: 2026-09-28
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-09-28
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
| D6-003 | Render D3 Applications-owned packet review/approval and technical history through confirmed submission, and consume D5 Notifications-owned push/action-inbox contracts. | Ready | Unassigned | D3, D5; [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) | Mobile owns neither application lifecycle truth nor inbox delivery truth. |
| D6-004 | Implement application-agent controls and desktop/remote-task handoff. | Ready | Unassigned | D3–D5 | Open |
| D6-005 | Implement Stripe web subscription lifecycle and project provider events into the provider-neutral entitlement model. | In progress | Unassigned | D1-008 entitlement contract; D6-008 product/pricing decision; provider/legal review before activation | Stripe remains an adapter; feature code consumes only the internal entitlement projection. 2026-10-22: adapter library in `backend/services/billing/src/stripe` (signature check, subscription projection with paid-through and grace, Stripe client, webhook handler that re-reads the subscription, checkout and portal service, config that is off unless complete). Unit-tested against a fake Stripe only; no Stripe account or live key used. Gateway routes added 2026-10-22: `POST /v1/billing/checkout-sessions`, `POST /v1/billing/portal-sessions` (profile:write, no body) and the public signed `POST /v1/billing/webhooks/stripe` (raw body kept only for that route, 256 KiB cap); all three exist only when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRETS`, `STRIPE_PRO_PRICE_ID` and `BILLING_APP_BASE_URL` are all set. Owner-gated, not done: the API Gateway no-authorizer route for the webhook, the Lambda environment and secret storage for the Stripe keys, and the Stripe account, product and price. The Settings page now has a Pro subscription section (upgrade through Stripe Checkout, manage through the customer portal, only Stripe-hosted URLs are followed); it shows an error when billing is not configured. Nothing was run against live Stripe. |
| D6-006 | Implement StoreKit/Google Play subscription/receipt adapters where required by current policies. | Ready | Unassigned | Store/legal review | Open |
| D6-007 | Implement grace periods, cancellation, paid-through access, reconciliation, restore purchase, receipts, and support adjustments. | In progress | Claude | D6-005, D6-006 | 2026-10-22 done for the Stripe web path: a three-day grace window after the paid-through time, cancellation that keeps access to period end, and reconciliation by pulling the candidate's own subscription (`POST /v1/billing/subscription-syncs`, run automatically on returning from checkout and on a Check payment status button; a missing Stripe subscription never downgrades). Open: a scheduled reconciliation sweep (needs a scheduler, an AWS addition), support adjustments (needs an admin surface), receipts (Stripe emails them), and restore purchase (mobile, D6-006). |
| D6-008 | Implement one Pro product with transparent fair-use visibility and no hidden paid tiers. | Complete | Claude | Product/pricing decision | 2026-10-22 under the owner's go-with-recommendations direction: one paid plan, Pro, with the same features as Free and a higher stored-resume limit (Free 1, Pro 2, ADR-032, `planLimitsVersion` 3; the owner set Pro to 2 on 2026-10-22). Settings shows the plan, the paid-through date and the limit. The owner set the price at $25 a month; the price itself lives in the Stripe product and is created in the Stripe account, not in code. |
| D6-009 | Complete cross-device session/state/deep-link behavior, store disclosures, support, and privacy lifecycle. | Ready | Unassigned | D6-001–D6-008 | Open |
| D6-010 | Complete Android/iOS PKCE, refresh rotation/replay, logout, cancellation, current/all-device revocation, recovery/lost-device, billing replay and entitlement security tests. Provider-outage, accessibility and store-release testing removed 2026-10-21. | Ready | Unassigned | D6-001–D6-009 | Mobile Auth0 conformance must use representative real devices/builds and sanitized evidence; local shell tests alone are insufficient. |
| D6-011 | Obtain storefront, billing, account-deletion, legal and security approval before public mobile or paid release. | Ready | Legal counsel; security reviewers | Concrete applications, products, disclosures and test evidence | Release gate LR-D6-01; no public store release until approved. |
| D6-012 | Finalize the public product name and production domain, complete conflict/domain/store/linguistic screening, and obtain product/counsel approval. | Ready | Product owner; legal counsel | Public-release candidate and production-origin plan | ApplyDash remains swappable and provisional; no production OAuth branding, email, store listing, paid release, or public launch before approval. |
| D6-013 | Provision on-demand staging for the launch candidate so the independent assessor can test it. Load and recovery measurement removed 2026-10-21. | Ready | Platform engineering; product owner | Stable D1–D6 candidate; AWS/provider access | Default remains lean; activate only the availability/capacity controls justified by evidence. |
| D6-014 | Provision dedicated staging and production Auth0 tenants and environment-specific clients/APIs, cut staging over from the temporary shared development issuer, and replay applicable conformance before launch. | Ready | Platform engineering; security/privacy engineering | D0 identity baseline; D6-012; launch candidate | The Auth0 Free-plan exception in ADR-014 is synthetic-only. Production never trusts development identity, and no real-user staging or launch proceeds until isolation and replay pass. |
| D6-015 | Complete an independent open-book security assessment and penetration test of the inherited foundation and exact launch candidate, remediate and independently retest findings, and obtain the signed release disposition. | Ready | Independent security reviewer; platform/security engineering; product-risk owner | D0 review package and pre-audit; D6-001–D6-014; production-equivalent staging; exact release candidate | Inherits removed D0-015 under [ADR-020](../../adr/020-defer-accountable-foundation-security-review-to-launch.md). Review FR-01–FR-13 and the foundation evidence, then test the complete product under [ADR-015](../../adr/015-independent-prelaunch-security-review.md). Public launch is blocked by incomplete scope, unresolved Critical/High findings, unapproved Medium findings, or missing remediation/retest/sign-off. |
| D6-016 | Obtain accountable foundational legal counsel review of the then-current product and public-launch candidate. | Ready | Qualified US legal counsel; product owner | D0 review package; D1–D6 concrete providers, data flows, terms, notices, jurisdictions, and launch candidate | Transferred from D0-014 under [ADR-019](../../adr/019-defer-foundational-counsel-review-to-public-launch.md). Counsel must disposition LR-F01–LR-F07, reconcile every capability-specific legal gate, record conditions and revalidation, and provide an attributable conclusion before public launch. |
| D6-017 | Complete the browser-extension store and launch release carried from D2-009/D2-010: Chrome Web Store and Edge Add-ons policy review, disclosures, listing screenshots from the exact enabled artifact, a monitored support channel, and exact-candidate accountable approval. | Ready | Unassigned | D6-011; D6-015; D6-016; D6-012 | Carried from Phase 2 by owner decision on 2026-09-18; not passed. See the [D2 release checklist](../../../frontend/extension/store/release-checklist.md). |
| D6-018 | Prove the extension's live Chrome and Edge sign-in lifecycle carried from D2-012: PKCE, refresh rotation and replay, cancellation, logout, and provider revocation, with browser parity. | Ready | Unassigned | D6-014 | Carried from Phase 2 on 2026-09-18; deterministic source tests and initial Edge login exist; the live matrix was not run. |
| D6-019 | Complete the extension's installed-browser assurance carried from D2-015/D2-016: manual screen-reader testing, deeper Chrome/Edge lifecycle, load/abuse acceptance, and a live domain/version disable-and-re-enable drill. | Removed | Unassigned | D6-013; D6-017 | Removed 2026-10-21 by owner decision (non-security assurance). The kill-switch itself stays implemented. |
| D6-020 | Write the production launch plan: scope, workstreams, owner inputs, order of work, and what is not claimed, so the deferred Phase 2 items and the rest of D6 have one ordered route to production. | Complete | Engineering; product owner | D6 gates above | [production launch plan](d6-production-launch-plan.md) (2026-09-28). A plan, not an approval; no production resource exists or is authorized by it. |
| D6-021 | Create the production Terraform environment in its own AWS account: bootstrap and state, workload boundary, OIDC role, budgets, alarms, backups, and a dormant-by-default lean runtime, reviewed only through saved plans. | Ready | Engineering; product owner (creates the account, approves each plan) | Production AWS account; D6-014 for identity inputs | Next engineering task. Design and validation can start without an apply; no account exists yet. |
| D6-022 | Refresh the exposure inventory to every current route, event receiver, object-access path, and service interface, each with exactly one owned exposure class, generated from the OpenAPI and infrastructure and kept current by a test. | Ready | Engineering; security engineering | D1 to D5 route set | The inventory in the API security baseline is the foundation snapshot only; resume delete, applications, contributions, and extension routes are missing. Feeds D6-015. |
| D6-023 | Prepare the extension's exact production release candidate and its configuration (accountable pending-item retention duration, UGC policy version, signing key overlap), and build the guarded operator for the live domain and version disable-and-re-enable drill. | Ready | Engineering; product owner | D6-021; D6-014 | Prerequisite for D6-017 and D6-019. The retention duration, policy version, and keys need accountable approval. |
| D6-024 | Assemble the review packages for counsel (D6-016) and the independent assessor (D6-015): scope, data flows, exposure inventory, threat model, rules of engagement, test roles, and evidence index, without recording secrets. | Ready | Engineering; product owner | D6-022; assessor and counsel selected | Packages only; no legal or security conclusion is inferred. |
| D6-025 | Prepare launch operations: monitored support channel, alarm routing, incident and rollback runbooks, vulnerability intake, and the go/no-go checklist. Restore and kill-switch drills removed 2026-10-21. | Ready | Engineering writes; product owner staffs | D6-021; D6-013 | Support-email setup and monitoring were deferred from D2 and are needed for the store listing. |

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
- [ ] Privacy disclosures, mobile-store policy, security and support are complete. Accessibility and product acceptance were removed 2026-10-21.
- [ ] Qualified counsel has reviewed the then-current nationwide-US product, providers, data
      flows, terms/notices, external actions, and exact public-launch candidate; every
      release-blocking condition is closed or the affected capability remains disabled.
- [ ] The final public product name and production domain are owned, screened, approved, and consistently configured across web, mobile, extension, OAuth, email, stores, and support.
- [ ] On-demand staging exists for the independent assessor. Capacity and recovery measurement was removed 2026-10-21.
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
| 2026-10-21 | Owner removed non-security testing and acceptance work: D6-019 Removed; D6-009, D6-010, D6-013 and D6-025 reduced to their security, privacy and launch-readiness parts. D6-015, D6-016, D6-014 and the security parts of D6-010/D6-018 are unchanged. | D6-009, D6-010, D6-013, D6-019, D6-025 | Owner direction 2026-10-21 |
| 2026-09-28 | D6 started. Wrote the production launch plan after the owner asked to put all deferred Phase 2 items into production: the extension needs the whole platform in production, no production account, Auth0 tenant, name, counsel, or assessor exists yet, and each is listed as an owner input. Added D6-020 to D6-025 (plan, production Terraform, exposure inventory, extension release candidate and disable-drill operator, review packages, launch operations). | D6-020 to D6-025 | [production launch plan](d6-production-launch-plan.md) |
| 2026-08-17 | Clarified that mobile renders/consumes D3 Applications truth and D5 Notifications inbox/delivery truth rather than inheriting a D1 history or inbox owner. This allocation does not start D6. | D6-003 | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) |
| 2026-08-15 | Corrected the nonexistent D0 billing-contract dependency: D0 accepted product and provider-neutral direction, D1-008 authors the executable internal entitlement contract, and D6 provider adapters consume it. This is a dependency correction only; D6 did not start and no provider or paid access was activated. | D6-005 | [D1 tasks](phase-1-web-and-job-catalog.md), [architecture billing model](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#15-billing-free-plus-one-paid-plan) |
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
| 2026-10-22 | D1 completed with deployment items carried here: D6-021 takes the retention-Lambda deployment and the ADR-023 DNS residual; D6-014 takes production and dedicated moderator identity; D6-012 gates public job-page publication and indexing. | D1 has no AWS or production work of its own after the owner removed D1-011 and the acceptance gates. | Owner direction 2026-10-22 |
| 2026-10-22 | Owner removed privacy reviews and approvals from all phases: privacy is dropped from the D6-011, D6-015 and D6-016 scopes and reviewer roles. Security and legal review, and the ADR-015 independent assessment, remain. | The owner prioritizes feature delivery; privacy controls stay in code, not as review gates. | Owner direction 2026-10-22 |
| 2026-09-28 | **Owner scope decision:** put the deferred Phase 2 items into production first, with production covering everything in D6 rather than the extension alone; the owner skipped the product name and domain decision and left the Auth0 production-tenant decision open. Started D6 with the launch plan and sequenced work that needs neither decision first. | The extension depends on the production API, identity, catalog, and support surface, so it cannot launch alone. | [production launch plan](d6-production-launch-plan.md) |
| 2026-08-17 | Keep D6-003 dependent on D3/D5 owner contracts and prohibit mobile from owning a parallel lifecycle or inbox truth. | Cross-device presentation must preserve the same authoritative owner boundaries as web and backend workflows. | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) |
| 2026-08-15 | Make D1-008 the owner of the first executable provider-neutral entitlement contract and require D6 provider adapters to consume it. | D0 accepted Free/Pro direction but did not create the billing contract previously named as a D6 dependency; correcting the dependency avoids coupling feature authorization directly to Stripe or store payloads. | [D1 tasks](phase-1-web-and-job-catalog.md), [architecture billing model](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#15-billing-free-plus-one-paid-plan) |
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
| D6-R7 | Blocked | Foundational counsel review was deferred from D0 and no attributable legal conclusion exists. | Product owner; future legal counsel | Retain qualified counsel before launch-candidate freeze, complete D6-016 against the then-current product, and close or disable every affected capability. |
| D6-R8 | Open | No production AWS account, dedicated Auth0 tenant, approved name and domain, selected counsel, or selected independent assessor exists, and each is on the critical path of the deferred extension release and the rest of D6. Owner input needed for each. | Product owner | Answer the five owner inputs in the [production launch plan](d6-production-launch-plan.md); engineering proceeds with the work that needs none of them. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
