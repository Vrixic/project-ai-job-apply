# Native material image

After original completion and real grounding/render verification, the authenticated native image
publishes an immutable scalar ready receipt. Updated enabled images require Documents migration
0013 and the matching numeric owner receiver. Readiness never contains generated text or refreshes
original expiry. See [receipt evidence](../../../../docs/product/delivery/evidence/d3-native-ready-receipt-2026-10-06.md).

The authenticated startup now requires the original Documents row version. The nine-scalar
bootstrap and native actor/controls preserve version 2 and later explicit generations. Pin the
matching numeric owner receiver; older eight-scalar replies refuse without a version fallback.
See [version evidence](../../../../docs/product/delivery/evidence/d3-native-document-version-2026-10-06.md).

Local implementation only; deployment, task IAM, endpoint routing, provider acceptance and
accountable release approval remain open. ADR-040 stays Proposed. This image runs one original
cover-letter generation and authenticated direct reads; it is not a shared worker or Lambda.

`Dockerfile.native-material` builds Linux/AMD64 Node 24, the actual Linux Node-API deadline,
Documents' isolated runtime and its real provider/Secrets Manager clients. It includes the Linux
canvas native dependency needed by PDF verification. No owning SQL, S3, ECS or KMS client enters
the emitted runtime. The entrypoint/user/working directory match the existing launcher contract.
Use the reviewed task definition's read-only filesystem, dropped capabilities, zero core limit,
no log driver/sidecar/mounts and bounded memory/process limits. Local tests do not approve task IAM.

The default build embeds `configuration.disabled.json`, containing synthetic identifiers and both
activation switches off. An enabled release needs a separately reviewed configuration file under
`backend/`, passed as `NATIVE_CONFIGURATION` during its build. The strict closed configuration has
only deployment/function identifiers, two distinct secret ARNs with exact version IDs, trusted
origins/issuer/audience/base hostname and port 8443. No subject, provider key, private certificate,
database URL or candidate artifact belongs in it. Do not commit real secret values or candidate data.

The process derives its original binding from ECS metadata, authenticates stored approval and
admission, obtains the exact owner's unambiguous issuer/subject from Profile via signed owner RPC,
then reads both pinned secret versions using ECS task credentials. It rejects mismatched secret
ARN/version, binary replies, incorrect certificate/key/host/expiry and workstation credentials.
The provider is the existing foreground OpenAI client with store/background/stream disabled.
The TLS secret is JSON with exactly `key` and `cert` PEM strings; the certificate must cover
`<allocation UUID>.<baseHost>` and remain valid through the bounded material lifetime. Routing/DNS
and real TLS/provider/IAM acceptance are managed release requirements, not implemented by this image.

`main.mjs` verifies image-owned bundle/configuration/kernel hashes, loads the kernel only after
original admission, and binds HTTPS to 0.0.0.0:8443. It accepts no extra command arguments or runtime
secret/configuration override. Startup diagnostics are fixed and contain no secret/candidate values.
The manifest records the supplied source SHA; release tooling must independently ensure a clean
matching source checkout and approved image digest. The manifest alone is not a signature, task
attestation, remote work settlement or process-death receipt. Local feature builds are unpublished.

Build from a clean source tree with the exact Git SHA:

```powershell
docker build --platform linux/amd64 --file Dockerfile.native-material --build-arg SOURCE_SHA=<40-character-SHA> --tag ai-job-apply-native-material-local:<SHA> .
```

For generated-only local positive proof, the maintained native Linux verifier connects these actual
ports to synthetic AWS/provider/identity responses, real rendering/HTTPS and actual kernel retirement.
Production rejects those test seams. No real account or model request is used by that test.

To exercise the exact locally built production bundle, canvas and kernel with generated-only
ports, opt in explicitly and supply immutable local image IDs and the image's source SHA:

```powershell
node scripts/verify-native-material-image.mjs --enable-local-image-tests --image sha256:<material-image-id> --certificate-image sha256:<local-node24-openssl-image-id> --source-sha <40-character-image-source-SHA>
```

The verifier uses no network or image pulls. Its separate test supervisor checks both original
document versions, PDF/DOCX HTTPS reads, kernel retirement and secret-version/TLS-host refusal.
It checks image manifest hashes, uses owned synthetic staging and removes its labelled containers.
This exercises the bundled factory with test ports; it does not activate production configuration
or prove managed IAM, endpoint routing or real provider acceptance.
See [actual image evidence](../../../../docs/product/delivery/evidence/d3-native-image-conformance-2026-10-06.md).
