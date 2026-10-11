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

Consequential source review passes (receipt SHA-256 `3cd9ac9720a94b1e7934db0a34bf441a2dd680af97b3d50b2d20e994e5f3bd3b`). Managed publication remains pending.
Private verification logs are under `.tmp/d3-primary-recovery-20261010/`.

## Remaining

The earlier live rejected launch has no pre-dispatch digest and remains unresolved. It needs exact
original AWS request/client-token/configuration evidence and a separate owning recovery transition;
it was not resent, cleared or guessed settled. The corrected worker and compatible migration/control
release still require immutable build, publication and live native acceptance.

The owner repaired Docker startup; its engine responds as 29.7.2. The earlier socket-deletion
command remained blocked and did not execute. Live AI remains off without the required 30-minute
all-copy provider policy; authorized ATS QA/fixtures and installed-provider acceptance remain open.
No live generated material or confirmed submission/history is accepted by this batch.
