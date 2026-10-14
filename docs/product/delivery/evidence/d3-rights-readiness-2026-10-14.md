# D3 rights readiness — 2026-10-14

The original confirmed deletion is recovered and development shutdown is verified. The canonical
17-step rights run remains FAILED without a success receipt. D3 remains In progress; the recovered
request does not establish full rights/expiry, installed-extension, AI, ATS or accountable acceptance.

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

## Historical runtime preparation and first-read failure

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

The strict operator requires `Cache-Control: no-store` on these authenticated responses. Gateway
116's resume-list and upload-registration handlers omit it. The preserved deployed Gateway 116 ZIP
(`f1828f08…a262a3`, source `6d6426b5…48cdf`) confirms the same missing decorators in its compiled
handlers; adjacent resume deletion already uses the established header pattern. An absent header
throws before the fixture's empty-inventory check, explaining the first-read refusal.

The focused fix adds the two producer decorators and assertions in the existing in-process
resume route test. That test fails before the fix and passes afterward (one selected test;
110 skipped). Gateway dependency build, Gateway build and Biome on only the two changed files
pass; independent source review finds no issue. The operator's strict cache policy stays unchanged.
Gateway 117/source `a45c456c` is now released and independently verified. Later reviewed sessions
and the recovered original deletion are recorded below; the first Execute remains preserved.

Only the in-app browser is connected. Installed-extension acceptance, authorized Greenhouse QA
fixtures/destinations and exact-variant authority, the qualifying 30-minute all-copy AI policy,
and accountable acceptance remain open. Live AI and employer submission stay off. D3 remains
In progress; independent D1/admin acceptance remains deferred.

## Released identity and IAM fixes

[PR #682](https://github.com/Vrixic/project-ai-job-apply/pull/682), source `b378e906`, preserves
the original verified ID-token expiry and 900-second MFA lease across access refresh while retaining
current admission checks. Before/after regressions, 69 Node tests, both PowerShell hosts, scoped
Biome and consequential review pass. The earlier combined identity-expiry error does not establish
which original clock expired. The scripts-only correction required no Gateway redeployment.

[PR #684](https://github.com/Vrixic/project-ai-job-apply/pull/684), source `96a395f9`, adds the exact
export bucket/prefix/role version-list grant and `DeleteObject` in the existing document boundary,
activity and endpoint policies. Bootstrap 9/0, focused platform 1/0 and 30 historical operator
assertions in each PowerShell host pass. The initial broader platform run, before repair, had
55 passes/2 failures, including the existing scope assertion; a broader full-green run is not
claimed. Both reviewed IAM plans were applied. Actual readback `84f6060a…` matches the complete
policies; intended scoped simulations allow and the unrelated export prefix denies. Gateway
117/Profile activity 25 code and generation-quiescence safeguards are unchanged. Hosted CI for
these PRs executed zero steps because billing prevented startup. No full-repository checks or
formal database recovery-proof gates were run.

The previous ordinary resume deletion returned 204 at 20:37:33Z, with all-version absence verified;
it was not repeated. A later launcher refusal preceded candidate Execute and was corrected by
selecting the reviewed Terraform 1.16.2 toolchain. Neither observation is account-deletion evidence.

## Original confirmed request recovered; canonical acceptance remains open

The single canonical plan `b7813244…` Execute confirmed deletion at `21:06:57.891Z`, then failed
without an official 17-step success receipt. Three original executions failed `AccessDenied` in
the active-system cleanup phase; the first denied AWS API is not established. The original attempt,
request scope and `2026-11-18T21:06:57.891Z` backup expiry are preserved. Qualified PRE inspection
showed the quarantined request/ledger, eight pending owners, one external identity and one document.

One reviewed continuation reused the original event/request/operation/policy and invoked only the
four normal qualified Profile activity 25 deletion actions. Each domain result completed. No new
candidate request, renewed MFA/expiry or candidate Execute occurred. POST at `22:12:58.601Z`
confirms SQL request completion at `22:12:21.787Z`: request/ledger completed, operation succeeded,
all eight owners completed, zero pending owners/external identities/document locators and exactly
the original three published events. The minimal identity row remains quarantined by design.

Two complete stable object sweeps at `22:14:41.567Z` verify the original owner's export versions
and markers absent and both saved document prefixes empty. The same encrypted, compliance-retained
marker version has the completed state/time matching SQL, with unchanged confirmation, policy and
35-day expiry. The owned read-only probe and all its versions are verified absent.

All three original failure notices matched the saved scope. Their encrypted archives and exact
versions/checksums were verified before the first individual acknowledgement; all three ACKs
returned success by `22:18:17Z`. There was no purge, replay or Execute retry. Fresh `22:19:32Z`
readback covers all thirteen queues with zero visible/in-flight/delayed messages and all temporary
functions/versions/roles/restore-role uses absent. The notice archive is versioned and encrypted;
it is not an Object Lock retention claim.

| Observation | Receipt SHA-256 |
| --- | --- |
| Four-action continuation | `e59be68c4418b43fdb9e6d0e00e1fa4ca03250a7e97329cb52339c90fd8d42b3` |
| SQL POST | `37f76bd28839ff66e86382f5bd5943d7676c7c5d5919e9b88c70fb14adf10e68` |
| Qualified POST verification | `9af0823634fa7929e2d2ae3863fd635aa72ea6bfd89b3665112a47df09c24c87` |
| Object/marker observation | `c461e6a59024976f82f07255da24034e7a7f0e879aa5d883db345095478ff14e` |
| Notice archive/individual ACKs | `97935af18dc1b2da6c67a7cfad76fe049bf6c03f660ffa5532502e90ddfe8d93` |
| Thirteen queues/temporary authority | `f9c72bef628fc741c0459f6d78edde1882da96c5a649935e1b4e977e12398eb5` |

Canonical acceptance remains FAILED/open. These observations establish recovery of the accepted
deletion; they do not supply the missing full-run or export/grant-expiry acceptance receipt.

## Final recovery resources, credential containment and shutdown

The exact database's new final snapshot `ai-job-apply-development-shutdown-20261014224151` and
its `-safety` snapshot are available/encrypted with the expected platform key. Automated backups
are retained for the same physical source; their restore window includes the request completion.
The 35-day setting was verified before deletion. The retained-backup API response omitted the
retention-days field, so that number is not presented as a newly returned observation.

An operator output exposed a development database credential. After database removal, one reviewed
two-resource rotation replaced the generated credential and the existing connection-secret version.
Metadata verifies the changed unique current version matches Terraform state, with the same secret
ARN/key and zero databases. The corrected local guards pass 98 targeted controls and actual-plan
review. No credential value or fingerprint is included here; historical encrypted snapshots and
state versions were preserved. Their contents were not rewritten, and no live post-rotation database
login or future restore is claimed. The subsequent fresh full144 dormant plan has zero resource,
data-source and output changes, no drift, and all 177 checks pass; no apply was needed.

Final cloud readback passes at `23:37:37.732Z`: database/NAT/EIP/paid Interface counts zero, API
routes/enabled rules/consumers/schedules zero, ECS and all four durable workflows idle, all thirteen
queues empty, and all temporary authority absent across every function version. Both S3 gateway
endpoints and durable recovery resources remain. Local readback at `23:36:23.599Z` confirms Docker,
WSL and owned PostgreSQL/rights listeners off; fixture files are preserved. The unrelated system
PostgreSQL service is running outside this repository and was untouched. The PC remains on.

All 144 dormant inputs (33,337 bytes) have encrypted exact-version/checksum/length archival under
`recovery/development-dormancy/20261014224151/inputs.json`; existing archives were preserved.
For a future restore, create NEW inputs selecting `ai-job-apply-development-shutdown-20261014224151`
for BOTH final and restore selectors. Preserve archived bytes: the dormant archive intentionally
keeps `20261013213003` as the historical restore selector used while the database was live.

| Final observation | SHA-256 |
| --- | --- |
| Database absence and backups | `606bf675349985f743910abd97bd92d3c4b87183d246aa516e1919b2ddd974d0` |
| Rotated-secret metadata | `c02b6b472fe4ae0584c4bc6c260161ee2617b4be8e8bfd6bcfec21a6c4777619` |
| Post-rotation zero plan | `67e654c7d51f74ec024ca0c264f27273e22222cd1d831456e522cfe3d1d1da9b` |
| Final cloud shutdown | `3e72d6b48b819958108e8bdaafd3b0bb2bd6164fa7cd25e50d6cc9f6bbb3f0c1` |
| Final owned-local shutdown | `cd36b15950c2447e0dd929ddc6bf0e29d7389a023fd5e0526e37015d2414333b` |
| Exact encrypted full144 archive | `25bdad9227c728034ce21e5f2d57bd14de08187eb182a86b3de6a39f142e9330` |

The protected candidate target is qualified deployment `dpl_CR2LceQwFrzoShVw5rgCebJsx9dF`, source
`55f8b7bc`. Final stable-alias verification runs after this documentation merge; its actual result
will be retained in the private handoff and final response. This is not hosted candidate/admin
acceptance. Staging was untouched; its last verified-off checkpoint remains October 11. Retained
snapshots/automated backups, S3/ECR, KMS, secrets, DNS, logs and monitoring/security resources incur
charges. Live AI/employer execution stay off. D3 remains In progress behind the stated rights,
installed-browser, AI retention, authorized ATS and accountable acceptance gates.
