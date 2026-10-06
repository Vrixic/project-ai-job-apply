# D3 private task-state event recovery — 2026-10-06

Status: default-off locally verified source checkpoint; D3-079 and D1/D3 remain In progress. Extends the
private launch-control draft #563 on exact #562. No frontend or public contract change.

## Implemented path

Trusted ECS task event -> exact private numeric receiver -> metadata-only signed Invoke ->
original launch control recovery -> original owning SQL claim -> fresh signed DescribeTasks ->
original durable task bind -> scalar capture acknowledgement. No RunTask, StopTask, grant,
provider settlement, retirement receipt or candidate-rights purge is introduced here.

The event receiver validates inert bounded JSON without executing accessors/toJSON, exact
service/source/account/region/resource, cluster/task-definition revision, task ARN, Fargate
platform/Exec/state/sequence and seven scalar allocation/work overrides. It discards event
metadata and forwards only the existing five-ID scope/task ARN recovery request. Event work ID
and hash are format-checked hints; authority remains the original SQL work reference and fresh
independent exact task/override observation inside the owning receiver. Event state/version/time
are never terminal proof, lifetime renewal or permission to launch. Replayed and out-of-order
hints may request another read-only positive recovery; no local deduplication can discard a lost
capture acknowledgement. Unavailable/lost replies throw a sanitized failure without an internal
retry or successful acknowledgement. The signed client holds one recovery until actual transport
settlement. The receiver may have captured the original before this sender loses its reply.

Production bootstrap requires `NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED=true` (default off),
managed same-account us-east-2 numeric own function and a distinct numeric control target,
`AWS_SESSION_TOKEN`, and `NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON` with exactly
`functionArn`, `clusterArn`, `taskDefinitionArn`, `containerName`. It rejects database/model-secret
configuration. A warmed receiver pins its original target/configuration; enable withdrawal or
retargeting withholds acknowledgement. New-launch activation is independent and is never read
as permission to recover or launch. Exact event/target matching does not authenticate callers.

The AWS envelope/overrides fields are based on the primary
[task state event reference](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_task_events.html).
Unrecognized override capabilities refuse. Actual selected managed task-event serialization and
routing remain acceptance gates; synthetic events do not establish AWS delivery conformance.

## Local evidence

Windows isolated backend worktree, Node 24.12.0/pnpm 10.24.0, synthetic metadata and transport.
49 unit cases pass, including malformed/foreign events before Invoke, nested getters/symbols/
hidden/prototype/oversize refusal, scalar-only recovery payload, RUNNING/STOPPED/startup hints,
replay/out-of-order delivery, lost reply/no internal retry, STOPPED-without-capture refusal,
held transport single-flight, exact invoked version, forbidden configuration, pinned retargeting
and launch-independent recovery/shutdown. Logs: `.tmp/d3-native-task-event-unit-final.log`.
Documents and Workflows build/typecheck pass; scoped Biome introduces no warnings or infos.

Three actual emitted isolation cases pass, including the new task-event receiver. Its bundle
contains Lambda plus exactly four pure control/event files, with no SQL, ECS, S3, KMS, secret
SDK, provider/model, renderer, durable-state or event-contract capability. Log:
`.tmp/d3-native-task-event-bundle.log`. No database mutation/schema change: the original owning
capture path's ten real SQL cases are prior layer evidence, not a new connected event/SQL run.
No Docker step was needed; Docker/WSL stay stopped and shared volumes are retained.

## Remaining gates

Clean committed `0ee4c377790564bc31b4991480af2a653aed99a6` passes the full maintained
verifier: 38 typecheck tasks, 39 test tasks, 23 production build tasks and all operator/security/
isolation checks; unchanged zero-error, 15-warning, 58-info lint baseline. All 49 new event tests
and the existing 44 readiness-entrypoint tests pass (23.578 seconds for the latter). Log:
`.tmp/d3-native-task-event-full.log`. Both private artifact sets build twice from this source;
event ZIP/archive/bundle/SBOM/source/digest integrity passes (226665 bytes, 21 components).

Fresh main `88f8ae84` has exactly the previously verified #562 tree, but lacks #563: #562
merged at 14:43:58Z, then #563 merged into its already-merged feature branch at 14:44:05Z.
The new main-based `feat/d3-native-event-recovery` reconciles that reviewed source and this
continuation. Squash-history conflicts resolve to the verified tree only after independently
checking main exactly equals #562 `e36c0298`; clean combined `82ea96c9` is byte-for-byte identical
to fully verified `0ee4c377`, including every tracked file. No implementation change or new
verification claim for a different tree is hidden in the merge.

Both artifacts rebuild twice with explicit combined source
`82ea96c9887290ceb4303ae8a0e9dbbbe29dca99`, matching all ten companion files. Actual bundle
refusal plus independent ZIP entry/fixed timestamp/bytes/hash/base64, bundle/embedded source,
companion digest and CycloneDX 1.6 name/hash/component-count checks pass. Launch ZIP is 258614
bytes, SHA-256 `6bf809fe387b4696aad000bd41fa020bfcfd60d53395ed0ba22435d426d6dae0`, 24 components.
Event ZIP is 226665 bytes, SHA-256
`9aaa04bd6761b8dc07b2942fb4eeb0321106732faec1fec6c89c693f43f33150`, 21 components.
Logs: `.tmp/d3-native-event-combined-launch-first.log`/`-second.log`,
`.tmp/d3-native-event-combined-event-first.log`/`-second.log`,
`.tmp/d3-native-event-combined-first-hashes.json`, `.tmp/d3-native-event-combined-integrity.json`.
The prior 0ee4c377 artifact proofs are retained as history. Later delivery-only commits leave
this verified implementation and unpublished source-bound bytes unchanged.

## Release and acceptance gates

 Managed EventBridge rule/resource policy, retained original receiver
version/configuration routing, retry/DLQ retention/alarms/recovery, actual task-event serialization,
reviewed sender/receiver IAM and deployed task conformance are unfinished. This source does not
create a rule, queue, permission, public route or deployment, and does not guarantee event delivery.
The native image/private adapters/provider/content/client/ATS/accountable gates remain; ADR-040
stays Proposed and activation remains off. Hosted CI/CD stays owner-deferred until production launch.

Review: draft [PR #564](https://github.com/Vrixic/project-ai-job-apply/pull/564) targets main
and supplies reviewed launch control missing from main plus this event continuation.
Later delivery-only records leave the verified source/artifact evidence unchanged.
