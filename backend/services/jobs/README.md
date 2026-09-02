# Jobs Service

Owns companies, canonical jobs, source observations, provenance, deduplication state, freshness, expiry, and job reports.

## Implemented foundation

- `src/domain/` — Pure canonicalization, exact-identity precedence, duplicate classification,
  lifecycle, freshness, and tombstone rules.
- `src/persistence/` — The job-owned PostgreSQL schema and transactional catalog repository.
- `migrations/` — Forward-only, checksum-verified jobs-schema migrations.
- `src/persistence/ingestion-orchestration.ts` — Jobs-owned durable checkpoint, append-only run
  event, and identifier-only dispatch persistence with revision fencing and bounded recovery.

The catalog persistence runtime accepts only `authorized_fixture` provenance by default. The
source-neutral ingestion runtime may explicitly allow the three bounded `permitted_api` adapters;
public contributions remain disabled until their separate D2 gates pass.

Migration `0014_job_contribution_intake` adds the first D2 queued-intake foundation. The strict
Jobs command accepts only user-previewed structured public fields, a client-generated UUIDv7,
source detector identity, content hash, and a Profile-owned consent reference. Jobs recomputes the
digest over the final preview payload before persisting it. Creation and the identifier-only
`job.contributed.v1` outbox record are atomic, semantic retries replay one acknowledgement, changed
payloads conflict, and status reads require the same owner plus the dedicated `jobs:contribute`
scope. The only implemented state is `queued`. These tables have no mutation path or foreign key
into provider source or canonical job truth, retain no DOM/HTML/raw page snapshot, and cannot
activate, refresh, extend, or overwrite catalog provenance.

The contribution service and extension share one pure canonicalization helper from API contracts.
Before persistence, the gateway adapter verifies the exact owner, policy, preview digest, current
nonexpired Profile grant, and exact server-issued grant timestamp. Missing Profile wiring remains
fail closed.

Migration `0015_source_revalidation_lifecycle` adds a source-scoped durable revalidation queue and
an append-only verification-evidence ledger for the D2 Greenhouse, Lever, and Ashby page variants.
Community observations and fixed-code candidate closed reports store only a SHA-256 signal
reference and can raise normal or high revalidation priority; they cannot update verification
clocks, expiry, source withdrawal, or catalog status. Queue claims use database-fenced ownership,
one-to-twenty-five item batches, explicit leases, at most five attempts, bounded retry timing, and
expired-lease recovery. Queue identity and legal state transitions are database-guarded, and
terminal records are immutable.

Only independently obtained provider evidence can advance a source verification clock or record
positive withdrawal. One source's closed evidence does not withdraw a canonical job while another
source remains open. A separate default-deny authority port is required for an administrative
block. Evidence is digest-only and append-only; lifecycle status events contain canonical job
identity plus fixed reasons, never source URLs, page bodies, candidate identifiers, or arbitrary
errors. Policy-clock expiry preserves a minimal catalog tombstone while erasing descriptions,
application payload fields, structured location payloads, and every source raw snapshot.
Provider/page-variant freshness windows, queue leases, attempts, retry delays, and administrative
policy versions have no production defaults and must be injected before this runtime can operate.

The durable normalizer, provider evidence collector, Profile consent recheck, Trust-owned UGC
decision, accepted UGC observation/source linkage, outbox dispatcher, contributor export/deletion,
and deployment/activation controls remain separate D2 work. Migration `0015` is persistence and
application-policy foundation, not a deployed provider verifier. Until those land, the intake is
synthetic/default-dark and a queued acknowledgement makes no publication claim.

Migration `0016_job_contribution_candidate_rights` adds owner-scoped export and deletion for queued
contribution intake. Export reconstructs only the approved source, posting, observation-time, and
consent-reference fields; it excludes the stored payload object, content/preview digests, owner ID,
idempotency identity, and request hash. Deletion requires the existing privacy-ledger authorization
and removes the owner's contribution outbox before its contribution rows in one transaction.
Source revalidation signals, independent verification evidence, canonical jobs, and provider
sources contain no contribution-owner foreign key and deliberately survive candidate deletion.

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

Migration `0009_provider_ingestion_sources` aligns Jobs-owned durable checkpoint persistence with
the existing bounded source-neutral identifier contract. It permits Greenhouse, Lever, and Ashby
source IDs without weakening adapter-version, transition, dispatch, aggregate-only, or pause
invariants; actual providers remain independently default-off.

Migration `0010_public_job_truth_fields` adds only optional provider-original publication time,
an exact application URL, and country-bearing structured locations to source and canonical truth.
The public projection exposes those allowlisted fields without source identity or provenance. The
web emits `JobPosting` JSON-LD only for complete non-remote provider truth; ambiguous timestamps,
remote eligibility, and missing addresses remain unclassified and unindexed.

Migration `0011_positive_source_withdrawal` adds source-level positive withdrawal state. Empty or
failed provider polls never infer removal; a canonical job is withdrawn only when every exact
source is positively withdrawn, and only that provider-owned withdrawal reason may be reversed by
a later positive observation.

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

Migration `0013_public_job_sitemap` adds a second fixed security-definer projection for bounded
keyset sitemap pages. It returns only canonical UUIDv7 identifiers and `last_verified_at` for
active, nonexpired, non-alias jobs that already satisfy the public-detail chronology and content
boundary. The same dedicated reader retains execute-only access to the two projection functions
and no Jobs table access. `src/public-sitemap.ts` validates exact row shape, chronology, ordering,
uniqueness, and the 101-row lookahead before returning a maximum 100-item page; database or shape
failures remain availability errors and never become a false-empty feed.

The Jobs-owned function does not expose source/provider/provenance metadata, source URLs, company
identifiers or verified domains, hashes, raw content, candidate data, or lifecycle reasons. The
anonymous no-VPC edge, private fixed-query Lambda, canonical page, cache/throttle, and crawler
policy are separately owned by the gateway, web, and Terraform source. The edge has no database
capability, its distinct artifact contains no database runtime, and it invokes only the qualified
private projection with a UUID-only request. No artifact publication, AWS/database apply,
crawlability, real-source acceptance, or deployment is claimed.

## Planned additions

- `src/api/` — Contribution commands and any later accountable moderation administration API.
- Provider adapters will live behind the integrations boundary, not inside source-truth rules.

This service determines source truth. Per-user constraint assessment and any future ranking belong
to Matching.
