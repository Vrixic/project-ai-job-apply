# Database Migration Orchestrator

Runs each service-owned PostgreSQL migration executable in an explicit order inside the retained
one-off migration container. It composes ownership boundaries without allowing one service to edit
another service's tables.

## Subfolders

- `src/` — Fail-fast process orchestration, restore verifier, CLI entry points, and tests.
- `restore-manifest.v1.json` — Canonical Phase 3 seven-owner restore boundary (Applications added
  after Trust): eleven owned schemas (including the empty-table `jobs_public` projection schema), 83
  regular relations, and 57 checksum-bound migrations (Profile through `0011`; Applications through
  `0005`; Documents through `0007`). The
  Docker-based recovery harness asserts this boundary and its restore-store integration test seeds and
  purges Applications data (run 2026-09-18 against an isolated local cluster).

Adding a schema owner requires adding its independently checksum-verified runner here, including it
in `Dockerfile.migration`, and updating restore verification. The container remains a bounded
Fargate task and is never an always-on service.

The restore verifier runs one bounded, read-only, repeatable-read transaction. It compares exact
migration-ledger versions/checksums and per-relation counts, then emits aggregate-only evidence.
It is not a row-value checksum or a general corruption detector. Local integration evidence uses
generated-synthetic data and a local PostgreSQL backup/restore; it does not prove AWS RDS PITR,
deployment, or an RTO/RPO objective.

The Trust owner includes its candidate-rights and identifier-only decision-signal migrations plus
checksum-bound export/delete database functions. Manifest inclusion and local restore verification
prove only the declared structural boundary; they do not prove deployed candidate-rights or
decision-signal delivery, nor an AWS restore.

## Generated Phase 2 logical recovery regression

Run `pnpm test:d2-recovery` with Docker already running and the local
`postgres:16.6-alpine` image available. The command builds the six owners and migration
orchestrator, checks the disposable-container ownership guards, and uses a uniquely labeled
PostgreSQL container with a dynamic loopback-only port. It does not use `.env`, existing
databases, AWS, Auth0, providers, bind mounts, named volumes, or downloaded images.

The maintained harness at `scripts/tests/d2-recovery/` applies and replays the current 57-migration
seven-owner boundary while retaining its D2-focused generated-data and behavior assertions,
then seeds generated Profile consent/revocation, private page capture, contribution processing,
Trust review/appeal, decision delivery, reputation, and three-provider publication leases through
the existing stores. A real custom-format `pg_dump` and `pg_restore` run inside tmpfs only.
The source/target aggregate verifier results and exact sorted full-row JSON for all 83 relations
must match; 18 Phase 2 relations must contain generated data. Restored behavioral checks cover
owner isolation, current/revoked/cancelled consent, lease immutability and concurrent renewal,
stale-lease refusal, and idempotent publication. No rows or dump files are retained on the host.

Source and target are separate databases in one disposable cluster, intentionally sharing roles.
Migration replay occurs before creating the target because the Jobs public-reader CONNECT guard
is cluster-wide. The target is validated read-only and through restored behavior, without weakening
that guard. This is logical database recovery, not cluster-role recovery, AWS PITR, RTO/RPO
acceptance, provider-fetch validation, or deployed evidence. Success emits aggregate metrics only
after clients close and the exact validated container is removed; the caller remains responsible
for Docker/WSL runtime shutdown when no following step needs them.
