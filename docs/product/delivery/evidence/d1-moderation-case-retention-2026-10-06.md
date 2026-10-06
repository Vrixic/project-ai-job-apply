# D1 moderation case retention — 2026-10-06

Status: local implementation; D1-012 remains In progress. Backend-only, no cloud activation.

## Behavior and rollout

Forward Jobs migration `0026_moderation_case_retention` implements the accepted D1P-06
365-day closed-case/decision-event deadline. Historical and new explicit block/pause resolutions
produce one minimal job or exact source/version/configuration control with a last-action time.
Case/operator detail expires only after linked reports expire and required controls exist.
Controls needed to prevent resurrection remain. No unblock or source resume authority is added.

Combined maintenance expires reports first, then cases/events, within one owning transaction.
The existing report flag remains required; a separate `JOB_MODERATION_RETENTION_ENABLED=true`
selects the combined path. Both flags default off. SQL maintenance denies PUBLIC execution,
uses database time, bounded batches and locked rows with SKIP LOCKED. Counts-only command output
does not expose operator identities or report payloads. No scheduler or maintenance grant exists.

Apply the migration, deploy aggregate-aware report readers and control-aware ingestion pause
readers, then separately approve cleanup. An older ingestion reader that queries only cases
would lose pause evidence after deletion. Rollback must disable cleanup and preserve the new
reader once cases have expired; deleted operator detail cannot be reconstructed.

## Local evidence

- All 117 Jobs integration tests pass on fresh PostgreSQL 16.6. Eight new cases exercise expired
  detail, preserved blocks/pauses, exact tuple isolation, recent/open cases, report-first ordering,
  actual transaction rollback, concurrent bounded cleanup and rejected forged controls/permissions.
  Log: `.tmp/d1-moderation-all-sql-fresh.log`.
- All 392 Jobs unit tests and 228 focused workflow/restore checks pass. The pause reader rejects
  malformed state instead of allowing ingestion. Logs: `.tmp/d1-moderation-units.log` and
  `.tmp/d1-moderation-contract-gate.log`.
- Actual historical Jobs 25 → 26 upgrade and migration replay pass. Three old cases and six events
  expire while one job block and one exact source pause remain. Log: `.tmp/d1-moderation-upgrade.log`.
- Two contract generation passes leave public contracts unchanged.

The first full Jobs SQL attempt reused data from focused tests and failed an existing global
catalog search assertion. The unchanged-source rerun passes all 117 cases on a fresh owned
tmpfs fixture. A focused assertion was corrected for the SQL driver's camel-case JSON keys.
Test-only report clock aging restores its immutable update guard within the same transaction
before cleanup is exercised; no production guard is relaxed.

- Local logical dump/restore passes the maintained seven-owner verifier: 68 migrations, 92
  relations and matching aggregate digest. Restored state retains zero expired cases/events and
  one block/one exact pause. Manifest SHA-256 is
  `290f0fb1c8e8990baa66ea170e2cce6e0e3ba69ef05ff48411ea1947d8166007`.
  Log: `.tmp/d1-moderation-restore.log`. This is not deployed PITR or deletion-ledger replay proof.

Clean-source full verification and final runtime cleanup are recorded below when complete.
Hosted maintenance release, privileged audit/alert expiry, remaining accountable
rights review and D1/D3 phase acceptance remain open. No real candidate or deployed cleanup
behavior is claimed. CI/CD remains deferred until production launch; the PC stays on.
