# D3 native ready receipt — 2026-10-06

Status: local implementation and full verification passed; D1/D3 remain In progress and ADR-040 Proposed.

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
logical restore, exact-image and full frozen-source results are recorded below.

No main merge by this agent, new PR, cloud publication/activation or hosted CI/CD work. Managed
IAM/routing/provider/client/ATS/accountable acceptance remains open. The PC stays on.

## Migration boundary and local regression checkpoint

All 31 native Linux scenarios pass with an assertion that the authenticated bootstrap publishes
one ready receipt. All 11 emitted isolation/CLI checks pass; only the pure scalar ready validator
was added to the material controls' exact module list. No SQL/provider/render/task capability was
added to those scalar controls. The real SQL suite passes again after database-freshness hardening.
A logical dump/restore of the owned four-owner fixture preserves migration 0013, its trigger and
two published receipts; a digest of all receipt fields matches the original database. This is
local fixture restore evidence, not a deployed seven-owner restore or accountable acceptance.

The first full run stopped at the release operator's exact Documents-0012 boundary. The explicit
allowlist now additionally accepts the complete 0013 sequence while rejecting missing, unknown
and duplicate entries. The current seven-owner restore manifest adds the normalized SQL checksum:
70 migrations, 92 relations and 12 owned schemas. Migration image smoke uses that exact file set.
Historical restore fixtures exclude the new migration and preserve their original boundaries.
All 268 release guard assertions, 50 restore units, 175 executable migration-smoke checks and the
staging restore-operator guards pass. No cloud action or managed migration execution is performed.

The first exact-image build failed during Debian dependency installation with memory-allocation
exhaustion in the local 4-GiB Docker VM. Docker/WSL were reset, without changing machine limits or
shared volumes. Build arguments now follow dependency installation, permitting that layer to be
cached across source SHAs. The next image build runs separately from the full verifier.

The image retry at source `9f9994f0caedbf0f1d016fbbe95cdf674ea2681d` succeeds. Its immutable ID is
`sha256:bd3cdf19c026f7300b14a5afa57a35063d67aad8754f12ddd1baf59053afbabf`. All four actual-image
scenarios pass, now asserting one readiness publication from each authenticated positive process,
and three hardened production startup refusals pass with exactly the fixed diagnostic. The
matching receiver ZIP reproduces byte-identically: 365939 bytes, SHA256
`feb7f88383881c9a8a33c61bbbcadee13b8f81e5a9ac18289c0f46bd46ac5ac1`, 32 dependency components.
These artifacts remain local and source-labelled; they are not published or activated.

The second full run passes operators, formatting, lint and all 38 typecheck tasks, then stops at
the current restore-manifest identity pin. The expanded manifest SHA256 is
`d16353d38b3cba30e370e9dd60cc2f31c9b984e7ec53353c1a1956ba4a172646`. The TypeScript contract and
PowerShell replay guard now require that exact hash. The generated-only cross-runtime fixture
recomputes configuration and inspection hashes; no recorded live approval is rewritten. All 207
restore-contract checks, replay checks and 908 restore-role guard assertions pass. The final
correction affects restore tooling and its fixture, not the already tested native image runtime.
The final full verification passes, as recorded below. Docker/WSL are stopped and the PC stays on.

## Final full verification and runtime restoration

Clean frozen source `481d5d9f7d4416c2be7b244873cfe2c3f930d149` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 builds, formatting,
operational/security/isolation and Compose checks. Lint remains zero errors, 15 warnings and
58 infos. Original handle `24219` reaches exit 0 with no tracked changes during verification.
Log: `.tmp/d3-native-ready-full-final-2.log`. The previously tested image/receiver/harness source
paths are byte-identical between `9f9994f0` and this full-verified commit; the final changes only
update the restore pin, generated fixture and documentation. Artifact manifests still identify
`9f9994f0`; they are not relabelled as the later full-verified commit or claimed as release approval.

The maintained launcher restores the isolated web against the live development Gateway. Home
returns 200 and anonymous `/resume` 307. The two Next-generated dev type import changes are
restored afterward; no frontend feature code or shared workspace is changed. Test-only SQL and
certificate containers/staging are removed; Docker Desktop/WSL are stopped, shared volumes retained
and PC on. No hosted CI/CD work, cloud activation, new PR or authored main merge.

The next implementation is the native preparation initializer plus read-only original receipt/
launch recovery. Applications' existing activity still uses the object-backed composition until
that adapter is connected; this batch does not claim a ready public native preparation flow.
Managed IAM/routing/TLS/provider/client/ATS and accountable acceptance remain open.
