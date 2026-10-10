# Database Migration Orchestrator

Runs each service-owned PostgreSQL migration executable in an explicit order inside the retained
one-off migration container. It composes ownership boundaries without allowing one service to edit
another service's tables.

## Subfolders

- `src/` — Fail-fast process orchestration, restore verifier, CLI entry points, and tests.
- `restore-manifest.v1.json` — Canonical Phase 3 seven-owner restore boundary (Applications added
  after Trust): twelve owned schemas (including the empty-table `jobs_public` projection schema and separate
  `applications_restricted` storage), 96 regular relations, and 79 checksum-bound migrations
  (Profile through `0011`; Jobs through `0027`; Applications through `0015`; Documents through `0016`). The
  Docker-based recovery harness asserts this boundary and its restore-store integration test seeds and
  purges Applications data in an isolated local cluster.

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

## Read-only data comparison

`src/restore-data-inventory-cli.ts` adds a separate diagnostic to the count-only verifier. It
validates the exact reviewed schema/ledger in one read-only repeatable-read snapshot, then hashes
complete rows inside PostgreSQL 16 under attested serialization settings. Only column metadata,
counts, serialized byte totals and per-relation aggregate hashes leave SQL; candidate values and
individual row hashes do not. Duplicates and full numeric/timestamp precision are preserved.
Unsupported relations/types, RLS, missing tables, oversized inputs and unexpected differences fail.

Fixed limits are 10,000 rows/4 MiB per relation, 256 KiB per serialized row, 100,000 rows/64 MiB
overall, and a 60-second refusal deadline checked between queries (each statement remains limited
to 15 seconds). The materialized query retains only sizes and fixed-length hashes. Oversized rows
are still serialized transiently to measure their size; this is not a database memory quota.

The CLI defaults to the packaged manifest. An older snapshot requires both
`RESTORE_DATA_MANIFEST_GZIP_BASE64` and `RESTORE_DATA_MANIFEST_SHA256`: canonical base64 of gzip
containing exact reviewed UTF-8 structural bytes, at most 7,000 encoded characters/64 KiB expanded,
with the uncompressed SHA-256. Malformed, oversized or mismatched inputs fail. Compression keeps
the current contract within the [ECS task-override limit](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html);
the operator must still check the complete actual override is at most 8,192 characters. Preserve the original
bytes privately and bind them to the reviewed snapshot/resource/host, immutable executable/image
and original stopped task. A digest is an integrity check, not authenticated provenance.

`compareRestoreDataInventories` requires both explicit contracts when manifests differ and reports
the union of changed/missing relations. Added columns, empty tables, ledgers and protected receipts
remain differences; there are no exclusions or automatic migration normalization. This diagnostic
does not authorize primary promotion, replace deletion-ledger replay, or prove privacy acceptance.
The retained e061 image predates this tool; publish and verify a new immutable artifact before use.

The local recovery command below also compares all 96 relation hashes after restore and exercises
21 synthetic PostgreSQL probes in a separate empty disposable database, including precision,
duplicate/association changes, schema changes, RLS, budgets and the materialized query plan.

## Generated Phase 2 logical recovery regression

Run `pnpm test:d2-recovery` with Docker already running and the local
`postgres:16.6-alpine` image available. The command builds the seven owners and migration
orchestrator, checks the disposable-container ownership guards, and uses a uniquely labeled
PostgreSQL container with a dynamic loopback-only port. It does not use `.env`, existing
databases, AWS, Auth0, providers, bind mounts, named volumes, or downloaded images.

The maintained harness at `scripts/tests/d2-recovery/` applies and replays the current 79-migration
seven-owner boundary while retaining its D2-focused generated-data and behavior assertions,
then seeds generated Profile consent/revocation, private page capture, contribution processing,
Trust review/appeal, decision delivery, reputation, and three-provider publication leases through
the existing stores. A real custom-format `pg_dump` and `pg_restore` run inside tmpfs only.
The source/target aggregate verifier results and exact sorted full-row JSON for all 96 relations
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

The current source manifest SHA also pins the private TypeScript and PowerShell deletion-restore
validators. Update those exact identities and their cross-runtime synthetic fixture together with
the manifest; strict old-boundary refusal stays in place. This source update is not a deployed
restore operator, container publication or production restore acceptance.

The Applications 0008 boundary preserves original temporary-material scalar bindings during logical
recovery. The maintained harness compares three restored packets (expired, confirmed, ambiguous),
verifies portable ownership redaction, refuses binding removal and expired approval authority,
and retains settled-attempt duplicate guards. Generated content and memory snapshots are absent.
Restored metadata never reconstructs lost content; fresh preparation and exact review are required.

The Applications 0009 boundary includes separate restricted packet snapshots and identifier-only
read audit. Generated logical recovery checks three original values and keyed command replays,
denies private tables to a metadata-only NOLOGIN role, and exercises exact authorized deletion
without removing another candidate. Test-only AES/HMAC keys remain in the harness process and are
cleared afterward. This proves local logical data recovery and permission refusal; production
SQL/KMS grants, cluster-role recovery and accountable key/retention acceptance remain separate.


Documents 0012 preserves irreversible original launch claims through logical recovery. The current
maintained fixture includes pending, bound and retired claims and verifies that unknown launches
remain unresolved without reissuing authority or settling original provider grants. Exact full-row
comparison includes the private claim columns; this is local logical recovery, not managed task
recovery, image publication, production grants or deployed PITR acceptance.


Previous 75-migration/93-relation image execution and logical recovery evidence is recorded in the
[local migration verification](../../../docs/product/delivery/evidence/d1-migration-image-boundary-2026-10-06.md#current-75-migration-image-and-logical-recovery).
This remains local synthetic evidence; managed restore and release acceptance are separate.

Documents 0016 raises the source inventory to 76. The refreshed local image passes fresh/replayed
migrations and packaged verification of all 76 migrations/93 relations. See the
[current image evidence](../../../docs/product/delivery/evidence/d1-migration-image-boundary-2026-10-06.md#current-76-migration-image-execution).
Logical recovery, managed execution and publication acceptance remain separate release work.

Applications 0013 adds internal native-material withdrawal receipts, bringing source to 77 migrations/94 relations. The retained 76-migration image does not include this change and must be refreshed before release.

Applications 0014 adds the identifier-only leased native cleanup queue, with backfill and authorized candidate deletion. The current source boundary is 78 migrations/95 relations. Prior image/recovery evidence remains historical.
