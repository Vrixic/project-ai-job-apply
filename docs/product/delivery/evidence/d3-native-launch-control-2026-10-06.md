# D3 private native launch control — 2026-10-06

Status: default-off private source checkpoint; full clean committed verification and unpublished
artifact integrity pass at `228bd75d53fe6e7edce0486d4d2c678e42c7132d`. D1/D3 and D3-079 stay In progress. Starts from fresh
main `5305829d` plus exact open #562 `e36c0298` in the isolated backend worktree. No frontend work.

## Implemented boundary

Trusted metadata sender -> signed fixed regional numeric-version Lambda Invoke -> private
bootstrap -> managed database secret -> one native-codec SQL pool -> Applications owning
same-transaction admission and Documents native registry -> exact signed task-definition check
and irreversible claim -> one RunTask -> original observed capture -> strictly bound scalar reply.
Owning callback locks and registry claims remain inside their original transaction; no SQL lock
is held across AWS. The launcher issues no provider grant or candidate credential.

The closed version-1 request contains only owner/application IDs, the original issued work
reference and explicit previous epoch, or original recovery scope/task ARN. Body/extra fields,
accessors, symbols, inherited or hidden properties refuse. The bound reply echoes the exact
request and returns only the original allocation/scope. Unknown, foreign, contradictory,
noncanonical, oversized, malformed UTF-8 and wrong-version SDK replies refuse without retry.

The sender uses a normal signed SDK client with the fixed us-east-2 HTTPS Lambda endpoint,
maxAttempts 1, no content logger and no endpoint override. Only synthetic tests may inject its
transport. Both controls default off. New-launch authority is independently disabled while
recovery stays available. An abort-ignoring original Invoke retains local admission until it
settles; no hard return deadline or duplicate prevention beyond the owning durable claim is
asserted. A caller may lose a reply while the remote control still captures the original task.

The receiver requires one numeric invoked version, same account/region managed secret and
validated immutable task/image/role/network settings before any secret read. It refuses direct
DATABASE_URL/model-key configuration. Read-only initialization is single-flight and pinned;
only failed secret setup can retry on a later invocation. Configuration retargeting, enable
withdrawal, wrong invocation version and shutdown during initialization refuse. Actual runtime
composition supplies only owning admission/registry/launch capabilities. It can capture a late
fulfilled task before withholding a reply after new-launch shutdown, and recover a lost ACK
original after sealing. It has no task stop, retirement acknowledgement or work settlement.

Exact target matching is not caller authentication. Signed sender transport is implemented;
reviewed IAM sender/receiver permissions and deployed authentication remain release gates.
The source creates no public route, function deployment, role grant or image publication.

## Local evidence

Windows isolated worktree, Node 24.12.0/pnpm 10.24.0. Generated synthetic UUIDs, grants, values,
AWS credentials and operational configuration only. Actual PostgreSQL 16.6-alpine tmpfs fixture;
secret resolution, Lambda and ECS transports are simulated. No live provider/managed task call.

- 41 new strict sender/contract cases and 50 existing task-launch cases pass (91 total).
  The normal production SDK signs and serializes one request to the fixed endpoint even with
  a hostile endpoint environment override; only HTTP transport and credentials are synthetic.
  Log: `.tmp/d3-native-launch-control-unit-final.log`.
- 33 private bootstrap cases pass: configuration/version/default-off refusal before effects,
  bounded secret options, pinned single-flight initialization, independent recovery and
  failed read-only setup retry. Log: `.tmp/d3-native-launch-control-bootstrap-unit-final.log`.
- All 10 actual PostgreSQL connected cases pass. The real sender/receiver/runtime/owner stores
  verify original replay, foreign owner/work/hash/terminal refusal, lost-ACK sealed recovery,
  late fulfilled capture, wrong observed-owner pending state, competing independent runtimes
  issuing one RunTask, and independent NOWAIT application/allocation/grant locks inside the
  AWS hook. Original grants remain issued/unsettled. No SQL assertion or runtime guard is
  relaxed. Log: `.tmp/d3-native-launch-control-sql-final.log`.
- Two actual emitted isolation/default-off checks pass. The sender emits only Lambda and
  four pure control/validation files; no SQL, ECS, model, object, renderer or secret capability.
  The receiver emits exactly eight owner files: Applications database/admission, Documents
  allocation/contract/registry/launch, Profile managed-secret resolver and the bootstrap.
  It has ECS/postgres, with no packet/body/crypto/event/durable/Invoke/model/object/renderer
  authority. Narrow private package exports remove unrelated root imports.
  Log: `.tmp/d3-native-launch-control-bundle.log`.
- Documents, Applications and Workflows production builds and scoped formatting/lint pass.
  No dependency version, public API, event/domain schema or SQL migration changes.

Initial signed-SDK assertion decoded its byte payload as a string; the corrected assertion uses
UTF-8 bytes. The first SQL fixture attempted a seal with two different timestamps and properly
hit the paired constraint. It now invokes the actual owning sealApplication, and all ten cases
pass. These fixture corrections change no production acceptance guard.

Owned SQL fixture `b41f214fd05e53b451d9aa5351c7de967fb7b84a7b2e1bb73c69a88846f0cbcd`
is removed after exact ID/name/label/image/tmpfs/no-bind-or-named-mount validation. Shared volume
inventories match; Docker Desktop and WSL are stopped.

## Full verification and unpublished artifact

Clean committed `228bd75d53fe6e7edce0486d4d2c678e42c7132d` passes the maintained
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 production build tasks,
all operator/dependency-security and emitted isolation checks. Lint stays at the existing
zero-error, 15-warning, 58-info baseline. Log: `.tmp/d3-native-launch-control-full-final.log`.
The first full run failed a pre-existing readiness-entrypoint cold dynamic-import timeout
and the following mock-effect assertion. All 44 cases then passed in isolation, and all 44
passed in the unchanged-source full rerun (29.066 seconds for that file). No timeout,
assertion, production guard or test scheduling was changed. Preserve the failed log
`.tmp/d3-native-launch-control-full.log` and narrow investigation log for provenance;
the successful rerun does not establish that the cold-import timing sensitivity is fixed.

With `ARTIFACT_SOURCE_SHA` explicitly set to the verified committed source, the private
Node 24/x86_64 `index.handler` artifact builds twice byte-identically across all five files.
Independent ZIP entry/timestamp/byte count/SHA/base64, embedded source marker, bundle,
companion digest and CycloneDX 1.6 SBOM checks pass. All five files still match after the
full verifier. The unpublished ZIP is 258613 bytes with 24 SBOM components:

- ZIP SHA-256: `31ce04eb0abb5ee79459f7a326041fceaaaa66b1198737301b11de4e16c89017`.
- Bundle SHA-256: `c767ee2fe154b07757dd7f8d8fc88e7079cdbaa55b7cafff89344c913a3a24a0`.
- SBOM SHA-256: `6cec69c7f9eb51bd32028b06d7176dfdea87e56f484a6fa630b5ebdb55b52f4c`.

Logs: `.tmp/d3-native-launch-control-artifact-bound-first.log`,
`.tmp/d3-native-launch-control-artifact-bound-second.log`, and
`.tmp/d3-native-launch-control-artifact-integrity.json`. Earlier builder runs labelled
`sourceSha: local` are not committed-source evidence. Subsequent delivery-only commits
leave the verified implementation and these source-bound artifact bytes unchanged.

## Remaining gates

Retain the original numeric receiver version and its pinned configuration for original-task
recovery; a replacement configuration is not permission to recapture through a different task.
The native immutable image/entrypoint, private evidence/work/completion adapters, original
provider/request content routing, durable ECS state-event capture, exact task IAM and managed
TLS/DNS routing/conformance remain unfinished. Full client/ATS disposal and D3-012 provider/
retention/accountable/deployed acceptance remain. ADR-040 stays Proposed. Neither a missing task
nor an Invoke/RunTask timeout proves absence or authorizes another launch or disposal. New
runtime flags remain false/absent; restricted reuse/export/protection gates stay unchanged.
No artifact publication, deployment, activation, authored main merge or phase completion.
Hosted CI/CD remains owner-deferred until production launch.
