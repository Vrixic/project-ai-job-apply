# D3 original resume launch and packet attachment — 2026-10-07

D3-064/D3-079 and D1 remain In progress. This backend batch is local
implementation on `feat/d3-native-resume-generation-ledger`, based on `96a50e81`.
No deployment, managed activation, main merge, new PR or hosted CI/CD work occurred.

## Implemented path

Private scalar preparation client → numeric private Lambda → Documents original reservation
and launch claim → dedicated resume ECS launch → scalar verified-ready reference → Applications
packet attachment under the same SQL transaction → current-packet resume location endpoint.
The ready producer is the native resume runtime from the preceding batch. This batch's SQL
fixtures simulate ECS responses and the ready receipt; they do not run that container in AWS.

Reservation replay does not redispatch an unknown RunTask acknowledgement. Original known-task
recovery remains separate from launch and never asserts task death. Completion and recovery can
operate with new launches disabled. Attachment checks the active owner, exact original packet,
job context, admission epoch, base source, ready generation and fixed expiry. The digest requires
explicit candidate review; it does not invent Profile fact IDs. Repeated completion returns the
same packet. A narrow packet classification fix preserves that digest when its exact temporary
material reference supplies provenance.

The additive OpenAPI v1 resume location route returns only existing scalar location metadata.
No migration, frontend edit or activation is included. The private control builder is implemented
but its clean-source artifact build has not yet run.

## Local verification

- Real PostgreSQL 16.6: 41 cases passed, including private client/handler/actual SQL composition,
  one launch, completion after launch disablement, idempotent attachment, lost acknowledgements,
  wrong image refusal, changed job/revision/source/admission denial and transaction lock fences.
  Log: `.tmp/d3-native-resume-control-sql.log`.
- Private client/handler unit checks: seven passed. Secret resolution, Lambda transport and AWS
  execution identity are synthetic. Log: `.tmp/d3-native-resume-control-unit.log`.
- Six emitted control capability checks passed, including the existing cover-letter launcher
  after extraction of its shared policy. Log: `.tmp/d3-native-resume-control-bundle.log`.
- Earlier checks of this same batch: Documents launch/location 60 passed; Applications packet/
  location 42 passed; Gateway 236 passed and three existing skips. Logs:
  `.tmp/d3-native-resume-launch-documents-unit.log`,
  `.tmp/d3-native-resume-launch-applications-unit.log`,
  `.tmp/d3-native-resume-launch-gateway-unit.log`.
- Documents and Workflows compile. Changed-file formatting and lint pass. Full frozen-source
  verification and final contract-generation verification remain pending for the connected batch.

## Next work

Wire the actual Prepare request/durable caller to the private control and retain its original
scope through readiness polling and completion. Then exercise the connected flow and add only
regressions justified by failures or important boundaries. Built resume image, managed IAM/TLS/
routing, client and ATS upload integration, and accountable launch acceptance remain. ADR-040
remains Proposed. Local scalar/SQL checks do not establish a working deployed Prepare flow.

The owner requested implementation in connected batches, followed by smoke tests, fixes and
focused regression tests; avoid full verification after each small plumbing change. CI/CD is
deferred until production launch. Previously accepted sign-in, unfiltered search, Profile and
save/reload checks remain accepted; preference writes and resume import remain unverified.
The owned temporary SQL fixture was removed after label verification, shared volumes retained,
and Docker Desktop/WSL stopped. The PC remains on.

## Durable caller follow-up

The dedicated resume durable workflow now checkpoints the original scalar reservation, retries
only that identical request, and polls completion using the returned original allocation/epoch.
Only a validated ready packet is success. Fifteen bounded completion attempts leave unresolved
work on exhaustion; there is no compensating launch, renewal or task-death assertion. Its private
Lambda is default-off, pins numeric same-account control/self versions and preserves the SDK
continuation envelope. The separate artifact recipe is added, but has not been built on frozen
source yet.

Seven actual local AWS durable SDK runner cases pass: checkpoint replay with pending readiness,
original start retry, foreign/body-bearing response refusal, bounded exhaustion, invalid input
and default-off/numeric qualification. Activities are synthetic in this suite; the preceding
41-case PostgreSQL suite covers the actual control/attachment separately. These are complementary
checks, not a combined deployed workflow test. Workflows builds; seven emitted capability cases
now pass, including the durable bundle. Logs: `.tmp/d3-native-resume-durable-test.log`,
`.tmp/d3-native-resume-durable-build.log`, `.tmp/d3-native-resume-control-bundle.log`.

Prepare request integration is still unfinished. Source inspection identifies `createPacket`'s
owning transaction as the producer boundary. Its existing lifecycle outbox accepts only status
and submitted events; the existing preparation outbox requires cover-letter provider consent.
Resume requests need their own atomic queue identity and owner-checked source/context capture,
then a dispatcher feeding this workflow. Do not reuse cover-letter consent or enqueue only
after the packet commit. Implement that connected producer/dispatcher next; no human action is
needed for the remaining local work.

## Atomic Prepare producer and scheduled dispatcher

The Gateway now has a default-off `NATIVE_RESUME_PREPARATION_ENABLED` switch, additionally gated
by restricted-packet protection. In that mode it queues native work instead of invoking the legacy
resume recomputation client. Applications writes the exact new packet and one resume request to
its existing outbox in the same transaction as the idempotency receipt. Only `createPacket`
emits the request; native completion does not recursively enqueue another generation.

Applications migration `0010_native_resume_requests` adds the private event type, packet FK and
immutable numeric workflow binding to that outbox. It adds no relation or content storage.
Existing candidate deletion handles the outbox before packets. The restore manifest now requires
72 migrations, 93 relations, 12 schemas and seven owners. Forward migration and replay both pass.
Migration image packaging and restore checks are updated to that exact inventory; no migration
image was built or applied to a managed environment.

The private scheduled consumer claims at most five eligible requests per invocation, checks the
current owner/packet/revision and Jobs context, and has Documents capture the original parsed
source metadata. Generation identity is the immutable outbox event ID. Capture commits before
named durable invocation; delivery retries retain the original numeric workflow and reservation.
No eligible source completes delivery without launching a task. Unknown invocation outcomes retain
the lease; dispatch is bounded by the existing outbox attempt policy. Dispatcher configuration is
default-off under `NATIVE_RESUME_REQUEST_DISPATCH_ENABLED`, with managed database secret, fixed
same-account numeric workflow ARN and reviewed ECS deployment metadata. No source object or
rendered content enters its input/output; its result contains counts only.

Local evidence: all 46 PostgreSQL cases pass, including atomic queue/receipt rollback, idempotent
Prepare, concurrent one-winner claim, immutable packet/workflow bindings, original reservation
capture, and the actual scheduled runtime with normal and held source. Jobs/Applications/Documents
SQL is real; Lambda delivery, ECS and generated-ready receipts remain synthetic in their respective
fixtures. These tests do not claim a combined managed or browser end-to-end run. Eight emitted
capability checks, 50 restore tests, 20 event tests and 236 Gateway tests pass (three existing
Gateway skips). Applications, Documents, Workflows and Gateway compile after correcting optional
Gateway flag typing. Logs: `.tmp/d3-native-resume-queue-sql.log`, `...-restore.log`, `...-events.log`,
`...-gateway-test.log`, `.tmp/d3-native-resume-control-bundle.log`.

The source-bound migration operator check must run after commit because it reads `git show HEAD`;
its pre-commit failure correctly sees the prior migration list. Full frozen-source verification,
artifact builds, combined workflow/SQL smoke, resume image conformance, managed schedule/IAM/TLS/
routing and client/ATS acceptance remain. Current source is not production activation. Temporary
SQL fixtures are removed; Docker/WSL stopped, shared volumes retained and PC on. Continue toward
the full D1/D3 scope with CI/CD deferred to production launch.

Migration publisher/package guards and all 179 production runtime package-smoke cases pass.
Staging restore operator checks also pass. The new schema is packaged with its exact checksum;
this remains local packaging verification, not a published migration image. Changed-file lint,
formatting and diff checks pass. Development web is temporarily stopped for frozen-source full
verification and will be restored after that process finishes. PC shutdown remains forbidden.


## Built-image smoke and fixes after connected implementation

The clean `0af30d5d` batch built all three private Lambda artifacts and the actual Linux/amd64
resume image (`sha256:ff38e1c23c370a7788277b8cd5bf218a246fdcabf44806321a6f0299a7ac029e`).
The image verified its source/file hashes, native canvas/kernel ABI, UID 65532, read-only
filesystem and default-off refusal with networking disabled. It did not exercise the enabled
source/TLS/render/ready flow or managed infrastructure.

The real blocked-event-loop smoke exposed a launch defect: Node running as container PID 1
remained alive beyond the armed 150 ms kernel deadline and required manual SIGKILL. That manual
exit 137 is not successful deadline evidence. The same image with Docker `--init` exited 137
automatically in 1322 ms including startup. Both native launch paths now require ECS
`linuxParameters.initProcessEnabled: true`; missing/false values are refused before claiming.
Logs/receipts: `.tmp/d3-native-resume-image-build.log`,
`.tmp/d3-native-resume-image-check.json`, `.tmp/d3-native-resume-pid1-failure.json`,
`.tmp/d3-native-resume-init-check.json`.

The frozen-source verifier passed operational guards, formatting, lint and all 38 typecheck
tasks, then stopped on the restore manifest's stale compiled checksum (37 of 39 workspace tasks
succeeded; Gateway was interrupted). The manifest source was correct; its constant, PowerShell
validation and generated synthetic fixture now use the actual SHA-256
`6862c5d379bd77557b2b5987615cbaa8d3f1cc28ee2e3b643384305f3c71b0cf`.
Focused checks pass: 59 launch/control units, 214 restore/durable units, 697 PowerShell assertions,
46 real PostgreSQL resume cases and 25 real PostgreSQL cover-letter cases. The cover-letter suite
initially hit a cluster-wide reader-role grant from the preceding resume database; rerunning on
its own disposable PostgreSQL cluster passed. No production policy was weakened for that fixture.
Cloud/identity transports and generated-ready receipts remain synthetic in those SQL suites.
Logs: `.tmp/d3-native-resume-init-unit.log`, `.tmp/d3-native-resume-init-restore-unit.log`,
`.tmp/d3-native-resume-init-restore-powershell.log`, `.tmp/d3-native-resume-init-sql.log`,
`.tmp/d3-native-cover-init-isolated-sql.log`, `.tmp/d3-native-resume-launch-full.log`.

Private artifacts built before the init fix are superseded and must be rebuilt on corrected
frozen source. Workspace tests/builds and remaining maintained verifier stages follow this fix.
D1/D3 remain In progress; managed activation and full combined-flow acceptance remain outstanding.
CI/CD stays deferred until launch. No new PR, main merge or cloud deployment is authorized in this
stretch. The PC stays on.
