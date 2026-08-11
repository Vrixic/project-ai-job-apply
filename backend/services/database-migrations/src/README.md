# Migration Runner Source

- `index.ts` — Ordered migration manifest and fail-fast orchestration.
- `main.ts` — Container entry point.
- `index.test.ts` — Ordering and failure-boundary tests.

The runner emits only owner names and the sanitized output produced by each checksum-verifying
migration. It never prints the database URL or candidate values.
