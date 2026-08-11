# Job Catalog Domain

Owns deterministic normalization, canonical identity precedence, duplicate classification, and
job lifecycle transitions. These rules are pure and provider-independent so adapters, APIs, and
maintenance jobs use the same decisions.

## Files

- `canonical-job.ts` — Canonicalization, identity, deduplication, freshness, and tombstone rules.
- `canonical-job.test.ts` — Synthetic contract and edge-case verification.

Provider transport parsing does not belong here. An adapter must first produce an authorized,
truthful observation with provenance.
