# D3 native image runtime — 2026-10-06

Status: local implementation and full source verification; D1/D3 In progress, ADR-040 Proposed.

The executable image now contains the actual foreground OpenAI, exact-version Secrets Manager,
signed owner RPC, direct read authorization, renderer/HTTPS and native deadline composition.
It has the launcher-required entrypoint, /materials working directory, UID/GID 65532 and port 8443.
The default image is disabled; enabling it needs reviewed image-owned identifiers, separate pinned
provider/TLS secrets, managed task IAM and routing. No cloud mutation or real model call is performed.

Profile owns a narrow active-candidate external-identity projection. Missing or ambiguous issuer
bindings refuse. The authenticated private RPC surrounds it with original preparation, Documents
consent and owning admission checks. No identity upsert, email, token, candidate fact or subject in
task overrides/image configuration is introduced. A same-account numeric function remains required.

Secret reads explicitly select both ARN and version ID, use only ECS task credentials, make one
attempt and await actual transport settlement after abort. Wrong ARN/version, binary, oversized,
revoked or late results refuse without exposing values. TLS validates key/certificate agreement,
allocation hostname and remaining lifetime. Provider storage/background/stream stay disabled.
The bundle excludes SQL, object storage, task control, KMS and owner service implementations.

113 Documents focused checks and 13 Profile unit checks pass. All 24 actual PostgreSQL owner
composition cases pass, including missing/foreign/ambiguous principal rejection and positive signed
RPC projection; AWS identity/secret/task operations are simulated. The actual Linux composition
generates and grounds a synthetic letter, renders PDF/DOCX, reads both via TLS with a verified test
token and retires by kernel SIGKILL. Initial harness syntax/authorization-response errors were fixed;
the actual source guards were preserved. No live provider, real subject, actual AWS role or hosted
client acceptance is inferred. Existing compiler-fixture canvas warnings remain exactly bounded;
the executable image includes actual canvas and its hardened default-off smoke emits no warnings.

Local working image build/smoke passes with read-only filesystem, no network, dropped capabilities,
no-new-privileges, zero core limit, bounded memory/processes and no log driver. It exits 1 with exactly
`NativeImageConfigurationUnavailable` while disabled. The working build used the previous head as
an explicit provisional source label; it is not a release artifact or clean-source attestation.
Logs are ignored `.tmp/d3-native-image-*`; no generated secrets/artifacts are committed.

All final checks pass: 113 Documents/13 Profile cases, 24 SQL cases, 30 actual Linux scenarios and
six emitted checks. Original full-verifier handle `15045` completes with exit 0 for clean committed
source `214371ca0282d4110e4d8313d5a417e0cf2b6a98`, explicit ARTIFACT_SOURCE_SHA and unchanged tracked
source: 38 typecheck tasks, 39 test tasks, 23 builds, zero lint errors/15 warnings/58 infos and all
maintained operator/security/isolation/Compose/scope checks. Logs: `.tmp/d3-native-image-full.log`,
`d3-native-image-linux-final.log`, `d3-native-image-sql.log`, `d3-native-image-focused-final.log`,
`d3-native-image-profile-final.log` and `d3-native-image-bundles-final.log` (all under ignored `.tmp`).

The final clean-source local image is
`sha256:227921f41c69ea7e72ee15b255119ff8bccf8c7a4f08bda7958a9489956e6c00`,
Linux/AMD64, Node 24, UID/GID 65532, /materials and the exact reviewed entrypoint/command. Its manifest
records source `214371ca0282d4110e4d8313d5a417e0cf2b6a98`, configuration SHA
`b5f5c4b4df340cb361f2d33040beed66204ba1aca5216cabb5290783865c35dc`, kernel SHA
`79660bd4e5213dc84c240825bae4df91be54f163b45840d0f4f1833c5dfa5d93` and bundle SHA
`1a31a252256089d951289870bc81c60a6836a6a860ce94442f2478532225ff7c`.
Three actual-image hardened smoke checks refuse disabled configuration, extra entrypoint arguments
and an environment provider key with exactly the fixed diagnostic and exit 1. This local manifest
is not image signing, release SBOM/provenance approval, AWS task attestation or a deployed endpoint.
The first additional-argument harness replaced Docker's entire CMD; rerunning with the actual main
script and an added argument exercises the intended refusal. No source guard is changed.
The owned SQL tmpfs fixture is removed; Linux staging is cleaned; Docker/WSL are stopped and PC on.
 Managed image publication/activation, IAM/TLS/DNS/routing, live
provider and client/ATS/accountable acceptance remain open. CI/CD stays deferred, no third PR or
main merge is made, and the PC remains on.

After terminal full verification, the maintained web launcher restores the local development
connection to `https://lemwm7dvi4.execute-api.us-east-2.amazonaws.com`. Home returns 200; an anonymous
resume request returns 307 without following redirects. Next's two generated dev-type imports are
inspected and restored. Original frontend source remains untouched. This confirms server connection
and anonymous routing, not new signed-in UI acceptance. Earlier owner-confirmed search/Profile/save/
reload checks remain recorded in [D1 evidence](d1-working-development-flow-2026-10-06.md).
