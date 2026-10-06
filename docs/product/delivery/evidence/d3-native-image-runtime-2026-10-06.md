# D3 native image runtime — 2026-10-06

Status: local implementation and focused verification; D1/D3 In progress, ADR-040 Proposed.

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

Final Linux, emitted checks, frozen-source full verification and final source/image identifiers are
recorded after terminal results. Managed image publication/activation, IAM/TLS/DNS/routing, live
provider and client/ATS/accountable acceptance remain open. CI/CD stays deferred, no third PR or
main merge is made, and the PC remains on.
