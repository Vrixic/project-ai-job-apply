# D3-100: Reconciled-copy verification and complete recovery inventory

Started: 2026-10-10. Status: Complete for repository implementation.

[PR #633](https://github.com/Vrixic/project-ai-job-apply/pull/633) merged as
`287216a641619cc616c1b0e2e8bf7b9ed74d3e0f` after independent exact-head review of
`20fd5f6524bc559b868622dcbae1bdefbfab4fdf`. Hosted quality CI did not start because of
account billing/spending restrictions; the normal merge used no bypass. Local checks are below.

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

Source `1a5b57253fe9a2ef580d46fd8109fa6bfdae4d01` passes 500 focused tests,
17 real PostgreSQL 16.6 regressions and all 43 repository verification stages. The database probes
cover the three independent roots, read-only enforcement, exact timestamp binding, historical
completed inventories and nine corruption cases with rollback. Cloud transport, retained-marker
provenance and KMS are simulated; this is not managed recovery acceptance. Independent review
confirmed the exact committed source, PostgreSQL results and final delivery records. Its private
receipt `independent-d3-100-head20fd5f65-final-review.json` has SHA-256
`03a85ab8a428cad37dd4fe38d71e4a58440c0615f9b522bb36cda879320a89ee`.

Private aggregate logs under `.tmp/d3-dark-primary-recovery-20261010/`:

| Check | Log | SHA-256 |
|---|---|---|
| 500 focused tests | `reconciled-copy-focused-v2.log` | `b2ab1e47185bc65811ebd59206292b3f92fb7297f53d0eb9b2529eb951c82257` |
| 17 PostgreSQL regressions | `reconciled-copy-postgres-v2.log` | `9ffa9bd353ea7ed58d555bf42b08fe0359d85732eb7645ed88557b275207fb30` |
| 43 repository stages | `reconciled-copy-full-verification.log` | `59273cfcf7a97936df17e5f642b15d306621b1462de8c5fd8045a4ab42996012` |

No AWS runtime was activated in this batch. The latest credential check still reports an expired
development SSO token after the reported renewal, so fresh cloud readback is unavailable. The last
independent development off proof is the D3-099 21:40 UTC dormancy closure; it is not a new readback.
The isolated PostgreSQL container was removed, Docker Desktop is stopped and WSL has no running
distributions. The PC remains on. Retained recovery/security resources still incur charges.

The D3-099 simulated connected browser journey remains the latest browser evidence; this batch
changes recovery behavior only. No live candidate, provider submission, sanitized primary
promotion or accountable privacy acceptance is claimed. Greenhouse execution, private verification
runtime/promotion wiring, managed recovery and compatible live release remain internal work.
Independent D1/admin acceptance remains deferred.
