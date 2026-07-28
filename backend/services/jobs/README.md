# Jobs Service

Owns companies, canonical jobs, source observations, provenance, deduplication state, freshness, expiry, and job reports.

## Planned subfolders

- `domain/` — Canonical job and lifecycle rules.
- `normalization/` — Title, location, compensation, and description normalization.
- `deduplication/` — Exact and probable duplicate resolution.
- `freshness/` — Verification schedules, TTLs, and active-index decisions.
- `persistence/` — Job-owned repositories and migrations.
- `api/` — Search-independent job reads and contribution/report commands.
- `tests/` — Lifecycle, canonicalization, and expiry tests.

This service determines source truth. Per-user ranking belongs to matching.
