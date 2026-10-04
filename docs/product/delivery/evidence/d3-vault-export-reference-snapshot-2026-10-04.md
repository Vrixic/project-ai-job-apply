# D3-073: Restricted-answer export reference snapshot

Date: 2026-10-04. Scope: backend-only source and local generated-synthetic verification.
D1 and D3 remain In progress. Hosted CI/CD is deferred until production launch.

## Source and defect

Started from freshly fetched main `bde17d9ed94448fb04393f295122176a875a8d2b`, then
fast-forwarded the exact open #542 dependency `bf50b5651f1a88c0f8273c904c4b6e15338b7e5e`.
Branch: `fix/d3-vault-export-reference-snapshot`.

The Profile-owned export reader used the caller's mutable reference again after SQL and KMS
awaits. Mutation could decrypt the original ciphertext using a changed field binding, or validate
a live neighbouring ID/version/field while returning an original value corrected or deleted
during decryption. Two new unit cases reproduce metadata drift against the unchanged source.
The correction captures scalar ID/version/field/context before any asynchronous work and uses
that original binding in both SQL reads and KMS. The neighbour cannot substitute for it.

[Reader](../../../../backend/services/profile/src/restricted-answer-export.ts),
[unit regressions](../../../../backend/services/profile/src/restricted-answer-export.test.ts),
[PostgreSQL regressions](../../../../backend/services/profile/src/restricted-answer-vault.integration.test.ts).

## Verification

- Seven export reader cases pass, including three new mutation regressions. Initial source
  reproducer: two failures; `.tmp/d3-073-reproduction.log`.
- Profile typecheck, build and scoped Biome checks pass.
- All 26 real PostgreSQL vault integration cases pass, including three new caller-retargeting
  races: unchanged original returns its saved value; corrected/deleted originals are withheld,
  despite a live neighbour with a different ID/version/field. The neighbour remains independently
  exportable. Original and neighbouring saved answers are expired: portability remains valid.
- `.tmp/d3-073-postgres.log`: PostgreSQL 16.14-alpine, isolated temporary in-memory fixture
  `ai-job-apply-d3-073-pg`, loopback port 55441, database `vault_export_d3_073`.
  Existing Profile migration runner applies the real schema. KMS is an in-process synthetic
  cipher; this is not live KMS, managed authentication or deployed export acceptance.
- Full maintained verifier: pending. Temporary fixture removal and Docker/WSL shutdown initiated.

## Compatibility and remaining work

No public API/event/schema/generated type, migration, frontend, Terraform, operational guard,
activation flag or publication path changes. Existing active-only/latest-version/owner isolation
and expired-value portability are preserved. KMS still holds no SQL lock. This is a point-in-time
read, not a candidate lease or approval guarantee. No source attestation certifies remote writer
quiescence. No provider/cloud/model call, deployment or activation is performed.

Applications reuse remains separate unfinished D3-001/D3-005 work: approved exact question/context
mapping, explicit mandatory review, durable original-version binding and correction/deletion/
expiry invalidation through approval and queued use. D3-017 runtime IAM/drain/retention/restore,
D3-012 accountable review, D3-013 fixture evidence and deployed journey acceptance remain open.
