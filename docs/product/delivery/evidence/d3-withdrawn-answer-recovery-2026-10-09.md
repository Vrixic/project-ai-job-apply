# D3-088: Withdrawn-answer recovery — 2026-10-09

Locally verified implementation batch based on main `3b42968f`; merge reference follows below.
[ADR-047](../../../adr/047-withdrawn-answer-application-recovery.md) records the compatible-reader
rollout and boundary. No live release or acceptance is claimed.

The owning reader still refuses corrected, removed and expired selected answers. Its distinct
internal refusal permits an explicit metadata-only Application projection with no packet,
approval, values, hashes or materials. Read/search/reopening/reconciliation no longer fail solely
because of that known withdrawal. Other operational failures remain unavailable. Persisted
status/revision/attempts and immutable packets are unchanged. Approved withheld presentation is
re-review. Web clears remembered entries, offers fresh preparation only in permitted states and
hides Apply. An existing manual attempt still needs explicit reconciliation; not-submitted still
requires duplicate-risk acknowledgement. Fresh packets require fresh review and approval.

Executed local evidence:

- API contracts: 116 cases; protected projection/store units: 23; web review/workspace/Apply: 65, plus the strengthened memory-conflict regression (33 workspace cases).
- Real local PostgreSQL Gateway selected-answer composition: 45 cases, including three withdrawal
  recovery paths through fresh review/approval/manual confirmation/history and both reconciliation
  outcomes. Four old assertions expected presentation-time 503 after committed invalidation;
  they now require the truthful `approval_invalidated` response, no attempt and withheld metadata.
  Existing not-submitted status is approved, so recovery explicitly reopens it; no status bypass.
- Real Chromium recovery runner passes reopening/fresh preparation and withheld-attempt
  reconciliation, duplicate-risk disabled action, content absence and accessibility checks.
  Authentication/API replies are synthetic; no employer action or live acceptance.
- Private PostgreSQL: 27 cases pass, including correction/deletion during decrypt, original expiry,
  rights-authorized original-value export and strict owner/revision/protection refusal.
  Initial private-suite setup
  found a stale expected migration message (0011 versus current0015); the expectation was repaired.
- Extension handoff: 26 cases pass, including withheld final response refusal. All three actual
  Chromium runners pass: recovery, CSP/selection/manual handoff, and search through confirmed
  history with synthetic native resume/cover-letter preview/download/expiry. Authentication and
  provider/API responses remain simulated.
- The maintained `scripts/verify-phase0.ps1` completed successfully in one invocation: all 41
  steps, including 39 typecheck/dependency tasks, 23 production builds, 40 package test tasks,
  dependency security, bundle isolation and Compose configuration. Web: 895 cases; extension:
  537; Applications: 472; Documents: 1,937; Gateway: 379 with 133 opt-in SQL skips. Those skips
  are not executed integration evidence; the 72 relevant SQL cases ran separately above.
  Two regression assertions were strengthened during the run; the final package tests include
  them, and final web typechecking/format/lint were repeated successfully. Lint retains the
  existing 15 warnings. No verifier, dependency, infrastructure or CI configuration was changed.
- A second contract generation is byte-identical and `git diff --check` passes.

PostgreSQL is stopped, Docker Desktop shut down gracefully and WSL has no running distributions.
No test runtime is retained for convenience; only volumes and owned synthetic SQL data remain.

Docker startup initially failed on stale AF_UNIX socket files. With Docker stopped, runtime-only
socket paths were preserved under dated sibling names and fresh runtime paths created. No volume,
image, database, configuration, credential or secret content was deleted. Docker then started;
synthetic SQL databases are owned by this test batch. Shutdown evidence will follow verification.

Remaining D3 gates remain unchanged: authorized provider-form fixtures/adapter acceptance,
compatible managed release, live identity/native/generated-material journey and accountable
privacy/security/provider-retention/rights/restore acceptance. Independent D1 acceptance remains
deferred. AWS access/checks are sequential per owner; this batch makes no cloud mutation.


Fresh read-only staging status at 2026-10-09T21:55:09Z confirms dormant: no database, managed
interface endpoints, public runtime routes, enabled event mappings/rules, document processor or
queued messages. Development was last independently dormant at 18:40Z, with no later mutation;
its SSO access is sequential with staging per owner. This is not a fresh development read.
Retained recovery snapshots, object/image/log storage, monitoring, keys, secrets and DNS can
incur charges. Docker/WSL are verified off; the PC remains on.

Local command logs are retained under ignored `.tmp/d3-withdrawal-*`: `pg.log`, `private-pg.log`,
`verify.log`, `browser.log`, `handoff-browser.log`, `connected-browser.log`, `contracts.log`,
`unit.log`, `web.log`, `memory-regression.log`, `extension.log`, `final-types.log`,
`final-format.log`, `final-lint.log` and `staging.log`. Contract regeneration is byte-identical;
local Markdown links and diff checks pass. These logs contain synthetic test data only.
