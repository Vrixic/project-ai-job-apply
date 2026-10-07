# D3 actual native image conformance — 2026-10-06

Status: local actual-image and full-source verification passed; D1/D3 remain In progress and ADR-040 Proposed.

An explicit generated-only verifier runs the production image's actual bundled image factory,
canvas assets and compiled kernel. It verifies manifest file hashes and source SHA, then exercises
version 1 and version 2 generation, real PDF/DOCX rendering, authenticated direct HTTPS reads and
kernel retirement. Separate processes exercise pinned secret-version and TLS-host refusal before
provider work. AWS, provider and identity responses are synthetic; networking is disabled. The
test supervisor's fallback kill cannot count as kernel retirement. Production rejects test seams.

The first actual-image attempt exposed PDF's lazy canvas resolution: esbuild's CommonJS output
left `import.meta.url` undefined. Cold startup refusal had not exercised that parser path. The
builder now binds this value to the image's fixed runtime location so the actual bundled native
canvas dependency resolves. The first test supervisor also exceeded its 16-process/thread limit;
the local bounded fixture now permits 64, including parent, child, renderer and deadline threads.
No production task limit, expiry or retirement assertion is weakened.

The certificate/key are generated fixtures only. Exact-labelled containers and the checked owned
staging directory are removed after each run. The maintained emitted-bundle suite includes CLI
rejection of missing opt-in, mutable tags and malformed source before Docker. Terminal image,
Linux regression and full-source verification results are recorded below.

No cloud publication, activation, hosted CI/CD work, main merge or new PR. Managed task IAM,
TLS/routing, real provider, client/ATS and accountable acceptance remain open. The PC stays on.

## Terminal verification

Clean source `44c0c354640f855336d735c0012c703885000967` builds immutable Linux/AMD64 image
`sha256:e4fc6922bfbdc3295efc41600fdc269a2bc96d83341bee5983632252b215d590`. The image uses
Node 24.18.0 and its production nonroot user, bundle, canvas and compiled kernel. Four explicit
conformance scenarios pass with empty stderr: original versions 1/2, secret-version refusal and
TLS-host refusal. Both positive scenarios generate once, settle three original controls, serve
real PDF/DOCX over authenticated HTTPS and die by kernel SIGKILL without supervisor fallback.
AWS/provider/OIDC remain synthetic; this is not managed live end-to-end acceptance.

The previous image `sha256:87eace2c11417a2d1bb212bfca96c3490948bae2cff8da776737519d634345f6`
fails this positive conformance on lazy parser warnings. The corrected image above replaces it
for local positive proof. The old cold startup refusals remain historical valid refusal evidence.

All 31 maintained Linux regression scenarios pass, four emitted bundle/CLI checks pass, and
three hardened production startup refusals pass (disabled configuration, extra main argument,
synthetic environment provider key). The first manual startup check expected the wrong fixed
diagnostic; corrected to the source's `NativeImageConfigurationUnavailable`, all three pass.
No production behavior was changed to satisfy that harness mistake.

`scripts/verify-phase0.ps1` passes on the same clean frozen commit: 38 typecheck tasks, 39 test
tasks, 23 production builds, formatting, operational/security/isolation and Compose checks.
Lint remains zero errors, 15 warnings and 58 infos. No tracked files changed during the run.
Logs are ignored `.tmp/d3-native-image-conformance-{build,final,full}.log` and
`.tmp/d3-native-image-linux-regression.log`. Original full run handle `66992` reached exit 0.

Owned labelled containers and synthetic certificate staging are removed. Docker Desktop and
WSL are stopped; shared volumes are retained and the PC stays on. The isolated development web
is restarted through the maintained launcher against the development Gateway. No real key,
candidate content, token or raw browser log is added to this evidence.

Restored local web responds home 200 and anonymous `/resume` 307. Only the two Next-generated
dev type import changes were restored; the shared frontend workspace remains untouched.
