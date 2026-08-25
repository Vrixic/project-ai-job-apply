# D1 candidate-rights vertical — 2026-08-25

## Outcome

The contract, persistence, durable runtime, AWS boundary, gateway, same-origin BFF, and candidate UI
for portable data export and irreversible account deletion are implemented and locally verified.
The feature is default-disabled and has not been deployed. D1-R11 and Phase 1 remain open for exact
policy selection, generated-synthetic deployed acceptance, backup-inventory acceptance, managed
identity configuration, Vercel hosting, and accountable human review.

## Implemented boundary

- Proposed ADR-027 assigns the user-visible lifecycle and orchestration to Profile while preserving
  exact owner-local export and deletion in Profile, Documents, Jobs, Matching, and Billing.
- Generated OpenAPI and event contracts cover export request/status and deletion
  request/status/cancel/confirm. A strict versioned domain schema validates the final portable
  export before encrypted artifact storage.
- Authentication projects standard `auth_time` and `amr` claims. Policy loading has no activation
  defaults, rejects partial configuration, and requires policy-bounded recent MFA for confirmation.
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

## Local verification

- Complete repository tests: 32/32 tasks. Complete repository typecheck: 31/31 tasks.
- Gateway: 111/111; workflows: 63/63; web: 41 files and 523 tests; Profile unit: 24 passed with
  six opt-in PostgreSQL cases skipped in the ordinary root run.
- API contracts: 35/35; domain schemas: 6/6; event contracts: 14/14; authentication: 8/8.
- Earlier in this exact source packet, fresh PostgreSQL 16.14 passed Profile 6/6, Documents 10/10,
  Jobs 41/41, Matching 5/5, and Billing 8/8 after the final migration checksum correction. The
  restore-manifest source suite passed 35/35 and the PowerShell staging restore guard passed. The
  subsequent pre-commit external-journal adapter changes do not alter SQL or migrations; Docker was
  unavailable for a redundant rerun and remained off.
- Terraform development and staging validate. Platform Terraform tests pass 29/29.
- Deterministic Profile durable/activity packaging passes; the latest local activity artifact SHA-256
  is `42ec1fd5a17315fa5c8036fd6ff54285f77708b128b53c9d65aa4ad5e8aabf5f` and is not deployment
  evidence.
- Docker Desktop and WSL are not running. The PC was not shut down.

## External and accountable gates still open

- Select and approve the exact policy/version digest: export lifetime, download-grant lifetime,
  recent-authentication age, rights timing, active/audit retention, backup window, backup inventory,
  and any lawful exclusions. Elapsed time alone cannot prove backup expiry.
- Populate the managed Auth0 secret with a newly authorized non-Zach M2M identity and explicit
  revocation mode, then publish/apply the reviewed AWS release and execute generated-synthetic
  export, deletion, recovery-ledger replay, backup-aging, alert, and zero-drift acceptance.
- Create the candidate and admin Vercel projects only under the authorized non-Zach account and run
  hosted browser, response-header, and accessibility acceptance. Vercel login is currently deferred.
- Obtain attributable product, security/privacy, accessibility, source-quality, moderation, and
  operational acceptance for the final frozen Phase 1 candidate.

No production PII, raw candidate artifact, credential, token, provider response body, AWS mutation,
Vercel login, GitHub Actions execution, real-candidate use, or Phase 1 completion is claimed.
