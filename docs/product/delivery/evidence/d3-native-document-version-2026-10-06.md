# D3 native original document version — 2026-10-06

Status: local implementation/full source verification; D1/D3 remain In progress and ADR-040 Proposed.

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

All final checks pass: 183 focused, 24 actual SQL cases, 31 Linux scenarios and six emitted isolation
cases. The first wrong-version SQL assertion expected a success-shaped unavailable result; the
signed client intentionally refuses it, and the corrected rejection assertion passes. After the
version-two failure was fixed, a concurrent-build run exceeded the existing delayed-start parent
measurement (7.6 seconds with a 7-second test limit). The isolated unchanged-code rerun passes all
31 cases, including delayed startup in 6.0 seconds and version-two reads in 5.6 seconds. No deadline,
refusal or timeout is weakened; that resource-sensitive timing remains a local test limitation.

Original maintained verifier handle `61852` completes with exit 0 for clean frozen source
`1b826b5cbf21e000831dee2a588187d46f22259c` and explicit ARTIFACT_SOURCE_SHA: 38 typecheck tasks,
39 test tasks, 23 builds, zero lint errors/15 warnings/58 infos and all maintained operator/security/
isolation/Compose/scope checks, with unchanged tracked source. Logs are ignored under `.tmp`:
`d3-native-version-full.log`, `d3-native-version-linux-final.log`, `d3-native-version-sql-final-2.log`,
`d3-native-version-focused-2.log` and `d3-native-version-bundles.log`.

The exact-source local native image is
`sha256:87eace2c11417a2d1bb212bfca96c3490948bae2cff8da776737519d634345f6`, Linux/AMD64 Node 24,
UID/GID 65532, /materials and the launcher-required entrypoint/command. Its manifest records source
`1b826b5cbf21e000831dee2a588187d46f22259c`, configuration SHA
`b5f5c4b4df340cb361f2d33040beed66204ba1aca5216cabb5290783865c35dc`, kernel SHA
`79660bd4e5213dc84c240825bae4df91be54f163b45840d0f4f1833c5dfa5d93` and runtime bundle SHA
`8c8bafb4ebe8fa9518b2f205e828fd3a2014f312447b998a07771121b2758059`. Default-off startup, extra main
arguments and an environment provider key each refuse with exactly the fixed diagnostic and exit 1
under read-only/no-network/no-logging/dropped-capability/no-new-privileges/zero-core/bounded limits.
These actual-image checks cover cold refusal, not enabled AWS/provider/routing conformance.

The matching source-bound private owner receiver ZIP builds twice byte-identically: 365255 bytes,
SHA `df188d96bd3d4d1b915526d36aac4424a578cf3035b551480e56a3aa015f9918`, 32 components, default-off
bundle refusal. It remains local and unpublished. The image and receiver both need the coordinated
reviewed numeric-version release; no managed function version is created here.

No deployment, cloud activation, main merge, third PR or hosted CI/CD is performed. Managed image
publication/IAM/TLS/routing/provider/client/ATS/accountable acceptance stays open. Owned SQL tmpfs
fixture and Linux staging are removed; Docker/WSL stopped, PC on. The maintained web launcher restores the live-development API connection: home 200 and
anonymous resume 307, without following redirects. The two generated Next dev-type imports are
inspected and restored. Original frontend source is unchanged; this proves server routing, not
new signed-in UI or deployed native acceptance. The local Linux flow's AWS/provider/owner/OIDC replies are
synthetic; real SQL/render/TLS/kernel behavior is independently exercised. No candidate payload,
real token/secret or raw artifact enters this evidence.
