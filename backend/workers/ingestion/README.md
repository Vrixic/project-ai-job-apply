# Ingestion Workers

Acquire permitted job feeds and explicit user contributions, sanitize content, normalize observations, request deduplication, verify freshness, and update search projections.

## Planned subfolders

- `sources/` — Public API, partner feed, and UGC source adapters.
- `extractors/` — Structured job extraction.
- `normalizers/` — Canonical field conversion.
- `verification/` — Open/closed and redirect checks.
- `indexing/` — Search projection updates.
- `schedules/` — Source-aware refresh and backoff policies.
- `tests/` — Source fixtures, malicious content, dedupe, and retry tests.

Workers preserve provenance and never treat a fetch failure as proof that a job is closed.
