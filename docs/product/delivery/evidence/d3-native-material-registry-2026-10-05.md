# D3 native launch registry and durable task disposal — 2026-10-05

Status: repository source only, default-off. D3-079 and D1/D3 remain In progress.
This extends PR #558 on exact #557 `eb3879b6`; no frontend or cloud runtime changes.
Hosted CI/CD is deferred until production launch by the owner.

## Implemented boundary

Documents records an immutable pending allocation before any future RunTask. The owner and
application admission are checked by Applications on the same SQL transaction and actual row
lock; preparing/review-required applications can admit, terminal/submitting states cannot.
One original provider grant, generation, epoch and fixed deployment bind to one server-issued
allocation. Unknown launch outcome remains pending. Late fulfilled capture can bind after
sealing so it cannot orphan a task. There is no missing-task or timeout abandonment authority.

Sealing closes startup admission and records a fresh-work barrier. The original work claim locks
the same admission row; it requires the exact bound open generation. Opening another generation
requires an explicit previous sealed epoch, retirement of every prior allocation and an original
grant issued after the seal. Old disposal acknowledgements cannot certify a new epoch.

The control coordinator commits sealing before remote task observation, persists an exact scalar
STOPPED receipt, then checks the current sealed epoch. It holds no SQL lock across AWS. Unknown
launch, failed receipt persistence and a changed epoch withhold acknowledgement. Replay of a
committed disposal needs no new task request. A running original provider grant is unchanged by
task retirement; candidate-wide purge and provider settlement remain separate requirements.

Migration `documents/0011_native_material_allocations.sql` adds two metadata-only relations and
four guards. It blocks live saved-slot authorization and saved-document finalization for native
generations while retaining immutable revoked cleanup tombstones. Export adds optional strict
technical metadata arrays, excluding deployment ARNs, work-grant identities, request digests and
candidate bodies. Authorized deletion retains unresolved tasks; retired allocation metadata is
removed only through cover-letter cascade after existing work-writer checks pass.

## Local verification

Test environment: isolated Windows worktree, Node 24/pnpm 10; real loopback PostgreSQL
16.6-alpine in an owned tmpfs container. Synthetic identities, grants and task descriptors only.
ECS transport is simulated; no managed task is launched, listed or stopped.

- 19 real PostgreSQL registry cases pass: concurrent idempotent intent, cancellation ordering,
  exact task binding, sealed startup refusal, late launch capture, fresh epochs, original work
  preservation, immutable receipts, technical export, expiry, quarantine and authorized deletion.
- 136 original work-ledger SQL cases pass with the new migration, separately from registry cases.
- 60 focused Documents cases pass: 48 original retirement and 12 disposal failures/lifecycle cases.
- 27 Domain cases and 47 migration/restore unit cases pass. Historical manifests retain their
  historical relation/migration counts and cannot verify the expanded current boundary.
- Three actual esbuild artifacts pass dependency-isolation and default-off execution refusals.
  Registry includes only owned metadata/pure validation; disposal includes the exact ECS observer,
  with no SQL, model, object storage or Lambda Invoke runtime capability.
- An actual PostgreSQL pg_dump/psql restore to a distinct empty synthetic database preserves
  pending/bound/retired metadata, seals/fresh-work barriers and running unsettled provider grants.
  Independent aggregate verification passes 64 migrations/86 relations on both databases;
  registry metadata matches exactly and restored unknown-launch deletion still refuses.
  Current manifest SHA-256: `19f5ba9ad4b72da48de1f8b8848d2e6d1eef3b3eaf2e70ba60145f46d7870c68`.
- Applications and Documents compile; Gateway and Documents typecheck pass.

Local ignored receipts: `.tmp/d3-native-registry-sql.log`, `work-sql.log`, `unit.log`,
`bundle.log`, `domain.log`, `restore-unit.log` under the same `d3-native-registry-` prefix;
logical restore proof: `.tmp/d3-native-registry-restore.log` and terminal exit receipt.
Docker Desktop and WSL are stopped; the owned tmpfs fixture is removed.
The initial clean-source full verifier at `3e932407` stopped at a stale synthetic deletion-replay
environment checksum after manifest expansion. Derived environment/inspection digests were
regenerated; 697 deletion-replay and 908 role-guard assertions pass. Full verifier rerun is pending.
Local SQL checks found and corrected a PL/pgSQL
OLD-alias conflict and preserved the existing cleanup tombstone protocol before this checkpoint.

## Rollout and remaining gates

Apply migration before any code activation; no backfill certifies pre-registry tasks. New restore
controllers/image inventories bind 64 migrations/86 relations and the new exact manifest checksum;
historical boundaries remain historical evidence. A source rollback cannot remove an unresolved
launch or replace positive task proof. No image is published and no migration is deployed.

The private authenticated issuer/launcher, fulfilled/lost-ACK RunTask recovery, managed task/image
IAM, private owner/work/completion RPCs, candidate routing, complete client/ATS disposal and actual
managed conformance remain unimplemented/unverified. Pending unknown launch deliberately blocks
fresh generation until positive exact capture/retirement is possible. This is not a complete
launcher or enabled user flow. There is no browser verification for this private backend source.
D3-012 provider retention/no-training/accountable approvals and D1/D3 deployed acceptance remain.

## Integration ancestry

#557 independently merged to main `2b6f59aa`; the complete main tree equals exact #557
`eb3879b6`. #558 merged to the already merged feature-branch base rather than main. Its source
retirement implementation therefore remains part of this follow-up against main. Current main
ancestry is integrated without changing the verified source tree; no authored main merge occurs.
The follow-up uses `feat/d3-native-material-registry`, rather than updating a merged PR.
