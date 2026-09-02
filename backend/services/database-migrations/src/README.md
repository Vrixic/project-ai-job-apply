# Migration Runner Source

- `index.ts` — Ordered migration manifest and fail-fast orchestration.
- `main.ts` — Container entry point.
- `index.test.ts` — Ordering and failure-boundary tests.
- `restore-verifier.ts` — Strict manifest parser and aggregate-only read-only verifier.
- `restore-verifier-runtime.ts` — Fail-closed database URL/TLS boundary and bounded PostgreSQL
  client configuration.
- `restore-verifier-cli.ts` — Sanitized one-event restore-verifier entry point.

The runner emits only owner names and the sanitized output produced by each checksum-verifying
migration. It never prints the database URL or candidate values.

The verifier's digest covers the canonical manifest, exact migration-ledger evidence, and
per-relation row counts. It deliberately excludes row values and does not claim content-level
integrity or corruption detection.

The Phase 2 manifest composes Profile consent, Jobs contribution intake, Matching private capture,
and Trust foundation migrations. Trust candidate export/delete behavior is intentionally not
composed here because the owning service has not implemented those functions.
