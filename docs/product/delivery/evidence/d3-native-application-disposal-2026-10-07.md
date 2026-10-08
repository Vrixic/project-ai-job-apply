# Native terminal application disposal — 2026-10-07

Backend source implementation, default-off. No cloud publication, deployment, activation or
managed ECS acceptance is claimed. D1/D3 remain In progress.

## Behavior

Both Gateway entry points compose Documents-owned disposal after Applications completes its
owner-scoped cancellation or submission mutation. Cleanup seals the shared application epoch
before remote work. Unclaimed pending cover-letter and resume allocations become abandoned;
claimed unknown launches remain unresolved. Bound tasks require the original deployment and a
positive stopped-task observation before retirement and final exact-epoch confirmation.
StopTask acknowledgement alone does not prove disposal. A retry can complete unresolved cleanup.

The retained deployment allowlist limits runtime effects. IAM, permissions boundary and private
ECS endpoint grant only DescribeTasks/StopTask on retained cluster task prefixes to the Gateway.
The independent switch defaults off; rollout must retain older deployments until drained.

Documents migration 0016 adds the no-launch cover-letter tombstone and restores scalar allocation
metadata omitted by a previous candidate-export replacement. It retains resume generation and
cover-letter readiness metadata without exporting task deployment, work grants or generated text.
Apply the additive migration before enabling the runtime. Rollback should disable the switch and
retain the migration and deployment authority needed to drain existing tasks.

## Local evidence

- Fresh PostgreSQL 16.14: 42 Gateway registry and 68 resume ledger cases pass. This includes
  unclaimed abandonment, claimed-unknown refusal, late binding, retirement and retry. ECS replies
  are synthetic; this is real SQL evidence, not managed task acceptance.
- Gateway configuration/composition/availability/dispatch: 24 focused tests pass.
- Documents disposal: 16 tests pass, including retained-deployment refusal and snapshotting.
- Applications terminal/read behavior: 32 tests pass.
- Database migration/restore verifier: 50 tests pass.
- Terraform mocked plans: 14 platform and five bootstrap cases pass.
- All 38 workspace typecheck tasks pass.
- Migration release guard: 275 synthetic assertions pass.
- Exact migration publisher/runtime smoke: 187 tests pass.
- Deletion replay: 697 PowerShell assertions and 299 workflow tests pass.
- Development/staging Terraform validation and repository formatting pass.
- Committed runtime `3c3d3646`: Gateway build, exact-source migration operator path/baseline
  and schema-7/schema-8 adversarial checks pass; release guards repeat successfully.
- New disposal files lint clean. The repository lint run had zero errors; its one added test
  non-null assertion warning was fixed and checked, leaving the prior warnings outside this batch.

Local logs: `.tmp/native-disposal-{registry-fixed,resume-fixed,gateway-tests,application-tests,
migration-tests,platform-tf,bootstrap-tf,typecheck,release-tests}.log`.

## Remaining release work

Migration source inventory is now 76 migrations / 93 relations. Previous qualified images and
Gateway artifacts must be refreshed; the prior 75-migration image does not cover this migration.
Packaging source smoke passes; rebuilding and running the actual image remains release work. The existing full-repository
verifier remains limited by its port-3000 session fixture conflict with the running development
server. Combined real database/native approval, live original-task cleanup, managed recovery and
client/ATS acceptance remain separate unfinished requirements. CI/CD is deferred to production
launch by the owner. Docker/WSL are stopped; PC stays on.


## Refreshed Gateway artifact

From clean `18698f7f3232e6b3c626069f8057ddab1c496302`, Gateway dependency compilation and the
Lambda artifact builder pass. Independent inspection verifies the ZIP bytes/SHA256/base64,
embedded source marker, bundled index hash, checksum companion and SBOM hash/component count.
`gateway-lambda.zip`: 1,675,518 bytes,
SHA256 `80014c84e1d10e430e8d39f406fa9b49cd8c3a1062d2c6a39e9ca6e4af4b795f`,
158 SBOM components. Logs: `.tmp/native-disposal-gateway-release-build.log` and
`.tmp/native-disposal-gateway-artifact.log`. This is one local build/integrity check, not hosted
Lambda acceptance, vulnerability clearance or reproducibility. Nothing was published.
The current [76-migration image also executes successfully](d1-migration-image-boundary-2026-10-06.md#current-76-migration-image-execution).

## Cleanup independent of read availability (2026-10-08)

Inspection found the Gateway composed native terminal disposal only when a temporary-material
reader was also supplied. A release disabling reads while retaining cleanup would therefore
drop cleanup. A cancelled application without a ready packet could return success without
calling the enabled disposer; a packet with temporary references instead stayed unavailable.

`createApplicationsRuntime` now composes the cleanup port independently. A disposal-only
composition refuses material availability. Existing owner-scoped terminal mutation and
idempotency semantics are unchanged; no logout hook, new route, migration or cloud switch was added.

Gateway and dependency compilation pass. Seven real PostgreSQL integration cases pass,
including two new cases exercising the actual composed Applications runtime without a reader:
both a cleanup refusal and a thrown cleanup error propagate as unavailable after the cancellation
commits. Replaying the original cancellation retries cleanup and succeeds without a second
revision change. The cases intentionally have no ready packet, covering in-flight preparation.
Cleanup task responses are synthetic; SQL mutation/replay is real. The existing 24 focused Gateway
configuration, availability, dispatch and entry-point composition cases also pass. Changed-file
formatting/lint and `git diff --check` pass.

Logs: `.tmp/native-disposal-independent-{build,sql,tests}.log`. The disposable PostgreSQL
fixture was removed, Docker Desktop/WSL stopped, and the PC remains on. No fresh managed or
browser acceptance is claimed. The earlier Gateway ZIP predates this fix; rebuild it in the
release packaging batch. D1/D3 remain In progress, with logout integration and managed/client
acceptance still unfinished. CI/CD remains deferred.

## Original preparation launch admission (2026-10-08)

The existing application-status check alone could admit a new native cover-letter allocation or
consume its first launch claim after the original preparation had failed, while the application
remained in review. This would undermine a future logout withdrawal of queued preparation.

Applications now supplies a launch-only owning check for the exact owner/application/preparation,
claimed running state, original packet/revision and unexpired disclosure. Documents executes it
on the same allocation/first-launch-claim transaction, retaining the owning locks until commit.
All three production registry compositions supply this check. Existing launch receipts and
positive task recovery remain separate; this check does not authorize a replacement launch.
No new public API, migration, generation authority or cloud activation is added.

Workflow/dependency compilation and changed-file formatting/lint pass. Local evidence:

- 28 real PostgreSQL Applications preparation tests pass, now also checking launch admission
  before claim and refusal after expiry, future approval, failure, revision or packet changes.
- 27 connected native-launch PostgreSQL tests pass. Two new cases withdraw the original
  preparation before allocation or after allocation but before launch, leave the application
  in review, and verify zero RunTask calls. Existing original recovery, routing, attachment
  and observed-retirement cases remain covered.
- 51 focused launch/route-control runtime cases pass.

One intermediate launcher run failed because the updated synthetic fixture shortened the original
consent expiry. Restoring its exact preparation expiry makes all 27 cases pass; production
consent validation was preserved. Logs: `.tmp/native-original-preparation-{build,applications,
launch,launch-final,unit,typecheck}.log`. SQL is real; AWS, provider and KMS transports are synthetic.

This is a backend prerequisite, not completed logout cleanup. The owner-wide withdrawal operation,
original task retirement, queued-resume handling and web sign-out hook still need integration.
The web-hook scope question remains pending. Existing packaged private runtimes predate this fix
and require refresh in the final packaging batch. D1/D3 remain In progress; nothing deployed.
Final Workflow typecheck and whitespace checks pass. The owned database container was removed;
Docker Desktop and WSL stopped after verification. The PC remains on.


## Owner withdrawal admission cutoff (2026-10-08)

Applications now owns an immutable, replayable owner withdrawal receipt. A new request waits for
existing preparation mutations before recording its database timestamp, fails older queued/running
cover-letter preparations once, and leaves application revision, submission status and attempts
unchanged. Replays retain the original cutoff; another owner cannot reuse the request identity.
Older preparation bootstrap/launch admission and resume packet admission refuse. Resume outbox
selection and direct claim exclude withdrawn requests without inventing an execution receipt.
Application material reads refuse references completed at or before the owner's cutoff.

This private port defaults off and is not yet composed into an authenticated logout operation.
It does not seal Documents generations, revoke routes, stop tasks or certify all-copy disposal.
Concurrent work already admitted still requires the pending owner cleanup coordinator and positive
original-task retirement. The frontend sign-out hook remains outside the authorized backend scope.

Applications migration 0013 adds identifier/timestamp-only receipts and includes them in authorized
candidate deletion. The source restore inventory is now 77 migrations, 94 relations, seven owners
and 12 schemas. Manifest, replay contract, image recipe and source guards agree. Previously retained
76-migration images/recovery results remain historical; no new image or managed release is claimed.

Local validation: Applications build/typecheck, 398 unit tests, 31 real PostgreSQL preparation tests,
nine real PostgreSQL resume admission/delivery tests, 50 restore-manifest tests, 189 executable
migration smoke cases, publisher OCI guards and 697 deletion-replay boundary checks pass. The SQL
cases include concurrent replay, foreign-owner refusal, immutable/direct-delete refusal, guarded
candidate deletion and queue discovery/direct-claim refusal. SQL is local synthetic PostgreSQL;
no browser, managed authentication, provider, AWS or production acceptance is claimed.

An intermediate restore test run exposed historical fixture relations inheriting the new table;
the fixture now excludes it with its migration and all 50 tests pass. The source-bound migration
operator tests also pass against committed source `66b7b248`, including schema-8 and schema-7
round-trip/adversarial checks. They read git HEAD, so the pre-commit run correctly rejected the
then-older committed migration boundary.
Logs: `.tmp/native-withdrawal-{build-final,typecheck,unit-final,resume-final,migrations-final,
runtime-smoke,publisher,deletion-replay}.log` and `.tmp-native-withdrawal-integration.log`.
D1/D3 remain In progress. CI/CD stays deferred; no cloud publication, deployment or activation.

The owned PostgreSQL container was removed after SQL verification. Docker Desktop and WSL were
stopped; no WSL distribution remained running. The PC remains on.


## Bounded owner cleanup orchestration (2026-10-08)

The Gateway private runtime now composes Applications withdrawal with Documents inventory and exact
native task retirement. The step is separately default-off, processes at most five applications,
returns a pagination cursor, and rechecks durable outstanding inventory before returning
`native_tasks_settled`. Claimed/unbound tasks remain pending for original launch recovery; a failure
on one application does not prevent the rest of the page from being attempted. No public route,
authenticated request handler, durable retry scheduler or web sign-out hook is added in this batch.

Native Applications admission now takes a shared owner advisory lock; withdrawal takes the matching
exclusive lock. Previously admitted reservation transactions finish before the withdrawal is stamped,
and later old preparation fails its cutoff check. Documents rechecks cutoff eligibility under the
original application admission lock before sealing, so later explicit generations survive old replay.
The private withdrawal receipt carries the database epoch in microseconds as a decimal string to avoid
rounding adjacent generations into the same millisecond. There is no new migration or public contract.
Existing terminal application disposal retains its behavior and exact deployment allowlist.

Local evidence: Gateway/dependency builds and final Gateway typecheck pass; 398 Applications unit,
16 disposal unit, 12 Gateway configuration/orchestration, 40 Applications PostgreSQL and 70 connected
Documents PostgreSQL cases pass. New SQL evidence exercises actual owner withdrawal, bounded inventory,
sealing, persisted positive task retirement and replay without a second task request, while preserving
application revision/status. A generation one microsecond newer than a supplied cutoff remains
unsealed and launchable. The owner admission test also proves withdrawal's exclusive lock cannot be
acquired while the admission transaction is live. Remote task/provider/AWS transports are synthetic.

Initial verification found a missing pagination parameter and a test optional-property typing error;
both were fixed before final builds. Reusing the first disposable database exposed existing global
execution receipts to three suite cases. Those failures showed earlier-run IDs; rerunning against a
fresh database in the same owned container passed all 70 cases. This suite requires a fresh database.
Logs: `.tmp/native-owner-cleanup-{build,app-build-final,doc-build-final,gateway-build-final,typecheck,
app-tests,disposal-tests,gateway-tests-final,admission-sql,sql-fresh}.log`.

Authenticated backend initiation and durable continuation/recovery still need integration; web-hook
scope remains pending. No deployment, image refresh, managed acceptance or all-copy disposal is claimed.
D1/D3 remain In progress. CI/CD remains deferred and the PC stays on.

Final changed-file formatting and whitespace checks pass. The owned PostgreSQL container was removed; Docker Desktop and WSL stopped after SQL verification. The PC remains on.


## Authenticated withdrawal and durable continuation (2026-10-08)

The local HTTP path is now connected: `PUT /v1/material-withdrawals/{requestId}` resolves the
`applications:write` owner, validates the UUIDv7 path and absence of body/query, and atomically
commits withdrawal plus cleanup queue entry. Repeated requests preserve the original cutoff and
status. `GET` requires `applications:read`, is owner-scoped and returns 404 for another owner.
The additive v1 response exposes request ID, timestamp and pending/native-task-settled state only;
all responses are no-store and operational errors are fixed/sanitized. Both normal Gateway and
Lambda composition include the default-off port; the Lambda adapter rejects bodies and wrong routes.

Applications 0014 adds the leased identifier-only queue and backfills existing withdrawals. Claims
use SKIP LOCKED, a unique token and a five-minute lease. A valid original lease alone may advance
the page cursor or record immutable settlement. Exhausted pages back off 30 seconds; a crash or
expired lease is retryable. Candidate deletion removes queue rows before receipts. A private numeric
Lambda entry accepts exactly schemaVersion 1/action drain, resolves the managed secret and processes
one claim. Its authority is IAM; no caller owner/task fields are accepted. It reads the accepted
original receipt rather than requiring fresh candidate activity, allowing cleanup after quarantine.
No public API invokes task I/O inline.

The source migration/restore boundary is 78 migrations, 95 relations, seven owners and 12 schemas.
Manifest SHA-256: `5d6caf504bfdfc13a96a932062bd948df805340251e05f68a5b8d4aa4aef50a1`.
The Docker recipe, publisher guard, replay contract and fixtures match it. Prior 76-migration images
and recovery evidence remain historical; there is no new image or deployment in this batch.

Validation: 105 API contract tests, 138 focused Gateway/HTTP/Lambda/worker/composition cases, 32
Applications PostgreSQL cases and one connected Gateway/PostgreSQL case pass. Queue SQL proves one
concurrent claim, expired/replaced lease refusal, cursor continuation, immutable completion/replay
and authorized deletion. Connected HTTP uses synthetic signed authentication with actual owning SQL:
accept/replay returns pending, worker completes after owner quarantine, subsequent run is idle and
GET returns settled. No native allocation exists in this connected case, so it performs no AWS task
I/O; prior bounded-cleanup evidence covers persisted positive native retirement with simulated AWS.

Gateway/dependency builds, final Gateway typecheck and all 38 workspace typecheck tasks pass. Contract
regeneration is stable. All 50 restore-manifest, 191 executable migration smoke and 697 deletion-replay
boundary checks pass, as do publisher OCI guards and changed-file formatting/whitespace checks.
The source-bound migration operator guard runs after commit because it reads git HEAD. An initial
Gateway build found a missing exception import; it was fixed before successful build/typechecks.
Logs: `.tmp/native-cleanup-{queue-gateway-build,contract-tests,queue-http,queue-sql,connected-sql,
gateway-final,adapter-final,typecheck,workspace-typecheck,manifest-tests,replay-tests,migration-smoke,
publisher}.log`. The isolated PostgreSQL container was removed; Docker Desktop and WSL stopped.

This proves backend source behavior, not live logout. Worker packaging, schedule/IAM deployment,
managed recovery/drain acceptance and the web sign-out hook remain. ADR-040 remains Proposed; no
all-copy disposal, production clearance or phase completion is claimed. CI/CD deferred; PC on.

The source-bound migration operator guard passes against committed source `02726ccf`, including
schema-8 two-receipt and schema-7 migration/Gateway round-trip adversarial checks. Log:
`.tmp/native-cleanup-operator-final.log`.


## Cleanup worker release composition (2026-10-08)

The standalone builder emits a source-bound Node 24 ZIP, checksum, manifest and CycloneDX inventory
and checks the bundled handler refuses execution by default. Terraform composes an optional immutable
release in development/staging, private concurrency-one Lambda with a 240-second timeout beneath the
five-minute SQL lease, and numeric-version minute schedule. Runtime and schedule remain off by default.
API activation requires an enabled worker/schedule retaining every Gateway disposal deployment.

Permissions scope task observation/stop to retained clusters and managed-secret access to the database.
Private ECS/Secrets endpoints include the exact worker principal. The role explicitly denies launch,
interactive execution, S3, role passing, Lambda invocation and secret writes. Bootstrap boundary task
authority is scoped to the exact worker principal and clusters. Execution/delivery alarms use the
existing operations topic; no queue-age monitoring is claimed.

Local Terraform 1.16.2 validates bootstrap/development/staging. Mock-provider tests pass 26 unique
cases: 15 Gateway, six worker and five private-network cases. Gateway/dependency builds and changed
script/config Biome checks pass. Logs: `.tmp/native-cleanup-tf-tests-windows.log`,
`.tmp/native-cleanup-tf-gateway-final.log`, `.tmp/native-cleanup-tf-{development,staging,bootstrap}.log`
and `.tmp/native-cleanup-package-build.log`. Exact-source artifact verification follows this commit.
No AWS calls, publication, plan/apply, migration or managed acceptance occurred. Web hookup remains
outside backend scope. D1/D3 remain In progress; CI/CD deferred, Docker/WSL stopped and PC on.


Exact clean source `9d0c681d29fa6e914a82388e5cffb66c8485344d` builds the worker ZIP successfully:
404,464 bytes, 34 SBOM components, SHA-256
`ed5c3aac907795abbe18ef723fc3356640705b749c5ba1c48a4b278d1c74e8ab`.
The build invokes the actual bundled handler and confirms default-off refusal. Independent checks
verify source commit, ZIP's sole index.mjs entry, archive size/SHA/base64 SHA, bundle digest/source
marker, checksum companion and SBOM digest/component count. Log: `.tmp/native-cleanup-artifact.log`.
The artifact is local only; source provenance does not imply deployment or live acceptance.


2026-10-08 adds the guarded `NativeMaterialCleanup` publisher family: one worker/four immutable
companions, dedicated key/output/receipt roots, Gateway test gate and two deterministic builds.
Existing main, audit, bucket, checksum and exact-version receipt guards remain. Pure operator tests
pass, including mixed-case family selection and incomplete/foreign receipt rejection; no cloud calls.
The package command and release ordering are documented. Exact-source package qualification follows.
Publication/deployment and managed acceptance remain; D1/D3 In progress, CI/CD deferred and PC on.


## Qualified cleanup publisher and refreshed Gateway (2026-10-08)

Clean source `101aa9e19ed854b2c54e279525f571c3ebc41cf5` passes the full cleanup package command,
including Gateway/dependency compilation. The actual publisher's extracted pure Get-ArtifactSet
validates the artifact, and Get-ArtifactFingerprint confirms all four companions reproduce exactly
across a second bundle build. Both builds invoke the bundled default-off refusal assertion.

- Cleanup ZIP: 404,463 bytes, 34 components, SHA-256
  `26b7da69a2a34465c94f85b75115a14ea459940163d789ad99f0a3685cfe1950`.
- Refreshed Gateway ZIP: 1,679,031 bytes, 158 components, SHA-256
  `f842d6323af8d67df1ae669069912bdf3097f6fa9ef18f77a91f366e90880233`.

Independent checks pass for both source bindings, sole ZIP entry, byte count, archive digest,
bundle digest and SBOM digest/component count. This Gateway supersedes the local `18698f7f`
package for withdrawal/cleanup source coverage; it is not deployed or a fresh live journey result.
Logs: `.tmp/native-cleanup-publisher-build-one.log` and
`.tmp/native-cleanup-publisher-qualification.log`. Publisher pure guard tests also pass, including
all existing families and cleanup receipt rejection. The live Publish action, its dependency audit,
remote main/account/bucket checks and cloud version readback were not executed. No audit waiver.
Current 78-migration image/recovery, managed acceptance and web hookup remain outstanding.


## Combined backend verification and remaining release gates (2026-10-08)

At clean `118dbffd`, the full Gateway command `pnpm --filter @ai-job-apply/gateway test` passes
31 files/376 tests; seven integration files/116 tests are explicitly skipped. This verifies the
combined ordinary Gateway suite, not a new SQL or live managed run. Existing SQL/image/restore
results above retain their stated scope. Log: `.tmp/gateway-combined-118dbffd.log`.

Source review follows worker database-secret access through its role, the shared Secrets endpoint,
bootstrap workload ceiling and platform KMS IAM delegation, and follows task observation/stop through
worker role, exact cluster endpoint policy and bootstrap principal-scoped ceiling. No additional
source correction was identified. This is not effective-policy simulation against deployed AWS.

The centralized dependency audit still exits 1. A fresh production registry report contains
13 records (one critical, seven high, four moderate, one low), with reported paths under mobile/admin.
Raw image-size records must be interpreted with the maintained local remediation checks; raw registry
counts alone are not a patch disposition. Logs: `.tmp/dependency-launch-review-118dbffd.{log,json}`.
No dependency change or release waiver was made in this backend-only batch.

Backend source/package/recovery progress does not close D1/D3. The current session excludes cloud
publication/activation and new PR/main changes. Managed native journey additionally needs exact
DNS/TLS/domain and provider bindings, accepted migration/runtime releases and web sign-out hookup
(scope still pending). Preserve the accepted sign-in/search/Profile/save/manual-Apply results;
do not reopen those tests. Accountable real-data/provider/security/accessibility acceptance and
applicable authorized ATS fixtures remain separate exit criteria. Docker/WSL remain stopped; PC on.


## Read-only development release planning (2026-10-08)

The owner authorized read-only AWS inspection and planning. STS matches the configured development
account and assumed role in us-east-2. S3 expected-bucket-owner verifies the existing state boundary.
The current platform state is serial 404, written by Terraform 1.16.2, with 324 resource records.
Live Gateway alias reads version 86 without weighted routing. Health/live and health/ready return
200. The regional metric-alarm query returns no ALARM entries. These checks do not exercise
candidate-authenticated journeys or assert that every resource is healthy.

The retained zero-change baseline `baseline-03114165c0a5-20261001-201651.tfplan` supplies 111 inputs.
After refreshing the local module/provider cache, Terraform 1.16.2 uses the exact encrypted S3
backend, platform.tfstate key, us-east-2 region, KMS binding and enabled S3 lockfile. Backend guards
pass. A normal refresh-backed plan against source `213cec80` completes with detailed exit code 2:
zero resource changes, five newly exposed empty native-release outputs. No runtime flags or release
inputs were changed. This is a compatibility baseline, not a populated native deployment plan.

Saved local plan: `.tmp/development-planning-baseline-213cec80.tfplan`.
SHA-256: `6a6473248363835886b04fab4e7929be4d2b7659b856a0d4b060dc9dc506011e`.
Logs and private JSON remain under ignored `.tmp/development-planning-*`; state/plan content,
account/bucket/key identifiers and secret metadata are not copied into shared evidence.
The before/after state bytes match exactly and serial remains 404. No apply, publication, migration,
activation, secret-value retrieval or production action occurred. An initial CLI quoting error and
missing cached modules were corrected locally before the successful plan.

Observed release prerequisites: no development native-prefixed Lambda functions; no Route 53 hosted
zones in this account; no us-east-2 ACM certificate entries; no native/TLS-labelled secret metadata;
and ECR contains only the migration repository. Naming checks do not prove the absence of a usable
secret under another name, and ACM is not substituted for the runtime's versioned TLS secret.

The next native rollout must be staged:
1. Resolve download hostname/DNS ownership and exact provider/TLS secret bindings. The DNS question
   remains pending; do not invent a hosted zone or copy candidate/provider secrets into Terraform.
2. Prepare immutable native image repository/publication and numeric owner/control/source releases,
   including exact bootstrap ceilings and private network permissions. Existing source alone has not
   created these managed resources. Preserve the running Gateway and existing triggers.
3. Bind original task revisions and preparation/recovery releases, then the cleanup release and
   schedule. Retain every original deployment while work remains unresolved.
4. Release the verified 78-migration image and current Gateway through the existing guarded process;
   publication still requires accepted source/artifacts and dependency disposition. The current raw
   dependency audit failure is not waived by the zero-resource baseline plan.
5. Enable only the reviewed development slice, verify authenticated preparation/approval/retirement
   and recovery, then connect the separately scoped web sign-out hook. Already accepted basic/manual
   checks need not be repeated. Production and accountable acceptance remain separate.

A fully populated applyable native rollout plan cannot yet be produced from available bindings.
D1/D3 remain In progress. Planning permission is resolved; missing release inputs, not that old
permission question, are the current planning dependencies. Docker/WSL stayed stopped; PC on.


## Native image repository prerequisite (2026-10-08)

Live inspection found only the migration ECR repository. Added a default-off development/staging
input creating the exact native-material/native-resume image repositories, using platform KMS,
immutable tags, push scans and force deletion disabled. No automatic image expiry is configured,
so retained original task digests are not removed by an unrelated cleanup policy. Existing task
execution roles already scope pull authority to their supplied exact repository under the bootstrap
ai-job-apply namespace ceiling; this change adds no role or runtime authority.
Two mocked Terraform cases pass: default absence and enabled encrypted/scanned storage without
cleanup runtime activation. Log: `.tmp/native-repositories-tests.log`. The real saved development
plan follows committed source; no repository has been created or image published by this work.


The refresh-backed development plan from clean source `f9653438` completes under Terraform 1.16.2
with the existing encrypted/KMS-bound S3 backend and lockfile. Saved artifact:
`.tmp/native-repositories-development.tfplan`, SHA-256
`1d16736583830970390785bce8c99173e5836ecd415d89ce89cd9a99f93b641a`.
Inspection of the saved binary plan proves exactly two resource creates:
`module.platform.aws_ecr_repository.native_material["native-material"]` and
`module.platform.aws_ecr_repository.native_material["native-resume"]`. No updates, replacements
or deletions; all 111 prior baseline inputs are unchanged. Both resources have immutable tags,
KMS encryption, push scanning and force deletion false. Only the new repository opt-in is supplied.
The real plan validates development; staging validates locally. State remains byte-identical at
serial 404 after planning. No repository/image/task/runtime mutation occurred.
Log: `.tmp/native-repositories-development-plan.log`; local test/validation logs use the
`.tmp/native-repositories-` prefix. Applying this concrete storage-only plan requires separate
owner authorization; current permission covers inspection/planning only. D1/D3 remain In progress.


## Approved native image storage applied (2026-10-08)

The owner explicitly approved the two-repository plan. Before applying, exact plan SHA-256
`1d16736583830970390785bce8c99173e5836ecd415d89ce89cd9a99f93b641a`, clean checkout,
unchanged Terraform/toolchain source since `f9653438`, development STS/account, backend KMS/account,
encryption/lockfile and byte-identical reviewed state were verified. The saved plan still contained
only the two expected ECR creates. Terraform 1.16.2 applied that saved artifact once: two added,
zero changed, zero destroyed. Platform state advanced 404 to 405.

Live ECR readback confirms both native repositories are empty, immutable, scanned on push and
bound to the exact platform KMS key. Gateway stays on unweighted version 86; health/live and
health/ready both return 200. An initial readback script assumed an optional RoutingConfig property;
its missing-property error was corrected to accept the actual unweighted response, then checks
completed successfully. The apply itself succeeded without retry.

A fresh refresh-backed saved plan returns exit 0, no resource changes, with repositories enabled.
Verification plan `.tmp/native-repositories-development-verify.tfplan` SHA-256:
`19231a155524b2a838587f34aa0f834afdea3d5535ee89a738d0c6f18cfaa8c2`.
The full post-apply input baseline is preserved privately in
`.tmp/development-planning-current-405.tfvars.json`; subsequent plans must retain the true repository
gate instead of using the earlier 404 input set by itself. Receipt:
`.tmp/native-repositories-apply-verification.json`. Apply/verify logs use the matching
`.tmp/native-repositories-development-` prefix. Do not reapply the consumed creation plan.

This completes development image storage only. No images were published, no native tasks/functions
or triggers activated, and no migration/application release or staging change occurred. Rollback
would require a separately reviewed plan; repositories are deliberately retained for the next
release stage. DNS/TLS/provider bindings, image/artifact release and managed journey acceptance
remain. D1/D3 are In progress; CI/CD deferred, Docker/WSL stopped and PC on.


## Next publication prerequisites after storage (2026-10-08)

Both native Dockerfiles default NATIVE_CONFIGURATION to their committed configuration.disabled.json.
Those configurations contain enabled=false and synthetic account/task/function/secret/origin/host
bindings. The previously verified default-off images therefore cannot be treated as configured
managed runtime releases. Before enabled images are built, retain published original numeric owner
(and resume-source) functions, reviewed provider/TLS secret version references, exact task revision,
API/issuer/audience/client origin and download host. Rebuilding with those bindings is necessary;
retagging a disabled image does not supply runtime authority. No new build or publication ran here.

The retained 2026-10-08 production audit report identifies registry fixes for source-map-js >=1.2.2,
sharp >=0.35.5, shell-quote >=1.11.0 and Next >=16.3.8. It reports no patched range for node-forge
1.4.0 or braces 3.0.3 (the registry's <0.0.0 sentinel); compatible remediation needs investigation.
These are report contents, not a verified upgrade plan or a current upstream-release guarantee.
The two image-size records remain subject to the existing installed-tree remediation checks.
Affected paths are admin/mobile. Targeted dependency-remediation scope was requested because the
current backend-only instruction excludes those paths. No dependency, audit rule or risk waiver was
changed. The pending DNS/hostname and web-hook decisions remain independent. Storage is deployed;
artifacts/native runtime activation and D1/D3 acceptance are not complete.


## Released dependency fixes (2026-10-08)

The owner's instruction to proceed with recommendations resolves the targeted dependency-scope
question. Updated web/admin Next 16.3.6 to 16.3.8, its sharp override to 0.35.5, and added narrow
shell-quote 1.11.0 and source-map-js 1.2.2 overrides. Regenerated and installed the pnpm 10.24.0
lockfile. No application logic, audit acceptance rule, local image-size patch or cloud runtime changed.

Local verification on the development worktree based on df13d74b: all five selected build tasks
(web/admin/mobile and dependencies) pass; dependency-security tests pass 142/142. An initial test
run alongside builds hit two admin fork startup timeouts. After builds finished, the sequential
client run passed all 174 admin, 750 web and three mobile tests (71 files), with no worker errors.
Manifest formatting and git diff whitespace checks pass. Web tests emitted jsdom navigation/canvas
limitations; these are simulated unit/component checks, not signed-in browser acceptance.
Browser-control execution tooling is unavailable in this session; no live UI verification is claimed
and the already accepted owner sign-in/search/Profile/save/manual-Apply checks are not reopened.

Fresh raw production audit reports four high findings, down from thirteen total: the two existing
image-size records covered by the verified local remediation, plus node-forge and braces. No critical,
moderate or low records remain in this production report. The central release audit still exits 1;
its policy has not been weakened. Further compatible remediation is needed for node-forge/braces.
Logs: .tmp/dependency-fixes-builds.log, .tmp/dependency-fixes-tests-sequential.log,
.tmp/dependency-fixes-security-tests.log, .tmp/dependency-fixes-final-audit.json and
.tmp/dependency-fixes-central-audit.log. These are local results, not hosted CI or a deployed release.
D1/D3 remain In progress. CI/CD remains deferred; no Docker/WSL start or PC shutdown occurred.


## Node-forge Node runtime backport (2026-10-08)

Backported the lib/rsa.js change from the still-open upstream
[forge PR 1152](https://github.com/digitalbazaar/forge/pull/1152), commit ceba344.
The nested DigestAlgorithm sequence must contain exactly the OID and optional NULL, matching
what the ASN.1 validator consumed. Extra children are rejected before digest comparison.
The package remains node-forge 1.4.0; this is a local pnpm patch, not an upstream fixed release.
Patch SHA-256: 4fa957cddb4b4601a48b535053d0fec7ed013f9d075660a38365f285fc830fe0.
Both Expo dependency edges in the lockfile resolve the patched snapshot. The change targets the
Node lib entry used by Expo; prebuilt browser bundles are not changed or claimed remediated.

The new maintained node-forge-security.test.mjs uses ephemeral 2048-bit RSA keys and actual
Node crypto signing/forge verification, with exponents 3/65537 and SHA-256/384/512. It checks
normal signatures, wrong digests, optional NULL compatibility, extra children after OID/NULL,
duplicate NULL, nested sequence garbage and the existing outer-sequence rejection. It does not
claim to construct a forgery without a private key. Before patching, 24 malformed-input assertions
failed and 24 controls passed. After resolving/installing the patch, all 48 pass. The initial
patch-commit wrote metadata but did not update the installed tree; the regression remained red
until a normal non-frozen install regenerated the lockfile and installed the patched snapshot.
A subsequent frozen install passes. Full maintained dependency-security suite: 190/190 pass;
mobile unit tests: 3/3 pass; mobile TypeScript build passes. No Docker needed.
Logs: .tmp/node-forge-before-patch.log, .tmp/node-forge-after-patch.log,
.tmp/node-forge-frozen-install.log and .tmp/node-forge-security-suite.log.

Audit recognition is deliberately unchanged: no advisory is waived based only on a patch label.
Braces remediation and exact installed-tree/advisory verification remain necessary before the
central release audit can pass. No browser, cloud publication or managed acceptance performed.
D1/D3 remain In progress; CI/CD deferred and PC on.
