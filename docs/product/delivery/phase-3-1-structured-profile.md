# D3.1 - Structured Candidate Profile

- Status: Not started
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-09-21
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d31---structured-candidate-profile)

## Objective

Replace the "profile facts" model (proposed, confirmed, rejected, and invalidated facts) with one
structured Profile that a candidate can read and edit directly: Personal, Education, Work
experience, Skills, Application answers, and Resume. Every entry is a plain saved record with one
meaning, so there is one place to look and one place to correct. Resume upload prefills draft
entries that join the profile only when the candidate saves them. Preparation, matching, and
extension fill read only these records.

The layout follows the owner's reference profile page: one scrolling page with a tab per section,
an edit form per section, and the same records feeding autofill. Only the structure was reviewed;
no third-party data or branding is copied.

## Ordering

Owner decision 2026-10-21: D3.1 no longer waits for D3 to complete and may start now. D3 keeps building on facts (D3-001 fact graph, D3-016 tailoring,
grounded generation), and D3.1 changes those consumers afterward, so its first task is a full
consumer map and an accepted ADR before any code moves.

## Definition of done

A task is **done** when its part of the candidate journey works through the deployed web app and
the installed extension. The journey is: upload a resume, see the sections prefilled as drafts,
edit and save them, add reusable application answers, prepare an application, and see it use
exactly those saved records. State plainly what works and what does not. No separate scripted or
person-run acceptance pass is required (owner decision 2026-10-21).

## Deployment posture

No new service or always-on resource. The Profile service and the scale-to-zero Lambda runtime
([ADR-016](../../adr/016-scale-to-zero-application-runtime.md)) host the new records. Persistence
changes are explicit forward-only SQL migrations, never runtime schema mutation. Every new Gateway
route is added to `allowedRoute` in `backend/gateway/src/lambda.ts` and tested through the hosted
path (BFF, API Gateway, Lambda) before it is called deployed. Work ships one PR at a time.

## Scope

In scope:

- Personal (name, email, phone, address, links), Education, Work experience (with bullet points),
  Skills, and Application answers as structured, owner-scoped, versioned records.
- Resume import as draft entries, with no silent acceptance and no fabricated values.
- Removal of the candidate-facing facts panel and of the profile-fact routes, contracts, schemas,
  and tables once every consumer has moved.

Out of scope:

- Restricted answers: work authorization, sponsorship, demographic, disability, veteran, and legal
  questions stay behind the [ADR-010](../../adr/010-restricted-answer-vault-and-mandatory-review.md)
  restricted-data boundary and mandatory review, and are not collected in the general profile.
- LinkedIn import, coaching, and any post-submission tracking.

The exact field set per section is decided in D3.1-001.

## Task register

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D3.1-001 | Design and accept an ADR for the structured Profile: section model, single-source-of-truth rule, draft-then-save resume import, per-entry provenance (entered or imported), versioning and idempotency, data classification, and the disposition of existing development facts. Include a map of every consumer of profile facts (Profile service, Documents proposals, Matching, Applications runtime `toGraphFact`, AI SDK grounding, extension, candidate export/deletion/restore, OpenAPI, domain schemas, web BFF) and the effect on [D3-001](phase-3-application-preparation.md), [D4-003](phase-4-workday-and-remote.md), and architecture section 5.1. | Ready | Product owner (approval) | None | Open. Recommended: discard existing development facts and re-import the resume, because only development is deployed. [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) is prior analysis of the Education/Work Experience gap specifically (narrower than this task's scope, no consumer map or security/privacy review) - read and fold in, supersede, or reject. |
| D3.1-002 | Privacy and security delta review of the new data classes (contact and address, employment history, free-text answers), their export, deletion, restore, logging exclusions, and the confirmation that no Restricted answer enters the general profile. | Ready | Independent security/privacy reviewer | D3.1-001 | Release gate under [delivery rule 8](README.md#tracking-rules). Technical implementation is not approval. |
| D3.1-003 | Evolve contracts: OpenAPI section and answer operations, domain schemas, generated clients, and event contracts if any. | Ready | Unassigned | D3.1-001 | Open. Run `pnpm contracts:generate`; never hand-edit `generated/`. |
| D3.1-004 | Implement Profile service persistence and API for the sections: owner-scoped tables, forward-only migrations, optimistic versioning, idempotent writes, ownership tests on real PostgreSQL, Gateway routes and `allowedRoute`, and candidate export, deletion, and restore-manifest coverage. | Ready | Unassigned | D3.1-003, D3.1-002 | Open. |
| D3.1-005 | Implement Application answers: reusable question and answer pairs with exact-key matching, edit and delete, and refusal of restricted categories. | Ready | Unassigned | D3.1-004 | Open. Restricted answers remain in the ADR-010 vault owned by [D3-001](phase-3-application-preparation.md) and D3-015. |
| D3.1-006 | Change resume import so parsed content becomes draft Education, Work experience, and Skills entries that join the profile only on save. Parser and processor are released together. | Ready | Unassigned | D3.1-004 | Open. Replaces the proposal path in Documents and Profile. |
| D3.1-007 | Build the web Profile area with tabs and per-section edit forms, remove the "Your profile facts" panel, rewrite the onboarding tests, and meet accessibility and responsive checks. | Ready | Unassigned | D3.1-004, D3.1-005, D3.1-006 | Open. Uses generated clients only. |
| D3.1-008 | Rebase grounded generation and packet grounding on structured entry references instead of fact identifiers, preserving the [ADR-030](../../adr/030-ai-gateway-and-grounded-generation.md) unsupported-claim checks, the immutable packet hash, and approval binding. Confirm what already-stored packets and history reference and keep them readable. | Ready | Unassigned | D3.1-001, D3.1-004 | Open. Needs a factuality regression run before any generation UX depends on it. |
| D3.1-009 | Point matching, Prepare, and extension fill at the structured records. | Ready | Unassigned | D3.1-008 | Open. |
| D3.1-010 | Retire the fact model: candidate UI, BFF routes, Gateway routes, OpenAPI operations, domain and event schemas, Profile tables through a forward-only migration, restore-manifest entries, and stale docs. Update D3-001, D4-003, and architecture section 5.1 wording. | Ready | Unassigned | D3.1-009 | Open. Nothing is removed before every consumer has moved. |
| D3.1-011 | Deploy through the guarded operators (migration, Gateway, web) with the owner reviewing saved plans, and verify the routes through the hosted path. | Ready | Unassigned | D3.1-010 | Open. A release starts only from a merged, clean main. |
| D3.1-012 | End-to-end acceptance of the candidate journey on the deployed web app and installed extension. | Removed | n/a | D3.1-011 | Removed 2026-10-21 by owner decision: acceptance testing is out of scope. |

## Exit criteria

- [ ] A signed-in candidate can create, edit, and delete entries in every Profile section and in Application answers through the hosted web app, and the changes persist and appear in export.
- [ ] No candidate-facing "profile facts" panel or proposed, confirmed, rejected, or invalidated state remains, and no profile-fact route, schema, contract, or table remains.
- [ ] Resume upload prefills draft entries, nothing joins the profile until the candidate saves it, and no value is fabricated or silently accepted.
- [ ] Prepare, matching, and extension fill read only the structured records, generated claims remain grounded and checked, and the packet approval binding is intact.
- [ ] Restricted answers are not collected in the general profile and stay behind the ADR-010 review flow.
- [ ] Export, deletion, and restore cover the new records, with evidence from the guarded tooling.
- [ ] The privacy and security delta review has a recorded disposition.
- [ ] D3-001, D4-003, architecture section 5.1, this document, and the master tracker agree.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-09-21 | Created this phase record from the owner's direction. No implementation started and no code, contract, or migration changed. The reference page's layout was inspected in the owner's browser session (sections and form fields only); no third-party data was recorded. | D3.1-001 to D3.1-012 | [Delivery tracker](DELIVERY_TRACKER.md#d31---structured-candidate-profile) |
| 2026-10-02 | Ahead of D3.1 starting (D3 is not yet complete), PR #499 added Personal and Skills cards to the candidate Profile page, reading the same reference page and built on the current profile-facts model rather than waiting for this phase. This is a stopgap: D3.1-010 retires the fact model and its tables entirely, so this UI and its `identity`/`skill` facts are superseded, not a step toward D3.1. Drafted [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) for the Education/Work Experience gap found during that work; it is narrower than D3.1-001's scope (no consumer map, no security/privacy review) and is recorded as input to D3.1-001, not an independently accepted decision. | D3.1-001 | [PR #499](https://github.com/Vrixic/project-ai-job-apply/pull/499), [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-10-21 | Owner removed non-security testing and acceptance work: D3.1-012 is Removed and D3.1 no longer waits for D3 to complete. Security and privacy review (D3.1-002) is unchanged. | Owner direction 2026-10-21 |
| 2026-09-21 | The owner decided that "profile facts" is not a section of its own and is removed. Its content moves into a structured Profile of skills, resume details, and generic application answers, delivered as D3.1 after D3. | Ambiguous facts are hard to track; plain saved records give one meaning and one place to correct. | Owner direction 2026-09-21 |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D3.1-R1 | Open | D3 builds on facts (D3-001 fact graph, D3-016 tailoring, AI SDK grounding, Applications runtime), so D3.1 changes finished D3 behavior. | Unassigned | D3.1-001 consumer map; D3.1-008 keeps ADR-030 checks and adds a factuality regression run. |
| D3.1-R2 | Open | Stored packets or history may reference fact identifiers, and immutable history must stay readable. | Unassigned | Verify in D3.1-001 what is stored before choosing the reference model. |
| D3.1-R3 | Open | Copying a reference profile's Equal Employment tab would collect Restricted answers outside ADR-010. | Unassigned | Keep restricted categories out of scope and refuse them in D3.1-005. |
| D3.1-R4 | Open | Owner decisions pending: discard existing development facts (recommended) or migrate them; keep restricted answers out until the restricted-data flow exists (recommended). | Product owner | Record both answers in D3.1-001. |
| D3.1-R5 | Open | Work in this phase must not collide with open D3 PRs on shared delivery-record rows. | Unassigned | One PR at a time; records ride with the change they describe. |
| D3.1-R6 | Open | PR #499 (2026-10-02) added Personal and Skills cards to the Profile page on the current profile-facts model, ahead of D3.1 starting. D3.1-010 ("Retire the fact model") must also remove this UI and its `identity`/`skill` facts, not just the older "Your profile facts" panel. | Unassigned | Account for PR #499's UI and facts explicitly in D3.1-007 (replacement UI) and D3.1-010 (retirement). |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
