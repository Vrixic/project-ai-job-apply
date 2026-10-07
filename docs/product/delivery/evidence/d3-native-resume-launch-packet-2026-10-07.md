# D3 original resume launch and packet attachment â€” 2026-10-07

D3-064/D3-079 and D1 remain In progress. This backend batch is local
implementation on `feat/d3-native-resume-generation-ledger`, based on `96a50e81`.
No deployment, managed activation, main merge, new PR or hosted CI/CD work occurred.

## Implemented path

Private scalar preparation client â†’ numeric private Lambda â†’ Documents original reservation
and launch claim â†’ dedicated resume ECS launch â†’ scalar verified-ready reference â†’ Applications
packet attachment under the same SQL transaction â†’ current-packet resume location endpoint.
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


## Segmented verification and corrected artifact receipts

Corrected runtime source `12c58461c332f4bfb49e3a621764fac205ad7f08` passes formatting,
the existing lint baseline, all 38 typecheck tasks, all 39 workspace test tasks and all 23 build
tasks. Subsequent bundle checks found one stale expected file inventory after extracting the
shared launch policy. Test-only `ff17d209` adds that exact module; all remaining maintained
isolation, Compose and product-scope checks then pass. This is segmented verification, not one
uninterrupted full-verifier pass. Logs: `.tmp/d3-native-init-remainder.log` and
`.tmp/d3-native-init-isolation.log`. Runtime source did not change in the inventory correction.

All three private artifacts rebuilt successfully from clean `12c58461`, including their bundled
default-off checks. No artifact was published or deployed:

| Artifact | ZIP SHA-256 | Bytes |
| --- | --- | ---: |
| Resume preparation control | `2c13c359d50e5c6616747a81f7f947b7e3b820037a7ef7e3f0ab8e8faeabc150` | 381539 |
| Resume preparation durable | `dced2f2d22efc7f3311810fa46a7b09de488f704d6f7f1be1f36c62ad76aef9b` | 265662 |
| Resume request dispatcher | `9dc197a829056daaac55898b1b86e4099fd794d79c049de36a177dbcf99de28c` | 515678 |

Logs: `.tmp/d3-native-resume-init-control-artifact.log`,
`.tmp/d3-native-resume-init-durable-artifact.log`, `.tmp/d3-native-resume-init-dispatch-artifact.log`.
Both owned disposable SQL fixtures were removed after use; Docker Desktop and WSL stopped,
shared volumes retained and PC on. User-accepted sign-in/search/Profile/save-reload checks are
preserved; this backend batch adds no new signed-in browser or managed acceptance claim.

Next connected work remains the combined durable-to-SQL-to-ready flow and enabled-image
source/render/direct-read smoke, followed by managed routing/IAM/schedule and client/ATS acceptance.
Also assess explicit terminal handling for exhausted resume queue delivery attempts; current
bounded dispatch does not itself prove those requests are surfaced as failed. D1/D3 remain
In progress and ADR-040 Proposed. CI/CD remains deferred until production launch.

Development web restored after verification: anonymous `/` returns 200 and `/resume` returns 307. No new signed-in acceptance is claimed.


## Delivery exhaustion and combined local durable/SQL flow

Resume request dispatch now closes expired fifth delivery attempts in the existing Applications
outbox as `failed`/`lease_expired`, preserving the original packet/workflow binding and attempt
count. A bounded `FOR UPDATE SKIP LOCKED` sweep runs before scheduled dispatch and returns a
`deliveryFailed` count. It leaves live leases, earlier attempts and unrelated event types alone,
and includes superseded packets so stale requests cannot remain processing forever. This is an
internal delivery outcome, not proof of workflow failure, task death, content destruction or a
new candidate-visible status. It never starts a replacement generation.

The connected local smoke now runs Prepare -> actual SQL outbox/source capture -> actual local
AWS durable SDK -> owning SQL preparation/one ECS launch -> pending readiness -> ready attachment
-> delivery receipt. It proves one launch, polling, review-required resume attachment and no
second launch on dispatch replay. Lambda delivery, ECS responses and the generated-ready receipt
remain simulated; this is not actual rendering, managed cloud or browser acceptance.

All 48 PostgreSQL 16.6 cases pass on a fresh disposable cluster, including concurrent exhaustion
sweepers and the combined flow. The first combined attempt found a fixture clock mismatch:
durable skip-time advances Date.now beyond PostgreSQL's clock, so the synthetic readiness receipt
now uses owning SQL time. A reused-database run encountered old pending test requests; the clean
run removes that cross-run interference without weakening production checks. All eight emitted
launch/control isolation cases pass. Applications, Documents and Workflows compile; changed-file
Biome checks and git diff checks pass. Logs: `.tmp/d3-resume-recovery-fresh-sql.log`,
`.tmp/d3-resume-recovery-bundle.log`, `.tmp/d3-resume-recovery-lint.log` and
`.tmp/d3-resume-recovery-{app,doc,workflow}-build.log`.

Validation is focused on this change, following the owner's implement/smoke/fix/regression
cadence. The preceding full segmented repository verification remains historical evidence;
this follow-up does not claim a new full-verifier run. Enabled-image source/render/direct-read,
managed routing/IAM/schedule, client/ATS and accountable launch gates remain. D1/D3 stay
In progress; ADR-040 Proposed. CI/CD deferred until production launch, PC shutdown forbidden.


Corrected dispatcher artifact built from clean `4cded260f81eaffb5480932d4c5aac46f3c16026`:
ZIP SHA-256 `26dc90e4c567cbd17eebcec79e1a0bd0dc2d2c83be1f08016fd1c925e7390e22`,
515891 bytes, 30 components; bundled default-off refusal passes. No publication/deployment.
Log: `.tmp/d3-resume-recovery-dispatch-artifact.log`. Owned SQL fixture removed; Docker Desktop
and WSL stopped, shared volumes retained. Development web remains available (anonymous root 200).


## Complete native resume publication path

The existing guarded publisher now selects `NativeResume` as a separate five-artifact/twenty-file
family: owner RPC, retained-source RPC, preparation control, durable preparation and dispatcher.
All five existing builders emit under the dedicated Workflows `dist/native-resume-lambda` root,
and one package command builds the full dependency closure and artifact set. Publication uses
separate operator/receipt/S3 key roots and inherits the existing clean-main, source marker,
checksum/SBOM, dependency audit, two-build, KMS and immutable-write guards. It cannot enable
functions, schedules or task routing. No cloud action is run by this implementation.

The local publisher guard suite passes, including case-insensitive NativeResume selection and
rejection of incomplete, duplicated or mixed twenty-object receipts. Existing document and private
control families retain their exact roots/inventories. Five-artifact actual build/readback checks
follow on committed source. This closes release packaging only; enabled-image conformance and
managed/client/ATS/accountable acceptance remain. D1/D3 stay In progress and ADR-040 Proposed.


The full package build passes on clean `5690191d71dea1e7ee93a1efeeb34e30b4845209`, including its dependency
compilation and all five bundled default-off checks. The existing publisher's actual local
artifact readers accept all twenty ZIP/manifest/SBOM/checksum files and exact source markers.
A second emission of all five artifacts matches every companion-file fingerprint. This proves
local reproducibility/readback, not cloud publication, dependency-audit currency or managed
release acceptance. Logs: `.tmp/d3-resume-publication-build.log`,
`.tmp/d3-resume-publication-readback.log`; scalar receipt:
`.tmp/d3-resume-publication-local-receipt.json`.

| Artifact | ZIP SHA-256 | Bytes |
| --- | --- | ---: |
| native-resume-owner-rpc-lambda | `ce87c90e1f26c57f105278d69d05d0e3afdd84370c7c20f04d799a96695129b7` | 158277 |
| native-resume-source-rpc-lambda | `63de5566dc1413e8cf25d9b9d0353bfae86b2b0b07a878cedd367c1f534b0b92` | 393567 |
| native-resume-preparation-control-lambda | `04f913da95f4e157bb7469f9ee99e14f124a34ca871ba37fd53f37f0fd5f511d` | 381537 |
| native-resume-preparation-durable-lambda | `c5a68d38e3705b1e6ccdba126c839bbc9cf6d5eb15e08a54470833eb3b90e465` | 265659 |
| native-resume-request-dispatch-lambda | `02bb145a718f7c365cec55d4a5f10923292378bfaf8632160d7430d8b37fbf3d` | 515890 |

No Docker runtime or cloud call was needed. Existing development web remains running; PC stays on.


## Actual built-image render/read/deadline smoke

The maintained `scripts/verify-native-resume-image.mjs` harness now loads the actual image-owned
runtime bundle and native kernel, verifies its manifest/source/file hashes and uses the existing
synthetic connected read fixture. Image
`sha256:ff38e1c23c370a7788277b8cd5bf218a246fdcabf44806321a6f0299a7ac029e`, built from
`0af30d5d334f3df6af9d80f3dfd345915eeaa160`, passes all 23 runtime assertions and renders both actual
PDF and DOCX files. It serves valid authenticated TLS responses with current-packet checks,
rejects foreign/unscoped/forged tokens, malformed routes/origins, TLS 1.2 and revoked packets,
and exercises bounded pending reads. The image bundle and kernel are unmodified.

Container execution uses init, UID 65532, read-only root, no network, dropped capabilities,
no-new-privileges, core dumps disabled, 512 MiB memory and a 64-process limit. The native five-second
test deadline exits 137 in 6605 ms including startup; Docker confirms `OOMKilled=false`, and the
host fallback is not used. The original reference remains exactly 1800000 ms from completion to
expiry. No unexpected diagnostic output is permitted. Log: `.tmp/d3-resume-built-image-smoke.log`.

The fixture explicitly overrides the entrypoint and uses NODE_ENV=test with synthetic AWS,
metadata, secret, identity, source and owner ports. It proves the built bundle's render/read/
deadline behavior under container restrictions, not enabled production main, live cloud transport
or managed/client/ATS acceptance. These distinctions remain release gates rather than inferred
success from local tests. No image is published or deployed. The owned containers and staging
files are removed; shared images/volumes retained. Docker/WSL stopped after the check, PC on.


## Source-only native task/IAM release module

`infrastructure/terraform/modules/native-resume-task` adds the actual Fargate task-definition and
dedicated task/execution-role resources without composing them into either environment. Null
release produces no resources. Exact release metadata pins image digest, original task revision,
two numeric RPC recipients, one TLS secret/version and its customer key. The generated container
matches the existing owning launch validator: init, Linux/x86-64, UID65532, read-only root, dropped
capabilities, zero core limit, no content-bearing environment/logs/volumes or sidecar. Task IAM
has only pinned RPC/TLS access plus explicit content-storage/logging/remote-exec/database denials;
execution IAM has only ECR pull access. Existing environment boundaries remain in place.

Role names are revision-qualified so later environment composition can retain original releases.
Task definitions use skip_destroy, and removal of old IAM instances still requires explicit drain
handling; this module is not a kill switch. A postcondition rejects a registered revision differing
from image-owned configuration, after registration; it is not rollback. These limitations are
spelled out in the module README. No environment, role, task or cloud state was changed.

Terraform 1.16.2 local validation and five mocked cases cover absent defaults, envelope/policies,
foreign account/environment and mismatched revision. The actual emitted Terraform container/task
shape is also accepted by the compiled Documents launch-policy validator with a synthetic ECS
observation. Logs: `.tmp/d3-native-resume-task-validate.log`,
`.tmp/d3-native-resume-task-tests-json.log`, `.tmp/d3-native-resume-task-launch-check.log`.
Managed effective IAM, exact release composition, network/TLS/DNS, enabled main and client/ATS/
accountable acceptance remain. ADR-040 remains Proposed; D1/D3 remain In progress.


## Source-only private owner/source release module

`infrastructure/terraform/modules/native-resume-source-access` supplies the two versioned private
RPC functions required before image configuration can pin numeric recipients. A null release
creates nothing; a supplied release keeps handlers off by default. Immutable artifact versions,
original task/role binding, database secret, key, extension and private network are explicit.
Separate execution roles keep S3 unavailable to owner RPC and permit only retained normalized
resume version reads for source RPC. Neither role can launch tasks or write resume objects.

Terraform 1.16.2 validation and all five mocked tests pass: absence, disabled/versioned pair,
explicit activation, foreign target refusal and activation without a release. Logs:
`.tmp/d3-native-resume-source-validate.log` and `.tmp/d3-native-resume-source-tests.log`.
Environment names match inspected handler sources; enabled handler execution and effective
managed IAM/network access have not been verified by this module check.

The module README records release order, original-version retention and required existing
network/resource policies. Changing the gate publishes new versions rather than disabling old
numeric versions. No environment composition or cloud action occurred. Preparation control,
durable/dispatcher composition and managed routing/acceptance remain. D1/D3 remain In progress,
ADR-040 Proposed, CI/CD deferred until launch, Docker/WSL stopped and PC on.


## Connected preparation release sources

`infrastructure/terraform/modules/native-resume-preparation` composes the existing three private
artifacts: owning control, durable workflow and Applications outbox dispatcher. Control pins the
original task/image/network/role envelope. Durable pins its numeric control version; dispatcher
pins the numeric durable version. The disabled one-minute event rule invokes the numeric
dispatcher with a scalar sweep. Runtime, launch and schedule switches default off. Each role has
separate capabilities, and durable receives no database secret or candidate-object access.

The Terraform-owned CloudFormation durable resource follows the existing platform pattern for
customer-key encryption of checkpoints; version replacement includes the complete environment
hash. SQL queue claims and exhaustion remain in the existing application runtime. The module
creates no replacement queue, public route, content storage or direct task invocation.

Terraform 1.16.2 validates; six mocked cases pass for absence, complete wiring/permissions,
disabled defaults, separated activation and rejected targets. The actual compiled Documents
launch validator accepts the emitted configuration, and dispatcher deployment fields match.
Logs: `.tmp/d3-native-resume-preparation-validate.log`,
`.tmp/d3-native-resume-preparation-tests.log`, `.tmp/d3-native-resume-preparation-tests-json.log`
and `.tmp/d3-native-resume-preparation-check.log`. Cloud observations/versions are synthetic;
this is not enabled runtime or managed end-to-end verification.

Both environment compositions and bootstrap are unchanged. The current workload boundary lacks
native control RunTask/PassRole permissions; deployment-role CloudFormation scope also needs a
reviewed delta. Network/TLS routing, effective policies, original-version drain and managed/client/
ATS/accountable acceptance remain. The module README records immutable-version gate semantics.
No publication, deployment, activation or Docker use. D1/D3 In progress and ADR-040 Proposed;
CI/CD remains deferred until launch and PC on.


## Original-control bootstrap permission sources

The optional bootstrap `native_resume_control_releases` map now supplies a dedicated boundary
for each original control revision. Every statement matches the exact control principal; launch
is limited to the original task definition/cluster, recovery to that cluster's tasks and PassRole
to the two original task roles through ECS. Only exact owning secret/key access and existing
log/VPC operations accompany it. The shared workload boundary gains no launch or PassRole action.
The preparation module selects this dedicated boundary only for control.

Deployment-role policy source permits creation of that exact control role with its exact boundary,
read-only inspection of that boundary and management of the original durable stack. Empty input
adds no policies or permissions. No GitHub workflow, CI/CD job or cloud resource was changed.
Original release entries must remain until trusted drain. A size precondition rejects oversized
combined deployment policies rather than silently dropping original permissions.

Terraform 1.16.2 validation and seven bootstrap tests pass, including four pre-existing cases,
default absence, original scope/size and foreign-secret rejection. The six preparation tests
also pass with the exact dedicated boundary check. Log: `.tmp/d3-native-resume-boundary-tests.log`.
All providers are mocked for tests; no effective managed permission or deployment is established.
Both environment inputs remain unchanged. Actual bootstrap/module application, private routing,
managed end-to-end and accountable acceptance remain; D1/D3 In progress and ADR-040 Proposed.


## Explicit task network choice

Reviewing the image's direct browser HTTPS contract found a mismatch in preparation Terraform:
it forced `assignPublicIp = DISABLED` without supplying a browser-accessible private route.
The module now requires an explicit `task_assign_public_ip` release value and preserves it in
launch configuration. ENABLED is not activation or routing proof; public subnet/ingress, DNS,
trusted certificate and allocation-specific route lifecycle still require implementation.

Eight mocked Terraform cases pass, including explicit public choice with scheduling still off
and unknown mode rejection. Actual compiled Documents configuration validation accepts both
emitted network choices. Logs: `.tmp/d3-native-resume-preparation-tests.log` and
`.tmp/d3-native-resume-network-choice-check.log`. No cloud/network change was performed.
A development DNS-zone question is pending; no hostname or certificate has been assumed.
D1/D3 remain In progress; no browser-download or managed acceptance claim follows from this fix.


## Optional development/staging environment composition

Both environment roots now expose separate source-access, task and preparation release maps.
Each defaults empty, preserves its exact module input and returns scalar bindings for review.
The platform exposes actual account identity for child validation. Separate stages let private
RPC numeric versions exist before image configuration pins them; no existing image or original
recipient is silently retargeted. Runtime/launch/schedule switches retain disabled defaults.

Both environment AWS lock entries move from 6.57.1 to the native modules' tested 6.58.0 with its
locked checksums. Backend-disabled initialization and Terraform 1.16.2 validation pass for both
roots. Three mocked cases per environment prove empty defaults, original source binding without
runtime creation, and explicit matching task/preparation inputs without source recreation.
Logs: `.tmp/d3-native-resume-env-development-validate.log`,
`.tmp/d3-native-resume-env-staging-validate.log`,
`.tmp/d3-native-resume-env-development-tests.log` and
`.tmp/d3-native-resume-env-staging-tests.log`.

No environment input, remote state, cloud permission or resource was changed. This establishes
source composition, not managed planning, deployment or activation. The DNS-zone question remains
pending, and DNS/TLS/ingress/route lifecycle plus effective IAM and managed/client/ATS/accountable
acceptance remain open. D1/D3 remain In progress; ADR-040 Proposed and CI/CD deferred.


## Positive resume task observation composition

The existing resume SQL store could record a trusted terminal receipt, but no composition called
it from the task observer. `native-resume-task-observer.ts` now reads the original claimed
allocation/configuration, validates owner/application/generation/epoch/deployment bindings,
observes that exact task and passes only the resulting positive receipt to `recordRetirement`.
Callers cannot supply a task ARN or receipt. Already-recorded retirement returns without
requiring ECS to retain the stopped task, including replay after a lost persistence ACK.

The shared task retirement adapter gains `observe`, which uses the same exact DescribeTasks
validation as retirement but never enters the StopTask branch. Existing `retire` behavior remains.
This helper does not request cancellation, create a generation, settle a workflow or certify
all-copy deletion. Source remains default-off and is not yet composed into a managed receiver.

57 focused tests pass across the existing adapter and nine observer cases: exact stopped evidence,
stored replay, running/missing/error refusal, changed configuration, default-off, lost persistence
ACK and withdrawal before writing. Documents typecheck/build and changed-file Biome pass. These
checks use simulated ECS/registry ports; no new SQL migration, real database fixture or managed
evidence was produced. The private receiver/artifact/IAM/schedule and SQL-connected acceptance
remain follow-up work, alongside DNS/TLS/routing. No cloud action or Docker use.


## Private resume observer Lambda source

`native-resume-task-observer-lambda.ts` lazily composes the original SQL registry and observer
behind a separate default-off gate and exact numeric invocation target. The only request is
`{schemaVersion:1, action:"observe", scope}`; caller task ARNs/receipts/extra fields/accessors are
rejected. Managed database-secret resolution follows validation. No creation owner ports are
supplied to the registry, and the returned runtime exposes only observe/close.

Eleven bootstrap tests exercise lazy reuse, disabled/unqualified/foreign/ambient/secret refusal,
forged inputs, invocation mismatch, initialization retry, configuration drift and withdrawal.
Workflows typecheck/build and changed-file Biome pass. Database and observer ports are simulated
in these tests. The standalone builder targets `dist/native-resume-observer-lambda` and checks
default-off refusal in the emitted bundle; frozen-source artifact execution follows separately.
The existing five-artifact native resume publisher family is unchanged. A private release/IAM/
event or scheduled receiver, connected SQL acceptance and managed execution remain unfinished.
No cloud action, provider call, public route or content handling is introduced.


The standalone observer artifact builder subsequently passes from clean committed `c862e288`
with matching `ARTIFACT_SOURCE_SHA`, including actual emitted-bundle default-off refusal for
valid scope and forged task/receipt inputs. ZIP `native-resume-task-observer-lambda.zip` is 369857
bytes with SHA-256 `330feeb77478f3770311f1724a94b1137886ab914f4f32533afa7195b0104bd8` and 30
inventory components. Log: `.tmp/d3-native-resume-observer-artifact.log`. This is local artifact
verification, not a fresh dependency audit, publication or enabled managed runtime test.


## Real SQL observer acceptance and connection fix

The new integration exercises the actual compiled observer Lambda/runtime and owning PostgreSQL
ledger, with only managed-secret resolution and ECS transport simulated. It found that the
bootstrap used Profile's camelCase-transforming database helper while Documents expects raw SQL
column names. The bootstrap now uses `createApplicationsDatabase`, matching existing raw ledger
compositions. The earlier artifact's default-off success did not cover this enabled path.

Three new cases prove running-task refusal leaves the ledger bound, a positive exact stopped task
persists retirement after admission is sealed, a lost returned ACK replays the persisted result
without relying on ECS retention, fresh explicit generation admission follows the retired epoch,
and an unbound original allocation never consults ECS. The fixture now uses the actual synthetic
stop instant rather than subtracting 100 ms, which could falsely predate task creation.

All 51 ledger integration cases pass on a fresh disposable PostgreSQL 16.6 instance, including
migration replay and the previous connected preparation tests. Eleven bootstrap units, Documents
typecheck, Workflows build and changed-file Biome pass. Log:
`.tmp/d3-native-resume-observer-sql.log`. The owned tmpfs fixture was removed; shared volumes were
untouched and Docker/WSL shutdown requested. No actual AWS stop/describe, managed invocation,
secret read or cloud deployment occurred. Enabled managed acceptance and receiver routing remain.


Corrected artifact built from clean `59a82593` with matching source SHA passes emitted-bundle
refusal checks. ZIP SHA-256 `611b833b02072aac300a4f945b43cdf3656603d5216fbc11a7adf47611b48fe0`,
384731 bytes and 30 inventory components, supersedes the earlier `c862e288` observer artifact.
Log: `.tmp/d3-native-resume-observer-artifact.log`. Docker Desktop shutdown and WSL shutdown
completed; PC stays on. No publication or deployment.


## Observer joins the maintained release family

NativeResume now includes owner RPC, source RPC, preparation control, durable preparation,
request dispatch and task observation: six ZIP/manifest/SBOM/checksum sets, twenty-four objects.
The observer builder shares the dedicated native-resume output directory; its individual build
command remains available. Existing publication source/audit/KMS/versioning guards and separate
family/key/receipt roots remain. The old five-artifact receipt is intentionally rejected.

Publisher local guard tests pass, including case variants, complete inventory and old/mixed/
duplicate/incomplete receipt refusal. Changed JavaScript/package formatting passes. Log:
`.tmp/d3-resume-observer-publication-guards.log`. The actual clean-source family build and
publisher readback/repeat emission follow. No Publish/Verify cloud action, IAM, schedule or
activation is performed by this change.


The full six-artifact family subsequently builds from clean `d0c036dd65243b86fe17d4044e33f24b3a17343b`. Actual publisher
`Get-ArtifactSet` validates all twenty-four local files and source markers; a second emission
has the identical complete fingerprint. All bundle refusal checks pass. Logs:
`.tmp/d3-resume-observer-family-build.log`, `.tmp/d3-resume-observer-family-readback.log`;
local receipt `.tmp/d3-resume-publication-local-receipt.json`. No cloud calls, fresh dependency-audit
claim, publication, deployment or activation. Current source-bound ZIP inventory:

| Artifact | SHA-256 | Bytes |
|---|---|---|
| native-resume-owner-rpc-lambda | `7287666711ca2bdc86f4da7a3baf64175eeca87d1ef34c0f7b90eed54bab7b14` | 158278 |
| native-resume-source-rpc-lambda | `bcc50613ec7c7531434434b38c3007428e6dfb6baa2ba024ead80ee56602a642` | 393570 |
| native-resume-preparation-control-lambda | `a7f11982fb72e2b0ac237659ae554d3ff9fbc962f881dd7a430e532890ef6f2a` | 381538 |
| native-resume-preparation-durable-lambda | `915f5236b9325cfb7bf53ff6cf2ba2d6879f61a5d01c02410ff6f0fd3a43d96c` | 265661 |
| native-resume-request-dispatch-lambda | `7ed548fb7bb6960b24a02a1b1663494fbd14d921c51479777fb97249ea2944d3` | 515891 |
| native-resume-task-observer-lambda | `9892beea70ecf77347ef9ae5c8e56ac0f35e796961a18a51af0561f16e3ea8bb` | 384729 |


## Stopped-event input to private observer

The observer Lambda now accepts an inert bounded ECS Task State Change STOPPED envelope as an
alternative to the strict private observe request. Parsing checks account/region, cluster,
original task definition, task/resource ARN, Fargate envelope, six exact launch overrides and
configuration digest. Accessors, duplicate/extra overrides and foreign/configuration drift are
rejected before secret resolution. The resulting scope/task is only a hint: the observer reads
the original SQL allocation, compares the hinted task before ECS access and obtains its own
fresh terminal receipt. Event timestamps/status never become a retirement receipt.

Eighteen Lambda cases and 58 observer/retirement cases pass, including seven event cases and a
foreign-task hint refused before ECS/persistence. Documents and Workflows builds and changed-file
Biome pass. These use synthetic event/ECS/registry fixtures; prior SQL evidence is unchanged.
No EventBridge resource, public endpoint, permissions or trigger was activated. Exact numeric
rule routing, delivery retry/retention, managed IAM and AWS acceptance remain to be composed.


The event-capable observer artifact builds from clean `717c09b0` with matching source SHA and
passes emitted-bundle default-off checks: 386142 bytes, SHA-256
`c7ec6dd82bca4a5b57094eb3a04832684f9cf0a73d1d388a086a09c57ea27e03`. Log:
`.tmp/d3-native-resume-observer-event-artifact.log`. Only the observer was rebuilt in this
checkpoint; the six-artifact family must be rebuilt together at the intended release source.
No complete current-head family, publication or deployment claim is made.


## Observer release wiring

The preparation module now requires four immutable artifacts and creates the numeric observer
alongside control, durable and dispatch. A separately gated, default-disabled EventBridge rule
selects the original cluster/task definition STOPPED events. Observation can continue with new
launches disabled. Bootstrap supplies an original observer boundary without launch, stop or
role-passing grants. Both environment release maps remain empty by default.

EventBridge delivery retries are explicitly 185 attempts/24 hours. Delivery failures and Lambda
asynchronous execution failures reference the required existing same-account standard SQS queue.
The module does not provision its retention, resource policy or key grants. Activation requires
review of rule-scoped EventBridge SendMessage, platform-key Decrypt/GenerateDataKey permissions,
restricted replay access and failure monitoring. No scheduled reconciliation or source-event
completeness is proved; delayed/lost events can leave the original allocation unresolved. Event
status alone never authorizes retirement or replacement.

Local Terraform validation passes for bootstrap, preparation, development and staging. All 23
mocked cases pass: 7 bootstrap, 10 preparation and 3 in each environment. Coverage includes
numeric rule recipients, separate observer boundary, both failure targets and observation with
launch disabled. Logs: `.tmp/d3-observer-wiring-boundary.log`,
`.tmp/d3-observer-wiring-preparation.log`, `.tmp/d3-observer-wiring-env-development.log`,
`.tmp/d3-observer-wiring-env-staging.log`. These are synthetic-provider checks, not effective IAM,
queue retention or managed delivery evidence. No publication, deployment or activation occurred.
The current-source six-artifact family still requires rebuilding before publication.


## Observer failure retention

Optional environment composition now derives one platform-owned standard queue per original
preparation revision using the reviewed queue ARN. Duplicate queues are refused. Queues retain
messages fourteen days, use the environment platform key and deny insecure transport. A key
precondition rejects a release targeting a different key; deletion is protected. Rule-scoped
EventBridge SendMessage and KMS grants preserve original recipients. Existing observer IAM
supplies Lambda failure-delivery permission. Three alarms route queue depth, EventBridge failed
DLQ delivery and Lambda DeadLetterErrors to the existing operational topic. Preparation depends
on platform completion. Empty maps remain inert; no operator replay permissions are added.

Two platform mocked tests cover retention/encryption, rule/TLS policies, key-policy source scope,
alerts and empty defaults. Three tests in each environment pass, with Terraform validation.
Logs: `.tmp/d3-observer-queue-platform.log`, `.tmp/d3-observer-queue-development.log`,
`.tmp/d3-observer-queue-staging.log`. Initial fixture failures (synthetic SNS ARN and set/list
assertion mismatch) were corrected before final pass. No AWS calls or managed proof occurred.
Actual policy evaluation, alert receipt and authorized replay still require release acceptance.
The README records replay against the original numeric observer and explicit unresolved handling
when fresh terminal evidence is unavailable. This queue cannot recover missing source events.


## Consistent six-artifact release checkpoint

The NativeResume package command already compiles Workflows and its workspace dependencies before
packaging; it does not share the audit command's prior compilation omission. The complete family
now builds from clean `15185a12b525cf5fa4186ead9986d93432212411`, including the event-capable observer. All bundled
refusal checks pass. The actual publisher's local reader validates the 24 ZIP/manifest/SBOM/
checksum files and source markers; a second emission has the identical full fingerprint.

| Artifact | ZIP SHA-256 | Bytes |
|---|---|---|
| native-resume-owner-rpc-lambda | `b39ff7f576eaca43f3493fe54181e5af829110ba54a16860da3ad9df3dce50ca` | 158279 |
| native-resume-source-rpc-lambda | `7e1ce26c4828b24ed691751bbaef337f82fdd8625ead24d89353832c017fffaa` | 393571 |
| native-resume-preparation-control-lambda | `c255eaa7fb936f78463c82808a57fa7541c8fd94995ff968dc788b4d38cb76c7` | 381538 |
| native-resume-preparation-durable-lambda | `f3a7c1a92a059edb606d70c1e61c97c2a8af8317addd08de141c3e17a8d436f8` | 265662 |
| native-resume-request-dispatch-lambda | `301ecbd9878359bb1782a2ba2e912f4fadfac48010200aaf41c454a6f378278c` | 515893 |
| native-resume-task-observer-lambda | `8e25e090b2c0ac963e888eb239ec710a98dc1882b4d36e4f48bfab4f588290a1` | 386140 |

Logs: `.tmp/d3-resume-current-family-build.log`, `.tmp/d3-resume-current-family-readback.log`;
local receipt `.tmp/d3-resume-publication-local-receipt.json`. No tracked edits occurred during
build/readback. This replaces the previous mixed local artifact directory as a same-source
candidate; it does not supersede historical receipts or claim a fresh audit/full verifier run.
Zero cloud calls; publication, effective IAM/event delivery, DNS/TLS/browser routing and managed
acceptance remain. D1/D3 stay In progress and ADR-040 stays Proposed.


## Original resume secret endpoint composition

Shared Secrets Manager endpoint composition now derives exact original database-reader role
bindings and task TLS-secret/version bindings from optional environment release inputs. Caller
security groups are explicitly forwarded for TCP443 ingress. The endpoint exists for standalone
native releases when the data plane is active; source/preparation deployment waits for platform
completion. Durable receives no secret binding. Native-only policy generation omits the empty
legacy Lambda-role condition.

Four focused platform cases plus ten existing maintenance cases pass. Development and staging
validate and pass three release-composition cases each. Initial staging testing caught an overly
strict persistent-data prerequisite for disabled source predeployment; disabled dormant staging
is preserved and activation uses the existing staging_runtime_mode gate. Logs:
`.tmp/d3-native-secret-endpoint-platform.log`, `.tmp/d3-native-secret-endpoint-development.log`,
`.tmp/d3-native-secret-endpoint-staging.log`. No AWS apply or secret retrieval occurred.
Lambda RPC/S3 endpoint composition and managed network/TLS/acceptance remain open; source policy
checks alone do not prove effective private access. D1/D3 In progress, ADR-040 Proposed.


## Original resume RPC and normalized-source endpoint composition

The shared Lambda endpoint now accepts only the original task role's two numeric owner/source
RPC targets and the original dispatch role's durable function. Dispatcher endpoint scope uses
that function's qualifier wildcard; existing runtime-role IAM still binds the exact numeric
version. This avoids a platform/Lambda-version dependency cycle without opening other functions
or callers. Shared endpoint ingress uses the reviewed native caller groups already composed.

The existing document S3 endpoint now allows only original source-role GetObjectVersion on the
selected bucket's normalized resume JSON shape. No object write/delete/current-read/list or task
object access is introduced. Source activation requires the existing document endpoint foundation;
disabled predeployment remains permitted. Role/bucket/key policy and runtime owner/version checks
are independent layers and still need managed acceptance.

Three focused mocked cases pass for empty defaults, connected RPC/document policy shape and
alias/foreign-revision refusal. The connected fixture initially omitted the existing Gateway
prerequisite for document intake; it was corrected before passing. Log:
`.tmp/d3-native-rpc-endpoint-platform.log`. Environment and existing serverless regressions follow.
No AWS mutation, artifact publication or runtime activation occurred.


Development/staging validate and pass three release cases each. The existing serverless suite
passes all 51 cases, including document-processing isolation and dormant data-plane guards.
Logs: `.tmp/d3-native-rpc-endpoint-development.log`, `.tmp/d3-native-rpc-endpoint-staging.log`,
`.tmp/d3-native-rpc-serverless.log`. Combined local count is 60 mocked Terraform cases. Live
invocation, key access, DNS/TLS and end-to-end acceptance remain unproved. D1/D3 In progress.


## Original durable checkpoint key

The platform key previously omitted native resume durable functions from its Lambda service grant.
Each retained original revision now gets a separate GenerateDataKey/Decrypt statement constrained
by exact account, unqualified source function ARN and matching function encryption context.
The durable execution role retains exact-key Decrypt through its common policy; its redundant
GenerateDataKey grant is removed. Empty release maps add no service grant.

Two platform and ten preparation mocked Terraform cases pass locally on 2026-10-07. An initial
assertion compared different Terraform collection types; explicit set normalization fixed the
assertion. Logs: `.tmp/d3-native-durable-key-platform.log` and
`.tmp/d3-native-durable-key-preparation.log`. These checks inspect planned policy composition,
not live KMS access. No deployment, publication or runtime activation occurred.


## Bounded recovery of missed stopped-task events

A missed event previously needed manual original-scope observation. The existing private observer
now accepts strict `{schemaVersion:1,action:"sweep"}` input and asks Documents for at most two bound
allocations belonging to its immutable launch-configuration hash. A short SQL transaction uses
SKIP LOCKED and records attempt time before AWS I/O. Attempts rotate oldest-first and become eligible
again after 60 seconds; concurrent sweeps cannot claim the same current attempt. Only existing
fresh exact-task ECS observation records retirement. Unknown/running/error results remain bound;
the sweep returns counts only. Candidate seals do not suppress retirement observation.

Documents migration 0015 adds the operational timestamp/index and preserves original metadata and
terminal guards. The restore inventory advances to 73 migrations/93 relations across 12 schemas and
seven owners; both strict restore validators and synthetic fixture hashes were synchronized.
Original numeric-version one-minute scheduling is independently default-off in both environments.
No launch/stop privilege is added; new launches may remain disabled. Timeout is 60 seconds, event
retry is zero, and failed schedule delivery alerts through the existing topic. Pending allocations
without a known bound task still require original launch recovery. Live routing, AWS observation,
backlog capacity, deployment and phase acceptance remain open; no cloud mutation occurred.

Local validation on 2026-10-07:
- Documents and Workflows compile. 54 real PostgreSQL 16.6 ledger cases pass, including compiled
  private observer recovery with synthetic ECS responses, running-task refusal to retire,
  lease concurrency/cooldown and timestamp guard checks. Migration runners replay twice. The first
  sweep fixture shared another case's configuration; isolating that fixture corrected the test.
- 226 focused observer/restore-contract cases and 50 migration/restore package cases pass.
- Preparation 12, platform observation two, and each environment three mocked Terraform cases
  pass (20 total); both roots validate. No real Terraform plan or apply was performed.
- Staging restore verifier guards, 697 synthetic deletion-replay checks, and release guards pass.
Logs are `.tmp/d3-observer-sweep-{build,sql,unit,restore,terraform,platform,development,staging,
restore-ps,replay-ps,release-ps}.log`. No complete new frozen-source verifier or live acceptance is
claimed. The temporary SQL fixture was removed; Docker/WSL stopped and PC stays on.
