# D3 native task launch claims and positive recovery — 2026-10-05

Status: private source checkpoint, default-off; combined clean `97cc9c52` fully verified locally.
D3-079 and D1/D3 remain In progress. Base: exact main `18b6b2e2` (#559), isolated backend worktree.
Initial standalone source excludes restricted-packet PR #561. Its independent main merge is
now integrated; the combined evidence is recorded below.

## Implemented path

Trusted owning allocation -> signed exact task-definition verification -> Applications owner/status
lock and Documents immutable launch claim in one SQL transaction -> one signed ECS RunTask ->
actual exact-task reply capture -> durable original allocation. All SQL locks release before AWS.
The factory is private control-plane source; it creates no public route or credential issuer.

Documents migration 0012 adds only two operational columns and a closed paired constraint plus
an immutable-claim trigger. A pending open allocation with current issued original grant and
consent can receive one claim. The claim retains a canonical static deployment/network/protocol
hash and timestamp. Concurrent/replayed claims never grant another launch. A crash, lost SQL or
RunTask ACK, failed capture, expiry or missing task cannot clear or renew that claim. Existing
pre-claim allocation/retirement metadata remains compatible; no backfill asserts a task is absent.

ECS client-token idempotency expires after the shorter of 24 hours or task lifetime plus one hour;
[official AWS documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_Idempotency.html).
Therefore this source never treats token reuse as indefinite duplicate prevention. The durable
claim intentionally consumes availability on an unknown outcome. A failed claim acknowledgement,
crash before dispatch or lost launch response can leave an unresolved pending allocation. Positive
original-task capture or a separately reviewed negative-dispatch protocol is needed to resolve it;
timeouts and absence never certify disposal or permit fresh work.

The static reviewed configuration pins exact same-account cluster/task-definition revision,
ECR image digest, execution/task roles, bounded CPU/memory, subnet/security-group sets and IP mode.
Signed DescribeTaskDefinition must confirm Fargate/Linux/x86_64, one essential nonroot container,
read-only filesystem, fixed Node entrypoint, dropped capabilities and core limit zero. Content
logs, secrets/static environment, scratch mounts, sidecars, healthcheck child commands and command
retargeting refuse before claim. RunTask count is one, with fixed platform version, allocation
startedBy/client token, ECS Exec disabled and only seven original scalar metadata environment values.
This checks a task envelope; it does not prove IAM least privilege, image contents, native deadline,
TLS/remote owner authentication, provider retention or managed runtime conformance.

Bound replay returns the original allocation without another RunTask. Positive recovery accepts
only trusted original scope/task metadata, performs exact signed DescribeTasks, and captures the
actual matching task, including after sealing/quarantine. Missing/foreign/multiple task replies
refuse. Recovery never launches, lists, stops, settles provider work or records retirement. Control
and new-launch activation are independent; both default off. A fulfilled late launch is captured
before timeout/withdrawal refusal so later disposal can observe it. Single-flight admission remains
occupied until the original SDK/capture promises settle; an uncooperative transport is not claimed
to return within the configured cooperative abort deadline.

## Local evidence

Environment: Windows isolated worktree, Node 24.12.0/pnpm 10.24.0. Real PostgreSQL 16.6-alpine,
owned loopback tmpfs fixtures; synthetic identities/grants/descriptors only. ECS transports are
simulated (actual production SDK classes/commands in the connected cases), not live AWS or managed
authentication/provider/browser/ATS acceptance.

- 50 launcher tests and 60 existing retirement/disposal tests pass (110 total). They cover explicit
  default-off/refusal, immutable configuration and non-evaluated accessors, exact task envelope,
  positive original recovery, independent launch shutdown, lost claim/launch/bind ACKs, 48-hour
  replay, late capture and pending-call admission. Log: `.tmp/d3-native-launch-unit-final.log`.
- All 40 real Gateway/registry PostgreSQL cases pass: 19 original plus 21 launch cases. Eight
  competing owning claims grant one attempt. Concurrent factory calls issue one RunTask; independent
  `FOR UPDATE NOWAIT` queries acquire Applications/admission/allocation/grant locks inside the AWS
  hook, proving committed claim and no SQL lock across AWS. Exact scope/config immutability,
  sealing, quarantine, terminal application, expired/revoked original grant, late capture and
  positive recovery pass. Existing export/deletion/retirement assertions remain intact. Log:
  `.tmp/d3-native-launch-override-sql-final.log`.
- All 136 existing Documents work-ledger SQL cases pass with migration 0012, preserving provider
  and writer settlement/fencing semantics. Log: `.tmp/d3-native-launch-work-sql.log`.
- Actual PostgreSQL logical dump/restore passes 65 migrations, 11 schemas and exact equality of all
  86 relation row sets. Three original pending/bound/retired claim records match exactly; restored
  claims do not reissue launch authority, unsupported configuration refuses, unknown launch still
  withholds disposal and all original provider grants stay issued/unsettled. Source row sets remain
  unchanged. Maintained D2/response/temporary packet behaviors also pass. Log:
  `.tmp/d3-native-launch-logical-restore.log`; terminal `passed: true`, `cleanupSucceeded: true`.
- 24 restore-verifier units, 165 actual migration-image runtime-smoke checks, 697 deletion-replay
  and 908 role-guard assertions pass. Historical migration boundaries remain historical; the
  current manifest and synthetic cross-runtime configuration/inspection digests are synchronized.
  Logs: `.tmp/d3-native-launch-restore-unit.log`, `.tmp/d3-native-launch-runtime-smoke.log`,
  `.tmp/d3-native-launch-deletion-restore.log`.
- Four actual emitted bundle isolation/default-off checks pass; the new launcher emits only its
  Documents control owner plus pure allocation validation and ECS, without SQL, model, renderer,
  objects, Lambda Invoke or secret-manager capability. Log: `.tmp/d3-native-launch-bundle-final.log`.

The first connected run exposes two synthetic observer clock races and a terminal fixture missing
its required Applications revision increment. Existing retirement cases pass independently. The
fixture now waits for the real DB clock to reach a positive synthetic observer timestamp before
persisting; production future-receipt refusal is unchanged. Terminal fixture advances its revision.
The final full 40-case run passes without removing assertions or relaxing runtime guards.

Owned SQL fixture `733fb2f5197e03722bb02dea39e21c925f3b82537bbca1fa2c8554a36fa029fd` is removed
after exact ID/name/label/image/tmpfs/no-bind-or-named-mount checks. The recovery harness removes
its separately verified fixture. Shared volume inventories match; Docker Desktop/WSL are stopped.

## Remaining work and release boundary

Current standalone source passes full local verification; full clean combined verification passes at `97cc9c52`. The immutable native image/entrypoint,
authenticated issuer/launcher and private evidence/work/completion/registry adapters, durable task
state-event routing/lost-ACK capture, managed TLS/DNS routing, IAM/task conformance and complete
client/ATS disposal remain unfinished. Unknown launch requires positive exact evidence; it does not
silently become absent. D3-012 and all provider/retention/accountable/deployed acceptance remain.
ADR-040 stays Proposed. No frontend changes, live cloud/provider call, publication, deployment,
activation, merge or phase completion. CI/CD remains owner-deferred until production launch.

## Recovery binding correction and full-verifier retry

The first full verifier on clean `0a487eec` stopped at the D2 runtime migration allowlist,
which did not yet recognize Documents 0012. Its exact allowlist and historical fixtures now
include the current boundary; unknown, missing and duplicate migrations still refuse.
All 264 focused runtime guard assertions pass. The current migration operator success marker
also advances to 0012, preserving the historical 0005 contract. Its operator/baseline
and schema-7/schema-8 adversarial checks pass (`.tmp/d3-native-launch-migration-operator.log`).

A separate emitted-source probe reproduced accepting a task with a foreign original owner override.
Recovery and fulfilled launch capture now require all seven exact original environment values,
no command/environment-file override, and matching roles and resource limits. Eight new unit
refusal cases and one real SQL wrong-work-grant case pass; the refused allocation stays pending
and its provider grant remains issued. The final synthetic observer waits for the actual host and
DB clocks on both sides of observation; production future-time guards are unchanged.

Final logs: `.tmp/d3-native-launch-unit-final.log` (110),
`.tmp/d3-native-launch-override-sql-final.log` (40),
`.tmp/d3-native-launch-d2-runtime-guard.log` (264).
Second owned tmpfs fixture `106726d6fe03039a4581e2d3c607d5cfa4fd67dc1aebc8c8e59b7cb07a323599`
is removed after exact identity/image/label/mount checks. Shared volume inventories match;
Docker Desktop and WSL are stopped. Corrected clean `a2600fb5` passes full verification. Log: `.tmp/d3-native-launch-full-final.log`.

Clean `a2600fb5e651266be1a367816d59d37c3fa7fc45` passes the complete maintained verifier:
38 typecheck tasks, 39 test tasks and 23 builds, formatting, operational/security, Compose,
product scope and emitted isolation/default-off checks. Main independently advances to
`5305829d` with #561 while verification runs. This certifies the standalone 65/86/11 boundary;
combined 66-migration/88-relation/12-schema acceptance remains pending reconciliation.

## Combined main integration

Main `5305829d` independently merges #561. This branch integrates that source and preserves both
append-only delivery histories. The combined manifest is 66 migrations, 88 relations, 12 schemas;
SHA256 `ddc35cb77abf0b775066dd38849c486a982c9caa71a502411c774141208c79bb`.
All SQL checksums and cross-runtime restore/configuration/inspection pins agree. Current image
and publisher exact entrypoint inventories include Documents 0011/0012 and Applications 0009.
Historical native-64 and both independent-65 manifests remain exact historical boundaries;
neither verifies the current combined source. Fifty migration/restore tests pass.

Combined local logs:
- `.tmp/d3-native-launch-combined-restore-unit.log`: 50 pass.
- `.tmp/d3-native-launch-combined-runtime-smoke.log`: 167 pass.
- `.tmp/d3-native-launch-combined-deletion-restore.log`: 697 replay and 908 role guards pass.
- `.tmp/d3-native-launch-combined-sql.log`: all 40 registry/Gateway PostgreSQL cases pass.
- `.tmp/d3-native-launch-combined-logical-restore.log`: actual 66/88/12 source-target aggregate
  and all full relation row sets match; three restricted snapshots/two key epochs and original
  keyed receipts/private-role/deletion cases pass alongside three pending/bound/retired native
  claim records. Zero launch reissues; pending unknown remains unresolved and grants unsettled.
  Terminal `passed: true`, `cleanupSucceeded: true`.

Owned combined SQL fixture `688968963b8ba6db416b49cba68043e0301661d7ae74ecddbca9887d98f32327`
is removed after exact identity/image/label/tmpfs/mount checks. The logical restore harness removes
its own fixture. Shared volumes match; Docker Desktop/WSL are stopped. ECS and KMS transport
remain simulated; no deployed authentication/task/provider or phase acceptance is claimed.
Full clean combined verification passes at `97cc9c52`.

Clean combined `97cc9c52333bf8aaccb6c56bbeff1aa3ea5434d7` passes the full maintained verifier:
38 typecheck tasks, 39 test tasks, 23 builds, formatting, unchanged zero-error/15-warning/58-info
lint baseline, security and operational checks, actual emitted isolation/default-off refusals,
Compose and product-scope checks. Log: `.tmp/d3-native-launch-combined-full.log`.
Separate migration publisher OCI guards and staging restore verifier/49 input/260 inspector
checks pass (`.tmp/d3-native-launch-combined-publisher-guards.log`,
`.tmp/d3-native-launch-combined-staging-guards.log`). No tracked source changes during verification;
only delivery evidence follows. No runtime activation or phase completion is claimed.

Draft [PR #562](https://github.com/Vrixic/project-ai-job-apply/pull/562) opens against exact main
`5305829d`. Tested executable source remains `97cc9c52`; only delivery evidence follows.
