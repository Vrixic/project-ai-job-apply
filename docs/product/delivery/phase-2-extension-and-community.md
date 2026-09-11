# D2 — Extension and Community Loop

- Status: In progress
- Start: 2026-09-01
- Completion: Not completed
- Owners: Platform engineering; product owner
- Last updated: 2026-09-11
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md#d2--extension-and-community-loop)

## Objective

Deliver a minimum-permission browser extension that lets users preview selected public posting
fields and explicitly add them to the shared catalog without collecting unrelated browsing,
profile, session, or form data.

## Deployment posture

Run contribution and catalog processing in the existing lean services/workers. Scale ingestion
concurrency or split a worker only from queue-age, provider isolation, abuse, or measured load; do
not add idle replicas or always-on staging merely because the extension adds traffic.

## Initial detector variant matrix

This matrix defines the first source-level detector scope. A row remains default-off until D2-011
accepts current authorized provider-derived fixtures for the exact variant and D2-016 records an
explicit scoped activation. Greenhouse alone is enabled in persistent opt-in development mode
under D2-033 as of 2026-09-08: client `0.2.0`, `greenhouse-board-v1`, and the two exact hosts
below. This mode requires no signing key, remote policy request, expiry, or renewal. The rebuilt
unpacked extension's reload, sign-in, and successful job addition are user-confirmed on
2026-09-08. Production and extension-store distribution remain dark. A provider family name is
not fixture evidence or activation authority.

| Provider | Variant ID | Exact current-page hosts | Initial evidence state | Activation state |
|---|---|---|---|---|
| Greenhouse | `greenhouse-board-v1` | `boards.greenhouse.io`, `job-boards.greenhouse.io` | Authorized sanitized fixture accepted 2026-09-03 | Persistent development mode deployed under D2-033; installed reload, sign-in, and job addition user-confirmed 2026-09-08; production/store dark |
| Lever | `lever-posting-v1` | `jobs.lever.co`, `jobs.eu.lever.co` | Synthetic detector tests only | Disabled pending D2-011 |
| Ashby | `ashby-job-board-v1` | `jobs.ashbyhq.com` | Synthetic detector tests only | Disabled pending D2-011 |

The first detector reads only the explicitly activated current tab and extracts a strict bounded
allowlist. It does not claim support for custom domains, embedded variants, authenticated pages,
application forms, redirects to other providers, or arbitrary employer pages. Expanding the matrix
requires new variant behavior, fixtures, authorization, scans, human sanitization review, separate
QA representativeness acceptance, and an updated kill-switch policy.

## Task register

Current owner checkpoint (`2026-09-11`): the user reports extension Processing `published` and
Trust `accepted`. Record these two fixed statuses as user-observed owner readback, not a new
submission, an independently inspected catalog row, or confirmation for all three historical
contributions. The extension-status check is satisfied for the reported result. Next verify the
same posting through signed-in website search and `View details and sources`; website visibility
and the remaining Phase 2 acceptance are not yet confirmed. No tokens or identifiers are retained.
Use distinctive posting words in `Keywords` under `Search current jobs`, leave optional filters
blank, and press `Search jobs`; the separate `Job title` filter requires an exact stored title.
Check that details load and the description and Greenhouse source match the posting. Do not
resubmit, sign out of the extension, or provide private account/session information for this check.

Current local continuation (`2026-09-11` UTC): D2-054 is Complete for implementation and local
verification at `dd2d560`. Session/dispatch fencing, ordered logout cleanup, monotonic receipt
updates and case-scoped reviewer drafts fix the reproduced client races. Extension 258/258 and
admin 174/174 tests pass, including 55 extension and 32 reviewer focused cases. Source/document
review and the full maintained verifier pass: 34 test tasks and all 20 builds; database opt-ins
remain explicitly skipped. The configured unpacked extension and local admin production bundle
are rebuilt. Reload the extension to use its fix; the admin presentation still needs a fresh
hosted rollout and acceptance. No cloud, account, provider or reviewer-authority change occurred.
Phase 2 remains In progress behind the owner and human acceptance below.

Completed recovery checkpoint (`2026-09-11` UTC): D2-038/D2-050/D2-052/D2-053 are Complete for their
bounded recovery scope. Operator/artifact source `6eb7a86` completes the separately authorized
recovery `8649` / `7d6e48`: exactly one completion-tag Put reaches `intended_state_verified`,
preserving the original attempt and fixed linked companion. Fresh same-copy Inspect `70881`
and Replay `87268` pass unchanged guards: one historical marker, one present already-reconciled
restored subject, zero newly reconciled/absent subjects, no document versions, and zero S3,
recovery-ledger or identity-provider writes/calls. This is idempotent restored-only replay,
not fresh nonempty deletion acceptance. Exact executor cleanup `9634` and PITR cleanup `62815`
pass; target-scoped snapshots/backups and the canonical context are removed. Final permission
Disable/Verify passes at Platform `329`/Bootstrap `21`, both zero-drift, with all drill-only
role/endpoint/bootstrap allowances removed. Normal runtime `2ff32ef`/version `14` is unchanged;
the source is available, 44 core alarms are OK and ECS/Docker/WSL are idle or stopped.
Protected original context, immutable artifacts and both journals remain intact.
Phase 2 remains In progress. The subsequent user report above satisfies the extension-status
readback for the reported result; signed-in website visibility still needs user help because
browser control is unavailable here. Do not resubmit existing contributions. Broader rights,
human/provider, workload, alarm
receipt and store/accountable gates remain [below](#remaining-acceptance-and-operator-inputs).
See the [recovery evidence](#d2-038--isolated-deletion-recovery) and [one-shot boundary](../../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md#separately-authorized-recovery-of-a-proven-pre-dispatch-refusal).

Previous engineering checkpoint (`2026-09-11` UTC, before recovery authorization): Gateway `423d63b` and corrective core
`2ff32ef` are deployed and verified. Core Release, exact state-only metadata reconciliation,
and mapping-only Resume finish at Platform `328` with durable/activity/terminal `14`, starts
unpaused and a genuine zero-drift baseline. D2-051 is Complete for its verified code/deployment
boundary; generated concurrency seams and the real already-terminal SQL case are not a real
concurrent row-lock race or fresh candidate-rights acceptance.

On the same verified `f4baf68e` private PITR copy, fresh packet `20fa3a4c` passes Prepare `4799`,
Create `50475` and read-only DiagnoseCompletion `36727`. Persisted request/ledger completion
times agree with the bound operation evidence and differ from the historical completion tag;
three dispatch attempts are acknowledged and unclaimed. Diagnosis writes no database, S3,
recovery-ledger or Auth0 data and is not an Inspect/Replay approval.
Repair `45914` / `a9336e` passes its first complete writer-exclusion/retirement pass, reserves
stable attempt `1`, then refuses when the second runtime read reports
`authenticated_metadata_read_failed`. No Put was dispatched and the write count is zero:
this is a proven pre-dispatch refusal, not an ambiguous Put. Exact readback `00fadf` confirms
the original complete preimage and tags unchanged. A later read-only repetition passes both
195-check inventories in 150,932 ms; it does not reproduce the failure, establish its cause or
retroactively authorize the refused attempt.
Preserve the original journal and all evidence; D2-053/R21 block reset, replacement-journal
retry or any further write without an explicitly reviewed pre-dispatch recovery design and
authority. Cleanup Disable `8510` / `6c4f64` confirms concurrency zero; after the full drain,
Cleanup `27423` / `a2cb06` confirms exact executor absence at `2026-09-11T11:38:08Z` and
retains its immutable artifact. The same verified copy
and Platform `328`/Bootstrap `20` temporary permissions remain pending the recovery decision.
D2-038/050/052 and Phase 2 remain In progress; no historical correction or Replay has run.

Earlier engineering checkpoint (`2026-09-11` UTC, before the corrective release and diagnosis):
Gateway `423d63b` is deployed and verified;
the fresh canonical baseline has zero drift at Platform `321`. Core workflow starts are then
paused and verified at `322`, with durable/activity/terminal versions still `13`. The first
complete metadata inventory observes 23 retained executions (six succeeded, 17 failed), none
running and no start/end in the previous 24 hours. Queue counts are approximately zero; missing
terminal metrics are unknown, not a successful workload or proof of historical writer exclusion.
The un-applied `423d63b` core release plan is superseded to include a newly demonstrated late-event
retry defect in the same next deployment. Its original artifacts and plan remain unchanged.
The conditional operation update now gates retry enqueueing; 41 actual Profile unit tests and
typecheck pass, including eight regressions that fail against the original source. These are
generated transaction-seam tests, not real PostgreSQL concurrency evidence. The integrated
read-only diagnostic, exact-version repair helpers and internal contracts pass 785 focused tests,
697 operator assertions and the actual workflow build. All six real isolated PostgreSQL cases
pass, including unchanged-row diagnosis with microsecond dispatch evidence and the already-terminal
no-extra-outbox path; this does not claim a concurrent lock race. Full repository verification
passes: 1,146 workflow tests, eight explicit database opt-in skips, 697 executor/908 role
assertions and all 20 builds (17 unchanged cached tasks). The six real database cases above ran
separately. Nine pre-existing nonfatal lint warnings remain. Fresh current-source publication,
paused baseline/drain, reviewed core Release/Resume and cloud diagnosis remain.
No historical tag, SQL row, marker body, confirmation, retention, document or Auth0 value changed.
The same verified PITR copy and temporary permissions remain; no executor is currently live.

Authority checkpoint (`2026-09-11` UTC): the user approves D2-052's conditional diagnosis
and exact-object-version completion-time tag correction only if corroborated retained evidence
proves that tag wrong. D2-R20's original authority gate is closed; positive diagnosis and the
future-writer releases now pass, but no correction has run. The stable one-attempt reservation
was consumed before dispatch, so that original authority is not permission to reset it or retry
under another journal. D2-053/R21 require a separately reviewed pre-dispatch recovery design and
explicit authority before any further write. Matching persisted evidence, two fresh writer
passes and the complete unchanged preimage remain mandatory; change no other tag or data.
The original D2-R17 drill boundary and read-only restore IAM are unchanged. Reuse the same
verified private copy; unchanged inspection/replay and exact final cleanup remain.

Earlier recovery checkpoint (`2026-09-10T23:13:34Z`): actual `9b608ac` preparation and Create pass
with two matching standalone builds and independent packet review. Its single Inspect refuses at
`store_preflight` with the branded `CompletionCollision` reason. The database connection and
read-only transaction opened, and four initial SQL reads completed; the exact conflicting predicate
and whether either D2-051 defect caused it remain unknown. No validated inspection or Replay exists.
Maintained Cleanup `88848` confirms the exact executor absent after its full 330-second drain;
its immutable artifact and five byte-identical local files are preserved. The same verified private
RDS copy and Platform `320`/Bootstrap `20` temporary permissions remain. D2-052/D2-R20 now track the
new, narrowly scoped historical-metadata correction decision, not a request to reapprove the drill.
Do not alter a completion tag, SQL row, marker body or retention to make a check pass. D2-051's
future-writer fixes pass focused, real PostgreSQL and full repository verification; separate
Gateway/core releases are still unperformed. Phase 2 is not complete.

Earlier implementation checkpoint (`2026-09-10`, before the specific completion diagnosis): D2-047's candidate-only `7bf510e` release is
READY at the existing stable Vercel origin. Five credentialless HTTP checks pass, including the
new detail route's fixed authentication refusal, malformed-input refusal and security headers.
The verified `c9351e2` code passes the full repository verifier, web 629 tests, focused UI 38/38,
both browser suites and 266/260 inspector assertions. This completes the bounded website delivery,
not authenticated owner publication or human accessibility acceptance.

The approved D2-038 role activation now verifies at Platform `320`/Bootstrap `20`. One private
PITR copy passes the current 44-migration, 68-relation, six-contributor structural/digest check.
The D2-049 metadata repair is Complete at `92c1fc2`: the full verifier, 448 executor assertions,
908 role assertions and all 20 build tasks pass. The corrected temporary executor's genuine
Create succeeds. Its first Inspect then rejects at runtime under D2-050; no Replay is issued.
Positive read-only service evidence places that refusal inside or after database setup, while
offline request validation and retained-marker metadata checks pass. The exact executor is
disabled, drained for the full 330 seconds and removed by maintained Cleanup before source edits.
Its original packet/artifact and the same verified RDS copy are preserved. Private closed-stage
diagnostics and strict SDK-serialized secret metadata compatibility now pass full committed-source
verification at `37ea0ff`: 697 workflow tests pass, six explicit database opt-ins remain skipped,
and all 20 builds pass (18 unchanged cached tasks). The two final standalone builds match.
The earlier `21:29:40Z` SSO expiry is resolved by the user's renewed login at `21:53:41Z`.
The actual `01732ad` replacement Create succeeds; Inspect then refuses at `store_preflight`,
after secret resolution/store construction but not necessarily after a database connection.
No Replay runs. Maintained Cleanup `57506` removes that exact executor after the full drain,
preserving its artifact and the same verified RDS copy. D2-050's bounded internal diagnostics
and D2-051's deletion-retry timestamp repairs are integrated. Focused checks pass 95 diagnostic
tests and 30 retry tests; all five real isolated PostgreSQL restore/export/rollback tests pass.
Full committed-source verification now passes at `fa01d53`; corrective cloud execution remains. Neither timestamp
defect is yet confirmed as the live refusal's cause. D2-R15 is Closed.
Do not repeat PITR, renew an old packet or alter live deletion markers.
Core `31051e1`, Gateway/D2/dark-ingestion `e2e730a`, provider scope and reviewer roles are unchanged.
Temporary drill permissions remain enabled until the final resource/permission cleanup.

Earlier recovery/repair checkpoint (`2026-09-10`, before D2-050): D2-044 is Complete. Renewed exact-account
SSO passes at `13:23:50Z`; source `31051e1e9e2855cc390c40d172327bfbb6e1c67a` is immutably
published and released through pause/drain, exact state-only reconciliation and mapping-only
Resume. Platform state `315` has starts unpaused, durable/activity/terminal `13`, and zero
configuration changes. The normal activity records four invocations with explicit zero errors
and throttles; all 57 managed alarms are OK (44 core plus 13 D2). D2-R15/R19 are Closed.
Gateway, D2 workers and dark-ingestion retain their compatible `e2e730a` releases.

Recovery first exposed a native computed `name_prefix` mismatch, repaired and fully verified at
`2343514`. The subsequent exact `bf49c69` activation created only the temporary role and endpoint
access at Platform state `316`; verification then rejected native empty-tag and identity metadata.
No executor, PITR copy or replay ran. Exact unused-role cleanup now verifies at Platform `317`
and Bootstrap `17`, both with zero changes and all temporary permissions removed. D2-046's narrow
native-observation follow-up is Complete at `ca6c434`: 908 assertions pass on each PowerShell host,
authentic native-plan replay and full repository verification/all 20 builds pass. The already
authorized D2-038 drill remains pending. Core runtime `31051e1` and its version-13 pins are unchanged.
D2-045 is Complete for inspector implementation, not authenticated workload acceptance.

Earlier engineering/review checkpoint (`2026-09-10T02:55Z`): exact source
`e2e730a1416f4c0490edab0446bfc5e37373c685` passes the full maintained repository verifier.
Its D2 scheduled/Trust workers `21`/`17` verify at state `297`; the compatible Gateway release
verifies at state `298`. The earlier successful, single revision-51 migration and maintained
Resume remain the 44-migration/68-relation baseline; this compatibility fix required no new SQL
or D2 retirement pause. Reviewer assignments, Greenhouse-only development, and production/store-dark
scope remain unchanged. See the [migration history](#d2-039--fresh-review-evidence-and-monotonic-catalog-truth).

D2-042 is Complete. Between `02:30:54Z` and `02:34:43Z`, fresh exact-scope/evidence checks and three
explicit initial decisions produced three independent `accepted`/version `2` readbacks for the
three existing cases covering one public content set. There were three decision POSTs, 21 total
requests, zero new submissions, zero role changes and zero appeal decisions. This supersedes
the earlier rolled-back `503`/version `1` failure, not the separate publication or human gates.
See the [deployed fix and aggregate evidence](#d2-042--shared-client-trust-write-compatibility).

The `02:54:25Z`–`02:55:27Z` read-only health snapshot matches the exact D2 bindings, enabled
schedule/mapping, 13 OK alarms and approximately zero visible/in-flight/delayed Trust queue/DLQ
counts. Metrics for `02:31:00Z`–`02:54:47Z` record three processing completions and three copied
Trust signals, with no observed worker errors/throttles or processing retry/dead/parked work.
These non-atomic aggregates do not identify exact owner/catalog rows; absent datapoints are not
zero proof. Authenticated owner refresh and website-publication acceptance remain open.

Separate release checkpoint (`2026-09-10T04:55:39Z`): the rights release/mapping-only Resume
verifies at state `305`, with starter `12`, reconciler `10`, activity `12`, terminal `12`, durable
`12` and starts unpaused. The subsequent dark-ingestion release verifies at state `308`: activity
`20`, coordinator `21`, starter `21`, terminal `21`, durable `17`; all four activation flags remain
false. This closes both artifact-deployment blockers, not fresh user export/deletion, isolated
recovery, exact owner publication, provider fixtures or human/installed acceptance. The subsequent
canonical handoff also passes at state `308` with zero changes and no resource/state mutation.

Latest verified application release before maintenance: source `42b96861c1ad61a85d7b66a67b19065b338e9666`
ran at state `291` after the toolchain-only reconciliation, with Gateway/scheduled/Trust `55`/`17`/`13`, Jobs `0022`, 42 migrations,
68 relations, six migration owners and ten schemas. The fresh `2026-09-09T13:44:17Z` readback
matches exact artifacts, environments, roles and reservations `2/1/2`; all 13 D2 alarms are OK,
Trust queues are approximately empty, mapping concurrency is two, the schedule remains five
minutes and RDS retains 35-day backups. Greenhouse-only scope and all reviewer assignments remain
unchanged. This health check is not an authenticated workload or a fresh restore.

The user's renewed SSO and corrected Auth0 Client Access now pass. At `13:44:24Z`, one exact
three-scope reviewer token supports nine bounded requests and reads three existing initial-review
cases, with no next page, no role changes and zero decisions. Their provider evidence needs fresh
verification before acceptance; D2-039 tracks the newly found refresh and ordering gaps. D2-040
tracks Terraform 1.9.8's inability to enable the configured S3 state lock. The user has now approved
the portable 1.16.2 transition, now completed under D2-040. Both binaries are verified, integrated
checks pass, and actual refresh-backed S3-locked plans run successfully. State advances to `291`
only to retain a sensitivity mark, with no resource-value change and a fresh zero-change plan.
D2-039's maintenance configuration passes 93 Terraform tests; its coordinated operator passes 178
assertions on both PowerShell hosts and the reviewed eight-update pause. Shared-main integration,
full infrastructure validation, paused artifact releases, the single 44-migration execution and
maintained Resume Apply/Verify now pass. The four post-Resume maintenance-dispatch, outbox-start
pause, shared-NAT and numeric-receipt guard fixes are committed in `e2e730a` with the D2-042 repair.
The full exact-HEAD verifier passes, including infrastructure, format, lint, typecheck,
dependency-security, unit and build gates. Separate rights and dark-ingestion releases now verify;
the final canonical handoff passes. D2-043's full verification passes at `6604aff`; D2-044's
subsequent corrective release and activity health pass at state `315`. D2-046's prefix and
empty-tag/identity repairs are verified; approved isolated recovery is next.
Installed sign-in/job-add acceptance remains distinct from publication.

Preceding controlled-development release history (2026-09-05 through the 2026-09-08 reviewer
assignment): D2-024–D2-029 are merged in `main`.
Application source `3f20462` and configuration source `7420dfa` pass `pnpm check`; application source `116b272` also passed
`scripts/verify-phase0.ps1`. The
fresh-database integration run passes all 107 tests in 21 files with no skips, including both
isolated cancellation and composed lifecycle suites. Paired
generated page/API regressions cover Greenhouse's exact `textContent` block boundaries and
dollar-range separator representation while preserving complete provider truth. Owner cancellation,
readable reviewer evidence, and fenced reprocessing of later Trust decisions are implemented.
Jobs migration `0020` ran successfully in development: the one-off task stopped with exit 0
and all seven exact six-owner success messages. The corrected operator recovered and verified that
same task without rerunning migration. Following the 2026-09-08 human reviewer assignment,
state `285` runs scheduled version `15`, Trust `11`, and Gateway `53` from unchanged application
source `3f20462`, with reviewer configuration `01f6e94`, exact immutable artifacts, 18 JWT
routes/budgets, and a refresh-backed zero-change plan. Two ordinary scheduled ticks on the new worker and corroborating async/queue
observations passed before Gateway cancellation was exposed. The configured extension is built;
reload the unpacked extension for its new controls and retain installed acceptance separately.
D2-028 adds bounded,
explicitly scoped authenticated workload tooling; no live authenticated workload is claimed.

Latest owner-processing observation, before the D2-033 cutover: the exact page/API representation correction was deployed. Two
unchanged description-held submissions were requeued and processed once; both parked, with zero
completed/retried/dead/published items. A fresh inspection finds **zero provider-verification
holds**. The precise new owner-visible processing/Trust state requires an authenticated refresh;
these aggregate counts do not establish human review or website publication. No submission or
provider truth was rewritten, and account-held browser items were untouched. The admin console from `116b272`
has a READY Vercel preview with a protected `302`/`no-store` boundary; this does not establish human
reviewer identity or authenticated UI acceptance. The user explicitly authorized renewal of the same
Greenhouse-only development policy for 24 hours. Revision `d2-development-greenhouse-20260905-v3`
was live through **2026-09-06 15:24:54 America/New_York**, and two public reads verified the exact
signed envelope with `200` and `no-store`. The remaining acceptance and input list is below.

Historical pre-D2-033 health follow-up: both resulting Trust signals were handled by version `11`, with two
queue messages sent/received/deleted and zero function errors or failed signals. One real Trust
throttle occurred at `22:39Z`; its alarm returned to OK at `22:46:10Z` through missing-data
handling, not an observed zero throttle sample. All 13 D2 alarms were OK and both queues empty
after processing. The standard SQS mapping was uncapped while the function reserved only one
invocation; configuration `7420dfa` now aligns both limits at two, with eight Terraform regression
tests, exact two-update deployment, and zero-drift readback. Code, aliases, permissions, and alarm
thresholds are unchanged. This configuration verification is not a new authenticated load test. Do not
equate recovered processing or alarm state with recipient confirmation or publication acceptance.
The final independent snapshot at `23:09:23Z` matched state `283`, alias `11`, reservation/mapping
`2`, empty input/DLQ, and all 13 D2 alarms OK. The post-apply `23:06`–`23:09:23Z` window has no
Trust metric datapoints; it proves no new post-fix processing or observed zero-error workload.

| ID | Task | State | Owner | Dependencies | Evidence or notes |
|---|---|---|---|---|---|
| D2-001 | Implement Manifest V3 identity, side panel/popup, background worker, and secure API session. | Implemented; controlled development | Platform engineering | D0 identity; D1 gateway | The MV3 shell, dedicated Auth0 public-client session boundary, background worker, popup/side-panel surface, trusted-context-only storage, and logout/account fencing are implemented. Known cancellation, callback/state, token-exchange, missing-scope, refresh, and revocation failures map to actionable fixed messages while unknown failures remain non-disclosing. Initial installed-Edge PKCE login exists; the remaining lifecycle/browser evidence stays under D2-012. |
| D2-002 | Implement current-page job detection for Greenhouse, Lever, and Ashby. | Implemented; Greenhouse accepted | Platform engineering; QA/automation | D2-011 | Exact synthetic detectors and independent detector activation are implemented. The authorized sanitized `greenhouse-board-v1` fixture is accepted and directly exercised by the detector regression; Lever and Ashby remain disabled pending their own D2-011 evidence. |
| D2-003 | Implement an explicit public-add preview with field-level visibility and removal. | Implemented; controlled development | Platform engineering; product owner | D2-006 contribution API; D0 consent | Under ADR-029, one **Add job to shared database** command follows the exact preview; the extension shows no private-save action or redundant approval checkbox. The preview prioritizes job content, separates location and grounded work type, makes every absent optional field explicit, separates source details, reports exact selection counts, and honors optional-field removal. Development delivery requires explicit mode enablement plus identity, API, retention, independent detector, and preview-authorization readiness; other environments retain signed-policy enforcement. |
| D2-004 | Implement local sanitization, narrow optional host permissions, and privacy-safe telemetry. | Implemented; controlled development | Platform engineering; security engineering | D0 threat/privacy review | Strict local sanitization, activeTab-only/default-zero provider hosts, trusted storage, zero telemetry, and release-source checks are implemented. The development exception does not replace accountable production/store approval under D2-010. |
| D2-005 | Implement idempotent upload and safe offline pending-contribution retry. | Implemented; controlled development | Platform engineering | D2-006 | Stable authorization-receipt/contribution keys, bounded durable retry, restart recovery, stopped/all-item removal, and logout/account fencing are implemented. The versioned fence is a one-way digest of exact bounded Auth0 token identity claims: it is stable across full reauthentication to the same account and rejects a refresh or delivery under a different account without storing the raw subject. Local authentication/readiness deferrals are visible without consuming a network attempt; terminal retries remain distinct from account-fenced items, which cannot cross identities. D2-033 removes policy fetch/expiry/renewal only in explicit development mode while preserving exact client `0.2.0` and accepted Greenhouse scope; production/store remain dark. Historical installed acceptance on 2026-09-05 recorded one acknowledgement, zero pending/stopped, and two account-held items untouched. The user confirms reload, sign-in, and successful job addition in the rebuilt development candidate on 2026-09-08. Offline/retry and broader browser lifecycle acceptance remain separate; do not automatically resubmit old items. |
| D2-006 | Implement server normalization, verification, moderation, provenance, and deduplication. | Implemented; controlled development | Platform engineering | D1 catalog/trust | Durable normalization, exact/probable deduplication, independent provider verification, provider-truth staging, atomic catalog publication, provenance reconciliation, and Trust moderation are implemented. Greenhouse verification uses its bounded exact-job endpoint so a large board cannot force weakening the one-megabyte response cap. Development has one exact `greenhouse-remotecom` source/verification registration; exact existing identities are reused, genuinely new provider postings are created only after all gates, and probable duplicates roll back and park. Lever, Ashby, production, and store release remain disabled. |
| D2-007 | Implement contributor/source trust signals, closed-job reports, takedowns, and appeals. | In progress | Platform engineering | D1 trust/admin | Contributor/source decisions, closed reports, takedowns, appeals, append-only Trust events, identifier-only delivery, owner/reviewer APIs, Jobs reconciliation and the admin surface are implemented. All three reviewer assignments remain unchanged through state `298`: workflow case opener, delegated agent read/initial/takedown and separate human read/appeal. Three evidence-bound initial decisions now pass with accepted/version-2 readbacks under D2-042. Prior human identity/MFA/scope checks and the local empty-queue read pass; hosted reviewer, takedown and human appeal journeys remain separate. Accepted/incorrect/abusive/reversed decisions update bounded contributor reputation without inferring source reputation. |
| D2-008 | Integrate community observations with source-aware freshness and active-index expiry. | Implemented; controlled development | Platform engineering | D1 lifecycle | Identifier-only events, explicit provider/variant timing policy, durable revalidation, independent provider fetching, atomic permitted-API observation publication, multi-source closure, and minimal expiry are implemented. A bounded five-minute development schedule is active for the one accepted Greenhouse registration; no production provider registration or activation is configured. |
| D2-009 | Complete Chrome Web Store disclosure, permission, privacy, security, and release checks. | In progress | Platform engineering; accountable reviewers | D0 policy/legal | Deterministic default-dark packaging, repository-side disclosure drafts, bounded installed-browser synthetic evidence, the hosted `/extension-support` route, a manifest-wired four-size candidate icon set, a 300-pixel Edge logo, and the required 440-by-280-pixel text-free promotional tile now exist. The stable production alias serves the source from commit `8140b54` with HTTP `200`, the expected support heading, the required security headers, and `noindex`. A monitored support channel, exact installed screenshots, exact-candidate review, accountable approval, and store approval remain open. |
| D2-010 | Obtain accountable UGC, extension-permission, privacy, security, and store approval before public contribution or distribution. | Controlled development exception; production/store pending | Legal/privacy counsel; security/privacy reviewers | Concrete contribution flow and extension manifest | The product owner authorized Greenhouse-only development activation, then removed recurring development expiry on 2026-09-08 under D2-033. This is not LR-D2-01/LR-D2-02, accountable security/privacy, production, or store approval. Keep production and distribution disabled until those reviews pass. |
| D2-011 | Define supported job-page variants and acquire authorized, sanitized provider fixtures with separate QA representativeness acceptance. | In progress; Greenhouse accepted | QA/automation; capability reviewers | D0-007 process; exact detection scope and source authorization | `greenhouse-board-v1` now has an authorized, integrity-pinned sanitized fixture, Gitleaks and Presidio evidence, human sanitization approval, separate representativeness acceptance, raw-capture destruction evidence, and a consuming detector regression. Lever and Ashby remain blocked and disabled until equivalent evidence exists. |
| D2-012 | Configure a dedicated extension Auth0 Native Application and prove Chrome/Edge PKCE, token rotation/replay, cancellation, logout, and revocation. | In progress | Platform engineering; security engineering | D2-001; provider access | The dedicated public Native Application, exact Edge callback, API permission, per-application user-delegated grant, and initial Edge PKCE login are configured. The actual protocol module now has deterministic source tests for exact authorization/state/PKCE exchange, cancellation before token exchange, stable same-account full reauthentication, distinct-account fencing, bounded token-identity validation, refresh-token rotation with exact account verification, rejected replay or account-changing refresh without session replacement, automatic near-expiry refresh, provider revocation/logout, and fail-closed local clearing on revocation failure. Branded Chrome parity and live cancellation, rotation/replay, logout, and revocation evidence remain. |
| D2-013 | Complete the D2 data-flow, threat, privacy, authorization, retention, subprocessor, and aggregate-telemetry delta. | In progress | Platform engineering; product owner; accountable reviewers | ADR-028; ADR-029; concrete implementation | The engineering delta is recorded; accountable security/privacy and legal dispositions remain D2-010. [D2 security/privacy delta](../../security/d2-extension-ugc-security-privacy.md) |
| D2-014 | Implement independent client-version, provider-variant, and domain kill switches without affecting web/catalog availability. | Implemented; controlled development | Platform engineering | D2-001, D2-002, D2-006 | Explicit development mode independently enforces exact client `0.2.0`, Greenhouse, `greenhouse-board-v1`, and the two reviewed hosts in the extension, intake, and processing runtime, without signing, fetching, or renewing a policy. Independent detector configuration and existing runtime/provider disable controls remain; there is no new remote development policy service. Default/non-development signed-mode dimension and signature/freshness checks remain intact. Invalid, absent, or out-of-scope configuration denies without affecting web/catalog availability. |
| D2-015 | Complete accessibility, malicious-UGC, cross-user, offline/restart, permission, and installed-browser end-to-end assurance. | In progress | QA/automation; security engineering | D2-001–D2-008 | Automated source assurance covers storage isolation, accessibility structure, malicious text/URL handling, account fencing, offline/restart, permissions, deterministic packaging, and zero telemetry. The installed Edge and Google Chrome for Testing matrix proves MV3 loading, loopback-only fixtures, denied provider permission, semantic controls, visible keyboard focus, 320/360/480-pixel layouts, 200% reflow, field/control geometry, long/missing values, delivery gating, progressive disclosure, zero axe WCAG 2.0/2.1 A/AA violations, and no retained sensitive fixture marker or allowed external request. Manual retry bypasses only scheduled backoff; pending local authentication/policy gates are stated explicitly; and account-fenced items are counted separately from retryable terminal items. Real branded-Chrome/Edge auth and lifecycle journeys, enabled-detector/browser contribution flow, and human assistive-technology evidence remain required. |
| D2-016 | Complete default-dark migration/release, alarms, rollback, restore, load/abuse, and activation-gate evidence. | In progress | Platform engineering; security/operations reviewers | D2-001–D2-015 | The 44-migration/68-relation deployment and same-copy isolated recovery/replay/cleanup pass. Corrected core `2ff32ef`/version `14` remains resumed; final drill-only permission removal verifies Platform `329`/Bootstrap `21` with zero drift, source available, 44 core alarms OK and ECS idle. D2-045 workload tooling is Complete, not authenticated workload acceptance. Owner publication, installed lifecycle, fresh rights acceptance, ALARM/OK receipt and accountable production/store acceptance remain open. Dark ingestion, reviewer assignments and Greenhouse-only scope are unchanged. |
| D2-017 | Expose the Profile-owned immutable contribution-authorization lifecycle and bind the exact approved preview through Gateway, Jobs, and the extension. | Implemented; controlled development | Platform engineering | D2-003, D2-005, D2-006 | The versioned v1 Profile grant/revoke API retains its `consent` contract name, shared digest vectors, exact real verifier injection, and replay-safe grant-then-contribute flow from `b7a386b`. Under ADR-029 the add-button click is the explicit command and the immutable record is an internal authorization receipt; no redundant checkbox is shown. The JWT routes are enabled only in the controlled development activation. |
| D2-018 | Implement Matching-owned private saved-page capture and later canonical-job resolution independently of public contribution. | Implemented; not surfaced by the extension | Platform engineering | D1 saved jobs | Owner-scoped immutable persistence, verified resolution, candidate export/deletion, the versioned owner API, real active-account authority, and backward-compatible transport landed in `750b2d9` and `d3e8220`. Its owner-scoped JWT routes are available in development, but ADR-029 removes the private-save control from this public-add-only extension candidate; the transport remains independent and retains its rights obligations. |
| D2-019 | Implement durable contribution normalization, independent verification, deduplication, provenance reconciliation, and owner-visible processing state. | In progress | Platform engineering | D2-006, D2-007, D2-011 | The durable queue, bounded normalization, independent verification, deduplication, provider-truth publication, Trust reconciliation and owner controls are deployed for Greenhouse only. Following D2-042's three accepted initial decisions, the September 10 health window records three processing completions and three copied Trust signals with no observed retry/dead/parked work. On September 11 the user reports extension Processing `published` and Trust `accepted`, satisfying owner-status readback for the reported result, without establishing a contribution count. Signed-in website search/detail confirmation remains; do not resubmit or rewrite immutable observations. |
| D2-020 | Extend candidate export, deletion, withdrawal, migration replay, restore inventory, and evidence across consent, contribution, Trust, and private-capture data. | In progress | Platform engineering; privacy/security reviewers | D2-006–D2-019; D1 candidate rights | The seven-owner rights boundary, local export/recovery tests and deployed 44 migrations/68 relations pass. Corrected core `2ff32ef`/version `14` is resumed. D2-038's same-copy strict Inspect/Replay and final resource/permission cleanup now pass: one historical marker and one already-reconciled restored subject, no documents or fresh reconciliation. Fresh user export/deletion acceptance remains open; this idempotent recovery result does not replace it. |
| D2-021 | Implement independently enforceable global, client-version, provider, variant, and domain gates for intake and processing. | Implemented; controlled development | Platform engineering | D2-014, D2-019 | The explicit development flag selects fixed, independently enforced client/provider/variant/domain constraints for intake and pre-reconciliation processing. Development requires no signed envelope, key, remote policy fetch, expiry, or renewal. Signed enforcement and the public policy contract remain implemented for default/non-development compatibility; missing/malformed/stale/future/unknown/forked/rollback signed policy still denies there. Production/store and unsupported providers remain dark. |
| D2-022 | Integrate Trust through owner/reviewer APIs, reviewer authorization, admin surfaces, withdrawal/takedown/appeal workflows, and Jobs-owned reconciliation. | In progress | Platform engineering; accountable reviewers | D2-007, D2-019 | Default-deny orchestration, owner/reviewer APIs, case opening, explicit OIDC assignments, strict admin BFF, review console, identifier-only decision delivery and Jobs reconciliation are implemented. Workflow case opener, delegated agent read/initial/takedown and separate human read/appeal assignments remain unchanged through state `298`. Three real initial decisions now pass under D2-042; hosted reviewer, takedown/appeal and exact owner-publication acceptance remain open. |
| D2-023 | Redesign and verify the installed extension's preview, action, and delivery-state experience before Phase 2 acceptance. | Implemented; automated acceptance passed | Product design; platform engineering; QA/automation | D2-003, D2-009, D2-015 | The redesign uses an explicit 448-pixel popup—twice the original 224-pixel target—while the separate side-panel output reflows at 320 pixels and 200% zoom. Grounded location/work-type separation, the one-step public-add workflow, fail-closed delivery readiness, automated Edge/Google Chrome for Testing geometry/state parity, and two-surface axe acceptance are implemented. Human assistive-technology and real authenticated lifecycle acceptance remain open under D2-015; see the [installed narrow-layout acceptance](#d2-023-installed-narrow-layout-acceptance). |
| D2-024 | Refresh signed-policy readiness after a server renewal without forcing an extension reload or duplicate submission. | Implemented; local verification | Platform engineering; QA/automation | D2-014, D2-021 | Signed-mode compatibility refreshes readiness on explicit user actions with request coalescing, a 15-second cooldown, and a 10-second transport deadline; warm expiry/renewal, offline recovery, signature/rollback rejection, and unchanged queue/receipt regressions pass. D2-033's explicit development mode bypasses policy fetching/renewal altogether. The user confirms reload, sign-in, and job addition in that rebuilt development candidate; this does not add signed-mode acceptance. No polling or broader authority is added. |
| D2-025 | Allow owner cancellation of acknowledged contributions before independent verification or a Trust case exists. | Implemented; development deployed | Platform engineering | D2-017, D2-019, D2-022 | Exact owner cancellation commits a permanent Jobs barrier under the verification lock before revoking the exact Profile authorization. Ambiguous revocation retries safely; verified work requires Trust withdrawal. Gateway `51` exposes the JWT-protected route only after both upgraded workers passed the drain observation. The built extension confirms cancellation, preserves receipts, bounds transport, and fences completion across logout. Real pooled Profile/Jobs concurrency and replay tests pass; installed-extension reload and authenticated lifecycle acceptance remain. |
| D2-026 | Provide a discoverable reviewer queue and sanitized independently verified evidence in the admin console. | In progress | Platform engineering | D2-019, D2-022 | The 1–25-item keyset queue and exact case/version/digest-bound sanitized Jobs evidence feed are implemented and deployed. Three fresh evidence reads and supported initial decisions pass under D2-042, without exposing contributor identity or changing roles. API, Trust, admin and PostgreSQL regressions pass. The hosted UI's READY/protected boundary remains hosting evidence, not an authenticated reviewer session; hosted-console and separate human appeal acceptance remain under D2-030. |
| D2-027 | Verify the composed PostgreSQL Trust-to-Jobs lifecycle and fix any terminal reconciliation defects. | Implemented; development deployed | Platform engineering; QA/automation | D2-019, D2-022 | The generated isolated-database suite passes accepted publication, lost-ack replay, withdrawal/removal, rejection, distinct-reviewer appeal reversal, takedown, and non-revival by old accepted events. Applied migration `0020` records the actually consumed terminal decision; deployed scheduled `13` and Trust `11` wake completed work only for a new actionable authoritative decision and close the claimed-to-parked lost-signal race. Provider nudges and dead items remain terminal. Human-authorized deployed moderation/publication acceptance remains separate. |
| D2-028 | Implement a bounded authenticated contribution/processing workload runner and retain aggregate-only results. | Implemented; local verification | Platform engineering; QA/automation | D2-016, D2-025, D2-027 | Separate paused-intake and active-processing-to-review runners are implemented, bounded to one exact disposable contribution and aggregate-only results. All 29 synthetic regressions pass, including the five fixed Greenhouse/Lever-global/Lever-EU/Ashby host tuples, mismatches, exact approval digests, Profile revocation replay and ambiguous cleanup. Development mode reuses server descriptors but never activates providers. Only an exact pending-review withdrawal or actual removal closes processing cleanup. Live execution still requires exact disposable-account, source, preview and workload authority; signed mode retains its policy binding. No reviewer/publication/capacity acceptance is inferred. |
| D2-029 | Repair the current Gateway-baseline-to-migration operator handoff without weakening provenance or state checks. | Implemented; used in development | Platform engineering | D2-016, D2-027 | Distinct current-capture schema 7 was actually used for Gateway capture, migration planning, post-execution verification, and the worker-to-Gateway handoff. It preserves the original document release `43f69e9`, migration image source `116b272`, and corrected operator source `3f20462`, plus exact state, variables, artifact, parser, and source-delta bindings. Round-trip/adversarial tests and 118 Gateway guards pass. The successful migration's outdated Phase 1 log check was corrected to derive its exact ordered contract from immutable release source; both historical six-message and current seven-message recovery are tested. |
| D2-030 | Configure and verify the delegated agent initial/takedown identity and the separate human appeal identity. | In progress | Platform engineering; product owner | D2-007, D2-016, D2-026 | The distinct agent's exact three scopes and binding pass. The September 8 private human identity/fresh-MFA/two-scope check, assignment-only state-285 deployment and user-confirmed empty local appeal queue remain valid historical evidence; that local window ended at `2026-09-08T13:38:16Z`. All three assignments are unchanged through state `298`. On September 10 the delegated agent completes three initial decisions with accepted/version-2 readbacks under D2-042. No human appeal decision or role change occurred. Hosted reviewer, takedown and separate human appeal journeys remain open; do not borrow the human session or manufacture a case merely to test access. |
| D2-031 | Handle rejected admin callback/session checks without exposing a generic server error or weakening MFA. | Implemented; local verification | Platform engineering | D2-030 | Three generated fixtures reproduce the installed SDK's post-callback MFA-hook rejection: missing/password-only proof refuses persistence; MFA proof permits it. A typed refusal and awaited proxy boundary select only fixed, uncached same-origin errors, with no session cookie or request continuation on failure. Both profiles explain missing MFA without reflecting arbitrary query data. All 71 admin tests/eight files, independent review, and full repository verifier pass. Source `ecfb607` is rebuilt and running only in the local appeal console; page/eight assets and five anonymous/error/SDK probes pass. On 2026-09-08 the user reported the fixed `mfa_required` error, then confirmed an active session after MFA setup guidance. This classifies that retry, not the earlier generic error, and does not establish exact human role binding or hosted acceptance. |
| D2-032 | Privately verify the local human appeal session against the independently supplied identity before backend assignment. | Complete | Platform engineering | D2-030 | A default-dark, finite-window localhost server action checks SDK MFA freshness, exact issuer/subject/client, independently verified RS256 API token, and only appeal/read scopes. No browser-supplied identity, token export, refresh, Gateway call, role, or case mutation. Exclusive-create aggregate proof remains in the current-user-only ignored setup directory; private binding fingerprints never enter browser output. All 148 admin tests/11 files, typecheck, formatting/lint, independent source review, and the full repository verifier/fresh admin build pass. Actual human verification passes at `2026-09-08T13:19:45Z` before the separately authorized assignment under D2-030. |
| D2-033 | Remove recurring development contribution signing, policy fetching, and renewal. | Complete | Platform engineering | D2-005, D2-006, D2-014 | Persistent development mode is deployed from `90f3740` at state `287` after Jobs `0021`, with exact artifact/environment readback, zero drift, and unauthenticated boundary checks passing. The user confirms installed reload, successful sign-in, and successful job addition on 2026-09-08. This closes development adoption, not provider/Trust verification, website publication, or the wider browser lifecycle; production/store and unsupported providers stay dark. See details below. |
| D2-034 | Replace the expired mobile parser exception with a narrow, verified dependency security patch. | Complete | Platform engineering | D2-033 | The user-approved exact `image-size@1.2.1` patch passes independent review, 121 parser and 15 audit regressions, frozen installation, mobile checks, complete dependency audit, and the full repository verifier. Two matching no-cache migration-image builds, isolated smoke, and ECR scan COMPLETE with zero High/Critical findings pass; the reviewed image was used for Jobs `0021`. No exception renewal, broad suppression, or mobile/public-launch acceptance. |
| D2-035 | Extend persistent development contribution support to independently enabled Lever and Ashby providers. | In progress; source released with providers disabled | Platform engineering; QA/automation | D2-002, D2-011, D2-014, D2-020, D2-033 | Fixed per-provider descriptors, explicit development-only provider selection, extension/runtime/Terraform wiring and Jobs `0022` are released at `42b9686`. Greenhouse's original version/digest and default selection are preserved. Local provider/variant/domain, renewal/immutability, migration/recovery, isolated build, PostgreSQL and actual-DOM generated page/API checks pass. Posting identity, optional fields, locations and complete description pairing defects are fixed. Representative provider-derived fixture acceptance and separate activation remain; Lever and Ashby are still disabled. See details below. |
| D2-036 | Add repeatable current-schema logical backup/restore coverage with nonempty D2 data. | Complete | Platform engineering | D2-020, D2-035 | Completed 2026-09-08 at 42 migrations; rerun successfully on September 9 against D2-039's 44-migration source. The generated-only command performs real dump/restore, matches all 68 relation row sets including 18 nonempty D2 relations, and verifies restored owner/lease/publication/authorization behavior with exact disposable-container cleanup. This is local logical recovery, not cloud restore or provider acceptance. See details below. |
| D2-037 | Patch release-blocking dependency advisories surfaced by the current registry audit. | Complete | Platform engineering | D2-016, D2-035 | Compatible dependency repairs and exact Vercel patch packaging pass the full repository verifier and focused guards. Exact source `42b9686` is released to the existing candidate/admin Vercel targets and development AWS migration/Gateway/D2 workers. Migration exits 0 with seven success records; state 290 runs Gateway/scheduled/Trust 55/17/13 with zero drift, 13 healthy alarms and unchanged development scope. No audit exemptions or production/store activation. |
| D2-038 | Bind candidate-deletion replay to an authenticated, isolated AWS restore target. | Complete | Platform engineering | D2-020, D2-036; D2-052; D2-053 | Completed 2026-09-11: the original 44-migration/68-relation PITR passes strict Inspect `70881` and Replay `87268` under `6eb7a86`, with one historical marker/one already-reconciled restored subject and no documents or new reconciliation. Exact executor/PITR cleanup and final Platform `329`/Bootstrap `21` permission removal verify zero drift. The separate single-tag correction is D2-052/D2-053; replay changes no S3 object, recovery ledger or Auth0 state. Fresh nonempty deletion acceptance remains separate. See [final evidence](#d2-038--isolated-deletion-recovery). |
| D2-039 | Refresh stale unpublished contribution evidence and prevent out-of-order catalog regression. | In progress | Platform engineering | D2-006, D2-007, D2-019, D2-020 | Append-only proof generations, bounded refresh, evidence/freshness binding and monotonic catalog writes pass repository/PostgreSQL checks and the 44-migration deployment. Compatible `e2e730a` Gateway/D2 workers verify at states `298`/`297`; three fresh proofs support three explicit accepted initial decisions. Post-decision aggregates record three processing completions and copied Trust signals. The separately bundled dark-ingestion artifact verifies at state `308` without activation. September 11 user-observed Processing `published` / Trust `accepted` advances owner acceptance; signed-in website search/detail remains unobserved. Original submissions/evidence and reviewer separation stay intact; no automatic decision or resubmission. |
| D2-040 | Correct the deployment toolchain's remote-state locking incompatibility. | Complete | Platform engineering; product owner | D2-016, D2-038 | Verified portable 1.16.2/current and 1.9.8/historical readers, exact encrypted S3 lock checks and 441 toolchain assertions on both PowerShell hosts pass. Full infrastructure/repository validation passes. Actual locked plans succeed; one exact equal-value sensitivity-only apply advances state 290 to 291, followed by zero changes. Application versions, budget values, provider locks, old evidence and excluded Actions are unchanged. D2-039's coordinated deployment and D2-038's approved drill remain separate. |
| D2-041 | Include all implemented D2 owner data in the strict candidate-export contract. | Complete | Platform engineering | D2-017, D2-018, D2-020, D2-039 | Repository implementation completed 2026-09-09 in `fab4960`. Strict optional v1 sections include authorizations, contribution histories, private captures and Trust evidence while preserving D1 exports. Real seven-owner assembly, idempotency, isolation, redaction and full repository checks pass. The separately bundled rights activity fix is deployed at `e2e730a`; its exact release/Resume verifies at state `305` on September 10. Fresh user export/deletion acceptance and isolated recovery remain under D2-016/D2-020/D2-038. No additional SQL beyond D2-039. |
| D2-042 | Repair Trust writes through the deployed Gateway's shared Profile/Drizzle PostgreSQL client and complete the initial-decision path. | Complete | Platform engineering | D2-022, D2-030, D2-039 | Completed 2026-09-10 in `e2e730a`: primitive ISO SQL bindings preserve API/schema/authority; the actual-client regression fails 3/3 shared-client cases before and passes all 6 after the fix. Existing Trust integration 7/7, Trust unit 62/62, configured Gateway unit 4/4 and the full verifier pass. Gateway/D2 releases verify at states `298`/`297`. Fresh exact case/evidence checks followed by three initial decisions yield three accepted/version-2 readbacks. Earlier 503/v1 failure is superseded; no role change, appeal decision, new submission or exact publication claim. See [evidence and boundary](#d2-042--shared-client-trust-write-compatibility). |
| D2-043 | Correct native Terraform value handling and restore-only observation guards before recovery. | Complete | Platform engineering | D2-016, D2-038 | Completed 2026-09-10 at `6604aff`: timestamp-string preservation, current false outbox-pause input, declared-Boolean capture equality and exact restore-role computed-policy observation guards pass focused PowerShell 7.5/5.1 regressions and the full committed-source verifier. Fresh bootstrap/platform baselines are zero-change at states `13`/`308`. Preserve original evidence, exact input types, the nine-statement read-only role policy and historical-reader boundaries. The new-role cloud echo remains unobserved; generated compatibility fixtures do not claim role activation or recovery. |
| D2-044 | Repair exact-version export expiry acknowledgment and restore healthy activity maintenance. | Complete | Platform engineering | D2-016, D2-038, D2-041 | Completed 2026-09-10: focused 104/104, workflow 617 passed/six explicit database opt-ins skipped and full verification pass. Exact `31051e1` publication, guarded release, state-only reconciliation and Resume verify at state `315`, starts unpaused and durable/activity/terminal `13`. Ordinary activity records four invocations with explicit zero errors/throttles; all 57 managed alarms are OK. Permissions, SQL ordering, retention and failed-delete refusal are preserved. This is deployed health acceptance, not fresh candidate-rights or isolated recovery acceptance. See [repair and limits](#d2-044--exact-version-export-expiry). |
| D2-045 | Implement inspector corroboration for existing development public, authenticated-intake and processing workload aggregates. | Complete | Platform engineering | D2-016, D2-028, D2-033 | Completed 2026-09-10 in `e2714ca`: three explicit development profiles and strict checksum-bound aggregates are integrated. Historical D2Public remains 40 requests/20 denials; unknown data, custom-emission timing/sample completeness and settled queues are handled explicitly. Root and independent review pass 147 checks on each PowerShell host, plus 49 existing input guards and the complete restore-verifier suite. Full committed-source verification passes. This completes tooling, not a candidate workload, throughput, attribution or publication acceptance. See [implementation boundary](#d2-045--development-workload-corroboration). |
| D2-046 | Handle native computed prefix and observation metadata for exact fixed-name temporary recovery IAM resources. | Complete | Platform engineering | D2-038, D2-043 | Completed 2026-09-10 at `ca6c434`, extending the verified `2343514` prefix repair with exact native empty-tag/sensitivity and identity handling. Both PowerShell hosts pass 908 assertions; independent review, authentic native-plan replay, full committed-source verification and all 20 builds pass. Unused permissions were removed and verified at Platform `317`/Bootstrap `17` before editing source. No executor, PITR or replay ran; the authorized drill remains under D2-038 and needs no application rerelease. See [bounded repair](#d2-046--fixed-name-restore-role-metadata). |
| D2-047 | Expose full descriptions and independently verified source links from authenticated website search. | Complete | Platform engineering; QA/automation | D2-019; D1 catalog search | Completed 2026-09-10: the on-demand panel and narrow BFF reuse `jobs:read`, canonical aliases and bounded no-store detail. Web 629 tests, final UI 38/38, eleven Chrome scenarios, public-page regression, production build, typecheck and independent review pass. Full committed-source verification passes at `c9351e2`; candidate-only source `7bf510e` is READY at the existing stable Vercel origin, with five credentialless HTTP checks passing. Separate authenticated owner/human acceptance remains under D2-019/D2-039. No anonymous publication, provider expansion, paid deployment-protection acceptance or new permission is implied. See [scope and verification](#d2-047--authenticated-website-job-details). |
| D2-048 | Preserve absent process inputs between nested workload/recovery inspections. | Complete | Platform engineering | D2-038; D2-045 | Completed 2026-09-10 at `c9351e2` after Platform `319`/Bootstrap `19` cleanup. Original PowerShell 7.5 reproduces the absent-to-empty failure; integrated exact-cleanup-AST regressions pass independently with 266 assertions on 7.5 and 260 on Windows PowerShell 5.1, plus the full committed-source verifier/all 20 builds. Present-empty, composite, unrelated and `TF_DATA_DIR` inputs remain intact; no blanket purge or decoder relaxation. Actual recovery remains under D2-038. See [cause and repair](#d2-048--runtime-inspection-environment-restoration). |
| D2-049 | Read actual function-level tags and optional concurrency metadata for the exact numeric recovery executor. | Complete | Platform engineering | D2-038; D2-048 | Completed 2026-09-10 at `92c1fc2`: actual 448 executor/908 role assertions, independent review and full committed-source verification pass. Both standalone builds match, and the corrected maintained Create produces its genuine numeric-version receipt. Subsequent maintained cleanup also succeeds without the earlier bridge. The independent runtime inspection failure is D2-050, not a metadata-check failure or successful replay. See [repair and recovery boundary](#d2-049--recovery-executor-metadata). |
| D2-050 | Diagnose and repair the private restore executor's database-opening/runtime inspection rejection without exposing secrets. | Complete | Platform engineering | D2-038; D2-049; D2-052; D2-053 | Completed 2026-09-11: focused, real PostgreSQL and full verification pass; the corrected private runtime now passes normal Inspect `70881`, Replay `87268` and final cleanup after the separately authorized historical correction. Fixed diagnostics exposed no secrets or raw rows. Successful execution does not establish SDK compatibility or either retry defect as the cause of every earlier refusal. See [runtime repair](#d2-050--private-restore-runtime-compatibility). |
| D2-051 | Preserve authoritative deletion timestamps and prevent late terminal events from enqueueing another completed-operation retry. | Complete | Platform engineering | D2-020; D2-038 | Completed 2026-09-11 for code/deployment: Gateway `423d63b` and combined core `2ff32ef` are verified, with core `14` resumed at state `328` and zero drift. Timestamp tests pass 30 cases/13 original-source failures; the enqueue guard passes 41 Profile cases/eight original-source failures, and real PostgreSQL covers rollback, persisted timestamps and the already-terminal no-extra-outbox path. Full verification passes. Generated concurrency seams do not establish a real concurrent row-lock race; fresh rights acceptance and historical repair remain separate. See [retry timestamps](#d2-051--deletion-retry-timestamps). |
| D2-052 | Diagnose and conditionally correct the exact historical development deletion-completion inconsistency without relaxing restore checks. | Complete | Product owner; platform engineering | D2-038; D2-050; D2-051; D2-053 | Completed 2026-09-11: corroborated persisted request/ledger/operation evidence and three acknowledged/unclaimed dispatches support the exact historical correction. Separately authorized recovery `8649` / `7d6e48` sends one exact-version completion-tag Put and verifies intended state, preserving all other protected data and original evidence. Unchanged same-copy Inspect/Replay and final cleanup pass. No fresh nonempty deletion is claimed. See [historical completion diagnosis](#d2-052--historical-completion-consistency). |
| D2-053 | Define and verify one-shot pre-dispatch recovery for the consumed historical completion-repair reservation. | Complete | Platform engineering; product owner | D2-052; D2-R21 | Completed 2026-09-11: 199 repair tests, 119 protected-storage checks, 274 two-source checks and full verification pass. Actual `6eb7a86` recovery `8649` / `7d6e48` verifies the intended single-tag correction after fresh checks, preserving the original journal and fixed companion. Default repair remains readback-only; neither journal may be reset or used to resend. Normal runtime `2ff32ef`/version `14` is unchanged. Same-copy strict Inspect/Replay and all temporary cleanup pass. |
| D2-054 | Fence asynchronous extension identity/delivery and reviewer decision state across transitions. | Complete | Platform engineering; QA/automation | D2-007; D2-012; D2-015; D2-022 | Completed 2026-09-11 at `dd2d560` for source/local verification: extension 258/258 and admin 174/174 tests, both no-emit checks, source/document review and full maintained verification pass, including all 20 builds. Configured extension and local admin bundle are rebuilt; installed reload/lifecycle and hosted admin rollout/acceptance remain separate. No cloud or authority changes. See [scope and evidence](#d2-054--session-and-reviewer-state-transitions). |

### D2-054 — Session and reviewer state transitions

Started and completed 2026-09-11 for implementation/local verification. The source-only
continuation identified two client implementation gaps:

- Extension refresh responses can recreate credentials after logout or overwrite a newer login;
  simultaneous near-expiry requests can reuse one rotating refresh token. Dispatch also continues
  with a captured session and rewrites receipts after logout clears local state. Fix session and
  dispatch generation fencing, serialize relevant commits and coalesce refreshes. Deferred-response
  tests must check logout, newer login/account switch and concurrent rotation without real tokens.
- The reviewer console leaves a selected case/evidence actionable after changing the queue filter
  and retains manual evidence digests across case changes. Reset decision inputs and confirmations
  with the case/version/purpose and fence late loads. Server-side evidence, version, role and
  independent-appeal checks remain authoritative.

Implemented session generations, shared in-flight refresh/dispatch and short ordered storage
operations. Explicit logout clears old credentials/queue/receipts even across a cancelled later
login; superseded in-flight writes restore their preimage before newer mutations proceed.
Each consent/intake send and final UI reply is fenced. Queue updates merge by intent/account,
honor removal and retain concurrent additions. Out-of-order processing and Trust reads are safe
no-ops; contradictory equal-version Trust responses reject rather than replace existing evidence.

Reviewer drafts are controlled and reset across case/version/filter/purpose changes, with renewed
takedown confirmation after evidence edits. Missing/mismatched/late evidence leaves no actionable
selection; synchronous request guards prevent duplicate writes. Acknowledged writes with failed
follow-up reads request reload, while ambiguous writes are neither claimed successful nor retried.

Local verification: focused extension 55/55 and reviewer 32/32 pass; full extension 258/258 and
admin 174/174 pass. Both no-emit typechecks, scoped formatting/whitespace, independent extension
review and root reviewer review pass. The earlier 23-test reviewer packet fails 15 cases against
original source and passes after the fix. Six updated Markdown files have 1,089 valid local link
targets and 215 valid anchors at the pre-completion documentation checkpoint. Full maintained
`scripts/verify-phase0.ps1` at committed `dd2d560` exits `0` (execution `9865`, completion
`a81c7a`), with all 34 test tasks (32 cached), all 20 builds (18 cached), formatting, lint,
typechecks, dependency-security regressions, source-bound operator guards, Compose configuration
and product-scope checks passing. Existing lint warnings and explicit database opt-in skips are
not new integration acceptance. Both changed frontend packages build freshly; the extension keeps
its existing machine-local authenticated development settings. No Docker engine is needed.
Installed-browser lifecycle, hosted review, takedown and human appeal acceptance remain open;
synthetic tests cannot complete them. No migration, AWS release, identity grant, provider
activation, real job submission or new branch is part of D2-054.

### D2-050 — Private restore runtime compatibility

Completed cloud checkpoint (`2026-09-11` UTC): corrected operator/artifact `6eb7a86` passes
normal Inspect `70881`, same-copy Replay `87268` and final cleanup after D2-052/D2-053's exact
historical correction. No secret or raw row is disclosed. This closes the runtime boundary,
not fresh nonempty deletion acceptance or the unproven cause of every earlier failure.

Earlier cloud checkpoint (`2026-09-11` UTC, before historical correction): `2ff32ef` DiagnoseCompletion `36727` succeeds
read-only on the same verified copy and establishes the request/ledger-versus-tag mismatch.
At that checkpoint normal full-owner/document Inspect and Replay remain unaccepted.
The pre-dispatch historical-repair refusal is D2-053/R21; it does not reopen database-opening
diagnosis or establish SDK compatibility as the cause of an earlier refusal.

Earlier failure and implementation history (2026-09-10–11): the corrected `92c1fc2` executor Create succeeds at `20:47:46Z`. Its first Inspect returns only
the fixed runtime refusal at `20:50:22Z`, without a validated inspection receipt. No Replay runs.
The exact invocation starts and completes in approximately 1.15 seconds; Lambda's platform-level
success record is not application-level inspection acceptance. Four successful decrypt calls and
one successful managed-secret request under the exact temporary role show that execution reached
database opening. They do not distinguish secret parsing, connection setup or SQL preflight.
Offline packet/request validation and bounded live version/head/retention/tag metadata checks
pass. Body/checksum validation and CLI/SDK representation parity were not established by those
metadata-only checks. No raw event, secret, candidate locator, document body or database row is
retained in diagnostics.

Maintained Cleanup sets concurrency to zero, waits its full 330-second in-flight window, and
confirms the exact executor absent before source integration. Preserve the five original artifact
files byte-for-byte and the same verified private RDS copy; do not repeat PITR or extend a packet.
The ordinary application releases, source database, cloud documents, retention and Auth0 stay
unchanged. The next explicitly reviewed replacement still needs Inspect before any Replay.

Add one fixed failure event containing only literal action/stage classifications. Distinguish
database opening, database preflight and later reconciliation boundaries without inspecting an
exception or recording request/configuration values. Logger failure cannot suppress cleanup or
replace the existing generic refusal. All 60 handler tests, no-emit typecheck and scoped Biome
checks pass after integration; success emits no failure diagnostic.

The resolver now accepts bounded SDK JSON serialization as well as the raw Secrets Manager API
response. AWS's [Go SDK output type](https://github.com/aws/aws-sdk-go-v2/blob/main/service/secretsmanager/api_op_GetSecretValue.go)
contains a time value, nullable binary field and SDK result metadata; the
[metadata container](https://github.com/aws/smithy-go/blob/main/middleware/metadata.go) has no exported
fields. Accept only a valid positive UTC RFC3339 timestamp (up to nine fractional digits), null
binary value and empty metadata object; retain the numeric timestamp representation. Exact secret
identity/current version, target-host substitution, size/deadline limits and unknown-field rejection
are unchanged. The maintained resolver suite passes 115 tests; nine new cases fail against the old
source (three isolated fields and six complete synthetic envelopes), while 106 still pass.
Independent review and scoped formatting pass. This proves the compatibility gap, not that the
failed live response had that shape. Full committed-source verification now passes; a new private
inspection remains before claiming the runtime refusal repaired.

The integrated handler/resolver/store suite passes all 198 tests across three files; workflow
no-emit typecheck, four-file Biome checks and whitespace validation pass. No database schema,
shared API, live secret, credential, deployment layer or application permission changes.

Exact `37ea0fff93cdf918a1023a7b62c841e06c090dc3` passes the full maintained verifier at
`21:23:11Z`: 697 workflow tests pass, six explicit database opt-ins remain skipped, and all 20 build
tasks pass (18 cached). Shared main is pushed. Two subsequent standalone builds match all five
outputs: 441,096 ZIP bytes, 35 components, and unchanged 47 other Lambda artifacts/10 archived files.
New preparation then fails on its initial AWS operation at `21:28:46Z`; a separate bounded caller
check confirms SSO expiry at `21:29:40Z`. It creates no preparation packet or executor, and no
Replay has run. The existing private verified RDS copy and temporary Platform `320`/Bootstrap `20`
permissions remain until credentials permit continuation and exact cleanup. Preserve existing
packets/artifacts; after documentation-only updates, build the standalone artifact from the actual
clean merged HEAD rather than relabeling the verified `37ea0ff` bytes. No repeated PITR or healthy
application release is needed.

Renewed SSO succeeds at `21:53:41Z`; maintained Prepare binds the same verified copy and actual
`01732ad` artifact. Create returns a genuine receipt at `22:03:08Z`. Its single Inspect fails
without a validated aggregate receipt. The fixed diagnostic reports `store_preflight`, with
approximately 1.38 seconds of invocation time. This proves secret resolution and store construction,
not connection/authentication or a completed read-only SQL transaction: the PostgreSQL pool is lazy.
One bounded exact-target database-log query returns no events; server error categories remain
unknown, not zero/pass. No raw messages, database rows, secrets or document bodies are retained.
Maintained Cleanup `57506` confirms the exact function absent after its full 330-second drain.
The same verified RDS copy and temporary `320`/`20` permissions remain for the authorized drill.
Additional diagnostics use only a private identity map of existing fixed store rejection codes;
arbitrary exception properties remain unread and SQL/collision guards are unchanged. The integrated
handler/store suite passes 95 tests with no-emit typecheck and formatting; the original handler
negative control and independent review confirm the new diagnostic behavior without loosening
failure handling. Actual `01732ad` artifacts are archived byte-identically before new builds.

The next exact `9b608ac` artifact passes two matching builds, all eight preparation bindings and
independent native-state/network/role review. Maintained Create `91607` returns numeric version `1`
with zero public entrypoints. The single Inspect `24050` fails without a validated receipt; bounded
diagnostic `666332` reports eight events, one fixed `store_preflight` / `CompletionCollision`, one
generic refusal and 1,396.455 ms. The private store brand proves SQL connection and the four initial
reads completed. It does not identify which of five completion guards refused, the incorrect side,
the authoritative replacement value, or either retry defect as the historical cause. Later owner
and document validation were not reached. Raw messages, SQL rows and secrets are not retained.
Cleanup `9726` disables the exact executor; `88848` confirms its absence after the genuine full
330-second drain. No Replay runs. The immutable artifact and a byte-identical five-file owner-only
archive remain, with the same verified restore and temporary permissions. D2-052 owns the separate
historical correction decision; no new IAM permission, database write or completion-tag repair is
authorized or performed by this diagnosis.

### D2-051 — Deletion retry timestamps

Completed `2026-09-11` for the code/deployment boundary: Gateway `423d63b` is verified and
combined core `2ff32ef` finishes Release, exact state-only reconciliation and Resume at state
`328`, versions `14`, starts unpaused and zero drift. The verification below proves generated
concurrency seams and real rollback/persisted-time/already-terminal behavior, not a real
concurrent row-lock race. Neither deployment nor those tests replace fresh candidate-rights
acceptance or authorize historical correction.

Two source-level retry defects were found while diagnosing D2-050. Confirmation retries correctly
reused the immutable journal's confirmation time for the request, but the original code wrote the
later attempt time into quarantine and privacy-ledger records. Original completion retries tagged
the marker with confirmation time; a losing concurrent completion could tag its own attempt time.
Both can disagree with authoritative persisted completion/confirmation timestamps.

Use the validated journal timestamp consistently for confirmation and the persisted request's
completion timestamp for terminal and concurrent completion paths. Keep operation/audit update
clocks, transactional ownership, authentication, retention, terminal states and strict restore
comparisons intact. Add failing-original-source regressions and real isolated PostgreSQL rollback
and replay tests. These are demonstrated source defects, not an observed diagnosis of the current
restored record. Fixing future writes does not authorize rewriting historical live recovery tags.
The integrated retry suites pass 30 tests; identical tests against original source fail 13 expected
cases, including the concurrent winner's persisted completion. Both actual package no-emit checks,
scoped formatting and independent review pass. After rebuilding the 11 workflow dependency
workspaces, the actual five-test restore/export suite passes against a new loopback-only PostgreSQL
16.6 tmpfs container (`28410`, exit 0). The added case executes all real confirmation SQL, forces
transaction rollback after journal success, retries at a later clock, then retries a failed marker
completion and passes strict already-reconciled validation. Cloud adapters use generated test ports;
this is not a live erasure, S3/identity-provider execution or proof of the historical cloud cause.
Exact `fa01d5340e866420b4245a18a9840afc90b34ab8` now passes the full maintained repository verifier
(`85408`, exit 0): 721 workflow tests pass, seven explicit database opt-ins are skipped in that
command, and all 20 builds pass (17 cached). The separate five-test PostgreSQL execution above is
fresh, not inferred from those skips. The verifier retains nine pre-existing non-failing lint
warnings. Docker and WSL are stopped after exact synthetic-container removal; no user data or
persistent volumes were removed. Only the two existing delivery documents change after this
verification. The subsequent `2026-09-11` Gateway `423d63b` release verifies at `321`; core Pause
verifies at `322`, with versions `13` still active and starts disabled pending replacement.

A further source defect is confirmed: `reconcileDurableOperationFailure` could insert a retry
outbox row even when its conditional nonterminal operation update changed zero rows. A late
failure event could therefore enqueue a new attempt for an already succeeded/failed operation.
The minimal fix uses `UPDATE ... RETURNING id` and inserts only after exactly one row transitions,
within the existing transaction. It preserves the pending-event and three-attempt limits and does
not delete already queued work. The actual 41-test Profile suite and typecheck pass; the same suite
against the original implementation has eight expected failures. These generated query/rollback
seams do not establish real row-lock concurrency. The fix is included in the verified `2ff32ef`
core release; retain the earlier, un-applied `423d63b` release plan as superseded evidence.

### D2-052 — Historical completion consistency

Completed cloud checkpoint (`2026-09-11` UTC): recovery `8649` / `7d6e48` verifies
`intended_state_verified` after exactly one Put to the retained version's completion-time tag.
Fresh authenticated diagnosis and writer checks preserve the agreeing persisted completion
evidence, complete preimage and intended correction. The original attempt is not reset;
its fixed linked recovery companion is retained. No SQL row, marker body, confirmation,
retention, document, Auth0 state, other tag or other marker is changed by the repair.
Unchanged same-copy Inspect `70881` and Replay `87268` then pass, followed by exact executor,
PITR and drill-only permission cleanup. D2-052/D2-053 are Complete, not fresh rights acceptance.

Earlier cloud checkpoint (`2026-09-11` UTC, before recovery authorization): fresh same-copy Prepare `4799`, Create `50475`
and DiagnoseCompletion `36727` pass. The private result proves an agreeing persisted request/
ledger pair and matching operation evidence against a differing completion tag, with three
acknowledged/unclaimed dispatch attempts and every write counter zero. No SQL row or locator is
published. The subsequent repair `45914` / `a9336e` completes its first writer/retirement pass,
reserves stable attempt `1`, and refuses at the second runtime read with the fixed
`authenticated_metadata_read_failed` classification, before any Put is dispatched.
Exact readback `00fadf` confirms the complete original preimage and tag set. The 2,633-byte
journal is preserved with SHA-256
`3a183bd911fbf2a9c51aeb8dd87dc9c6546aadf39b8dea889c371f516f8cf1d8`.
This is not an ambiguous S3 result. Later read-only check `97941` / `237dbe` / `fa132c` passes
both complete 195-check inventories in 150,932 ms without triggering the failure telemetry;
the earlier refusal is not reproduced and its exact cause remains unknown, not a proven AWS API
failure. That later success is not retrospective writer-exclusion proof or renewed write authority.

Earlier local implementation checkpoint (`2026-09-11` UTC): the separately journaled `DiagnoseCompletion`
action is integrated without changing normal Inspect/Replay approval or cloud-write permissions.
It validates the exact singleton marker and reads five bounded selectors in one read-only
repeatable-read transaction. Fixed comparisons distinguish refusal, consistency and agreeing
persisted request/ledger/operation completion evidence. Dispatch clocks retain all six SQL
fractional digits; pending, claimed, malformed or conflicting dispatches are not filtered away.
The local exact-version tag adapter preserves body/metadata/retention and all other tags, reserves
a stable durable one-attempt journal, and permits only readback after an uncertain result.
Authenticated diagnostic provenance and independent old-writer exclusion remain separate
requirements; a checksum or an empty queue is not sufficient. Integrated checks pass 785 focused
tests, 697 operator assertions, the workflow build and all six real PostgreSQL tests. The full
repository verifier also passes with 1,146 workflow tests and all 20 builds. Cloud diagnosis and
the combined core release had not run at that checkpoint; both now pass as recorded above.

The earlier `9b608ac` isolated inspection demonstrates a real `CompletionCollision`, not a generic
database or SDK failure. Its five store guards cover request/ledger completion versus the retained
marker, completion/backup-expiry fields inconsistent with their state, and backup-expired
request/ledger/horizon disagreements. The exact predicate and incorrect value were unknown then;
the later diagnosis above establishes the request/ledger-versus-tag mismatch without establishing
either retry defect as its historical cause.
Do not choose a replacement timestamp from a later attempt clock, edit the restored SQL to match
a tag, skip the historical marker, or relax the validator.

Existing D2-R17 authority explicitly preserves completion tags. On 2026-09-11 UTC, the user
separately approves conditional diagnosis of this exact historical mismatch and correction of
only that exact object version's completion-time tag if corroborated retained evidence proves it
wrong. Preserve prior evidence, database rows, marker bodies, confirmation times, retention,
documents, Auth0 and other markers. Require agreeing persisted request/ledger completion times,
bound operation evidence, retired competing writers and unchanged exact-version preconditions.
Preserve the original complete tags before one write attempt; recover an uncertain response by
readback, not blind retry or rollback. If the evidence does not prove that bounded correction,
stop without writing. That conditional decision is fulfilled only by the bounded correction
recorded above; no broader permission or resend is inferred.

The future-writer releases and separately authorized D2-053 recovery are complete. Preserve both
journals and immutable artifacts; do not reset, replace or resend from either reservation.
Earlier Cleanup `8510` / `27423` removed the pre-dispatch-failed executor while retaining the
same copy. Final cleanup now removes that copy and all drill-only permissions, as recorded
under [D2-038](#d2-038--isolated-deletion-recovery). This does not replace fresh seven-owner
rights or owner/human/provider acceptance.

### D2-049 — Recovery executor metadata

The first current-schema executor Create issues once and creates numeric version `1`, then fails
before writing `created.json`. Actual qualified GetFunction returns no Tags property. A separate
ListTags request to the independently bound unqualified ARN returns all seven exact expected
tags; canonical environment comparison and the original strict configuration guard pass. No
inspection, replay, restored-row write or successful creation receipt is claimed.

Read actual function-level tags only after validating the numeric function identity. Reject
malformed responses and conflicting optional embedded tags; never substitute expected values.
Preserve code, role, environment, network, layer, logging and entrypoint checks. Also handle a
genuine empty concurrency response as unset only in cleanup, reject malformed/coerced values,
and inspect event mappings for both the bare name and the exact numeric version. The original
tag and empty-concurrency failures are reproduced by negative controls; the real-function AST
suite passes 448 assertions independently, without cloud calls or candidate data.

Before source changes, an explicitly separate, reviewed cleanup bridge runs the unchanged
original boundary functions with only their script paths relocated. It reads real AWS tags,
disables the exact original executor once, and records its own genuine post-disable timestamp.
The full 330-second drain and fresh boundary checks precede confirmed deletion. The original
packet, creation attempt, immutable artifact and verified restore-context bytes are retained;
no original success receipt or expiry is rewritten. Reuse that one verified private RDS copy
for a separately reviewed corrected-source executor, then perform the maintained final cleanup.
This is recovery from an uninvoked setup failure, not a blind replay retry or second PITR drill.

Completion checkpoint: exact `92c1fc2` passes the full maintained verifier and 20 build tasks
(19 unchanged cached tasks). Actual maintained executor/role suites pass 448/908 assertions.
Two final standalone builds match all five hashes. The corrected Create returns its genuine
receipt for numeric version `1` with zero public entrypoints; D2-050 separately tracks the later
runtime inspection refusal. Subsequent maintained full-drain cleanup removes that function without
the earlier bridge. This completes D2-049, not D2-038's cloud replay or overall Phase 2.

### D2-047 — Authenticated website job details

The signed-in search cards expose summaries and save/report/match controls, but not the full
description or source navigation. The existing anonymous `/jobs/[jobId]` page uses a separately
disabled public API and is not an appropriate authenticated-detail dependency. The Gateway already
serves active canonical detail through `GET /jobs/:jobId` under `jobs:read`.

Add an explicit `View details and sources` action using that existing contract through a narrow
candidate BFF. Keep access tokens server-held, accept only a bodyless/queryless UUIDv7 read, bound
response size/time, validate the existing schema and safe source URLs, and emit no-store results
with fixed error messages. Render descriptions literally, show source provenance and verification
dates, and open source links only on explicit navigation with no referrer. Preserve canonical
alias resolution, loading/error/retry states, keyboard focus and cancellation across job/session
changes. Extend the existing local browser harness rather than creating another UI or test system.
Anonymous routes, indexing, provider registrations, database schemas and reviewer grants do not change.

Integrated checks pass 70 BFF/parser/identity-dark tests and the web suite's 629 tests in 47 files.
The final UI bytes separately pass all 38 panel/search tests and actual web typecheck. The existing
Chrome harness passes all eleven scenarios, including two new detail/source/alias/session cases;
the production public-page suite also passes its five result groups after three build tasks
(two cached). Both runners close their local servers. Formatting and lint pass with only nine
pre-existing unrelated warnings; independent source review finds no issue. These checks are not
hosted, authenticated owner-publication or human accessibility acceptance. Full committed-source
verification passes at `c9351e21793389ed3926718fa7fad46e296d9898`, including all 20 build tasks
(19 cached). The ignored log is `.tmp/d2-reviewer/d2-c9351e2-phase0-verification.log`; subsequent
changes affect only these two delivery documents. Independent integration review checks all 19
files and 1,101 local Markdown targets with no findings. The candidate web is the only application that needs a release for
this change; the healthy AWS applications must not be rereleased.

The candidate-only source `7bf510e` is now READY in the existing approved non-Zach project,
Node 24/`iad1`, with its stable alias bound to that deployment. The reviewed upload contains
128 tracked files with matching digests. Five cookie-free, credentialless checks pass: root,
fixed detail `401`, malformed detail `400`, public extension help and crawler exclusion. All
eight expected security/crawler headers match; dynamic responses are no-store. Static help is
public and cacheable; an initially overstrict private probe was corrected after source inspection,
not by changing application behavior. No paid protection or authenticated owner journey is claimed.

### D2-048 — Runtime inspection environment restoration

The maintained recovery Start invokes the shared runtime inspector twice before the source
database verifier. On PowerShell 7.5.4, its cleanup passes saved null values to
`Environment.SetEnvironmentVariable`, which leaves present-empty inputs. The same immutable
native plan decodes before cleanup, fails with missing Terraform expressions afterward, and
decodes again after exact absence restoration. This explains why a single Status succeeds while
Start fails. Neither failed preflight created a restore context, target, executor or replay.

Restore originally absent touched names with exact `Env:` removal, and restore non-null strings
unchanged. Do not purge unrelated variables, alter `TF_DATA_DIR` handling, relax saved-plan guards,
or change application/IAM configuration. The regression executes the actual cleanup AST through
12 sequential nested/pipelined success/failure cycles with generated variable names. The original
7.5 inspector fails the new absent-state assertion; the draft passes 266 assertions on 7.5 and
260 on Windows PowerShell 5.1, independently reproduced. The actual integrated maintained tests
repeat both passing counts; parser and whitespace checks pass. Full committed-source verification
passes at `c9351e2`, completing D2-048 tooling without claiming the separate cloud drill.

Before source integration, genuine unused cleanup verifies zero changes at Platform `319`
(SHA-256 `04133d96ade927622adf53c83cc0cb3c6a333ff0b629d9d963179d68e2c47081`) and Bootstrap `19`
(SHA-256 `4e3e250d15b2838360f47aafad948b39b4a4d954a9ef316e4a70c16c8fc86bdd`). Every successful
Apply ran once, all 17 original bootstrap statements remain, and all temporary permissions are off.
After verification, regenerate current-source/state-bound baselines and the standalone executor
for the already authorized drill. No repeated approval or application rerelease is needed.

### D2-039 — Fresh review evidence and monotonic catalog truth

Started on shared `main` on 2026-09-09 after authenticated review became available. The then-deployed
`42b9686` worker fetched provider evidence only once and permitted only one proof per contribution.
Requeueing a previously verified case would therefore reuse stale evidence. Its Gateway checks
only digest existence, so another reviewer client could bypass the private helper's 24-hour
limit. Its exact duplicate publication also unconditionally overwrites canonical fields with the incoming
observation, allowing a later-accepted older submission to regress catalog truth.

The implementation path is: existing bounded scheduler → Jobs-owned pending-review recovery → real
independent provider verification → append-only proof → unchanged Trust case and explicit review →
exact evidence-bound Jobs publication. Public events remain identifier-only. Historical proof and
contributor payload stay immutable. Initial acceptance and publication must reject future or older
than 24-hour evidence; this is source freshness, not a renewed development authorization policy.
No automatic terminal-case reopening or appeal decision is introduced. A terminal acceptance that
cannot satisfy fresh publication remains held rather than being silently rebound to another proof.
Exact duplicates keep separate contribution histories but converge on one canonical posting;
late observations cannot replace newer source/canonical facts or undo positive withdrawal.

Source now includes Jobs `0023_contribution_verification_refresh` and Trust
`0004_accepted_independent_evidence`: 44 migrations, 68 relations, six migration owners, ten
schemas. Trust preserves reviewer/appeal evidence separately from accepted provider proof;
historical missing Trust bases remain null. Existing singleton Jobs acceptance is bound before
allowing proof generations. Only an exact already-copied legacy signal can acknowledge without
new writes or invented proof. The refresh budget is three lifetime fetches, one-hour cooldown,
and the original queue lease binding. Actual Trust UUIDv8 decision identifiers are supported.

Quiesce contribution processing and reviewer decisions before applying these migrations, then
release the coordinated Gateway/workers before resuming. Jobs `0023` removes the old singleton
conflict target, so the previous verification writer cannot be rolled back onto this schema.
Keep contributions disabled or use a forward-compatible binary. The original maintenance transition
verified state 292 using the old artifacts. Exact-source `2dd3aa2` Gateway/workers were then
released while paused, and one successful task applied Jobs `0023`/Trust `0004`. Separate migration
Verify confirmed state 295, all 44 migrations and zero drift; maintained Resume Apply/Verify now
confirms state 296 with compatible versions. No case decision occurred during that migration/Resume;
the later initial-decision acceptance is recorded under D2-042.

The new default-false `d2_community_runtime.maintenance_mode` is implemented and passes all 93
platform Terraform tests, including nine new pause/resume/default/negative cases. It retains D2
routes, queues, provider networking and assignments, disables the existing contribution/reviewer
handler flags and worker flags, disables the schedule/mapping, and sets both worker reservations
to zero. D1 and Matching/Profile-owned private capture remain available. Both old handlers check
their existing disabled flags before database/provider setup. Current-source module, development
and staging validation pass; provider locks are unchanged.

The [coordinated operator](../../../scripts/operate-development-d2-runtime-release.ps1) now verifies disabled aliases and requires a running-work drain before SQL,
keeps the workers paused through migration and compatible artifact deployment, and preserves the
pre-cutoff Lambda async retention horizon before resume. For this exact alias-only ingress, use
the existing six-hour async bound plus old runtime/settling margin, not only one Lambda timeout.
No queued contribution/signal or historical function version is deleted. The maintained Pause
Plan/Apply/Verify now passes at state 292. Saved plan SHA-256 is
`a180cb0174a1af87318c6339e7f0e4b3d7490ad52585974f9ceeb2e717c82366`; verified zero-change plan is
`d518df193eb12e1f45a525d00111cc6699d19565d1fc238d7f4cfd7e600b1998`, and pause receipt is
`78dcd895d392e4e7bcc08c984550394c5eed109efc0f71edcb66ca28cc6d197d`. The recorded 30-second old
maximum timeout plus 60-second margin and 21,600-second async horizon gives the exact cutoff and
earliest resume time above. Both observed queue counts are zero, not proof that queues are empty.

The completed paused Workers/Gateway releases preceded the final migration baseline, preserving
their pins through migration Verify. The single revision-51 task ran from
`2026-09-10T00:13:19.8966013Z` to `00:14:11.647Z`, exited 0 and emitted all seven exact aggregate
success messages. Separate Verify passed with 44 migrations/68 relations and zero active ECS
compute. Its verified execution receipt SHA-256 is
`ebbf93b0fa5713ee85780cc94046f54a5fe50b8e73d60004432ffff5a617b5fb`; do not rerun the task.

Maintained Resume Apply completed at `2026-09-10T00:50:58.8373269Z`, advancing state 295 to 296
after the original retirement horizon. Resume Verify exited 0. The exact saved plan SHA-256 is
`0552a5a1256d76a3aa40a4353bf748c915296c64e3c578c6e8d9523993ac4957`, applied receipt is
`e3a4195260e40e3a2747fe5db2277473dbaf84915d473e9d895c85ad279e741b`, and genuine verified baseline is
`65887eb2e2747f61c4b1fed520017e60c51fdf70f7f3f71419f90b7086987c10`
(metadata `797d4844b2f1d57c9dd5f82c9d93151a5ac3ad31dbaa730850943b1c4153c445`).
Native readback at `01:09:09Z` confirms Gateway/scheduled/Trust `58`/`20`/`16`, reservations
`2`/`1`/`2`, zero resource/output changes and a non-applyable baseline. Rights and dark-ingestion
pins were preserved through that Resume. The later rights release/Resume is verified under D2-041;
dark-ingestion deployment is recorded next. Current-schema cloud recovery remains.

The exact `e2e730a` dark-ingestion 12-record plan executes once and verifies at
`2026-09-10T04:55:39Z`, state `308`: activity `20`, coordinator `21`, starter `21`, terminal `21`
and durable `17`. Eight artifact-input values change semantically; five boolean/string differences
are serialization-only and deployment remains enabled. Default-dark is true, all four activation
flags are false, and provider sources remain empty. Both monitored queues report zero observed
counts; two activity subnets/two route tables and the one existing D2-owned shared NAT are preserved,
with no dedicated provider topology, active ECS tasks or continuous services.
Verification SHA-256 is `9fdfcbabc4a8b3c782f2bb213d0de36e9d9a697eed95ecc538d8c7860e394c91`;
the zero-change plan SHA-256 is `2398b255e0f19d339a4c99f9c1fba87a692346e583d7fb078de6bb92b3eed7ca`.
The subsequent genuine canonical capture passes at state `308` without resource/state mutation:
plan SHA-256 `3e02c50a5bd1c052af0a8de1a271794e396290e40d0e93dfd33e11d21c8ce28e`, metadata SHA-256
`8767c715e3d643f7ef4db7a62502e360432d1d6bf7fdb03d886e0bea7cd19a72`.
Both artifact-deployment blockers and the canonical handoff are closed, not provider activation,
exact owner publication, fresh rights acceptance or isolated recovery.

All 178 generated operator assertions pass on both PowerShell hosts, and independent review passes.
The real diagnostic Pause plan contains exactly eight updates, no creation/deletion and no changed
sensitivity markings. It is a pre-integration diagnostic, not an applyable release handoff. Native
readback identified the exact alias-qualified event-mapping lookup; tests now model AWS's empty
unqualified result and reject unexpected numeric-version mappings. Configuration-only Lambda plans
retain `last_modified`, unlike code-release plans; both transition-specific unknown shapes are tested.
Genuine apply-attempt/applied receipts bind the actual state serial, and any Resume attempt consumes
its pause cutoff before mutation, including partial failure. No automatic retry or resume is claimed.

The generated current-source logical recovery run passes 44 migration applications/replays,
68 exact relation row sets (18 nonempty D2 relations), provider leases/publication replays,
owner isolation, unchanged source, read-only denials and complete disposable cleanup. The
separate four-test seven-owner suite passes real full-export assembly plus both retained-policy
deletion replays and collision denial. The final root integration run passes 136 tests in 21 files
and all 29 dependency/integration tasks. Its seven explicit opt-in skips are covered separately by
the two-test composed lifecycle, four-test export/deletion and one-test cancellation runs. Jobs
contributes 91 tests, including a queue-backlog regression; Profile-before-Jobs setup removes the
fresh-database suite-order dependency. The complete repository verifier passes 33 typecheck,
34 unit-test/dependency and 20 build tasks. The full `pnpm infrastructure:validate` command also
passes, including source-bound migration/publication/restore guards, D2 operator boundaries,
nine public-boundary tests, 26 authenticated-runner tests and 296 restore assertions. These are
local mocked/operator tests, not live cloud execution. Earlier failed fixture runs are superseded,
not counted as passing evidence. Exact disposable containers were removed and Docker/WSL stopped.

### D2-040 — Effective S3 state locking

The read-only bootstrap preflight verifies the expected temporary SSO caller, equal development and
bootstrap backend bucket/KMS bindings, private versioned encrypted storage, and bootstrap state 13.
Terraform 1.9.8 accepts ordinary initialization but its backend metadata has no `use_lockfile` and
no DynamoDB lock table. Supplying the same intended `use_lockfile=true` explicitly fails with
`Invalid backend configuration argument`. Provider `-lockfile=readonly` does not supply state locking.
No recovery activation plan, apply or cloud configuration mutation was performed.

The user approved separately verified portable Terraform `1.16.2` and the deployment-skill update
on 2026-09-09. The official [patch release](https://github.com/hashicorp/terraform/releases/tag/v1.16.2)
and [S3 backend locking documentation](https://developer.hashicorp.com/terraform/language/backend/s3)
were checked. The new [installer](../../../scripts/install-terraform-toolchain.ps1) verifies the
published checksum signature against HashiCorp's exact primary signing fingerprint and independently
pinned Windows archive checksums before executing either binary. Both versions are now installed
under ignored `.tmp/toolchains/terraform`; the original system installation and personal keyring
are untouched. [Shell selection](../../../scripts/use-deployment-terraform.ps1) changes process PATH
only. The [shared guard](../../../scripts/lib/terraform-toolchain.ps1) rejects injected CLI arguments,
nondefault workspaces, current-command version drift and unlocked or mismatched cached backends.

The new isolated `development-d2-toolchain-data` backend initializes successfully using the exact
retained S3 bucket/key/region/KMS and explicit `encrypt=true`/`use_lockfile=true`; fresh STS verifies
the development account. Actual full-environment refresh-backed plans then succeed with locking.
The retained state-290 plan decodes through the explicit read-only 1.9.8 fallback and its SHA-256
remains `66eb4747de80b18d3d213104b0bb7c3bbccb5ee8d823323dbda70128551296fd`.
Current apply readers accept only 1.16.2 plans. The three toolchain suites pass 441 assertions on
both PowerShell 7 and Windows PowerShell 5.1; the full maintained infrastructure validation and
repository verifier pass. The historical seed may omit only the new default-off restore-role
variable. A native-plan follow-up handles Terraform's raw `TF_VAR` boolean string representation
for that exact flag without changing its effective value or relaxing any other input comparison;
the actual capture-helper regressions pass on both shells.

The first current plan reports only a sensitivity-mark update to the existing budget notification:
all before/after resource values are identical, there are no unknowns or output changes, and the
only provider-observed drift is the advancing RDS restorable clock. Terraform's exact
[1.16.2 apply implementation](https://github.com/hashicorp/terraform/blob/v1.16.2/internal/terraform/node_resource_abstract_instance.go#L2438-L2455)
persists equal-value sensitivity changes without calling the provider's resource-update method.
The reviewed saved plan `66899499f6411b3a01126cf9e42499aea2f02e224c8a167b97b395b99648f480`
applies with locking, advancing state `290` to `291` with zero resource-value changes. The fresh
locked follow-up exits 0, with no resource changes (plan
`edaf6510788f49f97e7fa76507264b5e7c8ff9eeec76a8da29fcfdab3bb584b2`). A refresh-only diagnostic was
not applied because it would not persist the required configuration sensitivity mark.

D2-040/R18 are closed. Provider versions/locks, historical files, budget settings, application
versions and excluded GitHub Actions remain unchanged. No recovery role or executor has run;
the already approved development recovery drill needs no renewed approval. Current-source
schema-7 capture and the coordinated maintenance deployment now pass; keep each later handoff
bound to its actual source and state.

### D2-041 — Complete candidate-data export coverage

The actual export workflow validates its full composed SQL output before writing an artifact.
The original shared v1 schema omitted Profile contribution authorizations, Jobs contributions
and histories, Matching private saved-page captures, and Trust event identifiers. This blocked
exports even when the stored data was valid. The additive correction defines these exact optional
sections and their nested fields; unknown properties and cross-provider URL/variant mismatches
remain denied. Existing D1 payloads still validate. Prepared publication may omit its not-yet-known
job identifier; applied publication requires one. The later probable-duplicate reason is included.

The PostgreSQL workflow regression uses nonempty data from all seven owners, actual request and
assembly ports, an in-memory artifact sink, idempotent replay, another owner's unchanged data,
and redaction checks. No real identity, cloud upload, raw artifact, or external deletion adapter is
used. The existing six-owner SQL exporters are unchanged except Trust's D2-039 additive basis.

Deployment remains separate from repository completion. `candidate-rights-activities.ts` consumes
the domain validator inside `profile-readiness-activity-lambda`; the D2 community ZIP and Gateway
alone do not deploy this fix. The maintained `e2e730a` CoreWorkflow artifact is now published and
native readback verifies starter `12`, reconciler `10`, activity `12`, terminal `12` and durable `12`.
Exact state-only reconciliation applied once at `2026-09-10T04:26:00Z`, advancing `303` to `304`.
Read-only Verify around `04:30Z` passes full live controls and a genuine native zero-change
canonical baseline; original rights release evidence is unchanged. The baseline SHA-256 is
`b62a5a9daea7c0228fddfac9dfae9c2987156c52037e2f569d7db581180aef30`; verification SHA-256 is
`4580b95681ec1101f9218fcaf3468ae432413aca4bc5f10c5aa076e5f9cdc588`.
The mapping-only Resume changes exactly one existing starter mapping from disabled to enabled,
only `outbox_starts_paused` among 103 inputs, and no outputs. It applies once at
`2026-09-10T04:42:55Z`, advancing `304` to `305`. Verify around `04:46Z` confirms starts unpaused,
the same starter `12`/reconciler `10`/activity `12`/terminal `12`/durable `12` pins, and a genuine
native zero-change canonical baseline, SHA-256
`519f6b3ca0fe24392d6f4ea27a006dc2c02b0fdf57de8d900dedfd5c5e5a4c70`.
The separate rights activity deployment/Resume blocker is closed. Queued work and retained
durable/terminal obligations remain preserved; no fresh user export/deletion acceptance or
isolated current-schema recovery is claimed.

The four reviewed post-Resume patches are now integrated on shared main: exact maintenance-event
dispatch in the rights activity, a default-off mapping-only outbox-start pause, the ingestion
operator's exact shared-D2-NAT guard, and the Resume receipt's numeric-zero/JSON-roundtrip repair.
Integrated numeric-guard regressions pass 228 assertions on each explicit PowerShell 5.1/7.5 host;
the ingestion guard suite also passes on both. Format, lint, typecheck, dependency-security and
unit gates pass, including 579 workflow tests (six explicit database opt-ins skipped), with the
new 42-test deployed-entrypoint suite and existing 17-test durable suite. All 20 build tasks
(18 cached) pass. Portable Terraform 1.16.2 independently passes the 47 community and 45
serverless tests, recursive formatting and development/staging validation with unchanged locks
and no cloud calls. The earlier uncommitted-source refusal is superseded by the full maintained
verifier passing at exact committed `e2e730a`, retained in the ignored
`.tmp/d2-reviewer/d2-e2e730a-phase0-verification.log` (20 successful build tasks, 17 cached).
No exact-source check was bypassed. Reconciliation/completion handlers and queued work remain
preserved through the verified rights Resume. The current-source dark-ingestion release now verifies
at state `308`; all four activation flags remain false and workload/network ownership stays distinct.
D2-043 separately tracks four operator repairs: timestamp-string preservation, the inspector's
current outbox-pause input, declared-Boolean capture comparison and the exact restore-role-only
computed-policy observation. All four repairs are integrated on shared main and focused regressions
pass on both PowerShell hosts. Full committed-source verification now passes at `6604aff`.
The subsequent actual activity-error alarm is tracked separately under D2-044 before recovery.
No actual new-role cloud echo or broader drift acceptance is claimed.

A source-only `42b9686..2dd3aa2` consumer check found no required web/admin compatibility release:
their trees and runtime OpenAPI validators are unchanged. Web validates export status/access
metadata and downloads the artifact without parsing it; admin uses explicit case/evidence projections.
The domain export validator is consumed by the rights activity, not either hosted frontend.
See [web download boundary](../../../frontend/web/app/candidate-rights-panel.tsx),
[strict admin BFF](../../../frontend/admin/lib/trust-bff.ts), and
[Gateway projections](../../../backend/gateway/src/app.module.ts). This does not establish hosted
reviewer, human appeal or export acceptance.

### D2-044 — Exact-version export expiry

Read-only recovery preflight on 2026-09-10 finds 43 healthy alarms out of the exact 44-alarm
inventory; `profile-readiness-activity-errors` has been ALARM since `03:08:09Z`. The bounded
`03:00Z`–`05:38Z` window records 92 invocations and 91 errors; six recent version-12 errors
classify as HTTP 403. Runtime policy fields and initialization boundaries pass inspection.
The source's export-expiry path deletes an exact version and then performs an absence HEAD.
Without ListBucket, an absent object's HEAD can return 403. That is a supported code-level
cause hypothesis, not operation attribution proven by the sanitized log classification.

The repair stays inside [the existing AWS adapter](../../../backend/workflows/src/candidate-rights-aws.ts):
require HTTP 204, exact requested VersionId and an absent/false DeleteMarker; reject invalid or
literal-null versions before sending. Failed DELETE requests, timeouts and ambiguous responses
remain failures. Remove only deletion's follow-up HEAD, preserving upload-conflict HEAD,
candidate ownership, expiry eligibility, post-acknowledgment SQL ordering and all permissions.
See the [S3 HEAD contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
and [version-specific DELETE contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html).

At `05:58:27Z`, a bounded probe creates one 45-byte generated diagnostic object in the versioned
development code-artifact bucket, outside candidate data. Initial and one intentional repeated
exact-version DELETE both return HTTP 204, the exact VersionId and no delete marker. Exact-prefix
inventory is empty after each deletion. Nothing remains; no candidate object is read or changed,
and policy, role and retention settings are unchanged. This supports retry compatibility, not candidate-rights
acceptance. The private recovery context is complete; do not repeat the probe. Its source hash is
`9e44852a2f8f6c06a534b1616cff00d00a6215a4e412c84e57c687ecf8bfed7f`.
The [adapter regressions](../../../backend/workflows/src/candidate-rights-aws.test.ts) include actual
SDK parsing with a local non-network transport, the former HEAD-403 failure and strict refusal
cases. Root's actual-source focused suite passes 104/104; the full workflow suite passes 617
with six explicit database opt-ins skipped, and workflow typecheck passes. Full committed-source
verification passes in `e2714ca`, including all 20 build tasks.

The corrective `31051e1` publication verifies all twelve exact immutable object versions after
two matching builds. Pause advances state `308` to `309`. Two complete retained-version
inventories find no running/recent terminal obligations; historical executions and queued work
are preserved. Release applies once to state `313`. Its initial Verify rejects only the two
computed parent IAM inline-policy snapshots, with no native resource/output change. A narrowly
bound refresh-only state update advances to `314`; the original release is not replayed and
no IAM policy is rewritten. Canonical verification and mapping-only Resume then pass at state
`315`, starts unpaused and durable/activity/terminal `13`.

The independent `14:25:07Z`–`14:25:47Z` snapshot observes activity-version-13 invocations at
`14:07`, `14:12`, `14:17` and `14:22`, each with explicit zero Errors and Throttles. The alias and
function aggregates corroborate `4/0/0`. All 57 managed alarms are OK with matching configuration
and enabled actions: 44 core and 13 D2. Schedule, target, permission and activity bindings match.
Missing metric minutes remain unknown; this is not per-event scheduler attribution, a candidate
lifecycle or an atomic snapshot. No manual candidate invoke or alarm override was used.

Publication receipt SHA-256: `4d99ec6c652295ef74d7b4e00938f9d13b024da7df9c14938e7245a74626b2d3`.
Resume applied receipt: `56c6269f5ba99239e33f8edbaee394cf42ba8b7d86e89d1b6126163b39793824`.
Verified zero-change plan: `d966c9e325b0003070afe016a95c63f2d2d7aec0e44b707138eba4b2cb3184b0`
(metadata `282526fb9fd184ba5b1af9ae16a0e0f22d9bff05ecfc4340db8e5d5c4d6e8867`).
Original private evidence is preserved. D2-044 and D2-R19 are closed; fresh candidate-rights
acceptance and D2-038 recovery remain separate.

### D2-045 — Development workload corroboration

The existing [public](../../../scripts/run-development-d2-public-boundary.mjs) and
[authenticated](../../../scripts/run-development-d2-authenticated-intake.mjs) runners were not
fully matched by the inspector: historical `D2Public` expects signed-policy reads and cannot
describe development mode's 20 denials without policy requests. Its empty-queue-over-the-whole-run
expectation also cannot describe legitimate active processing. Keep historical results unchanged
and add explicit `D2PublicDevelopment`, `D2AuthenticatedIntake` and `D2Processing` profiles to
the [existing development inspector](../../../scripts/inspect-development-workload-and-cost.ps1).

Bind strict success/cleanup counts, original UTC timestamps, exact runtime mode and the reviewed
aggregate's SHA-256 before any cloud read. Check request/error, worker, application, queue/DLQ,
alarm, log and drift boundaries without reading candidate payloads. Processing permits transient
queued work and observes two complete post-run queue minutes. Use corresponding custom batch
metrics as emission references: Trust logs after processing, so matching its timestamp to every
Lambda invocation minute would incorrectly reject minute-crossing work. Inactive or sparse
optional metric series remain unknown; observed nonzero failure signals remain failures.

The output is explicitly aggregate corroboration, not owner-request attribution, publication,
processing acceptance or capacity. This implements the missing inspection tool; a separately
scoped disposable-account run remains necessary. See [operator usage](../../../scripts/README.md)
and [offline guards](../../../scripts/tests/workload-inspector.tests.ps1). No runner, new policy
approval, candidate mutation or provider activation is added by the inspector.
Root and independent review pass 147 assertions on each of PowerShell 7.5.4 and Windows PowerShell
5.1, including three aggregates generated by the actual mocked runner. The default maintained
suite passes 144 assertions, plus the pre-existing 49 input guards and complete restore-verifier
suite on both hosts. Full committed-source repository verification passes in `e2714ca`, retained
in ignored `.tmp/d2-reviewer/d2-e2714ca-phase0-verification.log`. D2-045 is Complete for this
tooling boundary; no authenticated or provider workload ran during verification.

### D2-046 — Fixed-name restore-role metadata

The actual Platform Enable plan `c6f8b090d03b67d8a304b5fb95cdb8da3bd0539e529ed8a5377c6fd5ba43ec33`
contains the expected two creates and two fully known endpoint-policy updates. The only unexpected
unknown fields are `name_prefix` on the new role and inline policy. Native baseline `315` contains
20 roles and 25 inline policies whose observed prefixes are all exactly empty strings. Terraform
source already supplies exact fixed names; no naming or permission change is needed.

The existing guard rejects the plan before producing review metadata or applying Platform changes.
The bootstrap-only allowance had been enabled at state `14`; its `UnusedRole` rollback removes
only the two temporary statements, preserves all 17 existing statements, and verifies disabled
with zero changes at state `15`. Rollback verification SHA-256 is
`870daa9af58c1793e8ccb95a4f1a3322ad876ca6b7b90b821f56e4feeaf06121`.
No temporary role, executor, PITR copy or replay was created, and no permission is left unused.

The [maintained guard](../../../scripts/lib/development-deletion-restore-role.ps1) now accepts
only omitted/null or explicitly typed empty-string record prefixes. New create masks must be
Boolean, and an unknown prefix cannot also carry a concrete value. Direct property inspection
preserves array/object types instead of accidentally enumerating them into allowed scalar values.
The new unknown allowance applies only to the two exact creates; role/policy names, trust,
nine-statement read-only permissions, endpoint policies, observations and cleanup remain strict.
The actual plan also omits the pending policy `role` value. Project that missing/null value
only on a validation copy, only when its exact unknown mask is Boolean true; never replace a
concrete value or mutate the saved plan. The native rejected binary now passes the corrected
semantic reader offline. It remains historical and cannot be applied after the source changes.
The [generated regressions](../../../scripts/tests/development-deletion-restore-role.tests.ps1)
cover resolved prefixes, malformed types and masks, extra unknowns and deletion boundaries.
All 479 assertions pass independently on PowerShell 7 and Windows PowerShell 5.1; parser,
whitespace, formatting/lint and independent source review pass. Full committed-source verification
passes at `2343514860a6a74cb1437c2137897d10e2b921e4`, including all 20 build tasks (19 cached).
The ignored verification log is `.tmp/d2-reviewer/d2-2343514-phase0-verification.log`.
That prefix repair completed implementation at `2343514`; the next actual activation exposed a
second native-observation incompatibility. Historical rejected plans must not be applied.

Follow-up checkpoint (`2026-09-10T16:53Z`): exact source `bf49c69` passed fresh Bootstrap Enable
verification at state `16`. The reviewed Platform Enable applied once, advancing `315` to `316`.
Its fresh verification plan had zero configuration changes but represented empty role tags as
null-to-empty-object, paired with omitted-to-empty-object sensitivity metadata, and included
account/name-bound no-op identities. The strict reader rejected that shape; the successful Apply
was not repeated and no normal Enable-verification receipt was fabricated.

Before changing the bound source, a one-use unused-applied-role cleanup removed exactly the role
and inline policy and restored the two endpoint policies. Independent actual-plan review checked
all 306 managed resources, 103 flag-only inputs and 21 file bindings. The saved state object was
bound by its immutable S3 version; reserialized `check_results` array order was not mistaken for
resource drift. Cleanup applied once and verified zero changes at Platform `317`; its genuine
receipt SHA-256 is `a3d2db0cd809715231614702200ca70d3d5735fe89f3cbe95813e5762605e477`.
The maintained Bootstrap `UnusedRole` Disable then removed only the two temporary statements,
preserved all 17 original statements, and verified disabled with zero changes at state `17`.
Its verification SHA-256 is `05bdbc66b538eefbd8045db18112ce47af411ccf11be8ac3efb3c5e85cc983ed`.
No executor, PITR copy or replay was created; all unused permissions are off.

The permanent follow-up is confined to the existing guard and regression suite. It validates
only the exact paired tag/sensitivity representation on a clone and account/name/role-bound
native identities. Exact count-index deletion permits only the observed before-only identity
and literal action reason. Extra properties, conflicting types, unknowns, sensitivity changes,
wrong identities or unrelated resource drift still fail. Original native plans remain unchanged.
The integrated maintained suite passes all 908 assertions independently on PowerShell 7 and
Windows PowerShell 5.1. Independent review and authentic native zero/Disable replay pass, including
original pre-refresh values and unchanged evidence bytes. Parser/whitespace checks and all 1,037
local documentation targets pass. Full committed-source verification passes at
`ca6c434d4b02561a67aa3929ad308fbffc71c666`, including all 20 builds (19 cached); the ignored log is
`.tmp/d2-reviewer/d2-ca6c434-phase0-verification.log`. D2-046 is Complete for implementation.
Regenerate current-state/source baselines and only the standalone replay artifact; the application
remains on its healthy existing release. D2-038 execution/cleanup is still pending.

### D2-042 — Shared-client Trust write compatibility

Completed on 2026-09-10 in `e2e730a1416f4c0490edab0446bfc5e37373c685`. The first post-Resume
decision returned `503`; independent `01:16:14Z` readback left all three cases at version `1`.
The same synthetic configured review succeeded with ordinary PostgreSQL but failed with the
deployed Profile/Drizzle shared client: a raw `Date` SQL bind raised `ERR_INVALID_ARG_TYPE`.
The transaction rolled back. Trust and decision-signal stores now bind canonical ISO timestamps
only at SQL boundaries, preserving the Date-valued API, nulls, chronology, atomicity and authority.

The [actual-client regression](../../../backend/gateway/src/d2-trust-runtime.integration.test.ts)
reproduces all three shared-client failures before the fix and passes six ordinary/shared-client
cases afterward. Existing Trust integration 7/7, Trust unit 62/62 and configured Gateway unit 4/4
also pass. The full exact-source verifier passes. Tests use an explicitly supplied disposable
loopback server; all test-created databases/container were removed and Docker/WSL stopped.

The same source's D2 workers `21`/`17` verify at state `297`, and its Gateway release verifies
at state `298`. The exact Gateway baseline SHA-256 is
`5b82f4541e0521268fa8e0d7dd251a2f6839c5acb69b4166a4b4923a68fca282`.
Fresh case/evidence inspection precedes three explicit initial decisions between `02:30:54Z`
and `02:34:43Z`: three accepted/version-2 readbacks, three validated provider proofs, three exact
agent scopes, three POSTs/21 total requests, one distinct public content set, no role changes,
no new submissions and no appeal decisions. The aggregate-only ignored record is
`.tmp/d2-reviewer/d2-initial-review-success-20260910.json`, SHA-256
`deb42257105d07d9d7ae8c4068adca54e1e041efe96d2fafc0831ae9b33d0ae2`.
This supersedes the earlier failed decision and pending-release language; do not repeat the
decisions. It does not establish owner-visible publication or a hosted/human review journey.

Post-decision health is retained only as aggregates in
`.tmp/d2-reviewer/d2-post-decision-health-20260910.json`, SHA-256
`d4f5ebef52c5fcda71e4a0aa4e434b61cf6b5a647ae14a791df227540aee1205`.
The `02:31:00Z`–`02:54:47Z` metric window reports three processing completions and three copied
Trust signals. Scheduled/Trust function-level invocation counts are 4/2, with observed errors
and throttles zero (4/1 datapoints respectively); no processing retry/dead/parked work is observed.
All 13 alarms are OK and Trust queue/DLQ visible/in-flight/delayed approximate counts are zero.
The snapshot is non-atomic, metrics span retained versions, and the failure-only metric has no
datapoints, not proof of zero failures. These counts do not identify the exact published job.
Owner-authenticated processing/Trust refresh and candidate catalog/detail acceptance remain open;
the anonymous public-job activation flag is still false. No raw payloads or candidate identities
are retained and no additional submission or reviewer credential is needed for an owner read.

### D2-037 — Release-candidate dependency remediation

The `4f2462f` Gateway publication attempt passed 189 tests (one database-gated test skipped) and
then stopped at the centralized dependency audit, before building or uploading release objects.
The existing exact `image-size` patch still validates across ten mobile dependency paths. The
registry now reports six other advisory records, not a failed image-size remediation or a reason
to weaken the audit. The maintained release commands must remain blocked until these are fixed.

Use only compatible patch updates: Next `16.3.3` in web/admin, its sharp dependency pinned to
`0.35.4`, js-yaml `4.3.2`, and Vitest/mocker `4.1.11`. The respective maintainer notices are
[Next Windows RCE](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
[Next AVIF RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
[sharp/libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c),
[js-yaml merge limits](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh),
and [Vitest/mocker path traversal](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
This is a source/dependency repair, not a new exemption, major-version migration, or claim that
existing hosted deployments are already patched. No local web/admin listener was present when
the issue was inspected. Docker/WSL were stopped while publication was blocked.

The installed repair passes frozen installation and the centralized audit without a new
exception. Dependency-security tests pass 136/136; web passes 540, admin 148, and Gateway 189
(one database-gated test remains explicitly skipped). Both Next production builds complete
successfully. Loaded sharp reports patched libheif `1.23.2`; the exact image-size patch and
generated API contracts are unchanged. The complete repository verifier passes, including
33 typecheck/dependency tasks, 34 test/dependency tasks and 20 build tasks; its explicitly skipped
database-gated tests are not new integration evidence. Existing non-Zach Vercel identity/project
bindings are available for the separate
candidate-production and identity-dark admin-preview patch releases; reviewer M2M access is not
required for those deployments.

At `c66c8a5`, Gateway and D2 worker artifacts were published; no migration or Lambda update was
applied. Both Vercel uploads failed during frozen installation because the closed upload manifest
excluded the existing required `patches/image-size@1.2.1.patch`. Previous accepted candidate and
admin deployments remain `READY`. The narrow repair adds only that tracked patch to the upload
allowlist and validates the declared patch dependency before deployment; it must not include an
arbitrary patch directory or remove the security remediation. The corrected source will receive
new exact-source publications. Docker/WSL were stopped while this packaging repair was made.
The repair and 22 additional rejection cases pass the focused Vercel operator suite in both
PowerShell 7 and Windows PowerShell 5.1. The source-owned upload boundary, tracked patch bytes,
manifest declaration and canonical lockfile patch binding now agree; deployment retry remains
separate from these local checks.

Corrected source `42b96861c1ad61a85d7b66a67b19065b338e9666` is now deployed. Candidate
Vercel deployment `dpl_BhzyvGbVx25ZC3uNfdc6XwNSkQKR` is READY at the existing hostname;
anonymous root/support/unknown/entitlement checks return `200/200/404/401`. Admin deployment
`dpl_Gd1dXPHnqW163setptLQYkGh74BA` is READY but identity-dark behind the existing protected
preview; its three checks return protected `302` responses, not authenticated admin acceptance.
No account, callback, environment setting, or protection change was made.

The matching migration image passes two deterministic builds, an isolated smoke test and an ECR
COMPLETE scan with zero High/Critical findings. One task at revision 50 exits 0 with seven exact
success records, advancing the database to 42 migrations/68 relations/six contributors/ten schemas.
Worker versions 17/13 and Gateway version 55 are verified at state 290; the final plan digest is
`66eb4747de80b18d3d213104b0bb7c3bbccb5ee8d823323dbda70128551296fd`, with no changes.
The 23:53Z health snapshot reports 13 alarms OK, approximately empty Trust queues, reservations
2/1/2, Trust mapping concurrency 2, the unchanged five-minute schedule and 35-day database backups.
All three reviewer assignments and Greenhouse-only development scope remain unchanged. Docker
and WSL are stopped. This closes D2-037, not the unresolved reviewer grant or Phase 2 acceptance.

### D2-038 — Isolated deletion recovery

Completed `2026-09-11` UTC on the original verified 44-migration/68-relation copy, without
another PITR. Operator/artifact `6eb7a86` passes Inspect `70881` / `d99661` and Replay
`87268` / `887875`; exact binding check `f549f8` records one historical marker, one present
already-reconciled restored subject, zero newly reconciled/absent subjects, zero document
versions, S3 writes, recovery-ledger writes and identity-provider calls. This is strict
idempotent restored-only replay, not fresh nonempty deletion. Inspect SHA-256 is
`e5518f6ae6912b4b9825be27a4985c9fa88bdec487788cbec079d1bd2dcba31c`;
Replay SHA-256 is `061f95b445443b46b5ba127639f96d96929c076ffff8c0d17f0078e9f2836809`.
The earlier Replay `16697` refused before dispatch because its packet had less than five
minutes remaining; no request or replay journal was created. A fresh same-copy packet supplied
the successful Inspect/Replay above, without repeating the historical tag correction.

Final executor cleanup `9634` / `886c13` confirms absence after the full 330-second drain.
PITR cleanup `62815` / `c1c4af` confirms the exact target, its snapshots/backups and canonical
context absent, source available, 44 core alarms OK, ECS idle and zero drift. Platform Disable
Apply `73793` / Verify `82302` finishes at state `329`, with receipt SHA-256
`78d5ffb82088b0529ec4d9acd28bdb068a5e5e4328a5bbf832fd2cd4b01c4c86`.
Bootstrap Disable Apply `13459` / Verify `29402` finishes at state `21`, with receipt SHA-256
`1d74dbd02b0dad56adcc3e330292fa0554056d85e945798282d1d45d6257487a`.
Both verify zero drift and removal of the drill-only role/endpoint/bootstrap allowances.
Normal runtime `2ff32ef`/version `14` is unchanged. Check `9dbfac` confirms the protected
original context copy and both journals unchanged; immutable artifacts remain retained.

Earlier implementation and execution history follows; its pending steps are superseded by
the completed checkpoint above.

Implementation started on the shared `main` branch after the coordinated release completed.
The path is: guarded operator → exact temporary private Lambda version → complete read-only
marker/owner/document preflight → current owner deletion ports in the isolated restored database
→ aggregate result → exact temporary-resource cleanup. No client, API route, new workflow engine,
or SQL migration is needed. Source and cloud acceptance are tracked separately.

Use a dedicated read-only role because the live rights role both carries unwanted mutation
permissions and lacks the complete version/retention reads needed by this drill. Role-conditioned
permissions-boundary and private endpoint additions must not change live roles' effective access;
the new role stays default-off until its exact deployment scope is reviewed. Cloud documents,
completion tags, retention and Auth0 remain unchanged. Validate every marker and every restored
owner/document inventory before the first restored write, and revalidate before reconciliation.
Historical D1/D2 markers keep their original version/digest, while all seven current owners are
reconciled. The D2 JSON's later whitespace-only formatting hash is not a replacement for the
original confirmed policy digest. A bounded temporary executor lifetime is not a recurring
candidate/contribution policy renewal. Failed or ambiguous execution must not be blindly retried.

The assembled runtime and guarded Prepare/Create/Inspect/Replay/Cleanup operator are now present.
Focused workflow tests pass, including immutable whole-set marker checks, original historical
digests, bound source-to-target secret resolution, complete restored collision checks, cancellation,
stale inspection and ambiguous-result handling. The cloud document reader checks both exact
document namespaces even when a restored row predates the parser's normalized-object registration.
Cloud bodies, tags and retention remain read-only. Cleanup can safely drain the same exact numeric
function after a failed startup without relaxing its code/configuration/role/tag bindings.

A fresh disposable PostgreSQL 16.6 cluster passes all three real tests: both historical policies
reconcile seven nonempty current owners, preserve another account, handle a pre-confirmation
snapshot, and replay idempotently; a later operation-owner collision refuses the whole set before
changing the earlier account. The generated database was removed and Docker/WSL stopped. The
workflow suite passes 533 tests; its five opt-in database cases are explicitly skipped in that
ordinary suite, with the three new restore cases independently run as above. The full repository
verifier and maintained infrastructure validation pass at committed source `831b1db`; no immutable
source guard was weakened. PowerShell guards pass 279 assertions and platform/bootstrap Terraform
tests pass 84/4. Two source-bound Lambda builds produce identical ZIP, manifest and 35-component
SBOM hashes. No new role, restore, or executor has been deployed. On 2026-09-09 the user authorized
the new development-only recovery role and one isolated restore/replay/cleanup drill. Fresh AWS
SSO and exact plan review remain necessary; no renewed contribution-policy approval is needed.
See the [existing runbook](../../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md)
for the exact operator and failure/cleanup path; decisions and rationale remain only here.

Pre-execution review on 2026-09-09 found and fixed an IAM ARN separator error in the operator:
the exact role identity must use `role/<name>`, not `role:<name>`. Tests now execute the actual
role-reader function with synthetic AWS responses, accept the correct ARN, and retain identity,
policy, boundary and endpoint mismatch denials. All 296 operator checks pass without cloud calls.
The expected activation is one bootstrap policy update plus two development creates (the role
and its inline policy) and two endpoint-policy updates. Existing runtime, provider/reviewer,
primary database and migration-endpoint configuration must remain unchanged. The historical
rights-only bootstrap operator does not support this new delta; use reviewed saved plans with
the exact new flag and semantic scope, then reverse only these drill-specific changes at cleanup.

The dedicated [restore-role transition operator](../../../scripts/operate-development-deletion-restore-role.ps1)
now implements exact Bootstrap/Platform Enable/Disable plans, apply-attempt and post-apply state
bindings, live permission readback, and original cleanup evidence before removing used permissions.
Its 210 generated assertions pass independently and on both PowerShell hosts. A genuine unused
setup can be rolled back without fabricating completed-drill evidence; partial applies require
separate recovery inspection. This tooling is implemented, not yet a role activation or cloud replay.

Actual September 10 progress supersedes that historical activation status: Bootstrap `20` and
Platform `320` Enable verification pass, followed by one private, encrypted current-schema PITR.
The maintained source/target verifier matches six migration contributors, 44 migrations, 68
relations and the aggregate digest (`ece8cbdb99a4ccc19a74dbbe8decb4d415121e9747bad6636090473d38800058`
manifest). The single verifier log event has zero forbidden matches. Restore-point lag is 715
seconds, availability 2,078 seconds and functional verification 2,196 seconds; these are development
observations, not adopted production RPO/RTO. The original verified context is preserved
byte-identically. D2-049 records the subsequent uninvoked executor failure, cleanup and repair;
at that checkpoint structural restoration passed while deletion replay and final cleanup
remained open. Both now pass as recorded above.

### D2-035 — Complete multi-provider development contributions

- Started 2026-09-08 with a source audit. This is real implementation work, not merely a missing
  fixture approval or detector flag. Existing Greenhouse development remains unchanged.
- Implemented fixed provider descriptors and independently opt-in provider settings:
  `D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` on the server and
  `EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` in the unpacked extension. Each accepts
  a bounded JSON array of unique exact `greenhouse`, `lever`, and `ashby` names; absence preserves
  Greenhouse-only behavior, `[]` denies all, and use outside explicit development is rejected.
  New descriptors bind their exact variants/domains and retain client, identity, preview,
  verification, and Trust checks. Terraform omits the new key for the old Greenhouse-only default,
  preserving the existing deployment environment shape. Detector activation remains independent.
- Added forward Jobs `0022`, without editing deployed `0021`: only enumerated new version/digest
  pairs are permitted under the same 60-second lease, transaction marker, chronology, and
  immutable-row rules. Preparation/renewal match the stored provider/variant/client and source
  host; the original Greenhouse version/digest is unchanged. Migration verification and recovery
  inventory now cover 42 migrations, still 68 relations, six owners, and ten schemas. Development
  was still at the preceding 41-migration boundary for those local checks. The subsequent D2-037
  release applies the forward migration and verifies 42/68 in development; provider flags remain
  Greenhouse-only.
- Local checks: 215 extension tests (including six isolated real build profiles), 68 config
  tests, 175 Jobs unit tests, all 77 Jobs integration tests on a fresh disposable PostgreSQL
  16.6 cluster, 36 database-migration tests, and 80 mocked Terraform tests pass. Publisher/restore
  guards pass under PowerShell 5.1 and 7. A clean no-cache migration image builds, passes a
  network-disabled three-provider runtime smoke, migrates a separate fresh database twice, and
  passes read-only six-owner/42-migration recovery verification. This is local package/schema
  evidence, not a deployed PITR restore or activated-provider journey.
- Independent review caught the new Jobs-to-Config dependency missing from clean migration builds;
  the Dockerfile now builds the Jobs dependency closure and has a regression guard. A first
  integration attempt exposed stale success-message expectations; those were updated to `0022`.
  A repeat against retained test fixtures was not counted as acceptance: the final 77/77 run used
  a newly isolated empty cluster without weakening assertions or touching the user's database.
- Paired generated source checks exposed and fixed four cross-component errors: a page requisition
  ID overriding the URL posting ID; a deselected optional ID preventing verification; a selected
  singleton location being compared to every provider location; and DOM block concatenation being
  compared only to formatted plaintext. Fetch identity now derives locally from the required exact
  URL without rewriting immutable submissions, mismatching supplied identities reject before any
  provider request, and v1 singleton locations match only exact independent values/structured
  displays. Provider HTML explains only corroborated, bounded v1 representations; complete provider
  truth is retained and Greenhouse's currency presentation is not inherited by other providers.
- Lever now uses its documented exact-posting GET in either region and retains body, list
  headings/content, salary-description text, and closing text without duplicating opening/body.
  Independently fetched HTML supplies a bounded fallback when a section's plaintext is absent;
  such sections must not silently disappear when the contributor deselects description. Missing
  responses remain unavailable, not inferred closed. Ashby retains bounded board polling because
  its documented public API exposes no single-posting endpoint. Neither board/response limit is
  widened. [Lever API](https://github.com/lever/postings-api#get-a-specific-job-posting),
  [Ashby public API](https://developers.ashbyhq.com/docs/public-job-posting-api).
- `pnpm test:d2-provider-pairing` adds generated-only actual-DOM inspection through the real
  detector, selected pending intent, request mapper, Jobs normalizer, provider adapters with
  injected API responses, and independent verifier. Its scenarios cover Lever global/EU and
  Ashby, every optional-field subset, full/multi-section descriptions, repeated headings, exact
  v1 truncation, grounded multiple/structured locations, work modes, altered words/numbers, and
  tenant/identity/missing/unlisted boundaries. This is not representative provider-derived evidence.
- The first repository-wide run stopped on two admin fork-start timeouts (135 tests passed; two
  workers never started), not provider assertions. Admin test concurrency is now capped at two,
  matching the existing web/extension setting, and all 148 admin tests pass on rerun. No timeout
  increase, skipped case, or weakened assertion is used.
- Final pairing checks pass: 284 ingestion tests, 237 extension tests, both typechecks, and the
  actual-DOM harness separately in installed Edge and Chrome for Testing. Each browser run covers
  three variants, 57 inspections, 144 prepared payloads, 114 verified results, 43 expected
  rejections, 145 injected API calls, and zero real network fetches; browser cleanup finishes
  before success is emitted. Independent source review accepts the helpers/adapters/detector and
  harness after the HTML-only fallback fix; the verifier has a separate root review. No real
  provider fixture, authentication, migration deployment, or publication is implied.
- Integrated on shared `main` as `54002a7` (provider configuration/lease migration) and `df9ac1d`
  (paired extraction/verification fixes). The full `scripts/verify-phase0.ps1` run at `df9ac1d`
  completes successfully: source-bound operator guards, formatting/lint, all 33 typecheck tasks,
  dependency-security regressions, all 34 test tasks, all 20 builds, Compose configuration, and
  product-scope checks. Existing nonfatal lint warnings remain. Database-gated skips in ordinary
  unit tasks are not counted as integration acceptance; the separate fresh Jobs run passed 77/77.
  The configured unpacked extension is rebuilt without changing its ignored provider settings.
  No additional agent branches or worktrees were created; the user-owned stash is preserved.
- Keep both providers disabled until their representative fixture and exact registration acceptance
  passes. The previously waived blanket provider legal approval is not being requested again.
- Evidence: [extension development boundary](../../../frontend/extension/lib/development-contributions.ts),
  [server descriptor](../../../backend/services/jobs/src/contribution-capability-source.ts),
  [renewal guard](../../../backend/services/jobs/src/persistence/contribution-processing.ts),
  [forward provider lease migration](../../../backend/services/jobs/migrations/0022_development_contribution_provider_leases.sql).

### D2-036 — Repeatable synthetic logical recovery

Completed 2026-09-08. Run `pnpm test:d2-recovery` with Docker running and the existing
`postgres:16.6-alpine` image available; [command and scope](../../../backend/services/database-migrations/README.md#generated-phase-2-logical-recovery-regression).
No database paths, credentials, or receipt copying are required. Each run owns one uniquely
labeled, loopback-only, tmpfs container and removes it before reporting success.

Both final runs pass fresh/replay of 42 migrations across six owners/ten schemas, real
`pg_dump`/`pg_restore`, equal aggregate verification, and exact full-row equality for all 68
relations, including 18 nonempty D2 relations. Restored checks pass three concurrent provider
lease renewals, three publication replays and owner-visible published states, six prohibited
lease mutations, three stale-lease refusals, two revoked/cancelled processing refusals, seven
cross-owner read denials, three current-authorization checks, and one exact revocation replay.
Both read-only write probes are rejected, and the source remains unchanged after target writes.
Fifteen ownership/port guard tests pass. No host dump or fixture rows are retained.

The source and restored databases intentionally share cluster roles. This does not establish
role recovery, AWS PITR, an RTO/RPO, live provider truth, or deployed acceptance. Earlier fixture
runs exposed clock and database-client composition mistakes; those were corrected without
changing domain code or weakening guards. Seeding uses real timestamps and each owning runtime's
client; only the injected post-restore Jobs clock advances to test expired leases.

The separate current-source composed Trust/publication suite passes 2/2 and concurrent
Profile/Jobs cancellation passes 1/1 on fresh isolated clusters. The full repository verifier
passes; ordinary database-gated unit skips are not counted as integration evidence. All exact
temporary test containers were removed, and Docker/WSL were stopped when testing finished.

### D2-033 — Remove recurring development contribution policy setup

- State: Complete (2026-09-08); development deployment and rebuild verified, with installed
  reload, sign-in, and successful job addition confirmed by the user; owner: Platform engineering.
- Replace development signing keys, remote policy fetches, and expiry/renewal with explicit,
  persistent development-only configuration in the extension, Gateway, and scheduled worker.
- Preserve the exact accepted Greenhouse/client/variant/domain scope, authentication, account
  isolation, preview-bound authorization, independent verification, Trust review, cancellation,
  and publication checks. Production/store builds must not inherit this development setting.
- Cover delayed/retried publication with an automatically refreshed operation lease, not another
  user-renewed policy window; retain evidence, identity, and terminal-row immutability.
- Release source `90f3740fa8b2bab1a7bbcd8a7f12b2680a3798b8` is merged and pushed to `main`.
  The full repository verifier passes (34 test tasks, 20 build tasks), alongside 156 extension
  tests, 66 Jobs integration tests on fresh PostgreSQL, 59 Terraform tests, and 26 authenticated
  workload-runner tests using synthetic inputs. Live authenticated workload acceptance is not claimed.
- The extension-specific build disables caching and explicitly passes only public configuration,
  so a workspace rebuild cannot restore an older policy-gated bundle. Existing signed-mode
  compatibility is retained for other environments; store packaging rejects development mode.
- Gateway/D2 artifacts and the verified migration image are published. Jobs `0021` completed
  once at task revision `49`; the six-update runtime cutover reaches state `287`, Gateway `54`,
  scheduled `16`, and Trust `12`, with exact readback and zero drift. Reviewer assignments,
  mapping, schedule, authentication, independent verification, and Trust boundaries are preserved.
- The ignored workstation setting now explicitly enables development contributions. The direct
  package build passes and produces `ApplyDash Job Capture (Development)`,
  `version_name: 0.2.0-development-contributions`, with the development marker, exactly two
  Auth0/API host grants, no broad host grant, and no persistent content scripts. The user confirms
  reloading this extension, signing in successfully, and adding a job successfully on 2026-09-08.
  Retain only that user-confirmed outcome: no browser identity, job data, credentials, contribution
  identifier, network trace, or queue counts were collected. Provider/Trust outcomes and website
  publication were not verified in this follow-up. Do not automatically resubmit old items.
- Initial publication attempts stopped at the expired mobile exception; later image attempts
  encountered transport failures, and the user clarified a manual Docker stop. These are historical
  failed attempts, not current blockers; no OOM cause was established. D2-034 closed the dependency
  blocker without renewal or suppression. No contribution policy/key renewal was performed.
- Evidence: [backend authority](../../../backend/services/jobs/src/contribution-capability-source.ts),
  [extension development mode](../../../frontend/extension/lib/development-contributions.ts),
  [Terraform composition](../../../infrastructure/terraform/modules/platform/community-runtime.tf).

### D2-034 — Remediate the mobile parser dependency

- Five narrow patched files retain `image-size@1.2.1` and the existing Expo/Metro versions.
  Validate complete box headers and positive bounded progress before matching/advancing; bound
  HEIF children to their parents and ICNS entries to the declared file. Preserve supported
  512 KiB prefix sampling in both filesystem APIs and the callable API used by Metro.
- Reproduced the two installed-package hangs before patching using bounded child processes.
  The patched installation passes 121 malformed/valid parser regressions and independent code
  review, plus 15 audit-integrity tests. Frozen installation, 3 mobile tests, and mobile build pass.
- The audit now verifies the exact patch, lock binding, full installed package tree, and all
  10 mobile/Expo/Metro dependency paths before interpreting registry results. Both known advisory
  records are locally remediated; no risk exception, renewed expiry, or unrelated suppression is used.
- Patch/lock SHA-256: `37a40e9556d8c610cb8627de7b5a141d10ae9a78b768915aefda1809f9aed608`.
  Installed-tree digest: `69353bb092411adf01d204d8d1d423770834e57af1a15e42b9c7ca4e4a937c07`.
- `pnpm check` and the full repository verifier include `pnpm test:dependency-security`.
  The migration build context allows only this exact patch file for the frozen install.
  The full repository verifier, two matching no-cache image builds, isolated migration smoke,
  and ECR scan `COMPLETE` with zero High/Critical findings pass. The exact image was published
  and used successfully for Jobs `0021`; D2-034 is Complete and D2-R13 is Closed.
  Earlier image attempts encountered transport failures; the user clarified a manual Docker stop,
  and no OOM cause was established. Source remediation is not an upstream release or mobile/public-launch acceptance.
- Evidence: [patch](../../../patches/image-size@1.2.1.patch),
  [parser regressions](../../../scripts/tests/image-size-security.test.mjs),
  [audit integrity](../../../scripts/lib/dependency-remediations.mjs).

## D2-023 installed narrow-layout acceptance

- [x] Required fields use valid non-form semantics and a compact inline marker; optional fields retain one correctly labelled, row-sized checkbox target. No marker, label, value, badge, or control overlaps or clips at effective widths from 320 through 480 CSS pixels.
- [x] The preview prioritizes candidate-recognizable job content in this order: title, company, location, work type, and description. Provider, variant, client version, canonical URL, and external job ID remain visible in a clearly separated source-details group rather than competing with the job content. Exact combined values such as `Remote-NORAM` are separated into work type `Remote` and location `NORAM`.
- [x] Company and external job ID are shown when grounded by an exact page field or the accepted provider URL shape. Missing optional values are explicitly identified as not detected and are never inferred or invented. Repeated section headings such as `About Remote About Remote` are normalized without changing the underlying description.
- [x] Long descriptions and URLs have keyboard- and screen-reader-accessible expand/collapse controls. Clamping never conceals that the full selected value will be saved or contributed; the exact canonical URL remains inspectable while its default presentation emphasizes the host and job identifier.
- [x] A dynamic selection summary states the required-field count, selected optional-field count, and whether **Add job to shared database** is available. No private-save action or redundant approval checkbox is presented.
- [x] Inspect remains available without identity or API configuration. The public-add control accurately reflects identity, API, retention, authorization-receipt, and signed-capability readiness; an unavailable action is disabled with an adjacent actionable explanation rather than failing only after activation.
- [x] Primary review actions remain reachable in both popup and side-panel layouts without forcing the user through queue/history content. A sticky action region may be used only when it does not obscure content, focused controls, browser safe areas, or 200% zoom/reflow.
- [x] Typography, spacing, contrast, hover/pressed treatment, and visible `:focus-visible` states remain readable at the installed extension's narrow size. Labels and values must not rely on 9–11 pixel text for essential meaning, and long tokens must wrap without horizontal overflow.
- [x] Queue and contribution history use progressive disclosure and do not dominate a fresh capture. Empty, loading, capture-success, stale-page, signed-out, API-unavailable, retry, and stopped states provide a specific next step through an appropriate live region.
- [x] Automated Google Chrome for Testing and Edge assurance covers the fixed 448-pixel popup plus the side panel at representative narrow widths, 200% zoom/reflow, keyboard-only navigation, semantic names, separate location/work-type fields, long URL/description fixtures, missing optional values, and configured/unconfigured delivery states. Assertions detect geometric overlap/clipping, not only horizontal document overflow. Both browsers pass with zero geometry failures, one public-add control, no private-save or redundant-consent control, and zero axe WCAG 2.0/2.1 A/AA violations across popup and side panel. Human assistive-technology review remains required under D2-015.
- [x] The redesign preserves `activeTab`-only inspection, zero persistent content scripts/provider host grants, the strict field allowlist, no raw page retention, no telemetry, account fencing, idempotency, and independent detector/contribution gates.

## Exit criteria

- [ ] Extension capabilities and requested permissions are understandable and minimal.
- [ ] No unrelated browsing history, cookies, authentication data, or third-party form values are collected.
- [ ] Users preview and explicitly approve every shared job contribution.
- [ ] Contributions are idempotent, sanitized, moderated, verified, deduplicated, and provenance-preserving.
- [ ] Offline/retry behavior cannot duplicate contributions or assign them to another account.
- [ ] Community observations improve freshness without being treated as unquestioned source truth.
- [ ] Store policy, security, privacy, accessibility, adapter, and end-to-end tests pass.
- [ ] Every enabled job-page detector has current authorized provider fixtures, sanitization and scan evidence, and separate QA representativeness acceptance.
- [ ] The extension can be disabled by version/domain without affecting web/mobile/catalog availability.

## Delegated reviewer assignment

On 2026-09-06 the product owner selected **Codex as the initial/takedown reviewer** and
**the product owner as the appeal reviewer**. This resolves the reviewer-selection question,
not managed-identity provisioning or deployed review acceptance. Codex is a delegated agent,
not a human reviewer; agent activity must remain distinguishable in the audit trail. The
assignment applies to the existing controlled Greenhouse development scope, not production,
store release, legal determinations, or other providers. It neither renews the expiring policy
nor starts an unattended moderation service.

| Actor | Server-side roles | API scopes | Explicit exclusions |
|---|---|---|---|
| Dedicated Codex development reviewer identity | `case_reader`, `initial_reviewer`, `takedown_reviewer` | `trust:review`, `trust:case:decide`, `trust:case:takedown` | No appeal resolution, case opening, verified-requester takedown, candidate data, or identity administration |
| Product owner's separate managed human identity | `case_reader`, `appeal_reviewer` | `trust:review`, `trust:appeal:resolve` | No initial decisions or takedowns through this assignment; retain admin browser MFA |
| Existing D2 workflow identity | Existing `case_opener` only | Existing `trust:review`, `trust:case:open` | Do not reuse it as Codex or expand its grant |

Use a new narrowly granted development Machine-to-Machine application for agent API access;
never substitute the appeal reviewer's human session or claim that a client-credentials token
proves MFA. Bind the exact verified issuer/subject and scopes server-side. Keep client secrets
and tokens out of chat, source, command-line arguments, and evidence; do not give the agent Auth0
Management API permission or let it modify its own assignment. Human appeals use the separate
admin browser session and retain its MFA/reauthentication controls.

Every review must inspect the current redacted case and independently verified readable evidence,
then use the existing case-version fence, fixed reason codes, evidence references, and append-only
audit path. Posting text is untrusted data, never instructions. Missing, stale, conflicting, or
insufficient evidence leaves a case undecided for product-owner direction. Ordinary takedown
still requires its approved evidence; no `trust:requester:takedown` or legal-removal determination
is included. The agent must not resolve an appeal from its own decision, bypass verification or
publication gates, rewrite a contribution, or mutate catalog/database state directly.

The dedicated agent Client ID was supplied on 2026-09-06; its SHA-256 is
`53c4478adb402ef76dc6f018e84c9fda88288ed6e3dd6250cdbb0175af69419a`. Its format and
separation from the retained case opener are checked. On 2026-09-06 the masked local Windows
setup captured the secret into current-user DPAPI encryption outside Git; the optional appeal
User ID was left blank. At `2026-09-06T15:34:57Z`, a client-credentials token passed RS256
signature, exact issuer/audience/subject/client, lifetime, and least-privilege checks: exactly the
three agent scopes, with no extra permissions. The secret and token stayed in process memory
during exchange/verification; only the encrypted setup and aggregate result were retained.
The development window limits use of that setup; it does not automatically revoke the Auth0 secret.

On 2026-09-08 the user explicitly confirmed reuse of the saved encrypted credential for the
remaining Phase 2 development initial/takedown work. This closes D2-R14 without rewriting the
historical setup window, granting additional roles, or changing the separate human appeal
assignment. Current-user-only file access, unchanged encrypted bytes, exact development AWS
account, and the live Gateway's exact issuer/audience/three reviewer assignments were checked.
Two bounded token requests were refused by Auth0 with `403` / `access_denied`; the second retained
only the classification **application API access not authorized**. No token was obtained, no
Gateway case request was made, and no case decision or role change occurred. D2-R16 tracks the
existing agent application's Platform API client-access grant; it is not a contribution-policy
renewal or a request for a new secret.

The proposed agent-only binding passes both existing runtime configuration parsers, preserves
the case opener, and fits the existing limits: combined encoded policy/configuration `2,072/2,400`
characters; Gateway environment `3,108/4,096` bytes; scheduled environment `3,111/4,096` bytes.
After the product owner renewed AWS SSO, the exact account/lineage/state-283 checks passed.
An independent review confirmed the saved four-update assignment-only plan, applied through
the separate deployment SSO role rather than the reviewer credential. State `284` now runs
Gateway `52`, scheduled `14`, and unchanged Trust `11`; the two new immutable versions retain
the exact application artifacts. Every non-assignment environment/input, policy, route, IAM
grant, schedule, and Trust-signal consumer remains unchanged. Refresh-backed verification is
zero drift. The dedicated reviewer credential cannot administer its identity or binding.

The explicit synthetic M2M/human matrix now covers exact and excess scopes, every cross-role
denial, wrong issuer/subject, every missing required scope, and distinct audit identities;
all 12 authority tests and Gateway typecheck pass. All eight pre-deployment and ten
post-deployment API checks pass. The latter includes one bounded queue page, one case, and one
sanitized evidence read; two invalid decision/takedown requests return `400` after authorization,
four out-of-role operations return `403`, and anonymous queue access returns `401`. These are
access/contract checks, not a substantive case review or a valid decision. The two mutation probes
use `{}` and generated nonexistent UUIDv4 paths, never a real case/version/evidence command.
All 13 D2 alarms are `OK`, both observed Trust queues are empty, and reservation/mapping stay at
two. The human appeal subject, separate browser configuration, and fresh-MFA acceptance remain
open. No case has been approved, rejected, taken down, or appealed.

To prepare the agent identity, use Auth0 **Applications → Applications → Create Application**,
name it `ApplyDash D2 Agent Reviewer Development`, and choose **Machine to Machine**. Select
the existing Platform API (`ai-job-apply-api`), not the Auth0 Management API, and grant only the
three agent scopes in the table. Supply only its non-secret Client ID initially; provision the
secret through a secure local/managed-secret step. This follows Auth0's
[M2M registration procedure](https://auth0.com/docs/get-started/auth0-overview/create-applications/machine-to-machine-apps).
The product owner's appeal account must remain distinct from that application and the workflow.

The admin client now supports server-only `ADMIN_AUTHORIZATION_PROFILE=appeals`, requesting only
`openid profile trust:review trust:appeal:resolve`. The appeal page omits D1 moderation and
case-opening/initial/takedown controls and starts on `appeal_pending`. Missing profile preserves
the existing `standard` console; unknown or malformed values fail closed. This is request/UI
narrowing, not a role grant, a substitute for server authorization, or evidence of a human login.
MFA, 15-minute reauthentication, one-hour absolute sessions, evidence requirements, and the
independent-reviewer guard are unchanged. The local setup helper accepts
`-AuthorizationProfile appeals`; never broaden the human grant to accommodate the standard UI.
At that setup checkpoint, the appeal-only source had not yet been deployed to the protected
admin preview or configured with the product owner's dedicated client. Local admin tests (40 in seven files), typecheck,
production build, and five isolated setup cases on both Windows PowerShell 5.1 and PowerShell 7
pass. The full repository verifier passes 33 typecheck, 34 unit-test, and 20 build tasks; 30
database-gated tests remain skipped in this unit run, not new PostgreSQL acceptance evidence.

The subsequent proposed admin Client ID on 2026-09-06 exactly matched the candidate website's
configured client; its SHA-256 is `0956ce560e8b96dd3a1693334580169d8f2153fdd09ea30f9bd146da5a86e483`.
It is not an eligible separate admin client. The existing setup refuses that reuse before secret
collection. No secret prompt, environment overwrite, token request, permission change, or cloud
deployment followed. Create a separate `ApplyDash D2 Appeals Development` **Regular Web Application**
in the existing development tenant and supply only its new Client ID. Keep the candidate application
unchanged. This follows Auth0's [Regular Web Application registration procedure](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps);
the exact appeal-only grants, human identity, secure secret setup, and MFA acceptance still apply.

A replacement Client ID was then supplied; SHA-256
`563e1817965dd27b46bba0129160f103097d664999b74ae5225cb0e6fbf47e2a` passes canonical-format and
separation checks against both configured local clients and both reviewer assignments in the
retained state-284 verification plan. This clears the candidate-client reuse blocker, not proof
of the provider application's type, grant, secret, or human identity. The separate masked appeal
collector fixes the request to `openid profile trust:review trust:appeal:resolve` and proposes
only `case_reader`/`appeal_reviewer`. It writes new current-user DPAPI-encrypted setup and aggregate
status files outside Git, preserving all existing environments and the agent credential. Eleven
synthetic input checks, an in-memory DPAPI round trip, context/ACL/non-overwrite preflight, and
independent source review pass. Collection, managed login, exact human binding, and MFA acceptance
remain separate; this step does not grant roles, request a token, renew policy, or deploy anything.

The user then completed the masked setup. Current-user decryption, user-only ACL, retained
context/expiry, exact appeal profile/scopes, candidate credential separation, and distinct human
subject shape all pass local validation. This verifies collection, not the client secret at Auth0
or the claimed human identity. One public authorization preflight, with fresh state/nonce/PKCE
and no credential, cookie, or human subject, returned `403` / **Callback URL mismatch**. Configure
the new appeal application with allowed callback `http://localhost:3001/auth/callback`, allowed
logout URL `http://localhost:3001`, and allowed web origin `http://localhost:3001`. Check its
Authorization Code grant and `Client secret sent as POST` authentication, and its existing API's
per-application **user-delegated** grant for only `trust:review` and `trust:appeal:resolve`; do not
enable machine access or change tenant-wide API policy. Leave candidate/workflow/agent applications
unchanged. See Auth0's [application settings](https://auth0.com/docs/get-started/applications/application-settings)
and [application API access controls](https://auth0.com/docs/get-started/apis/api-access-policies-for-applications).
Actual acceptance must start at the admin app's `/auth/login` so the SDK owns the transaction;
the standalone preflight cannot create a session. No secret exchange, local environment overwrite,
human authentication, role deployment, policy renewal, or case decision occurred. D2-R12 remains
open for this callback configuration, provider verification, exact human binding, and fresh MFA.

After the user's Auth0 settings confirmation, a fresh credential-free authorization preflight
returns `302` to the tenant login with no callback mismatch. The callback blocker is cleared.
The existing verified production admin build now runs only on `127.0.0.1:3001`, using the encrypted
setup in process memory, a fresh session secret, and the `appeals` profile. Existing environment
files are unchanged; raw server output is discarded. Its supervisor stops the local server at
`2026-09-06T19:24:54.670Z`, the existing setup window; this does not renew contribution policy or
revoke the Auth0 application secret. Missing standalone browser assets were staged from the same
build without replacing existing files. The anonymous appeal page and all eight referenced assets
pass, as do SDK audience/code/PKCE/scope/MFA-request checks, queue `401`/`no-store`, token-endpoint
`404`, and the fixed missing-state failure redirect. No authorization redirect was followed by
these checks. The user must start at `http://localhost:3001`, select **Sign in as appeal reviewer**,
and complete the actual managed login/MFA. An accepted session is distinct from a successful
authorization redirect; exact human role binding and hosted acceptance remain separate.

At `2026-09-06T19:24:54.689Z`, the supervisor recorded `window_expired` and stopped the local
server. Read-only inspection at `20:41:14Z` confirms neither runtime process nor a port-3001
listener remains, explaining the user's connection-refused message. The successful callback
configuration check is not reversed by this shutdown. A fresh bounded local sign-in window is
required before reusing the encrypted setup; reopening local sign-in must not implicitly renew
the separately expired contribution policy, deploy reviewer roles, or change cloud resources.

The user explicitly approved reopening only local appeal sign-in for two hours using the saved
encrypted setup. The fixed authorization window is `2026-09-06T20:55:31Z`–`22:55:31Z`; rerunning
the helper cannot move its deadline. The original encrypted setup and expiry remain unchanged;
an explicit local-only restart flag selects the separate runtime deadline and a new non-overwriting
aggregate status file. Independent source review and the scope guard pass. The production server
restarted at `20:58:31.024Z`, bound only to `127.0.0.1:3001`; its page/eight assets, exact SDK request,
anonymous queue denial, disabled token endpoint, and sanitized missing-state callback pass again.
Four protected local files remain unchanged, including both client environments, original encrypted
setup, and prior runtime status. The user should complete sign-in/MFA only, without loading the
review queue or submitting decisions yet. The contribution policy remains expired, cloud state and
roles are unchanged, and actual managed human identity/granted scopes/MFA acceptance remain open.

The user subsequently reported **Internal Server Error**. The local listener and anonymous
boundaries still passed, so this was not another stopped-server incident. Three generated fixtures
against the installed SDK confirm a callback error-handling defect: `onCallback` constructs its
response before `beforeSessionSaved`, and a missing-MFA rejection escapes the old proxy as an
unhandled error without persisting a session. This establishes a possible failure path, not the
cause of this particular human attempt. D2-031 introduces a typed MFA refusal and an awaited
callback-only error boundary. It retains MFA rejection and uses only the validated configured
origin and fixed `mfa_required`/`authentication_failed` codes with `no-store`; errors never create
a cookie or continue the request. Other paths still fail closed. Both profiles explain missing
MFA accessibly and never reflect arbitrary query/provider details. This choice improves failure
handling without weakening identity, scopes, session, or role controls. The local server was stopped
for rebuild; its existing `22:55:31Z` deadline is unchanged. Source `ecfb607` passes all 71 admin
tests in eight files and the full repository verifier (33 typecheck, 34 unit-test, and 20 build
tasks plus its guards; 30 database-gated tests remain skipped). It restarted locally at
`2026-09-06T21:12:59.290Z`; all eight assets and five anonymous/error/SDK probes pass, including
the rendered fixed MFA explanation without a session. The original encrypted setup, both client
environment files, and preceding runtime status remain unchanged. These local results do not
classify the user's prior attempt, prove a managed MFA login, or deploy the protected preview.
Actual human sign-in/MFA and separate reviewer activation remain pending.

On 2026-09-08 the user requested another local restart under the same two-hour scope. The new
fixed window is `11:38:16Z`–`13:38:16Z`; it does not renew the expired contribution policy or
change AWS permissions. The first launch failed its readiness check and stopped. A bounded retry
with a 45-second local page-readiness allowance succeeded at `11:40:58.376Z`; only fixed startup
stage metadata is retained, not raw errors. The unchanged verified `ecfb607` build listens only
on `127.0.0.1:3001`; its page/eight assets and all five anonymous/error/SDK probes pass. The original
encrypted setup, both client environments, and previous runtime record are preserved. This is
local availability evidence, not a human login/MFA, grant, role deployment, or hosted acceptance.

The 2026-09-08 human retry returned the fixed `mfa_required` code. After application-specific
Auth0 MFA setup guidance, corrected to **Actions > Triggers > Post Login**, the user explicitly
confirmed **Privileged session active**. The inspected page renders that status only for an
SDK session, and the unchanged session-save hook requires MFA proof. Record this as user-confirmed
local sign-in/MFA success, not an independently inspected claim set or a backend permission grant.
No callback URL, token, cookie, human subject, or MFA secret was collected. Exact signed
issuer/subject and granted-scope comparison against the separate encrypted setup remains pending.
The development SSO identity check is unavailable; no current cloud-state or role verification
is claimed. Refresh SSO and obtain explicit scope for the separate development-only appeal/read
assignment before proceeding beyond local sign-in. Keep the fixed local deadline and expired
contribution policy unchanged; no case decision or hosted deployment is authorized by this login.

On 2026-09-08 the user refreshed AWS SSO and confirmed proceeding with development-only human
appeal setup. STS matches the expected account and temporary SSO role. At `12:34:39Z`, read-only
checks match state `284`, Gateway/scheduled/Trust versions `52`/`14`/`11`, and their exact retained
environments; only the two existing machine assignments are deployed. Earlier `12:24:14Z` reads
find all 13 D2 alarms OK and both Trust queues empty. The proposed human-only addition fits the
unchanged limits: encoded configuration `2312/2400`, Gateway `3290/4096`, scheduled `3293/4096`.
This is not deployment evidence. D2-032 adds the missing private session/identity comparison;
the human must run it before any assignment apply. Its fixed setup window is
`12:19:08Z`–`13:38:16Z`, retaining the original local deadline and expired contribution policy.

The rebuilt private-check console, application source `f678b37`, started on loopback at
`12:40:28.527Z`; the page, nine static assets, SDK login boundary, and five anonymous checks pass.
The user must sign in again with MFA and select **Verify reviewer setup**; no identity result is
claimed from startup checks. The separate assignment-only operator has passed source review and
59 synthetic guard checks, but no real plan or apply has run. It requires the exact fresh private
result and permits only the two Lambda configuration updates and their unweighted aliases.

At `2026-09-08T13:19:45Z`, the user's explicit private check verifies the intended human against
the separate setup: exact issuer/subject/client/audience, fresh MFA, two privileged scopes, zero
unexpected scopes, and no role/case mutation by the check. The reviewed assignment-only plan from
source `01f6e94` applies at `13:23:01Z`, advancing state to `285` with only the four expected
in-place updates. Human `case_reader` and `appeal_reviewer` are deployed; the workflow opener and
agent initial/takedown assignments remain unchanged. Gateway `53`, scheduled `15`, and Trust `11`
pass exact artifact/environment readback, and a refresh-backed follow-up plan proposes no changes.
The `13:23:57Z` operational snapshot finds 13/13 alarms OK, both Trust queues observed empty, and
unchanged Trust concurrency, mapping, and schedule. These snapshots are not human API-access or
case-decision acceptance. The user subsequently confirms **No cases are awaiting this review**
after selecting **Load review queue** in the signed-in local console. This establishes user-confirmed
authenticated empty-queue read success, not appeal-decision or hosted acceptance. Local identity
setup and read access are no longer blockers. The contribution policy remains expired, and the
original local deadline is unchanged.

## Remaining acceptance and operator inputs

This is the outstanding acceptance list, not a claim that the corresponding source is absent.
Keep Greenhouse-only development separate from production/store release. Do not use an expired
signed policy as authority or promote the workflow's machine identity to a decision reviewer.

Current recovery disposition (`2026-09-11` UTC): D2-038/D2-050/D2-052/D2-053 are Complete.
One authorized exact-version completion-tag correction, strict same-copy already-reconciled
Inspect/Replay and all temporary-resource/permission cleanup pass. No recovery execution,
permission removal or repeated compatibility work remains. Fresh candidate-rights acceptance
is separate. The current outstanding actions are the table below; the dated chronology between
this paragraph and the table is preserved history, not a current login or recovery blocker.

D2-033 is closed following the user's 2026-09-08 reload/sign-in/job-add confirmation; that
completed development adoption step is no longer in the outstanding list below.

Resumed continuation on 2026-09-08: the user confirmed both requested inputs. Development STS
now succeeds in the exact configured account/region, and fresh authority permits reuse of the
existing encrypted initial/takedown reviewer credential. D2-R14/D2-R15 are Closed. The first
reviewer token request and one bounded diagnostic retry returned Auth0 `403 access_denied`,
classified as application API access not authorized. No token, case read, or decision resulted.
D2-R16 requires restoring only that existing agent application's client-access grant for the
Platform API, preserving its three approved scopes and the separate human appeal assignment.
No new secret, contribution-policy renewal, or AWS login is requested at this checkpoint.
After the next user confirmation, one fresh exact-boundary token request still returned the same
denial at `2026-09-08T22:14Z`; no token or case access resulted. A screenshot of that exact API's
application Client Access entry was requested, with secrets hidden, to resolve the actual
configuration difference rather than repeat token requests or change another identity.

On 2026-09-09 the supplied screenshot shows the three intended permissions under
**User-Delegated Access**, not **Client Access**. The machine reviewer needs the latter grant;
the user was given the exact tab/permission correction and no token request was repeated without
that change. The same message authorizes the isolated recovery role/drill, closing R17's authority
input. A fresh STS check reports the AWS SSO session expired, reopening R15; renew the development
session before any cloud plan or execution. No new cloud resource or permission has been created.

After the next user confirmation, exact development SSO passes at `2026-09-09T13:42:25Z` and
the existing reviewer authenticates with exactly `trust:review`, `trust:case:decide` and
`trust:case:takedown`. Nine bounded requests finish at `13:44:24Z`, reading three initial-review
cases and their provider evidence, with zero decisions and no next page. R15/R16 are Closed; no
Management API, grant change, new credential or human session was used. The new immediate work is
D2-039's stale-evidence repair and D2-040's effective state-locking correction. No recovery IAM,
restore or executor was created. Preserve the earlier records as history, not current blockers.

The subsequent approved toolchain transition completes D2-040/R18 at state `291`, with actual
locked planning, an equal-value sensitivity-only state update and a fresh zero-change plan.
No new reviewer grant or toolchain approval is needed. D2-039's exact Gateway/workers and the
single 44-migration execution now have a maintained resumed state-296/zero-drift verification.
The four dispatch/outbox/NAT/receipt guards and D2-042's shared-client repair are committed in
`e2e730a`, which passes the full maintained verifier. Its Gateway and D2 worker releases verify
at states `298`/`297`; three fresh evidence-bound initial decisions now read back accepted/version
`2`. The earlier `503`/version `1` failure is superseded and must not trigger a repeated decision.
The later D2-044 corrective rights release and mapping-only Resume verify at state `315`,
version-13 pins, positive activity health and zero changes. Fresh user export/deletion acceptance remains separate. The
dark-ingestion release and final canonical capture verify at state `308` with zero changes and no activation.
Owner publication, D2-038's authorized temporary-role activation/current-schema recovery/cleanup,
and the human/installed acceptance gates remain. No fresh signing policy, role expansion or repeated
recovery approval is needed.

Independent read-only release preparation confirms state `287`, exact Gateway/scheduled/Trust
versions `54`/`16`/`12`, unchanged Greenhouse-only source/verification registrations and all three
reviewer assignments, RDS backup coverage, and zero ECS tasks/services. Current-source release
can proceed separately while keeping additional providers disabled; the old one-time
development-mode cutover operator must not be replayed against the already-enabled mode.
The first `4f2462f` Gateway publication stopped at the audit before upload. After dependency repair,
`c66c8a5` Gateway/D2 artifacts were published and a new schema-7 capture confirms state `287`/zero
drift; no database migration, Lambda update, or provider activation was applied. Both Vercel builds
then exposed the omitted patch-file upload dependency, now included in D2-037's packaging repair.
Those failed attempts are superseded by the successful exact `42b9686` release above: state 290,
Gateway/scheduled/Trust 55/17/13, 42 migrations, both Vercel targets READY and zero drift.
D2-036 and D2-037 are Complete; D2-038 is implemented with cloud validation pending. Phase 2 remains In progress.

| Remaining item | Existing implementation | Required next action / recommended choice |
|---|---|---|
| Signed-in website visibility after owner publication status | Three accepted/version-2 initial decisions and subsequent processing/Trust aggregates pass. On September 11 the user reports extension Processing `published` and Trust `accepted`; the status readback is satisfied for the reported result, not inferred for every historical contribution. Authenticated candidate search/detail is implemented; anonymous public-job routes remain disabled. | In the signed-in candidate website, search for the same posting and open View details and sources. Confirm the expected title/company, description and source link, with no duplicate card for that posting. Report only whether it appears and the details match, or a fixed error. Browser control is unavailable here; no resubmission, token, identifier, new reviewer scope or repeated decision is needed. |
| Hosted reviewer, takedown and human appeal acceptance | All three assignments remain unchanged; the delegated agent's three actual initial decisions now pass. Prior human identity/fresh-MFA/two-scope checks and the user-confirmed empty local appeal queue remain distinct evidence. | Complete the hosted reviewer and separately authorized takedown/human appeal journeys. Preserve evidence/version binding and independent roles; do not manufacture a case, borrow the human session or treat machine initial-decision success as human acceptance. |
| Lever and Ashby enablement | D2-035's provider selection, fixed descriptors, forward lease migration and paired extraction/verification fixes are implemented and locally verified. The migration/runtime is released at source `42b9686`; generated actual-DOM tests pass in Edge and Chrome for Testing. Both providers remain disabled in development. | Acquire representative provider-derived fixtures, complete sanitization/scanning and separate QA acceptance, then activate exact development registrations. Do not repeat the completed migration release, weaken board limits, or ask again for waived blanket provider legal approval. |
| Fresh candidate-rights acceptance | D2-051's Gateway `423d63b` and core `2ff32ef`/version `14` releases are verified and resumed. Final recovery cleanup verifies Platform `329`/Bootstrap `21` with zero drift. The restored-only Replay found one already-reconciled historical subject and no documents. Dark ingestion remains disabled. | Complete separately scoped fresh user export/deletion acceptance; neither deployment nor the idempotent isolated Replay substitutes for it. Preserve queued work, retained durable/terminal obligations and all four false ingestion activation flags. |
| Installed authentication and full lifecycle | Initial Edge login and contribution acknowledgement pass; the user also confirms development-mode reload, sign-in, and successful job addition on 2026-09-08. The latest confirmation does not specify a browser or establish cross-browser parity. Automated protocol and Chrome-for-Testing/Edge layout tests pass. | Complete branded Chrome/Edge login cancellation, refresh rotation/replay, logout/revocation, cross-account and offline/restart journeys with disposable accounts; retain aggregate results only. |
| Human accessibility acceptance | Keyboard/reflow/geometry and automated axe checks pass. | Perform the documented assistive-technology journey in the exact candidate and record findings/decisions here; automated checks alone are not human review. |
| Authenticated load and abuse acceptance | Paced public-policy and unauthenticated-boundary workload passed. Separate paused-intake and active-processing-to-review runners pass 29 synthetic regressions. D2-045's matching inspector profiles are implemented and verified, including strict aggregates, metric coverage and settled queues. | Use explicitly scoped disposable authenticated candidates for a bounded development workload and matching server aggregates. The active runner follows the existing five-minute schedule, never approves a case, and is not throughput/publication acceptance. No production traffic, raw tokens, personal payloads, or invented provider truth. |
| Alarm notification receipt | Thirteen D2 alarms are healthy; guarded synthetic alarm/OK exercise and preflight are implemented. | Run the exercise last and obtain recipient confirmation of both ALARM and recovery; healthy alarm state is not proof of delivery. |
| Support and store release | Hosted support route, icons/promotion assets, disclosures, and deterministic packaging exist. | Name a monitored support channel, capture the exact installed listing screenshots, and obtain exact-candidate/accountable/store approval before distribution. |
| Final security/privacy/product acceptance and inherited D1 gates | Engineering delta and explicit development exception are documented. | Obtain the outstanding accountable dispositions without relabelling development evidence as production approval. Record any explicit scope deferral here. |

## Work log

| Date | Update | Tasks | Evidence |
|---|---|---|---|
| 2026-09-11 | User reports extension Processing `published` and Trust `accepted`. Recorded only those fixed statuses; no contribution count, token, identifier, independently inspected backend row or website visibility is inferred. This satisfies extension owner-status readback for the reported result and advances D2-019/D2-039; signed-in candidate search/detail is next. No new submission, review decision, cloud operation or activation. Phase 2 remains In progress. | D2-019; D2-039 | User confirmation in this conversation; [remaining website check](#remaining-acceptance-and-operator-inputs) |
| 2026-09-11 | Completed D2-054 source/local verification at `dd2d560`: serialized session/queue transitions, explicit logout barriers, refresh/dispatch coalescing, monotonic receipts and case-scoped reviewer drafts. Extension 258/258 and admin 174/174 tests pass, with 55/32 focused cases; independent review and full verifier `9865` / `a81c7a` pass, including 34 test tasks and 20 builds. Configured extension and admin local bundle rebuilt; no cloud/identity/provider change or new agent branch. Installed reload/lifecycle and hosted admin rollout remain separate. Corrected stale onboarding summaries without reopening completed D2-042 reviews or recovery. | D2-054; D2-012; D2-015; D2-007; D2-022 | [Implementation and verification](#d2-054--session-and-reviewer-state-transitions), [remaining acceptance](#remaining-acceptance-and-operator-inputs) |
| 2026-09-11 | Completed the bounded recovery under operator/artifact `6eb7a86`, leaving normal runtime `2ff32ef`/version `14` unchanged. Recovery `8649` / `7d6e48` verifies exactly one completion-tag Put; the original journal and linked companion remain intact. Fresh same-copy Inspect `70881` and Replay `87268` pass with one historical marker/one already-reconciled subject, no documents or new reconciliation, and zero S3/recovery-ledger writes or identity-provider calls. Final executor `9634`, PITR `62815`, Platform `329` and Bootstrap `21` cleanup all verify; drill-only permissions and canonical context are removed. D2-038/050/052/053 close, not fresh nonempty deletion or Phase 2 acceptance. Owner refresh now needs user help because browser control is unavailable. | D2-038; D2-050; D2-052; D2-053 | [Final evidence](#d2-038--isolated-deletion-recovery), [correction boundary](#d2-052--historical-completion-consistency), [remaining acceptance](#remaining-acceptance-and-operator-inputs) |
| 2026-09-11 | User approves D2-053 and closes R21 authority. Implemented the explicit linked pre-dispatch recovery without resetting the original attempt, with exact old/current preimage/intended continuity, authenticated finished zero-dispatch provenance, two fresh checks and one bounded tag send. Existing/new repair tests pass 199/199; protected storage passes 119/119 including 13 actual generated Windows cases; explicit operator/runtime source checks pass 274/274. Full repository verifier `25821` / `a32df3` exits 0, including all 20 builds. Original files/journal remain intact; five standalone artifacts and five emitted dependencies are archived owner-only before builds. No new branch, Docker start, cloud write, historical correction or ordinary Inspect/Replay. Source integration and same-copy execution follow. | D2-053; D2-052; D2-038 | [Recovery design](#decisions-and-scope-changes), [execution boundary](../../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md#separately-authorized-recovery-of-a-proven-pre-dispatch-refusal) |
| 2026-09-10 | Actual `dda6003` native restore-role Enable verifies at Platform `318`. A separately reproduced PowerShell 7.5 cleanup defect stops recovery before any target/executor exists; exact unused cleanup verifies Platform `319`/Bootstrap `19`, all temporary authority off. D2-047 authenticated website details and D2-048 exact environment restoration are integrated directly on shared main. Web 629 tests, final UI 38/38, eleven Chrome scenarios, five public-page result groups, production build/typecheck and integrated 266/260 inspector assertions pass. Full committed-source verification, candidate-only release and authorized recovery follow. No new branch, provider, reviewer or human acceptance claim. | D2-047; D2-048; D2-038 | [Website implementation](#d2-047--authenticated-website-job-details), [reproduced cause and cleanup](#d2-048--runtime-inspection-environment-restoration) |
| 2026-09-10 | Exact `c9351e21793389ed3926718fa7fad46e296d9898` passes the full maintained verifier and all 20 build tasks (19 cached), and is pushed to shared main with Actions skipped. Independent integration review finds no issue across 19 changed files and 1,101 Markdown targets. D2-048 is Complete for tooling; D2-047 awaits only its candidate release and separate owner acceptance. Only these two delivery documents change after verification. Continue candidate-only deployment and already-authorized current-schema recovery without rereleasing healthy AWS applications or changing provider/reviewer scope. | D2-047; D2-048; D2-038 | [Verified website source](#d2-047--authenticated-website-job-details), [verified operator repair](#d2-048--runtime-inspection-environment-restoration) |
| 2026-09-01 | Started Phase 2 from clean checkpoint branch `phase-2-extension-and-community`. The primary worktree was clean; the stale ignored Phase 0 extension bundle was removed, and an ancestry/patch-equivalence audit began for the separately registered historical Phase 1 worktrees and branches before any cleanup. Docker Desktop and its remaining WSL engine were stopped because the initial contract, extension, and governance work does not require them. Read-only architecture and gap audits confirmed that the inherited extension is only a fail-closed Auth0 shell and that the Jobs contribution API is D2-owned work not yet implemented. Public contribution, provider detector activation, and store distribution remain default-off behind D2-010/D2-011. | D2-001, D2-002, D2-003, D2-004, D2-005, D2-006, D2-011 | [Extension boundary](../../../frontend/extension/README.md), [UGC lifecycle](../../adr/005-ugc-lifecycle.md), [Phase 2 tasks](phase-2-extension-and-community.md) |
| 2026-09-01 | Landed the default-dark MV3 extension shell, exact synthetic-only detectors, explicit field preview, bounded offline queue, version/provider/domain controls, and release-source assurance. The extension still cannot submit a contribution because the versioned consent and exact server request seam is intentionally unresolved and all delivery switches remain off. | D2-001–D2-005, D2-014, D2-015, D2-017 | Commits `d2f2fc0`, `de021bd`; [extension README](../../../frontend/extension/README.md) |
| 2026-09-01 | Landed the Trust state-machine/PostgreSQL foundation and Profile-owned immutable contribution-consent persistence. Trust remains isolated from Jobs catalog mutation, and consent has no public API or extension binding yet. Focused unit, type, build, migration replay, and PostgreSQL integration suites passed. | D2-006, D2-007, D2-013, D2-017, D2-022 | Commits `8880d0d`, `b92b7ea`; [ADR-028](../../adr/028-extension-ugc-ownership-and-processing.md) |
| 2026-09-01 | Added truthful store disclosure/listing/support drafts and deterministic fail-closed packaging. Two builds produced the same six-file archive SHA-256 `7deadee1e94b2fb6445b0921e234d2e879ded823d77a21ebd9eef7bfe200ff82`. This is repository evidence only, not accountable or browser-store approval. | D2-009, D2-010, D2-015 | Commit `9c6762b`; [store release materials](../../../frontend/extension/store/README.md) |
| 2026-09-01 | Converted the end-to-end audit findings into explicit tasks for consent binding, private capture, durable processing, candidate rights/recovery, server-enforced kill switches, and Trust integration. This prevents queued intake or repository-only packaging from being mistaken for an activatable Phase 2 release. | D2-017–D2-022 | [Task register](#task-register) |
| 2026-09-01 | Landed the Jobs-owned queued contribution contract, exact provider/variant/host validation, server-recomputed digests, default-deny consent port, immutable intake, and identifier-only outbox. Gateway source routes exist for local composition, but Lambda rejects them and no write can pass until D2-017 injects a real Profile verifier. Focused contract, event, Jobs, Gateway, and fresh-PostgreSQL suites passed. | D2-005, D2-006, D2-014, D2-017, D2-019 | Commit `bc9c04f` |
| 2026-09-01 | Added fail-closed configurable local queue expiry, explicit stopped/all-item removal, and logout clearing. Source enforces a one-hour minimum and 30-day maximum but selects no accountable live duration. Extension typecheck and 21 tests passed; the changed default-dark six-file archive SHA-256 is `2ec9649cf4ba51bfd9bec3b53c9f875fb9018912203054572c286d7fb86bba57`. | D2-005, D2-009, D2-013, D2-015 | Commit `9e8b9e1` |
| 2026-09-01 | Completed the historical Phase 1 branch-residue reconciliation. The four apparently unique agent refs were byte-identical duplicates, subsets, or earlier incomplete forms of squash commits already in checkpoint `32268eb`; no merge was needed. Removed only those four redundant local refs, retaining the checkpoint, reconciliation evidence, all remotes, and all unrelated refs. | Phase 1 cleanup | [Reconciliation evidence](evidence/d1-agent-branch-reconciliation-2026-08-24.md) |
| 2026-09-01 | Landed Matching-owned private saved-page capture persistence separately from public contribution. The slice enforces exact provider variants, bounded sanitized fields, owner isolation, immutable originals, explicit independently verified canonical resolution, and candidate export/deletion. It has no public outbox and cannot publish or refresh Jobs. Matching typecheck/build, 101 unit tests, and 10 PostgreSQL integration tests passed. | D2-003, D2-005, D2-018, D2-020 | Commit `750b2d9` |
| 2026-09-01 | Added a default-deny Trust application service with explicit contributor, reviewer, verified-requester, contribution-evidence, policy, and persistence ports. It supports owner read/withdraw/appeal and reviewer open/decision/takedown/appeal resolution with fixed codes, evidence digests, versions, and different-reviewer enforcement. It adds no Trust-to-Jobs mutation. Trust typecheck/build and 18 unit tests passed. | D2-007, D2-022 | Commit `0829c3b` |
| 2026-09-01 | Extended the migration image and read-only exact restore manifest to Profile `0008`, Jobs `0014`, Matching `0003`, and Trust `0001`: six owners, ten schemas, 56 relations, and 31 checksum-bound migrations. A fresh temporary PostgreSQL aggregate verification passed; this is local repository evidence, not AWS restore acceptance. Trust candidate export/delete and stale PowerShell operator assumptions remain explicit blockers. | D2-016, D2-020 | Commit `c0bcbbd`; manifest SHA-256 `c4510fac32870e3c6f6b667928b95905b63e360eb5fa52ff0e49f749ce285c57` |
| 2026-09-01 | Added identifier-only `job.normalized.v1`, `job.verified.v1`, and `job.expired.v1` contracts plus an explicit source-freshness policy registry. No provider/variant timing exists by default. Community observations and candidate closed reports can request revalidation but cannot advance the verification clock, extend expiry, close a listing, or reverse an administrative block. Event-contract type/build and 16 tests plus Jobs typecheck and 87 tests passed. | D2-006, D2-008, D2-019 | Commits `5b4bce2`, `087ae69` |
| 2026-09-01 | Added Trust-owned candidate export and deletion. Export is exact-owner scoped and omits reviewer identities, source reputation, and unrestricted values; deletion requires the Profile/privacy authorization seam and removes dependent Trust records in one transaction while preserving other owners and source evidence. Trust type/build, 18 unit tests, and two PostgreSQL integration tests passed. The aggregate recovery inventory is intentionally pending the concurrently added D2 migrations. | D2-007, D2-020, D2-022 | Commit `e9947df`; Trust `0002` SHA-256 `ff3a95ffedbf3cb59870ff69cd34593338787af27c3d311f87ed95fda4f728a6` |
| 2026-09-01 | Bound public contribution to a server-issued immutable Profile consent through a shared canonical preview digest. The extension uses distinct stable idempotency keys for grant and contribution, persists a returned consent across ambiguous contribution retries, and safely replays an ambiguously committed grant. No live policy is hardcoded; server and extension both fail closed when their injected policy is absent or mismatched, and Lambda routes remain disabled. Focused API, Profile, Jobs, Gateway, extension, PostgreSQL, generation, packaging, build, and type suites passed. | D2-003, D2-005, D2-006, D2-017 | Commit `b7a386b`; default-dark archive SHA-256 `a2405de8e9fcae36bf0fc2bc8fbb2225e96c9ed13d0e0261bca7c22aec9b1e5f` |
| 2026-09-01 | Tightened local capture against malicious or structurally ambiguous pages: exact supported path shapes are required, credentials are rejected, all query/fragment data is discarded, and extended/bidirectional controls plus markup are removed before preview. Seven focused capture tests and extension typecheck passed. | D2-002, D2-004, D2-015 | Commit `120f543` |
| 2026-09-01 | Removed the Phase 1 verification launcher assumption that `pwsh` must exist. Root scripts now prefer PowerShell 7 and fall back to Windows PowerShell for compatible checks, while PS7-only checks remain explicit. The D1 catalog unit verifier, including its nested PowerShell self-test, passed through the fallback path. | Phase 1 cleanup; D2 operator readiness | Commits `0c949c7`, `65e8293` |
| 2026-09-01 | Extended candidate rights to Profile-owned UGC consent history. Export includes allowlisted owner records without preview digests, internal lineage, or command receipts. Authorized deletion removes consent history and its internal receipts transactionally; ordinary mutation and cross-owner access remain denied. Profile type/build, 26 unit tests, and nine PostgreSQL integration tests passed. | D2-017, D2-020 | Commit `ae120de`; Profile `0009` SHA-256 `94ec1bdf4956eda831cbe9dbcd6a5f70b11941d679e84a9cd0d11355be05905a` |
| 2026-09-01 | Added the Jobs-owned source revalidation lifecycle: a DB-guarded priority/lease/retry queue, append-only independent verification evidence, explicit multi-source closure, default-deny administrative authority, and policy-clock suspect/expiry transitions that erase nonminimal payloads. Community observations and candidate reports only enqueue digest-keyed priority; they never advance freshness or close a job. No timing policy or provider verifier is live. Jobs type/build, 92 unit tests, migration replay, and three isolated PostgreSQL integration tests passed. | D2-007, D2-008, D2-019 | Commit `e622cea`; Jobs `0015` SHA-256 `6ca918a9df5350f1c648ba00da1c8ce84f2a32e506962780d8d2bfbc65e66ee7` |
| 2026-09-01 | Added the server-side signed capability-policy contract for public contribution. The bounded Ed25519 envelope expires within 24 hours and independently controls intake, processing, exact extension version, provider, page variant, and domain. Missing map entries deny; stale, tampered, unknown-key, structurally incomplete, and out-of-scope policies fail closed. This pure contract does not fetch configuration or activate a route. Three focused tests and Jobs typecheck passed. | D2-014, D2-021 | Commit `8084b4b` |
| 2026-09-01 | Completed the private saved-page capture application seam. The versioned owner-only POST/GET/DELETE contract uses stable idempotency, strict sanitized payloads, no-store redacted responses, real Profile active-account authority, and an extension transport independent of public-contribution consent. No public resolution-write route, outbox, or catalog mutation was added, and Lambda remains default-dark. API contracts (47), Matching unit (101) and PostgreSQL integration (10), Gateway (139), extension (29), package builds/typechecks, and extension release assurance passed. | D2-003, D2-018, D2-020 | Commit `d3e8220`; generated contract SHA-256 `413f0c3607f5b8fdfdd9e9fc8767ca1226fccd07f8e2a9c7522b8918c851533c` |
| 2026-09-01 | Extended Jobs candidate rights to queued public contributions. Exact-owner export returns only allowlisted submitted fields and consent references; internal payload wrappers, digests, command identity, request hashes, and other owners are excluded. Privacy-ledger-authorized deletion removes only the owner's contribution outbox and intake rows while preserving provider truth, catalog data, revalidation state, and independent verification evidence. Jobs type/build, 95 unit tests, 47 PostgreSQL integration tests, migration replay, and focused rights checks passed. | D2-006, D2-020 | Commit `23345d8`; Jobs `0016` SHA-256 `c1028c6a9bedabaa57cdb803de48261f9ed1a83aec1abbeb59104970ddb4bff8` |
| 2026-09-01 | Replaced the extension's static contribution switch with a pinned-key Ed25519 policy runtime. Missing, future, expired, incomplete, unknown-key, tampered, rollback, and forked policies deny; global intake, exact client version, provider, variant, and domain are independent. A current signed cache survives bounded offline/restart outages only until expiry, while received invalid policy clears it. Private save remains independent, installed version is visible and digest-bound, and packaging rejects remote/dynamic code. Extension typecheck, 40 tests, source assurance, and two byte-identical packages passed. | D2-003, D2-005, D2-014, D2-015, D2-021 | Commit `141ab46`; default-dark archive SHA-256 `1bcf6fee93f70477f62808e2d8f1afa6ad9f21d1f693accaf9f3725d752be415` |
| 2026-09-01 | Split page inspection/private save from public-contribution activation. Inspection now requires an exact, explicitly supplied detector revision/client-version/provider/variant/domain map; missing, malformed, disabled, or unsupported entries deny. Signed contribution policy controls only enqueue and delivery. The default package contains no detector configuration and no provider host grants. Extension typecheck, 42 tests, source assurance, and two byte-identical packages passed. | D2-002, D2-003, D2-004, D2-014, D2-015 | Commit `00dc95b`; default-dark archive SHA-256 `9d7c2114dcc01b4b5dd0f92c33de6b44a85d6e3efd41c6e54e3650a49cd11ddc` |
| 2026-09-02 | Added default-dark candidate and reviewer Trust APIs plus an accessible same-origin admin review console. Candidate reads are contribution-keyed and exact-owner scoped; reviewer identity is derived only from explicit issuer/subject assignments and role/scope mapping; ordinary admin login cannot request the separate verified-requester takedown authority. Case opening is deterministic and ambiguity-safe, projections are redacted/no-store, and Lambda remains dark. Contract (51), Trust (20), Gateway (145), and admin (17) tests, typechecks, and admin build passed. | D2-007, D2-015, D2-022 | Commit `0070c3b`; generated contract SHA-256 `aec885b0cc47337e6bb5851c6118d909b995e82ca1c40f538b882df68ff9f761` |
| 2026-09-02 | Added the durable Jobs-owned contribution-processing core. A guarded PostgreSQL lease/retry queue recovers expired claims and parks dependency/capability waits until explicit signals. Bounded normalization, deduplication, independent provider evidence, append-only Trust decisions, and final transactional publication/removal checks preserve provider truth and prevent queued community input from changing catalog freshness. Candidate export/deletion covers processing history without internal Trust decision IDs. Seventeen-migration replay, Jobs build/typecheck, 113 unit tests, and focused PostgreSQL reconciliation passed. | D2-006, D2-007, D2-019, D2-020, D2-021, D2-022 | Commit `b1e3227`; Jobs `0017` SHA-256 `3337961fa2021c6b0d86a5021e7d60bfb6cb47477ad9de030b0732ff8f6b1562` |
| 2026-09-02 | Added a validated, independently default-off Phase 2 Terraform seam. Its only non-disabled state is gateway-dark: it injects one reviewed policy-version token and the bounded contribution/reviewer JWT scope inventory into an already enabled gateway, while adding no D2 route, processor, schedule, timing default, or AWS mutation. Source remains structurally dark until application handlers, signed policy/key delivery, Trust composition, processing entry point, and reviewed signal contracts exist. Forty-seven module tests, recursive formatting, and development/staging validation passed. | D2-014, D2-016, D2-021, D2-022 | Commit `5933a5d` |
| 2026-09-02 | Closed the remaining repository-local extension boundary gaps. Both session and local storage are restricted to trusted extension contexts; optional-field removal applies to private save and contribution; destructive queue clearing requires confirmation; popup/side-panel focus, live-region, busy-state, and skip-link behavior is source-checked; zero-width spoofing controls are removed; release packaging rejects common telemetry endpoints; and client-version validation is shared and bounded. Typecheck, 47 tests, build, release assurance, and two byte-identical packages passed. | D2-001–D2-005, D2-009, D2-014, D2-015 | Commit `44629ef`; default-dark archive SHA-256 `85d6cc17aaa632ae903d8bf88acd1b12cc37bef70c6f4dc4c7262f263f90455d` |
| 2026-09-02 | Completed the default-dark signed-policy, owner-status, event-delivery, and source-callable runtime boundary. The anonymous no-store endpoint exposes only a verified envelope; one pinned-key source feeds both local intake and public reads and rejects missing, stale, future, unknown, malformed, forked, or rollback configuration. Owner reads project the latest safe state. Immutable processing events use a separate lease/retry/ack/dead ledger with stable event IDs, and the batch runtime emits aggregate counts only while requiring every authority, policy, transport, and clock to be injected. Lambda and scheduling remain dark. API (54), Jobs (123), Gateway (149), clean migration replay, and three focused PostgreSQL checks passed. | D2-006, D2-014, D2-019, D2-020, D2-021, D2-022 | Commit `43ffcf8`; generated contract SHA-256 `25f404fa34f44138fcd2307e009bcb6ab5f5fdc5356325affa66f76918359a21`; Jobs `0018` SHA-256 `08765c8679d2b65b80ac51dd588267d3111b2729e6abd773d2dd5a974e75a972` |
| 2026-09-02 | Refreshed the exact Phase 2 recovery/package/operator boundary through Profile `0009`, Jobs `0018`, Matching `0003`, and Trust `0002`: six owners, ten schemas, 66 relations, and 37 checksum-bound migrations. A clean isolated PostgreSQL instance applied every owner, then a dump/restore into a distinct database produced byte-equal source/target verifier results. Database-migration type/build, 35 tests, and both PowerShell guards passed. This is local synthetic structural evidence, not AWS recovery acceptance. | D2-016, D2-020 | Commit `d24b2a0`; manifest SHA-256 `c3a1e0b3ba22a6d5e2b1cb35171f00069ffdce52f284cadb99730508eca7800f`; aggregate digest `8edff70457d93c9a874f4799f3f0ec82fdc471c1f5bc91b78d847d88f6c2236f` |
| 2026-09-02 | Added the remaining safe contribution-runtime adapters: processing-time Profile consent revalidation with exact binding checks, runtime-owned PostgreSQL publication reconciliation, and an identifier-only outbox nudge publisher that carries only schema version, event ID/type, and integrity digest. No queue URL, provider fetcher, Trust decision source, scheduler, timing, or live policy was invented. Jobs build/typecheck, 125 tests, fresh migration replay, and focused processing integration passed. | D2-006, D2-019, D2-021 | Commit `6738527` |
| 2026-09-02 | Added a default-dark independent provider verifier over the existing allowlisted ingestion adapters. It requires an exact explicit provider/variant/tenant/source-policy registration, independently fetches and canonicalizes provider truth, compares only selected normalized contribution fields, and resolves an existing job/source pair through an injected read-only exact catalog lookup. Missing, ambiguous, or malformed catalog identity denies; the verifier cannot write observations or freshness. Ingestion 107 tests, typecheck, and build passed. | D2-006, D2-011, D2-019 | Commit `a44deb0` |
| 2026-09-02 | Extended aggregate candidate rights to the exact seventh owner, Trust. New exports require strict reviewer-redacted Trust case/event/contributor-evidence data; active deletion and restored-deletion replay call the authoritative Trust handler transactionally. The immutable D1 policy remains unchanged, while generated-synthetic D2 policy `d2-development-synthetic-v1` carries the seven-owner inventory with SHA-256 `7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf`. Terraform 48 tests, both PowerShell operator suites, Domain, Profile, and Workflow checks passed. No live configuration was changed. | D2-020 | Commit `aca0762` |
| 2026-09-02 | Connected append-only Trust decisions to parked Jobs processing without sharing private payloads. Each Trust transition has a deterministic stable event ID and atomically appends an identifier-only outbox record plus a separately guarded delivery row. The generic transport carries only event ID/type/integrity; Jobs reloads the contribution owner, performs an exact owner-bound Trust read, copies actionable decision truth through its own store, and explicitly requeues the contribution. No queue, scheduler, timing, or policy defaults were selected. Event contracts 17 tests, Trust 23 unit plus focused PostgreSQL tests, Jobs 129 tests, builds, typechecks, migration replay, format, and lint passed. | D2-007, D2-019, D2-022 | Commit `91dbcd3`; Trust `0003` SHA-256 `8500dd422334932508ae2588a91aa685846b989eb1d7e1b3e922f5d075ac0162` |
| 2026-09-02 | Refreshed the aggregate migration-image and recovery boundary through Trust `0003`: six owners, ten schemas, 38 checksum-bound migrations, and 68 relations. A fresh isolated PostgreSQL 16.6 instance applied every owner, then dump/restore into a distinct database produced exact source/target verifier equality. Database-migration 35 tests, typecheck/build, both PowerShell restore guards, and the migration-image publisher guard passed. This remains local structural evidence, not an AWS recovery acceptance. | D2-016, D2-020 | Commit `471d70a`; manifest SHA-256 `0ab0e49d7181456c35fc66b4fea5b3aabab8fd9d89469f13cd31b7d223e98e8b`; aggregate digest `94163d103b2e576389c3ed3d88f6abd7a7935e628b8d1d396436cda3d8e1fde5` |
| 2026-09-02 | Added four independently default-dark Lambda route groups for private capture, anonymous signed policy, candidate contribution/owner Trust, and reviewer Trust. Every D2 request requires both complete explicit composition and its exact API Gateway `routeKey`; `$default` and mismatched route keys remain 404 before authentication/application dispatch. Private capture stays independent, while contribution uses the same pinned signed-policy source as local and Trust composes only from exact reviewer/evidence/policy/system-actor inputs with matching OIDC issuer. Config 17 focused tests, Gateway 61 focused tests, typechecks, builds, and formatting passed. | D2-012, D2-014, D2-016, D2-021, D2-022 | Commit `af8f8b2` |
| 2026-09-02 | Added an import-safe, default-dark community Lambda boundary with exact scheduled and dedicated Trust-signal SQS handler factories, partial-batch failures, SHA-256 nudge integrity, a 4 KiB cap, and aggregate-only metrics. Jobs event delivery is now independently optional: without a real publisher it never constructs or claims the delivery ledger, preserving authoritative events. The artifact built twice byte-identically with SHA-256 `8e0b1c59fcf8a332953dfccdc04048f627969292e5b7e0164ff13a3f2d22c435`; it remains inert until a release supplies every dependency and Terraform creates exact triggers. Jobs 131, Trust 23, and Workflows 77 tests plus typechecks/builds passed. | D2-016, D2-019, D2-022 | Commit `aa11564` |
| 2026-09-02 | Added independently gated Phase 2 Terraform composition. Repository defaults create zero D2 functions, aliases, queues, triggers, routes, mappings, or NAT. Dark deployment can provision two immutable aliases, a dedicated encrypted Trust-signal queue/DLQ, split exact IAM, and eight Lambda/queue alarms while leaving every route and trigger absent. Activation is structurally possible only with explicit artifact, concurrency, schedule, processing/delivery, signed-policy, Trust authority/timing, route budget, alarm, runtime-authority, and release-authority inputs; D2 scopes were removed from the generic `$default` route. Module validation, 46 Terraform tests, recursive formatting, and development/staging validation passed without AWS mutation. The application artifact remains deliberately unactivatable until its release initializer is completed. | D2-016, D2-021, D2-022 | Commit `394ac60` |
| 2026-09-02 | Added bounded contributor-reputation projection and fixed accepted-decision replay. Accepted, incorrect, abusive, and reversed outcomes map only to explicit contributor evidence; no source reputation or employer truth is inferred. A previously copied accepted Trust decision is reused instead of being reevaluated on the next processing attempt. | D2-006, D2-007, D2-019, D2-022 | Commits `16f0804`, `a309ff0` |
| 2026-09-02 | Added bounded installed-Edge assurance and the owner-visible extension contribution loop. Identifier/status-only receipts survive restart behind an account fence; manual refresh, confirmed withdrawal, and confirmed appeal are explicit. Appeal text is bounded and hashed in the popup so only its digest crosses extension messaging. Sixty-six extension tests, typecheck/build, release-source assurance, installed synthetic Edge checks, and two byte-identical packages passed. | D2-001, D2-005, D2-009, D2-015, D2-019, D2-022 | Commits `327946c`, `b5b8931`; final formatted default-dark archive SHA-256 `d61bcd96ef6faee4b2b5959a709b1848b2f846d6840059ce0e316b95946b44d9` |
| 2026-09-02 | Added dimensionless aggregate community EMF metrics and guarded operations. Processing/delivery/signal outcomes contain no dimensions, IDs, URLs, payloads, or arbitrary errors. The repository can build and immutably publish a deterministic D2 artifact, verify routes/triggers remain dark, and emit non-mutating rollback/alarm prerequisites without changing AWS. | D2-009, D2-013, D2-016 | Commits `085e581`, `057b423`; [default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-02 | Completed provider-truth publication. Independent fetching may stage a bounded provider observation before a catalog identity exists; final reconciliation atomically reuses an exact source or creates a genuinely new job/source only after current consent, signed capability, independent verification, and accepted Trust. Probable duplicates roll back and park, replay preserves IDs, and nullable staging retains all catalog foreign keys. Jobs 133 unit/49 PostgreSQL integration and ingestion 107 unit/1 integration tests passed. | D2-006, D2-008, D2-019 | Commit `18c41bf`; Jobs `0019` SHA-256 `4da15bc6cdb347c65ff71c71b266b3d857962bb91e3dc4bc970a45a09dbe9fae` |
| 2026-09-02 | Composed the real lazy community Lambda runtime with one-connection PostgreSQL stores, Profile consent, Jobs catalog/publication, exact provider registrations, Trust case/decision delivery and signal consumption, managed secret resolution, and exact identifier-only SQS transports. Scheduled and receive-only signal initializers retain separate least privilege and remain import-safe/default-dark. Workflows 95 tests, typecheck/build, and two byte-identical complete artifact builds passed. | D2-016, D2-019, D2-022 | Commit `e64e00b`; final formatted artifact SHA-256 `5f98491a9a40dead04eaba4c3cbd9cb44040681357a45aed78cbc86374cd8fd3` |
| 2026-09-02 | Refreshed recovery through Jobs `0019`. A clean PostgreSQL 16.6 apply plus dump/restore proves exact source/restored equality for six owners, ten schemas, 68 relations, and 39 checksum-bound migrations, including the staged provider projection and retained catalog foreign keys. This is local structural evidence, not deployed RDS recovery acceptance. | D2-016, D2-020 | Commit `33dec2a`; manifest SHA-256 `86e6e1f1cd17ba92862c6ee5ea7ada9a83a0f2367758e74447fe519e6ed7c119`; aggregate digest `9132cb206675ba5e5c1c1396c55254352818fa21735876935997b44f201072ba` |
| 2026-09-02 | Completed runtime Terraform composition. Activation now requires nonempty exact provider sources and matching verification registrations, explicit provider-only private egress, signed capability and Trust authority, and all prior gates. Only the activated scheduled Lambda uses the retained provider subnets/NAT; dark deploy remains NAT-free. Five dimensionless application-failure alarms join the standard Lambda/SQS alarms with ALARM/OK SNS actions; expected `JobsParked` is not alarmed. Module tests and development/staging validation passed with no AWS execution. | D2-006, D2-008, D2-016, D2-019, D2-022 | Commit `19bc7e7` |
| 2026-09-02 | Completed the integrated repository-local verification after synchronizing infrastructure guards, formatting all Phase 2 sources, bounding web-test workers, and serializing database-backed files within each owner suite. Contract generation was stable; the complete repository check passed 34/34 tasks; all six owners applied 39 migrations in production order on fresh PostgreSQL 16.6 before 29/29 integration tasks passed; installed Edge, D2 operator guards, and all 46 Terraform tests passed. No AWS mutation, live provider request, real candidate data, Auth0 lifecycle, or store submission occurred. | D2-009, D2-015, D2-016, D2-020 | Commit `af95bd4`; extension archive SHA-256 `d61bcd96ef6faee4b2b5959a709b1848b2f846d6840059ce0e316b95946b44d9`; runtime artifact SHA-256 `5f98491a9a40dead04eaba4c3cbd9cb44040681357a45aed78cbc86374cd8fd3` |
| 2026-09-02 | Enabled the exact five-host detector matrix only in ignored machine-local extension configuration for product-owner testing, and separated explicit local preview from Auth0/API delivery gates. A current Greenhouse page then exposed an insecure page-owned canonical URL; inspection now keeps the already-authorized active HTTPS tab as source identity and recognizes the current `.job__location` element. The extension still requires authentication and an API for private save, and its signed capability policy for public contribution. Source defaults, deterministic store packaging, deployed routes, and provider acceptance remain dark; this override is not D2-011 evidence or activation authority. Extension typecheck and all 67 tests passed, and the rebuilt background worker contains the exact local revision `d2-local-detectors-v1`. | D2-001, D2-002, D2-003, D2-011, D2-015 | [Extension boundary](../../../frontend/extension/README.md) |
| 2026-09-02 | Reviewed an installed narrow Greenhouse preview supplied by the product owner. The capture now succeeds, but required markers overlap labels, essential text is undersized, technical fields outrank job content, company/external identity are absent, clamped values cannot be expanded, delivery readiness is unclear, and the primary action sits below a long scroll. Added D2-023 with explicit semantic, responsive, content, state, action, accessibility, privacy, and installed-browser acceptance; no screenshot or raw provider page was retained in the repository. | D2-003, D2-009, D2-015, D2-023 | [Installed narrow-layout acceptance](#d2-023-installed-narrow-layout-acceptance) |
| 2026-09-03 | Completed the initial D2-023 narrow redesign checkpoint, which ADR-029's following workflow revision supersedes. Job content led; source metadata, contribution, queue, and history used progressive disclosure; required/optional/missing semantics did not overlap; long URL/description values expanded; and exact selection summaries updated live. Structured data and exact provider markup supplied company/job identity, URL identity required exact provider-shape validation, and structural duplicate headings were normalized. Extension typecheck, build, 71 tests, targeted formatting, and installed Edge passed at that checkpoint. | D2-002, D2-003, D2-009, D2-015, D2-023 | [Installed narrow-layout acceptance](#d2-023-installed-narrow-layout-acceptance), [browser assurance](../../../scripts/tests/d2-extension-assurance/README.md) |
| 2026-09-03 | Revised D2-023 to the product owner's public-add-only workflow. The first responsive-width attempt could collapse during Chrome popup intrinsic sizing, so the final build now generates distinct surfaces: an explicit 448-pixel-wide, 600-pixel-minimum-height popup and a responsive side panel that preserves 320/360/480-pixel and 200% reflow. It separates grounded work type from location, removes the private-save control and redundant approval checkbox, and makes **Add job to shared database** the single explicit delivery command. The existing digest-bound v1 consent record remains an internal authorization/audit receipt; provider verification, moderation, idempotency, attribution, withdrawal, rights, and default-dark gates remain unchanged. Extension typecheck and 71 tests pass; source assurance verifies the distinct generated surfaces; installed Edge measures the popup at exactly 448 pixels and reports zero overflow, overlap, clipping, external requests, telemetry, or retained sensitive artifacts; and two package builds are byte-identical. | D2-003, D2-005, D2-009, D2-013, D2-015, D2-017, D2-018, D2-023 | [ADR-029](../../adr/029-one-step-public-job-addition.md), [browser assurance](../../../scripts/tests/d2-extension-assurance/README.md); archive SHA-256 `0307fa8f05bf818b6836c7069afa0a02feeea8c6824714bbec566c9ad77a7212` |
| 2026-09-03 | Configured the dedicated extension Auth0 Native Application and exact installed-Edge callback, added the dedicated `jobs:contribute` API permission, granted the least-privilege user-delegated scope set, and reached authenticated delivery readiness in the installed extension. Selected a 24-hour local pending-intent retention period for the Phase 2 candidate and embedded it only in ignored machine-local configuration; extension typecheck, all 71 tests, and the rebuilt configured package pass. Remaining D2-012 lifecycle cases and the independently signed contribution capability still fail closed. | D2-005, D2-012, D2-013 | [Auth0 development runbook](../../security/auth0-development-runbook.md), [D2 security/privacy delta](../../security/d2-extension-ugc-security-privacy.md) |
| 2026-09-03 | Added an offline Ed25519 key/sign/verify operator whose private material and receipts remain under ignored development state, generated one non-overwriting development key, and produced a verified short-lived all-disabled policy. Added a separate Terraform `policy_endpoint_enabled` seam: it injects only the signed envelope and pinned public keys into Gateway and creates only the anonymous no-store policy route, while contribution/private/Trust routes, schedules, queue consumers, and provider egress remain structurally absent. Gateway/Jobs source behavior, extension verification, all 46 Terraform tests, and focused operator guards pass locally; AWS deployment is the next D2-016 step. | D2-014, D2-016, D2-021 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-03 | The first policy-endpoint Gateway publication stopped before upload when the current dependency audit detected newly published advisories. Upgraded Fastify to 5.12.1 and pinned patched transitive `fast-uri` 3.1.6/4.1.4, `qs` 6.16.0, and `@xmldom/xmldom` 0.9.12. The centralized audit then passed with only its two existing exact, expiring mobile-build exceptions; Gateway and mobile typechecks/tests pass. | D2-009, D2-016 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-03 | Deployed the independent signed-capability endpoint in development from exact Gateway source `016e632`. The first live probe exposed and then regression-fixed an invalid coupling between the anonymous policy read and the separate mutation consent-policy gate. The corrected endpoint returns `200`, `application/json`, and `no-store`; its response exactly matches the locally verified Ed25519 envelope SHA-256 `3e698b21d768efa32acade95741dbe2ce99982e897352a3a4e98f21a4a366697`, with intake and processing false and no enabled provider, variant, or domain. State `249` retains exactly one policy GET, zero D2 mutation/private/Trust routes, zero D2 mappings, zero D2 schedule targets, no deployed D2 worker, and zero drift. The short-lived development policy expires at `2026-09-04T15:55:35.700Z`; rotation must use the offline signer before continued testing. | D2-014, D2-016, D2-021 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-03 | Began the explicitly requested development contribution activation review. The deployed runtime has no synthetic-provider activation mode: enabling contribution exposes the authenticated D2 routes and requires a real, enabled Greenhouse/Lever/Ashby source plus independent-verification registration and provider-only egress. The review therefore did not misrepresent real-provider activation as synthetic. It also repaired the D2 artifact operator's recursive `aws` command resolution, strict-mode clean-tree handling, and state-bucket/artifact-bucket separation; live status and regression guards pass. The first full-dark apply created only the reviewed roles, encrypted queues, endpoint-policy additions, and alarms before Lambda rejected the object version from the incorrectly selected bucket; no route, schedule, mapping, or function was activated. | D2-011, D2-016 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-03 | Correctly published and independently read back the complete D2 artifact from the versioned artifact bucket, then completed the interrupted full-dark deployment. State `254` contains two healthy immutable worker aliases, an encrypted Trust queue/DLQ, least-privilege IAM, and thirteen D2 alarms. Both functions report `RuntimeEnabled=false`; read-only verification finds one policy GET, zero D2 mutation/private/Trust routes, zero schedule targets, and zero enabled mappings. The post-apply plan is zero drift. | D2-014, D2-016 | Source `336c83c`; artifact SHA-256 `6f05a38d182f9c48d1bfada6d2297fc9eac6ef11e4c1ab9c882b8aa22ec44449`; zero-drift plan SHA-256 `8620153d493fcb7440fa0b5ca7ca11d08e810c982949bc8d346dbeadb0a12884`; [default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-03 | The activation preflight found that the selected public Greenhouse board has 213 jobs and a roughly 4.7 MB board response, exceeding the deliberately fixed one-megabyte adapter limit. Added an optional exact-job adapter operation and made independent contribution verification prefer it; scheduled ingestion remains on the bounded board operation. Generated tests prove exact-path selection, ID/path enforcement, redirect refusal, and unchanged byte/time bounds. A live aggregate-only preflight of the exact endpoint returned `200`, 22,462 bytes, and matching ID/canonical URL without retaining response content. | D2-006, D2-011, D2-016 | Ingestion 110 tests and typecheck; Workflows 95 tests; response digest retained only in the private operator session |
| 2026-09-03 | Published the deterministic exact-job verification artifact to the separate versioned artifact bucket and advanced only the two dark D2 functions and aliases. Development state `255` references artifact SHA-256 `366ef19475b53dcfff82616ae94348631662be7f2b068681ebdd898bec132342`; post-apply verification still finds `RuntimeEnabled=false`, one policy GET, zero mutation routes, zero schedule targets, and zero enabled mappings. | D2-006, D2-014, D2-016 | Source `32634c2`; reviewed release-plan SHA-256 `d1c9a6ad278b0a5d9b9aed273eb907005cb98166edead4d30d71a7123439e09a`; private publication receipt independently read back |
| 2026-09-03 | Re-ran the complete repository gate after the state-`255` dark deployment: all 34 tasks passed, including all 95 workflow tests, and the worktree remained clean. Activation preflight confirmed that the existing candidate-rights Auth0 M2M credential is intentionally limited to `delete:users` and tagged generated-synthetic-only. It was not repurposed as a D2 Trust case-opener identity. Development contribution remains fail closed until a dedicated accountable workflow identity and the D2-011 authorized-fixture reviews are supplied. | D2-010, D2-011, D2-016 | `pnpm check`; AWS/Auth0 aggregate-only credential inspection retained no token or secret |
| 2026-09-03 | Received the dedicated D2 workflow Auth0 client ID and derived its exact tenant-bound machine subject plus deterministic reviewer ID in ignored activation inputs. The assignment contains only `case_opener`, stores no client secret, and does not grant human decision roles. The client grant cannot be independently read with the existing least-privilege Management API credential, so its exact `trust:review trust:case:open` grant remains an operator confirmation. The signed policy and AWS runtime remain dark pending that confirmation and both fixture-review acceptances. | D2-010, D2-011, D2-016, D2-022 | Ignored activation-input SHA-256 `87aec64892c5f1443e927b8bc90cc71d9a4274ab2515a5051ca6de56ccd7d063`; no secret retained |
| 2026-09-03 | The product owner confirmed the dedicated workflow client's exact `trust:review trust:case:open` grant, accepted the Greenhouse fixture sanitization, and separately accepted its `greenhouse-board-v1` representativeness. Promoted only the 905-byte inert sanitized page and opaque manifest into the fixture tree; Gitleaks `8.30.1`, Presidio Analyzer `2.2.364`, the fail-closed repository validator, and the fixture-consuming extension regression pass. No raw page, live URL, employer/job value, candidate data, Auth0 secret, or reviewer identity entered Git. This closes the Greenhouse portion of D2-011 and the workflow-identity input, but it does not convert pending LR-D2-01 or accountable security/privacy review into approval. | D2-002, D2-010, D2-011, D2-016, D2-022 | Fixture payload SHA-256 `1b435c664dc4f49cf1820050797ba9e501cb2cd3941f80ec87ec1a71925c7154`; fixture validator 11/11; extension regression 4/4 |
| 2026-09-03 | Activated only client `0.2.0` and accepted Greenhouse contribution in development under the product owner's exact controlled-exception confirmation; production, store distribution, Lever, Ashby, and human Trust decisions remain dark. The 24-hour Ed25519 policy expires `2026-09-04T18:24:32.188Z`. Exact activation plan SHA-256 `c3f5655e5df7d062bb740ed172b9f9e15c6c50c3f69dec6244b0900fd140554d` added 21 and updated 9 resources with no destruction. Its first batch exposed missing deployed D2 tables, so deterministic zero-High/zero-Critical migration image `sha256:963f0c945d6aa4fbc9b8b3241565a644fb114ea05a044ac2bfae6c82607a1ff8` was applied by task revision `47`, exit `0`, through all 39 migrations/68 relations. Automatic invocation then exposed an invalid generated-envelope assumption. Exact source `9a8fb5f`, reproducible artifact SHA-256 `4d2ba1078e570641efa0fec07ca473ce8c521f7471186e75ae10e6963c4291aa`, and saved plan SHA-256 `35ba4d7e746eea787b1acfd0b769ee4d2b9abfada774174dc26d5ba693fa5d94` replaced it with a strict versioned rule-bound command at state `260`. Manual and real scheduled batches both succeeded with zero work; both Trust queues are empty, 13/13 alarms are `OK`, ECS is idle, post-apply zero drift passes, and the complete repository gate passes all 34 tasks. | D2-005, D2-006, D2-008, D2-010, D2-014, D2-016, D2-017, D2-019, D2-021, D2-022 | Commit `9a8fb5f`; policy envelope SHA-256 `ffb2f0d5188d5962cba3159a64130671e15a0ef6de0f6d48a854cb765722124f`; zero-drift SHA-256 `7aa3e226a7734000f70c62c413cdc033914a0ef2f8765ed4205591eebdb86661` |
| 2026-09-04 | Investigated an installed extension retaining one contribution as pending. The bundle and Gateway use the same policy revision. Aggregate AWS evidence showed five handled API `5xx` responses, no API `4xx`, no contribution processing, empty Trust queues, healthy scheduled batches, and 13/13 alarms `OK`. The immutable migration task revision `47` was rerun without overrides and exited `0`, verifying Profile through `0009`, Jobs through `0019`, and all 39 service-owned migrations. A separate local PostgreSQL consent integration passed 2/2. The client investigation exposed that the visible `Retry now` action still honored the two-hour automatic backoff; after reload the already exhausted item correctly appeared stopped and made no new API request. Manual pending retry now bypasses only the time gate, while a separate confirmed `Retry stopped` action restarts terminal delivery with the original selected fields and idempotency keys. The queue retains only fixed privacy-safe failure classifications from server problem responses; arbitrary details and trace identifiers are discarded. Account, expiry, blocked-identity, and terminal-state fences remain enforced. The current item is intentionally retained and still requires reload plus explicit stopped retry; no successful deployed contribution is claimed yet. | D2-005, D2-015, D2-016, D2-017 | Extension 75/75 tests, typecheck, configured build; migration task `55b7712752a84f768b57cf87b67d29fe`, exit `0` |
| 2026-09-04 | The installed retry reached the protected contribution route but returned the fixed `job_contribution_unavailable` classification, leaving one retryable and one stopped local item. Fresh API metrics recorded two `5xx` and zero `4xx`. A bounded aggregate-only database probe found one recent granted consent and zero contribution, intake-outbox, or processing-queue rows; separate privilege checks passed for every intake relation. A generated-synthetic transaction then exercised the exact deployed store, outbox, and queue inserts and rolled the transaction back intentionally, proving the generic live persistence path without retaining a row. The remaining failure is request-specific before commit. Added strict server-only diagnostic categories for capability, consent, response, and allowlisted PostgreSQL constraint classes, plus privacy-safe logging for handled server errors; neither public problem responses nor extension storage receives database detail. Local Jobs and Gateway tests/typechecks and targeted formatting/lint pass. Diagnostic Gateway deployment and one retained-item retry remain before the exact request category and corrective change can be closed. | D2-005, D2-015, D2-016, D2-017 | Aggregate probes retained no URL, identity, payload, token, or provider response; synthetic intake transaction reported `accepted_and_rolled_back` with `persistentMutation=false` |
| 2026-09-04 | The diagnostic Gateway publication correctly stopped before upload because the dependency registry omitted both still-applicable `image-size@1.2.1` advisory records, making the exact exception check stale. Hardened the centralized gate to independently inspect the installed dependency graph when—and only when—the registry omits a known record. Both exceptions now pass only while every affected instance remains rooted in the exact mobile workspace through Expo and ends at `metro>image-size@1.2.1`; any new advisory, changed returned record, root, path, version, package removal, or expiry still fails. The full audit passed with both registry omissions independently verified. No AWS resource or runtime changed during this gate repair. | D2-009, D2-016 | [Exact expiring exception register](../../security/dependency-vulnerability-exceptions.md) |
| 2026-09-04 | Added and exercised a non-mutating current-state Gateway baseline capture after Phase 2 legitimately advanced the shared Terraform state beyond the latest document-migration handoff. The action regenerated all 101 exact inputs from the reviewed state-260 zero-drift seed, required a fresh refresh-backed zero-change result, and bound the current source/state to the one verified document receipt whose immutable parser/processor objects matched the plan. The subsequent Gateway plan contained exactly two in-place updates and zero replacements or output changes. Exact source `844cae9` was published, independently read back, applied, and verified; the immutable alias, direct health/auth/input matrix, and final zero drift pass. Privacy-safe contribution diagnostics are now deployed. One retained extension retry is required to reveal the exact request-specific server category; no contribution success is claimed yet. | D2-005, D2-015, D2-016, D2-017 | Baseline SHA-256 `0e398d3c4359eb944fd67cbaab95b310293c358e6e7bdff06fbe133074569eef`; release-plan SHA-256 `ed83944933e61c12e3ef237fab8f345b379d53771ca3975a51648fee2d87873b`; verification-plan SHA-256 `7f72ce0ab42f468f2c3ecd9bac97d40f1801a47a4d383277f5884b682b57731c` |
| 2026-09-04 | The next operator-confirmed retry produced no recent API request and a read-only aggregate database probe found zero contribution, intake-outbox, or processing-queue rows, so it cannot be treated as a server intake attempt. The live signed Greenhouse policy independently fetched and verified against the exact key embedded in the configured bundle. Source review found the remaining ambiguity in the extension: authentication and policy deferrals left an item pending without recording the gate, an older terminal error could mask the pending item's current error, and account-fenced items were presented as retryable stopped items even though they must never cross identities. The queue now records those local gates without consuming attempts, prioritizes the pending error, and separates account-held from terminal counts and actions. The configured extension rebuild passes 76/76 tests and typecheck. Installed reload and one explicit journey remain before any deployed contribution success is claimed. | D2-005, D2-015, D2-016, D2-017 | Aggregate probe profile `d2_contribution_aggregate_v1` returned zero at every intake stage with `readOnly=true`; live policy revision `d2-development-greenhouse-20260903-v1` verified through `2026-09-04T18:24:32.188Z` |
| 2026-09-04 | Closed automated browser geometry and axe coverage with a repeatable two-browser matrix. Fresh Microsoft Edge 152 and Google Chrome for Testing 151 profiles each loaded the exact configured MV3 bundle, exercised three synthetic provider pages, three popup states, one side-panel state, 320/360/480-pixel layouts and 200% reflow, keyboard focus, semantics, long/missing values, source/queue/history disclosures, and delivery gating. Both passed with zero axe WCAG 2.0/2.1 A/AA violations across popup and side panel, zero overflow/overlap/clipping, zero unexpected external or telemetry requests, and zero retained sensitive synthetic artifacts. Every external request was aborted; expected configured signed-policy fetches were counted separately from unexpected traffic. Branded Chrome 152 correctly rejected command-line extension loading under Chrome's current security policy, so the automated target is the official Chrome for Testing binary and the already installed branded browser remains the manual auth/lifecycle target. Human assistive-technology acceptance remains open. | D2-009, D2-015, D2-023 | Aggregate profile `d2_extension_installed_browser_matrix_v1`; 2/2 browsers passed; [browser assurance](../../../scripts/tests/d2-extension-assurance/README.md) |
| 2026-09-04 | Added the source support surface required before a store candidate can be truthful. The static `/extension-support` route explains pending, stopped, and account-held delivery states; safe retry; accepted-contribution refresh, withdrawal, and appeal; candidate export/deletion; and the no-secrets troubleshooting boundary. It explicitly says the candidate is development-only and that no monitored public support channel exists, so source implementation cannot be mistaken for hosted or operational acceptance. All 540 web tests, typecheck, production build, local desktop/mobile rendering, keyboard focus, zero horizontal overflow, and zero axe WCAG 2.0/2.1 A/AA violations pass. | D2-009, D2-013, D2-015 | [Support disclosure](../../../frontend/extension/store/support-and-removal.md); source route `/extension-support` |
| 2026-09-04 | Published exact candidate source `8140b54` to the authorized non-Zach Vercel candidate project after source validation, preflight, and a dry run. The newly created production deployment is `Ready`, and the stable alias resolves to that same deployment. `https://ai-job-apply-candidate.vercel.app/extension-support` returns HTTP `200`, contains the expected support heading, and sends HSTS, `nosniff`, frame denial, `no-referrer`, same-origin opener isolation, CSP, and `X-Robots-Tag: noindex`. No deployment-protection claim is made. This closes hosted-route acceptance only; no monitored public support channel or store approval is claimed. | D2-009, D2-013, D2-015 | [Hosted support route](https://ai-job-apply-candidate.vercel.app/extension-support); commit `8140b54` |
| 2026-09-04 | Added an original transparent candidate icon set at the Manifest V3 sizes 16, 32, 48, and 128 pixels and mapped the same assets to the extension and toolbar action. The Chrome package icon preserves the specified transparent safe area. The same mark anchors a text-free 440-by-280-pixel small promotional tile and transparent 300-by-300-pixel Edge listing logo. The release policy permits exactly ten flat files and digest-pins all four package icons; packaging rejects absent/mismatched mappings, invalid PNG signatures, wrong dimensions, and unreviewed bytes. A separate store-asset guard validates every PNG chunk checksum, rejects text/EXIF metadata and trailing data, and enforces the two exact listing assets. All 81 extension tests, typecheck, configured build, and two default-dark packages pass; the packages are byte-identical with archive SHA-256 `b0314f3e712c55b37ac07d5f590c9dd3be95d39b55463bae17481502fa6bd9d8`. Exact installed screenshots, product-owner acceptance, and store approval remain open. | D2-009, D2-015 | [Candidate asset provenance](../../../frontend/extension/store/README.md#candidate-icon-provenance) |
| 2026-09-04 | Replaced the six-line D2 recovery placeholder with deterministic fail-closed rollback and alarm prerequisite planning. Rollback requires distinct reviewed artifact, source, and publication-receipt digests plus explicit verification of both exact object versions; alarm planning accepts only the exact development D2 ARN shape, reviewed threshold, and confirmed recipient count while retaining only the ARN digest. Source guards reject equal artifacts, unverified object versions, and absent recipients. The first live apply safely failed before changing either alias because an older duplicate-artifact receipt referred to a superseded bucket version; its `finally` path restored both paused triggers. The independently published prior artifact in the current versioned bucket then verified. Exact four-update/no-delete rollback plan SHA-256 `36068fe0dd0688b809d9524c8740c9dc786fcba9d85974bdd3ff04e296a18b24` moved both paused runtimes from current artifact `4d2ba10` to prior artifact `6f05a38`; both aliases verified that immutable digest. Separate restoration plan SHA-256 `56d10a97ebe4b4bb4fe2f169039b348f0dfd9d8275e6ad998bf0c673a13d5111` restored the current artifact and both triggers. State `265` now uses alias version `6` for both runtimes, both Trust queues are empty, 13/13 alarms are `OK`, emergency alias restoration was not used, and final zero-drift plan SHA-256 is `7d28a92ffd27ca5f74a60e8863b854fe01328820791132218e608ffc05cd87d1`. The refreshed prerequisite plan SHA-256 is `2cba25b774f05c5f4388ec17cab8ddd06ff5b929b8745b7798c962aa0f87f1a5`; alarm plan SHA-256 remains `109576b00453ad6331e4cb0019eeb431b530956cfaceef63748dffe96da6f3fd`, but no alarm injection or recipient acceptance is claimed. | D2-016 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-04 | Completed the current deployed PostgreSQL recovery exercise after extending the exact Terraform-input allowlist for the active `d2_community_runtime` variable and refreshing the stale D1 runbook inventory. A read-only source verifier established the exact six-owner/ten-schema/68-relation/39-migration boundary. One private encrypted disposable latest-point-in-time copy became available in 1,825 seconds; the same immutable verifier produced one aggregate event, zero forbidden-log matches, and an exact source/target digest match. Functional recovery completed in 1,948 seconds. Guarded cleanup removed the authenticated target without a final snapshot and left zero restore targets, snapshots, target automated backups, or local context. A separate final status check found the deletion-protected primary available with 35-day retention and a current restore point, ECS idle, all 44 managed alarms healthy, and Terraform at zero drift. This is bounded development structural/aggregate evidence, not row-value inspection, capacity evidence, or a production RTO/RPO commitment. | D2-016, D2-020 | [Development PostgreSQL restore runbook](../../../infrastructure/runbooks/restore/development-postgresql-point-in-time.md) |
| 2026-09-04 | Added and ran a fail-closed deployed public-boundary workload. The fixed profile paces 20 signed-policy reads below the intentionally shared one-request-per-second public edge budget, validates every bounded no-store contract response, and separately bursts 20 unauthenticated contribution attempts that may return only `401` or managed `429`. The live run passed 20/20 policy reads and 20/20 authorization denials with zero throttled, unexpected, or server responses; policy latency was p50 69 ms, p95 134 ms, max 389 ms, and denial latency was p50 60 ms, p95 285 ms, max 296 ms. Exact two-minute AWS corroboration found 40 API requests, 20 expected 4xx, zero 5xx, 20 Gateway invocations, zero Lambda error/throttle, empty D2 Trust queues, zero error or forbidden-log matches, zero ECS tasks/services, all 16 exact Gateway-plus-D2 alarms healthy, and zero Terraform drift. This closes the public-policy and unauthenticated-abuse slice only; it is not authenticated contribution/processing representative acceptance. | D2-014, D2-016, D2-021 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-04 | Implemented the dedicated D2 alert-delivery exercise that binds the current Terraform-owned `TrustSignalFailed` alarm, reviewed zero threshold, exact operational-alert topic, confirmed-recipient-set digest, and deterministic recovery plan before permitting mutation. It emits only one generated-synthetic breach plus zero-value recovery, waits for a real `OK → ALARM → OK` transition, verifies all thirteen D2 alarms recover, and requires direct human receipt confirmation; source guards reject alarm-state forcing or application, queue, database, and Terraform mutation. Local operator tests pass. A read-only deployed status preflight found one confirmed recipient, zero pending recipients, 13/13 D2 alarms healthy, and the exact target `OK`. The actual exercise remains deferred to the final alert gate; no notification or metric was sent. | D2-016 | [Default-dark runbook](../../operations/d2-community-default-dark-runbook.md) |
| 2026-09-04 | Closed the missing executable source coverage around the actual extension Auth0 protocol. Eight deterministic tests now exercise exact authorization request shape and callback state, PKCE token exchange, user cancellation before token exchange, refresh-token rotation while preserving the account fence, replay/revocation rejection without replacing the last valid session, automatic near-expiry refresh, provider logout/revocation, and unconditional local credential clearing when revocation fails. The complete extension suite passes 89/89 with typecheck and a configured build. These tests use only generated placeholders and do not touch the tenant or installed session; the corresponding branded-browser live matrix remains open. | D2-012, D2-015 | [Extension protocol](../../../frontend/extension/lib/protocol.ts) |
| 2026-09-04 | Replaced the installed extension's ambiguous Auth0 error fallback for known safe cases. Cancellation, callback/state rejection, token-exchange rejection, missing grants, invalid token responses, refresh failure, and revocation failure now provide fixed actionable guidance without projecting provider bodies, tokens, identities, or unknown exception text; all unrecognized failures retain the generic non-disclosing response. The configured extension rebuilt successfully and its complete typecheck plus 98/98 tests pass. Chrome reload and the live lifecycle remain before acceptance. | D2-001, D2-012, D2-015, D2-023 | [Action-error projection](../../../frontend/extension/lib/action-error.ts) |
| 2026-09-04 | A fresh complete extension-assurance run caught stale release-source integration: the harness still allowed the pre-icon six-file output and rejected the reviewed four-size icon set. The independent guard now requires the exact manifest and toolbar icon mapping, all ten release files, and the complete forbidden-permission inventory. Source assurance passes ten exact files with six minimum permissions, two configured non-provider hosts, zero provider hosts/content scripts, and the default-dark marker. The subsequent Edge 152 and Chrome for Testing 151 matrix again passed 2/2 with zero axe violations, geometry failures, unexpected external/telemetry requests, or retained sensitive artifacts. | D2-004, D2-009, D2-015, D2-023 | [Browser assurance](../../../scripts/tests/d2-extension-assurance/README.md) |
| 2026-09-04 | Rebuilt the default-dark archive twice after the Auth0 guidance and release-source corrections. Both independent packaging runs produced the same exact ten-file archive SHA-256 `efffbe2b2cad25c72e70db365049e5568334ad591aa52f904053f5ba72d805c3`; the two listing assets independently validate as two metadata-free bounded PNGs totaling 170,490 bytes, and all nine focused package/asset guard cases pass. Generated archives remain ignored and no store upload or approval is claimed. | D2-009, D2-015 | [Store release materials](../../../frontend/extension/store/README.md) |
| 2026-09-04 | Re-ran the complete repository gate after the Auth0 guidance, alert operator, browser-assurance, and release-candidate changes. Skills and infrastructure guards, formatting, lint, typecheck, and the complete unit-test graph pass; the final test stage completed 34/34 tasks, including all 98 extension tests, 163 Gateway tests, 540 web tests, and 95 workflow tests. This is a clean source checkpoint only: it does not replace the installed authenticated contribution/lifecycle journey, authenticated processing load/abuse, human assistive-technology review, accountable acceptance, store review, or the deliberately last alert-delivery exercise. | D2-009, D2-012, D2-015, D2-016 | `pnpm check` |
| 2026-09-04 | Reviewed the product-owner-supplied installed extension state without retaining page or account data. Delivery readiness passed, but the queue showed one current-account pending item, zero terminally stopped items, and two account-held items that remain correctly fenced from the current identity; no contribution receipt was present. The pending delivery reached AWS once and aggregate logs classified the pre-commit failure as `JOB_STORE_WRITE`. This confirms that authentication, signed policy, explicit command, route authorization, and request dispatch passed while database intake did not. No success is claimed. | D2-005, D2-015, D2-016, D2-017 | Aggregate profile `d2_recent_contribution_failure_categories_v1`; one `JobContributionUnavailableError` / `JOB_STORE_WRITE` failure |
| 2026-09-04 | Replaced the remaining generic database-write diagnostic with fixed server-only connection, data, database, resource, runtime, schema, and transaction categories plus a strict allowlist for PostgreSQL SQLSTATE telemetry. Public problem responses and extension storage remain non-disclosing; arbitrary five-character values, messages, URLs, identities, payloads, and trace data are rejected. Jobs 141/141 and Gateway 163/163 tests plus both typechecks pass. The Gateway release initially encountered only AWS-refreshed `last_modified` on the exact D2 Trust event-source mapping; the shared zero-drift guard now normalizes that one forward-moving timestamp only when every planned source value and sensitivity boundary remains exact, with regressions for backward or wider drift. Source `7ca3ee0` was published and applied through an exact two-update/no-replacement plan. State advanced once to `266`; the immutable alias, direct boundary, and two independent refresh-backed zero-drift plans pass. One installed **Retry now** action is required to obtain the refined category or a successful receipt. | D2-005, D2-015, D2-016, D2-017 | Commits `6551f22`, `7ca3ee0`; publication receipt SHA-256 `fe9c74873bbe468bae330dbeeafc7e1ea4c36646df34afa93c870178fc808feb`; release-plan SHA-256 `c176abe50187d9a38d12df3088508258d19fe3ccabb5446ff6d6c0fd41e0aa5f`; verification-plan SHA-256 `afe5b5d3455e67d0430e28b2e6182cafc157b252e0bb4d46397b06324cd0614e` |
| 2026-09-04 | The subsequent complete repository gate exposed a cross-runtime-only defect in the new drift guard: PowerShell 7.5 converted exact ISO strings to date objects during an internal JSON clone, while Windows PowerShell retained strings. The shared clone boundary now requests string-preserving JSON dates when supported and retains the compatible fallback otherwise. The strict exact-address, source-value, forward-time, and sensitivity checks are unchanged. The guard passes independently on PowerShell 7 and Windows PowerShell; all adjacent Gateway guard/operator tests pass; and the complete repository gate passes every infrastructure check, formatting, lint, all 33 typecheck/build tasks, and all 34 unit-test tasks. No AWS resource or deployed artifact changed. | D2-016 | `pnpm check`; document guard and Gateway release suites |
| 2026-09-04 | The installed queue then showed one current-account pending item, zero stopped items, and two correctly fenced account-held items with **Policy service unavailable**. Two clean policy reads returned `503`; aggregate application telemetry reported only signed-policy source unavailability and no contribution-route failure. The previous policy had expired before the retry, so the extension correctly retained the item locally without consuming an attempt. Signed and independently verified 24-hour revision `d2-development-greenhouse-20260904-v2` preserves the exact one-client/one-provider/one-variant/two-domain Greenhouse exception while production, store, Lever, Ashby, and human decisions remain dark. Checksum-bound plan `77dbc357ba28586dd557e0a783339682805eec6fcc0d0a52b642ef5db3f7c627` changed only the scheduled/Gateway policy-bearing functions and aliases in place: zero added, four changed, zero destroyed, no output change, and state advanced exactly once from `266` to `267`. Refresh-backed plan `1f2d3166caced7d393d8b84a57b96c5adbdd57320dab4a08cebc2b1dd85bc3a5` has zero meaningful resource/output changes and only accepted provider-clock drift. The public endpoint then returned the exact envelope twice with HTTP `200` and `no-store`; a fresh disposable Edge profile loaded the configured bundle, fetched it once, and cached the exact current enabled policy. No contribution success is claimed until the retained item is explicitly retried. | D2-005, D2-014, D2-015, D2-016, D2-021 | Policy envelope SHA-256 `f457c0f3afc1fa872a8c4084533164193fbf4b46233dbb32eafd6dfae11e958f`; digest-input SHA-256 `3ca9d5916b95da5cbfda22d649f3a1680f0a0e347847fb407540bbb4db704645`; aggregate browser profile `d2_configured_extension_live_policy_v1` |
| 2026-09-04 | The operator-confirmed retry converted the former pending item to account-held, producing zero pending, zero stopped, and three held items. A twelve-minute exact-route metric window and aggregate application query both reported zero contribution requests and zero unhandled contribution failures. Source inspection confirms the fence is deliberately bound to one full local sign-in: it is random at authorization-code exchange and preserved across token refresh, but a later full reauthentication receives a different fence even when the same provider account is selected. The extension therefore blocked this prior-session item before transmission and did not expose or compare token claims. The next deployed journey must create a fresh preview and explicit public-add intent under the current signed-in session; the three held items remain untouched and cannot cross sessions. No contribution success is claimed. | D2-005, D2-012, D2-015, D2-017 | Aggregate profile `d2_post_retry_aggregate_v1`: zero exact-route requests and zero server failures |
| 2026-09-04 | A fresh preview and explicit public-add intent under the current signed-in session passed local identity, signed-policy, capability, authorization-receipt, and dispatch gates, then remained as one pending item alongside the three correctly account-held items. Aggregate server telemetry recorded exactly one pre-commit `JobContributionUnavailableError` / `JOB_STORE_RUNTIME` failure and no PostgreSQL category; no request body, posting value, identity, token, or raw log was inspected or retained. This narrows the unresolved defect to a JavaScript runtime failure inside the Jobs contribution store but does not yet establish the exact persistence stage or a successful contribution. | D2-005, D2-015, D2-016, D2-017 | Aggregate profile `d2_fresh_intent_failure_categories_v1`; one fixed-category failure |
| 2026-09-04 | Added fixed, privacy-safe contribution-store stage diagnostics for payload preparation, transaction start, locking, replay reads, identity reads, contribution insert, outbox, processing queue, and result mapping. A stage wrapper preserves existing allowlisted PostgreSQL categories while replacing only generic runtime/write classifications; public responses remain generic and Gateway telemetry may unwrap only the fixed stage type and allowlisted SQLSTATE. Focused Jobs 20/20 and Gateway 47/47 tests, both package typechecks, formatting, and the complete repository gate pass. Source `21befbe` was published reproducibly and independently verified, then an exact two-update/no-replacement plan moved only the Gateway function and unweighted alias to version `46`; state advanced once from `267` to `268`, the direct boundary passed, and the refresh-backed verification plan is zero drift. An eight-minute post-release window contained zero contribution-route requests and zero failures, so the retained current-session item still requires one explicit **Retry now** click to obtain the exact stage or succeed. | D2-005, D2-015, D2-016, D2-017 | Baseline SHA-256 `0ae27aebecce02e1b9b2133d796edc6818bf0abde48b240698336a276233e1c5`; publication receipt SHA-256 `41af0203b948e654c6eecf94e770e80bafc7cd102f7561a2057dfc2376c88f83`; release-plan SHA-256 `ee4e36f0c96b078ef5b3585bd00c59af2d7e6056bda1d26f72e5fdf2a45c9c75`; verification-plan SHA-256 `befc3428205c0de2681eceaab52dcca137994f95b58851bf60dff4592f309e85`; aggregate profile `d2_post_diagnostic_deploy_aggregate_v1` |
| 2026-09-04 | The explicit post-release retry produced zero contribution-route requests and zero server failures, and moved the fourth intent to account-held before transmission. Root cause was the extension's per-login random fence: a full Auth0 login generated a different value even when the same provider account returned, contradicting the intended account—not browser-login-session—boundary. The fence is now a versioned SHA-256 digest of the exact Auth0 issuer, API audience, Native Application ID, and bounded access-token subject. Same-account full login reproduces it; a different subject, issuer, audience, authorized party, expired/malformed token, or account-changing refresh fails closed, and raw subjects are not stored. Legacy random-fence sessions are removed once; their already-held items remain quarantined and expire normally because they cannot be safely attributed retroactively. Extension typecheck, all 111 tests, configured build, exact ten-file release-source assurance, and the complete repository gate pass. One installed reload, sign-in, and fresh explicit public-add journey remain before the server persistence stage can be exercised. | D2-001, D2-005, D2-012, D2-015, D2-017 | Aggregate profile `d2_account_fence_retry_aggregate_v1`: zero exact-route requests and zero server failures; `pnpm check`; [account-fence implementation](../../../frontend/extension/lib/account-fence.ts) |
| 2026-09-04 | A fresh same-account intent passed the corrected account fence and reached the deployed contribution store twice, where aggregate-only diagnostics fixed both failures at `JOB_STORE_INSERT` without a PostgreSQL SQLSTATE. The Jobs store now serializes the validated payload once, hashes those exact bytes, and binds them through an explicit text-to-`jsonb` boundary; the identifier-only outbox uses the same driver-independent boundary. A clean disposable PostgreSQL 16.6 database applied Profile through `0009` and Jobs through `0019`, then passed the transactional contribution test for exact payload persistence, replay, owner isolation, outbox, and processing queue. The complete repository gate passed. Exact source `d8490a4` was deterministically published and deployed at state `269` on unweighted Gateway alias `47`; the reviewed plan contained only the function and alias updates, direct boundary verification passed, and final Terraform drift is zero. The retained stable-fence item has not made a post-release attempt yet, so deployed contribution success and downstream lifecycle acceptance are not claimed. | D2-005, D2-006, D2-015, D2-016, D2-019 | Commit `d8490a4`; baseline SHA-256 `e9beb75f39bee65d3232236b54d13a64821d7157a51f8cb2f3db008c50fca57d`; receipt SHA-256 `e83a5f9cd57f1fc707e0e57340f67adfb25b0fd863769870eee2951767cbdc14`; release-plan SHA-256 `b691184460202f0fc08ec99022d0f586bb0a65ec5ee50e1b20345547230a33c1`; verification-plan SHA-256 `5987e1437527207bc733159a70c910b495f748a4831b5b62747358189c6587a8` |
| 2026-09-04 | The single retry against alias `47` again failed pre-commit at `JOB_STORE_INSERT` without a PostgreSQL SQLSTATE; the item remained pending and no posting or identity data was inspected. Added an exact-route, exact-error-type diagnostic that emits only allowlisted driver/runtime codes and fixed built-in error types when no SQLSTATE exists. Known PostgreSQL telemetry is unchanged, arbitrary codes and types remain absent, and messages, stacks, payloads, identities, URLs, and tokens cannot enter the record. The focused Gateway suite passed 47/47, the complete Gateway suite passed 163/163, and the repository gate passed all infrastructure checks, 33 type/build tasks, and 34 test tasks. Source `77d73df` was reproducibly published and deployed through an exact two-update/no-replacement plan at state `270` on unweighted alias `48`; direct boundary verification passed and the final refresh-backed plan is zero drift. One controlled retry remains necessary to obtain the fixed category or a successful receipt; no deployed contribution success is claimed yet. | D2-005, D2-015, D2-016, D2-019 | Commit `77d73df`; baseline SHA-256 `1923c0b7eb74e1eded760f8125c8194b4a803ccfadc147df47e16e959a9a5578`; receipt SHA-256 `cbf1b5226877050c5cc13a58572ab60b9eeaf3ae6dd5492fd1cdb8d9b98eed04`; release-plan SHA-256 `6b0de6f66132e6290bc2697649ba58fcb1e100ec17f9a41c47aa81fea2c5465b`; verification-plan SHA-256 `4b5e86a2ae141bc4c7447ea29efd6c82bd34c0881420a88464f3caf21ba62b42` |
| 2026-09-05 | The installed queue reports one pending, zero stopped, and two account-held items with `Contribution service unavailable` after the stopped-item restart. Source inspection shows this fixed message comes from a server problem response; it does not establish a local policy or authentication hold. Corrected the previous interpretation of empty telemetry: the log query checked only nested fields despite root-level Gateway logging, and a nonexistent route-metric series was treated as zero traffic. Neither supports a non-transmission claim, and a zero-work processing batch cannot establish whether intake was attempted. Prepared an aggregate query using both root and nested fields. Read-only caller validation found the development AWS SSO session unavailable, so live diagnostic classification and remediation remain blocked on session renewal. No additional queued-item retry, deployment, or speculative persistence change was performed. | D2-005, D2-015, D2-016, D2-019 | [Gateway failure projection](../../../backend/gateway/src/app.module.ts), [extension response classification](../../../frontend/extension/lib/job-intent-api.ts), [logger](../../../packages/observability/src/index.ts); installed aggregate counters only |
| 2026-07-28 | Assigned UGC and extension delta approval to D2 without starting implementation. | D2-010 | [Legal review register](../foundation/legal-review-register.md), [security/privacy plan](../../security/security-privacy-approval-plan.md) |
| 2026-08-12 | Accepted ownership of authorized representative job-page fixtures from D0; this assignment does not start D2 or approve any provider source. | D2-002, D2-011 | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), [fixture policy](../foundation/ats-fixture-policy.md) |
| 2026-09-05 | AWS SSO renewal unblocked the corrected aggregate query, which identified three intake failures at `JOB_STORE_INSERT` with fixed cause `TypeError` / `ERR_INVALID_ARG_TYPE`. Source inspection identified the exact composition mismatch: the Gateway's Profile database factory initializes Drizzle on the shared PostgreSQL client, replacing timestamp serializers with pass-through functions; the contribution store supplied JavaScript `Date` objects. Extended real-PostgreSQL integration to cover both plain and Drizzle-initialized clients. The latter reproduced the exact error before the fix. Binding one ISO timestamp across intake, outbox, and queue makes both cases pass, including exact payload/event objects, one queue entry, identical timestamps, replay, latest-state reads, and owner isolation. The disposable synthetic PostgreSQL database was removed and Docker/WSL stopped. No production identity, posting, token, or raw server error was retained. Development release and installed success remain pending. | D2-005, D2-006, D2-015, D2-016, D2-019 | [Timestamp binding](../../../backend/services/jobs/src/persistence/contribution.ts), [two-client transactional regression](../../../backend/services/jobs/src/persistence/contribution.integration.test.ts), [Gateway database composition](../../../backend/services/profile/src/index.ts); PostgreSQL 16.6 with Profile `0009` and Jobs `0019`, 2/2 tests passed |
| 2026-09-05 | The shared-client timestamp fix passed `pnpm check` (34/34 test tasks, including Gateway 163/163 and Jobs 142/142), changed-file checks, and the two-client PostgreSQL regression. Exact merged source `ff3689c40f757ee2c85f6159b69135c544fc63eb` was reproducibly published, independently read-back verified, and deployed using an inspected saved plan containing only two in-place Gateway function/alias updates. Apply verification passed immutable unweighted alias `49`, direct API boundaries, and zero Terraform drift at state `271`. The anonymous policy endpoint returns HTTP `200`, `no-store`, and the unchanged Greenhouse-only revision/expiry; no identity, provider, schema, worker, or production/store boundary changed. No extension rebuild or sign-out is needed. The next installed step is retrying the existing eligible item (`Retry now`, or `Retry stopped` if stopped), leaving account-held items untouched. Installed intake success and downstream lifecycle acceptance remain open. | D2-005, D2-006, D2-015, D2-016, D2-019 | Source `ff3689c`; baseline SHA-256 `16559f268d13ffb3ae316ad6311c332cfd5cca2536ba3c94903f008118c363c8`; receipt SHA-256 `bea8c97ad7b96d996877c3fd4184d74dc6ecb53eca2cdeab3337ec47adb53ee2`; release-plan SHA-256 `7bc1b1f4d4d3ee87af6623ecd9f41ad4de130785f78380485450b1a00db0af1a`; verification-plan SHA-256 `f6567e9a3107e803595d4691127f9d8043d8f46963e0eefeb2142e1a9fcb3a1f` |
| 2026-09-05 | The installed follow-up shows zero pending, zero stopped, and two account-held items; the remaining warning describes the held items only. No held-item removal, retry, identity change, or additional deployment was performed. Both root/nested aggregate log layouts were inspected after verifying development AWS identity. No contribution-store failure was logged in the post-release window; 19 successful scheduled batches spanning release/follow-up report zero contributions claimed, completed, parked, retried, dead, or delivery-published. This is not acceptance evidence: client source removes an intent after acknowledged delivery but also removes expired intents. Requested only whether `Your shared jobs` contains a receipt and its refreshed Processing state, excluding contribution IDs and posting details. Intake acknowledgement and downstream lifecycle remain open. | D2-005, D2-015, D2-016, D2-019 | [Queue expiry and settlement](../../../frontend/extension/lib/pending-queue.ts), [receipt persistence](../../../frontend/extension/entrypoints/background.ts), [aggregate scheduled metrics](../../../backend/workflows/src/d2-community-lambda.ts); screenshot aggregate counters only |
| 2026-09-05 | The owner-refreshed installed receipt confirms one saved contribution in `awaiting_independent_verification`. This closes the immediate server delivery failure and confirms the authenticated owner processing-status read; no contribution identifier, posting data, or raw artifact is retained. Fresh root/nested aggregate telemetry corroborates one successful scheduled batch, one claim, one parked item, and zero completed/retried/dead/delivery-published items. The earlier zero-work observation preceded this processing batch. Source inspection confirms the runner parks pending provider verification and that the client refresh action only reads status; it does not requeue work. The exact provider-verification reason is not exposed by the aggregate metrics, so no specific mismatch, provider outage, closed posting, or registration fault is claimed. Do not resubmit the acknowledged job or remove account-held items as troubleshooting. Provider verification, Trust, publication, and broader lifecycle acceptance remain open; no cloud or application mutation was made. | D2-005, D2-006, D2-015, D2-016, D2-019 | [Independent verification boundary](../../../backend/services/jobs/src/contribution-processing.ts), [parking behavior](../../../backend/services/jobs/src/contribution-processing-runner.ts), [owner receipt rendering](../../../frontend/extension/entrypoints/popup.ts); installed aggregate receipt/state plus scheduled aggregate metrics |
| 2026-09-05 | Reproduced four false verification failures before fixing optional-location omission and exact grounded location/work-type comparison. Original independent provider observations are retained, and wrong regions, conflicting explicit work modes, and ambiguous mixed prefixes still deny. Added operator-only bounded reason-count inspection and unchanged-snapshot recovery for temporary provider unavailability/mismatch; stale snapshots, replays, wrong accounts/artifacts, weighted aliases, malformed responses, closed jobs, duplicates, and Trust holds remain protected. `pnpm check`, 21 verifier tests, 19 Lambda/runtime tests, mocked AWS operator guards, and all three fresh-PostgreSQL processing tests pass. Updated stale extension/Trust/ingestion READMEs to distinguish defaults from controlled development. These are local implementation results; the current held contribution's deployed reason and successful onward processing are not yet established. | D2-006, D2-015, D2-016, D2-019 | [Provider recovery operator](../../../scripts/operate-development-d2-provider-recovery.ps1), [real PostgreSQL regression](../../../backend/services/jobs/src/persistence/contribution-processing.integration.test.ts); generated-synthetic data only |
| 2026-09-05 | Published deterministic D2 artifact `2d634d950e3abee7d5adae000fe837da224ef907dde7efed7977851de2299e4f` from `46a8076`; deployed only the two functions and two aliases to state `272`, scheduled version `8` and Trust version `7`. Both exact code checksums and zero drift pass; 13/13 alarms remain OK. Aggregate inspection found two mismatch-held contributions and unchanged-snapshot retry requeued both. They were processed back into mismatch holds, so the earlier fixes do not establish resolution for these submissions. Added eight fixed field-mismatch counters, with no values, identifiers, hashes, URLs, or payloads, to narrow the remaining cause; diagnostic failures cannot change verification disposition. Also reproduced and fixed a stale dark-verifier route pattern that missed the actual Trust case-open/decision routes, with mocked AWS tests covering all 15 deployed routes and future D2 namespace variants. | D2-006, D2-015, D2-016, D2-019 | Release receipt SHA-256 `cb60b660b704004c7b0e22aa022f5a647244bc9e14ca3d29d29ba3c824f023fc`; release plan `4c01b10bb06a59179b4318845e721d5216494bf12a8c7d82bdf785b567c06e2c`; zero-drift plan `a59189d877905e3a69ad96f99f72cd8cd43afab675443d059384648a49351c22` |
| 2026-09-05 | Released diagnostic source `e0ff15d` at state `273` on exact scheduled version `9` and Trust version `8`, with zero drift. One bounded batch claimed and parked both reviewed submissions without retry/dead/publication. Its fixed diagnostics, corroborated by two filtered aggregate events, identify company and description mismatch on both; all six other mismatch counts are zero. The adapter ignored the provider's own company field and decoded entity-encoded HTML only after stripping tags. Added failing synthetic regressions, then selected the exact provider company when present and bounded outer decoding plus an inert HTML parser with full entity handling, structural text boundaries, and script/style/template/form exclusion. The configured company remains the fallback only when the provider field is absent; malformed supplied values fail closed. All 127 ingestion tests, workflow typecheck, and dependency audit pass. Full repository verification and corrective deployment remain in progress. | D2-006, D2-015, D2-016, D2-019 | [Provider API contract](https://docs.greenhouse.io/job-board.html#retrieve-a-job); diagnostic receipt `df1b9c588f07eeaab85253ab02da29955cb3f5e65422f04cf9c73188fc094799`; release plan `89d1c0f449c973543fd01347b45e1b9b850db2c21269950359f7ac5127b5acb1`; zero-drift plan `2ba7bca1ed271dc2c11e409bfd11d38b149250642627eaac854109afc9e42ef8` |
| 2026-09-05 | Full repository checks passed for provider mapping source `e3bb3a3`. Its exact four-update release reached state `274`, scheduled version `10`, Trust version `9`, and zero drift. The bounded recovery/batch again claimed and parked two submissions; both remain mismatch-held, with company/description diagnostics and no publication. Repository inspection then identified the installed reader's logo-alt fallback, exact 12,000-character capture limit, and repeated-heading removal. Added narrowly version-bound provider-derived compatibility plus adversarial tests; all 133 ingestion tests pass. Original proposals and independent provider observations remain unchanged. Compatibility release and onward lifecycle acceptance are not yet claimed. | D2-006, D2-015, D2-016, D2-019 | Receipt `4c91d0a7cd510bcdc0312ccf703e19174d935859f4530f0c66f2df4cdf894cd8`; release plan `fc556ffff9a74e021bb87a0297fde6fb5f6bb38b31982191e15f99ba532baa7f`; zero-drift plan `70a26c41e3b80eff08aa38d1c4ad46373d1a747f306c29b9221c3595d392fe9a` |
| 2026-09-05 | Source `ed8dd9a` passed `pnpm check` (34/34 test tasks), 133 ingestion tests, 101 workflow tests, and the dependency audit with only the two existing exact expiring mobile-build exceptions. Two deterministic builds matched artifact `bdd9a82d0dd963d4bc58e0912a73a45bfa19aee9abc06e14dd0a3cacf4f6ae43`. The four-update release reached state `275`, scheduled version `11`, Trust version `10`, exact immutable checksums, and zero drift; 13/13 alarms were OK. Snapshot-fenced retry requeued two holds, and the normal batch claimed/parked both with all completion/retry/dead/publication counts zero. Two fixed aggregate events show description mismatch only; company mismatch is resolved. A bounded read-only comparison of the supplied public page and exact provider response found unequal descriptions even after whitespace removal; only aggregate comparison results were retained, and the temporary probe was removed. No immutable submission was rewritten or resubmitted. At 19:11:27.298Z the unchanged signed policy expired; a direct read then returned no-store `503`. No renewal, production/store activation, broader provider, or human reviewer assignment was performed. | D2-006, D2-015, D2-016, D2-019, D2-021 | Receipt `ab77c1dbc75b17cefdbb11b76f8235d8aad0736bf06b4994339ab173d748a59c`; release plan `e90314c68c60b712ecf63045b86fef3e43c5f8efb341fd6fc5b39aec97e61581`; zero-drift plan `cca942f21609c41aa3247971bddd21ed9917e9cea7f13c44353dca4e20f23242`; aggregate provider inspection: 2 inspected, 2 mismatch, 0 unavailable/closed/duplicate/other |
| 2026-09-05 | The user approved renewing the same Greenhouse-only development policy for 24 hours. Existing Ed25519 signing material produced revision `d2-development-greenhouse-20260905-v3`, issued 2026-09-05T19:24:54.670Z and expiring 2026-09-06T19:24:54.670Z. Exact canonical comparison proved every authorization dimension unchanged. The reviewed four-update plan changed only policy-bearing Gateway/scheduled Lambda environments and their aliases, reaching state `276`: Gateway `50`, scheduled `12`, unchanged Trust `10`. All three immutable code checksums and health checks pass; a refresh-backed verification plan has zero drift. Two direct public reads independently verified the signature, exact envelope, current validity, `200`, and `no-store`. All 13 D2 alarms are OK; seven policy regressions and operator source guards pass. No key rotation, code rebuild, database/schema change, manual contribution retry, reviewer assignment, broader provider activation, production, or store change occurred. The two description-held contributions and other acceptance gates remain open. | D2-014, D2-016, D2-021; D2-R11 | Envelope SHA-256 `76857dd1df492a3c42eb061a655566cf7ca1c7af11296615f8716fbd3c3621f0`; reviewed plan `2840947035aa39a5b32b6c619ef2e8d85ee280bd07ce4c460e058abb220ecd7b`; zero-drift plan `cedb4a4b0fcbba37d8945d5990030671aa739d3830a7689effbe0a07fa5d60c0` |
| 2026-09-05 | Implemented warm-policy refresh, owner pre-verification cancellation, readable reviewer queue/evidence, and terminal Trust reconciliation in one shared worktree without new branches. Generated paired Greenhouse regressions reproduce safe DOM text boundaries and the exact dollar-range separator difference; the corrected verifier matches the current public page/API pair in memory without retaining posting values. All 147 ingestion, 123 extension, and 35 migration tests pass; targeted reviewer/API/Gateway tests and actual PostgreSQL cancellation/composed lifecycle tests also pass. Migration `0020` expands the checksum manifest to 40 migrations while retaining six owners, ten schemas, and 68 relations. Integrated verification and ordered development deployment are still in progress; no cloud change, reviewer assignment, immutable-payload rewrite, or website publication is claimed by this entry. | D2-024–D2-028; D2-006, D2-016, D2-019 | New source and test links in the task/decision rows; aggregate-only diagnostics; all credentials and raw public responses remain outside retained evidence |
| 2026-09-05 | Fresh independent PostgreSQL clusters pass the complete integration graph: 107 tests in 21 files, no skips, 29/29 tasks including build prerequisites. The packaged six-owner migration runner succeeds twice and verifies 40 checksum-bound migrations, ten schemas, and 68 relations. All 24 bounded authenticated-runner regressions pass. Current-baseline schema 7 passes round-trip/adversarial tests and independent review while preserving historical document provenance. A clock-boundary flake in the extension's token assertion was fixed without changing authentication behavior. Temporary test databases and the package-check image were removed; Docker/WSL were stopped. Final repository verification and actual release remain in progress. | D2-025–D2-029; D2-016 | [Composed lifecycle](../../../backend/workflows/src/d2-community-lifecycle.integration.test.ts), [current-baseline tests](../../../scripts/tests/development-current-document-baseline.tests.ps1), [authenticated workload tests](../../../scripts/tests/development-d2-authenticated-intake.test.mjs); restore manifest SHA-256 `190a4cc5e42b07b1e3bab3aa08876079dd1912f28f203047c8e92239c2a126fc` |
| 2026-09-05 | Completed the ordered development release. Three JWT routes and their budgets were added, then an exact refresh-only state reconciliation advanced `277` to `278` with zero resource actions. Schema 7 preserved the original document artifact while the migration task definition advanced state `279`. One immutable `116b272` task applied/verified 40 migrations and stopped with exit 0; correction `3f20462` recovered its seven exact source-bound success messages and produced a zero-drift schema-7 baseline, without a second migration run. The worker-only four-update plan reached state `280`, scheduled `13`/Trust `11`; the Gateway-only two-update plan then reached state `281`, Gateway `51`, with immutable artifact, direct search/auth, and zero-drift verification. No role, trigger, policy scope, provider registration, production, or store authority was expanded. | D2-016, D2-025–D2-027, D2-029 | Migration receipt SHA-256 `499c2b246dc99014fc3234fabf210beb29460a03aab3acc346c97d7f473d28ba`; migration zero-drift `72ec6f2c75f9567e726168d3bbdd2c60ce12e113143fe67822f1f1b67cec59fe`; worker receipt `e56b41d79bb5b552c20c15c7827912af43389ec0229edd0248c31e4bdb685456`, release plan `76616b2adb3f11301480cfffe0ae119a07c30ba688f769356c311285538f9201`; Gateway receipt `05eafa87c6e7536c7885480b404096864f54127ba5e55fee0a05b9560acadfc6`, release plan `127f9f0ad24a23ecbdc8b227f81095250d2067575c5384b279222ad99ac3d0fa`, final zero-drift `94b25f8a831621b0202f54921b51f5548df5e569db09ed0450d80e6d44596589` |
| 2026-09-05 | Before Gateway cutover, the bounded `22:00:00`–`22:30:30Z` observation found two ordinary new scheduled-version `13` ticks at `22:24`/`22:29`; old `12` remained last at `22:19`, beyond the old 30-second timeout and margin. Six function calls equal six alias calls and six async admissions; observed errors/throttles/drops were zero, with maximum async age 112 ms. Trust `11` retained its exact enabled mapping and input/DLQ `0/0/0` at `22:30:58Z`; its absent metric series were not represented as zero. No manual invocation occurred during the cutover observation. | D2-016, D2-025, D2-027 | Aggregate-only CloudWatch and SQS observation; immutable old/new configuration binding; no universal queue-flush claim |
| 2026-09-05 | Fresh inspection found exactly two unchanged provider-mismatch holds, and snapshot-fenced retry requeued both. One normal bounded batch on version `13` claimed/parked both, with zero completion/retry/dead/delivery-publication and zero mismatch events in the returned tail. A separate fresh inspection then found zero provider-pending holds. Neither submission was rewritten or resubmitted; account-held browser items were untouched. The precise new owner Processing/Trust state and human publication acceptance remain separate. The admin UI from `116b272` is READY at its protected Vercel preview (`302`, `no-store`), without human Auth0/reviewer acceptance. `pnpm check` passes for `3f20462`; Docker/WSL remain stopped. | D2-006, D2-015, D2-016, D2-019, D2-024–D2-029 | [Protected admin preview](https://ai-job-apply-admin-6ewxee4ci-applydash2026-5637.vercel.app), [bounded recovery operator](../../../scripts/operate-development-d2-provider-recovery.ps1); aggregate-only results, no identities or posting values retained |
| 2026-09-05 | Final health correlated two successful version-`11` Trust invocations, two handled/zero failed signals, and two SQS messages sent/received/deleted. One throttle at `22:39Z` raised the alarm at `22:40:10Z`; OK at `22:46:10Z` used missing-data handling. The uncapped standard poller and function reservation one were inconsistent. Configuration `7420dfa` binds the mapping maximum to the reservation and enforces active integer two through five; development uses two. Eight mocked Terraform tests and full `pnpm check` pass. The exact two in-place changes advanced state `281` to `283`; independent AWS readback verifies reservation/mapping `2`, unchanged Trust alias `11` and artifact, and zero drift. No application code, permissions, policy, schedule, queue contents, alarm threshold, or provisioned capacity changed. This is configuration verification, not a new authenticated load or recipient-delivery claim. | D2-016 | Concurrency plan SHA-256 `163c9aa747e6514b869945507da692a7f422f4692be49ce5cef3f592f4c000d8`; zero-drift plan `4aeae2240fa480fddb04dabd19bbaf171db1c1f892ec73c40ba1190c61e96352`; source `7420dfa`; aggregate-only health and independent source review |
| 2026-09-06 | Recorded the product owner's explicit selection of Codex for initial/takedown review and the product owner for appeals. Reviewed the Gateway's exact issuer/subject/role/scope enforcement, separate verified-requester permission, immutable reviewer identifier, appeal self-review denial, and admin MFA boundary. Added D2-030 and the single delegated-reviewer configuration/rationale section. The new agent identity is separate from the workflow and human appeal identity; live grants/bindings, credentials, cross-role verification, and actual decisions remain pending. No account, permission, cloud resource, case, or catalog record was changed. | D2-007, D2-016, D2-030 | User assignment on 2026-09-06; [reviewer authority](../../../backend/gateway/src/trust-reviewer-authority.ts), [role/scope tests](../../../backend/gateway/src/trust-reviewer-authority.test.ts), [appeal separation](../../../backend/services/trust/src/application.test.ts), [human MFA](../../../frontend/admin/lib/auth0.ts) |
| 2026-09-06 | Received the dedicated agent Client ID, checked its canonical shape and separation from the case-opening identity against the retained development baseline, and prepared a masked local setup for the new secret and optional appeal User ID. The output is Windows-current-user DPAPI encrypted in an ignored, user-only directory, with no secret or raw subject in tracking. Local syntax, baseline/context checks, and a synthetic DPAPI round trip passed. Credential collection does not request a token, deploy roles, renew the policy, or mutate cases/catalog state; those steps remain pending. | D2-030 | Client ID SHA-256 `53c4478adb402ef76dc6f018e84c9fda88288ed6e3dd6250cdbb0175af69419a`; retained baseline `4aeae2240fa480fddb04dabd19bbaf171db1c1f892ec73c40ba1190c61e96352`; local encrypted setup only |
| 2026-09-06 | Verified the encrypted dedicated reviewer setup and a fresh RS256 M2M token against the exact baseline issuer/audience/client/subject and three intended scopes, with zero extras. The optional appeal identity was blank. Added the explicit synthetic M2M/human role matrix; all 12 authority tests, Gateway typecheck, scoped formatting, and whitespace checks pass. Offline binding checks preserve the existing opener, pass both runtime parsers, and fit the configuration/environment limits without relaxing guards. AWS reports expired SSO; no current state read, saved cloud plan, deployment, case decision, or catalog mutation occurred. D2-030 remains in progress pending development SSO, role deployment/live checks, and the human appeal identity/MFA journey. | D2-030 | Aggregate token verification at `2026-09-06T15:34:57Z`; [role-separation tests](../../../backend/gateway/src/trust-reviewer-authority.test.ts); retained baseline SHA-256 `4aeae2240fa480fddb04dabd19bbaf171db1c1f892ec73c40ba1190c61e96352`; [configuration parser](../../../packages/config/src/index.ts) |
| 2026-09-06 | After renewed SSO, verified the exact development account/lineage at state `283` and a fresh narrowly scoped agent token. The independently reviewed four-update assignment-only plan applied as source `b703e56`, advancing state to `284`; Gateway `52` and scheduled `14` retain unchanged application artifacts, and Trust remains `11`. Eight before and ten after API probes pass: one bounded queue/case/evidence read, authorization/invalid-input checks, four out-of-role denials, and anonymous denial. No valid decision was sent and no case/job content was retained. Exact artifact/environment readback, zero drift, 13/13 alarms `OK`, empty observed input/DLQ, and unchanged schedule/mapping/concurrency pass. Human appeal identity/client/MFA and substantive review/publication remain open. | D2-007, D2-016, D2-026, D2-030 | Saved plan SHA-256 `1b86e6dd66998abce846b4b121741be616c982e4fd76e0c570a5b179bbec2be2`; zero-drift SHA-256 `6def8b337aab9355c58b301a2d95139c49a279fb3704d8d390459e151eebe33c`; aggregate API windows `16:11:33Z–16:11:44Z` and `16:14:00Z–16:14:13Z`; health at `16:15:57Z`; [reviewer role boundary](../../../backend/gateway/src/trust-reviewer-authority.ts) |
| 2026-09-06 | Implemented the separate human appeal profile without requesting moderator, case-opening, initial, or takedown scopes. The standard default remains compatible; invalid settings fail closed and cached broader clients are not reused. Appeal-only server rendering and interactive controls select the appeal queue and refuse forged/non-appeal decisions while retaining MFA, evidence, version, and Gateway authority checks. The local setup helper writes the explicit profile. Admin 40 tests/seven files, typecheck, build, and five disposable setup tests on each of Windows PowerShell 5.1 and PowerShell 7 pass. The full repository verifier passes contract generation, skill/infrastructure/operator guards, format/lint, 33 typecheck, 34 unit-test, 20 build tasks, Compose configuration, and product-scope checks; 30 database-gated tests are skipped, with no database change or new integration claim. No real environment, human credential, grant, hosted admin deployment, or cloud role was changed by this source follow-up. | D2-026, D2-030 | [Auth0 profile tests](../../../frontend/admin/lib/auth0.test.ts), [server-page tests](../../../frontend/admin/app/page.test.tsx), [interactive appeal tests](../../../frontend/admin/app/trust-console.test.tsx), [setup regressions](../../../scripts/tests/configure-auth0-admin-local.tests.ps1), [repository verifier](../../../scripts/verify-phase0.ps1); local aggregate log `phase0-appeals-20260906.log` |
| 2026-09-06 | Compared the proposed human admin Client ID with existing local client configuration without printing credentials. It exactly matches the candidate web application; independent source review confirms the setup rejects this reuse before any secret prompt. No collector, environment overwrite, grant, token exchange, deployment, or case change occurred. A different dedicated Regular Web Application Client ID is required before human appeal setup can continue. | D2-030; D2-R12 | Proposed client SHA-256 `0956ce560e8b96dd3a1693334580169d8f2153fdd09ea30f9bd146da5a86e483`; [client/secret separation guard](../../../scripts/configure-auth0-admin-local.ps1); aggregate local comparison only |
| 2026-09-06 | The replacement human-admin Client ID passes separation from two configured local clients and two retained reviewer assignments. Prepared and launched the separate masked appeal setup helper with new non-overwriting, Git-ignored, current-user DPAPI outputs. Eleven synthetic validator cases and encryption round trip pass; retained context, expiry, user-only ACL, absent outputs, and independent source review pass. Credentials and human identity remain unverified; no existing environment, grant, token, cloud role, case, or policy changed. | D2-030; D2-R12 | Replacement client SHA-256 `563e1817965dd27b46bba0129160f103097d664999b74ae5225cb0e6fbf47e2a`; local collector SHA-256 `3fcc8d198ed8c4d653790b9f035ec837e71480196c0718e0836ee92de03e99e8`; retained plan `6def8b337aab9355c58b301a2d95139c49a279fb3704d8d390459e151eebe33c`; [appeal-only profile](../../../frontend/admin/lib/auth0.ts) |
| 2026-09-06 | The user completed encrypted human appeal setup. Local decryption, ACL/context/expiry, exact profile/scopes, candidate credential separation, and distinct human subject shape pass. One credential-free public authorization request with fresh state/nonce/PKCE returns `403` / callback mismatch for the intended localhost admin callback. Recorded exact new-application URL and narrow user-delegated grant settings. The secret and subject are not transmitted or retained in tracking; no token exchange, authenticated identity/MFA claim, local environment overwrite, role deployment, policy renewal, or case change occurred. | D2-030; D2-R12 | Aggregate setup validation and one public authorize preflight; [admin identity configuration](../../../frontend/admin/lib/auth0.ts), [local admin setup](../../../frontend/admin/README.md); retained state-284 context unchanged |
| 2026-09-06 | After the user's settings update, one fresh public authorization preflight returns `302` to Auth0 login without callback mismatch. Started the unchanged verified production admin build on loopback using process-only appeal configuration and a fresh session secret, with raw logs discarded and automatic stop at the existing setup expiry. Staged its missing static assets without replacement; the appeal page/eight assets, exact SDK authorization request, anonymous queue `401`/`no-store`, token endpoint `404`, and sanitized missing-state callback pass. Independent source review identified staging, expiry, environment, and status hardening applied to the local helpers; live checks confirm the intended listener, no inherited Node startup flags, and no static-tree links. No human login, token exchange, role deployment, case decision, policy renewal, or hosted deployment is claimed. | D2-030; D2-R12 | Aggregate local runtime started `2026-09-06T18:34:21.146Z`; [appeal identity/session boundary](../../../frontend/admin/lib/auth0.ts), [anonymous Trust boundary](../../../frontend/admin/lib/trust-bff.ts), [admin setup](../../../frontend/admin/README.md); ignored aggregate runtime/boundary checks |
| 2026-09-06 | Investigated the user's localhost connection refusal using only aggregate runtime status and process/listener checks. The supervisor recorded `window_expired` and stopped the server at `19:24:54.689Z`; inspection at `20:41:14Z` confirms both processes and the port-3001 listener are absent. No new Auth0 failure is established. Requested a fresh bounded local sign-in window separately from any contribution-policy renewal. No credential was decrypted, runtime restarted, cloud state changed, role assigned, or case modified. | D2-030; D2-R11, D2-R12 | Ignored aggregate runtime status; read-only process/port checks; previous callback and anonymous-boundary acceptance preserved |
| 2026-09-06 | The user approved a local-only two-hour appeal sign-in restart. Applied the fixed `20:55:31Z`–`22:55:31Z` runtime window without rewriting the encrypted setup or original expiry. Source review, syntax, explicit-local-mode refusal, context/separation, and unchanged-file checks pass. Server startup at `20:58:31.024Z`, loopback-only listener, page/eight assets, and all four anonymous/SDK boundary probes pass; the supervisor retains automatic expiry. No AWS mutation, reviewer binding, contribution-policy renewal, human login/MFA proof, or case decision occurred. | D2-030; D2-R12 | User approval; ignored aggregate runtime `appeal-local-runtime-20260906T205531Z.status.json`; [admin identity boundary](../../../frontend/admin/lib/auth0.ts), [Trust BFF boundary](../../../frontend/admin/lib/trust-bff.ts); four preserved local files unchanged |
| 2026-09-06 | Investigated the reported Internal Server Error with the listener/anonymous boundary still healthy. Generated missing/password-only/MFA fixtures reproduce the installed SDK's post-callback session-hook behavior; this identifies a possible cause, not the actual user's MFA state. Source `ecfb607` keeps MFA rejection and introduces a typed, callback-only fixed-error boundary with no cookie, raw error reflection, or successful continuation on failure; both profiles render accessible guidance. All 71 admin tests/eight files, independent security review, and the full repository verifier pass (33 typecheck/34 unit-test/20 build tasks; 30 database-gated skips). The rebuilt local app restarted at `21:12:59.290Z`; page/eight assets and five anonymous/error/SDK probes pass. Four protected local files and the `22:55:31Z` deadline remain unchanged. No AWS, provider policy, reviewer role, hosted deployment, or case change occurred. | D2-030, D2-031; D2-R12 | [Typed MFA rejection](../../../frontend/admin/lib/auth0.ts), [callback regressions](../../../frontend/admin/proxy.test.ts), [error-page regressions](../../../frontend/admin/app/page.test.tsx); local aggregate verifier log `phase0-admin-mfa-error-20260906.log` and runtime status |
| 2026-09-08 | At the user's request, reopened only local appeal sign-in for the fixed `11:38:16Z`–`13:38:16Z` window. Preserved original encrypted setup, both client environments, and prior runtime records. The initial readiness check failed; the bounded retry passed with a longer local startup allowance and fixed stage-only diagnostics. Unchanged application source `ecfb607` started at `11:40:58.376Z` on loopback; page/eight assets and all five anonymous/error/SDK probes pass. No human login/MFA, AWS change, contribution-policy renewal, role assignment, or case decision is claimed. | D2-030; D2-R12 | User restart request; ignored aggregate runtime `appeal-local-runtime-20260908T113816Z-retry1.status.json`; [admin identity boundary](../../../frontend/admin/lib/auth0.ts), [callback regressions](../../../frontend/admin/proxy.test.ts) |
| 2026-09-08 | The user reported the fixed `mfa_required` error, then explicitly confirmed `Privileged session active` after application-specific Auth0 MFA guidance using Actions > Triggers > Post Login. Source inspection confirms that status requires an SDK session and session persistence requires MFA. Retain user-confirmed local login/MFA success only; no identity claims, callback parameters, tokens, cookies, or MFA material were collected. The read-only development SSO check is unavailable. Exact human identity/scopes, separate backend appeal/read assignment authority and deployment, and hosted acceptance remain open; no cloud, case, environment, runtime, or contribution-policy change occurred. | D2-030, D2-031; D2-R12 | User confirmation; [session guard](../../../frontend/admin/lib/auth0.ts), [session-only status](../../../frontend/admin/app/page.tsx), [current Auth0 trigger attachment](https://support.auth0.com/center/s/article/Action-says-Deployed-but-it-s-not-being-executed); aggregate SSO availability check |
| 2026-09-08 | Refreshed SSO matches the expected development account/temporary role. Read-only live context matches state 284 and versions 52/14/11 with unchanged environments/two machine assignments; 13 alarms and empty Trust queues pass. The proposed human assignment fits existing limits. Added the default-dark local-only human identity verification action and tests: 148 admin tests/11 files, typecheck, formatting/lint, and independent source review pass. The full repository verifier and fresh admin production build pass. No human identity receipt, assignment apply, case decision, or contribution-policy renewal is claimed. | D2-030, D2-032; D2-R12 | [Private setup verifier](../../../frontend/admin/lib/appeal-setup.ts), [synthetic verification tests](../../../frontend/admin/lib/appeal-setup.test.ts), [setup UI](../../../frontend/admin/app/appeal-setup-check.tsx); aggregate SSO, health and state-284 readback |
| 2026-09-08 | Started the freshly built private-check console from `f678b37` at `12:40:28.527Z`; page/nine assets, SDK login boundary, and five anonymous checks pass without retaining runtime logs. Prepared and independently reviewed the separate assignment-only operator; 59 synthetic receipt/plan guard checks and syntax validation pass. Actual human verification, saved plan, and role deployment remain pending. The existing local deadline, original encrypted setup, contribution-policy expiry, and all cases remain unchanged. | D2-030, D2-032; D2-R12 | [Local private check](../../../frontend/admin/lib/appeal-setup.ts), [setup action](../../../frontend/admin/app/appeal-setup-action.ts); ignored aggregate local runtime status and synthetic operator results |
| 2026-09-08 | The user completes the private check at `13:19:45Z`: exact identity/client/audience, fresh MFA, two privileged scopes, and zero extras pass without exposing claims or tokens. The reviewed assignment-only plan from `01f6e94` applies at `13:23:01Z`, reaching state `285` through four in-place updates and adding only the human appeal/read assignment. Exact Gateway `53`/scheduled `15`/Trust `11` artifact/environment readback and refresh-backed zero-change plan pass. The `13:23:57Z` operational snapshot shows 13 alarms OK, both Trust queues observed empty, and unchanged mapping/concurrency/schedule. Human queue access and hosted acceptance remain open. No case decision, policy renewal, other reviewer change, or environment-file rewrite occurred. | D2-030, D2-032; D2-R12 | [Private identity boundary](../../../frontend/admin/lib/appeal-setup.ts), [reviewer authority](../../../backend/gateway/src/trust-reviewer-authority.ts); saved plan SHA-256 `272274509e1c2eca6c4838de578a5f2b4d9a858fe7f56b0317c01f07163c6ff0`; follow-up plan SHA-256 `ffda4384a75ba503daefbff27c7e3e33acd638df19a626db6ed2fae9c12bc544`; aggregate live readback/operational snapshot |
| 2026-09-08 | The user reports “No cases are awaiting this review” after explicitly selecting Load review queue in the signed-in local appeal console. Source inspection confirms this fixed message follows a successful, schema-validated empty API page; errors have a distinct message. Record user-confirmed authenticated local-to-development queue-read success, not an independently captured browser/network trace or an appeal decision. Local identity setup/read access is no longer a blocker; hosted reviewer and appeal-decision journey acceptance remain open. No case, cloud configuration, policy, runtime, or credential changed in this follow-up. | D2-030; D2-R12 | User aggregate confirmation; [queue success/error handling](../../../frontend/admin/app/trust-console.tsx), [authenticated schema-validating proxy](../../../frontend/admin/lib/trust-bff.ts) |
| 2026-09-08 | Implemented persistent development contribution configuration across extension, Gateway, scheduled processing, and Terraform, with Jobs `0021` automatic operation leases and unchanged ownership/verification/Trust boundaries. Fixed legacy route-flag compatibility and isolated the extension's public build settings from Turbo caching; bounded test workers resolve workspace-load timeouts. Source `6ea1d56` passes the full repository verifier (34 test tasks/20 build tasks), 156 extension tests, 66 fresh-PostgreSQL Jobs integrations, 59 Terraform tests, and 26 synthetic workload-runner tests. Artifact publication stops before any upload/image build or database/runtime mutation because the unrelated mobile parser exception expired today. No exception was renewed or bypassed. Removed the two generated disposable test databases and stopped Docker Desktop/WSL. | D2-033; D2-R13 | [Backend configuration](../../../packages/config/src/index.ts), [lease migration](../../../backend/services/jobs/migrations/0021_development_contribution_operation_lease.sql), [extension build isolation](../../../frontend/extension/turbo.json), [existing dependency exception](../../security/dependency-vulnerability-exceptions.md); full verifier and aggregate local results |
| 2026-09-08 | Completed the coordinated D2-033 development rollout from `90f3740`: two matching no-cache migration-image builds, isolated smoke, and ECR scan COMPLETE with zero High/Critical findings close D2-034/D2-R13. Jobs `0021` ran once through task revision `49` (exit 0, seven exact logs), verifying 41 migrations/68 relations/six owners/ten schemas. Six in-place runtime updates, zero creates/deletes, reach state `287` and Gateway/scheduled/Trust `54`/`16`/`12`; all three reviewer assignments remain byte-exact and zero drift passes. The `18:31:21Z` snapshot matches versions/artifacts/environments/reservations `2/1/2`, 13 alarms OK, approximately empty queues, and unchanged mapping/schedule. Twenty unauthenticated POSTs all return 401 (zero unexpected/5xx/policy requests; 468 ms total, latency p50/p95/max 172/311/314 ms). Rebuilt the configured unpacked development extension with exact host grants and no persistent content scripts; installed reload/authenticated acceptance remains. No policy renewal, automatic old-item resubmission, operator case write, authenticated throughput, or fresh restore is claimed. Docker/WSL are stopped and the PC remains on. | D2-016, D2-020, D2-033, D2-034; D2-R11, D2-R13 | [Development authority](../../../backend/services/jobs/src/contribution-capability-source.ts), [Jobs 0021](../../../backend/services/jobs/migrations/0021_development_contribution_operation_lease.sql), [extension mode](../../../frontend/extension/lib/development-contributions.ts); image platform digest `9d2c340aa26c5548e1d5f4eba7ca66b672c8e2fd35d56d1f1cbb48b688eb3b13`, image receipt SHA-256 `ce2697d4f6684bd09827c879b47c20f959955a83c0edbf01f269d4c48be09b5e`, migration receipt `d373d7f33245bfb432c1d487dc525d91d43f7a53a4d794d83422d3bbed60058b`, cutover plan `1fde68b4523c19a4efb55906874e9d1f5a67398620aa10dac1ee97829182d119`, zero-drift plan `a6a88fbdf1c4733a0aa64e6caa00a41fcfc50d293faf7219a61deddee99d99d5`; aggregate health and local build/readback |
| 2026-09-08 | The user confirms reloading the rebuilt development extension, signing in successfully, and adding a job successfully. Combined with the preceding verified deployment, this closes D2-033 and D2-R11. Retain user-confirmed installed success only: no new cloud inspection or mutation, independent network trace, browser identity, job data, credentials, contribution identifier, or queue counts were collected. Provider/Trust verification, website publication, browser lifecycle, authenticated workload, and other phase acceptance remain separate; Phase 2 stays In progress. No old items were automatically resubmitted. | D2-033; D2-R11 | User confirmation in this conversation; [development mode](../../../frontend/extension/lib/development-contributions.ts), [receipt versus processing/Trust display](../../../frontend/extension/entrypoints/popup.ts); preceding deployment/build evidence |
| 2026-09-08 | Resumed full Phase 2 completion on the user's explicit persistent goal. Read-only STS confirms available SSO in the configured development account. A bounded source audit finds that Lever/Ashby require extension/server descriptors, reconciliation changes, and a forward migration, now tracked as D2-035 rather than configuration-only activation. The saved delegated-reviewer setup explicitly ended at 2026-09-06T19:24:54.670Z; read-only metadata confirms expiration and encrypted-file presence. Credential reuse requires fresh user authority under D2-R14 before case reads/decisions. No credential was decrypted, token requested, case read/changed, provider activated, or cloud configuration changed. README current-status summaries are synchronized; existing reviewer assignments and persistent contribution mode remain intact. | D2-030, D2-035; D2-R14 | [Reviewer setup-use boundary](#delegated-reviewer-assignment), [multi-provider implementation plan](#d2-035--complete-multi-provider-development-contributions); aggregate SSO/status checks and bounded source audit |

| 2026-09-08 | Implemented D2-035 fixed provider descriptors, bounded development-only provider selection, extension/runtime/Terraform wiring, and forward Jobs `0022`. Existing Greenhouse defaults/digest and all independent verification/Trust controls are preserved. Local extension/config/Jobs/migration/Terraform checks pass, including 77/77 fresh PostgreSQL tests and an actual clean migration-image build, packaged three-provider smoke, six-owner fresh migration/replay, and read-only 42-migration recovery check. Fixed the clean-image Config dependency and stale migration-log test expectations; retained-fixture retries were not counted as acceptance. Removed only the three disposable synthetic test containers and stopped Docker/WSL. No live inputs, credentials, roles, provider registrations, or deployment changed. Paired provider extraction/verification work remains under D2-035. | D2-035 | [Implementation and local evidence](#d2-035--complete-multi-provider-development-contributions); shared-main implementation with bounded agent ownership, no additional branches |

| 2026-09-08 | Fixed generated page/API pairing failures: URL posting identity takes precedence over requisition labels; omitted optional IDs derive only internal fetch identity; exact singleton/structured locations preserve full provider truth; independently corroborated HTML handles bounded v1 block/heading representations without fuzzy matching. Lever uses exact global/EU GET and retains complete body/list/salary/closing sections, including bounded HTML fallback when plaintext is absent. Edge and Chrome-for-Testing each pass the actual-DOM 3-variant matrix (57 inspections, 144 payloads, 114 verified, 43 expected denials, 145 synthetic API calls, zero real fetches). Ingestion 284 and extension 237 tests pass. Two admin fork-start timeouts prompted the existing two-worker pattern; all 148 admin tests pass. Independent review caught and verified the HTML-only omission fix. No credentials, real provider captures, deployments, or activation changed. | D2-035; D2-015 | [Provider pairing command](../../../scripts/tests/d2-extension-assurance/README.md#generated-provider-pairing-regression), [source plan and verification](#d2-035--complete-multi-provider-development-contributions); all work stays on shared `main` with no additional branches |

| 2026-09-08 | Integrated coordinated implementation in `54002a7` and `df9ac1d`, then passed the full repository verifier at `df9ac1d`: 33 typecheck tasks, 34 test tasks, 20 build tasks, source-bound guards, dependency-security regressions, Compose and scope checks. The previously failing admin suite passes all 148 tests within the full run. Existing lint warnings and ordinary database-gated skips remain explicit; separate Jobs integration is 77/77. The development extension rebuilt using unchanged ignored settings; no provider activation or cloud release occurred. All agent changes are on `main`, without new branches/worktrees, and the unrelated user stash is untouched. | D2-035 | `scripts/verify-phase0.ps1` exit 0; [local integration and browser aggregates](#d2-035--complete-multi-provider-development-contributions) |
| 2026-09-08 | Completed D2-036's repeatable generated-only logical recovery command: all 42 migrations fresh/replay, real dump/restore, 68 exact row sets and aggregate equality, 18 nonempty D2 relations, resumed three-provider publication, owner isolation, immutable leases, and authorization/cancellation refusals. Final agent and primary command runs pass, as do 15 ownership guards, the separate 2/2 composed and 1/1 cancellation suites, and the full repository verifier. Corrected fixture clocks/client composition without changing domain safeguards. Updated stale gateway release/reviewer notes, removed exact temporary containers, and stopped Docker/WSL. No reviewer credential, real provider capture, cloud release, or live case was used. | D2-036; D2-020 | [Recovery implementation](../../../scripts/tests/d2-recovery/run.mjs), [results and limits](#d2-036--repeatable-synthetic-logical-recovery) |
| 2026-09-08 | Revalidated the clean/synchronized `b4f8b52` checkpoint and remaining gates after D2-036. Checked the independent Greenhouse-only release path without publishing or applying: development STS is unavailable, and a repeated read-only check classifies the failure as SSO renewal required. Reviewer reuse authority remains unanswered under D2-R14. Marked Phase 2 Blocked pending these inputs; retained the full scope and existing implemented/verified results. No new test cycle, credential access, cloud mutation, or provider activation occurred. | D2-R14; D2-R15 | Read-only STS classification at `2026-09-08T20:46:39Z`; [current next actions](#remaining-acceptance-and-operator-inputs) |
| 2026-09-08 | Resumed after the user confirmed renewed SSO and encrypted reviewer-credential reuse. Exact account and live role/identity boundaries pass; the original encrypted setup remains unchanged. Auth0 refuses the existing agent's token request with 403/access_denied, classified on one diagnostic retry as application API access not authorized. No token, case read, decision, grant, or cloud mutation occurred. Closed the answered R14/R15 inputs and recorded the distinct R16 client-grant blocker. Independent read-only release preparation confirms state 287, exact runtime/Greenhouse scope, backup coverage, and zero ECS tasks/services. Corrected the migration runbook's stale 40-migration/six-message wording to the current 42-migration/seven-message package. | D2-030, D2-035; D2-R14–D2-R16 | [Reviewer continuation](#delegated-reviewer-assignment), [remaining steps](#remaining-acceptance-and-operator-inputs), [migration runbook](../../../infrastructure/runbooks/deployments/database-migration.md) |
| 2026-09-08 | After the next user confirmation, exact reviewer token exchange still returned the same 403 API-access denial; requested the exact Client Access entry with secrets hidden and performed no case operation. Continued independent release work: Gateway 189 tests pass, but the registry audit surfaced six new non-image-size advisory records and stopped publication before uploads. Added D2-037 and applied narrow maintainer patches without exemptions: frozen install, audit, 136 security regressions, focused suites, frontend builds and the full repository verifier pass. Fresh pre-repair baseline capture is state 287/zero drift, not a deployment. Docker was started for the intended image work and stopped with WSL once the audit blocked that step. | D2-030, D2-035, D2-037; D2-R16 | [Dependency remediation](#d2-037--release-candidate-dependency-remediation), [remaining steps](#remaining-acceptance-and-operator-inputs) |
| 2026-09-08 | Published c66c8a5 Gateway and D2 artifacts with matching repeat builds; current-source baseline remains state 287/zero drift. Both existing Vercel targets accepted the exact source upload but rejected frozen installation because the required image-size patch was outside the upload allowlist; neither prior READY deployment changed. Began the exact-file packaging repair and stopped Docker/WSL pending corrected-source image publication. Independent recovery inventory identified D2-038's missing restore-only cloud replay executor, distinct from the maintained 42-migration structural PITR verifier and completed local logical recovery. | D2-020, D2-035, D2-037, D2-038 | [Dependency and packaging repair](#d2-037--release-candidate-dependency-remediation), [replay CLI](../../../backend/workflows/src/run-candidate-deletion-recovery-replay.ts), [remaining steps](#remaining-acceptance-and-operator-inputs) |
| 2026-09-08 | Completed the exact `42b9686` release: candidate/admin Vercel targets READY, candidate route/security/cache boundary passes, admin remains protected identity-dark, migration task exits 0 with seven success records and verifies 42 migrations/68 relations. Development state 290 runs Gateway/scheduled/Trust 55/17/13 with zero drift, 13 healthy D2 alarms, approximately empty Trust queues, unchanged reviewers/Greenhouse-only scope and zero ECS compute. This closes D2-037, not the reviewer grant or broader phase acceptance. | D2-016, D2-035, D2-037 | [Release checkpoint](#d2-037--release-candidate-dependency-remediation); zero-drift plan `66eb4747de80b18d3d213104b0bb7c3bbccb5ee8d823323dbda70128551296fd` |
| 2026-09-08 | Assembled D2-038 on shared main without new branches: temporary private Lambda, read-only cloud role/adapters, shared strict contract, guarded operator and seven-owner restored-only reconciliation. Removed the unsafe live-store/per-marker replay path. Local workflow tests pass 533; all three new real PostgreSQL replay/collision cases pass separately. PowerShell guards pass 279 and platform/bootstrap Terraform tests 84/4. Review closes the parser-write/DB-acknowledgement namespace gap, bounded-stream edge cases and failed-startup cleanup path. Exact generated resources are removed; Docker/WSL stopped. Full verifier requires the Terraform changes committed before its immutable-source guard can pass; no guard was weakened. No new IAM, RDS restore or temporary executor is activated. | D2-020, D2-038 | [Isolated recovery implementation](#d2-038--isolated-deletion-recovery), [maintained operator](../../../scripts/operate-development-candidate-deletion-replay.ps1), [real database tests](../../../backend/workflows/src/candidate-deletion-restore-store.integration.test.ts) |
| 2026-09-08 | Committed the integrated recovery implementation as `831b1db`; the full repository verifier and complete maintained infrastructure validation now pass against that committed source. Two source-bound builds match for the Lambda ZIP, manifest and 35-component SBOM; no cloud upload or activation occurred. All three agents finished on shared main without new branches. D2-038 remains implemented/cloud-validation-pending; R16 needs the exact Auth0 client-access screenshot and R17 records the new isolated recovery activation step. Docker/WSL remain stopped and the PC stays on. | D2-020, D2-038; D2-R16–D2-R17 | [Repository verifier](../../../scripts/verify-phase0.ps1), [recovery implementation](#d2-038--isolated-deletion-recovery), [remaining steps](#remaining-acceptance-and-operator-inputs) |
| 2026-09-09 | User supplied the reviewer application's User-Delegated Access screenshot and approved the development-only recovery role, isolated restore/replay and cleanup. Explained the separate Client Access grant; no grant/role or token operation was performed. Fresh STS detects expired AWS SSO. Parallel source review fixes the real operator's IAM role ARN separator and adds actual-function synthetic regressions: 296 checks pass. Independent scope review predicts only the exact bootstrap boundary, new role/inline policy and two endpoint policies; no cloud plan/apply/restore has run. | D2-030, D2-038; D2-R15–D2-R17 | [Operator regression](../../../scripts/tests/candidate-deletion-replay.tests.ps1), [restore role](../../../infrastructure/terraform/modules/platform/candidate-deletion-restore.tf), [Auth0 access distinction](https://auth0.com/docs/get-started/apis/api-access-policies-for-applications) |
| 2026-09-09 | After user confirmation, exact development SSO succeeds at 13:42:25Z and reviewer authentication succeeds at 13:44:24Z with exactly three approved scopes. Nine bounded requests read three existing initial cases and independent public evidence; zero decisions, role changes or next page. Fresh release health preserves state 290, exact artifacts/roles/environments, 13 alarms OK and approximately empty Trust queues. R15/R16 are Closed; R17 remains authorized. | D2-030, D2-038; D2-R15–D2-R17 | [Current release and reviewer checkpoint](#task-register), [remaining acceptance](#remaining-acceptance-and-operator-inputs) |
| 2026-09-09 | Found real remaining implementation gaps after reviewer access became usable: stale proofs cannot be refreshed, backend acceptance lacks a freshness fence, the processor rejects real UUIDv8 Trust decisions, and out-of-order exact publication can regress catalog truth. Started D2-039 with separate shared-main agent ownership, no branches or live case writes. Separately verified that Terraform 1.9.8 cannot enable the intended S3 lock; no recovery plan/apply was generated. D2-040 records the toolchain correction instead of bypassing locking. | D2-039, D2-040; D2-R18 | [Fresh-evidence implementation](#d2-039--fresh-review-evidence-and-monotonic-catalog-truth), [effective state locking](#d2-040--effective-s3-state-locking) |
| 2026-09-09 | Integrated `fab4960` and `cc2fa23` directly on shared `main`, with no new branches. D2-039's evidence refresh, explicit provider basis and monotonic publication and D2-041's strict full export are implemented. Final root PostgreSQL integration passes 136/136 with seven opt-in tests separately passing as composed lifecycle 2/2, export/deletion 4/4 and cancellation 1/1. Logical recovery passes 44 migrations and 68 exact row sets; 296 restore-operator assertions and the full repository verifier pass. Fixed current migration expectations, startup ordering and bounded multi-page test queue inspection rather than relaxing runtime checks. Disposable resources were removed and Docker/WSL stopped. No cloud write, case decision, provider expansion, credential change or GitHub Actions edit. | D2-016, D2-020, D2-036, D2-039, D2-041 | [Refresh database regressions](../../../backend/services/jobs/src/persistence/contribution-refresh.integration.test.ts), [full export regression](../../../backend/workflows/src/candidate-deletion-restore-store.integration.test.ts), [maintained recovery command](../../../scripts/tests/d2-recovery/run.mjs), [repository verifier](../../../scripts/verify-phase0.ps1) |
| 2026-09-09 | Final maintained infrastructure validation passes against committed source, including current 44-migration publisher/restore guards and all D2 operator/public/authenticated-runner checks. The final handoff requests only correction of the deployment skill's incompatible Terraform pin under D2-040; reviewer access and recovery-drill authority are already resolved. Local verification does not claim fresh hosted, provider, recovery or production acceptance. | D2-016, D2-038–D2-041; D2-R18 | [Maintained validation commands](../../../package.json), [effective-locking blocker](#d2-040--effective-s3-state-locking) |
| 2026-09-09 | User approved the exact portable Terraform 1.16.2 transition. Updated the deployment skill, local constraints and operator boundaries while preserving old readers and excluded Actions. Both current/historical archives pass official signature and pinned checksum verification; the old state-290 plan reads without changing its hash. Fresh exact-account backend initialization in an isolated data directory passes encrypted S3 locking and exact identity checks; integrated tests and an actual locked plan remain next. No cloud resource apply or personal toolchain/keyring overwrite. | D2-040; D2-R18 | [Toolchain implementation and state](#d2-040--effective-s3-state-locking), [shared guard regressions](../../../scripts/tests/terraform-toolchain.tests.ps1), [composed peripheral regressions](../../../scripts/tests/peripheral-terraform-toolchain.tests.ps1) |
| 2026-09-09 | Completed D2-040's approved toolchain transition: 441 assertions pass on both PowerShell hosts, full infrastructure/repository checks pass, and actual locked refresh-backed plans succeed. Applied only equal-value sensitivity metadata through Terraform's no-provider-update path, moving state 290 to 291; a fresh plan exits 0. Fixed the exact raw-TF_VAR boolean representation in capture helpers, with both-host regressions. D2-039 maintenance configuration adds no resources by default and passes 93 platform tests; coordinated operators remain under implementation on shared main. No budget value, application version, provider scope, reviewer role, historical artifact, GitHub Action or Docker/WSL state changed. | D2-039, D2-040; D2-R18 | [Toolchain result](#d2-040--effective-s3-state-locking), [maintenance implementation](../../../infrastructure/terraform/modules/platform/community-runtime.tf), [migration ordering](../../../infrastructure/runbooks/deployments/database-migration.md) |
| 2026-09-09 | Finished shared-main coordinated runtime and dedicated restore-role tooling with no new branches. Runtime tests pass 171 assertions on both hosts; restore-role tests pass 210 and independent review. Native readback exposed root/module input and qualified event-mapping differences, now covered by generated regressions. The real Pause diagnostic passes exactly eight updates with no creates/deletes. Added exact generated-directory validation before migration-publisher Docker-auth cleanup; publisher tests pass on both hosts. The full infrastructure gate correctly refused the still-uncommitted Terraform source and must rerun after integration. No application, migration, role or restore apply. | D2-038, D2-039 | [Runtime operator tests](../../../scripts/tests/development-d2-runtime-release.tests.ps1), [restore-role tests](../../../scripts/tests/development-deletion-restore-role.tests.ps1), [migration publisher](../../../scripts/publish-development-migration-image.ps1) |
| 2026-09-09 | Integrated all 26 files at `6a65f63` on shared main, pushed with Actions skipped, and passed the complete repository verifier including 20 builds. Fresh schema-7 capture at state 291 has zero changes; the complete native runtime readback passes exact controls/ingress with zero observed queue counts and a 30-second old maximum timeout. The first maintained Pause preflight refused 11 preserved historical binary plans outside `.terraform`; its narrowed scanner now permits only regular Git-ignored `.tfplan` evidence while rejecting hidden configuration and reparse points. All 178 tests pass on both hosts and the real source inventory passes. No old evidence was moved/deleted. Full infrastructure validation is being rerun with the portable Terraform selected explicitly in that shell; no pause or migration apply yet. | D2-038, D2-039 | [Source scanner](../../../scripts/operate-development-d2-runtime-release.ps1), [runtime regressions](../../../scripts/tests/development-d2-runtime-release.tests.ps1), [toolchain selector](../../../scripts/use-deployment-terraform.ps1) |

| 2026-09-09 | Source `90c5e23` passes full maintained infrastructure validation and a current state-291 zero-change capture. The reviewed Pause plan applies exactly eight updates and verifies state 292/zero drift with disabled D2 handlers, worker reservations zero and schedule/mapping disabled. D1/private capture remain available; no artifact, SQL, role, restore, queue deletion or case decision. Cutoff `18:09:55.5195107Z` requires retirement through `2026-09-10T00:11:25.5195107Z`. Independent handoff review fixes release ordering without changing runtime authority. The authenticated runner's Greenhouse-only development restriction is replaced by existing exact descriptors: all 29 tests pass, including five host tuples and 35 negative cases, without provider activation. All edits remain on shared main. | D2-016, D2-028, D2-039, D2-041 | [Pause operator](../../../scripts/operate-development-d2-runtime-release.ps1), [workload regressions](../../../scripts/tests/development-d2-authenticated-intake.test.mjs), [migration handoff](../../../infrastructure/runbooks/deployments/database-migration.md) |

| 2026-09-10 | Exact `2dd3aa2` Gateway/workers first verified paused at `57`/`19`/`15`; one revision-51 migration task exited 0 with seven success messages and all 44 migrations/68 relations. Maintained Resume Apply/Verify advanced 295 to 296 after retirement; native readback confirms `58`/`20`/`16`, concurrency `2`/`1`/`2` and zero resource/output changes. Headers-only live/ready 200 and entitlements 401 do not establish authenticated acceptance. The four follow-up guard fixes are integrated with validation pending. Source-only consumer review requires no additional web/admin bundle; rights/dark-ingestion releases, recovery and human gates remain. No queue/version deletion, case decision or provider expansion. | D2-016, D2-020, D2-039, D2-041 | [Verified rollout handoff](#d2-039--fresh-review-evidence-and-monotonic-catalog-truth), [separate rights and consumer boundaries](#d2-041--complete-candidate-data-export-coverage) |

| 2026-09-10 | Integrated numeric guards pass 228 assertions on each explicit PS5.1/7.5 host, and ingestion guards pass both. Format/lint/typecheck/dependency-security/unit gates and 20 build tasks (18 cached) pass; the full verifier must rerun after the coherent commit because its exact-HEAD Terraform precondition correctly refuses uncommitted edits. Reviewer Inspect reads three cases with fresh `00:55:39Z` provider proof. One exact delegated decision POST returns 503; independent `01:16:14Z` readback confirms all three remain `needs_review`/version `1`. No successful decision/publication or blind POST replay is claimed. | D2-016, D2-030, D2-039, D2-041 | [Integrated guard boundary](#d2-041--complete-candidate-data-export-coverage), [remaining review gate](#remaining-acceptance-and-operator-inputs) |

| 2026-09-10 | Exact committed `e2e730a` passes the full maintained verifier and verified D2 scheduled/Trust `21`/`17` at state `297` plus Gateway at state `298`. D2-042's canonical ISO SQL bindings fix the actual shared Profile/Drizzle client; the real regression fails three shared-client cases before and passes all six after. Fresh exact evidence/case reads precede three supported initial decisions, all accepted/version `2` (three POSTs, 21 total requests). This supersedes the earlier rolled-back 503 and uncommitted-source verification stop. Post-decision aggregates show three processing completions, three copied Trust signals, 13 OK alarms and approximately empty Trust queues, not exact owner/publication proof. Roles and original submissions are unchanged; no appeals or provider expansion. Rights reconciliation followed by the one-update mapping-only Resume verifies at state `305` with exact pins and zero changes; dark ingestion then verifies at state `308` with all four activation flags false. Final canonical capture passes at state `308` with zero changes; fresh user export/deletion acceptance remains open. Phase 2 remains In progress. | D2-007, D2-016, D2-019, D2-022, D2-026, D2-030, D2-039, D2-041, D2-042 | [Deployed fix and aggregate evidence](#d2-042--shared-client-trust-write-compatibility), [remaining gates](#remaining-acceptance-and-operator-inputs) |

| 2026-09-10 | Integrated all four D2-043 operator repairs directly on shared main, with no new branches. Both PowerShell hosts pass 185 reader assertions, 49 workload-input cases, 332 restore-role assertions, 131 gateway guards, and the complete capture-operator regressions including effective-change and malformed-input refusals. Original plans/state remain unchanged; full committed-source verification and current-schema recovery are next. | D2-043; D2-038 | [Reader tests](../../../scripts/tests/terraform-toolchain.tests.ps1), [restore-role tests](../../../scripts/tests/development-deletion-restore-role.tests.ps1), [capture tests](../../../scripts/tests/development-gateway-release-operator.tests.ps1) |

| 2026-09-10 | D2-043's full verifier passes at `6604aff`, with fresh bootstrap/platform zero-change baselines at states `13`/`308`; no temporary recovery permission is applied. Read-only PITR health finds recurring activity HTTP 403 errors. Integrated D2-044's narrow exact-version deletion acknowledgment fix; a generated-object S3 probe confirms first/repeated acknowledgment and complete cleanup without candidate data. Actual-source workflow checks pass 617 with six explicit database opt-ins skipped, focused checks 104/104 and typecheck. Integrated D2-045's three inspector profiles with timing/sample completeness, strict aggregates and no historical reinterpretation; 147 checks plus 49 existing input guards pass on each PowerShell host. Root verifies all 1,026 local documentation targets. New committed-source verification remains. SSO expires before the next metric read at `06:13:53Z`; renewal requested, with no new deployment or recovery resource. | D2-038, D2-043, D2-044, D2-045; D2-R15, D2-R19 | [Expiry repair](#d2-044--exact-version-export-expiry), [workload corroboration](#d2-045--development-workload-corroboration) |

| 2026-09-10 | Exact committed `e2714ca3753c40746944978c1ad858271f3a4d5f` passes the full maintained verifier and all 20 build tasks, then is pushed to shared main with Actions skipped. D2-045 inspector implementation is Complete; D2-044 is locally verified but still requires corrective deployment and scheduled health. Existing phase/master documents retain the remaining scope and one decision record. The reviewed current-source invocation wrapper has no historical source/receipt defaults; no new runtime, IAM, retention, provider, reviewer, restore or replay change occurred. AWS renewal remains the next deployment input. | D2-043, D2-044, D2-045 | [Verified adapter](../../../backend/workflows/src/candidate-rights-aws.ts), [verified inspector](../../../scripts/inspect-staging-workload-and-cost.ps1), [remaining inputs](#remaining-acceptance-and-operator-inputs) |

| 2026-09-10 | Renewed SSO passes at `13:23:50Z`. Corrective core source `31051e1` is published, paused/drained and released once, followed by exact computed-parent state-only reconciliation and mapping-only Resume. State `315` verifies unpaused and durable/activity/terminal `13`, zero changes. Positive activity health is `4/0/0`; all 57 managed alarms are OK. D2-044/R15/R19 are closed. The subsequent role plan refuses native computed prefix/omitted binding metadata before Platform Apply; its unused bootstrap allowance is removed and verified at state `15`. No role, executor, PITR copy or replay exists. D2-046's narrow guard/tests are integrated without branches; native plan semantic reading now passes offline. Committed-source verification and the authorized drill remain. | D2-038, D2-044, D2-046 | [Deployed health](#d2-044--exact-version-export-expiry), [operator repair and cleanup](#d2-046--fixed-name-restore-role-metadata) |

| 2026-09-10 | Exact committed `2343514860a6a74cb1437c2137897d10e2b921e4` passes the full maintained repository verifier and all 20 build tasks (19 cached). D2-046 is Complete for operator implementation. Two-host 479-assertion regressions and the actual native diagnostic plan pass without changing original evidence. Only documentation changes follow this verified code. Proceed with fresh plans and a twice-built standalone replay artifact; do not republish the unchanged application runtimes. | D2-046; D2-038 | [Operator fix](#d2-046--fixed-name-restore-role-metadata), [remaining acceptance](#remaining-acceptance-and-operator-inputs) |

| 2026-09-10 | Fresh `bf49c69` activation applied the temporary role once at Platform `316`, then verification rejected native empty-tag/identity metadata despite zero configuration changes. Preserved the original successful Apply and failed verification. Exact unused cleanup removed the role/child and restored two endpoints, verifying Platform `317`; maintained Bootstrap cleanup verifies `17`, with all temporary permissions off. No executor, PITR or replay ran. Reopened D2-046 only for the bounded maintained guard/tests follow-up before regenerating source-bound recovery evidence. Core runtime and provider/reviewer scope are unchanged. | D2-046; D2-038 | [Native follow-up and verified cleanup](#d2-046--fixed-name-restore-role-metadata) |

| 2026-09-10 | Exact integrated `ca6c434d4b02561a67aa3929ad308fbffc71c666` passes the full maintained verifier and all 20 build tasks (19 cached). Both PowerShell hosts pass 908 generated assertions; independent review and actual zero/Disable native-plan replay preserve original state/evidence. D2-046 is Complete for tooling. Only these two delivery documents change after verification; proceed with fresh source/state-bound baselines and the standalone replay artifact. D2-038's actual cloud drill and remaining human/provider/owner gates are still open. | D2-046; D2-038 | [Verified follow-up](#d2-046--fixed-name-restore-role-metadata), [remaining gates](#remaining-acceptance-and-operator-inputs) |

| Date | Work completed | Tasks | Evidence |
|---|---|---|---|
| 2026-09-10 | Candidate-only `7bf510e` deploys READY at the existing approved Vercel project/stable origin. The exact 128-file upload and five credentialless HTTP checks pass, including authenticated-detail refusals and security headers. D2-047 is Complete for implementation/deployment; owner publication and human acceptance remain separate. Bootstrap `20`/Platform `320` temporary permission Enable verifies, followed by one private PITR whose 44 migrations/68 relations/six contributors and aggregate digest match. No repeated structural restore is needed. | D2-047; D2-038; D2-020 | [Website delivery](#d2-047--authenticated-website-job-details), [actual structural restore](#d2-038--isolated-deletion-recovery) |
| 2026-09-10 | Executor Create runs once, then the qualified-response Tags omission prevents the success receipt before any inspection/replay. Actual independently bound ListTags and canonical configuration match. A separately reviewed exact-target cleanup bridge disables the original unused function, waits the full 330 seconds and confirms deletion; immutable artifacts, original evidence and the verified RDS copy remain. Integrated D2-049 reads real tags, handles genuine unset cleanup concurrency and checks numeric event mappings. Actual maintained tests pass 448 assertions independently; full committed-source verification and a reviewed corrected-source executor follow. No new branches or healthy-application rerelease. | D2-049; D2-038 | [Cause, repair and bounded recovery](#d2-049--recovery-executor-metadata), [maintained operator tests](../../../scripts/tests/candidate-deletion-replay.tests.ps1) |

| Date | Work completed | Tasks | Evidence |
|---|---|---|---|
| 2026-09-10 | Exact `92c1fc2` passes full committed-source verification, all 20 builds and the maintained 448/908 executor/role assertions. Two standalone builds match, and corrected Create returns a genuine receipt. The first Inspect then refuses at runtime; no Replay is issued. Positive exact-role decrypt/secret calls narrow the failure, while offline contracts and bounded retained-marker metadata checks pass. Maintained Cleanup drains and removes the exact executor before source edits; the same verified RDS copy and original artifacts remain. D2-049 is Complete; D2-050 adds private closed-stage diagnostics, with 60 tests/typecheck/formatting passing, and investigates SDK-envelope compatibility. | D2-049; D2-050; D2-038 | [Runtime failure and limits](#d2-050--private-restore-runtime-compatibility), [handler tests](../../../backend/workflows/src/candidate-deletion-restore-lambda.test.ts) |
| 2026-09-10 | Exact `37ea0ff` passes the full maintained verifier, 697 workflow tests (six explicit database opt-ins skipped) and all 20 builds (18 cached), then is pushed to shared main. Both final standalone builds match; 47 unrelated Lambda artifacts and ten archived files remain unchanged. New preparation fails before packet/executor creation; an independent STS check confirms expired AWS SSO. No Replay runs. Preserve the same verified private restore and temporary permissions pending renewed session, corrected-source inspection and exact cleanup. Reopened D2-R15; only the existing two delivery documents change after verification. | D2-050; D2-038; D2-R15 | [Verified implementation and resume point](#d2-050--private-restore-runtime-compatibility) |
| 2026-09-10 | Renewed SSO closes R15. Actual `01732ad` Create succeeds, but the single Inspect refuses at `store_preflight`; no Replay. Maintained Cleanup `57506` fully drains/removes the exact executor, retaining the same verified copy. Before builds, five original artifacts are archived owner-only without changing other artifacts. Integrated D2-050's fixed branded reasons (95 tests) and D2-051's authoritative retry timestamps (30 tests; 13 expected original-source failures). The actual isolated PostgreSQL restore/export/rollback suite passes 5/5 after rebuilding 11 dependency workspaces. No live database, document, marker, Auth0 or ordinary application release is changed. Full committed-source verification and cloud continuation remain. | D2-050; D2-051; D2-038 | [Private diagnosis](#d2-050--private-restore-runtime-compatibility), [retry regression](../../../backend/workflows/src/candidate-deletion-restore-store.integration.test.ts) |
| 2026-09-10 | Exact `fa01d53` passes the full maintained verifier, 721 workflow tests (seven explicit database opt-ins skipped) and all 20 build tasks (17 cached). The separate actual PostgreSQL run passes 5/5. Exact generated tmpfs container cleanup and Docker/WSL shutdown complete without user-data/volume removal. D2-050 and D2-051 implementation is verified; cloud diagnosis/replay, corrective Gateway/core releases and final cleanup remain. Only the two existing delivery MDs change after verification; no new branches or GitHub Actions changes. | D2-050; D2-051; D2-038 | [Runtime diagnosis](#d2-050--private-restore-runtime-compatibility), [verified retry fixes](#d2-051--deletion-retry-timestamps), [maintained verifier](../../../scripts/verify-phase0.ps1) |
| 2026-09-10 | Actual `9b608ac` has matching standalone artifacts, independently reviewed preparation and successful Create. Single Inspect `24050` refuses; bounded diagnostic `666332` identifies `store_preflight` / `CompletionCollision` after connection and initial SQL reads. The exact failing comparison is unknown; no Replay or historical mutation runs. Cleanup `88848` confirms the exact executor absent after full drain. Its immutable artifact and five byte-identical private files are retained with the same verified RDS copy and `320`/`20` permissions. D2-052/D2-R20 record the new conditional historical correction decision; D2-051 future-writer releases remain separate. Docker/WSL are confirmed off and the PC stays running. | D2-038; D2-050; D2-051; D2-052 | [Historical completion blocker](#d2-052--historical-completion-consistency), [fixed store guards](../../../backend/workflows/src/candidate-deletion-restore-store.ts), [maintained cleanup](../../../scripts/operate-development-candidate-deletion-replay.ps1) |
| 2026-09-11 | Gateway `423d63b` is published, applied and verified with zero drift at `321`. Core mapping-only Pause applies/verifies at `322`; first metadata inventory has 23 historical executions, none running and no start/end in 24 hours. Approximate empty queues and absent metrics are not business recovery or writer-exclusion proof. The un-applied core release plan is retained as superseded to include the newly confirmed late-terminal enqueue fix; actual Profile tests pass 41/41 and typecheck passes, with eight expected original-source failures. No historical tag correction, SQL/body/document/Auth0 write, Replay or repeat PITR runs. The read-only diagnostic, exact-version helpers and internal contracts now pass 785 focused tests/697 operator assertions; six real PostgreSQL cases prove unchanged-row diagnosis and completed-operation no-extra-outbox. Full maintained verification passes 1,146 workflow tests/eight explicit DB skips and 20 builds/17 cached. Generated tmpfs data/container are removed; no user volumes touched, Docker/WSL stopped. Fresh combined release, diagnosis and cleanup remain. | D2-051; D2-052; D2-038 | [Retry fixes](#d2-051--deletion-retry-timestamps), [historical diagnosis](#d2-052--historical-completion-consistency) |
| 2026-09-11 | Corrective core `2ff32ef` is released, state-only reconciled and resumed at `328`/versions `14` with zero drift, completing D2-051's code/deployment boundary without claiming a real concurrent SQL race. Same-copy Prepare `4799`, Create `50475` and DiagnoseCompletion `36727` pass; persisted request/ledger/operation completion agrees and differs from the tag, with three acknowledged/unclaimed dispatches and zero writes. Repair `45914` / `a9336e` passes its first writer/retirement pass, reserves attempt `1`, then refuses the second metadata read before Put. Exact `00fadf` readback confirms the original preimage/tags; the journal is preserved. A later two-pass read-only repetition succeeds but neither reproduces the cause nor renews authority. D2-053/R21 gate any further write. Disable `8510` and full-drain Cleanup `27423` confirm exact executor absence, retaining its artifact. Same PITR/temporary permissions remain; no Replay or historical mutation. | D2-038; D2-050; D2-051; D2-052; D2-053 | [Historical diagnosis and retained evidence](#d2-052--historical-completion-consistency), [retry deployment](#d2-051--deletion-retry-timestamps), [new blocker](#risks-and-blockers) |

## Decisions and scope changes

For D2-054 on 2026-09-11, treat asynchronous client results as valid only for their originating
session or reviewed case. Logout/new login invalidates pending credential and delivery commits;
one rotating refresh token gets one shared in-flight exchange. Queue/filter/case/version/purpose
changes invalidate manual evidence and destructive confirmation. This prevents stale UI/network
work from carrying authority into another account or decision. It adds no permission, automatic
case decision, submission retry or deployment activation; server checks remain unchanged.

Outcome of the separately authorized D2-052/D2-053 path (`2026-09-11` UTC): corroborated
evidence and fresh checks permit exactly one completion-tag correction, which verifies without
resetting the original journal or changing the corrected normal runtime. Retain both linked
reservations with no resend. The same-copy strict already-reconciled Replay and all cleanup
now pass. This closes the bounded recovery, not fresh nonempty deletion, owner publication,
human/provider acceptance or Phase 2; no broader data/IAM authority is inferred.

For D2-053 on 2026-09-11 UTC, the user's subsequent approval permits a separate pre-dispatch
recovery entrypoint, not resetting the original journal. Bind the original exact file bytes,
old diagnostic decision, authenticated completed zero-dispatch execution and explicit authority;
an unchanged tag or a result-shaped JSON object alone is insufficient. A fixed linked companion
record preserves the original and prevents a second recovery send across process restarts.
Require the same full preimage and intended tag even when fresh diagnostic/source hashes differ.
Keep both fresh writer checks, the original proof lease and one-send/readback-only ambiguity
rules. This repairs the interrupted operator path without expanding data or IAM scope.

For the same D2-053 implementation, bind the fresh local recovery/diagnostic source separately
from deployed workflow source `2ff32ef`. The recovery entrypoint is a local operator capability;
it does not require changing the already-corrected deployed workflow. A fresh native zero-drift
plan must retain the actual runtime artifact sources, versions and complete controls. Explicit
operator/runtime source fields preserve both provenances through the writer and retirement
checks; never relabel a retained artifact as the new source or relax runtime equality checks.
Preserve the original five standalone artifacts and five emitted repair dependencies in
owner-only copies before rebuilding, along with the original helpers and journal bytes.

For D2-052/D2-053 on 2026-09-11 UTC, preserve the stable one-attempt reservation after the
proven pre-dispatch refusal. No Put was dispatched; do not mislabel this as an ambiguous write.
An unchanged readback or later successful metadata run cannot reset the journal, renew writer
proof or authorize another attempt. Any further write requires a separately reviewed pre-dispatch
recovery design and explicit authority, retaining the original target, complete preimage,
immutable evidence and fresh writer checks. Keep the same private restore and read-only replay
role pending that decision; do not repeat PITR or relax normal inspection/replay.

For D2-051/D2-052 on 2026-09-11 UTC, keep the verified mapping-only pause while integrating the
newly demonstrated late-terminal enqueue fix. The existing baseline-capture operator accepts the
unchanged earlier-source zero-drift seed and binds a fresh baseline to the next clean merged
source, retaining every input and actual state. Use a new source-bound publication and reviewed
release plan; never rewrite or apply the superseded plan. This includes both workflow fixes in
one deployment without relaxing source, artifact, state or drain checks. Diagnostic transport
remains distinct from inspection approval and does not add cloud-write permissions to replay.

For D2-052 on 2026-09-11 UTC, accept the user's conditional exact-version historical tag repair
approval. The reason is to correct proven historical metadata while preserving the strict restore
validator and immutable evidence. Matching persisted request/ledger timestamps and bound operation
evidence must prove the replacement; an attempt or workflow-end clock is not a substitute. Retire
old writers and recheck the exact complete preimage before a single version-qualified tag write.
No SQL, marker-body, confirmation, retention, document, Auth0 or other-marker change is authorized.
An ambiguous result requires exact-version readback, never blind resubmission or rollback. Keep
the replay executor read-only in AWS and reuse the existing private restore.

For D2-052 on 2026-09-10, keep the proven completion-state conflict distinct from a proven wrong
tag or proven retry-bug cause. The original restore approval is unchanged and still forbids
historical completion-tag edits. Request a conditional, exact-version correction decision rather
than silently changing data or weakening checks. Preserve the same verified copy and evidence;
remove each temporary executor after use. No historical mutation is authorized by this record.

For D2-051 on 2026-09-10, use journaled confirmation and persisted completion timestamps across
retries, rather than later attempt clocks. This preserves the existing recovery identity instead
of relaxing collision checks; any historical live-marker inconsistency requires a separate bounded
repair decision. D2-050 may additionally report only existing fixed store refusals branded by a
private identity map, never inspect arbitrary thrown values or log their properties.

For D2-050 on 2026-09-10, diagnose the attempted runtime boundary with fixed action/stage enums,
not raw exceptions, secret envelopes or SQL output. A service-success event narrows execution but
does not prove the final cause or successful inspection. Test documented SDK serialization
separately while keeping secret identity, current-version, target-only and rejection guards intact.
Reuse the verified restore after exact executor cleanup; never extend a failed packet, repeat
PITR, or label an unvalidated response as replay acceptance.

For D2-049 on 2026-09-10, obtain tags from the real function-level AWS endpoint after binding
the exact numeric identity. Expected tags are assertions, not substitute observations. Preserve
the original failed packet and use a distinct, honestly recorded cleanup bridge because the
old operator's same read defect also blocks cleanup. After full drain/removal, a corrected-source
executor may reuse the same verified RDS copy: no replay was attempted, and repeating PITR or
rereleasing healthy applications would not address the defect. Do not extend the old expiry or
claim an unobserved successful Create. Keep genuine empty concurrency distinct from malformed
responses and check numeric-version event mappings as well as the bare function.

For D2-047 on 2026-09-10, make full job detail an explicit authenticated search action over the
existing Jobs API. Do not depend on anonymous publication or automatically fetch employer pages.
This closes a real candidate navigation gap while keeping public indexing and provider scope
unchanged. Reuse the existing contract, BFF/session conventions and browser harness; descriptions
remain plain text and verification timestamps are historical observations, not live guarantees.

For D2-048 on 2026-09-10, preserve process-variable absence explicitly instead of treating null
and empty as interchangeable. Only the inspector's touched variables may change during cleanup.
Test the actual cleanup code on both supported PowerShell hosts, and remove unused recovery
authority before integrating the repair. This resolves the reproduced preflight failure without
loosening Terraform checks, adding permissions or rereleasing healthy application artifacts.

For D2-046 on 2026-09-10, handle Terraform's computed prefix as typed metadata, not naming
authority: preserve exact fixed IAM names, permit only omitted/null or empty-string observations,
and accept Boolean prefix masks only on the two new resources. Reject malformed or contradictory
metadata. Remove unused temporary permissions before changing source, then regenerate the plans
and standalone replay artifact; no application rerelease is needed for this operator-only fix.
This keeps the correction maintainable and bounded to the actual native plan incompatibility.

The D2-046 follow-up treats exact empty-tag/sensitivity pairs and account/name/role-bound
identities as native provider metadata, not a permission to ignore drift. Normalize only a
validation copy; preserve every original plan and receipt. Remove successfully applied but
unused authority before editing source, using a distinct cleanup result rather than inventing a
normal activation verification. Bind the immutable state-object version and actual managed values,
not arbitrary serialization order. This fixes the observed incompatibility without adding a
generic approval framework, widening IAM or rereleasing the application.

For D2-044 on 2026-09-10, use S3's positive exact-version DELETE acknowledgment to complete
export expiry. The follow-up absence HEAD is incompatible with the existing least-privilege
role, and repeated exact-version deletion is confirmed on a generated object. Keep IAM and
retention unchanged instead of adding bucket-list authority. An unsuccessful DELETE never
proves absence. Release verification must observe the normal schedule, without forcing alarms
healthy, manually processing candidate data or treating this diagnostic as lifecycle acceptance.

For D2-045 on 2026-09-10, extend the existing inspector with named development profiles rather
than reinterpret historical evidence. Bind successful aggregate schemas, cleanup and timestamps
before cloud reads; distinguish required metric coverage from inactive-worker unknowns. A
processing run may have transient queued work, but must have bounded settled post-run queues.
These checks corroborate aggregates only; they do not prove owner attribution or capacity.

For D2-043 on 2026-09-10, preserve native timestamp spelling and compare only declared root
Booleans across their exact native/string representations. Keep other types strict and require
the current outbox pause input to be false before steady-state inspection. A separate restore-only
guard recognizes only the deprecated parent-role snapshot becoming its exact independently checked
child policy, including the final exact removal path. This resolves verifier incompatibilities
without changing permissions, accepting unrelated drift, rewriting evidence or adding another
state-only apply. Generated observation tests do not claim actual cloud recovery.

For D2-042 on 2026-09-10, convert timestamps only at the Trust SQL binding boundary. This corrects
the actual shared Profile/Drizzle client composition without changing the Date-valued domain API,
resetting a global serializer, adding SQL migrations or weakening authorization/error handling.
Ordinary/shared-client regressions and actual accepted/version-2 readbacks support this choice.

For the `2026-09-10` Resume, preserve the original verified receipt and source when PowerShell 7
deserializes JSON exit code zero as `Int64` rather than the frozen guard's `Int32`. Its failed
preflight created no saved plan or Apply. The already-supported Windows PowerShell 5.1 path
with portable Terraform 1.16.2 completed Resume Plan/Apply/Verify against the unchanged evidence.
The narrow integral-zero repair and actual JSON-roundtrip regressions are now integrated and
pass 228 assertions on each explicit host; full committed-source verification now passes at `e2e730a`.
Never alter evidence to satisfy a host-specific
CLR type check or relax another binding. The default-off outbox-start pause and exact maintenance
dispatch permit a controlled rights release while preserving queued work and completion paths;
the shared-NAT guard accepts only the separate active D2 topology with all ingestion flags false.
These follow-ups do not activate providers or authorize new candidate/reviewer actions.

For the September 9 coordinated release, keep the verified pause cutoff intact while deploying
compatible D2 workers and Gateway before the final migration baseline. Disabled handlers make
this ordering safe before SQL, and it prevents migration verification from proposing an artifact
reversion. Wait the actual async retirement horizon; do not delete historical versions or treat
approximate queue counters as a purge. Keep one release source through publication and Resume.
Stage the separately bundled rights/export and dark-ingestion fixes after Resume because their
pins are included in the pause authority. Reuse maintained publishers and reviewed Terraform
release procedures rather than replaying initial activation operators. Reuse exact server
descriptors in the authenticated workload runner so the test tool supports implemented providers
without enabling them or weakening disposable-account, preview, timing or cleanup boundaries.

For the D2-040 follow-up on 2026-09-09, reconcile only the saved plan's sensitivity metadata after
confirming full resource-value equality and Terraform 1.16.2's provider-call bypass for that exact
case. Do not declassify data, ignore changes, rewrite state manually, apply the refresh-only
diagnostic, or alter budget settings. Recognize only literal boolean/`true`/`false` representations
for the new restore-role input because Terraform retains raw `TF_VAR` strings in plan JSON;
all other input comparisons remain exact. The reviewed apply and zero-change readback close R18.

For D2-039's coordinated rollout, prefer a default-off maintenance switch over removing runtime
activation. This preserves queues, IAM, network, provider and reviewer settings and keeps D1/private
capture available. Old immutable versions keep their old code and environment, so zero reservations
must persist through the existing async-retention horizon after verified disabled-alias cutover.
Keep this six-hour-plus-runtime fence rather than delete historical versions or assume that a
new retry setting purges accepted work. Database changes and new artifacts may be installed while
paused after running invocations drain; resume only the compatible release. For this rollout, run
the migration near or after the retirement deadline so its stopped ECS task remains independently
describable during resume; AWS guarantees that readback for at least one hour, not the full six-hour
wait. Preserve the original pause receipt across reviewed descendant source releases; any
out-of-band alias, trigger or reservation mutation invalidates its cutoff and requires a fresh
full-window pause. Metrics alone cannot establish uninterrupted fencing. These are deployment
mechanics, not a new user-facing contribution-policy renewal requirement.

For D2-039 on 2026-09-09, refresh stale unpublished initial-review evidence through the existing
bounded scheduler and append new independent provider proof. Preserve the submitted preview and
all original evidence. Enforce the existing reviewer's 24-hour/future-time limit in the backend
and bind publication to the exact accepted proof, because client-only checks permit stale catalog
truth. Keep terminal cases held rather than inventing another decision or changing accepted evidence.
Use actual verification/withdrawal/lifecycle clocks, not processing arrival time, to prevent older
or equal-time conflicting observations from replacing newer truth. Exact repeats must be no-ops;
genuine duplicate contributions retain their histories and share one canonical posting.

For the D2-039 regression suite, initialize built Profile and Jobs migrations before any Jobs
integration file, using only an explicit loopback database target and an OS-only child environment.
Exercise the real bounded queue through multiple batches when other generated fixtures precede
the target, and require exhaustion for absence assertions. This removes execution-order and
first-page false-negative assumptions without changing production eligibility, retry budgets,
ownership or database guards.

For D2-041 on 2026-09-09, correct the shared export contract to include already-implemented D2
owner projections. Use additive optional v1 sections so historical exports remain valid, but keep
strict nested schemas rather than accepting arbitrary SQL output. Test actual seven-owner workflow
assembly with nonempty generated data, because isolated owner tests had missed the composed
validation failure. This adds no collection, public exposure, identity-provider permission or
private-save control to the extension.

For D2-040 on 2026-09-09, stop cloud planning when effective backend locking is absent, even if
ordinary initialization reports success. A provider dependency lock is not a state lock. Prefer
an isolated, verified current deployment binary with one explicit pin and fresh plans; retain the
old binary solely to read historical plans. Preserve the backend, provider versions, historical
receipts and excluded GitHub Actions. Resolve the skill's incompatible 1.9.8 instruction explicitly
before executing this toolchain transition. Do not request the already granted recovery-drill
approval again.

The user's subsequent 2026-09-09 approval selects exact portable Terraform 1.16.2 for current local
deployment, with 1.9.8 confined to explicit historical `show`. Use a process-local selector and
signature/checksum-verified installation instead of replacing the machine toolchain. Check the
effective cached backend after initialization, since a successful init or provider lock says
nothing about state locking. Keep historical evidence immutable, regenerate current plans from
reviewed inputs, and leave GitHub Actions excluded and unchanged as requested.

For D2-038 on 2026-09-08, use the bounded restore-only design recorded above, not the live
candidate-rights mutation role or a migration-task command override. This keeps disaster-recovery
reconciliation available without granting the drill Auth0, export, cloud-object deletion or ledger
rewrite powers. Keep all rationale in this phase document, as the user requested.

For the 2026-09-08 reviewer continuation, accept the user's fresh authority for the already
assigned development initial/takedown work while preserving the original encrypted setup as
history. Do not attach this authority to the removed contribution-policy expiry or seek recurring
approval for the same unchanged assignment. Auth0's observed API-access refusal is a separate
provider configuration issue: restore only the existing agent's exact three-scope client grant,
not its own identity-administration rights, the human appeal grant, or a tenant-wide permission.

For D2-036 on 2026-09-08, maintain one generated-only logical recovery command because a fresh
migration/replay and a schema inventory do not test recovery of saved data. Use actual dump/restore,
owning-runtime database clients, exact row comparison, and restored behavior; retain only
aggregates and clean up only the exact generated container. Shared-cluster roles keep this a
bounded local regression, not a substitute for separately scoped cloud recovery acceptance.

For D2-035 on 2026-09-08, use fixed provider descriptors with independent explicit development
selection rather than widening the existing Greenhouse descriptor. This preserves its immutable
digest and already-prepared operations while allowing each provider to be disabled independently.
Add a forward migration for the two new exact lease pairs instead of rewriting applied SQL.
Absent configuration remains Greenhouse-only, and the unchanged default emits no extra Lambda
environment key. Representative page/API acceptance and exact registrations still precede wider
activation; implementing the descriptors alone is not evidence that provider extraction matches.
No signing, remote contribution-policy service, recurring approval deadline, reviewer-role change,
production activation, or store distribution is introduced.

On 2026-09-08 the user requested removal of the policy machinery because repeated expiry and
renewal obstruct development. This supersedes the pending renewal request before any signing or
renewal occurred. D2-033 replaces the development contribution capability envelope with persistent
opt-in development configuration: no signing keys, remote policy request, expiry, or recurring
approval window. The setting is rejected outside development and in extension-store packaging.
The accepted scope remains client `0.2.0`, Greenhouse `greenhouse-board-v1`, and its two reviewed
hosts. Authentication/MFA, account isolation, explicit preview addition, provider verification,
Trust decisions, and publication integrity are separate controls and remain enforced. A short
automatically refreshed publication-operation lease prevents stale concurrent writes without
requiring user renewal. The signed mode remains compatible for default/staging/production use;
this change is not public-launch or store approval. This section is the single decision/rationale
record for the change.

The deployment attempt also found an unrelated expired exception for the deferred mobile
`image-size@1.2.1` parser. The published package still has no patched version for the
[HEIF/JXL](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and
[ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) infinite-loop advisories. The recommended
next step is a small, tested local dependency patch with bounded parser progress and exact patched
artifact verification in the audit. This is a proposed additional security remediation, not an
approved date extension, scanner bypass, Expo upgrade, or completed fix. Obtain direction before
vendoring that third-party patch; keep existing mobile/public-launch restrictions meanwhile.

The user subsequently approved that recommended local security patch on 2026-09-08. D2-034
implements only the vulnerable parser progress/bounds checks and exact dependency/audit/build
integration needed to resume D2-033. Preserve the pinned Expo/Metro versions and all unrelated
advisory failures; this approval does not extend the expired exception or approve mobile launch.

The 2026-09-08 setup uses a local-only server action to compare the actual authenticated human
with the separately collected assignment identity before granting roles. A page title or accepted
MFA session does not establish that identity/scope match. Keeping tokens and raw claims inside the
existing admin boundary, with only a private one-way binding result, avoids copying credentials
through chat or borrowing the human session for agent case decisions. The finite local action is
disabled by default and on hosted Vercel; it grants no authority and leaves contribution-policy
renewal separate. The user authorized only development appeal/read setup; source, timing, scope,
role, receipt, state, and plan guards remain mandatory for its separate deployment.

`pnpm check` passes for application source `3f20462` and configuration source `7420dfa`; the final repository verifier
(`scripts/verify-phase0.ps1`) also passed for the unchanged application source `116b272`
after the token-test correction:
contract generation, infrastructure/operator guards, formatting, lint, all 33 typecheck tasks,
all 34 unit-test tasks, all 20 build tasks, offline Compose validation, and product-scope checks.
These are local checks; deployed migration, human review, and publication evidence remain distinct.

| Date | Decision or change | Reason | Evidence |
|---|---|---|---|
| 2026-09-06 | Accept the product owner's delegation of initial/takedown decisions to Codex and reserve appeals to the product owner's distinct human identity, using the exact least-privilege assignments in the reviewer section. Keep the existing case opener unchanged. | Implements the user's selected division of responsibility without impersonating a human, borrowing the appeal session, self-resolving adverse decisions, weakening human MFA, or granting identity administration. Agent decisions must use current independent evidence and existing versioned/audited APIs during an authorized task; this does not introduce unattended review, verified-requester/legal authority, new provider scope, policy renewal, or production/store approval. | User assignment; [delegated reviewer assignment](#delegated-reviewer-assignment); existing issuer/subject role enforcement; activation blocked under D2-030 |
| 2026-09-06 | Add an explicit appeal-only admin request/presentation profile while preserving the existing standard profile when unset. Keep exact server roles/scopes and all human MFA/session/evidence controls authoritative. | The product owner is only the independent appeal reviewer. Asking that login for initial/takedown/moderator scopes would contradict the selected least-privilege split; removing those requests and controls avoids granting unnecessary permissions. Profile selection never creates an assignment or proves a human session. | [Admin identity configuration](../../../frontend/admin/lib/auth0.ts), [Trust console](../../../frontend/admin/app/trust-console.tsx), [local setup](../../../scripts/configure-auth0-admin-local.ps1); delegated reviewer assignment above |
| 2026-09-05 | Bind the enabled standard-SQS Trust mapping's maximum concurrency to its reviewed function reservation, requiring two through five; use two in development and leave the scheduled worker at one. Keep alarm thresholds and partial-batch retry unchanged. | Two signals processed successfully despite one real throttle with reservation one and an uncapped poller. AWS supports a minimum mapping maximum of two and requires sufficient function reservation. The receive-only handler processes records sequentially through one shared connection per invocation, so this change adds at most one actively processing Trust database connection; it adds no provisioned concurrency or always-on replica. | [AWS SQS scaling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html), [Trust runtime](../../../backend/workflows/src/d2-community-runtime.ts), [Terraform mapping](../../../infrastructure/terraform/modules/platform/community-runtime.tf); eight mocked Terraform tests pass; configuration `7420dfa` is deployed at state `283` with exact mapping/reservation `2`, unchanged alias `11`, and zero drift |
| 2026-09-05 | Recover the successful migration task using its release-source-bound exact aggregate messages; never rerun a successful migration merely to satisfy an outdated log allowlist. | The current six-owner package emits seven success messages, while the older operator expected six Phase 1 messages. Exit 0 and exact current-source messages were independently read back; historical image recovery must retain its own exact contract and reject extra or duplicate events. | [Migration operator](../../../scripts/operate-development-document-migration.ps1), source `116b272`, existing stopped task and aggregate-only readback |
| 2026-09-05 | Reconcile only the observed three route request-model defaults, the auto-deployed stage identifier, and the existing RDS restore clock through a reviewed refresh-only plan with zero cloud resource actions. | Terraform's refresh-only JSON puts refreshed resources in `prior_state` rather than its empty planned root. Validate all 359 resources and outputs against the retained readback, allowing only the exact five changes; do not broaden general drift guards. | State `277` to `278`; refresh-only plan `7fa8419c6f45b9e96bc4d566bc624125f144e7e1673ce2609e9a5547b295b4d9`; fresh zero-change plan `5a147164a1d34a6182a0a443a29e2b1f4b872d019a939b283d0196e4772706d4` |
| 2026-09-05 | Before exposing cancellation, observe two ordinary post-cutover scheduled ticks on the new version, old-version quiet beyond its actual timeout plus 30 seconds, and corroborating async and queue metrics. | Alias updates and async retries require more than an elapsed timer. Missing metric series are not zero; the pre-cutover scheduled 85 invocations reconcile to 72 alias and 13 numeric-qualified calls, and the Trust input/DLQ attributes are separately observed empty. A known retry backlog or late old-version execution holds the cutover. | [AWS async retries](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html), [Lambda metrics](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html); aggregate-only pre-cutover observation |
| 2026-09-05 | Use distinct schema 7 for current Gateway-to-migration baselines, retain original document-release identity, and validate source trees with two fresh batch snapshots. | Historical bootstrap and current capture must not share incompatible schema meanings. Preserving exact state, receipt, artifact, parser, and canonical source-delta checks permits current deployment without inventing new document provenance; batching avoids thousands of redundant Git processes without caching authority. | [Shared baseline guard](../../../scripts/lib/development-current-document-baseline.ps1), [adversarial and round-trip tests](../../../scripts/tests/development-current-document-baseline.tests.ps1) |
| 2026-09-05 | Deploy migration `0020`, upgrade both D2 workers and allow old invocations to drain, then expose the updated Gateway cancellation implementation. | An old in-flight verifier does not implement the new cancellation marker lock. Exposing cancellation before draining old workers could falsely promise that work cannot proceed; schema compatibility alone is insufficient. Route creation before code remains JWT-protected and fail-closed. | [Jobs verification/cancellation lock](../../../backend/services/jobs/src/persistence/contribution.ts), [queue handoff](../../../backend/services/jobs/src/persistence/contribution-processing.ts) |
| 2026-09-05 | Recheck authoritative Trust decision rows atomically when a claimed item parks for `trust_pending`, using the same decision-copy lock. | A decision signal can arrive while work is still claimed and otherwise be lost immediately before parking. Accepted, rejected, withdrawn, and taken-down decisions must survive this handoff; provider-only nudges must not lift a hold. | [Queue persistence](../../../backend/services/jobs/src/persistence/contribution-processing.ts), [ten PostgreSQL processing regressions](../../../backend/services/jobs/src/persistence/contribution-processing.integration.test.ts) |
| 2026-09-05 | Commit the Jobs cancellation barrier before exact Profile authorization revocation, sharing the verification lock and retrying only the same authorization. Keep post-verification removal under Trust. | A permanent barrier prevents publication even when revocation acknowledgement fails; releasing the Jobs transaction before Profile work also avoids exhausting the Gateway's two-connection pool. Immutable intake and Trust history remain intact. | [Cancellation integration](../../../backend/gateway/src/contribution-cancellation.integration.test.ts), [Jobs persistence](../../../backend/services/jobs/src/persistence/contribution.ts) |
| 2026-09-05 | Add a bounded reviewer queue with Jobs-owned plaintext evidence, exact case/version/digest checks, and unchanged distinct reviewer roles. | Reviewers need discoverable cases and readable independently fetched evidence, not manually pasted opaque hashes. Public evidence must not expose contributor identity or let a stale decision bypass authority. | [Trust queue](../../../backend/services/trust/src/review-queue.ts), [admin console](../../../frontend/admin/app/trust-console.tsx) |
| 2026-09-05 | Track the actually consumed terminal Trust decision and wake completed Jobs work only for a new actionable authoritative decision. Deploy forward migration `0020` first. | Later withdrawal, takedown, and appeal reversal must reconcile prior terminal processing, while ordinary provider nudges, old accepted replay, and dead work cannot revive removed publication. | [Migration](../../../backend/services/jobs/migrations/0020_contribution_trust_reprocessing.sql), [composed lifecycle](../../../backend/workflows/src/d2-community-lifecycle.integration.test.ts) |
| 2026-09-05 | Compare the frozen v1 preview only against exact provider-derived safe `textContent` variants, including Greenhouse's dollar-range em-dash-to-spaced-hyphen representation. Preserve all words, amounts, other punctuation, and full publication truth. | The public page and API differ at block boundaries and dollar-range separators; broad punctuation folding, fuzzy matching, or arbitrary excerpts would weaken independent verification. Compatibility hashes are bounded, private, version-specific, and bound to the exact fetched observation object. | [Paired positive/adversarial tests](../../../backend/workers/ingestion/src/greenhouse-preview-verification.test.ts), [compatibility helper](../../../backend/workers/ingestion/src/page-preview-compatibility.ts) |
| 2026-09-05 | On explicit user approval, renew only the existing Greenhouse development policy for 24 hours, retaining its signing key, client `0.2.0`, exact variant, two domains, and intake/processing flags. Change no code, Trust role, provider registration, production, or store boundary. | Restores the already authorized development workflow after expiry without silently widening its scope or making its exception permanent. The new issuance is 2026-09-05T19:24:54.670Z and expiry is 2026-09-06T19:24:54.670Z. | User renewal approval; [policy signer](../../../scripts/operate-development-d2-contribution-policy.mjs); renewal work-log entry |
| 2026-09-05 | Freeze narrow compatibility for `d2-job-page-v1`: exact provider name plus logo-label suffix, the same control/markup stripping and 12,000-character description boundary, and removal of one exact repeated leading heading. Preserve the complete independently fetched provider observation for publication. | The installed reader already performs these transformations. Matching an exact independently derived representation avoids false holds without accepting arbitrary excerpts, unrelated company aliases, changed selected content, or rewriting immutable submissions. Other adapter versions do not inherit this compatibility. | [Reader](../../../frontend/extension/lib/page-inspection.ts), [capture sanitizer](../../../frontend/extension/lib/job-capture.ts), [positive and adversarial regressions](../../../backend/workers/ingestion/src/contribution-verification.test.ts) |
| 2026-09-05 | Preserve provider-owned `company_name` when supplied and parse bounded encoded description HTML using pinned `entities`/`parse5`, already present in the lockfile, without executing scripts or fetching embedded resources. | The documented exact-job response is authoritative for those fields. Configured display labels and undecoded markup must not create false mismatches or become publication truth. Missing company fields alone use the configured fallback, and malformed values remain rejected. | [Greenhouse API contract](https://docs.greenhouse.io/job-board.html#retrieve-a-job), [adapter tests](../../../backend/workers/ingestion/src/greenhouse.test.ts) |
| 2026-09-05 | Treat omitted optional locations and exact grounded location/work-type splits as equivalent during provider comparison; retain the original independent provider observation. Use an operator-only, 25-item, aggregate-only snapshot to retry only unchanged temporary-unavailable/mismatch holds. | Preview field removal and the accepted work-type separation must not create false verification failures. Recovery must not require duplicate submissions or bypass independent verification, consent, Trust, capability, deduplication, or publication gates. Closed, duplicate, Trust-held, and terminal work remains untouched. | [Provider comparison](../../../backend/workers/ingestion/src/contribution-verification.ts), [recovery store](../../../backend/services/jobs/src/persistence/contribution-recovery.ts), [operator](../../../scripts/operate-development-d2-provider-recovery.ps1) |
| 2026-08-12 | Provider-derived job-page fixture evidence is acquired and accepted with the detector capability, not in the generic foundation. | Supported variants can only be judged against the concrete detector behavior. | [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md) |
| 2026-09-02 | Use the existing retained provider-only subnet/NAT boundary for the activated D2 scheduled verifier; keep the signal consumer on ordinary private subnets and dark deployment NAT-free. | Independent verification needs public provider access, while database access still requires private networking. A shared explicitly authorized egress boundary avoids overlapping CIDRs and duplicate idle NAT while preserving least privilege. | Commit `19bc7e7`; [Terraform composition](../../../infrastructure/terraform/README.md) |
| 2026-09-03 | Keep the primary preview and delivery control in document flow; place source metadata, queue, and contribution history behind semantic disclosures; and make the background worker authoritative for delivery readiness. | This keeps candidate-recognizable content and the explicit public-add action ahead of operational history without a sticky region that can cover focus at narrow widths or zoom. A background-owned readiness result prevents presentation code from guessing whether identity, API, retention, or signed-policy gates actually permit delivery. | [Installed narrow-layout acceptance](#d2-023-installed-narrow-layout-acceptance), [browser assurance](../../../scripts/tests/d2-extension-assurance/README.md) |
| 2026-09-03 | Present one public-add command after preview, omit private save and the duplicate approval checkbox, retain the internal digest-bound authorization receipt, and show work type separately from location. | The destination and action are now unambiguous while integrity, retry, attribution, withdrawal, and abuse controls remain enforceable. Structured separation prevents a public location such as `Remote-NORAM` from conflating geography with work arrangement. | [ADR-029](../../adr/029-one-step-public-job-addition.md) |
| 2026-09-03 | Retain an unacknowledged local pending intent for 24 hours, then remove it; acknowledged terminal handling removes it sooner. | One day supports ordinary transient offline/restart recovery while minimizing confidential local contributor-linked data. It is far below the enforced 30-day ceiling and does not change the separate external-fixture quarantine rule. | [D2 security/privacy delta](../../security/d2-extension-ugc-security-privacy.md) |
| 2026-09-03 | Use the provider's exact public job endpoint for Greenhouse contribution verification while retaining the board endpoint for scheduled ingestion. | Independent verification already possesses the normalized external job ID. Fetching one exact public record preserves redirect refusal, timeout, host/path identity, and one-megabyte limits and avoids turning a large employer board into a permanent false-unavailable result. | [Ingestion boundary](../../../backend/workers/ingestion/README.md) |
| 2026-09-03 | Permit one short-lived controlled development activation for extension client `0.2.0`, Greenhouse `greenhouse-board-v1`, its two reviewed domains, and the dedicated workflow `case_opener`; keep production, store distribution, other providers, and every human decision role dark. | This exercises the complete deployed boundary with the smallest independently kill-switchable scope. The product-owner exception supplies development authority only; it deliberately does not claim LR-D2-01/LR-D2-02, counsel, accountable security/privacy, production, or store approval. Expiry bounds the exception and requires a fresh signed policy to continue. | [Activation work-log record](#work-log) |
| 2026-09-03 | Send a strict versioned, rule-ARN-bound command from the Terraform-owned EventBridge target instead of validating undocumented shape assumptions about AWS-generated scheduled envelopes. | The original runtime correctly rejected the live envelope but made every automatic batch fail. A Terraform-owned exact command retains least-privilege source-ARN enforcement and fail-closed payload validation while making the schedule contract deterministic and regression-testable. | Commit `9a8fb5f`; [Terraform composition](../../../infrastructure/terraform/modules/platform/community-runtime.tf) |

## Risks and blockers

| ID | State | Risk or blocker | Owner | Next action |
|---|---|---|---|---|
| D2-R1 | Open | Browser-store review can reject overbroad permissions or unclear collection disclosures. | Platform engineering; product owner; privacy reviewer | Preserve active-tab/default-zero hosts, explicit actions, deterministic packaging, exact disclosures, and complete final accountable/store review. |
| D2-R2 | Open | Malicious/incorrect UGC can poison the catalog. | Trust/platform engineering; security reviewer | Preserve independent provider truth, duplicate parking, Trust review, contributor reputation, appeals, takedowns, kill switches, and complete deployed abuse acceptance. |
| D2-R3 | Open; development exception bounded | D1 real-candidate, admin/moderation, public-publication, accessibility, and final accountable gates remain incomplete and do not transfer authority to D2. | Product owner; platform engineering | Confine the explicit exception to Greenhouse development contribution, automated case opening, and the separately recorded delegated agent assignment; do not infer production, store, human publication, or broader D1/D2 authority. |
| D2-R4 | Open; Greenhouse closed | Greenhouse `greenhouse-board-v1` now has accepted provider-derived evidence. Lever and Ashby still have no authorized representative job-page fixture. | QA/automation; capability reviewers | Keep Lever and Ashby disabled; complete ADR-021 authorization, scanning, human sanitization, separate QA acceptance, and raw disposition before activating either provider. Revalidate Greenhouse by 2026-12-02. |
| D2-R5 | Open; partially mitigated | The dedicated extension Native Application and initial installed-Edge PKCE login now exist, but Chrome parity, cancellation, refresh rotation/replay, logout, and revocation evidence remain incomplete. | Platform engineering; security engineering | Complete the remaining D2-012 lifecycle matrix without placing provider credentials or tokens in source/evidence. |
| D2-R6 | Open; controlled development exception | Accountable UGC/license, extension permission/privacy, security/privacy, and Chrome Web Store approval remain pending. | Product owner; accountable reviewers | Keep production and store distribution disabled. Preserve the exact Greenhouse scope and assigned least-privilege reviewer roles; D2-033's persistent development mode is deployed, rebuilt, and accepted through the user-confirmed reload/sign-in/job-add journey; broader browser lifecycle and release acceptance remain separate. Complete D2-009/D2-010 against the exact release candidate. |
| D2-R7 | Open | The architecture's older raw-snapshot example conflicts with the newer 30-day maximum quarantine specification. | Product owner; privacy/security reviewers | ADR-028 selects zero normal raw-snapshot retention; use the 30-day maximum only for separately authorized external fixture quarantine and obtain accountable acceptance. |
| D2-R8 | Mitigated; acceptance open | A cramped or incomplete installed preview can cause a candidate to misunderstand what will be added or where it will go, weakening the explicit command even when the underlying payload is correct. | Product design; platform engineering; QA/automation | The wider responsive redesign, single public-add action, and automated Edge/Google Chrome for Testing geometry, keyboard, reflow, and two-surface axe checks are complete. Branded-browser authenticated lifecycle and human assistive-technology acceptance remain; do not relabel already-passing automated coverage as an open gate. |
| D2-R9 | Closed | The dedicated D2 Trust workflow client and its exact `trust:review trust:case:open` grant are operator-confirmed. Its tenant-bound machine subject is bound only to `case_opener`; no secret is stored and the candidate-rights M2M identity remains separate. | Product owner; platform engineering | Preserve the workflow-only assignment and keep human decision roles separately assigned. |
| D2-R10 | Owner publication follow-up open | Three accepted/version-2 initial decisions and later processing/Trust aggregates pass, but do not identify exact owner/catalog rows. Anonymous public-job routes remain disabled. | Platform engineering; QA/automation | Browser control is unavailable here; owner login status is unobserved. Ask the user to Refresh processing and Refresh Trust on existing contributions and report fixed status lines only, then check authenticated catalog/detail. No resubmission, token, identifier or repeated decision; hosted/human appeal acceptance remains separate. |
| D2-R11 | Closed | Recurring development signing/policy fetch/expiry is removed from the deployed Gateway/scheduled runtime and rebuilt unpacked extension. The user confirms installed reload, successful sign-in, and successful job addition on 2026-09-08, closing this development adoption blocker. Exact scope, authentication, independent verification, and Trust remain enforced. | Platform engineering | Preserve the fixed development scope and remaining independent publication/lifecycle checks. No fresh contribution signing or renewal approval is needed. Production/store and unsupported providers remain disabled; do not automatically resubmit old items. |
| D2-R12 | Open; hosted reviewer and appeal-decision journey acceptance pending | The September 8 exact human identity/fresh-MFA/two-scope check, state-285 assignment and user-confirmed empty local appeal queue pass; the local-only window ended at `2026-09-08T13:38:16Z`. All three assignments remain unchanged through state `298`. D2-042's three initial decisions are delegated-agent acceptance, not a human appeal or hosted-console journey. | Product owner; platform engineering | Complete hosted reviewer and separate human appeal acceptance under scoped testing. Do not manufacture a case or submit a decision merely to test access; preserve exact reviewer authentication and roles. |
| D2-R13 | Closed | The expired mobile-only exception blocked initial publication attempts. The exact user-approved parser patch passes 136 focused tests, independent review, frozen installation, the full repository verifier, and the dependency audit without exceptions. Two matching no-cache migration-image builds, isolated smoke, and ECR scan COMPLETE with zero High/Critical findings now pass; that image was published and used successfully. | Platform engineering | Maintain the exact local patch until a compatible upstream fix is verified. No mobile/public-launch acceptance is implied. |
| D2-R14 | Closed | The user confirmed reuse of the existing encrypted agent-reviewer credential on 2026-09-08 for the remaining Phase 2 development initial/takedown work. Private current-user access, unchanged encrypted bytes, and the live exact assignment pass. The historical collection window remains unchanged; the subsequent Auth0 refusal is separately tracked as R16. | Product owner; platform engineering | Preserve the existing roles and separate human appeal reviewer. No recurring contribution-policy approval or new secret is required for this unchanged assignment; do not borrow another identity, expand roles, or submit unsupported decisions. |
| D2-R15 | Closed | Renewed development SSO permitted the exact-boundary recovery and cleanup; earlier expiry is historical, not a current blocker. | Product owner; platform engineering | No cloud operation remains for this drill. Final Platform `329`/Bootstrap `21` Verify confirms zero drift and drill-only permission removal. Owner browser/session state is separate and unobserved; no renewed recovery approval is needed. |
| D2-R16 | Closed | The corrected existing Client Access grant passes exact three-scope authentication. The September 9 read-only access check and September 10 fresh-evidence/three accepted initial-decision readbacks pass without grant, role, credential or human-session changes. | Product owner; platform engineering | Keep the unchanged least-privilege assignment and evidence/version binding. Hosted/human appeal and exact owner-publication acceptance remain open; no further screenshot or new secret is needed for this resolved grant. |
| D2-R17 | Closed; isolated drill completed | The user-approved development-only drill completes on the original 44-migration/68-relation copy: strict Inspect/Replay passes one already-reconciled historical subject, then exact executor/PITR and all temporary-permission cleanup pass. | Product owner; platform engineering | Retain protected evidence and do not repeat PITR or infer fresh nonempty deletion acceptance. The separately authorized single-tag correction is D2-052/D2-053; replay preserves primary database, cloud documents, tags, retention and Auth0. |
| D2-R18 | Closed | Verified portable 1.16.2, historical read-only decoding, effective encrypted S3 locking, 441 two-host toolchain assertions and full infrastructure/repository checks pass. Exact sensitivity-only reconciliation advances state to 291 without resource-value changes; fresh locked planning exits 0. | Platform engineering | Use fresh source-bound handoffs for D2-039/D2-038. Preserve historical plans, provider locks and excluded Actions; no further toolchain approval is needed. |
| D2-R19 | Closed | D2-044's exact-version acknowledgment repair was deployed and verified at core `13`/state `315`, with four ordinary activity invocations, zero errors/throttles and all 57 managed alarms OK at that checkpoint. The later corrected core `2ff32ef`/version `14` and bounded recovery also pass. | Platform engineering | Preserve ordinary runtime and alarm controls. Fresh candidate-rights and ALARM/OK recipient acceptance remain separate; final cleanup health records 44 core alarms OK, not a new 57-alarm delivery test. |
| D2-R20 | Closed; conditional correction completed | Corroborated persisted request/ledger/operation evidence proves the historical tag mismatch. The separately approved D2-053 recovery sends exactly one exact-version completion-tag Put and verifies intended state on 2026-09-11. | Product owner; platform engineering | Retain SQL rows, bodies, confirmation, retention, documents, Auth0, other tags/markers and original evidence. Both journals remain immutable; no reset, resend or broader correction is authorized. Strict same-copy Inspect/Replay and final cleanup pass. |
| D2-R21 | Closed; pre-dispatch recovery completed | User-approved D2-053 executes successfully after authenticated prior zero-dispatch evidence and fresh checks. Recovery `8649` / `7d6e48` verifies the intended single-tag state, preserving the original attempt and fixed linked companion. | Platform engineering; product owner | Preserve both reservations and archived evidence with no resend, alternate-scope retry, new PITR or broader data/IAM authority. Exact executor/PITR/permission cleanup is complete; broader Phase 2 acceptance remains open. |

## Completion record

- Latest local implementation checkpoint (`2026-09-11` UTC): D2-054 is Complete at `dd2d560`.
  Extension/admin complete suites and full repository verification/build pass. The configured
  extension is rebuilt; installed reload and hosted admin rollout remain distinct from source
  completion. Phase 2 itself remains In progress; no remaining human or owner gate is waived.
- Completion date: Not completed
- Exit review: Not performed
- Current engineering summary (`2026-09-11` UTC): D2-038/D2-050/D2-052/D2-053 are Complete.
  Operator/artifact `6eb7a86` verifies the one-tag historical correction and unchanged same-copy
  Inspect/Replay: one historical marker/one already-reconciled restored subject, no documents
  or new reconciliation, zero S3/recovery-ledger writes and identity-provider calls during
  Replay. Final executor/PITR cleanup and Platform `329`/Bootstrap `21` permission removal
  pass with zero drift. Normal runtime `2ff32ef`/version `14` remains resumed and unchanged;
  source available, 44 core alarms OK, ECS idle. Protected context/artifacts and both journals
  remain intact. No fresh nonempty deletion or real concurrent row-lock race is claimed.
  Phase 2 remains In progress behind the remaining acceptance table.
- Authority summary (`2026-09-11` UTC): D2-R17/R20/R21's bounded drill, conditional exact-version
  correction and separately authorized pre-dispatch recovery are fulfilled. Exactly one
  completion-tag Put verifies intended state; original and linked recovery reservations remain
  intact and cannot be reset or used to resend. No broader SQL, body, retention, document,
  identity-provider, provider or IAM authority is inferred. All drill-only resources and
  permissions are removed; no further recovery execution is pending.
- Earlier recovery summary (`2026-09-10T23:13:34Z`): actual `9b608ac` Create passes, but Inspect
  reports the store's `CompletionCollision` after initial SQL reads. No validated inspection or
  Replay. Cleanup `88848` removes the exact temporary function after its full drain; the same
  verified private copy and Platform `320`/Bootstrap `20` temporary permissions remain. D2-052/R20
  require a new conditional historical correction decision, not renewed drill authority. Tested
  D2-051 Gateway/core releases and final replay/resource/permission cleanup remain unperformed.
  No historical tag, database row, document, marker body, retention or Auth0 value changes.
- Earlier recovery summary (`2026-09-10`, after renewed login and Cleanup `57506`): actual `01732ad`
  Create passes, but Inspect refuses at `store_preflight`; no Replay. The exact temporary function
  is fully drained and removed. The same verified 44-migration/68-relation private RDS copy and
  Platform `320`/Bootstrap `20` permissions remain. R15 is Closed; D2-050 diagnostics and D2-051
  timestamp fixes are in progress. Continue on the same copy, without live marker repair, repeated
  PITR or expired-packet renewal. Final replay, resource/permission cleanup and broader acceptance
  remain open.
- Earlier recovery summary (`2026-09-10T21:29:40Z`): implementation `37ea0ff` is verified and merged;
  697 workflow tests pass with six explicit database opt-ins skipped, all 20 builds pass, and both
  standalone artifact builds match. One private cloud restore verifies 44 migrations/68 relations;
  its temporary permissions remain enabled at Platform `320`/Bootstrap `20`. The last executor is
  fully drained and removed. No Replay has run; new preparation creates no packet/executor when
  SSO expires. R15 is Blocked pending renewed login; R17's existing recovery authority is unchanged.
  Reuse the same verified copy, finish corrected-source Inspect/Replay, and remove temporary
  resources/permissions. The earlier checkpoints below are history, not current cleanup status.
- Earlier application-release summary (`2026-09-10T04:55:39Z`): exact `e2e730a` passes the full verifier,
  D2 workers `21`/`17` at state `297` and Gateway release at state `298`. The earlier single
  migration/Resume verifies 44 migrations/68 relations. D2-042 is Complete: three supported initial
  decisions read back accepted/version `2`, with fresh evidence and no role changes/new submissions.
  Subsequent processing/Trust health aggregates pass their bounded checks but do not identify exact
  owner/catalog publication. Greenhouse-only/production-store-dark scope is unchanged; hosted
  reviewer and human appeal acceptance remain separate. Cloud recovery had not run at that checkpoint.
- Earlier repository/follow-up history: full verification, real database regressions and local
  44-migration recovery pass. D2-033/D2-034/D2-036/D2-037/D2-040/D2-041/D2-042/D2-043 are Complete for their
  recorded task boundaries, not the phase. The separate rights release/Resume verifies at state
  `305` with exact pins, starts unpaused and a genuine zero-change baseline. Fresh user export/deletion
  acceptance remains open. Dark ingestion and final canonical capture verify at state `308` without
  activation or further changes. D2-043 full verification passes at `6604aff`. Historical AWS
  PITR covered 39 migrations before the later verified 44-migration restore above. Gateway/D2 artifacts alone do not deploy the
  separately bundled export validator.
  D2-044 is now Complete: corrective core source `31051e1` verifies at state `315`, unpaused,
  durable/activity/terminal `13`, zero changes, positive `4/0/0` activity health and 57 OK alarms.
  Renewed SSO initially closed R15 (now reopened); the deployed repair closes R19. D2-045 is Complete for inspector
  tooling, not authenticated workload acceptance. D2-046 addresses the native prefix metadata
  refusal; the unused bootstrap allowance was removed and verified at state `15`. No Platform
  recovery role, executor, PITR copy or replay existed at that earlier checkpoint; today's partial
  drill and credential blocker are recorded above.
- Remaining acceptance: installed job addition is not provider/Trust approval or website publication.
  Owner readback needs user help with the existing Refresh processing/Refresh Trust actions
  because browser control is unavailable here; owner login status is unobserved. Hosted
  reviewer/appeal decisions, fresh rights, browser lifecycle, authenticated workload, human
  accessibility, alarm delivery receipt, other provider/store and accountable acceptance remain
  open. Engineering, release and bounded recovery completion do not complete Phase 2.
- Accepted residual risks: None recorded
