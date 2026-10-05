# D3-071: Native preparation terminal and scheduled recovery

Date: 2026-10-04
Status: Source/focused/SQL, exact-source full verifier and local artifact checks passed; review/release gates remain.

The backend-only branch starts from fresh main bde17d9 and locally integrates exact open #540
14371d70eb01c20301e0baef31436b232010b8e2. No GitHub merge occurs.

## Result and boundary

A separate native recovery module exports terminalHandler and reconcileHandler. Both default off,
qualify their numeric invoked target, us-east-2 account, managed database secret and distinct
numeric durable function before I/O. Private object/KMS/provider/model configuration refuses.
Terminal configuration refuses queue, rule and nudge settings; it creates no SQS client.
Scheduled configuration requires its exact same-account standard queue URL and EventBridge rule.
Original bindings are restricted by a compact, unique numeric retained-version list that includes
the current target and only versions of that same durable function. Warm configuration drift refuses.

Strict terminal envelope validation is extracted without changing the existing source contract
or settlement logic, so native calls reject malformed/text-bearing/foreign/unretained events
before managed-secret/SQL setup. Scheduled envelopes contain only the exact account/region/rule,
empty detail and a fresh canonical timestamp. Inputs detach before asynchronous setup. Managed
secret setup is lazy/single-flight with a three-second read-only request and no in-call setup retry.
Native Applications SQL preserves owner codecs with one connection. AWS clients use fixed region,
one attempt and ignore configured endpoint overrides; injected retry-enabled clients refuse effects.

Terminal events are nudges, never settlement authority. GetDurableExecution requests exclude
execution data, and the existing reader verifies exact original execution/name/function/version
and timestamps and rejects payload/result/error fields. Owning SQL settlement and its terminal
receipt commit together. AWS SUCCEEDED does not promote a still-active draft: the existing owner
logic conservatively marks it failed. Recovery does not refresh consent or invoke a workflow,
model, private activity or document writer. It cannot cancel remote effects or certify quiescence.

Scheduled recovery remains active while exact APPLICATION_PREPARATION_NUDGES_ENABLED is absent
or withdrawn. New nudges require both recovery and nudge activation, including rechecks before
queue sends. Output is aggregate-only. A nudge is identifier-only and leaves original dispatch
binding to the independently gated starter. Withdrawal does not erase already-issued effects.
Exact configuration is not caller authentication; separately reviewed caller IAM, metadata-only
execution access, queue permission, scheduling, retained versions and release wiring remain.

The unchanged PreparationDispatchPendingError moves to a pure error module, with the old starter
export retained for compatibility. Recovery no longer emits/imports starter implementation.
No API/event/domain shape, migration, dependency or infrastructure change is introduced.

## Executed local checks

- 82 focused tests pass: 39 new bootstrap cases plus 43 unchanged source recovery/SDK/dispatch
  cases. They cover configuration/input refusal before setup, target and retained-version checks,
  single-flight setup, input detachment, later read-only setup retry, no effect retry, warm drift,
  activation withdrawal and continued recovery after nudge withdrawal.
- Twelve real PostgreSQL cases pass with native Applications persistence: normal terminal receipt,
  lost start acknowledgement, committed settlement acknowledgement loss and replay, retained
  original version, unretained refusal before setup, text-bearing AWS metadata refusal, scheduled
  terminal settlement with nudges off, running metadata, new nudge, withdrawal between claim/send,
  retry-enabled Lambda refusal and retry-enabled SQS refusal. Original approval/expiry never renew.
  Scheduled cases isolate their synthetic owner inventory in the guarded disposable test database.
- Native typecheck/build and emitted positive actor isolation pass. The guard requires owning SQL,
  recovery and managed-secret code and refuses emitted starter/Invoke, durable/private activity,
  Documents, worker and AI implementations. The maintained verifier includes this guard. The pure
  error extraction is followed by all 82 focused cases and the final build/isolation check; it
  changes no SQL behavior, and the twelve connected cases remain valid layer evidence.

Environment: Windows, Node 24.12.0, pnpm 10.24.0, PostgreSQL 16.14-alpine. Real SQL/migration
transactions; simulated managed-secret responses, Lambda context/AWS metadata, SQS receipts and
lease clock. No live AWS/provider/model call, browser/UI change, publication, deployment or activation.
The owned tmpfs fixture is removed; Docker Desktop and WSL stopped, shared volumes retained.
Ignored logs: .tmp/d3-071-focused-final.log, typecheck/build-final/bundle/integration logs with
that same prefix. No candidate facts or raw artifacts are committed.

## Remaining gates

Full maintained exact-source verification and local artifact checks are pending. Native release,
caller/metadata/queue IAM, maintained scheduling, retained versions, original writer drain/retention
and accountable/deployed acceptance remain. No phase exit changes; D1/D3 stay In progress.
Hosted CI/CD remains deferred until production launch by owner instruction.

## Final exact-source verification and artifact

Clean source `38b3891fc70764f6fb4bc5322ce72f84fa02d659` passes the full maintained
`scripts/verify-phase0.ps1` with terminal exit 0 and its completion marker: 38 typecheck tasks,
39 test tasks and 23 builds. All 1,578 Workflow tests pass; 50 opt-in tests remain explicitly
skipped by the ordinary runner. The twelve new SQL cases passed separately as recorded above.
Formatting, unchanged generated contracts, operational/security/dependency regression guards,
all emitted actor isolation checks and Compose configuration pass. Lint remains zero errors,
15 warnings and 58 informational notes. Log: `.tmp/d3-071-full-verification-38b3891f.log`.

One separate unpublished native recovery artifact builds from the same clean source. Manifest
schema 2 specifies Node24/x86_64, index.terminalHandler and index.reconcileHandler. Archive SHA256:
`cde5d36b3c2d867bfbc30010662f856b62e0a2fdc83fe8bce1cb58e15c9b24db`
(399,650 bytes; 31 SBOM components). Independent Python checks verify archive hash/bytes/base64
digest, sole index.mjs member, identical local bundle/hash/source marker and SBOM hash/count.
Actual bundle bytes contain no model endpoint, ModelGateway or cover-letter S3 store. Both actual
bundled handlers refuse default-off, wrong numeric invoked version and invalid input with zero
fetches. The AWS SDK includes generic command definitions; their presence is not an invoked actor
or IAM authority. Native composition only sends GetDurableExecution for metadata and the scheduled
handler's gated SendMessage; real-SQL tests reject any other command and emitted actor guards
exclude the starter/dispatch implementation. IAM must independently deny Invoke. Artifact log:
`.tmp/d3-071-artifact-38b3891f.log`.

Only delivery documentation follows verified source. Nothing is published, deployed or activated.
Release/caller/metadata/queue IAM, scheduling, retained versions, retention/original writer drain
and accountable/deployed acceptance remain. Original phase/tracker history is preserved and new
evidence links resolve. D1/D3 remain In progress, with hosted CI/CD deferred until production launch.

## Review handoff

[PR #541](https://github.com/Vrixic/project-ai-job-apply/pull/541) opens on exact #540 dependency 14371d70. Verified source/artifact
38b3891f is unchanged; only delivery documentation follows. No GitHub merge, publication,
deployment or activation occurs. Review/merge and release/accountable gates remain;
D1/D3 stay In progress and hosted checks are not monitored.
