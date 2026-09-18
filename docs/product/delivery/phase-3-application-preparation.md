# D3 — High-Quality Application Preparation

- Status: In progress
- Start: 2026-09-18
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-09-18
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d3--high-quality-application-preparation)

## Objective

Deliver fact-grounded, review-by-exception application preparation, measured assisted submission,
and authoritative owner-scoped technical history through confirmed submission for supported ATS
platforms.

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
| D3-005 | Implement the Applications-owned packet, field ontology mapping, immutable hash, state machine, durable workflow, technical-history ledger, and owner-scoped current-action/history reads. | In progress | Unassigned | D0 contracts/workflow ADR; [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) | One forward-compatible Applications contract and migration lineage; source truth commits with audit and minimal outbox evidence transactionally. **Implemented and locally verified (2026-09-18):** the pure domain ([state machine](../../../backend/services/applications/src/state-machine.ts), [field policy](../../../backend/services/applications/src/field-policy.ts), [packet hash and approval binding](../../../backend/services/applications/src/packet.ts), [write-ahead attempts](../../../backend/services/applications/src/attempt.ts)), [migration 0001](../../../backend/services/applications/migrations/0001_applications_foundation.sql), and the owner-scoped [PostgreSQL store](../../../backend/services/applications/src/store.ts) with history, idempotency receipts, and outbox rows. 41 unit tests and 15 PostgreSQL 16.6 integration tests pass. **Remaining:** OpenAPI and event contracts, gateway routes, durable workflow, outbox publisher, port adapters that assemble a packet from confirmed facts, and D3-014. Nothing is deployed. |
| D3-006 | Implement review-by-exception UI and explicit approve/cancel behavior. | Ready | Unassigned | D3-003–D3-005 | Open |
| D3-007 | Implement extension autofill adapters for supported Greenhouse, Lever, and Ashby variants. | Ready | Unassigned | D2 extension; D3-013 | Open |
| D3-008 | Implement ApplicationAttempt, scoped submission idempotency, validation, user takeover, final submission, ambiguous-result reconciliation, confirmation evidence, and the terminal `applied` technical-history transition. | Ready | Unassigned | D3-005, D3-007 | Ambiguous irreversible results are never blindly retried. History ends at confirmed submission; no hiring outcomes may be collected or inferred. |
| D3-009 | Implement conservative unknown/custom-site fallback. | Ready | Unassigned | ATS SDK | Open |
| D3-010 | Establish per-field correction, factuality, completion, confirmation, latency, and failure metrics. | Ready | Unassigned | D0 metrics | Open |
| D3-011 | Complete adversarial, duplicate-submit, crash/replay, accessibility, privacy, and security testing. | Ready | Unassigned | D3-001–D3-010 | Open |
| D3-012 | Obtain ATS-specific legal and accountable security/privacy approval for AI processing, form actions, sensitive fields, signatures, and submission. | Ready | Legal/privacy counsel; security/privacy reviewers | Concrete adapters, model/provider, approval UX, and test evidence | Release gates LR-D3-01 and LR-D3-02; live ATS effects remain disabled until approved. |
| D3-013 | Define supported application-form variants and acquire authorized, sanitized provider fixtures with separate QA representativeness acceptance. | Ready | QA/automation; capability reviewers | D0-007 process; exact adapter scope and source authorization | Blocking provider-evidence gate under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md); synthetic fixtures do not satisfy it. |
| D3-014 | Make the Applications schema participate in candidate export, deletion, and restore reconciliation (privacy-authorized delete/export functions, portable export schema section, Profile orchestration, restore manifest and database-migrations composition). | Ready | Unassigned | D3-005 | Discovered 2026-09-18: Applications stores candidate-owned packet values, so real-candidate use is blocked until this exists. |

## Exit criteria

- [ ] Every generated claim is grounded in confirmed profile evidence or explicitly requires review.
- [ ] Protected, voluntary, legal, signature, authorization, and other sensitive answers follow mandatory-review policy.
- [ ] Rendered documents preserve intended content and pass format/factuality checks.
- [ ] Approval is bound to an immutable packet and expires on material job/form/artifact changes.
- [ ] Supported ATS variants meet agreed field accuracy and confirmation thresholds.
- [ ] Ambiguous submission responses cannot cause blind duplicate submission.
- [ ] Owner-scoped current-action and technical-history reads are authorized, durable, observable,
      recoverable, and end at confirmed submission with `applied` terminal.
- [ ] No recruiter response, interview, offer, rejection, or other post-submission hiring outcome is
      collected or inferred.
- [ ] Unsupported variants degrade to safe assisted/manual completion.
- [ ] User correction, adapter failure, model quality, and confirmation metrics are observable by version.
- [ ] Security, privacy, accessibility, AI evaluation, workflow replay, and product acceptance evidence is complete.
- [ ] Every enabled application adapter has current authorized provider fixtures, sanitization and scan evidence, and separate QA representativeness acceptance.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-09-18 | **D3 started.** D3-005 moved to In progress. Implemented the Applications service foundation: eight-state lifecycle with a closed technical-history vocabulary that refuses hiring-outcome kinds; review classification (restricted answers always shown, `never_infer` answers dropped unless candidate supplied, attestations/signatures/challenges always direct candidate action); deterministic packet hash and approval bound to job revision, form hash, artifact hashes and a 24-hour limit; write-ahead attempt dispatch with ambiguous-result reconciliation; and an owner-scoped, idempotent PostgreSQL store that commits state, revision, append-only history, and an identifier-only outbox row atomically. Locally verified with generated-synthetic data only: 41 unit tests and 15 PostgreSQL 16.6 integration tests (concurrent start race, replay, tamper and terminal-state guards, crash recovery). No contract, gateway, workflow, deployment, real-candidate data, or ATS action exists yet. | D3-005, D3-014 | [Service README](../../../backend/services/applications/README.md), [migration](../../../backend/services/applications/migrations/0001_applications_foundation.sql), [integration tests](../../../backend/services/applications/src/store.integration.test.ts) |
| 2026-08-17 | Accepted the Option A allocation of Applications-owned technical history and owner-scoped reads from removed D1-006. This governance change does not start D3 or authorize contracts, migrations, implementation, deployment, real-candidate data, or ATS effects. | D3-005, D3-008 | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md), [approved D1 disposition](../foundation/d1-006-application-history-ownership-review-disposition.md) |
| 2026-07-28 | Assigned application-preparation and submission delta approval to D3 without starting implementation. | D3-012 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-08-12 | Accepted ownership of authorized representative application-form fixtures from D0; this assignment does not start D3 or approve any provider action. | D3-007, D3-013 | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), [fixture policy](../foundation/ats-fixture-policy.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-09-18 | Fixed engineering defaults for D3-005, all subject to product/security review under D3-012: a live approval expires after 24 hours; the auto-review confidence threshold is 0.90; one live application per candidate and job (a cancelled one may restart); cancellation is impossible once submission is in flight; a candidate-attested "not submitted" reconciliation requires an explicit duplicate-risk acknowledgement; `user_attested` confirmation is recorded as its own evidence kind. | These are conservative product-safety defaults that keep approval scarce and duplicate submission structurally hard; they are not legal or approval conclusions. | [Packet](../../../backend/services/applications/src/packet.ts), [attempts](../../../backend/services/applications/src/attempt.ts) |
| 2026-08-17 | Own authoritative technical application history through confirmed submission in D3 and expose it through owner-scoped Applications reads. | The Applications state machine, packets, attempts, submission evidence, confirmation, and history require one owner and one migration lineage; a Notifications projection cannot authorize or prove these transitions. | [ADR-024](../../adr/024-application-history-and-inbox-phase-ownership.md) |
| 2026-08-12 | Provider-derived form fixture evidence is acquired and accepted with each concrete application adapter. | Form fidelity and representative coverage depend on the declared supported variant. | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D3-R1 | Open | Model-generated unsupported claims could materially harm candidates. | Unassigned | Build provenance and factuality evaluation before generation UX. |
| D3-R2 | Open | ATS layout changes can create incorrect values or ambiguous submissions. | Unassigned | Require provider fixtures, canaries, kill switches, packet revalidation, and confirmation reconciliation. |
| D3-R3 | Open | A “one click” promise can obscure mandatory user decisions. | Unassigned | Design review by exception and explicit sensitive/irreversible-action gates. |
| D3-R4 | Open | Packet fields can carry Restricted answer values (ADR-010) but the Applications schema currently relies on database-level encryption only; ADR-010 requires a separate key and least-privilege boundary for Restricted values. | Unassigned | Decide envelope-encryption/key separation before any real-candidate use; include in D3-001 vault design and the D3-012 review. |
| D3-R5 | Open | Applications holds candidate data that candidate export, deletion, and restore do not yet cover. | Unassigned | Complete D3-014 before any real-candidate use. |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
