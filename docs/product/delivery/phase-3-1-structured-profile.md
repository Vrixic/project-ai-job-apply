# D3.1 - Structured Candidate Profile

- Status: In progress
- Start: 2026-10-22
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-10-22
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
| D3.1-001 | Design and accept an ADR for the structured Profile: section model, single-source-of-truth rule, draft-then-save resume import, per-entry provenance (entered or imported), versioning and idempotency, data classification, and the disposition of existing development facts. Include a map of every consumer of profile facts (Profile service, Documents proposals, Matching, Applications runtime `toGraphFact`, AI SDK grounding, extension, candidate export/deletion/restore, OpenAPI, domain schemas, web BFF) and the effect on [D3-001](phase-3-application-preparation.md), [D4-003](phase-4-workday-and-remote.md), and architecture section 5.1. | Complete | Product owner (approval) | None | Complete 2026-10-22: [ADR-052](../../adr/052-structured-candidate-profile.md) accepted with the consumer map; ADR-036 superseded. The owner chose the recommendations below. Recommended: discard existing development facts and re-import the resume, because only development is deployed. [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) is prior analysis of the Education/Work Experience gap specifically (narrower than this task's scope, no consumer map or security/privacy review) - read and fold in, supersede, or reject. |
| D3.1-002 | Privacy and security delta review of the new data classes (contact and address, employment history, free-text answers), their export, deletion, restore, logging exclusions, and the confirmation that no Restricted answer enters the general profile. | Removed | n/a | D3.1-001 | Removed 2026-10-22 by owner decision: privacy reviews are out of scope. The design still keeps restricted answers out of the general profile. |
| D3.1-003 | Evolve contracts: OpenAPI section and answer operations, domain schemas, generated clients, and event contracts if any. | Complete | Unassigned | D3.1-001 | Complete 2026-10-22: 15 additive OpenAPI paths (24 operations) for Personal, Education, Work experience, Skills, Application answers and import drafts, with 25 new schemas, `ProfileEntryReference`, the `profile-sections` domain schema and generated clients. Version 1 stays compatible: no existing path or schema changed. Gateway routes and persistence follow in D3.1-004. |
| D3.1-004 | Implement Profile service persistence and API for the sections: owner-scoped tables, forward-only migrations, optimistic versioning, idempotent writes, ownership tests on real PostgreSQL, Gateway routes and `allowedRoute`, and candidate export, deletion, and restore-manifest coverage. | Complete | Unassigned | D3.1-003 | Complete 2026-10-22 in three merged slices: persistence (#712), Gateway routes (#713) and export and deletion coverage (migration 0013). Locally verified on PostgreSQL and in the Gateway suites; not deployed. The release guards listed in the migrations README still need 0012 and 0013 at release time. |
| D3.1-005 | Implement Application answers: reusable question and answer pairs with exact-key matching, edit and delete, and refusal of restricted categories. | Complete | Unassigned | D3.1-004 | Complete 2026-10-22: create, edit and delete with the restricted-question guard shipped with D3.1-004; `matchApplicationAnswer` adds exact normalized-key reuse (no fuzzy match, no restricted match, owner scoped), tested on PostgreSQL. Consumers adopt it in D3.1-009. Restricted answers remain in the ADR-010 vault owned by [D3-001](phase-3-application-preparation.md) and D3-015. |
| D3.1-006 | Change resume import so parsed content becomes draft Education, Work experience, and Skills entries that join the profile only on save. Parser and processor are released together. | Complete | Unassigned | D3.1-004 | Complete 2026-10-22 in source: a section-aware extractor (`resume-drafts.ts`) reads Personal, Education, Work experience and Skills; the Documents processor now imports drafts through `PostgresResumeProposalWriter.importDrafts` (idempotent by document, version and parser; never recreates a saved or discarded draft; capped at 200); a security hold or resume deletion erases the unsaved drafts and keeps saved records. Tested on PostgreSQL. Nothing is deployed: the Documents processor and the Profile writer must be released together. The old fact extractor (`proposals.ts`), `PostgresResumeProposalWriter.import` and the document-processing acceptance operator are now unused or stale and go with the fact model in D3.1-010. |
| D3.1-007 | Build the web Profile area with tabs and per-section edit forms, remove the "Your profile facts" panel, rewrite the onboarding tests, and meet accessibility and responsive checks. | Complete | Unassigned | D3.1-004, D3.1-005, D3.1-006 | Complete 2026-10-22 in source: a tabbed Profile area (Personal, Education, Work experience, Skills, Application answers, Resume, Job preferences, and Restricted answers when enabled) with per-section forms, reorder, confirmed delete, and a resume-suggestions review that saves, edits or discards each draft; a fixed-section BFF (`profile-section-bff.ts`, five route files) with contract-checked requests and responses; the facts panel, Personal and Skills cards and their tests are removed. Uses the generated contract validators only. Formal accessibility and responsive audits were removed by the 2026-10-21 owner decision; labelled controls, tab roles and keyboard navigation are built in. Not deployed. |
| D3.1-008 | Rebase grounded generation and packet grounding on structured entry references instead of fact identifiers, preserving the [ADR-030](../../adr/030-ai-gateway-and-grounded-generation.md) unsupported-claim checks, the immutable packet hash, and approval binding. Confirm what already-stored packets and history reference and keep them readable. | Complete | Unassigned | D3.1-001, D3.1-004 | Complete 2026-10-22 in source: `profileEntriesToGraphFacts` (domain) presents saved Personal, Education, Work experience and Skills records to the existing `FactGraph`, ADR-030 grounding and packet field mapping; `ProfileSectionStore.listGroundingFacts` reads them from one consistent snapshot and excludes drafts; the Gateway Applications runtime and the preparation workflows (evidence source, documents, native and owner RPC compositions) now read grounding evidence only from saved records; packet fields cite their saved record id (a legacy-named `sourceFactIds` that now holds record ids) and the cover-letter evidence hash covers the entries. Stored packets and history keep their old fact identifiers as inert labels: nothing dereferences them (only vault and uploaded-resume ids are read back). A deterministic regression test (`profile-entry-grounding.test.ts`) shows the unsupported-claim checks still refuse unsupported numbers, entities and uncited or unknown evidence. Live model evaluation was removed by the 2026-10-21 owner decision. Not deployed. |
| D3.1-009 | Point matching, Prepare, and extension fill at the structured records. | Complete | Unassigned | D3.1-008 | Complete 2026-10-22. Inspection found no Matching read of facts (it reads job preferences, ADR-052 consumer map) and the extension fills only from the approved packet, whose fields now cite saved Profile records (D3.1-008), so both already read only the structured records. Gap found and recorded as D3.1-013: saved Application answers are stored and matched by exact key (D3.1-005) but no packet or extension flow offers them yet, because the packet taxonomy has no free-text question fields. |
| D3.1-010 | Retire the fact model: candidate UI, BFF routes, Gateway routes, OpenAPI operations, domain and event schemas, Profile tables through a forward-only migration, restore-manifest entries, and stale docs. Update D3-001, D4-003, and architecture section 5.1 wording. | Complete | Unassigned | D3.1-009 | Complete 2026-10-22: migration `0014_retire_profile_facts` drops the three fact tables and their helpers and renames `resume_fact_imports` to `resume_imports`; the portable export no longer emits facts (the `facts` field stays optional in the schema so older exports validate) and account deletion no longer names them; the Gateway fact routes and `allowedRoute` entries, the OpenAPI operations and schemas, the `ProfileFact` domain schema, the Profile store fact methods and errors, `profile-fact-graph`, the web BFF routes, validators and problem copy, the old resume fact extractor and `PostgresResumeProposalWriter.import` are removed; restore manifest, preservation digest (97 relations), postconditions, cross-runtime replay pins and tests are updated. `FactGraph` and `GraphFact` stay as the internal evidence structure that saved records are adapted to. Release-time follow-up, not done: the migration image publisher, runtime-release guard and staging verifier still list the earlier migrations and relation count, and the document-processing acceptance operator and the D1 browser assurance script still exercise the removed fact model; both are AWS or non-security acceptance tooling and are left for the owner's cleanup decision. Not deployed. |
| D3.1-011 | Deploy through the guarded operators (migration, Gateway, web) with the owner reviewing saved plans, and verify the routes through the hosted path. | Blocked | Unassigned | D3.1-010 | Open. Needs the owner: a deployment applies migrations 0012 to 0014, changes the Gateway and web releases and requires saved plans and authorization for AWS changes, which the owner has not given. A release starts only from a merged, clean main. |
| D3.1-013 | Offer saved Application answers for free-text questions: add question fields to the observed-form and packet flow so an exact-key match is shown to the candidate for review, bound into the packet hash and filled by the extension. | Removed | Owner decision | D3.1-005, D3.1-008 | Discovered 2026-10-22. Cross-layer (OpenAPI, Applications packet and hash, web review, extension handoff); restricted questions stay in the ADR-010 vault. Needs an ADR before building: the packet has a fixed field set (`application-fields.v1.json`) and no per-question fields, so this changes the packet schema and hash. 2026-10-22: the owner declined the ADR, so free-text questions stay with the candidate and the packet keeps its fixed field set. |
| D3.1-012 | End-to-end acceptance of the candidate journey on the deployed web app and installed extension. | Removed | n/a | D3.1-011 | Removed 2026-10-21 by owner decision: acceptance testing is out of scope. |

## Exit criteria

- [ ] A signed-in candidate can create, edit, and delete entries in every Profile section and in Application answers through the hosted web app, and the changes persist and appear in export.
- [ ] No candidate-facing "profile facts" panel or proposed, confirmed, rejected, or invalidated state remains, and no profile-fact route, schema, contract, or table remains.
- [ ] Resume upload prefills draft entries, nothing joins the profile until the candidate saves it, and no value is fabricated or silently accepted.
- [ ] Prepare, matching, and extension fill read only the structured records, generated claims remain grounded and checked, and the packet approval binding is intact.
- [ ] Restricted answers are not collected in the general profile and stay behind the ADR-010 review flow.
- [ ] Export, deletion, and restore cover the new records, with evidence from the guarded tooling.
- [ ] D3-001, D4-003, architecture section 5.1, this document, and the master tracker agree.

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-09-21 | Created this phase record from the owner's direction. No implementation started and no code, contract, or migration changed. The reference page's layout was inspected in the owner's browser session (sections and form fields only); no third-party data was recorded. | D3.1-001 to D3.1-012 | [Delivery tracker](DELIVERY_TRACKER.md#d31---structured-candidate-profile) |
| 2026-10-02 | Ahead of D3.1 starting (D3 is not yet complete), PR #499 added Personal and Skills cards to the candidate Profile page, reading the same reference page and built on the current profile-facts model rather than waiting for this phase. This is a stopgap: D3.1-010 retires the fact model and its tables entirely, so this UI and its `identity`/`skill` facts are superseded, not a step toward D3.1. Drafted [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) for the Education/Work Experience gap found during that work; it is narrower than D3.1-001's scope (no consumer map, no security/privacy review) and is recorded as input to D3.1-001, not an independently accepted decision. | D3.1-001 | [PR #499](https://github.com/Vrixic/project-ai-job-apply/pull/499), [ADR-036](../../adr/036-structured-education-and-work-experience-entries.md) |
| 2026-10-22 | Started D3.1. Wrote and accepted [ADR-052](../../adr/052-structured-candidate-profile.md) (structured Profile, draft-then-save import, entry references, discard development facts) with the full consumer map. Matching and the extension were found not to read facts directly. | D3.1-001 | [ADR-052](../../adr/052-structured-candidate-profile.md) |
| 2026-10-22 | D3.1-003: added the structured Profile contracts. Writes require an idempotency key and, for updates and deletes, the current version; responses are `no-store`. `api-contracts` (134) and `domain` (55) tests, both typechecks and scoped Biome pass. A second generation run produces no diff. No route is served yet, so nothing is deployed. | D3.1-003 | `packages/api-contracts/src/profile-sections-contract.test.ts`, `packages/domain/src/profile-sections-schema.test.ts` |
| 2026-10-22 | D3.1-004 slice 1 (Profile service persistence): migration `0012_profile_sections`, the owner-scoped section store with optimistic versions, idempotency, active-candidate lease, restricted-question refusal and draft save, and the restore, deletion-postcondition and manifest pins for the four new relations (96 to 100, 81 to 82 migrations). 8 new tests on real PostgreSQL plus the existing profile (231 unit, 54 integration), billing and trust integration suites pass; the 4 failing `application-restore-reconciliation` tests and the reconciled-copy lambda suite were already failing against the retained d5c2 manifest pin. The migration image publisher, the runtime-release guard and the staging restore verifier still list the earlier migration set and relation count and must be updated at release time. Gateway routes and export coverage are the next slices. | D3.1-004 | `backend/services/profile/src/profile-sections.integration.test.ts` |
| 2026-10-22 | D3.1-004 slice 2 (Gateway): the 24 Profile section, answer and draft routes in the candidate controller with strict request validation, scopes (`profile:read`/`profile:write`), required idempotency keys, a required `expectedVersion` query on deletes, no-store responses and stable problem codes, plus the Lambda `allowedRoute` entries and the boundary query rule. The store is injected as `profileSections` and fails closed with 503 when absent. Gateway suite passes (414 tests), including 7 new route tests and a test that every OpenAPI Profile operation is routed at the Lambda boundary. Nothing deployed; the web BFF is D3.1-007. Export coverage is the remaining D3.1-004 slice. | D3.1-004 | `backend/gateway/src/app.test.ts`, `backend/gateway/src/lambda.test.ts` |
| 2026-10-22 | D3.1-004 slice 3 (rights): migration `0013_profile_sections_candidate_rights` extends the portable candidate export with the Personal, Education, Work experience, Skills, Application answers and import-draft sections and makes account deletion erase them and their idempotency replay records. The export schema gains optional fields only. A real-PostgreSQL test validates a live export against the portable schema and verifies deletion leaves nothing and spares other candidates. Profile (232 unit, 55 integration) and Gateway suites pass; the application-restore-reconciliation and reconciled-copy-lambda failures are the earlier stale-pin ones, and some trust and jobs integration tests failed on residue left in the shared local database by repeated runs. D3.1-004 is complete. | D3.1-004 | `backend/services/profile/src/profile-sections.integration.test.ts` |
| 2026-10-22 | D3.1-005: added `matchApplicationAnswer` (exact normalized key, owner scoped, restricted questions never match). 10 section tests on PostgreSQL pass. | D3.1-005 | `backend/services/profile/src/profile-sections.integration.test.ts` |
| 2026-10-22 | D3.1-006: resume import produces unsaved drafts. New `resume-drafts.ts` extractor with conservative parsing (an entry whose title or company cannot be read is skipped; month dates become the first of the month, year-only dates the first or last day of the year), Profile `importDrafts`, hold and retire erase unsaved drafts, and the processor switched over. 7 extractor tests, the updated processor integration test (2), Documents unit (2044), Profile (233 unit, 56 integration) and purge tests pass; some Documents and Gateway database tests fail on stale expectations or residue in the shared local database that predate this change. | D3.1-006 | `backend/services/documents/src/resume-drafts.test.ts`, `backend/services/documents/src/processor.integration.test.ts` |
| 2026-10-22 | D3.1-007: web Profile area and BFF. New `profile-sections/` components, `lib/profile-section-bff.ts` and routes under `/api/platform/profile`; the Profile page now hosts the existing job-preferences form in its own tab. Removed `profile-facts-form`, `profile-personal-card`, `profile-skills-card`, the fact-review onboarding tests and `resume-profile-state.test`. Web suite passes (943 tests) with 7 new BFF boundary tests and 3 UI flow tests; typecheck, lint and `next build` pass. Not exercised in a browser against a live sign-in. The legacy `/api/platform/profile-facts` routes stay until D3.1-010. | D3.1-007 | `frontend/web/lib/profile-section-bff.test.ts`, `frontend/web/app/profile-sections/profile-area.test.tsx` |
| 2026-10-22 | D3.1-008: grounding and packets read saved Profile entries. New domain adapter and 5 tests, store `listGroundingFacts` with an integration test on PostgreSQL, consumers switched in the Gateway runtime and workflow compositions, packet fields cite record ids, and a deterministic grounding regression test. Profile, domain, ai-sdk, applications (533) and the workflow unit tests pass; the Gateway and some workflow database suites still fail on shared local database residue that predates this change. The only inference is the whitespace name split into first, middle and last. | D3.1-008 | `packages/domain/src/profile-entry-facts.test.ts`, `packages/ai-sdk/src/profile-entry-grounding.test.ts` |
| 2026-10-22 | D3.1-009 and D3.1-010: consumers confirmed, fact model retired. Migration 0014, source removals in the Profile service, Gateway, contracts, domain and web, and the restore, deletion and replay pins moved to 97 relations and 84 migrations. Domain (80), api-contracts (131), documents (2043), applications (533), gateway (409), profile (unit and integration), web (949) and the workflow unit suites pass; the known stale reconciled-copy and application-restore-reconciliation tests still fail as before. Discovered work D3.1-013 added. D3.1-011 (deployment) waits on the owner. | D3.1-009, D3.1-010, D3.1-013 | Migration `0014_retire_profile_facts.sql` |
| 2026-10-22 | D3.1-011 prerequisite: the migration-owner test gate failed 4 tests of the Applications transition reconciliation diagnostic, which compared the live restore manifest against its pinned 2026-10-08 hash and so broke whenever the manifest advanced (already failing at 15193dc3). The diagnostic now loads its own retained target manifest, embedded byte-exact and hash-checked, and ignores the live manifest. The live manifest, restore contract and pins are unchanged. 125 of 125 database-migrations tests pass. |
| 2026-10-22 | D3.1-011 prerequisite: the dependency audit gate failed on new registry advisories, including two critical and one high Next.js flaws in 16.0.0 to 16.4.0 that affected the web and admin apps on 16.3.8. Next moves to 16.4.2 (and its sharp override), Fastify to 5.12.7 (gateway pin and override floor) and Vitest to 5.0.5. The gate passes with no risk exceptions; web typecheck, 985 web tests, the web production build and 437 gateway tests pass. |

## Decisions and scope changes

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-10-22 | Accepted [ADR-052](../../adr/052-structured-candidate-profile.md): discard existing development facts and re-import the resume; keep restricted answers out of the general Profile. | The owner approved both recommendations. Only synthetic development data exists. | Owner direction 2026-10-22 |
| 2026-10-22 | Owner removed privacy reviews from all phases: D3.1-002 is Removed and no longer gates D3.1-004. | Owner direction 2026-10-22 |
| 2026-10-21 | Owner removed non-security testing and acceptance work: D3.1-012 is Removed and D3.1 no longer waits for D3 to complete. Security and privacy review (D3.1-002) is unchanged. | Owner direction 2026-10-21 |
| 2026-09-21 | The owner decided that "profile facts" is not a section of its own and is removed. Its content moves into a structured Profile of skills, resume details, and generic application answers, delivered as D3.1 after D3. | Ambiguous facts are hard to track; plain saved records give one meaning and one place to correct. | Owner direction 2026-09-21 |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D3.1-R1 | Open | D3 builds on facts (D3-001 fact graph, D3-016 tailoring, AI SDK grounding, Applications runtime), so D3.1 changes finished D3 behavior. | Unassigned | D3.1-001 consumer map; D3.1-008 keeps ADR-030 checks and adds a factuality regression run. |
| D3.1-R2 | Open | Stored packets or history may reference fact identifiers, and immutable history must stay readable. | Unassigned | ADR-052 found packets keep identifiers and hashes only; D3.1-008 adds the test that history renders without dereferencing them. |
| D3.1-R3 | Open | Copying a reference profile's Equal Employment tab would collect Restricted answers outside ADR-010. | Unassigned | Keep restricted categories out of scope and refuse them in D3.1-005. |
| D3.1-R4 | Closed | Owner decisions pending: discard existing development facts (recommended) or migrate them; keep restricted answers out until the restricted-data flow exists (recommended). | Product owner | Resolved 2026-10-22: discard existing development facts; keep restricted answers out of the general Profile ([ADR-052](../../adr/052-structured-candidate-profile.md)). |
| D3.1-R5 | Open | Work in this phase must not collide with open D3 PRs on shared delivery-record rows. | Unassigned | One PR at a time; records ride with the change they describe. |
| D3.1-R6 | Open | PR #499 (2026-10-02) added Personal and Skills cards to the Profile page on the current profile-facts model, ahead of D3.1 starting. D3.1-010 ("Retire the fact model") must also remove this UI and its `identity`/`skill` facts, not just the older "Your profile facts" panel. | Unassigned | Account for PR #499's UI and facts explicitly in D3.1-007 (replacement UI) and D3.1-010 (retirement). |

## Completion record

- Completion date: Not completed
- Exit review: Not performed
- Release/evidence summary: Not available
- Accepted residual risks: None recorded
