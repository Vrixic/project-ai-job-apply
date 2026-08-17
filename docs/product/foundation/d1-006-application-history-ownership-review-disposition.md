# D1-006 Application History and Action Inbox Ownership Disposition Worksheet

- Worksheet status: Approved for the recorded governance-only Option A change
- Decision state: `Approved`
- Selected option: Option A
- Option A selected: `true`
- Option B selected: `false`
- Delivery/architecture change authorized: `true`
- Implementation authorized: `false`
- Prepared: 2026-08-16
- Accountable decision owner: Product owner — Vrij
- Required technical reviewer: Schrodinger the 2nd — independent architecture/platform reviewer
- Review brief:
  [D1-006 ownership review brief](d1-006-application-history-ownership-review-brief.md)

This worksheet records product owner Vrij's explicit 2026-08-17 choice: “Lets do option A-relocate
history to D3 and inbox to D5,” followed by the five attributable product-boundary responses
recorded below. `Vrij` is the stable identifier supplied in the authenticated conversation; no
legal name, Git author, GitHub handle, or signature is inferred. Schrodinger the 2nd independently
accepted the corrected architecture/platform owner boundaries. Approval is limited to ADR-024 and
the synchronized roadmap records; it is not implementation, deployment, real-data, ATS-action,
legal, privacy, security, or release authorization.

## Allowed state and closure rule

| State | Meaning | Gate effect |
|---|---|---|
| `Not started` | No attributable product-owner review has begun. | D1-006 remains `Blocked`; both options and every authorization remain `false`. |
| `In review` | An attributable product choice may be recorded while required product affirmations or architecture/platform review remain pending. | Only the selected-option flag and permission to draft its governance candidate may change; synchronized records are not accepted and implementation remains unauthorized. |
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
| Repository commit reviewed | `e54e0aa731d50911bde67d0d20e82525d7db3ebf` (PR #318 squash merge) |
| Commit parent/tree | Parent `86b337e4c7d071dee39e50adf08432c8b60c47b6`; tree `dad40f4371c2bc84a286417622664ede96e22941` |
| Review brief content SHA-256 | `10b42fd2be2af798f91b14ca1109f5b7858e09325976e4d989c258308ae84652` (UTF-8, LF, final LF) |
| Disposition worksheet content SHA-256 | `f3b72cbdd1018b295e97cf0c44a0677860a8c0dc77f4407bdfee0aaae5675136` (frozen pre-decision worksheet; UTF-8, LF, final LF) |
| Packet version | PR #318 two-file review packet; manifest `312db33f12528f4a27b46c0566fcebc27b88650ca9e3000092938925354f8a65` |
| Review started | 2026-08-17 |
| Review completed | 2026-08-17 |

## Reviewer identity and authority

| Role | Named reviewer | Authority | Decision/date | Attributable record |
|---|---|---|---|---|
| Product owner | Vrij | Select the product/delivery option; cannot self-approve technical, legal, privacy, security, provider, or release evidence | Option A and all five required boundaries approved / 2026-08-17 | Authenticated Codex conversation; stable identifier supplied by requester |
| Architecture/platform engineering | Schrodinger the 2nd — independent architecture/platform reviewer | Confirm one-owner feasibility, contracts/migrations implications, and absence of a parallel lifecycle; cannot select product scope | Accepted / 2026-08-17 | Independent read-only review of the corrected nine-artifact candidate |
| Delivery governance recorder | Codex governance agent `/root/option_a_governance` | Apply only the approved ADR/tracker/phase changes and preserve evidence/status rules | Recorded / 2026-08-17 | Exact isolated worktree task identity; not represented as a human signature |

## Decision

Select exactly one result.

| Result | Selected | Product-owner rationale and conditions |
|---|---:|---|
| Option A — relocate Applications-owned technical history to D3 and generic inbox to D5 | `true` | Vrij explicitly selected relocation; all required product boundaries and the corrected architecture candidate are accepted. |
| Option B — bring forward only the exact owner-aligned D1 foundations in the brief | `false` | Not selected |
| Changes required | `false` | No changes remain after the architecture corrections recorded below. |
| Reject both | `false` | Not selected |

### Required product-owner affirmations

| Affirmation | Value | Evidence/condition |
|---|---:|---|
| Application history ends at confirmed submission; `applied` is terminal | `true` | Vrij response 1: “Yes.” / 2026-08-17 |
| No inbox/calendar reading or hiring-outcome collection/inference is added | `true` | Vrij response 2: “Correct.” / 2026-08-17 |
| Saved-job, notification-delivery, and UI state cannot masquerade as Application truth | `true` | Vrij response 3: “your recommendation,” accepting the stated recommended invariant / 2026-08-17 |
| A notification/action record cannot authorize or prove an application transition | `true` | Vrij response 4: “your recommendation,” accepting the stated recommended invariant / 2026-08-17 |
| Approval of ownership does not authorize implementation, deployment, real-candidate data, or ATS effects | `true` | Vrij response 5: “yes.” / 2026-08-17 |

### Required architecture/platform affirmations

| Affirmation | Value | Evidence/condition |
|---|---:|---|
| Applications remains the only owner of `Application`, `ApplicationPacket`, `ApplicationAttempt`, submission evidence, and technical history | `true` | Accepted corrected ADR-024 and synchronized D3 records; Applications starts only at explicit creation/preparation. |
| Notifications remains the only owner of inbox/routing/delivery records and never decides source truth | `true` | Accepted corrected ADR-024 and synchronized D5 records. |
| Gateway/BFF, workers, analytics, Jobs, Matching, and clients do not gain parallel lifecycle ownership | `true` | Accepted nine-artifact boundary review; discovered/saved remain Jobs/Matching facts. |
| The selected option has one forward-compatible contract/migration lineage | `true` | ADR-024 requires one Applications lineage and versioned owner contracts/events; executable contracts and migrations remain separately unauthorized. |
| The selected option can fail closed under stale, duplicate, replayed, or ambiguous input | `true` | D3 requires scoped idempotency and ambiguous-result reconciliation; D5 requires derived projection deduplication and source-truth independence. |

## Option-specific frozen scope

Complete only the selected option. A `true` selection does not authorize any implementation flag.

### Option A record

- Selected: `true`

| Field | Accountable value |
|---|---|
| D1-006 removal rationale accepted | Yes; remove the premature overlapping D1 lifecycle/inbox task rather than create parallel truth. |
| D3 owns full technical history through confirmed submission | Yes; history starts only at explicit Application creation/preparation and ends at terminal `applied`. |
| D5 owns generic in-app action inbox and consumes source-owner events | Yes; inbox state remains a derived Notifications projection. |
| D3 provides owner-scoped history/current-action reads before D5 | Yes; D5 consumes minimal versioned source-owner events and never grants access to source aggregates. |
| Named ADR owner | Codex governance agent `/root/option_a_governance`, under Vrij's product decision and independent architecture review |
| Named synchronized-delivery-record owner | Codex governance agent `/root/option_a_governance`, under Vrij's product decision and independent architecture review |
| Conditions or required changes | Governance-only approval. Preserve every separately unauthorized implementation, contract, migration, deployment, data, provider, legal, privacy, security, accessibility, and release gate. |

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
| Option A is selected | `true` | Attributable 2026-08-17 requester decision selecting only Option A |
| Option B is selected | `false` | Completed attributable decision selecting only Option B |
| New ownership ADR may be drafted | `true` | Consumed by accepted ADR-024 in this synchronized governance change |
| Architecture roadmap may be edited | `true` | Consumed by the accepted exact Option A roadmap edits in this change |
| D1/D3/D5/D6 phase records may be edited | `true` | Consumed by the synchronized governance-only phase edits in this change |
| Master delivery tracker may be edited | `true` | Consumed by the synchronized governance-only tracker edit in this change |
| D1-006 may leave `Blocked` | `true` | Consumed by marking Option A's D1-006 task `Removed`; no implementation began |
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
| New ADR path and commit | `docs/adr/024-application-history-and-inbox-phase-ownership.md`; commit pending reviewed publication |
| ADR status and acceptance record | `Accepted`; this disposition records Vrij's choice/affirmations and Schrodinger the 2nd's independent architecture acceptance |
| Architecture path/commit | `docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md`; commit pending reviewed publication |
| D1 phase path/commit | `docs/product/delivery/phase-1-web-and-job-catalog.md`; commit pending reviewed publication |
| D3 phase path/commit | `docs/product/delivery/phase-3-application-preparation.md`; commit pending reviewed publication |
| D5 phase path/commit | `docs/product/delivery/phase-5-outreach-and-notifications.md`; commit pending reviewed publication |
| D6 phase path/commit | `docs/product/delivery/phase-6-mobile-and-paid.md`; commit pending reviewed publication |
| Master tracker path/commit | `docs/product/delivery/DELIVERY_TRACKER.md`; commit pending reviewed publication |
| Link validation result | Passed for all nine changed Markdown documents on 2026-08-17; every local target resolves |
| Independent review result | Schrodinger the 2nd — independent architecture/platform reviewer: `ACCEPT`, 2026-08-17 |

Do not mark D1 complete from this decision. All other D1 tasks, exit criteria, accountable approvals,
deployment evidence, recovery/security/privacy/accessibility evidence, and final acceptance remain
independent gates.

## Sign-off

| Role | Name | Decision | Date | Signature or attributable record |
|---|---|---|---|---|
| Product owner | Vrij | Option A and all five required product boundaries approved | 2026-08-17 | Authenticated Codex conversation; stable identifier supplied, no legal signature inferred |
| Architecture/platform engineering | Schrodinger the 2nd — independent architecture/platform reviewer | Accepted | 2026-08-17 | Independent read-only review of the corrected nine-artifact candidate |
| Delivery governance recorder | Codex governance agent `/root/option_a_governance` | Recorded exact approved governance scope; no implementation authority inferred | 2026-08-17 | Isolated worktree task identity; commit/publication pending independent final-byte acceptance |

Any finding or required change:

- Finding ID: AR-D1-006-01
- Description: The initial candidate retained discovered/saved as Applications transitions and
  did not name the complete attempt/idempotency/ambiguous-result boundary.
- Owner: Delivery governance recorder
- Required evidence: Corrected architecture §5.5, ADR-024, and D3-005/D3-008 wording in the exact
  synchronized candidate.
- Resolution: Closed 2026-08-17; Applications begins only at explicit creation/preparation,
  discovered/saved remain Jobs/Matching facts, and D3-008 names `ApplicationAttempt`, scoped
  idempotency, and ambiguous-result reconciliation. Independent architecture review accepted the
  correction.

D1-006 is removed and D1-R5 is closed by this governance-only approval. Every implementation,
contract/schema, migration, deployment, data, ATS-effect, legal, privacy, security, accessibility,
and release authorization remains `false` or separately governed.
