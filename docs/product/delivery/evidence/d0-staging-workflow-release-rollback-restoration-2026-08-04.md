# D0 Staging Workflow Release Rollback and Restoration — 2026-08-04

## Scope

This record covers the independently reviewed staging workflow second release, rollback to the
accepted initial release, conformance of that rollback release, restoration of the accepted current
release, restored-release conformance, notification delivery, and local recovery cleanup. It is
D0-016 synthetic-staging dark-deployment evidence only. It does not authorize public routing,
replacement triggers, ECS resume, production data, cutover, or legacy-runtime retirement.

No account identifier, ARN, endpoint, bucket/object identifier, credential, secret, candidate
value, raw payload, raw log, notification destination, or product record is retained here.

## Accepted releases

The cycle ran from exact clean synchronized `main` at `006dbe9`. The accepted current workflow
release source was `08724743634f859a8111f4a02bbbb0813cff9c7a`; the accepted rollback source was
`a68f36d5f55521c0221df38d9d1d4c375d88824d`. Both had already passed protected publication,
immutable-artifact read-back, checksum-authorized deployment, full dark conformance, end-to-end
notification delivery, and refresh-backed zero drift.

The rollback coordinator initially exposed a local plan-filename collision before any AWS change:
the strict planner reused the retained current-plan filename. The existing checksum guard rejected
the altered input. PR [#133](https://github.com/Vrixic/project-ai-job-apply/pull/133) fixed the
coordinator to copy both accepted endpoints into checksum-verified isolated snapshots before
planning. A fresh exact-main plan then passed with both snapshot hashes intact.

## Rollback

The accepted reverse plan checksum was
`2626072975e1859cbee56557e9a881e9f4de082cc3452e8a5d23d37230880d0d`. Independent semantic
inspection proved exactly fourteen allowlisted in-place updates, one create-before-delete
policy-propagation gate, zero standalone creates/deletes, exact rollback-artifact binding, four
unweighted aliases, a disabled terminal rule, idle ECS, and no API, trigger, data, database, or
traffic action.

Only that explicitly authorized saved plan was applied. Post-apply verification proved the
accepted rollback source active at zero drift with disabled replacement triggers, idle retained
ECS services, and unchanged public routing.

The separately authorized rollback-release conformance checksum was
`de24a2fa594b1cfab6ed0e21a9c00b89e2ac4ec3064a9c48d87929e5915e16d0`. Its four exact-version
synthetic probes passed: the synchronous handlers reached their reviewed rejection boundaries and
the exact durable version failed closed. Exactly one byte-identical synthetic DLQ message was
removed, both owned alarms completed `OK → ALARM → OK`, all seven workflow alarms recovered, and
the context removed itself. The product owner confirmed receipt of both `ALARM` and both `OK`
notifications.

The fresh post-conformance zero-drift checksum was
`fd975399b25a4bf4602e472011808ccd100ab3a99a019ffcf7a619de72070f50`. Aggregate-only inspection
found seven events across three streams, one expected rejection, zero unexpected error/failure
patterns, and zero credential, token, connection-string, or email patterns. Raw logs were not
retained.

## Restoration

The independently reviewed restoration checksum was
`0b1fab170aaa3262759bf7bc9cf7c6f190e3868d7bc64a6aad89acf44c9c1b5c`. It mirrored the rollback
boundary exactly: fourteen allowlisted updates, one propagation-gate replacement, zero standalone
creates/deletes, exact current-release artifacts, disabled triggers, idle ECS, and no public-route,
product-data, database, or traffic action.

Only that explicitly authorized saved plan was applied. The accepted current release was restored
and immediately verified at zero drift.

The separately authorized restored-release conformance checksum was
`940728f8508d10b5636fbaa95c22306ddbf20afbe2626422f05549e142939019`. It repeated all four
fail-closed probes, exact one-message DLQ cleanup, four alarm transitions, empty-queue recovery,
unchanged live boundary, and context removal. The product owner again confirmed receipt of both
`ALARM` and both `OK` notifications.

The final post-run zero-drift checksum was
`e3d8735bf676231613fb975d0eb6b0e54511a97e7a071d9ebe39ab2c5fc4ff06`. All seven alarms were
enabled and `OK`; the DLQ was empty; aggregate logs again contained seven events across three
streams, one expected rejection, zero unexpected errors/failures, and zero forbidden sensitive
patterns.

## Cleanup and result

Final coordinator cleanup re-proved the restored release at zero drift, removed the active
reverse/forward plans and context, and made no AWS change. The two isolated endpoint snapshots and
two quarantined files from the caught pre-apply collision were then removed from the exact ignored
recovery directory. No rollback, restoration, conformance, snapshot, or quarantine context
remains.

The staging coupled workflow release rollback/restoration gate passes. SR-006 remains in progress
for authenticated gateway acceptance, controlled staging cutover, post-cutover rollback-window
acceptance, and the later development cutover. ECS and Temporal rollback resources remain retained
until replacement acceptance and explicit expiry.
