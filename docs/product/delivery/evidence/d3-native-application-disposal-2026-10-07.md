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
