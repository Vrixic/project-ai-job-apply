# Jobs Migrations

`0012_candidate_rights` preserves ordinary report immutability while permitting deletion only
inside a privacy-ledger-authorized account-deletion transaction. It also exposes a bounded,
candidate-readable report export without idempotency hashes or moderation data.

Contains forward-only, checksum-verified SQL migrations for the job catalog's owned `jobs` and
`jobs_public` schemas. The
jobs service applies these independently under its own advisory lock and migration ledger; no
other service may modify these tables.

- `0001_job_catalog.sql` — Companies, canonical jobs, source provenance, duplicate-review state,
  lifecycle events, exact identity constraints, and freshness indexes.
- `0002_duplicate_resolution.sql` — Reversible duplicate decisions, canonical aliases, guarded
  topology, and append-only resolution audit events.
- `0003_duplicate_resolution_audit_guard.sql` — Database-enforced immutability for duplicate
  resolution audit events.
- `0004_job_search.sql` — Weighted PostgreSQL full-text retrieval plus title, location, freshness,
  and stable active-page indexes. It adds no dedicated search service or candidate data.
- `0005_ingestion_orchestration.sql` — Source-neutral durable-ingestion checkpoints, append-only
  aggregate events, fenced dispatches, and exact database-enforced transition integrity.
- `0006_public_job_reader.sql` — The empty-table `jobs_public` projection schema, exact
  `read_public_job_detail(uuid)` security-definer function, and dedicated RDS-IAM-compatible login.
  Inside the application database its only direct application grants are `CONNECT`, projection
  schema usage, and execute on that function; it receives no Jobs table access,
  temporary-table privilege, `public` schema
  access, or access to other application schemas. Its application-database role default is
  read-only, and the Lambda repeats that session setting, but PostgreSQL cluster-global PUBLIC
  catalog-function and other-database privileges are not a deny boundary. The migration does not
  harden those cluster-wide defaults, so accountable review or a stronger cluster/proxy boundary
  remains required before the anonymous route can be enabled.
- `0007_matchable_job_attributes.sql` — Nullable, exact-enum work-mode and employment-type
  attributes on the canonical job. Missing or explicit `unknown` values remain non-excluding;
  the migration adds no compensation, authorization, seniority, qualification, or inferred data.
- `0008_job_reporting_and_moderation.sql` — Owner-isolated fixed-code job reports, strict internal
  moderation cases, append-only decision evidence, explicit job blocking, and exact source-pause
  state. Reports alone cannot mutate catalog lifecycle.
- `0009_provider_ingestion_sources.sql` — Expands the existing durable checkpoint source identifier
  from the generated-synthetic prefix to the source-neutral bounded identifier contract. It changes
  no job values, dispatch shape, transition semantics, retention, or candidate-data boundary.
- `0010_public_job_truth_fields.sql` — Adds optional provider-original publication time, exact
  application URL, and country-bearing structured locations to Jobs-owned source/canonical truth,
  then extends the least-privilege public projection without exposing provenance or source identity.
- `0011_positive_source_withdrawal.sql` — Records explicit provider withdrawal per exact source so
  a canonical job is removed only after every source is positively withdrawn; empty and failed
  polls remain non-evidence.
- `0013_public_job_sitemap.sql` — Adds the second execute-only `jobs_public` projection. It returns
  at most 101 active, unexpired canonical UUIDv7 identifiers and their public `last_verified_at`
  freshness in `(last_verified_at DESC, id ASC)` keyset order. The dedicated reader retains no
  direct Jobs table access; incomplete, future, or oversized internal cursors raise instead of
  producing a false-empty page.
- `0014_job_contribution_intake.sql` — Adds owner-scoped immutable queued contributions and one
  identifier-only outbox record per contribution. It stores structured previewed public fields and
  consent/digest references only—never raw DOM or HTML—and intentionally has no catalog/source
  foreign key or trigger, so queued UGC cannot affect provider provenance or active-job freshness.
- `0015_source_revalidation_lifecycle.sql` — Adds the source-scoped durable revalidation queue and
  append-only independent-verification evidence ledger. Community observations and candidate
  closed reports can only enqueue digest-only priority signals. Exact provider evidence or an
  separately authorized administrative decision is required for lifecycle mutation. Queue
  attempts, leases, retries, provider/page-variant freshness windows, and policy versions have no
  database or production timing defaults. Policy expiry erases raw snapshots and other nonminimal
  posting payloads while retaining the canonical tombstone and fixed-reason lifecycle event.
- `0016_job_contribution_candidate_rights.sql` — Adds an exact owner-scoped, allowlisted candidate
  export for contribution source/posting/consent history without payload blobs, hashes, or command
  identities. Privacy-ledger-authorized deletion removes the owner's contribution outbox rows and
  contributions in one transaction while ordinary mutation remains blocked and provider catalog,
  revalidation, and verification truth remain untouched.
- `0017_job_contribution_processing.sql` — Adds the durable contribution-processing queue,
  bounded normalized proposals, staged independent-verification and Trust-decision evidence,
  append-only owner-state events, and guarded publication/removal reconciliations. Queued intake
  alone still has no catalog mutation path.
- `0018_job_contribution_processing_delivery.sql` — Adds a separate identifier-only processing
  event delivery ledger with fenced claims, bounded retry/dead states, and immutable event
  identity. Transport nudges contain no candidate, posting, source, or decision payload.
- `0019_job_contribution_provider_publication.sql` — Stages the bounded independently fetched
  provider observation before catalog identity exists, then permits one guarded linkage to the
  exact provider-created or reused job/source during atomic final reconciliation. Nullable staged
  identities retain their catalog foreign keys; probable duplicates roll back and remain parked.
- `0024_contribution_appeal_restoration.sql` — Adds an append-only restoration reconciliation for
  one accepted appeal after an applied takedown. It preserves the original publication/removal and
  provider truth, wakes only exact unconsumed accepted appeal decisions, and backfills affected
  completed queue rows through the same guarded predicate.
- `0025_job_report_retention.sql` — Links candidate reports once to an exact same-job review
  interval and backfills historical intervals. A database-clock, execute-restricted bounded
  maintenance function removes expired reporter/request/idempotency data after the later of
  receipt + 90 days and case closure + 30 days, preserving only fixed-reason totals. Open cases
  retain their reports; authorized candidate deletion stays immediate and creates no aggregate.
  Requires migration-before-reader and reader-before-maintenance rollout; it does not schedule
  cleanup or implement case/control/audit/alert expiry.
- `0026_moderation_case_retention.sql` — Backfills minimal non-operator block/pause controls
  from resolved cases and updates them on subsequent explicit resolutions. Guarded bounded
  maintenance removes case details and decision events 365 days after closure, once linked
  reports expire and needed controls exist. Retains required controls to prevent resurrection;
  no job unblock/source resume authority is added. Deploy the control-aware source pause reader
  before separately enabling moderation cleanup. Privileged audit and alert expiry remain open.
- `0027_candidate_report_export_status.sql` — Adds the retained owner report's exact linked case
  status to portable exports, preserving contribution and creation-audit projections. No linked
  case is received; open is under_review; closed is resolved, without accuracy or decision claims.
  Excludes operator/case identity and all report hashes. Deploy the optional-field schema-aware
  export consumer before this migration; older strict validators refuse the additive field.
