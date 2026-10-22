# D7 — Quality Optimization, Expansion, and Optional Employer Product

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-07-31
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
| D7-004 | Add regions only after localization, taxonomy, work authorization, salary, legal, support, and source readiness. | Ready | Unassigned | Region-specific review | Open |
| D7-005 | Add permitted company/job context for tailored applications with cited provenance. | Ready | Unassigned | D1/D5 data policies | Open |
| D7-006 | Advance SOC 2/security readiness, restore evidence, operational controls, and warm-region disaster recovery when justified. | Ready | Unassigned | Stable production operation | Open |
| D7-007 | Define an explicit go/no-go decision and separate architecture for any employer product. | Ready | Unassigned | Candidate product evidence | Open |
| D7-008 | If approved, implement verified organizations, employer RBAC, jobs, application receipt, applicant consent/visibility, ATS handoff, and separate billing without candidate outcome tracking. | Ready | Unassigned | D7-007 | Optional; not assumed. |
| D7-009 | Verify that expansion has no regression in security. Application-quality, reliability, cost and support-quality verification removed 2026-10-21. | Ready | Unassigned | Each expansion task | Open |
| D7-010 | Obtain a legal and security delta approval for every new country, source, ATS, data use, or employer-side capability. | Ready | Legal counsel; security reviewers | Concrete expansion readiness record | Release gate LR-D7-01; each expansion remains independently disabled until approved. |
| D7-011 | Operate vulnerability intake/remediation and repeat independent security assessment at least annually and after every material trust-boundary change or serious control failure. | Ready | Security owner; independent security reviewer | D6-015 launch assessment; public operation | Follow [ADR-015](../../adr/015-independent-prelaunch-security-review.md) and retain scoped assessment, remediation, retest, risk-expiry, and exact-release evidence. |
| D7-012 | Automated AI vetting of user-contributed job sources: users submit sources, an AI checks each against policy (authenticity, license, safety, content match) and adds accepted ones to the collection, with rejected and uncertain cases going to the existing trust review queue, with a kill switch and an audit trail. | In progress | Claude | D2 contribution loop; trust service; ai-sdk | 2026-10-22 owner approved ([ADR-054](../../adr/054-automated-source-vetting.md)). Built in code, tested offline, not deployed: `SourceVettingGateway` and an OpenAI provider with zero-retention requests (`packages/ai-sdk`, kill switch default off, enumerated JSON only, no candidate data); `AutomatedSourceVetting` in the Trust service (accepts only through the ordinary initial-review path with Trust's own independent-evidence check; never rejects; audit before every decision); `createAutomatedSourceVetting` composition (`SOURCE_VETTING_ENABLED` must be exactly `true`). Open: a scheduled host that calls `vetPending` (AWS addition), the automated reviewer identity in the runtime authority port, enabling the switch, account-level zero data retention with the provider (owner action), and a durable audit and already-assessed table (needs the owner's schema approval; log lines until then). |

## Exit criteria

- [ ] Learning signals distinguish explicit preferences and workflow quality from technical failures and stale jobs.
- [ ] No recruiter response, interview, offer, rejection, or other post-submission outcome is collected or used.
- [ ] Ranking changes are calibrated, explainable, fairness-reviewed, canaried, observable, and reversible.
- [ ] Every new ATS passes fixtures, conformance, canary, kill-switch, fallback, and quality gates.
- [ ] Every new geography passes explicit data, legal, language, salary, authorization, taxonomy, source, and support gates.
- [ ] Company/job context is permitted, cited, fresh enough for application tailoring, and resistant to unsupported claims.
- [ ] Security/operational maturity changes have tested evidence rather than compliance-only documentation.
- [ ] Any employer product has an approved go/no-go record, separate bounded context, explicit candidate visibility/consent, and no hidden candidate-data subsidy.
- [ ] Expansion does not weaken security. Quality and reliability guardrails were removed 2026-10-21.
- [ ] Vulnerability intake is staffed, accepted security risks have not expired, and annual plus
      material-change independent reassessments and retests are current for the deployed surface.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-10-22 | Owner removed privacy reviews and approvals from all phases; D7-009 and D7-010 drop privacy. | D7-009, D7-010 | Owner direction 2026-10-22 |
| 2026-10-21 | Owner removed non-security testing and acceptance work; D7-009 is reduced to privacy and security regression checks. | D7-009 | Owner direction 2026-10-21 |
| 2026-07-28 | Assigned per-expansion delta approval to D7 without starting implementation. | D7-010 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-07-31 | Assigned ongoing vulnerability operations and annual/material-change independent reassessment to D7 without starting implementation. | D7-011 | [API security and final-review baseline](../../security/api-security-and-final-review.md), [ADR-015](../../adr/015-independent-prelaunch-security-review.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-07-28 | Employer product is optional and requires a separate go/no-go decision. | Candidate trust and the candidate-first data boundary must not be implicitly changed. | Architecture scope and privacy principles |
| 2026-07-28 | Ranking optimization uses only in-product preferences and workflow-quality signals. | The Platform does not track post-submission hiring outcomes. | Updated product architecture |
| 2026-07-31 | Treat independent security assessment as a recurring control after the D6 launch gate. | New providers, permissions, APIs, incidents, and trust boundaries can invalidate a point-in-time assessment. | [ADR-015](../../adr/015-independent-prelaunch-security-review.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D7-R1 | Open | In-product interaction data contains selection and technical-failure bias. | Unassigned | Keep signal definitions explicit, exclude stale/technical failures from fit labels, and use controlled rollout. |
| D7-R2 | Open | Expansion breadth can outpace adapter, legal, taxonomy, support, or operational quality. | Unassigned | Require a readiness record and exit gate per ATS/region rather than bundling expansion. |
| D7-R3 | Open | Employer monetization can conflict with candidate privacy and trust. | Unassigned | Keep a separate bounded context and require explicit, reversible candidate visibility. |
| D7-R4 | Open | A launch assessment can become stale as APIs, clients, providers, cloud boundaries, and attacker techniques change. | Security owner | Track revalidation triggers and assessment age; block material releases when required reassessment, remediation, or retest is incomplete. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
