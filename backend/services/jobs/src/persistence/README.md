# Job Catalog Persistence

Owns the `jobs` PostgreSQL schema, catalog repository, migration boundary, and database-backed
verification. It keeps canonical jobs separate from source observations and only performs automatic
merges when a deterministic exact identity matches.

## Files

- `schema.ts` — Drizzle table types for the job-owned PostgreSQL schema.
- `catalog.ts` — Transactional repository, provenance gate, exact merge, and lifecycle maintenance.
- `catalog.integration.test.ts` — Migration replay, deduplication, isolation, and tombstone evidence.

The repository defaults to `authorized_fixture` provenance. Enabling a real API or public UGC
provenance requires the applicable legal/security approval and an explicit runtime configuration.
