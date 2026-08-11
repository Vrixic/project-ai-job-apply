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

## Planned additions

- `src/api/` — Search-independent job reads and contribution/report commands.
- Provider adapters will live behind the integrations boundary, not inside source-truth rules.

This service determines source truth. Per-user ranking belongs to matching.
