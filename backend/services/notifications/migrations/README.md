# Notifications migrations

`0001_inbox_and_preferences.sql` creates the Notifications-owned in-app action inbox projection,
the per-application source cursor and event receipts that make consumption idempotent and
order-safe, and the candidate's delivery preferences with quiet hours (ADR-024, ADR-055).

The inbox stores a classification and an opaque application reference, never candidate content.
External delivery (email and push) is off by default. Apply migrations only through the
checksum-verifying runner. `0002_candidate_rights.sql` adds the candidate export and the deletion function, which removes every Notifications row for the candidate only inside a privacy-ledger-authorized account deletion. The aggregate rights policy, restore manifest and runner registration are separate steps; the schema must not be deployed or enabled before they land.
