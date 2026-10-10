# D3 recovery bootstrap observations and typed inputs — 2026-10-10

D3-098 is In progress. Managed recovery exposed two tooling failures before privacy replay:
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

Focused verification and independent review are underway; full repository verification and
managed role/replay execution are pending. Earlier reviewed source recovery completed and its
computed database, secret and reader bindings passed readback; this does not establish SQL,
privacy replay, primary promotion or candidate acceptance. Development RDS is currently
available for this ongoing test session and must be shut down through the data-preserving
lifecycle before handoff. Staging was not accessed; Docker/WSL remain off and the PC remains on.
Independent D1/admin acceptance remains deferred.
