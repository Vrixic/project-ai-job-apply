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


## Braces and verified release audit (2026-10-08)

The local braces 3.0.3 patch adds a fixed 128-level nesting bound before parser stack growth and
inside compile/expand/stringify recursive traversal. It covers parentheses, braces, mixed patterns,
unclosed patterns and direct AST child traversal. Normal ranges, alternatives, escaping, quoting,
deduplication and 128-level balanced nesting remain compatible. The intentional behavior change is
a SyntaxError on excessive nesting; this is not general protection against exponential expansion,
malicious getters or arbitrary parent-pointer graphs supplied as ASTs.
[Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Patch SHA-256: 816530fe94f297f2ae23f1d98d9c4795b4898b9720e81fa900f0a89b84a1d707.

The installed package tests reproduce 43 failing excessive-depth assertions and 13 passing controls
before the patch; all 56 pass afterward. The root maintained security suite now runs 285 passing
checks, including 48 node-forge cases and 39 new installed-remediation/audit cases. The latter
refuse modified patches, installed entrypoints/auxiliary files, lock hashes/edges/snapshots,
unregistered patches, wrong versions/importers/installation locations, unknown or changed CVEs,
advisory IDs, parents, fixed ranges, empty findings, duplicate records, incorrect totals and hidden
suppression configuration. Missing patches also refuse when registry records are absent.

The central audit now verifies full installed node-forge/braces package-tree hashes and all returned
mobile Expo dependency paths, in addition to the existing image-size checks. Only exact reviewed
CVE/GHSA/version/path/range records are recognized after installed-source verification. Actual
Expo CLI and code-signing-certificates source imports the node-forge Node main; no prebuilt browser
bundle remediation is claimed. The raw complete-lockfile report still has four high records.
The central audit passes: four verified source remediations across 20 mobile build paths, zero
registry-omitted records and no risk exceptions. This resolves the local dependency-audit blocker.

Verification: frozen pnpm install, 285 dependency-security checks, three mobile tests, mobile
TypeScript build, scoped Biome and diff whitespace checks pass on the worktree based on 0147f424.
Logs: .tmp/braces-before-patch.log, .tmp/braces-after-patch.log,
.tmp/additional-remediations-tests.log, .tmp/braces-security-suite.log,
.tmp/braces-frozen-install.log and .tmp/braces-central-audit.log. No new UI or hosted CI claim.
No Docker/WSL start, cloud publication, migration or runtime activation. D1/D3 remain In progress;
managed native bindings, runtime release and acceptance remain. PC stays on.


## Current native Lambda release qualification (2026-10-08)

Clean source ca6527cf580d626ee34f98e7da7dfc3cf1a6702e, including the now-passing centralized
dependency remediation gate, builds the full Gateway/Workflows dependency graph successfully.
All four native families were then built twice: three material controls, six resume controls,
four application preparation handlers and one cleanup worker. Their maintained builders execute
bundled handler/default-off refusal checks. The actual publisher Get-ArtifactSet helpers verify
source markers, checksums, manifest identities and CycloneDX format. All 56 companion files
(ZIP, manifest, SBOM and checksum for 14 artifacts) match byte-for-byte across both builds.

The first local qualification attempt omitted ARTIFACT_SOURCE_SHA, so the publisher helper
correctly rejected the resulting sourceSha=local manifests. The temporary harness was corrected
to supply the exact clean commit; both complete qualification passes then succeeded. No validation
was weakened. Independent ZIP inspection verifies the sole index.mjs member, exact bundle hash,
source marker, ZIP hash/byte length, SBOM hash and component count for every artifact.

Receipt .tmp/native-release-ca6527cf-receipt.json SHA-256:
5f4e170528eab53923e5cb8ad22483ce581cf28cbdf25287eaf642e9ba5205f0.
Build and qualification logs: .tmp/native-release-ca6527cf-build.log and
.tmp/native-release-ca6527cf-qualification.log. Artifact ZIP identities:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| native-material-launch-lambda | 620201 | `bae5ee6f83ca101cb5674cfdb3634b290dddf54ebe1d1b51497433ea3f71fa5c` |
| native-owner-rpc-lambda | 371001 | `f991c77bc8609b9e8d7bd249a96e6d488264d4a50c5c602fafea023a63342687` |
| native-material-task-event-lambda | 265068 | `118987e3d6e1a2ee244edb8528f246a0f89950fe6bfdca2f2a0fff0888e4cd60` |
| native-resume-owner-rpc-lambda | 158901 | `f07a489f8124209af0d9a6aa538675d56cf1db132cc6b50bcdc213a12d6abb0f` |
| native-resume-source-rpc-lambda | 432735 | `120b0c48a1df5ddccecddb599ff06062510df7c004fc1f5faa54052f9b0de567` |
| native-resume-preparation-control-lambda | 741648 | `e921aa1c6c4c1b68911754a84f3d525b6cd56454ed7695ba752e033c2a3a1af3` |
| native-resume-preparation-durable-lambda | 421286 | `e77dc888cfd2a66d9c823315411c62b8490506e1ed6c94419e0e68ee43ba6303` |
| native-resume-request-dispatch-lambda | 557123 | `abeea99380a9bc8b7e2ae1228627a7896f5d679c8eac55102b25ed14171aa347` |
| native-resume-task-observer-lambda | 477978 | `3d6d026d300aa380ef64f1ea427b952e18c0cc2031dabfdda673977e90fac023` |
| native-application-preparation-lambda | 679202 | `16a73e832edb83d7c142b91a971fb73ac8dc789fca9c0f7da86b57043ffdd7b0` |
| application-preparation-durable-lambda | 482704 | `3e5050b1d16ebb60060fe1d0254910b9ff38185f7fd5b3d34862e2c4eb8c8a0e` |
| application-preparation-starter-lambda | 440878 | `ca504f1b8df7e55c6fc99d8dad96afbca13b77ec821499ac6f67368f2df4d9f7` |
| application-preparation-recovery-lambda | 454687 | `d71ecf4bffdde3a8a5fbbc030750f915b52e9a2f549d45266fe48475a289e0fe` |
| native-material-cleanup-worker-lambda | 404463 | `6d0151e48b87495bfc1c089e6fca6bd75df7fb864def93687f121dab9622accd` |


Read-only AWS inspection verified the configured development account identity and confirmed both
native ECR repositories remain empty. No cloud objects were written, no images built/published,
no task/functions activated and no migration applied. Docker/WSL remain stopped and PC stays on.

These artifacts are exact branch-source qualifications, not merged-main publication receipts.
The maintained publication operator still requires a clean checkout matching origin/main; this
verification does not bypass that gate or promote the source. Actual download hostname/DNS,
reviewed TLS/provider secret versions, original numeric RPC/task bindings, managed deployment and
journey acceptance remain. The hostname/DNS information question is pending; already accepted
basic/manual user checks are not reopened. D1/D3 remain In progress, ADR-040 Proposed, CI/CD deferred.


## Web sign-out withdrawal hookup (2026-10-08)

Following the owner's direction to proceed with recommendations without routine approval prompts,
implemented the outstanding web sign-out hookup in the isolated worktree. The existing Settings
link and direct /auth/logout navigation now enter a server-only cleanup hook when the default-off
NATIVE_MATERIAL_LOGOUT_ENABLED flag is true. Unchanged login/callback/ordinary-page requests remain
with the Auth0 SDK. Same-origin/direct navigation is allowed; cross-site/same-site or mismatched
origin/referrer requests are refused before owner effects.

The hook reads the existing encrypted server session's access token; it deliberately never refreshes
credentials during sign-out, avoiding refresh work that could race the bounded cleanup and SDK
revocation. It sends a bodyless owner-scoped UUIDv7 withdrawal request, with no caller-provided
principal or target. A generated-contract receipt must match the request ID, success status and JSON
type, fit within 4 KiB and complete within five seconds including session/stream waits. Timeouts,
missing/expired authorization, invalid receipts and backend errors still permit SDK OIDC logout.
The fixed /signed-out notice says requested or unconfirmed, never completed deletion. The display
query is not a trusted disposal receipt. No token, withdrawal ID, candidate content or raw error
enters that notice. Cache/storage clearing is requested via Clear-Site-Data; downloaded files,
other services, open-tab memory and browser support are explicitly outside this local proof.

An initial full-web run exposed an unnecessary build-environment change. The flag is now kept as a
runtime setting and included in the existing test that proves runtime settings do not enter Turbo
build hashes. A test-only Headers iterator type error was corrected without widening compiler
libraries. Final validation: all 781 web tests/62 files pass (31 new hook/routing/notice cases),
35 focused cases pass, Next 16.3.8 production build/typecheck passes, scoped Biome and diff checks
pass. An isolated production Next HTTP server renders requested, unconfirmed and unexpected display
states as uncached pages with the fixed warnings and home link; the fixture server was terminated.

Auth0 and platform responses in hook tests are simulated. The HTTP rendering fixture disables
identity and makes no live API request. Browser-control tooling is unavailable; no browser interaction,
managed Auth0 logout, deployed withdrawal or all-copy erasure claim is made. No repeated owner
sign-in/search/Profile/save/manual-Apply test is requested. Logs: .tmp/native-logout-focused.log,
.tmp/native-logout-web-tests-final.log, .tmp/native-logout-build-final.log and
.tmp/native-logout-http-proof.log. Full repository phase-zero verification was not rerun for this
web-only batch. The runtime flag remains off; deployment requires the accepted withdrawal route,
worker/schedule and Applications scopes. D1/D3 In progress; CI/CD deferred and PC on.


## Combined repository verification (2026-10-08)

The existing full `scripts/verify-phase0.ps1` run completed with exit code zero against
implementation commit `e71aedc6e60c09b22f48532aaa261c6a03ad6255`. Only delivery-document
corrections were uncommitted during the run; executable source and generated contracts remained
unchanged. The terminal output is `Phase 0 repository verification passed.`

All 38 typecheck tasks, 39 test tasks and 23 build tasks passed, including 781 web tests and
285 dependency-security regressions. Terraform/operator, deletion/recovery, candidate-rights
fixture, migration-runtime, artifact-publication, emitted bundle-isolation, Compose configuration
and product-scope checks passed. Lint retains the existing 15 warnings and 58 informational notes,
with no errors. Turbo reused two typecheck-task results and sixteen build-task results; this is
not an all-cold rebuild. The mobile build emits the existing missing-output declaration warning.

Database integration cases were skipped in this verifier: Matching 10, Profile 53, Billing 8,
Gateway 116 and Workflows 123. No database fixture or live managed authentication/API acceptance
was run here. Prior separately recorded SQL/image checks retain their own scope and source.
Docker Desktop's backend and WSL were confirmed stopped after the run; the PC remains on.

Local log: `.tmp/phase0-e71aedc6.log`, SHA-256
`6a1e4f8ce2386046f1289a84c0d47531b680756f052fe3fa1b60c7133a782d62`.
The current D3 task and exit-gate summaries now correctly distinguish the implemented default-off
web hook from outstanding managed acceptance. No cloud publication, migration, activation or
phase completion is claimed. Native hostname/DNS, trusted TLS/provider and numeric runtime
bindings, managed journey and accountable acceptance remain. D1/D3 remain In progress.


## Development download DNS (2026-10-08)

The owner supplied applydash.ai, confirmed Cloudflare Registrar/DNS, and showed its active
registration. Public resolution subsequently returned mack.ns.cloudflare.com and
mia.ns.cloudflare.com. The recommended native base host is materials.dev.applydash.ai.

Added the default-off development-only native_material_dns_enabled input and protected Route 53
zone. Terraform 1.16.2 formatting and development validation pass. After verifying the development
SSO account and locked encrypted platform.tfstate backend, the refresh-backed saved plan contained
exactly one create (aws_route53_zone.native_material[0]), no existing-resource changes/deletes, and
one public delegation output. Reviewed plan SHA-256:
`161ff600aeb548c8a466ba533152c194179179ecf0cae10f50b4010718a0df75`.
Applied that exact plan under the owner's direction to proceed with recommendations without routine
approval prompts. Platform state advanced 405 to 406. Postapply refresh-backed planning exits zero
with no differences. This infrastructure change was applied from the isolated feature worktree;
it is not a merged-main application artifact publication or an application activation.

Actual zone: Z0016104CRY30UCG9QTA, materials.dev.applydash.ai. Required Cloudflare parent records:

| Type | Name in applydash.ai | Target |
|---|---|---|
| NS | materials.dev | ns-1374.awsdns-43.org |
| NS | materials.dev | ns-1819.awsdns-35.co.uk |
| NS | materials.dev | ns-30.awsdns-03.com |
| NS | materials.dev | ns-968.awsdns-57.net |

These parent records have not been created: no Cloudflare DNS write connection is available.
No certificate, native image/function, content route or task was created by this plan. Browser-trusted
wildcard TLS and pinned secret versions, immutable runtime bindings, provider/managed/client
acceptance remain. Keep the parent domain on Cloudflare; only this subdomain is delegated.

Ignored operator artifacts: .tmp/native-dns-development.tfplan, native-dns-development-plan.json,
native-dns-development-apply.log, native-dns-development-verify.log, native-dns-delegation.json,
and the pre/postapply state backups. The current complete input baseline is
.tmp/development-planning-current-406.tfvars.json; older serial-405 input files omit DNS enablement
and must not be used alone. Terraform prevents accidental zone destruction.
Full application verification remains at e71aedc6; this DNS-only change was verified by Terraform
validation, exact plan inspection, actual create and a zero-drift plan. D1/D3 remain In progress.


## Delegation and trusted development TLS (2026-10-08)

After the owner added the four Cloudflare NS records, public resolver 1.1.1.1 returned all four
exact Route 53 nameservers for materials.dev.applydash.ai. The direct Cloudflare lookup transiently
returned SERVFAIL, so public resolution plus successful external CA DNS validation are the stronger
positive evidence. No registrar or parent nameserver change was needed.

Issued a Let's Encrypt ECDSA P-256 wildcard certificate for *.materials.dev.applydash.ai, after a
successful staging-CA rehearsal. Both actual DNS-01 challenges completed and their TXT records were
removed. The trusted leaf expires 2027-01-06T15:50:13Z; SHA-256:
`cf0d002746872ab9be33b77690536ef9a7fcae9f53c4359b55ebeb8b4511cf6e`.
A real local TLS connection in the issuance container verified the chain against default trusted
roots and an allocation-shaped hostname. The actual compiled Documents nativeImageTls loader also
accepted the exact pinned managed secret and wildcard hostname. This is certificate/loader evidence,
not a deployed native task or browser download.

Used official certbot/dns-route53 pinned at
`sha256:38fdfaed25f1e2554b22b835d257756afcfe3acacb8f943ec0884c251e561130`.
The one-off container had a read-only root, dropped capabilities, no-new-privileges, memory/PID bounds,
and tmpfs-only Certbot configuration, account/private keys and logs. Short-lived development SSO
credentials were supplied through the child process environment without command-line values or
credential files. All container fixtures were removed, Docker Desktop stopped and WSL shut down.
The PC remains on. The initial staging wrapper filename shadowed Python's operator module; corrected
before any issuance, then the staging and trusted CA runs both passed. The first native-loader check
used an incorrect dist path; the corrected dist/src import passed without application changes.

Stored the certificate/private-key JSON in Secrets Manager at
ai-job-apply/development/native-material/tls and the ACME account archive separately at
ai-job-apply/development/native-material/acme-account, encrypted with the development platform KMS
key. Exact ARN and immutable version metadata are in ignored .tmp/native-tls-bindings.json.
Version-pinned certificate readback matched. No private key, account key or AWS credentials were
written to source or host artifact files. These two secret metadata resources were created by the
one-off operator, outside Terraform state; state remains 406. Record/import metadata before claiming
complete Terraform ownership; never import secret values into state.

Local issuance scripts and receipts: .tmp/run-native-tls.py, .tmp/native-tls-container.py,
.tmp/native-tls-staging.log, .tmp/native-tls-production.log and
.tmp/native-tls-runtime-validation.log. The trusted CA receipt calls its stage production; this
refers only to the CA endpoint, not an application production deployment. The first-issuance
operator refuses existing TLS/account secrets and is not a renewal implementation.

Remaining: managed renewal/expiry monitoring and rollout of renewed pinned secret versions;
provider secret and accepted retention, immutable native function/task/image bindings, managed
route/download/disposal journey and accountable acceptance. No native runtime activated, candidate
content processed or new human journey test requested. D1/D3 remain In progress; CI/CD deferred.


## TLS secret metadata ownership (2026-10-08)

Added default-off development Terraform ownership for the existing TLS and ACME account secret
metadata, with exact-name ARN validation for declarative imports. Both entries use the existing
platform KMS key, destruction protection and a 30-day recovery window. No secret-version resource
or secret-value data source was introduced. Original task releases still pin reviewed TLS versions.

Terraform 1.16.2 formatting and validation pass. The refresh-backed saved plan imports exactly
aws_secretsmanager_secret.native_material_tls["tls"] and ["acme-account"], then normalizes only
force_overwrite_replica_secret=false, recovery_window_in_days=30 and the ManagedBy=terraform tag.
No name, key, value, runtime or other existing resource changes. Reviewed plan SHA-256:
`b2b3f84cd1a1f6cddebf77f1960fb6963be7f42947d8dad78ebf960031624fc3`.
Applied that exact plan using the verified development account and locked encrypted backend.
State advanced 406 to 407; the postapply refresh-backed plan exits zero with no differences.

Postapply inspection verifies both imported resources contain metadata only, the actual TLS secret
retains the original pinned version as AWSCURRENT, and its KMS key is unchanged. Both original
secret values remain outside Terraform. The complete current baseline is
.tmp/development-planning-current-407.tfvars.json; retain DNS and TLS management inputs for future
plans. Saved plan, private JSON inspection, apply/verify logs and pre/postapply state backups use
.tmp/native-tls-metadata-* paths. This supersedes the prior unmanaged-metadata limitation only.

Managed renewal/expiry monitoring and renewed-version rollout remain unfinished. Native runtime
publication, exact function/task/image bindings and managed journey remain open. Application artifact
publication still enforces clean main exactly matching origin/main; no guard was bypassed here.
No native task/content route was activated. D1/D3 remain In progress, CI/CD deferred and PC on.


## Prelaunch development quiescence (2026-10-08)

Fetched and merged main f5e56237 (#567), which adds the strict AWS shutdown handoff requirement.
The merge changes only AGENTS.md. The earlier continuous-development assumption is superseded.
No application publication or main-branch merge of this feature work was performed.

The first shutdown draft was rejected without apply: setting candidate_rights_enabled=false would
remove export/recovery buckets and other retained resources. Keeping it true initially failed a
validation that required active traffic and NAT. Fixed that coupling: inactive runtime may retain
rights resources without NAT, while active runtime still requires private egress and all existing
policy/prerequisite inputs. Candidate-rights and attempt-recovery maintenance rules now follow the
existing serverless_runtime_enabled gate. All 54 focused serverless Terraform tests pass, including
three new cases for retained storage/disabled maintenance, active maintenance and rejection of
active rights without private egress. Terraform formatting/diff checks pass.

Before apply, development had nine enabled project event rules, three enabled mappings, no ECS tasks,
empty queues/DLQs and no running executions returned for the inspected current durable versions.
The reviewed retained-data plan contains 31 deletes and 19 updates: 23 routes; the D2 schedule,
target, permission and mapping; two NAT gateways and two EIPs; and bounded route/trigger/environment,
alias and policy updates. No database, bucket, queue, key or secret is deleted, replaced or changed.
Saved plan SHA-256:
`3e4f17b15d13b8e041fdc5ed08dd3549b32a53f347045801c8a06d53346a7e46`.
Applied the exact plan under the new shutdown instruction using the verified development account and
locked encrypted backend. State advanced 407 to 412. Postapply refresh-backed planning exits zero.

Live postapply inspection: zero API routes, enabled project EventBridge rules, enabled mappings or
non-deleted NAT gateways. Seven available private interface endpoints remain. The exact retained
RDS instance was requested to stop and still reports stopping at this checkpoint. Its storage/backups
remain protected. AWS's seven-day automatic restart remains unresolved; this temporary stop does
not satisfy full shutdown. Retained endpoint, storage, snapshot/backup, KMS, Secrets Manager,
Route 53 and observability resources can still incur charges. No zero-cost or complete-shutdown claim.

Staging verification is blocked: its SSO token does not exist. No staging mutation was attempted.
The existing staging dormant procedure deletes its database and cannot safely be reused for
preserved development data. A data-preserving development dormant/restore lifecycle with separate
endpoint removal is still required. This is incomplete mandatory cleanup work, not an accepted waiver.
[Development procedure](../../../../infrastructure/runbooks/deployments/development-prelaunch-shutdown.md).

Private evidence uses .tmp/development-quiesce-*; the current complete applied baseline is
.tmp/development-planning-current-412.tfvars.json. Keep the previous active baseline only as restart
reference, never as an automatically replayable plan. Local test log: .tmp/quiesced-runtime-tests.log.
No new API/backend implementation test or broad phase-zero rerun was needed for these infrastructure
changes; actual plan/apply, focused lifecycle tests and zero drift provide the scoped evidence.
D1/D3 remain In progress; native release/journey and persistent shutdown gaps remain. Docker/WSL
remain stopped and PC stays on.


## Independent endpoint shutdown (2026-10-08)

Added private_service_endpoints_enabled, default true, to the platform and development composition.
It affects only the seven hourly interface endpoints: migration ECR API/DKR/logs, Secrets Manager,
SQS, Lambda and STS. Gateway endpoints, IAM/security policies, database, credential value, storage
and protected recovery resources are retained. Removal is rejected outside development or while
public runtime, ingestion, document scan, D2 or maintenance workers are enabled. Operators must
also verify drain before removal; this variable alone does not prove absence of native tasks.

Development validation and all 57 focused Terraform tests pass, including endpoint removal with
protected data retained, refusal while active and refusal of the staging override. The real
refresh-backed plan contains exactly seven interface endpoint deletes and no other managed-resource
change. Reviewed saved plan SHA-256:
`7bbb3dd5e731adcfd6cfba7c84416e740af46c31b0f80bc059019d14d0594bf8`.
Applied the exact plan after development identity/backend verification and private state backup.
State advanced 412 to 415. Postapply refresh-backed plan exits zero with no differences.

Live inspection confirms zero remaining interface endpoints, NAT gateways, enabled project event
rules and enabled Lambda mappings. RDS is now stopped, remains private/deletion-protected, and reports
automatic restart at 2026-10-15T17:17:09.952Z. The installed CLI has no db-instance-stopped waiter;
a bounded read-only status poll confirmed the terminal stopped state instead. No second stop was
issued. Database storage/backups, KMS, Secrets Manager, Route 53 and retained storage/observability
still incur charges; neither zero cost nor permanent shutdown is claimed.

Staging SSO login completed successfully, but GetRoleCredentials returns ForbiddenException:
No access. This is now a role-assignment/access blocker, not a missing SSO token. Staging state
remains unverified and no staging resource was changed. Permanent data-preserving development
shutdown/restore and staging access are outstanding mandatory cleanup work.

Private plan/apply/verify/state/receipt artifacts use .tmp/development-endpoints-off-*; tests are in
.tmp/endpoints-off-tests.log. The current complete applied baseline is
.tmp/development-planning-current-415.tfvars.json. The development shutdown runbook now documents
endpoint removal and reactivation ordering. Native runtime publication/journey, TLS renewal and
D1/D3 acceptance remain open. Docker/WSL stayed stopped and PC remains on.


## Merged-main native resume publication 2026-10-08

[PR #568](https://github.com/Vrixic/project-ai-job-apply/pull/568) merged as
`e4bc0d5467f5901baa496f4a37cae0a6495f5216`; its complete tree matches the previously
verified PR head. Hosted quality was prevented from starting by GitHub billing. CI/CD remains
owner-deferred; no hosted-green claim or repository-protection override was made here.

The unchanged guarded publisher ran from clean main matching origin/main, using the development
temporary SSO identity, Terraform 1.16.2, Node 24 and pnpm 10.24.0. It validated the exact
Terraform-owned artifact bucket, region, versioning, public-access block and customer KMS key.
Workflow tests passed 1,910 cases; 123 database-dependent cases were skipped. The centralized
dependency audit passed with four exactly verified local advisory remediations and no risk
exceptions. Two source-bound builds produced identical artifacts.

Six native-resume Lambda artifacts and their checksum, manifest and CycloneDX companion objects
were published: 24 immutable S3 versions total. Each was verified during publication, followed
by a separate receipt-bound Verify invocation with successful exact-version readback.

| Artifact | ZIP SHA-256 |
| --- | --- |
| Owner RPC | `60578db351af9baef67bcb0c41de30a7107dcc7827165dc108381fb9b7650d09` |
| Source RPC | `4ebd2d1fd85f96603f64f1c67efa0edffd8b415fa71bfcc7ac8949274af33131` |
| Preparation control | `ffd54e1127174c2a4abf9dd32af4dd903cb8b50e5407a5873005b21aaedff7db` |
| Durable preparation | `44c7147be16d89e46f0cf85438b11c2bc4f50469e74e467855c4b3121024c039` |
| Request dispatcher | `edd4045cb28bf1aa9f7c5fcff7b0cfb92e297864a04c7c7dafc557c5f1b6a67b` |
| Task observer | `17ec119a0397381e288eb43de3706561e7975cbef4bd8530432fe5933f5c9ede` |

Private receipt: development `.terraform/development-native-resume-artifacts/receipt-e4bc0d5467f5-20261008-132952.json`.
Receipt SHA-256: `33db93de2e1fe2fad0fd61205b0f8c5d9028e2416cb05340ac9c647feec1f577`.
Private logs: `.tmp/native-resume-publish-e4bc0d54.log` and
`.tmp/native-resume-verify-e4bc0d54.log`. The initial separate Verify invocation rejected a
repository-relative receipt path; the corrected absolute path passed without changing the guard.

No Lambda code, task definition, route or trigger was deployed or activated. NativePreparation,
NativeMaterialControls and NativeMaterialCleanup publication, configured images, managed runtime
bindings, live journey and accountable acceptance remain. Certificate renewal remains separate.
This publication does not complete D1 or D3.

A fresh read-only development observation at `2026-10-08T17:38:32Z` found zero API routes,
enabled event rules and enabled Lambda mappings. It also found one protected database available
and a second database creating during concurrent database-dormancy/recovery work in the separate
cost-shutdown checkout. This supersedes the earlier stopped-database observation: AWS shutdown
is incomplete at this observation, and these billable operations were not interrupted. The
publisher made no runtime or Terraform-state mutation. Staging role access remains unverified
since the earlier No access denial. Durable storage, artifact versions, snapshots, secrets,
security and DNS retain charges; no zero-cost or full-shutdown claim. Docker/WSL were not started
for publication, and the PC stays on.


## Complete native Lambda publication 2026-10-08

The remaining NativePreparation, NativeMaterialControls and NativeMaterialCleanup families are
published from clean merged main `e4bc0d5467f5901baa496f4a37cae0a6495f5216`. Combined with the
six NativeResume artifacts above, all **14 native Lambda artifacts and 42 companion objects**
are now stored as immutable development S3 versions. This is artifact publication, not deployment.

Each unchanged publisher invocation validated the temporary development identity, region,
Terraform-owned storage, encryption and source. Each family passed its mandated tests and
centralized dependency audit, two identical builds, immutable writes and object verification.
Separate receipt-bound Verify invocations all passed exact-version readback. Workflow tests
passed 1,910 cases with 123 database-dependent skips; Gateway tests passed 376 cases with 116
database-dependent skips. These are repeated family gates, not additional unique test totals or
new SQL/live managed acceptance. No exception or hosted CI result substitutes for these checks.

| Family | Published objects | Verified receipt SHA-256 |
| --- | --- | --- |
| NativePreparation | 16 | `4497823c7483e55ffe1949ccba896431d2d4960bf9d43d56da9f51ab7038f718` |
| NativeMaterialControls | 12 | `efd34ceff1334c22cb431f488d63eb0693a0b9a7be8747e69ce9a74d97e3d75d` |
| NativeMaterialCleanup | 4 | `9ae4d94c7f9e80fc859b97d23395b9ffbb6b78de3647f7e0839dfe70abc4dd60` |

| Lambda artifact | ZIP SHA-256 |
| --- | --- |
| `native-application-preparation-lambda` | `8c5a63532558a0571d95c7d7d6312666fec2cf551f099afee57ada4b84108cba` |
| `application-preparation-durable-lambda` | `093794f46eef2f73175831e55dab23fb1eef38a00f7f78578fac228750d69507` |
| `application-preparation-starter-lambda` | `59ff1877a655a978733ddee8a1a84d561d04c1fab27cf4b769137bb34044e629` |
| `application-preparation-recovery-lambda` | `4da7e67002992cfe51df32691ebe8bc5cd925ce1bf734297fc8cd501e8f1e47e` |
| `native-material-launch-lambda` | `50bc0ae43a5286295740049450950d07bf630737a8ebd8e7bc88fd52c5fdf35a` |
| `native-owner-rpc-lambda` | `4b96c4435776e4a69f39103c24ec265b13548129ba826ec86c452d098175dff9` |
| `native-material-task-event-lambda` | `388e169184dab7d743df69ac9783abce9d50b96b052c1ab32e5e829cfee928b7` |
| `native-material-cleanup-worker-lambda` | `be9f1dd2547b251b91282815085f60815146f7aa13711772f263b755372e1885` |

Receipts remain in their dedicated ignored development `.terraform` artifact-family directories.
Private batch summary: `.tmp/native-remaining-publication-e4bc0d54.json`; individual publish and
Verify logs use `.tmp/<Family>-{publish,verify}-e4bc0d54.log`. Account/bucket identifiers, object
version IDs and full command logs remain private. No Lambda, route, task definition, trigger or
Terraform state was changed by these publishers.

A fresh read-only development observation at **2026-10-08T17:59:10Z** confirms zero database
instances, API routes, enabled event rules, enabled Lambda mappings, live NAT gateways, live
interface endpoints and non-stopped ECS tasks. Two encrypted manual recovery snapshots are
available. The separate [database dormancy work #570](https://github.com/Vrixic/project-ai-job-apply/pull/570)
completed the database cleanup observed in the previous entry; this publication did not perform
that deletion or establish SQL/application restore acceptance. Preserve those recovery snapshots
and use the new dormant baseline for future plans, not the historical stopped-database inputs.
Private observation: `.tmp/native-release-shutdown-observation.json`. Staging authentication was
rechecked and still fails at GetRoleCredentials with ForbiddenException / No access; its shutdown
cannot be verified. Retained snapshots, storage, artifact objects, security and DNS still incur
charges. WSL reports no running distributions; Docker was not started, and the PC stays on.

Native task images, exact numeric runtime/IAM bindings, current migrations/restore replay,
managed journey and accountable D1/D3 acceptance remain. Development secret metadata includes
TLS but no provider-key secret under the project path; the owner was asked for an existing key's
location, never its value in chat. No provider call or cover-letter activation occurred. D1 and
D3 remain In progress; hosted CI/CD remains owner-deferred.


## Private resume access deployment and image packaging 2026-10-08

The isolated `feat/native-resume-managed-release` branch incorporates the exact #570 dormancy
source and #571 publication evidence. A refresh-backed baseline using the reviewed dormant inputs
has zero drift before this release. The historical stopped-database baseline must not be reused.

An exact reviewed plan creates six resources: the private native-resume owner/source Lambda
functions, their two roles and two policies. Its only update adds one exact-principal
`s3:GetObjectVersion` statement for normalized `resume.json` versions to the existing S3 gateway
endpoint policy; every existing statement and every other endpoint attribute is preserved.
No database, paid networking, public route, dispatcher, schedule, task or task definition is created.
The handlers are enabled behind their original task authentication boundary, with no automatic
caller or public ingress. The intended original task revision is 1; ACTIVE and INACTIVE inventories
contained no native-resume revision, and actual registration must later match the pinned binding.

Saved plan SHA-256:
`8184e59ad27b6cdda89fff0ecc71a134d27e1215841381f887e4da3a9e4f7574`.
The apply moves platform state **417 -> 419**; same-input postapply planning has zero drift.
Both functions publish numeric version **1** with ZIP hashes matching the verified
`e4bc0d5467f5901baa496f4a37cae0a6495f5216` artifacts and the exact private subnet/security-group
configuration. Actual managed invocations using empty unauthenticated requests return the expected
`NativeResumeOwnerUnavailable` and `NativeResumeSourceUnavailable` errors. These are real
Lambda configuration/cold-handler/refusal checks, not successful owner/source reads: the database
remains absent, no task runs, and no candidate data or provider call is involved.

Private evidence: `.tmp/native-resume-r1-source-access-{review,verification}.json`, exact plan,
apply log, before/after state and postapply plan log. Numeric bindings are in
`.tmp/native-resume-r1-bindings.json`. The **latest complete applied inputs** are
`.tmp/development-planning-current-419.tfvars.json`; older dormant inputs omit these functions
and must not be blindly applied.

Image preparation found that `.dockerignore` admitted only the original image-size patch, while
the frozen installation also requires the reviewed node-forge and braces patches. Commit
`5e8750e26510c8fbb50e4110dcd105fdf7134f82` adds only those exact files. The existing infrastructure
guard now derives required exact entries from declared `pnpm.patchedDependencies` and rejects
broad or undeclared patch inclusions. Four negative probes (each missing new patch, wildcard and
undeclared patch) are rejected; the correct allowlist and infrastructure validator pass.
Biome formatting/check passes with five pre-existing warnings; diff whitespace checks pass.

An actual Linux/amd64 `Dockerfile.native-resume` build passes the frozen install, contract generation,
compilation, native kernel build and final packaging. Local image digest:
`sha256:f3faf857ffced8f4e56b31f1014f4d54cb88a1aa602dfbeba44ebd1e69f90705`.
The maintained image verifier passes **24 runtime assertions** and two actual generated files,
using synthetic external ports, no network, read-only root and UID 65532. Its expected kernel-stop
exit is 137 with `oomKilled=false`. This uses the default disabled configuration; it is local
packaging/runtime-fixture evidence, not a configured live image, registry publication or a managed
browser download. Private build/smoke logs: `.tmp/native-resume-5e8750e2-image-{build,smoke}.log`.

At **2026-10-08T18:15:14Z**, fresh development reads still find zero database instances, API routes,
enabled event rules/mappings, NAT gateways, interface endpoints and non-stopped ECS tasks. Both
manual encrypted recovery snapshots are available. New Lambda definitions are retained without
triggers. Snapshot/storage/security/DNS costs remain; staging access is still unresolved. The
image test container was removed, Docker Desktop stopped and WSL shut down; PC remains on.

The currently signed-in local web configuration uses `http://localhost:3000`; native transport
requires an exact HTTPS client origin. No configured HTTPS frontend was found in this checkout,
so its actual URL/setup remains an integration prerequisite, alongside the pending provider-key
location for cover letters. Full client/native read integration, configured image and original task
registration, runtime/IAM bindings, current migrations/restore replay, live managed journey and
accountable acceptance remain. D1/D3 stay In progress; hosted CI/CD stays deferred.

## Migration image scan remediation 2026-10-08

PR #572 merged normally as `771f65480fe7e8a4025b5d90ec7b401821ddf04b`, incorporating
#570 dormancy and #571 publication evidence. The current complete dormant inputs were archived
under `lifecycle/development/dormant.tfvars.json` in the encrypted, versioned state bucket, using
an ETag precondition and exact-version byte/encryption readback. Input SHA-256:
`854161ceb15620ba1bc518a5027a23e2fe2f514fed7ff13bc6ca7f35f72c16b5`.
The older version remains recoverable. Private receipt: `.tmp/dormant-archive-419-receipt.json`.

The merged-source migration publisher completed two clean, byte-identical Linux/amd64 builds,
the dependency audit, and the hardened runtime inventory smoke: seven owners, twelve schemas,
95 relations and 78 checksum-bound migrations. Its eleven required test tasks passed from cache;
this is not a new execution of every cached unit test. Platform digest:
`sha256:1f6453cc0b78ab3ab0459e50ff412393dd92733890f1d85252c0c780b55fbec0`.
ECR upload succeeded, but its COMPLETE scan reported one High finding, **CVE-2026-85091** in
`zlib 1.3.2-r0`. Publication correctly stopped with the receipt still in `publishing` phase.
This digest is not an accepted release, has not been independently verified, and was not deployed.
Private evidence: `.tmp/migration-771f6548-ecr-scan.json` and the publisher logs/receipt in the
ignored development migration-image directory.

[Alpine's security database](https://secdb.alpinelinux.org/v3.23/main.json) identifies
`1.3.2-r1` as the fix. The migration runtime now fetches that exact signed APK, verifies SHA-256
`ee62e1864c235901e2aa4d1868c7ae8f7cc5d0740a98c48a2525332eb4bfda73`, installs it without
network access, verifies the installed version and removes the temporary APK. The pinned base
and ECR scan gate remain unchanged. Existing publisher guards are updated; all **191 runtime
regressions** and publisher OCI guards pass. An actual Linux/amd64 runtime-layer build verifies
the installed package database and Node gzip round-trip as UID 65532 with no network, read-only
root, dropped capabilities and no package manager. Full rebuilt-image scan/publication remains
pending; this local runtime check is not SQL execution or managed acceptance. The runbook's stale
schema/relation/migration totals now match the executable manifest.

A separate baseline capture refused newly observed provider metadata for the two private native
roles/functions. Exact review proved four empty-tag normalizations and two computed inline-policy
snapshots matching their separately managed policies, with every other attribute and sensitivity
unchanged. All planned resources and outputs were `no-op`. Applying that exact saved plan
`5cdb06a4958ae53350f6634956348a2bb6ec42b36abc92d77d393d257869d7a8` records the refresh:
state **419 -> 420**, zero resource mutations. No operator guard was relaxed and no baseline was
relabeled. Private review/apply evidence: `.tmp/migration-771f6548-metadata-review.json` and
`.tmp/migration-metadata-apply-receipt.json`. Input bytes are unchanged; obtain a fresh current-state
baseline before the next task release.

D1/D3 remain In progress. Current managed SQL execution, native task/image integration, HTTPS
frontend origin, provider-key location and live acceptance remain. CI/CD stays deferred. Docker
Desktop and WSL were stopped after the runtime check; the PC stays on.

## Empty-drift baseline correction 2026-10-08

After the reviewed metadata refresh, the current state-420 seed plan has zero resource/output
changes and Terraform omits `resource_drift` entirely. Gateway baseline capture incorrectly read
that optional property directly under strict PowerShell mode and failed. Gateway, document and
migration drift readers now use their existing optional-property helpers; existing nonempty drift
validation and change rejection remain intact. No plan JSON or sidecar is rewritten to work around
the error, and no resource-drift allowlist is expanded.

Validation passes: 654 Gateway guard cases, the document dark guards, the migration operator path
and baseline suite, and schema-7/schema-8 round-trip/adversarial tests. Added regressions cover
omitted/null drift and ensure real resource/output changes still fail. Both corrected retained
baseline guards also accept the actual saved `039cf9c6` state-420 plan without changing its bytes.
The encrypted versioned recovery-input archive is refreshed to state 420 with unchanged input
SHA-256 `854161ceb15620ba1bc518a5027a23e2fe2f514fed7ff13bc6ca7f35f72c16b5`; exact-version
readback passes and earlier versions remain retained.

At **2026-10-08T18:47:36Z**, fresh development inspection confirms zero databases, routes, enabled
rules/mappings, NATs, interface endpoints and non-stopped ECS tasks; both encrypted manual recovery
snapshots are available. Retained storage/security costs remain. Staging role access remains
unresolved. PR #573 merged the zlib correction as `039cf9c6c447daa42490fbac9353e8b75cc2f820`.
Its superseded rebuild is stopped before publication so the combined corrected operator/image
candidate can be built once from the next exact merged source. Full image scan/publication,
successful managed baseline capture and SQL execution remain unclaimed. D1/D3 stay In progress;
CI/CD deferred and PC on.

## Verified current migration image 2026-10-08

PR #574 merged the optional-drift correction as
`38d79a3f4da53c978dfafab64cd0ee510e2ac0bf`. The current migration publisher completes two clean,
byte-identical Linux/amd64 builds, the dependency audit and actual hardened container inventory
smoke. Its eleven prerequisite test tasks pass from cache. The image contains seven owners,
twelve schemas, 95 relations and 78 checksum-bound migrations; this checks package contents,
not executed SQL against a database.

The exact immutable ECR image passes a **COMPLETE scan with zero High and zero Critical findings**,
resolving the earlier zlib scan rejection. A separate checksum-bound `Verify` action authenticates
the immutable index/platform readback and repeats the scan gate successfully.

| Binding | Value |
| --- | --- |
| Platform digest | `sha256:965716b29bae466eeb04aa963623d36d97bf44bae056ba6bcd8b66b61c79cb79` |
| Index digest | `sha256:038bce83b86d63692ce3f7c081666bcfeefed04975d138fe56f3e3fa5e3c8d6e` |
| Configuration digest | `sha256:4eb3ea8eeddb972950fc6d2c52fc6ed5c2b4f983ce70a0073cb525c678205379` |
| Receipt SHA-256 | `c6cf47ee4ae0c4e75d1ee41f4af18babcdda0841f75077ed62e48861269ba7ac` |

Private publication receipt:
`infrastructure/terraform/environments/development/.terraform/development-migration-image/receipt-38d79a3f4da5.json`.
Private outer logs: `.tmp/migration-38d79a3f-{publish,verify}.log`; build/runtime logs stay below
the ignored migration-image directory. The failed `771f6548` image remains unaccepted and undeployed.
The superseded `039cf9c6` build was intentionally stopped before publication; it is not a scan result.

A supported **schema-7 baseline capture succeeds at state 420** with zero meaningful changes and
no cloud mutation. The first capture using JSON-file inputs found 22 booleans represented as exact
lowercase strings after Terraform's native environment serialization. Review proves every boolean
is equivalent and all planned values are byte-structurally equal. The generated zero-change plan,
without changing its bytes, becomes the reviewed seed for a second successful capture. No sidecar
is relabeled and no comparison or drift guard is relaxed.

Baseline plan `baseline-38d79a3f4da5-20261008-145423.tfplan` SHA-256:
`611431927ab4c047393b6bb44bf90486f9073c525045bea27fee3f4f96ee95c2`.
Adjacent metadata SHA-256:
`765f10651a9da58d130b7fa12d7c7c62a54008dc2086e0de582dffac6955006c`.
Both remain private under the development gateway-release directory. The baseline still binds the
actual older document publication separately; it does not claim the documents were republished.

The final encrypted recovery snapshot is verified available under the exact platform KMS key.
A separate lifecycle restore plan passes its scope guard: create one private protected Single-AZ
PostgreSQL instance with 35-day backups, update its public-reader IAM/configuration, and refresh
only the existing connection-secret version. Plan SHA-256:
`d541afe9c6457976db321ee1386612824dccde59018482702256de463ff36d3c`.
**It is not applied** and must be regenerated if state changes. No database, migration execution,
public route, native task or provider call is enabled by image publication or baseline capture.
Docker Desktop and WSL stop after independent image verification; the PC remains on. D1/D3
remain In progress, with managed migration/restore replay and native integration/acceptance open.

The supported `PlanTask`/`ApplyTask` handoff now succeeds. Exact plan SHA-256
`b41f077188497fb207517332f9a33a798c9f3ab3d529f9f47b0b18b13369f35e` and adjacent metadata
SHA-256 `4d1c5ec77920e1136d80482546412ecea00d4b39925d19614e55b65c35eccc49` replace only
the migration task definition's image. Review compares all container fields after removing only
empty provider-default collections; all other fields are unchanged. The image's digest-bound OCI
configuration supplies UID/GID 65532; no task-level user override is present. The task retains its
read-only root filesystem and Fargate/awsvpc boundary.

The deployed task is numeric revision **61**, and platform state advances **420 -> 421**. The
operator verifies the actual definition, zero active migration tasks and zero continuous ECS
services. A separate exact-input refresh-backed plan has zero changes. **No SQL migration is
executed.** The previously prepared state-420 database restore plan is now stale and must not be
applied; regenerate it from the new complete inputs for the next testing session.

Latest private full input file: `.tmp/development-planning-current-421.tfvars.json`. Every one of
138 previous input values is preserved; only `migration_image` changes. Its SHA-256 is
`64adc37ba74c38b2bbdda33dbf49b5072a994c591fb28df2b802885447b04d56`. The canonical encrypted,
versioned recovery archive is updated with an ETag precondition and verified by exact-version
byte/KMS readback at **2026-10-08T19:11:32Z**; previous versions remain recoverable. Private
receipt: `.tmp/dormant-archive-421-receipt.json`. Task plan/apply records remain under the ignored
migration-operator directory, with `.tmp/migration-38d79a3f-{task-review,postapply-state}.json`
and postapply plan logs locally.

At **2026-10-08T19:11:49Z**, fresh development readback confirms zero RDS instances, API routes,
enabled EventBridge rules/mappings, NAT gateways, interface endpoints and non-stopped ECS tasks.
Both manual encrypted recovery snapshots are available. Definitions, storage, security and DNS
remain retained and can still incur charges; staging access remains unresolved. Docker Desktop
and WSL are stopped, and the PC stays on. Remaining work includes snapshot restore and current
SQL/recovery replay, configured native images/tasks/client origin, cover-letter provider binding,
and live acceptance. D1/D3 remain In progress; hosted CI/CD remains deferred.


## Deferred Terraform values correction 2026-10-08

Merged source `5d834f687bdd66d4882e365f884d191797a282b6` passes the dependency audit,
eleven cached prerequisite test tasks, two byte-identical clean Linux/amd64 builds, hardened
runtime inventory smoke, publication and independent immutable readback. ECR scan is COMPLETE
with zero High/Critical findings. Platform digest:
`sha256:685b02a4615c289d949314900c51f8196fedbae02522cad83093baa935fc8f05`.
Publication receipt SHA-256:
`993810419299c8e7e9d6440d55ed4327af0af55eb4d3e7509347c2073ac7edc6`.
Private handoff: `.tmp/migration-5d834f68-release-handoff.json`. This is package/publication
proof, not executed SQL.

The latest state-427 recovery archive is read back by exact version with checksum/KMS verification.
The reviewed restore creates a private protected database with 35-day backups and PITR; state
advances to 429. An independently reviewed metadata-only reconciliation advances to 430 without
resource changes. Supported schema-7 capture succeeds with zero meaningful changes and retains
the actual older document release binding. Application traffic and background work remain off.

`PlanTask` then exposes an operator defect: Terraform omits `values` for two deferred native-resume
identity/region data sources. The shared resource-map reader dereferences the absent property
under strict mode. The plan is saved but no accepted task metadata, task apply or SQL execution
occurs. Migration task revision **61** remains deployed and idle.

The reader now uses the existing optional-property helper, retaining null for unknown values.
It does not fabricate an empty resource or skip required identity validation. Omitted/null nested
data-source regressions pass, and omitted/null required KMS identities remain rejected. The
actual saved plan passes the corrected exact-task guard **unchanged**, without applying it or
relaxing a resource/drift allowlist. This stale plan must not be reused after shutdown.

Validation passes: document staged guards/operator, 654 Gateway guard cases, 136 candidate-rights
activity assertions, migration operator/baseline and schema-7/schema-8 adversarial/round-trip
suites, serverless infrastructure validation and `git diff --check`. Cloud execution of the
corrected operator remains pending its merged release; no D1/D3 exit criterion is closed.

Mandatory cleanup completes after the failed planning test. A new encrypted safety snapshot is
physically restored to the exact private restorecheck instance; availability, original KMS key
and zero temporary backup retention are verified. Reviewed preparation/dormancy plans remove
only the original database, preserving a new final snapshot and automated backups. The temporary
restorecheck is then removed. State **434** preserves all **289 other managed resource identities**;
the final exact-input plan has no changes.

At **2026-10-08T23:42:44.851873+00:00**, live development readback has zero RDS instances, routes,
enabled rules/mappings, NATs, interface endpoints and non-stopped ECS tasks. All six encrypted
manual recovery snapshots are available. Storage, backup, DNS and security charges remain;
this is not a zero-cost claim. Physical restore is not SQL/application/privacy replay acceptance.
Latest complete inputs: `.tmp/sqlattempt-dormant.tfvars.json`, SHA-256 `1291919333e8f268f94c659f4b801c81b6e982b09ab18bbcb06ad2e79194fd96`.
Canonical versioned recovery inputs/proof/manifest are refreshed with explicit KMS encryption,
ETag conditions and exact-version byte readback; local manifest is
`.tmp/sqlattempt-recovery-manifest.json`. These supersede state-427/423/421 inputs.
Docker/WSL are stopped and the PC stays on. D1/D3 remain In progress; CI/CD remains owner-deferred.

## Managed SQL legacy transition gate 2026-10-08

Merged `25a561270a5ba786991b24cc6b1c608d800b3a98` passes the dependency audit,
eleven cached prerequisite test tasks, two identical clean builds, hardened migration-runtime
inventory smoke, immutable publication and independent readback. ECR scan is COMPLETE with
zero High/Critical findings. Platform digest:
`sha256:22429d4c0acd6a4c8832273651df98cd94c2777ab5348fcf2c13cee05f2c11be`.
This is the current 78-migration image; it supersedes the earlier planning-only candidate.

Development restores from the verified state-434 recovery archive with traffic and background
work off. The protected private database has 35-day backups; restore advances state 434 -> 436.
An independently reviewed metadata-only reconciliation advances to 437. Supported schema-7
baseline capture succeeds without meaningful changes. The corrected optional-values reader then
accepts the exact image-only task plan, SHA-256
`d914db9bd83cd225aa8bf57874e76ec4b8fa1833c7dcaa90ead6abc866ea998d`.
Applying it advances state 437 -> 438 and deploys migration task revision **62**.

The supported execution operator submits exactly one task with the reviewed definition, image
and digest. It reaches STOPPED with exit **1**. Its aggregate logs report successful migration
and verification for six owners: Profile through `0011_active_candidate_lease`, Jobs through
`0027_candidate_report_export_status`, Documents through `0016_native_application_disposal`,
Matching through `0003_private_saved_page_captures`, Billing through `0002_candidate_rights`,
and Trust through `0005_development_test_removal`.

Applications stops at the intentional `0009_restricted_packet_values.sql` guard, SQLSTATE
`55000`: `restricted packet migration requires an explicit legacy evidence transition`.
The guard checks incompatible packet fields and historical create-packet/preparation receipts;
the log alone cannot distinguish which category exists. The six preceding owners commit
independently. The Applications driver wraps its pending migrations in one transaction, but an
independent live ledger read has not established its remaining exact version. No complete
78-migration, application, privacy replay or candidate-journey acceptance is claimed.

The execution receipt remains **submitted**, with its immutable claim preserved; it is not
relabeled verified. Private receipt: `.terraform/development-document-migration/receipt-25a561270a5b-20261008-202529.json`
under the development Terraform directory. Sanitized classification and raw private evidence
remain under `.tmp/migration-25a56127-*`; raw logs and candidate data are not committed.

[ADR-041](../../../adr/041-restricted-packet-values-and-keyed-replay.md) requires an explicit
compatible transition that preserves original approvals, ambiguous attempts and replay evidence.
Next work is an aggregate-only inventory of the actual legacy boundary and a reviewed compatible
transition. Do not retry this execution, alter immutable migration checksums, purge candidate
records, rehash old approvals or disable the guard to obtain a successful migration. Existing
local legacy fixtures prove refusal/rollback and ordinary compatible transition, not disposition
of this database. D1/D3 and D3-014/D3-077 remain In progress; native activation stays off.


Mandatory shutdown completes after this failed SQL test. A fresh encrypted safety snapshot is
physically restored and verified private, available and bound to the original KMS key. The
temporary instance's automatic backup setting is verified zero after its asynchronous change
settles. Reviewed preparation/dormancy plans remove only the original database, retaining a
new final snapshot and original automated backups; the verified temporary copy is then removed.
Final state **442** preserves all **289 other managed identities** and the complete-input
refresh-backed plan has no changes. This proves physical recovery, not SQL/privacy replay.

At **2026-10-09T00:49:15.176579+00:00**, live development readback confirms zero database instances,
API routes, enabled rules/mappings, NAT gateways, interface endpoints and non-stopped ECS tasks.
All **8 encrypted manual recovery snapshots** are available. A separate EC2 read finds zero
project/environment-tagged Elastic IPs. Retained snapshots/backups, S3/ECR/log storage, KMS,
Secrets Manager and DNS may still incur charges; this is not a zero-cost claim. Staging has not
been reverified with restored development access.

Latest complete inputs: `.tmp/sqlrun25-dormant.tfvars.json`, SHA-256
`5bf3d08db6a0f7746df795cee4ef181587797392519bede5a16d634d6fa40c7b`. Canonical recovery inputs/proof/manifest are updated in the versioned
state bucket using explicit KMS encryption and ETag preconditions; exact-version byte/KMS
readback passes. Local manifest: `.tmp/sqlrun25-recovery-manifest.json`. These supersede
state-434 and older recovery inputs and retain the six successfully migrated owners.
Docker Desktop and WSL are stopped; the PC remains on. D1/D3 remain In progress and hosted CI/CD
remains owner-deferred. Next work is the legacy inventory/compatible transition above.

## Legacy migration diagnostics 2026-10-08

The live task's single failure message could not distinguish restricted packet values from
historical create-packet/preparation receipts. The Applications driver now recognizes only that
exact SQLSTATE/message pair and, after its migration transaction rolls back, opens a separate
repeatable-read, read-only inventory transaction. Ten fixed integer counts describe the migration
ledger, packet categories, receipts, packets with approvals and ambiguous attempts. No row IDs,
candidate values, packet hashes, receipt hashes or database error details enter this output.
Statement/lock timeouts limit inspection; missing permissions or other diagnostic failures emit
a fixed unavailable message. A failing log sink cannot replace the original migration error.

This is descriptive inventory, not a duplicate migration validator or transition authority.
Packet categories can overlap; approval/attempt counts cover all legacy records. The complete
immutable migration still decides compatibility. No guard, SQL/checksum, public contract, runtime
activation, ledger entry, old approval, attempt or replay receipt is changed.

An actual local PostgreSQL 16.6 driver smoke returns the expected aggregate and still fails at
the guard. All eight historical SQL cases pass. The expanded committed fixture contains fourteen
packets spanning both boolean answers, vault references, restricted reasons and both receipt
operations, plus malformed scalar fields that must not be counted as object markers/references.
It verifies the exact count record, one emitted diagnostic, unchanged full-row/schema
snapshots after failed migration, and successful inspection through a SELECT-only role whose
attempted DELETE is rejected. The synthetic role is removed after verification. Targeted failure
tests (six cases) cover unrelated errors, private diagnostic errors and unavailable logging.

The disposable memory-backed local database is removed, Docker/WSL stop, and AWS remains dormant.
This is local source evidence; current live development task revision 62 still uses the earlier
image and has no new inventory. Merged image publication and a bounded managed diagnostic run,
then an evidence-preserving legacy transition, remain before full migration acceptance. D1/D3
remain In progress; hosted CI/CD stays deferred and the PC stays on.

Fresh development readback at **2026-10-09T01:00:39.740050+00:00** still has zero database instances,
active routes/rules/mappings, NATs, interface endpoints and non-stopped ECS tasks; all eight
encrypted manual snapshots are available. No AWS mutation is performed for this diagnostic change.
Retained recovery/storage/security/DNS charges remain; staging is not reverified.

Maintained local verification is complete with a recorded retry. The initial full verifier passes
operator/runtime guards, formatting, lint (unchanged 15 warnings/58 infos), all 38 typecheck tasks
and dependency regressions, then stops when the first Profile readiness entrypoint import exceeds
30 seconds and the next test sees its late mock call. The unchanged file passes all 44 cases in
isolation. Rerunning the verifier from its Tests step passes all 39 workspace test tasks (including
404 Applications and 1,910 Workflow cases), all 23 build tasks, every remaining emitted isolation
check, Compose and product-scope checks. No timeout, assertion or Workflow source is changed.
Database opt-ins in the broad run remain skipped; the separate eight-case PostgreSQL run above
is the actual persistence evidence. Private logs are `.tmp/legacy-diagnostics-full-verification.log`,
`.tmp/legacy-diagnostics-entrypoint-recheck.log`, `.tmp/legacy-diagnostics-verification-remainder.log`
and `.tmp/legacy-diagnostics-final-sql.log`. New Markdown links/anchors and whitespace checks pass.

## Restored access and development shutdown at state 450

On 2026-10-08 (local date), restored development SSO access permits the interrupted session's
required cleanup. Live readback finds the original database available and protected, with no
active migration task. Source `a1b4ef2f9c5a181e58e1388f82c295b85bad6c8e` has a verified migration
image publication and an applied image-only task update to revision 63 at state 446. The image
scan is complete with zero High/Critical findings. No revision-63 SQL execution or aggregate
legacy inventory is claimed; that work remains outstanding. The earlier failed execution receipt
and legacy evidence are preserved.

The latest complete inputs are reconciled with the actual task image and database metadata.
A fresh encrypted safety snapshot physically restores to an available private database using
the original KMS key. The temporary copy's automatic backup retention settles at zero before
restore verification. The reviewed preparation plan changes only database shutdown settings;
the reviewed dormant plan deletes only the original database, retaining a new final snapshot
and original automated backups. After the final snapshot is available, the exact temporary
restore-check instance is removed. This proves physical recovery, not SQL or privacy replay.

The final complete-input plan has zero drift at **state 450**, with all **289 other managed
resource identities preserved**. At **2026-10-09T02:17:21.349601+00:00**, live development readback
confirms zero database instances, API routes, enabled rules/mappings, NAT gateways, interface
endpoints and non-stopped ECS tasks. All **10 encrypted manual recovery snapshots** are available.
Separate project/environment-tagged EC2 reads return zero allocated Elastic IPs, instances and
EBS volumes. Lifecycle drain checks also verify empty queues and no running durable executions.

Canonical recovery inputs, restore proof and manifest are refreshed in the versioned state bucket
with explicit KMS encryption and ETag preconditions; exact-version byte/KMS readback passes.
Private evidence is `.tmp/sqlruna1-*`, including the recovery manifest and shutdown observation.
Use the new dormant inputs for future restoration; state-442 and older inputs are historical.

| Artifact | SHA-256 |
|---|---|
| Applied preparation plan | `246044e8324813213f736db03a664bbb69a32ab013fa35ceae2e675326358828` |
| Applied dormant plan | `0d98284b91d9e4e69dd191b351dc27e8275cf42b8233d751cff54035b30381d4` |
| Final no-change plan | `b83a820869433cda2e032afe14d0d60886fcdb3cb1fbcfea0ccbf8ab8a5ebc42` |
| Archived dormant inputs | `c9e837ffe7970f90b23982c237f5462f5a49491b90141ee19706d5dbed059ee9` |

Retained snapshots/backups, S3/ECR/log storage, KMS, Secrets Manager and DNS can still incur
charges; this is not zero cost. Separate staging verification remains incomplete: its profile
reports `Token for ai-job-apply-staging does not exist`. Restored development access does not
establish staging state. Docker Desktop and WSL are stopped, and the PC remains on. D1/D3 remain
In progress, with managed legacy inventory, compatible transition and native acceptance open;
hosted CI/CD remains deferred.

## Post-apply delivery evidence compatibility

The shutdown evidence merge `11950dcc` modifies exactly four delivery documents after the
`a1b4ef2f` migration image/task publication. The post-apply source guard previously rejected
that delta despite unchanged image inputs, preventing a fresh execution plan on current main.
Its explicit path allowlist now also admits modifications to those four existing delivery
documents. It still requires an ancestor release and exact current merged operator source;
each path must be a blob at both revisions. Other documents, runtime/SQL/Terraform changes,
additions, deletions and renames remain refused. Task publication still requires current main.
Image digests, task/plan metadata, execution claims and original release identity are unchanged.

The full migration-operator suite passes, including schema-7/schema-8 baseline round trips and
adversarial checks. New cases exercise the four-document delta, recovery's two-revision blob
inspection, non-modification statuses, and mixed SQL/runtime/unapproved-document changes.
The real `a1b4ef2f..11950dcc` Git delta also passes the extracted production predicate; this is
source validation, not a managed execution plan. Serverless infrastructure validation and
whitespace checks pass. No cloud mutation occurs; development remains at the verified state-450
dormancy above. Managed inventory and the compatible legacy transition remain outstanding.

## Managed legacy inventory from revision 63

On 2026-10-08 (local date), the guarded operator on merged `1a46dc3c` plans and executes exactly
one deployed revision-63 migration task from release `a1b4ef2f`. The source/digest/task/network
checks pass with no overrides. The database is restored privately from the verified state-450
final snapshot with encryption, deletion protection, 35-day retention and PITR available;
application routes and background triggers remain disabled.

The task stops with exit 1 at the original Applications 0009 legacy-evidence guard. Six preceding
owners report successful migration/verification. After Applications rolls back, the separate
read-only diagnostic reports the following aggregate at 2026-10-09T02:39:15.627426+00:00:

| Inventory | Count |
|---|---:|
| Applied Applications migrations | 3 |
| Restricted migration recorded | 0 |
| Packets | 7 |
| Packets with counted restricted values | 0 |
| Packets with protected markers | 0 |
| Packets with invalid containers | 0 |
| Historical create-packet receipts | 7 |
| Historical queue-preparation receipts | 0 |
| Packets with approvals | 1 |
| Ambiguous attempts | 0 |

The seven create-packet receipts establish a guard blocker; zero category counts do not establish
full packet-shape compatibility. The approval count is distinct packets with approvals, not an
approval-row total. No owner identifiers, candidate values, packet hashes or receipt hashes enter
shared evidence. This is actual managed SQL inventory, not complete migration or candidate-flow
acceptance. Applications remains at three ledger entries; 0009 is not recorded.

The original failed execution claim and submitted receipt remain unchanged. Private receipt:
`.terraform/development-document-migration/receipt-a1b4ef2f9c5a-20261008-223710.json` under the
development Terraform directory. Sanitized counts are `.tmp/migration-a1b4ef2f-live-inventory.json`;
raw task/log evidence stays private. There is no blind retry, evidence purge, old approval rehash,
or immutable SQL modification. The next requirement is an explicit historical receipt transition
preserving replay semantics and the existing approval, plus complete packet-shape compatibility
proof under ADR-041. Counts do not authorize disposal of any candidate record.

Mandatory cleanup completes with a fresh safety snapshot, verified private physical restore,
reviewed final-snapshot deletion and removal of the exact temporary copy. Final state **456**
preserves all **289 other managed identities**; the complete-input refresh-backed plan has zero
drift. At **2026-10-09T03:01:04.942017+00:00**, live development readback shows zero database
instances, API routes, enabled rules/mappings, NAT gateways, interface endpoints and non-stopped
ECS tasks. All **12 encrypted manual recovery snapshots** are available; a separate tagged EC2
read finds zero allocated Elastic IPs. Maintained lifecycle drain checks pass.

Canonical recovery inputs, proof and manifest are updated with explicit KMS encryption and ETag
preconditions; exact-version byte/KMS readback passes. Private recovery evidence is
`.tmp/inventory63-*`. These state-456 inputs supersede state 450 for subsequent restoration.

| Artifact | SHA-256 |
|---|---|
| Applied preparation plan | `aa13b36bd5d926fc1a04e0a414405a3fcea79f9757edab73a3b5cfa88761d2d5` |
| Applied dormant plan | `70dc930285557c2ac9225edf3035871c57cf8c8491e297a78c968c1faaed5bcc` |
| Final no-change plan | `6548cf40b6aac7036ea7f748003b87e219cd8beaeac8f035946b8aa388254011` |
| Archived dormant inputs | `b53690eb5c54935fce8526cf2555d716840c39cfe2d7c95d0a9532da1ed203d5` |

Retained snapshots/backups, object/image/log storage, KMS, Secrets Manager and DNS may still incur
charges. Staging readback is still unavailable because its separate SSO token is missing. Docker
Desktop and WSL are stopped; the PC stays on. D1/D3 remain In progress. CI/CD remains deferred.


## Legacy receipt managed composition checkpoint (2026-10-09)

The backend checkpoint adds default-off Gateway replay composition and a separate maintenance
executable. The Gateway gets only matching/decryption authority. Maintenance binds the exact
source, image, database identity, encrypted recovery snapshot, expected historical counts and
short-lived configuration hash; its database URL must explicitly require TLS. Terraform defines
one retained purpose-bound encryption key, a separate one-off maintenance task/role and scoped
private KMS access. Ordinary migration task command/environment/role remain unchanged.
The migration image's build and publication inventory now requires the maintenance executable.

Local evidence from the isolated maintenance branch:

- Applications build and Gateway typecheck pass; 46 configuration/replay unit cases pass.
- Four compiled CLI launches without valid maintenance authority emit only the fixed refusal.
- 194 executable packaging regressions and publisher guards pass without building/publishing an image.
- 21 Terraform mock plans pass, including default-off, exact maintenance role, decrypt-only Gateway,
  packet-protection prerequisite and existing KMS endpoint permissions. No AWS plan/apply occurred.
- 13 real PostgreSQL 16.6 transition cases pass with simulated KMS. Four mismatched count cases
  reject before encryption and preserve the full original snapshot. A full queued-preparation retry
  returns its original operation twice, rejects changed input and leaves packet/preparation/outbox/
  audit rows unchanged. The owned temporary container was removed; Docker/WSL stopped afterward.

The managed operator with fresh AWS drain/snapshot/image attestation is still unfinished. This
checkpoint is not a deployable managed transition or approval to invoke the CLI directly. Full
repository verification, immutable release publication and managed acceptance remain. D1/D3 stay
In progress; accepted candidate manual checks are not reopened and CI/CD stays deferred.
No cloud mutation occurred. Fresh development shutdown readback is blocked by an expired SSO token;
the original sign-in process remains pending. Last successful readback at 2026-10-09T03:52:08Z
showed no databases or active runtimes and twelve available encrypted recovery snapshots. Retained
security/storage/DNS resources still incur charges; the PC stays on.


## Managed legacy receipt operator checkpoint (2026-10-09)

Commit `298d29da` passes the full maintained verifier: 38 typecheck tasks, 39 test tasks, 23 builds,
all operational/security/isolation and Compose checks; lint remains zero errors, 15 warnings and
58 informational notes. Its private log is `.tmp/legacy-maintenance-full-verification.log`.

The next source change implements the separate [managed operator](../../../../scripts/operate-legacy-receipt-transition.ps1)
and [runbook](../../../../scripts/README.md#legacy-application-receipt-maintenance-development-only).
Planning and execution both inspect the exact published image, managed task/role/key/state,
recoverable same-instance snapshot, stopped routes/triggers/queues and all declared native durable
functions. A late state read refuses concurrent infrastructure changes. The permanent claim
precedes the single RunTask; repeat Execute refuses. Recover only observes the original task and
requires its exact identity/image, no overrides, exit zero and matching aggregate output.

172 synthetic operator checks pass, including the complete preflight, source executable absence,
failed image verification, active native work, changed state, interrupted launch/observation,
pending work, wrong task/image, failed exit, extra overrides, wrong aggregate/hash and recovery
with expired launch authority. These are simulated AWS responses, not cloud verification.
The checks are added to the maintained verifier; the new operator's full run remains pending.
No source release, image publication, AWS plan/apply or live maintenance execution occurred.

AWS SSO authorization expired without completing, so fresh shutdown readback remains unavailable.
A new terminal sign-in request is pending. Last successful development observation remains
2026-10-09T03:52:08Z: zero databases/active runtime and twelve encrypted recovery snapshots.
No cloud mutation occurred during either local checkpoint. Docker/WSL remain stopped, PC on,
retained costs acknowledged, CI/CD deferred and D1/D3 In progress.


### Final operator verification

The complete maintained verifier passes in one successful run at **`c03079d2`**: 38 typecheck
tasks, 39 test tasks, 23 builds, all maintained operational/security/isolation checks and Compose.
The newly integrated maintenance suite reports all 172 checks passing. Lint remains zero errors,
15 warnings and 58 informational notes. Private log:
`.tmp/legacy-maintenance-operator-full-verification.log`. The source worktree is clean after the run.
[PR #587](https://github.com/Vrixic/project-ai-job-apply/pull/587) contains the connected batch.

The remaining release gates are immutable image publication/readback, exact managed key/task
provisioning, live transition/replay acceptance and mandatory data-preserving shutdown. An actual
AWS CLI recheck still reports expired SSO credentials; no cloud mutation occurred. Local Docker
and WSL are confirmed stopped. Earlier cloud evidence remains historical, not a fresh shutdown
claim; retained recovery/security/storage/DNS costs remain. D1/D3 stay In progress.

## Reproducible maintenance image verification (2026-10-09)

PR #587 merged as `09020dbd1d48455b038b50189e45dc9740246414`. The maintained publisher's
`LocalBuild` action completed successfully from that clean merged source. Both independent,
uncached Linux/AMD64 OCI builds have identical index, platform, configuration and layer identities;
the hardened runtime inventory smoke passed for all 79 migrations and 96 relations. Dependency
audit passed without exceptions. This local action did not publish an image, run an ECR
vulnerability scan, contact AWS, change Terraform or execute a managed migration.

- Index: `sha256:73fabbd93efef127c1993d81eb125b305117a3e17f64994fa433ff3eb2b2c4ef`.
- Platform: `sha256:d4034a3c7eac8cd11798684e0b67173837d212251a56b912e8dadc4eb49bcef1`.
- Configuration: `sha256:eeee0aaefe5ac76a0bffb64b817530541a8b734b4dd25120f9e1d86577b875d9`.

The actual loaded image additionally passed three compiled maintenance-command refusals:
missing enable flag, explicit false, and enabled with invalid configuration. Each exited one
with only the fixed sanitized failure JSON, under network-none, read-only, non-root,
all-capabilities-dropped and no-new-privileges restrictions. OCI manifest/configuration checksums
and the source revision label were checked before launching the immutable local image identity.
Private logs: `.tmp/legacy-maintenance-local-image.log` and
`.tmp/legacy-maintenance-image-refusals.log`. These checks establish packaging and safe refusal,
not successful managed transition or live KMS/replay acceptance.

Docker Desktop stopped successfully and `wsl --shutdown` completed; no running WSL distribution
or Docker Desktop/backend process remained. The PC remains on. Fresh AWS identity rechecks still
fail with expired SSO credentials. No cloud mutation occurred. The last successful development
shutdown observation remains 2026-10-09T03:52:08Z (no databases/active runtimes; twelve encrypted
recovery snapshots), not a current-state attestation. Retained recovery, storage, security and
DNS resources may still incur charges.

Next: restore AWS access, verify shutdown, publish and scan the immutable image, then provision
the exact managed maintenance key/task and perform live transition/replay acceptance with the
mandatory snapshot-backed shutdown afterward. D1/D3 remain In progress; accepted human checks
and the hosted CI/CD deferral are unchanged.

## Managed legacy transition and shutdown at state 471 (2026-10-09)

Merged source `444c9346d72e8a55b53f087b64058fa064573b6d` was immutably published after two
uncached Linux/AMD64 builds matched and the hardened migration inventory smoke passed. Independent
publication verification confirmed the exact remote image and a COMPLETE ECR scan with zero High
and zero Critical findings. Platform digest:
`sha256:03ca68ca7daa3903f958774053ec26b90c714a507513a88304ea1f389bf74d88`.
Publication receipt SHA-256:
`308a241e4ecc85b184f47616cf7815368804821500e5b16b2224e319b102b145`.

Development was restored from its latest retained final snapshot with traffic and background work
off. The dedicated receipt key, private endpoints and exact image were provisioned through reviewed
plans. An available encrypted same-instance manual snapshot and PITR preceded execution. The
separate maintenance task/role was then deployed with a thirty-minute configuration and no Gateway
replay activation. Its first configuration plan refused because Terraform `timeadd` truncates
fractional seconds: an exact thirty-minute fractional expiry exceeded the computed limit. No task
was deployed or launched from that failed plan. Canonical whole-second `.000Z` issue/expiry values
passed the unchanged limit; the snapshot retained its actual millisecond timestamp.

The managed operator's PlanExecution and repeated Execute preflight both passed against current
state, image, task, key/role, snapshot and drained work. Reviewed execution descriptor SHA-256:
`60f327a1044621846a701cbc742b2fc74c4d89e808832b54f49b7b6b93fa1f6e`.
Exactly one original task was submitted. Recover verified its STOPPED status, exit zero, exact
image/configuration and sole sanitized success aggregate: **seven archived receipts and twelve
applied Applications migrations**, advancing the original three-entry ledger through version 0015.
This is live SQL/KMS transition evidence, including the implementation's atomic preservation and
cryptographic round-trip checks. Gateway replay remains disabled; this does not prove hosted
original-request replay, the complete candidate journey, or full-platform privacy/restore acceptance.

Shutdown completed through reviewed removal of only the dedicated maintenance task/role/policy and
eight temporary interface endpoints. The receipt key was retained. A fresh post-transition safety
snapshot physically restored as a private encrypted instance with the original database key. The
source was deleted with a new encrypted final snapshot and its automated backups preserved; the
exact temporary restore instance was then removed after final-snapshot availability was confirmed.

- Final Terraform state: **471**, preserving all **290** non-database managed identities across
  database dormancy, including the newly retained receipt key.
- Exact dormant-input plan: zero drift, SHA-256
  `072d0042bf53a835ab5433e219e7155e8535aea1af045e33854c1f52c0695fe0`.
- Fresh observation at **2026-10-09T11:39:54Z**: both databases absent; zero API routes, enabled
  rules/mappings, non-stopped ECS tasks, NAT gateways and interface endpoints; **fifteen** encrypted
  manual recovery snapshots available.
- Complete recovery inputs and restore proof were archived with explicit customer-KMS encryption,
  versioning and exact-version checksum readback. Current input SHA-256:
  `41fd9b6eded55c3e4a65b9a5bffae2e7f00681edcd920a03f7f639218842aca9`.
  Private `.tmp/legacy77-*` evidence and recovery manifest supersede the state-456 inputs.

Snapshot/backup, object/image/log storage, retained KMS keys, secrets and DNS resources can still
incur charges. Docker and WSL are stopped; the PC stays on. Staging verification remains unavailable
without its separate SSO token. D1/D3 remain In progress: managed Gateway replay, full migration/
privacy reconciliation and native/client/ATS/accountable acceptance are not closed by this result.
Accepted manual checks are not reopened; hosted CI/CD remains deferred until launch.


## Historical migration-image verification (2026-10-09)

Recording delivery evidence advanced main after the accepted image was published. The publisher's
read-only Verify action consequently rejected that original source before checking its receipt.
Verify now accepts an exact commit merged into the current clean main checkout. LocalBuild and
Publish still require the exact current main source; receipt, immutable image and scan checks
remain unchanged. This attests the historical image, not compatibility with newer deployment code.

Fifteen real-Git checks pass on PowerShell 7 and Windows PowerShell 5, covering current and ancestor
sources, missing/unmerged commits, dirty/untracked files, stale upstream, non-main and detached
checkouts. The publisher suites and 194 packaging cases also pass on both hosts. Full maintained
verification passes: 38 typecheck tasks, 39 test tasks, 23 builds, operational/security guards,
bundle isolation and Compose validation. Lint retains zero errors and the existing fifteen warnings.
Independent AWS Verify against the retained publication remains pending.

AWS access is restored. Read-only observation at 2026-10-09T11:52:06Z confirms no development
databases, enabled rules/mappings, API routes, non-stopped ECS tasks, NAT gateways or interface
endpoints. Fifteen encrypted manual recovery snapshots are available. No cloud mutation occurred;
retained recovery/storage/security/DNS costs remain. Docker and WSL are stopped; the PC stays on.
D1/D3 remain In progress; this operator repair does not close managed journey acceptance.


## Native release shutdown compatibility (2026-10-09)

PR #590's merged operator independently verified the original `444c9346` migration publication:
receipt and immutable image match; scan COMPLETE with zero High/Critical findings. No migration
or Terraform mutation occurred. Current `c386a4c5` Gateway publication passes tests, dependency
audit, two matching builds and independent exact-version readback of all four objects. Its receipt
SHA-256 is `531381328603ee22a8c54dc9b19a167c9747e00d05494679cfd20f9dfdc9f8a0`.
All four native families also published and independently verified at that source: fourteen
artifacts and fifty-six companions after dependency audits and two matching builds per family.
No runtime deployment or activation is claimed by publication. Receipt SHA-256 values:

- NativePreparation: `0fd3d7b06a1b31dfd3537ad9794adc7d40a7f93b84dace25b3b365732d0d4118`.
- NativeMaterialControls: `4980aacb8753133413e215466022ec089509c5d109ceb5f7c08cce0c2883c3ec`.
- NativeResume: `7af3b1de02cec270a68429521fde8c360dc7eec39f40f2a9f1dbe3bf33072307`.
- NativeMaterialCleanup: `cef6b85ad3ee09b79e1185bff0908ae9119bc8a25528c6aa16a4d1215ec32b13`.

Pre-deployment review found that native KMS and ECS/EC2 interface endpoints ignored the existing
paid-endpoint shutdown switch. Both now honor it while retaining queues, release bindings, keys
and security groups. Database dormancy already preserves `persistent_data_plane_enabled`; no queue
precondition change is needed. Development input validation additionally rejects native source,
owner, launch, intake, routing, observation and recovery activity during shutdown, restore or
interface-endpoint removal.
Disabled original release maps remain allowed; normal retained-database activation is preserved.

Final Terraform verification passes **22 platform cases and 32 environment input cases**, plus
platform/development validation. Cases cover retained queues/security groups with endpoints absent,
all native activity flags, normal retained-database activation, snapshot preparation, restore and
endpoint removal independent of database dormancy. These use mocked providers/modules, not live
cloud deployment.
The existing prelaunch shutdown runbook now includes optional native endpoints and explicit native
quiescence. D1/D3 remain In progress. AWS development was independently observed dormant at
2026-10-09T12:02:11Z with fifteen encrypted recovery snapshots; no runtime deployment occurred.
Retained storage/security/DNS costs remain. Docker/WSL are stopped, PC on and hosted CI/CD deferred.


The new input guard refused the first dormant foundation plan because retained resume source-access
RPC flags were still enabled. No apply occurred. Disabling that original release in the complete
inputs produced a valid plan: two retained packet keys and two scoped Gateway policies created,
Gateway function/alias refreshed, and both resume RPCs disabled. No database, endpoints, routes or
triggers are created. This plan remains unapplied. The source RPC numeric versions must be read
back after quiescence and again after the later combined artifact refresh/activation; proposed
image configuration is not deployed-version evidence.

The bootstrap baseline plan preserves all twelve managed resources at state serial 22; its only
changes are five new empty native-boundary outputs. Dedicated native boundaries are still absent
and must be planned with exact release/key bindings before runtime deployment. TLS metadata has
one current version. Live cover-letter testing awaits the development OpenAI API credential's
secure location; no such credential was found in project development secrets or environment.


## Dormant foundation and bootstrap policy sizing (2026-10-09)

The reviewed foundation plan was applied after PR #591 merged. Platform state **473** preserves
all 290 prior managed identities and adds two retained packet keys and two scoped Gateway policies.
Gateway version **88** uses the independently verified `c386a4c5` artifact and an unweighted alias.
The two original resume source-access RPCs are version **2**, disabled; their artifact source was
not refreshed. Actual Lambda/KMS/IAM readback and a complete-input zero-drift plan pass. Public
routes, triggers, endpoints and the database remain absent; this is configuration deployment,
not live candidate acceptance. A future resume image must use the numeric RPC versions actually
published by its later combined artifact refresh/activation, not assume a proposed version.

Applied foundation plan SHA-256:
`5cbcdde48d76acb4e6046df6b577c989d503d77e6504e9fea718c974b3d81344`.
Complete dormant input SHA-256:
`9ce5c0fa3ddab6b4ba7ab1d10f13e32fbc78d74533c121782b1b153b32a58c1c`.
Versioned canonical dormant inputs, unchanged database restore proof and recovery manifest were
archived with customer-KMS encryption and exact-version hash readback. Retained recovery data
was not restored or altered by the foundation apply.

The first populated bootstrap plan was refused before apply: its deployment policy reached
**6,429 characters**, exceeding the 6,144-character guard. The former combined mocked fixture
used staging names and omitted the preparation download route. A new development fixture includes
both routes and all three native families. Identical unconditional stack-management and policy-read
grants now share their original statements; resume role-creation conditions remain separate.
A duplicate starter queue-key decrypt grant is omitted only when configuration decrypt already
covers the exact same key and principal. A distinct queue key keeps its original grant.

**24 bootstrap mock tests** pass, including exact development stack/boundary sets, constrained
resume role creation and distinct queue-key retention. Bootstrap validation, recursive Terraform
formatting and the infrastructure-policy validator pass. Fresh development planning succeeds:
six native boundary policies added, existing deployment boundary/inline policy and workload boundary
updated, no deletes or non-IAM mutations. The deployment policy is **5,906 characters**, and the
preparation boundary is **5,937**. An independent expansion of action/resource/condition grants
matches the failed deployment-policy proposal exactly. All managed policies fit the size guard.
This bootstrap plan is **unapplied**; source tests and a valid plan do not establish effective IAM.
Reviewed plan SHA-256: `1af127889ada1cff247fc6a3c02a7be47be9828a0bbb1a53a0a208b224cb7343`.

Fresh AWS observation at **2026-10-09T12:35:55Z** confirms no development databases, API routes,
enabled schedules/mappings, non-stopped ECS tasks, NAT gateways or interface endpoints; fifteen
available encrypted manual recovery snapshots remain. Recovery storage, images/logs, keys, secrets
and DNS can still incur charges. Docker/WSL remain stopped and the PC stays on. AWS access is
restored; the secure development OpenAI credential location remains requested. D1/D3 remain
In progress, with connected managed acceptance and other phase gates still open. CI/CD is deferred.


### Managed bootstrap verification

After [PR #592](https://github.com/Vrixic/project-ai-job-apply/pull/592) merged at `f588cb98`,
a fresh plan matched the reviewed changes exactly and was applied with clean-source, account,
backend, state-lineage/serial and plan/input hash guards. Applied plan SHA-256:
`c29139cede67f80012b1c3b4092e4211244d7acb8214e7ad91c39a6b9e1d2447`.
Bootstrap state **23** preserves all twelve prior managed identities and adds six original native
boundary policies. Direct AWS readback verifies all eight managed policies, deployment inline
policy, unchanged OIDC role trust/boundary and customer-KMS state encryption. A complete-input
refresh-backed plan reports **no changes**. This supersedes the unapplied bootstrap checkpoint above.

Complete bootstrap input SHA-256:
`bbf007125ae870a3bfe9547fb4ff856fc4dbf0fc2dd9bb121d57ad5f5c8386c6`.
Inputs, verification and reviewed-plan metadata are archived in versioned customer-KMS storage
under `lifecycle/development/bootstrap/native-connected-f588cb984413/`, with exact-version hash
readback. Platform state remains **473**; no database or application runtime was started.
These future release ceilings do not verify yet-unpublished function/task numeric bindings.

Final read-only development observation at **2026-10-09T12:41:30Z** confirms zero databases,
active ECS tasks, API routes, enabled rules/mappings, NAT gateways and interface endpoints, with
fifteen available encrypted recovery snapshots. Docker backend and running WSL distributions are
absent. The PC stays on. Retained snapshots, object/image/log storage, keys, secrets and DNS may
incur costs. D1/D3 remain In progress; connected candidate acceptance is still pending.


## Native image security and network checkpoint (2026-10-09)

A reviewed IAM/network-only follow-up provisions the dedicated resume task security group with
**no inbound rules**, retaining TLS egress. Platform state **474** preserves all 294 prior managed
identities and adds only that group. AWS readback and a complete-input no-drift plan pass. Canonical
versioned dormant inputs and recovery metadata have exact customer-KMS readback verification.
Applied plan SHA-256: `b98b1fa74f88b6d7d4e916606b2b6f643446009e137372d7d94bbd171417756a`.
Dormant input SHA-256: `e7a7d1206f076b874ab4388c35de8ce271c90e7db5fa0762dadbe3fdfd9b82cd`.
No database, public route, scheduler, task or paid endpoint was started by this change.

The configured native resume image at source `f8cc7de8` passes its hardened synthetic image check:
24 runtime assertions, actual PDF/DOCX files, authenticated HTTPS and kernel SIGKILL with no OOM.
The first verifier attempt reached Docker cleanup failure; the exact container was confirmed
absent and an unchanged-image retry passed in 6,855 ms. Its configured RPC version 3 remains a
proposal; current source-access RPCs are disabled version 2, and no task revision exists.

Exact ECR manifest/config/rootfs readback passed, but the completed OS scan reports **26 High and
8 Critical** findings. The image is retained as rejected evidence and must not activate. The scan
CLI initially failed encoding a non-ASCII advisory; UTF-8 readback recovered the actual completed
findings without republishing. This is an image security blocker, not an AWS credential failure.
The vulnerable source packages include glibc, OpenSSL, Perl, SQLite, PCRE, util-linux and zlib.
Debian records fixes for [glibc](https://security-tracker.debian.org/tracker/CVE-2026-5450) and
[OpenSSL](https://security-tracker.debian.org/tracker/CVE-2026-63073), while its
[zlib advisory](https://security-tracker.debian.org/tracker/CVE-2026-85091) remains unresolved.

Both native image Dockerfiles now use digest-pinned Node **24.21.0 / Alpine 3.23** and the existing
migration runtime's checksum-verified OpenSSL **3.5.9-r0** and zlib **1.3.2-r1** packages. Runtime
package-manager tools are removed while the accurate signed-package inventory and CA bundle remain.
The builders select the locked canvas binary matching the build libc; Alpine uses musl. Kernel,
application logic, authentication, lifetime, immutable bindings and permissions are unchanged.
Native image conformance and musl deadline regression are required before merging this packaging
change; a fresh exact-image registry scan is required before release activation.


### Patched runtime local verification

Source `d9136248` passes the actual-image resume check (24 assertions, real PDF/DOCX files and
kernel SIGKILL with no OOM) and all **five** cover-letter image scenarios: original and version-two
rendering, sealed reads, secret-version refusal and TLS-host refusal. AWS/provider/OIDC ports remain
synthetic and networking is disabled. Both images report Node 24.21.0, musl canvas, the exact pinned
OpenSSL/zlib package versions, absent npm/apk tools and the retained package database.

The first source-level musl regression ran concurrently with both native builds and exceeded
several unchanged child deadlines and its 180-second overall budget. An unchanged focused case
passed, then the complete maintained rerun passed **42/42** cases in **144.6 seconds** after the
native builds finished. No kernel, child deadline, assertion or test budget was relaxed.
JavaScript syntax/format checks and the infrastructure validator pass. These checks establish local
image behavior; patched-image publication and its completed zero-High/Critical registry scan remain
required. The rejected Debian image is still withheld, and no connected AWS candidate flow is claimed.


## Verified resume image and dormant task registration (2026-10-09)

PR #594 merged the runtime security correction as `c66b458c04616278385c980a61a1972f9c49defa`.
The configured resume image from that source passes 24 hardened packaged-runtime assertions,
including two real generated files, HTTPS and kernel deadline termination without OOM. External
AWS/OIDC ports remain synthetic and Docker networking is disabled during this test.

The immutable image was published with exact remote manifest/config/rootfs readback:

- Platform/index digest: `sha256:2e0b122982d8a4750fb6f2c32e6cf151c763267a1f2d51bd89d2e7a70d4b6c6b`.
- Configuration digest: `7b07fa4a2a405fe8210b0fc14137c4faa8cf2aa835bf0617dabd52c8a181c450`.
- Publication receipt SHA-256: `121440ca80ff8f41f1ecaac3152bb12d4ccadb63ee2bf15cc4cb595feee50028`.
- ECR scan COMPLETE with no reported findings; independent scan readback agrees. The previous
  Debian image with 26 High/8 Critical findings remains rejected and was never activated.

The separately published migration image from merged source `f8cc7de808c0cd0b101940c073724be42474bf92`
also passed its two reproducible builds, hardened runtime check, registry scan (zero High/Critical)
and independent Verify action. Platform digest is
`sha256:738b646ced6bf71a9fc5bb58e5d743af385fc0a7bbd345434412cdb886419c02`; receipt SHA-256 is
`7f20e828811c071381b201069b5eed5464a7e5da6452c942c8b47017a3d1e378`. No migration was run in this batch.
Future operators must still enforce their source-compatibility gates.

Development platform state **475** registers the exact native resume task definition revision 1
and its two bounded IAM roles/policies. All 295 pre-existing managed identities are preserved;
only five resources were added. Independent ECS and IAM readback verifies the original image,
read-only non-root container, resource limits, trust, boundaries and policies. No task was launched.
The image expects original RPC versions 3; deployed versions 2 remain disabled. Activation must
publish/verify those exact recipients together with the required prepared runtime dependencies.
Task registration alone does not establish a working candidate path.

The first follow-up plan exposed ECS adding empty environment, mount, volume, system-control and
capability-add arrays. Omitted defaults caused Terraform to propose replacing the image-pinned
revision. That replacement was not applied. Both native task modules now explicitly declare
those empty arrays; the corrected source produces a fresh complete-input **zero-change** managed
plan against state 475, preserving revision 1. IAM, image, process gates and deadline behavior
are unchanged. Maintained module assertions check that the collections remain empty and all
capabilities remain dropped. All 13 Terraform mock cases pass (five resume, eight material);
the infrastructure guard, formatting and whitespace checks also pass. The managed zero-change
plan supplies the actual ECS round-trip evidence; mock tests alone do not establish that behavior.

Exact dormant inputs (SHA-256
`c0a0b35741a60b79f86a968b9132671ec3e6ea8638f7078baf059cfeb8560ad3`) and the retained restore proof
were archived under the canonical versioned, customer-KMS recovery keys; exact-version readback
passes. These inputs supersede states 473/474. Public download DNS delegation matches the
retained Route 53 zone. The exact TLS certificate version covers the wildcard download host and
is valid through 2027-01-06; only public certificate metadata was recorded.

Shutdown observation at **2026-10-09T13:16:24Z** confirms zero development database instances,
enabled schedules/consumers, public API routes, live NAT gateways/interface endpoints and
non-stopped ECS tasks. Fifteen encrypted available manual recovery snapshots remain. Retained
snapshots, object/image/log storage, keys, secrets and DNS continue to incur charges. Docker
Desktop and WSL are stopped; the PC stays on.

D1/D3 remain **In progress**. Resume preparation/control deployment, original RPC activation,
connected authenticated generation/download/retirement, the cover-letter provider credential,
and the outstanding client/ATS/accountable acceptance gates remain. Prior accepted manual checks
stay accepted and hosted CI remains deferred until launch.


## Disabled resume preparation deployment correction (2026-10-09)

The reviewed complete-input plan adds the original resume preparation functions, durable workflow,
recovery queue and cleanup worker with all runtime/schedule gates disabled. Its two existing-resource
updates preserve platform KMS statements and add original-task HTTPS secret access. No database,
endpoint, NAT, task definition replacement or launch is part of the plan.

AWS stopped the first apply because the cleanup target omitted EventBridge's delivery-age value;
the provider submitted zero, below the service's 60-second minimum. Partial state 478 retains 318
managed identities, including the original 300. No runtime was enabled. The original plan will not
be replayed: recovery requires a fresh plan against that partial state.

The cleanup target now explicitly uses a 60-second maximum event age and zero delivery retries,
matching the other periodic native sweeps. Six maintained Terraform mock cases, including the
service-minimum assertion, and the infrastructure validator pass. Managed completion, independent
readback, recovery archive and zero drift remain pending. D1/D3 remain In progress.


### Managed preparation recovery verified

PR #596 merged the delivery-age correction as `dc115efaaa53789759005b15c227612dac4714ff`.
A fresh reviewed plan from partial state 478 created only the 32 remaining resources; it did not
replay the failed plan or replace retained identities. The resulting development state is **480**:
all 300 original managed identities are preserved, with 50 additions across both applies.

Independent AWS readback at 2026-10-09T13:29:04Z verifies:

- Resume control, durable workflow, dispatch and observer at numeric version 1; cleanup worker
  also at version 1. All five match their immutable published code hashes and have runtime gates off.
- Five bounded IAM roles and ten inline policies match the applied trust/boundary/policy documents.
- All six event rules are disabled; all six targets bind the intended recipients and retry policies.
- The durable workflow retains 2,400-second execution and seven-day history limits. Cloud Control
  independently confirms its customer-managed state-encryption key; the Lambda configuration
  response omits this field. This is configuration verification, not an executed recovery drill.
- The original recovery queue is empty, customer-KMS encrypted and retains messages for fourteen days.
- No ECS task launched. The earlier exact task definition remains revision 1; original source/owner
  RPC versions 2 remain disabled and image-bound version 3 is still an activation prerequisite.

The fresh complete-input plan reports **zero drift**. Recovery plan SHA-256 is
`01333c87b450721678f048bf67e50d3f56e15a526e4e0070f60c620d97d92557`; complete dormant input SHA-256 is
`4ce15b4c480cf0e5c50a1bf3145ef3ca429c123a2eff2f46f7f0cd4e4b7d57fe`.
Canonical versioned customer-KMS recovery inputs, restore proof and manifest were updated and
verified through exact-version readback. State 480 supersedes the state 475 inputs.

Shutdown observation at **2026-10-09T13:27:44Z** confirms zero database instances, enabled rules or
consumers, public API routes, live NAT gateways/interface endpoints and non-stopped ECS tasks.
Fifteen encrypted available manual snapshots remain. Retained monitoring, snapshots, object/image/log
storage, keys, secrets and DNS can still incur charges. Docker/WSL remain stopped; PC stays on.

This closes disabled resume-preparation/cleanup deployment only. Gateway native composition,
restored database readiness, exact RPC activation, authenticated generation/download/retirement,
cover-letter provider configuration and the remaining candidate/client/ATS/accountable acceptance
gates are still open. D1/D3 remain In progress; accepted manual checks and CI deferral are unchanged.


### Dormant Gateway resume bindings verified

At merged source `7aeb0c96b5a048915057eabfae4ac885b8e612fd`, the reviewed three-resource plan
adds only the original resume download hostname, original task disposal binding and scoped
Gateway disposal policy. Existing packet protection and legacy receipt replay remain configured;
all native runtime switches remain off. The Gateway artifact is unchanged.

Development state **481** independently verifies Gateway version **89**, an unweighted alias,
exact environment/code identity and the original-cluster DescribeTasks/StopTask policy. All 350
previous managed identities are preserved; only one IAM policy is added. No task or API route
was activated. The full-input refresh-backed plan reports zero drift.

Applied plan SHA-256: `e18c074872733700b450b81e22203778394772d6439e716bbf8dd868096b6904`.
Complete dormant inputs SHA-256: `19d678365c1d436a8da315eb0ba76eb0e6df5f6dd4976f2fe5b973c5772c07e2`.
Canonical versioned customer-KMS recovery inputs/proof/manifest were updated and exact-version
readback passed. These inputs supersede state 480.

Shutdown observation at **2026-10-09T13:36:21Z** confirms zero database instances, enabled rules
or consumers, public API routes, live NAT/interface endpoints and non-stopped ECS tasks.
Fifteen encrypted available recovery snapshots remain. Retained storage, monitoring, keys,
secrets and DNS continue to incur charges. Docker/WSL remain stopped; PC remains on.

Connected acceptance is still pending. In-app browser control is unavailable in this session and
the local sign-in application is stopped. The local identity configuration has the required
client settings but does not enable Applications scopes; the earlier deployed-web real-token
Applications acceptance remains valid historical evidence. Prepare the controlled sign-in/test
session before restoring paid runtime resources. No token, cookie or secret value was recorded,
and no existing accepted manual checks were reopened. D1/D3 remain In progress.
