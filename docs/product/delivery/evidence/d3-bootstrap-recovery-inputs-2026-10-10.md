# D3 recovery bootstrap observations and typed inputs — 2026-10-10

D3-098 repository implementation and verification are complete. Managed recovery exposed two tooling failures before privacy replay:
the restore-role guard sent bootstrap refresh observations through a platform-only KMS guard,
and the dark baseline serialized null object inputs as empty environment expressions.

The bootstrap plan uses the complete twelve archived inputs, not the obsolete six-input set.
The obsolete plan was never applied. The complete plan proposes no resource/output actions,
but has seven refresh observations: six retained native policy tag normalizations and one
deployment role computed-policy observation. The new bootstrap-specific guard binds these to
unchanged plan-owned resources and the exact separately owned deployment child policy. It
rejects duplicate, unrelated, unknown and malformed observations and preserves original state.
Platform validation retains its existing boundary.

The dark baseline now serializes explicit null as `null`, binds all typed inputs through a
temporary explicit variable file, and restores absent environment keys separately from empty
values. The file is removed in the existing finally cleanup. This also covers Windows PowerShell
5's inability to propagate empty environment strings to native children.

The subsequent typed cloud plan proposes no actions but reports the restored database's empty
metadata/forward backup clock and the reader role's computed policy refresh. The dark guard
now admits only these exact source-bound observations, with unchanged database settings and all
three reader policies bound to unchanged owned children. Other policy/network/credential changes,
unknown values, malformed metadata and unrelated observations refuse. This is action-free with
bounded observations, not strict zero observed drift. The initial full verifier was interrupted
to finish this discovered adjustment; it is not a passing full run.

All 1,015 generated restore-role assertions and 155 dark-recovery cases pass. The latter pass in
PowerShell 7 and Windows PowerShell 5, including real child-process input checks. Their private
logs share SHA-256 ad2527f250bc55f223d08d9e35666e0db1864b9e2bf33b06f9cb37c90f928f05.
Independent source review passes with no blocking findings. All 43 repository verification stages
pass from source `9d8e34916336bdddf1ba661ed714518cd43a6f18` (original invocation 66220,
terminal exit 0). Full log SHA-256: `a05945aed9021f5f2eda5542993c002cf5b768198e7afeeaadeb127718c531cf`.
Maintained read-only dark Status also passes with the source database available and writers off.
Managed role/replay execution remains pending. GitHub checks could not start because of account
billing/spending limits; local verification does not establish hosted check acceptance. Earlier reviewed source recovery completed and its
computed database, secret and reader bindings passed readback; this does not establish SQL,
privacy replay, primary promotion or candidate acceptance. Development RDS is currently
available for this ongoing test session and must be shut down through the data-preserving
lifecycle before handoff. Staging was not accessed; Docker/WSL remain off and the PC remains on.
Independent D1/admin acceptance remains deferred.
