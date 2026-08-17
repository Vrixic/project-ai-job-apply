# ADR-024: Application History and Inbox Phase Ownership

Status: Accepted
Date: 2026-08-17

## Context

The original Phase 1 roadmap combined job discovery with technical application history and an
in-app action inbox. That allocation conflicts with the existing bounded contexts: Phase 3 owns
the Applications state machine, immutable application packet, attempts, submission evidence, and
confirmation, while Phase 5 owns Notifications preferences, routing, delivery, and inbox records.
Implementing the original D1 wording would risk a second application lifecycle or inbox records
that masquerade as application truth.

The product owner explicitly selected Option A in the
[D1-006 ownership disposition](../product/foundation/d1-006-application-history-ownership-review-disposition.md):
remove application history and the inbox from D1, allocate authoritative technical history to D3,
and allocate the generic action inbox to D5. Vrij then affirmed all five fixed product boundaries,
and Schrodinger the 2nd independently accepted the corrected architecture/platform boundary. The
fixed product boundary remains confirmed submission. Recruiter responses, interviews, offers,
rejections, and all other post-submission hiring outcomes remain prohibited.

## Decision

- The Applications bounded context is the sole owner of `Application`, `ApplicationPacket`,
  `ApplicationAttempt`, submission evidence, and authoritative technical history. D3 implements
  that history through confirmed submission, including owner-scoped current-action and history
  reads. `applied` is terminal.
- An Applications aggregate and its technical history begin only after an explicit application
  creation/preparation command. Discovery and saved-job state remain Jobs/Matching-owned facts;
  they may be referenced through versioned owner contracts but never become Applications
  transitions.
- The Notifications bounded context is the sole owner of notification preferences, routing,
  delivery attempts, deduplication, and the generic in-app action inbox. D5 implements the inbox
  as a projection of minimal, versioned source-owner events, including Applications events.
- Inbox state is derived delivery/UI state. It cannot authorize, cause, or prove an Applications
  transition, and acknowledging, dismissing, expiring, or failing an inbox item cannot alter its
  source fact.
- Consumers, including web, mobile, Gateway/BFF, workers, and analytics, use versioned owner APIs
  and events. They do not read owner tables directly or create a parallel application lifecycle.
- Event payloads contain only minimal identifiers and classifications. Candidate values, packet
  fields, artifacts, secret-bearing URLs, provider response bodies, and hiring outcomes do not
  enter inbox events, general events, logs, analytics, or fixtures.
- D1-006 is removed as a deliberate phase reallocation. D3 and D5 remain not started until one of
  their implementation tasks actually enters `In progress`.

## Consequences

- D1 can complete on the quality and reliability of candidate onboarding and job discovery without
  fabricating application history before the Applications lifecycle exists.
- D3 must define one forward-compatible Applications contract and migration lineage, transactionally
  commit source truth with audit/outbox evidence, and provide authorized technical-history reads.
- D5 must tolerate delayed, duplicate, replayed, out-of-order, or unavailable owner events and fail
  closed without changing source truth. Its in-app record remains available when external delivery
  fails.
- D6 mobile surfaces render D3 Applications truth and D5 inbox projections; mobile owns neither.
- Contract, schema, SQL migration, implementation, deployment, real-candidate processing, and ATS
  effects require their own reviewed and authorized work. This ADR grants none of them.

## Alternatives

Bring forward an exact two-state D1 Applications foundation and a minimal D1 Notifications
projection. This was rejected because it would add schema, contract, migration, recovery, privacy,
and compatibility obligations before users can prepare an application, while still failing to
deliver the promised history through confirmed submission.
