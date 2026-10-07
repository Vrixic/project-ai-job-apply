# D3 native read admission — 2026-10-06

Status: default-off source and local Linux evidence; D1/D3 remain In progress.

The production Gateway and local API compositions now wire
`NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED` to the existing authenticated scalar authorization
route. It remains false unless the literal flag is true and the existing packet-protection
authority is enabled. The Gateway returns only current packet/material metadata, never generated
content or a task address. No deployed environment flag is changed.

The native content runtime surrounds each packet-authorization proof with authenticated original
task admission. Admission must succeed before the remote Gateway read and again after it.
The HTTPS transport already requests proofs before and after rendering, so both reads now check
the current original admission. No SQL lock spans remote authorization. Default off, wrong owner/
application/generation, abort, expiry or sealing withholds the proof with a fixed error; reads
cannot renew the original reference, issue work, prove liveness or acknowledge process death.

Local checks:

- All 29 focused read authorization/admission/runtime cases pass.
- Documents build and Gateway typecheck pass; all four emitted content/image/bootstrap isolation
  checks pass with no added persistence/model/task-control authority.
- All 33 Linux scenarios pass using the exact compiler image
  `sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
  Two new real HTTPS scenarios serve actual preview/PDF/DOCX, seal original admission and then
  refuse a file read with 503/no-store and no generated text. The dedicated kernel retires the
  process before supervisor fallback. Remote owner/provider/identity ports are synthetic.

The source image harness adds the same sealed-read scenario against the actual immutable runtime
image. Actual image evidence follows below; clean full verification remains pending.
Managed routing/target/IAM/key/provider/client/ATS and accountable acceptance remain open. No cloud
activation, frontend feature change, new PR, hosted CI/CD or phase completion is asserted.

## Signed Gateway and actual production image

All 28 existing signed Gateway/temporary-material PostgreSQL cases pass in the newly owned
loopback tmpfs fixture. Actual Identity/Profile/Applications/Documents migrations and packet
stores are used; JWT issuer, KMS and provider/owner replies are synthetic. This verifies the
scalar route with actual persistence, not live managed sign-in or a deployed flag change.

Production image `sha256:0f469b512f17b4a769305f81be8a92aa3076179fe3b308aef80d12909ccfa1e8`
is built from clean `64192061` source. All five actual-image scenarios pass: positive original
reads, sealed-read refusal, version-two original reads, secret-version refusal and TLS-host
refusal. Real PDF/DOCX and authenticated TLS 1.3 run in the image-owned runtime; original kernel
SIGKILL is observed before supervisor fallback, without diagnostics or extra work. Remote ports
remain synthetic. The actual cold production entrypoint separately refuses default-off with
exit 1 and exactly `NativeImageConfigurationUnavailable`.

The first image conformance run failed because the outer verifier retained the old four-scenario
inventory. Adding the exact fifth scenario/row count resolves it on the unchanged immutable image;
no runtime, timeout or diagnostic guard is weakened. Image source remains `64192061` and is not
relabeled as a later harness commit. Logs: `.tmp/d3-native-read-admission-image-proof-final.log`,
`.tmp/d3-native-read-admission-gateway-sql.log` and `.tmp/d3-native-read-admission-linux.log`.

The owned SQL fixture is removed after exact-label validation. Shared volumes remain untouched;
Docker/WSL are stopped and the PC remains on. No image publication or cloud activation is performed.
