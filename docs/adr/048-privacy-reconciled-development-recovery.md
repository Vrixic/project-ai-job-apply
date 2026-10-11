# ADR-048: Privacy-reconciled development recovery

Status: Proposed; source implementation and managed acceptance pending
Date: 2026-10-10

An isolated deletion replay does not make a historical primary safe to serve. Ordinary PITR
cleanup deliberately removes the disposable target and forbids retained snapshots. Ordinary
development restoration selects a snapshot of the canonical primary. Preserve those boundaries.

Use a separate, default-off development recovery procedure. Bind the original verified isolated
target, successful numeric replay invocation, immutable completed-marker versions, current
schema manifest, exact source and private network. Reject ambiguous replay or advancing markers.
Never extend or reinvoke an expired replay. A later cutover has separate fresh admission authority
and does not renew candidate material, approval or original work deadlines.

Before committing replay, compare whole-row digests for the fixed manifest inventory outside the
exact authorized deletion roots. Preserve unrelated durable records even for the same candidate;
exempt only the matching request/operation and the owning deletion functions' exact projections.
Hash rows inside PostgreSQL; return aggregate hashes/counts only. Bound rows, bytes, query time
and total work. Failure rolls back the transaction. Emit preservation evidence after commit.
Old replay success without this evidence cannot authorize selection.

Before cutover, retain one explicitly reviewed encrypted reconciled snapshot and verify physical
restoration and full-data equality. Preserve the previous primary's safety/final snapshots and
rollback lineage. Independently review the exact full-input primary replacement and required
secret/reader/IAM bindings with every route, writer and trigger off. Verify schema, whole-data
digests, deletion postconditions and fresh marker horizon before separately admitting traffic.

Archive versioned recovery evidence, then remove exact temporary compute, databases, permissions
and network resources. A dedicated cleanup procedure may retain only the reviewed recovery
snapshot; ordinary disposable cleanup gains no exception. Finish with data-preserving primary
dormancy. This procedure does not establish accountable privacy or candidate acceptance.

The first source batch adds transactional preservation evidence; snapshot selection, primary
replacement, fresh postrestore verification and managed acceptance remain pending.

The next source batch adds an internal read-only full-data/terminal-condition verifier and fixes
independent Profile/Documents recovery inventory and cover-letter namespace checks. Its aggregate
output alone does not establish numeric invocation provenance, writer quiescence, physical source
identity or cutover admission. Private runtime and promotion composition remain pending.

The private runtime source now composes fresh, separate admission, current schema verification,
read-only SQL, document-version continuity and a final marker-horizon check. It closes the database
before returning aggregate evidence. Source tests and local artifact smoke do not authorize
cutover: the guarded operator, immutable publication, physical restore and managed promotion
evidence remain pending. See [D3-102](../product/delivery/evidence/d3-reconciled-copy-runtime-2026-10-10.md).
