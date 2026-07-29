# D1 — Useful Web Product and Canonical Job Catalog

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d1--useful-web-product-and-canonical-job-catalog)

## Objective

Deliver a trustworthy candidate web experience and canonical job catalog in which users can onboard, discover, understand, save, report, and track fresh jobs.

## Deployment posture

Add D1 modules to the existing lean runtime. Keep one task per service and PostgreSQL full-text/
pgvector as appropriate; do not add replicas, Redis, a dedicated search cluster, an ALB, or
always-on staging without measured workload or a release/recovery requirement.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D1-001 | Implement managed authentication, sessions, device controls, and gateway authorization. | Ready | Unassigned | D0 identity ADR | Open |
| D1-002 | Implement resume import, fact confirmation, preferences, and progressive profile onboarding. | Ready | Unassigned | D0 profile schemas | Open |
| D1-003 | Ingest permitted Greenhouse, Lever, and Ashby job postings with provenance. | Ready | Unassigned | D0 legal/source review | Open |
| D1-004 | Implement company/job canonicalization, deduplication, lifecycle, verification, and expiry. | Ready | Unassigned | D0 job schemas | Open |
| D1-005 | Implement search, filters, saved jobs, and explainable baseline matching. | Ready | Unassigned | D1-002, D1-004 | Open |
| D1-006 | Implement technical application history through confirmed submission and an in-app action inbox. | Ready | Unassigned | D0 application schemas | Open |
| D1-007 | Implement job reporting, source controls, and admin moderation. | Ready | Unassigned | D1-004 | Open |
| D1-008 | Implement Free/Pro entitlement skeleton without coupling features directly to payment providers. | Ready | Unassigned | D0 billing contract | Open |
| D1-009 | Implement crawlable job detail pages, canonical URLs, structured data, and expired-job removal. | Ready | Unassigned | D1-004 | Open |
| D1-010 | Add end-to-end observability, accessibility, security, reliability, and restore tests for the delivery. | Ready | Unassigned | D0 platform foundation | Open |
| D1-011 | Obtain source-specific legal approval and real-candidate-onboarding privacy/security approval before production activation. | Ready | Legal/privacy counsel; security/privacy reviewers | D0 foundational approvals; concrete sources and deployed data flow | Release gate LR-D1-01 through LR-D1-04; synthetic-only work may precede approval. |

## Exit criteria

- [ ] A user can authenticate, import/confirm profile facts, and set job preferences.
- [ ] Permitted sources produce canonical jobs with provenance and repeatable deduplication.
- [ ] Freshness, expiry, reports, and admin controls prevent known stale/blocked jobs from normal discovery.
- [ ] Search and matching enforce hard constraints and provide grounded explanations.
- [ ] Saved-job and technical application-history state is durable, authorized, observable, and recoverable.
- [ ] `applied` is terminal; no recruiter/interview/offer result can be stored.
- [ ] Public job pages use correct canonical/expiry behavior and accessibility standards.
- [ ] Core APIs meet the initial reliability objectives under representative load and provider failures.
- [ ] Security, privacy, accessibility, and product acceptance reviews have evidence.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-28 | Assigned source-specific and real-candidate-data approval to D1 without starting implementation. | D1-011 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| — | None recorded. | — | — |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D1-R1 | Open | Job-source permission and field quality may differ by provider. | Unassigned | Complete D0 source register and provider-specific contracts. |
| D1-R2 | Open | Matching quality cannot be evaluated without a defined launch segment and representative cases. | Unassigned | Complete D0 segment decision and evaluation set. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
