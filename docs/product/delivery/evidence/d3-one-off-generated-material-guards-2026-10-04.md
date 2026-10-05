# D3-064: one-off generated-material backend enforcement

Status: In progress. Started 2026-10-04. Fresh main `e48bdf3a10e3813d1d62590eea267dd0267ce22a` contains the accepted owner policy in [ADR-038](../../../adr/038-one-off-generated-application-materials.md). Exact open #547 source `25f0ca0506cb5389b16290ed54e8fd3b34aface5` is integrated in isolated branch `feat/d3-temporary-material-runtime`. Backend only; source/default-off; nothing deployed or enabled.

## Required end state

Generated cover letters and improved/tailored resumes exist only in bounded temporary memory and expire by 1,800 seconds after generation completion. Reads, downloads, edits, retries and approval cannot extend that deadline. Expiry, cancellation, logout, memory loss and confirmed submission discard platform copies; memory loss cannot recover a persisted draft. Generated material never enters SQL/packet/idempotency/history/export, objects, durable state, queue, logs or persistent browser storage. Hashes/minimal metadata may persist for reviewed approval and duplicate prevention. Confirmed/ambiguous technical submission state is preserved. D3-012 must verify provider retention/no-training terms; active writer settlement remains positive-proof only. Browser and deployed acceptance remain separate gates.

## Integration and identifier reconciliation

Main's accepted ADR-038 remains unchanged. The unaccepted vault-admission proposal formerly numbered 038 moves to [ADR-039](../../../adr/039-transactional-vault-reference-admission.md). The open stack's isolated-provider bootstrap formerly labeled D3-064 is now D3-078 in the current task register; historical logs retain their original identifiers and are interpreted with this mapping. Owner D3-064 names the new retention policy. D3-077 restricted candidate-authored packet-value protection is a separate unfinished task.

The source merge reconciles main's original-provider terminal settlement with the later immutable failure-proof path. A duplicate method from the merge is removed; the proof-recording method and unchanged pure metadata validators are retained. Workflows/dependency production build passes. Combined-source transactional results appear below; full maintained verification remains pending. Previous #547 results alone do not verify this combined source.

## Backend enforcement path

AI helper with original generation purpose → refuse one-off material as a persisted proposal → Applications permits only the exact bound artifact digest in document fields → owner SQL check refuses plaintext/mismatched references → candidate receives fixed value-free validation failure. Ordinary narrative answers and candidate-authored non-document answers retain their separate policies. Tests must prove metadata-only pointers remain usable, direct SQL cannot bypass the document guard, and failed requests leave packet/history/outbox/idempotency unchanged.

Full temporary-memory/provider transport replacement and expiration/admission integration remain necessary; this record does not redefine the end state around persistence guards. Existing saved draft/private S3/provider-slot paths remain contrary to ADR-038 and cannot be activated. No retained synthetic versions are certified erased. No frontend edit, live model/ATS call, hosted CI monitoring or production approval is claimed.

## Local verification checkpoint

Synthetic Windows/Node 24/pnpm 10 build; no live provider, ATS, AWS, or candidate data. AI SDK
285, Applications 155, API contracts 86, Domain 26 and restore verifier 44 unit tests pass.
All 1,174 Documents units pass on the reconciled merge. Applications real PostgreSQL 16.14
suite passes all 72 tests, including five new persistence/rollback/legacy-migration cases.
Documents real PostgreSQL runs pass 57 general cases and 260 explicit work/response-ledger cases
in separate invocations; each invocation's complementary suite skips are recorded, not counted
as executed. The latter verifies the merged immutable original-failure and settlement path.
Object/provider/KMS behavior remains simulated in relevant tests.

Production dependency builds and workflow typecheck pass. Runtime inventory smoke passes 157
checks for the 61-migration boundary. Publisher guards, PS7 restore guards and deletion replay
(697 checks) pass after stale source count assertions are corrected. Real generated-synthetic
logical dump/restore verifies all 61 migrations and exact full-row sets for 84 relations, including
restored immutable failure proof and unresolved disposal refusals; owned tmpfs recovery container
is removed. This is local logical recovery, not RDS PITR or deployed recovery acceptance.
Current manifest SHA: `3009222c2bf092df2cdcf9171d643960b4382d10758a9f8cd9ea497ae66b2def`.

Applications 0007 is forward-only and tightens v1 document values. Read/write consumers and
portable packet projections refuse former plaintext/URL values; hash/null metadata remains
supported. Inventory and explicitly resolve any incompatible legacy rows before applying the
validated migration and deploying writers. Rollback cannot re-enable plaintext writers.
Second contract generation succeeds; full maintained verification is pending this checkpoint.
No UI was changed/exercised and no live authenticated end-to-end acceptance is claimed.


## Maintained verification

Exact clean source `6f8a7746cc8aa3cba6d15b16471f738be5b1b7f0` passes `scripts/verify-phase0.ps1`: 38 typecheck tasks,
39 workspace test tasks, 23 production builds, contract generation/formatting, dependency-security,
operational/operator, Compose and compiled private-isolation checks. Lint stays at zero errors,
15 warnings and 58 informational notes. The second contract generation leaves the tree clean.
Unit-run integration skips are not included in the separately executed real-SQL counts above.
Added local Markdown links resolve; task IDs are unique and accepted ADR-038 is unchanged.
Docker Desktop and WSL are stopped, and owned fixtures are removed without touching shared volumes.
No current-source migration image or Lambda artifact is published, no runtime is deployed/enabled,
and no UI or live authenticated/model/ATS acceptance is claimed. Only delivery records change after
this verified source revision. Hosted CI/CD remains deferred until production launch.

Next backend work replaces generated draft/provider-slot persistence with bounded owner/application
memory and a non-renewable generation-completion deadline, then enforces expiry at content reads,
approval and ATS handoff while preserving confirmed/ambiguous submission evidence. Required browser
and provider-retention acceptance remains outside this checkpoint; D3-064 and both phases stay open.


2026-10-04 source checkpoint opened for review as [PR #548](https://github.com/Vrixic/project-ai-job-apply/pull/548), based on exact open #547. No authored PR was merged. Verified implementation source remains `6f8a7746`; later commits contain delivery records only. D3-064 and D1/D3 remain In progress.
