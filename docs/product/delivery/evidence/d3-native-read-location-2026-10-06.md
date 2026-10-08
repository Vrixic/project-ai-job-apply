# D3 scalar original native read location — 2026-10-06

Status: default-off source and local owner/Gateway evidence; D1/D3 remain In progress.

The additive v1 `GET /applications/{applicationId}/cover-letter/location?generationId=...`
returns a closed `ApplicationTemporaryMaterialLocation`: schemaVersion, packet ID/hash, original
material metadata and an HTTPS origin. It requires the existing authenticated applications:read
scope, exact UUIDv7 path/generation, one query parameter, no body and no-store. The existing strict
authorization route/response is unchanged, so the native authorization client can upgrade
independently. No event, shared domain shape or migration changes.

Applications verifies the current packet before the lookup and again afterward, comparing the
entire original proof. Packet changes, expiry, abort, authorization withdrawal and invalid location
responses withhold metadata. Documents checks the exact original allocation through its readiness
store, then derives `https://<original-allocation>.<configured-baseHost>:8443`, matching the image's
existing Host/TLS construction. It captures reference/configuration before awaits, refuses client
URLs and rechecks flag/abort/original expiry afterward. Only the origin is returned; task ARNs,
credentials, tokens and generated bodies are absent. No launch, renewal or liveness authority is
created. The native process still authorizes each subsequent content read independently.

Gateway uses a separate Documents-owned one-connection native Date/JSON pool. It does not import
the Documents renderer/provider runtime or join its tables itself. Enablement requires literal
`NATIVE_MATERIAL_READ_LOCATIONS_ENABLED=true`, `NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED=true`
and existing packet protection. `NATIVE_MATERIAL_BASE_HOST` must match the original image's reviewed
baseHost. The pinned hostname cannot drift across requests; withdrawal refuses without repinning.
Defaults remain off. The narrow private Documents entrypoint includes no renderer or model port.

Local verification:

- Documents/Applications builds and Gateway/Workflows typechecks pass.
- 31 Documents reader/old authorization-client and 20 Applications location/packet-proof cases pass.
- All 104 API contract, 28 domain and 20 event cases pass; repeat type generation is byte-stable.
- 220 Gateway cases pass, three pre-existing conditional cases skipped. Actual signed synthetic
  tokens exercise scope/owner/query/no-store behavior and the Lambda proxy's body-free allowlist;
  the owner service is simulated in these HTTP cases.
- All 25 PostgreSQL native owner/launcher cases pass. The expanded actual preparation/ready flow
  completes the protected Applications packet, then the real Applications location method and
  owning Documents lookup return its original allocation origin. One original RunTask remains.
  Four real owner migrations apply twice in a newly owned PostgreSQL 16.6 loopback tmpfs fixture.
  AWS/Lambda/ECS/provider/KMS responses are synthetic, not deployed acceptance.
- Initial contract checks reject the two outdated exact route inventories; they are updated to
  the added read route without weakening any scope/no-store/idempotency assertion. Initial proxy
  route sweep supplies no generation query for the new route; its exact input inventory is fixed.
  Affected suites pass on rerun.

Logs are `.tmp/d3-native-read-location-{gateway-final,contract-final,doc-tests,app-tests,sql}.log`.
Full clean-source verification passes (details below). No image rebuild is needed: native image/HTTPS content
source is unchanged. Managed DNS/TLS/network reachability, reviewed hostname/routing deployment,
browser access-token handoff and actual direct client/ATS/provider/accountable acceptance remain.
An origin derived from owning metadata does not certify any task is alive or reachable.

For a future direct client, the native paths are `/v1/applications/<applicationId>/cover-letter`
and `/file?format=pdf` or `/file?format=docx` below that origin, with the native transport's existing
Bearer/Origin checks. This step does not expose BFF credentials, alter frontend code or claim
browser integration. No cloud deployment/activation, main merge, new PR, CI/CD work or phase exit
is asserted. The PC stays on.

The newly owned SQL container is removed after exact label verification; Docker/WSL are stopped.
The owning isolated web parent/child are stopped before full verification reserves port 3000.

## Full clean-source verification

Clean source `0df9bd0bf6907efaaa50d1c847eca5657cd25da4` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks, 23 builds,
formatting/operator/security/Compose and emitted native isolation checks. Lint remains zero errors,
15 warnings and 58 infos. The original verifier handle finishes with exit zero; tracked source is
unchanged throughout the run. Log: `.tmp/d3-native-read-location-full.log`.

The owning isolated development web is restored against the live development API. Home returns
200 and anonymous `/resume` returns 307. Only Next.js's two generated development type imports
are restored after exact diff inspection. Docker/WSL remain stopped, shared volumes are retained
and the PC stays on. No sign-in or previously accepted owner browser step is repeated.

Source/local verification does not activate the Proposed ADR-040 decision or certify managed
routing, client token handoff, live provider, ATS or accountable approval. D1/D3 remain In progress.
