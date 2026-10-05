# D3-064: Native original-completion metadata

Status: In progress. Backend-only branch `feat/d3-original-material-completion`, from fresh main
`e48bdf3a` plus exact open [#549](https://github.com/Vrixic/project-ai-job-apply/pull/549)
`472ff8fa`. Accepted [ADR-038](../../../adr/038-one-off-generated-application-materials.md)
remains authoritative. The [memory checkpoint](d3-one-off-memory-runtime-2026-10-04.md) is an
explicit dependency; no authored PR has been merged by this work.

## Implemented boundary

Trusted original generator -> closed private v1 metadata RPC -> owning active-candidate SQL
transaction -> one immutable completion tuple on the existing Documents reservation. Content
never enters this control. First admission compares owner/application/version/original work/hash
and original started/nonfailed state, checks server time, and fixes expiry to completion + 1,800,000
milliseconds. The trusted generator supplies completion time; SQL does not observe model completion.
An exact replay is `already_completed`, never a new claim or recovery of lost process content.
Different hash/time/identity refuses. Lost acknowledgements refuse without retry or renewal.

Four nullable columns, a validated constraint and two triggers extend the existing relation.
No new relation or old-row backfill. The legacy final writer cannot be newly authorized afterward;
revoked tombstones remain available for cleanup fencing. Original physical work is not settled,
expired or erased by metadata admission. Running work still prevents deletion. Existing provider
response/object inventory and quiescence requirements remain separate.

The client pins original work and exact numeric Lambda version, one SDK attempt, bounded timeout,
canonical bounded UTF-8 JSON and echoed scalar bindings; no logs/function errors accepted. Native
bootstrap is lazy/default off, identity/secret pinned, with one native-codec SQL connection.
Reviewed sender IAM is still required: target equality is not authentication. Compiled client/control
exclude generated-content memory, render/S3/model and writer issuance/settlement implementations.
No public API/event/domain shape, frontend, hosting, Terraform or live provider change.

## Executed local verification

- 38 new contract/client/handler/bootstrap units and the previous 57 memory/render tests pass.
- 277 opt-in real Documents ledger cases pass, including 17 new original-completion cases. The
  57 general SQL cases were skipped in that run and executed separately: all 57 pass, with the
  277 ledger cases then skipped. Synthetic tmpfs PostgreSQL 16.14, loopback port 55448,
  `work_ledger_completion`; native bootstrap uses real SQL, secrets/cloud calls are simulated.
- The maintained logical recovery harness passes on its own generated tmpfs PostgreSQL 16.6:
  62 migrations, seven owners, eleven schemas and 84 exact relation row sets. Restored metadata
  refuses three renewal/removal attempts and an unsettled delete; exact replay remains consumed.
  Explicit fixture settlement permits fenced deletion. No provider or object call exists.
- Restore verifier 45 units; deletion-restore contract 207 units; runtime inventory smoke 159
  cases, current/historical PowerShell restore guards, 697 deletion-replay guards and migration
  publisher guards pass. Source-bound migration-operator checks require a committed source and
  are pending the commit/full verification; an uncommitted run correctly rejected old HEAD.
- Two actual emitted bundle isolation cases and actual default-off bundled-handler invocation pass.
  No release artifact is published. Full maintained repository verification remains pending.

Current restore manifest identity: `fc6f80b152e6e0abc16453bdca971791b2983d0ac945917867e4f394c77a28bd`.
TypeScript, PowerShell and the generated cross-runtime deletion-replay fixture are synchronized.
Historical 61/60/59/58/57/52 and earlier receipts remain valid only for their exact source; none
qualifies as current 62-migration evidence. Apply Documents 0010/current manifest before native code.

Both owned SQL fixtures are removed; Docker Desktop and WSL stopped after the last dependent step.
No live AWS, OIDC, model, ATS, candidate artifact or browser/UI check is claimed. No UI changed or
new public capability exposed. Owner CI/CD deferral until production launch remains in force.

## Required remaining work

D3-064 remains In progress: integrate content transport and actual original actor completion,
resume kinds, packet approval/version/expiry and ATS final handoff, no-store responses,
logout/cancel/confirmed-submit/idle client lifecycle, managed renderer/worker drain, retained
historical synthetic object inventory and D3-012 approved provider retention/no-training terms.
Metadata admission neither proves all-copy cleanup nor authorizes an ambiguous submission retry.
Reviewed IAM/runtime release and accountable/deployed acceptance remain mandatory. D1/D3 retain
all eight/thirteen unchecked exit criteria; no phase/task completion or activation is claimed.


The first maintained verifier on clean `3d12d84b` stops at the exact D2 runtime migration-inventory
guard. Extend its supported Documents list with exact 0010 while retaining all historical lists
and rejecting unknown/mixed successors. The focused current/historical suite passes 256 assertions;
no cloud call. This is a migration-compatibility fix, with a clean-source full rerun still required.


## Final source verification (2026-10-05)

Clean committed implementation `78388aa1ad6d92ed5dfb57cc5c648b9b5f96d65f` passes
`scripts/verify-phase0.ps1` with exit 0: 38 typecheck tasks, 39 workspace test tasks, 23 production
builds, formatting, operational/security/Compose/scope and compiled capability checks. Documents
passes 1,269 units; Workflows passes 1,588 units with 57 integration cases skipped in that unit run.
Lint remains zero errors, 15 warnings and 58 informational notes. Local PostgreSQL/restore and the
two new completion-bundle checks were executed separately above; they are not hosted evidence.
The committed source-bound migration-operator check passes, and current/historical D2 inventory
checks pass 256 assertions after the exact-list fix. No tracked source changes occurred during the
successful verifier. A preceding verifier tool session disappeared and OS inspection found no
remaining verifier process; its incomplete log was not treated as a pass. The resumed full run
finished normally with an explicit zero exit receipt.

Only delivery documentation follows this verified implementation. Newly added local links resolve,
the SQL migration checksum and exact manifest/TypeScript/PowerShell/fixture identities match,
and whitespace checks pass. Docker/WSL remain stopped. D3-064 and both phases remain In progress;
no browser/provider/cloud acceptance, publishing, deployment, activation or hosted CI/CD claim.
