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
operator test must run after committing because it reads git HEAD rather than working-tree files.
Logs: `.tmp/native-withdrawal-{build-final,typecheck,unit-final,resume-final,migrations-final,
runtime-smoke,publisher,deletion-replay}.log` and `.tmp-native-withdrawal-integration.log`.
D1/D3 remain In progress. CI/CD stays deferred; no cloud publication, deployment or activation.
