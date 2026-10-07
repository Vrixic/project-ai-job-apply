# Native resume image

Local, default-off composition for one original tailored resume. The path is:
ECS self metadata → signed original owner/bootstrap → pinned TLS secret → native kernel →
signed retained-source read → deterministic tailoring and PDF/DOCX verification → scalar ready
receipt → authenticated direct HTTPS preview/download. Gateway authorizes only current packet
metadata at `GET /v1/applications/{applicationId}/resume/authorization?generationId=...`.
Generated content does not travel through that Gateway route.

`Dockerfile.native-resume` and `build.mjs` build a Linux/AMD64 Node 24 image with the actual kernel,
renderers, PDF verifier and canvas dependency. The emitted runtime excludes model, SQL, S3, ECS,
KMS and owning-service code. `main.mjs` checks image-owned configuration/runtime/kernel hashes,
rejects ambient credentials and overrides, and listens on port 8443 as UID/GID 65532.

The synthetic `configuration.disabled.json` is the default. Enabled configuration requires
separate numeric owner/source Lambda versions in the deployment account, one version-pinned TLS
secret, trusted API/client origins, issuer/audience and base hostname. It contains no candidate
identity, source body, model credential or TLS key. The TLS secret has exactly `key` and `cert`;
the certificate must match `<allocation UUID>.<baseHost>` and cover the original lifetime.

Build only from a clean checkout with its exact source SHA:

```powershell
docker build --platform linux/amd64 --file Dockerfile.native-resume --build-arg SOURCE_SHA=<40-character-SHA> --tag ai-job-apply-native-resume-local:<SHA> .
```

Source Linux smoke tests use real signing, TLS, rendering and kernel retirement with synthetic
AWS, identity, secret and owner-store responses. This is not managed IAM/routing acceptance or
conformance of a built production image. Resume launch/preparation/packet attachment/location
resolution, client/ATS use and managed acceptance remain separate work. ADR-040 remains Proposed.

Task definitions must set `linuxParameters.initProcessEnabled: true` (local Docker runs use
`--init`). The native kernel deadline must signal the material process as an init child: an
actual image probe showed its SIGKILL timer did not terminate Node running as namespace PID 1.
The shared launcher refuses missing/disabled init before claiming work. This is a task runtime
requirement; it does not establish managed retirement or all-copy deletion evidence.
