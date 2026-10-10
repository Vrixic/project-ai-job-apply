# D3-100: Reconciled-copy verification and complete recovery inventory

Started: 2026-10-10. Status: In progress; batch verification pending.

Inspection and independent review found three omitted independent recovery roots: restricted
answers, cover letters and native admission. A completed deletion could otherwise be skipped
when only one remained. The shared fixed eight-owner query now includes those roots and the
remaining Documents work tables. Pending and ready cover-letter reservations also contribute
strict owner-bound object references: the read-only cloud reader requires the entire exact
`normalized/<cover-id>/` namespace to contain no versions or delete markers, including
unregistered generation siblings. It never downloads content or mutates storage.

The internal path is: immutable original replay receipt → fresh retained-marker reader →
read-only repeatable-read terminal conditions and complete 96-relation digest → unchanged-marker
recheck → aggregate result. The primitive requires the D3-099 committed preservation proof,
checks original inspection/hash/count bindings, and compares exact full rows and schema metadata.
SQL compares terminal timestamps without JavaScript precision loss. Exact accepted historical
completed inventories remain valid when all eight current owners are empty. One 90-second
deadline covers the whole read; failures, cancellation and unknown transaction acknowledgement
emit no proof. Original replay/material/approval deadlines remain unchanged.

The primitive has no deployment or promotion authority. Separate immutable numeric invocation
provenance, physical database/snapshot identity, schema/constraint verification, writer quiescence,
fresh cutover admission, private runtime composition and the dedicated promotion operator remain
required. Ordinary restore and disposable cleanup rules are unchanged. No cloud activation or
candidate-facing behavior changes are included.

The first focused pass reports 408 passing tests, including bundle isolation from replay mutation
ports. Real PostgreSQL, full repository checks and final independent review are pending. These
initial checks do not establish managed privacy recovery or live candidate/provider acceptance.
Independent D1/admin acceptance remains deferred.
