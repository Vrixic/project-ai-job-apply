# Notifications migrations

`0001_inbox_and_preferences.sql` creates the Notifications-owned in-app action inbox projection,
the per-application source cursor and event receipts that make consumption idempotent and
order-safe, and the candidate's delivery preferences with quiet hours (ADR-024, ADR-055).

The inbox stores a classification and an opaque application reference, never candidate content.
External delivery (email and push) is off by default. Apply migrations only through the
checksum-verifying runner. Candidate export and deletion are added by the next migration.
