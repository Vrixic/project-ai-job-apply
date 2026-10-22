# ADR-052: Structured candidate Profile replaces profile facts

Status: Accepted (owner approval 2026-10-22); implementation not started
Date: 2026-10-22
Supersedes: [ADR-036](036-structured-education-and-work-experience-entries.md)
Task: [D3.1-001](../product/delivery/phase-3-1-structured-profile.md)

## Context

The Profile service stores the candidate as "profile facts": one row per claim, with a `kind`, a
`key`, a scalar or string-array value, a verification state (`proposed`, `confirmed`, `rejected`),
a sensitivity class, a source and optional supporting spans. A resume upload creates `proposed`
facts that the candidate confirms or rejects. Every generator and form filler reads only confirmed,
currently usable facts through the fact graph.

This is hard to track and hard to use. A claim has several states, the candidate cannot see one
place to read and correct their profile, and multi-field records such as a job (company, title,
dates, bullets) cannot be expressed. ADR-036 analysed the Education and Work Experience gap and
proposed two new stores beside the fact ledger. The owner decided on 2026-09-21 that "profile
facts" is not a section of its own and is removed in favour of one structured Profile, delivered
as D3.1.

## Decision

### 1. One structured Profile with plain saved records

The Profile has six sections. Each entry is a saved record with one meaning and no verification
state: it exists because the candidate saved it, and it is gone when they delete it.

| Section | Records |
|---|---|
| Personal | One record: name, email, phone, address (city, region, country, optional street and postal code), links (LinkedIn, GitHub, portfolio, other) |
| Education | Ordered entries: school, degree, field of study, start and end date |
| Work experience | Ordered entries: company, title, location, start date, end date or present, ordered bullets (0-20, 1-500 characters each) |
| Skills | Entries: one skill each, optional category |
| Application answers | Reusable question and answer pairs matched by exact normalized question key |
| Resume | A read-only view of the candidate's uploaded resume documents. The files stay owned by Documents; Profile stores no copy. |

Field limits, date rules and required fields follow ADR-036 where it defines them and are fixed in
the OpenAPI contract (D3.1-003).

### 2. Single source of truth

Each datum lives in exactly one record. Preparation, matching, grounding and extension fill read
only these records. Nothing derives, merges or infers a record. The fact graph's confirmation,
rejection, invalidation and expiry logic is deleted rather than ported: an entry is usable because
it is saved.

### 3. Resume import creates drafts, not profile records

A resume upload still goes through scan and parse. Its output is stored as **import drafts**: draft
Education, Work experience, Skills and Personal values in a separate table keyed to the import. No
consumer reads drafts. A draft becomes a profile record only when the candidate saves it, after
editing if they wish, and discarding it deletes it. Nothing is silently accepted and no value is
invented. Drafts are deleted when their resume or import is deleted and are covered by export and
deletion.

Each saved entry records `origin` (`entered` or `imported`) and, for imported entries, the import
id. Confidence scores and supporting spans are not carried over.

### 4. Versioning, idempotency and ownership

Entries use the append-only pattern already used by `profile.profile_fact_versions`: immutable
version rows, `expectedVersion` on updates, an idempotency key on every write, and a reject-update
trigger. Deleting an entry removes it and all its versions (and the idempotency replay records that
still carry its text) instead of writing a tombstone, so deletion erases the text. Display order is
stored on the entry, not the version, so reordering creates no new version. Every record belongs to exactly one `user_id`, enforced
and tested on real PostgreSQL as for the existing tables. The Personal section is a single record
per user. Education, Work experience and Skills carry `displayOrder` and support reorder.

### 5. Sensitivity and restricted answers

All Profile records are `standard` sensitivity. The `confidential` and `restricted` classes are
not collected. Work authorization, sponsorship, demographic, disability, veteran and legal
questions stay in the ADR-010 restricted-answer vault with mandatory review. Application answers
refuse any question that the existing restricted-category detection classifies as restricted, and
refuse when the classification is ambiguous. Restricted categories are not collected in the
general Profile until the ADR-010 flow supports a different design.

### 6. Reference model for grounding and packets

Generated content and packet fields reference Profile records by `{section, entryId, version}`,
named an entry reference. This replaces `sourceFactIds` in grounding, packet fields and the
`confirmedFactsHash`. The hash is recomputed over the referenced entries (canonical JSON of
section, id, version and value). The ADR-030 unsupported-claim checks, the immutable packet hash
and the approval binding are preserved and re-tested against the new references (D3.1-008).

Stored packets and history keep their existing `sourceFactIds` and hash as inert identifiers.
Inspection shows `packet.ts` keeps identifiers and hashes, not fact values. The fact tables are
discarded (decision 7), so these identifiers become labels that no longer resolve. History must
render without dereferencing them, and D3.1-008 verifies that with a test before the fact tables
are dropped.

### 7. Existing development facts are discarded

Only synthetic development data exists, so facts are not migrated. Candidates re-upload a resume
to produce drafts. This includes the `identity` and `skill` facts created by the stopgap Personal
and Skills cards (PR #499). The fact tables (`profile_facts`, `profile_fact_versions`,
`profile_fact_evidence`, `resume_fact_imports`) are removed by a forward-only migration in
D3.1-010, only after every consumer has moved.

### 8. The fact graph stays as an internal structure

The generic `FactGraph` and `GraphFact` types remain as the evidence structure that generation, grounding
and packet mapping already use. They are no longer a stored model: saved Profile records are adapted to
them at read time (`profileEntriesToGraphFacts`), so every saved record is usable and nothing else is.
`resume_fact_imports` becomes `resume_imports` and only records one import per document, version and parser.

### 9. Rights, export and restore

The new tables are candidate-owned PII. They are added to candidate export (the
`candidate-data-export` domain schema), to account deletion across all owners, and to the restore
manifest in the same change that creates them. The fact entries are removed from those lists in
D3.1-010, not before.

## Consumer map

| Consumer | Today | Change | Task |
|---|---|---|---|
| Profile service (`backend/services/profile`) | Fact store, `profile-fact-graph.ts`, resume fact imports, tables `profile_facts`, `profile_fact_versions`, `profile_fact_evidence`, `resume_fact_imports` | Add section tables, answers and import drafts; retire facts | 004, 005, 006, 010 |
| Documents proposals (`documents/src/proposals.ts`) | `extractResumeFactProposals` emits fact proposals | Emit import drafts instead; parser and processor released together | 006 |
| Documents generation (`cover-letter-*.ts`) | Takes `GraphFact[]` from the Profile owner API and a `confirmedFactsHash` | Take entry references and the recomputed hash | 008 |
| Applications runtime (`gateway/src/applications-runtime.ts`) | `toGraphFact`, `listProfileFacts`, filters out restricted facts | Read section records; no restricted filter needed | 008, 009 |
| Applications packets (`packet.ts`, `packet-source.ts`, migration 0004) | Fields carry `sourceFactIds`; table has `confirmed_facts_hash` and categories `profile_facts` | Fields carry entry references; legacy identifiers stay inert; categories value changes by a forward-only migration | 008 |
| Workflows (`application-preparation-documents.ts`, `application-preparation-evidence.ts`) | `listProfileFacts`, `profileFactToGraphFact` | Read section records | 008, 009 |
| AI SDK (`packages/ai-sdk`: `context.ts`, `grounding.ts`, `generation.ts`) | `selectPromptFacts` over `GraphFact` kinds employment, education, project, skill, certification | Build prompt context from entries; keep grounding checks | 008 |
| Domain (`packages/domain/src/fact-graph.ts`, `profile-fact.schema.json`) | Fact graph, usability and confidence rules | Delete after consumers move; add section schemas | 003, 010 |
| API contracts (`platform.v1.json`) | `/profile/facts`, `/profile/facts/{factId}`, schemas `ProfileFact*` | Add section and answer operations; remove fact operations | 003, 010 |
| Gateway (`app.module.ts`, `lambda.ts`) | Fact routes and `allowedRoute` entries | New routes added to `allowedRoute`; fact routes removed | 004, 010 |
| Web (`profile-page-client.tsx`, `profile-facts-form.tsx`, `profile-personal-card.tsx`, `profile-skills-card.tsx`, `api/platform/profile-facts/*`, BFF libraries) | Facts panel and the PR #499 cards | New tabbed Profile area; remove panel, cards and BFF routes | 007, 010 |
| Candidate export, deletion and restore (`candidate-data-export.schema.json`, restore manifest, deletion workflows and postconditions) | Cover fact tables | Cover section tables and drafts; remove fact entries last | 004, 010 |
| Matching (`backend/services/matching`) | Does not read facts; uses job preferences | No consumer change. Optionally read Skills later; not required | 009 |
| Extension | Does not read facts; fills from the approved packet and saved answers | No direct change. Packet source changes under Applications | 009 |
| Admin, mobile, analytics | No fact usage found | None | |

## Effect on other records

- **D3-001 (fact graph):** its behaviour is replaced by entry references; the task wording is
  updated in D3.1-010.
- **D4-003 (detect resume-parser overwrites without replacing user-confirmed facts):** reads
  "without replacing saved Profile entries". Import drafts never overwrite saved entries, so the
  rule holds by construction. Wording is updated in D3.1-010.
- **Architecture section 5.1 ("reusable truth profile"):** rewritten around saved sections and
  draft import in D3.1-010.
- **ADR-036:** superseded by this ADR.
- **ADR-010 and the restricted-answer vault:** unchanged.

## Consequences

- One place to read and correct the candidate's data, and no per-claim state to explain.
- A larger change than ADR-036's two additive stores: the fact consumers move, and the work is
  ordered so nothing is removed before every consumer has moved. New tables and routes ship first,
  then consumers, then the fact model is retired (D3.1-003 to D3.1-010).
- Candidates lose their development facts and must re-upload a resume. Acceptable because only
  synthetic development data exists.
- Grounded generation is re-based on new references. The ADR-030 checks, the packet hash and the
  approval binding must be re-tested in D3.1-008 before any generation UI depends on them.
- Every new Gateway route is added to `allowedRoute` in `backend/gateway/src/lambda.ts`.
- Persistence changes are forward-only SQL migrations. Work ships one PR at a time, and AWS
  changes are made only when the owner authorizes them.

## Alternatives

- **Migrate existing facts into entries.** Rejected: only synthetic data exists, and a lossy
  mapping from flat facts to multi-field entries would add code that is thrown away.
- **Keep the fact ledger and add Education and Work stores beside it (ADR-036).** Rejected: two
  models for one candidate keeps the "which is true" problem the owner asked to remove.
- **Widen `fact_value` to nested JSON.** Rejected: it weakens validation for every other
  consumer, as ADR-036 found.
- **Import resume content straight into the Profile.** Rejected: values the candidate never
  looked at would join the profile, which breaks the no-silent-acceptance rule.
- **Collect restricted answers in the general Profile.** Rejected: it would bypass the ADR-010
  mandatory review.
