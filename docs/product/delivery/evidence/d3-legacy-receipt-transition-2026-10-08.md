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
Versioned archive/transition SQL, unchanged-migration integration, cross-table key uniqueness,
every-command replay admission, original canonicalization compatibility, privacy deletion/export,
restore manifests/equality and runtime IAM/key composition remain. Begin integration acceptance
with the actual three-ledger legacy shape, seven receipts and an original approval, then include
concurrent cross-application key reuse, failure rollback and historical-key restore cases.

No cloud state or candidate record changed. Development remains at verified state-456 dormancy;
staging verification still lacks its separate SSO token. Retained storage/security/DNS costs remain.
Docker/WSL stay stopped, the PC stays on, and hosted CI/CD remains deferred.

Fresh read-only AWS observation at 2026-10-09T03:17:58.371289+00:00 confirms no development
databases, active routes/rules/mappings, NAT gateways, interface endpoints or non-stopped ECS
tasks; all twelve encrypted recovery snapshots remain available. No runtime is reactivated.
