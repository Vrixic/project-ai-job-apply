# D3-099: Transactional replay data preservation

Started: 2026-10-10. Status: In progress.

Replay source now hashes the complete fixed 96-relation inventory inside PostgreSQL, with exact
authorized deletion projections. It compares unrelated whole rows before and after deletion in
the same serializable transaction, then fingerprints the complete reconciled copy. Only hashes,
counts and versioned metadata leave SQL. Work shares fixed row, byte and deadline bounds;
cancellation, changed data or commit failure produces no attestation. Original expiry is unchanged.

The real PostgreSQL pass exposed an exact-marker request restored before confirmation: its
operation is legitimately null. The predicate now includes only that exact user's/request's
constrained requested/null state alongside the exact operation binding. Existing preflight
collision checks remain. This fixes a false preservation refusal without exempting unrelated
same-user requests.

Initial 347 focused tests and 790 generated operator assertions pass; additional contract and
real PostgreSQL regression verification, independent final review and full repository checks
are in progress. Earlier failing runs are retained privately; they are not passing evidence.

This batch is transactional preservation only. The dedicated snapshot selection, primary
promotion, fresh postrestore proof, managed privacy replay and connected candidate journey remain
internal work. [ADR-048](../../../adr/048-privacy-reconciled-development-recovery.md) is proposed;
no ordinary restore/cleanup guard is relaxed. Independent D1/admin acceptance stays deferred.
