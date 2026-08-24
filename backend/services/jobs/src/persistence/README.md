# Job Catalog Persistence

Owns the `jobs` PostgreSQL schema, catalog repository, migration boundary, and database-backed
verification. It keeps canonical jobs separate from source observations and only performs automatic
merges when a deterministic exact identity matches.

## Files

- `schema.ts` — Drizzle table types for the job-owned PostgreSQL schema.
- `catalog.ts` — Transactional repository, provenance gate, reversible duplicate resolution,
  canonical source aggregation, and lifecycle maintenance.
- `catalog.integration.test.ts` — Migration replay, deduplication, reversible resolution,
  topology, isolation, and tombstone evidence.

The repository defaults to `authorized_fixture` provenance. Enabling a bounded public ATS API
requires ADR-025's exact product/source activation record and explicit runtime configuration;
public UGC remains governed separately by D2.
Duplicate resolution is not a public API. D1-007 must add its authenticated authorization and audit
surface without bypassing this repository boundary.
