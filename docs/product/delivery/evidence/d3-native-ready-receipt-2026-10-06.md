# D3 native ready receipt — 2026-10-06

Status: local implementation and verification in progress; D1/D3 remain In progress and ADR-040 Proposed.

The native task can render material, but Applications' preparation activity needs the actual
grounded fact identifiers and confidence before it can write its ready packet. The old completion
reference records only original identity/hash/times. This batch supplies the scalar readiness
handoff; the native preparation initializer/recovery port still needs to consume it.

The native runtime publishes readiness over authenticated owner RPC only after original completion,
current source verification and both in-process renderers succeed. It publishes the actual grounded
fact IDs/confidence, never inferred IDs from the input or generated text. The control port pins the
positively acknowledged original completion, permits one readiness attempt, waits for the original
RPC to settle and refuses replay, retargeting, expiry or legacy unauthenticated fallback. Failure
retires the native process; it never certifies remote death or grants new provider work.

Documents migration `0013_native_material_ready` adds two nullable scalar columns on the existing
owned cover-letter row, a strict constraint and an immutable readiness trigger. Publication checks
active identity, exact original work/reference/version/hash/timestamps, settled failure-free work
and database-time lifetime. Database freshness is checked after acquiring the work lock as well as
at the update. Idempotent exact receipts are allowed at the owner, while conflicting receipts refuse.
Existing rows remain NULL with no backfill. Old receivers refuse the new private `publish_ready`
action; deploy the migration and updated numeric receiver before an updated enabled image.

Candidate export includes the exact scalar receipt, even if expired; this does not make expired
material readable. Deletion cascades through the existing owned row. No generated bodies, prompts,
certificate/key, proof headers or candidate fact values enter SQL, durable workflow state or logs.
The metadata follows existing cover-letter row retention; this is not an approval or retention waiver.

Main advanced to independently merged #564 `19f72c5a`. Its conflicting files were byte-identical
to the previously inspected #564 source `bd23437c`; resolving the squash merge preserved the later
verified backend source. Merge commit `cdeaa8af` has the same tree as the previous verified branch.

122 focused checks pass. The 24 real PostgreSQL integration cases pass, including readiness before
completion, wrong version, exact publication/replay, conflicting confidence, SQL mutation refusal,
candidate export and sealed admission. AWS/identity transport remains synthetic. Linux regression,
logical restore, exact-image and full frozen-source results will be recorded after terminal checks.

No main merge by this agent, new PR, cloud publication/activation or hosted CI/CD work. Managed
IAM/routing/provider/client/ATS/accountable acceptance remains open. The PC stays on.
