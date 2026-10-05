# D3-079 exact native task retirement — 2026-10-05

## Scope

Trusted immutable allocation binding → fixed regional signed ECS control → exact task description
→ at most one stop request → bounded fresh terminal descriptions → scalar task retirement receipt.
This starts from fresh main `9478f068` with exact open #557 `eb3879b6` as an explicit dependency.
It is default-off backend source, not a deployment or permission to stop a live task.

## Implemented boundary

Documents' private [native task retirement](../../../../backend/services/documents/src/native-task-retirement.ts)
entrypoint pins owner/application/generation/allocation UUIDv7, same-account/region cluster and
long-format task ARN, exact numeric task-definition revision and container name. It snapshots the
binding and refuses wrong scopes, concurrent admission, abort and disabled capability before AWS
client creation. Production fixes the regional HTTPS endpoint, ignores configured endpoint URL
overrides, selects one SDK attempt and suppresses SDK diagnostics. Test clients require NODE_ENV
=test at construction and throughout execution. Normal production composition does not import or
enable this capability. The ECS dependency matches the existing SDK pin 3.1133.0.

A fresh description must match the exact task, cluster, task-definition and launch `startedBy`
allocation ID before any stop. Missing tasks, partial failures or unexpected identity refuse;
there is no listing, default cluster, wildcard discovery or arbitrary candidate task address.
Already-stopped tasks need no stop request. A desired-stopped pending task is observed without
repeating stop. Stop replies are deliberately ignored as authority. A lost stop acknowledgement
may converge only from a subsequent positive description, without another stop request.

A receipt requires STOPPED actual and desired task status, a valid nonfuture stopped timestamp,
and the exact sole bound container/task in STOPPED status. It contains only the immutable scalar
scope/task identity and stopped/observed times. The operation observes at most three further times
(configurable only down/up within one to five), within at most ten seconds, with no background
polling or retry loop. Timeout/abort revokes local admission but the method retains its concurrency
slot until the actual SDK promise settles. A monotonic time check also refuses late fulfillment.
No Promise.race, local kill/HTTP reply, task disappearance or elapsed deadline supplies a receipt.

[AWS StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html) initiates
container shutdown; its returned task is not used as terminal evidence.
[AWS DescribeTasks](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html)
returns task descriptions and per-task failures. The implementation requires explicit positive
terminal evidence and treats unavailable historical task information as unknown.

The client does not return an application-wide `discarded` acknowledgement, persist a receipt,
settle provider work, fence SQL writers, or certify every client/remote copy purged. A trusted
owning registry must seal launch admission, account for every exact allocation and durably retain
validated positive receipts before composing such an acknowledgement. That registry, launcher,
private control runtime/IAM and release remain unfinished. This does not replace original native
kernel expiry or extend material lifetime.

## Local evidence

[48 focused tests](../../../../backend/services/documents/src/native-task-retirement.test.ts) pass:
fixed scopes and ARN qualification, immutable binding, known terminal state, stop-then-observe,
lost acknowledgement, already-requested stop, wrong/missing/partial task/container proof, bounded
pending state, mutable switch, retained admission through actual cancellation/timeout settlement,
fixed diagnostics and test-only injection refusal. Two installed-SDK offline HTTP cases verify
SigV4 authorization, exact JSON request, epoch timestamp decoding and one attempt for 200/500.
A normal-client test verifies pinned HTTPS/region/one attempt despite endpoint environment overrides.
AWS transport/terminal responses are simulated; no managed task was launched or stopped.
Log: `.tmp/d3-native-task-retirement-unit.log`.

[Actual emitted bundle guard](../../../../scripts/tests/native-task-retirement-bundle.test.mjs)
passes: sole owning implementation, ECS SDK present, no SQL/Profile/model/object/render/Invoke
owner dependency and actual emitted default-off refusal. The ECS SDK itself is not a least-
privilege IAM policy; production role review remains mandatory. Maintained verifier includes this
additional compiled guard. Documents build/typecheck pass. Final clean-source full verifier is
pending at this start record. No SQL/API/domain/event schema, migration, frontend or Terraform
changes. No new SQL/Docker/native-kernel test is necessary for unchanged implementations.
Docker and WSL remain stopped.

## Remaining gates

D3-079/D3-064 and D1/D3 stay In progress. Exact owning registry/sealed launch admission, authenticated
private evidence/work/completion ports, immutable reviewed native image, approved TLS/DNS routing,
real managed-task stop conformance and full client/logout/idle/ATS lifecycles remain. D3-012
provider/retention/diagnostic/entity/region and accountable acceptance remain mandatory. ADR-040
stays Proposed. No cloud call, publication, deployment, activation, actual process/AWS death claim,
application-disposal certificate or phase completion. Hosted CI/CD remains deferred until launch.

## Final maintained verification

Clean source `ba58619cf0e7d449edc873f2ce6ad56631ee8b45` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks and 23 builds, operational/security
guards, formatting, all emitted isolation guards (including the new retirement guard), Compose
and product scope. Lint remains zero errors, 15 existing warnings and 58 informational notes.
Documents 1,376, API 96, Applications 224, Gateway 318, SDK 293 and Workflows 1,588 tests pass.
Gateway's 66 and Workflows' 57 opt-in skips are not managed-task/SQL evidence.
Log/receipt: `.tmp/d3-native-task-retirement-verify.log` /
`.tmp/d3-native-task-retirement-verify.exit` (0).

The maintained build and 48 focused cases ran locally on Windows/Node 24.12.0, pnpm 10.24.0
and Terraform 1.16.2. AWS responses/HTTP handling are simulated; installed SDK serialization,
SigV4 signing and timestamp decoding are actual. The actual compiled artifact's default-off
refusal/isolation is exercised. No new native process, SQL or AWS runtime proof is claimed.
No implementation changed during the full verifier. Subsequent changes are delivery documentation
only. Docker Desktop and WSL remain stopped; verifier handles are terminal. D3-079/D3-064 and
D1/D3 stay In progress behind the remaining gates above. CI/CD remains deferred until launch.
