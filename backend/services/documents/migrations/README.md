# Documents Migrations

Migrations are applied transactionally by the documents-owned runner after profile and jobs.
They store only metadata and object references; source bytes and normalized text stay in the
candidate-document bucket.

`0006_cover_letters` adds immutable cover-letter metadata and an exact key reserved before
encrypted object writes. It adds value-free reservation/readiness audit actions, portable
metadata export and candidate inventory/deletion coverage, including abandoned pending writes.
No generated text, model prompt or raw provider response is stored in SQL. Deploy compatible
strict export consumers before migrating; workflow/Gateway composition and restore-manifest
synchronization are still in progress. Rollback code must not remove inventory coverage for
already-reserved keys.

`0002_resume_processing` adds immutable source-version dispositions, value-free delivery receipts,
legal status transitions, normalized-object references, parser metadata, and security holds.
At-least-once events deduplicate by both event ID and `(document_id, source_object_version)`.

`0003_candidate_rights` adds owner-scoped portable metadata export, exact version-aware object
inventory, and an authorized database-deletion function. Database deletion refuses to run until the
caller attests that every version and delete marker under the returned object keys is absent.

`0004_resume_deletion` adds the candidate-initiated deletion tombstone (`deleted_at`): only a finished resume
(`parsed`, `failed`, `rejected`) can carry it, it can never be cleared, and the row, object keys, and object versions
are kept so the exact inventory above still names every stored object until a separate purge removes the bytes
(ADR-033). It also adds the `resume.deleted` audit action.

`0005_resume_purge` adds the two owner-defined functions the candidate-rights maintenance sweep uses to finish a deletion
(ADR-034): `pending_resume_purges` names the tombstones that are ready (a security-held one only after 30 days), and
`complete_resume_purge` removes a tombstone's row, its idempotency entries (which store the file name), receipts, and
dispositions once the caller attests that every stored object is gone, and records one value-free `resume.purged` audit
event. It also adds that audit action.


`0009_cover_letter_provider_failure` adds nullable, value-free original-provider failure metadata.
Only the original running-to-settled provider transition can write it; an additional trigger keeps
all existing identity/transition protections unchanged. No backfill is performed: old settlements,
including successful ones, remain NULL and cannot authorize failed-response cleanup. Generic
maintenance fences, quarantine, expiry and unacknowledged calls are not failure proof.

Roll out this migration before the updated private work-control/disposal functions and before
any separately reviewed maintenance activation. An older writer remains compatible with NULL;
an older disposal composition refuses the additive `read_failed` action. Rolling back code must
retain the column, trigger, original response inventory and strict positive-disposal purge guards.
Candidate deletion still cascades this metadata only through the existing owning deletion path.
Restore/image inventories add exactly this ninth Documents migration (59 across seven owners);
prior exact-source boundaries remain historical evidence, not evidence for the new boundary.
This is source/local validation only, not a deployed migration or production retention policy.
