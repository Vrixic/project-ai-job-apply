# D1 report review status in portable exports — 2026-10-06

Status: local implementation; D1-012 remains In progress. Backend-only; no hosted activation.

The accepted D1P-06 policy requires the candidate's retained report reason/status and relevant
audit metadata in export. Previously, Jobs exported reason/creation metadata with no review
status. Forward migration `0027_candidate_report_export_status` preserves existing contribution
and audit projections, adding received/under_review/resolved from the exact immutable report-case
link. A resolved case does not attest report accuracy or disclose its moderation decision.
No operator identity, case identity, other reporter, request/idempotency hash or provider payload
is added. The export remains owner-scoped; expired/deleted reports remain absent.

Portable export v1 admits the optional fixed status field, preserving historical artifacts.
Deploy schema-aware export workers before the migration, because older strict validators refuse
the new field. Keep those consumers deployed on rollback after migration; no old export contents
are rewritten. Public candidate report API and client source are unchanged.

## Local evidence

- All 119 Jobs PostgreSQL tests pass, including two new status/owner-isolation cases. They exercise
  received → under_review → resolved, absence of moderator/case/neighbor/hash fields, unchanged
  creation audit, an unrelated closed same-job case and an empty unrelated-owner export.
  Log: `.tmp/d1-report-export-sql.log`.
- Domain 28 tests and restore 50 tests pass. The new schema check accepts historical exports and
  all three statuses, rejects unknown statuses and privileged metadata. All 207 focused restore
  contract tests pass. Logs: `.tmp/d1-report-export-units.log`,
  `.tmp/d1-report-export-restore-contract.log`.
- Actual historical Jobs 26 → 27 upgrade and migration replay pass. A previously linked report
  gains under_review, then resolved; original report values, contribution and audit sections
  match their pre-upgrade projections. Log: `.tmp/d1-report-export-upgrade.log`.
- Local logical dump/restore matches the maintained seven-owner boundary at 69 migrations and
  92 relations, including the exact restored Jobs export. Manifest SHA-256:
  `928ecaf89bc1ccaf0e64b657ba1aaff9803ade2f69fb2f8b3d355260e619021d`.
  Log: `.tmp/d1-report-export-restore.log`. No deployed PITR/deletion-ledger replay is claimed.
- Two contract generation passes leave generated public API contracts unchanged.

All SQL uses generated-only data in an owned temporary PostgreSQL 16.6 tmpfs fixture. No raw
candidate artifacts or browser credentials are read or retained. Full clean-source verification
is pending. Hosted export acceptance, maintenance release, privileged audit/alert retention and
accountable rights review remain open. CI/CD stays deferred until production launch; the PC
remains on. No cloud state change, third PR, real-data approval or D1/D3 completion is claimed.

The first full run at `4c28f059` passes formatting/lint, 38 typecheck tasks and the operational
guards, then stops on two existing 16 MB Ashby byte-limit fixtures exceeding the five-second
test timeout. This repeated full-suite timing failure also occurred during the preceding retention
batch. Those two byte-budget tests now freeze logical performance/timer time and use a 30-second
test-harness allowance, isolating acquired-byte accounting from host scheduling. The production
five-second request deadline, 16 MB byte limit and separate header/body/cancellation deadline
tests are unchanged. Timer cleanup is asserted. All 586 ingestion unit tests pass after this
test-only correction. Log: `.tmp/d1-report-export-ingestion-clock.log`.
Jobs SQL and export schema are unchanged by the correction; clean-source full rerun is pending.

The rerun at `a3fc9211` passes ingestion, then exposes a separate Documents late-launch fixture
using a real 10 ms deadline while polling for fake RunTask dispatch. Under full-suite scheduling,
the deadline could expire before dispatch, so the intended fulfilled-late-response scenario never
started. That fixture now waits on an explicit dispatch promise under logical time, then advances
past the timeout and fulfills the original task. It verifies one RunTask, retained admission,
positive task capture before timeout refusal and no surviving timer. Production launch code and
its deadline are unchanged. All 1,438 Documents unit tests pass; log:
`.tmp/d1-report-export-native-clock.log`. The original rerun handle is terminal before this edit.
The final clean-source full run follows this second test-only correction.
