# D3-075: Exact selected-answer private Profile read boundary

Date: 2026-10-04. Backend-only, generated-synthetic local verification.
D1/D3 remain In progress. Hosted CI/CD remains deferred until production launch.

## Source and required next path

Freshly fetched main `bde17d9ed94448fb04393f295122176a875a8d2b`, then fast-forwarded
exact open #544 `8f72e13b08601d72d32d44a72c2818f18611d641`.
Branch: `feat/d3-vault-selected-read-port`.
Review: [PR #545](https://github.com/Vrixic/project-ai-job-apply/pull/545), stacked on #544.
Only delivery documentation follows verified source `fb8010b308bb6d9862fa1176fbc4330acf9e33c8`.

D3-001/D3-005 still require explicit saved-answer reuse through packet preparation and review.
The existing Profile private read selected the latest answer only by field/context and returned
no deadline. A selected packet revision needs a different owner boundary: its exact ID/version
must not silently refresh, and an approval check should not decrypt restricted values just to
check whether that revision remains current. The deadline must be available for admission after
Applications lock waits. This checkpoint implements those Profile reads; it does not redefine
complete reuse as a reader or claim a candidate journey.

Required full path remains: explicit candidate field/question/context/ID/version selection →
Gateway → Profile-owned exact selected read → immutable hash-bound packet with exact provenance →
mandatory review → Profile metadata checks at approval/start/dispatch → transaction-time deadline
check → submission permission or truthful refusal. No jurisdiction is inferred from a job location.

## Implemented boundary

- Private `RestrictedAnswerReuseReader` grants selected-value and current-reference reads only.
  It exposes no save/delete/list/export capability and adds no HTTP plaintext route.
- `readSelectedValue` detaches owner/ID/version/field/context before any await. Its initial SQL
  applies the requested ID/version to the latest revision before KMS; unavailable selections
  cannot become a newer value. Existing post-decrypt revalidation plus a final exact metadata
  read withhold correction, deletion, expiry or quarantine, including same-value correction.
- `readCurrentReference` projects only exact reference metadata and the original immutable
  expiry deadline, with no ciphertext/KMS access. It requires the latest active revision,
  exact owner/field/context and database wall-clock freshness; historical matching versions
  cannot survive a newer tombstone. No plaintext-derived hash is introduced.
- Malformed UUID/version/field/context inputs refuse before SQL; invalid expiry receipts refuse.
  Context is copied as-is; only the existing absent-context identity becomes an empty string.
- No SQL lock spans decryption. Receipts remain point-in-time owner reads, not atomic
  cross-owner leases. Consumers must recheck `validUntilEpochMs` after their own lock waits.
- Existing `readActiveValue` return shape, selection semantics and candidate-export portability
  remain unchanged. No REST/domain/event schema, generated client, migration, operational guard,
  Terraform, frontend, provider/network call, activation flag or deployment changes.

[Owner source](../../../../backend/services/profile/src/restricted-answer-vault.ts),
[unit regressions](../../../../backend/services/profile/src/restricted-answer-selection.test.ts),
[SQL regressions](../../../../backend/services/profile/src/restricted-answer-selection.integration.test.ts).

## Local verification

- 48 focused unit cases pass: existing 24 plus 24 new selection/deadline/identity/input cases.
  `.tmp/d3-075-unit-final.log`. Profile build and scoped Biome pass.
- All 46 real PostgreSQL Profile integration cases pass (eight new selection cases). They cover
  metadata reads without a cipher; exact owner/field/context/ID/version; no decryption on an
  unavailable selection; correction/deletion/quarantine while decrypting; expired selections;
  expiry while KMS is pending; immutable deadline; and same-value version correction.
  `.tmp/d3-075-profile-postgres-final.log`. KMS is simulated, SQL and owner state are real.
- PostgreSQL 16.14-alpine, owned tmpfs `ai-job-apply-d3-075-pg`, loopback port 55443, disposable
  `vault_selected_d3_075` database. Profile migrations apply and replay successfully without
  source migration changes. No production PII or raw artifacts are used.
- Full maintained verifier passes on clean source `fb8010b308bb6d9862fa1176fbc4330acf9e33c8`,
  terminal exit 0 with `Phase 0 repository verification passed.`: 38 typecheck tasks, 39 test
  tasks and 23 builds. Profile 120 units with 46 database opt-ins skipped; Gateway 298 units
  with 15 opt-in skips; Workflows 1,588 units with 57 opt-in skips. The Profile SQL cases above
  ran separately against PostgreSQL. Formatting, contract, security/operational, restore,
  Compose and emitted-isolation checks pass. Existing lint baseline remains 0 errors,
  15 warnings and 58 informational notes. `.tmp/d3-075-full-verification.log`.
- Exact owned fixture removed, Docker Desktop stopped and WSL shutdown completed, terminal
  exit 0; shared volumes retained. Only delivery documentation follows verified source.

## Remaining acceptance

No Applications/Gateway production consumer is composed yet. Explicit semantic question/context
selection, packet/API/export metadata, packet hashing, source-version invalidation and its truthful
persisted reason/restore compatibility, transaction-time expiry, asynchronous cover-letter
preparation participation, candidate review/save UI and compatible release remain. Test this full
path with real owner SQL and authenticated HTTP before asking for human acceptance.

No browser acceptance is claimed for an internal Profile port. The saved-answer review/reuse UI
and enabled adapter executor are unavailable; their actual journeys remain D3-005/D3-007/D3-013/
D3-019. Dedicated key activation and D3-012 accountable restricted-data approval still gate real
candidate use. Nothing is published, deployed, activated or submitted; no phase exit is closed.
