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
scope. Owner status projects the latest append-only processing state, with the immutable intake
`queued` state as its fallback; it exposes no internal reason, evidence, or processing identity.
These tables have no mutation path or foreign key
into provider source or canonical job truth, retain no DOM/HTML/raw page snapshot, and cannot
activate, refresh, extend, or overwrite catalog provenance.

The contribution service and extension share one pure canonicalization helper from API contracts.
The Jobs-owned `PostgresContributionReviewEvidenceReader` supplies bounded, full plaintext provider
evidence to an authorized Trust case through the exact contribution/owner binding. It excludes
candidate/reviewer identity, raw HTML, snapshots, and internal provenance fields. The reader does
not publish jobs or grant decision authority; its verification digest is immutable review evidence.

Before persistence, the gateway adapter verifies the exact owner, policy, preview digest, current
nonexpired Profile grant, and exact server-issued grant timestamp. Missing Profile wiring remains
fail closed.

`src/contribution-capability-policy-source.ts` is the single concrete signed-policy source for
intake, processing, and the public extension policy projection. It requires an exact signed
envelope plus an explicit pinned Ed25519 public-key map, validates freshness and bounded shape,
and rejects unknown keys, revision reuse, same-time forks, and process-local rollback. There is no
embedded signing key, live policy, or activation default. Local composition enables both intake
and the public route only when `JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON` and
`JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON` are both present and valid; partial or malformed
configuration fails closed.

`src/contribution-capability-source.ts` also exposes explicit persistent development authority:
`D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED=true` requires `D2_DEPLOYMENT_ENVIRONMENT=development`.
It needs no signing key, envelope, or manual policy renewal. Absence of
`D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` preserves Greenhouse-only behavior; an explicit
JSON array can independently select `greenhouse`, `lever`, and `ashby`, and `[]` denies all.
Each fixed descriptor binds extension `0.2.0`, its exact variant, and its exact HTTPS hosts.
Malformed selection or any selection outside explicit development is rejected. Intake and
processing still honor their separate runtime-disable flags and current provider selection.
`D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON` can additionally restrict the five existing exact hosts;
absence preserves descriptor behavior, `[]` denies all, and malformed/off-environment settings fail
closed. Global Lever and EU Lever are independently selectable. Current domain authority is read
at intake and at processing's initial and pre-publication checks, including before a prepared
operation lease can renew. Domain selection does not alter descriptor versions/digests or require
a migration. An already authorized in-flight operation retains the existing bounded lease, so
deployment changes still use the normal quiesce/drain procedure; this is not instantaneous
revocation across old runtime versions.
This source support does not enable detectors, supply verification registrations, or activate
Lever/Ashby in the deployed environment; their representative page/API acceptance remains open.
Production/default composition retains signed-policy expiry checks. The legacy public policy API
is not an unsigned-development projection and stays disabled when no signed policy is configured.

Migration `0021_development_contribution_operation_lease` permits automatic renewal of a short
60-second operation lease only on a still-prepared development publication after current consent,
unchanged independent evidence, accepted Trust, and development authority checks. A transaction-local
marker, exact development configuration digest, and database trigger fence the update. Identity,
evidence, original creation time, signed-policy rows, and terminal rows remain immutable; old lease
commands cannot publish after renewal. This lease is not a manually renewed deployment deadline.

Forward migration `0022_development_contribution_provider_leases` preserves the original Greenhouse
descriptor and adds only the fixed Lever/Ashby version/digest pairs. Preparation and renewal also
bind the persisted provider, variant, client, and source host; mismatched descriptors cannot renew
across providers. The same 60-second duration, marker, chronology, immutable identity/evidence, and
terminal-state guards apply. Deploy `0022` before enabling a new provider. The historical
2026-09-08 `42b9686` release verified 42 migrations and 68 relations across six owners and ten
schemas at state 290, with Gateway/scheduled/Trust versions 55/17/13. That checkpoint is superseded
by the coordinated 44-migration release below; it did not activate Lever/Ashby.

`0023_contribution_verification_refresh` adds append-only independent proof generations and an
explicit accepted provider-proof binding. The existing scheduler can reclaim stale unpublished
initial reviews with a one-hour cooldown and at most three lifetime refresh fetches; it rechecks
authoritative initial-review state before fetching and before appending. Submitted fields and old
proofs never change. New acceptance and publication reject future or older-than-24-hour evidence.
An accepted terminal case whose proof expires before publication remains held; it is not silently
redecided or rebound. These finite source-freshness controls do not renew development authorization.
Independent provider proof is distinct from a reviewer's appeal evidence. Trust `0004` records
that separate immutable acceptance basis, and only the exact accepted basis can publish.

The September 10 coordinated development checkpoint used source
`2dd3aa21d2991bc97caebc3e90e785654eb9fb1e`; the Phase 2 register owns subsequent release updates.
Migration revision 51 ran exactly once on 2026-09-10 with exit `0` and seven exact aggregate success
messages, verifying 44 migrations and the same 68 relations across six owners and ten schemas.
Contribution processing and reviewer decisions stayed quiesced until the compatible Gateway,
workers and Jobs `0023`/Trust `0004` migrations were verified. Resume Apply advanced state 295
to 296 at `00:50:58Z`; maintained Verify and the `01:09:09Z` readback confirm resumed
Gateway/scheduled/Trust versions 58/20/16, reservations 2/1/2, no active ECS compute, and a
non-applyable plan with zero resource or output changes. Greenhouse-only development is unchanged;
Lever/Ashby and production/store remain dark.

Fresh reviewer inspection at `01:13:53Z` reads three initial cases with fresh provider proof, but
one delegated initial decision POST returned `503`. The independent `01:16:14Z` readback confirms
all three remain `needs_review`, version `1`; no successful decision or publication is claimed.
Separate dark-ingestion and rights/export artifact releases and current-schema cloud recovery
remain open; the historical cloud PITR covers 39 migrations, not 44. The prior singleton
verification writer cannot run on `0023`; rollback must keep contributions disabled or use
a compatible binary. See the [Phase 2 register](../../../docs/product/delivery/phase-2-extension-and-community.md)
for the exact release and remaining acceptance.

Exact catalog observations are monotonic: later arrival does not mean newer source truth. Older
observations cannot regress canonical/source fields or undo newer withdrawal/expiry. Exact tied
replays are no-ops; contradictory tied truth parks for review. Source-specific chronology remains
independent when several sources resolve to the same canonical job.

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

The later `0017`–`0019` migrations add the durable normalizer, processing queue, staged independent
provider observation, Trust-decision copy, accepted publication/removal reconciliation, separate
identifier-only delivery ledgers, and owner-safe processing state. Final publication records the
independently fetched provider observation through the ordinary catalog transaction only after
current consent, explicit capability authority, independent verification, and accepted Trust gates pass.
Probable duplicates roll back without creating catalog truth and park for explicit review. The
runtime remains synthetic/default-dark until exact provider registrations, policy, schedule,
transport, deployment, and accountable activation gates are supplied; a queued acknowledgement
still makes no publication claim.

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

Authenticated detail normalizes all canonical and source timestamps at the persistence boundary,
including optional validity dates. The shared Drizzle client can return PostgreSQL timestamp
strings; standalone clients can return `Date` values. Both produce the same strict transport
contract, and malformed timestamps remain availability failures rather than false absence.
Regression coverage includes the actual Drizzle/Postgres composition and direct/alias Gateway
HTTP reads. The Phase 2 register records deployment separately.

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

`src/run-synthetic-catalog-retirement.ts` is a separate development-only internal command for
retiring exact source-neutral generator fixtures. Inspect returns aggregate counts and a row-bound
manifest digest. Retire locks and revalidates that exact state, rejects mixed-source, alias and D2
publication bindings, sets only eligible generated jobs to blocked with a fixed retirement reason,
and appends status events through the normal catalog revision transaction. Posting/source payloads,
saved associations and history remain intact; other fixture namespaces are counted but not targeted.
Keep synthetic ingestion disabled. There is no general SQL input, API, schema migration or built-in
undo. The [Phase 2 register](../../../docs/product/delivery/phase-2-extension-and-community.md#d2-055--catalog-details-and-synthetic-fixture-retirement)
records exact deployment and execution, separately from local tests.

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
