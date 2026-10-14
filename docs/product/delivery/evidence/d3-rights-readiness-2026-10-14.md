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
selectors to `ai-job-apply-development-shutdown-20261013213003`. No historical plan is reused;
independent input review passes. Fresh managed plans, review and runtime readback remain required
before candidate MFA.

Development AWS SSO was expired on initial inspection, so fresh shutdown verification was blocked.
The last verified cloud shutdown remains `2026-10-14T02:05:48Z`. Docker/WSL and the preserved D3
PostgreSQL fixture were observed off at `2026-10-14T16:26:01Z`; an unrelated Windows PostgreSQL
service on port 5432 was left untouched. Staging was not accessed or changed; its last verified-off
observation remains October 11. Retained backups, storage and security resources incur charges.

The owner is available for fresh candidate MFA and exact disposable-account confirmation.
Account deletion has not started. The supported session plan uses `ResumeFixture: true` and
`ApplicationsInventory: true`; it omits `RestrictedAnswerFixture` for the existing vault.
Only the in-app browser is connected. Installed-extension acceptance, authorized Greenhouse QA
fixtures/destinations and exact-variant authority, the qualifying 30-minute all-copy AI policy,
and accountable acceptance remain open. Live AI and employer submission stay off. D3 remains
In progress; independent D1/admin acceptance remains deferred.
