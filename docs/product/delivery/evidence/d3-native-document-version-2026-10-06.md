# D3 native original document version — 2026-10-06

Status: implementation/focused verification; D1/D3 remain In progress and ADR-040 Proposed.

The native actor, controls and RPC completion validation previously assumed document version 1.
Documents' existing reservation increments cover-letter version for each generation on the same
application. A second preparation therefore could render valid material but fail original completion.
The new real SQL and Linux second-generation scenarios reproduced that failure; fixing the actor
alone exposed the remaining hardcoded checks. The complete path now uses the original owning version.

Documents' private original bootstrap reads its existing immutable row version with exact owner,
application, generation, context, work and consent checks. The authenticated owner composition checks
it again before returning the strict nine-scalar reply. Native startup, session, actor and controls
snapshot and validate that version before material work; completion cannot silently fall back to 1.
Missing/non-integer/out-of-range reply versions refuse. The authenticated RPC shape permits valid
material versions; actual owning completion SQL still compares the exact original document version.
Wrong-version completion cannot consume a new completion claim. No schema migration or public API
change is needed. The private bootstrap reply is incompatible with the earlier eight-scalar reply:
updated images must pin the matching numeric owner receiver; mixed versions refuse, without fallback.
Existing non-native actor/control call sites retain their explicit first-version defaults.

183 focused checks pass, including actual SDK grounding/rendering for version 2, invalid-version
refusal before provider work, strict RPC metadata and detached pinned control configuration. The SQL
fixture reserves an actual prior cover letter before the claimed preparation, so the owning reserve
assigns version 2 without editing its version column. It rejects wrong bootstrap/completion versions
and checks correct original completion. AWS task/identity/secret calls are synthetic. The maintained
Linux fixture additionally exercises image startup, rendering, direct TLS file reads and kernel
retirement with version 2; provider/owner/OIDC replies remain synthetic.

All 24 actual SQL cases and six emitted isolation cases pass. The first wrong-version SQL
assertion expected a success-shaped unavailable result; the signed client intentionally refuses it,
and the corrected rejection assertion passes. Final Linux, frozen-source full verification and
source/image identifiers are recorded after
terminal results. No deployment, cloud activation, main merge, third PR or hosted CI/CD is performed.
Managed publication/IAM/TLS/routing/provider/client/ATS/accountable acceptance remains open. The PC
stays on; owned Docker/tmpfs fixtures are removed and Docker/WSL stopped after final required checks.
