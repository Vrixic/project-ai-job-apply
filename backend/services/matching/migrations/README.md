# Matching Migrations

Forward-only, checksum-verified migrations for Matching-owned private candidate associations.
No migration reads or modifies Jobs-owned or Profile-owned tables.

- `0001_saved_jobs.sql` — Owner-scoped saved-job associations, bounded public job snapshots,
  per-owner cursor revision state, idempotent create receipts, and append-only audit events.
