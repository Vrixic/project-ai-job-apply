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

## Atomic historical transition and canonical forward migration

The next connected batch promotes the opt-in schema into immutable forward migration
`0015_legacy_receipt_archive.sql`; the earlier transition-file location is historical. The actual
migration driver verifies the archive relation, five enabled guards, deferred pairing, two owning
FKs and authorized deletion body. The canonical restore manifest and image-publisher checks now
require 79 migrations and 96 relations across twelve schemas. Existing migration bytes/checksums
remain unchanged. Fifty manifest/restore unit cases pass, retaining historical manifest fixtures.

`legacy-receipt-transition.ts` provides an explicit default-off maintenance capability, outside the
normal migration driver. It admits checksum-matched three-through-eight Applications ledgers,
1000 or fewer legacy receipts, no more than 10000 rows per owning relation, active owners and the
supported table boundary. It snapshots exact owning row fingerprints, columns, constraints,
triggers and functions. Original digests are encrypted and round-trip checked outside SQL locks.
The final transaction takes the ordinary migration advisory lock and exclusive table locks, then
rechecks inventory and ownership. It moves the original receipt table to a revoked staging schema,
constructs the replacement with original constraints/indexes/defaults and owning guards, copies
ordinary receipts, runs the unchanged migrations, and inserts the encrypted legacy representation.

Before commit it compares every original application/packet/approval/attempt/history/outbox column,
ordinary receipt row, and protected receipt metadata in both directions. New columns use migration
defaults. Deferred pairs must validate. Old table/staging removal uses RESTRICT, never CASCADE;
no immutable trigger is disabled. Missing authority, crypto failure, drift, invalid packet values or
unexpected dependencies roll back all schema and data changes. SQL errors are redacted to one fixed
failure. No original digest or candidate value is returned or logged. Existing backup/WAL retention
still applies to historical plaintext; this is not a retroactive backup rewrite.

Eight real PostgreSQL 16.6 cases pass: seven historical receipts plus one approved packet from the
three-ledger schema, preserved original create-packet replay, original queue-preparation identity
from the eight-ledger schema, failed encryption, authority withdrawal, concurrent receipt insertion
with no crypto-held SQL locks, restricted-plaintext rollback, and late dependency rollback from an
unexpected view, and refusal of unknown receipt metadata. The fixture initially needed its circular application/packet insertion wrapped in
one transaction, a valid historical status, and comparison that accounts for newly defaulted columns;
those fixture errors were fixed without weakening production guards. Private log:
`.tmp/legacy-receipt-transition-sql.log`.

All eleven archive/replay cases also pass through the actual current compiled migration driver;
private log `.tmp/legacy-transition-forward-sql.log`. KMS transport is simulated in both suites.
All seven actual service migration drivers pass on the populated synthetic database. PostgreSQL
`pg_dump`/`pg_restore` into a distinct database succeeds; the real aggregate verifier accepts both
79-migration/96-relation boundaries and all 96 complete relation row sets match exactly, including
eight archive rows. Private evidence: `.tmp/legacy-transition-restore.log`. This is local logical
restore evidence, not an AWS snapshot or live KMS test.

Remaining: managed maintenance command/operator with verified drain and recovery prerequisites,
exact immutable image/release packaging, IAM/key composition for transition and runtime replay,
full queue-preparation store acceptance, candidate-deletion recovery acceptance and live managed
transition. The ordinary migration path does not activate this capability or bypass 0009. D1/D3
remain In progress. No cloud runtime or candidate data changed. The owned temporary container was
removed and Docker/WSL stopped; PC stays on and hosted CI/CD remains deferred.

### Final verification of the atomic-transition batch — 2026-10-09

Source commits `cf99c702` and `444a61d9` complete this local batch. The deletion-recovery TypeScript
and PowerShell contracts now pin the new manifest byte hash, and the synthetic cross-runtime
configuration/inspection hashes are regenerated. All 299 focused recovery tests and 697 generated
PowerShell recovery assertions pass. Image-publisher/runtime-package guards pass after updating the
Dockerfile inventory and ensuring the new SQL file uses canonical LF bytes. No image is published.

Every check in the maintained `scripts/verify-phase0.ps1` sequence passes across the recorded runs.
The first run exposed the committed-source requirement of the migration operator test; committing
the source resolved it. The committed run passed all checks before formatting, then detected CRLF
in two rewritten files. Normalizing them produced no Git diff. The exact remaining verifier commands
were resumed from formatting, without skipping a check. That run found the stale deletion-recovery
manifest pin, which was corrected and its affected PowerShell/TypeScript checks repeated. The final
formatting-through-completion run passes: 38 typecheck tasks, 39 test tasks, 23 builds, dependency
regressions, emitted isolation, Compose and scope checks. Applications reports 422 unit cases;
Workflows reports 1,910 passed with 123 database opt-ins skipped. Lint remains 15 warnings/58
informational notes. The full top-level script did not finish in one uninterrupted successful run;
this records the complete passing check sequence and its resumed execution accurately.

Private logs: `.tmp/legacy-receipt-transition-final-verification.log`,
`.tmp/legacy-receipt-transition-final-remainder.log`, `.tmp/legacy-transition-operator-tests.log`,
`.tmp/legacy-transition-publisher-tests.log`, `.tmp/legacy-transition-recovery-focused.log` and
`.tmp/legacy-transition-recovery-powershell.log`. Local documentation targets and whitespace checks
pass. No UI/browser test is claimed for this backend maintenance change.

Read-only AWS observation at 2026-10-09T03:52:08.281444+00:00 confirms no development databases,
active routes/rules/mappings, NAT gateways, interface endpoints or non-stopped ECS tasks; twelve
encrypted manual recovery snapshots remain available. Runtime mutation is false; state-456
recovery remains the last verified shutdown. Retained storage/security/DNS costs remain. Docker
Desktop/backend processes and running WSL distributions are absent; the PC stays on.
