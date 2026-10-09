# Protected legacy receipt transition — 2026-10-08

Backend-only D3-077 source work, default-off. D1/D3 remain In progress.

The [managed inventory](d3-native-application-disposal-2026-10-07.md#managed-legacy-inventory-from-revision-63)
establishes seven historical create-packet receipts and one packet with approval. The original
`0009` guard remains unchanged. [Proposed ADR-043](../../../adr/043-protected-legacy-application-receipts.md)
requires an explicit atomic transition preserving original receipt metadata, digests and replay
semantics under restricted encryption, without rewriting packets, approvals or attempts.

## Implemented protection component

`backend/services/applications/src/legacy-receipt-cipher.ts` encrypts exactly the original 64-byte
ASCII digest through a dedicated symmetric KMS purpose. Context binds owner, application, opaque
protection identity, original operation and value-free receipt metadata commitment. The returned
envelope contains only version, exact encryption-key ARN and ciphertext; original digest and raw
idempotency key do not enter KMS context. A private match operation decrypts only to compare in
memory, clears SDK plaintext buffers and returns a boolean, never the digest. Caller input strings
cannot be zeroized by JavaScript.

The component pins the active key and up to eight explicit historical keys in the same account
and region. Replay-only composition cannot encrypt. Default-off or withdrawn authority, malformed
input, wrong key/algorithm, tampered ciphertext and unavailable transport fail with one fixed error.
The one-attempt SDK client uses the exact regional endpoint and no logger output. One pending
request retains admission until settlement even after the ten-second abort deadline. Input scope
and ciphertext are detached before awaits; callers must independently recheck owning authority.

## Local verification

Eighteen focused tests pass using simulated KMS transport with real local authenticated encryption.
They cover original match and changed-request mismatch, randomized ciphertext, five context
substitution boundaries, historical-key retention/withdrawal, replay-only/default-off rejection,
strict input/accessor refusal, error redaction, wrong-key/algorithm/digest output, plaintext buffer
clearing, timeout admission, authority withdrawal during decrypt and asynchronous input mutation.
Applications typechecking and all 422 unit cases pass on final source. Full maintained
`scripts/verify-phase0.ps1` passes: 38 typecheck tasks, 39 test tasks, 23 builds, all operational
guards and emitted isolation checks, Compose and scope checks. Lint remains at 15 warnings/58
informational notes. Workflows passes 1,910 cases with 123 database opt-ins skipped. Private log:
`.tmp/legacy-receipt-cipher-full-verification.log`. Nine relevant documentation links/anchors and
whitespace checks pass.
Two initial strict optional-type errors in the new component/test were fixed before the passing
typecheck and final focused run. No SQL, Docker or live KMS test is claimed for this component.

## Remaining connected work

The module has no public package export, SQL authority, migration hook or production composition.
The subsequent opt-in archive/replay implementation is recorded below. Atomic old-row transfer,
unchanged-migration integration, full original canonicalization compatibility, privacy export/restore
manifests and equality, and runtime IAM/key composition remain. Begin integration acceptance
with the actual three-ledger legacy shape, seven receipts and an original approval, then include
concurrent cross-application key reuse, failure rollback and historical-key restore cases.

No cloud state or candidate record changed. Development remains at verified state-456 dormancy;
staging verification still lacks its separate SSO token. Retained storage/security/DNS costs remain.
Docker/WSL stay stopped, the PC stays on, and hosted CI/CD remains deferred.

Fresh read-only AWS observation at 2026-10-09T03:17:58.371289+00:00 confirms no development
databases, active routes/rules/mappings, NAT gateways, interface endpoints or non-stopped ECS
tasks; all twelve encrypted recovery snapshots remain available. No runtime is reactivated.

## Opt-in archive and store replay boundary

The next source batch adds `transitions/0001_legacy_receipt_archive.sql`, explicitly outside the
migration driver. It is tested after the current fourteen Applications migrations and cannot yet
upgrade the actual three-ledger development database. Canonical migration/restore manifests stay
at 78 migrations, 95 relations and 12 schemas. No immutable migration checksum changes.

An immutable `archived_legacy` marker reserves the original `(owner, idempotency key)` using the
existing receipt primary key. It retains original application, response revision, outcome, subject
and microsecond timestamp. Its versioned hash commits only to ciphertext. A restricted archive
holds the original operation, protection ID, metadata commitment, admitted key and encrypted
original digest. Deferred pair constraints require the same application and matching ciphertext;
incomplete pairs roll back. The existing candidate deletion function removes both rows under its
original privacy authorization. Neither direct deletion nor update is newly permitted.

The optional store capability defaults off. It reads active ownership before decrypting outside
SQL locks, rechecks the exact binding afterward, and supplies an opaque process-local proof to
command admission. Final admission rechecks the proof, owner and binding under the command
transaction. Missing evidence fails unavailable instead of permitting a new write. Metadata hashing
preserves SQL bigint and UTC microsecond timestamp strings without JavaScript rounding.

Eleven real PostgreSQL 16.6 cases pass against a disposable loopback database with synthetic data
and simulated KMS transport. They cover exact create-packet replay with complete unchanged packet,
approval, revision, receipt, history and outbox rows; changed request/operation conflicts; concurrent
cross-application key reuse; incomplete/mismatched pair rollback; absent capability; no held SQL
locks during crypto; authority withdrawal and quarantine during decryption; forged/cross-owner
proofs; immutable guards; exact-owner privacy deletion; and refusal of a proof after deletion.
The fixture constructs the target archive representation; it does not exercise historical transfer.
An initial fixture timestamp was rounded by parameter serialization and correctly rejected by the
reader. Explicit text-to-timestamptz fixture insertion preserves microseconds; validation was not
weakened. Private result: `.tmp/legacy-receipt-replay-sql.log`.

Atomic pre-0009 transfer, forward migration/driver wiring, positive queue-preparation replay,
complete restore/deletion-workflow integration and runtime IAM/key composition remain pending.
No cloud data or runtime changed. Read-only AWS observation at 2026-10-09T03:29:02.717701+00:00
confirms development has no database instances, active routes/rules/mappings, NAT gateways,
interface endpoints or non-stopped ECS tasks; twelve encrypted recovery snapshots are available.
Retained storage/security/DNS charges remain. The fixture was removed and Docker/WSL stopped;
the PC remains on. Hosted CI/CD stays deferred until launch.

Final archive/replay source passes Applications typechecking and 422 unit cases, plus the complete
maintained `scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 builds, operational
and security guards, emitted bundle isolation, Compose and scope checks. Workflows reports 1,910
passed and 123 opt-in database skips. Lint baseline is unchanged at 15 warnings/58 informational
notes. Private log: `.tmp/legacy-receipt-archive-full-verification.log`. Targeted Biome checks,
local documentation link targets and whitespace checks also pass.
