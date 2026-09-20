# Applications Service

Owns application packets, field proposals, review requirements, approvals, attempts, confirmation
evidence, audit history, and technical application history through confirmed submission
([ADR-024](../../../docs/adr/024-application-history-and-inbox-phase-ownership.md)). `applied` is
terminal, and no recruiter, interview, offer, or rejection result is stored or modeled.

## Current D3 slice (source and local verification only)

Implemented and locally verified against generated-synthetic data; **not deployed**. The OpenAPI contract and gateway
routes exist but fail closed (503) until a store is wired, and it is not part of candidate export/deletion yet.

- `src/state-machine.ts` - the eight-state lifecycle (`preparing`, `review_required`, `approved`,
  `submitting`, `takeover`, `reconciliation_required`, `applied`, `cancelled`), a closed set of
  technical history kinds, and a guard that refuses hiring-outcome vocabulary.
- `src/field-policy.ts` - review classification. Restricted answers are always shown; a
  `never_infer` answer is dropped unless the candidate supplied it (or it is a confirmed vault
  entry); attestations, signatures, and challenges are always direct candidate action; unsupported,
  unconfirmed, low-confidence, unknown, and generated values are never silently applied.
- `src/packet.ts` - packet assembly with a deterministic content hash (excludes ids, timestamps and
  approval state), approval that must acknowledge every reviewable field, and approval validity
  bound to the job revision, form hash, resume/cover-letter hashes, and a 24-hour age limit.
- `src/attempt.ts` - write-ahead dispatch, conservative result classification (every unclear
  post-dispatch result is `ambiguous`, never a plain failure), stale-attempt recovery, and
  reconciliation. An attempt that was dispatched is never dispatched again.
- `src/current-action.ts` - the single next candidate action, derived from source truth and never
  stored.
- `src/database.ts` - `createApplicationsDatabase`, the dedicated plain client the store requires. Never give the store the gateway's shared Profile/Drizzle client (camel-cased columns, string timestamps, identity JSON serializer): a create fails on it with `ERR_INVALID_ARG_TYPE`.
- `src/store.ts` - owner-scoped PostgreSQL store. Every command locks the application row, checks
  an idempotency receipt, checks the expected revision, and commits state, revision, append-only
  history, and a minimal identifier-only outbox row in one transaction.
- `migrations/0001_applications_foundation.sql` - the `applications` schema. The database enforces
  legal status transitions, terminal immutability, append-only packets/history/receipts, immutable
  approval evidence, one live approval per application, and a partial unique index that permits only
  one scope-holding attempt per (user, application, packet).
- `migrations/0002_candidate_rights.sql` - candidate-rights participation (D3-014). Every table stays
  append-only except for the privacy-authorized deletion of the exact candidate; adds
  `applications.export_candidate_data(uuid)` (candidate-readable technical state and packet answers,
  without owner identifiers, scope keys, consent references, or evidence fingerprints) and
  `applications.delete_candidate_data(uuid, uuid)` (children before parents). The aggregate export and
  deletion workflows call them only for a candidate-rights policy whose owner inventory includes
  `applications` (`d3-development-synthetic-v1`); see the phase record for the activation status.

- `src/lifecycle-acceptance.ts`, `src/run-lifecycle-acceptance.ts` - the generated-synthetic fixture for the deployed lifecycle acceptance. `prepare` creates two generated identities; `cleanup` deletes the owner's Applications data through the privacy-authorized function, then the identities, and proves every owned count is zero. It refuses a contaminated boundary and accepts no SQL or candidate values. Driven only by `scripts/operate-development-applications-acceptance.ps1`.

- `src/service.ts` - the owner-scoped `ApplicationsApi` used by the gateway: maps store views to the
  generated OpenAPI types, takes packet, live-binding, and job-gate ports, and emits best-effort
  metrics. Every method takes the authenticated owner; nothing accepts an owner from a caller.
- `src/packet-source.ts` - builds packet proposals from candidate-confirmed, usable facts only (one
  documented exact mapping today), leaves competing facts to the candidate, and lets candidate
  entries win.
- `src/metrics.ts` - privacy-safe measurement: allow-listed names and opaque dimension tokens, per-field
  correction, attempt outcome and latency, generation outcome, and rates by adapter/variant/model/prompt
  version.

Tests: 56 unit and 25 PostgreSQL integration tests, including lifecycle parity between the domain and the
database guard, cross-owner isolation, an 8-way concurrent submission race, no-value-leak checks, and crash
recovery.

## Verify

```powershell
pnpm --filter @ai-job-apply/applications-service typecheck
pnpm --filter @ai-job-apply/applications-service test
pnpm --filter @ai-job-apply/applications-service build
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/applications-service test:integration
```

## Not yet implemented

The durable stale-attempt recovery scheduler and outbox publisher, Documents/Jobs adapters that supply
artifact and job-revision hashes, vault-backed proposals and further fact-to-field mappings, Auth0 scopes and
API Gateway routes, runtime composition, candidate-rights export/deletion participation, migration-image and
restore-manifest composition (D3-014, D3-015), and any deployment. Live ATS effects
stay disabled until D3-012 approval; see the
[Phase 3 register](../../../docs/product/delivery/phase-3-application-preparation.md).

## Automatic fills from Profile facts

`FACT_FIELD_MAP` in `src/packet-source.ts` is the owner-approved convention (2026-09-19): 26 exact
`kind/key` rows from `identity`, `employment`, `education`, and `preference` facts to application fields. A field
is filled only from exactly one confirmed, currently usable fact whose value fits the field's type; competing
facts choose none, and the candidate's own entry wins. Restricted answers, narrative questions, and documents are
never mapped. Add a row only after the owner approves it and a test pins it.

## Finding a job's application

`search` takes an optional `jobId`. The result is this candidate's applications for that job, newest first. The web
workspace uses `limit: 1` to reopen the live application, treating a cancelled newest one as "none" because a
cancelled application may be restarted.
