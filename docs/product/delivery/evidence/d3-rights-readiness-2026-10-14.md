# D3 rights readiness — 2026-10-14

## Implemented and locally verified

D3-133 repairs only `scripts/tests/candidate-rights-resume-fixture.tests.ps1`.
The suite previously reached the real export-cleanup helper with an incomplete synthetic runtime
and failed on its missing `ExportBucket`. The orchestration test now mocks that existing boundary,
asserts completed-marker/export-cleanup/resume-prefix/health ordering and the verified export count,
and injects an export-cleanup failure that must prevent prefix verification and completion.
Product behavior, deletion authority, contracts and cloud configuration are unchanged.

- Resume fixture: 293 synthetic assertions pass in PowerShell 7 and Windows PowerShell 5.
- Direct export-cleanup helper: 22 synthetic cases pass.
- D3 rights acceptance guards: 23 synthetic assertions pass.
- Auth package build and 67 serial rights session/operator tests pass after frozen dependency repair.

These tests do not establish live account deletion or all-version owner cleanup.

## Runtime preparation and remaining evidence

The initial checkout was clean `main` at `55c52edcb94cf9f0f098a49a048dd9a345ee78c0`.
New ignored full144 restore inputs preserve the archived dormant baseline and bind both snapshot
selectors to `ai-job-apply-development-shutdown-20261013213003`. New independently reviewed plans
restored the exact encrypted private database with 35-day backups. A new encrypted safety snapshot
binds its physical source. Current schema, including migration 0018, passed inspection; the completed
migration and legacy claim were not relaunched or modified.

After human SSO renewal, pre-restore development shutdown was verified at `16:38:09Z`.
The maintained primary replay validated two already-reconciled completed markers, with zero new
user reconciliations, object/ledger writes or Auth0 calls. Its temporary executor was disabled,
drained for 330 seconds and deleted. All 594 Lambda function/version entries showed zero users
of the temporary role. Actual role/inline-policy absence, three exact endpoint policies and the
21-statement bootstrap boundary passed after the reviewed removals.

Fresh networking and two scanner stages passed independent plan review and actual AWS readback.
Final readiness plan `2928a965…62832f` has zero managed, data-source and output changes; all 177
checks pass. Maintained D3 ResumeFixture Status confirms the exact eight-owner policy, backup and
Auth0 authority, thirteen empty queues, zero active work and healthy alarms. This is runtime
readiness, not candidate deletion acceptance. Final shutdown after testing remains mandatory.

Docker/WSL and the preserved D3 PostgreSQL fixture were observed off at `16:38:52Z`; an unrelated
Windows PostgreSQL service on port 5432 was left untouched. Staging was not accessed or changed;
its last verified-off observation remains October 11. Retained backups, storage and security
resources incur charges.

The owner completed fresh candidate MFA and private exact disposable-account confirmation.
The reviewed schema-3 plan `8e8cacb5…d0ba5e` selected `ResumeFixture: true` and
`ApplicationsInventory: true`, with 17 fixed steps and no restricted fixture for the existing vault.
Its single Execute stopped with a recovery-required failure. The bounded `18:25:50–18:28:10Z`
Gateway audit contains one `GET /v1/resumes` 200 and no upload registration, export or deletion
request. No candidate API mutation was observed; the original attempt remains preserved.

## D3-134 resume response cache policy

The strict operator requires `Cache-Control: no-store` on these authenticated responses. Both
resume-list and upload-registration handlers omit it. The preserved deployed Gateway 116 ZIP
(`f1828f08…a262a3`, source `6d6426b5…48cdf`) confirms the same missing decorators in its compiled
handlers; adjacent resume deletion already uses the established header pattern. An absent header
throws before the fixture's empty-inventory check, explaining the first-read refusal.

The focused fix adds the two producer decorators and assertions in the existing in-process
resume route test. That test fails before the fix and passes afterward (one selected test;
110 skipped). Gateway dependency build, Gateway build and Biome on only the two changed files
pass; independent source review finds no issue. The operator's strict cache policy stays unchanged.
A new immutable release, reviewed plan and fresh MFA session must
precede any new lifecycle attempt; the original Execute will not be repeated.

Only the in-app browser is connected. Installed-extension acceptance, authorized Greenhouse QA
fixtures/destinations and exact-variant authority, the qualifying 30-minute all-copy AI policy,
and accountable acceptance remain open. Live AI and employer submission stay off. D3 remains
In progress; independent D1/admin acceptance remains deferred.
