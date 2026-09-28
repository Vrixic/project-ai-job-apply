# D6 production launch plan

- Status: Draft plan, written 2026-09-28. Nothing in it is deployed, approved, or decided beyond the owner decisions listed below.
- Task: [D6-020](phase-6-mobile-and-paid.md#task-register)
- Purpose: turn the launch gates already recorded in D6 into one ordered work plan, separating what engineering can build now from what only the owner, counsel, an independent assessor, a provider, or a store can do.

## Scope decided by the owner (2026-09-28)

- The deferred Phase 2 items go to production first: store review (D6-017), the live Chrome and Edge sign-in matrix (D6-018), and installed-browser assurance (D6-019).
- Production is for the whole product, not the extension alone: web, catalog, community contribution, candidate documents and applications, mobile, and paid plans, as D6 defines them. The extension cannot ship alone because it needs the production API, identity, catalog, and support surface.
- Product name and domain: **skipped for now** (the owner declined to decide). ApplyDash and `applydash.ai` stay provisional and block everything that needs a public identity (D6-012).
- Auth0 production tenant: **not decided** (needs a plan upgrade or a provider change, D6-014).

## What "production" means here

Real candidates on a production domain, in a production AWS account and a production identity tenant, after the ADR-015 independent assessment and counsel review. None of that exists yet. Today there are a development account (continuous, synthetic data) and a staging account (on demand, dormant, synthetic data, temporarily trusting the development issuer under ADR-014).

## Starting state (inspected 2026-09-28)

| Area | State |
|---|---|
| AWS | Development and staging accounts only ([ADR-007](../../adr/007-isolated-aws-environments.md)). No production account, state, bootstrap, or Terraform environment. |
| Identity | One Auth0 tenant shared by development and synthetic staging. Production never trusts it. |
| D1 web and catalog | In progress: resume import, ingestion, search, reporting and moderation, entitlements, and public job pages each still have open work. |
| D2 extension | Complete for controlled development only. Store review, live sign-in matrix, screen-reader testing and load/abuse acceptance are unpassed. |
| D3 application preparation | In progress (D3-023 open, D3-028 new, ADR-032 and ADR-033 unaccepted). |
| D3.1, D4, D5, D6 | Not started (D6 starts with this plan). |
| Exposure inventory | The [inventory](../../security/api-security-and-final-review.md#current-foundation-exposure-inventory) is the foundation baseline; routes added since (resume delete, applications, contributions, extension) are not in it. |

## Workstreams

Owners: **E** engineering (me), **O** product owner, **C** counsel, **A** independent assessor, **S** store or provider.

| # | Workstream | What is done | Who | Blocked by |
|---|---|---|---|---|
| W0 | Decisions and inputs | Owner input list below | O | nothing |
| W1 | Production infrastructure | Terraform environment `production` (own account, state, boundary, OIDC role, budgets, alarms, backups, dormant-by-default runtime) reviewed by saved plans only | E; O creates the AWS account and approves each plan | W0 account |
| W2 | Production identity | Dedicated production and staging Auth0 tenants, clients, APIs; staging cutover from the shared issuer; replay of the conformance matrix ([D6-014](phase-6-mobile-and-paid.md#task-register)) | E; O (plan upgrade, admin MFA) | W0 Auth0 decision |
| W3 | Product completeness | Finish the D1 open items, D3, D3.1, D4, D5, then D6-001 to D6-010 (mobile, Stripe and store billing) | E; O (decisions) | scope and sequencing; each delivery's own gates |
| W4 | Extension release | Exact release candidate and configuration (retention duration, UGC policy version, signing keys), live Chrome/Edge sign-in matrix (D6-018), disable-and-re-enable drill operator and run, load and abuse acceptance (D6-019), store listing materials (D6-017) | E; O; S (review) | W1, W2, W6 |
| W5 | Security assurance | Current exposure inventory for every route, staging load and recovery run (D6-013), assessor scope and rules of engagement, exact-candidate freeze, remediation and retest (D6-015) | E prepares; A tests | W1, W2, W3 |
| W6 | Legal, privacy, identity | Naming and domain screening (D6-012), counsel review (D6-016), storefront, billing and account-deletion approvals (D6-011), UGC policy and retention approvals | O; C | W0 name, counsel selection |
| W7 | Operations | Support channel, alarm routing, incident and rollback runbooks, restore drill in production-equivalent staging, kill-switch drills, vulnerability intake, go/no-go checklist | E writes; O staffs | W1 |

## Owner inputs needed (in the order they unblock work)

1. **Production AWS account** (separate from development and staging), and permission to bootstrap it. Unblocks W1.
2. **Auth0 decision**: upgrade for separate tenants, or migrate provider. Unblocks W2, W4 sign-in matrix.
3. **Product name and domain** (or an explicit decision to launch under a placeholder for closed testing only). Unblocks W6 and every public identity.
4. **Counsel and independent assessor** selection, with an engagement date before candidate freeze (D6-R6, D6-R7).
5. **Sequencing of D1/D3 to D5 completion** versus starting W1 to W2 in parallel. Recommendation: start W1 and the inventory now; they do not depend on D3 to D5.

## Order of work

1. **Now (no owner input):** W5 inventory refresh from the OpenAPI, W1 Terraform design and validation without an apply, W4 release-candidate tooling and the disable-drill operator, W7 runbook drafts, W6 review packages for counsel and the assessor.
2. **When the AWS account exists:** bootstrap, then a saved plan with applications disabled, for the owner to review.
3. **When the Auth0 decision exists:** tenants, clients, cutover, conformance replay.
4. **In parallel with W1 to W2:** finish D1, D3, D3.1, D4, D5, then mobile and billing.
5. **Candidate freeze:** exact commit and image digests; staging load and recovery run; assessor tests; remediation and retest.
6. **Release gates:** counsel conclusion, store approvals, signed disposition, then a staged production activation behind the kill switches, with the extension last.

## What this plan does not claim

- It is not an approval of any legal, privacy, security, store, billing, or naming decision, and it schedules nothing by date.
- No production resource exists and none is authorized by this document. Every apply needs a saved plan the owner reviews.
- The extension's store review, screen-reader testing, live sign-in matrix and load/abuse acceptance stay unpassed until their own evidence exists.
