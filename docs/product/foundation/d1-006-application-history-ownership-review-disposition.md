# D1-006 Application History and Action Inbox Ownership Disposition Worksheet

- Worksheet status: Ready for accountable input; review has not started
- Decision state: `Not started`
- Selected option: None
- Option A selected: `false`
- Option B selected: `false`
- Delivery/architecture change authorized: `false`
- Implementation authorized: `false`
- Prepared: 2026-08-16
- Accountable decision owner: Product owner; named individual unassigned
- Required technical reviewer: Architecture/platform engineering; named individual unassigned
- Review brief:
  [D1-006 ownership review brief](d1-006-application-history-ownership-review-brief.md)

This worksheet is an empty attributable decision record. It is not an ADR, delivery change,
implementation specification, product-owner approval, or release authorization. Preserve
`Not started`, no selected option, and every `false` value until the accountable people review one
frozen packet and complete the required fields.

## Allowed state and closure rule

| State | Meaning | Gate effect |
|---|---|---|
| `Not started` | No attributable product-owner review has begun. | D1-006 remains `Blocked`; both options and every authorization remain `false`. |
| `In review` | Named reviewers are evaluating one immutable packet. | No authorization changes. |
| `Changes required` | The accountable owner requires a different or narrower candidate. | D1-006 remains `Blocked`; prepare a new version. |
| `Approved` | The product owner selected exactly one option and architecture/platform engineering accepted its owner-boundary feasibility, with all required identity/evidence fields complete. | Authorizes only the listed ADR and synchronized roadmap edits; implementation and release remain separately governed. |
| `Rejected` | The product owner rejected both options. | D1-006 remains `Blocked` until a new candidate is reviewed or the task is formally removed. |

An approval is invalid if both options are selected, neither option is selected, the reviewed
packet identity is absent, conditions contradict the fixed product boundary, or a named reviewer
lacks the stated authority. Product approval cannot waive legal, privacy, security, provider, or
external-action gates.

## Immutable review candidate

| Field | Accountable value |
|---|---|
| Repository commit reviewed | Pending |
| Commit parent/tree | Pending |
| Review brief content SHA-256 | Pending |
| Disposition worksheet content SHA-256 | Pending |
| Packet version | Pending |
| Review started | Not started |
| Review completed | Not started |

## Reviewer identity and authority

| Role | Named reviewer | Authority | Decision/date | Attributable record |
|---|---|---|---|---|
| Product owner | Unassigned | Select the product/delivery option; cannot self-approve technical, legal, privacy, security, provider, or release evidence | Not started | Pending |
| Architecture/platform engineering | Unassigned | Confirm one-owner feasibility, contracts/migrations implications, and absence of a parallel lifecycle; cannot select product scope | Not started | Pending |
| Delivery governance recorder | Unassigned | Apply only the approved ADR/tracker/phase changes and preserve evidence/status rules | Not started | Pending |

## Decision

Select exactly one result.

| Result | Selected | Product-owner rationale and conditions |
|---|---:|---|
| Option A — relocate Applications-owned technical history to D3 and generic inbox to D5 | `false` | Pending |
| Option B — bring forward only the exact owner-aligned D1 foundations in the brief | `false` | Pending |
| Changes required | `false` | Pending |
| Reject both | `false` | Pending |

### Required product-owner affirmations

| Affirmation | Value | Evidence/condition |
|---|---:|---|
| Application history ends at confirmed submission; `applied` is terminal | `false` | Pending |
| No inbox/calendar reading or hiring-outcome collection/inference is added | `false` | Pending |
| Saved-job, notification-delivery, and UI state cannot masquerade as Application truth | `false` | Pending |
| A notification/action record cannot authorize or prove an application transition | `false` | Pending |
| Approval of ownership does not authorize implementation, deployment, real-candidate data, or ATS effects | `false` | Pending |

### Required architecture/platform affirmations

| Affirmation | Value | Evidence/condition |
|---|---:|---|
| Applications remains the only owner of `Application`, `ApplicationPacket`, `ApplicationAttempt`, submission evidence, and technical history | `false` | Pending |
| Notifications remains the only owner of inbox/routing/delivery records and never decides source truth | `false` | Pending |
| Gateway/BFF, workers, analytics, Jobs, Matching, and clients do not gain parallel lifecycle ownership | `false` | Pending |
| The selected option has one forward-compatible contract/migration lineage | `false` | Pending |
| The selected option can fail closed under stale, duplicate, replayed, or ambiguous input | `false` | Pending |

## Option-specific frozen scope

Complete only the selected option. A `true` selection does not authorize any implementation flag.

### Option A record

- Selected: `false`

| Field | Accountable value |
|---|---|
| D1-006 removal rationale accepted | Pending |
| D3 owns full technical history through confirmed submission | Pending |
| D5 owns generic in-app action inbox and consumes source-owner events | Pending |
| D3 provides owner-scoped history/current-action reads before D5 | Pending |
| Named ADR owner | Pending |
| Named synchronized-delivery-record owner | Pending |
| Conditions or required changes | Pending |

### Option B record

- Selected: `false`

| Field | Accountable value |
|---|---|
| D1 Applications states allowed | Pending; must be exactly `preparing` and cancellation before packet creation |
| D1 Application states/effects forbidden | Pending; must include packet/review/approval/attempt/submission/confirmation and terminal submission truth |
| D1 Notifications projection sources allowed | Pending; may include only the source-owned facts listed in the brief |
| External notification channels allowed in D1 | Pending; must remain none |
| D3 continuation uses same Applications aggregate/ledger/migrations | Pending |
| D5 continuation uses same Notifications records/deduplication identities | Pending |
| Named ADR owner | Pending |
| Named synchronized-delivery-record owner | Pending |
| Conditions or required changes | Pending |

If an accountable reviewer changes any fixed Option B constraint, set the overall state to
`Changes required`; do not silently approve a third option in this worksheet.

## Authorization flags

| Authorization | Current value | Required before change |
|---|---:|---|
| Option A is selected | `false` | Completed attributable decision selecting only Option A |
| Option B is selected | `false` | Completed attributable decision selecting only Option B |
| New ownership ADR may be drafted | `false` | Overall state `Approved` and one option selected |
| Architecture roadmap may be edited | `false` | Accepted ownership ADR candidate and exact selected-option edits |
| D1/D3/D5/D6 phase records may be edited | `false` | Accepted ownership ADR candidate and synchronized change set |
| Master delivery tracker may be edited | `false` | Same change set as all affected phase records |
| D1-006 may leave `Blocked` | `false` | Option-specific governance changes accepted; for Option B, implementation must actually begin |
| D3 or D5 may be marked started | `false` | Their own first task actually enters `In progress`; reallocation alone does not start them |
| OpenAPI/event/domain schemas may be changed | `false` | Separately reviewed contract candidate after ownership records land |
| SQL migrations may be added or applied | `false` | Separately reviewed owner migration and deployment authorization |
| Application/inbox implementation may begin | `false` | Selected-option governance plus an authorized implementation task |
| Any application/inbox implementation may deploy | `false` | Implementation, tests, security/privacy/accessibility, release, and environment evidence |
| Real candidate data may be processed | `false` | Applicable accountable privacy/security/legal and deployed acceptance gates |
| ATS form action or submission may occur | `false` | D3-specific provider/legal/security approvals and exact release evidence |
| Post-submission hiring outcomes may be collected or inferred | `false` | Prohibited product boundary; cannot be authorized here |

## Required downstream record after approval

The governance recorder must copy the selected option's exact change matrix from the
[review brief](d1-006-application-history-ownership-review-brief.md#changes-authorized-only-after-explicit-approval)
into one reviewed change set. Record:

| Evidence | Value |
|---|---|
| New ADR path and commit | Pending |
| ADR status and acceptance record | Pending |
| Architecture path/commit | Pending |
| D1 phase path/commit | Pending |
| D3 phase path/commit | Pending |
| D5 phase path/commit | Pending |
| D6 phase path/commit | Pending |
| Master tracker path/commit | Pending |
| Link validation result | Pending |
| Independent review result | Pending |

Do not mark D1 complete from this decision. All other D1 tasks, exit criteria, accountable approvals,
deployment evidence, recovery/security/privacy/accessibility evidence, and final acceptance remain
independent gates.

## Sign-off

| Role | Name | Decision | Date | Signature or attributable record |
|---|---|---|---|---|
| Product owner | Unassigned | Not started | Not started | Pending |
| Architecture/platform engineering | Unassigned | Not started | Not started | Pending |
| Delivery governance recorder | Unassigned | Not started | Not started | Pending |

Any finding or required change:

- Finding ID: Pending
- Description: Pending
- Owner: Pending
- Required evidence: Pending
- Resolution: Pending

Until this record is complete, D1-006 remains human-blocked and every authorization above remains
`false`.
