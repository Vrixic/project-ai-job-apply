# D1 — Useful Web Product and Canonical Job Catalog

- Status: In progress
- Start: 2026-08-11
- Completion: Not completed
- Owners: Platform engineering; product owner
- Last updated: 2026-08-12
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
| D1-002 | Implement resume import, fact confirmation, preferences, and progressive profile onboarding. | In progress | Platform engineering | D0 profile schemas | Direct-entry facts and secure quarantine intake are deployed and accepted in development. Profile `0005` and Documents `0002` are deployed and verified. Scan-result consumption, isolated deterministic parsing, immutable proposal evidence, explicit proposal review, bounded polling, alarms, and dark infrastructure are implemented and locally verified but the processing runtime is not deployed. Artifact publication, dark deployment, synthetic acceptance, and expanded onboarding remain. Real resumes remain blocked. [Profile-fact foundation](evidence/d1-profile-fact-foundation-2026-08-12.md), [secure resume intake](evidence/d1-secure-resume-intake-foundation-2026-08-12.md), [resume processing foundation](evidence/d1-resume-processing-foundation-2026-08-12.md), [development migration](evidence/d1-development-resume-processing-migration-2026-08-12.md) |
| D1-003 | Ingest permitted Greenhouse, Lever, and Ashby job postings with provenance. | Ready | Unassigned | D0 legal/source review | Open |
| D1-004 | Implement company/job canonicalization, deduplication, lifecycle, verification, and expiry. | Complete | Platform engineering | D0 job schemas | Pure rules, job-owned SQL, default-deny synthetic persistence, exact/concurrent identity, review-only probable candidates, lifecycle/expiry/tombstones, authenticated reads, reversible source-preserving resolution, and immutable audit are implemented. Development schema `0003`, gateway alias `11`, synthetic merge/reopen acceptance, 16 healthy alarms, clean logs, empty ECS, API/trigger checks, and zero drift pass. [Development acceptance](evidence/d1-development-duplicate-resolution-acceptance-2026-08-12.md) |
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
| 2026-08-12 | Applied and verified the D1-002 development database prerequisite through Profile `0005`, Jobs `0003`, and Documents `0002`. One checksum-reviewed, durable-claim-protected task exited `0`; four aggregate-only success logs, zero active tasks/services, encrypted state, and a refresh-backed plan with zero proposed changes passed. No processing trigger or real-data path was enabled. | D1-002 | [Development resume processing migration](evidence/d1-development-resume-processing-migration-2026-08-12.md) |
| 2026-08-12 | Implemented and independently reviewed the resume processing release candidate: exact-plan GuardDuty events, encrypted replay-safe queueing, separate no-DB parser and coordinator Lambdas, short-lived exact-object capabilities, bounded deterministic PDF/DOCX normalization, Profile-owned proposed facts with immutable spans, explicit accessible review, independent dark activation controls, stuck-state reconciliation, alarms, and staging lifecycle controls. Full repository checks, all Terraform tests, deterministic artifact builds, and disposable PostgreSQL 16 migration/transaction tests pass. Bootstrap/migration/publication, dark deployment, and generated-synthetic acceptance remain; ADR-023 stays proposed until those gates pass. | D1-002 | [Resume processing foundation](evidence/d1-resume-processing-foundation-2026-08-12.md), [ADR-023](../../adr/023-isolate-untrusted-document-parsing.md) |
| 2026-08-12 | Implemented and locally verified the first secure resume-intake boundary: strict PDF/DOCX metadata, local SHA-256, exact five-minute direct-S3 grants, owner-scoped metadata and value-free audit, dedicated document scopes, a responsive BFF/browser flow, and off-by-default private KMS/GuardDuty quarantine infrastructure. Nothing is deployed and parsing remains deliberately unavailable. | D1-002 | [Secure resume intake](evidence/d1-secure-resume-intake-foundation-2026-08-12.md), [ADR-022](../../adr/022-quarantine-and-scan-candidate-document-uploads.md) |
| 2026-08-12 | Published the exact merged artifacts, applied profile migration `0004`, released gateway alias `12`, and completed product-owner browser acceptance. One synthetic skill persisted after refresh, correction appended version `2`, rejection appended version `3`, and a second account could not see it. API `200/200/401`, 16 alarms, bounded logs, idle ECS, RDS protection/PITR, and zero drift pass. | D1-002 | [Profile-fact foundation](evidence/d1-profile-fact-foundation-2026-08-12.md) |
| 2026-08-12 | Implemented the first D1-002 slice from OpenAPI through responsive web: strict direct-entry facts, server-assigned confirmation/provenance, candidate ownership, append-only correction/rejection, expected-version concurrency, idempotency, value-free audit metadata, exact Lambda routes, and server-held-token BFF endpoints. A fresh disposable PostgreSQL 16 database passed all profile integration cases and was removed. Deployment acceptance and secure resume parsing remain. | D1-002 | [Profile-fact foundation](evidence/d1-profile-fact-foundation-2026-08-12.md) |
| 2026-08-12 | Reconciled the already deployed jobs `0003` migration and gateway alias `11`, then ran one checksum-reviewed synthetic acceptance task. Probable separation, canonical two-source read, lossless reopen, independent provenance, two immutable audit events, zero running tasks, 16 healthy alarms, clean logs, API/trigger health, and exact-live-input zero drift pass. D1-004 is complete without enabling real sources, UGC, or production data. | D1-004 | [Development duplicate-resolution acceptance](evidence/d1-development-duplicate-resolution-acceptance-2026-08-12.md) |
| 2026-08-11 | Implemented the internal synthetic-only probable-duplicate resolution boundary without overlapping D1-007's future admin/reporting surface. Exact review creates a reversible alias, canonical reads aggregate redacted provenance, reopen is lossless, topology conflicts fail closed, and versioned audit events retain only opaque reviewer IDs plus reason codes. The full verifier and all 9 PostgreSQL integration tests pass. Development migration/release and deployed synthetic acceptance remain. | D1-004 | [Canonical duplicate resolution](evidence/d1-canonical-duplicate-resolution-2026-08-11.md) |
| 2026-08-11 | Applied the reviewed two-update correction to immutable alias version `10`. Artifact checksum/no-weighted-routing, before-and-after steady-state checks, `200/200/401`, all 16 direct cases including missing-job `404`, 16 healthy alarms, zero unhandled failures, and zero drift passed. The product owner then received the sanitized browser success confirming the server-held session has `jobs:read`. The development job-read recovery gate is complete; D1-004 continues for moderation and end-to-end catalog acceptance. | D1-004 | [Development release and acceptance recovery](evidence/d1-development-job-read-api-release-2026-08-11.md) |
| 2026-08-11 | Applied the checksum-reviewed two-update diagnostic release to alias version `9`; artifact identity, no weighted routing, full steady-state preflight, alarms, and `200/200/401` passed. One direct missing-job replay emitted only `/v1/jobs/:jobId`, `TypeError`, and `ERR_INVALID_ARG_TYPE`. Locally changed the bundled PostgreSQL freshness parameter from a `Date` object to its ISO primitive while retaining parameterization; 12/12 jobs tests, 40/40 gateway tests, type checks, and the Lambda build pass. Merge and deployed correction acceptance remain. | D1-004 | [Development release and acceptance recovery](evidence/d1-development-job-read-api-release-2026-08-11.md) |
| 2026-08-11 | Published the exact merged recovery artifact through a product-owner-approved temporary development SSO exception after GitHub Actions failed before runner allocation. Applied the reviewed two-update plan to alias version `8`; `200/200/401`, the original 15 cases, 16 alarms, and zero drift passed. Browser acceptance and a newly added direct job-route case returned `500`. One read-only migration-family task proved permissions and the exact SQL succeed with no RDS error. Added a privacy-safe error classifier and permanent missing-job boundary case; local gateway/web tests pass. Diagnostic merge/release and root correction remain. | D1-004 | [Development release and acceptance recovery](evidence/d1-development-job-read-api-release-2026-08-11.md) |
| 2026-08-11 | Applied the first immutable development job-read release with reviewed checksum, exact route scopes, healthy alarms, and zero drift. Authenticated acceptance corrected an Auth0 per-application scope ceiling, then exposed Lambda timeouts on the protected read. Locally removed the unnecessary profile identity write from shared catalog reads, bounded the conformance request, added regression coverage, passed the full verifier, and built the corrected artifact reproducibly. The corrected artifact is not published or released; D1-004 remains in progress. | D1-004 | [Development release and acceptance recovery](evidence/d1-development-job-read-api-release-2026-08-11.md) |
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
