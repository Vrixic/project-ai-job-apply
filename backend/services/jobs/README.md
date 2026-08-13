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

The D1 search read model uses PostgreSQL full-text search and stable keyset pagination over that
same active catalog. It supports only honestly persisted title, company, location, and verification
freshness filters, plus relevance or freshness ordering. Exact duplicate aliases resolve to one
canonical result. Search cursors are bounded, opaque, request-bound continuation tokens; they do
not contain the candidate's query or filter values. Search returns summaries without descriptions
or source metadata, and no matching or personalization is inferred at this boundary.

Probable-duplicate review is an internal catalog boundary. A reviewed exact match creates a
reversible canonical alias without moving or deleting either record's source provenance. Canonical
reads aggregate those sources, every decision or reopen action is append-only audited using opaque
operator identifiers and reason codes, and ambiguous alias graphs fail closed. D1-007 owns any
future authenticated admin API or user-facing reporting surface for this capability.

## Planned additions

- `src/api/` — Contribution and report commands.
- Provider adapters will live behind the integrations boundary, not inside source-truth rules.

This service determines source truth. Per-user ranking belongs to matching.
