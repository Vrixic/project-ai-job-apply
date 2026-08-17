# D1-006 Application History and Action Inbox Ownership Review Brief

- Packet status: Prepared for accountable product-owner review
- Decision status: `Not started`
- Selected option: None
- Authorization to change delivery scope, contracts, schemas, or implementation: `false`
- Prepared: 2026-08-16
- Engineering input baseline: `0c259f4aaa2c96052b56bc94e407ab27688ea8fd`
- Accountable decision owner: Product owner
- Required technical reviewer: Architecture/platform engineering
- Disposition record:
  [D1-006 disposition worksheet](d1-006-application-history-ownership-review-disposition.md)

This packet resolves one question only: which delivery phase should implement technical
application history and the generic in-app action inbox. It does not select an option, start D3 or
D5, change D1-006, authorize implementation, or approve any application action. Until the product
owner records an attributable decision, D1-006 remains `Blocked` and no application-history or
action-inbox implementation is authorized by this packet.

## Decision required

Select exactly one of these complete options or require changes:

| Option | Delivery assignment | Durable owners | Engineering assessment | Current selection |
|---|---|---|---|---|
| A — relocate to owning deliveries | D3 implements all technical application history through confirmed submission; D5 implements the generic in-app action inbox | Applications owns application truth; Notifications owns inbox/routing truth | Recommended: matches the existing service boundaries and avoids partial lifecycle and inbox foundations in D1 | `false` |
| B — bring forward narrow owner-aligned foundations | D1 implements only the initial Applications-owned `preparing`/preparation-cancelled lifecycle slice and a Notifications-owned in-app-only action projection; D3 and D5 extend those same stores and contracts | Applications and Notifications remain the only durable owners | Coherent only under every constraint in this brief; adds cross-phase contracts, migrations, and acceptance work to D1 | `false` |

No hybrid is implied. In particular, “D1 history” cannot be a Matching-, Jobs-, frontend-, gateway-,
or analytics-owned lifecycle, and an inbox record cannot become application truth.

## Fixed product boundary

Both options must preserve these invariants:

- product tracking ends at confirmed submission; `applied` is terminal;
- no recruiter response, interview, offer, rejection, hiring-stage, or other post-submission outcome
  is collected, inferred, imported, displayed as platform truth, or used for matching;
- no application state is inferred from email, calendar, browsing history, or an unconfirmed ATS
  response;
- no CAPTCHA, MFA, signature, attestation, or ambiguous question is bypassed or silently answered;
- approval is explicit and bound to one immutable application packet; a material change invalidates
  it; and
- ambiguous external effects are reconciled and never blindly retried.

The already approved launch focus limits history to technical state through confirmed submission;
this decision allocates ownership and delivery timing and does not expand that boundary.

## Authoritative domain truth

The decision must keep the following concepts distinct:

| Concept | Authoritative owner and meaning | Must never become |
|---|---|---|
| `Application` | Applications-owned candidate/job aggregate and canonical state-transition history. It records actor, source, evidence, time, and confidence for each accepted transition through terminal `applied`. | A saved-job alias, UI-only status, notification state, analytics event, or post-submission hiring tracker |
| `ApplicationPacket` | Applications-owned immutable, versioned review candidate containing grounded field values, evidence references, artifact hashes, sensitivity/review decisions, and an approval-bound packet hash. | An editable inbox payload, an inferred candidate-fact store, or proof of submission |
| `ApplicationAttempt` | Applications-owned idempotent external-attempt/reconciliation record tied to one approved packet and adapter/runtime version, with technical result and confirmation evidence. | Permission to retry an ambiguous submission or a recruiter/hiring outcome |
| `Notification` / in-app action record | Notifications-owned derived record for presentation, routing, deduplication, acknowledgement, and delivery outcome. It references an authoritative source fact and command destination. | The decider of application state, approval, billing truth, or source truth |

The gateway/BFF may aggregate these records but cannot own them. Workflows and workers execute
unreliable tasks but cannot become the durable source of truth. Analytics receives only minimized,
de-identified product events and cannot reconstruct candidate history.

## Option A — relocate history to D3 and inbox to D5

### Scope

1. Remove D1-006 from D1 with a recorded reason; do not replace it with another application
   lifecycle or inbox task.
2. D3 implements the Applications-owned `Application`, `ApplicationPacket`, and
   `ApplicationAttempt` model, canonical state machine, audit/history reads, durable workflow,
   approval, submission, reconciliation, and confirmation evidence.
3. D5 implements the Notifications-owned generic in-app inbox together with preferences, routing,
   deduplication, quiet hours, templates, acknowledgement, and delivery outcomes. Application
   entries are derived from versioned Applications events and remain available when external
   delivery fails.
4. Before D5 exists, D3 exposes its own owner-scoped technical-history and current-action reads; it
   does not write a temporary notification store. D5 later projects those facts without taking
   ownership of them.
5. D1 still satisfies its candidate value through onboarding, trusted catalog, search, matching,
   saves, reporting, public job detail, and entitlements. Saved-job state remains Matching-owned and
   is not relabeled as application history.

### Why engineering recommends Option A

- It follows the existing Applications and Notifications service contracts without creating a
  partial lifecycle solely to satisfy a phase label.
- Packet approval, attempts, confirmation, and history can be designed and tested as one invariant
  set in D3.
- It avoids a D1 migration and compatibility promise for concepts that D1 cannot exercise through
  confirmed submission.
- It keeps the generic inbox with its routing, preference, localization, accessibility, retention,
  and fallback responsibilities in D5.

### Trade-offs

- Phase 1 ships no technical application history or generic action inbox.
- D3 must provide a usable owner-scoped history/current-action surface before D5 adds cross-domain
  notification routing.
- D1 objective and exit wording must describe finding, trusting, and saving jobs rather than imply
  application tracking.

## Option B — narrow D1 owner-aligned foundations

Option B is valid only as an early slice of the same Applications and Notifications modules. It is
not permission to create D1-specific ownership.

### Exact allowed D1 scope

Applications may accept an explicit candidate command to start preparation for one canonical job,
create one owner-scoped `Application`, and record only:

- `preparing`, entered only from that explicit command; and
- cancellation before a packet exists, recorded as the canonical `cancelled` state with actor and
  timestamp.

The D1 slice may expose owner-scoped current state and transition history for only those states. It
must define idempotency, duplicate prevention, job-revision linkage, deletion/export behavior,
audit, outbox events, and a forward-compatible migration consumed by D3.

Notifications may project only already-authorized D1 facts into an in-app-only record, initially:

- a saved job becoming stale or nearing a known source-provided close time; and
- an Applications-owned `preparing` record that the candidate can explicitly resume or cancel.

The projection may support owner scope, source reference/revision, deduplication, acknowledgement,
expiry, and a safe command link. It cannot execute the command, mutate the source aggregate, send
email/push, infer urgency from candidate PII, or claim the source action succeeded.

### Explicitly excluded from D1

- `ApplicationPacket`, proposed fields, answer reuse, document selection, packet hashing, approval,
  or `review_required`;
- `ApplicationAttempt`, ATS/form execution, takeover, confirmation reconciliation, or submission
  evidence;
- `approved`, `submitting`, `submitted_unconfirmed`, `applied`, or any submission-failure truth;
- temporary Jobs/Matching/application-history columns, frontend-local history, or direct
  cross-owner table reads;
- notification email/push providers, quiet-hour policy, channel preferences, outreach, or any
  inbox/calendar access; and
- any synthetic terminal history or migration that guesses a later D3 state.

### Required continuation contract

D3 must extend the same Applications aggregate, transition ledger, APIs/events, and database owner;
it cannot replace or translate a parallel D1 lifecycle. D5 must extend the same Notifications
records and deduplication identities; it cannot treat acknowledgement or delivery as completion of
the source action. Contract and migration compatibility must be proven before the first D1 release.

### Trade-offs

- D1 gains a small resumable-preparation entry point and an in-app-only projection.
- D1 assumes additional schema, API/event, privacy, authorization, accessibility, recovery, and
  deployment evidence for two future service owners.
- The limited state is not “application history through confirmed submission,” so roadmap and
  completion language must state the limitation exactly.

## Failure and privacy requirements for either option

- Every read and command is owner scoped through the managed identity mapping; identifiers in an
  inbox event do not grant access to the referenced aggregate.
- Candidate values, packet fields, artifacts, URLs containing secrets, and provider response bodies
  do not enter notification payloads, general events, logs, analytics, or fixtures.
- Application state commits with audit and minimal outbox evidence transactionally. Derived inbox
  lag or failure cannot roll back or fabricate application truth.
- Replays use stable event/command identities. Acknowledging, dismissing, expiring, or failing to
  deliver a notification never changes its source fact.
- Deletion/export and retention behavior must cover source records, projections, audit constraints,
  backups, and queued work without preserving a shadow hiring-outcome dataset.
- Unsupported, stale, changed, unauthorized, or ambiguous external conditions route to candidate
  review/takeover or safe failure.

## Changes authorized only after explicit approval

Do not make any item in this section from this prepared packet alone.

### If Option A is approved

| Artifact | Required follow-up change |
|---|---|
| `docs/adr/<next-available-id>-application-history-and-inbox-phase-ownership.md` | Record the attributable choice, fixed owners, terminal boundary, derived-inbox rule, rejected narrow-D1 alternative, and consequences; obtain acceptance before implementation. |
| `docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md` | Remove application history/inbox from Phase 1; add Applications-owned technical history to Phase 3 and the generic in-app inbox to Phase 5; preserve service responsibilities and terminal boundary. |
| `docs/product/delivery/phase-1-web-and-job-catalog.md` | Mark D1-006 `Removed` with the approved reason; close D1-R5; update objective/exit wording, decision log, and work log without claiming D1 complete. |
| `docs/product/delivery/phase-3-application-preparation.md` | Extend D3-005/D3-008 and exit criteria to include the authoritative technical history/history reads through confirmed submission. Keep D3 `Not started` until implementation actually begins. |
| `docs/product/delivery/phase-5-outreach-and-notifications.md` | Remove the D1 action-inbox dependency; make D5-001 the generic inbox owner consuming D3 and other owner events. Keep D5 `Not started`. |
| `docs/product/delivery/DELIVERY_TRACKER.md` | Synchronize D1/D3/D5 dependencies, exit gates, current-status wording, work log, and decision log with the three phase documents. |
| `docs/product/delivery/phase-6-mobile-and-paid.md` | Retain D6-003 dependencies on D3/D5 and clarify that mobile renders their history/inbox rather than D1 truth. |

### If Option B is approved

| Artifact | Required follow-up change |
|---|---|
| `docs/adr/<next-available-id>-application-history-and-inbox-phase-ownership.md` | Record the exact two-state Applications slice, Notifications projection boundary, compatibility obligations, forbidden states/effects, accountable choice, and consequences; obtain acceptance before implementation. |
| `docs/PRODUCT_AND_SYSTEM_ARCHITECTURE.md` | Replace the broad Phase 1 history/inbox bullet with the exact narrow foundations; state that D3/D5 extend the same owners and that confirmed-submission history remains a D3 completion. |
| `docs/product/delivery/phase-1-web-and-job-catalog.md` | Replace D1-006 wording/dependencies/acceptance with the exact allowed scope; move it from `Blocked` only when approved implementation actually starts; close D1-R5 only after synchronized ownership records exist. |
| `docs/product/delivery/phase-3-application-preparation.md` | Make D3-005 extend the D1 Applications aggregate and migration lineage, then add packet/approval/attempt/submission/history behavior; keep D3 `Not started`. |
| `docs/product/delivery/phase-5-outreach-and-notifications.md` | Make D5-001 extend the D1 Notifications in-app foundation with preferences/routing/channels while consuming source-owner events; keep D5 `Not started`. |
| `docs/product/delivery/DELIVERY_TRACKER.md` | Synchronize D1/D3/D5 dependencies, exact limitations, decision/work logs, and gates with all phase documents. |
| `docs/product/delivery/phase-6-mobile-and-paid.md` | Clarify that D6-003 consumes Applications/Notifications contracts and does not own lifecycle truth. |

After either choice, use contract-first review for OpenAPI/events/domain schemas and reviewed
owner-specific SQL migrations before implementation. Approval of the phase allocation is not
approval of those future contracts, migrations, deployment, real-candidate processing, ATS
automation, or external effects.

## Accountable decision questions

1. Does the product owner select Option A, select Option B exactly as constrained, reject both, or
   require changes?
2. Does the product owner affirm that technical history ends at confirmed submission and contains
   no hiring outcomes?
3. Does architecture/platform engineering affirm that the selected option preserves one
   Applications owner and one Notifications owner with no parallel lifecycle?
4. Which named people will own the downstream ADR and synchronized delivery edits?
5. What immutable commit/tree and packet version did each reviewer inspect?

Record answers only in the linked disposition worksheet. Discussion, an issue comment, or a merge
of this prepared packet is not approval.

## Source evidence

- [Product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md)
- [D1 delivery record](../delivery/phase-1-web-and-job-catalog.md)
- [D3 delivery record](../delivery/phase-3-application-preparation.md)
- [D5 delivery record](../delivery/phase-5-outreach-and-notifications.md)
- [Master delivery tracker](../delivery/DELIVERY_TRACKER.md)
- [Applications service boundary](../../../backend/services/applications/README.md)
- [Notifications service boundary](../../../backend/services/notifications/README.md)
- [Application packet schema](../../../packages/domain/schemas/v1/application-packet.schema.json)
- [ADR-001 module boundaries](../../adr/001-monorepo-and-module-boundaries.md)
- [ADR-003 PostgreSQL ownership and PII](../../adr/003-postgresql-ownership-and-pii.md)
- [ADR-004 durable workflows, outbox, and idempotency](../../adr/004-temporal-outbox-and-idempotency.md)
- [ADR-006 contract-first compatibility](../../adr/006-contract-first-compatibility.md)
- [ADR-010 restricted answers and mandatory review](../../adr/010-restricted-answer-vault-and-mandatory-review.md)
- [Launch decision](launch-decision.md)
