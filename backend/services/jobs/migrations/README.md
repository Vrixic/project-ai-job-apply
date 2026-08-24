# Jobs Migrations

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
