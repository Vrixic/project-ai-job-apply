# Profile Migrations

Reviewed forward PostgreSQL migrations for identity, profile, operations, outbox, idempotency, and
audit state. Migrations must preserve ownership and be tested against representative data.

Provider retirement migrations must fail before mutation when undispatched work remains.
Historical published routing values may be normalized only to a provider-neutral retired label;
operation, audit, idempotency, and user-owned data remain unchanged.

`0004_profile_fact_versions` adds candidate-owned fact identities and append-only versions.
Corrections create a new version under a row lock; a database trigger rejects in-place mutation,
while account deletion can still cascade through both tables under the deletion workflow.

`0005_resume_fact_proposals` adds idempotent resume-import receipts and immutable block/offset
evidence for each fact version. Resume-derived values enter as `proposed`; explicit review appends
a confirmed or rejected version. Editing during confirmation switches to user-correction
provenance instead of claiming the original span exactly supports the corrected value.
