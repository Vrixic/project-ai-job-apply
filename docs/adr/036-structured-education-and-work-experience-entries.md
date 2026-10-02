# ADR-036: Structured Education and Work Experience Entries

Status: Proposed
Date: 2026-10-02

## Context

The candidate Profile page is being redesigned toward a clearer, resume-like summary (Personal,
Education, Work Experience, Skills), following a competitor review requested by the product owner.
Personal contact fields (location, phone, LinkedIn/GitHub URLs) and Skills fit the existing
`profile.profile_facts` / `profile.profile_fact_versions` model cleanly, because each is a single
scalar or a single string-array value (`ProfileFactValue` is `string | number | boolean |
string[]`; see `packages/api-contracts/openapi/platform.v1.json#/components/schemas/
ProfileFactValue` and the `profile.is_valid_profile_fact_value` CHECK function in
`backend/services/profile/migrations/0004_profile_fact_versions.sql`). Those two sections were
implemented directly against the existing `/api/platform/profile-facts` contract with no backend
change.

Education and Work Experience do not fit that model. A resume-style Work Experience entry needs
several fields that belong together as one unit: company, title, location, start date, end date
(or "present"), and an ordered list of achievement bullets. Education needs school, degree, field
of study, and a date range. `ProfileFact` has no concept of a multi-field record or a stable
grouping identifier across facts; `fact_value` is a single JSONB scalar or flat string array,
constrained by `profile.is_valid_profile_fact_value` to exactly those shapes. Approximating a
multi-field entry as several separate facts (e.g., one fact for "company", one for "title", one
for "bullets") would require an ad hoc grouping convention (matching `effective_from`/
`effective_to` across facts, since there is no entry/group id), would need multiple sequential
API calls per edit with no atomicity across them, and would not let the UI reliably render an
ordered list of distinct jobs. It would also blur the fact ledger's existing purpose: `kind IN
('employment', 'education', ...)` facts are part of the resume-extraction review pipeline
(`verification IN ('proposed', 'confirmed', 'rejected')`), where a single scalar "proposed" value
genuinely is the right shape (e.g., one extracted fact like "most recent title"). Widening
`fact_value` to accept arbitrary nested JSON objects would weaken a validated, narrow shape into an
unvalidated blob, which conflicts with ADR-006's contract-first, explicit-validation direction.

This ADR proposes a dedicated, structured store for ordered, multi-field Education and Work
Experience entries, separate from the generic fact ledger.

## Decision

Add two new candidate-owned, profile-service-owned entities, each a versioned, ordered list of
structured records:

- `ProfileEducationEntry`: `school` (string, required), `degree` (string, optional), `fieldOfStudy`
  (string, optional), `startDate` (date, optional), `endDate` (date, optional, null/absent means
  "present" only if `startDate` is set), `displayOrder` (integer).
- `ProfileWorkExperienceEntry`: `company` (string, required), `title` (string, required),
  `location` (string, optional), `startDate` (date, required), `endDate` (date, optional, absent
  means "present"), `bullets` (array of strings, 0-20 items, each 1-500 chars), `displayOrder`
  (integer).

Both entities:

- are owned by the profile service, under the existing `profile` PostgreSQL schema, following the
  append-only versioning pattern already used by `profile.profile_fact_versions` (immutable
  version rows, current version resolved by `MAX(version)` per entry id) so edits remain
  auditable and corrections do not destroy history, consistent with ADR-003's PII-handling
  direction;
- use `sensitivity = 'standard'` (directly re-displayable; this is not restricted-answer data);
- belong to exactly one `user_id`, enforced the same way as `profile.profile_facts`;
- expose full CRUD (create, update-with-`expectedVersion`, delete, reorder) through new REST
  routes additive to `packages/api-contracts/openapi/platform.v1.json`:
  `GET/POST /profile/education-entries`, `PATCH/DELETE /profile/education-entries/{id}`, and the
  equivalent `/profile/work-experience-entries` routes, mirroring the existing
  `/profile/profile-facts` route shapes (idempotency-key header required on writes, optimistic
  concurrency via `expectedVersion`, matching ADR-004).
- are additive, backward-compatible API surface: no existing route, schema, or generated type
  changes, so this can ship as a minor contract version bump with no consumer migration.

The existing `profile_facts` ledger is unchanged. If a resume-extraction pipeline later proposes
structured employment/education facts, that is a separate, later decision; this ADR only covers
direct candidate-entered Education and Work Experience shown on the Profile page.

## Consequences

- New SQL migration(s) in `backend/services/profile/migrations/` adding
  `profile.education_entries`, `profile.education_entry_versions`,
  `profile.work_experience_entries`, and `profile.work_experience_entry_versions`, each following
  the immutable-version-row and reject-update-trigger pattern from
  `0004_profile_fact_versions.sql`.
- New OpenAPI schemas, generated types (`pnpm contracts:generate`), request validators, and
  gateway/profile-service route handlers, implemented end-to-end per
  `skills/build-vertical-slice/SKILL.md` (client through persistence, outbox/audit events,
  idempotency, tests).
- New candidate-data-export and candidate-rights (deletion) coverage, since these are new
  candidate-owned PII tables (ADR-003, ADR-027).
- Frontend gets two new dedicated editors (ordered list, add/edit/delete/reorder entry, bullet
  list editor for Work Experience) replacing the deferred placeholder gap on the redesigned
  Profile page.
- Until this ships, the Profile page intentionally does not show Education or Work Experience
  sections; the current `ProfileFactsForm` ledger remains available as the only way to record
  `employment`/`education`-kind facts (e.g., from resume extraction or free-form notes).

## Alternatives

- **Store one JSON blob per entry in `profile_facts.fact_value`.** Rejected: `fact_value` is
  constrained by `profile.is_valid_profile_fact_value` to scalars and flat string arrays;
  accepting arbitrary nested objects there would weaken that validation for every other consumer
  of the generic fact ledger, including the resume-extraction review pipeline that currently
  relies on a flat `kind`/`key`/`value` shape with per-fact `verification` state.
- **Group several flat facts by matching `effective_from`/`effective_to`.** Rejected: no stable
  entry id, fragile for concurrent/overlapping jobs (e.g., two part-time roles with the same
  dates), and needs multiple non-atomic API calls per edit of one logical entry.
- **Do nothing; keep Education/Work Experience inside the generic facts ledger as-is.** Rejected
  as the long-term shape because it cannot render an ordered, multi-field resume section the way
  Personal and Skills now do, but this is the accepted interim state until this ADR is
  implemented.
