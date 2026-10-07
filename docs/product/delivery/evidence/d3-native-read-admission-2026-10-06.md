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
image. Fresh production image and clean full verification remain pending at this checkpoint.
Managed routing/target/IAM/key/provider/client/ATS and accountable acceptance remain open. No cloud
activation, frontend feature change, new PR, hosted CI/CD or phase completion is asserted.
