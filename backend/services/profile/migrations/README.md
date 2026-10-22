# Profile Migrations

Reviewed forward PostgreSQL migrations for identity, profile, operations, outbox, idempotency, and
audit state. Migrations must preserve ownership and be tested against representative data.

`0011_active_candidate_lease` adds the Identity-owned `require_active_candidate(uuid)` function.
It takes a shared row lock and refuses absent/quarantined candidates. Documents invokes it
inside a bounded object-write transaction so account quarantine cannot race the write, without
cross-owner table access. Public execution is revoked; runtime grants remain a separately
reviewed deployment prerequisite. This adds no external API or new account state.

`0012_profile_sections` adds the structured candidate Profile (ADR-052): `personal_versions`, `entries`,
`entry_versions` and `import_drafts`. Records are standard sensitivity, owner scoped with cascade on
account deletion, and append-only: update triggers are rejected, and an insert trigger refuses unknown
keys, missing required keys, reversed date ranges and invalid bullets per section. Deleting an entry
removes it and all its versions. Releasing it needs the migration image inventory and the Lambda
release guards (`publish-development-migration-image.ps1`, `development-d2-runtime-release.ps1`)
updated to include it; they still list the earlier set and fail closed.

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

`0006_candidate_rights` adds fail-closed candidate export and two-step account-deletion state,
enforces login quarantine on the identity owner, and retains only a restricted privacy ledger after
active identity removal. Runtime policy values remain required configuration with no migration
defaults. The ledger contains digests, policy identity, owner/subprocessor completion state, and an
encrypted replay locator; it must never contain contact data, raw candidate content, or tokens.

`0007_candidate_rights_export_null_omission` keeps the version-one portable export strict by
omitting an unavailable optional candidate email instead of serializing JSON null. It does not
change the export schema or disclose a provider identity.

`0008_ugc_contribution_consents` adds Profile-owned immutable extension contribution grants and
append-only revoke/supersede transitions. Exact owner, purpose, client, document/policy version,
preview digest, timestamps, expiry, and current lineage are enforced before Jobs may rely on a
grant. Idempotency receipts and value-free audit events remain in the existing Platform tables.

`0009_ugc_contribution_consent_candidate_rights` adds the owner's allowlisted consent history to
the version-one candidate export without exposing the preview digest, internal record lineage, or
idempotency receipts. It lets only the already-authorized candidate-deletion transaction remove
consent history and its internal command receipts; ordinary updates and deletes remain blocked.
