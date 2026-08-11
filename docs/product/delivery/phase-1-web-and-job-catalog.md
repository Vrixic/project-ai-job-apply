# D1 — Useful Web Product and Canonical Job Catalog

- Status: In progress
- Start: 2026-08-11
- Completion: Not completed
- Owners: Platform engineering; product owner
- Last updated: 2026-08-11
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d1--useful-web-product-and-canonical-job-catalog)

## Objective

Deliver a trustworthy candidate web experience and canonical job catalog in which users can onboard, discover, understand, save, report, and track fresh jobs.

## Deployment posture

Add D1 modules to the accepted scale-to-zero Lambda/durable-workflow runtime. Use PostgreSQL
full-text/pgvector as appropriate; do not add replicas, Redis, a dedicated search cluster, an ALB,
continuously provisioned application compute, or always-on staging without measured workload or a
release/recovery requirement. Keep staging dormant between bounded acceptance windows.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D1-001 | Implement managed authentication, sessions, device controls, and gateway authorization. | Ready | Unassigned | D0 identity ADR | Open |
| D1-002 | Implement resume import, fact confirmation, preferences, and progressive profile onboarding. | Ready | Unassigned | D0 profile schemas | Open |
| D1-003 | Ingest permitted Greenhouse, Lever, and Ashby job postings with provenance. | Ready | Unassigned | D0 legal/source review | Open |
| D1-004 | Implement company/job canonicalization, deduplication, lifecycle, verification, and expiry. | In progress | Platform engineering | D0 job schemas | Contract correction, pure rules, job-owned SQL schema/migration, default-deny synthetic repository, concurrent exact merge, review-only probable duplicates, verification failure handling, expiry, tombstone cleanup, and the composed migration image pass locally. The exact scanned image, one-off task definition, and jobs schema are deployed and verified in development. The authenticated active-job read API is implemented and locally verified but not deployed. Auth0 `jobs:read`, reviewed artifact/runtime release, deployed API acceptance, moderation resolution, and end-to-end catalog acceptance remain. [Foundation evidence](evidence/d1-canonical-job-foundation-2026-08-11.md), [development migration evidence](evidence/d1-development-job-catalog-migration-2026-08-11.md), [read-API evidence](evidence/d1-canonical-job-read-api-2026-08-11.md) |
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
| 2026-08-11 | Implemented the authenticated active-job read slice through OpenAPI, generated types, exact `jobs:read` enforcement, Lambda route validation, PostgreSQL read model/readiness, response redaction, and tests. The full repository verifier and deterministic Lambda packaging pass. This code is not deployed; Auth0 permission setup and a separately reviewed immutable runtime release remain. | D1-004 | [Canonical job read API](evidence/d1-canonical-job-read-api-2026-08-11.md) |
| 2026-08-11 | Published the exact composed migration image to development, applied the checksum-reviewed task-definition and backup-retention plan, and ran exactly one transactional migration task. Profile migrations replayed through `0003`; the jobs-owned schema applied and verified through `0001`; logs were aggregate-only; the cluster returned to zero tasks; API `200/200/401` and a full zero-drift plan passed. Real sources, public UGC, real candidate data, and production activation remain disabled. | D1-004 | [Development job-catalog migration](evidence/d1-development-job-catalog-migration-2026-08-11.md) |
| 2026-08-11 | Started D1 with a synthetic-only canonical catalog slice. Corrected the pre-release lifecycle contract, implemented deterministic identity precedence and non-automatic fuzzy review, created the job-owned PostgreSQL schema/checksum migration and fail-fast multi-owner migration image, default-denied unapproved provenance, and locally proved exact/concurrent replay, probable separation, repeated-failure transitions, terminal blocking, expiry, and raw-content tombstoning. | D1-004 | [Canonical catalog foundation](evidence/d1-canonical-job-foundation-2026-08-11.md) |
| 2026-07-28 | Assigned source-specific and real-candidate-data approval to D1 without starting implementation. | D1-011 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-11 | Begin synthetic-only D1 implementation while D0 external approvals remain open. Real provider ingestion, public UGC, real candidate data, and production activation remain prohibited. | ADR-011 already authorizes reproducible synthetic work; waiting adds no safety to code-only contract and persistence foundations. | [D0 direct-state acceptance](evidence/d0-staging-on-demand-direct-state-acceptance-2026-08-11.md), [ADR-011](../../adr/011-staged-preproduction-data-and-founder-pilot.md) |

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
