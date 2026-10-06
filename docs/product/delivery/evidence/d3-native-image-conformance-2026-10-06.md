# D3 actual native image conformance — 2026-10-06

Status: implementation and verification in progress; D1/D3 remain In progress and ADR-040 Proposed.

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
rejection of missing opt-in, mutable tags and malformed source before Docker. Final image,
Linux regression and full-source verification results will be appended after terminal checks.

No cloud publication, activation, hosted CI/CD work, main merge or new PR. Managed task IAM,
TLS/routing, real provider, client/ATS and accountable acceptance remain open. The PC stays on.
