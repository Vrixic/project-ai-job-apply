# D3 native live admission fixes — 2026-10-11

D3 remains In progress. Independent D1 and hosted admin acceptance remain deferred.
This batch used targeted tests/typechecks and a disposable synthetic candidate account.
No full repository check or formal database recovery-proof gate was added or run.

## Implemented and tested

- [PR #643](https://github.com/Vrixic/project-ai-job-apply/pull/643) fixes nullable profile-fact page serialization. Five focused tests and the component typecheck pass; the live scanned/parsed synthetic upload and grounded fact confirmation pass.
- [PR #644](https://github.com/Vrixic/project-ai-job-apply/pull/644) removes invalid `propagateTags: NONE` from native RunTask requests. 53 focused tests, the Documents typecheck and consequential review pass. The changed PostgreSQL fixture was not executed with Docker off. Immutable preparation artifacts were deployed; subsequent live tasks launched.
- [PR #645](https://github.com/Vrixic/project-ai-job-apply/pull/645) adds bounded, read-only generated-resume status refresh with identity/revision validation. 43 workspace tests, the web typecheck and consequential review pass. The protected stable candidate host was deployed and the live refresh control exercised.
- [PR #646](https://github.com/Vrixic/project-ai-job-apply/pull/646) permits only exact native task roles to call GetCallerIdentity through the private STS endpoint. Twelve focused Terraform runs, module validation and consequential review pass. The exact policy plan was applied; the subsequent task's successful STS calls verify the deployed fix.
- [PR #647](https://github.com/Vrixic/project-ai-job-apply/pull/647) accepts the compact JSON serialization actually emitted by Lambda while retaining structural bounds, duplicate-key rejection and identity/digest validation. The connected transport regression failed before the fix; 104 focused RPC tests, Documents typecheck, changed-file lint and consequential review pass afterward. Source is merged; the corrected worker image has **not** been built or deployed.

## Live connected journey and blockers

Candidate and Vercel authentication succeeded. Search, job details, synthetic upload scanning/parsing,
grounded profile confirmation and application preparation requests were exercised against development.
Three original preparations failed: the first launch was rejected before a task existed; two later
tasks launched and stopped with exit 1. The last failure exposed the RPC serialization defect above.
No generated resume, cover letter, approval, Apply or confirmed submission/history was established.
This is partial live verification, not acceptance of the requested connected journey.

Docker Desktop 4.87.0 cannot initialize its Secrets Engine because Windows cannot access
`C:/Users/prasa/AppData/Local/docker-secrets-engine/engine.sock`. An exact-path inspection and
non-destructive rename attempt also failed. An exact empty-socket deletion attempt was rejected by automatic approval review as blocked by policy; the command did not execute. No reset, data deletion or reboot was performed.
Repairing Docker startup is required to build the corrected immutable worker and rerun preparation.

The original rejected launch remains an internal recovery gap: its claimed-pending ledger row
cannot safely be settled through the existing task-retirement transition. It requires an explicit
owning transition tied to the definitive original launch rejection. Original claims were not
relaunched, guessed complete or cleared. Failure histories and unresolved dispositions are retained.

Two external acceptance dependencies remain: the owner confirms no AI-provider policy guarantees
all candidate copies expire within 30 minutes, and exact authorized ATS QA targets/fixtures are
unavailable. Live AI covers and employer submission remain off. Synthetic data was not submitted
to real employers; no confirmed history was fabricated. Truthfulness, sensitive-answer review,
submission controls and generated-material expiry requirements remain in force.

## Shutdown evidence

Development account `362544434697`, `us-east-2`, was verified off at
`2026-10-11T17:26:54Z`: zero project databases, active NAT gateways, public IPs, paid interface
endpoints, API routes, enabled schedules/consumers, running work and queued messages. Docker/WSL
are off; the PC remains on. The same-input refreshed plan has zero resource and output changes
(SHA-256 `385e6fcae87fe618e0e0cf3df17ba4bc3e8810010312415927e8e0eb778c4fa2`).

Both `ai-job-apply-development-shutdown-20261011165649` and its `-safety` snapshot are available,
encrypted and bound to physical source `db-JTBS3VULCNXKW2HRT2FP7OM3JY`. The exact-source automated
backup also reads `retained` and encrypted. Consequential review passed the preparation and sole
database-deletion plans; the applied deletion checksum is
`3c0c47edebc6662595852fb653548fcd502926d7ad0d58d1a5a88e83fffdd4f1`.

All 143 current dormant inputs are archived privately in the encrypted versioned state bucket at
`recovery/development-dormancy/20261011165649/inputs.json`, version
`3AGfn9eks6cNRJPuh1XZ8drg25_tC9tE`, with exact-version checksum readback:
`7489d5659ed5e303e1b960e05efa17418ca9e1a8817abea423c7656107d1960e`.
Reactivation must explicitly select the new final snapshot under the existing dormancy runbook.
Snapshots, automated backups, S3/ECR, KMS, secrets and monitoring/security resources retain costs.

Twelve individually classified notices (three terminal failures and nine failed reconciliation
deliveries) were archived with encrypted version/checksum readback before acknowledgement. No
queue purge or application settlement occurred. Original unresolved recovery remains open.
Private plans, reviews, histories and readbacks are under `.tmp/d3-primary-recovery-20261010/`.

Staging account `908203540025`, `us-east-2`, was freshly verified dormant at
`2026-10-11T18:01:49Z` after sequential SSO renewal. Read-only lifecycle and supplemental
inventory checks show zero project databases, active NAT gateways, public IPs, paid interface
endpoints, public routes, enabled rules/mappings, ECS tasks, running durable executions and queued
messages. No staging resources were started or mutated. Retained storage/security resources
continue to incur charges. This closes the shutdown-verification gap, not D3 acceptance.
