# Database Migration Orchestrator

Runs each service-owned PostgreSQL migration executable in an explicit order inside the retained
one-off migration container. It composes ownership boundaries without allowing one service to edit
another service's tables.

## Subfolders

- `src/` — Fail-fast process orchestration, restore verifier, CLI entry points, and tests.
- `restore-manifest.v1.json` — Canonical Phase 2 six-owner restore boundary: ten owned schemas
  (including the empty-table `jobs_public` projection schema), 56 regular relations, and 31
  checksum-bound migrations.

Adding a schema owner requires adding its independently checksum-verified runner here, including it
in `Dockerfile.migration`, and updating restore verification. The container remains a bounded
Fargate task and is never an always-on service.

The restore verifier runs one bounded, read-only, repeatable-read transaction. It compares exact
migration-ledger versions/checksums and per-relation counts, then emits aggregate-only evidence.
It is not a row-value checksum or a general corruption detector. Local integration evidence uses
generated-synthetic data and a local PostgreSQL backup/restore; it does not prove AWS RDS PITR,
deployment, or an RTO/RPO objective.

The Trust owner is included in migration and restore composition, but its current foundation does
not provide `trust.export_candidate_data` or `trust.delete_candidate_data`. Candidate-rights
integration for Trust remains a blocking owner-level change; the migration orchestrator does not
invent export or deletion behavior across that boundary.
