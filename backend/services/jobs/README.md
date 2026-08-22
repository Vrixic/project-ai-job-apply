# Jobs Service

Owns companies, canonical jobs, source observations, provenance, deduplication state, freshness, expiry, and job reports.

## Implemented foundation

- `src/domain/` — Pure canonicalization, exact-identity precedence, duplicate classification,
  lifecycle, freshness, and tombstone rules.
- `src/persistence/` — The job-owned PostgreSQL schema and transactional catalog repository.
- `migrations/` — Forward-only, checksum-verified jobs-schema migrations.
- `src/persistence/ingestion-orchestration.ts` — Jobs-owned durable checkpoint, append-only run
  event, and identifier-only dispatch persistence with revision fencing and bounded recovery.

The persistence runtime accepts only `authorized_fixture` provenance by default. Production source
adapters and explicit public contributions remain disabled until their separate legal and security
gates pass.

Migration `0005_ingestion_orchestration` adds three Jobs-owned relations. Schedule occurrences are
immutable, checkpoint transitions advance exactly one revision under a database lock, every
revision is copied into an append-only aggregate-only event ledger, and transport dispatches have
one deterministic durable name per generation. Every dispatch also freezes the numeric durable and
activity Lambda versions plus the generated-synthetic adapter/config manifest SHA-256 used by that
generation. These tables retain operational truth; they do not store raw source responses, job
values, URLs, candidate data, or arbitrary errors. An accepted
durable execution is bound to the official qualified-function-ARN `/durable-execution/name/id`
shape, including its opaque service-issued execution ID. A paused occurrence can create one new
version-pinned generation only after the synthetic source is explicitly enabled again.
An ambiguous nudge is retried with the same dispatch and durable name; bounded transport exhaustion
is retained instead of inventing another generation.

The active-job read model returns only active, unexpired canonical records and redacted source
summaries. It excludes raw snapshots, exact source identity keys, content hashes, pending or
suspect records, and terminal tombstones.

Migration `0007_matchable_job_attributes` adds nullable, exact-enum work-mode and employment-type
columns to the canonical job. The matchable-job read port resolves reversible exact aliases inside
one repeatable-read snapshot and returns only canonical identity, catalog revision, title,
locations, those two optional attributes, and the earlier of expiry or source-valid-through. It
independently requires an active, nonexpired, nonempty-description record. Missing and explicit
`unknown` attributes remain unknown; Jobs does not infer candidate fit or read preferences.

Migration `0008_job_reporting_and_moderation` adds an owner-isolated, enum-only candidate report
ledger plus Jobs-owned moderation cases and append-only decision events. Reports bind a requested
job to its active canonical identity, use semantic idempotency, contain no free text, and never
change job or source lifecycle automatically. The internal moderation port can explicitly block a
job or persist an exact source-identity pause after an operator decision; a pause is a narrowing
control and this slice provides no source-resume operation. Aggregate review exposes fixed reason
counts only, never reporter identities. The source-only durable ingestion runtime now consumes the
exact persisted pause as a fail-closed execution gate before schedule/resume, attempt execution,
polling, and each subsequent catalog write. Terminal reconciliation stays active, and one already
issued idempotent catalog write may finish before the next gate check. The candidate report API and
the dedicated `jobs:moderate` administration port are locally verified source. The privileged API
provides signed keyset pagination, fixed-code aggregate report counts, explicit case opening, and
version-fenced resolution while excluding operator identities from transport responses. Reports
still do not trigger automation, and there is no source-resume operation, approved
retention/deletion policy, real-report processing, migration apply, or deployment claim.

The D1 search read model uses PostgreSQL full-text search and stable keyset pagination over that
same active catalog. It supports only honestly persisted title, company, location, and verification
freshness filters, plus relevance or freshness ordering. Exact duplicate aliases resolve to one
canonical result. Search cursors are bounded, opaque, request-bound continuation tokens; they do
not contain the candidate's query or filter values. Search returns summaries without descriptions
or source metadata, and no matching or personalization is inferred at this boundary.

`src/run-search-acceptance.ts` is an internal generated-synthetic-only task entrypoint, not an API
or a general SQL runner. It requires one explicit run ID and exact `prepare`, `mutate`, or `cleanup`
action. The owned transaction creates two query fixtures plus one nonmatching revision sentinel,
mutates only that sentinel through the real search-revision trigger, and removes only the exact
claimed synthetic rows after verifying their complete shape and relationships. Its bounded JSON
result contains no candidate or source values. Deployment requires a separately reviewed operator
and an immutable migration-image receipt; the default migration task command remains unchanged.

Probable-duplicate review is an internal catalog boundary. A reviewed exact match creates a
reversible canonical alias without moving or deleting either record's source provenance. Canonical
reads aggregate those sources, every decision or reopen action is append-only audited using opaque
operator identifiers and reason codes, and ambiguous alias graphs fail closed. D1-007 owns any
future authenticated admin API or user-facing reporting surface for this capability.

`src/public-detail.ts` is the Jobs-owned public-detail projection kernel. It accepts only exact
lowercase UUIDv7 job identifiers and emits a fresh immutable allowlist containing only canonical
job identity, public display text, and freshness/expiry timestamps. Migration
`0006_public_job_reader` adds the empty-table `jobs_public` schema, enforces active/current lifecycle
eligibility inside the exact security-definer projection, and grants the dedicated login no Jobs
table or other application-schema access. Unknown, terminal, expired, or otherwise unavailable
targets collapse to one absence result; reversible alias identity remains explicit. Reader failures
and malformed records remain availability errors rather than being converted into deindexing
absence.

The Jobs-owned function does not expose source/provider/provenance metadata, source URLs, company
identifiers or verified domains, hashes, raw content, candidate data, or lifecycle reasons. The
anonymous transport, canonical page, cache/throttle, and crawler policy are separately owned by the
gateway, web, and Terraform source in the same source-only D1-009A packet. No artifact publication,
AWS/database apply, crawlability, real-source acceptance, or deployment is claimed.

## Planned additions

- `src/api/` — Contribution commands and any later accountable moderation administration API.
- Provider adapters will live behind the integrations boundary, not inside source-truth rules.

This service determines source truth. Per-user constraint assessment and any future ranking belong
to Matching.
