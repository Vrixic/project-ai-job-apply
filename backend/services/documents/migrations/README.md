# Documents Migrations

Migrations are applied transactionally by the documents-owned runner after profile and jobs.
They store only metadata and object references; source bytes and normalized text stay in the
candidate-document bucket.

`0002_resume_processing` adds immutable source-version dispositions, value-free delivery receipts,
legal status transitions, normalized-object references, parser metadata, and security holds.
At-least-once events deduplicate by both event ID and `(document_id, source_object_version)`.
