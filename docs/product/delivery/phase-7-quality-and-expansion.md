# D7 — Quality Optimization, Expansion, and Optional Employer Product

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-28
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d7--quality-optimization-expansion-and-optional-employer-product)

## Objective

Use trustworthy in-product preference and workflow-quality evidence to improve rapid application preparation and expand ATS, geographic, and product coverage without weakening isolation, fairness, privacy, maintainability, or candidate trust.

## Deployment posture

Post-launch scaling remains evidence driven. Increase replicas, caches, search, browser pools,
Multi-AZ/cross-region capacity, or service separation only for measured demand, recovery, security,
or ownership boundaries; remove or scale down capacity whose value is not demonstrated.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D7-001 | Validate saves, hides, preparation choices, field/document corrections, freshness, technical failures, and confirmed-submission signals. | Ready | Unassigned | D1–D6 production signals | Open |
| D7-002 | Implement governed preference/workflow-quality ranking with offline evaluation, bias analysis, canary, rollback, and explanation continuity. | Ready | Unassigned | D7-001 | Open |
| D7-003 | Prioritize and add ATS adapters from measured demand using the standard adapter contract and release gates. | Ready | Unassigned | D3/D4 adapter system | Open |
| D7-004 | Add regions only after localization, taxonomy, work authorization, salary, privacy, legal, support, and source readiness. | Ready | Unassigned | Region-specific review | Open |
| D7-005 | Add permitted company/job context for tailored applications with cited provenance. | Ready | Unassigned | D1/D5 data policies | Open |
| D7-006 | Advance SOC 2/security readiness, restore evidence, operational controls, and warm-region disaster recovery when justified. | Ready | Unassigned | Stable production operation | Open |
| D7-007 | Define an explicit go/no-go decision and separate architecture for any employer product. | Ready | Unassigned | Candidate product evidence | Open |
| D7-008 | If approved, implement verified organizations, employer RBAC, jobs, application receipt, applicant consent/visibility, ATS handoff, and separate billing without candidate outcome tracking. | Ready | Unassigned | D7-007 | Optional; not assumed. |
| D7-009 | Verify that expansion has no regression in candidate privacy, application quality, fairness, reliability, cost, or support quality. | Ready | Unassigned | Each expansion task | Open |
| D7-010 | Obtain a legal, security, and privacy delta approval for every new country, source, ATS, data use, or employer-side capability. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete expansion readiness record | Release gate LR-D7-01; each expansion remains independently disabled until approved. |

## Exit criteria

- [ ] Learning signals distinguish explicit preferences and workflow quality from technical failures and stale jobs.
- [ ] No recruiter response, interview, offer, rejection, or other post-submission outcome is collected or used.
- [ ] Ranking changes are calibrated, explainable, fairness-reviewed, canaried, observable, and reversible.
- [ ] Every new ATS passes fixtures, conformance, canary, kill-switch, fallback, and quality gates.
- [ ] Every new geography passes explicit data, legal, privacy, language, salary, authorization, taxonomy, source, and support gates.
- [ ] Company/job context is permitted, cited, fresh enough for application tailoring, and resistant to unsupported claims.
- [ ] Security/operational maturity changes have tested evidence rather than compliance-only documentation.
- [ ] Any employer product has an approved go/no-go record, separate bounded context, explicit candidate visibility/consent, and no hidden candidate-data subsidy.
- [ ] Expansion meets application-quality and reliability guardrails without compromising prior deliveries.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-28 | Assigned per-expansion delta approval to D7 without starting implementation. | D7-010 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-07-28 | Employer product is optional and requires a separate go/no-go decision. | Candidate trust and the candidate-first data boundary must not be implicitly changed. | Architecture scope and privacy principles |
| 2026-07-28 | Ranking optimization uses only in-product preferences and workflow-quality signals. | The Platform does not track post-submission hiring outcomes. | Updated product architecture |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D7-R1 | Open | In-product interaction data contains selection and technical-failure bias. | Unassigned | Keep signal definitions explicit, exclude stale/technical failures from fit labels, and use controlled rollout. |
| D7-R2 | Open | Expansion breadth can outpace adapter, legal, taxonomy, support, or operational quality. | Unassigned | Require a readiness record and exit gate per ATS/region rather than bundling expansion. |
| D7-R3 | Open | Employer monetization can conflict with candidate privacy and trust. | Unassigned | Keep a separate bounded context and require explicit, reversible candidate visibility. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
