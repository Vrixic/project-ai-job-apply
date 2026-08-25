# D1 candidate-rights vertical — 2026-08-25

## Outcome

The contract, persistence, durable runtime, AWS boundary, gateway, same-origin BFF, and candidate UI
for portable data export and irreversible account deletion are implemented and locally verified.
The feature remains default-disabled and has not been applied to the development runtime or
database. Exact source `8e2f1546390c14a0813cec6e664b7a5478a2a24f` is merged, and its migration,
gateway, and document artifacts are immutably published in development. D1-R11 and Phase 1 remain
open for generated-synthetic deployed acceptance, backup-aging/replay acceptance, managed identity
configuration, Vercel hosting, and accountable human review. The later
[policy/preprovision record](d1-candidate-rights-policy-and-preprovision-2026-08-25.md) supersedes
the release state in this source packet: the default-dark code/migrations are deployed, the policy
is selected, and Stage A is applied at state `204`. The expanded reauthentication and Stage B
operator correction described below is locally verified current working-tree behavior; it is not
part of the exact historical artifacts published from `8e2f1546390c14a0813cec6e664b7a5478a2a24f`.

## Implemented boundary

- Proposed ADR-027 assigns the user-visible lifecycle and orchestration to Profile while preserving
  exact owner-local export and deletion in Profile, Documents, Jobs, Matching, and Billing.
- Generated OpenAPI and event contracts cover export request/status and deletion
  request/status/cancel/confirm. Current OpenAPI places the bounded private reauthentication header
  directly on export create and deletion-request create/cancel/confirm, not on reads or as a global
  security scheme. A strict versioned domain schema validates the final portable export before
  encrypted artifact storage.
- Current authentication keeps API authorization on the `profile:write` access token. A separate
  RS256/JWKS-verified ID token requires `exp`, `iat`, `auth_time`, exact issuer, the candidate web
  client as sole audience, the same nonempty subject, and bounded nonempty `amr`. Every
  candidate-rights mutation requires the separate proof and policy-bounded recency; confirmation
  alone additionally requires literal `mfa`.
- Profile `0006_candidate_rights` provides request/operation/outbox/audit atomicity, account
  quarantine, anti-resurrection subject tombstones, and bounded terminal replay. The other four
  owner migrations provide allowlisted exports and privacy-authorized idempotent deletion.
- Confirmation first records an encrypted user locator in a dedicated, versioned recovery bucket
  under S3 Compliance Object Lock through the configured backup boundary. Only after that external
  marker succeeds may PostgreSQL commit quarantine. An ambiguous retry reuses the marker's canonical
  operation and time boundary. An incomplete marker makes restore replay fail closed.
- Durable deletion records/reconciles the external marker, revokes the exact Auth0 identities,
  removes all current and noncurrent document versions/delete markers, invokes every configured
  owner/subprocessor, and records completion only after all steps succeed. The Auth0 adapter supports
  an explicit basic delete mode and an explicit Enterprise session/refresh-token revocation mode.
- Durable export assembles every owner section, validates the final portable schema, writes one
  checksum/KMS/version-bound private object, and returns only an exact-version short-lived grant.
  Scheduled maintenance deletes and proves absence of the exact expired version before settling it.
- The restore replay operator enumerates the independent ledger, validates/decrypts each exact
  marker, rejects missing completion proof or policy mismatch, reconciles a quiesced restored
  database, and emits aggregate counts only. It refuses the primary database and cannot authorize a
  restore to serve traffic.
- The candidate web surface provides export request/status/download and explicit two-step deletion
  with typed `DELETE_MY_ACCOUNT` confirmation, bounded requests, no-store projection, idempotent
  retries, and stale-session/request fencing.
- Terraform remains default-off and defines private versioned export/recovery buckets, customer-KMS
  encryption, Object Lock, lifecycle defense in depth, least-privilege gateway/activity access, an
  operator-populated Auth0 secret, scheduled maintenance, DLQ/retry policy, and exact outputs.

## Current local correction verification

- The same-origin BFF attaches the server-held ID token only to the four candidate-rights mutations;
  neither token is exposed to browser code. Shared logger redaction covers the private header under
  both supported request shapes.
- The Lambda edge allowlist now includes the exact export create/status and deletion-request
  create/status/cancel/confirm route shapes, preserves the proof header, and rejects malformed
  UUID/version/case, wrong-method, and trailing-slash variants.
- The audience-bound acceptance operator consumes separate access and ID tokens, retains neither,
  and stores only an audience hash. The new saved-plan-only Stage B operator validates state
  lineage/serial, exact variable/artifact/secret/bucket boundaries, an explicit address/action
  allowlist, and zero durable deletions/replacements before apply.
- Auth 11/11, gateway 122/122, web 529/529, targeted typecheck, Terraform 42/42, both environment
  validations, and the acceptance operator in PowerShell 7 and Windows PowerShell 5.1 pass locally.
  The Stage B operator passes 39/39 in PowerShell 7 and 39/39 in Windows PowerShell 5.1. Its
  current-state preflight omits nullable baseline inputs and accepts only the existing exact
  provider-drift guard, including the strictly forward RDS `latest_restorable_time` refresh.
- The candidate route requests `max_age=0` and multi-factor `acr_values`. Auth0 must still configure
  and validate a post-login step-up Action and an enabled factor that honor the request; the query
  parameter alone is not provider evidence.

## Local verification

- Complete repository tests: 32/32 tasks. Complete repository typecheck: 31/31 tasks.
- Gateway: 111/111; workflows: 63/63; web: 41 files and 523 tests; Profile unit: 24 passed with
  six opt-in PostgreSQL cases skipped in the ordinary root run.
- API contracts: 35/35; domain schemas: 6/6; event contracts: 14/14; authentication: 8/8.
- Earlier in this exact source packet, fresh PostgreSQL 16.14 passed Profile 6/6, Documents 10/10,
  Jobs 41/41, Matching 5/5, and Billing 8/8 after the final migration checksum correction. The
  restore-manifest source suite passed 35/35 and the PowerShell staging restore guard passed. The
  subsequent external-journal adapter changes do not alter SQL or migrations. The exact merged
  migration image then passed two deterministic Linux/AMD64 builds and hardened runtime smoke.
- Terraform development and staging validate. Platform Terraform tests pass 29/29.
- Deterministic Profile durable/activity packaging passes; the latest local activity artifact SHA-256
  is `42ec1fd5a17315fa5c8036fd6ff54285f77708b128b53c9d65aa4ad5e8aabf5f` and is not deployment
  evidence.
- Docker Desktop and WSL are not running. The PC was not shut down.

## Development artifact publication

- The first exact-source migration build exposed and fixed a stale Dockerfile package-smoke
  assertion. The image now requires all five new owner migrations and the current restore boundary
  of five contributors, nine schemas, 45 relations, and 25 migrations.
- Exact source `8e2f1546390c14a0813cec6e664b7a5478a2a24f` produced a deterministic
  Linux/AMD64 migration platform digest
  `sha256:12f0cb01eaf38fe95e2a66ac4821757e98959763b7d2628c545d3b7fc4e0a13a`.
  Immutable ECR readback and the complete scan pass with zero High and zero Critical findings.
- The exact gateway bundle and both exact document Lambda bundles were built twice, published only
  as immutable customer-KMS/versioned objects, and read back successfully. Publication did not move
  a Lambda alias, run a migration, apply Terraform, enable a trigger, or expose a route.
- The migration planner rejected the state-109 retained document baseline before Terraform because
  the current candidate correctly exceeds its narrow ancestor-delta allowlist. Development is now
  at state serial 197, and the new document binaries differ from the deployed binaries. The safe
  next engineering action is a fresh current-state CompleteDark baseline/release path; do not weaken
  the allowlist, reuse the stale baseline, or treat artifact publication as deployment.

## External and accountable gates still open

- Preserve the selected generated-synthetic policy/digest and Stage A state `204`. These are
  engineering acceptance inputs, not public durations, lawful-exclusion decisions, or accountable
  real-user approval. Elapsed time alone cannot prove backup expiry.
- The exact tenant now has the dedicated non-Zach M2M client with only `delete:users`, one verified
  `AWSCURRENT` secret version, the candidate-client-only deployed step-up Action, enabled
  OTP/recovery factors, and one disposable generated-synthetic identity. MFA-enroll and freshly
  reauthenticate that identity through the candidate web session. Then use the guarded Stage B
  operator to generate, independently review, and apply the exact saved plan before generated-synthetic export, deletion, recovery-ledger
  replay, backup-aging, alert, and zero-drift acceptance.
- Create the candidate and admin Vercel projects only under the authorized non-Zach account and run
  hosted browser, response-header, and accessibility acceptance. Vercel login is currently deferred.
- Obtain attributable product, security/privacy, accessibility, source-quality, moderation, and
  operational acceptance for the final frozen Phase 1 candidate.

No MFA-enrolled identity, Stage B plan/apply, or deployed candidate-rights acceptance is claimed.
No production PII, raw candidate artifact,
credential, token, provider response body, new AWS runtime/Terraform/database/Lambda-alias/trigger/
route mutation, Vercel login, GitHub Actions execution, real-candidate use, or Phase 1 completion is
claimed. The only AWS writes in this packet are the historical immutable ECR/S3 artifact
publications described above.
