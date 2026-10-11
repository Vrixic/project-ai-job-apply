# D3 native resume launch rejection — 2026-10-11

D3 remains In progress; independent D1/admin acceptance stays deferred.

## Implemented

The original private native-resume launcher now hashes the exact RunTask command before committing
its sole launch claim. A definitive signed SDK InvalidParameterException (HTTP 400, one attempt,
zero retry delay, exact request ID) records a separate immutable `launch_rejected` terminal state.
Owning SQL binds scope, configuration and request digest, preserves the claim, and serializes
rejection against original-task binding. No task, STOPPED receipt, generated material or submission
is invented. Timeouts, missing metadata, generic errors, retries and ambiguous outcomes stay pending.
Rejected generations permit disposal; fresh work requires an explicitly sealed new epoch.

Migration 0017 is additive; old claimed rows retain a null request digest and cannot be backfilled
or negatively settled by this path. Apply it before publishing and pinning compatible preparation,
observer and cleanup owners. The manifest and immutable-image smoke inventory now include 80
migrations; no formal database recovery-proof gate was added.

## Verification

- 72 focused launch/store/observer tests pass, including eight original-send outcome cases.
- 76 real PostgreSQL ledger tests pass, including rejection immutability, original-scope/digest
  refusal, binding races, sealed/quarantined disposal and fresh-epoch reopening. Migrations apply
  twice; the exact synthetic loopback/tmpfs test container was removed.
- Documents typecheck/build and Workflows build pass; changed TypeScript/JSON lint passes.
- 27 manifest tests, 196 production migration-smoke tests, 15 source-publication checks and 277
  synthetic release-operator assertions pass.
- The simulated Chromium search → Prepare → review → approve → manual Apply → candidate
  confirmation/history journey passes with download, withdrawal, expiry and accessibility checks.
  Authentication, remote services and extension receiver are simulated; no employer request occurs.

Consequential source review passes (receipt SHA-256 `3cd9ac9720a94b1e7934db0a34bf441a2dd680af97b3d50b2d20e994e5f3bd3b`).
Private verification logs are under `.tmp/d3-primary-recovery-20261010/`.

## Immutable artifacts and development staging

Clean main `e24a4e12686ce1c55d949b87aabaec75afed1b92` builds the corrected default-off native
worker. Its actual isolated image smoke passes 24 runtime assertions, real PDF/DOCX rendering
and shortened-fixture kernel expiry (exit 137, no OOM). AWS/identity/source ports are synthetic;
this does not prove enabled production startup or live acceptance. Image ID:
`sha256:12ad06ce144a93875b0099b346d154fd05b9ef063b2ec82cb32ee1d727d1192f`.

The local migration image builds and passes the production hardened packaging/checksum smoke
with 80 migrations and 96 relations. No database is contacted. Image ID:
`sha256:4f16f0360841d26de0e4f082442d5e33e58ed7d934d23154b020a0e34cfbad28`.
This single build is not a deterministic publication receipt or ECR vulnerability scan.

All six native Lambda artifacts are byte-identical across two builds (30 files), pass default-off
refusal, and are published as 24 versioned, encrypted, checksum-verified development S3 objects.
The exact reviewed dark RPC plan creates disabled revision-2 owner/source functions at numeric
version 1, leaving revision 1 unchanged. Readback verifies code, disabled configuration and original
task binding. Same-input resource/output drift is zero; current recovery inputs are archived with
version, encryption and checksum readback. No database, public route, launch, trigger or paid
endpoint is activated. Plan SHA-256:
`44962212913508f9651f9b2942c569e5eb034ebae613656b4f6640cd121189fd`;
review receipt SHA-256 `380f966e14ded81bb3999b0947f27a15d0c6f6346777bef8a25bbf6a05259fe1`.

The next migration publisher invocation is prepared with the owner's targeted-test instruction:
migration-component and affected native launch/store/observer tests replace unrelated owner suites;
source/account checks, dependency audit, deterministic builds, hardened smoke and ECR scan remain.
Consequential review passes; the invocation has not run or published a migration image.

Fresh development shutdown verification at 2026-10-11T18:49:53Z confirms no project database,
NAT, public IP, paid interface endpoint, running work or queued messages. Encrypted exact-source
final/safety snapshots remain available. Staging remains unchanged after its 18:01:49Z dormant
verification. Retained backup/storage/security resources still incur charges; this is not zero cost.

## Remaining

The earlier live rejected launch has no pre-dispatch digest and remains unresolved. It needs exact
original AWS request/client-token/configuration evidence and a separate owning recovery transition;
it was not resent, cleared or guessed settled. Retained CloudTrail has one same-token rejection,
but redacted request values still need original owning-row/configuration binding. The corrected
worker needs an enabled deployment-specific build and publication; migration publication,
compatible activation and live native acceptance remain.

The owner's repair enabled engine 29.7.2 and the successful builds above. A later normal restart
again fails initializing the Secrets Engine socket. Docker Desktop and WSL are shut down after
that failed restart; images and volumes are preserved and the PC remains on. The earlier socket-deletion
command remained blocked by automatic approval review and did not execute. Live AI remains off without the required 30-minute
all-copy provider policy; authorized ATS QA/fixtures and installed-provider acceptance remain open.
No live generated material or confirmed submission/history is accepted by this batch.
