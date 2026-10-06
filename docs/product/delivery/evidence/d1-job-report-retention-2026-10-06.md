# D1 candidate-report retention — 2026-10-06

Status: locally verified owning lifecycle; full repository verification pending. D1/D3 remain
In progress. Backend-only branch `feat/d1-report-retention` starts from the working-development
connection batch on freshly fetched main `88f8ae84`; no cloud mutation or hosted CI/CD work.

## Implemented behavior

Accepted `d1-governance-v1` D1P-06 requires reporter/request/idempotency data to expire after the
later of receipt + 90 days and linked case closure + 30 days. Jobs previously had neither case
linkage nor an expiry path. Forward migration `0025_job_report_retention` links each report once
to the first same-job review interval: a case active at receipt or opened during the original
90-day window. Explicit case opening links retained unlinked reports, without automatically
opening cases, blocking jobs or pausing sources. Historical backfill uses target/time intervals;
it is an integrity association, not evidence that a human reviewed an individual report.

Open cases retain linked reports. The execute-restricted maintenance function uses database time,
immutable linkage, per-job serialization and row locks to remove whole expired reports and links,
including owner/request/idempotency data. It preserves only per-job fixed-reason totals. Moderation
summaries combine active reports and these totals in one query. Confirmed candidate deletion
remains immediate and adds no retained aggregate. Public API/event/domain shapes are unchanged.

The standalone owner composition defaults off, accepts only a bounded batch size and performs one
atomic batch with statement/idle/lock bounds. It prints aggregate counts or a sanitized failure,
never report/candidate rows. PUBLIC has no execution grant to the maintenance or helper functions.
Migration verification checks exact function bodies, search paths, definer/execute boundaries,
enabled triggers and foreign keys. Restore and migration-image boundaries include the new SQL and
both owned relations, without weakening previous exact-boundary assertions.

Rollout: migrate before new Jobs readers; deploy aggregate-aware readers before enabling cleanup.
Disable cleanup for a code rollback. Deleted candidate linkage cannot be recreated. Hosted
scheduling, runtime/principal grants, release acceptance, case/control/audit/alert expiry and the
remaining policy/export requirements remain open under D1-012/D1-007. Real candidate reports are
not authorized by this source change.

## Executed local evidence

- All 109 Jobs PostgreSQL checks pass, including nine new retention cases: 90-day expiry, open
  cases, both sides of case opening, both receipt/closure deadlines, immutable evidence/linkage,
  ordinary premature-delete refusal, bounds/concurrent retries, aggregate correctness and immediate
  privacy-authorized deletion. `.tmp/d1-retention-jobs-all-sql-final.log`.
- The actual 24-to-25 upgrade is exercised on four generated historical reports: three exact links
  backfill; the unlinked/old-closed reports expire; recent-closed/open reports remain; all four
  moderation totals remain one. A second migration pass succeeds. `.tmp/d1-retention-upgrade-final.log`.
- A local logical dump/restore matches seven owners, 12 schemas, 90 relations and 67 migration
  checksums using the maintained read-only verifier. Restored report/link/total counts match the source.
  `.tmp/d1-retention-restore-final.log`. This is local logical restore evidence, not deployed PITR
  or candidate-deletion-ledger replay acceptance.
- All 50 restore-verifier units pass, preserving historical boundaries rather than treating old
  releases as current evidence. `.tmp/d1-retention-restore-units-final.log`.
- Two contract-generation passes leave generated contracts unchanged. Disabled maintenance refuses
  before opening a database connection. Full repository verification remains pending.

The first full run at `85d8ce1e` passes 38 typecheck tasks and 38 of 39 workspace test tasks,
then stops on the restore-contract source-byte assertion. The TypeScript/PowerShell replay
contracts still pin the prior manifest hash. Both exact pins and the generated fixture's dependent
configuration/inspection digests now bind the new manifest, without a fallback or relaxed check.
All 207 focused TypeScript restore-contract tests pass; cross-runtime guards and the full
corrected-source rerun are pending. The Jobs migration/lifecycle SQL is unchanged by this fix.

PostgreSQL 16.6 runs only in an owned temporary local Docker fixture with tmpfs storage; all data
is generated synthetic. The first focused attempt exposed an ambiguous SQL column and a missing
catalog test option, both corrected. An intermediate integration attempt reused prior fixture
data and collided with a global synthetic-search assertion; the final suite passes on a fresh
fixture, and new fixture text avoids that unrelated global search term. Upgrade verification also
corrected its harness's transformed column names. No implementation safety guard is disabled for
cleanup; test-only clock aging temporarily bypasses the immutable-report update guard inside one
local transaction and restores it before exercising retention. No production data, auth, transport
or cloud acceptance is claimed.
