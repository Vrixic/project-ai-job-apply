# Jobs Service

Owns companies, canonical jobs, source observations, provenance, deduplication state, freshness, expiry, and job reports.

## Implemented foundation

- `src/domain/` — Pure canonicalization, exact-identity precedence, duplicate classification,
  lifecycle, freshness, and tombstone rules.
- `src/persistence/` — The job-owned PostgreSQL schema and transactional catalog repository.
- `migrations/` — Forward-only, checksum-verified jobs-schema migrations.

The persistence runtime accepts only `authorized_fixture` provenance by default. Production source
adapters and explicit public contributions remain disabled until their separate legal and security
gates pass.

The active-job read model returns only active, unexpired canonical records and redacted source
summaries. It excludes raw snapshots, exact source identity keys, content hashes, pending or
suspect records, and terminal tombstones.

## Planned additions

- `src/api/` — Search-independent job reads and contribution/report commands.
- Provider adapters will live behind the integrations boundary, not inside source-truth rules.

This service determines source truth. Per-user ranking belongs to matching.
