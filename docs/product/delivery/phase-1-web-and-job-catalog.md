# D1 — Useful Web Product and Canonical Job Catalog

Status: Complete. Started: 2026-08-11. Completion: 2026-10-22. Updated: 2026-10-22.

## Task register

| Capability | Implemented | Remaining |
|---|---|---|
| Authentication (D1-001) | Managed sign-in, sessions, MFA/recovery and owner-scoped Gateway authorization are implemented and development-verified. | None in D1. Production identity is D6-014. |
| Onboarding (D1-002) | Resume intake, parsing, fact confirmation, preferences and profile editing are implemented; synthetic development processing has evidence. | None in D1. ADR-023 real-resume controls and the DNS residual are carried to D6-021 (production AWS). |
| Ingestion (D1-003) | Source-neutral ingestion and Greenhouse/Lever/Ashby adapters are implemented; one bounded Linear/Ashby activation is accepted. | None in D1. Release composition is a deployment item (D6-021). Other sources are vetted by the automated system (D7-012), not by per-source approval. |
| Canonical jobs (D1-004) | Deduplication, provenance, lifecycle, expiry and audited duplicate resolution are implemented and development-verified. | No remaining implementation item in this task. |
| Discovery (D1-005) | Search, filters, durable saved jobs and explainable matching are implemented; basic signed-in search and save/reload passed human review. | None. Acceptance testing removed 2026-10-21. |
| Application history/inbox (D1-006) | Removed from D1: Applications history belongs to D3 and the generic inbox belongs to D5. | No D1 implementation. |
| Moderation (D1-007) | Reports, source pause, moderation APIs and the admin interface are implemented. | None in D1. The dedicated moderator identity is carried to D6-014. |
| Entitlements (D1-008) | Provider-neutral Free/Pro entitlements and plan-driven limits are implemented and development-verified. | Payments and paid launch belong to D6. |
| Public job pages (D1-009) | Job detail, canonical URLs, truth-bound structured data, sitemap and expiry handling are implemented. | None in D1. Public publication and indexing need the production domain (D6-012); abuse protection stays a security item under D6-015. |
| Assurance (D1-010A, D1-010B) | Automated browser/API, recovery, representative workload and alert checks have bounded development evidence. | Removed 2026-10-21 (non-security assurance). Security review is D6-015. |
| Real-data authority (D1-011) | Source activation records and real-candidate approval requirements are defined. | Removed 2026-10-22 by owner decision: sources are user-contributed and vetted by an automated AI system (D7-012), so there is no per-source or per-candidate-data owner approval gate. |
| Retention (D1-012) | Report/case expiry, privileged audit capture, candidate report export and private maintenance artifacts are locally verified. | Deploying the maintenance Lambdas is an AWS change, carried to D6-021. Capture/expiry/alert acceptance and mailbox retention verification are removed. |
| Migrations (D1-013) | Guarded migration images and restore tooling were built at 79 migrations/96 relations (81 migrations now); managed legacy receipt maintenance has passed. | Superseded: D3 maintains the tooling (migration 0018 is applied); no D1 work remains. |

## Exit criteria

Owner decisions 2026-10-21 and 2026-10-22: hosted admin, accessibility, reliability,
matching-correctness and product acceptance are removed, D1-011 is removed, and AWS changes are
carried to D6. One criterion remains.

- [x] Onboarding, discovery, moderation and public pages are implemented and were reached in the hosted development app during D1 and D3 testing (see the evidence links below).

## Real-data approval

Removed 2026-10-22 (D1-011). Job sources are added by users and vetted by an automated system
(D7-012). The ADR-023 controls for real resumes still apply, and the control's DNS residual is
carried to D6-021.

## Evidence

- [Identity acceptance](evidence/d1-managed-identity-gateway-authorization-acceptance-2026-08-13.md)
- [Source activation](evidence/d1-ashby-linear-development-activation-record-2026-08-24.md)
- [Moderation policy](../foundation/d1-reporting-moderation-policy-review-disposition.md)
- [Retention deployment gaps](evidence/d1-retention-live-configuration-2026-10-07.md)
- [Current managed release and stopping point](evidence/d3-native-application-disposal-2026-10-07.md)

## Work log

2026-10-09: Fixed search-result heading order and filter-label contrast required by the connected
D3 browser journey. Local browser keyboard/axe checks pass with synthetic responses; independent
D1 acceptance and hosted admin acceptance remain deferred. [Evidence](evidence/d3-connected-candidate-journey-2026-10-09.md).

2026-10-21: Owner removed non-security testing, acceptance and evidence work from this phase
(see exit criteria and the Assurance row). Security items are unchanged.

2026-10-22: Owner removed privacy reviews and approvals from all phases; the privacy items above
now read as security or real-data authority only.

Historical checkpoints are retained in Git history and the linked evidence; this document records current status only.

## Decisions and scope changes

| Date | Decision or change | Reason |
|---|---|---|
| 2026-10-22 | Removed D1-011 (real-data and source authority). Job sources come from users and are vetted by an automated AI system, tracked as D7-012. | Per-source owner approval does not fit a user-contributed catalog. |
| 2026-10-22 | Completed D1. Items that need AWS changes or production resources are carried to D6 (D6-012, D6-014, D6-021). | The owner directed completion with no AWS changes. |

## Completion record

- Completion date: 2026-10-22
- Exit review: owner-directed close-out. No new test run was made for it. The capabilities were implemented and development-verified earlier (evidence above).
- Release/evidence summary: implemented and development-verified only. Nothing in D1 is deployed to production.
- Carried to D6, not done: retention-Lambda deployment and the ADR-023 DNS residual (D6-021), production and moderator identity (D6-014), public job-page publication and indexing (D6-012).
- Accepted residual risks: the carried items above; automated source vetting does not exist yet (D7-012).
