# Documents Migrations

Migrations are applied transactionally by the documents-owned runner after profile and jobs.
They store only metadata and object references; source bytes and normalized text stay in the
candidate-document bucket.

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
