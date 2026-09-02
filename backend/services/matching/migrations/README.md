# Matching Migrations

`0002_candidate_rights` adds a portable saved-job/audit export and preserves append-only audit
behavior except inside a privacy-ledger-authorized whole-account deletion transaction.

Forward-only, checksum-verified migrations for Matching-owned private candidate associations.
No migration reads or modifies Jobs-owned or Profile-owned tables.

- `0001_saved_jobs.sql` — Owner-scoped saved-job associations, bounded public job snapshots,
  per-owner cursor revision state, idempotent create receipts, and append-only audit events.
- `0003_private_saved_page_captures.sql` — Owner-scoped, immutable structured captures from the
  exact Phase 2 provider-page allowlist; value-bound replay receipts; an explicit independently
  verified canonical-job resolution link; identifier-only audit; and candidate export/deletion.
