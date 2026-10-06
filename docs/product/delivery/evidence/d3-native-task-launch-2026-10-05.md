# D3 native task launch claims and positive recovery — 2026-10-05

Status: private source checkpoint, default-off; full clean committed verification pending.
D3-079 and D1/D3 remain In progress. Base: exact main `18b6b2e2` (#559), isolated backend worktree.
Restricted-packet draft PR #561 is independent and is not included in this branch.

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

Build/verify current committed source before source review. The immutable native image/entrypoint,
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
Docker Desktop and WSL are stopped. Full verification of the corrected clean commit remains pending.
