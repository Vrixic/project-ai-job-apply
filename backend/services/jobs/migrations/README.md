# Jobs Migrations

Contains forward-only, checksum-verified SQL migrations for the job catalog's `jobs` schema. The
jobs service applies these independently under its own advisory lock and migration ledger; no
other service may modify these tables.

- `0001_job_catalog.sql` — Companies, canonical jobs, source provenance, duplicate-review state,
  lifecycle events, exact identity constraints, and freshness indexes.
