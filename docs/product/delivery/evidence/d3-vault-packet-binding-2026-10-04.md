# D3-076: selected saved answers in immutable application packets

Status: In progress. Started 2026-10-04 on exact PR #545 `57d7b057ef5bb25cfdd4b66aa81db2c4474da460`, branch `feat/d3-vault-packet-binding`. Local synthetic backend work; not deployed or activated.

## Path and acceptance

Explicit candidate selection and meaning confirmation → Gateway → exact private Profile selected-value read → immutable packet reference and hash → mandatory field review → Profile-owned metadata locks in the Applications admission transaction → approval/start/dispatch refusal on correction, deletion or expiry. Asynchronous preparation binds its original packet and checks references before claim/recovery and final packet creation. Values and metadata are excluded from the Documents generation input.

`RESTRICTED_ANSWER_REUSE_ENABLED` defaults false. Selection requires an observed form, exact version and context, and a question hash; it cannot infer candidate answers or replace a selection with a newer version. KMS runs outside SQL admission locks. The private admission capability reads metadata only and holds the same advisory transaction keys used by all vault writers, in sorted order, until Applications commits or rolls back. It uses the caller's single SQL transaction, not a separate transaction or a cross-owner SQL query authored by Applications. Missing capability or failed metadata read refuses admission.

## Evidence so far

Before the transaction-lock refinement: 147 Applications unit tests and 15 new real Gateway/Profile/Applications PostgreSQL tests passed. The SQL suite exercises authenticated HTTP with a simulated OIDC issuer, local opaque-handle cipher (simulated KMS) and synthetic job catalog; actual SQL ownership, services and packet persistence are used. Two tests advance the clock while approval/dispatch waits for a real application row lock. After the locking change, 23 real SQL cases pass, including correction, remove and removeByField committed during approve/dispatch lock waits, and a writer blocked until an admission rollback. Original 67 Applications SQL tests (including fault injection) and 46 Profile SQL tests pass. Package suites pass: Applications 147 units, Profile 120, Gateway 300, Workflows 1,588; API and Domain pass. Six real preparation workflow tests and five original Gateway SQL tests pass. The missing-admission-capability case passes with no approval. Native opt-in suites pass 22 evidence/starter/recovery cases and 11 isolated Documents/native-actor cases. Their first parallel run hit cluster-wide Jobs role creation/grant isolation checks; an exact single-database fixture resolves this without weakening guards. The maintained logical dump/restore passes with 60 migrations and exact row-set equality for all 84 relations, owned container cleanup true. Formatting passes. Both owned packet/native fixtures are removed; Docker/WSL are stopped. Full verifier and artifact checks were pending at that checkpoint; final results are recorded below.

## Rollout and remaining work

Apply Applications migration `0006_vault_approval_binding.sql` before admitting the new invalidation reason. Restore inventory is 60 migrations and 84 relations. Deploy compatible strict schema readers before producers: new optional packet reference objects are rejected by old strict readers despite unchanged legacy packet hashes. Keep the switch false until candidate review UI, least-privilege runtime composition, legal/privacy/security approval and deployed journey checks pass. No live KMS/model/ATS calls, deployment or production data are authorized by this source checkpoint.

Local automated source, integration, restore and artifact checks are complete as recorded below. Review, protected packet storage and deployed/accountable acceptance remain. D1 and D3 exit checkboxes remain unchanged. CI/CD is deferred by the owner until production launch.

## Sources and local logs

- [Admission owner API](../../../../backend/services/profile/src/restricted-answer-vault.ts)
- [Applications guards](../../../../backend/services/applications/src/store.ts)
- [Real SQL regressions](../../../../backend/gateway/src/applications-vault.integration.test.ts)
- [Migration 0006](../../../../backend/services/applications/migrations/0006_vault_approval_binding.sql), SHA256 `ecca6ad54d8199f32cb6765a748bdf311b0429dd779a2d1fe468efbcf82dbe1f`
- Restore manifest SHA256 `6b6c237850f5b2a88a043eb975043a1dfd7145e40968647e9d53fadfce92c611`
- Ignored local logs: `.tmp/d3-076-admission-gateway-sql-final.log`, `.tmp/d3-076-applications-postgres.log`, `.tmp/d3-076-profile-postgres.log`, `.tmp/d3-076-native-preparation-postgres.log` (first attempt; 22 cases passed), `.tmp/d3-076-native-documents-postgres.log` (correct isolated rerun), `.tmp/d3-076-restore.log`.

## Required restricted-packet storage follow-up (D3-077)

Existing Applications packet JSON stores scalar field values, including selected restricted
answers, outside the vault's separate key/storage boundary. The synthetic D3-076 implementation
proves explicit selection, review and transactional revision admission; it does not satisfy
architecture section 12.3/ADR-010's restricted storage controls. **Keep the reuse switch false.**
D3-077 must provide protected packet-value persistence and just-in-time owner reads, without
KMS inside admission locks, plus corrected retention/export/deletion evidence and accountable
security/privacy review before activation. This is a concrete engineering gap, not legal approval.

The first full verifier found historical restore fixtures accidentally inheriting new migration
0006; the historical 52/57/58 counts remain unchanged. Their filters now omit 0006, with an added
59-migration historical-boundary refusal case. Production migration/manifest bytes are unchanged;
All 43 focused migration/restore unit tests pass after the correction; the fresh clean full verifier passes on `21594bc4084f833bf9ac86845ed0142a97fdf211`.

## Clean-source completion evidence

Clean `21594bc4084f833bf9ac86845ed0142a97fdf211` passes `scripts/verify-phase0.ps1`:
38 typecheck tasks, 39 test tasks, 23 production builds, formatting, operational/security and
bundle-isolation guards, Compose and product-scope checks. Lint remains 0 errors, 15 warnings and
58 informational notes. API contracts pass 85 tests; Domain 25; Applications 147; Profile 120
with 46 SQL opt-ins separately verified; Gateway 300 with 38 SQL opt-ins skipped (23 new and
five existing Applications cases separately verified); Workflows 1,588 with 57 opt-ins skipped,
including the separately verified preparation/native cases above. No live provider/OIDC/KMS/ATS
end-to-end claim or browser selection/review acceptance is made.

The actual native preparation artifact is built twice from exact clean source `21594bc4`.
All five local files (bundle, ZIP, manifest, SBOM and checksum) are byte-identical. ZIP SHA256:
`fd264e27a59ea349855c8edf2bc18b6128d9b4ea0b867865adca26e8045abdbd`; bundle SHA256:
`ad1be4638e495536dfdb7b6b75b971287ff75f0d710eb2464640b4591262ec47`. The builder executes
the actual bundle's default-off refusal, extra-content rejection and zero-fetch checks.
41 components; 1,421,323 ZIP bytes. Nothing is published or deployed.

The owned fixtures are removed; Docker Desktop and WSL are stopped, shared volumes retained.
Added Markdown links resolve and D1/D3 checklist lines match exact parent #545. Following edits
are delivery documentation only. Logs: `.tmp/d3-076-full-verifier-final.log`,
`.tmp/d3-076-native-artifact-1.log`, `.tmp/d3-076-native-artifact-2.log`.

This completes local source verification, not D3-076's deployed journey or D1/D3. D3-077's
restricted packet persistence, candidate review UI, reader-first/migration/native releases,
accountable approvals and deployed acceptance remain. Keep reuse false.

## Review checkpoint

[PR #547](https://github.com/Vrixic/project-ai-job-apply/pull/547) is open on exact #545
`57d7b057ef5bb25cfdd4b66aa81db2c4474da460`, branch `feat/d3-vault-packet-binding`.
Verified source `21594bc4084f833bf9ac86845ed0142a97fdf211` is unchanged; only delivery
documentation follows. CI/CD remains deferred until production launch. D3-077 and the other
activation gates above remain unresolved; reuse stays false and neither D1 nor D3 is complete.
