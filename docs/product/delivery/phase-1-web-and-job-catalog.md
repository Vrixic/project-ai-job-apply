# D1 — Useful Web Product and Canonical Job Catalog

Status: In progress. Started: 2026-08-11. Completion: Not completed. Updated: 2026-10-09.

## Task register

| Capability | Implemented | Remaining |
|---|---|---|
| Authentication (D1-001) | Managed sign-in, sessions, MFA/recovery and owner-scoped Gateway authorization are implemented and development-verified. | Production identity readiness. |
| Onboarding (D1-002) | Resume intake, parsing, fact confirmation, preferences and profile editing are implemented; synthetic development processing has evidence. | Real-resume privacy controls. |
| Ingestion (D1-003) | Source-neutral ingestion and Greenhouse/Lever/Ashby adapters are implemented; one bounded Linear/Ashby activation is accepted. | Final release composition and source/security acceptance; other sources need their own activation evidence. |
| Canonical jobs (D1-004) | Deduplication, provenance, lifecycle, expiry and audited duplicate resolution are implemented and development-verified. | No remaining implementation item in this task. |
| Discovery (D1-005) | Search, filters, durable saved jobs and explainable matching are implemented; basic signed-in search and save/reload passed human review. | None. Acceptance testing removed 2026-10-21. |
| Application history/inbox (D1-006) | Removed from D1: Applications history belongs to D3 and the generic inbox belongs to D5. | No D1 implementation. |
| Moderation (D1-007) | Reports, source pause, moderation APIs and the admin interface are implemented. | Dedicated moderator identity and operations/security review. |
| Entitlements (D1-008) | Provider-neutral Free/Pro entitlements and plan-driven limits are implemented and development-verified. | Payments and paid launch belong to D6. |
| Public job pages (D1-009) | Job detail, canonical URLs, truth-bound structured data, sitemap and expiry handling are implemented. | Controlled public publication and indexing; abuse protection stays a security item. |
| Assurance (D1-010A, D1-010B) | Automated browser/API, recovery, representative workload and alert checks have bounded development evidence. | Removed 2026-10-21 (non-security assurance). Security review stays under D1-011. |
| Real-data authority (D1-011) | Source activation records and real-candidate approval requirements are defined. | Real-candidate onboarding/rights approval and exact source activation authority. |
| Retention (D1-012) | Report/case expiry, privileged audit capture, candidate report export and private maintenance artifacts are locally verified. | Managed maintenance deployment, capture/expiry/alert acceptance and mailbox/incident retention verification. |
| Migrations (D1-013) | Guarded migration images and restore tooling cover 79 migrations/96 relations; managed legacy receipt maintenance has passed. | Current-source image compatibility and full managed schema/replay acceptance before the next release. |

## Exit criteria

Owner decision 2026-10-21: hosted admin, accessibility, reliability, matching-correctness and
product acceptance are removed. Only the items below remain.

- [ ] Onboarding, discovery, moderation and public pages are implemented and reachable in the hosted app.
- [ ] Security and real-data approval (D1-011) and the managed retention deployment (D1-012) are complete.

## Real-data approval register (product owner)

Real candidate data remains unapproved; bounded external-source reads retain only their recorded authority.
Real resumes additionally require ADR-023 controls; its DNS residual is accepted only for synthetic development.

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
