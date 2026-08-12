# D3 — High-Quality Application Preparation

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-08-12
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d3--high-quality-application-preparation)

## Objective

Deliver fact-grounded, review-by-exception application preparation and measured assisted submission for supported ATS platforms.

## Deployment posture

Keep document and AI work on bounded queues/workers with concurrency limits inside the lean
runtime. Add dedicated AI/rendering capacity only from queue, latency, isolation, or model-provider
evidence; durable workflow, factuality, and approval controls are never scaled down.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D3-001 | Implement candidate fact graph, provenance, confidence, and answer vault. | Ready | Unassigned | D0 schemas; D1 profile | Open |
| D3-002 | Implement immutable resume import and normalized resume AST. | Ready | Unassigned | D0 document schema | Open |
| D3-003 | Implement job-specific tailoring, visible diff, factuality checks, and PDF/DOCX rendering verification. | Ready | Unassigned | D3-001, D3-002 | Open |
| D3-004 | Implement grounded cover letters and narrative answers with evidence and mandatory-review classification. | Ready | Unassigned | D3-001; AI gateway | Open |
| D3-005 | Implement application packet, field ontology mapping, immutable hash, state machine, and durable workflow. | Ready | Unassigned | D0 contracts/workflow ADR | Open |
| D3-006 | Implement review-by-exception UI and explicit approve/cancel behavior. | Ready | Unassigned | D3-003–D3-005 | Open |
| D3-007 | Implement extension autofill adapters for supported Greenhouse, Lever, and Ashby variants. | Ready | Unassigned | D2 extension; D3-013 | Open |
| D3-008 | Implement validation, user takeover, final submission, and confirmation evidence. | Ready | Unassigned | D3-005, D3-007 | Open |
| D3-009 | Implement conservative unknown/custom-site fallback. | Ready | Unassigned | ATS SDK | Open |
| D3-010 | Establish per-field correction, factuality, completion, confirmation, latency, and failure metrics. | Ready | Unassigned | D0 metrics | Open |
| D3-011 | Complete adversarial, duplicate-submit, crash/replay, accessibility, privacy, and security testing. | Ready | Unassigned | D3-001–D3-010 | Open |
| D3-012 | Obtain ATS-specific legal and accountable security/privacy approval for AI processing, form actions, sensitive fields, signatures, and submission. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete adapters, model/provider, approval UX, and test evidence | Release gates LR-D3-01 and LR-D3-02; live ATS effects remain disabled until approved. |
| D3-013 | Define supported application-form variants and acquire authorized, sanitized provider fixtures with separate QA representativeness acceptance. | Ready | QA/automation; capability reviewers | D0-007 process; exact adapter scope and source authorization | Blocking provider-evidence gate under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md); synthetic fixtures do not satisfy it. |

## Exit criteria

- [ ] Every generated claim is grounded in confirmed profile evidence or explicitly requires review.
- [ ] Protected, voluntary, legal, signature, authorization, and other sensitive answers follow mandatory-review policy.
- [ ] Rendered documents preserve intended content and pass format/factuality checks.
- [ ] Approval is bound to an immutable packet and expires on material job/form/artifact changes.
- [ ] Supported ATS variants meet agreed field accuracy and confirmation thresholds.
- [ ] Ambiguous submission responses cannot cause blind duplicate submission.
- [ ] Unsupported variants degrade to safe assisted/manual completion.
- [ ] User correction, adapter failure, model quality, and confirmation metrics are observable by version.
- [ ] Security, privacy, accessibility, AI evaluation, workflow replay, and product acceptance evidence is complete.
- [ ] Every enabled application adapter has current authorized provider fixtures, sanitization and scan evidence, and separate QA representativeness acceptance.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-07-28 | Assigned application-preparation and submission delta approval to D3 without starting implementation. | D3-012 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-08-12 | Accepted ownership of authorized representative application-form fixtures from D0; this assignment does not start D3 or approve any provider action. | D3-007, D3-013 | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), [fixture policy](../foundation/ats-fixture-policy.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-08-12 | Provider-derived form fixture evidence is acquired and accepted with each concrete application adapter. | Form fidelity and representative coverage depend on the declared supported variant. | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D3-R1 | Open | Model-generated unsupported claims could materially harm candidates. | Unassigned | Build provenance and factuality evaluation before generation UX. |
| D3-R2 | Open | ATS layout changes can create incorrect values or ambiguous submissions. | Unassigned | Require provider fixtures, canaries, kill switches, packet revalidation, and confirmation reconciliation. |
| D3-R3 | Open | A “one click” promise can obscure mandatory user decisions. | Unassigned | Design review by exception and explicit sensitive/irreversible-action gates. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
